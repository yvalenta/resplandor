#!/usr/bin/env node
// Resplandor — genera (o comprueba) el sprite de íconos inline de cada página.
//
// Por cada HTML (por defecto landing.html carta.html menu.html, o los que se pasen como
// argumentos), junta los ids #i-xxx usados en href / :href / x-bind:href / xlink:href, más
// los que declare un comentario `<!-- iconos-extra: a b c -->` (para los ids que solo se
// arman en tiempo de ejecución con Alpine, p. ej. `:href="'#i-' + variable"`), y escribe
// entre `<!-- iconos:inicio -->` y `<!-- iconos:fin -->` un <svg style="display:none"> con un
// <symbol id="i-xxx" viewBox="0 0 24 24"> por ícono, tomando los hijos (sin los atributos del
// <svg> raíz: esos los pone la clase .icono de componentes.css) del SVG correspondiente en
// node_modules/lucide-static/icons/xxx.svg.
//
// Sin --comprobar: escribe cada archivo (si cambió). Con --comprobar: no escribe nada, sale 1
// si algún archivo quedaría distinto de como está commiteado (lo usa .github/workflows/comprobar.yml).
// Un ícono que no existe en lucide-static es un error duro (con el nombre y el archivo). Un
// archivo sin los dos marcadores es solo un aviso: se salta, no cuenta como diferencia.
'use strict';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CARPETA_ICONOS = join(RAIZ, 'node_modules/lucide-static/icons');

const INICIO = '<!-- iconos:inicio -->';
const FIN = '<!-- iconos:fin -->';
const RE_EXTRA = /<!--\s*iconos-extra:([^>]*?)-->/g;
const RE_HREF = /\b(?:href|:href|x-bind:href|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/g;
const RE_ID = /#i-([a-zA-Z0-9-]+)/g;

function rel(ruta) {
  return relative(RAIZ, ruta) || '.';
}

/** Junta, ordenados y sin repetir, los ids #i-xxx que usa un HTML. */
function idsUsados(html) {
  const ids = new Set();
  let m;
  RE_HREF.lastIndex = 0;
  while ((m = RE_HREF.exec(html))) {
    const valor = m[2] ?? m[3] ?? '';
    let m2;
    RE_ID.lastIndex = 0;
    while ((m2 = RE_ID.exec(valor))) ids.add(m2[1]);
  }
  RE_EXTRA.lastIndex = 0;
  while ((m = RE_EXTRA.exec(html))) {
    for (const nombre of m[1].trim().split(/\s+/).filter(Boolean)) ids.add(nombre);
  }
  return [...ids].sort();
}

/** Los hijos (sin atributos del <svg> raíz) del ícono `nombre` de lucide-static. */
function hijosDelIcono(nombre, archivo) {
  const ruta = join(CARPETA_ICONOS, `${nombre}.svg`);
  if (!existsSync(ruta)) {
    throw new Error(
      `El ícono "${nombre}" no existe en lucide-static (buscado en ` +
        `node_modules/lucide-static/icons/${nombre}.svg, usado en ${rel(archivo)}). ` +
        `Revisá el nombre en https://lucide.dev/icons/ o en node_modules/lucide-static/icons.`,
    );
  }
  const svg = readFileSync(ruta, 'utf8');
  const m = /<svg\b[^>]*>([\s\S]*?)<\/svg>/i.exec(svg);
  if (!m) throw new Error(`No pude leer el contenido de ${ruta} (¿no es un <svg> válido?).`);
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n  ');
}

/** El bloque completo <svg style="display:none">…</svg>, con un <symbol> por id, en orden. */
function armarSprite(ids, archivo) {
  const simbolos = ids
    .map((id) => `<symbol id="i-${id}" viewBox="0 0 24 24">\n  ${hijosDelIcono(id, archivo)}\n</symbol>`)
    .join('\n');
  return (
    `${INICIO}\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">\n` +
    (simbolos ? `${simbolos}\n` : '') +
    `</svg>\n` +
    FIN
  );
}

/** Calcula el HTML resultante de reemplazar el sprite; null si el archivo no tiene marcadores. */
function calcularNuevoContenido(archivo) {
  const html = readFileSync(archivo, 'utf8');
  const iInicio = html.indexOf(INICIO);
  const iFin = html.indexOf(FIN);
  if (iInicio === -1 || iFin === -1 || iFin < iInicio) return { html: null, ids: [] };
  const ids = idsUsados(html);
  const sprite = armarSprite(ids, archivo);
  const nuevo = html.slice(0, iInicio) + sprite + html.slice(iFin + FIN.length);
  return { html: nuevo, ids };
}

function main() {
  const argv = process.argv.slice(2);
  const comprobar = argv.includes('--comprobar');
  const archivos = argv.filter((a) => a !== '--comprobar');
  const lista = (archivos.length ? archivos : ['landing.html', 'carta.html', 'menu.html']).map((a) =>
    resolve(RAIZ, a),
  );

  let hayDiferencias = false;

  for (const archivo of lista) {
    if (!existsSync(archivo)) {
      console.warn(`Aviso: ${rel(archivo)} no existe — se salta.`);
      continue;
    }
    const actual = readFileSync(archivo, 'utf8');
    const { html: nuevo, ids } = calcularNuevoContenido(archivo);
    if (nuevo === null) {
      console.warn(
        `Aviso: ${rel(archivo)} no tiene los marcadores ${INICIO} / ${FIN} — se salta.`,
      );
      continue;
    }
    if (comprobar) {
      if (nuevo !== actual) {
        console.error(
          `${rel(archivo)} quedaría distinto (${ids.length} ícono${ids.length === 1 ? '' : 's'}: ` +
            `${ids.join(', ') || '(ninguno)'}). Corré \`node scripts/iconos.mjs\` y commiteá el resultado.`,
        );
        hayDiferencias = true;
      } else {
        console.log(`${rel(archivo)} está al día (${ids.length} ícono${ids.length === 1 ? '' : 's'}).`);
      }
    } else {
      if (nuevo !== actual) {
        writeFileSync(archivo, nuevo);
        console.log(`${rel(archivo)} actualizado (${ids.length} ícono${ids.length === 1 ? '' : 's'}: ${ids.join(', ') || '(ninguno)'}).`);
      } else {
        console.log(`${rel(archivo)} ya estaba al día (${ids.length} ícono${ids.length === 1 ? '' : 's'}).`);
      }
    }
  }

  if (comprobar && hayDiferencias) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
