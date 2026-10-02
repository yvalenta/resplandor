// «Pagar con Bre-B» en carta.html, EN NAVEGADOR (Chromium con Playwright, ver _navegador.mjs; si no hay, se salta con el motivo). Complemento de
// pago-breb-carta.test.mjs (el <script> en un vm, siempre corre). Aquí se mira lo que solo un navegador de verdad dice: que el QR SE VE grande,
// cuadrado, negro sobre blanco y entero; que la llave se copia al portapapeles de verdad; que el enlace de WhatsApp sale bien; que nada se sale de
// la pantalla a 320, 360, 390, 1280 y 1440 px; que los botones miden 44 px; el foco y los textos para lectores de pantalla; y que el generador
// del QR se pide una vez, del mismo origen, solo al tocar «Pagar».
//
// Crítica visual (2026-10-02, P0): en la vista del QR el botón «Enviar comprobante por WhatsApp» tiene que verse SIN desplazar la hoja a 320×568, 360×640,
// 375×667, 390×844 y 412×915 (antes quedaba bajo el pliegue en todos menos el más grande): va pegado (sticky) encima del total.
//
// La red está simulada (nunca se toca Supabase): `cuenta` devuelve la cuenta abierta de siempre con `pago.breb` del QR FICTICIO de
// _breb-ficticio.mjs (ningún dato de pago real vive en el repo, en una prueba ni en una captura).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';
import { decodificarQr, matrizDeSvgConMargen } from './_qr-decodificar.mjs';
import { LLAVE_FICTICIA, QR_FICTICIO, QR_FICTICIO_CORTO } from './_breb-ficticio.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const URL_ALERTA = 'https://lccgehvyymladqvumcez.supabase.co/functions/v1/alerta';
const BREB = Object.freeze({ llave: LLAVE_FICTICIA, qr: QR_FICTICIO });

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivoNavegador = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidor = await servirRaiz(RAIZ);
  } catch (e) {
    motivoNavegador = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await new Promise((resolver) => servidor.close(resolver));
});
const saltar = () => (navegador ? false : `navegador no disponible: ${motivoNavegador}`);

const FILAS_CARTA = (() => {
  const caja = {};
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leer('assets/js/carta-respaldo.js'), caja);
  return JSON.parse(JSON.stringify(caja.RESPLANDOR_CARTA_RESPALDO.filas));
})();
const ITEMS = [
  { nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 },
  { nombre: 'Hamburguesa Resplandor', precio: 32000, cantidad: 1 },
  { nombre: 'Jugo natural en agua', precio: 7000, cantidad: 3 },
];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const TOTAL_TEXTO = '$ 99.000';   // 2×23.000 + 32.000 + 3×7.000

/**
 * Abre carta.html con la red simulada. `pago`: lo que `cuenta` devuelve en `pago.breb` (null = no manda `pago`); `alerta(n, cuerpo)`: la respuesta del
 * n-ésimo POST a `alerta`; `bloquearQr`: el archivo del generador del QR no carga; `items`: la cuenta.
 * Devuelve la página, los POST a alerta, las URL que pidió el navegador y los errores de consola (sin los de Google Fonts, que dependen de la red).
 */
async function abrir({ ancho, alto = 800, pago = BREB, alerta, movil = false, bloquearQr = false, items = ITEMS, mesa = true } = {}) {
  const total = items.reduce((suma, i) => suma + i.precio * i.cantidad, 0);
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, ...(movil ? { isMobile: true, hasTouch: true } : {}), acceptDownloads: false });
  await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${servidor.address().port}` }).catch(() => {});
  const page = await contexto.newPage();
  const consola = [];
  const posts = [];
  const peticiones = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || '')) consola.push(m.text()); });
  page.on('pageerror', (e) => consola.push(`pageerror: ${e.message}`));
  page.on('request', (r) => peticiones.push({ url: r.url(), t: Date.now() }));
  await page.route(/\/assets\/vendor\/qrcode-generator-/, (r) => (bloquearQr ? r.abort('failed') : r.continue()));
  await page.route(/\.supabase\.co\//, (r) => {
    const req = r.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (url.includes('/rest/v1/carta_publica')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(FILAS_CARTA) });
    if (url.includes('/functions/v1/cuenta')) {
      const cuerpo = { mesa: 7, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items, total, ...(pago ? { pago: { breb: pago } } : {}) };
      return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(cuerpo) });
    }
    if (url.includes('/functions/v1/alerta')) {
      const cuerpo = JSON.parse(req.postData() || '{}');
      posts.push({ url, metodo: req.method(), cabeceras: req.headers(), cuerpo });
      const a = alerta ? alerta(posts.length, cuerpo) : { status: 200, body: { ok: true, metodo: cuerpo.metodo, creada_en: '2026-09-30T18:00:00Z' } };
      if (a.abortar) return r.abort('failed');
      return r.fulfill({ status: a.status, contentType: 'application/json', headers: CORS, body: JSON.stringify(a.body) });
    }
    return r.fulfill({ status: 404, headers: CORS, body: '{}' });
  });
  await page.goto(`http://127.0.0.1:${servidor.address().port}/carta.html${mesa ? `?m=7&k=${TOKEN}` : ''}`, { waitUntil: 'load' });
  const alpine = await page.waitForFunction(() => window.Alpine && document.querySelector('[x-data]') && document.querySelector('[x-data]')._x_dataStack, null, { timeout: 8000 }).then(() => true, () => false);
  return { contexto, page, consola, posts, peticiones, alpine };
}

