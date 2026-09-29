// Prueba trampa de imágenes (como pedido.test.mjs en lusof): sobre index.html, carta.html
// y menu.html, verifica que toda foto y todo video del sitio salga del banco oficial
// (img/referencias/<categoría>/ + recursos.json) o de la lista blanca de activos que no
// viven en el banco (logo, favicons, og:image), que nunca se sirva un crudo de
// _originales/ ni una pieza de publicidad-*, que los atributos de accesibilidad y carga
// sean los que exige docs/identidad-visual.md v2 (§6, §7, §8), y que recursos.json sea
// coherente con los archivos reales del banco (existen, y pesan lo que dice «bytes»).
//
// Escrita CONTRA EL CONTRATO v2 (docs/identidad-visual.md, vigente desde 2026-09-28), no
// contra el estado actual del sitio: la parte «Landing» todavía está reescribiendo
// index.html en paralelo (carta.html y menu.html ya migraron, §10), así que HOY la
// prueba del hero (`plato-sopa-jugo-estudio`, §7.1) falla porque index.html todavía sirve
// el hero de la v1 (`salon-pared-terracota-letrero`) — es lo esperado hasta que esa parte
// entregue. En cuanto index.html migre, pasa sola. Mismo patrón que
// scripts/pruebas/descubrimiento.test.mjs con el JSON-LD.
//
// Sin paquetes: el HTML se escanea con regex (mismo estilo que el resto del repo, «sin
// paquetes» — ver README/landing-y-agentes.md), no con un parser de DOM. Es deliberadamente
// chico: solo entiende <img>, <picture>, <source> y <video><source>/poster, que es todo lo
// que estas tres páginas usan para mostrar fotos y video.
//
// Hallazgo de refutación (ronda 0), cerrado acá: la comparación de «alt idéntico al de
// recursos.json» miraba solo el `src` del `<img>` — un `srcset` o un `<source media>` que
// sirviera OTRO recurso publicable (de una foto sin relación) pasaba igual, y la persona
// veía una foto con el `alt` de otra. Ahora, además, TODA ruta de un mismo `<img>` (su
// propio `src` y `srcset`) y de cada `<source>` de su `<picture>`, si tiene una, tiene que
// resolver a la MISMA familia — el mismo id de recursos.json, o uno que declare
// `deriva_de` hacia el otro (una y solo una vuelta: hoy ningún recurso deriva de otro que a
// su vez derive de un tercero) — nunca una foto de una familia distinta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => path.join(RAIZ, ...p);

const PAGINAS = ['index.html', 'carta.html', 'menu.html'];

// Activos que se sirven de verdad pero NO viven en el banco img/referencias/ (§11-A3 del
// contrato): el monograma ya publicado, los favicons y la imagen de og:image/twitter:image.
// apple-touch-icon.png y favicon.ico son <link>, no <img>/<source>/<video>, así que ni
// siquiera hace falta escanearlos acá — quedan en la lista por si algún día alguna página
// los sirve como <img> (p. ej. una vista de depuración).
const LISTA_BLANCA = new Set(['img/logo-r.webp', 'img/favicon-32.png', 'img/og-resplandor.jpg', 'favicon.ico', 'apple-touch-icon.png']);

// El único <img> que puede llevar alt="" sin aria-hidden: el monograma (un logo junto al
// nombre de marca en texto — alt="" solo es válido ahí porque el nombre ya está en el
// texto adyacente, patrón WAI estándar). Cualquier OTRA foto decorativa necesita alt=""
// **y** aria-hidden="true" a la vez (criterio del brief, generalizado): sin aria-hidden, un
// alt vacío en una foto de contenido real es un agujero de accesibilidad, no una decisión.
const RUTA_MONOGRAMA = 'img/logo-r.webp';

const RECURSOS = JSON.parse(fs.readFileSync(ruta('img/referencias/recursos.json'), 'utf8'));

