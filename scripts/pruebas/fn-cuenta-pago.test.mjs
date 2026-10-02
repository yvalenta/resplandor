// Edge Function `cuenta` + pago con Bre-B (migración 20261003150000_pago_breb.sql).
//
// «Mi cuenta» de la carta trae `pago: { breb: { llave, qr } }` SOLO si la mesa tiene cuenta ABIERTA y el admin encendió
// `ajustes.pago_breb_visible`; en cualquier otro caso la respuesta NO trae `pago` (la carta no inventa nada).
//
// Dos capas, como fn-cuenta.test.mjs:
//   1. Los ayudantes de supabase/functions/_compartido/mesa.js (emvCrc16, emvCrcOk, llaveBrebValida, qrBrebValido, pagoBreb),
//      contra el valor de control estándar del CRC y contra QR armados con OTRA implementación (_pago-breb-vectores.mjs).
//   2. cuenta/index.ts CORRIDO de verdad (scripts/pruebas/_funcion-simulada.mjs: Request reales, base en memoria, supabase-js falso
//      que anota cada consulta): cuándo trae pago y cuándo no, qué columnas pide (solo las que la migración le da a service_role),
//      que la cuenta no se rompe si `ajustes` no se puede leer, y que el archivo empaquetado para el dashboard responde igual.
// La base REAL (Postgres con los GRANT y los CHECK de verdad) la ejercita migracion-pago-breb.test.mjs.
//
// Todo dato de pago de aquí es FICTICIO (el real vive fuera del repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { empaquetar } from '../empaquetar-funcion.mjs';
import { baseSimulada, cargarFuncion, importarModulo } from './_funcion-simulada.mjs';
import {
  crcPorTabla, hex4, tlv, conCrc, corromper, qrDeLargo, qrMalos, cuerpoFicticio,
  QR_FICTICIO, QR_FICTICIO_2, LLAVE_FICTICIA, LLAVES_BUENAS, LLAVES_MALAS, TOKEN_MESA_3, TOKEN_MESA_4,
} from './_pago-breb-vectores.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mesa = await importarModulo('supabase/functions/_compartido/mesa.js');
const { emvCrc16, emvCrcOk, llaveBrebValida, qrBrebValido, pagoBreb } = mesa;

// ───────────────────────── 1. los ayudantes de mesa.js ─────────────────────────

test('emvCrc16: CRC-16/CCITT-FALSE; el valor de control estándar «123456789» da 0x29B1, y coincide con la implementación por tabla', () => {
  assert.equal(emvCrc16('123456789'), 0x29b1);
  assert.equal(crcPorTabla('123456789'), 0x29b1, 'la implementación de referencia de las pruebas también cumple el estándar');
  assert.equal(emvCrc16(''), 0xffff, 'sin bytes queda el valor inicial');
  for (const t of ['A', '000201', 'CO.COM.RBM.LLA', QR_FICTICIO, 'x'.repeat(700), 'ñandú', '6304']) {
    assert.equal(emvCrc16(t), crcPorTabla(t), `«${t.slice(0, 20)}»`);
  }
});

test('emvCrcOk: acepta el QR ficticio (CRC en mayúsculas o minúsculas) y rechaza cualquier tropiezo', () => {
  assert.equal(emvCrcOk(QR_FICTICIO), true);
  assert.equal(emvCrcOk(QR_FICTICIO_2), true);
  assert.equal(emvCrcOk(QR_FICTICIO.slice(0, -4) + QR_FICTICIO.slice(-4).toLowerCase()), true, 'el CRC en minúsculas también cuadra');
  assert.match(QR_FICTICIO, /^000201010211/);
  assert.equal(hex4(crcPorTabla(QR_FICTICIO.slice(0, -4))), QR_FICTICIO.slice(-4), 'el CRC del vector lo calculó la otra implementación');

  assert.equal(emvCrcOk(corromper(QR_FICTICIO)), false);
  assert.equal(emvCrcOk(QR_FICTICIO.slice(0, -1)), false, 'sin el último carácter');
  assert.equal(emvCrcOk(QR_FICTICIO + '0'), false, 'con un carácter de más');
  assert.equal(emvCrcOk(cuerpoFicticio()), false, 'sin el campo 63');
  for (const malo of [null, undefined, 7, {}, [], '', ' ', '6304', '00020163040000', 'x'.repeat(30)]) assert.equal(emvCrcOk(malo), false, String(malo));
  // Con el CRC bien calculado pero la estructura rota: el campo 63 tiene que ser el último y de 4 caracteres.
  assert.equal(emvCrcOk(conCrc(cuerpoFicticio()) + tlv('99', 'XX')), false);
  assert.equal(emvCrcOk(conCrc(cuerpoFicticio() + '9999abc')), false, 'un campo cuyo largo se pasa del final');
  assert.equal(emvCrcOk(conCrc(cuerpoFicticio() + 'ab02xy')), false, 'una etiqueta que no son dígitos');
  assert.equal(emvCrcOk(qrDeLargo(1024)), true, 'hasta 1024 caracteres se calcula (el tope de 700 lo pone la base)');
  assert.equal(emvCrcOk(qrDeLargo(1025)), false, 'más de 1024: no se calcula');
});