async function conCarta(t, opciones, cuerpo) {
  const c = await abrir(opciones);
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    await cuerpo(c);
  } finally {
    await c.contexto.close();
  }
}

const desborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const visible = (page, selector) => page.locator(selector).first().isVisible();
const caja = async (page, selector) => { const b = await page.locator(selector).first().boundingBox(); assert.ok(b, `no hay caja para ${selector}`); return b; };
const cajaDe = caja;   // el mismo auxiliar, para las pruebas que ya tienen una variable local llamada `caja`
const peticionesDelQr = (c) => c.peticiones.filter((p) => /qrcode-generator/.test(p.url));
// La fila de la llave (no la del valor, que comparte la clase .breb-llave).
const LLAVE_P = '.breb-llave:not(.breb-valor) p';
const sinNbsp = (t) => t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
/** Sube el cuerpo de la hoja hasta dejar el QR arriba, sin nada encima (el botón pegado del comprobante cubre el pie del cuerpo): para fotografiarlo entero. */
const qrArriba = (page) => page.evaluate(() => { const c = document.querySelector('.cuenta-cuerpo'), q = document.querySelector('.breb-qr'); c.scrollTop += q.getBoundingClientRect().top - c.getBoundingClientRect().top - 4; });
/** ¿El elemento se ve ENTERO dentro del cuerpo de la hoja sin desplazar nada (y sin quedar debajo del bloque pegado del comprobante)? */
const enteroSinDesplazar = (page, selector) => page.evaluate((sel) => {
  const e = document.querySelector(sel); if (!e) return null;
  const r = e.getBoundingClientRect(), c = document.querySelector('.cuenta-cuerpo').getBoundingClientRect();
  const pegado = document.querySelector('#pago-comprobante-bloque');
  const limite = pegado ? pegado.getBoundingClientRect().top : c.bottom;
  return r.top >= c.top - 0.5 && r.bottom <= limite + 0.5;
}, selector);

/** Abre «Mi cuenta» (la hoja en celular; el panel ya está en escritorio), toca «Pagar» y elige un método por su título. */
async function pagarCon(page, ancho, titulo) {
  if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
  await page.locator('.cuenta-total').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
  await page.locator('.pago-opcion').filter({ hasText: titulo }).click();
}

/** La matriz del QR tal como está DENTRO del DOM de la carta (el <svg> enlazado), para pasársela al decodificador. */
const qrDelDom = (page) => page.evaluate(() => {
  const svg = document.querySelector('.breb-qr svg');
  return { viewBox: svg.getAttribute('viewBox'), d: svg.querySelector('path').getAttribute('d'), fondo: svg.querySelector('rect').getAttribute('fill'), trazo: svg.querySelector('path').getAttribute('fill') };
});
function leerQrDelDom(q) {
  const lado = Number(q.viewBox.split(' ')[2]);
  const { matriz } = matrizDeSvgConMargen(`<svg viewBox="0 0 ${lado} ${lado}"><path d="${q.d}"/></svg>`, 4);
  return decodificarQr(matriz);
}

// ───────────────────────── el flujo, en el celular ─────────────────────────

