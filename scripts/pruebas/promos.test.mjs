// «Promociones de la semana» de la landing (#promociones, 2026-10-01, pedido de Yonatan): una
// tira de los afiches oficiales de cada día con desplazamiento animado y suave.
//
// Dos partes:
//   1. ESTÁTICA (corre siempre, también en CI, que no tiene navegador): la sección existe y está
//      en su lugar (después del hero, antes de #platos) con su enlace en la nav; los 8 afiches
//      (el resumen de la semana + lunes a domingo, en ese orden) con su <picture> (webp con ≥ 2
//      anchos y jpg de respaldo con ≥ 2 anchos, srcset + sizes, width/height, lazy, alt idéntico
//      al de assets/img/promos/promos.json y fiel a lo que dice cada afiche); el enlace «Ver en la
//      carta» a carta.html#promociones; JS propio y corto sin CDN; el CSS con scroll-snap; y el
//      cálculo del día de HOY en Bogotá (lo que decide qué afiche se marca «Hoy»).
//   2. EN NAVEGADOR (solo si hay Playwright y Chromium, como desborde.test.mjs; si no, se salta
//      con el motivo): sin desborde a 320 px; botones de 44 px; el afiche de hoy marcado y a la
//      vista; el avance automático avanza, se PAUSA al pasar el mouse, al enfocar con el teclado,
//      al tocar, con la pestaña oculta y con el botón de pausa; con prefers-reduced-motion no hay
//      movimiento automático; anterior/siguiente dan la vuelta; los afiches se piden uno antes.
//      Nunca se toca Supabase (cualquier pedido a *.supabase.co se contesta vacío). Para no esperar
//      5 s por afiche, las pruebas de movimiento ponen data-promos-intervalo (ms) en la sección.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const PROMOS = JSON.parse(leer('assets/img/promos/promos.json'));
const HTML = leer('index.html');

