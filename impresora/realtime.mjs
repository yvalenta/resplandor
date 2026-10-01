// La señal «hay un trabajo»: un cliente mínimo de Supabase Realtime (protocolo Phoenix v1, JSON), sin
// dependencias, sobre el WebSocket que ya trae Node 22.
//
// El trigger de la base manda, en cada trabajo nuevo, una señal SIN datos al tópico público
//     impresora:<sha256 hex del token>      evento «cambio»      payload {}
// (como la cuenta en vivo de la carta). Este canal se une a ese tópico y, al oír CUALQUIER broadcast en él,
// llama a `onSenal()`: el agente pregunta entonces a la base con impresora_tomar. Por el canal no viaja
// ningún dato, así que si el WebSocket falla, se pierde velocidad (el sondeo de 5 s sigue), nunca un trabajo.
//
// Protocolo (lo que hace realtime-js, a mano):
//   conectar   wss://<proyecto>.supabase.co/realtime/v1/websocket?apikey=<clave publicable>&vsn=1.0.0
//   unirse     {topic:"realtime:<tópico>", event:"phx_join", payload:{config:{broadcast:{ack:false,self:false},
//              presence:{key:"",enabled:false}, postgres_changes:[], private:false}, access_token:<clave>}, ref, join_ref}
//   latido     {topic:"phoenix", event:"heartbeat", payload:{}, ref}   cada 25 s; si el anterior no se contestó,
//              la conexión se da por muerta (wifi caído, PC dormido) y se reabre.
//   señal      {topic:"realtime:<tópico>", event:"broadcast", payload:{event:"cambio", type:"broadcast", payload:{}}}
//   caída      reconexión con espera creciente (1, 2, 4, 8, 15, 30, 60 s, con un poco de azar).
//
// vsn=1.0.0 (objetos JSON) y no 2.0.0 (listas y binarios): es el que menos cambia. Si el servidor contesta en
// formato de lista, también se entiende.

import { createHash } from 'node:crypto';

/** El tópico de una impresora: 'impresora:' + hex(sha256(token)). La misma derivación que hace la base. */
export function topicoDeToken(token) {
  return 'impresora:' + createHash('sha256').update(token, 'utf8').digest('hex');
}

export function urlRealtime(supabaseUrl, clave) {
  const u = new URL(supabaseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/realtime/v1/websocket';
  u.search = new URLSearchParams({ apikey: clave, vsn: '1.0.0' }).toString();
  u.hash = '';
  return u.toString();
}

/** Mensaje del servidor → { topic, event, payload, ref } (acepta objeto, o la lista de la v2). */
export function leerMensaje(datos) {
  if (typeof datos !== 'string') return null;
  let m;
  try { m = JSON.parse(datos); } catch { return null; }
  if (Array.isArray(m) && m.length === 5) m = { join_ref: m[0], ref: m[1], topic: m[2], event: m[3], payload: m[4] };
  if (!m || typeof m !== 'object' || typeof m.event !== 'string') return null;
  return { topic: m.topic ?? '', event: m.event, payload: m.payload ?? {}, ref: m.ref ?? null };
}

export const ESPERAS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000, 60_000];

export class CanalRealtime {
  /**
   * @param {object} p
   * @param {string} p.url        dirección del WebSocket (urlRealtime)
   * @param {string} p.clave      clave publicable (apikey y access_token)
   * @param {string} p.topico     'impresora:<hash>'
   * @param {() => void} p.onSenal           se llama con cada broadcast del tópico
   * @param {(estado: string, detalle?: string) => void} [p.onEstado]  'conectando' | 'unido' | 'caido' | 'detenido'
   */
  constructor({
    url, clave, topico, onSenal, onEstado = () => {}, log = null,
    WebSocketImpl = globalThis.WebSocket, esperas = ESPERAS_MS, azar = Math.random,
    heartbeatMs = 25_000, unirseMs = 10_000, estableMs = 30_000,
  }) {
    if (!WebSocketImpl) throw new Error('Este Node no trae WebSocket: instala Node 22 o más nuevo.');
    Object.assign(this, { url, clave, topico, onSenal, onEstado, log, WebSocketImpl, esperas, azar, heartbeatMs, unirseMs, estableMs });
    this.estado = 'detenido';
    this.detenido = true;
    this.ws = null;
    this.ref = 0;
    this.intento = 0;
    this.timers = new Set();
  }

