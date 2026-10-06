// EL COBRO «EN DUDA» (cuarta refutación, 2026-10-06; tareas/2026-10-04-hallazgos-domingo.md; migración 20261005140000_cobrar_parcial.sql) y la cuenta CONGELADA (quinta refutación, mismo día).
// El POS REAL (el <script> de pos.html en un `vm`) contra la base falsa de _pos-vm.mjs, que modela `cobrar_parcial` y `cobrar_abono` con el mismo orden de juicios que la función (el id de cobro
// ya anotado devuelve lo mismo ANTES de mirar la versión). Los mismos guiones con Postgres y supabase-js reales en Chromium: pos-cobro-en-duda-real.test.mjs. La regla de la cuenta congelada, con
// sus puertas y los guiones de la quinta refutación: pos-cuenta-congelada.test.mjs.
//
// El defecto (r4, ALTO): la base aplicaba un cobro por partes o un abono y la respuesta se perdía; la tablet decía «Sin red» y guardaba los ids en MEMORIA con una «firma» que incluía la
// versión de la cuenta. Al releer la cuenta (el reintento de red de 8 s, una recarga) la versión era la nueva, el mismo botón salía con ids NUEVOS y la base lo aceptaba: el cobro quedaba
// registrado DOS veces. Ahora:
//   E. El id del cobro nace UNA vez por intento (al confirmar), se guarda en localStorage (`pos_cobros_en_duda`) y NO depende de la versión. Mientras la base no diga si el cobro entró, la cuenta está
//      CONGELADA: ni el mismo cobro ni uno distinto salen (no se reenvía un intento: se le PREGUNTA a la base por su id, sola al volver la red o con «Reintentar ahora»). Si la venta existe se adopta;
//      si no, se suelta el intento, se relee la cuenta y se descongela.
//   R. Red colgada (la petición ni contesta ni falla): la espera de la cola antes de llamar tiene tope de 10 s («Sin red…»), el candado es POR CUENTA y siempre se libera.
//   S. Estática: el intento se persiste, el tope y el candado por cuenta, y que ya no hay «huella».
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POS_HTML, MARTES, CLAVE, SECO, JUGO, SOPA, total, cerradas, local, llamadas, enDuda, SIN_RED, CAMBIO, CONGELADA, avisoEnDuda,
  montar, abrir, producto, marcar, otraTablet, releer, reintentoDeRed, asentar, hastaQue, plano, envejecer, ahoraDe,
} from './_pos-cobro-duda-vm.mjs';

// ═══════════════════ E. El intento de cobro: un id por intento, guardado, que no depende de la versión ═══════════════════

test('E1 respuesta perdida tras aplicar (la base SÍ cobró) y el reintento de red de 8 s: la tablet pregunta a la base por ese id, adopta la venta, avisa y NO hay un segundo cobro; la pantalla no salta a un ticket', async () => {
  const t = await abrir();
  t.base.cobroRespuestaPerdida = true;
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  avisoEnDuda(t);
  assert.equal(cerradas(t).length, 1, 'la base sí lo aplicó');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'y la tablet no lo sabe');
  const duda = enDuda(t).o1;
  assert.ok(duda, 'el intento quedó guardado en localStorage');
  assert.equal(duda.enviado, true);
  assert.equal(duda.cobroId, llamadas(t, 'cobrar_parcial')[0].args.p_delta_id);
  assert.equal(duda.ventaId, llamadas(t, 'cobrar_parcial')[0].args.p_venta.id);
  // la red vuelve; la tablet reintenta sola
  t.base.cobroRespuestaPerdida = false;
  await reintentoDeRed(t);
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {}, 'el intento se resolvió');
  assert.equal(t.almacen.has(CLAVE), false, 'y ya no está en localStorage');
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'ningún segundo cobro: solo se le PREGUNTÓ a la base');
  assert.ok(t.supabase.de('ordenes', 'select').some((c) => c.filtros.some(([col, val]) => col === 'id' && val === duda.ventaId)), 'una lectura por el id de la venta');
  assert.match(t.pos.aviso.texto, /SÍ quedó registrado en la base/);
  assert.match(t.pos.aviso.texto, /Mesa 1/);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 1, 'la venta está en las transacciones del turno');
  assert.equal(t.pos.vista, 'orden', 'la pantalla no salta a un ticket');
  assert.equal(t.pos.ultimoCobro, null, 'ni ofrece «Deshacer» de algo que el mesero ya no tiene delante');
  assert.deepEqual(plano(t.pos.itemsSeleccionados), {}, 'la selección que ya no vale se suelta');
  assert.equal(local(t).version, t.base.ordenes.get('o1').version);
  assert.equal(local(t).total, 2 * 19000 + 12000);
  assert.equal(t.pos.cobrandoParcial, false);
});

