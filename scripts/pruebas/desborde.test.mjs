// Sin desborde horizontal a 320 px (hallazgo desborde-320, 2026-09-29).
//
// El síntoma: a 320×640 la landing tenía 5 px de scroll lateral (scrollWidth 325 sobre
// clientWidth 320). El culpable NO era la carta (donde se anotó primero): carta.html, menu.html
// y las páginas de texto miden 0. Era el rótulo «RESPLANDOR» (.rotulo), una sola palabra que
// no se parte y que mide 7,43 × el tamaño de fuente (Cinzel 700 en mayúsculas, R decorativa,
// letter-spacing .02em; medido en Chromium: 308,6 px a 41,6 px). El suelo del clamp, 2.6rem
// (41,6 px → 309 px), no cabía en los 288 px que quedan a 320 px (320 − 2 × 1rem del px-4):
//   - en el pie, el texto se salía de su <p> y empujaba 5 px de scroll (16 + 309 = 325);
//   - en el hero pasaba lo mismo, pero ahí un ancestro recorta: la última R quedaba cortada
//     4,6 px por el borde de la pantalla, sin scroll que lo delatara.
// La causa es una sola (el suelo del tamaño), así que la prueba mira la causa y, aparte, el
// síntoma.
//
// Dos partes:
//   1. ESTÁTICA (corre siempre, también en CI, que no tiene navegador): saca de los HTML y de
//      componentes.css el tamaño de fuente que tiene cada .rotulo a 320 px y comprueba que su
//      palabra cabe en 288 px. Además fija que el arreglo no movió ningún tamaño del contrato
//      de docs/identidad-visual.md (§4: 42 px a 375, 72 px en el hero y 128 px en el pie a
//      1440). Falla con el suelo de 2.6rem sin tope.
//   2. EN NAVEGADOR (solo si hay Playwright y un Chromium instalados; si no, se salta con el
//      motivo): mide scrollWidth − clientWidth a 320×640 en las páginas públicas y que ningún
//      rótulo se salga de la pantalla. Ni CI ni el repo traen Playwright (el sitio no tiene
//      dependencias de runtime), por eso no es requisito: se busca en node_modules, en
//      $PLAYWRIGHT_DIR y en la caché de npx. Necesita Node ≥ 20, la red para bajar Cinzel de
//      Google Fonts (sin la fuente la medición no vale y se salta) y nunca toca Supabase:
//      cualquier pedido a *.supabase.co se contesta con una lista vacía.
//
// Si cambias a propósito el tamaño de un rótulo, vuelve a medir a 320, 344 y 375 px.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

const ANCHO = 320;
const ALTO = 640;
// Ancho de «RESPLANDOR» por cada px de font-size (308,6 / 41,6 = 7,42; docs §4 anota 7,38).
const ANCHO_POR_EM = 7.43;
// El contenedor del hero y del pie es px-4: 1rem a cada lado.
const HOLGURA_LATERAL = 32;

// Todas las páginas públicas con su HTML en la raíz (landing.html solo redirige a «/»).
const PAGINAS_PUBLICAS = ['index.html', 'carta.html', 'menu.html', 'about.html', 'contact.html', 'privacy.html', '404.html'];
const PAGINAS_CON_ROTULO = ['index.html', 'carta.html', 'menu.html'];

// ───────────────────────── 1. estática: el tamaño del rótulo a 320 px ─────────────────────────

/** Contenido balanceado del paréntesis que abre en `texto[abre]`. */
function balanceado(texto, abre) {
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '(') nivel++;
    else if (texto[i] === ')' && --nivel === 0) return texto.slice(abre + 1, i);
  }
  throw new Error(`paréntesis sin cerrar en «${texto.slice(abre, abre + 60)}»`);
}

/** Reemplaza cada var(--rotulo, respaldo) por `valor` (o por el respaldo si no hay valor). */
function resolverRotulo(expr, valor) {
  let salida = expr;
  for (let i = salida.indexOf('var(--rotulo'); i !== -1; i = salida.indexOf('var(--rotulo')) {
    const dentro = balanceado(salida, i + 3);
    const respaldo = dentro.slice(dentro.indexOf(',') + 1).trim();
    salida = salida.slice(0, i) + `(${valor ?? respaldo})` + salida.slice(i + 3 + dentro.length + 2);
  }
  return salida;
}

