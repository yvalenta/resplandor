// Roles del personal y alertas de «pedir la cuenta» (pedido de Yonatan, 2026-09-30; ola A).
// Lo que se puede verificar SIN red, sin Docker y sin Supabase:
//
//   A. La migración (supabase/migrations/20261002120000_roles_y_alertas.sql), leída como texto:
//      su lugar en el orden, las dos tablas, mi_rol(), la guardia que impide dejar a todos afuera
//      (antes de tocar una sola policy), las policies por rol en las tablas del POS, los GRANT, el
//      REVOKE de cada función, search_path fijo, Realtime y que se pueda volver a correr.
//   B. La Edge Function `alerta`, de dos maneras:
//        · su lógica pura (supabase/functions/alerta/logica.ts) cargada tal cual en Node;
//        · el index.ts REAL corrido de punta a punta con Deno y supabase-js simulados
//          (scripts/pruebas/_funcion-alerta.mjs): CORS, métodos, validación, 400/403/404/409/429,
//          límites por IP y por mesa, y que el token nunca llegue a los logs.
//   C. El contrato entre las dos: nombre y parámetros de la RPC, códigos y métodos.
//   D. Que no haya correos reales en lo que esta ola agrega (el repo es público).
//
// Lo que esta prueba NO puede ver —que cada permiso de la tabla pase o falle de verdad, que haya
// UNA sola alerta pendiente por mesa, las carreras— lo prueban las sesiones reales contra un
// Postgres 17 desechable (Docker, roles de Supabase simulados); ver el informe de la ola A.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, DIR_FUNCION, SOPORTA_TS, cargarAlerta } from './_funcion-alerta.mjs';

const MIGRACION_REL = 'supabase/migrations/20261002120000_roles_y_alertas.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(MIGRACION_REL);
const SQL_SIN_COMENTARIOS = SQL.replace(/--.*$/gm, '');

// ───────────────────────── A. la migración ─────────────────────────

