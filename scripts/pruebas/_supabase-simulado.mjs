// Un Postgres 17 desechable con lo mínimo de Supabase simulado, para probar las migraciones de
// verdad (no solo leer su texto). Lo usan las pruebas de migraciones (migracion-cuenta-en-vivo.test.mjs
// y, en la fase 2, migracion-liquidaciones.test.mjs).
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre como
// prueba, solo lo importan las que lo necesitan (mismo patrón que _navegador.mjs y _sitio.mjs).
//
// Qué simula, y qué NO:
//   · Roles `anon`, `authenticated` y `service_role` (este con BYPASSRLS), y un rol `migrador` que hace
//     de «postgres» de Supabase: dueño de las migraciones, NO superusuario. Así una migración que
//     dependa de ser superusuario falla acá y no en el SQL Editor.
//   · Esquemas `extensions` (pgcrypto, con el search_path de Supabase), `auth` (con `auth.jwt()`
//     leyendo `request.jwt.claims`, como el real) y `realtime`.
//   · `realtime.send(payload, event, topic, private)` de PRUEBA: security definer, ejecutable solo por
//     `migrador` (el invocador `authenticated` NO puede llamarla, así que el trigger tiene que ser
//     security definer para que funcione), y apunta cada llamada en `realtime.llamadas_prueba`. Puede
//     fallar a pedido (`prueba.send_falla = 'si'`) para probar que una señal perdida no rompe la orden.
//   · `realtime.messages` vacío con RLS y sin policies, para comprobar que una migración no agrega.
//   · La publicación `supabase_realtime`, dueña `migrador`.
// NO simula: el servidor de Realtime (no hay WebSocket ni suscriptores), PostgREST, el pooler ni las
// particiones de `realtime.messages`. Eso se prueba en vivo (SDD §08, pruebas S-1 a S-6) y con el GO de Yonatan.
//
// Docker: contenedor `postgres:17` sin puertos publicados (solo se habla con él por `docker exec`),
// con autenticación `trust`, la base en tmpfs y `--rm`. Se detiene al terminar (también si el proceso
// muere). Si no hay Docker, `buscarDocker()` devuelve el motivo para saltar la prueba.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IMAGEN = process.env.POSTGRES_IMAGEN || 'postgres:17';

/** Docker listo para correr la imagen, o el motivo para saltar. */
export function buscarDocker() {
  if (process.env.SIN_DOCKER) return { motivo: 'SIN_DOCKER está puesto' };
  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 20000 });
  if (info.error || info.status !== 0) return { motivo: 'no hay Docker (o el demonio no responde)' };
  return { ok: true };
}

/** El tópico de la señal, calculado en Node: la otra mitad del contrato de 1A/1B. */
export const topicoCuenta = (token) => 'cuenta:' + crypto.createHash('sha256').update(token, 'utf8').digest('hex');

const SIMULACION = String.raw`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role migrador nologin;                       -- el «postgres» de Supabase: no es superusuario
grant create on database postgres to migrador;
alter database postgres set search_path = "$user", public, extensions;
grant create, usage on schema public to migrador;

create schema extensions authorization migrador;
grant usage on schema extensions to anon, authenticated, service_role;

create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role, migrador;
grant execute on function auth.jwt() to anon, authenticated, service_role, migrador;

create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role, migrador;
create table realtime.llamadas_prueba (
  id bigserial primary key, topico text, evento text, payload jsonb, privado boolean,
  rol text not null default session_user, hecha_en timestamptz not null default clock_timestamp());
create table realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb);
alter table realtime.messages enable row level security;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('prueba.send_falla', true) = 'si' then
    raise exception 'realtime.send simulada: falla a pedido';
  end if;
  insert into realtime.llamadas_prueba (topico, evento, payload, privado) values (topic, event, payload, private);
end $$;
revoke all on function realtime.send(jsonb, text, text, boolean) from public;
grant execute on function realtime.send(jsonb, text, text, boolean) to migrador;

create publication supabase_realtime;
alter publication supabase_realtime owner to migrador;
`;

/**
 * Levanta el contenedor y deja la simulación lista. Devuelve el manejador:
 *   sql(texto, { como, claims })  → { ok, salida, avisos, error }   (como: 'anon' | 'authenticated' | 'service_role' | 'migrador')
 *   filas(select, opciones)       → filas como objetos (el SELECT se envuelve en json_agg)
 *   aplicar(rutaRelativa)         → corre una migración del repo como `migrador`
 *   senales() / limpiarSenales()  → las llamadas a realtime.send (tópicos, en orden)
 *   parar()
 */
export async function levantarPostgres() {
  const nombre = `resplandor-prueba-pg-${process.pid}-${Date.now().toString(36)}`;
  const parar = () => { spawnSync('docker', ['rm', '-f', nombre], { stdio: 'ignore' }); };
  process.once('exit', parar);

  const corrida = spawnSync('docker', [
    'run', '--rm', '-d', '--name', nombre,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '--tmpfs', '/var/lib/postgresql/data',
    IMAGEN, 'postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off',
  ], { encoding: 'utf8', timeout: 300000 });
  if (corrida.status !== 0) throw new Error(`no arrancó ${IMAGEN}: ${(corrida.stderr || '').trim().split('\n').pop()}`);

  // El arranque de la imagen levanta un servidor temporal solo por socket y luego el definitivo
  // con TCP: `pg_isready -h 127.0.0.1` solo contesta cuando es el definitivo.
  const limite = Date.now() + 90000;
  for (;;) {
    const listo = spawnSync('docker', ['exec', nombre, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { encoding: 'utf8' });
    if (listo.status === 0) break;
    if (Date.now() > limite) { parar(); throw new Error('Postgres no quedó listo en 90 s'); }
    await new Promise((r) => setTimeout(r, 400));
  }

  const psql = (texto, extra = []) => spawnSync(
    'docker', ['exec', '-i', nombre, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...extra],
    { input: texto, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });

  const sql = (texto, { como, claims } = {}) => {
    let guion = '';
    if (claims) guion += `select set_config('request.jwt.claims', ${literal(JSON.stringify(claims))}, false);\n`;
    if (como) guion += `set role ${como};\n`;
    const r = psql(guion + texto);
    const stderr = r.stderr || '';
    return {
      ok: r.status === 0,
      salida: (r.stdout || '').trim(),
      avisos: stderr.split('\n').filter((l) => /\bWARNING:/.test(l)),
      error: r.status === 0 ? '' : stderr.trim(),
      stderr,
    };
  };

  const base = sql(SIMULACION);
  if (!base.ok) { parar(); throw new Error('la simulación de Supabase no cargó: ' + base.error); }

  const aplicar = (relativa) => {
    const texto = fs.readFileSync(path.join(RAIZ, relativa), 'utf8');
    return sql(texto, { como: 'migrador' });
  };

  const filas = (select, opciones) => {
    const r = sql(`select coalesce(json_agg(to_jsonb(t)), '[]'::json) from (${select}) t;`, opciones);
    if (!r.ok) throw new Error(r.error);
    return JSON.parse(r.salida);
  };

  const senales = () => filas('select topico from realtime.llamadas_prueba order by id').map((f) => f.topico);
  const limpiarSenales = () => { const r = sql('truncate realtime.llamadas_prueba restart identity;'); if (!r.ok) throw new Error(r.error); };

  return { nombre, sql, filas, aplicar, senales, limpiarSenales, parar };
}

/** Un literal de texto SQL entre comillas simples. */
export const literal = (s) => `'${String(s).replaceAll("'", "''")}'`;
