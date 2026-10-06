// LA VERSIÓN LOCAL NUNCA SUBE SIN LOS ÍTEMS QUE LA ACOMPAÑAN y «no llegó» no es definitivo mientras la petición pueda seguir en camino: DE PUNTA A PUNTA CON LO REAL
// (sexta refutación, 2026-10-06; tareas/2026-10-04-hallazgos-domingo.md). Dos tablets (dos páginas con SU localStorage) con el POS REAL y su supabase-js REAL en Chromium →
// «PostgREST» de _pila-impresion.mjs → Postgres 17 con la cadena COMPLETA de migraciones y la RLS de un mesero de verdad. La pila no reparte Realtime de `ordenes`
// (como una tablet con el WebSocket caído o un evento que no llegó): cada tablet solo sabe lo que ella misma lee o lo que la base le contesta.
// Los cuatro guiones de la refutación r6 (refutacion-r6/pos-otra-tablet-version-anotada.test.mjs en el paquete de coordinación), que antes ROMPÍAN el dinero y ahora cuadran:
//   T1  A cobra por partes 1 Limonada y la base contesta; B (copia vieja) asigna una persona y cobra la mesa completa: antes 75.000 por 62.000
//   T2  A tiene el cobro en duda (congelada) y B sigue trabajando la misma cuenta: lo mismo
//   T3  la petición del cobro se cuelga hasta pasado el tope de 10 s y la base la termina DESPUÉS de que la reconciliación dijo «no llegó»: antes se descongelaba y daba 75.000
//   T4  recarga con «Registrando…» colgado: la reconciliación del arranque decía «no llegó» antes de que la base terminara: lo mismo
// Y lo que la regla pide de más: la mesa completa CON red relee la cuenta (T1b: la copia vieja sin ningún gesto), y la espera de 30 s se cumple (T5: pasan 30 s sin la venta).
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
  const r = pila.pg.sql(`insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'f') from generate_series(51, 70) g`);
  if (!r.ok) throw new Error(r.error);
}, { timeout: 600000 });
// Cada tablet de una prueba se cierra al terminar ella: una página vieja seguiría preguntando y escribiendo contra la misma base y ensuciaría las cuentas de las siguientes.
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
const deSupabase = (u) => u.hostname === HOST_SUPABASE;
async function hasta(cond, ms = 30000) { const fin = Date.now() + ms; for (;;) { const v = await cond(); if (v) return v; if (Date.now() > fin) return v; await new Promise((r) => setTimeout(r, 200)); } }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await anotarAvisos(page);
  return { page, ctx };
}
const anotarAvisos = (page) => page.evaluate(() => { const p = Alpine.store('pos'); window.__avisos = []; const orig = p.avisar.bind(p); p.avisar = (t, ms, a) => { if (t) window.__avisos.push(t); return orig(t, ms, a); }; });
const aMesa = async (page, n) => {
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).click();
  await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
};
const local = (page, id) => page.evaluate((x) => {
  const p = Alpine.store('pos'); const o = p.ordenes.find((y) => y.id === x);
  return { remoto: p.remoto, cola: p.colaDeltas.length, enDuda: Object.keys(p.cobrosEnDuda || {}), congelada: p._cuentaCongelada(x), desactualizada: !!(o && o.desactualizada), version: o ? o.version : null,
    estado: o ? o.estado : null, items: o ? o.items.map((i) => `${i.qty}x${i.id}@${i.precio}`).sort() : null, total: p.totalOrdenActiva, modal: p.modalConfirmFactura, avisos: (window.__avisos || []).slice() };
}, id);
/** La primera llamada a `fn` llega a la base (la aplica) y la respuesta se pierde. */
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
/** La petición de `fn` queda EN CAMINO: la base la tiene pero no la termina hasta que la prueba la suelta (una espera de candado, una cola); al soltarla se aplica y la conexión se corta. */
async function peticionEnCamino(page, fn) {
  const estadoP = { tomada: false, atendida: null };
  let soltar; const llego = new Promise((r) => { soltar = r; });
  const trampa = async (route) => {
    const pedido = route.request();
    if (estadoP.tomada || !pedido.url().includes(`/rpc/${fn}`) || pedido.method() !== 'POST') return route.fallback();
    estadoP.tomada = true;
    const cab = {}; for (const [k, v] of Object.entries(pedido.headers())) cab[k.toLowerCase()] = v;
    const cuerpo = pedido.postData() || ''; const url = new URL(pedido.url());
    estadoP.atendida = llego.then(() => pila.atender({ metodo: 'POST', url, cabeceras: cab, cuerpo }));
    await estadoP.atendida;
    return route.abort('connectionreset').catch(() => {});
  };
  await page.route(deSupabase, trampa);
  return { estado: estadoP, soltar: async () => { soltar(); await estadoP.atendida; }, quitar: () => page.unroute(deSupabase, trampa) };
}
/** Pasa el tiempo en la página: el instante en que se asentó cada cobro en duda se corre hacia atrás (equivale a esperar `ms`). */
const envejecer = (page, ms) => page.evaluate((m) => { const p = Alpine.store('pos'); for (const i of Object.values(p.cobrosEnDuda)) if (i.enviado) p._guardarCobroEnDuda({ ...i, asentadoEn: Date.now() - m }); }, ms);
const mesaCompleta = (page) => page.evaluate(() => Alpine.store('pos').facturar());
const asignarSeco = (page) => page.evaluate(() => { const p = Alpine.store('pos'); p.ciclarPagador(p.ordenActiva.items.find((i) => i.id === 'ej2')); });

