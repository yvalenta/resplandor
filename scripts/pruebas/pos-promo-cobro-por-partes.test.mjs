// Cobrar por partes una cuenta con PROMOCIÓN (hallazgo ALTO de la refutación del 2026-10-05; migración 20261005130000_promo_cobro_por_partes.sql).
// La lógica del POS (pos.html, su <script> REAL en un `vm`) contra la base falsa de _pos-vm.mjs, que modela la guardia de la base (`trg_ordenes_guardia_promo`):
//
//   P-1  con una línea de promoción en la cuenta, el POS NO ofrece cobrar por partes: no marca nada, no crea ninguna venta ni saca ninguna unidad, y dice por qué
//        (facturarParcial, la lista de ids de «por persona» y las casillas); la cuenta SIN promoción se cobra por partes como siempre.
//   P-2  «por persona» en una cuenta con promoción se recibe como un ABONO por el total de esa persona (no saca unidades: el descuento no se mueve), con el
//        panel de abono abierto y el monto escrito; y el abono sigue funcionando en una cuenta con promoción.
//   P-3  respaldo: una tablet que no sabía de la promoción (su copia de la cuenta es anterior) cobra por partes y la base lo rechaza (RS005, «promoción»): lo marcado
//        VUELVE a la cuenta (una línea de promo vuelve a su línea BASE, nunca como línea de promo suelta), no queda venta ni «Deshacer», y el aviso habla de la promoción;
//        el RS005 de la cuenta archivada sigue con su aviso de siempre.
//   P-4  estática: lo que dice el POS (los helpers, el aviso del modo «Cobrar por partes», las casillas y los botones apagados).
//
// SQL de los mismos escenarios, con un mesero y un admin de verdad (RLS): scripts/pruebas/migracion-promo-cobro-por-partes.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  RAIZ, asentar, crearBaseFalsa, crearPos, hastaQue, mesaBase, ordenBase,
} from './_pos-vm.mjs';

const POS_HTML = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };

function montar({ rol = 'mesero', mesas = [mesaBase(1)], ordenes = [], cierres = [], olaC = true } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, cierres, olaC });
  const original = base.responder;
  base.responder = async (c) => { const r = await original(c); return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r; };
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
const mesaDe = (t, id) => t.pos.mesas.find((m) => m.id === id);
const lineas = (o) => o.items.map((i) => `${i.id}x${i.qty}`).sort();
const cerradas = (t) => [...t.base.ordenes.values()].filter((o) => o.estado === 'cerrada');

// El lunes: Seco 19.000 y Menú Resplandor 23.000; la promo «3er almuerzo» 20 % deja la línea `promo:<promo>:<base>` con su objeto `promo`.
const SECO = (qty, nota = '') => ({ id: 'seco', nombre: 'Seco', precio: 19000, qty, nota });
const MENU = (qty, nota = '') => ({ id: 'menu', nombre: 'Menú Resplandor', precio: 23000, qty, nota });
const PROMO_SECO = (nota = '') => ({
  id: 'promo:p-lun:seco', nombre: 'Seco · 3er almuerzo · 20% OFF', precio: 15200, qty: 1, nota,
  promo: { id: 'p-lun', de: 'seco', nombre: 'Seco', precio: 19000, descuento: 20 },
});
const JUGO = (qty, nota = '') => ({ id: 'jugo', nombre: 'Jugo', precio: 12000, qty, nota });
const tresSeco = () => [SECO(2), PROMO_SECO()];                       // 3 Seco juntos: 53.200
const total = (items) => items.reduce((s, i) => s + i.precio * i.qty, 0);

async function conCuenta(items, { rol = 'mesero', version = 3 } = {}) {
  const t = montar({ rol, mesas: [mesaBase(1)], ordenes: [ordenBase('o1', 1, items, version)] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 1));
  assert.equal(t.pos.ordenActiva.id, 'o1');
  return t;
}

// ═════════════════════════ P-1. El POS no ofrece cobrar por partes una cuenta con promoción ═════════════════════════