test('390 px: Pagar → «QR (Bre-B)» → la hoja se convierte en el QR (grande, negro sobre blanco, que SE LEE), la llave con «Copiar llave», el total, el aviso al mesero y el comprobante por WhatsApp', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async (c) => {
    const { page, posts, consola } = c;
    assert.equal(peticionesDelQr(c).length, 0, 'abrir la carta no baja el generador del QR');
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    assert.equal(peticionesDelQr(c).length, 0, 'ni abrir la cuenta');
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    const opciones = page.locator('.pago-opcion');
    await opciones.first().waitFor({ state: 'visible' });
    assert.deepEqual(await opciones.locator('span.font-semibold').allInnerTexts(), ['Transferencia', 'QR (Bre-B)', 'Efectivo'], 'en el celular, «Transferencia» va primero: con la llave sí se paga desde el mismo aparato');
    assert.match(await opciones.filter({ hasText: 'QR (Bre-B)' }).innerText(), /Para escanear con otro celular/, 'y el QR dice que es para OTRO celular');
    assert.equal(posts.length, 0, 'abrir las opciones no avisa a nadie');
    await opciones.filter({ hasText: 'QR (Bre-B)' }).click();

    // La hoja pasa a ser el QR.
    const qr = page.locator('.breb-qr').first();
    await qr.waitFor({ state: 'visible' });
    await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
    assert.equal(peticionesDelQr(c).length, 1, 'el generador se pidió UNA vez, al tocar «Pagar»');
    assert.equal(peticionesDelQr(c)[0].url, `http://127.0.0.1:${servidor.address().port}/assets/vendor/qrcode-generator-1.4.4.js`, 'del mismo origen: sin CDN');
    assert.equal(await page.getByText('Paga con el QR de Bre-B').isVisible(), true);
    assert.equal(await visible(page, '.pago-opcion'), false, 'las opciones ya no están');
    assert.equal(await page.locator('.cuenta-hoja').getByText('Menú Resplandor', { exact: true }).isVisible(), false, 'el QR toma el lugar de los ítems');
    const caja = await qr.boundingBox();
    assert.ok(caja.width >= 300 && Math.abs(caja.width - caja.height) < 1, `el QR mide ${caja.width}×${caja.height}: grande (a 844 de alto, 316 px: lo que deja la llave y «Copiar llave» a la vista) y cuadrado`);
    assert.ok(caja.x >= 0 && caja.x + caja.width <= 390, 'cabe en el ancho del teléfono');
    const estilo = await qr.evaluate((e) => ({ fondo: getComputedStyle(e).backgroundColor, w: e.querySelector('svg').getBoundingClientRect().width, h: e.querySelector('svg').getBoundingClientRect().height }));
    assert.equal(estilo.fondo, 'rgb(255, 255, 255)', 'blanco puro (un lector no perdona un fondo crema)');
    assert.ok(Math.abs(estilo.w - caja.width) < 3 && Math.abs(estilo.h - caja.height) < 3, 'el dibujo llena su marco');
    const dom = await qrDelDom(page);
    assert.deepEqual([dom.fondo, dom.trazo], ['white', 'black']);
    const leido = leerQrDelDom(dom);
    assert.equal(leido.texto, QR_FICTICIO, 'lo que un lector saca del QR que está en pantalla es el contenido, byte por byte');
    assert.deepEqual([leido.nivel, leido.version], ['M', 17]);
    // Cada módulo mide más de 3 px de pantalla (≈ 10 px de la pantalla de un teléfono 3×): se lee con la cámara de otro teléfono.
    const modulos = Number(dom.viewBox.split(' ')[2]);
    assert.ok(caja.width / modulos >= 3.2, `cada módulo mide ${(caja.width / modulos).toFixed(2)} px`);
    // La llave, «Copiar llave» Y el comprobante por WhatsApp quedan a la vista sin desplazar la hoja, sobre el total (crítica visual, P0).
    const llaveCaja = await cajaDe(page, LLAVE_P);
    assert.ok(llaveCaja.y + llaveCaja.height <= (await cajaDe(page, '.cuenta-total')).y, 'la llave y «Copiar llave» se ven sin desplazar, sobre el total');
    assert.equal(await enteroSinDesplazar(page, '.breb-llave:not(.breb-valor)'), true, 'la llave y «Copiar llave» se ven enteras, sin quedar bajo el botón pegado');
    const pie = await cajaDe(page, '.cuenta-hoja footer');
    const waCaja = await cajaDe(page, '#pago-comprobante');
    assert.ok(waCaja.y + waCaja.height <= pie.y + 1 && waCaja.y >= 0, `el comprobante por WhatsApp se ve SIN desplazar, encima del total (termina en ${waCaja.y + waCaja.height}, el pie empieza en ${pie.y})`);
    // El texto alternativo.
    assert.equal(await qr.getAttribute('role'), 'img');
    assert.equal(await qr.getAttribute('aria-label'), `Código QR de Bre-B para pagar a la llave ${LLAVE_FICTICIA}`);
    assert.equal(await page.locator('.breb-qr svg').getAttribute('aria-hidden'), 'true');

    // La llave, el total, el aviso y el comprobante.
    assert.equal((await page.locator(LLAVE_P).innerText()).replace(/\s+/g, ' '), `Llave: ${LLAVE_FICTICIA}`);
    assert.equal(sinNbsp(await page.locator('.breb-valor p').innerText()), `Valor: ${TOTAL_TEXTO}`, 'el valor a la vista');
    assert.equal(sinNbsp(await page.locator('#pago-breb-sub').innerText()), `Escanéalo con otro celular y escribe ${TOTAL_TEXTO} en tu app del banco. Si es el mismo, usa la llave.`, 'el subtítulo dice el valor en vivo y no promete que se escanea con el mismo celular');
    assert.equal(await page.locator('.cuenta-total').innerText(), TOTAL_TEXTO, 'el total a pagar sigue a la vista');
    assert.equal(await visible(page, '.cuenta-total'), true);
    // La cabecera se compacta: sin la hora de apertura ni «Consumo en vivo» (no sirven ahora y comían el alto del comprobante).
    assert.equal(await page.getByText(/Cuenta abierta desde/).isVisible(), false);
    assert.equal(await page.getByText('Consumo en vivo · no es factura').isVisible(), false);
    assert.equal(await page.locator('#sheet-titulo').innerText(), 'Mesa 7');
    await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(posts.map((p) => p.cuerpo), [{ m: 7, k: TOKEN, metodo: 'qr' }], 'elegir QR sigue avisando al mesero, como hoy');
    assert.equal(posts[0].url, URL_ALERTA);
    assert.equal(posts[0].metodo, 'POST');
    assert.deepEqual(Object.keys(posts[0].cuerpo).sort(), ['k', 'm', 'metodo'], 'sin la llave, el QR ni el total');
    const wa = page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' });
    assert.equal(await wa.isVisible(), true);
    assert.match(sinNbsp(await page.locator('#pago-comprobante-bloque').innerText()), /Después de pagar, adjunta tu captura en el mensaje\./, 'dice que hay que adjuntar la captura (wa.me no adjunta imágenes)');
    const href = await wa.getAttribute('href');
    assert.equal(href, 'https://wa.me/573225542434?text=' + encodeURIComponent('Hola, soy de la mesa 7. Total a pagar: $ 99.000. Te envío el comprobante del pago con Bre-B.'));
    assert.equal(await wa.getAttribute('target'), '_blank');
    assert.equal(await wa.getAttribute('rel'), 'noopener');
    assert.ok(!href.includes(TOKEN) && !href.includes(encodeURIComponent(LLAVE_FICTICIA)), 'nada personal ni la llave en el enlace');
    assert.equal(await page.locator('#pago-comprobante').count(), 1);

    // «Copiar llave» copia de verdad.
    const copiar = page.getByRole('button', { name: 'Copiar llave' });
    await copiar.scrollIntoViewIfNeeded();
    await copiar.click();
    await page.getByRole('button', { name: 'Llave copiada' }).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), LLAVE_FICTICIA, 'lo copiado es la llave, tal cual');
    assert.equal(await page.locator('[role="status"].sr-only').filter({ hasText: 'Llave copiada' }).count(), 1, 'y se anuncia a los lectores de pantalla');
    // «Copiar valor» copia SOLO dígitos.
    await page.getByRole('button', { name: 'Copiar valor' }).click();
    await page.getByRole('button', { name: 'Valor copiado' }).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '99000', 'el valor, solo dígitos: sin «$» ni punto de miles');
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('390 px: una sola salida hacia atrás («←», «Cambiar método»): abre las opciones, y desde ahí «Volver» deja la tarjeta «Listo» con «Ver el QR de pago» y el comprobante; «Efectivo» no muestra QR ni llave', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async ({ page, posts }) => {
    await pagarCon(page, 390, 'QR (Bre-B)');
    await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#pago-breb').getByRole('button', { name: 'Volver' }).count(), 0, 'sin «Volver» en la vista de pago: eran tres salidas a tres lugares');
    assert.equal(await page.locator('#pago-breb').getByRole('button', { name: 'Cambiar método', exact: true }).count(), 1, 'la salida hacia atrás es la flecha, con nombre «Cambiar método»');
    const flecha = await caja(page, '#pago-cambiar-breb');
    assert.ok(flecha.width >= 43.5 && flecha.height >= 43.5, `la flecha mide ${flecha.width}×${flecha.height}`);
    assert.ok(flecha.x < 60, 'arriba a la izquierda');
    await page.locator('#pago-cambiar-breb').click();
    await page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Volver' }).click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-listo').innerText(), /Vas a pagar con QR de Bre-B/);
    assert.equal(await visible(page, '.breb-qr'), false);
    assert.equal(await page.locator('.cuenta-hoja').getByText('Menú Resplandor', { exact: true }).isVisible(), true, 'vuelve la cuenta');
    // Quien ya pagó y volvió a la tarjeta tiene el comprobante a un toque, sin reabrir el QR.
    const waListo = page.locator('#pago-comprobante-listo');
    assert.equal(await waListo.isVisible(), true);
    assert.equal(await waListo.getAttribute('href'), 'https://wa.me/573225542434?text=' + encodeURIComponent('Hola, soy de la mesa 7. Total a pagar: $ 99.000. Te envío el comprobante del pago con Bre-B.'));
    assert.equal(await waListo.getAttribute('target'), '_blank');
    assert.equal(await waListo.getAttribute('rel'), 'noopener');
    await page.getByRole('button', { name: 'Ver el QR de pago' }).click();
    await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
    assert.equal(posts.length, 1, 'mirar el QR otra vez no avisa de nuevo');
    await page.locator('#pago-cambiar-breb').click();
    await page.locator('.pago-opcion').filter({ hasText: 'Efectivo' }).click();
    await page.getByText(/Vas a pagar con efectivo/).waitFor({ state: 'visible' });
    assert.equal(await visible(page, '.breb-qr'), false);
    assert.equal(await page.getByRole('button', { name: /Ver el QR de pago|Copiar llave/ }).count(), 0, 'efectivo: ni QR ni llave');
    assert.equal(await page.getByRole('link', { name: /WhatsApp/ }).filter({ hasText: 'comprobante' }).count(), 0, 'ni el comprobante en la tarjeta de «Efectivo»');
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['qr', 'efectivo']);
  });
});