/** Valor en px de una expresión CSS de longitud (rem/px/vw, calc/min/max/clamp) a un ancho de pantalla. */
function aPx(expr, vw) {
  assert.doesNotMatch(expr, /var\(/, `quedó un var() sin resolver en «${expr}»`);
  const js = expr
    .replace(/(\d*\.?\d+)rem\b/g, '($1*16)')
    .replace(/(\d*\.?\d+)vw\b/g, `($1*${vw}/100)`)
    .replace(/(\d*\.?\d+)px\b/g, '($1)')
    .replace(/\bclamp\(/g, 'CLAMP(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(')
    .replace(/\bcalc\(/g, '(');
  assert.match(js, /^[\d.+\-*/(),\s]*(?:(?:CLAMP|Math\.min|Math\.max)[\d.+\-*/(),\s]*)*$/, `expresión CSS que no sé evaluar: «${expr}»`);
  // eslint-disable-next-line no-new-func
  return new Function('CLAMP', `return (${js});`)((min, val, max) => Math.max(min, Math.min(val, max)));
}

/** font-size de la regla `.rotulo` de componentes.css (la expresión, con su var(--rotulo, …)). */
function tamanoBaseDelRotulo() {
  const css = sinComentarios(leer('assets/css/componentes.css'));
  const regla = css.match(/(?:^|\})\s*\.rotulo\s*\{([^}]*)\}/);
  assert.ok(regla, 'no encontré la regla .rotulo en componentes.css');
  const i = regla[1].indexOf('font-size:');
  assert.ok(i !== -1, 'la regla .rotulo perdió su font-size');
  const desde = regla[1].slice(i + 'font-size:'.length);
  // Hasta el «;» que cierra la declaración, sin cortar los del interior de un paréntesis.
  let nivel = 0;
  for (let k = 0; k < desde.length; k++) {
    if (desde[k] === '(') nivel++;
    else if (desde[k] === ')') nivel--;
    else if (desde[k] === ';' && nivel === 0) return desde.slice(0, k).trim();
  }
  return desde.trim();
}

/** Cada uso de class="… rotulo …" (no rotulo-sub) del marcado, con su --rotulo en línea si lo trae. */
function usosDelRotulo(pagina) {
  const usos = [];
  for (const m of sinComentarios(leer(pagina)).matchAll(/<(\w+)\b[^>]*>/g)) {
    const clase = m[0].match(/\sclass="([^"]*)"/);
    if (!clase || !clase[1].split(/\s+/).includes('rotulo')) continue;
    const estilo = m[0].match(/\sstyle="([^"]*)"/);
    const variable = estilo && estilo[1].match(/--rotulo:\s*([^;]+)/);
    usos.push({ pagina, etiqueta: m[1], variable: variable ? variable[1].trim() : null });
  }
  return usos;
}

const usos = PAGINAS_CON_ROTULO.flatMap(usosDelRotulo);

test('el marcado usa .rotulo donde el contrato lo pone (hero, nav, cabecera de carta y menú, pie)', () => {
  // Si esto cambia, la prueba de abajo mediría un conjunto distinto al que se ve en pantalla.
  const porPagina = (p) => usos.filter((u) => u.pagina === p).length;
  assert.equal(porPagina('index.html'), 3, 'index.html: H1 del hero + nav + pie');
  assert.equal(porPagina('carta.html'), 1, 'carta.html: cabecera');
  assert.equal(porPagina('menu.html'), 1, 'menu.html: cabecera');
});

