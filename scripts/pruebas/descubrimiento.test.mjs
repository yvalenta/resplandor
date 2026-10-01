// Pruebas del descubrimiento estático (scripts/descubrimiento.mjs): local.json,
// llms.txt, sitemap.xml, robots.txt y el JSON-LD de la landing no pueden divergir de
// assets/js/local.js + assets/js/solicitud.js.
//
// El paso del JSON-LD es estricto a propósito: index.html (la landing) TODAVÍA no tiene los
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
import { crearSitio, TODAS_ENCENDIDAS } from './_sitio.mjs';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => join(RAIZ, ...p);

// El repo real puede tener funciones apagadas (RESPLANDOR.funciones, assets/js/local.js): sus
// archivos generados no llevan el menú de la semana ni el almuerzo programado. Este archivo prueba
// el GENERADOR completo —incluido lo que dice de esas dos funciones—, así que corre el generador de
// un sitio de prueba con las dos banderas encendidas (`SITIO`, scripts/pruebas/_sitio.mjs) y lee de
// ahí lo que espera. Lo que el repo real tiene commiteado se vigila con `--comprobar` (la primera
// prueba) y lo que pasa con las banderas apagadas o encendidas, una por una, en funciones.test.mjs.
const SITIO = crearSitio(TODAS_ENCENDIDAS);
const rutaSitio = SITIO.ruta;

require(rutaSitio('assets/js/local.js'));
require(rutaSitio('assets/js/solicitud.js'));
const R = globalThis.RESPLANDOR;
const S = globalThis.RESPLANDOR_SOLICITUD;
const { crearManejador, VERSIONES_SOPORTADAS } = await SITIO.importar('mcp/worker.mjs');

