// «Recargar» con una red lenta frente a lo que la persona hace mientras tanto, en Chromium de verdad (re-refutación de la ronda 3 sobre 152e5d7,
// hallazgo 1). Arnés de _pos-simulado.mjs: Supabase simulado dentro de la página, datos ficticios, nada sale a la red. La red se frena con CDP.
//
// Lo que pasaba: con una red lenta preparar la recarga tarda decenas de segundos (hasta ~130 s en el peor caso), «Después» quedaba deshabilitado
// mientras tanto y el POS seguía aceptando trabajo, así que la recarga llegaba sola encima de lo que la persona había empezado en ese rato (la vista
// abierta, un ítem manual a medio escribir, un diálogo de cobro, el «Deshacer» del último cobro, «Agregar para llevar»). Contradecía el README:
// «no bloquea nada: la persona elige cuándo». Ahora:
//   · mientras prepara, la franja dice «Descargando la versión nueva…» y ofrece «Cancelar», que lo aborta todo y la deja como antes;
//   · al terminar de bajar, recarga en el acto SOLO si la persona no hizo nada desde el toque; si hizo algo, no recarga: «La versión nueva está
//     lista» con «Recargar ahora» (inmediato: la caché ya está caliente) y «Después».
//
// El arnés sirve sin comprimir (pos.html ~1 MB, scripts ~1 MB sin el de supabase, que va simulado). La red se frena a `KBPS_LENTA` (100 KB/s: la
// descarga dura ~20 s, lo que le da tiempo, aun con la máquina cargada, a la persona de empezar algo) o a `KBPS` (300 por defecto) cuando solo importa que sea lenta; con lo que
// GitHub Pages manda comprimido es una red varias veces más lenta, y lo que se prueba (qué pasa mientras baja) no depende de la cifra exacta.
// `version.json` se contesta desde la prueba (page.route). Se salta, con el motivo, si no hay Playwright con Chromium (ver _navegador.mjs).
// Corrida contra otro pos.html (para ver que falla sin el cambio): POS_HTML=<archivo>.
'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { buscarPlaywright } from './_navegador.mjs';
import { VISTAS, datosFicticios, esperarEstable, esperarListo, nuevoContexto, prepararPagina, servirPos } from './_pos-simulado.mjs';
import { RAIZ } from './_pos-vm.mjs';

const VERSION_NUEVA = '2099.01.01-abcdef0';
const KBPS = Number(process.env.KBPS || 300);
const KBPS_LENTA = Number(process.env.KBPS_LENTA || 100);
// «Cancelar» tiene que caer MIENTRAS baja el documento: con margen de sobra para una máquina cargada (el clic puede tardar segundos en llegar).
const KBPS_CANCELAR = Number(process.env.KBPS_CANCELAR || 80);

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
const boton = (page, nombre) => franja(page).getByRole('button', { name: nombre, exact: true });
const tocarRecargar = (page) => boton(page, 'Recargar').click();
const textoDeLaFranja = (page) => franja(page).locator('.aviso-version-txt').innerText();
const estado = (page) => page.evaluate(() => { const s = Alpine.store('pos'); return { vista: s.vista, modal: s.modalItemManual, nombre: s.itemManualNombre, precio: s.itemManualPrecio, recargando: s.versionRecargando, lista: s.versionListaParaRecargar, nota: s.versionRecargaNota }; });

/** Cuenta las navegaciones del marco principal desde ahora. */
function navegaciones(page) {
  const n = { total: 0, primera: 0 };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { n.total++; n.primera ||= Date.now(); } });
  return n;
}

/**
 * Abre pos.html con una versión nueva publicada (el aviso sale) en la vista pedida. Con el reloj de la página corriendo (`relojFijo: false`): con el
 * reloj fijado de Playwright (page.clock.setFixedTime) los temporizadores de más de unos cientos de ms no corren a su hora mientras llega una descarga,
 * y aquí lo que se mide son justamente temporizadores («Descargando…» a los 1,5 s, los topes de «sin bytes»).
 */
async function abrir(page, { vista = 'orden' } = {}) {
  await prepararPagina(page, { url: servidor.url, datos: datosFicticios(), sesion: true, bloquearFuentes: true, relojFijo: false });
  await page.route(/\/version\.json(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: VERSION_NUEVA, fecha: '2099-01-01', huella: 'x' }) }));
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page, { sesion: true });
  await VISTAS[vista].llegar(page);
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

