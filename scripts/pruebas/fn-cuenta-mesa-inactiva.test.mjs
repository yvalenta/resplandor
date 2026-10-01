// OLA C · C1 — la Edge Function `cuenta` con mesas INACTIVAS (mesas.activa, migración 20261002160000).
//
// Se corre el index.ts REAL de la función (scripts/pruebas/_funcion-simulada.mjs: Deno y supabase-js simulados, base en memoria),
// con Request y Response de verdad. Lo que se fija:
//   · una mesa inactiva responde EXACTAMENTE igual que un enlace que no existe (mismo 404, mismo cuerpo, mismas cabeceras), también
//     con la cuenta abierta y también con el parámetro `o`: no se distingue «inactiva» de «inválida»;
//   · no se lee ni una fila de `ordenes` para una mesa inactiva, y el 404 cuenta para el límite de 404 como cualquier otro;
//   · una mesa activa responde lo de siempre (el contrato v2 no cambia);
//   · si la columna `activa` todavía no existe (la función se despliega antes que la migración) la función cae a la consulta de
//     antes, y solo por ese error (42703): cualquier otro fallo de la base sigue siendo 500, sin reintento;
//   · alerta/index.ts no cambia (la regla vive en la RPC alertar_cuenta, que prueba el arnés de Postgres).
// Con la base REAL (error 42703 de verdad y la columna `activa` de verdad) lo prueba el arnés de Docker de C1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseSimulada, cargarFuncion } from './_funcion-simulada.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HAY_TS = Boolean(process.features?.typescript);
const MOTIVO_TS = HAY_TS ? false : `correr index.ts pide Node ≥ 22.18 (type stripping); esto corre con ${process.versions.node}`;
const ts = (nombre, fn) => test(nombre, { skip: MOTIVO_TS }, fn);

const FUNCION = 'supabase/functions/cuenta/index.ts';
const ORIGEN = 'https://resplandor.ynt.codes';
const TOKEN_ACTIVA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const TOKEN_INACTIVA = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a3928';
const TOKEN_FALSO = 'f'.repeat(48);
const ITEMS = [{ id: 'i1', nombre: 'Menú Resplandor', precio: 23000, qty: 2, nota: 'secreto de cocina' }];
const orden = (extra) => ({
  id: 'o-activa', mesa_id: 3, estado: 'abierta', items: ITEMS, total: 46000,
  abierta_en: '2026-10-01T18:05:00.000+00:00', updated_at: '2026-10-01T18:20:11.5+00:00', version: 3, ...extra,
});
// Con la columna nueva (migración aplicada): la mesa 3 activa y la 4 inactiva, las dos con una cuenta abierta.
const tablasConColumna = () => ({
  mesas: [
    { id: 3, token: TOKEN_ACTIVA, estado: 'ocupada', activa: true },
    { id: 4, token: TOKEN_INACTIVA, estado: 'ocupada', activa: false },
  ],
  ordenes: [orden(), orden({ id: 'o-inactiva', mesa_id: 4, items: [{ id: 'z', nombre: 'Café', precio: 3000, qty: 1, nota: 'no debe salir' }], total: 3000 })],
});
// Sin la columna (la función se desplegó antes que la migración): las filas no traen `activa`.
const tablasSinColumna = () => ({
  mesas: [{ id: 3, token: TOKEN_ACTIVA, estado: 'ocupada' }, { id: 4, token: TOKEN_INACTIVA, estado: 'ocupada' }],
  ordenes: tablasConColumna().ordenes,
});

async function montar({ tablas, fallas = {} }) {
  const base = baseSimulada({ tablas, fallas });
  const f = await cargarFuncion(FUNCION, { base });
  return { base, f };
}
let ipN = 0;
function pedir(f, { m, k, o, ip } = {}) {
  const q = new URLSearchParams({ m: String(m), k, ...(o === undefined ? {} : { o }) }).toString();
  return f.atender(new Request(`https://prueba.invalid/functions/v1/cuenta?${q}`, {
    method: 'GET', headers: { origin: ORIGEN, 'x-forwarded-for': ip ?? `203.0.113.${(++ipN % 250) + 1}` },
  }));
}
const cuerpo = async (r) => JSON.parse(await r.text());

ts('mesa inactiva: 404 enlace_invalido, el MISMO cuerpo y las mismas cabeceras que un token inventado', async () => {
  const { f } = await montar({ tablas: tablasConColumna() });
  const r = await pedir(f, { m: 4, k: TOKEN_INACTIVA });
  const falso = await pedir(f, { m: 4, k: TOKEN_FALSO });
  assert.equal(r.status, 404);
  assert.deepEqual(await cuerpo(r), { error: 'enlace inválido', codigo: 'enlace_invalido' });
  assert.equal(falso.status, 404);
  assert.deepEqual(await cuerpo(falso), { error: 'enlace inválido', codigo: 'enlace_invalido' }, 'el de un token inventado es el mismo texto');
  for (const h of ['content-type', 'cache-control', 'access-control-allow-origin', 'vary']) {
    assert.equal(r.headers.get(h), falso.headers.get(h), `cabecera ${h} igual: no se distingue «inactiva» de «inválida»`);
  }
});

ts('mesa inactiva con la cuenta abierta: ni una fila de `ordenes` se lee, y nada de la cuenta sale', async () => {
  const { f, base } = await montar({ tablas: tablasConColumna() });
  const r = await pedir(f, { m: 4, k: TOKEN_INACTIVA });
  const d = await cuerpo(r);
  assert.equal(r.status, 404);
  assert.deepEqual(base.tablasLeidas(), ['mesas'], 'solo se miró la mesa: la orden abierta no se leyó');
  const texto = JSON.stringify(d);
  for (const prohibido of ['Café', 'no debe salir', 'o-inactiva', 'items', 'total', 'canal', 'marca']) assert.ok(!texto.includes(prohibido), `no debe asomar «${prohibido}»`);
});

