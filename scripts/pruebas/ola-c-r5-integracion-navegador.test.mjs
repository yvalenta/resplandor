// Ola C, ronda 5, INTEGRACIÓN de r5a («simplificar») y r5b («tablero») EN NAVEGADOR (Chromium de verdad, Alpine envolviendo el store REAL y el stub de
// Supabase de _pos-simulado.mjs). Lo que ninguna de las dos ramas veía sola: la hoja «Cierre sin respaldo» de la versión anterior (r5a) tiene que ser alcanzable
// desde el tablero de Administración (r5b), y las dos cosas juntas tienen que caber en 320, 390 y 1440 px.
//   1. El admin llega con un cierre viejo en la tablet: la hoja se abre sola; la cierra; el tablero destaca «Cierres e historial» («Por decidir») y
//      «Revisar el cierre sin respaldo» la vuelve a abrir; el aviso de la vista de Cierre también la abre.
//   2. Decidir («Descartar este cierre local», con segundo toque) deja la tarjeta como siempre y «Cerrar día» ya no está bloqueado por eso.
//   3. El mesero con un cierre viejo en su tablet: ni hoja, ni tablero, ni tarjeta.
//   4. Sin desborde horizontal y con botones tocables (44 px) en el tablero con la tarjeta destacada, a 320, 390 y 1440 px.
//
// Solo corre si hay Playwright con Chromium; si no, se salta con el motivo. Nunca toca Supabase.
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

const limpio = (t) => String(t).replace(/\s+/g, ' ').trim();
const hasta = async (page, fn, ms = 5000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await page.waitForTimeout(40); } return !!(await fn()); };
const it = (id, nombre, precio, qty = 1) => ({ id, nombre, precio, qty, nota: '' });
const fila = (id, mesa, items, extra = {}) => ({ id, mesa_id: mesa, estado: 'cerrada', items, total: items.reduce((s, i) => s + i.precio * i.qty, 0), abierta_en: '2026-09-30T11:00:00-05:00', cerrada_en: '2026-09-30T12:00:00-05:00', version: 2, ...extra });
const venta = (o) => ({ id: o.id, mesaId: o.mesa_id, estado: 'cerrada', items: o.items, total: o.total, abiertaEn: o.abierta_en, cerradaEn: o.cerrada_en, version: o.version });

/** El cierre «Sin respaldo» que dejó el POS de antes: una venta que la base no tiene (la «Subir las que faltan» la subiría) y otra que sí. */
const VENTAS = { falta: fila('falta', 5, [it('be6', 'Paloma', 30000, 2)], { version: 0 }), ya: fila('ya', 2, [it('en1', 'Patacón', 15000)]) };
const CIERRE_VIEJO = { id: 'viejo', fecha: '2026-09-30T12:30:00-05:00', total: Object.values(VENTAS).reduce((s, o) => s + o.total, 0), sync: 'error', purgar: Object.keys(VENTAS), ordenes: Object.values(VENTAS).map(venta) };

function escenario(d) {
  d.olaC = true;
  d.tablas.mesas.forEach((m) => { m.estado = 'libre'; });
  d.tablas.ordenes = [VENTAS.ya];
  d.tablas.cierres = [];
  d.tablas.deshechos = [];
}