test('A1. la migración va fechada DESPUÉS de las anteriores y de la fase 1 (20261001120000), y su fecha es única', () => {
  const nombres = fs.readdirSync(path.join(RAIZ, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  const mia = path.basename(MIGRACION_REL);
  assert.ok(mia.split('_')[0] > '20261001120000', 'debe ir después de la fase 1 (cuenta en vivo), que vive en otra rama');
  assert.ok(mia.split('_')[0] > '20260906120000', 'debe ir después de la carta NFC');
  assert.equal(nombres.at(-1), mia, 'es la última del directorio');
});

test('A2. `personal`: correo en minúsculas como clave, rol admin|mesero, baja lógica, RLS encendida', () => {
  const tabla = SQL.match(/create table if not exists public\.personal \(([\s\S]*?)\n\);/);
  assert.ok(tabla, 'falta create table if not exists public.personal');
  const t = tabla[1];
  for (const col of ['email text not null', 'nombre text not null', 'rol text not null', 'activo boolean not null default true', 'creado_en timestamp with time zone not null default now()']) {
    assert.ok(t.includes(col), `personal: falta la columna «${col}»`);
  }
  assert.match(t, /constraint personal_pkey primary key \(email\)/);
  assert.match(t, /email = lower\(email\)/, 'el correo debe guardarse en minúsculas (check)');
  assert.match(t, /rol = any \(array\['admin'::text, 'mesero'::text\]\)/);
  assert.match(SQL, /alter table public\.personal enable row level security/);
});

test('A3. `alertas`: columnas del contrato, FK a mesas y a ordenes (on delete set null), una sola pendiente por mesa, RLS', () => {
  const tabla = SQL.match(/create table if not exists public\.alertas \(([\s\S]*?)\n\);/);
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
  assert.match(SQL, /create unique index if not exists ux_alertas_una_pendiente_por_mesa\s+on public\.alertas using btree \(mesa_id\) where \(estado = 'pendiente'::text\)/);
  assert.match(SQL, /alter table public\.alertas enable row level security/);
});

test('A4. mi_rol(): SECURITY DEFINER, search_path vacío, sesión de Google, correo en minúsculas, fila activa', () => {
  const f = SQL.match(/create or replace function public\.mi_rol\(\)[\s\S]*?\$function\$;/)[0];
  assert.match(f, /security definer/);
  assert.match(f, /set search_path = ''/);
  assert.match(f, /where p\.activo/);
  assert.match(f, /'app_metadata' ->> 'provider', ''\) = 'google'/, 'un usuario por correo con el correo de un admin NO puede obtener rol');
  assert.match(f, /p\.email = lower\(coalesce\(\(select auth\.jwt\(\)\) ->> 'email', ''\)\)/);
  assert.match(f, /from public\.personal p/, 'referencias calificadas con esquema (search_path vacío)');
});

test('A5. la guardia anti-bloqueo va ANTES de tocar una sola policy, y el alta inicial viaja en un ajuste de la sesión', () => {
  const guardia = SQL.indexOf("raise exception 'Sin un admin activo");
  const alta = SQL.indexOf("current_setting('resplandor.admins_iniciales', true)");
  const primeraPolicy = Math.min(...['drop policy', 'create policy'].map((s) => SQL.indexOf(s)).filter((i) => i >= 0));
  const primerMiRol = SQL.indexOf('create or replace function public.mi_rol()');
  assert.ok(alta > 0 && guardia > alta, 'la guardia viene después de leer el alta inicial');
  assert.ok(guardia < primeraPolicy, 'la guardia debe lanzar ANTES de la primera policy');
  assert.ok(guardia < primerMiRol, 'y antes de definir mi_rol()');
  assert.match(SQL, /where p\.rol = 'admin' and p\.activo/);
  assert.match(SQL, /marcador <CORREO_ADMIN_n> sin reemplazar/, 'el error dice qué marcador quedó sin reemplazar');
  assert.match(SQL, /on conflict \(email\) do update set rol = 'admin', activo = true/);
});

test('A6. las policies permisivas viejas se van y cada tabla del POS recibe las de rol', () => {
  for (const vieja of ['authenticated full access productos', 'authenticated full access mesas', 'authenticated full access ordenes', 'authenticated full access cierres']) {
    assert.ok(SQL_SIN_COMENTARIOS.includes(`drop policy if exists "${vieja}"`), `no se borra «${vieja}»`);
  }
  for (const vieja of ['menus_admin', 'sug_admin']) assert.ok(SQL_SIN_COMENTARIOS.includes(`drop policy if exists ${vieja} on`), `no se borra ${vieja}`);
  const esperadas = {
    productos: ['productos_ver', 'productos_crear', 'productos_editar', 'productos_borrar'],
    mesas: ['mesas_ver', 'mesas_crear', 'mesas_editar'],
    ordenes: ['ordenes_ver', 'ordenes_crear', 'ordenes_editar', 'ordenes_borrar'],
    cierres: ['cierres_ver', 'cierres_crear', 'cierres_editar'],
    menus: ['menus_crear', 'menus_editar', 'menus_borrar'],
    sugerencias_plato: ['sugerencias_ver_admin'],
    personal: ['personal_ver'],
    alertas: ['alertas_ver'],
  };
  for (const [tabla, nombres] of Object.entries(esperadas)) {
    for (const n of nombres) {
      assert.match(SQL_SIN_COMENTARIOS, new RegExp(`create policy ${n} on public\\.${tabla} for \\w+ to authenticated`), `falta la policy ${n}`);
    }
  }
  // Ninguna permisiva abierta: el acceso lo da siempre mi_rol().
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /using\s*\(\s*true\s*\)/i, 'una policy con using (true)');
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /with check\s*\(\s*true\s*\)/i, 'una policy con with check (true)');
  // Nada para anon en lo que esta migración crea.
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /create policy [^;]*\bto\b[^;]*\banon\b/i, 'una policy nueva para anon');
});

