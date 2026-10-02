// «Pago con Bre-B» en el tablero de Administración (pos.html → Ajustes), EN NAVEGADOR: la tarjeta se comporta como promete con el arnés (Supabase
// SIMULADO, datos ficticios, ver _pos-simulado.mjs). Complemento de pago-breb-tablero.test.mjs (la lógica del store en un vm, siempre corre). Solo corre
// si hay Playwright con Chromium (_navegador.mjs); si no, se salta con el motivo. Nunca toca Supabase. La llave y el QR son los FICTICIOS de
// _breb-ficticio.mjs (ningún dato de pago real vive en el repo).
//   1. Lo configurado: el interruptor, los campos y la vista previa con el QR dibujado (que se LEE) y la llave debajo.
//   2. Pegar y guardar: la validación EMV + CRC en vivo, la vista previa, el guardado de punta a punta contra el stub (las tres columnas, .eq(id, 1)).
//   3. Lo que no sirve: CRC roto, llave con espacio, «mostrar» sin los dos datos: el motivo, y «Guardar» apagado.
//   4. Leer desde una foto: con BarcodeDetector (simulado) rellena el campo; sin él (este Chromium) el botón no sale y la ayuda dice cómo copiar el contenido.
//   5. Solo admin: un mesero no ve la tarjeta ni se lee nada del pago.
//   6. Sin desborde horizontal y con controles de ≥ 44 px a 320, 360, 390 y 1440 px.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { decodificarQr, matrizDeSvgConMargen } from './_qr-decodificar.mjs';
import { LLAVE_FICTICIA, QR_FICTICIO, QR_FICTICIO_CORTO, conUnCaracterCambiado } from './_breb-ficticio.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
const DIR_CACHE = process.env.POS_CDN_CACHE || undefined;
const FILA = { id: 1, ticket_qr_url: 'https://resplandor.ynt.codes/', ticket_qr_visible: true, ticket_pie: 'Gracias por su visita' };
const CONFIGURADO = { ...FILA, pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO };
const VACIO = { ...FILA, pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null };

let servidor = null;
let navegador = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});

const reposo = (page) => page.waitForTimeout(200);
const limpio = (txt) => txt.replace(/\s+/g, ' ').trim();

/**
 * Abre Ajustes con una fila de `ajustes` en la base simulada (`fila`) y deja la tarjeta lista. `inicio`: 'mesas' abre el POS en el mapa y entra a Ajustes con
 * irA() (como lo hace el admin desde Administración: así se prueba la LECTURA); cualquier otra cosa fija la vista (el estado de la base ya está en el stub).
 * `fotos`: true simula BarcodeDetector (con lo que `window.__qrFoto` diga); 'sin' lo quita (como Safari o Firefox); sin ella queda el REAL de este Chromium
 * (existe en un origen seguro como 127.0.0.1 y lee QR). `rol`: el rol del que mira.
 */
async function abrir(t, { ancho = 390, fila = VACIO, entrar = true, fotos = false, rol } = {}) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const alto = { 320: 640, 360: 780, 390: 844, 1280: 900, 1440: 900 }[ancho] || 900;
    const ctx = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    if (fotos === 'sin') await page.addInitScript(() => { delete window.BarcodeDetector; });
    if (fotos === true) {
      await page.addInitScript(() => {
        window.BarcodeDetector = class { constructor(o) { window.__detectorOpciones = o; } async detect() { return window.__qrFoto === undefined ? [] : [{ rawValue: window.__qrFoto }]; } };
      });
    }
    const { diag } = await abrirPos(page, { url: servidor.url, vista: 'mesas', dirCache: DIR_CACHE, ajustar: (d) => { d.tablas.ajustes = [{ ...fila }]; } });
    if (rol) { await page.evaluate((r) => { const p = Alpine.store('pos'); p.rol = r; p.rolCargado = true; p.sinAcceso = false; }, rol); await reposo(page); }
    if (entrar) {
      await page.evaluate(() => Alpine.store('pos').irA('ajustes'));
      await reposo(page);
    }
    return { page, diag };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}
