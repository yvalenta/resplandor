// La cuenta de una mesa en escritorio (≥ 1024 px): UN solo criterio de altura (pedido de Yonatan, 2026-10-03, con una captura a 1422 px:
// «hay un comportamiento extraño con los scroll en versión escritorio; se identifica un espacio innecesario blanco al final que se puede aprovechar»).
//
// Lo que se veía: tres barras a la vez (la de la página, la de la carta y la del pedido), un hueco blanco bajo el último producto de la carta y
// aire de más entre las tarjetas y el pie. Y, midiendo, algo peor: la página CRECÍA al bajar. Cada panel tenía su propia cuenta de alto —la carta
// «ventana − nav − 16rem», la columna del pedido «ventana − lo que hay encima, medido desde el borde de la ventana»— y ninguna sabía de la otra: la
// columna (pegajosa) se alargaba con cada scroll, arrastraba a la rejilla y la página medía más cuando ya se había bajado que cuando se empezó
// (1126 → 1275 px a 1422×1010); la carta, estirada por la columna, quedaba más alta que su buscador y su lista (el hueco blanco).
//
// La regla ahora: la rejilla de la cuenta mide lo que le queda a la ventana (ventana − todo lo que no es la rejilla: aviso de versión, nav, cabecera,
// avisos de arriba, el aire de abajo y el pie), los dos paneles miden lo que la rejilla, cada uno scrollea por dentro y la página no scrollea ni crece.
//
// Dos partes:
//   A. ESTÁTICA (corre siempre, también en CI): la hoja y el store de pos.html.
//   B. EN NAVEGADOR (solo con Playwright y Chromium; si no, se salta con el motivo): el arnés de _pos-simulado.mjs con la vista `orden-larga` (carta de 32
//      productos, cuenta de 9 renglones) a 1024×768, 1280×800, 1422×1010 (la captura de Yonatan), 1440×900 y 1920×1080, con el aviso de versión
//      escondido y visible, y los casos que lo estiran (otra tablet en la mesa, «Cobrar por partes», un alto que no da para más).
//
// Para ver qué hacía el POS de antes: RAIZ_POS=<carpeta con el pos.html viejo y assets/> node --test scripts/pruebas/pos-orden-escritorio.test.mjs
// (la parte B falla entera con el de b64b53f; la A también).
'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { VISTAS, datosFicticios, esperarEstable, esperarListo, nuevoContexto, prepararPagina, servirPos } from './_pos-simulado.mjs';

const RAIZ = process.env.RAIZ_POS ? path.resolve(process.env.RAIZ_POS) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const VERSION_PAGINA = POS.match(/<meta name="resplandor-version" content="([^"]+)"/)[1];
const VERSION_NUEVA = '2099.01.01-abcdef0';
const DIR_CACHE = path.join(os.tmpdir(), 'resplandor-pos-cdn');

// Los cinco tamaños del pedido (1422×1010 es la ventana de la captura de Yonatan).
const TAMANOS = [[1024, 768], [1280, 800], [1422, 1010], [1440, 900], [1920, 1080]];

// ═════════════════════════ A. estática: la hoja y el store ═════════════════════════

