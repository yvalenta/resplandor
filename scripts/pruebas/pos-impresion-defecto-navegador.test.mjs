// Imprimir SIEMPRE a la caja, con una confirmación, y la precuenta por persona (tarea/impresion-defecto), EN NAVEGADOR: la pantalla se comporta
// como promete con el arnés (Supabase simulado con la cola de impresión y un «agente» que cambia el estado a mano; scripts/pruebas/_pos-simulado.mjs).
// La lógica (vm) está en pos-impresion-defecto.test.mjs; los flujos viejos que cambiaron, en pos-impresion-caja-navegador.test.mjs. Solo corre si hay
// Playwright con Chromium; si no, se salta con el motivo. Nunca toca Supabase.
//
//   1. La confirmación  aparece al tocar, cabe a 390 (hoja inferior) y a 1280 (diálogo), sus botones miden 44 px y nada sale hasta confirmar
//   2. La fila          dos líneas a 390 (nombre y total; «Precuenta» y «Cobrar» mitad y mitad) y una a 1280, con nombres de 24 letras y totales de
//                       siete cifras a 320, 360, 390 y 1280: sin desborde, sin nada cortado, siempre 44 px
//   3. La precuenta     de una persona: va a la caja con SOLO sus líneas (sin abrir la impresión del teléfono), «En cola…» apaga su botón y solo
//                       el suyo; sin la cola sale del teléfono con «PRECUENTA — no es un cobro» y «Cuenta de Camila · Mesa 3», igual que el papel de la caja
//   4. Cobrar por partes mientras dura, no hay «Cobrar» y la precuenta toma todo el ancho
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

async function abrir(t, vista, ancho, opciones = {}) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const alto = { 320: 640, 360: 780, 390: 844 }[ancho] || 900;
    const ctx = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const { diag } = await abrirPos(page, { url: servidor.url, vista, dirCache: DIR_CACHE, ...opciones });
    return { page, diag, ctx, ancho, alto };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}
const reposo = (page) => page.waitForTimeout(200);
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const dialogo = (page, nombre = /^Imprimir (precuenta|ticket)$/) => page.getByRole('dialog', { name: nombre });
const limpio = (x) => String(x).replace(/\s+/g, ' ').trim();
const impresiones = (page) => page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.insert' && l.tabla === 'impresiones').map((l) => l.carga));
const conteoPrint = (page) => page.evaluate(() => window.__posImpresiones || 0);
const filas = (page) => page.locator('.persona-split');
const hace = (min) => new Date(Date.parse('2026-09-30T13:30:00-05:00') - min * 60000).toISOString();
const conCaja = (extra = {}) => (d) => { d.impresoras = [{ id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: hace(0.2), version_agente: '1.0.0', ...extra }]; };
const textos = (loc) => loc.allInnerTexts().then((l) => l.map(limpio));

// Lo peor que debe caber en la fila: nombres de 24 letras y totales de siete cifras (arnés: orden-personas-largas).
const NOMBRES_LARGOS = ['Maria Fernanda Rodriguez', 'Juanchoanchoanchoancho', 'Persona 3'];

// ═════════════════════════ 1. La confirmación ═════════════════════════

