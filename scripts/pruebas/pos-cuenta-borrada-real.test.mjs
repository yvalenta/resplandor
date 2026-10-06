// UNA CUENTA QUE LA BASE YA NO TIENE NO SE COBRA (X1, X2, X3 y N3 de la séptima refutación, 2026-10-06; tareas/2026-10-04-hallazgos-domingo.md): DE PUNTA A PUNTA CON LO REAL.
// Dos tablets (dos páginas con SU localStorage) con el POS REAL y su supabase-js REAL en Chromium → «PostgREST» de _pila-impresion.mjs → Postgres 17 con la cadena COMPLETA de migraciones
// (la lápida de 20261006150000 incluida) y la RLS de un mesero de verdad. La pila no reparte Realtime de `ordenes`: cada tablet solo sabe lo que ella misma lee o lo que la base le contesta.
//   X1  A cobra por partes TODA la cuenta y libera la mesa; B (copia vieja) cobra la mesa completa: antes 124.000 por una mesa de 62.000; ahora no cobra, avisa y muestra la mesa libre
//   X2  A anula el pedido (quita todo) y libera; B cobra la mesa completa: antes una venta fantasma de 62.000; ahora nada
//   X3  SIN red: B cierra PROVISIONAL, A cobra todo y libera; al volver la red de B la base rechaza el INSERT (RS007): la base queda en 62.000 y B avisa que su cobro no quedó
//   X4  la variante sin cuenta vacía: «Deshacer» el cobro completo de una mesa que ya tiene OTRA cuenta pasa los ítems a ésa y borra la cerrada; B, con la copia vieja, ya no la inserta
//   N1  una cuenta abierta sin red y jamás subida que se cierra sin red SIGUE entrando (no es de una cuenta borrada)
//   N3  día de promo: un +1 propio en vuelo al tocar «Sí, cobrar» cierra a la primera con el total de la base y SIN decir que otra tablet la tocó
// Octava refutación (2026-10-06), cada una con el hallazgo reproducido ANTES de la corrección:
//   R1  una cuenta ABIERTA pendiente de subir que otra tablet ya cobró por partes y liberó: la base la rechaza (RS007), NO resucita y no se cobra dos veces (antes 124.000 por 62.000)
//   R2  otra tablet pone un precio a mano (mismas unidades, total MENOR) mientras va en vuelo un +1 propio: se avisa «otra tablet la tocó» con el total nuevo (antes se adoptaba sin aviso)
//   R2b lo mismo con un precio MÁS ALTO: el aviso no se lo atribuye a esta tablet («por lo que acabas de cambiar»)
//   R3  la venta REAL de una cuenta que otra tablet liberó VACÍA y sin historia (esta tablet la atendió sin red): entra, 49.000 (antes se rechazaba y se perdía)
// Se salta, con el motivo, sin Docker o sin Playwright y Chromium.
import { test, before, after, afterEach } from 'node:test';
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

let pila; let servidor; let navegador;
const contextos = [];
before(async () => {
  if (SALTAR) return;
  pila = await levantarPila({ conCola: true });
  servidor = await servirPos(RAIZ, 0);
  navegador = await pw.chromium.launch();
  const r = pila.pg.sql(`insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'e') from generate_series(51, 70) g`);
  if (!r.ok) throw new Error(r.error);
}, { timeout: 600000 });
afterEach(async () => { for (const c of contextos.splice(0)) await c.close().catch(() => {}); });
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
  await pila?.parar().catch(() => {});
});

