// config.json del agente (impresora/config.mjs): validación al arrancar, en español, todos los problemas
// juntos, y las dos reglas que no se negocian: la clave de la base es la PUBLICABLE (jamás la secreta) y el
// token no se commitea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validarConfig, cargarConfig, ErrorConfig, CARPETA_AGENTE } from '../../impresora/config.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUENA = {
  supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
  publishableKey: 'sb_publishable_abcdefghijklmnopqrstuvwx',
  token: 'k7Qm2xVd9LpR4sTw8YbN3cHf6JgZ1aEu',
  impresora: 'POS-80',
};
const problemas = (c, op) => { try { validarConfig(c, op); } catch (e) { assert.ok(e instanceof ErrorConfig); return e.problemas; } return []; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-config-'));
const jwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'firma_de_prueba'].join('.');

test('una config buena se acepta y trae los valores de fábrica (48 columnas, PC850, corte parcial, sondeo 5 s, latido 30 s)', () => {
  const { config, avisos } = validarConfig(BUENA);
  assert.deepEqual(avisos, []);
  assert.equal(config.supabaseUrl, 'https://abcdefghijklmnop.supabase.co');
  assert.equal(config.impresora, 'POS-80');
  assert.deepEqual(config.opcionesTicket, { columnas: 48, tablaEscPos: 2, cortar: 'parcial', qrNativo: true, qrTamano: 6, avance: 3, cancelarKanji: false });
  assert.equal(config.sondeoSegundos, 5);
  assert.equal(config.latidoSegundos, 30);
  assert.equal(config.caducaMinutos, 120);
  assert.equal(config.simular, false);
  assert.equal(config.carpetaSalida, path.join(CARPETA_AGENTE, 'salida'));
});

test('lo que se cambia en la config llega al formateador (58 mm, otra tabla, sin corte, sin QR nativo)', () => {
  const { config } = validarConfig({ ...BUENA, columnas: 32, tablaEscPos: 19, cortar: false, qrNativo: false, qrTamano: 4, avance: 0, cancelarKanji: true, sondeoSegundos: 10, latidoSegundos: 60 });
  assert.deepEqual(config.opcionesTicket, { columnas: 32, tablaEscPos: 19, cortar: 'no', qrNativo: false, qrTamano: 4, avance: 0, cancelarKanji: true });
  assert.equal(config.sondeoSegundos, 10);
});

test('config.ejemplo.json NO es válido tal cual: obliga a pegar los cuatro valores de verdad', () => {
  const ejemplo = JSON.parse(fs.readFileSync(path.join(CARPETA_AGENTE, 'config.ejemplo.json'), 'utf8'));
  const p = problemas(ejemplo);
  for (const k of ['supabaseUrl', 'publishableKey', 'token', 'impresora']) {
    assert.ok(p.some((x) => x.includes(`«${k}»`) && /texto de ejemplo/.test(x)), `${k} debe quedar marcado como pendiente`);
  }
  assert.equal(p.length, 4, 'y solo esos cuatro: los comentarios (_ayuda, _papel) y los valores de papel se aceptan');
  // Con los cuatro valores puestos, el resto del ejemplo es válido.
  assert.doesNotThrow(() => validarConfig({ ...ejemplo, ...BUENA }));
});

test('todos los problemas juntos, en español, y qué hacer', () => {
  const p = problemas({});
  assert.equal(p.length, 4);
  assert.match(p.join('\n'), /falta «supabaseUrl» \(dirección del proyecto de Supabase\)/);
  assert.match(p.join('\n'), /falta «publishableKey» \(clave publicable\)/);
  assert.match(p.join('\n'), /falta «token» \(token de la impresora\)/);
  assert.match(p.join('\n'), /falta «impresora» \(nombre de la impresora en Windows\)/);
  assert.deepEqual(problemas({}, { modo: 'prueba' }).length, 1, '--prueba solo necesita la impresora');
  assert.deepEqual(problemas({}, { modo: 'prueba', simular: true }), [], '…y con --simular, ni eso');
});

