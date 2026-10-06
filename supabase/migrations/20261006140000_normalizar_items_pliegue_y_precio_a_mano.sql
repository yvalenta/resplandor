-- ════════════════════════════════════════════════════════════
-- Resplandor — NORMALIZAR_ITEMS: EL PLIEGUE DE LA PROMO SIN OBJETO (20261005130000) Y EL PRECIO A MANO (20261006110000 y 20261006130000), JUNTOS
-- (la mezcla de tarea/promo-regla-ejecutable con main, 2026-10-06)
--
-- POR QUÉ EXISTE
--   `privado.normalizar_items(items, dia)` la redefinen TRES migraciones, cada una escrita sobre la de 20261005100000 sin saber de las otras:
--     · 20261005130000 (el cobro por partes): también pliega una línea de promo que llega SIN su objeto `promo` (`promo:<promo>:<base>`), lo que deja un POS de
--       antes al devolver una línea de promo con aplicar_delta_orden;
--     · 20261006110000 y 20261006130000 (el precio a mano, de main): respeta `precio_manual` (el precio vivo no lo pisa, las promos lo cuentan con ese precio y la
--       línea de promo que se lleva el plato entero lo recuerda).
--   `create or replace` deja ganar a la ÚLTIMA que se pega: pegadas las de main después de 20261005130000 se perdía el pliegue, y pegada 20261005130000 después
--   de las de main se perdía el precio a mano (la siguiente escritura de una cuenta le devolvía a la línea el precio de la carta, en silencio). Esta migración
--   es la unión: el cuerpo de 20261006130000 (la última de main, byte a byte salvo lo de abajo) con los tres cambios del pliegue de 20261005130000.
--   Va ÚLTIMA de las que redefinen `normalizar_items` (20261006140000; la lápida de las cuentas borradas, 20261006150000, no la toca y va después) y el sobre final de hallazgos-domingo la lleva
--   detrás de las otras dos que la redefinen: en cualquier orden de pegado, quien la pega por último deja la función completa. Pegarla repetida no cambia nada.
--
-- QUÉ HACE
--   Un solo `create or replace function privado.normalizar_items(p_items jsonb, p_dia smallint)`: la misma firma, atributos (stable, search_path vacío) y
--   permisos (ni anon ni authenticated la ejecutan: la llaman los triggers y las funciones SECURITY DEFINER). Frente a 20261006130000 cambia SOLO:
--     a. en las dos pasadas sobre las líneas de promo, `v_de` (la base) sale del objeto `promo` o, si no lo trae, del id `promo:<promo>:<base>`;
--     b. una línea con id de promo y base conocida se trata como línea de promo (con o sin objeto);
--     c. si la base no está en la cuenta y hay que recrearla, el nombre y el precio caen en `productos` antes que en la línea de promo suelta
--        (la línea sin objeto no trae el nombre ni el precio de la base). Si la línea de promo trae `promo.precio` (precio a mano) manda ese.
--   Lo demás (las pasadas a', b, c y d, el respeto del precio a mano, la salida) es idéntico.
--
-- QUÉ NO HACE: no toca datos, ni tablas, ni policies, ni triggers, ni permisos. Necesita 20261005100000 (privado.normalizar_items); si falta, se niega a
-- correr SIN cambiar nada.
--
-- REVERSA: no tiene una propia. Volver a pegar 20261006130000_precio_a_mano_promo_entera.sql (la de main) devuelve la función a la de main, sin el pliegue; si
-- el precio a mano no está en la base, la de 20261005130000 o la de 20261005100000. La reversa del sobre final (reversa-final.sql) ya elige la correcta.
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('privado.normalizar_items(jsonb,smallint)') is null then
    raise exception 'Falta 20261005100000_precio_vivo_y_promos.sql (privado.normalizar_items): aplicala primero. No se cambió nada.';
  end if;
end $$;

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

  -- a. Las líneas que no son de promo, en su orden. Es de promo toda línea con id `promo:<promo>:<base>`: con el objeto `promo` (lo que escribe esta
  --    función) o sin él (lo que deja un POS que devuelve una línea de promo a la cuenta con aplicar_delta_orden, que no lleva ese objeto).
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_de := case when jsonb_typeof(v_item -> 'promo') = 'object' then v_item -> 'promo' ->> 'de'
                 else substring(coalesce(v_item ->> 'id', '') from '^promo:[^:]*:(.+)$') end;
    if (v_item ->> 'id') like 'promo:%' and (jsonb_typeof(v_item -> 'promo') = 'object' or v_de is not null) then continue; end if;
    v_lineas := v_lineas || v_item;
  end loop;

  -- a'. Las líneas de promo de una pasada anterior vuelven a su base (la base recibe las unidades; si la base ya no está, se recrea).
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_de := case when jsonb_typeof(v_item -> 'promo') = 'object' then v_item -> 'promo' ->> 'de'
                 else substring(coalesce(v_item ->> 'id', '') from '^promo:[^:]*:(.+)$') end;
    if not ((v_item ->> 'id') like 'promo:%' and (jsonb_typeof(v_item -> 'promo') = 'object' or v_de is not null)) then continue; end if;
    v_n := coalesce(nullif(v_item ->> 'qty', '')::int, 0);
    if v_de is null or v_n <= 0 then continue; end if;
    v_found := false;
    for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop
      if v_lineas[v_i] ->> 'id' = v_de then
        v_lineas[v_i] := jsonb_set(v_lineas[v_i], '{qty}', to_jsonb(coalesce(nullif(v_lineas[v_i] ->> 'qty', '')::int, 0) + v_n));
        -- La base volvió SIN marca (otra unidad del plato desde la carta mientras la promo se lo llevaba entero) y su línea de promo la recuerda a mano:
        -- el precio a mano sigue siendo el del plato, igual que cuando se suma una unidad a una línea que está en la cuenta.
        if v_lineas[v_i] ->> 'precio_manual' is distinct from 'true'
           and v_item -> 'promo' ->> 'precio_manual' = 'true' and nullif(v_item -> 'promo' ->> 'precio', '') is not null then
          v_lineas[v_i] := (v_lineas[v_i] || jsonb_build_object('precio', (v_item -> 'promo' ->> 'precio')::numeric))
                           || jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_item -> 'promo' ->> 'precio_por'));
        end if;
        v_found := true;
        exit;
      end if;
    end loop;
    if not v_found then
      v_lineas := v_lineas || (jsonb_build_object(
        'id', v_de,
        'nombre', coalesce(v_item -> 'promo' ->> 'nombre',
                           (select p.nombre from public.productos p where p.id = split_part(v_de, '__', 1)),
                           v_item ->> 'nombre'),
        'precio', coalesce(nullif(v_item -> 'promo' ->> 'precio', '')::numeric,
                           (select p.precio from public.productos p where p.id = split_part(v_de, '__', 1)),
                           nullif(v_item ->> 'precio', '')::numeric, 0),
        'qty', v_n,
        'nota', coalesce(v_item ->> 'nota', ''))
        || case when v_item -> 'promo' ->> 'precio_manual' = 'true'
                then jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_item -> 'promo' ->> 'precio_por'))
                else '{}'::jsonb end);
    end if;
  end loop;

  -- b. El precio de hoy, desde `productos`. Solo líneas de producto con precio ≥ 0: ni manuales, ni abonos, ni el marcador «para llevar».
  for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop
    v_item := v_lineas[v_i];
    v_pid := v_item ->> 'id';
    if v_pid is null or v_pid = 'para_llevar' or v_pid like 'manual\_%' or v_pid like 'abono\_%' then continue; end if;
    if coalesce(nullif(v_item ->> 'precio', '')::numeric, 0) < 0 then continue; end if;
    if v_item ->> 'precio_manual' = 'true' then continue; end if;       -- precio puesto a mano: el de la carta no lo pisa
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
            'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0), 'descuento', v_desc)
            || case when v_base ->> 'precio_manual' = 'true'
                    then jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_base ->> 'precio_por'))
                    else '{}'::jsonb end);
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

