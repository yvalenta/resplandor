// Lo que Yonatan encontró el domingo 2026-10-04 usando el POS en el local (tareas/2026-10-04-hallazgos-domingo.md), en el POS y en la carta:
//
//   1. ESTÁTICA (corre siempre, también en CI): pos.html declara su modo oscuro (<meta name="color-scheme">, el bloque
//      `@media screen and (prefers-color-scheme: dark)` que remapea los materiales y re-fija el telón en la barra, el login y los
//      botones telón; los 15 del :root no cambian: eso lo vigila pos-visual.test.mjs), trae la hoja del pedido (asa, velo, #pedido-hoja)
//      y el anuncio de las promos de hoy; carta.html ya no pregunta «¿Cómo quieres pagar?» ni tiene «Cambiar método», y avisa con `cuenta`.
//   2. EN NAVEGADOR (solo si hay Playwright y Chromium, como desborde.test.mjs; si no, se salta con el motivo):
//      · POS (arnés simulado de _pos-simulado.mjs, reloj fijo en miércoles 2026-09-30): a 390 px la columna del pedido es una hoja FIJA
//        de poco más de media pantalla, sin velo (la carta sigue tocable detrás), que llega cerrada (el arnés la sube al llegar: aquí se baja
//        con Escape y se vuelve a subir con el asa); el anuncio «Hoy · 3er
//        almuerzo» con la regla en palabras; la promo de precio fijo de hoy se puede agregar y la del domingo no se ve; la línea de
//        promo lleva su pastilla «−20 % por promoción»; en «Cobrar por partes» el pedido vuelve al flujo con la barra fija de antes;
//        desde 1024 no hay hoja ni asa. En oscuro, el body es telón, la tarjeta telón elevado, el texto arroz y la barra sigue en
//        telón (nada café). El modal de producto de una promo muestra día, etiqueta y la regla descrita.
//      · Carta (red simulada como en pago-breb-carta-navegador.test.mjs): «Pagar» abre UNA pantalla con QR, llave, valor, comprobante y
//        «O en efectivo», y avisa UNA vez con `cuenta`; copiar la llave afina a `transferencia` (y no se repite); «Avisar que pago en
//        efectivo» afina a `efectivo`; «Volver» deja «Listo, le avisamos al mesero» con «Ver cómo pagar», que no avisa de nuevo; sin
//        datos de Bre-B la pantalla dice que el mesero los lleva; sin desborde a 320 ni a 390; sin errores de consola.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';
import { servirPos, nuevoContexto, abrirPos } from './_pos-simulado.mjs';
import { LLAVE_FICTICIA, QR_FICTICIO } from './_breb-ficticio.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const CARTA = fs.readFileSync(path.join(RAIZ, 'carta.html'), 'utf8');

// ───────────────────────── 1. estática ─────────────────────────

