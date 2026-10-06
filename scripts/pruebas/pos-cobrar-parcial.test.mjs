// COBRAR POR PARTES Y ABONAR, ATÓMICOS EN LA BASE (tercera refutación, 2026-10-05; tareas/2026-10-04-hallazgos-domingo.md; migración 20261005140000_cobrar_parcial.sql).
// El POS REAL (el <script> de pos.html en un `vm`) contra la base falsa de _pos-vm.mjs, que modela `cobrar_parcial` y `cobrar_abono` con el mismo orden de juicios que la
// función (la versión, la promoción, las líneas, el id de cobro idempotente) y RECALCULA las promos como `trg_ordenes_a_precio_vivo`. Los mismos escenarios, contra Postgres con un mesero
// de verdad: migracion-cobrar-parcial.test.mjs; con supabase-js real en Chromium y esa base: pos-cobrar-parcial-real.test.mjs.
//
// El cobro hecho como «fila cerrada + deltas −qty por la cola» no converge: el orden de llegada decide el dinero. Ahora el POS, sin memoria nueva en la tablet:
//   A. UNA llamada: cobrar_parcial / cobrar_abono con la versión que vio, las líneas y un id de cobro; adopta las dos filas que devuelve la base. Ni un upsert de la venta ni un −qty.
//   B. Antes de llamar espera a que no haya cambios de ESA cuenta en camino (deltas en vuelo o en la cola); si la cola no se puede vaciar, es «sin red».
//   C. Sin red (el RESULTADO de la llamada: error de red o 10 s sin respuesta, no `remoto`): no se cobra, no se encola, la cuenta no cambia: «Sin red: el cobro por partes y los abonos
//      necesitan red; la mesa completa sí se puede cobrar». El mismo cobro repetido lleva los mismos ids: si la primera llamada sí llegó, la base devuelve lo mismo y no duplica.
//   D. Lo que la base rechaza (RS003 la cuenta cambió, RS005 promoción o archivada, RS006 pide lo que no hay, RS001 cerrada, permisos, la función no existe): nada sale de la cuenta, se avisa y se relee.
//   E. Los guiones de la segunda y la tercera refutación (80.200, 57.000, 54.000 / 50.400) ya no pueden producirse.
//   F. La mesa completa: «Imprimir» espera la confirmación como mucho 10 s y después imprime PROVISIONAL y lo dice; una cuenta con promoción pregunta si hay red antes de cobrar; sincronizarSupabase
//      marca «sin red» con el error de red que supabase-js DEVUELVE sin lanzar.
//   G. Deshacer: las ventas que crea la RPC se deshacen (la unidad vuelve y la promo se recalcula).
//   H. Estática: el POS no cobra por partes con un upsert ni con deltas, y no decide la red con `remoto`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  RAIZ, asentar, crearBaseFalsa, crearPos, hastaQue, mesaBase, ordenBase, normalizadorDeAlmuerzos, productosDelLunes, plano,
} from './_pos-vm.mjs';

const POS_HTML = fs.readFileSync(process.env.POS_HTML ? path.resolve(process.env.POS_HTML) : path.join(RAIZ, 'pos.html'), 'utf8');
const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const LUNES = '2026-10-05T18:00:00Z';     // 13:00 en Bogotá, lunes
const MARTES = '2026-10-06T18:00:00Z';

const SECO = (qty, nota = '') => ({ id: 'seco', nombre: 'Seco', precio: 19000, qty, nota });
const MENU = (qty, nota = '') => ({ id: 'menu', nombre: 'Menú Resplandor', precio: 23000, qty, nota });
const JUGO = (qty, nota = '') => ({ id: 'jugo', nombre: 'Jugo', precio: 12000, qty, nota });
const SOPA = (qty, nota = '') => ({ id: 'sopa', nombre: 'Sopa', precio: 21000, qty, nota });
const normalizar = normalizadorDeAlmuerzos();
const total = (items) => items.reduce((s, i) => s + i.precio * i.qty, 0);
const unidades = (items) => items.reduce((s, i) => s + i.qty, 0);
const ver = (items) => items.map((i) => `${i.qty}×${i.nombre}@${i.precio}`).join(' + ') + ` = ${total(items)}`;
const cerradas = (t) => [...t.base.ordenes.values()].filter((o) => o.estado === 'cerrada');
const local = (t, id = 'o1') => t.pos.ordenes.find((o) => o.id === id);
const lineas = (o) => o.items.map((i) => `${i.id}x${i.qty}`).sort();
const pagado = (t) => cerradas(t).reduce((s, o) => s + Number(o.total), 0) + Number(t.base.ordenes.get('o1')?.estado === 'abierta' ? t.base.ordenes.get('o1').total : 0);

