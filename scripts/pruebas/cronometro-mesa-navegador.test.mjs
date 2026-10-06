// El cronómetro de la mesa y la marca «servida» (tareas/2026-10-06-cronometro-mesa.md; docs/pos-visual.md §0.26), vistos en el POS de verdad.
//
//   1. ESTÁTICA (corre siempre, también en CI): los cortes de color son constantes con nombre y comentadas; el reloj es UN setInterval de 1 minuto; el chip no se anima ni se
//      parpadea; los colores del chip son literales derivados y su texto pasa AA en las dos superficies (también medido con la fórmula WCAG de contraste.test.mjs); el control de la
//      cabecera es un botón de 44 px y la tarjeta no gana alto.
//   2. EN NAVEGADOR (solo si hay Playwright y Chromium, como desborde.test.mjs; si no, se salta con el motivo). POS con el arnés simulado (reloj fijo: miércoles 2026-09-30, 13:30 en
//      Bogotá; mesa 3 abierta 12:42 = 48 min, mesa 6 abierta 13:05 = 25 min). A 390 y 1280 px, en claro y en oscuro:
//        · el chip está solo en las mesas ocupadas con algo que servir, con su texto, su color por la espera y su texto para lectores de pantalla («Esperando 48 minutos»);
//        · cambia al minuto con el reloj (y cruza los cortes de color), se detiene con la pestaña oculta y se pone al día al volver;
//        · la cabecera de la cuenta dice «· esperando 48 min» y NO cambia de alto (ni la tarjeta de la mesa: el chip va donde estaban los puntos de capacidad);
//        · tocar el chip de la cabecera marca SERVIDA («servida 1:30 · esperó 48 min», neutro), la cabecera no cambia de alto, otro toque la quita; mantener el chip de la tarjeta
//          hace lo mismo sin abrir la mesa y un toque corto sí la abre; una tanda nueva a una mesa servida la quita;
//        · contraste AA medido sobre los colores que el navegador dibuja de verdad, en los tres estados y las dos superficies, en claro y en oscuro;
//        · sin desborde horizontal (320, 360 y 390) y sin errores de consola.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { servirPos, nuevoContexto, abrirPos, congelarReloj, avanzarReloj, FECHA_FIJA } from './_pos-simulado.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const MIN = 60000;
const AHORA = Date.parse(FECHA_FIJA);

// ───────────────────────── 1. estática ─────────────────────────

const BLOQUE_CSS = POS.slice(POS.indexOf('/* ▼ PARTE cronometro-mesa :: css'), POS.indexOf('/* ▲ PARTE cronometro-mesa :: css */'));
const BLOQUE_STORE = POS.slice(POS.indexOf('// ▼ PARTE cronometro-mesa :: store'), POS.indexOf('// ▲ PARTE cronometro-mesa :: store'));
const BLOQUE_HELPERS = POS.slice(POS.indexOf('// ▼ PARTE cronometro-mesa :: helpers'), POS.indexOf('// ▲ PARTE cronometro-mesa :: helpers'));

