// La lápida de las cuentas borradas: supabase/migrations/20261006150000_lapida_de_cuentas_borradas.sql (`privado.ordenes_borradas`, `trg_ordenes_anotar_borrada`,
// `trg_ordenes_olvidar_borrada`, `trg_ordenes_guardia_lapida` → RS007, `trg_cierres_purga_lapida`).
// Séptima refutación del 2026-10-06 (tareas/2026-10-04-hallazgos-domingo.md): cuando OTRA tablet cobró toda la cuenta por partes y liberó la mesa (o la anuló y la liberó), la fila de la
// cuenta ya no existe; la tablet con la copia vieja cerraba la mesa completa y el upsert la INSERTABA como una venta cerrada nueva (124.000 por una mesa de 62.000, o una venta fantasma).
// La guardia RS003 solo juzga el UPDATE. Ahora la base recuerda los ids que borró y rechaza (RS007) un INSERT cerrado de la API con uno de ellos.
//
// Dos partes, como migracion-cobrar-parcial.test.mjs:
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. Los cuatro triggers con su tipo, SECURITY DEFINER donde escribe la lápida y SECURITY INVOKER en la guardia, permisos,
//      requisitos antes de crear nada, sin datos, y la reversa de la cabecera.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker): la cadena COMPLETA y, con un mesero y un admin de verdad (RLS):
//        · X1 / X2 / X3 del refutador en SQL: cobrar por partes TODO y liberar, anular y liberar → el upsert cerrado con ese id da RS007 y no queda ninguna venta de más;
//        · lo que NO se frena: una cuenta que nunca estuvo en la base (cobrada sin red, jamás subida), el UPDATE de una cuenta que existe, una cuenta ABIERTA, el dueño / service_role / las funciones;
//        · deshacer_cobro: el cobro completo que reabre su fila (UPDATE) y se vuelve a cobrar; el que pasa a OTRA cuenta (borra la cerrada: la variante de la refutación) y el parcial que vuelve a su cuenta;
//        · reabrir_venta_de_cierre: la cuenta que vuelve a existir sale de la lápida y se cobra otra vez; el orden de los guardias (RS005 antes que RS007);
//        · la limpieza (7 días, al guardar un cierre), permisos (la tabla es privada), se aplica dos veces sin cambiar nada, la reversa, y se niega a correr, sin cambiar nada, si falta lo previo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa, fijarDiaPromo } from './_cola-impresion-pg.mjs';

const NUEVA = '20261006150000_lapida_de_cuentas_borradas.sql';
const UNION = '20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql';
const DESHACER = '20261002180000_deshacer_cobro.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${NUEVA}`);
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CODIGO = sinComentarios(SQL);
const CP = compacto(CODIGO);
/** El cuerpo $function$ … $function$ de la función que empieza con `firma`. */
const funcion = (firma) => {
  const i = CP.indexOf(firma);
  assert.ok(i >= 0, `no encuentro «${firma}»`);
  const ini = CP.indexOf('$function$', i);
  const fin = CP.indexOf('$function$', ini + 10);
  assert.ok(ini > 0 && fin > ini, `no encuentro el cuerpo de ${firma}`);
  return CP.slice(ini, fin);
};
const cabecera = (firma) => CP.slice(CP.indexOf(firma), CP.indexOf('$function$', CP.indexOf(firma)));

// ───────────────────────── 1. estática ─────────────────────────

test('va la ÚLTIMA de la cadena, con prefijo único, y las migraciones anteriores NO se tocaron (ordenes_guardia sigue siendo la de 20261002180000)', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.equal(nombres[nombres.length - 1], '20261006160000_servida.sql', 'solo le sigue «servida» (una columna de ordenes, de main)');
  assert.equal(nombres[nombres.length - 2], NUEVA, 'es la penúltima de la cadena');
  assert.equal(nombres[nombres.length - 3], UNION, 'detrás de la unión de normalizar_items');
  const deshacer = compacto(sinComentarios(leer(`supabase/migrations/${DESHACER}`)));
  assert.ok(deshacer.includes('create or replace function public.ordenes_guardia()'), 'la guardia RS003/RS005 sigue en su migración');
  assert.doesNotMatch(CP, /create or replace function public\.ordenes_guardia\(\)|create or replace function public\.ordenes_guardia_borrar\(\)/, 'esta migración no redefine los guardias de antes: tiene el suyo');
  assert.doesNotMatch(CP.replace(/Falta 20261002180000_deshacer_cobro\.sql/g, ''), /normalizar_items|cobrar_parcial|cobrar_abono|deshacer_cobro/, 'no toca el cobro ni las promos');
});

