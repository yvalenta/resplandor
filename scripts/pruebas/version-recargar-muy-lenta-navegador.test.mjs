// «Recargar» con una red MUY lenta o que se detiene, en Chromium de verdad (re-refutación de la ronda 3 sobre 152e5d7, hallazgo 2).
// Arnés de _pos-simulado.mjs: Supabase simulado dentro de la página, datos ficticios, nada sale a la red. La red se frena con CDP.
//
// Lo que pasaba: el tope del documento era fijo (30 s desde el pedido) y cortaba una descarga que seguía avanzando. Por debajo de ~7 KB/s reales
// (con el gzip de GitHub Pages) «Recargar» no recargaba nunca, y como cache:'reload' no reusa lo ya bajado, cada toque empezaba de cero, mientras que
// una recarga normal con la misma red sí terminaba. Ahora el documento se lee por partes y se corta por INACTIVIDAD (10 s sin cabeceras, 15 s sin un
// byte del cuerpo), con 5 min de red de seguridad: mientras lleguen bytes se sigue, y una descarga que se queda sin bytes se corta y lo dice
// («se detuvo», no «¿sin internet?» ni «muy lenta»).
//
//   1. Una descarga lenta pero continua, más larga que los 30 s de antes, termina y recarga con UN toque. El arnés sirve pos.html sin comprimir
//      (~1 MB): a `KBPS` (por defecto, el que lo baja en ~34 s) el tope fijo de antes lo cortaba.
//   2. Una descarga que contesta, da unos bytes y se queda callada se corta a los `SIN_BYTES_MS` (aquí 2,5 s en vez de 15 s: es un valor del store)
//      con «se detuvo»; el navegador aborta la conexión de verdad; el POS sigue como estaba y, cuando la red vuelve, el mismo botón recarga.
//
// Corrida contra otro pos.html (para ver que falla sin el cambio): POS_HTML=<archivo>. Se salta, con el motivo, si no hay Playwright con Chromium.
'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buscarPlaywright } from './_navegador.mjs';
import { datosFicticios, esperarEstable, esperarListo, nuevoContexto, prepararPagina, servirPos } from './_pos-simulado.mjs';
import { RAIZ } from './_pos-vm.mjs';