const SECO = (n) => ({ id: 'ej2', nombre: 'Seco con proteína', precio: 18000, qty: n, nota: '' });
const LIM = (n) => ({ id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: n, nota: '' });
const cuenta = (id, mesa, items) => {
  const r = pila.pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', ${literal(JSON.stringify(items))}::jsonb, 0, now()); update public.mesas set estado = 'ocupada' where id = ${mesa};`);
  if (!r.ok) throw new Error(r.error);
};
const fila = (id) => pila.pg.filas(`select id, estado, total, items, parcial_de, version from public.ordenes where id = ${literal(id)}`)[0];
const ventasDeMesa = (mesa) => pila.pg.filas(`select id, estado, total, items, parcial_de from public.ordenes where mesa_id = ${mesa} and estado = 'cerrada' order by cerrada_en, id`);
const registrado = (mesa) => ventasDeMesa(mesa).reduce((s, v) => s + Number(v.total), 0);
const items = (o) => (o.items || []).map((i) => `${i.qty}x${i.id}@${i.precio}`).sort();
const enLapida = (id) => pila.pg.filas(`select id from privado.ordenes_borradas where id = ${literal(id)}`).length === 1;
const deSupabase = (u) => u.hostname === HOST_SUPABASE;
async function hasta(cond, ms = 30000) { const fin = Date.now() + ms; for (;;) { const v = await cond(); if (v) return v; if (Date.now() > fin) return v; await new Promise((r) => setTimeout(r, 150)); } }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const diaBogota = () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', weekday: 'short' }).format(new Date())) + 1;
const HOY = diaBogota();
const FRASE = 'Esta cuenta ya no está en la base: otra tablet la cobró o la liberó';

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
  await page.evaluate(() => { const p = Alpine.store('pos'); window.__avisos = []; const orig = p.avisar.bind(p); p.avisar = (t, ms, a) => { if (t) window.__avisos.push(t); return orig(t, ms, a); }; });
  return { page, ctx };
}
const aMesa = async (page, n) => {
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).click();
  await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
};
const local = (page, id) => page.evaluate((x) => {
  const p = Alpine.store('pos'); const o = p.ordenes.find((y) => y.id === x);
  return { remoto: p.remoto, vista: p.vista, existe: !!o, pendiente: !!p._pendientes['ordenes:' + x], estado: o ? o.estado : null, subida: o ? o.subida : null, version: o ? o.version : null,
    items: o ? o.items.map((i) => `${i.qty}x${i.id}@${i.precio}`).sort() : null, total: p.totalOrdenActiva, modal: p.modalConfirmFactura, mesaLibre: (p.mesas.find((m) => m.id === (o ? o.mesaId : -1)) || {}).estado, avisos: (window.__avisos || []).slice() };
}, id);
const sinRed = async (X) => { await X.ctx.setOffline(true); await X.page.evaluate(() => window.dispatchEvent(new Event('offline'))); await hasta(async () => (await local(X.page, 'ninguna')).remoto === 'offline', 5000); };
const conRed = async (X) => { await X.ctx.setOffline(false); await X.page.evaluate(() => window.dispatchEvent(new Event('online'))); };
const prueba = (nombre, fn) => test(nombre, { skip: SALTAR, timeout: 240000 }, fn);
const producto = (page, id) => page.evaluate((x) => { const p = Alpine.store('pos'); p._agregarAlPedido(p.productos.find((q) => q.id === x), ''); }, id);
const liberar = (page) => page.evaluate(() => { window.confirm = () => true; return Alpine.store('pos').liberarMesaVacia(); });
const filaDelCuerpo = (req) => { try { const b = JSON.parse(req.postData() || 'null'); return Array.isArray(b) ? b[0] : b; } catch { return null; } };

