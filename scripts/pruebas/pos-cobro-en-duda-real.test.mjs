// EL COBRO «EN DUDA», DE PUNTA A PUNTA CON LO REAL (cuarta refutación, 2026-10-06; migración 20261005140000_cobrar_parcial.sql) Y LA CUENTA CONGELADA (quinta refutación, mismo día).
//   POS (pos.html con su supabase-js REAL en Chromium) → «PostgREST» de _pila-impresion.mjs → Postgres 17 con la cadena COMPLETA de migraciones y la RLS de un mesero de verdad.
//   Los mismos guiones de la refutación (refutacion-r4/pos-cobro-en-duda.test.mjs en el paquete de coordinación), que antes ROMPÍAN el dinero y ahora tienen que cuadrar. Desde la quinta, mientras un
//   cobro está en duda la cuenta está CONGELADA: repetir el botón NO sale (a un intento no se le reenvía: se le pregunta por su id, sola al volver la red o con «Reintentar ahora»).
//     D1  la base aplica un cobro por partes, la respuesta se pierde, la tablet relee la cuenta y el mesero repite el «Sí, cobrar»: antes dos ventas de 13.000 por un pago; ahora el botón no sale y la pregunta adopta UNA.
//     D2  lo mismo con un abono de 20.000: antes dos abonos; ahora UNO.
//     D3  recargar la página con el cobro en duda y repetirlo: la cuenta nace congelada; ahora UNA venta, con el id del intento.
//     D4  el Wi-Fi «sin internet» que CUELGA (la petición ni contesta ni falla): antes «Registrando…» para siempre y NINGUNA mesa de la tablet cobraba; ahora «Sin red…» a los 10 s y
//         la otra mesa cobra siempre.
//     D5  dos toques a la vez: una sola llamada y una sola venta.
//     D6  al volver la red (sin que nadie toque nada) la tablet pregunta a la base por ese id, adopta la venta y avisa.
//   Los guiones de la quinta (el cobro en duda más un cambio de la misma cuenta y la mesa completa): pos-cuenta-congelada-real.test.mjs.
// Se salta, con el motivo, sin Docker o sin Playwright y Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { buscarDocker, literal } from './_supabase-simulado.mjs';
import { nuevoContexto, prepararPagina, esperarListo, servirPos } from './_pos-simulado.mjs';
import { levantarPila, HOST_SUPABASE } from './_pila-impresion.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = buscarPlaywright();
const docker = buscarDocker();
const SALTAR = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos y navegador` : (pw.motivo || false);
const SIN_RED = 'Sin red: el cobro por partes y los abonos necesitan red; la mesa completa sí se puede cobrar.';
const SIN_RED_DUDA = 'Sin red: el cobro por partes y los abonos necesitan red.';

let pila; let servidor; let navegador;
const contextos = [];
before(async () => {
  if (SALTAR) return;
  pila = await levantarPila({ conCola: true });
  servidor = await servirPos(RAIZ, 0);
  navegador = await pw.chromium.launch();
  const r = pila.pg.sql(`insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'c') from generate_series(41, 70) g`);
  if (!r.ok) throw new Error(r.error);
}, { timeout: 600000 });
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
  await pila?.parar().catch(() => {});
});

const SECO = (n) => ({ id: 'ej2', nombre: 'Seco con proteína', precio: 18000, qty: n, nota: '' });
const LIM = (n) => ({ id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: n, nota: '' });
const JUGO = (n) => ({ id: 'be2', nombre: 'Jugo natural', precio: 9000, qty: n, nota: '' });
const cuenta = (id, mesa, items) => {
  const r = pila.pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', ${literal(JSON.stringify(items))}::jsonb, 0, now()); update public.mesas set estado = 'ocupada' where id = ${mesa};`);
  if (!r.ok) throw new Error(r.error);
};
const fila = (id) => pila.pg.filas(`select id, estado, total, items, parcial_de, version from public.ordenes where id = ${literal(id)}`)[0];
const hijas = (id) => pila.pg.filas(`select id, estado, total, items, parcial_de from public.ordenes where parcial_de = ${literal(id)} order by cerrada_en, id`);
const deSupabase = (u) => u.hostname === HOST_SUPABASE;
async function hasta(cond, ms = 30000) { const fin = Date.now() + ms; for (;;) { const v = await cond(); if (v) return v; if (Date.now() > fin) return v; await new Promise((r) => setTimeout(r, 200)); } }