test('T1 otra tablet con la copia vieja: A cobra por partes 1 Limonada (respuesta normal); B asigna persona y cobra la mesa completa → la base registra 62.000 (antes 75.000)', { skip: SALTAR, timeout: 240000 }, async () => {
  const id = 'ot-t1'; const mesa = 51;
  cuenta(id, mesa, [SECO(2), LIM(2)]);   // 62.000
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 })), true, 'A cobró por partes');
  await hasta(async () => ventasDeMesa(mesa).length === 1 && items(fila(id)).includes('1xbe1@13000'), 15000);
  assert.deepEqual((await local(B.page, id)).items, ['2xbe1@13000', '2xej2@18000'], 'B tiene la copia vieja (sin Realtime)');
  await asignarSeco(B.page);
  await hasta(async () => (await local(B.page, id)).version === fila(id).version, 10000);
  const b1 = await local(B.page, id);
  assert.equal(b1.version, fila(id).version, 'la versión de B es la de la base…');
  assert.deepEqual(b1.items, items(fila(id)), '…y con los ítems de esa versión (la Limonada que A cobró ya no está): antes eran los viejos');
  assert.equal(b1.desactualizada, false);
  await mesaCompleta(B.page);
  await hasta(async () => fila(id).estado === 'cerrada', 15000);
  await dormir(1000);
  assert.equal(registrado(mesa), 62000, `la base registró ${registrado(mesa)} por una mesa de 62.000: ${JSON.stringify(ventasDeMesa(mesa).map((v) => [Number(v.total), items(v)]))}`);
  assert.deepEqual((await local(B.page, id)).avisos, [], 'B no vio ninguna alerta: lo cobrado cuadra');
});

