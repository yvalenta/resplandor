// Roles del personal y alertas de «pedir la cuenta» (pedido de Yonatan, 2026-09-30; ola A).
// Lo que se puede verificar SIN red, sin Docker y sin Supabase:
//
//   A. Las TRES migraciones, leídas como texto. Salen al aire por separado, en este orden:
//        a) 20261002120000_personal_y_compuerta.sql  la compuerta de personal: `personal`, mi_correo(),
//           mi_rol(), las RPC de personal, la guardia que impide dejar a todos afuera (antes de tocar
//           una sola policy) y `solo_personal` (restrictiva) en lugar de `solo_google`. NO toca las
//           policies permisivas: el POS de hoy sigue igual para todo el personal de la lista.
//        b) 20261002130000_alertas.sql                las alertas: tabla, índice único, RLS, Realtime,
//           disparadores de cierre y las RPC (alertar_cuenta solo para service_role).
//        c) 20261002140000_permisos_por_rol.sql       las policies por rol, con dos decisiones de Yonatan:
//           el mesero crea y edita productos, y ve las ventas y los cierres en solo lectura.
//      Se revisa su lugar en el orden, que cada una nombre su reversa, los GRANT, el REVOKE de cada
//      función, search_path fijo, y que se puedan volver a correr.
//   B. La Edge Function `alerta`, de dos maneras:
//        · su lógica pura (supabase/functions/alerta/logica.ts) cargada tal cual en Node;
//        · el index.ts REAL corrido de punta a punta con Deno y supabase-js simulados
//          (scripts/pruebas/_funcion-alerta.mjs): CORS, métodos, validación, 400/403/404/409/429,
//          límites por IP y por mesa, y que el token nunca llegue a los logs.
//   C. El contrato entre las dos: nombre y parámetros de la RPC, códigos y métodos.
//   D. Que no haya correos reales en lo que esta ola agrega (el repo es público).
//
// Ronda 2 (refutación 2026-09-30): una venta cerrada solo la toca el admin (A8), mi_rol() sale de la
// identidad de Google y no del correo del JWT (A4), la guardia exige una cuenta de Google real (A5),
// un mesero no renumera mesas (A8), las condiciones de salida al aire quedan escritas (A18, A19) y
// la función no deja que la basura de un celular ahogue a la sala ni que las solicitudes
// simultáneas pasen el límite por mesa (B3, B5i-B5k).
//
// Lo que esta prueba NO puede ver —que cada permiso de la tabla pase o falle de verdad, que haya
// UNA sola alerta pendiente por mesa, las carreras, que la compuerta sola no le cambie nada a quien
// está en la lista, que cada reversa devuelva el estado anterior— lo prueban las sesiones reales
// contra un Postgres 17 desechable (Docker, roles de Supabase simulados); ver el informe de la ola A.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, DIR_FUNCION, SOPORTA_TS, cargarAlerta } from './_funcion-alerta.mjs';

const REL_A = 'supabase/migrations/20261002120000_personal_y_compuerta.sql';
const REL_B = 'supabase/migrations/20261002130000_alertas.sql';
const REL_C = 'supabase/migrations/20261002140000_permisos_por_rol.sql';
const MIGRACIONES_REL = [REL_A, REL_B, REL_C];
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const sinComentarios = (s) => s.replace(/--.*$/gm, '');
const SQL_A = leer(REL_A);
const SQL_B = leer(REL_B);
const SQL_C = leer(REL_C);
const A_SC = sinComentarios(SQL_A);
const B_SC = sinComentarios(SQL_B);
const C_SC = sinComentarios(SQL_C);
const TODO = [SQL_A, SQL_B, SQL_C].join('\n');
const TODO_SC = [A_SC, B_SC, C_SC].join('\n');
const base = leer('supabase/migrations/20260905000000_resplandor_base.sql');
const CAB_A = SQL_A.slice(0, SQL_A.indexOf('-- ── 1. Personal'));
const CAB_B = SQL_B.slice(0, SQL_B.indexOf('-- ── 0. Requisito'));
const CAB_C = SQL_C.slice(0, SQL_C.indexOf('-- ── 0. Requisito'));
// La cabecera en una línea: sin los «-- » del margen y con los espacios colapsados (las frases se parten en renglones).
const plano = (cab) => cab.replace(/^--\s?/gm, '').replace(/\s+/g, ' ');
const CAB_C_P = plano(CAB_C);
// El bloque «--   begin; … --   commit;» de la cabecera que sigue a «REVERSA», sin los guiones.
function reversaDe(sql) {
  const lineas = sql.split('\n');
  const r = lineas.findIndex((l) => l.startsWith('-- REVERSA'));
  const ini = lineas.findIndex((l, i) => i > r && l === '--   begin;');
  const fin = lineas.findIndex((l, i) => i > ini && l === '--   commit;');
  assert.ok(r >= 0 && ini >= 0 && fin > ini, 'no se encontró el bloque de REVERSA (begin … commit) en la cabecera');
  return lineas.slice(ini, fin + 1).map((l) => l.replace(/^--   /, '')).join('\n');
}

// ───────────────────────── A. las tres migraciones ─────────────────────────

test('A1. tres migraciones, en este orden, después de la fase 1 (20261001120000), con fechas únicas; la migración única vieja ya no existe', () => {
  const nombres = fs.readdirSync(path.join(RAIZ, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  const [a, b, c] = MIGRACIONES_REL.map((r) => path.basename(r));
  assert.deepEqual(MIGRACIONES_REL.map((r) => path.basename(r)), ['20261002120000_personal_y_compuerta.sql', '20261002130000_alertas.sql', '20261002140000_permisos_por_rol.sql']);
  assert.ok(a.split('_')[0] > '20261001120000', 'debe ir después de la fase 1 (cuenta en vivo), que vive en otra rama');
  assert.ok(a.split('_')[0] > '20260906120000', 'debe ir después de la carta NFC');
  assert.ok(a < b && b < c, 'orden: compuerta, alertas, permisos por rol');
  assert.deepEqual(nombres.slice(-3), [a, b, c], 'son las tres últimas del directorio, en ese orden');
  assert.ok(!nombres.includes('20261002120000_roles_y_alertas.sql'), 'la migración única vieja se partió en tres: no puede seguir existiendo');
  assert.ok(SQL_A.includes('1 de 3') && SQL_B.includes('2 de 3') && SQL_C.includes('3 de 3'), 'cada cabecera dice qué número de las tres es');
  // cada cabecera nombra a sus hermanas, con el nombre exacto, para que nadie aplique una creyendo que es otra
  for (const sql of [SQL_A, SQL_B, SQL_C]) {
    for (const n of [a, b, c]) assert.ok(sql.includes(n), `la cabecera debe nombrar ${n}`);
  }
});

test('A2. `personal` vive en la compuerta (a): correo en minúsculas como clave, rol admin|mesero, baja lógica, RLS encendida; las alertas, no', () => {
  const tabla = SQL_A.match(/create table if not exists public\.personal \(([\s\S]*?)\n\);/);
  assert.ok(tabla, 'falta create table if not exists public.personal');
  const t = tabla[1];
  for (const col of ['email text not null', 'nombre text not null', 'rol text not null', 'activo boolean not null default true', 'creado_en timestamp with time zone not null default now()']) {
    assert.ok(t.includes(col), `personal: falta la columna «${col}»`);
  }
  assert.match(t, /constraint personal_pkey primary key \(email\)/);
  assert.match(t, /email = lower\(email\)/, 'el correo debe guardarse en minúsculas (check)');
  assert.match(t, /rol = any \(array\['admin'::text, 'mesero'::text\]\)/);
  assert.match(SQL_A, /alter table public\.personal enable row level security/);
  assert.doesNotMatch(A_SC, /alertas/, 'la compuerta no sabe nada de las alertas: es otra migración');
  assert.doesNotMatch(B_SC, /create table[^;]*public\.personal/, 'las alertas no crean personal');
  assert.doesNotMatch(C_SC, /create table/i, 'los permisos por rol no crean tablas');
});

test('A3. `alertas` vive en (b): columnas del contrato, FK a mesas y a ordenes (on delete set null), una sola pendiente por mesa, RLS', () => {
  const tabla = SQL_B.match(/create table if not exists public\.alertas \(([\s\S]*?)\n\);/);
  assert.ok(tabla, 'falta create table if not exists public.alertas');
  const t = tabla[1];
  for (const col of ['id uuid not null default gen_random_uuid()', 'mesa_id integer not null', 'orden_id text', "tipo text not null default 'pedir_cuenta'::text", 'metodo text not null', "estado text not null default 'pendiente'::text", 'creada_en timestamp with time zone not null default now()', 'atendida_en timestamp with time zone', 'atendida_por text']) {
    assert.ok(t.includes(col), `alertas: falta «${col}»`);
  }
  assert.match(t, /foreign key \(mesa_id\) references public\.mesas\(id\)/);
  assert.match(t, /foreign key \(orden_id\) references public\.ordenes\(id\) on delete set null/);
  assert.match(t, /array\['qr'::text, 'transferencia'::text, 'efectivo'::text\]/);
  assert.match(t, /array\['pendiente'::text, 'atendida'::text, 'descartada'::text\]/);
  assert.match(t, /\(\(estado = 'pendiente'::text\) = \(atendida_en is null\)\)/, 'pendiente ⇔ sin resolución');
  assert.match(SQL_B, /create unique index if not exists ux_alertas_una_pendiente_por_mesa\s+on public\.alertas using btree \(mesa_id\) where \(estado = 'pendiente'::text\)/);
  assert.match(SQL_B, /alter table public\.alertas enable row level security/);
  assert.doesNotMatch(A_SC + C_SC, /public\.alertas/, 'ni la compuerta ni los permisos por rol tocan las alertas');
});

test('A4. mi_correo() y mi_rol() (en la compuerta): SECURITY DEFINER, search_path vacío, identidad de Google (no el correo de auth.users), fila activa', () => {
  const c = SQL_A.match(/create or replace function public\.mi_correo\(\)[\s\S]*?\$function\$;/)[0];
  assert.match(c, /security definer/);
  assert.match(c, /set search_path = ''/);
  assert.match(c, /from auth\.identities i/, 'el correo sale de la identidad que asegura Google');
  assert.match(c, /i\.user_id = \(select auth\.uid\(\)\)/, 'de la identidad de QUIEN LLAMA (sub del JWT)');
  assert.match(c, /i\.provider = 'google'/);
  assert.match(c, /'app_metadata' ->> 'provider', ''\) = 'google'/, 'un usuario por correo con el correo de un admin NO puede obtener rol');
  assert.match(c, /lower\(i\.identity_data ->> 'email'\)/, 'en minúsculas');
  assert.doesNotMatch(c.replace(/--.*$/gm, ''), /auth\.jwt\(\)\)? ->> 'email'/, 'NO se fía del correo del JWT (auth.users.email lo puede cambiar el usuario con updateUser)');
  const f = SQL_A.match(/create or replace function public\.mi_rol\(\)[\s\S]*?\$function\$;/)[0];
  assert.match(f, /security definer/);
  assert.match(f, /set search_path = ''/);
  assert.match(f, /where p\.activo/);
  assert.match(f, /p\.email = \(select public\.mi_correo\(\)\)/);
  assert.doesNotMatch(f.replace(/--.*$/gm, ''), /->> 'email'/, 'mi_rol() tampoco lee el correo del JWT');
  assert.match(f, /from public\.personal p/, 'referencias calificadas con esquema (search_path vacío)');
  // en ningún lado de las tres se identifica a nadie por el correo del JWT
  assert.doesNotMatch(TODO_SC, /auth\.jwt\(\)\)? ->> 'email'/, 'una policy o RPC que usa el correo del JWT');
  for (const [nombre, sql] of [['alertas', B_SC], ['permisos por rol', C_SC]]) {
    assert.doesNotMatch(sql, /create or replace function public\.mi_(rol|correo)/, `${nombre}: mi_rol() y mi_correo() se definen UNA vez, en la compuerta`);
  }
});

