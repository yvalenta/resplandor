// «Pagar con Bre-B» en carta.html, EN NAVEGADOR (Chromium con Playwright, ver _navegador.mjs; si no hay, se salta con el motivo). Complemento de
// pago-breb-carta.test.mjs (el <script> en un vm, siempre corre). Aquí se mira lo que solo un navegador de verdad dice: que «Pagar» abre UNA sola pantalla
// («Paga como prefieras») con el QR GRANDE, cuadrado, negro sobre blanco y entero, la llave, el valor, el comprobante por WhatsApp y «O en efectivo»,
// SIN que nadie elija nada (se quitaron las tres opciones y «Cambiar método»); que avisa sola al mesero con «cuenta» y los toques que quedan (copiar la
// llave, «Avisar que pago en efectivo») solo afinan ese aviso; que la llave se copia al portapapeles de verdad; que el enlace de WhatsApp sale bien; que
// nada se sale de la pantalla a 320, 360, 390, 1280 y 1440 px; que los botones miden 44 px; el foco y los textos para lectores de pantalla; y que el
// generador del QR se pide una vez, del mismo origen, solo al tocar «Pagar».
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

/** Abre «Mi cuenta» (la hoja en celular; el panel ya está en escritorio) y toca «Pagar»: la pantalla de pago abre (con lo que haya) y avisa sola. */
async function pagarCon(page, ancho) {
  if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
  await page.locator('.cuenta-total').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await page.locator('#pago-breb').waitFor({ state: 'visible' });
}

/** Espera a que el QR esté DIBUJADO: el <svg> sale al abrir «Pagar» (con «Preparando el código…» mientras baja el generador) y su trazo `d` se llena cuando el generador carga. */
const qrDibujado = (page) => page.waitForFunction(() => { const p = document.querySelector('.breb-qr svg path'); return Boolean(p && p.getAttribute('d')); }, null, { timeout: 15000 });
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

