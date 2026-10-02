// OLA C · C1 — las cuatro migraciones nuevas, leídas como texto (sin Docker, sin red, sin Supabase):
//
//   20261002150000_aprobacion_personal.sql   personal.estado, solicitar_acceso(), vista_pendiente(), personal_aprobar/_eliminar
//   20261002160000_mesas_y_pegatinas.sql     mesas.activa y las fechas de la pegatina, mesa_crear/_editar/_activar, pegatina_marcar
//   20261002170000_ajustes_ticket.sql        ajustes (una fila): URL del QR, si se ve, pie del ticket
//   20261002180000_deshacer_cobro.sql        ordenes.parcial_de, deshacer_cobro(), borrado de alertas viejas (D28)
//
// Lo que esta prueba fija es el CONTRATO que leen C2 (la lógica del POS) y C3 (la pantalla): los nombres y las firmas de cada RPC
// y de cada columna, quién puede ejecutar qué, los códigos de error, y las reglas que no deben cambiar sin querer (deshacer SIN
// ventana de tiempo, el tope de 50, el CHECK de la URL). Y las reglas de la casa: idempotentes, con reversa en la cabecera, search_path
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
  ['B', 'public.pegatina_marcar', 'p_id integer, p_tipo text, p_token text', 'returns jsonb', true, 'authenticated'],
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
  for (const [k, fn] of [['B', 'mesas_pegatina_obsoleta()'], ['B', 'mesas_columnas_solo_admin()'], ['C', 'ajustes_sellar()'], ['D', 'purgar_alertas_viejas()'],
                          ['D', 'purgar_deshechos_viejos()'], ['D', 'ordenes_guardia()']]) {
    assert.match(SC[k], new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`), `${fn}: solo el disparador`);
  }
  // el ayudante de deshacer_cobro no lo ejecuta nadie de la API
  assert.match(SC.D, /revoke all on function public\.deshacer_cobro_sumar\(jsonb, jsonb\) from public, anon, authenticated, service_role;/);
});

test('C1-7. toda función de las cuatro fija search_path vacío (alertar_cuenta y los disparadores también); la única excepción es aplicar_delta_orden, que es la de la base tal cual (SECURITY INVOKER, search_path = public)', () => {
  for (const k of Object.keys(TODAS)) {
    for (const f of TODAS[k]) {
      if (f.nombre === 'public.aplicar_delta_orden') {
        assert.match(f.cabecera, /^returns public\.ordenes language plpgsql set search_path = public$/, 'aplicar_delta_orden: SECURITY INVOKER, como la de 20261002140000 (al mesero la RLS le esconde una orden cerrada)');
        continue;
      }
      assert.match(f.cabecera, /set search_path = ''/, `${NOMBRES[k]}: ${f.nombre}`);
    }
  }
  // los ayudantes del esquema privado (fuera de PostgREST) también: SECURITY DEFINER con search_path vacío
  for (const fn of ['orden_archivada', 'deltas_marcar', 'delta_registrar']) {
    const i = SC.D.indexOf(`create or replace function privado.${fn}(`);
    assert.ok(i >= 0, `privado.${fn}`);
    const cab = compacto(SC.D.slice(i, SC.D.indexOf('as $function$', i)));
    assert.match(cab, /security definer set search_path = ''/, `privado.${fn}: SECURITY DEFINER con search_path vacío`);
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
  // La capacidad se conserva para TODA sesión de la API (también la del admin: la caja con la caché vieja no la pisa; solo la cambia mesa_editar);
  // lo demás (activa y las fechas de la pegatina) solo se conserva si quien llama no es admin.
  assert.match(cuerpo, /if current_user in \('anon', 'authenticated'\) then new\.capacidad := old\.capacidad; if \(select public\.mi_rol\(\)\) is distinct from 'admin' then new\.activa := old\.activa; new\.pegatina_escrita_en := old\.pegatina_escrita_en; new\.pegatina_revisada_en := old\.pegatina_revisada_en; return new; end if; end if;/);
  assert.match(cuerpo, /if old\.activa and not new\.activa and exists \(select 1 from public\.ordenes o where o\.mesa_id = new\.id and o\.estado = 'abierta'\) then raise exception .* errcode = 'RS002'/);
  assert.match(cuerpo, /before update of activa, capacidad, pegatina_escrita_en, pegatina_revisada_en on public\.mesas for each row when \(/);
  assert.doesNotMatch(cuerpo, /raise exception[^;]*'42501'/, 'el mesero no recibe error: el upsert de una caché vieja no se rompe');
});

test('C1-16. B: la reversa quita las funciones y disparadores, devuelve alertar_cuenta y vista_pendiente tal cual, y recién entonces quita las columnas', () => {
  const r = reversaDe(SQL.B);
  for (const n of ['mesa_crear(integer, integer)', 'mesa_editar(integer, integer)', 'mesa_activar(integer, boolean)', 'pegatina_marcar(integer, text, text)', 'mesas_pegatina_obsoleta()', 'mesas_columnas_solo_admin()']) {
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
  assert.ok(r.includes('drop constraint if exists mesas_capacidad_rango;'), 'la reversa quita el tope de capacidad');
});

test('C1-16b. B: pegatina_marcar compara el token que de verdad se escribió o se leyó (enlace_cambio) y la capacidad va de 1 a 50 y solo la cambia el admin', () => {
  const i = SC.B.indexOf('create or replace function public.pegatina_marcar(');
  const cuerpo = compacto(SC.B.slice(i, SC.B.indexOf('$function$;', SC.B.indexOf('as $function$', i)) + 11));
  for (const c of ['no_autorizado', 'tipo_invalido', 'token_invalido', 'no_existe', 'enlace_cambio']) assert.match(cuerpo, new RegExp(`'codigo', '${c}'`), c);
  assert.match(cuerpo, /select \* into v_mesa from public\.mesas where id = p_id for update;/, 'candado sobre la mesa: nadie gira el token entre la lectura y la anotación');
  assert.match(cuerpo, /if v_mesa\.token <> p_token then return jsonb_build_object\('ok', false, 'codigo', 'enlace_cambio'\);/);
  assert.match(CP.B, /drop function if exists public\.pegatina_marcar\(integer, text\);/, 'la de dos parámetros se va (si no, PostgREST ve dos candidatas)');
  // un 'escrita' borra la revisión anterior; un 'revisada' no toca la fecha de escritura
  assert.match(cuerpo, /if p_tipo = 'escrita' then update public\.mesas set pegatina_escrita_en = now\(\), pegatina_revisada_en = null where id = p_id/);
  assert.match(CP.B, /alter table public\.mesas add constraint mesas_capacidad_rango check \(capacidad between 1 and 50\);/);
  assert.match(CP.B, /alter table public\.mesas drop constraint if exists mesas_capacidad_rango;/, 'idempotente');
  assert.match(CP.B, /Hay mesas con capacidad fuera de 1 a 50/, 'no agrega el tope sobre datos que ya lo incumplen: se niega sin cambiar nada');
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

/** El cuerpo de una función de la migración D, en una línea. */
function cuerpoD(nombre) {
  const i = SC.D.indexOf(`create or replace function public.${nombre}(`);
  assert.ok(i >= 0, `${nombre} no está en la migración D`);
  return compacto(SC.D.slice(i, SC.D.indexOf('$function$;', SC.D.indexOf('as $function$', i)) + 11));
}

test('C1-19. D: ordenes.parcial_de (text, null, sin clave foránea) y deshacer_cobro SIN ventana: admin y mesero, tres tipos, misma mesa, abono exacto y monto real', () => {
  assert.match(SC.D, /alter table public\.ordenes add column if not exists parcial_de text;/);
  assert.doesNotMatch(SC.D, /parcial_de[^;]*references/i, 'sin clave foránea: el cierre del día borra órdenes');
  // Decisión de Yonatan, 2026-10-01: «el pedido se podrá deshacer cuando quiera el mesero o el admin». Ni rastro de la ventana.
  assert.doesNotMatch(TODO_SC, /ventana_vencida|10 minutes|cerrada_servidor_en|sellar_cobro/, 'sin ventana de 10 minutos ni la columna que la medía');
  for (const [k, sql] of Object.entries(SQL)) assert.doesNotMatch(sql, /10 minutos|ventana_vencida/i, `${NOMBRES[k]}: ni una palabra de la ventana de 10 minutos`);
  const cuerpo = cuerpoD('deshacer_cobro');
  for (const c of ['no_autorizado', 'no_existe', 'no_es_parcial', 'cuenta_ya_cerrada', 'mesa_inactiva', 'ya_en_cierre']) assert.match(cuerpo, new RegExp(`'codigo', '${c}'`), c);
  assert.match(cuerpo, /if v_rol is null then return jsonb_build_object\('ok', false, 'codigo', 'no_autorizado'\);/, 'sin rol, nada; con rol (admin o mesero), sí');
  assert.doesNotMatch(cuerpo, /v_rol <>|v_rol =/, 'el rol no distingue admin de mesero: no hay ventana');
  // candados, en este orden: los hijos de la orden, la orden, la mesa (cobro completo) y la cuenta abierta: sin interbloqueo
  assert.match(cuerpo, /perform 1 from public\.ordenes h where h\.parcial_de = p_orden_id order by h\.id for update;/, 'primero los cobros que salieron de ella');
  assert.match(cuerpo, /select \* into c from public\.ordenes where id = p_orden_id for update/, 'candado sobre la orden cerrada');
  assert.match(cuerpo, /select \* into a from public\.ordenes where id = c\.parcial_de for update/, 'candado sobre la abierta (después)');
  assert.match(cuerpo, /select \* into v_mesa from public\.mesas where id = c\.mesa_id for update;/, 'el cobro completo cierra el paso a quien abre una orden en esa mesa');
  assert.ok(cuerpo.indexOf('h.parcial_de = p_orden_id') < cuerpo.indexOf('into c from') && cuerpo.indexOf('into c from') < cuerpo.indexOf('into a from'),
    'siempre los hijos, la cerrada y la abierta: el mismo orden en todas las rutas');
  // las reglas que no se negocian
  assert.match(cuerpo, /if a\.mesa_id <> c\.mesa_id then return jsonb_build_object\('ok', false, 'codigo', 'no_es_parcial'\);/, 'misma mesa');
  assert.match(cuerpo, /if not found or a\.estado <> 'abierta' then/);
  assert.match(cuerpo, /if exists \(select 1 from public\.cierre_ordenes x where x\.orden_id = c\.id\) then return jsonb_build_object\('ok', false, 'codigo', 'ya_en_cierre'\);/, 'una orden ya archivada en un cierre (cierre_ordenes) no se deshace');
  assert.match(cuerpo, /like 'abono\\_%'/, 'un abono se reconoce por su id abono_<uid>');
  assert.match(cuerpo, /'abono_recibido_' \|\| v_uid/, 'y su línea es abono_recibido_<uid>');
  assert.match(cuerpo, /v_n <> 1/, 'UNA sola línea de abono recibido');
  assert.match(cuerpo, /\(v_credito ->> 'qty'\)::int <> 1 or \(v_credito ->> 'precio'\)::numeric <> -\(\(it ->> 'precio'\)::numeric\)/, 'cantidad 1 y precio igual al opuesto del abono');
  assert.match(cuerpo, /sum\(\(e ->> 'precio'\)::numeric \* \(e ->> 'qty'\)::int\)/, 'total = Σ precio × qty');
  assert.match(cuerpo, /v_monto := v_total - v_antes;/, 'el monto es lo que de verdad volvió, no el total de la cerrada');
  assert.match(cuerpo, /version = coalesce\(a\.version, 0\) \+ 1/);
  assert.match(cuerpo, /delete from public\.ordenes where id = c\.id;/);
  assert.match(cuerpo, /update public\.ordenes set parcial_de = a\.id where parcial_de = c\.id;/, 'al fusionar, los abonos pasan a la cuenta que los recibe');
  assert.match(cuerpo, /set estado = 'abierta', cerrada_en = null/, 'el cobro completo con la mesa libre se reabre');
  assert.match(cuerpo, /update public\.mesas set estado = 'ocupada' where id = c\.mesa_id;/);
  assert.match(cuerpo, /jsonb_build_object\('ok', true, 'tipo', v_tipo, 'total_abierta', a\.total, 'orden_id', a\.id, 'mesa_id', a\.mesa_id, 'monto', v_monto, 'version', a\.version, 'reabierta', v_reabierta, 'fusionada', v_fusionada\)/);
  // cada deshacer deja su fila: quién (correo de la sesión), cuándo (hora del servidor)
  assert.match(cuerpo, /insert into public\.deshechos \(orden_id, mesa_id, tipo, monto, items, hecho_por\) values \(c\.id, c\.mesa_id, v_tipo, v_monto, c\.items, coalesce\(\(select public\.mi_correo\(\)\), ''\)\);/);
});

test('C1-19b. D: `deshechos` solo la escribe deshacer_cobro y solo la lee el admin; se guarda 90 días y se purga al guardar un cierre', () => {
  assert.match(CP.D, /create table if not exists public\.deshechos \( id bigint generated always as identity, orden_id text not null, mesa_id integer not null, tipo text not null, monto numeric not null, items jsonb not null default '\[\]'::jsonb, hecho_por text not null default ''::text, hecho_en timestamp with time zone not null default now\(\)/);
  assert.match(CP.D, /check \(\(tipo = any \(array\['parcial'::text, 'abono'::text, 'completo'::text\]\)\)\)/);
  assert.match(CP.D, /alter table public\.deshechos enable row level security;/);
  assert.match(CP.D, /create policy deshechos_ver on public\.deshechos for select to authenticated using \(\(select public\.mi_rol\(\)\) = 'admin'\);/, 'solo el admin lee');
  assert.match(CP.D, /revoke all on public\.deshechos from anon, authenticated, service_role;/);
  assert.match(CP.D, /grant select on public\.deshechos to authenticated;/);
  assert.doesNotMatch(TODO_SC, /grant [^;]*(insert|update|delete)[^;]* on public\.deshechos/i, 'nadie escribe en deshechos por la API: solo la función');
  const f = cuerpoD('purgar_deshechos_viejos');
  assert.match(f, /security definer set search_path = ''/);
  assert.match(f, /delete from public\.deshechos where hecho_en < now\(\) - interval '90 days';/);
  assert.match(CP.D, /create trigger trg_cierres_purga_deshechos after insert on public\.cierres for each statement/);
  const r = reversaDe(SQL.D);
  for (const x of ['drop trigger if exists trg_cierres_purga_deshechos on public.cierres;', 'drop function if exists public.purgar_deshechos_viejos();', 'drop table if exists public.deshechos;']) assert.ok(r.includes(x), x);
});

test('C1-19c. D: el guardia de `ordenes` conserva parcial_de en UPDATE, lo anula al reabrir o editar, y rechaza cerrar con una version vieja (RS003)', () => {
  const f = cuerpoD('ordenes_guardia');
  assert.match(f, /v_api boolean := current_user in \('anon', 'authenticated'\)/, 'solo frena a las sesiones de la API');
  assert.match(f, /if v_api and old\.estado = 'abierta' and new\.estado = 'cerrada' and new\.version is distinct from old\.version then raise exception .* using errcode = 'RS003';/);
  assert.match(f, /if new\.items is distinct from old\.items and new\.version is not distinct from old\.version then new\.version := coalesce\(old\.version, 0\) \+ 1;/, 'la version sigue a los ítems');
  assert.match(f, /if v_api then new\.parcial_de := old\.parcial_de; end if;/, 'parcial_de no cambia por UPDATE (ni siquiera el admin)');
  assert.match(f, /if old\.estado = 'cerrada' and \(new\.estado is distinct from 'cerrada' or new\.items is distinct from old\.items or new\.total is distinct from old\.total or new\.mesa_id is distinct from old\.mesa_id\) then new\.parcial_de := null;/);
  assert.match(CP.D, /create trigger trg_ordenes_guardia before insert or update on public\.ordenes for each row execute function public\.ordenes_guardia\(\);/);
  const r = reversaDe(SQL.D);
  assert.ok(r.includes('drop trigger if exists trg_ordenes_guardia on public.ordenes;') && r.includes('drop function if exists public.ordenes_guardia();'));
});

test('C1-19d. D (ronda 5): cerrar_dia lo decide la base: solo admin, el candado de aviso común con deshacer_cobro, toma TODAS las cerradas que ningún cierre se llevó, rechaza con cuentas abiertas o si no es lo que el POS espera, y NUNCA borra una cuenta abierta', () => {
  const f = cuerpoD('cerrar_dia');
  assert.match(CP.D, /create or replace function public\.cerrar_dia\(p_id text, p_esperado jsonb\) returns jsonb language plpgsql security definer set search_path = ''/);
  assert.match(CP.D, /drop function if exists public\.cerrar_dia\(text, timestamp with time zone, numeric, jsonb, jsonb\);/, 'la firma de la ronda 4 se va (si no, PostgREST vería dos candidatas)');
  for (const c of ['no_autorizado', 'invalido', 'hay_abiertas', 'sin_ventas', 'cambio']) assert.match(f, new RegExp(`'codigo', '${c}'`), c);
  assert.match(f, /if v_rol is distinct from 'admin' then return jsonb_build_object\('ok', false, 'codigo', 'no_autorizado'\);/, 'solo el admin cierra el día');
  assert.match(f, /p_esperado is null or jsonb_typeof\(p_esperado\) <> 'object' then return jsonb_build_object\('ok', false, 'codigo', 'invalido'\);/, 'no se cierra a ciegas: sin lo que el POS espera, invalido');
  // el candado de aviso lo toman las DOS funciones, antes que cualquier candado de fila (sin él, deshacer y cerrar se cruzan)
  const dc = cuerpoD('deshacer_cobro');
  for (const [nombre, cuerpo, antes] of [['cerrar_dia', f, 'perform 1 from public.ordenes where estado'], ['deshacer_cobro', dc, 'perform 1 from public.ordenes h']]) {
    assert.match(cuerpo, /perform pg_advisory_xact_lock\(hashtext\('resplandor\.cobros'\)\);/, `${nombre}: el candado de aviso común`);
    assert.ok(cuerpo.indexOf('pg_advisory_xact_lock') < cuerpo.indexOf(antes), `${nombre}: el candado de aviso va antes que los de fila`);
  }
  // TODAS las cerradas que ningún cierre se llevó (de cualquier día), con candado y en orden; las ya archivadas aparte
  assert.match(f, /perform 1 from public\.ordenes where estado = 'cerrada' order by id for update;/, 'las ventas, con candado y en orden');
  assert.match(f, /filter \(where not exists \(select 1 from public\.cierre_ordenes c where c\.orden_id = o\.id\)\)[\s\S]*filter \(where exists \(select 1 from public\.cierre_ordenes c where c\.orden_id = o\.id\)\)[\s\S]*into v_ids, v_ya from public\.ordenes o where o\.estado = 'cerrada';/, 'v_ids: las que ningún cierre se llevó; v_ya: los rezagos ya archivados');
  assert.doesNotMatch(f, /cerrada_en\s*(>|<|::date)|current_date|toDateString/, 'ninguna fecha: no importa de qué día es la venta');
  // rechazos
  assert.match(f, /select array_agg\(distinct o\.mesa_id order by o\.mesa_id\) into v_abiertas from public\.ordenes o where o\.estado = 'abierta';/, 'cualquier cuenta abierta');
  assert.match(f, /if v_abiertas is not null then[\s\S]*return jsonb_build_object\('ok', false, 'codigo', 'hay_abiertas', 'abiertas', to_jsonb\(v_abiertas\), 'en_cierre', coalesce\(to_jsonb\(v_enlazadas\), '\[\]'::jsonb\), 'resumen', v_resumen\);/, 'hay_abiertas dice además cuáles de esas mesas están en un cierre (en_cierre), la salida del RS005');
  assert.match(f, /if v_n = 0 then return jsonb_build_object\('ok', false, 'codigo', 'sin_ventas', 'resumen', v_resumen\);/);
  // el admin firma lo que ve: cantidad, total y cuáles
  assert.ok(f.includes("if p_esperado ->> 'n' is distinct from v_n::text or (case when p_esperado ->> 'total' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (p_esperado ->> 'total')::numeric else null end) is distinct from v_total then return jsonb_build_object('ok', false, 'codigo', 'cambio', 'resumen', v_resumen);"), 'la cantidad y el total que el POS espera (un total que no es número también es un cambio, no un error)');
  assert.match(f, /if v_esp_ids is distinct from v_ids then return jsonb_build_object\('ok', false, 'codigo', 'cambio', 'resumen', v_resumen\);/, 'y cuáles ventas');
  // NUNCA borra una abierta: el único DELETE de órdenes lleva ids que salieron de `estado = 'cerrada'`
  const borrados = [...f.matchAll(/delete from public\.ordenes where ([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(borrados, ['id = any(v_ids) or id = any(v_ya)'], 'un solo borrado, de lo archivado y de los rezagos');
  assert.ok(f.indexOf("o.estado = 'cerrada'") < f.indexOf('delete from public.ordenes'), 'y v_ids / v_ya se arman solo de cerradas');
  // cierre + borrado + deltas + deshechos, en esta transacción; la hora es la del servidor
  assert.match(f, /insert into public\.cierres \(id, fecha, total_ventas, total_ordenes, transacciones\) values \(p_id, v_fecha, v_total, v_n, v_trans\);/);
  assert.match(f, /v_fecha timestamp with time zone := now\(\)/, 'la hora del cierre es la del servidor');
  assert.match(f, /delete from public\.deltas_aplicados d where not exists \(select 1 from public\.ordenes o where o\.id = d\.orden_id\);/, 'los deltas de lo archivado se purgan con el cierre');
  assert.match(f, /update public\.deshechos set cierre_id = p_id where cierre_id is null returning \*/, 'los deshechos del turno cuelgan de este cierre');
  assert.match(f, /select \* into v_cierre from public\.cierres where id = p_id; if found then/, 'un reintento del mismo cierre devuelve el que ya se guardó');
  assert.match(f, /'mesaId', o\.mesa_id, 'estado', 'cerrada', 'items', o\.items, 'total', o\.total, 'abiertaEn', o\.abierta_en, 'cerradaEn', o\.cerrada_en, 'version', o\.version, 'parcialDe', o\.parcial_de/, 'cada venta como la guarda el POS (mesaId, cerradaEn…)');
  // permisos y reversa
  assert.match(CP.D, /revoke all on function public\.cerrar_dia\(text, jsonb\) from public, anon, service_role;/);
  assert.match(CP.D, /grant execute on function public\.cerrar_dia\(text, jsonb\) to authenticated;/);
  const r = reversaDe(SQL.D);
  assert.ok(r.includes('drop function if exists public.cerrar_dia(text, jsonb);'));
  assert.ok(r.includes('drop function if exists public.cerrar_dia(text, timestamp with time zone, numeric, jsonb, jsonb);'), 'y la de la ronda 4, por si se había aplicado');
  // deshechos.cierre_id (null = turno abierto) y el deshacer que dice la verdad
  assert.match(CP.D, /alter table public\.deshechos add column if not exists cierre_id text;/);
  assert.match(dc, /if c\.estado = 'abierta' then return jsonb_build_object\('ok', false, 'codigo', 'ya_reabierta'\);/, 'el segundo toque de un cobro completo');
  assert.match(dc, /exception when unique_violation then/, 'la mesa que se ocupa a la vez no cae en «sin conexión»');
  assert.match(dc, /'codigo', 'mesa_ocupada'/);
});

test('C1-19f. D (ronda 5): una venta nunca entra en dos cierres (cierre_ordenes, clave primaria + disparador de cierres con RS004) y una archivada no vuelve (INSERT rechazado con RS005)', () => {
  assert.match(CP.D, /create table if not exists public\.cierre_ordenes \( orden_id text not null, cierre_id text not null, constraint cierre_ordenes_pkey primary key \(orden_id\), constraint cierre_ordenes_cierre_fkey foreign key \(cierre_id\) references public\.cierres \(id\) on delete cascade \);/);
  assert.match(CP.D, /alter table public\.cierre_ordenes enable row level security;/);
  assert.match(CP.D, /revoke all on public\.cierre_ordenes, public\.deltas_aplicados from anon, authenticated, service_role;/, 'nadie las toca por la API');
  assert.doesNotMatch(TODO_SC, /grant [^;]*on public\.(cierre_ordenes|deltas_aplicados)/i);
  assert.doesNotMatch(TODO_SC, /create policy [^;]*on public\.(cierre_ordenes|deltas_aplicados)/i, 'RLS sin policies');
  const t = cuerpoD('cierres_registrar_ordenes');
  assert.match(t, /errcode = 'RS004'/);
  assert.match(t, /c\.cierre_id <> new\.id/, 'solo cuenta lo que está en OTRO cierre');
  assert.match(t, /not exists \(select 1 from jsonb_array_elements\(v_viejo\) o where o ->> 'id' = x\.id\)/, 'lo que ya traía este cierre antes de editarlo no se vuelve a revisar (los cierres viejos con repetidas siguen editables)');
  assert.match(CP.D, /create trigger trg_cierres_registrar_ordenes after insert or update of transacciones on public\.cierres for each row execute function public\.cierres_registrar_ordenes\(\);/);
  assert.match(CP.D, /insert into public\.cierre_ordenes \(orden_id, cierre_id\) select distinct on \(e ->> 'id'\) e ->> 'id', c\.id from public\.cierres c[\s\S]*order by e ->> 'id', c\.fecha, c\.id on conflict \(orden_id\) do nothing;/, 'los cierres que ya existen se registran al aplicar (el más antiguo gana)');
  const g = cuerpoD('ordenes_guardia');
  assert.match(g, /if v_api and new\.estado = 'cerrada' and privado\.orden_archivada\(new\.id\) then raise exception 'la cuenta % ya estaba en un cierre del día: revísala con el admin', new\.id using errcode = 'RS005'/, 'una venta cerrada ya archivada no vuelve a entrar: se RECHAZA con RS005, ya no se descarta en silencio (ronda 5a)');
  assert.doesNotMatch(g.replace(/--.*$/gm, ''), /orden_archivada\(new\.id\) then return null/, 'y no queda el return null que se comía el cobro de una cuenta abierta con id archivado');
  const b = cuerpoD('ordenes_guardia_borrar');
  assert.match(b, /if current_user in \('anon', 'authenticated'\) and old\.estado = 'abierta' and jsonb_typeof\(old\.items\) = 'array' and jsonb_array_length\(old\.items\) > 0 then return null;/, 'por la API, una cuenta abierta con ítems no se borra');
  assert.match(CP.D, /create trigger trg_ordenes_guardia_borrar before delete on public\.ordenes for each row execute function public\.ordenes_guardia_borrar\(\);/);
  const r = reversaDe(SQL.D);
  for (const x of ['drop trigger if exists trg_cierres_registrar_ordenes on public.cierres;', 'drop function if exists public.cierres_registrar_ordenes();', 'drop table if exists public.cierre_ordenes;',
    'drop trigger if exists trg_ordenes_guardia_borrar on public.ordenes;', 'drop function if exists public.ordenes_guardia_borrar();']) assert.ok(r.includes(x), x);
});

test('C1-19f2. D (ronda 6): una purga atrasada no borra un cobro vivo, el cobro por partes de una cuenta archivada y abierta se rechaza, y una edición atrasada de un cierre no mete una venta viva', () => {
  // Hallazgo 1: por la API no se borra una venta CERRADA que ningún cierre archivó (solo se purga lo que ya está en cierre_ordenes).
  const b = cuerpoD('ordenes_guardia_borrar');
  assert.match(b, /if current_user in \('anon', 'authenticated'\) and old\.estado = 'cerrada' and not privado\.orden_archivada\(old\.id\) then return null; end if; return old;/, 'una venta cerrada que ningún cierre archivó no se borra por la API');
  assert.ok(b.indexOf("old.estado = 'abierta'") < b.indexOf("old.estado = 'cerrada'"), 'y lo de la cuenta abierta con ítems sigue donde estaba');
  // Hallazgo 2: el cobro por partes / por persona / abono (una cerrada con parcial_de) de una cuenta ABIERTA y archivada se rechaza con RS005; si la cuenta ya no está abierta, entra.
  const g = cuerpoD('ordenes_guardia');
  assert.match(g, /if v_api and new\.estado = 'cerrada' and new\.parcial_de is not null and privado\.orden_archivada\(new\.parcial_de\) and exists \(select 1 from public\.ordenes o where o\.id = new\.parcial_de and o\.estado = 'abierta'\) then raise exception 'la cuenta % ya estaba en un cierre del día: no se puede cobrar por partes; revísala con el admin', new\.parcial_de using errcode = 'RS005'/);
  assert.ok(g.indexOf('new.parcial_de is not null') > g.indexOf('orden_archivada(new.id)') && g.indexOf('new.parcial_de is not null') < g.indexOf('return new;'), 'dentro del camino de INSERT, después del RS005 de la venta archivada');
  // Hallazgo 4: editar un cierre que ya existe no puede meter una venta viva (RS004); lo que el cierre ya traía no se revisa.
  const t = cuerpoD('cierres_registrar_ordenes');
  assert.match(t, /select x\.id into v_viva from \(select distinct e ->> 'id' as id from jsonb_array_elements\(new\.transacciones\) e where e ->> 'id' is not null\) x join public\.ordenes o on o\.id = x\.id where not exists \(select 1 from jsonb_array_elements\(v_viejo\) b where b ->> 'id' = x\.id\) limit 1; if v_viva is not null then raise exception 'la venta % está viva \(se reabrió o se volvió a cobrar\): vuelve a leer el historial del cierre', v_viva using errcode = 'RS004'; end if;/);
  assert.ok(t.indexOf("tg_op = 'UPDATE'") < t.indexOf('into v_viva') && t.indexOf('into v_viva') < t.indexOf('into v_repetida'), 'solo en UPDATE (dentro de su bloque, antes de revisar lo que está en otro cierre): el INSERT del cierre del día, que archiva ventas que todavía están en ordenes, no se frena');
});

test('C1-19g. D (ronda 5): deltas idempotentes (p_delta_id, deltas_aplicados, deltas_ids): se anota PRIMERO y se bloquea después, el mismo orden de la fila cerrada; una sola función visible para PostgREST; la reversa vuelve a la de siete parámetros', () => {
  assert.match(CP.D, /drop function if exists public\.aplicar_delta_orden\(text, text, text, numeric, integer, text, boolean\); create or replace function public\.aplicar_delta_orden\(p_orden_id text, p_item_id text, p_nombre text, p_precio numeric, p_delta integer, p_nota text default ''::text, p_solo_abierta boolean default true, p_delta_id text default null::text\)/,
    'se reemplaza la de siete parámetros (si no, PGRST203) y el nuevo es opcional');
  const f = cuerpoD('aplicar_delta_orden');
  assert.match(f, /if p_delta_id is not null and p_delta_id <> '' then v_nuevo := privado\.delta_registrar\(p_delta_id, p_orden_id\); end if;/);
  assert.ok(f.indexOf('privado.delta_registrar') < f.indexOf('for update'), 'primero se anota el id y después se bloquea la orden (el orden contrario se enreda con la fila cerrada que trae deltas_ids: 40P01)');
  assert.match(f, /if not v_nuevo then select \* into o from ordenes where id = p_orden_id; if not found then raise exception 'orden % no existe', p_orden_id; end if; return o; end if;/, 'ya anotado: la orden tal cual');
  assert.match(f, /errcode = 'RS001'/, 'lo demás es la función de siempre (RS001 sobre una cerrada)');
  assert.match(CP.D, /revoke all on function public\.aplicar_delta_orden\(text, text, text, numeric, integer, text, boolean, text\) from public, anon;/);
  assert.match(CP.D, /grant execute on function public\.aplicar_delta_orden\(text, text, text, numeric, integer, text, boolean, text\) to authenticated, service_role;/);
  assert.match(CP.D, /create table if not exists public\.deltas_aplicados \( id text not null, orden_id text not null, aplicado_en timestamp with time zone not null default now\(\), constraint deltas_aplicados_pkey primary key \(id\) \);/);
  assert.match(CP.D, /alter table public\.ordenes add column if not exists deltas_ids jsonb;/);
  const g = cuerpoD('ordenes_guardia');
  assert.match(g, /if new\.deltas_ids is not null then perform privado\.deltas_marcar\(new\.id, new\.deltas_ids\); new\.deltas_ids := null; end if;/, 'los ids de la fila pasan a deltas_aplicados y la columna queda en null');
  assert.ok(g.indexOf('deltas_marcar') < g.indexOf("if tg_op = 'INSERT'"), 'en INSERT y en UPDATE');
  // el esquema privado: lo que los guardias (SECURITY INVOKER) necesitan alcanzar
  assert.match(CP.D, /grant usage on schema privado to authenticated;/);
  assert.match(CP.D, /grant execute on function privado\.orden_archivada\(text\), privado\.deltas_marcar\(text, jsonb\), privado\.delta_registrar\(text, text\) to authenticated;/);
  // la reversa trae la función de siete parámetros TAL CUAL (el cuerpo de 20261002140000)
  const r = reversaDe(SQL.D);
  const cuerpo7 = compacto(sinComentarios(fs.readFileSync(path.join(DIR, '20261002140000_permisos_por_rol.sql'), 'utf8')));
  const de7 = cuerpo7.slice(cuerpo7.indexOf("create or replace function public.aplicar_delta_orden(p_orden_id text, p_item_id text, p_nombre text, p_precio numeric, p_delta integer, p_nota text default ''::text, p_solo_abierta boolean default true)"), cuerpo7.indexOf('end $function$;', cuerpo7.indexOf("p_solo_abierta boolean default true)")) + 15);
  assert.ok(compacto(sinComentarios(r)).includes(de7), 'la reversa recrea aplicar_delta_orden de siete parámetros exactamente como 20261002140000');
  assert.ok(r.includes('drop function if exists public.aplicar_delta_orden(text, text, text, numeric, integer, text, boolean, text);'));
  for (const x of ['drop function if exists privado.delta_registrar(text, text);', 'drop function if exists privado.deltas_marcar(text, jsonb);', 'drop function if exists privado.orden_archivada(text);',
    'revoke usage on schema privado from authenticated;', 'drop table if exists public.deltas_aplicados;', 'alter table public.ordenes drop column if exists deltas_ids;']) assert.ok(r.includes(x), x);
});

test('C1-19e. B (ronda 2 de la refutación): la capacidad de una mesa solo la cambia mesa_editar: se conserva para TODA sesión de la API, también la del admin', () => {
  const f = compacto(SC.B.slice(SC.B.indexOf('create or replace function public.mesas_columnas_solo_admin()'), SC.B.indexOf('-- ── 4.')));
  assert.match(f, /if current_user in \('anon', 'authenticated'\) then new\.capacidad := old\.capacidad;/);
  const primera = f.indexOf('new.capacidad := old.capacidad');
  assert.ok(primera > 0 && primera < f.indexOf("is distinct from 'admin'"), 'la capacidad se conserva ANTES de mirar si es admin');
  assert.doesNotMatch(f, /new\.capacidad := old\.capacidad;[^;]*;[^;]*new\.capacidad := old\.capacidad/, 'una sola vez');
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
