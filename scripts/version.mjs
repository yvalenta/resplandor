#!/usr/bin/env node
// Resplandor — la versión del sitio: version.json y los sellos de las páginas.
//
// Por qué existe: GitHub Pages responde con `Cache-Control: max-age=600` y el sitio no tiene service
// worker, así que un aparato que lleva el POS abierto todo el día nunca se entera de que hay una
// versión nueva (pasó: Yonatan vio el POS «de antes» horas después de publicar). El POS pide
// `version.json` y, si lo publicado no es lo que tiene en su <meta>, avisa (pos.html, «Versión del sitio»).
// Este script es la ÚNICA fuente de esa versión; no hay build ni hay que acordarse de subir un número a mano.
//
// La versión sale del CONTENIDO, no de un contador:
//   · huella  = sha256 de pos.html, carta.html, index.html y menu.html (las páginas que llevan sello) y de
//     TODO assets/** (ruta + contenido, en orden estable), con los sellos de versión NORMALIZADOS. Sin esa
//     normalización la huella sería circular: escribir el sello cambiaría las páginas que se están hasheando.
//   · versión = AAAA.MM.DD-xxxxxxx: la fecha en America/Bogota (explícita: nunca la zona de la máquina, así
//     da lo mismo correrlo en CI, en un Mac en UTC o en otra zona) y los 7 primeros de la huella.
//   Si la huella no cambió, no se toca nada: la fecha no se mueve porque alguien corrió el script otra vez.
//
// Los sellos (cada página, UNO por línea: si dos ramas chocan, el conflicto es de una línea y se resuelve
// corriendo el script otra vez, ver el README):
//   <meta name="resplandor-version" content="2026.10.02-abcdef0">      en el <head>: lo que lee el POS
//   <span data-version>2026.10.02-abcdef0</span>                       en el pie: visible sin JavaScript
// Cualquier elemento con el atributo `data-version` y solo texto adentro cuenta como sello de texto.
//
// Es un paso de BUILD como css.mjs, iconos.mjs y descubrimiento.mjs, pero el sitio publicado sigue sin
// build. Se corre AL FINAL de los otros tres (su huella incluye assets/css/resplandor.css y las páginas
// que ellos reescriben) en cada cambio de páginas o assets.
//
// CLI:
//   node scripts/version.mjs                    calcula la huella; si cambió, escribe version.json y los sellos
//   node scripts/version.mjs --comprobar        no escribe nada; sale 1 si version.json o algún sello no corresponde
//                                               (lo usa .github/workflows/comprobar.yml)
//   node scripts/version.mjs --raiz <dir>       trabaja sobre <dir> en vez de la raíz del repo (las pruebas, con copias temporales)
//   node scripts/version.mjs --ahora <ISO>      fija «ahora» (las pruebas: la fecha de la versión sale de acá)
'use strict';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Las páginas que llevan sello, en el orden en que entran a la huella. */
export const PAGINAS = ['pos.html', 'carta.html', 'index.html', 'menu.html'];
/** El texto que ocupa el lugar de la versión cuando se calcula la huella. */
export const MARCA = '@@version@@';
export const FORMATO_VERSION = /^\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7}$/;

