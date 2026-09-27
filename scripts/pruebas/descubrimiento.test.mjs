// Pruebas del descubrimiento estático (scripts/descubrimiento.mjs): local.json,
// llms.txt, sitemap.xml, robots.txt y el JSON-LD de la landing no pueden divergir de
// assets/js/local.js + assets/js/solicitud.js.
//
// El paso del JSON-LD es estricto a propósito: landing.html TODAVÍA no tiene los
// marcadores «datos-estructurados» (los pone la parte que construye la landing), así que
// la primera prueba de acá — contra la landing REAL, sin --landing — está PENSADA para
// fallar hoy, y solo por eso. En cuanto la landing tenga los marcadores, pasa sola.
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => join(RAIZ, ...p);

require(ruta('assets/js/local.js'));
require(ruta('assets/js/solicitud.js'));
const R = globalThis.RESPLANDOR;
const S = globalThis.RESPLANDOR_SOLICITUD;

// Ninguna prueba de este archivo debe escribir dentro del árbol de trabajo real: se
// guarda el contenido de los 4 archivos generados ANTES de correr nada, y una prueba al
// final del archivo (más abajo) exige que sigan bit a bit iguales — la prueba de
// «--comprobar contra la landing REAL» (la primera de este archivo) no escribe nada, así
// que esto captura el estado tal como lo dejó el último `node scripts/descubrimiento.mjs`
// de verdad.
const ARCHIVOS_GENERADOS = ['local.json', 'llms.txt', 'sitemap.xml', 'robots.txt'];
const antesDeEscribir = Object.fromEntries(ARCHIVOS_GENERADOS.map((a) => [a, existsSync(ruta(a)) ? readFileSync(ruta(a), 'utf8') : null]));

// ───────────────────────── el paso estricto (esperado en rojo HOY) ─────────────────────────

test('node scripts/descubrimiento.mjs --comprobar sale 0 contra la landing REAL (marcadores puestos por la parte landing)', () => {
  // Si esto falla hoy, es EXACTAMENTE por lo documentado arriba: landing.html todavía no
  // tiene <!-- datos-estructurados:inicio/fin -->. No es un bug de este generador — la
  // prueba de más abajo (con una landing temporal que SÍ tiene los marcadores) lo prueba.
  execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), '--comprobar'], { cwd: RAIZ });
});

// ───────────────────────── el generador funciona (landing temporal con marcadores) ─────────────────────────

const dirTemp = mkdtempSync(join(tmpdir(), 'resplandor-descubrimiento-'));
const landingConMarcadores = join(dirTemp, 'landing-con-marcadores.html');
const landingSinMarcadores = join(dirTemp, 'landing-sin-marcadores.html');
writeFileSync(
  landingConMarcadores,
  '<!doctype html>\n<html><head><title>t</title></head><body>\n<!-- datos-estructurados:inicio -->\n<!-- datos-estructurados:fin -->\n</body></html>\n',
);
writeFileSync(landingSinMarcadores, '<!doctype html>\n<html><head><title>t</title></head><body>\nsin marcadores\n</body></html>\n');

// --salida <dirTemp> en las CUATRO pruebas de escritura de más abajo: antes, estas
// pruebas corrían el generador SIN --comprobar contra la raíz de siempre, así que
// reescribían local.json/llms.txt/sitemap.xml/robots.txt del árbol de trabajo real a
// mitad de la corrida (se notaba si el commiteado estaba desactualizado: la prueba lo
// «arreglaba» solo, y una segunda corrida de la suite salía en verde igual). Con
// --salida, escriben SIEMPRE en dirTemp — nunca en el repo.

test('con --landing apuntando a una copia CON marcadores y --salida a un directorio temporal, escribe todo ahí (nunca en el repo) y sale 0', () => {
  execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), '--landing', landingConMarcadores, '--salida', dirTemp], { cwd: RAIZ });
  const html = readFileSync(landingConMarcadores, 'utf8');
  assert.match(html, /datos-estructurados:inicio/);
  assert.match(html, /<script type="application\/ld\+json">/);
  for (const archivo of ['local.json', 'llms.txt', 'sitemap.xml', 'robots.txt']) assert.ok(existsSync(join(dirTemp, archivo)), `falta ${archivo} en el directorio temporal`);
});

test('vuelto a correr con --comprobar (mismo --salida), ahora sale 0 (todo al día, sin tocar el repo)', () => {
  execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), '--landing', landingConMarcadores, '--salida', dirTemp, '--comprobar'], { cwd: RAIZ });
});

