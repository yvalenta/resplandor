// Arnés para correr el <script> inline de carta.html «de verdad» (en un vm de Node), con TODO lo de
// afuera simulado y un reloj virtual: la función `cuenta`, Realtime (supabase-js), el documento, el
// almacenamiento de sesión, la navegación y los temporizadores. Sirve a las pruebas de la cuenta en
// vivo (cuenta-en-vivo.test.mjs, parte 1C) y a las de pagar (carta-pagar.test.mjs, parte 2C), que lo
// usan sin modificarlo.
//
// Está copiado del arnés de funciones.test.mjs (cartaHtmlEnVm) y le suma lo que la cuenta en vivo
// necesita: `location.search` con mesa y token, `performance` (tipo de navegación), `sessionStorage`,
// `supabase` (carga diferida del script y canales) y `fetch` de `cuenta` según el contrato del SDD §04.3.
//
// La vista `carta_publica`, por defecto, cae con 402 (la carta se queda con la instantánea). Con la opción
// `vista` contesta como PostgREST con las filas de _carta-datos.mjs (desayunos, promociones, etiquetas), y
// `ahora` fija el instante virtual de arranque (para probar «hoy» en Bogotá).
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre como
// prueba, solo lo importan las que lo necesitan.
//
// El tiempo es virtual: nada espera de verdad. `h.avanzar(ms)` corre los temporizadores en orden y
// vacía las promesas entre uno y otro, así que una prueba de «60 s» tarda milisegundos.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { responderVista } from './_carta-datos.mjs';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

/** 48 ceros: el token del vector de prueba del tópico (compartido con 1A y 1B). */
export const TOKEN_CEROS = '0'.repeat(48);
export const topicoDe = (token) => 'cuenta:' + createHash('sha256').update(token).digest('hex');

// ───────────────────────── reloj virtual ─────────────────────────
export function crearReloj(inicio = Date.UTC(2026, 9, 1, 18, 0, 0)) { // 2026-10-01 13:00 en Bogotá
  let ahora = inicio;
  let siguienteId = 1;
  const timers = new Map();
  const programar = (fn, ms, args, cada) => {
    const t = { id: siguienteId++, en: ahora + Math.max(0, Number(ms) || 0), fn, args, cada };
    timers.set(t.id, t);
    return t.id;
  };
  // Vacía microtareas y las cadenas de promesas que dejan los `await` del carta.
  const vaciar = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return {
    ahora: () => ahora,
    setTimeout: (fn, ms, ...args) => programar(fn, ms, args, null),
    setInterval: (fn, ms, ...args) => programar(fn, Math.max(1, Number(ms) || 1), args, Math.max(1, Number(ms) || 1)),
    clear: (id) => { timers.delete(id); },
    pendientes: () => timers.size,
    vaciar,
    async avanzar(ms) {
      const meta = ahora + ms;
      await vaciar();
      for (;;) {
        let sig = null;
        for (const t of timers.values()) if (t.en <= meta && (!sig || t.en < sig.en || (t.en === sig.en && t.id < sig.id))) sig = t;
        if (!sig) break;
        ahora = Math.max(ahora, sig.en);
        if (sig.cada) sig.en += sig.cada; else timers.delete(sig.id);
        sig.fn(...sig.args);
        await vaciar();
      }
      ahora = meta;
      await vaciar();
    },
  };
}