/** Un POS con sesión sobre la base falsa. Los temporizadores largos (≥ 1,5 s: el tope de 10 s, el reintento de red, los reintentos de lectura) no corren solos: la prueba los dispara a mano. */
function montar({ items, abiertaEn = LUNES, version = 3, rol = 'mesero', productos = productosDelLunes(), cierres = [], normalizador = normalizar, olaC = true, almacen, base: baseDada } = {}) {
  const fila = { ...ordenBase('o1', 1, normalizador(items, { abierta_en: abiertaEn }), version), abierta_en: abiertaEn };
  const base = baseDada || crearBaseFalsa({ rol, mesas: [mesaBase(1)], ordenes: [fila], productos, cierres, olaC, normalizar: normalizador });
  const original = base.responder;
  base.responder = async (c) => { const r = await original(c); return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r; };
  const reales = { setTimeout, clearTimeout };
  const timers = [];
  const t = crearPos({
    base, almacen, reloj: abiertaEn,   // «hoy» es el día de la cuenta: la tablet predice la promo con la fecha de hoy
    extras: {
      setInterval() { return 1; }, clearInterval() {},
      setTimeout(fn, ms, ...resto) { if (ms >= 1500) { const h = { fn, ms, cancelado: false, unref() { return h; } }; timers.push(h); return h; } return reales.setTimeout(fn, ms, ...resto); },
      clearTimeout(h) { if (h && typeof h === 'object') { h.cancelado = true; return; } reales.clearTimeout(h); },
    },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  t.base = base; t.pos.usuario = YO; t.timers = timers;
  t.timer = (ms) => timers.find((h) => h.ms === ms && !h.cancelado);
  return t;
}
async function abrir(items, opciones = {}) {
  const t = montar({ items, ...opciones });
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  await asentar();
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 1));
  return t;
}
const producto = (t, id) => t.pos.productos.find((p) => p.id === id);
const sinRed = (t) => { t.base.red = false; t.pos.remoto = 'offline'; };
const conRed = (t) => { t.base.red = true; t.pos.remoto = 'ok'; };
/** Lo que otra tablet hizo en la base mientras esta no se enteraba. */
const otraTablet = (t, items) => { const o = t.base.ordenes.get('o1'); o.items = normalizar(items, o); o.total = total(o.items); o.version += 1; };
const hastaAviso = (t, re) => hastaQue(() => t.pos.aviso && re.test(t.pos.aviso.texto));
const llamadas = (t, nombre) => t.supabase.rpcs(nombre);
const SIN_RED = 'Sin red: el cobro por partes y los abonos necesitan red; la mesa completa sí se puede cobrar.';
const SIN_RED_DUDA = 'Sin red: el cobro por partes y los abonos necesitan red.';
const CONGELADA = 'Cobro pendiente de confirmar con la base: espera a que vuelva la red.';
/** El aviso de «sin red» de un cobro que SÍ salió hacia la base: que necesita red y que puede haber llegado (cuarta refutación); la cuenta queda CONGELADA (quinta) y por eso NO ofrece la mesa completa. */
const aviso_sin_red = (t) => {
  assert.ok(t.pos.aviso.texto.startsWith(SIN_RED_DUDA), t.pos.aviso.texto);
  assert.match(t.pos.aviso.texto, /Puede que el cobro sí haya llegado a la base y solo se perdió la respuesta/);
  assert.doesNotMatch(t.pos.aviso.texto, /la mesa completa sí se puede cobrar/);
  assert.equal(t.pos._cuentaCongelada('o1'), true, 'y la cuenta quedó congelada');
};
const SIN_RED_PROMO = /Sin red: esta cuenta tiene promoción; espera a que vuelva la red para cobrar/;
const CAMBIO = /La cuenta cambió: revísala y vuelve a cobrar/;
/** El «orden de llegada» a la base de lo que importa: cobros, deltas y upserts de órdenes. */
const orden = (t, desde = 0) => t.supabase.llamadas.slice(desde)
  .filter((c) => (c.tipo === 'rpc' && ['cobrar_parcial', 'cobrar_abono', 'aplicar_delta_orden'].includes(c.nombre)) || (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert'))
  .map((c) => (c.tipo === 'rpc' ? (c.nombre === 'aplicar_delta_orden' ? `delta ${c.args.p_item_id} ${c.args.p_delta}` : c.nombre) : `upsert ${c.cuerpo.estado}`));

// ═══════════════════ A. UNA llamada atómica; las dos filas que devuelve la base se adoptan ═══════════════════

test('A1 por partes (un mapa id → unidades), sin promoción: UNA llamada a cobrar_parcial con la versión, las líneas, el id de venta y el id de cobro; ni upsert de la venta ni −qty; la tablet adopta la venta y la cuenta de la base', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const n0 = t.supabase.llamadas.length;
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), true);
  await asentar(20);
  assert.deepEqual(orden(t, n0), ['cobrar_parcial'], 'una sola escritura hacia la base');
  const [llamada] = llamadas(t, 'cobrar_parcial');
  assert.deepEqual(Object.keys(llamada.args).sort(), ['p_delta_id', 'p_lineas', 'p_orden_id', 'p_venta', 'p_version']);
  assert.equal(llamada.args.p_orden_id, 'o1');
  assert.equal(llamada.args.p_version, 3, 'la versión que esta tablet vio');
  assert.deepEqual(plano(llamada.args.p_lineas), [{ id: 'seco', qty: 1 }]);
  assert.match(llamada.args.p_venta.id, /^[0-9a-z]+$/);
  assert.match(llamada.args.p_delta_id, /^[0-9a-z]+$/);
  assert.notEqual(llamada.args.p_delta_id, llamada.args.p_venta.id);
  // la base
  const [venta] = cerradas(t);
  assert.equal(venta.id, llamada.args.p_venta.id);
  assert.equal(venta.parcial_de, 'o1');
  assert.equal(venta.total, 19000);
  assert.equal(venta.total + t.base.ordenes.get('o1').total, 2 * 19000 + 12000);
  assert.equal(t.base.rpcs.length, 0, 'ningún delta');
  // la tablet adopta las DOS filas
  const v = t.pos.ordenes.find((o) => o.id === venta.id);
  assert.equal(v.estado, 'cerrada');
  assert.equal(v.parcialDe, 'o1');
  assert.equal(v.total, 19000);
  assert.equal(local(t).total, 31000);
  assert.equal(local(t).version, 4, 'la versión que subió la base');
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ticketMostrado.id, venta.id);
  assert.equal(t.pos.ticketMostrado.quedan, 31000, 'el ticket dice lo que queda (lo dijo la base)');
  assert.equal(t.pos.ultimoCobro.ordenId, venta.id, '«Cobrado $X · Deshacer»');
  assert.equal(t.pos.ultimoCobro.monto, 19000);
  assert.equal(t.pos.seleccionCobro, false);
  assert.deepEqual(plano(t.pos.itemsSeleccionados), {});
  assert.equal(t.pos.cobrandoParcial, false);
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(Object.keys(plano(t.pos._pendientes)).length, 0, 'nada marcado como sin subir');
  assert.equal(t.avisos.length, 0);
});

test('A2 por unidades (n de una línea) y por lista de ids (líneas completas): lo que se manda son líneas {id, qty}; cada cobro es UNA llamada y la cuenta cuadra', async () => {
  const t = await abrir([SECO(4), JUGO(2)], { abiertaEn: MARTES });
  t.pos.toggleModoCobroParcial();
  const seco = local(t).items.find((i) => i.id === 'seco');
  t.pos.toggleSeleccion(seco);
  t.pos.ajustarCantidadSeleccion(seco, -2);                              // 2 de 4
  assert.equal(await t.pos.facturarParcial(), true);
  assert.deepEqual(plano(llamadas(t, 'cobrar_parcial')[0].args.p_lineas), [{ id: 'seco', qty: 2 }]);
  t.pos.vista = 'orden'; t.pos.ticketMostrado = null;
  assert.equal(await t.pos.facturarParcial(['jugo']), true, 'la firma de antes: una lista de ids cobra cada línea COMPLETA');
  assert.deepEqual(plano(llamadas(t, 'cobrar_parcial')[1].args.p_lineas), [{ id: 'jugo', qty: 2 }]);
  assert.equal(llamadas(t, 'cobrar_parcial')[1].args.p_version, 4, 'la versión del segundo cobro es la que devolvió la base tras el primero');
  assert.equal(cerradas(t).length, 2);
  assert.equal(pagado(t), 4 * 19000 + 2 * 12000, 'lo cobrado + lo que queda = la cuenta');
  assert.equal(t.base.rpcs.length, 0);
});

test('A3 por persona (cobrarGrupoPersona): cobra las líneas de esa persona, el ticket lleva su nombre (solo local) y la base no recibe «persona»', async () => {
  const t = await abrir([SOPA(2, 'Persona 1'), JUGO(1, 'Persona 2')], { abiertaEn: MARTES });
  assert.equal(await t.pos.cobrarGrupoPersona('Persona 1'), true);
  assert.deepEqual(plano(llamadas(t, 'cobrar_parcial')[0].args.p_lineas), [{ id: 'sopa', qty: 2 }]);
  assert.equal(t.pos.ticketMostrado.persona, 'Persona 1');
  assert.equal(JSON.stringify(llamadas(t, 'cobrar_parcial')[0].args).includes('persona'), false);
  assert.equal('persona' in cerradas(t)[0], false);
  assert.equal(local(t).items.length, 1);
});

test('A4 el abono: UNA llamada a cobrar_abono (uid, monto, método, versión, id de cobro); la base pone la venta «Abono» y el crédito juntos; ni upsert ni +1; el ticket dice cuánto queda', async () => {
  const t = await abrir([SOPA(2), JUGO(1)], { abiertaEn: MARTES });
  const n0 = t.supabase.llamadas.length;
  t.pos.toggleModoCobroParcial();
  t.pos.montoAbono = '15.000'; t.pos.metodoAbono = 'qr';
  assert.equal(await t.pos.cobrarMonto(), true);
  await asentar(20);
  assert.deepEqual(orden(t, n0), ['cobrar_abono']);
  const a = llamadas(t, 'cobrar_abono')[0].args;
  assert.deepEqual(Object.keys(a).sort(), ['p_delta_id', 'p_metodo', 'p_monto', 'p_orden_id', 'p_venta', 'p_version']);
  assert.equal(a.p_monto, 15000); assert.equal(a.p_metodo, 'qr'); assert.equal(a.p_version, 3);
  assert.deepEqual(Object.keys(a.p_venta).sort(), ['id', 'uid']);
  const [venta] = cerradas(t);
  assert.equal(venta.items[0].id, 'abono_' + a.p_venta.uid);
  assert.equal(venta.total, 15000);
  const credito = t.base.ordenes.get('o1').items.find((i) => i.id.startsWith('abono_recibido_'));
  assert.equal(credito.id, 'abono_recibido_' + a.p_venta.uid, 'el mismo uid: deshacer_cobro quita la línea de ESTE abono');
  assert.equal(credito.precio, -15000);
  assert.equal(t.base.ordenes.get('o1').total, 54000 - 15000);
  assert.equal(local(t).total, 39000, 'la tablet adoptó la cuenta de la base (con su crédito)');
  assert.deepEqual(plano(t.pos.ticketMostrado.abono), { monto: 15000, metodo: 'qr', quedan: 39000, mesaId: 1 });
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ultimoCobro.tipo, 'abono');
  assert.equal(t.pos.montoAbono, '');
  assert.equal(t.base.rpcs.length, 0, 'ningún +1 del crédito');
});

