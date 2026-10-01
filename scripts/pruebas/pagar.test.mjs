// «Pagar» y el escritorio de carta.html (tarea 2026-09-30-carta-escritorio-pagar).
//
// El modelo (Yonatan, 2026-09-30): «Pagar» NO cobra ni muestra datos de pago. El cliente elige cómo
// (qr | transferencia | efectivo) y eso CREA UNA ALERTA para el personal (Edge Function `alerta`);
// el mesero llega con el QR impreso o el datáfono, da los datos de la cuenta o recibe el efectivo, y
// cobra y cierra en el POS. Sin propina en ningún lado («eso no se hace acá»). El botón vive detrás
// de RESPLANDOR.funciones.pagarEnMesa (assets/js/local.js), apagada hasta que `alerta` esté desplegada.
//
// Tres partes, como funciones.test.mjs / desborde.test.mjs:
//   1. ESTÁTICA (corre siempre, también en CI): sin propina; ningún dato bancario ni QR en la
//      página; todo lo de Pagar dentro de <template x-if="…pagarEnMesa…">; los íconos de los tres
//      métodos están en el sprite; la bandera existe y no se anuncia a los agentes.
//   2. EL CONTRATO DEL POST, con el <script> inline de carta.html corrido en un `vm` y un fetch
//      simulado (corre siempre): URL, método, cabeceras, cuerpo, qué se muestra por cada respuesta
//      (200, 400, 404, 409, 429, 500, sin red, tiempo agotado), que nada se reintente solo, que un
//      método inventado no salga y que apagada la función no se llame a nada.
//   3. EN NAVEGADOR (solo si hay Playwright y un Chromium, ver _navegador.mjs), con la red simulada
//      (nunca se toca Supabase): el flujo entero a 390 px (hoja), a 1280 y a 1440 px (panel), el
//      interruptor apagado, el escritorio (riel, panel, sin barra de abajo, columnas de platos), sin
//      desborde horizontal y sin errores de consola.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';
import { conBanderas } from './_sitio.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const sinScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const URL_ALERTA = 'https://lccgehvyymladqvumcez.supabase.co/functions/v1/alerta';
const METODOS = ['qr', 'transferencia', 'efectivo'];

/** Quita cada <template x-if="…"> cuya condición cumpla `coincide`, con sus <template> anidados. */
function quitarPlantillas(html, coincide) {
  let salida = '';
  let i = 0;
  const reAbre = /<template\b[^>]*>/g;
  for (;;) {
    reAbre.lastIndex = i;
    const m = reAbre.exec(html);
    if (!m) return salida + html.slice(i);
    const cond = m[0].match(/\bx-if="([^"]*)"/);
    if (!cond || !coincide(cond[1])) {
      salida += html.slice(i, m.index + m[0].length);
      i = m.index + m[0].length;
      continue;
    }
    let profundidad = 1;
    const re = /<template\b[^>]*>|<\/template>/g;
    re.lastIndex = m.index + m[0].length;
    let t;
    while ((t = re.exec(html))) {
      profundidad += t[0].startsWith('</') ? -1 : 1;
      if (profundidad === 0) break;
    }
    assert.equal(profundidad, 0, `un <template x-if="${cond[1]}"> no cierra`);
    salida += html.slice(i, m.index);
    i = re.lastIndex;
  }
}

// ───────────────────────── 1. estática ─────────────────────────

test('sin propina en ningún lado: ni carta.html (marcado, texto y comentarios) ni su CSS ni local.js', () => {
  for (const archivo of ['carta.html', 'assets/css/carta-menu.css', 'assets/js/local.js', 'assets/js/carta-respaldo.js']) {
    assert.doesNotMatch(leer(archivo), /propina|gratuity|\btip\b/i, `${archivo} habla de propina («eso no se hace acá», Yonatan, 2026-09-30)`);
  }
});

test('la página no muestra datos de pago: ni bancos, ni números de cuenta, ni un QR dibujado, ni llaves', () => {
  const html = sinScripts(sinComentarios(leer('carta.html')));
  const aside = html.slice(html.indexOf('<aside class="cuenta-ventana'), html.indexOf('</aside>'));
  assert.ok(aside.length > 500, 'no encontré el <aside> de «Mi cuenta» en carta.html');
  assert.doesNotMatch(html, /bancolombia|davivienda|nequi|daviplata|nu bank|bre-b|breb|llave\b|n[uú]mero de cuenta|cuenta de ahorros|cuenta corriente|\biban\b|\bclabe\b|\bnit\b/i);
  assert.doesNotMatch(aside, /\d{8,}/, 'un número largo (¿cuenta, teléfono?) dentro de «Mi cuenta»');
  assert.doesNotMatch(html, /<img\b[^>]*qr/i, 'un <img> de QR en la página');
  assert.doesNotMatch(html, /data:image\//, 'una imagen incrustada (¿un QR?) en la página');
  // El script tampoco lleva un banco ni una cuenta: solo los tres métodos por nombre.
  const script = leer('carta.html').slice(leer('carta.html').indexOf('<script>'));
  assert.doesNotMatch(script, /bancolombia|davivienda|nequi|daviplata|\d{10,}/i);
});

test('todo lo de Pagar va dentro de <template x-if="…pagarEnMesa…">: apagada, el botón y las opciones ni existen en el DOM', () => {
  const html = sinScripts(sinComentarios(leer('carta.html')));
  const plantillas = html.match(/<template\b[^>]*x-if="[^"]*\bpagarEnMesa\b[^"]*"/g) || [];
  assert.ok(plantillas.length >= 2, `se esperaban al menos 2 <template x-if="…pagarEnMesa…"> (elegir el método y el botón/estado), hay ${plantillas.length}`);
  const visible = quitarPlantillas(html, (cond) => /\bpagarEnMesa\b/.test(cond));
  for (const rastro of [/Pagar\b/, /pago-opcion/, /pago-listo/, /pago-aviso/, /avisarPago/, /pedirPago/, /metodosPago/, /¿Cómo quieres pagar/, /Cambiar método/, /le avisamos al mesero/i, /#i-wallet/, /#i-qr-code/]) {
    assert.doesNotMatch(visible, rastro, `con pagarEnMesa apagada, carta.html todavía deja ${rastro} fuera de sus plantillas`);
  }
});

test('el interruptor pagarEnMesa existe en local.js, es booleano y carta.html lo lee de ahí (no hay otra fuente)', () => {
  const caja = { console };
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leer('assets/js/local.js'), caja, { filename: 'assets/js/local.js' });
  assert.equal(typeof caja.RESPLANDOR.funciones.pagarEnMesa, 'boolean');
  assert.match(leer('carta.html'), /get pagarEnMesa\(\)[^}]*window\.RESPLANDOR\.funciones\.pagarEnMesa/);
  assert.match(leer('assets/js/local.js'), /pagarEnMesa:\s*(true|false),/);
});

