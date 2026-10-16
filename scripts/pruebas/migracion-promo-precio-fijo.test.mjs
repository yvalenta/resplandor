// Promociones de PRECIO FIJO: supabase/migrations/20261006170000_promo_precio_fijo.sql y el sobre docs/sobres/2026-10-06-promo-precio-fijo.sql
// (pedido de Yonatan, 2026-10-06, tareas/2026-10-06-promo-precio-fijo.md: «si agrego 2 hamburguesas resplandor no hace el descuento cuando se adiciona y queda el precio
// normal 60»: «Combo hamburguesas», 2 Hamburguesa Resplandor por $ 50.000, se aplica solo en la cuenta, como ya lo hacen las promos de descuento).
//
// Qué cambia: dos `create or replace function` y el comentario de `productos.promo_regla`:
//   · privado.promo_regla_ok acepta { cada, precio, aplica } (precio entero de 1 a 10.000.000) y exige EXACTAMENTE uno de descuento / precio;
//   · privado.normalizar_items (el cuerpo de la unión 20261006140000) calcula el precio fijo del grupo: la unidad más barata de cada grupo de N queda en
//     max(0, X − Σ de las otras N−1 unidades), nunca más que su precio de lista y solo si el grupo costaba más que X; el precio a mano entra en la suma.
//   Nada de tablas, datos, policies ni triggers; public.fijar_precio_item NO cambia (lo que escribe en una línea de promo lo recalcula el trigger del precio vivo).
// Ronda 2 (refutación de 709f270): (a) el producto de una promo con regla vale 0 como línea (una tablet con el POS de antes que lo agregue no cobra dos veces); (b) la migración es UNA
//   transacción y aborta sin cambiar nada si una promo_regla existente no pasa el validador nuevo (id y nombre en el mensaje); (c) normalizar_items salta una regla que no puede leer.
//
// Tres partes:
//   1. ESTÁTICA (corre siempre, también en CI): va ÚLTIMA de la cadena, con prefijo único (NO 20261006140000, que ya es la unión); la cabecera dice qué hace, quién lo ve,
//      qué necesita, por qué este nombre y esta base, la reversa y que la aplica Yonatan; se niega a correr sin cambiar nada si falta lo previo; el cuerpo de
//      normalizar_items es el de 20261006140000 con SOLO el bloque declarado (diff línea por línea) y promo_regla_ok el de 20261005100000 con SOLO lo declarado;
//      no toca nada más; el sobre es una transacción que aborta si no encuentra exactamente una fila de cada nombre.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker): la cadena completa con la migración puesta: 2 hamburguesas a 30.000 → 50.000 con una línea de promo de 20.000, 3 → 80.000,
//      4 → 100.000; un día distinto al de la promo → 60.000; el precio a mano dentro del grupo (también con la base absorbida por la promo, con la RPC fijar_precio_item); X menor que la suma → 0
//      sin negativos y un grupo que ya costaba X o menos no genera promo; el promedio redondeado de las líneas con grupos de distinto costo; idempotencia de dos pasadas; el CHECK
//      (los dos a la vez, ninguno, precio 0 o pasado de tope, escribiendo como un admin de verdad); las promos de descuento no cambian; el cobro por partes sigue rechazando la cuenta
//      con promo; la migración dos veces, MUTANTES que el cuadro de escenarios tiene que matar, y la reversa; la negativa sin 20261006130000 / 20261006140000; y el sobre contra un catálogo con
//      los dos nombres (la regla queda, la cuenta abierta se re-normaliza, idempotente, aborta sin tocar nada si un nombre falta o se repite o si falta la migración).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa } from './_cola-impresion-pg.mjs';

const MIGRACION = '20261006170000_promo_precio_fijo.sql';
const UNION = '20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql';
const LAPIDA = '20261006150000_lapida_de_cuentas_borradas.sql';
const SERVIDA = '20261006160000_servida.sql';
const PRECIO_VIVO = '20261005100000_precio_vivo_y_promos.sql';
const PERMISO = '20261005120000_promo_regla_ejecutable.sql';
const PRECIO_A_MANO_2 = '20261006130000_precio_a_mano_promo_entera.sql';
const SOBRE = 'docs/sobres/2026-10-06-promo-precio-fijo.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${MIGRACION}`);
const SQL_UNION = leer(`supabase/migrations/${UNION}`);
const SQL_PRECIO_VIVO = leer(`supabase/migrations/${PRECIO_VIVO}`);
const SQL_SOBRE = leer(SOBRE);
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CODIGO = sinComentarios(SQL);
const CP = compacto(CODIGO);
const CABECERA = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos'));
const CAB = compacto(CABECERA.replace(/^--\s?/gm, ''));

