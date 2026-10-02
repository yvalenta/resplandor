// El agente como lo corre Yonatan: `node agente.mjs …` como proceso aparte, contra el Supabase de mentira, con
// --simular (no hay térmica). Caja negra: se mira qué sale por la consola, por el archivo de registro, por la
// carpeta salida/ y por la base — y el código de salida que lee iniciar.cmd (0 bien, 1 falló, 2 config).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { crearImpresoraSimulada } from './_impresora-simulada.mjs';
import { construirTicket } from '../../impresora/ticket/escpos.mjs';
import { documentoDePrueba } from '../../impresora/ticket/prueba.mjs';
import { VERSION } from '../../impresora/version.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTE = path.join(RAIZ, 'impresora', 'agente.mjs');
const DOC = { titulo: 'RESPLANDOR', lineas: [{ texto: 'Mesa 4' }, { texto: '2x Café', der: '$ 8.000' }], cortar: true };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-cli-'));
const esperarHasta = async (cond, ms = 5000, que = 'la condición') => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await cond()) return; await new Promise((r) => setTimeout(r, 15)); }
  assert.fail(`pasaron ${ms} ms y no se cumplió: ${que}`);
};

function lanzar(args, { env = {} } = {}) {
  const hijo = spawn(process.execPath, [AGENTE, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const r = { hijo, salida: '', errores: '', todo: () => r.salida + r.errores, codigo: null };
  hijo.stdout.on('data', (d) => { r.salida += d; });
  hijo.stderr.on('data', (d) => { r.errores += d; });
  r.fin = new Promise((resolve) => hijo.on('close', (c) => { r.codigo = c; resolve(r); }));
  return r;
}
const correr = (args, opciones) => lanzar(args, opciones).fin;

function configEn(dir, S, extra = {}) {
  const ruta = path.join(dir, 'config.json');
  fs.writeFileSync(ruta, JSON.stringify({
    supabaseUrl: S.url, publishableKey: S.clave, token: S.token, impresora: 'POS-80', simular: true,
    sondeoSegundos: 2, latidoSegundos: 10, ...extra,
  }));
  return ruta;
}
const archivos = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : []);

test('--version y --ayuda: salen con 0, sin config.json y sin red', async () => {
  const v = await correr(['--version']);
  assert.equal(v.codigo, 0);
  assert.match(v.salida, new RegExp(`^resplandor-impresora ${VERSION.replace(/\./g, '\\.')} \\(Node 22\\.\\d+\\.\\d+\\)`));
  const a = await correr(['--ayuda']);
  assert.equal(a.codigo, 0);
  for (const op of ['--impresoras', '--prueba', '--vista-previa', '--simular', '--una-vez', '--config', 'README-impresora.md']) assert.ok(a.salida.includes(op), op);
});

test('opciones desconocidas o sin valor: código 2 con la ayuda', async () => {
  const mal = await correr(['--imprime']);
  assert.equal(mal.codigo, 2);
  assert.match(mal.errores, /No entiendo «--imprime»/);
  const sinValor = await correr(['--config']);
  assert.equal(sinValor.codigo, 2);
  assert.match(sinValor.errores, /Falta el valor después de --config/);
});

test('config.json que falta o no sirve: código 2 (iniciar.cmd NO reintenta), problemas en español y sin repetir secretos', async () => {
  const d = tmp();
  const sin = await correr(['--config', path.join(d, 'config.json')]);
  assert.equal(sin.codigo, 2);
  assert.match(sin.errores, /No encuentro .*config\.json\. Copia config\.ejemplo\.json como config\.json/);

  const secreto = 'sb_secret_ESTO_NUNCA_DEBE_SALIR_EN_PANTALLA_12345';
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ supabaseUrl: 'http://abc.supabase.co', publishableKey: secreto, token: 'corto', colunmas: 42 }));
  const mal = await correr(['--config', path.join(d, 'config.json')]);
  assert.equal(mal.codigo, 2);
  assert.match(mal.errores, /No puedo arrancar: hay que arreglar config\.json/);
  assert.match(mal.errores, /«supabaseUrl» debe empezar con https/);
  assert.match(mal.errores, /clave SECRETA/);
  assert.match(mal.errores, /«token» debe ser una sola palabra/);
  assert.match(mal.errores, /¿quisiste decir «columnas»\?/);
  assert.match(mal.errores, /falta «impresora»/);
  assert.ok(!mal.todo().includes(secreto), 'la clave pegada por error no se imprime');
});