// Mapa ruta publicada → { id, alt, publicable, derivaDe } por cada variante Y por el
// poster de video (el poster es una imagen más, servible por su cuenta). Una sola fuente
// para todas las pruebas de abajo: nunca se recorre recursos.json dos veces con criterios
// distintos.
const POR_RUTA = new Map();
for (const r of RECURSOS) {
  for (const v of r.variantes || []) {
    POR_RUTA.set(v.ruta, { id: r.id, alt: r.alt, publicable: r.publicable === true, derivaDe: r.deriva_de || null });
  }
  if (r.poster) POR_RUTA.set(r.poster, { id: r.id, alt: r.alt, publicable: r.publicable === true, derivaDe: r.deriva_de || null });
}

// El id «de familia» de un recurso: su propio id si no deriva de otro, o el id del que
// deriva si lo hace (una sola vuelta: recursos.json no encadena deriva_de más de un
// nivel hoy). Dos rutas son de la MISMA familia cuando este valor coincide — así un
// recorte de arte-dirección (p. ej. la variante «-apaisada» del hero, que deriva del
// original) cuenta como la misma foto que su original, pero una foto sin relación no.
const DERIVA_DE_POR_ID = new Map(RECURSOS.map((r) => [r.id, r.deriva_de || null]));
function familiaDe(id) {
  return DERIVA_DE_POR_ID.get(id) || id;
}

// ───────────────────────── parseo de HTML por regex (sin dependencias) ─────────────────────────

// Todas las etiquetas <nombre ...> del documento, sin importar mayúsculas/minúsculas ni
// que estén repartidas en varias líneas ([^>] SÍ cruza saltos de línea: no es «.», que no
// los cruza sin el flag /s). No distingue <picture>/<video> como contexto: para juntar
// rutas referenciadas no hace falta — ver extraerVideos más abajo para lo que sí necesita
// el contexto (preload/controls/autoplay del <video> en sí).
function extraerTags(html, nombre) {
  const re = new RegExp(`<${nombre}\\b([^>]*)>`, 'gi');
  const salida = [];
  let m;
  while ((m = re.exec(html))) salida.push({ raw: m[0], attrsText: m[1] });
  return salida;
}

// Atributos de una etiqueta: "nombre=\"valor\"", 'nombre=\'valor\'' o un atributo booleano
// suelto (controls, autoplay, playsinline…) → true. Nunca usa el DOM: es texto puro.
function parsearAtributos(attrsText) {
  const attrs = {};
  const re = /([a-zA-Z][a-zA-Z0-9_:-]*)\s*=\s*"([^"]*)"|([a-zA-Z][a-zA-Z0-9_:-]*)\s*=\s*'([^']*)'|([a-zA-Z][a-zA-Z0-9_:-]*)(?=[\s/>]|$)/g;
  let m;
  while ((m = re.exec(attrsText))) {
    if (m[1] !== undefined) attrs[m[1].toLowerCase()] = m[2];
    else if (m[3] !== undefined) attrs[m[3].toLowerCase()] = m[4];
    else if (m[5] !== undefined) attrs[m[5].toLowerCase()] = true;
  }
  return attrs;
}

// Cada <video>…</video> con sus atributos propios y los <source> de ADENTRO (para
// preload/controls/autoplay y para el/los <source src> del video, por separado de los
// <source srcset> de un <picture>).
function extraerVideos(html) {
  const re = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi;
  const salida = [];
  let m;
  while ((m = re.exec(html))) {
    salida.push({ attrs: parsearAtributos(m[1]), fuentes: extraerTags(m[2], 'source').map((t) => parsearAtributos(t.attrsText)) });
  }
  return salida;
}

// Cada <picture>…</picture> con el <img> de adentro (el fallback, con su src/srcset/alt
// propios) y sus <source> (cada uno con su srcset/media). Un <picture> sin <img> adentro
// (marcado roto) se omite: ya lo reporta cualquier otra prueba que espere una <img> ahí.
function extraerPicturas(html) {
  const re = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
  const salida = [];
  let m;
  while ((m = re.exec(html))) {
    const interior = m[1];
    const imgs = extraerTags(interior, 'img').map((t) => parsearAtributos(t.attrsText));
    if (imgs.length === 0) continue;
    salida.push({ img: imgs[imgs.length - 1], fuentes: extraerTags(interior, 'source').map((t) => parsearAtributos(t.attrsText)) });
  }
  return salida;
}

