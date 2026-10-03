// «Recargar» frente a una red que se cae y a una red lenta, en Chromium de verdad (re-refutación de la integración version-nueva × para-llevar).
// Arnés de _pos-simulado.mjs: Supabase simulado dentro de la página, datos ficticios, nada sale a la red. La lógica fina (el orden, los topes,
// qué dice cada nota) está en version-aviso.test.mjs, con el script del store en un `vm`; acá se mira lo que solo un navegador dice.
//
//   1. Esperar primero, mirar la red después. «Recargar» baja el documento nuevo DESPUÉS de esperar lo que estaba en vuelo (un «+1» sin
//      confirmar). Antes lo bajaba antes: si la red se caía durante esa espera (hasta ~5 s), la subida fallaba, quedaba en la cola, la
//      espera terminaba «bien» y location.reload() sin red dejaba al POS en chrome-error://chromewebdata/. Ahora, sin documento bajado
//      DESPUÉS de la espera no hay recarga.
//   2. Una red lenta que funciona no es una red caída. El documento y todos los scripts se pedían a la vez con un tope de 6 s que lo abortaba
//      todo y se contaba como «el documento no bajó»: por debajo de ~90 KB/s «Recargar» nunca recargaba y decía «¿sin internet?».
//      Ahora el documento baja solo, con un tope largo, la franja dice «Descargando la versión nueva…», y los scripts y hojas son de mejor
//      esfuerzo. Si de verdad no alcanza, lo dice distinto a «sin internet».
//
// La red lenta se frena con CDP (Network.emulateNetworkConditions). El arnés sirve sin comprimir (pos.html ~975 KB, scripts ~965 KB sin el de
// supabase, que va simulado): 250 KB/s aquí son, más o menos, ~70 KB/s con lo que GitHub Pages manda comprimido (pos.html 224 KB y ~317 KB de scripts).
// `version.json` se contesta desde la prueba (page.route). Se salta, con el motivo, si no hay Playwright con Chromium (ver _navegador.mjs).
'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { buscarPlaywright } from './_navegador.mjs';
import { VISTAS, datosFicticios, esperarEstable, esperarListo, nuevoContexto, prepararPagina, servirPos } from './_pos-simulado.mjs';
import { RAIZ } from './_pos-vm.mjs';

const VERSION_NUEVA = '2099.01.01-abcdef0';
const KBPS = Number(process.env.KBPS || 250);

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
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await servidor.cerrar();
});
const saltar = { skip: navegador ? false : `navegador no disponible: ${motivo}` };

const franja = (page) => page.locator('.aviso-version');
const tocarRecargar = (page) => franja(page).getByRole('button', { name: 'Recargar', exact: true }).click();
const notaDeLaFranja = (page) => franja(page).locator('.aviso-version-txt').innerText();
const navegaciones = (page) => { const n = { total: 0 }; page.on('request', (r) => { if (r.isNavigationRequest()) n.total++; }); return n; };

/**
 * Abre pos.html con una versión nueva publicada (el aviso sale), la red del local bajo control (`red.caida` hace fallar TODO pedido al sitio,
 * como un wifi sin salida) y el cliente de Supabase a mano (window.__cliente) para poder colgar una RPC.
 */
async function abrir(page, { vista = 'orden' } = {}) {
  const red = { caida: false };
  await prepararPagina(page, { url: servidor.url, datos: datosFicticios(), sesion: true, bloquearFuentes: true });
  await page.route(`${servidor.url}/**`, (route) => (red.caida ? route.abort('internetdisconnected') : route.fallback()));
  await page.route(/\/version\.json(\?|$)/, (route) => (red.caida ? route.abort('internetdisconnected')
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: VERSION_NUEVA, fecha: '2099-01-01', huella: 'x' }) })));
  await page.addInitScript(() => {
    let sb;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return sb; },
      set(v) { const crear = v.createClient; v.createClient = (...a) => (window.__cliente = crear.apply(v, a)); sb = v; },
    });
  });
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page, { sesion: true });
  await VISTAS[vista].llegar(page);
  await esperarEstable(page);
  await franja(page).waitFor();
  return red;
}

async function conPagina(fn) {
  const contexto = await nuevoContexto(navegador, { ancho: 390, alto: 844, movil: true });
  try { return await fn(contexto, await contexto.newPage()); } finally { await contexto.close(); }
}

// ───────────────────────── 1. la red se cae mientras «Recargar» espera ─────────────────────────

