// Ola C, ronda 4 (las correcciones de la segunda refutación): la lógica del POS (pos.html, su <script> REAL en un `vm`) contra la base falsa de
// _pos-vm.mjs, que modela supabase/migrations/20261002180000_deshacer_cobro.sql: `deshacer_cobro` sin ventana, el guardia de `ordenes` (RS003) y
// `cerrar_dia` (el cierre del día atómico).
//
//   S1  el cierre del día lo hace la base en una transacción: una foto vieja NO borra la cuenta que un mesero acaba de reabrir con «Deshacer»,
//       ni cuenta una venta deshecha; nunca se borra una cuenta abierta (hallazgo 1)
//   S2  una cuenta cobrada sin red no pierde los ítems agregados sin red cuando la base rechaza el cobro (RS003), y el aviso dice la verdad (hallazgo 2)
//   S3  «Cobros deshechos hoy» no depende del reloj de la tablet ni de cuándo se abrió la pantalla: lo atribuye la base al cerrar (hallazgo 3)
//   S4  el POS de la ola C sobre la base de la ola B no manda `version` (la base la escribiría hacia atrás) (hallazgo 4)
//   S5  los fallos del deshacer dicen la verdad: ya reabierta, mesa ocupada (hallazgo 5)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asentar, crearBaseFalsa, crearPos, haceMin, hastaQue, item, mesaBase, ordenBase, plano,
} from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };

function montar({ rol = 'admin', mesas = [mesaBase(3)], ordenes = [], cierres = [], olaC = true } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, cierres, olaC });
  const original = base.responder;
  base.perderRespuesta = null;                  // nombre de una RPC cuya respuesta se pierde DESPUÉS de aplicarse (la red cae justo tras el commit)
  base.responder = async (c) => {
    const r = await original(c);
    if (base.perderRespuesta && c.tipo === 'rpc' && c.nombre === base.perderRespuesta) {
      base.perderRespuesta = null;
      return { data: null, error: { message: 'TypeError: Failed to fetch' } };
    }
    return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r;
  };
  const reales = { setTimeout, clearTimeout };
  const t = crearPos({
    base,
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
const CERVEZA = { id: 'cerveza', nombre: 'Cerveza', precio: 8000 };
const idsDe = (items) => plano(items).map((i) => `${i.id}x${i.qty}`);
const cerrada = (id, mesa, items, version = 2, minutosAtras = 30) => ({ ...ordenBase(id, mesa, items, version, 'cerrada'), cerrada_en: haceMin(minutosAtras) });
const libre = (id) => mesaBase(id, { estado: 'libre' });

// ═════════════════════════ S1. El cierre del día lo decide la base (hallazgo 1 de la ronda 2; puesto al día en la ronda 5) ═════════════════════════
// (Hoy la tablet ya no manda su foto: manda lo que espera —cuántas ventas, cuánto y cuáles— y la base cierra solo si es lo que hay.)

test('S1a el cierre normal pasa por cerrar_dia: la base guarda el cierre y borra las ventas, y el historial queda «Respaldado» sin ningún upsert ni purga desde el POS', async () => {
  const a = cerrada('a', 3, [item('pa', 30000)], 2);
  const b = cerrada('b', 3, [item('pb', 56000)], 5);
  const t = montar({ mesas: [libre(3)], ordenes: [a, b] });
  await listo(t);
  assert.equal(t.pos.ordenesHoy.length, 2);
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.equal(t.base.cierresRpc, 1, 'una sola llamada a cerrar_dia');
  assert.equal(t.base.cierres.size, 1);
  assert.equal([...t.base.cierres.values()][0].total_ventas, 86000);
  assert.equal(t.base.ordenes.size, 0, 'la base borró las ventas archivadas, en la misma transacción');
  assert.equal(t.pos.cierres[0].sync, 'ok');
  assert.equal(t.pos.cierres[0].purgar, undefined, 'sin purga pendiente');
  assert.equal(t.pos.cierres[0].sinSubir, undefined);
  assert.equal(t.pos.cierres[0].total, 86000);
  assert.equal(t.pos.cierres[0].ordenes.length, 2, 'el cierre local es el que armó la base, con sus ventas');
  assert.equal(t.supabase.de('cierres', 'upsert').length, 0, 'el cierre ya no se sube con un upsert aparte');
  assert.equal(t.supabase.de('ordenes', 'delete').length, 0, 'ni se purga por id desde el POS');
  assert.equal(t.pos.ordenesHoy.length, 0);
  assert.equal(t.pos.puedesCerrar, false, 'y no se puede cerrar dos veces con las mismas ventas');
  assert.equal(t.pos.modalConfirmCierre, false);
});

test('S1b el hallazgo: el mesero reabre un cobro completo, la tablet del admin lo tiene cerrado y cierra el día: la base lo rechaza (hay una cuenta abierta), la cuenta reabierta sigue abierta y entera, y el POS vuelve a leer', async () => {
  const c1 = cerrada('c1', 3, [PALOMA(), PAN()], 2);
  const t = montar({ mesas: [libre(3)], ordenes: [c1] });
  await listo(t);
  assert.equal(t.pos.ordenesAbiertas.length, 0, 'la tablet del admin ve la mesa cobrada');
  // En la base, otro dispositivo deshizo el cobro (la mesa 3 se reabrió con c1, version 3) y el eco no llegó a esta tablet.
  const enBase = t.base.ordenes.get('c1'); Object.assign(enBase, { estado: 'abierta', cerrada_en: null, version: 3 }); t.base.mesas.get(3).estado = 'ocupada';
  assert.equal(await t.pos.cerrarDia(), 'hay_abiertas');
  await asentar();
  assert.equal(t.base.cierres.size, 0, 'la base no guardó ningún cierre');
  assert.equal(t.base.ordenes.get('c1').estado, 'abierta', 'la cuenta reabierta NO se borró');
  assert.equal(t.base.mesas.get(3).estado, 'ocupada');
  assert.equal(t.pos.cierres.length, 0, 'ni siquiera hay un cierre local que deshacer');
  assert.match(t.pos.aviso.texto, /No se cerró el día: hay cuentas abiertas \(Mesa 3\)/);
  const local = t.pos.ordenes.find((o) => o.id === 'c1');
  assert.equal(local.estado, 'abierta', 'y la tablet ya la ve abierta (la volvió a leer)');
  assert.equal(t.pos.ordenesAbiertas.length, 1);
  assert.equal(t.pos.puedesCerrar, false, 'sin ventas cerradas no hay nada que cerrar hasta que se cobre');
});

test('S1c variante fusionada: el cobro ya pasó a OTRA cuenta (y desapareció): la base dice cambio con lo que de verdad hay, el POS enseña esos números y, firmándolos, cierra', async () => {
  const c1 = cerrada('c1', 3, [PALOMA()], 2);
  const a2 = cerrada('a2', 3, [PAN()], 4);
  const t = montar({ mesas: [libre(3)], ordenes: [c1, a2] });
  await listo(t);
  // Otro dispositivo deshizo c1 FUSIONÁNDOLO con a2 (que estaba abierta y se cobró de nuevo): c1 ya no existe, y queda en deshechos.
  t.base.ordenes.delete('c1');
  Object.assign(t.base.ordenes.get('a2'), { items: [PAN(), PALOMA()], total: 12000, version: 6 });
  t.base.deshechosTabla.push({ id: 1, orden_id: 'c1', mesa_id: 3, tipo: 'completo', monto: 9000, items: [], hecho_por: 'mesero1@ejemplo.test', hecho_en: new Date().toISOString(), cierre_id: null });
  assert.equal(t.pos.cierreVista.n, 2, 'antes de confirmar, la tablet ve dos ventas');
  assert.equal(await t.pos.cerrarDia(), 'cambio');
  await asentar();
  assert.equal(t.base.cierres.size, 0);
  assert.equal(t.base.ordenes.has('a2'), true, 'a2 no se borra');
  assert.equal(t.pos.cierreCambio, true, 'la confirmación avisa que los números cambiaron');
  assert.deepEqual(plano(t.pos.cierreVista), { n: 1, total: 12000 }, 'y enseña los de la base: una venta, $12.000');
  assert.equal(t.pos.ordenes.some((o) => o.id === 'c1'), false, 'c1 no vuelve de la foto vieja: la base dice que ya no está');
  assert.equal(t.pos.totalHoy, 12000);
  // Firmando los números de la base sí cierra.
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.equal([...t.base.cierres.values()][0].total_ventas, 12000);
  assert.equal(t.base.ordenes.size, 0);
  assert.equal(t.pos.cierreCambio, false);
  assert.equal(t.pos.cierreResumen, null);
});

test('S1d una venta cerrada que otra tablet editó se rechaza (cambio), se relee y el segundo intento cierra con lo nuevo', async () => {
  const c1 = cerrada('c1', 3, [item('p', 7000)], 3);
  const t = montar({ mesas: [libre(3)], ordenes: [c1] });
  await listo(t);
  Object.assign(t.base.ordenes.get('c1'), { items: [item('p', 7000, 2)], total: 14000, version: 4 });   // otra tablet la editó; el eco no llegó
  assert.equal(await t.pos.cerrarDia(), 'cambio');
  await asentar();
  assert.equal(t.base.cierres.size, 0);
  assert.equal(t.pos.totalHoy, 14000, 'ahora la tablet ve lo que dice la base');
  assert.deepEqual(plano(t.pos.cierreVista), { n: 1, total: 14000 });
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.equal([...t.base.cierres.values()][0].total_ventas, 14000);
});

test('S1e hay una cuenta abierta que esta tablet no ve (eco perdido): la base rechaza el cierre, la tablet la trae y el aviso dice qué mesa', async () => {
  const a = cerrada('a', 3, [item('pa', 30000)], 2);
  const t = montar({ mesas: [libre(3), mesaBase(5)], ordenes: [a] });
  await listo(t);
  t.base.ordenes.set('z9', { ...ordenBase('z9', 5, [item('x', 4000)], 1), id: 'z9' });   // otro dispositivo abrió la mesa 5
  assert.equal(t.pos.ordenesAbiertas.length, 0);
  assert.equal(await t.pos.cerrarDia(), 'hay_abiertas');
  await asentar();
  assert.equal(t.base.cierres.size, 0);
  assert.equal(t.base.ordenes.has('a'), true, 'no se borró nada');
  assert.match(t.pos.aviso.texto, /No se cerró el día: hay cuentas abiertas \(Mesa 5\)/);
  assert.equal(t.pos.ordenesAbiertas.length, 1, 'la tablet ya la ve');
  assert.equal(t.pos.ordenesHoy.length, 1, 'y la venta de hoy sigue en la lista (no se perdió ni se archivó)');
});

test('S1g se perdió la respuesta de cerrar_dia_de (la base ya cerró): el reintento lleva el MISMO id, la base devuelve ese cierre sin duplicar y sin tocar la cuenta que se abrió después', async () => {
  const a = cerrada('a', 3, [item('pa', 30000)], 2);
  const t = montar({ mesas: [libre(3), libre(4)], ordenes: [a] });
  await listo(t);
  t.base.perderRespuesta = 'cerrar_dia_de';
  assert.equal(await t.pos.cerrarDia(), 'error');
  assert.equal(t.pos.cierres.length, 0, 'la tablet no sabe que cerró: no inventa un cierre');
  assert.equal(t.base.cierres.size, 1, 'pero la base sí');
  assert.match(t.pos.cierreError, /No se pudo confirmar el cierre/);
  assert.equal(t.pos.modalConfirmCierre, false, '(el modal lo abre la pantalla; aquí se llamó a mano)');
  const idPrimero = t.supabase.rpcs('cerrar_dia_de')[0].args.p_id;
  // Mientras tanto otro dispositivo abrió la mesa 4.
  t.base.ordenes.set('n1', ordenBase('n1', 4, [item('x', 4000)], 0));
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.equal(t.supabase.rpcs('cerrar_dia_de')[1].args.p_id, idPrimero, 'el reintento lleva el mismo id');
  assert.equal(t.base.cierres.size, 1, 'sigue siendo un solo cierre');
  assert.equal(t.base.ordenes.get('n1').estado, 'abierta', 'la cuenta nueva no se tocó (ni se rechazó el reintento por tenerla)');
  assert.equal(t.pos.cierres.length, 1);
  assert.equal(t.pos.cierres[0].sync, 'ok');
  assert.equal(t.pos.cierres[0].id, idPrimero);
  assert.equal(t.pos.cierres[0].total, 30000);
});

test('S1h si la base no tiene cerrar_dia (migración sin aplicar) el cierre sigue por el camino de siempre y no vuelve a probar', async () => {
  const a = cerrada('a', 3, [item('pa', 30000)], 2);
  const t = montar({ mesas: [libre(3)], ordenes: [a], olaC: false });
  await listo(t);
  assert.equal(await t.pos.cerrarDia(), 'legado');
  await hastaQue(() => t.pos.cierres[0]?.sync === 'ok' && !t.pos.cierres[0].purgar);
  assert.equal(t.base.cierres.size, 1);
  assert.equal(t.base.ordenes.size, 0, 'la purga de siempre');
  assert.equal(t.supabase.rpcs('cerrar_dia').length, 1, 'probó la RPC una vez');
  assert.equal(t.pos._sinCerrarDia, true);
  t.base.ordenes.set('b', cerrada('b', 3, [item('pb', 1000)], 1));
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(await t.pos.cerrarDia(), 'legado');
  await hastaQue(() => t.pos.cierres.length === 2 && t.pos.cierres[0].sync === 'ok' && !t.pos.cierres[0].purgar);
  assert.equal(t.supabase.rpcs('cerrar_dia').length, 1, 'y no vuelve a llamarla');
});

test('S1i la base dice no_autorizado (le quitaron el rol): no se cierra nada, no queda un cierre local y se pide revisar el rol', async () => {
  const a = cerrada('a', 3, [item('pa', 30000)], 2);
  const t = montar({ mesas: [libre(3)], ordenes: [a] });
  await listo(t);
  t.base.rol = 'mesero';   // la base ya no lo ve como admin (la tablet aún no se entera)
  assert.equal(await t.pos.cerrarDia(), 'sin_permiso');
  await asentar();
  assert.equal(t.base.cierres.size, 0);
  assert.equal(t.base.ordenes.has('a'), true);
  assert.equal(t.pos.cierres.length, 0, 'no hay cierre local: nada que dejar «Sin respaldo»');
  assert.match(t.pos.aviso.texto, /Solo el admin cierra el día/);
  assert.equal(t.pos.rol, 'mesero', 'y la tablet revalidó su rol');
});

// ═════════════════════════ S2. Cobrar sin red y que la base rechace el cobro (hallazgo 2) ═════════════════════════

test('S2a dos tablets: la otra agregó un postre; esta cobró sin red con 2 cervezas agregadas sin red: al volver la red NINGÚN ítem se pierde y el aviso dice que el cobro NO quedó registrado', async () => {
  const t = montar({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [PALOMA(), PAN()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 3));
  sinRed(t);
  t.pos.agregarProducto(CERVEZA); t.pos.agregarProducto(CERVEZA);
  await asentar();
  assert.equal(t.pos.colaDeltas.length, 2);
  // La otra tablet (con red) agrega un postre a la misma cuenta: version 1 → 2.
  const enBase = t.base.ordenes.get('o1');
  enBase.items.push({ id: 'postre', nombre: 'Postre', precio: 6000, qty: 1, nota: '' }); enBase.total += 6000; enBase.version = 2;
  t.pos.facturar();
  await asentar();
  assert.equal(t.pos.ordenes.find((o) => o.id === 'o1').estado, 'cerrada');
  // Con la fila cerrada sin subir, sus deltas NO se mandan antes (cambiarían la version y la base rechazaría el cobro por un cambio propio).
  conRed(t);
  await t.pos.flushDeltas();
  assert.equal(t.base.rpcs.length, 0, 'los deltas esperan a que su fila entre');
  assert.equal(t.pos.colaDeltas.length, 2);
  await t.pos._subirLoPendiente();
  await asentar(); await asentar(); await asentar();
  const b = t.base.ordenes.get('o1');
  assert.equal(b.estado, 'abierta', 'la base la rechazó: sigue abierta');
  assert.deepEqual(idsDe(b.items), ['palomax2', 'panx1', 'postrex1', 'cervezax2'], 'lo de la base MÁS lo que se agregó sin red: ninguno se perdió');
  const l = t.pos.ordenes.find((o) => o.id === 'o1');
  assert.equal(l.estado, 'abierta');
  assert.deepEqual(idsDe(l.items), ['palomax2', 'panx1', 'postrex1', 'cervezax2'], 'y la tablet ve lo mismo');
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(t.base.mesas.get(3).estado, 'ocupada');
  assert.match(t.pos.aviso.texto, /NO quedó registrado/, 'el aviso dice que el cobro hecho sin red no quedó');
  assert.doesNotMatch(t.pos.aviso.texto, /No se cobró nada|otra persona/, 'ni «no se cobró nada» ni culpa a otra persona');
  assert.match(t.pos.aviso.texto, /Mesa 3/);
});

test('S2b UNA sola tablet con la señal mala: un delta que la base aplicó pero cuya respuesta se perdió, más cervezas sin red y el cobro sin red: las cervezas NO desaparecen', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [PALOMA()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 3));
  t.base.perderRespuesta = 'aplicar_delta_orden';
  t.pos.agregarProducto({ id: 'pan', nombre: 'Pan', precio: 3000 });   // la base lo aplica (version 2), la tablet no se entera
  await asentar();
  t.pos.remoto = 'offline';
  t.pos.agregarProducto(CERVEZA); t.pos.agregarProducto(CERVEZA);
  await asentar();
  t.pos.facturar();
  await asentar();
  conRed(t);
  await t.pos._subirLoPendiente();
  await asentar(); await asentar(); await asentar();
  const b = t.base.ordenes.get('o1');
  const l = t.pos.ordenes.find((o) => o.id === 'o1');
  assert.equal(b.estado, 'abierta');
  assert.equal(b.items.find((i) => i.id === 'cerveza')?.qty, 2, 'las 2 cervezas llegaron a la base');
  assert.equal(l.items.find((i) => i.id === 'cerveza')?.qty, 2, 'y a la tablet');
  // (Antes de la ronda 5 esto era una limitación admitida: `aplicar_delta_orden` no era idempotente y el delta del pan, que la base ya había aplicado,
  //  se aplicaba de nuevo y la cuenta lo mostraba DOS veces. Con un id por delta, la base lo reconoce y no lo repite.)
  assert.equal(b.items.find((i) => i.id === 'pan')?.qty, 1, 'el pan que la base ya había aplicado se cuenta UNA vez');
  assert.match(t.pos.aviso.texto, /NO quedó registrado/);
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('S2c el caso sin conflicto sigue igual: cobrar sin red con ítems agregados sin red sube la venta entera UNA vez, sin duplicar, y sin aviso de «cuenta cambió»', async () => {
  const t = montar({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [PALOMA(), PAN()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 3));
  sinRed(t);
  t.pos.agregarProducto(CERVEZA); t.pos.agregarProducto(CERVEZA);
  await asentar();
  t.pos.facturar();
  await asentar();
  conRed(t);
  await t.pos._subirLoPendiente();
  await asentar(); await asentar();
  const b = t.base.ordenes.get('o1');
  assert.equal(b.estado, 'cerrada');
  assert.deepEqual(idsDe(b.items), ['palomax2', 'panx1', 'cervezax2'], 'una vez cada ítem');
  assert.equal(b.total, 28000);
  assert.equal(t.pos.colaDeltas.length, 0, 'los deltas sobran: la fila los traía');
  assert.equal(t.base.rpcs.length, 0, 'y no se mandó ninguno');
  assert.equal(t.pos.aviso, null);
  assert.equal(t.base.mesas.get(3).estado, 'libre');
});

test('S2d un delta de «Editar» una venta cerrada del turno (admin) NO se retiene: esa cerrada la base ya la tiene', async () => {
  const t = montar({ rol: 'admin', mesas: [libre(3)], ordenes: [cerrada('c1', 3, [PALOMA()], 2)] });
  await listo(t);
  t.pos._pendientes['ordenes:c1'] = true;   // como si algo suyo siguiera sin subir
  assert.equal(t.pos._cobradaSinSubir({ orden_id: 'c1', editaCerrada: true }), false);
  assert.equal(t.pos._cobradaSinSubir({ orden_id: 'c1' }), true);
  assert.equal(t.pos._cobradaSinSubir({ orden_id: 'no-esta' }), false);
});

// ═════════════════════════ S3. «Cobros deshechos hoy» no se pierde ═════════════════════════

test('S3a el admin abre el cierre, un mesero deshace un cobro completo y lo cobra por menos, el admin cierra: lo deshecho queda en ESE cierre y el aviso lo dice', async () => {
  const c1 = cerrada('c1', 3, [PALOMA(), { id: 'lomo', nombre: 'Lomo', precio: 48000, qty: 1, nota: '' }], 2, 60);
  const t = montar({ mesas: [libre(3)], ordenes: [c1] });
  await listo(t);
  t.pos.vista = 'cierre';
  await t.pos.cargarDeshechos();
  assert.equal(t.pos.deshechosHoy.length, 0, 'al entrar, nadie había deshecho nada');
  // Mientras el admin mira el cierre: el mesero deshace c1 (57000) y la vuelve a cobrar sin el lomo (9000). La base lo anota.
  t.base.deshechosTabla.push({ id: 1, orden_id: 'c1', mesa_id: 3, tipo: 'completo', monto: 57000, items: [], hecho_por: 'mesero1@resplandor.test', hecho_en: new Date().toISOString(), cierre_id: null });
  const enBase = t.base.ordenes.get('c1'); enBase.items = [PALOMA()]; enBase.total = 9000; enBase.version = 4;
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: { ...enBase }, old: { id: 'c1' } });   // el eco del nuevo cobro
  assert.equal(t.pos.totalHoy, 9000);
  t.pos.cerrarDia();
  await hastaQue(() => t.pos.cierres[0]?.sync === 'ok');
  await asentar(); await asentar();
  const cierreId = t.pos.cierres[0].id;
  assert.equal(t.base.deshechosTabla[0].cierre_id, cierreId, 'la base lo colgó de ese cierre, en la misma transacción');
  assert.equal(t.pos.deshechosHoy.length, 0, 'el turno nuevo empieza sin deshechos');
  assert.equal(t.pos.deshechosDeCierre(cierreId).length, 1, 'y el historial de ese cierre lo tiene');
  assert.equal(t.pos.deshechosDeCierreMonto(cierreId), 57000);
  assert.equal(t.pos.deshechosDeCierre(cierreId)[0].quien, 'mesero1@resplandor.test');
});

test('S3b el aviso al cerrar dice cuántos cobros se deshicieron en el turno y por cuánto; sin deshechos no hay aviso', async () => {
  const a = cerrada('a', 3, [item('pa', 30000)], 2);
  const t = montar({ mesas: [libre(3)], ordenes: [a] });
  await listo(t);
  t.base.deshechosTabla.push({ id: 1, orden_id: 'x1', mesa_id: 3, tipo: 'parcial', monto: 26000, items: [], hecho_por: 'mesero1@ejemplo.test', hecho_en: '2020-01-01T10:00:00Z', cierre_id: null });
  t.base.deshechosTabla.push({ id: 2, orden_id: 'x2', mesa_id: 4, tipo: 'abono', monto: 20000, items: [], hecho_por: 'camila@ejemplo.test', hecho_en: '2020-01-01T11:00:00Z', cierre_id: null });
  t.pos.cerrarDia();
  await hastaQue(() => t.pos.cierres[0]?.sync === 'ok');
  assert.match(t.pos.aviso.texto, /Día cerrado\. En este turno se deshicieron 2 cobros por \$\s?46\.000/);
  // Otro día, sin deshechos: ningún aviso.
  t.pos.cerrarAviso();
  t.base.ordenes.set('b', cerrada('b', 3, [item('pb', 1000)], 1));
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  t.pos.cerrarDia();
  await hastaQue(() => t.pos.cierres[0]?.sync === 'ok' && t.pos.cierres.length === 2);
  assert.equal(t.pos.aviso, null);
});

// ═════════════════════════ S4. La version solo viaja si la base tiene el guardia (hallazgo 4) ═════════════════════════

test('S4a POS de la ola C sobre la base de la ola B (sin guardia): el cierre de la cuenta NO manda version; la base no la escribe hacia atrás', async () => {
  const t = montar({ rol: 'admin', olaC: false, mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [PAN()], 1)] });
  await listo(t);
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 3));
  const b = t.base.ordenes.get('o1'); b.items.push({ id: 'te', nombre: 'Te', precio: 2000, qty: 1, nota: '' }); b.total = 5000; b.version = 6;   // otra tablet; el eco se perdió
  t.pos.facturar(); await asentar(); await asentar();
  const up = t.supabase.de('ordenes', 'upsert').find((c) => c.cuerpo.estado === 'cerrada');
  assert.ok(up, 'subió el cierre');
  assert.equal('version' in up.cuerpo, false, 'sin guardia en la base, no se manda version');
  assert.equal(t.base.ordenes.get('o1').version, 6, 'la base conserva su version');
});