prueba('X1 A cobra TODA la cuenta por partes y libera la mesa; B (copia vieja) toca «Sí, cobrar» → no cobra, avisa, muestra la mesa libre y la base suma 62.000 (antes 124.000)', async () => {
  const id = 'bo-x1'; const mesa = 51;
  cuenta(id, mesa, [SECO(2), LIM(2)]);   // 62.000
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').facturarParcial({ ej2: 2, be1: 2 })), true, 'A cobra todo por partes');
  await hasta(async () => ventasDeMesa(mesa).length === 1 && items(fila(id)).length === 0, 15000);
  await A.page.evaluate(() => { Alpine.store('pos').volverAMesas(); });
  await aMesa(A.page, mesa);
  await liberar(A.page);
  await hasta(async () => !fila(id), 10000);
  assert.ok(enLapida(id), 'la base recuerda la cuenta borrada');
  const b0 = await local(B.page, id);
  assert.deepEqual(b0.items, ['2xbe1@13000', '2xej2@18000'], 'B tiene la copia vieja (sin Realtime)');
  assert.equal(b0.subida, true, 'y sabe que esa cuenta estuvo en la base');
  await B.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await B.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => (await local(B.page, id)).avisos.length > 0 || ventasDeMesa(mesa).length >= 2, 15000);
  await dormir(1500);
  const b = await local(B.page, id);
  assert.equal(registrado(mesa), 62000, `la base registró ${registrado(mesa)} por una mesa de 62.000: ${JSON.stringify(ventasDeMesa(mesa).map((v) => [Number(v.total), items(v), v.parcial_de]))}`);
  assert.ok(b.avisos.some((a) => a.includes(FRASE)), `B avisa: ${JSON.stringify(b.avisos)}`);
  assert.equal(b.vista, 'mesas', 'B sale de la cuenta que ya no existe');
  assert.equal(b.existe, false, 'y la copia vieja ya no está');
  assert.equal(b.modal, false);
  assert.equal(await B.page.evaluate(() => Alpine.store('pos').mesas.find((m) => m.id === 51).estado), 'libre', 'B ve la mesa libre');
});

prueba('X2 A anula el pedido (quita todo) y libera; B (copia vieja) toca «Sí, cobrar» → ninguna venta fantasma', async () => {
  const id = 'bo-x2'; const mesa = 52;
  cuenta(id, mesa, [SECO(2), LIM(2)]);
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  await A.page.evaluate(() => { const p = Alpine.store('pos'); for (const it of [...p.ordenActiva.items]) p._enviarDelta(p.ordenActiva, it, -it.qty); p.ordenActiva.items = []; });
  await hasta(async () => fila(id) && items(fila(id)).length === 0, 10000);
  await liberar(A.page);
  await hasta(async () => !fila(id), 10000);
  await B.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await B.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => (await local(B.page, id)).avisos.length > 0 || ventasDeMesa(mesa).length >= 1, 15000);
  await dormir(1500);
  assert.equal(registrado(mesa), 0, `la base registró una venta de ${registrado(mesa)} de una cuenta anulada`);
  assert.ok((await local(B.page, id)).avisos.some((a) => a.includes(FRASE)));
});

prueba('X3 SIN red: B cierra PROVISIONAL, A cobra todo por partes y libera; al volver la red de B la base rechaza el INSERT (RS007): 62.000, y B avisa que su cobro sin conexión NO quedó', async () => {
  const id = 'bo-x3'; const mesa = 53;
  cuenta(id, mesa, [SECO(2), LIM(2)]);
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  await sinRed(B);
  await B.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await B.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => (await local(B.page, id)).estado === 'cerrada', 5000);
  assert.equal((await local(B.page, id)).estado, 'cerrada', 'B cerró sin red');
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').facturarParcial({ ej2: 2, be1: 2 })), true);
  await hasta(async () => ventasDeMesa(mesa).length === 1, 10000);
  await liberar(A.page);
  await hasta(async () => !fila(id), 10000);
  await conRed(B);
  await hasta(async () => !(await local(B.page, id)).existe, 30000);
  await dormir(1500);
  const b = await local(B.page, id);
  assert.equal(registrado(mesa), 62000, `la base registró ${registrado(mesa)} por una mesa de 62.000`);
  assert.equal(fila(id), undefined, 'no se insertó la cuenta');
  assert.equal(b.existe, false, 'B descartó la venta que la base rechazó');
  assert.equal(b.pendiente, false, 'y no la reintenta para siempre');
  assert.ok(b.avisos.some((a) => /El cobro de la Mesa 53 que hiciste sin conexión NO quedó registrado/.test(a) && /esa cuenta ya no existe en la base/.test(a)), `B avisa: ${JSON.stringify(b.avisos)}`);
  assert.equal(b.vista, 'mesas');
});