test('390 px: «Transferencia» muestra la llave con «Copiar llave» y el mismo botón de comprobante, SIN QR', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async (c) => {
    const { page, posts, consola } = c;
    await pagarCon(page, 390, 'Transferencia');
    await page.getByText('Transfiere con Bre-B').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.breb-qr').count(), 0, 'sin QR');
    assert.ok(peticionesDelQr(c).length <= 1, 'el generador, si se pidió, se pidió una sola vez (al tocar «Pagar», por adelantado); transferir no lo usa');
    assert.equal((await page.locator(LLAVE_P).innerText()).replace(/\s+/g, ' '), `Llave: ${LLAVE_FICTICIA}`);
    assert.equal(sinNbsp(await page.locator('#pago-breb-sub').innerText()), `Copia la llave, pégala en tu app del banco y envía ${TOTAL_TEXTO}.`);
    assert.match(await page.locator(LLAVE_P + ' span').getAttribute('class'), /text-xl/, 'la llave es el dato principal de «Transferencia»: grande');
    await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['transferencia']);
    const wa = page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' });
    assert.equal(await wa.isVisible(), true);
    assert.match(await wa.getAttribute('href'), /^https:\/\/wa\.me\/573225542434\?text=/);
    await page.getByRole('button', { name: 'Copiar llave' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), LLAVE_FICTICIA);
    await page.getByRole('button', { name: 'Copiar valor' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '99000');
    assert.equal(await page.locator('.cuenta-total').innerText(), TOTAL_TEXTO);
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('SIN `pago` en la cuenta (no configurado, apagado o función vieja): el flujo de hoy — «QR», «Transferencia», «Efectivo» — sin QR, sin llave, sin WhatsApp y sin pedir el generador', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, pago: null }, async (c) => {
    const { page, posts, consola } = c;
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    const opciones = page.locator('.pago-opcion');
    await opciones.first().waitFor({ state: 'visible' });
    assert.deepEqual(await opciones.locator('span.font-semibold').allInnerTexts(), ['QR', 'Transferencia', 'Efectivo']);
    await opciones.filter({ hasText: 'QR' }).click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-listo').innerText(), /Vas a pagar con QR/);
    assert.match(await page.locator('.pago-listo').innerText(), /Te llevan el código QR a la mesa/);
    assert.equal(await page.locator('.breb-qr, .breb-llave, #pago-comprobante, #pago-ver').count(), 0);
    assert.equal(await page.getByText(/Llave|Copiar|comprobante/).count(), 0);
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['qr']);
    assert.equal(peticionesDelQr(c).length, 0, 'sin QR que dibujar no se pide el generador');
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('el aviso al mesero falla (401, como una función con «Verify JWT» encendido): el QR y la llave SIGUEN a la vista, el aviso se explica con «Avisar de nuevo» y pagar no depende de él', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, alerta: (n, cuerpo) => (n === 1 ? { status: 401, body: { code: 401, message: 'Invalid JWT' } } : { status: 200, body: { ok: true, metodo: cuerpo.metodo, creada_en: 'x' } }) }, async ({ page, posts }) => {
    await pagarCon(page, 390, 'QR (Bre-B)');
    await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
    const aviso = page.locator('#pago-breb .pago-aviso');
    await aviso.waitFor({ state: 'visible' });
    assert.equal(await aviso.getAttribute('role'), 'alert');
    assert.match(await aviso.innerText(), /No pudimos avisar al mesero/);
    assert.equal(await visible(page, '.breb-qr'), true, 'el QR sigue a la vista');
    assert.equal(await page.locator(LLAVE_P).isVisible(), true, 'y la llave');
    assert.equal(await page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' }).count(), 1, 'y el comprobante');
    await page.waitForTimeout(1200);
    assert.equal(posts.length, 1, 'no se reintenta solo');
    await page.getByRole('button', { name: 'Avisar de nuevo' }).click();
    await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(posts.length, 2);
    assert.equal(await aviso.count(), 0);
    assert.equal(await visible(page, '.breb-qr'), true);
  });
});