for (const ancho of [390, 1280]) {
  test(`confirmación (${ancho} px): al tocar «Imprimir precuenta» pregunta, cabe, sus botones miden 44 px, nada sale sin confirmar y «Imprimir en la caja» manda a la caja sin abrir el teléfono`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden', ancho, { ajustar: conCaja() }); if (!a) return;
    const { page } = a;
    assert.equal(await dialogo(page).isVisible(), false);
    await boton(page, 'Imprimir precuenta').click();
    const modal = dialogo(page);
    await modal.waitFor();
    assert.match(limpio(await modal.innerText()), /¿Imprimir la precuenta en la caja\?/);
    const caja = await modal.boundingBox();
    assert.ok(caja.x >= -0.5 && caja.x + caja.width <= ancho + 0.5, `${ancho}: cabe a lo ancho`);
    assert.ok(caja.y >= 0 && caja.y + caja.height <= a.alto + 0.5, `${ancho}: cabe a lo alto`);
    if (ancho < 768) assert.ok(Math.abs((caja.y + caja.height) - a.alto) <= 1, '390: es la hoja inferior (pegada al pie)');
    else assert.ok(caja.y > 20 && caja.x > 100, '1280: un diálogo centrado');
    for (const b of await modal.locator('button:visible').all()) assert.ok((await b.boundingBox()).height >= 43.5, `${ancho}: botones de 44 px`);
    const pie = await modal.locator('.modal-footer button:visible').evaluateAll((l) => l.map((b) => ({ texto: b.textContent.replace(/\s+/g, ' ').trim(), clases: b.className })));
    assert.deepEqual(pie.map((p) => p.texto), ['Cancelar', 'Imprimir en la caja']);
    assert.match(pie[1].clases, /btn-primary/);
    assert.match(pie[0].clases, /btn-secondary/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde horizontal');
    assert.deepEqual(await impresiones(page), [], 'nada sale sin confirmar');
    assert.equal(await conteoPrint(page), 0);
    await boton(page, 'Imprimir en la caja').click();
    await page.locator('.toast-impresion-fila').first().waitFor();
    assert.equal((await impresiones(page)).length, 1, 'un trabajo');
    assert.equal(await conteoPrint(page), 0, 'con la caja en línea NO se abre la impresión del teléfono');
    assert.equal(await dialogo(page).isVisible(), false);
    assert.deepEqual(a.diag.errores, []);
  });
}

test('confirmación (390 px): la de emergencia (caja registrada sin latir) dice la última señal y «Imprimir aquí»; y la del ticket dice «el ticket»', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'caja-confirma-emergencia', 390); if (!a) return;
  const { page } = a;
  assert.match(limpio(await dialogo(page).innerText()), /La caja no está en línea \(última señal hace 7 min\)\. Se imprime desde este teléfono\./);
  assert.deepEqual((await dialogo(page).locator('.modal-footer button:visible').allInnerTexts()).map(limpio), ['Cancelar', 'Imprimir aquí']);
  assert.equal(await conteoPrint(page), 0);
  const b = await abrir(t, 'caja-confirma-ticket', 390); if (!b) return;
  assert.match(limpio(await dialogo(b.page, 'Imprimir ticket').innerText()), /¿Imprimir el ticket en la caja\?/);
  assert.deepEqual(await impresiones(b.page), [], 'nada sale sin confirmar');
});

// ═════════════════════════ 2. La fila ═════════════════════════

