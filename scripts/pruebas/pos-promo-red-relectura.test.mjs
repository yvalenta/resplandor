// Tres reglas simples que cierran lo que la segunda refutación (2026-10-05) encontró de «Cobrar por partes» con promoción y del cobro de la mesa completa
// (tareas/2026-10-04-hallazgos-domingo.md). El POS REAL (el <script> de pos.html en un `vm`) contra la base falsa de _pos-vm.mjs, que ahora RECALCULA la cuenta
// tras cada escritura como lo hace `trg_ordenes_a_precio_vivo` (el «3er almuerzo» del lunes: cada 3, 20 %, solo Menú Resplandor y Seco) y aplica la guardia de
// la base (`trg_ordenes_guardia_promo`, RS005). Los mismos escenarios, en SQL con un mesero de verdad (RLS):
// scripts/pruebas/migracion-promo-cobro-por-partes.test.mjs (sección «protocolo del POS nuevo»).
//
//   REGLA 1 (la base manda)   Un cobro por partes o un abono ENTRA PRIMERO; lo que sale de la cuenta (las unidades, el crédito del abono) solo se manda cuando la base
//                             aceptó el cobro. Si lo rechaza (RS005: promoción, cierre del día; permisos…), NADA salió de la cuenta y el POS NO la reconstruye:
//                             la relee de la base y la adopta tal cual. Si no se puede leer, la copia queda «sin confirmar» y no se cobra hasta releerla.
//                             (Antes: la venta y los −qty salían en paralelo y el rechazo «devolvía» con +qty una unidad que nunca salió: 2 Menú + 1 Seco en 80.200.)
//   REGLA 2 (sin red)         Sin red no se cobra una cuenta con promoción (con la línea `promo:…`, o que la base tendría al normalizar: la regla del día y los ítems
//                             lo dicen). Sin red, los deltas subían antes que la venta y la guardia ya no veía la promo: 3 Seco volvían a 57.000.
//   REGLA 3 (el total manda)  El cobro de la mesa completa trae de vuelta la fila que la base REGISTRÓ (ya normalizada) y el ticket se arma con ese total; si difiere del
//                             que la tablet mostraba, lo avisa. Sin red el ticket dice «provisional» y, al confirmarse, se corrige y se avisa.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  RAIZ, asentar, crearBaseFalsa, crearPos, hastaQue, mesaBase, ordenBase, normalizadorDeAlmuerzos, productosDelLunes,
} from './_pos-vm.mjs';

const POS_HTML = fs.readFileSync(process.env.POS_HTML ? path.resolve(process.env.POS_HTML) : path.join(RAIZ, 'pos.html'), 'utf8');
const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const LUNES = '2026-10-05T18:00:00Z';     // 13:00 en Bogotá, lunes
const MARTES = '2026-10-06T18:00:00Z';

const SECO = (qty, nota = '') => ({ id: 'seco', nombre: 'Seco', precio: 19000, qty, nota });
const MENU = (qty, nota = '') => ({ id: 'menu', nombre: 'Menú Resplandor', precio: 23000, qty, nota });
const JUGO = (qty) => ({ id: 'jugo', nombre: 'Jugo', precio: 12000, qty, nota: '' });
const normalizar = normalizadorDeAlmuerzos();
const total = (items) => items.reduce((s, i) => s + i.precio * i.qty, 0);
const unidades = (items) => items.reduce((s, i) => s + i.qty, 0);
const ver = (items) => items.map((i) => `${i.qty}×${i.nombre}@${i.precio}`).join(' + ') + ` = ${total(items)}`;
const cerradas = (t) => [...t.base.ordenes.values()].filter((o) => o.estado === 'cerrada');
const local = (t, id = 'o1') => t.pos.ordenes.find((o) => o.id === id);
const lineas = (o) => o.items.map((i) => `${i.id}x${i.qty}`).sort();

