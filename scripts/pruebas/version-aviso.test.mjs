// El aviso de versión nueva del POS (pos.html, «Versión del sitio» en el store), probado con el <script> REAL del store en un `vm`
// (arnés de _pos-vm.mjs): sale con una versión distinta y no con la misma, no sale sin red, «Después» lo esconde, «Recargar» refresca
// la caché HTTP (fetch con cache «reload») y recarga, y NUNCA recarga solo. Lo que mira un navegador de verdad (el aviso pintado, sus
// medidas, el pie, lo que sobrevive al recargar) está en version-aviso-navegador.test.mjs.
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crearPos, asentar, dormir, plano, scriptDelStore, RAIZ } from './_pos-vm.mjs';

const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const ORIGEN = 'https://resplandor.ynt.codes';
const VIEJA = '2026.10.02-1111111';
const NUEVA = '2026.10.03-2222222';
const OTRA = '2026.10.04-3333333';
const HORA = 60 * 60 * 1000;

/**
 * Un POS con su «navegador» de mentira: el <meta> con `pagina`, un `fetch` que contesta lo que diga `red`, `location.reload` que se
 * apunta, un reloj que se mueve a mano y los temporizadores/oyentes a la vista. `red.modo`: 'ok' | 'sin-red' | 'http' | 'basura' |
 * 'colgado' (no contesta hasta que lo aborten) | 'manual' (contesta cuando la prueba llama a `red.pendiente.contestar()`).
 * `red.version` es lo que publica version.json. Para una sola URL: `red.falla(url)` la hace fallar y `red.cuelga(url)` la cuelga:
 * 'respuesta' (ni las cabeceras llegan), 'cuerpo' (contesta y el cuerpo no da ni un byte: la conexión se detuvo) o 'goteo' (contesta y el
 * cuerpo da los trozos que la prueba mande: `red.goteo.at(-1).trozo()` y, al final, `.fin()`).
 * El documento se lee por partes (con un reader, como en el navegador); los scripts y hojas, con arrayBuffer().
 * Los topes de «Recargar» no corren solos: los temporizadores con los valores del store quedan VIVOS en `red.topes.{respuesta,sinBytes,
 * documento,hojas,seguro}` (se quita el que se cancela con clearTimeout) y la prueba dispara el que quiera.
 */
function montar({ pagina = VIEJA, publicada = pagina, scripts = [], almacen, responder = () => undefined, navegador } = {}) {
  const red = { version: publicada, modo: 'ok', fetch: [], cuerpos: [], orden: [], recargas: 0, intervalos: [], topes: { respuesta: [], sinBytes: [], documento: [], hojas: [], seguro: [] }, aviso: [], goteo: [], pendiente: null, falla: null, cuelga: null, alPedir: null };
  const reloj = { t: Date.parse('2026-10-02T12:00:00Z') };
  class FechaFalsa extends Date { static now() { return reloj.t; } }
  const elemento = (atributos) => ({ getAttribute: (a) => atributos[a] ?? null });
  const hoja = (src) => elemento({ src });
  const css = (href) => elemento({ href });
  const abortado = () => new DOMException('abortado', 'AbortError');
  // El cuerpo por partes de un pedido que contestó: `modo` 'ok' (tres trozos y fin) | 'cuerpo' (ni un byte) | 'goteo' (lo que mande la prueba).
  const lectorFalso = (url, signal, modo) => {
    let trozos = 3;
    return {
      read: () => new Promise((resolver, rechazar) => {
        if (signal?.aborted) return rechazar(abortado());
        signal?.addEventListener('abort', () => rechazar(abortado()), { once: true });
        if (modo === 'cuerpo') return undefined;
        if (modo === 'goteo') { red.goteo.push({ url, trozo: () => resolver({ done: false, value: new Uint8Array(4) }), fin: () => { red.cuerpos.push(url); resolver({ done: true, value: undefined }); } }); return undefined; }
        if (trozos-- > 0) return resolver({ done: false, value: new Uint8Array(4) });
        red.cuerpos.push(url);
        return resolver({ done: true, value: undefined });
      }),
    };
  };
  const fetchFalso = (url, opciones = {}) => {
    const cache = opciones.cache;
    red.fetch.push({ url: String(url), cache, signal: opciones.signal, cuerposAntes: red.cuerpos.length });   // cuántos cuerpos ya se habían leído al pedirlo
    red.orden.push(`fetch ${url} [${cache}]`);
    if (red.alPedir) red.alPedir(String(url));
    if (red.modo === 'sin-red' || (red.falla && red.falla(String(url)))) return Promise.reject(new TypeError('Failed to fetch'));
    if (red.modo === 'manual') {
      return new Promise((resolver) => { red.pendiente = { contestar: () => resolver({ ok: true, status: 200, json: async () => ({ version: red.version }), arrayBuffer: async () => new ArrayBuffer(0) }) }; });
    }
    const hastaAbortar = () => new Promise((_, rechazar) => opciones.signal?.addEventListener('abort', () => rechazar(abortado())));
    const cuelga = red.cuelga && red.cuelga(String(url));
    if (red.modo === 'colgado' || cuelga === 'respuesta') return hastaAbortar();
    const esVersion = String(url).startsWith('version.json');
    if (red.modo === 'http') return Promise.resolve({ ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => (red.modo === 'basura' ? (() => { throw new SyntaxError('Unexpected token <'); })() : { version: red.version, fecha: '2026-10-03', huella: 'x' }),
      body: { getReader: () => lectorFalso(String(url), opciones.signal, cuelga === 'cuerpo' || cuelga === 'goteo' ? cuelga : 'ok') },
      arrayBuffer: async () => { red.cuerpos.push(String(url)); return cuelga === 'cuerpo' || cuelga === 'goteo' ? hastaAbortar() : new ArrayBuffer(esVersion ? 0 : 8); },
    });
  };
  // Los temporizadores con los valores del store (10 s sin cabeceras, 15 s sin bytes, 5 min el documento, 20 s los scripts y hojas, 30 s el seguro
  // de tras recargar, 4 s el «Estás en la última versión») no corren solos: quedan a la vista mientras estén vivos y la prueba dispara el que quiera.
  const NOMBRES = { 10000: 'respuesta', 15000: 'sinBytes', 300000: 'documento', 20000: 'hojas', 30000: 'seguro', 4000: 'aviso' };
  const vivos = (nombre) => (nombre === 'aviso' ? red.aviso : red.topes[nombre]);
  const falsos = new Map();
  const timeoutPropio = (fn, ms, ...a) => {
    const nombre = NOMBRES[ms];
    if (!nombre) return setTimeout(fn, ms, ...a);
    const id = { falso: nombre };
    falsos.set(id, { nombre, fn });
    vivos(nombre).push(fn);
    return id;
  };
  const clearPropio = (id) => {
    const f = id && falsos.get(id);
    if (!f) return clearTimeout(id);
    const lista = vivos(f.nombre);
    const i = lista.indexOf(f.fn);
    if (i >= 0) lista.splice(i, 1);
    return falsos.delete(id);
  };
  const doc = {
    querySelector: (sel) => (pagina && sel.includes('resplandor-version') ? { content: pagina } : null),
    querySelectorAll: () => [...scripts.map(hoja)].concat([css('assets/css/otra.css'), css('https://fonts.googleapis.com/css2?family=Archivo')]),
    visibilityState: 'visible',
  };
  const r = crearPos({
    base: undefined, responder, almacen,
    extras: {
      ...(navegador ? { navigator: navegador } : {}),
      fetch: fetchFalso, Date: FechaFalsa, setTimeout: timeoutPropio, clearTimeout: clearPropio,
      setInterval: (fn, ms) => { red.intervalos.push({ fn, ms }); return red.intervalos.length; },
      location: { href: `${ORIGEN}/pos.html?x=1#abajo`, origin: ORIGEN, search: '?x=1', hash: '#abajo', pathname: '/pos.html', reload() { red.recargas++; red.orden.push('reload'); } },
    },
    documento: doc,
  });
  return { ...r, red, reloj, doc, dispararVentana: (nombre) => (r.oyentes.ventana[nombre] || []).forEach((f) => f()), dispararDocumento: (nombre) => (r.oyentes.documento[nombre] || []).forEach((f) => f()) };
}

const pedidosDeVersion = (m) => m.red.fetch.filter((f) => f.url.startsWith('version.json'));

// ───────────────────────── sale / no sale ─────────────────────────

test('con una versión publicada distinta de la del <meta>, hay versión nueva y el aviso sale', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  assert.equal(m.pos.avisoVersionVisible, false, 'antes de preguntar no hay nada que avisar');
  m.pos._vigilarVersion();
  await asentar();
  assert.equal(m.pos.versionPagina, VIEJA);
  assert.equal(m.pos.versionPublicada, NUEVA);
  assert.equal(m.pos.hayVersionNueva, true);
  assert.equal(m.pos.avisoVersionVisible, true);
});

test('con la misma versión no sale, y la del pie queda en «normal»', async () => {
  const m = montar({ pagina: VIEJA, publicada: VIEJA });
  m.pos._vigilarVersion();
  await asentar();
  assert.equal(m.pos.versionPublicada, VIEJA);
  assert.equal(m.pos.hayVersionNueva, false);
  assert.equal(m.pos.avisoVersionVisible, false);
  assert.equal(m.pos.versionPieEstado, 'normal');
});

