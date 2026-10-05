// pulido-bordes · B1, EN NAVEGADOR: el aviso de la caja (z 60) no puede tapar los botones de un diálogo abierto (z 50).
//
// Lo que halló la refutación de la integración (f32577d): desde 1024, con tres papeles de la caja «sin respuesta» (la pila medía hasta 320 px, abajo al centro) el
// aviso tapaba «Cancelar» e «Imprimir en la caja» de «¿Imprimir la precuenta en la caja?» y «Cancelar» y «Sí, cobrar» de «Generar ticket y cobrar»: 1024×768,
// 1366×768, 1280×800 y 1024×614 a 125 % de zoom (a 1422×1010 no). Los avisos van sobre los diálogos por diseño —un error de la caja tiene que verse—, pero no pueden
// tapar sus botones.
//
// La corrección: con un diálogo abierto el aviso se compacta a UNA línea («y N más»), arriba (fuera de los botones) y sin recibir toques, y los diálogos centrados le
// dejan su sitio arriba (`hay-aviso-caja-modal` en <html>). Al cerrar el diálogo el aviso vuelve a ser la pila de siempre, con sus botones.
//
// Arnés: _pos-simulado.mjs (Supabase simulado con la cola de impresión). Solo corre si hay Playwright con Chromium; si no, se salta con el motivo. Nunca toca Supabase.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';

const RAIZ = process.env.RAIZ_POS ? path.resolve(process.env.RAIZ_POS) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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

