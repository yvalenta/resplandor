// «Mi cuenta» de carta.html con ABONOS (tarea ola-b, parte B4; docs/sdd-cuenta-en-mesa.md §03.5 y §04.7).
//
// Un abono es un cobro por monto que el mesero registra en el POS («Cobrar por partes → monto»): en la orden
// ABIERTA queda como una línea «Abono recibido» de precio NEGATIVO (aplicar_delta_orden, p_precio = −monto,
// delta +1), y `cuenta` la manda igual que a cualquier línea ({nombre, precio < 0, cantidad}). La carta tiene
// que mostrarla como lo que es:
//   - NO como producto: sin «1×», con signo menos y otro tono; no suma a «N productos» ni se anuncia como
//     «Se agregó»;
//   - el Total es lo que QUEDA (el servidor suma precio × cantidad de todas las líneas), y el pie dice cuánto
//     fue el consumo y cuánto el abono;
//   - el agrupado por nombre + PRECIO no funde abonos de montos distintos (el monto es parte de la llave),
//     y los del mismo monto se agrupan como el servidor: «2 abonos de $ 10.000», con su suma.
// Decisión: los abonos van al final de la lista (primero lo consumido, después lo ya pagado).
//
// Tres partes, como pagar.test.mjs:
//   1. ESTÁTICA: el marcado y el CSS (sin hex nuevos, el tono sale de un token de base.css).
//   2. EL SCRIPT de carta.html corrido en un vm con reloj virtual (corre siempre): agrupado, orden, getters,
//      anuncio, formato del signo menos.
//   3. EN NAVEGADOR (solo con Playwright y Chromium, ver _navegador.mjs), con la red simulada: a 390 px (hoja)
//      y a 1280 px (panel), sin desborde y sin errores de consola.
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
const plano = (x) => JSON.parse(JSON.stringify(x)); // trae a este realm lo que salió de un `vm`

const MENU = { nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 };
const HAMBURGUESA = { nombre: 'Hamburguesa Resplandor', precio: 32000, cantidad: 1 };
const JUGO = { nombre: 'Jugo natural en agua', precio: 7000, cantidad: 3 };
const PRODUCTOS = [MENU, HAMBURGUESA, JUGO];                       // 46.000 + 32.000 + 21.000 = 99.000
const CONSUMO = 99000;
const abono = (monto, cantidad = 1) => ({ nombre: 'Abono recibido', precio: -monto, cantidad });

// ───────────────────────── 1. estática ─────────────────────────

test('el marcado: el «N×» solo va en los productos; el abono lleva un «−», su monto con signo y el desglose del pie existe solo con abonos', () => {
  const html = sinComentarios(leer('carta.html'));
  const lista = html.slice(html.indexOf('<template x-for="it in cuenta.items"'), html.indexOf('</ul>', html.indexOf('<template x-for="it in cuenta.items"')));
  assert.ok(lista.length > 300, 'no encontré la lista de ítems de «Mi cuenta»');
  // La cantidad «N×» está dentro de una plantilla que excluye al abono, y el abono tiene la suya con el «−».
  assert.match(lista, /<template x-if="!esAbono\(it\)">\s*<span class="cuenta-cant tabular" x-text="it\.cantidad \+ '×'"><\/span>\s*<\/template>/);
  assert.match(lista, /<template x-if="esAbono\(it\)">\s*<span class="cuenta-cant cuenta-cant--abono" aria-hidden="true">&minus;<\/span>\s*<\/template>/);
  assert.match(lista, /x-text="it\.cantidad \+ ' abonos de ' \+ pesos\(-it\.precio\)"/, 'los abonos del mismo monto dicen «N abonos de $ X»');
  assert.match(lista, /x-text="pesos\(it\.precio \* it\.cantidad\)"/, 'el monto de cada línea es precio × cantidad (negativo para el abono)');
  assert.match(lista, /esAbono\(it\) \? 'cuenta-monto--abono' : 'text-telon'/, 'el monto del abono va en otro tono');
  // El pie: el desglose solo existe con abonos y el total cambia de nombre cuando queda algo por pagar.
  assert.match(html, /<template x-if="hayAbonos">\s*<dl class="cuenta-desglose tabular">/);
  assert.match(html, /<dt>Consumo<\/dt><dd x-text="pesos\(consumo\)">/);
  assert.match(html, /<dt>Abonos recibidos<\/dt><dd x-text="pesos\(-abonado\)">/);
  assert.match(html, /x-text="etiquetaTotal"/);
  // Todo dato del servidor se pinta con x-text (el nombre del abono también).
  assert.doesNotMatch(html, /x-html/);
});

