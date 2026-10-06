// El cronómetro de la mesa y la marca «servida» (pedido de Yonatan, 2026-10-06, tareas/2026-10-06-cronometro-mesa.md):
//   «un cronómetro sutil para conocimiento de cuánto llevan esperando el pedido los de la mesa» y «también podrá decidir si fue atendido para que el
//   cronómetro no siga… se le llevó la comida y ahí ya no necesita contar, solo informativo».
//
// La LÓGICA del POS: corre el <script> REAL de pos.html en un `vm` (scripts/pruebas/_pos-vm.mjs) con un reloj falso (Date y setInterval espía) contra la base falsa.
//   1. El texto y el color: «ahora», «12 min», «1 h 05», «+24 h»; neutro hasta 20, ámbar de 20 a 40, coral desde 40; solo cuentas ABIERTAS con algo que servir; la hora, siempre en Bogotá.
//   2. El reloj: UN setInterval de 1 minuto, que se detiene con la pestaña oculta y se pone al día al volver, y que se apaga con la app.
//   3. Desde cuándo cuenta: abierta_en, salvo que esta tablet haya visto llegar el pedido (la cuenta se abrió vacía) o una tanda nueva a una mesa servida.
//   4. «Servida»: detección de la columna, el update directo (no el upsert), el cronómetro se detiene, otro toque lo quita, una tanda nueva la quita y empieza otra espera,
//      sin red queda pendiente (y sobrevive a recargar), el eco de otra tablet, la base sin la columna, el toque largo del mapa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asentar, crearBaseFalsa, crearPos, dormir, item, mesaBase, ordenBase, ordenLocal, plano, soltar } from './_pos-vm.mjs';

const T0 = Date.parse('2026-10-06T17:30:00Z');          // 12:30 p. m. en Bogotá
const MIN = 60000;
const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };

function montar({ mesas = [mesaBase(3)], ordenes = [], almacen, base: opcionesBase = {}, documento = {}, extras = {}, compartida = null, t0 = T0 } = {}) {
  const reloj = { t: t0 };
  class FechaFalsa extends Date {
    constructor(...a) { if (a.length === 0) super(reloj.t); else super(...a); }
    static now() { return reloj.t; }
  }
  const intervalos = []; const limpiados = [];
  const relojes = {
    intervalos, limpiados,
    setInterval: (fn, ms) => { const id = intervalos.length + 1; intervalos.push({ fn, ms, id }); return id; },
    clearInterval: (id) => { if (id != null) limpiados.push(id); },
  };
  const base = compartida || crearBaseFalsa({ rol: 'admin', mesas, ordenes, ...opcionesBase });   // `compartida`: la MISMA base para dos tablets
  const t = crearPos({ base, almacen, extras: { Date: FechaFalsa, setInterval: relojes.setInterval, clearInterval: relojes.clearInterval, ...extras }, documento: { visibilityState: 'visible', ...documento } });
  Object.assign(t, { base, reloj, relojes });
  t.pos.usuario = YO;
  t.pos.remoto = 'ok';
  t.pos.ahoraMesas = reloj.t;
  /** Avanza el reloj `ms` y corre el tick del reloj de 1 minuto (como el setInterval real). */
  t.avanzar = (ms) => { reloj.t += ms; t.pos.ahoraMesas = reloj.t; };
  return t;
}
/** Otra tablet contra la MISMA base (con su propio reloj: `t0`). */
const crearPosCon = (base, opciones = {}) => montar({ compartida: base, ...opciones });
const hace = (min, ahora = T0) => new Date(ahora - min * MIN).toISOString();
/** Una cuenta abierta en el store (y en la base) con `items`, abierta hace `min` minutos. */
function conCuenta(t, { id = 'o1', mesaId = 3, items = [item('p1', 20000, 2)], min = 12, extra = {} } = {}) {
  const fila = { ...ordenBase(id, mesaId, items, 1), abierta_en: hace(min) };
  t.base.ordenes.set(id, fila);
  const local = { ...ordenLocal(id, mesaId, items.map((i) => ({ ...i })), 1), abiertaEn: hace(min), ...extra };
  t.pos.mesas = t.pos.mesas.length ? t.pos.mesas : [mesaBase(mesaId)];
  t.pos.ordenes = [...t.pos.ordenes.filter((o) => o.id !== id), local];
  return t.pos.ordenes.find((o) => o.id === id);
}
const actualizaciones = (t) => t.supabase.de('ordenes', 'update');
const subidas = (t) => t.supabase.de('ordenes', 'upsert');
const servidaDeBase = (t, id = 'o1') => t.base.ordenes.get(id)?.servida_en ?? null;
const visibilidad = (t, estado) => { t.caja.document.visibilityState = estado; for (const f of t.oyentes.documento.visibilitychange || []) f(); };

// ═════════════════════════ 1. El texto y el color ═════════════════════════

