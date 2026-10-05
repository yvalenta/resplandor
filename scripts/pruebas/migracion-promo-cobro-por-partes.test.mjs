// Cobrar por partes una cuenta con PROMOCIÓN: supabase/migrations/20261005130000_promo_cobro_por_partes.sql
// (hallazgo ALTO de la refutación del 2026-10-05, antes de salir al aire: «Cobrar por partes» rompía la promesa de que ninguna unidad recibe dos descuentos: el
// descuento del lunes se multiplicaba o desaparecía según qué línea se cobrara primero; con 5 Seco y cada comensal pagando el suyo, el restaurante cobraba
// 83.600 en vez de 91.200. Reproducido con un mesero de verdad —rol `authenticated` con la RLS—.) tareas/2026-10-04-hallazgos-domingo.md.
//
// La regla que cierra el hallazgo: UNA CUENTA CON PROMOCIÓN NO SE PARTE. La base rechaza (RS005, «promoción» y «por partes») una orden cerrada nueva con
// `parcial_de` que se lleva líneas de producto cuando la cuenta abierta de la que sale tiene una línea de promo (o la propia cerrada trae una). Se cobra la
// mesa completa o se reparte con abonos. Y `privado.normalizar_items` pliega también una línea de promo que llega sin su objeto `promo` (el camino de
// devolución de un POS sin recargar).
//
// Dos partes, como migracion-promo-regla-ejecutable.test.mjs:
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. La guardia (BEFORE INSERT por fila, SECURITY INVOKER, solo la API, RS005 con «promoción»
//      y «por partes», no frena abonos ni el marcador «para llevar» ni un reintento del upsert), los requisitos, que no cree permisos ni toque datos, que
//      `normalizar_items` conserve la firma y sea idéntica a la de 20261005100000 salvo el pliegue de promos sin objeto, y la reversa de la cabecera.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker, ver _supabase-simulado.mjs): la cadena de migraciones hasta el arreglo de permiso y, con un mesero y
//      un admin de verdad (RLS):
//        · SIN la migración: el defecto, con las cifras de la refutación (57.000, 83.600, 95.000, el Seco que se queda en la cuenta, la línea de promo suelta);
//        · CON ella: cada uno de esos cobros por partes se rechaza (RS005) y la cuenta, las ventas y la versión quedan intactas; la mesa completa da 91.200,
//          61.200 y 53.200 y el cierre del día los suma; un abono sí entra y no mueve el descuento; una cuenta sin promoción se cobra por partes como siempre y
//          «deshacer» devuelve la unidad; el dueño y service_role no se frenan; un reintento del upsert de un cobro que ya está no se rechaza;
//        · pasos al azar (agregar, quitar, cobrar por partes, abonar, deshacer) con las invariantes: el total es la suma de las líneas, hay tantas unidades
//          con descuento como grupos completos (contra un cálculo independiente), ninguna unidad se pierde ni se duplica entre la cuenta y las ventas, y ninguna venta
//          por partes lleva una línea de promo;
//        · se aplica dos veces sin cambiar nada, la reversa de la cabecera quita la guardia y volver a pegar 20261005100000 devuelve `normalizar_items` de antes;
//        · y se niega a correr, sin cambiar nada, si falta 20261005100000.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa } from './_cola-impresion-pg.mjs';

const NUEVA = '20261005130000_promo_cobro_por_partes.sql';
const ARREGLO = '20261005120000_promo_regla_ejecutable.sql';
const PRECIO_VIVO = '20261005100000_precio_vivo_y_promos.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${NUEVA}`);
const SQL_PRECIO_VIVO = leer(`supabase/migrations/${PRECIO_VIVO}`);
const SQL_ARREGLO = leer(`supabase/migrations/${ARREGLO}`);
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CODIGO = sinComentarios(SQL);
const CP = compacto(CODIGO);

/** El cuerpo $$ … end $$; de una función, tal cual está escrito en un archivo. */
function cuerpoDe(texto, firma) {
  const i = texto.indexOf(firma);
  assert.ok(i >= 0, `no encuentro «${firma}»`);
  const ini = texto.indexOf('as $$', i);
  const fin = texto.indexOf('end $$;', ini);
  assert.ok(ini > 0 && fin > ini, 'no encuentro el cuerpo $$ … end $$;');
  return texto.slice(ini, fin);
}

// ───────────────────────── 1. estática ─────────────────────────

test('va después del arreglo de permiso, con prefijo único, y las migraciones de hallazgos-domingo NO se tocaron', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.ok(nombres.includes(NUEVA) && nombres.includes(ARREGLO));
  assert.ok(nombres.indexOf(ARREGLO) < nombres.indexOf(NUEVA), 'se aplica después del arreglo de permiso');
  // La de precio vivo conserva su pliegue original (solo líneas de promo CON objeto): este cambio es una migración nueva, no una edición.
  const cp = compacto(sinComentarios(SQL_PRECIO_VIVO));
  assert.ok(cp.includes("if (v_item ->> 'id') like 'promo:%' and jsonb_typeof(v_item -> 'promo') = 'object' then continue; end if;"));
  assert.doesNotMatch(cp, /substring\(coalesce\(v_item/);
  assert.doesNotMatch(cp, /ordenes_guardia_promo/);
});

test('la guardia: BEFORE INSERT por fila, SECURITY INVOKER (current_user manda), search_path vacío, solo la API, y nadie puede ejecutarla a mano', () => {
  assert.match(CP, /create or replace function public\.ordenes_guardia_promo\(\) returns trigger language plpgsql set search_path = '' as \$function\$/);
  assert.doesNotMatch(CP.match(/create or replace function public\.ordenes_guardia_promo\(\)[^$]*\$function\$/)[0], /security definer/i, 'SECURITY INVOKER: current_user dice quién llama');
  assert.match(CP, /if current_user not in \('anon', 'authenticated'\) then return new; end if;/);
  assert.match(CP, /revoke all on function public\.ordenes_guardia_promo\(\) from public, anon, authenticated;/);
  assert.match(CP, /drop trigger if exists trg_ordenes_guardia_promo on public\.ordenes; create trigger trg_ordenes_guardia_promo before insert on public\.ordenes for each row execute function public\.ordenes_guardia_promo\(\);/);
  assert.doesNotMatch(CP, /\bgrant\b/, 'ningún GRANT: la guardia no llama a nada de privado, no necesita EXECUTE (lección de 20261005120000)');
  const guardia = CP.match(/create or replace function public\.ordenes_guardia_promo\(\).*?\$function\$;/)[0];
  assert.doesNotMatch(guardia, /privado\./, 'la guardia no llama a ninguna función de privado');
});

test('la guardia solo juzga lo que importa: cerrada nueva con parcial_de, que no existe todavía, que se lleva líneas de PRODUCTO (no abono ni para_llevar), y la cuenta o el cobro traen promo', () => {
  const guardia = CP.match(/create or replace function public\.ordenes_guardia_promo\(\).*?\$function\$;/)[0];
  assert.match(guardia, /if new\.estado is distinct from 'cerrada' or new\.parcial_de is null then return new; end if;/);
  assert.match(guardia, /if exists \(select 1 from public\.ordenes o where o\.id = new\.id\) then return new; end if;/, 'un reintento del upsert de un cobro que ya está no se vuelve a juzgar');
  assert.match(guardia, /\(e ->> 'id'\) <> 'para_llevar' and \(e ->> 'id'\) not like 'abono\\_%'/);
  assert.match(guardia, /o\.id = new\.parcial_de and o\.estado = 'abierta'/);
  assert.match(guardia, /\(x ->> 'id'\) like 'promo:%'/);
  assert.match(guardia, /\(e ->> 'id'\) like 'promo:%'/, 'también si la propia venta cerrada trae una línea de promo');
  // el error: el MISMO código que el cobro parcial de una cuenta archivada, para que el POS publicado (43d1926) lo sepa manejar; y dice «promoción» y «por partes»
  assert.match(guardia, /using errcode = 'RS005'/);
  assert.match(guardia, /raise exception 'la cuenta % tiene una promoción:[^']*por partes[^']*'/);
  assert.match(SQL, /A PROPÓSITO el mismo código/);
});

test('requisitos ANTES de crear nada; idempotente; la reversa de la cabecera nombra lo que crea; nada de datos (el repo es público)', () => {
  const iPrimero = Math.min(CODIGO.indexOf('create or replace function public.ordenes_guardia_promo'), CODIGO.indexOf('create or replace function privado.normalizar_items'));
  const requisitos = CODIGO.slice(0, iPrimero);
  assert.match(requisitos, /to_regprocedure\('privado\.normalizar_items\(jsonb,smallint\)'\) is null[\s\S]*Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /to_regprocedure\('public\.ordenes_guardia\(\)'\) is null[\s\S]*Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bdrop\b|\binsert\b|\bupdate\b/i);
  assert.doesNotMatch(CP.replace(/\$function\$.*?\$function\$/g, ' ').replace(/\$\$.*?\$\$/g, ' ').replace(/'[^']*'/g, ' '), /\b(insert into|delete from|update \S+ set)\b/i, 'fuera de los cuerpos no escribe ningún dato');
  assert.doesNotMatch(SQL, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ni un correo');
  const rev = reversa(SQL);
  assert.match(rev, /drop trigger if exists trg_ordenes_guardia_promo on public\.ordenes;/);
  assert.match(rev, /drop function if exists public\.ordenes_guardia_promo\(\);/);
  for (const frase of ['REVERSA', 'Idempotente', 'lo aplica Yonatan: aparca', 'DESPUÉS de que las tablets hayan recargado', '53.200', '83.600', 'UNA CUENTA CON PROMOCIÓN NO SE PARTE']) {
    assert.ok(SQL.includes(frase), `la cabecera no dice «${frase}»`);
  }
});

test('normalizar_items: misma firma y atributos, y su cuerpo es el de 20261005100000 salvo el pliegue de la promo SIN objeto (promociones y salida, byte a byte)', () => {
  const firma = /create or replace function privado\.normalizar_items\(p_items jsonb, p_dia smallint\)\s+returns jsonb\s+language plpgsql\s+stable\s+set search_path = ''/;
  assert.match(SQL, firma);
  assert.match(SQL_PRECIO_VIVO, firma);
  const nuevo = cuerpoDe(SQL, 'create or replace function privado.normalizar_items');
  const viejo = cuerpoDe(SQL_PRECIO_VIVO, 'create or replace function privado.normalizar_items');
  const desde = (c) => c.slice(c.indexOf('-- b. El precio de hoy'));
  assert.equal(desde(nuevo), desde(viejo), 'de «b. El precio de hoy» al final, el cuerpo es el de la migración de precio vivo, tal cual');
  assert.match(nuevo, /substring\(coalesce\(v_item ->> 'id', ''\) from '\^promo:\[\^:\]\*:\(\.\+\)\$'\)/);
  assert.match(SQL, /revoke all on function privado\.normalizar_items\(jsonb, smallint\) from public, anon, authenticated;/);
});

test('la comprobación final de la migración prueba la guardia, el permiso y los dos pliegues de normalizar_items', () => {
  const final = CODIGO.slice(CODIGO.lastIndexOf('do $$'));
  assert.match(final, /t\.tgtype = 7 and t\.tgenabled = 'O'/);
  assert.match(final, /has_function_privilege\('anon', 'public\.ordenes_guardia_promo\(\)'/);
  assert.match(final, /no pliega una línea de promo sin objeto/);
  assert.match(final, /dejó de plegar una línea de promo con objeto/);
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

const CLAIMS = {
  admin: { sub: '00000000-0000-4000-8000-0000000000a1', role: 'authenticated', email: 'admin@resplandor.test', app_metadata: { provider: 'google' } },
};

// Ayudantes de las pruebas (esquema t, que prepararSimulacion ya creó): corren con el rol de quien los llama, como el POS.
const AYUDANTES = String.raw`
-- «Lo que se ve»: las líneas de una orden como «2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200».
create or replace function t.ver(p_orden text) returns text language sql as
$$ select coalesce((select string_agg((e ->> 'qty') || '×' || (e ->> 'nombre') || '@' || (e ->> 'precio'), ' + ' order by o)
                      from public.ordenes x, jsonb_array_elements(x.items) with ordinality as q(e, o) where x.id = p_orden), '(vacía)')
       || ' = ' || coalesce((select total::text from public.ordenes where id = p_orden), '-') $$;

-- Lo que hace facturarParcial del POS: INSERT de la orden CERRADA con parcial_de y, después, UN delta −qty por línea, en orden. Devuelve lo cobrado.
create or replace function t.pagar(p_orden text, p_cobro text, p_ids text[], p_qtys int[]) returns numeric language plpgsql as
$$
declare o public.ordenes; it jsonb; v_items jsonb := '[]'; v_tot numeric := 0; i int; q int; l jsonb;
begin
  select * into o from public.ordenes where id = p_orden;
  for i in 1 .. array_length(p_ids, 1) loop
    select e into l from jsonb_array_elements(o.items) e where e ->> 'id' = p_ids[i];
    if l is null then raise exception 'la línea % no existe en %', p_ids[i], p_orden; end if;
    q := least(p_qtys[i], (l ->> 'qty')::int);
    v_items := v_items || jsonb_build_array(jsonb_set(l, '{qty}', to_jsonb(q)));
    v_tot := v_tot + (l ->> 'precio')::numeric * q;
  end loop;
  insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de)
  values (p_cobro, o.mesa_id, 'cerrada', v_items, v_tot, o.abierta_en, now(), p_orden);
  for it in select e from jsonb_array_elements(v_items) e loop
    perform public.aplicar_delta_orden(p_orden, it ->> 'id', it ->> 'nombre', (it ->> 'precio')::numeric, -(it ->> 'qty')::int, '');
  end loop;
  return v_tot;
end $$;

-- Cobra la mesa completa, como el upsert del POS: UPDATE a cerrada con la version que se vio.
create or replace function t.cobrar_todo(p_orden text) returns numeric language plpgsql as
$$ declare v int; r numeric; begin
  select version into v from public.ordenes where id = p_orden;
  update public.ordenes set estado = 'cerrada', cerrada_en = now(), version = v where id = p_orden returning total into r;
  return r;
end $$;

-- Un abono, como cobrarMonto: la cerrada «abono_<uid>» con parcial_de y +1 de «abono_recibido_<uid>» (precio negativo) en la cuenta.
create or replace function t.abonar(p_orden text, p_cobro text, p_uid text, p_monto numeric) returns void language plpgsql as
$$ declare o public.ordenes; begin
  select * into o from public.ordenes where id = p_orden;
  insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de)
  values (p_cobro, o.mesa_id, 'cerrada', jsonb_build_array(jsonb_build_object('id', 'abono_' || p_uid, 'nombre', 'Abono', 'precio', p_monto, 'qty', 1, 'nota', 'efectivo')), p_monto, o.abierta_en, now(), p_orden);
  perform public.aplicar_delta_orden(p_orden, 'abono_recibido_' || p_uid, 'Abono recibido', -p_monto, 1, 'efectivo');
end $$;

-- Deja la base sin cuentas, sin ventas ni cierres (como el dueño: ningún guardia de la API se mete).
create or replace function t.limpiar() returns void language plpgsql as
$$ begin
  perform t.fuera();
  delete from public.deshechos; delete from public.alertas; delete from public.ordenes; delete from public.cierres; delete from public.cierre_ordenes; delete from public.deltas_aplicados;
  update public.mesas set estado = 'libre';
end $$;
`;

// La simulación al azar vive en la base (plpgsql): cada paso se hace con el rol de un mesero (RLS) y después se revisan las invariantes como dueño.
const SIMULACION = String.raw`
-- El total de una cuenta del LUNES calculado sin normalizar_items: las unidades de Seco y Menú de mayor a menor precio; la 3.ª, 6.ª… lleva 20 %.
create or replace function t.sim_oraculo(p_items jsonb) returns numeric language plpgsql as $$
declare v_tot numeric := 0; v_pos int := 0; e jsonb; q int; k int; v_p numeric;
begin
  for e in select x from jsonb_array_elements(p_items) x where (x ->> 'id') not like 'abono\_%' loop
    q := (e ->> 'qty')::int; v_p := (e ->> 'precio')::numeric;
    if split_part(coalesce(e -> 'promo' ->> 'de', e ->> 'id'), '__', 1) not in ('zc-seco', 'zc-menu') or v_p <= 0 then v_tot := v_tot + v_p * q; end if;
  end loop;
  for e in select x from jsonb_array_elements(p_items) x
            where (x ->> 'id') not like 'abono\_%' and split_part(coalesce(x -> 'promo' ->> 'de', x ->> 'id'), '__', 1) in ('zc-seco', 'zc-menu')
            order by coalesce((x -> 'promo' ->> 'precio')::numeric, (x ->> 'precio')::numeric) desc loop
    q := (e ->> 'qty')::int; v_p := coalesce((e -> 'promo' ->> 'precio')::numeric, (e ->> 'precio')::numeric);
    for k in 1 .. q loop
      v_pos := v_pos + 1;
      v_tot := v_tot + case when v_pos % 3 = 0 then round(v_p * 0.8) else v_p end;
    end loop;
  end loop;
  return v_tot;
end $$;

create or replace function t.sim_invariantes(p_id text, p_neto jsonb) returns text language plpgsql as $$
declare o public.ordenes; v_suma numeric; v_elegibles int; v_promo int; r record; v_abierto int; v_cerrado int;
begin
  select * into o from public.ordenes where id = p_id;
  select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_suma from jsonb_array_elements(o.items) e;
  if o.total is distinct from v_suma then return 'el total ' || o.total || ' no es la suma de las líneas ' || v_suma; end if;
  select coalesce(sum((e ->> 'qty')::int), 0) into v_elegibles from jsonb_array_elements(o.items) e
   where split_part(coalesce(e -> 'promo' ->> 'de', e ->> 'id'), '__', 1) in ('zc-seco', 'zc-menu') and (e ->> 'id') not like 'abono\_%';
  select coalesce(sum((e ->> 'qty')::int), 0) into v_promo from jsonb_array_elements(o.items) e where (e ->> 'id') like 'promo:%';
  if v_promo <> v_elegibles / 3 then return 'hay ' || v_promo || ' unidades con descuento y ' || v_elegibles || ' elegibles (deberían ser ' || (v_elegibles / 3) || ')'; end if;
  if exists (select 1 from jsonb_array_elements(o.items) e where (e ->> 'id') like 'promo:%'
              and (not (e ? 'promo') or e ->> 'id' <> 'promo:' || (e -> 'promo' ->> 'id') || ':' || (e -> 'promo' ->> 'de'))) then return 'una línea de promo suelta o mal formada: ' || o.items::text; end if;
  select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_suma from jsonb_array_elements(o.items) e where (e ->> 'id') not like 'abono\_%';
  if v_suma is distinct from t.sim_oraculo(o.items) then return 'el total de las líneas ' || v_suma || ' no es el del cálculo independiente ' || t.sim_oraculo(o.items) || ': ' || o.items::text; end if;
  if exists (select 1 from public.ordenes c, jsonb_array_elements(c.items) e where c.parcial_de = p_id and c.estado = 'cerrada' and (e ->> 'id') like 'promo:%') then
    return 'una venta por partes lleva una línea de promo';
  end if;
  for r in select k.key as prod, k.value::int as neto from jsonb_each_text(p_neto) k loop
    select coalesce(sum((e ->> 'qty')::int), 0) into v_abierto from jsonb_array_elements(o.items) e where split_part(coalesce(e -> 'promo' ->> 'de', e ->> 'id'), '__', 1) = r.prod;
    select coalesce(sum((e ->> 'qty')::int), 0) into v_cerrado from public.ordenes c, jsonb_array_elements(c.items) e
     where c.parcial_de = p_id and c.estado = 'cerrada' and (e ->> 'id') not like 'abono\_%' and split_part(coalesce(e -> 'promo' ->> 'de', e ->> 'id'), '__', 1) = r.prod;
    if v_abierto + v_cerrado <> r.neto then return 'unidades de ' || r.prod || ': agregadas − quitadas = ' || r.neto || ' pero hay ' || v_abierto || ' en la cuenta y ' || v_cerrado || ' en ventas por partes'; end if;
  end loop;
  return null;
end $$;

create or replace function t.simular(p_semilla double precision, p_pasos int, p_mesa int) returns jsonb language plpgsql as $$
declare
  v_id text := 'sim-' || p_mesa;
  v_catalogo text[][] := array[['zc-seco', 'Seco', '19000'], ['zc-menu', 'Menú Resplandor', '23000'], ['zc-sopa', 'Sopa', '7000'], ['zc-jugo', 'Jugo natural', '12000']];
  v_neto jsonb := '{}'::jsonb;
  v_aceptados int := 0; v_rechazados int := 0; v_abonos int := 0; v_deshechos int := 0; v_paso int; v_op int; v_k int; v_prod text;
  v_ids text[]; v_qtys int[]; o public.ordenes; v_err text; v_hay_promo boolean; v_cobro text; v_monto numeric; v_res jsonb;
begin
  perform setseed(p_semilla);
  perform t.limpiar();
  insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (v_id, p_mesa, 'abierta', '[]', 0, '2026-10-05 17:00:00+00');
  for v_paso in 1 .. p_pasos loop
    v_op := floor(random() * 100);
    perform t.como('mesero');
    begin
      if v_op < 30 then                                                         -- agregar una unidad
        v_k := 1 + floor(random() * 4);
        perform public.aplicar_delta_orden(v_id, v_catalogo[v_k][1], v_catalogo[v_k][2], v_catalogo[v_k][3]::numeric, 1, '');
        v_neto := jsonb_set(v_neto, array[v_catalogo[v_k][1]], to_jsonb(coalesce((v_neto ->> v_catalogo[v_k][1])::int, 0) + 1));
      elsif v_op < 42 then                                                      -- quitar una unidad de una línea BASE (el POS no deja tocar una línea de promo)
        select e ->> 'id' into v_prod from public.ordenes x, jsonb_array_elements(x.items) e
         where x.id = v_id and (e ->> 'id') not like 'promo:%' and (e ->> 'id') not like 'abono\_%' order by random() limit 1;
        if v_prod is not null then
          perform public.aplicar_delta_orden(v_id, v_prod, 'x', 1, -1, '');
          v_neto := jsonb_set(v_neto, array[split_part(v_prod, '__', 1)], to_jsonb(coalesce((v_neto ->> split_part(v_prod, '__', 1))::int, 0) - 1));
        end if;
      elsif v_op < 70 then                                                      -- cobrar por partes: un subconjunto al azar de las líneas, cada una con 1..qty unidades
        select array_agg(e ->> 'id'), array_agg(1 + floor(random() * (e ->> 'qty')::int)::int)
          into v_ids, v_qtys
          from public.ordenes x, jsonb_array_elements(x.items) e
         where x.id = v_id and (e ->> 'id') not like 'abono\_%' and random() < 0.5;
        if v_ids is not null then
          v_cobro := 'sp-' || p_mesa || '-' || v_paso;
          select exists (select 1 from jsonb_array_elements(x.items) e where (e ->> 'id') like 'promo:%') into v_hay_promo from public.ordenes x where x.id = v_id;
          begin
            perform t.pagar(v_id, v_cobro, v_ids, v_qtys);
            if v_hay_promo then raise exception 'SE DEJÓ cobrar por partes una cuenta con promoción (paso %)', v_paso; end if;
            v_aceptados := v_aceptados + 1;
          exception when sqlstate 'RS005' then
            if not v_hay_promo and not exists (select 1 from unnest(v_ids) i where i like 'promo:%') then raise exception 'se RECHAZÓ un cobro por partes sin promoción (paso %)', v_paso; end if;
            v_rechazados := v_rechazados + 1;
          end;
        end if;
      elsif v_op < 80 then                                                      -- un abono por un monto cualquiera menor que lo que falta
        select * into o from public.ordenes where id = v_id;
        if o.total >= 3000 then
          v_monto := 1000 * (1 + floor(random() * ((o.total / 1000)::int - 1)));
          v_cobro := 'sa-' || p_mesa || '-' || v_paso;
          perform t.abonar(v_id, v_cobro, 'u' || p_mesa || '_' || v_paso, v_monto);
          v_abonos := v_abonos + 1;
        end if;
      elsif v_op < 92 then                                                      -- deshacer un cobro (por partes o abono) de esta cuenta
        select c.id into v_cobro from public.ordenes c where c.parcial_de = v_id and c.estado = 'cerrada' order by random() limit 1;
        if v_cobro is not null then
          v_res := public.deshacer_cobro(v_cobro);
          if (v_res ->> 'ok') <> 'true' then raise exception 'deshacer_cobro % respondió %', v_cobro, v_res; end if;
          v_deshechos := v_deshechos + 1;
        end if;
      end if;
    exception when others then
      perform t.fuera();
      return jsonb_build_object('semilla', p_semilla, 'paso', v_paso, 'op', v_op, 'falla', sqlerrm, 'cuenta', (select t.ver(v_id)));
    end;
    perform t.fuera();
    v_err := t.sim_invariantes(v_id, v_neto);
    if v_err is not null then
      return jsonb_build_object('semilla', p_semilla, 'paso', v_paso, 'op', v_op, 'falla', v_err, 'cuenta', (select t.ver(v_id)));
    end if;
  end loop;
  -- Al final, la mesa completa se cobra (si los abonos no la dejaron en negativo: la RLS no deja cerrar una cuenta con total negativo)
  select * into o from public.ordenes where id = v_id;
  if o.total >= 0 then
    perform t.como('mesero');
    perform t.cobrar_todo(v_id);
    perform t.fuera();
  end if;
  return jsonb_build_object('semilla', p_semilla, 'aceptados', v_aceptados, 'rechazados', v_rechazados, 'abonos', v_abonos, 'deshechos', v_deshechos);
end $$;
`;

describe('contra un Postgres 17 desechable: la guardia con un mesero y un admin de verdad (RLS)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  const comoMesero = (texto) => pg.sql(`select t.como('mesero');\n${texto}`);
  const comoAdmin = (texto) => pg.sql(`select t.como('admin');\n${texto}`);
  const sql = (texto, opciones) => { const r = pg.sql(texto, opciones); assert.ok(r.ok, r.error); return r; };
  const una = (select) => pg.filas(select)[0];
  const aplicarNueva = () => pg.sql(SQL, { como: 'migrador' });
  const limpiar = () => sql('select t.limpiar();');
  const ultima = (r) => r.salida.split('\n').pop();
  /** Una cuenta abierta del lunes 2026-10-05 12:00 (Bogotá) en la mesa `mesa`, con los ítems dados; la base la normaliza (precio de hoy y promo del día). */
  const cuenta = (id, mesa, items) => sql(`select t.fuera(); insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', ${literal(JSON.stringify(items))}::jsonb, 0, '2026-10-05 17:00:00+00'); update public.mesas set estado = 'ocupada' where id = ${mesa};`);
  const ver = (id) => una(`select t.ver(${literal(id)}) as v`).v;
  const total = (id) => Number(una(`select total from public.ordenes where id = ${literal(id)}`).total);
  const ventas = () => pg.filas("select id, total, parcial_de, items from public.ordenes where estado = 'cerrada' order by id");
  const SECO = (qty) => ({ id: 'zc-seco', nombre: 'Seco', precio: 19000, qty, nota: '' });
  const MENU = (qty) => ({ id: 'zc-menu', nombre: 'Menú Resplandor', precio: 23000, qty, nota: '' });
  const PROMO_SECO = 'promo:zc-promo:zc-seco';

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: NUEVA });
    assert.ok(previas.length >= 17 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    assert.ok(previas.some((m) => m.archivo === ARREGLO), 'el arreglo de permiso va antes');
    sql(AYUDANTES);
    sql(SIMULACION);
    sql(`
      insert into public.personal (email, nombre, rol, activo, estado) values ('mesero1@resplandor.test', 'Mesero Uno', 'mesero', true, 'aprobado');
      insert into public.productos (id, categoria, nombre, precio, activo) values
        ('zc-menu','Ejecutivos','Menú Resplandor',23000,true), ('zc-seco','Ejecutivos','Seco',19000,true), ('zc-sopa','Ejecutivos','Sopa',7000,true),
        ('zc-jugo','Bebidas','Jugo natural',12000,true), ('zc-marga','Bebidas','Margarita',30000,true);
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
        ('zc-promo','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"productos":["zc-menu","zc-seco"]}}'),
        ('zc-promo-mie','Promociones','Cócteles',0,true,'2 x 1',3,'{"cada":2,"descuento":100,"aplica":{"productos":["zc-marga"]}}');
      insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'a') from generate_series(1, 60) g;
    `);
    antes = radiografia(pg);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  // ── el defecto, SIN la migración ──

  test('SIN la migración, el defecto con las cifras de la refutación: 3 Seco → 57.000; 5 Seco → 83.600 (promo primero); 2 Menú + 1 Seco → 65.000', () => {
    limpiar();
    cuenta('d1', 1, [SECO(3)]); cuenta('d2', 2, [SECO(5)]); cuenta('d4', 4, [MENU(2), SECO(1)]);
    assert.equal(total('d1'), 53200); assert.equal(total('d2'), 91200); assert.equal(total('d4'), 61200);
    // 3 Seco: el primer comensal paga UN Seco de la línea base
    let r = comoMesero("select t.pagar('d1', 'p1', array['zc-seco'], array[1]);");
    assert.ok(r.ok, r.error);
    assert.equal(Number(ventas().find((v) => v.id === 'p1').total) + total('d1'), 57000, 'el cliente paga 3.800 de más: la promo se plegó');
    // 5 Seco: cada comensal toca la línea de promo mientras siga apareciendo
    r = comoMesero(`do $$ declare i int; l text; begin
      for i in 1..5 loop
        select e ->> 'id' into l from public.ordenes o, jsonb_array_elements(o.items) e where o.id = 'd2' and e ->> 'id' like 'promo:%' limit 1;
        if l is null then select e ->> 'id' into l from public.ordenes o, jsonb_array_elements(o.items) e where o.id = 'd2' limit 1; end if;
        perform t.pagar('d2', 'p2-' || i, array[l], array[1]);
      end loop; end $$;`);
    assert.ok(r.ok, r.error);
    assert.equal(ventas().filter((v) => v.id.startsWith('p2-')).reduce((s, v) => s + Number(v.total), 0), 83600, 'el restaurante pierde 7.600 en una mesa');
    // 2 Menú + 1 Seco por persona, el Menú primero
    r = comoMesero("select t.pagar('d4', 'p4', array['zc-menu'], array[1]);");
    assert.ok(r.ok, r.error);
    assert.equal(Number(ventas().find((v) => v.id === 'p4').total) + total('d4'), 65000);
  });

  test('SIN la migración: 5 Seco pagando siempre la línea base nunca ganan el descuento (95.000), y cobrar las DOS líneas de un grupo deja un Seco ya pagado en la cuenta', () => {
    limpiar();
    cuenta('d5', 5, [SECO(5)]); cuenta('d3', 3, [SECO(3)]);
    const r = comoMesero(`do $$ declare i int; l text; begin
      for i in 1..5 loop
        select e ->> 'id' into l from public.ordenes o, jsonb_array_elements(o.items) e where o.id = 'd5' limit 1;
        perform t.pagar('d5', 'p5-' || i, array[l], array[1]);
      end loop; end $$;`);
    assert.ok(r.ok, r.error);
    assert.equal(ventas().filter((v) => v.id.startsWith('p5-')).reduce((s, v) => s + Number(v.total), 0), 95000);
    const c = comoMesero(`select t.pagar('d3', 'p3', array['zc-seco', ${literal(PROMO_SECO)}], array[2, 1]);`);
    assert.ok(c.ok, c.error);
    assert.equal(Number(ventas().find((v) => v.id === 'p3').total), 53200, 'se cobró el grupo entero');
    assert.equal(ver('d3'), '1×Seco@19000 = 19000', 'y en la cuenta abierta SIGUE un Seco de 19.000 que ya se pagó: el segundo delta no encontró su línea');
  });

  test('SIN la migración: devolver una línea de promo con aplicar_delta_orden (lo que hace el POS publicado al rechazarse un cobro) deja una línea SUELTA que luego se suma al descuento nuevo', () => {
    limpiar();
    cuenta('d6', 6, [SECO(3)]);
    const r = comoMesero(`select public.aplicar_delta_orden('d6', ${literal(PROMO_SECO)}, 'Seco · 3er almuerzo · 20% OFF', 15200, -1, '') is not null;
      select public.aplicar_delta_orden('d6', ${literal(PROMO_SECO)}, 'Seco · 3er almuerzo · 20% OFF', 15200, 1, '') is not null;
      select public.aplicar_delta_orden('d6', 'zc-seco', 'Seco', 19000, 1, '') is not null;`);
    assert.ok(r.ok, r.error);
    assert.equal(total('d6'), 68400, 'cuatro Seco deberían ser 72.200: la línea suelta no es la del descuento calculado');
    assert.equal(pg.filas("select e from public.ordenes o, jsonb_array_elements(o.items) e where o.id = 'd6' and e ->> 'id' like 'promo:%' and not (e ? 'promo')").length, 1, 'una línea de promo sin su objeto');
  });

  // ── la migración ──

  test('la migración se aplica como migrador (no superusuario), sin WARNING, y cambia SOLO lo suyo: la guardia (función y trigger) y el cuerpo de normalizar_items', () => {
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
      /^funciones: nuevo .*"proname":"ordenes_guardia_promo"/,
      /^funciones: ya no está .*"proname":"normalizar_items"/,
      /^funciones: nuevo .*"proname":"normalizar_items"/,
      /^triggers: nuevo .*"tgname":"trg_ordenes_guardia_promo"/,
    ];
    assert.equal(cambios.length, esperados.length, cambios.join('\n'));
    for (const e of esperados) assert.ok(cambios.some((c) => e.test(c)), `falta el cambio ${e}: ${cambios.join('\n')}`);
    antes = despues;
  });

  test('el mesero cobra «por partes» una cuenta con promoción, de cualquier forma: se rechaza con RS005 (promoción, por partes), y la cuenta, la versión y las ventas quedan INTACTAS', () => {
    limpiar();
    cuenta('a1', 1, [SECO(3)]);
    const v0 = una("select version, items, total from public.ordenes where id = 'a1'");
    assert.equal(ver('a1'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
    const intentos = [
      ["array['zc-seco']", 'array[1]', 'una unidad de la línea base'],
      ["array['zc-seco']", 'array[2]', 'toda la línea base'],
      [`array[${literal(PROMO_SECO)}]`, 'array[1]', 'solo la línea de promo'],
      [`array['zc-seco', ${literal(PROMO_SECO)}]`, 'array[2, 1]', 'las dos líneas del grupo'],
    ];
    for (const [ids, qtys, que] of intentos) {
      const r = pg.sql(`select t.como('mesero');\nselect t.pagar('a1', 'pa', ${ids}, ${qtys});`);
      assert.equal(r.ok, false, `se dejó cobrar por partes: ${que}`);
      assert.match(r.error, /la cuenta a1 tiene una promoción: el descuento se calcula con toda la cuenta junta, así que no se puede cobrar por partes ni por persona/, que);
      const e = pg.sql(`\\set VERBOSITY verbose\nselect t.como('mesero');\nselect t.pagar('a1', 'pa', ${ids}, ${qtys});`);
      assert.match(e.error, /RS005/, `${que}: el código es RS005`);
      assert.match(e.error, /HINT:\s+Cobra la mesa completa, o recibe un abono por cada quien/);
    }
    assert.deepEqual(una("select version, items, total from public.ordenes where id = 'a1'"), v0, 'la cuenta no cambió ni en la versión');
    assert.deepEqual(ventas(), [], 'ninguna venta');
  });

  test('el admin tampoco cobra por partes una cuenta con promoción (la regla es de dinero, no de rol)', () => {
    limpiar();
    cuenta('a2', 2, [MENU(2), SECO(1)]);
    assert.equal(ver('a2'), '2×Menú Resplandor@23000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 61200');
    const r = comoAdmin("select t.pagar('a2', 'pb', array['zc-menu'], array[1]);");
    assert.equal(r.ok, false);
    assert.match(r.error, /tiene una promoción/);
    assert.deepEqual(ventas(), []);
    assert.equal(total('a2'), 61200);
  });

  test('5 Seco «cada comensal paga el suyo»: los cinco intentos se rechazan, la cuenta no se mueve, y la mesa completa da 91.200 (no 83.600)', () => {
    limpiar();
    cuenta('a3', 3, [SECO(5)]);
    assert.equal(ver('a3'), '4×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 91200');
    const v0 = una("select version from public.ordenes where id = 'a3'").version;
    for (let i = 1; i <= 5; i += 1) {
      const linea = i % 2 === 0 ? PROMO_SECO : 'zc-seco';
      const r = comoMesero(`select t.pagar('a3', ${literal('pc-' + i)}, array[${literal(linea)}], array[1]);`);
      assert.equal(r.ok, false, `el intento ${i} (${linea}) se dejó pasar`);
    }
    assert.equal(una("select version from public.ordenes where id = 'a3'").version, v0);
    const cobrado = comoMesero("select t.cobrar_todo('a3');");
    assert.ok(cobrado.ok, cobrado.error);
    assert.equal(ultima(cobrado), '91200');
    assert.deepEqual(ventas().map((v) => [v.id, Number(v.total)]), [['a3', 91200]]);
  });

  test('2 Menú + 1 Seco «por persona» (el Menú primero, el Seco primero, los dos Menú juntos): se rechaza todo; la mesa completa da 61.200; el cierre del día suma lo cobrado', () => {
    limpiar();
    cuenta('a4', 4, [MENU(2), SECO(1)]);
    for (const [ids, qtys] of [["array['zc-menu']", 'array[1]'], [`array[${literal(PROMO_SECO)}]`, 'array[1]'], ["array['zc-menu']", 'array[2]']]) {
      const r = comoMesero(`select t.pagar('a4', 'pd', ${ids}, ${qtys});`);
      assert.equal(r.ok, false);
    }
    cuenta('a5', 5, [SECO(3)]);
    const ambas = comoMesero("select t.cobrar_todo('a4'); select t.cobrar_todo('a5');");
    assert.ok(ambas.ok, ambas.error);
    assert.deepEqual(ventas().map((v) => [v.id, Number(v.total)]), [['a4', 61200], ['a5', 53200]]);
    // el cierre del día: la base lo decide, y suma lo que se cobró
    const cierre = comoAdmin("select public.cerrar_dia('cierre-pc', '{\"n\":2,\"total\":114400,\"ids\":[\"a4\",\"a5\"]}'::jsonb) ->> 'ok';");
    assert.ok(cierre.ok, cierre.error);
    assert.equal(ultima(cierre), 'true', 'el cierre del día aceptó 2 ventas por 114.400');
    assert.equal(Number(una("select total_ventas from public.cierres where id = 'cierre-pc'").total_ventas), 114400);
    assert.deepEqual(ventas(), [], 'las ventas se archivaron');
  });

  test('una venta cerrada que trae una línea de promo se rechaza aunque la cuenta de la base (más nueva) ya no la tenga: la tablet tenía una foto vieja', () => {
    limpiar();
    cuenta('a6', 6, [SECO(2)]);
    assert.equal(ver('a6'), '2×Seco@19000 = 38000');
    const promo = { id: PROMO_SECO, nombre: 'Seco · 3er almuerzo · 20% OFF', precio: 15200, qty: 1, nota: '', promo: { id: 'zc-promo', de: 'zc-seco', nombre: 'Seco', precio: 19000, descuento: 20 } };
    const r = comoMesero(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de)
      values ('pe', 6, 'cerrada', ${literal(JSON.stringify([promo]))}::jsonb, 15200, now(), now(), 'a6');`);
    assert.equal(r.ok, false);
    assert.match(r.error, /tiene una promoción/);
    assert.deepEqual(ventas(), []);
  });

  test('un ABONO sí entra en una cuenta con promoción y NO mueve el descuento; abonos + la mesa completa = 61.200; y deshacer el abono lo devuelve', () => {
    limpiar();
    cuenta('b1', 7, [MENU(2), SECO(1)]);
    const r = comoMesero("select t.abonar('b1', 'ab-1', 'u1', 30000); select t.abonar('b1', 'ab-2', 'u2', 11200);");
    assert.ok(r.ok, r.error);
    const lineas = pg.filas("select e ->> 'id' as id, (e ->> 'qty')::int as qty, (e ->> 'precio')::numeric as precio from public.ordenes o, jsonb_array_elements(o.items) e where o.id = 'b1' order by 1");
    assert.deepEqual(lineas.filter((l) => !l.id.startsWith('abono_recibido_')).map((l) => `${l.id}×${l.qty}@${l.precio}`), [`${PROMO_SECO}×1@15200`, 'zc-menu×2@23000'], 'el descuento sigue donde estaba');
    assert.equal(total('b1'), 61200 - 30000 - 11200, 'queda por pagar lo que falta');
    const cobrado = comoMesero("select t.cobrar_todo('b1');");
    assert.equal(Number(ultima(cobrado)), 20000);
    const suma = ventas().reduce((s, v) => s + Number(v.total), 0);
    assert.equal(suma, 61200, 'abono + abono + el resto = lo que da la cuenta junta');
    // deshacer un abono (otra cuenta)
    cuenta('b2', 8, [SECO(3)]);
    assert.ok(comoMesero("select t.abonar('b2', 'ab-3', 'u3', 20000);").ok);
    assert.equal(total('b2'), 33200);
    const d = comoMesero("select public.deshacer_cobro('ab-3') ->> 'ok';");
    assert.equal(ultima(d), 'true');
    assert.equal(ver('b2'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
    assert.equal(ventas().filter((v) => v.id === 'ab-3').length, 0);
  });

  test('una cuenta SIN promoción se cobra por partes como siempre; «deshacer» devuelve la unidad; y lo cobrado antes del trío no cuenta para el trío que se arme después', () => {
    limpiar();
    cuenta('c1', 9, [SECO(2), { id: 'zc-jugo', nombre: 'Jugo natural', precio: 12000, qty: 1, nota: '' }]);
    assert.equal(ver('c1'), '2×Seco@19000 + 1×Jugo natural@12000 = 50000');
    let r = comoMesero("select t.pagar('c1', 'cp1', array['zc-seco', 'zc-jugo'], array[1, 1]);");
    assert.ok(r.ok, r.error);
    assert.equal(Number(ventas().find((v) => v.id === 'cp1').total), 31000);
    assert.equal(ver('c1'), '1×Seco@19000 = 19000');
    // deshacer: el Seco y el Jugo vuelven
    r = comoMesero("select public.deshacer_cobro('cp1') ->> 'ok';");
    assert.equal(ultima(r), 'true');
    assert.equal(ver('c1'), '2×Seco@19000 + 1×Jugo natural@12000 = 50000');
    // cobrar por partes OTRA VEZ, y sumar tres Seco: el trío se arma con lo que hay en la cuenta (los Seco cobrados no cuentan)
    assert.ok(comoMesero("select t.pagar('c1', 'cp2', array['zc-seco'], array[2]);").ok);
    assert.equal(ver('c1'), '1×Jugo natural@12000 = 12000');
    assert.ok(comoMesero("select public.aplicar_delta_orden('c1', 'zc-seco', 'Seco', 19000, 3, '') is not null;").ok);
    assert.equal(ver('c1'), '1×Jugo natural@12000 + 2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 65200');
    // deshacer el cobro de los dos Seco con un trío ya armado: vuelven y la base rehace el descuento con las cinco unidades (un solo descuento)
    assert.ok(comoMesero("select public.deshacer_cobro('cp2') ->> 'ok';").ok);
    assert.equal(ver('c1'), '1×Jugo natural@12000 + 4×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 103200');
    assert.equal(una("select (select sum((e ->> 'qty')::int) from jsonb_array_elements(items) e where e ->> 'nombre' like 'Seco%') as u from public.ordenes where id = 'c1'").u, 5);
  });

  test('2x1 del miércoles: la línea gratis («2 x 1», $0) tampoco se cobra por partes; y sin la pareja se cobra normal', () => {
    limpiar();
    sql("select t.fuera(); insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('w1', 10, 'abierta', '[{\"id\":\"zc-marga\",\"nombre\":\"Margarita\",\"precio\":30000,\"qty\":2,\"nota\":\"\"}]', 0, '2026-10-07 17:00:00+00');");
    assert.equal(ver('w1'), '1×Margarita@30000 + 1×Margarita · Cócteles · 2 x 1@0 = 30000');
    for (const ids of ["array['zc-marga']", "array['promo:zc-promo-mie:zc-marga']"]) {
      const r = comoMesero(`select t.pagar('w1', 'pw', ${ids}, array[1]);`);
      assert.equal(r.ok, false, ids);
      assert.match(r.error, /tiene una promoción/);
    }
    sql("select t.fuera(); insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('w2', 11, 'abierta', '[{\"id\":\"zc-marga\",\"nombre\":\"Margarita\",\"precio\":30000,\"qty\":1,\"nota\":\"\"},{\"id\":\"zc-sopa\",\"nombre\":\"Sopa\",\"precio\":7000,\"qty\":1,\"nota\":\"\"}]', 0, '2026-10-07 17:00:00+00');");
    assert.ok(comoMesero("select t.pagar('w2', 'pw2', array['zc-marga'], array[1]);").ok, 'una sola Margarita no tiene pareja: sin promoción, se cobra por partes');
  });

  test('lo que NO es de la API no se frena: el dueño (SQL Editor) inserta la venta por partes aunque la cuenta tenga promo; y anon no escribe ventas', () => {
    limpiar();
    cuenta('e1', 12, [SECO(3)]);
    const fila = (id) => `insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de) values ('${id}', 12, 'cerrada', '[{"id":"zc-seco","nombre":"Seco","precio":19000,"qty":1,"nota":""}]', 19000, now(), now(), 'e1');`;
    assert.ok(pg.sql(fila('eo'), { como: 'migrador' }).ok, 'el dueño no se frena');
    const a = pg.sql(fila('ea'), { como: 'anon' });
    assert.equal(a.ok, false, 'anon no escribe ventas (la RLS)');
    assert.deepEqual(ventas().map((v) => v.id), ['eo']);
  });

  test('un reintento del upsert de un cobro que la base YA tiene no se vuelve a rechazar, aunque la cuenta haya ganado una promo mientras tanto', () => {
    limpiar();
    cuenta('f1', 13, [SECO(2)]);
    assert.ok(comoAdmin("select t.pagar('f1', 'fp1', array['zc-seco'], array[1]);").ok, 'cobrado cuando no había promo');
    assert.ok(comoAdmin("select public.aplicar_delta_orden('f1', 'zc-seco', 'Seco', 19000, 2, '') is not null;").ok);
    assert.ok(ver('f1').includes('3er almuerzo'), `ahora la cuenta SÍ tiene promo: ${ver('f1')}`);
    const reintento = comoAdmin(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de)
      values ('fp1', 13, 'cerrada', '[{"id":"zc-seco","nombre":"Seco","precio":19000,"qty":1,"nota":""}]', 19000, now(), now(), 'f1')
      on conflict (id) do update set total = excluded.total;`);
    assert.ok(reintento.ok, `el reintento no es un cobro nuevo: ${reintento.error}`);
    assert.equal(ventas().filter((v) => v.id === 'fp1').length, 1);
    // …pero un cobro NUEVO sobre esa cuenta sí se rechaza
    assert.equal(comoAdmin("select t.pagar('f1', 'fp2', array['zc-seco'], array[1]);").ok, false);
  });

  test('la devolución de una línea de promo SIN su objeto (el POS publicado, al rechazarse un cobro) se pliega en su base: la cuenta queda como estaba y agregar un Seco da 72.200', () => {
    limpiar();
    cuenta('g1', 14, [SECO(3)]);
    const r = comoMesero(`select public.aplicar_delta_orden('g1', ${literal(PROMO_SECO)}, 'Seco · 3er almuerzo · 20% OFF', 15200, -1, '') is not null;
      select public.aplicar_delta_orden('g1', ${literal(PROMO_SECO)}, 'Seco · 3er almuerzo · 20% OFF', 15200, 1, '') is not null;`);
    assert.ok(r.ok, r.error);
    assert.equal(ver('g1'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
    assert.equal(pg.filas("select e from public.ordenes o, jsonb_array_elements(o.items) e where o.id = 'g1' and e ->> 'id' like 'promo:%' and not (e ? 'promo')").length, 0, 'ninguna línea de promo suelta');
    assert.ok(comoMesero("select public.aplicar_delta_orden('g1', 'zc-seco', 'Seco', 19000, 1, '') is not null;").ok);
    assert.equal(total('g1'), 72200, 'cuatro Seco: tres completos y un descuento');
    // y normalizar_items directo: una promo sin base se recrea con el nombre y el precio del producto
    const sinBase = una(`select privado.normalizar_items('[{"id":"${PROMO_SECO}","nombre":"Seco · 3er almuerzo · 20% OFF","precio":15200,"qty":1,"nota":"Persona 1"}]'::jsonb, 1::smallint) as v`).v;
    assert.deepEqual(sinBase, [{ id: 'zc-seco', nombre: 'Seco', precio: 19000, qty: 1, nota: 'Persona 1' }]);
  });

  test('el cobro de la MESA COMPLETA no pasa por la guardia (es un UPDATE): una cuenta con promo se cobra entera, y la versión que se vio se sigue exigiendo', () => {
    limpiar();
    cuenta('h1', 15, [SECO(3)]);
    const v = una("select version from public.ordenes where id = 'h1'").version;
    const mal = comoMesero(`update public.ordenes set estado = 'cerrada', cerrada_en = now(), version = ${v + 7} where id = 'h1';`);
    assert.equal(mal.ok, false);
    assert.match(mal.error, /cambió desde que se vio/, 'RS003 sigue funcionando');
    const bien = comoMesero("select t.cobrar_todo('h1');");
    assert.ok(bien.ok, bien.error);
    assert.equal(Number(ventas().find((x) => x.id === 'h1').total), 53200);
  });

  // ── el protocolo del POS nuevo (segunda refutación, 2026-10-05): el cobro ENTRA PRIMERO y sus unidades salen detrás, solo si la base lo aceptó ──
  // Cada sentencia es su propia transacción (psql en autocommit, ON_ERROR_STOP): así llegan las subidas del POS, la venta y cada delta son llamadas HTTP separadas, y
  // si la venta se rechaza el guion se detiene ANTES de los deltas, como el POS nuevo. El orden viejo (deltas primero, o a la vez) se reproduce poniendo los deltas antes.
  const LINEA = (id, nombre, precio) => ({ id, nombre, precio });
  const venta = (orden, mesa, cobro, items) => `insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de)
    values (${literal(cobro)}, ${mesa}, 'cerrada', ${literal(JSON.stringify(items))}::jsonb, ${items.reduce((n, i) => n + i.precio * i.qty, 0)}, now(), now(), ${literal(orden)});`;
  const delta = (orden, l, d) => `select public.aplicar_delta_orden(${literal(orden)}, ${literal(l.id)}, ${literal(l.nombre)}, ${l.precio}, ${d}, '') is not null;`;
  const lineaSeco = LINEA('zc-seco', 'Seco', 19000);
  const lineaMenu = LINEA('zc-menu', 'Menú Resplandor', 23000);
  const sumaVentas = (prefijo) => ventas().filter((v) => v.id.startsWith(prefijo)).reduce((n, v) => n + Number(v.total), 0);

  test('hallazgo 1 (copia atrasada, la línea base YA NO EXISTE): el −qty no encuentra su línea y la «devolución» +qty sumaba un Seco que nunca salió (80.200); con el cobro primero, la venta se rechaza y la cuenta queda en 61.200', () => {
    limpiar();
    // La base: 2 Menú + 1 Seco = «Menú ×2» + «Seco · 3er almuerzo» (la línea «Seco» se absorbió). La tablet atrasada ve 1 Menú + 1 Seco y cobra «el Seco».
    cuenta('r1', 31, [MENU(1), SECO(1)]);
    assert.ok(comoMesero(`${delta('r1', lineaMenu, 1)}`).ok);                 // otra tablet suma un Menú
    assert.equal(ver('r1'), '2×Menú Resplandor@23000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 61200');
    // El orden VIEJO, a la vez y con la compensación: el −qty no hace nada, la venta se rechaza y el +qty de «devolver» suma un Seco de más.
    cuenta('r1v', 32, [MENU(1), SECO(1)]);
    assert.ok(comoMesero(`${delta('r1v', lineaMenu, 1)}`).ok);
    assert.ok(comoMesero(`${delta('r1v', lineaSeco, -1)}`).ok, 'el −1 sobre una línea que ya no existe no falla ni hace nada');
    assert.equal(comoMesero(venta('r1v', 32, 'r1v-c', [{ ...lineaSeco, qty: 1, nota: '' }])).ok, false, 'la venta se rechaza (RS005)');
    assert.ok(comoMesero(`${delta('r1v', lineaSeco, 1)}`).ok, 'la compensación del POS de antes');
    assert.equal(ver('r1v'), '2×Menú Resplandor@23000 + 1×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 80200', 'el defecto: 19.000 de más');
    // El orden NUEVO: el cobro primero; rechazado, el guion se detiene y no hay ningún delta.
    const v0 = una("select version, items, total from public.ordenes where id = 'r1'");
    const r = comoMesero(`${venta('r1', 31, 'r1-c', [{ ...lineaSeco, qty: 1, nota: '' }])}\n${delta('r1', lineaSeco, -1)}`);
    assert.equal(r.ok, false);
    assert.match(r.error, /tiene una promoción/);
    assert.deepEqual(una("select version, items, total from public.ordenes where id = 'r1'"), v0, 'la cuenta no cambió ni en la versión');
    assert.equal(ver('r1'), '2×Menú Resplandor@23000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 61200');
    assert.equal(ventas().filter((v) => v.id === 'r1-c').length, 0);
  });

  test('hallazgo 1 y 2 (la línea base existe; los deltas llegaron ANTES que la venta): 3 Seco → el −1 pliega la promo y la guardia ya no la ve, la venta entra: 57.000; con el cobro primero se rechaza y la cuenta sigue en 53.200', () => {
    limpiar();
    cuenta('r2v', 33, [SECO(3)]);
    assert.ok(comoMesero(`${delta('r2v', lineaSeco, -1)}`).ok);
    assert.equal(ver('r2v'), '2×Seco@19000 = 38000', 'dos Seco no son un trío: la promo se plegó');
    assert.ok(comoMesero(venta('r2v', 33, 'r2v-c', [{ ...lineaSeco, qty: 1, nota: '' }])).ok, 'con los deltas primero, la guardia no ve promo y deja pasar la venta');
    assert.equal(sumaVentas('r2v-c') + total('r2v'), 57000, 'el cliente paga 3.800 de más: el defecto');
    // POR QUÉ la guardia de la base no «recalcula antes de comparar» (se evaluó y se descartó; ver la bitácora): (1) la cuenta guardada ya está normalizada, así que
    // normalizarla otra vez da el mismo veredicto: sin promo; (2) juzgar «cuenta + lo que la venta se lleva» (para ver lo que había antes de los deltas) cuenta DOS VECES
    // las unidades cuando la venta llega primero —el orden del POS nuevo— y rechazaría un cobro legítimo. El orden lo fija el POS (el cobro entra primero), no la guardia.
    const hay = (items) => `select exists (select 1 from jsonb_array_elements(privado.normalizar_items(${literal(JSON.stringify(items))}::jsonb, 1::smallint)) e where e ->> 'id' like 'promo:%') as hay`;
    const guardada = una("select items from public.ordenes where id = 'r2v'").items;
    assert.equal(una(hay(guardada)).hay, false, 'recalcular la cuenta guardada no cambia el veredicto: la guardia seguiría sin ver promo');
    cuenta('r2n', 37, [SECO(2)]);
    const sinPromo = una("select items from public.ordenes where id = 'r2n'").items;
    assert.equal(una(hay([...sinPromo, { id: 'zc-seco', nombre: 'Seco', precio: 19000, qty: 1, nota: '' }])).hay, true, 'cuenta + venta daría promo aunque la cuenta de la base (con la venta primero) no la tenga');
    assert.ok(comoMesero(venta('r2n', 37, 'r2n-c', [{ ...lineaSeco, qty: 1, nota: '' }])).ok, 'y ese cobro es legítimo: con el cobro primero entra');
    cuenta('r2', 34, [SECO(3)]);
    const r = comoMesero(`${venta('r2', 34, 'r2-c', [{ ...lineaSeco, qty: 1, nota: '' }])}\n${delta('r2', lineaSeco, -1)}`);
    assert.equal(r.ok, false);
    assert.match(r.error, /tiene una promoción/);
    assert.equal(ver('r2'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200', 'con el cobro primero: intacta');
    assert.equal(ventas().filter((v) => v.id === 'r2-c').length, 0);
  });

  test('con el cobro primero, un cobro por partes SIN promoción sigue entrando y sus unidades salen detrás; lo cobrado + lo que queda es la mesa', () => {
    limpiar();
    cuenta('r3', 35, [SECO(2), { id: 'zc-jugo', nombre: 'Jugo natural', precio: 12000, qty: 1, nota: '' }]);
    const r = comoMesero(`${venta('r3', 35, 'r3-c', [{ ...lineaSeco, qty: 1, nota: '' }])}\n${delta('r3', lineaSeco, -1)}`);
    assert.ok(r.ok, r.error);
    assert.equal(sumaVentas('r3-c') + total('r3'), 2 * 19000 + 12000);
  });

  test('hallazgo 3 (la mesa completa): el upsert de cierre devuelve la fila como la base la REGISTRÓ (38.000), no la de la tablet (34.200); el cierre del día suma lo registrado y rechaza (cambio) lo que la tablet creía', () => {
    limpiar();
    cuenta('m1', 36, [SECO(3)]);
    assert.equal(ver('m1'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
    const v = una("select version from public.ordenes where id = 'm1'").version;
    // La tablet atrasada: «Seco ×1 + 3er almuerzo» = 34.200 (el mesero quitó un Seco de la línea base antes del eco) y cobra la mesa con el upsert del POS (`.select()` = RETURNING).
    const stale = [{ id: 'zc-seco', nombre: 'Seco', precio: 19000, qty: 1, nota: '' },
      { id: PROMO_SECO, nombre: 'Seco · 3er almuerzo · 20% OFF', precio: 15200, qty: 1, nota: '', promo: { id: 'zc-promo', de: 'zc-seco', nombre: 'Seco', precio: 19000, descuento: 20 } }];
    const r = comoMesero(`with cierre as (
        insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, version)
        values ('m1', 36, 'cerrada', ${literal(JSON.stringify(stale))}::jsonb, 34200, '2026-10-05 17:00:00+00', now(), ${v})
        on conflict (id) do update set mesa_id = excluded.mesa_id, estado = excluded.estado, items = excluded.items, total = excluded.total,
          abierta_en = excluded.abierta_en, cerrada_en = excluded.cerrada_en, version = excluded.version
        returning total, items)
      select total || ' | ' || (select string_agg((e ->> 'qty') || '×' || (e ->> 'nombre'), ' + ') from jsonb_array_elements(items) e) from cierre;`);
    assert.ok(r.ok, r.error);
    assert.equal(ultima(r), '38000 | 2×Seco', 'la fila que vuelve es la registrada (el mesero puede leerla: ordenes_ver), con las líneas recalculadas');
    assert.equal(Number(ventas().find((x) => x.id === 'm1').total), 38000, 'y es lo que quedó guardado');
    // El cierre del día: lo que la tablet creía (34.200) no es lo que la base tiene → `cambio`, con lo de la base; lo registrado (38.000) se cierra.
    const mal = comoAdmin("select public.cerrar_dia('cierre-m1-mal', '{\"n\":1,\"total\":34200,\"ids\":[\"m1\"]}'::jsonb) ->> 'codigo';");
    assert.ok(mal.ok, mal.error);
    assert.equal(ultima(mal), 'cambio');
    const bien = comoAdmin("select public.cerrar_dia('cierre-m1', '{\"n\":1,\"total\":38000,\"ids\":[\"m1\"]}'::jsonb) ->> 'ok';");
    assert.equal(ultima(bien), 'true');
    assert.equal(Number(una("select total_ventas from public.cierres where id = 'cierre-m1'").total_ventas), 38000, 'el cierre del día suma lo que la base registró');
  });

  test('el POS sabe, sin red, si la base le pondría una promoción: `cuentaTendriaPromo` (pos.html) coincide con privado.normalizar_items en 400 cuentas al azar (lunes, martes, miércoles; variantes; manuales, abonos, para llevar)', () => {
    limpiar();
    // La función del POS, tal como está escrita en pos.html (no usa nada de su cierre): se saca del texto y se evalúa aquí.
    const html = leer('pos.html');
    const ini = html.indexOf('    function cuentaTendriaPromo(');
    const fin = html.indexOf('\n    }\n', ini);
    assert.ok(ini > 0 && fin > ini, 'no encuentro cuentaTendriaPromo en pos.html');
    // eslint-disable-next-line no-new-func
    const cuentaTendriaPromo = new Function(`${html.slice(ini, fin + 6)}\nreturn cuentaTendriaPromo;`)();
    // El catálogo del POS (parseProducto) a partir de las MISMAS filas de la base.
    const filas = pg.filas('select id, categoria, nombre, precio, activo, dia_semana, promo_regla from public.productos order by id');
    const productos = filas.map((f) => ({ id: f.id, cat: f.categoria, nombre: f.nombre, precio: Number(f.precio), activo: f.activo, diaSemana: f.dia_semana, promoRegla: f.promo_regla }));
    // dos días de promo de la base (lunes 1: Seco y Menú, cada 3; miércoles 3: Margarita, 2 x 1) y uno sin (martes 2)
    const catalogo = [['zc-seco', 'Seco', 19000], ['zc-menu', 'Menú Resplandor', 23000], ['zc-sopa', 'Sopa', 7000], ['zc-jugo', 'Jugo natural', 12000], ['zc-marga', 'Margarita', 30000]];
    let semilla = 20261005;   // mulberry32: el mismo azar en cada corrida
    const azar = () => { semilla = (semilla + 0x6D2B79F5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const casos = [];
    for (let n = 0; n < 400; n += 1) {
      const dia = 1 + Math.floor(azar() * 3);
      const items = [];
      const lineas = 1 + Math.floor(azar() * 4);
      for (let k = 0; k < lineas; k += 1) {
        const [id, nombre, precio] = catalogo[Math.floor(azar() * catalogo.length)];
        const variante = azar() < 0.2 ? '__pollo' : '';
        items.push({ id: id + variante, nombre, precio, qty: 1 + Math.floor(azar() * 4), nota: '' });
      }
      if (azar() < 0.15) items.push({ id: 'manual_x', nombre: 'Algo', precio: 5000, qty: 3, nota: '' });
      if (azar() < 0.1) items.push({ id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' });
      if (azar() < 0.1) items.push({ id: 'abono_recibido_u1', nombre: 'Abono recibido', precio: -5000, qty: 1, nota: 'efectivo' });
      casos.push({ dia, items });
    }
    const salida = pg.filas(`select ord, (select bool_or((e ->> 'id') like 'promo:%') from jsonb_array_elements(privado.normalizar_items(c -> 'items', (c ->> 'dia')::smallint)) e) as hay
                              from jsonb_array_elements(${literal(JSON.stringify(casos))}::jsonb) with ordinality as q(c, ord) order by ord`);
    assert.equal(salida.length, casos.length);
    const distintos = [];
    let con = 0;
    salida.forEach((f, i) => {
      const esperado = !!f.hay;
      if (esperado) con += 1;
      const dia = casos[i].dia;
      const obtenido = cuentaTendriaPromo(casos[i].items, productos, dia);
      if (obtenido !== esperado) distintos.push(`día ${dia} ${JSON.stringify(casos[i].items)}: la base ${esperado}, el POS ${obtenido}`);
    });
    assert.deepEqual(distintos, [], `el POS y la base no coinciden:\n${distintos.slice(0, 5).join('\n')}`);
    assert.ok(con > 60 && con < 340, `el azar tiene que cubrir las dos respuestas (con promo: ${con} de ${casos.length})`);
  });

  test('pasos al azar (agregar, quitar, cobrar por partes, abonar, deshacer): el total es la suma de las líneas, los descuentos son los de un cálculo independiente, ninguna unidad se pierde ni se duplica, y ninguna venta por partes lleva promo', () => {
    let aceptados = 0; let rechazados = 0; let abonos = 0; let deshechos = 0;
    const fallas = [];
    for (let semilla = 1; semilla <= 60; semilla += 1) {
      const r = una(`select t.simular(${(semilla / 200).toFixed(3)}, 50, ${20 + (semilla % 18)}) as r`).r;
      if (r.falla) fallas.push(JSON.stringify(r)); else { aceptados += r.aceptados; rechazados += r.rechazados; abonos += r.abonos; deshechos += r.deshechos; }
    }
    assert.deepEqual(fallas, [], `una invariante se rompió:\n${fallas.join('\n')}`);
    assert.ok(aceptados > 100 && rechazados > 100 && abonos > 100 && deshechos > 100, `la simulación tiene que ejercitar todo: aceptados ${aceptados}, rechazados ${rechazados}, abonos ${abonos}, deshechos ${deshechos}`);
  });

  test('las funciones nuevas: la API no ejecuta la guardia ni normalizar_items; la guardia no abre nada (ningún GRANT nuevo)', () => {
    const quien = (fn) => ['anon', 'authenticated', 'public'].filter((rol) => pg.sql(`select has_function_privilege(${literal(rol)}, ${literal(fn)}, 'execute');`).salida === 't');
    assert.deepEqual(quien('public.ordenes_guardia_promo()'), []);
    assert.deepEqual(quien('privado.normalizar_items(jsonb,smallint)'), []);
    const r = pg.sql('\\set VERBOSITY verbose\nselect privado.normalizar_items(\'[]\'::jsonb, 1::smallint);', { como: 'authenticated', claims: CLAIMS.admin });
    assert.equal(r.ok, false);
    assert.match(r.error, /42501/);
    assert.deepEqual(radiografia(pg).relaciones, antes.relaciones, 'las relaciones (y sus permisos) no cambiaron');
  });

  test('aplicarla otra vez es inocua: el catálogo queda idéntico y sin WARNING', () => {
    const otra = radiografia(pg);
    const r = aplicarNueva();
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(radiografia(pg), otra);
  });

  test('la reversa de la cabecera quita la guardia (el cobro por partes de una cuenta con promo vuelve a entrar: el defecto) y pegar otra vez 20261005100000 devuelve normalizar_items de antes; volver a aplicar lo deja como estaba', () => {
    const con = radiografia(pg);
    const rev = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(rev.ok, rev.error);
    limpiar();
    cuenta('z1', 16, [SECO(3)]);
    assert.ok(comoMesero("select t.pagar('z1', 'zp', array['zc-seco'], array[1]);").ok, 'sin la guardia, el cobro por partes de una cuenta con promo vuelve a entrar');
    const vieja = pg.sql(SQL_PRECIO_VIVO, { como: 'migrador' });
    assert.ok(vieja.ok, vieja.error);
    const arreglo = pg.sql(SQL_ARREGLO, { como: 'migrador' });   // 20261005100000 vuelve a revocar el permiso de promo_regla_ok: el arreglo lo concede otra vez (el sobre las trae juntas)
    assert.ok(arreglo.ok, arreglo.error);
    const sin = radiografia(pg);
    const cuerpo = (r) => r.funciones.find((f) => f.proname === 'normalizar_items').cuerpo;
    assert.notEqual(cuerpo(sin), cuerpo(con), 'normalizar_items volvió a la de antes (sin el pliegue de la promo sin objeto)');
    assert.equal(sin.triggers.some((t) => t.tgname === 'trg_ordenes_guardia_promo'), false);
    const deNuevo = aplicarNueva();
    assert.ok(deNuevo.ok, deNuevo.error);
    // (volver a conceder un permiso cambia el ORDEN de la lista de permisos de una función, no su contenido: se comparan ordenadas)
    const ordenada = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'acl' && typeof v === 'string' ? v.slice(1, -1).split(',').sort().join(',') : v)));
    assert.deepEqual(ordenada(radiografia(pg)), ordenada(con), 'volver a aplicarla deja el catálogo idéntico al de antes de la reversa');
    limpiar();
    cuenta('z2', 17, [SECO(3)]);
    assert.equal(comoMesero("select t.pagar('z2', 'zp2', array['zc-seco'], array[1]);").ok, false, 'y la guardia vuelve a frenarlo');
  });
});

describe('se niega a correr, sin cambiar nada, si falta 20261005100000 (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: PRECIO_VIVO });
    assert.ok(previas.length >= 14 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('sin privado.normalizar_items aborta con el mensaje que dice qué migración falta, y no deja guardia ni trigger', () => {
    const antes = radiografia(pg);
    const r = pg.sql(SQL, { como: 'migrador' });
    assert.equal(r.ok, false);
    assert.match(r.error, /Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
    assert.deepEqual(radiografia(pg), antes);
  });
});
