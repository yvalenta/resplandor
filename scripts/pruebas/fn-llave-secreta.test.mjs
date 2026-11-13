// La llave de servicio de las Edge Functions: la secreta nueva (`SUPABASE_SECRET_KEYS["default"]`, `sb_secret_…`) y, si no
// está, la heredada `SUPABASE_SERVICE_ROLE_KEY`, que Supabase apaga a fin de 2026 (tarea 2026-11-12-llave-secreta-funciones;
// https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
//
// Lo que se fija:
//   · `llaveDeServicio()` es el MISMO texto en cuenta, alerta y votar, y es el único lugar que lee las dos variables;
//   · `cuenta` y `votar` REALES (scripts/pruebas/_funcion-simulada.mjs: Deno y supabase-js simulados) llaman a `createClient`
//     con la llave que toca en cada caso de CASOS_LLAVE, y responden;
//   · el broadcast de `votar` manda la nueva SOLO en `apikey` (en `Authorization` la plataforma la trata como JWT y la rechaza)
//     y la heredada en las dos cabeceras, como siempre;
//   · ninguna función escribe la llave en un log.
// `alerta` corre con su propio arnés, que no puede convivir en un proceso con este (ver _funcion-alerta.mjs): sus casos de la
// llave están en roles-y-alertas.test.mjs (B5l y B5m).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseSimulada, cargarFuncion, CASOS_LLAVE, LLAVE_NUEVA, LLAVE_HEREDADA } from './_funcion-simulada.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HAY_TS = Boolean(process.features?.typescript);
const MOTIVO_TS = HAY_TS ? false : `correr index.ts pide Node ≥ 22.18 (type stripping); esto corre con ${process.versions.node}`;
const ts = (nombre, fn) => test(nombre, { skip: MOTIVO_TS }, fn);

const FUNCIONES = ['cuenta', 'alerta', 'votar'];
const rutaDe = (f) => `supabase/functions/${f}/index.ts`;
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const OPCIONES_CLIENTE = { auth: { persistSession: false, autoRefreshToken: false } };

// ── el texto de las tres funciones ──

function bloqueLlave(texto, nombre) {
  const ini = texto.indexOf('// La llave de servicio (omite la RLS).');
  const fn = texto.indexOf('function llaveDeServicio(', ini);
  const fin = texto.indexOf('\n}\n', fn);
  assert.ok(ini >= 0 && fn > ini && fin > fn, `${nombre}: no se encontró llaveDeServicio con su comentario`);
  return { bloque: texto.slice(ini, fin + 3), ini, fin: fin + 3 };
}

test('llaveDeServicio es el mismo texto en cuenta, alerta y votar, y es lo único que lee las dos llaves', () => {
  const bloques = FUNCIONES.map((f) => {
    const texto = leer(rutaDe(f));
    const { bloque, ini, fin } = bloqueLlave(texto, f);
    for (const variable of ['SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY']) {
      const lecturas = [...texto.matchAll(new RegExp(`Deno\\.env\\.get\\("${variable}"\\)`, 'g'))].map((m) => m.index);
      assert.equal(lecturas.length, 1, `${f}: ${variable} se lee una sola vez`);
      assert.ok(lecturas[0] > ini && lecturas[0] < fin, `${f}: ${variable} se lee solo dentro de llaveDeServicio`);
    }
    assert.match(texto, /^const \{ llave: LLAVE_SERVICIO[^}]*\} = llaveDeServicio\(\);$/m, `${f}: la llave sale de llaveDeServicio`);
    assert.match(texto, /createClient\(SUPABASE_URL, LLAVE_SERVICIO, \{/, `${f}: createClient recibe esa llave`);
    assert.doesNotMatch(texto, /\bSERVICE_ROLE\b/, `${f}: ya no queda la constante vieja`);
    const logsConLlave = texto.split('\n').filter((l) => /console\./.test(l) && /LLAVE_SERVICIO|llaveDeServicio/.test(l));
    assert.deepEqual(logsConLlave, [], `${f}: la llave nunca va a un log`);
    return bloque;
  });
  assert.equal(bloques[1], bloques[0], 'alerta y cuenta tienen la misma llaveDeServicio');
  assert.equal(bloques[2], bloques[0], 'votar y cuenta tienen la misma llaveDeServicio');
});

test('los casos de las pruebas cubren los dos caminos y los respaldos', () => {
  assert.ok(CASOS_LLAVE.some((c) => !c.heredada && c.entorno.SUPABASE_SERVICE_ROLE_KEY === undefined), 'solo la nueva (la heredada apagada)');
  assert.ok(CASOS_LLAVE.some((c) => !c.heredada && c.entorno.SUPABASE_SERVICE_ROLE_KEY === LLAVE_HEREDADA), 'las dos: gana la nueva');
  assert.ok(CASOS_LLAVE.some((c) => c.heredada && !('SUPABASE_SECRET_KEYS' in c.entorno)), 'solo la heredada');
  assert.ok(CASOS_LLAVE.filter((c) => c.heredada && 'SUPABASE_SECRET_KEYS' in c.entorno).length >= 5, 'la nueva rota de varias maneras: vale la heredada');
  for (const c of CASOS_LLAVE) assert.equal(c.llave, c.heredada ? LLAVE_HEREDADA : LLAVE_NUEVA, c.caso);
});

// ── cuenta ──

const ORIGEN = 'https://resplandor.ynt.codes';
const TOKEN = '0'.repeat(48);
const tablasCuenta = () => ({
  mesas: [{ id: 1, token: TOKEN, estado: 'ocupada', activa: true }],
  ordenes: [{
    id: 'ord_a', mesa_id: 1, estado: 'abierta', total: 23000, version: 2,
    abierta_en: '2026-11-12T18:05:00.000+00:00', updated_at: '2026-11-12T18:10:00.000+00:00',
    items: [{ id: 'i1', nombre: 'Menú Resplandor', precio: 23000, qty: 1, nota: '' }],
  }],
});

for (const c of CASOS_LLAVE) {
  ts(`cuenta · ${c.caso}: createClient recibe la ${c.heredada ? 'heredada' : 'nueva'} y la cuenta se lee`, async () => {
    const f = await cargarFuncion(rutaDe('cuenta'), { base: baseSimulada({ tablas: tablasCuenta() }), entorno: c.entorno });
    assert.deepEqual(f.clientesCreados, [['https://prueba.invalid', c.llave, OPCIONES_CLIENTE]]);
    const r = await f.atender(new Request(`https://prueba.invalid/functions/v1/cuenta?m=1&k=${TOKEN}`, {
      headers: { origin: ORIGEN, 'x-forwarded-for': '203.0.113.7' },
    }));
    const texto = await r.text();
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(texto).abierta, true);
    assert.ok(!texto.includes(c.llave), 'la llave no sale en la respuesta');
  });
}

