// La mudanza de raíz (2026-09-29): la landing pasa a `/` (index.html) y el POS a `/pos.html`;
// `landing.html` queda como una redirección para no romper los enlaces ya publicados (Maps,
// Instagram, lo impreso). Estas pruebas vigilan las cuatro cosas que se rompen en silencio si
// alguien vuelve a mover un archivo:
//   1. Qué archivo es qué: index.html es la landing (indexable, canonical a la raíz), pos.html es
//      el POS (noindex, su login vuelve a la página que lo abrió) y landing.html solo redirige.
//   2. El reenvío del login: si Supabase no acepta /pos.html entre sus Redirect URLs, devuelve a la
//      Site URL (la raíz) con ?code=… / #access_token=… / #error_description=…, y la landing se lo
//      pasa al POS. Se EJECUTA el script real del <head> con un `location` falso (nunca una regex
//      sobre su texto: una regex acepta cualquier cosa que se le parezca).
//   3. El enlace «Abrir POS» del pie: oculto por defecto, visible solo con una clave sb-…-auth-token
//      en localStorage, sin redirigir nunca por su cuenta. También se ejecuta el script real.
//   4. Lo que escanean los generadores por nombre de archivo: `@source` de Tailwind (la landing SÍ,
//      el POS y la redirección NO) y la lista por defecto de scripts/iconos.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => path.join(RAIZ, ...p);
const leer = (p) => fs.readFileSync(ruta(p), 'utf8');
const require = createRequire(import.meta.url);
require(ruta('assets/js/local.js'));
const R = globalThis.RESPLANDOR;

const RAIZ_URL = 'https://resplandor.ynt.codes/';
const sinComentarios = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ');