test('los cuatro triggers de ordenes y el de cierres: el tipo y el nombre son los del diseño (el orden alfabético pone la guardia de la lápida DESPUÉS de ordenes_guardia y antes de la de promos)', () => {
  assert.match(CP, /create trigger trg_ordenes_anotar_borrada after delete on public\.ordenes for each row execute function privado\.ordenes_anotar_borrada\(\);/);
  assert.match(CP, /create trigger trg_ordenes_olvidar_borrada after insert on public\.ordenes for each row execute function privado\.ordenes_olvidar_borrada\(\);/);
  assert.match(CP, /create trigger trg_ordenes_guardia_lapida before insert on public\.ordenes for each row execute function public\.ordenes_guardia_lapida\(\);/);
  assert.match(CP, /create trigger trg_cierres_purga_lapida after insert on public\.cierres for each statement execute function privado\.ordenes_borradas_purgar\(\);/);
  for (const t of ['trg_ordenes_anotar_borrada', 'trg_ordenes_olvidar_borrada', 'trg_ordenes_guardia_lapida', 'trg_cierres_purga_lapida']) {
    assert.ok(CP.includes(`drop trigger if exists ${t} on `), `idempotente: ${t}`);
  }
  assert.ok('trg_ordenes_guardia' < 'trg_ordenes_guardia_lapida' && 'trg_ordenes_guardia_lapida' < 'trg_ordenes_guardia_promo', 'orden de disparo');
});

test('la lápida es PRIVADA (esquema privado, RLS encendida, sin permisos), solo guarda id y hora, y quien escribe en ella es SECURITY DEFINER con search_path vacío', () => {
  assert.match(CP, /create table if not exists privado\.ordenes_borradas \( id text not null, borrada_en timestamp with time zone not null default now\(\), constraint ordenes_borradas_pkey primary key \(id\) \);/);
  assert.ok(CP.includes('alter table privado.ordenes_borradas enable row level security;'));
  assert.ok(CP.includes('revoke all on table privado.ordenes_borradas from public, anon, authenticated, service_role;'));
  assert.doesNotMatch(CP, /create policy|grant [^;]*privado\.ordenes_borradas|grant [^;]*\bto anon\b|grant [^;]*\bto public\b/);
  for (const f of ['privado.ordenes_anotar_borrada', 'privado.ordenes_olvidar_borrada', 'privado.ordenes_borradas_purgar', 'privado.orden_borrada']) {
    assert.match(cabecera(`create or replace function ${f}`), /security definer set search_path = ''/, `${f} es SECURITY DEFINER con search_path vacío`);
  }
  assert.ok(CP.includes('revoke all on function privado.ordenes_anotar_borrada() from public, anon, authenticated;'));
  assert.ok(CP.includes('revoke all on function privado.ordenes_olvidar_borrada() from public, anon, authenticated;'));
  assert.ok(CP.includes('revoke all on function privado.ordenes_borradas_purgar() from public, anon, authenticated;'));
  assert.ok(CP.includes('revoke all on function privado.orden_borrada(text) from public, anon, authenticated;'));
  assert.ok(CP.includes('grant execute on function privado.orden_borrada(text) to authenticated;'), 'la guardia (INVOKER) la ejecuta como authenticated');
  assert.ok(CP.includes('revoke all on function public.ordenes_guardia_lapida() from public, anon, authenticated;'));
});

test('la guardia corre como quien llama (SECURITY INVOKER: current_user dice quién es), solo juzga a la API y a las filas CERRADAS, y levanta RS007 con la frase que el POS reconoce', () => {
  assert.doesNotMatch(cabecera('create or replace function public.ordenes_guardia_lapida'), /security definer/i);
  assert.match(cabecera('create or replace function public.ordenes_guardia_lapida'), /set search_path = ''/);
  const f = funcion('create or replace function public.ordenes_guardia_lapida');
  const i1 = f.indexOf("current_user not in ('anon', 'authenticated')");
  const i2 = f.indexOf("new.estado is distinct from 'cerrada'");
  const i3 = f.indexOf('privado.orden_borrada(new.id)');
  assert.ok(i1 > 0 && i2 > i1 && i3 > i2, 'primero quién llama, luego si está cerrada, luego la lápida');
  assert.match(f, /raise exception 'esa cuenta ya no existe: la cobró o la liberó otra tablet' using errcode = 'RS007'/);
});