test('390 px: Pagar → UNA pantalla con el QR (grande, negro sobre blanco, que SE LEE), la llave con «Copiar llave», el valor, «O en efectivo», el total, el aviso «cuenta» al mesero y el comprobante por WhatsApp', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async (c) => {
    const { page, posts, consola } = c;
    assert.equal(peticionesDelQr(c).length, 0, 'abrir la carta no baja el generador del QR');
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    assert.equal(peticionesDelQr(c).length, 0, 'ni abrir la cuenta');
    assert.equal(posts.length, 0, 'abrir la cuenta no avisa a nadie: solo «Pagar»');
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('#pago-breb').waitFor({ state: 'visible' });

    // La hoja pasa a ser el QR.
    const qr = page.locator('.breb-qr').first();
    await qr.waitFor({ state: 'visible' });
    await qrDibujado(page);
    assert.equal(peticionesDelQr(c).length, 1, 'el generador se pidió UNA vez, al tocar «Pagar»');
    assert.equal(peticionesDelQr(c)[0].url, `http://127.0.0.1:${servidor.address().port}/assets/vendor/qrcode-generator-1.4.4.js`, 'del mismo origen: sin CDN');
    assert.equal(await page.locator('#pago-breb-titulo').innerText(), 'Paga como prefieras');
    assert.equal(await page.locator('.pago-opcion').count(), 0, 'no hay nada que elegir: QR, llave, valor y efectivo van a la vez');
    assert.equal(sinNbsp(await page.locator('#pago-qr-pie').innerText()), 'QR de Bre-B · para escanear con otro celular', 'el QR dice que es para OTRO celular');
    assert.equal(await visible(page, '#pago-efectivo'), true, '«O en efectivo» también está');
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
    assert.equal(sinNbsp(await page.locator('#pago-breb-sub').innerText()), `Desde tu app del banco, con ${TOTAL_TEXTO}: escanea el QR con otro celular o copia la llave. O en efectivo.`, 'el subtítulo dice el valor en vivo y no promete que se escanea con el mismo celular');
    assert.equal(await page.locator('.cuenta-total').innerText(), TOTAL_TEXTO, 'el total a pagar sigue a la vista');
    assert.equal(await visible(page, '.cuenta-total'), true);
    // La cabecera se compacta: sin la hora de apertura ni «Consumo en vivo» (no sirven ahora y comían el alto del comprobante).
    assert.equal(await page.getByText(/Cuenta abierta desde/).isVisible(), false);
    assert.equal(await page.getByText('Consumo en vivo · no es factura').isVisible(), false);
    assert.equal(await page.locator('#sheet-titulo').innerText(), 'Mesa 7');
    await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(posts.map((p) => p.cuerpo), [{ m: 7, k: TOKEN, metodo: 'cuenta' }], 'abrir «Pagar» avisa sola al mesero con «cuenta», sin elegir nada');
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
    await page.waitForTimeout(400);
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta', 'transferencia'], 'copiar la llave afinó el aviso a «transferencia» (y copiar el valor no lo repitió)');
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('390 px: una sola salida hacia atrás («←», «Volver a la cuenta»); «Avisar que pago en efectivo» afina el aviso sin esconder el QR ni la llave; volver deja la tarjeta «Listo» con «Ver cómo pagar» y el comprobante', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async ({ page, posts }) => {
    await pagarCon(page, 390);
    await qrDibujado(page);
    await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pago-breb').getByRole('button', { name: 'Volver', exact: true }).count(), 0, 'sin «Volver» suelto en la pantalla de pago');
    assert.equal(await page.locator('#pago-breb').getByRole('button', { name: 'Cambiar método' }).count(), 0, 'ya no hay método que cambiar');
    assert.equal(await page.locator('#pago-breb').getByRole('button', { name: 'Volver a la cuenta', exact: true }).count(), 1, 'la salida hacia atrás es la flecha, con nombre «Volver a la cuenta»');
    const flecha = await caja(page, '#pago-cambiar-breb');
    assert.ok(flecha.width >= 43.5 && flecha.height >= 43.5, `la flecha mide ${flecha.width}×${flecha.height}`);
    assert.ok(flecha.x < 60, 'arriba a la izquierda');

    // «O en efectivo» está SIEMPRE en la pantalla; su botón solo afina el aviso (la misma alerta pasa a «efectivo») y no esconde nada.
    assert.equal(await visible(page, '#pago-efectivo'), true);
    await page.locator('#pago-avisar-efectivo').scrollIntoViewIfNeeded();
    await page.locator('#pago-avisar-efectivo').click();
    await page.getByText('Le avisamos: pagas en efectivo.').waitFor({ state: 'visible' });
    assert.equal(await visible(page, '#pago-avisar-efectivo'), false, 'ya avisado el efectivo, el botón se esconde');
    assert.equal(await page.locator('.breb-qr svg path').count(), 1, 'el QR sigue en la pantalla');
    assert.equal(await page.locator(LLAVE_P).count(), 1, 'y la llave');
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta', 'efectivo']);

    // Volver a la cuenta: «Listo, le avisamos» con lo que se avisó.
    await page.locator('#pago-cambiar-breb').click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-listo').innerText(), /Vas a pagar con efectivo/);
    assert.equal(await visible(page, '.breb-qr'), false);
    assert.equal(await page.locator('.cuenta-hoja').getByText('Menú Resplandor', { exact: true }).isVisible(), true, 'vuelve la cuenta');
    // Quien ya pagó y volvió a la tarjeta tiene el comprobante a un toque, sin reabrir la pantalla.
    const waListo = page.locator('#pago-comprobante-listo');
    assert.equal(await waListo.isVisible(), true);
    assert.equal(await waListo.getAttribute('href'), 'https://wa.me/573225542434?text=' + encodeURIComponent('Hola, soy de la mesa 7. Total a pagar: $ 99.000. Te envío el comprobante del pago con Bre-B.'));
    assert.equal(await waListo.getAttribute('target'), '_blank');
    assert.equal(await waListo.getAttribute('rel'), 'noopener');
    assert.equal(await page.getByRole('button', { name: 'Cambiar método' }).count(), 0, 'ya no hay «Cambiar método»');
    // «Ver cómo pagar» reabre la pantalla SIN avisar de nuevo.
    await page.getByRole('button', { name: 'Ver cómo pagar' }).click();
    await qrDibujado(page);
    assert.equal(posts.length, 2, 'mirar la pantalla otra vez no avisa de nuevo');
  });
});