// Partes del documento: el <head> y el <footer> de index.html, y sus <script> en línea (sin src).
function partes(html) {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const pie = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  const enLinea = (trozo) => [...sinComentarios(trozo).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return { head, pie, scriptsHead: enLinea(head), scriptsPie: enLinea(pie) };
}

const INDEX = leer('index.html');
const POS = leer('pos.html');
const STUB = leer('landing.html');
const { head: HEAD_INDEX, pie: PIE_INDEX, scriptsHead: SCRIPTS_HEAD, scriptsPie: SCRIPTS_PIE } = partes(INDEX);

// ───────────────────────── 1. qué archivo es qué ─────────────────────────

test('la fuente única de enlaces (local.js) pone la landing en la raíz', () => {
  assert.equal(R.enlaces.landing, RAIZ_URL);
  assert.equal(R.sitio, RAIZ_URL);
});

test('index.html es la landing: indexable, canonical, og:url y JSON-LD apuntan a la raíz, y no lleva el login del POS', () => {
  assert.ok(INDEX.includes(`<link rel="canonical" href="${RAIZ_URL}" />`), 'el canonical de la landing es la raíz');
  assert.ok(INDEX.includes(`<meta property="og:url" content="${RAIZ_URL}" />`), 'el og:url de la landing es la raíz');
  const ld = JSON.parse(INDEX.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'Restaurant');
  assert.equal(ld.url, RAIZ_URL);
  assert.doesNotMatch(sinComentarios(INDEX), /noindex|nofollow/i, 'la landing es lo que tiene que aparecer en los buscadores');
  assert.doesNotMatch(INDEX, /signInWithOAuth|createClient/, 'index.html no es el POS: el login de Google vive en pos.html');
  assert.match(INDEX, /assets\/css\/resplandor\.css/);
  assert.match(INDEX, /<title>Resplandor Restaurante — La Estrella, Antioquia<\/title>/);
});

test('pos.html es el POS: fuera de los buscadores, y su login de Google vuelve a la misma página que lo abrió (pos.html)', () => {
  assert.equal((POS.match(/<meta name="robots"/g) || []).length, 1, 'una sola meta robots');
  assert.ok(POS.includes('<meta name="robots" content="noindex, nofollow">'));
  assert.match(POS, /<title>Resplandor — POS<\/title>/);
  assert.match(POS, /signInWithOAuth/);
  // Si alguien escribe aquí una ruta fija («/», «/index.html»), el login del POS volvería a la landing.
  assert.match(POS, /redirectTo:\s*window\.location\.origin \+ window\.location\.pathname/);
  assert.doesNotMatch(POS, /rel="canonical"/);
});

test('landing.html es solo la redirección a la raíz: noindex, canonical, location.replace con query y ancla, enlace visible; el meta refresh solo sin JavaScript', () => {
  assert.ok(STUB.includes('<meta name="robots" content="noindex">'));
  assert.ok(STUB.includes(`<link rel="canonical" href="${RAIZ_URL}">`));
  assert.ok(STUB.includes("location.replace('/' + location.search + location.hash)"));
  assert.match(STUB, /<body>[\s\S]*<a href="\/">[^<]+<\/a>/, 'falta el enlace visible de respaldo');
  // El meta refresh existe, pero dentro de <noscript>: no puede llevar la query ni el ancla, y así quien tiene
  // JavaScript no depende de cuál de las dos navegaciones gana en su navegador (location.replace sí los conserva).
  const meta = '<meta http-equiv="refresh" content="0; url=/">';
  assert.ok(STUB.includes(meta), 'falta el meta refresh de quien no tiene JavaScript');
  assert.ok(STUB.includes(`<noscript>${meta}</noscript>`), 'el meta refresh tiene que ir dentro de <noscript>');
  assert.doesNotMatch(sinComentarios(STUB), /<script[^>]*\bsrc=|<link[^>]*rel="stylesheet"|signInWithOAuth/);
  assert.ok(STUB.length < 2000, `la redirección tiene que ser mínima, pesa ${STUB.length} bytes`);
});

test('landing.html redirige de verdad (script real, location falso): conserva query y ancla', () => {
  const codigo = sinComentarios(STUB).match(/<script>([\s\S]*?)<\/script>/)[1];
  const casos = [
    [{ search: '', hash: '' }, '/'],
    [{ search: '', hash: '#x' }, '/#x'],
    [{ search: '?utm_source=maps', hash: '#carta' }, '/?utm_source=maps#carta'],
    [{ search: '?a=1&b=2', hash: '' }, '/?a=1&b=2'],
  ];
  for (const [loc, esperado] of casos) {
    const llamadas = [];
    vm.runInNewContext(codigo, { location: { ...loc, replace: (u) => llamadas.push(u) } });
    assert.deepEqual(llamadas, [esperado], `landing.html${loc.search}${loc.hash}`);
  }
});

test('ninguna página pública enlaza landing.html: la landing es la raíz (solo la redirección lo nombra)', () => {
  for (const pagina of ['index.html', 'carta.html', 'menu.html', 'about.html', 'contact.html', 'privacy.html', '404.html']) {
    assert.doesNotMatch(leer(pagina), /landing\.html/, `${pagina} nombra landing.html`);
  }
  for (const pagina of ['carta.html', 'menu.html', 'about.html', 'contact.html', 'privacy.html', '404.html']) {
    assert.ok(leer(pagina).includes('href="/"'), `${pagina} no enlaza la raíz`);
  }
});

// ───────────────────────── 2. el reenvío del login del POS ─────────────────────────

test('el reenvío del login es el PRIMER script del <head>, y no hay CSS ni scripts (ni un <link>) antes', () => {
  assert.equal(SCRIPTS_HEAD.length >= 1, true);
  const codigo = SCRIPTS_HEAD[0];
  assert.match(codigo, /pos\.html/, 'el primer script en línea del <head> debería ser el reenvío al POS');
  const etiqueta = HEAD_INDEX.lastIndexOf('<script>', HEAD_INDEX.indexOf(codigo)); // la apertura del propio script
  assert.ok(etiqueta > 0);
  assert.doesNotMatch(HEAD_INDEX.slice(0, etiqueta).replace(/<!--[\s\S]*?-->/g, ''), /<(?:script|link|style)\b/, 'algo se carga antes del reenvío');
});

function reenviar(search, hash) {
  const llamadas = [];
  vm.runInNewContext(SCRIPTS_HEAD[0], { location: { search, hash, replace: (u) => llamadas.push(u) } });
  return llamadas;
}

test('el reenvío manda al POS lo que Supabase devuelve a la raíz: ?code= (PKCE, el flujo del POS), #access_token= y #error_description=, con query y ancla intactos', () => {
  const casos = [
    ['', '#access_token=x&refresh_token=y&type=bearer', '/pos.html#access_token=x&refresh_token=y&type=bearer'],
    ['', '#error=access_denied&error_code=401&error_description=Acceso+denegado', '/pos.html#error=access_denied&error_code=401&error_description=Acceso+denegado'],
    ['', '#state=1&error_description=x', '/pos.html#state=1&error_description=x'],
    ['?code=abc123', '', '/pos.html?code=abc123'],
    ['?state=1&code=abc123', '', '/pos.html?state=1&code=abc123'],
    ['?code=abc123', '#algo', '/pos.html?code=abc123#algo'],
  ];
  for (const [search, hash, esperado] of casos) {
    assert.deepEqual(reenviar(search, hash), [esperado], `${search}${hash}`);
  }
});

test('el reenvío deja en paz a la landing: anclas de sección, parámetros de campaña y nombres que solo se le parecen', () => {
  const casos = [
    ['', ''],
    ['', '#hoy'],
    ['', '#celebraciones'],
    ['?utm_source=instagram', ''],
    ['?decode=1', ''], // «code=» dentro de «decode=»
    ['?promo=code=2', ''], // «code=» dentro de un valor
    ['', '#xaccess_token=1'], // «access_token=» dentro de otro nombre
    ['', '#/error_description=1'],
    ['?access_token=1', ''], // en la query no cuenta (Supabase lo pone en el ancla)
    ['', '#code=1'], // en el ancla no cuenta (PKCE lo pone en la query)
  ];
  for (const [search, hash] of casos) {
    assert.deepEqual(reenviar(search, hash), [], `no debería reenviar ${search}${hash}`);
  }
});

test('si el navegador no deja leer location, el reenvío no revienta la landing', () => {
  const location = {
    replace() {},
    get search() {
      throw new Error('SecurityError');
    },
    hash: '',
  };
  assert.doesNotThrow(() => vm.runInNewContext(SCRIPTS_HEAD[0], { location }));
});

// ───────────────────────── 3. el enlace «Abrir POS» ─────────────────────────

test('«Abrir POS»: un solo enlace a pos.html, en el pie, oculto por defecto (atributo hidden) y con el área táctil de 44 px del pie', () => {
  assert.equal((INDEX.match(/href="pos\.html"/g) || []).length, 1, 'un solo enlace a pos.html');
  const m = PIE_INDEX.match(/<p id="abrir-pos" hidden>\s*<a href="pos\.html" class="([^"]*)">Abrir POS<\/a>\s*<\/p>/);
  assert.ok(m, 'no encontré <p id="abrir-pos" hidden><a href="pos.html" …>Abrir POS</a></p> en el <footer>');
  const clases = m[1].split(/\s+/);
  // Las mismas clases que los demás enlaces del pie: arroz sobre telon (16,72:1) y 44 px de alto y ancho.
  for (const c of ['enlace-pie', 'text-arroz', 'underline', 'hover:no-underline']) assert.ok(clases.includes(c), `falta la clase ${c}`);
  assert.match(PIE_INDEX.slice(0, PIE_INDEX.indexOf('id="abrir-pos"')), /<footer class="[^"]*\bbg-telon\b/, 'el enlace tiene que estar sobre telon');
  const componente = leer('assets/css/componentes.css').match(/\.enlace-pie\s*\{([^}]*)\}/)[1];
  assert.match(componente, /min-height:\s*2\.75rem/);
  assert.match(componente, /min-width:\s*2\.75rem/);
});