/** Las líneas (sin comentarios ni espacios) de `create or replace function <nombre> … end $$;` de una migración. */
function funcionDe(sql, nombre) {
  const c = sinComentarios(sql);
  const a = c.indexOf(`create or replace function ${nombre}(`);
  const b = c.indexOf('end $$;', a) + 'end $$;'.length;
  assert.ok(a >= 0 && b > a, `no encuentro ${nombre}`);
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

test('va ÚLTIMA de la cadena, con prefijo único: NO se llama 20261006140000 (ese prefijo ya es la unión de normalizar_items) y va detrás de la lápida y de «servida»', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.deepEqual(nombres.slice(-4), [UNION, LAPIDA, SERVIDA, MIGRACION], 'la última de la cadena');
  assert.ok(!nombres.includes('20261006140000_promo_precio_fijo.sql'), 'el nombre que se pensó al principio chocaría con la unión');
  for (const previa of [PRECIO_VIVO, PERMISO, PRECIO_A_MANO_2, UNION]) assert.ok(nombres.includes(previa) && previa < MIGRACION, `${previa} tiene que ir antes`);
  assert.doesNotMatch(SQL, /[A-Za-z0-9._%+-]+@(?!zz)[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ni un correo (el repo es público)');
});

test('la cabecera dice qué hace, quién lo ve y lo cambia, qué necesita, por qué este nombre y esta base, lo que NO cambia (fijar_precio_item), el orden de salida y la reversa; lo aplica Yonatan: aparca', () => {
  for (const frase of [
    'QUÉ HACE', 'QUIÉN LO VE Y QUIÉN LO CAMBIA', 'Necesita', 'Idempotente', 'REVERSA (menos de 1 minuto', 'lo aplica Yonatan: aparca', 'Orden de salida al aire',
    'POR QUÉ ESTE NOMBRE Y ESTA BASE', '20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql', 'la versión VIGENTE de `normalizar_items` es la de esa unión', 'va como 20261006170000',
    'public.fijar_precio_item', 'LO QUE NO CAMBIA, A PROPÓSITO', 'trg_ordenes_a_precio_vivo',
    '{ "cada": 2, "precio": 50000, "aplica": { "productos": ["<id>"] } }', 'EXACTAMENTE UNO de `descuento` o `precio`', 'ENTERO de 1 a 10.000.000', 'max(0, X − Σ precio de las otras N−1 unidades del grupo)',
    '2 unidades → 1 × 30.000 + promo 1 × 20.000 = 50.000;   3 → 80.000;   4 → dos grupos, 100.000', 'la unidad de promo queda en 0', 'un combo nunca sube una cuenta', 'PROMEDIO redondeado a peso',
    'el cuerpo vigente (el de 20261006140000', 'la adopción del precio a mano del paso a\'', 'productos_tocan_cuentas', 'docs/sobres/2026-10-06-promo-precio-fijo.sql',
    'si falta alguna, se niega a correr SIN cambiar nada', 'va ÚLTIMA de las que redefinen `normalizar_items` y `promo_regla_ok`', 'ÚNICA función de `privado` que `authenticated`',
    // ronda 2
    'TODO en una sola transacción (`begin` … `commit`)', 'REVISA LAS FILAS QUE YA EXISTEN', 'lista id y nombre de cada una y dice cómo arreglarla', 'NEUTRALIZA el producto de la promo con regla (paso b)',
    'salvo que la línea lleve `precio_manual`', 'una cuenta sin líneas de productos-promo sale byte a byte igual que antes', 'Una regla que NO se puede leer se salta',
    'hasta k/2 pesos (k = los grupos de ESA línea', 'cada par se REGALA sin aviso (2 hamburguesas 30.000, 4 → 60.000', 'la reversa correcta de esta migración es la de abajo, que empieza por poner la regla del combo en null',
    'recargar TODAS las tablets y comprobar, en el pie de cada una, que muestran la versión nueva (la misma que version.json publica al aire)', 'editar el combo desde esa tablet —aunque sea solo la etiqueta— sube `promo_regla: null` y BORRA la regla',
    'cambia SOLO en el paso b (UNA línea) y en el paso c',
  ]) assert.ok(CAB.includes(compacto(frase)), `la cabecera no dice «${frase}»`);
  assert.doesNotMatch(CAB, /menos de N pesos|deja de cumplirse/, 'el error del promedio es de hasta k/2 pesos y volver a pegar una anterior REGALA la unidad: ya no se dice lo de antes');
  // el orden de salida: migración, push del POS, recargar las tablets, y recién entonces el sobre
  const orden = CAB.slice(CAB.indexOf('Orden de salida al aire, en este orden'));
  const posiciones = ['1) esta migración', '2) el push del POS', '3) recargar TODAS las tablets', '4) recién entonces el sobre de datos'].map((f) => orden.indexOf(f));
  assert.ok(posiciones.every((x) => x >= 0) && posiciones.every((x, i) => i === 0 || x > posiciones[i - 1]), `el orden de salida no es 1, 2, 3, 4: ${posiciones}`);
});

test('es UNA transacción (begin … commit) y revisa las filas que ya existen DESPUÉS de poner el validador nuevo y ANTES de lo demás: aborta, con id y nombre y cómo arreglarlo, si alguna promo_regla no pasa', () => {
  assert.match(CP, /^begin; do \$\$/, 'abre la transacción antes de todo (con los requisitos)');
  assert.match(CP, /commit;$/, 'y la cierra al final');
  assert.equal((CP.match(/\bbegin;/g) || []).length, 1, 'una sola transacción');
  assert.equal((CP.match(/\bcommit;/g) || []).length, 1);
  const iValidador = CP.indexOf('create or replace function privado.promo_regla_ok(');
  const iRevision = CP.indexOf('not privado.promo_regla_ok(p.promo_regla)');
  const iNormalizar = CP.indexOf('create or replace function privado.normalizar_items(');
  assert.ok(iValidador > 0 && iRevision > iValidador && iNormalizar > iRevision, 'validador nuevo → revisión de las filas → normalizar_items');
  const bloque = CP.slice(CP.lastIndexOf('do $$', iRevision), CP.indexOf('end $$;', iRevision) + 7);
  assert.match(bloque, /from public\.productos p where p\.promo_regla is not null and not privado\.promo_regla_ok\(p\.promo_regla\)/);
  assert.match(bloque, /string_agg\(format\('%s \(«%s», regla %s\)', p\.id, p\.nombre, left\(p\.promo_regla::text, 160\)\)/, 'lista id, nombre y la regla');
  assert.match(bloque, /Arréglalas ANTES de aplicar esta migración \(desde Productos, o con update public\.productos set promo_regla = /, 'dice cómo arreglarlo');
  assert.match(bloque, /\{ "cada": 2 a 10, "descuento": 1 a 100, "aplica": \{\.\.\.\} \} o \{ "cada": 2 a 10, "precio": 1 a 10000000, "aplica": \{\.\.\.\} \}/, 'y cuál es la forma de la regla');
  assert.match(bloque, /No se cambió nada\./);
  assert.match(bloque, /raise exception/);
});

test('se niega a correr, sin cambiar nada, si falta lo previo (el validador y normalizar, 20261006130000 o la unión 20261006140000), y lo comprueba ANTES de crear nada', () => {
  const requisitos = CODIGO.slice(0, CODIGO.indexOf('create or replace function'));
  assert.match(requisitos, /to_regprocedure\('privado\.promo_regla_ok\(jsonb\)'\) is null or to_regprocedure\('privado\.normalizar_items\(jsonb, smallint\)'\) is null[\s\S]*Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /position\('v_enpromo' in pg_get_functiondef\('public\.fijar_precio_item\(text, text, numeric\)'::regprocedure\)\) = 0[\s\S]*Falta 20261006130000_precio_a_mano_promo_entera\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /position\('precio_manual' in pg_get_functiondef\('privado\.normalizar_items\(jsonb, smallint\)'::regprocedure\)\) = 0[\s\S]*position\('\^promo:\[\^:\]\*:\(\.\+\)' in pg_get_functiondef\('privado\.normalizar_items\(jsonb, smallint\)'::regprocedure\)\) = 0[\s\S]*Falta 20261006140000_normalizar_items_pliegue_y_precio_a_mano\.sql[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bgrant\b|\binsert\b|\bupdate\b/i);
});

test('normalizar_items es el de 20261006140000 (la unión) con SOLO lo declarado: el producto de la promo con regla vale 0 (paso b, UNA línea), la regla ilegible se salta, y el bloque del precio fijo (v_fijo y v_pre, la CTE de los grupos con el precio de cada unidad, el precio de la línea de promo y su objeto promo)', () => {
  const { quitadas, agregadas } = diferencia(funcionDe(SQL_UNION, 'privado.normalizar_items'), funcionDe(SQL, 'privado.normalizar_items'));
  assert.deepEqual(quitadas, [
    'select p.precio into v_precio from public.productos p where p.id = v_pid and p.precio is not null and p.precio >= 0;',
    'select q.i, row_number() over (order by q.precio desc, q.i) as rn',
    'select u.i, count(*)::int as n from u where u.rn % v_cada = 0 group by u.i',
    "select coalesce(array_agg(d.i order by d.i), '{}'), coalesce(array_agg(d.n order by d.i), '{}')",
    'into v_idx, v_cant',
    "v_precio := round(coalesce(nullif(v_base ->> 'precio', '')::numeric, 0) * (100 - v_desc) / 100.0);",
    "'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0), 'descuento', v_desc)",
  ], 'qué dejó de estar');
  assert.deepEqual(agregadas, [
    'v_fijo numeric;',
    'v_pre numeric[];',
    'select case when p.promo_regla is not null then 0 else p.precio end into v_precio from public.productos p where p.id = v_pid and p.precio is not null and p.precio >= 0;',
    'if not privado.promo_regla_ok(v_promo.regla) then continue; end if;',
    "v_fijo := (v_promo.regla ->> 'precio')::numeric;",
    'select q.i, q.precio, row_number() over (order by q.precio desc, q.i) as rn',
    '), gr as (',
    'select u.i, u.precio, u.rn, sum(u.precio) over (partition by (u.rn - 1) / v_cada) as total',
    'from u',
    'select gr.i, count(*)::int as n,',
    'round(avg(gr.precio - least(gr.precio, greatest(0, gr.total - v_fijo))))::numeric as precio_unidad',
    'from gr',
    'where gr.rn % v_cada = 0 and (v_fijo is null or gr.total > v_fijo)',
    'group by gr.i',
    "select coalesce(array_agg(d.i order by d.i), '{}'), coalesce(array_agg(d.n order by d.i), '{}'), coalesce(array_agg(d.precio_unidad order by d.i), '{}')",
    'into v_idx, v_cant, v_pre',
    'v_precio := case when v_fijo is null',
    "then round(coalesce(nullif(v_base ->> 'precio', '')::numeric, 0) * (100 - v_desc) / 100.0)",
    'else v_pre[v_i] end;',
    "'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0))",
    "|| case when v_fijo is null then jsonb_build_object('descuento', v_desc) else jsonb_build_object('precio_fijo', v_fijo) end",
  ], 'qué se agregó');
  const cp = compacto(funcionDe(SQL, 'privado.normalizar_items').join('\n'));
  // lo que NO se tocó: el pliegue, la adopción del paso a', el respeto del precio a mano (paso b) y la salida
  for (const intacto of [
    "substring(coalesce(v_item ->> 'id', '') from '^promo:[^:]*:(.+)$')",
    "if v_lineas[v_i] ->> 'precio_manual' is distinct from 'true'",
    "if v_item ->> 'precio_manual' = 'true' then continue; end if;",
    "then jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_base ->> 'precio_por'))",
  ]) assert.ok(cp.includes(intacto), `ya no está: ${intacto}`);
  // la neutralización va en el paso b DESPUÉS de saltar las líneas con precio a mano (se respetan), y el salto de la regla ilegible es lo primero del recorrido de las promos, antes de leer nada de ella
  assert.ok(cp.indexOf("if v_item ->> 'precio_manual' = 'true' then continue; end if;") < cp.indexOf('select case when p.promo_regla is not null then 0 else p.precio end into v_precio'), 'el precio a mano se salta ANTES de neutralizar');
  assert.ok(cp.includes("loop if not privado.promo_regla_ok(v_promo.regla) then continue; end if; v_cada := (v_promo.regla ->> 'cada')::int;"), 'la regla ilegible se salta antes de leer `cada`');
  assert.match(cp, /^create or replace function privado\.normalizar_items\(p_items jsonb, p_dia smallint\) returns jsonb language plpgsql stable set search_path = '' as \$\$/, 'mismo contrato: estable, search_path vacío, sin security definer');
  assert.doesNotMatch(cp, /\b(update|insert into|delete from|truncate)\b/, 'sigue sin escribir nada: solo lee productos');
  assert.match(CP, /revoke all on function privado\.normalizar_items\(jsonb, smallint\) from public, anon, authenticated;/, 'y sigue sin EXECUTE para anon ni authenticated');
});

test('promo_regla_ok es la de 20261005100000 con SOLO lo del precio: cada se mira sin el hueco del NULL, exactamente uno de descuento / precio, y precio entero de 1 a 10.000.000; todo lo demás igual; nunca lanza', () => {
  const { quitadas, agregadas } = diferencia(funcionDe(SQL_PRECIO_VIVO, 'privado.promo_regla_ok'), funcionDe(SQL, 'privado.promo_regla_ok'));
  assert.deepEqual(quitadas, [
    "if (p_regla ->> 'cada') !~ '^[0-9]{1,3}$' or (p_regla ->> 'descuento') !~ '^[0-9]{1,3}$' then return false; end if;",
    'if v_cada < 2 or v_cada > 10 or v_desc < 1 or v_desc > 100 then return false; end if;',
  ]);
  assert.deepEqual(agregadas, [
    'v_precio bigint;',
    "if not coalesce((p_regla ->> 'cada') ~ '^[0-9]{1,3}$', false) then return false; end if;",
    'if v_cada < 2 or v_cada > 10 then return false; end if;',
    "if (p_regla ? 'descuento') = (p_regla ? 'precio') then return false; end if;",
    "if p_regla ? 'descuento' then",
    "if not coalesce((p_regla ->> 'descuento') ~ '^[0-9]{1,3}$', false) then return false; end if;",
    'if v_desc < 1 or v_desc > 100 then return false; end if;',
    'else',
    "if not coalesce((p_regla ->> 'precio') ~ '^[0-9]{1,8}$', false) then return false; end if;",
    "v_precio := (p_regla ->> 'precio')::bigint;",
    'if v_precio < 1 or v_precio > 10000000 then return false; end if;',
    'end if;',
  ]);
  const cp = compacto(funcionDe(SQL, 'privado.promo_regla_ok').join('\n'));
  assert.match(cp, /^create or replace function privado\.promo_regla_ok\(p_regla jsonb\) returns boolean language plpgsql immutable set search_path = '' as \$\$/);
  assert.match(cp, /exception when others then return false; end \$\$;$/, 'nunca lanza: un CHECK no puede lanzar');
});

test('no toca nada más: DOS create or replace function (promo_regla_ok y normalizar_items; fijar_precio_item y el resto no), un solo GRANT (el validador para authenticated y service_role) y el comentario de la columna; ni tablas, policies, triggers ni datos', () => {
  assert.deepEqual([...CP.matchAll(/create or replace function ([a-z_.]+)\(/g)].map((m) => m[1]), ['privado.promo_regla_ok', 'privado.normalizar_items']);
  assert.equal((CP.match(/\bgrant\b/g) || []).length, 1);
  assert.match(CP, /revoke all on function privado\.promo_regla_ok\(jsonb\) from public, anon; grant execute on function privado\.promo_regla_ok\(jsonb\) to authenticated, service_role;/, 'el validador sigue siendo ejecutable por authenticated (el CHECK corre con su rol: 20261005120000)');
  assert.doesNotMatch(CP, /revoke all on function privado\.promo_regla_ok\(jsonb\) from [^;]*authenticated/, 'y NO se le quita');
  assert.equal((CP.match(/comment on column public\.productos\.promo_regla is/g) || []).length, 1);
  assert.doesNotMatch(CP, /create or replace function public\./, 'la RPC del precio a mano (public.fijar_precio_item) y deshacer_cobro_sumar no se tocan');
  assert.doesNotMatch(CP, /(create|drop|alter) (policy|table|trigger|view|index)|enable row level security|publication|add column|\bdrop\b/i);
  const sinCuerpos = CP.replace(/\$\$.*?\$\$/g, ' $$…$$ ');
  assert.doesNotMatch(sinCuerpos, /\bupdate\s+(public|privado)\.|\binsert into\b|\bdelete from\b|\btruncate\b/i, 'ningún dato escrito fuera de las funciones');
});

test('la reversa de la cabecera: la regla del combo vuelve a null, el validador a la forma de antes (el mismo cuerpo de 20261005100000, línea por línea) con sus permisos y su comentario; y manda volver a pegar la unión ENTERA', () => {
  const rev = reversa(SQL).replace(/^--.*$/gm, '');
  const c = compacto(rev);
  assert.match(c, /^begin; update public\.productos set promo_regla = null where promo_regla \? 'precio'; create or replace function privado\.promo_regla_ok\(p_regla jsonb\)/);
  assert.match(c, /commit;$/);
  // el cuerpo del validador del bloque es EXACTAMENTE el de 20261005100000
  const lineas = rev.split('\n').map((l) => l.trim()).filter(Boolean);
  const a = lineas.findIndex((l) => l.startsWith('create or replace function privado.promo_regla_ok'));
  const b = lineas.findIndex((l, i) => i > a && l.startsWith('end $f$;'));
  const cuerpoReversa = lineas.slice(a, b + 1).join('\n').replace('as $f$', () => 'as $$').replace('end $f$;', () => 'end $$;');
  const cuerpoViejo = funcionDe(SQL_PRECIO_VIVO, 'privado.promo_regla_ok').join('\n').replace(/\n(returns boolean)/, '\n$1');
  assert.equal(compacto(cuerpoReversa), compacto(cuerpoViejo), 'la reversa trae el validador de 20261005100000 tal cual');
  assert.match(c, /revoke all on function privado\.promo_regla_ok\(jsonb\) from public, anon; grant execute on function privado\.promo_regla_ok\(jsonb\) to authenticated, service_role;/);
  assert.match(c, /comment on column public\.productos\.promo_regla is 'Regla de una promoción de descuento \(solo filas de la categoría Promociones\)/);
  assert.match(CAB, /volver a pegar 20261006140000_normalizar_items_pliegue_y_precio_a_mano\.sql ENTERA/);
});

test('la comprobación final mira las dos formas buenas y las malas del validador (los dos a la vez, ninguno, 0, pasado de tope, decimal, texto, null), que normalizar_items conserve el pliegue, el precio a mano y el precio fijo, y los permisos de las dos funciones', () => {
  const fin = CODIGO.slice(CODIGO.lastIndexOf('do $$'));
  for (const regla of [
    '{"cada":2,"precio":50000,"aplica":{"productos":["zz"]}}', '{"cada":2,"descuento":20,"precio":50000,"aplica":{"productos":["zz"]}}', '{"cada":2,"aplica":{"productos":["zz"]}}',
    '{"cada":2,"precio":0,"aplica":{"productos":["zz"]}}', '{"cada":2,"precio":10000001,"aplica":{"productos":["zz"]}}', '{"cada":2,"precio":1.5,"aplica":{"productos":["zz"]}}',
    '{"cada":2,"precio":"mucho","aplica":{"productos":["zz"]}}', '{"cada":2,"precio":null,"aplica":{"productos":["zz"]}}',
  ]) assert.ok(fin.includes(regla), `la comprobación no prueba ${regla}`);
  assert.match(fin, /position\('precio_fijo' in v\) = 0 or position\('precio_manual' in v\) = 0 or position\('\^promo:\[\^:\]\*:\(\.\+\)' in v\) = 0/);
  assert.match(fin, /position\('when p\.promo_regla is not null then 0' in v\) = 0 or position\('not privado\.promo_regla_ok\(v_promo\.regla\)' in v\) = 0/, 'y que conserva la neutralización y el salto de la regla ilegible');
  assert.match(fin, /has_function_privilege\('authenticated', 'privado\.normalizar_items\(jsonb,smallint\)', 'execute'\)/);
  assert.match(fin, /not has_function_privilege\('authenticated', 'privado\.promo_regla_ok\(jsonb\)', 'execute'\) or not has_function_privilege\('service_role'/);
});

test('el sobre es UNA transacción: comprueba la migración y que cada nombre exista UNA vez (aborta sin escribir), pone {cada 2, precio 50000, la hamburguesa} al combo, lo comprueba, y trae su reversa y lo que pasa al correrlo', () => {
  const c = compacto(sinComentarios(SQL_SOBRE));
  assert.match(c, /^begin; do \$\$/);
  assert.match(c, /commit;$/);
  assert.equal((c.match(/do \$\$/g) || []).length, 2, 'una comprobación antes y una después');
  assert.match(c, /position\('precio_fijo' in pg_get_functiondef\('privado\.normalizar_items\(jsonb, smallint\)'::regprocedure\)\) = 0[\s\S]*Falta aplicar supabase\/migrations\/20261006170000_promo_precio_fijo\.sql[\s\S]*No se aplicó nada/);
  assert.match(c, /\('Promociones', 'Combo hamburguesas'\), \('Platos Fuertes', 'Hamburguesa Resplandor'\)[\s\S]*n\.hay <> 1[\s\S]*raise exception 'Falta o está repetido un producto que la regla nombra: %[\s\S]*No se aplicó nada/);
  assert.match(c, /update public\.productos c set precio = 50000, promo_regla = jsonb_build_object\( 'cada', 2, 'precio', 50000, 'aplica', jsonb_build_object\('productos', jsonb_build_array\(\( select h\.id from public\.productos h where h\.categoria = 'Platos Fuertes' and h\.nombre = 'Hamburguesa Resplandor'\)\)\)\) where c\.categoria = 'Promociones' and c\.nombre = 'Combo hamburguesas';/);
  assert.equal((c.match(/\bupdate public\./g) || []).length, 1, 'una sola escritura: la regla del combo');
  assert.ok(c.indexOf('update public.productos') > c.indexOf('n.hay <> 1'), 'la comprobación va ANTES de escribir');
  assert.doesNotMatch(c, /\binsert\b|\bdelete\b|\bdrop\b|\balter\b|\bgrant\b/i);
  const cab = compacto(SQL_SOBRE.split('\nbegin;')[0].replace(/^--\s?/gm, ''));
  for (const frase of [
    'Lo pega Yonatan en Supabase → SQL Editor (Línea Roja: aparca)', '"cada": 2, "precio": 50000', 'productos_tocan_cuentas', 'RE-NORMALIZA',
    'agregado A MANO', 'Idempotente', 'UNA transacción', 'Reversa (menos de 1 minuto', "update public.productos set promo_regla = null where categoria = 'Promociones' and nombre = 'Combo hamburguesas';",
    'Dupleta de papas', 'mezcla productos',
    // ronda 2: el orden de salida, el único precio y lo que hace la base con el producto del combo
    '1) supabase/migrations/20261006170000_promo_precio_fijo.sql (DESPUÉS de aplicar esa migración', '2) el push del POS',
    '3) recargar TODAS las tablets y comprobar, en el pie de cada una, que muestran la versión nueva (la misma que version.json publica al aire)', '4) recién entonces, este sobre',
    'sube `promo_regla: null` y BORRA la regla', 'Eso último no tiene arreglo en la base', 'UN solo precio', '`precio = 50000`', 'la base neutraliza el producto de una promo con regla', 'una línea de $ 0',
  ]) assert.ok(cab.includes(compacto(frase)), `el sobre no dice «${frase}»`);
  assert.doesNotMatch(cab, /el POS ya no lo ofrece|hay que quitárselo|cobraría el combo dos veces/, 'ya no dice que el POS de antes no ofrece el combo ni que la línea agregada a mano se cobra dos veces');
  assert.match(c, /v_precio is distinct from 50000/, 'y la comprobación final mira también el precio');
  assert.doesNotMatch(SQL_SOBRE, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ni un correo (el repo es público)');
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

/** Los cuerpos (md5) de las dos funciones que esta migración redefine, y el comentario de la columna: lo que tiene que volver idéntico tras una reversa. */
const cuerpos = (pg) => pg.filas(`select p.proname, md5(p.prosrc) as m from pg_proc p where p.pronamespace = 'privado'::regnamespace and p.proname in ('normalizar_items', 'promo_regla_ok') order by 1`);
const comentario = (pg) => pg.filas("select col_description('public.productos'::regclass, (select attnum from pg_attribute where attrelid = 'public.productos'::regclass and attname = 'promo_regla')) as c")[0].c;

describe('contra un Postgres 17 desechable (Supabase simulado, cadena completa de migraciones)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  let despues;
  let cuerposAntes;
  let comentarioAntes;
  const avisos = [];
  let DIA = 2;
  const sql = (texto, opciones) => {
    const r = pg.sql(`set resplandor.dia_promo = ${DIA};\n` + texto, opciones);
    for (const a of r.avisos) avisos.push(`${a}  ←  ${compacto(texto).slice(0, 90)}`);
    assert.ok(r.ok, r.error);
    return r;
  };
  const ultimoJson = (salida) => JSON.parse(String(salida).trim().split('\n').pop());
  const orden = (id) => pg.filas(`select items, total, version, estado from public.ordenes where id = ${literal(id)}`)[0];
  const linea = (o, id) => o.items.find((i) => i.id === id);
  const forma = (o) => o.items.map((i) => [i.id, i.qty, Number(i.precio)]);
  const claims = (clave) => {
    const g = pg.filas(`select id, email, provider from t.gente where clave = ${literal(clave)}`)[0];
    return { sub: g.id, role: 'authenticated', email: g.email, app_metadata: { provider: g.provider } };
  };
  const como = (clave) => ({ como: 'authenticated', claims: claims(clave) });
  /** Una consulta como esa persona, con el día de la promo fijado y los errores con su SQLSTATE: { ok, filas, error }. */
  const llamar = (clave, consulta) => {
    const r = pg.sql(`set resplandor.dia_promo = ${DIA};\n\\set VERBOSITY verbose\nselect coalesce(json_agg(to_jsonb(t)), '[]'::json) from (${consulta}) t`, como(clave));
    for (const a of r.avisos) avisos.push(`${a}  ←  ${compacto(consulta).slice(0, 90)}`);
    return { ok: r.ok, filas: r.ok ? ultimoJson(r.salida) : null, error: r.error };
  };
  const delta = (id, producto, nombre, precio, n, nota = '') => {
    const r = llamar('mesero', `select items, total, version from public.aplicar_delta_orden(${literal(id)}, ${literal(producto)}, ${literal(nombre)}, ${precio}, ${n}, ${literal(nota)})`);
    assert.ok(r.ok, r.error);
    return r.filas[0];
  };
  const fijar = (clave, id, item, precio) => llamar(clave, `select items, total, version from public.fijar_precio_item(${literal(id)}, ${literal(item)}, ${precio === null ? 'null' : precio})`);
  let mesa = 90;
  const abrir = (id) => { mesa += 1; sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', '[]', 0, now());`); return id; };
  const HAM = (n) => delta(CUENTA, 't-ham', 'Hamburguesa Resplandor', 30000, n);
  let CUENTA;
  const norma = (items, dia) => pg.filas(`select privado.normalizar_items(${literal(JSON.stringify(items))}::jsonb, ${dia}::smallint) as r`)[0].r;
  const ham = (qty, extra = {}) => ({ id: 't-ham', nombre: 'Hamburguesa Resplandor', precio: 30000, qty, nota: '', ...extra });

  /**
   * El cuadro de escenarios que cualquier mutante de la migración tiene que romper: funciones puras (`normalizar_items`, `promo_regla_ok`) contra el catálogo de la base de prueba.
   * Devuelve los nombres de lo que falló ([] = todo bien).
   */
  const chequeo = () => {
    const mal = [];
    const sea = (nombre, cond) => { if (!cond) mal.push(nombre); };
    try {
      const dos = norma([ham(2)], 2);
      sea('2 hamburguesas: base 30.000 + promo 20.000', JSON.stringify(forma({ items: dos })) === JSON.stringify([['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000]]));
      const cuatro = norma([ham(4)], 2);
      sea('4 hamburguesas: dos grupos, 100.000', cuatro.reduce((s, i) => s + i.precio * i.qty, 0) === 100000);
      const tres = norma([ham(3)], 2);
      sea('3 hamburguesas: 80.000', tres.reduce((s, i) => s + i.precio * i.qty, 0) === 80000);
      const otroDia = norma([ham(2)], 3);
      sea('otro día: sin promo', otroDia.length === 1 && otroDia[0].qty === 2);
      // X menor que la suma de las otras: 0, nunca negativo (la hamburguesa a 60.000: los dos suman 120.000 y el combo cuesta 50.000)
      const cero = norma([ham(2, { precio_manual: true, precio: 60000 })], 2);
      sea('X menor que lo que cuestan las otras: la unidad de promo queda en 0, sin negativos', cero.every((i) => i.precio >= 0) && cero.some((i) => i.id === 'promo:t-combo:t-ham' && Number(i.precio) === 0));
      // un grupo que ya costaba X o menos NO genera promo (la hamburguesa a mano a 20.000: 40.000 < 50.000)
      const baratas = norma([ham(2, { precio_manual: true, precio: 20000 })], 2);
      sea('un combo nunca sube la cuenta: sin línea de promo si el grupo ya costaba menos de X', baratas.length === 1 && baratas[0].qty === 2 && Number(baratas[0].precio) === 20000);
      // el producto de la promo con regla vale 0 como línea (una tablet con el POS de antes que lo agrega): 2 hamburguesas + el combo = 50.000, no 100.000; otro día 60.000; a mano conserva su precio
      const combo = (extra = {}) => ({ id: 't-combo', nombre: 'Combo hamburguesas', precio: 50000, qty: 1, nota: '', ...extra });
      const suma = (xs) => xs.reduce((a, i) => a + i.precio * i.qty, 0);
      const doble = norma([ham(2), combo()], 2);
      sea('el producto del combo vale 0 como línea: 2 hamburguesas + el combo = 50.000, no 100.000', suma(doble) === 50000 && Number(doble.find((i) => i.id === 't-combo').precio) === 0);
      sea('el producto del combo vale 0 también otro día: 60.000', suma(norma([ham(2), combo()], 3)) === 60000);
      sea('el producto del combo con precio a mano conserva su precio', suma(norma([ham(2), combo({ precio: 40000, precio_manual: true })], 2)) === 90000);
      const okForma = (r) => pg.filas(`select privado.promo_regla_ok(${literal(JSON.stringify(r))}::jsonb) as ok`)[0].ok;
      sea('validador: {cada, precio, aplica} vale', okForma({ cada: 2, precio: 50000, aplica: { productos: ['x'] } }));
      sea('validador: los dos a la vez no', !okForma({ cada: 2, descuento: 20, precio: 50000, aplica: { productos: ['x'] } }));
      sea('validador: ninguno no', !okForma({ cada: 2, aplica: { productos: ['x'] } }));
      sea('validador: precio 0 no', !okForma({ cada: 2, precio: 0, aplica: { productos: ['x'] } }));
      sea('validador: precio pasado de 10.000.000 no', !okForma({ cada: 2, precio: 10000001, aplica: { productos: ['x'] } }));
      sea('validador: precio 10.000.000 sí', okForma({ cada: 2, precio: 10000000, aplica: { productos: ['x'] } }));
    } catch (e) {
      mal.push('lanzó: ' + String(e.message).slice(0, 160));
    }
    return mal;
  };

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 25 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    assert.ok(previas.some((m) => m.archivo === UNION), 'la cadena previa incluye la unión de normalizar_items');
    antes = radiografia(pg);
    cuerposAntes = cuerpos(pg);
    comentarioAntes = comentario(pg);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, `la migración no se aplicó: ${mia[0].error}`);
    assert.deepEqual(mia[0].avisos, [], 'aplicarla no deja ni un WARNING');
    despues = radiografia(pg);
    sql(`insert into public.personal (email, nombre, rol) values ('mesero1@resplandor.test', 'Mesero Prueba', 'mesero') on conflict (email) do nothing;`);
    sql(`
      insert into public.productos (id, categoria, nombre, precio, activo) values
        ('t-ham','Platos Fuertes','Hamburguesa Resplandor',30000,true),
        ('te-a','Entradas','Papas Resplandor',40001,true),
        ('te-b','Entradas','Arepitas montadas',30000,true),
        ('t-ej1','Ejecutivos','Menú Resplandor',23000,true),
        ('t-ej2','Ejecutivos','Seco',19000,true);
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
        ('t-combo','Promociones','Combo hamburguesas',50000,true,null,2,'{"cada":2,"precio":50000,"aplica":{"productos":["t-ham"]}}'),
        ('t-combo-ent','Promociones','Combo entradas',50000,true,null,null,'{"cada":2,"precio":50000,"aplica":{"categorias":["Entradas"]}}'),
        ('t-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}');
      insert into public.mesas (id, capacidad, estado, token) select g, 4, 'ocupada', lpad(to_hex(g), 48, 'a') from generate_series(91, 140) g;
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('cambia SOLO privado.promo_regla_ok y privado.normalizar_items (cuerpo nuevo; mismos nombres, argumentos y permisos) y el comentario de promo_regla: ninguna otra función, tabla, vista, policy, trigger, restricción ni permiso', () => {
    const clave = (f) => JSON.stringify(f);
    for (const seccion of Object.keys(antes)) {
      if (seccion === 'funciones') continue;
      assert.deepEqual(despues[seccion], antes[seccion], `${seccion}: cambió`);
    }
    const distintas = despues.funciones.filter((f) => !antes.funciones.some((a) => clave(a) === clave(f)));
    assert.deepEqual(distintas.map((f) => `${f.nspname}.${f.proname}`).sort(), ['privado.normalizar_items', 'privado.promo_regla_ok'], 'las únicas funciones distintas');
    for (const nueva of distintas) {
      const vieja = antes.funciones.find((f) => f.nspname === nueva.nspname && f.proname === nueva.proname);
      assert.equal(nueva.args, vieja.args, `${nueva.proname}: mismos argumentos`);
      assert.equal(nueva.acl, vieja.acl, `${nueva.proname}: mismo permiso`);
      assert.notEqual(nueva.cuerpo, vieja.cuerpo, `${nueva.proname}: otro cuerpo`);
    }
    assert.doesNotMatch(distintas.find((f) => f.proname === 'normalizar_items').acl || '', /anon|authenticated/, 'normalizar_items sigue sin EXECUTE para la API');
    assert.match(distintas.find((f) => f.proname === 'promo_regla_ok').acl || '', /authenticated=X/, 'el validador sigue siendo ejecutable por authenticated (20261005120000)');
    assert.equal(despues.funciones.length, antes.funciones.length, 'ninguna función de más ni de menos');
    assert.notEqual(comentario(pg), comentarioAntes);
    assert.match(comentario(pg), /precio: \$/);
    assert.deepEqual(cuerpos(pg).map((c) => c.proname), ['normalizar_items', 'promo_regla_ok']);
  });

  test('LA CAPTURA: un martes, 1 Hamburguesa Resplandor a 30.000 no cambia nada; con 2 la cuenta queda en 50.000 (una base de 30.000 y una línea de promo de 20.000) al agregar la segunda; 3 → 80.000; 4 → 100.000; 5 → 130.000', () => {
    DIA = 2;
    CUENTA = abrir('p-o1');
    let o = HAM(1);
    assert.deepEqual(forma(o), [['t-ham', 1, 30000]]);
    assert.equal(Number(o.total), 30000);
    o = HAM(1);
    assert.deepEqual(forma(o), [['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000]]);
    assert.equal(Number(o.total), 50000, 'el precio normal era 60.000');
    const p = linea(o, 'promo:t-combo:t-ham');
    assert.equal(p.nombre, 'Hamburguesa Resplandor · Combo hamburguesas');
    assert.deepEqual(p.promo, { id: 't-combo', de: 't-ham', nombre: 'Hamburguesa Resplandor', precio: 30000, precio_fijo: 50000 }, 'la promo lleva precio_fijo y el precio de la base, sin descuento');
    assert.equal(p.nota, '');
    assert.equal(Number(orden('p-o1').total), 50000, 'y es lo que quedó guardado');
    o = HAM(1);
    assert.deepEqual(forma(o), [['t-ham', 2, 30000], ['promo:t-combo:t-ham', 1, 20000]]);
    assert.equal(Number(o.total), 80000);
    o = HAM(1);
    assert.deepEqual(forma(o), [['t-ham', 2, 30000], ['promo:t-combo:t-ham', 2, 20000]]);
    assert.equal(Number(o.total), 100000);
    o = HAM(1);
    assert.equal(Number(o.total), 130000);
    // quitar unidades desde la línea de promo o la base deshace el grupo y recalcula: 5 → 4 → 3 → 2 → 1
    o = delta(CUENTA, 'promo:t-combo:t-ham', 'Hamburguesa Resplandor · Combo hamburguesas', 20000, -1);
    assert.equal(Number(o.total), 100000, 'quitar la unidad de la línea de promo deja 4 hamburguesas');
    o = HAM(-1);
    assert.equal(Number(o.total), 80000);
    o = HAM(-1);
    assert.equal(Number(o.total), 50000);
    o = HAM(-1);
    assert.deepEqual(forma(o), [['t-ham', 1, 30000]]);
    assert.equal(Number(o.total), 30000, 'con una sola, sin promo');
  });

  test('el día de la promo es el de la ESCRITURA: un miércoles (o el día que sea que no es el del combo) 2 hamburguesas cuestan 60.000, y el martes la misma cuenta vuelve a 50.000 al tocarla', () => {
    DIA = 3;
    CUENTA = abrir('p-o2');
    HAM(1);
    let o = HAM(1);
    assert.deepEqual(forma(o), [['t-ham', 2, 30000]], 'miércoles: sin promo');
    assert.equal(Number(o.total), 60000);
    DIA = 2;
    sql("update public.ordenes set updated_at = now() where id = 'p-o2';");
    o = orden('p-o2');
    assert.deepEqual(forma(o), [['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000]]);
    assert.equal(Number(o.total), 50000, 'martes: el combo');
    DIA = 4;
    sql("update public.ordenes set updated_at = now() where id = 'p-o2';");
    o = orden('p-o2');
    assert.deepEqual(forma(o), [['t-ham', 2, 30000]], 'jueves: la línea de promo vuelve a su base');
    assert.equal(Number(o.total), 60000);
    // un día null en la fila de la promo aplica TODOS los días (Combo entradas)
    DIA = 5;
    sql("update public.ordenes set updated_at = now() where id = 'p-o2';");
    assert.equal(Number(orden('p-o2').total), 60000);
  });

  test('el PRECIO A MANO entra en la suma: la hamburguesa a mano a 40.000 y otra de carta a 30.000 → la de carta (la más barata) va a la promo a 10.000 (50.000 − 40.000), total 50.000', () => {
    DIA = 2;
    CUENTA = abrir('p-o3');
    delta(CUENTA, 't-ham__sin-sal', 'Hamburguesa Resplandor', 30000, 1, 'sin sal');
    const f = fijar('mesero', CUENTA, 't-ham__sin-sal', 40000);
    assert.ok(f.ok, f.error);
    const o = delta(CUENTA, 't-ham', 'Hamburguesa Resplandor', 30000, 1);
    assert.deepEqual(forma(o), [['t-ham__sin-sal', 1, 40000], ['promo:t-combo:t-ham', 1, 10000]], 'la base de carta se fue ENTERA a la promo');
    assert.equal(linea(o, 't-ham__sin-sal').precio_manual, true, 'la línea a mano conserva su marca');
    assert.equal(Number(o.total), 50000);
    assert.equal(Number(linea(o, 'promo:t-combo:t-ham').promo.precio), 30000, 'y la promo recuerda el precio de carta de su base');
    assert.equal(linea(o, 'promo:t-combo:t-ham').promo.precio_manual, undefined);
    // un precio a mano sobre la BASE ABSORBIDA por la promo (la RPC lo escribe en la línea de promo y el trigger recalcula): 35.000 → la promo sigue en 10.000
    const g = fijar('mesero', CUENTA, 't-ham', 35000);
    assert.ok(g.ok, g.error);
    assert.deepEqual(forma(g.filas[0]), [['t-ham__sin-sal', 1, 40000], ['promo:t-combo:t-ham', 1, 10000]]);
    const gp = linea(g.filas[0], 'promo:t-combo:t-ham');
    assert.equal(Number(gp.promo.precio), 35000, 'el precio a mano de la base absorbida vive en la línea de promo');
    assert.equal(gp.promo.precio_manual, true);
    assert.equal(gp.promo.precio_por, 'mesero1@resplandor.test');
    assert.equal(gp.promo.precio_fijo, 50000);
    assert.equal(Number(g.filas[0].total), 50000);
    assert.equal(Number(orden(CUENTA).total), 50000, 'y es lo que quedó guardado');
  });

  test('el precio a mano de la unidad más BARATA: queda en la línea de promo con su marca (promo.precio_manual), la promo cuenta con ese precio, y «Volver al precio de carta» la devuelve a la carta', () => {
    DIA = 2;
    CUENTA = abrir('p-o4');
    HAM(1);
    delta(CUENTA, 't-ham__x', 'Hamburguesa Resplandor', 30000, 1, 'x');
    const f = fijar('mesero', CUENTA, 't-ham__x', 25000);
    assert.ok(f.ok, f.error);
    let o = f.filas[0];
    assert.deepEqual(forma(o), [['t-ham', 1, 30000], ['promo:t-combo:t-ham__x', 1, 20000]], 'la hamburguesa a mano (25.000) es la más barata: se va entera a la promo a 50.000 − 30.000');
    assert.equal(Number(linea(o, 'promo:t-combo:t-ham__x').promo.precio), 25000);
    assert.equal(linea(o, 'promo:t-combo:t-ham__x').promo.precio_manual, true);
    assert.equal(Number(o.total), 50000);
    // cambiar ese precio a mano estando absorbida: 26.000 → la promo sigue en 20.000 (50.000 − 30.000), total 50.000
    const g = fijar('mesero', CUENTA, 't-ham__x', 26000);
    assert.ok(g.ok, g.error);
    assert.equal(Number(linea(g.filas[0], 'promo:t-combo:t-ham__x').promo.precio), 26000);
    assert.equal(Number(g.filas[0].total), 50000);
    // volver a la carta: las dos a 30.000, una de ellas (la de abajo en la cuenta) a la promo; sin marca
    const h = fijar('mesero', CUENTA, 't-ham__x', null);
    assert.ok(h.ok, h.error);
    o = h.filas[0];
    assert.deepEqual(forma(o), [['t-ham', 1, 30000], ['promo:t-combo:t-ham__x', 1, 20000]]);
    assert.equal(linea(o, 'promo:t-combo:t-ham__x').promo.precio_manual, undefined, 'sin marca');
    assert.equal(Number(o.total), 50000);
  });

  test('X menor que lo que cuestan las otras unidades: la de promo queda en 0 (sin negativos); y un grupo que ya costaba X o menos NO genera promo (un combo nunca sube la cuenta); con el precio de carta de vuelta, 50.000', () => {
    DIA = 2;
    CUENTA = abrir('p-o5');
    HAM(1);
    HAM(1);
    assert.equal(Number(orden(CUENTA).total), 50000);
    try {
      sql("update public.productos set precio = 60000 where id = 't-ham';");
      let o = orden(CUENTA);
      assert.deepEqual(forma(o), [['t-ham', 1, 60000], ['promo:t-combo:t-ham', 1, 0]], 'las otras suman 60.000 > 50.000: la unidad de promo queda en 0, no en −10.000');
      assert.ok(o.items.every((i) => Number(i.precio) >= 0), 'ningún precio negativo');
      assert.equal(Number(o.total), 60000);
      sql("update public.productos set precio = 20000 where id = 't-ham';");
      o = orden(CUENTA);
      assert.deepEqual(forma(o), [['t-ham', 2, 20000]], 'dos hamburguesas a 20.000 cuestan 40.000: el combo de 50.000 NO las sube');
      assert.equal(Number(o.total), 40000);
      sql("update public.productos set precio = 25000 where id = 't-ham';");
      assert.deepEqual(forma(orden(CUENTA)), [['t-ham', 2, 25000]], 'a 25.000 el grupo cuesta exactamente X: tampoco hay promo');
    } finally {
      sql("update public.productos set precio = 30000 where id = 't-ham';");
    }
    assert.deepEqual(forma(orden(CUENTA)), [['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000]]);
    assert.equal(Number(orden(CUENTA).total), 50000);
  });

  test('una regla por CATEGORÍA con precios distintos: el grupo se arma con las N unidades de mayor precio (la más barata del grupo lleva X − las otras) y las que no entran a un grupo completo quedan enteras', () => {
    DIA = 2;
    CUENTA = abrir('p-o6');
    delta(CUENTA, 'te-a', 'Papas Resplandor', 40001, 1);
    let o = delta(CUENTA, 'te-b', 'Arepitas montadas', 30000, 1);
    assert.deepEqual(forma(o), [['te-a', 1, 40001], ['promo:t-combo-ent:te-b', 1, 9999]], '40.001 + 30.000 = 70.001 → el par cuesta 50.000: la más barata queda en 9.999');
    assert.equal(Number(o.total), 50000);
    o = delta(CUENTA, 'te-b', 'Arepitas montadas', 30000, 1);
    assert.deepEqual(forma(o), [['te-a', 1, 40001], ['te-b', 1, 30000], ['promo:t-combo-ent:te-b', 1, 9999]], 'la tercera unidad queda sola: no hay grupo completo');
    assert.equal(Number(o.total), 40001 + 30000 + 9999);
  });

  test('DECLARADO: una línea que reparte unidades entre grupos de DISTINTO costo recibe el PROMEDIO redondeado en su línea de promo (aquí 9.999 y 20.000 → 15.000: la cuenta sale 1 peso por encima de la suma de los dos grupos); el error es de hasta k/2 pesos (k = grupos de esa línea); con la regla de un solo producto es exacto', () => {
    DIA = 2;
    CUENTA = abrir('p-o7');
    delta(CUENTA, 'te-a', 'Papas Resplandor', 40001, 1);
    const o = delta(CUENTA, 'te-b', 'Arepitas montadas', 30000, 3);
    // unidades de mayor a menor: 40.001, 30.000, 30.000, 30.000 → grupos (40.001 + 30.000) y (30.000 + 30.000): la unidad más barata de cada uno cuesta 50.000 − 40.001 = 9.999 y 50.000 − 30.000 = 20.000
    assert.deepEqual(forma(o), [['te-a', 1, 40001], ['te-b', 1, 30000], ['promo:t-combo-ent:te-b', 2, 15000]]);
    assert.equal(Number(o.total), 100001, 'la suma exacta de los dos grupos es 100.000: el redondeo del promedio de la línea suma 1 peso (hasta k/2 pesos, k = 2 grupos de esa línea)');
    assert.equal(linea(o, 'promo:t-combo-ent:te-b').promo.precio_fijo, 50000);
  });

  test('normalizar dos veces es normalizar una (idempotente), con carritos de 1 a 7 hamburguesas, las líneas de promo ya armadas, el precio a mano, una regla por categoría y las dos promos a la vez', () => {
    const carritos = [
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ dia: 2, items: [ham(n)] })),
      { dia: 2, items: [ham(1), ham(1, { id: 't-ham__x', precio_manual: true, precio: 25000 })] },
      { dia: 2, items: [ham(1), ham(1, { id: 'promo:t-combo:t-ham', precio: 20000, promo: { id: 't-combo', de: 't-ham', nombre: 'Hamburguesa Resplandor', precio: 30000, precio_fijo: 50000 } })] },
      { dia: 2, items: [ham(1), { id: 'promo:t-combo:t-ham', nombre: 'x', precio: 20000, qty: 1, nota: '' }] },
      { dia: 2, items: [{ id: 'te-a', nombre: 'A', precio: 40001, qty: 1, nota: '' }, { id: 'te-b', nombre: 'B', precio: 30000, qty: 3, nota: '' }, ham(3)] },
      { dia: 1, items: [{ id: 't-ej1', nombre: 'M', precio: 23000, qty: 2, nota: '' }, { id: 't-ej2', nombre: 'S', precio: 19000, qty: 4, nota: '' }, { id: 'te-b', nombre: 'B', precio: 30000, qty: 2, nota: '' }] },
      { dia: 3, items: [ham(4), { id: 'manual_1', nombre: 'Propina', precio: 5000, qty: 1, nota: '' }, { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: '' }] },
    ];
    for (const { dia, items } of carritos) {
      const una = norma(items, dia);
      const dos = norma(una, dia);
      assert.deepEqual(dos, una, `dos pasadas ≠ una: ${JSON.stringify(items)}`);
      const total = (xs) => xs.reduce((s, i) => s + i.precio * i.qty, 0);
      assert.ok(una.every((i) => Number(i.precio) >= 0), 'ningún precio negativo');
      assert.ok(total(una) > 0 || items.length === 0, 'y la cuenta no se vacía');
    }
    // y la suma de lo que se cobra nunca pasa de lo que costaría sin promo (el combo no sube): 1 a 7 hamburguesas
    for (let n = 1; n <= 7; n++) {
      const t = norma([ham(n)], 2).reduce((s, i) => s + i.precio * i.qty, 0);
      assert.equal(t, Math.floor(n / 2) * 50000 + (n % 2) * 30000, `${n} hamburguesas`);
    }
  });

  test('las promos de DESCUENTO no cambian: un lunes, 2 Menú + 1 Seco → el Seco con 20 % en su línea de promo, con `descuento` (y sin `precio_fijo`), 61.200; y conviven con el combo en la misma cuenta', () => {
    DIA = 1;
    CUENTA = abrir('p-o8');
    delta(CUENTA, 't-ej1', 'Menú Resplandor', 23000, 2);
    let o = delta(CUENTA, 't-ej2', 'Seco', 19000, 1);
    assert.deepEqual(forma(o), [['t-ej1', 2, 23000], ['promo:t-pr3:t-ej2', 1, 15200]]);
    assert.deepEqual(linea(o, 'promo:t-pr3:t-ej2').promo, { id: 't-pr3', de: 't-ej2', nombre: 'Seco', precio: 19000, descuento: 20 }, 'la forma de la promo de descuento no cambió ni una clave');
    assert.equal(Number(o.total), 61200);
    // el mismo día el combo de entradas (todos los días) también aplica: 2 Arepitas → 50.000 − 30.000 = 20.000 para la segunda
    o = delta(CUENTA, 'te-b', 'Arepitas montadas', 30000, 2);
    assert.deepEqual(forma(o), [['t-ej1', 2, 23000], ['te-b', 1, 30000], ['promo:t-combo-ent:te-b', 1, 20000], ['promo:t-pr3:t-ej2', 1, 15200]], 'las dos promos a la vez; el Seco, que la del lunes se llevó ENTERO, vuelve al final de la cuenta con su línea de promo');
    assert.equal(Number(o.total), 61200 + 50000);
  });

  test('el cobro por partes sigue rechazando la cuenta con promo de precio fijo (RS005: «promoción»), igual que con la de descuento; la mesa completa se cobra al total de la base, y cerrarla no la vuelve a tocar', () => {
    DIA = 2;
    CUENTA = abrir('p-o9');
    HAM(2);
    const v = Number(orden(CUENTA).version);
    const r = llamar('mesero', `select public.cobrar_parcial(${literal(CUENTA)}, ${v}, '{"id":"p-v9"}'::jsonb, '[{"id":"t-ham","qty":1}]'::jsonb, 'p-c9') as r`);
    assert.equal(r.ok, false);
    assert.match(r.error, /RS005/);
    assert.match(r.error, /promoción/);
    assert.equal(Number(orden(CUENTA).total), 50000, 'la cuenta no cambió');
    sql(`update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = ${literal(CUENTA)};`);
    const c = orden(CUENTA);
    assert.equal(c.estado, 'cerrada');
    assert.equal(Number(c.total), 50000, 'cerrada con el total de la base');
    sql("update public.productos set precio = 31000 where id = 't-ham';");
    assert.equal(Number(orden(CUENTA).total), 50000, 'y un cambio de precio ya no la toca');
    sql("update public.productos set precio = 30000 where id = 't-ham';");
  });

  test('el CHECK de productos: acepta {cada, precio, aplica} y rechaza los tres juntos, los dos a la vez, ninguno, precio 0 o pasado de tope, decimal, texto o null; y lo evalúa un admin DE VERDAD (rol authenticated con RLS)', () => {
    const insertar = (id, regla, quien) => pg.sql(`insert into public.productos (id, categoria, nombre, precio, activo, promo_regla) values (${literal(id)}, 'Promociones', ${literal('Prueba ' + id)}, 0, false, ${literal(JSON.stringify(regla))}::jsonb);`, quien);
    const bien = [
      ['c-ok1', { cada: 2, precio: 50000, aplica: { productos: ['t-ham'] } }],
      ['c-ok2', { cada: 3, precio: 1, aplica: { categorias: ['Entradas'] } }],
      ['c-ok3', { cada: 10, precio: 10000000, aplica: { categorias: ['Entradas'], productos: ['t-ham'] } }],
      ['c-ok4', { cada: 3, descuento: 20, aplica: { categorias: ['Ejecutivos'] } }],
    ];
    for (const [id, regla] of bien) { const r = insertar(id, regla, como('admin')); assert.ok(r.ok, `${id}: ${r.error}`); }
    const mal = [
      ['juntos los tres', { cada: 2, descuento: 20, precio: 50000, aplica: { productos: ['t-ham'] } }],
      ['descuento y precio', { cada: 2, descuento: 100, precio: 1, aplica: { productos: ['t-ham'] } }],
      ['ninguno', { cada: 2, aplica: { productos: ['t-ham'] } }],
      ['precio 0', { cada: 2, precio: 0, aplica: { productos: ['t-ham'] } }],
      ['precio pasado de tope', { cada: 2, precio: 10000001, aplica: { productos: ['t-ham'] } }],
      ['precio negativo', { cada: 2, precio: -1, aplica: { productos: ['t-ham'] } }],
      ['precio decimal', { cada: 2, precio: 49999.5, aplica: { productos: ['t-ham'] } }],
      ['precio texto', { cada: 2, precio: 'cincuenta mil', aplica: { productos: ['t-ham'] } }],
      ['precio null', { cada: 2, precio: null, aplica: { productos: ['t-ham'] } }],
      ['cada 1', { cada: 1, precio: 50000, aplica: { productos: ['t-ham'] } }],
      ['cada 11', { cada: 11, precio: 50000, aplica: { productos: ['t-ham'] } }],
      ['sin aplica', { cada: 2, precio: 50000 }],
      ['aplica vacío', { cada: 2, precio: 50000, aplica: { productos: [] } }],
      ['descuento 0', { cada: 2, descuento: 0, aplica: { productos: ['t-ham'] } }],
      ['descuento 101', { cada: 2, descuento: 101, aplica: { productos: ['t-ham'] } }],
    ];
    for (const [que, regla] of mal) {
      const r = insertar('c-mal', regla, como('admin'));
      assert.equal(r.ok, false, `se esperaba rechazo: ${que}`);
      assert.match(r.error, /productos_promo_regla_valida/, que);
    }
    // un UPDATE de la regla de una promo existente, también como mesero (el POS deja a los dos editar productos)
    const u = pg.sql(`update public.productos set promo_regla = '{"cada":2,"precio":45000,"aplica":{"productos":["t-ham"]}}'::jsonb where id = 'c-ok1';`, como('mesero'));
    assert.ok(u.ok, u.error);
    const v = pg.sql(`update public.productos set promo_regla = '{"cada":2,"precio":45000,"descuento":10,"aplica":{"productos":["t-ham"]}}'::jsonb where id = 'c-ok1';`, como('mesero'));
    assert.equal(v.ok, false);
    sql("delete from public.productos where id like 'c-ok%';");
  });

  test('DOBLE COBRO neutralizado: una tablet con el POS de antes agrega el producto «Combo hamburguesas» junto a 2 hamburguesas: un martes 50.000 y la línea del combo a 0; otro día 60.000 y a 0; a mano conserva su precio; al volver a la carta, a 0', () => {
    DIA = 2;
    CUENTA = abrir('p-d1');
    HAM(2);
    let o = delta(CUENTA, 't-combo', 'Combo hamburguesas', 50000, 1);
    assert.deepEqual(forma(o), [['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000], ['t-combo', 1, 0]], 'la regla da el combo y la línea del producto vale 0');
    assert.equal(Number(o.total), 50000, 'antes de neutralizar eran 100.000');
    assert.equal(Number(orden(CUENTA).total), 50000, 'y es lo que quedó guardado');
    // otro día: sin combo, la línea del producto sigue en 0 (el POS nuevo la esconde TODOS los días)
    DIA = 3;
    sql("update public.ordenes set updated_at = now() where id = 'p-d1';");
    o = orden(CUENTA);
    assert.deepEqual(forma(o), [['t-ham', 2, 30000], ['t-combo', 1, 0]]);
    assert.equal(Number(o.total), 60000);
    // un precio a mano en esa línea se respeta como hoy
    DIA = 2;
    const f = fijar('mesero', CUENTA, 't-combo', 40000);
    assert.ok(f.ok, f.error);
    o = f.filas[0];
    assert.equal(Number(linea(o, 't-combo').precio), 40000);
    assert.equal(linea(o, 't-combo').precio_manual, true);
    assert.equal(Number(o.total), 90000, '30.000 + 20.000 + 40.000 a mano');
    // y «Volver al precio de carta» la devuelve a 0 (el precio de carta de un producto con regla es 0)
    const g = fijar('mesero', CUENTA, 't-combo', null);
    assert.ok(g.ok, g.error);
    assert.equal(Number(linea(g.filas[0], 't-combo').precio), 0);
    assert.equal(linea(g.filas[0], 't-combo').precio_manual, undefined);
    assert.equal(Number(g.filas[0].total), 50000);
    // el producto de una promo de DESCUENTO ya valía 0: sigue igual
    CUENTA = abrir('p-d2');
    DIA = 1;
    delta(CUENTA, 't-ej1', 'Menú Resplandor', 23000, 2);
    o = delta(CUENTA, 't-pr3', '3er almuerzo', 0, 1);
    assert.deepEqual(forma(o), [['t-ej1', 2, 23000], ['t-pr3', 1, 0]]);
    assert.equal(Number(o.total), 46000);
  });

  test('DIFERENCIAL: una cuenta sin líneas de productos de promos de precio fijo (con o sin las de descuento, cuyo producto ya valía 0) sale BYTE A BYTE igual que antes de esta ronda (la misma función sin la neutralización ni el salto), con el catálogo completo, y que la unión 20261006140000 con un catálogo de solo descuento; primera y segunda pasada, los 8 días', () => {
    const reciente = (sql, ancla) => {
      const a = sql.search(/^create or replace function privado\.normalizar_items\(/m);
      assert.ok(a >= 0, ancla);
      return sql.slice(a, sql.indexOf('\nend $$;', a) + '\nend $$;'.length);
    };
    const union = reciente(SQL_UNION, 'la unión').replace('privado.normalizar_items(', () => 'privado.normalizar_items_union(');
    // «la de antes de esta ronda»: la nueva con sus dos ediciones revertidas (cada una tiene que estar exactamente una vez)
    let ref = reciente(SQL, 'la nueva').replace('privado.normalizar_items(', () => 'privado.normalizar_items_ref(');
    const neutral = 'select case when p.promo_regla is not null then 0 else p.precio end into v_precio';
    assert.equal(ref.split(neutral).length, 2);
    ref = ref.replace(neutral, () => 'select p.precio into v_precio');
    const salto = /^[ \t]*if not privado\.promo_regla_ok\(v_promo\.regla\) then continue; end if;\n/m;
    assert.match(ref, salto);
    ref = ref.replace(salto, () => '');
    const script = `
      begin;
      ${union}
      ${ref}
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
        ('t-d1','Promociones','Platos 50',0,true,null,2,'{"cada":2,"descuento":50,"aplica":{"categorias":["Platos Fuertes"]}}'),
        ('t-d2','Promociones','Entradas siempre',0,true,'x',null,'{"cada":2,"descuento":100,"aplica":{"categorias":["Entradas"]}}'),
        ('t-d3','Promociones','Aaa tres',0,true,null,null,'{"cada":3,"descuento":33,"aplica":{"productos":["t-ham","te-a","t-ej1","t-ej2"]}}');
      create temp table dif (fase text, k int, dia int, a jsonb, r jsonb, u jsonb, a2 jsonb, r2 jsonb, u2 jsonb);
      do $$
      declare
        ids text[] := array['t-ham','te-a','te-b','t-ej1','t-ej2','t-ham__sin-sal','te-b__x','t-ham__otra','t-pr3','t-pr3__x','manual_1','abono_recibido_9','para_llevar','zz-noexiste'];
        fase text; k int; j int; nl int; items jsonb; it jsonb; idx text; dia int; a jsonb; r jsonb; u jsonb;
      begin
        for fase in select unnest(array['A', 'B']) loop
          -- B: el catálogo de SOLO descuento (la unión no sabe de precio fijo)
          if fase = 'B' then update public.productos set promo_regla = null where promo_regla ? 'precio'; end if;
          perform setseed(0.4242);
          for k in 1..400 loop
            nl := 1 + floor(random() * 6)::int;
            items := '[]';
            for j in 1..nl loop
              idx := ids[1 + floor(random() * array_length(ids, 1))::int];
              if items @> jsonb_build_array(jsonb_build_object('id', idx)) then continue; end if;
              it := jsonb_build_object('id', idx, 'nombre', 'N' || idx,
                      'precio', case when idx like 'abono%' then -10000 when idx = 'para_llevar' then 0
                                     when random() < 0.15 then (1 + floor(random() * 80))::int * 1000 + (case when random() < 0.3 then 1 else 0 end)
                                     else coalesce((select pr.precio from public.productos pr where pr.id = split_part(idx, '__', 1)), 5000) end,
                      'qty', 1 + floor(random() * 5)::int, 'nota', case when random() < 0.2 then 'nota' else '' end);
              if random() < 0.15 and idx not like 'manual%' and idx not like 'abono%' then it := it || '{"precio_manual":true,"precio_por":"a@b.test"}'; end if;
              items := items || jsonb_build_array(it);
            end loop;
            for dia in 0..7 loop
              a := privado.normalizar_items(items, nullif(dia, 0)::smallint);
              r := privado.normalizar_items_ref(items, nullif(dia, 0)::smallint);
              u := case when fase = 'B' then privado.normalizar_items_union(items, nullif(dia, 0)::smallint) end;
              insert into dif values (fase, k, dia, a, r, u, privado.normalizar_items(a, nullif(dia, 0)::smallint), privado.normalizar_items_ref(r, nullif(dia, 0)::smallint),
                                      case when fase = 'B' then privado.normalizar_items_union(u, nullif(dia, 0)::smallint) end);
            end loop;
          end loop;
        end loop;
      end $$;
      select json_build_object(
        'casos', (select count(*) from dif),
        'dist_ref_1', (select count(*) from dif where a::text <> r::text), 'dist_ref_2', (select count(*) from dif where a2::text <> r2::text),
        'dist_union_1', (select count(*) from dif where fase = 'B' and a::text <> u::text), 'dist_union_2', (select count(*) from dif where fase = 'B' and a2::text <> u2::text),
        'precio_fijo_A', (select count(*) from dif where fase = 'A' and a::text like '%precio_fijo%'),
        'descuento_B', (select count(*) from dif where fase = 'B' and a::text like '%descuento%'),
        'con_promo', (select count(*) from dif where a::text like '%promo:%'));
      rollback;`;
    const r = pg.sql(script);
    assert.ok(r.ok, r.error);
    const d = ultimoJson(r.salida);
    assert.equal(d.casos, 2 * 400 * 8);
    assert.equal(d.dist_ref_1 + d.dist_ref_2, 0, `distinta de la de antes de esta ronda: ${JSON.stringify(d)}`);
    assert.equal(d.dist_union_1 + d.dist_union_2, 0, `distinta de la unión con un catálogo de solo descuento: ${JSON.stringify(d)}`);
    assert.ok(d.precio_fijo_A > 100 && d.descuento_B > 100 && d.con_promo > 500, `la comparación no es vacía: ${JSON.stringify(d)}`);
  });

  test('ninguna de las escrituras de arriba dejó un WARNING (los triggers tragan errores, pero no los hubo)', () => {
    assert.deepEqual(avisos, []);
  });

  test('aplicarla dos veces es inocua: el catálogo queda idéntico, sin WARNING, y las cuentas no cambian', () => {
    const cuentas = () => pg.filas('select id, items, total, version from public.ordenes order by id');
    const antesCuentas = cuentas();
    const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(otra.length, 1);
    assert.ok(otra[0].ok, otra[0].error);
    assert.deepEqual(otra[0].avisos, [], 'la segunda aplicación no deja WARNING');
    assert.deepEqual(radiografia(pg), despues);
    assert.deepEqual(cuentas(), antesCuentas);
  });

  test('MUTANTES: el cuadro de escenarios pasa con la migración y MUERE con cada mutante (sin el tope del precio de lista, sin el filtro de «el grupo ya costaba X», con la unidad de promo gratis siempre, sin sumar el grupo, con el validador que acepta los dos a la vez, con el tope de precio pasado, sin neutralizar el producto de la promo con regla)', () => {
    assert.deepEqual(chequeo(), [], 'con la migración de verdad, todo pasa');
    const mutantes = [
      ['sin el tope del precio de lista (la unidad de promo queda negativa)', 'least(gr.precio, greatest(0, gr.total - v_fijo))', 'greatest(0, gr.total - v_fijo)'],
      ['sin el filtro de los grupos que ya costaban X o menos', '(v_fijo is null or gr.total > v_fijo)', 'true'],
      ['la unidad de promo siempre gratis', 'else v_pre[v_i] end;', 'else 0 end;'],
      ['el grupo suma TODO lo elegible (no cada N)', 'partition by (u.rn - 1) / v_cada', 'partition by 1'],
      ['el validador acepta descuento y precio a la vez', "if (p_regla ? 'descuento') = (p_regla ? 'precio') then return false; end if;", 'if false then return false; end if;'],
      ['el validador deja pasar un precio pasado de 10.000.000', 'if v_precio < 1 or v_precio > 10000000 then return false; end if;', 'if v_precio < 1 then return false; end if;'],
      ['el validador deja pasar precio 0', 'if v_precio < 1 or v_precio > 10000000 then return false; end if;', 'if v_precio < 0 or v_precio > 10000000 then return false; end if;'],
      ['sin neutralizar el producto de la promo con regla (el doble cobro de una tablet vieja)', 'select case when p.promo_regla is not null then 0 else p.precio end into v_precio', 'select p.precio into v_precio'],
    ];
    try {
      for (const [nombre, viejo, nuevo] of mutantes) {
        assert.equal(SQL.split(viejo).length, 2, `el mutante «${nombre}» no encuentra su texto exactamente una vez`);
        // la migración se comprueba a sí misma al final (los permisos y el validador): un mutante puede morir al APLICARSE (y entonces la función mutada queda puesta: no es una
        // transacción) o al correr el cuadro de escenarios; lo que no puede es sobrevivir a las dos cosas
        const r = pg.sql(SQL.replace(viejo, () => nuevo), { como: 'migrador' });
        const falla = chequeo();
        assert.ok(!r.ok || falla.length > 0, `el mutante «${nombre}» SOBREVIVE: ni la comprobación de la migración ni el cuadro de escenarios lo notaron`);
        if (!r.ok) assert.match(r.error, /deja pasar una regla mala|rechaza una regla buena|no es la de la unión|no neutraliza el producto/, `el mutante «${nombre}» murió al aplicarse por otra razón: ${r.error}`);
      }
    } finally {
      const r = pg.sql(SQL, { como: 'migrador' });
      assert.ok(r.ok, r.error);
    }
    assert.deepEqual(chequeo(), [], 'y con la migración de nuevo, todo vuelve a pasar');
    assert.deepEqual(radiografia(pg), despues);
  });

  test('la REVERSA de la cabecera + volver a pegar la unión dejan el catálogo y los cuerpos como ANTES (y la regla del combo, y su efecto en las cuentas abiertas, desaparecen); reaplicarla lo deja como después y el combo vuelve a funcionar', () => {
    DIA = 2;
    CUENTA = abrir('p-o10');
    HAM(2);
    assert.equal(Number(orden(CUENTA).total), 50000);
    const r = pg.sql(reversa(SQL).replace(/^--.*$/gm, ''), { como: 'migrador' });
    assert.ok(r.ok, 'la reversa falló: ' + r.error);
    assert.equal(pg.filas("select count(*)::int as n from public.productos where promo_regla ? 'precio'")[0].n, 0, 'ninguna regla de precio fijo queda');
    assert.equal(Number(orden(CUENTA).total), 60000, 'la cuenta abierta se re-normalizó sola: sin la regla, 2 hamburguesas cuestan 60.000');
    const union = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: UNION, hasta: UNION });
    assert.ok(union[0].ok, union[0].error);
    assert.deepEqual(union[0].avisos, []);
    const ahora = radiografia(pg);
    for (const [seccion, filas] of Object.entries(antes)) assert.deepEqual(ahora[seccion], filas, `tras la reversa quedó distinto: ${seccion}`);
    assert.deepEqual(cuerpos(pg), cuerposAntes, 'los cuerpos de las dos funciones son los de antes');
    assert.equal(comentario(pg), comentarioAntes, 'y el comentario de la columna');
    const reaplicada = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.ok(reaplicada[0].ok, 'no se pudo volver a aplicar tras la reversa: ' + reaplicada[0].error);
    assert.deepEqual(reaplicada[0].avisos, []);
    assert.deepEqual(radiografia(pg), despues, 'reaplicar tras la reversa deja el catálogo como la primera vez');
    sql("update public.productos set promo_regla = '{\"cada\":2,\"precio\":50000,\"aplica\":{\"productos\":[\"t-ham\"]}}'::jsonb where id = 't-combo';");
    assert.equal(Number(orden(CUENTA).total), 50000, 'al volver a poner la regla, la cuenta abierta vuelve a 50.000');
    assert.deepEqual(chequeo(), []);
  });
});

describe('filas heredadas: la migración aborta SIN cambiar nada si una promo_regla que ya existe no pasa el validador nuevo (y dice cuáles), y normalizar_items nunca lanza por una regla que no puede leer (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  const norma = (items, dia) => pg.filas(`select privado.normalizar_items(${literal(JSON.stringify(items))}::jsonb, ${dia}::smallint) as r`)[0].r;
  const reglas = () => pg.filas("select id, promo_regla from public.productos order by id");
  const instantanea = () => ({ cat: radiografia(pg), cuerpos: cuerpos(pg), comentario: comentario(pg), reglas: reglas(), ordenes: pg.filas('select id, items, total, version from public.ordenes order by id') });
  // reglas que el validador de ANTES dejaba pasar (miraba solo `cada` y `descuento`, y un NULL en el `or` lo dejaba seguir) y el nuevo no
  const HEREDADAS = {
    'h-null': { cada: 2, descuento: 20, precio: null, aplica: { productos: ['h-ham'] } },
    'h-txt': { cada: 2, descuento: 20, precio: 'x', aplica: { productos: ['h-ham'] } },
    'h-cero': { cada: 2, descuento: 20, precio: 0, aplica: { productos: ['h-ham'] } },
    'h-sincada': { descuento: 20, aplica: { productos: ['h-ham'] } },
    'h-sindesc': { cada: 2, aplica: { productos: ['h-ham'] } },
  };
  const NOMBRES = { 'h-null': 'Con precio null', 'h-txt': 'Con precio texto', 'h-cero': 'Con precio cero', 'h-sincada': 'Sin cada', 'h-sindesc': 'Sin descuento ni precio' };

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 25 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    const filas = Object.entries(HEREDADAS).map(([id, regla]) => `(${literal(id)}, 'Promociones', ${literal(NOMBRES[id])}, 0, true, 2, ${literal(JSON.stringify(regla))}::jsonb)`);
    const r = pg.sql(`
      insert into public.productos (id, categoria, nombre, precio, activo) values ('h-ham', 'Platos Fuertes', 'Hamburguesa Resplandor', 30000, true);
      insert into public.productos (id, categoria, nombre, precio, activo, dia_semana, promo_regla) values
        ('h-ok', 'Promociones', 'Tres por dos', 0, true, 1, '{"cada":3,"descuento":34,"aplica":{"productos":["h-ham"]}}'),
        ${filas.join(',\n        ')};
      insert into public.mesas (id, capacidad, estado, token) values (81, 4, 'ocupada', lpad(to_hex(81), 48, 'c'));
      insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('h-o1', 81, 'abierta', '[{"id":"h-ham","nombre":"H","precio":30000,"qty":2,"nota":""}]', 60000, now());
    `);
    assert.ok(r.ok, `el validador de antes tendría que dejar pasar esas reglas: ${r.error}`);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('el validador de ANTES las acepta todas (por eso están en producción) y el NUEVO (el de la migración, probado dentro de una transacción que se deshace) no acepta ninguna de las heredadas, pero sí la buena', () => {
    const antes = pg.filas("select id, privado.promo_regla_ok(promo_regla) as ok from public.productos where id like 'h-%' and promo_regla is not null order by id");
    assert.ok(antes.length === 6 && antes.every((f) => f.ok), JSON.stringify(antes));
    const nuevaFuncion = funcionDe(SQL, 'privado.promo_regla_ok').join('\n').replace('privado.promo_regla_ok(', () => 'privado.promo_regla_ok_nueva(');
    const r = pg.sql(`begin;\n${nuevaFuncion}\nselect json_agg(json_build_object('id', id, 'ok', privado.promo_regla_ok_nueva(promo_regla)) order by id) from public.productos where id like 'h-%' and promo_regla is not null;\nrollback;`);
    assert.ok(r.ok, r.error);
    const nuevo = JSON.parse(r.salida.trim().split('\n').pop());
    assert.deepEqual(nuevo.filter((f) => f.ok).map((f) => f.id), ['h-ok'], 'solo la buena pasa el validador nuevo');
    assert.deepEqual(nuevo.filter((f) => !f.ok).map((f) => f.id), Object.keys(HEREDADAS).sort());
  });

  test('con filas heredadas la migración FALLA y no cambia NADA: ni el validador, ni normalizar_items, ni el comentario, ni las reglas, ni las cuentas; el mensaje lista id y nombre de cada una (y no la buena) y dice cómo arreglarlas', () => {
    const antes = instantanea();
    const r = pg.sql(SQL, { como: 'migrador' });
    assert.equal(r.ok, false, 'tenía que abortar');
    for (const [id, nombre] of Object.entries(NOMBRES)) assert.ok(r.error.includes(`${id} («${nombre}», regla`), `el mensaje no lista ${id} «${nombre}»: ${r.error}`);
    assert.doesNotMatch(r.error, /h-ok/, 'la regla buena no se lista');
    assert.match(r.error, /Hay promociones cuya regla el validador nuevo no acepta/);
    assert.match(r.error, /Arréglalas ANTES de aplicar esta migración \(desde Productos, o con update public\.productos set promo_regla = /);
    assert.match(r.error, /promo_regla = promo_regla - 'precio'/, 'y el arreglo más común (quitar la clave que sobra)');
    assert.match(r.error, /exactamente uno de descuento \/ precio/);
    assert.match(r.error, /No se cambió nada\./);
    assert.deepEqual(instantanea(), antes, 'la radiografía de funciones, el comentario, las reglas y las cuentas quedaron idénticas: se deshizo TODO, también el validador nuevo');
    assert.equal(pg.filas("select count(*)::int as n from pg_proc where proname = 'promo_regla_ok' and prosrc like '%v_precio%'")[0].n, 0, 'el validador nuevo no quedó puesto');
    // y con el validador de antes sigue pudiéndose editar la fila para arreglarla (el CHECK de antes la acepta)
    const e = pg.sql("update public.productos set activo = true where id = 'h-null';");
    assert.ok(e.ok, e.error);
  });

  test('arregladas las filas (quitar la clave que sobra, poner lo que falta o quitar la regla), la migración se aplica sin un solo aviso y lo demás sigue igual', () => {
    const f = pg.sql(`
      update public.productos set promo_regla = promo_regla - 'precio' where id in ('h-null', 'h-txt', 'h-cero');
      update public.productos set promo_regla = promo_regla || '{"cada":2}'::jsonb where id = 'h-sincada';
      update public.productos set promo_regla = null where id = 'h-sindesc';
    `);
    assert.ok(f.ok, f.error);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, mia[0].error);
    assert.deepEqual(mia[0].avisos, []);
    const ahora = reglas();
    assert.deepEqual(ahora.find((x) => x.id === 'h-null').promo_regla, { cada: 2, descuento: 20, aplica: { productos: ['h-ham'] } });
    assert.equal(ahora.find((x) => x.id === 'h-sindesc').promo_regla, null);
    // la cuenta abierta se normaliza con las reglas arregladas (el martes: 2 hamburguesas con la regla de descuento 20 % de h-null y compañía; lo que importa: no lanza y suma)
    const n = norma([{ id: 'h-ham', nombre: 'H', precio: 30000, qty: 2, nota: '' }], 2);
    assert.ok(n.every((i) => Number(i.precio) >= 0) && n.reduce((a, i) => a + i.precio * i.qty, 0) > 0);
  });

  test('normalizar_items NUNCA lanza por una regla que no puede leer (precio que no es entero o texto, los dos o ninguno, cada que no es número): esa promo se salta y las demás siguen aplicando; sin el salto, lanzaba', () => {
    // el CHECK impide escribir una regla así: para probar la defensa se lo quita en esta base desechable
    const k = pg.sql(`
      alter table public.productos drop constraint productos_promo_regla_valida;
      delete from public.productos where id like 'h-%' and id <> 'h-ham';
      insert into public.productos (id, categoria, nombre, precio, activo, dia_semana, promo_regla) values
        ('w-txt', 'Promociones', 'A precio texto', 0, true, 2, '{"cada":2,"precio":"x","aplica":{"productos":["h-ham"]}}'),
        ('w-dec', 'Promociones', 'B precio decimal', 0, true, 2, '{"cada":2,"precio":1.5,"aplica":{"productos":["h-ham"]}}'),
        ('w-amb', 'Promociones', 'C ambos', 0, true, 2, '{"cada":2,"precio":10,"descuento":50,"aplica":{"productos":["h-ham"]}}'),
        ('w-nin', 'Promociones', 'D ninguno', 0, true, 2, '{"cada":2,"aplica":{"productos":["h-ham"]}}'),
        ('w-nul', 'Promociones', 'E precio null', 0, true, 2, '{"cada":2,"descuento":20,"precio":null,"aplica":{"productos":["h-ham"]}}'),
        ('w-cada', 'Promociones', 'F cada texto', 0, true, 2, '{"cada":"x","descuento":20,"aplica":{"productos":["h-ham"]}}'),
        ('w-ok', 'Promociones', 'Z combo bueno', 50000, true, 2, '{"cada":2,"precio":50000,"aplica":{"productos":["h-ham"]}}');
    `);
    assert.ok(k.ok, k.error);
    const dos = [{ id: 'h-ham', nombre: 'H', precio: 30000, qty: 2, nota: '' }];
    const bien = norma(dos, 2);
    assert.deepEqual(bien.map((i) => [i.id, i.qty, Number(i.precio)]), [['h-ham', 1, 30000], ['promo:w-ok:h-ham', 1, 20000]], 'las ilegibles se saltan y la buena aplica: 50.000');
    assert.deepEqual(norma(bien, 2), bien, 'y es idempotente');
    // el mismo cuerpo SIN el salto (el mutante) lanza con la regla de texto: el salto es lo que lo evita. (Se pone la función sola: la migración entera abortaría por las filas ilegibles, que es lo que prueba el test de arriba.)
    const cuerpoNuevo = funcionDe(SQL, 'privado.normalizar_items').join('\n');
    const cuerpoSinSalto = cuerpoNuevo.replace(/^if not privado\.promo_regla_ok\(v_promo\.regla\) then continue; end if;\n/m, () => '');
    assert.notEqual(cuerpoSinSalto, cuerpoNuevo);
    const m = pg.sql(cuerpoSinSalto, { como: 'migrador' });
    assert.ok(m.ok, m.error);
    let lanzo = null;
    try { norma(dos, 2); } catch (e) { lanzo = String(e.message); }
    assert.match(lanzo || '', /invalid input syntax|out of range|numeric|integer/, 'sin el salto, la regla ilegible hacía lanzar a normalizar_items');
    const otra = pg.sql(cuerpoNuevo, { como: 'migrador' });
    assert.ok(otra.ok, otra.error);
    assert.deepEqual(norma(dos, 2), bien, 'con la migración de nuevo, otra vez las salta');
  });
});

describe('se niega a correr, sin cambiar nada, si falta 20261006130000 o la unión 20261006140000 (Postgres desechable propio), y el sobre se niega si falta la migración', { skip: MOTIVO }, () => {
  let pg;
  const SOBRE_SQL = SQL_SOBRE;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('sin 20261006130000: error claro y NADA cambia; con ella pero sin la unión: otro error claro y NADA cambia; con la unión puesta (y la lápida y «servida»), se aplica sin avisos', () => {
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: PRECIO_A_MANO_2 });
    assert.ok(previas.length >= 14 && previas.every((m) => m.ok), JSON.stringify(previas.filter((m) => !m.ok)));
    const a0 = radiografia(pg);
    const c0 = cuerpos(pg);
    const sin130 = pg.sql(SQL, { como: 'migrador' });
    assert.equal(sin130.ok, false);
    assert.match(sin130.error, /Falta 20261006130000_precio_a_mano_promo_entera\.sql.*No se cambió nada/s);
    assert.deepEqual(radiografia(pg), a0, 'sin 20261006130000: no dejó nada cambiado');
    assert.deepEqual(cuerpos(pg), c0, 'ni el validador ni normalizar_items');
    const con130 = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: PRECIO_A_MANO_2, hasta: PRECIO_A_MANO_2 });
    assert.ok(con130[0].ok, con130[0].error);
    const a1 = radiografia(pg);
    const c1 = cuerpos(pg);
    const sinUnion = pg.sql(SQL, { como: 'migrador' });
    assert.equal(sinUnion.ok, false);
    assert.match(sinUnion.error, /Falta 20261006140000_normalizar_items_pliegue_y_precio_a_mano\.sql.*borraría una de las dos.*No se cambió nada/s);
    assert.deepEqual(radiografia(pg), a1, 'sin la unión: no dejó nada cambiado');
    assert.deepEqual(cuerpos(pg), c1);
    // el resto de la cadena SIN la mía: el sobre se niega (la regla de precio sin la migración dejaría la cuenta con un precio NULL)
    const resto = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: UNION, antesDe: MIGRACION });
    assert.ok(resto.length >= 3 && resto.every((m) => m.ok), JSON.stringify(resto.filter((m) => !m.ok)));
    const r = pg.sql(`
      insert into public.productos (id, categoria, nombre, precio, activo, dia_semana) values ('s-ham','Platos Fuertes','Hamburguesa Resplandor',30000,true,null), ('s-combo','Promociones','Combo hamburguesas',50000,true,2);
    `);
    assert.ok(r.ok, r.error);
    const sinMia = pg.sql(SOBRE_SQL, { como: 'migrador' });
    assert.equal(sinMia.ok, false);
    assert.match(sinMia.error, /Falta aplicar supabase\/migrations\/20261006170000_promo_precio_fijo\.sql.*No se aplicó nada/s);
    assert.equal(pg.filas("select promo_regla from public.productos where id = 's-combo'")[0].promo_regla, null, 'el sobre sin la migración no escribió nada');
    const bien = pg.sql(SQL, { como: 'migrador' });
    assert.ok(bien.ok, bien.error);
    assert.deepEqual(bien.avisos, []);
  });
});

describe('el sobre docs/sobres/2026-10-06-promo-precio-fijo.sql contra un catálogo con los dos nombres (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  let DIA = 2;
  const sql = (texto, opciones) => { const r = pg.sql(`set resplandor.dia_promo = ${DIA};\n` + texto, opciones); assert.ok(r.ok, r.error); return r; };
  const claims = (clave) => {
    const g = pg.filas(`select id, email, provider from t.gente where clave = ${literal(clave)}`)[0];
    return { sub: g.id, role: 'authenticated', email: g.email, app_metadata: { provider: g.provider } };
  };
  const delta = (id, producto, nombre, precio, n) => {
    const r = pg.sql(`set resplandor.dia_promo = ${DIA};\nselect coalesce(json_agg(to_jsonb(t)), '[]'::json) from (select items, total, version from public.aplicar_delta_orden(${literal(id)}, ${literal(producto)}, ${literal(nombre)}, ${precio}, ${n}, '')) t;`, { como: 'authenticated', claims: claims('mesero') });
    assert.ok(r.ok, r.error);
  };
  const orden = (id) => pg.filas(`select items, total, version from public.ordenes where id = ${literal(id)}`)[0];
  const regla = () => pg.filas("select promo_regla from public.productos where categoria = 'Promociones' and nombre = 'Combo hamburguesas'")[0].promo_regla;
  const precio = () => pg.filas("select precio from public.productos where categoria = 'Promociones' and nombre = 'Combo hamburguesas'")[0].precio;
  const sobre = () => pg.sql(`set resplandor.dia_promo = ${DIA};\n` + SQL_SOBRE, { como: 'migrador' });

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const hechas = aplicarMigraciones(pg);
    assert.ok(hechas.every((m) => m.ok) && hechas.at(-1).archivo === MIGRACION, JSON.stringify(hechas.filter((m) => !m.ok)));
    sql(`insert into public.personal (email, nombre, rol) values ('mesero1@resplandor.test', 'Mesero Prueba', 'mesero') on conflict (email) do nothing;`);
    sql(`
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana) values
        ('s-ham','Platos Fuertes','Hamburguesa Resplandor',30000,true,null,null),
        ('s-ham2','Desayunos','Hamburguesa Resplandor',18000,true,null,null),
        ('s-combo','Promociones','Combo hamburguesas',50000,true,'2 Hamburguesas Resplandor',2),
        ('s-ej','Ejecutivos','Seco',19000,true,null,null);
      insert into public.mesas (id, capacidad, estado, token) select g, 4, 'ocupada', lpad(to_hex(g), 48, 'b') from generate_series(61, 70) g;
      insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('s-o1', 61, 'abierta', '[]', 0, now()), ('s-o2', 62, 'abierta', '[]', 0, now()), ('s-o3', 63, 'abierta', '[]', 0, now());
    `);
    delta('s-o1', 's-ham', 'Hamburguesa Resplandor', 30000, 2);
    delta('s-o2', 's-ham', 'Hamburguesa Resplandor', 30000, 2);
    delta('s-o2', 's-combo', 'Combo hamburguesas', 50000, 1);   // la captura: el combo agregado a mano como un producto más
    delta('s-o3', 's-ej', 'Seco', 19000, 1);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('antes del sobre: 2 hamburguesas cuestan 60.000 (el combo no tiene regla); y aborta SIN tocar nada si un nombre falta, se repite, o la categoría no es la que dice', () => {
    assert.equal(Number(orden('s-o1').total), 60000);
    assert.equal(Number(orden('s-o2').total), 110000);
    assert.equal(regla(), null);
    const v0 = [orden('s-o1').version, orden('s-o2').version, orden('s-o3').version];
    // el combo repetido
    sql("insert into public.productos (id, categoria, nombre, precio, activo) values ('s-combo-dup','Promociones','Combo hamburguesas',50000,true);");
    let r = sobre();
    assert.equal(r.ok, false);
    assert.match(r.error, /Falta o está repetido un producto que la regla nombra: «Combo hamburguesas» en Promociones \(hay 2\)\..*No se aplicó nada/s);
    sql("delete from public.productos where id = 's-combo-dup';");
    // la hamburguesa con otro nombre (hay una «Hamburguesa Resplandor» en Desayunos, que NO cuenta: se busca por categoría)
    sql("update public.productos set nombre = 'Hamburguesa Resplandor XL' where id = 's-ham';");
    r = sobre();
    assert.equal(r.ok, false);
    assert.match(r.error, /«Hamburguesa Resplandor» en Platos Fuertes \(hay 0\)\..*No se aplicó nada/s);
    sql("update public.productos set nombre = 'Hamburguesa Resplandor' where id = 's-ham';");
    // el combo en otra categoría
    sql("update public.productos set categoria = 'Bebidas' where id = 's-combo';");
    r = sobre();
    assert.equal(r.ok, false);
    assert.match(r.error, /«Combo hamburguesas» en Promociones \(hay 0\)/);
    sql("update public.productos set categoria = 'Promociones' where id = 's-combo';");
    assert.equal(regla(), null, 'ningún intento escribió nada');
    assert.deepEqual([orden('s-o1').version, orden('s-o2').version, orden('s-o3').version], v0, 'ni tocó las cuentas');
  });

  test('el sobre pone {cada 2, precio 50000, la hamburguesa de Platos Fuertes (no la de Desayunos)} al combo y la cuenta abierta se RE-NORMALIZA sola: 2 hamburguesas → 50.000, con su versión subida; las otras cuentas no cambian', () => {
    const v0 = orden('s-o1').version;
    const v3 = orden('s-o3').version;
    const r = sobre();
    assert.ok(r.ok, r.error);
    assert.deepEqual(regla(), { cada: 2, precio: 50000, aplica: { productos: ['s-ham'] } });
    const o1 = orden('s-o1');
    assert.deepEqual(o1.items.map((i) => [i.id, i.qty, Number(i.precio)]), [['s-ham', 1, 30000], ['promo:s-combo:s-ham', 1, 20000]]);
    assert.equal(Number(o1.total), 50000, 'la mesa 1 de la captura queda en 50.000');
    assert.ok(o1.version > v0, 'la versión subió: las tablets y la carta reciben el cambio');
    assert.equal(orden('s-o3').version, v3, 'una cuenta sin hamburguesas se toca (updated_at) pero sus ítems no cambian: la versión es la misma');
    assert.deepEqual(orden('s-o3').items.map((i) => [i.id, i.qty, Number(i.precio)]), [['s-ej', 1, 19000]]);
    // el combo agregado a mano (la captura) queda como una línea de $ 0: el sobre no la quita, pero la base neutraliza el producto de una promo con regla y no se cobra dos veces
    const o2 = orden('s-o2');
    assert.deepEqual(o2.items.map((i) => [i.id, i.qty, Number(i.precio)]), [['s-ham', 1, 30000], ['promo:s-combo:s-ham', 1, 20000], ['s-combo', 1, 0]]);
    assert.equal(Number(o2.total), 50000, 'la cuenta con el combo agregado a mano NO lo cobra dos veces: la línea queda en 0');
    assert.equal(Number(precio()), 50000, 'y el combo tiene UN solo precio, el del grupo');
    assert.equal(pg.filas("select promo_regla from public.productos where id = 's-ham2'")[0].promo_regla, null, 'la «Hamburguesa Resplandor» de Desayunos ni se tocó');
  });

  test('el sobre deja UN solo precio aunque el combo tuviera otro: con el producto a 45.000 queda en 50.000 (el del grupo), y pegarlo otra vez no lo mueve', () => {
    sql("update public.productos set precio = 45000 where id = 's-combo';");
    assert.equal(Number(precio()), 45000);
    const r = sobre();
    assert.ok(r.ok, r.error);
    assert.equal(Number(precio()), 50000, 'el precio del producto (el que muestra la carta) es el del grupo');
    assert.deepEqual(regla(), { cada: 2, precio: 50000, aplica: { productos: ['s-ham'] } });
  });

  test('pegarlo otra vez es inocuo (la regla y las cuentas quedan igual: no vuelve a «tocar» nada)', () => {
    const cuentas = () => pg.filas('select id, items, total, version from public.ordenes order by id');
    const antes = cuentas();
    const r = sobre();
    assert.ok(r.ok, r.error);
    assert.deepEqual(regla(), { cada: 2, precio: 50000, aplica: { productos: ['s-ham'] } });
    assert.deepEqual(cuentas(), antes);
  });

  test('con el sobre puesto un martes: 3 hamburguesas → 80.000 en la cuenta abierta; el miércoles no hay promo; y la reversa de la cabecera (regla a null) devuelve las cuentas abiertas a 60.000', () => {
    delta('s-o1', 's-ham', 'Hamburguesa Resplandor', 30000, 1);
    assert.equal(Number(orden('s-o1').total), 80000);
    DIA = 3;
    sql("update public.ordenes set updated_at = now() where id = 's-o1';");
    assert.equal(Number(orden('s-o1').total), 90000, 'el miércoles: 3 × 30.000');
    DIA = 2;
    const reversaSobre = SQL_SOBRE.split('\n').find((l) => /^--\s+update public\.productos set promo_regla = null/.test(l)).replace(/^--\s+/, '');
    sql(reversaSobre);
    assert.equal(regla(), null);
    assert.equal(Number(orden('s-o1').total), 90000, 'sin la regla, 3 hamburguesas cuestan 90.000');
    assert.equal(orden('s-o1').items.every((i) => !String(i.id).startsWith('promo:')), true);
    const otra = sobre();
    assert.ok(otra.ok, otra.error);
    assert.equal(Number(orden('s-o1').total), 80000, 'y al pegar el sobre otra vez, el combo vuelve');
  });
});