test('--una-vez --simular: toma el trabajo de la cola, deja el .bin y su vista de texto, confirma y NO escribe el token en el registro', async (t) => {
  const S = await crearImpresoraSimulada();
  t.after(() => S.cerrar());
  const d = tmp();
  const j = S.encolar(DOC);
  const r = await correr(['--una-vez', '--config', configEn(d, S, { columnas: 42 })]);
  assert.equal(r.codigo, 0, r.todo());
  assert.equal(S.estadoDe(j.id), 'impresa');
  assert.match(r.salida, /MODO SIMULADO/);
  assert.match(r.salida, /Listo: 1 impreso\(s\), 0 con error/);
  const bins = archivos(path.join(d, 'salida'), '.bin');
  assert.equal(bins.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(d, 'salida', bins[0])), construirTicket(DOC, { columnas: 42 }), 'los bytes salen del documento con la config');
  assert.match(fs.readFileSync(path.join(d, 'salida', bins[0].replace('.bin', '.txt')), 'utf8'), /^2x Café {28}\$ 8\.000$/m);
  const log = fs.readFileSync(path.join(d, 'impresiones.log'), 'utf8');
  assert.match(log, /Impreso #[0-9a-f]{8} \(cuenta, mesa 4\)/);
  for (const secreto of [S.token, S.clave]) assert.ok(!log.includes(secreto) && !r.todo().includes(secreto), 'ni el token ni la clave salen en el registro ni en la consola');
  assert.ok(JSON.parse(fs.readFileSync(path.join(d, 'impresas.json'), 'utf8')).some(([id]) => id === j.id), 'impresas.json recuerda el trabajo');
  assert.deepEqual(S.latidos, [VERSION], 'avisó su versión a la base');
});

test('--una-vez con un documento malo: lo confirma como error y sale con código 1', async (t) => {
  const S = await crearImpresoraSimulada();
  t.after(() => S.cerrar());
  const d = tmp();
  S.encolar({ lineas: 'no es una lista' });
  const r = await correr(['--una-vez', '--config', configEn(d, S)]);
  assert.equal(r.codigo, 1);
  assert.match(r.errores, /no se imprimió: "lineas" del documento debe ser una lista/);
  assert.match(S.trabajos[0].error, /debe ser una lista/);
});

test('sin --simular y fuera de Windows el agente no finge: dice que solo imprime de verdad en el PC de la caja', async (t) => {
  if (process.platform === 'win32') return t.skip('solo fuera de Windows');
  const S = await crearImpresoraSimulada();
  t.after(() => S.cerrar());
  const d = tmp();
  const r = await correr(['--una-vez', '--config', configEn(d, S, { simular: false })]);
  assert.equal(r.codigo, 1);
  assert.match(r.errores, /Este sistema no es Windows.*--simular/);
  assert.equal(S.llamadas.length, 0, 'ni siquiera toca la cola');
});

test('--prueba --simular: la página de prueba al .bin y al .txt, con tildes, regla y QR, sin necesitar base ni token', async () => {
  const d = tmp();
  const ruta = path.join(d, 'config.json');
  fs.writeFileSync(ruta, JSON.stringify({ columnas: 32, simular: true }));
  const r = await correr(['--prueba', '--config', ruta]);
  assert.equal(r.codigo, 0, r.todo());
  assert.match(r.salida, /Página de prueba simulada/);
  const bin = archivos(path.join(d, 'salida'), '.bin')[0];
  const esperado = construirTicket(documentoDePrueba({ columnas: 32, nombreImpresora: '' , ahora: new Date() }), { columnas: 32 });
  const real = fs.readFileSync(path.join(d, 'salida', bin));
  assert.ok(Math.abs(real.length - esperado.length) < 8, 'la misma página (salvo la hora)');
  const txt = fs.readFileSync(path.join(d, 'salida', bin.replace('.bin', '.txt')), 'utf8');
  assert.match(txt, /12345678901234567890123456789012/);
  assert.match(txt, /Tildes: áéíóú ÁÉÍÓÚ üÜ ñÑ/);
  assert.match(txt, /\[ QR: https:\/\/resplandor\.ynt\.codes\/ \]/);
});