const VERSION_NUEVA = '2099.01.01-abcdef0';
const POS = path.join(RAIZ, 'pos.html');
// Con esta velocidad el documento tarda ~34 s (el tope fijo de antes era de 30 s), sea cual sea el peso de pos.html.
const KBPS = Number(process.env.KBPS || Math.floor(fs.statSync(POS).size / 1024 / 34));
const SIN_BYTES_MS = 2500;

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivo = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidor = await servirPos(RAIZ, 0);
  } catch (e) {
    motivo = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
const proxies = [];
after(async () => {
  for (const p of proxies) await p.cerrar();
  if (navegador) await navegador.close();
  if (servidor) await servidor.cerrar();
});
const saltar = { skip: navegador ? false : `navegador no disponible: ${motivo}` };

const franja = (page) => page.locator('.aviso-version');
const boton = (page, nombre) => franja(page).getByRole('button', { name: nombre, exact: true });
const textoDeLaFranja = (page) => franja(page).locator('.aviso-version-txt').innerText();

/**
 * Un servidor delante del arnés que, cuando se le pide, hace lo que hace una red que se detiene: contesta el documento que `cache: "reload"` pide
 * (la descarga de «Recargar»: lleva `Cache-Control: no-cache`), manda unos bytes y no manda más, sin cerrar la conexión. `estado.cortadas` cuenta
 * las conexiones que el navegador abortó.
 */
async function servidorQueSeDetiene(base) {
  const estado = { detener: false, detenidas: 0, cortadas: 0 };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (estado.detener && url.pathname === '/pos.html' && /no-cache/.test(String(req.headers['cache-control'] || '') + String(req.headers.pragma || ''))) {
      const cuerpo = fs.readFileSync(POS);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': cuerpo.length });
      res.write(cuerpo.subarray(0, 60000));
      estado.detenidas++;
      res.on('close', () => { estado.cortadas++; });
      return;                                                                   // y no manda más: la conexión se quedó callada
    }
    const hacia = http.request(base + req.url, { method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    hacia.on('error', () => res.destroy());
    req.pipe(hacia);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const proxy = { url: `http://127.0.0.1:${srv.address().port}`, estado, cerrar: () => new Promise((ok) => { srv.close(ok); srv.closeAllConnections?.(); }) };
  proxies.push(proxy);
  return proxy;
}

/** Abre pos.html con una versión nueva publicada (el aviso sale). Con el reloj de la página corriendo: lo que se mide son temporizadores (ver version-recargar-diferida-navegador). */
async function abrir(page, url) {
  await prepararPagina(page, { url, datos: datosFicticios(), sesion: true, bloquearFuentes: true, relojFijo: false });
  await page.route(/\/version\.json(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: VERSION_NUEVA, fecha: '2099-01-01', huella: 'x' }) }));
  await page.goto(`${url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page, { sesion: true });
  await esperarEstable(page);
  await franja(page).waitFor();
}

async function conPagina(fn) {
  const contexto = await nuevoContexto(navegador, { ancho: 390, alto: 844, movil: true });
  try { return await fn(contexto, await contexto.newPage()); } finally { await contexto.close(); }
}

async function frenar(contexto, page, kbps) {
  const cdp = await contexto.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: kbps * 1024, uploadThroughput: 64 * 1024 });
  return cdp;
}
const soltarFreno = (cdp) => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});

test(`red muy lenta pero que avanza (${KBPS} KB/s en el arnés, el documento tarda más de 30 s): «Recargar» no corta una descarga que sigue avanzando y recarga con UN toque`, { ...saltar, timeout: 400000 }, async () => {
  await conPagina(async (contexto, page) => {
    await abrir(page, servidor.url);
    // Los scripts y hojas son de mejor esfuerzo (20 s) y aquí no son lo que se prueba: 1,5 s para no esperar de más.
    await page.evaluate(() => { Alpine.store('pos')._topeHojasMs = 1500; });
    const cdp = await frenar(contexto, page, KBPS);
    let navegaciones = 0;
    page.on('request', (r) => { if (r.isNavigationRequest()) navegaciones++; });
    const t0 = Date.now();
    await boton(page, 'Recargar').click();
    await page.waitForNavigation({ waitUntil: 'commit', timeout: 240000 });
    const seg = (Date.now() - t0) / 1000;
    console.log(`  un toque, ${seg.toFixed(1)} s hasta la recarga · navegaciones: ${navegaciones}`);
    assert.equal(navegaciones, 1, '«Recargar» recargó, con un solo toque');
    assert.ok(seg > 30, `tardó ${seg.toFixed(1)} s: más de los 30 s del tope fijo de antes, que cortaba esta descarga (si no, la prueba no mide lo que dice)`);
    await soltarFreno(cdp);
    await esperarListo(page);
    assert.equal(await page.evaluate(() => !!(window.Alpine && Alpine.store('pos'))), true, 'y el POS arrancó');
  });
});

test(`una descarga que se queda sin bytes (${SIN_BYTES_MS} ms en vez de 15 s) se corta con «se detuvo»: el navegador aborta la conexión, no recarga, el POS sigue como estaba y con red el mismo botón recarga`, saltar, async () => {
  const proxy = await servidorQueSeDetiene(servidor.url);
  await conPagina(async (contexto, page) => {
    await abrir(page, proxy.url);
    await page.evaluate((ms) => { Alpine.store('pos')._topeSinBytesMs = ms; }, SIN_BYTES_MS);
    proxy.estado.detener = true;
    let navegaciones = 0;
    page.on('request', (r) => { if (r.isNavigationRequest()) navegaciones++; });
    const t0 = Date.now();
    await boton(page, 'Recargar').click();
    await page.waitForFunction(() => /se detuvo/.test(Alpine.store('pos').versionRecargaNota), null, { timeout: 20000 });
    const seg = (Date.now() - t0) / 1000;
    const nota = await textoDeLaFranja(page);
    console.log(`  cortó a los ${seg.toFixed(1)} s: «${nota}»`);
    assert.match(nota, /La descarga de la versión nueva se detuvo: la conexión dejó de dar datos/);
    assert.doesNotMatch(nota, /sin internet|muy lenta/, 'la red contestó y se detuvo: no es «¿sin internet?» ni «muy lenta»');
    // Cota de arriba holgada a propósito (una máquina cargada retrasa los temporizadores varios segundos): lo que prueba que cortó el tope de «sin bytes»
    // —el de 2,5 s que puso la prueba— y no el de 15 s de verdad es que llegó antes de los 15 s.
    assert.ok(seg >= SIN_BYTES_MS / 1000 - 0.3 && seg < 14, `a los ${SIN_BYTES_MS / 1000} s sin bytes, no antes ni a los 15 s del tope de verdad (${seg.toFixed(1)} s)`);
    assert.equal(navegaciones, 0, 'no recargó');
    assert.equal(proxy.estado.detenidas, 1, 'el documento se pidió una vez');
    await page.waitForTimeout(300);
    assert.equal(proxy.estado.cortadas, 1, 'y el navegador cortó esa conexión de verdad');
    const e = await page.evaluate(() => ({ recargando: Alpine.store('pos').versionRecargando, visible: Alpine.store('pos').avisoVersionVisible, lista: Alpine.store('pos').versionListaParaRecargar }));
    assert.deepEqual(e, { recargando: false, visible: true, lista: false }, 'el botón queda libre, el aviso sigue y nada se da por «listo»');
    assert.equal(await boton(page, 'Recargar').isEnabled(), true);

    // La red vuelve: el mismo botón recarga.
    proxy.estado.detener = false;
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }), boton(page, 'Recargar').click()]);
    assert.equal(navegaciones >= 1, true, 'con la red de vuelta, recargó');
    await esperarListo(page);
  });
});
