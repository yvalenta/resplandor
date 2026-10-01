// Edge Function `cuenta`, contrato v2 de la fase 1 (docs/sdd-cuenta-en-mesa.md §04.3, parte 1B).
//
// Dos capas:
//   1. `supabase/functions/_compartido/mesa.js` (JS plano): validadores, CORS con lista, limitador,
//      `topicoCuenta` contra el vector fijado con 1A, `agruparItems` y `marcaCuenta`.
//   2. `supabase/functions/cuenta/index.ts` CORRIDO DE VERDAD (scripts/pruebas/_funcion-simulada.mjs):
//      el handler que registra con `Deno.serve`, con `Request` reales, una base en memoria y un
//      supabase-js falso que registra cada consulta. Sin Deno ni red.
//
// La respuesta de la fase 1 es retrocompatible con la carta ya publicada (be68c6b): sigue trayendo
// `abierta`, `items[{nombre, precio, cantidad}]`, `total` y `abierta_en`, y los errores siguen
// trayendo `error`. Ese contrato está fijado abajo, aparte de lo nuevo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseSimulada, cargarFuncion, importarModulo } from './_funcion-simulada.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// El código sin sus comentarios: las comprobaciones de abajo miran lo que se EJECUTA, no lo que se explica.
const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const mesa = await importarModulo('supabase/functions/_compartido/mesa.js');
const {
  agruparItems, crearLimitador, cabecerasCors, esMesa, esOrdenId, esToken, ipDeSolicitud,
  marcaCuenta, origenPermitido, respuestaPreflight, topicoCuenta, aIso,
} = mesa;

// El vector que comparten 1A (privado.topico_cuenta en SQL) y 1B (topicoCuenta en JS): el token
// de 48 ceros. Si uno de los dos cambia la fórmula, la carta oiría un tópico donde el trigger no emite.
const TOKEN_CEROS = '0'.repeat(48);
const TOPICO_CEROS = 'cuenta:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a';

// ───────────────────────── 1. mesa.js ─────────────────────────