test('pide version.json?t=<ms> con cache «no-store» (ni la caché del navegador ni la del CDN)', async () => {
  const m = montar({ pagina: VIEJA, publicada: VIEJA });
  m.pos._vigilarVersion();
  await asentar();
  const [p] = pedidosDeVersion(m);
  assert.ok(p, 'pidió version.json');
  assert.equal(p.cache, 'no-store');
  assert.match(p.url, /^version\.json\?t=\d+$/);
  assert.equal(p.url, `version.json?t=${m.reloj.t}`, 't es la hora en milisegundos: cada pedido es una URL distinta');
  assert.ok(p.signal, 'con tope de tiempo (AbortController)');
});

test('sin red, con un error del servidor o con algo que no es version.json: silencio (no sale nada, no se queja)', async () => {
  for (const modo of ['sin-red', 'http', 'basura']) {
    const m = montar({ pagina: VIEJA, publicada: NUEVA });
    m.red.modo = modo;
    m.pos._vigilarVersion();
    await asentar();
    assert.equal(pedidosDeVersion(m).length, 1, `${modo}: sí lo intentó`);
    assert.equal(m.pos.versionPublicada, '', `${modo}: no se inventa una versión`);
    assert.equal(m.pos.avisoVersionVisible, false, `${modo}: no sale el aviso`);
    assert.equal(m.pos.aviso, null, `${modo}: ni un aviso breve del POS`);
    assert.deepEqual(m.avisos, [], `${modo}: ni un alert()`);
    assert.deepEqual(m.consola, [], `${modo}: ni una línea de error en la consola`);
    assert.equal(m.red.recargas, 0);
  }
});

test('una versión mal formada en version.json se ignora (por ejemplo, el HTML de un portal cautivo contestado con 200)', async () => {
  for (const mala of ['', 'hoy', '2026.10.03', '<html>', '2026.10.03-ZZZZZZZ', null]) {
    const m = montar({ pagina: VIEJA, publicada: mala });
    m.pos._vigilarVersion();
    await asentar();
    assert.equal(m.pos.versionPublicada, '', `«${mala}» no es una versión`);
    assert.equal(m.pos.avisoVersionVisible, false);
  }
});

test('una página sin sello (sin <meta>) no puede comparar: ni pregunta, ni avisa, ni deja oyentes', async () => {
  const m = montar({ pagina: '', publicada: NUEVA });
  m.pos._vigilarVersion();
  await asentar();
  assert.equal(m.red.fetch.length, 0);
  assert.equal(m.red.intervalos.length, 0);
  assert.equal(m.pos.avisoVersionVisible, false);
});

test('una versión que se recupera sola: tras un error, la siguiente búsqueda con red hace salir el aviso', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  m.red.modo = 'sin-red';
  m.pos._vigilarVersion();
  await asentar();
  assert.equal(m.pos.avisoVersionVisible, false);
  m.red.modo = 'ok';
  m.reloj.t += 6 * 60 * 1000;
  m.red.intervalos.find((i) => i.ms === 300000).fn();
  await asentar();
  assert.equal(m.pos.avisoVersionVisible, true);
});

// ───────────────────────── cuándo pregunta ─────────────────────────

test('pregunta al arrancar, también en el login: init() sin sesión ya vigila la versión', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  await m.pos.init();            // la sesión del arnés es null: es la pantalla de login
  await asentar();
  assert.equal(m.pos.usuario, null);
  assert.equal(m.pos.sesionLista, true);
  assert.equal(pedidosDeVersion(m).length, 1, 'preguntó en el arranque, sin esperar a ningún login');
  assert.equal(m.pos.avisoVersionVisible, true, 'y el aviso puede salir sobre el login');
});

test('pregunta cada 5 minutos', async () => {
  const m = montar({ pagina: VIEJA, publicada: VIEJA });
  m.pos._vigilarVersion();
  await asentar();
  const reloj5 = m.red.intervalos.filter((i) => i.ms === 5 * 60 * 1000);
  assert.equal(reloj5.length, 1, 'un temporizador de 5 minutos');
  const antes = pedidosDeVersion(m).length;
  m.reloj.t += 5 * 60 * 1000;
  reloj5[0].fn();
  await asentar();
  assert.equal(pedidosDeVersion(m).length, antes + 1);
});

test('pregunta al volver a la pestaña (no al esconderla) y al volver la red; no se atropella si llegan juntas', async () => {
  const m = montar({ pagina: VIEJA, publicada: VIEJA });
  m.pos._vigilarVersion();
  await asentar();
  assert.equal(pedidosDeVersion(m).length, 1);

  // Volver la red y volver a la pestaña llegan juntos al despertar la tablet: dentro de los 15 s, no se pregunta de nuevo.
  m.dispararVentana('online'); m.dispararDocumento('visibilitychange');
  await asentar();
  assert.equal(pedidosDeVersion(m).length, 1, 'recién preguntó: espera 15 s');

  m.reloj.t += 16000;
  m.dispararVentana('online');
  await asentar();
  assert.equal(pedidosDeVersion(m).length, 2, 'al volver la red');

  m.reloj.t += 16000;
  m.caja.document.visibilityState = 'hidden';
  m.dispararDocumento('visibilitychange');
  await asentar();
  assert.equal(pedidosDeVersion(m).length, 2, 'al esconder la pestaña no pregunta');
  m.caja.document.visibilityState = 'visible';
  m.dispararDocumento('visibilitychange');
  await asentar();
  assert.equal(pedidosDeVersion(m).length, 3, 'al volver a la pestaña');
});

test('una sola pregunta a la vez: dos búsquedas seguidas comparten el mismo pedido', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  m.red.modo = 'manual';
  m.pos._vigilarVersion();
  await asentar();
  m.reloj.t += 60000;
  const b = m.pos.buscarVersion({ manual: true });
  const c = m.pos.buscarVersion({ manual: true });
  assert.equal(pedidosDeVersion(m).length, 1, 'un solo pedido en vuelo');
  m.red.pendiente.contestar();
  assert.deepEqual(await Promise.all([b, c]), [NUEVA, NUEVA]);
  assert.equal(m.pos.versionPublicada, NUEVA);
  assert.equal(pedidosDeVersion(m).length, 1);
  assert.equal(m.pos._versionEnVuelo, null, 'y al terminar queda libre para la siguiente');
});

// ───────────────────────── «Después» ─────────────────────────

test('«Después» esconde el aviso; lo sigue escondiendo mientras la versión sea la misma', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  m.pos._vigilarVersion();
  await asentar();
  assert.equal(m.pos.avisoVersionVisible, true);
  m.pos.despuesVersionNueva();
  assert.equal(m.pos.avisoVersionVisible, false);
  m.reloj.t += 6 * 60 * 1000;
  m.red.intervalos.find((i) => i.ms === 300000).fn();
  await asentar();
  assert.equal(m.pos.versionPublicada, NUEVA);
  assert.equal(m.pos.avisoVersionVisible, false, 'otra búsqueda con la misma versión: sigue escondido');
  assert.equal(m.pos.hayVersionNueva, true, 'hay una nueva: solo se escondió el aviso');
  assert.equal(m.red.recargas, 0);
});

test('«Después» vuelve a mostrarse cuando sale una versión DISTINTA', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  m.pos._vigilarVersion();
  await asentar();
  m.pos.despuesVersionNueva();
  assert.equal(m.pos.avisoVersionVisible, false);
  m.red.version = OTRA;
  m.reloj.t += 6 * 60 * 1000;
  m.red.intervalos.find((i) => i.ms === 300000).fn();
  await asentar();
  assert.equal(m.pos.versionPublicada, OTRA);
  assert.equal(m.pos.avisoVersionVisible, true);
});

test('«Después» vuelve a mostrarse pasada 1 hora (y no antes)', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  m.pos._vigilarVersion();
  await asentar();
  m.pos.despuesVersionNueva();
  const tic = () => { m.reloj.t += 5 * 60 * 1000; m.red.intervalos.find((i) => i.ms === 300000).fn(); return asentar(); };
  for (let i = 0; i < 11; i++) await tic();     // 55 minutos
  assert.equal(m.pos.avisoVersionVisible, false, 'a los 55 minutos sigue escondido');
  await tic();                                    // 60 minutos
  await tic();                                    // 65 minutos
  assert.equal(m.pos.avisoVersionVisible, true, 'pasada la hora, vuelve');
});

test('«Después» sin una versión nueva no hace nada', () => {
  const m = montar({ pagina: VIEJA, publicada: VIEJA });
  m.pos.despuesVersionNueva();
  assert.equal(m.pos._versionDespues, null);
});

// ───────────────────────── «Recargar» ─────────────────────────