prueba('X4 «Deshacer» el cobro completo de una mesa que ya tiene OTRA cuenta pasa los ítems a ésa y borra la cerrada: B, con la copia vieja, ya no la inserta (la variante que no necesita una cuenta vacía)', async () => {
  const id = 'bo-x4'; const mesa = 54;
  cuenta(id, mesa, [SECO(1), LIM(1)]);   // 31.000
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  await A.page.evaluate(() => { const p = Alpine.store('pos'); p.modalConfirmFactura = true; return p.facturar(); });
  await hasta(async () => fila(id) && fila(id).estado === 'cerrada', 15000);
  await dormir(500);
  cuenta('bo-x4-otra', mesa, [LIM(1)]);   // el cliente siguiente ocupa la mesa
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').deshacerUltimoCobro()), true, 'A deshace el cobro completo');
  await hasta(async () => !fila(id), 15000);
  assert.ok(enLapida(id), 'deshacer_cobro borró la cerrada: la lápida lo recuerda');
  assert.equal(Number(fila('bo-x4-otra').total), 13000 + 31000, 'los ítems pasaron a la otra cuenta');
  assert.equal((await local(B.page, id)).existe, true, 'B sigue con su copia vieja');
  await B.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await B.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => (await local(B.page, id)).avisos.length > 0 || ventasDeMesa(mesa).length >= 1, 15000);
  await dormir(1500);
  assert.equal(registrado(mesa), 0, `la base registró ${registrado(mesa)}: B no debía poder cobrar la cuenta que se deshizo`);
  assert.ok((await local(B.page, id)).avisos.some((a) => a.includes(FRASE)));
});

prueba('N1 una cuenta abierta SIN red y jamás subida que se cierra sin red SIGUE entrando: al volver la red la venta se inserta (su id no está en la lápida) y la cuenta pasa a llevar la marca de subida', async () => {
  const mesa = 55;
  const B = await abrirPos();
  await sinRed(B);
  await B.page.locator('.mesa-card', { has: B.page.locator('.mesa-num', { hasText: new RegExp(`^${mesa}$`) }) }).click();
  await B.page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
  const id = await B.page.evaluate(() => Alpine.store('pos').ordenActiva.id);
  await producto(B.page, 'ej2'); await producto(B.page, 'be1');
  assert.ok(!(await local(B.page, id)).subida, 'jamás estuvo en la base (sin la marca de subida)');
  assert.equal(fila(id), undefined);
  await B.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await B.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => (await local(B.page, id)).estado === 'cerrada', 5000);
  await conRed(B);
  await hasta(async () => fila(id) && fila(id).estado === 'cerrada', 30000);
  await dormir(1000);
  assert.equal(fila(id).estado, 'cerrada', 'la venta entró');
  assert.equal(Number(fila(id).total), 18000 + 13000);
  const b = await local(B.page, id);
  assert.equal(b.subida, true);
  assert.ok(!b.avisos.some((a) => /ya no existe|NO quedó registrado/.test(a)), JSON.stringify(b.avisos));
});

prueba('N3 día de promo: un +1 propio todavía en vuelo (la respuesta tarda 1,5 s) al tocar «Sí, cobrar» cierra a la primera con el total de la base y SIN decir que «otra tablet la tocó»', async () => {
  const id = 'bo-n3'; const mesa = 56;
  pila.pg.sql(`insert into public.productos (id, categoria, nombre, precio, activo, dia_semana, promo_regla) values ('bo-promo', 'Promociones', 'Prueba 3er Seco', 0, true, ${HOY}, '{"cada":3,"descuento":20,"aplica":{"productos":["ej2"]}}'::jsonb) on conflict (id) do nothing`);
  try {
    cuenta(id, mesa, [SECO(2), LIM(1)]);
    const A = await abrirPos();
    await aMesa(A.page, mesa);
    const trampa = async (route) => { if (route.request().url().includes('/rpc/aplicar_delta_orden')) await dormir(1500); return route.fallback(); };
    await A.page.route(deSupabase, trampa);
    await A.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
    await producto(A.page, 'ej2');
    assert.equal((await local(A.page, id)).total, 3 * 18000 + 13000, 'la pantalla decía 67.000');
    await A.page.getByRole('button', { name: 'Sí, cobrar' }).click();
    await hasta(async () => fila(id).estado === 'cerrada' || (await local(A.page, id)).avisos.length > 0, 15000);
    await dormir(800);
    const a = await local(A.page, id);
    assert.equal(fila(id).estado, 'cerrada', `cierra a la primera: ${JSON.stringify(a.avisos)}`);
    assert.equal(Number(fila(id).total), 63400, 'el total que registra la base (el tercer Seco con 20 %)');
    assert.ok(!a.avisos.some((x) => /otra tablet|cambió en la base/.test(x)), `ninguna otra tablet la tocó: ${JSON.stringify(a.avisos)}`);
    await A.page.unroute(deSupabase, trampa);
  } finally { pila.pg.sql("delete from public.productos where id = 'bo-promo'"); }
});