test('solo cuentas ABIERTAS con algo que servir: la cerrada, la vacía, la que solo tiene «Para llevar» o un abono y la que no tiene hora no tienen chip', () => {
  const t = montar();
  const abierta = conCuenta(t);
  assert.ok(t.pos.esperaDe(abierta), 'abierta con ítems: sí');
  assert.equal(t.pos.esperaDe({ ...abierta, estado: 'cerrada' }), null, 'cerrada: nada');
  assert.equal(t.pos.esperaDe({ ...abierta, items: [] }), null, 'vacía: nada');
  assert.equal(t.pos.esperaDe({ ...abierta, items: [{ id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' }] }), null, 'solo el marcador de llevar: nada');
  assert.equal(t.pos.esperaDe({ ...abierta, items: [{ id: 'abono_recibido_x', nombre: 'Abono', precio: -5000, qty: 1, nota: 'efectivo' }] }), null, 'solo un abono: nada');
  assert.equal(t.pos.esperaDe({ ...abierta, items: [{ id: 'promo_3', nombre: 'Promo', precio: -4000, qty: 1, nota: '' }] }), null, 'solo un descuento: nada');
  assert.equal(t.pos.esperaDe({ ...abierta, abiertaEn: 'no es una hora' }), null, 'sin hora legible: nada');
  assert.equal(t.pos.esperaDe(null), null);
  assert.equal(t.pos.esperaMesa(3)?.ordenId, 'o1');
  assert.equal(t.pos.esperaMesa(7), null, 'una mesa sin cuenta: nada');
  assert.ok(t.pos.esperaDe({ ...abierta, items: [...abierta.items, { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: '' }] }), 'con ítems de verdad y el marcador: sí');
});

test('el texto: «ahora» bajo un minuto, «12 min», «1 h 05» desde la hora y «+24 h» pasado un día; sin segundos', () => {
  const t = montar();
  const o = conCuenta(t, { min: 0 });
  const dice = (ms) => { o.abiertaEn = new Date(T0 - ms).toISOString(); return plano(t.pos.esperaDe(o)); };
  const casos = [[0, 'ahora'], [30000, 'ahora'], [59999, 'ahora'], [MIN, '1 min'], [12 * MIN, '12 min'], [12 * MIN + 59999, '12 min'], [59 * MIN, '59 min'],
    [60 * MIN, '1 h 00'], [65 * MIN, '1 h 05'], [125 * MIN, '2 h 05'], [23 * 60 * MIN + 59 * MIN, '23 h 59'], [24 * 60 * MIN, '+24 h'], [50 * 60 * MIN, '+24 h']];
  for (const [ms, texto] of casos) assert.equal(dice(ms).texto, texto, `${ms / MIN} min`);
  assert.equal(dice(12 * MIN).cabecera, 'esperando 12 min');
  assert.equal(dice(0).cabecera, 'esperando ahora');
});

test('para lectores de pantalla: «Esperando 12 minutos», «1 minuto», «1 hora y 5 minutos», «2 horas», «menos de un minuto», «más de 24 horas»', () => {
  const t = montar();
  const o = conCuenta(t, { min: 0 });
  const sr = (min) => { o.abiertaEn = new Date(T0 - min * MIN).toISOString(); return t.pos.esperaDe(o).sr; };
  assert.equal(sr(12), 'Esperando 12 minutos');
  assert.equal(sr(1), 'Esperando 1 minuto');
  assert.equal(sr(0), 'Esperando menos de un minuto');
  assert.equal(sr(65), 'Esperando 1 hora y 5 minutos');
  assert.equal(sr(120), 'Esperando 2 horas');
  assert.equal(sr(121), 'Esperando 2 horas y 1 minuto');
  assert.equal(sr(60 * 30), 'Esperando más de 24 horas');
});

test('los colores: neutro hasta 20 min (19 sigue neutro), ámbar de 20 a 39, coral desde 40; las constantes se publican', () => {
  const t = montar();
  const o = conCuenta(t, { min: 0 });
  const nivel = (min) => { o.abiertaEn = new Date(T0 - min * MIN).toISOString(); return t.pos.esperaDe(o).nivel; };
  assert.deepEqual(plano(t.pos.esperaUmbrales), { ambar: 20, coral: 40 });
  for (const [min, esperado] of [[0, 'neutro'], [10, 'neutro'], [19, 'neutro'], [20, 'ambar'], [25, 'ambar'], [39, 'ambar'], [40, 'coral'], [41, 'coral'], [90, 'coral'], [24 * 60, 'coral']]) {
    assert.equal(nivel(min), esperado, `${min} min`);
  }
});

test('con el reloj del aparato ADELANTE o ATRÁS de abierta_en nunca sale un número negativo: «ahora»', () => {
  const t = montar();
  const o = conCuenta(t, { min: 0 });
  o.abiertaEn = new Date(T0 + 7 * MIN).toISOString();           // la hora del pedido va por delante del reloj de este aparato
  const e = plano(t.pos.esperaDe(o));
  assert.equal(e.texto, 'ahora');
  assert.equal(e.minutos, 0);
  assert.equal(e.nivel, 'neutro');
  assert.equal(e.cabecera, 'esperando ahora');
  assert.equal(e.sr, 'Esperando menos de un minuto');
});

test('la hora es siempre la de Bogotá (UTC−5): «Pedido tomado a las 12:24 p. m.», y cruza bien la medianoche; sin Intl con zonas cae a UTC−5', () => {
  const t = montar();
  const o = conCuenta(t, { min: 0 });
  const tomado = (iso) => { o.abiertaEn = iso; return t.pos.esperaDe(o).tomado; };
  assert.equal(tomado('2026-10-06T17:24:00Z'), 'Pedido tomado a las 12:24 p. m.');
  assert.equal(tomado('2026-10-06T05:00:00Z'), 'Pedido tomado a las 12:00 a. m.', 'medianoche de Bogotá');
  assert.equal(tomado('2026-10-06T04:59:00Z'), 'Pedido tomado a las 11:59 p. m.', 'un minuto antes, del día anterior');
  assert.equal(tomado('2026-10-06T17:00:00Z'), 'Pedido tomado a las 12:00 p. m.', 'mediodía');
  assert.equal(tomado('2026-10-06T13:05:00Z'), 'Pedido tomado a las 8:05 a. m.');
  assert.equal(tomado('2026-10-07T01:30:00-05:00'), 'Pedido tomado a las 1:30 a. m.', 'dicho con otro huso, sigue siendo la hora de Bogotá');
  // sin zonas: el mismo resultado con la cuenta a mano
  const sinZonas = montar({ extras: { Intl: { DateTimeFormat: class { constructor() { throw new Error('sin zonas'); } } } } });
  const o2 = conCuenta(sinZonas, { min: 0 });
  o2.abiertaEn = '2026-10-06T17:24:00Z';
  assert.equal(sinZonas.pos.esperaDe(o2).tomado, 'Pedido tomado a las 12:24 p. m.');
});

// ═════════════════════════ 2. El reloj de 1 minuto ═════════════════════════

test('UN solo setInterval de 1 minuto: arrancar dos veces no suma otro; cada tick pone el «ahora» y el chip cambia al minuto', () => {
  const t = montar();
  conCuenta(t, { min: 12 });
  t.pos._arrancarRelojMesas();
  t.pos._arrancarRelojMesas();
  assert.equal(t.relojes.intervalos.length, 1, 'un solo reloj');
  assert.equal(t.relojes.intervalos[0].ms, 60000);
  assert.equal(t.pos.esperaMesa(3).texto, '12 min');
  t.reloj.t += MIN; t.relojes.intervalos[0].fn();
  assert.equal(t.pos.ahoraMesas, t.reloj.t);
  assert.equal(t.pos.esperaMesa(3).texto, '13 min', 'al minuto cambia');
  t.reloj.t += 8 * MIN; t.relojes.intervalos[0].fn();
  assert.equal(t.pos.esperaMesa(3).texto, '21 min');
  assert.equal(t.pos.esperaMesa(3).nivel, 'ambar', 'y cruza el corte de color al llegar');
});

test('con la pestaña oculta el reloj se detiene; al volver se pone al día de una vez y arranca otro (nunca dos)', () => {
  const t = montar();
  conCuenta(t, { min: 12 });
  t.pos._arrancarRelojMesas();
  assert.equal(t.relojes.intervalos.length, 1);
  visibilidad(t, 'hidden');
  assert.deepEqual(t.relojes.limpiados, [1], 'se detuvo el reloj');
  t.reloj.t += 30 * MIN;                                          // la tablet durmió media hora
  assert.equal(t.pos.esperaMesa(3).texto, '12 min', 'oculta, nada se mueve');
  visibilidad(t, 'visible');
  assert.equal(t.pos.ahoraMesas, t.reloj.t, 'al volver se pone al día');
  assert.equal(t.pos.esperaMesa(3).texto, '42 min');
  assert.equal(t.relojes.intervalos.length, 2, 'y arranca UN reloj nuevo');
  visibilidad(t, 'visible');                                      // otro «visible» seguido no suma otro
  assert.equal(t.relojes.intervalos.length, 2);
});

test('arrancar con la pestaña oculta no enciende el reloj; salir de la app lo apaga para siempre (volver a la pestaña no lo revive)', () => {
  const oculta = montar({ documento: { visibilityState: 'hidden' } });
  oculta.pos._arrancarRelojMesas();
  assert.equal(oculta.relojes.intervalos.length, 0);
  visibilidad(oculta, 'visible');
  assert.equal(oculta.relojes.intervalos.length, 1, 'al verse, arranca');

  const t = montar();
  t.pos._arrancarRelojMesas();
  t.pos._detenerApp();
  assert.deepEqual(t.relojes.limpiados.includes(1), true, 'detener la app apaga el reloj');
  visibilidad(t, 'visible');
  assert.equal(t.relojes.intervalos.length, 1, 'ya no se enciende solo');
});

test('arrancarApp enciende el reloj y salir de la sesión lo apaga; el tick poda las esperas de cuentas que ya no están abiertas', async () => {
  const t = montar({ ordenes: [ordenBase('o1', 3, [item('p1', 20000, 2)], 1)] });
  await t.pos.arrancarApp();
  assert.equal(t.relojes.intervalos.filter((i) => i.ms === 60000).length, 1, 'arrancarApp enciende el reloj de 1 minuto');
  t.pos.pedidoEn = { o1: T0 - 5 * MIN, viejo: T0 - 9 * MIN };
  t.relojes.intervalos.find((i) => i.ms === 60000).fn();
  assert.deepEqual(plano(t.pos.pedidoEn), { o1: T0 - 5 * MIN }, 'la espera de una cuenta que ya no existe se poda');
  await t.pos.cerrarSesion();
  assert.ok(t.relojes.limpiados.length > 0, 'y al salir de la sesión se detiene');
});

// ═════════════════════════ 3. Desde cuándo cuenta ═════════════════════════

test('una cuenta abierta con ítems cuenta desde abierta_en; si esta tablet vio llegar el primer pedido (la cuenta se abrió vacía), desde ahí', async () => {
  const t = montar();
  await t.pos._sondearBase();
  const o = conCuenta(t, { items: [], min: 30 });                 // abierta hace 30 min, vacía
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = o;
  assert.equal(t.pos.esperaMesa(3), null, 'vacía: sin chip');
  t.avanzar(2 * MIN);
  t.pos.agregarProducto({ id: 'pz1', cat: 'X', nombre: 'Plato', precio: 20000, desc: '', activo: true });
  await asentar();
  assert.equal(t.pos.esperaMesa(3).texto, 'ahora', 'el pedido se tomó AHORA, no hace 32 minutos');
  assert.equal(t.pos.pedidoEn.o1, t.reloj.t);
  t.avanzar(5 * MIN);
  assert.equal(t.pos.esperaMesa(3).texto, '5 min');
  t.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Jugo', precio: 8000, desc: '', activo: true });
  t.avanzar(MIN);
  assert.equal(t.pos.esperaMesa(3).texto, '6 min', 'otro ítem a una espera que sigue NO la reinicia');
  assert.equal(t.pos.pedidoEn.o1, T0 + 2 * MIN, 'pedidoEn se quedó en el primero');
});

test('abrir la mesa en este aparato y agregar el primer ítem: la espera empieza con el ítem (no con la apertura)', async () => {
  const t = montar();
  await t.pos._sondearBase();
  t.pos.mesas = [mesaBase(3, { estado: 'libre' })];
  await t.pos.abrirMesa(t.pos.mesas[0]);
  assert.equal(t.pos.esperaMesa(3), null, 'recién abierta y vacía: nada');
  t.avanzar(4 * MIN);
  t.pos.agregarProducto({ id: 'pz1', cat: 'X', nombre: 'Plato', precio: 20000, desc: '', activo: true });
  assert.equal(t.pos.esperaMesa(3).texto, 'ahora');
  t.avanzar(3 * MIN);
  assert.equal(t.pos.esperaMesa(3).texto, '3 min');
});

test('otra tablet agrega el primer ítem (eco de Realtime con la cuenta a la vista): aquí también empieza ahí; un ítem más no reinicia; una lectura de la base NO inventa una hora', () => {
  const t = montar();
  const vacia = conCuenta(t, { items: [], min: 30 });
  t.avanzar(3 * MIN);
  const fila = { ...ordenBase('o1', 3, [item('p1', 20000, 1)], 2), abierta_en: vacia.abiertaEn };
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: fila });
  assert.equal(t.pos.esperaMesa(3).texto, 'ahora', 'el pedido llegó ahora (no hace 33 minutos)');
  t.avanzar(6 * MIN);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...fila, items: [item('p1', 20000, 1), item('p2', 5000, 1)], version: 3 } });
  assert.equal(t.pos.esperaMesa(3).texto, '6 min', 'una tanda más a una espera que sigue no la reinicia');

  // Una tablet que se conecta ahora con la cuenta ya cargada: no sabe cuándo llegó el pedido, usa abierta_en (la cuenta de hace 40 min)
  const fria = montar();
  fria.base.ordenes.set('o9', { ...ordenBase('o9', 4, [item('p1', 20000, 1)], 3), abierta_en: hace(40) });
  fria.pos.ordenes = fria.pos._fusionarOrdenes([...fria.base.ordenes.values()]);
  assert.equal(fria.pos.esperaDe(fria.pos.ordenes[0]).texto, '40 min');
  assert.equal(fria.pos.pedidoEn.o9, undefined, 'y no anota nada');
});

