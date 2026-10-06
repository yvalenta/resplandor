// Precio a mano, ronda 2: supabase/migrations/20261006130000_precio_a_mano_promo_entera.sql
// (corrección de la refutación de tareas/2026-10-05-precio-a-mano-y-botones.md sobre 20261006110000_precio_a_mano.sql, hallazgos 1 y 3).
//
// Qué cambia: DOS funciones, cada una con el mismo cuerpo de 20261006110000 más lo suyo:
//   `public.fijar_precio_item(orden, línea, precio)`:
//   1. si NO hay línea base pero SÍ líneas de promo cuya base (`promo.de`) es ese id (la promo se la llevó ENTERA: «3er almuerzo», tres ejecutivos
//      distintos × 1), el precio y la marca se escriben en la línea de promo (`promo.precio`, `promo.precio_manual`, `promo.precio_por`) y el paso a' de
//      `privado.normalizar_items` la despliega con el precio a mano y la promo se recalcula sobre él; con p_precio = null se quita la marca por el mismo camino;
//   2. «la línea X no existe en la orden Y» sale con SQLSTATE P0002 (no_data_found) y «orden X no existe» sigue P0001: el POS los distingue;
//   3. «volver a la carta» con la base presente también quita la marca que recuerdan sus líneas de promo.
//   `privado.normalizar_items`, paso a': la base que vuelve SIN marca (otra unidad del plato desde la carta mientras la promo se lo llevaba entera)
//   adopta la marca y el precio de su línea de promo; si trae marca propia, la suya manda.
//
// Dos partes, como migracion-precio-a-mano.test.mjs:
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. Que la RPC y normalizar_items sean los de 20261006110000 con SOLO esos cambios (línea por línea),
//      que se niegue a correr sin cambiar nada si falta 20261006110000, que no toque nada más (ni permisos, ni tablas), que sea
//      idempotente, que la cabecera diga lo que no se corrigió (`precio_por` es la atribución que pone la RPC, no a prueba de escritura directa) y
//      que la reversa sea volver a pegar la anterior.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker): los escenarios S1 y S2 de la refutación, invertidos (ahora se puede poner el precio y volver
//      a la carta), y los bordes: la promo que cambia de línea, dos promos sobre la misma base, lo que se sigue rechazando, los dos «no existe» con su
//      SQLSTATE, la migración dos veces, la reversa y el rechazo a correr si falta 20261006110000.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal, topicoCuenta } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa } from './_cola-impresion-pg.mjs';

const MIGRACION = '20261006130000_precio_a_mano_promo_entera.sql';
const PREVIA = '20261006110000_precio_a_mano.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${MIGRACION}`);
const SQL_PREVIA = leer(`supabase/migrations/${PREVIA}`);
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CODIGO = sinComentarios(SQL);
const CP = compacto(CODIGO);
const CABECERA = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos'));

