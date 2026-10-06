-- ════════════════════════════════════════════════════════════
-- Resplandor — PRECIO A MANO por línea del pedido: lo que el mesero escribe, el precio vivo no lo pisa
-- (pedido de Yonatan, 2026-10-05, tareas/2026-10-05-precio-a-mano-y-botones.md: «se debe poder editar el valor a mano de cada producto»)
--
-- QUÉ HACE
--   Desde 20261005100000_precio_vivo_y_promos.sql la base refresca el precio de TODA línea de producto desde `productos` en cada escritura
--   (`privado.normalizar_items`, paso b): un precio puesto a mano se perdía en la siguiente escritura. Esta migración le da a la línea una
--   marca, y a la base la RPC que la pone.
--   1. La línea de una cuenta puede llevar `precio_manual: true` (y `precio_por`: el correo de Google de quien lo puso, que escribe la base,
--      no el POS). Es un campo más del jsonb de `ordenes.items`: no hay columna nueva, ni cambia el contrato de la carta, el ticket ni el cierre
--      (todos leen `precio`, que es el que vale).
--   2. `privado.normalizar_items(items, dia)` (create or replace, el mismo cuerpo de 20261005100000 con tres cambios):
--        b. NO refresca el precio de una línea con `precio_manual` (sigue refrescando las demás);
--        c. las promociones SÍ cuentan la línea con su precio manual: «2 × Seco a 20.000 + 1 con 20 %» descuenta sobre 20.000;
--        a'/c. la línea de promoción recuerda la marca de su base (`promo.precio_manual`, `promo.precio_por`): si la base se va entera a la
--           promo (sus unidades quedan todas con descuento) y vuelve en la pasada siguiente, vuelve con su precio a mano.
--   3. `public.fijar_precio_item(p_orden_id, p_item_id, p_precio)`: pone el precio de UNA línea de una cuenta ABIERTA (todas sus unidades;
--      la línea es la unidad de la cuenta) y la marca como manual. Con `p_precio = null` la devuelve al precio de carta: le quita la marca y
--      el trigger del precio vivo la refresca desde `productos`. Los mismos guardias que `aplicar_delta_orden` (SECURITY INVOKER, así que la
--      RLS de `ordenes` también la alcanza): la orden se bloquea (`for update`), tiene que estar ABIERTA (RS001 si no; al mesero una cerrada
--      ni se la muestra la RLS: «no existe»), y `version` sube con el cambio (el POS adopta el eco de Realtime y el cierre de la cuenta manda la
--      que vio). Y los de los permisos por rol: solo sesiones de Google con fila en `personal` como `admin` o `mesero` (42501 si no; los dos
--      pueden, como crear y editar productos: decisión de Yonatan, 2026-09-30).
--      Qué rechaza (22023, sin cambiar nada): un precio negativo, con decimales o de más de 10.000.000 (COP enteros), y las líneas que no son
--      un producto o un ítem manual: el marcador «para llevar», los abonos y las líneas de promoción (esas se recalculan: se cambia el precio de
--      su línea base). Una línea manual (`manual_…`) ya no la refresca nadie: se le cambia el precio y listo, sin marca. 0 es un precio válido
--      (una cortesía).
--
-- QUIÉN LO VE Y QUIÉN LO CAMBIA
--   La RPC la corre `authenticated` (no anon, no service_role) y adentro exige `mi_rol()` admin o mesero; el mesero solo alcanza cuentas
--   abiertas (la policy `ordenes_editar`). No cambia ninguna policy, tabla ni vista, ni Realtime. `precio_manual` y `precio_por` viajan
--   con la cuenta como cualquier otro campo de la línea: los ve quien ve la cuenta (la carta pública no muestra campos que no conoce).
--
-- Necesita 20261005100000_precio_vivo_y_promos.sql (`privado.normalizar_items`, el trigger del precio vivo) y los permisos por rol
-- (`public.mi_rol()`, 20261002120000/20261002150000); si falta algo se niega a correr SIN cambiar nada. Idempotente (create or replace).
-- Sin datos: ninguna cuenta existente cambia al aplicarla.
--
-- REVERSA (menos de 1 minuto; las líneas que ya tengan `precio_manual` quedan con la marca, que ya nadie mira, y vuelven a refrescarse
-- desde `productos` en la próxima escritura de su cuenta):
--   begin;
--   drop function if exists public.fijar_precio_item(text, text, numeric);
--   commit;
--   y, enseguida, volver a pegar 20261005100000_precio_vivo_y_promos.sql entero (es idempotente: su `create or replace` devuelve
--   `privado.normalizar_items` a la versión de antes, sin el respeto por la marca).
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Orden de salida al aire: 1) esta migración, 2) push del POS. Con el POS
-- puesto y la migración sin aplicar, tocar un precio avisa «falta aplicar la base» y deja el precio como estaba.
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regprocedure('privado.normalizar_items(jsonb, smallint)') is null then
    raise exception 'Falta 20261005100000_precio_vivo_y_promos.sql (privado.normalizar_items): aplicala primero. No se cambió nada.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.ordenes'::regclass and tgname = 'trg_ordenes_a_precio_vivo') then
    raise exception 'Falta el trigger trg_ordenes_a_precio_vivo (20261005100000_precio_vivo_y_promos.sql): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.mi_rol()') is null or to_regprocedure('public.mi_correo()') is null then
    raise exception 'Faltan public.mi_rol() y public.mi_correo() (20261002120000_personal_y_compuerta.sql): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. normalizar_items respeta el precio a mano ────────────

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
      v_lineas := v_lineas || (jsonb_build_object(
        'id', v_de,
        'nombre', coalesce(v_item -> 'promo' ->> 'nombre', v_item ->> 'nombre'),
        'precio', coalesce(nullif(v_item -> 'promo' ->> 'precio', '')::numeric, nullif(v_item ->> 'precio', '')::numeric, 0),
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

-- ── 2. La RPC ───────────────────────────────────────────────

create or replace function public.fijar_precio_item(p_orden_id text, p_item_id text, p_precio numeric)
 returns public.ordenes
 language plpgsql
 set search_path = public
as $function$
declare
  o      ordenes;
  it     jsonb;
  nuevos jsonb;
  v_correo text;
begin
  -- Quién: una sesión de Google con fila activa y aprobada en `personal`, admin o mesero (la RLS de `ordenes` ya lo exige, pero así el
  -- rechazo es un 42501 claro y no un «orden no existe»).
  if (select public.mi_rol()) is null or (select public.mi_rol()) not in ('admin', 'mesero') then
    raise exception 'sin permiso para cambiar el precio de una línea' using errcode = '42501';
  end if;
  -- Qué: COP enteros, de 0 a 10.000.000 (o null = volver al precio de carta).
  if p_precio is not null and (p_precio < 0 or p_precio <> trunc(p_precio) or p_precio > 10000000) then
    raise exception 'precio inválido (%): pesos enteros, de 0 a 10.000.000', p_precio using errcode = '22023';
  end if;

  select * into o from ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'orden % no existe', p_orden_id;
  end if;
  if o.estado <> 'abierta' then
    raise exception 'orden % está cerrada', p_orden_id using errcode = 'RS001';
  end if;

  select e into it from jsonb_array_elements(o.items) e where e ->> 'id' = p_item_id limit 1;
  if it is null then
    raise exception 'la línea % no existe en la orden %', p_item_id, p_orden_id;
  end if;
  -- Solo productos e ítems manuales: ni el marcador «para llevar», ni un abono (precio negativo), ni una línea de promoción (se recalcula
  -- desde su base: el precio se cambia en la línea de la base).
  if p_item_id = 'para_llevar' or p_item_id like 'abono\_%' or p_item_id like 'promo:%'
     or coalesce(nullif(it ->> 'precio', '')::numeric, 0) < 0 then
    raise exception 'el precio de la línea % no se puede cambiar a mano', p_item_id using errcode = '22023';
  end if;
  if p_precio is null and p_item_id like 'manual\_%' then
    raise exception 'la línea % es manual: no tiene precio de carta al que volver', p_item_id using errcode = '22023';
  end if;

  v_correo := (select public.mi_correo());

  select coalesce(jsonb_agg(x order by n), '[]'::jsonb) into nuevos
    from (
      select case
               when e ->> 'id' <> p_item_id then e
               -- volver a la carta: se quita la marca y el trigger del precio vivo la refresca
               when p_precio is null then (e - 'precio_manual') - 'precio_por'
               -- una línea manual no se refresca nunca: solo cambia el precio (sin marca)
               when p_item_id like 'manual\_%' then jsonb_set(e, '{precio}', to_jsonb(p_precio))
               else jsonb_set(e, '{precio}', to_jsonb(p_precio))
                    || jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_correo))
             end as x, n
        from jsonb_array_elements(o.items) with ordinality as t(e, n)
    ) s;

  update ordenes
     set items = nuevos,
         total = (select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0)
                    from jsonb_array_elements(nuevos) e),
         version = coalesce(o.version, 0) + 1,
         updated_at = now()
   where id = p_orden_id
  returning * into o;

  return o;
