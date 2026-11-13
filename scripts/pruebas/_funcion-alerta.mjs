// Arnés para correr la Edge Function `alerta` (supabase/functions/alerta/index.ts) en Node, sin
// Deno y sin red: simula `Deno.env`/`Deno.serve` y cambia el import `npm:@supabase/supabase-js`
// por un cliente falso cuyo `rpc` pone quien prueba. El index.ts que corre es el REAL, el mismo
// que se despliega. Las «llaves» que ve son valores de mentira: por defecto solo la heredada, y con
// `entorno` también la secreta nueva (los casos de los dos caminos: CASOS_LLAVE en _funcion-simulada.mjs).
//
// Su gancho de módulos es síncrono (`registerHooks`) y, una vez puesto, se queda con supabase-js en
// todo el proceso: una prueba que lo usa no puede usar además cargarFuncion (_funcion-simulada.mjs)
// después de la primera cargarAlerta. Cada archivo de prueba corre en su propio proceso.
//
// Necesita Node >= 22.18 (corre .ts sin compilar) y `module.registerHooks` (>= 22.15).
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre
// como prueba, solo lo importan las que lo necesitan.
import module from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIR_FUNCION = join(RAIZ, 'supabase', 'functions', 'alerta');
export const SOPORTA_TS = Boolean(process.features?.typescript) && typeof module.registerHooks === 'function';

const AJUSTES_FALSOS = {
  SUPABASE_URL: 'http://supabase.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'valor-de-mentira-para-pruebas',
};

let enganchado = false;
function enganchar() {
  if (enganchado) return;
  enganchado = true;
  const falso = 'data:text/javascript,' + encodeURIComponent(
    'export function createClient(...c) { (globalThis.__clientesAlerta ??= []).push(c); return { rpc: (...a) => globalThis.__rpcAlerta(...a) }; }'
  );
  module.registerHooks({
    resolve(especificador, contexto, siguiente) {
      if (especificador.startsWith('npm:@supabase/supabase-js')) return { url: falso, shortCircuit: true };
      return siguiente(especificador, contexto);
    },
  });
}

let version = 0;

/**
 * Carga el index.ts de `alerta` con su propio estado (limitadores en blanco) y devuelve
 * `{ llamar(Request) → Response, rpcLlamadas, clientesCreados, logs, cerrar() }`.
 * `rpc(nombre, args)` debe devolver `{ data, error }` como supabase-js. `clientesCreados` guarda los
 * argumentos de cada `createClient` (el segundo es la llave). `entorno` se suma a los ajustes falsos;
 * una variable en `undefined` es una que la plataforma no inyecta. `cerrar()` restaura console.error
 * (mientras vive la instancia, lo que la función registre queda en `logs`).
 */
export async function cargarAlerta({ rpc, dir = DIR_FUNCION, entorno = {} }) {
  enganchar();
  const rpcLlamadas = [];
  const clientesCreados = [];
  const logs = [];
  globalThis.__rpcAlerta = async (nombre, args) => {
    rpcLlamadas.push({ nombre, args });
    return rpc(nombre, args);
  };
  globalThis.__clientesAlerta = clientesCreados;
  const ajustes = { ...AJUSTES_FALSOS, ...entorno };
  let manejador;
  globalThis.Deno = {
    env: { get: (k) => ajustes[k] },
    serve: (h) => { manejador = h; },
  };
  const consolaOriginal = console.error;
  console.error = (...a) => {
    logs.push(a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  };
  try {
    version += 1;
    await import(`${pathToFileURL(join(dir, 'index.ts')).href}?v=${version}`);
  } catch (e) {
    console.error = consolaOriginal;
    throw e;
  }
  if (!manejador) {
    console.error = consolaOriginal;
    throw new Error('index.ts no llamó a Deno.serve');
  }
  return {
    llamar: (req) => manejador(req),
    rpcLlamadas,
    clientesCreados,
    logs,
    cerrar: () => { console.error = consolaOriginal; },
  };
}