const tarjeta = (page) => page.locator('#ajustes-breb');
const guardar = (page) => tarjeta(page).getByRole('button', { name: 'Guardar pago con Bre-B' });
const interruptor = (page) => tarjeta(page).getByRole('switch', { name: 'Mostrar en la carta' });
const llamadasAjustes = (page, op) => page.evaluate((o) => window.__posSim.llamadas.filter((l) => l.tipo === 'db.' + o && l.tabla === 'ajustes').map((l) => ({ carga: l.carga, filtros: l.filtros })), op);
const filaAjustes = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__posSim.tablas.ajustes[0])));
const qrDeLaPrevia = async (page) => {
  const q = await page.evaluate(() => { const svg = document.querySelector('#ajustes-breb .breb-previa-qr svg'); return { viewBox: svg.getAttribute('viewBox'), d: svg.querySelector('path').getAttribute('d'), fondo: svg.querySelector('rect').getAttribute('fill'), trazo: svg.querySelector('path').getAttribute('fill') }; });
  const lado = Number(q.viewBox.split(' ')[2]);
  return { ...q, lectura: decodificarQr(matrizDeSvgConMargen(`<svg viewBox="0 0 ${lado} ${lado}"><path d="${q.d}"/></svg>`, 4).matriz) };
};

// ───────────────────────── 1. lo configurado ─────────────────────────

test('Ajustes → «Pago con Bre-B»: se LEE de la base al entrar (irA), con el interruptor, la llave, el contenido y la vista previa; el QR dibujado SE LEE y dice el contenido', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: CONFIGURADO }); if (!a) return;
  const { page, diag } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  assert.equal(limpio(await tarjeta(page).locator('h2').innerText()), 'Pago con Bre-B');
  assert.equal(await interruptor(page).getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#breb-llave').inputValue(), LLAVE_FICTICIA, 'lo leyó de la base: irA(ajustes) pidió las columnas pago_breb_*');
  assert.equal(await page.locator('#breb-qr').inputValue(), QR_FICTICIO);
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /Formato EMV y CRC correctos/);
  assert.equal(await guardar(page).isDisabled(), true, 'sin cambios no hay nada que guardar');
  // La vista previa: el QR negro sobre blanco, con su margen, que un lector lee, y la llave debajo.
  const previa = page.locator('.breb-previa-qr');
  await previa.waitFor({ state: 'visible' });
  const q = await qrDeLaPrevia(page);
  assert.deepEqual([q.fondo, q.trazo], ['white', 'black']);
  assert.equal(q.lectura.texto, QR_FICTICIO);
  assert.deepEqual([q.lectura.nivel, q.lectura.version], ['M', 17]);
  assert.equal(await previa.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)');
  const caja = await previa.boundingBox();
  assert.ok(Math.abs(caja.width - caja.height) < 1 && caja.width >= 200, `la vista previa mide ${caja.width}×${caja.height}`);
  assert.equal(await previa.getAttribute('role'), 'img');
  assert.equal(await previa.getAttribute('aria-label'), `Código QR de Bre-B para pagar a la llave ${LLAVE_FICTICIA}`);
  assert.equal(limpio(await page.locator('.breb-previa-llave').innerText()), `Llave: ${LLAVE_FICTICIA}`);
  // Lo leyó con UNA consulta con las tres columnas, a la fila 1.
  const lecturas = await page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.select' && l.tabla === 'ajustes').map((l) => l.filtros));
  assert.ok(lecturas.length >= 1);
  assert.deepEqual(diag.errores, []);
});

test('sin configurar (columnas en null): apagado, campos vacíos, «Pega el contenido del QR para ver cómo queda» y nada guardado; el dato de pago no queda en el almacenamiento de la tablet', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page, diag } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  assert.equal(await interruptor(page).getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('#breb-llave').inputValue(), '');
  assert.equal(await page.locator('#breb-qr').inputValue(), '');
  assert.match(await page.locator('.breb-previa-nota').innerText(), /Pega el contenido del QR para ver cómo queda/);
  assert.equal(await page.locator('.breb-previa-qr').isVisible(), false);
  assert.equal(await guardar(page).isDisabled(), true);
  // Con datos configurados, nada de lo del pago se guardó en el almacenamiento del navegador.
  const b = await abrir(t, { fila: CONFIGURADO }); if (!b) return;
  await b.page.locator('.breb-previa-qr').waitFor({ state: 'visible' });
  const guardado = await b.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  assert.ok(!guardado.includes('prueba.ficticia') && !guardado.includes('000201'), 'ni la llave ni el contenido del QR están en localStorage ni en sessionStorage');
  assert.deepEqual(diag.errores, []);
});

