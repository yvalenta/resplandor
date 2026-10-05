// «Pagar» y el escritorio de carta.html (tarea 2026-09-30-carta-escritorio-pagar; el flujo de «Pagar» se simplificó en
// tareas/2026-10-04-hallazgos-domingo.md, punto 5).
//
// El modelo (Yonatan, 2026-09-30): «Pagar» NO cobra. Crea UNA ALERTA para el personal (Edge Function `alerta`); el mesero llega con el QR
// impreso o el datáfono, da los datos de la cuenta o recibe el efectivo, y cobra y cierra en el POS. Desde 2026-10-02 (pago-breb) la carta
// además MUESTRA el QR y la llave de Bre-B que el admin configuró (solo con la cuenta de una mesa abierta): eso se prueba en
// pago-breb-carta.test.mjs; aquí quedan las pruebas del flujo SIN esos datos (la `cuenta` de estas pruebas no trae `pago`, salvo donde se
// pide `breb`). Sin propina en ningún lado («eso no se hace acá»). El botón vive detrás de RESPLANDOR.funciones.pagarEnMesa
// (assets/js/local.js), apagada hasta que `alerta` esté desplegada.
//
// El flujo, desde el domingo 2026-10-04 («evitemos depender de inputs del usuario… la menor interacción posible»): YA NO SE ELIGE cómo pagar.
// Se quitaron las tres opciones (QR / Transferencia / Efectivo), la vista `elegir`, «Cambiar método» y `eligiendoPago`. «Pagar» abre UNA sola
// pantalla (`pago.vista === 'pagando'`, `#pago-breb`: «Paga como prefieras») que muestra a la vez el QR, la llave, el valor, el comprobante y
// «O en efectivo» (lo que haya), y avisa SOLA al mesero con el método `cuenta` («pide la cuenta»). Los toques que quedan solo AFINAN esa
// misma alerta pendiente: copiar la llave o el valor, o abrir el comprobante → `transferencia`; «Avisar que pago en efectivo» → `efectivo`;
// y «Avisar de nuevo» (tras un fallo) fuerza el reintento. Con la misma cuenta y el mismo método no se repite el aviso. «Volver a la cuenta»
// (la flecha) deja la tarjeta «Listo, le avisamos al mesero» con «Ver cómo pagar», que vuelve a la pantalla sin avisar de nuevo.
//
// Tres partes, como funciones.test.mjs / desborde.test.mjs:
//   1. ESTÁTICA (corre siempre, también en CI): sin propina; ningún dato bancario puesto a mano ni QR dibujado de antemano en la
//      página; todo lo de Pagar dentro de <template x-if="…pagarEnMesa…">; ya no queda rastro de las tres opciones; los íconos están en
//      el sprite; la bandera existe y no se anuncia a los agentes.
//   2. EL CONTRATO DEL POST, con el <script> inline de carta.html corrido en un `vm` y un fetch simulado (corre siempre): URL, método,
//      cabeceras, cuerpo, el aviso «cuenta» al abrir, cómo se afina, qué se muestra por cada respuesta (200, 400, 404, 409, 429, tope, 500,
//      sin red, tiempo agotado), que nada se reintente solo, que un método inventado no salga, que la misma cuenta no avise dos veces
//      y que apagada la función no se llame a nada.
//   3. EN NAVEGADOR (solo si hay Playwright y un Chromium, ver _navegador.mjs), con la red simulada (nunca se toca Supabase): el flujo
//      entero a 390 px (hoja), a 1280 y a 1440 px (panel), el interruptor apagado, el escritorio (riel, panel, sin barra de abajo,
//      columnas de platos), sin desborde horizontal y sin errores de consola.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';
import { conBanderas } from './_sitio.mjs';
import { LLAVE_FICTICIA, QR_FICTICIO } from './_breb-ficticio.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const sinScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const URL_ALERTA = 'https://lccgehvyymladqvumcez.supabase.co/functions/v1/alerta';
const METODOS = ['qr', 'transferencia', 'efectivo'];
const BREB = Object.freeze({ llave: LLAVE_FICTICIA, qr: QR_FICTICIO });   // los datos FICTICIOS de _breb-ficticio.mjs: ningún dato de pago real vive en el repo

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

