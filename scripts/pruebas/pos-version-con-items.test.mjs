// LA VERSIÓN LOCAL NUNCA SUBE SIN LOS ÍTEMS QUE LA ACOMPAÑAN, y «no llegó» no es definitivo mientras la petición pueda seguir en camino (sexta refutación, 2026-10-06; tareas/2026-10-04-hallazgos-domingo.md).
// El POS REAL (el <script> de pos.html en un `vm`) contra la base falsa de _pos-vm.mjs. Con supabase-js y Postgres reales, dos tablets: pos-otra-tablet-real.test.mjs.
//
// El defecto (r6, ALTO; ya estaba en producción): una tablet con la copia VIEJA de una cuenta hacía un gesto (asignar una persona, «para llevar», un +1). La respuesta de la base subía la `version` de la copia
// (`_anotarVersion`) y NADA más: la copia quedaba con la versión buena y los ítems viejos, la guardia RS003 de la mesa completa la dejaba pasar y la base registraba lo ya cobrado por otra tablet:
// 75.000 por una mesa de 62.000. Y el segundo (r6, MEDIO, regresión de la rama): la reconciliación daba un «no llegó» por definitivo mientras la petición del cobro podía seguir en camino.
//   V. La regla única en `_anotarRespuesta`: los mismos ítems → solo la versión; ítems distintos y nada propio en camino → la fila entera; otros cambios en camino, una versión sola, una cuenta que se
//      cierra → la versión NO se toca y la copia queda «desactualizada» (se relee). Y cada sitio que escribe `version` (el reabrir de «Deshacer», el cobro con cambios en camino).
//   G. El guion de la refutación en el vm (T1: otra tablet con la copia vieja, la mesa completa termina en 62.000).
//   L. El cobro de la mesa completa CON red relee la cuenta de la base justo antes de cerrar: igual / cambio (avisa, muestra el total nuevo y NO cierra) / ya no abierta / sin lectura; sin red, la versión local.
//   W. La espera de 30 s: un «no llegó» solo es definitivo con la petición asentada, 30 s después y con una segunda lectura sin la venta (T3/T4 de la refutación, en el vm).
//   S. Estática: ningún camino escribe `version` sin los ítems que la acompañan.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asentar, hastaQue, POS_HTML, SECO, JUGO, cerradas, local, enDuda, CLAVE, CONGELADA, montar, abrir, producto, marcar, otraTablet, envejecer, ahoraDe, YO,
} from './_pos-cobro-duda-vm.mjs';

const clon = (x) => JSON.parse(JSON.stringify(x));
const filaDeBase = (t, id = 'o1') => clon(t.base.ordenes.get(id));
const hijo = (t, nombre) => t.supabase.llamadas.filter((c) => c.tipo === 'rpc' && c.nombre === nombre).length;
const upserts = (t) => t.supabase.de('ordenes', 'upsert');
const sumaVentas = (t) => cerradas(t).reduce((s, o) => s + Number(o.total), 0);
const lineas = (t, id = 'o1') => local(t, id).items.map((i) => `${i.qty}x${i.id}@${i.precio}`).sort();
const lineasDe = (t, id = 'o1') => lineas(t, id);
const lineasBase = (t, id = 'o1') => t.base.ordenes.get(id).items.map((i) => `${i.qty}x${i.id}@${i.precio}`).sort();
/** Otra tablet sobre la MISMA base (su propio almacén local, como un aparato distinto). Sin Realtime: no se entera de nada que no lea. */
async function segundaTablet(t, { mesa = 1 } = {}) {
  const b = montar({ base: t.base, almacen: new Map() });
  await b.pos.arrancarApp();
  await hastaQue(() => b.pos.remoto === 'ok');
  await asentar();
  await b.pos.abrirMesa(b.pos.mesas.find((m) => m.id === mesa));
  return b;
}
/** Un cobro por partes de 1 Jugo que la base APLICA (la tablet que lo hizo recibe su respuesta: nada en duda). */
async function cobrarUnJugo(t) {
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), true, 'la base cobró');
  assert.equal(cerradas(t).length >= 1, true);
}
/** Un cobro por partes de 1 Jugo cuya petición NO llega a la base (sin red) pero sí queda «enviado»: la cuenta queda congelada y la petición «sigue en camino». Devuelve la llamada, para soltarla después. */
async function cobroEnCamino(t) {
  t.base.red = false;
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  t.base.red = true;
  assert.equal(t.pos._cuentaCongelada('o1'), true, 'congelada');
  assert.equal(cerradas(t).length, 0, 'la base todavía no tiene el cobro');
  return t.supabase.llamadas.filter((c) => c.tipo === 'rpc' && c.nombre === 'cobrar_parcial').at(-1);
}
/** La petición que iba en camino llega por fin a la base y el cobro entra. */
const llegaLaPeticion = async (t, llamada) => { const r = await t.base.responder({ ...llamada }); assert.equal(r.data && r.data.ok, true, 'el cobro entró'); };

// ═══════════════════ V. La regla única ═══════════════════