test('T1b la copia vieja SIN ningún gesto: B toca «Generar ticket y cobrar» → «Sí, cobrar»; la tablet relee la cuenta, avisa del total nuevo ($ 49.000, no $ 62.000) y NO cierra; al confirmar de nuevo cierra con eso y la base suma 62.000', { skip: SALTAR, timeout: 240000 }, async () => {
  const id = 'ot-t1b'; const mesa = 52;
  cuenta(id, mesa, [SECO(2), LIM(2)]);
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 })), true);
  await hasta(async () => ventasDeMesa(mesa).length === 1, 15000);
  assert.equal((await local(B.page, id)).total, 62000, 'B todavía ve $ 62.000');
  await B.page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
  await B.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => (await local(B.page, id)).total === 49000, 10000);
  await dormir(500);
  const b = await local(B.page, id);
  assert.equal(b.total, 49000, 'B adoptó la cuenta de la base');
  assert.equal(b.estado, 'abierta', 'no cerró');
  assert.equal(fila(id).estado, 'abierta', 'la base tampoco');
  assert.equal(registrado(mesa), 13000, 'solo lo que A cobró');
  assert.equal(b.modal, true, 'el diálogo sigue abierto');
  assert.ok(b.avisos.some((a) => /\$ 49\.000/.test(a) && /\$ 62\.000/.test(a) && /otra vez/.test(a)), JSON.stringify(b.avisos));
  assert.match(await B.page.locator('.modal-backdrop:visible .texto-dialogo').first().innerText(), /49\.000/, 'y el diálogo muestra el total nuevo');
  await B.page.getByRole('button', { name: 'Sí, cobrar' }).click();
  await hasta(async () => fila(id).estado === 'cerrada', 15000);
  await dormir(800);
  assert.equal(registrado(mesa), 62000, `la base registró ${registrado(mesa)}`);
});

test('T2 A tiene el cobro EN DUDA (congelada) y B sigue trabajando la cuenta: B asigna persona y cobra la mesa completa → 62.000; A, al reconciliar, adopta lo de la base', { skip: SALTAR, timeout: 240000 }, async () => {
  const id = 'ot-t2'; const mesa = 53;
  cuenta(id, mesa, [SECO(2), LIM(2)]);
  const A = await abrirPos(); const B = await abrirPos();
  await aMesa(A.page, mesa); await aMesa(B.page, mesa);
  const soltar = await perderRespuesta(A.page, 'cobrar_parcial');
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 })), false);
  await hasta(async () => ventasDeMesa(mesa).length === 1, 10000);
  await soltar();
  assert.equal((await local(A.page, id)).congelada, true);
  await asignarSeco(B.page);
  await hasta(async () => (await local(B.page, id)).version === fila(id).version, 10000);
  assert.deepEqual((await local(B.page, id)).items, items(fila(id)), 'B quedó con los ítems de la base');
  await mesaCompleta(B.page);
  await hasta(async () => fila(id).estado === 'cerrada', 15000);
  await dormir(1000);
  assert.equal(registrado(mesa), 62000, `la base registró ${registrado(mesa)} por una mesa de 62.000`);
  await A.page.evaluate((x) => Alpine.store('pos').reintentarCobroEnDuda(x), id);
  await hasta(async () => !(await local(A.page, id)).congelada, 15000);
  const a = await local(A.page, id);
  assert.equal(a.congelada, false);
  assert.equal(registrado(mesa), 62000, 'preguntar no cobró otra vez');
});

test('T3 la petición del cobro se cuelga más allá del tope de 10 s y la base la termina DESPUÉS: la cuenta NO se descongela mientras tanto (ni con la pregunta de cada 7 s), la venta se adopta al llegar, y el gesto y la mesa completa suman 62.000', { skip: SALTAR, timeout: 240000 }, async () => {
  const id = 'ot-t3'; const mesa = 54;
  cuenta(id, mesa, [SECO(2), LIM(2)]);
  const A = await abrirPos();
  await aMesa(A.page, mesa);
  const colgada = await peticionEnCamino(A.page, 'cobrar_parcial');
  const cobro = A.page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 }));
  assert.equal(await cobro, false, 'el tope de 10 s: sin respuesta');
  const t1 = await local(A.page, id);
  assert.equal(t1.congelada, true);
  // dos vueltas de la pregunta de cada 7 s: la base contesta «no llegó» y la cuenta SIGUE congelada
  await dormir(15500);
  const t2 = await local(A.page, id);
  assert.equal(t2.congelada, true, 'sigue congelada: «no llegó» todavía no es definitivo');
  assert.equal(t2.remoto, 'ok', 'y la base sí contestaba');
  assert.equal(ventasDeMesa(mesa).length, 0, 'la base todavía no tenía el cobro');
  await colgada.soltar();                                               // la base termina el cobro
  await hasta(async () => ventasDeMesa(mesa).length === 1, 10000);
  await colgada.quitar();
  await hasta(async () => !(await local(A.page, id)).congelada, 25000);
  const t3 = await local(A.page, id);
  assert.equal(t3.congelada, false, 'la siguiente pregunta adopta la venta');
  assert.deepEqual(t3.items, items(fila(id)), 'con la cuenta de la base: ya sin la Limonada cobrada');
  assert.ok(t3.avisos.some((a) => /SÍ quedó registrado en la base/.test(a)));
  assert.equal(ventasDeMesa(mesa).length, 1, 'no se cobró otra vez');
  await A.page.evaluate(() => { const p = Alpine.store('pos'); p.avisar(''); p.seleccionCobro = false; p.itemsSeleccionados = {}; p.volverAMesas(); });
  await aMesa(A.page, mesa);
  await asignarSeco(A.page);
  await hasta(async () => (await local(A.page, id)).version === fila(id).version, 10000);
  await mesaCompleta(A.page);
  await hasta(async () => fila(id).estado === 'cerrada', 15000);
  await dormir(1000);
  assert.equal(registrado(mesa), 62000, `la base registró ${registrado(mesa)} por una mesa de 62.000 (antes 75.000)`);
});