test('el sprite de carta.html trae el ícono de cada método y el de Pagar (qr-code, landmark, banknote, wallet) y el del aviso (circle-check)', () => {
  const html = leer('carta.html');
  const sprite = html.slice(html.indexOf('<!-- iconos:inicio -->'), html.indexOf('<!-- iconos:fin -->'));
  for (const id of ['qr-code', 'landmark', 'banknote', 'wallet', 'circle-check']) {
    assert.match(sprite, new RegExp(`<symbol id="i-${id}"`), `falta #i-${id} en el sprite (node scripts/iconos.mjs)`);
  }
});

// ───────────────────────── 2. el contrato del POST (vm) ─────────────────────────

/** `carta()` de carta.html corrido en un vm: sin Alpine ni DOM, con fetch simulado y las banderas que se pidan. */
function cartaEnVm({ pagarEnMesa, fetch }) {
  const html = leer('carta.html');
  const inicio = html.indexOf('<script>');
  const fin = html.indexOf('</script>', inicio);
  assert.ok(inicio !== -1 && fin !== -1, 'no encontré el <script> inline de carta.html');
  const bloque = html.slice(inicio + '<script>'.length, fin);
  assert.match(bloque, /function carta\(\)/);
  const llamadas = [];
  const caja = {
    console,
    Date,
    JSON,
    AbortController,
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    fetch: async (url, init) => { llamadas.push({ url: String(url), init }); return fetch(String(url), init, llamadas.length); },
  };
  caja.window = { RESPLANDOR: { funciones: { pagarEnMesa } }, addEventListener() {}, removeEventListener() {} };
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(bloque, caja, { filename: 'carta.html (inline, extraído)' });
  const c = vm.runInContext('carta()', caja, { filename: 'carta.html (inline, extraído)' });
  c.mesa = 12;
  c.token = TOKEN;
  c.$nextTick = () => {}; // sin Alpine no hay DOM al que llevar el foco ni la vista: el foco se prueba en el navegador
  c.cuenta = { estado: 'ok', items: [{ nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 }], total: 46000, abiertaEn: '2026-09-30T17:41:00Z', error: '' };
  return { c, llamadas };
}

const respuesta = (estado, cuerpo) => ({ ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo });
const aplana = (x) => JSON.parse(JSON.stringify(x));

test('Pagar: el POST a /functions/v1/alerta lleva {m, k, metodo} y las mismas cabeceras que la carta usa para «cuenta»', async () => {
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: async (_u, init) => respuesta(200, { ok: true, metodo: JSON.parse(init.body).metodo, creada_en: '2026-09-30T18:00:00Z' }) });
  await c.avisarPago('transferencia');
  assert.equal(llamadas.length, 1);
  const { url, init } = llamadas[0];
  assert.equal(url, URL_ALERTA);
  assert.equal(init.method, 'POST');
  const llave = leer('carta.html').match(/const SUPABASE_KEY = '([^']+)'/)[1];
  assert.deepEqual(aplana(init.headers), { apikey: llave, Authorization: `Bearer ${llave}`, Accept: 'application/json', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(init.body), { m: 12, k: TOKEN, metodo: 'transferencia' });
  assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ['k', 'm', 'metodo'], 'el cuerpo no lleva nada más (ni total, ni propina, ni datos de pago)');
  assert.equal(init.cache, 'no-store');
  assert.ok(init.signal, 'con un AbortController: un fetch que se cuelga no deja la hoja esperando para siempre');
});

test('Pagar: la respuesta 200 deja «avisado» con el método que confirma el servidor (un segundo toque cambia el de la misma alerta)', async () => {
  let n = 0;
  const { c } = cartaEnVm({ pagarEnMesa: true, fetch: async (_u, init) => respuesta(200, { ok: true, metodo: JSON.parse(init.body).metodo, creada_en: `2026-09-30T18:0${++n}:00Z` }) });
  c.pedirPago();
  assert.equal(c.pago.vista, 'elegir');
  await c.avisarPago('qr');
  assert.deepEqual([c.pago.vista, c.pago.metodo, c.pago.enviando, c.pago.error, c.pago.cuentaDe], ['listo', 'qr', null, '', '2026-09-30T17:41:00Z']);
  assert.equal(c.metodoPago.con, 'QR');
  c.cambiarMetodo();
  assert.equal(c.pago.vista, 'elegir', '«Cambiar método» vuelve a las opciones');
  await c.avisarPago('efectivo');
  assert.deepEqual([c.pago.vista, c.pago.metodo], ['listo', 'efectivo']);
  assert.equal(c.metodoPago.con, 'efectivo');
  c.cambiarMetodo();
  c.volverDePago();
  assert.equal(c.pago.vista, 'listo', '«Volver» después de avisar regresa al estado de avisado, no borra el aviso');
});

test('Pagar: si el servidor contesta otro método válido, manda el del servidor; si contesta uno inventado, el que se tocó', async () => {
  const a = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, { ok: true, metodo: 'efectivo' }) });
  await a.c.avisarPago('qr');
  assert.equal(a.c.pago.metodo, 'efectivo');
  const b = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, { ok: true, metodo: 'bitcoin' }) });
  await b.c.avisarPago('qr');
  assert.equal(b.c.pago.metodo, 'qr');
});

const ERRORES = [
  { nombre: '409 (sin cuenta abierta)', respuesta: () => respuesta(409, { error: 'sin cuenta' }), texto: /todavía no hay una cuenta abierta/i },
  { nombre: '429 (rate-limit)', respuesta: () => respuesta(429, { error: 'demasiadas solicitudes' }), texto: /mucha gente avisando.*vuelve a tocar/i },
  { nombre: '400 (enlace inválido)', respuesta: () => respuesta(400, { error: 'enlace inválido' }), texto: /enlace ya no sirve/i },
  { nombre: '404 (enlace inválido)', respuesta: () => respuesta(404, { error: 'enlace inválido' }), texto: /enlace ya no sirve/i },
  { nombre: '500', respuesta: () => respuesta(500, { error: 'boom' }), texto: /no pudimos avisar al mesero/i },
  { nombre: '500 sin cuerpo JSON', respuesta: () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } }), texto: /no pudimos avisar al mesero/i },
  { nombre: 'sin red', respuesta: () => { throw new TypeError('Failed to fetch'); }, texto: /sin conexión/i },
  { nombre: 'tiempo agotado', respuesta: () => { const e = new Error('abortado'); e.name = 'AbortError'; throw e; }, texto: /la red tardó demasiado/i },
];