test('V1 los MISMOS ítems: la respuesta de un cambio solo sube la versión (el objeto y sus ítems no se reemplazan) y no deja la copia «desactualizada»', async () => {
  const t = await abrir();
  t.base.notasConFila = true;
  const objeto = local(t), items = objeto.items;
  t.pos.ciclarPagador(local(t).items.find((i) => i.id === 'seco'));
  await asentar(20);
  assert.equal(hijo(t, 'actualizar_nota_item'), 1);
  assert.equal(local(t).version, t.base.ordenes.get('o1').version, 'la versión local es la de la base');
  assert.equal(local(t), objeto, 'el mismo objeto');
  assert.equal(local(t).items, items, 'los mismos ítems: no se reemplazaron');
  assert.equal(local(t).desactualizada, undefined);
});

test('V2 ítems DISTINTOS y nada propio en camino: se adopta la FILA ENTERA (ítems, total y versión) en el mismo objeto — la copia vieja ya no sube de versión con lo ya cobrado', async () => {
  const t = await abrir();
  t.base.notasConFila = true;
  const objeto = local(t);
  otraTablet(t, [SECO(2), JUGO(1)]);                                   // otra tablet cobró un Jugo y esta no se enteró (sin Realtime)
  assert.deepEqual(lineas(t), ['2x%s@19000'.replace('%s', 'seco'), '2xjugo@12000'].sort());
  t.pos.ciclarPagador(local(t).items.find((i) => i.id === 'seco'));
  await asentar(20);
  const base = t.base.ordenes.get('o1');
  assert.equal(local(t), objeto, 'el mismo objeto (la pantalla y ordenActiva lo siguen)');
  assert.equal(local(t).version, base.version);
  assert.deepEqual(lineas(t), lineasBase(t), 'los ítems son los de la base: ya sin el Jugo cobrado');
  assert.equal(local(t).total, base.total);
  assert.equal(local(t).items.find((i) => i.id === 'jugo').qty, 1);
  assert.match(local(t).items.find((i) => i.id === 'seco').nota, /Persona 1/, 'y la persona quedó asignada');
  assert.equal(local(t).desactualizada, undefined);
});

