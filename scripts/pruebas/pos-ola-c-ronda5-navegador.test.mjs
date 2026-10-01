// Ola C, ronda 5, EN NAVEGADOR (Chromium de verdad, con Alpine envolviendo el store y el stub de Supabase de _pos-simulado.mjs, que modela cerrar_dia como la
// migración 20261002180000): el botón «Cerrar día» de la vista de cierre. No hay cierre sin red: se apaga y dice por qué («Sin conexión…», «Hay N cambios sin
// subir…» con «Reintentar subir»), la ventana de confirmación avisa cuando la base cambió los números y su botón cabe a 320 px, y con red y la cola vacía cierra.
//
// Solo corre si hay Playwright con Chromium y red para los CDN (la primera vez se guardan en disco); si no, se salta con el motivo. Nunca toca Supabase.
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

let servidor = null;
let navegador = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});

const limpio = (t) => t.replace(/\s+/g, ' ').trim();
/** Alpine repinta un instante después de que cambia el estado: lo que se mira en la pantalla se espera, no se lee de golpe. */
const hasta = async (page, fn, ms = 4000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await page.waitForTimeout(40); } return !!(await fn()); };
const sinAbiertas = (d) => {
  d.olaC = true;
  d.tablas.ordenes = d.tablas.ordenes.filter((o) => o.estado !== 'abierta');
  d.tablas.mesas.forEach((m) => { m.estado = 'libre'; });
};

async function abrir(t, ancho, alto) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    const { diag } = await abrirPos(page, { url: servidor.url, vista: 'cierre', ajustar: sinAbiertas, dirCache: DIR_CACHE });
    return { page, diag };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para los CDN?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}