async function abrir(t, ancho, alto, { rol, vista = 'mesas' } = {}) {   // `rol`: con qué rol contesta la base ('admin' por defecto)
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    await page.addInitScript((claves) => { for (const [k, v] of Object.entries(claves)) { try { if (localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } } }, { pos_cierres: [CIERRE_VIEJO] });
    const { diag } = await abrirPos(page, { url: servidor.url, vista, ajustar: (d) => { escenario(d); if (rol) d.rol = rol; }, dirCache: DIR_CACHE });
    return { page, diag };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}

const hoja = (page) => page.locator('.modal-backdrop:visible .modal');
const tarjeta = (page, clave) => page.locator(`[data-tarjeta="${clave}"]`);
const entradaAdmin = (page) => page.locator('nav.nav-bar .nav-destinos .nav-link', { hasText: 'Administración' });
const alTablero = async (page) => {
  await entradaAdmin(page).click();
  assert.ok(await hasta(page, () => page.evaluate(() => Alpine.store('pos').vista === 'admin')), 'llegó al tablero');
  await hasta(page, () => page.evaluate(() => !Alpine.store('pos').cargandoTablero));
};
const cabe = async (page, locator, ancho, nombre) => {
  const c = await locator.boundingBox();
  assert.ok(c, `${nombre} se ve`);
  assert.ok(c.height >= 44 - 0.5, `${nombre} es tocable (${Math.round(c.height)} px)`);
  assert.ok(c.x >= -0.5 && c.x + c.width <= ancho + 0.5, `${nombre} cabe en ${ancho} px (x ${Math.round(c.x)}, ancho ${Math.round(c.width)})`);
};

for (const [ancho, alto] of [[320, 700], [390, 844], [1440, 900]]) {
  test(`navegador ${ancho} px: la hoja de las ventas sin subir se abre sola, el tablero destaca «Cierres» y desde ahí se vuelve a abrir; decidirla deja todo como siempre`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, alto); if (!a) return;
    const { page, diag } = a;
    // 1. Al arrancar, la hoja se abre sola (una vez).
    await hoja(page).waitFor({ state: 'visible', timeout: 8000 });
    assert.match(limpio(await hoja(page).innerText()), /Esta tablet guardó 2 ventas \(\$ 75\.000\) del sistema anterior/);
    await page.keyboard.press('Escape');
    assert.ok(await hasta(page, async () => !(await hoja(page).count())), 'Escape la cierra');
    assert.equal(await page.evaluate(() => Alpine.store('pos').cierresViejos.length), 1, 'cerrarla no decide nada');
    // 2. El tablero la sigue pidiendo: tarjeta destacada, chip, frase y su botón.
    await alTablero(page);
    const card = tarjeta(page, 'cierres');
    assert.equal(await card.evaluate((e) => e.classList.contains('destacada')), true, 'la tarjeta de Cierres está destacada');
    assert.deepEqual((await card.locator('.chip:visible').allInnerTexts()).map(limpio), ['Por decidir']);
    assert.equal(limpio(await card.locator('.tarjeta-admin-dato').innerText()), 'Un cierre por decidir', 'el titular no dice «Aún no hay cierres» mientras pide decidir');
    const alto1 = (await card.locator('.tarjeta-admin-titulo').boundingBox()).height;
    assert.ok(alto1 < 60, `el título «Cierres» con su chip cabe en una línea (${Math.round(alto1)} px)`);
    assert.match(limpio(await card.locator('.tarjeta-admin-detalle').innerText()), /^Esta tablet guardó ventas del sistema anterior que no se subieron: decide si subirlas o descartarlas$/);
    assert.deepEqual((await card.locator('.tarjeta-admin-accion:visible').allInnerTexts()).map(limpio), ['Revisar ventas sin subir', 'Ver historial']);
    assert.equal(await page.evaluate(() => Alpine.store('pos').modalCierresViejos), false, 'ir al tablero no la reabre sola');
    // Sin desborde y con los botones tocables, con la tarjeta destacada y sus dos botones.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde horizontal en el tablero');
    await cabe(page, card.getByRole('button', { name: 'Revisar ventas sin subir', exact: true }), ancho, '«Revisar ventas sin subir»');
    await cabe(page, card.getByRole('button', { name: 'Ver historial', exact: true }), ancho, '«Ver historial»');
    const cajaTarjeta = await card.boundingBox();
    assert.ok(cajaTarjeta.x >= -0.5 && cajaTarjeta.x + cajaTarjeta.width <= ancho + 0.5, 'la tarjeta cabe');
    // 3. «Revisar ventas sin subir» abre la hoja otra vez, con la lista comparada con el sistema.
    await card.getByRole('button', { name: 'Revisar ventas sin subir', exact: true }).click();
    await hoja(page).waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await hasta(page, async () => !/Comparando con el sistema/.test(limpio(await hoja(page).innerText()))), 'la comparación con el sistema termina');
    const modal = hoja(page);
    assert.match(limpio(await modal.innerText()), /Falta en el sistema/);
    assert.match(limpio(await modal.innerText()), /Otra venta ya está en el sistema/, 'la que el sistema ya tiene se resume en una línea, no en una fila');
    assert.equal(await modal.locator('.deshecho-fila').count(), 1, 'la lista trae solo la que falta');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde con la hoja abierta sobre el tablero');
    // 4. Cerrar la hoja y llegar por la vista de Cierre: el aviso «Revisar» también la abre.
    await page.keyboard.press('Escape');
    assert.ok(await hasta(page, async () => !(await hoja(page).count())));
    await card.getByRole('button', { name: 'Cierres e historial', exact: true }).click();   // (el nombre accesible sigue completo: «e historial» va en sr-only)
    assert.ok(await hasta(page, () => page.evaluate(() => Alpine.store('pos').vista === 'cierre')), 'el título de la tarjeta abre la vista de Cierre');
    const aviso = page.locator('#cierre-viejo-aviso');
    await aviso.waitFor({ state: 'visible', timeout: 4000 });
    await aviso.getByRole('button').first().click();
    await hoja(page).waitFor({ state: 'visible', timeout: 4000 });
    // 5. Decidir: «Descartar copia» pide un segundo toque; la hoja se va y todo vuelve a la normalidad.
    await modal.getByRole('button', { name: 'Descartar copia', exact: true }).click();
    await modal.getByRole('button', { name: 'Sí, descartar', exact: true }).click();
    await page.waitForFunction(() => Alpine.store('pos').cierresViejos.length === 0 && Alpine.store('pos').modalCierresViejos === false, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('pos_cierres_viejos')), null, 'el cierre local ya no está');
    assert.equal(await page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.delete').length), 0, 'descartar no purgó nada de la base');
    assert.equal(await page.evaluate(() => Alpine.store('pos').irA('admin')), true);
    await tarjeta(page, 'cierres').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await tarjeta(page, 'cierres').evaluate((e) => e.classList.contains('destacada')), false, 'decidido: la tarjeta vuelve a ser la de siempre');
    assert.deepEqual((await tarjeta(page, 'cierres').locator('.tarjeta-admin-accion:visible').allInnerTexts()).map(limpio), ['Ver historial']);
    assert.equal((await page.evaluate(() => Alpine.store('pos').razonSinCierre)).includes('cierre sin respaldo'), false, '«Cerrar día» ya no se bloquea por el cierre viejo');
    assert.deepEqual(diag.errores, [], 'sin errores de consola');
    assert.deepEqual(diag.bloqueadas, [], 'nada fuera del propio sitio');
  });
}

test('navegador 390 px: el mesero con un cierre viejo en su tablet no ve la hoja, ni el tablero, ni la tarjeta', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 390, 844, { rol: 'mesero' }); if (!a) return;
  const { page, diag } = a;
  await page.waitForTimeout(600);
  assert.equal(await hoja(page).count(), 0, 'sin hoja');
  assert.equal(await entradaAdmin(page).count() ? await entradaAdmin(page).isVisible() : false, false, 'sin la entrada «Administración»');
  assert.equal(await page.evaluate(() => Alpine.store('pos').irA('admin')), false);
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'mesas');
  assert.equal(await tarjeta(page, 'cierres').isVisible(), false, 'sin tarjeta');
  assert.deepEqual(diag.errores, [], 'sin errores de consola');
});
