// La prueba «identidad.test.mjs» que docs/identidad-visual.md v2 pedía en §13-A5 y que
// ninguna de las partes en paralelo llegó a escribir como archivo propio (su alcance quedó
// repartido a medias entre contraste.test.mjs, imagenes.test.mjs y reglas.test.mjs — ver el
// informe de integración de la fase «El letrero abre el salón», 2026-09-29). Esta prueba
// cierra lo que faltaba de §13-A5 sin repetir lo que las otras tres ya cubren:
//   - contraste.test.mjs ya verifica que base.css tenga EXACTAMENTE los 15 tokens de §3, el
//     guardia `--color-*: initial` y ninguno de los 21 tokens de v1.
//   - imagenes.test.mjs ya verifica fetchpriority/srcset/familia de recursos y que ningún
//     <video> lleve loop.
//   - reglas.test.mjs ya verifica la «trampa de datos» (500/150 personas, +2.000, precios a
//     mano, catering/desayuno/domicilio-evento) y los mutantes de control.
// Lo que queda, y es lo que prueba este archivo:
//   1. Ninguna clase o var() de la v1 sigue en uso — ni como utilidad de color
//      (bg-ember, text-amber-tinta, var(--color-ink)…) ni como componente propio
//      (.btn-oro, .badge-amber, .sobre-ink, .aplique, .filete…) — en las tres páginas ni en
//      componentes.css/landing.css/carta-menu.css/assets/js/*.js.
//   2. Los dos <link> de Google Fonts de §4 aparecen BYTE A BYTE iguales en las tres
//      páginas, y Fraunces/DM Sans no aparece en ningún lado (páginas, los tres CSS propios
//      ni el CSS compilado).
//   3. `theme-color` vale `#0A1112` en las tres páginas.
//   4. El único hex permitido en componentes.css/landing.css/carta-menu.css es el de
//      `.franja` (los cinco tokens de §5.1, codificados como %23 dentro del data-URI); no
//      hay ningún `#hex` ni `rgba(` suelto dentro de un `style=""` de las tres páginas.
//   5. `.rotulo::first-letter` usa `var(--font-r)`, y el H1 de index.html trae
//      class="rotulo", «Resplandor» y la hora del lema.
//   6. `.franja` aparece exactamente 4 veces en index.html y 1 vez en carta.html/menu.html
//      (§5.1).
//   7. Sin itálica (`italic`/`<em>`) y sin las dos frases inventadas que la v1 dejó
//      («sin excepciones», «capacidad completa del local») en ninguna de las tres páginas.
//
// Sobre el punto 1: el regex de clases viejas del brief (`\bvigas\b`, entre otras) se aplica
// SOLO dentro de class="…"/​:class="…" y dentro de selectores CSS (`.vigas{`) — nunca al
// texto suelto del HTML. Aplicado a todo el documento sin ese cuidado, choca con un falso
// positivo real de este sitio: el `alt` de `salon-pared-terracota-letrero` describe «vigas
// negras en el techo blanco» (la palabra existe de verdad en la foto, nada que ver con la
// clase CSS `.vigas` de la v1). Una prueba que no distinga las dos cosas es exactamente el
// tipo de «prueba que lee mal el brief» que esta ronda de integración pidió corregir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => path.join(RAIZ, ...p);
const leer = (p) => fs.readFileSync(ruta(p), 'utf8');

// Esta suite documenta el cambio de contrato con comentarios que NOMBRAN a propósito lo que
// se fue («Reemplaza a Fraunces + DM Sans…», «.btn-oro, .btn-ink… ya no existen» — el mismo
// estilo que ya usan componentes.css y landing-y-agentes.md). Esas menciones son historia,
// no uso: las pruebas de este archivo que buscan restos de la v1 se aplican sobre el texto
// SIN comentarios, para no confundir «lo documentamos» con «lo seguimos usando».
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

const PAGINAS = ['index.html', 'carta.html', 'menu.html'];
const CSS_PROPIO = ['assets/css/componentes.css', 'assets/css/landing.css', 'assets/css/carta-menu.css'];
const JS_AGENTES = ['assets/js/local.js', 'assets/js/solicitud.js', 'assets/js/vivo.js', 'assets/js/landing.js', 'assets/js/agentes.js'];