test('S4b con la base de la ola C (con guardia) el cierre de la cuenta SÍ manda la version que se vio', async () => {
  const t = montar({ rol: 'admin', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [PAN()], 4)] });
  await listo(t);
  assert.equal(t.pos._baseConGuardia, true, 'el sondeo de columnas confirmó el guardia');
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 3));
  t.pos.facturar(); await asentar(); await asentar();
  const up = t.supabase.de('ordenes', 'upsert').find((c) => c.cuerpo.estado === 'cerrada');
  assert.equal(up.cuerpo.version, 4);
});

// ═════════════════════════ S5. Los fallos del deshacer dicen la verdad (hallazgo 5) ═════════════════════════

test('S5a dos tablets deshacen el mismo cobro completo: la segunda recibe «Ese cobro ya se había deshecho», no «un admin puede corregirlo»', async () => {
  const t = montar({ rol: 'mesero', mesas: [libre(3)], ordenes: [cerrada('c1', 3, [PALOMA()], 2)] });
  await listo(t);
  // La otra tablet ya lo reabrió: en la base c1 está abierta (version 3) y la mesa ocupada; esta tablet aún la ve cerrada.
  Object.assign(t.base.ordenes.get('c1'), { estado: 'abierta', cerrada_en: null, version: 3 }); t.base.mesas.get(3).estado = 'ocupada';
  assert.equal(await t.pos.devolverACuenta('c1'), false);
  assert.equal(t.pos.deshacerError, 'Ese cobro ya se había deshecho.');
  await asentar(); await asentar();
  assert.equal(t.pos.ordenes.find((o) => o.id === 'c1').estado, 'abierta', 'y se volvió a leer: la tablet ya la ve abierta');
  assert.equal(t.base.deshechosTabla.length, 0, 'la segunda no deshizo nada');
});

test('S5b mesa_ocupada tiene su texto (no cae en «sin conexión»)', () => {
  const t = montar({});
  assert.match(t.pos._textoErrorDeshacer('mesa_ocupada'), /se ocupó justo ahora/);
  assert.match(t.pos._textoErrorDeshacer('ya_reabierta'), /ya se había deshecho/);
  assert.doesNotMatch(t.pos._textoErrorDeshacer('mesa_ocupada'), /conexión/);
});