for (const caso of ERRORES) {
  test(`Pagar con ${caso.nombre}: se queda en las opciones con un aviso tranquilo, no avisa a nadie, no reintenta solo y deja tocar de nuevo`, async () => {
    const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: async () => caso.respuesta() });
    c.pedirPago();
    await c.avisarPago('qr');
    assert.equal(c.pago.vista, 'elegir', 'no pasa a «avisado»');
    assert.equal(c.pago.metodo, null, 'no queda ningún método como avisado');
    assert.match(c.pago.error, caso.texto);
    assert.equal(c.pago.enviando, null, 'los botones vuelven a quedar libres (reintento manual)');
    assert.equal(c.pago.cuentaDe, null);
    // Ningún reintento automático: la única llamada es la del toque (y la del 409 es a `cuenta`, para refrescar la hoja).
    assert.equal(llamadas.filter((l) => l.url.endsWith('/functions/v1/alerta')).length, 1);
    const ok = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, { ok: true, metodo: 'qr' }) });
    ok.c.pago = { ...c.pago };
    await ok.c.avisarPago('qr');
    assert.equal(ok.c.pago.vista, 'listo');
    assert.equal(ok.c.pago.error, '', 'un toque que sale bien borra el aviso de error');
  });
}

test('Pagar con 409: refresca la cuenta (la hoja se entera de que ya no hay cuenta abierta)', async () => {
  const { c, llamadas } = cartaEnVm({
    pagarEnMesa: true,
    fetch: async (url) => (url.includes('/functions/v1/cuenta') ? respuesta(200, { mesa: 12, abierta: false }) : respuesta(409, { error: 'sin cuenta' })),
  });
  c.pedirPago();
  await c.avisarPago('qr');
  await new Promise((r) => setImmediate(r)); // cargarCuenta(true) corre sin esperar
  await new Promise((r) => setImmediate(r));
  assert.ok(llamadas.some((l) => l.url.includes('/functions/v1/cuenta?m=12&k=' + TOKEN)), 'pidió la cuenta de nuevo');
  assert.equal(c.cuenta.estado, 'vacia');
  assert.equal(c.pago.vista, 'inicio', 'sin cuenta abierta el aviso se olvida');
});

test('Pagar: un método que no es qr/transferencia/efectivo no sale (ni «propina», ni «tarjeta»), y dos toques seguidos hacen UN solo aviso', async () => {
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, { ok: true, metodo: 'qr' }) });
  for (const raro of ['propina', 'tarjeta', 'QR', '', undefined, null, '__proto__', 'qr,efectivo']) await c.avisarPago(raro);
  assert.deepEqual(llamadas, [], 'ningún método inventado llega a la red');
  assert.deepEqual(aplana(c.metodosPago.map((o) => o.id)), METODOS);
  await Promise.all([c.avisarPago('qr'), c.avisarPago('qr'), c.avisarPago('efectivo')]);
  assert.equal(llamadas.length, 1, 'mientras hay un aviso en vuelo, los otros toques no hacen nada');
});

test('Pagar apagada (pagarEnMesa en false): avisarPago no hace NINGUNA llamada, aunque se invoque a mano', async () => {
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: false, fetch: async () => respuesta(200, { ok: true, metodo: 'qr' }) });
  assert.equal(c.pagarEnMesa, false);
  for (const m of METODOS) await c.avisarPago(m);
  assert.deepEqual(llamadas, []);
  assert.equal(c.pago.vista, 'inicio');
  assert.equal(c.eligiendoPago, false);
});

test('Pagar sin enlace válido (sin mesa o sin token) no hace ninguna llamada', async () => {
  for (const campo of ['mesa', 'token']) {
    const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, { ok: true, metodo: 'qr' }) });
    c[campo] = null;
    await c.avisarPago('qr');
    assert.deepEqual(llamadas, [], `sin ${campo}`);
  }
});

test('el aviso se olvida cuando la cuenta a la que se avisó cierra, o cuando se abre otra en la mesa', async () => {
  let cuerpo = { mesa: 12, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items: [{ nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 }], total: 46000 };
  const { c } = cartaEnVm({
    pagarEnMesa: true,
    fetch: async (url) => (url.includes('/functions/v1/alerta') ? respuesta(200, { ok: true, metodo: 'qr' }) : respuesta(200, cuerpo)),
  });
  await c.avisarPago('qr');
  assert.equal(c.pago.vista, 'listo');
  await c.cargarCuenta(true);
  assert.equal(c.pago.vista, 'listo', 'la misma cuenta: el aviso sigue');
  cuerpo = { ...cuerpo, abierta_en: '2026-09-30T19:02:00Z' };
  await c.cargarCuenta(true);
  assert.equal(c.pago.vista, 'inicio', 'otra cuenta en la misma mesa: el aviso de la anterior no vale');
  await c.avisarPago('efectivo');
  assert.equal(c.pago.vista, 'listo');
  cuerpo = { mesa: 12, abierta: false };
  await c.cargarCuenta(true);
  assert.deepEqual([c.cuenta.estado, c.pago.vista, c.pago.metodo], ['vacia', 'inicio', null], 'la cuenta cerró: se olvida');
});

test('los tres métodos de la página son los de la función: qr, transferencia y efectivo, cada uno con ícono y una línea de lo que pasa; ninguno dice cuánto ni a dónde', () => {
  const { c } = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, {}) });
  assert.deepEqual(aplana(c.metodosPago.map((o) => o.id)), METODOS);
  assert.deepEqual(aplana(c.metodosPago.map((o) => o.icono)), ['qr-code', 'landmark', 'banknote']);
  for (const o of c.metodosPago) {
    assert.ok(o.titulo && o.con && o.detalle, `el método ${o.id} tiene título, «con …» y detalle`);
    assert.doesNotMatch(`${o.titulo} ${o.con} ${o.detalle}`, /\d|propina|\$/, `el método ${o.id} no lleva cifras ni propina`);
  }
});

