// Ola C, ronda 5a («simplificar»): los tres hallazgos de la ronda 4 que nacían del paso del POS viejo al nuevo, resueltos QUITANDO máquina en vez de agregar
// recuperación. La lógica del POS (pos.html, su <script> REAL en un `vm`) contra la base falsa de _pos-vm.mjs, que modela
// supabase/migrations/20261002180000_deshacer_cobro.sql con lo que trae esta ronda: RS005, `reabrir_venta_de_cierre` y `en_cierre` de cerrar_dia.
//
//   R5a-1  sin descartes silenciosos: cobrar una cuenta cuyo id está archivado en un cierre ya no se descarta en silencio (RS005): el POS lo muestra, deja la
//          cuenta abierta y la salida limpia es «Reabrir» desde el historial, que la saca del cierre en una transacción (hallazgo 1 de la ronda 4, S2 y S3)
//   R5a-2  reabrir una venta de un cierre pasado exige conexión y es atómico: una sola RPC, ningún upsert ni edición de cierre desde el POS
//   R5a-3  un cierre «Sin respaldo» de la versión anterior NO se recupera solo: el admin ve una hoja (mesa, hora, monto y si la base ya la tiene) y elige
//          «Subir las que faltan» o «Descartar este cierre local»; el mesero no la ve; nada se purga a partir de él (hallazgos 2 y 3 de la ronda 4, S1, S4 y S5)
//
// Cada prueba es la reproducción de r5.mjs (S1 a S5) o de e1-archivada-abierta.sql, hecha contra el modelo: con el POS y la base de 9ddce8f falla, con este pasa.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asentar, crearBaseFalsa, crearPos, hastaQue, item, mesaBase, ordenBase, plano,
} from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };

function montar({ rol = 'admin', mesas = [mesaBase(3)], ordenes = [], cierres = [], olaC = true, almacen, deshechos = [] } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, cierres, olaC });
  for (const d of deshechos) base.deshechosTabla.push({ id: base.deshechosTabla.length + 1, orden_id: d, mesa_id: 1, tipo: 'completo', monto: 1000, items: [], hecho_por: 'otro@ejemplo.test', hecho_en: new Date().toISOString(), cierre_id: null });
  const original = base.responder;
  base.perderRespuesta = null;                  // nombre de una RPC cuya respuesta se pierde DESPUÉS de aplicarse
  base.fallarLecturaDe = null;                  // tabla cuya PRÓXIMA lectura responde 504 (una vez)
  base.responder = async (c) => {
    if (base.fallarLecturaDe && c.tipo === 'from' && c.op === 'select' && c.tabla === base.fallarLecturaDe) {
      if (!base.fallarLecturaSiempre) base.fallarLecturaDe = null;
      return { data: null, error: { code: '504', message: 'upstream timeout' } };
    }
    const r = await original(c);
    if (base.perderRespuesta && c.tipo === 'rpc' && c.nombre === base.perderRespuesta) { base.perderRespuesta = null; return { data: null, error: { message: 'TypeError: Failed to fetch' } }; }
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
const JUGO = () => ({ id: 'jugo', nombre: 'Jugo', precio: 3000, qty: 1, nota: '' });
const HAMBURGUESA = { id: 'hamb', nombre: 'Hamburguesa', precio: 30000 };
const libre = (id) => mesaBase(id, { estado: 'libre' });
const cerrada = (id, mesa, items, version = 2, minutosAtras = 30) => ({ ...ordenBase(id, mesa, items, version, 'cerrada'), cerrada_en: new Date(Date.now() - minutosAtras * 60000).toISOString() });
const mesaDe = (t, id) => t.pos.mesas.find((m) => m.id === id);
const ordenLocalDe = (t, id) => t.pos.ordenes.find((o) => o.id === id);
/** Una venta tal como la guarda un cierre (camelCase, como la arma el POS y cerrar_dia). */
const ventaDeCierre = (id, mesaId, items, extra = {}) => ({ id, mesaId, estado: 'cerrada', items, total: items.reduce((s, i) => s + i.precio * i.qty, 0), abiertaEn: '2026-09-30T18:00:00Z', cerradaEn: '2026-09-30T19:00:00Z', version: 2, ...extra });
const filaDeCierre = (id, ventas, extra = {}) => ({ id, fecha: new Date(Date.now() - 86400000).toISOString(), total_ventas: ventas.reduce((s, v) => s + v.total, 0), total_ordenes: ventas.length, transacciones: ventas, ...extra });
/** Un cierre «Sin respaldo» como lo dejaba el POS de antes en localStorage: trae `purgar` y su `sync` nunca llegó a 'ok'. */
const cierreViejo = (id, ventas, extra = {}) => ({ id, fecha: new Date().toISOString(), total: ventas.reduce((s, v) => s + v.total, 0), sync: 'error', purgar: ventas.map((v) => v.id), ordenes: ventas, ...extra });
const llamadasQueEscriben = (t) => t.supabase.llamadas.filter((c) => (c.tipo === 'from' && c.op !== 'select') || (c.tipo === 'rpc' && !['mi_rol', 'solicitar_acceso', 'vista_vacia'].includes(c.nombre)));

// ═════════════════════════ R5a-1. Sin descartes silenciosos (hallazgo 1) ═════════════════════════

test('R5a-1a S2: la cuenta de la mesa 3 está ABIERTA en la base con su id dentro de un cierre; al cobrarla la base la rechaza (RS005): el POS avisa, no deja nada pendiente y la cuenta sigue abierta y la mesa ocupada', async () => {
  const k = filaDeCierre('k-viejo', [ventaDeCierre('o3', 3, [PALOMA()], { version: 2 })]);
  const t = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  assert.equal(t.pos.ordenActiva.id, 'o3');
  t.pos.facturar();
  await hastaQue(() => t.pos.aviso && /ya estaba en un cierre/.test(t.pos.aviso.texto));
  await asentar();
  assert.match(t.pos.aviso.texto, /Esta cuenta ya estaba en un cierre del día \(Mesa 3\): no se cobró y sigue abierta/);
  assert.match(t.pos.aviso.texto, /Revísala con el admin/);
  assert.match(t.pos.aviso.texto, /Reabrir/, 'al admin le dice cómo dejarla cobrable');
  assert.equal(t.base.ordenes.get('o3').estado, 'abierta', 'la base no tocó la cuenta: ni la cerró ni la descartó en silencio');
  assert.equal(ordenLocalDe(t, 'o3').estado, 'abierta', 'y aquí tampoco quedó «cobrada»');
  assert.equal(mesaDe(t, 3).estado, 'ocupada', 'la mesa sigue ocupada en la tablet');
  assert.equal(t.base.mesas.get(3).estado, 'ocupada', 'y en la base (el POS volvió a marcarla ocupada)');
  assert.equal(t.pos.cambiosSinSubir, 0, 'nada queda «pendiente» reintentándose para siempre');
  assert.equal(t.pos.ultimoCobro, null, 'y no hay un «Cobrado · Deshacer» de un cobro que no ocurrió');
  assert.equal(t.pos.vista, 'orden', 'la pantalla vuelve a la cuenta (no se queda en un ticket falso)');
});

test('R5a-1b S2: el POS nuevo ya no es mudo ante una cuenta abierta que está en un cierre: la ventana de «Cerrar día» la señala y dice dónde se resuelve; y si la base responde hay_abiertas con `en_cierre`, el aviso lo repite', async () => {
  const k = filaDeCierre('k-viejo', [ventaDeCierre('o3', 3, [PALOMA()])]);
  const t = montar({ mesas: [mesaBase(3), libre(1)], ordenes: [ordenBase('o3', 3, [PALOMA()], 3), cerrada('c1', 1, [PAN()], 2, 10)], cierres: [k] });
  await listo(t);
  assert.deepEqual(plano(t.pos.abiertasEnCierre), [3], 'la tablet sabe cuáles de las abiertas ya están en un cierre (lo trae el historial)');
  assert.equal(await t.pos.cerrarDia(), 'hay_abiertas');
  assert.equal([...t.base.cierres.keys()].join(), 'k-viejo', 'no se guardó ningún cierre nuevo');
  // lo que dice la base cuando la tablet no veía la cuenta abierta
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'cerrar_dia', args: { p_id: 'K-x', p_esperado: { n: 1, total: 3000, ids: ['c1'] } } });
  assert.equal(r.data.codigo, 'hay_abiertas'); assert.deepEqual(r.data.en_cierre, [3]);
  await t.pos._cierreNoSeHizo(r.data);
  assert.match(t.pos.aviso.texto, /hay cuentas abiertas \(Mesa 3\)/);
  assert.match(t.pos.aviso.texto, /Mesa 3 ya estaba en un cierre del día: ábrela en Historial → ese cierre → Editar → Reabrir/);
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../pos.html', import.meta.url), 'utf8');
  assert.match(html, /\$store\.pos\.abiertasEnCierre\.length > 0[\s\S]{0,900}Historial → ese cierre → Editar → Reabrir/, 'y la ventana de confirmación del cierre lo dice');
});

