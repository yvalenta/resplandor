// Cobrar por partes una cuenta con PROMOCIÓN, en el POS de verdad (Chromium, arnés simulado de _pos-simulado.mjs): migración 20261005130000_promo_cobro_por_partes.sql.
// La lógica (qué se ofrece, qué se rechaza, qué dice) la prueban pos-promo-cobro-por-partes.test.mjs (el store en un vm) y migracion-promo-cobro-por-partes.test.mjs
// (la base con un mesero y un admin de verdad). Aquí, lo que se ve y se toca:
//   · con una línea de promo en la cuenta, «Cobrar por partes» abre el modo con su aviso («Esta mesa tiene una promoción…»), las casillas apagadas y los dos
//     «Cobrar seleccionados» apagados (desde 1024 la barra telón; bajo 1024 el botón de la barra fija, que dice «Con promoción: usa un abono»), sin desborde y sin errores;
//   · tocar «Cobrar» a una persona en esa cuenta NO cobra nada (ninguna venta ni delta llega a la base) y deja el panel de abono abierto con el total de la persona escrito;
//   · una cuenta SIN promoción: ni aviso ni casillas apagadas, como siempre.
// Se salta, con el motivo, si no hay Playwright y Chromium (como hallazgos-domingo-navegador.test.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { servirPos, nuevoContexto, abrirPos, llamadasSupabase } from './_pos-simulado.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
let navegador = null;
let servidorPos = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidorPos?.cerrar().catch(() => {});
});

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// La mesa 3 con «3 almuerzos» de Camila (2 + el tercero con descuento) y una limonada de Andrés: 2 × 21.000 + 16.800 + 13.000 = 71.800.
const PROMO = { id: 'pr3', de: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 };
const conPromo = (d) => {
  const o = d.tablas.ordenes.find((x) => x.id === 'ord-abierta-3');
  o.items = [
    { id: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, qty: 2, nota: 'Sopa · Pollo — Persona 1 (Camila)' },
    { id: 'promo:pr3:ej1__sopa-pollo', nombre: 'Ejecutivo de la casa · 3er almuerzo · 20% OFF', precio: 16800, qty: 1, nota: 'Sopa · Pollo — Persona 1 (Camila)', promo: PROMO },
    { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 1, nota: 'Persona 2 (Andrés)' },
  ];
  o.total = o.items.reduce((s, i) => s + i.precio * i.qty, 0);
};