test('la página no lleva ningún dato de pago puesto a mano: ni bancos, ni números de cuenta, ni un QR dibujado de antemano (la llave y el QR de Bre-B llegan de la base: pago-breb-carta.test.mjs)', () => {
  const html = sinScripts(sinComentarios(leer('carta.html')));
  const aside = html.slice(html.indexOf('<aside class="cuenta-ventana'), html.indexOf('</aside>'));
  assert.ok(aside.length > 500, 'no encontré el <aside> de «Mi cuenta» en carta.html');
  assert.doesNotMatch(html, /bancolombia|davivienda|nequi|daviplata|nu bank|n[uú]mero de cuenta|cuenta de ahorros|cuenta corriente|\biban\b|\bclabe\b|\bnit\b/i);
  assert.doesNotMatch(aside, /\d{8,}/, 'un número largo (¿cuenta, teléfono?) dentro de «Mi cuenta»');
  assert.doesNotMatch(html, /<img\b[^>]*qr/i, 'un <img> de QR en la página');
  assert.doesNotMatch(html, /data:image\//, 'una imagen incrustada (¿un QR?) en la página');
  // El script tampoco lleva un banco ni una cuenta: solo los tres métodos por nombre.
  const script = leer('carta.html').slice(leer('carta.html').indexOf('<script>'));
  assert.doesNotMatch(script, /bancolombia|davivienda|nequi|daviplata|\d{10,}/i);
});

test('todo lo de Pagar va dentro de <template x-if="…pagarEnMesa…">: apagada, el botón y la pantalla de pago ni existen en el DOM', () => {
  const html = sinScripts(sinComentarios(leer('carta.html')));
  const plantillas = html.match(/<template\b[^>]*x-if="[^"]*\bpagarEnMesa\b[^"]*"/g) || [];
  assert.ok(plantillas.length >= 3, `se esperaban al menos 3 <template x-if="…pagarEnMesa…"> (el aviso de la cabecera, la pantalla de pago y el botón/estado), hay ${plantillas.length}`);
  const visible = quitarPlantillas(html, (cond) => /\bpagarEnMesa\b/.test(cond));
  for (const rastro of [/Pagar\b/, /pago-opcion/, /pago-listo/, /pago-aviso/, /pago-breb/, /pago-efectivo/, /pago-sin-datos/, /avisarPago/, /pedirPago/, /verPago/, /volverDePago/, /metodosPago/, /Paga como prefieras/, /Avisar que pago en efectivo/, /Avisar de nuevo/, /Ver cómo pagar/, /Volver a la cuenta/, /¿Cómo quieres pagar/, /Cambiar método/, /le avisamos al mesero/i, /#i-wallet/, /#i-qr-code/]) {
    assert.doesNotMatch(visible, rastro, `con pagarEnMesa apagada, carta.html todavía deja ${rastro} fuera de sus plantillas`);
  }
});

test('«Pagar» es UNA sola pantalla: ya no hay tres opciones que elegir (ni .pago-opcion en el marcado, ni la vista «elegir», ni eligiendoPago / cambiarMetodo / «Cambiar método»), y la pantalla trae título, efectivo y salida', () => {
  const crudo = leer('carta.html');
  const html = sinScripts(sinComentarios(crudo));
  assert.doesNotMatch(html, /pago-opcion/, 'una opción de pago en el marcado');
  assert.doesNotMatch(html, /¿Cómo quieres pagar|Cambiar método|Al elegir, le avisamos/, 'el texto de la hoja de tres opciones');
  assert.doesNotMatch(html, /\bmetodosPago\b/, 'metodosPago existe en el script pero ya no se pinta');
  const script = sinComentarios(crudo.slice(crudo.indexOf('<script>\n'))).replace(/(^|\s)\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(script, /eligiendoPago|cambiarMetodo|vista === 'elegir'|vista = 'elegir'/, 'la vista «elegir» ya no existe');
  assert.doesNotMatch(script, /vuelve a tocar el método/i, 'los avisos ya no mandan a «tocar el método»');
  // La pantalla: el título, la salida, el efectivo siempre y «Avisar de nuevo» con el método que tocó (o «cuenta») y forzado.
  const pantalla = html.slice(html.indexOf('<div id="pago-breb">'), html.indexOf('<div x-show="!pagoEnCuerpo">'));
  assert.ok(pantalla.length > 1500, 'no encontré la pantalla de pago');
  assert.match(pantalla, /id="pago-breb-titulo"[^>]*>Paga como prefieras</);
  assert.match(pantalla, /id="pago-cambiar-breb"[^>]*aria-label="Volver a la cuenta"[^>]*@click="volverDePago\(\)"/);
  assert.match(pantalla, /id="pago-efectivo"/);
  assert.match(pantalla, /id="pago-avisar-efectivo"[^>]*@click="avisarPago\('efectivo'\)"/);
  assert.match(pantalla, /@click="avisarPago\(pago\.ultimoIntento \|\| pago\.metodo \|\| 'cuenta', true\)">Avisar de nuevo</, '«Avisar de nuevo» reintenta lo ÚLTIMO que se intentó (tras fallar «efectivo», efectivo; no cuenta)');
  assert.match(html, /id="pago-ver"[^>]*@click="verPago\(\)"/, 'el pie «Listo» vuelve a la pantalla con «Ver cómo pagar»');
  assert.doesNotMatch(html, /id="pago-cambiar"(?!-)/, 'el botón «Cambiar método» del pie ya no existe');
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

/** Deja correr el aviso en vuelo: `pedirPago()` avisa SOLA (no hay promesa que esperar) y el fetch simulado contesta en una de las vueltas siguientes. */
const asentar = async (c) => { for (let i = 0; i < 50 && c.pago.enviando; i++) await new Promise((r) => setImmediate(r)); };
/** Los métodos de los POST a `alerta` que salieron, en orden. */
const avisados = (llamadas) => llamadas.filter((l) => l.url.endsWith('/functions/v1/alerta')).map((l) => JSON.parse(l.init.body).metodo);
/** Un `alerta` que contesta 200 con el método que le mandaron (lo que hace la función de verdad). */
const alertaOk = async (_u, init) => respuesta(200, { ok: true, metodo: JSON.parse(init.body).metodo, creada_en: '2026-09-30T18:00:00Z' });

test('Pagar: el POST a /functions/v1/alerta lleva {m, k, metodo} y las mismas cabeceras que la carta usa para «cuenta»', async () => {
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: alertaOk });
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

test('«Pagar» (pedirPago): abre la pantalla de pago y avisa SOLA al mesero con el método «cuenta» (pide la cuenta) — el mismo POST de siempre, sin que nadie elija nada', async () => {
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: alertaOk });
  assert.equal(c.pago.vista, 'inicio');
  c.pedirPago();
  assert.equal(c.pago.vista, 'pagando', 'la pantalla abre YA, sin esperar al aviso: pagar no depende de él');
  assert.equal(c.pagando, true);
  assert.equal(c.pagoEnCuerpo, true, 'toma el lugar de los ítems en el cuerpo de la cuenta');
  assert.deepEqual([c.pago.enviando, c.pago.aviso], ['cuenta', 'enviando']);
  await asentar(c);
  assert.equal(llamadas.length, 1, 'un solo aviso al abrir');
  assert.equal(llamadas[0].url, URL_ALERTA);
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { m: 12, k: TOKEN, metodo: 'cuenta' });
  assert.deepEqual([c.pago.vista, c.pago.metodo, c.pago.aviso, c.pago.error, c.pago.enviando, c.pago.cuentaDe], ['pagando', 'cuenta', 'ok', '', null, '2026-09-30T17:41:00Z']);
  assert.equal(c.metodoPago, null, '«cuenta» no es un método de pago: el pie «Listo» nunca dice «Vas a pagar con …» por ella');
});

test('Pagar: la respuesta 200 deja «avisado» con el método que confirma el servidor, y los toques que siguen AFINAN ese aviso (transferencia, efectivo) sin sacar a nadie de la pantalla', async () => {
  let n = 0;
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: async (_u, init) => respuesta(200, { ok: true, metodo: JSON.parse(init.body).metodo, creada_en: `2026-09-30T18:0${++n}:00Z` }) });
  c.pedirPago();
  await asentar(c);
  assert.deepEqual([c.pago.vista, c.pago.metodo, c.pago.enviando, c.pago.error, c.pago.cuentaDe], ['pagando', 'cuenta', null, '', '2026-09-30T17:41:00Z']);
  await c.avisarPago('transferencia');
  assert.deepEqual([c.pago.vista, c.pago.metodo, c.pago.aviso], ['pagando', 'transferencia', 'ok'], 'afinar no cambia la pantalla');
  assert.equal(c.metodoPago.con, 'transferencia');
  await c.avisarPago('efectivo');
  assert.deepEqual([c.pago.vista, c.pago.metodo], ['pagando', 'efectivo']);
  assert.equal(c.metodoPago.con, 'efectivo');
  assert.deepEqual(avisados(llamadas), ['cuenta', 'transferencia', 'efectivo'], 'la misma alerta, cada vez más precisa');
  c.volverDePago();
  assert.equal(c.pago.vista, 'listo', '«Volver a la cuenta» después de avisar regresa al estado de avisado, no borra el aviso');
  assert.equal(c.pago.metodo, 'efectivo');
  c.verPago();
  assert.deepEqual([c.pago.vista, c.pago.aviso, c.pago.metodo], ['pagando', 'ok', 'efectivo']);
  assert.equal(avisados(llamadas).length, 3, '«Ver cómo pagar» vuelve a la pantalla sin avisar de nuevo');
});