test('A5. la guardia anti-bloqueo (en la compuerta) va ANTES de tocar una sola policy, exige una cuenta de Google real y el alta inicial viaja en un ajuste de la sesión', () => {
  const guardia = A_SC.indexOf("raise exception 'Sin un admin activo");
  const guardiaGoogle = A_SC.indexOf("raise exception 'Ningún admin activo de public.personal coincide con una cuenta de Google");
  const alta = A_SC.indexOf("current_setting('resplandor.admins_iniciales', true)");
  const primeraPolicy = Math.min(...['drop policy', 'create policy'].map((s) => A_SC.indexOf(s)).filter((i) => i >= 0));
  const primerMiRol = A_SC.indexOf('create or replace function public.mi_rol()');
  assert.ok(alta > 0 && guardia > alta, 'la guardia viene después de leer el alta inicial');
  assert.ok(guardia < primeraPolicy, 'la guardia debe lanzar ANTES de la primera policy');
  assert.ok(guardia < primerMiRol, 'y antes de definir mi_rol()');
  assert.ok(guardiaGoogle > guardia && guardiaGoogle < primeraPolicy, 'la guardia de la cuenta de Google también va antes de la primera policy');
  assert.match(SQL_A, /where p\.rol = 'admin' and p\.activo/);
  assert.match(SQL_A, /marcador <CORREO_ADMIN_n> sin reemplazar/, 'el error dice qué marcador quedó sin reemplazar');
  assert.match(SQL_A, /on conflict \(email\) do update set rol = 'admin', activo = true/);
  // la guardia dura exige la MISMA condición con la que mi_rol() reconocerá al admin
  const g = A_SC.slice(guardia, primeraPolicy);
  assert.match(g, /join auth\.identities i on i\.provider = 'google' and lower\(i\.identity_data ->> 'email'\) = p\.email/);
  assert.match(g, /join auth\.users u on u\.id = i\.user_id/);
  assert.match(g, /coalesce\(u\.raw_app_meta_data ->> 'provider', ''\) = 'google'/, 'lo que luego llevará el JWT en app_metadata.provider');
  assert.match(g, /raise warning 'admin sin cuenta de Google todavía: %/, 'el admin sin cuenta no frena pero se ve');
  // y, si falla, dice qué cuentas de Google sí existen para copiar el correo bien
  assert.match(g, /using hint = 'Cuentas de Google de este proyecto: '/, 'el HINT lista las cuentas de Google que sí existen');
  // el interruptor (solo_personal) es lo ÚLTIMO que hace el archivo: después de todas las funciones y policies de personal
  const ultimaFuncion = A_SC.lastIndexOf('create or replace function');
  const interruptor = A_SC.indexOf('drop policy if exists solo_google');
  assert.ok(interruptor > ultimaFuncion, 'quitar solo_google (lo único que le quita acceso a alguien) va después de definir TODAS las funciones');
  const despuesDelInterruptor = A_SC.slice(interruptor);
  assert.doesNotMatch(despuesDelInterruptor, /create or replace function|create table|grant |revoke /, 'tras el interruptor solo van policies');
});

test('A6. la compuerta NO toca las policies permisivas; los permisos por rol (c) sí las reemplazan, y la de alertas solo agrega la suya', () => {
  // (a) no toca ninguna permisiva de la base: ni la borra ni crea otra que no sea la de `personal`
  for (const vieja of ['authenticated full access productos', 'authenticated full access mesas', 'authenticated full access ordenes', 'authenticated full access cierres']) {
    assert.ok(!A_SC.includes(vieja), `la compuerta no debe tocar «${vieja}»`);
  }
  for (const vieja of ['menus_admin', 'sug_admin', 'menus_select_publico', 'elec_select_publico', 'reacc_select_publico']) {
    assert.ok(!A_SC.includes(vieja), `la compuerta no debe tocar ${vieja}`);
  }
  const creadasA = [...A_SC.matchAll(/create policy (\w+) on ([\w.%]+)/g)].map((m) => `${m[1]} en ${m[2]}`).sort();
  assert.deepEqual(creadasA, ['personal_ver en public.personal', 'solo_personal en public.%I', 'solo_personal_delete en public.menus', 'solo_personal_insert en public.menus', 'solo_personal_update en public.menus'], 'las únicas policies que crea la compuerta');
  assert.doesNotMatch(A_SC, /create policy[^;]*\bas permissive\b/i);
  // (c) borra las seis permisivas y crea las de rol
  for (const vieja of ['authenticated full access productos', 'authenticated full access mesas', 'authenticated full access ordenes', 'authenticated full access cierres']) {
    assert.ok(C_SC.includes(`drop policy if exists "${vieja}"`), `no se borra «${vieja}»`);
  }
  for (const vieja of ['menus_admin', 'sug_admin']) assert.ok(C_SC.includes(`drop policy if exists ${vieja} on`), `no se borra ${vieja}`);
  const esperadas = {
    productos: ['productos_ver', 'productos_crear', 'productos_editar', 'productos_borrar'],
    mesas: ['mesas_ver', 'mesas_crear', 'mesas_editar'],
    ordenes: ['ordenes_ver', 'ordenes_crear', 'ordenes_editar', 'ordenes_borrar'],
    cierres: ['cierres_ver', 'cierres_crear', 'cierres_editar'],
    menus: ['menus_crear', 'menus_editar', 'menus_borrar'],
    sugerencias_plato: ['sugerencias_ver_admin'],
  };
  for (const [tabla, nombres] of Object.entries(esperadas)) {
    for (const n of nombres) assert.match(C_SC, new RegExp(`create policy ${n} on public\\.${tabla} for \\w+ to authenticated`), `falta la policy ${n}`);
  }
  assert.match(SQL_A, /create policy personal_ver on public\.personal for select to authenticated/);
  assert.match(SQL_B, /create policy alertas_ver on public\.alertas for select to authenticated/);
  // Ninguna permisiva abierta en lo que se agrega: el acceso lo da siempre mi_rol().
  assert.doesNotMatch(TODO_SC, /using\s*\(\s*true\s*\)/i, 'una policy con using (true)');
  assert.doesNotMatch(TODO_SC, /with check\s*\(\s*true\s*\)/i, 'una policy con with check (true)');
  // Nada para anon en lo que estas migraciones crean.
  assert.doesNotMatch(TODO_SC, /create policy [^;]*\bto\b[^;]*\banon\b/i, 'una policy nueva para anon');
});

test('A7. `solo_personal` (restrictiva) reemplaza a `solo_google`: Google Y mi_rol() en 6 tablas (+ alertas en (b)); `menus` solo en escrituras', () => {
  const bloque = A_SC.match(/foreach t in array array\[([^\]]*)\] loop[\s\S]*?end loop;/);
  assert.ok(bloque, 'falta el bucle de solo_personal');
  const tablas = [...bloque[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(tablas, ['cierres', 'mesas', 'ordenes', 'personal', 'productos', 'sugerencias_plato'], 'las tablas que hoy llevan solo_google, menos menus, más personal');
  assert.match(bloque[0], /drop policy if exists solo_google on public\.%I/, 'solo_google se va de cada una');
  assert.match(bloque[0], /create policy solo_personal on public\.%I as restrictive for all to authenticated/);
  assert.match(bloque[0], /''provider''\) = ''google'' and \(select public\.mi_rol\(\)\) is not null/);
  // las tablas con solo_google en la base: las mismas, con menus
  const deBase = [...base.match(/foreach t in array array\[([^\]]*)\] loop/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...tablas.filter((t) => t !== 'personal'), 'menus'].sort(), deBase, 'solo_personal cubre EXACTAMENTE las tablas que cubría solo_google');
  // menus: lectura pública; la compuerta cubre solo escribir (insert, update, delete), con tres restrictivas
  assert.ok(A_SC.includes('drop policy if exists solo_google on public.menus;'), 'menus deja de llevar solo_google');
  for (const [n, cmd] of [['solo_personal_insert', 'insert'], ['solo_personal_update', 'update'], ['solo_personal_delete', 'delete']]) {
    const p = A_SC.match(new RegExp(`create policy ${n} on public\\.menus as restrictive for ${cmd} to authenticated[\\s\\S]*?;`))?.[0];
    assert.ok(p, `falta ${n}`);
    assert.match(p, /'provider'\) = 'google' and \(select public\.mi_rol\(\)\) is not null/, `${n}: Google y mi_rol()`);
  }
  assert.doesNotMatch(A_SC, /create policy \w+ on public\.menus as restrictive for (all|select)/, 'ninguna restrictiva «for all» ni «for select» en menus: su lectura es pública');
  // alertas, en (b): la misma compuerta
  assert.match(B_SC, /create policy solo_personal on public\.alertas as restrictive for all to authenticated[\s\S]*?mi_rol\(\)\) is not null[\s\S]*?with check[\s\S]*?mi_rol\(\)\) is not null/);
  assert.ok(B_SC.includes('drop policy if exists solo_personal on public.alertas'));
  // (c) no cambia la compuerta
  assert.doesNotMatch(C_SC, /solo_personal|solo_google/, 'los permisos por rol no tocan la compuerta');
});

