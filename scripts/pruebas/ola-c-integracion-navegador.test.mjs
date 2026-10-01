// Integración de la OLA C en Chromium, con el store REAL (sin relleno del contrato) y la base simulada del arnés. Dos cosas que solo se vieron al
// juntar la lógica (c2) con la pantalla (c3):
//   · la hoja de NFC se abría siempre: el store deja `nfcEstado` en reposo como un objeto ({ id: null, fase: null }), que es «verdadero», y el
//     marcado la abría con el objeto; una capa invisible tapaba todos los toques del POS;
//   · un error del panel de mesas (o un «Deshacer») en la pila del pulgar tapaba las entradas de la hoja de «Más» en teléfono.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
const DIR_CACHE = process.env.POS_CDN_CACHE || undefined;
let servidor = null, navegador = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});
async function abrir(t, vista, ancho) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    const { diag } = await abrirPos(page, { url: servidor.url, vista, dirCache: DIR_CACHE });
    return { page, diag };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para los CDN?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}
const reposo = (page) => page.waitForTimeout(250);

test('integración C (navegador): la hoja de NFC NO se ve en reposo y no tapa ningún toque (store real: nfcEstado en reposo es un objeto)', { skip: SALTAR }, async (t) => {
  for (const ancho of [390, 1440]) {
    const a = await abrir(t, 'mesas', ancho); if (!a) return;
    const { page, diag } = a;
    const reposoNfc = await page.evaluate(() => JSON.parse(JSON.stringify(Alpine.store('pos').nfcEstado)));
    assert.deepEqual(reposoNfc, { id: null, fase: null, mensaje: '' }, 'el estado de reposo del store real');
    assert.equal(await page.locator('.nfc-hoja').isVisible(), false, `${ancho}: la hoja de NFC no se ve en reposo`);
    // Un toque real llega a la mesa (si una capa invisible lo tapara, Playwright diría «intercepts pointer events»).
    await page.locator('.mesa-card').first().click({ timeout: 5000 });
    await page.waitForFunction(() => Alpine.store('pos').vista === 'orden', null, { timeout: 5000 });
    // Con una fase la hoja sí se abre, y cancelarNfc() la deja otra vez en reposo y la cierra.
    await page.evaluate(() => { Alpine.store('pos').nfcEstado = { id: 3, fase: 'esperando', mensaje: 'Acerca la pegatina' }; });
    await reposo(page);
    assert.equal(await page.locator('.nfc-hoja').isVisible(), true, 'con una fase, la hoja se abre');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await reposo(page);
    assert.equal(await page.locator('.nfc-hoja').isVisible(), false, 'cancelarNfc() la cierra');
    assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(Alpine.store('pos').nfcEstado))), { id: null, fase: null, mensaje: '' });
    assert.deepEqual(diag.errores, [], 'sin errores de consola');
  }
});

test('integración C (navegador): con la hoja de «Más» abierta en teléfono, los avisos del pulgar se hacen a un lado y las entradas se pueden tocar', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas-admin', 390); if (!a) return;
  const { page, diag } = a;
  await page.evaluate(() => { Alpine.store('pos').mesasAdminError = 'Esa mesa tiene una cuenta abierta: cóbrala o libérala antes de desactivarla.'; });
  await reposo(page);
  const pila = page.locator('.avisos-pulgar');
  assert.equal(await page.locator('.avisos-pulgar .pulgar-error:visible').count(), 1, 'el error está a la vista');
  await page.locator('nav.nav-bar .nav-link-mas').click();
  await reposo(page);
  assert.equal(await pila.evaluate((e) => getComputedStyle(e).visibility), 'hidden', 'con «Más» abierto la pila se esconde');
  await page.locator('#nav-mas').getByRole('button', { name: /Ajustes/ }).click({ timeout: 5000 });   // antes: «subtree intercepts pointer events»
  await page.waitForFunction(() => Alpine.store('pos').vista === 'ajustes', null, { timeout: 5000 });
  assert.equal(await pila.evaluate((e) => getComputedStyle(e).visibility), 'visible', 'al cerrar la hoja la pila vuelve');
  assert.deepEqual(diag.errores, []);
});