test('los cortes de color son constantes con nombre y comentadas (20 y 40 min), y el tope y el toque largo también', () => {
  assert.ok(BLOQUE_HELPERS.length > 500 && BLOQUE_CSS.length > 500 && BLOQUE_STORE.length > 500, 'los tres bloques con marcadores existen');
  assert.match(BLOQUE_HELPERS, /\/\/ [^\n]*hasta 20 min el chip es neutro, de 20 a 40 se tiñe de ámbar y desde 40 de coral[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*const ESPERA_AMBAR_MIN = 20;\s*\n\s*const ESPERA_CORAL_MIN = 40;/);
  assert.match(BLOQUE_HELPERS, /const ESPERA_TOPE_MIN = 24 \* 60;/);
  assert.match(BLOQUE_HELPERS, /const ESPERA_TOQUE_LARGO_MS = 600;/);
  assert.match(BLOQUE_HELPERS, /function esperaNivel\(min\) \{ return min >= ESPERA_CORAL_MIN \? 'coral' : min >= ESPERA_AMBAR_MIN \? 'ambar' : 'neutro'; \}/);
});

test('el reloj es UN setInterval de 1 minuto, con el visibilitychange que lo detiene y lo pone al día; nada más en el bloque usa temporizadores de la espera', () => {
  const intervalos = BLOQUE_STORE.match(/setInterval\(/g) || [];
  assert.equal(intervalos.length, 1, 'un solo setInterval en el bloque de la espera');
  assert.match(BLOQUE_STORE, /this\._relojMesas = setInterval\(\(\) => \{ this\.ahoraMesas = Date\.now\(\); this\._podarPedidoEn\(\); \}, 60000\);/);
  assert.match(BLOQUE_STORE, /document\.addEventListener\('visibilitychange', \(\) => \{[\s\S]*?document\.visibilityState === 'hidden'\) this\._apagarRelojMesas\(\); else this\._encenderRelojMesas\(\);/);
  assert.match(POS, /this\._arrancarRelojMesas\(\);   \/\/ cronometro-mesa/);
  assert.match(POS, /this\._detenerRelojMesas\(\);   \/\/ cronometro-mesa/);
});

test('el chip no parpadea ni se anima: ni animation, ni transition, ni @keyframes, ni opacidad; la letra es de 12 px o más y el borde es decorativo', () => {
  assert.doesNotMatch(BLOQUE_CSS, /animation|transition|@keyframes|opacity|blink/i);
  for (const m of BLOQUE_CSS.matchAll(/font-size:\s*([\d.]+)rem/g)) assert.ok(Number(m[1]) >= 0.75, `letra de ${m[1]}rem: el mínimo del POS son 12 px`);
  assert.match(BLOQUE_CSS, /\.espera-chip\s*\{[^}]*white-space: nowrap;/, 'el chip no parte su texto');
});

test('el control de la cabecera mide 44 px de toque con margen negativo (la línea no crece); el de la tarjeta es absoluto (no suma alto); solo informa: sin hover que sea la única pista', () => {
  assert.match(BLOQUE_CSS, /\.espera-toque\s*\{[^}]*min-width: var\(--pos-tactil\);[^}]*min-height: var\(--pos-tactil\);[^}]*margin-block: calc\(\(1\.125rem - var\(--pos-tactil\)\) \/ 2\);/);
  assert.match(BLOQUE_CSS, /\.mesa-espera\s*\{[^}]*position: absolute;/);
  assert.match(BLOQUE_CSS, /\.mesa-espera ~ \.seat-dots \{ visibility: hidden; \}/, 'los puntos de capacidad se vacían (no se quitan: nada se mueve)');
  assert.doesNotMatch(BLOQUE_CSS, /:hover/);
  assert.match(POS, /class="mesa-espera espera-chip print:hidden"/);
  assert.match(POS, /<span class="espera-cab print:hidden">/);
});

// El contraste de los colores del chip, con la fórmula WCAG de contraste.test.mjs, sobre las dos superficies:
// «cl» = arroz F4F0E3 (la cabecera en claro; la tarjeta ocupada en oscuro) y «os» = telón 0A1112 (la cabecera en oscuro; la tarjeta ocupada en claro).
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; const [h, l] = x > y ? [x, y] : [y, x]; return (h + 0.05) / (l + 0.05); };
const token = (nombre) => { const m = BLOQUE_CSS.match(new RegExp(`--${nombre}:\\s*(#[0-9A-Fa-f]{6})`)); assert.ok(m, `no encuentro --${nombre}`); return m[1]; };
const SUPERFICIE = { cl: '#F4F0E3', os: '#0A1112' };

for (const sup of ['cl', 'os']) {
  test(`contraste AA (≥ 4,5) del texto del chip sobre ${sup === 'cl' ? 'arroz' : 'telón'}, en los tres estados (neutro, ámbar, coral)`, () => {
    for (const nivel of ['neutro', 'ambar', 'coral']) {
      const fondo = nivel === 'neutro' ? SUPERFICIE[sup] : token(`esp-${sup}-${nivel}-fondo`);
      const texto = token(`esp-${sup}-${nivel}-texto`);
      const r = ratio(rgb(texto), rgb(fondo));
      assert.ok(r >= 4.5, `${sup} ${nivel}: ${texto} sobre ${fondo} = ${r.toFixed(2)}`);
    }
    // y el tinte se ve sobre la superficie (no es del mismo tono): el borde es decorativo, el fondo se distingue
    for (const nivel of ['ambar', 'coral']) assert.ok(ratio(rgb(token(`esp-${sup}-${nivel}-fondo`)), rgb(SUPERFICIE[sup])) >= 1.1, `${sup} ${nivel}: el tinte se distingue de la superficie`);
  });
}

// ───────────────────────── 2. en navegador ─────────────────────────