test('topicoCuenta: «cuenta:» + sha256 hex del token; vector fijado con 1A (token de 48 ceros)', async () => {
  assert.equal(await topicoCuenta(TOKEN_CEROS), TOPICO_CEROS);
  // sha256("abc"), vector estándar FIPS 180-2: prueba que es sha256 puro sobre los bytes UTF-8.
  assert.equal(await topicoCuenta('abc'), 'cuenta:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(await topicoCuenta('0'.repeat(47) + '1'), TOPICO_CEROS);
});

test('validadores: formatos exactos de m, k y o (sin saltos de línea ni mayúsculas en el token)', () => {
  for (const ok of ['1', '12', '123', '1234']) assert.equal(esMesa(ok), true, ok);
  for (const mal of [null, undefined, '', '0a', '12345', '-1', '1.5', ' 1', '1\n', 1]) assert.equal(esMesa(mal), false, String(mal));

  assert.equal(esToken('a'.repeat(32)), true);
  assert.equal(esToken('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'), true);
  assert.equal(esToken('f'.repeat(64)), true);
  for (const mal of [null, '', 'a'.repeat(31), 'a'.repeat(65), 'A'.repeat(48), 'g'.repeat(48), 'a'.repeat(48) + '\n', 'a'.repeat(47) + ' ']) {
    assert.equal(esToken(mal), false, String(mal));
  }

  for (const ok of ['x', 'lq2x9k4abc', 'Ab_-9', 'a'.repeat(64)]) assert.equal(esOrdenId(ok), true, ok);
  for (const mal of [null, '', 'a'.repeat(65), 'a b', 'a.b', 'a/b', 'a;b', "a'b", '<x>', 'a\n', 'ñ']) assert.equal(esOrdenId(mal), false, String(mal));
});

test('origenPermitido: solo https://resplandor.ynt.codes y http://localhost[:puerto]', () => {
  for (const ok of ['https://resplandor.ynt.codes', 'http://localhost', 'http://localhost:3000', 'http://localhost:8080', 'http://localhost:65535']) {
    assert.equal(origenPermitido(ok), true, ok);
  }
  for (const mal of [
    null, undefined, '', 'null', '*',
    'http://resplandor.ynt.codes',               // http, no https
    'https://resplandor.ynt.codes/',             // con barra: el Origin real nunca la lleva
    'https://resplandor.ynt.codes:443',
    'https://www.resplandor.ynt.codes',
    'https://resplandor.ynt.codes.evil.example',
    'https://evil.example/https://resplandor.ynt.codes',
    'https://ynt.codes', 'https://resplandor.ynt.codes@evil.example',
    'https://localhost:3000',                    // localhost solo por http
    'http://localhost.evil.example', 'http://localhost:3000.evil.example', 'http://localhost:abc', 'http://localhost:123456',
    'http://127.0.0.1:3000', 'http://[::1]:3000', 'http://evil.example:3000',
  ]) {
    assert.equal(origenPermitido(mal), false, String(mal));
  }
});

test('cabecerasCors: Vary: Origin siempre; Allow-Origin solo con origen permitido, y es ese origen (nunca *)', () => {
  const permitido = cabecerasCors('https://resplandor.ynt.codes');
  assert.equal(permitido.Vary, 'Origin');
  assert.equal(permitido['Access-Control-Allow-Origin'], 'https://resplandor.ynt.codes');
  assert.match(permitido['Access-Control-Expose-Headers'], /Retry-After/, 'sin exponerla, la carta no puede leer Retry-After');
  assert.equal(cabecerasCors('http://localhost:5173')['Access-Control-Allow-Origin'], 'http://localhost:5173');

  for (const origen of [null, 'https://evil.example', 'null', 'http://127.0.0.1:1']) {
    const c = cabecerasCors(origen);
    assert.deepEqual(c, { Vary: 'Origin' }, String(origen));
  }
});

test('respuestaPreflight: 204; con origen permitido lleva métodos, cabeceras y Max-Age; sin él, ninguna cabecera CORS', () => {
  const r = respuestaPreflight('https://resplandor.ynt.codes', 'GET, OPTIONS');
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://resplandor.ynt.codes');
  assert.equal(r.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  const permitidas = r.headers.get('access-control-allow-headers').split(',').map((h) => h.trim());
  for (const h of ['authorization', 'apikey', 'x-client-info', 'content-type']) assert.ok(permitidas.includes(h), h);
  assert.ok(Number(r.headers.get('access-control-max-age')) > 0);

  const ajeno = respuestaPreflight('https://evil.example');
  assert.equal(ajeno.status, 204);
  assert.equal([...ajeno.headers.keys()].filter((h) => h.startsWith('access-control-')).length, 0);
  assert.equal(ajeno.headers.get('vary'), 'Origin');
});

test('ipDeSolicitud: primer valor de x-forwarded-for, acotado; sin cabecera, «desconocida»', () => {
  const con = (v) => new Headers(v === undefined ? {} : { 'x-forwarded-for': v });
  assert.equal(ipDeSolicitud(con('203.0.113.7, 10.0.0.1')), '203.0.113.7');
  assert.equal(ipDeSolicitud(con('  203.0.113.7  ')), '203.0.113.7');
  assert.equal(ipDeSolicitud(con(undefined)), 'desconocida');
  assert.equal(ipDeSolicitud(con('')), 'desconocida');
  assert.equal(ipDeSolicitud(con('x'.repeat(500))).length, 64, 'una cabecera enorme no infla la memoria del limitador');
});

test('agruparItems: agrupa por (nombre, precio) sumando cantidad, en orden de primera aparición; sin notas ni ids', () => {
  const r = agruparItems([
    { id: 'a1', nombre: 'Menú Resplandor', precio: 23000, qty: 1, nota: 'Sopa · Res' },
    { id: 'a2', nombre: 'Limonada', precio: 5000, qty: 2, nota: 'Persona 2' },
    { id: 'a3', nombre: 'Menú Resplandor', precio: 23000, qty: 1, nota: 'Sopa · Pollo' },
    { id: 'a4', nombre: 'Limonada', precio: 6000, qty: 1 },       // mismo nombre, otro precio: línea aparte
    { id: 'a5', nombre: 'Limonada', precio: 5000, qty: 3 },
  ]);
  assert.deepEqual(r, [
    { nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 },
    { nombre: 'Limonada', precio: 5000, cantidad: 5 },
    { nombre: 'Limonada', precio: 6000, cantidad: 1 },
  ]);
  for (const linea of r) assert.deepEqual(Object.keys(linea).sort(), ['cantidad', 'nombre', 'precio']);
});

test('agruparItems: tolera formatos raros y no inventa líneas (qty/cantidad, cantidad 0, basura)', () => {
  assert.deepEqual(agruparItems(undefined), []);
  assert.deepEqual(agruparItems('texto'), []);
  assert.deepEqual(agruparItems({}), []);
  assert.deepEqual(agruparItems([null, 7, 'x', [], undefined]), []);
  // `cantidad` en lugar de `qty` (formato viejo) y sin ninguna de las dos → 1.
  assert.deepEqual(agruparItems([{ nombre: 'A', precio: 1, cantidad: 4 }, { nombre: 'B', precio: 2 }]),
    [{ nombre: 'A', precio: 1, cantidad: 4 }, { nombre: 'B', precio: 2, cantidad: 1 }]);
  // Una línea en 0 (o negativa, o ilegible) no es parte de la cuenta: antes salía como «1×».
  assert.deepEqual(agruparItems([{ nombre: 'A', precio: 1, qty: 0 }, { nombre: 'B', precio: 2, qty: -1 }, { nombre: 'C', precio: 3, qty: 'x' }]), []);
  // Precio ilegible → 0 (no NaN, que JSON volvería null); nombre ausente → ''.
  assert.deepEqual(agruparItems([{ precio: 'x', qty: 1 }]), [{ nombre: '', precio: 0, cantidad: 1 }]);
  // Dos líneas cuyo nombre contiene «|» no se confunden con una sola.
  assert.equal(agruparItems([{ nombre: 'a|1', precio: 2, qty: 1 }, { nombre: 'a', precio: '1|2', qty: 1 }]).length, 2);
});

test('marcaCuenta: «<version>.<epoch ms de la liquidación o 0>»', () => {
  assert.equal(marcaCuenta(14), '14.0');
  assert.equal(marcaCuenta('14'), '14.0');
  assert.equal(marcaCuenta(null), '0.0');
  assert.equal(marcaCuenta(undefined, null), '0.0');
  assert.equal(marcaCuenta(14, '2026-09-30T18:20:11.500Z'), '14.' + Date.parse('2026-09-30T18:20:11.500Z'));
  assert.notEqual(marcaCuenta(14, '2026-09-30T18:20:11.500Z'), marcaCuenta(14, '2026-09-30T18:20:11.900Z'), 'dos cambios en el mismo segundo no pueden dar la misma marca');
  assert.notEqual(marcaCuenta(14), marcaCuenta(15));
  assert.equal(marcaCuenta(14, 'no es fecha'), '14.0');
});

test('aIso: ISO en UTC con milisegundos; null si no es fecha', () => {
  assert.equal(aIso('2026-09-30T13:05:00.123456+00:00'), '2026-09-30T13:05:00.123Z');
  assert.equal(aIso('2026-09-30T08:05:00-05:00'), '2026-09-30T13:05:00.000Z');
  assert.equal(aIso(null), null);
  assert.equal(aIso(undefined), null);
  assert.equal(aIso('mañana'), null);
});

test('limitador: 120 por minuto por (IP, mesa); la 121.ª espera, y la ventana se desliza', () => {
  let t = 1_000_000;
  const l = crearLimitador({ ahora: () => t });
  for (let i = 0; i < 120; i++) assert.deepEqual(l.revisar('1.1.1.1', '3'), { ok: true }, `golpe ${i + 1}`);
  const r = l.revisar('1.1.1.1', '3');
  assert.equal(r.ok, false);
  assert.ok(r.reintentarEn >= 1 && r.reintentarEn <= 60, `Retry-After ${r.reintentarEn}`);
  assert.equal(l.revisar('1.1.1.1', '4').ok, true, 'otra mesa de la misma IP tiene su propia cuenta');
  assert.equal(l.revisar('2.2.2.2', '3').ok, true, 'otra IP tiene su propia cuenta');
  t += 61_000;
  assert.equal(l.revisar('1.1.1.1', '3').ok, true, 'pasado el minuto, vuelve a pasar');
});

test('limitador: 600 por minuto por IP en total, repartidos entre mesas', () => {
  const l = crearLimitador({ ahora: () => 5_000 });
  for (let i = 0; i < 600; i++) assert.equal(l.revisar('9.9.9.9', String(1 + (i % 6))).ok, true, `golpe ${i + 1}`);
  assert.equal(l.revisar('9.9.9.9', '1').ok, false, 'la 601.ª sale por el tope de la IP, aunque la mesa 1 vaya en 100');
  assert.equal(l.revisar('8.8.8.8', '1').ok, true);
});

test('limitador: más de 20 respuestas 404 por minuto para una mesa bloquean la pareja (IP, mesa) 10 minutos (Retry-After = lo que falta)', () => {
  let t = 0;
  const l = crearLimitador({ ahora: () => t });
  for (let i = 0; i < 20; i++) { assert.equal(l.revisar('7.7.7.7', '1').ok, true); l.registrar404('7.7.7.7', '1'); }
  assert.equal(l.revisar('7.7.7.7', '1').ok, true, '20 respuestas 404 todavía no bloquean');
  l.registrar404('7.7.7.7', '1'); // la 21.ª
  const b = l.revisar('7.7.7.7', '1');
  assert.deepEqual(b, { ok: false, reintentarEn: 600 });
  assert.equal(l.revisar('7.7.7.7', '2').ok, true, 'las OTRAS mesas de la misma IP (todo el local detrás del NAT) siguen: el bloqueo no es por IP');
  assert.equal(l.revisar('6.6.6.6', '1').ok, true, 'las demás IP siguen');
  t += 300_000;
  assert.deepEqual(l.revisar('7.7.7.7', '1'), { ok: false, reintentarEn: 300 });
  t += 299_000;
  assert.equal(l.revisar('7.7.7.7', '1').ok, false, 'a 1 s de liberarse');
  t += 1_001;
  assert.equal(l.revisar('7.7.7.7', '1').ok, true, 'pasados los 10 minutos, libre');
});

test('limitador (refutación de la fase 1, H4): 21 enlaces inventados desde el wifi del local NO dejan sin «Mi cuenta» a las demás mesas', () => {
  let t = 0;
  const l = crearLimitador({ ahora: () => t });
  const IP_LOCAL = '190.0.0.1'; // el NAT del local: todos los comensales salen por aquí
  for (let i = 0; i < 21; i++) { l.revisar(IP_LOCAL, '7'); l.registrar404(IP_LOCAL, '7'); t += 100; }
  t += 5_000;
  assert.deepEqual(l.revisar(IP_LOCAL, '3'), { ok: true }, 'el comensal legítimo de la mesa 3 sigue viendo su cuenta (con el bloqueo por IP recibía 429 durante 10 minutos)');
  assert.deepEqual(l.revisar(IP_LOCAL, '4'), { ok: true });
  assert.equal(l.revisar(IP_LOCAL, '7').ok, false, 'límite aceptado: la pareja atacada (IP, mesa 7) sí queda bloqueada sus 10 minutos');
  t += 10 * 60_000;
  assert.equal(l.revisar(IP_LOCAL, '7').ok, true, 'y se libera sola');
});

test('limitador: registrar404 sin mesa cuenta en la cubeta «-» (la de las solicitudes sin mesa válida), no en una mesa real', () => {
  const l = crearLimitador({ ahora: () => 1_000 });
  for (let i = 0; i < 21; i++) l.registrar404('4.4.4.4');
  assert.equal(l.revisar('4.4.4.4', '-').ok, false);
  assert.equal(l.revisar('4.4.4.4', '3').ok, true);
});

test('limitador: los 404 se cuentan por minuto (20 hoy y 1 mañana no bloquean) y la memoria está acotada', () => {
  let t = 0;
  const l = crearLimitador({ ahora: () => t });
  for (let i = 0; i < 20; i++) l.registrar404('5.5.5.5', '1');
  t += 61_000;
  l.registrar404('5.5.5.5', '1');
  assert.equal(l.revisar('5.5.5.5', '1').ok, true);

  // Una inundación desde miles de IP no hace crecer el mapa sin límite.
  const chico = crearLimitador({ ahora: () => t, maxClaves: 50 });
  for (let i = 0; i < 500; i++) chico.revisar('ip-' + i, '1');
  for (let i = 0; i < 500; i++) { for (let j = 0; j < 21; j++) chico.registrar404('mala-' + i, '1'); }
  assert.equal(chico.revisar('ip-0', '1').ok, true);
});

// ───────────────────────── 2. cuenta/index.ts corrido de verdad ─────────────────────────

const HAY_TS = Boolean(process.features?.typescript);
const MOTIVO_TS = HAY_TS ? false : `correr index.ts pide Node ≥ 22.18 (type stripping); esto corre con ${process.versions.node}`;
const ts = (nombre, fn) => test(nombre, { skip: MOTIVO_TS }, fn);

const FUNCION = 'supabase/functions/cuenta/index.ts';
const ORIGEN = 'https://resplandor.ynt.codes';
const TOKEN_3 = TOKEN_CEROS;
const TOKEN_4 = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a3928';
const ITEMS_3 = [
  { id: 'i1', nombre: 'Menú Resplandor', precio: 23000, qty: 1, nota: 'Sopa · Res' },
  { id: 'i2', nombre: 'Limonada', precio: 5000, qty: 2, nota: 'Persona 2' },
  { id: 'i3', nombre: 'Menú Resplandor', precio: 23000, qty: 1, nota: 'Sopa · Pollo' },
  { id: 'i4', nombre: 'Limonada', precio: 6000, qty: 1, nota: '' },
];
const orden = (extra) => ({
  id: 'lq2x9k4abc', mesa_id: 3, estado: 'abierta', items: ITEMS_3, total: 62000,
  abierta_en: '2026-09-30T18:05:00.123456+00:00', updated_at: '2026-09-30T18:20:11.5+00:00', version: 14, ...extra,
});
const tokenDe = (id) => tablasBase().mesas.find((x) => x.id === id).token;
const tablasBase = () => ({
  mesas: [
    { id: 3, token: TOKEN_3, estado: 'ocupada' },
    { id: 4, token: TOKEN_4, estado: 'ocupada' },
    ...[1, 2, 5, 6, 7, 8].map((id) => ({ id, token: String(id).repeat(48).slice(0, 48).replace(/[^0-9a-f]/g, 'a'), estado: 'libre' })),
  ],
  ordenes: [
    orden(),
    orden({ id: 'otra4', mesa_id: 4, items: [{ id: 'z', nombre: 'Café', precio: 3000, qty: 1, nota: 'secreto de la mesa 4' }], total: 3000, version: 2 }),
    orden({ id: 'vieja3', mesa_id: 3, estado: 'cerrada', items: [{ id: 'y', nombre: 'Postre', precio: 9000, qty: 1 }], total: 9000 }),
  ],
});

async function montar({ tablas = tablasBase(), fallas = {} } = {}) {
  const base = baseSimulada({ tablas, fallas });
  const f = await cargarFuncion(FUNCION, { base });
  return { base, f };
}

/** Un GET a la función. `origen: null` = sin cabecera Origin (curl). */
function pedir(f, { m = '3', k = TOKEN_3, o, origen = ORIGEN, ip = '203.0.113.7', metodo = 'GET', query } = {}) {
  const q = query ?? new URLSearchParams({ ...(m === null ? {} : { m }), ...(k === null ? {} : { k }), ...(o === undefined ? {} : { o }) }).toString();
  const headers = { 'x-forwarded-for': ip };
  if (origen !== null) headers.origin = origen;
  return f.atender(new Request(`https://prueba.invalid/functions/v1/cuenta?${q}`, { method: metodo, headers }));
}
const cuerpo = async (r) => JSON.parse(await r.text());

ts('200 con la orden abierta: el contrato v2 completo, campo por campo', async () => {
  const { f } = await montar();
  const r = await pedir(f);
  assert.equal(r.status, 200);
  const d = await cuerpo(r);
  const { servidor_en, ...resto } = d;
  assert.deepEqual(resto, {
    mesa: 3,
    estado: 'abierta',
    abierta: true,
    orden_id: 'lq2x9k4abc',
    marca: '14.0',
    abierta_en: '2026-09-30T18:05:00.123Z',
    actualizada_en: '2026-09-30T18:20:11.500Z',
    items: [
      { nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 },
      { nombre: 'Limonada', precio: 5000, cantidad: 2 },
      { nombre: 'Limonada', precio: 6000, cantidad: 1 },
    ],
    total: 62000,
    canal: { topico: TOPICO_CEROS, evento: 'cambio', privado: false },
    liquidar_activo: false,
    liquidacion: null,
  });
  assert.match(servidor_en, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Math.abs(Date.parse(servidor_en) - Date.now()) < 5000, 'servidor_en es la hora del servidor, ahora');
});

ts('cabeceras de la respuesta: JSON, sin caché, CORS solo para la carta publicada, Vary: Origin', async () => {
  const { f } = await montar();
  const r = await pedir(f);
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGEN);
  assert.equal(r.headers.get('vary'), 'Origin');
  // localhost de desarrollo también puede leer; sin Origin (curl) no hay cabecera CORS pero sí respuesta.
  assert.equal((await pedir(f, { origen: 'http://localhost:5173' })).headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const sinOrigen = await pedir(f, { origen: null });
  assert.equal(sinOrigen.status, 200);
  assert.equal(sinOrigen.headers.get('access-control-allow-origin'), null);
  assert.equal(sinOrigen.headers.get('vary'), 'Origin');
});

ts('privacidad: ni notas, ni ids de ítems, ni el token, ni nada de otras mesas o de órdenes cerradas', async () => {
  const { f } = await montar();
  const texto = await (await pedir(f)).text();
  for (const prohibido of ['secreto de la mesa 4', 'Sopa · Res', 'Persona 2', '"nota"', '"id"', 'i1', TOKEN_3, 'otra4', 'vieja3', 'Postre', 'Café', 'token']) {
    assert.ok(!texto.includes(prohibido), `la respuesta no debe contener «${prohibido}»`);
  }
  // Y la mesa 4 ve la suya, no la de la 3.
  const d4 = await cuerpo(await pedir(f, { m: '4', k: TOKEN_4 }));
  assert.equal(d4.orden_id, 'otra4');
  assert.deepEqual(d4.items, [{ nombre: 'Café', precio: 3000, cantidad: 1 }]);
});

ts('fase 1: solo lee mesas y ordenes (ninguna tabla de la fase 2: se puede desplegar antes que su migración)', async () => {
  const { f, base } = await montar();
  await pedir(f);
  await pedir(f, { o: 'lq2x9k4abc' });
  await pedir(f, { o: 'ya-no-es' });
  assert.deepEqual(base.tablasLeidas().sort(), ['mesas', 'ordenes']);
  assert.ok(!base.tablasLeidas().includes('liquidaciones') && !base.tablasLeidas().includes('ajustes_cuenta'));
  // La orden se busca por la mesa VALIDADA con el token y solo abierta.
  const q = base.consultas.find((c) => c.tabla === 'ordenes');
  assert.deepEqual(q.filtros, [['mesa_id', 3], ['estado', 'abierta']]);
});

ts('el par (mesa, token) se valida junto: el token de otra mesa o uno inexistente → 404 enlace_invalido', async () => {
  const { f } = await montar();
  for (const intento of [{ k: TOKEN_4 }, { k: 'b'.repeat(48) }, { m: '99' }]) {
    const r = await pedir(f, intento);
    assert.equal(r.status, 404, JSON.stringify(intento));
    assert.deepEqual(await cuerpo(r), { error: 'enlace inválido', codigo: 'enlace_invalido' });
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGEN, 'el 404 también lo lee la carta (para decir «este enlace ya no sirve»)');
  }
});

ts('sin orden abierta: estado sin_orden, marca «0», canal y los campos de la fase 2 apagados', async () => {
  const { f } = await montar();
  const d = await cuerpo(await pedir(f, { m: '5', k: tokenDe(5) }));
  const { servidor_en, canal, ...resto } = d;
  assert.deepEqual(resto, { mesa: 5, estado: 'sin_orden', abierta: false, marca: '0', liquidar_activo: false, liquidacion: null });
  assert.match(canal.topico, /^cuenta:[0-9a-f]{64}$/, 'sigue suscrita: el INSERT de la orden emite y la cuenta aparece sola');
  assert.ok(servidor_en);
});

ts('`o`: la orden que la pestaña miraba. Si ya no es la abierta → «cerrada», y solo eso se dice', async () => {
  const { f } = await montar();
  // o = la abierta → respuesta normal.
  assert.equal((await cuerpo(await pedir(f, { o: 'lq2x9k4abc' }))).estado, 'abierta');
  // o = otra (la mesa tiene una abierta distinta, o `o` nunca fue suya) → cerrada, sin ítems ni dato de la orden nueva.
  for (const o of ['vieja3', 'otra4', 'inexistente']) {
    const r = await pedir(f, { o });
    assert.equal(r.status, 200, o);
    const d = await cuerpo(r);
    const { servidor_en, ...resto } = d;
    assert.deepEqual(resto, {
      mesa: 3, estado: 'cerrada', abierta: false, pago_confirmado: false,
      canal: { topico: TOPICO_CEROS, evento: 'cambio', privado: false },
    }, o);
    const texto = JSON.stringify(d);
    for (const filtrado of ['lq2x9k4abc', 'Limonada', '62000', 'items', 'orden_id', 'marca']) assert.ok(!texto.includes(filtrado), `«cerrada» no debe decir «${filtrado}»`);
    assert.ok(servidor_en);
  }
  // Mesa sin orden y con `o` → cerrada también (la orden que miraba fue borrada o liberada vacía).
  const vacia = await cuerpo(await pedir(f, { m: '5', k: tokenDe(5), o: 'lq2x9k4abc' }));
  assert.equal(vacia.estado, 'cerrada');
  assert.equal(vacia.abierta, false);
});

ts('`o` por tipo: sin `o`, una pestaña nueva ve la orden actual aunque la anterior se haya cerrado', async () => {
  const { f } = await montar({ tablas: { ...tablasBase(), ordenes: [orden({ id: 'segunda' })] } });
  assert.equal((await cuerpo(await pedir(f))).orden_id, 'segunda');
  assert.equal((await cuerpo(await pedir(f, { o: 'primera' }))).estado, 'cerrada');
});

ts('la marca sigue a ordenes.version: cada escritura de la orden la cambia', async () => {
  const tablas = tablasBase();
  const { f } = await montar({ tablas });
  const antes = (await cuerpo(await pedir(f))).marca;
  tablas.ordenes[0].version = 15;
  const despues = (await cuerpo(await pedir(f))).marca;
  assert.equal(antes, '14.0');
  assert.equal(despues, '15.0');
  tablas.ordenes[0].version = null;
  assert.equal((await cuerpo(await pedir(f))).marca, '0.0');
});

ts('el total viene de la orden; si falta, se calcula de los ítems agrupados', async () => {
  const t = tablasBase();
  t.ordenes[0].total = 0;
  const { f } = await montar({ tablas: t });
  assert.equal((await cuerpo(await pedir(f))).total, 23000 * 2 + 5000 * 2 + 6000);
});

ts('400 formato: m, k u o con formato inválido (y la base ni se toca)', async () => {
  const { f, base } = await montar();
  for (const [intento, descripcion] of [
    [{ m: 'x' }, 'm no numérica'], [{ m: '12345' }, 'm de 5 dígitos'], [{ m: null }, 'sin m'],
    [{ k: 'corto' }, 'k corto'], [{ k: 'A'.repeat(48) }, 'k en mayúsculas'], [{ k: null }, 'sin k'],
    [{ o: '' }, 'o vacía'], [{ o: 'a b' }, 'o con espacio'], [{ o: 'x'.repeat(65) }, 'o larga'], [{ o: "a'b" }, 'o con comilla'],
  ]) {
    const r = await pedir(f, intento);
    assert.equal(r.status, 400, descripcion);
    assert.deepEqual(await cuerpo(r), { error: 'enlace inválido', codigo: 'formato' }, descripcion);
  }
  assert.equal(base.consultas.length, 0);
});

ts('405 metodo para todo lo que no sea GET u OPTIONS, con Allow', async () => {
  const { f, base } = await montar();
  for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await f.atender(new Request('https://prueba.invalid/functions/v1/cuenta?m=3&k=' + TOKEN_3, { method: metodo, headers: { origin: ORIGEN }, ...(metodo === 'DELETE' ? {} : { body: '{}' }) }));
    assert.equal(r.status, 405, metodo);
    assert.deepEqual(await cuerpo(r), { error: 'método no permitido', codigo: 'metodo' });
    assert.equal(r.headers.get('allow'), 'GET, OPTIONS');
  }
  assert.equal(base.consultas.length, 0);
});