const CSS = POS.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
/** Cuerpos de las reglas de `selector` (texto exacto del selector) dentro de los @media de ≥ 1024 px. */
function reglasDesde1024(selector) {
  const cuerpos = [];
  for (const m of CSS.matchAll(/@media screen and \(min-width: 1024px\)\s*\{/g)) {
    let nivel = 1; let i = m.index + m[0].length; const ini = i;
    while (i < CSS.length && nivel > 0) { if (CSS[i] === '{') nivel++; else if (CSS[i] === '}') nivel--; i++; }
    const bloque = CSS.slice(ini, i - 1);
    for (const r of bloque.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (r[1].trim() === selector) cuerpos.push(r[2]);
  }
  return cuerpos;
}
const vigilar = (() => {
  const i = POS.indexOf('vigilarAltoPedido(rejilla) {');
  assert.ok(i !== -1, 'no encontré vigilarAltoPedido');
  return POS.slice(i, POS.indexOf('\n            },\n', i));
})();

test('la rejilla de la cuenta toma su alto de la ventana menos lo ocupado (--orden-ocupado), con piso, y lo hace desde 1024 (no sticky, sin max-height por panel)', () => {
  const rejilla = reglasDesde1024('.vista-orden > .orden-rejilla').join('\n');
  assert.match(rejilla, /height:\s*max\(13rem, calc\(100dvh - var\(--orden-ocupado, calc\(var\(--pos-nav-alto\) \+ 17\.5rem\)\)\)\)/, 'la rejilla mide ventana − lo ocupado, con piso de 13rem y una cuenta gruesa sin medida');
  assert.match(rejilla, /height:\s*max\(13rem, calc\(100vh - var\(--orden-ocupado/, 'con la variante vh detrás de la dvh');
  assert.match(rejilla, /grid-template-rows:\s*minmax\(0, auto\) minmax\(0, 1fr\)/, 'la fila del abono cede y la de la carta puede encogerse a 0');
  // Ningún panel tiene ya su propia cuenta de alto: ni max-height en la carta, ni sticky en la columna, ni max-height en la columna.
  for (const sel of ['.menu-scroll', '.col-pedido', '.pedido-card', '.carta-panel']) {
    for (const cuerpo of reglasDesde1024(sel)) assert.doesNotMatch(cuerpo, /max-height|position:\s*sticky/, `${sel}: sin alto propio ni sticky`);
  }
  assert.match(reglasDesde1024('.menu-scroll').join(';'), /flex:\s*1 1 0%[^]*min-height:\s*0[^]*overflow-y:\s*auto/, 'la lista de la carta se queda con lo que sobra y scrollea por dentro');
  assert.match(reglasDesde1024('.col-pedido').join(';'), /align-self:\s*stretch/, 'la columna del pedido mide lo que la rejilla (antes, `start` + sticky)');
  assert.match(reglasDesde1024('.pedido-card').join(';'), /min-height:\s*0[^]*overflow-y:\s*auto[^]*overscroll-behavior:\s*contain/, 'la lista del pedido scrollea por dentro y no arrastra a la página');
  assert.match(reglasDesde1024('.vista-orden').join(';'), /padding-bottom:\s*1rem/, 'el aire de abajo es de 1rem, no de 2rem + el del pie');
  assert.match(reglasDesde1024('.carta-panel.carta-en-parcial').join(';'), /display:\s*none/, 'en «Cobrar por partes» la carta no se muestra tampoco desde 1024');
  assert.match(POS, /<div class="grid grid-cols-1 gap-4[^"]*\borden-rejilla"/, 'la rejilla lleva su clase (al final: integracion-personas-impresion.test.mjs la ubica por el arranque de su class)');
  assert.match(POS, /<div class="card a-sangre p-0 [^"]*\bcarta-panel"/, 'el panel de la carta lleva su clase');
});

test('vigilarAltoPedido mide lo ocupado en coordenadas de la PÁGINA (no cambia al hacer scroll) y ya no escucha el scroll', () => {
  assert.match(vigilar, /--orden-ocupado/);
  assert.doesNotMatch(vigilar, /--pedido-ocupado/, 'la medida vieja («desde el borde de la ventana») se fue');
  assert.doesNotMatch(vigilar, /addEventListener\('scroll'/, 'nada de lo que se mide cambia con el scroll: no hay por qué volver a medir con cada uno');
  assert.match(vigilar, /window\.scrollY/, 'el final del pie se pasa a coordenadas de la página');
  assert.match(vigilar, /new ResizeObserver\(pedir\)\.observe\(rejilla\.parentElement\)/, 'sigue vigilando lo que hay encima');
  assert.match(vigilar, /new ResizeObserver\(pedir\)\.observe\(avisoVersion\)/, 'y el aviso de versión (su lógica no se tocó)');
  assert.doesNotMatch(CSS, /--pedido-ocupado/, 'la hoja ya no lee la medida vieja');
});

// ═════════════════════════ B. en navegador ═════════════════════════

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivo = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidor = await servirPos(RAIZ, 0);
  } catch (e) {
    motivo = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await servidor.cerrar();
});
const saltar = { skip: navegador ? false : `navegador no disponible: ${motivo}` };

const presencia = (d) => { d.presencia = [{ mesaId: 3, deviceId: 'otro-dispositivo', nombre: 'Mesera Demo', ts: 1790000000000 }]; };

/** Abre una vista de la cuenta como abrirPos, pero con `version.json` controlado: `aviso` = el aviso de versión sale desde el principio. */
async function abrir({ ancho, alto, vista = 'orden-larga', aviso = false, ajustar }) {
  const estado = { version: aviso ? VERSION_NUEVA : VERSION_PAGINA };
  const contexto = await nuevoContexto(navegador, { ancho, alto });
  const page = await contexto.newPage();
  const def = VISTAS[vista];
  const diag = await prepararPagina(page, { url: servidor.url, datos: datosFicticios((d) => { def.ajustar?.(d); ajustar?.(d); }), sesion: true, dirCache: DIR_CACHE, bloquearFuentes: true });
  await page.route(/\/version\.json(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: estado.version, fecha: '2099-01-01', huella: 'x' }) }));
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page);
  await def.llegar(page);
  if (aviso) await page.locator('.aviso-version').waitFor();
  await esperarEstable(page);
  await reposo(page);
  return { page, contexto, diag, estado };
}
/** La medida se hace en un cuadro de animación tras el cambio: se deja pasar un rato antes de mirar. */
const reposo = (page, ms = 350) => page.waitForTimeout(ms);