test('E2 EL GUION DE r4 (D1): el cobro se aplicó, la respuesta se perdió, la tablet RELEE la cuenta (versión nueva) y el mesero toca otra vez el MISMO «Sí, cobrar»: NO sale (la cuenta está congelada); «Reintentar ahora» pregunta por el id, adopta la venta y queda UNA sola', async () => {
  const t = await abrir();
  t.base.cobroRespuestaPerdida = true;
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  avisoEnDuda(t);
  const primera = llamadas(t, 'cobrar_parcial')[0].args;
  t.base.cobroRespuestaPerdida = false;
  const vAntes = local(t).version;
  assert.equal(await releer(t), true);                                  // el eco / la lectura de la base: la cuenta ya trae el cobro (versión nueva)
  assert.ok(local(t).version > vAntes, 'la tablet ve la versión nueva');
  assert.equal(local(t).items.find((i) => i.id === 'jugo').qty, 1);
  assert.deepEqual(plano(t.pos.itemsSeleccionados), { jugo: 1 }, 'la selección sigue en pantalla');
  assert.equal(await t.pos.facturarParcial(), false, 'el mismo botón otra vez: la cuenta sigue congelada');
  assert.equal(t.pos.aviso.texto, CONGELADA);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'ningún segundo cobro, ni con los mismos ids');
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado');
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'se le PREGUNTÓ a la base, no se cobró otra vez');
  assert.match(t.pos.aviso.texto, /SÍ quedó registrado en la base/);
  assert.equal(cerradas(t).length, 1, 'UNA sola venta en la base');
  assert.equal(cerradas(t)[0].id, primera.p_venta.id);
  assert.equal(cerradas(t)[0].total, 12000);
  assert.equal(t.base.ordenes.get('o1').total, 2 * 19000 + 12000, 'la cuenta con UNA sola resta');
  assert.equal(t.pos.ticketMostrado.id, primera.p_venta.id);
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {});
  assert.equal(t.almacen.has(CLAVE), false);
});

test('E3 EL GUION DE r4 (D2): un abono cuya respuesta se perdió, tras releer la cuenta, NO se repite con el monto que sigue escrito (la cuenta está congelada); «Reintentar ahora» lo adopta: UN solo abono, un solo crédito', async () => {
  const t = await abrir();
  t.base.cobroRespuestaPerdida = true;
  t.pos.toggleModoCobroParcial();
  t.pos.montoAbono = '20000';
  assert.equal(await t.pos.cobrarMonto(), false);
  avisoEnDuda(t);
  assert.equal(cerradas(t).length, 1, 'la base sí recibió el abono');
  assert.equal(enDuda(t).o1.tipo, 'abono');
  const primera = llamadas(t, 'cobrar_abono')[0].args;
  t.base.cobroRespuestaPerdida = false;
  assert.equal(await releer(t), true);
  assert.equal(t.pos.montoAbono, '20000', 'el monto sigue escrito');
  assert.equal(await t.pos.cobrarMonto(), false, 'repetir el abono: congelada');
  assert.equal(t.pos.aviso.texto, CONGELADA);
  assert.equal(llamadas(t, 'cobrar_abono').length, 1);
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado');
  assert.match(t.pos.aviso.texto, /El abono de la Mesa 1 \(\$ 20\.000\) SÍ quedó registrado en la base/);
  assert.equal(llamadas(t, 'cobrar_abono').length, 1);
  assert.equal(cerradas(t).length, 1, 'UN solo abono');
  assert.equal(cerradas(t)[0].id, primera.p_venta.id);
  assert.equal(t.base.ordenes.get('o1').total, 2 * 19000 + 2 * 12000 - 20000);
  assert.equal(t.base.ordenes.get('o1').items.filter((i) => i.id.startsWith('abono_recibido_')).length, 1);
});