ts('403 origen: un Origin presente fuera de la lista no recibe datos ni cabeceras CORS, ni toca la base', async () => {
  const { f, base } = await montar();
  for (const origen of [
    'https://evil.example', 'null', 'http://resplandor.ynt.codes', 'https://resplandor.ynt.codes.evil.example',
    'http://localhost.evil.example', 'http://127.0.0.1:3000', 'https://localhost:3000',
  ]) {
    for (const metodo of ['GET', 'OPTIONS', 'POST']) {
      const r = await pedir(f, { origen, metodo });
      assert.equal(r.status, 403, `${metodo} desde ${origen}`);
      assert.deepEqual(await cuerpo(r), { error: 'origen no permitido', codigo: 'origen' });
      assert.equal([...r.headers.keys()].filter((h) => h.startsWith('access-control-')).length, 0, 'sin ninguna cabecera CORS');
      assert.equal(r.headers.get('vary'), 'Origin');
    }
  }
  assert.equal(base.consultas.length, 0, 'ni una consulta para un origen ajeno');
});

ts('OPTIONS (preflight): 204 con métodos, cabeceras que manda la carta (apikey, authorization) y Max-Age', async () => {
  const { f, base } = await montar();
  const r = await pedir(f, { metodo: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(await r.text(), '');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGEN);
  assert.equal(r.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.match(r.headers.get('access-control-allow-headers'), /apikey/);
  assert.match(r.headers.get('access-control-allow-headers'), /authorization/);
  assert.ok(Number(r.headers.get('access-control-max-age')) >= 600);
  assert.equal(base.consultas.length, 0);
  // Sin Origin (no es un preflight de navegador): 204 sin CORS.
  assert.equal((await pedir(f, { metodo: 'OPTIONS', origen: null })).headers.get('access-control-allow-origin'), null);
});

ts('429 por (IP, mesa): la 121.ª en un minuto, con Retry-After, CORS legible por la carta y codigo demasiadas', async (t) => {
  const reloj = { t: 10_000_000 };
  t.mock.method(Date, 'now', () => reloj.t);
  const { f } = await montar();
  for (let i = 0; i < 120; i++) assert.equal((await pedir(f)).status, 200, `pedido ${i + 1}`);
  const r = await pedir(f);
  assert.equal(r.status, 429);
  assert.deepEqual(await cuerpo(r), { error: 'demasiadas solicitudes', codigo: 'demasiadas' });
  const espera = Number(r.headers.get('retry-after'));
  assert.ok(espera >= 1 && espera <= 60, `Retry-After ${espera}`);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGEN, 'sin CORS en el 429 la carta no vería ni el estado');
  assert.match(r.headers.get('access-control-expose-headers'), /Retry-After/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  // Otra mesa desde la misma IP: su propio tope. Otra IP: sigue pasando.
  assert.equal((await pedir(f, { m: '4', k: TOKEN_4 })).status, 200);
  assert.equal((await pedir(f, { ip: '198.51.100.9' })).status, 200);
  reloj.t += 61_000;
  assert.equal((await pedir(f)).status, 200, 'pasado el minuto, vuelve');
});

ts('429 por IP: 600 por minuto repartidos en mesas (el límite viejo era 40 por IP)', async (t) => {
  const reloj = { t: 20_000_000 };
  t.mock.method(Date, 'now', () => reloj.t);
  const tablas = tablasBase();
  const { f } = await montar({ tablas });
  const mesas = tablas.mesas.filter((x) => x.id !== 3 && x.id !== 4).slice(0, 6);
  for (let i = 0; i < 600; i++) {
    const x = mesas[i % mesas.length];
    assert.equal((await pedir(f, { m: String(x.id), k: x.token })).status, 200, `pedido ${i + 1}`);
  }
  const r = await pedir(f, { m: String(mesas[0].id), k: mesas[0].token });
  assert.equal(r.status, 429);
  assert.equal((await cuerpo(r)).codigo, 'demasiadas');
});

ts('barrido de tokens: más de 20 respuestas 404 por minuto para una mesa bloquean esa mesa desde esa IP 10 minutos, también para un token bueno; las otras mesas y las otras IP siguen', async (t) => {
  const reloj = { t: 30_000_000 };
  t.mock.method(Date, 'now', () => reloj.t);
  const { f } = await montar();
  const malo = (i) => ({ k: i.toString(16).padStart(48, 'b'), ip: '192.0.2.50' });
  for (let i = 0; i < 21; i++) assert.equal((await pedir(f, malo(i))).status, 404, `intento ${i + 1}`);
  const bloqueado = await pedir(f, { ip: '192.0.2.50' }); // token BUENO de la mesa 3, pero (IP, mesa 3) está bloqueada
  assert.equal(bloqueado.status, 429);
  assert.equal(bloqueado.headers.get('retry-after'), '600');
  assert.equal((await cuerpo(bloqueado)).codigo, 'demasiadas');
  assert.equal((await pedir(f, { m: '4', k: TOKEN_4, ip: '192.0.2.50' })).status, 200, 'otra mesa desde la misma IP (el wifi del local) no se ve afectada: H4');
  assert.equal((await pedir(f, { ip: '192.0.2.51' })).status, 200, 'otra IP no se ve afectada');
  reloj.t += 599_000;
  assert.equal((await pedir(f, { ip: '192.0.2.50' })).status, 429);
  reloj.t += 2_000;
  assert.equal((await pedir(f, { ip: '192.0.2.50' })).status, 200, 'a los 10 minutos, libre');
});

ts('20 respuestas 404 en un minuto todavía no bloquean (un enlace viejo que alguien abre varias veces)', async (t) => {
  const reloj = { t: 40_000_000 };
  t.mock.method(Date, 'now', () => reloj.t);
  const { f } = await montar();
  for (let i = 0; i < 20; i++) assert.equal((await pedir(f, { k: i.toString(16).padStart(48, 'c') })).status, 404);
  assert.equal((await pedir(f)).status, 200);
});

ts('500 interno: error de la base → {error, codigo}, con CORS, sin filtrar el mensaje de la base', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const falla of [{ mesas: new Error('password authentication failed for user "service_role"') }, { ordenes: { code: '42P01', message: 'relation "public.ordenes" does not exist' } }]) {
    const { f } = await montar({ fallas: falla });
    const r = await pedir(f);
    assert.equal(r.status, 500);
    assert.deepEqual(await cuerpo(r), { error: 'no se pudo leer la cuenta', codigo: 'interno' });
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGEN);
  }
});

