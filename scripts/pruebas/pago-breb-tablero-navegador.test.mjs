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
//   7. Crítica visual y refutación (2026-10-02): la llave tiene que ser la que cobra el QR (y se propone sola), el estado dice la verdad (visible o apagado), la
//      validación se ve (turquesa si cuadra, borde barro si no), la foto va primero, el QR de valor fijo avisa y la vista previa es chica en un teléfono.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { decodificarQr, matrizDeSvgConMargen } from './_qr-decodificar.mjs';
import { LLAVE_FICTICIA, LLAVE_OTRA_FICTICIA, QR_FICTICIO, QR_FICTICIO_CORTO, conUnCaracterCambiado, emvConCrc, tlv } from './_breb-ficticio.mjs';

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
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /Formato y CRC correctos\. Falta lo importante: escanea la vista previa de abajo con la app de tu banco/);
  assert.equal(limpio(await page.locator('#breb-estado').innerText()), 'Visible para clientes', 'la etiqueta junto al título dice lo que ve la carta AHORA');
  assert.equal(limpio(await page.locator('#breb-previa-titulo').textContent()), 'Así lo ve el cliente en la carta');
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
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /Formato y CRC correctos/);
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
  assert.equal(limpio(await page.locator('.breb-previa-llave').innerText()), `Llave: ${LLAVE_OTRA_FICTICIA}`, 'sin llave escrita, la del QR se propone sola y sale bajo la vista previa');
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

test('la llave tiene que ser la que COBRA el QR (campo 26/04): si no, se dice cuál es, «Guardar» queda apagado y «Usar la llave del QR» lo corrige (ni el comienzo de otra llave ni el 62/07 lo engañan)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-qr').fill(QR_FICTICIO);
  await page.locator('#breb-llave').fill(LLAVE_OTRA_FICTICIA);
  await reposo(page);
  const aviso = page.locator('#breb-llave-no-cuadra');
  assert.equal(await aviso.isVisible(), true);
  assert.equal(await aviso.getAttribute('role'), 'alert');
  assert.equal(limpio(await aviso.locator('p:visible').innerText()), `La llave no es la del QR: el QR cobra a ${LLAVE_FICTICIA} y escribiste ${LLAVE_OTRA_FICTICIA}. La carta mostraría una llave y un QR que no cuadran, y no se puede guardar así.`);
  assert.equal(await page.locator('#breb-llave').getAttribute('aria-invalid'), 'true', 'el campo de la llave se marca');
  assert.equal(await guardar(page).isDisabled(), true, 'es un bloqueo (como en la base), no un aviso');
  // «Usar la llave del QR» la corrige.
  await aviso.getByRole('button', { name: 'Usar la llave del QR' }).click();
  await reposo(page);
  assert.equal(await page.locator('#breb-llave').inputValue(), LLAVE_FICTICIA);
  assert.equal(await aviso.isVisible(), false);
  assert.equal(await guardar(page).isDisabled(), false);
  // La comparación es exacta: ni otra mayúscula, ni el comienzo de la llave que cobra, ni «la llave está en el 62/07».
  await page.locator('#breb-llave').fill(LLAVE_FICTICIA.toUpperCase());
  await reposo(page);
  assert.equal(await guardar(page).isDisabled(), true, 'sin distinguir mayúsculas NO: la base compara exacto');
  await page.locator('#breb-llave').fill(LLAVE_FICTICIA.slice(0, -3));
  await reposo(page);
  assert.equal(await guardar(page).isDisabled(), true, 'el comienzo de la llave que cobra tampoco');
  const en62 = emvConCrc([['00', '01'], ['01', '11'], ['26', tlv('00', 'CO.COM.RBM.LLA') + tlv('04', '@la.que.cobra')], ['62', tlv('07', '@la.visible')], ['53', '170'], ['58', 'CO'], ['59', '0'], ['60', '0']]);
  await page.locator('#breb-qr').fill(en62);
  await page.locator('#breb-llave').fill('@la.visible');
  await reposo(page);
  assert.equal(await guardar(page).isDisabled(), true, 'la llave visible solo está en el 62/07: el QR cobra a otra');
  assert.match(limpio(await aviso.innerText()), /el QR cobra a @la\.que\.cobra y escribiste @la\.visible/);
  // Un QR que no trae la llave en el 26/04: se dice y no hay botón que ofrecer.
  const sinLlave = emvConCrc([['00', '01'], ['01', '11'], ['27', tlv('00', 'CO.COM.RBM.LLA') + tlv('04', '@x.y')], ['53', '170'], ['58', 'CO'], ['59', '0'], ['60', '0']]);
  await page.locator('#breb-qr').fill(sinLlave);
  await page.locator('#breb-llave').fill('@x.y');
  await reposo(page);
  assert.match(limpio(await aviso.innerText()), /No encuentro la llave dentro del QR \(campo 26, subcampo 04\)/);
  assert.equal(await aviso.getByRole('button', { name: 'Usar la llave del QR' }).isVisible(), false);
  assert.equal(await guardar(page).isDisabled(), true);
  assert.equal((await llamadasAjustes(page, 'update')).length, 0, 'nada llegó a la base');
});

