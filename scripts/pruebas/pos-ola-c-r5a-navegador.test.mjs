// Ola C, ronda 5a, EN NAVEGADOR (Chromium de verdad, con Alpine envolviendo el store y el stub de Supabase de _pos-simulado.mjs, que modela RS005, `en_cierre` y
// `reabrir_venta_de_cierre` como la migración 20261002180000): lo que se VE.
//   · la hoja «Cierre sin respaldo» de la versión anterior (solo el admin): el resumen «N ventas, $ X», una fila por venta (mesa, hora, monto y si la base ya la
//     tiene), «Subir las que faltan» y «Descartar este cierre local» (con segundo toque); sin desborde a 320, 390 y 1440 px y con botones tocables;
//   · «Reabrir en mesa» de «Editar transacción» se apaga sin red y lo explica; con red reabre en una sola llamada.
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

const limpio = (t) => t.replace(/\s+/g, ' ').trim();
const hasta = async (page, fn, ms = 4000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await page.waitForTimeout(40); } return !!(await fn()); };
const it = (id, nombre, precio, qty = 1) => ({ id, nombre, precio, qty, nota: '' });
const fila = (id, mesa, items, extra = {}) => ({ id, mesa_id: mesa, estado: 'cerrada', items, total: items.reduce((s, i) => s + i.precio * i.qty, 0), abierta_en: '2026-09-30T11:00:00-05:00', cerrada_en: '2026-09-30T12:00:00-05:00', version: 2, ...extra });
const venta = (o) => ({ id: o.id, mesaId: o.mesa_id, estado: 'cerrada', items: o.items, total: o.total, abiertaEn: o.abierta_en, cerradaEn: o.cerrada_en, version: o.version });

/** El cierre «Sin respaldo» que dejó el POS de antes: cinco ventas, una en cada situación respecto de la base. */
const VENTAS = {
  falta: fila('falta', 5, [it('be6', 'Paloma', 30000, 2)], { version: 0 }),
  ya: fila('ya', 2, [it('en1', 'Patacón', 15000)]),
  arch: fila('arch', 3, [it('en2', 'Empanadas', 18000)]),
  ab: fila('ab', 4, [it('be6', 'Paloma', 30000, 2)]),
  desh: fila('desh', 1, [it('be2', 'Jugo natural', 12000)]),
};
const CIERRE_VIEJO = { id: 'viejo', fecha: '2026-09-30T12:30:00-05:00', total: Object.values(VENTAS).reduce((s, o) => s + o.total, 0), sync: 'error', purgar: Object.keys(VENTAS), ordenes: Object.values(VENTAS).map(venta) };

function escenario(d) {
  d.olaC = true;
  d.tablas.mesas.forEach((m) => { m.estado = m.id === 4 ? 'ocupada' : 'libre'; });
  d.tablas.ordenes = [VENTAS.ya, { ...VENTAS.ab, estado: 'abierta', cerrada_en: null, version: 2 }];
  d.tablas.cierres = [{ id: 'k-otro', fecha: '2026-09-29T21:00:00-05:00', total_ventas: 18000, total_ordenes: 1, transacciones: [venta(VENTAS.arch)] }];
  d.tablas.deshechos = [{ id: 1, orden_id: 'desh', mesa_id: 1, tipo: 'completo', monto: 12000, items: [], hecho_por: 'otro@ejemplo.test', hecho_en: '2026-09-30T12:40:00-05:00', cierre_id: null }];
}

