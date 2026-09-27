// «Hoy»/día de la semana en hora de Colombia — nunca en la del navegador de quien mira
// la página (hallazgo N6, ronda 3). Dos superficies tienen la misma cuenta y las dos se
// prueban acá, contra el código REAL (no una reimplementación):
//
//   1. assets/js/vivo.js (RESPLANDOR_VIVO.diaSemanaDe/lunesDe) — lo usa landing.js para
//      marcar esHoy en #hoy. Se importa tal cual (mismo patrón que mcp.test.mjs: primero
//      local.js, que deja globalThis.RESPLANDOR, y recién después vivo.js).
//   2. menu.html — trae su propia copia (no carga vivo.js: lee/escribe con supabase-js
//      directo, ver comentario en el propio archivo). Como es un <script> inline dentro
//      de un .html y no un módulo, se extrae el texto entre <script> y el primer
//      document.addEventListener('alpine:init' — ahí viven bogota/diaSemanaBogota/
//      lunesDe/sumarSemanas y nada más que dependa de document/Alpine — y se corre en un
//      contexto `vm` nuevo para tener esas cuatro funciones como valores de verdad.
//
// El caso de fondo (el que pide la tarea): una persona en Madrid mirando la página a la
// 01:00 de su martes está viendo el lunes 18:00 en Bogotá — «hoy» tiene que decir lunes.
// Ese instante, en UTC, es 2026-09-28T23:00:00Z (2026-09-28 es lunes). Se prueba tal cual
// -- sin togocar `process.env.TZ` para simular a la persona de Madrid: diaSemanaDe/
// lunesDe/sumarSemanas nunca leen la hora LOCAL del proceso (solo campos UTC de un
// instante ya corrido -5h), así que da igual bajo qué zona corra esta prueba o el
// navegador de quien mire la página — eso mismo es lo que se comprueba más abajo
// variando `process.env.TZ` a propósito.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import '../../assets/js/local.js'; // side-effect: globalThis.RESPLANDOR
import '../../assets/js/vivo.js'; // side-effect: globalThis.RESPLANDOR_VIVO

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V = globalThis.RESPLANDOR_VIVO;

// Lunes 2026-09-28, 18:00 en Bogotá == martes 2026-09-29, 01:00 en Madrid (CEST, UTC+2).
const INSTANTE_MADRUGADA_MADRID = '2026-09-28T23:00:00.000Z';
// Domingo 2026-09-27, 18:00 en Bogotá == lunes 2026-09-28, 01:00 en Madrid (CEST, UTC+2):
// quien mira desde Madrid ya ve "lunes" en su reloj, pero en Bogotá sigue siendo domingo
// — sin menú del día (R6, ronda 4: carta.html leía `new Date().getDay()`, la hora del
// navegador, y le habría dado lunes).
const INSTANTE_DOMINGO_TARDE_BOGOTA = '2026-09-27T23:00:00.000Z';
// Madrugada de Bogotá (00:00 del martes) == todavía lunes 22:00 en Los Ángeles (PDT,
// UTC-7): cruce en la otra dirección, para no probar solo el caso "visitante adelantado".
const INSTANTE_MEDIANOCHE_BOGOTA = '2026-09-29T05:00:00.000Z';
// Instante sin cruce cerca, de control.
const INSTANTE_MIERCOLES_DE_DIA = '2026-09-30T15:00:00.000Z';

function bajoZona(zona, fn) {
  const anterior = process.env.TZ;
  process.env.TZ = zona;
  try {
    return fn();
  } finally {
    if (anterior === undefined) delete process.env.TZ;
    else process.env.TZ = anterior;
  }
}

// ───────────────────────── assets/js/vivo.js ─────────────────────────

test('RESPLANDOR_VIVO.diaSemanaDe: lunes 18:00 Bogotá (martes 01:00 Madrid) sigue siendo lunes', () => {
  assert.equal(V.diaSemanaDe(new Date(INSTANTE_MADRUGADA_MADRID)), 1);
});

test('RESPLANDOR_VIVO.diaSemanaDe: medianoche de Bogotá ya es martes, aunque en Los Ángeles siga siendo lunes', () => {
  assert.equal(V.diaSemanaDe(new Date(INSTANTE_MEDIANOCHE_BOGOTA)), 2);
});

test('RESPLANDOR_VIVO.diaSemanaDe: un miércoles de día, sin cruce, de control', () => {
  assert.equal(V.diaSemanaDe(new Date(INSTANTE_MIERCOLES_DE_DIA)), 3);
});

test('RESPLANDOR_VIVO.lunesDe: el instante "martes 01:00 Madrid" todavía cae en la semana que empieza el lunes 28', () => {
  assert.equal(V.lunesDe(new Date(INSTANTE_MADRUGADA_MADRID)), '2026-09-28');
});

