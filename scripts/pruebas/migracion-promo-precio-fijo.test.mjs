// Promociones de PRECIO FIJO: supabase/migrations/20261006170000_promo_precio_fijo.sql y el sobre docs/sobres/2026-10-06-promo-precio-fijo.sql
// (pedido de Yonatan, 2026-10-06, tareas/2026-10-06-promo-precio-fijo.md: «si agrego 2 hamburguesas resplandor no hace el descuento cuando se adiciona y queda el precio
// normal 60»: «Combo hamburguesas», 2 Hamburguesa Resplandor por $ 50.000, se aplica solo en la cuenta, como ya lo hacen las promos de descuento).
//
// Qué cambia: dos `create or replace function` y el comentario de `productos.promo_regla`:
//   · privado.promo_regla_ok acepta { cada, precio, aplica } (precio entero de 1 a 10.000.000) y exige EXACTAMENTE uno de descuento / precio;
//   · privado.normalizar_items (el cuerpo de la unión 20261006140000) calcula el precio fijo del grupo: la unidad más barata de cada grupo de N queda en
//     max(0, X − Σ de las otras N−1 unidades), nunca más que su precio de lista y solo si el grupo costaba más que X; el precio a mano entra en la suma.
//   Nada de tablas, datos ni policies; public.fijar_precio_item NO cambia (lo que escribe en una línea de promo lo recalcula el trigger del precio vivo). Desde la ronda 4, UN trigger nuevo sobre `productos`.
// Ronda 2 (refutación de 709f270): (a) una tablet con el POS de antes que agrega el producto «Combo hamburguesas» no cobra dos veces; (b) la migración es UNA transacción y aborta sin cambiar
//   nada si una promo_regla existente no pasa el validador nuevo (id y nombre en el mensaje); (c) normalizar_items salta una regla que no puede leer.
// Ronda 3 (refutación de 0d907db): (a) quedó corregida de otra manera: el producto de la promo ya NO vale 0 siempre (eso regalaba el combo vendido como producto, que era la única forma de
//   venderlo antes del sobre: 50.000 → 0 en cuentas abiertas, abonos, ventas que se deshacen y tablets sin recargar); ahora tantas unidades como GRUPOS formó la regla en esa cuenta ese día quedan
//   pagadas por esos grupos (2 hamburguesas + el combo = 50.000; el combo solo = 50.000; combo + 1 hamburguesa = 80.000), solo en promos de precio fijo de la categoría Promociones; el paso b vuelve a
//   ser el de la unión.
// Ronda 4 (refutación de 7f72e14): (a) [MEDIO] los grupos que neutralizan el producto son los COMPLETOS (las unidades que la regla alcanza ÷ N, también las de precio 0 y las del grupo que cuesta X o
//   menos): con la hamburguesa a ≤ 25.000 o con un precio a mano ya no vuelve el doble cobro y bajar un precio nunca sube la cuenta; (b) [CRÍTICO] la base no sabe si una línea del producto repite el par o
//   es un combo vendido de verdad, así que un trigger de `productos` (RS008) NO deja encender la regla de precio fijo mientras ese producto esté en una cuenta abierta o en una venta que todavía se puede
//   deshacer (el sobre, el modal de Productos y cualquier escritura del personal); sin ese producto en ninguna cuenta, la neutralización solo toca lo que una tablet sin recargar agrega después.
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
    'TODO en una sola transacción (`begin` … `commit`)', 'REVISA LAS FILAS QUE YA EXISTEN', 'lista id y nombre de cada una y dice cómo arreglarla',
    // ronda 3 y 4: la neutralización cuenta los grupos COMPLETOS que formó la regla (paso c); el producto del combo vendido solo conserva su precio; y el trigger decide lo que la base no sabe
    'NEUTRALIZA el producto de la promo de precio fijo cuando la regla FORMÓ el grupo (paso c, justo después de contar los grupos de esa regla)', 'tantas unidades como GRUPOS COMPLETOS formó la regla en esta cuenta hoy',
    'quedan pagadas por esos grupos (precio 0): el par ES el combo, y bajar el precio de una hamburguesa nunca sube la cuenta', 'TAMBIÉN las que cuestan X o menos o 0 por un precio a mano',
    '2 hamburguesas + el combo: un grupo, 50.000 en total (la línea del combo en 0)', 'el producto conserva su precio de catálogo (combo ×1 = 50.000; combo + 1 hamburguesa = 80.000)',
    '2 combos + 2 hamburguesas: 25.000 por combo, 50.000 los dos, el combo de más', 'la línea con `precio_manual` se respeta como hoy', 'un precio puesto a mano en la línea del combo es una orden explícita del mesero',
    'Solo las promos de PRECIO FIJO de la categoría Promociones', 'las de DESCUENTO no cambian ni un byte', 'a su producto, que normalmente vale 0, esta migración no le toca el precio',
    'Una cuenta sin líneas del producto de una promo de precio fijo sale byte a byte igual que antes',
    'LO QUE LA BASE NO PUEDE SABER: si una línea del producto repite el par', 'Esa decisión no la toma una heurística sino quien tiene las cuentas delante',
    'UN TRIGGER sobre `productos` (`productos_promo_precio_fijo_en_cuentas`, `BEFORE UPDATE OF promo_regla, activo, categoria`', 'RECHAZA —SQLSTATE RS008, y todo el UPDATE se deshace—', '`cierre_ordenes`',
    'cuenta ABIERTA o en una venta CERRADA que todavía se puede deshacer', 'Cubre TODOS los caminos: el sobre del combo, el modal de producto', 'Editar una promo que YA es de precio fijo y está activa',
    'EL SOBRE SE NIEGA (RS008, sin cambiar nada) mientras el combo esté vendido COMO PRODUCTO en una cuenta abierta o en una venta del turno que todavía se puede deshacer',
    'drop trigger if exists productos_promo_precio_fijo_en_cuentas on public.productos;', 'drop function if exists privado.promo_precio_fijo_en_cuentas();',
    'Una regla que NO se puede leer se salta',
    'hasta k/2 pesos (k = los grupos de ESA línea', 'cada par se REGALA sin aviso (2 hamburguesas 30.000, 4 → 60.000', 'la reversa correcta de esta migración es la de abajo, que empieza por poner la regla del combo en null',
    'recargar TODAS las tablets y comprobar, en el pie de cada una, que muestran la versión nueva (la misma que version.json publica al aire)', 'editar el combo desde esa tablet —aunque sea solo la etiqueta— sube `promo_regla: null` y BORRA la regla',
    'cambia SOLO en el paso c (el paso b es idéntico)',
  ]) assert.ok(CAB.includes(compacto(frase)), `la cabecera no dice «${frase}»`);
  assert.doesNotMatch(CAB, /menos de N pesos|deja de cumplirse/, 'el error del promedio es de hasta k/2 pesos y volver a pegar una anterior REGALA la unidad: ya no se dice lo de antes');
  assert.doesNotMatch(CAB, /vale 0 como línea, todos los días|queda con precio 0, TODOS los días|su producto ya vale 0\), y una cuenta sin líneas de productos-promo/, 'ya no dice que el producto de la promo con regla vale 0 siempre');
  // ronda 4: los textos dejan de decir lo que el código no hace (ni «nada se regala», ni «no hay nada que perder», ni «las mesas no tienen que estar vacías», ni «su producto vale 0 desde siempre»)
  assert.doesNotMatch(CAB, /nada se regala|nunca se regala|no hay nada que perder|el sobre ya no necesita|su producto vale 0\s+desde siempre|vuelven a 60\.000/, 'ya no promete lo que la base no puede cumplir (ni lo falso de las promos de descuento ni de la regla borrada)');
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
  assert.match(requisitos, /to_regclass\('public\.cierre_ordenes'\) is null[\s\S]*Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/, 'ronda 4: el trigger lee cierre_ordenes, así que pide 20261002180000');
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bgrant\b|\binsert\b|\bupdate\b/i);
});

