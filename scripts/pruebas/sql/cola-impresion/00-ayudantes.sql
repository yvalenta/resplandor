-- Ayudantes de las pruebas SQL de la cola de impresión (migration 20261003140000_cola_impresion.sql).
-- Se corre UNA vez, como superusuario, sobre la simulación de Supabase de _supabase-simulado.mjs y ANTES de
-- las migraciones: la compuerta de personal exige que el admin inicial tenga una cuenta de Google en auth.*.
-- Todo lleva guardas «if not exists»: sirve también sobre un arnés que ya trae algunas de estas piezas.
-- Ninguna identidad es un correo real (dominio .test).

-- ── lo que la simulación no trae y las migraciones de la compuerta sí usan ──
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  identity_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role, migrador;
grant execute on function auth.uid() to anon, authenticated, service_role, migrador;
grant select on auth.users, auth.identities to migrador;       -- mi_correo() las lee con los permisos de quien aplica

create or replace function realtime.topic() returns text language sql stable as
$$ select nullif(current_setting('realtime.topic', true), '') $$;
grant execute on function realtime.topic() to anon, authenticated, service_role, migrador;
alter table realtime.messages owner to migrador;               -- en Supabase, `postgres` puede crear policies ahí

-- ── los privilegios por defecto de Supabase ──
-- En un proyecto de Supabase, todo lo que `postgres` crea en `public` nace con ALL para anon, authenticated y service_role (tablas,
-- funciones y secuencias: ALTER DEFAULT PRIVILEGES de la plataforma). La simulación de _supabase-simulado.mjs no los trae, y sin ellos
-- un REVOKE olvidado en una migración no se notaría en estas pruebas. Se ponen ANTES de las migraciones, solo para lo que cree `migrador`.
alter default privileges for role migrador in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role migrador in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role migrador in schema public grant all on functions to anon, authenticated, service_role;

-- ── el esquema de las pruebas ──
create schema if not exists t;
create table if not exists t.res (n serial primary key, nombre text not null, ok boolean not null, detalle text);
create table if not exists t.tokens (clave text primary key, id uuid not null, token text not null);
create table if not exists t.gente (clave text primary key, id uuid not null, email text not null, provider text not null);
grant usage on schema t to public;
grant all on t.res, t.tokens, t.gente to public;
grant usage on sequence t.res_n_seq to public;

insert into t.gente values
  ('admin',     '00000000-0000-4000-8000-0000000000a1', 'admin@resplandor.test',     'google'),
  ('admin2',    '00000000-0000-4000-8000-0000000000a2', 'admin2@resplandor.test',    'google'),
  ('mesero',    '00000000-0000-4000-8000-0000000000b1', 'mesero1@resplandor.test',   'google'),
  ('mesero2',   '00000000-0000-4000-8000-0000000000b2', 'mesero2@resplandor.test',   'google'),
  ('pendiente', '00000000-0000-4000-8000-0000000000c1', 'pendiente@resplandor.test', 'google'),
  ('eliminado', '00000000-0000-4000-8000-0000000000d1', 'eliminado@resplandor.test', 'google'),
  ('ajena',     '00000000-0000-4000-8000-0000000000e1', 'ajena@otra.test',           'google'),
  ('correo',    '00000000-0000-4000-8000-0000000000f1', 'admin@resplandor.test',     'email')
on conflict (clave) do nothing;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select g.id, g.email, jsonb_build_object('provider', g.provider), jsonb_build_object('full_name', initcap(g.clave))
  from t.gente g
 where not exists (select 1 from auth.users u where u.id = g.id);
insert into auth.identities (user_id, provider, identity_data)
select g.id, g.provider, jsonb_build_object('email', g.email)
  from t.gente g
 where not exists (select 1 from auth.identities i where i.user_id = g.id);

-- ── resultados ──
create or replace function t.ok(p_nombre text, p_cond boolean, p_detalle text default null) returns void
  language sql as
$$ insert into t.res (nombre, ok, detalle) values (p_nombre, coalesce(p_cond, false), p_detalle) $$;

