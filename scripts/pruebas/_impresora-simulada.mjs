// Un Supabase de mentira para probar el agente de la impresora (impresora/): HTTP para las tres RPC de la
// cola y WebSocket para Realtime, en un solo servidor local sin dependencias.
//
// Hace lo mismo que la base real según el contrato de la tarea (no la migración, que es otra parte):
//   POST /rest/v1/rpc/impresora_tomar      {p_token, p_max}                → filas tomadas (pendientes + imprimiendo trabados > 2 min)
//   POST /rest/v1/rpc/impresora_confirmar  {p_token, p_id, p_ok, p_error}  → {ok, estado}; 3 intentos y luego «error»
//   POST /rest/v1/rpc/impresora_latido     {p_token, p_version}            → {ok:true} / {ok:false} (token inválido)
//   GET  ws://…/realtime/v1/websocket?apikey=…&vsn=1.0.0   Phoenix v1: phx_join, heartbeat, broadcast
// Un token inválido devuelve lista vacía en `tomar` (sin pistas), igual que la base.
//
// Palancas para provocar fallos: `caido` (503 a todo), `fallar(rpc, n)` (n respuestas 500), `sinMigracion`
// (404 PGRST202), `mudoAlLatido` (el WebSocket no contesta a los heartbeat), `rechazarUnion`, `cortarWs()`,
// `señal()` (el broadcast del trigger). Todo lo que pasó queda en `llamadas`, `uniones` y `trabajos`.

import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

function marco(opcode, carga) {
  const datos = Buffer.from(carga);
  const n = datos.length;
  const cabecera = n < 126 ? Buffer.from([0x80 | opcode, n]) : Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff]);
  return Buffer.concat([cabecera, datos]);
}

function* leerMarcos(buffer) {
  let i = 0;
  while (buffer.length - i >= 2) {
    const opcode = buffer[i] & 0x0f;
    const enmascarado = (buffer[i + 1] & 0x80) !== 0;
    let largo = buffer[i + 1] & 0x7f;
    let p = i + 2;
    if (largo === 126) { if (buffer.length - p < 2) break; largo = buffer.readUInt16BE(p); p += 2; }
    else if (largo === 127) { if (buffer.length - p < 8) break; largo = Number(buffer.readBigUInt64BE(p)); p += 8; }
    const mascara = enmascarado ? buffer.subarray(p, p + 4) : null;
    if (enmascarado) p += 4;
    if (buffer.length - p < largo) break;
    const carga = Buffer.from(buffer.subarray(p, p + largo));
    if (mascara) for (let k = 0; k < carga.length; k++) carga[k] ^= mascara[k % 4];
    yield { opcode, carga, siguiente: p + largo };
    i = p + largo;
  }
}

