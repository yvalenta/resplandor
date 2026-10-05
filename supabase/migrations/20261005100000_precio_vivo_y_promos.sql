-- ════════════════════════════════════════════════════════════
-- Resplandor — PRECIO VIVO en las cuentas abiertas y PROMOCIONES como regla (no como línea de $ 0)
-- (pedido de Yonatan, 2026-10-04, tareas/2026-10-04-hallazgos-domingo.md: «si un producto se actualiza de precio en productos las
-- cuentas en proceso deben tener ese precio… y el precio debe ser el mismo de la base de datos en la carta»; «si son 2 menú
-- resplandor = 46.000 + 1 menú resplandor con 20 % = 18.400… aunque se repita producto se debe especificar»)
--
-- QUÉ HACE
--   1. `productos.promo_regla` jsonb null: la regla de una promoción de descuento, en las filas de la categoría «Promociones»
--      (las de precio fijo, como «Picada + jarra», siguen sin regla: son un producto más). Forma, validada por
--      `privado.promo_regla_ok` (CHECK `productos_promo_regla_valida`):
--        { "cada": 3, "descuento": 20, "aplica": { "categorias": ["Ejecutivos"], "productos": ["ej1"] } }
--      = por cada N (`cada`, de 2 a 10) unidades elegibles en la cuenta, la más barata de cada grupo de N lleva X % de descuento
--      (`descuento`, de 1 a 100; 100 = gratis: el «2 x 1»). Es elegible toda unidad de un producto cuya categoría esté en
--      `aplica.categorias` o cuyo id esté en `aplica.productos` (al menos una lista con algo). La promo aplica su `dia_semana`
--      (1 = lunes … 7 = domingo; null = todos los días) y solo si está `activo`.
--   2. `privado.normalizar_items(items, dia)`: la función pura que deja los ítems de una cuenta como deben estar HOY:
--        a. pliega las líneas de promoción de una pasada anterior de vuelta en su línea base (son derivadas: se recalculan);
--        b. refresca el precio de cada línea de producto desde `productos` (id de línea = `<producto>` o `<producto>__<lo que sea>`);
--           NO toca las líneas manuales (`manual_…`), los abonos (`abono_…`, precio < 0) ni el marcador «para llevar»;
--        c. aplica las promociones del día: las unidades con descuento salen como LÍNEA PROPIA, positiva, junto a la normal:
--              { id: 'promo:<promo>:<línea base>', nombre: 'Seco · 3er almuerzo · 20% OFF', precio: 15200, qty: 1, nota: <la de la base>,
--                promo: { id, de: <línea base>, nombre: 'Seco', precio: 19000, descuento: 20 } }
--           así «2 × Seco 19.000 + 1 × Seco con 20 % = 15.200» se lee en el POS, la carta, el ticket y el cierre sin que ninguno
--           cambie (un precio negativo sería un abono para los tres). Las unidades se ordenan de mayor a menor precio y el descuento
--           cae en la N-ésima, 2N-ésima… de esa lista (la más barata de cada grupo): con 2 Menú (23.000) y 1 Seco (19.000) el
--           descuento va al Seco. Cada unidad entra en una sola promo (se procesan por nombre; una línea ya movida a una promo no
--           es elegible para la siguiente). Los $ se redondean a peso entero.
--   3. `trg_ordenes_a_precio_vivo` (BEFORE INSERT OR UPDATE en `ordenes`): normaliza los ítems de toda cuenta ABIERTA en cada
--      escritura (también la que la cierra: el cobro sube con lo de hoy) y, si cambiaron, recalcula `total`. Corre ANTES que
--      `trg_ordenes_guardia` (orden alfabético de los triggers BEFORE: «a_precio» < «guardia»), que es quien sube `version` cuando
--      los ítems cambian: el POS recibe el eco por Realtime con una versión mayor y lo adopta; la carta recibe la señal de
--      `ordenes_emite_cuenta`. El día de la cuenta es el de `abierta_en` en America/Bogota. Las cuentas cerradas no se tocan.
--      NUNCA rompe una escritura: si algo falla, deja los ítems como llegaron y un WARNING en los logs (como emitir_cuenta).
--   4. `productos_tocan_cuentas` (AFTER INSERT OR UPDATE en `productos`): cuando cambia un precio, `activo`, la categoría, el día o
--      la regla de un producto, «toca» (update de `updated_at`) todas las cuentas abiertas: el trigger de arriba las normaliza y el
--      cambio les llega solo a todas las tablets y a la carta. También exception-safe.
--   El POS no necesita calcular nada: muestra los ítems que la base le devuelve (aplicar_delta_orden devuelve la fila ya
--   normalizada) y, mientras llega el eco, la línea recién tocada a su precio de catálogo.
--
-- QUIÉN LO VE Y QUIÉN LO CAMBIA (no cambia ninguna policy)
--   `promo_regla` la lee y escribe quien ya puede leer y escribir `productos` (el personal con Google); `carta_publica` no la expone
--   (la carta muestra la etiqueta). Las funciones de `privado` solo las corren los triggers (SECURITY DEFINER, sin EXECUTE para
--   anon ni authenticated).
--
-- Necesita 20261003130000_carta_etiqueta_y_promos.sql (`productos.dia_semana`) y el esquema `privado` (20261001120000); si falta
-- algo se niega a correr SIN cambiar nada. Idempotente (add column if not exists, create or replace, drop trigger if exists).
-- Los datos (las reglas de las promos que ya existen) NO van aquí: docs/sobres/2026-10-05-reglas-de-promos.sql, que pega Yonatan
-- después de aplicar esto.
--
-- REVERSA (menos de 1 minuto; las líneas de promo que ya estén en cuentas abiertas se quedan como líneas positivas normales):
--   begin;
--   drop trigger if exists trg_ordenes_a_precio_vivo on public.ordenes;
--   drop trigger if exists productos_tocan_cuentas on public.productos;
--   drop function if exists privado.ordenes_precio_vivo();
--   drop function if exists privado.productos_tocan_cuentas();
--   drop function if exists privado.normalizar_items(jsonb, smallint);
--   drop function if exists privado.dia_bogota(timestamp with time zone);
--   alter table public.productos drop constraint if exists productos_promo_regla_valida;
--   alter table public.productos drop column if exists promo_regla;
--   drop function if exists privado.promo_regla_ok(jsonb);
--   commit;
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Orden de salida al aire: 1) esta migración, 2) push del POS,
-- 3) el sobre de datos con las reglas.
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regnamespace('privado') is null then
    raise exception 'Falta el esquema privado (20261001120000_cuenta_en_vivo.sql): aplicala primero. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos' and column_name = 'dia_semana') then
    raise exception 'Falta 20261003130000_carta_etiqueta_y_promos.sql (productos.dia_semana): aplicala primero. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ordenes' and column_name = 'version') then
    raise exception 'Falta 20261002180000_deshacer_cobro.sql (ordenes.version): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. La regla y su validador ──────────────────────────────