test('si el archivo del generador no carga (bloqueado), la hoja lo dice y deja la llave y el comprobante: nunca un cuadro roto ni un QR inventado', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, bloquearQr: true }, async ({ page, posts }) => {
    await pagarCon(page, 390, 'QR (Bre-B)');
    await page.getByText('No pudimos dibujar el código. Usa la llave de abajo.').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.breb-qr').isVisible(), false, 'el marco del QR no se ve');
    assert.equal(await page.locator('.breb-qr-espera').isVisible(), true, 'en su lugar, el aviso');
    assert.equal(await page.locator('.breb-qr svg path').getAttribute('d'), '', 'ningún trazo dibujado');
    assert.equal((await page.locator(LLAVE_P).innerText()).replace(/\s+/g, ' '), `Llave: ${LLAVE_FICTICIA}`);
    assert.equal(await page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' }).count(), 1);
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['qr'], 'y el aviso al mesero salió');
  });
});

test('un QR corto (versión 8) también se dibuja y se lee (otra versión, otra máscara)', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, pago: { llave: '@otra.ficticia', qr: QR_FICTICIO_CORTO } }, async ({ page }) => {
    await pagarCon(page, 390, 'QR (Bre-B)');
    await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
    assert.equal(leerQrDelDom(await qrDelDom(page)).texto, QR_FICTICIO_CORTO);
    assert.equal(await page.locator('.breb-qr').getAttribute('aria-label'), 'Código QR de Bre-B para pagar a la llave @otra.ficticia');
  });
});