test('V3 con OTRO cambio propio en vuelo la respuesta NO sube la versión (ni adopta lo de la base): la copia queda «desactualizada» y la respuesta que cierra el vuelo la deja al día, lleguen en orden o al revés', async () => {
  for (const alReves of [false, true]) {
    const t = await abrir();
    const original = t.base.responder;
    const retenidas = [];
    // la base APLICA cada delta al llegar, pero su respuesta se retiene hasta que la prueba la suelta (cada una es la foto de la cuenta al aplicarse)
    t.base.responder = async (c) => { const r = await original(c); if (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden') return new Promise((res) => retenidas.push(() => res(r))); return r; };
    const jugo = () => local(t).items.find((i) => i.id === 'jugo');
    const v0 = local(t).version;
    t.pos.incrementarItem(jugo());
    await hastaQue(() => retenidas.length === 1);
    otraTablet(t, [SECO(1), JUGO(3)]);                                   // entre uno y otro, otra tablet cobró un Seco (su versión también cuenta)
    t.pos.incrementarItem(jugo());
    await hastaQue(() => retenidas.length === 2);
    assert.equal(t.base.ordenes.get('o1').version, v0 + 3, 'la base ya aplicó los tres cambios');
    const [primera, segunda] = retenidas;
    (alReves ? segunda : primera)();
    await asentar(20);
    assert.equal(local(t).version, v0, 'con el otro cambio todavía en vuelo la versión de la copia NO sube');
    assert.equal(local(t).desactualizada, true);
    assert.equal(local(t).items.find((i) => i.id === 'seco').qty, 2, 'y los ítems de aquí siguen siendo los de aquí (todavía no son los de esa versión)');
    (alReves ? primera : segunda)();
    await hastaQue(() => local(t).version === v0 + 3 && !local(t).desactualizada);
    assert.equal(local(t).version, v0 + 3, `${alReves ? 'al revés' : 'en orden'}: al cerrar el vuelo la copia queda con la versión de la base`);
    assert.deepEqual(lineas(t), lineasBase(t), 'y con sus ítems: ya sin el Seco que cobró la otra tablet');
    assert.equal(jugo().qty, 4);
  }
});

test('V4 una versión SOLA (sin los ítems): la versión de la copia NO se toca, la copia queda «desactualizada» y se relee: versión e ítems salen juntos de la lectura', async () => {
  const t = await abrir();
  otraTablet(t, [SECO(2), JUGO(1)]);
  const v = local(t).version;
  t.pos._anotarRespuesta('o1', { version: v + 1 });
  assert.equal(local(t).version, v, 'no se toca');
  assert.equal(local(t).desactualizada, true);
  await hastaQue(() => !local(t) || !local(t).desactualizada);
  assert.equal(local(t).version, t.base.ordenes.get('o1').version, 'la lectura trajo la versión de la base');
  assert.deepEqual(lineas(t), lineasBase(t), 'con sus ítems');
});

test('V5 una cuenta que ya no está abierta aquí (se está cerrando) con ítems distintos: la versión no se toca (la fila cerrada que sube es la que la tablet mostró; RS003 es la guardia)', async () => {
  const t = await abrir();
  const v = local(t).version;
  local(t).estado = 'cerrada';
  const fila = { ...filaDeBase(t), version: v + 1, items: [{ id: 'seco', nombre: 'Seco', precio: 19000, qty: 1, nota: '' }] };
  t.pos._anotarRespuesta('o1', fila);
  assert.equal(local(t).version, v);
  assert.equal(local(t).items.length, 2, 'los ítems mostrados siguen: no se reescribe lo que ya salió en el ticket');
  assert.equal(local(t).desactualizada, true);
  // con los MISMOS ítems sí sube: la versión viaja con ellos (el cierre de la tablet pasa su propia guardia)
  t.pos._anotarRespuesta('o1', { ...filaDeBase(t), version: v + 2 });
  assert.equal(local(t).version, v + 2);
});

test('V6 el cobro adoptado con cambios propios en camino NO sube la versión de la copia (sus ítems no traen lo que otra tablet hizo): queda «desactualizada»', async () => {
  const t = await abrir();
  const v = local(t).version;
  const enVuelo = new Promise(() => {});
  t.pos._registrarEnVuelo('o1', enVuelo);                              // un cambio propio de la cuenta todavía en camino
  const venta = { id: 'venta-x', mesa_id: 1, estado: 'cerrada', items: [{ id: 'jugo', nombre: 'Jugo', precio: 12000, qty: 1, nota: '' }], total: 12000, parcial_de: 'o1', version: 0, abierta_en: new Date().toISOString(), cerrada_en: new Date().toISOString() };
  const cuenta = { ...filaDeBase(t), version: v + 4, items: [{ id: 'seco', nombre: 'Seco', precio: 19000, qty: 2, nota: '' }, { id: 'jugo', nombre: 'Jugo', precio: 12000, qty: 1, nota: '' }], total: 50000 };
  t.pos._adoptarCobroDeLaBase({ resp: { venta, cuenta }, cuenta: local(t), tipo: 'parcial', persona: '', metodo: '', esperado: 12000, mostrar: false });
  assert.equal(local(t).version, v, 'la versión no sube con ítems que no son los de esa versión');
  assert.equal(local(t).desactualizada, true);
});

test('V7 «Deshacer» una mesa completa: la copia reabierta NO toma la versión de la respuesta (no trae los ítems); sale de la lectura, y si la lectura falla queda «desactualizada» hasta que una salga', async () => {
  const t = await abrir({ rol: 'admin' });
  t.pos.facturar();
  await hastaQue(() => local(t).estado === 'cerrada' && t.base.ordenes.get('o1').estado === 'cerrada');
  await asentar(20);
  const vCerrada = local(t).version;
  assert.equal(t.pos.puede('deshacer_cobro'), true);
  t.base.fallar('select:ordenes');                                     // la lectura que sigue al deshacer falla
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar(20);
  assert.equal(local(t).estado, 'abierta', 'la mesa se reabrió');
  assert.ok(t.base.ordenes.get('o1').version > vCerrada, 'la base subió la versión al reabrir');
  assert.equal(local(t).version, vCerrada, 'la copia NO tomó la versión de la respuesta: no trae los ítems');
  assert.equal(local(t).desactualizada, true);
  t.base.repararTodo();
  const reintento = await hastaQue(() => t.timers.some((x) => x.ms === 3000 && !x.cancelado));
  assert.equal(reintento, true, 'la relectura se reprograma (a los 3 s)');
  await t.timers.find((x) => x.ms === 3000 && !x.cancelado).fn();
  await hastaQue(() => !local(t).desactualizada);
  assert.equal(local(t).version, t.base.ordenes.get('o1').version, 'la lectura trajo versión e ítems juntos');
});

// ═══════════════════ G. El guion de la refutación en el vm ═══════════════════

test('G1 (T1) otra tablet con la copia vieja: A cobra por partes 1 Jugo; B asigna una persona y cobra la mesa completa → la base registra 62.000, no 74.000', async () => {
  const A = await abrir();
  A.base.notasConFila = true;
  const B = await segundaTablet(A);
  await cobrarUnJugo(A);                                               // la base: venta de 12.000 y la cuenta con 1 Jugo; B no lo sabe
  assert.deepEqual(lineas(B), ['2xjugo@12000', '2xseco@19000'], 'B tiene la copia vieja');
  B.pos.ciclarPagador(local(B).items.find((i) => i.id === 'seco'));
  await asentar(30);
  assert.equal(local(B).version, A.base.ordenes.get('o1').version, 'B quedó con la versión de la base…');
  assert.deepEqual(lineas(B), lineasBase(A), '…y con los ítems de esa versión: sin el Jugo que A ya cobró');
  B.pos.facturar();
  await hastaQue(() => A.base.ordenes.get('o1').estado === 'cerrada');
  await asentar(30);
  assert.equal(sumaVentas(A), 62000, `la base registró ${sumaVentas(A)} por una mesa de 62.000`);
  assert.deepEqual(B.avisos, [], 'sin alertas raras');
});

test('G2 (T2) B no hace NINGÚN gesto: solo toca «Sí, cobrar» con la copia vieja → relee, avisa del total nuevo y NO cierra; al confirmar de nuevo cierra con 50.000 y la base suma 62.000', async () => {
  const A = await abrir();
  const B = await segundaTablet(A);
  await cobrarUnJugo(A);
  assert.equal(B.pos.totalOrdenActiva, 62000, 'B todavía ve 62.000');
  B.pos.modalConfirmFactura = true;
  B.pos.facturar();
  await asentar(30);
  assert.equal(upserts(B).length, 0, 'no cerró: lo que la pantalla mostraba no era lo de la base');
  assert.equal(local(B).estado, 'abierta');
  assert.equal(B.pos.totalOrdenActiva, 50000, 'ahora se ve lo de la base');
  assert.equal(B.pos.modalConfirmFactura, true, 'el diálogo sigue abierto, con el total nuevo');
  assert.match(B.pos.aviso.texto, /\$ 50\.000/);
  assert.match(B.pos.aviso.texto, /\$ 62\.000/, 'y dice lo que decía la pantalla');
  assert.match(B.pos.aviso.texto, /otra vez/);
  B.pos.facturar();
  await hastaQue(() => A.base.ordenes.get('o1').estado === 'cerrada');
  await asentar(30);
  assert.equal(sumaVentas(A), 62000);
  assert.equal(B.pos.vista, 'ticket');
});

// ═══════════════════ L. El cobro de la mesa completa relee la cuenta ═══════════════════

test('L1 la pantalla es lo que la base tiene: lee una vez, toma la versión de la base y cierra con ella (la fila que sube lleva esa versión)', async () => {
  const t = await abrir();
  const vBase = t.base.ordenes.get('o1').version;
  const leidas = () => t.supabase.de('ordenes', 'select').filter((c) => c.filtros.length === 1 && c.filtros[0][0] === 'id' && c.filtros[0][1] === 'o1').length;
  t.pos.facturar();
  await hastaQue(() => upserts(t).length === 1);
  assert.equal(leidas(), 1, 'una lectura de la cuenta antes de cerrar');
  assert.ok(t.supabase.llamadas.indexOf(t.supabase.de('ordenes', 'select').find((c) => c.filtros.length === 1)) < t.supabase.llamadas.indexOf(upserts(t)[0]), 'y antes del cierre');
  assert.equal(upserts(t)[0].cuerpo.version, vBase, 'la fila de cierre lleva la versión de la base');
  await asentar(30);
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(t.pos.releyendoCobro, false);
});

test('L2 la copia local con la versión ATRASADA pero los mismos ítems (un +1 anotado a medias): la lectura la deja con la versión de la base y cierra sin RS003', async () => {
  const t = await abrir();
  local(t).version = 1;                                                // atrasada (la base va en 3) y con los ítems que la base tiene
  t.pos.facturar();
  await hastaQue(() => upserts(t).length === 1);
  assert.equal(upserts(t)[0].cuerpo.version, 3, 'cierra con la versión que de verdad corresponde a esos ítems');
  await asentar(30);
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
});

test('L3 la base ya no tiene la cuenta abierta (otra tablet la cobró entera): no cierra nada, lo dice y relee', async () => {
  const t = await abrir();
  const o = t.base.ordenes.get('o1');
  o.estado = 'cerrada'; o.cerrada_en = new Date().toISOString();
  t.pos.modalConfirmFactura = true;
  t.pos.facturar();
  await asentar(40);
  assert.equal(upserts(t).length, 0, 'ni un cierre');
  assert.equal(t.pos.modalConfirmFactura, false);
  assert.match(t.pos.aviso.texto, /ya no está abierta en la base/);
  assert.match(t.pos.aviso.texto, /no se cobró nada/);
});

test('L4 la red está caída aunque `remoto` diga «en línea» (Wi-Fi sin internet): no se pudo leer → una cuenta sin promoción se cierra con lo de aquí, PROVISIONAL y marcada sin red; con promoción NO se cobra', async () => {
  const t = await abrir();
  t.base.red = false;
  t.pos.facturar();
  await hastaQue(() => local(t).estado === 'cerrada');
  assert.equal(local(t).provisional, true, 'el ticket sale PROVISIONAL');
  assert.equal(local(t).cobradaSinRed, true);
  assert.equal(t.pos.remoto, 'offline', 'la lectura que falló marcó «sin red»');
  // con promoción: no se cobra sin la base
  const u = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3)], version: 3, crudo: true, abiertaEn: '2026-10-04T23:30:00Z' }], reloj: '2026-10-05T18:00:00Z' });
  u.base.red = false;
  u.pos.facturar();
  await asentar(40);
  assert.equal(local(u).estado, 'abierta');
  assert.match(u.pos.aviso.texto, /esta cuenta tiene promoción/);
});

