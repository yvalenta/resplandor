// supabase/migrations/20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql
// La mezcla de tarea/promo-regla-ejecutable con main (2026-10-06): `privado.normalizar_items` la redefinen TRES migraciones, cada una escrita sobre la de 20261005100000 sin saber de las otras
//   · 20261005130000 (el cobro por partes) pliega una línea de promo que llega SIN su objeto `promo`;
//   · 20261006110000 y 20261006130000 (el precio a mano, de main) respetan `precio_manual` y lo recuerdan en la línea de promo.
// `create or replace` deja ganar a la última que se pega: sin esta unión, el orden de pegado decidía qué se perdía (el pliegue, o el precio a mano en silencio).
//
// Dos partes:
//   1. ESTÁTICA (corre siempre, también en CI): va ÚLTIMA; el cuerpo es el de 20261006130000 con SOLO los tres cambios del pliegue, y es el de 20261005130000 con SOLO lo del precio a mano;
//      se niega a correr si falta lo previo; no toca nada más.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker): (a) la cadena completa en el orden de los archivos: lo que hace de verdad (pliegue, precio a mano, el cobro por partes de una
//      línea a mano) y que es inocua repetida; (b) el ORDEN DE PEGADO en producción (las de main antes del sobre, o el sobre antes de las de main): con esta migración al final,
//      las dos terminan con LA MISMA función, byte a byte.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, fijarDiaPromo } from './_cola-impresion-pg.mjs';

const MIGRACION = '20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql';
const LAPIDA = '20261006150000_lapida_de_cuentas_borradas.sql';   // la que sigue a la unión: no toca normalizar_items
const PLIEGUE = '20261005130000_promo_cobro_por_partes.sql';
const COBRAR = '20261005140000_cobrar_parcial.sql';
const PRECIO_A_MANO = ['20261006110000_precio_a_mano.sql', '20261006120000_cierres_ajustes.sql', '20261006130000_precio_a_mano_promo_entera.sql'];
const ULTIMA_DE_MAIN = '20261006130000_precio_a_mano_promo_entera.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${MIGRACION}`);
const SQL_PLIEGUE = leer(`supabase/migrations/${PLIEGUE}`);
const SQL_MAIN = leer(`supabase/migrations/${ULTIMA_DE_MAIN}`);
const SQL_PRECIO_VIVO = leer('supabase/migrations/20261005100000_precio_vivo_y_promos.sql');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CODIGO = sinComentarios(SQL);
const CP = compacto(CODIGO);

/** Las líneas (sin comentarios ni espacios) de `create or replace function privado.normalizar_items … end $$;` de una migración. */
function normalizarDe(sql) {
  const c = sinComentarios(sql);
  const a = c.indexOf('create or replace function privado.normalizar_items');
  const b = c.indexOf('end $$;', a) + 'end $$;'.length;
  assert.ok(a >= 0 && b > a, 'no encuentro privado.normalizar_items');
  return c.slice(a, b).split('\n').map((l) => l.trim()).filter(Boolean);
}
/** Lo que quitó y lo que agregó `nuevo` respecto a `viejo` (líneas sueltas, sin importar el orden). */
function diferencia(viejo, nuevo) {
  const resto = [...viejo];
  const agregadas = [];
  for (const l of nuevo) { const i = resto.indexOf(l); if (i >= 0) resto.splice(i, 1); else agregadas.push(l); }
  return { quitadas: resto, agregadas };
}

// ───────────────────────── 1. estática ─────────────────────────

test('va ÚLTIMA de las que redefinen normalizar_items (la lápida, que no la toca, va después), con prefijo único, después de la guardia del cobro por partes, el cobro atómico y las dos de main', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.deepEqual(nombres.slice(-2), [MIGRACION, LAPIDA], 'la unión es la penúltima de la cadena: solo le sigue la lápida de las cuentas borradas');
  assert.doesNotMatch(compacto(sinComentarios(leer(`supabase/migrations/${LAPIDA}`))), /normalizar_items/, 'y la lápida no toca normalizar_items');
  for (const previa of [PLIEGUE, COBRAR, ...PRECIO_A_MANO]) assert.ok(nombres.includes(previa) && previa < MIGRACION, `${previa} tiene que ir antes`);
});

