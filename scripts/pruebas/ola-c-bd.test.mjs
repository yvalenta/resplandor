// OLA C · C1 — las cuatro migraciones nuevas, leídas como texto (sin Docker, sin red, sin Supabase):
//
//   20261002150000_aprobacion_personal.sql   personal.estado, solicitar_acceso(), vista_pendiente(), personal_aprobar/_eliminar
//   20261002160000_mesas_y_pegatinas.sql     mesas.activa y las fechas de la pegatina, mesa_crear/_editar/_activar, pegatina_marcar
//   20261002170000_ajustes_ticket.sql        ajustes (una fila): URL del QR, si se ve, pie del ticket
//   20261002180000_deshacer_cobro.sql        ordenes.parcial_de, deshacer_cobro(), borrado de alertas viejas (D28)
//
// Lo que esta prueba fija es el CONTRATO que leen C2 (la lógica del POS) y C3 (la pantalla): los nombres y las firmas de cada RPC
// y de cada columna, quién puede ejecutar qué, los códigos de error, y las reglas que no deben cambiar sin querer (la ventana de
// 10 minutos, el tope de 50, el CHECK de la URL). Y las reglas de la casa: idempotentes, con reversa en la cabecera, search_path
// vacío en todo SECURITY DEFINER, sin correos reales (el repo es público).
//
// Lo que NO puede ver —que cada permiso pase o falle de verdad, que el total vuelva exacto, las carreras, que cada reversa devuelva
// el catálogo tal cual— lo prueban las sesiones reales contra un Postgres 17 desechable (Docker, roles de Supabase simulados):
// el arnés vive en el informe de C1 (scratchpad/ola-c/c1/bd/correr.sh) y trae mutantes que deben morir todos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(RAIZ, 'supabase', 'migrations');
const NOMBRES = {
  A: '20261002150000_aprobacion_personal.sql',
  B: '20261002160000_mesas_y_pegatinas.sql',
  C: '20261002170000_ajustes_ticket.sql',
  D: '20261002180000_deshacer_cobro.sql',
};
const SQL = Object.fromEntries(Object.entries(NOMBRES).map(([k, n]) => [k, fs.readFileSync(path.join(DIR, n), 'utf8')]));
const sinComentarios = (s) => s.replace(/--.*$/gm, '');
const SC = Object.fromEntries(Object.entries(SQL).map(([k, s]) => [k, sinComentarios(s)]));
const TODO_SC = Object.values(SC).join('\n');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
// El mismo texto en una sola línea: para fijar sentencias que el formato parte en renglones.
const CP = Object.fromEntries(Object.entries(SC).map(([k, sc]) => [k, compacto(sc)]));

/** El bloque «--   begin; … --   commit;» de la cabecera que sigue a «-- REVERSA», sin los guiones. */
function reversaDe(sql) {
  const lineas = sql.split('\n');
  const r = lineas.findIndex((l) => l.startsWith('-- REVERSA'));
  const ini = lineas.findIndex((l, i) => i > r && l === '--   begin;');
  const fin = lineas.findIndex((l, i) => i > ini && l === '--   commit;');
  assert.ok(r >= 0 && ini > r && fin > ini, 'no se encontró el bloque de REVERSA (begin … commit) en la cabecera');
  return lineas.slice(ini, fin + 1).map((l) => l.replace(/^--   /, '')).join('\n');
}

/** Cada `create or replace function public.x(args) <cabecera> as $function$` del texto sin comentarios. */
function funciones(sc) {
  return [...sc.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)([\s\S]*?)\bas \$function\$/g)]
    .map((m) => ({ nombre: m[1], args: compacto(m[2]), cabecera: compacto(m[3]) }));
}
const TODAS = Object.fromEntries(Object.entries(SC).map(([k, sc]) => [k, funciones(sc)]));
const buscar = (k, nombre) => {
  const f = TODAS[k].filter((x) => x.nombre === nombre);
  assert.ok(f.length >= 1, `${nombre} no está en ${NOMBRES[k]}`);
  return f[f.length - 1]; // la última definición del archivo es la que vale
};

// ───────────────────────── 1. el conjunto y su orden ─────────────────────────

test('C1-1. cuatro migraciones nuevas, después de las tres de la ola B, en este orden, con fechas únicas y cada cabecera nombra a sus hermanas', () => {
  const todas = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = todas.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  const nuevas = Object.values(NOMBRES);
  assert.deepEqual(nuevas, [...nuevas].sort(), 'orden alfabético = orden de aplicación');
  assert.ok(nuevas[0].split('_')[0] > '20261002140000', 'después de permisos_por_rol (ola B)');
  assert.deepEqual(todas.slice(-4), nuevas, 'son las cuatro últimas del directorio');
  for (const [k, sql] of Object.entries(SQL)) {
    for (const n of nuevas) assert.ok(sql.includes(n), `la cabecera de ${NOMBRES[k]} debe nombrar ${n}`);
    assert.ok(sql.includes(`${nuevas.indexOf(NOMBRES[k]) + 1} de 4`), `${NOMBRES[k]} dice cuál de las 4 es`);
  }
});