// R1 — LA CUENTA ABIERTA QUE RESUCITA. B abre la mesa SIN red y pide 62.000 (deltas en cola). Vuelve la red un momento: el esqueleto y los cambios entran (la base ya tiene la cuenta con 62.000),
// pero la subida de la fila completa (paso 3 de _subirLoPendiente) se corta (el Wi-Fi cae ahí) y la cuenta sigue «pendiente» en B. A cobra TODO por partes y libera: la cuenta se borra y la lápida la
// anota CON ítems. Vuelve la red de B: antes `_subirLoPendiente` la subía abierta con los ítems viejos, la guardia solo miraba cerradas y trg_ordenes_olvidar_borrada la sacaba de la lápida; una
// tablet nueva C entraba a la mesa y la cobraba completa: 124.000 por 62.000. Ahora la base rechaza esa fila (RS007) y B la descarta.
prueba('R1 una cuenta ABIERTA pendiente de subir que otra tablet ya cobró por partes y liberó NO resucita: RS007, la base registra 62.000 (antes 124.000), B la descarta y avisa, y una tablet nueva ve la mesa libre', async () => {
  const mesa = 60;
  const B = await abrirPos();
  await sinRed(B);
  await aMesa(B.page, mesa);
  const id = await B.page.evaluate(() => Alpine.store('pos').ordenActiva.id);
  await producto(B.page, 'ej2'); await producto(B.page, 'ej2'); await producto(B.page, 'be1'); await producto(B.page, 'be1');   // 62.000, sin red
  let cortes = 0;
  const corte = async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && /\/rest\/v1\/ordenes(\?|$)/.test(req.url())) {
      const f = filaDelCuerpo(req);
      if (f && f.id === id && f.estado === 'abierta' && Array.isArray(f.items) && f.items.length > 0) { cortes++; return route.abort('internetdisconnected'); }
    }
    return route.fallback();
  };
  await B.page.route(deSupabase, corte);
  await conRed(B);
  await hasta(async () => cortes > 0, 20000);
  await sinRed(B);
  await B.page.unroute(deSupabase, corte);
  assert.ok(fila(id) && items(fila(id)).length === 2, 'la base ya tiene la cuenta con los 62.000 (esqueleto y cambios entraron)');
  assert.equal((await local(B.page, id)).pendiente, true, 'y en B la fila completa sigue pendiente de subir');
  // A (otra tablet, con red) cobra TODO por partes y libera la mesa
  const A = await abrirPos();
  await aMesa(A.page, mesa);
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').facturarParcial({ ej2: 2, be1: 2 })), true, 'A cobra todo por partes');
  await hasta(async () => ventasDeMesa(mesa).length === 1 && items(fila(id)).length === 0, 15000);
  await A.page.evaluate(() => { Alpine.store('pos').volverAMesas(); });
  await aMesa(A.page, mesa);
  await liberar(A.page);
  await hasta(async () => !fila(id), 10000);
  assert.ok(enLapida(id), 'la lápida la recuerda');
  assert.equal(pila.pg.filas(`select tenia_items from privado.ordenes_borradas where id = ${literal(id)}`)[0].tenia_items, true, 'y sabe que tenía ítems');
  assert.equal(registrado(mesa), 62000, 'A cobró 62.000');
  // vuelve la red de B: la fila abierta con los ítems viejos sube y la base la rechaza
  await conRed(B);
  await hasta(async () => !(await local(B.page, id)).existe, 30000);
  await dormir(1500);
  const b = await local(B.page, id);
  assert.equal(fila(id), undefined, 'la cuenta NO resucitó en la base');
  assert.ok(enLapida(id), 'y la lápida la sigue recordando');
  assert.equal(b.existe, false, 'B descartó su copia pendiente');
  assert.equal(b.pendiente, false, 'y no la reintenta para siempre');
  assert.ok(b.avisos.some((a) => /La cuenta de la Mesa 60 que esta tablet tenía pendiente de subir ya no existe en la base/.test(a) && /no se vuelve a subir para que no se cobre dos veces/.test(a)), `B avisa: ${JSON.stringify(b.avisos)}`);
  assert.equal(b.vista, 'mesas');
  // una tablet NUEVA ve la mesa libre y puede abrir una cuenta nueva; la base sigue en 62.000
  const C = await abrirPos();
  const c = await C.page.evaluate((m) => { const p = Alpine.store('pos'); return { mesa: (p.mesas.find((x) => x.id === m) || {}).estado, abierta: p.ordenes.some((x) => x.mesaId === m && x.estado === 'abierta') }; }, mesa);
  assert.deepEqual(c, { mesa: 'libre', abierta: false }, 'C ve la mesa libre y sin cuenta');
  assert.equal(registrado(mesa), 62000, `la base registra ${registrado(mesa)} por una mesa de 62.000`);
});

