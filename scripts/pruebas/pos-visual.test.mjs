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
//   8. Móvil primero (§0, §0.12): las variables y las clases compartidas del teléfono existen y
//      siguen las reglas de §0.2 (lo que fija o reordena va con `screen`, nada de overflow-anchor,
//      :has() ni text-wrap, env() con respaldo, dvh detrás de vh, capas en orden, hoja inferior bajo
//      768 px, minimum-scale=1 en el viewport) y el arnés de capturas emula teléfono bajo 768 px. Todo esto vale en cada etapa: las
//      cuatro partes que vienen después no pueden romperlo.
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

// ───────────────────────── 8. móvil primero (docs/pos-visual.md §0) ─────────────────────────

const CSS = sinComentariosCss(bloqueStyle);

/** Bloques `@media` de primer nivel del <style>: { condicion, cuerpo } (llaves balanceadas). */
function bloquesMedia(css) {
  const bloques = [];
  for (let i = css.indexOf('@media'); i !== -1; i = css.indexOf('@media', i + 1)) {
    const abre = css.indexOf('{', i);
    let profundidad = 0;
    let fin = -1;
    for (let j = abre; j < css.length; j++) {
      if (css[j] === '{') profundidad++;
      else if (css[j] === '}' && --profundidad === 0) { fin = j; break; }
    }
    assert.ok(fin !== -1, `@media sin cerrar: ${css.slice(i, i + 60)}`);
    bloques.push({ condicion: css.slice(i + '@media'.length, abre).trim().replace(/\s+/g, ' '), cuerpo: css.slice(abre + 1, fin) });
    i = fin;
  }
  return bloques;
}

/** El cuerpo de la primera regla cuyo selector es EXACTAMENTE `selector` dentro de `css` (sin anidar). */
function cuerpoDe(css, selector) {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = css.match(new RegExp(`(?:^|[}\\s,])${escapado}\\s*\\{([^{}]*)\\}`));
  assert.ok(m, `no hay una regla «${selector}»`);
  return m[1];
}

const valorDe = (cuerpo, propiedad) => (cuerpo.match(new RegExp(`(?:^|[;\\s])${propiedad}\\s*:\\s*([^;]+)`)) || [])[1]?.trim();

test('móvil primero §0.12: las variables --pos-gutter, --pos-nav-inf, --pos-accion-inf, --pos-safe-b y --pos-nav-alto están en el :root', () => {
  assert.equal(ROOT['--pos-gutter'], '1rem');
  assert.equal(ROOT['--pos-nav-inf'], '3.75rem');
  assert.equal(ROOT['--pos-accion-inf'], '4.25rem');
  assert.equal(ROOT['--pos-safe-b'], 'env(safe-area-inset-bottom, 0px)');
  assert.equal(ROOT['--pos-nav-alto'], '0px', 'en teléfono el nav no es sticky: 0px (con unidad, para que calc() lo acepte)');
});

test('móvil primero §0.12: --pos-nav-alto vale 7.25rem desde 768 px y 4.25rem desde 1024 px (en ese orden)', () => {
  const alto = (minimo) => {
    const b = bloquesMedia(CSS).find((x) => x.condicion === `(min-width: ${minimo}px)` && /--pos-nav-alto/.test(x.cuerpo));
    assert.ok(b, `falta @media (min-width: ${minimo}px) con --pos-nav-alto`);
    return b.cuerpo.match(/--pos-nav-alto\s*:\s*([^;]+);/)[1].trim();
  };
  assert.equal(alto(768), '7.25rem');
  assert.equal(alto(1024), '4.25rem');
  const orden = bloquesMedia(CSS).filter((x) => /--pos-nav-alto/.test(x.cuerpo)).map((x) => x.condicion);
  assert.deepEqual(orden, ['(min-width: 768px)', '(min-width: 1024px)'], 'el de 1024 va después, para ganarle al de 768');
});