test('Pagar: si el servidor contesta otro método válido, manda el del servidor; si contesta uno inventado, el que se pidió', async () => {
  const a = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, { ok: true, metodo: 'efectivo' }) });
  await a.c.avisarPago('qr');
  assert.equal(a.c.pago.metodo, 'efectivo');
  const b = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, { ok: true, metodo: 'bitcoin' }) });
  await b.c.avisarPago('qr');
  assert.equal(b.c.pago.metodo, 'qr');
  const d = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, { ok: true, metodo: 'cuenta' }) });
  d.c.pedirPago();
  await asentar(d.c);
  assert.equal(d.c.pago.metodo, 'cuenta', '«cuenta» es una respuesta válida de la función (desde 20261005110000)');
});

const ERRORES = [
  { nombre: '409 (sin cuenta abierta)', respuesta: () => respuesta(409, { error: 'sin cuenta' }), texto: /todavía no hay una cuenta abierta/i },
  { nombre: '429 (rate-limit)', respuesta: () => respuesta(429, { error: 'demasiadas solicitudes' }), texto: /mucha gente avisando.*toca «avisar de nuevo»/i },
  { nombre: '429 «tope» (ya se avisó varias veces)', respuesta: () => respuesta(429, { error: 'demasiadas solicitudes', codigo: 'tope' }), texto: /ya le avisamos varias veces al mesero/i },
  { nombre: '400 (enlace inválido)', respuesta: () => respuesta(400, { error: 'enlace inválido' }), texto: /enlace ya no sirve/i },
  { nombre: '404 (enlace inválido)', respuesta: () => respuesta(404, { error: 'enlace inválido' }), texto: /enlace ya no sirve/i },
  { nombre: '500', respuesta: () => respuesta(500, { error: 'boom' }), texto: /no pudimos avisar al mesero/i },
  { nombre: '500 sin cuerpo JSON', respuesta: () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } }), texto: /no pudimos avisar al mesero/i },
  { nombre: 'sin red', respuesta: () => { throw new TypeError('Failed to fetch'); }, texto: /sin conexión.*toca «avisar de nuevo»/i },
  { nombre: 'tiempo agotado', respuesta: () => { const e = new Error('abortado'); e.name = 'AbortError'; throw e; }, texto: /la red tardó demasiado.*toca «avisar de nuevo»/i },
];

for (const caso of ERRORES) {
  test(`Pagar con ${caso.nombre}: la pantalla de pago sigue abierta con un aviso tranquilo, no queda nada «avisado», no reintenta solo y deja «Avisar de nuevo»`, async () => {
    const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: async () => caso.respuesta() });
    c.pedirPago();
    await asentar(c);
    assert.equal(c.pago.vista, 'pagando', 'pagar no depende del aviso: la pantalla (y con ella el QR y la llave) sigue a la vista');
    assert.equal(c.pago.aviso, 'error');
    assert.equal(c.pago.metodo, null, 'no queda ningún método como avisado');
    assert.match(c.pago.error, caso.texto);
    assert.doesNotMatch(c.pago.error, /vuelve a tocar el método/i, 'ya no hay método que volver a tocar');
    assert.equal(c.pago.enviando, null, '«Avisar de nuevo» vuelve a quedar libre (reintento manual)');
    assert.equal(c.pago.cuentaDe, null);
    // Ningún reintento automático: la única llamada a `alerta` es la de abrir «Pagar» (y la del 409 es a `cuenta`, para refrescar la hoja).
    assert.deepEqual(avisados(llamadas), ['cuenta']);
    // «Avisar de nuevo» = avisarPago(metodo || 'cuenta', true): con la función ya buena, el aviso sale y el error se borra.
    const ok = cartaEnVm({ pagarEnMesa: true, fetch: alertaOk });
    ok.c.pago = { ...c.pago };
    await ok.c.avisarPago(ok.c.pago.metodo || 'cuenta', true);
    assert.deepEqual([ok.c.pago.vista, ok.c.pago.aviso, ok.c.pago.metodo], ['pagando', 'ok', 'cuenta'], 'sigue en la pantalla y queda avisado');
    assert.equal(ok.c.pago.error, '', 'un aviso que sale bien borra el error');
  });
}