const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
let navegador = null;
let servidor = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});

async function abrir(t, { ancho, esquema = 'light', vista = 'mesas', ajustar }) {
  let ultimo = null;
  for (let intento = 0; intento < 2; intento++) {
    let ctx = null;
    try {
      servidor ||= await servirPos(RAIZ, 0);
      navegador ||= await pw.chromium.launch();
      ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
      contextos.push(ctx);
      const page = await ctx.newPage();
      page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(90000);
      await page.emulateMedia({ colorScheme: esquema });
      const { diag } = await abrirPos(page, { url: servidor.url, vista, ajustar, bloquearFuentes: true });
      return { page, diag };
    } catch (e) { ultimo = e; await ctx?.close().catch(() => {}); }
  }
  t.skip(`no se pudo abrir el POS en el navegador: ${String(ultimo && ultimo.message).split('\n')[0]}`);
  return null;
}

const chipMesa = (page, n) => page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).locator('.mesa-espera');
const textoChipMesa = (page, n) => chipMesa(page, n).locator('[aria-hidden="true"]:not(svg)').textContent().then((s) => s.trim());
const nivelChipMesa = (page, n) => chipMesa(page, n).getAttribute('data-nivel');
const cabecera = (page) => page.locator('.orden-cab-titulo > p');
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const llamadas = (page) => page.evaluate(() => window.__posSim.llamadas);
/** Cuenta abierta hace `min` minutos (respecto del «ahora» de los chips). */
const edad = (page, id, min) => page.evaluate(([i, m]) => { const p = Alpine.store('pos'); p.ordenes.find((o) => o.id === i).abiertaEn = new Date(p.ahoraMesas - m * 60000).toISOString(); }, [id, min]);
const alto = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().height, sel);
/** El reloj de Playwright del arnés tiene la hora FIJA (Date.now no avanza aunque corran los temporizadores): se suma un desfase a Date.now y se corren los temporizadores. */
const adelantar = async (page, ms) => {
  await page.evaluate((m) => {
    if (!window.__desfase) { window.__desfase = 0; const real = Date.now.bind(Date); Date.now = () => real() + window.__desfase; }
    window.__desfase += m;
  }, ms);
  await avanzarReloj(page, ms);
};
const pestaña = (page, estado) => page.evaluate((e) => { Object.defineProperty(document, 'visibilityState', { get: () => e, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, estado);

/** El color con que el navegador dibuja el texto de un chip y el fondo que tiene detrás (el del chip si no es transparente, si no el de la superficie), y su contraste. */
const contrasteDe = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const num = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const sobre = (f, b) => ({ r: f.a * f.r + (1 - f.a) * b.r, g: f.a * f.g + (1 - f.a) * b.g, b: f.a * f.b + (1 - f.a) * b.b });
  let sup = { r: 255, g: 255, b: 255, a: 1 };
  for (let n = el.parentElement; n; n = n.parentElement) { const b = num(getComputedStyle(n).backgroundColor); if (b.a > 0) { sup = b; break; } }
  const cs = getComputedStyle(el);
  const fondo = sobre(num(cs.backgroundColor), sup);
  const texto = sobre(num(cs.color), fondo);
  const L = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const [x, y] = [L(texto), L(fondo)];
  return { ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05), texto: [texto.r, texto.g, texto.b].map(Math.round), fondo: [fondo.r, fondo.g, fondo.b].map(Math.round) };
}, selector);