test('L5 SIN red (`remoto` offline): no hay con qué leer; se cierra al instante con la versión que corresponde a los ítems locales (la guardia RS003 es la base)', async () => {
  const t = await abrir();
  t.pos.remoto = 'offline';
  const antes = t.supabase.llamadas.length;
  t.pos.facturar();
  assert.equal(local(t).estado, 'cerrada', 'sincrónico: sin lectura');
  assert.equal(t.supabase.de('ordenes', 'select').filter((c) => c.filtros.length === 1).length, 0, 'sin lecturas de la cuenta');
  assert.ok(antes <= t.supabase.llamadas.length);
  assert.equal(local(t).cobradaSinRed, true);
});

test('L6 un cambio de la cuenta que todavía va en camino llega ANTES de la lectura (si no, todo «cambió»): +1 en vuelo → «Sí, cobrar» → una sola cuenta, sin aviso de cambio', async () => {
  const t = await abrir();
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden' ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));
  t.pos.incrementarItem(local(t).items.find((i) => i.id === 'jugo'));
  await hastaQue(() => !!soltar);
  t.pos.facturar();
  await asentar(10);
  assert.equal(upserts(t).length, 0, 'espera al delta en vuelo');
  soltar();
  await hastaQue(() => upserts(t).length === 1);
  await asentar(30);
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(t.base.ordenes.get('o1').total, 2 * 19000 + 3 * 12000, 'con el Jugo de más');
  assert.doesNotMatch((t.pos.aviso && t.pos.aviso.texto) || '', /cambió en la base/);
});

