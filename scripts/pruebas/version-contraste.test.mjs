// Contraste AA (texto pequeño: ≥ 4,5:1) de la firma «Ynt-labs», de la versión y del aviso de versión nueva, en CADA fondo donde van:
//   · carta.html y menu.html: apoyo sobre arroz;  · index.html: ceniza sobre telón (el pie de la landing);
//   · pos.html: apoyo sobre arroz (el pie del área de trabajo), ceniza sobre telón (el pie del login) y el aviso (telón sobre el tinte
//     de turquesa, barro sobre el tinte, arroz sobre el botón telón; el ícono, no-texto, ≥ 3:1).
// Medido como en contraste.test.mjs: la fórmula WCAG 2.x de verdad (luminancia relativa y razón de contraste), con los tokens de
// assets/css/base.css y los derivados del POS que viven en pos.html. Dos partes:
//   1. ESTÁTICA (corre siempre): los pares de tokens, que son los que dibuja cada fondo. Si cambia un hex, esta prueba lo nota.
//   2. EN NAVEGADOR (solo con Playwright y Chromium; si no, se salta con el motivo): lo que Chromium DIBUJA — color calculado de cada
//      texto contra el fondo efectivo (compuesto hacia arriba por los ancestros), también con el puntero encima de la firma.
// El texto es de 12 px (.75rem): texto pequeño, sin la excepción de texto grande.
'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';
import { VISTAS, datosFicticios, esperarEstable, esperarListo, nuevoContexto, prepararPagina, servirPos } from './_pos-simulado.mjs';
import { RAIZ } from './_pos-vm.mjs';

const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const BASE = leer('assets/css/base.css');
const POS = leer('pos.html');

// ───────────────────────── WCAG 2.x (la misma fórmula de contraste.test.mjs) ─────────────────────────