test('con la llave vacía, pegar un QR que sirve PROPONE su llave solo (se puede cambiar); si ya había una, no la pisa', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-qr').fill(QR_FICTICIO);
  await reposo(page);
  assert.equal(await page.locator('#breb-llave').inputValue(), LLAVE_FICTICIA, 'la llave salió del QR');
  assert.equal(limpio(await page.locator('.breb-previa-llave').innerText()), `Llave: ${LLAVE_FICTICIA}`);
  assert.equal(await guardar(page).isDisabled(), false, 'y se puede guardar sin escribir nada más');
  // Cambia a otro QR: la llave que ya estaba NO se pisa (ahora no cuadra y lo dice).
  await page.locator('#breb-qr').fill(QR_FICTICIO_CORTO);
  await reposo(page);
  assert.equal(await page.locator('#breb-llave').inputValue(), LLAVE_FICTICIA);
  assert.equal(await page.locator('#breb-llave-no-cuadra').isVisible(), true);
  // Un contenido que no sirve no propone nada.
  await page.locator('#breb-llave').fill('');
  await page.locator('#breb-qr').fill(QR_FICTICIO.slice(0, -1));
  await reposo(page);
  assert.equal(await page.locator('#breb-llave').inputValue(), '');
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
  assert.match(ayuda, /Este navegador no sabe leer un QR desde una foto\. Escanea el QR con otra app que muestre el texto del código \(un lector de QR o Google Lens\), cópialo y pégalo aquí abajo\./);
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
  assert.match(await page.locator('#breb-qr-ayuda').innerText(), /Formato y CRC correctos/);
  assert.equal(await page.locator('#breb-llave').inputValue(), LLAVE_FICTICIA, 'y la llave salió del QR leído');
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

// ───────────────────────── 7. crítica visual y refutación (2026-10-02) ─────────────────────────

test('«Guardado» y el estado dicen la verdad: con el interruptor apagado, «Guardado, pero está apagado: la carta NO lo muestra», la etiqueta dice «Apagado» y la vista previa lo rotula', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  assert.equal(limpio(await page.locator('#breb-estado').innerText()), 'Apagado: la carta no lo muestra');
  await page.locator('#breb-qr').fill(QR_FICTICIO);          // la llave se propone sola
  await reposo(page);
  assert.equal(limpio(await page.locator('#breb-previa-titulo').textContent()), 'Vista previa (apagado: la carta no lo muestra)', 'con el interruptor apagado la vista previa no dice «así lo ve el cliente»');
  assert.equal(await page.locator('#breb-sin-guardar').isVisible(), true, '«Hay cambios sin guardar.»');
  await guardar(page).click();
  const guardado = page.locator('#breb-guardado');
  await guardado.waitFor({ state: 'visible' });
  assert.equal(limpio(await guardado.innerText()), 'Guardado, pero está apagado: la carta NO lo muestra.');
  assert.equal(await page.getByText('Guardado. La carta ya lo muestra así.').count(), 0, 'no dice que la carta lo muestra');
  assert.equal(limpio(await page.locator('#breb-estado').innerText()), 'Apagado: la carta no lo muestra');
  assert.equal(await page.locator('#breb-sin-guardar').isVisible(), false);
  // Lo enciende y guarda: ahora sí.
  await interruptor(page).click();
  assert.equal(limpio(await page.locator('#breb-previa-titulo').textContent()), 'Así lo ve el cliente en la carta');
  await guardar(page).click();
  await page.getByText('Guardado. La carta ya lo muestra así.').waitFor({ state: 'visible' });
  assert.equal(limpio(await page.locator('#breb-estado').innerText()), 'Visible para clientes');
  assert.equal(await page.locator('#breb-estado').evaluate((e) => e.classList.contains('badge-turquesa')), true);
});

