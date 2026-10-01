// Arnés para correr una Edge Function de verdad (su `index.ts`, sin tocarla) dentro de Node, sin
// Deno ni supabase CLI: en esta máquina no hay ninguno de los dos (docs/sdd-cuenta-en-mesa.md §04.3).
//
// Qué hace:
//   · `Deno.env` y `Deno.serve` son simulados: `Deno.serve(handler)` solo guarda el handler, y la
//     prueba lo llama con `Request` reales y lee `Response` reales.
//   · El import `npm:@supabase/supabase-js@2` se resuelve (con un gancho de módulos de Node) a un
//     `createClient` falso que habla con una base en memoria (`baseSimulada`): mismas llamadas
//     encadenadas que usa supabase-js (`from().select().eq().order().limit().maybeSingle()`), con
//     un registro de cada consulta para que las pruebas vean QUÉ tablas y columnas se leyeron.
//   · El TypeScript lo pela Node mismo (type stripping, Node ≥ 22.18, como CI con Node 22).
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre
// como prueba, solo lo importan las que lo necesitan (fn-cuenta.test.mjs hoy; la parte 2B lo
// reutilizará para `liquidar`).
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// El gancho reemplaza SOLO el import de supabase-js, y declara el formato de los archivos de
// supabase/functions (los .js son ESM y los .ts, TypeScript ESM) para que Node no los adivine:
// el package.json de la raíz no declara «type» (es solo de la herramienta de build) y Node
// avisaría en cada carga. Todo lo demás se resuelve como siempre.
const GANCHOS = `
export async function resolve(especificador, contexto, siguiente) {
  if (especificador === 'npm:@supabase/supabase-js@2') {
    return {
      url: 'data:text/javascript,export const createClient = (...a) => globalThis.__resplandorSimulado.createClient(...a);',
      shortCircuit: true,
    };
  }
  const r = await siguiente(especificador, contexto);
  const ruta = r.url.split('?')[0];
  if (ruta.startsWith('file:') && ruta.includes('/supabase/functions/')) {
    if (ruta.endsWith('.js')) return { ...r, format: 'module' };
    if (ruta.endsWith('.ts')) return { ...r, format: 'module-typescript' };
  }
  return r;
}`;
let ganchosPuestos = false;
function ponerGanchos() {
  if (ganchosPuestos) return;
  register('data:text/javascript,' + encodeURIComponent(GANCHOS), import.meta.url);
  ganchosPuestos = true;
}

/**
 * Una «base» en memoria con la forma que usa supabase-js. `tablas` es { nombre: [filas] }; una tabla
 * que no está en `tablas` responde como Postgres cuando falta la relación (error 42P01), así que una
 * función que lea una tabla que todavía no existe revienta en la prueba. `fallas` es
 * { tabla: error } para simular una caída de la base.
 */
export function baseSimulada({ tablas = {}, fallas = {} } = {}) {
  const consultas = [];

  function from(tabla) {
    const q = { tabla, columnas: null, filtros: [], orden: [], limite: null };
    const ejecutar = () => {
      consultas.push({ ...q, filtros: [...q.filtros], orden: [...q.orden] });
      if (fallas[tabla]) return { data: null, error: fallas[tabla] };
      if (!(tabla in tablas)) {
        return { data: null, error: { code: '42P01', message: `relation "public.${tabla}" does not exist` } };
      }
      let filas = tablas[tabla].filter((f) => q.filtros.every(([c, v]) => String(f[c]) === String(v)));
      for (const [c, asc] of [...q.orden].reverse()) {
        filas = [...filas].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (q.limite !== null) filas = filas.slice(0, q.limite);
      const columnas = (q.columnas || '*').split(',').map((c) => c.trim());
      const proyectar = (f) => {
        if (columnas.includes('*')) return structuredClone(f);
        return Object.fromEntries(columnas.map((c) => {
          if (!(c in f)) throw Object.assign(new Error(`column ${tabla}.${c} does not exist`), { code: '42703' });
          return [c, structuredClone(f[c])];
        }));
      };
      return { filas: filas.map(proyectar) };
    };
    const constructor = {
      select(columnas) { q.columnas = columnas; return constructor; },
      eq(columna, valor) { q.filtros.push([columna, valor]); return constructor; },
      order(columna, { ascending = true } = {}) { q.orden.push([columna, ascending]); return constructor; },
      limit(n) { q.limite = n; return constructor; },
      async maybeSingle() {
        let r;
        try { r = ejecutar(); } catch (error) { return { data: null, error }; }
        if (r.error) return r;
        if (r.filas.length > 1) return { data: null, error: { code: 'PGRST116', message: 'más de una fila' } };
        return { data: r.filas[0] ?? null, error: null };
      },
    };
    return constructor;
  }

  return {
    cliente: { from },
    consultas,
    tablasLeidas: () => [...new Set(consultas.map((c) => c.tabla))],
  };
}

let cargas = 0;

/**
 * Carga `index.ts` de una función con su entorno y su base simulados. Devuelve
 * `{ atender(req) }`, que corre el handler que la función registró con `Deno.serve`.
 * Cada carga es una instancia nueva del módulo (su limitador en memoria empieza vacío).
 */
export async function cargarFuncion(rutaRelativa, { base, entorno = {} }) {
  ponerGanchos();
  const env = { SUPABASE_URL: 'https://prueba.invalid', SUPABASE_SERVICE_ROLE_KEY: 'llave-de-prueba', ...entorno };
  const creados = [];
  let handler = null;
  globalThis.__resplandorSimulado = {
    createClient: (...args) => { creados.push(args); return base.cliente; },
  };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(path.join(RAIZ, rutaRelativa)).href + `?carga=${++cargas}`);
  if (!handler) throw new Error(`${rutaRelativa} no llamó a Deno.serve`);
  return { atender: (req) => handler(req), clientesCreados: creados };
}

/** Importa un módulo de supabase/functions (p. ej. `_compartido/mesa.js`) por los mismos ganchos. */
export async function importarModulo(rutaRelativa) {
  ponerGanchos();
  return import(pathToFileURL(path.join(RAIZ, rutaRelativa)).href);
}