async function abrirPos(persona = 'mesero') {
  const ctx = await nuevoContexto(navegador, { ancho: 1280, alto: 900 });
  contextos.push(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await prepararPagina(page, { url: servidor.url, stubSupabase: false, relojFijo: false, bloquearFuentes: true });
  await pila.conectarPagina(page);
  const { sesion } = pila.persona(persona);
  await page.addInitScript(([k, s]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); } catch {} }, ['sb-lccgehvyymladqvumcez-auth-token', sesion]);
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page);
  return { page, ctx };
}
const aMesa = async (page, n) => {
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).click();
  await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
};
const local = (page, id) => page.evaluate((x) => { const p = Alpine.store('pos'); const o = p.ordenes.find((y) => y.id === x); return { remoto: p.remoto, aviso: p.aviso?.texto || '', sel: p.itemsSeleccionados, montoAbono: p.montoAbono, cobrando: p.cobrandoParcial, enDuda: Object.keys(p.cobrosEnDuda), version: o ? o.version : null, estado: o ? o.estado : null, ventas: p.ordenes.filter((y) => y.parcialDe === x).length }; }, id);
const enDuda = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pos_cobros_en_duda') || '{}'));
/** El eco de Realtime de la cuenta: la tablet pasa a ver la cuenta como está en la base (con su versión). */
const eco = (page, id) => { const f = fila(id); const cuerpo = pila.pg.filas(`select * from public.ordenes where id = ${literal(id)}`)[0]; return page.evaluate((c) => Alpine.store('pos').procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: c }), cuerpo); };
/** La primera llamada a `fn` llega a la base (la aplica) y la respuesta se pierde, como un Wi-Fi que se cae justo después de mandar. */
async function perderRespuesta(page, fn) {
  let usada = false;
  const trampa = async (route) => {
    const pedido = route.request();
    if (usada || !pedido.url().includes(`/rpc/${fn}`) || pedido.method() !== 'POST') return route.fallback();
    usada = true;
    const cab = {}; for (const [k, v] of Object.entries(pedido.headers())) cab[k.toLowerCase()] = v;
    await pila.atender({ metodo: 'POST', url: new URL(pedido.url()), cabeceras: cab, cuerpo: pedido.postData() || '' });
    return route.abort('connectionreset');
  };
  await page.route(deSupabase, trampa);
  return () => page.unroute(deSupabase, trampa);
}
/** Mientras dure, la tablet NO puede preguntar a la base por un cobro (las lecturas por `parcial_de` fallan) y todo lo demás sí funciona. */
async function sinPoderPreguntar(page) {
  const trampa = (route) => (/parcial_de=eq\./.test(route.request().url()) ? route.abort('internetdisconnected') : route.fallback());
  await page.route(deSupabase, trampa);
  return () => page.unroute(deSupabase, trampa);
}