test('llaveBrebValida: las mismas llaves que aceptan y rechazan los CHECK de la base', () => {
  for (const l of LLAVES_BUENAS) assert.equal(llaveBrebValida(l), true, l);
  for (const [nombre, l] of LLAVES_MALAS) assert.equal(llaveBrebValida(l), false, nombre);
  for (const malo of [null, undefined, 3001234567, {}, []]) assert.equal(llaveBrebValida(malo), false, String(malo));
});

test('qrBrebValido: 20 a 700 caracteres, empieza por 000201, ASCII imprimible y CRC correcto; los bordes', () => {
  assert.equal(qrBrebValido(QR_FICTICIO), true);
  assert.equal(qrBrebValido(qrDeLargo(20)), true, 'el borde de abajo');
  assert.equal(qrBrebValido(qrDeLargo(700)), true, 'el borde de arriba');
  for (const [nombre, v] of qrMalos()) assert.equal(qrBrebValido(v), false, nombre);
  for (const malo of [null, undefined, 5, {}]) assert.equal(qrBrebValido(malo), false, String(malo));
});

test('pagoBreb: solo con «visible» en true (de verdad true) y una llave y un QR válidos; devuelve SOLO llave y qr', () => {
  const fila = { pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO };
  assert.deepEqual(pagoBreb(fila), { breb: { llave: LLAVE_FICTICIA, qr: QR_FICTICIO } });
  assert.deepEqual(Object.keys(pagoBreb(fila)), ['breb']);
  assert.deepEqual(Object.keys(pagoBreb(fila).breb).sort(), ['llave', 'qr']);
  // Aunque la fila traiga más columnas (no deberían), no salen.
  const mas = pagoBreb({ ...fila, ticket_pie: 'secreto', actualizado_por: 'admin@x.test', id: 1 });
  assert.deepEqual(Object.keys(mas.breb).sort(), ['llave', 'qr']);
  assert.ok(!JSON.stringify(mas).includes('secreto'));

  for (const [nombre, f] of [
    ['apagado', { ...fila, pago_breb_visible: false }],
    ['visible como texto «true»', { ...fila, pago_breb_visible: 'true' }],
    ['visible como 1', { ...fila, pago_breb_visible: 1 }],
    ['visible null', { ...fila, pago_breb_visible: null }],
    ['sin la columna visible', { pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }],
    ['sin llave', { ...fila, pago_breb_llave: null }],
    ['sin QR', { ...fila, pago_breb_qr: null }],
    ['llave de forma rara', { ...fila, pago_breb_llave: '@a b' }],
    ['QR con el CRC malo', { ...fila, pago_breb_qr: corromper(QR_FICTICIO) }],
    ['QR vacío', { ...fila, pago_breb_qr: '' }],
    ['sin fila', null],
    ['fila indefinida', undefined],
    ['una cadena', 'texto'],
  ]) assert.equal(pagoBreb(f), null, nombre);
});

// ───────────────────────── 2. cuenta/index.ts corrido de verdad ─────────────────────────

const HAY_TS = Boolean(process.features?.typescript);
const MOTIVO_TS = HAY_TS ? false : `correr index.ts pide Node ≥ 22.18 (type stripping); esto corre con ${process.versions.node}`;
const ts = (nombre, fn) => test(nombre, { skip: MOTIVO_TS }, fn);

