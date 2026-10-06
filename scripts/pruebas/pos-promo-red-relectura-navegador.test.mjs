// Las tres reglas de la segunda refutación (2026-10-05), en el POS de verdad (Chromium, arnés simulado de _pos-simulado.mjs), a 390 y 1280 px. La lógica fina (qué sale de la
// cuenta y cuándo, qué se relee, las cifras 61.200 / 53.200 / 38.000) la prueban pos-promo-red-relectura.test.mjs (el store en un vm, con una base que recalcula como la real)
// y migracion-promo-cobro-por-partes.test.mjs (Postgres con un mesero de verdad). Aquí, lo que se ve y se toca:
//   · REGLA 2: sin red y con una promoción que la base pondría (3 almuerzos el día de la regla, sin que la tablet tenga la línea de promo), la pantalla de la cuenta dice
//     «Sin red: esta cuenta tiene promoción; espera a que vuelva la red para cobrar», «Generar ticket y cobrar» queda apagado, «Cobrar a Camila» y «Imprimir precuenta» solo avisan
//     y no sale ninguna venta ni ningún delta; al volver la red todo vuelve.
//   · REGLA 3: el cobro de la mesa completa en línea muestra el total que la BASE registró (la base lo recalcula al cerrar) y lo avisa; sin red el ticket dice «PROVISIONAL» (en pantalla
//     y en lo que se imprime) y, al volver la red, se corrige, se avisa y se puede volver a imprimir.
//   · REGLA 1: una tablet con la cuenta atrasada cobra por partes una cuenta que la base ya tiene con promoción: la base lo rechaza (RS005), NINGÚN delta sale de la cuenta, la
//     cuenta de la base queda intacta y la tablet muestra la de la base (con su línea de promo).
// Se salta, con el motivo, si no hay Playwright y Chromium (como pos-promo-cobro-por-partes-navegador.test.mjs).
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
const SIN_RED = /Sin red: esta cuenta tiene promoción; espera a que vuelva la red para cobrar/;
const aviso = (page) => page.evaluate(() => Alpine.store('pos').aviso?.texto || '');

// La mesa 3 de la simulación (el reloj está en un miércoles: día 3). Regla de la base: cada 3 almuerzos («Ejecutivos»), el más barato con 20 % menos, los miércoles.
const EJ = (qty) => ({ id: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, qty, nota: 'Sopa · Pollo — Persona 1 (Camila)' });
const LIM = { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 1, nota: 'Persona 2 (Andrés)' };
const PROMO_EJ = { id: 'promo:pr-mie:ej1__sopa-pollo', nombre: 'Ejecutivo de la casa · 3er almuerzo · 20% OFF', precio: 16800, qty: 1, nota: 'Sopa · Pollo — Persona 1 (Camila)',
  promo: { id: 'pr-mie', de: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 } };