// ───────────────────────── el servidor de `cuenta` (contrato del SDD §04.3) ─────────────────────────
// Un mundo mínimo: una mesa con token, a lo sumo una orden abierta y las que ya se cerraron. Contesta
// como lo haría la función 1B: `abierta` | `sin_orden` | `cerrada` (solo con `o`), `marca`, `canal`.
export function crearMundo(reloj, { mesa = 3, token = TOKEN_CEROS } = {}) {
  const mundo = {
    mesa, token,
    orden: null,                  // { id, items:[{nombre,precio,cantidad}], version, abierta_en }
    cerradas: new Set(),
    pagoConfirmado: new Set(),
    conCanal: true,               // false = la `cuenta` de antes: sin estado, canal ni marca
    conMarca: true,
    privado: false,
    topico: topicoDe(token),
    latencia: 0,                  // ms virtuales de cada respuesta
    fallo: null,                  // null | 'red' | 'lento' | { status, body, headers }
    lecturas: [],                 // { en, url, o }
    siguienteOrden: 1,

    abrirOrden(items = []) {
      mundo.orden = { id: 'orden' + mundo.siguienteOrden++, items: items.map((i) => ({ ...i })), version: 1, abierta_en: new Date(reloj.ahora()).toISOString() };
      return mundo.orden.id;
    },
    agregar(nombre, precio, cantidad = 1) {
      const o = mundo.orden;
      const previo = o.items.find((i) => i.nombre === nombre && i.precio === precio);
      if (previo) previo.cantidad += cantidad; else o.items.push({ nombre, precio, cantidad });
      o.version++;
    },
    cerrar({ pago = false } = {}) {
      mundo.cerradas.add(mundo.orden.id);
      if (pago) mundo.pagoConfirmado.add(mundo.orden.id);
      mundo.orden = null;
    },
    rotarToken(nuevo = 'f'.repeat(48)) { mundo.token = nuevo; mundo.topico = topicoDe(nuevo); },
    total: () => (mundo.orden ? mundo.orden.items.reduce((s, i) => s + i.precio * i.cantidad, 0) : 0),

    /** Lo que contestaría `GET /functions/v1/cuenta?m&k[&o]`. */
    responder(url) {
      const u = new URL(url);
      const m = u.searchParams.get('m'), k = u.searchParams.get('k'), o = u.searchParams.get('o');
      mundo.lecturas.push({ en: reloj.ahora(), url: String(url), o });
      if (Number(m) !== mundo.mesa || k !== mundo.token) {
        return { status: 404, body: mundo.conCanal ? { error: 'enlace inválido', codigo: 'enlace_invalido' } : { error: 'enlace inválido' } };
      }
      if (!mundo.conCanal) { // la `cuenta` de hoy
        if (!mundo.orden) return { status: 200, body: { mesa: mundo.mesa, abierta: false } };
        return { status: 200, body: { mesa: mundo.mesa, abierta: true, abierta_en: mundo.orden.abierta_en, items: mundo.orden.items.map((i) => ({ ...i })), total: mundo.total() } };
      }
      const base = { mesa: mundo.mesa, canal: { topico: mundo.topico, evento: 'cambio', privado: mundo.privado }, liquidar_activo: false, liquidacion: null, servidor_en: new Date(reloj.ahora()).toISOString() };
      if (o && (!mundo.orden || mundo.orden.id !== o)) {
        return { status: 200, body: { ...base, estado: 'cerrada', abierta: false, pago_confirmado: mundo.pagoConfirmado.has(o) } };
      }
      if (!mundo.orden) return { status: 200, body: { ...base, estado: 'sin_orden', abierta: false, ...(mundo.conMarca ? { marca: '0' } : {}) } };
      return {
        status: 200,
        body: {
          ...base, estado: 'abierta', abierta: true, orden_id: mundo.orden.id,
          ...(mundo.conMarca ? { marca: mundo.orden.version + '.0' } : {}),
          abierta_en: mundo.orden.abierta_en, actualizada_en: new Date(reloj.ahora()).toISOString(),
          items: mundo.orden.items.map((i) => ({ ...i })), total: mundo.total(),
        },
      };
    },
  };
  return mundo;
}

// ───────────────────────── Realtime y la carga diferida de supabase-js ─────────────────────────
export function crearSupabaseFalso(reloj) {
  const sb = {
    scripts: [],                  // los <script> que la carta pidió agregar (src, integrity, crossOrigin)
    libreria: 'ok',               // 'ok' | 'error' | 'nunca': qué pasa al agregar el <script>
    latenciaLibreria: 50,
    suscripcion: 'ok',            // 'ok' | 'nunca' | 'error': qué pasa al subscribe()
    latenciaSuscripcion: 50,
    clientes: [],
    canales: [],                  // todos los que se crearon
    cargada: false,
    /** Canales vivos (creados y no quitados). */
    vivos: () => sb.canales.filter((c) => !c.quitado),
    /** Entrega la señal «cambio» (payload vacío) a los canales vivos y suscritos de ese tópico: lo que haría el trigger + Realtime. */
    senal(topico, evento = 'cambio') {
      for (const c of sb.canales) if (!c.quitado && c.topico === topico && c.estadoActual === 'SUBSCRIBED') c.emitir(evento);
    },
    createClient(url, key, opciones) {
      const cliente = {
        url, key, opciones,
        channel(topico, config) {
          const c = {
            topico, config, quitado: false, estadoActual: null, manejadores: [], callback: null,
            on(tipo, filtro, fn) { c.manejadores.push({ tipo, filtro, fn }); return c; },
            subscribe(cb) {
              c.callback = cb;
              if (sb.suscripcion === 'ok') reloj.setTimeout(() => c.estado('SUBSCRIBED'), sb.latenciaSuscripcion);
              else if (sb.suscripcion === 'error') reloj.setTimeout(() => c.estado('CHANNEL_ERROR'), sb.latenciaSuscripcion);
              return c;
            },
            estado(s) { c.estadoActual = s; if (!c.quitado && c.callback) c.callback(s); },
            emitir(evento = 'cambio', payload = {}) {
              for (const h of c.manejadores) {
                if (h.tipo === 'broadcast' && h.filtro && h.filtro.event === evento) h.fn({ type: 'broadcast', event: evento, payload });
              }
            },
          };
          sb.canales.push(c);
          return c;
        },
        removeChannel(c) { c.quitado = true; return Promise.resolve('ok'); },
      };
      sb.clientes.push(cliente);
      return cliente;
    },
  };
  return sb;
}