// La propiedad que importa: NINGUNA de las dos lee la hora local del proceso (solo
// campos UTC de un instante ya corrido -5h) — así que da igual la zona de quien mire la
// página. Si alguien "mejora" esto algún día con `new Date().getDay()` o con
// Intl.DateTimeFormat sin fijar timeZone, esta prueba se rompe.
test('RESPLANDOR_VIVO.diaSemanaDe/lunesDe: mismo resultado sin importar la zona del proceso', () => {
  const zonas = ['America/Bogota', 'Europe/Madrid', 'Pacific/Auckland', 'UTC'];
  const resultados = zonas.map((z) => bajoZona(z, () => ({
    dia: V.diaSemanaDe(new Date(INSTANTE_MADRUGADA_MADRID)),
    lunes: V.lunesDe(new Date(INSTANTE_MADRUGADA_MADRID)),
  })));
  for (const r of resultados) {
    assert.equal(r.dia, 1);
    assert.equal(r.lunes, '2026-09-28');
  }
});

// ───────────────────────── menu.html (inline) ─────────────────────────

// Extrae bogota/diaSemanaBogota/lunesDe/sumarSemanas del <script> inline de menu.html
// (no son un módulo: viven en un <script> plano). El bloque entre <script> y el primer
// `document.addEventListener('alpine:init'` no toca document/Alpine/Alpine — son
// funciones puras de fecha —, así que correrlo en un contexto `vm` nuevo alcanza para
// tenerlas como funciones de verdad, sin reimplementarlas a mano en la prueba.
function funcionesDeMenuHtml() {
  const html = fs.readFileSync(path.join(RAIZ, 'menu.html'), 'utf8');
  const marcaInicio = '<script>\n    const SUPABASE_URL';
  const marcaFin = "document.addEventListener('alpine:init'";
  const inicio = html.indexOf(marcaInicio);
  assert.ok(inicio !== -1, 'no encontré el <script> inline de menu.html (¿cambió la estructura?)');
  const fin = html.indexOf(marcaFin, inicio);
  assert.ok(fin !== -1, 'no encontré el final del bloque a extraer en menu.html (¿cambió el orden del <script>?)');
  const bloque = html.slice(inicio + '<script>'.length, fin);
  assert.match(bloque, /function sumarSemanas/, 'el bloque extraído de menu.html ya no trae sumarSemanas: revisá los marcadores de esta prueba');
  const envoltorio = `${bloque}\n;({ bogota, diaSemanaBogota, lunesDe, sumarSemanas });`;
  return vm.runInNewContext(envoltorio, {}, { filename: 'menu.html (inline, extraído)' });
}

const M = funcionesDeMenuHtml();

test('menu.html — diaSemanaBogota: mismo criterio que vivo.js (martes 01:00 Madrid sigue siendo lunes)', () => {
  assert.equal(M.diaSemanaBogota(new Date(INSTANTE_MADRUGADA_MADRID)), 1);
});

test('menu.html — diaSemanaBogota: medianoche de Bogotá ya es martes aunque en Los Ángeles siga siendo lunes', () => {
  assert.equal(M.diaSemanaBogota(new Date(INSTANTE_MEDIANOCHE_BOGOTA)), 2);
});

test('menu.html — lunesDe: coincide con RESPLANDOR_VIVO.lunesDe en el cruce de medianoche', () => {
  assert.equal(M.lunesDe(new Date(INSTANTE_MADRUGADA_MADRID)), V.lunesDe(new Date(INSTANTE_MADRUGADA_MADRID)));
});

// Hallazgo propio de esta ronda (no estaba pedido, pero lo desenterró arreglar N6): antes
// `cambiarSemana` reconstruía una medianoche LOCAL del lunes mostrado y la volvía a pasar
// por lunesDe (pensada para "¿qué día es AHORA en Bogotá?", no para "sumale 7 días a esta
// fecha ya conocida"). Para quien mira la página desde una zona adelantada a Bogotá, esa
// medianoche local caía en un instante que lunesDe leía como el día de calendario
// ANTERIOR, y «Semana siguiente» devolvía la semana que ya se estaba mostrando. Por eso
// sumarSemanas es pura aritmética de calendario (Date.UTC + setUTCDate), sin pasar por
// bogota()/lunesDe(): no debe cambiar aunque cambie la zona del proceso.
test('menu.html — sumarSemanas: pura aritmética de calendario, sin importar la zona del proceso', () => {
  const zonas = ['America/Bogota', 'Europe/Madrid', 'Pacific/Auckland', 'UTC'];
  for (const z of zonas) {
    bajoZona(z, () => {
      assert.equal(M.sumarSemanas('2026-09-28', 1), '2026-10-05', `con TZ=${z}`);
      assert.equal(M.sumarSemanas('2026-09-28', -1), '2026-09-21', `con TZ=${z}`);
    });
  }
});

test('menu.html — sumarSemanas: ida y vuelta (siguiente + anterior) devuelve la misma semana', () => {
  const semana = '2026-12-28'; // cruce de año, para no probarlo solo con un caso fácil
  assert.equal(M.sumarSemanas(M.sumarSemanas(semana, 1), -1), semana);
});