-- Entra como esa persona (rol de Postgres + claims de PostgREST). t.fuera() vuelve al dueño.
create or replace function t.como(p_clave text) returns void language plpgsql as
$$
declare g t.gente;
begin
  execute 'reset role';
  if p_clave = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', false);
    execute 'set role anon';
    return;
  end if;
  select * into g from t.gente where clave = p_clave;
  if not found then raise exception 'identidad desconocida %', p_clave; end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', g.id, 'role', 'authenticated', 'email', g.email,
    'app_metadata', jsonb_build_object('provider', g.provider)
  )::text, false);
  execute 'set role authenticated';
end $$;

create or replace function t.fuera() returns void language plpgsql as
$$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;

-- Ejecuta una sentencia con el rol actual: 'ok' o 'SQLSTATE: mensaje'.
create or replace function t.intenta(p_sql text) returns text language plpgsql as
$$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ': ' || sqlerrm; end $$;

-- Primera columna de la primera fila (null si no hay) o 'ERR sqlstate: mensaje'.
create or replace function t.val(p_sql text) returns text language plpgsql as
$$
declare v text;
begin
  execute p_sql into v;
  return v;
exception when others then return 'ERR ' || sqlstate || ': ' || sqlerrm;
end $$;

-- La sentencia debe FALLAR y el «SQLSTATE: mensaje» tiene que casar con el patrón (regex).
create or replace function t.falla(p_nombre text, p_sql text, p_patron text) returns void language plpgsql as
$$
declare r text;
begin
  r := t.intenta(p_sql);
  perform t.ok(p_nombre, r <> 'ok' and r ~ p_patron, r);
end $$;

-- Lo mismo, pero la consulta corre como DUEÑO (SECURITY DEFINER): para mirar el estado de las tablas sin salir de la identidad
-- que se está probando. Las comprobaciones de permisos NO la usan: esas tienen que correr con el rol de la API.
create or replace function t.igual_sup(p_nombre text, p_sql text, p_esperado text) returns void
  language plpgsql security definer as
$$
declare r text;
begin
  r := t.val(p_sql);
  perform t.ok(p_nombre, r is not distinct from p_esperado, 'esperado «' || coalesce(p_esperado, 'null') || '», salió «' || coalesce(r, 'null') || '»');
end $$;

-- La sentencia debe salir bien.
create or replace function t.sale(p_nombre text, p_sql text) returns void language plpgsql as
$$
declare r text;
begin
  r := t.intenta(p_sql);
  perform t.ok(p_nombre, r = 'ok', r);
end $$;

-- La consulta (una columna, una fila) debe dar exactamente este texto.
create or replace function t.igual(p_nombre text, p_sql text, p_esperado text) returns void language plpgsql as
$$
declare r text;
begin
  r := t.val(p_sql);
  perform t.ok(p_nombre, r is not distinct from p_esperado, 'esperado «' || coalesce(p_esperado, 'null') || '», salió «' || coalesce(r, 'null') || '»');
end $$;

grant execute on all functions in schema t to public;

-- Un documento mínimo y válido.
create or replace function t.docj() returns jsonb language sql immutable as
$$ select '{"lineas":[{"texto":"x"}]}'::jsonb $$;

-- Memoria de la prueba: guarda y lee valores por clave (ids de trabajos, etc.).
create table if not exists t.v (clave text primary key, valor text);
grant all on t.v to public;
create or replace function t.g(p_clave text, p_valor text) returns void language sql as
$$ insert into t.v values (p_clave, p_valor) on conflict (clave) do update set valor = excluded.valor $$;
create or replace function t.vv(p_clave text) returns text language sql as
$$ select valor from t.v where clave = p_clave $$;

-- Lo que el agente de esa impresora se lleva con impresora_tomar, con el rol actual (anon, como el agente real):
-- el número de trabajos, o los textos de sus primeras líneas en el orden en que salen (separados por coma).
create or replace function t.toma(p_clave text, p_max integer default 5) returns integer language plpgsql as
$$ declare n integer; begin select count(*) into n from public.impresora_tomar(t.tok(p_clave), p_max); return n; end $$;
create or replace function t.toma_textos(p_clave text, p_max integer default 5) returns text language plpgsql as
$$ declare r text; begin
  select coalesce(string_agg(x.contenido -> 'lineas' -> 0 ->> 'texto', ',' order by x.rn), '') into r
    from (select s.*, row_number() over () as rn from public.impresora_tomar(t.tok(p_clave), p_max) s) x;
  return r; end $$;

