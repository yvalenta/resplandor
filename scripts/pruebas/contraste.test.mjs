// Prueba de contraste — reescrita contra el brief v2 (docs/identidad-visual.md, vigente
// desde 2026-09-28: «El letrero abre el salón»). Lee los tokens de color del `@theme
// static` de assets/css/base.css y recalcula, con la fórmula WCAG 2.x de verdad
// (luminancia relativa + razón de contraste), cada uno de los 24 pares que el propio
// brief midió en §3.1 — nunca un par de los marcados «Prohibidos» ahí, que documentan a
// propósito una combinación que la landing/carta/menú NUNCA usan. Exige el mínimo real:
// texto normal ≥ 4,5:1; texto grande o no-texto/foco ≥ 3:1 (§3.1). También exige que
// existan EXACTAMENTE los 15 tokens de §3 con su hex, que `--color-*: initial` esté
// presente (la guarda que apaga la paleta por defecto de Tailwind) y que NO exista
// ninguno de los 21 tokens de la v1 que el contrato da de baja (§13-A3): si alguno
// sobrevive, esta prueba lo nota — «un token viejo que quede olvidado no compila».
//
// Cambio de contrato (§0/§3): la v2 REEMPLAZA a la v1, no la extiende. La paleta del POS
// (`pos.html`) no se toca — usa su propio Tailwind CDN, con su config, y no carga
// `resplandor.css` — así que esta prueba no lo mira en absoluto.
//
// Escrita CONTRA EL CONTRATO: hoy (ronda de integración v2) `base.css` todavía conserva
// los 15 tokens nuevos JUNTO a los 21 de la v1 (una migración aditiva, a propósito, para
// no romper a carta.html/menu.html mientras esa parte termina de migrar su marcado, §10)
// — así que la prueba de «NO existe ninguno de los tokens v1» falla HOY por esa razón
// documentada, no por un error de esta prueba. En cuanto base.css quede solo con los 15
// tokens de §3 (el cambio de contrato completo), pasa sola. Mismo patrón que
// scripts/pruebas/descubrimiento.test.mjs con el JSON-LD.
//
// La fórmula se validó a mano contra los 24 valores que el propio brief midió en §3.1
// (todos coinciden a la centésima con relLum()/contrast() de acá, incluidos los DOS pares
// compuestos con transparencia — el borde `arroz`/55% de `.btn-linea-clara` sobre `telon`,
// y la mezcla `telón 85% + arroz` del hover de `.btn-telon`, ambos compuestos con
// compositar() antes de medir el contraste real, nunca contra el token puro): si un token
// cambia de hex, esta prueba lo nota.

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

// Un color `fgHex` pintado a opacidad `alpha` (0–1) sobre un fondo OPACO `bgHex` se ve
// como esta mezcla por canal — el mismo cálculo que hace cualquier navegador al componer
// `rgba()`/`color-mix()` sobre un fondo sólido. Así se mide el contraste real del borde
// `arroz`/55% de `.btn-linea-clara` (§3.1) y de la mezcla `telón 85% + arroz` del hover de
// `.btn-telon` — nunca el token puro contra el fondo, que daría otro número.
function compositar(fgHex, alpha, bgHex) {
  const fg = hexARgb(fgHex);
  const bg = hexARgb(bgHex);
  const mezcla = fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]);
  return mezcla.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ───────────────────────── el contrato de §3 ─────────────────────────

// Los 15 tokens de §3, con su hex exacto — ni uno más, ni uno menos.
const TOKENS_V2 = [
  ['telon', '0A1112'],
  ['arroz', 'F4F0E3'],
  ['papel', 'FFFDF7'],
  ['linea', 'D9D3BF'],
  ['apoyo', '4F5D59'],
  ['ceniza', 'A49F86'],
  ['pared', 'CE8965'],
  ['selva', '2E5B57'],
  ['letrero', 'ED6B50'],
  ['letrero-claro', 'F4846B'],
  ['maiz', 'E9A91F'],
  ['barro', '8A3D22'],
  ['turquesa', '2A738A'],
  ['naranja', 'C5571A'],
  ['oro', 'B39464'],
];

// Los 21 tokens de la v1 que §13-A3 da de baja: la paleta de marca del POS (ember/amber/
// ink/parch/teal/card/muted/line/soft/terracota) y sus variantes `-light`/`-faint`/
// `-tinta`/`-5`/`-3`/`-d`. Ninguno debería sobrevivir en `base.css` una vez completo el
// cambio de contrato (§3: «se eliminan todos los tokens de la v1»).
const TOKENS_V1_DE_BAJA = [
  'ember',
  'ember-light',
  'ember-faint',
  'teal',
  'teal-light',
  'teal-faint',
  'teal-tinta',
  'amber',
  'amber-light',
  'amber-faint',
  'amber-tinta',
  'parch',
  'parch-d',
  'ink',
  'ink-5',
  'ink-3',
  'card',
  'muted',
  'line',
  'soft',
  'terracota',
];