// "ruta1 480w, ruta2 960w" → ["ruta1", "ruta2"]. Sin srcset, arreglo vacío.
function rutasDeSrcset(srcset) {
  if (!srcset) return [];
  return srcset
    .split(',')
    .map((parte) => parte.trim().split(/\s+/)[0])
    .filter(Boolean);
}

const cacheHtml = new Map();
function leerPagina(nombre) {
  if (!cacheHtml.has(nombre)) cacheHtml.set(nombre, fs.readFileSync(ruta(nombre), 'utf8'));
  return cacheHtml.get(nombre);
}

// Toda ruta que UNA página referencia como imagen o video: <img src/srcset>, <source
// srcset|src> (de <picture> o de <video>) y <video poster>. Cada entrada dice de qué
// etiqueta salió y, si es un <img>, sus atributos completos (para las pruebas de alt/
// width/height/loading más abajo).
function referenciasDe(html) {
  const refs = [];
  for (const { attrsText } of extraerTags(html, 'img')) {
    const attrs = parsearAtributos(attrsText);
    const rutas = new Set([attrs.src, ...rutasDeSrcset(attrs.srcset)].filter(Boolean));
    for (const r of rutas) refs.push({ tipo: 'img', ruta: r, attrs });
  }
  for (const { attrsText } of extraerTags(html, 'source')) {
    const attrs = parsearAtributos(attrsText);
    const rutas = new Set([attrs.src, ...rutasDeSrcset(attrs.srcset)].filter(Boolean));
    for (const r of rutas) refs.push({ tipo: 'source', ruta: r, attrs });
  }
  for (const video of extraerVideos(html)) {
    if (video.attrs.poster) refs.push({ tipo: 'video-poster', ruta: video.attrs.poster, attrs: video.attrs });
    for (const fuente of video.fuentes) {
      if (fuente.src) refs.push({ tipo: 'video-source', ruta: fuente.src, attrs: video.attrs });
    }
  }
  return refs;
}

// ───────────────────────── recursos.json: coherente consigo mismo y con el disco ─────────────────────────

test('recursos.json: toda variante publicable existe en disco y pesa lo que dice «bytes»', () => {
  const fallas = [];
  for (const r of RECURSOS) {
    if (r.publicable !== true) continue;
    for (const v of r.variantes || []) {
      const abs = ruta(v.ruta);
      if (!fs.existsSync(abs)) {
        fallas.push(`${r.id}: no existe ${v.ruta}`);
        continue;
      }
      const bytesReales = fs.statSync(abs).size;
      if (bytesReales !== v.bytes) fallas.push(`${r.id}: ${v.ruta} pesa ${bytesReales} B, recursos.json dice ${v.bytes} B`);
    }
    if (r.poster && !fs.existsSync(ruta(r.poster))) fallas.push(`${r.id}: no existe el poster ${r.poster}`);
  }
  assert.deepEqual(fallas, []);
});

test('recursos.json: ninguna entrada publicable tiene 0 variantes, y ninguna NO publicable tiene alguna', () => {
  const fallas = [];
  for (const r of RECURSOS) {
    if (r.publicable === true && (r.variantes || []).length === 0) fallas.push(`${r.id}: publicable:true sin variantes`);
    if (r.publicable !== true && (r.variantes || []).length > 0) fallas.push(`${r.id}: publicable:false con variantes (nunca debería servirse)`);
  }
  assert.deepEqual(fallas, []);
});

test('recursos.json: ninguna ruta de variante o poster apunta a _originales/ ni a publicidad-', () => {
  const fallas = [];
  for (const r of RECURSOS) {
    for (const v of r.variantes || []) {
      if (/_originales/.test(v.ruta)) fallas.push(`${r.id}: variante en _originales (${v.ruta})`);
      if (/publicidad-/.test(v.ruta)) fallas.push(`${r.id}: variante de publicidad- publicada (${v.ruta})`);
    }
    if (r.poster && /_originales/.test(r.poster)) fallas.push(`${r.id}: poster en _originales (${r.poster})`);
  }
  assert.deepEqual(fallas, []);
});