for (const [ancho, esquema] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
  test(`mapa (${ancho} px, ${esquema}): el chip está solo en las mesas ocupadas con algo que servir, con su espera, su color y su texto para lectores de pantalla; sin errores`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, { ancho, esquema }); if (!a) return;
    const { page, diag } = a;
    assert.deepEqual(diag.errores, [], 'sin errores de página');
    assert.equal(await page.locator('.mesa-espera').count(), 2, 'solo las dos mesas ocupadas (3 y 6)');
    assert.equal(await textoChipMesa(page, 3), '48 min');
    assert.equal(await nivelChipMesa(page, 3), 'coral', '48 min: coral (≥ 40)');
    assert.equal(await textoChipMesa(page, 6), '25 min');
    assert.equal(await nivelChipMesa(page, 6), 'ambar', '25 min: ámbar (de 20 a 40)');
    assert.equal(await chipMesa(page, 1).count(), 0, 'una mesa libre no lo tiene');
    // lectores de pantalla: la tarjeta (un botón) dice «Esperando 48 minutos»; lo visible va escondido para ellos
    const nombre = await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^3$/ }) }).innerText();
    assert.match(nombre, /Esperando 48 minutos\. Pedido tomado a las 12:42 p\. m\./);
    assert.equal(await chipMesa(page, 3).locator('[aria-hidden="true"]:not(svg)').getAttribute('aria-hidden'), 'true');
    assert.match(await chipMesa(page, 3).getAttribute('title'), /Pedido tomado a las 12:42 p\. m\. Mantén pulsado para marcar la mesa como servida\./);
    // el chip va donde estaban los puntos de capacidad: se vacían, no se mueven
    assert.equal(await page.locator('.mesa-card.ocupada .seat-dots').first().evaluate((e) => getComputedStyle(e).visibility), 'hidden');
    assert.equal(await sinDesborde(page), 0);
    // cuenta vacía o cerrada: nada
    await page.evaluate(() => { const p = Alpine.store('pos'); p.ordenes.find((o) => o.id === 'ord-abierta-6').items = []; p.ordenes.find((o) => o.id === 'ord-abierta-3').estado = 'cerrada'; });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.mesa-espera').count(), 0, 'vacía y cerrada: ninguna tiene chip');
    assert.deepEqual(diag.errores, []);
  });

  test(`mapa (${ancho} px, ${esquema}): el chip no cambia el alto de la tarjeta ni de la rejilla`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, { ancho, esquema }); if (!a) return;
    const { page } = a;
    const medir = () => page.evaluate(() => ({
      tarjetas: [...document.querySelectorAll('.mesa-card')].map((c) => Math.round(c.getBoundingClientRect().height * 10) / 10),
      rejilla: Math.round(document.querySelector('.mesa-card').parentElement.getBoundingClientRect().height * 10) / 10,
      fin: Math.round(document.querySelector('.stats-mesas').getBoundingClientRect().bottom * 10) / 10,
    }));
    const con = await medir();
    await page.addStyleTag({ content: '.mesa-espera { display: none !important; }' });
    const sin = await medir();
    assert.deepEqual(con, sin, 'con y sin chip, las mismas alturas');
    // y el chip cabe dentro de la tarjeta, sin tocar el total ni el borde de abajo
    await page.evaluate(() => { document.querySelectorAll('.mesa-espera').forEach((e) => e.style.removeProperty('display')); });
    await page.addStyleTag({ content: '.mesa-espera { display: inline-flex !important; }' });
    const caja = await page.evaluate(() => {
      const c = document.querySelector('.mesa-card.ocupada'); const r = c.getBoundingClientRect();
      const ch = c.querySelector('.mesa-espera').getBoundingClientRect(); const tot = c.querySelector('.mesa-total').getBoundingClientRect();
      return { arriba: ch.top - tot.bottom, abajo: r.bottom - ch.bottom, izq: ch.left - r.left, der: r.right - ch.right, dentro: ch.top >= r.top && ch.bottom <= r.bottom };
    });
    assert.ok(caja.dentro && caja.arriba >= -0.5 && caja.abajo >= 1 && caja.izq >= 4 && caja.der >= 4, `el chip cabe en la tarjeta: ${JSON.stringify(caja)}`);
  });

  test(`cabecera (${ancho} px, ${esquema}): «Abierta 12:42 p. m. · esperando 48 min» en UNA línea y sin cambiar el alto de la cabecera; el control mide 44 px`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, { ancho, esquema, vista: 'orden' }); if (!a) return;
    const { page, diag } = a;
    const texto = (await cabecera(page).innerText()).replace(/\s+/g, ' ').trim();
    assert.match(texto, /^Abierta 12:42 p\. m\. · esperando 48 min$/);
    const con = { cab: await alto(page, '.orden-cab'), p: await alto(page, '.orden-cab-titulo > p') };
    assert.ok(con.p < 24, `la línea mide ${con.p} px: una sola línea`);
    const boton = await page.locator('.espera-toque').boundingBox();
    assert.ok(boton.height >= 44 && boton.width >= 44, `el control mide ${boton.width}×${boton.height}`);
    assert.match(await page.locator('.espera-toque').getAttribute('aria-label'), /^Esperando 48 minutos\. Pedido tomado a las 12:42 p\. m\. Toca para marcar la mesa como servida\.$/);
    // sin el chip (la cuenta vacía) la cabecera mide lo mismo
    await page.evaluate(() => { Alpine.store('pos').ordenActiva.items = []; });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.espera-cab').count(), 0);
    const sin = { cab: await alto(page, '.orden-cab'), p: await alto(page, '.orden-cab-titulo > p') };
    assert.ok(Math.abs(con.cab - sin.cab) < 0.5, `el alto de la cabecera no cambia (${con.cab} con el chip, ${sin.cab} sin él)`);
    assert.ok(Math.abs(con.p - sin.p) < 0.5, 'ni el de la línea de la hora');
    assert.equal(await sinDesborde(page), 0);
    assert.deepEqual(diag.errores, []);
  });
}