test('E4 EL GUION DE r4 (D3): recargar la página con el cobro en duda y repetirlo ANTES de que la tablet pregunte: el intento sobrevive en localStorage, la cuenta nace congelada, repetir NO sale; «Reintentar ahora» adopta: UNA sola venta', async () => {
  const t = await abrir();
  t.base.cobroRespuestaPerdida = true;
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  const primera = llamadas(t, 'cobrar_parcial')[0].args;
  assert.equal(cerradas(t).length, 1);
  t.base.cobroRespuestaPerdida = false;
  // se recarga la página: otro store, el mismo localStorage y la misma base
  const u = montar({ base: t.base, almacen: t.almacen });
  u.pos._reconciliarCobrosEnDuda = async () => {};                       // la recarga se repite antes de que la tablet alcance a preguntar
  await u.pos.arrancarApp();
  await hastaQue(() => u.pos.remoto === 'ok');
  await asentar();
  assert.equal(Object.keys(plano(u.pos.cobrosEnDuda)).length, 1, 'el intento volvió de localStorage');
  assert.equal(u.pos.cobrosEnDuda.o1.cobroId, primera.p_delta_id);
  assert.equal(u.pos._cuentaCongelada('o1'), true, 'y la cuenta nació congelada');
  await u.pos.abrirMesa(u.pos.mesas.find((m) => m.id === 1));
  assert.equal(local(u).version, t.base.ordenes.get('o1').version, 'la tablet leyó la versión NUEVA');
  marcar(u, { jugo: 1 });
  assert.equal(await u.pos.facturarParcial(), false, 'repetirlo: no sale');
  assert.equal(u.pos.aviso.texto, CONGELADA);
  assert.equal(llamadas(u, 'cobrar_parcial').length, 0, 'la tablet recargada no mandó ningún cobro');
  assert.equal(await u.pos.reintentarCobroEnDuda(), 'aplicado');
  assert.equal(cerradas(u).length, 1, 'UNA sola venta');
  assert.equal(cerradas(u)[0].id, primera.p_venta.id);
  assert.equal(t.base.ordenes.get('o1').total, 2 * 19000 + 12000);
});

test('E4b recargar con el cobro en duda y NO repetirlo: al arrancar y leer la base, la tablet pregunta por el id, adopta la venta y avisa; nada se cobra otra vez', async () => {
  const t = await abrir();
  t.base.cobroRespuestaPerdida = true;
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  t.base.cobroRespuestaPerdida = false;
  const u = montar({ base: t.base, almacen: t.almacen });
  await u.pos.arrancarApp();
  await hastaQue(() => u.pos.remoto === 'ok' && Object.keys(plano(u.pos.cobrosEnDuda)).length === 0);
  await asentar(30);
  assert.deepEqual(plano(u.pos.cobrosEnDuda), {});
  assert.equal(u.almacen.has(CLAVE), false);
  assert.match(u.pos.aviso.texto, /SÍ quedó registrado en la base/);
  assert.equal(llamadas(u, 'cobrar_parcial').length, 0, 'la tablet nueva no cobró nada');
  assert.equal(cerradas(u).length, 1);
  assert.equal(u.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 1, 'la venta está en sus transacciones');
});

test('E5 doble toque: dos «Sí, cobrar» a la vez sobre la misma cuenta mandan UNA sola llamada y registran UNA sola venta; el candado se libera al terminar', async () => {
  const t = await abrir();
  const [a, b] = await Promise.all([t.pos.facturarParcial({ seco: 1 }), t.pos.facturarParcial({ seco: 1 })]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1);
  assert.equal(cerradas(t).length, 1);
  assert.equal(t.pos.cobrandoParcial, false);
  // un cobro NUEVO después de uno que salió bien es otro cobro (otro comensal que paga su Seco): ids nuevos
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), true);
  const [x, y] = llamadas(t, 'cobrar_parcial').map((c) => c.args);
  assert.notEqual(x.p_delta_id, y.p_delta_id);
  assert.notEqual(x.p_venta.id, y.p_venta.id);
  assert.equal(cerradas(t).length, 2);
});