test('la validación se ve: el estado correcto sale turquesa con su marca, el campo malo lleva borde barro AUNQUE no tenga el foco, y la llave válida no hereda el rojo', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  await page.locator('#breb-qr').fill(QR_FICTICIO);
  await reposo(page);
  const color = (sel) => page.locator(sel).evaluate((e) => getComputedStyle(e).color);
  const token = (nombre) => page.evaluate((n) => { const c = document.createElement('i'); c.style.color = getComputedStyle(document.documentElement).getPropertyValue(n); document.body.appendChild(c); const r = getComputedStyle(c).color; c.remove(); return r; }, nombre);
  assert.equal(await color('#breb-qr-ayuda'), await token('--color-turquesa'), 'turquesa del tablero (5,27 sobre papel)');
  assert.equal(await page.locator('#breb-qr-ayuda i[data-lucide], #breb-qr-ayuda svg').first().isVisible(), true, 'con su marca de «cuadra»');
  // Un contenido roto: al salir del campo, borde barro y texto barro, sin el aro del foco.
  await page.locator('#breb-qr').fill(conUnCaracterCambiado(QR_FICTICIO, 120));
  await page.locator('#breb-llave').focus();                          // sale del contenido
  await reposo(page);
  const barro = await token('--color-barro');
  assert.equal(await color('#breb-qr-ayuda'), barro, 'el texto del motivo es barro');
  const roto = await page.locator('#breb-qr').evaluate((e) => ({ borde: getComputedStyle(e).borderTopColor, sombra: getComputedStyle(e).boxShadow, foco: document.activeElement === e }));
  assert.equal(roto.foco, false, 'el foco está en la llave');
  assert.equal(roto.borde, barro, 'el campo roto lleva borde barro aunque no tenga el foco');
  assert.notEqual(roto.sombra, 'none');
  // La llave sirve: sin el foco no hereda el rojo (con el foco lleva el aro de siempre, que es de todos los campos).
  await page.locator('#breb-llave').blur();
  await reposo(page);
  const llave = await page.locator('#breb-llave').evaluate((e) => ({ borde: getComputedStyle(e).borderTopColor, sombra: getComputedStyle(e).boxShadow }));
  assert.notEqual(llave.borde, barro, 'el campo de la llave, que sí sirve, no hereda el rojo');
  assert.equal(llave.sombra, 'none');
});

