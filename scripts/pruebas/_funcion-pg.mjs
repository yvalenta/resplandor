// Un `createClient` de mentira que habla con un Postgres de VERDAD (el desechable de _supabase-simulado.mjs) con el rol de la API
// (por defecto `service_role`, el de la llave de servicio de las Edge Functions), para correr el `index.ts` de una función contra
// la base real del arnés: la cadena completa de migraciones, sus GRANT, sus CHECK y sus RLS. Es la contraparte de `baseSimulada`
// (_funcion-simulada.mjs), que es en memoria y NO ve los permisos: una columna sin GRANT para service_role salta aquí como
// «permission denied» (42501), tal como en Supabase.
//
// Sabe lo que `cuenta` usa de supabase-js: from(tabla).select(columnas).eq(c, v).order(c, {ascending}).limit(n).maybeSingle().
// Cada consulta se traduce a un SELECT y corre como `set role <rol>`. Devuelve `{ data, error: {code, message} }` como PostgREST
// (el código es el SQLSTATE: 42P01 relación que no existe, 42703 columna que no existe, 42501 sin permiso).
//
// No termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre, solo lo importan las pruebas que lo necesitan.
import { literal } from './_supabase-simulado.mjs';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ident = (nombre) => {
  if (!IDENT.test(nombre)) throw new Error(`identificador no permitido: ${nombre}`);
  return `"${nombre}"`;
};
const valorSql = (v) => (typeof v === 'number' ? String(v) : literal(v));

/**
 * @param {{sql: Function}} pg el manejador de levantarPostgres()
 * @param {{rol?: string}} [opciones]
 * @returns {{cliente: {from: Function}, consultas: object[], tablasLeidas: () => string[]}} la misma forma que baseSimulada()
 */
export function basePostgres(pg, { rol = 'service_role' } = {}) {
  const consultas = [];

  function from(tabla) {
    const q = { tabla, columnas: null, filtros: [], orden: [], limite: null };
    const constructor = {
      select(columnas) { q.columnas = columnas; return constructor; },
      eq(columna, valor) { q.filtros.push([columna, valor]); return constructor; },
      order(columna, { ascending = true } = {}) { q.orden.push([columna, ascending]); return constructor; },
      limit(n) { q.limite = n; return constructor; },
      async maybeSingle() {
        consultas.push({ ...q, filtros: [...q.filtros], orden: [...q.orden] });
        const columnas = (q.columnas || '*').split(',').map((c) => c.trim());
        const lista = columnas.includes('*') ? '*' : columnas.map(ident).join(', ');
        const donde = q.filtros.length ? ' where ' + q.filtros.map(([c, v]) => `${ident(c)} = ${valorSql(v)}`).join(' and ') : '';
        const orden = q.orden.length ? ' order by ' + q.orden.map(([c, asc]) => `${ident(c)} ${asc ? 'asc' : 'desc'}`).join(', ') : '';
        const limite = q.limite !== null ? ` limit ${Number(q.limite)}` : '';
        const select = `select ${lista} from public.${ident(tabla)}${donde}${orden}${limite}`;
        // VERBOSITY verbose: psql imprime el SQLSTATE («ERROR:  42501: …»), que es el `code` de PostgREST.
        const r = pg.sql(`\\set VERBOSITY verbose\nselect coalesce(json_agg(to_jsonb(t)), '[]'::json) from (${select}) t;`, { como: rol });
        if (!r.ok) {
          const m = /ERROR:\s+([0-9A-Z]{5}):\s*(.*)/.exec(r.error);
          return { data: null, error: { code: m ? m[1] : 'XX000', message: m ? m[2] : r.error } };
        }
        const filas = JSON.parse(r.salida);
        if (filas.length > 1) return { data: null, error: { code: 'PGRST116', message: 'más de una fila' } };
        return { data: filas[0] ?? null, error: null };
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