test('D1 la base cobró 1 Limonada, la respuesta se perdió; la cuenta se relee (versión nueva) y el mismo «Sí, cobrar» con la selección que sigue en pantalla NO sale (la cuenta está congelada): «Reintentar ahora» le pregunta a la base por ese id y adopta la venta: una sola de 13.000', { skip: SALTAR, timeout: 180000 }, async () => {
  cuenta('rd-d1', 41, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 41);
  await page.getByRole('button', { name: 'Cobrar por partes' }).click();
  await page.evaluate(() => { Alpine.store('pos').itemsSeleccionados = { be1: 1 }; });
  const soltar = await perderRespuesta(page, 'cobrar_parcial');
  await page.locator('.barra-partes button').first().click();
  await page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => (await local(page, 'rd-d1')).aviso !== '', 20000);
  const tras1 = await local(page, 'rd-d1');
  assert.ok(tras1.aviso.startsWith(SIN_RED_DUDA), tras1.aviso);
  assert.doesNotMatch(tras1.aviso, /la mesa completa sí se puede cobrar/, 'con la cuenta congelada la mesa completa NO se ofrece');
  assert.match(tras1.aviso, /Puede que el cobro sí haya llegado a la base/, 'el aviso dice que pudo llegar');
  assert.equal(hijas('rd-d1').length, 1, 'la base SÍ cobró la Limonada');
  assert.deepEqual(tras1.sel, { be1: 1 }, 'la selección sigue en pantalla');
  const duda = await enDuda(page);
  assert.equal(Object.keys(duda).length, 1, 'el intento quedó guardado en localStorage');
  await soltar();
  const noPreguntar = await sinPoderPreguntar(page);                     // la tablet pregunta sola cada 7 s: se la detiene para probar el mismo botón
  // la tablet pasa a ver la cuenta con la versión nueva (el eco de Realtime) ANTES de que alcance a preguntar por el cobro
  await eco(page, 'rd-d1');
  const tras2 = await local(page, 'rd-d1');
  assert.equal(tras2.version, fila('rd-d1').version);
  assert.deepEqual(tras2.sel, { be1: 1 }, 'la selección sigue');
  assert.equal(await page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 })), false, 'el mismo cobro: la cuenta sigue congelada');
  assert.equal((await local(page, 'rd-d1')).aviso, 'Cobro pendiente de confirmar con la base: espera a que vuelva la red.');
  assert.equal(hijas('rd-d1').length, 1, 'ningún segundo cobro');
  await noPreguntar();
  await page.evaluate(() => Alpine.store('pos').reintentarCobroEnDuda());   // (la pregunta de cada 7 s puede adelantarse: da igual quién lo adopte)
  await hasta(async () => (await local(page, 'rd-d1')).enDuda.length === 0, 20000);
  const ventas = hijas('rd-d1');
  assert.equal(ventas.length, 1, `la Limonada se cobró ${ventas.length} veces (un solo pago del cliente)`);
  assert.equal(Number(ventas[0].total), 13000);
  assert.equal(ventas[0].id, Object.values(duda)[0].ventaId, 'es la venta del intento original');
  assert.equal(Number(fila('rd-d1').total), 2 * 18000 + 13000, 'la cuenta con UNA sola resta');
  assert.match((await local(page, 'rd-d1')).aviso, /SÍ quedó registrado en la base/);
});

test('D2 el abono de 20.000 llegó a la base, la respuesta se perdió; tras releer, el mismo «Sí, recibir» con el monto que sigue escrito NO sale (congelada) y «Reintentar ahora» lo adopta: un solo abono', { skip: SALTAR, timeout: 180000 }, async () => {
  cuenta('rd-d2', 42, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 42);
  const soltar = await perderRespuesta(page, 'cobrar_abono');
  const abonar = () => page.evaluate(() => { const p = Alpine.store('pos'); p.seleccionCobro = true; p.montoAbono = p.montoAbono || '20000'; p.metodoAbono = 'efectivo'; return p.cobrarMonto(); });
  assert.equal(await abonar(), false);
  const tras1 = await local(page, 'rd-d2');
  assert.ok(tras1.aviso.startsWith(SIN_RED_DUDA));
  assert.equal(hijas('rd-d2').length, 1, 'la base SÍ recibió el abono');
  await soltar();
  const noPreguntar = await sinPoderPreguntar(page);
  await eco(page, 'rd-d2');
  assert.equal((await local(page, 'rd-d2')).version, fila('rd-d2').version);
  assert.equal(await abonar(), false, 'el mismo abono otra vez: congelada, no sale');
  assert.equal(hijas('rd-d2').length, 1);
  await noPreguntar();
  await page.evaluate(() => Alpine.store('pos').reintentarCobroEnDuda());
  await hasta(async () => (await local(page, 'rd-d2')).enDuda.length === 0, 20000);
  const ventas = hijas('rd-d2');
  assert.equal(ventas.length, 1, `el abono quedó registrado ${ventas.length} veces`);
  assert.equal(Number(ventas[0].total), 20000);
  assert.equal(Number(fila('rd-d2').total), 2 * 18000 + 2 * 13000 - 20000, 'y el crédito está una sola vez');
  assert.equal(fila('rd-d2').items.filter((i) => i.id.startsWith('abono_recibido_')).length, 1);
});