test('E6 un cobro DISTINTO (un abono) mientras el anterior (por partes) sigue en duda y sí llegó: NO sale (congelada); «Reintentar ahora» adopta el anterior con su ticket y avisa', async () => {
  const t = await abrir();
  t.base.cobroRespuestaPerdida = true;
  assert.equal(await t.pos.facturarParcial({ jugo: 1 }), false);
  t.base.cobroRespuestaPerdida = false;
  t.pos.toggleModoCobroParcial();
  t.pos.montoAbono = '10000';
  assert.equal(await t.pos.cobrarMonto(), false);
  assert.equal(t.pos.aviso.texto, CONGELADA);
  assert.equal(llamadas(t, 'cobrar_abono').length, 0, 'el abono no salió');
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado');
  assert.match(t.pos.aviso.texto, /SÍ quedó registrado en la base/);
  assert.equal(t.pos.vista, 'ticket', 'a quien toca el botón se le muestra el ticket del cobro que sí quedó');
  assert.equal(cerradas(t).length, 1);
  assert.equal(t.pos.ticketMostrado.id, cerradas(t)[0].id);
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {});
});

test('E7 un cobro DISTINTO mientras el anterior sigue en duda y NO llegó (la red estaba caída de verdad): no sale hasta que la base conteste; contesta «ese id no existe», el intento viejo se suelta, la cuenta se relee y el cobro nuevo sale con ids propios', async () => {
  const t = await abrir();
  t.base.red = false;
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  avisoEnDuda(t);
  const viejo = enDuda(t).o1;
  assert.equal(cerradas(t).length, 0, 'la base nunca lo recibió');
  t.base.red = true;
  assert.equal(await t.pos.facturarParcial({ jugo: 1 }), false, 'otro cobro: mientras no se sepa, no sale');
  assert.equal(t.pos.aviso.texto, CONGELADA);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1);
  envejecer(t);                                                          // pasaron los 30 s desde que se perdió la petición (sexta refutación)
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'sin_rastro');
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {});
  assert.equal(await t.pos.facturarParcial({ jugo: 1 }), true, 'ahora sí: otro cobro');
  const args = llamadas(t, 'cobrar_parcial').at(-1).args;
  assert.notEqual(args.p_delta_id, viejo.cobroId, 'con ids propios');
  assert.notEqual(args.p_venta.id, viejo.ventaId);
  assert.equal(cerradas(t).length, 1);
  assert.equal(cerradas(t)[0].total, 12000);
});

test('E8 un cobro DISTINTO y no se puede preguntar a la base si el anterior llegó: NO sale nada (así no se cobra dos veces), la cuenta sigue congelada y el intento anterior se conserva', async () => {
  const t = await abrir();
  t.base.cobroRespuestaPerdida = true;
  assert.equal(await t.pos.facturarParcial({ jugo: 1 }), false);
  t.base.cobroRespuestaPerdida = false;
  t.base.red = false;
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  assert.equal(t.pos.aviso.texto, CONGELADA);
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'sin_respuesta');
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1, 'ningún cobro nuevo');
  assert.equal(Object.keys(enDuda(t)).length, 1, 'y el intento anterior sigue guardado');
  assert.equal(t.pos._cuentaCongelada('o1'), true);
  assert.equal(t.pos.cobrandoParcial, false);
});

test('E9 un rechazo que CONTESTA la base (RS003: la cuenta cambió) es definitivo: el intento se suelta y el cobro siguiente sale con ids nuevos', async () => {
  const t = await abrir();
  otraTablet(t, [SECO(2), JUGO(3)]);                                     // otra tablet sumó un Jugo y el eco no llegó
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  assert.match(t.pos.aviso.texto, CAMBIO);
  assert.equal(t.base.cobros.at(-1).resultado, 'RS003');
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {}, 'la base contestó: ese cobro no existe');
  assert.equal(t.almacen.has(CLAVE), false);
  const primera = llamadas(t, 'cobrar_parcial')[0].args;
  await asentar(30);
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), true);
  const segunda = llamadas(t, 'cobrar_parcial')[1].args;
  assert.notEqual(segunda.p_delta_id, primera.p_delta_id, 'un intento nuevo, ids nuevos');
  assert.equal(cerradas(t).length, 1);
});