test('cambia al minuto con el reloj, cruza los cortes de color (19 → 20 → 40), se detiene con la pestaña oculta y se pone al día al volver', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { ancho: 390 }); if (!a) return;
  const { page, diag } = a;
  await congelarReloj(page);
  await edad(page, 'ord-abierta-6', 18.5 * 1);                     // 18,5 min
  assert.equal(await textoChipMesa(page, 6), '18 min');
  assert.equal(await nivelChipMesa(page, 6), 'neutro');
  await adelantar(page, MIN);                                       // el reloj de 1 minuto da UN tick
  assert.equal(await textoChipMesa(page, 6), '19 min');
  assert.equal(await nivelChipMesa(page, 6), 'neutro', '19 min sigue neutro');
  await adelantar(page, MIN);
  assert.equal(await textoChipMesa(page, 6), '20 min');
  assert.equal(await nivelChipMesa(page, 6), 'ambar', 'a los 20 se tiñe de ámbar');
  await edad(page, 'ord-abierta-6', 38.5);                          // con lo que corre: 39,5 (ámbar) y 40,5 (coral)
  await adelantar(page, MIN);
  assert.equal(await nivelChipMesa(page, 6), 'ambar', '39 min sigue ámbar');
  await adelantar(page, MIN);
  assert.equal(await nivelChipMesa(page, 6), 'coral', 'a los 40 pasa a coral');
  // pestaña oculta: nada se mueve; al volver, se pone al día de una vez
  await pestaña(page, 'hidden');
  const antes = await textoChipMesa(page, 3);
  await adelantar(page, 5 * MIN);
  assert.equal(await textoChipMesa(page, 3), antes, 'oculta: el chip no se mueve');
  await pestaña(page, 'visible');
  assert.equal(await textoChipMesa(page, 3), `${parseInt(antes, 10) + 5} min`, 'al volver se pone al día');
  await adelantar(page, MIN);
  assert.equal(await textoChipMesa(page, 3), `${parseInt(antes, 10) + 6} min`, 'y el reloj sigue');
  assert.deepEqual(diag.errores, []);
});

test('cerrar la cuenta (cobrar) quita el chip del mapa y de la cabecera', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { ancho: 390, vista: 'orden' }); if (!a) return;
  const { page, diag } = a;
  assert.equal(await page.locator('.espera-cab .espera-chip').count(), 1);
  assert.equal(await chipMesa(page, 3).count(), 1);
  await page.evaluate(() => { Alpine.store('pos').ordenActiva.estado = 'cerrada'; });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.espera-cab .espera-chip').count(), 0, 'cuenta cerrada: nada en la cabecera');
  assert.equal(await chipMesa(page, 3).count(), 0, 'ni en la tarjeta de la mesa');
  assert.equal(await chipMesa(page, 6).count(), 1, 'la otra mesa sigue con el suyo');
  assert.deepEqual(diag.errores, []);
});