/**
 * Carta.html corrida de verdad en un vm.
 *
 * opciones:
 *   - search: la query de la página (por defecto, mesa 3 y el token de 48 ceros)
 *   - navegacion: 'navigate' | 'reload' | 'back_forward' (performance.getEntriesByType('navigation'))
 *   - almacen: { clave: valor } inicial de sessionStorage; `almacenLanza: true` hace que lance
 *   - sinMundo: no crea la orden de entrada (arranca «sin_orden»)
 *   - conCanal / conMarca: la `cuenta` nueva o la de antes
 *   - vista: null (la vista cae con 402) o las opciones de responderVista ({ filas, anterior, status }): la
 *     carta en vivo con desayunos/promociones/etiquetas, o la base de antes (`anterior: true`)
 *   - ahora: ms del instante virtual de arranque (por defecto, el 2026-10-01 a las 13:00 en Bogotá, un jueves)
 */
export async function crearCarta(opciones = {}) {
  const {
    search = `?m=3&k=${TOKEN_CEROS}`, navegacion = 'navigate', almacen = {}, almacenLanza = false,
    conCanal = true, conMarca = true, items = [{ nombre: 'Limonada', precio: 5000, cantidad: 1 }], sinOrden = false,
    vista = null, ahora,
  } = opciones;

  const html = leer('carta.html');
  const codigo = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((t) => t.includes('function carta()'));
  if (!codigo) throw new Error('no encontré el <script> inline de carta.html');

  const reloj = crearReloj(ahora);
  const mundo = crearMundo(reloj);
  mundo.conCanal = conCanal; mundo.conMarca = conMarca;
  if (!sinOrden) mundo.abrirOrden(items);
  const supabase = crearSupabaseFalso(reloj);
  const llamadas = { vista: 0, vistas: [], cuenta: [] }; // vistas: la URL de cada pedido a carta_publica; cuenta: cada pedido a `cuenta` { en, url }, conteste lo que conteste

  // sessionStorage de verdad (un Map), que puede lanzar como en un modo privado.
  const datos = new Map(Object.entries(almacen));
  const sessionStorage = {
    getItem: (k) => { if (almacenLanza) throw new Error('sessionStorage bloqueado'); return datos.has(k) ? datos.get(k) : null; },
    setItem: (k, v) => { if (almacenLanza) throw new Error('sessionStorage bloqueado'); datos.set(k, String(v)); },
    removeItem: (k) => { if (almacenLanza) throw new Error('sessionStorage bloqueado'); datos.delete(k); },
  };

  // Eventos del documento y de la ventana, con despacho a mano.
  const escuchas = (tabla) => ({
    addEventListener(tipo, fn) { (tabla[tipo] ||= new Set()).add(fn); },
    removeEventListener(tipo, fn) { tabla[tipo]?.delete(fn); },
    despachar(tipo) { for (const fn of [...(tabla[tipo] || [])]) fn({ type: tipo }); },
    cuantos: (tipo) => (tabla[tipo] ? tabla[tipo].size : 0),
  });
  const deDocumento = escuchas({});
  const deVentana = escuchas({});

  const documento = {
    visibilityState: 'visible',
    querySelectorAll: () => [],
    head: {
      hijos: [],
      appendChild(el) {
        documento.head.hijos.push(el);
        supabase.scripts.push(el);
        if (supabase.libreria === 'nunca') return el;
        reloj.setTimeout(() => {
          if (supabase.libreria === 'ok') {
            caja.supabase = { createClient: (...a) => supabase.createClient(...a) };
            supabase.cargada = true;
            if (el.onload) el.onload();
          } else if (el.onerror) el.onerror(new Error('script bloqueado'));
        }, supabase.latenciaLibreria);
        return el;
      },
    },
    createElement: (tag) => ({ tag, remove() { documento.head.hijos = documento.head.hijos.filter((x) => x !== this); } }),
    addEventListener: deDocumento.addEventListener,
    removeEventListener: deDocumento.removeEventListener,
  };

  // Respuestas de `fetch`: la vista de la carta (caída con 402 salvo que se pida `vista`) y `cuenta`.
  const respuesta = ({ status, body, headers = {} }) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers[String(n).toLowerCase()] ?? null },
    json: async () => body,
  });
  const fetchFalso = (url, init = {}) => new Promise((resolver, rechazar) => {
    const direccion = String(url);
    if (direccion.includes('/rest/v1/carta_publica')) {
      llamadas.vista++; llamadas.vistas.push(direccion);
      resolver(respuesta(vista ? responderVista(direccion, vista) : { status: 402, body: {} }));
      return;
    }
    if (!direccion.includes('/functions/v1/cuenta')) { rechazar(new Error('fetch inesperado: ' + direccion)); return; }
    llamadas.cuenta.push({ en: reloj.ahora(), url: direccion });
    const senal = init.signal;
    const abortar = () => { const e = new Error('abortado'); e.name = 'AbortError'; rechazar(e); };
    if (senal) { if (senal.aborted) { abortar(); return; } senal.addEventListener('abort', abortar); }
    const f = mundo.fallo;
    if (f === 'red') { reloj.setTimeout(() => rechazar(new TypeError('Failed to fetch')), mundo.latencia); return; }
    if (f === 'lento') return; // no contesta nunca: lo corta el AbortController del carta
    reloj.setTimeout(() => {
      if (senal && senal.aborted) return;
      if (f && typeof f === 'object') { resolver(respuesta(f)); return; }
      resolver(respuesta(mundo.responder(direccion)));
    }, mundo.latencia);
  });

  const caja = {
    console, URLSearchParams, AbortController, URL,
    setTimeout: reloj.setTimeout, clearTimeout: reloj.clear, setInterval: reloj.setInterval, clearInterval: reloj.clear,
    location: { search },
    document: documento,
    sessionStorage,
    performance: { now: () => reloj.ahora(), getEntriesByType: (t) => (t === 'navigation' ? [{ type: navegacion }] : []) },
    navigator: { onLine: true },
    // Celular (<1024 px): la hoja inferior es la única vista. El panel de escritorio se prueba en pagar.test.mjs, con navegador.
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    fetch: fetchFalso,
    addEventListener: deVentana.addEventListener,
    removeEventListener: deVentana.removeEventListener,
  };
  // `new Date()` sin argumentos y `Date.now()` salen del reloj virtual.
  caja.Date = class FechaVirtual extends Date {
    constructor(...a) { if (a.length === 0) super(reloj.ahora()); else super(...a); }
    static now() { return reloj.ahora(); }
  };
  caja.window = caja;
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leer('assets/js/carta-respaldo.js'), caja, { filename: 'assets/js/carta-respaldo.js' });
  vm.runInContext(leer('assets/js/local.js'), caja, { filename: 'assets/js/local.js' });
  const carta = vm.runInContext(`${codigo}\n;carta`, caja, { filename: 'carta.html (inline)' });

  const c = carta();
  c.$watch = () => {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.$refs = {};

  const h = {
    c, mundo, reloj, supabase, documento, llamadas, caja,
    ventana: deVentana, doc: deDocumento,
    almacen: datos,
    avanzar: (ms) => reloj.avanzar(ms),
    /** Corre init() (lee la vista, que cae a la instantánea) y deja todo quieto. */
    async iniciar() { await c.init(); await reloj.avanzar(0); return h; },
    /** Toca «Ver mi cuenta»: abre la hoja y deja pasar `ms` de tiempo virtual (por defecto, lo justo para que conecte). */
    async abrir(ms = 500) { c.abrirCuenta(); await reloj.avanzar(ms); return h; },
    /** El POS cambia algo: el trigger emite la señal al tópico de la mesa (si hay quien escuche). */
    cambio(fn, { senal = true } = {}) { fn(mundo); if (senal) supabase.senal(mundo.topico); },
    /** Cuántas lecturas de `cuenta` hubo desde `desde` (ms virtuales) hasta ahora. */
    lecturasDesde: (desde, hasta = Infinity) => llamadas.cuenta.filter((l) => l.en >= desde && l.en < hasta).length,
    /** El valor de `o` que mandó cada pedido a `cuenta` (null si no lo mandó). */
    ordenes: () => llamadas.cuenta.map((l) => new URL(l.url).searchParams.get('o')),
    ocultar: async () => { documento.visibilityState = 'hidden'; deDocumento.despachar('visibilitychange'); await reloj.avanzar(0); },
    mostrar: async () => { documento.visibilityState = 'visible'; deDocumento.despachar('visibilitychange'); await reloj.avanzar(0); },
  };
  return h;
}