test('pos.html declara su modo oscuro con los mismos materiales y re-fija el telón donde ya era oscuro', () => {
  assert.match(POS, /<meta name="color-scheme" content="light dark" \/>/);
  const i = POS.indexOf('@media screen and (prefers-color-scheme: dark)');
  assert.ok(i > 0, 'el bloque de oscuro existe');
  const bloque = POS.slice(i, POS.indexOf('/* ▲ PARTE hallazgos-domingo :: css */', i));
  assert.match(bloque, /--color-telon:\s*#F4F0E3/, 'el texto de siempre, ahora claro');
  assert.match(bloque, /--color-arroz:\s*#0A1112/, 'el lienzo en telón');
  assert.match(bloque, /\.sobre-telon,\s*\.nav-bar,\s*\.btn-telon,\s*\.toast-alerta-cuerpo\s*\{\s*--color-telon:\s*#0A1112;\s*--color-arroz:\s*#F4F0E3;/, 'la barra, el login y los botones telón quedan iguales');
  assert.match(bloque, /html\s*\{\s*color-scheme:\s*dark;\s*\}/);
  assert.doesNotMatch(bloque, /@media print/, 'solo screen: el ticket se imprime claro');
});

test('pos.html trae la hoja del pedido y el anuncio de las promos de hoy', () => {
  assert.match(POS, /id="pedido-hoja" class="col-pedido/);
  assert.match(POS, /class="barra-asa lg:hidden"/);
  assert.doesNotMatch(POS, /pedido-velo/, 'sin velo: la carta sigue tocable con la hoja subida');
  assert.match(POS, /html\.pedido-abierto body \{\s*padding-bottom: calc\(var\(--pos-hoja-alto\) \+ \.5rem\);/, 'con la hoja subida la página reserva su alto');
  assert.match(POS, /\.orden-rejilla:not\(\.orden-en-parcial\) > \.col-pedido \{\s*position: fixed;/);
  assert.match(POS, /class="promo-hoy" x-show="\$store\.pos\.promosAutomaticasHoy\.length"/);
  assert.match(POS, /get promosAutomaticasHoy\(\)/);
  assert.match(POS, /esLineaPromo\(item\)\) return false;/, '_esLineaDe no toma una línea de promo por su base');
  assert.match(POS, /cuenta: 'por confirmar'/, 'metodoTxt conoce la alerta sin método');
});

test('carta.html ya no pregunta el método: «Pagar» avisa con `cuenta` y muestra todo de una vez', () => {
  assert.doesNotMatch(CARTA, /¿Cómo quieres pagar\?/);
  assert.doesNotMatch(CARTA, /Cambiar método/);
  assert.doesNotMatch(CARTA, /pago\.vista = 'elegir'/);
  assert.match(CARTA, /const METODOS_ALERTA = \['qr', 'transferencia', 'efectivo', 'cuenta'\];/);
  assert.match(CARTA, /else this\.avisarPago\('cuenta'\);/, 'pedirPago avisa solo');
  for (const id of ['pago-breb-titulo', 'pago-efectivo', 'pago-avisar-efectivo', 'pago-sin-datos', 'pago-copiar-llave', 'pago-copiar-valor', 'pago-comprobante', 'pago-ver']) {
    assert.match(CARTA, new RegExp(`id="${id}"`), id);
  }
});

// ───────────────────────── 2. en navegador ─────────────────────────

const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
let navegador = null;
let servidorPos = null;
let servidorCarta = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidorPos?.cerrar().catch(() => {});
  if (servidorCarta) await new Promise((r) => servidorCarta.close(r));
});

const css = (page, sel, prop) => page.evaluate(([s, p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; }, [sel, prop]);
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// El reloj fijo del arnés es el miércoles 2026-09-30 (3): la promo de hoy lleva dia_semana 3; la del domingo (7) no se ve.
const conPromos = (d) => {
  d.tablas.productos.push(
    { id: 'pr3', categoria: 'Promociones', nombre: '3er almuerzo', precio: 0, descripcion: 'Por la compra de 2 almuerzos, el tercero tiene 20 %', activo: true,
      etiqueta: '20% OFF', dia_semana: 3, promo_regla: { cada: 3, descuento: 20, aplica: { categorias: ['Ejecutivos'] } } },
    { id: 'prf', categoria: 'Promociones', nombre: 'Combo del miércoles', precio: 50000, descripcion: '2 hamburguesas', activo: true, etiqueta: null, dia_semana: 3, promo_regla: null },
    { id: 'prd', categoria: 'Promociones', nombre: 'Almuerzos del domingo', precio: 20000, descripcion: 'Solo domingos', activo: true, etiqueta: null, dia_semana: 7, promo_regla: null },
  );
  const o = d.tablas.ordenes.find((x) => x.id === 'ord-abierta-3');
  o.items.push({ id: 'promo:pr3:ej1__sopa-pollo', nombre: 'Ejecutivo de la casa · 3er almuerzo · 20% OFF', precio: 16800, qty: 1, nota: 'Sopa · Pollo',
                 promo: { id: 'pr3', de: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 } });
  o.total = o.items.reduce((s, i) => s + i.precio * i.qty, 0);
};

async function abrirPosEn(t, ancho, esquema) {
  let ultimo = null;
  for (let intento = 0; intento < 2; intento++) {
    let ctx = null;
    try {
      servidorPos ||= await servirPos(RAIZ, 0);
      navegador ||= await pw.chromium.launch();
      ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
      contextos.push(ctx);
      const page = await ctx.newPage();
      page.setDefaultTimeout(90000);
      await page.emulateMedia({ colorScheme: esquema });
      const { diag } = await abrirPos(page, { url: servidorPos.url, vista: 'orden', ajustar: conPromos });
      return { page, diag };
    } catch (e) { ultimo = e; await ctx?.close().catch(() => {}); }
  }
  t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(ultimo.message).split('\n')[0]}`);
  return null;
}

for (const [ancho, esquema] of [[390, 'light'], [390, 'dark'], [1280, 'dark']]) {
  test(`POS (${ancho} px, ${esquema}): promos de hoy, la hoja del pedido y los colores del modo`, { skip: SALTAR }, async (t) => {
    const a = await abrirPosEn(t, ancho, esquema); if (!a) return;
    const { page, diag } = a;
    assert.deepEqual(diag.errores, [], 'sin errores de página');
    assert.equal(await sinDesborde(page), 0, 'sin desborde horizontal');
    const anuncio = await page.locator('.promo-hoy').innerText();
    assert.match(anuncio, /3er almuerzo/); assert.match(anuncio, /cada 3, el más barato con 20 % menos en Ejecutivos/);
    const carta = await page.locator('.menu-scroll').innerText();
    assert.match(carta, /Combo del miércoles/, 'la promo de precio fijo de hoy se agrega como producto');
    assert.doesNotMatch(carta, /Almuerzos del domingo/, 'la de otro día no se ve');
    assert.doesNotMatch(carta, /3er almuerzo\s*\$/, 'la de regla no se agrega a mano');
    if (esquema === 'dark') {
      assert.equal(await css(page, 'body', 'backgroundColor'), 'rgb(10, 17, 18)', 'body en telón');
      assert.equal(await css(page, '.carta-panel', 'backgroundColor'), 'rgb(22, 31, 31)', 'tarjeta en telón elevado, no café');
      assert.equal(await css(page, '.menu-item-name', 'color'), 'rgb(244, 240, 227)', 'texto en arroz');
      assert.equal(await css(page, '.nav-bar', 'backgroundColor'), 'rgb(10, 17, 18)', 'la barra sigue en telón');
    } else {
      assert.equal(await css(page, 'body', 'backgroundColor'), 'rgb(244, 240, 227)', 'body en arroz');
    }
    if (ancho < 1024) {
      // El arnés sube la hoja al llegar; aquí se baja y se vuelve a subir con el asa.
      assert.equal(await css(page, '.col-pedido', 'position'), 'fixed', 'la columna del pedido es una hoja fija');
      assert.ok(await visible(page, '.pedido-card'), 'el arnés la dejó subida');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      assert.equal(await visible(page, '.pedido-card'), false, 'Escape la baja');
      assert.match(await page.locator('.barra-asa').innerText(), /ítem/, 'el asa dice los ítems');
      await page.locator('.barra-asa').click(); await page.waitForTimeout(300);
      assert.ok(await visible(page, '.pedido-card'), 'el asa la sube');
      assert.ok((await page.locator('#pedido-hoja').getAttribute('class')).includes('abierta'));
      assert.match(await page.locator('.order-item.es-promo').innerText(), /20 % por promoción/, 'la línea de promo lleva su pastilla');
      // Sin velo: la hoja mide poco más de media pantalla y la carta sigue tocable detrás («escoger de la carta o viceversa»).
      const caja = await page.locator('#pedido-hoja').boundingBox();
      assert.ok(caja.height <= 844 * 0.6, `la hoja mide ${caja.height} px: poco más de media pantalla`);
      const antes = await page.locator('.order-item').count();
      await page.locator('.menu-item').filter({ hasText: 'Jugo natural' }).first().click(); await page.waitForTimeout(400);   // sin hoja de variantes (el Seco la abre) y aún no está en la cuenta: línea nueva
      assert.equal(await page.locator('.order-item').count(), antes + 1, 'con la hoja subida se agrega desde la carta y la línea aparece en el pedido');
      assert.ok(await visible(page, '.pedido-card'), 'y la hoja sigue arriba');
      await page.evaluate(() => { Alpine.store('pos').seleccionCobro = true; }); await page.waitForTimeout(300);
      assert.notEqual(await css(page, '.col-pedido', 'position'), 'fixed', 'en cobro por partes el pedido vuelve al flujo');
      assert.equal(await css(page, '.barra-accion', 'position'), 'fixed', 'con la barra fija de antes');
      assert.equal(await visible(page, '.barra-asa'), false, 'y sin asa');
      await page.evaluate(() => { Alpine.store('pos').seleccionCobro = false; });
    } else {
      assert.notEqual(await css(page, '.col-pedido', 'position'), 'fixed', 'desde 1024 el pedido no es hoja');
      assert.equal(await visible(page, '.barra-asa'), false, 'ni hay asa');
    }
    await page.evaluate(() => { const p = Alpine.store('pos'); p.abrirModalProducto(p.productos.find((x) => x.id === 'pr3')); });
    await page.waitForTimeout(400);
    const modal = (await page.locator('.modal:visible').first().innerText()).replace(/\s+/g, ' ');
    assert.match(modal, /Día/i); assert.match(modal, /Etiqueta/i); assert.match(modal, /Por cada/i);
    assert.match(modal, /cada 3, el más barato con 20 % menos en Ejecutivos/, 'la regla queda válida y descrita');
  });
}

// ── La carta ──

const TOKEN = '0'.repeat(48);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const ITEMS = [{ nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 }, { nombre: 'Seco', precio: 19000, cantidad: 2 }, { nombre: 'Seco · 3er almuerzo · 20% OFF', precio: 15200, cantidad: 1 }];
const BREB = { llave: LLAVE_FICTICIA, qr: QR_FICTICIO };

async function abrirCarta({ ancho, pago }) {
  navegador ||= await pw.chromium.launch();
  servidorCarta ||= await servirRaiz(RAIZ);
  const puerto = servidorCarta.address().port;
  const total = ITEMS.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 800 }, ...(ancho < 768 ? { isMobile: true, hasTouch: true } : {}), locale: 'es-CO', timezoneId: 'America/Bogota' });
  contextos.push(contexto);
  await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${puerto}` }).catch(() => {});
  const page = await contexto.newPage();
  page.setDefaultTimeout(60000);
  const consola = []; const posts = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || '')) consola.push(m.text()); });
  page.on('pageerror', (e) => consola.push(`pageerror: ${e.message}`));
  await page.route(/\.supabase\.co\//, (r) => {
    const req = r.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (url.includes('/rest/v1/carta_publica')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '[]' });
    if (url.includes('/functions/v1/cuenta')) {
      return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ mesa: 7, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items: ITEMS, total, ...(pago ? { pago: { breb: pago } } : {}) }) });
    }
    if (url.includes('/functions/v1/alerta')) {
      const cuerpo = JSON.parse(req.postData() || '{}'); posts.push(cuerpo);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, metodo: cuerpo.metodo, creada_en: '2026-09-30T18:00:00Z' }) });
    }
    return r.fulfill({ status: 404, headers: CORS, body: '{}' });
  });
  await page.goto(`http://127.0.0.1:${puerto}/carta.html?m=7&k=${TOKEN}`, { waitUntil: 'load' });
  const alpine = await page.waitForFunction(() => window.Alpine && document.querySelector('[x-data]')?._x_dataStack, null, { timeout: 20000 }).then(() => true, () => false);
  return { page, consola, posts, alpine };
}