for (const ancho of [320, 360, 390, 1280]) {
  test(`fila (${ancho} px): con nombres de 24 letras y totales de siete cifras nada se corta ni desborda, los botones miden 44 px y el detalle abre debajo de ellos`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden-personas-largas', ancho); if (!a) return;
    const { page } = a;
    assert.deepEqual(await textos(page.locator('.persona-nombre-txt')), NOMBRES_LARGOS, 'los nombres, enteros');
    assert.deepEqual(await textos(page.locator('.persona-meta')), ['$ 1.266.000', '$ 2.300.000', '$ 18.000'], 'los totales, enteros');
    const medidas = await page.evaluate(() => [...document.querySelectorAll('.persona-split')].map((f) => {
      const txt = f.querySelector('.persona-nombre-txt'); const meta = f.querySelector('.persona-meta'); const tarjeta = f.closest('.split-personas').getBoundingClientRect();
      const r = (e) => e.getBoundingClientRect();
      // Un nombre de 24 letras en una sola palabra se parte donde haga falta, sin recortarse: el texto cabe en las líneas que se le dan.
      return {
        nombreCortado: txt.scrollHeight > txt.clientHeight + 1 || txt.scrollWidth > txt.clientWidth + 1,
        totalCortado: meta.scrollWidth > meta.clientWidth + 1,
        fuera: [...f.querySelectorAll('*')].filter((e) => e.getClientRects().length && (r(e).right > tarjeta.right + 0.5 || r(e).left < tarjeta.left - 0.5)).map((e) => e.className || e.tagName),
        lineas: Math.round(txt.getBoundingClientRect().height / parseFloat(getComputedStyle(txt).lineHeight)),
      };
    }));
    medidas.forEach((m, i) => {
      assert.equal(m.nombreCortado, false, `${ancho}: el nombre de la fila ${i + 1} se ve entero (${m.lineas} líneas)`);
      assert.equal(m.totalCortado, false, `${ancho}: el total de la fila ${i + 1} se ve entero`);
      assert.deepEqual(m.fuera, [], `${ancho}: nada de la fila ${i + 1} se sale de la tarjeta`);
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${ancho}: sin desborde horizontal de la página`);
    const chicos = await page.evaluate(() => [...document.querySelectorAll('.persona-split button, .persona-split input')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().width > 1)
      .map((e) => ({ n: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 28), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter((x) => x.w < 43.5 || x.h < 43.5));
    assert.deepEqual(chicos, [], `${ancho}: todo lo que se toca mide 44 px`);
    // Los botones de cada fila: mitad y mitad en teléfono; en una sola línea con el total desde 768.
    const f = filas(page).nth(0);
    const [nombre, meta, prec, cobrar] = await Promise.all([f.locator('.persona-nombre-btn'), f.locator('.persona-meta'), f.getByRole('button', { name: /^Imprimir la precuenta de / }), f.getByRole('button', { name: /^Cobrar a / })].map((l) => l.boundingBox()));
    assert.ok(Math.abs(prec.y - cobrar.y) <= 1 && prec.x < cobrar.x, `${ancho}: «Precuenta» y «Cobrar» juntos, «Precuenta» primero`);
    if (ancho < 768) {
      assert.ok(prec.y >= nombre.y + nombre.height - 1, `${ancho}: en la segunda línea`);
      assert.ok(Math.abs(prec.width - cobrar.width) <= 1.5, `${ancho}: mitad y mitad (${prec.width} y ${cobrar.width})`);
      if (ancho >= 360) assert.ok(meta.x > nombre.x && Math.abs((nombre.y + nombre.height / 2) - (meta.y + meta.height / 2)) <= nombre.height / 2, `${ancho}: el total a la derecha, en la línea del nombre`);
    } else {
      assert.ok(Math.abs((meta.y + meta.height / 2) - (prec.y + prec.height / 2)) <= 2, `${ancho}: una sola línea`);
      assert.ok(meta.x + meta.width <= prec.x + 1, `${ancho}: el total antes de los botones`);
    }
    // El detalle (la primera persona) se abre DEBAJO de los botones.
    await f.locator('.persona-meta').click();
    await reposo(page);
    const detalle = await f.locator('.persona-detalle').boundingBox();
    assert.ok(detalle.y >= prec.y + prec.height - 1, `${ancho}: el detalle queda debajo de los botones`);
    assert.ok(detalle.x + detalle.width <= (await page.locator('.split-personas').boundingBox()).x + (await page.locator('.split-personas').boundingBox()).width + 0.5, `${ancho}: y dentro de la tarjeta`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${ancho}: con el detalle abierto, sin desborde`);
    assert.deepEqual(a.diag.errores, []);
  });
}

// ═════════════════════════ 3. La precuenta de una persona ═════════════════════════