// ───────────────────────── 1. clases/var() de la v1, fuera de uso ─────────────────────────

// Utilidades de color de Tailwind con un tono de v1 (bg-ember, text-amber-tinta,
// border-terracota…) y var(--color-x) de v1, en cualquiera de las dos capas (JS o markup).
const RE_UTILIDAD_VIEJA = /\b(?:bg|text|border|divide|ring|fill|stroke|outline|decoration|from|to|via|shadow)-(?:ember|amber|amber-tinta|parch|parch-d|ink|ink-5|ink-3|teal|teal-tinta|card|muted|soft|line|terracota)\b/;
const RE_VAR_VIEJA = /var\(--color-(?:ember|amber|amber-tinta|parch|parch-d|ink|ink-5|ink-3|teal|teal-tinta|card|muted|soft|line|terracota)(?:-[a-z0-9]+)?\)/;

for (const archivo of [...PAGINAS, ...CSS_PROPIO, ...JS_AGENTES]) {
  test(`${archivo}: ninguna utilidad ni var() de color de la v1 (ember/amber/parch/ink/teal/card/muted/line/soft/terracota)`, () => {
    const texto = sinComentarios(leer(archivo));
    const fallas = [];
    const u = texto.match(RE_UTILIDAD_VIEJA);
    if (u) fallas.push(`utilidad vieja: "${u[0]}"`);
    const v = texto.match(RE_VAR_VIEJA);
    if (v) fallas.push(`var() vieja: "${v[0]}"`);
    assert.deepEqual(fallas, []);
  });
}

// Clases/motivos propios de la v1 que §3.3 da de baja. Ojo con «vigas»: se busca SOLO como
// selector CSS (`.vigas` seguido de espacio/llave/coma/pseudo-clase) o como clase de marcado
// (dentro de class="…"), nunca como palabra suelta del texto (ver la nota del encabezado).
const CLASES_VIEJAS = ['btn-ember', 'btn-oro', 'btn-ink', 'badge-ember', 'badge-amber', 'badge-teal', 'sobre-ink', 'vigas', 'aplique', 'aplique-oro', 'filete'];

function clasesEnAtributos(html) {
  const encontradas = new Set();
  const re = /\b(?:class|:class)="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    for (const tok of m[1].split(/\s+/)) {
      // Alpine escribe :class con una expresión JS ('foo' ? 'bar' : ''); igual solo nos
      // importan los tokens de clase literales que puedan aparecer sueltos ahí adentro.
      const limpio = tok.replace(/^['"(]+|['")]+$/g, '');
      if (limpio) encontradas.add(limpio);
    }
  }
  return encontradas;
}

for (const pagina of PAGINAS) {
  test(`${pagina}: ninguna clase de marcado de la v1 (btn-oro, badge-amber, .vigas, .aplique, .filete…)`, () => {
    const clases = clasesEnAtributos(leer(pagina));
    const presentes = CLASES_VIEJAS.filter((c) => clases.has(c));
    assert.deepEqual(presentes, []);
  });
}

for (const archivo of CSS_PROPIO) {
  test(`${archivo}: ningún selector de la v1 (.btn-oro, .badge-amber, .vigas, .aplique, .filete…) sigue definido`, () => {
    const css = sinComentarios(leer(archivo));
    const presentes = CLASES_VIEJAS.filter((c) => new RegExp(`\\.${c}\\b[\\s{:,.>+~]`).test(css));
    assert.deepEqual(presentes, []);
  });
}

// ───────────────────────── 2. Tipografía: los dos <link> idénticos, Fraunces/DM Sans fuera ─────────────────────────

const LINK_CINZEL_ARCHIVO = '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=Archivo:wght@400..700&display=swap" rel="stylesheet"';
const LINK_CINZEL_R = '<link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&text=R&display=swap"';

for (const pagina of PAGINAS) {
  test(`${pagina}: trae el par de <link> de Google Fonts de §4, byte a byte`, () => {
    const html = leer(pagina).replace(/\s+/g, ' ');
    assert.ok(html.includes(LINK_CINZEL_ARCHIVO.replace(/\s+/g, ' ')), 'falta (o cambió) el <link> de Cinzel 700 + Archivo 400..700');
    assert.ok(html.includes(LINK_CINZEL_R.replace(/\s+/g, ' ')), 'falta (o cambió) el <link> de Cinzel Decorative, solo la R');
  });
}