test('A7. `solo_google` (restrictiva) exige además mi_rol() en las 7 tablas del POS; `menus` queda con lectura pública', () => {
  const bloque = SQL.match(/foreach t in array array\[([^\]]*)\] loop[\s\S]*?end loop;/);
  assert.ok(bloque, 'falta el bucle de solo_google');
  const tablas = [...bloque[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(tablas, ['alertas', 'cierres', 'mesas', 'ordenes', 'personal', 'productos', 'sugerencias_plato']);
  assert.match(bloque[0], /as restrictive for all to authenticated/);
  assert.match(bloque[0], /''provider''\) = ''google'' and \(select public\.mi_rol\(\)\) is not null/);
  assert.ok(SQL_SIN_COMENTARIOS.includes('drop policy if exists solo_google on public.menus;'), 'menus deja de llevar la restrictiva');
  // las escrituras de menus exigen admin (que ya incluye Google + personal activo)
  for (const n of ['menus_crear', 'menus_editar', 'menus_borrar']) {
    const p = SQL_SIN_COMENTARIOS.match(new RegExp(`create policy ${n} on public\\.menus[\\s\\S]*?;`))[0];
    assert.match(p, /mi_rol\(\)\) = 'admin'/, `${n} debe exigir admin`);
  }
});

test('A8. permisos por rol: catálogo, menús, cierre y sugerencias son del admin; el mesero borra solo una orden abierta y vacía', () => {
  const pol = (n) => SQL_SIN_COMENTARIOS.match(new RegExp(`create policy ${n} on public\\.\\w+[\\s\\S]*?;`))[0];
  for (const n of ['productos_crear', 'productos_editar', 'productos_borrar', 'cierres_crear', 'cierres_editar', 'sugerencias_ver_admin']) {
    assert.match(pol(n), /mi_rol\(\)\) = 'admin'/, `${n}: solo admin`);
    assert.doesNotMatch(pol(n), /'mesero'/, `${n}: el mesero no figura`);
  }
  for (const n of ['productos_ver', 'mesas_ver', 'mesas_editar', 'ordenes_ver', 'ordenes_crear', 'ordenes_editar', 'cierres_ver', 'alertas_ver']) {
    assert.match(pol(n), /mi_rol\(\)\) is not null/, `${n}: todo el personal`);
  }
  const borrar = pol('ordenes_borrar');
  assert.match(borrar, /\(select public\.mi_rol\(\)\) = 'admin'\s+or \(\(select public\.mi_rol\(\)\) = 'mesero' and estado = 'abierta' and items = '\[\]'::jsonb\)/);
  // el INSERT del mesero en mesas pasa solo si el id ya existe (el POS guarda con upsert)
  assert.match(pol('mesas_crear'), /'admin'[\s\S]*'mesero' and public\.mesa_existe\(id\)/);
  const f = SQL.match(/create or replace function public\.mesa_existe\(p_id integer\)[\s\S]*?\$function\$;/)[0];
  assert.match(f, /security definer/);
  assert.match(f, /set search_path = ''/);
  assert.match(f, /public\.mi_rol\(\) is not null/);
  // el personal solo se ve (admin todo; cada quien su fila) y las alertas solo se ven: no hay policies de escritura
  for (const tabla of ['personal', 'alertas']) {
    assert.doesNotMatch(SQL_SIN_COMENTARIOS, new RegExp(`create policy \\w+ on public\\.${tabla} for (insert|update|delete|all)`), `${tabla}: sin policies de escritura`);
  }
  assert.match(pol('personal_ver'), /mi_rol\(\)\) = 'admin'[\s\S]*email = \(select lower\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)\)/);
});

test('A9. GRANT mínimos: nada para anon; authenticated solo lee personal y alertas; service_role escribe alertas y no ve personal', () => {
  assert.match(SQL_SIN_COMENTARIOS, /revoke all on public\.personal, public\.alertas from anon, authenticated, service_role;/);
  assert.match(SQL_SIN_COMENTARIOS, /grant select on public\.personal, public\.alertas to authenticated;/);
  assert.match(SQL_SIN_COMENTARIOS, /grant select, insert, update on public\.alertas to service_role;/);
  // ningún `grant` menciona a anon, ni a PUBLIC
  for (const g of SQL_SIN_COMENTARIOS.match(/\bgrant\b[^;]*;/gi) || []) {
    assert.doesNotMatch(g, /\banon\b|\bpublic\b(?!\.)\s*;?$/i, `grant a anon/public: ${g}`);
    assert.doesNotMatch(g, /\b(update|delete|insert)\b[^;]*\bon public\.personal\b/i, `escritura directa sobre personal: ${g}`);
  }
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /grant[^;]*public\.personal[^;]*service_role/i, 'service_role no necesita personal');
});

