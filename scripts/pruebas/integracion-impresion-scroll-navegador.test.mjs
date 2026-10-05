// Integración de `impresion-defecto` (imprimir siempre a la caja con confirmación, precuenta por persona) con `escritorio-scroll` (la cuenta en
// escritorio con un solo criterio de altura, piso de tres renglones y el total pegado abajo), EN NAVEGADOR. Ninguna de las dos pruebas de origen
// mira a la otra rama: cada una pasa sola y git mezcla sin marcar nada. Lo que sigue son los cruces que solo se ven con las dos puestas:
//
//   1. La fila de personas (una línea desde 768 px, con «Precuenta» y «Cobrar») vive FUERA de la rejilla de altura fija: pesa en `--orden-ocupado`, no
//      en el piso. Con la fila, su detalle abierto y nombres de 24 letras, la rejilla sigue midiendo max(piso, ventana − ocupado), la página no
//      crece al bajar y «Generar ticket y cobrar» queda entero a la vista y sin nada encima (1024×768, 1280×800 y 1422×1010).
//   2. La pregunta «¿Imprimir la precuenta … en la caja?» es un diálogo fijo (z 50): queda entero en la ventana, por encima de la tarjeta del total
//      pegada abajo (z 2), con sus botones como lo primero que recibe el toque, también con la página bajada; y no mueve nada de la cuenta.
//      Y el aviso «En cola…» que sigue (va sobre todo) no tapa el centro del botón de cobro.
//   3. «Cobrar por partes» con la cuenta dividida desde 1024: la carta no se muestra, «Precuenta» sigue a mano en cada fila (sin «Cobrar») y el
//      abono entero a la vista.
//   4. A 390 px: la fila de dos líneas con «Precuenta» y «Cobrar» mitad y mitad; la pregunta es una hoja inferior que cubre la barra de cobro fija; con
//      «Cobrar por partes», «Precuenta» a todo el ancho.
//   5. El aviso de versión nueva NO recarga encima de la pregunta de imprimir abierta (`_hayModalAbierto`; el caso de lógica está en version-aviso.test.mjs).
//
// Solo corre con Playwright y Chromium; si no, se salta con el motivo. Nunca toca Supabase (arnés de _pos-simulado.mjs, datos ficticios).
'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR_CACHE = path.join(os.tmpdir(), 'resplandor-pos-cdn');
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

const ESCRITORIO = [[1024, 768], [1280, 800], [1422, 1010]];
const hace = (min) => new Date(Date.parse('2026-09-30T13:30:00-05:00') - min * 60000).toISOString();
const conCaja = (d) => { d.impresoras = [{ id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: hace(0.2), version_agente: '1.0.0' }]; };
const reposo = (page, ms = 350) => page.waitForTimeout(ms);
const cerca = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

async function abrir({ ancho, alto, vista, ajustar = conCaja }) {
  const contexto = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
  const page = await contexto.newPage();
  page.setDefaultTimeout(60000);
  const { diag } = await abrirPos(page, { url: servidor.url, vista, ajustar, dirCache: DIR_CACHE, bloquearFuentes: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await reposo(page);
  return { page, contexto, diag };
}

/** Lo que cuenta de la altura de la cuenta y del botón de cobro, de una vez. */
const medir = (page) => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const r = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, alto: b.height }; };
  const rej = document.querySelector('.vista-orden > .orden-rejilla');
  const tarjeta = document.querySelector('.split-personas');
  const barra = document.querySelector('.barra-accion');
  const btn = [...barra.querySelectorAll('.btn-primary')].find(vis);
  const bb = btn ? btn.getBoundingClientRect() : null;
  return {
    ventana: innerHeight, documento: document.documentElement.scrollHeight, scrollY: Math.round(scrollY),
    rejilla: r(rej), personas: vis(tarjeta) ? r(tarjeta) : null, personasEnRejilla: tarjeta ? rej.contains(tarjeta) : null,
    piso: parseFloat(rej.style.getPropertyValue('--orden-piso')), ocupado: parseFloat(rej.style.getPropertyValue('--orden-ocupado')),
    total: vis(barra) ? r(barra) : null, pie: r(document.querySelector('footer.pos-pie')),
    aire: parseFloat(getComputedStyle(document.querySelector('.vista-orden')).paddingBottom),
    carta: (() => { const c = document.querySelector('.carta-panel'); return c ? getComputedStyle(c).display : null; })(),
    abono: (() => { const a = document.querySelector('.bloque-monto'); return vis(a) ? r(a) : null; })(),
    boton: bb ? { top: bb.top, bottom: bb.bottom, libre: btn.contains(document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2)) } : null,
  };
});
const alFinal = async (page) => {
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollTo(0, 1e5)); await reposo(page, 150); }
  return medir(page);
};
/** ¿Lo primero que recibe el toque en el centro de este elemento es él (o algo suyo)? */
const recibeElToque = (loc) => loc.evaluate((b) => { const x = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2)); });
const precuentaDe = (page, nombre) => page.getByRole('button', { name: `Imprimir la precuenta de ${nombre}`, exact: true });
const dialogo = (page) => page.getByRole('dialog', { name: 'Imprimir precuenta' });