for (const archivo of [...PAGINAS, ...CSS_PROPIO, 'assets/css/resplandor.css']) {
  test(`${archivo}: sin Fraunces ni DM Sans (la v1 los reemplaza por Cinzel + Archivo, §4)`, () => {
    assert.doesNotMatch(sinComentarios(leer(archivo)), /Fraunces|DM\s*Sans|DM\+Sans/i);
  });
}

// ───────────────────────── 3. theme-color ─────────────────────────

for (const pagina of PAGINAS) {
  test(`${pagina}: theme-color es #0A1112 (§9)`, () => {
    const m = leer(pagina).match(/<meta\s+name="theme-color"\s+content="([^"]+)"/i);
    assert.ok(m, 'no encontré <meta name="theme-color">');
    assert.equal(m[1], '#0A1112');
  });
}

// ───────────────────────── 4. hex fuera de .franja, y nada de #hex/rgba( en style="" ─────────────────────────

// Los cinco tokens de §5.1, tal como quedan codificados dentro del data-URI (%23 = '#').
const HEX_FRANJA = ['0A1112', '2A738A', 'C5571A', 'E9A91F', 'F4F0E3'];

test('componentes.css: el único hex de .franja son los cinco tokens de §5.1, codificados como %23', () => {
  const css = leer('assets/css/componentes.css');
  const m = css.match(/\.franja\s*\{[^}]*\}/s);
  assert.ok(m, 'no encontré la regla .franja en componentes.css');
  const codificados = [...m[0].matchAll(/%23([0-9A-Fa-f]{6})/g)].map((x) => x[1].toUpperCase());
  assert.deepEqual(new Set(codificados), new Set(HEX_FRANJA));
});

for (const archivo of CSS_PROPIO) {
  test(`${archivo}: ningún hex literal (#rrggbb) fuera de la única excepción de .franja`, () => {
    const css = sinComentarios(leer(archivo));
    const fueraDeFranja = css.replace(/\.franja\s*\{[^}]*\}/gs, '');
    assert.doesNotMatch(fueraDeFranja, /#[0-9A-Fa-f]{3,6}\b/);
  });
}

for (const pagina of PAGINAS) {
  test(`${pagina}: ningún style="" trae un #hex o un rgba( (§13-A5)`, () => {
    const html = leer(pagina);
    const estilos = [...html.matchAll(/\bstyle="([^"]*)"/g)].map((m) => m[1]);
    const conHex = estilos.filter((s) => /#[0-9A-Fa-f]{3,6}\b|rgba\(/.test(s));
    assert.deepEqual(conHex, []);
  });
}

// ───────────────────────── 5. El rótulo: la R de Cinzel Decorative ─────────────────────────

test('componentes.css: .rotulo::first-letter usa var(--font-r), no Cinzel a secas', () => {
  const css = leer('assets/css/componentes.css');
  const m = css.match(/\.rotulo::first-letter\s*\{([^}]*)\}/s);
  assert.ok(m, 'no encontré la regla .rotulo::first-letter');
  assert.match(m[1], /var\(--font-r\)/);
});

test('index.html: el H1 del hero trae class="rotulo", «Resplandor» y la hora del lema (§7.1)', () => {
  const html = leer('index.html');
  const m = html.match(/<h1\b[\s\S]*?<\/h1>/);
  assert.ok(m, 'no encontré el <h1> del hero');
  assert.match(m[0], /class="rotulo"/);
  assert.match(m[0], /Resplandor/);
  assert.match(m[0], /todos los días de 12 a 5/);
});

// ───────────────────────── 6. Cuántas franjas (§5.1) ─────────────────────────

const contarFranjas = (html) => (html.match(/class="franja"/g) || []).length;

test('index.html: exactamente 4 usos de .franja (inicio, platos, la-casa, pie)', () => {
  assert.equal(contarFranjas(leer('index.html')), 4);
});
test('carta.html: exactamente 1 uso de .franja (bajo la cabecera)', () => {
  assert.equal(contarFranjas(leer('carta.html')), 1);
});
test('menu.html: exactamente 1 uso de .franja (bajo la cabecera)', () => {
  assert.equal(contarFranjas(leer('menu.html')), 1);
});

