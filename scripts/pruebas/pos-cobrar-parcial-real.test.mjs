// COBRAR POR PARTES Y ABONAR, DE PUNTA A PUNTA CON LO REAL (tercera refutación, 2026-10-05; migración 20261005140000_cobrar_parcial.sql).
//   POS (pos.html con su supabase-js REAL, assets/vendor/, en Chromium) → «PostgREST» de _pila-impresion.mjs → Postgres 17 con la cadena COMPLETA de migraciones y la RLS de verdad
//   (un mesero de verdad: rol `authenticated`, `mi_rol()`, `solo_personal`). La red se corta como se corta en el restaurante: `page.route` que ABORTA lo del host de Supabase
//   (el router sigue arriba y no hay internet: `navigator.onLine` sigue en true) y `context.setOffline(true)` (el Wi-Fi apagado: `navigator.onLine` en false y el evento «offline»).
//
//   1. el cobro por partes (UI: casillas, «Cobrar seleccionados», «Sí, cobrar») y el abono son UNA llamada a la base (ni un upsert de la venta ni un −qty), con la RLS del mesero;
//   2. corte de red REAL durante el cobro: nada cambia (ni la tablet ni la base), el aviso exacto sale y, al volver la red, el mismo cobro entra UNA sola vez;
//   3. se corta la RESPUESTA (la base sí cobró): la tablet no inventa nada, y repetir el cobro devuelve lo mismo sin duplicar;
//   4. tablet vieja → RS003 → relee; promoción → RS005; dos tablets cobrando a la vez la misma cuenta: una entra, la otra relee;
//   5. los guiones de la tercera refutación (Wi-Fi apagado con promoción; sin internet con el router arriba y una recarga: 54.000 / 50.400) ya no se pueden producir;
//   6. deshacer lo que hizo la RPC: la unidad vuelve y la promo se recalcula.
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
/** El aviso de «sin red» de un cobro que sí salió hacia la base: la frase de siempre y, detrás, que puede haber llegado (cuarta refutación, 2026-10-06). */
const esSinRed = (texto) => texto.startsWith(SIN_RED) && /Puede que el cobro sí haya llegado a la base y solo se perdió la respuesta/.test(texto);
const SIN_RED_PROMO = /Sin red: esta cuenta tiene promoción; espera a que vuelva la red para cobrar/;
const CAMBIO = /La cuenta cambió: revísala y vuelve a cobrar/;

let pila; let servidor; let navegador;
const contextos = [];
before(async () => {
  if (SALTAR) return;
  pila = await levantarPila({ conCola: true });
  servidor = await servirPos(RAIZ, 0);
  navegador = await pw.chromium.launch();
  const sql = (s) => { const r = pila.pg.sql(s); if (!r.ok) throw new Error(r.error); };
  // La regla (como la pone el sobre 2, pero todos los días): cada 3 «Ejecutivos», el más barato con 20 % menos.
  sql(`insert into public.productos (id, categoria, nombre, precio, descripcion, activo, promo_regla) values ('pr-real', 'Promociones', '3er almuerzo', 0, '', true, '{"cada": 3, "descuento": 20, "aplica": {"categorias": ["Ejecutivos"]}}'::jsonb)`);
  sql(`insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'b') from generate_series(11, 40) g`);
}, { timeout: 600000 });
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
  await pila?.parar().catch(() => {});
});