test('lo que esta tablet vio sobrevive a recargar (localStorage) y se borra con _olvidarTodo', async () => {
  const almacen = new Map();
  const t = montar({ almacen });
  await t.pos._sondearBase();
  const o = conCuenta(t, { items: [], min: 30 });
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = o;
  t.avanzar(MIN);
  t.pos.agregarProducto({ id: 'pz1', cat: 'X', nombre: 'Plato', precio: 20000, desc: '', activo: true });
  assert.deepEqual(JSON.parse(almacen.get('pos_pedido_en')), { o1: t.reloj.t });
  const otra = montar({ almacen });
  assert.deepEqual(plano(otra.pos.pedidoEn), { o1: t.reloj.t }, 'tras recargar sigue sabiéndolo');
  otra.pos._olvidarTodo();
  assert.equal(almacen.has('pos_pedido_en'), false);
  assert.deepEqual(plano(otra.pos.pedidoEn), {});
});

// ═════════════════════════ 4. «Servida» ═════════════════════════

test('detección: con la columna en la base el toque está disponible (lectura de cero filas y filas con la clave); sin ella (42703) no, y el cronómetro sigue como siempre', async () => {
  const con = montar();
  assert.equal(con.pos.servidaDisponible, false, 'sin saber, el toque no se ofrece');
  await con.pos._sondearBase();
  assert.equal(con.pos.servidaDisponible, true);
  const lecturas = con.supabase.de('ordenes', 'select').filter((c) => c.limite === 0).map((c) => c.columnas);
  assert.ok(lecturas.includes('servida_en'), `preguntó por la columna: ${lecturas}`);

  const sin = montar({ ordenes: [ordenBase('o1', 3, [item('p1', 20000, 2)], 1)] });
  sin.base.sinColumnas.add('ordenes.servida_en');
  await sin.pos._sondearBase();
  assert.equal(sin.pos.servidaDisponible, false);
  const o = conCuenta(sin, { min: 12 });
  assert.equal(await sin.pos.alternarServida('o1'), false, 'sin la columna no hay nada que alternar');
  assert.equal(actualizaciones(sin).length, 0, 'ni se intenta escribir');
  assert.equal(sin.pos.esperaDe(o).texto, '12 min', 'el cronómetro de siempre');
  assert.equal(sin.pos.esperaDe(o).servida, false);

  // una fila con la clave `servida_en` (aunque sea null) también lo dice
  const filas = montar();
  filas.pos.parseOrden({ ...ordenBase('o1', 3, [], 1), servida_en: null });
  assert.equal(filas.pos.servidaDisponible, true);
});

test('parseOrden: la marca viaja como servidaEn solo cuando la hay; formatOrden NO la manda nunca (el upsert de una tablet con la copia vieja no pisa la de otra)', () => {
  const t = montar();
  assert.equal('servidaEn' in t.pos.parseOrden({ ...ordenBase('o1', 3, [], 1), servida_en: null }), false);
  assert.equal(t.pos.parseOrden({ ...ordenBase('o1', 3, [], 1), servida_en: '2026-10-06T17:41:00Z' }).servidaEn, '2026-10-06T17:41:00Z');
  assert.equal('servidaEn' in t.pos.parseOrden(ordenBase('o1', 3, [], 1)), false, 'una fila de una base sin la columna');
  const fila = t.pos.formatOrden({ ...ordenLocal('o1', 3, [item('p1', 5000)], 1), servidaEn: '2026-10-06T17:41:00Z' });
  assert.equal('servida_en' in fila, false);
  assert.equal('servidaEn' in fila, false);
});

test('marcar servida: local al instante, UN update directo de la columna (no un upsert, sin ítems ni version), el cronómetro se detiene y dice «servida 12:41 · esperó 17 min»', async () => {
  const t = montar();
  await t.pos._sondearBase();
  const o = conCuenta(t, { min: 17 });                            // pedido a las 12:13
  t.avanzar(11 * MIN);                                             // 12:41: 28 min desde que se abrió
  conCuenta(t, { min: 28 });
  t.pos.ordenes[0].abiertaEn = new Date(T0 + 11 * MIN - 17 * MIN).toISOString();
  const ok = await t.pos.alternarServida('o1');
  assert.equal(ok, true);
  const ups = actualizaciones(t);
  assert.equal(ups.length, 1, 'un solo update');
  assert.deepEqual(plano(ups[0].cuerpo), { servida_en: new Date(t.reloj.t).toISOString() }, 'solo esa columna');
  assert.deepEqual(plano(ups[0].filtros), [['id', 'o1', 'eq'], ['estado', 'abierta', 'eq']], 'por id y solo de una cuenta abierta');
  assert.equal(subidas(t).length, 0, 'no pasa por el upsert de la fila');
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, 0, 'ni por los deltas de ítems');
  assert.equal(servidaDeBase(t), new Date(t.reloj.t).toISOString());
  const e = plano(t.pos.esperaDe(t.pos.ordenes[0]));
  assert.equal(e.servida, true);
  assert.equal(e.nivel, 'neutro');
  assert.equal(e.cabecera, 'servida 12:41 · esperó 17 min');
  assert.equal(e.cabeceraCorta, 'servida 12:41 · 17 min');
  assert.equal(e.texto, '17 min');
  assert.equal(e.sr, 'Servida a las 12:41 p. m.; esperó 17 minutos');
  assert.equal(e.tomado, 'Pedido tomado a las 12:24 p. m.');
  assert.equal(Object.keys(t.pos._servidaPend).length, 0, 'confirmada: sin pendientes');
  // el cronómetro se detiene: pasan 50 minutos y sigue diciendo 17
  t.avanzar(50 * MIN);
  assert.equal(t.pos.esperaDe(t.pos.ordenes[0]).texto, '17 min');
  assert.equal(t.pos.esperaDe(t.pos.ordenes[0]).nivel, 'neutro', 'y aunque pasen de 40 minutos no se tiñe');
  assert.equal(o.id, 'o1');
});