test('A8. permisos por rol (c) y las DOS DECISIONES de Yonatan: el mesero crea y edita productos y ve ventas y cierres en solo lectura', () => {
  const pol = (n) => C_SC.match(new RegExp(`create policy ${n} on public\\.\\w+[\\s\\S]*?;`))[0];
  // decisión 1: productos. El mesero crea y edita (también el upsert del POS = INSERT + UPDATE); borrar es del admin
  for (const n of ['productos_crear', 'productos_editar']) {
    assert.match(pol(n), /mi_rol\(\)\) in \('admin', 'mesero'\)/, `${n}: admin y mesero (decisión de Yonatan)`);
  }
  assert.match(pol('productos_editar'), /using \(\(select public\.mi_rol\(\)\) in \('admin', 'mesero'\)\)\s+with check \(\(select public\.mi_rol\(\)\) in \('admin', 'mesero'\)\)/, 'el UPDATE exige el rol en USING y en WITH CHECK');
  assert.match(pol('productos_borrar'), /mi_rol\(\)\) = 'admin'/, 'borrar un producto sigue siendo solo del admin');
  assert.doesNotMatch(pol('productos_borrar'), /'mesero'/);
  // decisión 2: cierres. Ver, todo el personal (solo lectura); escribir, solo admin; no hay policy de DELETE
  assert.match(pol('cierres_ver'), /mi_rol\(\)\) is not null/, 'el mesero ve el historial de cierres');
  for (const n of ['cierres_crear', 'cierres_editar']) {
    assert.match(pol(n), /mi_rol\(\)\) = 'admin'/, `${n}: solo admin (el cierre del día lo hace el admin; caja = admin)`);
    assert.doesNotMatch(pol(n), /'mesero'/, `${n}: el mesero no figura`);
  }
  assert.doesNotMatch(C_SC, /create policy \w+ on public\.cierres for (delete|all)/, 'cierres: sin policy de DELETE (sin GRANT, como hoy)');
  assert.match(pol('ordenes_ver'), /mi_rol\(\)\) is not null/, 'las ventas del día (órdenes cerradas) las ve todo el personal');
  assert.doesNotMatch(pol('ordenes_ver'), /estado/, 'sin filtro por estado: el mesero ve también las cerradas');
  // lo demás: menús y sugerencias son del admin
  for (const n of ['menus_crear', 'menus_editar', 'menus_borrar', 'sugerencias_ver_admin']) {
    assert.match(pol(n), /mi_rol\(\)\) = 'admin'/, `${n}: solo admin`);
    assert.doesNotMatch(pol(n), /'mesero'/, `${n}: el mesero no figura`);
  }
  for (const n of ['productos_ver', 'mesas_ver', 'mesas_editar', 'ordenes_ver', 'ordenes_crear', 'cierres_ver']) {
    assert.match(pol(n), /mi_rol\(\)\) is not null/, `${n}: todo el personal`);
  }
  // una venta CERRADA solo la toca el admin: el mesero edita (y cierra) órdenes ABIERTAS (hallazgo 1)
  const editar = pol('ordenes_editar');
  assert.match(editar, /using \(\s*\(select public\.mi_rol\(\)\) = 'admin'\s+or \(\(select public\.mi_rol\(\)\) = 'mesero' and estado = 'abierta'\)\s*\)/, 'USING mira la fila VIEJA: el mesero solo edita abiertas');
  assert.match(editar, /with check \(\(select public\.mi_rol\(\)\) is not null\)/, 'cobrar (abierta → cerrada) sigue pasando el WITH CHECK');
  const borrar = pol('ordenes_borrar');
  assert.match(borrar, /\(select public\.mi_rol\(\)\) = 'admin'\s+or \(\(select public\.mi_rol\(\)\) = 'mesero' and estado = 'abierta' and items = '\[\]'::jsonb\)/);
  // el INSERT del mesero en mesas pasa solo si el id ya existe (el POS guarda con upsert)
  assert.match(pol('mesas_crear'), /'admin'[\s\S]*'mesero' and public\.mesa_existe\(id\)/);
  const f = SQL_C.match(/create or replace function public\.mesa_existe\(p_id integer\)[\s\S]*?\$function\$;/)[0];
  assert.match(f, /security definer/);
  assert.match(f, /set search_path = ''/);
  assert.match(f, /public\.mi_rol\(\) is not null/);
  // el personal solo se ve (admin todo; cada quien su fila) y las alertas solo se ven: no hay policies de escritura
  for (const tabla of ['personal', 'alertas']) {
    assert.doesNotMatch(TODO_SC, new RegExp(`create policy \\w+ on public\\.${tabla} for (insert|update|delete|all)`), `${tabla}: sin policies de escritura`);
  }
  assert.match(sinComentarios(SQL_A).match(/create policy personal_ver on public\.personal[\s\S]*?;/)[0], /mi_rol\(\)\) = 'admin'[\s\S]*email = \(select public\.mi_correo\(\)\)/, 'su propia fila, por la identidad de Google y no por el correo del JWT');
  // renumerar una mesa (UPDATE de id) es crear una mesa por la puerta de atrás: solo el admin (hallazgo 5)
  const trg = SQL_C.match(/create or replace function public\.mesas_id_solo_admin\(\)[\s\S]*?\$function\$;/)[0];
  assert.match(trg, /current_user in \('anon', 'authenticated'\)/, 'service_role y el dueño no son sesiones de la API');
  assert.match(trg, /\(select public\.mi_rol\(\)\) is distinct from 'admin'/);
  assert.match(trg, /errcode = '42501'/);
  assert.doesNotMatch(trg, /security definer/, 'current_user tiene que ser quien llama');
  assert.match(SQL_C, /create trigger trg_mesas_id_solo_admin\s+before update of id on public\.mesas\s+for each row\s+when \(old\.id is distinct from new\.id\)\s+execute function public\.mesas_id_solo_admin\(\)/);
  // la cabecera de (c) documenta las dos decisiones, marcadas, y qué sigue siendo del admin
  assert.match(CAB_C, /★ 1\. El mesero SÍ crea y edita productos/);
  assert.match(CAB_C, /★ 2\. El mesero VE las ventas del día/);
  assert.match(CAB_C_P, /Escribir en `cierres` \(el cierre del día, y editar o reabrir uno pasado\) es solo del admin/);
  assert.match(CAB_C, /productos   crear\/editar     \|  sí   \|  sí ★/);
  assert.match(CAB_C, /cierres     ver              \|  sí   \|  sí ★ \(solo lectura\)/);
  assert.match(CAB_C, /«Caja» por ahora = admin/);
});

test('A9. GRANT mínimos: nada para anon; authenticated solo lee personal y alertas; service_role escribe alertas y no ve personal', () => {
  assert.match(A_SC, /revoke all on public\.personal from anon, authenticated, service_role;/);
  assert.match(A_SC, /grant select on public\.personal to authenticated;/);
  assert.match(B_SC, /revoke all on public\.alertas from anon, authenticated, service_role;/);
  assert.match(B_SC, /grant select on public\.alertas to authenticated;/);
  assert.match(B_SC, /grant select, insert, update on public\.alertas to service_role;/);
  assert.doesNotMatch(C_SC, /\bgrant\b[^;]*\bon public\.\w+\s+to/i, 'los permisos por rol no cambian los GRANT de las tablas: solo las policies');
  // ningún `grant` menciona a anon, ni a PUBLIC
  for (const g of TODO_SC.match(/\bgrant\b[^;]*;/gi) || []) {
    assert.doesNotMatch(g, /\banon\b|\bpublic\b(?!\.)\s*;?$/i, `grant a anon/public: ${g}`);
    assert.doesNotMatch(g, /\b(update|delete|insert)\b[^;]*\bon public\.personal\b/i, `escritura directa sobre personal: ${g}`);
  }
  assert.doesNotMatch(TODO_SC, /grant[^;]*public\.personal[^;]*service_role/i, 'service_role no necesita personal');
});

function funcionesCreadas(sql) {
  const out = [];
  const re = /create or replace function (public\.\w+)\(([^)]*)\)([\s\S]*?)\$function\$;/g;
  let m;
  while ((m = re.exec(sql))) {
    const tipos = m[2].split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s+/).slice(1).join(' '));
    out.push({ nombre: m[1], tipos, cuerpo: m[0] });
  }
  return out;
}
const fn = (sql, nombre) => funcionesCreadas(sql).find((x) => x.nombre === `public.${nombre}`);