test('A4b el método del abono: qr y transferencia se respetan; cualquier otra cosa (o nada) se manda como efectivo', async () => {
  for (const [pedido, esperado] of [['transferencia', 'transferencia'], ['qr', 'qr'], ['bitcoin', 'efectivo'], [undefined, 'efectivo']]) {
    const t = await abrir([SOPA(2), JUGO(1)], { abiertaEn: MARTES });
    t.pos.toggleModoCobroParcial();
    t.pos.montoAbono = '5000'; t.pos.metodoAbono = pedido;
    assert.equal(await t.pos.cobrarMonto(), true);
    assert.equal(llamadas(t, 'cobrar_abono')[0].args.p_metodo, esperado);
    assert.equal(cerradas(t)[0].items[0].nota, esperado);
  }
});

test('A5 el abono por el total (monto = lo que falta) es el cobro normal de la mesa completa, no una llamada a cobrar_abono', async () => {
  const t = await abrir([SOPA(2)], { abiertaEn: MARTES });
  t.pos.toggleModoCobroParcial();
  t.pos.montoAbono = '42000';
  assert.equal(await t.pos.cobrarMonto(), true);
  await asentar(20);
  assert.equal(llamadas(t, 'cobrar_abono').length, 0);
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
});

test('A6 «Todo para llevar»: la venta lleva una copia del marcador (cantidad 1, $0) y la cuenta lo CONSERVA; el abono no copia el marcador', async () => {
  const t = await abrir([SOPA(2), { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' }], { abiertaEn: MARTES });
  assert.equal(await t.pos.facturarParcial({ sopa: 1 }), true);
  assert.deepEqual(plano(llamadas(t, 'cobrar_parcial')[0].args.p_lineas), [{ id: 'sopa', qty: 1 }], 'el marcador no va entre las líneas: lo agrega la base');
  assert.deepEqual(cerradas(t)[0].items.map((i) => `${i.id}x${i.qty}`), ['sopax1', 'para_llevarx1']);
  assert.deepEqual(lineas(local(t)), ['para_llevarx1', 'sopax1']);
  t.pos.vista = 'orden'; t.pos.ticketMostrado = null;
  t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '5000';
  assert.equal(await t.pos.cobrarMonto(), true);
  assert.equal(cerradas(t).find((o) => String(o.items[0].id).startsWith('abono_')).items.length, 1, 'el abono es una sola línea');
});

test('A7 mientras la base cobra, `cobrandoParcial` está encendido (apaga los botones) y un segundo toque NO manda un segundo cobro; al terminar se apaga', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  t.base.responder = async (c) => { if (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial') await new Promise((r) => setTimeout(r, 80)); return original(c); };
  const primero = t.pos.facturarParcial({ seco: 1 });
  await asentar(5);
  assert.equal(t.pos.cobrandoParcial, true);
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false, 'el segundo toque se ignora');
  assert.equal(await primero, true);
  assert.equal(t.pos.cobrandoParcial, false);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1);
  assert.equal(cerradas(t).length, 1);
});

test('A7b mientras un cobro por partes va hacia la base, «Generar ticket y cobrar» NO cierra la mesa (cruzaría dos cobros de la misma cuenta): avisa, no manda nada; terminado el cobro, la mesa completa se cobra con lo que queda', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  t.base.responder = async (c) => { if (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial') await new Promise((r) => setTimeout(r, 80)); return original(c); };
  const primero = t.pos.facturarParcial({ seco: 1 });
  await asentar(5);
  assert.equal(t.pos.cobrandoParcial, true);
  const antes = t.supabase.llamadas.length;
  t.pos.facturar();
  await asentar(5);
  assert.match(t.pos.aviso.texto, /Se está registrando un cobro de esta mesa: espera a que termine y vuelve a tocar «Generar ticket y cobrar»/);
  assert.equal(t.pos.modalConfirmFactura, false);
  assert.equal(local(t).estado, 'abierta', 'la cuenta sigue abierta en la tablet');
  assert.equal(t.supabase.llamadas.slice(antes).filter((c) => c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert').length, 0, 'ningún cierre se mandó');
  assert.equal(await primero, true);
  t.pos.facturar();
  await hastaQue(() => local(t).estado === 'cerrada');
  await asentar();
  assert.equal(cerradas(t).length, 2, 'el cobro por partes y la mesa completa con lo que quedaba');
  assert.equal(pagado(t), total([SECO(2), JUGO(1)]));
});

test('A8 la base cobra lo que ELLA dice (el precio de hoy de la cuenta): si el total no es el que la tablet mostraba, lo avisa y el ticket dice el de la base', async () => {
  const t = await abrir([SOPA(2), JUGO(1)], { abiertaEn: MARTES });
  // el precio del Jugo cambió en la base y la copia de la tablet no se enteró: la base, al normalizar la cuenta, lo cobra a 14.000
  t.base.normalizar = (items) => items.map((i) => (i.id === 'jugo' ? { ...i, precio: 14000 } : i));
  assert.equal(await t.pos.facturarParcial({ jugo: 1 }), true);
  assert.equal(cerradas(t)[0].total, 14000);
  assert.equal(t.pos.ticketMostrado.total, 14000, 'el ticket dice lo que la base cobró');
  assert.match(t.pos.aviso.texto, /La base cobró \$ 14\.000 \(la tablet mostraba \$ 12\.000\)/);
});

test('A9 el eco de Realtime llega ANTES que la respuesta del cobro: se une sin duplicar la venta ni pisar la cuenta con una versión menor', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  t.base.responder = async (c) => {
    const r = await original(c);
    if (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial' && r.data && r.data.ok) {
      t.pos.procesarCambioEnVivo('ordenes', { eventType: 'INSERT', new: JSON.parse(JSON.stringify(r.data.venta)) });
      t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(r.data.cuenta)) });
    }
    return r;
  };
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), true);
  await asentar(10);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 1, 'una sola venta en la tablet');
  assert.equal(local(t).version, 4);
  assert.equal(local(t).total, 31000);
  assert.equal(t.pos.ticketMostrado.id, cerradas(t)[0].id);
  assert.equal(t.pos.ticketMostrado.quedan, 31000);
});

test('A10 un cambio de la cuenta MIENTRAS la base cobra no pasa (la cuenta está congelada desde que sale la llamada): el +1 no se agrega, no sube nada, y lo que la tablet adopta es lo que la base devolvió', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  let intento = false;
  t.base.responder = async (c) => {
    const r = await original(c);
    if (!intento && c.tipo === 'rpc' && c.nombre === 'cobrar_parcial') { intento = true; t.pos.agregarProducto(producto(t, 'jugo')); }   // el mesero toca «+» justo mientras responde la base
    return r;
  };
  const n0 = t.supabase.llamadas.length;
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), true);
  const jugo = local(t).items.find((i) => i.id === 'jugo');
  assert.equal(jugo.qty, 1, 'el Jugo del toque no entró: la cuenta estaba congelada');
  assert.equal(local(t).items.find((i) => i.id === 'seco').qty, 1, 'y el Seco cobrado ya no está');
  await asentar(30);
  assert.deepEqual(orden(t, n0), ['cobrar_parcial'], 'nada más salió hacia la base');
  assert.equal(t.base.ordenes.get('o1').items.find((i) => i.id === 'jugo').qty, 1);
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(local(t).version, t.base.ordenes.get('o1').version, 'la copia es la de la base');
});

// ═══════════════════ B. Antes de llamar, la cuenta no tiene cambios en camino ═══════════════════

