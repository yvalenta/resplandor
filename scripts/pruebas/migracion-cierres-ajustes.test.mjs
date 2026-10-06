// Ajustes a los cierres por día: supabase/migrations/20261006120000_cierres_ajustes.sql
// (lo que dejó la refutación de 20261006100000, tareas/2026-10-05-cierres-de-hoy-y-panel-admin.md):
//   · cerrar_dia_de(HOY) se lleva también las ventas con cerrada_en «de mañana» (el reloj adelantado de una tablet al pasar la medianoche): antes no
//     entraban en NINGÚN cierre y el POS tampoco las mostraba; un día pasado NO se las lleva;
//   · cierre_anular suelta los `deshechos` del cierre anulado (cierre_id = null): los toma el PRÓXIMO cierre que se haga (sea del día que sea, salvo uno anterior).
//
// Dos partes, como migracion-cierres-de-hoy.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): la migración cambia SOLO dos funciones (ninguna tabla, columna, policy, disparador ni permiso nuevo), cada una
//      es EL MISMO CUERPO que la de 20261006100000 más el cambio puntual (se compara el texto, no se supone), EXECUTE solo para `authenticated`, la cabecera
//      dice qué hace/qué necesita/cómo se deshace, y se niega a correr si falta la anterior.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker): la cadena hasta 20261006100000, la nueva encima y los escenarios: hoy cierra la de mañana (y el
//      admin la firma), un día pasado no, la venta de mañana sola, `cambio` si el POS no la contaba, lo de siempre sigue igual (mesero, hay_abiertas solo hoy,
//      el mismo id, la de las 23:30 de ayer), anular suelta los deshechos y cerrar otra vez los toma, el rastro anota lo mismo, aplicarla dos veces, la
//      reversa (volver a correr las secciones 4 y 6 de la anterior) y que se niegue a correr, sin cambiar nada, si falta 20261006100000.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia } from './_cola-impresion-pg.mjs';

const ANTERIOR = '20261006100000_cierres_de_hoy_y_cambios.sql';
const MIGRACION = '20261006120000_cierres_ajustes.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${MIGRACION}`);
const SQL_ANTERIOR = leer(`supabase/migrations/${ANTERIOR}`);
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CP = compacto(sinComentarios(SQL));
const CP_ANTERIOR = compacto(sinComentarios(SQL_ANTERIOR));

/** La función de `public` tal como la declara una migración (texto compacto, sin comentarios). */
function funcionPublica(cp, nombre) {
  const m = cp.match(new RegExp(`create or replace function public\\.${nombre}\\(([^)]*)\\) returns (\\w+) language (\\w+) (security definer )?set search_path = '' as \\$function\\$ (.*?) \\$function\\$;`));
  assert.ok(m, `no encuentro «create or replace function public.${nombre}(…) … $function$ … $function$;»`);
  return { args: m[1], retorna: m[2], lenguaje: m[3], definer: !!m[4], cuerpo: m[5] };
}

// ───────────────────────── 1. estática ─────────────────────────

test('la migración va después de 20261006100000 (que no se toca), sin otra de cierres entre las dos, y con prefijo único', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(nombres.includes(ANTERIOR) && nombres.includes(MIGRACION));
  assert.ok(ANTERIOR < MIGRACION, 'va después');
  // Puede haber otras migraciones entre las dos (p. ej. 20261006110000_precio_a_mano al fusionar ramas); lo que importa es que ninguna toque los cierres.
  const entre = nombres.slice(nombres.indexOf(ANTERIOR) + 1, nombres.indexOf(MIGRACION));
  assert.ok(entre.every((n) => !/cierre/.test(n)), `entre ${ANTERIOR} y ${MIGRACION} no debe haber otra migración de cierres (hay: ${entre.filter((n) => /cierre/.test(n)).join(', ')})`);
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
});

test('la cabecera dice qué hace, quién lo ve, qué necesita, cómo se deshace y que la aplica Yonatan', () => {
  const cab = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos')).replace(/\n--\s*/g, ' ');
  for (const frase of [
    'QUÉ HACE', 'QUIÉN LO VE Y QUIÉN LO CAMBIA', 'cerrar_dia_de', 'cierre_anular', 'POSTERIOR a hoy', 'de mañana', 'Un día pasado NO se lleva las de mañana', 'invalido',
    'deshechos', 'cierre_id = null', 'trg_cierres_rastro', 'no cambia',
    'Necesita 20261006100000_cierres_de_hoy_y_cambios.sql', 'SIN cambiar nada', 'Idempotente', 'REVERSA (menos de 1 minuto', 'secciones 4', 'lo aplica Yonatan: aparca', 'DESPUÉS de 20261006100000',
  ]) assert.ok(cab.includes(frase), `la cabecera no dice «${frase}»`);
});