test('A10. cada migración crea SUS funciones; toda SECURITY DEFINER fija search_path y toda función creada tiene su REVOKE a public y anon', () => {
  const nombres = (sql) => funcionesCreadas(sql).map((f) => f.nombre.replace('public.', '')).sort();
  assert.deepEqual(nombres(SQL_A), ['mi_correo', 'mi_rol', 'personal_alta', 'personal_baja', 'personal_cambiar_rol']);
  assert.deepEqual(nombres(SQL_B), ['alertar_cuenta', 'atender_alerta', 'descartar_alerta', 'resolver_alerta', 'resolver_alertas_de_mesa']);
  assert.deepEqual(nombres(SQL_C), ['mesa_existe', 'mesas_id_solo_admin']);
  for (const [sql, sc] of [[SQL_A, A_SC], [SQL_B, B_SC], [SQL_C, C_SC]]) {
    for (const f of funcionesCreadas(sql)) {
      if (/security definer/.test(f.cuerpo)) assert.match(f.cuerpo, /set search_path = ''/, `${f.nombre}: SECURITY DEFINER sin search_path vacío`);
      const firma = `${f.nombre.replace('.', '\\.')}\\(${f.tipos.join(',\\s*')}\\)`;
      assert.match(sc, new RegExp(`revoke all on function ${firma} from public, anon`), `${f.nombre}: falta el REVOKE de public y anon`);
    }
  }
  // las internas y la de la Edge Function no las ejecuta ninguna sesión de la API
  for (const interna of ['resolver_alerta\\(uuid, text\\)', 'alertar_cuenta\\(integer, text, text\\)', 'resolver_alertas_de_mesa\\(\\)']) {
    assert.match(B_SC, new RegExp(`revoke all on function public\\.${interna} from public, anon, authenticated`), `${interna} debe negarse también a authenticated`);
  }
  assert.match(C_SC, /revoke all on function public\.mesas_id_solo_admin\(\) from public, anon, authenticated/);
  // quién SÍ ejecuta
  assert.match(B_SC, /grant execute on function public\.alertar_cuenta\(integer, text, text\) to service_role;/);
  assert.doesNotMatch(TODO_SC, /grant execute on function public\.alertar_cuenta[^;]*authenticated/);
  for (const n of ['personal_alta\\(text, text, text\\)', 'personal_baja\\(text\\)', 'personal_cambiar_rol\\(text, text\\)', 'mi_rol\\(\\)', 'mi_correo\\(\\)']) {
    assert.match(A_SC, new RegExp(`grant execute on function public\\.${n} to authenticated`), `${n}: falta el EXECUTE para authenticated`);
  }
  for (const n of ['atender_alerta\\(uuid\\)', 'descartar_alerta\\(uuid\\)']) assert.match(B_SC, new RegExp(`grant execute on function public\\.${n} to authenticated`));
  assert.match(C_SC, /grant execute on function public\.mesa_existe\(integer\) to authenticated/);
});

test('A11. personal_* (en la compuerta): solo admin, candado de transacción con REVISIÓN del rol después, último admin protegido', () => {
  for (const nombre of ['personal_alta', 'personal_baja', 'personal_cambiar_rol']) {
    const f = fn(SQL_A, nombre).cuerpo;
    assert.match(f, /pg_advisory_xact_lock\(hashtext\('resplandor\.personal'\)\)/, `${nombre}: sin candado`);
    const revisiones = f.match(/\(select public\.mi_rol\(\)\) is distinct from 'admin'/g) || [];
    assert.ok(revisiones.length >= 2, `${nombre}: debe revisar el rol antes Y después del candado`);
    assert.ok(f.lastIndexOf("is distinct from 'admin'") > f.indexOf('pg_advisory_xact_lock'), `${nombre}: la última revisión va después del candado`);
    assert.match(f, /'no_autorizado'/);
  }
  for (const nombre of ['personal_baja', 'personal_cambiar_rol']) {
    const f = fn(SQL_A, nombre).cuerpo;
    assert.match(f, /count\(\*\) from public\.personal where rol = 'admin' and activo\) <= 1/, `${nombre}: no protege al último admin`);
    assert.match(f, /'ultimo_admin'/);
  }
  assert.match(fn(SQL_A, 'personal_baja').cuerpo, /update public\.personal set activo = false/, 'la baja es lógica: nunca delete');
  assert.doesNotMatch(TODO_SC, /delete from public\.personal/);
});

test('A12. alertar_cuenta (en alertas): valida el par (mesa, token), exige orden abierta, bloquea la orden y deja UNA pendiente por mesa (upsert atómico)', () => {
  const f = fn(SQL_B, 'alertar_cuenta');
  assert.deepEqual(f.tipos, ['integer', 'text', 'text']);
  assert.doesNotMatch(f.cuerpo, /security definer/, 'corre como quien llama (service_role), no como dueño');
  assert.match(f.cuerpo, /m\.id = p_mesa and m\.token = p_token/);
  assert.match(f.cuerpo, /o\.estado = 'abierta'[\s\S]*for share/, 'FOR SHARE sobre la orden: el cierre espera a la alerta');
  assert.match(f.cuerpo, /on conflict \(mesa_id\) where \(estado = 'pendiente'\)\s+do update set metodo = excluded\.metodo, orden_id = excluded\.orden_id, creada_en = now\(\)/);
  // el orden de las validaciones fija qué error gana
  const i = (s) => f.cuerpo.indexOf(s);
  assert.ok(i("'metodo_invalido'") < i("'enlace_invalido'") && i("'enlace_invalido'") < i("'sin_cuenta'"));
});

test('A13. atender y descartar (en alertas): solo personal, solo una pendiente, y registran quién y cuándo', () => {
  const f = fn(SQL_B, 'resolver_alerta').cuerpo;
  assert.match(f, /\(select public\.mi_rol\(\)\) is null[\s\S]*'no_autorizado'/);
  assert.match(f, /and estado = 'pendiente'/);
  assert.match(f, /atendida_en = now\(\)/);
  assert.match(f, /atendida_por = \(select public\.mi_correo\(\)\)/, 'quién atendió sale de la identidad de Google, no del correo del JWT');
  assert.match(f, /'no_existe'/);
  assert.match(f, /'no_pendiente'/);
  assert.match(SQL_B, /select public\.resolver_alerta\(p_id, 'atendida'\)/);
  assert.match(SQL_B, /select public\.resolver_alerta\(p_id, 'descartada'\)/);
});

test('A14. cerrar la mesa atiende la alerta pendiente; liberar una mesa vacía la descarta (disparadores sobre ordenes, en alertas)', () => {
  assert.match(SQL_B, /after update of estado on public\.ordenes[\s\S]*?when \(old\.estado = 'abierta' and new\.estado = 'cerrada'\)/);
  assert.match(SQL_B, /after delete on public\.ordenes[\s\S]*?when \(old\.estado = 'abierta'\)/);
  const f = fn(SQL_B, 'resolver_alertas_de_mesa').cuerpo;
  assert.match(f, /case when tg_op = 'DELETE' then 'descartada' else 'atendida' end/);
  assert.match(f, /coalesce\(\(select public\.mi_correo\(\)\), 'sistema'\)/);
  assert.match(f, /where mesa_id = old\.mesa_id\s+and estado = 'pendiente'/);
  assert.doesNotMatch(A_SC + C_SC, /trg_ordenes_/, 'ni la compuerta ni los permisos por rol ponen disparadores sobre ordenes');
});