test('B1 un delta de ESA cuenta en vuelo (la base tarda): la llamada de cobro sale DESPUÉS de que llegó, y con la versión que la base le dio a la cuenta', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  t.base.responder = async (c) => { if (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden') await new Promise((r) => setTimeout(r, 60)); return original(c); };
  const n0 = t.supabase.llamadas.length;
  t.pos.agregarProducto(producto(t, 'sopa'));                            // delta +1 de una Sopa, todavía en vuelo
  const cobro = t.pos.facturarParcial({ jugo: 1 });
  assert.equal(await cobro, true);
  assert.deepEqual(orden(t, n0), ['delta sopa 1', 'cobrar_parcial'], 'primero lo que ya iba en camino, después el cobro');
  assert.equal(llamadas(t, 'cobrar_parcial')[0].args.p_version, 4, 'la versión que la base le puso a la cuenta tras ese delta (no la de antes: 3)');
  assert.equal(cerradas(t).length, 1);
  assert.equal(t.base.ordenes.get('o1').items.find((i) => i.id === 'sopa').qty, 1);
});

test('B2 un delta de esa cuenta en la COLA (falló antes) y la red ya volvió: se vacía la cola y DESPUÉS sale el cobro (con la versión nueva)', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  t.base.red = false;
  t.pos.agregarProducto(producto(t, 'sopa'));
  await asentar(20);
  assert.equal(t.pos.colaDeltas.length, 1, 'el +1 quedó en la cola');
  t.base.red = true;                                                    // la red volvió y `remoto` nunca dejó de ser «ok»
  const n0 = t.supabase.llamadas.length;
  assert.equal(await t.pos.facturarParcial({ jugo: 1 }), true);
  assert.deepEqual(orden(t, n0), ['delta sopa 1', 'cobrar_parcial']);
  assert.equal(llamadas(t, 'cobrar_parcial')[0].args.p_version, 4);
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('B4 el eco de Realtime reemplaza la cuenta MIENTRAS el delta va en vuelo: el cobro lleva la versión de la cuenta de ahora (la del objeto nuevo), no la del objeto con que se empezó', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  t.base.responder = async (c) => {
    const r = await original(c);
    if (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden') {   // el eco de ese mismo delta llega ANTES que su respuesta y trae un objeto nuevo de la cuenta
      t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(t.base.ordenes.get('o1'))) });
      await new Promise((x) => setTimeout(x, 30));
    }
    return r;
  };
  const vieja = local(t);
  t.pos.agregarProducto(producto(t, 'sopa'));
  assert.equal(await t.pos.facturarParcial({ jugo: 1 }), true);
  assert.notEqual(local(t), vieja, 'la cuenta de la tablet es otro objeto');
  assert.equal(llamadas(t, 'cobrar_parcial')[0].args.p_version, 4, 'con la versión que tiene la cuenta de ahora');
  assert.equal(cerradas(t).length, 1);
});

test('B3 un delta en la cola que NO se puede vaciar (sin red): no se llama a la base para cobrar, se dice «Sin red…» y la cuenta no cambia', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  t.base.red = false;
  t.pos.agregarProducto(producto(t, 'sopa'));
  await asentar(20);
  const antes = JSON.stringify(plano(local(t).items));
  assert.equal(await t.pos.facturarParcial({ jugo: 1 }), false);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 0, 'ni se intentó: lo que está en camino tiene que llegar primero');
  assert.equal(t.pos.aviso.texto, SIN_RED);
  assert.equal(JSON.stringify(plano(local(t).items)), antes);
  assert.equal(t.pos.colaDeltas.length, 1, 'la cola sigue con su +1, y solo con él');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0);
});

// ═══════════════════ C. Sin red: el RESULTADO de la llamada lo dice ═══════════════════

test('C1 sin red de verdad (la base responde como supabase-js sin red: {error: Failed to fetch}, SIN tocar `remoto`): el aviso exacto, nada cambia —ni la cuenta, ni una venta, ni la cola, ni lo pendiente—, y la tablet queda «sin red»', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  t.base.red = false;
  assert.equal(t.pos.remoto, 'ok', 'la tablet aún cree que hay red');
  const antes = JSON.stringify(plano(local(t)));
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(local(t).items.find((i) => i.id === 'seco'));
  assert.equal(await t.pos.facturarParcial(), false);
  aviso_sin_red(t);
  assert.equal(JSON.stringify(plano(local(t))), antes, 'la cuenta es la misma');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'ni una venta local');
  assert.equal(t.pos.colaDeltas.length, 0, 'ni nada en la cola');
  assert.equal(t.almacen.has('pos_delta_queue'), false);
  assert.equal(Object.keys(plano(t.pos._pendientes)).length, 0, 'ni nada marcado como sin subir');
  assert.equal(t.pos.ultimoCobro, null);
  assert.equal(t.pos.vista, 'orden');
  assert.equal(t.pos.cobrandoParcial, false);
  assert.equal(t.pos.remoto, 'offline', 'el resultado de la llamada dice que no hay red');
  assert.equal(t.pos.seleccionCobro, true, 'la selección sigue ahí: se puede volver a intentar');
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.base.ordenes.get('o1').total, 2 * 19000 + 12000);
});

test('C2 lo mismo con el abono: sin red no se cobra, no se encola, el monto sigue escrito y la cuenta no cambia', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  t.base.red = false;
  t.pos.toggleModoCobroParcial();
  t.pos.montoAbono = '10000';
  assert.equal(await t.pos.cobrarMonto(), false);
  aviso_sin_red(t);
  assert.equal(t.pos.montoAbono, '10000');
  assert.equal(local(t).total, 50000);
  assert.equal(local(t).items.some((i) => i.id.startsWith('abono_recibido_')), false);
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0);
});

test('C3 la RESPUESTA se pierde (la base SÍ cobró): el POS dice «Sin red…» y no cambia nada; repetir el MISMO cobro NO sale (la cuenta está congelada) y «Reintentar ahora» le pregunta a la base: adopta la venta, hay UNA sola', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  t.base.cobroRespuestaPerdida = true;
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  aviso_sin_red(t);
  assert.equal(cerradas(t).length, 1, 'la base sí lo aplicó');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'pero la tablet no lo sabe: no inventa una venta');
  assert.equal(local(t).total, 50000, 'su cuenta sigue como la vio');
  const primera = llamadas(t, 'cobrar_parcial')[0].args;
  t.base.cobroRespuestaPerdida = false;
  t.pos.avisar('');
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false, 'el mismo cobro, otra vez: NO sale, la cuenta está congelada');
  assert.equal(t.pos.aviso.texto, CONGELADA);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'ninguna segunda llamada de cobro');
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado', '«Reintentar ahora»: le pregunta a la base por ese id');
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'preguntar no cobra');
  assert.equal(cerradas(t).length, 1, 'una sola venta en la base');
  assert.equal(cerradas(t)[0].id, primera.p_venta.id, 'y es la venta del primer intento');
  assert.equal(t.base.ordenes.get('o1').total, 31000, 'y la cuenta con UNA sola resta');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 1);
  assert.equal(local(t).total, 31000);
  assert.equal(t.pos.ticketMostrado.id, primera.p_venta.id);
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos._cuentaCongelada('o1'), false);
});

test('C3b un cobro DISTINTO (otra selección) después de un fallo de red NO sale a ciegas: la cuenta está congelada, no hay llamada nueva; cuando la base contesta (el anterior sí llegó) se adopta con su ticket y un aviso, y el cobro distinto sale después con ids propios', async () => {
  const t = await abrir([SECO(3), JUGO(1)], { abiertaEn: MARTES });
  t.base.cobroRespuestaPerdida = true;
  await t.pos.facturarParcial({ seco: 1 });
  const primera = llamadas(t, 'cobrar_parcial')[0].args;
  t.base.cobroRespuestaPerdida = false;
  assert.equal(await t.pos.facturarParcial({ seco: 2 }), false, 'otra selección: mientras no se sepa qué pasó con la anterior, nada sale');
  assert.equal(t.pos.aviso.texto, CONGELADA);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'el cobro nuevo NO salió hacia la base');
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado');
  assert.match(t.pos.aviso.texto, /SÍ quedó registrado en la base/);
  await asentar(30);
  assert.equal(cerradas(t).length, 1, 'solo la que la base ya había hecho');
  assert.equal(t.pos.ticketMostrado.id, primera.p_venta.id, 'se muestra el ticket del cobro que sí quedó');
  assert.equal(local(t).total, total(t.base.ordenes.get('o1').items), 'la tablet adoptó la cuenta de la base (con la resta ya hecha)');
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {}, 'y ya no hay nada en duda');
  // descongelada, el cobro distinto sale con ids propios
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 1));
  assert.equal(await t.pos.facturarParcial({ seco: 2 }), true);
  const segunda = llamadas(t, 'cobrar_parcial')[1].args;
  assert.notEqual(segunda.p_delta_id, primera.p_delta_id);
  assert.notEqual(segunda.p_venta.id, primera.p_venta.id);
  assert.equal(cerradas(t).length, 2);
});