// ═════════════════ 1. La fila de personas dentro del criterio de altura de la cuenta ═════════════════

for (const [ancho, alto] of ESCRITORIO) {
  for (const vista of ['orden-personas', 'orden-personas-largas']) {
    test(`${ancho}×${alto}, ${vista}: la fila de una línea con «Precuenta» y «Cobrar» pesa en lo ocupado, no en el piso; la rejilla vale max(piso, ventana − ocupado) y la página no crece al bajar`, saltar, async () => {
      const { page, contexto, diag } = await abrir({ ancho, alto, vista });
      try {
        const m0 = await medir(page);
        assert.equal(m0.personasEnRejilla, false, 'la tarjeta de personas está ENCIMA de la rejilla de altura fija, no dentro');
        // Una línea por persona (53 px): las dos de la fila vieja se quedaron en el teléfono.
        const filas = page.locator('.persona-split');
        assert.equal(await filas.count(), 3);
        for (let i = 0; i < 3; i++) {
          const f = filas.nth(i);
          const caja = await f.boundingBox();
          assert.ok(caja.height <= 60, `fila ${i + 1}: ${caja.height.toFixed(0)} px (una sola línea, no dos)`);
          for (const b of [f.getByRole('button', { name: /^Imprimir la precuenta de / }), f.getByRole('button', { name: /^Cobrar a / })]) {
            const bb = await b.boundingBox();
            assert.ok(bb.height >= 43.5, `fila ${i + 1}: botones de 44 px`);
            assert.ok(bb.x + bb.width <= m0.personas.right + 0.5, `fila ${i + 1}: nada se sale de la tarjeta`);
            assert.equal(await recibeElToque(b), true, `fila ${i + 1}: el botón recibe el toque (no lo tapa nada)`);
          }
        }
        // La regla de la cuenta con la fila de personas puesta.
        const disp = m0.ventana - m0.rejilla.top - m0.aire - m0.pie.alto;
        assert.ok(m0.rejilla.alto >= disp - 1.5, `la rejilla mide ${m0.rejilla.alto.toFixed(1)} y le quedan ${disp.toFixed(1)}`);
        assert.ok(m0.rejilla.alto >= m0.piso - 1.5, `y nunca menos que su piso (${m0.piso})`);
        const crece = m0.rejilla.alto > disp + 1.5;
        assert.equal(m0.documento > m0.ventana, crece, 'la página baja solo si el piso no cabe en la ventana');
        assert.ok(m0.boton.top >= 0 && m0.boton.bottom <= m0.ventana && m0.boton.libre, `«Generar ticket y cobrar» entero a la vista y libre (${m0.boton.top.toFixed(0)}–${m0.boton.bottom.toFixed(0)} de ${m0.ventana})`);
        assert.ok(m0.total.bottom <= m0.ventana + 0.5, 'el total, pegado al borde de abajo');
        const fin = await alFinal(page);
        assert.equal(fin.documento, m0.documento, 'la página no crece al bajar');
        assert.ok(cerca(fin.rejilla.alto, m0.rejilla.alto, 0.5), 'ni la rejilla cambia de alto');
        assert.ok(fin.boton.top >= 0 && fin.boton.bottom <= fin.ventana && fin.boton.libre, 'con la página al final el botón sigue entero y libre');
        // El detalle de una persona abre DEBAJO de sus botones y se suma a lo ocupado: la página sigue sin crecer al bajar y el botón sigue a la vista.
        await page.evaluate(() => window.scrollTo(0, 0));
        await filas.nth(0).locator('.persona-meta').click();
        await reposo(page, 500);
        const detalle = await filas.nth(0).locator('.persona-detalle').boundingBox();
        const acciones = await filas.nth(0).locator('.persona-split-acciones').boundingBox();
        assert.ok(detalle.y >= acciones.y + acciones.height - 0.5, 'el detalle abre debajo de los botones');
        const m1 = await medir(page);
        assert.ok(m1.ocupado > m0.ocupado + 20, `lo ocupado se vuelve a medir con el detalle abierto (${m0.ocupado} → ${m1.ocupado})`);
        const disp1 = m1.ventana - m1.rejilla.top - m1.aire - m1.pie.alto;
        assert.ok(m1.rejilla.alto >= disp1 - 1.5 && m1.rejilla.alto >= m1.piso - 1.5, `con el detalle abierto la rejilla (${m1.rejilla.alto.toFixed(1)}) sigue siendo max(piso ${m1.piso}, ${disp1.toFixed(1)})`);
        const fin1 = await alFinal(page);
        assert.equal(fin1.documento, m1.documento, 'con el detalle abierto, la página tampoco crece al bajar');
        assert.ok(fin1.boton.top >= 0 && fin1.boton.bottom <= fin1.ventana && fin1.boton.libre, 'y con la página al final el botón sigue a la vista');
        assert.deepEqual(diag.errores, []);
      } finally { await contexto.close(); }
    });
  }
}