// ───────────────────────── 7. Sin itálica, sin las frases inventadas de la v1 ─────────────────────────

for (const pagina of PAGINAS) {
  test(`${pagina}: sin itálica (italic/<em>) ni las frases que los hallazgos de la v1 pidieron quitar`, () => {
    const html = leer(pagina);
    const fallas = [];
    if (/\bitalic\b/i.test(html)) fallas.push('usa "italic"');
    if (/<em[ >]/i.test(html)) fallas.push('usa <em>');
    if (/sin excepciones/i.test(html)) fallas.push('«sin excepciones» (hallazgo v1: es inventado)');
    if (/capacidad completa del local/i.test(html)) fallas.push('«capacidad completa del local» (hallazgo v1)');
    assert.deepEqual(fallas, []);
  });
}

// ───────────────────────── 8. Guardas de USO de los pares de color (ronda 1 de la v2) ─────────────────────────
// contraste.test.mjs y la prueba del punto 4 (arriba) ya prueban que los TOKENS existan y que
// los HEX literales no se cuelen. Lo que faltaba, y probó un mutante concreto de la ronda de
// refutación (scratchpad/refutar-v2/mutantes.json M17r/M18r/M19r/M20/M21/M22/M23/M24/M25r/M28/
// M32r: los once sobrevivían con la suite en verde), es vigilar que el MARCADO y el CSS
// COMPILADO de verdad usen esos tokens en los pares permitidos — no solo que existan en
// base.css. Cada prueba de acá documenta, en su nombre, qué mutante cierra.

// Extrae una <section id="…">…</section> de index.html (9 secciones, todas al mismo nivel:
// misma técnica que scripts/pruebas/reglas.test.mjs).
function extraerSeccionLanding(html, id) {
  const marcador = new RegExp(`<section\\b[^>]*\\bid=["']${id}["']`, 'i');
  const m = marcador.exec(html);
  assert.ok(m, `no encontré <section id="${id}"> en index.html`);
  const desde = m.index;
  const siguiente = html.slice(desde + m[0].length).search(/<section\b/i);
  return siguiente === -1 ? html.slice(desde) : html.slice(desde, desde + m[0].length + siguiente);
}

test('index.html: #inicio y #la-casa traen la clase que abre su x-data/su color de texto (M20-M24 no son los únicos huérfanos posibles)', () => {
  const html = leer('index.html');
  const seccionInicio = extraerSeccionLanding(html, 'inicio');
  assert.match(seccionInicio, /<section\b[^>]*\bid="inicio"[^>]*\bx-data="\{\}"/, '#inicio necesita x-data="{}" o sus @click (Reservar mesa) nunca se registran — Alpine nunca camina esa porción del DOM');
  const m = html.match(/<section\s+id="la-casa"\s+class="([^"]*)"/);
  assert.ok(m, 'no encontré <section id="la-casa">');
  assert.match(m[1], /\btext-arroz\b/, '#la-casa (fondo selva) necesita text-arroz: sin ella el H2 hereda telon del body, 2,50 sobre selva — prohibido por §3.1');
});

test('index.html: <section id="platos"> trae .sobre-telon (si no, el foco barro sobre telón da 2,52 — mutante M24)', () => {
  const html = leer('index.html');
  const m = html.match(/<section\s+id="platos"\s+class="([^"]*)"/);
  assert.ok(m, 'no encontré <section id="platos">');
  assert.match(m[1], /\bsobre-telon\b/);
});

test('index.html: ningún .btn-letrero dentro de #hoy o #celebraciones (bandas .pared): el coral desaparece ahí, 1,08 — §3.1 (mutante M20)', () => {
  const html = leer('index.html');
  for (const id of ['hoy', 'celebraciones']) {
    const clases = clasesEnAtributos(extraerSeccionLanding(html, id));
    assert.ok(!clases.has('btn-letrero'), `#${id} (.pared) usa .btn-letrero, prohibido por §3.1 (1,08 sobre pared)`);
  }
});