// El QR tal como lo ve la persona (una captura de pantalla del marco), leído por el BarcodeDetector REAL del navegador (existe en un origen seguro
// como 127.0.0.1): una segunda lectura, independiente de nuestro decodificador, de lo que de verdad se pinta.
async function leerConElDetector(page, png) {
  return page.evaluate(async (base64) => {
    if (typeof BarcodeDetector !== 'function' || !(await BarcodeDetector.getSupportedFormats()).includes('qr_code')) return null;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const imagen = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const hallados = await new BarcodeDetector({ formats: ['qr_code'] }).detect(imagen);
    return hallados.map((h) => h.rawValue);
  }, png.toString('base64'));
}

for (const [ancho, alto, movil] of [[390, 844, true], [1280, 800, false], [320, 568, true]]) {
  test(`${ancho}×${alto}: el QR que se pinta, fotografiado de la pantalla, lo lee el detector de QR del navegador y dice el contenido`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto, movil }, async ({ page }) => {
      await pagarCon(page, ancho, 'QR (Bre-B)');
      await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
      await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
      await page.waitForTimeout(700);                                   // la hoja termina de subir
      const marco = page.locator('.breb-qr');
      await marco.scrollIntoViewIfNeeded();
      await qrArriba(page);                                              // sin el botón pegado del comprobante encima (a 320×568 el QR no cabe entero con él)
      await page.waitForTimeout(150);
      const leido = await leerConElDetector(page, await marco.screenshot());
      if (leido === null) return t.skip('este navegador no trae BarcodeDetector con qr_code');
      assert.deepEqual(leido, [QR_FICTICIO], 'el detector del navegador lee, de la captura, exactamente el contenido del QR');
    });
  });
}

// ───────────────────────── accesibilidad y táctil ─────────────────────────

test('el foco sigue al flujo: «QR (Bre-B)» → el título de la vista; con Tab se llega a «Copiar llave», «Copiar valor» y el comprobante, y con Mayús+Tab a «Cambiar método» (la flecha); Escape cierra la hoja en celular', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, movil: true }, async ({ page }) => {
    await pagarCon(page, 390, 'QR (Bre-B)');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'pago-breb-titulo');
    const nombreDelFoco = () => page.evaluate(() => { const e = document.activeElement; return (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); });
    const orden = [];
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); orden.push(await nombreDelFoco()); }
    for (const esperado of ['Copiar llave', 'Copiar valor', 'Enviar comprobante por WhatsApp']) {
      assert.ok(orden.some((o) => o.startsWith(esperado)), `Tab no llega a «${esperado}»: ${JSON.stringify(orden)}`);
    }
    assert.ok(orden.indexOf('Copiar llave') < orden.indexOf('Copiar valor') && orden.indexOf('Copiar valor') < orden.findIndex((o) => o.startsWith('Enviar comprobante')), 'el orden es el visual: la llave, el valor, luego el comprobante');
    await page.locator('#pago-breb-titulo').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await nombreDelFoco(), 'Cambiar método', 'la flecha está justo antes del título');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  });
});