for (const ancho of [390, 1280]) {
  test(`servida (${ancho} px): tocar el chip de la cabecera la marca («servida 1:30 · esperó 48 min», neutro, sin cambiar el alto), el cronómetro se detiene y otro toque la quita`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, { ancho, vista: 'orden' }); if (!a) return;
    const { page, diag } = a;
    await congelarReloj(page);
    const altoAntes = await alto(page, '.orden-cab');
    await page.locator('.espera-toque').click();
    await page.waitForTimeout(50);
    const texto = (await cabecera(page).innerText()).replace(/\s+/g, ' ').trim();
    assert.match(texto, ancho < 440 ? /^Abierta 12:42 p\. m\. · servida 1:30 · 48 min$/ : /^Abierta 12:42 p\. m\. · servida 1:30 · esperó 48 min$/, 'el chip pasa a «servida · esperó»');
    assert.equal(await page.locator('.espera-chip').first().getAttribute('data-nivel'), 'neutro');
    assert.equal(await page.locator('.espera-chip').first().getAttribute('data-servida'), 'si');
    assert.match(await page.locator('.espera-toque').getAttribute('aria-label'), /^Servida a las 1:30 p\. m\.; esperó 48 minutos\. Pedido tomado a las 12:42 p\. m\. Toca para volver a contar la espera\.$/);
    assert.equal(await alto(page, '.orden-cab'), altoAntes, 'la cabecera no cambia de alto al marcarla');
    assert.equal(await alto(page, '.orden-cab-titulo > p') < 24, true, 'sigue en una línea');
    const ups = (await llamadas(page)).filter((c) => c.tipo === 'db.update' && c.tabla === 'ordenes');
    assert.equal(ups.length, 1, 'un update');
    assert.deepEqual(Object.keys(ups[0].carga), ['servida_en'], 'solo esa columna');
    await adelantar(page, 30 * MIN);
    assert.match((await cabecera(page).innerText()).replace(/\s+/g, ' '), /servida 1:30 · (esperó )?48 min/, 'el cronómetro se detuvo: pasan 30 minutos y dice lo mismo');
    // en el mapa, la misma mesa dice «✓ 48 min» y no se tiñe aunque pase de los 40
    await page.evaluate(() => Alpine.store('pos').volverAMesas());
    await avanzarReloj(page, 150);
    assert.equal(await textoChipMesa(page, 3), '48 min');
    assert.equal(await nivelChipMesa(page, 3), 'neutro');
    assert.equal(await chipMesa(page, 3).getAttribute('data-servida'), 'si');
    assert.match(await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^3$/ }) }).innerText(), /Servida a las 1:30 p\. m\.; esperó 48 minutos/);
    // otro toque (volver a la cuenta) la quita: vuelve a contar desde el mismo inicio (48 + 30 = 78 min → 1 h 18)
    await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^3$/ }) }).locator('.mesa-num').click();
    await avanzarReloj(page, 150);
    await page.locator('.espera-toque').waitFor();
    await page.locator('.espera-toque').click();
    await page.waitForTimeout(50);
    assert.match((await cabecera(page).innerText()).replace(/\s+/g, ' '), /esperando 1 h 18$/);
    const ups2 = (await llamadas(page)).filter((c) => c.tipo === 'db.update' && c.tabla === 'ordenes');
    assert.equal(ups2.length, 2);
    assert.equal(ups2[1].carga.servida_en, null);
    assert.equal(await alto(page, '.orden-cab'), altoAntes, 'ni al quitarla');
    assert.deepEqual(diag.errores, []);
  });
}

test('mapa: mantener pulsado el chip marca servida SIN abrir la mesa; un toque corto abre la mesa; el siguiente toque largo la quita', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { ancho: 390 }); if (!a) return;
  const { page, diag } = a;
  // (al volver de la cuenta el mapa tarda un cuadro en asentarse: se mide cuando ya está quieto)
  const centro = async () => { await chipMesa(page, 3).waitFor({ state: 'visible' }); await page.waitForTimeout(300); const b = await chipMesa(page, 3).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  // toque largo
  let c = await centro();
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'mesas', 'el toque largo no abre la mesa');
  assert.equal(await chipMesa(page, 3).getAttribute('data-servida'), 'si', 'la marcó');
  assert.equal((await llamadas(page)).filter((x) => x.tipo === 'db.update' && x.tabla === 'ordenes').length, 1);
  // el siguiente toque normal sobre la tarjeta SÍ la abre (el clic tragado fue uno solo)
  c = await centro();
  await page.mouse.click(c.x, c.y);
  await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
  await page.evaluate(() => Alpine.store('pos').volverAMesas());
  await page.waitForFunction(() => Alpine.store('pos').vista === 'mesas');
  // otro largo la quita
  c = await centro();
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up();
  await page.waitForTimeout(150);
  assert.equal(await chipMesa(page, 3).getAttribute('data-servida'), 'no', 'la quitó');
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'mesas');
  assert.deepEqual(diag.errores, []);
});

