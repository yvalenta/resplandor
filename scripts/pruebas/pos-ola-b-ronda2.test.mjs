// Ola B, RONDA 2: lo que la refutación y la crítica visual encontraron, como pruebas que fallan sin cada corrección.
// Corre el <script> REAL de pos.html en un `vm` (scripts/pruebas/_pos-vm.mjs) contra la base falsa, que desde esta ronda
// también modela lo que la RLS y la migración de permisos le hacen al POS (la ronda 1 suponía un 42501 que la base real
// NO da: a un mesero una orden cerrada le contesta «orden X no existe»).
//
//   H1  (crítico) cola trabada y venta en $0 con un mesero sin red: la orden cobrada sube ENTERA, los deltas que la base
//       ya no puede aplicar se sueltan sin trabar la cola.
//   H3  (medio)   «Cobrar por partes» no cobra sobre una venta cerrada (ni la duplica).
//   H5  (medio)   un delta tardío no toca una venta cerrada; «Editar» (admin) sí, a propósito, y la función vieja sigue sirviendo.
//   H7  (bajo)    un 5xx de mi_rol sin rol confirmado no supone «mesero» ni carga la caché.
//   V1-V8 (crítica visual) confirmaciones, método del abono, «Queda por pagar», ticket del parcial, error del personal en la fila.
//   R2/R4 (sin hallazgo, quedan como regresión): la base de hoy sin alertas ni permisos, y el cuadre de los dos cobros.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertaBase, asentar, crearBaseFalsa, crearPos, hastaQue, item, mesaBase, ordenBase, ordenLocal, plano,
} from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const lista = (mapa) => [...mapa.values()];
const sinPendientes = (pos) => Object.keys(plano(pos._pendientes)).length === 0;

/** Un POS con sesión sobre la base falsa. Las filas que salen de la base se copian: la tablet y la base no comparten referencias. */
function montar({ rol = 'admin', mesas = [mesaBase(3)], ordenes = [], cierres = [], alertas = [], permisosPorRol = true, sinMiRol = false, sinAlertas = false, sinCobrar = false, almacen } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, cierres, alertas, permisosPorRol, ...(sinCobrar ? { olaC: { cobrar: false } } : {}) });
  if (sinMiRol) base.sinFuncion.add('mi_rol');
  const original = base.responder;
  base.responder = async (c) => {
    if (sinAlertas && c.tipo === 'from' && c.tabla === 'alertas') {
      return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.alertas' in the schema cache" } };
    }
    const r = await original(c);
    return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r;
  };
  const t = crearPos({ base, almacen, extras: { setInterval() { return 0; }, clearInterval() {} }, documento: { title: 'POS', visibilityState: 'visible' } });
  t.base = base; t.pos.usuario = YO;
  return t;
}
const mesaDe = (t, id) => t.pos.mesas.find((m) => m.id === id);
const volver = (t) => t.pos.volverAMesas();
const cerrar = (base) => lista(base.ordenes).filter((o) => o.estado === 'cerrada');
const suma = (ordenes) => ordenes.reduce((s, o) => s + o.total, 0);
const p = (id, precio, nombre = id) => ({ id, nombre, precio, cat: 'X' });

// ═════════════════════════ H1. cola trabada y venta en $0 (mesero) ═════════════════════════