// Lo que se ve SIN desplazar la hoja (crítica visual, P0): el comprobante, siempre; el QR y la llave, desde 375×667. Con el viewport de la crítica: 320×568 y 360×640 (el QR
// es el piso de 240 px y no cabe todo: se desplaza por dentro), 375×667, 390×844 y 412×915.
const SIN_DESPLAZAR = { '320x568': { qr: false, llave: false }, '360x640': { qr: true, llave: false }, '375x667': { qr: true, llave: true }, '390x844': { qr: true, llave: true }, '412x915': { qr: true, llave: true } };
for (const [ancho, alto] of [[412, 915], [390, 844], [375, 667], [360, 640], [320, 568]]) {
  test(`${ancho}×${alto}: el comprobante por WhatsApp se ve SIN desplazar la hoja, el QR se ve, nada se sale a los lados y los botones miden ≥ 44 px`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto, movil: true }, async ({ page, consola }) => {
      await pagarCon(page, ancho, 'QR (Bre-B)');
      await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
      await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
      const qr = await caja(page, '.breb-qr');
      assert.ok(qr.x >= 0 && qr.x + qr.width <= ancho, `el QR (${qr.x}…${qr.x + qr.width}) cabe en ${ancho} px`);
      assert.ok(qr.width >= Math.min(240, ancho - 48) - 1, `el QR mide ${qr.width} px a ${ancho} px de ancho (nunca menos de 240)`);
      assert.equal(await page.getByText(/Cuenta abierta desde/).isVisible(), false, 'la cabecera compacta: sin la hora de apertura mientras se ve el QR');
      const marco = await page.evaluate(() => { const r = document.querySelector('.cuenta-cuerpo').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      assert.ok(qr.y >= marco.top - 1 && qr.y + qr.height <= marco.bottom + 1 || qr.y >= marco.top - 1, `el QR arranca dentro del cuerpo de la hoja (QR y=${qr.y}, cuerpo ${marco.top}…${marco.bottom})`);
      // Todos los controles de la vista, ≥ 44 px de alto y de ancho.
      // (P0) Sin tocar el scroll de nada: el botón del comprobante está entero a la vista y ENCIMA del total.
      const pie = await caja(page, '.cuenta-hoja footer');
      const bloque = await caja(page, '#pago-comprobante-bloque');
      const waSin = await caja(page, '#pago-comprobante');
      assert.ok(waSin.y >= 0 && waSin.y + waSin.height <= pie.y + 1, `a ${ancho}×${alto} el comprobante se ve sin desplazar (termina en ${waSin.y + waSin.height}, el pie empieza en ${pie.y})`);
      assert.ok(Math.abs((bloque.y + bloque.height) - pie.y) <= 2, 'el bloque del comprobante queda pegado sobre el total');
      const esperado = SIN_DESPLAZAR[`${ancho}x${alto}`];
      assert.equal(await enteroSinDesplazar(page, '.breb-qr'), esperado.qr, `a ${ancho}×${alto} el QR ${esperado.qr ? 'se ve entero' : 'se desplaza por dentro'}`);
      assert.equal(await enteroSinDesplazar(page, '.breb-llave:not(.breb-valor)'), esperado.llave, `a ${ancho}×${alto} la llave ${esperado.llave ? 'se ve entera' : 'se alcanza desplazando'}`);
      // Todos los controles de la vista, ≥ 44 px de alto y de ancho.
      for (const nombre of ['Cambiar método', 'Copiar llave', 'Copiar valor', 'Enviar comprobante por WhatsApp']) {
        const control = page.getByRole(nombre === 'Enviar comprobante por WhatsApp' ? 'link' : 'button', { name: nombre, exact: true });
        await control.scrollIntoViewIfNeeded();
        const b = await control.boundingBox();
        assert.ok(b.height >= 43.5 && b.width >= 43.5, `«${nombre}» mide ${b.width}×${b.height}`);
        const dentro = await control.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
        assert.equal(dentro, true, `«${nombre}» no cabe a lo ancho`);
      }
      // El cuerpo se desplaza por dentro (no la página entera) y llega a «Copiar valor» y al fondo del contenido.
      await page.evaluate(() => { const c = document.querySelector('.cuenta-cuerpo'); c.scrollTop = c.scrollHeight; });
      assert.equal(await enteroSinDesplazar(page, '.breb-valor'), true, 'al final del cuerpo se ve el valor entero, sobre el comprobante pegado');
      const bwa = await caja(page, '#pago-comprobante');
      assert.ok(bwa.y >= 0 && bwa.y + bwa.height <= alto, `el comprobante sigue a la vista tras desplazar (y=${bwa.y}, alto de la ventana ${alto})`);
      // El total no se va: el pie sigue a la vista.
      const total = await caja(page, '.cuenta-total');
      assert.ok(total.y >= 0 && total.y + total.height <= alto, 'el total sigue a la vista');
      assert.equal(await desborde(page), 0, `desborde horizontal a ${ancho} px`);
      assert.deepEqual(consola, []);
    });
  });
}

