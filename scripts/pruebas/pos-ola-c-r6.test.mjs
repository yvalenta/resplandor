// Ola C, ronda 6 (correcciones de la refutación y la crítica de la ronda 5). La lógica del POS (pos.html, su <script> REAL en un `vm`) contra la base falsa de
// _pos-vm.mjs, que modela supabase/migrations/20261002180000_deshacer_cobro.sql con lo que trae esta ronda:
//
//   R6-1  una purga pendiente de un cierre (K1.purgar) NO borra el segundo cobro de una venta que se reabrió con el mismo id (la base no deja borrar por la API
//         una venta cerrada que ningún cierre archivó) — hallazgo 1 (crítico)
//   R6-2  el cobro POR PARTES, por persona o el ABONO de una cuenta abierta y archivada en un cierre se rechaza (RS005) y lo que ese cobro sacó de la cuenta
//         VUELVE a la cuenta (nada se pierde ni se cuenta dos veces) — hallazgo 2 (alto)
//   R6-3  lo agregado sin red a una cuenta que la base tiene abierta no se pisa con la copia atrasada del cierre «Sin respaldo» — hallazgo 3
//   R6-4  la edición atrasada de un cierre (RS004) no se queda «sin subir»: se vuelve a leer el historial y se avisa — hallazgo 4
//
// SQL de los mismos hallazgos: coordinacion/ola-c/r6/bd/escenarios/60-r6.sql (Postgres 17 en Docker).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asentar, crearBaseFalsa, crearPos, hastaQue, item, mesaBase, ordenBase,
} from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };

function montar({ rol = 'admin', mesas = [mesaBase(3)], ordenes = [], cierres = [], olaC = true, almacen } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, cierres, olaC });
  const original = base.responder;
  base.responder = async (c) => { const r = await original(c); return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r; };
  const reales = { setTimeout, clearTimeout };
  const t = crearPos({
    base, almacen,
    extras: {
      setInterval() { return 1; }, clearInterval() {},
      setTimeout(fn, ms, ...resto) { if (ms >= 1500) { const h = { fn, ms, unref() { return h; } }; return h; } return reales.setTimeout(fn, ms, ...resto); },
      clearTimeout(h) { if (h && typeof h === 'object') return; reales.clearTimeout(h); },
    },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  t.base = base; t.pos.usuario = YO;
  return t;
}
async function listo(t) {
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  if (t.pos.esAdmin) await hastaQue(() => t.pos._personalCargado);
  await asentar();
  return t;
}
const PALOMA = () => ({ id: 'paloma', nombre: 'Paloma', precio: 30000, qty: 2, nota: '' });
const HAMB = () => ({ id: 'hamb', nombre: 'Hamburguesa', precio: 30000, qty: 1, nota: '' });
const libre = (id) => mesaBase(id, { estado: 'libre' });
const mesaDe = (t, id) => t.pos.mesas.find((m) => m.id === id);
const ordenLocalDe = (t, id) => t.pos.ordenes.find((o) => o.id === id);
const venta = (id, mesaId, items, extra = {}) => ({ id, mesaId, estado: 'cerrada', items, total: items.reduce((s, i) => s + i.precio * i.qty, 0), abiertaEn: '2026-10-01T18:00:00Z', cerradaEn: new Date().toISOString(), version: 2, ...extra });
const filaDeCierre = (id, ventas) => ({ id, fecha: new Date(Date.now() - 86400000).toISOString(), total_ventas: ventas.reduce((s, v) => s + v.total, 0), total_ordenes: ventas.length, transacciones: ventas });
const lineas = (o) => o.items.map((i) => `${i.id}x${i.qty}`).sort();

// ═════════════════════════ R6-1. La purga pendiente de un cierre no alcanza un cobro vivo ═════════════════════════

test('R6-1 (P2) un cierre ya respaldado cuya purga nunca se confirmó (K1.purgar) no borra el segundo cobro de una venta que otro admin reabrió y se volvió a cobrar; la venta archivada sí se purga', async () => {
  const v1 = venta('v', 2, [item('pf1', 52000)], { version: 4 });
  const w = venta('w', 3, [item('pan', 3000)]);
  const k1Local = { id: 'k1', fecha: new Date(Date.now() - 86400000).toISOString(), total: 55000, sync: 'ok', purgar: ['v', 'w'], ordenes: [v1, w] };
  const k1Base = filaDeCierre('k1', [w]);   // V ya salió de K1 (reabierta); W sigue archivada y todavía está en `ordenes` (rezago)
  const almacen = new Map([['pos_cierres', JSON.stringify([k1Local])], ['pos_ordenes', JSON.stringify([])]]);
  const t = montar({
    mesas: [libre(2), libre(3)],
    ordenes: [{ ...ordenBase('v', 2, [item('pf1', 52000), item('jugo', 12000)], 6, 'cerrada') }, { ...ordenBase('w', 3, [item('pan', 3000)], 2, 'cerrada') }],
    cierres: [k1Base], almacen,
  });
  await listo(t);
  await asentar(30);
  assert.ok(t.supabase.de('ordenes', 'delete').length >= 1, 'la tablet sí intentó la purga atrasada');
  assert.ok(t.base.ordenes.has('v'), 'el segundo cobro de V ($64.000) sigue en la base');
  assert.equal(t.base.ordenes.has('w'), false, 'la venta archivada (W) sí se purgó');
  assert.equal(t.base.ordenes.get('v').total, 64000);
});

// ═════════════════════════ R6-2. El cobro por partes / abono de una cuenta archivada y abierta ═════════════════════════

/** Una cuenta O5 ABIERTA en la mesa 1 con su id archivado en un cierre (un POS viejo cerró con una foto vieja), y el admin con la mesa abierta en pantalla. */
async function cuentaArchivadaYAbierta({ rol = 'admin' } = {}) {
  const k = filaDeCierre('k-viejo', [venta('o5', 1, [PALOMA()])]);
  const t = montar({ rol, mesas: [mesaBase(1)], ordenes: [ordenBase('o5', 1, [PALOMA()], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 1));
  assert.equal(t.pos.ordenActiva.id, 'o5');
  return t;
}
const sinCobroParcial = (t) => ![...t.base.ordenes.values()].some((o) => o.estado === 'cerrada') && !t.pos.ordenes.some((o) => o.estado === 'cerrada');

test('R6-2a cobrar «por partes» TODA la cuenta archivada y abierta: la base lo rechaza (RS005), de la cuenta NO sale nada (el cobro entra primero, las unidades salen detrás) y queda abierta; no hay venta nueva ni «Cobrado · Deshacer»', async () => {
  const t = await cuentaArchivadaYAbierta();
  t.pos.facturarParcial({ paloma: 2 });
  assert.equal(t.pos.vista, 'ticket', 'al cobrar, el ticket aparece de inmediato (la base todavía no contestó)');
  await hastaQue(() => t.pos.aviso && /NO quedó registrado/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(30);
  const base = t.base.ordenes.get('o5');
  assert.equal(base.estado, 'abierta', 'la cuenta sigue abierta en la base');
  assert.deepEqual(lineas(base), ['palomax2'], 'con TODO lo que tenía: nada salió de la cuenta');
  assert.equal(t.base.rpcs.length, 0, 'ningún delta llegó a la base: lo que sale de la cuenta espera a que el cobro entre');
  assert.equal(base.total, 60000);
  assert.ok(sinCobroParcial(t), 'ninguna venta nueva, ni en la base ni en la tablet');
  assert.deepEqual(lineas(ordenLocalDe(t, 'o5')), ['palomax2'], 'la tablet muestra lo mismo');
  assert.equal(mesaDe(t, 1).estado, 'ocupada');
  assert.equal(t.pos.vista, 'orden', 'la pantalla vuelve a la cuenta, no se queda en un ticket falso');
  assert.equal(t.pos.ultimoCobro, null);
  assert.match(t.pos.aviso.texto, /El cobro por partes de la Mesa 1 NO quedó registrado: esa cuenta ya estaba en un cierre del día/);
  assert.match(t.pos.aviso.texto, /De la cuenta no salió nada: sigue abierta y se vuelve a leer de la base/);
  assert.match(t.pos.aviso.texto, /si ya recibiste el pago, no lo pierdas de vista/i);
  assert.match(t.pos.aviso.texto, /Reabrir/, 'al admin le dice cómo dejarla cobrable');
});

test('R6-2b cobrar solo UNA unidad de esa cuenta: se rechaza igual y la cuenta queda como estaba (2 unidades)', async () => {
  const t = await cuentaArchivadaYAbierta();
  t.pos.facturarParcial({ paloma: 1 });
  await hastaQue(() => t.pos.aviso && /NO quedó registrado/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(30);
  assert.deepEqual(lineas(t.base.ordenes.get('o5')), ['palomax2']);
  assert.equal(t.base.ordenes.get('o5').total, 60000);
  assert.ok(sinCobroParcial(t));
});

test('R6-2c «por persona» (lista de ids de línea) con una cuenta archivada y abierta: se rechaza y la cuenta recupera sus líneas', async () => {
  const k = filaDeCierre('k-viejo', [venta('o5', 1, [PALOMA(), HAMB()])]);
  const t = montar({ mesas: [mesaBase(1)], ordenes: [ordenBase('o5', 1, [PALOMA(), HAMB()], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 1));
  t.pos.facturarParcial(['hamb']);
  await hastaQue(() => t.pos.aviso && /NO quedó registrado/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(30);
  assert.deepEqual(lineas(t.base.ordenes.get('o5')), ['hambx1', 'palomax2']);
  assert.equal(t.base.ordenes.get('o5').total, 90000);
  assert.ok(sinCobroParcial(t));
});

test('R6-2d un ABONO a esa cuenta: se rechaza y la línea «Abono recibido» sale de la cuenta (no queda un crédito sin venta)', async () => {
  const t = await cuentaArchivadaYAbierta();
  t.pos.montoAbono = '20000';
  assert.equal(t.pos.cobrarMonto(), true);
  await hastaQue(() => t.pos.aviso && /NO quedó registrado/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(30);
  const base = t.base.ordenes.get('o5');
  assert.deepEqual(lineas(base), ['palomax2'], 'sin la línea de crédito');
  assert.equal(base.total, 60000, 'la cuenta debe lo de siempre');
  assert.ok(sinCobroParcial(t));
  assert.ok(!t.pos.ordenes.flatMap((o) => o.items).some((i) => String(i.id).startsWith('abono_')), 'ni aquí');
});

test('R6-2e con la cuenta ya sacada del cierre («Reabrir» → adoptada) el cobro por partes SÍ entra y cuenta una vez', async () => {
  const t = await cuentaArchivadaYAbierta();
  // el admin la saca del cierre (la base la deja abierta, tal cual)
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'reabrir_venta_de_cierre', args: { p_cierre_id: 'k-viejo', p_orden_id: 'o5', p_mesa_id: 1 } });
  assert.equal(r.data.ok, true); assert.equal(r.data.adoptada, true);
  t.pos.facturarParcial({ paloma: 1 });
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(30);
  assert.ok(!(t.pos.aviso && /NO quedó registrado/.test(t.pos.aviso.texto)));
  assert.deepEqual(lineas(t.base.ordenes.get('o5')), ['palomax1']);
  assert.equal([...t.base.ordenes.values()].filter((o) => o.estado === 'cerrada' && o.parcial_de === 'o5').length, 1);
});

// ═════════════════════════ R6-3. Lo agregado sin red no se pisa con la copia atrasada ═════════════════════════
// (la versión realista de R5a-3d, la que deja de verdad el POS de producción, vive en pos-ola-c-r5a.test.mjs)

test('R6-3 el cierre «Sin respaldo» suelta las marcas de subida de las ventas que ya no están en pos_ordenes (y la de su mesa solo si ahí no hay una cuenta abierta); las que SÍ siguen en pos_ordenes se conservan', async () => {
  const vendida = venta('o3', 3, [PALOMA()], { version: 1 });
  const otra = venta('o9', 4, [HAMB()], { version: 1 });
  const viejo = { id: 'viejo', fecha: new Date().toISOString(), total: 90000, sync: 'error', purgar: ['o3', 'o9'], ordenes: [vendida, otra] };
  const almacen = new Map([
    ['pos_cierres', JSON.stringify([viejo])],
    ['pos_ordenes', JSON.stringify([otra])],                                           // o9 sigue aquí (cobrada, pendiente de subir); o3 no
    ['pos_pendientes', JSON.stringify({ 'ordenes:o3': true, 'mesas:3': true, 'ordenes:o9': true, 'mesas:4': true })],
    ['pos_mesas', JSON.stringify([{ id: 3, capacidad: 4, estado: 'libre' }, { id: 4, capacidad: 4, estado: 'libre' }])],
  ]);
  const t = montar({ mesas: [libre(3), libre(4)], ordenes: [], almacen });
  t.pos.cargarCachéLocal();
  assert.equal(t.pos._pendientes['ordenes:o3'], undefined);
  assert.equal(t.pos._pendientes['mesas:3'], undefined);
  assert.equal(t.pos._pendientes['ordenes:o9'], true, 'la orden que sigue en pos_ordenes conserva su marca');
  assert.equal(t.pos._pendientes['mesas:4'], true);
  assert.deepEqual(JSON.parse(almacen.get('pos_pendientes')), { 'ordenes:o9': true, 'mesas:4': true }, 'y se guardó');
});

test('R6-3b si en esa mesa hay una cuenta abierta aquí, su marca de mesa se conserva', async () => {
  const vendida = venta('o3', 3, [PALOMA()], { version: 1 });
  const viejo = { id: 'viejo', fecha: new Date().toISOString(), total: 60000, sync: 'error', purgar: ['o3'], ordenes: [vendida] };
  const nueva = { ...ordenBase('n1', 3, [HAMB()], 1), mesaId: 3, estado: 'abierta', items: [HAMB()], abiertaEn: new Date().toISOString() };
  const almacen = new Map([
    ['pos_cierres', JSON.stringify([viejo])],
    ['pos_ordenes', JSON.stringify([{ id: 'n1', mesaId: 3, estado: 'abierta', items: [HAMB()], total: 0, abiertaEn: new Date().toISOString(), cerradaEn: null, version: 0 }])],
    ['pos_pendientes', JSON.stringify({ 'ordenes:o3': true, 'mesas:3': true })],
  ]);
  const t = montar({ mesas: [libre(3)], ordenes: [], almacen });
  t.pos.cargarCachéLocal();
  assert.equal(t.pos._pendientes['ordenes:o3'], undefined);
  assert.equal(t.pos._pendientes['mesas:3'], true, 'la mesa 3 tiene una cuenta abierta aquí: su estado pendiente es suyo');
  assert.ok(nueva);
});

// ═════════════════════════ R6-4. La edición atrasada de un cierre ═════════════════════════

test('R6-4 el admin edita un cierre con una copia atrasada (otro admin reabrió V y se volvió a cobrar): la base lo rechaza (RS004), el POS avisa, vuelve a leer el historial y no queda nada «sin subir»', async () => {
  const w = venta('w', 3, [item('pan', 3000)]);
  const k1Base = filaDeCierre('k1', [w]);                                  // V ya no está en K1
  const t = montar({ mesas: [libre(1), libre(3)], ordenes: [{ ...ordenBase('v', 1, [item('pf1', 52000), item('jugo', 12000)], 6, 'cerrada') }], cierres: [k1Base] });
  await listo(t);
  // esta tablet tenía K1 de ANTES de la reapertura: con V adentro
  const k1 = t.pos.cierres.find((c) => c.id === 'k1');
  k1.ordenes = [venta('v', 1, [item('pf1', 52000)], { version: 4 }), { ...w, items: [item('pan', 3500)], total: 3500 }];
  t.pos.recalcularYSubirCierre(k1);
  await hastaQue(() => t.pos.aviso && /No se guardó el cambio en el cierre/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.cierres.find((c) => c.id === 'k1').sync === 'ok');
  await asentar(30);
  assert.deepEqual(t.base.cierres.get('k1').transacciones.map((x) => x.id), ['w'], 'el cierre de la base no cambió: V sigue fuera');
  assert.deepEqual(t.pos.cierres.find((c) => c.id === 'k1').ordenes.map((x) => x.id), ['w'], 'la tablet volvió a leer el historial');
  assert.equal(t.pos.cambiosSinSubir, 0);
  assert.ok(t.base.ordenes.has('v'), 'y el segundo cobro de V sigue en la base');
});

test('R6-4b una edición normal de un cierre (cambiar el precio de una venta que ya traía) sigue subiendo sin aviso', async () => {
  const w = venta('w', 3, [item('pan', 3000)]);
  const t = montar({ mesas: [libre(3)], ordenes: [], cierres: [filaDeCierre('k1', [w, venta('x', 2, [item('pf1', 7000)])])] });
  await listo(t);
  const k1 = t.pos.cierres.find((c) => c.id === 'k1');
  k1.ordenes = [{ ...w, items: [item('pan', 3500)], total: 3500 }, k1.ordenes.find((o) => o.id === 'x')];
  t.pos.recalcularYSubirCierre(k1);
  await hastaQue(() => t.pos.cierres.find((c) => c.id === 'k1').sync === 'ok');
  await asentar(30);
  assert.ok(!(t.pos.aviso && /No se guardó el cambio en el cierre/.test(t.pos.aviso.texto)));
  assert.equal(t.base.cierres.get('k1').transacciones.find((x) => x.id === 'w').total, 3500);
});

// ═════════════════════════ R6-5. La hoja «Ventas sin subir de esta tablet»: lo que dice y lo que lista ═════════════════════════

test('R6-5 la hoja dice cuántas faltan y cuánto, lista solo las que faltan o están abiertas (el resto, resumido), con botones que dicen lo que hacen y una confirmación con la cifra que se perdería', async () => {
  const f = (id, mesa, items, extra = {}) => venta(id, mesa, items, { cerradaEn: '2026-09-30T17:00:00Z', ...extra });
  const falta = f('falta', 5, [PALOMA()], { version: 0 });
  const ya = f('ya', 2, [item('en1', 15000)]);
  const arch = f('arch', 3, [item('en2', 18000)]);
  const ab = f('ab', 4, [PALOMA()]);
  const desh = f('desh', 1, [item('be2', 12000)]);
  const ventas = [falta, ya, arch, ab, desh];
  const viejo = { id: 'viejo', fecha: '2026-09-30T17:30:00Z', total: ventas.reduce((s, v) => s + v.total, 0), sync: 'error', purgar: ventas.map((v) => v.id), ordenes: ventas };
  const almacen = new Map([['pos_cierres', JSON.stringify([viejo])]]);
  const t = montar({
    mesas: [libre(1), libre(2), libre(3), mesaBase(4), libre(5)],
    ordenes: [{ ...ordenBase('ya', 2, [item('en1', 15000)], 2, 'cerrada') }, { ...ordenBase('ab', 4, [PALOMA()], 2) }],
    cierres: [filaDeCierre('k-otro', [arch])], almacen,
  });
  t.base.deshechosTabla.push({ id: 1, orden_id: 'desh', mesa_id: 1, tipo: 'completo', monto: 12000, items: [], hecho_por: 'otro@ejemplo.test', hecho_en: new Date().toISOString(), cierre_id: null });
  await listo(t);
  await hastaQue(() => t.pos.cierreViejoVista && !t.pos.cierreViejoVista.cargando);
  const p = t.pos;
  const estados = Object.fromEntries(p.cierreViejoVista.filas.map((x) => [x.id, x.estado]));
  assert.deepEqual(estados, { falta: 'falta', ya: 'cerrada', arch: 'cierre', ab: 'abierta', desh: 'deshecha' });
  // lo que falta y cuánto
  assert.equal(p.cierreViejoVista.faltan, 1);
  assert.equal(p.cierreViejoVista.faltanMonto, 60000);
  assert.equal(p.etiquetaSubirViejo, 'Subir 1 venta ($ 60.000)');
  // la lista: solo la que falta y la abierta; las otras tres, en una línea
  assert.deepEqual(p.cierreViejoFilasVisibles.map((x) => x.id), ['falta', 'ab']);
  assert.equal(p.cierreViejoResto, 3);
  // sin jerga: «sistema», no «base»
  assert.deepEqual(p.cierreViejoVista.filas.map((x) => x.texto), ['Falta en el sistema.', 'El sistema ya la tiene.', 'Ya está en un cierre del sistema.', 'El sistema la tiene ABIERTA (Mesa 4): hay que cobrarla de nuevo.', 'Se deshizo (el sistema lo registró): no vuelve.']);
  // el resumen trae la fecha del cierre y cada venta, su día y hora
  assert.equal(p.cierreViejoResumen.fecha, '2026-09-30T17:30:00Z');
  assert.match(p.fechaYHora(p.cierreViejoResumen.fecha), /^30 de sept\.?,?\s\d{1,2}:\d{2}\s[ap]\.\sm\.$/);
  assert.equal(p.fechaYHora('no es una fecha'), '—');
  // la confirmación dice lo que se perdería
  assert.equal(p.textoDescarteViejo, '¿Descartar la copia de esta tablet? Se borra y no se puede deshacer. 1 venta ($ 60.000) se perdería.');
  // sin lectura (cargando o con error) el botón no promete nada
  p.cierreViejoVista = { ...p.cierreViejoVista, cargando: true };
  assert.equal(p.etiquetaSubirViejo, 'Subir ventas');
  p.cierreViejoVista = { ...p.cierreViejoVista, cargando: false, error: 'x' };
  assert.equal(p.etiquetaSubirViejo, 'Subir ventas');
  assert.match(p.textoDescarteViejo, /No se pudo comparar con el sistema: no se sabe si alguna venta falta\.$/);
  // y sin nada que subir
  p.cierreViejoVista = { ...p.cierreViejoVista, error: '', faltan: 0, faltanMonto: 0 };
  assert.equal(p.etiquetaSubirViejo, 'Nada que subir');
  assert.equal(p.textoDescarteViejo, '¿Descartar la copia de esta tablet? Se borra y no se puede deshacer.');
  // en plural
  p.cierreViejoVista = { ...p.cierreViejoVista, faltan: 2, faltanMonto: 75000 };
  assert.equal(p.etiquetaSubirViejo, 'Subir 2 ventas ($ 75.000)');
  assert.match(p.textoDescarteViejo, /2 ventas \(\$ 75\.000\) se perderían\.$/);
});