test('C4 el TOPE de 10 s: la base no contesta; al vencer, «Sin red…» (y que si el cobro llegó, aparecerá en las transacciones), nada cambia y la tablet queda «sin red»; si la respuesta llega después, se ignora', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial' ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));
  const cobro = t.pos.facturarParcial({ seco: 1 });
  await hastaQue(() => !!soltar);                                        // la llamada ya está en vuelo (la espera de la cola, con su propio tope, ya terminó)
  assert.ok(t.timer(10000), 'hay un tope de 10 s esperando la respuesta');
  assert.equal(t.pos.cobrandoParcial, true);
  t.timer(10000).fn();                                                   // pasan los 10 s
  assert.equal(await cobro, false);
  aviso_sin_red(t);                                                      // «Sin red…» y que puede haber llegado
  assert.equal(t.pos.remoto, 'offline');
  assert.equal(t.pos.cobrandoParcial, false);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0);
  assert.equal(t.pos.colaDeltas.length, 0);
  const antes = JSON.stringify(plano(local(t)));
  soltar();                                                              // la base contesta tarde (sí cobró): el POS ya se fue, no adopta nada a ciegas
  await asentar(30);
  assert.equal(JSON.stringify(plano(local(t))), antes);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0);
  assert.equal(cerradas(t).length, 1, 'la base sí lo aplicó (por eso el aviso dice dónde mirar)');
});

test('C5 un 5xx sin código (la infraestructura caída) y un «Load failed» de Safari cuentan como sin red; un error CON código de la base no', async () => {
  for (const [error, estado, esperaRed] of [
    [{ message: 'Bad Gateway', code: '' }, 502, true],
    [{ message: 'Load failed', code: '' }, undefined, true],
    [{ message: 'NetworkError when attempting to fetch resource.', code: '' }, undefined, true],
    [{ message: 'upstream connect error', code: '' }, 503, true],
    [{ message: 'duplicate key value violates unique constraint', code: '23505' }, 409, false],
  ]) {
    const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
    const original = t.base.responder;
    t.base.responder = async (c) => (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial' ? { data: null, error, status: estado } : original(c));
    assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
    assert.equal(t.pos.aviso.texto.startsWith(SIN_RED_DUDA), esperaRed, `${error.message}`);
    assert.equal(t.pos.remoto, esperaRed ? 'offline' : 'ok');
  }
});

test('C6 el RESULTADO decide, no `remoto`: con `remoto` en «offline» pero la base respondiendo, el cobro se hace (y `remoto` vuelve a «ok»); con `remoto` en «ok» y la red caída, no', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  t.pos.remoto = 'offline';                                              // quedó marcada sin red, pero la base está ahí
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), true);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'se le preguntó a la base aunque `remoto` dijera «offline»');
  assert.equal(t.pos.remoto, 'ok', 'una respuesta de la base prueba que hay red');
  assert.equal(cerradas(t).length, 1);
  const u = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  u.base.red = false;
  assert.equal(u.pos.remoto, 'ok');
  assert.equal(await u.pos.facturarParcial({ seco: 1 }), false);
  aviso_sin_red(u);
});

// ═══════════════════ D. Lo que la base rechaza: nada sale de la cuenta y se relee ═══════════════════

test('D1 RS003 (la tablet está atrasada: otra tablet cambió la cuenta): «La cuenta cambió: revísala y vuelve a cobrar», nada se cobra y la tablet adopta la cuenta de la base', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const n = t.base.ordenes.get('o1');
  n.items = [SECO(2), JUGO(3)]; n.total = total(n.items); n.version += 1;       // otra tablet sumó dos Jugo y el eco no llegó
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(local(t).items.find((i) => i.id === 'seco'));
  assert.equal(await t.pos.facturarParcial(), false);
  assert.match(t.pos.aviso.texto, CAMBIO);
  assert.equal(t.base.cobros.at(-1).resultado, 'RS003');
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.base.rpcs.length, 0);
  await asentar(30);
  assert.equal(local(t).items.find((i) => i.id === 'jugo').qty, 3, 'la tablet releyó y adoptó la cuenta de la base');
  assert.equal(local(t).version, n.version);
  assert.deepEqual(plano(t.pos.itemsSeleccionados), {}, 'la selección vieja se suelta');
  assert.equal(t.pos.ticketMostrado, null);
});

test('D2 RS003 con un abono: lo mismo (el abono tampoco se hace con una cuenta que cambió)', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  otraTablet(t, [SECO(2), JUGO(2)]);
  t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '10000';
  assert.equal(await t.pos.cobrarMonto(), false);
  assert.match(t.pos.aviso.texto, CAMBIO);
  assert.equal(cerradas(t).length, 0);
  await asentar(30);
  assert.equal(local(t).total, 50000 + 12000);
});

test('D3 RS005 por PROMOCIÓN (la tablet no la vio: su copia es anterior): se avisa, nada sale de la cuenta y se adopta la cuenta con su línea de promo', async () => {
  // la copia de la tablet está al día en la versión (la base no cambió) pero sin la línea de promo: la base la ve y no deja partir la cuenta
  const t2 = await abrir([SECO(3)]);
  local(t2).items = [SECO(3)]; local(t2).total = 57000;
  t2.pos.productos = t2.pos.productos.map((p) => ({ ...p, promoRegla: null }));   // el catálogo de esta tablet es anterior a la regla: no la conoce (con ella, la tablet ni ofrecería partir: ver pos-cuenta-congelada H1)
  assert.equal(t2.pos.cuentaConPromo, false, 'el POS sí ofrece cobrar por partes');
  assert.equal(await t2.pos.facturarParcial({ seco: 1 }), false);
  assert.equal(t2.base.cobros.at(-1).resultado, 'RS005');
  assert.match(t2.pos.aviso.texto, /NO quedó registrado: esa cuenta tiene una promoción/);
  assert.match(t2.pos.aviso.texto, /Si ya recibiste el pago, no lo pierdas de vista: cobra la mesa completa, o recibe un abono por cada quien/);
  await asentar(30);
  assert.equal(cerradas(t2).length, 0);
  assert.equal(t2.base.rpcs.length, 0);
  assert.equal(local(t2).total, 53200, 'la tablet muestra lo de la base');
  assert.ok(local(t2).items.some((i) => String(i.id).startsWith('promo:')));
  assert.equal(t2.pos.cuentaConPromo, true);
});

test('D4 RS005 por cuenta ARCHIVADA en un cierre (y abierta): el aviso del cierre del día; nada se cobra', async () => {
  const venta = { id: 'o1', mesa_id: 1, estado: 'cerrada', items: [SECO(2)], total: 38000, abierta_en: LUNES, cerrada_en: LUNES, version: 2 };
  const cierre = { id: 'k-viejo', fecha: '2026-10-04T23:00:00Z', total_ventas: 38000, total_ordenes: 1, transacciones: [venta] };
  const t = await abrir([SECO(2)], { cierres: [cierre], abiertaEn: MARTES });
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  assert.match(t.pos.aviso.texto, /esa cuenta ya estaba en un cierre del día/);
  assert.doesNotMatch(t.pos.aviso.texto, /promoción/);
  assert.equal(cerradas(t).length, 0);
});

test('D5 RS006 (pide lo que la cuenta no tiene): «La cuenta cambió», la cuenta se relee y no sale nada; también un abono que no cabe', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const cuenta = local(t);
  assert.equal(await t.pos._cobrarEnBase({ orden: cuenta, tipo: 'parcial', lineas: [{ id: 'seco', qty: 5 }], subtotal: 95000 }), false);
  assert.equal(t.base.cobros.at(-1).resultado, 'RS006');
  assert.match(t.pos.aviso.texto, CAMBIO);
  assert.equal(await t.pos._cobrarEnBase({ orden: local(t), tipo: 'abono', monto: 50000, metodo: 'efectivo' }), false);
  assert.equal(t.base.cobros.at(-1).resultado, 'RS006', 'un abono igual o mayor que lo que falta es el cobro normal');
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.base.ordenes.get('o1').total, 50000);
});