// ═════════════════ 2. La pregunta de imprimir frente al total pegado abajo ═════════════════

for (const [ancho, alto] of ESCRITORIO) {
  for (const [nombre, vista, abrirPregunta] of [
    ['la precuenta de toda la cuenta (carta larga)', 'orden-larga', (page) => page.getByRole('button', { name: 'Imprimir precuenta', exact: true }).click()],
    ['la precuenta de Camila (cuenta dividida)', 'orden-personas', (page) => precuentaDe(page, 'Camila').click()],
  ]) {
    test(`${ancho}×${alto}, ${nombre}: la pregunta queda entera en la ventana por encima del total pegado, sus botones reciben el toque y la cuenta no se mueve; el aviso «En cola…» no tapa el botón de cobro`, saltar, async () => {
      const { page, contexto, diag } = await abrir({ ancho, alto, vista });
      try {
        // Con la página bajada a media altura (si baja): la pregunta es fija, no sigue al scroll.
        const antes = await medir(page);
        await page.evaluate(() => window.scrollTo(0, Math.floor((document.documentElement.scrollHeight - innerHeight) / 2)));
        await reposo(page, 200);
        const y = await page.evaluate(() => Math.round(scrollY));
        await abrirPregunta(page);
        await dialogo(page).waitFor();
        await reposo(page, 250);
        const caja = await dialogo(page).boundingBox();
        assert.ok(caja.x >= 0 && caja.x + caja.width <= ancho && caja.y >= 0 && caja.y + caja.height <= alto, `la pregunta cabe en la ventana (${JSON.stringify(caja)})`);
        assert.ok(cerca(caja.y + caja.height / 2, alto / 2, 40) && cerca(caja.x + caja.width / 2, ancho / 2, 2), 'y va centrada: un diálogo desde 768 px');
        const pie = dialogo(page).locator('.modal-footer button:visible');
        assert.equal(await pie.count(), 2);
        for (let i = 0; i < 2; i++) assert.equal(await recibeElToque(pie.nth(i)), true, `el botón ${i + 1} de la pregunta recibe el toque`);
        const ahora = await page.evaluate(() => {
          const t = document.querySelector('.col-pedido > .barra-accion'); const b = t.getBoundingClientRect(); const fondo = document.querySelector('#modal-imprimir-titulo').closest('.modal-backdrop');
          return { scrollY: Math.round(scrollY), documento: document.documentElement.scrollHeight, totalTapado: fondo.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)), zFondo: +getComputedStyle(fondo).zIndex, zTotal: +getComputedStyle(t).zIndex };
        });
        assert.equal(ahora.totalTapado, true, 'el fondo de la pregunta cubre la tarjeta del total (nada del total recibe el toque mientras se pregunta)');
        assert.ok(ahora.zFondo > ahora.zTotal, `el diálogo (z ${ahora.zFondo}) está por encima del total pegado (z ${ahora.zTotal})`);
        assert.equal(ahora.scrollY, y, 'abrir la pregunta no mueve la página');
        assert.equal(ahora.documento, antes.documento, 'ni cambia su alto');
        // Cancelar la cierra y deja la cuenta como estaba.
        await dialogo(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
        await dialogo(page).waitFor({ state: 'hidden' });
        // Confirmar: sale a la caja y el aviso «En cola…» (va sobre todo) deja libre el centro del botón de cobro.
        await page.evaluate(() => window.scrollTo(0, 0));
        await abrirPregunta(page);
        await dialogo(page).getByRole('button', { name: 'Imprimir en la caja', exact: true }).click();
        await page.locator('.toast-impresion-fila').first().waitFor();
        await reposo(page, 300);
        const m = await medir(page);
        assert.equal(m.documento, antes.documento, 'el aviso no cambia el alto de la página');
        assert.ok(m.boton.libre, 'con el aviso a la vista el centro de «Generar ticket y cobrar» recibe el toque (el aviso solo tapa el lado izquierdo de la tarjeta)');
        assert.deepEqual(diag.errores, []);
      } finally { await contexto.close(); }
    });
  }
}