test('E10 el mismo cobro que NO llegó (red caída) y la cuenta cambió mientras tanto: no se reenvía; la base contesta que no existe, se relee (versión de AHORA) y el cobro nuevo sale con la versión de ahora y ids propios', async () => {
  const t = await abrir();
  t.base.red = false;
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  const viejo = enDuda(t).o1;
  t.base.red = true;
  otraTablet(t, [SECO(2), JUGO(3)]);                                     // otra tablet sumó un Jugo
  assert.equal(await releer(t), true);
  assert.equal(await t.pos.facturarParcial(), false, 'el mismo botón: congelada');
  assert.equal(llamadas(t, 'cobrar_parcial').length, 1);
  envejecer(t);
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'sin_rastro');
  assert.equal(local(t).version, 4, 'la cuenta releída: 3 → 4 por la otra tablet');
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), true, 'y el cobro de ese Seco sale');
  const args = llamadas(t, 'cobrar_parcial').at(-1).args;
  assert.notEqual(args.p_delta_id, viejo.cobroId, 'con ids propios: un intento no se reenvía');
  assert.equal(args.p_version, 4, 'con la versión que la tablet ve AHORA');
  assert.equal(t.base.cobros.at(-1).resultado, 'ok');
  assert.equal(cerradas(t).length, 1);
});

test('E11 el intento sobrevive tal cual en localStorage (ids, enviado, esperado) y no cambia con la versión: dos lecturas de la cuenta no lo tocan; ya no lleva «huella»', async () => {
  const t = await abrir();
  t.base.cobroRespuestaPerdida = true;
  marcar(t, { jugo: 1 });
  await t.pos.facturarParcial();
  const antes = JSON.stringify(enDuda(t));
  t.base.cobroRespuestaPerdida = false;
  otraTablet(t, [SECO(2), JUGO(2), SOPA(1)]);
  await releer(t); await releer(t);
  assert.equal(JSON.stringify(enDuda(t)), antes, 'las lecturas no tocan el intento');
  const i = enDuda(t).o1;
  assert.deepEqual(Object.keys(i).sort(), ['asentadoEn', 'cobroId', 'creadoEn', 'cuentaId', 'enviado', 'enviadoEn', 'esperado', 'mesaId', 'metodo', 'persona', 'tipo', 'uidAbono', 'ventaId', 'version'].sort());
  assert.equal(i.enviado, true);
  assert.equal(i.esperado, 12000);
});

test('E12 un intento que NUNCA salió (la espera de la cola venció) no queda en duda: se suelta; y uno guardado por una versión vieja o dañado en localStorage se ignora sin romper el arranque', async () => {
  const almacen = new Map([[CLAVE, '{"o1": 7, "o2": {"cuentaId": "o2"}, "o3": {"cuentaId": "o3", "cobroId": "a", "ventaId": "b", "uidAbono": "c", "huella": "h", "tipo": "parcial"}}']]);
  const u = montar({ almacen });
  await u.pos.arrancarApp();
  await hastaQue(() => u.pos.remoto === 'ok');
  assert.deepEqual(Object.keys(plano(u.pos.cobrosEnDuda)), ['o3'], 'solo el que trae todo lo necesario');
  const v = montar({ almacen: new Map([[CLAVE, 'esto no es json']]) });
  await v.pos.arrancarApp();
  await hastaQue(() => v.pos.remoto === 'ok');
  assert.deepEqual(plano(v.pos.cobrosEnDuda), {});
});

test('E13 un intento enviado que no se puede preguntar se conserva y la cuenta sigue congelada al volver «a medias» la red; pasadas 6 h se suelta (la única salida que no sabe)', async () => {
  const t = await abrir();
  t.base.red = false;
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  const intentos = llamadas(t, 'cobrar_parcial').length;
  await t.pos._reconciliarCobrosEnDuda();                                // sigue sin red: no se concluye nada
  assert.equal(Object.keys(plano(t.pos.cobrosEnDuda)).length, 1, 'no se pudo preguntar: se conserva');
  assert.equal(t.pos._cuentaCongelada('o1'), true);
  assert.equal(llamadas(t, 'cobrar_parcial').length, intentos, 'preguntar no cobra');
  // seis horas después
  const i = { ...plano(t.pos.cobrosEnDuda).o1, enviadoEn: ahoraDe(t) - 7 * 3600 * 1000 };   // con el reloj del POS (el `vm` tiene su hora fija): con `Date.now()` real la prueba solo pasaba antes de las 19:00 UTC
  t.pos.cobrosEnDuda = { o1: i };
  await t.pos._reconciliarCobrosEnDuda();
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {});
  assert.equal(t.pos._cuentaCongelada('o1'), false);
});