test('el CSS de los abonos: el tono es el token turquesa de base.css y no declara ningún hex nuevo', () => {
  const css = leer('assets/css/carta-menu.css');
  const reglas = [...css.matchAll(/(\.cuenta-(?:cant--abono|monto--abono|desglose)[^{]*)\{([^}]*)\}/g)].map((m) => m[0]);
  assert.ok(reglas.length >= 4, 'no encontré las reglas de .cuenta-cant--abono, .cuenta-monto--abono y .cuenta-desglose');
  for (const regla of reglas) assert.doesNotMatch(regla, /#[0-9A-Fa-f]{3,8}\b/, `un hex en: ${regla}`);
  assert.match(css, /\.cuenta-cant--abono \{[^}]*var\(--color-turquesa\)/);
  assert.match(css, /\.cuenta-monto--abono \{[^}]*var\(--color-turquesa\)/);
  assert.match(leer('assets/css/base.css'), /--color-turquesa:\s*#2A738A/, 'el token turquesa sigue siendo el de base.css (texto sobre papel 5,27)');
});

// ───────────────────────── 2. el script en un vm ─────────────────────────

const lineas = (h) => plano(h.c.cuenta.items).map((i) => `${i.nombre}|${i.precio}|${i.cantidad}`);

test('vm: un abono no es un producto — no suma a «N productos», el total es lo que queda y el desglose cuadra', async () => {
  const h = await crearCarta({ items: [...PRODUCTOS, abono(40000)] });
  await h.iniciar();
  await h.abrir();
  assert.equal(h.c.cuenta.estado, 'ok');
  assert.equal(h.c.cuenta.total, CONSUMO - 40000, 'el total sale del servidor: precio × cantidad de TODAS las líneas');
  assert.equal(h.c.hayAbonos, true);
  assert.equal(h.c.consumo, CONSUMO);
  assert.equal(h.c.abonado, 40000);
  assert.equal(h.c.consumo - h.c.abonado, h.c.cuenta.total, 'consumo − abonos = lo que queda');
  assert.equal(h.c.unidades, 6, '2 + 1 + 3 productos; el abono no es una unidad');
  assert.equal(h.c.etiquetaTotal, 'Queda por pagar');
});

test('vm: sin abonos todo sigue igual — «Total», sin desglose y las unidades de siempre', async () => {
  const h = await crearCarta({ items: PRODUCTOS });
  await h.iniciar();
  await h.abrir();
  assert.equal(h.c.hayAbonos, false);
  assert.equal(h.c.consumo, CONSUMO);
  assert.equal(h.c.abonado, 0);
  assert.equal(h.c.etiquetaTotal, 'Total');
  assert.equal(h.c.unidades, 6);
  assert.equal(h.c.cuenta.total, CONSUMO);
});

test('vm: el agrupado — abonos de montos DISTINTOS son líneas distintas (nunca se funden en una), del mismo monto se agrupan, y van al final', async () => {
  // El primero llegó ANTES que los productos: aun así se muestra al final.
  const h = await crearCarta({ items: [abono(20000), ...PRODUCTOS, abono(10000, 2)] });
  await h.iniciar();
  await h.abrir();
  assert.deepEqual(lineas(h), [
    'Menú Resplandor|23000|2', 'Hamburguesa Resplandor|32000|1', 'Jugo natural en agua|7000|3',
    'Abono recibido|-20000|1', 'Abono recibido|-10000|2',
  ]);
  assert.equal(h.c.abonado, 20000 + 2 * 10000);
  assert.equal(h.c.cuenta.total, CONSUMO - 40000);
});

test('vm: la carta agrupa por su cuenta lo que le llega sin agrupar (la `cuenta` de antes): el mismo monto suma, el distinto no, y la suma de abonos no cambia el total', async () => {
  const h = await crearCarta({ items: [] });
  const items = h.c._agrupar([abono(10000), MENU, abono(5000), abono(10000), { ...MENU, cantidad: 1 }]);
  assert.deepEqual(plano(items).map((i) => `${i.nombre}|${i.precio}|${i.cantidad}`), [
    'Menú Resplandor|23000|3', 'Abono recibido|-10000|2', 'Abono recibido|-5000|1',
  ]);
  // Un nombre distinto con el mismo monto tampoco se funde (la llave es nombre + precio).
  const dos = h.c._agrupar([abono(10000), { nombre: 'Abono QR', precio: -10000, cantidad: 1 }]);
  assert.equal(dos.length, 2);
});

test('vm: el signo menos — pesos() dibuja −$ 6.000 (U+2212) y deja igual lo positivo', async () => {
  const h = await crearCarta({ items: [] });
  assert.equal(h.c.pesos(6000), '$ 6.000');
  assert.equal(h.c.pesos(-6000), '−$ 6.000');
  assert.equal(h.c.pesos(0), '$ 0');
  assert.equal(h.c.pesos(undefined), '$ 0');
  assert.equal(h.c.pesos('basura'), '$ 0');
  assert.equal(h.c.pesos(1234567), '$ 1.234.567');
  assert.equal(h.c.pesos(-1234567), '−$ 1.234.567');
});

test('vm: un abono que llega en vivo se anuncia como abono («Se registró un abono de $ 30.000»), no como «Se agregó 1 × Abono recibido», y el total baja', async () => {
  const h = await crearCarta({ items: PRODUCTOS });
  await h.iniciar();
  await h.abrir(); // conecta el canal: las señales siguientes llegan por ahí
  assert.equal(h.c.cuenta.total, CONSUMO);
  h.cambio((m) => m.agregar('Abono recibido', -30000, 1));
  await h.avanzar(1500);
  assert.equal(h.c.cuenta.total, CONSUMO - 30000);
  assert.equal(h.c.anuncio, 'Se registró un abono de $ 30.000');
  assert.doesNotMatch(h.c.anuncio, /Se agregó/);
  // Un segundo abono del mismo monto: el grupo pasa de 1 a 2 y lo nuevo es UNO.
  h.cambio((m) => m.agregar('Abono recibido', -30000, 1));
  await h.avanzar(1500);
  assert.equal(h.c.anuncio, 'Se registró un abono de $ 30.000', 'el 2.º abono suma +1 al grupo: es un abono nuevo, no «dos»');
  assert.equal(lineas(h).filter((l) => l.startsWith('Abono')).join(), 'Abono recibido|-30000|2');
  assert.equal(h.c.cuenta.total, CONSUMO - 60000);
});

test('vm: «Se quitó» un abono se anuncia como abono, y un producto sigue anunciándose como producto', async () => {
  const h = await crearCarta({ items: [...PRODUCTOS, abono(15000)] });
  await h.iniciar();
  await h.abrir();
  h.cambio((m) => { m.orden.items = m.orden.items.filter((i) => i.precio > 0); m.orden.version++; });
  await h.avanzar(1500);
  assert.equal(h.c.anuncio, 'Se quitó un abono de $ 15.000');
  h.cambio((m) => m.agregar('Limonada', 8000, 2));
  await h.avanzar(1500);
  assert.equal(h.c.anuncio, 'Se agregó 2 × Limonada');
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

/** carta.html con la red simulada (la `cuenta` sin canal: se queda en sondeo, no hace falta Realtime). */
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
  test(`${donde}: un abono se ve como abono (sin «1×», con −$ y otro tono), el total es lo que queda y el pie dice consumo y abonos; sin desborde ni errores`, { skip: saltar() }, async (t) => {
    const c = await abrir({ ancho, alto, items: [...PRODUCTOS, abono(40000)] });
    try {
      if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
      const { page } = c;
      if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      const fila = page.locator('.cuenta-cuerpo li[data-abono="true"]');
      assert.equal(await fila.count(), 1);
      const textoFila = (await fila.innerText()).replace(/\s+/g, ' ').trim();
      assert.match(textoFila, /Abono recibido/);
      assert.match(textoFila, /−\$ 40\.000/);
      assert.doesNotMatch(textoFila, /1\s*×/, 'el abono no lleva la cantidad «1×»');
      assert.equal(await page.locator('.cuenta-cuerpo li:not([data-abono]) .cuenta-cant').count(), 3, 'los tres productos conservan su «N×»');
      const colores = await page.evaluate(() => {
        const a = getComputedStyle(document.querySelector('.cuenta-cuerpo li[data-abono="true"] .cuenta-monto--abono')).color;
        const p = getComputedStyle(document.querySelector('.cuenta-cuerpo li:not([data-abono]) .font-semibold.tabular')).color;
        return { a, p };
      });
      assert.notEqual(colores.a, colores.p, 'el monto del abono va en otro tono que el de un producto');
      assert.equal(await texto(page, '.cuenta-total'), '$ 59.000', 'el Total es lo que queda (99.000 − 40.000)');
      const pie = await texto(page, 'footer');
      assert.match(pie, /Consumo \$ 99\.000/);
      assert.match(pie, /Abonos recibidos −\$ 40\.000/);
      assert.match(pie, /queda por pagar/i);
      assert.match(await texto(page, '.cuenta-cuerpo'), /^6 productos/i, 'el abono no cuenta como producto');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde horizontal');
      assert.deepEqual(c.consola, []);
    } finally {
      await c.contexto.close();
    }
  });

  test(`${donde}: abonos de montos distintos son dos líneas, los del mismo monto una sola «N abonos de $ X», y sin abonos no hay desglose ni cambia el «Total»`, { skip: saltar() }, async (t) => {
    const varios = await abrir({ ancho, alto, items: [abono(20000), ...PRODUCTOS, abono(10000, 2)] });
    try {
      if (!varios.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
      const { page } = varios;
      if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      const filas = (await page.locator('.cuenta-cuerpo li').allInnerTexts()).map((f) => f.replace(/\s+/g, ' ').trim());
      assert.equal(filas.length, 5, '3 productos + 2 líneas de abono');
      assert.match(filas[3], /^− Abono recibido −\$ 20\.000$/);
      assert.match(filas[4], /^− Abono recibido 2 abonos de \$ 10\.000 −\$ 20\.000$/);
      assert.equal(await texto(page, '.cuenta-total'), '$ 59.000');
      assert.match(await texto(page, 'footer'), /Abonos recibidos −\$ 40\.000/);
    } finally {
      await varios.contexto.close();
    }
    const sin = await abrir({ ancho, alto, items: PRODUCTOS });
    try {
      const { page } = sin;
      if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.cuenta-desglose').count(), 0, 'sin abonos no hay desglose');
      assert.equal(await page.locator('li[data-abono]').count(), 0);
      assert.equal(await texto(page, '.cuenta-total'), '$ 99.000');
      assert.match(await texto(page, 'footer'), /^total/i);
      assert.doesNotMatch(await texto(page, 'footer'), /queda por pagar/i);
    } finally {
      await sin.contexto.close();
    }
  });
}