test('P-1a cuentaConPromo: verdadera con una línea `promo:` (con su objeto), falsa sin ella y con una línea suelta que se llame parecido', async () => {
  const t = await conCuenta(tresSeco());
  assert.equal(t.pos.cuentaConPromo, true);
  const s = await conCuenta([SECO(3)]);
  assert.equal(s.pos.cuentaConPromo, false, 'tres Seco SIN línea de promo (otro día) no es una cuenta con promoción');
  const u = await conCuenta([SECO(1), { id: 'manual_1', nombre: 'Promoción manual', precio: 1000, qty: 1, nota: '' }]);
  assert.equal(u.pos.cuentaConPromo, false);
});

test('P-1b facturarParcial de lo marcado en una cuenta con promoción: no crea ninguna venta, no saca ninguna unidad y dice por qué; la cuenta queda intacta', async () => {
  const t = await conCuenta(tresSeco());
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(t.pos.ordenActiva.items[0]);
  assert.equal(t.pos.estaSeleccionado(t.pos.ordenActiva.items[0]), false, 'ni siquiera deja marcar la línea');
  t.pos.facturarParcial({ seco: 1 });
  t.pos.facturarParcial(['seco', 'promo:p-lun:seco']);
  t.pos.facturarParcial({ 'promo:p-lun:seco': 1 });
  await asentar(30);
  assert.equal(cerradas(t).length, 0, 'ninguna venta cerrada, en la base ni en la tablet');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0);
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, 0, 'ninguna unidad salió de la cuenta');
  assert.deepEqual(lineas(t.base.ordenes.get('o1')), ['promo:p-lun:secox1', 'secox2']);
  assert.equal(t.base.ordenes.get('o1').total, 53200);
  assert.equal(t.pos.vista, 'orden', 'sigue en la cuenta, no en un ticket');
  assert.equal(t.pos.ultimoCobro, null);
  assert.equal(t.pos.seleccionCobro, true, 'el modo «Cobrar por partes» sigue abierto: ahí está «Recibir un abono»');
  assert.deepEqual(JSON.parse(JSON.stringify(t.pos.itemsSeleccionados)), {});
});

test('P-1c el aviso de facturarParcial es el de la promoción (un aviso en pantalla, no un alert: la ola B fijó cuántos alert() hay), y dice las dos salidas: la mesa completa o un abono por cada quien', async () => {
  const t = await conCuenta(tresSeco());
  t.pos.facturarParcial({ seco: 2 });
  assert.equal(t.avisos.length, 0, 'ningún alert()');
  assert.match(t.pos.aviso.texto, /Esta mesa tiene una promoción/);
  assert.match(t.pos.aviso.texto, /no se cobra por partes ni por persona/);
  assert.match(t.pos.aviso.texto, /Cobra la mesa completa, o recibe un abono por cada quien/);
});

test('P-1d una cuenta SIN promoción se cobra por partes como siempre: venta cerrada con parcial_de, un delta −qty, la cuenta cuadra', async () => {
  const t = await conCuenta([SECO(2), JUGO(1)]);
  t.pos.facturarParcial({ seco: 1 });
  await asentar(30);
  const [cerrada] = cerradas(t);
  assert.ok(cerrada, 'se creó la venta');
  assert.equal(cerrada.parcial_de, 'o1');
  assert.equal(cerrada.total, 19000);
  assert.deepEqual(t.supabase.rpcs('aplicar_delta_orden').map((c) => [c.args.p_item_id, c.args.p_delta]), [['seco', -1]]);
  assert.equal(cerrada.total + t.base.ordenes.get('o1').total, 2 * 19000 + 12000);
  assert.equal(t.avisos.length, 0, 'ningún aviso');
});