test('«Recargar» refresca la caché HTTP del documento y de sus scripts y hojas del mismo origen con cache «reload», y DESPUÉS recarga', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, scripts: ['assets/vendor/alpinejs-3.17.4.min.js', 'https://cdn.otro-host.example/x.js', '/assets/vendor/supabase-js-2.117.2.umd.js'] });
  m.pos._vigilarVersion();
  await asentar();
  m.red.fetch.length = 0; m.red.orden.length = 0;
  await m.pos.recargarVersionNueva();
  const reload = m.red.fetch.filter((f) => f.cache === 'reload').map((f) => f.url).sort();
  assert.deepEqual(reload, [
    `${ORIGEN}/assets/css/otra.css`,
    `${ORIGEN}/assets/vendor/alpinejs-3.17.4.min.js`,
    `${ORIGEN}/assets/vendor/supabase-js-2.117.2.umd.js`,
    `${ORIGEN}/pos.html?x=1`,
  ].sort(), 'el documento (sin el #…) y cada <script src> y <link rel=stylesheet> del mismo origen; nada de otro host');
  assert.equal(m.red.fetch.length, 5, 'y nada más que una mirada a version.json antes de recargar: ni los de otro host (fuentes de Google, otros CDN)');
  assert.match(m.red.fetch.at(-1).url, /^version\.json\?t=\d+$/, 'la mirada va después de los scripts y hojas, que pueden tardar');
  assert.equal(m.red.fetch.at(-1).cache, 'no-store');
  assert.equal(m.red.orden[0], `fetch ${ORIGEN}/pos.html?x=1 [reload]`, 'el documento se pide primero y solo: junto a los scripts, con una red lenta, no terminaba de bajar');
  assert.ok(m.red.fetch.slice(1).every((f) => f.cuerposAntes >= 1), 'y se lee entero antes de pedir los scripts y las hojas (con poca red, pedidos juntos se repartían el ancho de banda)');
  assert.deepEqual(m.red.cuerpos.sort(), reload, 'se leyó el cuerpo entero de cada uno (si no, al recargar se cancela la descarga y la caché no se actualiza)');
  assert.equal(m.red.recargas, 1);
  assert.equal(m.red.orden.at(-1), 'reload', 'recarga DESPUÉS de refrescar la caché, nunca antes');
  assert.ok(m.red.orden.slice(0, -1).every((x) => x.startsWith('fetch ')));
});

const NOTA_SIN_RED = /Sin conexión: el POS sigue trabajando/;
const NOTA_NO_BAJO = /No pude descargar la versión nueva \(¿sin internet\?\)/;
const NOTA_LENTA = /No pude descargar la versión nueva: la conexión está muy lenta/;
const NOTA_GUARDANDO = /Todavía se está guardando lo último de la cuenta/;
const NOTA_SE_MUEVE = /La cuenta siguió cambiando mientras bajaba la versión nueva/;

test('«Recargar» SIN RED no recarga: una recarga sin internet tira el POS a la página de error del navegador. Avisa, no pide nada y deja el botón libre', async () => {
  // El navegador dice que no hay red, o el POS ya lo sabe (remoto «offline»): ni siquiera se intenta descargar.
  for (const [como, preparar] of [
    ['navigator.onLine false', (m) => { m.caja.navigator.onLine = false; }],
    ['el POS está «offline»', (m) => { m.pos.remoto = 'offline'; }],
  ]) {
    const m = montar({ pagina: VIEJA, publicada: NUEVA, scripts: ['assets/vendor/a.js'], navegador: {} });
    m.pos._vigilarVersion();
    await asentar();
    m.red.fetch.length = 0;
    preparar(m);
    await m.pos.recargarVersionNueva();
    assert.equal(m.red.recargas, 0, `${como}: no recarga`);
    assert.equal(m.red.fetch.length, 0, `${como}: ni pide el documento`);
    assert.match(m.pos.versionRecargaNota, NOTA_SIN_RED, como);
    assert.equal(m.pos.versionRecargando, false, `${como}: el botón queda libre para volver a tocarlo`);
    assert.equal(m.pos.avisoVersionVisible, true, `${como}: el aviso sigue ahí`);
    assert.deepEqual(m.avisos, [], `${como}: sin alert()`);
  }
});

test('«Recargar» con el wifi sin salida (navigator.onLine sigue en true) o el documento sin descargar: no recarga y lo dice; con un error del servidor o sin que nada conteste, igual', async () => {
  const intento = async (preparar) => {
    const m = montar({ pagina: VIEJA, publicada: NUEVA, scripts: ['assets/vendor/a.js'], navegador: { onLine: true } });
    m.pos._vigilarVersion();
    await asentar();
    preparar(m);
    const esperando = m.pos.recargarVersionNueva();
    await asentar();
    if (m.red.modo === 'colgado') {
      assert.equal(m.red.recargas, 0, 'mientras no contestan, espera');
      assert.equal(m.red.topes.respuesta.length, 1, 'con un tope para «ni las cabeceras llegan»');
      m.red.topes.respuesta[0]();
    }
    await esperando;
    return m;
  };
  const sinSalida = await intento((m) => { m.red.modo = 'sin-red'; });
  assert.equal(sinSalida.red.recargas, 0, 'sin salida a internet: no recarga');
  assert.match(sinSalida.pos.versionRecargaNota, NOTA_NO_BAJO);
  assert.equal(sinSalida.pos.versionRecargando, false);
  const http = await intento((m) => { m.red.modo = 'http'; });
  assert.equal(http.red.recargas, 0, 'un 503 del documento: no recarga (la copia vieja sigue sirviendo)');
  assert.match(http.pos.versionRecargaNota, NOTA_NO_BAJO);
  const colgada = await intento((m) => { m.red.modo = 'colgado'; });
  assert.equal(colgada.red.recargas, 0, 'si ni las cabeceras llegan: no recarga');
  assert.match(colgada.pos.versionRecargaNota, NOTA_NO_BAJO, 'y dice «¿sin internet?»: nada contestó');
  assert.ok(colgada.red.fetch.filter((f) => f.cache === 'reload').every((f) => f.signal.aborted), 'y lo que seguía colgado se abortó');
  assert.equal(colgada.red.fetch.filter((f) => f.cache === 'reload').length, 1, 'se pidió solo el documento: sin él, los scripts no se piden');
  assert.equal(colgada.pos.versionRecargando, false);
});

test('una red LENTA que funciona no es una red caída: el documento baja solo y con un tope largo; los scripts son de mejor esfuerzo y su tope no impide recargar', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, scripts: ['assets/vendor/a.js', 'assets/vendor/b.js'], navegador: { onLine: true } });
  m.pos._vigilarVersion();
  await asentar();
  m.red.fetch.length = 0;
  m.red.cuelga = (url) => (url.endsWith('.js') ? 'cuerpo' : undefined);        // el documento baja; los scripts, con esta red, no terminan
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  assert.equal(m.red.recargas, 0, 'mientras baja lo demás, todavía no recarga');
  assert.equal(m.red.topes.hojas.length, 1, 'los scripts y hojas tienen su propio tope');
  assert.equal(m.red.topes.respuesta.length + m.red.topes.sinBytes.length + m.red.topes.documento.length, 0, 'y el documento, que ya bajó, no tiene ninguno de los suyos vivo');
  assert.equal(m.pos.versionRecargando, true);
  m.red.topes.hojas[0]();                                                      // vence el tope de los scripts…
  await esperando;
  assert.equal(m.red.recargas, 1, '…y recarga: el documento ya había bajado');
  assert.equal(m.pos.versionRecargaNota, '');
  assert.ok(m.red.fetch.filter((f) => f.url.endsWith('.js')).every((f) => f.signal.aborted), 'lo que no terminó se abandonó');
  assert.equal(m.red.fetch[0].url, `${ORIGEN}/pos.html?x=1`, 'y el documento se pidió primero, solo');
});

test('«Recargar»: si la red se cae mientras bajan los scripts y hojas (el documento ya había bajado), la mirada final a version.json lo ve y no recarga', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, scripts: ['assets/vendor/a.js'], navegador: { onLine: true } });
  m.pos._vigilarVersion();
  await asentar();
  m.red.fetch.length = 0;
  m.red.cuelga = (url) => (url.endsWith('.js') ? 'cuerpo' : undefined);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  m.red.falla = (url) => url.startsWith('version.json');                       // se cae la red mientras los scripts siguen bajando
  m.red.topes.hojas[0]();
  await esperando;
  assert.equal(m.red.recargas, 0, 'el documento bajó hace un rato: ya no prueba que haya red ahora');
  assert.match(m.pos.versionRecargaNota, NOTA_NO_BAJO);
  assert.equal(m.pos.versionRecargando, false);
  assert.equal(m.red.fetch.at(-1).url.startsWith('version.json'), true, 'lo último que hizo fue mirar la red, no recargar');
  m.red.falla = null; m.red.cuelga = null;                                     // vuelve la red
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 1);
});

test('los topes del documento son por INACTIVIDAD (10 s sin cabeceras, 15 s sin bytes) con 5 min de red de seguridad; los de los scripts, 20 s: pos.html lo dice', () => {
  const store = scriptDelStore();
  assert.match(store, /_topeRespuestaMs: 10000,/);
  assert.match(store, /_topeSinBytesMs: 15000,/);
  assert.match(store, /_topeDocumentoMs: 300000,/);
  assert.match(store, /_topeHojasMs: 20000,/);
});