// El <meta> del <head>: el único lugar donde el POS lee su propia versión.
const RE_META = /(<meta\s+name="resplandor-version"\s+content=")([^"]*)(")/g;
// Un elemento con `data-version` (atributo suelto) y solo texto adentro. El lookahead evita `data-version-otra-cosa`.
const RE_TEXTO = /(<([a-z][a-z0-9]*)\b[^>]*?\sdata-version(?=[\s>/=])[^>]*>)([^<]*)(<\/\2>)/gi;
const MARCAS_DE_CONFLICTO = /^(<{7}|={7}|>{7})( |$)/m;

/** AAAA-MM-DD en America/Bogota, sea cual sea la zona de la máquina. */
export function fechaBogota(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ahora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Cuántos sellos tiene una página y qué versión dice cada uno. */
export function leerSellos(html) {
  const metas = [...html.matchAll(RE_META)].map((m) => m[2]);
  const textos = [...html.matchAll(RE_TEXTO)].map((m) => m[3].trim());
  return { metas, textos };
}

/** La página con todos los sellos puestos en `valor` (solo cambia ese texto; el resto, byte por byte). */
export function sellar(html, valor) {
  return html
    .replace(RE_META, (_, a, __, c) => `${a}${valor}${c}`)
    .replace(RE_TEXTO, (_, abre, __, texto, cierra) => `${abre}${texto.trim() ? texto.replace(/\S[\s\S]*\S|\S/, valor) : valor}${cierra}`);
}

/** La página tal como entra a la huella: con los sellos reemplazados por MARCA. */
export function normalizar(html) {
  return sellar(html, MARCA);
}

/** Todo assets/** como [ruta con «/», ruta absoluta], en orden estable (por código de carácter, nunca por la configuración regional). */
function archivosDeAssets(raiz) {
  const base = join(raiz, 'assets');
  const salida = [];
  const recorrer = (dir, prefijo) => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === '.DS_Store') continue; // lo crea macOS; no es del sitio y no existe en CI
      const absoluta = join(dir, entrada);
      const relativa = `${prefijo}/${entrada}`;
      if (statSync(absoluta).isDirectory()) recorrer(absoluta, relativa);
      else salida.push([relativa, absoluta]);
    }
  };
  if (existsSync(base)) recorrer(base, 'assets');
  return salida.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** El sha256 (hex) de las páginas con sello, normalizadas, y de todo assets/**. */
export function calcularHuella(raiz) {
  const h = createHash('sha256');
  const agregar = (ruta, contenido) => {
    h.update(`${ruta}\0${contenido.length}\0`);
    h.update(contenido);
  };
  for (const pagina of PAGINAS) {
    const ruta = join(raiz, pagina);
    if (!existsSync(ruta)) throw new Error(`Falta ${pagina}: es una de las cuatro páginas que llevan sello de versión.`);
    agregar(pagina, Buffer.from(normalizar(readFileSync(ruta, 'utf8')), 'utf8'));
  }
  for (const [ruta, absoluta] of archivosDeAssets(raiz)) agregar(ruta, readFileSync(absoluta));
  return h.digest('hex');
}

/** La versión que le toca a una huella en una fecha de Bogotá: AAAA.MM.DD-xxxxxxx. */
export function versionDe(huella, fecha) {
  return `${fecha.replaceAll('-', '.')}-${huella.slice(0, 7)}`;
}

function leerVersionJson(raiz) {
  const ruta = join(raiz, 'version.json');
  if (!existsSync(ruta)) return { actual: null };
  try {
    const v = JSON.parse(readFileSync(ruta, 'utf8'));
    return { actual: v && typeof v === 'object' ? v : null };
  } catch {
    return { actual: null, ilegible: true };
  }
}