test('P-1e las casillas y los botones de «Cobrar por partes» se apagan con una promoción (el aviso aparece solo en ese modo); sin promoción, como antes', () => {
  assert.match(POS_HTML, /<div id="aviso-promo-partes" x-show="\$store\.pos\.seleccionCobro && \$store\.pos\.cuentaConPromo"/);
  assert.match(POS_HTML, /<input type="checkbox" x-show="\$store\.pos\.seleccionCobro && item\.precio >= 0" x-cloak\s+:disabled="\$store\.pos\.cuentaConPromo"/);
  const apagados = POS_HTML.match(/:disabled="\$store\.pos\.lineasSeleccionadas === 0 \|\| \$store\.pos\.seleccionExcede \|\| \$store\.pos\.cuentaConPromo"/g) || [];
  assert.equal(apagados.length, 2, 'los dos «Cobrar seleccionados» (desde 1024 y la barra de abajo) se apagan con promoción');
  assert.match(POS_HTML, /Con promoción: usa un abono/);
  // el «Sí, cobrar» del modal sigue como estaba (solo se llega a él con algo marcado, y con promoción nada se marca)
  assert.match(POS_HTML, /<button class="btn-primary" :disabled="\$store\.pos\.lineasSeleccionadas === 0 \|\| \$store\.pos\.seleccionExcede"\s+@click="\$store\.pos\.facturarParcial/);
});

// ═════════════════════════ P-2. «Por persona» y abonos con promoción ═════════════════════════

test('P-2a «Cobrar» a una persona en una cuenta con promoción: ninguna venta ni unidad sale; se abre el panel de abono con el total de esa persona escrito', async () => {
  // Persona 1: Seco ×2 y el Seco con descuento (el 3.º); Persona 2: un Jugo. La promo lleva la nota de su línea base, así que es de la misma persona.
  const items = [SECO(2, 'Persona 1'), PROMO_SECO('Persona 1'), JUGO(1, 'Persona 2')];
  const t = await conCuenta(items);
  assert.equal(t.pos.haySplitPorPersona, true);
  assert.equal(t.pos.gruposPorPersona['Persona 1'].length, 2, 'la promo cae en la persona de su Seco');
  t.pos.cobrarGrupoPersona('Persona 1');
  await asentar(30);
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, 0);
  assert.equal(t.pos.seleccionCobro, true, 'el panel de abono está abierto');
  assert.equal(t.pos.montoAbono, String(2 * 19000 + 15200), 'con lo que debe la persona: 53.200');
  assert.equal(t.pos.abonoValido, true, 'menos que el total de la mesa (65.200): es un abono válido');
  assert.match(t.pos.aviso.texto, /Esta mesa tiene una promoción: lo de Persona 1 se recibe como un abono por su total/);
  assert.equal(t.avisos.length, 0, 'sin alert: el aviso es el aviso de pantalla');
  // y la última persona (lo que queda = todo el total) NO es un abono: se cobra la mesa completa
  t.pos.toggleModoCobroParcial();
  t.pos.cobrarGrupoPersona('Persona 2');
  assert.equal(t.pos.montoAbono, '12000');
});

test('P-2b recibir ese abono funciona en una cuenta con promoción: venta cerrada «Abono» y línea «Abono recibido» en la cuenta; las líneas (y el descuento) no se tocan', async () => {
  const t = await conCuenta([SECO(2, 'Persona 1'), PROMO_SECO('Persona 1'), JUGO(1, 'Persona 2')]);
  t.pos.cobrarGrupoPersona('Persona 1');
  t.pos.metodoAbono = 'efectivo';
  assert.equal(t.pos.cobrarMonto(), true);
  await asentar(30);
  const [abono] = cerradas(t);
  assert.ok(abono && abono.items.length === 1 && String(abono.items[0].id).startsWith('abono_'), 'la venta cerrada es un abono');
  assert.equal(abono.total, 53200);
  const cuenta = t.base.ordenes.get('o1');
  assert.deepEqual(lineas(cuenta).filter((l) => !l.startsWith('abono_recibido_')), ['jugox1', 'promo:p-lun:secox1', 'secox2']);
  assert.equal(cuenta.items.find((i) => i.id === 'seco').qty, 2);
  assert.equal(cuenta.items.find((i) => i.id === 'promo:p-lun:seco').precio, 15200, 'el descuento sigue donde estaba');
  assert.equal(cuenta.total, 65200 - 53200, 'queda por pagar lo de Persona 2');
  assert.equal(abono.total + cuenta.total, 65200, 'abonado + lo que falta = el total de la mesa');
});