ts('toda respuesta de error trae {error, codigo} de texto (el contrato de §04.3)', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { f } = await montar();
  const respuestas = [
    await pedir(f, { m: 'x' }),                                        // 400
    await pedir(f, { origen: 'https://evil.example' }),                 // 403
    await pedir(f, { k: 'b'.repeat(48) }),                             // 404
    await pedir(f, { metodo: 'PUT' }),                                 // 405
  ];
  const lleno = await montar({ fallas: { mesas: new Error('x') } });
  respuestas.push(await pedir(lleno.f));                               // 500
  for (const r of respuestas) {
    const d = await cuerpo(r);
    assert.ok(r.status >= 400, String(r.status));
    assert.equal(typeof d.error, 'string');
    assert.match(d.codigo, /^[a-z_]+$/);
    assert.deepEqual(Object.keys(d).sort(), ['codigo', 'error']);
  }
  assert.deepEqual(respuestas.map((r) => r.status), [400, 403, 404, 405, 500]);
});

// Lo que la carta ya publicada (be68c6b, carta.html `cargarCuenta`) lee de la respuesta: si el contrato
// v2 cambia alguno de estos campos, la carta del aire se rompe durante el despliegue.
ts('compatibilidad con la carta publicada: abierta, items[{nombre, precio, cantidad}], total, abierta_en; errores con `error`', async () => {
  const { f } = await montar();
  const abierta = await cuerpo(await pedir(f));
  assert.equal(abierta.abierta, true);
  assert.ok(Array.isArray(abierta.items) && abierta.items.length > 0);
  for (const i of abierta.items) {
    assert.equal(typeof i.nombre, 'string');
    assert.equal(typeof i.precio, 'number');
    assert.equal(typeof i.cantidad, 'number');
  }
  assert.equal(typeof abierta.total, 'number');
  assert.equal(typeof abierta.abierta_en, 'string');
  assert.ok(!Number.isNaN(Date.parse(abierta.abierta_en)));
  // Sin orden: `abierta` falso (la carta de hoy pinta «Todavía no hay cuenta abierta»).
  assert.equal((await cuerpo(await pedir(f, { m: '5', k: tokenDe(5) }))).abierta, false);
  // Sin `o`, la carta de hoy nunca recibe «cerrada»: la respuesta de una mesa con orden es siempre la abierta.
  assert.equal((await cuerpo(await pedir(f))).estado, 'abierta');
  // Errores: lee `d.error` y el estado HTTP (429 con CORS legible).
  assert.equal(typeof (await cuerpo(await pedir(f, { k: 'b'.repeat(48) }))).error, 'string');
});