test('390 px: solo la llave (sin QR): la pantalla la muestra grande con «Copiar llave», el valor y el comprobante, sin QR y sin pedir el generador; copiar afina el aviso a «transferencia»', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, pago: { llave: LLAVE_FICTICIA, qr: null } }, async (c) => {
    const { page, posts, consola } = c;
    await pagarCon(page, 390);
    assert.equal(await page.locator('.breb-qr').count(), 0, 'sin QR');
    assert.equal(peticionesDelQr(c).length, 0, 'sin QR que dibujar no se pide el generador');
    assert.equal((await page.locator(LLAVE_P).innerText()).replace(/\s+/g, ' '), `Llave: ${LLAVE_FICTICIA}`);
    assert.equal(sinNbsp(await page.locator('#pago-breb-sub').innerText()), `Desde tu app del banco, con ${TOTAL_TEXTO}: copia la llave. O en efectivo.`);
    assert.match(await page.locator(LLAVE_P + ' span').getAttribute('class'), /text-xl/, 'la llave es el dato principal: grande');
    await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta']);
    const wa = page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' });
    assert.equal(await wa.isVisible(), true);
    assert.match(await wa.getAttribute('href'), /^https:\/\/wa\.me\/573225542434\?text=/);
    await page.getByRole('button', { name: 'Copiar llave' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), LLAVE_FICTICIA);
    await page.getByRole('button', { name: 'Copiar valor' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '99000');
    await page.waitForTimeout(400);
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta', 'transferencia'], 'copiar la llave afinó el aviso a «transferencia» (y copiar el valor no lo repitió)');
    assert.equal(await page.locator('.cuenta-total').innerText(), TOTAL_TEXTO);
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('SIN `pago` en la cuenta (no configurado, apagado o función vieja): la pantalla de pago dice que el mesero lleva el QR o los datos y deja el efectivo — sin QR, sin llave, sin WhatsApp y sin pedir el generador', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, pago: null }, async (c) => {
    const { page, posts, consola } = c;
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('#pago-breb').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pago-breb-titulo').innerText(), 'Paga como prefieras');
    assert.match(await page.locator('#pago-sin-datos').innerText(), /El mesero te lleva el QR o los datos para transferir\./);
    assert.equal(sinNbsp(await page.locator('#pago-breb-sub').innerText()), 'El mesero te lleva el QR o los datos para transferir. O en efectivo.');
    assert.equal(await visible(page, '#pago-efectivo'), true, 'el efectivo siempre está');
    assert.equal(await page.locator('.breb-qr, .breb-llave, #pago-comprobante').count(), 0);
    assert.doesNotMatch(await page.locator('#pago-breb').innerText(), /Llave|Copiar|comprobante/i, 'ni una palabra de llave, copiar o comprobante en la pantalla');
    await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(posts.map((p) => p.cuerpo), [{ m: 7, k: TOKEN, metodo: 'cuenta' }], 'avisa «cuenta» al abrir, aunque no haya datos que mostrar');
    await page.locator('#pago-avisar-efectivo').click();
    await page.getByText('Le avisamos: pagas en efectivo.').waitFor({ state: 'visible' });
    await page.locator('#pago-cambiar-breb').click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-listo').innerText(), /Vas a pagar con efectivo/);
    assert.match(await page.locator('.pago-listo').innerText(), /Pasan por tu mesa a recibirlo/);
    assert.equal(await page.locator('.breb-qr, .breb-llave, #pago-comprobante').count(), 0);
    assert.equal(await visible(page, '#pago-comprobante-listo'), false, 'sin datos de Bre-B la tarjeta «Listo» no ofrece el comprobante');
    assert.doesNotMatch(await page.locator('.pago-listo').innerText(), /Llave|Copiar|comprobante/i);
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta', 'efectivo']);
    assert.equal(peticionesDelQr(c).length, 0, 'sin QR que dibujar no se pide el generador');
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('el aviso al mesero falla (401, como una función con «Verify JWT» encendido): el QR y la llave SIGUEN a la vista, el aviso se explica con «Avisar de nuevo» y pagar no depende de él', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, alerta: (n, cuerpo) => (n === 1 ? { status: 401, body: { code: 401, message: 'Invalid JWT' } } : { status: 200, body: { ok: true, metodo: cuerpo.metodo, creada_en: 'x' } }) }, async ({ page, posts }) => {
    await pagarCon(page, 390);
    await qrDibujado(page);
    const aviso = page.locator('#pago-breb .pago-aviso');
    await aviso.waitFor({ state: 'visible' });
    assert.equal(await aviso.getAttribute('role'), 'alert');
    assert.match(await aviso.innerText(), /No pudimos avisar al mesero/);
    assert.equal(await visible(page, '.breb-qr'), true, 'el QR sigue a la vista');
    assert.equal(await page.locator(LLAVE_P).isVisible(), true, 'y la llave');
    assert.equal(await page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' }).count(), 1, 'y el comprobante');
    assert.equal(await visible(page, '#pago-efectivo'), true, 'y el efectivo');
    await page.waitForTimeout(1200);
    assert.equal(posts.length, 1, 'no se reintenta solo');
    await page.getByRole('button', { name: 'Avisar de nuevo' }).click();
    await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta', 'cuenta'], '«Avisar de nuevo» vuelve a mandar el mismo aviso («cuenta»: no había quedado nada avisado)');
    assert.equal(await aviso.count(), 0);
    assert.equal(await visible(page, '.breb-qr'), true);
  });
});

test('si el archivo del generador no carga (bloqueado), la hoja lo dice y deja la llave y el comprobante: nunca un cuadro roto ni un QR inventado', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, bloquearQr: true }, async ({ page, posts }) => {
    await pagarCon(page, 390);
    await page.getByText('No pudimos dibujar el código. Usa la llave de abajo.').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.breb-qr').isVisible(), false, 'el marco del QR no se ve');
    assert.equal(await page.locator('.breb-qr-espera').isVisible(), true, 'en su lugar, el aviso');
    assert.equal(await page.locator('.breb-qr svg path').getAttribute('d'), '', 'ningún trazo dibujado');
    assert.equal((await page.locator(LLAVE_P).innerText()).replace(/\s+/g, ' '), `Llave: ${LLAVE_FICTICIA}`);
    assert.equal(await page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' }).count(), 1);
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta'], 'y el aviso al mesero salió');
  });
});