const hexARgb = (hex) => { const n = parseInt(hex, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function luminanciaRelativa([r, g, b]) {
  const canal = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}
const razon = (a, b) => {
  const [la, lb] = [luminanciaRelativa(a), luminanciaRelativa(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const contraste = (hexA, hexB) => razon(hexARgb(hexA), hexARgb(hexB));

const token = (nombre) => {
  const m = BASE.match(new RegExp(`--color-${nombre}\\s*:\\s*#([0-9A-Fa-f]{6})\\b`));
  assert.ok(m, `base.css no define --color-${nombre}`);
  return m[1].toUpperCase();
};
const TINTE_TURQUESA = (POS.match(/--pos-tinte-turquesa:\s*#([0-9A-Fa-f]{6})/) || [])[1]?.toUpperCase();
assert.ok(TINTE_TURQUESA, 'pos.html no define --pos-tinte-turquesa');

// ───────────────────────── 1. estática: los pares de tokens ─────────────────────────

const PARES = [
  // [descripción, texto, fondo, mínimo]
  ['carta.html y menu.html: la firma y la versión (apoyo) sobre arroz', token('apoyo'), token('arroz'), 4.5],
  ['carta.html y menu.html: la firma con el puntero encima (telón) sobre arroz', token('telon'), token('arroz'), 4.5],
  ['index.html: la firma y la versión (ceniza) sobre el telón del pie', token('ceniza'), token('telon'), 4.5],
  ['index.html: la firma con el puntero encima (arroz) sobre telón', token('arroz'), token('telon'), 4.5],
  ['pos.html: el pie del área de trabajo (--text-muted = apoyo) sobre arroz', token('apoyo'), token('arroz'), 4.5],
  ['pos.html: la versión nueva del pie (--text-body = telón) sobre arroz', token('telon'), token('arroz'), 4.5],
  ['pos.html: el pie del login (--text-muted = ceniza) sobre telón', token('ceniza'), token('telon'), 4.5],
  ['pos.html: la versión nueva del pie del login (--text-body = arroz) sobre telón', token('arroz'), token('telon'), 4.5],
  ['pos.html: el aviso, su texto (telón) sobre el tinte de turquesa', token('telon'), TINTE_TURQUESA, 4.5],
  ['pos.html: el aviso, «Después» (barro, el color de enlace) sobre el tinte', token('barro'), TINTE_TURQUESA, 4.5],
  ['pos.html: el aviso, «Recargar» (arroz) sobre el botón telón', token('arroz'), token('telon'), 4.5],
  ['pos.html: el aviso, el ícono (turquesa, no-texto) sobre el tinte', token('turquesa'), TINTE_TURQUESA, 3],
];
for (const [descripcion, texto, fondo, minimo] of PARES) {
  test(`contraste (estático): ${descripcion}`, () => {
    const c = contraste(texto, fondo);
    assert.ok(c >= minimo, `${descripcion}: ${c.toFixed(2)}:1 < ${minimo}:1 (#${texto} sobre #${fondo})`);
  });
}

test('los colores del pie del POS salen de los tokens que se midieron arriba (--text-muted / --text-body por contexto)', () => {
  const css = POS.slice(POS.indexOf('/* ▼ PARTE version-nueva :: css */'), POS.indexOf('/* ▲ PARTE version-nueva :: css */'));
  assert.match(css, /\.pos-pie \{[^}]*color: var\(--text-muted\)/);
  assert.match(css, /\.pos-pie-version\.es-nueva \{[^}]*color: var\(--text-body\)/);
  assert.match(css, /\.aviso-version \{[^}]*background: var\(--pos-tinte-turquesa\)[^}]*color: var\(--color-telon\)/);
  assert.match(POS, /--text-muted: var\(--color-apoyo\)/, 'sobre claro, --text-muted es apoyo');
  assert.match(POS, /\.sobre-telon,\s*\.nav-bar \{[^}]*--text-muted: var\(--color-ceniza\)/, 'sobre telón, --text-muted es ceniza');
  const firma = leer('assets/css/componentes.css');
  assert.match(firma, /\.firma \{[^}]*font-size: \.75rem/, 'la firma de la casa mide .75rem');
  assert.match(firma, /\.firma span \{[^}]*font-weight: 700;[^}]*text-transform: uppercase;[^}]*letter-spacing: \.2em/, 'y su marca va en 700, mayúsculas y .2em, como en lusof');
});

// ───────────────────────── 2. en navegador: lo que se dibuja ─────────────────────────

const pw = buscarPlaywright();
let navegador = null;
let servidorPos = null;
let servidorRaiz = null;
let motivo = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidorPos = await servirPos(RAIZ, 0);
    servidorRaiz = await servirRaiz(RAIZ);
  } catch (e) {
    motivo = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidorPos) await servidorPos.cerrar();
  if (servidorRaiz) await new Promise((r) => servidorRaiz.close(r));
});
const saltar = { skip: navegador ? false : `navegador no disponible: ${motivo}` };

/** Dentro de la página: color de un elemento y su fondo efectivo (los fondos translúcidos se componen hacia arriba). */
const MEDIR = `(sel) => {
  // El primero que se ve: la franja tiene botones que salen por turnos («Cancelar» solo mientras prepara, «Después» el resto del tiempo).
  const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0) || document.querySelector(sel);
  if (!el) return null;
  const rgba = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  let fondo = { r: 255, g: 255, b: 255, a: 1 };
  const capas = [];
  for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c.a > 0) capas.push(c); if (c.a >= 1) break; }
  for (const c of capas.reverse()) fondo = { r: c.r * c.a + fondo.r * (1 - c.a), g: c.g * c.a + fondo.g * (1 - c.a), b: c.b * c.a + fondo.b * (1 - c.a), a: 1 };
  const t = rgba(getComputedStyle(el).color);
  const sobre = { r: t.r * t.a + fondo.r * (1 - t.a), g: t.g * t.a + fondo.g * (1 - t.a), b: t.b * t.a + fondo.b * (1 - t.a) };
  return { texto: [sobre.r, sobre.g, sobre.b], fondo: [fondo.r, fondo.g, fondo.b], tam: parseFloat(getComputedStyle(el).fontSize), visible: el.getClientRects().length > 0 };
}`;
const medir = async (page, sel) => {
  const m = await page.evaluate(`(${MEDIR})(${JSON.stringify(sel)})`);
  assert.ok(m, `no encontré ${sel}`);
  assert.ok(m.visible, `${sel} no está a la vista`);
  return { ...m, razon: razon(m.texto, m.fondo) };
};
const exigir = async (page, sel, minimo, nombre) => {
  const m = await medir(page, sel);
  assert.ok(m.razon >= minimo, `${nombre}: ${m.razon.toFixed(2)}:1 < ${minimo}:1 (${sel}, texto rgb(${m.texto.map(Math.round)}) sobre rgb(${m.fondo.map(Math.round)}))`);
  return m;
};

/** Espera a que terminen las transiciones de color en curso (un botón que pasa de deshabilitado a habilitado se pinta a medias unos 150 ms). */
const esperarTransiciones = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))).then(() => undefined));