test('con --landing apuntando a una copia SIN marcadores, falla con un mensaje claro (y no revienta el proceso)', () => {
  assert.throws(() => execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), '--landing', landingSinMarcadores, '--salida', dirTemp], { cwd: RAIZ, stdio: 'pipe' }));
  let stderr = '';
  try {
    execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), '--landing', landingSinMarcadores, '--salida', dirTemp], { cwd: RAIZ, stdio: 'pipe' });
  } catch (err) {
    stderr = err.stderr.toString();
  }
  assert.match(stderr, /marcadores/i);
});

test('con --landing apuntando a una copia SIN marcadores, igual escribe local.json/llms.txt/sitemap.xml/robots.txt (en el directorio temporal, nunca en el repo)', () => {
  try {
    execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), '--landing', landingSinMarcadores, '--salida', dirTemp], { cwd: RAIZ, stdio: 'pipe' });
  } catch {
    // se espera que salga 1 (por los marcadores); lo que importa es que los 4 de siempre existan igual.
  }
  for (const archivo of ['local.json', 'llms.txt', 'sitemap.xml', 'robots.txt']) assert.ok(existsSync(join(dirTemp, archivo)), `falta ${archivo}`);
});

// El JSON-LD generado sobre la copia temporal: schema.org Restaurant con los datos
// reales, y las exclusiones que pide la especificación (sin aggregateRating).
test('el JSON-LD entre los marcadores: Restaurant, dirección (con addressLocality/addressRegion propios), geo, capacidad 30, sin aggregateRating', () => {
  const html = readFileSync(landingConMarcadores, 'utf8');
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'no hay <script type="application/ld+json"> entre los marcadores');
  const datos = JSON.parse(m[1]);
  assert.equal(datos['@type'], 'Restaurant');
  assert.equal(datos.name, R.marca);
  // Hallazgo: antes streetAddress traía la dirección COMPLETA (calle, ciudad, departamento,
  // país todo junto) y addressLocality/addressRegion no existían. Ahora cada parte va en
  // su propio campo — Google recomienda esto para que un Restaurant se geolocalice bien —
  // y streetAddress se queda solo con la calle. Sin postalCode: no se conoce uno para esta
  // dirección, así que se omite en vez de inventarlo.
  assert.equal(datos.address.streetAddress, R.direccionPartes.calle);
  assert.equal(datos.address.addressLocality, R.direccionPartes.ciudad);
  assert.equal(datos.address.addressRegion, R.direccionPartes.region);
  assert.equal(datos.address.postalCode, undefined);
  assert.equal(datos.address.addressCountry, 'CO');
  assert.doesNotMatch(datos.address.streetAddress, /La Estrella|Antioquia/); // no quedó enterrada en streetAddress
  assert.equal(datos.geo.latitude, R.geo.lat);
  assert.equal(datos.geo.longitude, R.geo.lng);
  assert.equal(datos.maximumAttendeeCapacity, 30);
  assert.equal(datos.acceptsReservations, true);
  assert.equal(datos.telephone, R.whatsappVisible);
  assert.equal(datos.hasMap, R.enlaces.maps);
  assert.equal(datos.menu, R.enlaces.carta);
  assert.equal(datos.openingHoursSpecification.opens, R.horario.abre);
  assert.equal(datos.openingHoursSpecification.closes, R.horario.cierra);
  assert.deepEqual(datos.openingHoursSpecification.dayOfWeek.sort(), ['Friday', 'Monday', 'Saturday', 'Sunday', 'Thursday', 'Tuesday', 'Wednesday'].sort());
  assert.equal(datos.aggregateRating, undefined);
});

// ───────────────────────── local.json ─────────────────────────

test('local.json: mismos datos del local y de las reglas de la solicitud que RESPLANDOR/RESPLANDOR_SOLICITUD', () => {
  const local = JSON.parse(readFileSync(ruta('local.json'), 'utf8'));
  assert.equal(local.marca, R.marca);
  assert.equal(local.direccion, R.direccion);
  assert.equal(local.capacidad, 30);
  assert.equal(local.whatsapp, R.whatsapp);
  assert.deepEqual(local.geo, R.geo);
  assert.deepEqual(local.direccionPartes, R.direccionPartes);

  assert.equal(local.solicitud.reglas.maxPersonas, S.MAX_PERSONAS);
  assert.equal(local.solicitud.reglas.maxTexto, S.MAX_TEXTO);
  assert.deepEqual(local.solicitud.reglas.tipos, S.TIPOS.map((t) => t.id));
  assert.deepEqual(local.solicitud.reglas.entregas, S.ENTREGAS);
  assert.deepEqual(local.solicitud.reglas.frecuencias, S.FRECUENCIAS.map((f) => f.id));
});