/**
 * Todo lo que cuenta de la altura, de una vez. Los elementos se buscan por estructura (la rejilla es el `.grid` de la vista; el panel de la carta,
 * el padre de su lista) y no por las clases nuevas, para que la misma medida corra contra el pos.html de antes y falle por lo que MIDE, no por
 * no encontrar una clase.
 */
const medir = (page) => page.evaluate(() => {
  const caja = (e) => { if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, alto: b.height, scroll: e.scrollHeight, cliente: e.clientHeight }; };
  const q = (s) => document.querySelector(s);
  const seccion = getComputedStyle(q('.vista-orden'));
  const items = [...document.querySelectorAll('.menu-scroll .menu-item')];
  const ultimo = items.length ? items[items.length - 1].getBoundingClientRect() : null;
  return {
    ventana: innerHeight, documento: document.documentElement.scrollHeight, scrollY: scrollY,
    rejilla: caja(q('.vista-orden > .grid')), carta: caja(q('.menu-scroll').parentElement), lista: caja(q('.menu-scroll')), columna: caja(q('.col-pedido')), pedido: caja(q('.pedido-card')),
    total: caja(q('.barra-accion')), pie: caja(q('footer.pos-pie')), aviso: caja(q('.aviso-version')),
    aireAbajo: parseFloat(seccion.paddingBottom), ultimoProducto: ultimo ? { top: ultimo.top, bottom: ultimo.bottom } : null,
  };
});
const cerca = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