test('«Recargar»: si el documento bajó pero un script o una hoja no, recarga igual (el documento es lo que no puede faltar); después de un fallo, el siguiente toque recarga', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, scripts: ['assets/vendor/a.js'], navegador: { onLine: true } });
  m.pos._vigilarVersion();
  await asentar();
  m.red.falla = (url) => url.endsWith('a.js');
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 1, 'el documento bajó: recarga');
  // Un fallo del documento y, después, la red vuelve: otro toque funciona (la franja no queda atascada).
  const n = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: true } });
  n.pos._vigilarVersion();
  await asentar();
  n.red.modo = 'sin-red';
  await n.pos.recargarVersionNueva();
  assert.equal(n.red.recargas, 0);
  n.red.modo = 'ok';
  await n.pos.recargarVersionNueva();
  assert.equal(n.red.recargas, 1);
  assert.equal(n.pos.versionRecargaNota, '', 'y la nota del intento anterior ya no está');
});

test('la franja dice por qué «Recargar» no recargó (en lugar del texto de siempre) y la nota se va sola a los 12 s', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: false } });
  m.pos._vigilarVersion();
  await asentar();
  assert.equal(m.pos.versionRecargaNota, '');
  await m.pos.recargarVersionNueva();
  assert.match(m.pos.versionRecargaNota, NOTA_SIN_RED);
  const pos = leer('pos.html');
  assert.match(pos, /<p class="aviso-version-txt" x-text="\$store\.pos\.versionTextoFranja">Hay una versión nueva del POS<\/p>/, 'la franja muestra la nota o, sin ella, «La versión nueva está lista» o «Hay una versión nueva del POS»');
  m.pos.versionRecargaNota = '';
  assert.equal(m.pos.versionTextoFranja, 'Hay una versión nueva del POS');
  assert.match(scriptDelStore(), /_notaDeRecargaT = setTimeout\(\(\) => \{ this\.versionRecargaNota = ''; \}, 12000\)/, 'la nota se borra a los 12 s');
});

test('«Recargar» espera a un «+1» (delta de ítems) que todavía va en camino: no está en la cola ni en el almacenamiento y la recarga lo perdía', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: true } });
  m.pos._vigilarVersion();
  await asentar();
  let llegar;
  m.pos._registrarEnVuelo('o1', new Promise((r) => { llegar = r; }));          // aplicar_delta_orden sin respuesta todavía
  assert.equal(m.pos._hayCambiosSinGuardar(), true);
  m.red.fetch.length = 0; m.red.orden.length = 0;
  const esperando = m.pos.recargarVersionNueva();
  await dormir(120);
  assert.equal(m.red.recargas, 0, 'mientras el delta va en camino, no recarga');
  assert.equal(m.pos.versionRecargando, true, 'el botón sigue en «Recargando…»');
  assert.equal(m.red.fetch.length, 0, 'y no pide nada todavía: PRIMERO espera lo que está en vuelo y DESPUÉS mira la red (si la red se cae mientras espera, no queda un documento «bajado» que ya no vale)');
  llegar();                                                                   // la base contestó
  await esperando;
  assert.equal(m.red.recargas, 1, 'y recarga cuando ya llegó');
  assert.match(m.red.orden[0], /^fetch .*\/pos\.html\?x=1 \[reload\]$/, 'recién entonces pide el documento');
  assert.equal(m.red.orden.at(-1), 'reload', 'y recarga a continuación');
});

test('«Recargar»: si la red se cae mientras espera lo que estaba en vuelo (el delta falla, queda en la cola y la espera termina «bien»), NO recarga: sin documento bajado después de la espera no hay recarga', async () => {
  // Antes el documento se bajaba ANTES de esperar: al salir de la espera ya nadie volvía a mirar la red, y la recarga sin internet dejaba al POS en la página de error.
  const m = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: true }, responder: async (c) => {
    if (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden') return new Promise((r) => { m.cortar = () => r({ data: null, error: { message: 'TypeError: Failed to fetch' } }); });
    return undefined;
  } });
  m.pos._vigilarVersion();
  await asentar();
  m.pos.remoto = 'ok';
  const linea = { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 2, nota: '' };
  m.pos.ordenes = [{ id: 'o1', mesaId: 3, estado: 'abierta', items: [linea], total: 26000, version: 1 }];
  m.pos.mesaActiva = { id: 3 }; m.pos.ordenActiva = m.pos.ordenes[0];
  m.pos._enviarDelta(m.pos.ordenes[0], linea, 1);                              // el «+1» sale y no contesta
  await asentar();
  assert.equal(m.pos._hayDeltasEnVuelo('o1'), true);
  const esperando = m.pos.recargarVersionNueva();
  await dormir(60);
  assert.equal(m.pos.versionRecargando, true, 'espera al delta');
  m.red.modo = 'sin-red';                                                      // se cae la red (navigator.onLine sigue en true: wifi sin salida)…
  m.cortar();                                                                  // …y la subida en vuelo falla
  await esperando;
  assert.equal(m.pos.colaDeltas.length, 1, 'el «+1» quedó en la cola de reintentos');
  assert.equal(m.pos._hayCambiosSinGuardar(), false, 'así que la espera terminó «bien»');
  assert.equal(m.red.recargas, 0, 'pero no se recargó: la descarga que viene DESPUÉS de la espera falló');
  assert.match(m.pos.versionRecargaNota, NOTA_NO_BAJO);
  assert.equal(m.pos.versionRecargando, false);
  // Y si lo que se cae es el aparato (navigator.onLine false) durante la espera, tampoco: ni siquiera intenta bajar nada.
  const n = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: true } });
  n.pos._vigilarVersion();
  await asentar();
  let llegar;
  n.pos._registrarEnVuelo('o1', new Promise((r) => { llegar = r; }));
  n.red.fetch.length = 0;
  const otra = n.pos.recargarVersionNueva();
  await dormir(40);
  n.caja.navigator.onLine = false;
  llegar();
  await otra;
  assert.equal(n.red.recargas, 0);
  assert.equal(n.red.fetch.length, 0, 'sin red no pide nada');
  assert.match(n.pos.versionRecargaNota, NOTA_SIN_RED);
});

test('«Recargar»: si la cuenta se movió mientras bajaba el documento (con una red lenta son segundos), espera de nuevo y baja otra vez antes de recargar', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: true } });
  m.pos._vigilarVersion();
  await asentar();
  m.pos._esperaRecargaMs = 5;
  m.red.fetch.length = 0; m.red.orden.length = 0;
  let llegar;
  m.red.alPedir = (url) => {                                                   // al pedir el documento por primera vez, la persona toca «+1»
    if (url.includes('pos.html') && !llegar) m.pos._registrarEnVuelo('o1', new Promise((r) => { llegar = r; }));
  };
  const esperando = m.pos.recargarVersionNueva();
  await dormir(80);
  assert.equal(m.red.recargas, 0, 'no recarga con un «+1» en vuelo aunque el documento ya bajó');
  assert.equal(m.pos.versionRecargando, true);
  llegar();
  await esperando;
  assert.equal(m.red.recargas, 1);
  assert.equal(m.pos._hayCambiosSinGuardar(), false, 'recargó sin nada sin guardar');
  const documentos = m.red.orden.filter((x) => x.includes('pos.html'));
  assert.equal(documentos.length, 2, 'el documento se bajó DESPUÉS de la última espera: la descarga de antes ya no prueba que haya red');
  assert.equal(m.red.orden.at(-2), documentos.at(-1), 'y la última descarga es lo último antes de recargar');
  assert.equal(m.red.orden.at(-1), 'reload');
});

test('«Recargar» con una cuenta que no deja de moverse: tras tres descargas no recarga y lo dice', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: true } });
  m.pos._vigilarVersion();
  await asentar();
  m.pos._esperaRecargaPasos = 4; m.pos._esperaRecargaMs = 5;
  m.red.alPedir = (url) => { if (url.includes('pos.html')) { m.pos._registrarEnVuelo('o1', new Promise((r) => setTimeout(r, 1))); } };   // cada descarga coincide con otro «+1»
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 0);
  assert.match(m.pos.versionRecargaNota, NOTA_SE_MUEVE);
  assert.equal(m.red.fetch.filter((f) => f.url.includes('pos.html')).length, 3, 'tres descargas del documento, no más');
  assert.equal(m.pos.versionRecargando, false);
});

test('«Recargar» con una subida que NO llega (red colgada): no recarga, dice «Todavía se está guardando lo último de la cuenta» y, cuando llega, el siguiente toque recarga', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: true } });
  m.pos._vigilarVersion();
  await asentar();
  m.pos._esperaRecargaPasos = 4; m.pos._esperaRecargaMs = 10;                 // 40 ms en vez de 5 s
  let llegar;
  m.pos._registrarEnVuelo('o1', new Promise((r) => { llegar = r; }));
  m.red.fetch.length = 0;
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 0);
  assert.match(m.pos.versionRecargaNota, NOTA_GUARDANDO);
  assert.equal(m.pos.versionRecargando, false, 'el botón queda libre');
  assert.equal(m.red.fetch.length, 0, 'y no gastó una descarga: lo pendiente se espera primero');
  llegar();
  await asentar();
  assert.equal(m.pos._hayCambiosSinGuardar(), false);
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 1);
});