test('L7 «Cancelar» mientras la tablet lee la cuenta: no se cobra nada (el diálogo se cerró) y el botón vuelve a quedar libre', async () => {
  const t = await abrir();
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'select' && c.filtros.length === 1 && c.filtros[0][1] === 'o1' ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));
  t.pos.modalConfirmFactura = true;
  t.pos.facturar();
  await hastaQue(() => !!soltar);
  assert.equal(t.pos.releyendoCobro, true, 'comprobando con la base (el botón lo dice y se apaga)');
  t.pos.facturar();                                                    // un segundo toque no lee dos veces
  t.pos.modalConfirmFactura = false;                                   // «Cancelar»
  soltar();
  await asentar(40);
  assert.equal(upserts(t).length, 0, 'no cerró: el diálogo ya no estaba abierto');
  assert.equal(local(t).estado, 'abierta');
  assert.equal(t.pos.releyendoCobro, false);
  assert.equal(t.supabase.de('ordenes', 'select').filter((c) => c.filtros.length === 1 && c.filtros[0][1] === 'o1').length, 1, 'y se leyó una sola vez');
});

// ═══════════════════ W. La espera de 30 s antes de dar un «no llegó» por definitivo ═══════════════════

test('W1 (T3/T4) el cobro está en camino: «no llegó» NO descongela antes de tiempo; la petición llega y la siguiente pregunta ADOPTA la venta; el gesto y la mesa completa suman 62.000', async () => {
  const A = await abrir();
  A.base.notasConFila = true;
  const llamada = await cobroEnCamino(A);
  assert.equal(await A.pos.reintentarCobroEnDuda(), 'en_espera', 'la base todavía no lo tiene, pero la petición puede seguir en camino');
  assert.equal(A.pos._cuentaCongelada('o1'), true);
  assert.match(A.pos.aviso.texto, /la petición puede seguir en camino/);
  await A.pos._reconciliarCobrosEnDuda();                               // y la reconciliación silenciosa tampoco la suelta
  assert.equal(A.pos._cuentaCongelada('o1'), true);
  await llegaLaPeticion(A, llamada);
  assert.equal(await A.pos.reintentarCobroEnDuda(), 'aplicado', 'ahora la venta existe: se adopta');
  assert.equal(A.pos._cuentaCongelada('o1'), false);
  assert.deepEqual(lineas(A), lineasBase(A), 'con la cuenta de la base (sin el Jugo cobrado)');
  A.pos.ciclarPagador(local(A).items.find((i) => i.id === 'seco'));
  await asentar(30);
  A.pos.facturar();
  await hastaQue(() => A.base.ordenes.get('o1').estado === 'cerrada');
  await asentar(30);
  assert.equal(sumaVentas(A), 62000, `la base registró ${sumaVentas(A)} por una mesa de 62.000`);
});

test('W2 pasados 30 s desde que la petición se asentó y con DOS lecturas sin la venta: recién entonces es «sin rastro» (relee la cuenta y descongela)', async () => {
  const t = await abrir();
  await cobroEnCamino(t);
  const lecturas = () => t.supabase.de('ordenes', 'select').filter((c) => c.filtros.some((f) => f[0] === 'parcial_de')).length;
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'en_espera');
  assert.equal(lecturas(), 1, 'antes de los 30 s: una lectura y nada más');
  envejecer(t, 29000);
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'en_espera', 'a los 29 s todavía no');
  envejecer(t, 31000);
  const antes = lecturas();
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'sin_rastro');
  assert.equal(lecturas() - antes, 2, 'con la espera cumplida, DOS lecturas por id');
  assert.equal(t.pos._cuentaCongelada('o1'), false);
  assert.equal(t.almacen.has(CLAVE), false);
});

test('W3 la venta aparece ENTRE la primera y la segunda lectura (pasados los 30 s): se adopta — una sola lectura la habría dado por «no llegó» y soltado', async () => {
  const t = await abrir();
  const llamada = await cobroEnCamino(t);
  envejecer(t, 31000);
  const original = t.base.responder;
  let n = 0;
  t.base.responder = async (c) => {
    const r = await original(c);
    if (c.tipo === 'from' && c.tabla === 'ordenes' && c.filtros.some((f) => f[0] === 'parcial_de') && ++n === 1) await llegaLaPeticion(t, llamada);   // la base termina el cobro justo después de la primera lectura
    return r;
  };
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado');
  assert.equal(n >= 2, true, 'hubo una segunda lectura');
  assert.equal(cerradas(t).length, 1);
  assert.deepEqual(lineas(t), lineasBase(t), 'la copia es la cuenta de la base, ya sin el Jugo');
  assert.equal(t.pos._cuentaCongelada('o1'), false);
});