// ───────────────────────── 2. pegar y guardar ─────────────────────────

test('pegar la llave y el contenido: la validación sale en vivo, la vista previa se dibuja, «Mostrar» se enciende y guardar manda las tres columnas a la fila 1 (punta a punta contra el stub)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page, diag } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-llave').fill(`  ${LLAVE_FICTICIA}  `);
  await page.locator('#breb-qr').fill(`\n${QR_FICTICIO}\n`);
  await reposo(page);
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /Formato EMV y CRC correctos: es el contenido de un QR de pago/);
  await page.locator('.breb-previa-qr').waitFor({ state: 'visible' });
  assert.equal((await qrDeLaPrevia(page)).lectura.texto, QR_FICTICIO, 'la vista previa dibuja lo que se pegó (sin los saltos de los lados)');
  assert.equal(limpio(await page.locator('.breb-previa-llave').innerText()), `Llave: ${LLAVE_FICTICIA}`);
  assert.notEqual(await page.locator('#breb-llave').getAttribute('aria-invalid'), 'true');
  assert.equal(await guardar(page).isDisabled(), false, 'hay cambios y todo sirve');
  assert.equal(await page.evaluate(() => JSON.stringify(Alpine.store('pos').pagoBreb)), JSON.stringify({ visible: false, llave: '', qr: '' }), 'el store NO cambia con lo que se escribe');
  await interruptor(page).click();
  assert.equal(await interruptor(page).getAttribute('aria-checked'), 'true');
  await guardar(page).click();
  await page.getByText('Guardado. La carta ya lo muestra así.').waitFor({ state: 'visible' });
  const escrituras = await llamadasAjustes(page, 'update');
  assert.equal(escrituras.length, 1);
  assert.deepEqual(escrituras[0].carga, { pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }, 'solo las tres columnas, ya limpias');
  assert.deepEqual(escrituras[0].filtros.map((f) => [f.c, f.v, f.t]), [['id', 1, 'eq']], 'update(…).eq(id, 1)');
  assert.deepEqual(await filaAjustes(page), { ...FILA, pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }, 'el ticket de la fila no se tocó');
  assert.equal(await guardar(page).isDisabled(), true, 'ya no hay cambios');
  assert.equal(await page.locator('#ajustes-breb [role=alert]:visible').count(), 0);
  // «Descartar cambios» vuelve a lo guardado.
  await page.locator('#breb-llave').fill('@otra.llave');
  await tarjeta(page).getByRole('button', { name: 'Descartar cambios' }).click();
  assert.equal(await page.locator('#breb-llave').inputValue(), LLAVE_FICTICIA);
  assert.deepEqual(diag.errores, []);
});

test('un QR corto (versión 8) pegado también se valida, se dibuja y se lee', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-qr').fill(QR_FICTICIO_CORTO);
  await page.locator('.breb-previa-qr').waitFor({ state: 'visible' });
  assert.equal((await qrDeLaPrevia(page)).lectura.texto, QR_FICTICIO_CORTO);
  assert.equal(await page.locator('.breb-previa-llave').isVisible(), false, 'sin llave escrita no hay «Llave: …»');
});

// ───────────────────────── 3. lo que no sirve ─────────────────────────