// ───────────────────────── 3. en navegador ─────────────────────────

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivoNavegador = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidor = await servirRaiz(RAIZ);
  } catch (e) {
    motivoNavegador = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await new Promise((resolver) => servidor.close(resolver));
});

const saltar = () => (navegador ? false : `navegador no disponible: ${motivoNavegador}`);
const FILAS_CARTA = (() => {
  const caja = {};
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leer('assets/js/carta-respaldo.js'), caja);
  return JSON.parse(JSON.stringify(caja.RESPLANDOR_CARTA_RESPALDO.filas));
})();
const ITEMS = [
  { nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 },
  { nombre: 'Hamburguesa Resplandor', precio: 32000, cantidad: 1 },
  { nombre: 'Jugo natural en agua', precio: 7000, cantidad: 3 },
];
const TOTAL = ITEMS.reduce((s, i) => s + i.precio * i.cantidad, 0);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const LOCAL_JS = leer('assets/js/local.js');

/**
 * Abre carta.html con la red simulada. `pagar` pone pagarEnMesa en true o en false (interceptando
 * local.js, sin tocar el repo); `alerta(n, cuerpo)` decide la respuesta del n-ésimo POST a `alerta`.
 * Devuelve la página, los POST vistos y los errores de consola (sin los de Google Fonts, que dependen de la red).
 */
async function abrir({ ancho, alto = 800, mesa = true, pagar = true, alerta, cuenta = true, movil = false, items = ITEMS }) {
  const total = items.reduce((suma, i) => suma + i.precio * i.cantidad, 0);
  // `movil`: un celular de verdad (táctil, sin hover), p. ej. apaisado, donde el ancho solo no lo dice.
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, ...(movil ? { isMobile: true, hasTouch: true } : {}) });
  const page = await contexto.newPage();
  const consola = [];
  const posts = [];
  const cuentas = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || '')) consola.push(m.text()); });
  page.on('pageerror', (e) => consola.push(`pageerror: ${e.message}`));
  await page.route(/\.supabase\.co\//, (r) => {
    const req = r.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (url.includes('/rest/v1/carta_publica')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(FILAS_CARTA) });
    if (url.includes('/functions/v1/cuenta')) {
      cuentas.push(url);
      const cuerpo = cuenta ? { mesa: 7, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items, total } : { mesa: 7, abierta: false };
      return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(cuerpo) });
    }
    if (url.includes('/functions/v1/alerta')) {
      const cuerpo = JSON.parse(req.postData() || '{}');
      posts.push({ url, metodo: req.method(), cabeceras: req.headers(), cuerpo });
      const a = alerta ? alerta(posts.length, cuerpo) : { status: 200, body: { ok: true, metodo: cuerpo.metodo, creada_en: '2026-09-30T18:00:00Z' } };
      if (a.abortar) return r.abort('failed');
      return r.fulfill({ status: a.status, contentType: 'application/json', headers: CORS, body: JSON.stringify(a.body) });
    }
    return r.fulfill({ status: 404, headers: CORS, body: '{}' });
  });
  await page.route('**/assets/js/local.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: conBanderas(LOCAL_JS, { pagarEnMesa: pagar }) }));
  await page.goto(`http://127.0.0.1:${servidor.address().port}/carta.html${mesa ? `?m=7&k=${TOKEN}` : ''}`, { waitUntil: 'load' });
  const alpine = await page.waitForFunction(() => window.Alpine && document.querySelector('[x-data]') && document.querySelector('[x-data]')._x_dataStack, null, { timeout: 8000 }).then(() => true, () => false);
  return { contexto, page, consola, posts, cuentas, alpine };
}

const desborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const visible = (page, selector) => page.locator(selector).first().isVisible();
const columnas = (page, selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).gridTemplateColumns.split(' ').length, selector);

/** Espera a que el scroll suave de una pestaña termine (scrollY igual en 5 lecturas seguidas) y deja un instante al observador. */
async function esperarScrollQuieto(page) {
  let igual = 0;
  let ultimo = -1;
  for (let i = 0; i < 80 && igual < 5; i++) {
    await page.waitForTimeout(100);
    const y = await page.evaluate(() => Math.round(scrollY));
    igual = y === ultimo ? igual + 1 : 0;
    ultimo = y;
  }
  await page.waitForTimeout(400);
}

async function conCarta(t, opciones, cuerpo) {
  const c = await abrir(opciones);
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    await cuerpo(c);
  } finally {
    await c.contexto.close();
  }
}