// ───────────────────────── 3. el código fuente ─────────────────────────

test('index.ts usa el código compartido y no trae CORS abierto ni un límite propio', () => {
  const src = sinComentarios(leer(FUNCION));
  assert.match(src, /from "\.\.\/_compartido\/mesa\.js"/);
  assert.doesNotMatch(src, /Access-Control-Allow-Origin["']?\s*:\s*["']\*/i, 'CORS con lista, nunca *');
  assert.doesNotMatch(src, /const HITS\b|MAX_HITS/, 'el limitador vive en _compartido/mesa.js');
  assert.doesNotMatch(src, /liquidaciones|ajustes_cuenta/, 'ninguna tabla de la fase 2 en la fase 1 (se lee con cuenta_cliente en 2B)');
  assert.match(src, /limitador\.registrar404\(ip, m\)/, 'el 404 alimenta el bloqueo por barrido, por pareja (IP, mesa)');
});

test('_compartido/mesa.js es JS plano (se prueba en Node): sin imports, sin Deno y sin npm', () => {
  const src = sinComentarios(leer('supabase/functions/_compartido/mesa.js'));
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\bDeno\b|npm:|require\(/);
});

// ───────────────────────── 3. abonos (cobro por monto, ola B) ─────────────────────────

ts('un abono recibido (línea de precio NEGATIVO) pasa tal cual y el total es el de la base: lo que queda por pagar', async () => {
  // Lo que deja el POS al cobrar un monto: la orden abierta con la línea `abono_recibido_<uid>` (precio −monto, qty 1) y el
  // total que calcula aplicar_delta_orden (Σ precio × qty). La orden cerrada «Abono» es otra fila y no se lee.
  const items = [
    { id: 'p1', nombre: 'Bandeja', precio: 23000, qty: 2, nota: '' },
    { id: 'abono_recibido_u1', nombre: 'Abono recibido', precio: -20000, qty: 1, nota: 'efectivo' },
    { id: 'abono_recibido_u2', nombre: 'Abono recibido', precio: -6000, qty: 1, nota: 'transferencia' },
  ];
  const tablas = tablasBase();
  tablas.ordenes[0] = orden({ items, total: 20000, version: 20 });
  tablas.ordenes.push(orden({ id: 'ab1', estado: 'cerrada', items: [{ id: 'abono_u1', nombre: 'Abono', precio: 20000, qty: 1, nota: 'efectivo' }], total: 20000 }));
  const { f } = await montar({ tablas });
  const d = await cuerpo(await pedir(f));
  assert.equal(d.total, 20000, 'el total no se recalcula: es el de la base');
  assert.deepEqual(d.items, [
    { nombre: 'Bandeja', precio: 23000, cantidad: 2 },
    { nombre: 'Abono recibido', precio: -20000, cantidad: 1 },
    { nombre: 'Abono recibido', precio: -6000, cantidad: 1 },
  ], 'montos distintos no se funden; ningún id ni nota de cocina sale');
  assert.equal(d.items.reduce((s, i) => s + i.precio * i.cantidad, 0), d.total, 'las líneas suman el total');
  assert.ok(!JSON.stringify(d).includes('efectivo') && !JSON.stringify(d).includes('transferencia'), 'el método de pago (la nota) no sale');
  // dos abonos del MISMO monto se agrupan por (nombre, precio): «2 × Abono recibido −10.000»
  assert.deepEqual(agruparItems([
    { nombre: 'Abono recibido', precio: -10000, qty: 1 }, { nombre: 'Abono recibido', precio: -10000, qty: 1 },
  ]), [{ nombre: 'Abono recibido', precio: -10000, cantidad: 2 }]);
});

ts('una cuenta cuyos abonos igualan el consumo (total 0) sigue leyéndose: el total 0 de la base manda, no se recalcula a otra cosa', async () => {
  const tablas = tablasBase();
  tablas.ordenes[0] = orden({
    items: [{ id: 'p1', nombre: 'Bandeja', precio: 23000, qty: 1, nota: '' }, { id: 'abono_recibido_u9', nombre: 'Abono recibido', precio: -23000, qty: 1, nota: 'qr' }],
    total: 0,
  });
  const { f } = await montar({ tablas });
  const r = await pedir(f);
  assert.equal(r.status, 200);
  const d = await cuerpo(r);
  assert.equal(d.total, 0);
  assert.equal(d.abierta, true);
});