test('Pagar con 409: refresca la cuenta (la hoja se entera de que ya no hay cuenta abierta) y la pantalla de pago se cierra sola', async () => {
  const { c, llamadas } = cartaEnVm({
    pagarEnMesa: true,
    fetch: async (url) => (url.includes('/functions/v1/cuenta') ? respuesta(200, { mesa: 12, abierta: false }) : respuesta(409, { error: 'sin cuenta' })),
  });
  c.pedirPago();
  await asentar(c);
  await new Promise((r) => setImmediate(r)); // _leer('alerta') corre sin esperar
  await new Promise((r) => setImmediate(r));
  assert.ok(llamadas.some((l) => l.url.includes('/functions/v1/cuenta?m=12&k=' + TOKEN)), 'pidió la cuenta de nuevo');
  assert.equal(c.cuenta.estado, 'vacia');
  assert.equal(c.pago.vista, 'inicio', 'sin cuenta abierta el aviso se olvida');
  assert.equal(c.pagando, false, 'y la pantalla de pago ya no se pinta');
});

test('Pagar: un método que no es qr/transferencia/efectivo/cuenta no sale (ni «propina», ni «tarjeta»), y dos toques seguidos hacen UN solo aviso', async () => {
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: alertaOk });
  for (const raro of ['propina', 'tarjeta', 'QR', 'Cuenta', 'pedir_cuenta', '', undefined, null, '__proto__', 'qr,efectivo', 'cuenta,qr']) await c.avisarPago(raro);
  assert.deepEqual(llamadas, [], 'ningún método inventado llega a la red');
  assert.deepEqual(aplana(c.metodosPago.map((o) => o.id)), METODOS);
  // Con un aviso en vuelo, un toque del MISMO método no hace nada y uno distinto no se pierde: se guarda y sale cuando el primero vuelve
  // (el `cuenta` de abrir «Pagar» puede tardar hasta 8 s y antes se tragaba el afinado a «transferencia» de «Copiar llave»).
  await Promise.all([c.avisarPago('qr'), c.avisarPago('qr'), c.avisarPago('efectivo')]);
  await asentar(c);
  assert.deepEqual(avisados(llamadas), ['qr', 'efectivo'], 'el repetido no sale; el distinto sale después, en orden');
});

test('Pagar: con la misma cuenta no se repite el aviso (abrir «Pagar» otra vez o tocar el mismo método no manda nada), y «Avisar de nuevo» (forzar) sí', async () => {
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: alertaOk });
  c.pedirPago();
  await asentar(c);
  c.volverDePago();
  c.pedirPago();
  await asentar(c);
  c.verPago();
  await asentar(c);
  await c.avisarPago('cuenta');
  assert.deepEqual(avisados(llamadas), ['cuenta'], 'abrir la pantalla de nuevo, o «cuenta» otra vez, no vuelve a avisar');
  await c.avisarPago('transferencia');
  await c.avisarPago('transferencia');
  assert.deepEqual(avisados(llamadas), ['cuenta', 'transferencia'], 'afinar a un método ya avisado tampoco se repite');
  await c.avisarPago('transferencia', true);
  assert.deepEqual(avisados(llamadas), ['cuenta', 'transferencia', 'transferencia'], '«Avisar de nuevo» fuerza el aviso aunque el método sea el mismo');
});

test('Pagar apagada (pagarEnMesa en false): ni avisarPago ni pedirPago hacen NINGUNA llamada, aunque se invoquen a mano', async () => {
  const { c, llamadas } = cartaEnVm({ pagarEnMesa: false, fetch: alertaOk });
  assert.equal(c.pagarEnMesa, false);
  for (const m of [...METODOS, 'cuenta']) await c.avisarPago(m);
  assert.deepEqual(llamadas, []);
  assert.equal(c.pago.vista, 'inicio');
  c.pedirPago();
  await asentar(c);
  assert.deepEqual(llamadas, [], '«Pagar» tampoco avisa sola con la función apagada');
  assert.equal(c.pagando, false);
  assert.equal(c.pagoEnCuerpo, false, 'y la pantalla de pago no se pinta');
});

test('Pagar sin enlace válido (sin mesa o sin token) no hace ninguna llamada, ni avisando ni abriendo «Pagar»', async () => {
  for (const campo of ['mesa', 'token']) {
    const { c, llamadas } = cartaEnVm({ pagarEnMesa: true, fetch: alertaOk });
    c[campo] = null;
    await c.avisarPago('qr');
    c.pedirPago();
    await asentar(c);
    assert.deepEqual(llamadas, [], `sin ${campo}`);
  }
});

test('el aviso se olvida cuando la cuenta a la que se avisó cierra, o cuando se abre otra en la mesa (y en la nueva «Pagar» vuelve a avisar sola)', async () => {
  let cuerpo = { mesa: 12, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items: [{ nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 }], total: 46000 };
  const { c, llamadas } = cartaEnVm({
    pagarEnMesa: true,
    fetch: async (url, init) => (url.includes('/functions/v1/alerta') ? alertaOk(url, init) : respuesta(200, cuerpo)),
  });
  c.pedirPago();
  await asentar(c);
  assert.deepEqual([c.pago.vista, c.pago.metodo], ['pagando', 'cuenta']);
  await c._leer('regreso');
  assert.deepEqual([c.pago.vista, c.pago.metodo], ['pagando', 'cuenta'], 'la misma cuenta: el aviso y la pantalla siguen');
  cuerpo = { ...cuerpo, abierta_en: '2026-09-30T19:02:00Z' };
  await c._leer('regreso');
  assert.deepEqual([c.pago.vista, c.pago.metodo], ['inicio', null], 'otra cuenta en la misma mesa: el aviso de la anterior no vale');
  c.pedirPago();
  await asentar(c);
  await c.avisarPago('efectivo');
  assert.deepEqual([c.pago.vista, c.pago.metodo], ['pagando', 'efectivo']);
  assert.deepEqual(avisados(llamadas), ['cuenta', 'cuenta', 'efectivo'], 'la cuenta nueva avisó otra vez desde cero');
  c.volverDePago();
  assert.equal(c.pago.vista, 'listo');
  cuerpo = { mesa: 12, abierta: false };
  await c._leer('regreso');
  assert.deepEqual([c.cuenta.estado, c.pago.vista, c.pago.metodo], ['vacia', 'inicio', null], 'la cuenta cerró: se olvida');
});

