// Precio vivo y promociones como regla: supabase/migrations/20261005100000_precio_vivo_y_promos.sql
// (lo que Yonatan encontró el domingo 2026-10-04 usando el POS, tareas/2026-10-04-hallazgos-domingo.md: «si un producto se actualiza
// de precio en productos las cuentas en proceso deben tener ese precio… y el precio debe ser el mismo de la base de datos en la carta»;
// «si son 2 menú resplandor = 46.000 + 1 menú resplandor con 20 % = 18.400… aunque se repita producto se debe especificar»).
// Y, de paso, la migración hermana 20261005110000_alerta_pedir_cuenta.sql (la alerta «pide la cuenta» sin método).
//
// Dos partes, como migracion-pago-breb.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. La columna `promo_regla` con su CHECK, las cinco funciones de
//      `privado` (el validador inmutable que nunca lanza, el día de Bogotá, `normalizar_items` que solo LEE, y los dos triggers SECURITY
//      DEFINER que nunca rompen una escritura), los dos triggers (y que el de las cuentas corra ANTES que el guardia), los permisos (nada
//      para anon ni authenticated, ningún GRANT, ninguna policy ni Realtime tocados), los requisitos antes de crear nada, la idempotencia,
//      que la reversa nombre TODO lo que crea en el orden correcto, y que el POS (pos.html) y el sobre de datos
//      (docs/sobres/2026-10-05-reglas-de-promos.sql) hablen la misma forma de regla que la base.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker, ver _supabase-simulado.mjs): la cadena COMPLETA de migraciones del repo y esta
//      encima, como `migrador`, que no es superusuario; y los escenarios del arnés scripts/pruebas/arnes/precio-vivo-pg.mjs, que son el
//      contrato: lunes 2 Menú + 1 Seco → «Seco · 3er almuerzo · 20% OFF» a 15.200 (y aplicar_delta_orden devuelve la fila ya
//      normalizada); 6 almuerzos → 2 descuentos; −1 sobre la línea de promo pliega; un cambio de precio toca la cuenta abierta (sube
//      `version` y manda la señal `cuenta:` a la carta) y no la cerrada; manual, abono, «para llevar» y variante; domingo sin promo y
//      «Almuerzos» de precio fijo como producto; sábado 2x1 a las 22:30 de Bogotá; promo por productos sueltos; promo apagada y promo
//      BORRADA; idempotencia de normalizar_items y la línea huérfana; el sobre de datos contra productos con los nombres reales (y que
//      aborte sin cambiar nada si un nombre no cuadra); la migración dos veces; la reversa de la cabecera y volver a aplicarla; la alerta
//      `cuenta` de punta a punta; y que se niegue a correr, sin cambiar nada, si falta `productos.dia_semana`.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal, topicoCuenta } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa } from './_cola-impresion-pg.mjs';

const MIGRACION = '20261005100000_precio_vivo_y_promos.sql';
const ALERTA = '20261005110000_alerta_pedir_cuenta.sql';
const REL = `supabase/migrations/${MIGRACION}`;
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(REL);
const SQL_ALERTA = leer(`supabase/migrations/${ALERTA}`);
const SOBRE = leer('docs/sobres/2026-10-05-reglas-de-promos.sql');
const POS = leer('pos.html');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CODIGO = sinComentarios(SQL);
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CP = compacto(CODIGO);
// Lo que está fuera de los cuerpos $$…$$ (las funciones y los bloques DO): ahí no puede haber ni un dato escrito.
const SIN_CUERPOS = CP.replace(/\$\$.*?\$\$/g, ' $$…$$ ');
const FUNCIONES = ['promo_regla_ok(jsonb)', 'dia_bogota(timestamp with time zone)', 'normalizar_items(jsonb, smallint)', 'ordenes_precio_vivo()', 'productos_tocan_cuentas()'];

/** Una función de `privado` tal como la declara la migración: argumentos, tipo, lenguaje, atributos y cuerpo. */
function funcion(nombre) {
  const m = CP.match(new RegExp(`create or replace function privado\\.${nombre}\\(([^)]*)\\) returns ([a-z ]+?) language (\\w+) ((?:\\w+ )*?)set search_path = '' as \\$\\$ (.*?) \\$\\$;`));
  assert.ok(m, `no encuentro «create or replace function privado.${nombre}(…) … set search_path = '' as $$ … $$;»`);
  return { args: m[1], retorna: m[2], lenguaje: m[3], atributos: m[4].trim(), cuerpo: m[5] };
}

/** La misma forma de regla que valida privado.promo_regla_ok, en JS (para el sobre y para comparar con el POS). */
function reglaValida(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const cada = Number(r.cada); const descuento = Number(r.descuento);
  if (!Number.isInteger(cada) || cada < 2 || cada > 10 || !Number.isInteger(descuento) || descuento < 1 || descuento > 100) return false;
  const aplica = r.aplica && typeof r.aplica === 'object' && !Array.isArray(r.aplica) ? r.aplica : null;
  if (!aplica) return false;
  const lista = (x) => (x === undefined ? [] : Array.isArray(x) ? x : null);
  const cats = lista(aplica.categorias); const prods = lista(aplica.productos);
  if (!cats || !prods || cats.length + prods.length === 0) return false;
  return [...cats, ...prods].every((v) => typeof v === 'string' && v.length > 0);
}

// ───────────────────────── 1. estática ─────────────────────────

test('la migración va después de todas las anteriores (el pago con Bre-B incluido), con prefijo único, y la de la alerta va después de ella', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(nombres.includes(MIGRACION) && nombres.includes(ALERTA));
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  for (const previa of ['20261003150000_pago_breb.sql', '20261003130000_carta_etiqueta_y_promos.sql', '20261002180000_deshacer_cobro.sql', '20261001120000_cuenta_en_vivo.sql']) {
    assert.ok(nombres.includes(previa) && previa < MIGRACION, `${previa} tiene que ir antes`);
  }
  assert.ok(MIGRACION < ALERTA, 'la alerta «pide la cuenta» se aplica después del precio vivo');
  assert.ok(nombres.slice(nombres.indexOf(MIGRACION) + 1).every((n) => n > MIGRACION));
});

test('la cabecera dice lo que hace, qué necesita, cómo se deshace, que los datos van en el sobre y que la aplica Yonatan', () => {
  const cab = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos'));
  for (const frase of [
    'promo_regla', 'privado.normalizar_items', 'trg_ordenes_a_precio_vivo', 'productos_tocan_cuentas', 'trg_ordenes_guardia', 'America/Bogota',
    'cuenta ABIERTA', 'Las cuentas cerradas no se tocan', 'NUNCA rompe una escritura', 'LÍNEA PROPIA', 'un precio negativo sería un abono',
    'AFTER INSERT, UPDATE OR DELETE', 'REVERSA (menos de 1 minuto', 'lo aplica Yonatan: aparca', 'Idempotente',
    'docs/sobres/2026-10-05-reglas-de-promos.sql', '20261003130000_carta_etiqueta_y_promos.sql', 'carta_publica',
  ]) assert.ok(cab.includes(frase), `la cabecera no dice «${frase}»`);
});