test('recursos.json: cada id es único y cada entrada tiene un alt no vacío', () => {
  const vistos = new Set();
  const repetidos = [];
  const sinAlt = [];
  for (const r of RECURSOS) {
    if (vistos.has(r.id)) repetidos.push(r.id);
    vistos.add(r.id);
    if (!r.alt || !r.alt.trim()) sinAlt.push(r.id);
  }
  assert.deepEqual(repetidos, [], 'ids repetidos en recursos.json');
  assert.deepEqual(sinAlt, [], 'entradas sin alt en recursos.json');
});

// ───────────────────────── index.html / carta.html / menu.html contra el banco ─────────────────────────

for (const pagina of PAGINAS) {
  test(`${pagina}: toda ruta de <img>/<source>/<video> existe en disco, sin _originales ni publicidad-, y está en recursos.json o en la lista blanca`, () => {
    const html = leerPagina(pagina);
    const fallas = [];
    for (const { tipo, ruta: r } of referenciasDe(html)) {
      if (/_originales/.test(r)) {
        fallas.push(`${tipo} ${r}: referencia _originales/ (prohibido: nunca se sirve un crudo)`);
        continue;
      }
      if (/publicidad-/.test(r)) {
        fallas.push(`${tipo} ${r}: referencia una pieza de publicidad- (nunca se publica)`);
        continue;
      }
      if (!fs.existsSync(ruta(r))) {
        fallas.push(`${tipo} ${r}: el archivo no existe en el repo`);
        continue;
      }
      const esDelBanco = r.startsWith('img/referencias/');
      if (esDelBanco) {
        const entrada = POR_RUTA.get(r);
        if (!entrada) fallas.push(`${tipo} ${r}: no está en recursos.json (o no es la ruta exacta de ninguna variante/poster)`);
        else if (!entrada.publicable) fallas.push(`${tipo} ${r}: su entrada en recursos.json tiene publicable:false`);
      } else if (!LISTA_BLANCA.has(r)) {
        fallas.push(`${tipo} ${r}: no es del banco (img/referencias/) ni está en la lista blanca (${[...LISTA_BLANCA].join(', ')})`);
      }
    }
    assert.deepEqual(fallas, []);
  });

  test(`${pagina}: toda <img> tiene width, height y alt; alt="" solo en el monograma o con aria-hidden="true"`, () => {
    const html = leerPagina(pagina);
    const fallas = [];
    for (const { attrsText } of extraerTags(html, 'img')) {
      const a = parsearAtributos(attrsText);
      const etiqueta = a.src || '(sin src)';
      if (!a.width) fallas.push(`<img ${etiqueta}>: sin width`);
      if (!a.height) fallas.push(`<img ${etiqueta}>: sin height`);
      if (a.alt === undefined) {
        fallas.push(`<img ${etiqueta}>: sin alt`);
      } else if (a.alt === '') {
        const esMonograma = a.src === RUTA_MONOGRAMA;
        const esDecorativaMarcada = a['aria-hidden'] === 'true' || a['aria-hidden'] === true;
        if (!esMonograma && !esDecorativaMarcada) {
          fallas.push(`<img ${etiqueta}>: alt="" sin aria-hidden="true" (y no es el monograma) — o se marca decorativa o lleva alt real`);
        }
      }
    }
    assert.deepEqual(fallas, []);
  });

  test(`${pagina}: el alt de toda <img> de img/referencias/ es idéntico al de recursos.json`, () => {
    const html = leerPagina(pagina);
    const fallas = [];
    for (const { attrsText } of extraerTags(html, 'img')) {
      const a = parsearAtributos(attrsText);
      if (!a.src || !a.src.startsWith('img/referencias/')) continue;
      const entrada = POR_RUTA.get(a.src);
      if (!entrada) continue; // ya lo reporta la prueba de rutas, de arriba
      if (a.alt !== entrada.alt) {
        fallas.push(`<img src="${a.src}">: alt="${a.alt}" no coincide con recursos.json ("${entrada.alt}")`);
      }
    }
    assert.deepEqual(fallas, []);
  });

  test(`${pagina}: toda foto de img/referencias/ es loading="lazy" decoding="async" (la excepción del hero se prueba aparte, solo en index.html)`, () => {
    const html = leerPagina(pagina);
    const fallas = [];
    for (const { attrsText } of extraerTags(html, 'img')) {
      const a = parsearAtributos(attrsText);
      if (!a.src || !a.src.startsWith('img/referencias/')) continue;
      if (a.fetchpriority === 'high') continue; // el hero de index.html: sin lazy, a propósito
      if (a.loading !== 'lazy') fallas.push(`<img src="${a.src}">: loading="${a.loading}" (debería ser "lazy")`);
      if (a.decoding !== 'async') fallas.push(`<img src="${a.src}">: decoding="${a.decoding}" (debería ser "async")`);
    }
    assert.deepEqual(fallas, []);
  });

  test(`${pagina}: ningún <video> tiene autoplay ni loop; todo <video> tiene preload="none" y controls`, () => {
    const html = leerPagina(pagina);
    const fallas = [];
    for (const video of extraerVideos(html)) {
      const etiqueta = video.attrs.poster || video.fuentes[0]?.src || '(sin poster ni fuente)';
      if (video.attrs.autoplay) fallas.push(`<video ${etiqueta}>: tiene autoplay (prohibido — la persona hace play)`);
      // Hallazgo de refutación (ronda 0): la prueba de video solo miraba autoplay/preload/
      // controls; el contrato (§6) también prohíbe `loop` («sin nada en bucle») y nada lo
      // vigilaba — un mutante que le agregara `loop` al <video> pasaba de largo.
      if (video.attrs.loop) fallas.push(`<video ${etiqueta}>: tiene loop (prohibido — nada se reproduce en bucle)`);
      if (video.attrs.preload !== 'none') fallas.push(`<video ${etiqueta}>: preload="${video.attrs.preload}" (debería ser "none")`);
      if (!video.attrs.controls) fallas.push(`<video ${etiqueta}>: sin controls`);
    }
    assert.deepEqual(fallas, []);
  });

  test(`${pagina}: toda ruta de un mismo <img> (src + srcset) es de la misma familia (mismo id, o uno con deriva_de hacia el otro)`, () => {
    const html = leerPagina(pagina);
    const fallas = [];
    for (const { attrsText } of extraerTags(html, 'img')) {
      const a = parsearAtributos(attrsText);
      if (!a.src || !a.src.startsWith('img/referencias/')) continue;
      const ancla = POR_RUTA.get(a.src);
      if (!ancla) continue; // ya lo reporta la prueba de rutas, de arriba
      const familiaAncla = familiaDe(ancla.id);
      for (const ruta of rutasDeSrcset(a.srcset)) {
        if (!ruta.startsWith('img/referencias/')) continue;
        const entrada = POR_RUTA.get(ruta);
        if (!entrada) continue; // ya lo reporta la prueba de rutas, de arriba
        if (familiaDe(entrada.id) !== familiaAncla) {
          fallas.push(`<img src="${a.src}"> (id ${ancla.id}): su srcset sirve "${ruta}" (id ${entrada.id}), de otra familia — el alt de la <img> ("${ancla.alt}") no describiría esa foto`);
        }
      }
    }
    assert.deepEqual(fallas, []);
  });

  test(`${pagina}: dentro de un mismo <picture>, la <img> y cada <source srcset> son de la misma familia que la <img>`, () => {
    const html = leerPagina(pagina);
    const fallas = [];
    for (const { img, fuentes } of extraerPicturas(html)) {
      if (!img.src || !img.src.startsWith('img/referencias/')) continue;
      const ancla = POR_RUTA.get(img.src);
      if (!ancla) continue; // ya lo reporta la prueba de rutas, de arriba
      const familiaAncla = familiaDe(ancla.id);
      const rutasDelGrupo = [...rutasDeSrcset(img.srcset), ...fuentes.flatMap((f) => rutasDeSrcset(f.srcset))];
      for (const ruta of rutasDelGrupo) {
        if (!ruta.startsWith('img/referencias/')) continue;
        const entrada = POR_RUTA.get(ruta);
        if (!entrada) continue; // ya lo reporta la prueba de rutas, de arriba
        if (familiaDe(entrada.id) !== familiaAncla) {
          fallas.push(`<picture> con <img src="${img.src}"> (id ${ancla.id}, alt "${ancla.alt}"): una de sus fuentes sirve "${ruta}" (id ${entrada.id}), de otra familia — a ese ancho la persona vería otra foto con el alt de esta`);
        }
      }
    }
    assert.deepEqual(fallas, []);
  });

  test(`${pagina}: el aria-label de un <video> del banco coincide con el alt de recursos.json`, () => {
    const html = leerPagina(pagina);
    const fallas = [];
    for (const video of extraerVideos(html)) {
      const rutaVideo = video.attrs.poster || video.fuentes[0]?.src;
      if (!rutaVideo || !rutaVideo.startsWith('img/referencias/')) continue;
      const entrada = POR_RUTA.get(rutaVideo);
      if (!entrada) continue; // ya lo reporta la prueba de rutas, de arriba
      if (video.attrs['aria-label'] !== entrada.alt) {
        fallas.push(`<video ${rutaVideo}>: aria-label="${video.attrs['aria-label']}" no coincide con recursos.json ("${entrada.alt}")`);
      }
    }
    assert.deepEqual(fallas, []);
  });
}