test('D6 RS001 / «no existe» (otra tablet cobró o liberó la mesa): se dice que la cuenta ya no está abierta, nada se cobra y se vuelve a leer', async () => {
  for (const rol of ['admin', 'mesero']) {
    const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES, rol });
    Object.assign(t.base.ordenes.get('o1'), { estado: 'cerrada', cerrada_en: new Date().toISOString(), version: 4 });
    assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
    assert.equal(t.base.cobros.at(-1).resultado, rol === 'admin' ? 'RS001' : 'P0001');
    assert.match(t.pos.aviso.texto, /ya no está abierta \(otra tablet la cobró o la liberó\)/, rol);
    assert.equal(t.base.ordenes.get('o1').total, 50000, 'la venta cerrada no se tocó');
    assert.equal([...t.base.ordenes.values()].length, 1);
  }
});

test('D7 permisos (42501), la función que no existe (PGRST202, la base sin la migración) y un error cualquiera de la base: cada uno su aviso, «No se cobró nada», y nada sale de la cuenta', async () => {
  const casos = [
    [{ code: '42501', message: 'permission denied for function cobrar_parcial' }, /no tiene permiso para cobrar/],
    [{ code: 'PGRST202', message: 'Could not find the function public.cobrar_parcial in the schema cache' }, /falta aplicar en la base la actualización del cobro por partes y los abonos/],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "ordenes_pkey"' }, /la base contestó con un error \(duplicate key[^)]*\)\. No se cobró nada/],
  ];
  for (const [error, re] of casos) {
    const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
    const original = t.base.responder;
    t.base.responder = async (c) => (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial' ? { data: null, error } : original(c));
    assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
    assert.match(t.pos.aviso.texto, re, error.code);
    assert.match(t.pos.aviso.texto, /No se cobró nada|NO quedó registrado|no se hizo/);
    assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0);
    assert.equal(t.pos.colaDeltas.length, 0);
    assert.equal(local(t).total, 50000);
  }
});

test('D8 la lectura que sigue a un rechazo falla: la copia queda «sin confirmar» y NO se cobra (mesa completa, por partes, abono) hasta releerla; una lectura de la base la reemplaza', async () => {
  const t = await abrir([MENU(2), SECO(1)]);
  local(t).items = [MENU(1), SECO(1)]; local(t).total = 42000;          // copia atrasada: la base ya tiene 2 Menú + «3er almuerzo»
  local(t).version = t.base.ordenes.get('o1').version;
  t.base.fallar('select:ordenes');
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  await asentar(40);
  assert.equal(local(t).sinConfirmar, true);
  assert.match(t.pos.motivoSinCobro, /sin confirmar/i);
  t.pos.facturar();
  assert.equal(local(t).estado, 'abierta');
  assert.equal(await t.pos.facturarParcial({ menu: 1 }), false);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'no se le vuelve a preguntar a la base con una copia sin confirmar');
  t.base.repararTodo();
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  await asentar(20);
  assert.ok(!local(t).sinConfirmar);
  assert.equal(local(t).total, 61200);
});

// ═══════════════════ E. Los guiones de la segunda y la tercera refutación ya no se pueden producir ═══════════════════

test('E1 (r2, 80.200) una tablet con la copia atrasada (1 Menú + 1 Seco) cobra «el Seco» cuando la base ya tiene 2 Menú + «Seco · 3er almuerzo»: se rechaza, la cuenta queda en 61.200 y NO se suma ningún Seco de más', async () => {
  const t = await abrir([MENU(2), SECO(1)]);
  assert.equal(total(t.base.ordenes.get('o1').items), 61200, ver(t.base.ordenes.get('o1').items));
  local(t).items = [MENU(1), SECO(1)]; local(t).total = 42000;
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  await asentar(40);
  const o = t.base.ordenes.get('o1');
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.base.rpcs.length, 0, 'ningún delta: ni el −1 que no encuentra su línea ni el +1 «de vuelta»');
  assert.equal(o.total, 61200, ver(o.items));
  assert.equal(unidades(o.items), 3);
  assert.equal(local(t).total, 61200, 'y la tablet adoptó la de la base');
});

test('E2 (r3 A) sin red de verdad, sincronizarSupabase deja `remoto` en «offline» (supabase-js no lanza: devuelve {error}); la cuenta de 3 Seco del lunes queda bloqueada', async () => {
  const t = await abrir([SECO(2)]);
  t.base.red = false;
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(t.pos.remoto, 'offline', 'antes quedaba «ok»');
  t.pos.agregarProducto(producto(t, 'seco'));                            // el tercer Seco: el delta no sale y queda en la cola
  await asentar(20);
  assert.match(t.pos.motivoSinCobro, SIN_RED_PROMO);
  assert.ok(t.timer(8000), 'y la tablet vuelve a preguntar sola cada 8 s');
});

test('E3 (r3 B, 57.000) 2 Seco + un tercero que no llegó (sin red) + un Seco por partes: NO se cobra por partes; al volver la red la cuenta es de 3 Seco juntos y la mesa paga 53.200', async () => {
  const t = await abrir([SECO(2)]);
  t.base.red = false;
  t.pos.agregarProducto(producto(t, 'seco'));
  await asentar(20);
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0);
  t.base.red = true;
  await t.pos._subirLoPendiente();
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  await asentar(60);
  assert.equal(pagado(t) + 0, 53200, `la mesa paga ${pagado(t)}`);
  assert.equal(cerradas(t).length, 0);
  assert.equal(total(t.base.ordenes.get('o1').items), 53200, ver(t.base.ordenes.get('o1').items));
});

test('E4 (r3 D) sin red de verdad (la red caída, `remoto` todavía «ok»), la mesa completa de 2 Seco + un tercero NO se cobra: «Generar ticket y cobrar» sondea la red, no hay, y lo dice (el papel no puede decir 57.000 cuando la base registrará 53.200)', async () => {
  const t = await abrir([SECO(2)]);
  t.base.red = false;
  t.pos.agregarProducto(producto(t, 'seco'));
  await asentar(20);
  assert.equal(t.pos.remoto, 'ok');
  await t.pos.facturar();
  assert.equal(local(t).estado, 'abierta', 'no se cerró nada');
  assert.match(t.pos.aviso.texto, SIN_RED_PROMO);
  assert.equal(t.pos.vista, 'orden');
  assert.equal(t.pos.remoto, 'offline', 'y la tablet anotó que no hay red');
  t.base.red = true;
  await t.pos._subirLoPendiente(); await t.pos.sincronizarSupabase({ soloEnVivo: true });
  await asentar(40);
  assert.equal(t.base.ordenes.get('o1').estado, 'abierta');
  assert.equal(t.base.ordenes.get('o1').total, 53200);
});