const MINIMOS = { texto: 4.5, 'texto-grande': 3, 'no-texto': 3 };

// Los 24 pares «permitidos» de §3.1 — nunca uno de los marcados «Prohibido» ahí (esos
// documentan a propósito una combinación que landing/carta/menú NUNCA usan). `esperado`
// es el valor que el propio brief midió (para notar un token que cambió de hex aunque
// siga pasando el mínimo); `min` es el mínimo WCAG real según el rol (texto normal,
// incluido el que se usa también en tamaños chicos como «RESTAURANTE» a 12,5px o el
// eyebrow a 12px; o no-texto para bordes/anillos/rombos/íconos sueltos).
const PARES = [
  ['arroz', 'telon', 'texto', 'texto sobre telon (body, precios, #inicio/#platos/#como-llegar/nav/pie/barra)', 16.72],
  ['ceniza', 'telon', 'texto', 'texto secundario, pie, franja superior', 7.15],
  ['letrero', 'telon', 'texto', 'rótulo «RESPLANDOR»/«RESTAURANTE» (también a 12 px)', 6.19],
  ['maiz', 'telon', 'texto', 'eyebrow, íconos, anillo de foco, rombos', 9.22],
  ['oro', 'telon', 'no-texto', 'anillo del monograma', 6.66],
  ['telon', 'letrero', 'texto', 'texto de .btn-letrero (relleno letrero)', 6.19],
  ['telon', 'letrero-claro', 'texto', 'hover de .btn-letrero (relleno letrero-claro)', 7.59],
  ['arroz', 'telon', 'texto', 'texto de .btn-telon (relleno telon)', 16.72],
  ['telon', 'maiz', 'texto', '.badge-maiz, voto «Igual», avisos (relleno maiz)', 9.22],
  ['arroz', 'barro', 'texto', '.badge-barro, voto «No», error (relleno barro)', 6.65],
  ['papel', 'turquesa', 'texto', '.badge-turquesa, voto «Me gusta» (relleno turquesa)', 5.27],
  ['telon', 'arroz', 'texto', 'texto sobre arroz (fondo de página)', 16.72],
  ['apoyo', 'arroz', 'texto', 'texto secundario sobre arroz', 6.05],
  ['barro', 'arroz', 'texto', 'eyebrow, enlaces, foco, íconos sobre arroz', 6.65],
  ['turquesa', 'arroz', 'texto', 'estado, íconos sobre arroz', 4.7],
  ['telon', 'papel', 'texto', 'texto, precios sobre papel', 18.74],
  ['apoyo', 'papel', 'texto', 'texto secundario, placeholder, borde de campo sobre papel', 6.79],
  ['barro', 'papel', 'texto', 'enlaces, foco sobre papel', 7.45],
  ['turquesa', 'papel', 'texto', 'estado sobre papel', 5.27],
  ['telon', 'pared', 'texto', 'todo sobre pared: texto, íconos, foco, .btn-telon, rombos', 6.71],
  ['arroz', 'selva', 'texto', 'todo el texto, enlaces y foco sobre selva', 6.7],
  ['maiz', 'selva', 'no-texto', 'solo íconos y rombos sobre selva', 3.69],
];

// Los dos pares compuestos con transparencia (§3.1): un color a `alpha` pintado sobre
// `sobre` (el fondo/base real que lo rodea), medido SIEMPRE contra `contraFondo` (el
// fondo visible de verdad) — nunca el token puro sin componer.
const PARES_ALFA = [
  {
    rol: 'borde arroz/55% de .btn-linea-clara (no-texto) sobre telon',
    fg: 'arroz',
    alpha: 0.55,
    sobre: 'telon',
    contraFondo: 'telon',
    tipo: 'no-texto',
    esperado: 5.62,
  },
  {
    rol: 'mezcla telón 85% + arroz: hover de .btn-telon, texto arroz',
    fg: 'telon',
    alpha: 0.85,
    sobre: 'arroz',
    contraFondo: 'arroz',
    tipo: 'texto',
    esperado: 11.43,
  },
];

// ───────────────────────── pruebas ─────────────────────────

test('existen EXACTAMENTE los 15 tokens de §3, con su hex exacto', () => {
  const nombresEsperados = TOKENS_V2.map(([n]) => n).sort();
  const nombresReales = [...TOKENS.keys()].sort();
  const fallasHex = [];
  for (const [nombre, hexEsperado] of TOKENS_V2) {
    const real = TOKENS.get(nombre);
    if (real === undefined) fallasHex.push(`falta --color-${nombre} en base.css`);
    else if (real !== hexEsperado) fallasHex.push(`--color-${nombre}: #${real}, el contrato pide #${hexEsperado}`);
  }
  assert.deepEqual(fallasHex, [], fallasHex.join('; '));
  assert.deepEqual(nombresReales, nombresEsperados, `base.css define ${nombresReales.length} tokens de color, el contrato pide exactamente estos 15: ${nombresEsperados.join(', ')}`);
});

