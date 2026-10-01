// scripts/empaquetar-funcion.mjs: el archivo único que se pega en el editor del dashboard de Supabase.
//
// El editor del dashboard no resuelve `import ... from "../_compartido/mesa.js"`, y `cuenta` v2 lo usa. Esta
// prueba no se conforma con mirar el texto: CORRE el archivo empaquetado (con el arnés de _funcion-simulada.mjs,
// sin Deno) y comprueba que responde IGUAL que el `index.ts` original ante las mismas peticiones, sobre los
// mismos datos. Así, lo que se pega en el dashboard es lo mismo que se probó en el repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { empaquetar } from '../empaquetar-funcion.mjs';
import { baseSimulada, cargarFuncion } from './_funcion-simulada.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const HAY_TS = Boolean(process.features?.typescript);
const MOTIVO_TS = HAY_TS ? false : `correr el .ts pide Node ≥ 22.18 (type stripping); esto corre con ${process.versions.node}`;

/** Un árbol de mentira con supabase/functions/<nombre>/index.ts y archivos compartidos. */
function arbol(archivos) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-empaquetar-'));
  for (const [rel, texto] of Object.entries(archivos)) {
    const ruta = path.join(raiz, 'supabase', 'functions', rel);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, texto);
  }
  return raiz;
}

test('una función sin imports locales (votar) sale idéntica, byte a byte', () => {
  const r = empaquetar('votar');
  assert.equal(r.empaquetada, false);
  assert.equal(r.texto, leer('supabase/functions/votar/index.ts'));
});

test('cuenta: un solo archivo, sin export ni imports relativos, con supabase-js una sola vez y arriba', () => {
  const { texto, fuentes, empaquetada } = empaquetar('cuenta');
  assert.equal(empaquetada, true);
  assert.ok(texto.startsWith('// @ts-nocheck\n'), 'el editor no debe quejarse por los tipos del JS plano');
  assert.deepEqual(fuentes.map((f) => f.ruta), ['supabase/functions/_compartido/mesa.js', 'supabase/functions/cuenta/index.ts']);
  const imports = texto.split('\n').filter((l) => /^\s*import\s/.test(l));
  assert.deepEqual(imports, ['import { createClient } from "npm:@supabase/supabase-js@2";']);
  assert.ok(texto.indexOf('import { createClient }') < texto.indexOf('Deno.serve'), 'el import va arriba');
  assert.equal(/^export\b/m.test(texto), false, 'ninguna declaración exportada');
  assert.equal(texto.includes('_compartido/mesa.js"'), false, 'ningún import relativo');
  // lo que usa index.ts existe en el archivo
  for (const n of ['topicoCuenta', 'agruparItems', 'marcaCuenta', 'crearLimitador', 'origenPermitido', 'respuestaPreflight', 'errorJson']) {
    assert.match(texto, new RegExp(`^(?:async )?function ${n}\\b`, 'm'), `declara ${n}`);
  }
  // los orígenes permitidos y el vector del tópico viajan intactos
  assert.ok(texto.includes('https://resplandor.ynt.codes') && texto.includes('"cuenta:"'));
});

test('es reproducible: dos corridas dan el mismo texto, y el encabezado trae el sha de cada fuente', () => {
  const a = empaquetar('cuenta'), b = empaquetar('cuenta');
  assert.equal(a.texto, b.texto);
  for (const f of a.fuentes) {
    assert.match(f.sha, /^[0-9a-f]{12}$/);
    assert.ok(a.texto.includes(`${f.ruta}  sha256 ${f.sha}…`), `el encabezado nombra ${f.ruta}`);
  }
});