test('T4 recarga con «Registrando…» colgado: la página nueva nace congelada, la reconciliación del arranque dice «no llegó» y la cuenta NO se descongela; la base termina el cobro, se adopta, y el gesto y la mesa completa suman 62.000', { skip: SALTAR, timeout: 240000 }, async () => {
  const id = 'ot-t4'; const mesa = 55;
  cuenta(id, mesa, [SECO(2), LIM(2)]);
  const A = await abrirPos();
  await aMesa(A.page, mesa);
  const colgada = await peticionEnCamino(A.page, 'cobrar_parcial');
  A.page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 })).catch(() => {});
  await hasta(async () => colgada.estado.tomada, 10000);
  await dormir(1500);                                                   // «Registrando…» colgado
  const guardado = await A.page.evaluate((x) => JSON.parse(localStorage.getItem('pos_cobros_en_duda') || '{}')[x] || null, id);
  assert.equal(guardado && guardado.enviado, true, 'el intento ya estaba guardado como enviado');
  await A.page.reload({ waitUntil: 'load' });
  await esperarListo(A.page);
  await anotarAvisos(A.page);
  const t0 = await local(A.page, id);
  assert.equal(t0.congelada, true, 'la página nueva nace congelada');
  await hasta(async () => (await local(A.page, id)).remoto === 'ok', 15000);
  await dormir(9000);                                                   // la reconciliación del arranque y una vuelta de 7 s: «no llegó»
  const t1 = await local(A.page, id);
  assert.equal(t1.congelada, true, 'sigue congelada: la petición todavía puede entrar');
  assert.equal(ventasDeMesa(mesa).length, 0, 'la base todavía no terminó el cobro');
  await colgada.soltar();
  await hasta(async () => ventasDeMesa(mesa).length === 1, 10000);
  await colgada.quitar();
  await hasta(async () => !(await local(A.page, id)).congelada, 25000);
  assert.equal((await local(A.page, id)).congelada, false, 'se adoptó la venta');
  assert.deepEqual((await local(A.page, id)).items, items(fila(id)));
  await aMesa(A.page, mesa);
  await asignarSeco(A.page);
  await hasta(async () => (await local(A.page, id)).version === fila(id).version, 10000);
  await mesaCompleta(A.page);
  await hasta(async () => fila(id).estado === 'cerrada', 15000);
  await dormir(1000);
  assert.equal(registrado(mesa), 62000, `la base registró ${registrado(mesa)} por una mesa de 62.000 (antes 75.000)`);
});

