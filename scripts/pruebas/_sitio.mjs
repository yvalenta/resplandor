// Un «sitio» de prueba: una copia, en un directorio temporal, de TODO lo que depende de las
// banderas de funciones (RESPLANDOR.funciones, assets/js/local.js) — los scripts de
// assets/js, el Worker del MCP, el generador de descubrimiento y lo que este lee — con las
// banderas puestas como pida cada prueba, y con todo lo generado ya regenerado para ellas.
//
// Para qué: el repo real queda con las dos banderas apagadas (Supabase responde 402), pero el
// código de las funciones apagadas tiene que seguir cubierto (si nadie lo prueba, se pudre
// mientras está dormido) y «re-encender» tiene que probarse de verdad, no suponerse. Un sitio
// de prueba deja probar las dos direcciones sin tocar un solo archivo del repo: ni banderas,
// ni archivos generados. Nada de esto es un gancho dentro del código de producción — las
// banderas se cambian con el mismo texto que las cambiaría una persona (`false` → `true` en
// local.js) y el generador se corre con su CLI normal.
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre
// como prueba, solo lo importan las que lo necesitan.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RAIZ_REAL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TODAS_ENCENDIDAS = Object.freeze({ menuDeHoy: true, almuerzoProgramado: true });
export const TODAS_APAGADAS = Object.freeze({ menuDeHoy: false, almuerzoProgramado: false });

// Lo que el generador y los scripts del navegador leen. index.html va para el JSON-LD.
const COPIAR = [
  'assets/js',
  'assets/css/base.css',
  'assets/css/componentes.css',
  'mcp/worker.mjs',
  'scripts/descubrimiento.mjs',
  'index.html',
  // La fecha del sitio (puntaje-ora, 2026-10-03): el generador la lee para el <lastmod> del sitemap y
  // el front matter de los .md. Sin ella generaría igual, pero sin fechas: no es lo que se publica.
  'version.json',
];

const BLOQUE = /(const FUNCIONES = Object\.freeze\(\{)([\s\S]*?)(\}\);)/;

/** Pone las banderas en un local.js (texto) como las pondría una persona: cambiando `false` por `true`. */
export function conBanderas(textoLocalJs, funciones) {
  const m = textoLocalJs.match(BLOQUE);
  if (!m) throw new Error('no encontré `const FUNCIONES = Object.freeze({…})` en assets/js/local.js: ¿cambió el lugar de las banderas?');
  let cuerpo = m[2];
  for (const [nombre, valor] of Object.entries(funciones)) {
    const re = new RegExp(`(\\b${nombre}:\\s*)(true|false)(\\s*,)`);
    if (!re.test(cuerpo)) throw new Error(`la bandera «${nombre}» no está en el bloque FUNCIONES de assets/js/local.js`);
    cuerpo = cuerpo.replace(re, `$1${valor ? 'true' : 'false'}$3`);
  }
  return textoLocalJs.replace(BLOQUE, `${m[1]}${cuerpo}${m[3]}`);
}

function copiarBase(destino) {
  for (const rel of COPIAR) {
    mkdirSync(dirname(join(destino, rel)), { recursive: true });
    cpSync(join(RAIZ_REAL, rel), join(destino, rel), { recursive: true });
  }
}

const cache = new Map();

/**
 * Crea (una sola vez por combinación y por proceso) un sitio de prueba con estas banderas y con
 * lo generado regenerado. Devuelve helpers para leer, importar y volver a generar. Con
 * `{ fresco: true }` devuelve una copia propia, fuera del caché, para las pruebas que la cambian.
 */
export function crearSitio(funciones, { fresco = false } = {}) {
  const clave = JSON.stringify(Object.entries(funciones).sort());
  if (!fresco && cache.has(clave)) return cache.get(clave);

  const raiz = mkdtempSync(join(tmpdir(), 'resplandor-sitio-'));
  process.on('exit', () => rmSync(raiz, { recursive: true, force: true })); // no dejar basura en el temporal
  copiarBase(raiz);
  const ruta = (...partes) => join(raiz, ...partes);
  writeFileSync(ruta('assets/js/local.js'), conBanderas(readFileSync(ruta('assets/js/local.js'), 'utf8'), funciones));

  const sitio = {
    raiz,
    funciones: { ...funciones },
    ruta,
    leer: (rel) => readFileSync(ruta(rel), 'utf8'),
    /** Corre `node scripts/descubrimiento.mjs …` DENTRO del sitio de prueba; devuelve { codigo, salida, error }. */
    descubrimiento(args = []) {
      try {
        const salida = execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), ...args], { cwd: raiz, stdio: 'pipe' }).toString();
        return { codigo: 0, salida, error: '' };
      } catch (err) {
        return { codigo: err.status ?? 1, salida: String(err.stdout || ''), error: String(err.stderr || '') };
      }
    },
    /** Cambia las banderas del sitio (sin regenerar nada): lo mismo que editar local.js a mano. */
    ponerBanderas(nuevas) {
      writeFileSync(ruta('assets/js/local.js'), conBanderas(readFileSync(ruta('assets/js/local.js'), 'utf8'), nuevas));
      sitio.funciones = { ...sitio.funciones, ...nuevas };
    },
    /** Importa un módulo del sitio (p. ej. mcp/worker.mjs) — copia propia, con sus banderas. */
    importar: (rel) => import(pathToFileURL(ruta(rel)).href),
  };
  const gen = sitio.descubrimiento();
  if (gen.codigo !== 0) throw new Error(`no pude generar el sitio de prueba ${clave}: ${gen.error}`);
  if (!fresco) cache.set(clave, sitio);
  return sitio;
}