test('E5 (r3 E) la red vuelve y el navegador dispara «online» antes de la resincronización: el oyente vacía la cola y nadie cobró por partes: la mesa paga 53.200', async () => {
  const t = await abrir([SECO(2)]);
  t.base.red = false;
  t.pos.agregarProducto(producto(t, 'seco'));
  await asentar(20);
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  t.base.red = true;
  for (const fn of (t.oyentes.ventana.online || [])) fn();
  await asentar(40);
  await t.pos._subirLoPendiente();
  await asentar(60);
  assert.equal(pagado(t), 53200);
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('E6 (r3 F) EN LÍNEA: el +1 del tercer Seco falló una vez y quedó en la cola; con 3 Seco un lunes la tablet SABE que la base pone la promoción: no deja cobrar un Seco por partes (ni llama), y la mesa paga 53.200 cuando la cola sube', async () => {
  const t = await abrir([SECO(2)]);
  t.base.fallar('rpc:aplicar_delta_orden');
  t.pos.agregarProducto(producto(t, 'seco'));
  await asentar(20);
  t.base.repararTodo();
  assert.equal(t.pos.colaDeltas.length, 1);
  assert.equal(t.pos.cuentaConPromo, true, '3 Seco un lunes: la regla de hoy sobre las unidades');
  const n0 = t.supabase.llamadas.length;
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  assert.deepEqual(orden(t, n0), [], 'ni una llamada: no se espera a que la base diga RS005');
  assert.match(t.pos.aviso.texto, /Esta mesa tiene una promoción: el descuento se calcula con toda la cuenta junta/);
  await t.pos.flushDeltas();
  await asentar(30);
  assert.equal(pagado(t), 53200);
  assert.equal(cerradas(t).length, 0);
});

test('E7 (r3 G) sin red, 2 Seco, un comensal quiere pagar su Seco por partes: la llamada sale y falla por la red (en duda: la cuenta se congela) y el pedido de OTRO Seco no entra; al volver la red la tablet pregunta, el cobro no llegó, relee y descongela; el tercer Seco entra y la mesa paga 53.200', async () => {
  const t = await abrir([SECO(2)]);
  sinRed(t);
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0);
  assert.equal(t.pos._cuentaCongelada('o1'), true);
  t.pos.agregarProducto(producto(t, 'seco'));
  await asentar(20);
  assert.equal(local(t).items.find((i) => i.id === 'seco').qty, 2, 'congelada: el tercero no entra');
  assert.equal(t.pos.aviso.texto, CONGELADA);
  conRed(t);
  for (const fn of (t.oyentes.ventana.online || [])) fn();
  await asentar(80);
  assert.equal(t.pos._cuentaCongelada('o1'), false, 'la base contestó: ese cobro no existe');
  t.pos.agregarProducto(producto(t, 'seco'));
  await asentar(80);
  assert.equal(pagado(t), 53200);
  assert.ok(!(t.pos.aviso && /NO quedó registrado/.test(t.pos.aviso.texto)), 'ningún cobro rechazado');
});

test('E8 (r3 B del navegador, 54.000 / 50.400) la tablet se recarga con el tercero pendiente: no hay cobro por partes que suba antes del +1: la mesa paga lo de la cuenta junta', async () => {
  const t = await abrir([SECO(2)]);
  t.base.red = false;
  t.pos.agregarProducto(producto(t, 'seco'));
  await asentar(20);
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  t.base.red = true;
  const u = crearPos({ base: t.base, almacen: t.almacen, extras: { setInterval() { return 1; }, clearInterval() {}, setTimeout(fn, ms, ...r) { if (ms >= 1500) { const h = { fn, ms, unref() { return h; } }; return h; } return setTimeout(fn, ms, ...r); }, clearTimeout(h) { if (h && typeof h === 'object') return; clearTimeout(h); } }, documento: { title: 'POS', visibilityState: 'visible' } });
  u.pos.usuario = YO;
  await u.pos.arrancarApp();
  await hastaQue(() => u.pos.remoto === 'ok');
  await hastaQue(() => u.pos.colaDeltas.length === 0 && u.pos.cambiosSinSubir === 0);
  await asentar(40);
  assert.equal(cerradas(t).length, 0);
  assert.equal(total(t.base.ordenes.get('o1').items), 53200);
  assert.equal(t.base.rpcs.length, 1, 'solo el +1, una vez');
});

// ═══════════════════ F. La mesa completa y la red ═══════════════════

test('F1 «Imprimir» espera la confirmación del total como mucho 10 s: si la base no contesta, se enciende, el papel dice PROVISIONAL y el POS lo dice; si contesta después, corrige y avisa como siempre', async () => {
  const t = await abrir([SOPA(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert' && c.cuerpo.estado === 'cerrada' ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));
  t.pos.facturar();
  await asentar(5);
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(local(t).confirmando, true, '«Imprimir» espera la confirmación…');
  assert.ok(t.timer(10000), '…pero no para siempre: hay un tope de 10 s');
  t.timer(10000).fn();
  assert.equal(local(t).confirmando, false, 'pasados los 10 s se enciende');
  assert.equal(local(t).provisional, true);
  const doc = t.pos.documentoTicket(t.pos.ordenTicket, 'ticket');
  assert.ok(doc.lineas.some((l) => /PROVISIONAL/.test(l.texto)), 'el papel dice PROVISIONAL');
  assert.match(t.pos.aviso.texto, /La base no ha confirmado el total de la mesa: ya puedes imprimir, pero el ticket sale como PROVISIONAL/);
  // la base contesta tarde, con otro precio
  t.base.normalizar = (items) => items.map((i) => (i.id === 'jugo' ? { ...i, precio: 14000 } : i));
  soltar();
  await hastaQue(() => !local(t).provisional);
  assert.equal(local(t).total, 56000);
  assert.match(t.pos.aviso.texto, /La base recalculó/);
  const doc2 = t.pos.documentoTicket(t.pos.ordenTicket, 'ticket');
  assert.ok(!doc2.lineas.some((l) => /PROVISIONAL/.test(l.texto)));
});

test('F2 si la base confirma antes de los 10 s, el tope no hace nada (ni aviso): el temporizador se encontró, pero `confirmando` ya era falso', async () => {
  const t = await abrir([SOPA(2), JUGO(1)], { abiertaEn: MARTES });
  t.pos.facturar();
  await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada' && !local(t).confirmando);
  await asentar(20);
  t.pos.cerrarAviso();
  assert.ok(t.timers.some((h) => h.ms === 10000), 'el tope se programó');
  for (const h of t.timers.filter((x) => x.ms === 10000)) h.fn();
  assert.equal(t.pos.aviso, null, 'y al disparar no dice nada: la base ya había confirmado');
  assert.equal(local(t).provisional, false);
});

test('F3 una cuenta con promoción pregunta si hay red antes de cobrar la mesa completa: con red, cobra (el total lo fija la base); sin red de verdad (aunque `remoto` diga «ok»), no cobra y lo dice; una sin promoción no pregunta', async () => {
  const con = await abrir([SECO(3)]);
  const n0 = con.supabase.llamadas.length;
  await con.pos.facturar();
  assert.ok(con.supabase.llamadas.slice(n0).some((c) => c.tipo === 'from' && c.tabla === 'mesas' && c.op === 'select'), 'sondeó la red con una lectura de una fila');
  await hastaQue(() => con.base.ordenes.get('o1').estado === 'cerrada');
  assert.equal(con.base.ordenes.get('o1').total, 53200);
  const sin = await abrir([SOPA(2)], { abiertaEn: MARTES });
  const m0 = sin.supabase.llamadas.length;
  sin.pos.facturar();
  assert.equal(sin.supabase.llamadas.slice(m0).filter((c) => c.tipo === 'from' && c.tabla === 'mesas').length, 0, 'sin promoción no pregunta nada: se cobra al instante');
  assert.equal(local(sin).estado, 'cerrada');
});

test('F4 sincronizarSupabase: cada lectura de la base que falla por RED (supabase-js lo devuelve, no lo lanza) deja la tablet «sin red» sin tocar lo que ya tenía; un error con código de la base no', async () => {
  for (const tabla of ['mesas', 'ordenes', 'productos']) {
    const t = await abrir([SOPA(2)], { abiertaEn: MARTES });
    const original = t.base.responder;
    t.base.responder = async (c) => (c.tipo === 'from' && c.tabla === tabla && c.op === 'select' && !c.limite && c.limite !== 0 ? { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 } : original(c));
    const antes = JSON.stringify(plano(t.pos.ordenes));
    await t.pos.sincronizarSupabase({ soloEnVivo: true });
    assert.equal(t.pos.remoto, 'offline', tabla);
    assert.equal(JSON.stringify(plano(t.pos.ordenes)), antes, 'lo que ya había no se toca');
  }
  const t = await abrir([SOPA(2)], { abiertaEn: MARTES });
  t.base.fallar('select:ordenes');                                       // un error de la base (sin ser de red)
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(t.pos.remoto, 'ok');
});

test('F5 el navegador dice «offline»: la tablet queda «sin red» ya; «online»: vuelve a leer y, si la base contesta, queda «en línea»; marcada sin red, pregunta sola cada 8 s', async () => {
  const t = await abrir([SOPA(2)], { abiertaEn: MARTES });
  for (const fn of (t.oyentes.ventana.offline || [])) fn();
  assert.equal(t.pos.remoto, 'offline');
  assert.ok(t.timer(8000), 'queda un reintento programado');
  t.timer(8000).fn();
  await hastaQue(() => t.pos.remoto === 'ok');
  assert.equal(t.pos.remoto, 'ok', 'el reintento leyó la base y la tablet volvió a estar en línea');
  for (const fn of (t.oyentes.ventana.offline || [])) fn();
  t.base.red = false;
  await t.pos._resincronizarEnVivo();
  assert.equal(t.pos.remoto, 'offline');
  t.base.red = true;
  for (const fn of (t.oyentes.ventana.online || [])) fn();
  await hastaQue(() => t.pos.remoto === 'ok');
});

// ═══════════════════ G. Deshacer con las ventas que crea la RPC ═══════════════════

test('G1 deshacer un cobro por partes hecho por la RPC: la unidad vuelve y la promo se recalcula (2 Seco → cobra 1 → llegan 2 más: 3 Seco con promo → deshacer: 4 Seco, un solo descuento)', async () => {
  const t = await abrir([SECO(2), JUGO(1)]);
  assert.equal(await t.pos.facturarParcial({ seco: 1, jugo: 1 }), true);
  assert.equal(t.base.ordenes.get('o1').total, 19000);
  const venta = cerradas(t)[0];
  otraTablet(t, [SECO(3)]);                                              // dos Seco más: 3 en la cuenta → promo
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(total(t.base.ordenes.get('o1').items), 53200);
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar(30);
  const o = t.base.ordenes.get('o1');
  assert.equal(cerradas(t).length, 0, 'la venta se borró');
  assert.equal(unidades(o.items.filter((i) => i.id === 'seco' || i.id === 'promo:p-lun:seco')), 4);
  assert.equal(o.items.filter((i) => String(i.id).startsWith('promo:')).reduce((s, i) => s + i.qty, 0), 1, 'un solo descuento: la promo se recalculó con las cuatro unidades');
  assert.equal(o.items.find((i) => i.id === 'jugo').qty, 1);
  assert.equal(o.total, total(o.items));
  assert.equal(t.base.deshechos.includes(venta.id), true);
});

test('G2 deshacer un ABONO hecho por la RPC quita SU línea de crédito (mismo uid) y la cuenta vuelve exacta', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '20000';
  assert.equal(await t.pos.cobrarMonto(), true);
  assert.equal(t.base.ordenes.get('o1').total, 50000 - 20000);
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar(30);
  assert.equal(t.base.ordenes.get('o1').total, 50000);
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.base.ordenes.get('o1').items.some((i) => i.id.startsWith('abono_recibido_')), false);
  assert.equal(local(t).total, 50000);
});

test('G3 un cobro deshecho NO se repite: la base ya lo anotó y la venta ya no existe — la reconciliación no la encuentra, suelta el intento y relee la cuenta (que ya trae lo devuelto); un cobro nuevo sale con ids propios', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  t.base.cobroRespuestaPerdida = true;
  await t.pos.facturarParcial({ seco: 1 });                              // la base cobra; la respuesta se pierde
  t.base.cobroRespuestaPerdida = false;
  const primera = llamadas(t, 'cobrar_parcial')[0].args;
  const idVenta = cerradas(t)[0].id;
  assert.equal((await t.base.responder({ tipo: 'rpc', nombre: 'deshacer_cobro', args: { p_orden_id: idVenta } })).data.ok, true);
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false, 'congelada: el reintento no sale');
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1);
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'sin_rastro', 'la venta ya no existe: se suelta');
  assert.equal(cerradas(t).length, 0);
  assert.equal(local(t).items.find((i) => i.id === 'seco').qty, 2, 'la cuenta releída trae el Seco devuelto');
  assert.equal(local(t).version, t.base.ordenes.get('o1').version);
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 1));
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), true, 'y un cobro nuevo entra');
  const nuevo = llamadas(t, 'cobrar_parcial')[1].args;
  assert.notEqual(nuevo.p_delta_id, primera.p_delta_id);
  assert.equal(cerradas(t).length, 1);
});