for (const ancho of [390, 1280]) {
  test(`precuenta de una persona (${ancho} px, con la caja en línea): pregunta con su nombre, va a la caja con SOLO sus líneas y su total, su botón dice «En cola…» y los demás siguen libres`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden-personas', ancho, { ajustar: (d) => { conCaja()(d); } }); if (!a) return;
    const { page } = a;
    const camila = filas(page).nth(0);
    await camila.getByRole('button', { name: 'Imprimir la precuenta de Camila' }).click();
    await dialogo(page).waitFor();
    assert.match(limpio(await dialogo(page).innerText()), /¿Imprimir la precuenta de Camila en la caja\?/);
    assert.match(limpio(await dialogo(page).innerText()), /Mesa 3 · 2 ítems · \$ 34\.000/);
    assert.deepEqual(await impresiones(page), [], 'nada sale sin confirmar');
    await boton(page, 'Cancelar').click();
    await reposo(page);
    assert.deepEqual(await impresiones(page), [], '«Cancelar» no manda nada');
    await camila.getByRole('button', { name: 'Imprimir la precuenta de Camila' }).click();
    await dialogo(page).waitFor();
    await boton(page, 'Imprimir en la caja').click();
    await page.locator('.toast-impresion-fila').first().waitFor();
    const [doc] = await impresiones(page);
    assert.equal(doc.tipo, 'cuenta');
    const lineas = doc.contenido.lineas.map((l) => (l.der ? `${l.texto} | ${l.der}` : l.texto));
    assert.equal(lineas[0], 'PRECUENTA - no es un cobro');
    assert.equal(lineas[1], 'Cuenta de Camila · Mesa 3');
    assert.ok(lineas.includes('1 x Ejecutivo de la casa | $ 21.000') && lineas.includes('1 x Limonada de coco | $ 13.000'));
    assert.ok(lineas.includes('TOTAL | $ 34.000'));
    assert.ok(!lineas.some((x) => /Andr|Persona 3|Pechuga|Jugo|Empanadas|Cóctel/.test(x)), `solo lo de Camila:\n${lineas.join('\n')}`);
    assert.equal(await conteoPrint(page), 0, 'con la caja en línea NO se abre la impresión del teléfono');
    assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'orden', 'sigue en la orden');
    assert.equal(limpio(await page.locator('.toast-impresion-fila').first().innerText()), 'Cuenta de Camila · Mesa 3 En cola en la caja…');
    // Su botón: «En cola…», apagado; el de Andrés y el de la precuenta entera siguen libres.
    const suyo = camila.getByRole('button', { name: 'Imprimir la precuenta de Camila' });
    assert.equal(limpio(await suyo.innerText()), 'En cola…');
    assert.equal(await suyo.isDisabled(), true);
    assert.equal(await filas(page).nth(1).getByRole('button', { name: 'Imprimir la precuenta de Andrés' }).isDisabled(), false);
    assert.equal(await boton(page, 'Imprimir precuenta').isDisabled(), false, 'la precuenta de toda la cuenta es otro papel');
    assert.ok((await suyo.boundingBox()).height >= 43.5, '«En cola…» sigue midiendo 44 px');
    // La caja la toma y la imprime: el botón vuelve.
    await page.evaluate(() => window.__posSim.imprimirAhora(window.__posSim.tablas.impresiones.at(-1).id, 'imprimiendo'));
    await page.getByText('Imprimiendo en la caja…').waitFor();
    assert.equal(limpio(await suyo.innerText()), 'Precuenta');
    assert.equal(await suyo.isEnabled(), true);
    // La cuenta sigue entera (la precuenta no cobra).
    assert.equal(await page.evaluate(() => Alpine.store('pos').ordenActiva.items.length), 7);
    assert.deepEqual(a.diag.errores, []);
  });
}