test('los métodos de la página son los de la función: los tres de siempre (qr, transferencia, efectivo; cada uno con ícono y una línea) más «cuenta», que es el aviso de abrir «Pagar»; ninguno dice cuánto ni a dónde', () => {
  const { c } = cartaEnVm({ pagarEnMesa: true, fetch: async () => respuesta(200, {}) });
  assert.deepEqual(aplana(c.metodosPago.map((o) => o.id)), METODOS);
  assert.deepEqual(aplana(c.metodosPago.map((o) => o.icono)), ['qr-code', 'landmark', 'banknote']);
  for (const o of c.metodosPago) {
    assert.ok(o.titulo && o.con && o.detalle, `el método ${o.id} tiene título, «con …» y detalle`);
    assert.doesNotMatch(`${o.titulo} ${o.con} ${o.detalle}`, /\d|propina|\$/, `el método ${o.id} no lleva cifras ni propina`);
  }
  // «cuenta» no es un método de pago (no se elige ni se pinta): solo vive en la lista de lo que `alerta` acepta, y esa lista es la de la función.
  assert.equal(c.metodosPago.some((o) => o.id === 'cuenta'), false);
  const deLaCarta = leer('carta.html').match(/const METODOS_ALERTA = \[([^\]]*)\]/)[1].match(/'(\w+)'/g).map((x) => x.slice(1, -1));
  const deLaFuncion = leer('supabase/functions/alerta/logica.ts').match(/export const METODOS = \[([^\]]*)\]/)[1].match(/"(\w+)"/g).map((x) => x.slice(1, -1));
  assert.deepEqual([...deLaCarta].sort(), [...deLaFuncion].sort(), 'la carta manda solo lo que la función `alerta` acepta');
  assert.deepEqual([...deLaFuncion].sort(), ['cuenta', 'efectivo', 'qr', 'transferencia']);
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
 * local.js, sin tocar el repo); `alerta(n, cuerpo)` decide la respuesta del n-ésimo POST a `alerta`; `breb` ({ llave, qr }): los datos de Bre-B que
 * la `cuenta` trae en `pago.breb` (por defecto ninguno: la pantalla de pago dice que el mesero los lleva).
 * Devuelve la página, los POST vistos y los errores de consola (sin los de Google Fonts, que dependen de la red).
 */
async function abrir({ ancho, alto = 800, mesa = true, pagar = true, alerta, cuenta = true, movil = false, items = ITEMS, breb = null }) {
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
      const cuerpo = cuenta ? { mesa: 7, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items, total, ...(breb ? { pago: { breb } } : {}) } : { mesa: 7, abierta: false };
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

/** Espera a que el QR esté DIBUJADO: el <svg> sale al abrir «Pagar» (con «Preparando el código…» mientras baja el generador) y su trazo `d` se llena cuando el generador carga. */
const qrDibujado = (page) => page.waitForFunction(() => { const p = document.querySelector('.breb-qr svg path'); return Boolean(p && p.getAttribute('d')); }, null, { timeout: 15000 });
/** Abre «Mi cuenta» (la hoja en celular; el panel ya está en escritorio) y toca «Pagar»: la pantalla de pago abre y avisa sola. */
async function tocarPagar(page, ancho) {
  if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
  await page.locator('.cuenta-total').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await page.locator('#pago-breb').waitFor({ state: 'visible' });
}
/** Espera el «Le avisamos al mesero» de la cabecera: el aviso de abrir «Pagar» ya salió bien. */
const esperarAviso = (page) => page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });

async function conCarta(t, opciones, cuerpo) {
  const c = await abrir(opciones);
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    await cuerpo(c);
  } finally {
    await c.contexto.close();
  }
}