const SECO = (n, nota = '') => ({ id: 'ej2', nombre: 'Seco con proteína', precio: 18000, qty: n, nota });
const LIM = (n, nota = '') => ({ id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: n, nota });
const JUGO = (n, nota = '') => ({ id: 'be2', nombre: 'Jugo natural', precio: 9000, qty: n, nota });
/** Una cuenta abierta en la mesa `mesa` (la base la normaliza: precio de hoy y promo). */
const cuenta = (id, mesa, items) => {
  const r = pila.pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', ${literal(JSON.stringify(items))}::jsonb, 0, now()); update public.mesas set estado = 'ocupada' where id = ${mesa};`);
  if (!r.ok) throw new Error(r.error);
};
const fila = (id) => pila.pg.filas(`select id, estado, total, items, parcial_de, version from public.ordenes where id = ${literal(id)}`)[0];
const hijas = (id) => pila.pg.filas(`select id, estado, total, items, parcial_de from public.ordenes where parcial_de = ${literal(id)} order by id`);
const ver = (items) => items.map((i) => `${i.qty}×${i.nombre}@${i.precio}`).join(' + ');
const pagado = (id) => hijas(id).reduce((s, x) => s + Number(x.total), 0) + Number(fila(id)?.estado === 'abierta' ? fila(id).total : 0);
const peticiones = (desde = 0) => pila.peticiones.slice(desde).map((p) => p.ruta);
const rpcs = (desde = 0) => peticiones(desde).filter((r) => r.includes('/rpc/')).map((r) => r.replace(/^.*\/rpc\//, '').split('?')[0]);

async function abrirPos(persona = 'mesero', ancho = 1280) {
  const ctx = await nuevoContexto(navegador, { ancho, alto: 900 });
  contextos.push(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const consola = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consola.push(m.text().slice(0, 240)); });
  await prepararPagina(page, { url: servidor.url, stubSupabase: false, relojFijo: false, bloquearFuentes: true });
  await pila.conectarPagina(page);
  const { sesion } = pila.persona(persona);
  await page.addInitScript(([k, s]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); } catch {} }, ['sb-lccgehvyymladqvumcez-auth-token', sesion]);
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page);
  return { page, ctx, consola };
}
const aMesa = async (page, n) => {
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).click();
  await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
};
const estado = (page, id = '') => page.evaluate((x) => { const p = Alpine.store('pos'); return { remoto: p.remoto, onLine: navigator.onLine, aviso: p.aviso?.texto || '', cola: p.colaDeltas.length, pendientes: Object.keys(p._pendientes).length, cobrando: p.cobrandoParcial, vista: p.vista, ventas: p.ordenes.filter((o) => o.estado === 'cerrada' && (!x || o.parcialDe === x)).length }; }, id);
const cuentaLocal = (page, id) => page.evaluate((x) => { const o = Alpine.store('pos').ordenes.find((y) => y.id === x); return o ? { total: o.total, version: o.version, items: o.items.map((i) => `${i.qty}×${i.id}`) } : null; }, id);
const aviso = (page) => page.evaluate(() => Alpine.store('pos').aviso?.texto || '');
// Sin red de los dos modos del restaurante. `abortar`: el router sigue arriba pero no hay internet (las llamadas a Supabase fallan; `navigator.onLine` sigue en true).
const deSupabase = (u) => u.hostname === HOST_SUPABASE;
const abortar = (route) => route.abort('internetdisconnected');
const cortarRed = (page) => page.route(deSupabase, abortar);
const volverRed = (page) => page.unroute(deSupabase, abortar);
async function hasta(cond, ms = 30000) { const fin = Date.now() + ms; for (;;) { const v = await cond(); if (v) return v; if (Date.now() > fin) return v; await new Promise((r) => setTimeout(r, 150)); } }
const sumar = (page, id) => page.evaluate((x) => Alpine.store('pos')._agregarAlPedido(Alpine.store('pos').productos.find((p) => p.id === x), ''), id);
const cobrar = (page, seleccion, persona = '') => page.evaluate(([s, p]) => Alpine.store('pos').facturarParcial(s, p), [seleccion, persona]);
const abonar = (page, monto, metodo = 'efectivo') => page.evaluate(([m, t]) => { const p = Alpine.store('pos'); p.seleccionCobro = true; p.montoAbono = String(m); p.metodoAbono = t; return p.cobrarMonto(); }, [monto, metodo]);
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const sinErrores = (consola) => consola.filter((e) => !/cdn\.tailwindcss\.com should not be used|Failed to load resource|internetdisconnected|ERR_INTERNET|ERR_NETWORK|Fallo al sincronizar|Failed to fetch|No se pudo|Operando offline/.test(e));

// ═══════════════════ 1. UNA llamada; la RLS de un mesero de verdad ═══════════════════

