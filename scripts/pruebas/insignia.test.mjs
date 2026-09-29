// La insignia «Hoy · fecha» del menú del día de carta.html cabe en una línea (tarea
// insignia-carta, 2026-09-29).
//
// El síntoma: a 375 px la insignia se partía en dos renglones («Hoy ·» y la fecha, partida
// también). Vivía en la columna izquierda de una fila `flex justify-between` que compartía con
// el precio (`$ 23.000`, que no se parte): a 375 px le quedaban 204 px (301 de la tarjeta − 85
// del precio − 12 del hueco) y la fecha más ancha mide 233,4. La más ancha es «Hoy · miércoles,
// N de septiembre»: medido en Chromium con Archivo sobre las 2.505 fechas sin domingo de 2026 a
// 2033 (el número del día casi no mueve el ancho: 233,38 a 233,39 px). El arreglo saca las dos
// insignias de esa fila: cuelgan de la tarjeta, a todo su ancho (246 px a 320, 301 a 375).
//
// Dos partes, como desborde.test.mjs:
//   1. ESTÁTICA (corre siempre, también en CI): las dos insignias de #dia cuelgan de la tarjeta
//      y no comparten fila con el precio. Falla con el marcado viejo.
//   2. EN NAVEGADOR (solo si hay Playwright y un Chromium, ver _navegador.mjs): con el reloj el
//      miércoles 30 de septiembre de 2026 (la fecha más ancha) y el domingo 27 (la otra
//      insignia), la insignia visible ocupa un renglón a 320 y a 375 px. Necesita la red para
//      bajar Archivo de Google Fonts (sin la fuente la medición no vale y se salta) y nunca toca
//      Supabase: cualquier pedido a *.supabase.co se contesta con una lista vacía.
//
// Si cambias el formato de `fechaLarga` o el tamaño de `.badge`, vuelve a buscar la fecha más
// ancha y a medir a 320 px.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, ' ');

// ───────────────────────── 1. estática: de quién cuelga la insignia ─────────────────────────

/** Cada <div> de `html`, con su clase y el tramo [inicio, fin) que ocupa. */
function divs(html) {
  const abiertos = [];
  const cerrados = [];
  for (const m of html.matchAll(/<(\/?)div\b([^>]*)>/g)) {
    if (!m[1]) abiertos.push({ clase: (m[2].match(/class="([^"]*)"/) || [])[1] || '', inicio: m.index });
    else cerrados.push({ ...abiertos.pop(), fin: m.index + m[0].length });
  }
  return cerrados;
}

/** El <div> más interno que contiene la posición `i`. */
const envolvente = (lista, i) => lista.filter((d) => d.inicio < i && i < d.fin).sort((a, b) => b.inicio - a.inicio)[0];

test('carta.html: las insignias del menú del día cuelgan de la tarjeta, no de la fila del precio', () => {
  const dia = sinComentarios(fs.readFileSync(path.join(RAIZ, 'carta.html'), 'utf8')).match(/<section id="dia"[\s\S]*?<\/section>/);
  assert.ok(dia, 'no encontré <section id="dia"> en carta.html');
  const lista = divs(dia[0]);
  const precio = dia[0].indexOf('x-text="pesos(dia.precio)"');
  assert.ok(precio !== -1, 'no encontré el precio del menú del día');
  const fila = envolvente(lista, precio);
  const insignias = [...dia[0].matchAll(/<span class="badge\b[^"]*" x-show="!?hayMenu"/g)].map((m) => m.index);
  assert.equal(insignias.length, 2, 'las dos insignias: «Hoy · fecha» y «Domingo · sin menú del día»');
  for (const i of insignias) {
    assert.match(envolvente(lista, i).clase, /\bcard\b/, 'la insignia cuelga directo de la tarjeta, a todo su ancho');
    assert.ok(!(fila.inicio < i && i < fila.fin), 'la insignia no comparte fila con el precio');
  }
});

// ───────────────────────── 2. en navegador: un renglón de verdad ─────────────────────────

const ANCHOS = [320, 375];
// Mediodía en Bogotá (UTC−5 fijo).
const INSTANTES = {
  'miércoles 30 de septiembre de 2026': '2026-09-30T17:00:00Z',
  'domingo 27 de septiembre de 2026': '2026-09-27T17:00:00Z',
};

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivoNavegador = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidor = await servirRaiz(RAIZ);
  } catch (e) {
    motivoNavegador = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await new Promise((resolver) => servidor.close(resolver));
});

for (const ancho of ANCHOS) {
  for (const [dia, instante] of Object.entries(INSTANTES)) {
    test(`carta.html a ${ancho} px, el ${dia}: la insignia del menú del día ocupa un renglón (medido en Chromium)`, { skip: navegador ? false : `navegador no disponible: ${motivoNavegador}` }, async (t) => {
      const contexto = await navegador.newContext({ viewport: { width: ancho, height: 800 } });
      try {
        const page = await contexto.newPage();
        if (!page.clock) return t.skip('este Playwright no trae page.clock (pide ≥ 1.45)');
        await page.clock.setFixedTime(new Date(instante));
        // Nunca se toca Supabase: lo que pida la página a *.supabase.co se contesta vacío.
        await page.route(/\.supabase\.co\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
        await page.goto(`http://127.0.0.1:${servidor.address().port}/carta.html`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const archivo = await page.evaluate(() => [...document.fonts].some((f) => /Archivo/.test(f.family) && f.status === 'loaded'));
        if (!archivo) return t.skip('Archivo no cargó (¿sin red hacia Google Fonts?): con la fuente de respaldo la medición no vale');
        // Alpine ya decidió cuál se ve y escribió la fecha.
        await page.waitForFunction(() => {
          const visibles = [...document.querySelectorAll('#dia .badge')].filter((e) => e.getClientRects().length);
          return visibles.length === 1 && !/·$/.test(visibles[0].textContent.trim());
        });

        const r = await page.evaluate(() => {
          const insignia = [...document.querySelectorAll('#dia .badge')].find((e) => e.getClientRects().length);
          const renglones = new Set();
          const recorrido = document.createTreeWalker(insignia, NodeFilter.SHOW_TEXT);
          for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) {
            if (!n.textContent.trim()) continue;
            const rango = document.createRange();
            rango.selectNodeContents(n);
            for (const caja of rango.getClientRects()) renglones.add(Math.round(caja.top));
          }
          return { texto: insignia.textContent.replace(/\s+/g, ' ').trim(), renglones: renglones.size };
        });
        assert.equal(r.renglones, 1, `«${r.texto}» ocupa ${r.renglones} renglones a ${ancho} px`);
      } finally {
        await contexto.close();
      }
    });
  }
}