test('requisitos antes de crear nada: se niega a correr sin 20261006100000 y sin la de deshacer cobro, y avisa que no cambió nada', () => {
  const req = SQL.slice(SQL.indexOf('-- ── 0. Requisitos'), SQL.indexOf('-- ── 4.'));
  for (const frase of ["to_regprocedure('public.cerrar_dia_de(text, date, jsonb)') is null", "to_regprocedure('public.cierre_anular(text, text)') is null",
    "to_regprocedure('public.cierre_corregir_nota(text, text)') is null", "to_regclass('public.cierres_cambios') is null", "to_regprocedure('privado.hoy_bogota()') is null",
    "column_name = 'anulado_en'", "to_regclass('public.deshechos') is null", "to_regclass('public.cierre_ordenes') is null"]) {
    assert.ok(req.includes(frase), `los requisitos no preguntan por ${frase}`);
  }
  assert.equal((req.match(/No se cambió nada\./g) || []).length, 2);
  assert.ok(req.includes('Falta 20261006100000_cierres_de_hoy_y_cambios.sql'));
});

test('cambia SOLO dos funciones: ninguna tabla, columna, policy, disparador, índice ni permiso nuevo; EXECUTE solo para `authenticated`', () => {
  const funciones = [...CP.matchAll(/create or replace function ((?:public|privado)\.\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(funciones, ['public.cerrar_dia_de', 'public.cierre_anular']);
  assert.doesNotMatch(CP, /\bcreate (table|trigger|index|unique index|policy|type|view|schema|extension)\b/);
  assert.doesNotMatch(CP, /\balter (table|publication|policy|function|default)\b/);
  assert.doesNotMatch(CP, /\bdrop \b|\btruncate\b/, 'no borra ninguna tabla ni función');
  assert.deepEqual([...CP.matchAll(/delete from (public\.\w+)/g)].map((m) => m[1]), ['public.ordenes', 'public.deltas_aplicados', 'public.cierre_ordenes'],
    'los únicos DELETE son los de siempre (lo que cerrar_dia_de archiva, los deltas huérfanos y el cierre_ordenes que anular libera): nunca cierres, deshechos ni el rastro');
  assert.doesNotMatch(CP, /grant [^;]* to (anon|public|service_role)\b/i, 'ningún GRANT a anon, public ni service_role');
  for (const [nombre, firma] of [['cerrar_dia_de', 'text, date, jsonb'], ['cierre_anular', 'text, text']]) {
    assert.match(CP, new RegExp(`revoke all on function public\\.${nombre}\\(${firma}\\) from public, anon, service_role; grant execute on function public\\.${nombre}\\(${firma}\\) to authenticated;`), `${nombre}: EXECUTE solo para authenticated`);
    const f = funcionPublica(CP, nombre);
    assert.equal(f.definer, true, `${nombre} sigue siendo SECURITY DEFINER`);
    assert.match(f.cuerpo, /^declare v_rol text := \(select public\.mi_rol\(\)\);/);
    assert.match(f.cuerpo, /begin if v_rol is distinct from 'admin' then return jsonb_build_object\('ok', false, 'codigo', 'no_autorizado'\); end if;/, `${nombre}: lo primero es negar al que no es admin`);
  }
  assert.doesNotMatch(CP, /cierres_rastro|insert into public\.cierres_cambios|cierres_anulado_congelado/, 'el rastro y el congelado no se tocan');
});

test('cerrar_dia_de es EL MISMO cuerpo que el de 20261006100000 más una sola cláusula: HOY toma también las ventas cuyo día en Bogotá es posterior a hoy', () => {
  const vieja = funcionPublica(CP_ANTERIOR, 'cerrar_dia_de');
  const nueva = funcionPublica(CP, 'cerrar_dia_de');
  assert.equal(nueva.args, vieja.args);
  const antes = "and privado.fecha_bogota(coalesce(o.cerrada_en, o.abierta_en)) = p_dia), '{}'::text[]),";
  const despues = "and (privado.fecha_bogota(coalesce(o.cerrada_en, o.abierta_en)) = p_dia or (p_dia = v_hoy and privado.fecha_bogota(coalesce(o.cerrada_en, o.abierta_en)) > v_hoy))), '{}'::text[]),";
  assert.equal(vieja.cuerpo.split(antes).length, 2, 'la cláusula vieja está una vez en la anterior');
  assert.equal(nueva.cuerpo, vieja.cuerpo.replace(antes, despues), 'todo lo demás es idéntico');
  assert.match(nueva.cuerpo, /p_dia is null or p_dia > v_hoy/, 'un día futuro sigue siendo inválido');
  assert.match(nueva.cuerpo, /if p_dia = v_hoy then select array_agg\(distinct o\.mesa_id/, 'solo hoy exige las mesas cobradas');
});

test('cierre_anular es EL MISMO cuerpo que el de 20261006100000 más soltar los deshechos del cierre (cierre_id = null) y contarlos en la respuesta', () => {
  const vieja = funcionPublica(CP_ANTERIOR, 'cierre_anular');
  const nueva = funcionPublica(CP, 'cierre_anular');
  assert.equal(nueva.args, vieja.args);
  const cambios = [
    ['v_omitidas integer := 0;', 'v_omitidas integer := 0; v_deshechos integer := 0;'],
    ['delete from public.cierre_ordenes where cierre_id = p_cierre_id;', 'delete from public.cierre_ordenes where cierre_id = p_cierre_id; update public.deshechos set cierre_id = null where cierre_id = p_cierre_id; get diagnostics v_deshechos = row_count;'],
    ["'omitidas', v_omitidas, 'total', v_total,", "'omitidas', v_omitidas, 'total', v_total, 'deshechos', v_deshechos,"],
  ];
  let esperado = vieja.cuerpo;
  for (const [antes, despues] of cambios) {
    assert.equal(esperado.split(antes).length, 2, `«${antes}» está una vez en la anterior`);
    esperado = esperado.replace(antes, despues);
  }
  assert.equal(nueva.cuerpo, esperado, 'todo lo demás es idéntico');
  assert.match(nueva.cuerpo, /update public\.deshechos set cierre_id = null where cierre_id = p_cierre_id;/, 'solo los del cierre que se anula');
  assert.doesNotMatch(nueva.cuerpo, /delete from public\.cierres\b|delete from public\.ordenes|delete from public\.deshechos|update public\.ordenes/, 'sigue sin borrar nada');
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

const GENTE = {
  admin: { sub: '00000000-0000-4000-8000-0000000000a1', email: 'admin@resplandor.test' },
  mesero: { sub: '00000000-0000-4000-8000-0000000000b1', email: 'mesero1@resplandor.test' },
};

describe('contra un Postgres 17 desechable (Supabase simulado, la cadena hasta 20261006100000 y esta encima)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  let despues;
  let HOY; let AYER; let ANTEAYER; let MANANA; let PASADO;
  let n = 0;
  const id = (p) => `${p}-${++n}`;

  const sql = (texto) => { const r = pg.sql(texto); assert.ok(r.ok, r.error); return r; };
  const filas = (select) => pg.filas(select);
  const como = (quien) => ({ como: 'authenticated', claims: { sub: GENTE[quien].sub, role: 'authenticated', email: GENTE[quien].email, app_metadata: { provider: 'google' } } });
  const api = (quien, texto) => { const r = pg.sql(texto, como(quien)); return { ...r, salida: r.salida.split('\n').at(-1) }; };
  const rpc = (quien, llamada) => {
    const r = api(quien, `select ${llamada}::text;`);
    assert.ok(r.ok, `${quien} · ${llamada}: ${r.error}`);
    return JSON.parse(r.salida.split('\n').at(-1));
  };
  const bogota = (dia, hora) => `((${literal(dia)}::date + time ${literal(hora)}) at time zone 'America/Bogota')`;
  const ESPERADO = (ventas) => JSON.stringify({ n: ventas.length, total: ventas.reduce((s, v) => s + v[2], 0), ids: ventas.map((v) => v[0]).sort() });
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
  const limpiar = () => sql('delete from public.ordenes; delete from public.cierre_ordenes; delete from public.deshechos; delete from public.cierres; update public.mesas set estado = $$libre$$;');
  const deshecho = (idOrden, mesa, monto, dia, hora) => sql(`insert into public.deshechos (orden_id, mesa_id, tipo, monto, hecho_por, hecho_en) values (${literal(idOrden)}, ${mesa}, 'parcial', ${monto}, 'mesero1@resplandor.test', ${bogota(dia, hora)});`);
  const cierreDeDeshecho = (idOrden) => filas(`select cierre_id from public.deshechos where orden_id = ${literal(idOrden)}`)[0].cierre_id;

  /** La sección de la migración anterior entre dos marcas (para correr de nuevo cómo eran las dos funciones). */
  const seccionAnterior = (desde, hasta) => {
    const i = SQL_ANTERIOR.indexOf(desde);
    const j = hasta ? SQL_ANTERIOR.indexOf(hasta, i) : SQL_ANTERIOR.length;
    assert.ok(i > 0 && j > i, `no encuentro la sección ${desde}`);
    return SQL_ANTERIOR.slice(i, j);
  };

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 16 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    assert.equal(previas.at(-1).archivo, ANTERIOR, 'la última de las previas es 20261006100000');
    antes = radiografia(pg);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, `la migración no se aplicó: ${mia[0].error}`);
    assert.deepEqual(mia[0].avisos, [], 'aplicarla no deja ni un WARNING');
    despues = radiografia(pg);
    ({ hoy: HOY, ayer: AYER, anteayer: ANTEAYER, manana: MANANA, pasado: PASADO } = filas("select privado.hoy_bogota()::text as hoy, (privado.hoy_bogota() - 1)::text as ayer, (privado.hoy_bogota() - 2)::text as anteayer, (privado.hoy_bogota() + 1)::text as manana, (privado.hoy_bogota() + 2)::text as pasado")[0]);
    sql(`
      insert into public.personal (email, nombre, rol, activo, estado) values
        ('mesero1@resplandor.test', 'Mesero Uno', 'mesero', true, 'aprobado')
      on conflict (email) do update set activo = true, rol = 'mesero', estado = 'aprobado';
      insert into public.mesas (id, capacidad, estado, token) values
        (1,4,'libre',repeat('a',48)),(2,4,'libre',repeat('b',48)),(3,4,'libre',repeat('c',48)),(4,4,'libre',repeat('d',48));
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('cambia SOLO el cuerpo de dos funciones: tablas, columnas, permisos, policies, disparadores y restricciones quedan idénticos, y las dos funciones conservan firma y permisos', () => {
    for (const seccion of ['relaciones', 'columnas', 'policies', 'publicacion', 'triggers', 'restricciones']) assert.deepEqual(despues[seccion], antes[seccion], `cambió ${seccion}`);
    const clave = (f) => `${f.nspname}.${f.proname}(${f.args})`;
    const viejas = new Map(antes.funciones.map((f) => [clave(f), f]));
    assert.equal(despues.funciones.length, antes.funciones.length, 'ninguna función nueva ni borrada');
    const distintas = [];
    for (const f of despues.funciones) {
      const v = viejas.get(clave(f));
      assert.ok(v, `función nueva: ${clave(f)}`);
      assert.equal(f.acl, v.acl, `${clave(f)}: los permisos no cambian`);
      if (f.cuerpo !== v.cuerpo) distintas.push(f.proname);
    }
    assert.deepEqual(distintas.sort(), ['cerrar_dia_de', 'cierre_anular']);
  });

  test('CERRAR HOY se lleva también la venta de MAÑANA (reloj adelantado): el admin la firma, entra en el cierre, la base la borra y queda en cierre_ordenes; lo anterior sigue por cerrar', () => {
    limpiar();
    const hoy1 = venta(id('h'), 1, 30000, HOY, '09:00');
    const futura = venta(id('f'), 2, 9000, MANANA, '00:05');
    const muyFutura = venta(id('f'), 3, 4000, PASADO, '10:00');
    const ayer1 = venta(id('a'), 4, 12000, AYER, '12:00');
    const { cid, r } = cierraDe(HOY, [hoy1, futura, muyFutura]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.n, 3);
    assert.equal(r.total, 43000);
    assert.equal(r.borradas, 3);
    assert.equal(r.dia, HOY);
    assert.deepEqual(ordenes(), [`${ayer1[0]}:cerrada`], 'solo ayer sigue por cerrar');
    const c = cierre(cid);
    assert.equal(c.total_ventas, 43000);
    assert.equal(c.total_ordenes, 3);
    assert.deepEqual(c.transacciones.map((t) => t.id).sort(), [hoy1[0], futura[0], muyFutura[0]].sort());
    assert.ok(Math.abs(Date.now() - Date.parse(c.fecha)) < 120000, 'hoy: la fecha del cierre es la de ahora');
    assert.deepEqual(filas(`select orden_id from public.cierre_ordenes where cierre_id = ${literal(cid)} order by 1`).map((x) => x.orden_id), [hoy1[0], futura[0], muyFutura[0]].sort());
    const rs = rastro(cid);
    assert.deepEqual(rs.map((q) => q.accion), ['cierre']);
    assert.equal(rs[0].despues.n, 3);
  });

  test('la venta de mañana SOLA se cierra con hoy; sin ella en lo que el admin firmó, la base dice `cambio` con SU resumen (que la incluye) y no cambia nada', () => {
    limpiar();
    const futura = venta(id('f'), 1, 9000, MANANA, '00:05');
    const hoy1 = venta(id('h'), 2, 30000, HOY, '09:00');
    const antesOrdenes = ordenes();
    // el POS de antes (que no la contaba) firma solo lo de hoy
    const viejo = cierraDe(HOY, [hoy1]);
    assert.equal(viejo.r.ok, false);
    assert.equal(viejo.r.codigo, 'cambio');
    assert.equal(viejo.r.resumen.n, 2);
    assert.equal(viejo.r.resumen.total, 39000);
    assert.deepEqual(viejo.r.resumen.ids, [futura[0], hoy1[0]].sort());
    assert.deepEqual(ordenes(), antesOrdenes, 'no cambió nada');
    assert.equal(cierre(viejo.cid), undefined);
    // firmando lo de la base, cierra
    const bien = cierraDe(HOY, [futura, hoy1]);
    assert.equal(bien.r.ok, true, JSON.stringify(bien.r));
    assert.equal(bien.r.total, 39000);
    // y la de mañana sola
    limpiar();
    const sola = venta(id('f'), 1, 9000, MANANA, '00:05');
    const r = cierraDe(HOY, [sola]);
    assert.equal(r.r.ok, true, JSON.stringify(r.r));
    assert.equal(r.r.n, 1);
    assert.deepEqual(ordenes(), []);
  });

  test('un día PASADO no se lleva las de mañana (ni las de hoy): cerrar ayer cierra solo ayer; y firmarla con ayer da `cambio`', () => {
    limpiar();
    const ayer1 = venta(id('a'), 1, 12000, AYER, '12:00');
    const hoy1 = venta(id('h'), 2, 30000, HOY, '09:00');
    const futura = venta(id('f'), 3, 9000, MANANA, '00:05');
    const equivocado = cierraDe(AYER, [ayer1, futura]);
    assert.equal(equivocado.r.codigo, 'cambio');
    assert.deepEqual(equivocado.r.resumen.ids, [ayer1[0]], 'la base de ayer solo ve la de ayer');
    const { cid, r } = cierraDe(AYER, [ayer1]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.n, 1);
    assert.equal(cierre(cid).fecha_bogota, `${AYER} 23:59:59`);
    assert.deepEqual(ordenes(), [`${futura[0]}:cerrada`, `${hoy1[0]}:cerrada`].sort(), 'la de hoy y la de mañana siguen por cerrar');
  });

  test('lo de siempre sigue igual: un día futuro es inválido, el mesero no cierra, hay_abiertas solo frena HOY, el mismo id devuelve el cierre ya guardado y la de las 23:30 de ayer es de ayer', () => {
    limpiar();
    const hoy1 = venta(id('h'), 1, 10000, HOY, '09:00');
    const ayerTarde = venta(id('a'), 2, 30000, AYER, '23:30');
    // día futuro: inválido, y el mesero no cierra
    assert.equal(cierraDe(MANANA, [hoy1]).r.codigo, 'invalido');
    assert.equal(cierraDe(HOY, [hoy1], 'mesero').r.codigo, 'no_autorizado');
    assert.deepEqual(ordenes(), [`${ayerTarde[0]}:cerrada`, `${hoy1[0]}:cerrada`].sort());
    // una cuenta abierta frena HOY (aunque haya una venta de mañana) y no frena a ayer
    sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('abierta-1', 3, 'abierta', '[]', 0, now());`);
    const futura = venta(id('f'), 4, 9000, MANANA, '00:05');
    const frenado = cierraDe(HOY, [hoy1, futura]);
    assert.equal(frenado.r.codigo, 'hay_abiertas');
    assert.deepEqual(frenado.r.abiertas, [3]);
    const ayer = cierraDe(AYER, [ayerTarde]);
    assert.equal(ayer.r.ok, true, JSON.stringify(ayer.r));
    // sin la cuenta abierta, hoy cierra (con la de mañana) y el mismo id otra vez devuelve ese cierre
    sql("delete from public.ordenes where id = 'abierta-1';");
    const hoy = cierraDe(HOY, [hoy1, futura]);
    assert.equal(hoy.r.ok, true, JSON.stringify(hoy.r));
    const otra = cierraDe(HOY, [hoy1, futura], 'admin', hoy.cid);
    assert.equal(otra.r.repetido, true);
    assert.equal(otra.r.n, 2);
    assert.equal(filas('select count(*)::int as n from public.cierres')[0].n, 2, 'no duplicó el cierre');
    assert.equal(rastro(hoy.cid).length, 1, 'ni el rastro');
  });

  test('una venta de mañana que ya está archivada en un cierre (un rezago) no se cuenta otra vez: se borra sin contar, como cualquier rezago', () => {
    limpiar();
    const futura = venta(id('f'), 1, 9000, MANANA, '00:05');
    sql(`insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('c-viejo', now() - interval '2 days', 9000, 1,
         ${literal(JSON.stringify([{ id: futura[0], mesaId: 1, total: 9000, items: [], estado: 'cerrada' }]))}::jsonb);`);
    assert.equal(filas(`select count(*)::int as n from public.cierre_ordenes where orden_id = ${literal(futura[0])}`)[0].n, 1, 'el cierre viejo la archivó');
    const hoy1 = venta(id('h'), 2, 30000, HOY, '09:00');
    const { r } = cierraDe(HOY, [hoy1]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.n, 1);
    assert.equal(r.total, 30000);
    assert.equal(r.borradas, 2, 'el rezago se borró sin contarlo');
    assert.deepEqual(ordenes(), []);
  });

  test('ANULAR suelta los deshechos del cierre (cierre_id = null): al cerrar ese día otra vez pasan al cierre nuevo; los de otros cierres no se tocan y el rastro anota lo mismo de siempre', () => {
    limpiar();
    // un cierre de anteayer con su deshecho: no se debe tocar (y dentro de los 90 días que guarda `deshechos`)
    const viejo = venta(id('v'), 3, 5000, ANTEAYER, '12:00');
    deshecho('d-viejo', 3, 1500, ANTEAYER, '15:00');
    const cv = cierraDe(ANTEAYER, [viejo]);
    assert.equal(cv.r.ok, true, JSON.stringify(cv.r));
    assert.equal(cierreDeDeshecho('d-viejo'), cv.cid);
    // ayer: dos ventas y dos cobros deshechos
    const a = venta(id('a'), 1, 10000, AYER, '10:00');
    const b = venta(id('a'), 2, 20000, AYER, '11:00');
    deshecho('d1', 1, 4000, AYER, '16:00');
    deshecho('d2', 2, 2500, AYER, '18:00');
    const { cid, r } = cierraDe(AYER, [a, b]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.deshechos.length, 2);
    assert.equal(cierreDeDeshecho('d1'), cid);
    assert.equal(cierreDeDeshecho('d2'), cid);
    // el mesero no anula (y no suelta nada)
    assert.equal(rpc('mesero', `public.cierre_anular(${literal(cid)}, 'no me toca')`).codigo, 'no_autorizado');
    assert.equal(cierreDeDeshecho('d1'), cid);
    // se anula
    const x = rpc('admin', `public.cierre_anular(${literal(cid)}, 'Cerré el día con la fecha mal')`);
    assert.equal(x.ok, true, JSON.stringify(x));
    assert.equal(x.liberadas, 2);
    assert.equal(x.total, 30000);
    assert.equal(x.deshechos, 2, 'cuenta los deshechos que soltó');
    assert.equal(cierreDeDeshecho('d1'), null, 'el cobro deshecho de ayer ya no cuelga del cierre anulado');
    assert.equal(cierreDeDeshecho('d2'), null);
    assert.equal(cierreDeDeshecho('d-viejo'), cv.cid, 'el de otro cierre sigue donde estaba');
    // el rastro anota lo mismo de siempre: cierre y anulado, con su motivo, quién y cuándo
    const rs = rastro(cid);
    assert.deepEqual(rs.map((q) => q.accion), ['cierre', 'anulado']);
    assert.equal(rs[1].motivo, 'Cerré el día con la fecha mal');
    assert.equal(rs[1].quien, 'admin@resplandor.test');
    assert.equal(rs[1].antes.anulado_en, null);
    assert.ok(rs[1].despues.anulado_en);
    assert.deepEqual(Object.keys(rs[1].detalle).sort(), [], 'el detalle sigue igual (anular no agrega ni saca ventas)');
    // anular otra vez no suelta nada más ni cambia nada
    assert.equal(rpc('admin', `public.cierre_anular(${literal(cid)}, 'otra vez')`).codigo, 'ya_anulado');
    // cerrar ayer otra vez: los deshechos pasan al cierre NUEVO (antes se quedaban en el anulado)
    const otra = cierraDe(AYER, [a, b]);
    assert.equal(otra.r.ok, true, JSON.stringify(otra.r));
    assert.deepEqual(otra.r.deshechos.map((d) => d.orden_id).sort(), ['d1', 'd2']);
    assert.equal(cierreDeDeshecho('d1'), otra.cid);
    assert.equal(cierreDeDeshecho('d2'), otra.cid);
    assert.equal(cierreDeDeshecho('d-viejo'), cv.cid);
    assert.equal(filas('select count(*)::int as n from public.cierres where anulado_en is null')[0].n, 2, 'un cierre vigente de ayer y el viejo');
  });

  test('anular un cierre sin deshechos devuelve deshechos = 0; los deshechos de HOY que aún no cuelgan de ningún cierre no se tocan', () => {
    limpiar();
    const a = venta(id('a'), 1, 10000, AYER, '10:00');
    deshecho('d-hoy', 1, 3000, HOY, '10:00');
    const { cid, r } = cierraDe(AYER, [a]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.deshechos.length, 0, 'el deshecho de hoy no es de ayer');
    assert.equal(cierreDeDeshecho('d-hoy'), null);
    const x = rpc('admin', `public.cierre_anular(${literal(cid)}, 'por error')`);
    assert.equal(x.ok, true, JSON.stringify(x));
    assert.equal(x.deshechos, 0);
    assert.equal(cierreDeDeshecho('d-hoy'), null);
  });

  test('los deshechos que ANULAR suelta los toma el PRÓXIMO cierre que se haga, no «el siguiente de ese día»: si se cierra HOY antes de rehacer AYER, se los lleva el de hoy y el de ayer rehecho sale sin ellos; un cierre de un día ANTERIOR al que se deshicieron no los toma (refutación 2, D1; decisión de Yonatan si prefiere deshechos por día)', () => {
    limpiar();
    const a = venta(id('a'), 1, 10000, AYER, '10:00');
    const b = venta(id('a'), 2, 20000, AYER, '11:00');
    deshecho('d1', 1, 4000, AYER, '16:00');
    deshecho('d2', 2, 2500, AYER, '18:00');
    const c1 = cierraDe(AYER, [a, b]);
    assert.equal(c1.r.ok, true, JSON.stringify(c1.r));
    const x = rpc('admin', `public.cierre_anular(${literal(c1.cid)}, 'Cerré el día con la fecha mal')`);
    assert.equal(x.ok, true, JSON.stringify(x));
    assert.equal(x.deshechos, 2);
    assert.equal(cierreDeDeshecho('d1'), null);
    // un cierre de un día ANTERIOR al que se deshicieron (`fecha_bogota(hecho_en) <= p_dia`) no los toma
    const v = venta(id('v'), 3, 5000, ANTEAYER, '12:00');
    const cv = cierraDe(ANTEAYER, [v]);
    assert.equal(cv.r.ok, true, JSON.stringify(cv.r));
    assert.deepEqual(cv.r.deshechos, []);
    assert.equal(cierreDeDeshecho('d1'), null);
    // el admin cierra HOY primero (lo normal al final del turno): se los lleva el cierre de HOY
    const h = venta(id('h'), 4, 30000, HOY, '20:00');
    const c2 = cierraDe(HOY, [h]);
    assert.equal(c2.r.ok, true, JSON.stringify(c2.r));
    assert.deepEqual(c2.r.deshechos.map((d) => d.orden_id).sort(), ['d1', 'd2'], 'los deshechos de AYER quedan en el cierre de HOY');
    assert.equal(cierreDeDeshecho('d1'), c2.cid);
    assert.equal(cierreDeDeshecho('d2'), c2.cid);
    // y al rehacer AYER, su cierre sale sin ellos
    const c3 = cierraDe(AYER, [a, b]);
    assert.equal(c3.r.ok, true, JSON.stringify(c3.r));
    assert.deepEqual(c3.r.deshechos, [], 'el cierre rehecho de ayer no tiene los deshechos de ayer');
    assert.equal(cierreDeDeshecho('d1'), c2.cid);
  });

  test('lo que ya era de la anterior sigue: el upsert IDÉNTICO del POS a un cierre anulado se rechaza (RS006) y las ventas liberadas no vuelven a archivarse', () => {
    limpiar();
    const a = venta(id('u'), 1, 10000, AYER, '10:00');
    const b = venta(id('u'), 2, 20000, AYER, '11:00');
    const { cid, r } = cierraDe(AYER, [a, b]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(rpc('admin', `public.cierre_anular(${literal(cid)}, 'lo cerré con la fecha mal')`).ok, true);
    const k = cierre(cid);
    const up = api('admin', `\\set VERBOSITY verbose
      insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones)
      values (${literal(k.id)}, ${literal(k.fecha)}::timestamptz, ${k.total_ventas}, ${k.total_ordenes}, ${literal(JSON.stringify(k.transacciones))}::jsonb)
      on conflict (id) do update set id = excluded.id, fecha = excluded.fecha, total_ventas = excluded.total_ventas, total_ordenes = excluded.total_ordenes, transacciones = excluded.transacciones;`);
    assert.equal(up.ok, false);
    assert.match(up.error, /RS006/);
    assert.equal(filas(`select count(*)::int as n from public.cierre_ordenes where cierre_id = ${literal(cid)}`)[0].n, 0);
  });

  test('aplicarla dos veces es inocua: el catálogo queda idéntico, sin WARNING, y los datos (cierres, rastro, ventas, deshechos) no cambian', () => {
    const datos = () => JSON.stringify([filas('select * from public.cierres order by id'), filas('select * from public.cierres_cambios order by id'), filas('select * from public.ordenes order by id'), filas('select * from public.deshechos order by id')]);
    const antesDatos = datos();
    const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(otra.length, 1);
    assert.ok(otra[0].ok, otra[0].error);
    assert.deepEqual(otra[0].avisos, [], 'la segunda aplicación no deja WARNING');
    assert.deepEqual(radiografia(pg), despues, 'el catálogo no cambió');
    assert.equal(datos(), antesDatos);
  });

  test('la reversa de la cabecera (volver a correr las secciones 4 y 6 de la anterior) corre en limpio y deja el catálogo como antes; reaplicar esta lo deja como después', () => {
    const rev = `${seccionAnterior('-- ── 4. cerrar_dia_de', '-- ── 5. cierre_corregir_nota')}\n${seccionAnterior('-- ── 6. cierre_anular')}`;
    const r = pg.sql(rev, { como: 'migrador' });
    assert.ok(r.ok, 'la reversa falló: ' + r.error);
    assert.deepEqual(r.avisos, []);
    const ahora = radiografia(pg);
    for (const [seccion, lista] of Object.entries(antes)) assert.deepEqual(ahora[seccion], lista, `tras la reversa quedó distinto: ${seccion}`);
    // con las funciones de antes, la venta de mañana vuelve a quedar fuera de hoy (lo que arregla esta migración)
    limpiar();
    const futura = venta(id('f'), 1, 9000, MANANA, '00:05');
    const hoy1 = venta(id('h'), 2, 30000, HOY, '09:00');
    const viejo = cierraDe(HOY, [hoy1]);
    assert.equal(viejo.r.ok, true, 'antes: el cierre de hoy no la contaba');
    assert.deepEqual(ordenes(), [`${futura[0]}:cerrada`], 'y la dejaba por cerrar, invisible');
    limpiar();
    const reaplicada = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.ok(reaplicada[0].ok, 'no se pudo volver a aplicar tras la reversa: ' + reaplicada[0].error);
    assert.deepEqual(reaplicada[0].avisos, []);
    assert.deepEqual(radiografia(pg), despues, 'reaplicar tras la reversa deja el catálogo como la primera vez');
  });
});

describe('se niega a correr, sin cambiar nada, si falta 20261006100000 (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('sin 20261006100000: error claro y NADA creado ni cambiado; con la anterior, se aplica sin avisos', () => {
    const aplicarMia = () => pg.sql(SQL, { como: 'migrador' });
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: ANTERIOR });
    assert.ok(previas.length >= 15 && previas.every((m) => m.ok), JSON.stringify(previas.filter((m) => !m.ok)));
    const a0 = radiografia(pg);
    const sin = aplicarMia();
    assert.equal(sin.ok, false);
    assert.match(sin.error, /Falta 20261006100000_cierres_de_hoy_y_cambios\.sql.*No se cambió nada/s);
    assert.deepEqual(radiografia(pg), a0, 'sin la anterior: no dejó nada creado ni cambiado');
    const anterior = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: ANTERIOR, hasta: ANTERIOR });
    assert.ok(anterior[0].ok, anterior[0].error);
    const bien = aplicarMia();
    assert.ok(bien.ok, bien.error);
    assert.deepEqual(bien.avisos, []);
  });
});