test('R1 (1280 px) el mesero cobra por partes con la pantalla: «Cobrar por partes» → casilla → «Cobrar seleccionados» → «Sí, cobrar»; la base recibe UNA llamada a cobrar_parcial (ni upsert de la venta ni delta), el ticket es el de la base y la cuenta es la que devolvió', { skip: SALTAR }, async () => {
  cuenta('real-r1', 11, [SECO(2), LIM(1)]);
  const { page, consola } = await abrirPos('mesero');
  await aMesa(page, 11);
  const n0 = pila.peticiones.length;
  await page.getByRole('button', { name: 'Cobrar por partes' }).click();
  await page.locator('.order-item', { hasText: 'Limonada' }).locator('input[type=checkbox]').click();
  await page.locator('.barra-partes button').first().click();
  await page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
  const estadoFinal = await estado(page);
  assert.equal(estadoFinal.aviso, '', 'sin avisos');
  assert.deepEqual(rpcs(n0), ['cobrar_parcial'], `una sola escritura hacia la base: ${rpcs(n0)}`);
  assert.equal(peticiones(n0).filter((r) => /\/rest\/v1\/ordenes/.test(r) && !/select/.test(r)).length, 0, 'ni un upsert de órdenes');
  const [venta] = hijas('real-r1');
  assert.equal(venta.estado, 'cerrada');
  assert.equal(Number(venta.total), 13000);
  assert.deepEqual(venta.items.map((i) => `${i.qty}×${i.id}`), ['1×be1']);
  const cu = fila('real-r1');
  assert.equal(cu.estado, 'abierta');
  assert.equal(Number(cu.total), 36000);
  assert.equal(cu.version, 1, 'la base subió la versión una vez');
  assert.deepEqual(await cuentaLocal(page, 'real-r1'), { total: 36000, version: 1, items: ['2×ej2'] }, 'la tablet adoptó la cuenta de la base');
  assert.match((await page.locator('.ticket-total .amount').innerText()).replace(/\s/g, ' '), /\$ 13\.000/);
  assert.equal(await page.evaluate(() => Alpine.store('pos').ultimoCobro?.ordenId), venta.id, '«Cobrado · Deshacer»');
  assert.equal(await sinDesborde(page), 0);
  assert.deepEqual(sinErrores(consola), []);
});