test('la clave SECRETA nunca se acepta (sb_secret_… ni un JWT con role service_role)', () => {
  for (const secreta of ['sb_secret_abcdefghijklmnopqrstuvwxyz', jwt({ role: 'service_role', iss: 'supabase' })]) {
    const p = problemas({ ...BUENA, publishableKey: secreta });
    assert.equal(p.length, 1);
    assert.match(p[0], /clave SECRETA.*NUNCA va en el PC de la caja/);
    assert.ok(!p[0].includes(secreta), 'el mensaje no repite la clave');
  }
  assert.deepEqual(problemas({ ...BUENA, publishableKey: jwt({ role: 'anon' }) }), [], 'la anon de las claves viejas sí');
  assert.match(problemas({ ...BUENA, publishableKey: 'corta' })[0], /no parece una clave de Supabase/);
});

test('la dirección de Supabase: https obligatorio (http solo en localhost), sin usuario, y la ruta se recorta con aviso', () => {
  assert.match(problemas({ ...BUENA, supabaseUrl: 'http://abc.supabase.co' })[0], /debe empezar con https/);
  assert.match(problemas({ ...BUENA, supabaseUrl: 'ftp://abc.supabase.co' })[0], /debe empezar con https/);
  assert.match(problemas({ ...BUENA, supabaseUrl: 'no es una url' })[0], /no es una dirección válida/);
  assert.match(problemas({ ...BUENA, supabaseUrl: 'https://u:p@abc.supabase.co' })[0], /no debe llevar usuario ni clave/);
  assert.deepEqual(problemas({ ...BUENA, supabaseUrl: 'http://127.0.0.1:54321' }), []);
  assert.deepEqual(problemas({ ...BUENA, supabaseUrl: 'http://localhost:54321' }), []);
  const { config, avisos } = validarConfig({ ...BUENA, supabaseUrl: 'https://abc.supabase.co/rest/v1/' });
  assert.equal(config.supabaseUrl, 'https://abc.supabase.co');
  assert.match(avisos[0], /lleva ruta.*se usa solo https:\/\/abc\.supabase\.co/);
});

test('el token: una palabra de 16 a 256 caracteres visibles; el mensaje no lo repite', () => {
  for (const malo of ['corto', 'con espacios en el medio xxxxxxxxxxxx', 'salto\nde-linea-xxxxxxxxxxxx', 'ñandú-ñandú-ñandú-ñandú', 'x'.repeat(300)]) {
    const p = problemas({ ...BUENA, token: malo });
    assert.equal(p.length, 1, malo);
    assert.match(p[0], /«token» debe ser una sola palabra de al menos 16 caracteres/);
    assert.ok(!p[0].includes(malo));
  }
  assert.match(problemas({ ...BUENA, token: 12345 })[0], /«token» debe ser un texto entre comillas/);
});

test('claves desconocidas son un error con sugerencia («colunmas» no se queda en 48 sin que nadie lo vea); _comentarios se ignoran', () => {
  const p = problemas({ ...BUENA, colunmas: 42, tabla: 2, _nota: 'hola' });
  assert.equal(p.length, 2);
  assert.match(p[0], /no conozco la clave «colunmas» \(¿quisiste decir «columnas»\?\)/);
  assert.match(p[1], /no conozco la clave «tabla»/);
  assert.deepEqual(problemas({ ...BUENA, _comentario: 'ok', _otro: { a: 1 } }), []);
});

test('números, opciones y nombre de impresora: cada problema dice cuál y cuánto', () => {
  assert.match(problemas({ ...BUENA, columnas: '48' })[0], /«columnas» debe ser un número entero entre 16 y 80 \(sin comillas\); lo normal es 48, 42 o 32/);
  assert.match(problemas({ ...BUENA, columnas: 200 })[0], /«columnas»/);
  assert.match(problemas({ ...BUENA, tablaEscPos: 99 })[0], /tablaEscPos 99 no está soportada; usa 0 \(PC437\), 2 \(PC850\)/);
  assert.match(problemas({ ...BUENA, cortar: 'mitad' })[0], /cortar debe ser true, false, "parcial" o "total"/);
  assert.match(problemas({ ...BUENA, qrTamano: 99 })[0], /«qrTamano»/);
  assert.match(problemas({ ...BUENA, sondeoSegundos: 1 })[0], /«sondeoSegundos» debe ser un número entero entre 2 y 60/);
  assert.match(problemas({ ...BUENA, latidoSegundos: 5 })[0], /«latidoSegundos»/);
  assert.match(problemas({ ...BUENA, caducaMinutos: -1 })[0], /«caducaMinutos» debe ser un número entero entre 0 y 1440/);
  assert.equal(validarConfig({ ...BUENA, caducaMinutos: 0 }).config.caducaMinutos, 0);
  assert.match(problemas({ ...BUENA, simular: 'si' })[0], /«simular» debe ser true o false/);
  assert.match(problemas({ ...BUENA, impresora: '-Archivo' })[0], /«impresora» no puede empezar con un guion/);
  assert.match(problemas({ ...BUENA, impresora: 'POS "80"' })[0], /«impresora» lleva comillas dobles/);
  assert.match(problemas({ ...BUENA, impresora: 'a\u0007b' })[0], /«impresora» lleva caracteres de control/);
  assert.match(problemas({ ...BUENA, carpetaSalida: '  ' })[0], /«carpetaSalida» debe ser un texto con una carpeta/);
  assert.match(problemas('texto')[0], /debe ser un objeto/);
  assert.match(problemas([])[0], /debe ser un objeto/);
  assert.match(problemas(null)[0], /debe ser un objeto/);
});