test('la columna: `promo_regla jsonb` (admite null) con su comentario, y el CHECK productos_promo_regla_valida sobre el validador, puesto solo si no existe', () => {
  assert.match(CP, /alter table public\.productos add column if not exists promo_regla jsonb;/);
  assert.match(CP, /comment on column public\.productos\.promo_regla is '[^']*Promociones[^']*'/);
  assert.match(CP, /if not exists \(select 1 from pg_constraint where conname = 'productos_promo_regla_valida' and conrelid = 'public\.productos'::regclass\) then alter table public\.productos add constraint productos_promo_regla_valida check \(privado\.promo_regla_ok\(promo_regla\)\); end if;/);
  assert.equal((CP.match(/add constraint/g) || []).length, 1, 'un solo CHECK nuevo');
});

test('privado.promo_regla_ok: inmutable, plpgsql, sin SECURITY DEFINER, nunca lanza (un CHECK no puede fallar por un cast), null es válido y las cotas son 2..10 y 1..100 con al menos una lista', () => {
  const f = funcion('promo_regla_ok');
  assert.equal(f.args, 'p_regla jsonb');
  assert.equal(f.retorna, 'boolean');
  assert.equal(f.lenguaje, 'plpgsql');
  assert.equal(f.atributos, 'immutable', 'inmutable y sin security definer: no lee nada');
  assert.match(f.cuerpo, /if p_regla is null then return true; end if;/);
  assert.match(f.cuerpo, /jsonb_typeof\(p_regla\) <> 'object' then return false/);
  assert.match(f.cuerpo, /\(p_regla ->> 'cada'\) !~ '\^\[0-9\]\{1,3\}\$' or \(p_regla ->> 'descuento'\) !~ '\^\[0-9\]\{1,3\}\$' then return false/, 'solo dígitos antes de castear');
  assert.match(f.cuerpo, /v_cada < 2 or v_cada > 10 or v_desc < 1 or v_desc > 100 then return false/);
  assert.match(f.cuerpo, /jsonb_typeof\(p_regla -> 'aplica'\) <> 'object' then return false/);
  assert.match(f.cuerpo, /jsonb_array_length\(v_cats\) \+ jsonb_array_length\(v_prods\) = 0 then return false/, 'al menos una categoría o un producto');
  assert.match(f.cuerpo, /jsonb_typeof\(e\) <> 'string' or length\(e #>> '\{\}'\) = 0/, 'las listas traen textos no vacíos');
  assert.match(f.cuerpo, /exception when others then return false;/);
  assert.doesNotMatch(f.cuerpo, /\b(from|join|into|update|delete from|insert into)\s+(public|privado)\./, 'no toca ninguna tabla');
});

test('privado.dia_bogota: SQL inmutable, isodow en America/Bogota (1 = lunes … 7 = domingo, el mismo de productos.dia_semana y de la carta)', () => {
  const f = funcion('dia_bogota');
  assert.equal(f.args, 'p_cuando timestamp with time zone');
  assert.equal(f.retorna, 'smallint');
  assert.equal(f.lenguaje, 'sql');
  assert.equal(f.atributos, 'immutable');
  assert.equal(f.cuerpo, "select extract(isodow from (p_cuando at time zone 'America/Bogota'))::smallint");
});

test('privado.normalizar_items: estable, sin SECURITY DEFINER, solo LEE productos; respeta manuales, abonos, «para llevar» y variantes; la línea de promo es positiva, discriminada y recuerda su base', () => {
  const f = funcion('normalizar_items');
  assert.equal(f.args, 'p_items jsonb, p_dia smallint');
  assert.equal(f.retorna, 'jsonb');
  assert.equal(f.lenguaje, 'plpgsql');
  assert.equal(f.atributos, 'stable');
  assert.doesNotMatch(f.cuerpo, /\b(update|insert into|delete from|truncate)\b/, 'no escribe nada: la escribe el trigger en NEW');
  assert.deepEqual([...new Set(f.cuerpo.match(/(?:from|join) (public|privado)\.\w+/g))], ['from public.productos', 'join public.productos'], 'la única tabla que lee es productos');
  // lo que no se toca
  assert.match(f.cuerpo, /v_pid = 'para_llevar' or v_pid like 'manual\\_%' or v_pid like 'abono\\_%' then continue/);
  assert.match(f.cuerpo, /coalesce\(nullif\(v_item ->> 'precio', ''\)::numeric, 0\) < 0 then continue/, 'un precio negativo es un abono');
  assert.match(f.cuerpo, /split_part\(v_pid, '__', 1\)/, 'la variante «<producto>__<lo que sea>» toma el precio del producto');
  assert.match(f.cuerpo, /p\.precio is not null and p\.precio >= 0/);
  // la promo del día
  assert.match(f.cuerpo, /if p_dia is not null then/);
  assert.match(f.cuerpo, /where p\.activo and p\.promo_regla is not null and \(p\.dia_semana is null or p\.dia_semana = p_dia\) order by p\.nombre, p\.id/);
  assert.match(f.cuerpo, /and pr\.promo_regla is null and \(pr\.categoria = any \(v_cats\) or pr\.id = any \(v_prods\)\)/, 'una promo nunca es elegible para otra promo');
  assert.match(f.cuerpo, /row_number\(\) over \(order by q\.precio desc, q\.i\) as rn/, 'de mayor a menor precio: el descuento cae en la más barata de cada grupo');
  assert.match(f.cuerpo, /where u\.rn % v_cada = 0/);
  assert.match(f.cuerpo, /round\(coalesce\(nullif\(v_base ->> 'precio', ''\)::numeric, 0\) \* \(100 - v_desc\) \/ 100\.0\)/, 'pesos enteros');
  assert.match(f.cuerpo, /'id', 'promo:' \|\| v_promo\.id \|\| ':' \|\| \(v_base ->> 'id'\)/);
  assert.match(f.cuerpo, /\|\| ' · ' \|\| v_promo\.nombre \|\| case when coalesce\(v_promo\.etiqueta, ''\) <> '' then ' · ' \|\| v_promo\.etiqueta else '' end/, '«Seco · 3er almuerzo · 20% OFF»');
  assert.match(f.cuerpo, /'promo', jsonb_build_object\( 'id', v_promo\.id, 'de', v_base ->> 'id', 'nombre', v_base ->> 'nombre', 'precio', coalesce\(nullif\(v_base ->> 'precio', ''\)::numeric, 0\), 'descuento', v_desc\)/, 'el precio de la base, para volver a ella cuando la promo ya no aplique');
  // las de una pasada anterior vuelven a su base antes de recalcular
  assert.match(f.cuerpo, /\(v_item ->> 'id'\) like 'promo:%' and jsonb_typeof\(v_item -> 'promo'\) = 'object'/);
  assert.match(f.cuerpo, /v_de := v_item -> 'promo' ->> 'de';/);
});

test('privado.ordenes_precio_vivo: trigger SECURITY DEFINER que normaliza SOLO la cuenta abierta (o la que se está cerrando), pone el total en Σ precio × qty y NUNCA rompe la escritura', () => {
  const f = funcion('ordenes_precio_vivo');
  assert.equal(f.args, '');
  assert.equal(f.retorna, 'trigger');
  assert.equal(f.atributos, 'security definer');
  assert.match(f.cuerpo, /if new\.estado = 'abierta' or \(tg_op = 'UPDATE' and old\.estado = 'abierta' and new\.estado = 'cerrada'\) then/);
  assert.match(f.cuerpo, /privado\.normalizar_items\(new\.items, privado\.dia_bogota\(coalesce\(new\.abierta_en, now\(\)\)\)\)/, 'el día es el de abierta_en en Bogotá');
  assert.match(f.cuerpo, /new\.total := \(select coalesce\(sum\(\(e ->> 'precio'\)::numeric \* \(e ->> 'qty'\)::int\), 0\) from jsonb_array_elements\(v_items\) e\);/);
  assert.match(f.cuerpo, /exception when others then raise warning 'precio_vivo % %: % \[%\]', tg_table_name, tg_op, sqlerrm, sqlstate; end; return new;/);
});

test('privado.productos_tocan_cuentas: trigger SECURITY DEFINER que toca las cuentas abiertas cuando cambia precio, activo, categoría, día o regla (o se borra el producto) y también es a prueba de fallos', () => {
  const f = funcion('productos_tocan_cuentas');
  assert.equal(f.retorna, 'trigger');
  assert.equal(f.atributos, 'security definer');
  for (const c of ['precio', 'activo', 'categoria', 'dia_semana', 'promo_regla']) assert.match(f.cuerpo, new RegExp(`new\\.${c} is not distinct from old\\.${c}`), c);
  assert.match(f.cuerpo, /if tg_op = 'UPDATE' and (?:new\.\w+ is not distinct from old\.\w+(?: and )?){5} then return null; end if;/, 'solo un UPDATE sin cambios se queda quieto: INSERT y DELETE siempre tocan');
  assert.match(f.cuerpo, /update public\.ordenes set updated_at = now\(\) where estado = 'abierta';/);
  assert.match(f.cuerpo, /exception when others then raise warning 'productos_tocan_cuentas % %: % \[%\]', tg_table_name, tg_op, sqlerrm, sqlstate; end; return null;/);
});

test('los dos triggers: BEFORE en ordenes (y su nombre va ANTES que el guardia), AFTER INSERT OR UPDATE OR DELETE en productos; cada uno con su drop if exists', () => {
  assert.match(CP, /drop trigger if exists trg_ordenes_a_precio_vivo on public\.ordenes; create trigger trg_ordenes_a_precio_vivo before insert or update on public\.ordenes for each row execute function privado\.ordenes_precio_vivo\(\);/);
  assert.match(CP, /drop trigger if exists productos_tocan_cuentas on public\.productos; create trigger productos_tocan_cuentas after insert or update or delete on public\.productos for each row execute function privado\.productos_tocan_cuentas\(\);/);
  assert.equal((CP.match(/create trigger/g) || []).length, 2);
  // Postgres dispara los triggers BEFORE del mismo evento en orden alfabético: el precio vivo tiene que cambiar NEW.items antes de que
  // el guardia (public.ordenes_guardia, 20261002180000) decida si sube `version`.
  assert.ok('trg_ordenes_a_precio_vivo' < 'trg_ordenes_guardia');
  assert.match(CP, /raise exception 'trg_ordenes_a_precio_vivo tiene que correr antes que trg_ordenes_guardia'/, 'y la comprobación final lo verifica en la base');
});

test('permisos: las cinco funciones sin EXECUTE para public, anon ni authenticated; ningún GRANT; ninguna policy, RLS, publicación ni carta_publica tocadas', () => {
  for (const f of FUNCIONES) assert.ok(CP.includes(`revoke all on function privado.${f} from public, anon, authenticated;`), `falta el revoke de privado.${f}`);
  assert.equal((CP.match(/revoke all on function/g) || []).length, FUNCIONES.length);
  assert.doesNotMatch(CP, /\bgrant\b/, 'esta migración no da ningún permiso: solo la corren los triggers');
  assert.doesNotMatch(CP, /(create|drop|alter) policy/, 'no toca ninguna policy');
  assert.doesNotMatch(CP, /enable row level security|disable row level security|publication/, 'ni la RLS ni Realtime');
  assert.doesNotMatch(CODIGO, /carta_publica/, 'la vista pública ni se menciona en el código (la carta muestra la etiqueta, no la regla)');
});

test('se niega a correr, sin cambiar nada, si falta el esquema privado, productos.dia_semana u ordenes.version (y lo comprueba ANTES de crear nada)', () => {
  const requisitos = CODIGO.slice(0, CODIGO.indexOf('create or replace function privado.promo_regla_ok'));
  assert.match(requisitos, /to_regnamespace\('privado'\) is null[\s\S]*Falta el esquema privado \(20261001120000_cuenta_en_vivo\.sql\)[\s\S]*No se cambió nada/);
  assert.match(requisitos, /column_name = 'dia_semana'[\s\S]*Falta 20261003130000_carta_etiqueta_y_promos\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /column_name = 'version'[\s\S]*Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bgrant\b/i);
});

test('idempotente: columna «if not exists», CHECK solo si no existe, funciones «create or replace», triggers «drop if exists»; fuera de las funciones no escribe ni borra datos', () => {
  assert.equal((CP.match(/add column if not exists/g) || []).length, 1);
  assert.equal((CP.match(/create or replace function/g) || []).length, FUNCIONES.length);
  assert.equal((CP.match(/drop trigger if exists/g) || []).length, 2);
  // «update» a secas pisaría el `before insert or update` de los CREATE TRIGGER: lo que se prohíbe es un UPDATE sobre una tabla (public. o privado.).
  assert.doesNotMatch(SIN_CUERPOS, /\bupdate\s+(public|privado)\.|\binsert into\b|\bdelete from\b|\btruncate\b/i, 'no escribe datos (las reglas van en el sobre)');
  assert.doesNotMatch(SIN_CUERPOS, /drop (table|column|function|schema)/i, 'no borra nada');
});

test('la reversa de la cabecera nombra TODO lo que crea, en orden: los triggers, las funciones, el CHECK y la columna antes que su validador', () => {
  const rc = compacto(reversa(SQL));
  assert.match(rc, /^begin; /);
  assert.match(rc, / commit;$/);
  assert.match(rc, /drop trigger if exists trg_ordenes_a_precio_vivo on public\.ordenes;/);
  assert.match(rc, /drop trigger if exists productos_tocan_cuentas on public\.productos;/);
  for (const f of FUNCIONES) assert.ok(rc.includes(`drop function if exists privado.${f};`), `la reversa no borra privado.${f}`);
  assert.match(rc, /alter table public\.productos drop constraint if exists productos_promo_regla_valida;/);
  assert.match(rc, /alter table public\.productos drop column if exists promo_regla;/);
  assert.ok(rc.indexOf('drop trigger') < rc.indexOf('drop function'), 'primero los triggers, luego sus funciones');
  assert.ok(rc.indexOf('drop constraint') < rc.indexOf('drop column') && rc.indexOf('drop column') < rc.indexOf('privado.promo_regla_ok(jsonb)'), 'el CHECK y la columna antes que el validador que el CHECK usa');
});

test('la comprobación final prueba el validador, el día de Bogotá, una línea manual intacta y el orden de los triggers', () => {
  const fin = CODIGO.slice(CODIGO.lastIndexOf('do $$'));
  assert.match(fin, /privado\.promo_regla_ok\('\{"cada":3,"descuento":20,"aplica":\{"categorias":\["Ejecutivos"\]\}\}'::jsonb\)/);
  assert.match(fin, /privado\.dia_bogota\('2026-10-05 00:30:00\+00'::timestamptz\) <> 7/, 'el 2026-10-05 00:30 UTC es domingo 4 a las 19:30 en Bogotá');
  assert.match(fin, /privado\.normalizar_items\('\[\{"id":"manual_1"/);
  assert.match(fin, /is distinct from 'trg_ordenes_a_precio_vivo'/);
});

test('el POS habla la misma forma de regla: reglaPromoValida con las cotas de la base, la línea de promo por su id y su objeto, y promo_regla solo se manda si la base la trae', () => {
  const helpers = POS.slice(POS.indexOf('// ▼ PARTE hallazgos-domingo :: helpers'), POS.indexOf('// ▲ PARTE hallazgos-domingo :: helpers'));
  assert.ok(helpers.length > 0, 'faltan los helpers de hallazgos-domingo en pos.html');
  assert.match(helpers, /const esLineaPromo = \(i\) => !!i && typeof i\.id === 'string' && i\.id\.startsWith\('promo:'\) && !!i\.promo && typeof i\.promo === 'object';/);
  assert.match(helpers, /cada < 2 \|\| cada > 10 \|\| !Number\.isInteger\(descuento\) \|\| descuento < 1 \|\| descuento > 100\) return null;/);
  assert.match(helpers, /if \(!categorias\.length && !productos\.length\) return null;/);
  assert.match(helpers, /timeZone: 'America\/Bogota'/, 'el día de hoy del POS es el de Bogotá, como privado.dia_bogota');
  assert.match(POS, /if \(row && Object\.prototype\.hasOwnProperty\.call\(row, 'promo_regla'\)\) this\._conPromoRegla = true;/);
  assert.match(POS, /\.\.\.\(this\._conPromoRegla \? \{ promo_regla: reglaPromoValida\(p\.promoRegla\) \} : \{\}\),/, 'con la base de antes (sin la columna) el POS no manda promo_regla: PostgREST contestaría 400');
  assert.match(POS, /esLineaPromo\(item\)\) return false;/, 'al sumar un producto el POS nunca toma la línea de promo por su base');
});

test('el sobre de datos: tres reglas con la forma que valida la base, por nombre y categoría, en una transacción que aborta si algo no cuadra; lo pega Yonatan', () => {
  for (const frase of ['Lo pega Yonatan', 'DESPUÉS de aplicar', MIGRACION, 'Idempotente', 'Reversa:', 'Por confirmar con Yonatan']) assert.ok(SOBRE.includes(frase), `el sobre no dice «${frase}»`);
  const sc = sinComentarios(SOBRE);
  assert.match(compacto(sc), /^begin; update public\.productos/);
  assert.match(compacto(sc), /commit;$/);
  const updates = [...sc.matchAll(/update public\.productos(?: p)?\s+set promo_regla = ([\s\S]*?)\s+where (?:p\.)?categoria = 'Promociones' and (?:p\.)?nombre = '([^']+)';/g)];
  assert.deepEqual(updates.map((u) => u[2]), ['3er almuerzo', 'Entradas de la carta', 'Cócteles, jugos y sodas']);
  const literales = updates.map((u) => u[1].trim()).filter((v) => v.startsWith("'")).map((v) => JSON.parse(v.match(/^'([\s\S]*)'::jsonb$/)[1]));
  assert.equal(literales.length, 2, 'las dos reglas por categoría van como literal jsonb');
  assert.deepEqual(literales, [
    { cada: 3, descuento: 20, aplica: { categorias: ['Ejecutivos'] } },
    { cada: 2, descuento: 100, aplica: { categorias: ['Entradas'] } },
  ]);
  for (const r of literales) assert.ok(reglaValida(r));
  const bebidas = updates[2][1];
  assert.match(bebidas, /jsonb_build_object\(\s*'cada', 2, 'descuento', 100,/);
  assert.match(bebidas, /where b\.categoria = 'Bebidas'\s+and b\.nombre in \('Cóctel Resplandor', 'Margarita', 'Paloma', 'Tequila Smile', 'Cantarito', 'Jugo natural', 'Soda saborizada'\)/);
  assert.match(sc, /raise exception 'Se esperaban 3 promociones con regla y hay %[^']*No se aplicó nada\.'/);
  assert.match(sc, /raise exception 'La promo de cócteles, jugos y sodas quedó con % productos y se esperaban 7[^']*No se aplicó nada\.'/);
  assert.doesNotMatch(SOBRE, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'el sobre no trae correos');
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
  /** Corre SQL como postgres (los triggers corren igual que con la API) y falla la prueba si la sentencia falla; junta los WARNING. */
  const sql = (texto, opciones) => {
    const r = pg.sql(texto, opciones);
    for (const a of r.avisos) avisos.push(`${a}  ←  ${compacto(texto).slice(0, 90)}`);
    assert.ok(r.ok, r.error);
    return r;
  };
  const orden = (id) => pg.filas(`select items, total, version from public.ordenes where id = ${literal(id)}`)[0];
  const linea = (o, id) => o.items.find((i) => i.id === id);
  const delta = (id, producto, nombre, precio, n, nota = '') =>
    pg.filas(`select items, total, version from public.aplicar_delta_orden(${literal(id)}, ${literal(producto)}, ${literal(nombre)}, ${precio}, ${n}, ${literal(nota)})`)[0];
  const abrir = (id, mesa, abiertaEn) => sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', '[]', 0, ${literal(abiertaEn)});`);

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 14 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    antes = radiografia(pg);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, `la migración no se aplicó: ${mia[0].error}`);
    assert.deepEqual(mia[0].avisos, [], 'aplicarla no deja ni un WARNING');
    despues = radiografia(pg);
    // Los productos y las mesas del contrato (ids propios: la base está vacía, pero así nunca chocan con nada).
    sql(`
      insert into public.productos (id, categoria, nombre, precio, activo) values
        ('t-ej1','Ejecutivos','Menú Resplandor',23000,true),
        ('t-ej2','Ejecutivos','Seco',19000,true),
        ('t-en1','Entradas','Papas Resplandor',25000,true),
        ('t-en2','Entradas','Arepitas montadas',12000,true),
        ('t-be1','Bebidas','Margarita',30000,true),
        ('t-be2','Bebidas','Cerveza',10000,true);
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
        ('t-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}'),
        ('t-pr2','Promociones','Entradas de la carta',0,true,'2 x 1',6,'{"cada":2,"descuento":100,"aplica":{"categorias":["Entradas"]}}'),
        ('t-prb','Promociones','Cócteles, jugos y sodas',0,true,'2 x 1',3,'{"cada":2,"descuento":100,"aplica":{"productos":["t-be1"]}}'),
        ('t-prf','Promociones','Almuerzos',20000,true,null,7,null);
      insert into public.mesas (id, capacidad, estado, token) values
        (91,4,'ocupada',${literal(TOKEN_91)}),(92,4,'ocupada',repeat('b',48)),(93,4,'ocupada',repeat('c',48)),(94,4,'ocupada',repeat('d',48));
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('agrega SOLO lo suyo: cinco funciones en privado, dos triggers y un CHECK; ninguna tabla, vista, policy, publicación ni permiso por columna; nada de lo que había cambia', () => {
    const clave = (f) => JSON.stringify(f);
    for (const [seccion, filas] of Object.entries(antes)) {
      const ahora = new Set(despues[seccion].map(clave));
      for (const f of filas) assert.ok(ahora.has(clave(f)), `${seccion}: cambió algo que ya existía: ${clave(f)}`);
    }
    const nuevas = (seccion) => despues[seccion].filter((f) => !antes[seccion].some((a) => clave(a) === clave(f)));
    assert.deepEqual(nuevas('funciones').map((f) => `${f.nspname}.${f.proname}(${f.args})`).sort(), FUNCIONES.map((f) => `privado.${f}`).sort());
    for (const f of nuevas('funciones')) assert.doesNotMatch(f.acl || '', /anon|authenticated/, `${f.proname}: sin EXECUTE para anon ni authenticated`);
    assert.deepEqual(nuevas('triggers'), [{ tabla: 'ordenes', tgname: 'trg_ordenes_a_precio_vivo' }, { tabla: 'productos', tgname: 'productos_tocan_cuentas' }]);
    assert.deepEqual(nuevas('restricciones'), [{ tabla: 'productos', conname: 'productos_promo_regla_valida' }]);
    assert.deepEqual(nuevas('relaciones'), [], 'ninguna tabla ni vista nueva, ni cambió el ACL de ninguna');
    assert.deepEqual(nuevas('policies'), []);
    assert.deepEqual(nuevas('publicacion'), []);
    assert.deepEqual(nuevas('columnas'), [], 'ningún permiso por columna nuevo');
    assert.deepEqual(pg.filas("select tgname from pg_trigger where tgrelid = 'public.ordenes'::regclass and tgname in ('trg_ordenes_a_precio_vivo', 'trg_ordenes_guardia') order by tgname").map((f) => f.tgname), ['trg_ordenes_a_precio_vivo', 'trg_ordenes_guardia']);
  });

  test('el validador y el CHECK: las reglas buenas entran (también en los bordes 2..10 y 1..100) y las malas no, con el nombre del CHECK en el error', () => {
    const buenas = [
      { cada: 3, descuento: 20, aplica: { categorias: ['Ejecutivos'] } },
      { cada: 2, descuento: 100, aplica: { productos: ['t-be1'] } },
      { cada: 10, descuento: 1, aplica: { categorias: ['Entradas'], productos: ['t-be1', 't-be2'] } },
      { cada: '2', descuento: '50', aplica: { categorias: ['Bebidas'] } },
    ];
    const malas = [
      { cada: 1, descuento: 20, aplica: { categorias: ['Ejecutivos'] } },
      { cada: 11, descuento: 20, aplica: { categorias: ['Ejecutivos'] } },
      { cada: 3, descuento: 0, aplica: { categorias: ['Ejecutivos'] } },
      { cada: 3, descuento: 101, aplica: { categorias: ['Ejecutivos'] } },
      { cada: 'x', descuento: 20, aplica: { categorias: ['Ejecutivos'] } },
      { cada: 2.5, descuento: 20, aplica: { categorias: ['Ejecutivos'] } },
      { cada: 3, descuento: 20 },
      { cada: 3, descuento: 20, aplica: {} },
      { cada: 3, descuento: 20, aplica: { categorias: [] } },
      { cada: 3, descuento: 20, aplica: { categorias: [''] } },
      { cada: 3, descuento: 20, aplica: { categorias: [1] } },
      { cada: 3, descuento: 20, aplica: { categorias: 'Ejecutivos' } },
      { cada: 3, descuento: 20, aplica: [] },
      [], 'texto', 1, true,
    ];
    const casos = [...buenas, ...malas];
    const r = pg.sql(`select coalesce(json_agg(privado.promo_regla_ok(v::jsonb) order by n), '[]'::json) from unnest(array[${casos.map((c) => literal(JSON.stringify(c))).join(', ')}]::text[]) with ordinality as u(v, n);`);
    assert.ok(r.ok, r.error);
    const sqlDice = JSON.parse(r.salida);
    const jsDice = casos.map(reglaValida);
    assert.deepEqual(sqlDice, [...buenas.map(() => true), ...malas.map(() => false)], 'privado.promo_regla_ok');
    assert.deepEqual(jsDice, sqlDice, 'la forma en JS (el POS y el sobre) dice lo mismo que la base');
    assert.equal(pg.sql("select privado.promo_regla_ok(null)").salida, 't', 'null es válido: la mayoría de los productos no tienen regla');
    const mala = pg.sql(`insert into public.productos (id, categoria, nombre, precio, activo, promo_regla) values ('t-mala','Promociones','Mala',0,true,${literal(JSON.stringify(malas[0]))});`);
    assert.equal(mala.ok, false);
    assert.match(mala.error, /productos_promo_regla_valida/);
    assert.equal(pg.filas("select count(*)::int as n from public.productos where id = 't-mala'")[0].n, 0);
  });

  test('nadie de la API corre las funciones de privado: authenticated y anon reciben 42501', () => {
    for (const rol of ['authenticated', 'anon']) {
      for (const llamada of ["privado.normalizar_items('[]'::jsonb, 1::smallint)", "privado.promo_regla_ok('{}'::jsonb)", "privado.dia_bogota(now())"]) {
        const r = pg.sql(`\\set VERBOSITY verbose\nselect ${llamada};`, { como: rol });
        assert.equal(r.ok, false, `${rol} pudo correr ${llamada}`);
        assert.match(r.error, /42501/, `${rol} · ${llamada}: ${r.error}`);
      }
    }
  });

  test('lunes, 2 Menú + 1 Seco: el Seco (el más barato) sale como línea de promo a 15.200, discriminado, y aplicar_delta_orden devuelve la fila ya normalizada', () => {
    abrir('t-o1', 91, '2026-10-05 17:00:00+00');      // lunes 5 de octubre, mediodía en Bogotá
    let o = delta('t-o1', 't-ej1', 'Menú Resplandor', 23000, 2);
    assert.equal(o.items.length, 1, 'con 2 almuerzos no hay promo');
    assert.equal(Number(o.total), 46000);
    o = delta('t-o1', 't-ej2', 'Seco', 19000, 1);
    const pr = linea(o, 'promo:t-pr3:t-ej2');
    assert.ok(pr, `la fila que devuelve aplicar_delta_orden ya trae la línea de promo: ${JSON.stringify(o.items)}`);
    assert.deepEqual(orden('t-o1').items, o.items, 'y es lo mismo que quedó guardado');
    assert.equal(Number(pr.precio), 15200);
    assert.equal(pr.qty, 1);
    assert.equal(pr.nombre, 'Seco · 3er almuerzo · 20% OFF');
    assert.deepEqual({ ...pr.promo, precio: Number(pr.promo.precio) }, { id: 't-pr3', de: 't-ej2', nombre: 'Seco', precio: 19000, descuento: 20 });
    assert.ok(!linea(o, 't-ej2'), 'la línea base del Seco se fue entera a la promo (era 1 unidad)');
    assert.equal(linea(o, 't-ej1').qty, 2);
    assert.equal(Number(o.total), 46000 + 15200);
  });

  test('4 almuerzos → 1 descuento y el Seco base vuelve con 1; 6 → el 3.º es un Menú (18.400) y el 6.º un Seco (15.200); −1 sobre la línea de promo pliega y recalcula', () => {
    let o = delta('t-o1', 't-ej2', 'Seco', 19000, 1);
    assert.equal(linea(o, 't-ej2')?.qty, 1);
    assert.equal(linea(o, 'promo:t-pr3:t-ej2')?.qty, 1);
    assert.equal(Number(o.total), 80200);
    const v1 = o.version;
    delta('t-o1', 't-ej1', 'Menú Resplandor', 23000, 1);
    o = delta('t-o1', 't-ej2', 'Seco', 19000, 1);
    // 3 Menú + 3 Seco, de mayor a menor [23,23,23,19,19,19]: el 3.º es un Menú y el 6.º un Seco
    assert.equal(Number(linea(o, 'promo:t-pr3:t-ej1')?.precio), 18400);
    assert.equal(Number(linea(o, 'promo:t-pr3:t-ej2')?.precio), 15200);
    assert.equal(linea(o, 'promo:t-pr3:t-ej1').nombre, 'Menú Resplandor · 3er almuerzo · 20% OFF', 'aunque se repita producto, cada descuento dice de qué plato es');
    assert.equal(Number(o.total), 2 * 23000 + 18400 + 2 * 19000 + 15200);
    // el mesero quita una unidad desde la línea de promo del Seco: quedan 5 (3 Menú, 2 Seco) y un solo descuento, sobre el Menú
    o = delta('t-o1', 'promo:t-pr3:t-ej2', 'Seco · 3er almuerzo · 20% OFF', 15200, -1);
    assert.equal(linea(o, 't-ej1')?.qty, 2);
    assert.equal(Number(linea(o, 'promo:t-pr3:t-ej1')?.precio), 18400);
    assert.equal(linea(o, 't-ej2')?.qty, 2);
    assert.ok(!linea(o, 'promo:t-pr3:t-ej2'));
    assert.equal(Number(o.total), 2 * 23000 + 18400 + 2 * 19000);
    assert.ok(o.version > v1, 'la versión sube con cada cambio');
    // el orden de salida: cada base seguida de su línea de promo
    assert.deepEqual(o.items.map((i) => i.id), ['t-ej1', 'promo:t-pr3:t-ej1', 't-ej2']);
  });

  test('precio vivo: el Menú pasa a 25.000 y la cuenta abierta lo sigue (también el descuento), sube `version` y manda la señal `cuenta:` a la carta; cambiar la descripción no la toca', () => {
    const vAntes = orden('t-o1').version;
    pg.limpiarSenales();
    sql("update public.productos set precio = 25000 where id = 't-ej1';");
    const o = orden('t-o1');
    assert.equal(Number(linea(o, 't-ej1').precio), 25000);
    assert.equal(Number(linea(o, 'promo:t-pr3:t-ej1').precio), 20000);
    assert.equal(Number(linea(o, 'promo:t-pr3:t-ej1').promo.precio), 25000, 'la línea de promo recuerda el precio base de hoy');
    assert.equal(Number(o.total), 2 * 25000 + 20000 + 2 * 19000);
    assert.ok(o.version > vAntes, `la versión subió (${vAntes} → ${o.version}): el POS adopta el eco de Realtime`);
    assert.ok(pg.senales().includes(topicoCuenta(TOKEN_91)), `la carta de la mesa 91 recibió la señal: ${JSON.stringify(pg.senales())}`);
    const vIgual = o.version;
    pg.limpiarSenales();
    sql("update public.productos set descripcion = 'otra' where id = 't-ej1';");
    assert.equal(orden('t-o1').version, vIgual, 'un cambio que no toca precio ni regla no mueve la cuenta');
    assert.deepEqual(pg.senales(), [], 'ni manda señal');
  });

  test('líneas que no se tocan: la manual y el marcador «para llevar» quedan como llegaron, la variante toma el precio del producto, el abono (negativo) sigue intacto y descuenta del total', () => {
    delta('t-o1', 'manual_x', 'Propina', 5000, 1);
    delta('t-o1', 'para_llevar', 'Para llevar', 0, 1);
    let o = delta('t-o1', 't-be2__sin-vaso', 'Cerveza', 9000, 1, 'sin vaso');
    assert.equal(Number(linea(o, 'manual_x').precio), 5000);
    assert.equal(linea(o, 'para_llevar').qty, 1);
    assert.equal(Number(linea(o, 'para_llevar').precio), 0);
    assert.equal(Number(linea(o, 't-be2__sin-vaso').precio), 10000, 'la variante «t-be2__sin-vaso» vale lo que el producto en el catálogo');
    sql(`update public.ordenes set items = items || '[{"id":"abono_recibido_1","nombre":"Abono recibido","precio":-10000,"qty":1,"nota":"efectivo"}]'::jsonb where id = 't-o1';`);
    o = orden('t-o1');
    assert.equal(Number(linea(o, 'abono_recibido_1').precio), -10000);
    assert.equal(Number(o.total), 2 * 25000 + 20000 + 2 * 19000 + 5000 + 10000 - 10000);
  });

  test('cobrar: el cobro sube con lo de hoy; después, ni un cambio de precio ni tocar la fila cambian la cuenta cerrada', () => {
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 't-o1';");
    const cerrada = orden('t-o1');
    assert.equal(Number(linea(cerrada, 't-ej1').precio), 25000);
    sql("update public.productos set precio = 26000 where id = 't-ej1';");
    assert.deepEqual(orden('t-o1'), cerrada, 'la cerrada conserva 25.000');
    sql("update public.ordenes set updated_at = now() where id = 't-o1';");
    assert.deepEqual(orden('t-o1'), cerrada, 'tocarla directamente tampoco la normaliza');
  });

  test('domingo: 3 Secos sin descuento (el 3er almuerzo es del lunes) y «Almuerzos» de precio fijo entra como un producto más', () => {
    abrir('t-o2', 92, '2026-10-04 17:00:00+00');
    delta('t-o2', 't-ej2', 'Seco', 19000, 3);
    const o = delta('t-o2', 't-prf', 'Almuerzos', 20000, 1);
    assert.deepEqual(o.items.map((i) => [i.id, i.qty, Number(i.precio)]), [['t-ej2', 3, 19000], ['t-prf', 1, 20000]]);
    assert.equal(Number(o.total), 3 * 19000 + 20000);
  });

  test('sábado a las 22:30 de Bogotá (domingo 03:30 UTC): 2x1 en entradas, la más barata gratis como línea propia', () => {
    abrir('t-o3', 93, '2026-10-04 03:30:00+00');
    delta('t-o3', 't-en1', 'Papas Resplandor', 25000, 1);
    const o = delta('t-o3', 't-en2', 'Arepitas montadas', 12000, 2);
    const gratis = linea(o, 'promo:t-pr2:t-en2');
    assert.equal(Number(gratis?.precio), 0);
    assert.equal(gratis.qty, 1);
    assert.equal(gratis.nombre, 'Arepitas montadas · Entradas de la carta · 2 x 1');
    assert.equal(linea(o, 't-en2').qty, 1);
    assert.equal(Number(o.total), 25000 + 12000);
  });

  test('miércoles: promo por productos sueltos (2 Margaritas → 1 gratis; la cerveza no entra); apagarla la quita de la cuenta; borrarla también', () => {
    abrir('t-o4', 94, '2026-10-07 17:00:00+00');
    delta('t-o4', 't-be1', 'Margarita', 30000, 2);
    let o = delta('t-o4', 't-be2', 'Cerveza', 10000, 2);
    assert.equal(Number(linea(o, 'promo:t-prb:t-be1')?.precio), 0);
    assert.equal(linea(o, 't-be1').qty, 1);
    assert.equal(linea(o, 't-be2').qty, 2);
    assert.equal(Number(o.total), 30000 + 20000);
    sql("update public.productos set activo = false where id = 't-prb';");
    o = orden('t-o4');
    assert.equal(linea(o, 't-be1').qty, 2);
    assert.ok(!linea(o, 'promo:t-prb:t-be1'));
    assert.equal(Number(o.total), 80000);
    sql("update public.productos set activo = true where id = 't-prb';");
    assert.equal(linea(orden('t-o4'), 'promo:t-prb:t-be1')?.qty, 1, 'encenderla la devuelve');
    // El POS borra productos de verdad (supabaseClient.from('productos').delete()): la promo borrada sale de las cuentas abiertas sin esperar a la próxima escritura.
    sql("delete from public.productos where id = 't-prb';");
    o = orden('t-o4');
    assert.ok(!linea(o, 'promo:t-prb:t-be1'), `borrar la promo la quita de la cuenta abierta: ${JSON.stringify(o.items)}`);
    assert.equal(linea(o, 't-be1').qty, 2);
    assert.equal(Number(o.total), 80000);
  });

  test('normalizar_items es idempotente, y una línea de promo huérfana (sin su promo ese día) vuelve a ser su base', () => {
    const dos = pg.filas("select privado.normalizar_items(privado.normalizar_items(items, 1::smallint), 1::smallint) = privado.normalizar_items(items, 1::smallint) as igual from public.ordenes where id = 't-o1'")[0];
    assert.equal(dos.igual, true);
    const huerfana = pg.filas(`select privado.normalizar_items('[{"id":"promo:t-pr3:t-ej2","nombre":"Seco · 3er almuerzo","precio":15200,"qty":2,"nota":"","promo":{"id":"t-pr3","de":"t-ej2","nombre":"Seco","precio":19000,"descuento":20}}]'::jsonb, 7::smallint) as r`)[0].r;
    assert.deepEqual(huerfana.map((i) => [i.id, i.qty, Number(i.precio), i.nombre]), [['t-ej2', 2, 19000, 'Seco']]);
    // y con los ítems vacíos o que no son una lista, sale lo que entró
    assert.deepEqual(pg.filas("select privado.normalizar_items('[]'::jsonb, 1::smallint) as r")[0].r, []);
    assert.deepEqual(pg.filas(`select privado.normalizar_items('{"x":1}'::jsonb, 1::smallint) as r`)[0].r, { x: 1 });
  });

  test('ninguna de las escrituras de arriba dejó un WARNING (los triggers tragan errores, pero no los hubo)', () => {
    assert.deepEqual(avisos, []);
  });

  test('el sobre de datos, contra productos con los nombres reales: pone las tres reglas (la de bebidas con sus 7 productos por nombre), es idempotente, y aborta sin cambiar nada si un nombre no cuadra', () => {
    // Las cuentas del contrato se cierran, y sus productos salen de las categorías reales mientras corre el sobre (que cuenta por
    // categoría y busca las bebidas por nombre); al final vuelven. Nada abierto, así que los toques del trigger no cambian nada.
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id like 't-o%' and estado = 'abierta';");
    sql("update public.productos set categoria = 'T-' || categoria where id like 't-%';");
    const bebidas = ['Cóctel Resplandor', 'Margarita', 'Paloma', 'Tequila Smile', 'Cantarito', 'Jugo natural', 'Soda saborizada', 'Agua', 'Gaseosa', 'Corona'];
    sql(`
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana) values
        ('s-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1),
        ('s-pr2','Promociones','Entradas de la carta',0,true,'2 x 1',6),
        ('s-prb','Promociones','Cócteles, jugos y sodas',0,true,'2 x 1',3),
        ('s-prf','Promociones','Almuerzos',20000,true,null,7);
      insert into public.productos (id, categoria, nombre, precio, activo)
        select 's-be' || n, 'Bebidas', b, 10000, true from unnest(array[${bebidas.map(literal).join(', ')}]) with ordinality as u(b, n);
    `);
    const reglas = () => pg.filas("select nombre, promo_regla from public.productos where id like 's-pr%' order by id");
    sql(SOBRE);
    const r1 = reglas();
    assert.deepEqual(r1.map((p) => [p.nombre, p.promo_regla && p.promo_regla.cada, p.promo_regla && p.promo_regla.descuento]), [
      ['3er almuerzo', 3, 20], ['Entradas de la carta', 2, 100], ['Cócteles, jugos y sodas', 2, 100], ['Almuerzos', null, null],
    ]);
    const ids = r1[2].promo_regla.aplica.productos;
    const esperados = pg.filas("select id from public.productos where id like 's-be%' and nombre in ('Cóctel Resplandor', 'Margarita', 'Paloma', 'Tequila Smile', 'Cantarito', 'Jugo natural', 'Soda saborizada') order by nombre").map((p) => p.id);
    assert.deepEqual(ids, esperados, 'los 7 ids de las bebidas que entran, en orden de nombre');
    sql(SOBRE);
    assert.deepEqual(reglas(), r1, 'pegarlo dos veces deja lo mismo');
    // un nombre que no cuadra: aborta y no cambia nada
    sql("update public.productos set promo_regla = null where id like 's-pr%'; update public.productos set nombre = 'Tercer almuerzo' where id = 's-pr3';");
    const malo = pg.sql(SOBRE);
    assert.equal(malo.ok, false);
    assert.match(malo.error, /Se esperaban 3 promociones con regla y hay 2.*No se aplicó nada/s);
    assert.deepEqual(reglas().map((p) => p.promo_regla), [null, null, null, null], 'la transacción se deshizo entera');
    sql("delete from public.productos where id like 's-%'; update public.productos set categoria = substr(categoria, 3) where id like 't-%';");
    assert.deepEqual(pg.filas("select distinct categoria from public.productos where id like 't-%' order by 1").map((p) => p.categoria), ['Bebidas', 'Ejecutivos', 'Entradas', 'Promociones']);
  });

  test('aplicarla dos veces es inocua: el catálogo queda idéntico y las filas de productos (con sus reglas) no cambian', () => {
    const filas = () => pg.filas('select id, precio, activo, promo_regla from public.productos order by id');
    const antesFilas = filas();
    const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(otra.length, 1);
    assert.ok(otra[0].ok, otra[0].error);
    assert.deepEqual(otra[0].avisos, [], 'la segunda aplicación no deja WARNING');
    assert.deepEqual(radiografia(pg), despues, 'el catálogo no cambió');
    assert.deepEqual(filas(), antesFilas);
  });

  test('la reversa de la cabecera corre en limpio, deja el catálogo como antes, las líneas de promo de las cuentas quedan como líneas positivas normales, y reaplicar lo deja como después', () => {
    abrir('t-o5', 91, '2026-10-05 17:00:00+00');
    delta('t-o5', 't-ej2', 'Seco', 19000, 3);
    const conPromo = orden('t-o5');
    assert.ok(linea(conPromo, 'promo:t-pr3:t-ej2'));
    const r = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(r.ok, 'la reversa falló: ' + r.error);
    assert.deepEqual(r.avisos, []);
    const ahora = radiografia(pg);
    for (const [seccion, filas] of Object.entries(antes)) assert.deepEqual(ahora[seccion], filas, `tras la reversa quedó distinto: ${seccion}`);
    assert.equal(pg.filas("select count(*)::int as n from pg_trigger where tgname in ('trg_ordenes_a_precio_vivo', 'productos_tocan_cuentas')")[0].n, 0);
    assert.equal(pg.filas("select count(*)::int as n from information_schema.columns where table_name = 'productos' and column_name = 'promo_regla'")[0].n, 0);
    // sin la migración, la cuenta abierta se queda como estaba y un cambio de precio ya no la toca
    assert.deepEqual(orden('t-o5').items, conPromo.items);
    sql("update public.productos set precio = 21000 where id = 't-ej2';");
    assert.deepEqual(orden('t-o5').items, conPromo.items);
    sql("update public.productos set precio = 19000 where id = 't-ej2';");
    const reaplicada = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.ok(reaplicada[0].ok, 'no se pudo volver a aplicar tras la reversa: ' + reaplicada[0].error);
    assert.deepEqual(reaplicada[0].avisos, []);
    assert.deepEqual(radiografia(pg), despues, 'reaplicar tras la reversa deja el catálogo como la primera vez');
    // las reglas se perdieron con la columna (la reversa lo dice: el sobre se vuelve a pegar); la cuenta abierta vuelve a precio vivo sin promo
    sql("update public.productos set precio = 19500 where id = 't-ej2';");
    const o = orden('t-o5');
    assert.deepEqual(o.items.map((i) => [i.id, i.qty, Number(i.precio)]), [['t-ej2', 3, 19500]]);
    sql("update public.productos set precio = 19000 where id = 't-ej2'; update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 't-o5';");
  });

  describe('la migración hermana: la alerta «pide la cuenta» (20261005110000_alerta_pedir_cuenta.sql)', () => {
    let antesAlerta;
    let despuesAlerta;
    const checkDef = () => pg.filas("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'alertas_metodo_check'")[0].def;

    before(() => {
      antesAlerta = radiografia(pg);
      const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: ALERTA, hasta: ALERTA });
      assert.equal(mia.length, 1);
      assert.ok(mia[0].ok, mia[0].error);
      assert.deepEqual(mia[0].avisos, []);
      despuesAlerta = radiografia(pg);
    });

    test('cambia SOLO el CHECK de alertas.metodo (mismo nombre, con `cuenta`) y el cuerpo de alertar_cuenta; nada más del catálogo', () => {
      const clave = (f) => JSON.stringify(f);
      for (const seccion of Object.keys(antesAlerta)) {
        if (seccion === 'funciones') continue;
        assert.deepEqual(despuesAlerta[seccion], antesAlerta[seccion], seccion);
      }
      const cambiadas = despuesAlerta.funciones.filter((f) => !antesAlerta.funciones.some((a) => clave(a) === clave(f)));
      assert.deepEqual(cambiadas.map((f) => `${f.nspname}.${f.proname}`), ['public.alertar_cuenta']);
      assert.match(checkDef(), /'qr'::text, 'transferencia'::text, 'efectivo'::text, 'cuenta'::text/);
    });

    test('de punta a punta: «Pagar» avisa con `cuenta`; copiar la llave refina la misma alerta a `transferencia`; un método desconocido sigue rechazado', () => {
      abrir('t-o6', 91, '2026-10-05 17:00:00+00');
      const llamar = (metodo) => pg.filas(`select public.alertar_cuenta(91, ${literal(TOKEN_91)}, ${literal(metodo)}) as r`)[0].r;
      const a = llamar('cuenta');
      assert.equal(a.ok, true, JSON.stringify(a));
      assert.equal(a.metodo, 'cuenta');
      assert.equal(a.orden_id, 't-o6');
      const b = llamar('transferencia');
      assert.equal(b.ok, true);
      assert.equal(b.metodo, 'transferencia');
      assert.equal(b.alerta_id, a.alerta_id, 'la misma alerta pendiente, con el método refinado');
      assert.deepEqual(pg.filas("select metodo, estado from public.alertas where orden_id = 't-o6'"), [{ metodo: 'transferencia', estado: 'pendiente' }]);
      assert.equal(llamar('tarjeta').codigo, 'metodo_invalido');
      assert.equal(llamar('cuenta').metodo, 'cuenta', 'y puede volver a «cuenta» (otro «Pagar» tras cambiar de idea)');
    });

    test('la reversa de su cabecera pasa las pendientes con `cuenta` a `efectivo` y repone el CHECK de tres; reaplicarla deja todo como después', () => {
      const r = pg.sql(reversa(SQL_ALERTA), { como: 'migrador' });
      assert.ok(r.ok, 'la reversa falló: ' + r.error);
      assert.deepEqual(pg.filas("select metodo from public.alertas where orden_id = 't-o6'"), [{ metodo: 'efectivo' }]);
      assert.doesNotMatch(checkDef(), /cuenta/);
      const rechazo = pg.sql("update public.alertas set metodo = 'cuenta' where orden_id = 't-o6';");
      assert.equal(rechazo.ok, false);
      assert.match(rechazo.error, /alertas_metodo_check/);
      const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: ALERTA, hasta: ALERTA });
      assert.ok(otra[0].ok, otra[0].error);
      assert.deepEqual(otra[0].avisos, []);
      assert.deepEqual(radiografia(pg), despuesAlerta);
      assert.match(checkDef(), /'cuenta'::text/);
      sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 't-o6';");
    });
  });
});

describe('se niega a correr, sin cambiar nada, si falta productos.dia_semana (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('sin la migración de la carta con etiquetas: error claro y NADA creado; con la cadena completa, se aplica sin avisos', () => {
    const aplicarMia = () => pg.sql(SQL, { como: 'migrador' });
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: '20261003130000' });
    assert.ok(previas.length >= 11 && previas.every((m) => m.ok), JSON.stringify(previas.filter((m) => !m.ok)));
    const a0 = radiografia(pg);
    const sinDia = aplicarMia();
    assert.equal(sinDia.ok, false);
    assert.match(sinDia.error, /Falta 20261003130000_carta_etiqueta_y_promos\.sql.*No se cambió nada/s);
    assert.deepEqual(radiografia(pg), a0, 'sin dia_semana: no dejó nada creado');
    assert.equal(pg.filas("select to_regprocedure('privado.promo_regla_ok(jsonb)') is null as n")[0].n, true);
    const resto = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: '20261003130000', antesDe: MIGRACION });
    assert.ok(resto.every((m) => m.ok), JSON.stringify(resto.filter((m) => !m.ok)));
    const bien = aplicarMia();
    assert.ok(bien.ok, bien.error);
    assert.deepEqual(bien.avisos, []);
  });
});