test('requisitos ANTES de crear nada; sin datos (el repo es público); la reversa de la cabecera nombra lo que crea', () => {
  const iPrimero = CODIGO.indexOf('create schema');
  const requisitos = CODIGO.slice(0, iPrimero);
  assert.match(requisitos, /to_regprocedure\('public\.ordenes_guardia\(\)'\) is null[\s\S]*Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /to_regprocedure\('public\.cierres_registrar_ordenes\(\)'\) is null[\s\S]*Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bdrop\b|\binsert\b|\bupdate\b/i);
  assert.doesNotMatch(SQL, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ni un correo');
  const fuera = CP.replace(/\$function\$.*?\$function\$/g, ' ').replace(/\$\$.*?\$\$/g, ' ').replace(/'[^']*'/g, ' ');
  assert.doesNotMatch(fuera, /\b(insert into|delete from|update \S+ set)\b/i, 'fuera de los cuerpos no escribe datos');
  assert.doesNotMatch(fuera, /\balter table (?!privado\.ordenes_borradas enable row level security)/i, 'solo enciende la RLS de su propia tabla');
  const rev = reversa(SQL);
  for (const t of ['trg_ordenes_guardia_lapida on public.ordenes', 'trg_ordenes_anotar_borrada on public.ordenes', 'trg_ordenes_olvidar_borrada on public.ordenes', 'trg_cierres_purga_lapida on public.cierres']) {
    assert.ok(rev.includes(`drop trigger if exists ${t};`), `la reversa quita ${t}`);
  }
  for (const f of ['public.ordenes_guardia_lapida()', 'privado.ordenes_anotar_borrada()', 'privado.ordenes_olvidar_borrada()', 'privado.ordenes_borradas_purgar()', 'privado.orden_borrada(text)']) {
    assert.ok(rev.includes(`drop function if exists ${f};`), `la reversa quita ${f}`);
  }
  assert.ok(rev.includes('drop table if exists privado.ordenes_borradas;'));
  for (const frase of ['REVERSA', 'Idempotente', 'lo aplica Yonatan: aparca', 'RS007', 'DESPUÉS de que todas las tablets recarguen', 'X1', 'deshacer_cobro', '7 días']) {
    assert.ok(SQL.includes(frase) || SQL.toLowerCase().includes(frase.toLowerCase()), `la cabecera no dice «${frase}»`);
  }
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

describe('contra un Postgres 17 desechable: la lápida con un mesero, un admin y gente de fuera de verdad (RLS)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  let antesDeLaMigracion;
  const como = (rol, texto) => pg.sql(`select t.como(${literal(rol)});\n${texto}`);
  const sql = (texto, opciones) => { const r = pg.sql(texto, opciones); assert.ok(r.ok, r.error); return r; };
  const una = (select) => pg.filas(select)[0];
  const ultima = (r) => r.salida.split('\n').pop();
  const aplicarNueva = () => pg.sql(SQL, { como: 'migrador' });
  const ordenada = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'acl' && typeof v === 'string' ? v.slice(1, -1).split(',').sort().join(',') : v)));
  const SOPA = (qty) => ({ id: 'zl-sopa', nombre: 'Sopa', precio: 7000, qty, nota: '' });
  const SECO = (qty) => ({ id: 'zl-seco', nombre: 'Seco', precio: 19000, qty, nota: '' });
  const L = (id, qty) => ({ id, qty });
  const limpiar = () => sql(`select t.fuera();
    delete from public.deshechos; delete from public.alertas; delete from public.ordenes; delete from public.cierres; delete from public.cierre_ordenes; delete from public.deltas_aplicados;
    delete from privado.ordenes_borradas; update public.mesas set estado = 'libre';`);
  const lapida = () => pg.filas('select id from privado.ordenes_borradas order by id').map((f) => f.id);
  const enLapida = (id) => lapida().includes(id);
  /** Una cuenta abierta en la mesa `mesa` (como el dueño: lo que pasa de verdad es que la abrió una tablet; da igual para lo que se prueba). */
  const cuenta = (id, mesa, items) => sql(`select t.fuera(); insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', ${literal(JSON.stringify(items))}::jsonb, 0, now()); update public.mesas set estado = 'ocupada' where id = ${mesa};`);
  const fila = (id) => una(`select id, estado, total, version, items, parcial_de from public.ordenes where id = ${literal(id)}`);
  const ventas = () => pg.filas("select id, total, parcial_de from public.ordenes where estado = 'cerrada' order by id");
  const suma = () => ventas().reduce((s, v) => s + Number(v.total), 0);
  /** El upsert de la fila CERRADA que sube el POS (mesa completa): INSERT … ON CONFLICT (id) DO UPDATE, con el rol de quien dice `rol`. Devuelve 'ok' o 'SQLSTATE: mensaje'. */
  const cerrarComoElPOS = (rol, id, mesa, items, total, version = null) => {
    const cols = `id, mesa_id, estado, items, total, abierta_en, cerrada_en${version === null ? '' : ', version'}`;
    const vals = `${literal(id)}, ${mesa}, 'cerrada', ${literal(JSON.stringify(items))}::jsonb, ${total}, now(), now()${version === null ? '' : `, ${version}`}`;
    const set = `estado = excluded.estado, items = excluded.items, total = excluded.total, cerrada_en = excluded.cerrada_en${version === null ? '' : ', version = excluded.version'}`;
    const consulta = `insert into public.ordenes (${cols}) values (${vals}) on conflict (id) do update set ${set}`;
    return ultima(como(rol, `select t.intenta(${literal(consulta)});`));
  };
  const cobrarPartes = (rol, id, venta, lineas, delta, version) => {
    const r = como(rol, `select t.cp(${literal(id)}, ${version}, ${literal(venta)}, ${literal(JSON.stringify(lineas))}::jsonb, ${literal(delta)});`);
    assert.ok(r.ok, r.error);
    return ultima(r);
  };
  const liberar = (rol, id) => ultima(como(rol, `select t.intenta(${literal(`delete from public.ordenes where id = ${literal(id)}`)});`));
  const RS007 = /^RS007: esa cuenta ya no existe: la cobró o la liberó otra tablet$/;

  const AYUDANTES = String.raw`
create or replace function t.cp(p_orden text, p_version int, p_venta text, p_lineas jsonb, p_delta text) returns text language plpgsql as
$$ begin
  return 'ok ' || public.cobrar_parcial(p_orden, p_version, jsonb_build_object('id', p_venta), p_lineas, p_delta)::text;
exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create or replace function t.cobrar_todo(p_orden text) returns numeric language plpgsql as
$$ declare v int; r numeric; begin
  select version into v from public.ordenes where id = p_orden;
  update public.ordenes set estado = 'cerrada', cerrada_en = now(), version = v where id = p_orden returning total into r;
  return r;
end $$;
`;

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: NUEVA });
    assert.ok(previas.length >= 20 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    assert.ok(previas.some((m) => m.archivo === UNION), 'la unión de normalizar_items va antes');
    fijarDiaPromo(pg, 2);   // un martes: sin promos de por medio (esta prueba es del dinero que se cuenta de más, no de las promos)
    sql(AYUDANTES);
    sql(`
      insert into public.personal (email, nombre, rol, activo, estado) values ('mesero1@resplandor.test', 'Mesero Uno', 'mesero', true, 'aprobado');
      insert into public.productos (id, categoria, nombre, precio, activo) values ('zl-sopa','Ejecutivos','Sopa',7000,true), ('zl-seco','Ejecutivos','Seco',19000,true);
      insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'a') from generate_series(1, 40) g;
    `);
    antes = radiografia(pg);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  // ── la migración ──

  test('se aplica como migrador (no superusuario), sin WARNING, y cambia SOLO lo suyo: la tabla privada, cinco funciones, tres triggers de ordenes y uno de cierres, y ninguna policy ni tabla de public', () => {
    const r = aplicarNueva();
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    const despues = radiografia(pg);
    const clave = (f) => JSON.stringify(f);
    const cambios = [];
    for (const [seccion, filas] of Object.entries(antes)) {
      const ahora = new Set(despues[seccion].map(clave));
      const antesSet = new Set(filas.map(clave));
      for (const f of filas) if (!ahora.has(clave(f))) cambios.push(`${seccion}: ya no está ${clave(f)}`);
      for (const f of despues[seccion]) if (!antesSet.has(clave(f))) cambios.push(`${seccion}: nuevo ${clave(f)}`);
    }
    const esperados = [
      /^relaciones: nuevo .*"rls":true.*"relname":"ordenes_borradas"\}$/,
      /^relaciones: nuevo .*"relname":"ordenes_borradas_pkey"/,
      /^relaciones: nuevo .*"relname":"ordenes_borradas_borrada_en"/,
      /^funciones: nuevo .*"proname":"ordenes_anotar_borrada"/,
      /^funciones: nuevo .*"proname":"ordenes_olvidar_borrada"/,
      /^funciones: nuevo .*"proname":"ordenes_borradas_purgar"/,
      /^funciones: nuevo .*"proname":"orden_borrada"/,
      /^funciones: nuevo .*"proname":"ordenes_guardia_lapida"/,
      /^triggers: nuevo .*trg_ordenes_anotar_borrada/,
      /^triggers: nuevo .*trg_ordenes_olvidar_borrada/,
      /^triggers: nuevo .*trg_ordenes_guardia_lapida/,
      /^triggers: nuevo .*trg_cierres_purga_lapida/,
      /^restricciones: nuevo .*ordenes_borradas_pkey/,
    ];
    assert.equal(cambios.length, esperados.length, cambios.join('\n'));
    for (const e of esperados) assert.ok(cambios.some((c) => e.test(c)), `falta el cambio ${e}: ${cambios.join('\n')}`);
    assert.deepEqual(despues.policies, antes.policies, 'ninguna policy');
    antesDeLaMigracion = antes;
    antes = despues;
  });

  // ── lo que pasaba: X1, X2, X3 ──

  test('X1: A cobra TODA la cuenta por partes y libera la mesa; B (copia vieja) cierra la mesa completa con su upsert → RS007, y la base sigue con las ventas de A (62.000), no 124.000', () => {
    limpiar();
    cuenta('x1', 1, [SECO(2), SOPA(2)]);   // 2 × 19.000 + 2 × 7.000 = 52.000
    const v0 = fila('x1').version;
    const total = Number(fila('x1').total);
    assert.equal(total, 52000);
    assert.match(cobrarPartes('mesero', 'x1', 'x1-v', [L('zl-seco', 2), L('zl-sopa', 2)], 'd-x1', v0), /^ok /, 'A cobra todo por partes');
    assert.equal(fila('x1').items.length, 0, 'la cuenta quedó vacía');
    assert.equal(liberar('mesero', 'x1'), 'ok', 'A libera la mesa: la cuenta vacía se borra');
    assert.equal(fila('x1'), undefined);
    assert.ok(enLapida('x1'), 'la lápida recuerda la cuenta borrada');
    // B, con su copia vieja (v0, 52.000), cierra la mesa completa: INSERT … ON CONFLICT DO UPDATE de una fila cerrada que ya no existe
    assert.match(cerrarComoElPOS('mesero', 'x1', 1, [SECO(2), SOPA(2)], total, v0), RS007);
    assert.equal(fila('x1'), undefined, 'no se insertó nada');
    assert.equal(suma(), total, 'la base registra lo de A, una sola vez');
    assert.deepEqual(ventas().map((v) => v.id), ['x1-v']);
  });

  test('X2: A quita todos los ítems (el pedido se anuló) y libera; B (copia vieja) cobra la mesa completa → RS007, ninguna venta fantasma', () => {
    limpiar();
    cuenta('x2', 2, [SECO(1), SOPA(2)]);
    const v = fila('x2').version;
    for (const [id, nombre, precio, qty] of [['zl-seco', 'Seco', 19000, -1], ['zl-sopa', 'Sopa', 7000, -2]]) {
      const r = como('mesero', `select public.aplicar_delta_orden('x2', ${literal(id)}, ${literal(nombre)}, ${precio}, ${qty}, '') is not null;`);
      assert.ok(r.ok, r.error);
    }
    assert.equal(fila('x2').items.length, 0);
    assert.equal(liberar('mesero', 'x2'), 'ok');
    assert.match(cerrarComoElPOS('mesero', 'x2', 2, [SECO(1), SOPA(2)], 33000, v), RS007);
    assert.deepEqual(ventas(), [], 'ninguna venta fantasma de una cuenta anulada');
    assert.equal(fila('x2'), undefined);
  });

  test('X3: B cierra SIN red (la fila queda pendiente), A cobra todo y libera; al volver la red de B la fila cerrada sube y la base la rechaza con RS007 (con y sin `version`)', () => {
    limpiar();
    cuenta('x3', 3, [SECO(2), SOPA(2)]);
    const v0 = fila('x3').version;
    assert.match(cobrarPartes('mesero', 'x3', 'x3-v', [L('zl-seco', 2), L('zl-sopa', 2)], 'd-x3', v0), /^ok /);
    assert.equal(liberar('mesero', 'x3'), 'ok');
    // lo que sube B: la misma fila cerrada, con la versión que vio o sin ella (una base sin la guardia de versión en el POS)
    assert.match(cerrarComoElPOS('mesero', 'x3', 3, [SECO(2), SOPA(2)], 52000, v0), RS007);
    assert.match(cerrarComoElPOS('mesero', 'x3', 3, [SECO(2), SOPA(2)], 52000), RS007);
    assert.match(cerrarComoElPOS('admin', 'x3', 3, [SECO(2), SOPA(2)], 52000, v0), RS007, 'también para un admin: la guardia es de la API, no del rol');
    assert.equal(suma(), 52000);
  });

  test('el mensaje que llega al POS: SQLSTATE RS007, la frase, el id en `details` y una pista (PostgREST los entrega separados)', () => {
    limpiar();
    cuenta('m1', 4, [SOPA(1)]);
    const v = fila('m1').version;
    como('mesero', "select public.aplicar_delta_orden('m1', 'zl-sopa', 'Sopa', 7000, -1, '') is not null;");
    liberar('mesero', 'm1');
    const r = como('mesero', `insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, version) values ('m1', 4, 'cerrada', '[]', 0, now(), now(), ${v});`);
    assert.equal(r.ok, false);
    assert.match(r.stderr, /ERROR:\s+(RS007:\s+)?esa cuenta ya no existe: la cobró o la liberó otra tablet/);
    assert.match(r.stderr, /DETAIL:\s+cuenta m1/);
    assert.match(r.stderr, /HINT:\s+La base borró esa cuenta/);
  });

  // ── lo que NO se frena ──

  test('una cuenta que NUNCA estuvo en la base (abierta y cobrada sin red, jamás subida) se inserta cerrada como siempre; tampoco se frena el UPDATE de una cuenta que existe, ni subir una cuenta ABIERTA', () => {
    limpiar();
    // nunca existió: su id no está en la lápida (aunque haya otras)
    cuenta('n0', 5, [SOPA(1)]); como('mesero', "select public.aplicar_delta_orden('n0', 'zl-sopa', 'Sopa', 7000, -1, '') is not null;"); liberar('mesero', 'n0');
    assert.ok(enLapida('n0'));
    assert.equal(cerrarComoElPOS('mesero', 'n1-sin-red', 6, [SOPA(3)], 21000, 0), 'ok', 'la cuenta cobrada sin red que jamás subió entra');
    assert.equal(fila('n1-sin-red').estado, 'cerrada');
    assert.equal(Number(fila('n1-sin-red').total), 21000);
    // la que existe: el upsert es un UPDATE y lo juzga RS003 (la versión), no la lápida
    cuenta('n2', 7, [SOPA(2)]);
    const v = fila('n2').version;
    assert.equal(cerrarComoElPOS('mesero', 'n2', 7, [SOPA(2)], 14000, v), 'ok');
    assert.equal(fila('n2').estado, 'cerrada');
    cuenta('n3', 8, [SOPA(2)]);
    assert.match(cerrarComoElPOS('mesero', 'n3', 8, [SOPA(2)], 14000, 99), /^RS003: /, 'una versión que no es la de la base sigue dando RS003');
    // subir una cuenta ABIERTA con el id de una borrada no es cobrarla: pasa (y la cuenta existe de nuevo)
    const abierta = como('mesero', "insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('n0', 5, 'abierta', '[]', 0, now());");
    assert.ok(abierta.ok, abierta.error);
    assert.equal(fila('n0').estado, 'abierta');
  });

  test('el dueño (SQL Editor) y las funciones SECURITY DEFINER no son la API: no se frenan (y la cuenta que reaparece sale de la lápida)', () => {
    limpiar();
    for (const [i, quien] of [[1, 'el dueño (superusuario)'], [2, 'migrador (el dueño de las migraciones: lo que corre el SQL Editor)']]) {
      const id = `p${i}`;
      cuenta(id, 8 + i, [SOPA(1)]); como('mesero', `select public.aplicar_delta_orden(${literal(id)}, 'zl-sopa', 'Sopa', 7000, -1, '') is not null;`); liberar('mesero', id);
      assert.ok(enLapida(id), `${quien}: borrada`);
      const r = pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en) values (${literal(id)}, ${8 + i}, 'cerrada', '[]', 0, now(), now());`, i === 2 ? { como: 'migrador' } : undefined);
      assert.ok(r.ok, `${quien}: ${r.error}`);
      assert.equal(fila(id).estado, 'cerrada');
      assert.equal(enLapida(id), false, `${quien}: la cuenta volvió a existir: sale de la lápida`);
    }
  });

  // ── deshacer_cobro ──

  test('deshacer_cobro del cobro COMPLETO de una mesa libre REABRE su fila (UPDATE, mismo id) y se puede volver a cobrar: la lápida no se mete', () => {
    limpiar();
    cuenta('d1', 10, [SECO(1), SOPA(1)]);
    como('mesero', "select t.cobrar_todo('d1');");
    assert.equal(fila('d1').estado, 'cerrada');
    const d = como('mesero', "select public.deshacer_cobro('d1') ->> 'ok';");
    assert.equal(ultima(d), 'true', d.error);
    assert.equal(fila('d1').estado, 'abierta', 'reabierta con el mismo id');
    assert.equal(enLapida('d1'), false, 'no se borró nada');
    const v = fila('d1').version;
    assert.equal(cerrarComoElPOS('mesero', 'd1', 10, [SECO(1), SOPA(1)], 26000, v), 'ok', 'y se vuelve a cobrar');
    assert.equal(fila('d1').estado, 'cerrada');
    assert.equal(suma(), 26000);
  });

  test('deshacer_cobro del cobro completo cuando la mesa YA tiene otra cuenta (la variante de la refutación): los ítems pasan a ésa, la cerrada se BORRA y queda en la lápida; una tablet con la copia vieja de la cerrada ya no la inserta', () => {
    limpiar();
    cuenta('d2', 11, [SECO(1), SOPA(1)]);
    como('mesero', "select t.cobrar_todo('d2');");
    cuenta('d2b', 11, [SOPA(1)]);   // otra cuenta abierta en la misma mesa (la ocupó otro cliente)
    const d = como('mesero', "select public.deshacer_cobro('d2') ->> 'ok';");
    assert.equal(ultima(d), 'true', d.error);
    assert.equal(fila('d2'), undefined, 'la cerrada se borró: sus ítems pasaron a la otra cuenta');
    assert.equal(Number(fila('d2b').total), 33000, '7.000 + 26.000');
    assert.ok(enLapida('d2'), 'deshacer_cobro borró la fila: la lápida lo recuerda');
    assert.match(cerrarComoElPOS('mesero', 'd2', 11, [SECO(1), SOPA(1)], 26000, 1), RS007, 'una tablet con la copia vieja no la vuelve a insertar');
    assert.deepEqual(ventas(), []);
  });

  test('deshacer_cobro de un cobro PARCIAL: la venta cerrada se borra (queda en la lápida) y la cuenta recupera sus unidades; la cuenta se cobra después sin tropezar, y esa venta deshecha no se reinserta por la API', () => {
    limpiar();
    cuenta('d3', 12, [SOPA(3)]);
    const v0 = fila('d3').version;
    assert.match(cobrarPartes('mesero', 'd3', 'd3-v', [L('zl-sopa', 1)], 'd-d3', v0), /^ok /);
    const d = como('mesero', "select public.deshacer_cobro('d3-v') ->> 'ok';");
    assert.equal(ultima(d), 'true', d.error);
    assert.equal(fila('d3-v'), undefined);
    assert.ok(enLapida('d3-v'));
    assert.equal(enLapida('d3'), false, 'la cuenta sigue existiendo');
    assert.match(cerrarComoElPOS('mesero', 'd3-v', 12, [SOPA(1)], 7000, 0), RS007, 'la venta deshecha no se reinserta');
    const v = fila('d3').version;
    assert.equal(cerrarComoElPOS('mesero', 'd3', 12, [SOPA(3)], 21000, v), 'ok', 'y la cuenta se cobra completa');
    assert.equal(suma(), 21000);
  });

  test('cobrar_parcial sigue insertando sus ventas (no es el INSERT cerrado directo de la API) y un cobro deshecho no se repite con su mismo id, como antes', () => {
    limpiar();
    cuenta('c1', 13, [SOPA(4)]);
    const v0 = fila('c1').version;
    assert.match(cobrarPartes('mesero', 'c1', 'c1-v', [L('zl-sopa', 1)], 'd-c1-1', v0), /^ok /);
    assert.match(cobrarPartes('mesero', 'c1', 'c1-w', [L('zl-sopa', 1)], 'd-c1-2', fila('c1').version), /^ok /);
    assert.equal(suma(), 14000);
    // un cobro deshecho NO se repite con su mismo id (RS003, como antes): la lápida no cambia eso
    como('mesero', "select public.deshacer_cobro('c1-v') ->> 'ok';");
    const repetido = cobrarPartes('mesero', 'c1', 'c1-v', [L('zl-sopa', 1)], 'd-c1-1', fila('c1').version);
    assert.match(repetido, /^RS003 /);
  });

  // ── el cierre del día y la reapertura ──

  test('el orden de los guardias: una venta archivada en un cierre del día (la purga la borró) da RS005 aunque también esté en la lápida; y reabrir_venta_de_cierre la devuelve y se cobra otra vez (sale de la lápida)', () => {
    limpiar();
    cuenta('r1', 14, [SOPA(2)]);
    como('mesero', "select t.cobrar_todo('r1');");
    const cierre = como('admin', `select public.cerrar_dia('cierre-r1', ${literal(JSON.stringify({ n: 1, total: 14000, ids: ['r1'] }))}::jsonb) ->> 'ok';`);
    assert.equal(ultima(cierre), 'true', cierre.error);
    assert.equal(fila('r1'), undefined, 'el cierre purgó la venta');
    assert.ok(enLapida('r1'), 'la purga también es un borrado');
    assert.match(cerrarComoElPOS('mesero', 'r1', 14, [SOPA(2)], 14000, 1), /^RS005: /, 'archivada: gana RS005 (trg_ordenes_guardia va antes)');
    const reabrir = como('admin', "select public.reabrir_venta_de_cierre('cierre-r1', 'r1', 14) ->> 'ok';");
    assert.equal(ultima(reabrir), 'true', reabrir.error);
    assert.equal(fila('r1').estado, 'abierta', 'la cuenta existe de nuevo');
    assert.equal(enLapida('r1'), false, 'y sale de la lápida: la lápida solo guarda ids que hoy no existen');
    const v = fila('r1').version;
    assert.equal(cerrarComoElPOS('mesero', 'r1', 14, [SOPA(2)], 14000, v), 'ok', 'reabrir una venta y cobrarla otra vez sigue funcionando');
    assert.equal(fila('r1').estado, 'cerrada');
  });

  test('guardar un cierre del día limpia de la lápida lo de más de 7 días y deja lo reciente (no crece sin límite)', () => {
    limpiar();
    sql(`insert into privado.ordenes_borradas (id, borrada_en) values ('vieja-8d', now() - interval '8 days'), ('limite-6d', now() - interval '6 days'), ('hoy', now());`);
    assert.deepEqual(lapida(), ['hoy', 'limite-6d', 'vieja-8d']);
    sql("insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('cierre-limpieza', now(), 0, 0, '[]'::jsonb);");
    assert.deepEqual(lapida(), ['hoy', 'limite-6d'], 'la de 8 días se fue; la de 6 se queda');
    // un borrado de la misma cuenta renueva su hora
    sql(`select t.fuera(); insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('hoy', 15, 'abierta', '[]', 0, now()); delete from public.ordenes where id = 'hoy';`);
    assert.deepEqual(lapida(), ['hoy', 'limite-6d']);
    assert.ok(Date.now() - new Date(una("select borrada_en from privado.ordenes_borradas where id = 'hoy'").borrada_en).getTime() < 120000);
  });

  // ── permisos ──

  test('la lápida es privada: ni anon, ni authenticated, ni service_role la leen ni la escriben; los ayudantes y los triggers no se ejecutan por la API; el mesero SÍ puede liberar una mesa (la función que anota es SECURITY DEFINER)', () => {
    limpiar();
    for (const rol of ['anon', 'authenticated', 'service_role']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        assert.equal(una(`select has_table_privilege('${rol}', 'privado.ordenes_borradas', '${priv}') as v`).v, false, `${rol} no tiene ${priv}`);
      }
    }
    assert.equal(una("select relrowsecurity as v from pg_class where oid = 'privado.ordenes_borradas'::regclass").v, true);
    const mesero = como('mesero', 'select count(*) from privado.ordenes_borradas;');
    assert.equal(mesero.ok, false);
    assert.match(mesero.stderr, /permission denied for table ordenes_borradas/);
    const anon = como('anon', 'select count(*) from privado.ordenes_borradas;');
    assert.equal(anon.ok, false);
    assert.match(anon.stderr, /permission denied/);
    assert.equal(una("select has_function_privilege('authenticated', 'privado.orden_borrada(text)', 'execute') as v").v, true, 'la guardia (INVOKER) la ejecuta');
    assert.equal(una("select has_function_privilege('anon', 'privado.orden_borrada(text)', 'execute') as v").v, false);
    assert.equal(una("select has_function_privilege('public', 'privado.orden_borrada(text)', 'execute') as v").v, false);
    for (const f of ['privado.ordenes_anotar_borrada()', 'privado.ordenes_olvidar_borrada()', 'privado.ordenes_borradas_purgar()', 'public.ordenes_guardia_lapida()']) {
      for (const rol of ['anon', 'authenticated', 'public']) assert.equal(una(`select has_function_privilege('${rol}', '${f}', 'execute') as v`).v, false, `${rol} no ejecuta ${f}`);
    }
    cuenta('l1', 16, []);
    assert.equal(liberar('mesero', 'l1'), 'ok', 'el mesero libera la mesa vacía sin tener permiso sobre la lápida');
    assert.ok(enLapida('l1'));
  });

  test('un borrado que un guardia descarta (la cuenta abierta CON ítems, la venta que ningún cierre archivó) no es un borrado: no anota nada', () => {
    limpiar();
    cuenta('g1', 17, [SOPA(1)]);
    liberar('mesero', 'g1');
    assert.equal(fila('g1').estado, 'abierta', 'la cuenta con ítems no se borra por la API');
    assert.equal(enLapida('g1'), false);
    cuenta('g2', 18, [SOPA(1)]);
    como('mesero', "select t.cobrar_todo('g2');");
    const r = como('admin', "delete from public.ordenes where id = 'g2';");
    assert.ok(r.ok, r.error);
    assert.equal(fila('g2').estado, 'cerrada', 'una venta sin archivar tampoco se borra');
    assert.equal(enLapida('g2'), false);
  });

  // ── idempotencia y reversa ──

  test('se aplica dos veces sin cambiar nada (el esquema y lo que hay en la lápida quedan igual)', () => {
    limpiar();
    cuenta('i1', 19, []); liberar('mesero', 'i1');
    const foto = ordenada(radiografia(pg));
    const contenido = JSON.stringify(pg.filas('select id from privado.ordenes_borradas order by id'));
    const r = aplicarNueva();
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(ordenada(radiografia(pg)), foto);
    assert.equal(JSON.stringify(pg.filas('select id from privado.ordenes_borradas order by id')), contenido);
    assert.match(cerrarComoElPOS('mesero', 'i1', 19, [], 0, 0), RS007, 'y la guardia sigue');
  });

  test('la REVERSA de la cabecera deja el esquema como estaba antes (la guardia ya no frena, la lápida ya no existe) y volver a aplicar lo deja igual que antes', () => {
    limpiar();
    const con = ordenada(radiografia(pg));
    const rev = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(rev.ok, rev.error);
    assert.deepEqual(rev.avisos, []);
    assert.deepEqual(ordenada(radiografia(pg)), ordenada(antesDeLaMigracion), 'idéntico al de antes de la migración');
    assert.equal(una("select to_regclass('privado.ordenes_borradas') is null as v").v, true);
    // con la reversa puesta, el defecto vuelve (es lo que la reversa promete: «deja lo de antes»)
    cuenta('z1', 20, [SOPA(1)]); como('mesero', "select public.aplicar_delta_orden('z1', 'zl-sopa', 'Sopa', 7000, -1, '') is not null;"); liberar('mesero', 'z1');
    assert.equal(cerrarComoElPOS('mesero', 'z1', 20, [], 0, 0), 'ok', 'sin la guardia, el upsert vuelve a insertar la venta');
    sql("delete from public.ordenes where id = 'z1';");
    const otra = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(otra.ok, otra.error);   // la reversa también es idempotente
    const nueva = aplicarNueva();
    assert.ok(nueva.ok, nueva.error);
    assert.deepEqual(ordenada(radiografia(pg)), con);
    cuenta('z2', 21, [SOPA(1)]); como('mesero', "select public.aplicar_delta_orden('z2', 'zl-sopa', 'Sopa', 7000, -1, '') is not null;"); liberar('mesero', 'z2');
    assert.match(cerrarComoElPOS('mesero', 'z2', 21, [], 0, 0), RS007, 'y vuelve a funcionar');
  });
});

describe('se niega a correr, sin cambiar nada, si falta 20261002180000 (Postgres desechable propio)', { skip: MOTIVO }, () => {
  const propio = async (quitar = '') => {
    const pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: NUEVA });
    assert.ok(previas.length >= 20 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    if (quitar) { const q = pg.sql(quitar); assert.ok(q.ok, q.error); }
    return pg;
  };

  test('sin public.ordenes_guardia() aborta con el mensaje que dice qué migración falta, y no deja tabla, funciones ni triggers', async () => {
    const pg = await propio('drop trigger trg_ordenes_guardia on public.ordenes; drop function public.ordenes_guardia();');
    try {
      const antes = radiografia(pg);
      const r = pg.sql(SQL, { como: 'migrador' });
      assert.equal(r.ok, false);
      assert.match(r.error, /Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/);
      assert.deepEqual(radiografia(pg), antes);
    } finally { pg.parar(); }
  });

  test('sin public.cierres_registrar_ordenes() también aborta, sin cambiar nada', async () => {
    const pg = await propio('drop trigger trg_cierres_registrar_ordenes on public.cierres; drop function public.cierres_registrar_ordenes();');
    try {
      const antes = radiografia(pg);
      const r = pg.sql(SQL, { como: 'migrador' });
      assert.equal(r.ok, false);
      assert.match(r.error, /Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/);
      assert.deepEqual(radiografia(pg), antes);
    } finally { pg.parar(); }
  });
});
