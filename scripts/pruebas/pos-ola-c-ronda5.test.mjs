// Ola C, ronda 5 (la tercera refutación y el rehacer del cierre del día): la lógica del POS (pos.html, su <script> REAL en un `vm`) contra la base falsa de
// _pos-vm.mjs, que modela supabase/migrations/20261002180000_deshacer_cobro.sql con lo que trajo esta ronda: `cerrar_dia(p_id, p_esperado)` que decide
// la base, el registro de ventas archivadas, los deltas idempotentes (`p_delta_id` y `ordenes.deltas_ids`) y los guardias de `ordenes`.
//
//   Lo que se pidió: SIMPLIFICAR la máquina del cierre. El cierre lo decide la base (ya no se compara una foto de la tablet), no hay cierre sin red, y los
//   deltas llevan un id para que reenviarlos no los duplique. Cada hallazgo de la refutación (r4.mjs, bloques A, A2, A4, B, D, G y Z) es una prueba que con
//   el POS de la ronda 4 (`POS_HTML=<pos.html de 3f5be4b>`) falla y con este pasa.
//
//   R5-1  no hay cierre sin red: el botón explica «Sin conexión» o «Hay N cambios sin subir» y «Reintentar subir» los sube
//   R5-A  cobrar sin red (con ítems agregados sin red) y «Cerrar día» sin red: no se cierra; al volver la red la venta sube entera y el cierre la incluye (A y A4)
//   R5-A2 (ronda 5a) un cierre «Sin respaldo» viejo ya no se resuelve solo: lo decide el admin en una hoja; ver pos-ola-c-r5a.test.mjs
//   R5-B  una venta de otro dispositivo que la tablet no vio entra en este cierre: la base responde `cambio` con sus números y el admin firma otra vez
//   R5-D  la respuesta de la fila cerrada se pierde y otro mesero toca «Deshacer»: reenviar los deltas no infla la cuenta
//   R5-G  sin ninguna orden cargada el POS sabe qué trae la base (el sondeo de columnas): no manda `version` a una base sin guardia
//   R5-Z  una venta que ya archivó otro dispositivo no vuelve a entrar en un segundo cierre
//   R5-I  ids de deltas: uno por delta, el mismo en cada reintento, y el camino de antes si la base no los tiene (POS C con base B)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  asentar, crearBaseFalsa, crearPos, haceMin, hastaQue, item, mesaBase, ordenBase, plano, textoDelScript,
} from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };

function montar({ rol = 'admin', mesas = [mesaBase(3)], ordenes = [], cierres = [], olaC = true, almacen } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, cierres, olaC });
  const original = base.responder;
  base.perderRespuesta = null;                  // nombre de una RPC cuya respuesta se pierde DESPUÉS de aplicarse
  base.perderUpsert = null;                     // tabla cuyo próximo upsert de una fila CERRADA se aplica y su respuesta se pierde
  base.responder = async (c) => {
    const r = await original(c);
    const perdida = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    if (base.perderRespuesta && c.tipo === 'rpc' && c.nombre === base.perderRespuesta) { base.perderRespuesta = null; return perdida; }
    if (base.perderUpsert && c.tipo === 'from' && c.op === 'upsert' && c.tabla === base.perderUpsert && [].concat(c.cuerpo).some((f) => f.estado === 'cerrada')) {
      base.perderUpsert = null;
      return perdida;
    }
    return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r;
  };
  const reales = { setTimeout, clearTimeout };
  const t = crearPos({
    base,
    almacen,
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
const sinRed = (t) => { t.base.red = false; t.pos.remoto = 'offline'; };
const conRed = (t) => { t.base.red = true; t.pos.remoto = 'ok'; };
const PALOMA = () => ({ id: 'paloma', nombre: 'Paloma', precio: 4500, qty: 2, nota: '' });
const PAN = () => ({ id: 'pan', nombre: 'Pan', precio: 3000, qty: 1, nota: '' });
const HAMBURGUESA = { id: 'hamb', nombre: 'Hamburguesa', precio: 30000 };
const cerrada = (id, mesa, items, version = 2, minutosAtras = 30) => ({ ...ordenBase(id, mesa, items, version, 'cerrada'), cerrada_en: haceMin(minutosAtras) });
const libre = (id) => mesaBase(id, { estado: 'libre' });
const idsDe = (items) => plano(items).map((i) => `${i.id}x${i.qty}`);
const mesaDe = (t, id) => t.pos.mesas.find((m) => m.id === id);
// ═════════════════════════ R5-1. No hay cierre sin red ═════════════════════════

test('R5-1a sin conexión el botón «Cerrar día» está apagado y dice «Sin conexión»; cerrarDia() no hace nada: ni llama a la base ni deja un cierre local', async () => {
  const t = montar({ mesas: [libre(3)], ordenes: [cerrada('a', 3, [PAN()], 2)] });
  await listo(t);
  assert.equal(t.pos.puedeCerrarAhora, true, 'con red y sin nada pendiente, sí');
  assert.equal(t.pos.razonSinCierre, '');
  sinRed(t);
  assert.match(t.pos.razonSinCierre, /^Sin conexión/);
  assert.equal(t.pos.puedeCerrarAhora, false);
  assert.equal(t.pos.puedesCerrar, true, 'hay ventas por cerrar (el motivo es la red, no que falte algo)');
  const antes = t.supabase.llamadas.length;
  assert.equal(await t.pos.cerrarDia(), 'bloqueado');
  assert.equal(t.supabase.llamadas.length, antes, 'ninguna llamada a la base');
  assert.equal(t.pos.cierres.length, 0, 'ningún cierre «Sin respaldo»');
  assert.equal(t.pos.ordenes.length, 1, 'la venta sigue en las ventas de hoy');
  assert.match(t.pos.cierreError, /Sin conexión/);
  conRed(t);
  assert.equal(t.pos.puedeCerrarAhora, true, 'al volver la red se habilita solo');
});

test('R5-1b «Conectando…»: tampoco se cierra mientras la tablet no sabe si tiene red', async () => {
  const t = montar({ mesas: [libre(3)], ordenes: [cerrada('a', 3, [PAN()], 2)] });
  t.pos.rol = 'admin'; t.pos.rolCargado = true;
  t.pos.ordenes = [t.pos.parseOrden(cerrada('a', 3, [PAN()], 2))];
  assert.equal(t.pos.remoto, 'conectando');
  assert.match(t.pos.razonSinCierre, /^Conectando/);
  assert.equal(t.pos.puedeCerrarAhora, false);
});

test('R5-1c con cambios sin subir (deltas, filas y cierres editados) el botón dice «Hay N cambios sin subir: espera a que suban»; «Reintentar subir» los sube y se habilita', async () => {
  const t = montar({ mesas: [libre(3), mesaBase(5)], ordenes: [cerrada('a', 3, [PAN()], 2), ordenBase('o5', 5, [PALOMA()], 1)] });
  await listo(t);
  // un delta en la cola (agregado sin red) y una fila pendiente
  await t.pos.abrirMesa(mesaDe(t, 5));
  sinRed(t);
  t.pos.agregarProducto(HAMBURGUESA);
  await asentar();
  conRed(t);
  assert.equal(t.pos.colaDeltas.length, 1);
  t.pos._pendientes['mesas:5'] = true;
  assert.equal(t.pos.cambiosSinSubir, 2, 'un delta + una fila');
  assert.equal(t.pos.razonSinCierre, 'Hay 2 cambios sin subir: espera a que suban.');
  // un cierre del historial editado sin red cuenta también (sync distinto de «ok»)
  t.pos.cierres = [{ id: 'k1', fecha: new Date().toISOString(), total: 1, ordenes: [], sync: 'error' }];
  assert.equal(t.pos.cambiosSinSubir, 3);
  assert.equal(t.pos.razonSinCierre, 'Hay 3 cambios sin subir: espera a que suban.');
  assert.equal(t.pos.puedeCerrarAhora, false);
  assert.equal(await t.pos.cerrarDia(), 'hay_abiertas', 'la mesa 5 sigue abierta: eso se dice antes');
  t.pos.cierres = [];
  delete t.pos._pendientes['mesas:5'];
  assert.equal(t.pos.razonSinCierre, 'Hay 1 cambio sin subir: espera a que suba.', 'en singular');
  await t.pos.reintentarSubir();
  await hastaQue(() => t.pos.colaDeltas.length === 0);
  assert.equal(t.base.ordenes.get('o5').items.find((i) => i.id === 'hamb')?.qty, 1, '«Reintentar subir» subió el delta');
  assert.equal(t.pos.razonSinCierre, '');
});

test('R5-1d el botón y la ventana de confirmación del marcado dependen de lo mismo (puedeCerrarAhora / razonSinCierre) y explican el motivo con «Reintentar subir»', () => {
  const POS = fs.readFileSync(process.env.POS_HTML || new URL('../../pos.html', import.meta.url), 'utf8');   // (POS_HTML: el pos.html de otra rama, para ver que esta prueba falla sin el cambio)
  assert.match(POS, /<button class="btn-primary [^"]*print:hidden" :disabled="!\$store\.pos\.puedeCerrarAhora"/);   // (las clases de tamaño son de pos-personas-botones: botón de pie, sin btn-lg)
  assert.match(POS, /id="cierre-razon"[\s\S]{0,400}x-text="\$store\.pos\.razonSinCierre"/, 'el botón apagado explica por qué');
  assert.match(POS, /@click="\$store\.pos\.reintentarSubir\(\)">Reintentar subir<\/button>/);
  assert.match(POS, /:disabled="\(\$store\.pos\.ordenesAbiertas\.length > 0 && !\$store\.pos\.cierreEsDePasado\) \|\| !!\$store\.pos\.razonSinCierre \|\| \$store\.pos\.cerrandoDia"/, '«Sí, cerrar día» también se apaga (salvo por las cuentas abiertas al cerrar un día pasado: no lo frenan)');
});

// ═════════════════════════ R5-A. Hallazgos A y A4: cobrar sin red y cerrar sin red ═════════════════════════

test('R5-A cobrar la mesa sin red tras agregarle algo sin red y tocar «Cerrar día» sin red: no se cierra; al volver la red el cobro sube entero una vez y el cierre de después lo incluye (A)', async () => {
  const c1 = cerrada('c1', 1, [item('pf7', 30000)], 2, 30);
  const t = montar({ mesas: [libre(1), mesaBase(3)], ordenes: [c1, ordenBase('o3', 3, [PALOMA()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  sinRed(t);
  t.pos.agregarProducto(HAMBURGUESA);                      // un delta en la cola (sin red)
  t.pos.facturar();                                        // cobro sin red: 2 palomas + 1 hamburguesa
  await asentar();
  assert.equal(await t.pos.cerrarDia(), 'bloqueado', 'sin red no se cierra el día');
  assert.equal(t.pos.cierres.length, 0);
  assert.equal(t.base.cierres.size, 0);
  assert.equal(t.pos.ordenes.find((o) => o.id === 'o3').estado, 'cerrada', 'el cobro de la caja sigue en pie, esperando red');
  assert.equal(t.pos.colaDeltas.length, 1, 'y su delta, retenido hasta que suba la fila');
  conRed(t);
  await t.pos.sincronizarSupabase();
  await hastaQue(() => t.pos.cambiosSinSubir === 0);
  const o3 = t.base.ordenes.get('o3');
  assert.equal(o3.estado, 'cerrada', 'la base tiene el cobro');
  assert.deepEqual(idsDe(o3.items), ['palomax2', 'hambx1'], 'entero y UNA vez (la hamburguesa viajó en la fila, no se aplicó otra vez como delta)');
  assert.equal(o3.total, 39000);
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(t.base.deltasAplicados.size, 1, 'y la base anotó ese delta como aplicado');
  assert.equal(t.pos.razonSinCierre, '');
  assert.equal(await t.pos.cerrarDia(), 'ok');
  const cierre = [...t.base.cierres.values()][0];
  assert.equal(cierre.total_ventas, 30000 + 39000, 'el cierre incluye la venta de la caja: el dinero cuadra');
  assert.deepEqual(cierre.transacciones.map((x) => x.id).sort(), ['c1', 'o3']);
  assert.equal(t.base.ordenes.size, 0);
  assert.equal(t.pos.aviso?.texto?.includes('algunas ventas cambiaron'), undefined, 'ningún aviso culpa a «otra tablet»');
});

test('R5-A4 un cobro por partes sin red, luego el resto de la mesa sin red, y «Cerrar día» sin red: ninguna parte se pierde (A4)', async () => {
  const t = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA(), PAN()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  sinRed(t);
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(t.pos.ordenActiva.items.find((i) => i.id === 'paloma'));
  t.pos.facturarParcial();                                 // las 2 palomas, sin red (queda un delta −2 en la cola)
  await asentar();
  t.pos.facturar();                                        // y el resto (el pan), sin red
  await asentar();
  assert.equal(await t.pos.cerrarDia(), 'bloqueado');
  conRed(t);
  await t.pos.sincronizarSupabase();
  await hastaQue(() => t.pos.cambiosSinSubir === 0);
  const cerradas = [...t.base.ordenes.values()].filter((o) => o.estado === 'cerrada');
  assert.equal(cerradas.length, 2, 'las dos partes llegaron a la base');
  assert.equal(cerradas.reduce((s, o) => s + o.total, 0), 12000, '9.000 de las palomas + 3.000 del pan');
  assert.equal(t.base.ordenes.get('o3').estado, 'cerrada');
  assert.deepEqual(idsDe(t.base.ordenes.get('o3').items), ['panx1'], 'la cuenta cerró con lo que quedaba, sin las palomas ya cobradas');
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.equal([...t.base.cierres.values()][0].total_ventas, 12000);
});

// ═════════════════════════ R5-A2. Un cierre «Sin respaldo» viejo ═════════════════════════
// (Ronda 5a: ya no se «resuelve al arrancar». Se simplificó a pedido de Yonatan: el cierre viejo sale de `cierres`, queda aparte y el admin decide en una hoja entre
//  «Subir las que faltan» y «Descartar este cierre local»; nada se recupera ni se purga solo. Las pruebas de eso están en pos-ola-c-r5a.test.mjs, R5a-3.)

// ═════════════════════════ R5-B. Una venta que la tablet no vio ═════════════════════════

test('R5-B un mesero cobró la mesa 5 y la tablet del admin no recibió el eco: la base responde cambio con SUS números (2 ventas), la tablet los muestra y, firmándolos, cierra con las dos (B)', async () => {
  const t = montar({ mesas: [libre(1), libre(5)], ordenes: [cerrada('c1', 1, [item('pf7', 30000)], 2, 30)] });
  await listo(t);
  t.base.ordenes.set('c5', cerrada('c5', 5, [item('be7', 35000, 2)], 3, 2));   // el mesero cobró y el eco no llegó a esta tablet
  assert.deepEqual(plano(t.pos.cierreVista), { n: 1, total: 30000 });
  assert.equal(await t.pos.cerrarDia(), 'cambio');
  assert.equal(t.base.cierres.size, 0, 'no cerró con la foto vieja');
  assert.equal(t.pos.cierreCambio, true);
  assert.deepEqual(plano(t.pos.cierreVista), { n: 2, total: 100000 }, 'la confirmación enseña los números de la base');
  assert.ok(t.pos.ordenes.some((o) => o.id === 'c5'), 'y la tablet ya releyó la venta que no veía');
  assert.equal(await t.pos.cerrarDia(), 'ok');
  const cierre = [...t.base.cierres.values()][0];
  assert.equal(cierre.total_ventas, 100000);
  assert.deepEqual(cierre.transacciones.map((x) => x.id).sort(), ['c1', 'c5']);
  assert.equal(t.base.ordenes.size, 0, 'ninguna venta quedó fuera del cierre');
});

test('R5-B2 una venta de AYER que nadie cerró NO es del turno de hoy (va al aviso «quedó sin cerrar»): «Cerrar día» cierra solo las de hoy y la de ayer se cierra por su día, sin quedarse sin archivar', async () => {
  const ayer = cerrada('ayer', 2, [PAN()], 1, 26 * 60);
  const t = montar({ mesas: [libre(1), libre(2)], ordenes: [cerrada('c1', 1, [item('pf7', 30000)], 2, 30), ayer] });
  await listo(t);
  assert.equal(t.pos.ordenesHoy.length, 1, 'las ventas del turno son solo las de hoy');
  assert.equal(t.pos.totalHoy, 30000);
  assert.equal(t.pos.ordenesPorCerrar.length, 2, 'la de ayer sigue por cerrar (no se pierde)');
  assert.equal(t.pos.diasSinCerrar.length, 1);
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.deepEqual([...t.base.cierres.values()][0].transacciones.map((x) => x.id), ['c1'], 'el cierre de hoy lleva solo lo de hoy');
  assert.deepEqual([...t.base.ordenes.keys()], ['ayer'], 'la de ayer sigue en la base, sin archivar');
  assert.equal(t.pos.ordenesPorCerrar.length, 1);
  // el día de ayer se cierra por separado, con la fecha de ayer
  await asentar();                                   // (la relectura que dispara el primer cierre termina antes del segundo)
  assert.equal(t.pos.cerrarDiaPasado(t.pos.diasSinCerrar[0].dia), true);
  assert.equal(await t.pos.cerrarDia(), 'ok');
  await asentar();
  assert.equal(t.base.cierres.size, 2);
  assert.equal(t.base.ordenes.size, 0, 'la de ayer ya no se queda en la base sin entrar en ningún cierre');
  assert.equal(t.pos.diasSinCerrar.length, 0);
});

test('R5-B3 si de la foto de la tablet solo queda una venta que la base ya archivó, la base dice sin_ventas: la tablet lo explica, relee y no inventa un cierre', async () => {
  const t = montar({ mesas: [libre(1)], ordenes: [cerrada('c1', 1, [item('pf7', 30000)], 2, 30)] });
  await listo(t);
  // otro dispositivo cerró el día con c1 y la tablet no se enteró
  await t.base.responder({ tipo: 'rpc', nombre: 'cerrar_dia', args: { p_id: 'K-otro', p_esperado: { n: 1, total: 30000, ids: ['c1'] } } });
  assert.equal(t.base.ordenes.size, 0);
  assert.equal(t.pos.puedesCerrar, true, 'la tablet todavía ve la venta');
  t.pos.modalConfirmCierre = true;
  assert.equal(await t.pos.cerrarDia(), 'sin_ventas');
  await asentar();
  assert.match(t.pos.aviso.texto, /No hay ventas por cerrar/);
  assert.equal(t.pos.modalConfirmCierre, false);
  assert.equal(t.base.cierres.size, 1, 'sigue habiendo un solo cierre');
  assert.equal(t.pos.puedesCerrar, false, 'y la tablet soltó la venta que ya no existe');
});

test('R5-B4 un rezago ya archivado que la base todavía devuelve (la purga de un POS viejo falló): la base no lo cuenta pero la tablet sí lo ve; la ventana enseña los números de la base y, firmándolos, cierra (y la base borra el rezago) sin dar vueltas', async () => {
  const rezago = cerrada('r1', 1, [PAN()], 2, 90);
  const t = montar({
    mesas: [libre(1), libre(2)],
    ordenes: [rezago, cerrada('c2', 2, [item('p', 7000)], 2, 10)],
    cierres: [{ id: 'K-pos-viejo', fecha: new Date().toISOString(), total_ventas: 3000, total_ordenes: 1, transacciones: [{ id: 'r1', total: 3000 }] }],
  });
  await listo(t);
  assert.deepEqual(plano(t.pos.cierreVista), { n: 2, total: 10000 }, 'la tablet ve las dos cerradas');
  assert.equal(await t.pos.cerrarDia(), 'cambio');
  assert.equal(t.pos.ordenesPorCerrar.length, 2, 'y después de releer sigue viendo las dos (el rezago sigue en la tabla `ordenes`)');
  assert.deepEqual(plano(t.pos.cierreVista), { n: 1, total: 7000 }, 'pero la ventana enseña lo que dice la base: una sola venta, la que de verdad se cierra');
  assert.equal(t.pos.cierreCambio, true);
  assert.equal(await t.pos.cerrarDia(), 'ok', 'firmando los números de la base cierra, sin entrar en un ciclo de «cambio»');
  assert.equal([...t.base.cierres.values()].find((c) => c.id !== 'K-pos-viejo').total_ventas, 7000);
  assert.equal(t.base.ordenes.size, 0, 'y la base se llevó también el rezago');
  assert.equal(t.supabase.rpcs('cerrar_dia_de').length, 2);
});

// ═════════════════════════ R5-D. Respuesta perdida + «Deshacer» ═════════════════════════

test('R5-D la fila cerrada de una cuenta con deltas sin red llega a la base pero su respuesta se pierde; otro mesero toca «Deshacer»; al reintentar, los deltas NO se aplican otra vez (D)', async () => {
  const t = montar({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  sinRed(t);
  t.pos.agregarProducto(HAMBURGUESA); t.pos.agregarProducto(HAMBURGUESA);   // 2 deltas distintos, con su id
  t.pos.facturar();
  await asentar();
  assert.equal(t.pos.colaDeltas.length, 2);
  assert.equal(new Set(t.pos.colaDeltas.map((d) => d.id)).size, 2, 'cada delta con su id');
  conRed(t);
  t.base.perderUpsert = 'ordenes';
  await t.pos._subirLoPendiente();
  await asentar();
  assert.equal(t.base.ordenes.get('o3').estado, 'cerrada', 'la base aceptó la fila cerrada (con las 2 hamburguesas)');
  assert.deepEqual(idsDe(t.base.ordenes.get('o3').items), ['palomax2', 'hambx2']);
  assert.equal(t.base.deltasAplicados.size, 2, 'y anotó los ids de los 2 deltas cuyo efecto viajó en la fila');
  assert.equal(t.pos.colaDeltas.length, 2, 'la tablet no lo sabe: sigue con el pendiente y los 2 deltas');
  // Otro mesero toca «Deshacer» en ese cobro: la cuenta se reabre con todo.
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'deshacer_cobro', args: { p_orden_id: 'o3' } });
  assert.equal(r.data.reabierta, true);
  assert.deepEqual(idsDe(t.base.ordenes.get('o3').items), ['palomax2', 'hambx2']);
  // La siguiente pasada de la tablet: la fila cerrada choca (la cuenta cambió) y se aplican los deltas a la cuenta abierta.
  await t.pos._subirLoPendiente();
  await asentar(); await asentar(); await asentar();
  const b = t.base.ordenes.get('o3');
  assert.equal(b.estado, 'abierta');
  assert.deepEqual(idsDe(b.items), ['palomax2', 'hambx2'], 'las hamburguesas siguen siendo 2 (con el POS de la ronda 4 quedaban 4)');
  assert.equal(b.total, 9000 + 60000);
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('R5-D2 un delta cuya respuesta se pierde y se reenvía (el mismo id) tampoco se duplica, y el id sobrevive a recargar la página', async () => {
  const t = montar({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  t.base.perderRespuesta = 'aplicar_delta_orden';
  t.pos.agregarProducto(HAMBURGUESA);                      // la base lo aplica; la respuesta se pierde; el delta queda en la cola
  await asentar();
  assert.equal(t.base.ordenes.get('o3').items.find((i) => i.id === 'hamb')?.qty, 1);
  assert.equal(t.pos.colaDeltas.length, 1);
  const id = t.pos.colaDeltas[0].id;
  assert.ok(id, 'el delta tiene id');
  assert.equal(JSON.parse(t.almacen.get('pos_delta_queue'))[0].id, id, 'y el id se guardó con la cola');
  await t.pos.flushDeltas();
  await asentar();
  const llamadas = t.supabase.rpcs('aplicar_delta_orden').filter((c) => c.args.p_item_id === 'hamb');
  assert.equal(llamadas.length, 2);
  assert.deepEqual(llamadas.map((c) => c.args.p_delta_id), [id, id], 'el reintento lleva el MISMO id');
  assert.equal(t.base.ordenes.get('o3').items.find((i) => i.id === 'hamb')?.qty, 1, 'la hamburguesa sigue siendo UNA');
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('R5-D3 con red, un delta que quedó en la cola y se cobra la cuenta: la fila lleva su id, la base lo anota y el delta sale de la cola SIN mandarse (no sobra para descartarse después con un aviso falso)', async () => {
  const t = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  // el delta de la hamburguesa se agregó en local y su subida falló: sigue en la cola, con id
  const orden = t.pos.ordenActiva;
  orden.items.push({ id: 'hamb', nombre: 'Hamburguesa', precio: 30000, qty: 1, nota: '' });
  t.pos.colaDeltas.push({ id: 'delta-que-quedo', orden_id: 'o3', item_id: 'hamb', nombre: 'Hamburguesa', precio: 30000, nota: '', delta: 1 });
  t.pos.facturar();
  await asentar(); await asentar();
  const subida = t.supabase.de('ordenes', 'upsert').find((c) => c.cuerpo.estado === 'cerrada');
  assert.deepEqual(plano(subida.cuerpo.deltas_ids), ['delta-que-quedo'], 'la fila trae el id del delta cuyo efecto ya lleva');
  assert.equal(t.base.deltasAplicados.has('delta-que-quedo'), true, 'la base lo anotó');
  assert.equal(t.pos.colaDeltas.length, 0, 'y la tablet lo soltó de la cola');
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, 0, 'sin llamar nunca a aplicar_delta_orden');
  assert.equal(t.base.ordenes.get('o3').estado, 'cerrada');
  assert.deepEqual(idsDe(t.base.ordenes.get('o3').items), ['palomax2', 'hambx1']);
  assert.equal(t.pos.aviso, null, 'y sin avisos de «lo último que agregaste no se guardó»');
});

// ═════════════════════════ R5-G. Sin órdenes cargadas ═════════════════════════

test('R5-G1 el POS arranca con CERO órdenes contra una base SIN guardia (la migración sin aplicar): el sondeo de columnas lo averigua y no manda `version` (G)', async () => {
  const t = montar({ olaC: false, mesas: [libre(2)], ordenes: [] });
  await listo(t);
  assert.equal(t.pos.ordenes.length, 0, 'no hay una sola orden cargada');
  assert.equal(t.pos._baseConGuardia, false, 'y aun así sabe que la base no tiene el guardia');
  assert.equal(t.pos._baseSondeada, true);
  assert.equal(t.pos._sinDeltaIds, true, 'ni los ids de deltas');
  const fila = t.pos.formatOrden({ id: 'x', mesaId: 2, estado: 'cerrada', items: [], total: 0, version: 1, cierraConVersion: true });
  assert.equal('version' in fila, false);
  // y el escenario del hallazgo: abrir, otra tablet agrega, cobrar: la base no retrocede
  await t.pos.abrirMesa(mesaDe(t, 2));
  t.pos.agregarProducto(HAMBURGUESA);
  await asentar();
  const id = t.pos.ordenActiva.id;
  t.base.ordenes.get(id).items.push({ id: 'jugo', nombre: 'Jugo', precio: 12000, qty: 1, nota: '' }); t.base.ordenes.get(id).version = 5;
  t.pos.facturar(); await asentar(); await asentar();
  const up = t.supabase.de('ordenes', 'upsert').filter((c) => c.cuerpo.estado === 'cerrada').at(-1);
  assert.equal('version' in up.cuerpo, false);
  assert.equal(t.base.ordenes.get(id).version, 5, 'la version de la base no retrocedió');
});

test('R5-G2 con la base de la ola C y cero órdenes, el sondeo confirma el guardia y SÍ manda la version', async () => {
  const t = montar({ mesas: [mesaBase(2)], ordenes: [] });
  await listo(t);
  assert.equal(t.pos.ordenes.length, 0);
  assert.equal(t.pos._baseConGuardia, true);
  assert.equal(t.pos._sinDeltaIds, false);
  const fila = t.pos.formatOrden({ id: 'x', mesaId: 2, estado: 'cerrada', items: [], total: 0, version: 4, cierraConVersion: true });
  assert.equal(fila.version, 4);
});

test('R5-G3 si el sondeo no pudo concluir (sin red, un 5xx) no se supone nada: no se manda version hasta saberlo, y se vuelve a preguntar en la próxima lectura', async () => {
  const t = montar({ mesas: [mesaBase(2)], ordenes: [] });
  t.base.fallar('select:ordenes');
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos._sondeando === false);
  await asentar();
  assert.equal(t.pos._baseConGuardia, undefined, 'no se sabe');
  assert.equal(t.pos._baseSondeada, false);
  const fila = t.pos.formatOrden({ id: 'x', mesaId: 2, estado: 'cerrada', items: [], total: 0, version: 4, cierraConVersion: true });
  assert.equal('version' in fila, false, '«no se sabe» no manda version (el guardia de la base no se activa, pero tampoco se la escribe hacia atrás)');
  t.base.repararTodo();
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(t.pos._baseConGuardia, true, 'la próxima lectura lo averigua');
  assert.equal(t.pos._baseSondeada, true);
  const antes = t.supabase.llamadas.filter((c) => c.limite === 0).length;
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(t.supabase.llamadas.filter((c) => c.limite === 0).length, antes, 'y una vez sabido, no vuelve a preguntar');
});

// ═════════════════════════ R5-Z. Doble archivo ═════════════════════════

test('R5-Z el cobro de la caja llega a la base pero su respuesta se pierde; otro dispositivo admin cierra el día con esa venta; la caja reintenta: la venta NO resucita y aparece en UN solo cierre (Z)', async () => {
  const t = montar({ mesas: [mesaBase(2)], ordenes: [ordenBase('o2', 2, [item('be7', 35000, 2)], 1)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 2));
  t.base.perderUpsert = 'ordenes';
  t.pos.facturar();                                        // la base lo guarda; la caja no lo sabe
  await asentar();
  assert.equal(t.base.ordenes.get('o2').estado, 'cerrada');
  assert.equal(t.pos._pendientes['ordenes:o2'], true, 'la caja sigue con el cobro «pendiente»');
  // otro dispositivo admin cierra el día con o2
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'cerrar_dia', args: { p_id: 'K-otro', p_esperado: { n: 1, total: 70000, ids: ['o2'] } } });
  assert.equal(r.data.ok, true);
  assert.equal(t.base.ordenes.size, 0);
  // la caja relee: o2 no está en la base pero su subida sigue pendiente: se vuelve a subir… y la base la descarta (ya está archivada)
  await t.pos.sincronizarSupabase();
  await hastaQue(() => t.pos.cambiosSinSubir === 0);
  assert.equal(t.base.ordenes.has('o2'), false, 'la base no la dejó resucitar');
  assert.match(t.pos.aviso.texto, /ya estaba en un cierre del día/, 'y ya no es en silencio: la base la rechazó con RS005 y la caja lo avisa');
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(t.pos.ordenes.some((o) => o.id === 'o2'), false, 'y la caja la soltó');
  assert.equal(await t.pos.cerrarDia(), 'sin_ventas');
  assert.equal(t.base.cierres.size, 1);
  assert.equal([...t.base.cierres.values()].flatMap((c) => c.transacciones).filter((x) => x.id === 'o2').length, 1, 'o2 aparece en UN solo cierre');
});

test('R5-Z2 un cierre que traiga una venta ya archivada en otro nunca se cuenta dos veces: la base toma solo lo que ningún cierre se llevó', async () => {
  const t = montar({ mesas: [libre(2)], ordenes: [cerrada('o2', 2, [item('be7', 35000, 2)], 1, 5)], cierres: [{ id: 'K-otro', fecha: new Date().toISOString(), total_ventas: 70000, total_ordenes: 1, transacciones: [{ id: 'o2', total: 70000 }] }] });
  await listo(t);
  // (un POS que dejó o2 sin purgar: sigue en la base aunque ya está en un cierre)
  assert.equal(t.base.ordenes.has('o2'), true);
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'cerrar_dia', args: { p_id: 'K-nuevo', p_esperado: { n: 0, total: 0, ids: [] } } });
  assert.equal(r.data.codigo, 'sin_ventas', 'o2 no se cuenta otra vez');
});

// ═════════════════════════ R5-I. Ids de deltas y el camino de antes ═════════════════════════

test('R5-I1 cada delta nace con su id y la RPC lo lleva como p_delta_id; una venta cobrada con deltas en la cola lleva sus ids en deltas_ids', async () => {
  const t = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.agregarProducto(HAMBURGUESA); t.pos.agregarProducto(HAMBURGUESA);
  await asentar();
  const llamadas = t.supabase.rpcs('aplicar_delta_orden');
  assert.equal(llamadas.length, 2);
  assert.equal(new Set(llamadas.map((c) => c.args.p_delta_id)).size, 2, 'dos deltas, dos ids');
  assert.ok(llamadas.every((c) => /^[a-z0-9]{10,}$/.test(c.args.p_delta_id)));
  // una fila cerrada con deltas en cola
  t.pos.colaDeltas = [{ id: 'dX', orden_id: 'o3', item_id: 'hamb', nombre: 'H', precio: 1, nota: '', delta: 1 }, { id: 'dY', orden_id: 'o3', item_id: 'q', nombre: 'Q', precio: 1, nota: '', delta: 1, editaCerrada: true }, { orden_id: 'o3', item_id: 'z', nombre: 'Z', precio: 1, nota: '', delta: 1 }];
  const fila = t.pos.formatOrden({ id: 'o3', mesaId: 3, estado: 'cerrada', items: [], total: 0 });
  assert.deepEqual(plano(fila.deltas_ids), ['dX'], 'solo los que tienen id y no son de «Editar» una venta cerrada');
  assert.equal('deltas_ids' in t.pos.formatOrden({ id: 'o3', mesaId: 3, estado: 'abierta', items: [], total: 0 }), false, 'una cuenta abierta no lleva ids');
  assert.equal('deltas_ids' in t.pos.formatOrden({ id: 'otra', mesaId: 3, estado: 'cerrada', items: [], total: 0 }), false, 'ni una cerrada sin deltas en cola');
});

test('R5-I2 un delta que quedó en la cola de una versión anterior (sin id) recibe el suyo y se guarda ANTES de mandarse', async () => {
  const almacen = new Map([['pos_delta_queue', JSON.stringify([{ orden_id: 'o3', item_id: 'hamb', nombre: 'Hamburguesa', precio: 30000, nota: '', delta: 1 }])]]);
  const t = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1)], almacen });
  t.pos.cargarCachéLocal();
  assert.equal(t.pos.colaDeltas[0].id, undefined);
  let guardadoAntes = null;
  const original = t.base.responder;
  t.base.responder = async (c) => { if (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden') guardadoAntes = JSON.parse(t.almacen.get('pos_delta_queue'))[0].id; return original(c); };
  await listo(t);
  await hastaQue(() => t.pos.colaDeltas.length === 0);
  const llamada = t.supabase.rpcs('aplicar_delta_orden')[0];
  assert.ok(llamada.args.p_delta_id, 'la RPC lleva un id');
  assert.equal(guardadoAntes, llamada.args.p_delta_id, 'y ya estaba guardado en la cola cuando se mandó');
  assert.equal(t.base.ordenes.get('o3').items.find((i) => i.id === 'hamb')?.qty, 1);
});

test('R5-I3 POS de la ola C con la base de la ola B (sin la migración): el sondeo apaga los ids; el delta y la fila cerrada van como siempre y el cierre cae al camino de antes', async () => {
  const t = montar({ olaC: false, mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1)] });
  await listo(t);
  assert.equal(t.pos._sinDeltaIds, true);
  assert.equal(t.pos._baseConGuardia, false);
  await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.agregarProducto(HAMBURGUESA);
  await asentar();
  const d = t.supabase.rpcs('aplicar_delta_orden')[0];
  assert.equal('p_delta_id' in d.args, false, 'sin migración, el delta no lleva id');
  assert.equal(t.base.ordenes.get('o3').items.find((i) => i.id === 'hamb')?.qty, 1);
  t.pos.facturar(); await asentar(); await asentar();
  const up = t.supabase.de('ordenes', 'upsert').find((c) => c.cuerpo.estado === 'cerrada');
  assert.equal('deltas_ids' in up.cuerpo, false);
  assert.equal('version' in up.cuerpo, false);
  assert.equal(t.base.ordenes.get('o3').estado, 'cerrada');
  assert.equal(await t.pos.cerrarDia(), 'legado', 'el admin sigue cerrando el día (el camino de antes)');
  await hastaQue(() => t.pos.cierres[0]?.sync === 'ok' && !t.pos.cierres[0].purgar);
  assert.equal(t.base.cierres.size, 1);
  assert.equal(t.base.ordenes.size, 0);
});

test('R5-I4 si el sondeo todavía no corrió y la base no tiene el parámetro p_delta_id: la RPC da «función inexistente», se repite sin el id y el POS se acuerda (_sinDeltaIds)', async () => {
  const t = montar({ olaC: false, mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1)] });
  await listo(t);
  t.pos._sinDeltaIds = false;                              // como si no se hubiera sondeado
  await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.agregarProducto(HAMBURGUESA);
  await asentar();
  const llamadas = t.supabase.rpcs('aplicar_delta_orden');
  assert.deepEqual(llamadas.map((c) => 'p_delta_id' in c.args), [true, false], 'se intentó con el id y se repitió sin él');
  assert.equal(t.pos._sinDeltaIds, true);
  assert.equal(t.base.ordenes.get('o3').items.find((i) => i.id === 'hamb')?.qty, 1);
  t.pos.agregarProducto(HAMBURGUESA); await asentar();
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, 3, 'el siguiente delta ya no vuelve a probar con id');
});

test('R5-I5 una fila cerrada con deltas_ids a una base sin esa columna (PGRST204) se repite sin ella y no se pierde', async () => {
  const t = montar({ olaC: false, mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1)] });
  await listo(t);
  t.pos._sinDeltaIds = false;
  await t.pos.abrirMesa(mesaDe(t, 3));
  sinRed(t);
  t.pos.agregarProducto(HAMBURGUESA);
  t.pos.facturar();
  await asentar();
  conRed(t);
  await t.pos._subirLoPendiente();
  await asentar(); await asentar();
  const subidas = t.supabase.de('ordenes', 'upsert').filter((c) => c.cuerpo.estado === 'cerrada');
  assert.deepEqual(subidas.map((c) => 'deltas_ids' in c.cuerpo), [true, false], 'primero con la columna, luego sin ella');
  assert.equal(t.pos._sinDeltaIds, true);
  assert.equal(t.base.ordenes.get('o3').estado, 'cerrada', 'la venta llegó');
  assert.equal(t.pos.colaDeltas.length, 0, 'y sus deltas se soltaron (la fila ya los trae)');
});