// ── votar ──

const votoValido = () => new Request('https://prueba.invalid/functions/v1/votar', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
  body: JSON.stringify({ action: 'eleccion', device_id: 'aparato-de-prueba', semana: '2026-11-09', dia: 2, opcion: 1 }),
});

for (const c of CASOS_LLAVE) {
  const dondeVa = c.heredada ? 'en `apikey` y `Authorization`, como siempre' : 'solo en `apikey`';
  ts(`votar · ${c.caso}: createClient recibe la ${c.heredada ? 'heredada' : 'nueva'} y el broadcast la manda ${dondeVa}`, async (t) => {
    const envios = [];
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = async (url, init) => { envios.push({ url: String(url), init }); return new Response('{}', { status: 202 }); };
    t.after(() => { globalThis.fetch = fetchOriginal; });
    const escrituras = [];
    const base = { cliente: { from: (tabla) => ({ upsert: async (fila) => { escrituras.push({ tabla, fila }); return { error: null }; } }) } };

    const f = await cargarFuncion(rutaDe('votar'), { base, entorno: c.entorno });
    assert.deepEqual(f.clientesCreados, [['https://prueba.invalid', c.llave, OPCIONES_CLIENTE]]);
    const r = await f.atender(votoValido());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(escrituras.map((e) => e.tabla), ['elecciones_menu']);

    assert.equal(envios.length, 1, 'un broadcast por voto');
    assert.equal(envios[0].url, 'https://prueba.invalid/realtime/v1/api/broadcast');
    const cabeceras = envios[0].init.headers;
    assert.equal(cabeceras.apikey, c.llave);
    const conLlave = Object.keys(cabeceras).filter((k) => String(cabeceras[k]).includes(c.llave));
    if (c.heredada) {
      assert.equal(cabeceras.Authorization, `Bearer ${c.llave}`);
      assert.deepEqual(conLlave, ['apikey', 'Authorization']);
    } else {
      assert.equal('Authorization' in cabeceras, false, 'la secreta nueva no va en Authorization');
      assert.deepEqual(conLlave, ['apikey']);
    }
    assert.deepEqual(JSON.parse(envios[0].init.body).messages, [{ topic: 'menu-2026-11-09', event: 'voto', payload: { kind: 'eleccion', dia: 2 } }]);
  });
}

ts('votar · con solo la llave nueva, un broadcast que falla no rompe el voto y la llave no sale en el log', async (t) => {
  const fetchOriginal = globalThis.fetch;
  const errorOriginal = console.error;
  const logs = [];
  globalThis.fetch = async () => { throw new Error('realtime no contesta'); };
  console.error = (...a) => { logs.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')); };
  t.after(() => { globalThis.fetch = fetchOriginal; console.error = errorOriginal; });
  const base = { cliente: { from: () => ({ upsert: async () => ({ error: null }) }) } };
  const caso = CASOS_LLAVE.find((c) => !c.heredada && c.entorno.SUPABASE_SERVICE_ROLE_KEY === undefined);
  const f = await cargarFuncion(rutaDe('votar'), { base, entorno: caso.entorno });
  const r = await f.atender(votoValido());
  assert.equal(r.status, 200);
  assert.equal(logs.length, 1, 'el fallo del broadcast se registra');
  for (const l of logs) assert.ok(!l.includes(LLAVE_NUEVA), 'la llave no aparece en el log');
});