test('imprimir-windows.mjs --prueba --simular: el atajo da la misma página que agente.mjs; sin opciones se niega con 2 (no arranca el agente)', async () => {
  const d = tmp();
  const ruta = path.join(d, 'config.json');
  fs.writeFileSync(ruta, JSON.stringify({ columnas: 42, simular: true }));
  const atajo = path.join(RAIZ, 'impresora', 'imprimir-windows.mjs');
  const corrida = (args) => new Promise((resolve) => {
    const h = spawn(process.execPath, [atajo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    h.stdout.on('data', (x) => { o += x; });
    h.stderr.on('data', (x) => { o += x; });
    h.on('close', (codigo) => resolve({ codigo, o }));
  });
  const r = await corrida(['--prueba', '--config', ruta]);
  assert.equal(r.codigo, 0, r.o);
  assert.match(r.o, /Página de prueba simulada/);
  assert.equal(archivos(path.join(d, 'salida'), '.bin').length, 1);
  const sola = await corrida([]);
  assert.equal(sola.codigo, 2);
  assert.match(sola.o, /solo se usa como atajo/);
  const rara = await corrida(['--simular']);
  assert.equal(rara.codigo, 2, 'otra opción cualquiera tampoco arranca el agente');
});

test('--prueba sin --simular y sin impresora en config: exige el nombre (y dice cómo sacarlo)', async () => {
  const d = tmp();
  const ruta = path.join(d, 'config.json');
  fs.writeFileSync(ruta, '{}');
  const r = await correr(['--prueba', '--config', ruta]);
  assert.equal(r.codigo, 2);
  assert.match(r.errores, /falta «impresora» \(nombre de la impresora en Windows\)/);
});

test('--vista-previa: muestra cómo saldría un documento sin imprimir ni necesitar config', async () => {
  const d = tmp();
  const f = path.join(d, 'cuenta.json');
  fs.writeFileSync(f, JSON.stringify({ titulo: 'MESA 4', lineas: [{ texto: '3x Limonada', der: '$ 21.000' }, '  sin hielo', '----', { texto: 'TOTAL', der: '$ 21.000', negrita: true }], qr: 'https://x.co/t/1' }));
  const r = await correr(['--vista-previa', f, '--config', path.join(d, 'no-existe.json')]);
  assert.equal(r.codigo, 0, r.todo());
  assert.match(r.salida, /^3x Limonada {29}\$ 21\.000$/m);
  assert.match(r.salida, /^ +MESA 4$/m);
  assert.match(r.salida, /\[ QR: https:\/\/x\.co\/t\/1 \]/);
  assert.match(r.salida, /no se imprimió nada/);
  const malo = path.join(d, 'malo.json');
  fs.writeFileSync(malo, '{"lineas":"x"}');
  const rm = await correr(['--vista-previa', malo, '--config', path.join(d, 'no-existe.json')]);
  assert.equal(rm.codigo, 1);
  assert.match(rm.errores, /debe ser una lista/);
  assert.equal((await correr(['--vista-previa', path.join(d, 'nada.json')])).codigo, 1);
});

test('--impresoras fuera de Windows: lo dice y sale con 1', async (t) => {
  if (process.platform === 'win32') return t.skip('solo fuera de Windows');
  const r = await correr(['--impresoras']);
  assert.equal(r.codigo, 1);
  assert.match(r.errores, /lista las impresoras de Windows; este sistema no es Windows/);
});

test('el agente en marcha: se une a Realtime, imprime al llegar la señal, avisa su latido, y Ctrl+C lo cierra con 0', async (t) => {
  const S = await crearImpresoraSimulada();
  t.after(() => S.cerrar());
  const d = tmp();
  const r = lanzar(['--config', configEn(d, S, { sondeoSegundos: 60, latidoSegundos: 10 })]);
  t.after(() => { try { r.hijo.kill('SIGKILL'); } catch { /* ya salió */ } });
  await esperarHasta(() => S.unidos() === 1, 8000, 'que el agente se una al canal de Realtime');
  await esperarHasta(() => /Señal en tiempo real conectada/.test(r.salida), 5000, 'el aviso «Señal en tiempo real conectada» (llega por la tubería un instante después)');
  assert.match(r.salida, /Esperando trabajos de impresión/);
  assert.equal(S.uniones[0].topic, `realtime:${S.topico}`);

  const j = S.encolar(DOC);
  S.señal();
  await esperarHasta(() => S.estadoDe(j.id) === 'impresa', 4000, 'imprimir al llegar la señal (el sondeo es de 60 s)');
  assert.equal(archivos(path.join(d, 'salida'), '.bin').length, 1);
  assert.ok(S.latidos.includes(VERSION));

  r.hijo.kill('SIGINT');
  await r.fin;
  assert.equal(r.codigo, 0, r.todo());
  assert.match(r.salida, /Cerrando el agente \(SIGINT\)/);
  assert.match(r.salida, /Agente detenido/);
  assert.match(fs.readFileSync(path.join(d, 'impresiones.log'), 'utf8'), /Agente detenido/);
});

test('el agente en marcha sin señal (Realtime no responde): el sondeo lo despierta, y un trabajo malo no lo tumba', async (t) => {
  const S = await crearImpresoraSimulada();
  t.after(() => S.cerrar());
  S.rechazarUnion = true;                                    // el canal nunca se une: solo queda el sondeo
  const d = tmp();
  const malo = S.encolar({ lineas: 7 });
  const bueno = S.encolar(DOC);
  const r = lanzar(['--config', configEn(d, S, { sondeoSegundos: 2 })]);
  t.after(() => { try { r.hijo.kill('SIGKILL'); } catch { /* ya salió */ } });
  await esperarHasta(() => S.estadoDe(bueno.id) === 'impresa', 8000, 'imprimir el bueno en el primer ciclo');
  assert.notEqual(S.estadoDe(malo.id), 'impresa');
  assert.match(S.trabajos.find((x) => x.id === malo.id).error, /"lineas" del documento debe ser una lista/);
  const tardio = S.encolar(DOC);                              // llega sin señal: lo recoge el sondeo de 2 s
  await esperarHasta(() => S.estadoDe(tardio.id) === 'impresa', 8000, 'imprimir por sondeo');
  assert.equal(r.codigo, null, 'el agente sigue vivo');
  r.hijo.kill('SIGTERM');
  await r.fin;
  assert.equal(r.codigo, 0);
});