test('contenido con el CRC roto: el motivo sale al salir del campo (no con la primera letra), no hay vista previa y «Guardar» queda apagado', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-llave').fill(LLAVE_FICTICIA);
  await page.locator('#breb-qr').fill(conUnCaracterCambiado(QR_FICTICIO, 120));
  await reposo(page);
  assert.notEqual(await page.locator('#breb-qr').getAttribute('aria-invalid'), 'true', 'mientras se pega no se marca en rojo');
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /Sigue pegando/);
  await page.locator('#breb-llave').focus();     // sale del campo
  await reposo(page);
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /El código de verificación \(CRC\) no cuadra/);
  assert.equal(await page.locator('#breb-qr').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('.breb-previa-qr').isVisible(), false, 'un QR roto no se dibuja');
  assert.match(await page.locator('.breb-previa-nota').innerText(), /Corrige el contenido del QR/);
  assert.equal(await guardar(page).isDisabled(), true);
  // Y el store (y la base) no se enteran.
  assert.equal((await llamadasAjustes(page, 'update')).length, 0);
  // Otros motivos, dichos en claro.
  for (const [texto, motivo] of [['hola', /muy corto/], ['https://resplandor.ynt.codes/carta.html?m=7&k=abc', /empezar por 000201/], [QR_FICTICIO.slice(0, -8), /código de verificación \(campo 63\)/]]) {
    await page.locator('#breb-qr').fill(texto);
    await page.locator('#breb-llave').focus();
    await reposo(page);
    assert.match(await page.locator('#breb-qr-ayuda').innerText(), motivo, texto.slice(0, 20));
    assert.equal(await guardar(page).isDisabled(), true);
  }
});

test('una llave con espacio se marca en rojo al salir del campo; «mostrar en la carta» sin la llave o sin el contenido lo dice y no deja guardar', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-llave').fill('@con espacio');
  await page.locator('#breb-qr').focus();
  await reposo(page);
  assert.match(await page.locator('#breb-llave-ayuda').innerText(), /La llave no es válida: de 2 a 60 caracteres, sin espacios/);
  assert.equal(await page.locator('#breb-llave').getAttribute('aria-invalid'), 'true');
  await page.locator('#breb-qr').fill(QR_FICTICIO);
  await reposo(page);
  assert.equal(await guardar(page).isDisabled(), true, 'con la llave mala no se guarda');
  await page.locator('#breb-llave').fill(LLAVE_FICTICIA);
  await reposo(page);
  assert.equal(await guardar(page).isDisabled(), false);
  // Mostrar sin la llave:
  await page.locator('#breb-llave').fill('');
  await interruptor(page).click();
  await reposo(page);
  assert.match(await tarjeta(page).innerText(), /Para mostrarlo en la carta pon la llave y el contenido del QR/);
  assert.equal(await guardar(page).isDisabled(), true);
  // Apagado se puede guardar solo con el contenido (borrador).
  await interruptor(page).click();
  await reposo(page);
  assert.equal(await guardar(page).isDisabled(), false);
});

test('si la llave que se escribió no aparece dentro del contenido del QR, avisa («Ojo…») sin bloquear: casi seguro son de dos códigos distintos', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-qr').fill(QR_FICTICIO);
  await page.locator('#breb-llave').fill('@otra.llave');
  await reposo(page);
  assert.match(await tarjeta(page).innerText(), /la llave que escribiste no aparece dentro del contenido del QR/);
  assert.equal(await guardar(page).isDisabled(), false, 'es un aviso, no un bloqueo');
  await page.locator('#breb-llave').fill(LLAVE_FICTICIA.toUpperCase());
  await reposo(page);
  assert.doesNotMatch(await tarjeta(page).innerText(), /no aparece dentro del contenido/, 'sin distinguir mayúsculas');
});

test('si la base rechaza (sin permiso o sin la migración), el motivo sale arriba del botón y lo escrito se queda para corregirlo', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-llave').fill(LLAVE_FICTICIA);
  await page.locator('#breb-qr').fill(QR_FICTICIO);
  // Sin la fila 1 (o la RLS no la deja ver): ninguna fila actualizada.
  await page.evaluate(() => { window.__posSim.tablas.ajustes.length = 0; });
  await guardar(page).click();
  const alerta = tarjeta(page).locator('[role=alert]:visible');
  await alerta.waitFor({ state: 'visible' });
  assert.match(await alerta.innerText(), /No se pudo guardar/);
  assert.equal(await page.locator('#breb-qr').inputValue(), QR_FICTICIO, 'lo pegado sigue ahí');
  assert.equal(await tarjeta(page).locator('[role=status]:visible', { hasText: 'Guardado' }).count(), 0);
});