test('carta con la función APAGADA, a 390 y a 1280 px: la cuenta se ve, pero no hay «Pagar», ni pantalla de pago, ni una sola llamada a alerta', { skip: saltar() }, async (t) => {
  for (const ancho of [390, 1280]) {
    await conCarta(t, { ancho, pagar: false }, async ({ page, posts, consola }) => {
      if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.getByText('Menú Resplandor', { exact: true }).last().waitFor({ state: 'visible' });
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      assert.equal(await page.getByRole('button', { name: /Pagar/ }).count(), 0, `a ${ancho} px hay un botón «Pagar» con la función apagada`);
      assert.equal(await page.locator('.pago-opcion, .pago-listo, .pago-aviso, #pago-breb, #pago-efectivo').count(), 0);
      assert.equal(await page.getByText(/Pagar|Cómo quieres pagar|le avisamos al mesero/i).count(), 0);
      assert.deepEqual(posts, []);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  }
});

test('390 px, función encendida: la hoja → «Pagar» → UNA pantalla que avisa SOLA («cuenta») → «Avisar que pago en efectivo» afina el aviso → «Volver a la cuenta» → «Listo, le avisamos al mesero» → «Ver cómo pagar»', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844 }, async ({ page, posts, consola }) => {
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    const dialogo = page.getByRole('dialog');
    await dialogo.waitFor({ state: 'visible' });
    assert.equal(await dialogo.getAttribute('aria-modal'), 'true');
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    assert.equal(posts.length, 0, 'abrir la cuenta no avisa a nadie: solo «Pagar»');
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();

    // Una sola pantalla, sin nada que elegir: el título, la línea «sin datos» (esta cuenta no trae Bre-B) y «O en efectivo».
    await page.locator('#pago-breb').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pago-breb-titulo').innerText(), 'Paga como prefieras');
    assert.equal(await page.locator('.pago-opcion').count(), 0, 'ya no hay tres opciones que elegir');
    assert.equal(await page.getByText(/¿Cómo quieres pagar|Cambiar método/).count(), 0);
    assert.match(await page.locator('#pago-sin-datos').innerText(), /El mesero te lleva el QR o los datos/);
    assert.equal(await page.locator('#pago-efectivo').isVisible(), true, '«O en efectivo» siempre está');
    assert.equal(await page.getByText(/propina/i).count(), 0);
    assert.equal(await page.locator('.breb-qr, .breb-llave, #pago-comprobante, #pago-copiar-llave').count(), 0, 'sin datos de Bre-B no hay QR, llave ni comprobante');
    assert.equal(await visible(page, '.cuenta-total'), true, 'el total sigue a la vista');

    // El aviso salió SOLO, con el método «cuenta» (pide la cuenta): el mismo POST de siempre, sin que nadie eligiera nada.
    await esperarAviso(page);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, URL_ALERTA);
    assert.equal(posts[0].metodo, 'POST');
    assert.deepEqual(posts[0].cuerpo, { m: 7, k: TOKEN, metodo: 'cuenta' });
    assert.equal(posts[0].cabeceras['content-type'], 'application/json');
    assert.match(posts[0].cabeceras.authorization, /^Bearer sb_publishable_/);
    assert.ok(posts[0].cabeceras.apikey);

    // «Avisar que pago en efectivo» solo AFINA ese aviso (la misma alerta pasa a efectivo) y no saca de la pantalla.
    await page.locator('#pago-avisar-efectivo').click();
    await page.getByText('Le avisamos: pagas en efectivo.').waitFor({ state: 'visible' });
    assert.equal(await visible(page, '#pago-avisar-efectivo'), false, 'ya avisado el efectivo, el botón se esconde');
    assert.equal(await visible(page, '#pago-breb'), true, 'sigue en la pantalla de pago');
    assert.deepEqual(posts.map((p) => p.cuerpo), [{ m: 7, k: TOKEN, metodo: 'cuenta' }, { m: 7, k: TOKEN, metodo: 'efectivo' }]);

    // «Volver a la cuenta» (la flecha) deja la tarjeta «Listo» con lo que se avisó.
    await page.getByRole('button', { name: 'Volver a la cuenta' }).click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-listo').innerText(), /Vas a pagar con efectivo/);
    assert.equal(await visible(page, '.cuenta-total'), true, 'la cuenta sigue a la vista y no hay nada de pago en ella');
    assert.equal(await page.getByRole('button', { name: 'Cambiar método' }).count(), 0, 'ya no hay «Cambiar método»');

    // «Ver cómo pagar» vuelve a la pantalla SIN avisar de nuevo.
    await page.locator('#pago-ver').click();
    await page.locator('#pago-breb').waitFor({ state: 'visible' });
    assert.equal(posts.length, 2, 'mirar la pantalla otra vez no avisa de nuevo');

    assert.equal(await desborde(page), 0);
    assert.deepEqual(consola, []);
  });
});

test('390 px: un 429 al abrir «Pagar» deja la pantalla con un aviso tranquilo y SIN reintento automático; «Avisar de nuevo» (manual) lo vuelve a intentar', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, alerta: (n, cuerpo) => (n === 1 ? { status: 429, body: { error: 'demasiadas solicitudes' } } : { status: 200, body: { ok: true, metodo: cuerpo.metodo, creada_en: 'x' } }) }, async ({ page, posts }) => {
    await tocarPagar(page, 390);
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.pago-aviso').getAttribute('role'), 'alert');
    assert.match(await page.locator('.pago-aviso').innerText(), /mucha gente avisando.*avisar de nuevo/i);
    await page.waitForTimeout(1500); // nada se reintenta solo
    assert.equal(posts.length, 1);
    assert.equal(await visible(page, '#pago-efectivo'), true, 'la pantalla sigue ahí: pagar no depende del aviso');
    assert.equal(await visible(page, '.pago-listo'), false, 'y no dice «Listo, le avisamos» si no se pudo avisar');
    await page.getByRole('button', { name: 'Avisar de nuevo' }).click();
    await esperarAviso(page);
    assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta', 'cuenta'], '«Avisar de nuevo» vuelve a mandar el mismo aviso');
    assert.equal(await page.locator('.pago-aviso').count(), 0, 'y el aviso de error se va');
  });
});

test('390 px: sin red (el POST falla) y con 409 (sin cuenta abierta) se explican en la pantalla de pago, con «Avisar de nuevo» y sin cerrar nada', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, alerta: () => ({ abortar: true }) }, async ({ page, posts }) => {
    await tocarPagar(page, 390);
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-aviso').innerText(), /sin conexión.*avisar de nuevo/i);
    assert.equal(await visible(page, '#pago-efectivo'), true, 'la pantalla de pago sigue');
    assert.equal(await page.getByRole('button', { name: 'Avisar de nuevo' }).isVisible(), true);
    assert.equal(posts.length, 1);
  });
  await conCarta(t, { ancho: 390, alto: 844, alerta: () => ({ status: 409, body: { error: 'sin cuenta' } }) }, async ({ page }) => {
    await tocarPagar(page, 390);
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    assert.match(await page.locator('.pago-aviso').innerText(), /todavía no hay una cuenta abierta/i);
    assert.equal(await page.getByRole('button', { name: 'Avisar de nuevo' }).isVisible(), true);
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
  test(`${ancho} px, función encendida: «Pagar» en el panel → UNA pantalla que avisa sola → «Avisar que pago en efectivo» → «Volver a la cuenta» → «Listo, le avisamos al mesero»; mismo contrato del POST`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto: ancho === 1280 ? 800 : 900 }, async ({ page, posts, consola }) => {
      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      await page.locator('#pago-breb').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.pago-opcion').count(), 0);
      assert.equal(await visible(page, '.cuenta-total'), true, 'el total sigue a la vista mientras se paga');
      await esperarAviso(page);
      assert.deepEqual(posts.map((p) => p.cuerpo), [{ m: 7, k: TOKEN, metodo: 'cuenta' }], 'abrir «Pagar» avisa sola, sin elegir');
      await page.locator('#pago-avisar-efectivo').click();
      await page.getByText('Le avisamos: pagas en efectivo.').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Volver a la cuenta' }).click();
      await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
      assert.match(await page.locator('.pago-listo').innerText(), /Vas a pagar con efectivo/);
      assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta', 'efectivo']);
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
      // Con la página ya asentada: las fuentes cargadas y la aparición escalonada (.reveal, un desplazamiento de 10 px
      // durante ~1 s) terminada. «Ejecutivos» es corta a 1440×1200 y solo toca la banda del observador por unos
      // pocos píxeles: con la tipografía de respaldo o la animación a medias, a veces no la tocaba y se marcaba «Entradas».
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished)));
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
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    const lecturasEnLaHoja = cuentas.length;
    assert.ok(lecturasEnLaHoja >= 1, 'la hoja abierta leyó la cuenta');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
    await page.locator('.cuenta-hoja').waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await visible(page, 'div.fixed.bottom-0'), false);
    assert.equal(await page.locator('.cuenta-hoja').count(), 1, 'una sola cuenta en el DOM');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.cuenta-hoja').waitFor({ state: 'hidden' });
    assert.equal(await visible(page, 'div.fixed.bottom-0'), true, 'de vuelta en el celular: la barra y la hoja cerrada');
    // La cuenta en vivo (cuenta-en-mesa) ya se estaba siguiendo con la hoja: pasar al panel y volver NO la
    // reinicia ni la duplica (antes, con el sondeo viejo, cada cruce leía de nuevo).
    assert.equal(cuentas.length, lecturasEnLaHoja, 'cruzar los 1024 px no relee ni duplica la lectura');
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