test('`--color-*: initial;` está presente (apaga la paleta por defecto de Tailwind, §3)', () => {
  assert.match(BLOQUE_TEMA, /--color-\*\s*:\s*initial\s*;/, 'sin esta guarda, un color de plantilla de Tailwind (red-500, etc.) también compila');
});

test('no existe ninguno de los 21 tokens de la v1 que §13-A3 da de baja', () => {
  const presentes = TOKENS_V1_DE_BAJA.filter((n) => TOKENS.has(n));
  assert.deepEqual(presentes, [], `tokens de la v1 que siguen en base.css (deberían haberse eliminado, §3): ${presentes.join(', ')}`);
});

for (const [fg, bg, tipo, rol, esperado] of PARES) {
  test(`contraste ${fg} sobre ${bg} (${rol}) ≥ ${MINIMOS[tipo]}:1 (§3.1: ${esperado})`, () => {
    assert.ok(TOKENS.has(fg), `falta el token --color-${fg} en base.css`);
    assert.ok(TOKENS.has(bg), `falta el token --color-${bg} en base.css`);
    const razon = contraste(TOKENS.get(fg), TOKENS.get(bg));
    assert.ok(razon >= MINIMOS[tipo] - 1e-9, `${fg}/${bg} = ${razon.toFixed(2)}:1, se necesita ≥ ${MINIMOS[tipo]}:1 (${rol})`);
    // Si el hex de alguno de los dos tokens cambia, este número se mueve: lo nota acá,
    // no solo cuando cae por debajo del mínimo.
    assert.ok(Math.abs(razon - esperado) < 0.015, `${fg}/${bg} = ${razon.toFixed(2)}:1, el brief (§3.1) midió ${esperado}:1 — algún hex cambió`);
  });
}

for (const par of PARES_ALFA) {
  test(`contraste compuesto — ${par.rol} ≥ ${MINIMOS[par.tipo]}:1 (§3.1: ${par.esperado})`, () => {
    for (const nombre of [par.fg, par.sobre, par.contraFondo]) {
      assert.ok(TOKENS.has(nombre), `falta el token --color-${nombre} en base.css`);
    }
    const compuesto = compositar(TOKENS.get(par.fg), par.alpha, TOKENS.get(par.sobre));
    const razon = contraste(compuesto, TOKENS.get(par.contraFondo));
    assert.ok(razon >= MINIMOS[par.tipo] - 1e-9, `${par.rol} = ${razon.toFixed(2)}:1, se necesita ≥ ${MINIMOS[par.tipo]}:1`);
    assert.ok(Math.abs(razon - par.esperado) < 0.015, `${par.rol} = ${razon.toFixed(2)}:1, el brief (§3.1) midió ${par.esperado}:1 — algún hex cambió`);
  });
}

test('los pares "Prohibidos" de §3.1 (documentados, no usados) siguen fallando el mínimo — si alguno pasa, ya no está prohibido de verdad', () => {
  // No son pares que el CSS use: son la prueba, por el lado contrario, de que la paleta
  // no tiene una combinación "gratis" que alguien pueda usar sin darse cuenta de que es
  // ilegible. Solo los que dependen nada más de los 15 tokens (sin blancos/negros fuera
  // de la paleta ni "sin texto con transparencia", que §3.1 prohíbe por regla, no por
  // contraste).
  const prohibidos = [
    ['letrero', 'arroz'],
    ['letrero', 'papel'],
    ['maiz', 'arroz'],
    ['maiz', 'papel'],
    ['ceniza', 'arroz'],
    ['ceniza', 'papel'],
    ['oro', 'papel'],
    ['naranja', 'arroz'],
    ['linea', 'arroz'],
    ['letrero', 'pared'],
    ['arroz', 'pared'],
    ['papel', 'pared'],
    ['apoyo', 'pared'],
    ['barro', 'pared'],
    ['letrero', 'selva'],
    ['ceniza', 'selva'],
    ['telon', 'selva'],
    ['turquesa', 'selva'],
    ['turquesa', 'telon'],
    ['naranja', 'telon'],
    ['barro', 'telon'],
    ['apoyo', 'telon'],
  ];
  const queDeberianFallarYaNoFallan = [];
  for (const [fg, bg] of prohibidos) {
    if (!TOKENS.has(fg) || !TOKENS.has(bg)) continue; // ya lo reportan las pruebas de arriba
    const razon = contraste(TOKENS.get(fg), TOKENS.get(bg));
    if (razon >= MINIMOS.texto - 1e-9) queDeberianFallarYaNoFallan.push(`${fg}/${bg} = ${razon.toFixed(2)}:1 (¿ya no está prohibido?)`);
  }
  assert.deepEqual(queDeberianFallarYaNoFallan, []);
});
