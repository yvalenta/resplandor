// Prueba estática de la identidad visual del POS (docs/pos-visual.md, vigente desde 2026-09-30).
//
// El POS (pos.html) adopta la identidad v2 de la landing, pero NO carga resplandor.css: copia
// los 15 tokens en su propio <style> y conserva su Tailwind CDN. Esta prueba vigila que esa
// copia no se desvíe de la única fuente (assets/css/base.css) y que no vuelvan los restos de la
// v1 que el contrato dio de baja. No abre un navegador: lee pos.html como texto y evalúa en un
// `vm` aislado el <script> del tailwind.config (nunca una regex sobre su texto).
//
// Qué verifica:
//   1. Los 15 --color-* del :root de pos.html son EXACTAMENTE los de base.css (nombre y hex).
//   2. Los colores de tailwind.config son esos 15 más transparent, current e inherit; las
//      familias display/sans/r viven en `extend` (se conserva `mono`); borderColor.DEFAULT es
//      `linea`; no hay override de borderRadius.
//   3. theme-color es #0A1112 y los dos <link> de fuentes de index.html están en pos.html.
//   4. No aparecen la fuente de la v1 (Cormorant, Jost), radial-gradient, rgb(from, color-mix( ni
//      un backdrop-filter distinto de none (el POS corre en tablets viejas: sin esas funciones).
//   5. Los derivados --pos-telon-* son hex calculados desde los 15, y los pares nuevos de la spec
//      (§2.1) pasan el contraste que el documento declara.
//   6. Toda var(--x) del archivo que no trae valor de respaldo está declarada (un alias olvidado
//      dejaría un color sin resolver en silencio).
//   7. Los marcadores de parte (§4.3) siguen en su sitio, cada uno en su propia línea.
//
// Lo que NO vigila (se vigila en la integración, cuando las partes terminaron): emojis, `style=`
// con hex, alias sin uso. Un alias sin uso se borra al integrar; si esta prueba lo exigiera,
// una parte que migra su marcado la rompería sola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const POS = leer('pos.html');
const BASE_CSS = leer('assets/css/base.css');
const INDEX = leer('index.html');

// ───────────────────────── tokens de base.css ─────────────────────────

function tokensDeBase(css) {
  const inicio = css.indexOf('@theme static');
  assert.ok(inicio !== -1, 'base.css no tiene «@theme static»');
  let profundidad = 0;
  let cuerpo = null;
  for (let i = css.indexOf('{', inicio); i < css.length; i++) {
    if (css[i] === '{') profundidad++;
    else if (css[i] === '}' && --profundidad === 0) { cuerpo = css.slice(css.indexOf('{', inicio) + 1, i); break; }
  }
  assert.ok(cuerpo, 'base.css: «@theme static {» nunca cierra');
  // Se quitan los comentarios: un hex dentro de uno no es un token.
  const sinComentarios = cuerpo.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = {};
  for (const m of sinComentarios.matchAll(/--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2].toUpperCase();
  return tokens;
}

// ───────────────────────── partes de pos.html ─────────────────────────

const bloqueStyle = (() => {
  const m = POS.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, 'pos.html no tiene <style>');
  return m[1];
})();

const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** El primer bloque :root { … } del <style> (donde viven los 15 tokens). */
function primerRoot(css) {
  const i = css.indexOf(':root');
  assert.ok(i !== -1, 'el <style> de pos.html no tiene :root');
  const abre = css.indexOf('{', i);
  const cierra = css.indexOf('}', abre);
  return css.slice(abre + 1, cierra);
}

function declaraciones(cuerpo) {
  const d = {};
  for (const m of sinComentariosCss(cuerpo).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) d[m[1]] = m[2].trim();
  return d;
}

const TOKENS = tokensDeBase(BASE_CSS);
const ROOT = declaraciones(primerRoot(bloqueStyle));

