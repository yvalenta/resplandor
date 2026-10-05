// La migración de la etiqueta y el día de la semana: supabase/migrations/20261003130000_carta_etiqueta_y_promos.sql
// (tarea carta-promos, parte BD). `productos` gana `etiqueta` (nota corta que la carta pinta como pastilla) y `dia_semana`
// (1 = lunes … 7 = domingo, solo para las promociones); la vista pública `carta_publica` las expone al final de sus columnas.
//
// Dos partes, como migracion-cuenta-en-vivo.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. Las dos columnas y sus checks (con nombre, solo si faltan),
//      la vista con las cuatro columnas de siempre y dos más AL FINAL, SECURITY DEFINER, mismo filtro y mismos grants, nada que
//      toque datos, policies ni funciones, el requisito de `en_carta` antes de cualquier cambio, y la reversa de la cabecera.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker, ver _supabase-simulado.mjs): la CADENA COMPLETA de migraciones del
//      repo (base, carta, cuenta en vivo, presencia, compuerta, alertas, permisos por rol) y después esta. Qué cambia y qué NO
//      (columnas, checks, definición y ACL de la vista, ACL, policies y triggers de `productos`, lo que `anon` puede leer o
//      escribir en todo `public`), que `anon` vea etiqueta y día SOLO de las filas visibles, los checks (día 0 y 8, etiqueta de
//      41), que el upsert del POS (siete columnas) no pise lo nuevo, la idempotencia, el requisito y que la reversa de la
//      cabecera deje la base exactamente como estaba.
//
// Lo que NO prueba: el sobre de datos de Yonatan (las promociones, «Incluye jugo», etc.): son datos de producción y no viven en el
// repo. Se probó aparte, contra esta misma cadena (evidencia de la tarea).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, buscarDocker, levantarPostgres } from './_supabase-simulado.mjs';

const NOMBRE = '20261003130000_carta_etiqueta_y_promos.sql';
const DIR = path.join(RAIZ, 'supabase/migrations');
const SQL = fs.readFileSync(path.join(DIR, NOMBRE), 'utf8');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CODIGO = sinComentarios(SQL);
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CODIGO_C = compacto(CODIGO);
const CARTA_ANTERIOR = fs.readFileSync(path.join(DIR, '20260906120000_carta_publica_y_token_mesa.sql'), 'utf8');

/** La vista de siempre, tal como la dejó 20260906120000: lo que la reversa tiene que restaurar. */
const SELECT_ANTERIOR = compacto(
  /create or replace view public\.carta_publica\s+with \(security_invoker = false\) as\s+(select categoria, nombre, precio, descripcion\s+from public\.productos\s+where activo and en_carta);/
    .exec(sinComentarios(CARTA_ANTERIOR))[1]);

/** Las sentencias de la reversa de la cabecera: de «--   begin;» a «--   commit;», sin el margen. */
const REVERSA = (() => {
  const salida = [];
  let dentro = false;
  for (const linea of SQL.split('\n')) {
    if (linea === '--   begin;') dentro = true;
    if (dentro) salida.push(linea.replace(/^--   /, ''));
    if (linea === '--   commit;') dentro = false;
  }
  return salida;
})();
const REVERSA_SQL = REVERSA.join('\n');

// ───────────────────────── 1. estática ─────────────────────────