test('E14 un intento NUEVO de la misma cuenta, cuando el anterior ya se resolvió, nace con ids propios (jamás reutiliza los del anterior): ni de un cobro que entró ni de uno que no', async () => {
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(4), JUGO(2)], version: 3 }] });
  const ids = [];
  for (const [seleccion, rojo] of [[{ jugo: 1 }, true], [{ jugo: 1 }, false], [{ seco: 1 }, false]]) {
    if (rojo) t.base.cobroRespuestaPerdida = true;
    const r = await t.pos.facturarParcial(seleccion);
    t.base.cobroRespuestaPerdida = false;
    if (!r) assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado');
    await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 1));
    ids.push(llamadas(t, 'cobrar_parcial').at(-1).args);
  }
  assert.equal(new Set(ids.map((a) => a.p_delta_id)).size, 3, 'tres cobros, tres ids de cobro');
  assert.equal(new Set(ids.map((a) => a.p_venta.id)).size, 3, 'y tres ventas');
  assert.equal(cerradas(t).length, 3);
});

// ═══════════════════ R. Red colgada: tope en la espera de la cola, candado por cuenta, siempre se libera ═══════════════════

test('R1 EL GUION DE r4 (D4): con la red colgada (la petición del delta ni contesta ni falla), «Sí, cobrar» espera la cola solo 10 s: «Sin red…», sin llamada de cobro, sin nada en duda y sin nada bloqueado', async () => {
  const t = await abrir();
  const original = t.base.responder;
  t.base.responder = (c) => (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden' ? new Promise(() => {}) : original(c));   // lo que sale hacia la base se queda colgado
  t.pos.agregarProducto(producto(t, 'sopa'));                            // un +1 de la cuenta, en vuelo y colgado
  const cobro = t.pos.facturarParcial({ seco: 1 });
  await hastaQue(() => !!t.timer(10000));
  assert.ok(t.timer(10000), 'hay un tope de 10 s en la espera de la cola');
  assert.equal(t.pos.cobrandoParcial, true, 'mientras tanto, «Registrando…»');
  t.timer(10000).fn();                                                   // pasan los 10 s
  assert.equal(await cobro, false);
  assert.ok(t.pos.aviso.texto.startsWith(SIN_RED), t.pos.aviso.texto);
  assert.match(t.pos.aviso.texto, /no se envió ningún cobro/);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 0, 'nunca se llamó a cobrar_parcial');
  assert.equal(t.pos.cobrandoParcial, false, 'nada bloqueado');
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {}, 'un cobro que nunca salió no está en duda');
  assert.equal(t.almacen.has(CLAVE), false);
  assert.equal(cerradas(t).length, 0);
});

test('R2 el candado es POR CUENTA: con el cobro de la Mesa 1 colgado, la Mesa 2 cobra por partes y cobra la mesa completa; y la Mesa 1 se libera sola al vencer el tope', async () => {
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(2), JUGO(1)] }, { id: 'o2', mesa: 2, items: [SOPA(2), JUGO(1)] }] });
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial' && c.args.p_orden_id === 'o1' ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));
  const cobro1 = t.pos.facturarParcial({ seco: 1 });                      // la Mesa 1 queda esperando la respuesta
  await hastaQue(() => !!soltar);
  assert.equal(t.pos.cobrandoParcial, true);
  assert.equal(t.pos._cobrandoDe('o1'), true);
  assert.equal(t.pos._cobrandoDe('o2'), false, 'la otra mesa no está bloqueada');
  // la tablet pasa a la Mesa 2 (lo que ve ya no está «Registrando…») y cobra la mesa completa
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 2));
  assert.equal(t.pos.cobrandoParcial, false, 'los botones de la Mesa 2 están encendidos');
  await t.pos.facturar();
  await asentar(20);
  assert.equal(local(t, 'o2').estado, 'cerrada', 'la mesa completa de la Mesa 2 se cobró');
  assert.ok(!/Se está registrando un cobro de esta mesa/.test(t.pos.aviso ? t.pos.aviso.texto : ''), 'sin «espera a que termine»');
  // y la Mesa 1 vence a los 10 s
  t.timer(10000).fn();
  assert.equal(await cobro1, false);
  assert.equal(t.pos._cobrandoDe('o1'), false, 'se liberó');
  soltar();
  await asentar(20);
});