test('D3 recargar la página con el cobro en duda y repetirlo (sin que la tablet alcance a preguntar): el intento sobrevive a la recarga, la cuenta nace congelada, repetir NO sale; al poder preguntar, una sola venta', { skip: SALTAR, timeout: 180000 }, async () => {
  cuenta('rd-d3', 43, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 43);
  const soltar = await perderRespuesta(page, 'cobrar_parcial');
  const cobrar = () => page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 }));
  assert.equal(await cobrar(), false);
  assert.ok((await local(page, 'rd-d3')).aviso.startsWith(SIN_RED_DUDA));
  assert.equal(hijas('rd-d3').length, 1, 'la base SÍ cobró');
  const [intento] = Object.values(await enDuda(page));
  await soltar();
  const dejarPreguntar = await sinPoderPreguntar(page);                 // la tablet no puede preguntar todavía por el cobro
  await page.reload({ waitUntil: 'load' });
  await esperarListo(page);
  await aMesa(page, 43);
  const tras = await local(page, 'rd-d3');
  assert.deepEqual(tras.enDuda, ['rd-d3'], 'el intento volvió de localStorage tras recargar');
  assert.equal(tras.version, fila('rd-d3').version, 'la tablet lee la versión NUEVA (no hay RS003 que valga)');
  assert.equal(await cobrar(), false, 'repetirlo: la cuenta nació congelada');
  assert.equal(hijas('rd-d3').length, 1, `tras recargar, la Limonada quedó cobrada ${hijas('rd-d3').length} veces`);
  await dejarPreguntar();
  await page.evaluate(() => Alpine.store('pos').reintentarCobroEnDuda());
  await hasta(async () => (await local(page, 'rd-d3')).enDuda.length === 0, 20000);
  const ventas = hijas('rd-d3');
  assert.equal(ventas.length, 1);
  assert.equal(ventas[0].id, intento.ventaId);
  assert.deepEqual(Object.keys(await enDuda(page)), [], 'resuelto: ya no hay intento guardado');
});