test('otro toque la quita y VUELVE A CONTAR desde el mismo inicio (cuenta también el rato que estuvo marcada)', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { min: 10 });
  await t.pos.alternarServida('o1');                              // servida a los 10 min
  t.avanzar(15 * MIN);
  assert.equal(t.pos.esperaMesa(3).texto, '10 min');
  await t.pos.alternarServida('o1');
  const ups = actualizaciones(t);
  assert.equal(ups.length, 2);
  assert.deepEqual(plano(ups[1].cuerpo), { servida_en: null });
  assert.equal(servidaDeBase(t), null);
  assert.equal(t.pos.ordenes[0].servidaEn, undefined);
  assert.equal(t.pos.esperaMesa(3).servida, false);
  assert.equal(t.pos.esperaMesa(3).texto, '25 min', 'vuelve a contar desde abierta_en: 10 + 15');
  assert.equal(t.pos.esperaMesa(3).nivel, 'ambar');
});

test('no marca lo que no se puede: una cuenta cerrada, una vacía o una que no existe', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { id: 'c1', mesaId: 4, min: 10 });
  t.pos.ordenes.find((o) => o.id === 'c1').estado = 'cerrada';
  conCuenta(t, { id: 'v1', mesaId: 5, items: [], min: 10 });
  for (const id of ['c1', 'v1', 'no-existe']) assert.equal(await t.pos.alternarServida(id), false, id);
  assert.equal(actualizaciones(t).length, 0);
});

test('si después se agregan ítems, la tablet que los agrega pone servida_en en null y empieza una espera NUEVA (desde ese momento); quitar ítems no la toca', async () => {
  const t = montar();
  await t.pos._sondearBase();
  const o = conCuenta(t, { items: [item('pz1', 20000, 2)], min: 30 });
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = o;
  await t.pos.alternarServida('o1');
  t.avanzar(20 * MIN);
  assert.equal(t.pos.esperaMesa(3).servida, true);
  // quitar un ítem: la marca sigue
  t.pos.quitarProducto(o.items[0]);
  await asentar();
  assert.equal(servidaDeBase(t) !== null, true, 'quitar no la toca');
  assert.equal(t.pos.esperaMesa(3).servida, true);
  const antes = actualizaciones(t).length;
  // agregar: la marca se quita aquí, en la base, y la espera empieza ahora
  t.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Postre', precio: 9000, desc: '', activo: true });
  assert.equal(t.pos.ordenes[0].servidaEn, undefined, 'local al instante');
  assert.equal(t.pos.esperaMesa(3).servida, false);
  assert.equal(t.pos.esperaMesa(3).texto, 'ahora', 'una espera nueva por la segunda tanda');
  await asentar();
  const nuevos = actualizaciones(t).slice(antes);
  assert.equal(nuevos.length, 1);
  assert.deepEqual(plano(nuevos[0].cuerpo), { servida_en: null });
  assert.equal(servidaDeBase(t), null, 'en la base también');
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length >= 2, true, 'los ítems siguieron su camino de siempre (deltas)');
  t.avanzar(7 * MIN);
  assert.equal(t.pos.esperaMesa(3).texto, '7 min');
  // y se puede volver a marcar
  await t.pos.alternarServida('o1');
  assert.equal(t.pos.esperaMesa(3).texto, '7 min');
  assert.equal(t.pos.esperaMesa(3).servida, true);
});

test('agregar ítems a una mesa SIN marca no toca la base ni reinicia la espera; «Para llevar» y los abonos no cuentan como una tanda', async () => {
  const t = montar();
  await t.pos._sondearBase();
  const o = conCuenta(t, { items: [item('pz1', 20000, 1)], min: 10 });
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = o;
  t.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Jugo', precio: 8000, desc: '', activo: true });
  await asentar();
  assert.equal(actualizaciones(t).length, 0, 'sin marca no hay nada que quitar');
  assert.equal(t.pos.esperaMesa(3).texto, '10 min');
  // con la marca, el marcador de «Todo para llevar» no es una tanda
  await t.pos.alternarServida('o1');
  const n = actualizaciones(t).length;
  t.pos.alternarLlevarPedido();
  await asentar();
  assert.equal(actualizaciones(t).length, n, 'poner «Todo para llevar» no quita la marca');
  assert.equal(t.pos.esperaMesa(3).servida, true);
});

test('el eco de otra tablet: marcar llega con la columna y se ve servida; quitarla vuelve a contar desde el inicio de siempre', () => {
  const t = montar();
  t.pos._baseConServida = true;
  conCuenta(t, { items: [item('p1', 20000, 1)], min: 10 });
  const fila = (extra) => ({ ...ordenBase('o1', 3, [item('p1', 20000, 1)], 1), abierta_en: hace(10), servida_en: null, ...extra });
  t.avanzar(5 * MIN);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: fila({ servida_en: new Date(T0 + 4 * MIN).toISOString() }) });   // sin subir la version: igual llega
  assert.equal(t.pos.esperaMesa(3).servida, true, 'otra tablet la marcó');
  assert.equal(t.pos.esperaMesa(3).texto, '14 min', 'esperó 14 min hasta que se sirvió');
  t.avanzar(30 * MIN);
  assert.equal(t.pos.esperaMesa(3).texto, '14 min', 'y se detuvo');
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: fila({ servida_en: null }) });
  assert.equal(t.pos.esperaMesa(3).servida, false);
  assert.equal(t.pos.esperaMesa(3).texto, '45 min', 'la quitaron: vuelve a contar desde el inicio');
  assert.equal(t.pos.pedidoEn.o1, undefined, 'quitar la marca no es una tanda: no anota nada');
});

// ═════════════ 4b. La tanda nueva entre varias tablets (refutación r1, hallazgos 2 a 6) ═════════════

const MARCA = (t, min) => new Date(t.reloj.t - min * MIN).toISOString();
/** La fila de la base de una cuenta abierta hace `min` minutos con la marca de `servidaHace` minutos (null = sin marca). */
const filaServida = (t, { items = [item('p1', 20000, 1)], version = 1, min = 50, servidaHace = 30 } = {}) =>
  ({ ...ordenBase('o1', 3, items, version), abierta_en: MARCA(t, min), servida_en: servidaHace === null ? null : MARCA(t, servidaHace) });

test('la tanda nueva de otra tablet llega en DOS cambios (los ítems con la marca puesta y luego el null): con los ítems sigue servida; con el null cuenta de nuevo desde que llegaron los ítems', () => {
  const t = montar();
  t.pos._baseConServida = true;
  t.pos.ordenes = [t.pos.parseOrden(filaServida(t))];
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: filaServida(t, { items: [item('p1', 20000, 1), item('p2', 9000, 1)], version: 2 }) });
  assert.equal(t.pos.esperaMesa(3).servida, true, 'más unidades con la marca puesta: aún no se sabe si es una tanda (puede ser un cobro que se deshizo)');
  assert.equal(t.pos.pedidoEn.o1, undefined, 'nada se anota todavía');
  t.avanzar(2000);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: filaServida(t, { items: [item('p1', 20000, 1), item('p2', 9000, 1)], version: 2, servidaHace: null }) });
  assert.equal(t.pos.esperaMesa(3).servida, false, 'llegó el null: era una tanda');
  assert.equal(t.pos.pedidoEn.o1, T0, 'la espera nueva empieza cuando llegaron los ítems, no cuando llegó el null');
  assert.equal(t.pos.esperaMesa(3).texto, 'ahora');
  t.avanzar(7 * MIN);
  assert.equal(t.pos.esperaMesa(3).texto, '7 min');
});