test('R3 la misma cuenta SÍ sigue protegida: con su cobro en camino, «Generar ticket y cobrar» de ESA mesa espera (avisa) y no cruza dos cobros', async () => {
  const t = await abrir();
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial' ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));
  const cobro = t.pos.facturarParcial({ seco: 1 });
  await hastaQue(() => !!soltar);
  await t.pos.facturar();
  assert.match(t.pos.aviso.texto, /Se está registrando un cobro de esta mesa/);
  assert.equal(local(t).estado, 'abierta');
  soltar();
  assert.equal(await cobro, true);
});

test('R4 el candado siempre se libera (finally): una excepción dentro del cobro, la espera vencida o un rechazo dejan la cuenta cobrable', async () => {
  const t = await abrir();
  const original = t.pos._cuentaLista;
  t.pos._cuentaLista = async () => { throw new Error('algo se rompió'); };
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  assert.equal(t.pos.cobrandoParcial, false);
  assert.deepEqual(plano(t.pos.cobrandoCuentas), {});
  t.pos._cuentaLista = original;
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), true, 'y la cuenta se puede cobrar');
});

test('R5 «sin red» antes de la llamada (la cola no se vacía porque la red está caída): «Sin red…», nada enviado, nada en duda, y la selección sigue para volver a intentar', async () => {
  const t = await abrir();
  t.base.red = false;
  t.pos.agregarProducto(producto(t, 'sopa'));
  await asentar(20);
  assert.equal(t.pos.colaDeltas.length, 1, 'el +1 quedó en la cola');
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  assert.ok(t.pos.aviso.texto.startsWith(SIN_RED));
  assert.equal(llamadas(t, 'cobrar_parcial').length, 0);
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {});
  assert.deepEqual(plano(t.pos.itemsSeleccionados), { seco: 1 });
  assert.equal(t.pos.cobrandoParcial, false);
});

// ═══════════════════ P. El día de la promo que la tablet espera es el de HOY (312eb93) ═══════════════════

test('P1 sin red una mesa abierta el DOMINGO con 3 Seco guardados sin descuento, HOY lunes: la tablet espera la promoción que pondrá la base (el día es el de la escritura) y no deja cobrar; el martes no', async () => {
  const domingo = '2026-10-04T23:30:00Z';   // 18:30 en Bogotá, domingo
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3)], version: 3, crudo: true, abiertaEn: domingo }], reloj: '2026-10-05T18:00:00Z' });
  t.base.red = false; t.pos.remoto = 'offline';
  assert.equal(t.pos._cuentaPideRed(local(t)), true, 'hoy es lunes: la base le pondría el 3er almuerzo');
  assert.match(t.pos.motivoSinCobro, /Sin red: esta cuenta tiene promoción; espera a que vuelva la red para cobrar/);
  const m = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3)], version: 3, crudo: true, abiertaEn: '2026-10-05T18:00:00Z' }], reloj: MARTES });
  m.base.red = false; m.pos.remoto = 'offline';
  assert.equal(m.pos._cuentaPideRed(local(m)), false, 'hoy es martes: aunque se abrió un lunes, la base no le pone nada');
  assert.equal(m.pos.motivoSinCobro, '');
});

// ═══════════════════ S. Estática ═══════════════════

