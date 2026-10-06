// Cuenta en mesa, parte 1D «pos-logica-base» (docs/sdd-cuenta-en-mesa.md §04.8 y §08, fase 1):
// los arreglos de LÓGICA de pos.html que la cuenta en vivo necesita, todos dentro del <script>.
//
//   1. `pushASupabase('mesas')` sube solo {id, capacidad, estado}, nunca `token`. Hoy subía la
//      fila local completa, y una tablet con la caché vieja deshacía una rotación del token al
//      abrir, liberar o facturar cualquier mesa (SDD §04.8, prueba S-8).
//   2. `rotarTokenMesa` hace `update({token}).eq('id', …)` con `await` y revisa `error` (y que
//      la base tocara UNA fila). Antes, `.catch(()=>{})` se tragaba el fallo. Si falla, el token
//      local no cambia y se avisa; si sale bien, se avisa que hay que reescribir la pegatina.
//   3. `pos_sync` tiene callback de `subscribe`: en cada SUBSCRIBED (el primero y los de después
//      de una caída) vuelve a leer lo que ese canal escucha, sin `cierres` (egress, §07).
//
// Cómo se prueba: el <script> REAL de pos.html se ejecuta en un `vm` con `Alpine.store`,
// `supabase`, `localStorage`, `confirm` y `alert` simulados (el patrón de funciones.test.mjs), y
// se llama al store como lo haría el navegador. Más unas comprobaciones estáticas del texto de
// las tres funciones, para que una refactorización que cambie el espíritu no pase en silencio.
// Estas pruebas FALLAN si se quita lo implementado (los mutantes están en el reporte de la
// parte). Necesita Node ≥ 20 (usa `crypto` global, como el navegador).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');

const TOKEN_VIEJO = 'a'.repeat(48);
const plano = (x) => JSON.parse(JSON.stringify(x)); // trae a este realm lo que salió del `vm`
const soltar = () => new Promise((r) => setImmediate(r)); // deja correr lo que no se espera (push sin await)

// ───────────────────────── arnés: el <script> real de pos.html en un vm ─────────────────────────