test('carta con la función APAGADA, a 390 y a 1280 px: la cuenta se ve, pero no hay «Pagar», ni opciones, ni una sola llamada a alerta', { skip: saltar() }, async (t) => {
  for (const ancho of [390, 1280]) {
    await conCarta(t, { ancho, pagar: false }, async ({ page, posts, consola }) => {
      if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.getByText('Menú Resplandor', { exact: true }).last().waitFor({ state: 'visible' });
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      assert.equal(await page.getByRole('button', { name: /Pagar/ }).count(), 0, `a ${ancho} px hay un botón «Pagar» con la función apagada`);
      assert.equal(await page.locator('.pago-opcion, .pago-listo, .pago-aviso').count(), 0);
      assert.equal(await page.getByText(/Pagar|Cómo quieres pagar|le avisamos al mesero/i).count(), 0);
      assert.deepEqual(posts, []);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  }
});

test('390 px, función encendida: la hoja → «Pagar» → tres opciones grandes → avisar → «Listo, le avisamos al mesero» → «Cambiar método»', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async ({ page, posts, consola }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    const dialogo = page.getByRole('dialog');
    await dialogo.waitFor({ state: 'visible' });
    assert.equal(await dialogo.getAttribute('aria-modal'), 'true');
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();

    // Las tres opciones, grandes (≥ 56 px de alto y todo el ancho), con su ícono del sprite.
    const opciones = page.locator('.pago-opcion');
    await opciones.first().waitFor({ state: 'visible' });
    assert.equal(await opciones.count(), 3);
    assert.deepEqual(await opciones.locator('span.block').evaluateAll((els) => els.filter((e) => e.classList.contains('font-semibold')).map((e) => e.textContent.trim())), ['QR', 'Transferencia', 'Efectivo']);
    for (let i = 0; i < 3; i++) {
      const caja = await opciones.nth(i).boundingBox();
      assert.ok(caja.height >= 56 && caja.width >= 300, `la opción ${i} mide ${caja.width}×${caja.height}`);
      assert.match(await opciones.nth(i).locator('use').first().getAttribute('href'), /^#i-(qr-code|landmark|banknote)$/);
    }
    assert.equal(await page.getByText(/propina/i).count(), 0);
    assert.equal(posts.length, 0, 'abrir las opciones no avisa a nadie: solo tocar un método');

    await opciones.filter({ hasText: 'Transferencia' }).click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, URL_ALERTA);
    assert.equal(posts[0].metodo, 'POST');
    assert.deepEqual(posts[0].cuerpo, { m: 7, k: TOKEN, metodo: 'transferencia' });
    assert.equal(posts[0].cabeceras['content-type'], 'application/json');
    assert.match(posts[0].cabeceras.authorization, /^Bearer sb_publishable_/);
    assert.ok(posts[0].cabeceras.apikey);
    await page.getByText('Vas a pagar con').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-listo').innerText(), /Vas a pagar con transferencia/);
    // La cuenta sigue a la vista y no hay nada de pago en la página.
    assert.equal(await visible(page, '.cuenta-total'), true);

    await page.getByRole('button', { name: 'Cambiar método' }).click();
    assert.equal(await page.locator('.pago-opcion--actual').innerText().then((x) => /Transferencia/.test(x)), true, 'el método avisado queda marcado');
    await page.locator('.pago-opcion').filter({ hasText: 'Efectivo' }).click();
    await page.getByText(/Vas a pagar con efectivo/).waitFor({ state: 'visible' });
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1].cuerpo, { m: 7, k: TOKEN, metodo: 'efectivo' });

    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('390 px: un 429 deja las opciones, con un aviso tranquilo y SIN reintento automático; tocar otra vez (manual) lo vuelve a intentar', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, alerta: (n, cuerpo) => (n === 1 ? { status: 429, body: { error: 'demasiadas solicitudes' } } : { status: 200, body: { ok: true, metodo: cuerpo.metodo, creada_en: 'x' } }) }, async ({ page, posts }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').filter({ hasText: 'QR' }).click();
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-aviso').innerText(), /mucha gente avisando/i);
    await page.waitForTimeout(1500); // nada se reintenta solo
    assert.equal(posts.length, 1);
    assert.equal(await visible(page, '.pago-listo'), false);
    await page.locator('.pago-opcion').filter({ hasText: 'QR' }).click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.equal(posts.length, 2);
  });
});

test('390 px: sin red (el POST falla) y con 409 (sin cuenta abierta) se explican en las opciones, sin cerrar nada', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, alerta: () => ({ abortar: true }) }, async ({ page, posts }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').filter({ hasText: 'Efectivo' }).click();
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-aviso').innerText(), /sin conexión/i);
    assert.equal(await visible(page, '.pago-opcion'), true);
  });
  await conCarta(t, { ancho: 390, alto: 844, alerta: () => ({ status: 409, body: { error: 'sin cuenta' } }) }, async ({ page }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').filter({ hasText: 'QR' }).click();
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-aviso').innerText(), /todavía no hay una cuenta abierta/i);
  });
});

test('390 px: el celular sigue como siempre — barra de abajo con «Ver mi cuenta · Mesa N · total», tabs pegajosas arriba, hoja con asa, cerrar y «Listo»', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async ({ page }) => {
    const barra = page.getByRole('button', { name: /Ver mi cuenta/ });
    assert.equal(await barra.isVisible(), true);
    await barra.waitFor({ state: 'visible' });
    assert.equal(await visible(page, 'aside[aria-label="Mi cuenta"]'), false, 'la cuenta no está abierta hasta tocar la barra');
    assert.equal(await visible(page, '.carta-riel-titulo'), false, 'el título del riel es solo de escritorio');
    assert.equal(await page.locator('.tab-icono').first().isVisible(), false, 'los íconos de las tabs son solo de escritorio');
    const nav = await page.locator('nav[aria-label="Secciones de la carta"]').evaluate((e) => { const c = getComputedStyle(e); return { posicion: c.position, top: c.top }; });
    assert.deepEqual(nav, { posicion: 'sticky', top: '0px' });
    assert.equal(await columnas(page, '.carta-platos'), 1, 'platos en una columna');
    await barra.click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Cerrar' }).isVisible(), true);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await barra.click();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await desborde(page), 0);
  });
});

for (const ancho of [1280, 1440]) {
  test(`${ancho} px con mesa: riel de categorías a la izquierda, la carta al centro, «Mi cuenta» como panel a la derecha siempre abierto y SIN barra de abajo`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto: ancho === 1280 ? 800 : 900 }, async ({ page, consola, cuentas }) => {
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      const caja = async (s) => page.locator(s).first().boundingBox();
      const riel = await caja('.carta-riel');
      const main = await caja('main');
      const panel = await caja('.cuenta-hoja');
      assert.ok(riel.x < main.x && main.x + main.width <= panel.x + 1, `riel (${riel.x}) < carta (${main.x}, ${main.width}) < panel (${panel.x}) en una sola fila`);
      assert.ok(Math.abs(panel.y - main.y) < 40, 'el panel arranca a la altura de la carta');
      assert.ok(main.width >= 600, `la carta mide ${main.width} px`);
      assert.ok(panel.width >= 330 && panel.width <= 390, `el panel mide ${panel.width} px`);
      assert.ok(panel.y + panel.height <= (ancho === 1280 ? 800 : 900), 'el panel entero cabe en la ventana sin bajar');
      // Sin la barra de abajo, sin hoja modal: es un panel, no un diálogo.
      assert.equal(await visible(page, 'div.fixed.bottom-0'), false);
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.locator('.cuenta-hoja').getAttribute('aria-modal'), null);
      assert.equal(await page.getByRole('button', { name: 'Cerrar' }).isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Listo', exact: true }).isVisible(), false);
      assert.equal(await page.getByText('En vivo').first().isVisible(), true);
      // Sticky: al bajar por la carta, el riel y el panel se quedan arriba.
      await page.evaluate(() => scrollTo(0, 700));
      await page.waitForTimeout(200);
      const riel2 = await caja('.carta-riel');
      const panel2 = await caja('.cuenta-hoja');
      assert.ok(riel2.y >= 0 && riel2.y < 40 && panel2.y >= 0 && panel2.y < 40, `riel y=${riel2.y}, panel y=${panel2.y} después de bajar 700 px`);
      // La cuenta se pidió sola, sin tocar nada.
      assert.ok(cuentas.length >= 1);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  });
}