// ───────────────────────── carta.html (inline) ─────────────────────────

// A diferencia de menu.html, `hayMenu` y `fechaLarga` de carta.html son getters que leen
// `new Date()` directamente — no reciben el instante como parámetro (R6, ronda 4: antes
// era `new Date().getDay()`/`.toLocaleDateString()` sin `timeZone`, la hora del
// navegador). Para probarlas con un instante fijo se corre el <script> inline completo
// de carta.html en un contexto `vm` nuevo, sustituyendo el `Date` global de ESE contexto
// por uno cuyo constructor sin argumentos devuelve el instante pedido — `new Date(x)` con
// argumentos (fechaFoto, cuentaSub) sigue siendo el Date real, sin tocar. `carta()` es una
// función normal (no un módulo): instanciarla con `carta()` no llama a `.init()` (esa sí
// toca `location`/`fetch`), así que alcanza con leer los getters ya armados.
function cartaHtmlConInstante(instanteISO) {
  const html = fs.readFileSync(path.join(RAIZ, 'carta.html'), 'utf8');
  const inicio = html.indexOf('<script>');
  assert.ok(inicio !== -1, 'no encontré el <script> inline de carta.html (¿cambió la estructura?)');
  const fin = html.indexOf('</script>', inicio);
  assert.ok(fin !== -1, 'no encontré el cierre del <script> inline de carta.html');
  const bloque = html.slice(inicio + '<script>'.length, fin);
  assert.match(bloque, /function bogota/, 'el bloque extraído de carta.html ya no trae bogota(): revisá los marcadores de esta prueba');
  assert.match(bloque, /function carta\(\)/, 'el bloque extraído de carta.html ya no trae carta(): revisá los marcadores de esta prueba');

  class FechaFija extends Date {
    constructor(...args) {
      if (args.length === 0) { super(instanteISO); return; }
      super(...args);
    }
    static now() { return new Date(instanteISO).getTime(); }
  }
  const contexto = { Date: FechaFija, console };
  vm.createContext(contexto);
  vm.runInContext(bloque, contexto, { filename: 'carta.html (inline, extraído)' });
  return vm.runInContext('carta()', contexto, { filename: 'carta.html (inline, extraído)' });
}

test('carta.html — hayMenu: domingo 18:00 Bogotá (lunes 01:00 Madrid) NO es lunes, sin menú del día', () => {
  const c = cartaHtmlConInstante(INSTANTE_DOMINGO_TARDE_BOGOTA);
  assert.equal(c.hayMenu, false);
});

test('carta.html — hayMenu: lunes 18:00 Bogotá (martes 01:00 Madrid) sigue siendo lunes, con menú del día', () => {
  const c = cartaHtmlConInstante(INSTANTE_MADRUGADA_MADRID);
  assert.equal(c.hayMenu, true);
});

test('carta.html — hayMenu: un miércoles de día, sin cruce, de control', () => {
  const c = cartaHtmlConInstante(INSTANTE_MIERCOLES_DE_DIA);
  assert.equal(c.hayMenu, true);
});

// La máquina donde corre esta prueba puede tener TZ=America/Bogota por defecto (es el
// caso de este repo), y ahí el instante de arriba ya "da bien" incluso con el código
// viejo (`new Date().getDay()`) — no alcanzaría para detectar la regresión de R6. Se
// repite bajo otras zonas a propósito, igual que ya hace esta prueba con vivo.js/menu.html.
test('carta.html — hayMenu: mismo resultado sin importar la zona del proceso', () => {
  const zonas = ['America/Bogota', 'Europe/Madrid', 'Pacific/Auckland', 'UTC'];
  for (const z of zonas) {
    bajoZona(z, () => {
      assert.equal(cartaHtmlConInstante(INSTANTE_DOMINGO_TARDE_BOGOTA).hayMenu, false, `con TZ=${z}`);
      assert.equal(cartaHtmlConInstante(INSTANTE_MADRUGADA_MADRID).hayMenu, true, `con TZ=${z}`);
    });
  }
});

test('carta.html — fechaLarga: domingo 18:00 Bogotá dice "domingo", aunque en Madrid ya sea lunes', () => {
  const c = cartaHtmlConInstante(INSTANTE_DOMINGO_TARDE_BOGOTA);
  assert.match(c.fechaLarga, /^domingo\b/);
});

// Misma propiedad que ya se prueba para vivo.js/menu.html: da igual la zona del proceso,
// porque fechaLarga fija `timeZone: 'America/Bogota'` explícito en vez de depender de la
// zona por defecto de Intl.
test('carta.html — fechaLarga: mismo resultado sin importar la zona del proceso', () => {
  const zonas = ['America/Bogota', 'Europe/Madrid', 'Pacific/Auckland', 'UTC'];
  const resultados = zonas.map((z) => bajoZona(z, () => cartaHtmlConInstante(INSTANTE_DOMINGO_TARDE_BOGOTA).fechaLarga));
  for (const r of resultados) assert.match(r, /^domingo\b/);
});