async function abrirPos(page, vista) {
  const def = VISTAS[vista];
  const sesion = def.sesion !== false;
  await prepararPagina(page, { url: servidorPos.url, datos: datosFicticios((d) => def.ajustar?.(d)), sesion, dirCache: path.join(os.tmpdir(), 'resplandor-pos-cdn'), bloquearFuentes: true });
  await page.goto(`${servidorPos.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page, { sesion });
  await def.llegar(page);
  await esperarEstable(page);
}
async function conPagina(ancho, alto, fn) {
  const contexto = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
  try { return await fn(await contexto.newPage()); } finally { await contexto.close(); }
}

test('pos.html (área de trabajo): la firma y la versión del pie, en sus dos estados, sobre arroz — a 390 y a 1280 px', saltar, async () => {
  for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
    await conPagina(ancho, alto, async (page) => {
      await abrirPos(page, 'mesas');
      for (const sel of ['footer.pos-pie a.firma', 'footer.pos-pie a.firma span', 'footer.pos-pie .pos-pie-version']) {
        const m = await exigir(page, sel, 4.5, `${ancho} px, pie normal`);
        assert.equal(m.tam, 12, 'texto pequeño: 12 px');
      }
      await page.evaluate(() => { Alpine.store('pos').versionPublicada = '2099.01.01-abcdef0'; });
      await page.waitForFunction(() => /Hay una versión nueva/.test(document.querySelector('footer.pos-pie .pos-pie-version').innerText));
      await exigir(page, 'footer.pos-pie .pos-pie-version', 4.5, `${ancho} px, pie con versión nueva`);
      await page.locator('footer.pos-pie a.firma').hover();
      await exigir(page, 'footer.pos-pie a.firma', 4.5, `${ancho} px, firma con el puntero encima`);
    });
  }
});

test('pos.html (login): la firma y la versión del pie sobre el telón', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    await abrirPos(page, 'login');
    for (const sel of ['.pos-pie-login a.firma', '.pos-pie-login a.firma span', '.pos-pie-login .pos-pie-version']) await exigir(page, sel, 4.5, 'login');
    await page.evaluate(() => { Alpine.store('pos').versionPublicada = '2099.01.01-abcdef0'; });
    await page.waitForFunction(() => /Hay una versión nueva/.test(document.querySelector('.pos-pie-login .pos-pie-version').innerText));
    await exigir(page, '.pos-pie-login .pos-pie-version', 4.5, 'login, versión nueva');
  });
});

test('pos.html: el aviso de versión nueva — texto, «Después» y «Recargar» ≥ 4,5:1 y su ícono ≥ 3:1', saltar, async () => {
  for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
    await conPagina(ancho, alto, async (page) => {
      await abrirPos(page, 'version-aviso');
      await exigir(page, '.aviso-version .aviso-version-txt', 4.5, `${ancho} px, texto del aviso`);
      const despues = await page.locator('.aviso-version .btn-enlace:visible').innerText();
      assert.equal(despues, 'Después', `${ancho} px: el aviso normal ofrece «Después»`);
      await exigir(page, '.aviso-version .btn-enlace', 4.5, `${ancho} px, «Después»`);
      await exigir(page, '.aviso-version .btn-telon', 4.5, `${ancho} px, «Recargar»`);
      const icono = await medir(page, '.aviso-version-fila > svg');
      assert.ok(icono.razon >= 3, `${ancho} px, ícono: ${icono.razon.toFixed(2)}:1 < 3:1`);
      assert.deepEqual(icono.texto.map(Math.round), hexARgb(token('turquesa')), `${ancho} px: el ícono se pinta turquesa (y no hereda el color del texto: Lucide cambia el <i> por un <svg>)`);
    });
  }
});

test('pos.html: la franja mientras «Recargar» baja («Descargando…» con «Cancelar») y cuando la versión está lista («Recargar ahora» con «Después») ≥ 4,5:1', saltar, async () => {
  for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
    await conPagina(ancho, alto, async (page) => {
      await abrirPos(page, 'version-aviso');
      // Descargando: «Cancelar» sustituye a «Después» y el botón principal, ocupado, es de los deshabilitados (que WCAG no mide).
      await page.evaluate(() => { const s = Alpine.store('pos'); s.versionRecargando = true; s.versionRecargaNota = 'Descargando la versión nueva…'; });
      await page.waitForFunction(() => /Descargando/.test(document.querySelector('.aviso-version .aviso-version-txt').innerText));
      await page.waitForFunction(() => [...document.querySelectorAll('.aviso-version .btn-enlace')].filter((e) => e.getClientRects().length).map((e) => e.innerText).join() === 'Cancelar');   // y «Después» le cede el sitio
      await esperarTransiciones(page);
      await exigir(page, '.aviso-version .aviso-version-txt', 4.5, `${ancho} px, «Descargando…»`);
      await exigir(page, '.aviso-version .btn-enlace', 4.5, `${ancho} px, «Cancelar»`);
      // Lista: «Recargar ahora» (el mismo botón telón) con «Después».
      await page.evaluate(() => { const s = Alpine.store('pos'); s.versionRecargando = false; s.versionRecargaNota = ''; s.versionLista = s.versionPublicada; });
      await page.waitForFunction(() => document.querySelector('.aviso-version .aviso-version-txt').innerText === 'La versión nueva está lista');
      assert.equal(await page.locator('.aviso-version .btn-telon').innerText(), 'Recargar ahora');
      await page.waitForFunction(() => [...document.querySelectorAll('.aviso-version .btn-enlace')].filter((e) => e.getClientRects().length).map((e) => e.innerText).join() === 'Después');
      await esperarTransiciones(page);
      await exigir(page, '.aviso-version .aviso-version-txt', 4.5, `${ancho} px, «La versión nueva está lista»`);
      await exigir(page, '.aviso-version .btn-telon', 4.5, `${ancho} px, «Recargar ahora»`);
      await exigir(page, '.aviso-version .btn-enlace', 4.5, `${ancho} px, «Después» con la versión lista`);
    });
  }
});

/** Una página pública (sin red hacia fuera: Alpine, las fuentes y Supabase quedan fuera; el pie es HTML estático). */
async function conPublica(pagina, ancho, fn) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 800 } });
  try {
    const page = await contexto.newPage();
    const origen = `http://127.0.0.1:${servidorRaiz.address().port}`;
    await page.route('**/*', (r) => (r.request().url().startsWith(origen) ? r.continue() : r.abort('blockedbyclient')));
    await page.goto(`${origen}/${pagina}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    await contexto.close();
  }
}

for (const [pagina, pie] of [['carta.html', 'footer.carta-pie'], ['menu.html', 'footer:last-of-type'], ['index.html', 'footer']]) {
  test(`${pagina}: la firma «Ynt-labs» y la versión del pie ≥ 4,5:1 sobre su fondo (también con el puntero encima de la firma)`, saltar, async () => {
    for (const ancho of [390, 1280]) {
      await conPublica(pagina, ancho, async (page) => {
        const sel = (x) => `${pie} ${x}`;
        for (const x of ['a.firma', 'a.firma span', '.pie-version']) {
          const m = await exigir(page, sel(x), 4.5, `${pagina} a ${ancho} px`);
          assert.equal(m.tam, 12, `${pagina}: ${x} mide 12 px`);
        }
        assert.match(await page.locator(sel('.pie-version')).innerText(), /^versión \d{4}\.\d{2}\.\d{2}-[0-9a-f]{7}$/);
        // Alto táctil de la firma (44 px), como los demás enlaces del pie.
        const alto = await page.locator(sel('a.firma')).evaluate((e) => e.getBoundingClientRect().height);
        assert.ok(alto >= 44, `${pagina}: la firma mide ${alto} px de alto (< 44)`);
        await page.locator(sel('a.firma')).scrollIntoViewIfNeeded();
        await page.locator(sel('a.firma')).hover();
        await page.waitForTimeout(250);   // la transición de color de .15 s
        await exigir(page, sel('a.firma'), 4.5, `${pagina} a ${ancho} px, firma con el puntero encima`);
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.equal(desborde, 0, `${pagina}: sin scroll lateral a ${ancho} px`);
      });
    }
  });
}