/** El texto de un método del store (de su firma, a 12 espacios, hasta la del siguiente). Con los comentarios: algunas comprobaciones miran las marcas. */
const cuerpo = (nombre) => {
  const i = POS_HTML.search(new RegExp(`^ {12}(?:async\\s+)?${nombre}\\(`, 'm'));
  assert.ok(i !== -1, `no encontré ${nombre} en pos.html`);
  const j = POS_HTML.slice(i + 1).search(/^ {12}(?:async\s+|get\s+)?[A-Za-z_$][\w$]*\(.*\) \{$/m);
  return POS_HTML.slice(i, j === -1 ? undefined : i + 1 + j);
};

test('S1 estática: no hay «huella» ni firma con la versión; el intento se guarda en localStorage con su clave y ANTES de llamar; el candado es por cuenta y se libera en finally', () => {
  assert.doesNotMatch(POS_HTML, /huellaDeCobro|intento\.huella/, 'ya no hay una huella: un intento no se reenvía');
  assert.match(POS_HTML, /const CLAVE_COBROS_EN_DUDA = 'pos_cobros_en_duda';/);
  const base = cuerpo('_cobrarEnBase');
  assert.doesNotMatch(base, /JSON\.stringify\(\[tipo, cuenta\.id, version/, 'la «firma» de antes (con la versión) ya no existe');
  assert.doesNotMatch(POS_HTML, /_intentoCobro/, 'ya no hay un intento solo en memoria');
  assert.match(base, /intento = \{ \.\.\.intento, enviado: true, enviadoEn: Date\.now\(\), version \};\s*this\._guardarCobroEnDuda\(intento\);/, 'se guarda ANTES de llamar');
  assert.ok(base.indexOf('this._guardarCobroEnDuda(intento);   // ANTES de llamar') < base.indexOf("supabaseClient.rpc('cobrar_abono'"));
  assert.match(base, /if \(this\._cobrandoDe\(orden\.id\)\) return false;/);
  assert.match(base, /\} finally \{\s*const \{ \[orden\.id\]: _libre, \.\.\.resto \} = this\.cobrandoCuentas;\s*this\.cobrandoCuentas = resto;/, 'el candado se libera siempre');
  assert.match(POS_HTML, /get cobrandoParcial\(\) \{ const o = this\._ordenEnEdicion; return !!o && this\._cobrandoDe\(o\.id\); \}/, 'cobrandoParcial es el de la cuenta que se ve');
  assert.doesNotMatch(POS_HTML, /cobrandoParcial: false/, 'ya no hay una bandera global');
  assert.doesNotMatch(POS_HTML, /this\.cobrandoParcial = (true|false)/);
  assert.match(base, /_conTope\(this\._cuentaLista\(orden\.id\), TOPE_ESPERA_COLA_MS\)/, 'la espera de la cola tiene tope');
  assert.match(POS_HTML, /const TOPE_ESPERA_COLA_MS = 10000;/);
  assert.match(base, /p_delta_id: intento\.cobroId/);
  assert.match(base, /_conTope\(llamada, TOPE_COBRO_MS\)/);
});

test('S2 estática: la tablet reconcilia al volver la red (cada lectura que sale bien, el evento `online` y cada 7 s) y al arrancar; un cobro con un intento enviado pregunta primero y no sale en la misma llamada; el rechazo de la base suelta el intento y el fallo de red no', () => {
  assert.match(cuerpo('sincronizarSupabase'), /if \(this\.remoto === 'ok'\) this\._reconciliarCobrosEnDuda\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(cuerpo('cargarCachéLocal'), /this\._cargarCobrosEnDuda\(\);/);
  assert.match(POS_HTML, /window\.addEventListener\('online', \(\) => \{[\s\S]*?this\._reconciliarCobrosEnDuda\(\)\.catch/);
  const base = cuerpo('_cobrarEnBase');
  assert.match(base, /const previo = this\.cobrosEnDuda\[orden\.id\];[\s\S]*_resolverCobroEnDuda\(previo, \{ alUsuario: true \}\)[\s\S]*return false;/);
  const no = cuerpo('_cobroNoHecho');
  const iRed = no.indexOf('if (esErrorDeRed(e, respuesta))');
  const iSuelta = no.indexOf('this._soltarCobroEnDuda(cuenta.id);');
  assert.ok(iRed > 0 && iSuelta > iRed, 'primero el fallo de red (el intento queda), después lo que la base contestó (el intento se suelta)');
  assert.doesNotMatch(no.slice(iRed, no.indexOf('this._marcarConRed();', iRed)), /_soltarCobroEnDuda/, 'un fallo de red no suelta el intento');
  assert.match(cuerpo('_sondearCobro'), /\.from\('ordenes'\)\.select\('\*'\)\.eq\('id', intento\.ventaId\)\.eq\('parcial_de', intento\.cuentaId\)\.maybeSingle\(\)/, 'una lectura por id en ordenes');
});

test('S3 estática: el POS juzga la promo «que la base pondría» con el día de HOY (privado.dia_promo), no con el de abierta_en', () => {
  assert.doesNotMatch(POS_HTML, /function diaDeCuenta/);
  assert.match(POS_HTML, /cuentaTendriaPromo\(orden\.items, this\.productos, diaHoyBogota\(\)\)/);
});
