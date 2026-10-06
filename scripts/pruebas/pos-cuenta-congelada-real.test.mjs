// LA CUENTA CONGELADA DE PUNTA A PUNTA CON LO REAL (quinta refutación, 2026-10-06; tareas/2026-10-04-hallazgos-domingo.md).
//   POS (pos.html con su supabase-js REAL en Chromium) → «PostgREST» de _pila-impresion.mjs → Postgres 17 con la cadena COMPLETA de migraciones y la RLS de un mesero de verdad.
//   Los guiones de la refutación r5 (refutacion-r5/ en el paquete de coordinación), que antes ROMPÍAN el dinero y ahora tienen que cuadrar:
//     M5   la base aplica un cobro por partes, la respuesta se pierde; el mesero asigna el Seco a la Persona 1 y toca «Generar ticket y cobrar»: antes 75.000 por una mesa de 62.000
//     M6   lo mismo con un abono de 20.000: antes 82.000 por 62.000 (el cierre borraba el crédito)
//     M1/2 el ticket PROVISIONAL de la mesa completa ignoraba lo ya cobrado (y el aviso recomendaba cobrar la mesa completa)
//     M3/4 un +1 Jugo en cola subía la versión de la copia vieja y la mesa completa cerraba con ella
//   Ahora la cuenta queda CONGELADA (un velo con «Reintentar ahora»): ningún gesto ni cobro pasa, y la reconciliación con la base la libera.
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
const CONGELADA = 'Cobro pendiente de confirmar con la base: espera a que vuelva la red.';

let pila; let servidor; let navegador;
const contextos = [];
before(async () => {
  if (SALTAR) return;
  pila = await levantarPila({ conCola: true });
  servidor = await servirPos(RAIZ, 0);
  navegador = await pw.chromium.launch();
  const r = pila.pg.sql(`insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'd') from generate_series(51, 70) g`);
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
const ventas = (id) => pila.pg.filas(`select id, estado, total, items, parcial_de from public.ordenes where mesa_id = (select mesa_id from public.ordenes where id = ${literal(id)}) and estado = 'cerrada' order by cerrada_en, id`);
const cobradoTotal = (id) => ventas(id).reduce((s, v) => s + Number(v.total), 0);
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
  await page.evaluate(() => { const p = Alpine.store('pos'); window.__avisos = []; const orig = p.avisar.bind(p); p.avisar = (t, ms, a) => { if (t) window.__avisos.push(t); return orig(t, ms, a); }; });
  return { page, ctx };
}
const aMesa = async (page, n) => {
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).click();
  await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
};
const estado = (page, id) => page.evaluate((x) => {
  const p = Alpine.store('pos');
  const o = p.ordenes.find((y) => y.id === x);
  return { remoto: p.remoto, aviso: p.aviso?.texto || '', avisos: (window.__avisos || []).slice(), congelada: p._cuentaCongelada(x), cobrando: p._cobrandoDe(x), velo: p.cuentaCongeladaVisible, version: o?.version, estado: o?.estado, items: o ? o.items.map((i) => `${i.qty}x${i.id}@${i.precio}${i.nota ? ' [' + i.nota + ']' : ''}`) : null,
    cola: p.colaDeltas.length, vista: p.vista, provisional: p.ordenes.some((y) => y.provisional && (y.id === x || y.parcialDe === x)), ventasLocal: p.ordenes.filter((y) => y.estado === 'cerrada' && (y.id === x || y.parcialDe === x)).length, enDuda: Object.keys(p.cobrosEnDuda) };
}, id);
/** El cobro SALIÓ y no tuvo respuesta: la cuenta está congelada, ya no hay una llamada en camino y la tablet ya avisó. */
const hastaEnDuda = (page, id) => hasta(async () => { const e = await estado(page, id); return e.congelada && !e.cobrando && e.avisos.length > 0; }, 25000);
/** Lo que se ve de verdad: el velo está encima, con su texto y su botón, y lo que hay debajo no recibe el toque. */
const velo = async (page) => ({
  visible: await page.locator('#velo-cobro-en-duda').isVisible(),
  texto: await page.locator('#velo-cobro-en-duda').innerText().catch(() => ''),
  boton: await page.getByRole('button', { name: /Reintentar ahora|Preguntando a la base/ }).isVisible().catch(() => false),
});
const tocaElVelo = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return 'no existe';
  const r = el.getBoundingClientRect();
  const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!(arriba && arriba.closest('#velo-cobro-en-duda'));
}, selector);
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
const cobrarPorPartes = async (page, seleccion) => {
  await page.getByRole('button', { name: 'Cobrar por partes' }).click();
  await page.evaluate((s) => { Alpine.store('pos').itemsSeleccionados = s; }, seleccion);
  await page.locator('.barra-partes button').first().click();
  await page.getByRole('button', { name: 'Sí, cobrar' }).click();
};
const abonar = (page, monto) => page.evaluate((m) => { const p = Alpine.store('pos'); p.seleccionCobro = true; p.montoAbono = String(m); p.metodoAbono = 'efectivo'; return p.cobrarMonto(); }, monto);