for (const [ancho, alto] of [[1280, 800], [1440, 900], [1280, 720]]) {
  test(`${ancho}×${alto}: en el panel de escritorio el QR se ve arriba y se lee, el panel entero cabe en la ventana y todo llega (llave, comprobante) sin desborde`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto }, async ({ page, posts, consola }) => {
      await pagarCon(page, ancho, 'QR (Bre-B)');
      await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
      await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
      const panel = await caja(page, '.cuenta-hoja');
      assert.ok(panel.y >= 0 && panel.y + panel.height <= alto, `el panel va de ${panel.y} a ${panel.y + panel.height} en una ventana de ${alto}`);
      const qr = await caja(page, '.breb-qr');
      assert.ok(qr.width >= 220 && Math.abs(qr.width - qr.height) < 1, `el QR mide ${qr.width}×${qr.height}`);
      assert.ok(qr.x >= panel.x && qr.x + qr.width <= panel.x + panel.width, 'el QR cabe dentro del panel');
      assert.ok(qr.y + qr.height <= alto, 'el QR se ve entero sin desplazar la ventana');
      const leido = leerQrDelDom(await qrDelDom(page));
      assert.equal(leido.texto, QR_FICTICIO);
      assert.equal(await page.getByRole('dialog').count(), 0, 'en escritorio es un panel, no un diálogo');
      assert.equal(await visible(page, '.cuenta-total'), true, 'el total sigue a la vista');
      for (const nombre of ['Copiar llave', 'Enviar comprobante por WhatsApp']) {
        const control = page.getByRole(nombre === 'Enviar comprobante por WhatsApp' ? 'link' : 'button', { name: nombre, exact: true });
        await control.scrollIntoViewIfNeeded();
        const b = await control.boundingBox();
        assert.ok(b.height >= 43.5, `«${nombre}» mide ${b.height} px de alto`);
        assert.ok(b.y >= 0 && b.y + b.height <= alto, `«${nombre}» queda a la vista`);
      }
      assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['qr']);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  });
}

test('1280 px, «Transferencia»: llave, copiar y comprobante dentro del panel, sin QR', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1280, alto: 800 }, async ({ page, consola }) => {
    await pagarCon(page, 1280, 'Transferencia');
    await page.getByText('Transfiere con Bre-B').waitFor({ state: 'visible' });
    const panel = await caja(page, '.cuenta-hoja');
    assert.ok(panel.y + panel.height <= 800);
    assert.equal(await page.locator('.breb-qr').count(), 0);
    assert.equal(await visible(page, '.breb-llave'), true);
    assert.equal(await visible(page, '#pago-comprobante'), true, 'sin QR, el comprobante cabe sin desplazar');
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('si el admin lo apaga mientras se mira (la siguiente lectura ya no trae `pago`), la hoja vuelve a la cuenta sola y no queda un QR huérfano', { skip: saltar() }, async (t) => {
  const c = await abrir({ ancho: 390, alto: 844 });
  try {
    if (!c.alpine) return t.skip('Alpine no cargó');
    const { page } = c;
    await pagarCon(page, 390, 'QR (Bre-B)');
    await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
    // La próxima lectura de `cuenta` llega sin `pago`.
    await page.unroute(/\.supabase\.co\//);
    await page.route(/\.supabase\.co\//, (r) => {
      const url = r.request().url();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (url.includes('/functions/v1/cuenta')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ mesa: 7, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items: [...ITEMS, { nombre: 'Agua', precio: 3000, cantidad: 1 }], total: 102000 }) });
      if (url.includes('/functions/v1/alerta')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, metodo: 'qr' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(FILAS_CARTA) });
    });
    await page.evaluate(() => { const b = document.querySelector('[x-data]'); return b._x_dataStack[0]._leer('prueba'); });
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(await page.locator('.breb-qr').count(), 0);
    assert.equal(await visible(page, '#pago-ver'), false, 'sin datos no hay «Ver el QR»');
    assert.equal(await page.getByText('$ 102.000').first().isVisible(), true);
  } finally {
    await c.contexto.close();
  }
});
