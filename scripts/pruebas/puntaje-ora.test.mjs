// Los criterios de ora.ai (https://ora.ai/score/resplandor.ynt.codes) sobre el repo REAL: lo que de verdad se
// publica en GitHub Pages, con las banderas que tenga hoy. La lista de chequeos vive en
// scripts/pruebas/_puntaje-ora.mjs (la comparte descubrimiento.test.mjs, que la corre sobre lo recién
// generado con todo encendido). Tarea: tareas/2026-10-03-puntaje-ora.md. Si algo de acá falla, el puntaje
// de ora baja al siguiente push — y se nota sin gastar la cuota de escaneos.
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHEQUEOS, ARCHIVOS_DEL_GENERADOR, bloquesJsonLd, nodoJsonLd, GEMELOS_MD, fechasDePaginas, rutaDeUrl } from './_puntaje-ora.mjs';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => join(RAIZ, ...p);
const leer = (rel) => readFileSync(ruta(rel), 'utf8');
const existe = (rel) => existsSync(ruta(rel));

require(ruta('assets/js/local.js'));
const R = globalThis.RESPLANDOR;

for (const [nombre, chequeo] of Object.entries(CHEQUEOS)) {
  test(`[ora, repo real] ${nombre}`, () => chequeo(leer, existe, { R }));
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

test('el repo real: cada página tiene SU fecha (scripts/fechas-paginas.json): el sitemap, el schemamap y cada .md dicen la suya, y el POS (fuera del sitemap) no tiene ninguna', () => {
  const fechas = fechasDePaginas(leer);
  const sitemap = leer('sitemap.xml');
  const paginas = [...sitemap.matchAll(/<url>\s*<loc>(.*?)<\/loc>\s*<lastmod>(.*?)<\/lastmod>/g)].map((m) => [rutaDeUrl(m[1]), m[2]]);
  assert.ok(paginas.length >= 7, 'el sitemap trae sus páginas con <lastmod>');
  for (const [clave, lastmod] of paginas) assert.equal(lastmod, fechas[clave]?.fecha, `${clave}: su <lastmod> no es su fecha guardada`);
  assert.equal(paginas.some(([clave]) => clave === 'pos.html'), false, 'el POS no está en el sitemap: su cambio no mueve ninguna fecha');
  assert.match(leer('schemamap.xml'), new RegExp(`<lastmod>${fechas['schema/local.jsonl'].fecha}</lastmod>`));
  for (const md of Object.values(GEMELOS_MD)) assert.match(leer(md), new RegExp(`^last-updated: ${fechas[md].fecha}$`, 'm'), `${md} con otra fecha`);
  for (const [clave, { fecha, huella }] of Object.entries(fechas)) {
    assert.match(fecha, /^\d{4}-\d{2}-\d{2}$/, `${clave}: fecha con forma AAAA-MM-DD`);
    assert.match(huella, /^[0-9a-f]{64}$/, `${clave}: huella sha256`);
  }
  assert.deepEqual(Object.keys(fechas), [...Object.keys(fechas)].sort(), 'las entradas van ordenadas (la salida es determinista y las ramas que tocan páginas distintas no chocan)');
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

// Lo que /api/, openapi.json, auth.md y privacy dicen de la llave publishable («solo lee lo que el restaurante tiene público … y nunca las ventas, las
// cuentas ni el personal») se apoya en los GRANT a `anon` de las migraciones. Si alguien le da SELECT a `anon` sobre otra tabla, esta prueba falla y
// obliga a revisar lo que se afirma en público (la frase vieja, «solo alcanza la vista de la carta», ya era falsa: la refutación r1 la desmintió).
// Se recorre en el orden de las migraciones: un REVOKE posterior deshace un GRANT anterior (la vista de la carta se revoca y se vuelve a conceder).
test('lo que se afirma de la llave pública es cierto: los GRANT a anon de las migraciones son la vista de la carta y las tablas públicas del menú y su votación, y nada de ventas, cuentas ni personal', () => {
  const migraciones = readdirSync(ruta('supabase/migrations')).filter((a) => a.endsWith('.sql')).sort();
  assert.ok(migraciones.length >= 10);
  const legibles = new Set();
  for (const archivo of migraciones) {
    const sql = leer(`supabase/migrations/${archivo}`).replace(/--[^\n]*/g, '');
    for (const sentencia of sql.split(';')) {
      const g = /^\s*grant\s+(select|all)\b[\s\S]*?\bon\s+(?:table\s+)?([\s\S]+?)\s+to\s+([\s\S]+)$/i.exec(sentencia);
      if (g && /\banon\b/i.test(g[3]) && !/^(function|schema|all)\b/i.test(g[2].trim())) for (const t of g[2].split(',')) legibles.add(t.trim().replace(/^public\./, ''));
      const r = /^\s*revoke\b[\s\S]*?\bon\s+(?:table\s+)?([\s\S]+?)\s+from\s+([\s\S]+)$/i.exec(sentencia);
      if (r && /\banon\b/i.test(r[2]) && !/^(function|schema|all)\b/i.test(r[1].trim())) for (const t of r[1].split(',')) legibles.delete(t.trim().replace(/^public\./, ''));
    }
  }
  assert.deepEqual([...legibles].sort(), ['carta_publica', 'elecciones_menu', 'menus', 'reacciones_menu']);
  for (const privada of ['productos', 'mesas', 'ordenes', 'cierres', 'cierre_ordenes', 'personal', 'deshechos', 'alertas', 'ajustes']) assert.equal(legibles.has(privada), false, `anon lee ${privada}`);
});

// ARCHIVOS_DEL_GENERADOR (_puntaje-ora.mjs) es la lista que recorren las pruebas de «lo que dice cada superficie»; si el generador suma un archivo y esa
// lista no se entera, esas pruebas dejarían de verlo. `--listar` es la verdad de lo que genera (más su archivo de fechas, que no es una superficie).
test('ARCHIVOS_DEL_GENERADOR es exactamente lo que genera descubrimiento.mjs (--listar), sin su archivo de fechas', () => {
  const listados = execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), '--listar'], { cwd: RAIZ }).toString().trim().split('\n');
  assert.deepEqual([...listados.filter((a) => a !== 'scripts/fechas-paginas.json')].sort(), [...ARCHIVOS_DEL_GENERADOR].sort());
  assert.ok(listados.includes('scripts/fechas-paginas.json'));
});