test('una tanda nueva a una mesa servida quita la marca (null en la base) y la espera empieza de nuevo; quitar un ítem no la toca', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { ancho: 1280, vista: 'orden' }); if (!a) return;
  const { page, diag } = a;
  await page.locator('.espera-toque').click();
  await page.waitForTimeout(100);
  assert.match(await cabecera(page).innerText(), /servida 1:30 · esperó 48 min/);
  // quitar una unidad: no la toca
  await page.locator('.order-item').first().getByRole('button', { name: /^(−|-|Quitar|Menos)/ }).first().click().catch(() => page.evaluate(() => { const p = Alpine.store('pos'); p.quitarProducto(p.ordenActiva.items[0]); }));
  await page.waitForTimeout(100);
  assert.match(await cabecera(page).innerText(), /servida 1:30/, 'quitar un ítem no quita la marca');
  const antes = (await llamadas(page)).filter((c) => c.tipo === 'db.update' && c.tabla === 'ordenes').length;
  await page.locator('.menu-item').filter({ hasText: 'Jugo natural' }).first().click();
  await page.waitForTimeout(300);
  const texto = (await cabecera(page).innerText()).replace(/\s+/g, ' ');
  assert.match(texto, /esperando ahora$/, 'espera nueva: desde la segunda tanda');
  const nuevos = (await llamadas(page)).filter((c) => c.tipo === 'db.update' && c.tabla === 'ordenes').slice(antes);
  assert.equal(nuevos.length, 1);
  assert.equal(nuevos[0].carga.servida_en, null, 'la base queda sin marca');
  assert.deepEqual(diag.errores, []);
});

// Contraste medido sobre lo que Chromium dibuja: la cabecera (sobre el lienzo de la página) y la tarjeta ocupada (sobre su fondo), en claro y en oscuro, en los tres estados.
for (const esquema of ['light', 'dark']) {
  test(`contraste AA medido en el navegador (${esquema}): el chip de la cabecera y el de la tarjeta, neutro, ámbar y coral, y servida`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, { ancho: 390, esquema, vista: 'orden' }); if (!a) return;
    const { page, diag } = a;
    const falla = [];
    const revisar = async (donde, selector, nivel) => {
      const m = await contrasteDe(page, selector);
      if (!(m.ratio >= 4.5)) falla.push(`${esquema} ${donde} ${nivel}: ${m.ratio.toFixed(2)} (texto ${m.texto} sobre ${m.fondo})`);
      return m;
    };
    for (const [min, nivel] of [[10, 'neutro'], [25, 'ambar'], [45, 'coral']]) {
      await edad(page, 'ord-abierta-3', min);
      await page.waitForTimeout(60);
      assert.equal(await page.locator('.espera-cab .espera-chip').getAttribute('data-nivel'), nivel);
      await revisar('cabecera', '.espera-cab .espera-chip', nivel);
    }
    await page.locator('.espera-toque').click();
    await page.waitForTimeout(60);
    await revisar('cabecera', '.espera-cab .espera-chip', 'servida');
    await page.locator('.espera-toque').click();
    await page.evaluate(() => Alpine.store('pos').volverAMesas());
    await page.waitForFunction(() => Alpine.store('pos').vista === 'mesas');
    for (const [min, nivel] of [[10, 'neutro'], [25, 'ambar'], [45, 'coral']]) {
      await edad(page, 'ord-abierta-3', min);
      await page.waitForTimeout(60);
      assert.equal(await nivelChipMesa(page, 3), nivel);
      await revisar('tarjeta', '.mesa-card.ocupada .mesa-espera', nivel);
    }
    assert.deepEqual(falla, [], `texto por debajo de 4,5:1: ${falla.join(' | ')}`);
    assert.deepEqual(diag.errores, []);
  });
}

for (const ancho of [320, 360, 390]) {
  test(`sin desborde horizontal a ${ancho} px: la cabecera con el chip esperando y servido, y el mapa`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, { ancho, vista: 'orden' }); if (!a) return;
    const { page, diag } = a;
    assert.equal(await sinDesborde(page), 0, 'esperando');
    await page.locator('.espera-toque').click();
    await page.waitForTimeout(80);
    assert.equal(await sinDesborde(page), 0, 'servida');
    if (ancho >= 360) assert.ok(await alto(page, '.orden-cab-titulo > p') < 24, `a ${ancho} px la línea de la hora sigue siendo una sola`);
    await page.evaluate(() => Alpine.store('pos').volverAMesas());
    await page.waitForTimeout(100);
    assert.equal(await sinDesborde(page), 0, 'mapa');
    assert.deepEqual(diag.errores, []);
  });
}
