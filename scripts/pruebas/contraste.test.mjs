// Prueba de contraste (docs/identidad-visual.md §3 y §11-A4): lee los tokens de color del
// `@theme static` de assets/css/base.css y recalcula, con la fórmula WCAG 2.x de verdad
// (luminancia relativa + razón de contraste), cada par «permitido» que declara §3 —
// nunca los pares marcados «Prohibido» ahí, que documentan a propósito una combinación que
// NO se usa. Exige el mínimo real: texto normal ≥ 4,5:1; texto grande o no-texto/foco ≥ 3:1
// (§11-A4). También exige que existan los 4 tokens nuevos con el hex exacto del contrato, y
// que NO exista ninguno de los tokens descartados en §0 (noche, selva, barro, quemado,
// turquesa) — si alguien los reintroduce, esta prueba lo nota.
//
// Escrita CONTRA EL CONTRATO: hoy (2026-09-28) base.css todavía no tiene los 4 tokens
// nuevos (terracota, amber-tinta, teal-tinta, letrero) — los agrega la parte «Base visual»,
// en paralelo — así que la prueba de «existen los 4 tokens» y las de los pares que los usan
// fallan HOY por esa razón esperada. En cuanto base.css los tenga, con el hex del contrato,
// pasan solas. Mismo patrón que scripts/pruebas/descubrimiento.test.mjs con el JSON-LD.
//
// La fórmula se validó a mano contra los 24 valores que el propio brief midió en §3 (todos
// coinciden a la centésima con relLum()/contrast() de acá, incluidos los dos pares con
// alpha — parch/70 y parch/55 sobre ink, compuestos con compositar() antes de medir el
// contraste contra el fondo ink real): si un token cambia de hex, esta prueba lo nota.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => path.join(RAIZ, ...p);

const BASE_CSS = fs.readFileSync(ruta('assets/css/base.css'), 'utf8');

// ───────────────────────── tokens: solo lo que hay DENTRO de «@theme static { … }» ─────────────────────────

// Recorta el bloque `@theme static { … }` contando llaves (nunca una regex «hasta el
// próximo }», que se equivocaría con la primera «}» de un comentario o de otro bloque).
function bloqueThemeStatic(css) {
  const inicio = css.indexOf('@theme static');
  assert.ok(inicio !== -1, 'base.css no tiene un bloque «@theme static»');
  const abre = css.indexOf('{', inicio);
  assert.ok(abre !== -1, 'base.css: «@theme static» sin «{»');
  let profundidad = 0;
  for (let i = abre; i < css.length; i++) {
    if (css[i] === '{') profundidad++;
    else if (css[i] === '}') {
      profundidad--;
      if (profundidad === 0) return css.slice(abre + 1, i);
    }
  }
  throw new Error('base.css: «@theme static {» nunca cierra');
}

const BLOQUE_TEMA = bloqueThemeStatic(BASE_CSS);

// --color-<nombre>: #RRGGBB → mapa nombre (sin «--color-») → hex en MAYÚSCULAS sin «#».
function tokensDeColor(bloque) {
  const mapa = new Map();
  const re = /--color-([a-z0-9-]+)\s*:\s*#([0-9A-Fa-f]{6})\b/g;
  let m;
  while ((m = re.exec(bloque))) mapa.set(m[1], m[2].toUpperCase());
  return mapa;
}

const TOKENS = tokensDeColor(BLOQUE_TEMA);

// ───────────────────────── WCAG 2.x: luminancia relativa y razón de contraste ─────────────────────────

