// Los criterios de ora.ai (https://ora.ai/score/resplandor.ynt.codes) sobre el repo REAL: lo que de verdad se
// publica en GitHub Pages, con las banderas que tenga hoy. La lista de chequeos vive en
// scripts/pruebas/_puntaje-ora.mjs (la comparte descubrimiento.test.mjs, que la corre sobre lo recién
// generado con todo encendido). Tarea: tareas/2026-10-03-puntaje-ora.md. Si algo de acá falla, el puntaje
// de ora baja al siguiente push — y se nota sin gastar la cuota de escaneos.
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHEQUEOS, bloquesJsonLd, nodoJsonLd, GEMELOS_MD } from './_puntaje-ora.mjs';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => join(RAIZ, ...p);
const leer = (rel) => readFileSync(ruta(rel), 'utf8');
const existe = (rel) => existsSync(ruta(rel));

require(ruta('assets/js/local.js'));
const R = globalThis.RESPLANDOR;
const VERSION = JSON.parse(leer('version.json'));

for (const [nombre, chequeo] of Object.entries(CHEQUEOS)) {
  test(`[ora, repo real] ${nombre}`, () => chequeo(leer, existe, { fecha: VERSION.fecha, R }));
}

test('el repo real: schema/local.jsonl son EXACTAMENTE los nodos del JSON-LD de index.html, en el mismo orden', () => {
  const nodos = bloquesJsonLd(leer('index.html'));
  const lineas = leer('schema/local.jsonl').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lineas, nodos);
});

test('el repo real: el FAQPage trae solo las preguntas visibles con las banderas de hoy (ninguna de una función apagada)', () => {
  const html = leer('index.html');
  const faq = nodoJsonLd(html, 'FAQPage');
  assert.ok(faq, 'index.html tiene <section id="preguntas">: tiene que haber FAQPage');
  const seccion = html.match(/<section id="preguntas"[^>]*>([\s\S]*?)<\/section>/)[1];
  // Cuántas <details> se ven: las de fuera de <template> siempre; las de adentro, solo con la bandera encendida.
  const visibles = seccion.replace(/<template x-if="RESPLANDOR\.funciones\.(\w+)">([\s\S]*?)<\/template>/g, (_, bandera, interior) => (R.funciones[bandera] ? interior : ''));
  assert.equal(faq.mainEntity.length, [...visibles.matchAll(/<details\b/g)].length);
  if (!R.funciones.almuerzoProgramado) assert.doesNotMatch(JSON.stringify(faq), /programad[oa]|domicilio/i, 'con el almuerzo apagado, el FAQ no habla de él');
  if (!R.funciones.menuDeHoy) assert.doesNotMatch(JSON.stringify(faq), /men[uú] de la semana/i);
});

test('el repo real: AGENTS.md en la raíz, las skills copiadas en skills/, plugin.json, y el repositorio enlazado desde about, /api/, privacidad y llms.txt', () => {
  assert.ok(existe('AGENTS.md'), 'falta AGENTS.md (agentes de código: ora, «agent-rules-repo»)');
  assert.match(leer('AGENTS.md'), /^# AGENTS\.md/m);
  for (const skill of ['consultar-resplandor', 'preparar-solicitud-resplandor']) {
    assert.equal(leer(`skills/${skill}/SKILL.md`), leer(`.well-known/agent-skills/${skill}.md`), `skills/${skill}/SKILL.md difiere de la publicada`);
  }
  assert.ok(existe('plugin.json'));
  for (const archivo of ['about.html', 'api/index.html', 'privacy.html', 'llms.txt']) {
    assert.ok(leer(archivo).includes('https://github.com/yvalenta/resplandor'), `${archivo} no enlaza el repositorio`);
  }
});

test('el repo real: version.json, el sitemap, el schemamap y todos los .md llevan la MISMA fecha (si version.mjs la movió, hay que correr descubrimiento.mjs otra vez)', () => {
  const { fecha } = VERSION;
  assert.match(fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(leer('sitemap.xml'), new RegExp(`<lastmod>${fecha}</lastmod>`));
  assert.match(leer('schemamap.xml'), new RegExp(`<lastmod>${fecha}</lastmod>`));
  for (const md of Object.values(GEMELOS_MD)) assert.match(leer(md), new RegExp(`^last-updated: ${fecha}$`, 'm'), `${md} con otra fecha`);
});

test('el repo real: nada de lo nuevo anuncia el MCP remoto como desplegado ni una URL de OAuth (lo aparcado sigue aparcado)', () => {
  // La URL prevista del Worker solo puede aparecer en la server card (en _meta.despliegue, como «prevista») y en
  // auth.md/README para humanos; ninguno de los archivos nuevos la nombra, y menos como endpoint.
  for (const archivo of ['openapi.json', 'api/index.html', 'api/llms.txt', 'plugin.json', 'pricing.html', 'index.md', 'carta.md', '.well-known/ard.json', 'llms.txt']) {
    const texto = leer(archivo);
    assert.doesNotMatch(texto, /mcp\.resplandor\.ynt\.codes/, `${archivo} nombra la URL del MCP remoto, que todavía no responde`);
    assert.doesNotMatch(texto, /oauth-authorization-server|oauth-protected-resource/, `${archivo} nombra OAuth (solo auth.md lo hace, para negarlo)`);
  }
  assert.equal(JSON.parse(leer('local.json')).agentes.mcp, null);
  const tarjeta = JSON.parse(leer('.well-known/mcp/server-card.json'));
  assert.deepEqual(tarjeta.remotes, []);
  assert.equal(tarjeta._meta.despliegue.desplegado, false);
});