// Las 4 herramientas y el nombre/versión REALES de mcp/worker.mjs, por su propio
// transporte JSON-RPC (igual que scripts/pruebas/mcp.test.mjs e infoServidorMcp() de
// scripts/descubrimiento.mjs) — para comparar contra .well-known/mcp/server-card.json sin
// copiar un solo nombre a mano en ESTE archivo tampoco.
async function infoMcpDeVerdad() {
  const sinRed = async () => {
    throw new Error('no debería usarse: initialize/tools/list no tocan cargarLocal/leerCarta/leerMenuSemana.');
  };
  const manejador = crearManejador({ cargarLocal: sinRed, leerCarta: sinRed, leerMenuSemana: sinRed });
  const pedir = async (method) => {
    const resp = await manejador.fetch(new Request('http://prueba.local/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) }));
    return (await resp.json()).result;
  };
  const init = await pedir('initialize');
  const lista = await pedir('tools/list');
  return { nombre: init.serverInfo.name, version: init.serverInfo.version, herramientas: lista.tools };
}

// Ninguna prueba de este archivo debe escribir dentro del árbol de trabajo real: se
// guarda el contenido de TODOS los archivos generados ANTES de correr nada, y una prueba
// al final del archivo (más abajo) exige que sigan bit a bit iguales — la prueba de
// «--comprobar contra la landing REAL» (la primera de este archivo) no escribe nada, así
// que esto captura el estado tal como lo dejó el último `node scripts/descubrimiento.mjs`
// de verdad. Única lista (no una por prueba): agregar un archivo nuevo acá alcanza para
// que TODAS las pruebas de abajo (existencia en el directorio temporal, aislamiento del
// repo real) lo cubran también.
const ARCHIVOS_GENERADOS = [
  'local.json',
  'llms.txt',
  'sitemap.xml',
  'robots.txt',
  'auth.md',
  'about.html',
  'contact.html',
  'privacy.html',
  '404.html',
  '.well-known/api-catalog',
  '.well-known/mcp/server-card.json',
  '.well-known/agent-skills/index.json',
  '.well-known/agent-skills/consultar-resplandor.md',
  '.well-known/agent-skills/preparar-solicitud-resplandor.md',
  '.well-known/ai-catalog.json',
];
const antesDeEscribir = Object.fromEntries(ARCHIVOS_GENERADOS.map((a) => [a, existsSync(ruta(a)) ? readFileSync(ruta(a), 'utf8') : null]));

// ───────────────────────── el paso estricto (esperado en rojo HOY) ─────────────────────────

test('node scripts/descubrimiento.mjs --comprobar sale 0 contra la landing REAL (marcadores puestos por la parte landing)', () => {
  // Si esto falla hoy, es EXACTAMENTE por lo documentado arriba: index.html todavía no
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
  execFileSync(process.execPath, [rutaSitio('scripts/descubrimiento.mjs'), '--landing', landingConMarcadores, '--salida', dirTemp], { cwd: SITIO.raiz });
  const html = readFileSync(landingConMarcadores, 'utf8');
  assert.match(html, /datos-estructurados:inicio/);
  assert.match(html, /<script type="application\/ld\+json">/);
  for (const archivo of ARCHIVOS_GENERADOS) assert.ok(existsSync(join(dirTemp, archivo)), `falta ${archivo} en el directorio temporal`);
});

test('vuelto a correr con --comprobar (mismo --salida), ahora sale 0 (todo al día, sin tocar el repo)', () => {
  execFileSync(process.execPath, [rutaSitio('scripts/descubrimiento.mjs'), '--landing', landingConMarcadores, '--salida', dirTemp, '--comprobar'], { cwd: SITIO.raiz });
});

test('con --landing apuntando a una copia SIN marcadores, falla con un mensaje claro (y no revienta el proceso)', () => {
  assert.throws(() => execFileSync(process.execPath, [rutaSitio('scripts/descubrimiento.mjs'), '--landing', landingSinMarcadores, '--salida', dirTemp], { cwd: SITIO.raiz, stdio: 'pipe' }));
  let stderr = '';
  try {
    execFileSync(process.execPath, [rutaSitio('scripts/descubrimiento.mjs'), '--landing', landingSinMarcadores, '--salida', dirTemp], { cwd: SITIO.raiz, stdio: 'pipe' });
  } catch (err) {
    stderr = err.stderr.toString();
  }
  assert.match(stderr, /marcadores/i);
});

test('con --landing apuntando a una copia SIN marcadores, igual escribe local.json/llms.txt/sitemap.xml/robots.txt (en el directorio temporal, nunca en el repo)', () => {
  try {
    execFileSync(process.execPath, [rutaSitio('scripts/descubrimiento.mjs'), '--landing', landingSinMarcadores, '--salida', dirTemp], { cwd: SITIO.raiz, stdio: 'pipe' });
  } catch {
    // se espera que salga 1 (por los marcadores); lo que importa es que el resto exista igual.
  }
  for (const archivo of ARCHIVOS_GENERADOS) assert.ok(existsSync(join(dirTemp, archivo)), `falta ${archivo}`);
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

// Puntaje de agentes (is-agentic.com, 2026-09-29): «Organization schema completeness» pide
// contactPoint (teléfono o correo + contactType) Y address; «JSON-LD structured data» pide
// sameAs, entre otros. Se vigila sobre el JSON-LD generado Y sobre el index.html REAL (que
// la comprobación del generador ya obliga a estar al día, pero acá el contrato queda a la
// vista: si alguien quita el bloque del generador, esta prueba nombra qué se perdió).
for (const [donde, leer] of [
  ['generado (copia temporal)', () => readFileSync(landingConMarcadores, 'utf8')],
  ['real (index.html del repo)', () => readFileSync(ruta('index.html'), 'utf8')],
]) {
  test(`el JSON-LD ${donde}: contactPoint (mismo teléfono y correo, contactType reservations, es), address, sameAs con la ficha de Google Maps y el Instagram, y el correo y el rango de precios confirmados; sin calificación, ofertas ni otras redes inventadas`, () => {
    const m = leer().match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(m, 'no hay JSON-LD');
    const datos = JSON.parse(m[1]);
    assert.deepEqual(datos.contactPoint, {
      '@type': 'ContactPoint',
      telephone: R.whatsappVisible,
      email: R.correo,
      contactType: 'reservations',
      availableLanguage: 'es',
    });
    assert.equal(datos.contactPoint.telephone, datos.telephone, 'el contactPoint usa el mismo teléfono que el local');
    assert.equal(datos.contactPoint.email, datos.email, 'el contactPoint usa el mismo correo que el local');
    // Los dio Yonatan el 2026-09-29: el correo, y el «desde» del ejecutivo más barato (sopa y carne, 14.000).
    assert.equal(datos.email, 'resplandorcomidamixta@gmail.com');
    assert.equal(datos.priceRange, '$$ · desde 14.000 COP');
    assert.ok(datos.priceRange.length < 100, 'Google no muestra un priceRange de 100 caracteres o más');
    assert.equal(datos.address['@type'], 'PostalAddress');
    assert.ok(datos.address.streetAddress && datos.address.addressCountry, 'address sigue completa');
    assert.deepEqual(datos.sameAs, [R.enlaces.fichaGoogle, R.enlaces.instagram]);
    assert.equal(R.enlaces.fichaGoogle, 'https://maps.google.com/?cid=4458126308796974783');
    // Confirmado por Yonatan el 2026-09-29; es la única red social del local en el repo.
    assert.equal(R.enlaces.instagram, 'https://www.instagram.com/resplandorestaurante');
    assert.match(datos.hasMap, /^https:\/\/www\.google\.com\/maps\/place\//, 'hasMap sigue siendo la ficha de Maps');
    // Lo que NO hay en el repo no se inventa: ni calificación, ni reseñas, ni ofertas, ni otras redes.
    for (const campo of ['aggregateRating', 'review', 'offers']) {
      assert.equal(datos[campo], undefined, `${campo} no debe aparecer: no hay dato en el repo`);
    }
    assert.doesNotMatch(JSON.stringify(datos.sameAs), /facebook|tiktok|twitter|x\.com/i);
  });
}

// ───────────────────────── local.json ─────────────────────────

test('local.json: mismos datos del local y de las reglas de la solicitud que RESPLANDOR/RESPLANDOR_SOLICITUD', () => {
  const local = JSON.parse(readFileSync(rutaSitio('local.json'), 'utf8'));
  assert.equal(local.marca, R.marca);
  assert.equal(local.direccion, R.direccion);
  assert.equal(local.capacidad, 30);
  assert.equal(local.whatsapp, R.whatsapp);
  assert.equal(local.correo, R.correo);
  assert.equal(local.rangoDePrecios, R.rangoDePrecios);
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
  const local = JSON.parse(readFileSync(rutaSitio('local.json'), 'utf8'));
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
  const local = JSON.parse(readFileSync(rutaSitio('local.json'), 'utf8'));
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
  const local = JSON.parse(readFileSync(rutaSitio('local.json'), 'utf8'));
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

  for (const archivo of ARCHIVOS) vm.runInContext(readFileSync(rutaSitio(archivo), 'utf8'), sandbox, { filename: archivo });
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
  const local = JSON.parse(readFileSync(rutaSitio('local.json'), 'utf8'));
  assert.ok(Array.isArray(local.agentes.webmcp.herramientas) && local.agentes.webmcp.herramientas.length > 0);
  if (!existsSync(ruta('assets/js/agentes.js'))) return;
  const reales = herramientasWebmcpDeVerdad();
  assert.ok(reales.length > 0, 'el vm no registró ninguna herramienta: revisar el arnés');
  assert.deepEqual(local.agentes.webmcp.herramientas, reales);
});

test('local.json: nunca lleva precios de la carta ni del menú embebidos (siempre en vivo)', () => {
  const local = JSON.parse(readFileSync(rutaSitio('local.json'), 'utf8'));
  assert.equal(local.carta, undefined);
  assert.equal(local.menu, undefined);
  assert.equal(local.menuSemana, undefined);
  assert.ok(local.carta_en_vivo, 'falta explicar cómo leer la carta en vivo');
  assert.ok(local.menu_semana_en_vivo, 'falta explicar cómo leer el menú en vivo');
});

// ───────────────────────── llms.txt ─────────────────────────

test('llms.txt: empieza con "# " y nombra la dirección, la capacidad y el WhatsApp', () => {
  const txt = readFileSync(rutaSitio('llms.txt'), 'utf8');
  assert.ok(txt.startsWith('# '), 'llms.txt debe empezar con un H1 (llmstxt.org)');
  assert.ok(txt.includes(R.direccion));
  assert.match(txt, /30 personas/);
  assert.ok(txt.includes(R.whatsapp) || txt.includes(R.whatsappVisible));
});

// ───────────────────────── sitemap.xml / robots.txt ─────────────────────────

test('sitemap.xml: lista la landing (la raíz), carta y menú', () => {
  const xml = readFileSync(rutaSitio('sitemap.xml'), 'utf8');
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/carta\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/menu\.html<\/loc>/);
});

// El POS es interno y landing.html es solo la redirección a la raíz: ninguno de los dos es una
// página que haya que descubrir. Listarlos le pediría a los buscadores lo contrario de lo que
// dicen robots.txt (el POS) y el canonical (la redirección).
test('sitemap.xml: no lista pos.html (el POS) ni landing.html (la redirección a la raíz)', () => {
  const xml = readFileSync(rutaSitio('sitemap.xml'), 'utf8');
  assert.doesNotMatch(xml, /pos\.html/);
  assert.doesNotMatch(xml, /landing\.html/);
});

test('robots.txt: permite todo salvo el POS y apunta al sitemap', () => {
  const txt = readFileSync(ruta('robots.txt'), 'utf8');
  assert.match(txt, /User-agent: \*/);
  assert.match(txt, /Allow: \//);
  assert.match(txt, /Sitemap: https:\/\/resplandor\.ynt\.codes\/sitemap\.xml/);
});

// Un rastreador que tiene grupo propio (GPTBot, ClaudeBot…) usa SOLO ese grupo e ignora el de
// `*` (RFC 9309): un único `Disallow: /pos.html` bajo `*` no alcanzaría a ninguno de los 16
// bots nombrados. Por eso cada grupo lleva el suyo, y antes de `Allow: /` (los rastreadores que
// leen las reglas en orden se quedan con la primera que calza).
test('robots.txt: `Disallow: /pos.html` en CADA grupo (el de `*` y los de los bots nombrados), antes de `Allow: /`', () => {
  const txt = readFileSync(ruta('robots.txt'), 'utf8');
  const grupos = txt.split(/\n\n+/).filter((g) => /^User-agent:/m.test(g));
  assert.ok(grupos.length >= 17, `se esperaban el grupo de * y los 16 bots nombrados, hay ${grupos.length}`);
  for (const grupo of grupos) {
    const agente = grupo.match(/^User-agent: (.+)$/m)[1];
    const reglas = grupo.split('\n').filter((l) => /^(Allow|Disallow):/.test(l));
    assert.ok(reglas.includes('Disallow: /pos.html'), `el grupo de ${agente} no bloquea /pos.html`);
    assert.ok(reglas.indexOf('Disallow: /pos.html') < reglas.indexOf('Allow: /'), `en el grupo de ${agente}, Disallow: /pos.html debe ir antes de Allow: /`);
  }
});

test('robots.txt: no bloquea landing.html (la redirección a la raíz) ni la raíz: el rastreador tiene que poder ver la redirección y el canonical', () => {
  const txt = readFileSync(ruta('robots.txt'), 'utf8');
  assert.doesNotMatch(txt, /Disallow:\s*\/?\s*$/m, 'un `Disallow: /` (o vacío) bloquearía todo el sitio');
  assert.doesNotMatch(txt, /landing\.html/);
  assert.equal([...txt.matchAll(/^Disallow: (.*)$/gm)].filter((m) => m[1] !== '/pos.html').length, 0, 'el único Disallow del sitio es el del POS');
});

// isitagentready.com puntúa "reglas de bot IA" y "Content-Signal" como DOS cosas aparte de
// "hay Sitemap" — un `Allow: /` genérico bajo `User-agent: *` no basta para ninguna de las
// dos: hace falta la línea `Content-Signal:` y al menos un bloque con un bot nombrado.
test('robots.txt: Content-Signal dentro de "User-agent: *" y al menos un bot de IA nombrado (GPTBot, ClaudeBot)', () => {
  const txt = readFileSync(ruta('robots.txt'), 'utf8');
  assert.match(txt, /Content-Signal:\s*search=yes,\s*ai-input=yes,\s*ai-train=no/);
  assert.match(txt, /User-agent: GPTBot\nDisallow: \/pos\.html\nAllow: \//);
  assert.match(txt, /User-agent: ClaudeBot\nDisallow: \/pos\.html\nAllow: \//);
});

test('sitemap.xml: también lista about, contact y privacy', () => {
  const xml = readFileSync(rutaSitio('sitemap.xml'), 'utf8');
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/about\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/contact\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/privacy\.html<\/loc>/);
});

// ───────────────────────── auth.md ─────────────────────────

test('auth.md: explica que no hay OAuth porque no hay escritura pública, y que quien envía es la persona por WhatsApp', () => {
  const txt = readFileSync(join(dirTemp, 'auth.md'), 'utf8');
  assert.ok(txt.startsWith('# '));
  assert.match(txt, /oauth-authorization-server/i);
  assert.match(txt, /oauth-protected-resource/i);
  assert.match(txt, /WhatsApp/);
  assert.match(txt, /Sin USDC/); // sin pagos: no hay nada que autorizar
});

// El encabezado que exige la especificación de Auth.md (https://workos.com/auth-md, formato en
// https://workos.com/auth-md/docs/auth-md: el archivo abre con `# auth.md`) y el chequeo «Auth.md
// agent registration» de isitagentready.com (2026-09-29: «auth.md exists but is missing the
// expected Auth.md heading» — pide un H1 que contenga `auth.md`). Con «# Autenticación — …» fallaba.
// Se vigila el archivo REAL y el generado: el encabezado es lo único que el escáner lee primero.
for (const [donde, leer] of [
  ['generado (copia temporal)', () => readFileSync(join(dirTemp, 'auth.md'), 'utf8')],
  ['real (en el repo)', () => readFileSync(ruta('auth.md'), 'utf8')],
]) {
  test(`auth.md ${donde}: su primera línea es el H1 «# auth.md» (ni «Autenticación», ni marca, ni front matter antes) y no anuncia un flujo de registro que no existe`, () => {
    const txt = leer();
    assert.equal(txt.split('\n')[0], '# auth.md');
    const h1 = txt.split('\n').filter((l) => /^# /.test(l));
    assert.deepEqual(h1, ['# auth.md'], 'un solo H1, y es el de la especificación');
    // Fondo intacto: el sitio no tiene nada que requiera credenciales y no hay registro de agentes.
    assert.match(txt, /## Registro de agentes/);
    assert.match(txt, /NO ofrece registro de agentes/);
    assert.match(txt, /identity_assertion/); // se nombran los métodos de la spec... para decir que no hay ninguno
    assert.doesNotMatch(txt, /POST \/agent\/auth|register_uri|registration_endpoint|client_secret/i, 'no inventa endpoints de registro');
    assert.match(txt, /WhatsApp/);
  });
}

// ───────────────────────── páginas ancla de confianza + 404 (sin JS) ─────────────────────────

test('about.html, contact.html, privacy.html y 404.html: HTML válido, con la marca, y SIN <script> (contenido real sin JS)', () => {
  for (const archivo of ['about.html', 'contact.html', 'privacy.html', '404.html']) {
    const html = readFileSync(join(dirTemp, archivo), 'utf8');
    assert.match(html, /^<!doctype html>/i, `${archivo} no empieza con <!doctype html>`);
    assert.ok(html.includes(R.marca), `${archivo} no menciona la marca`);
    assert.doesNotMatch(html, /<script/i, `${archivo} no debería depender de JS para su contenido`);
    assert.match(html, /<link rel="canonical"/, `${archivo} sin canonical`);
  }
  assert.ok(readFileSync(join(dirTemp, 'contact.html'), 'utf8').includes(`<a href="mailto:${R.correo}">${R.correo.replace('@', '<wbr>@')}</a>`), 'contact.html muestra el correo del local, partible antes de la @');
});

test('privacy.html: es honesto sobre lo poco que hay (nombra menu.html/localStorage, no promete "cero" localStorage)', () => {
  const html = readFileSync(join(dirTemp, 'privacy.html'), 'utf8');
  assert.match(html, /menu\.html/);
  assert.match(html, /localStorage/);
  assert.match(html, /wa\.me|WhatsApp/);
});

// Lo que la página dice de los terceros tiene que ser lo que las páginas públicas PIDEN de verdad:
// se lee del HTML que se publica (no de una lista copiada acá) y se compara con lo que privacy.html
// nombra. Si mañana una página carga algo de otro dominio y la privacidad no lo dice, esto falla.
test('privacy.html: nombra a Google Fonts y a jsDelivr (los terceros que el HTML de las páginas carga) y a Supabase (los datos en vivo), dice que ven la IP y que no hay cookies propias', () => {
  const privacidad = readFileSync(join(dirTemp, 'privacy.html'), 'utf8');
  assert.match(privacidad, /Google Fonts/);
  assert.match(privacidad, /jsDelivr/);
  assert.match(privacidad, /Supabase[^.]*ven tu dirección IP/s, 'Supabase también ve la IP: lo piden los scripts de la landing, la carta y el menú');
  assert.match(privacidad, /dirección IP/);
  assert.match(privacidad, /no crea cookies propias/i);
  assert.doesNotMatch(privacidad, /No usa cookies/); // la promesa es sobre las PROPIAS: lo de terceros no lo controla este sitio

  const HOSTS_QUE_NOMBRA = { 'fonts.googleapis.com': /Google Fonts/, 'fonts.gstatic.com': /Google Fonts/, 'cdn.jsdelivr.net': /jsDelivr/ };
  const hosts = new Set();
  for (const pagina of ['index.html', 'carta.html', 'menu.html', 'about.html', 'contact.html', 'privacy.html', '404.html']) {
    const html = readFileSync(ruta(pagina), 'utf8');
    // Solo lo que el navegador pide sin que la persona haga nada: <script src>, <link href> (menos los de
    // canonical/alternate/icon propios) y <img src> absolutos. Los <a href> (wa.me, Maps, GitHub) son enlaces.
    for (const m of html.matchAll(/<(?:script|link|img|source)\b[^>]*\b(?:src|href)="(https?:\/\/[^"\/]+)/gi)) hosts.add(new URL(m[1]).host);
  }
  hosts.delete(new URL(R.sitio).host); // el propio sitio (canonical, og:image)
  const sinNombrar = [...hosts].filter((h) => !HOSTS_QUE_NOMBRA[h] || !HOSTS_QUE_NOMBRA[h].test(privacidad));
  assert.deepEqual(sinNombrar, [], `terceros que las páginas cargan y privacy.html no nombra: ${sinNombrar.join(', ')}`);
});

// ───────────────────────── confianza: la cuenta de la mesa, el personal y «Pagar» (ola B, parte B4) ─────────────────────────
// docs/sdd-cuenta-en-mesa.md §05 S8 y §04.7: privacy.html y auth.md dicen lo que el sitio hace de verdad con la cuenta de
// una mesa, con los datos del personal y con los pagos. «Pagar» es de una función que se enciende aparte (pagarEnMesa): las
// páginas de confianza hablan del botón SOLO con ella encendida, y nunca con el nombre de la bandera (funciones.test.mjs).

test('privacy.html: explica la cuenta de la mesa (código en el enlace, en vivo, no-referrer), el sessionStorage de carta.html y qué se guarda del personal', () => {
  const html = readFileSync(join(dirTemp, 'privacy.html'), 'utf8');
  assert.match(html, /La cuenta de tu mesa/);
  assert.match(html, /código secreto/);
  assert.match(html, /tiempo real/);
  assert.match(html, /no-referrer/);
  assert.match(html, /Quien tenga el enlace de la mesa/, 'la fuga aceptada (SDD §03.7) se dice en voz alta');
  assert.match(html, /abono/i, 'un abono aparece como una línea que descuenta');
  assert.match(html, /El personal del restaurante \(punto de venta\)/);
  assert.match(html, /correo de Google[\s\S]*nombre[\s\S]*rol \(mesero o\s+admin\)[\s\S]*activa/);
  assert.match(html, /solo la ve un administrador/);
  // Ola C: la solicitud pendiente. Qué se guarda de quien pide acceso, qué ve y cómo se borra (SDD §12.2).
  assert.match(html, /solicitud\s+pendiente/);
  assert.match(html, /mapa de mesas[\s\S]*carta\s+pública, sin cuentas, totales ni ventas/);
  assert.match(html, /correo de su cuenta de Google, el nombre de su\s+perfil de Google y la hora[\s\S]*aunque nunca se apruebe/);
  assert.match(html, /pedirlo al restaurante/);
  assert.match(html, /nunca se publican en el repositorio/);
  // Lo que carta.html dice de sí misma tiene que ser lo que privacy.html cuenta (se lee del archivo, no de una lista copiada acá).
  const carta = readFileSync(ruta('carta.html'), 'utf8');
  if (/sessionStorage/.test(carta)) assert.match(html, /sessionStorage/, 'carta.html usa sessionStorage y privacy.html no lo dice');
  if (/<meta name="referrer" content="no-referrer">/.test(carta)) assert.match(html, /no-referrer/);
  const llaves = [...new Set([...carta.matchAll(/sessionStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g)].map((m) => m[1]))];
  assert.deepEqual(llaves, ['cuenta:'], 'carta.html guarda otra clave en sessionStorage: privacy.html solo habla del identificador de la cuenta');
  assert.doesNotMatch(carta, /localStorage/, 'carta.html usa localStorage y privacy.html no lo cuenta para la carta');
});

test('privacy.html: dice que ninguna página muestra a dónde pagar (ni cuentas, ni llaves, ni QR) y que no hay un correo del personal a la vista', () => {
  const html = readFileSync(join(dirTemp, 'privacy.html'), 'utf8');
  assert.match(html, /Ninguna página pública muestra números de cuenta, llaves ni códigos QR para pagar/);
  assert.match(html, /no es de /);
  for (const archivo of ['privacy.html', 'auth.md']) {
    const texto = readFileSync(join(dirTemp, archivo), 'utf8');
    assert.deepEqual(texto.match(/[\w.+-]+@[\w-]+(?:\.[A-Za-z]{2,})+/g) || [], [], `${archivo} (repo público) no debe traer ningún correo`);
  }
});

test('auth.md: sin pagos ni cobros, el punto de venta es lo único con cuenta (y no es para agentes) y la cuenta de una mesa pide un código, no una cuenta', () => {
  const txt = readFileSync(join(dirTemp, 'auth.md'), 'utf8');
  assert.match(txt, /## Sin pagos ni cobros/);
  assert.match(txt, /Sin USDC/);
  assert.match(txt, /ninguna página trae cuentas, llaves ni códigos QR de pago/);
  assert.match(txt, /## Lo que sí pide cuenta: el punto de venta \(no es público\)/);
  assert.match(txt, /lista del personal \(rol `mesero` o `admin`\)/);
  assert.match(txt, /no hay API key, ni forma de que un agente obtenga ese acceso/);
  assert.match(txt, /solicitud pendiente y solo ve el mapa de\s+mesas y la carta/, 'quien pide acceso sin estar aprobado queda pendiente y solo mira');
  assert.match(txt, /## Lo que exige un código, no una cuenta: la cuenta de una mesa/);
  assert.match(txt, /no se anuncia en ninguna superficie para agentes/);
  // Sigue sin inventar un flujo de registro ni de OAuth.
  assert.doesNotMatch(txt, /POST \/agent\/auth|register_uri|registration_endpoint|client_secret/i);
});

for (const pagarEnMesa of [false, true]) {
  test(`pagarEnMesa ${pagarEnMesa ? 'ENCENDIDA' : 'APAGADA'}: privacy.html y auth.md ${pagarEnMesa ? 'dicen que «Pagar» solo avisa (y que no es una herramienta de agentes)' : 'no hablan de un botón que no existe'}, y nunca nombran la bandera ni la función`, () => {
    const sitio = crearSitio({ ...TODAS_ENCENDIDAS, pagarEnMesa });
    const privacidad = sitio.leer('privacy.html');
    const auth = sitio.leer('auth.md');
    assert.equal(/tocas «Pagar»/.test(privacidad), pagarEnMesa);
    assert.equal(/se borra\s+cuando pasa más de un día, la siguiente vez que alguien crea o atiende un aviso o se cierra el día/.test(privacidad), pagarEnMesa,
      'lo de la retención de los avisos (D28, ola C: pasado un día, al crear, atender o cerrar el día) solo con «Pagar»: es lo que hace purgar_alertas_viejas()');
    if (!pagarEnMesa) assert.doesNotMatch(privacidad, /cerrar el día/, 'sin «Pagar» no hay avisos que borrar ni se promete nada');
    assert.equal(/El botón «Pagar» de la cuenta de una mesa solo AVISA/.test(auth), pagarEnMesa);
    if (pagarEnMesa) {
      assert.match(privacidad, /solo AVISA al personal/);
      assert.match(privacidad, /la página no recibe ni guarda datos de pago/);
      assert.match(auth, /no se ofrece como herramienta a ningún agente/);
    }
    for (const texto of [privacidad, auth]) {
      for (const rastro of [/pagarEnMesa/i, /pagar en mesa/i, /functions\/v1\/alerta/i, /alerta al mesero/i]) assert.doesNotMatch(texto, rastro);
    }
    // Y lo generado se puede comprobar con esa bandera (--comprobar en 0).
    const comprobar = sitio.descubrimiento(['--comprobar']);
    assert.equal(comprobar.codigo, 0, comprobar.error);
  });
}

test('404.html: noindex, y enlaza llms.txt/local.json/sitemap además de la landing (la raíz), carta y menu', () => {
  const html = readFileSync(join(dirTemp, '404.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
  for (const enlace of ['llms.txt', 'local.json', 'sitemap.xml', '/', 'carta.html', 'menu.html']) {
    assert.ok(html.includes(`href="${enlace}"`), `404.html no enlaza ${enlace}`);
  }
  assert.doesNotMatch(html, /landing\.html/, '404.html no debería nombrar landing.html: la landing es la raíz');
});

// ───────────────────────── .well-known/api-catalog (RFC 9727) ─────────────────────────

test('.well-known/api-catalog: linkset con la carta y el menú (PostgREST de Supabase), y el MCP remoto AUSENTE (todavía sin desplegar)', () => {
  const catalogo = JSON.parse(readFileSync(join(dirTemp, '.well-known/api-catalog'), 'utf8'));
  assert.ok(Array.isArray(catalogo.linkset) && catalogo.linkset.length >= 3);
  const indice = catalogo.linkset[0];
  assert.equal(indice.anchor, `${R.sitio}.well-known/api-catalog`);
  const hrefs = indice.item.map((i) => i.href);
  assert.ok(hrefs.some((h) => h.includes(R.supabase.vistaCarta)));
  assert.ok(hrefs.some((h) => h.includes(R.supabase.tablaMenus)));
  assert.ok(!hrefs.some((h) => h.includes('mcp.resplandor.ynt.codes')), 'no debería anunciar el MCP remoto: todavía no está desplegado');
});

// ───────────────────────── .well-known/mcp/server-card.json (SEP-2127) ─────────────────────────

test('.well-known/mcp/server-card.json: nombre/versión/herramientas son EXACTAMENTE los que mcp/worker.mjs responde por su propio transporte (initialize + tools/list)', async () => {
  const tarjeta = JSON.parse(readFileSync(join(dirTemp, '.well-known/mcp/server-card.json'), 'utf8'));
  const real = await infoMcpDeVerdad();
  assert.equal(tarjeta.name, real.nombre);
  assert.equal(tarjeta.version, real.version);
  assert.deepEqual(
    tarjeta.tools.map((t) => t.name),
    real.herramientas.map((t) => t.name),
  );
  assert.deepEqual(tarjeta.tools, real.herramientas);
  assert.deepEqual(tarjeta.supportedProtocolVersions, VERSIONES_SOPORTADAS);
});

test('.well-known/mcp/server-card.json: remotes vacío y _meta.despliegue.desplegado=false mientras el Worker no esté desplegado (nunca anuncia un endpoint que no existe)', () => {
  const tarjeta = JSON.parse(readFileSync(join(dirTemp, '.well-known/mcp/server-card.json'), 'utf8'));
  assert.deepEqual(tarjeta.remotes, []);
  assert.equal(tarjeta._meta.despliegue.desplegado, false);
  assert.equal(typeof tarjeta._meta.despliegue.urlPrevista, 'string');
});

// ───────────────────────── Agent Skills (frontmatter + Markdown) ─────────────────────────

test('.well-known/agent-skills/index.json: cada skill del índice existe como archivo, con frontmatter name/description', () => {
  const indice = JSON.parse(readFileSync(join(dirTemp, '.well-known/agent-skills/index.json'), 'utf8'));
  assert.ok(Array.isArray(indice.skills) && indice.skills.length >= 2);
  for (const skill of indice.skills) {
    const rutaRelativa = skill.path.replace(/^\//, '');
    assert.ok(existsSync(join(dirTemp, rutaRelativa)), `falta el archivo de la skill «${skill.id}» (${skill.path})`);
    const md = readFileSync(join(dirTemp, rutaRelativa), 'utf8');
    assert.match(md, /^---\nname: [\w-]+\ndescription: .+\n---\n/, `${skill.path} no tiene frontmatter YAML válido al inicio`);
    assert.match(md, new RegExp(`name: ${skill.id}\\b`));
  }
});

test('preparar-solicitud-resplandor.md: nunca dice que la skill envía/reserva/cobra — solo arma; y su ejemplo sale de armarSolicitud() de verdad', () => {
  const md = readFileSync(join(dirTemp, '.well-known/agent-skills/preparar-solicitud-resplandor.md'), 'utf8');
  assert.match(md, /la persona envía/i);
  assert.match(md, /nunca envía/i);
  const local = JSON.parse(readFileSync(join(dirTemp, 'local.json'), 'utf8'));
  const ejemplo = local.solicitud.ejemplos[0];
  assert.ok(md.includes(JSON.stringify(ejemplo.entrada, null, 2)), 'el ejemplo del skill debe ser EXACTAMENTE local.json.solicitud.ejemplos[0].entrada');
});

// ───────────────────────── .well-known/ai-catalog.json (ARD) ─────────────────────────

test('.well-known/ai-catalog.json: specVersion 1.0, host con la marca, y una entrada por cada superficie para agentes (identifiers urn:air válidos)', () => {
  const catalogo = JSON.parse(readFileSync(join(dirTemp, '.well-known/ai-catalog.json'), 'utf8'));
  assert.equal(catalogo.specVersion, '1.0');
  assert.equal(catalogo.host.displayName, R.marca);
  assert.ok(catalogo.entries.length >= 6);
  const patronUrn = /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/;
  for (const entrada of catalogo.entries) {
    assert.match(entrada.identifier, patronUrn, `identifier inválido: ${entrada.identifier}`);
    assert.ok(entrada.displayName && entrada.type && entrada.url, `falta un campo obligatorio en ${entrada.identifier}`);
  }
  const tarjetaMcp = catalogo.entries.find((e) => e.identifier.endsWith(':mcp:server-card'));
  assert.equal(tarjetaMcp.metadata.desplegado, false);
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