for (const [ancho, pago] of [[390, BREB], [320, BREB], [390, null], [1280, BREB]]) {
  test(`carta (${ancho} px, ${pago ? 'con' : 'sin'} Bre-B): «Pagar» es una pantalla que avisa sola y se afina sin preguntar`, { skip: SALTAR }, async (t) => {
    const c = await abrirCarta({ ancho, pago });
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia las fuentes?): sin él la página no pinta nada');
    const { page, consola, posts } = c;
    if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.locator('#pago-pagar').click();
    await page.locator('#pago-breb').waitFor(); await page.waitForTimeout(600);
    assert.deepEqual(posts.map((p) => p.metodo), ['cuenta'], 'al abrir se avisa UNA vez con cuenta');
    assert.match(await page.locator('.cuenta-cabeza').innerText(), /avisamos al mesero/i);
    const cuerpo = await page.locator('#pago-breb').innerText();
    assert.match(cuerpo, /Paga como prefieras/); assert.match(cuerpo, /O en efectivo/);
    if (pago) {
      assert.ok((await page.locator('.breb-qr svg path').getAttribute('d')).length > 50, 'QR dibujado');
      assert.match(cuerpo, /Llave:/); assert.match(cuerpo, /Valor:/); assert.match(cuerpo, /99\.200/);
      assert.ok(await visible(page, '#pago-comprobante'));
      assert.equal(await visible(page, '#pago-sin-datos'), false);
      await page.locator('#pago-copiar-llave').click(); await page.waitForTimeout(500);
      assert.deepEqual(posts.map((p) => p.metodo), ['cuenta', 'transferencia'], 'copiar la llave afina a transferencia');
      await page.locator('#pago-copiar-llave').click(); await page.waitForTimeout(400);
      assert.equal(posts.length, 2, 'copiar otra vez no repite el aviso');
    } else {
      assert.ok(await visible(page, '#pago-sin-datos'), 'sin Bre-B: el mesero lleva el QR o los datos');
      assert.equal(await visible(page, '.breb-qr'), false); assert.equal(await visible(page, '#pago-comprobante'), false);
    }
    assert.equal(await sinDesborde(page), 0, 'sin desborde horizontal');
    await page.locator('#pago-avisar-efectivo').click(); await page.waitForTimeout(500);
    assert.equal(posts[posts.length - 1].metodo, 'efectivo');
    assert.equal(await visible(page, '#pago-avisar-efectivo'), false, 'ya avisado, el botón se esconde');
    assert.match(await page.locator('#pago-efectivo').innerText(), /pagas en efectivo/);
    const n = posts.length;
    await page.locator('#pago-cambiar-breb').click(); await page.waitForTimeout(400);
    assert.ok(await visible(page, '#pago-ver'), '«Volver»: el pie ofrece «Ver cómo pagar»');
    assert.equal(await visible(page, '#pago-cambiar'), false, 'y ya no hay «Cambiar método»');
    await page.locator('#pago-ver').click(); await page.waitForTimeout(400);
    assert.ok(await visible(page, '#pago-breb'));
    assert.equal(posts.length, n, '«Ver cómo pagar» no avisa de nuevo');
    assert.deepEqual(consola, [], 'sin errores de consola');
  });
}