for (const [ancho, alto] of TAMANOS) {
  for (const aviso of [false, true]) {
    test(`${ancho}×${alto}, aviso de versión ${aviso ? 'visible' : 'escondido'}: los dos paneles miden lo que le queda a la ventana, la página no scrollea y el pie queda al final`, saltar, async () => {
      const { page, contexto, diag } = await abrir({ ancho, alto, aviso });
      try {
        const m = await medir(page);
        // El criterio único: ventana − (lo de arriba de la rejilla) − (el aire y el pie de abajo).
        const disponible = m.ventana - m.rejilla.top - m.aireAbajo - m.pie.alto;
        assert.ok(cerca(m.rejilla.alto, disponible), `la rejilla mide ${m.rejilla.alto.toFixed(1)} y le quedan ${disponible.toFixed(1)}`);
        assert.ok(cerca(m.carta.alto, disponible), `la carta mide ${m.carta.alto.toFixed(1)} de ${disponible.toFixed(1)} disponibles`);
        assert.ok(cerca(m.columna.alto, disponible), `la columna del pedido mide ${m.columna.alto.toFixed(1)} de ${disponible.toFixed(1)} disponibles`);
        assert.ok(cerca(m.carta.bottom, m.columna.bottom) && cerca(m.carta.top, m.columna.top), 'y los dos paneles empiezan y acaban en la misma línea');
        // La página no scrollea: mide lo que la ventana, y el pie es lo último, pegado al borde de abajo (sin aire de más).
        assert.equal(m.documento, m.ventana, `la página mide ${m.documento} y la ventana ${m.ventana}`);
        assert.ok(cerca(m.pie.bottom, m.ventana), `el pie termina en ${m.pie.bottom.toFixed(1)} de ${m.ventana}`);
        assert.ok(m.pie.top - m.rejilla.bottom <= 17, `entre los paneles y el pie hay ${(m.pie.top - m.rejilla.bottom).toFixed(1)} px (1rem de aire)`);
        // Dos paneles y nada más con scroll propio; el total con su botón, entero a la vista, sin desplazar.
        assert.ok(m.lista.scroll > m.lista.cliente + 100, 'la lista de la carta hace scroll por dentro');
        assert.ok(m.pedido.scroll > m.pedido.cliente + 50, 'la lista del pedido hace scroll por dentro');
        assert.ok(m.total.top >= m.pedido.bottom && m.total.bottom <= m.ventana, `el total queda en ${m.total.top.toFixed(0)}–${m.total.bottom.toFixed(0)} de ${m.ventana}`);
        const boton = page.getByRole('button', { name: 'Generar ticket y cobrar', exact: true });
        const b = await boton.evaluate((e) => { const r = e.getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.y + r.height / 2; return { top: r.top, bottom: r.bottom, encima: e.contains(document.elementFromPoint(x, y)) }; });
        assert.ok(b.top >= 0 && b.bottom <= m.ventana && b.encima, `«Generar ticket y cobrar» está entero a la vista y sin nada encima (${b.top.toFixed(0)}–${b.bottom.toFixed(0)})`);
        assert.equal(aviso, !!m.aviso, 'el aviso de versión está donde la prueba lo pidió');
        assert.deepEqual(diag.errores, []);
      } finally { await contexto.close(); }
    });

    test(`${ancho}×${alto}, aviso ${aviso ? 'visible' : 'escondido'}: desplazar la página o un panel no cambia nada (la página no crece), y la carta termina en su último producto, sin hueco`, saltar, async () => {
      const { page, contexto } = await abrir({ ancho, alto, aviso });
      try {
        const antes = await medir(page);
        // 1) El documento: pide el final varias veces (antes la página crecía al bajar y un solo scrollTo se quedaba corto).
        for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollTo(0, 100000)); await reposo(page, 150); }
        let ahora = await medir(page);
        assert.equal(ahora.scrollY, 0, 'la página no tiene adónde bajar');
        assert.equal(ahora.documento, antes.documento, 'y no creció');
        assert.ok(cerca(ahora.rejilla.alto, antes.rejilla.alto, 0.5) && cerca(ahora.rejilla.top, antes.rejilla.top, 0.5), 'la rejilla no se movió ni cambió de alto');
        // 2) Con la rueda sobre la carta, hasta el fondo (y de más): la lista baja, la página se queda donde está y no crece.
        const lista = page.locator('.menu-scroll');
        const c = await lista.boundingBox();
        await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 4000); await reposo(page, 150); }
        ahora = await medir(page);
        assert.ok(ahora.lista.scroll - ahora.lista.cliente > 0 && await lista.evaluate((e) => Math.ceil(e.scrollTop + e.clientHeight) >= e.scrollHeight - 1), 'la lista de la carta llegó a su final');
        assert.equal(ahora.scrollY, 0, 'la rueda al final de la carta no arrastró a la página');
        assert.equal(ahora.documento, antes.documento, 'y la página no cambió de alto');
        // Sin hueco: el último producto acaba en el fondo del panel (a lo sumo el borde de 1 px y 4 px de redondeo).
        assert.ok(ahora.carta.bottom - ahora.ultimoProducto.bottom <= 4, `bajo «${await page.locator('.menu-scroll .menu-item').last().locator('.menu-item-name').innerText()}» quedan ${(ahora.carta.bottom - ahora.ultimoProducto.bottom).toFixed(1)} px de panel`);
        assert.ok(cerca(ahora.lista.bottom, ahora.carta.bottom, 2.5), 'y la lista llega hasta el fondo del panel: no queda una franja sin lista debajo');
        // 3) Lo mismo con la rueda sobre el pedido.
        const p = await page.locator('.pedido-card').boundingBox();
        await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 4000); await reposo(page, 150); }
        ahora = await medir(page);
        assert.ok(await page.locator('.pedido-card').evaluate((e) => e.scrollTop > 0), 'la lista del pedido bajó');
        assert.equal(ahora.scrollY, 0, 'la rueda al final del pedido no arrastró a la página');
        assert.equal(ahora.documento, antes.documento);
        assert.ok(cerca(ahora.total.top, antes.total.top, 0.5) && cerca(ahora.total.bottom, antes.total.bottom, 0.5), 'el total no se movió');
      } finally { await contexto.close(); }
    });
  }
}