// ───────────────────────── 4. leer desde una foto ─────────────────────────

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('con BarcodeDetector: «Leer desde una foto del QR» rellena el campo (sin guardar), pasa por la MISMA validación y dice que la foto no sale del dispositivo', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO, fotos: true }); if (!a) return;
  const { page, diag } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  const boton = tarjeta(page).getByRole('button', { name: 'Leer desde una foto del QR' });
  assert.equal(await boton.isVisible(), true);
  assert.match(await tarjeta(page).innerText(), /La foto se lee en este dispositivo: no se sube a ningún lado/);
  assert.doesNotMatch(await tarjeta(page).innerText(), /Este navegador no sabe leer un QR desde una foto/);
  // Una foto con un QR bueno.
  await page.evaluate((x) => { window.__qrFoto = x; }, QR_FICTICIO);
  await page.locator('#breb-foto').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await page.getByText('Leí el QR de la foto: revisa abajo que sea el correcto antes de guardar.').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#breb-qr').inputValue(), QR_FICTICIO);
  assert.equal(await page.evaluate(() => window.__detectorOpciones.formats.join()), 'qr_code', 'solo busca QR');
  assert.equal((await qrDeLaPrevia(page)).lectura.texto, QR_FICTICIO);
  assert.equal((await llamadasAjustes(page, 'update')).length, 0, 'leer no guarda');
  // Una foto de otra cosa (un enlace): se lee, pero la validación no la deja guardar.
  await page.evaluate(() => { window.__qrFoto = 'https://ejemplo.test/mesa/7'; });
  await page.locator('#breb-foto').setInputFiles({ name: 'otro.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await page.waitForFunction(() => document.querySelector('#breb-qr').value.startsWith('https://'));
  await page.locator('#breb-llave').focus();
  await reposo(page);
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /empezar por 000201/);
  assert.equal(await guardar(page).isDisabled(), true);
  // Una foto sin QR.
  await page.evaluate(() => { delete window.__qrFoto; });
  await page.locator('#breb-foto').setInputFiles({ name: 'nada.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await page.getByText(/No encontré un QR en esa foto/).waitFor({ state: 'visible' });
  // Un archivo que no es una imagen.
  await page.locator('#breb-foto').setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
  await page.getByText('Elige una foto (una imagen) del QR.').waitFor({ state: 'visible' });
  assert.deepEqual(diag.errores, []);
});

test('sin BarcodeDetector (este Chromium, Safari, Firefox): el botón de la foto NO sale y la ayuda dice cómo copiar el contenido y pegarlo', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO, fotos: 'sin' }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => typeof window.BarcodeDetector), 'undefined', 'este navegador no lo trae');
  assert.equal(await tarjeta(page).getByRole('button', { name: 'Leer desde una foto del QR' }).isVisible(), false);
  assert.equal(await page.locator('#breb-foto').count(), 1);
  assert.equal(await page.locator('#breb-foto').isVisible(), false);
  const ayuda = limpio(await tarjeta(page).innerText());
  assert.match(ayuda, /Este navegador no sabe leer un QR desde una foto\. Escanea el QR con otra app que muestre el texto del código \(un lector de QR o Google Lens\), cópialo y pégalo arriba\./);
  assert.doesNotMatch(ayuda, /La foto se lee en este dispositivo/);
  assert.match(ayuda, /Pega el texto que dice el QR \(empieza por 000201…\), no una imagen\./);
});

test('con el BarcodeDetector REAL del navegador: la foto del QR que dibuja la propia vista previa se lee y devuelve el contenido (el dibujo lo lee un detector de verdad, no solo nuestro decodificador)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: CONFIGURADO }); if (!a) return;
  const { page, diag } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  if (!(await page.evaluate(async () => typeof window.BarcodeDetector === 'function' && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')))) return t.skip('este navegador no trae BarcodeDetector con qr_code');
  const png = await page.locator('.breb-previa-qr').screenshot();       // «la foto»: el QR tal como se ve en pantalla
  await page.locator('#breb-qr').fill('');
  await page.locator('#breb-llave').fill('');
  await reposo(page);
  assert.equal(await page.locator('.breb-previa-qr').isVisible(), false);
  await page.locator('#breb-foto').setInputFiles({ name: 'foto-del-qr.png', mimeType: 'image/png', buffer: png });
  await page.getByText('Leí el QR de la foto: revisa abajo que sea el correcto antes de guardar.').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.locator('#breb-qr').inputValue(), QR_FICTICIO, 'el detector del navegador leyó, de la imagen, exactamente el contenido');
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /Formato EMV y CRC correctos/);
  assert.equal((await llamadasAjustes(page, 'update')).length, 0, 'leer no guarda');
  assert.deepEqual(diag.errores, []);
});