// ═════════════════ 3. «Cobrar por partes» con la cuenta dividida, desde 1024 ═════════════════

for (const [ancho, alto] of ESCRITORIO) {
  test(`${ancho}×${alto}, «Cobrar por partes» con la cuenta dividida: sin carta, «Precuenta» sin «Cobrar» en cada fila y a mano, el abono entero y la página sin crecer al bajar`, saltar, async () => {
    const { page, contexto, diag } = await abrir({ ancho, alto, vista: 'orden-personas' });
    try {
      await page.evaluate(() => { const p = Alpine.store('pos'); p.toggleModoCobroParcial(); p.toggleSeleccionItem(p.ordenActiva.items[0].id); });
      await reposo(page, 500);
      const m0 = await medir(page);
      assert.equal(m0.carta, 'none', 'la carta no se muestra (decisión de escritorio-scroll, también con los botones de precuenta)');
      assert.equal(await page.getByRole('button', { name: /^Cobrar a /, includeHidden: false }).count(), 0, 'sin «Cobrar» por persona mientras dura el cobro por partes');
      const filas = page.locator('.persona-split');
      for (let i = 0; i < 3; i++) {
        const b = filas.nth(i).getByRole('button', { name: /^Imprimir la precuenta de / });
        assert.ok((await b.boundingBox()).height >= 43.5, `fila ${i + 1}: «Precuenta» de 44 px`);
        assert.equal(await recibeElToque(b), true, `fila ${i + 1}: «Precuenta» recibe el toque`);
      }
      assert.ok(m0.abono && m0.abono.bottom <= m0.rejilla.bottom + 0.5, 'el abono («Recibir…») cabe entero en la rejilla, sin scroll propio');
      const fin = await alFinal(page);
      assert.equal(fin.documento, m0.documento, 'la página no crece al bajar');
      assert.ok(fin.total.bottom <= fin.ventana + 0.5, 'el total, pegado al borde de abajo');
      // «Precuenta» pregunta lo de esa persona aunque la carta no esté.
      await page.evaluate(() => window.scrollTo(0, 0));
      await precuentaDe(page, 'Andrés').click();
      await dialogo(page).waitFor();
      assert.match(await dialogo(page).innerText(), /¿Imprimir la precuenta de Andrés en la caja\?/);
      await dialogo(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.deepEqual(diag.errores, []);
    } finally { await contexto.close(); }
  });
}

// ═════════════════ 4. A 390 px: la fila de dos líneas, la hoja inferior sobre la barra de cobro y el cobro por partes ═════════════════

test('390 px, cuenta dividida: la fila es de dos líneas con «Precuenta» y «Cobrar» mitad y mitad; la pregunta es una hoja inferior que cubre la barra de cobro fija; con «Cobrar por partes», «Precuenta» a todo el ancho', saltar, async () => {
  const { page, contexto, diag } = await abrir({ ancho: 390, alto: 844, vista: 'orden-personas' });
  try {
    const f = page.locator('.persona-split').nth(0);
    const fila = await f.boundingBox();
    const prec = await f.getByRole('button', { name: /^Imprimir la precuenta de / }).boundingBox();
    const cobrar = await f.getByRole('button', { name: /^Cobrar a / }).boundingBox();
    assert.ok(fila.height >= 100, `la fila mide ${fila.height.toFixed(0)} px: dos líneas`);
    assert.ok(cerca(prec.y, cobrar.y, 1) && cerca(prec.width, cobrar.width, 1) && prec.height >= 43.5, 'los dos botones en la misma línea, mitad y mitad, de 44 px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde horizontal');
    await precuentaDe(page, 'Camila').click();
    await dialogo(page).waitFor();
    await reposo(page, 250);
    const caja = await dialogo(page).boundingBox();
    assert.ok(cerca(caja.y + caja.height, 844, 1), 'la pregunta es una hoja inferior, pegada al pie');
    const barra = await page.evaluate(() => {
      const b = document.querySelector('.barra-accion .btn-primary').getBoundingClientRect(); const fondo = document.querySelector('#modal-imprimir-titulo').closest('.modal-backdrop');
      return { cubierta: fondo.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)), fija: getComputedStyle(document.querySelector('.col-pedido')).position };
    });
    assert.equal(barra.fija, 'fixed', 'a 390 la hoja del pedido, con la barra de cobro de pie, es la fija (hallazgos-domingo; el sticky de escritorio no entra)');
    assert.equal(barra.cubierta, true, 'y la hoja la cubre: el toque en «Cobrar» no se cuela detrás de la pregunta');
    for (const b of await dialogo(page).locator('.modal-footer button:visible').all()) assert.equal(await recibeElToque(b), true);
    await dialogo(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.evaluate(() => { const p = Alpine.store('pos'); p.toggleModoCobroParcial(); });
    await reposo(page, 300);
    const g = page.locator('.persona-split').nth(0);
    assert.equal(await g.getByRole('button', { name: /^Cobrar a / }).count(), 0, 'sin «Cobrar» mientras dura el cobro por partes');
    const solo = await g.getByRole('button', { name: /^Imprimir la precuenta de / }).boundingBox();
    const interior = await g.boundingBox();
    assert.ok(solo.width >= interior.width - 2, `«Precuenta» ocupa todo el ancho de la fila (${solo.width.toFixed(0)} de ${interior.width.toFixed(0)})`);
    assert.deepEqual(diag.errores, []);
  } finally { await contexto.close(); }
});