// ───────────────────────── index.html: la excepción del hero, una sola vez ─────────────────────────

// v2 (§7.1): el hero pasa de la pared terracota (v1) al almuerzo de estudio
// `plato-sopa-jugo-estudio`, con la franja del mural detrás — nunca `salon-pared-terracota-
// letrero`, que ahora es la foto de «La pared terracota» dentro de #la-casa.
test('index.html: hay exactamente una fetchpriority="high", en una <img> de plato-sopa-jugo-estudio, sin loading', () => {
  const html = leerPagina('index.html');
  const imgs = extraerTags(html, 'img').map((t) => parsearAtributos(t.attrsText));
  const conAlta = imgs.filter((a) => a.fetchpriority === 'high');
  assert.equal(conAlta.length, 1, `debería haber exactamente 1 <img fetchpriority="high">, hay ${conAlta.length}`);
  const [hero] = conAlta;
  assert.ok(hero.src && hero.src.includes('plato-sopa-jugo-estudio'), `la <img fetchpriority="high"> debería ser de plato-sopa-jugo-estudio (§7.1), es "${hero.src}"`);
  assert.equal(hero.loading, undefined, 'la <img> del hero no debería tener loading (ni "lazy" ni "eager")');
});

// ───────────────────────── recursos.json v2: el recorte nuevo de §8 ─────────────────────────