/** Las líneas (sin comentarios ni espacios) de `create or replace function public.fijar_precio_item` de una migración. */
function rpcDe(sql) {
  const c = sinComentarios(sql);
  const a = c.indexOf('create or replace function public.fijar_precio_item');
  const b = c.indexOf('comment on function public.fijar_precio_item', a);
  assert.ok(a >= 0 && b > a, 'no encuentro public.fijar_precio_item');
  return c.slice(a, b).split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Las líneas (sin comentarios ni espacios) de `create or replace function privado.normalizar_items` de una migración. */
function normalizarDe(sql) {
  const c = sinComentarios(sql);
  const a = c.indexOf('create or replace function privado.normalizar_items');
  const b = c.indexOf('revoke all on function privado.normalizar_items', a);
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

test('la migración va después del precio a mano (20261006110000), con prefijo único', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(nombres.includes(MIGRACION) && nombres.includes(PREVIA));
  assert.ok(PREVIA < MIGRACION);
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.ok(nombres.slice(nombres.indexOf(MIGRACION) + 1).every((n) => n > MIGRACION));
});

test('la cabecera dice qué hace, quién la corre, qué necesita, cómo se deshace, en qué orden sale y lo que NO se corrigió (precio_por no es a prueba de escritura directa)', () => {
  for (const frase of [
    'QUÉ HACE', 'QUIÉN LO VE Y QUIÉN LO CAMBIA', 'REVERSA (menos de 1 minuto', 'lo aplica Yonatan: aparca', 'Idempotente', 'Orden de salida al aire',
    'public.fijar_precio_item', 'privado.normalizar_items', 'paso a\'', 'adopta', 'promo.precio_manual', 'promo.precio_por', 'promo.de', 'p_precio = null', 'P0002', 'P0001',
    '20261006110000_precio_a_mano.sql', 'se niega a\n-- correr SIN cambiar nada'.replace('\n-- ', ' '), 'ordenes_editar', 'ordenes_guardia', 'SECURITY INVOKER',
    'LO QUE NO CAMBIA, A PROPÓSITO', 'decisión pendiente de Yonatan', 'ATRIBUCIÓN que pone la RPC', 'NO es un dato a prueba de\n--   falsificación'.replace('\n--   ', ' '),
  ]) assert.ok(compacto(CABECERA.replace(/^--\s?/gm, '')).includes(compacto(frase)), `la cabecera no dice «${frase}»`);
});

test('se niega a correr, sin cambiar nada, si falta 20261006110000 (la RPC o el respeto por precio_manual) o mi_rol()/mi_correo(), y lo comprueba ANTES de crear nada', () => {
  const requisitos = CODIGO.slice(0, CODIGO.indexOf('create or replace function'));
  assert.match(requisitos, /to_regprocedure\('public\.fijar_precio_item\(text, text, numeric\)'\) is null[\s\S]*Falta 20261006110000_precio_a_mano\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /position\('precio_manual' in pg_get_functiondef\('privado\.normalizar_items\(jsonb, smallint\)'::regprocedure\)\) = 0[\s\S]*Falta 20261006110000_precio_a_mano\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /to_regprocedure\('public\.mi_rol\(\)'\) is null or to_regprocedure\('public\.mi_correo\(\)'\) is null[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bgrant\b/i);
});

test('la RPC es la de 20261006110000 con SOLO tres cambios: la base dentro de la promo (v_enpromo: se escribe en promo.precio/precio_manual/precio_por y se quita con null), «volver a la carta» con la base presente quita también la marca de sus líneas de promo, y «la línea no existe» con SQLSTATE P0002', () => {
  const { quitadas, agregadas } = diferencia(rpcDe(SQL_PREVIA), rpcDe(SQL));
  assert.deepEqual(quitadas, [
    "raise exception 'la línea % no existe en la orden %', p_item_id, p_orden_id;",
    "or coalesce(nullif(it ->> 'precio', '')::numeric, 0) < 0 then",
  ], 'qué dejó de estar');
  assert.deepEqual(agregadas, [
    'v_enpromo boolean := false;',
    'v_enpromo := exists (select 1 from jsonb_array_elements(o.items) e',
    "where (e ->> 'id') like 'promo:%' and jsonb_typeof(e -> 'promo') = 'object' and e -> 'promo' ->> 'de' = p_item_id);",
    'if not v_enpromo then',
    "raise exception 'la línea % no existe en la orden %', p_item_id, p_orden_id using errcode = 'P0002';",
    "or (v_enpromo and p_item_id like 'manual\\_%')",
    "or (not v_enpromo and coalesce(nullif(it ->> 'precio', '')::numeric, 0) < 0) then",
    'end if;',
    "when (e ->> 'id') like 'promo:%' and jsonb_typeof(e -> 'promo') = 'object' and e -> 'promo' ->> 'de' = p_item_id and (v_enpromo or p_precio is null) then",
    'case',
    "when p_precio is null then jsonb_set(e, '{promo}', ((e -> 'promo') - 'precio_manual') - 'precio_por')",
    'else jsonb_set(',
    "jsonb_set(e, '{promo}', (e -> 'promo') || jsonb_strip_nulls(jsonb_build_object('precio', p_precio, 'precio_manual', true, 'precio_por', v_correo))),",
    "'{precio}', to_jsonb(round(p_precio * (100 - coalesce(nullif(e -> 'promo' ->> 'descuento', '')::numeric, 0)) / 100.0)))",
    'end',
    'when v_enpromo then e',
  ], 'qué se agregó');
  const cp = compacto(rpcDe(SQL).join('\n'));
  assert.match(cp, /returns public\.ordenes language plpgsql set search_path = public as \$function\$/, 'sigue siendo SECURITY INVOKER (sin security definer)');
  assert.doesNotMatch(cp, /security definer/i);
  // los guardias de antes siguen en su sitio y en su orden: permisos, precio, orden bloqueada, abierta, línea
  const orden = ["errcode = '42501'", "errcode = '22023'", 'for update', "errcode = 'RS001'", "errcode = 'P0002'"].map((s) => cp.indexOf(s));
  assert.ok(orden.every((n) => n > 0) && orden.every((n, i) => i === 0 || n > orden[i - 1]), `los guardias cambiaron de orden: ${orden}`);
  assert.match(cp, /raise exception 'orden % no existe', p_orden_id;/, 'y «orden no existe» sigue siendo P0001 (sin errcode): el mensaje que aplicar_delta_orden ya da');
});

test('normalizar_items es el de 20261006110000 con SOLO la adopción del paso a\': la base que vuelve sin marca toma el precio y la marca de su línea de promo; la que trae marca propia, no', () => {
  const { quitadas, agregadas } = diferencia(normalizarDe(SQL_PREVIA), normalizarDe(SQL));
  assert.deepEqual(quitadas, [], 'no se quitó ni una línea');
  assert.deepEqual(agregadas, [
    "if v_lineas[v_i] ->> 'precio_manual' is distinct from 'true'",
    "and v_item -> 'promo' ->> 'precio_manual' = 'true' and nullif(v_item -> 'promo' ->> 'precio', '') is not null then",
    "v_lineas[v_i] := (v_lineas[v_i] || jsonb_build_object('precio', (v_item -> 'promo' ->> 'precio')::numeric))",
    "|| jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_item -> 'promo' ->> 'precio_por'));",
    'end if;',
  ], 'qué se agregó');
  const cp = compacto(normalizarDe(SQL).join('\n'));
  // la adopción vive en el paso a' (cuando la base YA está: v_found), después de sumarle las unidades y antes de salir del ciclo
  const a1 = cp.indexOf("'{qty}', to_jsonb(coalesce(nullif(v_lineas[v_i] ->> 'qty', '')::int, 0) + v_n));");
  const a2 = cp.indexOf("is distinct from 'true'");
  const a3 = cp.indexOf('v_found := true; exit;');
  assert.ok(a1 > 0 && a2 > a1 && a3 > a2, `la adopción no está entre sumar las unidades y salir: ${a1} ${a2} ${a3}`);
  assert.doesNotMatch(cp, /\b(update|insert into|delete from|truncate)\b/, 'sigue sin escribir nada: solo lee productos');
  assert.match(cp, /^create or replace function privado\.normalizar_items\(p_items jsonb, p_dia smallint\) returns jsonb language plpgsql stable set search_path = '' as \$\$/, 'mismo contrato: estable, search_path vacío, sin security definer');
  assert.match(CP, /revoke all on function privado\.normalizar_items\(jsonb, smallint\) from public, anon, authenticated;/, 'y sigue sin EXECUTE para anon ni authenticated');
});

test('no toca nada más: ni tablas, vistas, policies, triggers o permisos nuevos; dos «create or replace function» (normalizar_items y la RPC), un solo GRANT', () => {
  assert.equal((CP.match(/create or replace function/g) || []).length, 2);
  assert.equal((CP.match(/\bgrant\b/g) || []).length, 1);
  assert.match(CP, /revoke all on function public\.fijar_precio_item\(text, text, numeric\) from public, anon, service_role;/);
  assert.match(CP, /grant execute on function public\.fijar_precio_item\(text, text, numeric\) to authenticated;/);
  assert.doesNotMatch(CP, /(create|drop|alter) (policy|table|trigger|view)|enable row level security|publication|add column|\bdrop\b/i);
  const sinCuerpos = CP.replace(/\$function\$.*?\$function\$/g, ' $function$…$function$ ').replace(/\$\$.*?\$\$/g, ' $$…$$ ');
  assert.doesNotMatch(sinCuerpos, /\bupdate\s+(public|privado)\.|\binsert into\b|\bdelete from\b|\btruncate\b/i, 'ningún dato escrito fuera de la función');
});

test('la reversa de la cabecera no borra nada y manda volver a pegar 20261006110000 entero (es idempotente: su create or replace devuelve las dos funciones a las de antes)', () => {
  assert.equal(compacto(reversa(SQL).replace(/^--.*$/gm, '')), 'begin; commit;');
  const cab = compacto(CABECERA.replace(/^--\s?/gm, ''));
  assert.match(cab, /volver a pegar 20261006110000_precio_a_mano\.sql entero \(es idempotente: su `create or replace` devuelve `public\.fijar_precio_item` y `privado\.normalizar_items`/);
});

test('la comprobación final mira la RPC nueva, sus permisos (authenticated y nadie más), que normalizar_items siga respetando la marca sin EXECUTE para la API, y la adopción (y que la marca propia de la base mande)', () => {
  const fin = CODIGO.slice(CODIGO.lastIndexOf('do $$'));
  assert.match(fin, /position\('P0002' in pg_get_functiondef\('public\.fijar_precio_item\(text, text, numeric\)'::regprocedure\)\) = 0/);
  assert.match(fin, /has_function_privilege\('anon', 'public\.fijar_precio_item\(text, text, numeric\)', 'execute'\)/);
  assert.match(fin, /has_function_privilege\('service_role'/);
  assert.match(fin, /position\('precio_manual' in pg_get_functiondef\('privado\.normalizar_items\(jsonb, smallint\)'::regprocedure\)\) = 0/);
  assert.match(fin, /has_function_privilege\('authenticated', 'privado\.normalizar_items\(jsonb, smallint\)', 'execute'\)/);
  assert.match(fin, /no adopta la marca de la línea de promo/);
  assert.match(fin, /pisó la marca de la base con la de la línea de promo/);
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;
const TOKEN_91 = 'a'.repeat(48);

describe('contra un Postgres 17 desechable (Supabase simulado, cadena completa de migraciones)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  let despues;
  const avisos = [];
  let DIA = 1;
  const sql = (texto, opciones) => {
    const r = pg.sql(`set resplandor.dia_promo = ${DIA};\n` + texto, opciones);
    for (const a of r.avisos) avisos.push(`${a}  ←  ${compacto(texto).slice(0, 90)}`);
    assert.ok(r.ok, r.error);
    return r;
  };
  const ultimoJson = (salida) => JSON.parse(String(salida).trim().split('\n').pop());
  const orden = (id) => pg.filas(`select items, total, version from public.ordenes where id = ${literal(id)}`)[0];
  const linea = (o, id) => o.items.find((i) => i.id === id);
  const forma = (o) => o.items.map((i) => [i.id, i.qty, Number(i.precio)]);
  const claims = (clave) => {
    const g = pg.filas(`select id, email, provider from t.gente where clave = ${literal(clave)}`)[0];
    return { sub: g.id, role: 'authenticated', email: g.email, app_metadata: { provider: g.provider } };
  };
  const como = (clave) => ({ como: 'authenticated', claims: claims(clave) });
  /** Llama a la RPC como esa persona: { ok, fila, error } (el error con su SQLSTATE: VERBOSITY verbose). */
  const fijar = (clave, id, item, precio) => {
    const arg = precio === null ? 'null' : String(precio);
    const texto = `set resplandor.dia_promo = ${DIA};\n\\set VERBOSITY verbose\nselect coalesce(json_agg(to_jsonb(t)), '[]'::json) from (select items, total, version from public.fijar_precio_item(${literal(id)}, ${literal(item)}, ${arg})) t;`;
    const r = pg.sql(texto, clave === 'anon' || clave === 'service_role' ? { como: clave, claims: { role: clave } } : como(clave));
    for (const a of r.avisos) avisos.push(`${a}  ←  fijar_precio_item`);
    return { ok: r.ok, fila: r.ok ? ultimoJson(r.salida)[0] : null, error: r.error };
  };
  const delta = (id, producto, nombre, precio, n, nota = '') => {
    const r = pg.sql(`set resplandor.dia_promo = ${DIA};\nselect coalesce(json_agg(to_jsonb(t)), '[]'::json) from (select items, total, version from public.aplicar_delta_orden(${literal(id)}, ${literal(producto)}, ${literal(nombre)}, ${precio}, ${n}, ${literal(nota)})) t;`, como('mesero'));
    if (!r.ok) throw new Error(r.error);
    return ultimoJson(r.salida)[0];
  };
  const abrir = (id, mesa) => sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', '[]', 0, now());`);
  /** Tres ejecutivos distintos × 1 un lunes: el más barato (t-ej3) se va ENTERO a la promo. */
  const tresDistintos = (id, mesa) => {
    abrir(id, mesa);
    delta(id, 't-ej1', 'Menú Resplandor', 23000, 1);
    delta(id, 't-ej2', 'Seco', 19000, 1);
    return delta(id, 't-ej3', 'Ejecutivo del día', 18000, 1);
  };

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 16 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    assert.ok(previas.some((m) => m.archivo === PREVIA), 'la cadena previa incluye 20261006110000');
    antes = radiografia(pg);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, `la migración no se aplicó: ${mia[0].error}`);
    assert.deepEqual(mia[0].avisos, [], 'aplicarla no deja ni un WARNING');
    despues = radiografia(pg);
    sql(`insert into public.personal (email, nombre, rol) values ('mesero1@resplandor.test', 'Mesero Prueba', 'mesero') on conflict (email) do nothing;`);
    sql(`
      insert into public.productos (id, categoria, nombre, precio, activo) values
        ('t-ej1','Ejecutivos','Menú Resplandor',23000,true),
        ('t-ej2','Ejecutivos','Seco',19000,true),
        ('t-ej3','Ejecutivos','Ejecutivo del día',18000,true),
        ('t-be2','Bebidas','Cerveza',10000,true);
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
        ('t-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}');
      insert into public.mesas (id, capacidad, estado, token) values
        (91,4,'ocupada',${literal(TOKEN_91)}),(92,4,'ocupada',repeat('b',48)),(93,4,'ocupada',repeat('c',48)),(94,4,'ocupada',repeat('d',48)),
        (95,4,'ocupada',repeat('e',48)),(96,4,'ocupada',repeat('f',48)),(97,4,'ocupada',repeat('g',48)),(98,4,'ocupada',repeat('h',48)),
        (99,4,'ocupada',repeat('i',48)),(100,4,'ocupada',repeat('j',48));
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('cambia SOLO public.fijar_precio_item y privado.normalizar_items: mismos nombres, argumentos y permisos (la RPC, de authenticated y nadie más; normalizar_items, de nadie de la API); ninguna otra función, tabla, vista, policy, trigger ni publicación', () => {
    const clave = (f) => JSON.stringify(f);
    for (const seccion of Object.keys(antes)) {
      if (seccion === 'funciones') continue;
      assert.deepEqual(despues[seccion], antes[seccion], `${seccion}: cambió`);
    }
    const distintas = despues.funciones.filter((f) => !antes.funciones.some((a) => clave(a) === clave(f)));
    assert.deepEqual(distintas.map((f) => `${f.nspname}.${f.proname}`).sort(), ['privado.normalizar_items', 'public.fijar_precio_item'], 'las únicas funciones distintas');
    for (const nueva of distintas) {
      const vieja = antes.funciones.find((f) => f.nspname === nueva.nspname && f.proname === nueva.proname);
      assert.equal(nueva.args, vieja.args, `${nueva.proname}: mismos argumentos`);
      assert.equal(nueva.acl, vieja.acl, `${nueva.proname}: mismo permiso`);
      assert.notEqual(nueva.cuerpo, vieja.cuerpo, `${nueva.proname}: otro cuerpo`);
    }
    const rpcNueva = distintas.find((f) => f.proname === 'fijar_precio_item');
    assert.match(rpcNueva.acl || '', /authenticated=X/);
    assert.doesNotMatch(rpcNueva.acl || '', /anon|service_role/);
    assert.doesNotMatch(distintas.find((f) => f.proname === 'normalizar_items').acl || '', /anon|authenticated/, 'normalizar_items sigue sin EXECUTE para la API');
    assert.equal(despues.funciones.length, antes.funciones.length, 'ninguna función de más ni de menos');
  });

  test('S1 invertido: lunes, tres ejecutivos distintos × 1, el más barato se va ENTERO a la promo: ahora se le pone precio a mano por el id de la base (queda en la línea de promo, con marca y quién), y la promo se recalcula', () => {
    DIA = 1;
    const o0 = tresDistintos('r-o1', 91);
    assert.deepEqual(forma(o0), [['t-ej1', 1, 23000], ['t-ej2', 1, 19000], ['promo:t-pr3:t-ej3', 1, 14400]]);
    assert.equal(linea(o0, 't-ej3'), undefined, 'la base ya no está: solo su línea de promo');
    pg.limpiarSenales();
    const r = fijar('mesero', 'r-o1', 't-ej3', 15000);
    assert.ok(r.ok, r.error);
    assert.deepEqual(forma(r.fila), [['t-ej1', 1, 23000], ['t-ej2', 1, 19000], ['promo:t-pr3:t-ej3', 1, 12000]], 'sigue siendo la más barata: la promo cae sobre 15.000 (80 %)');
    const p = linea(r.fila, 'promo:t-pr3:t-ej3');
    assert.equal(Number(p.promo.precio), 15000, 'el precio de la base, a mano');
    assert.equal(p.promo.precio_manual, true, 'la marca vive en la línea de promo');
    assert.equal(p.promo.precio_por, 'mesero1@resplandor.test', 'quien lo puso, por su identidad de Google');
    assert.equal(p.promo.de, 't-ej3');
    assert.equal(Number(r.fila.total), 23000 + 19000 + 12000);
    assert.equal(r.fila.version, o0.version + 1, 'la versión sube una');
    assert.deepEqual(orden('r-o1').items, r.fila.items, 'y es lo que quedó guardado');
    assert.ok(pg.senales().includes(topicoCuenta(TOKEN_91)), `la carta de la mesa 91 recibió la señal: ${JSON.stringify(pg.senales())}`);
    // otro precio por otra persona: el último gana, también el que firma
    const a = fijar('admin', 'r-o1', 't-ej3', 13000);
    assert.ok(a.ok, a.error);
    assert.equal(Number(linea(a.fila, 'promo:t-pr3:t-ej3').precio), 10400);
    assert.equal(linea(a.fila, 'promo:t-pr3:t-ej3').promo.precio_por, 'admin@resplandor.test');
    assert.equal(Number(a.fila.total), 23000 + 19000 + 10400);
    // 0 es un precio válido (una cortesía): una línea gratis no entra a la promo, así que la base REAPARECE con su marca (y sin descuento para nadie)
    const cero = fijar('mesero', 'r-o1', 't-ej3', 0);
    assert.ok(cero.ok, cero.error);
    assert.deepEqual(forma(cero.fila), [['t-ej1', 1, 23000], ['t-ej2', 1, 19000], ['t-ej3', 1, 0]]);
    assert.equal(linea(cero.fila, 't-ej3').precio_manual, true);
    assert.equal(Number(cero.fila.total), 42000);
    // y otro precio la devuelve a la promo (la base se va entera otra vez, con su marca en la línea de promo)
    const otra = fijar('mesero', 'r-o1', 't-ej3', 13000);
    assert.ok(otra.ok, otra.error);
    assert.deepEqual(forma(otra.fila), [['t-ej1', 1, 23000], ['t-ej2', 1, 19000], ['promo:t-pr3:t-ej3', 1, 10400]]);
    assert.equal(linea(otra.fila, 'promo:t-pr3:t-ej3').promo.precio_manual, true);
  });

  test('la marca de la base absorbida sobrevive: un cambio de precio en Productos (la a mano no cambia, las otras sí), un «+1» desde la línea de promo y tocar la cuenta', () => {
    DIA = 1;
    try {
    sql("update public.productos set precio = 24000 where id = 't-ej1'; update public.productos set precio = 21000 where id = 't-ej3';");
    let o = orden('r-o1');
    assert.deepEqual(forma(o), [['t-ej1', 1, 24000], ['t-ej2', 1, 19000], ['promo:t-pr3:t-ej3', 1, 10400]], 'el precio vivo no pisa el de la mano: sigue siendo 13.000 menos 20 %');
    assert.equal(linea(o, 'promo:t-pr3:t-ej3').promo.precio_manual, true);
    // el «+» de la línea de promo (el POS manda el id de la línea de promo): la base vuelve con DOS unidades y su marca
    o = delta('r-o1', 'promo:t-pr3:t-ej3', 'Ejecutivo del día · 3er almuerzo', 10400, 1);
    assert.deepEqual(forma(o), [['t-ej1', 1, 24000], ['t-ej2', 1, 19000], ['t-ej3', 1, 13000], ['promo:t-pr3:t-ej3', 1, 10400]], 'dos unidades a 13.000: la 3.ª de la cuenta (la más barata) lleva el descuento');
    assert.equal(linea(o, 't-ej3').precio_manual, true, 'la base volvió con su marca');
    assert.equal(linea(o, 't-ej3').precio_por, 'mesero1@resplandor.test', 'y con quien la puso');
    sql("update public.ordenes set updated_at = now() where id = 'r-o1';");
    assert.equal(Number(linea(orden('r-o1'), 't-ej3').precio), 13000);
    delta('r-o1', 'promo:t-pr3:t-ej3', 'x', 0, -1);
    } finally {
      sql("update public.productos set precio = 23000 where id = 't-ej1'; update public.productos set precio = 18000 where id = 't-ej3';");
    }
  });

  test('«Volver al precio de carta» de la base absorbida (p_precio null): se quita la marca de la línea de promo y la base toma el precio de HOY de Productos; sin marca, otro cambio de precio la sigue', () => {
    DIA = 1;
    const o0 = orden('r-o1');
    assert.equal(linea(o0, 'promo:t-pr3:t-ej3').promo.precio_manual, true);
    const r = fijar('mesero', 'r-o1', 't-ej3', null);
    assert.ok(r.ok, r.error);
    assert.deepEqual(forma(r.fila), [['t-ej1', 1, 23000], ['t-ej2', 1, 19000], ['promo:t-pr3:t-ej3', 1, 14400]], 'la promo cae sobre 18.000 (80 %)');
    const p = linea(r.fila, 'promo:t-pr3:t-ej3');
    assert.equal(Number(p.promo.precio), 18000);
    assert.equal(p.promo.precio_manual, undefined, 'sin marca');
    assert.equal(p.promo.precio_por, undefined);
    assert.ok(!JSON.stringify(r.fila.items).includes('precio_manual') && !JSON.stringify(r.fila.items).includes('precio_por'), 'ni rastro de la marca en la cuenta');
    assert.equal(Number(r.fila.total), 23000 + 19000 + 14400);
    sql("update public.productos set precio = 17000 where id = 't-ej3';");
    assert.equal(Number(linea(orden('r-o1'), 'promo:t-pr3:t-ej3').precio), 13600, 'ya no es a mano: sigue al catálogo (17.000 menos 20 %)');
    sql("update public.productos set precio = 18000 where id = 't-ej3';");
    // y se puede volver a poner, y a quitar
    assert.ok(fijar('mesero', 'r-o1', 't-ej3', 16000).ok);
    const quitar = fijar('mesero', 'r-o1', 't-ej3', null);
    assert.ok(quitar.ok, quitar.error);
    assert.equal(Number(linea(quitar.fila, 'promo:t-pr3:t-ej3').promo.precio), 18000);
  });

  test('S2 invertido: el Menú a 17.000 a mano lo vuelve el más barato y el descuento se muda a él (su base desaparece); «Volver al precio de carta» por el id de la base lo devuelve a la carta y el descuento regresa', () => {
    DIA = 1;
    tresDistintos('r-o2', 92);
    const r = fijar('mesero', 'r-o2', 't-ej1', 17000);
    assert.ok(r.ok, r.error);
    assert.deepEqual(forma(r.fila), [['promo:t-pr3:t-ej1', 1, 13600], ['t-ej2', 1, 19000], ['t-ej3', 1, 18000]], 'el descuento se mudó al Menú');
    assert.equal(linea(r.fila, 't-ej1'), undefined, 'y su base desapareció');
    const pm = linea(r.fila, 'promo:t-pr3:t-ej1');
    assert.equal(pm.promo.precio_manual, true, 'la marca quedó en la línea de promo');
    assert.equal(Number(r.fila.total), 50600);
    // antes de esta migración aquí no había salida: ahora sí
    const v = fijar('mesero', 'r-o2', 't-ej1', null);
    assert.ok(v.ok, v.error);
    assert.deepEqual(v.fila.items.map((i) => [i.id, i.qty, Number(i.precio)]).sort(), [['promo:t-pr3:t-ej3', 1, 14400], ['t-ej1', 1, 23000], ['t-ej2', 1, 19000]], 'el Menú vuelve a 23.000 y el descuento a donde estaba');
    assert.ok(!JSON.stringify(v.fila.items).includes('precio_manual'), 'sin marca atrapada');
    assert.equal(Number(v.fila.total), 23000 + 19000 + 14400);
  });

  test('un precio a mano que deja de ser el más barato: la base reaparece con su marca y el descuento pasa a la nueva más barata; «Volver» por el id de la base ya con la línea presente sigue como antes', () => {
    DIA = 1;
    tresDistintos('r-o3', 93);
    const r = fijar('mesero', 'r-o3', 't-ej3', 25000);
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.fila.items.map((i) => [i.id, i.qty, Number(i.precio)]).sort(), [['promo:t-pr3:t-ej2', 1, 15200], ['t-ej1', 1, 23000], ['t-ej3', 1, 25000]].sort(), 'el Seco (19.000) es ahora el más barato');
    assert.equal(linea(r.fila, 't-ej3').precio_manual, true);
    assert.equal(linea(r.fila, 't-ej3').precio_por, 'mesero1@resplandor.test');
    assert.equal(Number(r.fila.total), 23000 + 25000 + 15200);
    const v = fijar('mesero', 'r-o3', 't-ej3', null);
    assert.ok(v.ok, v.error);
    assert.deepEqual(v.fila.items.map((i) => [i.id, i.qty, Number(i.precio)]).sort(), [['promo:t-pr3:t-ej3', 1, 14400], ['t-ej1', 1, 23000], ['t-ej2', 1, 19000]].sort());
    assert.ok(!JSON.stringify(v.fila.items).includes('precio_manual'));
  });

  test('con la base presente (le sobran unidades) todo sigue como en 20261006110000: la marca va en la línea base y la línea de promo la recuerda', () => {
    DIA = 1;
    abrir('r-o4', 94);
    delta('r-o4', 't-ej1', 'Menú Resplandor', 23000, 3);
    const r = fijar('mesero', 'r-o4', 't-ej1', 20000);
    assert.ok(r.ok, r.error);
    assert.deepEqual(forma(r.fila), [['t-ej1', 2, 20000], ['promo:t-pr3:t-ej1', 1, 16000]]);
    assert.equal(linea(r.fila, 't-ej1').precio_manual, true);
    assert.equal(linea(r.fila, 'promo:t-pr3:t-ej1').promo.precio_manual, true);
    const v = fijar('mesero', 'r-o4', 't-ej1', null);
    assert.ok(v.ok, v.error);
    assert.deepEqual(forma(v.fila), [['t-ej1', 2, 23000], ['promo:t-pr3:t-ej1', 1, 18400]]);
    assert.ok(!JSON.stringify(v.fila.items).includes('precio_manual'));
  });

  test('lo que se sigue rechazando: la línea de promo (22023), el marcador «para llevar», un abono, un precio fuera de rango; y una línea que no existe en NINGÚN lado', () => {
    DIA = 1;
    const v0 = orden('r-o1');
    const promo = fijar('mesero', 'r-o1', 'promo:t-pr3:t-ej3', 1000);
    assert.equal(promo.ok, false);
    assert.match(promo.error, /22023/);
    assert.match(promo.error, /no se puede cambiar a mano/);
    for (const malo of [-1, 100.5, 10000001]) {
      const r = fijar('mesero', 'r-o1', 't-ej3', malo);
      assert.equal(r.ok, false, `${malo} entró`);
      assert.match(r.error, /22023/);
      assert.match(r.error, /precio inválido/);
    }
    for (const id of ['para_llevar', 'abono_recibido_1', 'manual_x', 'no-hay', 't-be2']) {
      const r = fijar('mesero', 'r-o1', id, 1000);
      assert.equal(r.ok, false, id);
      assert.match(r.error, /P0002/, `${id}: sin línea ni promo de esa base → no_data_found: ${r.error}`);
      assert.match(r.error, new RegExp(`la línea ${id} no existe en la orden r-o1`));
    }
    assert.deepEqual(orden('r-o1'), v0, 'nada cambió');
  });

  test('«la línea no existe» (P0002) y «orden no existe» (P0001) son rechazos distintos: el POS los distingue por el SQLSTATE', () => {
    DIA = 1;
    const linea0 = fijar('mesero', 'r-o2', 'no-hay', 1000);
    assert.equal(linea0.ok, false);
    assert.match(linea0.error, /ERROR:\s+P0002: la línea no-hay no existe en la orden r-o2/);
    const orden0 = fijar('mesero', 'no-hay', 't-ej1', 1000);
    assert.equal(orden0.ok, false);
    assert.match(orden0.error, /ERROR:\s+P0001: orden no-hay no existe/);
    assert.doesNotMatch(orden0.error, /P0002/);
  });

  test('los permisos no cambian: anon y service_role no tienen EXECUTE; una cuenta ajena, una sesión por correo y una pendiente reciben 42501; mesero y admin pueden; una cuenta CERRADA rechaza (RS001 al admin, «no existe» al mesero)', () => {
    DIA = 1;
    const v0 = orden('r-o3');
    for (const quien of ['anon', 'service_role']) {
      const r = fijar(quien, 'r-o3', 't-ej2', 1000);
      assert.equal(r.ok, false, `${quien} pudo`);
      assert.match(r.error, /42501|permission denied/i, `${quien}: ${r.error}`);
    }
    for (const quien of ['ajena', 'correo', 'pendiente']) {
      const r = fijar(quien, 'r-o3', 't-ej2', 1000);
      assert.equal(r.ok, false, `${quien} pudo`);
      assert.match(r.error, /42501/, `${quien}: ${r.error}`);
    }
    assert.deepEqual(orden('r-o3'), v0);
    // una cuenta con la base absorbida y luego CERRADA
    tresDistintos('r-o5', 95);
    const ver = orden('r-o5').version;
    sql(`update public.ordenes set estado = 'cerrada', cerrada_en = now(), version = ${ver} where id = 'r-o5';`);
    const cerrada = orden('r-o5');
    const admin = fijar('admin', 'r-o5', 't-ej3', 1000);
    assert.equal(admin.ok, false);
    assert.match(admin.error, /RS001/);
    const mesero = fijar('mesero', 'r-o5', 't-ej3', 1000);
    assert.equal(mesero.ok, false);
    assert.match(mesero.error, /P0001: orden r-o5 no existe/, 'la RLS no le muestra una cuenta cerrada al mesero');
    assert.deepEqual(orden('r-o5'), cerrada);
  });

  test('cobrar una cuenta con la base absorbida a mano: el cierre lleva el precio (la normalización del cierre lo respeta) y un cambio posterior en Productos no toca la venta', () => {
    DIA = 1;
    tresDistintos('r-o6', 96);
    const r = fijar('mesero', 'r-o6', 't-ej3', 15000);
    assert.ok(r.ok, r.error);
    const ver = orden('r-o6').version;
    sql(`update public.ordenes set estado = 'cerrada', cerrada_en = now(), version = ${ver} where id = 'r-o6';`);
    const cerrada = orden('r-o6');
    assert.equal(Number(linea(cerrada, 'promo:t-pr3:t-ej3').precio), 12000, 'el cierre no pisó el precio a mano');
    assert.equal(Number(cerrada.total), 23000 + 19000 + 12000);
    sql("update public.productos set precio = 30000 where id = 't-ej3';");
    assert.deepEqual(orden('r-o6'), cerrada, 'la venta cerrada no cambia');
    sql("update public.productos set precio = 18000 where id = 't-ej3';");
  });

  test('dos promos sobre la misma base absorbida: el precio se escribe en las dos líneas de promo y la base vuelve una vez, con su marca', () => {
    DIA = 1;
    // una segunda promo del lunes sobre la misma categoría: cada 2, 10 % (las dos le caen al mismo plato cuando está entero en ambas)
    sql(`insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
          ('t-pr2','Promociones','2.º almuerzo',0,true,'10% OFF',1,'{"cada":2,"descuento":10,"aplica":{"productos":["t-ej3","t-ej2"]}}');`);
    abrir('r-o7', 97);
    delta('r-o7', 't-ej1', 'Menú Resplandor', 23000, 1);
    delta('r-o7', 't-ej2', 'Seco', 19000, 1);
    const o = delta('r-o7', 't-ej3', 'Ejecutivo del día', 18000, 2);
    const ids = o.items.map((i) => i.id);
    const promosDe3 = o.items.filter((i) => i.promo && i.promo.de === 't-ej3');
    assert.equal(promosDe3.length, 2, `las dos promos se llevaron t-ej3 (una unidad cada una): ${JSON.stringify(forma(o))}`);
    assert.equal(linea(o, 't-ej3'), undefined, 'y su base ya no está');
    const r = fijar('mesero', 'r-o7', 't-ej3', 16000);
    assert.ok(r.ok, r.error);
    const base = linea(r.fila, 't-ej3');
    const promos = r.fila.items.filter((i) => i.promo && i.promo.de === 't-ej3');
    // las unidades de t-ej3 siguen siendo 2, a 16.000 antes del descuento, en las DOS líneas de promo y con la marca, y el total cuadra
    assert.equal(promos.length, 2);
    assert.equal(base, undefined, 'la base sigue entera dentro de las promos');
    const unidades = (base ? base.qty : 0) + promos.reduce((s, i) => s + i.qty, 0);
    assert.equal(unidades, 2, `las 2 unidades siguen en la cuenta: ${JSON.stringify(forma(r.fila))} (antes ${JSON.stringify(ids)})`);
    for (const p of promos) { assert.equal(Number(p.promo.precio), 16000); assert.equal(p.promo.precio_manual, true); }
    if (base) { assert.equal(Number(base.precio), 16000); assert.equal(base.precio_manual, true); }
    assert.equal(Number(r.fila.total), r.fila.items.reduce((s, i) => s + Number(i.precio) * i.qty, 0), 'el total es Σ precio × qty');
    const v = fijar('mesero', 'r-o7', 't-ej3', null);
    assert.ok(v.ok, v.error);
    assert.ok(!JSON.stringify(v.fila.items).includes('precio_manual'), 'ni una marca atrapada en ninguna de las promos');
    sql("delete from public.productos where id = 't-pr2';");
  });

  test('tocar el plato en la carta mientras la promo se lo lleva entero a precio a mano: la unidad nueva ADOPTA la marca y el precio a mano (antes volvía a precio de carta, sin marca); y «Volver» con la base presente quita la marca de las dos líneas', () => {
    DIA = 1;
    tresDistintos('r-o10', 100);
    const r = fijar('mesero', 'r-o10', 't-ej3', 15000);
    assert.ok(r.ok, r.error);
    assert.deepEqual(forma(r.fila), [['t-ej1', 1, 23000], ['t-ej2', 1, 19000], ['promo:t-pr3:t-ej3', 1, 12000]]);
    // el POS agrega el producto con su precio de carta (18.000): llega una línea t-ej3 nueva, sin marca, y la promo la despliega
    const o = delta('r-o10', 't-ej3', 'Ejecutivo del día', 18000, 1);
    assert.deepEqual(forma(o), [['t-ej1', 1, 23000], ['t-ej2', 1, 19000], ['t-ej3', 1, 15000], ['promo:t-pr3:t-ej3', 1, 12000]], 'las dos unidades a 15.000 (la 3.ª de la cuenta lleva el 20 %)');
    assert.equal(linea(o, 't-ej3').precio_manual, true, 'la base volvió con la marca');
    assert.equal(linea(o, 't-ej3').precio_por, 'mesero1@resplandor.test');
    assert.equal(linea(o, 'promo:t-pr3:t-ej3').promo.precio_manual, true);
    assert.equal(Number(o.total), 23000 + 19000 + 15000 + 12000);
    // y volver a la carta con la base PRESENTE (le queda una unidad): se va la marca de la base y la que recuerda la línea de promo (si no, se la devolvía)
    const v = fijar('mesero', 'r-o10', 't-ej3', null);
    assert.ok(v.ok, v.error);
    assert.deepEqual(forma(v.fila), [['t-ej1', 1, 23000], ['t-ej2', 1, 19000], ['t-ej3', 1, 18000], ['promo:t-pr3:t-ej3', 1, 14400]]);
    assert.ok(!JSON.stringify(v.fila.items).includes('precio_manual') && !JSON.stringify(v.fila.items).includes('precio_por'), 'ni rastro de la marca');
    sql("update public.ordenes set updated_at = now() where id = 'r-o10';");
    assert.ok(!JSON.stringify(orden('r-o10').items).includes('precio_manual'), 'tocar la cuenta no la devuelve');
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 'r-o10';");
  });

  test('normalizar_items directo: la base con marca propia no la pierde por la de la línea de promo; la sin marca adopta (también con 0); sin la marca de la promo no hay adopción; y es idempotente', () => {
    const promo = (extra) => ({ id: 'promo:t-pr3:t-ej3', nombre: 'Ejecutivo · 3er', precio: 12000, qty: 1, nota: '', promo: { id: 't-pr3', de: 't-ej3', nombre: 'Ejecutivo del día', precio: 15000, descuento: 20, ...extra } });
    const base = (extra) => ({ id: 't-ej3', nombre: 'Ejecutivo del día', precio: 18000, qty: 1, nota: '', ...extra });
    const norma = (items, dia) => pg.filas(`select privado.normalizar_items(${literal(JSON.stringify(items))}::jsonb, ${dia}::smallint) as r`)[0].r;
    // domingo (7): sin promo ese día, la línea de promo vuelve a su base
    const adopta = norma([base(), promo({ precio_manual: true, precio_por: 'a@b.test' })], 7);
    assert.deepEqual(adopta.map((i) => [i.id, i.qty, Number(i.precio), i.precio_manual, i.precio_por]), [['t-ej3', 2, 15000, true, 'a@b.test']]);
    const propia = norma([base({ precio: 16500, precio_manual: true, precio_por: 'c@d.test' }), promo({ precio_manual: true, precio_por: 'a@b.test' })], 7);
    assert.deepEqual(propia.map((i) => [i.id, i.qty, Number(i.precio), i.precio_manual, i.precio_por]), [['t-ej3', 2, 16500, true, 'c@d.test']], 'la marca de la base manda');
    const sinMarca = norma([base(), promo({})], 7);
    assert.deepEqual(sinMarca.map((i) => [i.id, i.qty, Number(i.precio), i.precio_manual]), [['t-ej3', 2, 18000, undefined]], 'sin marca en la promo, la base sigue a la carta');
    const cero = norma([base(), promo({ precio: 0, precio_manual: true })], 7);
    assert.deepEqual(cero.map((i) => [i.id, i.qty, Number(i.precio), i.precio_manual]), [['t-ej3', 2, 0, true]], 'un precio a mano de 0 (cortesía) también se adopta');
    // el lunes (1) la promo se vuelve a armar sobre el precio adoptado, y normalizar dos veces es normalizar una
    const lunes = [base(), { id: 't-ej1', nombre: 'Menú', precio: 23000, qty: 1, nota: '' }, { id: 't-ej2', nombre: 'Seco', precio: 19000, qty: 1, nota: '' }, promo({ precio_manual: true, precio_por: 'a@b.test' })];
    const uno = norma(lunes, 1);
    const dos = norma(uno, 1);
    assert.deepEqual(dos, uno, 'idempotente');
    assert.equal(Number(uno.find((i) => i.id === 'promo:t-pr3:t-ej3').precio), 12000);
    assert.equal(uno.find((i) => i.id === 't-ej3').precio_manual, true);
  });

  test('DECISIÓN PENDIENTE DE YONATAN (no se corrigió): precio_por es la atribución que pone la RPC, pero una escritura directa de un mesero a ordenes.items puede traer precio_manual y un precio_por cualquiera, y el precio vivo la respeta', () => {
    DIA = 3;
    abrir('r-o8', 98);
    delta('r-o8', 't-ej2', 'Seco', 19000, 1);
    const directo = pg.sql(`update public.ordenes set items = '[{"id":"t-ej2","nombre":"Seco","precio":1,"qty":1,"nota":"","precio_manual":true,"precio_por":"admin@resplandor.test"}]'::jsonb where id = 'r-o8';`, como('mesero'));
    assert.ok(directo.ok, directo.error);
    const o = orden('r-o8');
    assert.equal(linea(o, 't-ej2').precio_por, 'admin@resplandor.test', 'la firma que trajo la escritura directa queda (si un día se agrega el guardia, este caso cambia: actualizar el README y la bitácora)');
    assert.equal(Number(linea(o, 't-ej2').precio), 1);
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 'r-o8';");
  });

  test('ninguna de las escrituras de arriba dejó un WARNING (los triggers tragan errores, pero no los hubo)', () => {
    assert.deepEqual(avisos, []);
  });

  test('aplicarla dos veces es inocua: el catálogo queda idéntico y las cuentas no cambian', () => {
    const cuentas = () => pg.filas('select id, items, total, version from public.ordenes order by id');
    const antesCuentas = cuentas();
    const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(otra.length, 1);
    assert.ok(otra[0].ok, otra[0].error);
    assert.deepEqual(otra[0].avisos, [], 'la segunda aplicación no deja WARNING');
    assert.deepEqual(radiografia(pg), despues);
    assert.deepEqual(cuentas(), antesCuentas);
  });

  test('la reversa: volver a pegar 20261006110000 deja el catálogo como ANTES (la RPC sin la base dentro de la promo: «no existe» P0001); reaplicar la mía lo deja como después y la promo entera vuelve a funcionar', () => {
    DIA = 1;
    tresDistintos('r-o9', 99);
    const r = pg.sql(reversa(SQL).replace(/^--.*$/gm, ''), { como: 'migrador' });
    assert.ok(r.ok, 'la reversa falló: ' + r.error);
    const previa = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: PREVIA, hasta: PREVIA });
    assert.ok(previa[0].ok, previa[0].error);
    assert.deepEqual(previa[0].avisos, []);
    const ahora = radiografia(pg);
    for (const [seccion, filas] of Object.entries(antes)) assert.deepEqual(ahora[seccion], filas, `tras la reversa quedó distinto: ${seccion}`);
    const vieja = fijar('mesero', 'r-o9', 't-ej3', 15000);
    assert.equal(vieja.ok, false);
    assert.match(vieja.error, /P0001: la línea t-ej3 no existe en la orden r-o9/, 'con la RPC de antes, la base absorbida no se puede editar');
    const reaplicada = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.ok(reaplicada[0].ok, 'no se pudo volver a aplicar tras la reversa: ' + reaplicada[0].error);
    assert.deepEqual(reaplicada[0].avisos, []);
    assert.deepEqual(radiografia(pg), despues, 'reaplicar tras la reversa deja el catálogo como la primera vez');
    const nueva = fijar('mesero', 'r-o9', 't-ej3', 15000);
    assert.ok(nueva.ok, nueva.error);
    assert.equal(Number(linea(nueva.fila, 'promo:t-pr3:t-ej3').precio), 12000);
  });
});

describe('se niega a correr, sin cambiar nada, si falta 20261006110000 (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('sin 20261006110000: error claro y NADA creado; con 20261006110000 puesta, se aplica sin avisos', () => {
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: PREVIA });
    assert.ok(previas.length >= 14 && previas.every((m) => m.ok), JSON.stringify(previas.filter((m) => !m.ok)));
    const a0 = radiografia(pg);
    const sinPrecioAMano = pg.sql(SQL, { como: 'migrador' });
    assert.equal(sinPrecioAMano.ok, false);
    assert.match(sinPrecioAMano.error, /Falta 20261006110000_precio_a_mano\.sql.*No se cambió nada/s);
    assert.deepEqual(radiografia(pg), a0, 'sin el precio a mano: no dejó nada creado');
    assert.equal(pg.filas("select to_regprocedure('public.fijar_precio_item(text, text, numeric)') is null as n")[0].n, true);
    const intermedias = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: PREVIA, antesDe: MIGRACION });
    assert.ok(intermedias.every((m) => m.ok), JSON.stringify(intermedias.filter((m) => !m.ok)));
    const bien = pg.sql(SQL, { como: 'migrador' });
    assert.ok(bien.ok, bien.error);
    assert.deepEqual(bien.avisos, []);
  });
});