test('index.html: text-maiz nunca aparece en una sección clara (#carta, #almuerzo-programado, #preguntas): maiz es ilegible sobre claro, arroz 1,81 · papel 2,03 — §3.1 (mutante M21)', () => {
  const html = leer('index.html');
  for (const id of ['carta', 'almuerzo-programado', 'preguntas']) {
    const clases = clasesEnAtributos(extraerSeccionLanding(html, id));
    assert.ok(!clases.has('text-maiz'), `#${id} (claro) usa text-maiz, prohibido por §3.1`);
  }
});

for (const pagina of PAGINAS) {
  test(`${pagina}: cada <div class="franja"> lleva aria-hidden="true" (mutante M22)`, () => {
    const html = leer(pagina);
    const franjas = html.match(/<div class="franja"[^>]*>/g) || [];
    assert.ok(franjas.length > 0, `${pagina}: no encontré ningún <div class="franja">`);
    const sinAria = franjas.filter((f) => !/aria-hidden="true"/.test(f));
    assert.deepEqual(sinAria, [], `.franja sin aria-hidden: ${sinAria.join(' | ')}`);
  });
}

test('index.html: los 8 botones "Cotizar" de #celebraciones traen su propio <span class="sr-only"> (nombres accesibles distintos — mutante M23)', () => {
  const seccion = extraerSeccionLanding(leer('index.html'), 'celebraciones');
  const botones = seccion.match(/<button[^>]*@click="\$store\.solicitud\.abrir\('[^']+'\)"[\s\S]*?<\/button>/g) || [];
  assert.equal(botones.length, 8, `esperaba 8 botones "Cotizar" en #celebraciones, hallé ${botones.length}`);
  const sinSrOnly = botones.filter((b) => !/class="sr-only"/.test(b));
  assert.deepEqual(sinSrOnly, [], 'botón "Cotizar" sin <span class="sr-only">: quedan varios con el mismo nombre accesible');
});

test('carta.html: ningún precio (x-text="pesos(…)") lleva font-display — Cinzel nunca en precios, §4 (mutante M28)', () => {
  const html = leer('carta.html');
  const spans = html.match(/<span[^>]*\bx-text="pesos\([^)]*\)"[^>]*>/g) || [];
  assert.ok(spans.length > 0, 'no encontré ningún elemento con x-text="pesos(...)"');
  const conFontDisplay = spans.filter((s) => /font-display/.test(s));
  assert.deepEqual(conFontDisplay, []);
});

for (const pagina of PAGINAS) {
  test(`${pagina}: ningún texto con alfa (text-color/NN, p. ej. text-arroz/60): sin texto con transparencia, §3.1 (mutante M19)`, () => {
    const conAlfa = [...leer(pagina).matchAll(/\btext-[a-z]+\/\d+\b/g)].map((m) => m[0]);
    assert.deepEqual(conAlfa, []);
  });
}

for (const archivo of CSS_PROPIO) {
  test(`${archivo}: sin color literal nuevo (rgb()/hsl() con números, hex de 8 dígitos) fuera de rgb(from var(--color-…)) y de .franja (mutantes M17r/M18r/M32r)`, () => {
    let css = sinComentarios(leer(archivo)).replace(/\.franja\s*\{[^}]*\}/gs, '');
    // Quita las instancias legítimas de rgb(from var(--color-x) r g b / N) — la técnica que
    // ya usan #solicitud::backdrop, .overlay, .dialog, .toast y los bordes de .btn-linea-clara.
    css = css.replace(/rgb\(from\s+var\(--color-[a-z0-9-]+\)\s+r\s+g\s+b\s*\/\s*[\d.]+\)/g, '');
    const fallas = [];
    if (/#[0-9A-Fa-f]{7,8}\b/.test(css)) fallas.push('hex de 7-8 dígitos (con canal alfa)');
    if (/\bhsla?\(/i.test(css)) fallas.push('hsl()/hsla()');
    if (/\brgba?\(\s*[\d.]/.test(css)) fallas.push('rgb()/rgba() con números literales (no "rgb(from var(...))")');
    assert.deepEqual(fallas, [], fallas.join('; '));
  });
}

test('base.css: el bloque @media (prefers-reduced-motion: reduce) sigue presente y apaga animation/transition con !important (mutante M25r)', () => {
  const css = leer('assets/css/base.css');
  const m = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, 'no encontré @media (prefers-reduced-motion: reduce) en base.css');
  assert.match(m[0], /animation-duration:\s*\.01ms\s*!important/);
  assert.match(m[0], /transition-duration:\s*\.01ms\s*!important/);
});

// ───────────────────────── 9. Guardas de integración (2026-09-29, ronda de cierre de la v2) ─────────────────────────
// La ronda 0 dejó dos huecos que la suite no veía y que el refutador mostró a mano: una clase
// del marcado (`.lema`) sin regla en ninguna hoja —el lema del H1 salía a 16 px y peso 400— y
// una franja que la foto absoluta del hero cortaba desde el 45 % del ancho (a partir de
// 1024 px). Las dos pruebas de abajo cierran esa CLASE de defecto, no solo esos dos casos.

// Nombres de clase que define el CSS compilado (selectores `.nombre`, ya sin los escapes de
// Tailwind: `.sm\:w-auto` → `sm:w-auto`, `.w-\[calc\(100\%\+2rem\)\]` → `w-[calc(100%+2rem)]`).
function clasesDelCssCompilado() {
  const css = leer('assets/css/resplandor.css');
  const desescapar = (s) => s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');
  const definidas = new Set();
  for (const m of css.matchAll(/\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[A-Za-z0-9_-])+)/g)) definidas.add(desescapar(m[1]));
  return definidas;
}