test('el aviso de error de Pagar va arriba (bajo el título, antes del efectivo), es un role="alert" y se ve entero en un celular bajo (360×640, 320×568)', { skip: saltar() }, async (t) => {
  for (const [ancho, alto] of [[360, 640], [320, 568]]) {
    await conCarta(t, { ancho, alto, movil: true, alerta: () => ({ status: 429, body: { error: 'demasiadas solicitudes' } }) }, async ({ page, consola }) => {
      await tocarPagar(page, ancho);
      const aviso = page.locator('.pago-aviso');
      await aviso.waitFor({ state: 'visible' });
      assert.equal(await aviso.getAttribute('role'), 'alert');
      const [titulo] = await cajas(page, '#pago-breb-titulo');
      const [efectivo] = await cajas(page, '#pago-efectivo');
      const [avisoCaja] = await cajas(page, '.pago-aviso');
      assert.ok(avisoCaja.top >= titulo.bottom - 1, `a ${ancho}×${alto} el aviso (${avisoCaja.top}) va bajo el título (${titulo.bottom})`);
      assert.ok(avisoCaja.bottom <= efectivo.top, `a ${ancho}×${alto} el aviso (${avisoCaja.bottom}) debe estar arriba de «O en efectivo» (${efectivo.top})`);
      assert.ok(dentroDe(avisoCaja, await marcoDe(page, '.cuenta-cuerpo')), `a ${ancho}×${alto} el aviso queda fuera del cuerpo de la hoja`);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola.filter((m) => !/status of 429/.test(m)), []);
    });
  }
});

test('el aviso de error se trae a la vista aunque el cuerpo de la hoja estuviera desplazado hacia abajo (320×568, con el QR en pantalla, tocando «Avisar que pago en efectivo»)', { skip: saltar() }, async (t) => {
  const alerta = (n, cuerpo) => (n === 1 ? { status: 200, body: { ok: true, metodo: cuerpo.metodo, creada_en: 'x' } } : { status: 409, body: { error: 'sin cuenta' } });
  await conCarta(t, { ancho: 320, alto: 568, movil: true, breb: BREB, alerta }, async ({ page }) => {
    await tocarPagar(page, 320);
    await esperarAviso(page);
    await qrDibujado(page);
    const desplazable = await page.evaluate(() => { const c = document.querySelector('.cuenta-cuerpo'); c.scrollTop = c.scrollHeight; return c.scrollTop; });
    assert.ok(desplazable > 0, 'a 320×568 el QR, la llave y el efectivo no caben: el cuerpo se desplaza (si ya caben, esta prueba no prueba nada)');
    await page.locator('#pago-avisar-efectivo').click();
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    await page.waitForTimeout(200);
    assert.ok(dentroDe((await cajas(page, '.pago-aviso'))[0], await marcoDe(page, '.cuenta-cuerpo')), 'el aviso quedó fuera de vista');
  });
});

test('«Listo» no aparece mientras se ve la pantalla de pago (parecía confirmar el aviso), el efectivo cabe en 360×640 y «Volver a la cuenta» lo devuelve', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 360, alto: 640, movil: true }, async ({ page }) => {
    const listo = page.getByRole('button', { name: 'Listo', exact: true });
    await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await listo.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('#pago-breb').waitFor({ state: 'visible' });
    await esperarAviso(page);
    await listo.waitFor({ state: 'hidden' });   // «Listo» sigue a la vista en la pantalla de pago = parecía confirmar el aviso
    const marco = await marcoDe(page, '.cuenta-cuerpo');
    for (const selector of ['#pago-breb-titulo', '#pago-sin-datos', '#pago-efectivo']) assert.ok(dentroDe((await cajas(page, selector))[0], marco), `${selector} no cabe en el cuerpo de la hoja a 360×640`);
    await page.getByRole('button', { name: 'Volver a la cuenta' }).click();
    await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
    assert.equal(await listo.isVisible(), true, 'ya avisado, «Listo» cierra la hoja como siempre');
    await page.locator('#pago-ver').click();
    await page.locator('#pago-breb').waitFor({ state: 'visible' });
    await listo.waitFor({ state: 'hidden' });   // y al volver a la pantalla de pago se esconde otra vez
  });
});