test('un QR corto (versión 8) también se dibuja y se lee (otra versión, otra máscara)', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, pago: { llave: '@otra.ficticia', qr: QR_FICTICIO_CORTO } }, async ({ page }) => {
    await pagarCon(page, 390);
    await qrDibujado(page);
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
      await pagarCon(page, ancho);
      await qrDibujado(page);
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

test('el foco sigue al flujo: «Pagar» → el título de la pantalla; con Tab se llega a «Copiar llave», «Copiar valor», «Avisar que pago en efectivo» y el comprobante, y con Mayús+Tab a «Volver a la cuenta» (la flecha); Escape cierra la hoja en celular', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, movil: true }, async ({ page }) => {
    await pagarCon(page, 390);
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'pago-breb-titulo');
    const nombreDelFoco = () => page.evaluate(() => { const e = document.activeElement; return (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); });
    const orden = [];
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); orden.push(await nombreDelFoco()); }
    const esperados = ['Copiar llave', 'Copiar valor', 'Avisar que pago en efectivo', 'Enviar comprobante por WhatsApp'];
    for (const esperado of esperados) assert.ok(orden.some((o) => o.startsWith(esperado)), `Tab no llega a «${esperado}»: ${JSON.stringify(orden)}`);
    assert.deepEqual(esperados.map((e) => orden.findIndex((o) => o.startsWith(e))), [0, 1, 2, 3], `el orden es el visual: la llave, el valor, el efectivo, luego el comprobante (${JSON.stringify(orden)})`);
    await page.locator('#pago-breb-titulo').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await nombreDelFoco(), 'Volver a la cuenta', 'la flecha está justo antes del título');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  });
});