const FUNCION = 'supabase/functions/cuenta/index.ts';
const ORIGEN = 'https://resplandor.ynt.codes';
const TOKEN_5 = 'a'.repeat(48);
const ITEMS = [
  { id: 'i1', nombre: 'Menú Resplandor', precio: 23000, qty: 2, nota: 'Sopa · Res' },
  { id: 'i2', nombre: 'Limonada', precio: 5000, qty: 2, nota: 'Persona 2' },
];
const orden = (extra) => ({
  id: 'lq2x9k4abc', mesa_id: 3, estado: 'abierta', items: ITEMS, total: 56000,
  abierta_en: '2026-09-30T18:05:00.123456+00:00', updated_at: '2026-09-30T18:20:11.5+00:00', version: 14, ...extra,
});
const ajustesFila = (extra) => ({
  id: 1, ticket_qr_url: 'https://resplandor.ynt.codes/', ticket_qr_visible: true, ticket_pie: 'Pie secreto del ticket',
  actualizado_en: '2026-10-02T12:00:00+00:00', actualizado_por: 'admin@resplandor.test',
  pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO, ...extra,
});
const tablasBase = (extraAjustes) => ({
  mesas: [
    { id: 3, token: TOKEN_MESA_3, estado: 'ocupada', activa: true },
    { id: 4, token: TOKEN_MESA_4, estado: 'ocupada', activa: true },
    { id: 5, token: TOKEN_5, estado: 'libre', activa: true },
    { id: 6, token: 'b'.repeat(48), estado: 'ocupada', activa: false },
  ],
  ordenes: [
    orden(),
    orden({ id: 'otra4', mesa_id: 4, items: [{ id: 'z', nombre: 'Café', precio: 3000, qty: 1, nota: 'x' }], total: 3000, version: 2 }),
    orden({ id: 'vieja3', mesa_id: 3, estado: 'cerrada', items: [{ id: 'y', nombre: 'Postre', precio: 9000, qty: 1 }], total: 9000 }),
    orden({ id: 'dormida6', mesa_id: 6, items: [{ id: 'w', nombre: 'Agua', precio: 2000, qty: 1 }], total: 2000 }),
  ],
  ajustes: [ajustesFila(extraAjustes)],
});

async function montar({ tablas = tablasBase(), fallas = {}, envolver } = {}) {
  const base = baseSimulada({ tablas, fallas });
  if (envolver) envolver(base);
  const f = await cargarFuncion(FUNCION, { base });
  return { base, f, tablas };
}
function pedir(f, { m = '3', k = TOKEN_MESA_3, o, origen = ORIGEN, ip = '203.0.113.7' } = {}) {
  const q = new URLSearchParams({ ...(m === null ? {} : { m }), ...(k === null ? {} : { k }), ...(o === undefined ? {} : { o }) }).toString();
  const headers = { 'x-forwarded-for': ip };
  if (origen !== null) headers.origin = origen;
  return f.atender(new Request(`https://prueba.invalid/functions/v1/cuenta?${q}`, { method: 'GET', headers }));
}
const cuerpo = async (r) => JSON.parse(await r.text());
const PAGO = { breb: { llave: LLAVE_FICTICIA, qr: QR_FICTICIO } };

ts('con cuenta abierta y «visible» encendido: la respuesta trae pago.breb con SOLO llave y qr, y lo demás es igual que antes', async () => {
  const { f } = await montar();
  const d = await cuerpo(await pedir(f));
  const { servidor_en, ...resto } = d;
  assert.deepEqual(resto, {
    mesa: 3, estado: 'abierta', abierta: true, orden_id: 'lq2x9k4abc', marca: '14.0',
    abierta_en: '2026-09-30T18:05:00.123Z', actualizada_en: '2026-09-30T18:20:11.500Z',
    items: [{ nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 }, { nombre: 'Limonada', precio: 5000, cantidad: 2 }],
    total: 56000,
    canal: { topico: 'cuenta:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a', evento: 'cambio', privado: false },
    liquidar_activo: false, liquidacion: null,
    pago: PAGO,
  });
  assert.deepEqual(Object.keys(d.pago), ['breb']);
  assert.deepEqual(Object.keys(d.pago.breb).sort(), ['llave', 'qr']);
  assert.equal(d.pago.breb.qr, QR_FICTICIO);
});