test('«Recargar» con una marca «Para llevar» pendiente: la reintenta ya y, si la base la confirma, recarga; si no, no recarga y lo dice', async () => {
  const llamadas = [];
  let respuesta = { data: null, error: { message: 'TypeError: Failed to fetch' } };
  const m = montar({ pagina: VIEJA, publicada: NUEVA, navegador: { onLine: true }, responder: (c) => {
    if (c.tipo === 'rpc' && c.nombre === 'actualizar_nota_item') { llamadas.push(c.args); return respuesta; }
    // Un reintento relee la línea en la base antes de mandar la nota: la cuenta sigue abierta y la línea sin marcar.
    if (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'select') return { data: { id: 'o1', mesa_id: 3, estado: 'abierta', items: [{ id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 1, nota: '' }], version: 1 }, error: null };
    return undefined;
  } });
  m.pos._vigilarVersion();
  await asentar();
  m.pos._esperaRecargaPasos = 4; m.pos._esperaRecargaMs = 10;
  m.pos._esperaMarcasLlevar = () => 60000;                                     // el reintento de siempre tardaría un minuto
  m.pos.remoto = 'ok';
  m.pos.usuario = { id: 'u1', email: 'yo@ejemplo.test' };
  const linea = { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 1, nota: '' };
  m.pos.ordenes = [{ id: 'o1', mesaId: 3, estado: 'abierta', items: [linea], total: 13000, version: 1 }];
  m.pos.mesaActiva = { id: 3 }; m.pos.ordenActiva = m.pos.ordenes[0];
  m.pos.alternarLlevar(linea);                                                 // la subida falla por la red: queda pendiente
  await asentar();
  assert.equal(llamadas.length, 1);
  assert.equal(m.pos._hayCambiosSinGuardar(), true, 'la marca solo vive en memoria');
  await m.pos.recargarVersionNueva();
  assert.equal(llamadas.length >= 2, true, 'Recargar la reintentó sin esperar al reloj');
  assert.equal(m.red.recargas, 0, 'sigue sin llegar: no recarga');
  assert.match(m.pos.versionRecargaNota, NOTA_GUARDANDO);
  respuesta = { data: { id: 'o1', version: 2 }, error: null };                  // vuelve la red
  await m.pos.recargarVersionNueva();
  assert.equal(m.pos._hayCambiosSinGuardar(), false, 'la base la confirmó');
  assert.equal(m.red.recargas, 1, 'y recarga');
});

test('«Recargar» no se dispara dos veces con dos toques seguidos', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  m.pos._vigilarVersion();
  await asentar();
  const a = m.pos.recargarVersionNueva();
  const b = m.pos.recargarVersionNueva();
  await Promise.all([a, b]);
  assert.equal(m.red.recargas, 1);
  assert.equal(m.pos.versionRecargando, true);
});

test('NUNCA recarga solo: ni al haber una versión nueva, ni en las búsquedas siguientes, ni con «Después», ni tras un error', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  m.pos._vigilarVersion();
  await asentar();
  for (let i = 0; i < 5; i++) {
    m.reloj.t += 6 * 60 * 1000;
    m.red.intervalos.find((x) => x.ms === 300000).fn();
    m.dispararVentana('online'); m.dispararDocumento('visibilitychange');
    await asentar();
  }
  m.pos.despuesVersionNueva();
  m.red.modo = 'sin-red';
  m.reloj.t += 6 * 60 * 1000;
  m.red.intervalos.find((x) => x.ms === 300000).fn();
  await asentar();
  await m.pos.buscarVersionAhora();
  assert.equal(m.red.recargas, 0);
  assert.ok(m.red.fetch.every((f) => f.cache !== 'reload'), 'tampoco refresca la caché por su cuenta');
});

test('tras recargar, si la página sigue vieja (un CDN atrasado), el aviso vuelve a salir y no hay bucle de recargas', async () => {
  const almacen = new Map();
  const antes = montar({ pagina: VIEJA, publicada: NUEVA, almacen });
  antes.pos._vigilarVersion();
  await asentar();
  await antes.pos.recargarVersionNueva();
  assert.equal(antes.red.recargas, 1);
  // «La página recargada»: un store nuevo con el mismo almacenamiento y, por el CDN atrasado, el mismo <meta> viejo.
  const despues = montar({ pagina: VIEJA, publicada: NUEVA, almacen });
  despues.pos._vigilarVersion();
  await asentar();
  assert.equal(despues.pos.avisoVersionVisible, true, 'el aviso vuelve a salir');
  assert.equal(despues.red.recargas, 0, 'y esta vez nadie recargó: hace falta otro toque');
  await asentar(30);
  assert.equal(despues.red.recargas, 0);
});

// ───────────────────────── «Recargar» con una red lenta: cancelar, lo que la persona empezó y los topes por inactividad ─────────────────────────
// (re-refutación, ronda 3, de 152e5d7). Con una red lenta preparar la recarga tarda decenas de segundos y el POS no se bloquea mientras tanto: la
// recarga llegaba sola encima de lo que la persona empezó en ese rato, sin poder cancelarse; y el tope fijo de 30 s del documento cortaba una descarga
// que seguía avanzando. Ahora: «Cancelar»; al terminar de bajar recarga solo si la persona no hizo nada; si hizo algo, «La versión nueva está lista» con
// «Recargar ahora»; y el documento se corta por INACTIVIDAD (ni cabeceras, ni bytes), no por reloj total.

const NOTA_DETENIDA = /La descarga de la versión nueva se detuvo: la conexión dejó de dar datos/;
const NOTA_LISTA = 'La versión nueva está lista';
const NOTA_SIEMPRE = 'Hay una versión nueva del POS';
const EVENTOS_DE_LA_PERSONA = ['pointerdown', 'touchstart', 'mousedown', 'click', 'keydown', 'input'];
/** Lo que oyen los oyentes de actividad: `enLaFranja` es un toque sobre la propia franja («Recargar», «Cancelar»). */
const evento = (enLaFranja) => ({ target: { closest: (sel) => (enLaFranja && sel === '.aviso-version' ? {} : null) } });
const tocar = (m, nombre = 'pointerdown', enLaFranja = false) => (m.oyentes.documento[nombre] || []).forEach((f) => f(evento(enLaFranja)));
const escuchas = (m) => EVENTOS_DE_LA_PERSONA.reduce((n, e) => n + (m.oyentes.documento[e] || []).length, 0);
const topesVivos = (m) => Object.values(m.red.topes).reduce((n, l) => n + l.length, 0);
const esElDocumento = (url) => url.includes('pos.html');
const pedidosDelDocumento = (m) => m.red.fetch.filter((f) => esElDocumento(f.url));

/** Un POS con una versión nueva publicada y un script del mismo origen, listo para tocar «Recargar». */
async function conVersionNueva(opciones = {}) {
  const m = montar({ pagina: VIEJA, publicada: NUEVA, scripts: ['assets/vendor/a.js'], navegador: { onLine: true }, ...opciones });
  m.pos._vigilarVersion();
  await asentar();
  m.red.fetch.length = 0; m.red.orden.length = 0;
  return m;
}
/** El documento contesta y da los trozos que la prueba mande (`m.red.goteo.at(-1).trozo()` / `.fin()`). */
const documentoAGoteo = (m) => { m.red.cuelga = (url) => (esElDocumento(url) ? 'goteo' : undefined); };
const darTrozo = async (m) => { m.red.goteo.at(-1).trozo(); await asentar(); };

test('«Cancelar» mientras baja la versión nueva: aborta la descarga, no recarga, no pide nada más, suelta lo que vigilaba y deja la franja como antes', async () => {
  const m = await conVersionNueva();
  const base = escuchas(m);
  documentoAGoteo(m);
  m.pos._notaBajandoMs = 5;
  assert.equal(m.pos.versionPuedeCancelar, false, 'sin tocar «Recargar» no hay nada que cancelar');
  const esperando = m.pos.recargarVersionNueva();
  await dormir(30);
  assert.equal(m.pos.versionRecargando, true);
  assert.equal(m.pos.versionRecargaNota, 'Descargando la versión nueva…', 'la franja dice qué pasa');
  assert.equal(m.pos.versionTextoFranja, 'Descargando la versión nueva…');
  assert.equal(m.pos.versionPuedeCancelar, true, 'y ofrece «Cancelar»');
  assert.equal(m.pos.versionBotonRecargar, 'Recargando…');
  assert.ok(escuchas(m) > base, 'mientras tanto vigila lo que la persona toque');
  await darTrozo(m);
  m.pos.cancelarRecarga();
  await esperando;
  assert.equal(m.red.recargas, 0, 'cancelar no recarga');
  assert.equal(m.pos.versionRecargando, false, 'el botón queda libre');
  assert.equal(m.pos.versionRecargaNota, '', 'sin nota: la franja como antes');
  assert.equal(m.pos.versionTextoFranja, NOTA_SIEMPRE);
  assert.equal(m.pos.versionBotonRecargar, 'Recargar');
  assert.equal(m.pos.versionPuedeCancelar, false);
  assert.equal(m.pos.versionLista, '', 'y no queda nada «listo»: no se terminó de bajar');
  assert.equal(m.pos.avisoVersionVisible, true, 'el aviso sigue ahí');
  assert.ok(pedidosDelDocumento(m).every((f) => f.signal.aborted), 'la descarga en curso se abortó de verdad');
  await asentar(30);
  assert.equal(m.red.fetch.length, 1, 'y no pidió nada más: ni los scripts de una versión que no terminó de bajar, ni la mirada a version.json');
  assert.equal(topesVivos(m), 0, 'ni queda un temporizador vivo');
  assert.equal(escuchas(m), base, 'y soltó los oyentes de actividad');
  // «Después» vuelve a ser la salida de siempre, y con la red buena el siguiente toque recarga.
  m.red.cuelga = null;
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 1, 'la preparación cancelada no deja nada atascado');
});