test('M5 (r5, ALTO): la base aplicó el cobro por partes de 1 Limonada y la respuesta se perdió; el mesero asigna el Seco a la Persona 1 y toca «Generar ticket y cobrar»: la cuenta está CONGELADA (velo), no sube nada, y al reconciliarse la mesa de 62.000 se registra por 62.000, no por 75.000', { skip: SALTAR, timeout: 240000 }, async () => {
  cuenta('rc-m5', 51, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 51);
  const soltar = await perderRespuesta(page, 'cobrar_parcial');
  await cobrarPorPartes(page, { be1: 1 });
  await hastaEnDuda(page, 'rc-m5');
  const e1 = await estado(page, 'rc-m5');
  assert.ok(e1.avisos.some((a) => a.startsWith('Sin red: el cobro por partes y los abonos necesitan red.')), JSON.stringify(e1.avisos));
  assert.ok(e1.avisos.every((a) => !/la mesa completa sí se puede cobrar/.test(a)), 'el aviso ya no recomienda la mesa completa');
  assert.equal(ventas('rc-m5').length, 1, 'la base SÍ cobró la Limonada');
  assert.equal(Number(fila('rc-m5').total), 2 * 18000 + 13000);
  await soltar();
  const noPreguntar = await sinPoderPreguntar(page);   // la tablet pregunta sola cada 7 s: se la detiene para mirar la cuenta congelada con calma
  // el velo está puesto, dice lo que tiene que decir, y lo de abajo (los botones de la cuenta) no recibe el toque
  await hasta(async () => (await velo(page)).visible, 10000);
  const v = await velo(page);
  assert.equal(v.visible, true);
  assert.ok(v.texto.includes(CONGELADA), v.texto);
  assert.equal(v.boton, true, '«Reintentar ahora»');
  assert.equal(await tocaElVelo(page, '.fila-acciones button'), true, 'los botones de la cuenta quedan debajo del velo');
  // el gesto de la refutación y la mesa completa
  const antesVersion = fila('rc-m5').version;
  await page.evaluate(() => { const p = Alpine.store('pos'); p.ciclarPagador(p.ordenes.find((o) => o.id === 'rc-m5').items.find((i) => i.id === 'ej2')); });
  await page.evaluate(() => Alpine.store('pos').facturar());
  await new Promise((r) => setTimeout(r, 1500));
  const e2 = await estado(page, 'rc-m5');
  assert.deepEqual(e2.items.filter((i) => i.includes('Persona')), [], 'la persona no se asignó');
  assert.equal(e2.estado, 'abierta', 'la mesa completa no cerró');
  assert.equal(e2.provisional, false);
  assert.equal(fila('rc-m5').version, antesVersion, 'la base no recibió ninguna escritura de la cuenta');
  assert.equal(fila('rc-m5').estado, 'abierta');
  assert.equal(ventas('rc-m5').length, 1);
  // la base vuelve a contestar: «Reintentar ahora» (o la pregunta de cada 7 s, si se adelanta)
  await noPreguntar();
  await page.getByRole('button', { name: 'Reintentar ahora' }).click({ timeout: 8000 }).catch(() => {});
  await hasta(async () => !(await estado(page, 'rc-m5')).congelada, 20000);
  const e3 = await estado(page, 'rc-m5');
  assert.equal(e3.congelada, false);
  assert.ok(e3.avisos.some((a) => /SÍ quedó registrado en la base/.test(a)));
  assert.equal(e3.version, fila('rc-m5').version, 'la copia es la de la base');
  assert.deepEqual(e3.items.sort(), ['1xbe1@13000', '2xej2@18000']);
  assert.equal(ventas('rc-m5').length, 1, 'preguntar no cobró otra vez');
  // la mesa completa, ya sin velo, cuadra
  await aMesaDesdeTicket(page, 51);
  await page.evaluate(() => Alpine.store('pos').facturar());
  await hasta(async () => fila('rc-m5').estado === 'cerrada', 20000);
  assert.equal(cobradoTotal('rc-m5'), 62000, `una mesa de 62.000 se registró por ${cobradoTotal('rc-m5')} (antes 75.000)`);
});
const aMesaDesdeTicket = async (page, n) => {
  await page.evaluate(() => Alpine.store('pos').volverAMesas());
  await aMesa(page, n);
};