const poner = (d, items) => { const o = d.tablas.ordenes.find((x) => x.id === 'ord-abierta-3'); o.items = items; o.total = items.reduce((s, i) => s + i.precio * i.qty, 0); };
const conRegla = (items) => (d) => {
  d.olaC = true;
  d.tablas.productos.push({ id: 'pr-mie', categoria: 'Promociones', nombre: '3er almuerzo', precio: 0, descripcion: '', activo: true, etiqueta: '20% OFF', dia_semana: 3,
    promo_regla: { cada: 3, descuento: 20, aplica: { categorias: ['Ejecutivos'] } } });
  poner(d, items);
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
const abrirHoja = async (page) => { if (await visible(page, '.barra-asa') && !(await visible(page, '.pedido-card'))) await page.locator('.barra-asa').click(); };
const sinRed = (page) => page.evaluate(() => { Alpine.store('pos').remoto = 'offline'; });
const conRed = (page) => page.evaluate(() => { Alpine.store('pos').remoto = 'ok'; });

for (const ancho of [1280, 390]) {
  test(`POS (${ancho} px) · REGLA 2: sin red y con la promoción que la base pondría (3 almuerzos hoy), la cuenta dice «Sin red…», no deja cobrar y no manda nada; al volver la red, todo vuelve`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, conRegla([EJ(3), LIM])); if (!a) return;
    const { page, diag } = a;
    await abrirHoja(page);
    assert.equal(await visible(page, '#aviso-sin-cobro'), false, 'con red no hay aviso');
    assert.equal(await page.evaluate(() => Alpine.store('pos').ordenActiva.items.some((i) => String(i.id).startsWith('promo:'))), false, 'la tablet no tiene la línea de promo (la calcula la base)');
    assert.equal(await page.evaluate(() => Alpine.store('pos').cuentaConPromo), true, '…pero sabe por la regla de hoy y las unidades que la base la pondrá: no ofrece partir la cuenta');
    await sinRed(page);
    await page.waitForTimeout(250);
    assert.ok(await visible(page, '#aviso-sin-cobro'), 'sin red: el aviso fijo está a la vista');
    assert.match(await page.locator('#aviso-sin-cobro').innerText(), SIN_RED);
    const cobrar = page.getByRole('button', { name: 'Generar ticket y cobrar' });
    assert.equal(await cobrar.isDisabled(), true, '«Generar ticket y cobrar» está apagado');
    const antes = (await llamadasSupabase(page)).length;
    // por persona: solo avisa
    const camila = page.getByRole('button', { name: 'Cobrar a Camila' });
    await camila.scrollIntoViewIfNeeded();
    await camila.click();
    await page.waitForTimeout(250);
    assert.match(await aviso(page), SIN_RED);
    // precuenta: solo avisa
    await page.evaluate(() => Alpine.store('pos').cerrarAviso());
    const pre = page.getByRole('button', { name: 'Imprimir precuenta' });
    await pre.scrollIntoViewIfNeeded();
    await pre.click();
    await page.waitForTimeout(250);
    assert.match(await aviso(page), SIN_RED);
    assert.equal(await page.getByRole('dialog', { name: 'Imprimir precuenta' }).count(), 0, 'no se abre la confirmación de imprimir');
    const llamadas = (await llamadasSupabase(page)).slice(antes);
    assert.deepEqual(llamadas.filter((c) => /ordenes|aplicar_delta_orden/.test(JSON.stringify(c))), [], 'nada se mandó a la base');
    assert.equal(await page.evaluate(() => Alpine.store('pos').ordenes.filter((o) => o.estado === 'cerrada' && o.parcialDe).length), 0, 'ni hay una venta por partes en la tablet');
    assert.equal(await sinDesborde(page), 0, 'sin desborde horizontal');
    // la red vuelve
    await conRed(page);
    await page.waitForTimeout(250);
    assert.equal(await visible(page, '#aviso-sin-cobro'), false, 'con red el aviso se va');
    assert.equal(await cobrar.isDisabled(), false, 'y «Generar ticket y cobrar» vuelve');
    assert.deepEqual(diag.errores, [], 'sin errores de página');
  });

  test(`POS (${ancho} px) · REGLA 3: la mesa completa en línea muestra el total que la BASE registró (la recalcula al cerrar) y lo avisa; el ticket no es provisional ni deja de imprimirse`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, (d) => { d.olaC = true; }); if (!a) return;
    const { page, diag } = a;
    // La base recalcula al cerrar: la limonada pasó a 14.000 (un precio cambió mientras la tablet no se enteraba): 97.000 → 100.000.
    await page.evaluate(() => { window.__posSim.alCerrar = (f) => { f.items = f.items.map((i) => (i.id === 'be1' ? { ...i, precio: 14000 } : i)); f.total = f.items.reduce((s, i) => s + i.precio * i.qty, 0); }; });
    await abrirHoja(page);
    assert.equal(await page.evaluate(() => Alpine.store('pos').totalOrdenActiva), 97000, 'la tablet muestra 97.000');
    await page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
    await page.getByRole('button', { name: 'Sí, cobrar' }).click();
    await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
    await page.waitForFunction(() => /La base recalculó/.test(Alpine.store('pos').aviso?.texto || ''));
    const texto = await aviso(page);
    assert.match(texto, /100\.000/);
    assert.match(texto, /97\.000/);
    assert.match((await page.locator('.ticket-total .amount').innerText()).replace(/\s/g, ' '), /\$ 100\.000/, 'el ticket dice lo que la base registró');
    await page.locator('.ticket-provisional').waitFor({ state: 'hidden' });   // confirmado: sin «PROVISIONAL»
    const imprimir = page.getByRole('button', { name: 'Imprimir', exact: true });
    assert.equal(await imprimir.isDisabled(), false, '«Imprimir» está encendido');
    const cierre = await page.evaluate(() => ({ pos: Alpine.store('pos').totalPorCerrar, base: window.__posSim.tablas.ordenes.filter((o) => o.estado === 'cerrada').reduce((s, o) => s + Number(o.total), 0),
      mesa3: Alpine.store('pos').ordenesPorCerrar.find((o) => o.id === 'ord-abierta-3').total }));
    assert.equal(cierre.mesa3, 100000, 'la venta de la mesa 3 es la que la base registró');
    assert.equal(cierre.pos, cierre.base, 'el cierre del día suma lo que la base registró');
    assert.equal(await sinDesborde(page), 0);
    assert.deepEqual(diag.errores, []);
  });

  test(`POS (${ancho} px) · REGLA 3: sin red el ticket dice «PROVISIONAL» (pantalla y papel); al volver la red se corrige, se avisa y «Ver ticket»/«Imprimir» dan el nuevo`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, ancho, (d) => { d.olaC = true; }); if (!a) return;
    const { page, diag } = a;
    await page.evaluate(() => { window.__posSim.alCerrar = (f) => { f.items = f.items.map((i) => (i.id === 'be1' ? { ...i, precio: 14000 } : i)); f.total = f.items.reduce((s, i) => s + i.precio * i.qty, 0); }; });
    await abrirHoja(page);
    await sinRed(page);
    await page.getByRole('button', { name: 'Generar ticket y cobrar' }).click();
    await page.getByRole('button', { name: 'Sí, cobrar' }).click();
    await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
    await page.locator('.ticket-provisional').waitFor({ state: 'visible' });   // el ticket dice PROVISIONAL
    assert.match(await page.locator('.ticket-provisional').innerText(), /PROVISIONAL/);
    assert.match((await page.locator('.ticket-total .amount').innerText()).replace(/\s/g, ' '), /\$ 97\.000/);
    const doc = await page.evaluate(() => Alpine.store('pos').documentoTicket(Alpine.store('pos').ordenTicket, 'ticket').lineas.map((l) => l.texto));
    assert.ok(doc.some((l) => /PROVISIONAL/.test(l)), 'y el papel también');
    assert.equal(await page.getByRole('button', { name: 'Imprimir', exact: true }).isDisabled(), false, 'sin red se puede imprimir (el teléfono saca el papel)');
    // la red vuelve: se sube, la base recalcula, el POS corrige y avisa
    await conRed(page);
    await page.evaluate(() => Alpine.store('pos')._subirLoPendiente());
    await page.waitForFunction(() => /La base recalculó/.test(Alpine.store('pos').aviso?.texto || ''));
    const texto = await aviso(page);
    assert.match(texto, /sin conexión/);
    assert.match(texto, /100\.000/);
    assert.match(texto, /97\.000/);
    assert.match(texto, /vuelve a imprimirlo/);
    await page.locator('.ticket-provisional').waitFor({ state: 'hidden' });   // confirmado: ya no es provisional
    assert.match((await page.locator('.ticket-total .amount').innerText()).replace(/\s/g, ' '), /\$ 100\.000/, 'el ticket ya dice el total registrado');
    const doc2 = await page.evaluate(() => Alpine.store('pos').documentoTicket(Alpine.store('pos').ordenTicket, 'ticket').lineas.map((l) => l.texto));
    assert.ok(!doc2.some((l) => /PROVISIONAL/.test(l)), 'y el papel ya no lo dice');
    assert.equal(await sinDesborde(page), 0);
    assert.deepEqual(diag.errores, []);
  });

  test(`POS (${ancho} px) · REGLA 1: una tablet con la cuenta atrasada cobra por partes una cuenta que la base ya tiene con promoción: se rechaza, NINGÚN delta sale, la cuenta de la base queda igual y la tablet muestra la de la base`, { skip: SALTAR }, async (t) => {
    const enBase = [EJ(2), PROMO_EJ];                                                   // 2 × 21.000 + 16.800 = 58.800 (3 almuerzos juntos)
    const a = await abrir(t, ancho, conRegla(enBase)); if (!a) return;
    const { page, diag } = a;
    // La copia de la tablet es anterior: 3 almuerzos sin la línea de promo (63.000). La base rechaza el cobro por partes de una cuenta con promoción.
    await page.evaluate(() => {
      const p = Alpine.store('pos');
      const o = p.ordenes.find((x) => x.id === 'ord-abierta-3');
      o.items = [{ id: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, qty: 3, nota: 'Sopa · Pollo — Persona 1 (Camila)' }];
      o.total = 63000;
      p.productos = p.productos.map((x) => ({ ...x, promoRegla: null }));   // el catálogo de esta tablet es anterior a la regla: no la conoce (con ella, la tablet ni ofrecería partir la cuenta)
      window.__posSim.guardiaPromo = true;
    });
    await abrirHoja(page);
    assert.equal(await page.evaluate(() => Alpine.store('pos').cuentaConPromo), false, 'la tablet no ve la promo: el POS sí ofrece cobrar por partes');
    const baseAntes = JSON.stringify(await page.evaluate(() => window.__posSim.tablas.ordenes.find((x) => x.id === 'ord-abierta-3').items));
    const llamadasAntes = (await llamadasSupabase(page)).length;
    await page.getByRole('button', { name: 'Cobrar por partes' }).click();
    await page.waitForTimeout(300);
    await page.locator('.order-item input[type=checkbox]').first().click();
    const boton = ancho >= 1024 ? page.locator('.barra-partes button') : page.locator('.barra-accion button:visible').filter({ hasText: /Cobrar \$/ });
    await boton.first().click();
    await page.getByRole('button', { name: 'Sí, cobrar' }).click();
    await page.waitForFunction(() => /promoción/.test(Alpine.store('pos').aviso?.texto || ''));
    await page.waitForFunction(() => Alpine.store('pos').vista === 'orden' && Alpine.store('pos').colaDeltas.length === 0 && Alpine.store('pos').cambiosSinSubir === 0);
    await page.waitForTimeout(300);
    const texto = await aviso(page);
    assert.match(texto, /NO quedó registrado/);
    assert.match(texto, /De la cuenta no salió nada/);
    const llamadas = (await llamadasSupabase(page)).slice(llamadasAntes);
    assert.deepEqual(llamadas.filter((c) => /aplicar_delta_orden/.test(JSON.stringify(c))), [], 'ningún delta salió de la cuenta');
    assert.equal(JSON.stringify(await page.evaluate(() => window.__posSim.tablas.ordenes.find((x) => x.id === 'ord-abierta-3').items)), baseAntes, 'la cuenta de la base quedó igual');
    assert.equal(await page.evaluate(() => window.__posSim.tablas.ordenes.filter((o) => o.estado === 'cerrada' && o.parcial_de).length), 0, 'y no hay venta por partes en la base');
    const local = await page.evaluate(() => { const o = Alpine.store('pos').ordenes.find((x) => x.id === 'ord-abierta-3'); return { total: o.total, promo: o.items.some((i) => String(i.id).startsWith('promo:')), sinConfirmar: !!o.sinConfirmar, ventas: Alpine.store('pos').ordenes.filter((x) => x.estado === 'cerrada' && x.parcialDe).length }; });
    assert.deepEqual(local, { total: 58800, promo: true, sinConfirmar: false, ventas: 0 }, 'la tablet adoptó la cuenta de la base, con su línea de promo');
    assert.equal(await visible(page, '#aviso-sin-cobro'), false, 'la lectura salió bien: nada «sin confirmar»');
    assert.equal(await sinDesborde(page), 0);
    // el único error de consola es el que el POS deja al subir el cobro que la base rechazó (RS005, «promoción»)
    assert.deepEqual(diag.errores.filter((e) => !/Fallo al sincronizar ordenes \{code: RS005, message: la cuenta ord-abierta-3 tiene una promoción/.test(e)), []);
  });
}