test('1280 px con mesa: una columna de platos (la carta mide ≈ 660 px); 1440 px: dos, y el último plato impar ocupa las dos', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1280 }, async ({ page }) => {
    assert.equal(await columnas(page, '.carta-platos'), 1);
  });
  await conCarta(t, { ancho: 1440, alto: 900 }, async ({ page }) => {
    assert.equal(await columnas(page, '.carta-platos'), 2);
    const cajas = await page.locator('#entradas .carta-plato').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; }));
    assert.equal(cajas.length % 2, 1, '«Entradas» tiene un número impar de platos (si cambia la carta, esta prueba elige otra sección)');
    const ultimo = cajas[cajas.length - 1];
    assert.equal(ultimo.x, cajas[0].x);
    assert.ok(ultimo.w > cajas[0].w * 1.9, 'el plato que quedaría solo ocupa las dos columnas');
    assert.ok(cajas[0].w >= 360, `cada plato mide ≥ 360 px (mide ${cajas[0].w})`);
  });
});

test('1280 px SIN mesa: riel + carta en dos columnas de platos, sin panel ni barra de abajo, y la acción de la barra vive en el riel (reservar por WhatsApp)', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1280, mesa: false }, async ({ page, consola, posts, cuentas }) => {
    assert.equal(await columnas(page, '.carta-platos'), 2);
    assert.equal(await visible(page, 'aside[aria-label="Mi cuenta"]'), false);
    assert.equal(await visible(page, 'div.fixed.bottom-0'), false);
    const accion = page.locator('.carta-riel-accion a');
    assert.equal(await accion.isVisible(), true);
    assert.match(await accion.getAttribute('href'), /^https:\/\/wa\.me\/573225542434/);
    assert.deepEqual(cuentas, [], 'sin mesa no se pide ninguna cuenta');
    assert.deepEqual(posts, []);
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

for (const ancho of [1280, 1440]) {
  test(`${ancho} px, función encendida: «Pagar» en el panel → opciones → avisar → «Listo, le avisamos al mesero» → «Cambiar método»; mismo contrato del POST`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto: ancho === 1280 ? 800 : 900 }, async ({ page, posts, consola }) => {
      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      assert.equal(await page.locator('.pago-opcion').count(), 3);
      assert.equal(await visible(page, '.cuenta-total'), true, 'el total sigue a la vista mientras se elige');
      assert.equal(posts.length, 0);
      await page.locator('.pago-opcion').filter({ hasText: 'QR' }).click();
      await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
      assert.deepEqual(posts.map((p) => p.cuerpo), [{ m: 7, k: TOKEN, metodo: 'qr' }]);
      assert.match(await page.locator('.pago-listo').innerText(), /Vas a pagar con QR/);
      await page.getByRole('button', { name: 'Cambiar método' }).click();
      await page.locator('.pago-opcion').filter({ hasText: 'Efectivo' }).click();
      await page.getByText(/Vas a pagar con efectivo/).waitFor({ state: 'visible' });
      assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['qr', 'efectivo']);
      // Todo el panel cabe en la ventana (el cuerpo con los ítems se desplaza por dentro).
      const panel = await page.locator('.cuenta-hoja').boundingBox();
      assert.ok(panel.y >= 0 && panel.y + panel.height <= (ancho === 1280 ? 800 : 900));
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  });
}

test('el riel marca la sección que se toca, también la última en una ventana alta (scroll-spy de escritorio)', { skip: saltar() }, async (t) => {
  for (const [ancho, alto] of [[1280, 700], [1440, 1200]]) {
    await conCarta(t, { ancho, alto }, async ({ page }) => {
      for (const nombre of ['Ejecutivos', 'Entradas', 'Platos fuertes', 'Bebidas']) {
        await page.locator('nav[aria-label="Secciones de la carta"] a.tab', { hasText: nombre }).click();
        await esperarScrollQuieto(page); // el scroll suave termina y el observador se asienta
        assert.equal((await page.locator('nav .tab-on').innerText()).trim(), nombre, `a ${ancho}×${alto}, tocar «${nombre}» marca «${await page.locator('nav .tab-on').innerText()}»`);
      }
    });
  }
});

test('de 390 a 1280 px (girar una tableta, cambiar la ventana): la hoja abierta se cierra y la cuenta pasa a ser el panel, sin duplicarse', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async ({ page, cuentas, consola }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
    await page.locator('.cuenta-hoja').waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await visible(page, 'div.fixed.bottom-0'), false);
    assert.equal(await page.locator('.cuenta-hoja').count(), 1, 'una sola cuenta en el DOM');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.cuenta-hoja').waitFor({ state: 'hidden' });
    assert.equal(await visible(page, 'div.fixed.bottom-0'), true, 'de vuelta en el celular: la barra y la hoja cerrada');
    assert.ok(cuentas.length >= 2);
    assert.deepEqual(consola, []);
  });
});

test('1024 px con mesa: ya es escritorio (riel, carta y panel en una fila, sin desborde); a 1023 px sigue el celular', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1024, alto: 768 }, async ({ page, consola }) => {
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    const riel = await page.locator('.carta-riel').boundingBox();
    const main = await page.locator('main').boundingBox();
    const panel = await page.locator('.cuenta-hoja').boundingBox();
    assert.ok(riel.x + riel.width <= main.x && main.x + main.width <= panel.x + 1);
    assert.ok(main.width >= 400, `la carta mide ${main.width} px a 1024`);
    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
  await conCarta(t, { ancho: 1023, alto: 768 }, async ({ page }) => {
    assert.equal(await visible(page, 'div.fixed.bottom-0'), true);
    assert.equal(await visible(page, 'aside[aria-label="Mi cuenta"]'), false);
    assert.equal(await columnas(page, '.carta-platos'), 1);
    assert.equal(await desborde(page), 0);
  });
});

test('sin cuenta abierta en el panel de escritorio: «Todavía no hay cuenta abierta» y ningún botón «Pagar» aunque la función esté encendida', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1280, cuenta: false }, async ({ page, posts }) => {
    await page.getByText('Todavía no hay cuenta abierta').waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: /Pagar/ }).count(), 0);
    assert.deepEqual(posts, []);
  });
});

// ───────────────────── ronda de correcciones tras la crítica visual (2026-09-30) ─────────────────────