function hexARgb(hex) {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminanciaRelativa([r, g, b]) {
  const canal = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [rl, gl, bl] = [canal(r), canal(g), canal(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contraste(hexA, hexB) {
  const la = luminanciaRelativa(hexARgb(hexA));
  const lb = luminanciaRelativa(hexARgb(hexB));
  const [alta, baja] = la > lb ? [la, lb] : [lb, la];
  return (alta + 0.05) / (baja + 0.05);
}

// Un texto `fgHex` a opacidad `alpha` (0–1) pintado sobre un fondo OPACO `bgHex» se ve como
// esta mezcla por canal — el mismo cálculo que hace cualquier navegador al componer rgba()
// sobre un fondo sólido. Así se puede medir el contraste real de `parch/70`/`parch/55`
// (texto secundario sobre `ink`, §3) contra el `ink` que de verdad los rodea.
function compositar(fgHex, alpha, bgHex) {
  const fg = hexARgb(fgHex);
  const bg = hexARgb(bgHex);
  const mezcla = fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]);
  return mezcla.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ───────────────────────── el contrato de §3 ─────────────────────────

const TOKENS_NUEVOS = [
  ['terracota', 'CE8965'],
  ['amber-tinta', '8C611F'],
  ['teal-tinta', '256F67'],
  ['letrero', 'ED6B50'],
];
const TOKENS_DESCARTADOS = ['noche', 'selva', 'barro', 'quemado', 'turquesa'];

const MINIMOS = { texto: 4.5, 'texto-grande': 3, 'no-texto': 3 };

// Cada par «permitido» de la tabla de §3 — nunca uno de los marcados «Prohibido» ahí (esos
// documentan a propósito una combinación que la landing/carta/menú NUNCA usan). `min` es el
// mínimo WCAG real de §11-A4 según cómo se usa el par (rol citado en el comentario, tomado
// de §3/§4/§7 del contrato): con esos 4 tokens nuevos, esta lista cubre los 24 valores que
// el propio brief midió.
const PARES = [
  ['ink', 'parch', 'texto', 'body text sobre el fondo de página'],
  ['muted', 'parch', 'texto', 'texto de apoyo sobre parch'],
  ['ink-5', 'parch', 'texto', 'texto secundario (comp-k, etc.) sobre parch'],
  ['muted', 'card', 'texto', 'texto de apoyo sobre card'],
  ['ink-5', 'card', 'texto', 'texto secundario sobre card'],
  ['amber-light', 'ink', 'texto', 'eyebrow/anillo de foco sobre ink (.sobre-ink)'],
  ['letrero', 'ink', 'texto-grande', 'rótulo «RESPLANDOR» del pie (grande, decorativo)'],
  ['ember', 'parch', 'texto', 'enlace/ícono ember sobre parch'],
  ['ember', 'card', 'texto', 'enlace/ícono ember sobre card'],
  ['ink', 'amber', 'texto', 'texto de .btn-oro (fondo amber, texto ink)'],
  ['amber-tinta', 'parch', 'texto', 'precios/eyebrow sobre parch'],
  ['amber-tinta', 'card', 'texto', 'precios/eyebrow sobre card'],
  ['amber-tinta', 'amber-faint', 'texto', '.badge-amber'],
  ['amber-tinta', 'soft', 'texto', 'aviso sobre fondo soft'],
  ['teal', 'parch', 'texto', 'ícono/texto de estado sobre parch'],
  ['teal', 'card', 'texto', 'ícono/texto de estado sobre card'],
  ['teal-tinta', 'teal-faint', 'texto', '.badge-teal'],
  ['teal-tinta', 'parch', 'texto', 'texto de estado sobre parch'],
  ['teal-tinta', 'card', 'texto', 'texto de estado sobre card'],
  ['ink', 'terracota', 'texto', 'texto/anillo de foco ink sobre la banda .pared'],
];

// Los dos pares con opacidad (texto secundario sobre ink, §3): `alpha` se compone sobre el
// fondo `bg` ANTES de medir contraste — nunca se mide `parch` puro contra `ink`, sería otro
// número (15,60, la fila de arriba) y no lo que de verdad ve la persona.
const PARES_CON_ALPHA = [
  ['parch', 0.7, 'ink', 'texto', 'texto secundario sobre ink (parch/70)'],
  ['parch', 0.55, 'ink', 'texto', 'el mínimo aceptado de texto secundario sobre ink (parch/55)'],
];

// Blanco no es un token con nombre en base.css (es `#FFFFFF`, igual que `card`): se declara
// acá para el botón .btn-ember (texto blanco) y su estado hover .btn-ember:hover (ember-light).
const BLANCO = 'FFFFFF';
const PARES_BLANCO = [
  ['ember', 'texto', 'texto blanco de .btn-ember'],
  ['ember-light', 'texto', 'texto blanco de .btn-ember:hover'],
];

// ───────────────────────── pruebas ─────────────────────────

test('existen los 4 tokens nuevos de §3, con el hex exacto del contrato', () => {
  const fallas = [];
  for (const [nombre, hexEsperado] of TOKENS_NUEVOS) {
    const real = TOKENS.get(nombre);
    if (real === undefined) fallas.push(`falta --color-${nombre} en base.css`);
    else if (real !== hexEsperado) fallas.push(`--color-${nombre}: #${real}, el contrato pide #${hexEsperado}`);
  }
  assert.deepEqual(fallas, []);
});

test('no existe ninguno de los tokens descartados en §0 (noche, selva, barro, quemado, turquesa)', () => {
  const presentes = TOKENS_DESCARTADOS.filter((n) => TOKENS.has(n));
  assert.deepEqual(presentes, [], `tokens descartados que siguen en base.css: ${presentes.join(', ')}`);
});

for (const [fg, bg, tipo, rol] of PARES) {
  test(`contraste ${fg} sobre ${bg} (${rol}) ≥ ${MINIMOS[tipo]}:1`, () => {
    assert.ok(TOKENS.has(fg), `falta el token --color-${fg} en base.css`);
    assert.ok(TOKENS.has(bg), `falta el token --color-${bg} en base.css`);
    const razon = contraste(TOKENS.get(fg), TOKENS.get(bg));
    assert.ok(razon >= MINIMOS[tipo] - 1e-9, `${fg}/${bg} = ${razon.toFixed(2)}:1, se necesita ≥ ${MINIMOS[tipo]}:1 (${rol})`);
  });
}

for (const [fg, alpha, bg, tipo, rol] of PARES_CON_ALPHA) {
  test(`contraste ${fg}/${Math.round(alpha * 100)}% sobre ${bg} (${rol}) ≥ ${MINIMOS[tipo]}:1`, () => {
    assert.ok(TOKENS.has(fg), `falta el token --color-${fg} en base.css`);
    assert.ok(TOKENS.has(bg), `falta el token --color-${bg} en base.css`);
    const compuesto = compositar(TOKENS.get(fg), alpha, TOKENS.get(bg));
    const razon = contraste(compuesto, TOKENS.get(bg));
    assert.ok(razon >= MINIMOS[tipo] - 1e-9, `${fg}/${Math.round(alpha * 100)}% sobre ${bg} = ${razon.toFixed(2)}:1, se necesita ≥ ${MINIMOS[tipo]}:1 (${rol})`);
  });
}

for (const [bg, tipo, rol] of PARES_BLANCO) {
  test(`contraste blanco sobre ${bg} (${rol}) ≥ ${MINIMOS[tipo]}:1`, () => {
    assert.ok(TOKENS.has(bg), `falta el token --color-${bg} en base.css`);
    const razon = contraste(BLANCO, TOKENS.get(bg));
    assert.ok(razon >= MINIMOS[tipo] - 1e-9, `blanco/${bg} = ${razon.toFixed(2)}:1, se necesita ≥ ${MINIMOS[tipo]}:1 (${rol})`);
  });
}