// Guarda explícita del recurso que entrega la parte «Imágenes» para #hoy (§7.2/§8-1): un
// recorte 3:4 nuevo de `mesa-sopa-plato-mural-fondo`, sin el papel kraft del borde ni la
// decoración colgante del techo. Ya lo cubre en general la prueba de arriba («toda variante
// publicable existe en disco…»), pero esta lo nombra: si el id desaparece o deja de ser
// publicable, el mensaje de falla dice exactamente qué recurso de §8 falta, no una lista
// genérica de bytes.
test('recursos.json: mesa-sopa-plato-mural-fondo-3x4 (§8-1) existe, es publicable, deriva de mesa-sopa-plato-mural-fondo y sus bytes son los reales', () => {
  const r = RECURSOS.find((x) => x.id === 'mesa-sopa-plato-mural-fondo-3x4');
  assert.ok(r, 'falta la entrada mesa-sopa-plato-mural-fondo-3x4 en recursos.json (§8-1 del contrato v2)');
  assert.equal(r.publicable, true);
  assert.equal(r.deriva_de, 'mesa-sopa-plato-mural-fondo');
  assert.ok((r.variantes || []).length > 0, 'sin variantes: no se podría servir en #hoy');
  for (const v of r.variantes) {
    const abs = ruta(v.ruta);
    assert.ok(fs.existsSync(abs), `no existe ${v.ruta}`);
    assert.equal(fs.statSync(abs).size, v.bytes, `${v.ruta} no pesa lo que dice recursos.json`);
  }
});