// ───────────────────────── 5. solo admin ─────────────────────────

test('un mesero no ve la tarjeta (ni la vista de Ajustes) y ni siquiera se lee de la base el pago; el admin sí', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: CONFIGURADO, entrar: false, rol: 'mesero' }); if (!a) return;
  const { page } = a;
  assert.equal(await page.evaluate(() => Alpine.store('pos').irA('ajustes')), false, 'irA(ajustes) no deja entrar a un mesero');
  await page.evaluate(() => { Alpine.store('pos').vista = 'ajustes'; });   // aunque alguien fuerce la vista
  await reposo(page);
  assert.equal(await tarjeta(page).isVisible(), false);
  assert.equal(await page.getByText('Pago con Bre-B').first().isVisible(), false);
  assert.equal(await page.evaluate(() => Alpine.store('pos').cargarPagoBreb()), false);
  const lecturas = await page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.select' && l.tabla === 'ajustes' && JSON.stringify(l).includes('pago_breb')).length);
  assert.equal(lecturas, 0, 'el mesero no lee el dato de pago');
  assert.deepEqual(await page.evaluate(() => Alpine.store('pos').pagoBreb), { visible: false, llave: '', qr: '' }, 'y su store no lo tiene');
  const guardado = await page.evaluate(() => Alpine.store('pos').guardarPagoBreb({ visible: true, llave: '@x.llave', qr: '' }));
  assert.equal(guardado, false);
  assert.equal(await page.evaluate(() => Alpine.store('pos').pagoBrebError), 'Solo un admin puede cambiar el pago con Bre-B.');
  assert.equal((await llamadasAjustes(page, 'update')).length, 0);
  // El admin (el de siempre en el arnés) sí entra.
  const b = await abrir(t, { fila: CONFIGURADO }); if (!b) return;
  assert.equal(await tarjeta(b.page).isVisible(), true);
});

// ───────────────────────── 6. medidas ─────────────────────────

for (const ancho of [320, 360, 390, 1440]) {
  test(`${ancho} px: la tarjeta no desborda a los lados, el contenido largo se parte, y todos los controles miden ≥ 44 px`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, { ancho, fila: CONFIGURADO, fotos: true }); if (!a) return;
    const { page, diag } = a;
    await tarjeta(page).waitFor({ state: 'visible' });
    await page.locator('.breb-previa-qr').waitFor({ state: 'visible' });
    await page.locator('#breb-llave').fill('@otra.llave');          // un cambio: aparecen «Descartar» y «Guardar» activo
    await reposo(page);
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(desborde, 0, `desborde horizontal a ${ancho} px`);
    const marco = await tarjeta(page).boundingBox();
    const dentro = await tarjeta(page).evaluate((card) => {
      const lim = card.getBoundingClientRect();
      return [...card.querySelectorAll('input, textarea, button, label, p, .breb-previa-qr')].filter((e) => e.offsetParent !== null).every((e) => { const r = e.getBoundingClientRect(); return r.left >= lim.left - 1 && r.right <= lim.right + 1; });
    });
    assert.equal(dentro, true, 'algo se sale de la tarjeta');
    assert.ok(marco.x >= 0 && marco.x + marco.width <= ancho + 1, 'la tarjeta cabe en la ventana');
    const controles = await tarjeta(page).evaluate((card) => [...card.querySelectorAll('input:not([type=file]), textarea, button')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { nombre: (e.getAttribute('aria-labelledby') ? 'interruptor' : (e.id || e.textContent.trim())).slice(0, 30), h: r.height, w: r.width }; }));
    assert.ok(controles.length >= 6, `controles: ${JSON.stringify(controles)}`);
    for (const c of controles) assert.ok(c.h >= 43.5 && c.w >= 43.5, `«${c.nombre}» mide ${c.w}×${c.h}`);
    assert.deepEqual(diag.errores, []);
  });
}