test('A15. Realtime: alertas entra a supabase_realtime (una sola vez) y la RLS decide quién la recibe', () => {
  assert.match(SQL_B, /alter publication supabase_realtime add table public\.alertas/);
  assert.match(SQL_B, /if not exists \([\s\S]*?pg_publication_tables[\s\S]*?tablename = 'alertas'/, 'sin la guarda, volver a correr falla');
  assert.doesNotMatch(A_SC + C_SC, /supabase_realtime/, 'la compuerta no toca Realtime');
});

test('A16. cada una se puede volver a correr: tablas e índices con IF NOT EXISTS, funciones con OR REPLACE, cada policy y trigger se borra antes de crearse', () => {
  for (const [nombre, sc] of [['compuerta', A_SC], ['alertas', B_SC], ['permisos por rol', C_SC]]) {
    assert.doesNotMatch(sc, /create table (?!if not exists)/i, `${nombre}: create table sin if not exists`);
    assert.doesNotMatch(sc, /create (unique )?index (?!if not exists)/i, `${nombre}: create index sin if not exists`);
    assert.doesNotMatch(sc, /create function/i, `${nombre}: create function sin or replace`);
    for (const m of sc.matchAll(/create policy (\w+) on (public\.\w+)/g)) {
      assert.ok(sc.includes(`drop policy if exists ${m[1]} on ${m[2]}`), `${nombre}: la policy ${m[1]} no se borra antes de crearse`);
    }
    for (const m of sc.matchAll(/create trigger (\w+)/g)) {
      assert.ok(sc.includes(`drop trigger if exists ${m[1]} on`), `${nombre}: el trigger ${m[1]} no se borra antes de crearse`);
    }
  }
  assert.match(A_SC, /execute format\('drop policy if exists solo_personal on public\.%I', t\);/);
  assert.match(A_SC, /execute format\('drop policy if exists solo_google on public\.%I', t\);/);
  // (b) y (c) se niegan a correr, ANTES de cualquier cambio, si falta la compuerta
  for (const [nombre, sc] of [['alertas', B_SC], ['permisos por rol', C_SC]]) {
    const guarda = sc.indexOf("to_regprocedure('public.mi_rol()') is null");
    const primerCambio = Math.min(...['create table', 'create or replace', 'drop policy', 'drop trigger', 'create policy', 'create trigger', 'alter ', 'revoke', 'grant '].map((s) => sc.indexOf(s)).filter((i) => i >= 0));
    assert.ok(guarda > 0 && guarda < primerCambio, `${nombre}: el requisito (mi_rol() existe) se comprueba antes de cambiar nada`);
    assert.match(sc, /raise exception 'Falta 20261002120000_personal_y_compuerta\.sql/, `${nombre}: el error dice qué aplicar primero`);
  }
  assert.match(B_SC, /to_regclass\('public\.personal'\) is null[\s\S]*to_regprocedure\('public\.mi_correo\(\)'\) is null/);
  assert.doesNotMatch(C_SC, /to_regclass\('public\.alertas'\)/, 'los permisos por rol no necesitan las alertas');
});

test('A17. el orden seguro está escrito en la cabecera de la compuerta y ninguna de las tres trae un correo ni un marcador activo', () => {
  assert.match(CAB_A, /ORDEN SEGURO/);
  assert.match(CAB_A, /resplandor\.admins_iniciales/);
  assert.match(CAB_A, /UNA transacción|UNA sola vez/);
  assert.match(CAB_A, /compuerta-al-aire\.sql/, 'nombra el SQL aparte que arma Yonatan');
  assert.match(CAB_C, /Caja» por ahora = admin/);
  // el valor del ajuste no está en ningún archivo: la migración solo lo LEE
  assert.doesNotMatch(TODO_SC, /set_config\(/);
  // ningún alta escrita a mano
  assert.doesNotMatch(TODO_SC, /insert into public\.personal[^;]*values\s*\(\s*'/i, 'un INSERT con un correo escrito en una migración');
});

test('A18. la compuerta deja escritas las condiciones de salida: alta de TODO el personal en la misma transacción, «sin acceso», cómo comprobar y publicar el OAuth DESPUÉS; los permisos por rol, qué ocultar al mesero', () => {
  assert.match(CAB_A, /CONDICIONES DE SALIDA AL AIRE/);
  // la compuerta
  assert.match(CAB_A, /MISMA transacción, no después/);
  assert.match(CAB_A, /Dar de alta a TODOS los que hoy entran/);
  assert.match(CAB_A, /«sin acceso»/);
  assert.match(CAB_A, /mi_rol\(\) al arrancar/);
  assert.match(CAB_A, /flushDeltas/, 'la cola de deltas trabada por una orden que no existe');
  assert.match(CAB_A, /auth\.identities/);
  assert.match(CAB_A, /fuera del horario de servicio|FUERA del horario de servicio/i);
  assert.match(CAB_A, /createClient\(SUPABASE_URL, SUPABASE_KEY\)\.rpc\('mi_rol'\)/, '`supabaseClient` es privado de pos.html: la comprobación usa un cliente aparte');
  assert.doesNotMatch(CAB_A, /await supabaseClient\.rpc/, 'supabaseClient no es accesible desde la consola');
  assert.match(CAB_A, /Publish app/, 'publicar el OAuth va DESPUÉS de la compuerta');
  assert.match(CAB_A, /REVERSA/);
  assert.match(CAB_A, /no es condición|«Confirm email»/);
  // los permisos por rol: qué ocultar al mesero, con su lugar en pos.html (hallazgo 3), y que la base lo rechaza en silencio
  assert.match(CAB_C_P, /DESPUÉS de publicar el POS/);
  assert.match(CAB_C_P, /en SILENCIO/);
  for (const lugar of ['historial de cierres', '«Editar», «Reabrir» y «Eliminar»', '3825', '3829', '4337', 'recalcularYSubirCierre', 'eliminarProducto', 'cierre del día', 'menú semanal', '«Editar» (3739)', '«Reabrir» (2689)']) {
    assert.ok(CAB_C_P.includes(lugar), `la cabecera de permisos por rol no menciona «${lugar}»`);
  }
  assert.match(CAB_C_P, /misma venta queda en el cierre viejo y en `ordenes`/, 'el «Reabrir en mesa» que duplica ventas');
  // con la decisión 1, del catálogo SOLO se oculta eliminar; con la 2, el historial de cierres se VE
  assert.match(CAB_C_P, /catálogo: SOLO el botón de eliminar/);
  assert.match(CAB_C_P, /se VE en solo lectura/);
  assert.match(CAB_C_P, /Crear y editar productos el mesero SÍ los puede/);
  assert.doesNotMatch(CAB_C_P, /crear, editar y eliminar productos/, 'ya no se le oculta al mesero crear ni editar productos');
});

test('A19. la comprobación de la cabecera sirve en pos.html: SUPABASE_URL/KEY son globales de la página y `supabaseClient` NO (vive dentro de alpine:init)', () => {
  const pos = leer('pos.html');
  const alpine = pos.indexOf("document.addEventListener('alpine:init'");
  const url = pos.indexOf('const SUPABASE_URL =');
  const clave = pos.indexOf('const SUPABASE_KEY =');
  const cliente = pos.indexOf('const supabaseClient =');
  assert.ok(alpine > 0 && url > 0 && clave > 0 && cliente > 0, 'pos.html cambió: revisar la comprobación de la cabecera de la migración');
  assert.ok(url < alpine && clave < alpine, 'SUPABASE_URL y SUPABASE_KEY se declaran antes (y fuera) de alpine:init: son globales de la consola');
  assert.ok(cliente > alpine, '`supabaseClient` se declara DENTRO de alpine:init: la consola no lo ve');
});

test('A20. cada migración trae su REVERSA (begin … commit) y la de la compuerta vuelve a `solo_google` EXACTAMENTE como está en la base', () => {
  const ra = reversaDe(SQL_A);
  const rb = reversaDe(SQL_B);
  const rc = reversaDe(SQL_C);
  // (a): recrea solo_google con el texto de la base y quita solo_personal de todas
  const tablasRev = [...ra.match(/foreach t in array array\[([^\]]*)\] loop\n\s+execute format\('drop policy if exists solo_google/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  const tablasBase = [...base.match(/foreach t in array array\[([^\]]*)\] loop/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(tablasRev, tablasBase, 'la reversa recrea solo_google en las mismas 6 tablas que la base');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  for (const expr of ["using ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'')", "with check ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'')"]) {
    assert.ok(norm(base).includes(norm(expr)), 'la expresión existe tal cual en la base');
    assert.ok(norm(ra).includes(norm(expr)), `la reversa usa la misma expresión que la base: ${expr}`);
  }
  assert.match(ra, /create policy solo_google on public\.%I as restrictive for all to authenticated/);
  for (const n of ['solo_personal_insert', 'solo_personal_update', 'solo_personal_delete']) assert.ok(ra.includes(`drop policy if exists ${n} on public.menus`), `la reversa quita ${n}`);
  assert.match(ra, /drop policy if exists solo_personal on public\.%I/);
  assert.doesNotMatch(ra, /authenticated full access|menus_admin|sug_admin/, 'la reversa de la compuerta no toca las permisivas: nunca se tocaron');
  // (b): quita todo lo suyo
  for (const s of ['drop trigger if exists trg_ordenes_cierre_resuelve_alertas', 'drop trigger if exists trg_ordenes_borrada_resuelve_alertas', 'alter publication supabase_realtime drop table public.alertas', 'drop table public.alertas', 'public.alertar_cuenta(integer, text, text)', 'public.resolver_alertas_de_mesa()']) {
    assert.ok(rb.includes(s), `la reversa de alertas: falta «${s}»`);
  }
  // (c): vuelve a las seis permisivas de la base, con los mismos nombres y definición, y quita lo suyo
  const deBaseAbiertas = [...base.matchAll(/create policy ("authenticated full access \w+"|"menus_admin"|"sug_admin") on (public\.\w+) for all to authenticated using \(true\) with check \(true\);/g)];
  assert.equal(deBaseAbiertas.length, 6, 'la base trae seis permisivas «for all … using (true)»');
  for (const m of deBaseAbiertas) {
    const nombre = m[1].includes(' ') ? m[1] : m[1].replaceAll('"', '');
    assert.ok(rc.includes(`create policy ${nombre} on ${m[2]} for all to authenticated using (true) with check (true);`), `la reversa de permisos por rol recrea ${nombre}`);
  }
  assert.equal((rc.match(/for all to authenticated using \(true\) with check \(true\)/g) || []).length, 6);
  for (const n of ['productos_crear', 'productos_editar', 'cierres_crear', 'cierres_editar', 'ordenes_editar', 'mesas_crear', 'menus_crear', 'sugerencias_ver_admin']) assert.ok(rc.includes(`'${n}'`), `la reversa de permisos por rol quita ${n}`);
  assert.ok(rc.includes('drop trigger if exists trg_mesas_id_solo_admin on public.mesas'));
  assert.doesNotMatch(rc, /solo_personal|solo_google/, 'la reversa de permisos por rol deja la compuerta en pie');
  // las tres son una transacción
  for (const r of [ra, rb, rc]) assert.ok(r.startsWith('begin;') && r.endsWith('commit;'));
});

test('A21. ninguna otra cosa del repo sigue apuntando a la migración única vieja', () => {
  for (const rel of ['supabase/functions/alerta/index.ts', 'supabase/functions/alerta/logica.ts', 'scripts/pruebas/_funcion-alerta.mjs']) {
    assert.doesNotMatch(leer(rel), /roles_y_alertas/, `${rel} todavía nombra 20261002120000_roles_y_alertas.sql`);
  }
  assert.match(leer('supabase/functions/alerta/index.ts'), /supabase\/migrations\/20261002130000_alertas\.sql/, 'la función dice que public.alertar_cuenta sale de la migración de alertas');
});

// ───────────────────────── B. la Edge Function `alerta` ─────────────────────────

const LOGICA = SOPORTA_TS ? await import(path.join(DIR_FUNCION, 'logica.ts')) : null;
const sinTs = SOPORTA_TS ? false : 'Node sin soporte de .ts (hace falta >= 22.18 y registerHooks)';

test('B0. logica.ts es pura (sin imports) y index.ts la usa; Deno.serve, solo POST, sin Allow-Origin comodín', () => {
  const logica = fs.readFileSync(path.join(DIR_FUNCION, 'logica.ts'), 'utf8');
  const index = fs.readFileSync(path.join(DIR_FUNCION, 'index.ts'), 'utf8');
  assert.doesNotMatch(logica.replace(/\/\/.*$/gm, ''), /^\s*import\s/m, 'logica.ts no debe importar nada (la prueba la carga en Node)');
  assert.doesNotMatch(logica.replace(/\/\/.*$/gm, ''), /\benum\b|\bnamespace\b|constructor\s*\(\s*(public|private)/, 'sintaxis que Node no borra');
  assert.match(index, /from "\.\/logica\.ts"/);
  assert.match(index, /Deno\.serve\(/);
  assert.match(index, /req\.method !== "POST"/);
  assert.doesNotMatch(index + logica, /Allow-Origin["']?\s*:\s*["']\*["']/, 'CORS comodín');
  assert.match(index, /--no-verify-jwt/, 'el encabezado dice cómo desplegar');
  assert.doesNotMatch(index.replace(/\/\/.*$/gm, ''), /console\.(log|error|warn)\([^)]*\bk\b[^)]*\)/, 'el token no va a los logs');
});

test('B1. leerSolicitud valida { m, k, metodo }: formatos, tipos y tamaño', { skip: sinTs }, () => {
  const { leerSolicitud, METODOS } = LOGICA;
  const K = 'ab'.repeat(24);
  const bien = (m, metodo = 'qr', k = K) => JSON.stringify({ m, k, metodo });
  assert.deepEqual(leerSolicitud(bien('3')), { ok: true, solicitud: { m: 3, k: K, metodo: 'qr' } });
  assert.deepEqual(leerSolicitud(bien(3, 'efectivo')).solicitud, { m: 3, k: K, metodo: 'efectivo' }, 'm numérico también');
  for (const metodo of METODOS) assert.equal(leerSolicitud(bien(1, metodo)).ok, true, metodo);
  assert.equal(leerSolicitud(bien(1, 'tarjeta')).codigo, 'metodo_invalido');
  assert.equal(leerSolicitud(bien(1, 'QR')).codigo, 'metodo_invalido', 'sin mayúsculas');
  assert.equal(leerSolicitud(JSON.stringify({ m: 1, k: K })).codigo, 'metodo_invalido', 'falta el método');
  for (const m of [0.5, -1, '', 'abc', '12345', null, undefined, [], {}, '1 ']) assert.equal(leerSolicitud(JSON.stringify({ m, k: K, metodo: 'qr' })).codigo, 'enlace_invalido', `m=${JSON.stringify(m)}`);
  for (const k of ['', 'xyz', 'a'.repeat(31), 'a'.repeat(65), 'A'.repeat(48), 12, null, undefined]) assert.equal(leerSolicitud(JSON.stringify({ m: 1, k, metodo: 'qr' })).codigo, 'enlace_invalido', `k=${JSON.stringify(k)}`);
  for (const crudo of ['', 'no es json', '[]', 'null', '"texto"', '42', '{']) assert.equal(leerSolicitud(crudo).codigo, 'solicitud_invalida', crudo);
  assert.equal(leerSolicitud(JSON.stringify({ m: 1, k: K, metodo: 'qr', relleno: 'x'.repeat(1100) })).codigo, 'solicitud_invalida', 'cuerpo de más de 1 KB');
  assert.equal(leerSolicitud(bien(1) + ' '.repeat(2000)).codigo, 'solicitud_invalida', 'cuerpo de más de 1 KB (espacios)');
  assert.equal(leerSolicitud(JSON.stringify({ m: 1, k: K, metodo: 'qr', ñ: 'é'.repeat(600) })).codigo, 'solicitud_invalida', 'el límite es en bytes, no en letras (600 letras, 1.200 bytes)');
});

test('B2. CORS: solo el sitio y los puertos de prueba; cualquier otro origen no recibe Allow-Origin', { skip: sinTs }, () => {
  const { origenPermitido, cabecerasCors, ORIGENES_PERMITIDOS } = LOGICA;
  assert.deepEqual([...ORIGENES_PERMITIDOS].sort(), ['http://127.0.0.1:8787', 'http://localhost:8787', 'https://resplandor.ynt.codes']);
  for (const o of ORIGENES_PERMITIDOS) {
    assert.equal(origenPermitido(o), true);
    const h = cabecerasCors(o);
    assert.equal(h['Access-Control-Allow-Origin'], o, 'devuelve el Origin, no un comodín');
    assert.equal(h['Access-Control-Allow-Methods'], 'POST, OPTIONS');
    assert.equal(h.Vary, 'Origin');
  }
  for (const o of ['https://resplandor.ynt.codes.evil.example', 'http://resplandor.ynt.codes', 'https://ynt.codes', 'https://evil.example', 'null', '', null, undefined, 'http://localhost:3000', 'http://localhost:8787/', 'HTTPS://RESPLANDOR.YNT.CODES']) {
    assert.equal(origenPermitido(o), false, String(o));
    assert.equal(cabecerasCors(o)['Access-Control-Allow-Origin'], undefined, `${o}: no debe recibir Allow-Origin`);
    assert.equal(cabecerasCors(o).Vary, 'Origin');
  }
});

test('B3. el limitador es de ventana deslizante, cuenta por clave y `excedido` no registra', { skip: sinTs }, () => {
  let t = 1_000_000;
  const l = LOGICA.crearLimitador({ ventanaMs: 60_000, max: 3, ahora: () => t });
  assert.equal(l.excedido('a'), false);
  assert.deepEqual([l.golpe('a'), l.golpe('a'), l.golpe('a'), l.golpe('a')], [false, false, false, true], 'el 4.º toque pasa el máximo de 3');
  assert.equal(l.golpe('b'), false, 'otra clave, otro cupo');
  assert.ok(l.espera('a') > 0 && l.espera('a') <= 60_000);
  t += 59_999;
  assert.equal(l.excedido('a'), true, 'todavía dentro de la ventana');
  t += 2;
  assert.equal(l.excedido('a'), false, 'la ventana se deslizó');
  assert.equal(l.espera('a'), 0);
  // `excedido` no gasta cupo; `registrar` sí
  const m = LOGICA.crearLimitador({ ventanaMs: 1000, max: 2, ahora: () => t });
  for (let i = 0; i < 10; i++) m.excedido('x');
  assert.equal(m.excedido('x'), false);
  m.registrar('x'); m.registrar('x');
  assert.equal(m.excedido('x'), true);
  // reservar toma el cupo en el acto (sin pausa entre comprobar y registrar); liberar lo devuelve
  const r = LOGICA.crearLimitador({ ventanaMs: 1000, max: 2, ahora: () => t });
  assert.deepEqual([r.reservar('y'), r.reservar('y'), r.reservar('y')], [true, true, false], 'el 3.º no cabe');
  r.liberar('y');
  assert.equal(r.reservar('y'), true, 'liberar devolvió un cupo');
  assert.equal(r.excedido('y'), true);
  r.liberar('y'); r.liberar('y'); r.liberar('y'); r.liberar('nunca-vista');
  assert.equal(r.excedido('y'), false, 'liberar de más no rompe nada');
  assert.equal(r.reservar('y'), true);
  // techo de memoria
  const c = LOGICA.crearLimitador({ ventanaMs: 1000, max: 1, techo: 3, ahora: () => t });
  for (let i = 0; i < 10; i++) c.golpe(`ip${i}`);
  assert.equal(c.excedido('ip0'), false, 'pasado el techo se vacía, no crece sin fin');
});

test('B4. ipDe toma la primera IP de x-forwarded-for; respuestaDeRpc traduce cada código de la base al HTTP del contrato', { skip: sinTs }, () => {
  const { ipDe, respuestaDeRpc } = LOGICA;
  assert.equal(ipDe(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9');
  assert.equal(ipDe(new Headers()), 'desconocida');
  assert.deepEqual(respuestaDeRpc({ ok: true, metodo: 'qr', creada_en: '2026-09-30T12:00:00+00:00', alerta_id: 'x', orden_id: 'o1' }), { estado: 200, cuerpo: { ok: true, metodo: 'qr', creada_en: '2026-09-30T12:00:00+00:00' } }, 'al cliente solo van ok, metodo y creada_en');
  assert.equal(respuestaDeRpc({ ok: false, codigo: 'metodo_invalido' }).estado, 400);
  assert.equal(respuestaDeRpc({ ok: false, codigo: 'enlace_invalido' }).estado, 404);
  assert.equal(respuestaDeRpc({ ok: false, codigo: 'sin_cuenta' }).estado, 409);
  for (const raro of [null, undefined, 'x', {}, { ok: false }, { ok: false, codigo: 'otra_cosa' }, { ok: true }, { ok: true, metodo: 'tarjeta', creada_en: 'x' }]) {
    assert.equal(respuestaDeRpc(raro).estado, 500, JSON.stringify(raro));
  }
});

// ── B5. el index.ts REAL de punta a punta, con Deno y supabase-js simulados ──

const K = '0123456789abcdef'.repeat(3); // 48 hex, un token con forma de verdad
const SITIO = 'https://resplandor.ynt.codes';
const OK = { data: { ok: true, metodo: 'qr', creada_en: '2026-09-30T20:00:00.123456+00:00', alerta_id: '11111111-1111-1111-1111-111111111111', orden_id: 'o1' }, error: null };
const peticion = (cuerpo, { origen = SITIO, ip = '203.0.113.7', metodo = 'POST', cabeceras = {} } = {}) =>
  new Request('https://supabase.invalid/functions/v1/alerta', {
    method: metodo,
    headers: { ...(origen ? { origin: origen } : {}), 'x-forwarded-for': ip, 'content-type': 'application/json', ...cabeceras },
    body: metodo === 'POST' || metodo === 'PUT' ? (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  });
const leerJson = async (r) => JSON.parse(await r.text());

async function conFuncion(t, rpc, cuerpo) {
  const f = await cargarAlerta({ rpc });
  t.after(() => f.cerrar());
  return f;
}

test('B5a. 200 { ok, metodo, creada_en } y la RPC recibe exactamente (p_mesa, p_token, p_metodo)', { skip: sinTs }, async (t) => {
  const f = await conFuncion(t, async () => OK);
  for (const m of [3, '3']) {
    const r = await f.llamar(peticion({ m, k: K, metodo: 'efectivo' }));
    assert.equal(r.status, 200);
    assert.deepEqual(await leerJson(r), { ok: true, metodo: 'qr', creada_en: OK.data.creada_en });
  }
  assert.deepEqual(f.rpcLlamadas[0], { nombre: 'alertar_cuenta', args: { p_mesa: 3, p_token: K, p_metodo: 'efectivo' } });
  assert.equal(typeof f.rpcLlamadas[0].args.p_mesa, 'number');
  const r = await f.llamar(peticion({ m: 3, k: K, metodo: 'qr' }));
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), SITIO);
  assert.equal(r.headers.get('vary'), 'Origin');
});

test('B5b. 400 por método o enlace con formato inválido (sin tocar la base), y por cuerpo roto o demasiado grande', { skip: sinTs }, async (t) => {
  const f = await conFuncion(t, async () => OK);
  const casos = [
    [{ m: 1, k: K, metodo: 'tarjeta' }, 'metodo_invalido'],
    [{ m: 1, k: K }, 'metodo_invalido'],
    [{ m: 'abc', k: K, metodo: 'qr' }, 'enlace_invalido'],
    [{ m: 1, k: 'corto', metodo: 'qr' }, 'enlace_invalido'],
    [{ k: K, metodo: 'qr' }, 'enlace_invalido'],
    ['esto no es json', 'solicitud_invalida'],
    ['[]', 'solicitud_invalida'],
    [JSON.stringify({ m: 1, k: K, metodo: 'qr', x: 'y'.repeat(2000) }), 'solicitud_invalida'],
  ];
  for (const [cuerpo, codigo] of casos) {
    const r = await f.llamar(peticion(cuerpo, { ip: `198.51.100.${Math.floor(Math.random() * 200)}` }));
    assert.equal(r.status, 400, JSON.stringify(cuerpo).slice(0, 60));
    const j = await leerJson(r);
    assert.equal(j.ok, false);
    assert.equal(j.codigo, codigo);
    assert.equal(typeof j.error, 'string');
  }
  assert.equal(f.rpcLlamadas.length, 0, 'ninguna solicitud inválida debe llegar a la base');
});

test('B5c. 404 si el par (mesa, token) no existe y 409 si no hay cuenta abierta (lo decide la base)', { skip: sinTs }, async (t) => {
  let respuesta = { data: { ok: false, codigo: 'enlace_invalido' }, error: null };
  const f = await conFuncion(t, async () => respuesta);
  let r = await f.llamar(peticion({ m: 2, k: K, metodo: 'qr' }));
  assert.equal(r.status, 404);
  assert.equal((await leerJson(r)).codigo, 'enlace_invalido');
  respuesta = { data: { ok: false, codigo: 'sin_cuenta' }, error: null };
  r = await f.llamar(peticion({ m: 2, k: K, metodo: 'qr' }));
  assert.equal(r.status, 409);
  assert.equal((await leerJson(r)).codigo, 'sin_cuenta');
  respuesta = { data: { ok: false, codigo: 'metodo_invalido' }, error: null };
  assert.equal((await f.llamar(peticion({ m: 2, k: K, metodo: 'qr' }))).status, 400);
});

test('B5d. 500 si la base falla, sin escribir el token ni la llave en los logs ni en la respuesta', { skip: sinTs }, async (t) => {
  const f = await conFuncion(t, async () => ({ data: null, error: new Error('la base se cayó') }));
  const r = await f.llamar(peticion({ m: 2, k: K, metodo: 'qr' }));
  assert.equal(r.status, 500);
  const texto = await r.text();
  assert.equal(JSON.parse(texto).codigo, 'error_interno');
  assert.ok(f.logs.length >= 1, 'el fallo se registra');
  for (const donde of [texto, ...f.logs]) {
    assert.ok(!donde.includes(K), 'el token no puede aparecer');
    assert.ok(!donde.includes('valor-de-mentira'), 'la llave de servicio no puede aparecer');
  }
  // y una RPC que devuelve algo inesperado también es 500, no un 200 inventado
  const g = await conFuncion(t, async () => ({ data: { ok: true }, error: null }));
  assert.equal((await g.llamar(peticion({ m: 2, k: K, metodo: 'qr' }))).status, 500);
});

test('B5e. CORS y métodos: preflight del sitio sí; otro origen, 403 sin tocar la base; GET, 405; sin Origin (curl) funciona sin Allow-Origin', { skip: sinTs }, async (t) => {
  const f = await conFuncion(t, async () => OK);
  const pre = await f.llamar(peticion(null, { metodo: 'OPTIONS', cabeceras: { 'access-control-request-method': 'POST' } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITIO);
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.match(pre.headers.get('access-control-allow-headers'), /content-type/);
  for (const origen of ['https://evil.example', 'https://resplandor.ynt.codes.evil.example', 'null', 'http://localhost:3000']) {
    const pre2 = await f.llamar(peticion(null, { metodo: 'OPTIONS', origen }));
    assert.equal(pre2.status, 403, `preflight de ${origen}`);
    assert.equal(pre2.headers.get('access-control-allow-origin'), null);
    const r = await f.llamar(peticion({ m: 1, k: K, metodo: 'qr' }, { origen }));
    assert.equal(r.status, 403, `POST desde ${origen}`);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal((await leerJson(r)).codigo, 'origen_no_permitido');
  }
  for (const origen of ['http://127.0.0.1:8787', 'http://localhost:8787']) {
    assert.equal((await f.llamar(peticion({ m: 1, k: K, metodo: 'qr' }, { origen }))).status, 200, origen);
  }
  const get = await f.llamar(peticion(null, { metodo: 'GET' }));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST, OPTIONS');
  const sinOrigen = await f.llamar(peticion({ m: 1, k: K, metodo: 'qr' }, { origen: null }));
  assert.equal(sinOrigen.status, 200, 'una llamada sin Origin (curl, servidor) no es del navegador: CORS no aplica');
  assert.equal(sinOrigen.headers.get('access-control-allow-origin'), null);
  assert.equal(f.rpcLlamadas.length, 3, 'solo las 3 peticiones permitidas llegaron a la base');
});

test('B5f. 429 por IP: el toque 31 del minuto se frena, con Retry-After; otra IP sigue pasando', { skip: sinTs }, async (t) => {
  const f = await conFuncion(t, async () => OK);
  for (let i = 1; i <= 30; i++) {
    const r = await f.llamar(peticion({ m: i, k: K, metodo: 'qr' }, { ip: '203.0.113.50' }));
    assert.equal(r.status, 200, `toque ${i}`);
  }
  const r = await f.llamar(peticion({ m: 31, k: K, metodo: 'qr' }, { ip: '203.0.113.50' }));
  assert.equal(r.status, 429);
  assert.equal((await leerJson(r)).codigo, 'demasiadas_solicitudes');
  assert.ok(Number(r.headers.get('retry-after')) >= 1, 'Retry-After en segundos');
  assert.equal((await f.llamar(peticion({ m: 32, k: K, metodo: 'qr' }, { ip: '203.0.113.51' }))).status, 200, 'otra IP no se ve afectada');
  assert.equal(f.rpcLlamadas.length, 31, 'el toque frenado no llegó a la base');
});

test('B5g. 429 por mesa: el 7.º toque a una mesa se frena aunque venga de otra IP; las demás mesas siguen', { skip: sinTs }, async (t) => {
  const f = await conFuncion(t, async () => OK);
  for (let i = 1; i <= 6; i++) assert.equal((await f.llamar(peticion({ m: 7, k: K, metodo: 'qr' }, { ip: `192.0.2.${i}` }))).status, 200, `toque ${i}`);
  const r = await f.llamar(peticion({ m: 7, k: K, metodo: 'efectivo' }, { ip: '192.0.2.99' }));
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  assert.equal((await f.llamar(peticion({ m: 8, k: K, metodo: 'qr' }, { ip: '192.0.2.98' }))).status, 200, 'la mesa 8 tiene su propio cupo');
  assert.equal(f.rpcLlamadas.length, 7);
});

test('B5h. quien adivina números de mesa con un token falso NO le gasta el cupo a la mesa de verdad', { skip: sinTs }, async (t) => {
  let valida = false;
  const f = await conFuncion(t, async () => (valida ? OK : { data: { ok: false, codigo: 'enlace_invalido' }, error: null }));
  for (let i = 0; i < 25; i++) {
    const r = await f.llamar(peticion({ m: 9, k: K, metodo: 'qr' }, { ip: `203.0.113.${100 + i}` }));
    assert.equal(r.status, 404);
  }
  valida = true;
  for (let i = 0; i < 6; i++) assert.equal((await f.llamar(peticion({ m: 9, k: K, metodo: 'qr' }, { ip: `203.0.113.${200 + i}` }))).status, 200, `toque legítimo ${i + 1}`);
  assert.equal((await f.llamar(peticion({ m: 9, k: K, metodo: 'qr' }, { ip: '203.0.113.250' }))).status, 429, 'ahora sí, el 7.º legítimo');
  // y un 409 (sin cuenta) tampoco gasta cupo: no escribió nada
  let sin = true;
  const g = await conFuncion(t, async () => (sin ? { data: { ok: false, codigo: 'sin_cuenta' }, error: null } : OK));
  for (let i = 0; i < 10; i++) assert.equal((await g.llamar(peticion({ m: 4, k: K, metodo: 'qr' }, { ip: `203.0.114.${i + 1}` }))).status, 409);
  sin = false;
  assert.equal((await g.llamar(peticion({ m: 4, k: K, metodo: 'qr' }, { ip: '203.0.114.200' }))).status, 200);
});

test('B5i. la basura de un celular NO deja a la sala en 429 (mismo wifi, misma IP); el techo de costo sí corta lo desmedido', { skip: sinTs }, async (t) => {
  let ok = false;
  const f = await conFuncion(t, async () => (ok ? OK : { data: { ok: false, codigo: 'enlace_invalido' }, error: null }));
  const IP = '203.0.113.77';
  for (let i = 0; i < 100; i++) assert.equal((await f.llamar(peticion('no es json', { ip: IP }))).status, 400);
  for (let i = 0; i < 100; i++) assert.equal((await f.llamar(peticion({ m: 1 + (i % 50), k: K, metodo: 'qr' }, { ip: IP }))).status, 404);
  for (let i = 0; i < 100; i++) assert.equal((await f.llamar(peticion({ m: 2, k: K }, { ip: IP, origen: null }))).status, 400, 'sin Origin también cuenta como basura');
  // 300 solicitudes malas del minuto: el techo de costo está justo en el borde, pero la sala todavía no gastó nada
  ok = true;
  const otraIp = await f.llamar(peticion({ m: 3, k: K, metodo: 'qr' }, { ip: '203.0.113.78' }));
  assert.equal(otraIp.status, 200, 'otra IP no se ve afectada');
  // la misma IP tras 200 solicitudes malas: una tanda de toques legítimos pasa (los cupos de escritura están intactos)
  const g = await conFuncion(t, async () => (ok ? OK : { data: { ok: false, codigo: 'enlace_invalido' }, error: null }));
  ok = false;
  for (let i = 0; i < 200; i++) assert.equal((await g.llamar(peticion('x', { ip: IP }))).status, 400);
  ok = true;
  for (let i = 1; i <= 30; i++) assert.equal((await g.llamar(peticion({ m: 100 + i, k: K, metodo: 'qr' }, { ip: IP }))).status, 200, `toque legítimo ${i} tras 200 solicitudes malas`);
  assert.equal((await g.llamar(peticion({ m: 131, k: K, metodo: 'qr' }, { ip: IP }))).status, 429, 'el 31.º ESCRITURA del minuto sí se frena (cupo de escritura por IP)');
  // el techo de costo: más de 300 solicitudes de cualquier tipo en un minuto desde una IP
  const h = await conFuncion(t, async () => OK);
  const IP2 = '203.0.113.90';
  for (let i = 0; i < 300; i++) assert.equal((await h.llamar(peticion('x', { ip: IP2 }))).status, 400);
  const corte = await h.llamar(peticion('x', { ip: IP2 }));
  assert.equal(corte.status, 429);
  assert.ok(Number(corte.headers.get('retry-after')) >= 1);
  assert.equal((await h.llamar(peticion({ m: 3, k: K, metodo: 'qr' }, { ip: '203.0.113.91' }))).status, 200, 'otra IP sigue pasando');
});

test('B5j. varias solicitudes SIMULTÁNEAS con el token bueno no pasan todas el límite por mesa: llegan 6 a la base, no 12', { skip: sinTs }, async (t) => {
  let abrir;
  const puerta = new Promise((r) => { abrir = r; });
  const f = await conFuncion(t, async () => { await puerta; return OK; });
  const todas = Array.from({ length: 12 }, (_, i) => f.llamar(peticion({ m: 5, k: K, metodo: 'qr' }, { ip: `192.0.2.${i + 1}` })));
  await new Promise((r) => setTimeout(r, 30)); // todas pasaron la validación; la base todavía no contesta
  assert.equal(f.rpcLlamadas.length, 6, 'el cupo se toma ANTES del await: solo 6 llegan a la base');
  abrir();
  const estados = (await Promise.all(todas)).map((r) => r.status).sort();
  assert.deepEqual(estados, [200, 200, 200, 200, 200, 200, 429, 429, 429, 429, 429, 429]);
  assert.equal(f.rpcLlamadas.length, 6, 'las 429 nunca tocaron la base');
});

test('B5k. simultáneas desde una IP: el cupo de escritura por IP también se toma antes del await, y lo que no escribió se devuelve', { skip: sinTs }, async (t) => {
  let abrir;
  let escribe = true;
  const puerta = new Promise((r) => { abrir = r; });
  const f = await conFuncion(t, async () => { await puerta; return escribe ? OK : { data: { ok: false, codigo: 'enlace_invalido' }, error: null }; });
  const IP = '198.51.100.40';
  const tanda = Array.from({ length: 40 }, (_, i) => f.llamar(peticion({ m: 200 + i, k: K, metodo: 'qr' }, { ip: IP })));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.rpcLlamadas.length, 30, 'de 40 simultáneas desde la misma IP solo 30 llegan a la base');
  abrir();
  const estados = (await Promise.all(tanda)).map((r) => r.status).sort();
  assert.equal(estados.filter((e) => e === 200).length, 30);
  assert.equal(estados.filter((e) => e === 429).length, 10);
  // lo que NO escribió devuelve su cupo: tras una tanda de 404 la misma IP y la misma mesa siguen teniendo cupo
  const g = await conFuncion(t, async () => ({ data: { ok: false, codigo: 'enlace_invalido' }, error: null }));
  for (let i = 0; i < 40; i++) assert.equal((await g.llamar(peticion({ m: 7, k: K, metodo: 'qr' }, { ip: IP }))).status, 404, `intento ${i + 1}`);
  // un fallo de la base (500) tampoco gasta cupo
  const h = await conFuncion(t, async () => ({ data: null, error: new Error('la base se cayó') }));
  for (let i = 0; i < 10; i++) assert.equal((await h.llamar(peticion({ m: 8, k: K, metodo: 'qr' }, { ip: '198.51.100.41' }))).status, 500);
  escribe = true;
});


// ───────────────────────── C. el contrato entre la base y la función ─────────────────────────

test('C1. la función llama a la RPC con el nombre y los parámetros que declara la migración de alertas', () => {
  const firma = SQL_B.match(/create or replace function public\.alertar_cuenta\(([^)]*)\)/)[1];
  const paramsSql = firma.split(',').map((p) => p.trim().split(/\s+/)[0]);
  const index = fs.readFileSync(path.join(DIR_FUNCION, 'index.ts'), 'utf8');
  const llamada = index.match(/\.rpc\("alertar_cuenta", \{([\s\S]*?)\}\)/);
  assert.ok(llamada, 'index.ts no llama a rpc("alertar_cuenta", …)');
  const paramsTs = [...llamada[1].matchAll(/(p_\w+):/g)].map((m) => m[1]);
  assert.deepEqual(paramsTs, paramsSql, 'los parámetros (orden y nombre) deben coincidir con la función SQL');
});

test('C2. los métodos de la función son los de la base, y todo código que la base puede devolver tiene su HTTP', { skip: sinTs }, () => {
  const deSql = (texto) => [...texto.matchAll(/'(qr|transferencia|efectivo|\w+)'/g)].map((m) => m[1]);
  const check = SQL_B.match(/alertas_metodo_check check \(\(metodo = any \(array\[([^\]]*)\]/)[1];
  assert.deepEqual(deSql(check.replace(/::text/g, '')).sort(), [...LOGICA.METODOS].sort(), 'CHECK de alertas.metodo');
  const funcion = SQL_B.match(/create or replace function public\.alertar_cuenta[\s\S]*?\$function\$;/)[0];
  const lista = funcion.match(/p_metodo <> all \(array\[([^\]]*)\]/)[1];
  assert.deepEqual(deSql(lista).sort(), [...LOGICA.METODOS].sort(), 'lista de alertar_cuenta');
  const codigos = [...funcion.matchAll(/'codigo', '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(codigos)].sort(), ['enlace_invalido', 'metodo_invalido', 'sin_cuenta']);
  for (const c of codigos) assert.notEqual(LOGICA.respuestaDeRpc({ ok: false, codigo: c }).estado, 500, `el código ${c} no tiene traducción`);
  // y el límite de la alerta por mesa/IP está documentado donde se define
  assert.deepEqual({ ...LOGICA.LIMITE_MESA }, { ventanaMs: 60_000, max: 6 });
  assert.deepEqual({ ...LOGICA.LIMITE_IP }, { ventanaMs: 60_000, max: 30 });
  assert.deepEqual({ ...LOGICA.LIMITE_IP_TOTAL }, { ventanaMs: 60_000, max: 300 }, 'techo de costo por IP: holgado, no es el que frena a la sala');
  assert.ok(LOGICA.LIMITE_IP_TOTAL.max >= 10 * LOGICA.LIMITE_IP.max, 'el techo de costo no puede ser el cupo normal: la basura no puede ahogar a la sala');
});

// ───────────────────────── D. nada de correos reales (el repo es público) ─────────────────────────

test('D1. lo que esta ola agrega no trae ningún correo real: solo dominios de prueba, y los admins van con marcadores', () => {
  const archivos = [
    ...MIGRACIONES_REL,
    'supabase/functions/alerta/index.ts',
    'supabase/functions/alerta/logica.ts',
    'scripts/pruebas/roles-y-alertas.test.mjs',
    'scripts/pruebas/_funcion-alerta.mjs',
  ];
  const PERMITIDOS = /@(resplandor\.test|[\w-]+\.invalid|example\.(com|org|net))$/i;
  const encontrados = [];
  for (const rel of archivos) {
    for (const m of leer(rel).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) {
      if (!PERMITIDOS.test(m[0])) encontrados.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(encontrados, [], 'correos que no son de prueba');
  // el único «alta» en el repo son los marcadores: las migraciones los nombran pero no los traen como dato
  assert.doesNotMatch(TODO_SC, /insert into public\.personal[^;]*values\s*\(\s*'/i, 'un INSERT con un correo escrito en una migración');
  // y la compuerta, que es la única que lee el alta, solo trae el nombre del marcador en el mensaje de error
  assert.deepEqual([...new Set(TODO_SC.match(/<CORREO_[A-Z_0-9a-z]*>/g) || [])].sort(), ['<CORREO_ADMIN_n>'], 'en el código, el único marcador que aparece es el del mensaje de error');
  for (const m of TODO.match(/<CORREO_[A-Z_0-9a-z]*>/g) || []) assert.match(m, /^<CORREO_ADMIN_(1|n)>$/, 'los comentarios solo nombran el marcador de admin');
});