-- ── Comprobación (solo lecturas: no deja nada) ──────────────

do $$
declare
  v jsonb;
  v_id text;
  v_precio numeric;
begin
  -- el pliegue: una línea de promo SIN su objeto, y una CON él, vuelven a su base
  v := privado.normalizar_items('[{"id":"zz-x","nombre":"X","precio":1000,"qty":1,"nota":""},{"id":"promo:zz-p:zz-x","nombre":"X · promo","precio":800,"qty":2,"nota":""}]'::jsonb, 1::smallint);
  if v <> '[{"id":"zz-x","nombre":"X","precio":1000,"qty":3,"nota":""}]'::jsonb then
    raise exception 'privado.normalizar_items no pliega una línea de promo sin objeto: %', v;
  end if;
  v := privado.normalizar_items('[{"id":"zz-x","nombre":"X","precio":1000,"qty":1,"nota":""},{"id":"promo:zz-p:zz-x","nombre":"X · promo","precio":800,"qty":2,"nota":"","promo":{"id":"zz-p","de":"zz-x","nombre":"X","precio":1000,"descuento":20}}]'::jsonb, 1::smallint);
  if v <> '[{"id":"zz-x","nombre":"X","precio":1000,"qty":3,"nota":""}]'::jsonb then
    raise exception 'privado.normalizar_items dejó de plegar una línea de promo con objeto: %', v;
  end if;
  -- el precio a mano: la base que vuelve de una línea de promo con marca la conserva (precio y quién lo puso)
  v := privado.normalizar_items('[{"id":"zz-x","nombre":"X","precio":1000,"qty":1,"nota":""},{"id":"promo:zz-p:zz-x","nombre":"X · promo","precio":720,"qty":2,"nota":"","promo":{"id":"zz-p","de":"zz-x","nombre":"X","precio":900,"descuento":20,"precio_manual":true,"precio_por":"zz@zz"}}]'::jsonb, 1::smallint);
  if v <> '[{"id":"zz-x","nombre":"X","precio":900,"qty":3,"nota":"","precio_manual":true,"precio_por":"zz@zz"}]'::jsonb then
    raise exception 'privado.normalizar_items perdió el precio a mano de la línea de promo: %', v;
  end if;
  -- y una línea manual no se toca
  v := privado.normalizar_items('[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb, 1::smallint);
  if v <> '[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb then
    raise exception 'privado.normalizar_items cambió una línea manual: %', v;
  end if;
  -- con un producto de verdad: el precio de la carta refresca la línea, y NO la que lleva la marca de precio a mano
  select p.id, p.precio into v_id, v_precio from public.productos p where p.precio is not null and p.precio >= 0 and position('__' in p.id) = 0 order by p.id limit 1;
  if v_id is not null then
    v := privado.normalizar_items(jsonb_build_array(jsonb_build_object('id', v_id, 'nombre', 'X', 'precio', v_precio + 1, 'qty', 1, 'nota', '')), null);
    if (v -> 0 ->> 'precio')::numeric <> v_precio then
      raise exception 'privado.normalizar_items dejó de refrescar el precio de la carta: %', v;
    end if;
    v := privado.normalizar_items(jsonb_build_array(jsonb_build_object('id', v_id, 'nombre', 'X', 'precio', v_precio + 1, 'qty', 1, 'nota', '', 'precio_manual', true)), null);
    if (v -> 0 ->> 'precio')::numeric <> v_precio + 1 then
      raise exception 'privado.normalizar_items pisó un precio puesto a mano: %', v;
    end if;
  end if;
  if has_function_privilege('anon', 'privado.normalizar_items(jsonb,smallint)', 'execute') or has_function_privilege('authenticated', 'privado.normalizar_items(jsonb,smallint)', 'execute') then
    raise exception 'anon o authenticated pueden ejecutar privado.normalizar_items: no tenían que poder';
  end if;
end $$;