test('la cabecera dice por qué existe, qué hace, qué no hace, que va ÚLTIMA, su reversa y que la aplica Yonatan', () => {
  const cab = SQL.slice(0, SQL.indexOf('do $$'));
  for (const frase of [
    'POR QUÉ EXISTE', 'QUÉ HACE', 'QUÉ NO HACE', 'REVERSA', 'lo aplica Yonatan: aparca', 'Pegarla repetida no cambia nada', 'Va ÚLTIMA de las que redefinen',
    '20261005130000', '20261006110000', '20261006130000', 'precio_manual', 'pliega', 'promo:<promo>:<base>', 'se niega a\n-- correr SIN cambiar nada'.replace('\n-- ', ' '),
    'quien la pega por último', 'se perdía el pliegue', 'se perdía el precio a mano',
  ]) assert.ok(compacto(cab.replace(/^--\s?/gm, '')).includes(compacto(frase)), `la cabecera no dice «${frase}»`);
});

test('se niega a correr, sin cambiar nada, si falta privado.normalizar_items, y lo comprueba ANTES de crear nada', () => {
  const requisitos = CODIGO.slice(0, CODIGO.indexOf('create or replace function'));
  assert.match(requisitos, /to_regprocedure\('privado\.normalizar_items\(jsonb,smallint\)'\) is null[\s\S]*Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bgrant\b|\binsert\b|\bupdate\b/i);
});

test('el cuerpo es el de 20261006130000 (la última de main) con SOLO los tres cambios del pliegue de 20261005130000', () => {
  const main = normalizarDe(SQL_MAIN);
  const esta = normalizarDe(SQL);
  const { quitadas, agregadas } = diferencia(main, esta);
  assert.deepEqual(quitadas, [
    "if (v_item ->> 'id') like 'promo:%' and jsonb_typeof(v_item -> 'promo') = 'object' then continue; end if;",
    "if not ((v_item ->> 'id') like 'promo:%' and jsonb_typeof(v_item -> 'promo') = 'object') then continue; end if;",
    "v_de := v_item -> 'promo' ->> 'de';",
    "'nombre', coalesce(v_item -> 'promo' ->> 'nombre', v_item ->> 'nombre'),",
    "'precio', coalesce(nullif(v_item -> 'promo' ->> 'precio', '')::numeric, nullif(v_item ->> 'precio', '')::numeric, 0),",
  ], 'qué dejó de estar');
  assert.deepEqual(agregadas, [
    "v_de := case when jsonb_typeof(v_item -> 'promo') = 'object' then v_item -> 'promo' ->> 'de'",
    "else substring(coalesce(v_item ->> 'id', '') from '^promo:[^:]*:(.+)$') end;",
    "if (v_item ->> 'id') like 'promo:%' and (jsonb_typeof(v_item -> 'promo') = 'object' or v_de is not null) then continue; end if;",
    "v_de := case when jsonb_typeof(v_item -> 'promo') = 'object' then v_item -> 'promo' ->> 'de'",
    "else substring(coalesce(v_item ->> 'id', '') from '^promo:[^:]*:(.+)$') end;",
    "if not ((v_item ->> 'id') like 'promo:%' and (jsonb_typeof(v_item -> 'promo') = 'object' or v_de is not null)) then continue; end if;",
    "'nombre', coalesce(v_item -> 'promo' ->> 'nombre',",
    "(select p.nombre from public.productos p where p.id = split_part(v_de, '__', 1)),",
    "v_item ->> 'nombre'),",
    "'precio', coalesce(nullif(v_item -> 'promo' ->> 'precio', '')::numeric,",
    "(select p.precio from public.productos p where p.id = split_part(v_de, '__', 1)),",
    "nullif(v_item ->> 'precio', '')::numeric, 0),",
  ], 'qué se agregó');
});

