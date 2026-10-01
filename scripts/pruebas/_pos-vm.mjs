// Arnés compartido de las pruebas de pos.html que ejecutan su <script> REAL en un `vm` de Node
// (mismo patrón que pos-cuenta-base.test.mjs y funciones.test.mjs), más una BASE FALSA con las
// reglas que pos.html le exige a Supabase: upsert, borrado, select, el índice único «una orden
// abierta por mesa» y la RPC `aplicar_delta_orden` (NO idempotente, falla si la orden no existe).
// No es un módulo de pruebas (el guion bajo lo deja fuera de `node --test scripts/pruebas/*.test.mjs`).
//
// Qué simula y qué no: la red es un interruptor (`base.red = false` → toda llamada devuelve el error
// que da supabase-js sin red, `{data: null, error}`, sin lanzar); la latencia es opcional; las fallas
// puntuales se piden con `base.fallar('delete:ordenes')`. No simula RLS, triggers ni Realtime: los
// ecos de Realtime se inyectan a mano con `pos.procesarCambioEnVivo`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');

export const soltar = () => new Promise((r) => setImmediate(r));
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
/** Deja correr varias vueltas de lo que el POS no espera (push sin await, cadenas de promesas). */
export async function asentar(vueltas = 12) { for (let i = 0; i < vueltas; i++) await soltar(); }
/** Espera (con un tope) a que se cumpla algo que depende de temporizadores. */
export async function hastaQue(cond, { ms = 3000, paso = 5 } = {}) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) { if (cond()) return true; await dormir(paso); }
  return !!cond();
}
export const plano = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x))); // trae a este realm lo que salió del `vm`