for (const rol of ['mesero', 'admin']) {
  test(`H1 (${rol}): abrir, pedir y cobrar una mesa TODO sin red; al volver la red la venta llega ENTERA ($46.000), sin deltas y sin trabar la cola`, async () => {
    const t = montar({ rol, mesas: [mesaBase(4, { estado: 'libre' })] });
    await t.pos.arrancarApp();
    t.base.red = false; t.pos.remoto = 'offline';
    await t.pos.abrirMesa(mesaDe(t, 4)); await asentar();
    t.pos.agregarProducto(p('p1', 23000, 'Bandeja'));
    t.pos.agregarProducto(p('p1', 23000, 'Bandeja'));
    await asentar();
    t.pos.facturar(); await asentar();                       // 46.000 cobrados sin red
    const id = t.pos.ordenTicket.id;
    volver(t);
    assert.equal(t.pos.colaDeltas.length, 2, 'los dos deltas esperan en la cola');

    t.base.red = true;
    for (let i = 0; i < 3; i++) { await t.pos.sincronizarSupabase({ soloEnVivo: true }); await asentar(); }
    await hastaQue(() => t.pos.colaDeltas.length === 0 && sinPendientes(t.pos));
    const o = t.base.ordenes.get(id);
    assert.equal(o?.estado, 'cerrada');
    assert.equal(o?.total, 46000, 'antes: el esqueleto subía «cerrada · [] · 0» y los deltas fallaban con «no existe»');
    assert.deepEqual(plano(o.items.map((i) => [i.id, i.qty])), [['p1', 2]], 'dos bandejas una sola vez (ni 4 ni 0)');
    assert.equal(t.pos.colaDeltas.length, 0);
    assert.equal(t.base.rpcs.length, 0, 'ningún delta llegó a la base: la fila completa ya los traía');
    assert.deepEqual(t.avisos, [], 'y sin alert(): era el cobro de esta tablet, no se perdió nada');
    assert.equal(t.pos.aviso, null);
  });
}

test('H1 (mesero, carrera): otra tablet cobró la mesa y este delta llega después: «no existe» NO traba la cola, se avisa, y lo que se haga sin red después sube', async () => {
  const t = montar({
    rol: 'mesero', mesas: [mesaBase(3), mesaBase(5)],
    ordenes: [ordenBase('o1', 3, [item('p1', 10000)]), ordenBase('o2', 5, [item('p1', 10000)])],
  });
  await t.pos.arrancarApp();
  // La tablet B cobra la mesa 3 (en la base); el eco todavía no llegó a esta tablet.
  Object.assign(t.base.ordenes.get('o1'), { estado: 'cerrada', cerrada_en: new Date().toISOString(), version: 2 });
  await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  t.pos.agregarProducto(p('p2', 6000, 'Limonada'));
  await asentar(); await hastaQue(() => t.pos.colaDeltas.length === 0);
  assert.equal(t.pos.colaDeltas.length, 0, 'la base contestó «no existe» (P0001, no 42501): el delta era huérfano y se soltó, no se quedó primero de la cola');
  assert.match(t.pos.aviso?.texto || '', /mesa 3 ya estaba cobrada en otro dispositivo/, 'el mesero se entera de que ese ítem no se guardó');
  assert.equal(t.base.ordenes.get('o1').items.length, 1, 'y la venta cerrada de la otra tablet no se tocó');
  volver(t);

  // Un corte de wifi corto: el mesero suma 2 bandejas a la mesa 5 y, de nuevo con red, llegan.
  t.base.red = false; t.pos.remoto = 'offline';
  await t.pos.abrirMesa(mesaDe(t, 5)); await asentar();
  t.pos.agregarProducto(p('p1', 10000)); t.pos.agregarProducto(p('p1', 10000));
  await asentar(); volver(t);
  t.base.red = true;
  for (let i = 0; i < 3; i++) { await t.pos.sincronizarSupabase({ soloEnVivo: true }); await t.pos.flushDeltas(); await asentar(); }
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(t.base.ordenes.get('o2').items[0].qty, 3, 'la mesa 5 tiene sus 3 bandejas en la base (antes: 1, con la cola trabada)');
});

test('H1 (mesero, carrera con eco): si el eco de «cerrada» llega ANTES del vaciado, el delta se suelta igual y avisa', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 10000)])] });
  await t.pos.arrancarApp();
  await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  t.base.red = false; t.pos.remoto = 'offline';
  t.pos.agregarProducto(p('p2', 6000, 'Limonada')); await asentar();      // sin red: queda en la cola
  Object.assign(t.base.ordenes.get('o1'), { estado: 'cerrada', cerrada_en: new Date().toISOString(), version: 2 });
  t.base.red = true; t.pos.remoto = 'ok';
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...t.base.ordenes.get('o1') } });
  await t.pos.flushDeltas(); await asentar();
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.match(t.pos.aviso?.texto || '', /ya estaba cobrada/);
});