-- ── datos de partida (como dueño) ──
-- Personal: admin (y admin2), mesero1 y mesero2 activos; eliminado de baja; ajena y pendiente sin fila.
-- Si la cadena es la de la ola C (personal.estado), los activos quedan aprobados y `pendiente` con su fila pendiente.
create or replace function t.partida() returns void language plpgsql as
$$
declare v_estado boolean;
begin
  perform t.fuera();
  delete from public.impresiones;
  delete from public.impresoras;
  delete from t.tokens;
  delete from public.personal where email <> 'admin@resplandor.test';
  update public.personal set activo = true, rol = 'admin' where email = 'admin@resplandor.test';
  insert into public.personal (email, nombre, rol, activo) values
    ('admin2@resplandor.test',   'Admin Dos',  'admin',  true),
    ('mesero1@resplandor.test',  'Mesero Uno', 'mesero', true),
    ('mesero2@resplandor.test',  'Mesero Dos', 'mesero', true),
    ('eliminado@resplandor.test','Eliminado',  'mesero', false);
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'personal' and column_name = 'estado') into v_estado;
  if v_estado then
    execute $q$update public.personal set estado = 'aprobado'$q$;
    execute $q$insert into public.personal (email, nombre, rol, activo, estado)
               values ('pendiente@resplandor.test', 'Pendiente', 'mesero', true, 'pendiente')$q$;
  end if;
  truncate realtime.llamadas_prueba restart identity;
  perform set_config('prueba.send_falla', '', false);
end $$;

-- Crea una impresora como admin (impresora_crear) y guarda su token en t.tokens. Devuelve el id.
create or replace function t.nueva_impresora(p_clave text, p_nombre text default null) returns uuid language plpgsql as
$$
declare r jsonb;
begin
  perform t.como('admin');
  r := public.impresora_crear(coalesce(p_nombre, p_clave));
  perform t.fuera();
  if not coalesce((r ->> 'ok')::boolean, false) then raise exception 'no se creó la impresora %: %', p_clave, r; end if;
  insert into t.tokens values (p_clave, (r ->> 'id')::uuid, r ->> 'token')
    on conflict (clave) do update set id = excluded.id, token = excluded.token;
  return (r ->> 'id')::uuid;
end $$;

create or replace function t.tok(p_clave text) returns text language sql as
$$ select token from t.tokens where clave = p_clave $$;
create or replace function t.pid(p_clave text) returns uuid language sql as
$$ select id from t.tokens where clave = p_clave $$;

-- Un trabajo válido insertado como dueño (sin el tope de la API). Devuelve el id.
create or replace function t.trabajo(p_destino text default null, p_texto text default 'x', p_tipo text default 'cuenta')
  returns uuid language plpgsql as
$$
declare v_id uuid;
begin
  perform t.fuera();
  insert into public.impresiones (impresora_id, tipo, contenido)
  values (case when p_destino is null then null else t.pid(p_destino) end, p_tipo,
          jsonb_build_object('titulo', 'Prueba', 'lineas', jsonb_build_array(jsonb_build_object('texto', p_texto))))
  returning id into v_id;
  return v_id;
end $$;

-- Envejece un trabajo (como dueño): creada_en y, si la tiene, tomada_en.
create or replace function t.envejecer(p_id uuid, p_cuanto interval) returns void language plpgsql as
$$
begin
  perform t.fuera();
  update public.impresiones set creada_en = creada_en - p_cuanto, tomada_en = tomada_en - p_cuanto where id = p_id;
end $$;

-- «estado/intentos» de un trabajo.
create or replace function t.est(p_id uuid) returns text language plpgsql as
$$ begin return (select estado || '/' || intentos from public.impresiones where id = p_id); end $$;

-- Los tópicos emitidos, en orden y separados por coma.
create or replace function t.senales() returns text language sql as
$$ select coalesce(string_agg(topico, ',' order by id), '') from realtime.llamadas_prueba $$;

-- El tópico esperado de un token, con otra función que la de la migración (sha256 del núcleo, no pgcrypto).
create or replace function t.topico(p_token text) returns text language sql as
$$ select 'impresora:' || encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

grant execute on all functions in schema t to public;