test('la migración se aplica después de todas las de antes y su fecha no choca con las otras ramas (20261003130000); solo la cola de impresión (20261003140000), el pago con Bre-B (20261003150000), el precio vivo (20261005100000), la alerta «pide la cuenta» (20261005110000) el permiso de promo_regla_ok (20261005120000) y la guardia del cobro por partes (20261005130000), que no tocan la carta, vienen después', () => {
  const nombres = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const siguientes = nombres.slice(nombres.indexOf(NOMBRE) + 1);
  assert.deepEqual(siguientes, ['20261003140000_cola_impresion.sql', '20261003150000_pago_breb.sql', '20261005100000_precio_vivo_y_promos.sql', '20261005110000_alerta_pedir_cuenta.sql', '20261005120000_promo_regla_ejecutable.sql', '20261005130000_promo_cobro_por_partes.sql'], 'lo posterior es la cola de impresión, el pago con Bre-B, el precio vivo (agrega productos.promo_regla; no toca la vista), la alerta «pide la cuenta», el permiso de promo_regla_ok y la guardia del cobro por partes (no tocan productos ni la vista)');
  assert.equal(nombres.filter((f) => f.startsWith('20261003130000')).length, 1);
  assert.ok(nombres.includes('20260906120000_carta_publica_y_token_mesa.sql'), 'la que crea carta_publica y en_carta va antes');
});

test('es la ÚLTIMA definición de carta_publica: ninguna migración posterior la vuelve a crear', () => {
  const nombres = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const quienes = nombres.filter((f) => /create\s+(or\s+replace\s+)?view\s+public\.carta_publica\b/i.test(sinComentarios(fs.readFileSync(path.join(DIR, f), 'utf8'))));
  assert.deepEqual(quienes, ['20260906120000_carta_publica_y_token_mesa.sql', NOMBRE]);
});

test('agrega las dos columnas, null y sin default, con «add column if not exists»', () => {
  assert.match(CODIGO_C, /alter table public\.productos add column if not exists etiqueta text, add column if not exists dia_semana smallint;/);
  assert.doesNotMatch(CODIGO_C, /\bnot null\b|\bdefault\b/i, 'ni obligatorias ni con valor de partida: el POS no las conoce');
});

test('los checks tienen nombre, se crean solo si faltan y dicen lo que prometen', () => {
  assert.equal((CODIGO.match(/from pg_constraint/g) || []).length, 2, 'uno por check, para poder correr la migración dos veces');
  assert.match(CODIGO_C, /conname = 'productos_etiqueta_valida'\) then alter table public\.productos add constraint productos_etiqueta_valida check \(char_length\(etiqueta\) <= 40 and btrim\(etiqueta\) <> ''\);/);
  assert.match(CODIGO_C, /conname = 'productos_dia_semana_valido'\) then alter table public\.productos add constraint productos_dia_semana_valido check \(dia_semana between 1 and 7\);/);
  assert.doesNotMatch(CODIGO_C.replace(/if not exists \(select 1 from pg_constraint[^;]*?then alter table public\.productos add constraint [^;]*;/g, ''), /add constraint/, 'ningún add constraint suelto: fallaría la segunda vez');
});

test('la vista: las cuatro columnas de siempre y dos más AL FINAL, SECURITY DEFINER, mismo filtro', () => {
  assert.match(CODIGO_C, /create or replace view public\.carta_publica with \(security_invoker = false\) as select categoria, nombre, precio, descripcion, etiqueta, dia_semana from public\.productos where activo and en_carta;/);
  assert.doesNotMatch(CODIGO, /security_invoker\s*=\s*true/i);
  assert.doesNotMatch(CODIGO, /\bdrop\b/i, 'create or replace: nada se borra al aplicarla (el drop vive solo en la reversa comentada)');
  assert.match(SELECT_ANTERIOR, /^select categoria, nombre, precio, descripcion from public\.productos where activo and en_carta$/, 'la lectura de la vista anterior (la base de comparación)');
});