// Lo que se ve SIN desplazar la hoja (crítica visual, P0): el comprobante, siempre; el QR, desde 360×640; la llave, desde 390×844. Con el viewport de la crítica: 320×568 y 360×640 (el QR
// es el piso de 240 px y no cabe todo: se desplaza por dentro), 375×667, 390×844 y 412×915. Con la pantalla única (2026-10-04) la llave de 375×667 YA NO cabe sin desplazar (antes sí): el
// subtítulo pasa de 2 a 3 renglones y el QR trae su pie «para escanear con otro celular» (≈ 28 px más), así que «Copiar llave» queda detrás del comprobante pegado hasta que se baja el cuerpo.
// «O en efectivo» queda siempre más abajo (hay que desplazar; no hace falta tocarlo: el aviso ya salió al abrir «Pagar»).
const SIN_DESPLAZAR = { '320x568': { qr: false, llave: false }, '360x640': { qr: true, llave: false }, '375x667': { qr: true, llave: false }, '390x844': { qr: true, llave: true }, '412x915': { qr: true, llave: true } };
for (const [ancho, alto] of [[412, 915], [390, 844], [375, 667], [360, 640], [320, 568]]) {
  test(`${ancho}×${alto}: el comprobante por WhatsApp se ve SIN desplazar la hoja, el QR se ve, nada se sale a los lados y los botones miden ≥ 44 px`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto, movil: true }, async ({ page, consola }) => {
      await pagarCon(page, ancho);
      await qrDibujado(page);
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
      for (const nombre of ['Volver a la cuenta', 'Copiar llave', 'Copiar valor', 'Avisar que pago en efectivo', 'Enviar comprobante por WhatsApp']) {
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
      assert.equal(await enteroSinDesplazar(page, '#pago-efectivo'), true, 'y «O en efectivo» con su botón: se alcanzan desplazando el cuerpo, sin quedar bajo el comprobante');
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
      await pagarCon(page, ancho);
      await qrDibujado(page);
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
      assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta']);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  });
}

test('1280 px, solo la llave (sin QR): llave, copiar y comprobante dentro del panel, sin QR', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1280, alto: 800, pago: { llave: LLAVE_FICTICIA, qr: null } }, async ({ page, consola }) => {
    await pagarCon(page, 1280);
    const panel = await caja(page, '.cuenta-hoja');
    assert.ok(panel.y + panel.height <= 800);
    assert.equal(await page.locator('.breb-qr').count(), 0);
    assert.equal(await visible(page, '.breb-llave'), true);
    assert.equal(await visible(page, '#pago-efectivo'), true);
    assert.equal(await visible(page, '#pago-comprobante'), true, 'sin QR, el comprobante cabe sin desplazar');
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('si el admin lo apaga mientras se mira (la siguiente lectura ya no trae `pago`), la pantalla de pago se queda sin QR ni llave («el mesero te lleva…») pero con el efectivo, y no queda un QR huérfano', { skip: saltar() }, async (t) => {
  const c = await abrir({ ancho: 390, alto: 844 });
  try {
    if (!c.alpine) return t.skip('Alpine no cargó');
    const { page } = c;
    await pagarCon(page, 390);
    await qrDibujado(page);
    // La próxima lectura de `cuenta` llega sin `pago`.
    await page.unroute(/\.supabase\.co\//);
    await page.route(/\.supabase\.co\//, (r) => {
      const url = r.request().url();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (url.includes('/functions/v1/cuenta')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ mesa: 7, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items: [...ITEMS, { nombre: 'Agua', precio: 3000, cantidad: 1 }], total: 102000 }) });
      if (url.includes('/functions/v1/alerta')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, metodo: 'cuenta' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(FILAS_CARTA) });
    });
    await page.evaluate(() => { const b = document.querySelector('[x-data]'); return b._x_dataStack[0]._leer('prueba'); });
    await page.locator('#pago-sin-datos').waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(await page.locator('.breb-qr').count(), 0);
    assert.equal(await page.locator('.breb-llave, #pago-comprobante').count(), 0, 'ni llave ni comprobante');
    assert.equal(await visible(page, '#pago-breb'), true, 'la pantalla de pago NO se cierra: el aviso y el efectivo no dependen de Bre-B');
    assert.equal(await visible(page, '#pago-efectivo'), true);
    assert.equal(await page.getByText('$ 102.000').first().isVisible(), true);
  } finally {
    await c.contexto.close();
  }
});