test('R2: la espera nueva de la segunda tanda también la ve una tablet que se reconecta o recarga, si tenía la cuenta servida (_fusionarOrdenes); una sin copia cuenta desde abierta_en', async () => {
  const almacen = new Map();
  const B = montar({ almacen });
  await B.pos._sondearBase();
  B.base.ordenes.set('o1', filaServida(B));
  B.pos.ordenes = [B.pos.parseOrden(B.base.ordenes.get('o1'))];
  B.pos.mesaActiva = B.pos.mesas[0]; B.pos.ordenActiva = B.pos.ordenes[0];
  B.pos.guardarCachéLocal('ordenes');
  // C tiene la cuenta servida en su caché (la vio antes de dormirse); B agrega el postre: ítems y null en la base
  const C = montar({ almacen, base: undefined });
  C.base.ordenes.set('o1', B.base.ordenes.get('o1'));
  C.pos.cargarCachéLocal();
  assert.equal(C.pos.esperaMesa(3).servida, true, 'C parte con la cuenta servida');
  B.avanzar(MIN); C.avanzar(MIN);
  B.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Postre', precio: 9000, desc: '', activo: true });
  await asentar();
  const enBase = B.base.ordenes.get('o1');
  assert.equal(enBase.servida_en ?? null, null, 'B quitó la marca en la base');
  assert.equal(enBase.items.length, 2);
  C.base.ordenes.set('o1', { ...enBase });
  C.pos.ordenes = C.pos._fusionarOrdenes([...C.base.ordenes.values()]);   // lo que hace cualquier lectura de la base: recargar, o volver del bolsillo
  assert.equal(C.pos.esperaMesa(3).texto, B.pos.esperaMesa(3).texto, 'C ve lo mismo que B');
  assert.equal(C.pos.esperaMesa(3).texto, 'ahora');
  assert.equal(C.pos.esperaMesa(3).nivel, 'neutro', 'y no en coral (antes: «1 h 20» con la espera del primer servicio)');
  // una tablet sin copia de la cuenta (nueva, o con el almacenamiento borrado) no tiene de dónde sacar otra hora: abierta_en
  const D = montar();
  D.pos.ordenes = D.pos._fusionarOrdenes([{ ...enBase }]);
  assert.equal(D.pos.esperaMesa(3).texto, '50 min', 'límite conocido: sin copia previa cuenta desde abierta_en');
  // una lectura donde NADA cambió o donde solo quitaron la marca a mano no reinicia nada
  const E = montar({ almacen: new Map() });
  E.pos._baseConServida = true;
  E.pos.ordenes = [E.pos.parseOrden(filaServida(E))];
  E.pos.ordenes = E.pos._fusionarOrdenes([filaServida(E, { servidaHace: null })]);
  assert.equal(E.pos.pedidoEn.o1, undefined, 'quitar la marca a mano no es una tanda');
  assert.equal(E.pos.esperaMesa(3).texto, '50 min', 'vuelve a contar desde el inicio');
});

test('una lectura de la base NO inventa la hora del primer pedido (una cuenta que se abrió vacía y ahora trae ítems cuenta desde abierta_en)', () => {
  const t = montar();
  t.pos._baseConServida = true;
  t.pos.ordenes = [t.pos.parseOrden({ ...ordenBase('o1', 3, [], 1), abierta_en: MARCA(t, 30), servida_en: null })];
  t.pos.ordenes = t.pos._fusionarOrdenes([{ ...ordenBase('o1', 3, [item('p1', 20000, 1)], 2), abierta_en: MARCA(t, 30), servida_en: null }]);
  assert.equal(t.pos.pedidoEn.o1, undefined);
  assert.equal(t.pos.esperaMesa(3).texto, '30 min');
  // ni una tanda más a una espera que sigue (la mesa no está servida)
  const u = montar();
  u.pos._baseConServida = true;
  u.pos.ordenes = [u.pos.parseOrden({ ...ordenBase('o1', 3, [item('p1', 20000, 1)], 1), abierta_en: MARCA(u, 30), servida_en: null })];
  u.pos.ordenes = u.pos._fusionarOrdenes([{ ...ordenBase('o1', 3, [item('p1', 20000, 1), item('p2', 9000, 1)], 2), abierta_en: MARCA(u, 30), servida_en: null }]);
  assert.equal(u.pos.pedidoEn.o1, undefined, 'una espera que sigue no se reinicia');
  assert.equal(u.pos.esperaMesa(3).texto, '30 min');
});

test('R4: unas unidades que VUELVEN a una cuenta servida (deshacer un cobro por partes) no son una tanda: la mesa sigue servida aquí y en la base, y nadie le quita la marca', async () => {
  const t = montar();
  await t.pos._sondearBase();
  const fila = filaServida(t, { items: [item('pz1', 20000, 1)], version: 4 });   // ya cobraron 1 de 2 por partes
  t.base.ordenes.set('o1', fila);
  t.pos.ordenes = [t.pos.parseOrden(fila)];
  // deshacer_cobro devuelve el plato a la cuenta abierta (la base no toca servida_en): llega el eco con 2 unidades y la marca intacta
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...fila, items: [item('pz1', 20000, 2)], version: 5 } });
  t.avanzar(45 * MIN);
  assert.equal(t.pos.esperaMesa(3).servida, true, 'sigue servida: así la tiene la base');
  assert.equal(t.pos.esperaMesa(3).nivel, 'neutro', 'y no pasa a ámbar ni coral con el tiempo');
  assert.equal(t.pos.pedidoEn.o1, undefined);
  // ni una marca quitada a mano 45 minutos después se toma por una tanda: la candidata caduca (sin esperar a que el reloj de 1 minuto la pode)
  assert.deepEqual(Object.keys(t.pos._tandaVista), ['o1'], 'la candidata sigue ahí');
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...fila, items: [item('pz1', 20000, 2)], version: 6, servida_en: null } });
  assert.equal(t.pos.pedidoEn.o1, undefined, 'quitarla a mano mucho después no reinicia la espera');
  assert.deepEqual(plano(t.pos._tandaVista), {}, 'y se gasta');
});

test('el reloj de 1 minuto poda las candidatas viejas (no se acumulan) y deja las recientes', () => {
  const t = montar();
  t.pos._tandaVista = { viejo: T0 - 60 * MIN, reciente: T0 - 3000 };
  t.pos._podarPedidoEn();
  assert.deepEqual(Object.keys(t.pos._tandaVista), ['reciente']);
});

// Antes la tablet «devolvía» lo cobrado a la cuenta con un +qty cuando la base rechazaba el cobro por partes (y ese +qty no podía contar como una tanda: opción `restituye`). Hoy de la cuenta NO sale nada
// hasta que la base acepta el cobro, y la tablet no reconstruye nada: relee la cuenta de la base (`_adoptarCuentaDeLaBase`). Lo que sigue valiendo es lo que importa a la espera: ni el rechazo
// ni la relectura son una tanda nueva, y la marca «servida» de la base no se quita.
test('R4: un cobro por partes que la base rechazó no saca ni devuelve nada de la cuenta (se relee la de la base): NO es una tanda y la marca de la base no se quita', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { items: [item('pz1', 20000, 1)], min: 50 });
  await t.pos.alternarServida('o1');
  const antes = actualizaciones(t).length;
  const cobro = { id: 'cobro-1', parcialDe: 'o1', mesaId: 3, items: [item('pz1', 20000, 1)], estado: 'cerrada' };
  t.pos.ordenes.push({ ...ordenLocal('cobro-1', 3, [item('pz1', 20000, 1)], 1, 'cerrada'), parcialDe: 'o1' });
  await t.pos._cobroParcialRechazado(cobro);
  await asentar();
  const hoy = t.pos.ordenes.find((x) => x.id === 'o1');
  assert.equal(hoy.items.find((i) => i.id === 'pz1').qty, 1, 'la cuenta es la de la base: no se le devolvió nada (nada había salido)');
  assert.equal(actualizaciones(t).length, antes, 'no se tocó la marca de la base');
  assert.equal(servidaDeBase(t) !== null, true);
  assert.equal(t.pos.esperaMesa(3).servida, true);
  assert.equal(t.pos.pedidoEn.o1, undefined);
});

test('R3: carrera de dos tablets: A marca «servida» justo después del +1 de B y recibe su eco (con la foto de antes de la marca) DESPUÉS: A, B y una tablet recargada dicen lo mismo', async () => {
  const base = crearBaseFalsa({ rol: 'admin', mesas: [mesaBase(3)], ordenes: [] });
  base.ordenes.set('o1', { ...ordenBase('o1', 3, [item('pz1', 20000, 1)], 1), abierta_en: hace(20), servida_en: null });
  const A = crearPosCon(base); const B = crearPosCon(base);
  await A.pos._sondearBase(); await B.pos._sondearBase();
  for (const x of [A, B]) { x.pos.ordenes = [x.pos.parseOrden(base.ordenes.get('o1'))]; x.pos.mesaActiva = x.pos.mesas[0]; x.pos.ordenActiva = x.pos.ordenes[0]; }
  B.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Jugo', precio: 8000, desc: '', activo: true });   // la mesa no está servida: B no toca servida_en
  await asentar();
  const trasB = { ...base.ordenes.get('o1') };
  A.avanzar(5000); B.avanzar(5000);
  await A.pos.alternarServida('o1');                              // A aún no recibió el eco del +1
  await asentar();
  A.avanzar(300); B.avanzar(300);
  A.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...trasB, servida_en: null } });   // el eco viejo: más unidades y SIN la marca
  A.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...base.ordenes.get('o1') } });    // el de la marca de A
  B.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...base.ordenes.get('o1') } });
  const C = crearPosCon(base); C.pos.ordenes = C.pos._fusionarOrdenes([...base.ordenes.values()]);
  const ver = (x) => { const e = x.pos.esperaMesa(3); return e.servida ? `servida · ${e.cabecera}` : 'esperando ' + e.texto; };
  assert.equal(base.ordenes.get('o1').servida_en !== null, true, 'la base quedó servida');
  assert.equal(new Set([ver(A), ver(B), ver(C)]).size, 1, `las tres dicen lo mismo: A=${ver(A)} B=${ver(B)} C=${ver(C)}`);
  assert.match(ver(A), /^servida · servida \d+:\d\d · esperó 20 min$/);
  assert.equal(A.pos.pedidoEn.o1, undefined, 'el eco viejo no se tomó por una tanda');
});