for (const [nombre, offlineDelNavegador] of [
  ['wifi sin internet (navigator.onLine sigue en true)', false],
  ['el aparato pierde la red (offline del navegador)', true],
]) {
  test(`un «+1» en vuelo, «Recargar», y la red se cae durante la espera (${nombre}): el POS NO se tira a chrome-error, la franja lo dice y al volver la red recarga`, saltar, async () => {
    await conPagina(async (contexto, page) => {
      const red = await abrir(page);
      // aplicar_delta_orden sale y no contesta (red lenta). Cuando la red se cae, falla como falla fetch al perder la red.
      await page.evaluate(() => {
        const c = window.__cliente; const rpc = c.rpc.bind(c);
        c.rpc = (n, a) => (n === 'aplicar_delta_orden'
          ? new Promise((r) => { window.__cortar = () => r({ data: null, error: { message: 'TypeError: Failed to fetch' } }); })
          : rpc(n, a));
      });
      await page.evaluate(() => { const s = Alpine.store('pos'); s.incrementarItem(s.ordenes.find((x) => x.id === 'ord-abierta-3').items.find((i) => i.id === 'be1')); });
      assert.equal(await page.evaluate(() => Alpine.store('pos')._hayDeltasEnVuelo('ord-abierta-3')), true, 'el store sabe que hay una subida en vuelo');

      const nav = navegaciones(page);
      await tocarRecargar(page);
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => Alpine.store('pos').versionRecargando), true, 'sigue en «Recargar»: espera lo que está en vuelo');
      assert.equal(nav.total, 0, 'y no se navegó');
      assert.equal(await page.evaluate(() => Alpine.store('pos').versionRecargaNota), '', 'sin nota de «Descargando…»: el documento no se pidió todavía, primero se espera lo pendiente');

      // Se cae la red: el delta en vuelo falla (queda en pos_delta_queue) y ya no hay «cambios sin guardar». Antes se recargaba aquí.
      red.caida = true;
      if (offlineDelNavegador) await contexto.setOffline(true);
      await page.evaluate(() => window.__cortar());
      await page.waitForFunction(() => !Alpine.store('pos').versionRecargando && /Sin conexión|No pude descargar/.test(Alpine.store('pos').versionRecargaNota), null, { timeout: 15000 });
      assert.equal(page.url().startsWith(servidor.url), true, `el navegador sigue en el POS (no en chrome-error): ${page.url()}`);
      assert.equal(await page.evaluate(() => !!(window.Alpine && Alpine.store('pos') && Alpine.store('pos').avisoVersionVisible)), true, 'el POS está vivo y el aviso sigue');
      assert.equal(nav.total, 0, 'no se intentó navegar');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pos_delta_queue') || '[]').length), 1, 'y el «+1» que falló quedó en la cola de reintentos');
      assert.equal(await franja(page).getByRole('button', { name: 'Recargar', exact: true }).isEnabled(), true, 'el botón queda libre');

      // Vuelve la red: el mismo botón recarga (la cola de reintentos sobrevive a la recarga: está en el almacenamiento).
      red.caida = false;
      await contexto.setOffline(false);
      await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }), tocarRecargar(page)]);
      assert.equal(page.url().startsWith(servidor.url), true);
      await esperarListo(page);
    });
  });
}

// ───────────────────────── 2. una red lenta que funciona ─────────────────────────

async function frenar(contexto, page, kbps) {
  const cdp = await contexto.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: kbps * 1024, uploadThroughput: 64 * 1024 });
  return cdp;
}

test(`red lenta que funciona (${KBPS} KB/s en el arnés): «Recargar» dice «Descargando la versión nueva…», no «¿sin internet?», y recarga con UN toque`, saltar, async () => {
  await conPagina(async (contexto, page) => {
    await abrir(page, { vista: 'mesas' });
    await frenar(contexto, page, KBPS);
    const nav = navegaciones(page);
    const t0 = Date.now();
    await tocarRecargar(page);
    // Mientras baja, la franja lo dice (con la red buena la descarga termina antes de que nadie lo lea).
    await page.waitForFunction(() => Alpine.store('pos').versionRecargaNota === 'Descargando la versión nueva…', null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => Alpine.store('pos').versionRecargando), true);
    assert.equal(nav.total, 0, 'todavía no navega: está bajando');
    await page.waitForNavigation({ waitUntil: 'load', timeout: 60000 });
    const seg = (Date.now() - t0) / 1000;
    console.log(`  un toque, ${seg.toFixed(1)} s hasta la recarga · navegaciones: ${nav.total}`);
    assert.equal(nav.total, 1, 'recargó, con un solo toque');
    await esperarListo(page);
    assert.equal(await page.evaluate(() => !!(window.Alpine && Alpine.store('pos'))), true, 'y el POS arrancó');
  });
});

test('red lenta que no alcanza (tope del documento corto): lo dice como «muy lenta», no como «¿sin internet?», no recarga, y con la red buena el siguiente toque recarga', saltar, async () => {
  await conPagina(async (contexto, page) => {
    await abrir(page, { vista: 'mesas' });
    await page.evaluate(() => { Alpine.store('pos')._topeDocumentoMs = 1500; });          // en vez de 30 s
    const cdp = await frenar(contexto, page, 60);                                          // el documento (~975 KB) tardaría ~16 s
    const nav = navegaciones(page);
    await tocarRecargar(page);
    await page.waitForFunction(() => !Alpine.store('pos').versionRecargando && /muy lenta/.test(Alpine.store('pos').versionRecargaNota), null, { timeout: 15000 });
    const nota = await notaDeLaFranja(page);
    assert.doesNotMatch(nota, /sin internet/i, `con una red que contesta no dice «sin internet»: «${nota}»`);
    assert.equal(nav.total, 0, 'no recargó: el documento nuevo no bajó entero');
    assert.equal(await franja(page).getByRole('button', { name: 'Recargar', exact: true }).isEnabled(), true, 'el botón queda libre');
    // La red mejora: el siguiente toque recarga.
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }), tocarRecargar(page)]);
    assert.equal(nav.total, 1);
  });
});