/** Lo que está mal entre version.json, la huella y los sellos (lista vacía = todo en orden). */
export function problemas(raiz) {
  const faltas = [];
  const { actual, ilegible } = leerVersionJson(raiz);
  const huella = calcularHuella(raiz);
  if (!actual) faltas.push(ilegible ? 'version.json no se puede leer (no es un JSON válido).' : 'falta version.json.');
  else {
    if (!FORMATO_VERSION.test(String(actual.version))) faltas.push(`version.json: «${actual.version}» no tiene la forma AAAA.MM.DD-xxxxxxx.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(actual.fecha))) faltas.push(`version.json: la fecha «${actual.fecha}» no tiene la forma AAAA-MM-DD.`);
    if (actual.huella !== huella) faltas.push(`la huella de version.json (${String(actual.huella).slice(0, 12)}…) no es la del sitio (${huella.slice(0, 12)}…): páginas o assets cambiaron desde que se calculó.`);
    else if (actual.version !== versionDe(actual.huella, String(actual.fecha))) faltas.push(`version.json: «${actual.version}» no sale de su huella y su fecha (debería ser ${versionDe(actual.huella, String(actual.fecha))}).`);
  }
  for (const pagina of PAGINAS) {
    const html = readFileSync(join(raiz, pagina), 'utf8');
    if (MARCAS_DE_CONFLICTO.test(html)) { faltas.push(`${pagina} tiene marcas de conflicto de git (<<<<<<<): resuélvelas primero.`); continue; }
    const { metas, textos } = leerSellos(html);
    if (metas.length !== 1) faltas.push(`${pagina}: debe tener UN <meta name="resplandor-version"> y tiene ${metas.length}.`);
    if (textos.length < 1) faltas.push(`${pagina}: le falta el sello visible en el pie (un elemento con data-version).`);
    const esperado = actual && FORMATO_VERSION.test(String(actual.version)) ? String(actual.version) : null;
    if (esperado) {
      const viejos = [...metas, ...textos].filter((v) => v !== esperado);
      if (viejos.length) faltas.push(`${pagina}: ${viejos.length} sello(s) dicen «${[...new Set(viejos)].join('», «')}» y la versión es ${esperado}.`);
    }
  }
  return faltas;
}

/**
 * Pone al día version.json y los sellos. Devuelve { version, cambio, escritos }: `cambio` = la huella era otra
 * (versión nueva); `escritos` = los archivos que se tocaron. Con la huella igual no se mueve la fecha; solo se
 * reparan sellos que no digan lo que dice version.json (por ejemplo, una página recién sellada a mano).
 */
export function actualizar(raiz, ahora = new Date()) {
  for (const pagina of PAGINAS) {
    if (MARCAS_DE_CONFLICTO.test(readFileSync(join(raiz, pagina), 'utf8'))) throw new Error(`${pagina} tiene marcas de conflicto de git (<<<<<<<): resuélvelas primero y vuelve a correr este script.`);
  }
  const huella = calcularHuella(raiz);
  const { actual } = leerVersionJson(raiz);
  const escritos = [];
  let cambio = false;
  let vigente = actual;
  if (!actual || actual.huella !== huella || !FORMATO_VERSION.test(String(actual.version)) || actual.version !== versionDe(huella, String(actual.fecha))) {
    const fecha = fechaBogota(ahora);
    vigente = { version: versionDe(huella, fecha), fecha, huella };
    writeFileSync(join(raiz, 'version.json'), `${JSON.stringify(vigente, null, 2)}\n`);
    escritos.push('version.json');
    cambio = true;
  }
  for (const pagina of PAGINAS) {
    const ruta = join(raiz, pagina);
    const html = readFileSync(ruta, 'utf8');
    const { metas, textos } = leerSellos(html);
    if (metas.length !== 1 || textos.length < 1) {
      throw new Error(`${pagina}: le faltan sellos (necesita UN <meta name="resplandor-version" content="…"> en el <head> y un elemento con data-version en el pie). Agrégalos una vez, a mano, y vuelve a correr este script.`);
    }
    const nuevo = sellar(html, vigente.version);
    if (nuevo !== html) { writeFileSync(ruta, nuevo); escritos.push(pagina); }
  }
  return { version: vigente.version, huella, cambio, escritos };
}

function main() {
  const argv = process.argv.slice(2);
  const valorDe = (opcion) => { const i = argv.indexOf(opcion); return i === -1 ? null : argv[i + 1]; };
  const raiz = valorDe('--raiz') ? resolve(valorDe('--raiz')) : join(dirname(fileURLToPath(import.meta.url)), '..');
  const ahora = valorDe('--ahora') ? new Date(valorDe('--ahora')) : new Date();
  if (Number.isNaN(ahora.getTime())) throw new Error(`--ahora «${valorDe('--ahora')}» no es una fecha ISO válida.`);

  if (argv.includes('--comprobar')) {
    const faltas = problemas(raiz);
    if (faltas.length) {
      console.error(`La versión del sitio no está al día:\n${faltas.map((f) => `  - ${f}`).join('\n')}`);
      console.error('Corre `node scripts/version.mjs` AL FINAL (después de css.mjs, iconos.mjs y descubrimiento.mjs) y commitea version.json y las páginas.');
      process.exit(1);
    }
    console.log(`La versión del sitio está al día (${JSON.parse(readFileSync(join(raiz, 'version.json'), 'utf8')).version}).`);
    return;
  }

  const r = actualizar(raiz, ahora);
  if (r.cambio) console.log(`Versión nueva: ${r.version}. Escrito: ${r.escritos.join(', ')}.`);
  else if (r.escritos.length) console.log(`La huella no cambió (${r.version}); se arreglaron sellos atrasados en: ${r.escritos.join(', ')}.`);
  else console.log(`La huella no cambió: sigue la versión ${r.version}.`);
}

// Solo corre como programa: las pruebas importan las funciones sin disparar nada.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