test('normalizar_items es el de 20261006140000 (la unión) con SOLO lo declarado, todo en el paso c (el paso b es idéntico): la regla ilegible se salta, el bloque del precio fijo (v_fijo y v_pre, la CTE de los grupos con el precio de cada unidad, el precio de la línea de promo y su objeto promo) y la neutralización del producto de la promo en tantas unidades como grupos formó', () => {
  const { quitadas, agregadas } = diferencia(funcionDe(SQL_UNION, 'privado.normalizar_items'), funcionDe(SQL, 'privado.normalizar_items'));
  assert.deepEqual(quitadas, [
    'select p.id, p.nombre, p.etiqueta, p.promo_regla as regla',
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
    'v_u int;',
    'v_k int;',
    'v_m int;',
    'v_pp numeric;',
    'select p.id, p.nombre, p.etiqueta, p.categoria, p.promo_regla as regla',
    'if not privado.promo_regla_ok(v_promo.regla) then continue; end if;',
    "v_fijo := (v_promo.regla ->> 'precio')::numeric;",
    // las unidades que la regla alcanza, también las de precio 0 (ronda 4): con ellas se cuentan los grupos COMPLETOS
    '), q0 as (',
    'select e.qty',
    'from e',
    'join public.productos pr on pr.id = e.pid',
    'where e.precio >= 0 and e.qty > 0',
    'and pr.promo_regla is null',
    'and (pr.categoria = any (v_cats) or pr.id = any (v_prods))',
    'select q.i, q.precio, row_number() over (order by q.precio desc, q.i) as rn',
    '), gr as (',
    'select u.i, u.precio, u.rn, sum(u.precio) over (partition by (u.rn - 1) / v_cada) as total',
    'from u',
    'select gr.i, count(*)::int as n,',
    'round(avg(gr.precio - least(gr.precio, greatest(0, gr.total - v_fijo))))::numeric as precio_unidad',
    'from gr',
    'where gr.rn % v_cada = 0 and (v_fijo is null or gr.total > v_fijo)',
    'group by gr.i',
    "select coalesce(array_agg(d.i order by d.i), '{}'), coalesce(array_agg(d.n order by d.i), '{}'), coalesce(array_agg(d.precio_unidad order by d.i), '{}'),",
    '(select coalesce(sum(q0.qty), 0) from q0)::int',
    'into v_idx, v_cant, v_pre, v_u',
    // la neutralización del producto de la promo de precio fijo: tantas unidades como grupos COMPLETOS formó la regla (v_u ÷ N)
    "v_k := case when v_fijo is not null and v_promo.categoria ~* 'promo' then v_u / v_cada else 0 end;",
    'if v_k > 0 then',
    'select p.precio into v_pp from public.productos p where p.id = v_promo.id and p.precio is not null and p.precio > 0;',
    'if found then',
    'exit when v_k <= 0;',
    'v_item := v_lineas[v_i];',
    "if split_part(coalesce(v_item ->> 'id', ''), '__', 1) <> v_promo.id then continue; end if;",
    "if v_lineas[v_i] ->> 'precio_manual' = 'true' then continue; end if;",
    "if coalesce(nullif(v_item ->> 'precio', '')::numeric, 0) < 0 then continue; end if;",
    "v_n := coalesce(nullif(v_item ->> 'qty', '')::int, 0);",
    'if v_n <= 0 then continue; end if;',
    'v_m := least(v_n, v_k);',
    'v_k := v_k - v_m;',
    "v_lineas[v_i] := jsonb_set(v_item, '{precio}', to_jsonb(round(v_pp * (v_n - v_m) / v_n)));",
    'v_precio := case when v_fijo is null',
    "then round(coalesce(nullif(v_base ->> 'precio', '')::numeric, 0) * (100 - v_desc) / 100.0)",
    'else v_pre[v_i] end;',
    "'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0))",
    "|| case when v_fijo is null then jsonb_build_object('descuento', v_desc) else jsonb_build_object('precio_fijo', v_fijo) end",
    // el segundo recorrido de líneas (el de la neutralización) y los dos `end if;` y el `end loop;` que cierran su bloque: líneas que ya existían en otra parte del cuerpo
    'for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop',
    'end if;',
    'end if;',
    'end loop;',
  ], 'qué se agregó');
  const cp = compacto(funcionDe(SQL, 'privado.normalizar_items').join('\n'));
  // lo que NO se tocó: el pliegue, la adopción del paso a', el respeto del precio a mano (paso b) y la salida
  for (const intacto of [
    "substring(coalesce(v_item ->> 'id', '') from '^promo:[^:]*:(.+)$')",
    "if v_lineas[v_i] ->> 'precio_manual' is distinct from 'true'",
    "if v_item ->> 'precio_manual' = 'true' then continue; end if;",
    "then jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_base ->> 'precio_por'))",
  ]) assert.ok(cp.includes(intacto), `ya no está: ${intacto}`);
  // el paso b es EXACTAMENTE el de la unión (ya no neutraliza nada: el producto de la promo con regla conserva su precio de catálogo) y la neutralización va en el paso c, DESPUÉS de contar los grupos
  // y ANTES de armar las líneas de promo, saltando las líneas con precio a mano
  assert.ok(cp.includes('select p.precio into v_precio from public.productos p where p.id = v_pid and p.precio is not null and p.precio >= 0;'), 'el paso b es el de la unión');
  assert.ok(!cp.includes('when p.promo_regla is not null then 0'), 'el producto de una promo con regla ya NO se pone en 0 sin mirar los grupos (regalaba el combo vendido como producto)');
  const iGrupos = cp.indexOf('into v_idx, v_cant, v_pre, v_u from d;');
  const iNeutral = cp.indexOf('v_k := case when v_fijo is not null and v_promo.categoria ~* \'promo\'');
  const iLineas = cp.indexOf("for v_i in 1 .. coalesce(array_length(v_idx, 1), 0) loop");
  assert.ok(iGrupos > 0 && iNeutral > iGrupos && iLineas > iNeutral, 'grupos → neutralización → líneas de promo');
  assert.ok(cp.indexOf("v_lineas[v_i] ->> 'precio_manual' = 'true' then continue;") > iNeutral && cp.indexOf("v_lineas[v_i] ->> 'precio_manual' = 'true' then continue;") < iLineas, 'el precio a mano se salta dentro de la neutralización');
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

test('no toca nada más: TRES create or replace function (promo_regla_ok, normalizar_items y la del trigger de las cuentas; fijar_precio_item y el resto no), un solo GRANT (el validador para authenticated y service_role), UN solo trigger (sobre productos) y el comentario de la columna; ni tablas, policies ni datos', () => {
  assert.deepEqual([...CP.matchAll(/create or replace function ([a-z_.]+)\(/g)].map((m) => m[1]), ['privado.promo_regla_ok', 'privado.normalizar_items', 'privado.promo_precio_fijo_en_cuentas']);
  assert.equal((CP.match(/\bgrant\b/g) || []).length, 1);
  assert.match(CP, /revoke all on function privado\.promo_regla_ok\(jsonb\) from public, anon; grant execute on function privado\.promo_regla_ok\(jsonb\) to authenticated, service_role;/, 'el validador sigue siendo ejecutable por authenticated (el CHECK corre con su rol: 20261005120000)');
  assert.doesNotMatch(CP, /revoke all on function privado\.promo_regla_ok\(jsonb\) from [^;]*authenticated/, 'y NO se le quita');
  assert.match(CP, /revoke all on function privado\.promo_precio_fijo_en_cuentas\(\) from public, anon, authenticated;/, 'la función del trigger no la ejecuta nadie de la API');
  assert.equal((CP.match(/comment on column public\.productos\.promo_regla is/g) || []).length, 1);
  assert.doesNotMatch(CP, /create or replace function public\./, 'la RPC del precio a mano (public.fijar_precio_item) y deshacer_cobro_sumar no se tocan');
  // el único trigger: BEFORE UPDATE OF promo_regla, activo, categoria sobre productos (con su drop if exists para que pegarla dos veces no cambie nada)
  assert.deepEqual([...CP.matchAll(/(create|drop|alter) trigger (if exists )?([a-z_]+)/g)].map((m) => `${m[1]} ${m[3]}`), ['drop productos_promo_precio_fijo_en_cuentas', 'create productos_promo_precio_fijo_en_cuentas']);
  assert.match(CP, /create trigger productos_promo_precio_fijo_en_cuentas before update of promo_regla, activo, categoria on public\.productos for each row execute function privado\.promo_precio_fijo_en_cuentas\(\);/);
  assert.doesNotMatch(CP.replace(/(create|drop) trigger (if exists )?productos_promo_precio_fijo_en_cuentas/g, ''), /(create|drop|alter) (policy|table|trigger|view|index)|enable row level security|publication|add column|\bdrop\b/i);
  const sinCuerpos = CP.replace(/\$\$.*?\$\$/g, ' $$…$$ ');
  assert.doesNotMatch(sinCuerpos, /\bupdate\s+(public|privado)\.|\binsert into\b|\bdelete from\b|\btruncate\b/i, 'ningún dato escrito fuera de las funciones');
  // y la función del trigger solo LEE (jamás escribe) y es SECURITY DEFINER con search_path vacío
  const f = compacto(funcionDe(SQL, 'privado.promo_precio_fijo_en_cuentas').join('\n'));
  assert.match(f, /^create or replace function privado\.promo_precio_fijo_en_cuentas\(\) returns trigger language plpgsql security definer set search_path = '' as \$\$/);
  assert.doesNotMatch(f, /\b(update|insert into|delete from|truncate)\b/, 'solo lee');
  assert.match(f, /errcode = 'RS008'/);
});

test('la reversa de la cabecera: la regla del combo vuelve a null, el validador a la forma de antes (el mismo cuerpo de 20261005100000, línea por línea) con sus permisos y su comentario; y manda volver a pegar la unión ENTERA', () => {
  const rev = reversa(SQL).replace(/^--.*$/gm, '');
  const c = compacto(rev);
  assert.match(c, /^begin; update public\.productos set promo_regla = null where promo_regla \? 'precio'; create or replace function privado\.promo_regla_ok\(p_regla jsonb\)/);
  assert.match(c, /drop trigger if exists productos_promo_precio_fijo_en_cuentas on public\.productos; drop function if exists privado\.promo_precio_fijo_en_cuentas\(\); commit;$/, 'y quita el trigger y su función (ronda 4)');
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
  assert.match(fin, /position\('v_k := v_k - v_m' in v\) = 0 or position\('not privado\.promo_regla_ok\(v_promo\.regla\)' in v\) = 0/, 'y que conserva la neutralización por grupos y el salto de la regla ilegible');
  assert.match(fin, /position\('when p\.promo_regla is not null then 0' in v\) > 0/, 'y que NO vuelve a poner en 0 el producto de la promo sin mirar los grupos (regalaba el combo vendido como producto)');
  assert.match(fin, /position\('v_u \/ v_cada' in v\) = 0 or position\('where e\.precio >= 0 and e\.qty > 0' in v\) = 0/, 'ronda 4: y que cuenta los grupos COMPLETOS (también los que cuestan X o menos o 0)');
  assert.match(fin, /t\.tgname = 'productos_promo_precio_fijo_en_cuentas' and t\.tgrelid = 'public\.productos'::regclass[\s\S]*\(t\.tgtype & 2\) = 2 and \(t\.tgtype & 16\) = 16[\s\S]*position\('RS008' in pg_get_functiondef\('privado\.promo_precio_fijo_en_cuentas\(\)'::regprocedure\)\) = 0/, 'ronda 4: y que el trigger de las cuentas está (BEFORE UPDATE de productos, RS008)');
  assert.match(fin, /has_function_privilege\('anon', 'privado\.promo_precio_fijo_en_cuentas\(\)', 'execute'\) or has_function_privilege\('authenticated', 'privado\.promo_precio_fijo_en_cuentas\(\)', 'execute'\)/);
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
    'Idempotente', 'UNA transacción', 'Reversa (menos de 1 minuto', "update public.productos set promo_regla = null where categoria = 'Promociones' and nombre = 'Combo hamburguesas';",
    'Dupleta de papas', 'mezcla productos',
    // ronda 2: el orden de salida, el único precio y lo que hace la base con el producto del combo
    '1) supabase/migrations/20261006170000_promo_precio_fijo.sql (DESPUÉS de aplicar esa migración', '2) el push del POS',
    '3) recargar TODAS las tablets y comprobar, en el pie de cada una, que muestran la versión nueva (la misma que version.json publica al aire)', '4) recién entonces, este sobre',
    'sube `promo_regla: null` y BORRA la regla', 'Eso último no tiene arreglo en la base', 'UN solo precio', '`precio = 50000`',
    // ronda 3 y 4: el sobre se NIEGA (RS008) con el combo vendido como producto; después, una tablet sin recargar que lo agregue junto al par lo deja en $ 0; solo, conserva sus $ 50.000
    'ANTES DE PEGARLO (lo decide quien tiene las cuentas delante, no la base)', 'el sobre se NIEGA —error RS008, sin cambiar nada— mientras «Combo hamburguesas» esté vendido COMO PRODUCTO en una cuenta abierta o en una venta cobrada del turno que todavía se puede deshacer',
    'La base no puede saber si esa línea repite el par de hamburguesas', 'o se espera a que se cobre y a que se haga el cierre del día',
    'Como el sobre no corre con el combo vendido como producto en ninguna cuenta ni venta que se pueda deshacer', 'ninguna línea del combo cambia de precio al pegarlo',
    'DESPUÉS una tablet sin recargar agrega el combo como producto junto al par, la base lo deja en $ 0', 'solo, conserva sus $ 50.000',
    'el par de hamburguesas deja de formar el combo (60.000) y una línea del combo que la base había dejado en $ 0 vuelve a sus $ 50.000 (110.000 en total con el par)',
  ]) assert.ok(cab.includes(compacto(frase)), `el sobre no dice «${frase}»`);
  assert.doesNotMatch(cab, /el POS ya no lo ofrece|hay que quitárselo|cobraría el combo dos veces|esa línea queda en \$ 0\)/, 'ya no dice que el POS de antes no ofrece el combo ni que la línea agregada a mano se cobra dos veces ni que quede en 0 sin mirar las hamburguesas');
  assert.doesNotMatch(cab, /nada se regala|no hay nada que perder|NO cambia: la regla no formó|las cuentas abiertas\s+vuelven a 60\.000/, 'ronda 4: ni «nada se regala» ni «no hay nada que perder» ni «las cuentas abiertas vuelven a 60.000»');
  assert.match(c, /or to_regprocedure\('privado\.promo_precio_fijo_en_cuentas\(\)'\) is null/, 'y el sobre también se niega si falta el trigger de las cuentas');
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
   * El trigger de las cuentas (ronda 4), sondeado dentro de transacciones que se deshacen (nada queda): una promo de precio fijo NO se enciende (RS008) con su producto en una cuenta abierta ni en una venta
   * cobrada que ningún cierre archivó; sí con la venta archivada, sin líneas, o editando una que ya era de precio fijo y está activa. Devuelve los nombres de lo que falló.
   */
  const probarTrigger = () => {
    const mal = [];
    const linea = (id) => ({ id, nombre: 'Prueba del trigger', precio: 38000, qty: 1, nota: '' });
    const preparar = ({ items, cerrada = false, archivada = false, conRegla = false }) => `
      begin;
      insert into public.mesas (id, capacidad, estado, token) values (9001, 4, 'ocupada', lpad(to_hex(9001), 48, 'e'));
      insert into public.productos (id, categoria, nombre, precio, activo, promo_regla) values ('zt-p', 'Promociones', 'Prueba del trigger', 38000, true, ${conRegla ? `'{"cada":2,"precio":38000,"aplica":{"productos":["t-ham"]}}'::jsonb` : 'null'});
      insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('zt-o', 9001, 'abierta', ${literal(JSON.stringify(items))}::jsonb, 0, now());
      ${cerrada ? "update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 'zt-o';" : ''}
      ${archivada ? "insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('zt-c', now(), 0, 0, '[]'); insert into public.cierre_ordenes (orden_id, cierre_id) values ('zt-o', 'zt-c');" : ''}`;
    const encender = `update public.productos set promo_regla = '{"cada":2,"precio":38000,"aplica":{"productos":["t-ham"]}}'::jsonb where id = 'zt-p';`;
    const editar = `update public.productos set precio = 40000, etiqueta = 'otra', promo_regla = '{"cada":2,"precio":40000,"aplica":{"productos":["t-ham"]}}'::jsonb where id = 'zt-p';`;
    const corre = (guion) => pg.sql(`\\set VERBOSITY verbose\n${guion}\nrollback;`);
    const sea = (nombre, r, seNiega) => {
      if (seNiega && (r.ok || !/RS008/.test(r.error))) mal.push(nombre);
      if (!seNiega && !r.ok) mal.push(`${nombre} (${String(r.error).slice(0, 80)})`);
    };
    try {
      sea('trigger: con el producto en una cuenta ABIERTA no se enciende', corre(preparar({ items: [linea('zt-p')] }) + encender), true);
      sea('trigger: con el producto en una cuenta abierta, en su variante con nota (id con «__»), tampoco', corre(preparar({ items: [linea('zt-p__sin-sal')] }) + encender), true);
      sea('trigger: con el producto en una venta COBRADA que se puede deshacer no se enciende', corre(preparar({ items: [linea('zt-p')], cerrada: true }) + encender), true);
      sea('trigger: con la venta cobrada ya ARCHIVADA en un cierre del día sí se enciende', corre(preparar({ items: [linea('zt-p')], cerrada: true, archivada: true }) + encender), false);
      sea('trigger: sin el producto en ninguna cuenta se enciende', corre(preparar({ items: [{ ...linea('t-ham'), precio: 30000 }] }) + encender), false);
      sea('trigger: editar una promo que YA era de precio fijo y está activa no despierta nada (aunque su producto esté en una cuenta)', corre(preparar({ items: [linea('zt-p')], conRegla: true }) + editar), false);
    } catch (e) {
      mal.push('trigger lanzó: ' + String(e.message).slice(0, 120));
    }
    return mal;
  };

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
      // el producto de la promo (el combo vendido COMO PRODUCTO: una tablet con el POS de antes, o una cuenta de antes de la regla) no se cobra dos veces, pero tampoco se regala:
      // tantas unidades como GRUPOS formó la regla quedan pagadas por esos grupos. 2 hamburguesas + el combo = 50.000 (no 100.000); el combo solo, 50.000; con 1 hamburguesa, 80.000
      const combo = (extra = {}) => ({ id: 't-combo', nombre: 'Combo hamburguesas', precio: 50000, qty: 1, nota: '', ...extra });
      const suma = (xs) => xs.reduce((a, i) => a + i.precio * i.qty, 0);
      const doble = norma([ham(2), combo()], 2);
      sea('2 hamburguesas + el combo vendido como producto = 50.000, no 100.000 (el par ya lo formó: la línea del producto vale 0)', suma(doble) === 50000 && Number(doble.find((i) => i.id === 't-combo').precio) === 0);
      sea('el combo solo conserva sus 50.000 (nada se regala)', suma(norma([combo()], 2)) === 50000);
      sea('el combo con 1 hamburguesa = 80.000 (la regla no formó grupos)', suma(norma([ham(1), combo()], 2)) === 80000);
      sea('2 combos + 2 hamburguesas = 100.000 (el grupo paga UN combo, el otro se cobra)', suma(norma([ham(2), combo({ qty: 2 })], 2)) === 100000);
      sea('4 hamburguesas + 2 combos = 100.000 (dos grupos pagan los dos)', suma(norma([ham(4), combo({ qty: 2 })], 2)) === 100000);
      sea('otro día no hay grupos: el combo conserva su precio (110.000)', suma(norma([ham(2), combo()], 3)) === 110000);
      sea('el producto del combo con precio a mano conserva su precio', suma(norma([ham(2), combo({ precio: 40000, precio_manual: true })], 2)) === 90000);
      // un producto con regla de precio fijo FUERA de Promociones (el modal no los escribe; aquí 't-fuera', solo los domingos) conserva su precio: la neutralización es solo de la categoría de promociones
      const fuera = norma([ham(2), { id: 't-fuera', nombre: 'Combo fuera de promociones', precio: 50000, qty: 1, nota: '' }], 7);
      sea('un producto con regla FUERA de Promociones no se neutraliza (2 hamburguesas + ese producto = 100.000)', suma(fuera) === 100000 && Number(fuera.find((i) => i.id === 't-fuera').precio) === 50000);
      // ronda 4: el par ES el combo aunque cueste X o menos, o 0 por un precio a mano; bajar un precio nunca sube la cuenta (antes: 100.000 a 25.000 y 90.000 a 20.000 con el combo en la cuenta)
      const barata = (p) => ham(2, { precio_manual: true, precio: p });
      sea('la hamburguesa a 26.000 + el combo = 50.000 (el grupo cuesta más que X: línea de promo)', suma(norma([barata(26000), combo()], 2)) === 50000);
      sea('la hamburguesa a 25.000 + el combo = 50.000, no 100.000 (el grupo cuesta exactamente X: sin línea de promo)', suma(norma([barata(25000), combo()], 2)) === 50000);
      sea('la hamburguesa a 20.000 + el combo = 40.000, no 90.000 (el grupo cuesta menos que X)', suma(norma([barata(20000), combo()], 2)) === 40000);
      sea('la hamburguesa a 0 + el combo = 0 (las unidades a precio 0 también forman el grupo)', suma(norma([barata(0), combo()], 2)) === 0);
      sea('3 hamburguesas a 25.000 + 2 combos = 125.000 (el grupo paga UN combo)', suma(norma([ham(3, { precio_manual: true, precio: 25000 }), combo({ qty: 2 })], 2)) === 125000);
      const okForma = (r) => pg.filas(`select privado.promo_regla_ok(${literal(JSON.stringify(r))}::jsonb) as ok`)[0].ok;
      sea('validador: {cada, precio, aplica} vale', okForma({ cada: 2, precio: 50000, aplica: { productos: ['x'] } }));
      sea('validador: los dos a la vez no', !okForma({ cada: 2, descuento: 20, precio: 50000, aplica: { productos: ['x'] } }));
      sea('validador: ninguno no', !okForma({ cada: 2, aplica: { productos: ['x'] } }));
      sea('validador: precio 0 no', !okForma({ cada: 2, precio: 0, aplica: { productos: ['x'] } }));
      sea('validador: precio pasado de 10.000.000 no', !okForma({ cada: 2, precio: 10000001, aplica: { productos: ['x'] } }));
      sea('validador: precio 10.000.000 sí', okForma({ cada: 2, precio: 10000000, aplica: { productos: ['x'] } }));
      mal.push(...probarTrigger());
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
        ('t-fuera','Platos Fuertes','Combo fuera de promociones',50000,true,null,7,'{"cada":2,"precio":50000,"aplica":{"productos":["t-ham"]}}'),
        ('t-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}');
      insert into public.mesas (id, capacidad, estado, token) select g, 4, 'ocupada', lpad(to_hex(g), 48, 'a') from generate_series(91, 140) g;
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('cambia SOLO privado.promo_regla_ok y privado.normalizar_items (cuerpo nuevo; mismos nombres, argumentos y permisos) y el comentario de promo_regla, y suma UNA función (la del trigger de las cuentas, sin EXECUTE para la API) con su trigger sobre productos: ninguna otra función, tabla, vista, policy, restricción ni permiso', () => {
    const clave = (f) => JSON.stringify(f);
    for (const seccion of Object.keys(antes)) {
      if (seccion === 'funciones' || seccion === 'triggers') continue;
      assert.deepEqual(despues[seccion], antes[seccion], `${seccion}: cambió`);
    }
    // el único trigger nuevo: BEFORE UPDATE de productos
    const nuevosTriggers = despues.triggers.filter((n) => !antes.triggers.some((a) => clave(a) === clave(n)));
    assert.deepEqual(nuevosTriggers.map((x) => `${x.tabla}.${x.tgname}`), ['productos.productos_promo_precio_fijo_en_cuentas'], 'el único trigger nuevo');
    assert.equal(despues.triggers.length, antes.triggers.length + 1, 'y ninguno quitado');
    const distintas = despues.funciones.filter((f) => !antes.funciones.some((a) => clave(a) === clave(f)));
    const cambiadas = distintas.filter((f) => antes.funciones.some((a) => a.nspname === f.nspname && a.proname === f.proname));
    const nuevas = distintas.filter((f) => !antes.funciones.some((a) => a.nspname === f.nspname && a.proname === f.proname));
    assert.deepEqual(cambiadas.map((f) => `${f.nspname}.${f.proname}`).sort(), ['privado.normalizar_items', 'privado.promo_regla_ok'], 'las únicas funciones con otro cuerpo');
    assert.deepEqual(nuevas.map((f) => `${f.nspname}.${f.proname}`), ['privado.promo_precio_fijo_en_cuentas'], 'y la única nueva');
    assert.doesNotMatch(nuevas[0].acl || '', /anon|authenticated|service_role|(^\{|,)=X\//, 'la función del trigger no la ejecuta nadie de la API (ni public)');
    for (const nueva of cambiadas) {
      const vieja = antes.funciones.find((f) => f.nspname === nueva.nspname && f.proname === nueva.proname);
      assert.equal(nueva.args, vieja.args, `${nueva.proname}: mismos argumentos`);
      assert.equal(nueva.acl, vieja.acl, `${nueva.proname}: mismo permiso`);
      assert.notEqual(nueva.cuerpo, vieja.cuerpo, `${nueva.proname}: otro cuerpo`);
    }
    assert.doesNotMatch(cambiadas.find((f) => f.proname === 'normalizar_items').acl || '', /anon|authenticated/, 'normalizar_items sigue sin EXECUTE para la API');
    assert.match(cambiadas.find((f) => f.proname === 'promo_regla_ok').acl || '', /authenticated=X/, 'el validador sigue siendo ejecutable por authenticated (20261005120000)');
    assert.equal(despues.funciones.length, antes.funciones.length + 1, 'ninguna función de más ni de menos (salvo la del trigger)');
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

  test('RONDA 4 (bajo): el producto de una promo de DESCUENTO con precio propio (el modal lo conserva a propósito) NO se neutraliza: su línea se cobra aparte de su descuento, como desde 20261005100000 (así no es cierto que «su producto vale 0 desde siempre»)', () => {
    DIA = 1;
    sql("update public.productos set precio = 12000 where id = 't-pr3';");
    try {
      CUENTA = abrir('p-b1');
      delta(CUENTA, 't-pr3', '3er almuerzo', 12000, 1);
      delta(CUENTA, 't-ej1', 'Menú Resplandor', 23000, 2);
      const o = delta(CUENTA, 't-ej2', 'Seco', 19000, 1);
      assert.equal(Number(linea(o, 't-pr3').precio), 12000, 'la línea del producto de la promo de descuento conserva su precio propio');
      assert.deepEqual(forma(o).filter(([id]) => id === 'promo:t-pr3:t-ej2'), [['promo:t-pr3:t-ej2', 1, 15200]], 'y el descuento del 20 % cae en el Seco');
      assert.equal(Number(o.total), 12000 + 2 * 23000 + 15200);
    } finally {
      sql("update public.productos set precio = 0 where id = 't-pr3';");
    }
    DIA = 2;
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

  test('EL COMBO VENDIDO COMO PRODUCTO (la única forma de venderlo antes de la regla, y la que una tablet con el POS de antes sigue usando): solo conserva sus 50.000, con 1 hamburguesa son 80.000, con el par que lo forma la cuenta queda en 50.000 (la línea del producto en $ 0; antes 100.000), 2 combos + 2 hamburguesas son 100.000 y el precio a mano se respeta', () => {
    DIA = 2;
    CUENTA = abrir('p-d1');
    // (1) el combo solo: nada se regala (con el producto en 0 siempre, ronda 2, quedaba en 0)
    let o = delta(CUENTA, 't-combo', 'Combo hamburguesas', 50000, 1);
    assert.deepEqual(forma(o), [['t-combo', 1, 50000]]);
    assert.equal(Number(o.total), 50000);
    // (2) con UNA hamburguesa la regla no forma grupo
    o = HAM(1);
    assert.deepEqual(forma(o), [['t-combo', 1, 50000], ['t-ham', 1, 30000]]);
    assert.equal(Number(o.total), 80000, 'antes de la regla también eran 80.000');
    // (3) con el par, la regla forma el combo y la línea del producto queda pagada por él: 50.000, no 100.000
    o = HAM(1);
    assert.deepEqual(forma(o), [['t-combo', 1, 0], ['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000]], 'la regla da el combo y la línea del producto vale 0');
    assert.equal(Number(o.total), 50000, 'sin la neutralización eran 100.000');
    assert.equal(Number(orden(CUENTA).total), 50000, 'y es lo que quedó guardado');
    // (4) quitar una hamburguesa deshace el grupo: el combo recupera su precio
    o = HAM(-1);
    assert.deepEqual(forma(o), [['t-combo', 1, 50000], ['t-ham', 1, 30000]]);
    assert.equal(Number(o.total), 80000);
    // (5) otro día no hay grupos: el combo conserva su precio aunque haya 2 hamburguesas; y la misma cuenta, tocada el martes, vuelve a pagar el combo con el par
    CUENTA = abrir('p-d1b');
    delta(CUENTA, 't-combo', 'Combo hamburguesas', 50000, 1);
    DIA = 3;
    o = HAM(2);
    assert.deepEqual(forma(o), [['t-combo', 1, 50000], ['t-ham', 2, 30000]]);
    assert.equal(Number(o.total), 110000, 'un miércoles el combo del martes no aplica: 50.000 + 60.000');
    DIA = 2;
    sql("update public.ordenes set updated_at = now() where id = 'p-d1b';");
    o = orden('p-d1b');
    assert.equal(Number(o.total), 50000, 'el martes, con el par, queda en 50.000');
    DIA = 3;
    sql("update public.ordenes set updated_at = now() where id = 'p-d1b';");
    assert.equal(Number(orden('p-d1b').total), 110000, 'y el miércoles el combo recupera su precio (se calcula desde el catálogo, no desde lo que traiga la línea)');
    DIA = 2;
    // (6) 2 combos + 2 hamburguesas: el grupo paga UN combo, el otro se cobra (la línea se promedia: 25.000 por combo)
    CUENTA = abrir('p-d2');
    delta(CUENTA, 't-combo', 'Combo hamburguesas', 50000, 2);
    o = HAM(2);
    assert.deepEqual(forma(o), [['t-combo', 2, 25000], ['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000]]);
    assert.equal(Number(o.total), 100000);
    // (7) 4 hamburguesas + 2 combos: dos grupos pagan los dos
    CUENTA = abrir('p-d3');
    delta(CUENTA, 't-combo', 'Combo hamburguesas', 50000, 2);
    o = HAM(4);
    assert.deepEqual(forma(o), [['t-combo', 2, 0], ['t-ham', 2, 30000], ['promo:t-combo:t-ham', 2, 20000]]);
    assert.equal(Number(o.total), 100000);
    // (8) la variante con nota (id con «__»): la misma cuenta
    CUENTA = abrir('p-d4');
    HAM(2);
    o = delta(CUENTA, 't-combo__sin-sal', 'Combo hamburguesas', 50000, 1, 'sin sal');
    assert.deepEqual(forma(o), [['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000], ['t-combo__sin-sal', 1, 0]]);
    assert.equal(Number(o.total), 50000);
    // (9) un precio a mano en esa línea se respeta como hoy; «Volver al precio de carta» la devuelve a lo que le toca (0 con el par)
    CUENTA = abrir('p-d5');
    HAM(2);
    delta(CUENTA, 't-combo', 'Combo hamburguesas', 50000, 1);
    const f = fijar('mesero', CUENTA, 't-combo', 40000);
    assert.ok(f.ok, f.error);
    o = f.filas[0];
    assert.equal(Number(linea(o, 't-combo').precio), 40000);
    assert.equal(linea(o, 't-combo').precio_manual, true);
    assert.equal(Number(o.total), 90000, '30.000 + 20.000 + 40.000 a mano');
    const g = fijar('mesero', CUENTA, 't-combo', null);
    assert.ok(g.ok, g.error);
    assert.equal(Number(linea(g.filas[0], 't-combo').precio), 0);
    assert.equal(linea(g.filas[0], 't-combo').precio_manual, undefined);
    assert.equal(Number(g.filas[0].total), 50000);
    // (10) el producto de una promo de DESCUENTO ya valía 0: sigue igual
    CUENTA = abrir('p-d2d');
    DIA = 1;
    delta(CUENTA, 't-ej1', 'Menú Resplandor', 23000, 2);
    o = delta(CUENTA, 't-pr3', '3er almuerzo', 0, 1);
    assert.deepEqual(forma(o), [['t-ej1', 2, 23000], ['t-pr3', 1, 0]]);
    assert.equal(Number(o.total), 46000);
    DIA = 2;
  });

  test('el combo vendido como producto y la venta: un ABONO, el cobro POR PARTES y «Deshacer» el cobro (completo y parcial) después de la regla no lo regalan ni devuelven de menos: la cuenta reabierta vuelve a deber lo mismo', () => {
    DIA = 2;
    // un abono de 30.000 sobre combo + Seco: 50.000 + 19.000 − 30.000 (con el combo en 0 quedaba −11.000: la cuenta le «debía» al cliente)
    const a = abrir('p-d6');
    delta(a, 't-combo', 'Combo hamburguesas', 50000, 1);
    delta(a, 't-ej2', 'Seco', 19000, 1);
    assert.equal(Number(orden(a).total), 69000);
    const r = llamar('mesero', `select public.cobrar_abono(${literal(a)}, ${Number(orden(a).version)}, '{"id":"p-v-abono","uid":"pab1"}'::jsonb, 30000, 'efectivo', 'p-d-ab1') as r`);
    assert.ok(r.ok, r.error);
    assert.equal(r.filas[0].r.ok, true);
    assert.equal(Number(orden(a).total), 39000);
    assert.equal(Number(linea(orden(a), 't-combo').precio), 50000, 'el combo sigue en 50.000');
    // el combo cobrado POR PARTES (una venta de 50.000) y deshecho DESPUÉS de la regla: se devuelven 50.000 y el combo vuelve a la cuenta a 50.000 (no a $ 0)
    const c = abrir('p-d7');
    delta(c, 't-combo', 'Combo hamburguesas', 50000, 1);
    delta(c, 't-ej2', 'Seco', 19000, 1);
    const p = llamar('mesero', `select public.cobrar_parcial(${literal(c)}, ${Number(orden(c).version)}, '{"id":"p-v-parcial"}'::jsonb, '[{"id":"t-combo","qty":1}]'::jsonb, 'p-d-parc1') as r`);
    assert.ok(p.ok, p.error);
    assert.equal(p.filas[0].r.ok, true, JSON.stringify(p.filas[0].r));
    assert.equal(Number(orden(c).total), 19000, 'queda el Seco');
    const dp = llamar('mesero', "select public.deshacer_cobro('p-v-parcial') as r");
    assert.ok(dp.ok, dp.error);
    assert.equal(dp.filas[0].r.ok, true);
    assert.equal(Number(dp.filas[0].r.monto), 50000, 'se devolvieron los 50.000 del combo');
    assert.equal(Number(orden(c).total), 69000, 'y el combo volvió a la cuenta a 50.000 (no a 0)');
    assert.equal(Number(linea(orden(c), 't-combo').precio), 50000);
    // la venta COMPLETA del combo solo, deshecha después: monto 50.000 y la cuenta reabierta vuelve a deber 50.000
    const d = abrir('p-d8');
    delta(d, 't-combo', 'Combo hamburguesas', 50000, 1);
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 'p-d8';");
    assert.equal(Number(orden(d).total), 50000, 'cerrada a 50.000');
    const dc = llamar('mesero', "select public.deshacer_cobro('p-d8') as r");
    assert.ok(dc.ok, dc.error);
    assert.equal(dc.filas[0].r.ok, true);
    assert.equal(Number(dc.filas[0].r.monto), 50000);
    assert.equal(Number(dc.filas[0].r.total_abierta), 50000, 'la cuenta reabierta vuelve a deber lo que se devolvió');
    assert.equal(Number(orden(d).total), 50000);
  });

  test('RONDA 4 (crítico): una promo que HOY se vende como producto (Dupleta de papas 38.000) NO se vuelve automática desde Productos mientras esté en una cuenta abierta o en una venta cobrada que todavía se puede deshacer: RS008 con las mesas en el mensaje (admin y mesero), la regla no queda; con la venta archivada en un cierre, sin la línea, editando una que ya era de precio fijo o apagándola, sí', () => {
    DIA = 4;
    sql(`insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
           ('t-pap','Platos Fuertes','Papas sueltas',25000,true,null,null,null),
           ('t-dup','Promociones','Dupleta de papas',38000,true,null,null,null);`);
    const REGLA = `'{"cada":2,"precio":38000,"aplica":{"productos":["t-pap"]}}'::jsonb`;
    const escribir = (set, quien = 'admin') => pg.sql(`set resplandor.dia_promo = ${DIA};\n\\set VERBOSITY verbose\nupdate public.productos set ${set} where id = 't-dup';`, como(quien));
    const encender = (quien) => escribir(`precio = 38000, promo_regla = ${REGLA}`, quien);
    const reglaDup = () => pg.filas("select promo_regla from public.productos where id = 't-dup'")[0].promo_regla;
    try {
      const abierta = abrir('p-d9');
      const mesaAbierta = mesa;
      delta(abierta, 't-dup', 'Dupleta de papas', 38000, 1);
      const venta = abrir('p-d9v');
      const mesaVenta = mesa;
      delta(venta, 't-dup', 'Dupleta de papas', 38000, 2);
      sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 'p-d9v';");
      const antesCuentas = [orden(abierta), orden(venta)];
      // (1) como admin y como mesero (la RLS deja editar productos a los dos): se niega, lista las dos mesas y no cambia nada
      for (const quien of ['admin', 'mesero']) {
        const r = encender(quien);
        assert.equal(r.ok, false, `${quien}: tenía que negarse`);
        assert.match(r.error, /RS008/, quien);
        assert.match(r.error, /La promoción «Dupleta de papas» no se puede aplicar sola todavía: su producto está vendido en: /, quien);
        assert.ok(r.error.includes(`mesa ${mesaAbierta} (cuenta abierta: 1 unidad)`), `${quien}: no lista la cuenta abierta: ${r.error}`);
        assert.ok(r.error.includes(`mesa ${mesaVenta} (venta cobrada que todavía se puede deshacer: 2 unidades)`), `${quien}: no lista la venta que se puede deshacer: ${r.error}`);
        assert.match(r.error, /Quita esas líneas con la ✕ si repiten el grupo, o espera a que se cobren y a que se haga el cierre del día/, quien);
        assert.match(r.error, /No se cambió nada\./, quien);
        assert.deepEqual(r.avisos, [], `${quien}: sin WARNING`);
        assert.equal(reglaDup(), null, `${quien}: la regla no quedó`);
      }
      assert.deepEqual([orden(abierta), orden(venta)], antesCuentas, 'las cuentas no se tocaron');
      // (2) la venta ya archivada en un cierre del día NO cuenta (ya no se puede deshacer): solo queda la cuenta abierta
      sql("insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('t-cierre-dup', now(), 76000, 1, '[]'); insert into public.cierre_ordenes (orden_id, cierre_id) values ('p-d9v', 't-cierre-dup');");
      let r = encender('admin');
      assert.equal(r.ok, false);
      assert.ok(r.error.includes(`mesa ${mesaAbierta} (cuenta abierta: 1 unidad)`) && !r.error.includes(`mesa ${mesaVenta}`), `ahora solo la cuenta abierta: ${r.error}`);
      // (3) quitada la línea de la cuenta abierta (la ✕), se enciende
      delta(abierta, 't-dup', 'Dupleta de papas', 38000, -1);
      r = encender('admin');
      assert.ok(r.ok, r.error);
      assert.deepEqual(r.avisos, []);
      assert.deepEqual(reglaDup(), { cada: 2, precio: 38000, aplica: { productos: ['t-pap'] } });
      // (4) una tablet sin recargar que la agrega DESPUÉS, junto al par que la forma: la base la deja en 0 (el par ya la formó), y sola conserva su precio
      let o = delta(abierta, 't-dup', 'Dupleta de papas', 38000, 1);
      assert.deepEqual(forma(o), [['t-dup', 1, 38000]], 'sola conserva sus 38.000');
      o = delta(abierta, 't-pap', 'Papas sueltas', 25000, 2);
      assert.deepEqual(forma(o), [['t-dup', 1, 0], ['t-pap', 1, 25000], ['promo:t-dup:t-pap', 1, 13000]], 'con las 2 papas que la forman, la línea del producto queda pagada por el grupo');
      assert.equal(Number(o.total), 38000);
      // (5) editar una promo que YA es de precio fijo y está activa (el precio del grupo, la etiqueta) no despierta nada, aunque haya una línea suya en la cuenta
      r = escribir(`precio = 40000, promo_regla = '{"cada":2,"precio":40000,"aplica":{"productos":["t-pap"]}}'::jsonb`, 'mesero');
      assert.ok(r.ok, r.error);
      // apagarla y quitarle la regla tampoco
      r = escribir('activo = false', 'admin');
      assert.ok(r.ok, r.error);
      // pero volver a ACTIVARLA con la línea en la cuenta sí es encenderla: se niega
      r = escribir('activo = true', 'admin');
      assert.equal(r.ok, false, 'activar de nuevo una promo de precio fijo con su producto en una cuenta tiene que negarse');
      assert.match(r.error, /RS008/);
      delta(abierta, 't-dup', 'Dupleta de papas', 38000, -1);
      r = escribir('activo = true', 'admin');
      assert.ok(r.ok, r.error);
      r = escribir('promo_regla = null', 'admin');
      assert.ok(r.ok, r.error);
      // (6) y con la regla quitada, una regla de DESCUENTO sobre el mismo producto no dispara nada (solo las de precio fijo)
      r = escribir(`promo_regla = '{"cada":2,"descuento":50,"aplica":{"productos":["t-pap"]}}'::jsonb`, 'admin');
      assert.ok(r.ok, r.error);
    } finally {
      sql("delete from public.cierre_ordenes where cierre_id = 't-cierre-dup'; delete from public.cierres where id = 't-cierre-dup'; delete from public.ordenes where id in ('p-d9', 'p-d9v'); delete from public.productos where id in ('t-dup', 't-pap');");
    }
  });

  test('RONDA 4 (medio): bajar un precio NUNCA sube la cuenta. Con el combo en la cuenta (el de una tablet sin recargar) y 2 hamburguesas, la hamburguesa a mano a 30.000, 26.000, 25.001, 25.000, 20.000, 10.000, 1 y 0 deja 50.000, 50.000, 50.000, 50.000, 40.000, 20.000, 2 y 0 (antes 100.000 a 25.000 y 90.000 a 20.000); lo mismo por catálogo; 3 hamburguesas a 25.000 + 2 combos = 125.000; el combo a mano se respeta', () => {
    DIA = 2;
    CUENTA = abrir('p-m1');
    HAM(2);
    let o = delta(CUENTA, 't-combo', 'Combo hamburguesas', 50000, 1);
    assert.deepEqual(forma(o), [['t-ham', 1, 30000], ['promo:t-combo:t-ham', 1, 20000], ['t-combo', 1, 0]]);
    const esperados = new Map([[30000, 50000], [26000, 50000], [25001, 50000], [25000, 50000], [20000, 40000], [10000, 20000], [1, 2], [0, 0]]);
    let previo = Infinity;
    for (const [precioMano, totalEsperado] of esperados) {
      const f = fijar('mesero', CUENTA, 't-ham', precioMano);
      assert.ok(f.ok, f.error);
      o = f.filas[0];
      assert.equal(Number(o.total), totalEsperado, `la hamburguesa a mano a ${precioMano}: ${JSON.stringify(forma(o))}`);
      assert.equal(Number(linea(o, 't-combo').precio), 0, `${precioMano}: la línea del combo la paga el par`);
      assert.ok(Number(o.total) <= previo, `${precioMano}: bajar el precio SUBIÓ la cuenta (${o.total} > ${previo})`);
      previo = Number(o.total);
    }
    // volver a la carta: 50.000 otra vez
    const v = fijar('mesero', CUENTA, 't-ham', null);
    assert.ok(v.ok, v.error);
    assert.equal(Number(v.filas[0].total), 50000);
    // lo mismo por catálogo (sin precio a mano): la hamburguesa a 25.000 y a 20.000 en la carta
    try {
      for (const [precioCarta, totalEsperado] of [[26000, 50000], [25000, 50000], [20000, 40000], [30000, 50000]]) {
        sql(`update public.productos set precio = ${precioCarta} where id = 't-ham';`);
        assert.equal(Number(orden(CUENTA).total), totalEsperado, `la carta a ${precioCarta}: ${JSON.stringify(forma(orden(CUENTA)))}`);
      }
      // 3 hamburguesas a 25.000 (un grupo de 50.000 = X, sin línea de promo) + 2 combos: el grupo paga UNO, el otro se cobra → 75.000 + 50.000
      sql("update public.productos set precio = 25000 where id = 't-ham';");
      const c = abrir('p-m2');
      delta(c, 't-ham', 'Hamburguesa Resplandor', 25000, 3);
      o = delta(c, 't-combo', 'Combo hamburguesas', 50000, 2);
      assert.deepEqual(forma(o), [['t-ham', 3, 25000], ['t-combo', 2, 25000]]);
      assert.equal(Number(o.total), 125000);
    } finally {
      sql("update public.productos set precio = 30000 where id = 't-ham';");
    }
    // el precio a mano en la línea del combo es una ORDEN explícita del mesero: se respeta (95.000), y «Volver al precio de carta» la deja otra vez en lo que le toca (0 con el par)
    const m = abrir('p-m3');
    CUENTA = m;
    HAM(2);
    delta(m, 't-combo', 'Combo hamburguesas', 50000, 1);
    assert.equal(Number(orden(m).total), 50000);
    const f45 = fijar('mesero', m, 't-combo', 45000);
    assert.ok(f45.ok, f45.error);
    assert.equal(Number(f45.filas[0].total), 95000, 'el combo a mano a 45.000: 50.000 del par + 45.000 puestos a mano');
    const f0 = fijar('mesero', m, 't-combo', null);
    assert.ok(f0.ok, f0.error);
    assert.equal(Number(f0.filas[0].total), 50000);
  });

  test('DIFERENCIAL: una cuenta sin líneas del producto de una promo de precio fijo sale BYTE A BYTE igual que sin la neutralización ni el salto (la misma función sin ese bloque), con el catálogo completo, y que la unión 20261006140000 con un catálogo de solo descuento; con esas líneas la ÚNICA diferencia es el precio de la línea del producto, que nunca sube y solo cambia si la regla formó grupos; primera y segunda pasada, los 8 días', () => {
    const reciente = (sql, ancla) => {
      const a = sql.search(/^create or replace function privado\.normalizar_items\(/m);
      assert.ok(a >= 0, ancla);
      return sql.slice(a, sql.indexOf('\nend $$;', a) + '\nend $$;'.length);
    };
    const union = reciente(SQL_UNION, 'la unión').replace('privado.normalizar_items(', () => 'privado.normalizar_items_union(');
    // «la de antes de la neutralización»: la nueva sin su bloque de neutralización (de `v_k := …` hasta el recorrido de las líneas de promo) y sin el salto de la regla ilegible
    let ref = reciente(SQL, 'la nueva').replace('privado.normalizar_items(', () => 'privado.normalizar_items_ref(');
    const desde = ref.indexOf("      v_k := case when v_fijo is not null and v_promo.categoria ~* 'promo'");
    const hasta = ref.indexOf('      for v_i in 1 .. coalesce(array_length(v_idx, 1), 0) loop');
    assert.ok(desde > 0 && hasta > desde, 'no encuentro el bloque de la neutralización');
    ref = ref.slice(0, desde) + ref.slice(hasta);
    assert.ok(!ref.includes('v_m := least'), 'el bloque entero se fue');
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
      create temp table dif (fase text, k int, dia int, items jsonb, a jsonb, r jsonb, u jsonb, a2 jsonb, r2 jsonb, u2 jsonb);
      do $$
      declare
        ids text[] := array['t-ham','te-a','te-b','t-ej1','t-ej2','t-ham__sin-sal','te-b__x','t-ham__otra','t-pr3','t-pr3__x','manual_1','abono_recibido_9','para_llevar','zz-noexiste'];
        ids_c text[] := array['t-ham','t-ham','t-ham','te-a','te-b','t-ej1','t-ham__sin-sal','t-combo','t-combo','t-combo__x','t-fuera','manual_1','para_llevar','zz-noexiste'];
        fase text; k int; j int; nl int; items jsonb; it jsonb; idx text; dia int; a jsonb; r jsonb; u jsonb; lista text[];
      begin
        -- A: catálogo completo, sin líneas del producto de la promo de precio fijo; C: con ellas; B: catálogo de SOLO descuento (la unión no sabe de precio fijo)
        for fase in select unnest(array['A', 'C', 'B']) loop
          if fase = 'B' then update public.productos set promo_regla = null where promo_regla ? 'precio'; end if;
          lista := case when fase = 'C' then ids_c else ids end;
          perform setseed(0.4242);
          for k in 1..400 loop
            nl := 1 + floor(random() * 6)::int;
            items := '[]';
            for j in 1..nl loop
              idx := lista[1 + floor(random() * array_length(lista, 1))::int];
              if items @> jsonb_build_array(jsonb_build_object('id', idx)) then continue; end if;
              it := jsonb_build_object('id', idx, 'nombre', 'N' || idx,
                      'precio', case when idx like 'abono%' then -10000 when idx = 'para_llevar' then 0
                                     when random() < (case when fase = 'C' then 0.45 else 0.15 end) then (1 + floor(random() * 80))::int * 1000 + (case when random() < 0.3 then 1 else 0 end)
                                     else coalesce((select pr.precio from public.productos pr where pr.id = split_part(idx, '__', 1)), 5000) end,
                      'qty', 1 + floor(random() * 5)::int, 'nota', case when random() < 0.2 then 'nota' else '' end);
              if random() < 0.15 and idx not like 'manual%' and idx not like 'abono%' then it := it || '{"precio_manual":true,"precio_por":"a@b.test"}'; end if;
              items := items || jsonb_build_array(it);
            end loop;
            for dia in 0..7 loop
              a := privado.normalizar_items(items, nullif(dia, 0)::smallint);
              r := privado.normalizar_items_ref(items, nullif(dia, 0)::smallint);
              u := case when fase = 'B' then privado.normalizar_items_union(items, nullif(dia, 0)::smallint) end;
              insert into dif values (fase, k, dia, items, a, r, u, privado.normalizar_items(a, nullif(dia, 0)::smallint), privado.normalizar_items_ref(r, nullif(dia, 0)::smallint),
                                      case when fase = 'B' then privado.normalizar_items_union(u, nullif(dia, 0)::smallint) end);
            end loop;
          end loop;
        end loop;
      end $$;
      -- el JSON sin el precio de las líneas del producto de la promo (t-combo y sus variantes), con el orden de las líneas
      create function pg_temp.sin_precio_combo(j jsonb) returns text language sql as $f$
        select coalesce(jsonb_agg(case when split_part(e ->> 'id', '__', 1) = 't-combo' then e - 'precio' else e end order by o)::text, '[]')
          from jsonb_array_elements(j) with ordinality as t(e, o) $f$;
      -- las unidades de la hamburguesa (y sus variantes con nota) en las líneas de ENTRADA: con menos de 2 la regla no puede formar un grupo
      create function pg_temp.hams(j jsonb) returns int language sql as $f$
        select coalesce(sum((e ->> 'qty')::int), 0)::int from jsonb_array_elements(j) e where split_part(e ->> 'id', '__', 1) = 't-ham' $f$;
      create function pg_temp.suma_combo(j jsonb) returns numeric language sql as $f$
        select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) from jsonb_array_elements(j) e where split_part(e ->> 'id', '__', 1) = 't-combo' $f$;
      select json_build_object(
        'casos', (select count(*) from dif),
        'dist_ref_1', (select count(*) from dif where fase = 'A' and a::text <> r::text), 'dist_ref_2', (select count(*) from dif where fase = 'A' and a2::text <> r2::text),
        'dist_union_1', (select count(*) from dif where fase = 'B' and a::text <> u::text), 'dist_union_2', (select count(*) from dif where fase = 'B' and a2::text <> u2::text),
        'precio_fijo_A', (select count(*) from dif where fase = 'A' and a::text like '%precio_fijo%'),
        'descuento_B', (select count(*) from dif where fase = 'B' and a::text like '%descuento%'),
        'con_promo', (select count(*) from dif where a::text like '%promo:%'),
        'c_casos', (select count(*) from dif where fase = 'C'),
        'c_distintos', (select count(*) from dif where fase = 'C' and a::text <> r::text),
        'c_otra_cosa', (select count(*) from dif where fase = 'C' and pg_temp.sin_precio_combo(a) <> pg_temp.sin_precio_combo(r)),
        'c_otra_cosa_2', (select count(*) from dif where fase = 'C' and pg_temp.sin_precio_combo(a2) <> pg_temp.sin_precio_combo(r2)),
        'c_sube', (select count(*) from dif where fase = 'C' and (pg_temp.suma_combo(a) > pg_temp.suma_combo(r) or pg_temp.suma_combo(a2) > pg_temp.suma_combo(r2))),
        'c_sin_grupos_cambia', (select count(*) from dif where fase = 'C' and a::text <> r::text and (dia <> 2 or pg_temp.hams(items) < 2)),
        'c_con_grupos_y_combo', (select count(*) from dif where fase = 'C' and a::text <> r::text and dia = 2 and pg_temp.hams(items) >= 2 and pg_temp.suma_combo(r) > 0),
        'c_grupo_barato', (select count(*) from dif where fase = 'C' and a::text <> r::text and a::text not like '%promo:t-combo:%'));
      rollback;`;
    const r = pg.sql(script);
    assert.ok(r.ok, r.error);
    const d = ultimoJson(r.salida);
    assert.equal(d.casos, 3 * 400 * 8);
    assert.equal(d.dist_ref_1 + d.dist_ref_2, 0, `distinta de la de antes de la neutralización: ${JSON.stringify(d)}`);
    assert.equal(d.dist_union_1 + d.dist_union_2, 0, `distinta de la unión con un catálogo de solo descuento: ${JSON.stringify(d)}`);
    assert.ok(d.precio_fijo_A > 100 && d.descuento_B > 100 && d.con_promo > 500, `la comparación no es vacía: ${JSON.stringify(d)}`);
    // con las líneas del producto del combo: lo único que cambia es su precio (en las dos pasadas), nunca sube, nunca cambia si la regla no formó grupos (el combo no se regala) y cambia de
    // verdad en muchas cuentas (la comparación no es vacía)
    assert.equal(d.c_casos, 400 * 8);
    assert.equal(d.c_otra_cosa + d.c_otra_cosa_2, 0, `cambió algo que no es el precio del producto del combo: ${JSON.stringify(d)}`);
    assert.equal(d.c_sube, 0, `el producto del combo subió de precio: ${JSON.stringify(d)}`);
    assert.equal(d.c_sin_grupos_cambia, 0, `cambió una cuenta donde la regla no pudo formar un grupo (otro día, o con menos de 2 hamburguesas): el combo se regaló: ${JSON.stringify(d)}`);
    assert.ok(d.c_distintos > 20 && d.c_con_grupos_y_combo === d.c_distintos, `la comparación con el combo no es vacía: ${JSON.stringify(d)}`);
    // ronda 4: también cambia (a la baja) donde el grupo cuesta X o menos o lleva una unidad a precio 0 (sin línea de promo): la comparación lo ejerce
    assert.ok(d.c_grupo_barato > 0, `ningún caso del diferencial ejerce el grupo que cuesta X o menos: ${JSON.stringify(d)}`);
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

  test('MUTANTES: el cuadro de escenarios pasa con la migración y MUERE con cada mutante (sin el tope del precio de lista, sin el filtro de «el grupo ya costaba X», con la unidad de promo gratis siempre, sin sumar el grupo, con el validador que acepta los dos a la vez, con el tope de precio pasado, sin neutralizar el producto del combo, neutralizándolo aunque no haya grupos o de más, ignorando el precio a mano o la categoría, y con el paso b de la ronda 2)', () => {
    assert.deepEqual(chequeo(), [], 'con la migración de verdad, todo pasa');
    const mutantes = [
      ['sin el tope del precio de lista (la unidad de promo queda negativa)', 'least(gr.precio, greatest(0, gr.total - v_fijo))', 'greatest(0, gr.total - v_fijo)'],
      ['sin el filtro de los grupos que ya costaban X o menos', '(v_fijo is null or gr.total > v_fijo)', 'true'],
      ['la unidad de promo siempre gratis', 'else v_pre[v_i] end;', 'else 0 end;'],
      ['el grupo suma TODO lo elegible (no cada N)', 'partition by (u.rn - 1) / v_cada', 'partition by 1'],
      ['el validador acepta descuento y precio a la vez', "if (p_regla ? 'descuento') = (p_regla ? 'precio') then return false; end if;", 'if false then return false; end if;'],
      ['el validador deja pasar un precio pasado de 10.000.000', 'if v_precio < 1 or v_precio > 10000000 then return false; end if;', 'if v_precio < 1 then return false; end if;'],
      ['el validador deja pasar precio 0', 'if v_precio < 1 or v_precio > 10000000 then return false; end if;', 'if v_precio < 0 or v_precio > 10000000 then return false; end if;'],
      ['sin neutralizar el producto del combo (el doble cobro de una tablet vieja: 2 hamburguesas + el combo = 100.000)', 'if v_k > 0 then', 'if false then'],
      ['neutraliza el producto aunque la regla no haya formado ningún grupo (el combo vendido solo se regala)', 'then v_u / v_cada else 0 end;', 'then 1000 else 0 end;'],
      ['cuenta solo los grupos que cuestan más de X (la ronda 3: la hamburguesa a 25.000 con el combo en la cuenta daba 100.000)', 'then v_u / v_cada else 0 end;', 'then coalesce((select sum(c) from unnest(v_cant) c), 0) else 0 end;'],
      ['las unidades a precio 0 no forman grupo (la hamburguesa a 0 con el combo en la cuenta SUBE la cuenta)', 'where e.precio >= 0 and e.qty > 0\n           and pr.promo_regla is null', 'where e.precio > 0 and e.qty > 0\n           and pr.promo_regla is null'],
      ['el trigger no mira las cuentas abiertas', "(o.estado = 'abierta' or (o.estado = 'cerrada'", "(false or (o.estado = 'cerrada'"],
      ['el trigger no mira las ventas cobradas que se pueden deshacer', "(o.estado = 'abierta' or (o.estado = 'cerrada' and not exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id)))", "(o.estado = 'abierta')"],
      ['el trigger cuenta también las ventas ya archivadas en un cierre del día', ' and not exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id)', ''],
      ['el trigger dispara también al editar una promo que ya era de precio fijo y está activa', "if old.promo_regla is not null and jsonb_typeof(old.promo_regla) = 'object'", "if false and old.promo_regla is not null and jsonb_typeof(old.promo_regla) = 'object'"],
      ['el trigger solo avisa: no rechaza', 'if v_hay > 0 then', 'if false then'],
      ['el trigger no mira la variante con nota del producto (el id con «__»)', "split_part(coalesce(it ->> 'id', ''), '__', 1) = new.id", "coalesce(it ->> 'id', '') = new.id"],
      ['neutraliza TODAS las unidades de la línea si se formó algún grupo (2 combos + 2 hamburguesas regalan uno)', 'v_m := least(v_n, v_k);', 'v_m := v_n;'],
      ['neutraliza también la línea con precio a mano', "if v_lineas[v_i] ->> 'precio_manual' = 'true' then continue; end if;", ''],
      ['neutraliza el producto de una regla fuera de Promociones', " and v_promo.categoria ~* 'promo'", ''],
      ['el paso b vuelve a poner en 0 el producto de toda promo con regla (la ronda 2)', 'select p.precio into v_precio from public.productos p where p.id = v_pid and p.precio is not null and p.precio >= 0;', 'select case when p.promo_regla is not null then 0 else p.precio end into v_precio from public.productos p where p.id = v_pid and p.precio is not null and p.precio >= 0;'],
    ];
    try {
      for (const [nombre, viejo, nuevo] of mutantes) {
        assert.equal(SQL.split(viejo).length, 2, `el mutante «${nombre}» no encuentra su texto exactamente una vez`);
        // la migración se comprueba a sí misma al final (los permisos y el validador): un mutante puede morir al APLICARSE (y entonces la función mutada queda puesta: no es una
        // transacción) o al correr el cuadro de escenarios; lo que no puede es sobrevivir a las dos cosas
        const r = pg.sql(SQL.replace(viejo, () => nuevo), { como: 'migrador' });
        const falla = chequeo();
        assert.ok(!r.ok || falla.length > 0, `el mutante «${nombre}» SOBREVIVE: ni la comprobación de la migración ni el cuadro de escenarios lo notaron`);
        if (!r.ok) assert.match(r.error, /deja pasar una regla mala|rechaza una regla buena|no es la de la unión|no neutraliza el producto|pone en 0 el producto|no cuenta los grupos COMPLETOS/, `el mutante «${nombre}» murió al aplicarse por otra razón: ${r.error}`);
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
    // volver a encender la regla con el combo vendido como producto en las cuentas de los tests de arriba se NEGARÍA (RS008, el trigger de las cuentas): primero se vacían
    const negada = pg.sql("update public.productos set promo_regla = '{\"cada\":2,\"precio\":50000,\"aplica\":{\"productos\":[\"t-ham\"]}}'::jsonb where id = 't-combo';");
    assert.equal(negada.ok, false, 'con el combo en cuentas abiertas, volver a poner la regla se niega');
    assert.match(negada.error, /no se puede aplicar sola todavía/);
    sql("delete from public.ordenes where items::text like '%t-combo%' and id <> 'p-o10';");
    sql("update public.productos set promo_regla = '{\"cada\":2,\"precio\":50000,\"aplica\":{\"productos\":[\"t-ham\"]}}'::jsonb where id = 't-combo';");
    assert.equal(Number(orden(CUENTA).total), 50000, 'al volver a poner la regla, la cuenta abierta vuelve a 50.000');
    sql("update public.productos set promo_regla = '{\"cada\":2,\"precio\":50000,\"aplica\":{\"productos\":[\"t-ham\"]}}'::jsonb where id = 't-fuera';");   // la reversa también las quitó a todas
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
  const orden = (id) => pg.filas(`select items, total, version, estado from public.ordenes where id = ${literal(id)}`)[0];
  const regla = () => pg.filas("select promo_regla from public.productos where categoria = 'Promociones' and nombre = 'Combo hamburguesas'")[0].promo_regla;
  const precio = () => pg.filas("select precio from public.productos where categoria = 'Promociones' and nombre = 'Combo hamburguesas'")[0].precio;
  const sobre = () => pg.sql(`set resplandor.dia_promo = ${DIA};\n\\set VERBOSITY verbose\n` + SQL_SOBRE, { como: 'migrador' });
  const forma = (o) => o.items.map((i) => [i.id, i.qty, Number(i.precio)]);

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
      insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('s-o1', 61, 'abierta', '[]', 0, now()), ('s-o2', 62, 'abierta', '[]', 0, now()), ('s-o3', 63, 'abierta', '[]', 0, now()),
        ('s-o4', 64, 'abierta', '[]', 0, now()), ('s-o5', 65, 'abierta', '[]', 0, now()), ('s-o6', 66, 'abierta', '[]', 0, now()), ('s-o7', 67, 'abierta', '[]', 0, now());
    `);
    delta('s-o1', 's-ham', 'Hamburguesa Resplandor', 30000, 2);
    delta('s-o2', 's-ham', 'Hamburguesa Resplandor', 30000, 2);
    delta('s-o2', 's-combo', 'Combo hamburguesas', 50000, 1);   // la captura: el combo agregado a mano como un producto más
    delta('s-o3', 's-ej', 'Seco', 19000, 1);
    delta('s-o4', 's-combo', 'Combo hamburguesas', 50000, 1);   // el combo vendido SOLO como producto (la forma de antes de la regla), con un Seco
    delta('s-o4', 's-ej', 'Seco', 19000, 1);
    delta('s-o5', 's-combo', 'Combo hamburguesas', 50000, 1);   // el combo con UNA sola hamburguesa
    delta('s-o5', 's-ham', 'Hamburguesa Resplandor', 30000, 1);
    delta('s-o6', 's-combo', 'Combo hamburguesas', 50000, 1);   // una venta del combo ya COBRADA, sin cierre del día: todavía se puede deshacer
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 's-o6';");
    delta('s-o7', 's-combo', 'Combo hamburguesas', 50000, 1);   // otra, ya ARCHIVADA en un cierre del día: ya no se puede deshacer
    sql(`update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 's-o7';
         insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('s-cierre', now(), 50000, 1, '[]');
         insert into public.cierre_ordenes (orden_id, cierre_id) values ('s-o7', 's-cierre');`);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('antes del sobre: 2 hamburguesas cuestan 60.000 (el combo no tiene regla); y aborta SIN tocar nada si un nombre falta, se repite, o la categoría no es la que dice', () => {
    assert.equal(Number(orden('s-o1').total), 60000);
    assert.equal(Number(orden('s-o2').total), 110000);
    assert.equal(Number(orden('s-o4').total), 69000, 'el combo solo + un Seco: 50.000 + 19.000');
    assert.equal(Number(orden('s-o5').total), 80000, 'el combo + 1 hamburguesa: 50.000 + 30.000');
    assert.equal(orden('s-o6').estado, 'cerrada');
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

  test('RONDA 4 (crítico): con el combo vendido COMO PRODUCTO en una cuenta abierta (la captura, el combo solo con un Seco, el combo con 1 hamburguesa) o en una venta cobrada que se puede deshacer, el sobre se NIEGA (RS008), lista las mesas y no cambia NADA; la venta ya archivada en un cierre no cuenta', () => {
    const ids = ['s-o1', 's-o2', 's-o3', 's-o4', 's-o5', 's-o6', 's-o7'];
    const foto = () => ids.map((id) => [id, orden(id).version, Number(orden(id).total), JSON.stringify(orden(id).items)]);
    const antes = foto();
    const r = sobre();
    assert.equal(r.ok, false, 'tenía que negarse');
    assert.match(r.error, /RS008/);
    assert.match(r.error, /La promoción «Combo hamburguesas» no se puede aplicar sola todavía: su producto está vendido en: /);
    assert.match(r.error, /mesa 62 \(cuenta abierta: 1 unidad\)/, 'la captura: el combo agregado a mano junto al par');
    assert.match(r.error, /mesa 64 \(cuenta abierta: 1 unidad\)/, 'el combo solo, con un Seco');
    assert.match(r.error, /mesa 65 \(cuenta abierta: 1 unidad\)/, 'el combo con UNA hamburguesa');
    assert.match(r.error, /mesa 66 \(venta cobrada que todavía se puede deshacer: 1 unidad\)/);
    assert.doesNotMatch(r.error, /mesa 61|mesa 63|mesa 67/, 'las cuentas sin el combo y la venta ya archivada en un cierre no se listan');
    assert.match(r.error, /Quita esas líneas con la ✕ si repiten el grupo, o espera a que se cobren y a que se haga el cierre del día/);
    assert.match(r.error, /No se cambió nada\./);
    assert.equal(regla(), null, 'la regla no quedó');
    assert.equal(Number(precio()), 50000);
    assert.deepEqual(foto(), antes, 'ni tocó las cuentas (el UPDATE se deshizo entero)');
  });

  test('quitada la línea del combo de las cuentas abiertas (la ✕) y con la venta ya archivada en el cierre del día, el sobre pone {cada 2, precio 50000, la hamburguesa de Platos Fuertes (no la de Desayunos)} al combo y las cuentas abiertas se RE-NORMALIZAN solas: 2 hamburguesas → 50.000, con su versión subida; ninguna línea del combo cambia de precio', () => {
    // las tres cuentas con el combo vendido como producto: se quita la línea
    for (const id of ['s-o2', 's-o4', 's-o5']) delta(id, 's-combo', 'Combo hamburguesas', 50000, -1);
    assert.equal(Number(orden('s-o2').total), 60000, 'la captura, sin la línea del combo: 2 hamburguesas');
    // la venta cobrada que todavía se puede deshacer sigue frenándolo, ella sola
    let r = sobre();
    assert.equal(r.ok, false);
    assert.match(r.error, /mesa 66 \(venta cobrada que todavía se puede deshacer: 1 unidad\)/);
    assert.doesNotMatch(r.error, /mesa 62|mesa 64|mesa 65/, 'ya no hay cuentas abiertas con el combo');
    assert.equal(regla(), null);
    // el cierre del día la archiva: ya no se puede deshacer
    sql("insert into public.cierre_ordenes (orden_id, cierre_id) values ('s-o6', 's-cierre');");
    const v0 = orden('s-o1').version;
    const v3 = orden('s-o3').version;
    r = sobre();
    assert.ok(r.ok, r.error);
    assert.deepEqual(regla(), { cada: 2, precio: 50000, aplica: { productos: ['s-ham'] } });
    const o1 = orden('s-o1');
    assert.deepEqual(forma(o1), [['s-ham', 1, 30000], ['promo:s-combo:s-ham', 1, 20000]]);
    assert.equal(Number(o1.total), 50000, 'la mesa 1 de la captura queda en 50.000');
    assert.ok(o1.version > v0, 'la versión subió: las tablets y la carta reciben el cambio');
    assert.equal(orden('s-o3').version, v3, 'una cuenta sin hamburguesas se toca (updated_at) pero sus ítems no cambian: la versión es la misma');
    assert.deepEqual(forma(orden('s-o3')), [['s-ej', 1, 19000]]);
    assert.deepEqual(forma(orden('s-o2')), [['s-ham', 1, 30000], ['promo:s-combo:s-ham', 1, 20000]], 'la captura, sin la línea del combo: 50.000');
    assert.equal(Number(orden('s-o2').total), 50000);
    assert.deepEqual(forma(orden('s-o4')), [['s-ej', 1, 19000]]);
    assert.deepEqual(forma(orden('s-o5')), [['s-ham', 1, 30000]], 'una hamburguesa sola no forma grupo');
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

  test('RONDA 4: una tablet sin recargar que agrega el combo como producto DESPUÉS del sobre: sola conserva sus 50.000, junto al par que lo forma queda en $ 0 (50.000 en total); y pegar el sobre otra vez no se niega (la promo ya era de precio fijo y estaba activa)', () => {
    sql("insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('s-o8', 68, 'abierta', '[]', 0, now());");
    delta('s-o8', 's-combo', 'Combo hamburguesas', 50000, 1);
    assert.deepEqual(forma(orden('s-o8')), [['s-combo', 1, 50000]], 'sola conserva sus 50.000');
    delta('s-o8', 's-ham', 'Hamburguesa Resplandor', 30000, 2);
    assert.deepEqual(forma(orden('s-o8')), [['s-combo', 1, 0], ['s-ham', 1, 30000], ['promo:s-combo:s-ham', 1, 20000]]);
    assert.equal(Number(orden('s-o8').total), 50000, 'el par ya lo formó: no se cobra dos veces');
    const r = sobre();
    assert.ok(r.ok, `pegarlo otra vez con una línea del combo en una cuenta no tenía que negarse: ${r.error}`);
    assert.equal(Number(orden('s-o8').total), 50000);
    delta('s-o8', 's-combo', 'Combo hamburguesas', 50000, -1);
    assert.deepEqual(forma(orden('s-o8')), [['s-ham', 1, 30000], ['promo:s-combo:s-ham', 1, 20000]]);
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

  test('RONDA 4 (bajo): si una tablet vieja borra la regla (editar el combo desde el POS de antes sube promo_regla: null), una cuenta con el par y la línea del combo neutralizada NO vuelve a 60.000 sino a 110.000 (el par a precio de carta y la línea del combo a sus 50.000)', () => {
    sql("insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('s-o9', 69, 'abierta', '[]', 0, now());");
    delta('s-o9', 's-ham', 'Hamburguesa Resplandor', 30000, 2);
    delta('s-o9', 's-combo', 'Combo hamburguesas', 50000, 1);
    assert.equal(Number(orden('s-o9').total), 50000, 'con la regla: el par ya formó el combo');
    sql("update public.productos set promo_regla = null where id = 's-combo';");
    assert.equal(Number(orden('s-o9').total), 110000, 'sin la regla: 60.000 del par + 50.000 de la línea del combo, que vuelve a su precio');
    delta('s-o9', 's-combo', 'Combo hamburguesas', 50000, -1);
    const r = sobre();
    assert.ok(r.ok, r.error);
    assert.equal(Number(orden('s-o9').total), 50000);
  });
});