/** Evalúa el <script> que define tailwind.config, sin red y sin tocar el resto del documento. */
function tailwindConfig() {
  const scripts = [...POS.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const codigo = scripts.find((s) => /tailwind\.config\s*=/.test(s));
  assert.ok(codigo, 'pos.html no define tailwind.config en un <script> en línea');
  const contexto = { tailwind: {} };
  vm.runInNewContext(codigo, contexto, { timeout: 2000 });
  return contexto.tailwind.config;
}

// ───────────────────────── contraste (WCAG 2.x) ─────────────────────────

const aRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const relLum = (hex) => { const [r, g, b] = aRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mezcla = (frente, fondo, alfa) => '#' + aRgb(frente).map((c, i) => Math.round(c * alfa + aRgb(fondo)[i] * (1 - alfa)).toString(16).padStart(2, '0')).join('').toUpperCase();

// ───────────────────────── 1. tokens ─────────────────────────

test('base.css tiene los 15 tokens de color (la fuente que el POS copia)', () => {
  assert.equal(Object.keys(TOKENS).length, 15, `base.css: ${Object.keys(TOKENS).join(', ')}`);
});

test('el :root de pos.html declara los 15 --color-* de base.css, literales y sin uno de más', () => {
  const delPos = Object.fromEntries(Object.entries(ROOT).filter(([k]) => k.startsWith('--color-')).map(([k, v]) => [k.slice('--color-'.length), v.toUpperCase()]));
  assert.deepEqual(delPos, TOKENS, 'los --color-* de pos.html no coinciden con assets/css/base.css');
});

test('pos.html declara las tres fuentes y la sombra de la landing con el mismo valor que base.css', () => {
  const m = (nombre) => {
    const r = BASE_CSS.match(new RegExp(`--${nombre}:\\s*([^;]+);`));
    assert.ok(r, `base.css no declara --${nombre}`);
    return r[1].trim().replace(/\s+/g, ' ');
  };
  for (const nombre of ['font-display', 'font-sans', 'font-r', 'shadow-sombra']) {
    assert.equal((ROOT[`--${nombre}`] || '').replace(/\s+/g, ' '), m(nombre), `--${nombre} de pos.html no coincide con base.css`);
  }
});

// ───────────────────────── 2. tailwind.config ─────────────────────────

test('tailwind.config: los colores son exactamente los 15 tokens más transparent, current e inherit', () => {
  const colores = tailwindConfig().theme.colors;
  const esperado = { transparent: 'transparent', current: 'currentColor', inherit: 'inherit' };
  for (const [k, v] of Object.entries(TOKENS)) esperado[k] = v;
  const normalizado = Object.fromEntries(Object.entries(colores).map(([k, v]) => [k, /^#/.test(v) ? v.toUpperCase() : v]));
  assert.deepEqual(normalizado, esperado);
});

test('tailwind.config: display, sans y r en `extend` (se conserva `mono`), borde por defecto linea y sin override de radios', () => {
  const t = tailwindConfig().theme;
  assert.deepEqual(Object.keys(t.extend.fontFamily).sort(), ['display', 'r', 'sans']);
  assert.equal(t.extend.fontFamily.display[0], 'Cinzel');
  assert.equal(t.extend.fontFamily.sans[0], 'Archivo');
  assert.match(t.extend.fontFamily.r[0], /Cinzel Decorative/);
  assert.equal(t.fontFamily, undefined, 'fontFamily va en `extend`: si no, se pierde `mono`');
  assert.equal(t.extend.borderColor.DEFAULT.toUpperCase(), TOKENS.linea, '`border` a secas pasaría a currentColor');
  assert.equal(t.borderRadius, undefined, 'el override de borderRadius se borró');
  assert.equal(t.extend.borderRadius, undefined, 'el override de borderRadius se borró');
});

// ───────────────────────── 3. <head> ─────────────────────────

test('theme-color es #0A1112 (el telón)', () => {
  const m = POS.match(/<meta name="theme-color" content="([^"]+)"/);
  assert.ok(m, 'pos.html no tiene theme-color');
  assert.equal(m[1].toUpperCase(), '#0A1112');
});

test('los dos <link> de fuentes de index.html están en pos.html, y las dos fuentes de la v1 no', () => {
  const hrefsFuentes = (html) => [...html.matchAll(/<link\s+[^>]*?href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/g)].map((m) => m[1]);
  const deLanding = hrefsFuentes(INDEX);
  assert.equal(deLanding.length, 2, 'index.html debería traer dos <link> de Google Fonts (§4)');
  assert.deepEqual(hrefsFuentes(POS), deLanding, 'los <link> de fuentes de pos.html deben ser los de index.html, en el mismo orden');
  assert.ok(/<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"/.test(POS), 'se conserva el preconnect a jsdelivr');
});

// ───────────────────────── 4. prohibidos ─────────────────────────

test('pos.html no trae Cormorant, Jost, radial-gradient, rgb(from, color-mix( ni backdrop-filter distinto de none', () => {
  const prohibidos = [
    [/cormorant/i, 'Cormorant'],
    [/\bjost\b/i, 'Jost'],
    [/radial-gradient/i, 'radial-gradient'],
    [/rgb\(from/i, 'rgb(from'],
    [/color-mix\(/i, 'color-mix('],
    [/(?:-webkit-)?backdrop-filter\s*:\s*(?!none\b)/i, 'backdrop-filter distinto de none'],
  ];
  for (const [re, nombre] of prohibidos) assert.doesNotMatch(POS, re, `pos.html contiene «${nombre}»`);
});

// ───────────────────────── 5. derivados y contraste ─────────────────────────

test('--pos-telon-elevado y --pos-telon-hover son los hex que salen de mezclar los tokens', () => {
  assert.equal(ROOT['--pos-telon-elevado'].toUpperCase(), mezcla(TOKENS.arroz, TOKENS.telon, 0.08), 'arroz 8 % sobre telón');
  assert.equal(ROOT['--pos-telon-hover'].toUpperCase(), mezcla(TOKENS.arroz, TOKENS.telon, 0.15), 'telón 85 % + arroz');
});

test('pares nuevos de docs/pos-visual.md §2.1: deshabilitado y superficies elevadas sobre telón pasan lo que el documento declara', () => {
  const elevado = ROOT['--pos-telon-elevado'];
  const hover = ROOT['--pos-telon-hover'];
  const pares = [
    ['apoyo sobre linea (botón deshabilitado, sin opacidad)', TOKENS.apoyo, TOKENS.linea, 4.5],
    ['arroz sobre telón elevado', TOKENS.arroz, elevado, 4.5],
    ['ceniza sobre telón elevado', TOKENS.ceniza, elevado, 4.5],
    ['maiz sobre telón elevado', TOKENS.maiz, elevado, 4.5],
    ['letrero sobre telón elevado', TOKENS.letrero, elevado, 4.5],
    ['arroz sobre el hover de .btn-telon', TOKENS.arroz, hover, 4.5],
    ['turquesa sobre telón (punto «en línea», no-texto)', TOKENS.turquesa, TOKENS.telon, 3],
    ['letrero sobre telón (número de mesa ocupada)', TOKENS.letrero, TOKENS.telon, 4.5],
    ['arroz sobre telón (mesa ocupada, nav activo, opción elegida)', TOKENS.arroz, TOKENS.telon, 4.5],
    ['telón sobre letrero (botón principal)', TOKENS.telon, TOKENS.letrero, 4.5],
    ['barro sobre papel (aviso, enlace, peligro)', TOKENS.barro, TOKENS.papel, 4.5],
    ['turquesa sobre papel (estado hecho)', TOKENS.turquesa, TOKENS.papel, 4.5],
  ];
  for (const [nombre, a, b, minimo] of pares) {
    const c = contraste(a, b);
    assert.ok(c >= minimo, `${nombre}: ${c.toFixed(2)} < ${minimo}`);
  }
});

// ───────────────────────── 6. var() sin declarar ─────────────────────────

test('toda var(--x) de pos.html sin valor de respaldo está declarada en un :root del <style>', () => {
  // Solo cuentan las declaraciones de :root: un alias que viva únicamente bajo .sobre-telon no
  // resolvería sobre claro. (--foco, --eyebrow, --rombo y --rotulo se usan con respaldo.)
  const declaradas = new Set();
  for (const m of sinComentariosCss(bloqueStyle).matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].matchAll(/(--[a-z0-9-]+)\s*:/gi)) declaradas.add(d[1]);
  }
  // Tailwind CDN define sus propias variables (--tw-*) en tiempo de ejecución.
  const usadas = new Set([...POS.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gi)].filter((m) => m[2] === ')').map((m) => m[1]));
  const sinDeclarar = [...usadas].filter((v) => !declaradas.has(v) && !v.startsWith('--tw-'));
  assert.deepEqual(sinDeclarar, [], `var() sin declarar (¿falta un alias de docs/pos-visual.md §2.3?): ${sinDeclarar.join(', ')}`);
});

// ───────────────────────── 7. marcadores de parte ─────────────────────────

test('los marcadores de parte de docs/pos-visual.md §4.3 están, en pares ▼/▲ y cada uno en su propia línea', () => {
  const claves = [
    'marco-salon-ticket :: login',
    'marco-salon-ticket :: nav-y-mesas',
    'orden',
    'marco-salon-ticket :: ticket',
    'cierre-y-menu',
    'productos-y-modales',
  ];
  const lineas = POS.split('\n');
  const orden = [];
  for (const clave of claves) {
    const abre = lineas.findIndex((l) => l.trim() === `<!-- ▼ PARTE ${clave} -->`);
    const cierra = lineas.findIndex((l) => l.trim() === `<!-- ▲ PARTE ${clave} -->`);
    assert.ok(abre !== -1, `falta «<!-- ▼ PARTE ${clave} -->» en su propia línea`);
    assert.ok(cierra > abre, `falta «<!-- ▲ PARTE ${clave} -->» después del de apertura`);
    orden.push(abre, cierra);
  }
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b), 'los marcadores del marcado deben ir en el orden de §4.3 y sin solaparse');

  const css = ['marco-salon-ticket', 'orden', 'cierre-y-menu', 'productos-y-modales'];
  const posiciones = [];
  for (const clave of css) {
    const abre = POS.indexOf(`/* ▼ PARTE ${clave} :: css */`);
    const cierra = POS.indexOf(`/* ▲ PARTE ${clave} :: css */`);
    assert.ok(abre !== -1 && cierra > abre, `faltan los marcadores CSS de ${clave}`);
    posiciones.push(abre, cierra);
  }
  assert.deepEqual(posiciones, [...posiciones].sort((a, b) => a - b), 'los cuatro bloques CSS deben ir consecutivos y sin solaparse');
  assert.ok(posiciones[posiciones.length - 1] < POS.indexOf('@media print'), 'los bloques de parte van antes de @media print');
});