test('W4 el tope de 10 s con la petición colgada: la petición se asienta al abortarse (asentadoEn), y a partir de ahí corren los 30 s; la cuenta no se suelta antes', async () => {
  const t = await abrir();
  const original = t.base.responder;
  let retenida = null;
  t.base.responder = (c) => (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial' ? new Promise((r) => { retenida = () => r(original(c)); }) : original(c));
  marcar(t, { jugo: 1 });
  const cobro = t.pos.facturarParcial();
  await hastaQue(() => !!retenida);
  const i = t.pos.cobrosEnDuda.o1;
  assert.equal(i.enviado, true);
  assert.equal(i.asentadoEn, undefined, 'la petición sigue en camino: no se asentó');
  assert.equal(t.pos._esperaDeCobroTardio(i), 30000, 'en camino: la espera ni empieza a correr');
  assert.equal(t.pos.cobrosEnDuda.o1.asentadoEn, undefined, 'y preguntar no la «asienta»');
  await t.timer(10000).fn();                                            // el tope de 10 s
  assert.equal(await cobro, false);
  const asentado = t.pos.cobrosEnDuda.o1.asentadoEn;
  assert.ok(asentado > 0 && Math.abs(asentado - ahoraDe(t)) < 5000, 'asentada al vencer el tope');
  assert.equal(JSON.parse(t.almacen.get(CLAVE)).o1.asentadoEn, asentado, 'y guardada (sobrevive a una recarga)');
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'en_espera');
  retenida();                                                           // la petición colgada termina en la base
  await asentar(20);
  assert.equal(cerradas(t).length, 1, 'el cobro entró DESPUÉS del tope');
  // la pregunta siguiente (la de «Reintentar ahora» o la reconciliación que la lectura de la red dispara sola) ADOPTA la venta
  await hastaQue(() => !t.pos._cuentaCongelada('o1'));
  assert.equal(t.pos._cuentaCongelada('o1'), false);
  assert.deepEqual(lineas(t), lineasBase(t), 'con la cuenta de la base, ya sin el Jugo');
  assert.match(t.pos.aviso.texto, /SÍ quedó registrado en la base/);
});

test('W5 una RECARGA con el cobro enviado: la página nueva lo asienta al arrancar (la petición murió con la anterior) y respeta 30 s desde ahí; si ya traía su hora, la conserva', async () => {
  const A = await abrir();
  const llamada = await cobroEnCamino(A);
  const intento = JSON.parse(A.almacen.get(CLAVE)).o1;
  assert.ok(intento.asentadoEn > 0, 'asentada por el fallo de red');
  // la página anterior murió con la petición en vuelo: el intento quedó SIN hora de asentamiento
  const guardado = JSON.parse(A.almacen.get(CLAVE));
  delete guardado.o1.asentadoEn;
  const almacen = new Map([...A.almacen, [CLAVE, JSON.stringify(guardado)]]);
  const antes = ahoraDe(A);
  const B = montar({ base: A.base, almacen });
  await B.pos.arrancarApp();
  await hastaQue(() => B.pos.remoto === 'ok');
  await asentar(30);
  assert.ok(B.pos.cobrosEnDuda.o1.asentadoEn >= antes - 1000, 'asentada al arrancar la página nueva');
  assert.equal(B.pos._cuentaCongelada('o1'), true, 'congelada tras recargar');
  assert.equal(await B.pos.reintentarCobroEnDuda('o1'), 'en_espera', 'la reconciliación del arranque tampoco la soltó');
  await llegaLaPeticion(B, llamada);                                    // la petición que quedó en camino termina
  assert.equal(await B.pos.reintentarCobroEnDuda('o1'), 'aplicado');
  assert.deepEqual(lineasDe(B), lineasBase(B), 'adoptó la cuenta de la base');
  // si el intento ya traía la hora en que se asentó (otra página lo anotó), se conserva: no se vuelve a empezar
  const C = await abrir();
  await cobroEnCamino(C);
  const g2 = JSON.parse(C.almacen.get(CLAVE)); g2.o1.asentadoEn = ahoraDe(C) - 120000;
  const D = montar({ base: C.base, almacen: new Map([...C.almacen, [CLAVE, JSON.stringify(g2)]]) });
  await D.pos.arrancarApp();
  await hastaQue(() => D.pos.remoto === 'ok');
  assert.equal(D.pos.cobrosEnDuda.o1.asentadoEn, g2.o1.asentadoEn, 'la conserva');
});

test('W7 una hora de asentamiento del FUTURO (el reloj del aparato se atrasó) no deja la cuenta congelada para siempre: se vuelve a anotar ahora y corren los 30 s', async () => {
  const t = await abrir();
  await cobroEnCamino(t);
  const futuro = ahoraDe(t) + 3600000;
  t.pos._guardarCobroEnDuda({ ...t.pos.cobrosEnDuda.o1, asentadoEn: futuro });
  const espera = t.pos._esperaDeCobroTardio(t.pos.cobrosEnDuda.o1);
  assert.ok(espera > 0 && espera <= 30000, `corre a lo sumo la espera completa: ${espera}`);
  assert.ok(t.pos.cobrosEnDuda.o1.asentadoEn <= ahoraDe(t) + 1000, 'la hora corregida se guardó');
  envejecer(t, 31000);
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'sin_rastro', 'y pasados los 30 s se suelta');
});