test('R2 por unidades y por persona, y un abono con su método (mesero, RLS): cada uno una llamada; el abono pone la venta «Abono» y el crédito con el mismo uid; los totales cuadran', { skip: SALTAR }, async () => {
  cuenta('real-r2', 12, [SECO(2, 'Persona 1'), JUGO(3, 'Persona 2'), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 12);
  const n0 = pila.peticiones.length;
  assert.equal(await cobrar(page, { be2: 2 }), true, 'por unidades: 2 de los 3 Jugo');
  assert.equal(await page.evaluate(() => Alpine.store('pos').cobrarGrupoPersona('Persona 1')), true, 'por persona');
  await page.evaluate(() => { const p = Alpine.store('pos'); p.vista = 'orden'; p.ticketMostrado = null; });
  assert.equal(await abonar(page, 10000, 'qr'), true, 'un abono');
  assert.deepEqual(rpcs(n0), ['cobrar_parcial', 'cobrar_parcial', 'cobrar_abono']);
  const ventas = hijas('real-r2');
  assert.equal(ventas.length, 3);
  const abono = ventas.find((v) => String(v.items[0].id).startsWith('abono_'));
  assert.equal(Number(abono.total), 10000);
  const credito = fila('real-r2').items.find((i) => String(i.id).startsWith('abono_recibido_'));
  assert.equal(credito.id, 'abono_recibido_' + abono.items[0].id.slice('abono_'.length));
  assert.equal(credito.nota, 'qr');
  assert.equal(pagado('real-r2'), 2 * 18000 + 3 * 9000 + 2 * 13000, 'lo cobrado + lo que queda = la cuenta');
  assert.equal(await page.evaluate(() => Alpine.store('pos').ordenes.find((o) => o.id === 'real-r2').total), Number(fila('real-r2').total));
});

// ═══════════════════ 2. Corte de red REAL durante el cobro ═══════════════════

test('R3 internet cortado (el router sigue arriba: `navigator.onLine` en true): el cobro NO se hace ni se encola, el aviso exacto sale, la cuenta de la tablet y la de la base no cambian; al volver la red el mismo cobro entra UNA vez', { skip: SALTAR }, async () => {
  cuenta('real-r3', 13, [SECO(2), LIM(1)]);
  const { page, consola } = await abrirPos('mesero');
  await aMesa(page, 13);
  const antesLocal = await cuentaLocal(page, 'real-r3');
  const antesBase = JSON.stringify(fila('real-r3'));
  await cortarRed(page);
  assert.equal((await estado(page)).remoto, 'ok', 'la tablet no sabe que no hay internet');
  assert.equal(await cobrar(page, { be1: 1 }), false);
  const e = await estado(page, 'real-r3');
  assert.ok(esSinRed(e.aviso), e.aviso);
  assert.equal(e.onLine, true);
  assert.equal(e.remoto, 'offline', 'el RESULTADO de la llamada le dijo que no hay red');
  assert.equal(e.cola, 0, 'nada en la cola');
  assert.equal(e.pendientes, 0, 'nada pendiente');
  assert.equal(e.ventas, 0, 'ni una venta local');
  assert.equal(e.cobrando, false);
  assert.deepEqual(await cuentaLocal(page, 'real-r3'), antesLocal);
  assert.equal(JSON.stringify(fila('real-r3')), antesBase, 'la base no cambió');
  assert.equal(hijas('real-r3').length, 0);
  assert.equal(await page.evaluate(() => Alpine.store('pos').seleccionCobro || true), true);
  // el abono, igual: es OTRO cobro mientras el anterior sigue en duda y sin red no se puede preguntar por él: no sale nada
  assert.equal(await abonar(page, 5000), false);
  assert.ok((await aviso(page)).startsWith(SIN_RED), await aviso(page));
  assert.match(await aviso(page), /sigue sin confirmarse/);
  assert.equal(hijas('real-r3').length, 0);
  assert.equal(JSON.stringify(fila('real-r3')), antesBase);
  // vuelve la red: el mismo cobro entra, una sola vez
  await volverRed(page);
  assert.equal(await cobrar(page, { be1: 1 }), true);
  assert.equal(hijas('real-r3').length, 1);
  assert.equal(Number(hijas('real-r3')[0].total), 13000);
  assert.equal(await page.evaluate(() => Alpine.store('pos').remoto), 'ok', 'una respuesta de la base lo dejó en línea');
  assert.equal(pagado('real-r3'), 2 * 18000 + 13000);
  assert.deepEqual(sinErrores(consola), []);
});

test('R4 Wi-Fi apagado (`context.setOffline(true)`: `navigator.onLine` en false y el evento «offline»): la tablet queda «sin red» al instante; por partes y abono no se cobran y la mesa completa de una cuenta SIN promoción sí', { skip: SALTAR }, async () => {
  cuenta('real-r4', 14, [JUGO(2), LIM(1)]);
  const { page, ctx } = await abrirPos('mesero');
  await aMesa(page, 14);
  await cortarRed(page);
  await ctx.setOffline(true);
  await hasta(async () => (await estado(page)).remoto === 'offline', 5000);
  assert.equal((await estado(page)).remoto, 'offline', 'el evento «offline» del navegador la marcó sin red, sin esperar a que falle una llamada');
  assert.equal(await cobrar(page, { be2: 1 }), false);
  assert.ok(esSinRed(await aviso(page)));
  assert.equal(await abonar(page, 4000), false);
  assert.equal(hijas('real-r4').length, 0);
  assert.equal((await estado(page)).cola, 0);
  // la mesa completa sin promoción SÍ se cobra sin red (queda provisional)
  await page.evaluate(() => Alpine.store('pos').facturar());
  await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
  await page.locator('.ticket-provisional').waitFor({ state: 'visible' });
  assert.equal(fila('real-r4').estado, 'abierta', 'todavía no llegó a la base');
  await volverRed(page);
  await ctx.setOffline(false);
  await hasta(async () => fila('real-r4').estado === 'cerrada', 40000);
  assert.equal(fila('real-r4').estado, 'cerrada', 'al volver la red la mesa completa subió');
  assert.equal(Number(fila('real-r4').total), 2 * 9000 + 13000);
  assert.equal(hijas('real-r4').length, 0);
});

// ═══════════════════ 3. Se corta la RESPUESTA: la base sí cobró ═══════════════════

test('R5 la RESPUESTA del cobro se pierde (la base SÍ lo aplicó): la tablet dice «Sin red…» y no inventa nada; repetir el MISMO cobro lleva los mismos ids y la base devuelve lo mismo SIN duplicar: una venta, una resta, el ticket adoptado', { skip: SALTAR }, async () => {
  cuenta('real-r5', 15, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 15);
  const n0 = pila.peticiones.length;
  const ids = [];
  const trampa = async (route) => {
    const pedido = route.request();
    if (!/\/rpc\/cobrar_parcial/.test(pedido.url()) || pedido.method() !== 'POST') return route.fallback();
    const cab = {}; for (const [k, v] of Object.entries(pedido.headers())) cab[k.toLowerCase()] = v;
    ids.push(JSON.parse(pedido.postData()).p_delta_id);
    await pila.atender({ metodo: 'POST', url: new URL(pedido.url()), cabeceras: cab, cuerpo: pedido.postData() || '' });   // la base lo aplica…
    return route.abort('connectionreset');                                                                              // …y la respuesta no llega
  };
  await page.route(deSupabase, trampa);
  assert.equal(await cobrar(page, { be1: 1 }), false);
  assert.ok(esSinRed(await aviso(page)));
  assert.equal(hijas('real-r5').length, 1, 'la base sí lo aplicó');
  assert.equal((await estado(page, 'real-r5')).ventas, 0, 'la tablet no sabe: no inventa una venta');
  assert.deepEqual((await cuentaLocal(page, 'real-r5')).items, ['2×ej2', '2×be1'], 'su cuenta sigue como la vio');
  await page.unroute(deSupabase, trampa);
  assert.equal(await cobrar(page, { be1: 1 }), true, 'el mismo cobro, otra vez');
  assert.equal(hijas('real-r5').length, 1, 'una sola venta');
  assert.equal(Number(fila('real-r5').total), 2 * 18000 + 13000, 'una sola resta');
  assert.equal((await estado(page, 'real-r5')).ventas, 1);
  assert.equal(await page.evaluate(() => Alpine.store('pos').ticketMostrado.id), hijas('real-r5')[0].id);
  assert.equal(ids.length, 1);
  assert.equal(rpcs(n0).filter((r) => r === 'cobrar_parcial').length, 2, 'dos llamadas con los mismos ids; la base las trató como una');
});

// ═══════════════════ 4. Tablet vieja, promoción, dos tablets a la vez ═══════════════════

test('R6 tablet vieja: otra tablet cambió la cuenta mientras esta no se enteraba (no hay eco en la pila): RS003 de verdad → «La cuenta cambió…», no se cobra nada y la tablet adopta la cuenta de la base', { skip: SALTAR }, async () => {
  cuenta('real-r6', 16, [SECO(2), LIM(1)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 16);
  const r = pila.pg.sql(`select public.aplicar_delta_orden('real-r6', 'be2', 'Jugo natural', 9000, 2, '') is not null;`, { como: 'migrador' });
  assert.ok(r.ok, r.error);
  assert.equal(fila('real-r6').version, 1);
  assert.equal((await cuentaLocal(page, 'real-r6')).version, 0, 'la tablet sigue en la versión de antes');
  assert.equal(await cobrar(page, { be1: 1 }), false);
  assert.match(await aviso(page), CAMBIO);
  await hasta(async () => (await cuentaLocal(page, 'real-r6')).version === 1);
  assert.deepEqual(await cuentaLocal(page, 'real-r6'), { total: 2 * 18000 + 13000 + 2 * 9000, version: 1, items: ['2×ej2', '1×be1', '2×be2'] }, 'releyó y adoptó la cuenta de la base');
  assert.equal(hijas('real-r6').length, 0);
  assert.deepEqual(await page.evaluate(() => Alpine.store('pos').itemsSeleccionados), {});
  // con la cuenta al día, el cobro entra
  assert.equal(await cobrar(page, { be1: 1 }), true);
  assert.equal(hijas('real-r6').length, 1);
});

test('R7 promoción: una tablet con la copia sin la línea de promo (la versión al día) cobra por partes: la base la rechaza (RS005, de verdad), nada sale de la cuenta, y la tablet adopta la cuenta con su línea de promo', { skip: SALTAR }, async () => {
  cuenta('real-r7', 17, [SECO(3)]);
  assert.match(ver(fila('real-r7').items), /1×Seco con proteína · 3er almuerzo/, 'la base ya la tiene con promo');
  const { page } = await abrirPos('mesero');
  await aMesa(page, 17);
  await page.evaluate(() => {   // la copia de la tablet: 3 Seco sin la línea de promo (como antes de enterarse), con la versión de la base
    const o = Alpine.store('pos').ordenes.find((x) => x.id === 'real-r7');
    o.items = [{ id: 'ej2', nombre: 'Seco con proteína', precio: 18000, qty: 3, nota: '' }]; o.total = 54000;
  });
  assert.equal(await page.evaluate(() => Alpine.store('pos').cuentaConPromo), false);
  assert.equal(await cobrar(page, { ej2: 1 }), false);
  assert.match(await aviso(page), /NO quedó registrado: esa cuenta tiene una promoción/);
  assert.equal(hijas('real-r7').length, 0);
  assert.equal(Number(fila('real-r7').total), 2 * 18000 + 14400, 'la cuenta de la base quedó como estaba (50.400)');
  await hasta(async () => (await cuentaLocal(page, 'real-r7')).items.some((i) => i.includes('promo:')));
  assert.equal((await cuentaLocal(page, 'real-r7')).total, 50400);
  assert.equal(await page.evaluate(() => Alpine.store('pos').cuentaConPromo), true);
  // y un abono SÍ entra en una cuenta con promoción
  assert.equal(await abonar(page, 20000), true);
  assert.equal(hijas('real-r7').length, 1);
  assert.match(ver(fila('real-r7').items), /3er almuerzo/, 'el descuento sigue donde estaba');
  assert.equal(Number(fila('real-r7').total), 50400 - 20000);
});

test('R8 dos tablets cobrando a la vez la MISMA cuenta (dos páginas, dos sesiones): una entra y la otra recibe RS003 y relee; ni una unidad se pierde ni se duplica', { skip: SALTAR }, async () => {
  cuenta('real-r8', 18, [SECO(2), LIM(2), JUGO(2)]);
  const a = await abrirPos('mesero');
  const b = await abrirPos('admin');
  await aMesa(a.page, 18); await aMesa(b.page, 18);
  const [ra, rb] = await Promise.all([cobrar(a.page, { be1: 1 }), cobrar(b.page, { be2: 1 })]);
  assert.deepEqual([ra, rb].sort(), [false, true], 'una entra y la otra no');
  assert.equal(hijas('real-r8').length, 1, 'una sola venta');
  const perdedora = ra ? b.page : a.page;
  assert.match(await aviso(perdedora), CAMBIO);
  assert.equal(fila('real-r8').version, 1);
  assert.equal(pagado('real-r8'), 2 * 18000 + 2 * 13000 + 2 * 9000, 'lo cobrado + lo que queda = la cuenta');
  await hasta(async () => (await cuentaLocal(perdedora, 'real-r8')).version === 1);
  assert.equal((await cuentaLocal(perdedora, 'real-r8')).total, Number(fila('real-r8').total), 'la perdedora releyó');
});

// ═══════════════════ 5. Los guiones de la tercera refutación ═══════════════════

test('R9 (r3 D) Wi-Fi apagado con una cuenta que la base pondrá con promoción (3 Seco con el tercero por llegar): la mesa completa NO se cobra (el papel no puede decir 54.000 si la base registrará 50.400); al volver todo converge', { skip: SALTAR }, async () => {
  cuenta('real-r9', 19, [SECO(2)]);
  const { page, ctx } = await abrirPos('mesero');
  await aMesa(page, 19);
  await cortarRed(page);
  await ctx.setOffline(true);
  await hasta(async () => (await estado(page)).remoto === 'offline', 5000);
  await sumar(page, 'ej2');
  await page.waitForTimeout(500);
  const e = await estado(page);
  assert.match(await page.evaluate(() => Alpine.store('pos').motivoSinCobro), SIN_RED_PROMO, `sin red y con el tercero: ${JSON.stringify(e)}`);
  await page.evaluate(() => Alpine.store('pos').facturar());
  await page.waitForTimeout(500);
  assert.equal((await estado(page)).vista, 'orden', 'no se cobró: sigue en la cuenta');
  assert.equal(await page.evaluate(() => Alpine.store('pos').ordenes.find((o) => o.id === 'real-r9').estado), 'abierta');
  assert.equal(await cobrar(page, { ej2: 1 }), false, 'por partes tampoco');
  await volverRed(page);
  await ctx.setOffline(false);
  await hasta(async () => (await estado(page)).cola === 0 && fila('real-r9').items.some((i) => i.qty === 3 || String(i.id).startsWith('promo:')), 40000);
  assert.equal(hijas('real-r9').length, 0);
  assert.equal(fila('real-r9').estado, 'abierta');
  assert.equal(Number(fila('real-r9').total), 2 * 18000 + 14400, `la mesa paga lo de la cuenta junta (${ver(fila('real-r9').items)})`);
});

test('R9b (r3 D, la otra cara) sin internet con el router ARRIBA (`navigator.onLine` en true, `remoto` todavía «ok»): la mesa completa con el tercer Seco NO se cobra: «Generar ticket y cobrar» sondea la red, no hay, lo dice y la tablet queda «sin red»', { skip: SALTAR }, async () => {
  cuenta('real-r9b', 24, [SECO(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 24);
  await cortarRed(page);
  await sumar(page, 'ej2');
  await page.waitForTimeout(800);
  const antes = await estado(page);
  assert.equal(antes.onLine, true);
  assert.equal(antes.remoto, 'ok', 'el +1 se encoló pero nadie le dijo a la tablet que no hay red');
  await page.evaluate(() => Alpine.store('pos').facturar());
  await hasta(async () => /Sin red: esta cuenta tiene promoción/.test(await aviso(page)), 10000);
  assert.match(await aviso(page), SIN_RED_PROMO);
  assert.equal((await estado(page)).vista, 'orden', 'no se cobró');
  assert.equal(await page.evaluate(() => Alpine.store('pos').ordenes.find((o) => o.id === 'real-r9b').estado), 'abierta');
  assert.equal((await estado(page)).remoto, 'offline');
  await volverRed(page);
  await hasta(async () => (await estado(page)).remoto === 'ok', 30000);
  await hasta(async () => fila('real-r9b').items.some((i) => String(i.id).startsWith('promo:')), 30000);
  assert.equal(fila('real-r9b').estado, 'abierta');
  assert.equal(Number(fila('real-r9b').total), 2 * 18000 + 14400);
});

test('R10 (r3 B) sin internet con el router arriba: 2 Seco, el tercero queda en la cola, el comensal intenta pagar su Seco por partes y la tablet se recarga al volver la red: NO hay cobro por partes que suba antes que el +1; la mesa paga 50.400 (no 54.000)', { skip: SALTAR }, async () => {
  cuenta('real-r10', 20, [SECO(2)]);
  const { page } = await abrirPos('mesero');
  const consola = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consola.push(m.text().slice(0, 200)); });
  await aMesa(page, 20);
  await cortarRed(page);
  await sumar(page, 'ej2');
  await page.waitForTimeout(1500);
  assert.equal((await estado(page)).cola, 1, 'el +1 del tercer Seco está en la cola');
  assert.equal(await cobrar(page, { ej2: 1 }), false);
  assert.equal(await aviso(page), SIN_RED, 'la cola no se vació: el cobro ni salió (no hay nada en duda)');
  assert.equal(hijas('real-r10').length, 0);
  await volverRed(page);
  await page.reload({ waitUntil: 'load' });
  await esperarListo(page);
  await hasta(async () => fila('real-r10').items.some((i) => String(i.id).startsWith('promo:')), 40000);
  await hasta(async () => (await estado(page)).cola === 0 && (await estado(page)).pendientes === 0, 30000);
  assert.equal(hijas('real-r10').length, 0, 'ninguna venta por partes');
  assert.equal(pagado('real-r10'), 2 * 18000 + 14400, `la mesa paga ${pagado('real-r10')}: ${ver(fila('real-r10').items)}`);
});

test('R11 (r3 F) EN LÍNEA: el +1 del tercer Seco falló una vez y quedó en la cola; el mesero cobra su Seco por partes: la cola se vacía PRIMERO, el cobro lleva la versión nueva y la base lo rechaza por la promoción: la mesa paga 50.400', { skip: SALTAR }, async () => {
  cuenta('real-r11', 21, [SECO(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 21);
  let fallar = true;
  const fallo = async (route) => {
    const p = route.request();
    if (fallar && /\/rpc\/aplicar_delta_orden/.test(p.url())) { fallar = false; return route.abort('internetdisconnected'); }
    return route.fallback();
  };
  await page.route(deSupabase, fallo);
  await sumar(page, 'ej2');
  await hasta(async () => (await estado(page)).cola === 1, 10000);
  assert.equal((await estado(page)).cola, 1);
  const n0 = pila.peticiones.length;
  assert.equal(await cobrar(page, { ej2: 1 }), false);
  assert.deepEqual(rpcs(n0).filter((r) => ['aplicar_delta_orden', 'cobrar_parcial'].includes(r)), ['aplicar_delta_orden', 'cobrar_parcial'], 'primero la cola, después el cobro');
  assert.match(await aviso(page), /NO quedó registrado: esa cuenta tiene una promoción/);
  assert.equal(hijas('real-r11').length, 0);
  assert.equal(pagado('real-r11'), 2 * 18000 + 14400);
});

// ═══════════════════ 6. Deshacer y la mesa completa con promoción ═══════════════════

test('R12 deshacer lo que hizo la RPC (mesero): la unidad vuelve y la promo se recalcula (2 Seco → cobra 1 → otro suma 2 → 3 Seco con promo → deshacer: 4 Seco, un solo descuento); un abono se deshace quitando SU crédito', { skip: SALTAR }, async () => {
  cuenta('real-r12', 22, [SECO(2), LIM(1)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 22);
  assert.equal(await cobrar(page, { ej2: 1, be1: 1 }), true);
  const venta = hijas('real-r12')[0];
  pila.pg.sql(`select public.aplicar_delta_orden('real-r12', 'ej2', 'Seco con proteína', 18000, 2, '') is not null;`, { como: 'migrador' });
  assert.match(ver(fila('real-r12').items), /1×Seco con proteína · 3er almuerzo/, '3 Seco juntos: promo');
  await page.evaluate(() => Alpine.store('pos').sincronizarSupabase({ soloEnVivo: true }));
  assert.equal(await page.evaluate(() => Alpine.store('pos').deshacerUltimoCobro()), true);
  await hasta(async () => hijas('real-r12').length === 0);
  const items = fila('real-r12').items;
  assert.equal(items.filter((i) => String(i.id).startsWith('promo:')).reduce((s, i) => s + i.qty, 0), 1, 'un solo descuento: la promo se recalculó con las cuatro unidades');
  assert.equal(items.filter((i) => i.id === 'ej2' || String(i.id).startsWith('promo:')).reduce((s, i) => s + i.qty, 0), 4);
  assert.equal(items.find((i) => i.id === 'be1').qty, 1);
  assert.equal(venta.id && hijas('real-r12').length, 0);
  // un abono y su deshacer
  await page.evaluate(() => { const p = Alpine.store('pos'); p.vista = 'orden'; p.ticketMostrado = null; });
  const antes = Number(fila('real-r12').total);
  assert.equal(await abonar(page, 10000), true);
  assert.equal(Number(fila('real-r12').total), antes - 10000);
  assert.equal(await page.evaluate(() => Alpine.store('pos').deshacerUltimoCobro()), true);
  await hasta(async () => hijas('real-r12').length === 0);
  assert.equal(Number(fila('real-r12').total), antes);
  assert.equal(fila('real-r12').items.some((i) => String(i.id).startsWith('abono_recibido_')), false);
});

test('R13 la mesa completa de una cuenta con promoción, con red: sondea la base (una lectura de una fila), cobra y el total que queda es el que la base registró', { skip: SALTAR }, async () => {
  cuenta('real-r13', 23, [SECO(3)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 23);
  const n0 = pila.peticiones.length;
  await page.evaluate(() => Alpine.store('pos').facturar());
  await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
  await hasta(async () => fila('real-r13').estado === 'cerrada');
  assert.ok(peticiones(n0).some((r) => /\/rest\/v1\/mesas\?select=id&limit=1/.test(r)), `sondeó la red: ${peticiones(n0).join(' | ')}`);
  assert.equal(Number(fila('real-r13').total), 2 * 18000 + 14400);
  assert.equal(await page.evaluate(() => Alpine.store('pos').ordenTicket.total), 50400);
});