test('y es el de 20261005130000 (el pliegue) con SOLO lo del precio a mano: la marca en la promo, en la base que vuelve y el respeto en el paso b', () => {
  const pliegue = normalizarDe(SQL_PLIEGUE);
  const esta = normalizarDe(SQL);
  const { quitadas, agregadas } = diferencia(pliegue, esta);
  // lo que 20261005130000 tenía y esta ya no: solo el cierre de la línea de la salida y de la línea de la promo que ahora llevan la marca (se reescribieron para agregarla)
  assert.ok(quitadas.every((l) => /jsonb_build_object\(|'nota', coalesce\(v_item ->> 'nota', ''\)\);$|'precio', coalesce\(nullif\(v_base ->> 'precio', ''\)::numeric, 0\), 'descuento', v_desc\)\);$/.test(l)), `quitó otra cosa: ${quitadas.join(' | ')}`);
  const todas = agregadas.join('\n');
  assert.match(todas, /if v_item ->> 'precio_manual' = 'true' then continue; end if;/, 'el paso b no refresca una línea a mano');
  assert.match(todas, /v_lineas\[v_i\] ->> 'precio_manual' is distinct from 'true'/, 'la base que vuelve sin marca adopta la de su línea de promo');
  assert.match(todas, /jsonb_strip_nulls\(jsonb_build_object\('precio_manual', true, 'precio_por', v_item -> 'promo' ->> 'precio_por'\)\)/);
  assert.match(todas, /jsonb_strip_nulls\(jsonb_build_object\('precio_manual', true, 'precio_por', v_base ->> 'precio_por'\)\)/, 'la línea de promo recuerda la marca de su base');
  // y NO hay nada nuevo fuera del precio a mano
  assert.doesNotMatch(compacto(todas), /public\.productos|substring\(/, 'el pliegue ya estaba en 20261005130000');
});