test('móvil primero §0.12: existen .vista, .barra-inferior, .barra-accion, .a-sangre y .fila-scroll, y .barra-accion va después de .card', () => {
  for (const clase of ['.vista', '.barra-inferior', '.barra-accion', '.a-sangre', '.fila-scroll']) {
    assert.match(CSS, new RegExp(`${clase.replace('.', '\\.')}\\s*\\{`), `falta la clase compartida ${clase}`);
  }
  const card = CSS.search(/\n\s*\.card\s*\{/);
  const accion = CSS.search(/\n\s*\.barra-accion\s*\{/);
  assert.ok(card !== -1 && accion > card, '.barra-accion debe ir DESPUÉS de .card: le gana en borde, radio y sombra por orden de aparición');
});

test('móvil primero §0.2.2: nada que fije, pegue o reordene corre sin `screen` en un @media de max-width (el ticket térmico mide 302 px)', () => {
  const culpables = [];
  for (const { condicion, cuerpo } of bloquesMedia(CSS)) {
    if (!/max-width/.test(condicion) || /^screen\b/.test(condicion) || /\bprint\b/.test(condicion)) continue;
    // `position: relative` o `absolute` no sacan nada del flujo del papel; fixed, sticky y order sí.
    const m = cuerpo.match(/position\s*:\s*(?:fixed|sticky)|[\s;{]order\s*:/);
    if (m) culpables.push(`@media ${condicion} → «${m[0].trim()}»`);
  }
  assert.deepEqual(culpables, [], 'agrega `screen and` al @media (docs/pos-visual.md §0.2.2)');
});

test('móvil primero §0.2.4: .barra-inferior (z 40) y .barra-accion (z 45) son fixed bajo `screen`, por debajo del diálogo (z 50) y del login (z 100)', () => {
  const z = (selector, condicion) => {
    const bloque = bloquesMedia(CSS).find((b) => b.condicion === condicion && new RegExp(`${selector.replace('.', '\\.')}\\s*\\{`).test(b.cuerpo));
    assert.ok(bloque, `${selector} debería fijarse dentro de @media ${condicion}`);
    const cuerpo = cuerpoDe(bloque.cuerpo, selector);
    assert.equal(valorDe(cuerpo, 'position'), 'fixed', `${selector} es position: fixed`);
    return Number(valorDe(cuerpo, 'z-index'));
  };
  const inferior = z('.barra-inferior', 'screen and (max-width: 767.98px)');
  const accion = z('.barra-accion', 'screen and (max-width: 1023.98px)');
  const dialogo = Number(valorDe(cuerpoDe(CSS, '.modal-backdrop'), 'z-index'));
  // Con box-sizing: border-box, el relleno de la zona segura se comería el alto útil de la barra: el alto la suma.
  const altoBarra = (condicion, selector, alto) => {
    const bloque = bloquesMedia(CSS).find((b) => b.condicion === condicion && new RegExp(`${selector.replace('.', '\\.')}\\s*\\{`).test(b.cuerpo));
    assert.match(valorDe(cuerpoDe(bloque.cuerpo, selector), 'min-height'), new RegExp(`calc\\(\\s*var\\(${alto}\\)\\s*\\+\\s*var\\(--pos-safe-b\\)\\s*\\)`), `${selector}: min-height = ${alto} + zona segura`);
  };
  altoBarra('screen and (max-width: 767.98px)', '.barra-inferior', '--pos-nav-inf');
  altoBarra('screen and (max-width: 1023.98px)', '.barra-accion', '--pos-accion-inf');
  assert.equal(inferior, 40);
  assert.equal(accion, 45);
  assert.equal(dialogo, 50);
  assert.ok(inferior < accion && accion < dialogo, 'capas: barra inferior < barra de cobro < diálogo');
  assert.match(POS, /style="z-index:\s*100"|z-index:\s*100/, 'el login conserva z-index 100');
});

test('móvil primero §0.2.4–5: ningún overflow-anchor, :has(, text-wrap, appearance sin prefijo ni transform en el contenedor de las barras fijas', () => {
  assert.doesNotMatch(CSS, /overflow-anchor/i, '`overflow-anchor: none` rompe el anclaje de scroll que evita el salto en la orden (§0.6)');
  assert.doesNotMatch(CSS, /:has\(/, ':has() no corre en gama media');
  assert.doesNotMatch(CSS, /text-wrap/i, 'text-wrap: balance no corre en gama media');
  for (const m of CSS.matchAll(/(?:^|[;\s{])appearance\s*:/g)) {
    const desde = CSS.lastIndexOf('{', m.index);
    assert.match(CSS.slice(desde, CSS.indexOf('}', m.index)), /-webkit-appearance/, '`appearance` va con su `-webkit-`');
  }
  // Un ancestro con transform/filter/perspective/contain/will-change vuelve «fixed» relativo a ese ancestro.
  for (const clase of ['html', 'body', '.vista', '.fade-enter']) {
    const cuerpo = (() => { try { return cuerpoDe(CSS, clase); } catch { return ''; } })();
    assert.doesNotMatch(cuerpo, /(?:^|[;\s])(?:transform|filter|perspective|contain|will-change|backdrop-filter)\s*:/, `${clase} no puede crear bloque contenedor para las barras fijas`);
  }
});

test('móvil primero §0.2.5: todo env(safe-area-inset-*) lleva respaldo, y la página declara viewport-fit=cover', () => {
  const sinRespaldo = [...CSS.matchAll(/env\(\s*([a-z-]+)\s*([,)])/g)].filter((m) => m[2] !== ',').map((m) => m[1]);
  assert.deepEqual(sinRespaldo, [], 'env() sin valor de respaldo: usa env(safe-area-inset-x, 0px)');
  assert.ok(/env\(\s*safe-area-inset-bottom/.test(CSS), 'las barras fijas usan la zona segura de abajo');
  assert.match(POS, /<meta name="viewport"[^>]*viewport-fit=cover/, 'sin viewport-fit=cover, env(safe-area-inset-*) vale siempre 0');
});

test('móvil primero §0.2.4: el viewport lleva minimum-scale=1 (una vista desbordada no agranda la ventana ni deja las barras fijas fuera de pantalla)', () => {
  const m = POS.match(/<meta name="viewport" content="([^"]+)"/);
  assert.ok(m, 'pos.html no tiene <meta name="viewport">');
  assert.match(m[1], /width=device-width/);
  assert.match(m[1], /initial-scale=1(?:\.0)?\b/);
  assert.match(m[1], /minimum-scale=1(?:\.0)?\b/, 'medido: sin minimum-scale, 48 px de desborde vuelven la ventana de 360 a 408 px y las barras fijas miden 408');
  assert.doesNotMatch(m[1], /maximum-scale|user-scalable\s*=\s*(?:no|0)/, 'nunca se bloquea el zoom de acercar (WCAG 1.4.4)');
});

test('móvil primero §0.2.5: toda declaración con dvh va precedida, en su misma regla, por la misma propiedad con vh', () => {
  const sinRespaldo = [];
  for (const regla of CSS.matchAll(/\{([^{}]*)\}/g)) {
    const decl = regla[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1)]);
    decl.forEach(([prop, valor], i) => {
      if (!/\bdvh\b|\d\s*dvh/.test(valor)) return;
      const respaldo = decl.slice(0, i).some(([p, v]) => p === prop && /\dvh\b/.test(v) && !/dvh/.test(v));
      if (!respaldo) sinRespaldo.push(`${prop}: ${valor.trim()}`);
    });
  }
  assert.deepEqual(sinRespaldo, [], 'dvh sin un vh antes (gama media)');
});

test('móvil primero §0.11: los diálogos son hoja inferior bajo 768 px con `screen`; ya no queda la hoja de ≤ 640 px', () => {
  const hoja = bloquesMedia(CSS).find((b) => b.condicion === 'screen and (max-width: 767.98px)' && /\.modal-backdrop\s*\{/.test(b.cuerpo));
  assert.ok(hoja, 'falta la hoja inferior en @media screen and (max-width: 767.98px)');
  assert.equal(valorDe(cuerpoDe(hoja.cuerpo, '.modal-backdrop'), 'align-items'), 'flex-end');
  const modal = cuerpoDe(hoja.cuerpo, '.modal');
  assert.match(modal, /max-height:\s*92vh;[\s\S]*max-height:\s*92dvh/, 'alto máximo de la hoja: 92vh con 92dvh detrás');
  assert.equal(valorDe(modal, 'overscroll-behavior'), 'contain', 'el scroll de la hoja no arrastra la página');
  assert.match(cuerpoDe(hoja.cuerpo, '.modal-footer'), /calc\(\s*\.75rem\s*\+\s*var\(--pos-safe-b\)\s*\)/, 'el pie de la hoja cubre la zona del indicador de inicio');
  for (const b of bloquesMedia(CSS)) {
    assert.ok(!(/max-width:\s*640px/.test(b.condicion) && /\.modal-backdrop\s*\{/.test(b.cuerpo)), 'la hoja inferior de ≤ 640 px ya no existe: es la de < 768 px');
  }
  // §0.11: sin asa. Una barrita arriba promete arrastrar para cerrar y sin JS no arrastra.
  assert.doesNotMatch(hoja.cuerpo, /\.modal(?:-header)?::(?:before|after)/, 'la hoja inferior no lleva asa');
});

test('móvil primero §0.2.6–7: los controles táctiles compartidos miden ≥ 44 px y los campos 16 px (iOS no hace zoom)', () => {
  const px = (v) => (v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v));
  assert.ok(px(ROOT['--pos-tactil']) >= 44, '--pos-tactil ≥ 44 px');
  assert.ok(px(ROOT['--pos-tactil-comodo']) >= 44 && px(ROOT['--pos-boton-alto']) >= 44 && px(ROOT['--pos-boton-lg']) >= 44);
  assert.equal(valorDe(cuerpoDe(CSS, '.field'), 'font-size'), '1rem', '.field a 16 px: por debajo, iOS hace zoom al enfocar');
  for (const [selector, propiedad] of [['.btn-icon', 'width'], ['.btn-icon', 'height'], ['.btn-sm', 'min-height'], ['.btn-enlace', 'min-height'], ['.qty-btn', 'width'], ['.qty-btn', 'height'], ['.menu-item-btn', 'width'], ['.menu-item-btn', 'height']]) {
    assert.equal(valorDe(cuerpoDe(CSS, selector), propiedad), 'var(--pos-tactil)', `${selector} { ${propiedad} } debe ser 44 px (--pos-tactil)`);
  }
});

test('móvil primero §0.12.4: el arnés de capturas parte de 360×780, 390×844, 768×1024 y 1440×900, y emula teléfono bajo 768 px', () => {
  const capturas = leer('scripts/capturas-pos.mjs');
  const simulado = leer('scripts/pruebas/_pos-simulado.mjs');
  for (const [ancho, alto] of [[360, 780], [390, 844], [768, 1024], [1440, 900]]) {
    assert.match(capturas, new RegExp(`\\b${ancho}:\\s*${alto}\\b`), `ALTOS debe tener ${ancho}: ${alto}`);
  }
  assert.match(capturas, /anchos:\s*\[360,\s*390,\s*768,\s*1440\]/, 'los anchos por defecto son 360, 390, 768 y 1440');
  assert.match(capturas, /'--ventana'/, 'falta la opción --ventana');
  assert.match(simulado, /isMobile:\s*movil[\s\S]*hasTouch:\s*movil/, 'nuevoContexto emula isMobile y hasTouch con `movil`');
  assert.match(simulado, /deviceScaleFactor:\s*escala \?\? \(movil \? 2 : 1\)/, 'escala 2 en teléfono, 1 en el resto');
  assert.match(capturas, /def\.media !== 'print'/, 'lo impreso (302 y 794 px) no se emula como teléfono: sale idéntico a la base');
});