// ═══════════════════ H. Estática ═══════════════════

const cuerpo = (nombre) => {
  const i = POS_HTML.search(new RegExp(`^ {12}(?:async\\s+)?${nombre}\\(`, 'm'));
  assert.ok(i !== -1, `no encontré ${nombre} en pos.html`);
  const j = POS_HTML.slice(i + 1).search(/^ {12}(?:async\s+|get\s+)?[A-Za-z_$][\w$]*\(.*\) \{$/m);
  return POS_HTML.slice(i, j === -1 ? undefined : i + 1 + j).replace(/\/\/.*$/gm, '');
};

test('H1 estática: facturarParcial, cobrarMonto y cobrarGrupoPersona no escriben la venta con un upsert ni mandan deltas; llaman a _cobrarEnBase, que llama a cobrar_parcial / cobrar_abono', () => {
  for (const n of ['facturarParcial', 'cobrarMonto', 'cobrarGrupoPersona']) {
    const c = cuerpo(n);
    assert.doesNotMatch(c, /pushASupabase|_enviarDelta|_pushDeltaTras|_encolarDelta|this\.ordenes\.push\(/, `${n} no escribe nada por su cuenta`);
  }
  assert.match(cuerpo('facturarParcial'), /return this\._cobrarEnBase\(\{[\s\S]*tipo: 'parcial'/);
  assert.match(cuerpo('cobrarMonto'), /return this\._cobrarEnBase\(\{ orden, tipo: 'abono'/);
  const base = cuerpo('_cobrarEnBase');
  assert.match(base, /supabaseClient\.rpc\('cobrar_abono'/);
  assert.match(base, /supabaseClient\.rpc\('cobrar_parcial'/);
  assert.match(base, /p_version: version/);
  assert.match(base, /p_delta_id: intento\.cobroId/);
  assert.doesNotMatch(base, /pushASupabase|_enviarDelta|_encolarDelta|colaDeltas\.push|localStorage/, 'ni encola ni escribe nada local por su cuenta');
  assert.match(base, /_conTope\(llamada, TOPE_COBRO_MS\)/, 'con tope de 10 s');
});

test('H2 estática: la decisión de «sin red» del cobro sale del RESULTADO de la llamada (esErrorDeRed), no de `remoto`', () => {
  for (const n of ['_cobrarEnBase', '_cuentaLista', '_cobroNoHecho']) {
    assert.doesNotMatch(cuerpo(n).replace(/this\.remoto !== 'offline'\) this\.sincronizarSupabase/g, ''), /this\.remoto\s*[!=]==?\s*'(offline|ok)'/, `${n} no mira \`remoto\` para decidir`);
  }
  assert.match(cuerpo('_cobroNoHecho'), /if \(esErrorDeRed\(e, respuesta\)\)/);
  const f = POS_HTML.match(/function esErrorDeRed\(e, respuesta\) \{[\s\S]*?\n    \}/)[0];
  assert.match(f, /e\.tope/);
  assert.match(f, /estado === 0 \|\| estado >= 500/);
  assert.match(POS_HTML, /const TEXTO_SIN_RED_COBRO = 'Sin red: el cobro por partes y los abonos necesitan red; la mesa completa sí se puede cobrar\.';/);
  assert.match(POS_HTML, /const TOPE_COBRO_MS = 10000;/);
  assert.match(POS_HTML, /const TOPE_CONFIRMAR_MS = 10000;/);
  assert.match(cuerpo('sincronizarSupabase'), /esErrorDeRed\(r\.error, r\)[\s\S]*throw sinRed\.error/);
});

test('H3 estática: el POS cita la migración y las dos funciones; las confirmaciones apagan el botón mientras la base cobra', () => {
  assert.ok(POS_HTML.includes('20261005140000'));
  assert.ok(POS_HTML.includes('cobrar_parcial') && POS_HTML.includes('cobrar_abono'));
  assert.match(POS_HTML, /:disabled="!\$store\.pos\.abonoValido \|\| \$store\.pos\.cobrandoParcial"/);
  assert.match(POS_HTML, /\$store\.pos\.seleccionExcede \|\| \$store\.pos\.cobrandoParcial"/);
  assert.match(POS_HTML, /:disabled="\$store\.pos\.cobrandoParcial"\s+@click="\$store\.pos\.cobrarGrupoPersona\(persona\)"/);
});

test('H4 estática: el README y los pasos dicen que el cobro por partes y los abonos necesitan red', () => {
  const readme = fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8');
  assert.match(readme, /cobrar_parcial/);
  assert.match(readme, /cobrar_abono/);
  assert.match(readme, /necesitan red/);
});