function funcionesCreadas() {
  const out = [];
  const re = /create or replace function (public\.\w+)\(([^)]*)\)([\s\S]*?)\$function\$;/g;
  let m;
  while ((m = re.exec(SQL))) {
    const tipos = m[2].split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s+/).slice(1).join(' '));
    out.push({ nombre: m[1], tipos, cuerpo: m[0] });
  }
  return out;
}

test('A10. toda función SECURITY DEFINER fija search_path, y toda función creada tiene su REVOKE a public y anon', () => {
  const fs_ = funcionesCreadas();
  const nombres = fs_.map((f) => f.nombre.replace('public.', '')).sort();
  assert.deepEqual(nombres, ['alertar_cuenta', 'atender_alerta', 'descartar_alerta', 'mesa_existe', 'mi_rol', 'personal_alta', 'personal_baja', 'personal_cambiar_rol', 'resolver_alerta', 'resolver_alertas_de_mesa']);
  for (const f of fs_) {
    if (/security definer/.test(f.cuerpo)) assert.match(f.cuerpo, /set search_path = ''/, `${f.nombre}: SECURITY DEFINER sin search_path vacío`);
    const firma = `${f.nombre.replace('.', '\\.')}\\(${f.tipos.join(',\\s*')}\\)`;
    assert.match(SQL_SIN_COMENTARIOS, new RegExp(`revoke all on function ${firma} from public, anon`), `${f.nombre}: falta el REVOKE de public y anon`);
  }
  // las internas y la de la Edge Function no las ejecuta ninguna sesión de la API
  for (const interna of ['resolver_alerta\\(uuid, text\\)', 'alertar_cuenta\\(integer, text, text\\)', 'resolver_alertas_de_mesa\\(\\)']) {
    assert.match(SQL_SIN_COMENTARIOS, new RegExp(`revoke all on function public\\.${interna} from public, anon, authenticated`), `${interna} debe negarse también a authenticated`);
  }
  // quién SÍ ejecuta
  assert.match(SQL_SIN_COMENTARIOS, /grant execute on function public\.alertar_cuenta\(integer, text, text\) to service_role;/);
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /grant execute on function public\.alertar_cuenta[^;]*authenticated/);
  for (const n of ['atender_alerta\\(uuid\\)', 'descartar_alerta\\(uuid\\)', 'personal_alta\\(text, text, text\\)', 'personal_baja\\(text\\)', 'personal_cambiar_rol\\(text, text\\)', 'mi_rol\\(\\)', 'mesa_existe\\(integer\\)']) {
    assert.match(SQL_SIN_COMENTARIOS, new RegExp(`grant execute on function public\\.${n} to authenticated`), `${n}: falta el EXECUTE para authenticated`);
  }
});

test('A11. personal_*: solo admin, candado de transacción con REVISIÓN del rol después, último admin protegido', () => {
  for (const nombre of ['personal_alta', 'personal_baja', 'personal_cambiar_rol']) {
    const f = funcionesCreadas().find((x) => x.nombre === `public.${nombre}`).cuerpo;
    assert.match(f, /pg_advisory_xact_lock\(hashtext\('resplandor\.personal'\)\)/, `${nombre}: sin candado`);
    const revisiones = f.match(/\(select public\.mi_rol\(\)\) is distinct from 'admin'/g) || [];
    assert.ok(revisiones.length >= 2, `${nombre}: debe revisar el rol antes Y después del candado`);
    assert.ok(f.lastIndexOf("is distinct from 'admin'") > f.indexOf('pg_advisory_xact_lock'), `${nombre}: la última revisión va después del candado`);
    assert.match(f, /'no_autorizado'/);
  }
  for (const nombre of ['personal_baja', 'personal_cambiar_rol']) {
    const f = funcionesCreadas().find((x) => x.nombre === `public.${nombre}`).cuerpo;
    assert.match(f, /count\(\*\) from public\.personal where rol = 'admin' and activo\) <= 1/, `${nombre}: no protege al último admin`);
    assert.match(f, /'ultimo_admin'/);
  }
  const baja = funcionesCreadas().find((x) => x.nombre === 'public.personal_baja').cuerpo;
  assert.match(baja, /update public\.personal set activo = false/, 'la baja es lógica: nunca delete');
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /delete from public\.personal/);
});