test('H1: un delta de una orden ABIERTA y aún sin subir NO se descarta: el esqueleto de _subirLoPendiente la crea (la espera de siempre)', async () => {
  const t = montar({ rol: 'mesero', mesas: [mesaBase(3, { estado: 'libre' })] });
  await t.pos.arrancarApp();
  t.base.red = false; t.pos.remoto = 'offline';
  await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  t.pos.agregarProducto(p('p1', 5000)); t.pos.agregarProducto(p('p1', 5000)); await asentar();
  t.base.red = true;
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  await hastaQue(() => t.pos.colaDeltas.length === 0 && sinPendientes(t.pos));
  const o = lista(t.base.ordenes)[0];
  assert.equal(o.estado, 'abierta');
  assert.deepEqual(plano(o.items.map((i) => [i.id, i.qty])), [['p1', 2]]);
  assert.equal(t.pos.aviso, null, 'nada se perdió');
});

// ═════════════════════════ H5. un delta tardío no toca una venta cerrada ═════════════════════════

test('H5 (admin): un delta sobre una orden que otra tablet cerró NO la modifica (RS001): no se encola, se avisa y la venta cerrada queda como estaba', async () => {
  const t = montar({ rol: 'admin', ordenes: [ordenBase('o1', 3, [item('p1', 23000)])] });
  await t.pos.arrancarApp();
  await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  Object.assign(t.base.ordenes.get('o1'), { estado: 'cerrada', cerrada_en: new Date().toISOString(), version: 2, total: 23000 });
  t.pos.agregarProducto(p('p2', 6000, 'Limonada'));
  await asentar();
  assert.equal(t.base.ordenes.get('o1').total, 23000, 'antes: el delta se aplicaba a la venta cerrada y el cierre reportaba otra cifra');
  assert.equal(t.base.ordenes.get('o1').items.length, 1);
  assert.equal(t.pos.colaDeltas.length, 0, 'un fallo definitivo no se encola');
  assert.match(t.pos.aviso?.texto || '', /ya estaba cobrada/);
});

test('H5 (admin): un ABONO sobre una mesa que otra tablet cobró no baja esa venta cerrada: la base lo rechaza (RS001) y el aviso dice que ya no está abierta; no queda ningún abono', async () => {
  const t = montar({ rol: 'admin', ordenes: [ordenBase('o1', 3, [item('p1', 23000)])] });
  await t.pos.arrancarApp();
  await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  Object.assign(t.base.ordenes.get('o1'), { estado: 'cerrada', cerrada_en: new Date().toISOString(), version: 2 });
  t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '20000';
  assert.equal(await t.pos.cobrarMonto(), false); await asentar();
  assert.equal(t.base.ordenes.get('o1').total, 23000, 'T1b de la refutación: antes bajaba a 3.000');
  assert.equal(lista(t.base.ordenes).length, 1, 'y no quedó ninguna venta «Abono» (cobrar_abono es atómico: o entra todo o nada)');
  assert.match(t.pos.aviso?.texto || '', /el abono de la mesa 3 no se hizo|El abono de la Mesa 3 no se hizo: esa cuenta ya no está abierta/i);
});

test('H5 (admin): «Editar» una venta cerrada del turno usa deltas con p_solo_abierta := false y SÍ se aplican', async () => {
  const cerradaVieja = ordenBase('v1', 2, [item('p1', 23000, 2)], 1, 'cerrada');
  const t = montar({ rol: 'admin', mesas: [mesaBase(2, { estado: 'libre' }), mesaBase(3)], ordenes: [cerradaVieja] });
  await t.pos.arrancarApp();
  t.pos.editarSinMesa(t.pos.ordenes.find((o) => o.id === 'v1'));
  t.pos.agregarProducto(p('p2', 6000, 'Limonada')); await asentar();
  const llamada = t.supabase.rpcs('aplicar_delta_orden').at(-1);
  assert.equal(llamada.args.p_solo_abierta, false);
  assert.deepEqual(plano(t.base.ordenes.get('v1').items.map((i) => i.id)), ['p1', 'p2'], 'el cambio llegó a la venta cerrada porque se pidió a propósito');
  assert.equal(t.pos.aviso, null);
});

