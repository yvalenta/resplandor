// menu.html NO comparte la sesión del POS (tarea ola-b, parte B4; docs/sdd-cuenta-en-mesa.md §03.8, B4).
//
// El POS guarda la sesión de Google en el localStorage de su origen, que es el mismo de menu.html. Con las
// opciones por defecto, supabase-js de menu.html la leería y pediría `menus` COMO esa cuenta. Desde que el POS
// tiene la compuerta de personal (`solo_personal`, restrictiva), una tablet con la sesión de alguien que no
// está en `personal` vería la votación sin menús. La votación es pública (anon): el cliente de menu.html va
// sin sesión (persistSession: false), como el de carta.html.
//
// Se corre el <script> inline de menu.html de verdad en un vm, con un `createClient` que anota sus opciones.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { RAIZ_REAL, crearSitio } from './_sitio.mjs';

const leerReal = (rel) => fs.readFileSync(path.join(RAIZ_REAL, rel), 'utf8');
const plano = (x) => JSON.parse(JSON.stringify(x));

/** `menuCal()` de menu.html en un vm, con el menú encendido y un createClient espía. */
function menuEnVm() {
  const html = leerReal('menu.html');
  const codigo = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((x) => x[1]).find((t) => t.includes('function menuCal'));
  assert.ok(codigo, 'no encontré el <script> inline de menu.html con menuCal()');
  const clientes = [];
  const caja = {
    console,
    setInterval() {},
    fetch: async () => { throw new Error('sin red'); },
    navigator: { onLine: true },
    localStorage: { getItem: () => null, setItem() {} },
    document: { title: '', head: { appendChild() {} }, body: { style: {} }, addEventListener() {}, querySelector: () => ({ setAttribute() {} }), createElement: () => ({ setAttribute() {} }) },
    addEventListener() {},
  };
  caja.window = caja;
  caja.globalThis = caja;
  caja.supabase = { createClient: (url, llave, opciones) => { clientes.push({ url, llave, opciones }); return { channel: () => ({ on() { return this; }, subscribe() { return this; } }), from: () => ({ select: () => ({ eq: () => ({}) }) }) }; } };
  const sitio = crearSitio({ menuDeHoy: true, almuerzoProgramado: false });
  vm.createContext(caja);
  vm.runInContext(sitio.leer('assets/js/local.js'), caja, { filename: 'assets/js/local.js' });
  vm.runInContext(`${codigo}\n;globalThis.__menuCal = menuCal;`, caja, { filename: 'menu.html (inline)' });
  return { menuCal: caja.__menuCal, clientes };
}

test('menu.html: el cliente de Supabase se crea SIN sesión (persistSession: false, sin refresco ni lectura de la URL): no hereda la del POS', () => {
  const { menuCal, clientes } = menuEnVm();
  const c = menuCal();
  assert.equal(c.apagada, false);
  assert.equal(clientes.length, 1, 'un solo cliente');
  const opciones = plano(clientes[0].opciones);
  assert.ok(opciones && opciones.auth, 'createClient sin opciones: leería la sesión del POS (localStorage, mismo origen)');
  assert.equal(opciones.auth.persistSession, false);
  assert.equal(opciones.auth.autoRefreshToken, false);
  assert.equal(opciones.auth.detectSessionInUrl, false);
  assert.match(clientes[0].url, /^https:\/\/lccgehvyymladqvumcez\.supabase\.co$/);
});

test('menu.html: ninguna llamada a createClient del archivo queda sin opciones de auth (ni una segunda por otro camino)', () => {
  const html = leerReal('menu.html').replace(/\/\/[^\n]*/g, ''); // sin comentarios de línea
  const llamadas = [...html.matchAll(/createClient\(([^;]*?)\);/gs)].map((m) => m[1]);
  assert.ok(llamadas.length >= 1, 'no encontré createClient en menu.html');
  for (const l of llamadas) assert.match(l, /persistSession:\s*false/, `createClient sin persistSession: false → createClient(${l.slice(0, 80)}…)`);
});

test('menu.html no lee ni escribe la sesión del POS: ninguna clave sb-*-auth-token de localStorage, ni auth.getSession/getUser', () => {
  const html = leerReal('menu.html').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(html, /sb-[\w-]*-auth-token/);
  assert.doesNotMatch(html, /\.auth\.(getSession|getUser|signIn|signOut|onAuthStateChange)/);
});