test('A12. alertar_cuenta: valida el par (mesa, token), exige orden abierta, bloquea la orden y deja UNA pendiente por mesa (upsert atómico)', () => {
  const f = funcionesCreadas().find((x) => x.nombre === 'public.alertar_cuenta');
  assert.deepEqual(f.tipos, ['integer', 'text', 'text']);
  assert.doesNotMatch(f.cuerpo, /security definer/, 'corre como quien llama (service_role), no como dueño');
  assert.match(f.cuerpo, /m\.id = p_mesa and m\.token = p_token/);
  assert.match(f.cuerpo, /o\.estado = 'abierta'[\s\S]*for share/, 'FOR SHARE sobre la orden: el cierre espera a la alerta');
  assert.match(f.cuerpo, /on conflict \(mesa_id\) where \(estado = 'pendiente'\)\s+do update set metodo = excluded\.metodo, orden_id = excluded\.orden_id, creada_en = now\(\)/);
  // el orden de las validaciones fija qué error gana
  const i = (s) => f.cuerpo.indexOf(s);
  assert.ok(i("'metodo_invalido'") < i("'enlace_invalido'") && i("'enlace_invalido'") < i("'sin_cuenta'"));
});

test('A13. atender y descartar: solo personal, solo una pendiente, y registran quién y cuándo', () => {
  const f = funcionesCreadas().find((x) => x.nombre === 'public.resolver_alerta').cuerpo;
  assert.match(f, /\(select public\.mi_rol\(\)\) is null[\s\S]*'no_autorizado'/);
  assert.match(f, /and estado = 'pendiente'/);
  assert.match(f, /atendida_en = now\(\)/);
  assert.match(f, /atendida_por = lower\(coalesce\(\(select auth\.jwt\(\)\) ->> 'email', ''\)\)/);
  assert.match(f, /'no_existe'/);
  assert.match(f, /'no_pendiente'/);
  assert.match(SQL, /select public\.resolver_alerta\(p_id, 'atendida'\)/);
  assert.match(SQL, /select public\.resolver_alerta\(p_id, 'descartada'\)/);
});

test('A14. cerrar la mesa atiende la alerta pendiente; liberar una mesa vacía la descarta (disparadores sobre ordenes)', () => {
  assert.match(SQL, /after update of estado on public\.ordenes[\s\S]*?when \(old\.estado = 'abierta' and new\.estado = 'cerrada'\)/);
  assert.match(SQL, /after delete on public\.ordenes[\s\S]*?when \(old\.estado = 'abierta'\)/);
  const f = funcionesCreadas().find((x) => x.nombre === 'public.resolver_alertas_de_mesa').cuerpo;
  assert.match(f, /case when tg_op = 'DELETE' then 'descartada' else 'atendida' end/);
  assert.match(f, /'sistema'/);
  assert.match(f, /where mesa_id = old\.mesa_id\s+and estado = 'pendiente'/);
});

test('A15. Realtime: alertas entra a supabase_realtime (una sola vez) y la RLS decide quién la recibe', () => {
  assert.match(SQL, /alter publication supabase_realtime add table public\.alertas/);
  assert.match(SQL, /if not exists \([\s\S]*?pg_publication_tables[\s\S]*?tablename = 'alertas'/, 'sin la guarda, volver a correr falla');
});

test('A16. se puede volver a correr: tablas e índices con IF NOT EXISTS, funciones con OR REPLACE, cada policy y trigger se borra antes de crearse', () => {
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /create table (?!if not exists)/i);
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /create (unique )?index (?!if not exists)/i);
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /create function/i);
  for (const m of SQL_SIN_COMENTARIOS.matchAll(/create policy (\w+) on (public\.\w+)/g)) {
    assert.ok(SQL_SIN_COMENTARIOS.includes(`drop policy if exists ${m[1]} on ${m[2]}`), `la policy ${m[1]} no se borra antes de crearse`);
  }
  for (const m of SQL_SIN_COMENTARIOS.matchAll(/create trigger (\w+)/g)) {
    assert.ok(SQL_SIN_COMENTARIOS.includes(`drop trigger if exists ${m[1]} on`), `el trigger ${m[1]} no se borra antes de crearse`);
  }
  assert.match(SQL_SIN_COMENTARIOS, /execute format\('drop policy if exists solo_google on public\.%I', t\);/);
});