test('H5 (compatibilidad): sin la migración de permisos (función de seis argumentos) «Editar» reintenta sin el parámetro y funciona; y las órdenes abiertas nunca mandan p_solo_abierta', async () => {
  const cerradaVieja = ordenBase('v1', 2, [item('p1', 23000, 2)], 1, 'cerrada');
  const t = montar({ rol: 'admin', permisosPorRol: false, mesas: [mesaBase(2, { estado: 'libre' }), mesaBase(3)], ordenes: [cerradaVieja, ordenBase('o1', 3, [item('p1', 5000)])] });
  await t.pos.arrancarApp();
  // abierta: seis argumentos, como siempre
  await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  t.pos.agregarProducto(p('p3', 4000, 'Jugo')); await asentar();
  assert.ok(!('p_solo_abierta' in t.supabase.rpcs('aplicar_delta_orden').at(-1).args), 'el POS nuevo no depende de la migración para operar una cuenta abierta');
  volver(t);
  // cerrada: primero con el parámetro (PGRST202), luego sin él
  t.pos.editarSinMesa(t.pos.ordenes.find((o) => o.id === 'v1'));
  t.pos.agregarProducto(p('p2', 6000, 'Limonada')); await asentar();
  const llamadas = t.supabase.rpcs('aplicar_delta_orden').filter((c) => c.args.p_orden_id === 'v1');
  assert.deepEqual(llamadas.map((c) => 'p_solo_abierta' in c.args), [true, false], 'se intentó con el parámetro y se repitió sin él');
  assert.deepEqual(plano(t.base.ordenes.get('v1').items.map((i) => i.id)), ['p1', 'p2']);
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('H5 (reabrir): si el delta del primer ítem de una cuenta reabierta llega antes que la fila (RS001) no se encola ni se cuenta dos veces', async () => {
  const cerrada = ordenBase('v1', 3, [item('p1', 23000)], 1, 'cerrada');
  const t = montar({ rol: 'admin', mesas: [mesaBase(3, { estado: 'libre' })], ordenes: [cerrada] });
  await t.pos.arrancarApp();
  const orden = t.pos.ordenes.find((o) => o.id === 'v1');
  // La orden se reabre en local y el usuario suma un ítem ANTES de que la subida de la fila llegue: la base aún la tiene cerrada.
  orden.estado = 'abierta'; orden.cerradaEn = null;
  t.pos.mesaActiva = mesaDe(t, 3); t.pos.ordenActiva = orden;
  t.pos.agregarProducto(p('p2', 6000, 'Limonada')); await asentar();
  assert.equal(t.pos.colaDeltas.length, 0, 'un delta rechazado por «cerrada» no queda en la cola: duplicaría el ítem cuando la fila reabierta (que ya lo trae) suba');
  await t.pos.pushASupabase('ordenes', orden);
  assert.deepEqual(plano(t.base.ordenes.get('v1').items.map((i) => [i.id, i.qty])), [['p1', 1], ['p2', 1]], 'p2 una sola vez');
});

// ═════════════════════════ H3. «Cobrar por partes» sobre una venta cerrada ═════════════════════════

test('H3: «Cobrar por partes» encendido + Cierre por la barra + «Editar sin mesa» de una venta de un cierre pasado: ni queda encendido ni cobra de nuevo', async () => {
  const cerradaVieja = { id: 'v1', mesaId: 2, estado: 'cerrada', items: [item('p1', 23000, 2)], total: 46000, abiertaEn: '2026-09-29T18:00:00Z', cerradaEn: '2026-09-29T19:00:00Z' };
  const t = montar({
    rol: 'admin', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p2', 6000)])],
    cierres: [{ id: 'c1', fecha: '2026-09-29T23:00:00Z', total_ventas: 46000, total_ordenes: 1, transacciones: [cerradaVieja] }],
  });
  await t.pos.arrancarApp(); await asentar();
  await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  t.pos.toggleModoCobroParcial();
  t.pos.vista = 'cierre';                                   // barra inferior → Cierre: no pasa por volverAMesas
  const cierre = t.pos.cierres.find((c) => c.id === 'c1');
  t.pos.abrirEditorTransaccion(cierre.ordenes[0], cierre);
  t.pos.elegirEditarSinMesa();
  assert.equal(t.pos.edicionSinMesa, true);
  assert.equal(t.pos.seleccionCobro, false, 'editarSinMesa apaga el modo «Cobrar por partes» de la otra cuenta');
  // aunque alguien lo vuelva a encender o llame al store a mano, no cobra sobre una venta cerrada
  t.pos.seleccionCobro = true;
  t.pos.toggleSeleccion(t.pos.ordenActiva.items[0]);
  await t.pos.facturarParcial(t.pos.itemsSeleccionados);
  await asentar();
  assert.equal(cerrar(t.base).filter((o) => o.id !== 'v1').length, 0, 'editar una venta cerrada no crea otra venta');
  assert.equal(t.pos.seleccionCobro, false);
  assert.equal(t.pos.ordenActiva.items[0].qty, 2, 'y la venta vieja queda como estaba');
});

test('H3: lo mismo con la venta cerrada DEL TURNO (sin cierre): «Editar sin mesa» y «Cobrar seleccionados» no duplican la venta', async () => {
  const turno = ordenBase('v1', 2, [item('p1', 23000, 2)], 1, 'cerrada');
  const t = montar({ rol: 'admin', mesas: [mesaBase(2, { estado: 'libre' })], ordenes: [turno] });
  await t.pos.arrancarApp();
  t.pos.editarSinMesa(t.pos.ordenes.find((o) => o.id === 'v1'));
  t.pos.seleccionCobro = true; t.pos.toggleSeleccion(t.pos.ordenActiva.items[0]);
  await t.pos.facturarParcial(); await asentar();
  assert.equal(cerrar(t.base).length, 1, 'sigue habiendo UNA sola venta');
  assert.equal(t.base.rpcs.length, 0);
});

// ═════════════════════════ H7. un 5xx de mi_rol no supone «mesero» ═════════════════════════

test('H7: con un error de mi_rol y SIN rol confirmado para esta cuenta, la tablet no carga su caché ni abre canales; con rol confirmado sí sigue', async () => {
  const caché = new Map([['pos_mesas', JSON.stringify([mesaBase(3, { token: 'z'.repeat(48) })])], ['pos_ordenes', '[]']]);
  const t = montar({ rol: 'mesero', almacen: caché });
  t.base.fallar('rpc:mi_rol');
  await t.pos.arrancarApp();
  assert.equal(t.pos.accesoSinComprobar, true);
  assert.equal(t.pos.rol, null);
  assert.deepEqual(plano(t.pos.mesas), [], 'los tokens de las mesas no se cargan');
  assert.equal(t.supabase.canales.length, 0);
  assert.equal(caché.has('pos_mesas'), true, 'y la caché no se borra: no hubo un «no»');
  assert.equal(t.pos.pantallaSinAcceso, true);

  const conRol = montar({ rol: 'mesero', almacen: new Map([['pos_rol', JSON.stringify({ uid: 'u1', rol: 'mesero' })]]) });
  conRol.base.fallar('rpc:mi_rol');
  await conRol.pos.arrancarApp();
  assert.equal(conRol.pos.rol, 'mesero');
  assert.equal(conRol.pos.rolSinConfirmar, true);
  assert.equal(conRol.pos.accesoSinComprobar, false);
});

// ═════════════════════════ Crítica visual: lo que decide la lógica ═════════════════════════

/** Una mesa con 4 palomas y una bandeja (97.000 en total con precios de 5.000 y 23.000… ver cada prueba). */
async function mesaConCuenta(t, items) {
  await t.pos.arrancarApp(); await asentar();
  await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  return items;
}
const PALOMA = { ...item('paloma', 17000, 4), nombre: 'Paloma' };
const BANDEJA = { ...item('bandeja', 29000, 1), nombre: 'Bandeja' };

test('V1: el método del abono parte del que eligió la mesa al pedir la cuenta (QR, transferencia); sin alerta, efectivo; y el abono pide confirmar (modalAbono) antes de registrarse', async () => {
  const t = montar({ ordenes: [ordenBase('o1', 3, [PALOMA, BANDEJA])], alertas: [alertaBase('a1', 3, 'o1', 'qr')] });
  await mesaConCuenta(t);
  t.pos.toggleModoCobroParcial();
  assert.equal(t.pos.metodoAbono, 'qr', 'la mesa dijo que paga con QR: no se parte de «efectivo»');
  t.pos.toggleModoCobroParcial();                        // se apaga
  t.pos.toggleModoCobroParcial();
  assert.equal(t.pos.metodoAbono, 'qr');
  t.pos.montoAbono = '30000';
  assert.equal(t.pos.abonoQuedaria, 67000, 'lo que quedará, a la vista antes de tocar el botón');
  assert.equal(t.pos.abonoError, '');
  t.pos.montoAbono = '999999'; assert.match(t.pos.abonoError, /Falta por pagar \$ 97\.000/);
  t.pos.montoAbono = '30000';

  const sin = montar({ ordenes: [ordenBase('o1', 3, [PALOMA, BANDEJA])] });
  await mesaConCuenta(sin);
  sin.pos.toggleModoCobroParcial();
  assert.equal(sin.pos.metodoAbono, 'efectivo');

  // El marcado abre la confirmación; solo cobrarMonto() registra, y la cierra.
  t.pos.modalAbono = true;
  assert.equal(cerrar(t.base).length, 0, 'abrir la confirmación no registra nada');
  assert.equal(await t.pos.cobrarMonto(), true); await asentar();
  assert.equal(t.pos.modalAbono, false);
  assert.equal(t.pos.ticketMostrado.abono.metodo, 'qr');
  assert.equal(cerrar(t.base).length, 1);
});

test('V2: «Cobrar seleccionados» muestra lo que queda y se apaga si lo marcado pasa de lo que falta (con abonos, las líneas suman más que la deuda)', async () => {
  const t = montar({ ordenes: [ordenBase('o1', 3, [PALOMA, BANDEJA])] });
  await mesaConCuenta(t);
  const linea = (id) => t.pos.ordenActiva.items.find((i) => i.id === id);
  t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '30000'; assert.equal(await t.pos.cobrarMonto(), true); await asentar();
  volver(t); await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  assert.equal(t.pos.totalPendiente, 67000);
  assert.equal(t.pos.etiquetaTotal, 'Queda por pagar', 'con abonos, la barra de cobro dice lo mismo que la carta del cliente');
  t.pos.toggleModoCobroParcial();
  assert.equal(t.pos.resumenSeleccion, 'Nada marcado');
  t.pos.toggleSeleccion(linea('paloma')); t.pos.toggleSeleccion(linea('bandeja'));   // 4×17.000 + 29.000 = 97.000 > 67.000
  assert.equal(t.pos.subtotalSeleccion, 97000);
  assert.equal(t.pos.seleccionExcede, true);
  assert.equal(t.pos.quedaTrasSeleccion, -30000);
  assert.equal(t.pos.resumenSeleccion, '2 ítems · $ 97.000');
  t.pos.ajustarCantidadSeleccion(linea('paloma'), -2);                               // 2×17.000 + 29.000 = 63.000 ≤ 67.000
  assert.equal(t.pos.seleccionExcede, false);
  assert.equal(t.pos.quedaTrasSeleccion, 4000);
  t.pos.toggleSeleccion(linea('bandeja')); t.pos.toggleSeleccion(linea('bandeja'));
  t.pos.modalParcial = true;
  await t.pos.facturarParcial(); await asentar();
  assert.equal(t.pos.modalParcial, false, 'cobrar cierra la confirmación');
  assert.equal(t.pos.ticketMostrado.quedan, 4000, 'el ticket de un cobro por unidades también dice cuánto queda');
  assert.equal(t.pos.quedaEnTicket, 4000);
});

test('V3: sin abonos la barra dice «Total»; las líneas de abono no cuentan como ítems; el ticket del abono dice «Queda por pagar» y el de un parcial que lo vació, no', async () => {
  const t = montar({ ordenes: [ordenBase('o1', 3, [PALOMA, BANDEJA])] });
  await mesaConCuenta(t);
  assert.equal(t.pos.etiquetaTotal, 'Total');
  assert.equal(t.pos.nLineas(t.pos.ordenActiva.items), 2);
  t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '30000'; await t.pos.cobrarMonto(); await asentar();
  assert.equal(t.pos.esOrdenAbono(t.pos.ticketMostrado), true);
  assert.equal(t.pos.quedaEnTicket, 67000);
  assert.equal(t.pos.lineaTicketTxt(t.pos.ticketMostrado.items[0]), 'Abono', 'el ticket del abono no dice «1 x Abono»');
  volver(t); await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
  assert.equal(t.pos.ordenActiva.items.length, 3, 'dos productos y la línea de abono');
  assert.equal(t.pos.nLineas(t.pos.ordenActiva.items), 2, 'la línea del abono no es un ítem');
  assert.equal(t.pos.lineaTicketTxt(t.pos.ordenActiva.items[0]), '4 x Paloma');
  // Marcar TODO (97.000) pasa de lo que debe (67.000): no se deja cobrar.
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(t.pos.ordenActiva.items.find((i) => i.id === 'paloma'));
  t.pos.toggleSeleccion(t.pos.ordenActiva.items.find((i) => i.id === 'bandeja'));
  assert.equal(t.pos.seleccionExcede, true, '97.000 de lo marcado > 67.000 que debe: no se deja');
});

test('V4: el error de una baja o un cambio de rol se muestra en la FILA de esa persona; el de un alta, arriba', async () => {
  const personal = [{ email: 'yo@ejemplo.test', nombre: 'Yo', rol: 'admin' }, { email: 'mesero@ejemplo.test', nombre: 'Mesero', rol: 'mesero' }];
  const t = montar({ rol: 'admin' });
  for (const x of personal) t.base.personal.set(x.email, { activo: true, ...x });
  await t.pos.arrancarApp(); await t.pos.cargarPersonal();
  assert.equal(t.pos.miCorreo, 'yo@ejemplo.test', 'la fila «Tú» sale de miCorreo');
  assert.equal(await t.pos.bajaPersonal('yo@ejemplo.test'), false, 'es el último admin');
  assert.match(t.pos.personalError, /al menos un admin activo/);
  assert.equal(t.pos.personalErrorDe, 'yo@ejemplo.test');
  assert.equal(t.pos.personalErrorEnFila('yo@ejemplo.test'), true, 'dentro de la fila de Camila, no arriba (fuera de pantalla)');
  assert.equal(t.pos.personalErrorEnFila('mesero@ejemplo.test'), false);
  // un alta con un correo que ya existe: el error va al formulario, arriba
  assert.equal(await t.pos.altaPersonal('mesero@ejemplo.test', 'Otra vez', 'mesero'), false);
  assert.equal(t.pos.personalErrorDe, '');
  assert.equal(t.pos.personalErrorEnFila('mesero@ejemplo.test'), false);
  // volver a dar acceso desde la fila: el error sí va en la fila
  t.base.personal.get('mesero@ejemplo.test').activo = false;
  await t.pos.cargarPersonal();
  await t.pos.reactivarPersonal({ email: 'mesero@ejemplo.test', nombre: 'Mesero', rol: 'mesero' });
  assert.equal(t.pos.personalError, '');
  assert.equal(t.base.personal.get('mesero@ejemplo.test').activo, true);
});

test('V5: avisar() deja un aviso en pantalla (no un alert), se cierra con un toque y solo el último aviso se va solo', async () => {
  const t = montar();
  t.pos.avisar('Uno', 20); t.pos.avisar('Dos', 60);
  assert.equal(t.pos.aviso.texto, 'Dos');
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(t.pos.aviso?.texto, 'Dos', 'el temporizador del primero no se lleva el segundo');
  await hastaQue(() => t.pos.aviso === null, { ms: 400 });
  assert.equal(t.pos.aviso, null);
  t.pos.avisar('Tres', 5000); t.pos.cerrarAviso();
  assert.equal(t.pos.aviso, null);
  assert.deepEqual(t.avisos, [], 'ningún alert() nativo');
});

// ═════════════════════════ Regresión: lo que la refutación revisó y no encontró ═════════════════════════

for (const sinMiRol of [false, true]) {
  test(`R2 (regresión): la base de HOY, sin alertas ni permisos por rol ni cobrar_parcial (mi_rol ${sinMiRol ? 'ausente' : 'presente'}): el POS arranca, el abono dice que falta aplicar la base nueva y la mesa completa se cobra`, async () => {
    const t = montar({ permisosPorRol: false, sinAlertas: true, sinMiRol, sinCobrar: true, ordenes: [ordenBase('o1', 3, [item('p1', 50000)])] });
    await t.pos.arrancarApp(); await asentar();
    assert.equal(t.pos.rol, 'admin'); assert.equal(t.pos.remoto, 'ok'); assert.equal(t.pos.sinAcceso, false);
    await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
    t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '20000'; assert.equal(await t.pos.cobrarMonto(), false); await asentar();
    assert.match(t.pos.aviso.texto, /falta aplicar en la base la actualización del cobro por partes y los abonos/);
    assert.equal(t.pos.totalOrdenActiva, 50000, 'la cuenta quedó como estaba');
    t.pos.facturar(); await asentar();
    assert.equal(suma(cerrar(t.base)), 50000, 'la mesa completa se cobra con la base de hoy');
  });
}

for (const [rol, sinRed] of [['admin', false], ['admin', true], ['mesero', false], ['mesero', true]]) {
  test(`R4 (cuadre) ${rol} ${sinRed ? 'SIN red: el cobro por partes y el abono no se hacen, la mesa completa sí' : 'con red'}: ${sinRed ? 'las 43.000 salen enteras al volver la red' : '1 paloma por unidades + abono 10.000 + 2 palomas + resto = 43.000 en la base'}`, async () => {
    const t = montar({ rol, ordenes: [ordenBase('o1', 3, [{ ...item('paloma', 5000, 4), nombre: 'Paloma' }, { ...item('bandeja', 23000, 1), nombre: 'Bandeja' }])] });
    await t.pos.arrancarApp(); await asentar();
    await t.pos.abrirMesa(mesaDe(t, 3)); await asentar();
    if (sinRed) { t.base.red = false; t.pos.remoto = 'offline'; t.caja.navigator.onLine = false; }   // Wi-Fi apagado: la llamada de cobro ni sale (nada en duda: la cuenta no se congela y la mesa completa sigue disponible)
    const linea = (id) => t.pos.ordenActiva.items.find((i) => i.id === id);
    const reabrir = async () => { t.pos.volverDeTicket(); await t.pos.abrirMesa(mesaDe(t, 3)); await asentar(); };
    t.pos.toggleModoCobroParcial(); t.pos.toggleSeleccion(linea('paloma')); t.pos.ajustarCantidadSeleccion(linea('paloma'), -3);
    assert.equal(await t.pos.facturarParcial(), !sinRed); await asentar(); if (!sinRed) await reabrir();
    t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '10000'; assert.equal(await t.pos.cobrarMonto(), !sinRed); await asentar(); if (!sinRed) await reabrir();
    t.pos.toggleModoCobroParcial(); t.pos.toggleSeleccion(linea('paloma')); t.pos.ajustarCantidadSeleccion(linea('paloma'), -1);
    assert.equal(await t.pos.facturarParcial(), !sinRed); await asentar(); if (!sinRed) await reabrir();
    if (sinRed) {
      assert.match(t.pos.aviso.texto, /Sin red: el cobro por partes y los abonos necesitan red; la mesa completa sí se puede cobrar/);
      assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'sin red ninguna parte se cobró');
      assert.equal(t.pos.colaDeltas.length, 0, 'nada se encoló');
      assert.equal(t.pos.totalOrdenActiva, 43000, 'la cuenta sigue entera');
    } else assert.equal(t.pos.totalOrdenActiva, 18000);
    t.pos.facturar(); await asentar(); t.pos.volverDeTicket();
    if (sinRed) { t.base.red = true; t.caja.navigator.onLine = true; for (let i = 0; i < 3; i++) { await t.pos.sincronizarSupabase({ soloEnVivo: true }); await asentar(); } }
    await hastaQue(() => t.pos.colaDeltas.length === 0 && sinPendientes(t.pos));
    assert.equal(suma(cerrar(t.base)), 43000);
    assert.equal(t.pos.totalHoy, 43000);
    assert.equal(lista(t.base.ordenes).filter((o) => o.estado === 'abierta').length, 0, 'ninguna mesa queda abierta en la base');
  });
}