test('R5: se agrega una tanda a una mesa servida con la tablet recién recargada y SIN red (aún sin saber si la base tiene la columna): al volver la red, la marca de la base se quita', async () => {
  const almacen = new Map();
  const A = montar({ almacen });
  A.base.ordenes.set('o1', filaServida(A, { version: 2 }));
  A.pos.ordenes = [A.pos.parseOrden(A.base.ordenes.get('o1'))];
  A.pos.guardarCachéLocal('ordenes');
  const R = montar({ almacen, base: undefined });
  R.base.ordenes.set('o1', { ...A.base.ordenes.get('o1') });
  R.pos.cargarCachéLocal();
  R.pos.remoto = 'offline'; R.base.red = false;
  R.pos.mesaActiva = R.pos.mesas[0]; R.pos.ordenActiva = R.pos.ordenes.find((o) => o.id === 'o1');
  assert.equal(R.pos._baseConServida, null, 'sin sondeo: aún no sabe si hay columna');
  assert.equal(R.pos.esperaMesa(3).servida, true);
  R.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Postre', precio: 9000, desc: '', activo: true });
  await asentar();
  assert.equal(R.pos.esperaMesa(3).servida, false, 'aquí ya cuenta de nuevo');
  assert.deepEqual(plano(R.pos._servidaPend), { o1: { valor: null } }, 'y el null queda pendiente (persistido)');
  R.base.red = true; R.pos.remoto = 'ok';
  await R.pos._sondearBase();
  await R.pos.flushDeltas();
  await R.pos._vaciarServida();
  await asentar();
  assert.equal(servidaDeBase(R), null, 'la marca de la base se quitó');
  assert.equal(R.base.ordenes.get('o1').items.length, 2, 'con los ítems de la tanda');
  assert.deepEqual(plano(R.pos._servidaPend), {});
});

test('R6: los relojes de dos tablets no anulan la marca: B vio llegar el pedido (pedidoEn) y A, con el reloj 3 min atrás, marca servida; B la ve servida', async () => {
  const base = crearBaseFalsa({ rol: 'admin', mesas: [mesaBase(3)], ordenes: [] });
  base.ordenes.set('o1', { ...ordenBase('o1', 3, [], 1), abierta_en: hace(30), servida_en: null });
  const B = crearPosCon(base);
  await B.pos._sondearBase();
  B.pos.ordenes = [B.pos.parseOrden(base.ordenes.get('o1'))];
  B.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...base.ordenes.get('o1'), items: [item('pz1', 20000, 2)], version: 2 } });   // el pedido llega a las 12:30
  B.avanzar(2 * MIN);
  const A = crearPosCon(base, { t0: T0 + 2 * MIN - 3 * MIN });   // A cree que son las 12:29
  await A.pos._sondearBase();
  base.ordenes.set('o1', { ...base.ordenes.get('o1'), items: [item('pz1', 20000, 2)], version: 2 });
  A.pos.ordenes = [A.pos.parseOrden(base.ordenes.get('o1'))];
  await A.pos.alternarServida('o1');
  B.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...base.ordenes.get('o1') } });
  assert.equal(B.pos.esperaMesa(3).servida, true, 'B ve la marca que puso A, aunque el reloj de A vaya detrás del pedido de B');
});

test('sin red: la marca queda al instante en pantalla y PENDIENTE (persistida); al volver la red sube sola y se suelta; recargar antes de eso no la pierde', async () => {
  const almacen = new Map();
  const t = montar({ almacen });
  await t.pos._sondearBase();
  conCuenta(t, { min: 10 });
  t.pos.remoto = 'offline';
  t.base.red = false;
  const subida = await t.pos.alternarServida('o1');
  assert.equal(subida, false, 'sin red no se confirma');
  assert.equal(t.pos.esperaMesa(3).servida, true, 'pero en pantalla ya está');
  assert.equal(servidaDeBase(t), null, 'la base aún no la tiene');
  assert.deepEqual(Object.keys(JSON.parse(almacen.get('pos_servida_pend'))), ['o1'], 'y queda anotada en localStorage');

  // recargar la página sin red: la marca sigue (caché de órdenes + pendiente)
  const recargada = montar({ almacen });
  recargada.pos.cargarCachéLocal();
  assert.equal(recargada.pos.ordenes.find((o) => o.id === 'o1').servidaEn !== undefined, true, 'la caché de órdenes la guardó');
  assert.deepEqual(Object.keys(recargada.pos._servidaPend), ['o1']);

  // vuelve la red: sube, y se suelta
  t.base.red = true; t.pos.remoto = 'ok';
  await t.pos._vaciarServida();
  assert.equal(servidaDeBase(t), t.pos.ordenes[0].servidaEn);
  assert.deepEqual(plano(t.pos._servidaPend), {});
  assert.deepEqual(JSON.parse(almacen.get('pos_servida_pend')), {});
});

test('al volver la red la marca pendiente sube SOLA por el evento online (sin llamar a _vaciarServida a mano) y también tras una lectura buena (_subirLoPendiente)', async () => {
  for (const camino of ['online', 'lectura buena']) {
    const t = montar();
    await t.pos._sondearBase();
    conCuenta(t, { min: 10 });
    t.pos._escucharEntorno();
    t.pos.remoto = 'offline'; t.base.red = false;
    await t.pos.alternarServida('o1');
    assert.equal(servidaDeBase(t), null, `${camino}: sin red la base no la tiene`);
    t.base.red = true; t.pos.remoto = 'ok';
    if (camino === 'online') {
      // el evento online solo (las lecturas que dispara — revalidar el rol, resincronizar — también reintentan: aquí no corren)
      t.pos.sincronizarSupabase = async () => {}; t.pos._subirLoPendiente = async () => {};
      for (const f of t.oyentes.ventana.online || []) f();
    } else await t.pos._subirLoPendiente();
    await asentar(30);
    assert.equal(servidaDeBase(t) !== null, true, `${camino}: la marca subió sola`);
    assert.deepEqual(plano(t.pos._servidaPend), {}, `${camino}: y se soltó`);
  }
});

test('salir de la sesión (_olvidarTodo) borra la marca pendiente de localStorage y de memoria, y las esperas que esta tablet había visto', async () => {
  const almacen = new Map();
  const t = montar({ almacen });
  await t.pos._sondearBase();
  conCuenta(t, { min: 10 });
  t.pos.remoto = 'offline'; t.base.red = false;
  await t.pos.alternarServida('o1');
  t.pos.pedidoEn = { o1: T0 - MIN }; t.pos._tandaVista = { o1: T0 };
  assert.equal(almacen.has('pos_servida_pend'), true);
  t.pos._olvidarTodo();
  assert.equal(almacen.has('pos_servida_pend'), false, 'localStorage');
  assert.deepEqual(plano(t.pos._servidaPend), {}, 'memoria: la marca de la sesión anterior no sube con la de la siguiente');
  assert.deepEqual(plano(t.pos._tandaVista), {});
  assert.deepEqual(plano(t.pos.pedidoEn), {});
});

test('sin red NO se poda lo que esta tablet vio (la lista de cuentas puede estar incompleta); con la lista buena, sí', () => {
  const t = montar();
  t.pos.pedidoEn = { o1: T0 - 5 * MIN, viejo: T0 - 9 * MIN };
  t.pos.remoto = 'offline';
  t.pos._podarPedidoEn();
  assert.deepEqual(plano(t.pos.pedidoEn), { o1: T0 - 5 * MIN, viejo: T0 - 9 * MIN }, 'offline: nada se poda');
  t.pos.remoto = 'conectando';
  t.pos._podarPedidoEn();
  assert.equal(Object.keys(t.pos.pedidoEn).length, 2, 'ni mientras conecta');
  t.pos.remoto = 'ok';
  t.pos._podarPedidoEn();
  assert.deepEqual(plano(t.pos.pedidoEn), {}, 'con la lista buena se podan las de cuentas que no están abiertas');
});