ts('mesa inactiva con el parámetro `o` (una pestaña que ya miraba esa cuenta): también 404, no «cerrada»', async () => {
  const { f } = await montar({ tablas: tablasConColumna() });
  const r = await pedir(f, { m: 4, k: TOKEN_INACTIVA, o: 'o-inactiva' });
  assert.equal(r.status, 404);
  assert.deepEqual(await cuerpo(r), { error: 'enlace inválido', codigo: 'enlace_invalido' });
});

ts('el 404 de una mesa inactiva cuenta para el límite de 404 (21 enlaces a una mesa inactiva bloquean esa pareja IP+mesa, como un enlace inválido)', async () => {
  const { f } = await montar({ tablas: tablasConColumna() });
  const ip = '198.51.100.9';
  for (let i = 0; i < 21; i++) assert.equal((await pedir(f, { m: 4, k: TOKEN_INACTIVA, ip })).status, 404, `intento ${i + 1}`);
  const bloqueada = await pedir(f, { m: 4, k: TOKEN_INACTIVA, ip });
  assert.equal(bloqueada.status, 429, 'la pareja (IP, mesa 4) quedó bloqueada');
  assert.ok(Number(bloqueada.headers.get('retry-after')) > 0);
  const otraMesa = await pedir(f, { m: 3, k: TOKEN_ACTIVA, ip });
  assert.equal(otraMesa.status, 200, 'y las demás mesas de la misma IP siguen (todo el local detrás del mismo NAT)');
});

ts('mesa ACTIVA: el contrato de siempre (200, orden, items agrupados sin notas) y la consulta pide «id, activa»', async () => {
  const { f, base } = await montar({ tablas: tablasConColumna() });
  const r = await pedir(f, { m: 3, k: TOKEN_ACTIVA });
  const d = await cuerpo(r);
  assert.equal(r.status, 200);
  assert.equal(d.estado, 'abierta');
  assert.equal(d.orden_id, 'o-activa');
  assert.equal(d.total, 46000);
  assert.deepEqual(d.items, [{ nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 }]);
  assert.ok(!JSON.stringify(d).includes('secreto de cocina'), 'las notas de cocina no salen');
  const consultaMesa = base.consultas.find((c) => c.tabla === 'mesas');
  assert.equal(consultaMesa.columnas, 'id, activa');
  assert.deepEqual(consultaMesa.filtros, [['id', 3], ['token', TOKEN_ACTIVA]]);
});

ts('sin la columna `activa` (función desplegada antes que la migración): cae a la consulta de antes y sirve todo como siempre', async () => {
  const { f, base } = await montar({ tablas: tablasSinColumna() });
  const r = await pedir(f, { m: 4, k: TOKEN_INACTIVA });
  const d = await cuerpo(r);
  assert.equal(r.status, 200, 'sin la columna no hay mesas inactivas: todas cuentan como activas');
  assert.equal(d.estado, 'abierta');
  assert.deepEqual(base.consultas.filter((c) => c.tabla === 'mesas').map((c) => c.columnas), ['id, activa', 'id'], 'primero «id, activa» (falla con 42703) y luego «id»');
  // un enlace inventado sigue siendo 404
  const falso = await pedir(f, { m: 4, k: TOKEN_FALSO });
  assert.equal(falso.status, 404);
  assert.equal((await cuerpo(falso)).codigo, 'enlace_invalido');
});

ts('un fallo de la base que NO es «columna inexistente» sigue siendo 500, sin reintento y sin filtrar el error', async () => {
  const { f, base } = await montar({ tablas: tablasConColumna(), fallas: { mesas: { code: '57014', message: 'canceling statement due to statement timeout (detalle interno)' } } });
  const r = await pedir(f, { m: 3, k: TOKEN_ACTIVA });
  const d = await cuerpo(r);
  assert.equal(r.status, 500);
  assert.equal(d.codigo, 'interno');
  assert.ok(!JSON.stringify(d).includes('detalle interno'), 'el mensaje de la base no sale al comensal');
  assert.equal(base.consultas.filter((c) => c.tabla === 'mesas').length, 1, 'una sola consulta: no se reintenta por cualquier error');
});

ts('con `activa: null` (no pasa: la columna es NOT NULL) la mesa cuenta como activa; solo `false` la apaga', async () => {
  const tablas = tablasConColumna();
  tablas.mesas[0].activa = null;
  const { f } = await montar({ tablas });
  assert.equal((await pedir(f, { m: 3, k: TOKEN_ACTIVA })).status, 200);
});

test('el index.ts sigue sin leer nada de más: solo `mesas` (id, activa) y `ordenes`, y el empaquetado para el dashboard lo conserva', () => {
  const src = fs.readFileSync(path.join(RAIZ, FUNCION), 'utf8');
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  assert.deepEqual([...new Set([...codigo.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]))].sort(), ['mesas', 'ordenes']);
  assert.match(codigo, /\.select\("id, activa"\)/);
  assert.match(codigo, /eMesa\.code === "42703"/);
  assert.match(codigo, /mesa\.activa === false/);
  // la función `alerta` no cambia: la regla vive en la RPC
  const alerta = fs.readFileSync(path.join(RAIZ, 'supabase/functions/alerta/index.ts'), 'utf8');
  assert.ok(!alerta.includes('activa'), 'alerta/index.ts no sabe nada de mesas inactivas: lo decide alertar_cuenta');
});