test('W8 el velo se quita SOLO (la reconciliación silenciosa, pasados los 30 s y con dos lecturas sin la venta): la pantalla no salta, pero un aviso dice por qué', async () => {
  const t = await abrir();
  await cobroEnCamino(t);
  t.pos.aviso = null;
  await t.pos._reconciliarCobrosEnDuda();
  assert.equal(t.pos._cuentaCongelada('o1'), true, 'a los pocos segundos sigue congelada');
  assert.equal(t.pos.aviso, null, 'y sin avisos nuevos: no cambia nada');
  envejecer(t, 31000);
  await t.pos._reconciliarCobrosEnDuda();
  assert.equal(t.pos._cuentaCongelada('o1'), false);
  assert.equal(t.pos.vista, 'orden', 'la pantalla no saltó');
  assert.match(t.pos.aviso.texto, /El cobro no llegó a la base/);
});

test('W6 un intento enviado sin hora (de una versión anterior) y SIN llamada en camino: la primera pregunta lo asienta y corre la espera completa', async () => {
  const t = await abrir();
  await cobroEnCamino(t);
  const sin = { ...t.pos.cobrosEnDuda.o1 }; delete sin.asentadoEn;
  t.pos.cobrosEnDuda = { o1: sin };
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'en_espera');
  assert.ok(t.pos.cobrosEnDuda.o1.asentadoEn > 0);
});

// ═══════════════════ S. Estática ═══════════════════