// Hallazgo N3 (ronda 3 de refutación): antes había UN solo ejemplo (una reserva simple):
// una deriva en la línea «Entrega:», en el saneo de la nota o en el aviso «los eventos son
// solo en el local» no se notaba, porque ninguno de esos caminos del mensaje se ejercitaba.
// Ahora local.json trae VARIOS ejemplos (`solicitud.ejemplos`, plural) que entre todos
// cubren: reserva simple; almuerzo con domicilio+dirección+nota; y un tipo que NO es
// almuerzo pidiendo domicilio (el aviso de N1) — y CADA UNO tiene que salir de
// armarSolicitud(), nunca escrito a mano.
test('local.json: cada ejemplo de la solicitud (mensaje, enlace y avisos) sale de armarSolicitud(), ninguno está escrito a mano', () => {
  const local = JSON.parse(readFileSync(ruta('local.json'), 'utf8'));
  assert.ok(Array.isArray(local.solicitud.ejemplos) && local.solicitud.ejemplos.length >= 3, 'se esperan varios ejemplos (N3), no uno solo');
  for (const ejemplo of local.solicitud.ejemplos) {
    const armado = S.armarSolicitud(ejemplo.entrada);
    assert.equal(ejemplo.mensaje, armado.mensaje);
    assert.equal(ejemplo.enlace, armado.enlace);
    assert.deepEqual(ejemplo.avisos, armado.avisos);
  }
});

// Al menos un ejemplo tiene que ejercitar de verdad el camino de almuerzo+domicilio
// (dirección y nota incluidas) y otro el aviso de N1 (domicilio pedido fuera de
// almuerzo) — si no, «varios ejemplos» podría ser solo la misma reserva repetida tres
// veces y esta prueba no lo notaría.
test('local.json: los ejemplos cubren almuerzo a domicilio (con dirección y nota) y un tipo no-almuerzo pidiendo domicilio (aviso de N1)', () => {
  const local = JSON.parse(readFileSync(ruta('local.json'), 'utf8'));
  const ejemplos = local.solicitud.ejemplos;
  assert.ok(
    ejemplos.some((e) => e.entrada.tipo === 'almuerzo' && e.entrada.entrega === 'domicilio' && e.entrada.direccion && e.entrada.nota),
    'falta un ejemplo de almuerzo a domicilio con dirección y nota',
  );
  assert.ok(
    ejemplos.some((e) => e.entrada.tipo !== 'almuerzo' && e.entrada.entrega === 'domicilio' && e.avisos.some((a) => /solo en el local/i.test(a))),
    'falta un ejemplo no-almuerzo pidiendo domicilio, con el aviso de N1',
  );
});

test('local.json: no anuncia un endpoint MCP que no existe', () => {
  const local = JSON.parse(readFileSync(ruta('local.json'), 'utf8'));
  assert.equal(local.agentes.mcp, null);
});

// Arnés mínimo (document/Alpine falsos), independiente del que usa
// scripts/descubrimiento.mjs para generar local.json: ejecuta los 5 archivos reales en un
// vm y lee lo que agentes.js registra DE VERDAD. Antes, esta prueba comparaba local.json
// contra LA MISMA regex que usaba el generador (/\bname:\s*'([^']+)'/g): un comentario
// («// { name: 'reservar_y_pagar' }») o un `name` con comillas dobles engañaba a las DOS
// por igual, y local.json podía anunciar una herramienta que no existe (o le faltaba una
// que sí existe) sin que la prueba lo notara nunca. Ejecutando el código de verdad, un
// comentario nunca se «registra» y una comilla distinta no cambia nada.
function herramientasWebmcpDeVerdad() {
  const ARCHIVOS = ['assets/js/local.js', 'assets/js/solicitud.js', 'assets/js/vivo.js', 'assets/js/landing.js', 'assets/js/agentes.js'];
  const dialogo = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const document = new EventTarget();
  document.title = '';
  document.documentElement = { classList: { add() {}, remove() {} } };
  document.activeElement = null;
  document.getElementById = (id) => (id === 'solicitud' ? dialogo : null);
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.contains = () => true;

  const stores = new Map();
  const Alpine = {
    store(nombre, definicion) {
      if (definicion === undefined) return stores.get(nombre);
      stores.set(nombre, definicion);
      if (typeof definicion.init === 'function') definicion.init();
      return definicion;
    },
    data() {},
    directive() {},
    effect(fn) {
      fn();
    },
    nextTick(fn) {
      if (fn) fn();
      return Promise.resolve();
    },
    reactive(x) {
      return x;
    },
  };

  const sandbox = {
    console,
    document,
    location: { hash: '' },
    history: {},
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => (fn(), 0),
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => (typeof fn === 'function' && fn(), 0),
    clearTimeout: () => {},
    Alpine,
    fetch: async () => {
      throw new Error('sin red en este arnés: listar herramientas no debería pedir nada en vivo.');
    },
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const archivo of ARCHIVOS) vm.runInContext(readFileSync(ruta(archivo), 'utf8'), sandbox, { filename: archivo });
  document.dispatchEvent(new Event('alpine:init'));
  document.dispatchEvent(new Event('alpine:initialized'));

  // Array.from (llamado sobre el Array de ESTE realm, no sobre el arreglo del vm) copia
  // los nombres a un arreglo del realm de este archivo: sin esto, `.map()` sobre un
  // arreglo creado DENTRO del vm devuelve un arreglo de ESE otro realm, y deepEqual
  // contra el arreglo (de este realm) que salió de JSON.parse(local.json) falla con «same
  // structure but not reference-equal» aunque el contenido sea idéntico (gotcha de node:vm).
  return Array.from(sandbox.window.RESPLANDOR_AGENTES?.herramientas ?? [], (h) => h.name);
}