test('R5a-1c S2: la salida limpia es «Reabrir» desde el historial: la base saca la cuenta del cierre SIN tocar su cuenta, y entonces SÍ se cobra, SÍ se cierra el día y cuenta UNA vez', async () => {
  const k = filaDeCierre('k-viejo', [ventaDeCierre('o3', 3, [PALOMA()], { version: 2 }), ventaDeCierre('c1', 1, [PAN()])]);
  const t = montar({ mesas: [mesaBase(3), libre(1)], ordenes: [ordenBase('o3', 3, [PALOMA()], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.facturar();
  await hastaQue(() => t.pos.aviso && /ya estaba en un cierre/.test(t.pos.aviso.texto));
  await asentar();
  // el admin abre el cierre en el historial y toca Reabrir sobre esa venta
  const cierre = t.pos.cierres.find((c) => c.id === 'k-viejo');
  const venta = cierre.ordenes.find((o) => o.id === 'o3');
  t.pos.abrirEditorTransaccion(venta, cierre);
  t.pos.solicitarReapertura(t.pos.transaccionEditando);
  await hastaQue(() => t.base.reaperturas === 1);
  await asentar();
  assert.equal(t.supabase.rpcs('reabrir_venta_de_cierre').length, 1, 'UNA sola llamada a la base');
  assert.equal(t.supabase.rpcs('reabrir_venta_de_cierre')[0].args.p_mesa_id, 3, 'sin pedir otra mesa: la cuenta ya estaba abierta en la 3');
  assert.equal(t.base.ordenes.get('o3').estado, 'abierta');
  assert.equal(t.base.ordenes.get('o3').version, 3, 'la cuenta quedó como estaba (se adoptó, no se reescribió)');
  assert.equal(t.base.cierres.get('k-viejo').total_ventas, 3000, 'el cierre perdió esa venta y recalculó su total (solo queda c1)');
  assert.deepEqual(t.base.cierres.get('k-viejo').transacciones.map((x) => x.id), ['c1']);
  assert.equal(t.pos.vista, 'orden');
  assert.match(t.pos.ordenReabiertaAviso, /ya estaba abierta con ese número: se sacó del cierre/);
  // ahora sí se cobra
  t.pos.facturar();
  await asentar();
  assert.equal(t.base.ordenes.get('o3').estado, 'cerrada', 'el cobro de la cuenta entra');
  assert.equal(t.pos.cambiosSinSubir, 0);
  t.pos.avisar('');
  assert.equal(await t.pos.cerrarDia(), 'ok', 'y cerrar_dia deja de estar trabado');
  const nuevo = [...t.base.cierres.values()].find((c) => c.id !== 'k-viejo');
  assert.equal(nuevo.total_ventas, 9000);
  const apariciones = [...t.base.cierres.values()].flatMap((c) => c.transacciones).filter((x) => x.id === 'o3').length;
  assert.equal(apariciones, 1, 'o3 está en UN solo cierre');
});

test('R5a-1d el mesero que se topa con ese rechazo ve el mismo aviso, sin la instrucción de admin: «Revísala con el admin»', async () => {
  const k = filaDeCierre('k-viejo', [ventaDeCierre('o3', 3, [PALOMA()])]);
  const t = montar({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.facturar();
  await hastaQue(() => t.pos.aviso && /ya estaba en un cierre/.test(t.pos.aviso.texto));
  assert.match(t.pos.aviso.texto, /Esta cuenta ya estaba en un cierre del día \(Mesa 3\)/);
  assert.match(t.pos.aviso.texto, /Revísala con el admin\./);
  assert.doesNotMatch(t.pos.aviso.texto, /Historial/, 'el mesero no puede reabrir: no se le manda al historial');
  assert.equal(ordenLocalDe(t, 'o3').estado, 'abierta');
});

test('R5a-1e Z: una venta que otro dispositivo archivó (y purgó) mientras esta caja reintentaba su cobro: la base la rechaza con RS005, la caja la suelta CON aviso y no vuelve a contarla', async () => {
  const t = montar({ mesas: [mesaBase(2)], ordenes: [ordenBase('o2', 2, [item('be7', 35000, 2)], 1)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 2));
  t.base.perderRespuesta = null;
  // la caja cobra: la base lo guarda pero la respuesta se pierde (se queda «pendiente»)
  const original = t.base.responder;
  let perdida = false;
  t.base.responder = async (c) => { const r = await original(c); if (!perdida && c.tipo === 'from' && c.op === 'upsert' && c.tabla === 'ordenes' && [].concat(c.cuerpo).some((f) => f.estado === 'cerrada')) { perdida = true; return { data: null, error: { message: 'TypeError: Failed to fetch' } }; } return r; };
  t.pos.facturar();
  await asentar();
  assert.equal(t.base.ordenes.get('o2').estado, 'cerrada');
  assert.equal(t.pos._pendientes['ordenes:o2'], true, 'la caja sigue con el cobro pendiente');
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'cerrar_dia', args: { p_id: 'K-otro', p_esperado: { n: 1, total: 70000, ids: ['o2'] } } });
  assert.equal(r.data.ok, true, 'otro dispositivo admin cerró el día con esa venta');
  await t.pos.sincronizarSupabase();
  await hastaQue(() => t.pos.aviso && /ya estaba en un cierre/.test(t.pos.aviso.texto));
  await asentar();
  assert.match(t.pos.aviso.texto, /Esta venta ya estaba en un cierre del día \(Mesa 2\): no se vuelve a cobrar/, 'se avisa (antes se soltaba en silencio)');
  assert.equal(t.base.ordenes.has('o2'), false, 'la base no la dejó resucitar');
  assert.equal(ordenLocalDe(t, 'o2'), undefined, 'y la caja la soltó');
  assert.equal(t.pos.cambiosSinSubir, 0);
  assert.equal([...t.base.cierres.values()].flatMap((c) => c.transacciones).filter((x) => x.id === 'o2').length, 1, 'aparece en UN solo cierre');
});

test('R5a-1f si el POS no puede leer la base justo después del rechazo, supone la cuenta abierta (lo prudente) y la próxima lectura la corrige', async () => {
  const k = filaDeCierre('k-viejo', [ventaDeCierre('o3', 3, [PALOMA()])]);
  const t = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  t.base.fallarLecturaDe = 'ordenes'; t.base.fallarLecturaSiempre = true;   // la base no contesta NINGUNA lectura de órdenes
  t.pos.facturar();
  await hastaQue(() => t.pos.aviso && /ya estaba en un cierre/.test(t.pos.aviso.texto));
  await asentar();
  assert.equal(ordenLocalDe(t, 'o3').estado, 'abierta', 'sin saber, la cuenta queda abierta: no se pierde nada');
  assert.equal(t.pos.cambiosSinSubir, 0);
  assert.match(t.pos.aviso.texto, /no se cobró y sigue abierta/);
  // vuelve la lectura: la próxima resincronización deja la cuenta como la tiene la base
  t.base.fallarLecturaDe = null; t.base.fallarLecturaSiempre = false;
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(ordenLocalDe(t, 'o3').estado, 'abierta');
  assert.equal(t.base.ordenes.get('o3').estado, 'abierta');
});

test('R5a-1g la cuenta se cobró SIN red con algo agregado sin red y, al volver la red, la base la rechaza (RS005): lo agregado sin red NO se pierde, se aplica a la cuenta que sigue abierta', async () => {
  const k = filaDeCierre('k-viejo', [ventaDeCierre('o3', 3, [PALOMA()])]);
  const t = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  sinRed(t);
  t.pos._agregarAlPedido(HAMBURGUESA, '');          // un cambio sin red: queda en la cola de deltas
  t.pos.facturar();                                  // y cobra sin red
  await asentar();
  assert.equal(t.pos.colaDeltas.length, 1, 'el delta espera a que entre la fila cerrada');
  assert.equal(t.pos._pendientes['ordenes:o3'], true);
  conRed(t);
  await t.pos._subirLoPendiente();
  await hastaQue(() => t.pos.aviso && /ya estaba en un cierre/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar();
  const base = t.base.ordenes.get('o3');
  assert.equal(base.estado, 'abierta', 'la cuenta sigue abierta en la base');
  assert.deepEqual(base.items.map((i) => `${i.id}x${i.qty}`).sort(), ['hambx1', 'palomax2'], 'con lo de antes Y lo agregado sin red: nada se perdió');
  assert.equal(base.total, 9000 + 30000);
  assert.equal(ordenLocalDe(t, 'o3').estado, 'abierta');
  assert.equal(ordenLocalDe(t, 'o3').items.length, 2, 'la tablet muestra lo mismo');
  assert.match(t.pos.aviso.texto, /no se cobró y sigue abierta/);
});

test('R5a-1h con red, la cuenta se cobra con un delta todavía en la cola y la base rechaza (RS005): el delta se aplica a la cuenta que sigue abierta y sale de la cola (no queda para siempre)', async () => {
  const k = filaDeCierre('k-viejo', [ventaDeCierre('o3', 3, [PALOMA()])]);
  const t = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o3', 3, [PALOMA()], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  // un delta que quedó en la cola (de un mal momento de la red) y que la fila cerrada llevaría en `deltas_ids`
  t.pos.ordenActiva.items.push({ id: 'hamb', nombre: 'Hamburguesa', precio: 30000, qty: 1, nota: '' });
  t.pos.colaDeltas.push({ id: 'd-1', orden_id: 'o3', item_id: 'hamb', nombre: 'Hamburguesa', precio: 30000, nota: '', delta: 1 });
  t.pos.facturar();
  await hastaQue(() => t.pos.aviso && /ya estaba en un cierre/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.colaDeltas.length === 0);
  await asentar();
  const base = t.base.ordenes.get('o3');
  assert.equal(base.estado, 'abierta');
  assert.deepEqual(base.items.map((i) => `${i.id}x${i.qty}`).sort(), ['hambx1', 'palomax2'], 'el delta se aplicó una vez a la cuenta que sigue abierta');
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(t.pos.cambiosSinSubir, 0);
});

// ═════════════════════════ R5a-2. Reabrir con red y atómico (hallazgo 1, variante S3) ═════════════════════════

const montarHistorial = (extra = {}) => {
  const k = filaDeCierre('k1', [ventaDeCierre('v', 2, [item('pf1', 52000)], { version: 4 }), ventaDeCierre('w', 3, [PAN()])]);
  return montar({ mesas: [libre(2), libre(3)], ordenes: [], cierres: [k], ...extra });
};
const abrirReapertura = (t, ventaId, cierreId = 'k1') => {
  const cierre = t.pos.cierres.find((c) => c.id === cierreId);
  const venta = cierre.ordenes.find((o) => o.id === ventaId);
  t.pos.abrirEditorTransaccion(venta, cierre);
  t.pos.solicitarReapertura(t.pos.transaccionEditando);
};

test('R5a-2a con red, reabrir una venta de un cierre es UNA llamada a la base: la saca del cierre y deja la cuenta abierta; el POS no sube ninguna orden ni edita el cierre por su cuenta', async () => {
  const t = montarHistorial();
  await listo(t);
  const antes = t.supabase.llamadas.length;
  abrirReapertura(t, 'v');
  await hastaQue(() => t.pos.vista === 'orden');
  await asentar();
  const nuevas = t.supabase.llamadas.slice(antes);
  assert.deepEqual(nuevas.filter((c) => c.tipo === 'rpc').map((c) => c.nombre), ['reabrir_venta_de_cierre'], 'una sola RPC');
  assert.deepEqual(nuevas.filter((c) => c.tipo === 'from' && c.op !== 'select').map((c) => `${c.op} ${c.tabla}`), [], 'ningún upsert de la orden, de la mesa ni del cierre desde el POS');
  const o = t.base.ordenes.get('v');
  assert.equal(o.estado, 'abierta'); assert.equal(o.mesa_id, 2); assert.equal(o.total, 52000); assert.equal(t.base.mesas.get(2).estado, 'ocupada');
  assert.deepEqual(t.base.cierres.get('k1').transacciones.map((x) => x.id), ['w'], 'y en la MISMA llamada salió del cierre');
  assert.equal(t.base.cierres.get('k1').total_ventas, 3000);
  const local = t.pos.cierres.find((c) => c.id === 'k1');
  assert.deepEqual(local.ordenes.map((x) => x.id), ['w'], 'el historial local quedó como el de la base');
  assert.equal(local.total, 3000); assert.equal(local.sync, 'ok');
  assert.equal(t.pos.ordenActiva.id, 'v'); assert.equal(t.pos.mesaActiva.id, 2); assert.equal(t.pos.vista, 'orden');
  assert.equal(mesaDe(t, 2).estado, 'ocupada');
  assert.equal(t.pos.cambiosSinSubir, 0, 'no queda nada pendiente');
  assert.equal(t.pos.avisos?.length ?? 0, 0);
});

test('R5a-2b S3: SIN red no se puede reabrir una venta de un cierre: el botón se apaga con su razón, y ni solicitarReapertura ni reabrirOrden hacen nada (la venta sigue en su cierre)', async () => {
  const t = montarHistorial();
  await listo(t);
  sinRed(t);
  assert.match(t.pos.razonSinReaperturaDeCierre, /Sin conexión: reabrir una venta de un cierre pasado necesita la base/);
  const cierre = t.pos.cierres.find((c) => c.id === 'k1');
  const venta = cierre.ordenes.find((o) => o.id === 'v');
  t.pos.abrirEditorTransaccion(venta, cierre);
  assert.equal(t.pos.modalEditarTransaccion, true);
  const antes = t.supabase.llamadas.length;
  t.pos.solicitarReapertura(t.pos.transaccionEditando);
  await asentar();
  assert.equal(t.pos.modalEditarTransaccion, true, 'la ventana sigue abierta con su explicación');
  assert.match(t.pos.aviso.texto, /Sin conexión: reabrir una venta de un cierre pasado/);
  await t.pos.reabrirOrden(venta, 2);       // aunque alguien llame al store a mano
  await asentar();
  assert.equal(t.supabase.llamadas.length, antes, 'ni una llamada a la base');
  assert.equal(t.pos.ordenes.some((o) => o.id === 'v'), false, 'no apareció ninguna cuenta abierta');
  assert.equal(cierre.ordenes.some((o) => o.id === 'v'), true, 'la venta sigue en su cierre');
  assert.equal(mesaDe(t, 2).estado, 'libre');
  assert.equal(t.pos.cambiosSinSubir, 0, 'y no deja nada para subir después (nada de la dos mitades de antes)');
  // vuelve la red: ya se puede
  conRed(t);
  assert.equal(t.pos.razonSinReaperturaDeCierre, '');
});

test('R5a-2c «Conectando…» tampoco: sin saber si hay base no se reabre', async () => {
  const t = montarHistorial();
  await listo(t);
  t.pos.remoto = 'conectando';
  assert.match(t.pos.razonSinReaperturaDeCierre, /Conectando/);
});

test('R5a-2d la mesa que se eligió la ocupó otro dispositivo: la base responde mesa_ocupada SIN cambiar nada, el POS lo dice y vuelve a pedir otra mesa', async () => {
  const t = montarHistorial({ mesas: [mesaBase(2), libre(3)], ordenes: [ordenBase('x', 2, [PAN()], 1)] });
  await listo(t);
  // la tablet cree que la mesa 2 está libre (todavía no recibió el eco)
  mesaDe(t, 2).estado = 'libre';
  abrirReapertura(t, 'v');
  await hastaQue(() => t.pos.modalReabrir === true);
  await asentar();
  assert.match(t.pos.aviso.texto, /No se pudo reabrir en la mesa 2: otro dispositivo la ocupó primero\. Elige otra mesa\./);
  assert.equal(t.pos.modalReabrir, true, 'vuelve el selector de mesa');
  assert.equal(t.pos.transaccionCierre?.id, 'k1', 'y sigue sabiendo de qué cierre viene');
  assert.deepEqual(t.base.cierres.get('k1').transacciones.map((x) => x.id), ['v', 'w'], 'el cierre no cambió (todo o nada)');
  assert.equal(t.base.ordenes.has('v'), false);
  // elige la mesa 3
  await t.pos.reabrirOrden(t.pos.ordenParaReabrir, 3);
  await asentar();
  assert.equal(t.base.ordenes.get('v').mesa_id, 3);
  assert.deepEqual(t.base.cierres.get('k1').transacciones.map((x) => x.id), ['w']);
  assert.match(t.pos.ordenReabiertaAviso, /reasignada de la mesa 2 a la mesa 3/);
});

test('R5a-2e la respuesta de la RPC se pierde pero la base SÍ reabrió: el POS lo dice sin inventar nada y, al reintentar, reconoce la cuenta que ya está abierta (no_esta_en_cierre) y la abre', async () => {
  const t = montarHistorial();
  await listo(t);
  t.base.perderRespuesta = 'reabrir_venta_de_cierre';
  abrirReapertura(t, 'v');
  await hastaQue(() => t.pos.aviso && /No se pudo confirmar/.test(t.pos.aviso.texto));
  await asentar();
  assert.match(t.pos.aviso.texto, /No se pudo confirmar con la base\. Si la venta se reabrió ya aparece en su mesa/);
  assert.equal(t.base.ordenes.get('v').estado, 'abierta', 'la base sí lo hizo');
  assert.equal(t.pos.vista !== 'orden', true, 'la pantalla no se movió sin saber');
  // el admin vuelve a tocar Reabrir sobre la misma venta (la copia local del cierre se actualizó con la lectura): la base ya no la tiene en el cierre
  const cierre = t.pos.cierres.find((c) => c.id === 'k1');
  const venta = { ...ventaDeCierre('v', 2, [item('pf1', 52000)]) };
  t.pos.abrirEditorTransaccion(venta, cierre);
  t.pos.transaccionCierre = cierre;
  t.pos.reabrirOrden(venta, 2);
  await hastaQue(() => t.pos.vista === 'orden');
  assert.equal(t.pos.ordenActiva.id, 'v');
  assert.match(t.pos.aviso.texto, /Esa venta ya se había reabierto/);
  assert.equal(t.base.reaperturas, 1, 'la base reabrió UNA vez');
});

test('R5a-2f un abono no se reabre como cuenta, ni por el store: la base lo niega (es_abono) y no cambia nada', async () => {
  const abono = ventaDeCierre('ab', 3, [{ id: 'abono_k9', nombre: 'Abono', precio: 15000, qty: 1, nota: 'efectivo' }]);
  const k = filaDeCierre('k1', [abono]);
  const t = montar({ mesas: [libre(3)], ordenes: [], cierres: [k] });
  await listo(t);
  // directo a la base: un cliente raro que lo intente
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'reabrir_venta_de_cierre', args: { p_cierre_id: 'k1', p_orden_id: 'ab', p_mesa_id: 3 } });
  assert.equal(r.data.codigo, 'es_abono');
  assert.deepEqual(t.base.cierres.get('k1').transacciones.map((x) => x.id), ['ab']);
  assert.equal(t.base.ordenes.has('ab'), false);
});

test('R5a-2g un mesero no reabre ventas de un cierre: la base responde no_autorizado y el POS lo dice', async () => {
  const t = montarHistorial({ rol: 'mesero' });
  await listo(t);
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'reabrir_venta_de_cierre', args: { p_cierre_id: 'k1', p_orden_id: 'v', p_mesa_id: 2 } });
  assert.equal(r.data.codigo, 'no_autorizado');
  assert.equal(t.pos.puede('editar_cerradas'), false, 'y la pantalla ni le ofrece el botón');
});

test('R5a-2h reabrir una venta del TURNO (no de un cierre) sigue como siempre, también sin red: no necesita la base porque no sale de ningún cierre', async () => {
  const t = montar({ mesas: [libre(1)], ordenes: [cerrada('c1', 1, [PAN()], 2, 10)] });
  await listo(t);
  sinRed(t);
  assert.equal(t.pos.razonSinReaperturaDeCierre !== '', true, 'la razón existe, pero solo se exige para las de un cierre');
  const orden = ordenLocalDe(t, 'c1');
  t.pos.abrirEditorTransaccion(orden, null);
  t.pos.solicitarReapertura(t.pos.transaccionEditando);
  await asentar();
  assert.equal(ordenLocalDe(t, 'c1').estado, 'abierta');
  assert.equal(t.pos.vista, 'orden');
  assert.equal(t.supabase.rpcs('reabrir_venta_de_cierre').length, 0, 'por el camino de antes: nada de la RPC nueva');
  assert.equal(t.pos._pendientes['ordenes:c1'], true, 'sube cuando vuelva la red');
});

test('R5a-2i la hoja de «Editar transacción» apaga «Reabrir en mesa» sin red y lo explica (el HTML depende de la misma razón que el store)', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../pos.html', import.meta.url), 'utf8');
  assert.match(html, /:disabled="!!\(\$store\.pos\.transaccionCierre && \$store\.pos\.razonSinReaperturaDeCierre\)"/, 'el botón se apaga con la misma razón');
  assert.match(html, /id="reabrir-razon"[\s\S]{0,200}razonSinReaperturaDeCierre/, 'y la dice');
});

test('R5a-2j un cierre que esta tablet armó y todavía no llegó a la base (`sync` distinto de ok) no se puede reabrir desde la base: dice que espere a que suba y no llama a nada', async () => {
  const t = montarHistorial();
  await listo(t);
  const propio = { id: 'k-local', fecha: new Date().toISOString(), total: 3000, sync: 'error', origen: 'pos-nuevo', purgar: ['z'], ordenes: [ventaDeCierre('z', 2, [PAN()])] };
  t.pos.cierres.unshift(propio);
  t.pos.abrirEditorTransaccion(propio.ordenes[0], propio);
  assert.match(t.pos.razonSinReaperturaDeCierre, /Este cierre todavía no llegó a la base: espera a que suba/);
  const antes = t.supabase.llamadas.length;
  t.pos.solicitarReapertura(t.pos.transaccionEditando);
  await asentar();
  assert.equal(t.supabase.llamadas.length, antes);
  assert.equal(t.pos.modalEditarTransaccion, true, 'la ventana sigue abierta con su explicación');
});

test('R5a-2k un rezago (la venta sigue CERRADA en `ordenes` aunque su cierre ya la archivó: la purga de un POS viejo no terminó) se reabre: la base reabre esa misma fila, la saca del cierre y la purga pendiente ya no la toca', async () => {
  const v = ventaDeCierre('v', 2, [item('pf1', 52000)], { version: 4 });
  const k = filaDeCierre('k1', [v, ventaDeCierre('w', 3, [PAN()])]);
  const t = montar({ mesas: [libre(2), libre(3)], ordenes: [cerrada('v', 2, [item('pf1', 52000)], 4, 600), cerrada('w', 3, [PAN()], 2, 600)], cierres: [k] });
  await listo(t);
  const cierre = t.pos.cierres.find((c) => c.id === 'k1');
  cierre.purgar = ['v', 'w'];
  abrirReapertura(t, 'v');
  await hastaQue(() => t.pos.vista === 'orden');
  await asentar();
  assert.equal(t.base.ordenes.get('v').estado, 'abierta');
  assert.equal(t.base.ordenes.get('v').version, 5);
  assert.deepEqual(t.base.cierres.get('k1').transacciones.map((x) => x.id), ['w']);
  assert.deepEqual(plano(cierre.purgar), ['w'], 'la purga pendiente ya no la lleva: está viva');
  assert.equal(t.pos.ordenActiva.id, 'v');
});

// ═════════════════════════ R5a-3. Cierres «Sin respaldo» de la versión anterior: los decide el admin ═════════════════════════

/** El escenario completo: cinco ventas del cierre viejo, una en cada situación posible respecto de la base. */
function escenarioViejo({ rol = 'admin', extraBase = {} } = {}) {
  const vFalta = cerrada('falta', 5, [PALOMA()], 0, 20);
  const vYa = cerrada('ya', 2, [PAN()], 3, 40);
  const vArch = cerrada('arch', 3, [PAN()], 3, 50);
  const vAb = cerrada('ab', 4, [PALOMA()], 1, 20);
  const vDesh = cerrada('desh', 1, [JUGO()], 1, 25);
  const viejo = cierreViejo('viejo', [vFalta, vYa, vArch, vAb, vDesh].map((o) => ventaDeCierre(o.id, o.mesa_id, o.items, { cerradaEn: o.cerrada_en, version: o.version })));
  const almacen = new Map([['pos_cierres', JSON.stringify([viejo])]]);
  const t = montar({
    rol,
    mesas: [libre(1), libre(2), libre(3), mesaBase(4), libre(5)],
    ordenes: [vYa, ordenBase('ab', 4, [PALOMA()], 2)],
    cierres: [filaDeCierre('k-otro', [ventaDeCierre('arch', 3, [PAN()])])],
    deshechos: ['desh'],
    almacen,
    ...extraBase,
  });
  return { t, viejo, almacen };
}

test('R5a-3a al arrancar, el cierre viejo SALE de la lista de cierres y queda aparte; al admin se le abre la hoja con «N ventas, $X» y la lista (mesa, hora, monto y si la base ya la tiene); NADA se sube ni se borra', async () => {
  const { t, almacen } = escenarioViejo();
  t.pos.cargarCachéLocal();
  assert.equal(t.pos.cierres.length, 0, 'ya no está entre los cierres: nada lo sube con un upsert');
  assert.equal(t.pos.cierresViejos.length, 1);
  assert.equal(JSON.parse(almacen.get('pos_cierres_viejos')).length, 1, 'guardado aparte en el almacenamiento');
  assert.deepEqual(JSON.parse(almacen.get('pos_cierres')), [], 'y fuera de la lista');
  await listo(t);
  await hastaQue(() => t.pos.cierreViejoVista && !t.pos.cierreViejoVista.cargando);
  assert.equal(t.pos.modalCierresViejos, true, 'la hoja se abrió sola');
  const resumen = t.pos.cierreViejoResumen;
  assert.equal(resumen.n, 5);
  assert.equal(resumen.monto, 9000 + 3000 + 3000 + 9000 + 3000, '«Hay un cierre sin respaldo de la versión anterior: 5 ventas, $ 27.000»');
  const estados = Object.fromEntries(t.pos.cierreViejoVista.filas.map((f) => [f.id, f.estado]));
  assert.deepEqual(estados, { falta: 'falta', ya: 'cerrada', arch: 'cierre', ab: 'abierta', desh: 'deshecha' });
  const falta = t.pos.cierreViejoVista.filas.find((f) => f.id === 'falta');
  assert.equal(falta.mesaId, 5); assert.equal(falta.monto, 9000); assert.ok(falta.hora, 'trae su hora');
  assert.match(t.pos.cierreViejoVista.filas.find((f) => f.id === 'ab').texto, /ABIERTA \(Mesa 4\)/);
  assert.equal(t.pos.cierreViejoVista.faltan, 1);
  // nada pasó en la base
  assert.deepEqual(llamadasQueEscriben(t).map((c) => `${c.tipo}:${c.tabla || c.nombre}:${c.op || ''}`).filter((x) => !/personal|alertas/.test(x)), [], 'ni una escritura, ni una purga, ni cerrar_dia');
  assert.equal(t.supabase.de('ordenes', 'delete').length, 0);
  assert.equal(t.base.ordenes.has('falta'), false);
  assert.equal(t.pos.cambiosSinSubir, 0, 'y no cuenta como «cambio sin subir»: es una decisión, no una cola');
});

test('R5a-3b «Subir las que faltan» sube SOLO la que la base no tiene en ningún lado (ni orden, ni cierre, ni deshechos), como cobro normal; el cierre local se quita y no se purga NADA', async () => {
  const { t, almacen } = escenarioViejo();
  await listo(t);
  await hastaQue(() => t.pos.cierreViejoVista && !t.pos.cierreViejoVista.cargando);
  await t.pos.subirFaltantesCierreViejo();
  await hastaQue(() => t.base.ordenes.has('falta'));
  await hastaQue(() => t.pos.cambiosSinSubir === 0);
  assert.deepEqual([...t.base.ordenes.keys()].sort(), ['ab', 'falta', 'ya'], 'solo «falta» se agregó: «ya» ya estaba, «arch» está en un cierre, «desh» se deshizo y «ab» sigue abierta');
  assert.equal(t.base.ordenes.get('falta').estado, 'cerrada');
  assert.equal(t.base.ordenes.get('falta').total, 9000);
  assert.equal(t.base.ordenes.get('ab').estado, 'abierta', 'la cuenta abierta no se tocó');
  assert.equal(t.supabase.de('ordenes', 'delete').length, 0, 'nunca se purga nada a partir de un cierre sin respaldo');
  assert.equal(t.supabase.rpcs('cerrar_dia').length, 0);
  assert.equal(t.base.cierres.size, 1, 'no se guardó ningún cierre a partir de él');
  assert.equal(t.pos.cierresViejos.length, 0);
  assert.equal(almacen.has('pos_cierres_viejos'), false, 'el cierre local ya no hace falta');
  assert.equal(t.pos.modalCierresViejos, false);
  assert.match(t.pos.aviso.texto, /Se subieron 1 venta del cierre sin respaldo como cobros normales/);
  assert.ok(ordenLocalDe(t, 'ya') && ordenLocalDe(t, 'ya').estado === 'cerrada', 'lo que la base ya tenía cerrado vuelve a estar entre las ventas del turno (nada lo esconde)');
  // y el cierre nuevo, con red, las cuenta
  t.pos.avisar('');
  assert.equal(await t.pos.cerrarDia(), 'hay_abiertas', 'la mesa 4 sigue abierta en la base: así lo dice el cierre');
});

test('R5a-3c «Descartar este cierre local» pide un segundo toque, avisa lo que se perdería, y solo borra la copia de la tablet: no sube nada y no toca la base', async () => {
  const { t, almacen } = escenarioViejo();
  await listo(t);
  await hastaQue(() => t.pos.cierreViejoVista && !t.pos.cierreViejoVista.cargando);
  t.pos.pedirDescarteCierreViejo();
  assert.equal(t.pos.confirmandoDescarte, true);
  t.pos.cancelarDescarteCierreViejo();
  assert.equal(t.pos.cierresViejos.length, 1, 'cancelar no borra nada');
  t.pos.pedirDescarteCierreViejo();
  t.pos.descartarCierreViejo();
  assert.equal(t.pos.cierresViejos.length, 0);
  assert.equal(almacen.has('pos_cierres_viejos'), false);
  assert.equal(t.pos.modalCierresViejos, false);
  assert.match(t.pos.aviso.texto, /Cierre local descartado: no se subió ni se borró nada de la base/);
  await asentar();
  assert.equal(t.base.ordenes.has('falta'), false, 'lo que faltaba NO se sube: descartar es descartar');
  assert.deepEqual(llamadasQueEscriben(t).filter((c) => c.tabla === 'ordenes' || c.tabla === 'cierres' || c.nombre === 'cerrar_dia').map((c) => c.op || c.nombre), []);
});

test('R5a-3d S1: la caja (POS de antes) agregó una Hamburguesa a la mesa 3 SIN red, cobró $90.000 y «cerró el día» sin red; al recargar con el POS nuevo la venta sube como un cobro NORMAL con TODO lo que se cobró, la mesa queda libre y el cierre viejo espera la decisión del admin (antes: la cuenta quedaba abierta por $60.000 y la mesa libre)', async () => {
  // lo que dejó el POS de antes en localStorage: la cuenta cobrada (cerrada en local), su subida pendiente, el delta de la Hamburguesa que nunca se mandó y el cierre «Sin respaldo»
  const vendida = { id: 'o3', mesaId: 3, estado: 'cerrada', items: [PALOMA(), { id: 'hamb', nombre: 'Hamburguesa', precio: 30000, qty: 1, nota: '' }], total: 39000, abiertaEn: '2026-09-30T18:00:00Z', cerradaEn: new Date().toISOString(), version: 1 };
  const c1 = cerrada('c1', 1, [item('pf7', 30000)], 2, 30);
  const viejo = cierreViejo('viejo', [vendida, ventaDeCierre('c1', 1, c1.items, { cerradaEn: c1.cerrada_en })]);
  const almacen = new Map([
    ['pos_cierres', JSON.stringify([viejo])],
    ['pos_ordenes', JSON.stringify([])],
    ['pos_pendientes', JSON.stringify({ 'ordenes:o3': true, 'mesas:3': true })],
    ['pos_mesas', JSON.stringify([{ id: 3, capacidad: 4, estado: 'libre' }, { id: 1, capacidad: 4, estado: 'libre' }])],
    ['pos_delta_queue', JSON.stringify([{ orden_id: 'o3', item_id: 'hamb', nombre: 'Hamburguesa', precio: 30000, nota: '', delta: 1 }])],
  ]);
  // (el POS de antes guardó la orden cobrada en su caché de órdenes; el cierre la llevaba aparte)
  almacen.set('pos_ordenes', JSON.stringify([vendida]));
  const t = montar({ mesas: [mesaBase(3), libre(1)], ordenes: [ordenBase('o3', 3, [PALOMA()], 1), c1], almacen });
  await listo(t);
  await hastaQue(() => t.pos.cambiosSinSubir === 0 && t.base.ordenes.get('o3')?.estado === 'cerrada');
  await asentar();
  const o3 = t.base.ordenes.get('o3');
  assert.equal(o3.estado, 'cerrada', 'la venta se cobró y quedó cerrada en la base');
  assert.equal(o3.total, 39000, 'con TODO lo que se cobró (Palomas y Hamburguesa), no con la copia atrasada de la base');
  assert.deepEqual(o3.items.map((i) => `${i.id}x${i.qty}`).sort(), ['hambx1', 'palomax2'], 'la Hamburguesa una sola vez');
  assert.equal(t.base.mesas.get(3).estado, 'libre', 'y la mesa 3 libre (antes quedaba libre con la cuenta abierta)');
  assert.equal(t.pos.cierres.some((c) => c.id === 'viejo'), false);
  assert.equal(t.pos.cierresViejos.length, 1, 'el cierre viejo espera la decisión del admin');
  assert.equal(t.supabase.de('ordenes', 'delete').length, 0, 'sin purgar nada');
  assert.equal(t.base.cierres.size, 0, 'ni guardar un cierre a partir de él');
  // la hoja, ya con la venta en la base, la ve como «la base ya la tiene»: no queda nada por subir
  await t.pos.abrirCierresViejos();
  const estados = Object.fromEntries(t.pos.cierreViejoVista.filas.map((f) => [f.id, f.estado]));
  assert.deepEqual(estados, { o3: 'cerrada', c1: 'cerrada' });
  assert.equal(t.pos.cierreViejoVista.faltan, 0);
  t.pos.descartarCierreViejo();
  assert.equal(await t.pos.cerrarDia(), 'ok', 'y el cierre de ahora, con red, las cuenta a las dos');
  assert.equal([...t.base.cierres.values()][0].total_ventas, 39000 + 30000);
});

test('R5a-3e S4: una venta del cierre viejo que otro admin eliminó NO vuelve sola: aparece en la lista como «Falta en la base» para que el admin decida con la lista a la vista', async () => {
  const s = cerrada('s', 2, [item('pf1', 52000)], 2, 20);
  const c1 = cerrada('c1', 1, [item('pf7', 30000)], 2, 30);
  const almacen = new Map([['pos_cierres', JSON.stringify([cierreViejo('viejo', [c1, s].map((o) => ventaDeCierre(o.id, o.mesa_id, o.items, { cerradaEn: o.cerrada_en })))])]]);
  const t = montar({ mesas: [libre(1), libre(2)], ordenes: [c1], almacen });   // la base ya NO tiene `s` (la eliminó otro admin)
  await listo(t);
  await hastaQue(() => t.pos.cierreViejoVista && !t.pos.cierreViejoVista.cargando);
  await asentar();
  assert.equal(t.base.ordenes.has('s'), false, 'no resucitó: $52.000 que nadie cobró');
  assert.equal(t.pos.ordenesPorCerrar.some((o) => o.id === 's'), false, 'ni entra en las ventas por cerrar');
  const fila = t.pos.cierreViejoVista.filas.find((f) => f.id === 's');
  assert.equal(fila.estado, 'falta'); assert.equal(fila.monto, 52000); assert.equal(fila.mesaId, 2);
  assert.equal(t.pos.cierreViejoVista.filas.find((f) => f.id === 'c1').estado, 'cerrada');
});

test('R5a-3f S5: si la lectura de cierres falla UNA vez al arrancar, la hoja NO depende de ella (compara con una lectura propia) y «Reintentar subir» NO sube el cierre viejo (no está en la cola)', async () => {
  const { t } = escenarioViejo();
  t.base.fallarLecturaDe = 'cierres';             // la lectura pesada de la carga inicial responde 504
  await listo(t);
  await hastaQue(() => t.pos.cierreViejoVista && !t.pos.cierreViejoVista.cargando);
  assert.equal(t.pos.cierreViejoVista.error, '', 'la comparación usa su propia lectura: la hoja sale completa');
  assert.equal(t.pos.cierreViejoVista.filas.length, 5);
  assert.equal(t.pos.cierresViejos.length, 1, 'sigue guardado aparte, sin tocarse');
  assert.equal(t.pos.colaPendiente.length, 0, 'no aparece en la cola «sin sincronizar»');
  await t.pos.reintentarSubir();
  await asentar();
  assert.equal(t.base.cierres.size, 1, 'el cierre viejo nunca sube con un upsert');
  assert.equal(t.base.ordenes.get('ab').estado, 'abierta', 'y la cuenta abierta ni se mira');
  assert.match(t.pos.razonSinCierre, /Hay un cierre sin respaldo de la versión anterior/);
});

test('R5a-3f2 si la lectura de la COMPARACIÓN falla, la hoja no concluye nada: lo dice, no clasifica, apaga «Subir las que faltan» (y «Descartar» sigue, con el aviso de que no se sabe qué falta)', async () => {
  const { t } = escenarioViejo();
  await listo(t);
  await hastaQue(() => t.pos.cierreViejoVista && !t.pos.cierreViejoVista.cargando);
  t.base.fallarLecturaDe = 'cierres';
  await t.pos.abrirCierresViejos();
  assert.match(t.pos.cierreViejoVista.error, /No se pudo comparar con la base/);
  assert.equal(t.pos.cierreViejoVista.filas.length, 0, 'no clasifica con una lectura que no llegó');
  t.base.fallarLecturaDe = 'cierres';              // y si es «Subir las que faltan» el que se topa con la falla: su comparación de adentro tampoco concluye
  await t.pos.subirFaltantesCierreViejo();
  await asentar();
  assert.equal(t.base.ordenes.has('falta'), false, 'sin comparación no se sube nada');
  assert.equal(t.pos.cierresViejos.length, 1, 'y el cierre local sigue guardado');
  assert.match(t.pos.cierreViejoVista.error, /No se pudo comparar con la base/);
  // vuelve a intentar: ya responde
  await t.pos.abrirCierresViejos();
  assert.equal(t.pos.cierreViejoVista.error, '');
  assert.equal(t.pos.cierreViejoVista.faltan, 1);
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../pos.html', import.meta.url), 'utf8');
  assert.match(html, /No se pudo comparar con la base: no se sabe si alguna venta falta/, 'la hoja avisa antes de descartar a ciegas');
});

test('R5a-3g el mesero NO ve la hoja y su tablet conserva el cierre aparte para el próximo admin; el mesero sigue trabajando y no pierde nada de lo suyo', async () => {
  const { t, almacen } = escenarioViejo({ rol: 'mesero' });
  await listo(t);
  await asentar();
  assert.equal(t.pos.modalCierresViejos, false);
  assert.equal(t.pos.cierreViejoVista, null);
  assert.equal(t.pos.aviso, null, 'no se le avisa de nada que no puede decidir');
  assert.equal(t.pos.cierres.some((c) => c.id === 'viejo'), false, 'el viejo no es uno de los cierres de la lista (el historial es el de la base)');
  assert.equal(JSON.parse(almacen.get('pos_cierres_viejos')).length, 1, 'el cierre sigue guardado');
  await t.pos.abrirCierresViejos();
  assert.equal(t.pos.modalCierresViejos, false, 'ni abriéndola a mano');
  await t.pos.subirFaltantesCierreViejo();
  t.pos.descartarCierreViejo();
  assert.equal(t.pos.cierresViejos.length, 1, 'ni subir ni descartar: es del admin');
  assert.equal(t.base.ordenes.has('falta'), false);
  // y el mismo cierre, al entrar un admin en esa tablet, sí se ofrece
  const t2 = montar({ rol: 'admin', mesas: [libre(5)], ordenes: [], almacen });
  await listo(t2);
  await hastaQue(() => t2.pos.modalCierresViejos === true);
  assert.equal(t2.pos.cierreViejoResumen.n, 5);
});

test('R5a-3h con un cierre viejo sin decidir, «Cerrar día» se apaga y lo dice (con el botón «Revisar» en la vista); al decidir se habilita', async () => {
  const { t } = escenarioViejo({ extraBase: {} });
  // una base sin cuentas abiertas ni nada raro para que el único motivo sea el cierre viejo
  const venta = cerrada('c1', 1, [PAN()], 2, 10);
  const almacen = new Map([['pos_cierres', JSON.stringify([cierreViejo('viejo', [ventaDeCierre('x', 1, [PAN()])])])]]);
  const t2 = montar({ mesas: [libre(1)], ordenes: [venta], almacen });
  await listo(t2);
  await hastaQue(() => t2.pos.cierreViejoVista && !t2.pos.cierreViejoVista.cargando);
  assert.equal(t2.pos.puedesCerrar, true);
  assert.match(t2.pos.razonSinCierre, /Hay un cierre sin respaldo de la versión anterior: decide qué hacer con él/);
  assert.equal(t2.pos.puedeCerrarAhora, false);
  assert.equal(await t2.pos.cerrarDia(), 'bloqueado');
  assert.equal(t2.base.cierres.size, 0);
  t2.pos.descartarCierreViejo();
  assert.equal(t2.pos.razonSinCierre, '');
  assert.equal(t2.pos.puedeCerrarAhora, true);
  assert.equal(await t2.pos.cerrarDia(), 'ok');
  void t;
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../pos.html', import.meta.url), 'utf8');
  assert.match(html, /id="cierre-viejo-aviso"[\s\S]{0,700}abrirCierresViejos\(\)">Revisar</, 'la vista del cierre ofrece «Revisar»');
});

test('R5a-3i lo que NO es un cierre sin respaldo viejo se queda donde estaba: un cierre del historial editado sin red (sin `purgar`) y un cierre del camino de siempre que armó ESTA versión (`origen`)', async () => {
  const editado = { id: 'k1', fecha: new Date().toISOString(), total: 5000, sync: 'error', ordenes: [{ id: 'x', mesaId: 1, estado: 'cerrada', items: [], total: 5000 }] };
  const propio = { id: 'k2', fecha: new Date().toISOString(), total: 3000, sync: 'pendiente', origen: 'pos-nuevo', purgar: ['y'], ordenes: [ventaDeCierre('y', 1, [PAN()])] };
  const almacen = new Map([['pos_cierres', JSON.stringify([editado, propio])]]);
  const t = montar({ mesas: [libre(1)], ordenes: [], almacen });
  t.pos.cargarCachéLocal();
  assert.deepEqual(t.pos.cierres.map((c) => c.id), ['k1', 'k2']);
  assert.equal(t.pos.cierresViejos.length, 0);
  assert.equal(almacen.has('pos_cierres_viejos'), false);
  await listo(t);
  assert.equal(t.pos.modalCierresViejos, false);
  assert.equal(t.pos.cierres.find((c) => c.id === 'k1').sync, 'error', 'conserva su «Reintentar respaldo»');
});

test('R5a-3j cargar la caché dos veces (o morir entre las dos escrituras) no duplica ni pierde el cierre viejo; sin red la hoja lo dice y no concluye nada', async () => {
  const viejo = cierreViejo('viejo', [ventaDeCierre('v1', 1, [PAN()])]);
  // la página murió después de guardarlo aparte y antes de reescribir la lista: está en las DOS
  const almacen = new Map([['pos_cierres', JSON.stringify([viejo])], ['pos_cierres_viejos', JSON.stringify([viejo])]]);
  const t = montar({ mesas: [libre(1)], ordenes: [], almacen });
  t.pos.cargarCachéLocal();
  t.pos.cargarCachéLocal();
  assert.equal(t.pos.cierresViejos.length, 1, 'sin duplicar');
  assert.equal(t.pos.cierres.length, 0);
  assert.equal(JSON.parse(almacen.get('pos_cierres_viejos')).length, 1);
  sinRed(t);
  await t.pos.abrirCierresViejos();   // sin rol cargado el POS no deja: se simula el admin ya entrado
  t.pos.rol = 'admin'; t.pos.rolCargado = true;
  await t.pos.abrirCierresViejos();
  assert.match(t.pos.cierreViejoVista.error, /Sin conexión: para comparar con la base hace falta la red/);
  assert.equal(t.pos.cierreViejoVista.faltan, 0);
  assert.equal(t.supabase.llamadas.filter((c) => c.tipo === 'from' && c.tabla === 'ordenes' && c.op !== 'select').length, 0);
});

test('R5a-3k con dos cierres viejos la hoja los va mostrando de uno en uno, y decidir el primero pasa al segundo', async () => {
  const a = cierreViejo('a', [ventaDeCierre('va', 1, [PAN()])]);
  const b = cierreViejo('b', [ventaDeCierre('vb', 2, [PALOMA()])]);
  const almacen = new Map([['pos_cierres', JSON.stringify([a, b])]]);
  const t = montar({ mesas: [libre(1), libre(2)], ordenes: [], almacen });
  await listo(t);
  await hastaQue(() => t.pos.cierreViejoVista && !t.pos.cierreViejoVista.cargando);
  assert.equal(t.pos.cierreViejoResumen.quedan, 1);
  assert.equal(t.pos.cierreViejoVista.id, 'a');
  t.pos.descartarCierreViejo();
  await hastaQue(() => t.pos.cierreViejoVista && t.pos.cierreViejoVista.id === 'b' && !t.pos.cierreViejoVista.cargando);
  assert.equal(t.pos.modalCierresViejos, true, 'la hoja sigue abierta con el segundo');
  assert.equal(t.pos.cierreViejoResumen.n, 1);
  t.pos.descartarCierreViejo();
  assert.equal(t.pos.modalCierresViejos, false);
});

test('R5a-3l el cierre que ESTA versión arma por el camino de siempre (la base aún sin `cerrar_dia`) lleva `origen` y, si no llegó a subir, al recargar NO se confunde con uno de la versión anterior: se reintenta solo', async () => {
  const almacen = new Map();
  const t = montar({ olaC: false, mesas: [libre(1)], ordenes: [cerrada('c1', 1, [PAN()], 2, 10)], almacen });
  await listo(t);
  t.base.fallar('upsert:cierres');                 // el cierre no logra subir
  assert.equal(await t.pos.cerrarDia(), 'legado');
  await asentar();
  const propio = t.pos.cierres[0];
  assert.equal(propio.origen, 'pos-nuevo');
  assert.equal(propio.sync, 'error');
  assert.ok(Array.isArray(propio.purgar) && propio.purgar.length === 1, 'trae su `purgar`, como el viejo: lo único que lo distingue es `origen`');
  // la tablet se recarga
  const t2 = montar({ olaC: false, mesas: [libre(1)], ordenes: [cerrada('c1', 1, [PAN()], 2, 10)], almacen });
  t2.pos.cargarCachéLocal();
  assert.equal(t2.pos.cierresViejos.length, 0, 'no es un «sin respaldo» de la versión anterior');
  assert.deepEqual(t2.pos.cierres.map((c) => c.id), [propio.id], 'sigue entre los cierres, con su «Reintentar respaldo»');
  assert.equal(t2.pos.cierres[0].sync, 'error');
});

// ═════════════════════════ R5a-4. Una máquina menos ═════════════════════════

test('R5a-4 el store ya no tiene la recuperación automática de la ronda 4 ni el camino de dos mitades para reabrir desde un cierre', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../pos.html', import.meta.url), 'utf8');
  const codigo = html.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(codigo, /_recuperarCierresViejos/, 'sin recuperación automática');
  assert.doesNotMatch(codigo, /recalcularYSubirCierre\(cierreOrigen\)/, 'reabrir desde un cierre ya no edita el cierre por su cuenta después de subir la cuenta');
  assert.match(codigo, /reabrir_venta_de_cierre/);
  assert.match(codigo, /esErrorCuentaArchivada/);
  void plano; void conRed;
});