test('se niega, diciendo por qué, ante lo que no cubre', () => {
  const casos = [
    ['export default', { 'f/index.ts': 'import { a } from "../_compartido/x.js";\nDeno.serve(() => new Response(a));\n', '_compartido/x.js': 'export default 1;\n' }, /export default/],
    ['export { … }', { 'f/index.ts': 'import { a } from "../_compartido/x.js";\n', '_compartido/x.js': 'const a = 1;\nexport { a };\n' }, /export \{/],
    ['import por defecto', { 'f/index.ts': 'import a from "../_compartido/x.js";\n', '_compartido/x.js': 'export const a = 1;\n' }, /solo se cubren imports con llaves/],
    ['import * as', { 'f/index.ts': 'import * as a from "../_compartido/x.js";\n', '_compartido/x.js': 'export const a = 1;\n' }, /solo se cubren imports con llaves/],
    ['nombre repetido', { 'f/index.ts': 'import { a } from "../_compartido/x.js";\nconst a2 = a;\nconst limitador = 2;\n', '_compartido/x.js': 'export const a = 1;\nexport const limitador = 1;\n' }, /«limitador» está declarado en/],
    ['fuera de supabase/functions', { 'f/index.ts': 'import { a } from "../../../x.js";\n' }, /fuera de supabase\/functions/],
    ['import circular', { 'f/index.ts': 'import { a } from "../_compartido/x.js";\n', '_compartido/x.js': 'import { b } from "./y.js";\nexport const a = 1;\n', '_compartido/y.js': 'import { a } from "./x.js";\nexport const b = 1;\n' }, /circular/],
    ['archivo inexistente', { 'f/index.ts': 'import { a } from "../_compartido/nada.js";\n' }, /no existe/],
  ];
  for (const [nombre, archivos, esperado] of casos) {
    const raiz = arbol(archivos);
    try {
      assert.throws(() => empaquetar('f', { raiz }), esperado, nombre);
    } finally {
      fs.rmSync(raiz, { recursive: true, force: true });
    }
  }
});

test('módulos que importan otros módulos: dependencias primero, una sola vez', () => {
  const raiz = arbol({
    'f/index.ts': 'import { createClient } from "npm:@supabase/supabase-js@2";\nimport { a } from "../_compartido/a.js";\nimport { b } from "../_compartido/b.js";\nDeno.serve(() => new Response(String(a + b)));\n',
    '_compartido/a.js': 'import { base } from "./base.js";\nexport const a = base + 1;\n',
    '_compartido/b.js': 'import { base } from "./base.js";\nimport { createClient } from "npm:@supabase/supabase-js@2";\nexport const b = base + 2;\n',
    '_compartido/base.js': 'export const base = 10;\n',
  });
  try {
    const { texto, fuentes } = empaquetar('f', { raiz });
    assert.deepEqual(fuentes.map((f) => f.ruta), [
      'supabase/functions/_compartido/base.js', 'supabase/functions/_compartido/a.js',
      'supabase/functions/_compartido/b.js', 'supabase/functions/f/index.ts',
    ]);
    assert.equal(texto.split('\n').filter((l) => /^import\s/.test(l)).length, 1, 'supabase-js importado una sola vez');
    assert.equal((texto.match(/^const base = 10;/gm) || []).length, 1, 'base.js entra una sola vez');
    assert.ok(texto.indexOf('const base') < texto.indexOf('const a =') && texto.indexOf('const a =') < texto.indexOf('Deno.serve'));
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

// ── el archivo empaquetado, CORRIDO, responde igual que el original ──

const ts = (nombre, fn) => test(nombre, { skip: MOTIVO_TS }, fn);

const TOKEN = '0'.repeat(48);
const tablas = () => ({
  mesas: [{ id: 1, token: TOKEN, estado: 'ocupada' }, { id: 2, token: 'ab'.repeat(24), estado: 'libre' }],
  ordenes: [{
    id: 'ord_a', mesa_id: 1, estado: 'abierta', total: 52000, version: 7,
    abierta_en: '2026-09-30T18:05:00.123456+00:00', updated_at: '2026-09-30T18:20:11.5+00:00',
    items: [
      { id: 'i1', nombre: 'Menú Resplandor', precio: 23000, qty: 1, nota: 'Res' },
      { id: 'i2', nombre: 'Menú Resplandor', precio: 23000, qty: 1, nota: 'Pollo' },
      { id: 'i3', nombre: 'Limonada', precio: 6000, qty: 1, nota: '' },
    ],
  }],
});

ts('el archivo empaquetado responde igual que cuenta/index.ts ante las mismas peticiones y los mismos datos', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-cuenta-empaquetada-'));
  try {
    // Va en una carpeta .../supabase/functions/cuenta/index.ts: el arnés solo trata como TypeScript lo que está ahí.
    const destino = path.join(raiz, 'supabase', 'functions', 'cuenta', 'index.ts');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, empaquetar('cuenta').texto);

    const original = await cargarFuncion('supabase/functions/cuenta/index.ts', { base: baseSimulada({ tablas: tablas() }) });
    const juntada = await cargarFuncion(path.relative(RAIZ, destino), { base: baseSimulada({ tablas: tablas() }) });

    const URL_BASE = 'https://prueba.invalid/functions/v1/cuenta';
    const peticiones = [
      ['la orden abierta', `?m=1&k=${TOKEN}`, {}],
      ['con o = la orden abierta', `?m=1&k=${TOKEN}&o=ord_a`, {}],
      ['con o que ya no es la abierta', `?m=1&k=${TOKEN}&o=otra`, {}],
      ['mesa sin orden', `?m=2&k=${'ab'.repeat(24)}`, {}],
      ['token inexistente', `?m=1&k=${'cd'.repeat(24)}`, {}],
      ['formato inválido', '?m=abc&k=x', {}],
      ['origen no permitido', `?m=1&k=${TOKEN}`, { origin: 'https://clon.example' }],
      ['origen de producción', `?m=1&k=${TOKEN}`, { origin: 'https://resplandor.ynt.codes' }],
      ['preflight', `?m=1&k=${TOKEN}`, { origin: 'http://localhost:5173', metodo: 'OPTIONS' }],
      ['POST', `?m=1&k=${TOKEN}`, { metodo: 'POST' }],
    ];
    const ver = async (f, q, { origin, metodo = 'GET' }) => {
      const headers = { 'x-forwarded-for': '203.0.113.7', ...(origin ? { origin } : {}) };
      const r = await f.atender(new Request(URL_BASE + q, { method: metodo, headers }));
      const texto = await r.text();
      let cuerpo = texto;
      try { cuerpo = JSON.parse(texto); delete cuerpo.servidor_en; } catch { /* sin cuerpo (204) */ }
      return { estado: r.status, cabeceras: Object.fromEntries([...r.headers.entries()].sort()), cuerpo };
    };
    for (const [nombre, q, opciones] of peticiones) {
      assert.deepEqual(await ver(juntada, q, opciones), await ver(original, q, opciones), nombre);
    }
    // y es de verdad la v2: trae el canal y ordena CORS con lista
    const v2 = await ver(juntada, peticiones[0][1], {});
    assert.equal(v2.estado, 200);
    assert.equal(v2.cuerpo.canal.topico, 'cuenta:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a');
    assert.equal(v2.cuerpo.marca, '7.0');
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