/** El texto de un método del store (de su firma, a 12 espacios, hasta la del siguiente). */
const cuerpo = (nombre) => {
  const i = POS_HTML.search(new RegExp(`^ {12}(?:async\\s+)?${nombre}\\(`, 'm'));
  assert.ok(i !== -1, `no encontré ${nombre} en pos.html`);
  const j = POS_HTML.slice(i + 1).search(/^ {12}(?:async\s+|get\s+)?[A-Za-z_$][\w$]*\(.*\) \{$/m);
  return POS_HTML.slice(i, j === -1 ? undefined : i + 1 + j);
};
const metodos = () => {
  const re = /^ {12}(?:async\s+)?([A-Za-z_$][\w$]*)\(([^)]*)\) \{$/gm;
  const lista = [];
  let m;
  while ((m = re.exec(POS_HTML))) lista.push({ nombre: m[1], desde: m.index });
  return lista.map((x, i) => ({ nombre: x.nombre, texto: POS_HTML.slice(x.desde, i + 1 < lista.length ? lista[i + 1].desde : x.desde + 20000) }));
};
const sinComentarios = (t) => t.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// Los únicos sitios que escriben `version` en una copia local de una cuenta, y por qué es seguro: cada uno trae los ítems que la acompañan o lo demuestra antes.
const ESCRIBEN_VERSION = {
  _anotarRespuesta: { prueba: /if \(this\._mismosItems\(local\.items, fila\.items\)\) \{\s*local\.version = v;/, texto: 'solo sube la versión si los ítems de la copia YA son los de la fila' },
  _adoptarFilaDeCambio: { prueba: /local\.items = leida\.items; local\.total = leida\.total; local\.version = leida\.version;/, texto: 'adopta ítems, total y versión juntos' },
  _leerCuentaParaCobrar: { prueba: /if \(this\._mismosItems\(local\.items, leida\.items\)\) \{\s*local\.version = leida\.version;/, texto: 'solo toma la versión leída si los ítems son los mismos; si no, adopta la fila entera' },
  _cierreConfirmado: { prueba: /actual\.items = fila\.items;/, texto: 'adopta los ítems de la fila que la base registró, y después la versión' },
  formatOrden: { prueba: /fila\.version = o\.version \?\? 0;/, texto: 'es la fila que SUBE a la base (la versión que la copia vio, para que la guardia RS003 juzgue): no escribe ninguna copia local' },
};

test('S1 estática (completitud): TODO camino que escribe `version` en una copia local lo hace con los ítems que la acompañan — uno nuevo que no lo demuestre rompe esta prueba', () => {
  const escritores = metodos().filter((m) => /(?:^|[^.\w$])[A-Za-z_$][\w$]*\.version\s*=(?!=)/.test(sinComentarios(m.texto))).map((m) => m.nombre);
  assert.ok(escritores.length >= 3, `encontré: ${escritores.join(', ')}`);
  const sueltos = escritores.filter((n) => !(n in ESCRIBEN_VERSION));
  assert.deepEqual(sueltos, [], `escriben \`version\` sin demostrar que traen los ítems: ${sueltos.join(', ')}`);
  for (const [nombre, { prueba, texto }] of Object.entries(ESCRIBEN_VERSION)) assert.match(cuerpo(nombre), prueba, `${nombre}: ${texto}`);
  // y la fila de una respuesta nunca se asigna a la copia como un objeto a medias: `_anotarVersion` ya no existe
  assert.doesNotMatch(POS_HTML, /_anotarVersion\(/, 'la anotación que subía la versión sin los ítems ya no existe');
  // Los sitios que traen la fila entera de la base (eco, lecturas, adopciones) lo hacen con `parseOrden`, que lleva ítems y versión de la MISMA fila
  const parse = cuerpo('parseOrden');
  assert.match(parse, /items: row\.items \|\| \[\]/);
  assert.match(parse, /version: row\.version \?\? 0/);
});

test('S2 estática: cada respuesta a un cambio propio se anota con `_anotarRespuesta` y quien lo hace desde una subida registrada en vuelo lo dice (`propia`); la última subida en salir relee una copia desactualizada', () => {
  const quienes = metodos().filter((m) => /this\._anotarRespuesta\(/.test(m.texto.replace(/^ {12}.*\n/, ''))).map((m) => m.nombre).sort();
  assert.deepEqual(quienes, ['_intentarMarcaLlevar', '_intentarPrecio', '_pushDelta', '_vaciarCola', 'ciclarPagador', 'renombrarPersona']);
  for (const n of ['_pushDelta', '_intentarMarcaLlevar', '_intentarPrecio', 'ciclarPagador', 'renombrarPersona']) assert.match(cuerpo(n), /this\._anotarRespuesta\([^)]*\{ propia: true \}\)/, `${n} anota como subida propia en vuelo`);
  assert.match(cuerpo('_vaciarCola'), /this\._anotarRespuesta\(d\.orden_id, data, \{ delta: d \}\)/, 'la cola excluye al delta que acaba de aplicar');
  assert.match(cuerpo('_registrarEnVuelo'), /if \(o && o\.desactualizada\) this\._releerSiDesactualizada\(ordenId, 1, true\);/);
  // el orden de las razones para NO tocar la versión: congelada, ítems distintos con otros cambios, cuenta que se cierra, fila más vieja que otra vista
  const a = cuerpo('_anotarRespuesta');
  const i = ['Array.isArray(fila.items)', 'this._cuentaCongelada(ordenId)', 'this._mismosItems(local.items, fila.items)', "local.estado !== 'abierta'", 'this._cambiosPropiosEnCamino(', 'this._adoptarFilaDeCambio(local, fila)'].map((x) => a.indexOf(x));
  assert.ok(i.every((x) => x > 0) && i.every((x, k) => k === 0 || x > i[k - 1]), `el orden de _anotarRespuesta: ${i}`);
  assert.match(cuerpo('_adoptarFilaDeCambio'), /this\._conMarcasPendientes\(this\.parseOrden\(/, 'con encima lo propio que aún no subió');
  assert.match(cuerpo('_adoptarCobroDeLaBase'), /this\._marcarDesactualizada\(local\.id\)/);
  assert.doesNotMatch(cuerpo('_adoptarCobroDeLaBase'), /local\.version = /);
});

test('S3 estática: la espera de 30 s — constante, asentamiento en cada salida de la llamada de cobro, y la reconciliación solo suelta con la espera cumplida y una segunda lectura', () => {
  assert.match(POS_HTML, /const ESPERA_COBRO_TARDIO_MS = 30000;/);
  const base = cuerpo('_cobrarEnBase');
  assert.match(base, /const r = await this\._conTope\(llamada, TOPE_COBRO_MS\);\s*intento = this\._asentarCobroEnDuda\(intento\) \|\| intento;/, 'se asienta en cuanto la llamada termina (respuesta, error o tope)');
  assert.match(base, /this\._asentarCobroEnDuda\(intento\); this\._avisarCobroEnDuda\(\);/, 'y si lanzó');
  assert.match(cuerpo('_cargarCobrosEnDuda'), /i\.asentadoEn = ahora/, 'un intento de una página anterior se asienta al arrancar');
  const ya = cuerpo('_resolverCobroEnDudaYa');
  assert.equal((ya.match(/await this\._sondearCobro\(intento\)/g) || []).length, 2, 'dos lecturas por id');
  assert.match(ya, /if \(this\._esperaDeCobroTardio\(intento\) > 0\) return 'en_espera';/);
  assert.match(cuerpo('_esperaDeCobroTardio'), /asentado \+ ESPERA_COBRO_TARDIO_MS - Date\.now\(\)/);
  assert.match(cuerpo('_esperaDeCobroTardio'), /if \(this\._cobrandoDe\(intento\.cuentaId\)\) return ESPERA_COBRO_TARDIO_MS;/, 'con la llamada en camino la espera ni empieza');
  assert.match(cuerpo('reintentarCobroEnDuda'), /r === 'en_espera'/);
});

test('S4 estática: la mesa completa CON red relee la cuenta antes de cerrar (facturar → _facturarReleyendo → _leerCuentaParaCobrar) y SIN red cierra de inmediato', () => {
  const f = cuerpo('facturar');
  assert.match(f, /if \(orden && orden\.estado === 'abierta' && !this\._sinRedAhora\(\)\) return this\._facturarReleyendo\(orden\);/);
  assert.ok(f.indexOf('this._cobroBloqueado(orden)') < f.indexOf('this._facturarReleyendo(orden)'), 'la puerta de los cobros va primero');
  assert.ok(f.indexOf('this._facturarReleyendo(orden)') < f.indexOf('this._facturarYa(orden)'), 'la lectura va antes del cierre');
  const r = cuerpo('_facturarReleyendo');
  assert.ok(r.indexOf('await this._leerCuentaParaCobrar(orden)') > 0 && r.indexOf('await this._leerCuentaParaCobrar(orden)') < r.indexOf('this._facturarYa(actual)'));
  assert.match(r, /lectura\.estado === 'cambio'[\s\S]*?this\.modalConfirmFactura = true;[\s\S]*?return;/, 'si cambió, avisa y NO cierra');
  const l = cuerpo('_leerCuentaParaCobrar');
  assert.ok(l.indexOf('this._cuentaLista(id)') < l.indexOf(".from('ordenes').select('*').eq('id', id)"), 'primero lo propio en camino, luego la lectura');
});