const MUCHOS_ITEMS = [
  ...ITEMS,
  { nombre: 'Picada Resplandor', precio: 110000, cantidad: 1 },
  { nombre: 'Cóctel Resplandor', precio: 35000, cantidad: 2 },
  { nombre: 'Bandeja paisa Resplandor', precio: 49000, cantidad: 2 },
  { nombre: 'Ceviche de chicharrón', precio: 22000, cantidad: 1 },
  { nombre: 'Cerveza', precio: 9000, cantidad: 4 },
  { nombre: 'Agua', precio: 4000, cantidad: 2 },
  { nombre: 'Salmón gratinado', precio: 70000, cantidad: 1 },
  { nombre: 'Empanadas operadas', precio: 18000, cantidad: 1 },
];
const dentroDe = (caja, marco) => caja.top >= marco.top - 1 && caja.bottom <= marco.bottom + 1;
const cajas = (page, selector) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }), selector);
const marcoDe = (page, selector) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }, selector);

test('el aviso de error de Pagar va arriba de las opciones, es un role="alert" y se ve entero en un celular bajo (360×640, 320×568)', { skip: saltar() }, async (t) => {
  for (const [ancho, alto] of [[360, 640], [320, 568]]) {
    await conCarta(t, { ancho, alto, movil: true, alerta: () => ({ status: 429, body: { error: 'demasiadas solicitudes' } }) }, async ({ page, consola }) => {
      await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      await page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
      await page.locator('.pago-opcion').filter({ hasText: 'QR' }).click();
      const aviso = page.locator('.pago-aviso');
      await aviso.waitFor({ state: 'visible' });
      assert.equal(await aviso.getAttribute('role'), 'alert');
      const [primera] = await cajas(page, '.pago-opcion');
      const [avisoCaja] = await cajas(page, '.pago-aviso');
      assert.ok(avisoCaja.bottom <= primera.top, `a ${ancho}×${alto} el aviso (${avisoCaja.bottom}) debe estar arriba de la primera opción (${primera.top})`);
      assert.ok(dentroDe(avisoCaja, await marcoDe(page, '.cuenta-cuerpo')), `a ${ancho}×${alto} el aviso queda fuera del cuerpo de la hoja`);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola.filter((m) => !/status of 429/.test(m)), []);
    });
  }
});

test('el aviso de error se trae a la vista aunque el cuerpo de la hoja estuviera desplazado hacia abajo (320×568, tocando «Efectivo»)', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 320, alto: 568, movil: true, alerta: () => ({ status: 409, body: { error: 'sin cuenta' } }) }, async ({ page }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
    const desplazable = await page.evaluate(() => { const c = document.querySelector('.cuenta-cuerpo'); c.scrollTop = c.scrollHeight; return c.scrollTop; });
    assert.ok(desplazable > 0, 'a 320×568 las tres opciones no caben: el cuerpo se desplaza (si ya caben, esta prueba no prueba nada)');
    await page.locator('.pago-opcion').filter({ hasText: 'Efectivo' }).click();
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    await page.waitForTimeout(200);
    assert.ok(dentroDe((await cajas(page, '.pago-aviso'))[0], await marcoDe(page, '.cuenta-cuerpo')), 'el aviso quedó fuera de vista');
  });
});

test('«Listo» no aparece mientras se elige cómo pagar (parecía confirmar el aviso), y las tres opciones caben en 360×640', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 360, alto: 640, movil: true }, async ({ page }) => {
    const listo = page.getByRole('button', { name: 'Listo', exact: true });
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await listo.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
    assert.equal(await listo.isVisible(), false, '«Listo» sigue a la vista en «¿Cómo quieres pagar?»');
    const marco = await marcoDe(page, '.cuenta-cuerpo');
    for (const [i, c] of (await cajas(page, '.pago-opcion')).entries()) assert.ok(dentroDe(c, marco), `la opción ${i} no cabe en el cuerpo de la hoja a 360×640`);
    await page.getByRole('button', { name: 'Volver' }).click();
    await listo.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').filter({ hasText: 'QR' }).click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.equal(await listo.isVisible(), true, 'ya avisado, «Listo» cierra la hoja como siempre');
  });
});

test('táctil: el puntero que se queda sobre una opción (tras tocar y fallar) no la deja con el aspecto de «elegida»; con ratón el hover sí marca', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, movil: true }, async ({ page }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    const qr = page.locator('.pago-opcion').filter({ hasText: 'QR' });
    await qr.waitFor({ state: 'visible' });
    const aspecto = () => qr.evaluate((e) => getComputedStyle(e).borderTopColor + '|' + getComputedStyle(e).backgroundColor);
    const antes = await aspecto();
    await qr.hover(); // en el celular el toque deja el puntero encima: el :hover quedaba pegado
    await page.waitForTimeout(250);
    assert.equal(await qr.evaluate((e) => e.matches(':hover')), true, 'el puntero debería estar encima de la opción');
    assert.equal(await page.evaluate(() => matchMedia('(hover: hover)').matches), false, 'el contexto de la prueba debería ser táctil');
    assert.equal(await aspecto(), antes);
  });
  await conCarta(t, { ancho: 1280, alto: 800, alerta: () => ({ status: 429, body: {} }) }, async ({ page }) => {
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    const qr = page.locator('.pago-opcion').filter({ hasText: 'QR' });
    const antes = await qr.evaluate((e) => getComputedStyle(e).borderTopColor);
    await qr.hover();
    await page.waitForTimeout(250);
    assert.notEqual(await qr.evaluate((e) => getComputedStyle(e).borderTopColor), antes, 'con ratón el hover sigue marcando la opción');
  });
});

test('el foco sigue al flujo: Pagar → primera opción; avisar → «Cambiar método»; Cambiar → el método avisado; Volver → el botón que toca', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, movil: true }, async ({ page }) => {
    const activo = () => page.evaluate(() => ({ id: document.activeElement.id, clase: document.activeElement.className, texto: document.activeElement.textContent.trim().split(/\s+/)[0] }));
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.waitForFunction(() => document.activeElement.classList.contains('pago-opcion'));
    assert.equal((await activo()).texto, 'QR');
    await page.getByRole('button', { name: 'Volver' }).click();
    await page.waitForFunction(() => document.activeElement.id === 'pago-pagar');
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').filter({ hasText: 'Transferencia' }).click();
    await page.waitForFunction(() => document.activeElement.id === 'pago-cambiar');
    await page.getByRole('button', { name: 'Cambiar método' }).click();
    await page.waitForFunction(() => document.activeElement.classList.contains('pago-opcion--actual'));
    assert.equal((await activo()).texto, 'Transferencia');
    await page.getByRole('button', { name: 'Volver' }).click();
    await page.waitForFunction(() => document.activeElement.id === 'pago-cambiar');
  });
});