export async function crearImpresoraSimulada({
  token = 'tok_' + 'a1b2c3d4e5'.repeat(4),
  clave = 'sb_publishable_prueba_0123456789abcdef',
  trabadoMs = 120_000,
} = {}) {
  const S = {
    token, clave,
    trabajos: [], llamadas: [], confirmaciones: [], uniones: [], latidos: [], urlsWs: [],
    caido: false, sinMigracion: false, mudoAlLatido: false, rechazarUnion: false, retardoMs: 0,
    fallos: new Map(),
    sockets: new Set(),
    topico: `impresora:${sha256(token)}`,
  };

  S.encolar = (contenido, extra = {}) => {
    const t = {
      id: randomUUID(), impresora_id: null, tipo: 'cuenta', mesa_id: 4, orden_id: null, contenido,
      estado: 'pendiente', intentos: 0, error: null, creada_por: 'prueba@example.test',
      creada_en: new Date().toISOString(), tomada_en: null, impresa_en: null, ...extra,
    };
    S.trabajos.push(t);
    return t;
  };
  S.fallar = (rpc, veces, estado = 500) => S.fallos.set(rpc, { veces, estado });
  S.estadoDe = (id) => S.trabajos.find((t) => t.id === id)?.estado;
  S.emitir = (objeto) => { for (const s of S.sockets) if (s.unido) s.write(marco(1, JSON.stringify(objeto))); };
  S.señal = () => S.emitir({ topic: `realtime:${S.topico}`, event: 'broadcast', payload: { type: 'broadcast', event: 'cambio', payload: {} }, ref: null });
  S.cortarWs = () => { for (const s of [...S.sockets]) s.destroy(); };
  S.unidos = () => [...S.sockets].filter((s) => s.unido).length;

  const valido = (t) => typeof t === 'string' && sha256(t) === sha256(S.token);

  function rpc(nombre, cuerpo) {
    if (nombre === 'impresora_tomar') {
      if (!valido(cuerpo.p_token)) return { estado: 200, cuerpo: [] };
      const ahora = Date.now();
      const tomar = S.trabajos.filter((t) => t.estado === 'pendiente'
        || (t.estado === 'imprimiendo' && ahora - Date.parse(t.tomada_en) > trabadoMs)).slice(0, cuerpo.p_max ?? 5);
      for (const t of tomar) { t.estado = 'imprimiendo'; t.intentos++; t.tomada_en = new Date().toISOString(); }
      return { estado: 200, cuerpo: tomar.map((t) => ({ ...t })) };
    }
    if (nombre === 'impresora_confirmar') {
      if (!valido(cuerpo.p_token)) return { estado: 200, cuerpo: { ok: false } };
      const t = S.trabajos.find((x) => x.id === cuerpo.p_id);
      if (!t) return { estado: 200, cuerpo: { ok: false, error: 'trabajo no encontrado' } };
      S.confirmaciones.push({ id: t.id, ok: cuerpo.p_ok, error: cuerpo.p_error });
      if (cuerpo.p_ok) { t.estado = 'impresa'; t.impresa_en = new Date().toISOString(); t.error = null; }
      else { t.error = cuerpo.p_error; t.estado = t.intentos >= 3 ? 'error' : 'pendiente'; }
      return { estado: 200, cuerpo: { ok: true, estado: t.estado } };
    }
    if (nombre === 'impresora_latido') {
      if (!valido(cuerpo.p_token)) return { estado: 200, cuerpo: { ok: false } };
      S.latidos.push(cuerpo.p_version);
      return { estado: 200, cuerpo: { ok: true } };
    }
    return { estado: 404, cuerpo: { code: 'PGRST202', message: `Could not find the function public.${nombre}` } };
  }

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    const trozos = [];
    req.on('data', (d) => trozos.push(d));
    req.on('end', async () => {
      const responder = (estado, cuerpo) => {
        res.writeHead(estado, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cuerpo));
      };
      if (!m || req.method !== 'POST') return responder(404, { message: 'no es una RPC' });
      let cuerpo = {};
      try { cuerpo = JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}'); } catch { return responder(400, { message: 'JSON inválido' }); }
      S.llamadas.push({ rpc: m[1], cuerpo, apikey: req.headers.apikey, autorizacion: req.headers.authorization, tipo: req.headers['content-type'] });
      if (S.retardoMs) await new Promise((r) => setTimeout(r, S.retardoMs));
      if (req.headers.apikey !== S.clave) return responder(401, { message: 'Invalid API key' });
      if (S.caido) return responder(503, { message: 'servicio caído' });
      const f = S.fallos.get(m[1]);
      if (f && f.veces > 0) { f.veces--; return responder(f.estado, { message: 'fallo provocado' }); }
      if (S.sinMigracion) return responder(404, { code: 'PGRST202', message: `Could not find the function public.${m[1]}` });
      const r = rpc(m[1], cuerpo);
      return responder(r.estado, r.cuerpo);
    });
  });

  servidor.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    S.urlsWs.push(req.url);
    if (url.pathname !== '/realtime/v1/websocket' || url.searchParams.get('apikey') !== S.clave) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const aceptar = createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${aceptar}\r\n\r\n`);
    socket.unido = false;
    S.sockets.add(socket);
    let resto = Buffer.alloc(0);
    socket.on('data', (d) => {
      resto = Buffer.concat([resto, d]);
      let hasta = 0;
      for (const f of leerMarcos(resto)) {
        hasta = f.siguiente;
        if (f.opcode === 8) { socket.end(marco(8, Buffer.alloc(0))); continue; }
        if (f.opcode === 9) { socket.write(marco(10, f.carga)); continue; }
        if (f.opcode !== 1) continue;
        let msg;
        try { msg = JSON.parse(f.carga.toString('utf8')); } catch { continue; }
        if (msg.event === 'phx_join') {
          S.uniones.push(msg);
          const ok = !S.rechazarUnion && msg.topic === `realtime:${S.topico}`;
          socket.unido = ok;
          socket.write(marco(1, JSON.stringify({
            topic: msg.topic, event: 'phx_reply', ref: msg.ref, join_ref: msg.join_ref,
            payload: ok ? { status: 'ok', response: { postgres_changes: [] } } : { status: 'error', response: { reason: 'Unauthorized' } },
          })));
        } else if (msg.event === 'heartbeat' && !S.mudoAlLatido) {
          socket.write(marco(1, JSON.stringify({ topic: 'phoenix', event: 'phx_reply', ref: msg.ref, payload: { status: 'ok', response: {} } })));
        } else if (msg.event === 'heartbeat') {
          S.latidosSinContestar = (S.latidosSinContestar ?? 0) + 1;
        }
      }
      resto = resto.subarray(hasta);
    });
    socket.on('close', () => S.sockets.delete(socket));
    socket.on('error', () => S.sockets.delete(socket));
  });

  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  S.puerto = servidor.address().port;
  S.url = `http://127.0.0.1:${S.puerto}`;
  S.cerrar = async () => {
    for (const s of S.sockets) s.destroy();
    servidor.closeAllConnections?.();
    await new Promise((r) => servidor.close(r));
  };
  return S;
}