/** El <script> inline que define el store `pos` (el otro solo pinta iconos). */
export function scriptDelStore() {
  const bloques = [...POS.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const codigo = bloques.find((t) => t.includes("Alpine.store('pos'"));
  assert.ok(codigo, "no encontré el <script> de pos.html que define Alpine.store('pos', …)");
  return codigo;
}

export function textoDelScript() { return scriptDelStore(); }

// ───────────────────────── cliente de supabase de mentira ─────────────────────────

/**
 * Apunta cada llamada y deja que `responder(llamada)` conteste (por defecto, vacío y sin error). Una
 * llamada `from(...)` queda como {tipo:'from', tabla, op, cuerpo, opciones, filtros, retorno, unico}; una
 * `rpc`, como {tipo:'rpc', nombre, args}. `responder` puede ser async (una lectura «en vuelo»).
 */
export function crearSupabase({ responder = () => undefined } = {}) {
  const llamadas = [];
  const canales = [];
  const enVuelo = { ahora: 0, maximo: 0 };
  const porDefecto = (c) => (c.op === 'select' && !c.retorno ? { data: c.unico ? null : [], error: null }
    : c.retorno ? { data: [], error: null } : { data: null, error: null });

  function constructor(tabla) {
    const c = { tipo: 'from', tabla, op: 'select', cuerpo: undefined, opciones: undefined, filtros: [], retorno: null, unico: false };
    const b = {
      select(columnas) { if (c.op === 'select') c.columnas = columnas; else c.retorno = columnas; return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() { c.unico = true; return b; },
      eq(col, val) { c.filtros.push([col, val, 'eq']); return b; },
      in(col, vals) { c.filtros.push([col, vals, 'in']); return b; },
      upsert(cuerpo, opciones) { c.op = 'upsert'; c.cuerpo = cuerpo; c.opciones = opciones; return b; },
      update(cuerpo) { c.op = 'update'; c.cuerpo = cuerpo; return b; },
      insert(cuerpo) { c.op = 'insert'; c.cuerpo = cuerpo; return b; },
      delete() { c.op = 'delete'; return b; },
      then(ok, ko) {
        llamadas.push(c);
        enVuelo.ahora++; enVuelo.maximo = Math.max(enVuelo.maximo, enVuelo.ahora);
        const p = Promise.resolve().then(() => responder(c)).then((r) => r ?? porDefecto(c))
          .finally(() => { enVuelo.ahora--; });
        return p.then(ok, ko);
      },
    };
    return b;
  }

  const cliente = {
    from: constructor,
    rpc(nombre, args) {
      const c = { tipo: 'rpc', nombre, args };
      return { then(ok, ko) {
        llamadas.push(c);
        return Promise.resolve().then(() => responder(c)).then((r) => r ?? { data: null, error: null }).then(ok, ko);
      } };
    },
    channel(nombre, config) {
      const canal = { nombre, config, eventos: [], suscripcion: null, rastreos: [] };
      canal.on = (tipo, filtro) => { canal.eventos.push({ tipo, filtro }); return canal; };
      canal.subscribe = (cb) => { canal.suscripcion = cb; return canal; };
      canal.presenceState = () => ({});
      canal.track = (x) => { canal.rastreos.push(x); };
      canales.push(canal);
      return canal;
    },
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({}),
      signInWithOAuth: async () => ({}),
      signOut: async () => ({}),
    },
  };

  return {
    cliente, llamadas, canales, enVuelo,
    de: (tabla, op) => llamadas.filter((c) => c.tipo === 'from' && c.tabla === tabla && (!op || c.op === op)),
    rpcs: (nombre) => llamadas.filter((c) => c.tipo === 'rpc' && (!nombre || c.nombre === nombre)),
    canal: (nombre) => canales.find((c) => c.nombre === nombre),
  };
}

// ───────────────────────── la base falsa ─────────────────────────

const aLista = (x) => (Array.isArray(x) ? x : [x]);

/**
 * Una base con tablas en memoria detrás de `responder`. Estados que las pruebas miran:
 *   base.ordenes / mesas / productos / cierres → Map id → fila (filas con los nombres de columna de Postgres)
 *   base.rpcs → los deltas que llegaron: {orden, item, delta}
 *   base.red → interruptor; base.latenciaMs → demora de cada llamada; base.fallar('op:tabla') → falla esa operación
 */
export function crearBaseFalsa({ mesas = [], ordenes = [], productos = [], cierres = [], latenciaMs = 0 } = {}) {
  const tabla = (filas) => new Map(filas.map((f) => [f.id, { ...f }]));
  const base = {
    red: true,
    latenciaMs,
    mesas: tabla(mesas),
    ordenes: tabla(ordenes.map((o) => ({ version: 0, items: [], total: 0, ...o }))),
    productos: tabla(productos),
    cierres: tabla(cierres),
    rpcs: [],
    fallos: new Set(),
    fallar(clave) { base.fallos.add(clave); },
    repararTodo() { base.fallos.clear(); },
  };
  const sinRed = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
  const total = (items) => items.reduce((s, i) => s + Number(i.precio) * i.qty, 0);

  base.responder = async (c) => {
    if (base.latenciaMs) await dormir(base.latenciaMs);
    if (!base.red) return sinRed();
    if (c.tipo === 'rpc') {
      if (c.nombre === 'aplicar_delta_orden') {
        if (base.fallos.has('rpc:aplicar_delta_orden')) return { data: null, error: { message: 'fallo inyectado' } };
        const o = base.ordenes.get(c.args.p_orden_id);
        if (!o) return { data: null, error: { message: `orden ${c.args.p_orden_id} no existe` } };
        base.rpcs.push({ orden: c.args.p_orden_id, item: c.args.p_item_id, delta: c.args.p_delta });
        const existe = o.items.some((i) => i.id === c.args.p_item_id);
        if (existe) {
          o.items = o.items.map((i) => (i.id === c.args.p_item_id ? { ...i, qty: Math.max(0, i.qty + c.args.p_delta) } : i)).filter((i) => i.qty > 0);
        } else if (c.args.p_delta > 0) {
          o.items = [...o.items, { id: c.args.p_item_id, nombre: c.args.p_nombre, precio: c.args.p_precio, qty: c.args.p_delta, nota: c.args.p_nota || '' }];
        }
        o.total = total(o.items);
        o.version = (o.version || 0) + 1;
        return { data: o, error: null };
      }
      return { data: null, error: null };
    }
    const mapa = base[c.tabla];
    if (!(mapa instanceof Map)) return undefined;
    if (base.fallos.has(`${c.op}:${c.tabla}`)) return { data: null, error: { message: `fallo inyectado en ${c.op} ${c.tabla}` } };

    if (c.op === 'select') {
      let filas = [...mapa.values()].map((f) => ({ ...f }));
      for (const [col, val, tipo] of c.filtros) filas = filas.filter((f) => (tipo === 'in' ? val.includes(f[col]) : f[col] === val));
      return { data: c.unico ? (filas[0] ?? null) : filas, error: null };
    }
    if (c.op === 'upsert' || c.op === 'insert') {
      for (const fila of aLista(c.cuerpo)) {
        const previa = mapa.get(fila.id);
        if (previa && c.opciones?.ignoreDuplicates) continue;
        const nueva = { ...(previa || (c.tabla === 'ordenes' ? { version: 0 } : {})), ...fila };
        if (c.tabla === 'ordenes' && nueva.estado === 'abierta'
          && [...mapa.values()].some((o) => o.id !== nueva.id && o.mesa_id === nueva.mesa_id && o.estado === 'abierta')) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ux_ordenes_una_abierta_por_mesa"' } };
        }
        mapa.set(nueva.id, nueva);
      }
      return { data: null, error: null };
    }
    if (c.op === 'delete') {
      for (const [col, val, tipo] of c.filtros) {
        for (const [id, f] of [...mapa]) if (tipo === 'in' ? val.includes(f[col]) : f[col] === val) mapa.delete(id);
      }
      return { data: null, error: null };
    }
    if (c.op === 'update') {
      const tocadas = [];
      for (const f of mapa.values()) {
        if (c.filtros.every(([col, val, tipo]) => (tipo === 'in' ? val.includes(f[col]) : f[col] === val))) { Object.assign(f, c.cuerpo); tocadas.push({ id: f.id }); }
      }
      return { data: c.retorno ? tocadas : null, error: null };
    }
    return undefined;
  };
  return base;
}