for (const [ancho, alto, items, nombre] of [[1024, 768, MUCHOS_ITEMS, '12 ítems'], [1366, 768, ITEMS, '3 ítems'], [1280, 720, MUCHOS_ITEMS, '12 ítems'], [1024, 600, ITEMS, '3 ítems']]) {
  test(`${ancho}×${alto} (${nombre}), ya avisado: el panel entero cabe en la ventana, con su borde redondeado y el total a la vista`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto, items }, async ({ page, consola }) => {
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      const comprobar = async (etapa) => {
        const hoja = await page.locator('.cuenta-hoja').boundingBox();
        assert.ok(hoja.y >= 0 && hoja.y + hoja.height <= alto, `${etapa}: el panel va de ${hoja.y} a ${hoja.y + hoja.height} en una ventana de ${alto}`);
        assert.ok((await page.locator('.cuenta-total').boundingBox()).y + 30 <= alto, `${etapa}: el total quedó fuera de la ventana`);
      };
      await comprobar('con la cuenta');
      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      await comprobar('eligiendo');
      await page.locator('.pago-opcion').filter({ hasText: 'QR' }).click();
      await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
      await comprobar('avisado');
      // Mide ≥ 44 px de alto y entra: «Cambiar método» es un botón sin fondo pero con zona táctil entera.
      const cambiar = await page.getByRole('button', { name: 'Cambiar método' }).boundingBox();
      assert.ok(cambiar.height >= 44 - 0.5, `«Cambiar método» mide ${cambiar.height} px de alto`);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  });
}

test('1280×720 con 12 ítems y ya avisado: caben al menos 3 filas enteras, y una sombra avisa que la lista sigue (y se apaga al final y cuando todo cabe)', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1280, alto: 720, items: MUCHOS_ITEMS }, async ({ page }) => {
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').filter({ hasText: 'QR' }).click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    const filas = await page.evaluate(() => { const marco = document.querySelector('.cuenta-cuerpo').getBoundingClientRect(); return [...document.querySelectorAll('.cuenta-cuerpo li')].filter((l) => l.offsetParent !== null).map((l) => l.getBoundingClientRect()).filter((r) => r.top >= marco.top - 1 && r.bottom <= marco.bottom + 1).length; });
    assert.ok(filas >= 3, `se ven ${filas} filas enteras de 12`);
    const sombra = () => page.evaluate(() => getComputedStyle(document.querySelector('.cuenta-cuerpo')).boxShadow);
    if (await page.evaluate(() => CSS.supports('animation-timeline', 'scroll()'))) {
      const conSombra = await sombra();
      assert.notEqual(conSombra, 'none', 'hay más ítems abajo y no hay pista');
      assert.doesNotMatch(conSombra, /\/ 0\)|\b0\)$/, 'la sombra debería verse al comienzo de la lista');
      await page.evaluate(() => { const c = document.querySelector('.cuenta-cuerpo'); c.scrollTop = c.scrollHeight; });
      await page.waitForTimeout(150);
      assert.match(await sombra(), /\/ 0\)|none/, 'al llegar al final la sombra se apaga');
    }
  });
  await conCarta(t, { ancho: 1920, alto: 1080 }, async ({ page }) => {
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.cuenta-cuerpo')).boxShadow), 'none', 'si todo cabe no hay pista de scroll');
  });
});

for (const [ancho, alto] of [[844, 390], [667, 375]]) {
  test(`celular apaisado ${ancho}×${alto}: «¿Cómo quieres pagar?» muestra las tres opciones enteras (la hoja se desplaza, no un cuerpo de 50 px) y se puede avisar`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto, movil: true }, async ({ page, posts, consola }) => {
      await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      await page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
      const medidas = await page.evaluate(() => { const c = document.querySelector('.cuenta-cuerpo'); const h = document.querySelector('.cuenta-hoja'); return { overflowCuerpo: getComputedStyle(c).overflowY, cuerpoCabe: c.scrollHeight <= c.clientHeight + 1, hojaH: h.getBoundingClientRect().height, hojaBorde: h.getBoundingClientRect().bottom, vh: innerHeight, hojaScroll: getComputedStyle(h).overflowY }; });
      assert.equal(medidas.cuerpoCabe, true, 'el cuerpo tiene un scroll propio dentro de la hoja apaisada');
      assert.equal(medidas.hojaScroll, 'auto');
      assert.ok(medidas.hojaH <= medidas.vh + 1, `la hoja (${medidas.hojaH}) no pasa del alto de la ventana (${medidas.vh})`);
      await page.locator('.pago-opcion').filter({ hasText: 'Efectivo' }).click();
      await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
      assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['efectivo']);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  });
}

test('«Mesa N» sale una sola vez en escritorio (el panel; el chip de la cabecera se oculta) y sigue en la cabecera del celular', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1280, alto: 800 }, async ({ page }) => {
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('header .badge')).display), 'none');
    assert.equal(await page.locator('.cuenta-hoja h2').innerText().then((x) => x.replace(/\s+/g, ' ').trim()), 'Mesa 7');
  });
  await conCarta(t, { ancho: 390, alto: 844, movil: true }, async ({ page }) => {
    assert.equal(await page.locator('header .badge').isVisible(), true);
  });
});

test('«Cuenta abierta desde las 12:41 p. m.» no se parte por dentro de la hora (espacios duros, también a 320 px)', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 320, alto: 568, movil: true }, async ({ page }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    const sub = page.locator('.cuenta-cabeza p', { hasText: 'Cuenta abierta desde las' });
    await sub.waitFor({ state: 'visible' });
    const texto = await sub.evaluate((e) => e.textContent); // innerText normaliza los espacios duros
    assert.match(texto, /^Cuenta abierta desde las \d{1,2}:\d{2}[^ ]p\.[^ ]m\.$/, `un espacio normal dentro de la hora: «${texto}»`);
    assert.equal((texto.match(/\u00a0/g) || []).length, 2, 'los dos espacios de «12:41 p. m.» son duros (U+00A0)');
  });
});