ts('la respuesta sin pago es EXACTAMENTE la de antes: el mismo cuerpo con y sin «visible», salvo la clave pago', async () => {
  const apagado = await montar({ tablas: tablasBase({ pago_breb_visible: false }) });
  const encendido = await montar();
  const a = await cuerpo(await pedir(apagado.f));
  const b = await cuerpo(await pedir(encendido.f));
  delete a.servidor_en; delete b.servidor_en;
  assert.ok(!('pago' in a), 'apagado: ni la clave pago, ni pago:null');
  const { pago, ...sinPago } = b;
  assert.deepEqual(sinPago, a);
});

ts('cabeceras: sin caché, CORS de lista, JSON; y el cuerpo no deja pasar nada más de `ajustes` (ni el pie, ni quién editó, ni el correo)', async () => {
  const { f } = await montar();
  const r = await pedir(f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store', 'la llave y el QR nunca se guardan en una caché');
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGEN);
  const texto = await r.text();
  for (const prohibido of ['Pie secreto del ticket', 'admin@resplandor.test', 'ticket_pie', 'ticket_qr', 'actualizado', 'pago_breb', 'ajustes', 'visible']) {
    assert.ok(!texto.includes(prohibido), `la respuesta no debe contener «${prohibido}»`);
  }
});

ts('apagado (visible = false), o sin llave, o sin QR, o con valores que no pasan las reglas: sin pago, y la cuenta sale igual', async () => {
  for (const [nombre, extra] of [
    ['apagado', { pago_breb_visible: false }],
    ['visible como texto', { pago_breb_visible: 'true' }],
    ['sin llave', { pago_breb_llave: null }],
    ['sin QR', { pago_breb_qr: null }],
    ['llave de forma rara', { pago_breb_llave: '@a b' }],
    ['QR con el CRC malo', { pago_breb_qr: corromper(QR_FICTICIO) }],
    ['QR que no empieza por 000201', { pago_breb_qr: conCrc('000202' + cuerpoFicticio().slice(6)) }],
  ]) {
    const { f } = await montar({ tablas: tablasBase(extra) });
    const r = await pedir(f);
    assert.equal(r.status, 200, nombre);
    const d = await cuerpo(r);
    assert.ok(!('pago' in d), `${nombre}: no debe traer pago`);
    assert.equal(d.estado, 'abierta', nombre);
    assert.equal(d.total, 56000, nombre);
  }
});

ts('sin ajustes (la fila no existe): sin pago', async () => {
  const t = tablasBase(); t.ajustes = [];
  const { f } = await montar({ tablas: t });
  const d = await cuerpo(await pedir(f));
  assert.equal(d.estado, 'abierta');
  assert.ok(!('pago' in d));
});

ts('sin cuenta abierta (sin_orden), con la cuenta cerrada (`o` que ya no es la abierta) o con un token malo: NUNCA pago, y ni siquiera se lee `ajustes`', async () => {
  const { f, base } = await montar();
  // mesa 5: libre, sin orden
  const sin = await cuerpo(await pedir(f, { m: '5', k: TOKEN_5 }));
  assert.equal(sin.estado, 'sin_orden');
  assert.ok(!('pago' in sin));
  // la pestaña miraba otra orden: «cerrada»
  const cerrada = await cuerpo(await pedir(f, { o: 'vieja3' }));
  assert.equal(cerrada.estado, 'cerrada');
  assert.ok(!('pago' in cerrada));
  // token de otra mesa, token inexistente, mesa inexistente, mesa desactivada
  for (const intento of [{ k: TOKEN_MESA_4 }, { k: 'c'.repeat(48) }, { m: '99' }, { m: '6', k: 'b'.repeat(48) }]) {
    const r = await pedir(f, intento);
    assert.equal(r.status, 404, JSON.stringify(intento));
    const t = await r.text();
    assert.ok(!t.includes('pago') && !t.includes('qr') && !t.includes('llave'), `el 404 no dice nada del pago: ${t}`);
  }
  // formato inválido: 400 sin tocar la base
  assert.equal((await pedir(f, { k: 'corto' })).status, 400);
  assert.ok(!base.tablasLeidas().includes('ajustes'), 'solo se lee `ajustes` cuando la respuesta es una cuenta abierta');
});