for (const [ancho, alto] of [[320, 700], [390, 844], [1440, 900]]) {
  test(`navegador ${ancho} px: «Cerrar día» se apaga sin red y con cambios sin subir y dice por qué; con red y la cola vacía cierra`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, alto); if (!a) return;
    const { page, diag } = a;
    const cerrar = page.getByRole('button', { name: 'Cerrar día', exact: true });
    const razon = page.locator('#cierre-razon');
    await cerrar.waitFor();
    assert.equal(await cerrar.isDisabled(), false, 'con red y la cola vacía, el botón está habilitado');
    assert.equal(await razon.isVisible(), false, 'y no hay nada que explicar');

    // sin red
    await page.evaluate(() => { Alpine.store('pos').remoto = 'offline'; });
    assert.ok(await hasta(page, () => cerrar.isDisabled()), 'sin red está deshabilitado');
    await razon.waitFor({ state: 'visible' });
    assert.match(limpio(await razon.innerText()), /^Sin conexión: cerrar el día necesita la base/);
    assert.equal(await razon.getByRole('button', { name: 'Reintentar subir' }).isVisible(), false, 'sin red «Reintentar subir» no serviría: no se ofrece');
    assert.ok(await hasta(page, async () => (await cerrar.getAttribute('aria-describedby')) === 'cierre-razon'), 'el botón apunta a su explicación (lectores de pantalla)');
    assert.equal(await page.evaluate(() => Alpine.store('pos').cerrarDia()), 'bloqueado');
    assert.equal(await page.evaluate(() => Alpine.store('pos').cierres.filter((c) => c.sync !== 'ok').length), 0, 'ningún cierre «Sin respaldo»');

    // con red y un cambio sin subir
    await page.evaluate(() => {
      const p = Alpine.store('pos');
      p.remoto = 'ok';
      p.colaDeltas.push({ id: 'delta-de-prueba', orden_id: 'no-existe', item_id: 'x', nombre: 'X', precio: 1, nota: '', delta: 1 });
    });
    await page.waitForFunction(() => /Hay 1 cambio sin subir/.test(document.querySelector('#cierre-razon')?.innerText || ''));
    assert.match(limpio(await razon.innerText()), /^Hay 1 cambio sin subir: espera a que suba\./);
    assert.ok(await hasta(page, () => cerrar.isDisabled()));
    const reintentar = razon.getByRole('button', { name: 'Reintentar subir' });
    await reintentar.waitFor({ state: 'visible', timeout: 3000 });   // con red sí se ofrece «Reintentar subir»
    assert.ok((await reintentar.boundingBox()).height >= 40, 'y es tocable');

    // la explicación no desborda la pantalla
    const ancho1 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(ancho1, 0, 'sin desborde horizontal con la explicación a la vista');

    // «Reintentar subir» sube lo pendiente (el delta de una orden que ya no existe se descarta) y el botón se habilita
    await reintentar.click();
    await page.waitForFunction(() => Alpine.store('pos').cambiosSinSubir === 0, null, { timeout: 8000 });
    assert.ok(await hasta(page, async () => !(await cerrar.isDisabled())), 'el botón se habilita');
    assert.ok(await hasta(page, async () => !(await razon.isVisible())), 'y la explicación se va');

    // y cierra: la ventana, los números y «Sí, cerrar día»
    await cerrar.click();
    const modal = page.locator('.modal-backdrop:visible .modal');
    await modal.waitFor();
    assert.match(limpio(await modal.innerText()), /Se registrarán 3 órdenes con un total de \$ 330\.000/);
    await modal.getByRole('button', { name: 'Sí, cerrar día', exact: true }).click();
    await page.waitForFunction(() => Alpine.store('pos').cierres[0]?.sync === 'ok' && Alpine.store('pos').ordenesHoy.length === 0, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => Alpine.store('pos').modalConfirmCierre), false, 'la ventana se cerró');
    assert.deepEqual(diag.errores.filter((e) => !/delta-de-prueba|no existe/.test(e)), [], 'sin errores de consola');
  });

  test(`navegador ${ancho} px: si la base cambió los números la ventana lo avisa, muestra los de la base y su botón corto cabe junto a «Cancelar»`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, alto); if (!a) return;
    const { page } = a;
    // otro dispositivo cobró una venta más que esta tablet no ve: se agrega a la base simulada
    await page.evaluate(() => {
      const sim = window.__posSim;
      const base = sim.tablas.ordenes.find((o) => o.estado === 'cerrada');
      sim.tablas.ordenes.push({ ...JSON.parse(JSON.stringify(base)), id: 'venta-de-otro-dispositivo', mesa_id: 9, items: [{ id: 'be3', nombre: 'Cóctel de la casa', precio: 32000, qty: 1, nota: '' }], total: 32000, version: 1 });
    });
    await page.getByRole('button', { name: 'Cerrar día', exact: true }).click();
    const modal = page.locator('.modal-backdrop:visible .modal');
    await modal.waitFor();
    assert.match(limpio(await modal.innerText()), /Se registrarán 3 órdenes con un total de \$ 330\.000/, 'antes de confirmar: lo que la tablet ve');
    await modal.getByRole('button', { name: 'Sí, cerrar día', exact: true }).click();
    await page.waitForFunction(() => Alpine.store('pos').cierreCambio === true);
    await modal.getByText(/Los números cambiaron mientras mirabas/).waitFor({ state: 'visible', timeout: 3000 });   // (Alpine repinta un instante después del estado)
    await modal.getByRole('button', { name: 'Sí, cerrar así', exact: true }).waitFor({ state: 'visible', timeout: 3000 });
    assert.match(limpio(await modal.innerText()), /Los números cambiaron mientras mirabas/);
    assert.match(limpio(await modal.innerText()), /Se registrarán 4 órdenes con un total de \$ 362\.000/, 'ahora, los de la base');
    assert.equal(await page.evaluate(() => Alpine.store('pos').cierres.length), 2, 'todavía no se cerró nada (los 2 cierres del historial de siempre)');
    const firmar = modal.getByRole('button', { name: 'Sí, cerrar así', exact: true });
    const cancelar = modal.getByRole('button', { name: 'Cancelar', exact: true });
    assert.equal(await firmar.isVisible(), true);
    // los dos botones caben dentro de la pantalla (a 320 px el rótulo largo de antes empujaba «Cancelar» fuera)
    for (const [nombre, b] of [['Cancelar', cancelar], ['Sí, cerrar así', firmar]]) {
      const c = await b.boundingBox();
      assert.ok(c.x >= 0 && c.x + c.width <= ancho, `${nombre} cabe en ${ancho} px (x ${Math.round(c.x)}, ancho ${Math.round(c.width)})`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde horizontal');
    await firmar.click();
    await page.waitForFunction(() => Alpine.store('pos').cierres.length === 3 && Alpine.store('pos').cierres[0].sync === 'ok', null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => Alpine.store('pos').cierres[0].total), 362000, 'cerró con los números de la base');
    assert.equal(await page.evaluate(() => Alpine.store('pos').cierreCambio), false);
  });
}