test('A17. el orden seguro está escrito en la propia migración (cabecera) y no trae ningún correo ni marcador activo', () => {
  const cabecera = SQL.slice(0, SQL.indexOf('-- ── 1. Personal'));
  assert.match(cabecera, /ORDEN SEGURO/);
  assert.match(cabecera, /resplandor\.admins_iniciales/);
  assert.match(cabecera, /UNA transacción|UNA sola vez/);
  assert.match(cabecera, /Caja» por ahora = admin/);
  // el valor del ajuste no está en el archivo: la migración solo lo LEE
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /set_config\(/);
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

// ───────────────────────── C. el contrato entre la base y la función ─────────────────────────

test('C1. la función llama a la RPC con el nombre y los parámetros que declara la migración', () => {
  const firma = SQL.match(/create or replace function public\.alertar_cuenta\(([^)]*)\)/)[1];
  const paramsSql = firma.split(',').map((p) => p.trim().split(/\s+/)[0]);
  const index = fs.readFileSync(path.join(DIR_FUNCION, 'index.ts'), 'utf8');
  const llamada = index.match(/\.rpc\("alertar_cuenta", \{([\s\S]*?)\}\)/);
  assert.ok(llamada, 'index.ts no llama a rpc("alertar_cuenta", …)');
  const paramsTs = [...llamada[1].matchAll(/(p_\w+):/g)].map((m) => m[1]);
  assert.deepEqual(paramsTs, paramsSql, 'los parámetros (orden y nombre) deben coincidir con la función SQL');
});

test('C2. los métodos de la función son los de la base, y todo código que la base puede devolver tiene su HTTP', { skip: sinTs }, () => {
  const deSql = (texto) => [...texto.matchAll(/'(qr|transferencia|efectivo|\w+)'/g)].map((m) => m[1]);
  const check = SQL.match(/alertas_metodo_check check \(\(metodo = any \(array\[([^\]]*)\]/)[1];
  assert.deepEqual(deSql(check.replace(/::text/g, '')).sort(), [...LOGICA.METODOS].sort(), 'CHECK de alertas.metodo');
  const funcion = SQL.match(/create or replace function public\.alertar_cuenta[\s\S]*?\$function\$;/)[0];
  const lista = funcion.match(/p_metodo <> all \(array\[([^\]]*)\]/)[1];
  assert.deepEqual(deSql(lista).sort(), [...LOGICA.METODOS].sort(), 'lista de alertar_cuenta');
  const codigos = [...funcion.matchAll(/'codigo', '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(codigos)].sort(), ['enlace_invalido', 'metodo_invalido', 'sin_cuenta']);
  for (const c of codigos) assert.notEqual(LOGICA.respuestaDeRpc({ ok: false, codigo: c }).estado, 500, `el código ${c} no tiene traducción`);
  // y el límite de la alerta por mesa/IP está documentado donde se define
  assert.deepEqual({ ...LOGICA.LIMITE_MESA }, { ventanaMs: 60_000, max: 6 });
  assert.deepEqual({ ...LOGICA.LIMITE_IP }, { ventanaMs: 60_000, max: 30 });
});

// ───────────────────────── D. nada de correos reales (el repo es público) ─────────────────────────

test('D1. lo que esta ola agrega no trae ningún correo real: solo dominios de prueba, y los admins van con marcadores', () => {
  const archivos = [
    MIGRACION_REL,
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
  // el único «alta» en el repo son los marcadores: la migración los nombra pero no los trae como dato
  assert.doesNotMatch(SQL_SIN_COMENTARIOS, /insert into public\.personal[^;]*values\s*\(\s*'/i, 'un INSERT con un correo escrito en la migración');
});