test('«Cancelar» mientras espera una subida en vuelo (antes de pedir nada), o mientras baja los scripts: tampoco recarga ni sigue pidiendo', async () => {
  // 1. Esperando un «+1» que no termina de llegar: el documento aún no se pidió.
  const a = await conVersionNueva();
  let llegar;
  a.pos._registrarEnVuelo('o1', new Promise((r) => { llegar = r; }));
  const esperandoA = a.pos.recargarVersionNueva();
  await dormir(30);
  assert.equal(a.pos.versionPuedeCancelar, true, '«Cancelar» ya está desde que se toca «Recargar», no solo al bajar');
  assert.equal(a.red.fetch.length, 0);
  a.pos.cancelarRecarga();
  await esperandoA;
  llegar();                                                                   // el «+1» llega después de cancelar
  await asentar(30);
  assert.equal(a.red.recargas, 0);
  assert.equal(a.red.fetch.length, 0, 'cancelado, no pide el documento cuando la espera termina');
  assert.equal(a.pos.versionRecargando, false);
  // 2. El documento ya bajó y los scripts siguen bajando (de mejor esfuerzo).
  const b = await conVersionNueva();
  b.red.cuelga = (url) => (url.endsWith('.js') ? 'cuerpo' : undefined);
  const esperandoB = b.pos.recargarVersionNueva();
  await asentar();
  assert.equal(b.red.topes.hojas.length, 1, 'baja los scripts');
  b.pos.cancelarRecarga();
  await esperandoB;
  assert.equal(b.red.recargas, 0);
  assert.ok(b.red.fetch.filter((f) => f.url.endsWith('.js')).every((f) => f.signal.aborted), 'y los scripts se abortaron');
  await asentar(30);
  assert.equal(b.red.fetch.some((f) => f.url.startsWith('version.json')), false, 'sin la mirada final a version.json: no hay nada que recargar');
  assert.equal(b.pos.versionLista, '', 'no queda «listo»: se canceló antes de terminar');
  assert.equal(topesVivos(b), 0);
});

test('«Cancelar» no hace nada si no hay nada que cancelar ni una vez pedida la recarga; y si la página no navega, el seguro libera el botón', async () => {
  const m = await conVersionNueva();
  m.pos.cancelarRecarga();                                                    // sin «Recargar» en curso
  assert.equal(m.pos.versionRecargando, false);
  assert.deepEqual(m.consola, []);
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 1);
  assert.equal(m.pos.versionPuedeCancelar, false, 'pedida la recarga, ya no hay nada que cancelar (vuelve «Después», deshabilitado)');
  m.pos.cancelarRecarga();
  assert.equal(m.pos.versionRecargando, true, 'cancelar ya no puede deshacer una recarga pedida');
  assert.equal(m.red.topes.seguro.length, 1, 'si la página no navega, un seguro libera el botón');
  m.red.topes.seguro[0]();
  assert.equal(m.pos.versionRecargando, false);
});

test('con la red buena, o sin tocar nada mientras baja, «Recargar» recarga en el acto al terminar de bajar; un toque antes del suyo no cuenta', async () => {
  const m = await conVersionNueva();
  tocar(m, 'pointerdown');                                                    // un toque ANTES de «Recargar»: no es «algo desde el toque»
  const base = escuchas(m);
  documentoAGoteo(m);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  for (let i = 0; i < 5; i++) await darTrozo(m);
  assert.equal(m.red.recargas, 0, 'mientras baja no recarga');
  assert.equal(m.pos.versionRecargando, true);
  m.red.goteo.at(-1).fin();
  await esperando;
  assert.equal(m.red.recargas, 1, 'al terminar de bajar, sin que la persona haya hecho nada: recarga');
  assert.equal(m.pos.versionLista, '', 'no queda «lista»: ya se recargó');
  assert.equal(m.red.orden.at(-1), 'reload');
  assert.equal(m.red.orden.filter((x) => x.includes('version.json')).length, 1, 'con una mirada final a la red antes de recargar, como siempre');
  assert.equal(escuchas(m), base, 'y los oyentes de actividad ya están sueltos');
});

test('un toque sobre la propia franja («Recargar», «Cancelar») no cuenta como «la persona hizo algo»', async () => {
  const m = await conVersionNueva();
  documentoAGoteo(m);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  tocar(m, 'pointerdown', true); tocar(m, 'touchstart', true); tocar(m, 'click', true); tocar(m, 'keydown', true);
  m.red.goteo.at(-1).fin();
  await esperando;
  assert.equal(m.red.recargas, 1, 'tocar la franja no es empezar algo en el POS');
});

for (const [que, hacer] of [
  ['un toque en el POS', (m) => tocar(m, 'pointerdown')],
  ['un toque de pantalla táctil', (m) => tocar(m, 'touchstart')],
  ['un clic del ratón', (m) => tocar(m, 'mousedown')],
  ['un clic sin toque (un lector de pantalla)', (m) => tocar(m, 'click')],
  ['una tecla', (m) => tocar(m, 'keydown')],
  ['texto escrito o dictado', (m) => tocar(m, 'input')],
  ['un diálogo abierto (el «Ítem manual»)', (m) => { m.pos.modalItemManual = true; }],
  ['la pregunta de imprimir en la caja (confirmaImpresion)', (m) => { m.pos.confirmaImpresion = { que: 'precuenta', persona: null, destino: 'caja', titulo: 'Imprimir la precuenta', pregunta: '¿Imprimir la precuenta en la caja?', resumen: 'Mesa 3', boton: 'Imprimir en la caja' }; }],
  ['la hoja de la pegatina NFC', (m) => { m.pos.nfcEstado = { id: 3, fase: 'esperando', mensaje: '', accion: 'escribir' }; }],
  ['otra vista', (m) => { m.pos.vista = 'orden'; }],
]) {
  test(`si la persona hizo algo mientras bajaba (${que}), al terminar NO recarga: «La versión nueva está lista» con «Recargar ahora», y ese toque sí recarga`, async () => {
    const m = await conVersionNueva();
    const base = escuchas(m);
    documentoAGoteo(m);
    const esperando = m.pos.recargarVersionNueva();
    await asentar();
    await darTrozo(m);
    hacer(m);                                                                  // la persona sigue trabajando: el POS no se bloquea
    await darTrozo(m);
    m.red.goteo.at(-1).fin();
    await esperando;
    assert.equal(m.red.recargas, 0, 'NUNCA recarga sola encima de lo que la persona empezó');
    assert.equal(m.pos.versionRecargando, false, 'el botón queda libre');
    assert.equal(m.pos.versionLista, NUEVA);
    assert.equal(m.pos.versionListaParaRecargar, true);
    assert.equal(m.pos.versionTextoFranja, NOTA_LISTA);
    assert.equal(m.pos.versionBotonRecargar, 'Recargar ahora');
    assert.equal(m.pos.versionPuedeCancelar, false, 'ya no prepara nada: vuelve «Después»');
    assert.equal(m.pos.avisoVersionVisible, true);
    assert.equal(m.pos.versionRecargaNota, '');
    assert.equal(escuchas(m), base, 'los oyentes de actividad se soltaron');
    assert.equal(pedidosDelDocumento(m).length, 1, 'el documento se bajó una sola vez');
    assert.ok(m.red.fetch.some((f) => f.url.endsWith('a.js')), 'junto con los scripts: la caché quedó caliente');
    await asentar(30);
    assert.equal(m.red.recargas, 0, 'y sigue esperando el toque de la persona');
    // «Recargar ahora»: la caché ya está caliente, no baja nada, solo mira la red antes de recargar.
    m.red.fetch.length = 0; m.red.orden.length = 0;
    await m.pos.recargarVersionNueva();
    assert.equal(m.red.recargas, 1, '«Recargar ahora» recarga');
    assert.deepEqual(m.red.fetch.map((f) => f.url.replace(/\d+$/, 'T')), ['version.json?t=T'], 'sin descargar nada otra vez: solo la mirada a la red');
    assert.equal(m.red.orden.at(-1), 'reload');
  });
}

test('con algo empezado y una subida en vuelo al terminar de bajar: no espera ni vuelve a bajar (no va a recargar sola); «Recargar ahora» sí espera lo pendiente y mira la red', async () => {
  const m = await conVersionNueva();
  m.pos._esperaRecargaPasos = 20; m.pos._esperaRecargaMs = 5;
  documentoAGoteo(m);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  tocar(m, 'pointerdown');                                                    // la persona hace algo…
  let llegar;
  m.pos._registrarEnVuelo('o1', new Promise((r) => { llegar = r; }));         // …y su «+1» sigue en camino cuando termina la descarga
  m.red.goteo.at(-1).fin();
  await esperando;
  assert.equal(pedidosDelDocumento(m).length, 1, 'no volvió a bajar el documento');
  assert.equal(m.pos.versionLista, NUEVA, 'ya está lista');
  assert.equal(m.red.recargas, 0);
  assert.equal(m.pos._hayCambiosSinGuardar(), true, 'y la subida sigue en camino: no se esperó');
  // «Recargar ahora» espera la subida (como cualquier recarga) y recién entonces mira la red.
  m.red.fetch.length = 0;
  const ahora = m.pos.recargarVersionNueva();
  await dormir(40);
  assert.equal(m.red.recargas, 0, 'con la subida en vuelo no recarga');
  assert.equal(m.red.fetch.length, 0, 'ni mira la red todavía: primero espera lo pendiente');
  assert.equal(m.pos.versionPuedeCancelar, true, 'y mientras espera, «Cancelar»');
  llegar();
  await ahora;
  assert.equal(m.red.recargas, 1);
  assert.equal(m.red.fetch.length, 1, 'una sola mirada a la red');
  assert.match(m.red.fetch[0].url, /^version\.json\?t=\d+$/);
});