// Clases de marcado que a propósito no tienen regla propia (ganchos para JS, marcadores).
// Hoy ninguna: cualquier gancho nuevo se anota acá, con su motivo, en vez de callar la prueba.
const CLASES_SIN_REGLA_PERMITIDAS = new Set([]);

for (const pagina of PAGINAS) {
  test(`${pagina}: toda clase del marcado (class="…") tiene su regla en assets/css/resplandor.css: una clase sin regla es un estilo que nunca llega (.lema en la ronda 0)`, () => {
    const definidas = clasesDelCssCompilado();
    const usadas = new Set();
    for (const m of sinComentarios(leer(pagina)).matchAll(/\sclass="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c) usadas.add(c);
    }
    const huerfanas = [...usadas].filter((c) => !definidas.has(c) && !CLASES_SIN_REGLA_PERMITIDAS.has(c));
    assert.deepEqual(huerfanas, [], `clases sin regla en el CSS compilado (¿falta definirla en landing.css/componentes.css/carta-menu.css y correr node scripts/css.mjs?): ${huerfanas.join(', ')}`);
  });
}

test('index.html: el panel #menu-movil es absoluto y no cambia la altura de la cabecera: si lo hiciera, al cerrarse tras tocar un enlace los saltos a #ancla aterrizan 314 px más abajo y el título de la sección queda fuera de pantalla (hallazgo del cierre de la v2, a 375 px)', () => {
  const m = leer('index.html').match(/<div id="menu-movil"[^>]*\bclass="([^"]*)"/);
  assert.ok(m, 'no encontré <div id="menu-movil" … class="…">');
  const clases = m[1].split(/\s+/);
  for (const c of ['absolute', 'inset-x-0', 'top-full']) assert.ok(clases.includes(c), `#menu-movil perdió «${c}»`);
  assert.ok(clases.includes('lg:hidden'), '#menu-movil perdió «lg:hidden»');
});

test('landing.css: .hero > .franja va por encima de la foto (position + z-index): la foto absoluta de desde 1024 px no debe cortarle el ritmo (hallazgo v2, ronda 0, parte «c»)', () => {
  const css = sinComentarios(leer('assets/css/landing.css'));
  const m = css.match(/\.hero\s*>\s*\.franja\s*\{([^}]*)\}/s);
  assert.ok(m, 'no encontré la regla «.hero > .franja» en landing.css');
  assert.match(m[1], /position:\s*relative/);
  assert.match(m[1], /z-index:\s*\d+/);
});

// ───────────────────────── 10. Páginas ancla (about/contact/privacy/404) y trato de «tú» ─────────────────────────
// La rama `agentes-listos` trajo cuatro páginas de utilidad, generadas por
// scripts/descubrimiento.mjs, que nacieron con la paleta del POS (#1C1A17/#F7F2EC/#B5341C) y
// sin las fuentes de la v2; el refutador de la ronda 0 lo anticipó (hallazgo «H9»: la suite
// solo escaneaba landing, carta y menú, así que al integrar la cara pública habría vuelto a
// mostrar la paleta que el brief quitó). Ahora el generador lee los tokens de base.css y la
// regla .franja de componentes.css; estas pruebas vigilan que siga así, sobre los archivos que
// de verdad se publican.