test('D4 Wi-Fi «sin internet» que CUELGA (la petición no contesta ni falla): «Sí, cobrar» espera la cola solo 10 s → «Sin red…»; nada queda «Registrando…»; sin llamada de cobro; y la mesa completa de OTRA mesa SÍ se cobra', { skip: SALTAR, timeout: 180000 }, async () => {
  cuenta('rd-d4', 44, [SECO(2), LIM(1)]);
  cuenta('rd-d4b', 45, [JUGO(1)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 44);
  const colgadas = [];
  await page.route(deSupabase, (route) => { colgadas.push(route.request().url().replace(/^.*\/rest\/v1\//, '')); /* nunca se contesta */ });
  await page.evaluate(() => { const p = Alpine.store('pos'); p._agregarAlPedido(p.productos.find((x) => x.id === 'be1'), ''); });   // un +1 en vuelo, colgado
  const t0 = Date.now();
  page.evaluate(() => { Alpine.store('pos').facturarParcial({ ej2: 1 }); });                         // «Sí, cobrar»
  await hasta(async () => (await local(page, 'rd-d4')).cobrando, 5000);
  assert.equal((await local(page, 'rd-d4')).cobrando, true, 'mientras espera, «Registrando…»');
  await hasta(async () => (await local(page, 'rd-d4')).aviso !== '', 30000);
  const e = await local(page, 'rd-d4');
  const seg = Math.round((Date.now() - t0) / 1000);
  assert.ok(seg >= 9 && seg <= 25, `el aviso sale al vencer el tope de 10 s, no antes ni mucho después (${seg} s)`);
  assert.ok(e.aviso.startsWith(SIN_RED), e.aviso);
  assert.equal(e.cobrando, false, 'nada «Registrando…»');
  assert.deepEqual(e.enDuda, [], 'lo que nunca salió no está en duda');
  assert.equal(colgadas.filter((u) => u.includes('cobrar_parcial')).length, 0, 'nunca se llamó a cobrar_parcial');
  assert.equal(hijas('rd-d4').length, 0);
  // la mesa completa de OTRA mesa, sin promoción (se cobra sin red, PROVISIONAL)
  await page.evaluate(() => Alpine.store('pos').volverAMesas());
  await aMesa(page, 45);
  await page.evaluate(() => Alpine.store('pos').facturar());
  await new Promise((r) => setTimeout(r, 800));
  const m = await page.evaluate(() => { const p = Alpine.store('pos'); const o = p.ordenes.find((x) => x.id === 'rd-d4b'); return { estado: o.estado, vista: p.vista, aviso: p.aviso?.texto || '' }; });
  assert.equal(m.estado, 'cerrada', `la mesa completa de otra mesa se cobra: «${m.aviso}»`);
});

test('D5 doble toque: dos «Sí, cobrar» a la vez sobre la misma cuenta mandan una sola llamada y registran una sola venta', { skip: SALTAR, timeout: 180000 }, async () => {
  cuenta('rd-d5', 46, [SECO(3), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 46);
  const n0 = pila.peticiones.length;
  const r = await page.evaluate(() => Promise.all([Alpine.store('pos').facturarParcial({ be1: 1 }), Alpine.store('pos').facturarParcial({ be1: 1 })]));
  assert.deepEqual([...r].sort(), [false, true]);
  assert.equal(pila.peticiones.slice(n0).map((p) => p.ruta).filter((x) => x.includes('/rpc/cobrar_parcial')).length, 1, 'una sola llamada');
  assert.equal(hijas('rd-d5').length, 1);
  assert.equal(Number(fila('rd-d5').total), 3 * 18000 + 13000);
});

test('D6 al volver la red, sin que nadie toque nada, la tablet pregunta a la base por el cobro en duda, adopta la venta, avisa y suelta el intento; la pantalla no salta', { skip: SALTAR, timeout: 180000 }, async () => {
  cuenta('rd-d6', 47, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 47);
  const soltar = await perderRespuesta(page, 'cobrar_parcial');
  assert.equal(await page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 })), false);
  assert.equal(hijas('rd-d6').length, 1);
  await soltar();
  // el reintento de red de 8 s lee la base, `remoto` vuelve a «ok» y se reconcilia
  await hasta(async () => (await local(page, 'rd-d6')).enDuda.length === 0, 40000);
  const e = await local(page, 'rd-d6');
  assert.deepEqual(e.enDuda, []);
  assert.match(e.aviso, /SÍ quedó registrado en la base/);
  assert.equal(e.ventas, 1, 'la venta está en las transacciones de la tablet');
  assert.equal(e.version, fila('rd-d6').version);
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'orden', 'la pantalla no salta a un ticket');
  assert.equal(hijas('rd-d6').length, 1, 'y no hubo un segundo cobro');
  assert.deepEqual(Object.keys(await enDuda(page)), []);
});