test('M6 (r5): lo mismo con un ABONO de 20.000 y marcar una línea «para llevar»: el cierre no borra el crédito — se registra 20.000 + 42.000 = 62.000, no 82.000', { skip: SALTAR, timeout: 240000 }, async () => {
  cuenta('rc-m6', 52, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 52);
  const soltar = await perderRespuesta(page, 'cobrar_abono');
  assert.equal(await abonar(page, 20000), false);
  await hastaEnDuda(page, 'rc-m6');
  assert.equal(ventas('rc-m6').length, 1, 'la base SÍ recibió el abono');
  await soltar();
  const noPreguntar = await sinPoderPreguntar(page);
  const antes = fila('rc-m6');
  await page.evaluate(() => { const p = Alpine.store('pos'); p.alternarLlevar(p.ordenes.find((o) => o.id === 'rc-m6').items.find((i) => i.id === 'ej2')); });
  await page.evaluate(() => Alpine.store('pos').facturar());
  await new Promise((r) => setTimeout(r, 1500));
  const e = await estado(page, 'rc-m6');
  assert.equal(e.estado, 'abierta');
  assert.equal(fila('rc-m6').version, antes.version, 'la base no recibió nada');
  assert.ok(fila('rc-m6').items.some((i) => String(i.id).startsWith('abono_recibido_')), 'el crédito del abono sigue en la cuenta');
  await noPreguntar();
  await page.getByRole('button', { name: 'Reintentar ahora' }).click({ timeout: 8000 }).catch(() => {});
  await hasta(async () => !(await estado(page, 'rc-m6')).congelada, 20000);
  assert.ok((await estado(page, 'rc-m6')).avisos.some((a) => /SÍ quedó registrado en la base/.test(a)));
  await aMesaDesdeTicket(page, 52);
  await page.evaluate(() => Alpine.store('pos').facturar());
  await hasta(async () => fila('rc-m6').estado === 'cerrada', 20000);
  assert.equal(cobradoTotal('rc-m6'), 62000, `una mesa de 62.000 se registró por ${cobradoTotal('rc-m6')} (antes 82.000)`);
});