/** El <script> inline que define el store `pos` (el otro solo pinta iconos). */
function scriptDelStore() {
  const bloques = [...POS.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const codigo = bloques.find((t) => t.includes("Alpine.store('pos'"));
  assert.ok(codigo, "no encontré el <script> de pos.html que define Alpine.store('pos', …)");
  return codigo;
}

/**
 * Un cliente de Supabase de mentira que apunta todo lo que le piden. `responder(llamada)` decide
 * qué contesta (por defecto: listas vacías y sin error); puede devolver una promesa para dejar una
 * lectura «en vuelo». Cada llamada ejecutada queda en `llamadas` con su tabla, operación, cuerpo y
 * filtros: es lo que las pruebas comparan.
 */
function crearSupabase({ responder = () => undefined } = {}) {
  const llamadas = [];
  const canales = [];
  const enVuelo = { ahora: 0, maximo: 0 };
  const porDefecto = (c) => (c.op === 'select' && !c.retorno ? { data: [], error: null }
    : c.retorno ? { data: [], error: null } : { data: null, error: null });

  function constructor(tabla) {
    const c = { tipo: 'from', tabla, op: 'select', cuerpo: undefined, filtros: [], retorno: null };
    const b = {
      select(columnas) { if (c.op === 'select') c.columnas = columnas; else c.retorno = columnas; return b; },
      order() { return b; },
      limit(n) { c.limite = n; return b; },
      eq(col, val) { c.filtros.push([col, val]); return b; },
      upsert(cuerpo) { c.op = 'upsert'; c.cuerpo = cuerpo; return b; },
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
    canal: (nombre) => canales.find((c) => c.nombre === nombre),
  };
}

/** Un store `pos` recién creado, con sus dependencias simuladas. */
function crearPos({ responder } = {}) {
  const supabase = crearSupabase({ responder });
  const almacen = new Map();
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
  caja.window.addEventListener = () => {};
  vm.createContext(caja);
  vm.runInContext(scriptDelStore(), caja, { filename: 'pos.html (script del store)' });
  assert.equal(typeof manejadores['alpine:init'], 'function', 'el script debe registrar su store en alpine:init');
  manejadores['alpine:init']();
  const pos = tiendas.pos;
  assert.ok(pos, 'alpine:init no registró el store «pos»');
  return {
    pos, supabase, almacen, avisos, confirmaciones, consola,
    cancelarConfirmaciones() { estado.confirmar = false; },
    guardado: (clave) => JSON.parse(almacen.get(clave)),
  };
}

const mesaLocal = (id = 3, extra = {}) => ({ id, capacidad: 4, estado: 'ocupada', token: TOKEN_VIEJO, updated_at: '2026-09-30T00:00:00Z', ...extra });
const ordenRemota = (id, mesaId, items, version = 1) => ({
  id, mesa_id: mesaId, estado: 'abierta', items, total: items.reduce((s, i) => s + i.precio * i.qty, 0),
  abierta_en: '2026-09-30T18:00:00Z', cerrada_en: null, version,
});
const item = (id, precio, qty = 1) => ({ id, nombre: id, precio, qty, nota: '' });

// ───────────────────────── 1. pushASupabase('mesas') no manda el token ─────────────────────────

test('pushASupabase(\'mesas\') sube solo {id, capacidad, estado}: ni token ni updated_at', async () => {
  const { pos, supabase } = crearPos();
  await pos.pushASupabase('mesas', mesaLocal());
  const subidas = supabase.de('mesas', 'upsert');
  assert.equal(subidas.length, 1);
  assert.deepEqual(plano(subidas[0].cuerpo), { id: 3, capacidad: 4, estado: 'ocupada' });
});

test('ningún camino del POS que sube una mesa lleva el token: abrir, facturar, liberar vacía y reabrir', async () => {
  const { pos, supabase } = crearPos();
  // Una tablet con la caché vieja: todas sus mesas traen el token ANTERIOR a una rotación.
  pos.mesas = [mesaLocal(1, { estado: 'libre' }), mesaLocal(2), mesaLocal(4), mesaLocal(5, { estado: 'libre' })];

  // abrir una mesa libre
  await pos.abrirMesa(pos.mesas[0]);
  // facturar una orden con ítems
  const conItems = { id: 'o-fact', mesaId: 2, estado: 'abierta', items: [item('p1', 5000)], total: 5000, abiertaEn: 'x', cerradaEn: null };
  pos.ordenes.push(conItems);
  pos.mesaActiva = pos.mesas[1]; pos.ordenActiva = conItems;
  await pos.facturar();   // con red lee primero la cuenta de la base (sexta refutación): se espera a que cierre
  // liberar una mesa sin ítems
  const vacia = { id: 'o-vacia', mesaId: 4, estado: 'abierta', items: [], total: 0, abiertaEn: 'x', cerradaEn: null };
  pos.ordenes.push(vacia);
  pos.mesaActiva = pos.mesas[2]; pos.ordenActiva = vacia;
  pos.liberarMesaVacia();
  // reabrir una cuenta cerrada
  const cerrada = { id: 'o-cerrada', mesaId: 5, estado: 'cerrada', items: [item('p2', 7000)], total: 7000, abiertaEn: 'x', cerradaEn: 'y' };
  await pos.reabrirOrden(cerrada, 5);
  await soltar();

  const subidas = supabase.de('mesas', 'upsert');
  assert.ok(subidas.length >= 4, `se esperaban al menos 4 subidas de mesas (abrir, facturar, liberar, reabrir) y hubo ${subidas.length}`);
  for (const s of subidas) {
    assert.deepEqual(Object.keys(s.cuerpo).sort(), ['capacidad', 'estado', 'id'], 'solo id, capacidad y estado');
  }
});

// ───────────────────────── 2. rotarTokenMesa ─────────────────────────

/** Un POS parado en la mesa 3, con la fila de la mesa en la lista y en la caché. */
function posEnMesa3(opciones) {
  const t = crearPos(opciones);
  t.pos.mesas = [mesaLocal(2), mesaLocal(3)];
  t.pos.mesaActiva = t.pos.mesas[1];
  t.pos.guardarCachéLocal('mesas');
  return t;
}
const respondeUnaFila = (c) => (c.tabla === 'mesas' && c.op === 'update' ? { data: [{ id: c.filtros[0][1] }], error: null } : undefined);

test('rotarTokenMesa: update({token}).eq(id) con await; con una fila tocada cambia el token local, lo guarda y manda reescribir la pegatina', async () => {
  const t = posEnMesa3({ responder: respondeUnaFila });
  const rotó = await t.pos.rotarTokenMesa();

  assert.equal(rotó, true);
  const updates = t.supabase.de('mesas', 'update');
  assert.equal(updates.length, 1, 'un único update');
  assert.deepEqual(Object.keys(updates[0].cuerpo), ['token'], 'el update lleva solo el token');
  assert.match(updates[0].cuerpo.token, /^[0-9a-f]{48}$/, '24 bytes en hex, como antes (el validador de `cuenta` pide 32-64 hex)');
  assert.notEqual(updates[0].cuerpo.token, TOKEN_VIEJO);
  assert.deepEqual(plano(updates[0].filtros), [['id', 3]], 'sobre la mesa 3 y solo esa');
  assert.equal(t.supabase.de('mesas', 'upsert').length, 0, 'ya no pasa por el upsert de mesas');
  // el token nuevo es el que ve el panel «Enlace NFC» y el que queda en la caché
  assert.equal(t.pos.mesaActiva.token, updates[0].cuerpo.token);
  assert.match(t.pos.enlaceMesa(), new RegExp(`carta\\.html\\?m=3&k=${updates[0].cuerpo.token}$`));
  assert.equal(t.guardado('pos_mesas').find((m) => m.id === 3).token, updates[0].cuerpo.token);
  assert.equal(t.guardado('pos_mesas').find((m) => m.id === 2).token, TOKEN_VIEJO, 'las otras mesas no se tocan');
  assert.equal(t.avisos.length, 1);
  assert.match(t.avisos[0], /Reescribe la pegatina con la contraseña/);
});

test('rotarTokenMesa: si la base responde error, el token local NO cambia, se avisa y no se dice que rotó', async () => {
  const t = posEnMesa3({ responder: (c) => (c.op === 'update' ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : undefined) });
  const rotó = await t.pos.rotarTokenMesa();

  assert.equal(rotó, false);
  assert.equal(t.pos.mesaActiva.token, TOKEN_VIEJO);
  assert.equal(t.pos.mesas.find((m) => m.id === 3).token, TOKEN_VIEJO);
  assert.equal(t.guardado('pos_mesas').find((m) => m.id === 3).token, TOKEN_VIEJO, 'la caché tampoco cambia');
  assert.equal(t.avisos.length, 1);
  assert.match(t.avisos[0], /No se pudo rotar el enlace de la mesa 3/);
  assert.doesNotMatch(t.avisos[0], /Reescribe la pegatina/);
  assert.ok(t.consola.some(([nivel]) => nivel === 'error'), 'el fallo queda en la consola');
});

test('rotarTokenMesa: sin error pero sin fila actualizada (RLS, mesa borrada) tampoco es éxito', async () => {
  for (const data of [[], null]) {
    const t = posEnMesa3({ responder: (c) => (c.op === 'update' ? { data, error: null } : undefined) });
    assert.equal(await t.pos.rotarTokenMesa(), false);
    assert.equal(t.pos.mesaActiva.token, TOKEN_VIEJO);
    assert.match(t.avisos[0], /No se pudo rotar/);
  }
});

test('rotarTokenMesa: con remoto === \'offline\' no se queda callada (pushASupabase la habría descartado): lo intenta y avisa si falla', async () => {
  const t = posEnMesa3({ responder: (c) => (c.op === 'update' ? { data: null, error: { message: 'sin red' } } : undefined) });
  t.pos.remoto = 'offline';
  assert.equal(await t.pos.rotarTokenMesa(), false);
  assert.equal(t.supabase.de('mesas', 'update').length, 1, 'el update se intentó aunque la tablet crea que está offline');
  assert.match(t.avisos[0], /No se pudo rotar/);
});

test('rotarTokenMesa: si la persona cancela la confirmación, no hay ninguna llamada ni aviso', async () => {
  const t = posEnMesa3({ responder: respondeUnaFila });
  t.cancelarConfirmaciones();
  assert.equal(await t.pos.rotarTokenMesa(), false);
  assert.equal(t.confirmaciones.length, 1);
  assert.equal(t.supabase.llamadas.length, 0);
  assert.equal(t.avisos.length, 0);
  assert.equal(t.pos.mesaActiva.token, TOKEN_VIEJO);
});

test('rotarTokenMesa: sin mesa activa no hace nada; con una rotación en vuelo, un segundo toque no lanza otra', async () => {
  const sin = crearPos({ responder: respondeUnaFila });
  assert.equal(await sin.pos.rotarTokenMesa(), false);
  assert.equal(sin.confirmaciones.length, 0);

  let soltarUpdate;
  const t = posEnMesa3({ responder: (c) => (c.op === 'update' ? new Promise((r) => { soltarUpdate = () => r({ data: [{ id: 3 }], error: null }); }) : undefined) });
  const primera = t.pos.rotarTokenMesa();
  await soltar();
  const segunda = t.pos.rotarTokenMesa();
  await soltar();
  // Se mira ANTES de esperar nada: sin la guarda, la segunda queda colgada de su propio update.
  assert.equal(t.confirmaciones.length, 1, 'el segundo toque, con el primero en vuelo, ni siquiera vuelve a preguntar');
  assert.equal(t.supabase.de('mesas', 'update').length, 1, 'y no lanza otro update');
  soltarUpdate();
  assert.equal(await primera, true);
  assert.equal(await segunda, false);
});

test('rotar y luego otro camino que sube la mesa (tablet B con caché vieja) NO deshace la rotación: el upsert no lleva token', async () => {
  // Tablet A rota. Tablet B sigue con el token anterior en su caché y factura otra cosa.
  const t = posEnMesa3({ responder: respondeUnaFila });
  await t.pos.rotarTokenMesa();
  const nuevo = t.supabase.de('mesas', 'update')[0].cuerpo.token;

  const b = crearPos();
  b.pos.mesas = [mesaLocal(3)]; // la caché vieja de B
  await b.pos.pushASupabase('mesas', b.pos.mesas[0]);
  assert.ok(!('token' in b.supabase.de('mesas', 'upsert')[0].cuerpo));
  assert.notEqual(nuevo, TOKEN_VIEJO);
});

test('un eco de Realtime con el token nuevo (rotó otra tablet) llega también a la mesa que esta tablet tiene abierta', () => {
  const { pos } = crearPos();
  pos.mesas = [mesaLocal(3)];
  pos.mesaActiva = pos.mesas[0];
  const nuevo = 'b'.repeat(48);
  pos.procesarCambioEnVivo('mesas', { eventType: 'UPDATE', new: mesaLocal(3, { token: nuevo }), old: {} });
  assert.equal(pos.mesas[0].token, nuevo);
  assert.equal(pos.mesaActiva.token, nuevo, 'el panel «Enlace NFC» no se queda con el objeto reemplazado');
  assert.match(pos.enlaceMesa(), new RegExp(`k=${nuevo}$`));
});

// ───────────────────────── 3. pos_sync: resincronización al (re)conectar ─────────────────────────

const LECTURAS_EN_VIVO = ['mesas', 'ordenes', 'productos'];
// (los sondeos de columnas de `_sondearBase` —una lectura de cero filas, `limit(0)`— no son lecturas de datos: no cuentan)
const tablasLeidas = (supabase) => supabase.llamadas.filter((c) => c.tipo === 'from' && c.op === 'select' && c.limite !== 0).map((c) => c.tabla);
const SONDEOS = 3;   // parcial_de, deltas_ids y servida_en (cronometro-mesa), en paralelo con la primera lectura

test('pos_sync: escuchar mesas, órdenes y productos, con un callback en subscribe', () => {
  const { pos, supabase } = crearPos();
  pos.escucharEventosRealtime();
  const canal = supabase.canal('pos_sync');
  assert.ok(canal, 'el canal pos_sync existe');
  assert.deepEqual(canal.eventos.map((e) => e.filtro.table), ['mesas', 'ordenes', 'productos']);
  assert.equal(typeof canal.suscripcion, 'function', 'subscribe lleva callback (antes: subscribe() a secas)');
});

test('pos_sync: cada SUBSCRIBED vuelve a leer mesas, órdenes y productos, y NUNCA cierres; los demás estados no leen', async () => {
  const { pos, supabase } = crearPos();
  pos.escucharEventosRealtime();
  const avisar = supabase.canal('pos_sync').suscripcion;

  avisar('SUBSCRIBED'); await soltar(); await soltar();
  assert.deepEqual(tablasLeidas(supabase).sort(), [...LECTURAS_EN_VIVO].sort(), 'el primer SUBSCRIBED cierra el hueco entre la carga inicial y la unión al canal');

  for (const caido of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) { avisar(caido); await soltar(); }
  assert.equal(tablasLeidas(supabase).length, 3, 'una caída por sí sola no lee nada: no hay red para leer');

  avisar('SUBSCRIBED'); await soltar(); await soltar();
  assert.deepEqual(tablasLeidas(supabase).sort(), [...LECTURAS_EN_VIVO, ...LECTURAS_EN_VIVO].sort(), 'al reconectar, otra lectura');
  assert.ok(!tablasLeidas(supabase).includes('cierres'), 'cierres no pasa por Realtime y es lo más pesado: no se vuelve a bajar');
});

test('la carga inicial (sincronizarSupabase sin argumentos) sigue trayendo también los cierres', async () => {
  const { pos, supabase } = crearPos();
  await pos.sincronizarSupabase();
  assert.deepEqual(tablasLeidas(supabase).sort(), ['cierres', 'mesas', 'ordenes', 'productos']);
});

test('al resincronizar, la orden que se está viendo apunta a la fila nueva (el total y la pantalla leen ordenActiva)', async () => {
  const filaNueva = ordenRemota('o1', 3, [item('p1', 5000), item('p2', 7000)], 4);
  const { pos } = crearPos({
    responder: (c) => (c.op === 'select' && c.tabla === 'ordenes' ? { data: [filaNueva], error: null }
      : c.op === 'select' && c.tabla === 'mesas' ? { data: [mesaLocal(3, { token: 'c'.repeat(48) })], error: null } : undefined),
  });
  pos.mesas = [mesaLocal(3)];
  pos.ordenes = [{ id: 'o1', mesaId: 3, estado: 'abierta', items: [item('p1', 5000)], total: 5000, version: 1 }];
  pos.mesaActiva = pos.mesas[0];
  pos.ordenActiva = pos.ordenes[0];
  assert.equal(pos.totalOrdenActiva, 5000);

  await pos.sincronizarSupabase({ soloEnVivo: true });

  assert.equal(pos.ordenActiva, pos.ordenes.find((o) => o.id === 'o1'), 'ordenActiva es el objeto de la lista, no el viejo');
  assert.equal(pos.totalOrdenActiva, 12000, 'el total que cobra facturar() sale de la fila nueva');
  assert.equal(pos.mesaActiva, pos.mesas.find((m) => m.id === 3));
  assert.equal(pos.mesaActiva.token, 'c'.repeat(48), 'y el panel del enlace ve el token que tiene la base');
});

test('al resincronizar, una orden con deltas todavía en cola conserva lo que el mesero ya vio; las demás se pisan con la base', async () => {
  const { pos, supabase } = crearPos({
    responder: (c) => {
      if (c.op === 'select' && c.tabla === 'ordenes') {
        return { data: [ordenRemota('o1', 3, [item('p1', 5000)], 2), ordenRemota('o2', 4, [item('q1', 9000)], 5)], error: null };
      }
      return undefined;
    },
  });
  // o1: el mesero agregó p2 sin red (el delta quedó en cola). o2: la base tiene más que la caché.
  pos.ordenes = [
    { id: 'o1', mesaId: 3, estado: 'abierta', items: [item('p1', 5000), item('p2', 7000)], total: 12000, version: 1 },
    { id: 'o2', mesaId: 4, estado: 'abierta', items: [], total: 0, version: 1 },
  ];
  pos.colaDeltas = [{ orden_id: 'o1', item_id: 'p2', nombre: 'p2', precio: 7000, nota: '', delta: 1 }];

  await pos.sincronizarSupabase({ soloEnVivo: true });

  const o1 = pos.ordenes.find((o) => o.id === 'o1');
  assert.deepEqual(o1.items.map((i) => i.id), ['p1', 'p2'], 'no desaparece el ítem que espera su delta');
  assert.deepEqual(pos.ordenes.find((o) => o.id === 'o2').items.map((i) => i.id), ['q1'], 'la otra orden sí toma lo de la base');
  // y la reconexión reintenta los deltas (flushDeltas al final de sincronizarSupabase)
  await soltar();
  assert.ok(supabase.llamadas.some((c) => c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden' && c.args.p_orden_id === 'o1'));
  assert.equal(pos.colaDeltas.length, 0);
});

test('una lectura que falla no pisa lo que la tablet ya tenía ni lanza', async () => {
  const { pos } = crearPos({ responder: (c) => (c.op === 'select' ? { data: null, error: { message: 'Failed to fetch' } } : undefined) });
  pos.mesas = [mesaLocal(3)];
  pos.ordenes = [{ id: 'o1', mesaId: 3, estado: 'abierta', items: [item('p1', 5000)], total: 5000, version: 1 }];
  pos.productos = [{ id: 'p1', cat: 'X', nombre: 'p1', precio: 5000, desc: '', activo: true }];
  await pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(pos.mesas.length, 1);
  assert.equal(pos.ordenes.length, 1);
  assert.equal(pos.productos.length, 1);
});

test('pos_sync: una sola lectura de reconexión a la vez; si el canal vuelve durante una, se repite UNA vez (no en paralelo, no se pierde)', async () => {
  let soltarLectura;
  let primeraLectura = true;
  const { pos, supabase } = crearPos({
    responder: (c) => {
      if (c.op === 'select' && c.tabla === 'mesas' && primeraLectura) {
        primeraLectura = false;
        return new Promise((r) => { soltarLectura = () => r({ data: [], error: null }); });
      }
      return undefined;
    },
  });
  pos.escucharEventosRealtime();
  const avisar = supabase.canal('pos_sync').suscripcion;

  avisar('SUBSCRIBED');                  // arranca la lectura 1, que queda en vuelo
  await soltar();
  avisar('SUBSCRIBED'); avisar('SUBSCRIBED'); // el canal se reune dos veces mientras tanto
  await soltar();
  assert.equal(tablasLeidas(supabase).filter((t) => t === 'mesas').length, 1, 'mientras la 1 sigue en vuelo no sale otra');

  soltarLectura();
  for (let i = 0; i < 6; i++) await soltar();
  assert.equal(tablasLeidas(supabase).filter((t) => t === 'mesas').length, 2, 'una repetición, no una por cada aviso');
  assert.ok(supabase.enVuelo.maximo <= LECTURAS_EN_VIVO.length + SONDEOS, 'nunca dos rondas de lecturas en paralelo (las tres lecturas y, la primera vez, los tres sondeos de columnas)');
  assert.equal(pos._resincronizando, false, 'termina libre para la próxima reconexión');
});

// ───────────────────────── 4. estáticas: el texto de las tres funciones ─────────────────────────

test('estático: formatMesa solo conoce id, capacidad y estado; pushASupabase lo usa para \'mesas\'', () => {
  const { pos } = crearPos();
  const formatMesa = pos.formatMesa.toString();
  assert.doesNotMatch(formatMesa.replace(/\/\/.*$/gm, ''), /token/);
  assert.match(pos.pushASupabase.toString(), /tabla === 'mesas'\) formatPayload = this\.formatMesa\(payload\)/);
});

test('estático: rotarTokenMesa usa update + await + error, y ya no usa pushASupabase ni se traga errores con .catch(()=>{})', () => {
  const { pos } = crearPos();
  const f = pos.rotarTokenMesa.toString().replace(/\/\/.*$/gm, '');
  assert.match(f, /^async /, 'es async para poder esperar a la base');
  assert.match(f, /await supabaseClient\.from\('mesas'\)\.update\(\{ token \}\)\.eq\('id', id\)/);
  assert.match(f, /if \(error\) throw error/);
  assert.doesNotMatch(f, /pushASupabase/);
  assert.doesNotMatch(f, /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
  assert.match(f, /Reescribe la pegatina con la contraseña/);
});

test('estático: pos_sync se suscribe con un callback que atiende SUBSCRIBED', () => {
  const { pos } = crearPos();
  const f = pos.escucharEventosRealtime.toString();
  assert.doesNotMatch(f, /\.subscribe\(\s*\)/, 'subscribe() a secas es lo que había');
  assert.match(f, /\.subscribe\(\s*estado\s*=>/);
  assert.match(f, /SUBSCRIBED/);
});

// ───────────────────────── 5. D17: presencia del POS en un canal privado ─────────────────────────
// (Commit aparte y separable: si Yonatan responde «no» a D17, se revierte ese commit y desaparece
// esta sección, el cambio de iniciarPresencia y la migración 20261001130000.)

const MIGRACION_PRESENCIA = 'supabase/migrations/20261001130000_presencia_privada.sql';
const sinComentariosSql = (sql) => sql.replace(/--.*$/gm, '');

test('D17: iniciarPresencia abre presencia_pos como canal privado, con la llave de presencia del dispositivo', () => {
  const { pos, supabase } = crearPos();
  pos.iniciarPresencia();
  const canal = supabase.canal('presencia_pos');
  assert.ok(canal, 'el canal presencia_pos existe');
  assert.deepEqual(plano(canal.config), { config: { private: true, presence: { key: pos.deviceId } } });
  assert.deepEqual(canal.eventos.map((e) => `${e.tipo}:${e.filtro.event}`), ['presence:sync']);
});

test('D17: con SUBSCRIBED publica la presencia; con CHANNEL_ERROR deja un aviso en la consola que nombra la migración, y no rompe', () => {
  const { pos, supabase, consola } = crearPos();
  pos.iniciarPresencia();
  const canal = supabase.canal('presencia_pos');
  canal.suscripcion('SUBSCRIBED');
  assert.equal(canal.rastreos.length, 1);
  assert.equal(canal.rastreos[0].deviceId, pos.deviceId);
  canal.suscripcion('CHANNEL_ERROR', new Error('no autorizado'));
  const avisos = consola.filter(([nivel, msg]) => nivel === 'warn' && /20261001130000_presencia_privada\.sql/.test(msg));
  assert.equal(avisos.length, 1);
  assert.equal(canal.rastreos.length, 1, 'un error del canal no publica presencia');
});

test('D17: pos_sync NO pasa a privado (otro mecanismo, no usa realtime.messages; eso es fase 3, R5)', () => {
  const { pos, supabase } = crearPos();
  pos.escucharEventosRealtime();
  assert.equal(supabase.canal('pos_sync').config, undefined);
});

test('D17 migración: dos policies sobre realtime.messages, solo para authenticated, solo presencia_pos, solo presencia y solo Google', () => {
  const sql = sinComentariosSql(fs.readFileSync(path.join(RAIZ, MIGRACION_PRESENCIA), 'utf8'));
  const policies = [...sql.matchAll(/create policy\s+"([^"]+)"\s+on\s+([\w.]+)([\s\S]*?);/gi)];
  assert.equal(policies.length, 2, 'una de select (escuchar) y una de insert (publicar)');
  const porComando = Object.fromEntries(policies.map((p) => [(p[3].match(/for\s+(\w+)/i) || [])[1]?.toLowerCase(), p]));
  assert.deepEqual(Object.keys(porComando).sort(), ['insert', 'select']);
  for (const [nombre, tabla, cuerpo] of policies.map((p) => [p[1], p[2], p[3]])) {
    assert.equal(tabla, 'realtime.messages', `${nombre}: sobre realtime.messages`);
    assert.match(cuerpo, /\bto\s+authenticated\b/i, `${nombre}: solo authenticated`);
    assert.doesNotMatch(cuerpo, /\bto\s+(anon|public)\b|\bfor\s+all\b/i, `${nombre}: ni anon ni public ni «for all»`);
    assert.match(cuerpo, /realtime\.messages\.extension\s*=\s*'presence'/, `${nombre}: solo presencia`);
    assert.match(cuerpo, /\(select realtime\.topic\(\)\)\s*=\s*'presencia_pos'/, `${nombre}: solo el tópico presencia_pos`);
    assert.match(cuerpo, /app_metadata'\s*->>\s*'provider'\)\s*=\s*'google'/, `${nombre}: solo sesiones de Google`);
  }
  assert.match(porComando.select[3], /\busing\s*\(/i, 'escuchar es USING');
  assert.match(porComando.insert[3], /\bwith check\s*\(/i, 'publicar es WITH CHECK');
});

test('D17 migración: idempotente, sin GRANT, sin tocar RLS ni otros objetos, y con la reversa y el orden de aplicación escritos', () => {
  const crudo = fs.readFileSync(path.join(RAIZ, MIGRACION_PRESENCIA), 'utf8');
  const sql = sinComentariosSql(crudo);
  assert.equal([...sql.matchAll(/drop policy if exists/gi)].length, 2, 'cada policy se borra si existe antes de crearse');
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b|disable row level security|enable row level security|\bcreate (table|function|schema|trigger)\b|\balter\s/i);
  assert.doesNotMatch(sql, /cuenta:|pos_sync/, 'no toca la señal en vivo ni pos_sync');
  assert.match(crudo, /Reversa/);
  assert.match(crudo, /ANTES de publicar/);
  assert.match(crudo, /Línea Roja/);
  assert.doesNotMatch(sql, /\binsert\s+into\b/i, 'ningún dato');
});