async function abrir(t, ancho, alto, { vista = 'mesas', ajustar = escenario, almacen = {} } = {}) {
  servidor ||= await servirPos(RAIZ, 0);
  navegador ||= await pw.chromium.launch();
  const ctx = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
  contextos.push(ctx);
  const page = await ctx.newPage();
  await page.addInitScript((claves) => { for (const [k, v] of Object.entries(claves)) { try { if (localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } } }, almacen);
  const { diag } = await abrirPos(page, { url: servidor.url, vista, ajustar, dirCache: DIR_CACHE });
  return { page, diag };
}

for (const [ancho, alto] of [[320, 700], [390, 844], [1440, 900]]) {
  test(`navegador ${ancho} px: la hoja «Cierre sin respaldo» se abre sola al admin, lista cada venta con lo que la base ya tiene, no desborda y sus dos acciones son tocables`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, alto, { almacen: { pos_cierres: [CIERRE_VIEJO] } });
    const { page, diag } = a;
    const modal = page.locator('.modal-backdrop:visible .modal');
    await modal.waitFor({ state: 'visible', timeout: 8000 });
    assert.ok(await hasta(page, async () => /Comparando|Falta en la base/.test(limpio(await modal.innerText())) && !/Comparando con la base/.test(limpio(await modal.innerText()))), 'la comparación con la base termina');
    const texto = limpio(await modal.innerText());
    assert.match(texto, /Cierre sin respaldo/);
    assert.match(texto, /Hay un cierre sin respaldo de la versión anterior: 5 ventas, \$ 165\.000\./);
    assert.match(texto, /Nada se sube ni se borra hasta que elijas/);
    assert.equal(await modal.locator('.deshecho-fila').count(), 5, 'una fila por venta');
    for (const [id, mesa, frase] of [['falta', 5, 'Falta en la base'], ['ya', 2, 'La base ya la tiene'], ['arch', 3, 'Ya está en un cierre de la base'], ['ab', 4, 'La base la tiene ABIERTA (Mesa 4)'], ['desh', 1, 'Se deshizo']]) {
      const f = modal.locator('.deshecho-fila', { hasText: frase });
      assert.equal(await f.count(), 1, `${id}: ${frase}`);
      assert.match(limpio(await f.innerText()), new RegExp(`Mesa ${mesa}`), `${id} dice su mesa`);
      assert.match(limpio(await f.innerText()), /\$ [\d.]+/, `${id} dice su monto`);
    }
    const subir = modal.getByRole('button', { name: /^Subir las que faltan \(1\)$/ });
    const descartar = modal.getByRole('button', { name: 'Descartar este cierre local', exact: true });
    assert.equal(await subir.isVisible(), true); assert.equal(await subir.isDisabled(), false, 'hay una venta que falta: se puede subir');
    assert.equal(await descartar.isVisible(), true); assert.equal(await descartar.isDisabled(), false);
    for (const [nombre, b] of [['Subir las que faltan', subir], ['Descartar este cierre local', descartar]]) {
      const c = await b.boundingBox();
      assert.ok(c.height >= 40, `${nombre} es tocable (${Math.round(c.height)} px)`);
      assert.ok(c.x >= -0.5 && c.x + c.width <= ancho + 0.5, `${nombre} cabe en ${ancho} px (x ${Math.round(c.x)}, ancho ${Math.round(c.width)})`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde horizontal de la página');
    assert.equal(await modal.evaluate((el) => el.scrollWidth - el.clientWidth), 0, 'ni dentro de la hoja');
    // descartar pide un segundo toque y avisa lo que se perdería
    await descartar.click();
    await modal.getByText(/¿Descartar este cierre local\?/).waitFor({ state: 'visible', timeout: 3000 });
    assert.match(limpio(await modal.innerText()), /1 venta falta en la base y se perderían\./);
    const sino = [modal.getByRole('button', { name: 'Cancelar', exact: true }), modal.getByRole('button', { name: 'Sí, descartar', exact: true })];
    for (const b of sino) { await b.waitFor({ state: 'visible', timeout: 3000 }); const c = await b.boundingBox(); assert.ok(c.x >= -0.5 && c.x + c.width <= ancho + 0.5, 'caben en la pantalla'); assert.ok(c.height >= 40); }
    await sino[0].click();
    await subir.waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.evaluate(() => Alpine.store('pos').cierresViejos.length), 1, 'cancelar no borra nada');
    // «Subir las que faltan»: sube SOLO la que falta, como cobro normal, y la hoja se cierra
    await subir.click();
    await page.waitForFunction(() => Alpine.store('pos').modalCierresViejos === false && Alpine.store('pos').cierresViejos.length === 0, null, { timeout: 8000 });
    await page.waitForFunction(() => window.__posSim.tablas.ordenes.some((o) => o.id === 'falta'), null, { timeout: 8000 });
    const enBase = await page.evaluate(() => window.__posSim.tablas.ordenes.map((o) => `${o.id}:${o.estado}`).sort());
    assert.deepEqual(enBase, ['ab:abierta', 'falta:cerrada', 'ya:cerrada'], 'solo «falta» se agregó; la abierta no se tocó');
    assert.equal(await page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.delete').length), 0, 'nada se purgó');
    assert.equal(await page.evaluate(() => localStorage.getItem('pos_cierres_viejos')), null, 'el cierre local ya no hace falta');
    assert.deepEqual(diag.errores, [], 'sin errores de consola');
    assert.deepEqual(diag.bloqueadas, [], 'nada fuera del propio sitio');
  });

  test(`navegador ${ancho} px: «Editar transacción» apaga «Reabrir en mesa» sin red y lo explica; con red reabre la venta en UNA llamada y la saca del cierre`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, alto, { vista: 'cierre', ajustar: (d) => { escenario(d); d.tablas.ordenes = []; d.tablas.mesas.forEach((m) => { m.estado = 'libre'; }); d.tablas.cierres = [{ id: 'k1', fecha: '2026-09-29T21:00:00-05:00', total_ventas: 97000, total_ordenes: 2, transacciones: [venta(VENTAS.ya), venta(VENTAS.arch)] }]; } });
    const { page, diag } = a;
    await page.evaluate(() => { const p = Alpine.store('pos'); const k = p.cierres.find((c) => c.id === 'k1'); p.abrirEditorTransaccion(k.ordenes.find((o) => o.id === 'ya'), k); });
    const modal = page.locator('.modal-backdrop:visible .modal');
    await modal.waitFor({ state: 'visible' });
    const reabrir = modal.getByRole('button', { name: 'Reabrir en mesa', exact: true });
    const razon = modal.locator('#reabrir-razon');
    assert.equal(await reabrir.isDisabled(), false, 'con red está habilitado');
    assert.equal(await razon.isVisible(), false);
    await page.evaluate(() => { Alpine.store('pos').remoto = 'offline'; });
    assert.ok(await hasta(page, () => reabrir.isDisabled()), 'sin red se apaga');
    await razon.waitFor({ state: 'visible', timeout: 3000 });
    assert.match(limpio(await razon.innerText()), /^Sin conexión: reabrir una venta de un cierre pasado necesita la base/);
    assert.ok(await hasta(page, async () => (await reabrir.getAttribute('aria-describedby')) === 'reabrir-razon'), 'el botón apunta a su explicación');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde con la explicación');
    for (const b of [reabrir, modal.getByRole('button', { name: 'Editar sin mesa', exact: true }), modal.getByRole('button', { name: 'Cancelar', exact: true })]) {
      const c = await b.boundingBox(); assert.ok(c.x >= -0.5 && c.x + c.width <= ancho + 0.5, 'los botones caben en la pantalla');
    }
    // vuelve la red: se habilita y reabre
    await page.evaluate(() => { Alpine.store('pos').remoto = 'ok'; });
    assert.ok(await hasta(page, async () => !(await reabrir.isDisabled())), 'con red se habilita');
    const antes = await page.evaluate(() => window.__posSim.llamadas.length);
    await reabrir.click();
    await page.waitForFunction(() => Alpine.store('pos').vista === 'orden' && Alpine.store('pos').ordenActiva?.id === 'ya', null, { timeout: 8000 });
    const nuevas = await page.evaluate((n) => window.__posSim.llamadas.slice(n).map((l) => `${l.tipo}:${l.tabla || l.nombre || ''}`), antes);
    assert.ok(nuevas.includes('rpc:reabrir_venta_de_cierre'), 'llamó a la RPC');
    assert.deepEqual(nuevas.filter((x) => /^db\.(upsert|insert|update|delete)/.test(x)), [], 'y a nada más que escriba');
    const cierre = await page.evaluate(() => window.__posSim.tablas.cierres.find((c) => c.id === 'k1'));
    assert.deepEqual(cierre.transacciones.map((x) => x.id), ['arch']);
    assert.equal(cierre.total_ventas, 18000);
    assert.deepEqual(diag.errores, [], 'sin errores de consola');
  });
}