test('el aviso de versión que sale y se va con la cuenta abierta (empuja la página): la rejilla se acorta lo que él mide y la página sigue midiendo lo que la ventana', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800 });
  try {
    const sin = await medir(page);
    assert.equal(sin.aviso, null);
    // Sale: se le cambia al store la versión publicada (lo que haría version.json al responder otra).
    await page.evaluate((v) => { Alpine.store('pos').versionPublicada = v; }, VERSION_NUEVA);
    await page.locator('.aviso-version').waitFor();
    await reposo(page);
    const con = await medir(page);
    assert.ok(con.aviso.alto > 20, `el aviso mide ${con.aviso.alto.toFixed(0)} px`);
    assert.ok(cerca(sin.rejilla.alto - con.rejilla.alto, con.aviso.alto, 1.5), `la rejilla se acortó ${(sin.rejilla.alto - con.rejilla.alto).toFixed(1)} px y el aviso mide ${con.aviso.alto.toFixed(1)}`);
    assert.equal(con.documento, con.ventana, 'con el aviso, la página sigue midiendo lo que la ventana');
    assert.ok(cerca(con.pie.bottom, con.ventana) && con.total.bottom <= con.ventana, 'el pie y el total siguen a la vista');
    // «Después» lo esconde y la rejilla recupera su alto.
    await page.locator('.aviso-version').getByRole('button', { name: 'Después', exact: true }).click();
    await page.locator('.aviso-version').waitFor({ state: 'hidden' });
    await reposo(page);
    const otra = await medir(page);
    assert.ok(cerca(otra.rejilla.alto, sin.rejilla.alto, 1), `la rejilla volvió a ${otra.rejilla.alto.toFixed(1)} (era ${sin.rejilla.alto.toFixed(1)})`);
    assert.equal(otra.documento, otra.ventana);
  } finally { await contexto.close(); }
});

test('activar y desactivar «Cobrar por partes» con la cuenta abierta: la barra de arriba empuja, la rejilla se acorta y vuelve, y la página sigue midiendo lo que la ventana', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800 });
  try {
    const sin = await medir(page);
    await page.getByRole('button', { name: 'Cobrar por partes', exact: true }).click();
    await page.locator('.barra-partes').waitFor();
    await reposo(page);
    const con = await medir(page);
    const barra = await page.locator('.barra-partes').boundingBox();
    assert.equal(con.documento, con.ventana, 'con la barra de cobro por partes arriba, la página sigue midiendo lo que la ventana');
    assert.ok(sin.rejilla.alto - con.rejilla.alto >= barra.height, `la rejilla se acortó ${(sin.rejilla.alto - con.rejilla.alto).toFixed(1)} px y la barra mide ${barra.height.toFixed(1)}`);
    assert.equal(con.carta, null, 'y la carta no sale');
    await page.getByRole('button', { name: 'Cancelar selección', exact: true }).click();
    await page.locator('.barra-partes').waitFor({ state: 'hidden' });
    await reposo(page);
    const otra = await medir(page);
    assert.ok(cerca(otra.rejilla.alto, sin.rejilla.alto, 1), `la rejilla volvió a ${otra.rejilla.alto.toFixed(1)} (era ${sin.rejilla.alto.toFixed(1)})`);
    assert.ok(otra.carta && cerca(otra.carta.alto, otra.rejilla.alto, 1), 'la carta volvió a su sitio, entera');
    assert.equal(otra.documento, otra.ventana);
  } finally { await contexto.close(); }
});