end $function$;

comment on function public.fijar_precio_item(text, text, numeric) is
  'Pone a mano el precio de UNA línea de una cuenta abierta (todas sus unidades) y la marca precio_manual: privado.normalizar_items no la refresca desde productos. p_precio null = volver al precio de carta. Admin y mesero; SECURITY INVOKER (la RLS de ordenes también aplica).';

revoke all on function public.fijar_precio_item(text, text, numeric) from public, anon, service_role;
grant execute on function public.fijar_precio_item(text, text, numeric) to authenticated;

-- ── 3. Comprobación ─────────────────────────────────────────

do $$
begin
  if position('precio_manual' in pg_get_functiondef('privado.normalizar_items(jsonb, smallint)'::regprocedure)) = 0 then
    raise exception 'privado.normalizar_items no respeta precio_manual';
  end if;
  if has_function_privilege('anon', 'public.fijar_precio_item(text, text, numeric)', 'execute')
     or not has_function_privilege('authenticated', 'public.fijar_precio_item(text, text, numeric)', 'execute') then
    raise exception 'public.fijar_precio_item tiene que ser de authenticated y de nadie más';
  end if;
  -- Una línea con precio a mano sale intacta.
  if privado.normalizar_items('[{"id":"zz","nombre":"X","precio":777,"qty":1,"nota":"","precio_manual":true}]'::jsonb, 1::smallint)
     <> '[{"id":"zz","nombre":"X","precio":777,"qty":1,"nota":"","precio_manual":true}]'::jsonb then
    raise exception 'privado.normalizar_items cambió una línea con precio a mano';
  end if;
end $$;