ts('lee `ajustes` UNA vez por cuenta abierta, con la fila 1 y SOLO las tres columnas que la migración le da a service_role (nunca «*»)', async () => {
  const { f, base } = await montar();
  await pedir(f);
  const lecturas = base.consultas.filter((c) => c.tabla === 'ajustes');
  assert.equal(lecturas.length, 1);
  assert.deepEqual(lecturas[0].filtros, [['id', 1]]);
  const columnas = lecturas[0].columnas.split(',').map((c) => c.trim());
  assert.deepEqual(columnas, ['pago_breb_visible', 'pago_breb_llave', 'pago_breb_qr']);
  assert.ok(!lecturas[0].columnas.includes('*'));
  // y las demás tablas, como siempre
  assert.deepEqual(base.tablasLeidas().sort(), ['ajustes', 'mesas', 'ordenes']);
  await pedir(f);
  assert.equal(base.consultas.filter((c) => c.tabla === 'ajustes').length, 2, 'sin caché en la función: un cambio del admin se ve en la siguiente lectura');
});

ts('dinámico: lo que el admin cambia en la base se ve en la siguiente lectura (la función no recuerda nada)', async () => {
  const t = tablasBase();
  const { f } = await montar({ tablas: t });
  assert.deepEqual((await cuerpo(await pedir(f))).pago, PAGO);
  t.ajustes[0].pago_breb_qr = QR_FICTICIO_2;
  t.ajustes[0].pago_breb_llave = '@OtraFicticia9';
  assert.deepEqual((await cuerpo(await pedir(f))).pago, { breb: { llave: '@OtraFicticia9', qr: QR_FICTICIO_2 } });
  t.ajustes[0].pago_breb_visible = false;
  assert.ok(!('pago' in await cuerpo(await pedir(f))));
  t.ajustes[0].pago_breb_visible = true;
  assert.deepEqual((await cuerpo(await pedir(f))).pago, { breb: { llave: '@OtraFicticia9', qr: QR_FICTICIO_2 } });
});

ts('es de todas las mesas con cuenta abierta (un ajuste del local), pero cada una ve SU cuenta', async () => {
  const { f } = await montar();
  const d4 = await cuerpo(await pedir(f, { m: '4', k: TOKEN_MESA_4 }));
  assert.deepEqual(d4.pago, PAGO);
  assert.equal(d4.orden_id, 'otra4');
  assert.deepEqual(d4.items, [{ nombre: 'Café', precio: 3000, cantidad: 1 }]);
});

ts('si `ajustes` no se puede leer (migración sin aplicar: tabla, columna o permiso que faltan; o la base falla): 200 con la cuenta, sin pago, y queda un aviso en el log', async (t) => {
  const registro = [];
  t.mock.method(console, 'error', (...a) => { registro.push(a); });
  const casos = [
    ['la tabla no existe (42P01)', () => { const x = tablasBase(); delete x.ajustes; return { tablas: x }; }],
    ['la columna no existe (42703: función nueva con la migración sin aplicar)', () => {
      const x = tablasBase(); x.ajustes = [{ id: 1, ticket_pie: 'x' }]; return { tablas: x };
    }],
    ['service_role sin permiso (42501)', () => ({ fallas: { ajustes: { code: '42501', message: 'permission denied for table ajustes' } } })],
    ['la base se cae (XX000)', () => ({ fallas: { ajustes: { code: 'XX000', message: 'boom' } } })],
    ['la consulta lanza una excepción', () => ({ envolver: (base) => {
      const desde = base.cliente.from;
      base.cliente.from = (tabla) => { if (tabla === 'ajustes') throw new Error('se cayó la red'); return desde(tabla); };
    } })],
  ];
  for (const [nombre, armar] of casos) {
    registro.length = 0;
    const { f } = await montar(armar());
    const r = await pedir(f);
    assert.equal(r.status, 200, nombre);
    const d = await cuerpo(r);
    assert.equal(d.estado, 'abierta', nombre);
    assert.equal(d.total, 56000, nombre);
    assert.deepEqual(d.items.length, 2, nombre);
    assert.ok(!('pago' in d), `${nombre}: sin pago`);
    assert.ok(registro.some((a) => String(a[0]).includes('no se pudo leer el pago')), `${nombre}: avisa en el log`);
    // el aviso no vuelca datos de pago ni de la cuenta
    assert.ok(!JSON.stringify(registro).includes(QR_FICTICIO), nombre);
  }
});