test('cambiar el tamaño de la ventana: bajo 1024 la cuenta vuelve a ser una columna que scrollea la página y al volver a 1024 recupera su medida', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800 });
  try {
    const grande = await medir(page);
    await page.setViewportSize({ width: 900, height: 800 });
    await reposo(page);
    const medio = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, altura: getComputedStyle(document.querySelector('.vista-orden > .grid')).height, contenido: document.querySelector('.vista-orden > .grid').scrollHeight, medida: document.querySelector('.vista-orden > .grid').style.getPropertyValue('--orden-ocupado') }));
    assert.ok(medio.doc > 800 && Math.abs(parseFloat(medio.altura) - medio.contenido) <= 1, 'a 900 px es una columna que mide lo que su contenido y la página scrollea');
    assert.equal(medio.medida, '', 'y ya no se mide');
    await page.setViewportSize({ width: 1440, height: 900 });
    await reposo(page);
    const otra = await medir(page);
    assert.equal(otra.documento, otra.ventana, 'de vuelta a escritorio la página mide lo que la ventana');
    assert.ok(cerca(otra.carta.alto, otra.columna.alto) && otra.rejilla.alto > grande.rejilla.alto, 'y los paneles se repartieron la ventana nueva');
  } finally { await contexto.close(); }
});

test('agregar productos hace crecer la lista del pedido por dentro: ni la página ni el total se mueven', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1440, alto: 900 });
  try {
    const antes = await medir(page);
    for (let i = 0; i < 6; i++) { await page.locator('.menu-scroll .menu-item').nth(i).click(); }
    await reposo(page);
    const ahora = await medir(page);
    assert.ok(ahora.pedido.scroll > antes.pedido.scroll, 'la lista del pedido creció');
    assert.equal(ahora.documento, antes.documento);
    assert.equal(ahora.documento, ahora.ventana, 'y la página sigue midiendo lo que la ventana');
    assert.ok(cerca(ahora.total.top, antes.total.top, 0.5) && cerca(ahora.rejilla.alto, antes.rejilla.alto, 0.5), 'y el total y la rejilla siguen donde estaban');
  } finally { await contexto.close(); }
});

test('una carta corta (una búsqueda con un solo resultado) no rompe la altura: el panel conserva la medida y no queda scroll de más', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1422, alto: 1010 });
  try {
    const antes = await medir(page);
    await page.getByPlaceholder('Buscar producto…').fill('Brownie');
    await reposo(page);
    const m = await medir(page);
    assert.equal(await page.locator('.menu-scroll .menu-item').count(), 1);
    assert.ok(cerca(m.carta.alto, antes.carta.alto, 0.5), 'el panel de la carta sigue midiendo lo mismo que la columna del pedido');
    assert.ok(m.lista.scroll <= m.lista.cliente + 1, 'sin scroll en una lista que cabe');
    assert.equal(m.documento, m.ventana);
    // El fondo sigue siendo el de la tarjeta (papel): lo de abajo no es otro color que acabe «de golpe».
    const fondos = await page.evaluate(() => [getComputedStyle(document.querySelector('.menu-scroll').parentElement).backgroundColor, getComputedStyle(document.querySelector('.menu-scroll')).backgroundColor]);
    assert.equal(fondos[1], 'rgba(0, 0, 0, 0)', 'la lista no pinta otro fondo: se ve el de la tarjeta');
    assert.notEqual(fondos[0], 'rgba(0, 0, 0, 0)');
  } finally { await contexto.close(); }
});

test('con otra tablet en la mesa (aviso encima) a 1024×768: el total y su botón siguen dentro de la ventana y los paneles no pisan el pie', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1024, alto: 768, ajustar: presencia });
  try {
    await page.getByText('también tiene esta mesa abierta').waitFor();
    await reposo(page);
    const m = await medir(page);
    assert.equal(m.documento, m.ventana);
    assert.ok(m.total.bottom <= m.ventana && m.rejilla.bottom <= m.pie.top, 'el total a la vista y la rejilla antes del pie');
    assert.ok(m.rejilla.alto >= 13 * 16 - 1, `la rejilla no baja del piso de 13rem (${m.rejilla.alto.toFixed(0)})`);
    assert.ok(m.pedido.cliente >= 150, `y a la lista del pedido le quedan ${m.pedido.cliente} px`);
  } finally { await contexto.close(); }
});

