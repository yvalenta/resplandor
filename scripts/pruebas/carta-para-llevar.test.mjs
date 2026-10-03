// «Mi cuenta» de carta.html con «Todo para llevar» (pedido de Yonatan, 2026-10-02; docs/para-llevar.md, parte D).
//
// El POS marca el pedido completo con una línea de $0 de id fijo `para_llevar` (nombre «Para llevar»). La función pública `cuenta` NO manda
// ids ni notas («solo lo que el comensal necesita»), así que la línea llega como {nombre: 'Para llevar', precio: 0, cantidad: 1} y la carta
// la reconoce por nombre y precio. Tiene que mostrarla como lo que es:
//   - una ETIQUETA «Para llevar» sobre la lista, no una línea de $0 con «1×»;
//   - no suma a «N productos», no se resalta ni se anuncia como «Se agregó 1 × Para llevar»: el cambio se anuncia como pedido
//     («El pedido es para llevar» / «El pedido ya no es para llevar»);
//   - el Total no cambia (es $0).
// La marca por PRODUCTO vive en la nota de la línea y `cuenta` no la manda: la carta no la ve (ver docs/para-llevar.md, «Pendientes»).
//
// Dos partes, como carta-abonos.test.mjs: el script de carta.html en un vm (siempre) y en navegador (solo con Chromium).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { crearCarta, RAIZ } from './_carta-vm.mjs';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';
import { conBanderas } from './_sitio.mjs';

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const plano = (x) => JSON.parse(JSON.stringify(x));

const MENU = { nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 };
const JUGO = { nombre: 'Jugo natural en agua', precio: 7000, cantidad: 3 };
const PRODUCTOS = [MENU, JUGO];                                   // 46.000 + 21.000 = 67.000
const LLEVAR = { nombre: 'Para llevar', precio: 0, cantidad: 1 };
const lineas = (h) => plano(h.c.cuenta.items).map((i) => `${i.nombre}|${i.precio}|${i.cantidad}`);

// ───────────────────────── 1. estática ─────────────────────────

test('el marcado: la etiqueta «Para llevar» va sobre la lista (con la bolsa del sprite), solo con cuenta.llevar, y la lista no la dibuja', () => {
  const html = sinComentarios(leer('carta.html'));
  assert.match(html, /<p class="cuenta-llevar" x-show="cuenta\.llevar" x-cloak><svg class="icono" aria-hidden="true"><use href="#i-shopping-bag"\/><\/svg> Para llevar<\/p>\s*<ul class="divide-y divide-linea border-t border-linea">/);
  assert.match(html, /<symbol id="i-shopping-bag" viewBox="0 0 24 24">/, 'la bolsa está en el sprite de la página (scripts/iconos.mjs)');
  assert.doesNotMatch(html, /x-html/);
  const css = leer('assets/css/carta-menu.css');
  const regla = css.match(/\.cuenta-llevar \{[^}]*\}/);
  assert.ok(regla, 'falta la regla .cuenta-llevar');
  assert.doesNotMatch(regla[0], /#[0-9A-Fa-f]{3,8}\b/, 'sin hex nuevos: los tonos salen de los tokens');
  assert.match(css, /\.cuenta-llevar \.icono \{ color: var\(--color-barro\); \}/);
  assert.match(leer('assets/css/resplandor.css'), /\.cuenta-llevar/, 'el CSS compilado la lleva (scripts/css.mjs)');
});

// ───────────────────────── 2. el script en un vm ─────────────────────────

test('vm: el marcador no es una línea ni un producto — no se agrupa, no suma a «N productos» y el total no cambia', async () => {
  const h = await crearCarta({ items: [...PRODUCTOS, LLEVAR] });
  await h.iniciar();
  await h.abrir();
  assert.equal(h.c.cuenta.estado, 'ok');
  assert.equal(h.c.cuenta.llevar, true);
  assert.deepEqual(lineas(h), ['Menú Resplandor|23000|2', 'Jugo natural en agua|7000|3'], 'sin la línea de $0');
  assert.equal(h.c.unidades, 5);
  assert.equal(h.c.cuenta.total, 67000);
  assert.equal(h.c.consumo, 67000);
  assert.equal(h.c.hayAbonos, false);
  assert.equal(h.c.etiquetaTotal, 'Total');
});

test('vm: sin el marcador, la carta es la de siempre (llevar en falso) y un producto que se llame así pero cueste algo SÍ es un producto', async () => {
  const h = await crearCarta({ items: PRODUCTOS });
  await h.iniciar();
  await h.abrir();
  assert.equal(h.c.cuenta.llevar, false);
  assert.equal(h.c.unidades, 5);
  assert.equal(h.c.esMarcadorLlevar(LLEVAR), true);
  assert.equal(h.c.esMarcadorLlevar({ nombre: 'Para llevar', precio: 2000, cantidad: 1 }), false, 'una bolsa que se cobra es un producto');
  assert.equal(h.c.esMarcadorLlevar({ nombre: 'Para llevar (empaque)', precio: 0, cantidad: 1 }), false);
  assert.equal(h.c.esMarcadorLlevar(null), false);
  const g = h.c._agrupar([MENU, LLEVAR, { nombre: 'Para llevar', precio: 2000, cantidad: 2 }]);
  assert.deepEqual(plano(g).map((i) => `${i.nombre}|${i.precio}|${i.cantidad}`), ['Menú Resplandor|23000|2', 'Para llevar|2000|2']);
});