// ═════════════════════════ R5-E. Lo que sale del código ═════════════════════════

test('R5-E el store ya no sabe de `sinSubir`, de _cierreRechazado ni de cerrar_dia con foto (p_transacciones, p_versiones): una máquina menos', () => {
  const src = textoDelScript();
  const sinComentarios = src.replace(/\/\/.*$/gm, '');
  for (const muerto of ['sinSubir', '_cierreRechazado', '_cerrarDiaEnBase', 'p_transacciones', 'p_versiones', 'restaurar']) {
    assert.ok(!sinComentarios.includes(muerto), `«${muerto}» sigue en el código`);
  }
  assert.match(sinComentarios, /const firmado = this\._esperadoCierre\(\);/, 'lo que el admin firma se toma antes de llamar a la base');
  assert.match(sinComentarios, /supabaseClient\.rpc\('cerrar_dia', \{ p_id: id, p_esperado: firmado \}\)/);
  const usos = [...sinComentarios.matchAll(/(^|[^\w.])(alert|confirm|prompt)\(/gm)].length;
  assert.ok(usos <= 26, `hay ${usos} alert()/confirm()/prompt(): la ola B tenía 26 y no se agrega ninguno`);
});

test('R5-E2 `ordenesPorCerrar` son todas las cerradas que ningún cierre se llevó y `ordenesHoy` solo las de hoy (la de ayer va a `diasSinCerrar`); una archivada con la purga en camino no cuenta', async () => {
  const t = montar({ mesas: [libre(1)], ordenes: [] });
  t.pos.ordenes = [t.pos.parseOrden(cerrada('a', 1, [PAN()], 1, 5)), t.pos.parseOrden(cerrada('b', 1, [PAN()], 1, 60 * 30)), t.pos.parseOrden(ordenBase('c', 2, [PAN()], 1))];
  assert.deepEqual(t.pos.ordenesPorCerrar.map((o) => o.id).sort(), ['a', 'b'], 'la de ayer sigue por cerrar; la abierta no');
  assert.deepEqual(t.pos.ordenesHoy.map((o) => o.id), ['a'], 'pero el turno de hoy es solo la de hoy');
  assert.deepEqual(plano(t.pos.diasSinCerrar).map((d) => [d.n, d.total]), [[1, 3000]]);
  t.pos.cierres = [{ id: 'k', fecha: new Date().toISOString(), total: 3000, ordenes: [], sync: 'ok', purgar: ['b'] }];
  assert.deepEqual(t.pos.ordenesPorCerrar.map((o) => o.id), ['a']);
  assert.deepEqual(t.pos.ordenesHoy.map((o) => o.id), ['a']);
  assert.deepEqual(plano(t.pos.diasSinCerrar), [], 'y una archivada no es un día sin cerrar');
});

test('R5-M el cierre se confirma dentro de la página: abrir y cerrar la ventana limpia lo de un intento anterior', async () => {
  const t = montar({ mesas: [libre(1)], ordenes: [cerrada('a', 1, [PAN()], 2)] });
  await listo(t);
  t.pos.cierreResumen = { n: 9, total: 9, ids: [] }; t.pos.cierreCambio = true; t.pos.cierreError = 'x'; t.pos._cierreIntentoId = 'viejo';
  t.pos.abrirConfirmarCierre();
  assert.equal(t.pos.modalConfirmCierre, true);
  assert.equal(t.pos.cierreResumen, null); assert.equal(t.pos.cierreCambio, false); assert.equal(t.pos.cierreError, ''); assert.equal(t.pos._cierreIntentoId, null);
  assert.deepEqual(plano(t.pos.cierreVista), { n: 1, total: 3000 });
  t.pos.cierreCambio = true;
  t.pos.cerrarConfirmarCierre();
  assert.equal(t.pos.modalConfirmCierre, false); assert.equal(t.pos.cierreCambio, false);
  assert.equal(t.avisos.length, 0, 'ni un alert() nativo');
});