test(`red lenta (${KBPS_LENTA} KB/s en el arnés): lo que la persona empieza mientras «Recargar» baja NO se pierde: «Descargando…» con «Cancelar», y al terminar «La versión nueva está lista» con «Recargar ahora»`, saltar, async () => {
  await conPagina(async (contexto, page) => {
    await abrir(page, { vista: 'orden' });
    const cdp = await frenar(contexto, page, KBPS_LENTA);
    const nav = navegaciones(page);
    const t0 = Date.now();
    await tocarRecargar(page);
    await page.waitForFunction(() => Alpine.store('pos').versionRecargaNota === 'Descargando la versión nueva…', null, { timeout: 8000 });

    // Mientras baja, la franja tiene una salida: «Cancelar» (y «Después» cede su sitio); el botón principal avisa que está ocupado.
    assert.equal(await boton(page, 'Cancelar').isVisible(), true, '«Cancelar» a la vista mientras baja');
    assert.equal(await boton(page, 'Cancelar').isEnabled(), true, 'y habilitado: nada queda deshabilitado sin salida');
    assert.equal(await boton(page, 'Después').isVisible(), false);
    assert.equal(await boton(page, 'Recargando…').isDisabled(), true);
    assert.equal(await textoDeLaFranja(page), 'Descargando la versión nueva…');

    // La persona sigue trabajando (el POS no se bloquea): abre «Ítem manual» y empieza a escribir.
    await page.getByRole('button', { name: /Ítem manual/ }).click();
    await page.getByPlaceholder('Ej: Porción de arroz adicional').fill('Porción de arroz adicional');
    await page.getByPlaceholder('Ej: 5000').fill('5000');
    const antes = await estado(page);
    assert.equal(antes.modal, true);
    assert.equal(antes.nombre, 'Porción de arroz adicional');

    // Termina de bajar: NO recarga encima de lo que escribía.
    await page.waitForFunction(() => Alpine.store('pos').versionListaParaRecargar === true, null, { timeout: 120000 });
    const seg = (Date.now() - t0) / 1000;
    const despues = await estado(page);
    console.log(`  la versión bajó ${seg.toFixed(1)} s después del toque; navegaciones: ${nav.total}; la persona seguía en: ${JSON.stringify({ modal: despues.modal, nombre: despues.nombre })}`);
    assert.equal(nav.total, 0, 'no recargó: la persona había empezado algo');
    assert.deepEqual({ vista: despues.vista, modal: despues.modal, nombre: despues.nombre, precio: despues.precio }, { vista: antes.vista, modal: true, nombre: 'Porción de arroz adicional', precio: antes.precio }, 'el ítem, el diálogo y la vista siguen como estaban');
    assert.equal(despues.recargando, false, 'el botón queda libre');
    await page.waitForTimeout(2500);
    assert.equal(nav.total, 0, 'y sigue sin recargar: espera el toque de la persona');

    // Cuando termina lo suyo (cierra el diálogo), la franja le dice que está lista, con «Recargar ahora» y «Después».
    await page.keyboard.press('Escape');
    assert.equal(await textoDeLaFranja(page), 'La versión nueva está lista');
    assert.equal(await boton(page, 'Recargar ahora').isEnabled(), true);
    assert.equal(await boton(page, 'Después').isEnabled(), true);
    assert.equal(await boton(page, 'Cancelar').isVisible(), false, 'ya no prepara nada');

    // «Recargar ahora» es inmediato: la caché ya está caliente, no vuelve a bajar nada (la red sigue frenada).
    const bajadas = [];    // los pedidos de descarga del documento y de los scripts (fetch): «Recargar ahora» no hace ninguno, la caché ya está caliente
    page.on('request', (r) => { if (r.resourceType() === 'fetch' && /\/(pos\.html|assets\/)/.test(r.url())) bajadas.push(r.url()); });
    const t1 = Date.now();
    await Promise.all([page.waitForNavigation({ waitUntil: 'commit', timeout: 30000 }), boton(page, 'Recargar ahora').click()]);
    const ahora = (Date.now() - t1) / 1000;
    console.log(`  «Recargar ahora»: ${ahora.toFixed(1)} s hasta navegar con la red frenada`);
    assert.deepEqual(bajadas, [], '«Recargar ahora» no vuelve a bajar nada');
    assert.ok(ahora < 12, `«Recargar ahora» recarga en el acto (${ahora.toFixed(1)} s), sin descargar otra vez (volver a bajar el documento con la red frenada tardaría más)`);
    await soltarFreno(cdp);
    await esperarListo(page);
    assert.equal(await page.evaluate(() => !!(window.Alpine && Alpine.store('pos'))), true, 'y el POS arrancó');
  });
});