async function abrir(t, ancho, ajustar) {
  let ultimo = null;
  for (let intento = 0; intento < 2; intento++) {
    let ctx = null;
    try {
      servidorPos ||= await servirPos(RAIZ, 0);
      navegador ||= await pw.chromium.launch();
      ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
      contextos.push(ctx);
      const page = await ctx.newPage();
      page.setDefaultTimeout(90000);
      const { diag } = await abrirPos(page, { url: servidorPos.url, vista: 'orden', ajustar });
      return { page, diag };
    } catch (e) { ultimo = e; await ctx?.close().catch(() => {}); }
  }
  t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(ultimo.message).split('\n')[0]}`);
  return null;
}
const entrarAlModoPartes = async (page) => {
  if (await visible(page, '.barra-asa') && !(await visible(page, '.pedido-card'))) await page.locator('.barra-asa').click();
  await page.getByRole('button', { name: 'Cobrar por partes' }).click();
  await page.waitForTimeout(400);
};

for (const ancho of [1280, 390]) {
  test(`POS (${ancho} px): con una promoción en la cuenta, «Cobrar por partes» avisa y apaga las casillas y los botones; sin desborde ni errores`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, conPromo); if (!a) return;
    const { page, diag } = a;
    await entrarAlModoPartes(page);
    assert.ok(await visible(page, '#aviso-promo-partes'), 'el aviso de la promoción está a la vista');
    assert.match(await page.locator('#aviso-promo-partes').innerText(), /Esta mesa tiene una promoción[\s\S]*cobra la mesa completa, o recibe un abono por cada quien/);
    const casillas = page.locator('.order-item input[type=checkbox]');
    assert.equal(await casillas.count(), 3, 'tres líneas, tres casillas');
    for (let i = 0; i < 3; i += 1) assert.equal(await casillas.nth(i).isDisabled(), true, `la casilla ${i + 1} está apagada`);
    await casillas.first().click({ force: true });
    assert.equal(await page.evaluate(() => Alpine.store('pos').lineasSeleccionadas), 0, 'tocarla a la fuerza no marca nada');
    const boton = ancho >= 1024 ? page.locator('.barra-partes button') : page.locator('.barra-accion button:visible').filter({ hasText: /Con promoción|Marca lo que paga|Cobrar \$|Pasa de lo que queda/ });
    assert.equal(await boton.first().isDisabled(), true, '«Cobrar seleccionados» está apagado');
    if (ancho < 1024) assert.match(await boton.first().innerText(), /Con promoción: usa un abono/);
    assert.ok(await visible(page, '#monto-abono'), 'y «Recibir un abono» sigue a la mano');
    assert.equal(await sinDesborde(page), 0, 'sin desborde horizontal');
    assert.deepEqual(diag.errores, [], 'sin errores de página');
    await page.getByRole('button', { name: 'Cancelar selección' }).click();
    await page.waitForTimeout(250);
    assert.equal(await visible(page, '#aviso-promo-partes'), false, 'al salir del modo, el aviso se va');
  });

  test(`POS (${ancho} px): «Cobrar» a una persona en una cuenta con promoción NO cobra nada: abre el abono con el total de esa persona escrito`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, conPromo); if (!a) return;
    const { page, diag } = a;
    if (await visible(page, '.barra-asa') && !(await visible(page, '.pedido-card'))) await page.locator('.barra-asa').click();
    const antes = (await llamadasSupabase(page)).length;
    const cobrar = page.getByRole('button', { name: 'Cobrar a Camila' });
    await cobrar.scrollIntoViewIfNeeded();
    await cobrar.click();
    await page.waitForTimeout(500);
    assert.ok(await visible(page, '#monto-abono'), 'el panel de abono quedó abierto');
    assert.equal(await page.locator('#monto-abono').inputValue(), '58.800', 'con lo que debe Camila: 2 × 21.000 + 16.800');
    const texto = await page.evaluate(() => Alpine.store('pos').aviso?.texto || '');
    assert.match(texto, /Esta mesa tiene una promoción: lo de Camila se recibe como un abono por su total/);
    const llamadas = (await llamadasSupabase(page)).slice(antes);
    const ventas = llamadas.filter((c) => /ordenes/.test(JSON.stringify(c)) && /cerrada/.test(JSON.stringify(c)));
    const deltas = llamadas.filter((c) => c.nombre === 'aplicar_delta_orden' || /aplicar_delta_orden/.test(JSON.stringify(c)));
    assert.deepEqual(ventas, [], 'ninguna venta cerrada se mandó a la base');
    assert.deepEqual(deltas, [], 'ningún delta salió de la cuenta');
    assert.equal(await page.evaluate(() => Alpine.store('pos').ordenes.filter((o) => o.estado === 'cerrada' && o.parcialDe).length), 0, 'ni hay una venta por partes en la tablet');
    assert.equal(await sinDesborde(page), 0, 'sin desborde horizontal');
    assert.deepEqual(diag.errores, [], 'sin errores de página');
  });

  test(`POS (${ancho} px): sin promoción en la cuenta, «Cobrar por partes» es el de siempre: ni aviso ni casillas apagadas`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, undefined); if (!a) return;
    const { page, diag } = a;
    await entrarAlModoPartes(page);
    assert.equal(await visible(page, '#aviso-promo-partes'), false, 'sin aviso');
    const casillas = page.locator('.order-item input[type=checkbox]');
    assert.ok(await casillas.count() >= 1);
    assert.equal(await casillas.first().isDisabled(), false, 'las casillas están encendidas');
    await casillas.first().click();
    assert.equal(await page.evaluate(() => Alpine.store('pos').lineasSeleccionadas), 1, 'se puede marcar una línea');
    const boton = ancho >= 1024 ? page.locator('.barra-partes button') : page.locator('.barra-accion button:visible').filter({ hasText: /Con promoción|Marca lo que paga|Cobrar \$|Pasa de lo que queda/ });
    assert.equal(await boton.first().isDisabled(), false, '«Cobrar seleccionados» se enciende al marcar');
    assert.equal(await sinDesborde(page), 0);
    assert.deepEqual(diag.errores, []);
  });
}