// ═════════════════ 5. «Recargar» no borra la pregunta abierta ═════════════════

for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
  test(`${ancho} px: con la pregunta de imprimir abierta, una versión nueva y «Recargar» NO recargan la página: la pregunta sigue ahí y el aviso queda en «lista para recargar»`, saltar, async () => {
    const { page, contexto, diag } = await abrir({ ancho, alto, vista: 'orden' });
    try {
      await page.route(/\/version\.json(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '2099.01.01-abcdef0', fecha: '2099-01-01', huella: 'x' }) }));
      await page.evaluate(() => Alpine.store('pos').buscarVersionAhora());
      await page.locator('.aviso-version').waitFor();
      await page.getByRole('button', { name: 'Imprimir precuenta', exact: true }).click();
      await dialogo(page).waitFor();
      await page.evaluate(() => { window.__marca = 'misma-pagina'; });
      // «Recargar» del aviso es la acción del store (el diálogo, al ser modal, tapa la franja): baja el documento y decide.
      await page.evaluate(() => Alpine.store('pos').recargarVersionNueva());
      await reposo(page, 400);
      assert.equal(await page.evaluate(() => window.__marca), 'misma-pagina', 'la página NO se recargó');
      assert.equal(await dialogo(page).isVisible(), true, 'la pregunta sigue abierta');
      assert.equal(await page.evaluate(() => Alpine.store('pos').versionListaParaRecargar), true, 'el aviso queda listo para que la persona recargue cuando termine');
      assert.deepEqual(diag.errores, []);
    } finally { await contexto.close(); }
  });
}