const PAGINAS_ANCLA = ['about.html', 'contact.html', 'privacy.html', '404.html'];

function tokensDeBase() {
  const tokens = {};
  for (const m of leer('assets/css/base.css').matchAll(/--color-([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) tokens[m[1]] = m[2].toUpperCase();
  return tokens;
}

for (const pagina of PAGINAS_ANCLA) {
  test(`${pagina}: identidad v2 (solo hex que son tokens de base.css, ni paleta del POS ni Fraunces/DM Sans, los dos <link> de fuentes de §4 byte a byte, theme-color, una .franja aria-hidden, el rótulo)`, () => {
    const html = leer(pagina);
    const tokens = tokensDeBase();
    const validos = new Set(Object.values(tokens));
    const literales = [
      ...[...html.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => '#' + m[1].toUpperCase()),
      ...[...html.matchAll(/%23([0-9A-Fa-f]{6})/g)].map((m) => '#' + m[1].toUpperCase()), // el data-URI de .franja
    ];
    assert.ok(literales.length > 0, `${pagina}: no encontré ningún color (¿perdió su <style>?)`);
    assert.deepEqual([...new Set(literales.filter((h) => !validos.has(h)))], [], `${pagina}: colores que no son tokens de base.css`);
    for (const posHex of ['#1C1A17', '#F7F2EC', '#B5341C']) {
      assert.ok(!literales.includes(posHex), `${pagina}: trae ${posHex}, de la paleta del POS`);
    }
    assert.doesNotMatch(sinComentarios(html), /Fraunces|DM\s*Sans|DM\+Sans/i);
    const plano = html.replace(/\s+/g, ' ');
    assert.ok(plano.includes(LINK_CINZEL_ARCHIVO.replace(/\s+/g, ' ')), 'falta (o cambió) el <link> de Cinzel 700 + Archivo 400..700');
    assert.ok(plano.includes(LINK_CINZEL_R.replace(/\s+/g, ' ')), 'falta (o cambió) el <link> de Cinzel Decorative, solo la R');
    const tema = html.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/i);
    assert.ok(tema, 'no encontré <meta name="theme-color">');
    assert.equal(tema[1].toUpperCase(), tokens.telon);
    assert.equal((html.match(/<div class="franja" aria-hidden="true"><\/div>/g) || []).length, 1, 'debe haber exactamente una .franja con aria-hidden');
    assert.match(html, /class="rotulo"/);
    assert.match(html, /<main>/);
  });
}

// La cara pública habla de «tú» (dato de la v2). El voseo se busca solo en lo que la persona
// lee: texto visible y atributos legibles (alt, aria-label, title, placeholder, description), no
// en los comentarios ni en el código de los <script>, donde esta casa sí escribe en voseo.
// Borde de palabra con Unicode: `\b` de JS es ASCII y no separaría «usá» de lo que sigue.
const VOSEO = /(?<![\p{L}\p{N}_])(?:vos|tenés|querés|sabés|podés|hacés|mandás|armás|completás|abrís|buscás|contanos|decime|fijate|mirá|elegí|escribí|escribinos|usá|corré|pedí|avisá|confirmá|revisá|llamá|dejá|pagás|reservás|cotizás|elegís)(?![\p{L}\p{N}_])/iu;

function textoQueLeeLaPersona(html) {
  const cuerpo = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const atributos = [...html.matchAll(/\b(?:alt|aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  const descripcion = [...html.matchAll(/<meta\s+(?:name|property)="(?:description|og:description|twitter:description|og:title|twitter:title)"\s+content="([^"]*)"/gi)].map((m) => m[1]);
  return [cuerpo, ...atributos, ...descripcion].join(' ');
}

for (const pagina of [...PAGINAS, ...PAGINAS_ANCLA]) {
  test(`${pagina}: trato de «tú» en lo que lee la persona (sin voseo: vos, buscás, contanos, armás…)`, () => {
    const hallado = textoQueLeeLaPersona(leer(pagina)).match(VOSEO);
    assert.equal(hallado, null, `voseo en ${pagina}: «${hallado && hallado[0]}»`);
  });
}