async function abrir(t, vista, [ancho, alto, escala], ajustar) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto, escala, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(90000);
    const { diag } = await abrirPos(page, { url: servidor.url, vista, ajustar, dirCache: DIR_CACHE, bloquearFuentes: true });
    return { page, diag, ctx };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador: ${String(e.message).split('\n')[0]}`);
    return null;
  }
}
const reposo = (page, ms = 250) => page.waitForTimeout(ms);
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const hace = (min) => new Date(Date.parse('2026-09-30T13:30:00-05:00') - min * 60000).toISOString();
const conCaja = (d) => { d.impresoras = [{ id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: hace(0.2), version_agente: '1.0.0' }]; };
/** La cuenta dividida con la caja en línea: confirma la precuenta de Camila, la de Andrés y la de «Persona 3», la caja no las toma y pasan los 25 s («La caja no responde»). */
async function tresSinRespuesta(page) {
  for (const [i, n] of ['Camila', 'Andrés', 'Persona 3'].entries()) {
    await boton(page, 'Imprimir la precuenta de ' + n).click();
    await page.getByRole('dialog', { name: 'Imprimir precuenta' }).waitFor();
    await boton(page, 'Imprimir en la caja').click();
    await page.waitForFunction((k) => Alpine.store('pos').cajaTrabajos.length === k && !Alpine.store('pos').cajaEnviando, i + 1);
  }
  await page.evaluate(() => { Alpine.store('pos').cajaTrabajos.forEach((e) => { e.sinRespuesta = true; }); });
  await page.locator('.toast-impresion-fila').nth(2).waitFor();
  await reposo(page);
}

// Los tamaños del hallazgo: donde el aviso tapaba (1024×768, 1366×768, 1280×800, 1024×614 a 125 %) y donde no (1422×1010), más 1920×1080 y una tablet vertical.
const TAMANOS = [[1024, 768], [1366, 768], [1280, 800], [1024, 614, 1.25], [1422, 1010], [1920, 1080], [820, 1180]];

/** Lo que pasa con el aviso y los botones del pie del diálogo abierto: caja del aviso, caja del diálogo, y si el centro de cada botón recibe el toque. */
const medir = (page) => page.evaluate(() => {
  const fondo = [...document.querySelectorAll('.modal-backdrop')].find((m) => m.getClientRects().length && getComputedStyle(m).display !== 'none');
  const toast = document.querySelector('.toast-impresion');
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
  const caja = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, alto: r.height }; };
  const filas = [...document.querySelectorAll('.toast-impresion-fila')].filter(visible);
  const salida = { aviso: visible(toast) ? caja(toast) : null, filas: filas.length, compacto: !!toast && toast.classList.contains('compacto'), clase: document.documentElement.classList.contains('hay-aviso-caja-modal'), mas: visible(document.querySelector('.toast-impresion-mas')) ? document.querySelector('.toast-impresion-mas').textContent.trim() : '', ventana: innerHeight, textoFila: filas[0] ? filas[0].textContent.replace(/\s+/g, ' ').trim() : '' };
  if (fondo) {
    const dlg = fondo.querySelector('.modal');
    salida.dialogo = caja(dlg);
    salida.botones = [...fondo.querySelectorAll('.modal-footer button, .modal-header button')].filter(visible).map((b) => {
      const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { texto: (b.getAttribute('aria-label') || b.textContent).replace(/\s+/g, ' ').trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right, recibe: b === e || b.contains(e) };
    });
  }
  // los botones del aviso (los que desaparecen al compactarlo)
  salida.botonesAviso = [...document.querySelectorAll('.toast-impresion .toast-impresion-btn, .toast-impresion .toast-impresion-cerrar')].filter(visible).length;
  return salida;
});
const cruza = (a, b) => a && b && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5 && a.left < b.right - 0.5 && a.right > b.left + 0.5;

for (const tam of TAMANOS) {
  const [ancho, alto, escala] = tam;
  const donde = `${ancho}×${alto}${escala ? ` (zoom ${Math.round(escala * 100)} %)` : ''}`;
  test(`${donde}: con tres papeles de la caja SIN RESPUESTA y un diálogo abierto (la pregunta de la precuenta y el cobro) el aviso es UNA línea con «y N más», no se cruza con el diálogo y todos sus botones reciben el toque; al cerrarlo, vuelve la pila entera`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden-personas', tam, conCaja); if (!a) return;
    const { page, diag } = a;
    await tresSinRespuesta(page);
    // Tres papeles en cola y sin respuesta. Sin diálogo: la pila entera y con sus botones («Imprimir aquí», X).
    const sin = await medir(page);
    assert.equal(sin.compacto, false);
    assert.equal(sin.clase, false);
    assert.equal(sin.filas, 3, `sin diálogo el aviso trae sus tres filas (${sin.filas})`);
    assert.ok(sin.botonesAviso >= 3, `y sus botones («Imprimir aquí», la X): ${sin.botonesAviso}`);
    for (const abrirDialogo of [
      // (los diálogos se abren por el store: bajo 1024 la pila entera, arriba, tapa los botones de la propia cuenta —eso no es de esta prueba—)
      { nombre: 'la pregunta de la precuenta', abrir: async () => { await page.evaluate(() => Alpine.store('pos').pedirImpresion('precuenta')); await page.getByRole('dialog', { name: 'Imprimir precuenta' }).waitFor(); }, botones: ['Cancelar', 'Imprimir en la caja'] },
      { nombre: 'el cobro (Sí, cobrar)', abrir: async () => { await page.evaluate(() => { Alpine.store('pos').modalConfirmFactura = true; }); await boton(page, 'Sí, cobrar').waitFor(); }, botones: ['Cancelar', 'Sí, cobrar'] },
    ]) {
      await abrirDialogo.abrir();
      await reposo(page);
      const m = await medir(page);
      assert.equal(m.compacto, true, `${abrirDialogo.nombre}: el aviso se compacta`);
      assert.equal(m.clase, true, '<html> lleva hay-aviso-caja-modal');
      assert.equal(m.filas, 1, `${abrirDialogo.nombre}: UNA sola fila`);
      assert.equal(m.mas, 'y 2 más', `${abrirDialogo.nombre}: dice cuántos hay detrás («${m.mas}»)`);
      assert.ok(m.aviso.alto <= 64, `${abrirDialogo.nombre}: la línea mide ${m.aviso.alto.toFixed(0)} px (antes la pila medía hasta 320)`);
      assert.equal(m.botonesAviso, 0, 'los botones del aviso no se ven mientras tanto (vuelven al cerrar el diálogo)');
      assert.ok(m.aviso.top < 40 && m.aviso.bottom < m.ventana / 2, `la línea va arriba (${m.aviso.top.toFixed(0)}–${m.aviso.bottom.toFixed(0)})`);
      assert.equal(cruza(m.aviso, m.dialogo), false, `${abrirDialogo.nombre}: el aviso (${m.aviso.top.toFixed(0)}–${m.aviso.bottom.toFixed(0)}) no se cruza con el diálogo (${m.dialogo.top.toFixed(0)}–${m.dialogo.bottom.toFixed(0)})`);
      for (const nombre of abrirDialogo.botones) {
        const b = m.botones.find((x) => x.texto === nombre);
        assert.ok(b, `${abrirDialogo.nombre}: hay un botón «${nombre}» (${m.botones.map((x) => x.texto).join(' / ')})`);
        assert.equal(b.recibe, true, `${abrirDialogo.nombre}: «${nombre}» (${b.top.toFixed(0)}–${b.bottom.toFixed(0)}) recibe el toque`);
        assert.equal(cruza(m.aviso, b), false, `${abrirDialogo.nombre}: el aviso no tapa «${nombre}»`);
      }
      assert.ok(m.botones.every((b) => b.recibe), `${abrirDialogo.nombre}: ningún botón del diálogo queda tapado: ${JSON.stringify(m.botones.filter((b) => !b.recibe).map((b) => b.texto))}`);
      assert.ok(m.dialogo.bottom <= m.ventana && m.dialogo.top >= 0, `el diálogo cabe en la ventana (${m.dialogo.top.toFixed(0)}–${m.dialogo.bottom.toFixed(0)} de ${m.ventana})`);
      await page.keyboard.press('Escape');
      await reposo(page);
    }
    // Sin diálogo otra vez: la pila entera, con sus botones.
    const despues = await medir(page);
    assert.equal(despues.compacto, false);
    assert.equal(despues.clase, false, 'y la clase de <html> se va');
    assert.ok(despues.filas === 3 && despues.botonesAviso >= 3, 'los botones del aviso vuelven');
    assert.deepEqual(diag.errores.filter((e) => !/AudioContext/.test(e)), [], 'sin errores propios (el AudioContext sin dispositivo de audio de un Chromium sin cabeza no cuenta)');
  });
}

test('390×844 (hoja inferior): la línea compacta va arriba y el pie de la hoja (sus botones) queda libre; con la pila entera y un solo papel, nada cambia', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas', [390, 844], conCaja); if (!a) return;
  const { page } = a;
  await tresSinRespuesta(page);
  await page.evaluate(() => Alpine.store('pos').pedirImpresion('precuenta'));
  await page.getByRole('dialog', { name: 'Imprimir precuenta' }).waitFor();
  await reposo(page);
  const m = await medir(page);
  assert.equal(m.compacto, true);
  assert.equal(m.filas, 1);
  assert.ok(m.aviso.top < 40 && m.aviso.alto <= 64, `la línea va arriba (${m.aviso.top.toFixed(0)}, ${m.aviso.alto.toFixed(0)} px)`);
  for (const b of m.botones) assert.equal(b.recibe && !cruza(m.aviso, b), true, `«${b.texto}» (${b.top.toFixed(0)}–${b.bottom.toFixed(0)}) libre de la línea (${m.aviso.top.toFixed(0)}–${m.aviso.bottom.toFixed(0)})`);
  await page.keyboard.press('Escape');
  await reposo(page);
  assert.equal((await medir(page)).compacto, false);
});

test('con UN solo papel y un diálogo abierto el aviso también va en una línea, sin «y N más»', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'caja-estado-cola', [1280, 800]); if (!a) return;
  const { page } = a;
  await page.locator('.toast-impresion-fila').first().waitFor();
  await page.evaluate(() => { Alpine.store('pos').modalConfirmFactura = true; });
  await boton(page, 'Sí, cobrar').waitFor();
  await reposo(page);
  const m = await medir(page);
  assert.equal(m.compacto, true);
  assert.equal(m.filas, 1);
  assert.equal(m.mas, '', 'con uno solo no hay «y N más»');
  assert.equal(cruza(m.aviso, m.dialogo), false);
  assert.ok(m.botones.every((b) => b.recibe && !cruza(m.aviso, b)));
});

test('el ticket «dudoso» de un cobro: sin diálogo, su aviso ofrece «Imprimir desde este teléfono»; con un diálogo abierto se compacta; al tocar el botón sale la orden CONFIRMADA', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'caja-ticket-dudoso', [1280, 800]); if (!a) return;
  const { page } = a;
  const fila = page.locator('.toast-impresion-fila').first();
  assert.match(await fila.innerText(), /Ticket · Mesa 3/);
  assert.match(await fila.innerText(), /No hubo respuesta de la caja\. Si el ticket llegó, sale allí/);
  const imprimir = page.getByRole('button', { name: 'Imprimir desde este teléfono', exact: true });
  assert.equal(await imprimir.isVisible(), true, '«Imprimir desde este teléfono» se ve en la fila');
  assert.ok((await imprimir.boundingBox()).height >= 44, 'y mide 44 px');
  assert.equal(await page.getByRole('button', { name: 'Cerrar este aviso', exact: true }).count() > 0, true, 'con su ✕ (cerrarlo solo lo deja de mostrar)');
  // Con un diálogo abierto: una línea, y el botón no se ve (ni tapa nada).
  await page.evaluate(() => { Alpine.store('pos').modalConfirmFactura = true; });
  await boton(page, 'Sí, cobrar').waitFor();
  await reposo(page);
  const m = await medir(page);
  assert.equal(m.compacto, true);
  assert.equal(await imprimir.isVisible(), false);
  assert.ok(m.botones.every((b) => b.recibe && !cruza(m.aviso, b)));
  await page.keyboard.press('Escape');
  await reposo(page);
  // Tocarlo: la orden confirmada vuelve a la pantalla (la del ticket) y se pide la impresión del teléfono.
  await imprimir.click();
  await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
  assert.equal(await page.evaluate(() => Alpine.store('pos').ordenTicket.estado), 'cerrada', 'es la orden cerrada que se cobró');
  await page.waitForFunction(() => (window.__posImpresiones || 0) >= 1);
  assert.equal(await page.locator('.toast-impresion-fila').count(), 0, 'y el aviso se va');
});