test('C1-2. cada una dice «idempotente», nombra su reversa en la cabecera y esa reversa es un bloque begin … commit', () => {
  for (const k of Object.keys(SQL)) {
    assert.match(SQL[k], /Idempotente/, `${NOMBRES[k]}: debe decir que es idempotente`);
    const cab = SQL[k].slice(0, SQL[k].indexOf('\n-- ══', 10) === -1 ? 4000 : SQL[k].lastIndexOf('-- ═════'));
    assert.match(SQL[k], /-- REVERSA \(menos de 1 minuto/, `${NOMBRES[k]}: la reversa debe declarar que se hace en menos de 1 minuto`);
    const r = reversaDe(SQL[k]);
    assert.match(r, /^begin;/);
    assert.match(r, /commit;$/);
    assert.ok(cab.length > 0);
  }
});

test('C1-3. ninguna nombra a una cuenta real: solo dominios de prueba o marcadores; sin propina; sin datos de pago', () => {
  const correos = TODO_SC.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
  for (const c of correos) assert.match(c, /@(resplandor\.test|ejemplo\.test)$/, `correo no permitido en una migración: ${c}`);
  for (const s of Object.values(SQL)) {
    const reales = s.match(/[\w.+-]+@(gmail|hotmail|outlook|yahoo|icloud)\.[a-z.]+/gi);
    assert.equal(reales, null, `correo real en una cabecera: ${reales}`);
    assert.doesNotMatch(s, /propina/i, 'propina: eliminada de todo');
  }
});

// ───────────────────────── 2. los contratos: firmas, grants, search_path ─────────────────────────

// [archivo, nombre, argumentos exactos, retorno, SECURITY DEFINER, quién puede ejecutar]
const RPC = [
  ['A', 'public.solicitar_acceso', '', 'returns jsonb', true, 'authenticated'],
  ['A', 'public.vista_pendiente', '', 'returns table(id integer, capacidad integer, estado text)', true, 'authenticated'],
  ['A', 'public.personal_aprobar', 'p_email text, p_rol text', 'returns jsonb', true, 'authenticated'],
  ['A', 'public.personal_eliminar', 'p_email text', 'returns jsonb', true, 'authenticated'],
  ['A', 'public.personal_alta', 'p_email text, p_nombre text, p_rol text', 'returns jsonb', true, 'authenticated'],
  ['A', 'public.personal_baja', 'p_email text', 'returns jsonb', true, 'authenticated'],
  ['A', 'public.personal_cambiar_rol', 'p_email text, p_rol text', 'returns jsonb', true, 'authenticated'],
  ['B', 'public.mesa_crear', 'p_id integer, p_capacidad integer', 'returns jsonb', true, 'authenticated'],
  ['B', 'public.mesa_editar', 'p_id integer, p_capacidad integer', 'returns jsonb', true, 'authenticated'],
  ['B', 'public.mesa_activar', 'p_id integer, p_activa boolean', 'returns jsonb', true, 'authenticated'],
  ['B', 'public.pegatina_marcar', 'p_id integer, p_tipo text', 'returns jsonb', true, 'authenticated'],
  ['D', 'public.deshacer_cobro', 'p_orden_id text', 'returns jsonb', true, 'authenticated'],
];

test('C1-4. las firmas finales de cada RPC son EXACTAMENTE las del contrato (nombre, argumentos, retorno), todas SECURITY DEFINER con search_path vacío', () => {
  for (const [k, nombre, args, retorno, definer] of RPC) {
    const f = buscar(k, nombre);
    assert.equal(f.args, args, `${nombre}: argumentos`);
    assert.ok(f.cabecera.startsWith(retorno), `${nombre}: ${retorno} (hay «${f.cabecera.slice(0, 80)}»)`);
    assert.equal(/\bsecurity definer\b/.test(f.cabecera), definer, `${nombre}: SECURITY DEFINER`);
    assert.match(f.cabecera, /set search_path = ''/, `${nombre}: search_path vacío`);
  }
});

test('C1-5. mi_rol() exige activo Y aprobado; sigue siendo la misma función (firma, definer, search_path vacío, grants)', () => {
  const f = buscar('A', 'public.mi_rol');
  assert.equal(f.args, '');
  assert.match(f.cabecera, /^returns text language sql stable security definer set search_path = ''/);
  const cuerpo = compacto(SC.A.slice(SC.A.indexOf('create or replace function public.mi_rol()'), SC.A.indexOf('create or replace function public.solicitar_acceso()')));
  assert.match(cuerpo, /where p\.activo and p\.estado = 'aprobado' and p\.email = \(select public\.mi_correo\(\)\)/);
  assert.match(SC.A, /grant execute on function public\.mi_rol\(\) to authenticated, service_role;/);
  assert.match(SC.A, /revoke all on function public\.mi_rol\(\) from public, anon;/);
});

test('C1-6. cada RPC se le quita a public y a anon, se le da a authenticated; las nuevas también se le quitan a service_role', () => {
  for (const [k, nombre, args, , , quien] of RPC) {
    const corto = nombre.replace('public.', '');
    const tipos = args === '' ? '' : args.split(',').map((a) => a.trim().split(' ')[1]).join(', ');
    const firma = `public.${corto}(${tipos})`;
    const rev = new RegExp(`revoke all on function ${firma.replace(/[()]/g, '\\$&')} from public, anon(, service_role)?;`);
    const gr = new RegExp(`grant execute on function ${firma.replace(/[()]/g, '\\$&')} to ${quien};`);
    assert.match(SC[k], rev, `${firma}: revoke`);
    assert.match(SC[k], gr, `${firma}: grant`);
    if (!['personal_alta', 'personal_baja', 'personal_cambiar_rol'].includes(corto)) {
      assert.match(SC[k], new RegExp(`revoke all on function ${firma.replace(/[()]/g, '\\$&')} from public, anon, service_role;`), `${firma}: también fuera de service_role`);
    }
    assert.doesNotMatch(SC[k], new RegExp(`grant execute on function ${firma.replace(/[()]/g, '\\$&')}[^;]*\\banon\\b`), `${firma}: anon nunca`);
  }
  // alertar_cuenta sigue siendo solo del service_role (SECURITY INVOKER)
  assert.match(SC.B, /revoke all on function public\.alertar_cuenta\(integer, text, text\) from public, anon, authenticated;/);
  assert.match(SC.B, /grant execute on function public\.alertar_cuenta\(integer, text, text\) to service_role;/);
  // las funciones de disparador no las ejecuta nadie de la API
  for (const [k, fn] of [['B', 'mesas_pegatina_obsoleta()'], ['B', 'mesas_columnas_solo_admin()'], ['C', 'ajustes_sellar()'], ['D', 'purgar_alertas_viejas()']]) {
    assert.match(SC[k], new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`), `${fn}: solo el disparador`);
  }
});

test('C1-7. toda función de las cuatro fija search_path vacío (alertar_cuenta y los disparadores también)', () => {
  for (const k of Object.keys(TODAS)) {
    for (const f of TODAS[k]) assert.match(f.cabecera, /set search_path = ''/, `${NOMBRES[k]}: ${f.nombre}`);
  }
  assert.ok(TODAS.A.length >= 8 && TODAS.B.length >= 8 && TODAS.C.length >= 1 && TODAS.D.length >= 2, 'el parser encontró las funciones');
});

// ───────────────────────── 3. A: aprobación de personal ─────────────────────────

test('C1-8. A: personal.estado y solicitado_en, las filas de hoy quedan aprobadas, el CHECK y la publicación de Realtime', () => {
  assert.match(SC.A, /alter table public\.personal add column if not exists estado text not null default 'aprobado'::text;/);
  assert.match(SC.A, /alter table public\.personal add column if not exists solicitado_en timestamp with time zone;/);
  assert.match(SC.A, /constraint = 'personal_estado_check'|conname = 'personal_estado_check'/);
  assert.match(SC.A, /check \(\(estado = any \(array\['pendiente'::text, 'aprobado'::text\]\)\)\)/);
  assert.match(SC.A, /pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal'/);
  assert.match(SC.A, /alter publication supabase_realtime add table public\.personal;/);
  // se niega a correr sin la compuerta
  assert.match(SC.A, /to_regprocedure\('public\.mi_rol\(\)'\) is null/);
  assert.match(SC.A, /Falta 20261002120000_personal_y_compuerta\.sql/);
});

test('C1-9. A: solicitar_acceso() crea la fila pendiente (mesero provisional), tope de 50, no resucita, sin Google no crea nada', () => {
  const cuerpo = compacto(SC.A.slice(SC.A.indexOf('create or replace function public.solicitar_acceso()'), SC.A.indexOf('create or replace function public.vista_pendiente()')));
  assert.match(cuerpo, /v_correo text := \(select public\.mi_correo\(\)\)/, 'el correo sale de mi_correo() (identidad de Google), no del JWT');
  assert.match(cuerpo, /'codigo', 'sin_google'/);
  assert.match(cuerpo, /estado = 'pendiente' and activo\) >= 50 then/);
  assert.match(cuerpo, /'codigo', 'tope'/);
  assert.match(cuerpo, /values \(v_correo, coalesce\(v_nombre, ''\), 'mesero', 'pendiente', now\(\)\)/);
  assert.match(cuerpo, /on conflict \(email\) do nothing/, 'nunca pisa una fila existente');
  assert.doesNotMatch(cuerpo, /update public\.personal/, 'solicitar_acceso no actualiza ninguna fila (no resucita)');
  assert.match(cuerpo, /if not v_fila\.activo then return jsonb_build_object\('estado', 'eliminado', 'rol', null\)/);
  assert.match(cuerpo, /raw_user_meta_data ->> 'full_name'/);
  assert.match(cuerpo, /raw_user_meta_data ->> 'name'/);
  assert.match(cuerpo, /\[\[:cntrl:\]\]/, 'sin caracteres de control en el nombre');
  assert.match(cuerpo, /, 80\)/, 'el nombre se corta a 80');
  assert.match(cuerpo, /pg_advisory_xact_lock\(hashtext\('resplandor\.personal'\)\)/, 'el mismo candado que el resto de la gestión del personal');
  // `rol` solo viene con aprobado
  assert.match(cuerpo, /'estado', 'aprobado', 'rol', v_fila\.rol/);
  assert.match(cuerpo, /'estado', 'pendiente', 'rol', null/);
});

test('C1-10. A: vista_pendiente() solo trae id, capacidad y estado (nunca token) y solo a una sesión de Google', () => {
  const fa = compacto(SC.A.slice(SC.A.indexOf('create or replace function public.vista_pendiente()'), SC.A.indexOf('-- ── 5.') > 0 ? undefined : undefined));
  for (const sc of [SC.A, SC.B]) {
    const i = sc.lastIndexOf('create or replace function public.vista_pendiente()');
    const cuerpo = compacto(sc.slice(i, sc.indexOf('$function$;', sc.indexOf('as $function$', i)) + 11));
    assert.match(cuerpo, /select m\.id, m\.capacidad, m\.estado from public\.mesas m/);
    assert.doesNotMatch(cuerpo, /token|total|items|ordenes/, 'ni token, ni totales, ni órdenes');
    assert.match(cuerpo, /coalesce\(\(select auth\.jwt\(\)\) -> 'app_metadata' ->> 'provider', ''\) = 'google'/);
  }
  assert.ok(fa.length > 0);
  // la de B agrega solo `m.activa`
  const iB = SC.B.lastIndexOf('create or replace function public.vista_pendiente()');
  assert.match(compacto(SC.B.slice(iB, iB + 700)), /where m\.activa and coalesce/);
});

test('C1-11. A: aprobar, eliminar, dar de alta y cambiar rol — guardias de admin, candado, y «último admin» cuenta solo aprobados', () => {
  for (const n of ['personal_aprobar', 'personal_eliminar', 'personal_alta', 'personal_cambiar_rol']) {
    const i = SC.A.indexOf(`create or replace function public.${n}(`);
    const cuerpo = compacto(SC.A.slice(i, SC.A.indexOf('$function$;', SC.A.indexOf('as $function$', i)) + 11));
    assert.match(cuerpo, /if \(select public\.mi_rol\(\)\) is distinct from 'admin' then return jsonb_build_object\('ok', false, 'codigo', 'no_autorizado'\)/, `${n}: solo admin`);
    assert.match(cuerpo, /pg_advisory_xact_lock\(hashtext\('resplandor\.personal'\)\)/, `${n}: candado`);
    // el rol se REVISA otra vez después del candado
    assert.equal((cuerpo.match(/is distinct from 'admin'/g) ?? []).length, 2, `${n}: revisa el rol dos veces (antes y después del candado)`);
  }
  const elim = compacto(SC.A.slice(SC.A.indexOf('create or replace function public.personal_eliminar('), SC.A.indexOf('create or replace function public.personal_alta(')));
  assert.match(elim, /v_fila\.rol = 'admin' and v_fila\.estado = 'aprobado' and \(select count\(\*\) from public\.personal where rol = 'admin' and activo and estado = 'aprobado'\) <= 1/);
  assert.match(elim, /'codigo', 'ultimo_admin'/);
  const camb = compacto(SC.A.slice(SC.A.indexOf('create or replace function public.personal_cambiar_rol('), SC.A.indexOf('-- Quién puede ejecutar qué')));
  assert.match(camb, /rol = 'admin' and activo and estado = 'aprobado'\) <= 1/);
  assert.match(camb, /'codigo', 'pendiente'/);
  const baja = compacto(SC.A.slice(SC.A.indexOf('create or replace function public.personal_baja('), SC.A.indexOf('create or replace function public.personal_cambiar_rol(')));
  assert.match(baja, /select public\.personal_eliminar\(p_email\)/, 'personal_baja = personal_eliminar');
  const apro = compacto(SC.A.slice(SC.A.indexOf('create or replace function public.personal_aprobar('), SC.A.indexOf('create or replace function public.personal_eliminar(')));
  assert.match(apro, /if not v_fila\.activo then .{0,120}'codigo', 'inactivo'/, 'aprobar no resucita a un eliminado');
  assert.match(apro, /'codigo', 'ya_aprobado'/);
  assert.match(apro, /update public\.personal set estado = 'aprobado', rol = p_rol where email = v_email/);
  const alta = compacto(SC.A.slice(SC.A.indexOf('create or replace function public.personal_alta('), SC.A.indexOf('create or replace function public.personal_baja(')));
  assert.match(alta, /if found and v_fila\.activo and v_fila\.estado = 'aprobado' then .{0,200}'ya_existe'/);
  assert.match(alta, /activo = true, estado = 'aprobado'/, 'el alta deja aprobado');
});

test('C1-12. A: la reversa borra los pendientes ANTES de devolver la mi_rol() vieja, y restaura las cuatro funciones y el comentario', () => {
  const r = reversaDe(SQL.A);
  const iBorrar = r.indexOf("delete from public.personal where estado = 'pendiente';");
  const iMiRol = r.indexOf('create or replace function public.mi_rol()');
  assert.ok(iBorrar > 0 && iMiRol > iBorrar, 'delete de pendientes antes de restaurar mi_rol()');
  assert.equal(r.split('\n')[1], "delete from public.personal where estado = 'pendiente';", 'es lo PRIMERO que hace la reversa (después de begin)');
  assert.doesNotMatch(r.slice(iMiRol, r.indexOf('create or replace function public.personal_alta')), /estado/, 'la mi_rol() restaurada no mira estado: es la de la compuerta');
  for (const n of ['mi_rol()', 'personal_alta(p_email text, p_nombre text, p_rol text)', 'personal_baja(p_email text)', 'personal_cambiar_rol(p_email text, p_rol text)']) {
    assert.ok(r.includes(`create or replace function public.${n}`), `restaura ${n}`);
  }
  for (const n of ['solicitar_acceso()', 'vista_pendiente()', 'personal_aprobar(text, text)', 'personal_eliminar(text)']) {
    assert.ok(r.includes(`drop function if exists public.${n};`), `quita ${n}`);
  }
  assert.match(r, /alter publication supabase_realtime drop table public\.personal;/);
  assert.match(r, /drop column if exists estado;/);
  assert.match(r, /drop column if exists solicitado_en;/);
  assert.match(r, /comment on function public\.mi_rol\(\) is/);
});

// ───────────────────────── 4. B: mesas y pegatinas ─────────────────────────

test('C1-13. B: las tres columnas de mesas, los códigos de cada RPC y los límites (id 1–9999, capacidad 1–50)', () => {
  assert.match(SC.B, /alter table public\.mesas add column if not exists activa boolean not null default true;/);
  assert.match(SC.B, /alter table public\.mesas add column if not exists pegatina_escrita_en timestamp with time zone;/);
  assert.match(SC.B, /alter table public\.mesas add column if not exists pegatina_revisada_en timestamp with time zone;/);
  const crear = compacto(SC.B.slice(SC.B.indexOf('create or replace function public.mesa_crear('), SC.B.indexOf('create or replace function public.mesa_editar(')));
  assert.match(crear, /p_id < 1 or p_id > 9999/);
  assert.match(crear, /p_capacidad < 1 or p_capacidad > 50/);
  assert.match(crear, /'codigo', 'id_invalido'/);
  assert.match(crear, /'codigo', 'capacidad_invalida'/);
  assert.match(crear, /on conflict \(id\) do nothing returning id into v_id/);
  assert.match(crear, /'codigo', 'ya_existe'/);
  assert.doesNotMatch(crear, /token/, 'el token sale del default de la columna: la RPC no lo toca ni lo devuelve');
  assert.match(crear, /jsonb_build_object\('ok', true, 'id', v_id\)/);
  const activar = compacto(SC.B.slice(SC.B.indexOf('create or replace function public.mesa_activar('), SC.B.indexOf('create or replace function public.pegatina_marcar(')));
  assert.match(activar, /select \* into v_mesa from public\.mesas where id = p_id for update/, 'candado sobre la mesa');
  assert.match(activar, /if not p_activa and v_mesa\.activa and exists \(select 1 from public\.ordenes o where o\.mesa_id = p_id and o\.estado = 'abierta'\)/);
  assert.match(activar, /'codigo', 'con_cuenta_abierta'/);
  assert.match(activar, /'codigo', 'activa_invalida'/);
  const peg = compacto(SC.B.slice(SC.B.indexOf('create or replace function public.pegatina_marcar('), SC.B.indexOf('-- ── 3. Girar el token')));
  assert.match(peg, /array\['escrita', 'revisada'\]/);
  assert.match(peg, /pegatina_escrita_en = now\(\), pegatina_revisada_en = null/, '«escrita» borra la revisión anterior');
  assert.match(peg, /'codigo', 'tipo_invalido'/);
  for (const n of ['mesa_crear', 'mesa_editar', 'mesa_activar', 'pegatina_marcar']) {
    const i = SC.B.indexOf(`create or replace function public.${n}(`);
    assert.match(compacto(SC.B.slice(i, i + 900)), /if \(select public\.mi_rol\(\)\) is distinct from 'admin' then return jsonb_build_object\('ok', false, 'codigo', 'no_autorizado'\)/, `${n}: solo admin`);
  }
});

test('C1-14. B: una mesa inactiva no existe para el comensal (alertar_cuenta, vista_pendiente) y girar el token deja la pegatina por reescribir', () => {
  const alerta = compacto(SC.B.slice(SC.B.lastIndexOf('create or replace function public.alertar_cuenta('), SC.B.lastIndexOf('-- ── 5.')));
  assert.match(alerta, /m\.id = p_mesa and m\.token = p_token and m\.activa/);
  // conserva todo lo de la migración de alertas: el tope de 5, el FOR SHARE y «mismo método no mueve la hora»
  assert.match(alerta, /for share/);
  assert.match(alerta, />= 5 then/);
  assert.match(alerta, /where t\.metodo is distinct from excluded\.metodo or t\.orden_id is distinct from excluded\.orden_id/);
  const base = compacto(SC.B.slice(SC.B.indexOf('create or replace function public.mesas_pegatina_obsoleta()'), SC.B.indexOf('-- ── 3b.')));
  assert.match(base, /new\.token is distinct from old\.token and not \(current_user in \('anon', 'authenticated'\) and \(select public\.mi_rol\(\)\) is distinct from 'admin'\)/);
  assert.match(base, /new\.pegatina_escrita_en := null; new\.pegatina_revisada_en := null/);
  assert.match(CP.B, /create trigger trg_mesas_pegatina_obsoleta before update of token on public\.mesas/);
});

test('C1-15. B: las columnas nuevas son del admin (el disparador conserva el valor viejo del mesero, sin error) y una mesa con cuenta abierta no se desactiva (RS002)', () => {
  const cuerpo = compacto(SC.B.slice(SC.B.indexOf('create or replace function public.mesas_columnas_solo_admin()'), SC.B.indexOf('-- ── 4.')));
  assert.match(cuerpo, /if current_user in \('anon', 'authenticated'\) and \(select public\.mi_rol\(\)\) is distinct from 'admin' then new\.activa := old\.activa; new\.pegatina_escrita_en := old\.pegatina_escrita_en; new\.pegatina_revisada_en := old\.pegatina_revisada_en; return new;/);
  assert.match(cuerpo, /if old\.activa and not new\.activa and exists \(select 1 from public\.ordenes o where o\.mesa_id = new\.id and o\.estado = 'abierta'\) then raise exception .* errcode = 'RS002'/);
  assert.match(cuerpo, /before update of activa, pegatina_escrita_en, pegatina_revisada_en on public\.mesas for each row when \(/);
  assert.doesNotMatch(cuerpo, /raise exception[^;]*'42501'/, 'el mesero no recibe error: el upsert de una caché vieja no se rompe');
});

test('C1-16. B: la reversa quita las funciones y disparadores, devuelve alertar_cuenta y vista_pendiente tal cual, y recién entonces quita las columnas', () => {
  const r = reversaDe(SQL.B);
  for (const n of ['mesa_crear(integer, integer)', 'mesa_editar(integer, integer)', 'mesa_activar(integer, boolean)', 'pegatina_marcar(integer, text)', 'mesas_pegatina_obsoleta()', 'mesas_columnas_solo_admin()']) {
    assert.ok(r.includes(`drop function if exists public.${n};`), `quita ${n}`);
  }
  assert.ok(r.includes('drop trigger if exists trg_mesas_pegatina_obsoleta on public.mesas;') && r.includes('drop trigger if exists trg_mesas_columnas_solo_admin on public.mesas;'));
  const iAlerta = r.indexOf('create or replace function public.alertar_cuenta(');
  const iVista = r.indexOf('create or replace function public.vista_pendiente()');
  const iCols = r.indexOf('drop column if exists activa;');
  assert.ok(iAlerta > 0 && iVista > 0 && iCols > Math.max(iAlerta, iVista), 'restaura las funciones ANTES de quitar la columna que usan');
  assert.doesNotMatch(r.slice(iAlerta, iCols), /m\.activa/, 'la alertar_cuenta restaurada no mira activa: es la de la migración de alertas');
  assert.match(r, /drop column if exists pegatina_revisada_en;/);
  assert.match(r, /drop column if exists pegatina_escrita_en;/);
});

// ───────────────────────── 5. C: ajustes del ticket ─────────────────────────

test('C1-17. C: ajustes tiene UNA fila (id = 1), la URL ≥ https:// con 3 a 200 caracteres sin espacios ni < > " ` \\, el pie ≤ 120', () => {
  assert.match(SC.C, /create table if not exists public\.ajustes \(/);
  assert.match(SC.C, /id smallint not null,/);
  assert.match(SC.C, /ticket_qr_url text not null default 'https:\/\/resplandor\.ynt\.codes\/'::text,/);
  assert.match(SC.C, /ticket_qr_visible boolean not null default true,/);
  assert.match(SC.C, /ticket_pie text not null default 'Gracias por su visita'::text,/);
  assert.match(SC.C, /actualizado_en timestamp with time zone not null default now\(\),/);
  assert.match(SC.C, /actualizado_por text,/);
  assert.match(SC.C, /constraint ajustes_una_sola_fila check \(\(id = 1\)\)/);
  assert.match(SC.C, /constraint ajustes_ticket_qr_url_check check \(\(ticket_qr_url ~ '\^https:\/\/\[\^\\s\]\{3,200\}\$'::text\)\)/);
  assert.match(SC.C, /constraint ajustes_ticket_qr_url_segura check \(\(ticket_qr_url !~ '\[<>"`\\\\\]'::text\)\)/);
  assert.match(SC.C, /constraint ajustes_ticket_pie_check check \(\(length\(ticket_pie\) <= 120\)\)/);
  assert.match(SC.C, /insert into public\.ajustes \(id\) values \(1\) on conflict \(id\) do nothing;/, 'la fila 1 la crea la migración y no se pisa al volver a correr');
  // los mismos tres campos que lee y escribe el POS (store: ajustes {ticketQrUrl, ticketQrVisible, ticketPie})
  assert.doesNotMatch(SC.C, /on conflict \(id\) do update/, 'volver a correr nunca pisa lo que el admin configuró');
});

test('C1-18. C: SELECT para el personal aprobado, UPDATE solo del admin, sin INSERT ni DELETE, GRANT explícitos, la compuerta restrictiva y el sello de la base', () => {
  assert.match(SC.C, /alter table public\.ajustes enable row level security;/);
  assert.match(CP.C, /create policy ajustes_ver on public\.ajustes for select to authenticated using \(\(select public\.mi_rol\(\)\) is not null\);/);
  assert.match(compacto(SC.C), /create policy ajustes_editar on public\.ajustes for update to authenticated using \(\(select public\.mi_rol\(\)\) = 'admin'\) with check \(\(select public\.mi_rol\(\)\) = 'admin'\);/);
  assert.match(CP.C, /create policy solo_personal on public\.ajustes as restrictive for all to authenticated/);
  assert.doesNotMatch(SC.C, /create policy \w+ on public\.ajustes for (insert|delete)/);
  assert.match(SC.C, /revoke all on public\.ajustes from anon, authenticated, service_role;/);
  assert.match(SC.C, /grant select, update on public\.ajustes to authenticated;/);
  assert.doesNotMatch(SC.C, /grant [^;]*\b(insert|delete|all)\b[^;]* on public\.ajustes/i);
  const sello = compacto(SC.C.slice(SC.C.indexOf('create or replace function public.ajustes_sellar()'), SC.C.indexOf('drop trigger if exists trg_ajustes_sellar')));
  assert.match(sello, /new\.actualizado_en := now\(\)/);
  assert.match(sello, /case when current_user in \('anon', 'authenticated'\) then \(select public\.mi_correo\(\)\) else 'sistema' end/);
  assert.match(CP.C, /create trigger trg_ajustes_sellar before update on public\.ajustes/);
  assert.match(SC.C, /Falta 20261002120000_personal_y_compuerta\.sql/, 'se niega a correr sin la compuerta');
  const r = reversaDe(SQL.C);
  assert.match(r, /drop table if exists public\.ajustes;/);
  assert.match(r, /drop function if exists public\.ajustes_sellar\(\);/);
});

// ───────────────────────── 6. D: deshacer cobro y D28 ─────────────────────────

test('C1-19. D: ordenes.parcial_de (text, null, sin clave foránea) y deshacer_cobro con sus cinco códigos y la ventana de 10 minutos', () => {
  assert.match(SC.D, /alter table public\.ordenes add column if not exists parcial_de text;/);
  assert.doesNotMatch(SC.D, /parcial_de[^;]*references/i, 'sin clave foránea: el cierre del día borra órdenes');
  const i = SC.D.indexOf('create or replace function public.deshacer_cobro(');
  const cuerpo = compacto(SC.D.slice(i, SC.D.indexOf('$function$;', SC.D.indexOf('as $function$', i)) + 11));
  for (const c of ['no_autorizado', 'no_existe', 'no_es_parcial', 'cuenta_ya_cerrada', 'ventana_vencida']) assert.match(cuerpo, new RegExp(`'codigo', '${c}'`), c);
  assert.match(cuerpo, /select \* into c from public\.ordenes where id = p_orden_id for update/, 'candado sobre la orden cerrada');
  assert.match(cuerpo, /select \* into a from public\.ordenes where id = c\.parcial_de for update/, 'candado sobre la abierta (después)');
  assert.ok(cuerpo.indexOf('into c from') < cuerpo.indexOf('into a from'), 'siempre la cerrada primero y la abierta después: sin interbloqueo');
  assert.match(cuerpo, /if v_rol <> 'admin' and \(c\.cerrada_en is null or c\.cerrada_en <= now\(\) - interval '10 minutes'\)/, 'el mesero, 10 minutos (estricto); el admin, siempre');
  assert.match(cuerpo, /if c\.estado <> 'cerrada' or c\.parcial_de is null then/);
  assert.match(cuerpo, /if not found or a\.estado <> 'abierta' then/);
  assert.match(cuerpo, /like 'abono\\_%'/, 'un abono se reconoce por su id abono_<uid>');
  assert.match(cuerpo, /'abono_recibido_' \|\| substr\(it ->> 'id', 7\)/, 'y su línea es abono_recibido_<uid>');
  assert.match(cuerpo, /sum\(\(e ->> 'precio'\)::numeric \* \(e ->> 'qty'\)::int\)/, 'total = Σ precio × qty');
  assert.match(cuerpo, /version = coalesce\(a\.version, 0\) \+ 1/);
  assert.match(cuerpo, /delete from public\.ordenes where id = c\.id;/);
  assert.match(cuerpo, /jsonb_build_object\('ok', true, 'total_abierta', a\.total, 'orden_id', a\.id, 'mesa_id', a\.mesa_id, 'monto', c\.total, 'version', a\.version\)/);
  // el UPDATE de la abierta no cambia `estado`: ningún disparador de alertas se mueve; el DELETE es de una cerrada: la señal no emite
  assert.doesNotMatch(cuerpo, /set[^;]*\bestado\b/, 'no cambia el estado de ninguna orden');
});

test('C1-20. D: las alertas resueltas de más de un día se borran con tres disparadores de sentencia (crear, resolver, cerrar el día) y nadie gana DELETE', () => {
  const f = compacto(SC.D.slice(SC.D.indexOf('create or replace function public.purgar_alertas_viejas()'), SC.D.indexOf('revoke all on function public.purgar_alertas_viejas()')));
  assert.match(f, /security definer set search_path = ''/);
  assert.match(f, /delete from public\.alertas where estado <> 'pendiente' and atendida_en < now\(\) - interval '1 day'/);
  assert.match(CP.D, /create trigger trg_alertas_nueva_purga after insert on public\.alertas for each statement/);
  assert.match(CP.D, /create trigger trg_alertas_resuelta_purga after update of estado on public\.alertas for each statement/);
  assert.match(CP.D, /create trigger trg_cierres_purga_alertas after insert on public\.cierres for each statement/);
  assert.doesNotMatch(TODO_SC, /grant [^;]*delete[^;]* on public\.alertas/i, 'ni el POS ni service_role ganan DELETE sobre alertas');
  const r = reversaDe(SQL.D);
  for (const t of ['trg_cierres_purga_alertas on public.cierres', 'trg_alertas_nueva_purga on public.alertas', 'trg_alertas_resuelta_purga on public.alertas']) assert.ok(r.includes(`drop trigger if exists ${t};`), t);
  assert.ok(r.includes('drop function if exists public.purgar_alertas_viejas();') && r.includes('drop function if exists public.deshacer_cobro(text);'));
  assert.ok(r.includes('alter table public.ordenes drop column if exists parcial_de;'));
});

// ───────────────────────── 7. idempotencia ─────────────────────────

test('C1-21. idempotentes: columnas con IF NOT EXISTS, tabla con IF NOT EXISTS, cada trigger y policy precedidos de su DROP IF EXISTS, funciones con CREATE OR REPLACE', () => {
  for (const [k, sc] of Object.entries(SC)) {
    for (const m of sc.matchAll(/alter table ([\w.]+) add column (?!if not exists)/g)) assert.fail(`${NOMBRES[k]}: add column sin if not exists en ${m[1]}`);
    assert.doesNotMatch(sc, /create table (?!if not exists)/, `${NOMBRES[k]}: create table sin if not exists`);
    assert.doesNotMatch(sc, /create function /, `${NOMBRES[k]}: create function sin or replace`);
    for (const m of sc.matchAll(/create trigger (\w+)\s+(?:before|after)[\s\S]*?on ([\w.]+)/g)) {
      assert.match(sc, new RegExp(`drop trigger if exists ${m[1]} on ${m[2].replace('.', '\\.')};`), `${NOMBRES[k]}: trigger ${m[1]} sin drop previo`);
    }
    for (const m of sc.matchAll(/create policy (\w+) on ([\w.]+)/g)) {
      assert.match(sc, new RegExp(`drop policy if exists ${m[1]} on ${m[2].replace('.', '\\.')};`), `${NOMBRES[k]}: policy ${m[1]} sin drop previo`);
    }
  }
});

test('C1-22. el aviso de re-pegado: A dice que volver a pegar la compuerta (que redefine mi_rol() sin estado) obliga a pegar A otra vez', () => {
  // La compuerta (20261002120000) redefine mi_rol(), personal_alta/baja/cambiar_rol: si se vuelve a pegar DESPUÉS de A, una fila
  // pendiente entraría como mesero. No se edita esa migración (ya está aplicada): el aviso va en la cabecera de A y en los pasos.
  const cab = SQL.A.slice(0, SQL.A.indexOf('-- ── 0.'));
  assert.match(plano(cab), /vuelve a pegar 20261002120000|volver a pegar 20261002120000|NO volver a pegar la compuerta/i);
});
function plano(s) { return s.replace(/^--\s?/gm, '').replace(/\s+/g, ' '); }