test('«Cobrar por partes» desde 1024: la carta no sale, el abono toma lo suyo y, si el alto no da, scrollea por dentro sin pisar el pie', saltar, async () => {
  for (const [ancho, alto] of [[1024, 768], [1280, 800], [1920, 1080]]) {
    const { page, contexto } = await abrir({ ancho, alto, vista: 'orden-cobro-monto' });
    try {
      const m = await medir(page);
      assert.equal(m.carta, null, `${ancho}×${alto}: sin carta (antes quedaba una tarjeta de 8 px de alto bajo el abono)`);
      const b = await page.locator('.bloque-monto').evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, scroll: e.scrollHeight, cliente: e.clientHeight }; });
      assert.ok(b.bottom <= m.rejilla.bottom + 0.5, `${ancho}×${alto}: el abono acaba en ${b.bottom.toFixed(0)} y la rejilla en ${m.rejilla.bottom.toFixed(0)}`);
      assert.ok(m.columna.bottom <= m.pie.top + 0.5 && m.total.bottom <= m.rejilla.bottom + 0.5, `${ancho}×${alto}: ni el pedido ni el total pisan el pie`);
      assert.equal(m.documento, m.ventana, `${ancho}×${alto}: la página no scrollea`);
      assert.ok(await page.getByRole('button', { name: /^Recibir/ }).count() > 0);
    } finally { await contexto.close(); }
  }
});

test('con tanto encima que el alto no da (piso de 13rem), la página sí scrollea, pero la rejilla no pisa el pie ni cambia de alto al bajar', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1024, alto: 768, vista: 'orden-avisos' });
  try {
    const antes = await medir(page);
    assert.ok(cerca(antes.rejilla.alto, 13 * 16, 1), `en el piso: ${antes.rejilla.alto.toFixed(1)}`);
    assert.ok(antes.documento > antes.ventana, 'no cabe: la página scrollea');
    assert.ok(antes.rejilla.bottom <= antes.pie.top + 0.5, 'pero la rejilla acaba antes del pie');
    assert.ok(antes.columna.bottom <= antes.rejilla.bottom + 0.5, 'y la columna no se sale de la rejilla');
    await page.evaluate(() => window.scrollTo(0, 100000)); await reposo(page);
    const ahora = await medir(page);
    assert.equal(ahora.documento, antes.documento, 'bajar no hace crecer la página');
    assert.ok(cerca(ahora.rejilla.alto, antes.rejilla.alto, 0.5), 'ni la rejilla');
    assert.ok(ahora.scrollY > 0 && cerca(ahora.pie.bottom, ahora.ventana), 'y al final de la página el pie queda al borde');
  } finally { await contexto.close(); }
});

for (const [ancho, alto] of [[390, 844], [768, 1024]]) {
  test(`${ancho}×${alto}: sin cambios: la cuenta sigue en una columna, sin scroll por panel y la rejilla toma el alto de su contenido`, saltar, async () => {
    const contexto = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
    try {
      const page = await contexto.newPage();
      const def = VISTAS['orden-larga'];
      await prepararPagina(page, { url: servidor.url, datos: datosFicticios((d) => def.ajustar(d)), sesion: true, dirCache: DIR_CACHE, bloquearFuentes: true });
      await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
      await esperarListo(page);
      await def.llegar(page);
      await esperarEstable(page);
      const e = await page.evaluate(() => {
        const est = (s) => getComputedStyle(document.querySelector(s));
        const rej = document.querySelector('.vista-orden > .grid');
        return {
          alturaRejilla: est('.vista-orden > .grid').height, alturaContenido: rej.scrollHeight, ventana: innerHeight,
          overflowLista: est('.menu-scroll').overflowY, maxLista: est('.menu-scroll').maxHeight, overflowPedido: est('.pedido-card').overflowY,
          posicionColumna: est('.col-pedido').position, medida: rej.style.getPropertyValue('--orden-ocupado'), paddingSeccion: est('.vista-orden').paddingBottom,
        };
      });
      assert.ok(Math.abs(parseFloat(e.alturaRejilla) - e.alturaContenido) <= 1, 'la rejilla mide lo que su contenido (sin height fijo)');
      assert.ok(e.alturaContenido > e.ventana, 'y es más alta que la ventana: la página es la que scrollea');
      assert.deepEqual([e.overflowLista, e.maxLista, e.overflowPedido, e.posicionColumna], ['visible', 'none', 'visible', 'static'], 'ni scroll por panel ni columna pegajosa');
      assert.equal(e.medida, '', 'y no se mide nada');
      assert.equal(e.paddingSeccion, ancho < 768 ? '24px' : '32px', 'el aire de abajo de la vista es el de siempre');
    } finally { await contexto.close(); }
  });
}