test('T5 pasan 30 s y la base NUNCA recibió el cobro: con dos lecturas sin la venta recién se descongela, se relee la cuenta de la base y la mesa completa se cobra normal (el «no llegó» definitivo sigue existiendo)', { skip: SALTAR, timeout: 240000 }, async () => {
  const id = 'ot-t5'; const mesa = 56;
  cuenta(id, mesa, [SECO(2), LIM(2)]);
  const A = await abrirPos();
  await aMesa(A.page, mesa);
  const colgada = await peticionEnCamino(A.page, 'cobrar_parcial');
  const cobro = A.page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 }));
  assert.equal(await cobro, false);
  assert.equal((await local(A.page, id)).congelada, true);
  await dormir(8000);
  assert.equal((await local(A.page, id)).congelada, true, 'a los pocos segundos todavía congelada');
  await envejecer(A.page, 31000);                                       // pasaron los 30 s desde que se perdió la petición
  await hasta(async () => !(await local(A.page, id)).congelada, 20000);
  const a = await local(A.page, id);
  assert.equal(a.congelada, false, 'con la espera cumplida y la venta sin aparecer, se suelta');
  assert.ok(a.avisos.some((x) => /El cobro no llegó a la base/.test(x)), JSON.stringify(a.avisos));
  assert.equal(a.version, fila(id).version);
  assert.equal(ventasDeMesa(mesa).length, 0);
  await colgada.quitar();
  await mesaCompleta(A.page);
  await hasta(async () => fila(id).estado === 'cerrada', 15000);
  assert.equal(registrado(mesa), 62000);
});

test('T6 pasados los 30 s, la base termina el cobro JUSTO entre la primera y la segunda lectura por id: la primera contesta «no llegó», la segunda ya ve la venta y se ADOPTA (una sola lectura la habría dado por «sin rastro» y soltado la cuenta con el cobro dentro)', { skip: SALTAR, timeout: 240000 }, async () => {
  const id = 'ot-t6'; const mesa = 57;
  cuenta(id, mesa, [SECO(2), LIM(2)]);
  const A = await abrirPos();
  await aMesa(A.page, mesa);
  const colgada = await peticionEnCamino(A.page, 'cobrar_parcial');
  assert.equal(await A.page.evaluate(() => Alpine.store('pos').facturarParcial({ be1: 1 })), false, 'el tope de 10 s: sin respuesta');
  assert.equal((await local(A.page, id)).congelada, true);
  assert.equal(ventasDeMesa(mesa).length, 0, 'la base todavía no tiene el cobro');
  await envejecer(A.page, 31000);                                       // pasaron los 30 s: el «no llegó» ya podría valer
  // la PRIMERA lectura por id se resuelve contra la base como está (sin la venta); antes de que la tablet la reciba, la base termina el cobro; la tablet pregunta otra vez
  let lecturas = 0;
  const trampa = async (route) => {
    if (!/parcial_de=eq\./.test(route.request().url())) return route.fallback();
    lecturas++;
    if (lecturas > 1) return route.fallback();
    const pedido = route.request();
    const cab = {}; for (const [k, v] of Object.entries(pedido.headers())) cab[k.toLowerCase()] = v;
    const r = await pila.atender({ metodo: pedido.method(), url: new URL(pedido.url()), cabeceras: cab, cuerpo: pedido.postData() || '' });   // «no existe»
    await colgada.soltar();                                             // la base termina el cobro
    return route.fulfill({ status: r.estado, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-type', ...r.cabeceras }, body: r.cuerpo });   // y la tablet recibe la respuesta de antes
  };
  await A.page.route(deSupabase, trampa);
  const r = await A.page.evaluate((x) => Alpine.store('pos').reintentarCobroEnDuda(x), id);
  await A.page.unroute(deSupabase, trampa);
  assert.equal(r, 'aplicado', 'la segunda lectura vio la venta');
  assert.ok(lecturas >= 2, `hubo una segunda lectura (${lecturas})`);
  const a = await local(A.page, id);
  assert.equal(a.congelada, false);
  assert.deepEqual(a.items, items(fila(id)), 'con la cuenta de la base: ya sin la Limonada cobrada');
  assert.equal(ventasDeMesa(mesa).length, 1, 'una sola venta: no se cobró otra vez');
  await colgada.quitar();
});
