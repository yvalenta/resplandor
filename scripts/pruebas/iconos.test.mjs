// Prueba de scripts/iconos.mjs sobre archivos HTML temporales (nunca sobre landing.html/
// carta.html/menu.html reales): genera el sprite, es idempotente, un ícono inexistente falla
// con un mensaje claro, `<!-- iconos-extra: … -->` funciona, y `--comprobar` detecta un
// archivo desviado sin escribirlo.
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(RAIZ, 'scripts/iconos.mjs');

const MARCADORES = '<!-- iconos:inicio -->\n<!-- iconos:fin -->';

function html(cuerpo) {
  return `<!doctype html>\n<html><body>\n${MARCADORES}\n${cuerpo}\n</body></html>\n`;
}

function correr(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function archivoTemp(t, contenido) {
  const carpeta = mkdtempSync(join(tmpdir(), 'resplandor-iconos-'));
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  const archivo = join(carpeta, 'pagina.html');
  writeFileSync(archivo, contenido);
  return archivo;
}

test('genera el sprite con los ids usados en href/x-bind:href, ordenados por id', (t) => {
  const archivo = archivoTemp(
    t,
    html('<svg><use x-bind:href="\'#i-heart\'"></use></svg><svg><use href="#i-check"></use></svg>'),
  );
  const r = correr([archivo]);
  assert.equal(r.status, 0, r.stderr);
  const salida = readFileSync(archivo, 'utf8');
  assert.match(salida, /<!-- iconos:inicio -->/);
  assert.match(salida, /<!-- iconos:fin -->/);
  assert.match(salida, /<symbol id="i-check" viewBox="0 0 24 24">/);
  assert.match(salida, /<symbol id="i-heart" viewBox="0 0 24 24">/);
  // Sin atributos del <svg> raíz de lucide (fill/stroke/width/height/class no deben colarse).
  assert.doesNotMatch(salida, /class="lucide/);
  // Ordenados por id: check (c) antes que heart (h).
  assert.ok(salida.indexOf('id="i-check"') < salida.indexOf('id="i-heart"'));
});

test('es idempotente: correrlo dos veces da el mismo archivo', (t) => {
  const archivo = archivoTemp(t, html('<a href="#i-check"></a>'));
  correr([archivo]);
  const primero = readFileSync(archivo, 'utf8');
  correr([archivo]);
  const segundo = readFileSync(archivo, 'utf8');
  assert.equal(segundo, primero);
});

test('un ícono inexistente falla con un mensaje claro que nombra el ícono', (t) => {
  const archivo = archivoTemp(t, html('<a href="#i-esto-no-existe-de-ninguna-forma"></a>'));
  const r = correr([archivo]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /esto-no-existe-de-ninguna-forma/);
});

test('<!-- iconos-extra: a b --> suma ids que no aparecen en href', (t) => {
  const archivo = archivoTemp(t, html('<!-- iconos-extra: check heart -->'));
  const r = correr([archivo]);
  assert.equal(r.status, 0, r.stderr);
  const salida = readFileSync(archivo, 'utf8');
  assert.match(salida, /id="i-check"/);
  assert.match(salida, /id="i-heart"/);
});

test('--comprobar no escribe y sale 1 si el archivo quedaría distinto', (t) => {
  const archivo = archivoTemp(t, html('<a href="#i-check"></a>'));
  correr([archivo]); // lo deja generado y al día
  const alDia = readFileSync(archivo, 'utf8');

  const okCheck = correr([archivo, '--comprobar']);
  assert.equal(okCheck.status, 0, okCheck.stderr);

  // Lo desvío a mano (como si alguien hubiera tocado el HTML sin volver a generar).
  writeFileSync(archivo, alDia.replace('href="#i-check"', 'href="#i-heart"'));
  const desviado = readFileSync(archivo, 'utf8');

  const falla = correr([archivo, '--comprobar']);
  assert.notEqual(falla.status, 0);
  // --comprobar no escribe nada.
  assert.equal(readFileSync(archivo, 'utf8'), desviado);
});

test('un archivo sin los marcadores se salta con un aviso, no falla', (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'resplandor-iconos-'));
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  const archivo = join(carpeta, 'sin-marcadores.html');
  const original = '<!doctype html>\n<html><body><a href="#i-check"></a></body></html>\n';
  writeFileSync(archivo, original);

  const r = correr([archivo]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /aviso/i);
  assert.equal(readFileSync(archivo, 'utf8'), original);
});
