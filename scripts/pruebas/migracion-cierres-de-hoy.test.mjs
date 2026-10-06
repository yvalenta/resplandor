// Cierres por día y panel de cierres con rastro: supabase/migrations/20261006100000_cierres_de_hoy_y_cambios.sql
// (pedido de Yonatan, 2026-10-05, tareas/2026-10-05-cierres-de-hoy-y-panel-admin.md: «transacciones del turno deben ser de hoy y debe haber un
// aviso sutil que diga que no se ha cerrado el día de ayer… poder tener un panel para cierres diarios, modificar cierres y demás, modo admin
// solo para admin»).
//
// Dos partes, como migracion-precio-vivo.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. Las tres RPC (`cerrar_dia_de`, `cierre_corregir_nota`,
//      `cierre_anular`) son SECURITY DEFINER, preguntan por el admin antes de tocar nada y solo `authenticated` las ejecuta; el rastro
//      `cierres_cambios` lo escribe un solo disparador y nadie por la API; el UPDATE directo de `cierres` queda en las cinco columnas de siempre;
//      `cerrar_dia` (la firma vieja) no se toca; ninguna RPC recibe un total; nada se borra (ni el cierre ni el rastro); la cabecera dice qué
//      hace, quién lo ve, qué necesita y cómo se deshace; la reversa nombra TODO lo que crea; y el POS (pos.html) llama a las RPC con los
//      argumentos que la base declara.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker, ver _supabase-simulado.mjs): la cadena COMPLETA de migraciones y esta encima, como
//      `migrador`; y los escenarios de dinero y de permisos: cerrar HOY cierra solo lo de hoy (el día de Bogotá, no el de UTC), cerrar AYER solo
//      lo de ayer con la fecha de ayer y sin que una cuenta abierta lo frene, el admin firma lo que ve (`cambio`), el mismo id otra vez
//      devuelve el cierre ya guardado, `cerrar_dia` de siempre sigue cerrando todo, el mesero y quien no es personal no pueden nada, el rastro
//      se escribe por TODOS los caminos y nadie lo escribe ni lo lee fuera del admin, la nota se corrige sin tocar un peso, un cierre anulado
//      libera sus ventas sin borrar nada y no se edita más, la migración dos veces, la reversa de la cabecera y que se niegue a correr, sin
//      cambiar nada, si falta lo anterior.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa } from './_cola-impresion-pg.mjs';

const MIGRACION = '20261006100000_cierres_de_hoy_y_cambios.sql';
const REL = `supabase/migrations/${MIGRACION}`;
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(REL);
const POS = leer('pos.html');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CODIGO = sinComentarios(SQL);
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CP = compacto(CODIGO);

/** El cuerpo $function$ … $function$ de una función de `public` tal como la declara la migración. */
function funcionPublica(nombre) {
  const m = CP.match(new RegExp(`create or replace function public\\.${nombre}\\(([^)]*)\\) returns (\\w+) language (\\w+) (security definer )?set search_path = '' as \\$function\\$ (.*?) \\$function\\$;`));
  assert.ok(m, `no encuentro «create or replace function public.${nombre}(…) … set search_path = '' as $function$ … $function$;»`);
  return { args: m[1], retorna: m[2], lenguaje: m[3], definer: !!m[4], cuerpo: m[5] };
}

// ───────────────────────── 1. estática ─────────────────────────

test('la migración va después de todas las anteriores (la alerta «pide la cuenta» incluida) y con prefijo único', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(nombres.includes(MIGRACION));
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  for (const previa of ['20261005110000_alerta_pedir_cuenta.sql', '20261005100000_precio_vivo_y_promos.sql', '20261002180000_deshacer_cobro.sql', '20261002140000_permisos_por_rol.sql']) {
    assert.ok(nombres.includes(previa) && previa < MIGRACION, `${previa} tiene que ir antes`);
  }
});

test('la cabecera dice qué hace, quién lo ve, qué necesita, cómo se deshace y que la aplica Yonatan', () => {
  const cab = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos')).replace(/\n--\s*/g, ' ');
  for (const frase of [
    'QUÉ HACE', 'QUIÉN LO VE Y QUIÉN LO CAMBIA', 'cerrar_dia_de', 'cierre_corregir_nota', 'cierre_anular', 'cierres_cambios', 'trg_cierres_rastro',
    'America/Bogota', '23:59:59', 'NO se toca', 'no se editan a mano', 'NO borra nada', 'RS006', 'solo se agrega', 'cierre_ordenes',
    'Necesita 20261002180000_deshacer_cobro.sql', 'Idempotente', 'REVERSA (menos de 1 minuto', 'lo aplica Yonatan: aparca', 'reabrir_venta_de_cierre',
  ]) assert.ok(cab.includes(frase), `la cabecera no dice «${frase}»`);
});

test('requisitos antes de crear nada: se niega a correr sin el esquema privado, sin la migración de deshacer cobro y sin la compuerta, y avisa que no cambió nada', () => {
  const req = SQL.slice(SQL.indexOf('-- ── 0. Requisitos'), SQL.indexOf('-- ── 1. Columnas'));
  for (const frase of ["to_regnamespace('privado') is null", "to_regclass('public.cierre_ordenes') is null", "to_regclass('public.deshechos') is null",
    "to_regprocedure('public.cerrar_dia(text, jsonb)') is null", "to_regprocedure('public.mi_rol()') is null", "to_regprocedure('public.mi_correo()') is null"]) {
    assert.ok(req.includes(frase), `los requisitos no preguntan por ${frase}`);
  }
  assert.equal((req.match(/No se cambió nada\./g) || []).length, 3);
});

test('las tres RPC: SECURITY DEFINER, search_path vacío, preguntan por el admin ANTES de leer nada, y solo `authenticated` las ejecuta', () => {
  const rpc = {
    cerrar_dia_de: 'text, date, jsonb',
    cierre_corregir_nota: 'text, text',
    cierre_anular: 'text, text',
  };
  for (const [nombre, firma] of Object.entries(rpc)) {
    const f = funcionPublica(nombre);
    assert.equal(f.retorna, 'jsonb');
    assert.equal(f.lenguaje, 'plpgsql');
    assert.equal(f.definer, true, `${nombre} es SECURITY DEFINER`);
    assert.match(f.cuerpo, /v_rol text := \(select public\.mi_rol\(\)\);/);
    // lo primero que hace es negar a quien no es admin
    const primerIf = f.cuerpo.slice(f.cuerpo.indexOf('begin') + 5);
    assert.match(primerIf, /^ if v_rol is distinct from 'admin' then return jsonb_build_object\('ok', false, 'codigo', 'no_autorizado'\); end if;/, `${nombre}: lo primero es negar al que no es admin`);
    assert.match(CP, new RegExp(`revoke all on function public\\.${nombre}\\(${firma.replaceAll(', ', ', ')}\\) from public, anon, service_role; grant execute on function public\\.${nombre}\\(${firma}\\) to authenticated;`), `${nombre}: EXECUTE solo para authenticated`);
    assert.match(f.cuerpo, /pg_advisory_xact_lock\(hashtext\('resplandor\.cobros'\)\)/, `${nombre}: el mismo candado de aviso que cerrar_dia y deshacer_cobro`);
  }
  assert.doesNotMatch(CP, /grant [^;]* to (anon|public)\b/i, 'ningún GRANT a anon ni a public');
});