// R2 — AJENO CON LAS MISMAS UNIDADES. Otra tablet pone a mano un precio MÁS BAJO (Limonada 13.000 → 5.000) y esta tablet, con un +1 propio en vuelo, toca «Sí, cobrar»: antes `_facturarReleyendo` veía
// las mismas unidades y un total que no sube, lo adoptaba SIN aviso y cerraba con un total que el diálogo no mostraba.
prueba('R2 otra tablet baja un precio a mano (mismas unidades) y A, con un +1 propio en vuelo, NO cierra sin aviso: «otra tablet la tocó» con el total nuevo', async () => {
  const id = 'bo-r2'; const mesa = 61;
  cuenta(id, mesa, [SECO(2), LIM(1)]);   // 49.000
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  assert.equal(await B.page.evaluate(() => { const p = Alpine.store('pos'); const it = p.ordenActiva.items.find((i) => i.id === 'be1'); return p.fijarPrecioLinea(it, 5000); }), true);
  await hasta(async () => (fila(id).items || []).some((i) => i.id === 'be1' && Number(i.precio) === 5000), 10000);
  const trampa = async (route) => { if (route.request().url().includes('/rpc/aplicar_delta_orden')) await dormir(1500); return route.fallback(); };
  await A.page.route(deSupabase, trampa);
  await A.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await producto(A.page, 'ej2');
  assert.equal((await local(A.page, id)).total, 3 * 18000 + 13000, 'A no se enteró: la pantalla decía 67.000');
  await A.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => fila(id).estado === 'cerrada' || (await local(A.page, id)).avisos.length > 0, 15000);
  await dormir(800);
  const a = await local(A.page, id);
  await A.page.unroute(deSupabase, trampa);
  assert.notEqual(fila(id).estado, 'cerrada', `A cerró por ${Number(fila(id).total)} (la pantalla decía 67.000) sin que nadie confirmara el total nuevo`);
  assert.ok(a.avisos.some((x) => /La cuenta cambió en la base desde que la abriste \(otra tablet la tocó\)/.test(x) && /pantalla decía \$ 67\.000/.test(x)), `A avisa que otra tablet la tocó: ${JSON.stringify(a.avisos)}`);
  assert.ok(!a.avisos.some((x) => /por lo que acabas de cambiar/.test(x)));
  assert.equal(a.modal, true, 'el diálogo sigue abierto con el total nuevo');
});

