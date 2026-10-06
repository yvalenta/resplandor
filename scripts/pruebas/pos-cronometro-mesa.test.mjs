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

function montar({ mesas = [mesaBase(3)], ordenes = [], almacen, base: opcionesBase = {}, documento = {}, extras = {} } = {}) {
  const reloj = { t: T0 };
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
  const base = crearBaseFalsa({ rol: 'admin', mesas, ordenes, ...opcionesBase });
  const t = crearPos({ base, almacen, extras: { Date: FechaFalsa, setInterval: relojes.setInterval, clearInterval: relojes.clearInterval, ...extras }, documento: { visibilityState: 'visible', ...documento } });
  Object.assign(t, { base, reloj, relojes });
  t.pos.usuario = YO;
  t.pos.remoto = 'ok';
  t.pos.ahoraMesas = reloj.t;
  /** Avanza el reloj `ms` y corre el tick del reloj de 1 minuto (como el setInterval real). */
  t.avanzar = (ms) => { reloj.t += ms; t.pos.ahoraMesas = reloj.t; };
  return t;
}
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

test('el eco de otra tablet: marcar llega con la columna y se ve servida; quitarla vuelve a contar; una tanda nueva que llega antes que el null ya cuenta de nuevo', () => {
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
  // la tanda nueva de otra tablet llega (más unidades, aún con servida_en) ANTES de que llegue su null
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: fila({ servida_en: new Date(t.reloj.t - 2 * MIN).toISOString() }) });
  assert.equal(t.pos.esperaMesa(3).servida, true);
  t.avanzar(MIN);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: fila({ items: [item('p1', 20000, 1), item('p2', 9000, 1)], version: 2, servida_en: new Date(t.reloj.t - 3 * MIN).toISOString() }) });
  assert.equal(t.pos.esperaMesa(3).servida, false, 'agregaron una tanda a una mesa servida: aquí ya cuenta de nuevo aunque el null aún no llegue');
  assert.equal(t.pos.esperaMesa(3).texto, 'ahora');
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: fila({ items: [item('p1', 20000, 1), item('p2', 9000, 1)], version: 2, servida_en: null }) });
  assert.equal(t.pos.esperaMesa(3).servida, false);
  assert.equal(t.pos.esperaMesa(3).texto, 'ahora', 'y cuando llega el null sigue igual');
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