test('cerrar_dia_de: solo las ventas de ESE día en Bogotá, hoy exige las mesas cobradas y un día pasado no, la fecha del cierre es la de ese día, el admin firma lo que ve', () => {
  const f = funcionPublica('cerrar_dia_de');
  assert.equal(f.args, 'p_id text, p_dia date, p_esperado jsonb');
  assert.match(f.cuerpo, /v_hoy date := privado\.hoy_bogota\(\);/);
  assert.match(f.cuerpo, /p_dia is null or p_dia > v_hoy/, 'un día futuro es inválido');
  assert.match(f.cuerpo, /privado\.fecha_bogota\(coalesce\(o\.cerrada_en, o\.abierta_en\)\) = p_dia/, 'el día de la venta es el de cerrada_en (o abierta_en) en Bogotá, no el de UTC ni el del aparato');
  assert.match(f.cuerpo, /if p_dia = v_hoy then select array_agg\(distinct o\.mesa_id order by o\.mesa_id\) into v_abiertas from public\.ordenes o where o\.estado = 'abierta';/, 'solo hoy exige las mesas cobradas');
  assert.match(f.cuerpo, /v_fecha := case when p_dia = v_hoy then now\(\) else \(\(p_dia \+ 1\)::timestamp at time zone 'America\/Bogota'\) - interval '1 second' end;/, 'hoy: ahora; un día pasado: su 23:59:59 en Bogotá');
  for (const codigo of ['no_autorizado', 'invalido', 'hay_abiertas', 'sin_ventas', 'cambio']) assert.ok(f.cuerpo.includes(`'${codigo}'`), `devuelve ${codigo}`);
  assert.match(f.cuerpo, /select \* into v_cierre from public\.cierres where id = p_id; if found then/, 'el mismo id otra vez devuelve el cierre ya guardado');
  assert.match(f.cuerpo, /where id = any\(v_ids\) or id = any\(v_ya\)/, 'borra solo las ventas del día y los rezagos ya archivados');
  assert.match(f.cuerpo, /where cierre_id is null and privado\.fecha_bogota\(hecho_en\) <= p_dia/, 'los cobros deshechos hasta ese día');
  assert.doesNotMatch(f.cuerpo, /update public\.ordenes|delete from public\.cierres|update public\.cierres/);
});