-- Pura, nunca falla: cualquier cosa que no tenga la forma de arriba da false (un CHECK no puede lanzar por un `::int` sobre texto).
create or replace function privado.promo_regla_ok(p_regla jsonb)
  returns boolean
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v_cada int;
  v_desc int;
  v_cats jsonb;
  v_prods jsonb;
begin
  if p_regla is null then return true; end if;
  if jsonb_typeof(p_regla) <> 'object' then return false; end if;
  if (p_regla ->> 'cada') !~ '^[0-9]{1,3}$' or (p_regla ->> 'descuento') !~ '^[0-9]{1,3}$' then return false; end if;
  v_cada := (p_regla ->> 'cada')::int;
  v_desc := (p_regla ->> 'descuento')::int;
  if v_cada < 2 or v_cada > 10 or v_desc < 1 or v_desc > 100 then return false; end if;
  if jsonb_typeof(p_regla -> 'aplica') <> 'object' then return false; end if;
  v_cats := coalesce(p_regla -> 'aplica' -> 'categorias', '[]'::jsonb);
  v_prods := coalesce(p_regla -> 'aplica' -> 'productos', '[]'::jsonb);
  if jsonb_typeof(v_cats) <> 'array' or jsonb_typeof(v_prods) <> 'array' then return false; end if;
  if jsonb_array_length(v_cats) + jsonb_array_length(v_prods) = 0 then return false; end if;
  if exists (select 1 from jsonb_array_elements(v_cats) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') = 0)
     or exists (select 1 from jsonb_array_elements(v_prods) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') = 0) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end $$;

revoke all on function privado.promo_regla_ok(jsonb) from public, anon, authenticated;

alter table public.productos add column if not exists promo_regla jsonb;

comment on column public.productos.promo_regla is
  'Regla de una promoción de descuento (solo filas de la categoría Promociones): { cada: N, descuento: %, aplica: { categorias: [...], productos: [...] } }. Null en todo lo demás. La aplica privado.normalizar_items en las cuentas abiertas.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_promo_regla_valida' and conrelid = 'public.productos'::regclass) then
    alter table public.productos
      add constraint productos_promo_regla_valida check (privado.promo_regla_ok(promo_regla));
  end if;
end $$;

-- ── 2. El día de una cuenta ─────────────────────────────────

-- isodow en Bogotá: 1 = lunes … 7 = domingo, el mismo que `productos.dia_semana` y que `diaHoy` de carta.html.
create or replace function privado.dia_bogota(p_cuando timestamp with time zone)
  returns smallint
  language sql
  immutable
  set search_path = ''
as $$ select extract(isodow from (p_cuando at time zone 'America/Bogota'))::smallint $$;

revoke all on function privado.dia_bogota(timestamp with time zone) from public, anon, authenticated;

-- ── 3. Normalizar los ítems de una cuenta ───────────────────

create or replace function privado.normalizar_items(p_items jsonb, p_dia smallint)
  returns jsonb
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  v_lineas jsonb[] := '{}';
  v_extras jsonb := '{}'::jsonb;        -- { "<índice de la base>": [líneas de promo] }
  v_item jsonb;
  v_de text;
  v_pid text;
  v_i int;
  v_n int;
  v_found boolean;
  v_precio numeric;
  v_promo record;
  v_cada int;
  v_desc int;
  v_cats text[];
  v_prods text[];
  v_idx int[];
  v_cant int[];
  v_base jsonb;
  v_nombre text;
  v_linea jsonb;
  v_salida jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return coalesce(p_items, '[]'::jsonb);
  end if;

  -- a. Las líneas que no son de promo, en su orden.
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    if (v_item ->> 'id') like 'promo:%' and jsonb_typeof(v_item -> 'promo') = 'object' then continue; end if;
    v_lineas := v_lineas || v_item;
  end loop;

  -- a'. Las líneas de promo de una pasada anterior vuelven a su base (la base recibe las unidades; si la base ya no está, se recrea).
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    if not ((v_item ->> 'id') like 'promo:%' and jsonb_typeof(v_item -> 'promo') = 'object') then continue; end if;
    v_de := v_item -> 'promo' ->> 'de';
    v_n := coalesce(nullif(v_item ->> 'qty', '')::int, 0);
    if v_de is null or v_n <= 0 then continue; end if;
    v_found := false;
    for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop
      if v_lineas[v_i] ->> 'id' = v_de then
        v_lineas[v_i] := jsonb_set(v_lineas[v_i], '{qty}', to_jsonb(coalesce(nullif(v_lineas[v_i] ->> 'qty', '')::int, 0) + v_n));
        v_found := true;
        exit;
      end if;
    end loop;
    if not v_found then
      v_lineas := v_lineas || jsonb_build_object(
        'id', v_de,
        'nombre', coalesce(v_item -> 'promo' ->> 'nombre', v_item ->> 'nombre'),
        'precio', coalesce(nullif(v_item -> 'promo' ->> 'precio', '')::numeric, nullif(v_item ->> 'precio', '')::numeric, 0),
        'qty', v_n,
        'nota', coalesce(v_item ->> 'nota', ''));
    end if;
  end loop;

  -- b. El precio de hoy, desde `productos`. Solo líneas de producto con precio ≥ 0: ni manuales, ni abonos, ni el marcador «para llevar».
  for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop
    v_item := v_lineas[v_i];
    v_pid := v_item ->> 'id';
    if v_pid is null or v_pid = 'para_llevar' or v_pid like 'manual\_%' or v_pid like 'abono\_%' then continue; end if;
    if coalesce(nullif(v_item ->> 'precio', '')::numeric, 0) < 0 then continue; end if;
    v_pid := split_part(v_pid, '__', 1);
    select p.precio into v_precio from public.productos p where p.id = v_pid and p.precio is not null and p.precio >= 0;
    if found and v_precio is distinct from nullif(v_item ->> 'precio', '')::numeric then
      v_lineas[v_i] := jsonb_set(v_item, '{precio}', to_jsonb(v_precio));
    end if;
  end loop;

  -- c. Las promociones del día, por nombre (y por id si dos se llaman igual).
  if p_dia is not null then
    for v_promo in
      select p.id, p.nombre, p.etiqueta, p.promo_regla as regla
        from public.productos p
       where p.activo and p.promo_regla is not null
         and (p.dia_semana is null or p.dia_semana = p_dia)
       order by p.nombre, p.id
    loop
      v_cada := (v_promo.regla ->> 'cada')::int;
      v_desc := (v_promo.regla ->> 'descuento')::int;
      v_cats := array(select jsonb_array_elements_text(coalesce(v_promo.regla -> 'aplica' -> 'categorias', '[]'::jsonb)));
      v_prods := array(select jsonb_array_elements_text(coalesce(v_promo.regla -> 'aplica' -> 'productos', '[]'::jsonb)));

      -- Las unidades elegibles, de mayor a menor precio (y en el orden de la cuenta a igual precio); la N-ésima, 2N-ésima… lleva el
      -- descuento. Se cuentan por línea base.
      with l as (
        select t.i, t.x from unnest(v_lineas) with ordinality as t(x, i)
      ), e as (
        select l.i,
               coalesce(nullif(l.x ->> 'precio', '')::numeric, 0) as precio,
               coalesce(nullif(l.x ->> 'qty', '')::int, 0) as qty,
               split_part(l.x ->> 'id', '__', 1) as pid
          from l
         where (l.x ->> 'id') is not null
           and (l.x ->> 'id') <> 'para_llevar'
           and (l.x ->> 'id') not like 'manual\_%'
           and (l.x ->> 'id') not like 'abono\_%'
           and (l.x ->> 'id') not like 'promo:%'
      ), q as (
        select e.i, e.precio, e.qty
          from e
          join public.productos pr on pr.id = e.pid
         where e.precio > 0 and e.qty > 0
           and pr.promo_regla is null
           and (pr.categoria = any (v_cats) or pr.id = any (v_prods))
      ), u as (
        select q.i, row_number() over (order by q.precio desc, q.i) as rn
          from q, generate_series(1, q.qty) as g
      ), d as (
        select u.i, count(*)::int as n from u where u.rn % v_cada = 0 group by u.i
      )
      select coalesce(array_agg(d.i order by d.i), '{}'), coalesce(array_agg(d.n order by d.i), '{}')
        into v_idx, v_cant
        from d;

      for v_i in 1 .. coalesce(array_length(v_idx, 1), 0) loop
        v_base := v_lineas[v_idx[v_i]];
        v_n := v_cant[v_i];
        v_precio := round(coalesce(nullif(v_base ->> 'precio', '')::numeric, 0) * (100 - v_desc) / 100.0);
        v_nombre := coalesce(v_base ->> 'nombre', '') || ' · ' || v_promo.nombre
                    || case when coalesce(v_promo.etiqueta, '') <> '' then ' · ' || v_promo.etiqueta else '' end;
        v_linea := jsonb_build_object(
          'id', 'promo:' || v_promo.id || ':' || (v_base ->> 'id'),
          'nombre', v_nombre,
          'precio', v_precio,
          'qty', v_n,
          'nota', coalesce(v_base ->> 'nota', ''),
          'promo', jsonb_build_object(
            'id', v_promo.id, 'de', v_base ->> 'id', 'nombre', v_base ->> 'nombre',
            'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0), 'descuento', v_desc));
        v_lineas[v_idx[v_i]] := jsonb_set(v_base, '{qty}', to_jsonb(coalesce(nullif(v_base ->> 'qty', '')::int, 0) - v_n));
        v_extras := jsonb_set(v_extras, array[v_idx[v_i]::text],
                              coalesce(v_extras -> (v_idx[v_i]::text), '[]'::jsonb) || jsonb_build_array(v_linea));
      end loop;
    end loop;
  end if;

  -- d. La salida: cada línea base (si le quedan unidades) seguida de sus líneas de promo.
  for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop
    if coalesce(nullif(v_lineas[v_i] ->> 'qty', '')::int, 0) > 0 then
      v_salida := v_salida || jsonb_build_array(v_lineas[v_i]);
    end if;
    if v_extras ? (v_i::text) then
      v_salida := v_salida || (v_extras -> (v_i::text));
    end if;
  end loop;
  return v_salida;
end $$;

revoke all on function privado.normalizar_items(jsonb, smallint) from public, anon, authenticated;

-- ── 4. El trigger de las cuentas ────────────────────────────

create or replace function privado.ordenes_precio_vivo()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_items jsonb;
begin
  begin                                              -- NUNCA romper la escritura del POS
    if new.estado = 'abierta' or (tg_op = 'UPDATE' and old.estado = 'abierta' and new.estado = 'cerrada') then
      v_items := privado.normalizar_items(new.items, privado.dia_bogota(coalesce(new.abierta_en, now())));
      new.items := v_items;
      -- El total de una cuenta abierta es SIEMPRE Σ precio × qty de sus ítems (lo mismo que calculan aplicar_delta_orden,
      -- deshacer_cobro y el POS al subirla): se recalcula aunque los ítems no hayan cambiado, así un total viejo que llegue
      -- con una fila (una tablet atrasada) nunca se queda por debajo ni por encima de lo que la cuenta tiene.
      new.total := (select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0)
                      from jsonb_array_elements(v_items) e);
    end if;
  exception when others then
    raise warning 'precio_vivo % %: % [%]', tg_table_name, tg_op, sqlerrm, sqlstate;
  end;
  return new;
end $$;

revoke all on function privado.ordenes_precio_vivo() from public, anon, authenticated;

drop trigger if exists trg_ordenes_a_precio_vivo on public.ordenes;
create trigger trg_ordenes_a_precio_vivo
  before insert or update on public.ordenes
  for each row execute function privado.ordenes_precio_vivo();

-- ── 5. El trigger de los productos ──────────────────────────

create or replace function privado.productos_tocan_cuentas()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  begin
    if tg_op = 'UPDATE'
       and new.precio is not distinct from old.precio
       and new.activo is not distinct from old.activo
       and new.categoria is not distinct from old.categoria
       and new.dia_semana is not distinct from old.dia_semana
       and new.promo_regla is not distinct from old.promo_regla then
      return null;
    end if;
    update public.ordenes set updated_at = now() where estado = 'abierta';
  exception when others then
    raise warning 'productos_tocan_cuentas % %: % [%]', tg_table_name, tg_op, sqlerrm, sqlstate;
  end;
  return null;
end $$;

revoke all on function privado.productos_tocan_cuentas() from public, anon, authenticated;

drop trigger if exists productos_tocan_cuentas on public.productos;
create trigger productos_tocan_cuentas
  after insert or update on public.productos
  for each row execute function privado.productos_tocan_cuentas();

-- ── 6. Comprobación ─────────────────────────────────────────

do $$
declare
  v jsonb;
begin
  -- El validador: una regla buena y tres malas.
  if not privado.promo_regla_ok('{"cada":3,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":1,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":"x","descuento":20,"aplica":{"categorias":["Ejecutivos"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"descuento":100,"aplica":{}}'::jsonb) then
    raise exception 'privado.promo_regla_ok no distingue una regla buena de una mala';
  end if;
  -- El día: el 2026-10-05 00:30 UTC es domingo 4 a las 19:30 en Bogotá.
  if privado.dia_bogota('2026-10-05 00:30:00+00'::timestamptz) <> 7 then
    raise exception 'privado.dia_bogota no da domingo para el 2026-10-04 19:30 de Bogotá';
  end if;
  -- Sin promos ni productos que coincidan, los ítems salen como entraron.
  v := privado.normalizar_items('[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb, 1::smallint);
  if v <> '[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb then
    raise exception 'privado.normalizar_items cambió una línea manual: %', v;
  end if;
  if (select tgname from pg_trigger where tgrelid = 'public.ordenes'::regclass and tgname in ('trg_ordenes_a_precio_vivo', 'trg_ordenes_guardia')
       order by tgname limit 1) is distinct from 'trg_ordenes_a_precio_vivo' then
    raise exception 'trg_ordenes_a_precio_vivo tiene que correr antes que trg_ordenes_guardia';
  end if;
end $$;