prueba('R2b otra tablet SUBE un precio a mano (mismas unidades) y A, con un +1 propio en vuelo, recibe «otra tablet la tocó», no «por lo que acabas de cambiar»', async () => {
  const id = 'bo-r2b'; const mesa = 62;
  cuenta(id, mesa, [SECO(2), LIM(1)]);
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  assert.equal(await B.page.evaluate(() => { const p = Alpine.store('pos'); const it = p.ordenActiva.items.find((i) => i.id === 'be1'); return p.fijarPrecioLinea(it, 20000); }), true);
  await hasta(async () => (fila(id).items || []).some((i) => i.id === 'be1' && Number(i.precio) === 20000), 10000);
  const trampa = async (route) => { if (route.request().url().includes('/rpc/aplicar_delta_orden')) await dormir(1500); return route.fallback(); };
  await A.page.route(deSupabase, trampa);
  await A.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await producto(A.page, 'ej2');
  await A.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => fila(id).estado === 'cerrada' || (await local(A.page, id)).avisos.length > 0, 15000);
  await dormir(800);
  const a = await local(A.page, id);
  await A.page.unroute(deSupabase, trampa);
  assert.notEqual(fila(id).estado, 'cerrada');
  assert.ok(a.avisos.some((x) => /La cuenta cambió en la base desde que la abriste \(otra tablet la tocó\)/.test(x)), `A avisa que otra tablet la tocó: ${JSON.stringify(a.avisos)}`);
  assert.ok(!a.avisos.some((x) => /por lo que acabas de cambiar/.test(x)), `el cambio fue de OTRA tablet y el aviso se lo atribuía a A: ${JSON.stringify(a.avisos)}`);
});

// R3 — LA VENTA REAL QUE NADIE MÁS COBRÓ. B abre la mesa CON red (la cuenta nace vacía en la base) y se queda SIN red; toma el pedido sin red (los ítems nunca llegan). A ve la mesa ocupada con una
// cuenta VACÍA y toca «Liberar mesa» (la base la borra: lápida con `tenia_items` falso). B cobra sin red (PROVISIONAL) y al volver la red la venta —la única de esa mesa: nadie cobró nada— antes chocaba
// con la lápida (RS007) y el POS la descartaba («otra tablet la cobró por partes…», que nunca pasó). Ahora entra.
prueba('R3 la venta sin red de una cuenta que otra tablet liberó VACÍA y sin historia (nadie cobró nada) ENTRA: la base registra los 49.000 y B no recibe ningún aviso de «no quedó registrado»', async () => {
  const mesa = 63;
  const B = await abrirPos();
  await aMesa(B.page, mesa);
  const id = await B.page.evaluate(() => Alpine.store('pos').ordenActiva.id);
  await hasta(async () => !!fila(id) && !(await local(B.page, id)).pendiente, 10000);
  assert.ok(fila(id) && items(fila(id)).length === 0, 'la cuenta nació vacía en la base');
  await sinRed(B);
  await producto(B.page, 'ej2'); await producto(B.page, 'ej2'); await producto(B.page, 'be1');   // 49.000, sin red
  const A = await abrirPos();
  await aMesa(A.page, mesa);
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').ordenActiva.items.length), 0, 'A ve la cuenta vacía');
  await liberar(A.page);
  await hasta(async () => !fila(id), 10000);
  assert.ok(enLapida(id), 'la lápida anotó la cuenta');
  assert.equal(pila.pg.filas(`select tenia_items from privado.ordenes_borradas where id = ${literal(id)}`)[0].tenia_items, false, 'pero sabe que estaba vacía y sin historia: nadie decidió sobre ítems');
  assert.equal(registrado(mesa), 0);
  await B.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await B.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => (await local(B.page, id)).estado === 'cerrada', 5000);
  await conRed(B);
  await hasta(async () => fila(id) && fila(id).estado === 'cerrada', 30000);
  await dormir(1500);
  const b = await local(B.page, id);
  assert.equal(registrado(mesa), 49000, `la venta real y única de la mesa (49.000) tiene que quedar: la base registra ${registrado(mesa)}`);
  assert.equal(ventasDeMesa(mesa).length, 1, 'una sola vez');
  assert.ok(!b.avisos.some((a) => /NO quedó registrado|ya no existe/.test(a)), `B no recibe un aviso falso: ${JSON.stringify(b.avisos)}`);
  assert.equal(b.pendiente, false);
});