test('vm: el marcador que llega en vivo se anuncia como pedido («El pedido es para llevar»), no como «Se agregó 1 × Para llevar», y al quitarlo, «ya no es para llevar»', async () => {
  const h = await crearCarta({ items: PRODUCTOS });
  await h.iniciar();
  await h.abrir();
  assert.equal(h.c.cuenta.llevar, false);
  h.cambio((m) => m.agregar('Para llevar', 0, 1));
  await h.avanzar(1500);
  assert.equal(h.c.cuenta.llevar, true);
  assert.equal(h.c.anuncio, 'El pedido es para llevar');
  assert.doesNotMatch(h.c.anuncio, /Se agregó/);
  assert.deepEqual(plano(h.c.resaltados), [], 'nada se ilumina como «recién agregado»');
  assert.equal(h.c.cuenta.total, 67000);
  h.cambio((m) => { m.orden.items = m.orden.items.filter((i) => i.nombre !== 'Para llevar'); m.orden.version++; });
  await h.avanzar(1500);
  assert.equal(h.c.cuenta.llevar, false);
  assert.equal(h.c.anuncio, 'El pedido ya no es para llevar');
  // Un producto y el marcador a la vez: las dos cosas se anuncian.
  h.cambio((m) => { m.agregar('Para llevar', 0, 1); m.agregar('Limonada', 8000, 2); });
  await h.avanzar(1500);
  assert.equal(h.c.anuncio, 'El pedido es para llevar. Se agregó 2 × Limonada');
  assert.equal(h.c.unidades, 7);
});

test('vm: la cuenta que llegó con el marcador desde la primera lectura no anuncia nada (solo los cambios se anuncian)', async () => {
  const h = await crearCarta({ items: [...PRODUCTOS, LLEVAR] });
  await h.iniciar();
  await h.abrir();
  assert.equal(h.c.anuncio, '');
  assert.equal(h.c.cuenta.llevar, true);
});

// ───────────────────────── 3. en navegador ─────────────────────────

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

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const FILAS_CARTA = (() => {
  const caja = {};
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leer('assets/js/carta-respaldo.js'), caja);
  return JSON.parse(JSON.stringify(caja.RESPLANDOR_CARTA_RESPALDO.filas));
})();
const LOCAL_JS = leer('assets/js/local.js');

async function abrir({ ancho, alto = 800, items }) {
  const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const page = await contexto.newPage();
  const consola = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || '')) consola.push(m.text()); });
  page.on('pageerror', (e) => consola.push(`pageerror: ${e.message}`));
  await page.route(/\.supabase\.co\//, (r) => {
    const req = r.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (url.includes('/rest/v1/carta_publica')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(FILAS_CARTA) });
    if (url.includes('/functions/v1/cuenta')) {
      return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ mesa: 7, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items, total }) });
    }
    return r.fulfill({ status: 404, headers: CORS, body: '{}' });
  });
  await page.route('**/assets/js/local.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: conBanderas(LOCAL_JS, { pagarEnMesa: false }) }));
  await page.goto(`http://127.0.0.1:${servidor.address().port}/carta.html?m=7&k=${TOKEN}`, { waitUntil: 'load' });
  const alpine = await page.waitForFunction(() => window.Alpine && document.querySelector('[x-data]') && document.querySelector('[x-data]')._x_dataStack, null, { timeout: 8000 }).then(() => true, () => false);
  return { contexto, page, consola, alpine };
}
const texto = async (page, selector) => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ').trim();

for (const [ancho, alto, donde] of [[390, 844, 'la hoja (390 px)'], [1280, 800, 'el panel (1280 px)']]) {
  test(`${donde}: «Todo para llevar» se ve como la etiqueta «Para llevar» y no como una línea de $0; no cuenta como producto, el total no cambia; sin desborde ni errores`, { skip: saltar() }, async (t) => {
    const c = await abrir({ ancho, alto, items: [...PRODUCTOS, LLEVAR] });
    try {
      if (!c.alpine) return t.skip('Alpine no cargó: sin él la página no pinta nada');
      const { page } = c;
      if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      const etiqueta = page.locator('.cuenta-llevar');
      assert.equal(await etiqueta.isVisible(), true);
      assert.equal((await etiqueta.innerText()).trim(), 'Para llevar');
      assert.equal(await etiqueta.locator('svg').count(), 1, 'con la bolsa');
      const filas = (await page.locator('.cuenta-cuerpo li').allInnerTexts()).map((f) => f.replace(/\s+/g, ' ').trim());
      assert.equal(filas.length, 2, 'dos productos: la línea de $0 no se dibuja');
      assert.equal(filas.some((f) => /Para llevar|\$ 0\b/.test(f)), false);
      assert.match(await texto(page, '.cuenta-cuerpo'), /^5 productos/i, 'el marcador no cuenta como producto');
      assert.equal(await texto(page, '.cuenta-total'), '$ 67.000');
      const colores = await page.evaluate(() => { const e = document.querySelector('.cuenta-llevar'); const cs = getComputedStyle(e); return { texto: cs.color, fondo: cs.backgroundColor, bolsa: getComputedStyle(e.querySelector('svg')).color }; });
      assert.notEqual(colores.bolsa, colores.texto, 'la bolsa va en otro tono que el texto');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde horizontal');
      assert.deepEqual(c.consola, []);
    } finally {
      await c.contexto.close();
    }
  });

  test(`${donde}: sin el marcador no hay etiqueta (la cuenta de siempre)`, { skip: saltar() }, async (t) => {
    const c = await abrir({ ancho, alto, items: PRODUCTOS });
    try {
      if (!c.alpine) return t.skip('Alpine no cargó: sin él la página no pinta nada');
      const { page } = c;
      if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.cuenta-llevar').isVisible(), false);
      assert.equal(await page.locator('.cuenta-cuerpo li').count(), 2);
    } finally {
      await c.contexto.close();
    }
  });
}