test('editando un cierre del día (la cuenta no es de la tabla ordenes) no se puede marcar servida: ni local ni en la base', async () => {
  const t = montar();
  await t.pos._sondearBase();
  const o = conCuenta(t, { min: 10 });
  t.pos.cierreEditando = { id: 'cierre-1', ordenes: [o] };
  assert.equal(await t.pos.alternarServida('o1'), false);
  assert.equal(o.servidaEn, undefined);
  assert.equal(actualizaciones(t).length, 0);
  t.pos.cierreEditando = null;
  assert.equal(await t.pos.alternarServida('o1'), true, 'sin el cierre abierto, sí');
});

test('sin la columna una marca que quedó en la caché NO se muestra, y agregar una tanda no intenta escribir nada en la base', async () => {
  const t = montar();
  t.base.sinColumnas.add('ordenes.servida_en');
  await t.pos._sondearBase();
  assert.equal(t.pos._baseConServida, false);
  const o = conCuenta(t, { items: [item('pz1', 20000, 1)], min: 30, extra: { servidaEn: new Date(T0 - 10 * MIN).toISOString() } });
  assert.equal(t.pos.esperaDe(o).servida, false, 'la marca de la caché no vale sin la columna');
  assert.equal(t.pos.esperaDe(o).texto, '30 min');
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = o;
  t.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Jugo', precio: 8000, desc: '', activo: true });
  await asentar();
  assert.equal(actualizaciones(t).length, 0, 'sin columna no se escribe nada');
  assert.deepEqual(plano(t.pos._servidaPend), {});
  // y aunque la cuenta esté vacía (el primer ítem entra por la misma puerta) con una marca vieja en la caché
  const v = conCuenta(t, { id: 'o2', mesaId: 4, items: [], min: 30, extra: { servidaEn: new Date(T0 - 10 * MIN).toISOString() } });
  t.pos.mesas = [...t.pos.mesas, mesaBase(4)];
  t.pos.mesaActiva = t.pos.mesas.find((m) => m.id === 4); t.pos.ordenActiva = v;
  t.pos.agregarProducto({ id: 'pz3', cat: 'X', nombre: 'Plato', precio: 20000, desc: '', activo: true });
  await asentar();
  assert.equal(actualizaciones(t).length, 0, 'ni con la cuenta vacía');
  assert.deepEqual(plano(t.pos._servidaPend), {});
});

test('un toque sostenido de 400 ms todavía NO marca (hacen falta 600): un scroll o un toque lento no marcan por error', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { min: 12 });
  t.pos.esperaPulsarInicio('o1');
  await dormir(400);
  t.pos.esperaPulsarFin();
  await dormir(300);
  assert.equal(actualizaciones(t).length, 0);
  assert.equal(t.pos.esperaMesa(3).servida, false);
});

test('la marca de una tanda nueva se APLICA en la base DESPUÉS de sus ítems aunque los ítems tarden más (las otras tablets ven primero las unidades y luego el null); sin red espera a que se vacíe la cola de ítems', async () => {
  /** Anota el orden en que la base aplica cada cosa; el delta de ítems tarda `lento` ms más que el update de la marca. */
  const espiar = (t, lento = 60) => {
    const aplicados = []; const original = t.base.responder;
    t.base.responder = async (c) => {
      if (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden') await dormir(lento);
      const r = await original(c);
      if ((c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden') || (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'update')) aplicados.push(c.tipo === 'rpc' ? 'ítems' : 'marca');
      return r;
    };
    return aplicados;
  };
  // con red y los ítems lentos
  const t = montar();
  await t.pos._sondearBase();
  const o = conCuenta(t, { items: [item('pz1', 20000, 1)], min: 30 });
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = o;
  await t.pos.alternarServida('o1');
  const aplicadosT = espiar(t);
  t.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Postre', precio: 9000, desc: '', activo: true });
  await dormir(200); await asentar();
  assert.deepEqual(aplicadosT, ['ítems', 'marca'], 'primero los ítems, después el null');
  assert.equal(servidaDeBase(t), null);

  // sin red: el delta queda en la cola, el null pendiente; al volver la red salen en ese orden
  const u = montar();
  await u.pos._sondearBase();
  const p = conCuenta(u, { items: [item('pz1', 20000, 1)], min: 30 });
  u.pos.mesaActiva = u.pos.mesas[0]; u.pos.ordenActiva = p;
  await u.pos.alternarServida('o1');
  u.pos._escucharEntorno();
  u.pos.remoto = 'offline'; u.base.red = false;
  u.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Postre', precio: 9000, desc: '', activo: true });
  await asentar();
  assert.equal(u.pos.colaDeltas.length, 1, 'el delta espera en la cola');
  assert.deepEqual(plano(u.pos._servidaPend), { o1: { valor: null } });
  const aplicadosU = espiar(u);
  u.base.red = true; u.pos.remoto = 'ok';
  for (const f of u.oyentes.ventana.online || []) f();            // flushDeltas y _vaciarServida arrancan casi juntos
  await dormir(250); await asentar(30);
  // (el arnés sin deltas idempotentes deja pasar un reintento duplicado del delta mientras el primero está lento: lo que importa es que NINGÚN ítem se aplique después del null)
  assert.equal(aplicadosU.filter((x) => x === 'marca').length, 1, 'un solo null');
  assert.ok(aplicadosU.lastIndexOf('ítems') < aplicadosU.indexOf('marca') && aplicadosU.indexOf('ítems') >= 0, `también al reconectar: los ítems y luego el null (${aplicadosU.join(', ')})`);
  assert.equal(servidaDeBase(u), null);
  assert.equal(u.base.ordenes.get('o1').items.length, 2);
});

test('si los ítems de la tanda NO logran subir (siguen en la cola de reintentos), la marca no se quita de la base por delante de ellos: queda pendiente y sale cuando se vacía la cola', async () => {
  const t = montar();
  await t.pos._sondearBase();
  const o = conCuenta(t, { items: [item('pz1', 20000, 1)], min: 30 });
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = o;
  await t.pos.alternarServida('o1');
  t.base.fallar('rpc:aplicar_delta_orden');                       // la base contesta, pero el delta falla: se encola
  const antes = actualizaciones(t).length;
  t.pos.agregarProducto({ id: 'pz2', cat: 'X', nombre: 'Postre', precio: 9000, desc: '', activo: true });
  await dormir(30); await asentar();
  assert.equal(t.pos.colaDeltas.length, 1, 'el delta quedó en la cola');
  assert.equal(actualizaciones(t).length, antes, 'la marca NO salió por delante de sus ítems');
  assert.equal(servidaDeBase(t) !== null, true, 'la base sigue servida con la cuenta como estaba');
  assert.deepEqual(plano(t.pos._servidaPend), { o1: { valor: null } }, 'el null espera');
  t.base.repararTodo();
  await t.pos.flushDeltas();
  await t.pos._vaciarServida();
  await asentar();
  assert.equal(servidaDeBase(t), null, 'vacía la cola y sale el null');
  assert.equal(t.base.ordenes.get('o1').items.length, 2);
});

test('un fallo de red (sin código) en medio de la subida no pierde la marca: sigue pendiente y el siguiente intento la sube', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { min: 10 });
  t.base.fallar('update:ordenes');
  assert.equal(await t.pos.alternarServida('o1'), false);
  assert.equal(t.pos.esperaMesa(3).servida, true);
  assert.deepEqual(Object.keys(t.pos._servidaPend), ['o1']);
  t.base.repararTodo();
  await t.pos._vaciarServida();
  assert.equal(servidaDeBase(t) !== null, true);
  assert.deepEqual(Object.keys(t.pos._servidaPend), []);
});

test('lo que llega de la base mientras la marca está pendiente no la borra de la pantalla (_conMarcasPendientes)', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { min: 10 });
  t.base.red = false; t.pos.remoto = 'offline';
  await t.pos.alternarServida('o1');
  assert.equal(t.pos.esperaMesa(3).servida, true);
  // llega el eco de OTRO cambio de esa cuenta (con servida_en null: la base aún no la tiene)
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...ordenBase('o1', 3, [item('p1', 20000, 2), item('p9', 5000, 1)], 2), abierta_en: hace(10), servida_en: null } });
  assert.equal(t.pos.esperaMesa(3).servida, true, 'sigue servida en pantalla');
  // y lo mismo para «quitar» pendiente
  t.base.red = true; t.pos.remoto = 'ok';
  await t.pos._vaciarServida();
  t.base.red = false; t.pos.remoto = 'offline';
  await t.pos.alternarServida('o1');                              // la quita
  assert.equal(t.pos.esperaMesa(3).servida, false);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...ordenBase('o1', 3, [item('p1', 20000, 2), item('p9', 5000, 1)], 3), abierta_en: hace(10), servida_en: servidaDeBase(t) } });
  assert.equal(t.pos.esperaMesa(3).servida, false, 'el eco viejo (aún con la marca) no la devuelve');
});