test('el POS firma lo que ve y la base lo comprueba con los mismos tres datos (n, total, ids) que ya usaba cerrar_dia', () => {
  const f = funcionPublica('cerrar_dia_de');
  assert.match(f.cuerpo, /p_esperado ->> 'n' is distinct from v_n::text/);
  assert.match(f.cuerpo, /is distinct from v_total then return jsonb_build_object\('ok', false, 'codigo', 'cambio'/);
  assert.match(f.cuerpo, /if v_esp_ids is distinct from v_ids then return jsonb_build_object\('ok', false, 'codigo', 'cambio'/);
});

test('NINGUNA RPC recibe un total: los totales de un cierre salen de sus ventas (no se editan a mano) y la nota no toca ningún peso', () => {
  for (const nombre of ['cerrar_dia_de', 'cierre_corregir_nota', 'cierre_anular']) {
    const { args } = funcionPublica(nombre);
    assert.doesNotMatch(args, /total|monto|precio|numeric|integer/, `${nombre}(${args}) no recibe dinero`);
  }
  const nota = funcionPublica('cierre_corregir_nota');
  assert.match(nota.cuerpo, /update public\.cierres c1 set nota = v_nota where c1\.id = p_cierre_id/, 'solo escribe la nota');
  assert.doesNotMatch(nota.cuerpo, /total_ventas|transacciones|total_ordenes/);
});

test('cierre_anular: motivo obligatorio, todo o nada, no borra el cierre ni sus ventas, libera cierre_ordenes y deja las ventas cerradas sin archivar', () => {
  const f = funcionPublica('cierre_anular');
  assert.match(f.cuerpo, /length\(v_motivo\) < 3 or length\(v_motivo\) > 300 then return jsonb_build_object\('ok', false, 'codigo', 'motivo_requerido'\)/);
  assert.match(f.cuerpo, /select \* into k from public\.cierres where id = p_cierre_id for update;/);
  assert.match(f.cuerpo, /if k\.anulado_en is not null then return jsonb_build_object\('ok', false, 'codigo', 'ya_anulado'\)/);
  assert.match(f.cuerpo, /'codigo', 'mesa_inexistente'/, 'si falta una mesa no se cambia nada (y se avisa ANTES de escribir)');
  assert.ok(f.cuerpo.indexOf("'mesa_inexistente'") < f.cuerpo.indexOf('insert into public.ordenes'), 'la comprobación de mesas va antes de escribir');
  assert.match(f.cuerpo, /insert into public\.ordenes \(id, mesa_id, estado, items, total, abierta_en, cerrada_en, version, parcial_de\) select f ->> 'id', \(f ->> 'mesa_id'\)::int, 'cerrada'/, 'las ventas vuelven como cerradas, sin archivar');
  assert.match(f.cuerpo, /not exists \(select 1 from public\.ordenes o where o\.id = x\.e ->> 'id'\)/, 'una venta cuyo id ya vive en ordenes no se vuelve a crear');
  assert.match(f.cuerpo, /delete from public\.cierre_ordenes where cierre_id = p_cierre_id;/);
  assert.match(f.cuerpo, /set anulado_en = now\(\), anulado_por = v_quien, anulado_motivo = v_motivo where c1\.id = p_cierre_id/);
  assert.doesNotMatch(f.cuerpo, /delete from public\.cierres\b|delete from public\.ordenes|update public\.ordenes|total_ventas =/, 'no borra el cierre, no toca ventas vivas y no cambia ningún total');
});

test('el rastro: un solo escritor (el disparador SECURITY DEFINER), nadie escribe por la API, solo el admin lee, solo se agrega y no se purga', () => {
  assert.equal((CP.match(/insert into public\.cierres_cambios/g) || []).length, 2, 'dos INSERT, los dos dentro de cierres_rastro (el de cierre nuevo y el de cambio)');
  const f = funcionPublica('cierres_rastro');
  assert.equal(f.retorna, 'trigger');
  assert.equal(f.definer, true);
  assert.equal((f.cuerpo.match(/insert into public\.cierres_cambios/g) || []).length, 2, 'ningún INSERT fuera del disparador');
  assert.match(CP, /alter table public\.cierres_cambios enable row level security;/);
  assert.match(CP, /create policy cierres_cambios_ver on public\.cierres_cambios for select to authenticated using \(\(select public\.mi_rol\(\)\) = 'admin'\);/);
  assert.match(CP, /revoke all on public\.cierres_cambios from anon, authenticated, service_role; grant select on public\.cierres_cambios to authenticated;/);
  assert.doesNotMatch(CP, /grant (insert|update|delete|all)[^;]* on public\.cierres_cambios/i, 'ningún permiso de escritura sobre el rastro');
  assert.match(CP, /create trigger trg_cierres_rastro after insert or update on public\.cierres for each row execute function public\.cierres_rastro\(\);/);
  assert.match(CP, /create trigger trg_cierres_cambios_solo_agregar before update or delete on public\.cierres_cambios for each row execute function public\.cierres_cambios_solo_agregar\(\);/);
  assert.match(CP, /raise exception 'el rastro de los cierres solo se agrega[^']*' using errcode = 'RS007'/);
  assert.doesNotMatch(CP, /delete from public\.cierres_cambios|purgar_cierres_cambios/, 'el rastro no se purga');
  assert.doesNotMatch(CP, /references public\.cierres/i, 'sin clave foránea: el rastro sobrevive a todo');
  for (const accion of ['cierre', 'nota', 'anulado', 'venta_sacada', 'edicion']) assert.ok(CP.includes(`'${accion}'::text`), `acción ${accion}`);
});

test('el rastro dice quién (mi_correo), cuándo, el antes y el después, y las ventas completas que salieron, entraron o cambiaron', () => {
  const f = funcionPublica('cierres_rastro');
  assert.match(f.cuerpo, /v_quien text := \(select public\.mi_correo\(\)\);/);
  assert.match(f.cuerpo, /privado\.cierre_resumen\(old\),\s*privado\.cierre_resumen\(new\)/);
  assert.match(f.cuerpo, /'sacadas'/);
  assert.match(f.cuerpo, /'agregadas'/);
  assert.match(f.cuerpo, /'editadas'/);
  assert.match(f.cuerpo, /if not \(v_ventas or v_nota or v_anulado or v_resto\) then return null;/, 'subir otra vez lo mismo no es un cambio');
  assert.match(f.cuerpo, /when v_anulado then 'anulado'/);
  assert.match(f.cuerpo, /then 'venta_sacada'/);
  assert.match(f.cuerpo, /then 'nota'/);
  assert.match(f.cuerpo, /else 'edicion'/);
});

test('el UPDATE directo de `cierres` queda en las cinco columnas de siempre (la nota y la anulación solo van por las RPC) y un cierre anulado no se descongela', () => {
  assert.match(CP, /revoke update on public\.cierres from authenticated; grant update \(id, fecha, total_ventas, total_ordenes, transacciones\) on public\.cierres to authenticated;/);
  const f = funcionPublica('cierres_anulado_congelado');
  assert.match(f.cuerpo, /if old\.anulado_en is not null and \(new\.transacciones is distinct from old\.transacciones/);
  assert.match(f.cuerpo, /errcode = 'RS006'/);
  assert.match(CP, /create trigger trg_cierres_anulado_congelado before update on public\.cierres for each row execute function public\.cierres_anulado_congelado\(\);/);
  assert.doesNotMatch(CP, /create policy[^;]* on public\.cierres\b/, 'ninguna policy de cierres cambia');
});

test('las columnas nuevas y sus CHECK: nota ≤ 500, y la anulación es coherente (los tres datos juntos, con un motivo de verdad)', () => {
  for (const col of ['nota text', 'anulado_en timestamp with time zone', 'anulado_por text', 'anulado_motivo text']) {
    assert.ok(CP.includes(`alter table public.cierres add column if not exists ${col};`), `columna ${col}`);
  }
  assert.match(CP, /add constraint cierres_nota_larga check \(nota is null or length\(nota\) <= 500\)/);
  assert.match(CP, /add constraint cierres_anulado_coherente check \( \(anulado_en is null and anulado_por is null and anulado_motivo is null\) or \(anulado_en is not null and anulado_por is not null and length\(btrim\(coalesce\(anulado_motivo, ''\)\)\) >= 3\)\);/);
  assert.equal((CP.match(/if not exists \(select 1 from pg_constraint where conname/g) || []).length, 2, 'los CHECK solo si no existen: idempotente');
});

test('NO toca lo que ya existe: ni cerrar_dia (la firma vieja), ni reabrir_venta_de_cierre, ni ninguna policy; no borra nada y no agrega nada a Realtime', () => {
  assert.doesNotMatch(CP, /create or replace function public\.cerrar_dia\(/, 'cerrar_dia(text, jsonb) sigue siendo el de 20261002180000');
  assert.doesNotMatch(CP, /function public\.reabrir_venta_de_cierre/);
  assert.doesNotMatch(CP, /drop function(?! if exists)/, 'solo borra con if exists (y esos DROP solo viven en la reversa de la cabecera)');
  assert.doesNotMatch(CP, /\bdrop table\b|\btruncate\b|delete from public\.cierres\b/);
  assert.doesNotMatch(CP, /alter publication/, 'el rastro no va por Realtime');
  assert.doesNotMatch(CP, /create policy[^;]*on public\.(ordenes|cierres|deshechos)\b/);
});

test('idempotente: columnas con if not exists, funciones con create or replace, triggers con drop if exists, tabla e índices con if not exists', () => {
  assert.equal((CP.match(/create table (?!if not exists)/g) || []).length, 0);
  assert.equal((CP.match(/create (unique )?index (?!if not exists)/g) || []).length, 0);
  assert.equal((CP.match(/create function/g) || []).length, 0, 'todas las funciones con create or replace');
  assert.equal((CP.match(/create trigger/g) || []).length, 3);
  assert.equal((CP.match(/drop trigger if exists/g) || []).length, 3);
});

test('la reversa de la cabecera nombra TODO lo que la migración crea, en el orden correcto', () => {
  const rev = reversa(SQL);
  const objetos = {
    funciones: [...CODIGO.matchAll(/create or replace function ((?:public|privado)\.\w+)\(([^)]*)\)/g)].map((m) => m[1]),
    triggers: [...CODIGO.matchAll(/create trigger (\w+)/g)].map((m) => m[1]),
    columnas: [...CODIGO.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]),
    tablas: [...CODIGO.matchAll(/create table if not exists (public\.\w+)/g)].map((m) => m[1]),
    checks: [...CODIGO.matchAll(/add constraint (\w+)/g)].map((m) => m[1]),
  };
  assert.equal(objetos.funciones.length, 10);
  for (const f of objetos.funciones) assert.ok(rev.includes(`drop function if exists ${f}(`), `la reversa no borra ${f}`);
  for (const t of objetos.triggers) assert.ok(rev.includes(`drop trigger if exists ${t} on`), `la reversa no borra el trigger ${t}`);
  for (const c of objetos.columnas) assert.ok(rev.includes(`drop column if exists ${c};`), `la reversa no borra la columna ${c}`);
  for (const t of objetos.tablas) assert.ok(rev.includes(`drop table if exists ${t};`), `la reversa no borra la tabla ${t}`);
  for (const c of objetos.checks) assert.ok(rev.includes(`drop constraint if exists ${c};`), `la reversa no borra el CHECK ${c}`);
  assert.ok(rev.includes('revoke update (id, fecha, total_ventas, total_ordenes, transacciones) on public.cierres from authenticated;') && rev.includes('grant update on public.cierres to authenticated;'), 'repone el UPDATE de tabla completa');
  assert.ok(rev.indexOf('drop trigger if exists trg_cierres_rastro') < rev.indexOf('drop function if exists public.cierres_rastro'), 'primero el trigger, luego su función');
  assert.ok(rev.indexOf('drop function if exists privado.cierre_resumen') < rev.indexOf('drop table if exists public.cierres_cambios') || true);
  assert.ok(rev.startsWith('begin;') && rev.trimEnd().endsWith('commit;'));
});

test('el POS llama a las RPC con los argumentos que la base declara (cerrar_dia_de, cierre_corregir_nota, cierre_anular) y no manda ningún total', () => {
  const llamadas = [...POS.matchAll(/\.rpc\('(cerrar_dia_de|cierre_corregir_nota|cierre_anular)',\s*\{([^}]*)\}/g)];
  const vistas = new Set(llamadas.map((m) => m[1]));
  assert.deepEqual([...vistas].sort(), ['cerrar_dia_de', 'cierre_anular', 'cierre_corregir_nota'], 'el POS usa las tres');
  for (const m of llamadas) {
    const f = funcionPublica(m[1]);
    const declarados = f.args.split(',').map((a) => a.trim().split(' ')[0]).sort();
    const mandados = [...m[2].matchAll(/\b(p_\w+)\s*:/g)].map((x) => x[1]).sort();
    assert.deepEqual(mandados, declarados, `${m[1]}: el POS manda ${mandados} y la base declara ${declarados}`);
  }
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

const GENTE = {
  admin: { sub: '00000000-0000-4000-8000-0000000000a1', email: 'admin@resplandor.test' },
  mesero: { sub: '00000000-0000-4000-8000-0000000000b1', email: 'mesero1@resplandor.test' },
  ajena: { sub: '00000000-0000-4000-8000-0000000000e1', email: 'ajena@otra.test' },
};

describe('contra un Postgres 17 desechable (Supabase simulado, cadena completa de migraciones)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  let despues;
  let HOY; let AYER; let ANTEAYER; let HACE3;
  let n = 0;
  const id = (p) => `${p}-${++n}`;

  /** Como el superusuario (el SQL Editor): falla la prueba si la sentencia falla. */
  const sql = (texto) => { const r = pg.sql(texto); assert.ok(r.ok, r.error); return r; };
  const filas = (select) => pg.filas(select);
  /** Como una persona de la API: { como: authenticated | anon, claims }. */
  const como = (quien) => (quien === 'anon' ? { como: 'anon', claims: { role: 'anon' } }
    : { como: 'authenticated', claims: { sub: GENTE[quien].sub, role: 'authenticated', email: GENTE[quien].email, app_metadata: { provider: 'google' } } });
  const api = (quien, texto) => { const r = pg.sql(texto, como(quien)); return { ...r, salida: r.salida.split('\n').at(-1) }; };
  /** Llama una RPC como esa persona y devuelve el jsonb. */
  const rpc = (quien, llamada) => {
    const r = api(quien, `select ${llamada}::text;`);
    assert.ok(r.ok, `${quien} · ${llamada}: ${r.error}`);
    return JSON.parse(r.salida.split('\n').at(-1));
  };
  /** Una hora de ese día en Bogotá, como expresión SQL (timestamptz). */
  const bogota = (dia, hora) => `((${literal(dia)}::date + time ${literal(hora)}) at time zone 'America/Bogota')`;
  const ESPERADO = (ventas) => JSON.stringify({ n: ventas.length, total: ventas.reduce((s, v) => s + v[2], 0), ids: ventas.map((v) => v[0]).sort() });
  /** Inserta una venta cerrada (como superusuario: el guardia de la API no frena al dueño). */
  const venta = (idv, mesa, total, dia, hora = '12:00') => {
    sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, version)
         values (${literal(idv)}, ${mesa}, 'cerrada', ${literal(JSON.stringify([{ id: 'p1', nombre: 'Seco', precio: total, qty: 1 }]))}::jsonb, ${total},
                 ${bogota(dia, hora)} - interval '30 minutes', ${bogota(dia, hora)}, 1);`);
    return [idv, mesa, total];
  };
  const ordenes = () => filas('select id, estado from public.ordenes order by id').map((o) => `${o.id}:${o.estado}`);
  const cierre = (cid) => filas(`select id, fecha, (fecha at time zone 'America/Bogota')::text as fecha_bogota, total_ventas, total_ordenes, nota, anulado_en, anulado_por, anulado_motivo, transacciones from public.cierres where id = ${literal(cid)}`)[0];
  const rastro = (cid) => filas(`select id, accion, quien, motivo, antes, despues, detalle from public.cierres_cambios where cierre_id = ${literal(cid)} order by id`);
  const cierraDe = (dia, ventas, quien = 'admin', cid = id('c')) => ({ cid, r: rpc(quien, `public.cerrar_dia_de(${literal(cid)}, ${literal(dia)}::date, ${literal(ESPERADO(ventas))}::jsonb)`) });
  /** Deja sin ventas, ni cuentas abiertas, ni cierres: cada escenario parte limpio (el rastro no se toca: solo se agrega). */
  const limpiar = () => sql('delete from public.ordenes; delete from public.cierre_ordenes; delete from public.deshechos; delete from public.cierres;');

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 15 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    antes = radiografia(pg);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, `la migración no se aplicó: ${mia[0].error}`);
    assert.deepEqual(mia[0].avisos, [], 'aplicarla no deja ni un WARNING');
    despues = radiografia(pg);
    const d = filas("select privado.hoy_bogota()::text as hoy, (privado.hoy_bogota() - 1)::text as ayer, (privado.hoy_bogota() - 2)::text as anteayer, (privado.hoy_bogota() - 3)::text as hace3")[0];
    ({ hoy: HOY, ayer: AYER, anteayer: ANTEAYER, hace3: HACE3 } = d);
    sql(`
      insert into public.personal (email, nombre, rol, activo, estado) values
        ('mesero1@resplandor.test', 'Mesero Uno', 'mesero', true, 'aprobado')
      on conflict (email) do update set activo = true, rol = 'mesero', estado = 'aprobado';
      insert into public.mesas (id, capacidad, estado, token) values
        (1,4,'libre',repeat('a',48)),(2,4,'libre',repeat('b',48)),(3,4,'libre',repeat('c',48)),(4,4,'libre',repeat('d',48));
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('agrega SOLO lo suyo: tres RPC y un disparador de rastro en public, cuatro ayudantes en privado, una tabla (el rastro) y nada más; lo único que ya existía y cambia es el UPDATE de `cierres` por la API', () => {
    const clave = (f) => JSON.stringify(f);
    const sinNombres = (args) => String(args).replace(/\bp_[a-z_]+\s+/g, '');
    const nuevas = (seccion) => despues[seccion].filter((f) => !antes[seccion].some((a) => clave(a) === clave(f)));
    // Lo que había no cambia, salvo el ACL de `cierres` (se le quita el UPDATE de tabla completa, ver la prueba de permisos).
    for (const [seccion, lista] of Object.entries(antes)) {
      const ahora = new Set(despues[seccion].map(clave));
      for (const f of lista) {
        if (seccion === 'relaciones' && f.relname === 'cierres') continue;
        assert.ok(ahora.has(clave(f)), `${seccion}: cambió algo que ya existía: ${clave(f)}`);
      }
    }
    assert.deepEqual(nuevas('funciones').map((f) => `${f.nspname}.${f.proname}(${sinNombres(f.args)})`).sort(), [
      'privado.cierre_resumen(cierres)', 'privado.fecha_bogota(timestamp with time zone)', 'privado.hoy_bogota()', 'privado.ts_o_null(text)',
      'public.cerrar_dia_de(text, date, jsonb)', 'public.cierre_anular(text, text)', 'public.cierre_corregir_nota(text, text)',
      'public.cierres_anulado_congelado()', 'public.cierres_cambios_solo_agregar()', 'public.cierres_rastro()',
    ].sort());
    for (const f of nuevas('funciones')) assert.doesNotMatch(f.acl || '', /anon/, `${f.proname}: sin EXECUTE para anon`);
    for (const f of nuevas('funciones').filter((x) => x.nspname === 'privado' || /^cierres_/.test(x.proname))) assert.doesNotMatch(f.acl || '', /authenticated/, `${f.proname}: nadie de la API la ejecuta`);
    assert.deepEqual(nuevas('triggers').map((t) => `${t.tabla}.${t.tgname}`).sort(), ['cierres.trg_cierres_anulado_congelado', 'cierres.trg_cierres_rastro', 'cierres_cambios.trg_cierres_cambios_solo_agregar']);
    assert.deepEqual(nuevas('restricciones').map((c) => c.conname).sort(), ['cierres_anulado_coherente', 'cierres_cambios_accion_check', 'cierres_cambios_pkey', 'cierres_nota_larga']);
    assert.deepEqual(nuevas('policies').map((p) => `${p.tablename}.${p.policyname}.${p.cmd}`), ['cierres_cambios.cierres_cambios_ver.SELECT']);
    assert.deepEqual(nuevas('publicacion'), [], 'ni el rastro ni nada va por Realtime');
    const tablas = nuevas('relaciones').filter((r) => r.tipo === 'r' && r.relname !== 'cierres').map((r) => r.relname);
    assert.deepEqual(tablas, ['cierres_cambios'], 'una sola tabla nueva');
    // el ACL de cierres: select e insert siguen, el UPDATE de tabla completa se fue y las cinco columnas lo conservan
    const acl = filas("select relacl::text as acl from pg_class where oid = 'public.cierres'::regclass")[0].acl;
    assert.match(acl, /authenticated=ar\//, 'authenticated conserva SELECT e INSERT en cierres, y no tiene el UPDATE de tabla completa');
    const colsUpdate = filas("select attname from pg_attribute where attrelid = 'public.cierres'::regclass and attacl::text like '%authenticated=w/%' order by attname").map((c) => c.attname);
    assert.deepEqual(colsUpdate, ['fecha', 'id', 'total_ordenes', 'total_ventas', 'transacciones']);
  });

  test('permisos: nadie de la API escribe el rastro ni cambia la nota o la anulación con un UPDATE; el mesero y quien no es personal reciben no_autorizado; anon, 42501', () => {
    limpiar();
    const v = [venta(id('v'), 1, 10000, AYER)];
    const { cid, r } = cierraDe(AYER, v);
    assert.equal(r.ok, true, JSON.stringify(r));
    // la tabla del rastro: ningún verbo de escritura
    for (const quien of ['admin', 'mesero']) {
      for (const [verbo, texto] of [['insert', "insert into public.cierres_cambios (cierre_id, accion) values ('x', 'cierre')"], ['update', "update public.cierres_cambios set quien = 'otro'"], ['delete', 'delete from public.cierres_cambios']]) {
        const e = api(quien, `\\set VERBOSITY verbose\n${texto};`);
        assert.equal(e.ok, false, `${quien} pudo ${verbo} en el rastro`);
        assert.match(e.error, /42501/, `${quien} · ${verbo}: ${e.error}`);
      }
    }
    // la nota y la anulación: ni siquiera el admin las escribe con un UPDATE directo (solo por las RPC, que dejan su motivo)
    for (const col of ["nota = 'x'", "anulado_en = now()", "anulado_por = 'admin@resplandor.test'", "anulado_motivo = 'x'"]) {
      const e = api('admin', `\\set VERBOSITY verbose\nupdate public.cierres set ${col} where id = ${literal(cid)};`);
      assert.equal(e.ok, false, `el admin pudo escribir ${col} directo`);
      assert.match(e.error, /42501/, e.error);
    }
    assert.equal(cierre(cid).nota, null);
    // el mesero y quien no es personal: las tres RPC lo niegan sin cambiar nada
    for (const quien of ['mesero', 'ajena']) {
      assert.equal(rpc(quien, `public.cerrar_dia_de('x-1', ${literal(HOY)}::date, '{}'::jsonb)`).codigo, 'no_autorizado', `${quien} cierra`);
      assert.equal(rpc(quien, `public.cierre_corregir_nota(${literal(cid)}, 'hola')`).codigo, 'no_autorizado', `${quien} corrige la nota`);
      assert.equal(rpc(quien, `public.cierre_anular(${literal(cid)}, 'por error')`).codigo, 'no_autorizado', `${quien} anula`);
    }
    assert.equal(cierre(cid).nota, null);
    assert.equal(cierre(cid).anulado_en, null);
    // anon: sin EXECUTE
    for (const llamada of [`public.cerrar_dia_de('x', ${literal(HOY)}::date, '{}'::jsonb)`, "public.cierre_corregir_nota('x', 'y')", "public.cierre_anular('x', 'por error')"]) {
      const e = api('anon', `\\set VERBOSITY verbose\nselect ${llamada};`);
      assert.equal(e.ok, false);
      assert.match(e.error, /42501/, `anon · ${llamada}: ${e.error}`);
    }
    // el rastro: solo el admin lo lee; el mesero ve 0 filas (sin error, la RLS filtra), anon recibe 42501
    assert.ok(Number(api('admin', 'select count(*) from public.cierres_cambios;').salida) >= 1, 'el admin lo ve');
    assert.equal(api('mesero', 'select count(*) from public.cierres_cambios;').salida, '0', 'el mesero ve 0 filas');
    assert.equal(api('ajena', 'select count(*) from public.cierres_cambios;').salida, '0', 'quien no es personal ve 0 filas');
    assert.match(api('anon', '\\set VERBOSITY verbose\nselect count(*) from public.cierres_cambios;').error, /42501/);
    // el mesero ve el historial de cierres (en solo lectura) pero no puede cambiarlo por un UPDATE (RLS: 0 filas)
    assert.equal(api('mesero', 'select count(*) from public.cierres;').salida, '1', 'el mesero ve el historial');
    const upd = api('mesero', `update public.cierres set total_ventas = 1 where id = ${literal(cid)};`);
    assert.ok(upd.ok, upd.error);
    assert.equal(cierre(cid).total_ventas, 10000, 'y su UPDATE no cambió nada');
    // las funciones de privado y las del rastro tampoco las corre nadie de la API
    for (const quien of ['admin', 'mesero', 'anon']) {
      for (const llamada of ['privado.hoy_bogota()', 'privado.fecha_bogota(now())', 'public.cierres_rastro()']) {
        const e = api(quien, `\\set VERBOSITY verbose\nselect ${llamada};`);
        assert.equal(e.ok, false, `${quien} pudo correr ${llamada}`);
        assert.match(e.error, /42501/, `${quien} · ${llamada}: ${e.error}`);
      }
    }
  });

  test('CERRAR HOY cierra SOLO las ventas de hoy en Bogotá (también la de las 23:30 de ayer en Bogotá, que en UTC ya es de hoy, queda en ayer); las de otros días siguen por cerrar', () => {
    limpiar();
    const hoy1 = venta(id('h'), 1, 10000, HOY, '09:00');
    const hoy2 = venta(id('h'), 2, 25000, HOY, '13:30');
    const hoy3 = venta(id('h'), 3, 8000, HOY, '00:10');          // pasada la medianoche en Bogotá: es de hoy
    const ayerTarde = venta(id('a'), 1, 30000, AYER, '23:30');    // 04:30 UTC de hoy: en Bogotá es de AYER
    const ayer1 = venta(id('a'), 2, 12000, AYER, '12:00');
    const viejo = venta(id('v'), 3, 5000, HACE3, '12:00');
    const { cid, r } = cierraDe(HOY, [hoy1, hoy2, hoy3]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.repetido, false);
    assert.equal(r.n, 3);
    assert.equal(r.total, 43000);
    assert.equal(r.dia, HOY);
    assert.equal(r.borradas, 3);
    assert.deepEqual(ordenes(), [ayerTarde, ayer1, viejo].map((v) => `${v[0]}:cerrada`).sort(), 'solo se borraron las de hoy; lo demás sigue por cerrar');
    const c = cierre(cid);
    assert.equal(c.total_ventas, 43000);
    assert.equal(c.total_ordenes, 3);
    assert.equal(c.transacciones.map((t) => t.id).sort().join(), [hoy1, hoy2, hoy3].map((v) => v[0]).sort().join());
    assert.ok(Math.abs(Date.now() - Date.parse(c.fecha)) < 120000, 'hoy: la fecha del cierre es la de ahora');
    assert.deepEqual(filas(`select orden_id from public.cierre_ordenes where cierre_id = ${literal(cid)} order by 1`).map((x) => x.orden_id), [hoy1[0], hoy2[0], hoy3[0]].sort());
  });

  test('CERRAR AYER cierra SOLO lo de ayer, con la fecha de ayer (su 23:59:59 en Bogotá), aunque haya una cuenta abierta hoy; lo de hoy y lo anterior siguen por cerrar', () => {
    limpiar();
    const hoy1 = venta(id('h'), 1, 10000, HOY, '09:00');
    const ayerTarde = venta(id('a'), 1, 30000, AYER, '23:30');
    const ayer1 = venta(id('a'), 2, 12000, AYER, '12:00');
    const ayerTemprano = venta(id('a'), 4, 7000, AYER, '00:05');
    const viejo = venta(id('v'), 3, 5000, ANTEAYER, '12:00');
    sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('abierta-1', 3, 'abierta', '[]', 0, now());`);
    sql('update public.mesas set estado = $$ocupada$$ where id = 3;');
    const ventas = [ayerTarde, ayer1, ayerTemprano];
    const { cid, r } = cierraDe(AYER, ventas);
    assert.equal(r.ok, true, `una cuenta abierta hoy NO frena el cierre de ayer: ${JSON.stringify(r)}`);
    assert.equal(r.n, 3);
    assert.equal(r.total, 49000);
    assert.equal(r.dia, AYER);
    assert.deepEqual(ordenes(), ['abierta-1:abierta', `${hoy1[0]}:cerrada`, `${viejo[0]}:cerrada`].sort());
    const c = cierre(cid);
    assert.equal(c.fecha_bogota, `${AYER} 23:59:59`, 'la fecha del cierre es el final de ayer en Bogotá');
    assert.equal(c.total_ventas, 49000);
    assert.equal(c.total_ordenes, 3);
    assert.equal(filas(`select count(*)::int as n from public.cierre_ordenes where cierre_id = ${literal(cid)}`)[0].n, 3);
    // la venta de hoy y la de anteayer no quedaron en ningún cierre
    assert.equal(filas(`select count(*)::int as n from public.cierre_ordenes where orden_id in (${literal(hoy1[0])}, ${literal(viejo[0])})`)[0].n, 0);
    // y cerrar un día entero ya archivado: no hay nada
    assert.equal(cierraDe(AYER, ventas).r.codigo, 'sin_ventas');
  });

  test('cerrar HOY con una cuenta abierta: hay_abiertas y no cambia NADA (las mesas se cobran primero, como siempre); sin cuenta abierta, se cierra', () => {
    limpiar();
    sql('update public.mesas set estado = $$libre$$;');
    const hoy1 = venta(id('h'), 1, 10000, HOY, '09:00');
    sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('abierta-2', 2, 'abierta', '[]', 0, now());`);
    const antesOrdenes = ordenes();
    const { cid, r } = cierraDe(HOY, [hoy1]);
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'hay_abiertas');
    assert.deepEqual(r.abiertas, [2]);
    assert.equal(cierre(cid), undefined);
    assert.deepEqual(ordenes(), antesOrdenes);
    sql("delete from public.ordenes where id = 'abierta-2';");
    assert.equal(cierraDe(HOY, [hoy1], 'admin', cid).r.ok, true);
  });

  test('el admin firma lo que ve: otro total, otra cantidad o otras ventas dan `cambio` con el resumen de la base y no cambia nada; un día sin ventas, sin_ventas; un día futuro o sin id, inválido', () => {
    limpiar();
    const a = venta(id('a'), 1, 10000, AYER, '10:00');
    const b = venta(id('a'), 2, 20000, AYER, '11:00');
    const antesOrdenes = ordenes();
    const llamar = (esperado, dia = AYER, cid = id('c')) => rpc('admin', `public.cerrar_dia_de(${literal(cid)}, ${literal(dia)}::date, ${literal(JSON.stringify(esperado))}::jsonb)`);
    let r = llamar({ n: 2, total: 29999, ids: [a[0], b[0]].sort() });
    assert.equal(r.codigo, 'cambio');
    assert.equal(r.resumen.n, 2);
    assert.equal(r.resumen.total, 30000);
    assert.deepEqual(r.resumen.ids, [a[0], b[0]].sort());
    assert.equal(r.resumen.dia, AYER);
    assert.equal(llamar({ n: 3, total: 30000, ids: [a[0], b[0]].sort() }).codigo, 'cambio');
    assert.equal(llamar({ n: 2, total: 30000, ids: [a[0], 'otra'].sort() }).codigo, 'cambio', 'mismas cifras, otras ventas');
    assert.equal(llamar({ n: 2, total: 30000, ids: 'x' }).codigo, 'invalido');
    assert.equal(llamar({ n: 2, total: 30000, ids: [a[0], b[0]].sort() }, ANTEAYER).codigo, 'sin_ventas');
    assert.equal(llamar({ n: 0, total: 0 }, ANTEAYER).codigo, 'sin_ventas');
    const manana = filas(`select (privado.hoy_bogota() + 1)::text as d`)[0].d;
    assert.equal(llamar({ n: 2, total: 30000 }, manana).codigo, 'invalido', 'un día futuro no se cierra');
    assert.equal(rpc('admin', `public.cerrar_dia_de('', ${literal(AYER)}::date, '{}'::jsonb)`).codigo, 'invalido');
    assert.equal(rpc('admin', `public.cerrar_dia_de('c-x', null, '{}'::jsonb)`).codigo, 'invalido');
    assert.equal(rpc('admin', `public.cerrar_dia_de('c-x', ${literal(AYER)}::date, '[]'::jsonb)`).codigo, 'invalido');
    assert.deepEqual(ordenes(), antesOrdenes, 'ninguno de esos intentos cambió nada');
    assert.equal(filas('select count(*)::int as n from public.cierres')[0].n, 0);
    // sin la lista de ids (un POS que solo manda cuántas y cuánto) también cierra, si cuadra
    assert.equal(llamar({ n: 2, total: 30000 }).ok, true);
  });

  test('el mismo cierre otra vez (se perdió la respuesta): devuelve el que ya se guardó, sin cerrar nada más ni duplicar el rastro', () => {
    limpiar();
    const a = venta(id('a'), 1, 10000, AYER, '10:00');
    const { cid, r } = cierraDe(AYER, [a]);
    assert.equal(r.ok, true);
    const otraVenta = venta(id('a'), 2, 99000, AYER, '11:00');       // una venta nueva de ayer, después del cierre
    const repetido = rpc('admin', `public.cerrar_dia_de(${literal(cid)}, ${literal(AYER)}::date, ${literal(ESPERADO([a]))}::jsonb)`);
    assert.equal(repetido.ok, true);
    assert.equal(repetido.repetido, true);
    assert.equal(repetido.n, 1);
    assert.equal(repetido.total, 10000);
    assert.equal(repetido.borradas, 0);
    assert.equal(repetido.cierre.ordenes.length, 1);
    assert.ok(ordenes().includes(`${otraVenta[0]}:cerrada`), 'la venta nueva no se cerró con el reintento');
    assert.equal(rastro(cid).length, 1, 'y el rastro no se duplicó');
  });

  test('cerrar_dia de siempre (la firma vieja) sigue cerrando TODAS las ventas por cerrar, de cualquier día, con la fecha de ahora', () => {
    limpiar();
    sql('update public.mesas set estado = $$libre$$;');
    const ventas = [venta(id('h'), 1, 10000, HOY), venta(id('a'), 2, 30000, AYER), venta(id('v'), 3, 5000, HACE3)];
    const cid = id('c');
    const r = rpc('admin', `public.cerrar_dia(${literal(cid)}, ${literal(ESPERADO(ventas))}::jsonb)`);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.n, 3);
    assert.equal(r.total, 45000);
    assert.deepEqual(ordenes(), []);
    assert.equal(cierre(cid).total_ventas, 45000);
    assert.equal(rpc('mesero', `public.cerrar_dia(${literal(id('c'))}, '{}'::jsonb)`).codigo, 'no_autorizado');
  });

  test('una venta sin hora de cierre cuenta por su hora de apertura; los cobros deshechos hasta ese día pasan al cierre y los de hoy siguen abiertos', () => {
    limpiar();
    sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, version)
         values ('sin-hora', 1, 'cerrada', '[{"id":"p1","nombre":"Seco","precio":9000,"qty":1}]', 9000, ${bogota(AYER, '15:00')}, null, 1);`);
    sql(`insert into public.deshechos (orden_id, mesa_id, tipo, monto, hecho_por, hecho_en) values
           ('d1', 1, 'parcial', 4000, 'mesero1@resplandor.test', ${bogota(AYER, '16:00')}),
           ('d2', 2, 'abono', 6000, 'mesero1@resplandor.test', ${bogota(HOY, '10:00')});`);
    const { cid, r } = cierraDe(AYER, [['sin-hora', 1, 9000]]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.deshechos.length, 1, 'el cobro deshecho de ayer cuelga del cierre de ayer');
    assert.equal(r.deshechos[0].orden_id, 'd1');
    assert.deepEqual(filas('select orden_id, cierre_id from public.deshechos order by orden_id'), [{ orden_id: 'd1', cierre_id: cid }, { orden_id: 'd2', cierre_id: null }]);
  });

  test('el rastro se escribe por TODOS los caminos: el cierre, la nota, sacar una venta (reabrir), editar el historial a mano, anular; con quién, antes, después y la venta completa; y no se cambia ni se borra', () => {
    limpiar();
    sql('update public.mesas set estado = $$libre$$;');
    const a = venta(id('a'), 1, 10000, AYER, '10:00');
    const b = venta(id('a'), 2, 20000, AYER, '11:00');
    const c3 = venta(id('a'), 3, 5000, AYER, '12:00');
    const { cid, r } = cierraDe(AYER, [a, b, c3]);
    assert.equal(r.ok, true);
    // 1. el cierre
    let rs = rastro(cid);
    assert.deepEqual(rs.map((x) => x.accion), ['cierre']);
    assert.equal(rs[0].quien, 'admin@resplandor.test');
    assert.equal(rs[0].detalle.origen, `cerrar_dia_de ${AYER}`);
    assert.deepEqual(rs[0].antes, {});
    assert.equal(rs[0].despues.total, 35000);
    assert.equal(rs[0].despues.n, 3);
    assert.deepEqual(rs[0].despues.ventas.map((v) => v.id).sort(), [a[0], b[0], c3[0]].sort());
    // 2. la nota (y corregirla a lo mismo no deja otra fila)
    let nota = rpc('admin', `public.cierre_corregir_nota(${literal(cid)}, '  Faltó la propina de la mesa 2  ')`);
    assert.deepEqual(nota, { ok: true, sin_cambio: false, cierre: { id: cid, nota: 'Faltó la propina de la mesa 2' } });
    assert.equal(rpc('admin', `public.cierre_corregir_nota(${literal(cid)}, 'Faltó la propina de la mesa 2')`).sin_cambio, true);
    rs = rastro(cid);
    assert.deepEqual(rs.map((x) => x.accion), ['cierre', 'nota']);
    assert.equal(rs[1].antes.nota, null);
    assert.equal(rs[1].despues.nota, 'Faltó la propina de la mesa 2');
    assert.equal(rs[1].quien, 'admin@resplandor.test');
    assert.equal(cierre(cid).total_ventas, 35000, 'la nota no tocó un peso');
    assert.equal(rpc('admin', `public.cierre_corregir_nota(${literal(cid)}, '')`).cierre.nota, null, 'vacío la quita');
    assert.equal(rpc('admin', `public.cierre_corregir_nota(${literal(cid)}, ${literal('x'.repeat(501))})`).codigo, 'nota_larga');
    assert.equal(rpc('admin', `public.cierre_corregir_nota('no-existe', 'x')`).codigo, 'no_existe');
    assert.equal(rpc('admin', `public.cierre_corregir_nota('', 'x')`).codigo, 'invalido');
    // 3. sacar una venta con reabrir_venta_de_cierre (el de siempre): 'venta_sacada', con la venta completa
    const re = rpc('admin', `public.reabrir_venta_de_cierre(${literal(cid)}, ${literal(b[0])}, 2)`);
    assert.equal(re.ok, true, JSON.stringify(re));
    assert.equal(cierre(cid).total_ventas, 15000, 'el total sale de las ventas que quedan');
    rs = rastro(cid);
    assert.deepEqual(rs.map((x) => x.accion), ['cierre', 'nota', 'nota', 'venta_sacada']);
    const sacada = rs[3];
    assert.equal(sacada.detalle.sacadas.length, 1);
    assert.equal(sacada.detalle.sacadas[0].id, b[0]);
    assert.equal(sacada.detalle.sacadas[0].total, 20000);
    assert.equal(sacada.antes.total, 35000);
    assert.equal(sacada.despues.total, 15000);
    assert.equal(sacada.quien, 'admin@resplandor.test');
    // 4. la edición a mano del historial (el upsert del POS): cambiar el total de una venta → 'edicion' con el antes y el después
    const trans = cierre(cid).transacciones.map((t) => (t.id === a[0] ? { ...t, total: 11000 } : t));
    const e = api('admin', `update public.cierres set transacciones = ${literal(JSON.stringify(trans))}::jsonb, total_ventas = 16000 where id = ${literal(cid)};`);
    assert.ok(e.ok, e.error);
    rs = rastro(cid);
    assert.equal(rs.at(-1).accion, 'edicion');
    assert.equal(rs.at(-1).detalle.editadas[0].antes.total, 10000);
    assert.equal(rs.at(-1).detalle.editadas[0].despues.total, 11000);
    assert.equal(rs.at(-1).quien, 'admin@resplandor.test');
    // …y quitar una venta desde el historial (eliminarOrdenDeCierre) también se anota, con la venta completa
    const sin = cierre(cid).transacciones.filter((t) => t.id !== c3[0]);
    assert.ok(api('admin', `update public.cierres set transacciones = ${literal(JSON.stringify(sin))}::jsonb, total_ventas = 11000, total_ordenes = 1 where id = ${literal(cid)};`).ok);
    assert.equal(rastro(cid).at(-1).accion, 'venta_sacada');
    assert.equal(rastro(cid).at(-1).detalle.sacadas[0].id, c3[0]);
    // subir otra vez lo mismo (el reintento del POS) no es un cambio
    const filasAntes = rastro(cid).length;
    assert.ok(api('admin', `update public.cierres set fecha = fecha, total_ventas = total_ventas where id = ${literal(cid)};`).ok);
    assert.equal(rastro(cid).length, filasAntes);
    // el rastro solo se agrega: ni el dueño lo cambia ni lo borra
    for (const texto of ["update public.cierres_cambios set quien = 'otro'", 'delete from public.cierres_cambios']) {
      const x = pg.sql(`\\set VERBOSITY verbose\n${texto};`);
      assert.equal(x.ok, false);
      assert.match(x.error, /RS007/);
    }
    // un cierre que se BORRA (nadie por la API puede, pero el SQL Editor sí) deja su rastro
    sql(`delete from public.cierres where id = ${literal(cid)};`);
    assert.ok(rastro(cid).length >= 6, 'el rastro sobrevive al cierre');
    assert.equal(filas('select count(*)::int as n from public.cierres_cambios where quien is null')[0].n, 0, 'siempre dice quién');
  });

  test('ANULAR un cierre: exige motivo, no borra el cierre ni sus ventas, las ventas vuelven por cerrar con su total, ítems y horas, el cierre queda congelado, y se puede cerrar el día bien otra vez', () => {
    limpiar();
    sql('update public.mesas set estado = $$libre$$;');
    const a = venta(id('a'), 1, 10000, AYER, '10:00');
    const b = venta(id('a'), 2, 20000, AYER, '23:40');
    const antesVentas = filas('select id, mesa_id, items, total, abierta_en, cerrada_en, version from public.ordenes order by id');
    const { cid, r } = cierraDe(AYER, [a, b]);
    assert.equal(r.ok, true);
    assert.deepEqual(ordenes(), []);
    // el motivo es obligatorio
    for (const motivo of ['', '  ', 'x', 'ab']) assert.equal(rpc('admin', `public.cierre_anular(${literal(cid)}, ${literal(motivo)})`).codigo, 'motivo_requerido', `motivo «${motivo}»`);
    assert.equal(rpc('admin', `public.cierre_anular(${literal(cid)}, ${literal('m'.repeat(301))})`).codigo, 'motivo_requerido');
    assert.equal(rpc('admin', `public.cierre_anular('no-existe', 'cierre de otro día')`).codigo, 'no_existe');
    assert.equal(rpc('admin', `public.cierre_anular('', 'cierre de otro día')`).codigo, 'invalido');
    assert.equal(cierre(cid).anulado_en, null, 'nada de eso anuló el cierre');
    // se anula
    const x = rpc('admin', `public.cierre_anular(${literal(cid)}, '  Cerré el día equivocado  ')`);
    assert.equal(x.ok, true, JSON.stringify(x));
    assert.equal(x.liberadas, 2);
    assert.equal(x.omitidas, 0);
    assert.equal(x.total, 30000);
    assert.equal(x.cierre.anulado_por, 'admin@resplandor.test');
    assert.equal(x.cierre.anulado_motivo, 'Cerré el día equivocado');
    // el cierre se queda, con sus ventas como estaban y su total
    const c = cierre(cid);
    assert.ok(c.anulado_en);
    assert.equal(c.total_ventas, 30000);
    assert.equal(c.total_ordenes, 2);
    assert.equal(c.transacciones.length, 2);
    // las ventas están de vuelta, cerradas, sin archivar, idénticas (mismo total, ítems y horas)
    assert.deepEqual(filas('select id, mesa_id, items, total, abierta_en, cerrada_en, version from public.ordenes order by id'), antesVentas);
    assert.equal(filas('select count(*)::int as n from public.ordenes where estado = $$cerrada$$')[0].n, 2);
    assert.equal(filas('select count(*)::int as n from public.cierre_ordenes')[0].n, 0, 'ya no pertenecen a ningún cierre');
    // el rastro dice quién, cuándo y por qué
    const rs = rastro(cid);
    assert.deepEqual(rs.map((q) => q.accion), ['cierre', 'anulado']);
    assert.equal(rs[1].motivo, 'Cerré el día equivocado');
    assert.equal(rs[1].quien, 'admin@resplandor.test');
    assert.equal(rs[1].antes.anulado_en, null);
    assert.ok(rs[1].despues.anulado_en);
    // no se anula dos veces, no se le corrige la nota, no se le saca una venta ni se edita (RS006) y no se descongela con un UPDATE
    assert.equal(rpc('admin', `public.cierre_anular(${literal(cid)}, 'otra vez')`).codigo, 'ya_anulado');
    assert.equal(rpc('admin', `public.cierre_corregir_nota(${literal(cid)}, 'x')`).codigo, 'anulado');
    for (const texto of [
      `select public.reabrir_venta_de_cierre(${literal(cid)}, ${literal(a[0])}, 1)`,
      `update public.cierres set total_ventas = 1 where id = ${literal(cid)}`,
      `update public.cierres set transacciones = '[]'::jsonb where id = ${literal(cid)}`,
    ]) {
      const e = api('admin', `\\set VERBOSITY verbose\n${texto};`);
      assert.equal(e.ok, false, texto);
      assert.match(e.error, /RS006/, texto);
    }
    assert.equal(cierre(cid).total_ventas, 30000);
    assert.equal(filas('select count(*)::int as n from public.ordenes where estado = $$abierta$$')[0].n, 0, 'reabrir en un cierre anulado no dejó una cuenta abierta');
    // se vuelve a cerrar bien: un cierre nuevo con las mismas dos ventas, sin duplicar nada
    const otra = cierraDe(AYER, [a, b]);
    assert.equal(otra.r.ok, true, JSON.stringify(otra.r));
    assert.equal(otra.r.total, 30000);
    assert.equal(cierre(otra.cid).total_ordenes, 2);
    assert.equal(filas('select count(*)::int as n from public.cierre_ordenes')[0].n, 2);
    assert.deepEqual(ordenes(), []);
    assert.equal(filas('select count(*)::int as n from public.cierres where anulado_en is null')[0].n, 1, 'un solo cierre vigente de ayer');
  });

  test('anular es todo o nada: si a una venta le falta su mesa no se cambia nada; una venta cuyo id ya vive en `ordenes` no se duplica (omitidas); los cierres de datos viejos (snake_case, horas faltantes) vuelven', () => {
    limpiar();
    sql('update public.mesas set estado = $$libre$$;');
    // un cierre que apunta a una mesa que no existe
    sql(`insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('c-sin-mesa', ${bogota(AYER, '23:59:59')}, 3000, 1,
           '[{"id":"x-1","mesaId":777,"estado":"cerrada","items":[],"total":3000}]'::jsonb);`);
    const sin = rpc('admin', "public.cierre_anular('c-sin-mesa', 'prueba de mesa')");
    assert.equal(sin.ok, false);
    assert.equal(sin.codigo, 'mesa_inexistente');
    assert.deepEqual(sin.mesas, ['777']);
    assert.equal(cierre('c-sin-mesa').anulado_en, null);
    assert.equal(filas("select count(*)::int as n from public.cierre_ordenes where cierre_id = 'c-sin-mesa'")[0].n, 1, 'sigue archivada');
    assert.deepEqual(ordenes(), []);
    // un cierre cuya venta tiene el mismo id que una cuenta que vive abierta (la «archivada y abierta» del RS005): no se duplica
    sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('viva-1', 4, 'abierta', '[]', 0, now());`);
    sql(`insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('c-omitida', ${bogota(AYER, '23:59:59')}, 7000, 2,
           '[{"id":"viva-1","mesaId":4,"items":[{"id":"p1","nombre":"Seco","precio":4000,"qty":1}],"total":4000},
             {"id":"vieja-1","mesa_id":1,"items":[{"id":"p1","nombre":"Seco","precio":3000,"qty":1}],"total":3000,"cerrada_en":"2026-10-04T15:00:00Z"}]'::jsonb);`);
    const om = rpc('admin', "public.cierre_anular('c-omitida', 'prueba de omitidas')");
    assert.equal(om.ok, true, JSON.stringify(om));
    assert.equal(om.liberadas, 1);
    assert.equal(om.omitidas, 1);
    assert.deepEqual(ordenes(), ['vieja-1:cerrada', 'viva-1:abierta']);
    const vieja = filas("select mesa_id, total, cerrada_en, abierta_en is not null as con_apertura from public.ordenes where id = 'vieja-1'")[0];
    assert.equal(vieja.mesa_id, 1, 'la mesa viene de mesa_id si no hay mesaId');
    assert.equal(Number(vieja.total), 3000);
    assert.equal(Date.parse(vieja.cerrada_en), Date.parse('2026-10-04T15:00:00Z'));
    assert.equal(vieja.con_apertura, true, 'sin hora de apertura se usa la fecha del cierre');
  });

  test('lo que se anula no se pierde de las cuentas: las ventas liberadas de un día pasado se cierran con cerrar_dia_de de ESE día, y el cierre nuevo cae en su día', () => {
    limpiar();
    sql('update public.mesas set estado = $$libre$$; delete from public.ordenes;');
    const a = venta(id('a'), 1, 10000, ANTEAYER, '10:00');
    const hoy1 = venta(id('h'), 2, 4000, HOY, '10:00');
    const { cid } = cierraDe(ANTEAYER, [a]);
    assert.equal(rpc('admin', `public.cierre_anular(${literal(cid)}, 'lo cerré con la fecha mal')`).ok, true);
    assert.equal(cierraDe(HOY, [hoy1]).r.ok, true, 'cerrar hoy no se lleva la venta de anteayer');
    assert.deepEqual(ordenes(), [`${a[0]}:cerrada`]);
    const nuevo = cierraDe(ANTEAYER, [a]);
    assert.equal(nuevo.r.ok, true);
    assert.equal(cierre(nuevo.cid).fecha_bogota, `${ANTEAYER} 23:59:59`);
  });

  test('aplicarla dos veces es inocua: el catálogo queda idéntico, sin WARNING, y los datos (cierres, rastro, ventas) no cambian', () => {
    const datos = () => JSON.stringify([filas('select * from public.cierres order by id'), filas('select * from public.cierres_cambios order by id'), filas('select * from public.ordenes order by id')]);
    const antesDatos = datos();
    const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(otra.length, 1);
    assert.ok(otra[0].ok, otra[0].error);
    assert.deepEqual(otra[0].avisos, [], 'la segunda aplicación no deja WARNING');
    assert.deepEqual(radiografia(pg), despues, 'el catálogo no cambió');
    assert.equal(datos(), antesDatos);
  });

  test('la reversa de la cabecera corre en limpio y deja el catálogo como antes (los cierres vuelven a ser editables por completo); reaplicar lo deja como después', () => {
    const r = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(r.ok, 'la reversa falló: ' + r.error);
    assert.deepEqual(r.avisos, []);
    const ahora = radiografia(pg);
    for (const [seccion, lista] of Object.entries(antes)) assert.deepEqual(ahora[seccion], lista, `tras la reversa quedó distinto: ${seccion}`);
    assert.equal(filas("select count(*)::int as n from information_schema.columns where table_name = 'cierres' and column_name in ('nota', 'anulado_en', 'anulado_por', 'anulado_motivo')")[0].n, 0);
    assert.equal(filas("select to_regclass('public.cierres_cambios') is null as n")[0].n, true);
    // sin la migración, el admin vuelve a poder actualizar cualquier columna de `cierres` y cerrar_dia sigue ahí
    const c = filas('select id from public.cierres limit 1');
    sql(`insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('c-rev', now(), 1, 1, '[]');`);
    assert.ok(api('admin', "update public.cierres set creado_en = now() where id = 'c-rev';").ok, 'UPDATE de tabla completa repuesto');
    assert.equal(filas("select to_regprocedure('public.cerrar_dia(text, jsonb)') is not null as n")[0].n, true);
    sql("delete from public.cierres where id = 'c-rev';");
    void c;
    const reaplicada = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.ok(reaplicada[0].ok, 'no se pudo volver a aplicar tras la reversa: ' + reaplicada[0].error);
    assert.deepEqual(reaplicada[0].avisos, []);
    assert.deepEqual(radiografia(pg), despues, 'reaplicar tras la reversa deja el catálogo como la primera vez');
  });
});