test('el pliegue de 20261005100000 NO se tocó: sigue plegando solo las líneas de promo CON objeto (la migración nueva es otra, no una edición)', () => {
  const cp = compacto(sinComentarios(SQL_PRECIO_VIVO));
  assert.ok(cp.includes("if (v_item ->> 'id') like 'promo:%' and jsonb_typeof(v_item -> 'promo') = 'object' then continue; end if;"));
  assert.doesNotMatch(cp, /substring\(coalesce\(v_item/);
  assert.doesNotMatch(compacto(sinComentarios(SQL_MAIN)), /substring\(coalesce\(v_item/, 'y las de main no conocen el pliegue: por eso esta unión');
});

test('mantiene la firma, los atributos y los permisos: stable, search_path vacío, sin EXECUTE para la API; no toca datos ni tablas ni triggers ni policies', () => {
  assert.match(CP, /create or replace function privado\.normalizar_items\(p_items jsonb, p_dia smallint\) returns jsonb language plpgsql stable set search_path = '' as \$\$/);
  assert.match(CP, /revoke all on function privado\.normalizar_items\(jsonb, smallint\) from public, anon, authenticated;/);
  assert.doesNotMatch(CP, /\bgrant\b/);
  const sinCuerpos = CP.replace(/\$\$.*?\$\$/g, ' ');
  assert.doesNotMatch(sinCuerpos, /\b(create table|alter table|create trigger|drop trigger|create policy|drop policy|insert into|delete from|update \S+ set)\b/i);
  assert.doesNotMatch(SQL, /[A-Za-z0-9._%+-]+@(?!zz)[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ni un correo (el repo es público)');
});

// ───────────────────────── 2. contra Postgres ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

/** Aplica estos archivos, en este orden, como migrador. */
function aplicar(pg, nombres) {
  const hechas = [];
  for (const f of nombres) {
    const r = pg.sql("set resplandor.admins_iniciales = 'admin@resplandor.test';\n" + fs.readFileSync(path.join(DIR_MIGRACIONES, f), 'utf8'), { como: 'migrador' });
    hechas.push({ archivo: f, ok: r.ok, error: r.error, avisos: r.avisos });
    if (!r.ok) break;
  }
  return hechas;
}
const TODAS = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
const cuerpoNormalizar = (pg) => pg.filas("select md5(p.prosrc) as m from pg_proc p where p.oid = to_regprocedure('privado.normalizar_items(jsonb,smallint)')")[0].m;
const PLIEGUE_SIN_OBJETO = '[{"id":"zz-x","nombre":"X","precio":1000,"qty":1,"nota":""},{"id":"promo:zz-p:zz-x","nombre":"X · promo","precio":800,"qty":2,"nota":""}]';
const tienePliegue = (pg) => pg.filas(`select privado.normalizar_items(${literal(PLIEGUE_SIN_OBJETO)}::jsonb, 1::smallint) = '[{"id":"zz-x","nombre":"X","precio":1000,"qty":3,"nota":""}]'::jsonb as ok`)[0].ok;
const respetaPrecioAMano = (pg) => pg.filas(`select (privado.normalizar_items('[{"id":"zz-m","nombre":"M","precio":500,"qty":1,"nota":"","precio_manual":true}]'::jsonb, null)) = '[{"id":"zz-m","nombre":"M","precio":500,"qty":1,"nota":"","precio_manual":true}]'::jsonb as ok`)[0].ok;
// Un producto de verdad en `productos`: sin él `normalizar_items` no tiene nada que refrescar y «respeta el precio a mano» sería trivial.
const conProducto = (pg) => {
  const r = pg.sql("insert into public.productos (id, categoria, nombre, precio, activo) values ('zu-prod', 'Bebidas', 'Prueba', 1000, true) on conflict (id) do nothing;");
  assert.ok(r.ok, r.error);
};
const respetaConProducto = (pg) => pg.filas(`select
  (privado.normalizar_items('[{"id":"zu-prod","nombre":"P","precio":1500,"qty":1,"nota":"","precio_manual":true}]'::jsonb, null) -> 0 ->> 'precio')::numeric = 1500
  and (privado.normalizar_items('[{"id":"zu-prod","nombre":"P","precio":1500,"qty":1,"nota":""}]'::jsonb, null) -> 0 ->> 'precio')::numeric = 1000 as ok`)[0].ok;

describe('la cadena completa en el orden de los archivos: la unión hace lo suyo y es inocua repetida', { skip: MOTIVO }, () => {
  let pg;
  let DIA = 3;
  const sql = (texto, opciones) => { const r = pg.sql(`set resplandor.dia_promo = ${DIA};\n` + texto, opciones); assert.ok(r.ok, r.error); return r; };
  const ultimoJson = (salida) => JSON.parse(String(salida).trim().split('\n').pop());
  const claims = (clave) => {
    const g = pg.filas(`select id, email, provider from t.gente where clave = ${literal(clave)}`)[0];
    return { sub: g.id, role: 'authenticated', email: g.email, app_metadata: { provider: g.provider } };
  };
  const como = (clave) => ({ como: 'authenticated', claims: claims(clave) });
  const orden = (id) => pg.filas(`select items, total, version, estado from public.ordenes where id = ${literal(id)}`)[0];
  const linea = (o, id) => o.items.find((i) => i.id === id);
  const llamar = (clave, consulta) => {
    const r = pg.sql(`set resplandor.dia_promo = ${DIA};\nselect coalesce(json_agg(to_jsonb(t)), '[]'::json) from (${consulta}) t`, como(clave));
    return { ok: r.ok, filas: r.ok ? ultimoJson(r.salida) : null, error: r.error };
  };
  const delta = (id, producto, nombre, precio, n) => {
    const r = llamar('mesero', `select items, total, version from public.aplicar_delta_orden(${literal(id)}, ${literal(producto)}, ${literal(nombre)}, ${precio}, ${n}, '')`);
    assert.ok(r.ok, r.error);
    return r.filas[0];
  };
  const abrir = (id, mesa) => sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', '[]', 0, now());`);
  let antes;

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 20 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    antes = radiografia(pg);
    fijarDiaPromo(pg, 3);
    sql(`
      insert into public.personal (email, nombre, rol) values ('mesero1@resplandor.test', 'Mesero Prueba', 'mesero') on conflict (email) do nothing;
      insert into public.productos (id, categoria, nombre, precio, activo) values ('zu-be1','Bebidas','Cerveza',10000,true), ('zu-be2','Bebidas','Jugo',9000,true);
      insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'e') from generate_series(81, 90) g;
    `);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('antes de la unión (la cadena de los archivos hasta 20261006130000) la función es la de main: respeta el precio a mano y NO tiene el pliegue', () => {
    assert.equal(tienePliegue(pg), false, 'main no pliega la promo sin objeto');
    assert.equal(respetaPrecioAMano(pg), true);
  });

  test('se aplica como migrador, sin WARNING, y cambia SOLO el cuerpo de normalizar_items (ninguna tabla, policy, trigger, restricción ni permiso)', () => {
    const r = aplicar(pg, [MIGRACION])[0];
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    const despues = radiografia(pg);
    for (const seccion of Object.keys(antes)) {
      if (seccion === 'funciones') continue;
      assert.deepEqual(despues[seccion], antes[seccion], `${seccion}: cambió`);
    }
    const clave = (f) => JSON.stringify(f);
    const cambiadas = [...despues.funciones.filter((f) => !antes.funciones.some((a) => clave(a) === clave(f))), ...antes.funciones.filter((f) => !despues.funciones.some((a) => clave(a) === clave(f)))];
    assert.deepEqual([...new Set(cambiadas.map((f) => `${f.nspname}.${f.proname}`))], ['privado.normalizar_items'], 'solo cambió normalizar_items');
    const nueva = despues.funciones.find((f) => f.proname === 'normalizar_items');
    const vieja = antes.funciones.find((f) => f.proname === 'normalizar_items');
    assert.equal(nueva.acl, vieja.acl, 'el permiso es el mismo');
    assert.doesNotMatch(nueva.acl || '', /anon|authenticated/, 'sin EXECUTE para la API');
    assert.notEqual(nueva.cuerpo, vieja.cuerpo);
  });

  test('ahora SÍ pliega la promo sin objeto y SIGUE respetando el precio a mano (también con un producto de verdad en la carta)', () => {
    assert.equal(tienePliegue(pg), true);
    assert.equal(respetaPrecioAMano(pg), true);
    conProducto(pg);
    assert.equal(respetaConProducto(pg), true, 'la línea a mano conserva su precio y la que no lo es toma el de la carta');
  });

  test('es inocua repetida: el catálogo queda idéntico y sin WARNING', () => {
    const antesDeRepetir = radiografia(pg);
    const r = aplicar(pg, [MIGRACION])[0];
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(radiografia(pg), antesDeRepetir);
  });

  test('con las dos cosas a la vez: una cuenta con una línea a mano, a la que un POS de antes le devuelve una línea de promo SIN objeto, queda como estaba y conserva el precio a mano', () => {
    DIA = 1;
    sql("insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values ('zu-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1,'{\"cada\":3,\"descuento\":20,\"aplica\":{\"productos\":[\"zu-seco\"]}}') on conflict (id) do nothing;");
    sql("insert into public.productos (id, categoria, nombre, precio, activo) values ('zu-seco','Ejecutivos','Seco',19000,true) on conflict (id) do nothing;");
    abrir('zu-o1', 81);
    delta('zu-o1', 'zu-seco', 'Seco', 19000, 3);
    const fijada = llamar('mesero', "select items, total, version from public.fijar_precio_item('zu-o1', 'zu-seco', 17000)");
    assert.ok(fijada.ok, fijada.error);
    let o = orden('zu-o1');
    assert.equal(linea(o, 'zu-seco').precio_manual, true);
    const antesTotal = Number(o.total);
    // el POS de antes: −1 de la línea de promo y +1 de la misma, SIN el objeto `promo` (aplicar_delta_orden no lo lleva)
    const promoId = o.items.find((i) => String(i.id).startsWith('promo:'))?.id;
    assert.ok(promoId, `la cuenta de 3 Seco del lunes trae su línea de promo: ${JSON.stringify(o.items)}`);
    const menos = llamar('mesero', `select items, total, version from public.aplicar_delta_orden('zu-o1', ${literal(promoId)}, 'Seco · 3er almuerzo · 20% OFF', 13600, -1, '')`);
    assert.ok(menos.ok, menos.error);
    const mas = llamar('mesero', `select items, total, version from public.aplicar_delta_orden('zu-o1', ${literal(promoId)}, 'Seco · 3er almuerzo · 20% OFF', 13600, 1, '')`);
    assert.ok(mas.ok, mas.error);
    o = orden('zu-o1');
    assert.equal(Number(o.total), antesTotal, `la cuenta quedó como estaba: ${JSON.stringify(o.items)}`);
    assert.equal(o.items.filter((i) => String(i.id).startsWith('promo:') && !i.promo).length, 0, 'ninguna línea de promo suelta');
    assert.equal(linea(o, 'zu-seco').precio_manual, true, 'y la marca de precio a mano sigue');
    assert.equal(Number(linea(o, 'zu-seco').precio), 17000);
  });

  test('el cobro por partes (cobrar_parcial) respeta el precio a mano: cobra a ese precio, la cuenta conserva la marca en lo que queda, y un cambio de precio en Productos no se la quita', () => {
    DIA = 3;
    abrir('zu-o2', 82);
    delta('zu-o2', 'zu-be1', 'Cerveza', 10000, 2);
    const fijada = llamar('mesero', "select items, total, version from public.fijar_precio_item('zu-o2', 'zu-be1', 8000)");
    assert.ok(fijada.ok, fijada.error);
    const v = Number(orden('zu-o2').version);
    const r = llamar('mesero', `select public.cobrar_parcial('zu-o2', ${v}, '{"id":"zu-v2"}'::jsonb, '[{"id":"zu-be1","qty":1}]'::jsonb, 'zu-c2') as r`);
    assert.ok(r.ok, r.error);
    const res = r.filas[0].r;
    assert.equal(res.ok, true);
    assert.equal(Number(res.venta.total), 8000, 'se cobró el precio a mano');
    const o = orden('zu-o2');
    assert.equal(Number(linea(o, 'zu-be1').qty), 1);
    assert.equal(Number(linea(o, 'zu-be1').precio), 8000);
    assert.equal(linea(o, 'zu-be1').precio_manual, true, 'lo que queda conserva la marca');
    assert.equal(Number(o.total), 8000);
    sql("update public.productos set precio = 11000 where id = 'zu-be1';");
    assert.equal(Number(linea(orden('zu-o2'), 'zu-be1').precio), 8000, 'el precio vivo no pisa el precio a mano');
    // y la misma venta repetida (la respuesta se perdió) devuelve lo mismo sin duplicar
    const otra = llamar('mesero', `select public.cobrar_parcial('zu-o2', ${v}, '{"id":"zu-v2"}'::jsonb, '[{"id":"zu-be1","qty":1}]'::jsonb, 'zu-c2') as r`);
    assert.ok(otra.ok, otra.error);
    assert.equal(otra.filas[0].r.repetido, true);
    assert.equal(pg.filas("select count(*)::int as n from public.ordenes where parcial_de = 'zu-o2'")[0].n, 1);
    sql("update public.productos set precio = 10000 where id = 'zu-be1';");
  });
});

describe('el ORDEN de pegado en producción: con la unión al final, las de main antes del sobre y el sobre antes de las de main terminan con LA MISMA función', { skip: MOTIVO }, () => {
  let completa;      // los archivos en su orden
  let mainAntes;     // main (06*) antes de lo del sobre (05130000, 05140000) y la unión al final
  let sobreAntes;    // el sobre antes de main; sin y con la unión al final
  const recursos = [];
  const levantar = async () => { const pg = await levantarPostgres(); recursos.push(pg); prepararSimulacion(pg); return pg; };
  const SOBRE = [PLIEGUE, COBRAR];
  const DE_MAIN = ['20261006100000_cierres_de_hoy_y_cambios.sql', ...PRECIO_A_MANO];
  const ok = (hechas) => assert.ok(hechas.every((m) => m.ok), hechas.map((m) => m.archivo + ' ' + m.error).join(' | '));
  const previasA = TODAS.filter((f) => f < '20261005130000_' && true);   // todo lo anterior al sobre (incluye precio vivo, la alerta y el permiso 20261005120000)

  before(async () => {
    completa = await levantar();
    ok(aplicar(completa, TODAS));
    mainAntes = await levantar();
    ok(aplicar(mainAntes, [...previasA, ...DE_MAIN]));
    sobreAntes = await levantar();
    ok(aplicar(sobreAntes, [...previasA, ...SOBRE, ...DE_MAIN]));
  }, { timeout: 900000 });
  after(() => { for (const pg of recursos) { try { pg.parar(); } catch { /* ya está parada */ } } });

  test('los archivos se reparten exacto entre «todo lo anterior», el sobre, las de main, la unión y la lápida: ninguna falta ni se repite', () => {
    const union = new Set([...previasA, ...SOBRE, ...DE_MAIN, MIGRACION, LAPIDA]);
    assert.deepEqual([...union].sort(), TODAS, 'la cadena de los archivos se reparte exacta entre los grupos');
  });

  test('sobre antes que main y SIN la unión: el precio a mano gana (es la última) pero se pierde el pliegue — por eso la unión va al final del sobre', () => {
    assert.equal(respetaPrecioAMano(sobreAntes), true);
    assert.equal(tienePliegue(sobreAntes), false, 'el pliegue se perdió: la última en pegarse fue la de main');
  });

  test('main antes que el sobre y SIN la unión: el sobre gana y se PIERDE el precio a mano — exactamente lo que la unión evita', () => {
    aplicar(mainAntes, SOBRE);   // otra vez, en este orden: las de main ya estaban; el sobre se pega después
    assert.equal(tienePliegue(mainAntes), true);
    conProducto(mainAntes);
    assert.equal(respetaConProducto(mainAntes), false, 'la línea a mano vuelve al precio de la carta: la regresión que se evita');
  });

  test('con la unión pegada al final, los dos órdenes (y el orden de los archivos) dejan la MISMA función, byte a byte, con el pliegue Y el precio a mano', () => {
    ok(aplicar(mainAntes, [MIGRACION, LAPIDA]));   // la lápida no toca normalizar_items: va detrás de la unión en las tres bases
    ok(aplicar(sobreAntes, [MIGRACION, LAPIDA]));
    const m = cuerpoNormalizar(completa);
    assert.equal(cuerpoNormalizar(mainAntes), m, 'main antes del sobre');
    assert.equal(cuerpoNormalizar(sobreAntes), m, 'sobre antes de main');
    for (const pg of [completa, mainAntes, sobreAntes]) {
      assert.equal(tienePliegue(pg), true);
      assert.equal(respetaPrecioAMano(pg), true);
      conProducto(pg);
      assert.equal(respetaConProducto(pg), true);
    }
  });

  test('las tres bases tienen el mismo catálogo (funciones, permisos, triggers, tablas) salvo el ORDEN de los permisos', () => {
    const sinOrden = (filas) => JSON.parse(JSON.stringify(filas, (k, v) => (k === 'acl' && typeof v === 'string' ? '{' + v.slice(1, -1).split(',').sort().join(',') + '}' : v)));
    const base = sinOrden(radiografia(completa));
    assert.deepEqual(sinOrden(radiografia(mainAntes)), base, 'main antes del sobre');
    assert.deepEqual(sinOrden(radiografia(sobreAntes)), base, 'sobre antes de main');
  });
});