test('dos toques seguidos con la primera subida en vuelo: sale el ÚLTIMO valor (una subida a la vez por cuenta)', async () => {
  const t = montar({ base: { latenciaMs: 15 } });
  await t.pos._sondearBase();
  conCuenta(t, { min: 10 });
  const a = t.pos.alternarServida('o1');                          // marca
  await soltar();
  const b = t.pos.alternarServida('o1');                          // y enseguida la quita
  await Promise.all([a, b]);
  await asentar();
  assert.equal(servidaDeBase(t), null, 'queda como la persona la dejó: sin marca');
  assert.equal(t.pos.esperaMesa(3).servida, false);
  assert.deepEqual(plano(t.pos._servidaPend), {});
  assert.ok(actualizaciones(t).length <= 3);
});

test('la base sin la columna (PGRST204 al escribir, aunque el sondeo no lo supiera): el toque se esconde, la marca local se quita y el cronómetro sigue como siempre', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { min: 12 });
  t.base.sinColumnas.add('ordenes.servida_en');                   // la migración se revirtió con el POS puesto
  assert.equal(await t.pos.alternarServida('o1'), false);
  assert.equal(t.pos.servidaDisponible, false);
  assert.equal(t.pos.ordenes[0].servidaEn, undefined);
  assert.deepEqual(plano(t.pos._servidaPend), {});
  assert.equal(t.pos.esperaMesa(3).servida, false);
  assert.equal(t.pos.esperaMesa(3).texto, '12 min');
  assert.equal(await t.pos.alternarServida('o1'), false);
  assert.equal(actualizaciones(t).length, 1, 'no insiste');
});

test('un rechazo de permisos (42501) suelta la marca pendiente (no se reintenta) y no la deja en pantalla como si estuviera', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { min: 12 });
  const original = t.base.responder;
  t.base.responder = async (c) => (c.tabla === 'ordenes' && c.op === 'update' ? { data: null, error: { code: '42501', message: 'permission denied' } } : original(c));
  assert.equal(await t.pos.alternarServida('o1'), false);
  assert.deepEqual(plano(t.pos._servidaPend), {}, 'no queda pendiente');
  assert.equal(actualizaciones(t).length, 1);
});

test('cuando la cuenta se cierra, la marca pendiente se suelta y el chip desaparece', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { min: 12 });
  t.base.red = false; t.pos.remoto = 'offline';
  await t.pos.alternarServida('o1');
  assert.deepEqual(Object.keys(t.pos._servidaPend), ['o1']);
  t.pos.ordenes[0].estado = 'cerrada';
  assert.equal(t.pos.esperaMesa(3), null, 'cuenta cerrada: nada');
  t.base.red = true; t.pos.remoto = 'ok';
  await t.pos._vaciarServida();
  assert.deepEqual(plano(t.pos._servidaPend), {});
  assert.equal(actualizaciones(t).length, 0, 'ni intentó subir la marca de una cuenta cerrada');
});

// ═════════════════════════ 5. El toque largo de la tarjeta del mapa ═════════════════════════

test('toque largo (600 ms) sobre el chip de la tarjeta marca servida y el clic que suelta la mano NO abre la mesa; un toque corto no marca y deja pasar el clic', async () => {
  const t = montar();
  await t.pos._sondearBase();
  conCuenta(t, { min: 12 });
  const clic = () => { const ev = { parado: false, evitado: false, stopPropagation() { this.parado = true; }, preventDefault() { this.evitado = true; } }; t.pos.esperaClick(ev); return ev; };

  // corto: pointerdown y pointerup antes de tiempo
  t.pos.esperaPulsarInicio('o1');
  await dormir(80);
  t.pos.esperaPulsarFin();
  await dormir(650);
  assert.equal(actualizaciones(t).length, 0, 'un toque corto no marca');
  assert.equal(clic().parado, false, 'y el clic llega a la tarjeta (abre la mesa)');

  // largo
  t.pos.esperaPulsarInicio('o1');
  await dormir(700);
  await asentar();
  assert.equal(t.pos.esperaMesa(3).servida, true, 'marcada tras mantener');
  assert.equal(actualizaciones(t).length, 1);
  t.pos.esperaPulsarFin();                                       // suelta la mano
  const c1 = clic();
  assert.equal(c1.parado, true, 'el clic que sigue al toque largo no llega a la tarjeta');
  assert.equal(c1.evitado, true);
  assert.equal(clic().parado, false, 'solo ese: el siguiente toque normal sí abre la mesa');

  // otro toque largo la quita
  t.pos.esperaPulsarInicio('o1');
  await dormir(700);
  await asentar();
  assert.equal(t.pos.esperaMesa(3).servida, false);
  t.pos.esperaPulsarFin();
  clic();
});

test('sin la columna el toque largo no hace nada (y el clic pasa)', async () => {
  const t = montar();
  t.base.sinColumnas.add('ordenes.servida_en');
  await t.pos._sondearBase();
  conCuenta(t, { min: 12 });
  t.pos.esperaPulsarInicio('o1');
  await dormir(700);
  t.pos.esperaPulsarFin();
  assert.equal(actualizaciones(t).length, 0);
  const ev = { parado: false, stopPropagation() { this.parado = true; }, preventDefault() {} };
  t.pos.esperaClick(ev);
  assert.equal(ev.parado, false);
});

test('las etiquetas dicen desde cuándo cuenta y qué hace tocar (toque en la cabecera, mantener en la tarjeta); sin la marca no prometen nada', async () => {
  const t = montar();
  const o = conCuenta(t, { min: 12 });
  const e = t.pos.esperaDe(o);
  assert.equal(t.pos.esperaEtiqueta(e, 'toque'), 'Esperando 12 minutos. Pedido tomado a las 12:18 p. m.', 'sin la columna: solo lo que dice');
  await t.pos._sondearBase();
  assert.equal(t.pos.esperaEtiqueta(e, 'toque'), 'Esperando 12 minutos. Pedido tomado a las 12:18 p. m. Toca para marcar la mesa como servida.');
  assert.equal(t.pos.esperaEtiqueta(e, 'largo'), 'Esperando 12 minutos. Pedido tomado a las 12:18 p. m. Mantén pulsado para marcar la mesa como servida.');
  assert.equal(t.pos.esperaEtiqueta(e), 'Esperando 12 minutos. Pedido tomado a las 12:18 p. m.');
  await t.pos.alternarServida('o1');
  const s = t.pos.esperaDe(t.pos.ordenes[0]);
  assert.match(t.pos.esperaEtiqueta(s, 'toque'), /Toca para volver a contar la espera\.$/);
  assert.match(t.pos.esperaEtiqueta(s, 'largo'), /Mantén pulsado para volver a contar la espera\.$/);
  assert.equal(t.pos.esperaEtiqueta(null), '');
});

// ═════════════════════════ 6. Lo que NO cambia ═════════════════════════

test('no suma estado nuevo a la orden: marcar servida no cambia ítems, total, version ni la fila que sube el cobro; el cierre no sabe de la marca', async () => {
  const t = montar();
  await t.pos._sondearBase();
  const o = conCuenta(t, { min: 12 });
  const antes = JSON.stringify({ items: o.items, total: o.total, version: o.version });
  await t.pos.alternarServida('o1');
  assert.equal(JSON.stringify({ items: o.items, total: o.total, version: o.version }), antes);
  assert.equal(t.base.ordenes.get('o1').version, 1, 'la base no subió la version (esta base falsa solo la sube con ítems)');
  const fila = t.pos.formatOrden({ ...o, estado: 'cerrada', cierraConVersion: true });
  assert.equal(Object.keys(fila).some((k) => /servid/i.test(k)), false);
  assert.equal(subidas(t).length, 0);
});