test('táctil: la flecha «Volver a la cuenta», «Avisar que pago en efectivo» y «Ver cómo pagar» miden ≥ 44 px y caben a lo ancho (390×844 y 320×568)', { skip: saltar() }, async (t) => {
  for (const [ancho, alto] of [[390, 844], [320, 568]]) {
    await conCarta(t, { ancho, alto, movil: true }, async ({ page }) => {
      await tocarPagar(page, ancho);
      await esperarAviso(page);
      const medir = async (selector, etiqueta) => {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        const b = await control.boundingBox();
        assert.ok(b.height >= 43.5 && b.width >= 43.5, `a ${ancho}×${alto} «${etiqueta}» mide ${b.width}×${b.height}`);
        assert.equal(await control.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), true, `a ${ancho}×${alto} «${etiqueta}» no cabe a lo ancho`);
      };
      await medir('#pago-cambiar-breb', 'Volver a la cuenta');
      await medir('#pago-avisar-efectivo', 'Avisar que pago en efectivo');
      await page.locator('#pago-cambiar-breb').click();
      await page.locator('#pago-ver').waitFor({ state: 'visible' });
      await medir('#pago-ver', 'Ver cómo pagar');
    });
  }
});

test('el foco sigue al flujo: «Pagar» → el título de la pantalla; «Volver a la cuenta» → «Ver cómo pagar» (ya avisado) o «Pagar» (si el aviso falló); «Ver cómo pagar» → el título otra vez', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 390, alto: 844, movil: true }, async ({ page }) => {
    await tocarPagar(page, 390);
    await page.waitForFunction(() => document.activeElement.id === 'pago-breb-titulo');
    await esperarAviso(page);
    await page.locator('#pago-cambiar-breb').click();
    await page.waitForFunction(() => document.activeElement.id === 'pago-ver');
    await page.locator('#pago-ver').click();
    await page.waitForFunction(() => document.activeElement.id === 'pago-breb-titulo');
  });
  await conCarta(t, { ancho: 390, alto: 844, movil: true, alerta: () => ({ status: 500, body: { error: 'boom' } }) }, async ({ page }) => {
    await tocarPagar(page, 390);
    await page.waitForFunction(() => document.activeElement.id === 'pago-breb-titulo');
    await page.locator('.pago-aviso').waitFor({ state: 'visible' });
    await page.locator('#pago-cambiar-breb').click();
    await page.waitForFunction(() => document.activeElement.id === 'pago-pagar');
  });
});

for (const [ancho, alto, items, nombre] of [[1024, 768, MUCHOS_ITEMS, '12 ítems'], [1366, 768, ITEMS, '3 ítems'], [1280, 720, MUCHOS_ITEMS, '12 ítems'], [1024, 600, ITEMS, '3 ítems']]) {
  test(`${ancho}×${alto} (${nombre}): el panel entero cabe en la ventana, con su borde redondeado y el total a la vista — con la cuenta, en la pantalla de pago y ya avisado`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto, items }, async ({ page, consola }) => {
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      const comprobar = async (etapa) => {
        const hoja = await page.locator('.cuenta-hoja').boundingBox();
        assert.ok(hoja.y >= 0 && hoja.y + hoja.height <= alto, `${etapa}: el panel va de ${hoja.y} a ${hoja.y + hoja.height} en una ventana de ${alto}`);
        assert.ok((await page.locator('.cuenta-total').boundingBox()).y + 30 <= alto, `${etapa}: el total quedó fuera de la ventana`);
      };
      await comprobar('con la cuenta');
      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      await page.locator('#pago-breb').waitFor({ state: 'visible' });
      await esperarAviso(page);
      await comprobar('pagando');
      // Mide ≥ 44 px de alto: «Avisar que pago en efectivo» es un botón sin fondo pero con zona táctil entera.
      const efectivo = await page.locator('#pago-avisar-efectivo').boundingBox();
      assert.ok(efectivo.height >= 44 - 0.5, `«Avisar que pago en efectivo» mide ${efectivo.height} px de alto`);
      await page.getByRole('button', { name: 'Volver a la cuenta' }).click();
      await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
      await comprobar('avisado');
      // «Ver cómo pagar» mide ≥ 44 px de alto y entra.
      const ver = await page.locator('#pago-ver').boundingBox();
      assert.ok(ver.height >= 44 - 0.5, `«Ver cómo pagar» mide ${ver.height} px de alto`);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
    });
  });
}

test('1280×720 con 12 ítems y ya avisado: caben al menos 3 filas enteras, y una sombra avisa que la lista sigue (y se apaga al final y cuando todo cabe)', { skip: saltar() }, async (t) => {
  await conCarta(t, { ancho: 1280, alto: 720, items: MUCHOS_ITEMS }, async ({ page }) => {
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await esperarAviso(page);
    await page.getByRole('button', { name: 'Volver a la cuenta' }).click();
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
  test(`celular apaisado ${ancho}×${alto}: la pantalla de pago se alcanza entera (la hoja no pasa del alto de la ventana y se desplaza, no un cuerpo de 50 px) y se puede avisar el efectivo`, { skip: saltar() }, async (t) => {
    await conCarta(t, { ancho, alto, movil: true }, async ({ page, posts, consola }) => {
      await tocarPagar(page, ancho);
      await esperarAviso(page);
      const medidas = await page.evaluate(() => { const c = document.querySelector('.cuenta-cuerpo'); const h = document.querySelector('.cuenta-hoja'); return { overflowCuerpo: getComputedStyle(c).overflowY, cuerpoCabe: c.scrollHeight <= c.clientHeight + 1, hojaH: h.getBoundingClientRect().height, hojaBorde: h.getBoundingClientRect().bottom, vh: innerHeight, hojaScroll: getComputedStyle(h).overflowY }; });
      assert.equal(medidas.cuerpoCabe, true, 'el cuerpo no tiene un scroll de 50 px: la hoja apaisada es la que se desplaza');
      assert.equal(medidas.hojaScroll, 'auto');
      assert.ok(medidas.hojaH <= medidas.vh + 1, `la hoja (${medidas.hojaH}) no pasa del alto de la ventana (${medidas.vh})`);
      // Todo se alcanza: «Avisar que pago en efectivo» se trae a la vista y se toca.
      await page.locator('#pago-avisar-efectivo').scrollIntoViewIfNeeded();
      await page.locator('#pago-avisar-efectivo').click();
      await page.getByText('Le avisamos: pagas en efectivo.').waitFor({ state: 'visible' });
      assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['cuenta', 'efectivo']);
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