// ───────────────────────── el store `pos` en un vm ─────────────────────────

/**
 * Un store `pos` recién creado, con sus dependencias simuladas. `base` (de crearBaseFalsa) o
 * `responder` deciden qué contesta Supabase. `almacen` (un Map) deja compartir el localStorage entre
 * dos stores: así se simula recargar la página.
 */
export function crearPos({ responder, base, almacen = new Map() } = {}) {
  const supabase = crearSupabase({ responder: base ? base.responder : responder });
  const avisos = [];
  const confirmaciones = [];
  const consola = [];
  const manejadores = {};
  const tiendas = {};
  const estado = { confirmar: true };
  const caja = {
    console: { log() {}, info() {}, debug() {}, warn: (...a) => consola.push(['warn', ...a]), error: (...a) => consola.push(['error', ...a]) },
    setTimeout, clearTimeout, setInterval() {}, clearInterval() {},
    crypto: globalThis.crypto,
    URL, URLSearchParams, Date, Math, JSON, Promise, Array, Object, Set, Map,
    localStorage: {
      getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => { almacen.set(k, String(v)); },
      removeItem: (k) => { almacen.delete(k); },
    },
    confirm: (m) => { confirmaciones.push(String(m)); return estado.confirmar; },
    alert: (m) => { avisos.push(String(m)); },
    prompt() { return null; },
    navigator: {},
    location: { origin: 'https://resplandor.ynt.codes', search: '', hash: '', pathname: '/pos.html' },
    history: { replaceState() {} },
    document: { addEventListener: (nombre, fn) => { manejadores[nombre] = fn; } },
    Alpine: { store: (nombre, obj) => { if (obj) tiendas[nombre] = obj; return tiendas[nombre]; } },
  };
  caja.window = caja;
  caja.globalThis = caja;
  caja.window.supabase = { createClient: () => supabase.cliente };
  const eventosVentana = {};
  caja.window.addEventListener = (nombre, fn) => { eventosVentana[nombre] = fn; };
  vm.createContext(caja);
  vm.runInContext(scriptDelStore(), caja, { filename: 'pos.html (script del store)' });
  assert.equal(typeof manejadores['alpine:init'], 'function', 'el script debe registrar su store en alpine:init');
  manejadores['alpine:init']();
  const pos = tiendas.pos;
  assert.ok(pos, 'alpine:init no registró el store «pos»');
  return {
    pos, supabase, almacen, avisos, confirmaciones, consola, eventosVentana,
    cancelarConfirmaciones() { estado.confirmar = false; },
    guardado: (clave) => JSON.parse(almacen.get(clave)),
  };
}

// ───────────────────────── filas de ejemplo ─────────────────────────

export const TOKEN = 'a'.repeat(48);
export const item = (id, precio, qty = 1) => ({ id, nombre: id, precio, qty, nota: '' });
/** Una fila de `mesas` como la devuelve la base. */
export const mesaBase = (id = 3, extra = {}) => ({ id, capacidad: 4, estado: 'ocupada', token: TOKEN, updated_at: '2026-09-30T00:00:00Z', ...extra });
/** Una fila de `ordenes` como la devuelve la base. */
export const ordenBase = (id, mesaId, items, version = 1, estado = 'abierta') => ({
  id, mesa_id: mesaId, estado, items, total: items.reduce((s, i) => s + i.precio * i.qty, 0),
  abierta_en: '2026-09-30T18:00:00Z', cerrada_en: estado === 'cerrada' ? new Date().toISOString() : null, version,
});
/** Una orden como la guarda el POS en local (camelCase). */
export const ordenLocal = (id, mesaId, items, version = 1, estado = 'abierta') => ({
  id, mesaId, estado, items, total: items.reduce((s, i) => s + i.precio * i.qty, 0),
  abiertaEn: '2026-09-30T18:00:00Z', cerradaEn: estado === 'cerrada' ? new Date().toISOString() : null, version,
});
export const delta = (orden, itemId, d, precio = 4000) => ({ orden_id: orden, item_id: itemId, nombre: itemId, precio, nota: '', delta: d });