test('los grants son los de siempre y NADA más: ni a anon sobre productos, ni policies, ni funciones, ni datos', () => {
  const grants = [...CODIGO.matchAll(/\bgrant\b[^;]*;/gi)].map((m) => compacto(m[0]));
  assert.deepEqual(grants, ['grant select on public.carta_publica to anon, authenticated;']);
  assert.match(CODIGO_C, /revoke all on public\.carta_publica from anon, authenticated;/);
  assert.doesNotMatch(CODIGO, /\b(create|alter|drop)\s+policy\b/i, 'cero policies');
  assert.doesNotMatch(CODIGO, /\b(create|alter)\s+(or\s+replace\s+)?(function|trigger|table\s+public\.(?!productos))/i, 'ni funciones ni triggers ni otras tablas');
  assert.doesNotMatch(CODIGO, /\b(insert\s+into|delete\s+from|truncate)\b|\bupdate\s+public\./i, 'es esquema: los datos van en el sobre de Yonatan');
  assert.doesNotMatch(CODIGO, /realtime|publication/i, 'la publicación de Realtime es de tabla entera: no cambia');
});

test('se detiene sin cambiar nada si falta productos.en_carta, ANTES de la primera alteración', () => {
  const guardia = CODIGO.indexOf("attname = 'en_carta'");
  assert.ok(guardia !== -1);
  assert.ok(guardia < CODIGO.indexOf('alter table public.productos'), 'la comprobación va primero');
  assert.match(CODIGO.slice(guardia, guardia + 400), /raise exception 'Falta 20260906120000_carta_publica_y_token_mesa\.sql/);
});

test('es idempotente: ningún create view, add column ni add constraint sin su guarda', () => {
  assert.doesNotMatch(CODIGO, /\bcreate\s+view\b/i, 'un create view pelado falla la segunda vez');
  assert.equal((CODIGO.match(/add column/g) || []).length, (CODIGO.match(/add column if not exists/g) || []).length);
});

test('comenta las dos columnas y la vista, y avisa a PostgREST', () => {
  assert.match(CODIGO, /comment on column public\.productos\.etiqueta is/);
  assert.match(CODIGO, /comment on column public\.productos\.dia_semana is/);
  assert.match(CODIGO, /comment on view public\.carta_publica is/);
  assert.match(CODIGO, /notify pgrst, 'reload schema';/);
});

test('la cabecera dice el ORDEN (migración antes que la carta; datos después) y trae la reversa', () => {
  assert.match(SQL, /ORDEN\. Aplicar ESTA migración ANTES de publicar la carta\.html/);
  assert.match(SQL, /Reversa \(< 1 min\)/);
  assert.match(SQL, /Primero se revierte el commit de carta\.html/);
});

test('la reversa de la cabecera: recrea la vista de siempre, quita checks y columnas, sin cascade, dentro de begin … commit', () => {
  assert.equal(REVERSA[0], 'begin;');
  assert.equal(REVERSA[REVERSA.length - 1], 'commit;');
  assert.ok(REVERSA.length > 6 && REVERSA.length < 30, `la reversa extraída tiene un tamaño razonable (${REVERSA.length} líneas), no media migración`);
  const c = compacto(REVERSA_SQL);
  assert.match(c, /drop view if exists public\.carta_publica;/);
  assert.ok(c.includes(`create view public.carta_publica with (security_invoker = false) as ${SELECT_ANTERIOR};`), 'la vista de antes, igual a la de 20260906120000');
  assert.match(c, /revoke all on public\.carta_publica from anon, authenticated; grant select on public\.carta_publica to anon, authenticated;/);
  assert.match(c, /drop constraint if exists productos_etiqueta_valida;/);
  assert.match(c, /drop constraint if exists productos_dia_semana_valido;/);
  assert.match(c, /drop column if exists etiqueta;/);
  assert.match(c, /drop column if exists dia_semana;/);
  assert.doesNotMatch(c, /cascade/i, 'un cascade se llevaría objetos que no son de esta migración');
  assert.ok(c.indexOf('drop view') < c.indexOf('drop column'), 'la vista primero: depende de las columnas');
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();

const ADMIN = { como: 'authenticated', claims: { role: 'authenticated', sub: '00000000-0000-4000-8000-0000000000a1', app_metadata: { provider: 'google' }, email: 'admin@resplandor.test' } };
const ANON = { como: 'anon', claims: { role: 'anon' } };

// Lo mínimo que las migraciones de la ola A (compuerta, alertas, permisos) piden al Supabase real y la simulación común no trae:
// cuentas de Google (auth.users/identities, auth.uid), realtime.topic(), y que el «postgres» simulado (migrador) lea auth y
// sea dueño de realtime.messages. Con esto la CADENA COMPLETA se aplica, no solo un pedazo.
const SIMULACION_EXTRA = String.raw`
create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb not null default '{}', raw_user_meta_data jsonb not null default '{}', created_at timestamptz not null default now());
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, provider text not null, identity_data jsonb not null default '{}', created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role, migrador;
grant select on auth.users, auth.identities to migrador;
alter table realtime.messages owner to migrador;
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
grant execute on function realtime.topic() to anon, authenticated, service_role, migrador;
insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-4000-8000-0000000000a1', 'admin@resplandor.test', '{"provider":"google"}');
insert into auth.identities (user_id, provider, identity_data) values ('00000000-0000-4000-8000-0000000000a1', 'google', '{"email":"admin@resplandor.test"}');
`;

// Productos de partida con la forma de producción. «Jugo» (en_carta = false) y «Plato retirado» (activo = false) NO se ven nunca.
const PRODUCTOS = String.raw`
insert into public.productos (id, categoria, nombre, precio, descripcion, activo, en_carta) values
  ('prod_sopacarne', 'Ejecutivos',     'Sopa y carne',      14000, '', true, true),
  ('prod_sancocho',  'Ejecutivos',     'Sancocho trifasico', 20000, 'Sancocho trifasico', true, true),
  ('prod_cantarito', 'Bebidas',        'Cantarito',         28000, '', true, true),
  ('prod_picada',    'Platos Fuertes', 'Picada Resplandor', 110000, 'Para 8-10 personas', true, true),
  ('prod_juguito',   'Bebidas',        'Jugo',               2000, '"Juguito" (atajo de caja)', true, false),
  ('prod_retirado',  'Entradas',       'Plato retirado',     9000, '', false, true);
`;

describe('contra un Postgres 17 desechable (cadena completa de migraciones, Supabase simulado)', { skip: docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false }, () => {
  let pg;
  let antes;       // radiografía con todo lo anterior y SIN esta migración
  let despues;     // …y con ella

  const migracion = (nombre) => {
    const texto = "set resplandor.admins_iniciales = 'admin@resplandor.test';\n" + fs.readFileSync(path.join(DIR, nombre), 'utf8');
    return pg.sql(texto, { como: 'migrador' });
  };
  const sql = (texto, opciones) => pg.sql(texto, opciones);
  // Como pg.filas, pero con rol: `sql` antepone un select de set_config cuando hay claims, y esa línea ensucia la salida. jsonb_agg va en
  // UNA línea (json_agg parte el arreglo en varias): la respuesta es la última.
  const filas = (select, opciones) => {
    const r = pg.sql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (${select}) t;`, opciones);
    if (!r.ok) throw new Error(r.error);
    return JSON.parse(r.salida.split('\n').pop());
  };
  const falla = (texto, opciones) => { const r = sql(texto, opciones); assert.equal(r.ok, false, `se esperaba un error: ${texto}`); return r.error; };
  const sale = (texto, opciones) => { const r = sql(texto, opciones); assert.ok(r.ok, `${texto}\n${r.error}`); return r; };

  /** Todo lo que esta migración toca y lo que NO debe tocar, en forma comparable. */
  const radiografia = () => ({
    columnas: filas("select a.attname, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull as obligatoria, pg_get_expr(d.adbin, d.adrelid) as defecto from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.productos'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum"),
    checks: filas("select conname, contype::text as tipo, pg_get_constraintdef(oid) as definicion from pg_constraint where conrelid = 'public.productos'::regclass order by conname"),
    vista: filas("select (select string_agg(attname::text, ',' order by attnum) from pg_attribute where attrelid = c.oid and attnum > 0 and not attisdropped) as columnas, pg_get_viewdef(c.oid, true) as definicion, reloptions::text as opciones, pg_get_userbyid(relowner) as duenio, relacl::text as acl, obj_description(c.oid, 'pg_class') as comentario from pg_class c where c.oid = 'public.carta_publica'::regclass"),
    productos: filas("select relacl::text as acl, relrowsecurity as rls, relforcerowsecurity as forzada from pg_class where oid = 'public.productos'::regclass"),
    comentarios: filas("select attname, col_description('public.productos'::regclass, attnum) as comentario from pg_attribute where attrelid = 'public.productos'::regclass and attnum > 0 and not attisdropped order by attnum"),
    policies: filas("select policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'productos' order by policyname"),
    triggers: filas("select tgname, pg_get_triggerdef(oid) as definicion from pg_trigger where tgrelid = 'public.productos'::regclass and not tgisinternal order by tgname"),
    indices: filas("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'productos' order by indexname"),
    publicacion: filas("select pubname, tablename from pg_publication_tables where schemaname = 'public' and tablename in ('productos', 'carta_publica') order by 1, 2"),
    // Lo que anon puede hacer en TODO public: columnas con select/insert/update/references y funciones ejecutables.
    anon: filas(`select c.relname || '.' || a.attname || ' ' || p.priv as permiso
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
                   join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                   cross join (values ('select'), ('insert'), ('update'), ('references')) p(priv)
                  where c.relkind in ('r', 'v', 'm', 'p', 'f') and has_column_privilege('anon', c.oid, a.attnum, p.priv)
                  order by 1`).map((f) => f.permiso),
    anonFunciones: filas("select p.oid::regprocedure::text as f from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute') order by 1").map((f) => f.f),
    authenticated: filas(`select c.relname || '.' || a.attname || ' ' || p.priv as permiso
                            from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                            cross join (values ('select'), ('insert'), ('update')) p(priv)
                           where c.oid in ('public.carta_publica'::regclass, 'public.productos'::regclass) and has_column_privilege('authenticated', c.oid, a.attnum, p.priv)
                           order by 1`).map((f) => f.permiso),
  });
  // Los números de columna (attnum) no se comparan: quitar y volver a poner una columna deja un hueco, y no importa.

  before(async () => {
    pg = await levantarPostgres();
    sale(SIMULACION_EXTRA);
    const nombres = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    // La cadena de ANTES de esta migración: lo posterior (la cola de impresión, que agrega funciones ejecutables por anon con token) no cuenta aquí.
    for (const n of nombres.filter((f) => f < NOMBRE)) {
      const r = migracion(n);
      assert.ok(r.ok, `la cadena se cayó en ${n}: ${r.error}`);
    }
    sale(PRODUCTOS, { como: 'migrador' });
    antes = radiografia();
    const r = migracion(NOMBRE);
    assert.ok(r.ok, r.error);
    despues = radiografia();
  });
  after(() => pg?.parar());

  test('la cadena completa del repo se aplica y esta migración va al final', () => {
    assert.equal(antes.columnas.some((c) => c.attname === 'etiqueta'), false, 'antes no existían');
    assert.equal(despues.columnas.some((c) => c.attname === 'etiqueta'), true);
    assert.equal(filas('select count(*)::int as n from public.productos').at(0).n, 6);
  });

  test('las dos columnas nuevas son opcionales, sin default, con su tipo y su comentario', () => {
    const nuevas = despues.columnas.filter((c) => ['etiqueta', 'dia_semana'].includes(c.attname));
    assert.deepEqual(nuevas, [
      { attname: 'etiqueta', tipo: 'text', obligatoria: false, defecto: null },
      { attname: 'dia_semana', tipo: 'smallint', obligatoria: false, defecto: null },
    ]);
    assert.deepEqual(despues.columnas.slice(0, antes.columnas.length), antes.columnas, 'las de antes, intactas y en su lugar');
    for (const c of despues.comentarios.filter((x) => ['etiqueta', 'dia_semana'].includes(x.attname))) assert.ok(c.comentario && c.comentario.length > 20, `${c.attname} sin comentario`);
  });

  test('carta_publica: las cuatro de siempre y, al final, etiqueta y dia_semana; sigue SECURITY DEFINER y con su filtro', () => {
    const [v] = despues.vista;
    assert.equal(v.columnas, 'categoria,nombre,precio,descripcion,etiqueta,dia_semana');
    assert.equal(antes.vista[0].columnas, 'categoria,nombre,precio,descripcion');
    assert.equal(v.opciones, '{security_invoker=false}');
    assert.match(compacto(v.definicion), /FROM productos WHERE activo AND en_carta;$/);
  });

  test('la vista conserva dueño, ACL y comentario; la tabla productos, su ACL, RLS, policies, triggers, índices y Realtime', () => {
    assert.equal(despues.vista[0].duenio, antes.vista[0].duenio);
    assert.equal(despues.vista[0].acl, antes.vista[0].acl, 'los grants de la vista, idénticos');
    assert.match(despues.vista[0].acl, /anon=r\/migrador,authenticated=r\/migrador/);
    assert.equal(despues.vista[0].comentario, antes.vista[0].comentario);
    assert.deepEqual(despues.productos, antes.productos);
    assert.deepEqual(despues.policies, antes.policies);
    assert.deepEqual(despues.triggers, antes.triggers);
    assert.deepEqual(despues.indices, antes.indices);
    assert.deepEqual(despues.publicacion, antes.publicacion);
    assert.ok(despues.publicacion.some((p) => p.tablename === 'productos'), 'productos sigue en supabase_realtime');
    assert.ok(despues.triggers.some((t) => t.tgname === 'trg_productos_updated_at'));
  });

  test('NADA nuevo visible ni escribible para anon: lo único nuevo son dos columnas SELECT de la vista', () => {
    const nuevos = despues.anon.filter((p) => !antes.anon.includes(p));
    const perdidos = antes.anon.filter((p) => !despues.anon.includes(p));
    assert.deepEqual(nuevos, ['carta_publica.dia_semana select', 'carta_publica.etiqueta select']);
    assert.deepEqual(perdidos, []);
    assert.deepEqual(despues.anon.filter((p) => / (insert|update|references)$/.test(p)), [], 'anon no escribe nada en public');
    assert.deepEqual(despues.anonFunciones, antes.anonFunciones);
    assert.deepEqual(despues.anonFunciones, [], 'ninguna función de public ejecutable por anon');
    assert.deepEqual(despues.authenticated.filter((p) => !antes.authenticated.includes(p)).sort(), [
      'carta_publica.dia_semana select', 'carta_publica.etiqueta select',
      'productos.dia_semana insert', 'productos.dia_semana select', 'productos.dia_semana update',
      'productos.etiqueta insert', 'productos.etiqueta select', 'productos.etiqueta update',
    ], 'el personal ve y edita las columnas nuevas con el GRANT de tabla entera que ya tenía; nada más');
  });

  test('anon: etiqueta y día SOLO de lo visible; la tabla sigue cerrada; la vista no se escribe', () => {
    sale("update public.productos set etiqueta = 'Visible', dia_semana = 3 where id = 'prod_cantarito'; update public.productos set etiqueta = 'SECRETO-FUERA', dia_semana = 2 where id = 'prod_juguito'; update public.productos set etiqueta = 'SECRETO-INACTIVO', dia_semana = 4 where id = 'prod_retirado';", { como: 'migrador' });
    try {
      const visibles = filas('select nombre, etiqueta, dia_semana from public.carta_publica order by nombre', ANON);
      assert.deepEqual(visibles.map((f) => f.nombre), ['Cantarito', 'Picada Resplandor', 'Sancocho trifasico', 'Sopa y carne'], 'ni «Jugo» (fuera de carta) ni «Plato retirado» (inactivo)');
      assert.deepEqual(visibles.find((f) => f.nombre === 'Cantarito'), { nombre: 'Cantarito', etiqueta: 'Visible', dia_semana: 3 });
      assert.equal(JSON.stringify(visibles).includes('SECRETO'), false, 'nada de las filas ocultas, ni en etiqueta ni en día');
      assert.match(falla('select etiqueta from public.productos', ANON), /permission denied for table productos/);
      assert.match(falla('select dia_semana from public.productos', ANON), /permission denied for table productos/);
      assert.match(falla("update public.carta_publica set etiqueta = 'x'", ANON), /permission denied/);
      assert.match(falla("insert into public.carta_publica (categoria, nombre, precio) values ('a', 'b', 1)", ANON), /permission denied/);
      assert.equal(filas('select count(*)::int as n from (select categoria, nombre, precio, descripcion from public.carta_publica) x', ANON)[0].n, 4, 'la consulta de cuatro columnas de la carta de hoy sigue igual');
    } finally {
      sale("update public.productos set etiqueta = null, dia_semana = null where id in ('prod_cantarito', 'prod_juguito', 'prod_retirado')", { como: 'migrador' });
    }
  });

  test('los checks: día 0, 8 y -1 rechazados; 1, 7 y null aceptados; etiqueta de 41, vacía y de espacios rechazadas; de 40 y null aceptadas', () => {
    const intento = (cambio) => sql(`begin; update public.productos set ${cambio} where id = 'prod_cantarito'; rollback;`, { como: 'migrador' });
    for (const malo of ['dia_semana = 0', 'dia_semana = 8', 'dia_semana = -1']) {
      const r = intento(malo);
      assert.equal(r.ok, false, malo);
      assert.match(r.error, /productos_dia_semana_valido/, malo);
    }
    for (const bueno of ['dia_semana = 1', 'dia_semana = 7', 'dia_semana = null']) assert.ok(intento(bueno).ok, bueno);
    const largos = [`etiqueta = '${'e'.repeat(41)}'`, `etiqueta = '${'ñ'.repeat(41)}'`, "etiqueta = ''", "etiqueta = '   '"];
    for (const malo of largos) {
      const r = intento(malo);
      assert.equal(r.ok, false, malo.slice(0, 30));
      assert.match(r.error, /productos_etiqueta_valida/, malo.slice(0, 30));
    }
    for (const bueno of [`etiqueta = '${'e'.repeat(40)}'`, `etiqueta = '${'ñ'.repeat(40)}'`, 'etiqueta = null', "etiqueta = 'Incluye jugo'"]) assert.ok(intento(bueno).ok, bueno.slice(0, 30));
    const dia9 = sql("begin; insert into public.productos (id, categoria, nombre, precio, dia_semana) values ('z', 'Promociones', 'Z', 0, 9); rollback;", { como: 'migrador' });
    assert.match(dia9.error, /productos_dia_semana_valido/, 'también al insertar');
  });

  test('el POS no se entera: select(*) trae las columnas nuevas y su upsert de siete columnas NO las pisa', () => {
    sale("update public.productos set etiqueta = 'Incluye jugo', dia_semana = 5 where id = 'prod_sopacarne'", { como: 'migrador' });
    try {
      assert.deepEqual(filas("select etiqueta, dia_semana from public.productos where id = 'prod_sopacarne'", ADMIN), [{ etiqueta: 'Incluye jugo', dia_semana: 5 }]);
      // formatProducto (pos.html): id, categoria, nombre, precio, descripcion, activo, updated_at → INSERT … ON CONFLICT (id) DO UPDATE SET <esas>.
      sale(`insert into public.productos (id, categoria, nombre, precio, descripcion, activo, updated_at) values ('prod_sopacarne', 'Ejecutivos', 'Sopa y carne', 15000, 'editada en el POS', true, now())
            on conflict (id) do update set categoria = excluded.categoria, nombre = excluded.nombre, precio = excluded.precio, descripcion = excluded.descripcion, activo = excluded.activo, updated_at = excluded.updated_at`, ADMIN);
      assert.deepEqual(filas("select precio, descripcion, etiqueta, dia_semana from public.productos where id = 'prod_sopacarne'", ADMIN), [{ precio: 15000, descripcion: 'editada en el POS', etiqueta: 'Incluye jugo', dia_semana: 5 }]);
      // Un producto nuevo desde el POS: sin etiqueta ni día, y en carta.
      sale("insert into public.productos (id, categoria, nombre, precio, descripcion, activo, updated_at) values ('prod_nuevo_pos', 'Bebidas', 'Nuevo', 5000, '', true, now())", ADMIN);
      assert.deepEqual(filas("select etiqueta, dia_semana, en_carta from public.productos where id = 'prod_nuevo_pos'", ADMIN), [{ etiqueta: null, dia_semana: null, en_carta: true }]);
      // El admin también edita las nuevas desde su sesión.
      sale("update public.productos set etiqueta = 'Ya', dia_semana = 2 where id = 'prod_nuevo_pos'", ADMIN);
      assert.deepEqual(filas("select etiqueta, dia_semana from public.productos where id = 'prod_nuevo_pos'", ADMIN), [{ etiqueta: 'Ya', dia_semana: 2 }]);
    } finally {
      sale("delete from public.productos where id = 'prod_nuevo_pos'; update public.productos set precio = 14000, descripcion = '', etiqueta = null, dia_semana = null where id = 'prod_sopacarne'", { como: 'migrador' });
    }
  });

  test('se puede correr dos veces más y la radiografía no cambia (ni un WARNING)', () => {
    for (let i = 0; i < 2; i += 1) {
      const r = migracion(NOMBRE);
      assert.ok(r.ok, r.error);
      assert.deepEqual(r.avisos, []);
    }
    assert.deepEqual(radiografia(), despues);
  });

  test('sin productos.en_carta la migración se detiene con su mensaje y no cambia nada', () => {
    const texto = "begin; alter table public.productos rename column en_carta to en_carta_x;\n" + SQL + '\nrollback;';
    const e = falla(texto, { como: 'migrador' });
    assert.match(e, /Falta 20260906120000_carta_publica_y_token_mesa\.sql \(productos\.en_carta\)/);
    assert.deepEqual(radiografia(), despues, 'la transacción abortada no dejó nada');
  });

  test('la reversa de la cabecera deja la base EXACTAMENTE como estaba antes (vista, ACL y todo), y se puede volver a aplicar', () => {
    sale("update public.productos set etiqueta = 'Se pierde', dia_semana = 1 where id = 'prod_cantarito'", { como: 'migrador' });
    const r = sql(REVERSA_SQL, { como: 'migrador' });
    assert.ok(r.ok, r.error);
    assert.deepEqual(radiografia(), antes, 'radiografía idéntica a la de antes de la migración');
    assert.equal(filas('select count(*)::int as n from (select categoria, nombre, precio, descripcion from public.carta_publica) x', ANON)[0].n, 4, 'anon lee la carta de hoy');
    assert.match(falla('select etiqueta from public.carta_publica', ANON), /column "?etiqueta"? does not exist/, 'sin la columna: por eso se revierte primero el commit de carta.html');
    // Se puede correr de nuevo sin romper, y la migración vuelve a aplicarse.
    assert.ok(sql(REVERSA_SQL, { como: 'migrador' }).ok, 'la reversa es repetible');
    assert.ok(migracion(NOMBRE).ok);
    assert.deepEqual(radiografia(), despues);
  });
});
