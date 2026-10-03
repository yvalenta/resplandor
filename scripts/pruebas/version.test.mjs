// Prueba de scripts/version.mjs: la versión del sitio (version.json y los sellos de las cuatro páginas).
//
// Dos partes:
//   1. El repo de verdad está al día (lo mismo que corre el workflow con `--comprobar`): version.json con su forma, la huella
//      es la del sitio y las cuatro páginas llevan el sello — un <meta> y el texto del pie — con esa versión.
//   2. Unidades sobre sitios de juguete en un directorio temporal (nunca sobre las páginas reales): la normalización, la huella
//      estable, que cambiar un byte de un asset o de una página cambia la versión (y cambiar solo un sello, no), que sin cambios
//      no se toca nada ni se mueve la fecha, que --comprobar detecta un sello viejo, y que nada depende de la zona de la máquina.
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATO_VERSION, MARCA, PAGINAS, calcularHuella, fechaBogota, leerSellos, normalizar, problemas, sellar, versionDe } from '../version.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(RAIZ, 'scripts/version.mjs');

function correr(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

const pagina = (nombre, version = '0000.00.00-0000000', extra = '') =>
  `<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<meta name="resplandor-version" content="${version}">\n<title>${nombre}</title>\n</head>\n` +
  `<body>\n<main>${nombre}${extra}</main>\n<footer>\n<span class="pie-version">versión <span data-version>${version}</span></span>\n</footer>\n</body></html>\n`;

/** Un sitio de juguete: las cuatro páginas con sello, tres assets y un archivo que NO entra a la huella. */
function sitio(t) {
  const dir = mkdtempSync(join(tmpdir(), 'resplandor-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const p of PAGINAS) writeFileSync(join(dir, p), pagina(p));
  mkdirSync(join(dir, 'assets/css'), { recursive: true });
  mkdirSync(join(dir, 'assets/js'), { recursive: true });
  mkdirSync(join(dir, 'assets/img'), { recursive: true });
  writeFileSync(join(dir, 'assets/css/a.css'), 'body{color:red}\n');
  writeFileSync(join(dir, 'assets/js/b.js'), 'console.log(1)\n');
  writeFileSync(join(dir, 'assets/img/c.bin'), Buffer.from([0, 1, 2, 3, 255]));
  writeFileSync(join(dir, 'README.md'), 'no entra a la huella\n');
  return dir;
}

const leerJson = (dir) => JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8'));
const AHORA = '2026-10-02T15:00:00Z';
const generar = (dir, ahora = AHORA) => {
  const r = correr(['--raiz', dir, '--ahora', ahora]);
  assert.equal(r.status, 0, r.stderr);
  return r;
};

// ───────────────────────── 1. el repo de verdad ─────────────────────────

test('el repo está al día: `node scripts/version.mjs --comprobar` sale con 0', () => {
  const r = correr(['--comprobar']);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}\n(corre node scripts/version.mjs AL FINAL, después de css, iconos y descubrimiento)`);
  assert.match(r.stdout, /al día/);
});

test('version.json tiene la forma { version, fecha, huella }, la versión sale de la fecha y la huella, y la huella es la del sitio', () => {
  const v = JSON.parse(readFileSync(join(RAIZ, 'version.json'), 'utf8'));
  assert.deepEqual(Object.keys(v).sort(), ['fecha', 'huella', 'version']);
  assert.match(v.version, FORMATO_VERSION, 'AAAA.MM.DD-xxxxxxx');
  assert.match(v.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(v.huella, /^[0-9a-f]{64}$/);
  assert.equal(v.version, `${v.fecha.replaceAll('-', '.')}-${v.huella.slice(0, 7)}`);
  assert.equal(v.huella, calcularHuella(RAIZ), 'la huella de version.json es la del sitio tal como está');
  assert.equal(readFileSync(join(RAIZ, 'version.json'), 'utf8'), `${JSON.stringify(v, null, 2)}\n`, 'se escribe con 2 espacios y un salto final, como lo escribe el script');
});

test('las cuatro páginas llevan UN <meta name="resplandor-version"> y el texto de la versión en el pie, con la versión de version.json', () => {
  const v = JSON.parse(readFileSync(join(RAIZ, 'version.json'), 'utf8')).version;
  for (const p of PAGINAS) {
    const html = readFileSync(join(RAIZ, p), 'utf8');
    const { metas, textos } = leerSellos(html);
    assert.deepEqual(metas, [v], `${p}: un <meta name="resplandor-version" content="${v}">`);
    assert.ok(textos.length >= 1, `${p}: el sello visible del pie`);
    assert.ok(textos.every((x) => x === v), `${p}: todos los sellos de texto dicen ${v} (dicen ${textos.join(', ')})`);
    assert.ok(html.indexOf('<meta name="resplandor-version"') < html.indexOf('</head>'), `${p}: el <meta> está en el <head>`);
  }
});

test('el pie de cada página lleva la firma de la casa, con la convención de lusof, y la versión al lado', () => {
  for (const p of PAGINAS) {
    const html = readFileSync(join(RAIZ, p), 'utf8');
    assert.ok(html.includes('<a class="firma" href="https://ynt.codes" target="_blank" rel="noopener"><span>Ynt-labs</span></a>'), `${p}: «Ynt-labs» con el enlace a ynt.codes`);
    assert.match(html, /versión <span data-version>\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7}<\/span>/, `${p}: «versión …» al lado, visible sin JavaScript`);
  }
});

// ───────────────────────── 2. unidades ─────────────────────────

test('normalizar: reemplaza los sellos por una marca y no toca nada más; es idempotente', () => {
  const html = pagina('x', '2026.10.02-abcdef0', '<p>2026.10.02-abcdef0 fuera de los sellos</p>');
  const n = normalizar(html);
  assert.ok(n.includes(`<meta name="resplandor-version" content="${MARCA}">`));
  assert.ok(n.includes(`<span data-version>${MARCA}</span>`));
  assert.ok(n.includes('<p>2026.10.02-abcdef0 fuera de los sellos</p>'), 'un número igual FUERA de los sellos no se toca');
  assert.equal(normalizar(n), n);
  assert.equal(normalizar(pagina('x', '1999.01.01-1111111', '<p>2026.10.02-abcdef0 fuera de los sellos</p>')), n, 'dos páginas que solo difieren en el sello normalizan igual');
});

test('sellar y leerSellos: ponen y leen la misma versión; un data-version con otros atributos y espacios también cuenta', () => {
  const html = '<head><meta name="resplandor-version" content="a"></head><p>v <span class="x" data-version> viejo </span></p><b data-version-otra>no</b>';
  assert.deepEqual(leerSellos(html), { metas: ['a'], textos: ['viejo'] });
  const nuevo = sellar(html, '2026.10.02-abcdef0');
  assert.deepEqual(leerSellos(nuevo), { metas: ['2026.10.02-abcdef0'], textos: ['2026.10.02-abcdef0'] });
  assert.ok(nuevo.includes('<span class="x" data-version> 2026.10.02-abcdef0 </span>'), 'conserva los espacios de alrededor');
  assert.ok(nuevo.includes('<b data-version-otra>no</b>'), 'un atributo que solo empieza con data-version no es un sello');
});

test('fechaBogota: es la fecha de America/Bogota, sin importar la zona de la máquina', () => {
  assert.equal(fechaBogota(new Date('2026-10-03T03:30:00Z')), '2026-10-02', '22:30 del 2 en Bogotá');
  assert.equal(fechaBogota(new Date('2026-10-02T04:59:59Z')), '2026-10-01', '23:59:59 del 1 en Bogotá');
  assert.equal(fechaBogota(new Date('2026-10-02T05:00:00Z')), '2026-10-02', 'medianoche en Bogotá');
});

test('la huella es estable: misma entrada, misma huella; no depende del orden de creación ni de la fecha de los archivos', (t) => {
  const a = sitio(t);
  const h = calcularHuella(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(calcularHuella(a), h);
  // Otro sitio con los mismos archivos creados en otro orden y con otras fechas de modificación.
  const b = mkdtempSync(join(tmpdir(), 'resplandor-version-'));
  t.after(() => rmSync(b, { recursive: true, force: true }));
  for (const rel of ['assets/img/c.bin', 'assets/js/b.js', 'assets/css/a.css']) {
    mkdirSync(dirname(join(b, rel)), { recursive: true });
    writeFileSync(join(b, rel), readFileSync(join(a, rel)));
    utimesSync(join(b, rel), new Date('2001-01-01'), new Date('2001-01-01'));
  }
  for (const p of [...PAGINAS].reverse()) writeFileSync(join(b, p), readFileSync(join(a, p)));
  assert.equal(calcularHuella(b), h);
});

test('nada depende de la zona de la máquina: con TZ distintas sale la misma fecha (la de Bogotá) y la misma huella', (t) => {
  // 03:30 UTC del 3 de octubre = 22:30 del 2 en Bogotá. Con TZ=Asia/Tokyo o Pacific/Kiritimati la máquina ya está en el 3 o el 4.
  const resultados = ['UTC', 'America/Bogota', 'Asia/Tokyo', 'Pacific/Kiritimati', 'America/Los_Angeles'].map((TZ) => {
    const dir = sitio(t);
    const r = correr(['--raiz', dir, '--ahora', '2026-10-03T03:30:00Z'], { TZ });
    assert.equal(r.status, 0, r.stderr);
    return { TZ, ...leerJson(dir) };
  });
  for (const x of resultados) {
    assert.equal(x.fecha, '2026-10-02', `TZ=${x.TZ}: la fecha es la de Bogotá`);
    assert.equal(x.huella, resultados[0].huella, `TZ=${x.TZ}: la misma huella`);
    assert.equal(x.version, resultados[0].version, `TZ=${x.TZ}: la misma versión`);
  }
});

test('genera version.json y sella las cuatro páginas con AAAA.MM.DD-xxxxxxx', (t) => {
  const dir = sitio(t);
  const r = generar(dir);
  assert.match(r.stdout, /Versión nueva/);
  const v = leerJson(dir);
  assert.match(v.version, FORMATO_VERSION);
  assert.equal(v.fecha, '2026-10-02');
  assert.equal(v.version, versionDe(v.huella, v.fecha));
  assert.equal(v.huella, calcularHuella(dir), 'la huella se calcula con los sellos YA puestos y sale igual: no es circular');
  for (const p of PAGINAS) assert.deepEqual(leerSellos(readFileSync(join(dir, p), 'utf8')), { metas: [v.version], textos: [v.version] });
  assert.equal(correr(['--raiz', dir, '--comprobar']).status, 0);
});

test('sin cambios no toca nada: ni version.json ni las páginas, y la fecha no se mueve aunque pasen los días', (t) => {
  const dir = sitio(t);
  generar(dir, '2026-10-02T15:00:00Z');
  const antes = Object.fromEntries(['version.json', ...PAGINAS].map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
  const mtimes = Object.fromEntries(Object.keys(antes).map((f) => [f, statSync(join(dir, f)).mtimeMs]));
  const r = generar(dir, '2026-11-20T15:00:00Z');
  assert.match(r.stdout, /no cambió/);
  for (const f of Object.keys(antes)) {
    assert.equal(readFileSync(join(dir, f), 'utf8'), antes[f], `${f} igual`);
    assert.equal(statSync(join(dir, f)).mtimeMs, mtimes[f], `${f} ni se reescribió`);
  }
  assert.equal(leerJson(dir).fecha, '2026-10-02');
});

test('cambiar UN byte de un asset cambia la versión (y la fecha pasa a la del cambio)', (t) => {
  const dir = sitio(t);
  generar(dir, '2026-10-02T15:00:00Z');
  const antes = leerJson(dir);
  writeFileSync(join(dir, 'assets/js/b.js'), 'console.log(2)\n');
  generar(dir, '2026-10-05T15:00:00Z');
  const despues = leerJson(dir);
  assert.notEqual(despues.huella, antes.huella);
  assert.notEqual(despues.version, antes.version);
  assert.equal(despues.fecha, '2026-10-05');
  // Un asset binario, también.
  writeFileSync(join(dir, 'assets/img/c.bin'), Buffer.from([0, 1, 2, 3, 254]));
  generar(dir, '2026-10-06T15:00:00Z');
  assert.notEqual(leerJson(dir).huella, despues.huella);
});

test('cambiar UN byte de una página con sello cambia la versión, en las cuatro', (t) => {
  for (const p of PAGINAS) {
    const dir = sitio(t);
    generar(dir);
    const antes = leerJson(dir);
    writeFileSync(join(dir, p), readFileSync(join(dir, p), 'utf8').replace('</main>', '.</main>'));
    generar(dir, '2026-10-07T15:00:00Z');
    const despues = leerJson(dir);
    assert.notEqual(despues.huella, antes.huella, `${p}: cambió la huella`);
    for (const q of PAGINAS) assert.deepEqual(leerSellos(readFileSync(join(dir, q), 'utf8')), { metas: [despues.version], textos: [despues.version] }, `${q} quedó con la versión nueva`);
  }
});

test('agregar, quitar o renombrar un asset cambia la versión; lo que no es una página sellada ni un asset, no', (t) => {
  const dir = sitio(t);
  generar(dir);
  const base = leerJson(dir).huella;
  writeFileSync(join(dir, 'README.md'), 'otro texto\n');
  writeFileSync(join(dir, 'contact.html'), '<html>una página sin sello</html>');
  writeFileSync(join(dir, 'assets/.DS_Store'), 'basura de macOS');
  assert.equal(calcularHuella(dir), base, 'el README, una página sin sello y un .DS_Store no entran a la huella');
  writeFileSync(join(dir, 'assets/js/nuevo.js'), 'x');
  const conNuevo = calcularHuella(dir);
  assert.notEqual(conNuevo, base, 'un asset nuevo cambia la huella');
  rmSync(join(dir, 'assets/js/nuevo.js'));
  writeFileSync(join(dir, 'assets/js/otro-nombre.js'), 'x');
  assert.notEqual(calcularHuella(dir), conNuevo, 'la ruta cuenta: el mismo contenido con otro nombre es otra huella');
  rmSync(join(dir, 'assets/js/otro-nombre.js'));
  assert.equal(calcularHuella(dir), base, 'quitarlo devuelve la huella de antes');
});

test('cambiar solo un sello NO cambia la huella (la normalización evita la circularidad)', (t) => {
  const dir = sitio(t);
  generar(dir);
  const base = calcularHuella(dir);
  const ruta = join(dir, 'pos.html');
  writeFileSync(ruta, readFileSync(ruta, 'utf8').replaceAll(leerJson(dir).version, '1999.01.01-aaaaaaa'));
  assert.equal(calcularHuella(dir), base);
});

test('--comprobar detecta un sello viejo, nombra la página y dice qué correr', (t) => {
  const dir = sitio(t);
  generar(dir);
  const ruta = join(dir, 'carta.html');
  writeFileSync(ruta, readFileSync(ruta, 'utf8').replace(/(<span data-version>)[^<]*/, '$11999.01.01-aaaaaaa'));
  const r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /carta\.html/);
  assert.match(r.stderr, /1999\.01\.01-aaaaaaa/);
  assert.match(r.stderr, /node scripts\/version\.mjs/);
  assert.match(r.stderr, /después de css\.mjs, iconos\.mjs y descubrimiento\.mjs/);
  // Y el script, sin --comprobar, lo arregla sin mover la versión: la huella no cambió.
  const antes = readFileSync(join(dir, 'version.json'), 'utf8');
  const arreglo = generar(dir, '2026-12-01T15:00:00Z');
  assert.match(arreglo.stdout, /sellos atrasados en: carta\.html/);
  assert.equal(readFileSync(join(dir, 'version.json'), 'utf8'), antes, 'la versión no se mueve por arreglar un sello');
  assert.equal(correr(['--raiz', dir, '--comprobar']).status, 0);
});

test('--comprobar detecta un sello viejo en el <meta> y un <meta> que falta o sobra', (t) => {
  const dir = sitio(t);
  generar(dir);
  const ruta = join(dir, 'menu.html');
  const html = readFileSync(ruta, 'utf8');
  writeFileSync(ruta, html.replace(/(<meta name="resplandor-version" content=")[^"]*/, '$11999.01.01-aaaaaaa'));
  let r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /menu\.html.*1999\.01\.01-aaaaaaa/);
  writeFileSync(ruta, html.replace(/<meta name="resplandor-version"[^>]*>\n/, ''));
  r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /menu\.html: debe tener UN <meta name="resplandor-version"> y tiene 0/);
  writeFileSync(ruta, html.replace('<title>', '<meta name="resplandor-version" content="x">\n<title>'));
  r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /y tiene 2/);
});

test('--comprobar detecta que el sitio cambió desde que se calculó la versión (huella atrasada)', (t) => {
  const dir = sitio(t);
  generar(dir);
  writeFileSync(join(dir, 'assets/css/a.css'), 'body{color:blue}\n');
  const r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /huella/);
  assert.match(r.stderr, /node scripts\/version\.mjs/);
  assert.ok(problemas(dir).length >= 1);
});

test('--comprobar: sin version.json, o con uno que no se puede leer o con la versión mal escrita, falla con un motivo', (t) => {
  const dir = sitio(t);
  let r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /falta version\.json/);
  generar(dir);
  const v = leerJson(dir);
  writeFileSync(join(dir, 'version.json'), '{ no es json');
  r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no se puede leer/);
  writeFileSync(join(dir, 'version.json'), JSON.stringify({ ...v, version: 'hoy' }));
  r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AAAA\.MM\.DD-xxxxxxx/);
  writeFileSync(join(dir, 'version.json'), JSON.stringify({ ...v, version: versionDe(v.huella, '2020-01-01') }));
  r = correr(['--raiz', dir, '--comprobar']);
  assert.equal(r.status, 1, 'una versión que no sale de su huella y su fecha tampoco vale');
});

test('una página con marcas de conflicto de git no se sella: pide resolverlas primero', (t) => {
  const dir = sitio(t);
  generar(dir);
  const ruta = join(dir, 'index.html');
  writeFileSync(ruta, readFileSync(ruta, 'utf8').replace('</main>', '</main>\n<<<<<<< HEAD\nuno\n=======\notro\n>>>>>>> otra-rama\n'));
  const c = correr(['--raiz', dir, '--comprobar']);
  assert.equal(c.status, 1);
  assert.match(c.stderr, /index\.html tiene marcas de conflicto/);
  const r = correr(['--raiz', dir, '--ahora', AHORA]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /marcas de conflicto/);
});

test('una página sin sello inicial pide agregarlo a mano una vez, con un mensaje claro', (t) => {
  const dir = sitio(t);
  writeFileSync(join(dir, 'menu.html'), '<html><head></head><body></body></html>');
  const r = correr(['--raiz', dir, '--ahora', AHORA]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /menu\.html: le faltan sellos/);
});

test('la huella del sitio de juguete coincide con la definición (sha256 de ruta, largo y contenido, con los sellos normalizados)', (t) => {
  const dir = sitio(t);
  const h = createHash('sha256');
  const poner = (ruta, buf) => { h.update(`${ruta}\0${buf.length}\0`); h.update(buf); };
  for (const p of PAGINAS) poner(p, Buffer.from(normalizar(readFileSync(join(dir, p), 'utf8'))));
  for (const rel of ['assets/css/a.css', 'assets/img/c.bin', 'assets/js/b.js']) poner(rel, readFileSync(join(dir, rel)));
  assert.equal(calcularHuella(dir), h.digest('hex'));
});