test('precuenta de una persona (390 px, sin la cola): imprime directo en el teléfono («PRECUENTA — no es un cobro», «Cuenta de Camila · Mesa 3», solo sus líneas) y el papel dice lo mismo que el documento de la caja', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas', 390); if (!a) return;
  const { page } = a;
  await filas(page).nth(0).getByRole('button', { name: 'Imprimir la precuenta de Camila' }).click();
  await page.waitForFunction(() => window.__posImpresiones === 1);
  assert.equal(await dialogo(page).isVisible(), false, 'sin la cola no hay confirmación extra (como hoy)');
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'ticket');
  assert.equal(limpio(await page.locator('.ticket-sub').innerText()).toLowerCase(), 'precuenta — no es un cobro');
  assert.equal(limpio(await page.locator('.ticket-quien').innerText()), 'Cuenta de Camila · Mesa 3');
  assert.equal(await page.locator('.ticket-meta .meta-row:visible', { hasText: /^Mesa|^Cuenta de/ }).count(), 0, 'sin las filas «Mesa» y «Cuenta de»: lo dice la línea de arriba');
  await page.emulateMedia({ media: 'print' });
  const papel = (await page.locator('.print-zone').innerText()).split('\n').map(limpio).filter(Boolean);
  await page.emulateMedia({ media: 'screen' });
  const documento = await page.evaluate(() => {
    const p = Alpine.store('pos');
    return p.documentoTicket(p.ticketMostrado, 'cuenta').lineas.filter((l) => l.texto !== '---' && l.texto !== '').map((l) => (l.der ? `${l.texto} | ${l.der}` : l.texto));
  });
  const norm = (x) => x.toLowerCase().replace(/ — /g, ' - ').replace(/\s+/g, ' ');
  const enPapel = papel.join(' ').toLowerCase().replace(/\s+/g, ' ');
  for (const l of documento) {
    const [izq, der] = l.split(' | ');
    if (['Resplandor'].includes(izq)) continue;
    assert.ok(norm(enPapel).includes(norm(izq).replace(/ - /g, ' - ')) || enPapel.includes(norm(izq)), `el papel del teléfono trae «${izq}» como el de la caja:\n${papel.join('\n')}`);
    if (der) assert.ok(enPapel.includes(norm(der)), `y su valor «${der}»`);
  }
  assert.ok(papel.some((l) => /1 x Ejecutivo de la casa/.test(l)));
  assert.ok(!papel.some((l) => /Andr|Persona 3|Pechuga|Jugo|Empanadas/.test(l)), 'solo lo de Camila');
  assert.ok(papel.some((l) => /TOTAL/.test(l)) && papel.join(' ').includes('$ 34.000'));
  assert.deepEqual(a.diag.errores, []);
});

// ═════════════════════════ 4. Cobrar por partes ═════════════════════════

test('cobrar por partes (390 px): mientras dura, los «Cobrar» de cada persona se esconden y «Precuenta» toma todo el ancho; el ticket de la precuenta de una persona no desborda con un nombre de 24 letras', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas', 390, { ajustar: conCaja() }); if (!a) return;
  const { page } = a;
  await page.evaluate(() => Alpine.store('pos').toggleModoCobroParcial());
  await reposo(page);
  const f = filas(page).nth(0);
  assert.equal(await f.getByRole('button', { name: /^Cobrar a / }).isVisible(), false);
  const prec = await f.getByRole('button', { name: 'Imprimir la precuenta de Camila' }).boundingBox();
  const fila = await f.boundingBox();
  assert.ok(prec.width >= fila.width - 20, `la precuenta toma el ancho de la fila (${prec.width} de ${fila.width})`);
  assert.ok(prec.height >= 43.5);

  const b = await abrir(t, 'orden-personas', 320); if (!b) return;
  await b.page.evaluate(() => Alpine.store('pos').renombrarPersona('Persona 1', 'W'.repeat(24)));
  await b.page.getByRole('button', { name: /^Imprimir la precuenta de W{24}$/ }).click();
  await b.page.locator('.ticket-quien').waitFor();
  assert.match(limpio(await b.page.locator('.ticket-quien').innerText()), /^Cuenta de W{24} · Mesa 3$/);
  const r = await b.page.evaluate(() => {
    const q = document.querySelector('.ticket-quien').getBoundingClientRect(); const t = document.querySelector('.ticket').getBoundingClientRect();
    return { desborde: document.documentElement.scrollWidth - innerWidth, dentro: q.left >= t.left - 0.5 && q.right <= t.right + 0.5 };
  });
  assert.equal(r.desborde, 0, '320: el documento no crece a lo ancho');
  assert.equal(r.dentro, true, '320: «Cuenta de WWWW…» queda dentro de la hoja');
});