test('P-2c una cuenta con promoción se sigue cobrando COMPLETA (facturar): el total es el que calcula la base', async () => {
  const t = await conCuenta(tresSeco());
  assert.equal(t.pos.totalOrdenActiva, 53200);
  t.pos.facturar();
  await asentar(30);
  const o = t.base.ordenes.get('o1');
  assert.equal(o.estado, 'cerrada');
  assert.equal(o.total, 53200);
  assert.equal(t.pos.ticketMostrado?.total ?? 53200, 53200);
});

// ═════════════════════════ P-3. Respaldo: una tablet que no sabía de la promoción ═════════════════════════

/** La base tiene la cuenta con promo; la tablet todavía ve `vista` (su copia anterior a la promo, o con ella). */
async function tabletAtrasada(itemsBase, itemsTablet) {
  const t = await conCuenta(itemsBase);
  const local = t.pos.ordenes.find((o) => o.id === 'o1');
  local.items = itemsTablet.map((i) => ({ ...i }));
  local.total = total(itemsTablet);
  return t;
}

test('P-3a la tablet ve 3 Seco SIN promo y cobra uno; la base (que sí tiene la promo) lo rechaza (RS005): el Seco vuelve a la cuenta, no queda venta ni «Deshacer», y el aviso habla de la promoción', async () => {
  const t = await tabletAtrasada(tresSeco(), [SECO(3)]);
  t.pos.facturarParcial({ seco: 1 });
  assert.equal(t.pos.vista, 'ticket', 'al cobrar, el ticket aparece de inmediato (la base todavía no contestó)');
  await hastaQue(() => t.pos.aviso && /promoción/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(30);
  assert.equal(cerradas(t).length, 0, 'la base no guardó ninguna venta');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'ni la tablet');
  assert.deepEqual(lineas(t.base.ordenes.get('o1')), lineas({ items: tresSeco() }), 'la cuenta de la base quedó como estaba: lo que salió con el delta volvió');
  assert.equal(t.base.ordenes.get('o1').total, 53200);
  assert.equal(t.pos.vista, 'orden', 'la pantalla vuelve a la cuenta, no se queda en un ticket falso');
  assert.equal(t.pos.ultimoCobro, null);
  assert.match(t.pos.aviso.texto, /El cobro por partes de la Mesa 1 NO quedó registrado: esa cuenta tiene una promoción/);
  assert.match(t.pos.aviso.texto, /Lo que marcaste volvió a la cuenta, que sigue abierta/);
  assert.match(t.pos.aviso.texto, /Si ya recibiste el pago, no lo pierdas de vista: cobra la mesa completa, o recibe un abono por cada quien/);
  assert.doesNotMatch(t.pos.aviso.texto, /cierre del día/, 'no es el aviso de la cuenta archivada');
});