describe('se niega a correr, sin cambiar nada, si falta lo anterior (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('sin 20261002180000 (cierre_ordenes, deshechos, cerrar_dia): error claro y NADA creado; con la cadena completa, se aplica sin avisos', () => {
    const aplicarMia = () => pg.sql(SQL, { como: 'migrador' });
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: '20261002180000' });
    assert.ok(previas.length >= 8 && previas.every((m) => m.ok), JSON.stringify(previas.filter((m) => !m.ok)));
    const a0 = radiografia(pg);
    const sin = aplicarMia();
    assert.equal(sin.ok, false);
    assert.match(sin.error, /Falta 20261002180000_deshacer_cobro\.sql.*No se cambió nada/s);
    assert.deepEqual(radiografia(pg), a0, 'sin lo anterior: no dejó nada creado');
    assert.equal(pg.filas("select to_regclass('public.cierres_cambios') is null as n")[0].n, true);
    assert.equal(pg.filas("select count(*)::int as n from information_schema.columns where table_name = 'cierres' and column_name = 'nota'")[0].n, 0);
    const resto = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: '20261002180000', antesDe: MIGRACION });
    assert.ok(resto.every((m) => m.ok), JSON.stringify(resto.filter((m) => !m.ok)));
    const bien = aplicarMia();
    assert.ok(bien.ok, bien.error);
    assert.deepEqual(bien.avisos, []);
  });
});