test('M1/M2 (r5, MEDIO): con el cobro en duda la mesa completa NO se ofrece: ni ticket PROVISIONAL, ni aviso que lo recomiende, ni un cierre que la base rechace diciendo «No se cobró nada»', { skip: SALTAR, timeout: 240000 }, async () => {
  cuenta('rc-m1', 53, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 53);
  const soltar = await perderRespuesta(page, 'cobrar_abono');
  assert.equal(await abonar(page, 20000), false);
  await hastaEnDuda(page, 'rc-m1');
  await soltar();
  const noPreguntar = await sinPoderPreguntar(page);
  const e0 = await estado(page, 'rc-m1');
  assert.ok(e0.avisos.every((a) => !/la mesa completa sí se puede cobrar/.test(a)), JSON.stringify(e0.avisos));
  // lo que ESTA tablet manda hacia la base mientras toca «Generar ticket y cobrar»: solo las escrituras de cuentas y cobros
  const escrituras = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/rest\/v1\/(ordenes|rpc\/(aplicar_delta_orden|actualizar_nota_item|fijar_precio_item|cobrar_parcial|cobrar_abono|deshacer_cobro|cerrar_dia))/.test(r.url())) escrituras.push(r.method() + ' ' + r.url().replace(/^.*\/rest\/v1\//, '')); });
  await page.evaluate(() => Alpine.store('pos').facturar());
  await new Promise((r) => setTimeout(r, 1500));
  const e = await estado(page, 'rc-m1');
  assert.equal(e.aviso, CONGELADA);
  assert.equal(e.vista, 'orden', 'no hay un ticket');
  assert.equal(e.provisional, false);
  assert.equal(e.ventasLocal, 0);
  assert.equal(escrituras.length, 0, `no salió ninguna escritura: ${JSON.stringify(escrituras)}`);
  assert.ok(e.avisos.every((a) => !/No se cobró nada|PROVISIONAL/i.test(a)));
  assert.equal(fila('rc-m1').estado, 'abierta');
  assert.equal(ventas('rc-m1').length, 1, 'solo el abono');
  await noPreguntar();
});

test('M3/M4 (r5, ALTO): sin poder preguntar por el cobro, un +1 Jugo de la cuenta congelada no se agrega (no queda en cola) y la mesa completa no cierra con la copia vieja', { skip: SALTAR, timeout: 240000 }, async () => {
  cuenta('rc-m3', 54, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 54);
  const soltar = await perderRespuesta(page, 'cobrar_parcial');
  await cobrarPorPartes(page, { be1: 1 });
  await hastaEnDuda(page, 'rc-m3');
  await soltar();
  const noPreguntar = await sinPoderPreguntar(page);
  const antes = fila('rc-m3');
  await page.evaluate(() => { const p = Alpine.store('pos'); const o = p.ordenes.find((x) => x.id === 'rc-m3'); p.agregarProducto(p.productos.find((x) => x.id === 'be2')); p.incrementarItem(o.items.find((i) => i.id === 'be1')); });
  await page.evaluate(() => Alpine.store('pos').facturar());
  await new Promise((r) => setTimeout(r, 1500));
  const e = await estado(page, 'rc-m3');
  assert.equal(e.cola, 0, 'ningún +1 en cola');
  assert.equal(e.estado, 'abierta');
  assert.equal(fila('rc-m3').version, antes.version, 'la base no recibió ningún cambio');
  assert.equal(fila('rc-m3').estado, 'abierta');
  assert.equal(ventas('rc-m3').length, 1);
  assert.equal((await velo(page)).visible, true, 'y el velo sigue puesto: no se puede preguntar');
  await noPreguntar();
  await hasta(async () => !(await estado(page, 'rc-m3')).congelada, 40000);
  assert.equal((await estado(page, 'rc-m3')).congelada, false, 'al poder preguntar, la reconciliación la libera sola');
});

test('R6 una RECARGA con el cobro en duda: al abrir la mesa el velo vuelve (el intento sobrevive en localStorage) y, al poder preguntar, «Reintentar ahora» adopta el cobro', { skip: SALTAR, timeout: 240000 }, async () => {
  cuenta('rc-r6', 55, [SECO(2), LIM(2)]);
  const { page } = await abrirPos('mesero');
  await aMesa(page, 55);
  const soltar = await perderRespuesta(page, 'cobrar_parcial');
  await cobrarPorPartes(page, { be1: 1 });
  await hastaEnDuda(page, 'rc-r6');
  await soltar();
  const noPreguntar = await sinPoderPreguntar(page);
  await page.reload({ waitUntil: 'load' });
  await esperarListo(page);
  await aMesa(page, 55);
  const e = await estado(page, 'rc-r6');
  assert.equal(e.congelada, true, 'congelada tras recargar');
  await hasta(async () => (await velo(page)).visible, 10000);
  assert.equal((await velo(page)).visible, true);
  await page.getByRole('button', { name: 'Reintentar ahora' }).click();
  await hasta(async () => !(await page.getByRole('button', { name: /Preguntando a la base/ }).isVisible().catch(() => false)), 20000);
  assert.equal((await estado(page, 'rc-r6')).congelada, true, 'sin poder preguntar sigue congelada');
  await noPreguntar();
  await page.getByRole('button', { name: 'Reintentar ahora' }).click();
  await hasta(async () => !(await estado(page, 'rc-r6')).congelada, 20000);
  assert.equal((await estado(page, 'rc-r6')).congelada, false);
  assert.equal(ventas('rc-r6').length, 1, 'y no hubo un segundo cobro');
  assert.equal((await estado(page, 'rc-r6')).version, fila('rc-r6').version);
});

// ═══════════════════ H. El hallazgo bajo (r5): la cuenta de AYER con la regla de HOY ═══════════════════
const diaBogota = () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', weekday: 'short' }).format(new Date())) + 1;
const HOY = diaBogota();
const AYER = HOY === 1 ? 7 : HOY - 1;
const fijarDia = (d) => { const r = pila.pg.sql(d == null ? 'alter database postgres reset resplandor.dia_promo;' : `alter database postgres set resplandor.dia_promo = '${d}';`); if (!r.ok) throw new Error(r.error); };

test('H1 real (r5, bajo): una cuenta escrita AYER (3 Seco sin descuento) y hoy hay regla «cada 3 Seco, 20 %» solo de hoy: la tablet juzga con la regla de hoy sobre las unidades y NO ofrece el cobro por partes (casillas apagadas, aviso, ninguna llamada a cobrar_parcial); antes la base lo rechazaba con RS005 una y otra vez', { skip: SALTAR, timeout: 240000 }, async () => {
  try {
    fijarDia(AYER);
    let r = pila.pg.sql(`insert into public.productos (id, categoria, nombre, precio, activo, dia_semana, promo_regla) values ('rc-promo-hoy', 'Promociones', 'Prueba 3er Seco', 0, true, ${HOY}, '{"cada":3,"descuento":20,"aplica":{"productos":["ej2"]}}'::jsonb)`);
    if (!r.ok) throw new Error(r.error);
    r = pila.pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('rc-h1', 56, 'abierta', '[{"id":"ej2","nombre":"Seco con proteína","precio":18000,"qty":3,"nota":""}]'::jsonb, 0, now() - interval '1 day'); update public.mesas set estado = 'ocupada' where id = 56;`);
    if (!r.ok) throw new Error(r.error);
    assert.equal(fila('rc-h1').items.length, 1, 'escrita ayer: sin línea de promo');
    fijarDia(HOY);                                                                 // pasa la medianoche: hoy SÍ hay regla y nadie toca la cuenta
    const { page } = await abrirPos('mesero');
    await aMesa(page, 56);
    const estadoPromo = () => page.evaluate(() => { const p = Alpine.store('pos'); return { cuentaConPromo: p.cuentaConPromo, items: p.ordenActiva.items.map((i) => `${i.qty}x${i.id}`), aviso: p.aviso?.texto || '' }; });
    const e0 = await estadoPromo();
    assert.deepEqual(e0.items, ['3xej2'], 'la cuenta de aquí no trae línea de promo');
    assert.equal(e0.cuentaConPromo, true, 'pero la tablet sabe lo que la base juzgaría hoy');
    await page.getByRole('button', { name: 'Cobrar por partes' }).click();
    await page.locator('#aviso-promo-partes').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.order-item:visible').first().locator('input[type=checkbox]').isDisabled(), true, 'las casillas quedan apagadas');
    const n0 = pila.peticiones.length;
    assert.equal(await page.evaluate(() => Alpine.store('pos').facturarParcial({ ej2: 1 })), false);
    await new Promise((res) => setTimeout(res, 1200));
    assert.match((await estadoPromo()).aviso, /Esta mesa tiene una promoción: el descuento se calcula con toda la cuenta junta/);
    assert.equal(pila.peticiones.slice(n0).filter((p) => /\/rpc\/cobrar_parcial/.test(p.ruta)).length, 0, 'ninguna llamada a cobrar_parcial: no se espera a que la base diga RS005');
    assert.equal(ventas('rc-h1').length, 0);
    assert.equal(fila('rc-h1').estado, 'abierta');
  } finally {
    pila.pg.sql("delete from public.productos where id = 'rc-promo-hoy'");
    fijarDia(null);
  }
});