test('un QR que sirve pero trae un valor fijo (campo 54) o es de un solo uso (campo 01 en «12») AVISA con «Ojo…», sin bloquear; el estático y sin valor no avisa', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  const aviso = page.locator('#breb-qr-aviso');
  await page.locator('#breb-qr').fill(QR_FICTICIO);
  await reposo(page);
  assert.equal(await aviso.isVisible(), false);
  const conValor = emvConCrc([['00', '01'], ['01', '11'], ['26', tlv('00', 'CO.COM.RBM.LLA') + tlv('04', LLAVE_FICTICIA)], ['53', '170'], ['54', '99000'], ['58', 'CO'], ['59', '0'], ['60', '0']]);
  await page.locator('#breb-qr').fill(conValor);
  await reposo(page);
  assert.equal(await aviso.isVisible(), true);
  assert.match(limpio(await aviso.innerText()), /^Ojo: este QR trae un valor fijo \(campo 54\)\. Todas las mesas pagarían ese mismo valor\./);
  assert.equal(await guardar(page).isDisabled(), false, 'es un aviso, no un bloqueo');
  const unSoloUso = emvConCrc([['00', '01'], ['01', '12'], ['26', tlv('00', 'CO.COM.RBM.LLA') + tlv('04', LLAVE_FICTICIA)], ['53', '170'], ['58', 'CO'], ['59', '0'], ['60', '0']]);
  await page.locator('#breb-qr').fill(unSoloUso);
  await reposo(page);
  assert.match(limpio(await aviso.innerText()), /^Ojo: este QR es de un solo uso/);
  assert.equal(await guardar(page).isDisabled(), false);
});

test('la foto va PRIMERO (botón principal, antes del campo de texto) y el texto va «o pega aquí abajo»; el QR va antes que la llave', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO, fotos: true }); if (!a) return;
  const { page } = a;
  await tarjeta(page).waitFor({ state: 'visible' });
  const boton = tarjeta(page).getByRole('button', { name: 'Leer desde una foto del QR' });
  const yFoto = (await boton.boundingBox()).y, yTexto = (await page.locator('#breb-qr').boundingBox()).y, yLlave = (await page.locator('#breb-llave').boundingBox()).y;
  assert.ok(yFoto < yTexto && yTexto < yLlave, `foto (${yFoto}) < texto (${yTexto}) < llave (${yLlave})`);
  assert.equal(await boton.evaluate((e) => e.classList.contains('btn-primary')), true, 'con estilo principal');
  assert.match(limpio(await tarjeta(page).innerText()), /O pega el texto del QR aquí abajo\./);
  // Sin lector de fotos el botón no sale y el campo de texto sigue siendo el camino.
  const b = await abrir(t, { fila: VACIO, fotos: 'sin' }); if (!b) return;
  assert.equal(await tarjeta(b.page).getByRole('button', { name: 'Leer desde una foto del QR' }).isVisible(), false);
  assert.equal(await b.page.locator('#breb-qr').isVisible(), true);
});

test('en un teléfono la vista previa es más chica que en escritorio (el QR de la previa no pasa de unos 230 px ni baja de 200: se escanea con el banco) y «Guardar» queda cerca del interruptor', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { ancho: 390, fila: CONFIGURADO }); if (!a) return;
  const previa = await a.page.locator('.breb-previa-qr').boundingBox();
  assert.ok(previa.width <= 230 && previa.width >= 200, `la vista previa mide ${previa.width} px a 390 px de ancho`);
  await a.page.locator('#breb-llave').fill('@x.llave');
  await reposo(a.page);
  const interr = await interruptor(a.page).boundingBox();
  const guard = await guardar(a.page).boundingBox();
  assert.ok(guard.y - interr.y < 1500, `«Guardar» está a ${Math.round(guard.y - interr.y)} px del interruptor (antes pasaba de 1500)`);
  const b = await abrir(t, { ancho: 1440, fila: CONFIGURADO }); if (!b) return;
  const grande = await b.page.locator('.breb-previa-qr').boundingBox();
  assert.ok(grande.width > 250, `en escritorio sigue grande: ${grande.width} px`);
});

test('el texto del tablero dice quién ve y quién cambia el pago: un admin lo cambia y el personal aprobado lo lee en la base (no «solo los admins los ven»)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { fila: VACIO }); if (!a) return;
  const texto = limpio(await tarjeta(a.page).innerText());
  assert.match(texto, /Solo un admin los cambia; en la base los lee todo el personal aprobado\./);
  assert.doesNotMatch(texto, /Solo los admins los ven/);
});