function montar({ items, abiertaEn = LUNES, version = 3, rol = 'mesero', productos = productosDelLunes(), cierres = [], normalizador = normalizar }) {
  const fila = { ...ordenBase('o1', 1, normalizador(items, { abierta_en: abiertaEn }), version), abierta_en: abiertaEn };
  const base = crearBaseFalsa({ rol, mesas: [mesaBase(1)], ordenes: [fila], productos, cierres, olaC: true, normalizar: normalizador });
  const original = base.responder;
  base.responder = async (c) => { const r = await original(c); return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r; };
  const reales = { setTimeout, clearTimeout };
  const timers = [];   // los temporizadores largos (≥ 1,5 s) no corren solos: la prueba los dispara a mano
  const t = crearPos({
    base,
    extras: {
      setInterval() { return 1; }, clearInterval() {},
      setTimeout(fn, ms, ...resto) { if (ms >= 1500) { const h = { fn, ms, unref() { return h; } }; timers.push(h); return h; } return reales.setTimeout(fn, ms, ...resto); },
      clearTimeout(h) { if (h && typeof h === 'object') return; reales.clearTimeout(h); },
    },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  t.base = base; t.pos.usuario = YO; t.timers = timers;
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
const sinRed = (t) => { t.base.red = false; t.pos.remoto = 'offline'; };
const conRed = (t) => { t.base.red = true; t.pos.remoto = 'ok'; };
const producto = (t, id) => t.pos.productos.find((p) => p.id === id);
/** Lo que otra tablet hizo en la base mientras esta no se enteraba. */
const otraTablet = (t, items) => { const o = t.base.ordenes.get('o1'); o.items = normalizar(items, o); o.total = total(o.items); o.version += 1; };
const hastaAviso = (t, re) => hastaQue(() => t.pos.aviso && re.test(t.pos.aviso.texto));
const SIN_RED_PROMO = /Sin red: esta cuenta tiene promoción; espera a que vuelva la red para cobrar/;

// ═══════════════════ REGLA 1. La base manda: el cobro entra primero, lo rechazado no sacó nada y la cuenta se relee ═══════════════════

test('R1-a en línea, copia atrasada: la tablet ve 1 Menú + 1 Seco, otra ya sumó un Menú (la base tiene 2 Menú + «Seco · 3er almuerzo»); cobrar «el Seco» por partes se rechaza, NADA sale de la cuenta (61.200) y la tablet adopta la de la base', async () => {
  const t = await abrir([MENU(2), SECO(1)]);
  assert.equal(total(t.base.ordenes.get('o1').items), 61200, ver(t.base.ordenes.get('o1').items));
  const copia = local(t);
  copia.items = [MENU(1), SECO(1)]; copia.total = 42000;               // el eco de Realtime todavía no llegó a esta tablet
  assert.equal(t.pos.cuentaConPromo, false, 'la tablet no ve promo: sí ofrece cobrar por partes');
  t.pos.facturarParcial({ seco: 1 });
  await hastaAviso(t, /promoción/);
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(40);
  const o = t.base.ordenes.get('o1');
  assert.equal(cerradas(t).length, 0, 'la venta por partes se rechazó (RS005): ninguna venta en la base');
  assert.equal(t.base.rpcs.length, 0, 'ningún delta llegó a la base: lo que sale de la cuenta espera a que el cobro entre');
  assert.equal(unidades(o.items), 3, `la mesa pidió 2 Menú + 1 Seco (61.200); la cuenta quedó: ${ver(o.items)}`);
  assert.equal(o.total, 61200);
  assert.deepEqual(lineas(local(t)), lineas(o), 'la tablet adoptó la cuenta de la base tal cual (no la reconstruyó)');
  assert.equal(local(t).total, 61200);
  assert.ok(!local(t).sinConfirmar, 'la lectura salió bien: nada «sin confirmar»');
  assert.equal(t.pos.ordenes.filter((x) => x.estado === 'cerrada').length, 0, 'ni la tablet guarda la venta');
  assert.equal(t.pos.vista, 'orden', 'la pantalla vuelve a la cuenta: no se queda en un ticket falso');
  assert.match(t.pos.aviso.texto, /NO quedó registrado/);
});

test('R1-b la línea base SÍ existe en la base (Seco ×2 + «3er almuerzo»; la tablet ve 3 Seco sin promo) y se cobra un Seco: rechazado, la cuenta sigue en 53.200 (no 38.000, no 72.200)', async () => {
  const t = await abrir([SECO(3)]);
  assert.equal(total(t.base.ordenes.get('o1').items), 53200);
  const copia = local(t);
  copia.items = [SECO(3)]; copia.total = 57000;
  t.pos.facturarParcial({ seco: 1 });
  await hastaAviso(t, /promoción/);
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(40);
  const o = t.base.ordenes.get('o1');
  assert.equal(o.total, 53200, ver(o.items));
  assert.equal(t.base.rpcs.length, 0);
  assert.equal(cerradas(t).length, 0);
  assert.equal(local(t).total, 53200, 'la tablet muestra lo que la base tiene');
});

test('R1-c sin red se cobra un Seco por partes (2 unidades: no hay promo); mientras tanto otra tablet suma un Menú; al volver la red la venta sube PRIMERO, la base la rechaza (RS005) y los −1 de la cola se sueltan: la cuenta queda en 61.200 y la tablet la adopta', async () => {
  const t = await abrir([MENU(1), SECO(1)]);
  sinRed(t);
  assert.equal(t.pos.motivoSinCobro, '', 'MENÚ + SECO son dos unidades: sin red se cobra');
  t.pos.facturarParcial({ seco: 1 });
  await asentar();
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.pos.colaDeltas.length, 1, 'el −1 queda en la cola, detrás del cobro');
  otraTablet(t, [MENU(2), SECO(1)]);
  conRed(t);
  await t.pos._subirLoPendiente();
  await hastaAviso(t, /promoción/);
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(40);
  const o = t.base.ordenes.get('o1');
  assert.equal(cerradas(t).length, 0, 'la venta fue rechazada');
  assert.equal(t.base.rpcs.length, 0, 'el −1 NO se mandó: la cuenta no se tocó');
  assert.equal(o.total, 61200, ver(o.items));
  assert.equal(unidades(o.items), 3);
  assert.equal(local(t).total, 61200, 'la tablet adoptó la cuenta de la base');
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('R1-d si la lectura de la base falla justo después del rechazo, la copia queda «sin confirmar» y NO se cobra (mesa completa, por partes, por persona, abono, precuenta) hasta que una lectura la reemplace', async () => {
  const t = await abrir([MENU(2), SECO(1)]);
  const copia = local(t);
  copia.items = [MENU(1), SECO(1)]; copia.total = 42000;
  t.base.fallar('select:ordenes');                                      // el rechazo llega, la relectura no
  t.pos.facturarParcial({ seco: 1 });
  await hastaAviso(t, /promoción/);
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(40);
  assert.equal(local(t).sinConfirmar, true, 'la copia local quedó marcada «sin confirmar»');
  assert.match(t.pos.motivoSinCobro, /sin confirmar/i);
  assert.equal(t.base.ordenes.get('o1').total, 61200, 'la base no se tocó');
  t.pos.avisar('');
  t.pos.facturar();
  assert.equal(local(t).estado, 'abierta', 'no se cobra la mesa completa con una copia sin confirmar');
  assert.match(t.pos.aviso.texto, /sin confirmar/i);
  t.pos.facturarParcial({ menu: 1 });
  assert.equal(t.pos.ordenes.filter((x) => x.estado === 'cerrada').length, 0, 'ni por partes');
  t.pos.montoAbono = '10000'; t.pos.seleccionCobro = true;
  assert.equal(t.pos.cobrarMonto(), false, 'ni un abono');
  await t.pos.pedirImpresion('precuenta');
  assert.equal(t.pos.confirmaImpresion, null, 'ni una precuenta');
  assert.equal(t.base.rpcs.length, 0);
  assert.equal(cerradas(t).length, 0);
  // una lectura de la base la reemplaza y se vuelve a poder cobrar
  t.base.repararTodo();
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  await asentar(20);
  assert.ok(!local(t).sinConfirmar, 'la lectura reemplazó la copia');
  assert.equal(local(t).total, 61200);
  assert.equal(t.pos.motivoSinCobro, '');
  t.pos.facturar();
  await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada');
  assert.equal(t.base.ordenes.get('o1').total, 61200);
});

test('R1-d2 una copia «sin confirmar» intenta leerse sola a los 3 s: si la base ya contesta, la lectura la reemplaza y se puede cobrar; si no, reprograma (6 intentos)', async () => {
  const t = await abrir([MENU(2), SECO(1)]);
  const copia = local(t);
  copia.items = [MENU(1), SECO(1)]; copia.total = 42000;
  t.base.fallar('select:ordenes');
  t.pos.facturarParcial({ seco: 1 });
  await hastaAviso(t, /promoción/);
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(40);
  assert.equal(local(t).sinConfirmar, true);
  const reintento = (ms) => t.timers.find((h) => h.ms === ms);
  assert.ok(reintento(3000), 'se programó el primer reintento a los 3 s');
  await reintento(3000).fn();                                           // la base sigue sin contestar la lectura: reprograma
  assert.ok(reintento(6000), 'segundo intento a los 6 s');
  assert.equal(local(t).sinConfirmar, true);
  t.base.repararTodo();
  await reintento(6000).fn();                                           // ahora sí lee
  await asentar(10);
  assert.ok(!local(t).sinConfirmar, 'la lectura reemplazó la copia: la marca se fue');
  assert.equal(local(t).total, 61200);
  assert.equal(t.pos.motivoSinCobro, '');
  const n = t.timers.length;
  await reintento(6000).fn();                                           // un reintento que llega tarde ya no hace nada
  assert.equal(t.timers.length, n, 'sin copia sin confirmar no se reprograma nada');
});

test('R1-e un abono que la base rechaza (la cuenta ya estaba en un cierre del día) NO manda su crédito: la cuenta de la base no se tocó y la tablet la adopta', async () => {
  const venta = { id: 'o1', mesa_id: 1, estado: 'cerrada', items: [SECO(2)], total: 38000, abierta_en: LUNES, cerrada_en: LUNES, version: 2 };
  const cierre = { id: 'k-viejo', fecha: '2026-10-04T23:00:00Z', total_ventas: 38000, total_ordenes: 1, transacciones: [venta] };
  const t = await abrir([SECO(2)], { cierres: [cierre] });
  t.pos.toggleModoCobroParcial();
  t.pos.montoAbono = '10000'; t.pos.metodoAbono = 'efectivo';
  assert.equal(t.pos.cobrarMonto(), true);
  await hastaAviso(t, /cierre del día/);
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(40);
  assert.equal(cerradas(t).length, 0, 'el abono no quedó registrado');
  assert.equal(t.base.rpcs.length, 0, 'el crédito «Abono recibido» nunca salió');
  assert.deepEqual(lineas(t.base.ordenes.get('o1')), ['secox2']);
  assert.deepEqual(lineas(local(t)), ['secox2'], 'la tablet adoptó la cuenta de la base: sin línea de abono');
  assert.equal(local(t).total, 38000);
});

test('R1-f el cobro ENTRA PRIMERO y las unidades salen detrás: la venta cerrada llega a la base antes que el −qty (en línea y con una cuenta sin promoción, como siempre)', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const n0 = t.supabase.llamadas.length;
  t.pos.facturarParcial({ seco: 1 });
  await hastaQue(() => t.base.rpcs.length === 1);
  await asentar(20);
  const orden = t.supabase.llamadas.slice(n0)
    .filter((c) => (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden') || (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert'))
    .map((c) => (c.tipo === 'rpc' ? `delta ${c.args.p_item_id} ${c.args.p_delta}` : `upsert ${c.cuerpo.estado} parcial_de=${c.cuerpo.parcial_de}`));
  assert.deepEqual(orden, ['upsert cerrada parcial_de=o1', 'delta seco -1'], 'primero el cobro, después lo que sale de la cuenta');
  const [venta] = cerradas(t);
  assert.equal(venta.total, 19000);
  assert.equal(venta.total + t.base.ordenes.get('o1').total, 2 * 19000 + 12000, 'la suma cobrada es la de la mesa');
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('R1-f2 mientras la base no contesta por el cobro, NINGÚN −qty sale (la venta tarda 150 ms: ni una llamada de delta hasta que responde); recién entonces sale', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  t.base.responder = async (c) => {
    if (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert' && c.cuerpo.parcial_de) await new Promise((r) => setTimeout(r, 150));
    return original(c);
  };
  t.pos.facturarParcial({ seco: 1 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, 0, 'con el cobro todavía sin respuesta no se ha llamado a ningún delta');
  assert.equal(t.base.rpcs.length, 0);
  await hastaQue(() => t.base.rpcs.length === 1);
  assert.equal(cerradas(t).length, 1, 'el cobro ya está en la base cuando sale el −qty');
  await asentar(20);
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('R1-i si la página se recarga con el cobro todavía sin respuesta, el −qty sigue en la cola (con su `tras`): al arrancar la fila sube primero y el −qty después, una sola vez', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  t.base.responder = async (c) => (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert' && c.cuerpo.parcial_de ? new Promise(() => {}) : original(c));   // la red se cuelga a media subida
  t.pos.facturarParcial({ seco: 1 });
  await asentar(30);
  assert.equal(t.pos.colaDeltas.length, 1, 'el −qty ya está en la cola persistida: una recarga no lo pierde');
  assert.ok(t.pos.colaDeltas[0].tras);
  assert.equal(cerradas(t).length, 0);
  // «recargar»: otro store con el mismo almacén (localStorage) y la base ya sana
  t.base.responder = original;
  const reales = { setTimeout, clearTimeout };
  const u = crearPos({
    base: t.base, almacen: t.almacen,
    extras: { setInterval() { return 1; }, clearInterval() {}, setTimeout(fn, ms, ...resto) { if (ms >= 1500) { const h = { fn, ms, unref() { return h; } }; return h; } return reales.setTimeout(fn, ms, ...resto); }, clearTimeout(h) { if (h && typeof h === 'object') return; reales.clearTimeout(h); } },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  u.pos.usuario = YO;
  await u.pos.arrancarApp();
  await hastaQue(() => u.pos.remoto === 'ok');
  await hastaQue(() => cerradas(t).length === 1 && t.base.rpcs.length === 1 && u.pos.colaDeltas.length === 0 && u.pos.cambiosSinSubir === 0);
  await asentar(30);
  const [venta] = cerradas(t);
  assert.ok(venta, 'la venta entró al arrancar');
  assert.equal(t.base.rpcs.length, 1, 'el −qty salió una sola vez');
  assert.equal(venta.total + t.base.ordenes.get('o1').total, 2 * 19000 + 12000, 'la suma cobrada es la de la mesa');
});

test('R1-j recargar con el −qty en la cola y la fila del cobro pendiente, y la base la rechaza por PERMISOS (42501) al reintentar: el −qty se suelta (no sale sin su cobro) y la cuenta es la de la base', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  sinRed(t);
  t.pos.facturarParcial({ seco: 1 });
  await asentar(20);
  assert.equal(t.pos.colaDeltas.length, 1);
  assert.ok(t.pos.colaDeltas[0].tras);
  // «recargar»: otro store con el mismo almacén; al volver la red, la base rechaza la fila del cobro por permisos
  conRed(t);
  const original = t.base.responder;
  t.base.responder = async (c) => (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert' && c.cuerpo.parcial_de
    ? { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "ordenes"' } } : original(c));
  const reales = { setTimeout, clearTimeout };
  const u = crearPos({
    base: t.base, almacen: t.almacen,
    extras: { setInterval() { return 1; }, clearInterval() {}, setTimeout(fn, ms, ...resto) { if (ms >= 1500) { const h = { fn, ms, unref() { return h; } }; return h; } return reales.setTimeout(fn, ms, ...resto); }, clearTimeout(h) { if (h && typeof h === 'object') return; reales.clearTimeout(h); } },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  u.pos.usuario = YO;
  await u.pos.arrancarApp();
  await hastaQue(() => u.pos.remoto === 'ok');
  await hastaQue(() => u.pos.colaDeltas.length === 0 && u.pos.cambiosSinSubir === 0);
  await asentar(40);
  assert.equal(t.base.rpcs.length, 0, 'el −qty no salió: su cobro no existe');
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.base.ordenes.get('o1').total, 2 * 19000 + 12000, 'la cuenta de la base está intacta');
  assert.equal(u.pos.ordenes.find((o) => o.id === 'o1').total, 2 * 19000 + 12000, 'y la tablet muestra esa cuenta');
});

test('R1-g sin red el −qty espera en la cola a la fila de su cobro: aunque vuelva la red y la fila siga sin entrar, flushDeltas no lo manda; cuando la fila entra, sale', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  sinRed(t);
  t.pos.facturarParcial({ seco: 1 });
  await asentar();
  assert.equal(t.pos.colaDeltas.length, 1);
  assert.ok(t.pos.colaDeltas[0].tras, 'el delta apunta a la fila del cobro que lo espera');
  conRed(t);
  t.base.fallar('upsert:ordenes');                                      // la fila del cobro no entra (500)
  await t.pos.flushDeltas();
  await t.pos._subirLoPendiente();
  await asentar(20);
  assert.equal(t.base.rpcs.length, 0, 'sin la fila del cobro en la base, el −qty no sale');
  assert.equal(t.pos.colaDeltas.length, 1);
  t.base.repararTodo();
  await t.pos._subirLoPendiente();
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  await asentar(20);
  const [venta] = cerradas(t);
  assert.ok(venta, 'la venta entró');
  assert.equal(t.base.rpcs.length, 1);
  assert.equal(venta.total + t.base.ordenes.get('o1').total, 2 * 19000 + 12000);
});

test('R1-h un cobro que la base rechaza por PERMISOS (42501) tampoco saca nada de la cuenta: sin −qty, y la cuenta vuelve a ser la de la base', async () => {
  const t = await abrir([SECO(2), JUGO(1)], { abiertaEn: MARTES });
  const original = t.base.responder;
  t.base.responder = async (c) => (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert' && c.cuerpo.parcial_de
    ? { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "ordenes"' } } : original(c));
  t.pos.facturarParcial({ seco: 1 });
  await asentar(60);
  await hastaQue(() => t.pos.colaDeltas.length === 0 && t.pos.cambiosSinSubir === 0);
  assert.equal(t.base.rpcs.length, 0, 'ningún −qty');
  assert.equal(t.base.ordenes.get('o1').total, 2 * 19000 + 12000);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'el cobro no quedó en la tablet');
});

// ═══════════════════ REGLA 2. Sin red no se cobra una cuenta con promoción ═══════════════════

test('R2-a sin red: 2 Seco, se suma un tercero y un comensal quiere pagar el suyo por partes → NO se cobra (la tablet sabe que 3 Seco el lunes son promo); no sale ninguna venta ni ningún −qty, y al volver la red la cuenta es la de la base', async () => {
  const t = await abrir([SECO(2)]);
  sinRed(t);
  t.pos.agregarProducto(producto(t, 'seco'));
  assert.equal(t.pos.cuentaConPromo, false, 'sin red la tablet no tiene la línea de promo…');
  assert.match(t.pos.motivoSinCobro, SIN_RED_PROMO, '…pero sabe por la regla del día y los ítems que la base la pondrá');
  t.pos.facturarParcial({ seco: 1 });
  assert.match(t.pos.aviso.texto, SIN_RED_PROMO);
  await asentar();
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'ninguna venta, ni local');
  assert.equal(t.pos.colaDeltas.length, 1, 'solo el +1 del tercer Seco: del cobro no salió nada');
  conRed(t);
  await t.pos._subirLoPendiente();
  await asentar(40);
  const o = t.base.ordenes.get('o1');
  assert.equal(o.total, 53200, ver(o.items));
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.base.rpcs.length, 1, 'solo el +1');
});

test('R2-b sin red y con promoción (la línea `promo:…` o la que la base pondría), NINGÚN cobro: mesa completa, por partes, por persona, abono y precuenta muestran «Sin red…» y no hacen nada', async () => {
  for (const items of [[SECO(2), { ...normalizar([SECO(3)])[1] }], [SECO(3)], [MENU(2), SECO(1)]]) {
    const t = await abrir(items);
    const abierta = local(t);
    sinRed(t);
    assert.match(t.pos.motivoSinCobro, SIN_RED_PROMO, ver(abierta.items));
    // mesa completa
    t.pos.avisar('');
    t.pos.facturar();
    assert.match(t.pos.aviso.texto, SIN_RED_PROMO);
    assert.equal(local(t).estado, 'abierta', 'facturar no cerró la cuenta');
    assert.equal(t.pos.vista, 'orden');
    // por partes (mapa y lista de ids)
    t.pos.avisar(''); t.pos.facturarParcial({ seco: 1 });
    assert.match(t.pos.aviso.texto, SIN_RED_PROMO);
    t.pos.avisar(''); t.pos.facturarParcial(['seco']);
    assert.match(t.pos.aviso.texto, SIN_RED_PROMO);
    // por persona
    t.pos.avisar('');
    t.pos.cobrarGrupoPersona('Persona 1');
    assert.match(t.pos.aviso.texto, SIN_RED_PROMO);
    // abono
    t.pos.avisar('');
    t.pos.seleccionCobro = true; t.pos.montoAbono = '10000';
    assert.equal(t.pos.cobrarMonto(), false);
    assert.match(t.pos.aviso.texto, SIN_RED_PROMO);
    // precuenta (de la cuenta y de una persona)
    t.pos.avisar('');
    assert.equal(await t.pos.pedirImpresion('precuenta'), false);
    assert.match(t.pos.aviso.texto, SIN_RED_PROMO);
    assert.equal(t.pos.confirmaImpresion, null);
    await asentar(10);
    assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'ninguna venta');
    assert.equal(t.pos.colaDeltas.length, 0, 'nada en la cola');
    assert.equal(t.pos.vista, 'orden');
    // con red, todo vuelve a su camino (la base decide)
    conRed(t);
    assert.equal(t.pos.motivoSinCobro, '');
  }
});

test('R2-c las cuentas SIN promoción se cobran sin red como siempre: otro día, productos que la regla no cubre, una promo apagada, pocas unidades y una cuenta que mezcla', async () => {
  // martes: la regla del lunes no aplica a una cuenta abierta un martes
  let t = await abrir([SECO(3)], { abiertaEn: MARTES });
  sinRed(t);
  assert.equal(t.pos.motivoSinCobro, '', '3 Seco un martes no son promo');
  t.pos.facturar();
  assert.equal(local(t).estado, 'cerrada', 'se cobra sin red');
  // lunes pero con productos que la regla no cubre (Sopa) y Jugo
  t = await abrir([{ id: 'sopa', nombre: 'Sopa', precio: 21000, qty: 3, nota: '' }, JUGO(3)]);
  sinRed(t);
  assert.equal(t.pos.motivoSinCobro, '', '3 Sopa el lunes no cuentan (decisión de Yonatan)');
  // dos unidades
  t = await abrir([MENU(1), SECO(1), JUGO(2)]);
  sinRed(t);
  assert.equal(t.pos.motivoSinCobro, '');
  t.pos.facturarParcial({ seco: 1 });
  await asentar();
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 1, 'por partes sin red y sin promo: se cobra');
  // la promo apagada
  const apagada = productosDelLunes().map((p) => (p.id === 'p-lun' ? { ...p, activo: false } : p));
  t = await abrir([SECO(3)], { productos: apagada, normalizador: (items) => items });   // (la base, con la promo apagada, no la aplica)
  sinRed(t);
  assert.equal(t.pos.motivoSinCobro, '', 'sin la regla activa no hay promo que esperar');
  // con red nada se bloquea
  t = await abrir([SECO(3)]);
  assert.equal(t.pos.motivoSinCobro, '');
});

test('R2-d el POS lo dice a la vista: la cuenta bloqueada muestra el aviso fijo y apaga «Generar ticket y cobrar» (estática)', () => {
  assert.match(POS_HTML, /const TEXTO_SIN_RED_PROMO = 'Sin red: esta cuenta tiene promoción; espera a que vuelva la red para cobrar\.';/);
  assert.match(POS_HTML, /id="aviso-sin-cobro"[^>]*x-show="\$store\.pos\.motivoSinCobro"/);
  assert.match(POS_HTML, /:disabled="!\$store\.pos\.ordenActiva \|\| !\$store\.pos\.hayLineas \|\| !!\$store\.pos\.motivoSinCobro"/);
});

// ═══════════════════ REGLA 3. La mesa completa se cobra con el total que la base REGISTRÓ ═══════════════════

test('R3-a en línea, copia atrasada: 3 Seco con su promo en la tablet, el mesero quita un Seco de la línea base y cobra antes del eco; la base registra 38.000 y el ticket dice 38.000 (no 34.200); la tablet avisa «La base recalculó»', async () => {
  const t = await abrir([SECO(3)]);
  const copia = local(t);
  assert.equal(total(copia.items), 53200, ver(copia.items));
  t.pos.quitarProducto(copia.items.find((i) => i.id === 'seco'));
  assert.equal(t.pos.totalOrdenActiva, 34200, 'la tablet lo mostraba así: Seco ×1 + «3er almuerzo»');
  t.pos.facturar();
  // al instante: el ticket está en pantalla, pero provisional y sin dejar imprimir hasta que la base conteste
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(local(t).provisional, true);
  assert.equal(local(t).confirmando, true);
  assert.equal(t.pos.ordenTicket.confirmando, true, 'el botón «Imprimir» se apaga mientras la base confirma (estática más abajo)');
  await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada' && !local(t).confirmando);
  await asentar(40);
  const b = t.base.ordenes.get('o1');
  assert.equal(b.total, 38000, ver(b.items));
  assert.equal(Number(local(t).total), 38000, 'la copia de la tablet es lo que la base registró');
  assert.equal(t.pos.ordenTicket.total, 38000, 'el ticket dice lo que la base registró');
  assert.equal(total(local(t).items), 38000);
  assert.ok(!local(t).provisional, 'confirmado: ya no es provisional');
  assert.match(t.pos.aviso.texto, /La base recalculó/);
  assert.match(t.pos.aviso.texto, /38\.000/);
  assert.match(t.pos.aviso.texto, /34\.200/);
  assert.equal(t.pos.totalPorCerrar, 38000, 'el cierre del día suma lo que la base registró');
  assert.equal(t.pos.ordenesHoy.reduce((s, o) => s + o.total, 0), 38000);
  if (t.pos.ultimoCobro) assert.equal(t.pos.ultimoCobro.monto, 38000, 'el «Cobrado $X · Deshacer» dice lo registrado');
});

test('R3-b si el total que la base registra es el que la tablet mostraba, no hay aviso: el ticket se confirma en silencio y se puede imprimir', async () => {
  const t = await abrir([SECO(3)]);
  t.pos.facturar();
  await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada' && !local(t).confirmando);
  await asentar(40);
  assert.equal(t.base.ordenes.get('o1').total, 53200);
  assert.equal(local(t).total, 53200);
  assert.ok(!local(t).provisional);
  assert.ok(!t.pos.aviso || !/recalcul/.test(t.pos.aviso.texto), 'ningún aviso de recálculo');
  assert.equal(t.pos.totalPorCerrar, 53200);
});

test('R3-c el eco de Realtime llega ANTES que la respuesta del cobro (la tablet ya muestra el total de la base): igual se avisa, porque se compara con lo que la tablet mandó', async () => {
  const t = await abrir([SECO(3)]);
  const copia = local(t);
  t.pos.quitarProducto(copia.items.find((i) => i.id === 'seco'));
  const original = t.base.responder;
  t.base.responder = async (c) => {
    const r = await original(c);
    if (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert' && c.cuerpo.estado === 'cerrada' && !c.cuerpo.parcial_de) {
      t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(t.base.ordenes.get('o1'))) });
    }
    return r;
  };
  t.pos.facturar();
  await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada' && t.pos.aviso && /recalcul/.test(t.pos.aviso.texto));
  await asentar(30);
  assert.match(t.pos.aviso.texto, /38\.000/);
  assert.equal(local(t).total, 38000);
  assert.ok(!local(t).provisional);
});

test('R3-d sin red (cuenta sin promoción) el ticket dice «PROVISIONAL»; al volver la red se confirma con el total registrado; si la base lo recalculó, el POS lo avisa y el ticket ya dice el nuevo', async () => {
  const t = await abrir([JUGO(2), SECO(1)], { abiertaEn: MARTES });
  sinRed(t);
  assert.equal(t.pos.motivoSinCobro, '');
  t.pos.facturar();
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(local(t).provisional, true, 'sin red el ticket es provisional');
  assert.notEqual(local(t).confirmando, true, 'sin red no se espera a nadie: se puede imprimir (el teléfono saca el papel)');
  const doc = t.pos.documentoTicket(t.pos.ordenTicket, 'ticket');
  assert.ok(doc.lineas.some((l) => /PROVISIONAL/.test(l.texto)), 'el papel dice PROVISIONAL');
  assert.equal(local(t).total, 43000);
  // la base va a recalcular distinto (un precio cambió mientras tanto)
  t.base.normalizar = (items) => items.map((i) => (i.id === 'seco' ? { ...i, precio: 20000 } : i));
  conRed(t);
  await t.pos._subirLoPendiente();
  await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada' && !local(t).provisional);
  await asentar(30);
  assert.equal(t.base.ordenes.get('o1').total, 44000);
  assert.equal(local(t).total, 44000);
  assert.equal(t.pos.ordenTicket.total, 44000);
  assert.match(t.pos.aviso.texto, /La base recalculó/);
  assert.match(t.pos.aviso.texto, /44\.000/);
  assert.match(t.pos.aviso.texto, /43\.000/);
  assert.match(t.pos.aviso.texto, /imprim/i, 'dice que hay que volver a imprimir');
  const doc2 = t.pos.documentoTicket(t.pos.ordenTicket, 'ticket');
  assert.ok(!doc2.lineas.some((l) => /PROVISIONAL/.test(l.texto)), 'confirmado: el papel ya no dice PROVISIONAL');
  assert.equal(t.pos.totalPorCerrar, 44000);
});

test('R3-d2 si el mesero ya salió del ticket cuando la base confirma sin red, el aviso trae «Ver ticket»: lo pone en pantalla con el total registrado, listo para volver a imprimir', async () => {
  const t = await abrir([JUGO(2), SECO(1)], { abiertaEn: MARTES });
  sinRed(t);
  t.pos.facturar();
  t.pos.volverDeTicket();                                               // ya volvió al salón
  assert.equal(t.pos.vista, 'mesas');
  t.base.normalizar = (items) => items.map((i) => (i.id === 'seco' ? { ...i, precio: 20000 } : i));
  conRed(t);
  await t.pos._subirLoPendiente();
  await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada' && !local(t).provisional);
  await asentar(30);
  assert.match(t.pos.aviso.texto, /La base recalculó/);
  assert.deepEqual({ vista: t.pos.aviso.accion.vista, etiqueta: t.pos.aviso.accion.etiqueta, ordenId: t.pos.aviso.accion.ordenId }, { vista: 'ticket', etiqueta: 'Ver ticket', ordenId: 'o1' });
  t.pos.irDesdeAviso();
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ordenTicket.id, 'o1');
  assert.equal(t.pos.ordenTicket.total, 44000, 'el ticket que se ve y se imprime ya dice lo que la base registró');
  assert.equal(t.pos.mesaActiva.id, 1);
  assert.equal(t.pos.aviso, null);
});

test('R3-e estática: el ticket muestra «PROVISIONAL» y «Imprimir» se apaga mientras la base confirma el cierre', () => {
  assert.match(POS_HTML, /x-show="\$store\.pos\.ordenTicket\?\.provisional && /);
  assert.match(POS_HTML, /\|\| !!\$store\.pos\.ordenTicket\?\.confirmando"/, 'booleano: Alpine toma un `undefined` de una expresión con punto por "" y dejaría el botón apagado para siempre');
});

// ═══════════════════ README ═══════════════════

test('README: la invariante «lo cobrado por una mesa no depende de cómo se parta», con sus salvedades (lectura al día; sin red no se cobra con promoción)', () => {
  const readme = fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8');
  assert.match(readme, /[Ll]o cobrado por una mesa no depende de cómo se parta/);
  assert.match(readme, /desde una lectura al día/);
  assert.match(readme, /[Ss]in red no se cobra una cuenta con promoción/);
});