test('P-3b la tablet cobra la LÍNEA DE PROMO (la ve, pero la base ya la tiene así): se rechaza, y esa unidad vuelve a su línea BASE al precio sin descuento (nunca como línea de promo suelta)', async () => {
  const t = await tabletAtrasada(tresSeco(), tresSeco());
  // El cobro no pasa por el guardia del POS nuevo: se fuerza el camino del POS que no lo tiene (una tablet sin recargar), llamando a lo que hace facturarParcial por dentro.
  const store = t.pos;
  const cuenta = store.ordenes.find((o) => o.id === 'o1');
  const promo = cuenta.items.find((i) => i.id === 'promo:p-lun:seco');
  const nueva = {
    id: 'cobro-1', mesaId: 1, estado: 'cerrada', items: [{ ...promo, qty: 1 }], total: 15200,
    abiertaEn: cuenta.abiertaEn, cerradaEn: new Date().toISOString(), parcialDe: 'o1', dividirOculto: true, persona: '', quedan: 38000,
  };
  store.ordenes.push(nueva);
  cuenta.items = cuenta.items.filter((i) => i.id !== promo.id);
  const subidas = [store.pushASupabase('ordenes', nueva).catch(() => false), store._enviarDelta(cuenta, promo, -1)];
  await Promise.allSettled(subidas);
  await hastaQue(() => store.aviso && /promoción/.test(store.aviso.texto));
  await hastaQue(() => store.colaDeltas.length === 0 && store.cambiosSinSubir === 0);
  await asentar(30);
  assert.equal(cerradas(t).length, 0);
  const enBase = t.base.ordenes.get('o1');
  assert.ok(enBase.items.every((i) => !String(i.id).startsWith('promo:') || i.promo), 'ninguna línea de promo suelta (sin su objeto promo) en la cuenta');
  const devueltos = t.base.rpcs.filter((r) => r.delta > 0);
  assert.deepEqual(devueltos.map((r) => r.item), ['seco'], 'lo que vuelve es UNA unidad de la línea base, no de la línea de promo');
  assert.equal(enBase.items.filter((i) => i.id === 'seco').reduce((s, i) => s + i.qty, 0), 3, 'las tres unidades siguen en la cuenta');
  assert.match(store.aviso.texto, /esa cuenta tiene una promoción/);
});

test('P-3c el RS005 de una cuenta ARCHIVADA y abierta sigue con su aviso de siempre (el «cierre del día»), no el de la promoción', async () => {
  const venta = { id: 'o1', mesaId: 1, estado: 'cerrada', items: [SECO(2)], total: 38000, abiertaEn: '2026-10-01T18:00:00Z', cerradaEn: new Date().toISOString(), version: 2 };
  const k = { id: 'k-viejo', fecha: new Date(Date.now() - 86400000).toISOString(), total_ventas: 38000, total_ordenes: 1, transacciones: [venta] };
  const t = montar({ mesas: [mesaBase(1)], ordenes: [ordenBase('o1', 1, [SECO(2)], 3)], cierres: [k] });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 1));
  t.pos.facturarParcial({ seco: 1 });
  await hastaQue(() => t.pos.aviso && /NO quedó registrado/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(30);
  assert.match(t.pos.aviso.texto, /esa cuenta ya estaba en un cierre del día/);
  assert.doesNotMatch(t.pos.aviso.texto, /promoción/);
  assert.deepEqual(lineas(t.base.ordenes.get('o1')), ['secox2']);
});

test('P-3d el POS reconoce el error de la base por su código y por «por partes» + «promoción»: un RS005 sin la palabra «promoción» NO es el aviso de promoción', () => {
  const fuente = POS_HTML.match(/function esErrorCobroParcialPromo\(e\) \{[\s\S]*?\n    \}/)[0];
  assert.match(fuente, /esErrorCobroParcialArchivado\(e\) && \/promoci\[óo\]n\/i\.test/);
});

// ═════════════════════════ P-4. Estática ═════════════════════════

test('P-4 el POS cita la migración y la regla: una cuenta con promoción se cobra completa o con abonos; la guarda va después de la de «solo cuentas abiertas»', () => {
  assert.ok(POS_HTML.includes('20261005130000'), 'cita la migración');
  assert.match(POS_HTML, /const cuentaConPromo = \(items\) => Array\.isArray\(items\) && items\.some\(esLineaPromo\);/);
  const f = POS_HTML.slice(POS_HTML.indexOf('facturarParcial(seleccion = this.itemsSeleccionados'));
  const iAbierta = f.indexOf("orden.estado !== 'abierta'");
  const iPromo = f.indexOf('cuentaConPromo(orden.items)');
  const iLineas = f.indexOf('const unidadesDe = ');
  assert.ok(iAbierta > 0 && iPromo > iAbierta && iLineas > iPromo, 'la guarda de promoción va después de la de cuenta abierta y antes de armar el cobro');
});