const ORDEN = ['promo-semana', 'promo-lunes', 'promo-martes', 'promo-miercoles', 'promo-jueves', 'promo-viernes', 'promo-sabado', 'promo-domingo'];
const NOMBRES = ['Toda la semana', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ───────────────────────── 1. estática ─────────────────────────

/** El interior de <section id="promociones">…</section> (esta landing no anida secciones). */
function seccion() {
  const i = HTML.search(/<section\b[^>]*\bid="promociones"/);
  assert.ok(i !== -1, 'no encontré <section id="promociones"> en index.html');
  const resto = HTML.slice(i);
  return resto.slice(0, resto.indexOf('</section>') + '</section>'.length);
}

function atributos(texto) {
  const a = {};
  for (const m of texto.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"|\s([a-zA-Z][\w:-]*)(?=[\s/>]|$)/g)) {
    if (m[1] !== undefined) a[m[1].toLowerCase()] = m[2];
    else if (m[3] !== undefined) a[m[3].toLowerCase()] = true;
  }
  return a;
}

/** Cada afiche (div.promo-diapo) con su <picture>: la <source>, la <img> y sus atributos. */
function afiches() {
  const cuerpo = seccion();
  const salida = [];
  for (const m of cuerpo.matchAll(/<div\s+class="promo-diapo"([^>]*)>([\s\S]*?)<\/figure>\s*<\/div>/g)) {
    const interior = m[2];
    const source = interior.match(/<source\b([^>]*)\/?>/);
    const img = interior.match(/<img\b([^>]*)\/?>/);
    salida.push({
      diapo: atributos(m[1]),
      source: source ? atributos(source[1]) : null,
      img: img ? atributos(img[1]) : null,
      pie: (interior.match(/<figcaption[^>]*>\s*<span class="eyebrow">([^<]*)<\/span>/) || [, ''])[1].trim(),
      interior,
    });
  }
  return salida;
}
const rutasDe = (srcset) => String(srcset || '').split(',').map((p) => p.trim().split(/\s+/)).filter((p) => p[0]);

test('la landing tiene la sección #promociones, entre el hero (#inicio) y #platos, con su H2 y su enlace en la nav', () => {
  const cuerpo = seccion();
  assert.match(cuerpo, /<h2[^>]*id="promos-titulo"[^>]*>Promociones de la semana<\/h2>/);
  assert.match(cuerpo, /aria-labelledby="promos-titulo"/);
  assert.match(cuerpo, /\bdata-promos\b/);
  const posicion = (id) => HTML.search(new RegExp(`<section\\b[^>]*\\bid="${id}"`));
  assert.ok(posicion('inicio') < posicion('promociones') && posicion('promociones') < posicion('platos'), 'orden: #inicio, #promociones, … #platos');
  // La nav (escritorio) y el menú móvil enlazan a la sección.
  assert.equal((HTML.match(/<a href="#promociones"[^>]*>Promociones<\/a>/g) || []).length, 2, 'el enlace «Promociones» va en la nav de escritorio y en el menú móvil');
});

test('H2 de ≤ 6 palabras y sin itálica ni emojis en la sección (docs/identidad-visual.md §4 y §5)', () => {
  const cuerpo = sinComentarios(seccion());
  assert.ok('Promociones de la semana'.split(' ').length <= 6);
  assert.doesNotMatch(cuerpo, /<em\b|\bitalic\b|font-style/);
  assert.doesNotMatch(cuerpo, /\p{Extended_Pictographic}/u, 'sin emojis');
});

test('hay 8 afiches en orden (resumen de la semana, lunes … domingo), con día (1 = lunes … 7 = domingo) en los de cada día', () => {
  const lista = afiches();
  assert.equal(lista.length, 8);
  lista.forEach((a, i) => {
    assert.match(a.diapo['aria-label'], new RegExp(`^${NOMBRES[i]}, ${i + 1} de 8$`), `afiche ${i + 1}: aria-label`);
    assert.equal(a.diapo.role, 'group');
    assert.equal(a.diapo['aria-roledescription'], 'diapositiva');
    assert.ok(a.diapo['data-promos-diapo'] !== undefined);
    assert.equal(a.diapo['data-dia'], i === 0 ? undefined : String(i), `afiche ${i + 1}: data-dia`);
    // El pie de foto dice el día; los de cada día llevan además la marca «Hoy», escondida hasta que promos.js la muestra.
    assert.equal(a.pie, NOMBRES[i], `afiche ${i + 1}: pie de foto`);
    assert.equal(/data-promos-hoy[^>]*\bhidden\b/.test(a.interior), i !== 0, `afiche ${i + 1}: la marca «Hoy» solo en los de cada día, escondida de entrada`);
  });
  assert.deepEqual(PROMOS.map((p) => p.id), ORDEN, 'promos.json lleva los mismos 8 en el mismo orden');
  assert.deepEqual(PROMOS.map((p) => p.dia), [null, 1, 2, 3, 4, 5, 6, 7]);
});

test('cada afiche: <picture> con webp (≥ 2 anchos) y jpg de respaldo (≥ 2 anchos), srcset + sizes, width/height, lazy, alt idéntico a promos.json; las rutas son las del manifiesto', () => {
  const lista = afiches();
  const fallas = [];
  lista.forEach((a, i) => {
    const p = PROMOS[i];
    const etiqueta = `${p.id}`;
    if (!a.source || a.source.type !== 'image/webp') return fallas.push(`${etiqueta}: falta <source type="image/webp">`);
    const webp = rutasDe(a.source.srcset);
    const jpg = rutasDe(a.img.srcset);
    if (webp.length < 2) fallas.push(`${etiqueta}: el webp trae ${webp.length} ancho(s)`);
    if (jpg.length < 2) fallas.push(`${etiqueta}: el jpg trae ${jpg.length} ancho(s)`);
    const del = (formato) => p.variantes.filter((v) => v.formato === formato).map((v) => [v.ruta, `${v.ancho}w`]);
    if (JSON.stringify(webp) !== JSON.stringify(del('webp'))) fallas.push(`${etiqueta}: el srcset webp no es el de promos.json`);
    if (JSON.stringify(jpg) !== JSON.stringify(del('jpg'))) fallas.push(`${etiqueta}: el srcset jpg no es el de promos.json`);
    if (!/^assets\/img\/promos\/promo-[a-z]+-720\.jpg$/.test(a.img.src || '') || !jpg.some(([r]) => r === a.img.src)) fallas.push(`${etiqueta}: el src de la <img> debería ser el jpg de 720 (${a.img.src})`);
    if (!a.source.sizes || !a.img.sizes) fallas.push(`${etiqueta}: falta sizes`);
    if (a.source.sizes !== a.img.sizes) fallas.push(`${etiqueta}: la <source> y la <img> tienen sizes distintos`);
    if (a.img.width !== '1080' || a.img.height !== '1350') fallas.push(`${etiqueta}: width/height deberían ser 1080/1350 (${a.img.width}×${a.img.height})`);
    if (a.img.loading !== 'lazy' || a.img.decoding !== 'async') fallas.push(`${etiqueta}: loading="${a.img.loading}" decoding="${a.img.decoding}" (lazy + async: la tira nace en el afiche de hoy, no en el hero)`);
    if (a.img.fetchpriority) fallas.push(`${etiqueta}: fetchpriority solo lo lleva el hero`);
    if (a.img.alt !== p.alt) fallas.push(`${etiqueta}: el alt no es idéntico al de promos.json`);
  });
  assert.deepEqual(fallas, []);
});

test('los sizes dicen lo que el CSS hace (un afiche con asomo del siguiente en móvil, dos desde 640 px, tres desde 1024 px)', () => {
  const [{ img }] = afiches();
  assert.equal(img.sizes, '(min-width: 1024px) 357px, (min-width: 640px) 46vw, calc(100vw - 4.5rem)');
  const css = leer('assets/css/landing.css');
  assert.match(css, /\.promo-diapo\s*\{[^}]*flex:\s*0 0 calc\(100% - 2\.5rem\)/);
  assert.match(css, /\.promo-diapo\s*\{\s*flex-basis:\s*calc\(\(100% - 1rem\) \/ 2\)/);
  assert.match(css, /\.promo-diapo\s*\{\s*flex-basis:\s*calc\(\(100% - 2rem\) \/ 3\)/);
});

// El alt dice lo que dice el afiche: día, promoción y precio o descuento (texto de los afiches de
// ~/Developer/resplandor/marketing/, mirados uno por uno el 2026-10-01).
const HECHOS = {
  'promo-lunes': [/lunes/i, /3er almuerzo/i, /20%/, /tercero/i],
  'promo-martes': [/martes/i, /combo de hamburguesas/i, /50\.000 pesos/, /Hamburguesas Resplandor/, /papas/i, /gaseosa/i],
  'promo-miercoles': [/miércoles/i, /cócteles, jugos y sodas/i, /2 x 1/, /sodas saborizadas/i],
  'promo-jueves': [/jueves/i, /dupleta de papas/i, /39\.000 pesos/, /Papas Resplandor/],
  'promo-viernes': [/viernes/i, /Fin de semana como se debe/, /160\.000 pesos/, /Picada Resplandor/, /Cantarito/, /4 a 6 personas/],
  'promo-sabado': [/sábado/i, /entradas de la carta/i, /2 x 1/],
  'promo-domingo': [/domingo/i, /almuerzos en familia/i, /20\.000 pesos/, /no cocinar en casa/i],
  'promo-semana': [/7:00 a\.m\./, /11:00 a\.m\./, /20%/, /50\.000/, /2 x 1/, /39\.000/, /160\.000/, /20\.000/, /Domicilios en todo el sur/],
};
test('el alt de cada afiche es fiel a lo que dice (día, promoción, precio o descuento); el precio va en palabras («50.000 pesos»), nunca «$» + dígito', () => {
  const fallas = [];
  for (const p of PROMOS) {
    for (const re of HECHOS[p.id]) if (!re.test(p.alt)) fallas.push(`${p.id}: el alt no dice ${re}`);
    if (/\$\s?\d/.test(p.alt)) fallas.push(`${p.id}: «$» + dígito en el alt (reglas.test.mjs lo prohíbe en todo el sitio)`);
    if (p.alt.length > 700) fallas.push(`${p.id}: alt de ${p.alt.length} caracteres`);
  }
  assert.deepEqual(fallas, []);
});

test('«Ver en la carta» enlaza a carta.html#promociones; los controles nacen escondidos (sin JS no hacen nada) y tienen nombre accesible', () => {
  const cuerpo = seccion();
  assert.match(cuerpo, /<a href="carta\.html#promociones"[^>]*>\s*Ver en la carta/);
  const controles = cuerpo.match(/<div[^>]*data-promos-controles[^>]*>/)[0];
  assert.match(controles, /\bhidden\b/);
  for (const accion of ['anterior', 'pausa', 'siguiente']) {
    const b = cuerpo.match(new RegExp(`<button[^>]*data-promos-accion="${accion}"[^>]*>`));
    assert.ok(b, `falta el botón ${accion}`);
    assert.match(b[0], /aria-label="[^"]+"/, `${accion}: sin aria-label`);
    assert.match(b[0], /type="button"/);
    assert.match(b[0], /class="btn-icon"/, `${accion}: .btn-icon mide 2.75rem = 44 px`);
  }
  // El ícono de «reanudar» solo existe en tiempo de ejecución: lo declara el comentario de iconos-extra.
  assert.match(cuerpo, /<!-- iconos-extra: play -->/);
  assert.match(cuerpo, /#i-pause/);
  assert.match(cuerpo, /#i-chevron-left/);
});

test('la tira es una región con nombre, de carrusel, enfocable con el teclado, y no aparece con data-aparecer (el carrusel se mide y se mueve desde el primer momento)', () => {
  const cuerpo = seccion();
  const pista = cuerpo.match(/<div class="promos-pista"[^>]*>/)[0];
  assert.match(pista, /role="region"/);
  assert.match(pista, /aria-roledescription="carrusel"/);
  assert.match(pista, /aria-label="[^"]+"/);
  assert.match(pista, /tabindex="0"/);
  const iPista = cuerpo.indexOf('class="promos-pista"');
  assert.ok(!/data-aparecer/.test(cuerpo.slice(iPista)), 'data-aparecer solo en el encabezado, no en la tira');
});

test('assets/js/promos.js: JS propio sin red ni librerías; se carga con defer desde index.html; respeta prefers-reduced-motion y se pausa por mouse, foco, toque, pestaña oculta y botón', () => {
  const js = sinComentarios(leer('assets/js/promos.js'));
  assert.doesNotMatch(js, /https?:\/\//, 'sin URLs');
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|import\(|\brequire\(|\bAlpine\b|\blocalStorage\b/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  for (const evento of ['mouseenter', 'mouseleave', 'focusin', 'focusout', 'touchstart', 'touchend', 'visibilitychange']) {
    assert.ok(js.includes(`'${evento}'`), `no escucha ${evento}`);
  }
  assert.match(js, /IntersectionObserver/);
  assert.ok(leer('assets/js/promos.js').split('\n').length <= 260, 'JS propio y corto');
  assert.match(HTML, /<script defer src="assets\/js\/promos\.js"><\/script>/);
  // Sin CDN nuevos: el único script externo de la landing sigue siendo Alpine.
  const externos = [...HTML.matchAll(/<script[^>]*\bsrc="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(externos, ['https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js']);
});

test('landing.css: la tira usa scroll-snap, sin gradientes ni hex ni sombras nuevas; el anillo de «Hoy» es barro; cada afiche reserva su alto (content-visibility sin saltos)', () => {
  const css = sinComentarios(leer('assets/css/landing.css'));
  const bloque = css.slice(css.indexOf('.promos-pista'));
  assert.match(bloque, /scroll-snap-type:\s*x mandatory/);
  assert.match(bloque, /container-type:\s*inline-size/);
  assert.match(bloque, /content-visibility:\s*auto/);
  assert.equal((bloque.match(/contain-intrinsic-block-size:\s*auto calc\(/g) || []).length, 3, 'el alto reservado se calcula en los tres anchos (móvil, sm, lg)');
  assert.match(bloque, /scroll-snap-align:\s*start/);
  assert.match(bloque, /overflow-x:\s*auto/);
  assert.doesNotMatch(bloque, /#[0-9a-fA-F]{3,8}\b|rgba?\(|gradient\(/);
  assert.match(bloque, /\.promo-diapo\.es-hoy img\s*\{[^}]*var\(--color-barro\)/);
  assert.match(leer('assets/css/resplandor.css'), /\.promos-pista/, 'resplandor.css compilado lleva la tira (corre node scripts/css.mjs)');
});

// El día de HOY en Bogotá (UTC−5 fijo, sin horario de verano): decide qué afiche lleva «Hoy».
test('diaDeHoy: el día de Bogotá (1 = lunes … 7 = domingo), sin depender de la zona del equipo ni de Intl', () => {
  const { diaDeHoy } = createRequire(import.meta.url)(path.join(RAIZ, 'assets/js/promos.js'));
  const bogota = (iso) => diaDeHoy(Date.parse(iso));
  assert.equal(bogota('2026-10-01T12:00:00-05:00'), 4, 'jueves 1 de octubre de 2026 a mediodía');
  assert.equal(bogota('2026-10-01T04:59:59Z'), 3, 'miércoles 23:59:59 en Bogotá (todavía no es jueves)');
  assert.equal(bogota('2026-10-01T05:00:00Z'), 4, 'jueves 00:00:00 en Bogotá');
  assert.equal(bogota('2026-10-05T04:59:59Z'), 7, 'domingo 23:59:59 en Bogotá');
  assert.equal(bogota('2026-10-05T05:00:00Z'), 1, 'lunes 00:00:00 en Bogotá');
  assert.equal(bogota('2026-10-03T23:00:00-05:00'), 6, 'sábado 11 p. m.');
  const lunes = Date.parse('2026-10-05T12:00:00-05:00');
  for (let d = 0; d < 7; d++) assert.equal(diaDeHoy(lunes + d * 86400000), d + 1, `día ${d + 1} de la semana`);
});

test('el peso de las imágenes nuevas está acotado: ningún webp de 960 pasa de 150 KB, ninguno de 720 de 80 KB, ninguno de 480 de 40 KB, ningún jpg de 720 de 110 KB', () => {
  const tope = { 'webp-960': 150, 'webp-720': 80, 'webp-480': 40, 'jpg-720': 110, 'jpg-480': 60 };
  const fallas = [];
  for (const p of PROMOS) {
    for (const v of p.variantes) {
      const t = tope[`${v.formato}-${v.ancho}`];
      if (!t) fallas.push(`${v.ruta}: ancho/formato sin tope definido`);
      else if (v.bytes > t * 1024) fallas.push(`${v.ruta}: ${(v.bytes / 1024).toFixed(0)} KB (tope ${t} KB)`);
    }
  }
  assert.deepEqual(fallas, []);
});

// ───────────────────────── 2. en navegador ─────────────────────────

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
const skip = () => (navegador ? false : `navegador no disponible: ${motivoNavegador}`);
const INTERVALO_PRUEBA = 350; // ms entre afiches en las pruebas de movimiento

/**
 * Abre la landing en una página nueva, con Supabase cortado y la fecha en `ahora`. El reloj corre desde ahí
 * (un desfase constante sobre Date: no una hora congelada, porque promos.js mide cuánto hace que la persona
 * tocó la tira) y los temporizadores son los reales.
 */
async function abrir({ ancho = 1280, alto = 900, ahora = '2026-10-01T12:00:00-05:00', reducido = false, tactil = false, intervalo = null } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: alto },
    reducedMotion: reducido ? 'reduce' : 'no-preference',
    hasTouch: tactil,
  });
  const page = await contexto.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push(`console.error: ${m.text()}`); });
  await page.route(/\.supabase\.co\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.addInitScript((alvo) => {
    const Real = Date;
    const desfase = alvo - Real.now();
    globalThis.Date = class extends Real {
      constructor(...a) { if (a.length === 0) super(Real.now() + desfase); else super(...a); }
      static now() { return Real.now() + desfase; }
    };
  }, new Date(ahora).getTime());
  await page.goto(`http://127.0.0.1:${servidor.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-promos-listo]');
  // Antes de que la sección entre a la pantalla (el avance automático arma su primer temporizador al verse).
  if (intervalo) await page.evaluate((v) => document.querySelector('[data-promos]').setAttribute('data-promos-intervalo', String(v)), intervalo);
  return { contexto, page, errores };
}
const scrollLeft = (page) => page.evaluate(() => document.querySelector('[data-promos-pista]').scrollLeft);
const paso = (page) => page.evaluate(() => { const d = document.querySelectorAll('[data-promos-diapo]'); return d[1].offsetLeft - d[0].offsetLeft; });
/** Espera a que el scroll deje de moverse (animación suave terminada). */
async function quieto(page) {
  let anterior = -1;
  for (let i = 0; i < 40; i++) {
    const ahora = await scrollLeft(page);
    if (ahora === anterior) return ahora;
    anterior = ahora;
    await page.waitForTimeout(60);
  }
  return anterior;
}
/** Cambia «reducir movimiento» y deja que la página dibuje: un Chromium sin ventana solo avisa del cambio de media al renderizar. */
async function emular(page, valor) {
  await page.emulateMedia({ reducedMotion: valor });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
const sacarElMouse = (page) => page.mouse.move(2, 2); // arriba a la izquierda, fuera de la zona del carrusel

test('en navegador a 320×640: sin scroll lateral, la tira cabe, los tres botones miden ≥ 44 px, los afiches se ven y no hay errores', { skip: skip() }, async () => {
  const { contexto, page, errores } = await abrir({ ancho: 320, alto: 640 });
  try {
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    const r = await page.evaluate(() => {
      const d = document.documentElement;
      const pista = document.querySelector('[data-promos-pista]').getBoundingClientRect();
      const botones = [...document.querySelectorAll('[data-promos-accion]')].map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.promosAccion, Math.round(r.width), Math.round(r.height), b.hidden || getComputedStyle(b).display === 'none']; });
      const hoy = document.querySelector('.es-hoy img').getBoundingClientRect();
      return { desborde: d.scrollWidth - d.clientWidth, pistaIzq: pista.left, pistaDer: pista.right, ancho: window.innerWidth, botones, hoyIzq: hoy.left, hoyDer: hoy.right };
    });
    assert.equal(r.desborde, 0, `scrollWidth − clientWidth = ${r.desborde} px a 320 px`);
    assert.ok(r.pistaIzq >= -0.5 && r.pistaDer <= r.ancho + 0.5, 'la tira a sangre cabe en la pantalla');
    for (const [accion, w, h, escondido] of r.botones) {
      assert.equal(escondido, false, `${accion} visible con JS`);
      assert.ok(w >= 44 && h >= 44, `${accion}: ${w}×${h} (mínimo 44×44)`);
    }
    assert.ok(r.hoyIzq >= 0 && r.hoyDer <= r.ancho, `el afiche de hoy está entero a la vista (${r.hoyIzq.toFixed(0)}…${r.hoyDer.toFixed(0)} de ${r.ancho})`);
    assert.deepEqual(errores, []);
  } finally {
    await contexto.close();
  }
});

test('en navegador: con la página recién cargada NO se pide ningún afiche (la sección está bajo el pliegue); se piden al acercarse', { skip: skip() }, async () => {
  // Sin content-visibility, Chrome carga todos los afiches lazy de una tira horizontal que caigan en su umbral (medido el
  // 2026-10-01: los 8, 734 KB a 3x, con la sección fuera de la pantalla). content-visibility: auto en .promo-diapo lo evita.
  const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  try {
    const page = await contexto.newPage();
    const pedidos = [];
    page.on('request', (r) => { if (r.url().includes('/assets/img/promos/')) pedidos.push(r.url().split('/').pop()); });
    await page.route(/\.supabase\.co\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
    await page.goto(`http://127.0.0.1:${servidor.address().port}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('[data-promos-listo]');
    await page.waitForTimeout(1200);
    assert.deepEqual(pedidos, [], 'con la página recién cargada no debería pedirse ningún afiche');
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.es-hoy img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 });
    assert.ok(pedidos.length >= 1 && pedidos.length <= 7, `al acercarse se piden los cercanos, no todos de golpe a ciegas: ${pedidos.join(', ')}`);
    assert.ok(pedidos.some((p) => /-960\.webp$/.test(p)), 'a 390 px a 3x se pide la variante de 960 px');
  } finally {
    await contexto.close();
  }
});

test('en navegador: el afiche de HOY (hora de Bogotá) lleva «Hoy», aria-current y es donde nace la tira; los demás no', { skip: skip() }, async () => {
  // jueves a mediodía, y la noche del miércoles en Bogotá que ya es jueves en UTC (04:30 UTC = 23:30 del miércoles).
  for (const [ahora, esperado, indice] of [['2026-10-01T12:00:00-05:00', 'Jueves', 4], ['2026-10-01T04:30:00Z', 'Miércoles', 3], ['2026-10-04T12:00:00-05:00', 'Domingo', 7], ['2026-10-05T12:00:00-05:00', 'Lunes', 1]]) {
    const { contexto, page, errores } = await abrir({ ahora });
    try {
      const r = await page.evaluate(() => ({
        marcados: [...document.querySelectorAll('.es-hoy')].map((d) => d.getAttribute('aria-label')),
        corrientes: [...document.querySelectorAll('[aria-current="date"]')].map((d) => d.getAttribute('aria-label')),
        visibles: [...document.querySelectorAll('[data-promos-hoy]')].filter((b) => !b.hidden).map((b) => b.closest('[data-promos-diapo]').getAttribute('aria-label')),
      }));
      assert.deepEqual(r.marcados.map((s) => s.split(',')[0]), [esperado], `${ahora}`);
      assert.deepEqual(r.corrientes.map((s) => s.split(',')[0]), [esperado]);
      assert.deepEqual(r.visibles.map((s) => s.split(',')[0]), [esperado]);
      const px = await quieto(page);
      const maximo = await page.evaluate(() => { const p = document.querySelector('[data-promos-pista]'); return p.scrollWidth - p.clientWidth; });
      const esperadoPx = Math.min(indice * (await paso(page)), maximo);
      assert.ok(Math.abs(px - esperadoPx) <= 2, `${esperado}: la tira nace en ${px}, debería nacer en ${esperadoPx}`);
      assert.deepEqual(errores, []);
    } finally {
      await contexto.close();
    }
  }
});

test('en navegador: el avance automático avanza solo, y se PAUSA al pasar el mouse (y sigue al salir)', { skip: skip() }, async () => {
  const { contexto, page } = await abrir({ ahora: '2026-10-05T12:00:00-05:00', intervalo: INTERVALO_PRUEBA }); // lunes: la tira nace en el afiche 2 y hay recorrido
  try {
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    await sacarElMouse(page);
    const inicio = await quieto(page);
    await page.waitForFunction((x) => document.querySelector('[data-promos-pista]').scrollLeft > x + 20, inicio, { timeout: 4000 });
    // el mouse encima: queda quieto
    await page.hover('[data-promos-pista]');
    const parado = await quieto(page);
    await page.waitForTimeout(INTERVALO_PRUEBA * 3);
    assert.equal(await scrollLeft(page), parado, 'con el mouse encima no avanza');
    // el mouse fuera: sigue
    await sacarElMouse(page);
    await page.waitForFunction((x) => document.querySelector('[data-promos-pista]').scrollLeft !== x, parado, { timeout: 4000 });
  } finally {
    await contexto.close();
  }
});

test('en navegador: el foco del teclado dentro del carrusel lo pausa; un clic con el mouse en un botón no lo deja pausado para siempre', { skip: skip() }, async () => {
  const { contexto, page } = await abrir({ ahora: '2026-10-05T12:00:00-05:00', intervalo: INTERVALO_PRUEBA });
  try {
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    await sacarElMouse(page);
    await quieto(page);
    // Desde el título de la sección, Tab cae en la tira (la región enfocable del carrusel).
    await page.evaluate(() => { const t = document.getElementById('promos-titulo'); t.tabIndex = -1; t.focus(); });
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement.hasAttribute('data-promos-pista')), 'Tab desde el título cae en la tira');
    const parado = await quieto(page);
    await page.waitForTimeout(INTERVALO_PRUEBA * 3);
    assert.equal(await scrollLeft(page), parado, 'con el foco del teclado dentro no avanza');
    // Tab hasta salir de la zona del carrusel (enlace «Ver en la carta» y los tres botones): vuelve a avanzar.
    for (let i = 0; i < 8 && (await page.evaluate(() => document.querySelector('[data-promos-zona]').contains(document.activeElement))); i++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('[data-promos-zona]').contains(document.activeElement)), false, 'el foco salió de la zona');
    // El Tab final lleva el foco a la sección de abajo y la página se desplaza: sin la sección a la vista el avance espera (a propósito).
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    await page.waitForFunction((x) => document.querySelector('[data-promos-pista]').scrollLeft !== x, parado, { timeout: 4000 });
    // Un clic con el mouse en «siguiente» deja el foco en el botón, pero NO detiene el avance una vez que el mouse sale.
    await page.click('[data-promos-accion="siguiente"]');
    await sacarElMouse(page);
    const despues = await quieto(page);
    await page.waitForFunction((x) => document.querySelector('[data-promos-pista]').scrollLeft !== x, despues, { timeout: 4000 });
  } finally {
    await contexto.close();
  }
});

test('en navegador: tocar la tira la pausa (y espera 1,6 intervalos tras soltar); la pestaña oculta también', { skip: skip() }, async () => {
  const { contexto, page } = await abrir({ ahora: '2026-10-05T12:00:00-05:00', tactil: true, intervalo: 500 });
  try {
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    await quieto(page);
    const tocar = (tipo) => page.evaluate((t) => document.querySelector('[data-promos-pista]').dispatchEvent(new Event(t, { bubbles: true })), tipo);
    await tocar('touchstart');
    const parado = await quieto(page);
    await page.waitForTimeout(1600);
    assert.equal(await scrollLeft(page), parado, 'con un dedo encima no avanza');
    await tocar('touchend');
    await page.waitForTimeout(300);
    assert.equal(await scrollLeft(page), parado, 'recién soltado, espera antes de seguir');
    await page.waitForFunction((x) => document.querySelector('[data-promos-pista]').scrollLeft !== x, parado, { timeout: 4000 });
    // pestaña oculta
    await quieto(page);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const congelado = await quieto(page);
    await page.waitForTimeout(1500);
    assert.equal(await scrollLeft(page), congelado, 'con la pestaña oculta no avanza');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction((x) => document.querySelector('[data-promos-pista]').scrollLeft !== x, congelado, { timeout: 4000 });
  } finally {
    await contexto.close();
  }
});

test('en navegador: el botón de pausa detiene y reanuda, y cambia su nombre y su ícono', { skip: skip() }, async () => {
  const { contexto, page } = await abrir({ ahora: '2026-10-05T12:00:00-05:00', intervalo: INTERVALO_PRUEBA });
  try {
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    const boton = page.locator('[data-promos-accion="pausa"]');
    assert.equal(await boton.getAttribute('aria-label'), 'Pausar el desplazamiento automático');
    assert.equal(await page.locator('[data-promos-accion="pausa"] use').getAttribute('href'), '#i-pause');
    await boton.click();
    await sacarElMouse(page);
    assert.equal(await boton.getAttribute('aria-label'), 'Reanudar el desplazamiento automático');
    assert.equal(await page.locator('[data-promos-accion="pausa"] use').getAttribute('href'), '#i-play');
    const parado = await quieto(page);
    await page.waitForTimeout(INTERVALO_PRUEBA * 3);
    assert.equal(await scrollLeft(page), parado, 'en pausa no avanza, aunque el mouse y el foco ya no estén');
    await boton.click();
    await sacarElMouse(page);
    assert.equal(await boton.getAttribute('aria-label'), 'Pausar el desplazamiento automático');
    assert.equal(await page.locator('[data-promos-accion="pausa"] use').getAttribute('href'), '#i-pause');
    await page.waitForFunction((x) => document.querySelector('[data-promos-pista]').scrollLeft !== x, parado, { timeout: 4000 });
  } finally {
    await contexto.close();
  }
});

test('en navegador: anterior y siguiente mueven un afiche y dan la vuelta en los extremos; los afiches de adelante se piden antes de llegar', { skip: skip() }, async () => {
  const { contexto, page } = await abrir({ ahora: '2026-10-05T12:00:00-05:00' }); // lunes: nace en el afiche 2 de 8
  try {
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    await page.click('[data-promos-accion="pausa"]'); // pausado por la persona: solo se mueve con los botones
    await sacarElMouse(page);
    const unPaso = await paso(page);
    const maximo = await page.evaluate(() => { const p = document.querySelector('[data-promos-pista]'); return p.scrollWidth - p.clientWidth; });
    const lunes = await quieto(page);
    assert.ok(Math.abs(lunes - unPaso) <= 2, 'lunes = afiche 2');
    await page.click('[data-promos-accion="siguiente"]');
    assert.ok(Math.abs((await quieto(page)) - 2 * unPaso) <= 2, 'siguiente: un afiche más');
    // Los afiches de adelante se piden antes de llegar: el 3.º y el 4.º ya no son lazy; uno lejano (el 8.º) sí.
    const carga = await page.evaluate(() => [...document.querySelectorAll('[data-promos-diapo] img')].map((i) => i.loading));
    assert.equal(carga[2], 'eager');
    assert.equal(carga[3], 'eager');
    assert.equal(carga[7], 'lazy', `el 8.º sigue lazy: ${carga.join(',')}`);
    await page.click('[data-promos-accion="anterior"]');
    assert.ok(Math.abs((await quieto(page)) - unPaso) <= 2, 'anterior: un afiche menos');
    await page.click('[data-promos-accion="anterior"]');
    assert.ok((await quieto(page)) <= 2, 'anterior: de vuelta al primero');
    await page.click('[data-promos-accion="anterior"]');
    assert.ok(Math.abs((await quieto(page)) - maximo) <= 2, 'anterior desde el primero da la vuelta al último');
    await page.click('[data-promos-accion="siguiente"]');
    assert.ok((await quieto(page)) <= 2, 'siguiente desde el último da la vuelta al primero');
    const rotos = await page.evaluate(() => [...document.querySelectorAll('[data-promos-diapo] img')].filter((i) => i.complete && i.currentSrc && i.naturalWidth === 0).map((i) => i.currentSrc));
    assert.deepEqual(rotos, [], 'ningún afiche roto');
  } finally {
    await contexto.close();
  }
});

test('en navegador con prefers-reduced-motion: no hay movimiento automático ni suave, el botón de pausa se esconde y los botones mueven la tira de golpe', { skip: skip() }, async () => {
  const { contexto, page, errores } = await abrir({ ahora: '2026-10-05T12:00:00-05:00', reducido: true, intervalo: INTERVALO_PRUEBA });
  try {
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    await sacarElMouse(page);
    await page.locator('[data-promos-accion="anterior"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-promos-accion="pausa"]').isHidden(), true, 'sin movimiento automático no hay nada que pausar');
    const inicio = await quieto(page);
    await page.waitForTimeout(INTERVALO_PRUEBA * 5);
    assert.equal(await scrollLeft(page), inicio, 'no se mueve solo');
    // siguiente: sin animación, en el siguiente cuadro ya está en su sitio
    const unPaso = await paso(page);
    await page.click('[data-promos-accion="siguiente"]');
    const tras = await page.evaluate(() => new Promise((resolver) => requestAnimationFrame(() => requestAnimationFrame(() => resolver(document.querySelector('[data-promos-pista]').scrollLeft)))));
    assert.ok(Math.abs(tras - (inicio + unPaso)) <= 2, `sin scroll suave: ${tras} debería ser ${inicio + unPaso}`);
    assert.deepEqual(errores, []);
  } finally {
    await contexto.close();
  }
});

test('en navegador: cambiar «reducir movimiento» en caliente apaga y enciende el avance automático', { skip: skip() }, async () => {
  const { contexto, page } = await abrir({ ahora: '2026-10-05T12:00:00-05:00', intervalo: INTERVALO_PRUEBA });
  try {
    await page.locator('#promociones').scrollIntoViewIfNeeded();
    await sacarElMouse(page);
    await emular(page, 'reduce');
    await page.waitForFunction(() => document.querySelector('[data-promos-accion="pausa"]').hidden === true);
    const inicio = await quieto(page);
    await page.waitForTimeout(INTERVALO_PRUEBA * 4);
    assert.equal(await scrollLeft(page), inicio, 'con reducir movimiento no avanza');
    await emular(page, 'no-preference');
    await page.waitForFunction(() => document.querySelector('[data-promos-accion="pausa"]').hidden === false);
    await page.waitForFunction((x) => document.querySelector('[data-promos-pista]').scrollLeft !== x, inicio, { timeout: 4000 });
  } finally {
    await contexto.close();
  }
});