test(`el rótulo «RESPLANDOR» cabe a ${ANCHO} px en cada uso: su palabra (${ANCHO_POR_EM} × el tamaño de fuente, no se parte) no supera los ${ANCHO - HOLGURA_LATERAL} px del contenedor (px-4) y no empuja scroll lateral`, () => {
  const base = tamanoBaseDelRotulo();
  const fallas = [];
  for (const uso of usos) {
    const px = aPx(resolverRotulo(base, uso.variable), ANCHO);
    const palabra = px * ANCHO_POR_EM;
    if (palabra > ANCHO - HOLGURA_LATERAL) {
      fallas.push(`${uso.pagina} <${uso.etiqueta}${uso.variable ? ` --rotulo:${uso.variable}` : ''}>: ${px.toFixed(1)} px de fuente → ${palabra.toFixed(0)} px de palabra, caben ${ANCHO - HOLGURA_LATERAL}`);
    }
  }
  assert.deepEqual(fallas, [], `el rótulo se sale de la pantalla a ${ANCHO} px (¿el suelo del clamp de .rotulo, o un --rotulo en línea, sin tope por ancho?)`);
});

test('el tope por ancho del rótulo no mueve los tamaños del contrato (docs/identidad-visual.md §4): 42 px a 375 y 72 px (hero) / 128 px (pie) a 1440', () => {
  const base = tamanoBaseDelRotulo();
  const hero = usos.find((u) => u.pagina === 'index.html' && u.variable === null);
  const pie = usos.find((u) => u.pagina === 'index.html' && u.variable && u.variable.startsWith('clamp('));
  assert.ok(hero && pie, 'no encontré el rótulo del hero (sin --rotulo) y el del pie (--rotulo: clamp(…)) en index.html');
  const px = (uso, vw) => Math.round(aPx(resolverRotulo(base, uso.variable), vw));
  assert.equal(px(hero, 375), 42, 'hero a 375 px');
  assert.equal(px(hero, 1440), 72, 'hero a 1440 px');
  assert.equal(px(pie, 375), 42, 'pie a 375 px');
  assert.equal(px(pie, 1440), 128, 'pie a 1440 px');
});

// ───────────────────────── 2. en navegador: el desborde de verdad ─────────────────────────

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

for (const pagina of PAGINAS_PUBLICAS) {
  test(`${pagina}: sin scroll lateral a ${ANCHO}×${ALTO} y ningún rótulo fuera de la pantalla (medido en Chromium)`, { skip: navegador ? false : `navegador no disponible: ${motivoNavegador}` }, async (t) => {
    const contexto = await navegador.newContext({ viewport: { width: ANCHO, height: ALTO } });
    try {
      const page = await contexto.newPage();
      // Nunca se toca Supabase: lo que pida la página a *.supabase.co se contesta vacío.
      await page.route(/\.supabase\.co\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
      await page.goto(`http://127.0.0.1:${servidor.address().port}/${pagina}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700); // Alpine y las animaciones de entrada
      const usaCinzel = await page.evaluate(() => [...document.querySelectorAll('.rotulo')].length > 0);
      const cinzel = await page.evaluate(() => [...document.fonts].some((f) => /Cinzel/.test(f.family) && f.status === 'loaded'));
      if (usaCinzel && !cinzel) return t.skip('Cinzel no cargó (¿sin red hacia Google Fonts?): con la fuente de respaldo la medición del rótulo no vale');

      const r = await page.evaluate(() => {
        const d = document.documentElement;
        const fuera = [];
        for (const el of document.querySelectorAll('.rotulo')) {
          const rango = document.createRange();
          rango.selectNodeContents(el);
          const b = rango.getBoundingClientRect();
          if (b.width && (b.right > window.innerWidth + 0.5 || b.left < -0.5)) fuera.push(`${el.parentElement.tagName.toLowerCase()} > .rotulo: ${b.left.toFixed(1)}…${b.right.toFixed(1)} de ${window.innerWidth}`);
        }
        return { desborde: d.scrollWidth - d.clientWidth, fuera };
      });
      assert.equal(r.desborde, 0, `scrollWidth − clientWidth = ${r.desborde} px a ${ANCHO} px`);
      assert.deepEqual(r.fuera, [], 'rótulos cuyo texto se sale de la pantalla');
    } finally {
      await contexto.close();
    }
  });
}