test('«Recargar ahora» sin red: no recarga, lo dice con sus palabras y la versión sigue «lista»; con red, recarga', async () => {
  for (const [como, cortar] of [
    ['el aparato pierde la red', (m) => { m.caja.navigator.onLine = false; }],
    ['wifi sin salida', (m) => { m.red.falla = (url) => url.startsWith('version.json'); }],
  ]) {
    const m = await conVersionNueva();
    documentoAGoteo(m);
    const esperando = m.pos.recargarVersionNueva();
    await asentar();
    tocar(m, 'keydown');
    m.red.goteo.at(-1).fin();
    await esperando;
    assert.equal(m.pos.versionListaParaRecargar, true, como);
    cortar(m);
    await m.pos.recargarVersionNueva();
    assert.equal(m.red.recargas, 0, `${como}: no recarga`);
    assert.match(m.pos.versionRecargaNota, /«Recargar ahora»/, `${como}: la franja dice qué hacer, con el nombre del botón de ahora`);
    assert.doesNotMatch(m.pos.versionRecargaNota, /«Recargar»[^ ]/, como);
    assert.equal(m.pos.versionRecargando, false, `${como}: el botón queda libre`);
    assert.equal(m.pos.versionListaParaRecargar, true, `${como}: sigue «lista»`);
    // Vuelve la red y el nota se va sola: el mismo botón recarga.
    m.caja.navigator.onLine = true; m.red.falla = null;
    await m.pos.recargarVersionNueva();
    assert.equal(m.red.recargas, 1, `${como}: con red, «Recargar ahora» recarga`);
  }
});

test('«Después» esconde la franja «lista» y la versión del pie la devuelve; si sale OTRA versión, deja de valer y vuelve el aviso de siempre con un «Recargar» que baja de nuevo', async () => {
  const m = await conVersionNueva();
  documentoAGoteo(m);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  tocar(m, 'pointerdown');
  m.red.goteo.at(-1).fin();
  await esperando;
  m.pos.despuesVersionNueva();
  assert.equal(m.pos.avisoVersionVisible, false);
  assert.equal(m.pos.versionListaParaRecargar, true, '«Después» no deshace que ya bajó');
  await m.pos.buscarVersionAhora();
  assert.equal(m.pos.avisoVersionVisible, true);
  assert.equal(m.pos.versionTextoFranja, NOTA_LISTA, 'al volver sigue diciendo que está lista');
  // Sale otra versión: lo que bajó ya no es lo publicado.
  m.red.version = OTRA;
  await m.pos.buscarVersionAhora();
  assert.equal(m.pos.versionPublicada, OTRA);
  assert.equal(m.pos.versionListaParaRecargar, false);
  assert.equal(m.pos.versionTextoFranja, NOTA_SIEMPRE);
  assert.equal(m.pos.versionBotonRecargar, 'Recargar');
  m.red.cuelga = null; m.red.fetch.length = 0;
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 1);
  assert.equal(pedidosDelDocumento(m).length, 1, 'y baja la versión nueva otra vez: no se fía de la que quedó en la caché');
});

test('si mientras baja sale OTRA versión, lo que bajó no se da por «listo» para la nueva', async () => {
  const m = await conVersionNueva();
  documentoAGoteo(m);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  tocar(m, 'pointerdown');
  m.red.version = OTRA;                                                       // se publicó otra mientras bajaba la anterior
  m.red.goteo.at(-1).fin();
  await esperando;
  assert.equal(m.pos.versionPublicada, OTRA, 'la mirada final la vio');
  assert.equal(m.pos.versionLista, NUEVA, 'lo que bajó era la anterior');
  assert.equal(m.pos.versionListaParaRecargar, false, 'así que no vale para la que está publicada');
  assert.equal(m.pos.versionTextoFranja, NOTA_SIEMPRE);
  assert.equal(m.red.recargas, 0);
});

test('una descarga MUY lenta pero continua no se corta por tiempo: cada trozo reinicia la vigilancia, el único tope por reloj es la red de seguridad, y al terminar recarga', async () => {
  const m = await conVersionNueva();
  documentoAGoteo(m);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  assert.equal(m.red.topes.respuesta.length, 0, 'las cabeceras ya llegaron');
  assert.equal(m.red.topes.sinBytes.length, 1, 'vigila que lleguen bytes (15 s sin uno)');
  assert.equal(m.red.topes.documento.length, 1, 'y el único tope por reloj es el de 5 min, de seguridad');
  assert.equal(m.red.topes.seguro.length, 0, 'no hay un tope fijo de 30 s desde el pedido');
  let anterior = m.red.topes.sinBytes[0];
  for (let i = 0; i < 80; i++) {                                              // 80 trozos: con la red de los meseros, minutos
    await darTrozo(m);
    assert.equal(m.red.topes.sinBytes.length, 1, `trozo ${i}: sigue habiendo una sola vigilancia`);
    assert.notEqual(m.red.topes.sinBytes[0], anterior, `trozo ${i}: el plazo se reinició (el anterior se canceló)`);
    anterior = m.red.topes.sinBytes[0];
  }
  assert.equal(m.red.recargas, 0);
  assert.equal(m.pos.versionRecargando, true);
  assert.equal(pedidosDelDocumento(m).every((f) => !f.signal.aborted), true, 'nadie abortó la descarga: sigue avanzando');
  m.red.goteo.at(-1).fin();
  await esperando;
  assert.equal(m.red.recargas, 1, 'terminó de bajar y recarga con un solo toque');
  assert.equal(m.pos.versionRecargaNota, '');
});

test('una descarga que sigue dando bytes más de 5 minutos se corta como «muy lenta» (la red de seguridad), no como «sin internet» ni como «se detuvo»', async () => {
  const m = await conVersionNueva();
  documentoAGoteo(m);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  await darTrozo(m);
  m.red.topes.documento[0]();                                                 // pasaron 5 min
  await esperando;
  assert.equal(m.red.recargas, 0);
  assert.match(m.pos.versionRecargaNota, NOTA_LENTA);
  assert.doesNotMatch(m.pos.versionRecargaNota, /sin internet|se detuvo/);
  assert.equal(m.pos.versionRecargando, false);
  assert.ok(pedidosDelDocumento(m).every((f) => f.signal.aborted));
  assert.equal(m.red.fetch.filter((f) => f.cache === 'reload').length, 1, 'y no pidió los scripts de una versión que no bajó');
  assert.equal(topesVivos(m), 0);
});

test('una descarga que se queda sin bytes (después de dar algunos, o sin dar ni uno) se corta como «se detuvo»: ni «sin internet» ni «muy lenta»; no recarga y el siguiente toque, con red, sí', async () => {
  for (const [como, antes] of [
    ['dio algunos trozos y se quedó callada', async (m) => { await darTrozo(m); await darTrozo(m); }],
    ['contestó y no dio ni un byte', async () => {}],
  ]) {
    const m = await conVersionNueva();
    m.red.cuelga = (url) => (esElDocumento(url) ? (como.startsWith('dio') ? 'goteo' : 'cuerpo') : undefined);
    const esperando = m.pos.recargarVersionNueva();
    await asentar();
    await antes(m);
    assert.equal(m.red.topes.sinBytes.length, 1, `${como}: hay una vigilancia de «sin bytes»`);
    assert.equal(m.red.recargas, 0);
    assert.equal(m.pos.versionRecargando, true, `${como}: todavía espera: no pasaron 15 s sin bytes`);
    m.red.topes.sinBytes[0]();                                                // pasaron 15 s sin un byte
    await esperando;
    assert.equal(m.red.recargas, 0, `${como}: no recarga`);
    assert.match(m.pos.versionRecargaNota, NOTA_DETENIDA, como);
    assert.doesNotMatch(m.pos.versionRecargaNota, /sin internet|muy lenta/, `${como}: el texto es el de una descarga que se detuvo`);
    assert.equal(m.pos.versionRecargando, false, `${como}: el botón queda libre`);
    assert.ok(pedidosDelDocumento(m).every((f) => f.signal.aborted), `${como}: lo que seguía colgado se abortó`);
    assert.equal(m.red.fetch.filter((f) => f.cache === 'reload').length, 1, `${como}: y no pidió los scripts`);
    assert.equal(topesVivos(m), 0, como);
    m.red.cuelga = null;
    await m.pos.recargarVersionNueva();
    assert.equal(m.red.recargas, 1, `${como}: con red, el siguiente toque recarga`);
  }
});