test('--simular quita la obligación de la impresora y marca el modo; la carpeta de salida es relativa a config.json', () => {
  const { config } = validarConfig({ ...BUENA, impresora: undefined }, { simular: true, carpeta: '/x/y' });
  assert.equal(config.simular, true);
  assert.equal(config.impresora, '');
  assert.equal(config.carpetaSalida, path.resolve('/x/y', 'salida'));
  assert.equal(validarConfig({ ...BUENA, simular: true, carpetaSalida: 'otra' }, { carpeta: '/x' }).config.carpetaSalida, path.resolve('/x', 'otra'));
});

test('cargarConfig: archivo que falta, JSON roto (con pistas), con BOM, y relativo al archivo', () => {
  const d = tmp();
  const ruta = path.join(d, 'config.json');
  assert.throws(() => cargarConfig({ ruta }), (e) => e instanceof ErrorConfig && /No encuentro .*config\.json\. Copia config\.ejemplo\.json como config\.json/.test(e.message));
  fs.writeFileSync(ruta, '{ "token": “curvas”, }');
  assert.throws(() => cargarConfig({ ruta }), (e) => /no es un JSON válido/.test(e.message) && /comillas sean las rectas/.test(e.message) && /coma al final/.test(e.message));
  fs.writeFileSync(ruta, '﻿' + JSON.stringify(BUENA));
  assert.equal(cargarConfig({ ruta }).config.impresora, 'POS-80');
  fs.writeFileSync(ruta, JSON.stringify({ ...BUENA, simular: true, carpetaSalida: 'sal' }));
  assert.equal(cargarConfig({ ruta }).config.carpetaSalida, path.join(d, 'sal'), 'la carpeta es relativa a donde está config.json');
});

test('el token no se commitea: impresora/.gitignore lo excluye y git lo confirma', () => {
  const ign = fs.readFileSync(path.join(CARPETA_AGENTE, '.gitignore'), 'utf8').split(/\r?\n/);
  for (const f of ['config.json', 'impresiones.log', 'impresas.json', 'salida/']) assert.ok(ign.includes(f), `${f} en impresora/.gitignore`);
  const git = spawnSync('git', ['check-ignore', '-q', 'impresora/config.json', 'impresora/impresiones.log', 'impresora/salida/x.bin'], { cwd: RAIZ });
  if (git.error || git.status === 128) return;               // sin git (o fuera de un repo): lo de arriba basta
  assert.equal(git.status, 0, 'git debe ignorar impresora/config.json');
  const ejemplo = spawnSync('git', ['check-ignore', '-q', 'impresora/config.ejemplo.json'], { cwd: RAIZ });
  assert.equal(ejemplo.status, 1, 'el ejemplo SÍ se versiona');
});

test('config.ejemplo.json: sin ningún secreto ni correo real (el repo es público), y es JSON válido', () => {
  const crudo = fs.readFileSync(path.join(CARPETA_AGENTE, 'config.ejemplo.json'), 'utf8');
  assert.doesNotMatch(crudo, /sb_(publishable|secret)_[A-Za-z0-9]{10}|eyJ[A-Za-z0-9_-]{20}|lccgehvyymladqvumcez|@(gmail|hotmail|outlook)\./i);
  assert.doesNotThrow(() => JSON.parse(crudo));
});