test('local.json: las herramientas WebMCP listadas son las que agentes.js registra de verdad (ejecutado en un vm, no una regex)', () => {
  const local = JSON.parse(readFileSync(ruta('local.json'), 'utf8'));
  assert.ok(Array.isArray(local.agentes.webmcp.herramientas) && local.agentes.webmcp.herramientas.length > 0);
  if (!existsSync(ruta('assets/js/agentes.js'))) return;
  const reales = herramientasWebmcpDeVerdad();
  assert.ok(reales.length > 0, 'el vm no registró ninguna herramienta: revisar el arnés');
  assert.deepEqual(local.agentes.webmcp.herramientas, reales);
});

test('local.json: nunca lleva precios de la carta ni del menú embebidos (siempre en vivo)', () => {
  const local = JSON.parse(readFileSync(ruta('local.json'), 'utf8'));
  assert.equal(local.carta, undefined);
  assert.equal(local.menu, undefined);
  assert.equal(local.menuSemana, undefined);
  assert.ok(local.carta_en_vivo, 'falta explicar cómo leer la carta en vivo');
  assert.ok(local.menu_semana_en_vivo, 'falta explicar cómo leer el menú en vivo');
});

// ───────────────────────── llms.txt ─────────────────────────

test('llms.txt: empieza con "# " y nombra la dirección, la capacidad y el WhatsApp', () => {
  const txt = readFileSync(ruta('llms.txt'), 'utf8');
  assert.ok(txt.startsWith('# '), 'llms.txt debe empezar con un H1 (llmstxt.org)');
  assert.ok(txt.includes(R.direccion));
  assert.match(txt, /30 personas/);
  assert.ok(txt.includes(R.whatsapp) || txt.includes(R.whatsappVisible));
});

// ───────────────────────── sitemap.xml / robots.txt ─────────────────────────

test('sitemap.xml: lista landing, carta y menú', () => {
  const xml = readFileSync(ruta('sitemap.xml'), 'utf8');
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/landing\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/carta\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/menu\.html<\/loc>/);
});

test('robots.txt: permite todo y apunta al sitemap', () => {
  const txt = readFileSync(ruta('robots.txt'), 'utf8');
  assert.match(txt, /User-agent: \*/);
  assert.match(txt, /Allow: \//);
  assert.match(txt, /Sitemap: https:\/\/resplandor\.ynt\.codes\/sitemap\.xml/);
});

// ───────────────────────── aislamiento: nada de este archivo escribe en el repo ─────────────────────────

// Guarda de regresión para el hallazgo de más arriba: local.json/llms.txt/sitemap.xml/
// robots.txt de la raíz tienen que seguir bit a bit iguales a como estaban ANTES de
// correr cualquier prueba de este archivo (capturado al principio, en `antesDeEscribir`).
// Si esto falla, alguna prueba volvió a escribir en el árbol de trabajo real en vez de
// usar --salida.
test('ninguna prueba de este archivo escribió dentro del repo real (local.json/llms.txt/sitemap.xml/robots.txt sin cambios)', () => {
  for (const archivo of ARCHIVOS_GENERADOS) {
    const ahora = existsSync(ruta(archivo)) ? readFileSync(ruta(archivo), 'utf8') : null;
    assert.equal(ahora, antesDeEscribir[archivo], `${archivo} cambió: alguna prueba escribió en el árbol de trabajo real`);
  }
});