test(`«Cancelar» mientras baja (${KBPS_CANCELAR} KB/s en el arnés): aborta la descarga de verdad, no recarga nunca, no pide los scripts y deja la franja como antes; después el mismo botón recarga`, saltar, async () => {
  await conPagina(async (contexto, page) => {
    await abrir(page, { vista: 'mesas' });
    const cdp = await frenar(contexto, page, KBPS_CANCELAR);
    const nav = navegaciones(page);
    const pedidos = [];
    page.on('request', (r) => pedidos.push({ url: r.url(), t: Date.now() }));
    const abortados = [];
    page.on('requestfailed', (r) => abortados.push({ url: r.url(), error: r.failure()?.errorText || '' }));

    await tocarRecargar(page);
    await page.waitForFunction(() => Alpine.store('pos').versionRecargaNota === 'Descargando la versión nueva…', null, { timeout: 8000 });
    await page.waitForTimeout(800);                                            // ya baja
    const tCancelar = Date.now();
    await boton(page, 'Cancelar').click();

    // La franja queda como antes (Alpine pinta el cambio de botones un instante después del clic).
    await boton(page, 'Después').waitFor({ state: 'visible', timeout: 5000 });
    await boton(page, 'Cancelar').waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(await textoDeLaFranja(page), 'Hay una versión nueva del POS');
    assert.equal(await boton(page, 'Recargar').isEnabled(), true);
    assert.equal(await boton(page, 'Después').isEnabled(), true);
    const e = await estado(page);
    assert.equal(e.recargando, false);
    assert.equal(e.lista, false, 'no hay nada «listo»: no terminó de bajar');

    // La descarga se abortó de verdad (el navegador la cortó), y no se pidió nada más.
    await page.waitForTimeout(500);
    assert.ok(abortados.some((a) => /\/pos\.html/.test(a.url) && /ABORTED/.test(a.error)), `el pedido del documento se abortó: ${JSON.stringify(abortados)}`);
    // Lo que habría tardado en bajar el documento entero (~12 s a esta velocidad), más lo que tardan los scripts: no llega ninguna recarga ni ningún pedido de los scripts.
    await page.waitForTimeout(12000);
    assert.equal(nav.total, 0, 'no recargó');
    assert.deepEqual(pedidos.filter((p) => p.t > tCancelar && /\/assets\//.test(p.url)).map((p) => p.url), [], 'ni pidió los scripts de una versión que no terminó de bajar');
    assert.equal(await textoDeLaFranja(page), 'Hay una versión nueva del POS');

    // El mismo botón sirve después: con la red buena recarga con un toque.
    await soltarFreno(cdp);
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }), tocarRecargar(page)]);
    assert.equal(nav.total >= 1, true, 'recargó');
    await esperarListo(page);
  });
});

test(`sin tocar nada mientras baja (${KBPS} KB/s en el arnés): «Recargar» recarga en el acto al terminar de bajar, con UN toque, y mientras tanto la franja ofrece «Cancelar»`, saltar, async () => {
  await conPagina(async (contexto, page) => {
    await abrir(page, { vista: 'mesas' });
    const cdp = await frenar(contexto, page, KBPS);
    const nav = navegaciones(page);
    const t0 = Date.now();
    await tocarRecargar(page);
    await page.waitForFunction(() => Alpine.store('pos').versionRecargaNota === 'Descargando la versión nueva…', null, { timeout: 8000 });
    assert.equal(await boton(page, 'Cancelar').isVisible(), true);
    assert.equal(nav.total, 0, 'todavía baja');
    await page.waitForNavigation({ waitUntil: 'commit', timeout: 120000 });
    const seg = (Date.now() - t0) / 1000;
    console.log(`  un toque, ${seg.toFixed(1)} s hasta la recarga · navegaciones: ${nav.total}`);
    assert.equal(nav.total, 1, 'recargó, con un solo toque y sin que nadie hiciera nada más');
    assert.ok(seg > 3, `con esta red tardó ${seg.toFixed(1)} s (si no, la prueba no mide una red lenta)`);
    await soltarFreno(cdp);                                                    // ya navegó: la página nueva arranca sin freno
    await esperarListo(page);
    assert.equal(await page.evaluate(() => !!(window.Alpine && Alpine.store('pos'))), true, 'y el POS arrancó');
  });
});