test('«Abrir POS»: el script no redirige ni abre nada por su cuenta', () => {
  assert.equal(SCRIPTS_PIE.length, 1, 'un solo script en el pie');
  assert.doesNotMatch(SCRIPTS_PIE[0], /location|window\.open|\.click\(|\.submit\(|fetch\(|assign\(/);
});

// Corre el script real del pie con un localStorage falso; devuelve `hidden` del enlace al final.
function abrirPosOculto(claves, { lanza = false } = {}) {
  const el = { hidden: true };
  const localStorage = lanza
    ? {
        get length() {
          throw new Error('SecurityError: acceso denegado');
        },
        key() {
          throw new Error('SecurityError: acceso denegado');
        },
      }
    : { length: claves.length, key: (i) => (i < claves.length ? claves[i] : null) };
  vm.runInNewContext(SCRIPTS_PIE[0], { localStorage, document: { getElementById: (id) => (id === 'abrir-pos' ? el : null) } });
  return el.hidden;
}

test('«Abrir POS» se muestra solo si alguna clave de localStorage calza con /^sb-.+-auth-token$/ (la sesión de supabase-js del mismo origen)', () => {
  assert.equal(abrirPosOculto([]), true, 'sin nada guardado, oculto');
  assert.equal(abrirPosOculto(['menu_device_id', 'menu_cache_2026-09-28']), true, 'las claves del menú no cuentan');
  assert.equal(abrirPosOculto(['sb-lccgehvyymladqvumcez-auth-token-code-verifier']), true, 'el verificador PKCE (un login a medias) no es una sesión');
  assert.equal(abrirPosOculto(['sb--auth-token']), true, 'el proyecto va entre los guiones: .+ pide al menos un carácter');
  assert.equal(abrirPosOculto(['xsb-prueba-auth-token']), true, 'tiene que empezar en sb-');
  assert.equal(abrirPosOculto(['sb-prueba-auth-token']), false, 'la clave de prueba de la verificación');
  assert.equal(abrirPosOculto(['sb-lccgehvyymladqvumcez-auth-token']), false, 'la clave real de supabase-js');
  assert.equal(abrirPosOculto(['menu_device_id', 'otra', 'sb-abc-auth-token']), false, 'aunque no sea la primera clave');
});

test('«Abrir POS» sigue oculto (y no revienta) si localStorage no se puede leer', () => {
  assert.equal(abrirPosOculto([], { lanza: true }), true);
});

// ───────────────────────── 4. lo que los generadores escanean por nombre ─────────────────────────

test('Tailwind escanea la landing (index.html), la carta, el menú y assets/js — nunca el POS (su propio CDN) ni la redirección', () => {
  const entrada = leer('assets/css/entrada-tailwind.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(entrada, /@import "tailwindcss" source\(none\)/, 'sin source(none) Tailwind escanea el repo entero, POS incluido');
  const fuentes = [...entrada.matchAll(/@source\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(fuentes, ['../../index.html', '../../carta.html', '../../menu.html', '../js']);
});

test('scripts/iconos.mjs sin argumentos procesa index.html, carta.html y menu.html (no el POS ni la redirección)', () => {
  const r = spawnSync(process.execPath, [ruta('scripts/iconos.mjs'), '--comprobar'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const salida = r.stdout + r.stderr;
  for (const pagina of ['index.html', 'carta.html', 'menu.html']) assert.match(salida, new RegExp(`${pagina} está al día`));
  assert.doesNotMatch(salida, /landing\.html|pos\.html/);
});