ts('el aviso del log sale como mucho UNA vez por minuto (con la migración sin aplicar, cada pedido lo repetiría), y vuelve pasado el minuto', async (t) => {
  const registro = [];
  t.mock.method(console, 'error', (...a) => { registro.push(a); });
  const reloj = { t: 50_000_000 };
  t.mock.method(Date, 'now', () => reloj.t);
  const x = tablasBase(); delete x.ajustes;
  const { f } = await montar({ tablas: x });
  const avisos = () => registro.filter((a) => String(a[0]).includes('no se pudo leer el pago')).length;
  for (let i = 0; i < 6; i++) assert.equal((await pedir(f)).status, 200);
  assert.equal(avisos(), 1, 'seis pedidos, un solo aviso');
  reloj.t += 59_000;
  await pedir(f);
  assert.equal(avisos(), 1, 'a los 59 s todavía no');
  reloj.t += 2_000;
  await pedir(f);
  assert.equal(avisos(), 2, 'pasado el minuto vuelve a avisar');
});

ts('el flujo de hoy no cambia: con la base vieja (sin `ajustes` del todo) el contrato v2 de siempre sale tal cual', async (t) => {
  t.mock.method(console, 'error', () => {});
  const x = tablasBase(); delete x.ajustes;
  const { f } = await montar({ tablas: x });
  const { servidor_en, ...resto } = await cuerpo(await pedir(f));
  assert.deepEqual(Object.keys(resto).sort(), ['abierta', 'abierta_en', 'actualizada_en', 'canal', 'estado', 'items', 'liquidacion', 'liquidar_activo', 'marca', 'mesa', 'orden_id', 'total']);
  assert.ok(servidor_en);
});

ts('el archivo empaquetado para el dashboard (index.ts + mesa.js en uno) responde igual, con pago y sin él', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-cuenta-pago-empaquetada-'));
  try {
    const destino = path.join(raiz, 'supabase', 'functions', 'cuenta', 'index.ts');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const { texto } = empaquetar('cuenta');
    for (const n of ['emvCrc16', 'emvCrcOk', 'llaveBrebValida', 'qrBrebValido', 'pagoBreb']) assert.match(texto, new RegExp(`^function ${n}\\b`, 'm'), `el paquete trae ${n}`);
    assert.equal(/^export\b/m.test(texto), false);
    fs.writeFileSync(destino, texto);
    for (const extra of [{}, { pago_breb_visible: false }, { pago_breb_qr: corromper(QR_FICTICIO) }]) {
      const original = await cargarFuncion(FUNCION, { base: baseSimulada({ tablas: tablasBase(extra) }) });
      const juntada = await cargarFuncion(path.relative(RAIZ, destino), { base: baseSimulada({ tablas: tablasBase(extra) }) });
      const ver = async (f) => { const d = await cuerpo(await pedir(f)); delete d.servidor_en; return d; };
      assert.deepEqual(await ver(juntada), await ver(original), JSON.stringify(Object.keys(extra)));
    }
    const conPago = await cargarFuncion(path.relative(RAIZ, destino), { base: baseSimulada({ tablas: tablasBase() }) });
    assert.deepEqual((await cuerpo(await pedir(conPago))).pago, PAGO);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('el código de la función (sin comentarios) no trae ninguna llave ni QR escritos a mano, y `pago` solo se arma en la respuesta de la cuenta abierta', () => {
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const index = sinComentarios(fs.readFileSync(path.join(RAIZ, FUNCION), 'utf8'));
  const compartido = sinComentarios(fs.readFileSync(path.join(RAIZ, 'supabase/functions/_compartido/mesa.js'), 'utf8'));
  for (const [nombre, src] of [['index.ts', index], ['mesa.js', compartido]]) {
    assert.ok(!/000201\d{2}/.test(src.replace(/"000201"/g, '')), `${nombre}: ningún contenido de QR escrito a mano`);
    assert.ok(!/["'`]@[A-Za-z0-9._-]{3,}["'`]/.test(src), `${nombre}: ninguna llave escrita a mano`);
  }
  // `pago` aparece en UNA sola respuesta: la de «abierta». Las de «cerrada» y «sin_orden» no la llevan.
  const respuestas = [...index.matchAll(/return json\(\{([\s\S]*?)\}, 200, origen\);/g)].map((m) => m[1]);
  assert.equal(respuestas.length, 3, 'tres respuestas 200: cerrada, sin_orden y abierta');
  assert.deepEqual(respuestas.map((r) => /\bpago\b(?!_confirmado)/.test(r)), [false, false, true]);
  assert.match(respuestas[0], /estado: "cerrada"/);
  assert.match(respuestas[1], /estado: "sin_orden"/);
  assert.match(respuestas[2], /estado: "abierta"/);
});