  iniciar() {
    if (this.estado !== 'detenido') return;
    this.detenido = false;
    this.conectar();
  }

  detener() {
    this.detenido = true;
    this.limpiar();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ya cerrado */ }
    this.cambiar('detenido');
  }

  cambiar(estado, detalle) {
    if (this.estado === estado && !detalle) return;
    this.estado = estado;
    try { this.onEstado(estado, detalle); } catch { /* el oyente no debe tumbar el canal */ }
  }

  poner(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    t.unref?.();
    this.timers.add(t);
    return t;
  }

  limpiar() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.latido) { clearInterval(this.latido); this.latido = null; }
  }

  conectar() {
    if (this.detenido) return;
    this.cambiar('conectando');
    this.limpiar();
    this.unido = false;
    this.latidoPendiente = false;
    let ws;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (e) {
      this.caer(`no se pudo abrir el WebSocket: ${e.message}`);
      return;
    }
    this.ws = ws;
    let cerrado = false;
    const alCaer = (motivo) => {
      if (cerrado || this.ws !== ws) return;
      cerrado = true;
      try { ws.close(); } catch { /* ya cerrado */ }
      this.ws = null;
      this.caer(motivo);
    };
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.unirse();
      this.poner(this.unirseMs, () => { if (!this.unido) alCaer('el servidor no contestó al unirse al canal'); });
    });
    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return;
      const m = leerMensaje(ev.data);
      if (m) this.recibir(m, alCaer);
    });
    ws.addEventListener('error', () => alCaer('error del WebSocket'));
    ws.addEventListener('close', (ev) => alCaer(`conexión cerrada${ev?.code ? ` (${ev.code})` : ''}`));
  }

  enviar(objeto) {
    try { this.ws?.send(JSON.stringify(objeto)); } catch { /* si no sale, el latido lo detecta */ }
  }

  unirse() {
    this.joinRef = String(++this.ref);
    this.enviar({
      topic: `realtime:${this.topico}`,
      event: 'phx_join',
      payload: {
        config: { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, postgres_changes: [], private: false },
        access_token: this.clave,
      },
      ref: this.joinRef,
      join_ref: this.joinRef,
    });
  }

  recibir(m, alCaer) {
    const nuestro = m.topic === `realtime:${this.topico}`;
    if (m.event === 'phx_reply' && m.topic === 'phoenix') { this.latidoPendiente = false; return; }
    if (m.event === 'phx_reply' && nuestro && m.ref === this.joinRef) {
      if (m.payload?.status === 'ok') {
        this.unido = true;
        this.cambiar('unido');
        this.empezarLatido(alCaer);
        this.poner(this.estableMs, () => { if (this.unido) this.intento = 0; });
      } else {
        alCaer(`el servidor rechazó el canal (${m.payload?.response?.reason ?? m.payload?.status ?? 'sin motivo'})`);
      }
      return;
    }
    if (!nuestro) return;
    if (m.event === 'broadcast') { try { this.onSenal(); } catch (e) { this.log?.aviso?.(`Al atender la señal: ${e.message}`); } return; }
    if (m.event === 'phx_close' || m.event === 'phx_error') { alCaer(`el servidor cerró el canal (${m.event})`); return; }
    if (m.event === 'system' && m.payload?.status === 'error') {
      this.log?.limitado?.('rt-sistema', 600_000, 'aviso', `Realtime avisa de un problema: ${String(m.payload?.message ?? '').slice(0, 160)}`);
    }
  }

  empezarLatido(alCaer) {
    if (this.latido) clearInterval(this.latido);
    this.latido = setInterval(() => {
      if (this.latidoPendiente) { alCaer('el servidor no contestó al latido (¿se cayó la red?)'); return; }
      this.latidoPendiente = true;
      this.enviar({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) });
    }, this.heartbeatMs);
    this.latido.unref?.();
  }

  caer(motivo) {
    if (this.detenido) return;
    this.limpiar();
    const base = this.esperas[Math.min(this.intento, this.esperas.length - 1)];
    const espera = Math.round(base * (0.8 + this.azar() * 0.4));
    this.intento++;
    this.cambiar('caido', motivo);
    this.log?.limitado?.('rt-caido', 300_000, 'aviso', `Señal en tiempo real caída (${motivo}); sigo mirando la cola cada pocos segundos y reintento en ${Math.round(espera / 1000)} s.`);
    this.poner(espera, () => this.conectar());
  }
}