test('el tope de «sin bytes» no corre antes de que lleguen las cabeceras (ahí el tope es el de «ni las cabeceras», que dice «¿sin internet?»)', async () => {
  const m = await conVersionNueva();
  m.red.cuelga = (url) => (esElDocumento(url) ? 'respuesta' : undefined);
  const esperando = m.pos.recargarVersionNueva();
  await asentar();
  assert.equal(m.red.topes.respuesta.length, 1);
  assert.equal(m.red.topes.sinBytes.length, 0);
  m.red.topes.respuesta[0]();
  await esperando;
  assert.match(m.pos.versionRecargaNota, NOTA_NO_BAJO);
  assert.equal(m.red.recargas, 0);
});

test('«Descargando la versión nueva…» se queda mientras baja (no se borra a los 12 s de un intento anterior) y se va al terminar; un nuevo toque borra la nota del anterior', async () => {
  const m = await conVersionNueva();
  m.pos._notaBajandoMs = 5;
  m.red.modo = 'sin-red';
  await m.pos.recargarVersionNueva();
  assert.match(m.pos.versionRecargaNota, NOTA_NO_BAJO, 'el intento anterior dejó su nota (con su reloj de 12 s)');
  m.red.modo = 'ok';
  documentoAGoteo(m);
  const esperando = m.pos.recargarVersionNueva();
  assert.equal(m.pos.versionRecargaNota, '', 'al tocar de nuevo, la nota anterior se va y su reloj de 12 s con ella');
  await dormir(30);
  assert.equal(m.pos.versionRecargaNota, 'Descargando la versión nueva…');
  m.red.goteo.at(-1).fin();
  await esperando;
  assert.equal(m.pos.versionRecargaNota, '');
  assert.equal(m.red.recargas, 1);
});

test('el aviso mira todos los diálogos de pos.html: cada «modal-backdrop» tiene su bandera en _hayModalAbierto', () => {
  const pos = leer('pos.html');
  const banderas = [...pos.matchAll(/x-show="\$store\.pos\.([\w.?]+)"[^>]*class="modal-backdrop/g)].map((x) => x[1]);
  assert.ok(banderas.length >= 12, `encontré los diálogos de pos.html (${banderas.length})`);
  const fn = scriptDelStore().match(/_hayModalAbierto\(\) \{([\s\S]*?)\n            \},/);
  assert.ok(fn, 'existe _hayModalAbierto');
  for (const b of banderas) assert.ok(fn[1].includes(`this.${b}`), `_hayModalAbierto no mira «${b}»: un diálogo nuevo se perdería al recargar sin avisar`);
});

test('la franja: «Cancelar» solo mientras prepara (en lugar de «Después»), el texto y el botón salen del store, y «Después» deja de estar deshabilitado sin salida', () => {
  const pos = leer('pos.html');
  const franja = pos.slice(pos.indexOf('<div x-data class="aviso-version'), pos.indexOf('<!-- ▲ PARTE version-nueva :: aviso -->'));
  assert.match(franja, /<button type="button" class="btn-enlace" x-show="\$store\.pos\.versionPuedeCancelar" x-cloak\s+@click="\$store\.pos\.cancelarRecarga\(\)">Cancelar<\/button>/);
  assert.match(franja, /x-show="!\$store\.pos\.versionPuedeCancelar"\s+:disabled="\$store\.pos\.versionRecargando"\s+@click="\$store\.pos\.despuesVersionNueva\(\)">Después<\/button>/);
  assert.match(franja, /x-text="\$store\.pos\.versionBotonRecargar">Recargar<\/span>/);
});

// ───────────────────────── el toque en la versión del pie ─────────────────────────

test('tocar la versión del pie: «Buscando…», luego «Estás en la última versión», y se apaga solo', async () => {
  const m = montar({ pagina: VIEJA, publicada: VIEJA });
  m.pos._vigilarVersion();
  await asentar();
  assert.equal(m.pos.versionPieEstado, 'normal');
  m.reloj.t += 1000;     // incluso dentro de los 15 s de la última búsqueda: tocar es pedir ya
  const toque = m.pos.buscarVersionAhora();
  assert.equal(m.pos.versionBuscando, true);
  assert.equal(m.pos.versionPieEstado, 'buscando');
  await toque;
  assert.equal(pedidosDeVersion(m).length, 2, 'preguntó en el momento');
  assert.equal(m.pos.versionPieEstado, 'al-dia');
  assert.equal(m.pos.avisoVersionVisible, false);
  assert.equal(m.red.aviso.length, 1, 'se programó apagarlo a los 4 s');
  m.red.aviso[0]();
  assert.equal(m.pos.versionPieEstado, 'normal', 'a los 4 s vuelve a la versión');
});

test('tocar la versión del pie con una versión nueva: sale el aviso, aunque estuviera escondido con «Después»', async () => {
  const m = montar({ pagina: VIEJA, publicada: NUEVA });
  m.pos._vigilarVersion();
  await asentar();
  m.pos.despuesVersionNueva();
  assert.equal(m.pos.avisoVersionVisible, false);
  await m.pos.buscarVersionAhora();
  assert.equal(m.pos.avisoVersionVisible, true, 'la persona pidió mirar: el aviso sale');
  assert.equal(m.pos.versionPieEstado, 'nueva');
  assert.equal(m.red.recargas, 0, 'y no recarga: eso es del botón «Recargar»');
});

test('tocar la versión del pie sin red lo dice («sin-red»); a la búsqueda automática, en cambio, nadie le dice nada', async () => {
  const m = montar({ pagina: VIEJA, publicada: VIEJA });
  m.pos._vigilarVersion();
  await asentar();
  m.red.modo = 'sin-red';
  await m.pos.buscarVersionAhora();
  assert.equal(m.pos.versionPieEstado, 'sin-red');
  assert.deepEqual(m.consola, []);
});

test('un segundo toque mientras busca no lanza otra búsqueda', async () => {
  const m = montar({ pagina: VIEJA, publicada: VIEJA });
  m.pos._vigilarVersion();
  await asentar();
  const a = m.pos.buscarVersionAhora();
  const b = m.pos.buscarVersionAhora();
  await Promise.all([a, b]);
  assert.equal(pedidosDeVersion(m).length, 2, 'la de arranque y una sola del toque');
});

// ───────────────────────── nada se pierde ─────────────────────────

test('recargar no toca el almacenamiento: la sesión, la caché y la cola de reintentos siguen donde estaban', async () => {
  const almacen = new Map([
    ['sb-prueba-auth-token', '{"access_token":"x"}'],
    ['pos_delta_queue', JSON.stringify([{ id: 'd1', orden_id: 'o1', item_id: 'a', nombre: 'a', precio: 1000, nota: '', delta: 1 }])],
    ['pos_pendientes', JSON.stringify(['ordenes:o1'])],
    ['pos_ordenes', JSON.stringify([{ id: 'o1', mesaId: 3, estado: 'abierta', items: [], total: 0, version: 1 }])],
  ]);
  const m = montar({ pagina: VIEJA, publicada: NUEVA, almacen });
  const antes = new Map(almacen);          // ya con el pos_device_id que el store se pone al crearse
  m.pos._vigilarVersion();
  await asentar();
  await m.pos.recargarVersionNueva();
  assert.equal(m.red.recargas, 1);
  assert.deepEqual([...almacen], [...antes], 'ni una clave se tocó');
  // La página nueva lee su cola de reintentos del almacenamiento y la sigue vaciando como siempre.
  const otra = montar({ pagina: NUEVA, publicada: NUEVA, almacen });
  otra.pos.cargarCachéLocal();
  assert.equal(plano(otra.pos.colaDeltas).length, 1, 'la cola de reintentos sobrevive a la recarga');
  assert.equal(otra.pos.colaDeltas[0].id, 'd1');
});

// ───────────────────────── solo el POS ─────────────────────────

test('solo el POS lleva el aviso: carta, landing y menú no piden version.json ni tienen la franja', () => {
  for (const p of ['carta.html', 'index.html', 'menu.html']) {
    const html = leer(p);
    assert.doesNotMatch(html, /version\.json/, `${p}: no pide version.json`);
    assert.doesNotMatch(html, /aviso-version|Hay una versión nueva/, `${p}: sin la franja del aviso`);
    assert.ok(html.includes('name="resplandor-version"'), `${p}: eso sí, lleva su sello y su versión en el pie`);
  }
  const pos = leer('pos.html');
  assert.match(pos, /fetch\('version\.json\?t=' \+ Date\.now\(\), \{ cache: 'no-store'/);
  assert.match(pos, /fetch\(u, \{ cache: 'reload'/);
  // El store no recarga en ningún otro lado: el único location.reload() de su script está en «Recargar» (los otros dos del POS son botones de las pantallas «sin acceso»).
  const guion = scriptDelStore().replace(/^\s*\/\/.*$/gm, '');   // sin los comentarios de línea: solo el código
  assert.equal((guion.match(/location\.reload\(\)/g) || []).length, 1, 'un solo location.reload() en el script del store');
  const recargar = guion.slice(guion.indexOf('async recargarVersionNueva()'), guion.indexOf('cancelarRecarga()'));
  assert.match(recargar, /window\.location\.reload\(\)/, 'y está dentro de recargarVersionNueva');
});
