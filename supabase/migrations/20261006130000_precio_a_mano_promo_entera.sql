-- ════════════════════════════════════════════════════════════
-- Resplandor — PRECIO A MANO, rondas 2 y 3: la línea que una PROMO se lleva ENTERA también tiene precio a mano y «Volver al precio de carta»; «la línea no existe» con su HTTP 404; y al deshacer un cobro la CUENTA MANDA
-- (corrección de la refutación de tareas/2026-10-05-precio-a-mano-y-botones.md sobre 20261006110000_precio_a_mano.sql: ronda 1, hallazgos 1 y 3; ronda 2, hallazgos medio y bajo)
--
-- QUÉ HACE
--   Cambia TRES funciones con `create or replace`, cada una con el MISMO cuerpo de la migración que la creó salvo lo que se dice aquí:
--   `public.fijar_precio_item(p_orden_id, p_item_id, p_precio)` y `privado.normalizar_items(items, dia)` (de 20261006110000_precio_a_mano.sql) y
--   `public.deshacer_cobro_sumar(p_base, p_extra)` (de 20261002180000_deshacer_cobro.sql).
--   1. UNA BASE QUE LA PROMO SE LLEVÓ ENTERA. Con «3er almuerzo» (cada 3, 20 %, Ejecutivos, lunes), tres ejecutivos distintos × 1 dejan al más
--      barato ENTERO en la línea `promo:<promo>:<base>`: la línea base desaparece de `ordenes.items`. Antes `fijar_precio_item(…, '<base>', …)`
--      respondía «la línea no existe» y con el id de la promo 22023: ese plato no tenía precio a mano ni «Volver al precio de carta». Y si un precio
--      a mano volvía a una línea la más barata, el descuento se mudaba a ella, su base desaparecía y la marca quedaba atrapada sin «Volver».
--      Ahora, si NO hay línea con ese id pero SÍ líneas de promo cuya base (`promo.de`) es ese id, la RPC escribe ahí lo que el paso a' de
--      `normalizar_items` despliega en una base:
--        · precio: `promo.precio` = el precio a mano, `promo.precio_manual = true`, `promo.precio_por` = el correo de quien llama, y el precio de
--          la línea de promo con el mismo descuento (el trigger del precio vivo lo recalcula igual al escribir);
--        · p_precio = null: se quitan `promo.precio_manual` y `promo.precio_por` (la base reaparece sin marca y el precio vivo la lleva a la carta).
--      Con la línea base presente (aunque solo le quede una parte de las unidades) todo sigue como en 20261006110000, salvo que «volver a la carta»
--      también quita la marca que recuerdan sus líneas de promo (ver 2: si no, el paso a' se la devolvería). Si no hay ni línea base ni línea de promo
--      de esa base, «la línea … no existe en la orden …» (ver 3). El marcador «para llevar», los abonos, los ítems manuales y las líneas de promo
--      (su id empieza por `promo:`) siguen rechazados con 22023: la línea de promo se cambia por su base.
--   2. `privado.normalizar_items`, paso a': cuando una línea de promo vuelve a su base y la base que encuentra NO tiene marca pero la línea de promo
--      SÍ la recuerda (`promo.precio_manual`), la base la adopta con su precio (`promo.precio`) y quién la puso. Es lo que pasa si, con el plato
--      absorbido por la promo a un precio a mano, alguien toca el plato en la carta: llega una línea nueva a precio de carta (sin marca) y antes el
--      precio a mano se perdía; ahora se conserva, como cuando se suma una unidad a una línea que está en la cuenta. Este bloque SIGUE SIENDO
--      NECESARIO tras el punto 4 (es el único camino por el que una base vuelve sin marca a una cuenta que recuerda una) y su único peligro era que
--      le llegara una marca VIEJA: eso lo cierra el punto 4 en el único sitio que las traía de vuelta (una venta cerrada). Todo lo demás de la función
--      (los pasos a, b, c y d) es idéntico.
--   3. «LA LÍNEA NO EXISTE» YA NO SE LEE COMO «LA ORDEN NO EXISTE», NI SALE COMO UN 500. Antes los dos eran P0001 y el POS, que lee «no existe» en el
--      mensaje, trataba el rechazo de una línea como el de una orden (la soltaba sin revertir el precio ni avisar). La primera versión de esta migración
--      la separó con SQLSTATE P0002, pero PostgREST traduce todo `P0xxx` salvo P0001 a HTTP 500 («PL/pgSQL Error»): el POS veía un error del servidor.
--      Los SQLSTATE `PT<nnn>` son los que PostgREST devuelve con el estado HTTP <nnn> («Raise errors with HTTP status codes»): ahora «la línea no existe»
--      sale con SQLSTATE `PT404` (HTTP 404; el `code` del cuerpo JSON es «PT404»). PostgREST usa el MESSAGE como texto de la línea de estado HTTP, así que el
--      message es fijo, corto y sin ids que escribió quien llama («linea inexistente en la orden»); la frase completa («la línea % no existe en la orden %»)
--      va en DETAIL (`details` del cuerpo). «orden % no existe» sigue P0001 (HTTP 400: el mensaje que `aplicar_delta_orden` ya da y el POS ya lee). Esta
--      migración no se había aplicado en ninguna parte cuando se cambió P0002 por PT404: no hay bases con el código viejo. El POS (pos.html,
--      `esLineaInexistente`) reconoce PT404 (y el texto de la RPC de 20261006110000, que la dice con P0001) y ante cualquiera de los dos rechazos revierte
--      el precio, avisa en una línea y relee la cuenta; `esOrdenInexistente` no toma un PT404 por «orden no existe».
--   4. AL DESHACER UN COBRO, LA CUENTA MANDA (`public.deshacer_cobro_sumar`; hallazgo medio de la refutación de la ronda 2: una REGRESIÓN del paso a' de
--      esa ronda). `deshacer_cobro` devuelve a la cuenta abierta las líneas de la venta que se deshace con `deshacer_cobro_sumar`, que agregaba las que la
--      cuenta no tenía TAL COMO SE VENDIERON, con el precio y la marca «a mano» de ese momento. Con el paso a' (punto 2) una línea de promo que vuelve con
--      su `promo.precio_manual` viejo le pegaba esa marca a una base que la cuenta tenía SIN marca: la cuenta pasaba a cobrar un precio que el mesero ya
--      había quitado («Volver al precio de carta» tras cobrar por partes la línea de promo, y luego «Deshacer» ese cobro), o que era de OTRO grupo de la
--      mesa (el cobro completo deshecho se fusiona con la cuenta nueva de la misma mesa), y quedaba firmado con el correo de quien lo puso antes.
--      LA REGLA, que queda anotada aquí y en el README: «la cuenta manda».
--        · Si la cuenta YA tiene ese plato (su línea base con ese id, o una línea de promo de esa base: cuando la promo se llevó el plato ENTERO, su precio
--          y su marca viven en `promo.precio` / `promo.precio_manual` / `promo.precio_por` de esa línea), las unidades devueltas se suman AL PRECIO Y A LA
--          MARCA QUE LA CUENTA TIENE HOY, y la línea devuelta pierde la suya: `precio_manual` y `precio_por` en una línea base; `promo.precio_manual` y
--          `promo.precio_por` en una línea de promo (su `promo.precio` se queda: es el precio base al que se desplegará, que el precio vivo refresca si la
--          cuenta no tiene marca). Una base que vuelve y la cuenta solo lleva en una línea de promo toma el `promo.precio` y la marca de esa línea (si hay
--          varias, la que tiene marca). Una línea con el mismo id que otra de la cuenta ya recibía las unidades sin tocar nada más (precio y marca de la
--          cuenta): eso no cambia.
--        · Si la cuenta NO tiene nada de ese plato, la línea vuelve tal como se vendió, con su marca (lo que ya hacía 20261006110000: el precio a mano de una
--          venta que se devuelve a una cuenta que no lo tenía sigue siendo a mano).
--      «La cuenta» es la que había ANTES de sumar (`p_base`): lo que ya se agregó de la misma venta no cuenta como cuenta. Lo demás (qué se suma, a quién,
--      en qué orden, las líneas sin unidades que se ignoran) es idéntico; `deshacer_cobro` no cambia. Sigue siendo `immutable`, `search_path` vacío y sin
--      EXECUTE para nadie de la API (solo la llama `deshacer_cobro`, SECURITY DEFINER).
--   Lo demás de la RPC no cambia: SECURITY INVOKER, `mi_rol()` admin o mesero (42501), orden bloqueada y ABIERTA (RS001), COP enteros de 0 a
--   10.000.000 (22023), `version` que sube, total recalculado.
--
-- LO QUE NO CAMBIA, A PROPÓSITO (decisión pendiente de Yonatan; refutación, hallazgo 2)
--   `precio_por` es la ATRIBUCIÓN que pone la RPC (`mi_correo()` de quien llama): la base la escribe, el POS no. Pero NO es un dato a prueba de
--   falsificación: `ordenes_editar` deja a un mesero hacer UPDATE de `ordenes.items` de una cuenta abierta por la API, y una escritura directa
--   puede traer `precio_manual` y un `precio_por` cualquiera, que el precio vivo respeta como respeta el de la RPC (sin el tope de 10.000.000 ni la
--   firma). Un guardia en `ordenes_guardia` que rechace una marca que la fila vieja no tenía NO CABE LIMPIO: la RPC es SECURITY INVOKER (la RLS de
--   `ordenes` también la alcanza), así que habría que marcar su camino con un `set_config` local a la transacción; y el POS escribe marcas por
--   escritura directa a propósito (la fila entera que sube una mesa abierta sin red, el cobro completo y por partes, que copian la línea con su marca,
--   y su propio `precio_por` local), de modo que un guardia que rechace, o que quite, `precio_manual`/`precio_por` rompería esos cobros, que mueven
--   dinero. Hoy un mesero ya puede escribir cualquier precio en un ítem manual (`manual_…`) o un abono, y esta marca no le da más poder sobre el
--   dinero que ese; lo que gana es una firma que podría falsear. Hasta que Yonatan decida (rechazar la marca directa, o aceptar que `precio_por` es
--   solo informativo), `precio_por` NO se usa para decidir nada (ni permisos, ni cierre, ni la carta pública, que no lo recibe).
--
-- QUIÉN LO VE Y QUIÉN LO CAMBIA
--   Igual que 20261006110000: la RPC la corre `authenticated` (no anon, no service_role) y adentro exige `mi_rol()` admin o mesero; el mesero solo
--   alcanza cuentas abiertas (la policy `ordenes_editar`). `privado.normalizar_items` sigue sin EXECUTE para anon ni authenticated (lo corre el
--   trigger del precio vivo) y `public.deshacer_cobro_sumar` sigue sin EXECUTE para nadie de la API (la llama `deshacer_cobro`, que sí lo tiene
--   `authenticated` y exige admin o mesero). No cambia ninguna policy, tabla, vista, trigger ni Realtime.
--
-- Necesita 20261006110000_precio_a_mano.sql (la RPC que reemplaza y el respeto por `precio_manual` de `privado.normalizar_items`) y
-- 20261002180000_deshacer_cobro.sql (`deshacer_cobro_sumar`, que ya está en producción); si falta alguna, se niega a correr SIN cambiar nada.
-- Idempotente (create or replace). Sin datos: ninguna cuenta existente cambia al aplicarla.
--
-- REVERSA (menos de 1 minuto; no hay nada que borrar: las tres funciones vuelven a las de antes). `deshacer_cobro_sumar` se devuelve a la de
-- 20261002180000 con este bloque (el mismo cuerpo; no hace falta volver a pegar esa migración entera, que es enorme):
--   begin;
--   create or replace function public.deshacer_cobro_sumar(p_base jsonb, p_extra jsonb)
--    returns jsonb
--    language plpgsql
--    immutable
--    set search_path = ''
--   as $function$
--   declare
--     v_items jsonb := p_base;
--     it jsonb;
--   begin
--     for it in select e from jsonb_array_elements(p_extra) e loop
--       if coalesce((it ->> 'qty')::int, 0) <= 0 then
--         continue;
--       end if;
--       if exists (select 1 from jsonb_array_elements(v_items) x where x ->> 'id' = it ->> 'id') then
--         v_items := (
--           select jsonb_agg(case when x.e ->> 'id' = it ->> 'id'
--                                 then jsonb_set(x.e, '{qty}', to_jsonb((x.e ->> 'qty')::int + (it ->> 'qty')::int))
--                                 else x.e end order by x.n)
--             from jsonb_array_elements(v_items) with ordinality as x(e, n)
--         );
--       else
--         v_items := v_items || jsonb_build_array(it);
--       end if;
--     end loop;
--     return v_items;
--   end;
--   $function$;
--   commit;
--   y, enseguida, volver a pegar 20261006110000_precio_a_mano.sql entero (es idempotente: su `create or replace` devuelve `public.fijar_precio_item`
--   y `privado.normalizar_items` a la versión de antes, sin la base dentro de la promo, sin la adopción de la marca y con «la línea no existe» como
--   P0001). Las líneas de promo que ya lleven `promo.precio_manual` siguen funcionando: el paso a' de 20261006110000 las despliega igual.
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Orden de salida al aire: 1) 20261006110000_precio_a_mano.sql, 2) esta migración,
-- 3) push del POS. Con el POS puesto y esta migración sin aplicar, el precio de un plato que está dentro de una promo (el POS ya lo ofrece) avisa
-- «La cuenta … cambió: el precio de … no se guardó» y lo deja como estaba (la RPC anterior responde «la línea no existe»).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regprocedure('public.fijar_precio_item(text, text, numeric)') is null then
    raise exception 'Falta 20261006110000_precio_a_mano.sql (public.fijar_precio_item): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('privado.normalizar_items(jsonb, smallint)') is null
     or position('precio_manual' in pg_get_functiondef('privado.normalizar_items(jsonb, smallint)'::regprocedure)) = 0 then
    raise exception 'Falta 20261006110000_precio_a_mano.sql (privado.normalizar_items que respeta precio_manual): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.deshacer_cobro_sumar(jsonb, jsonb)') is null then
    raise exception 'Falta 20261002180000_deshacer_cobro.sql (public.deshacer_cobro_sumar): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.mi_rol()') is null or to_regprocedure('public.mi_correo()') is null then
    raise exception 'Faltan public.mi_rol() y public.mi_correo() (20261002120000_personal_y_compuerta.sql): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. normalizar_items: la base que vuelve sin marca la adopta de su línea de promo ────

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

-- ── 2. deshacer_cobro_sumar: al devolver una venta, la cuenta manda ────
-- Suma los ítems de `p_extra` (las líneas de la venta que se deshace) a los de `p_base` (la cuenta abierta que las recibe). Lo de antes: la línea con el
-- mismo id recibe las unidades (el resto de sus campos no se toca); la que no está se agrega. Lo nuevo (la cuenta manda): si la cuenta YA tiene ese plato
-- (su línea base, o una línea de promo de esa base) y la línea que vuelve no es una con su mismo id, se agrega SIN su marca de precio a mano (y, una base
-- que solo existe dentro de la promo, con el precio y la marca de esa línea de promo). Si la cuenta no tiene nada de ese plato, se agrega tal cual, con su marca.
-- «La cuenta» es `p_base`: lo que ya se agregó de la misma venta no cuenta.

create or replace function public.deshacer_cobro_sumar(p_base jsonb, p_extra jsonb)
 returns jsonb
 language plpgsql
 immutable
 set search_path = ''
as $function$
declare
  v_items jsonb := p_base;
  it jsonb;
  v_es_promo boolean;    -- la línea que vuelve es una línea de promo (`promo:<promo>:<base>`)
  v_de text;             -- el plato de la línea que vuelve: su id, o su base (`promo.de`) si es una línea de promo
  v_cuenta_base boolean; -- la CUENTA tiene la línea base de ese plato
  v_cuenta_promo jsonb;  -- la línea de promo de la CUENTA sobre ese plato (la que lleva marca, si hay una): guarda su precio si la base no está
begin
  for it in select e from jsonb_array_elements(p_extra) e loop
    if coalesce((it ->> 'qty')::int, 0) <= 0 then
      continue;
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) x where x ->> 'id' = it ->> 'id') then
      v_items := (
        select jsonb_agg(case when x.e ->> 'id' = it ->> 'id'
                              then jsonb_set(x.e, '{qty}', to_jsonb((x.e ->> 'qty')::int + (it ->> 'qty')::int))
                              else x.e end order by x.n)
          from jsonb_array_elements(v_items) with ordinality as x(e, n)
      );
    else
      -- ¿La cuenta (no lo que ya se sumó de esta venta) tiene ese plato? Su línea base, o una línea de promo de esa base.
      v_es_promo := (it ->> 'id') like 'promo:%' and jsonb_typeof(it -> 'promo') = 'object';
      v_de := case when v_es_promo then it -> 'promo' ->> 'de' else it ->> 'id' end;
      v_cuenta_base := exists (select 1 from jsonb_array_elements(p_base) x where x ->> 'id' = v_de);
      select x.e into v_cuenta_promo
        from jsonb_array_elements(p_base) with ordinality as x(e, n)
       where (x.e ->> 'id') like 'promo:%' and jsonb_typeof(x.e -> 'promo') = 'object' and x.e -> 'promo' ->> 'de' = v_de
       order by coalesce(x.e -> 'promo' ->> 'precio_manual' = 'true', false) desc, x.n
       limit 1;
      if v_es_promo then
        -- Una línea de promo que vuelve a una cuenta que ya tiene ese plato: pierde la marca que traía de la venta. La cuenta decide si el plato está a mano
        -- (su base o su línea de promo la llevan). `promo.precio` se queda: el paso a' de normalizar_items la despliega con él y el precio vivo la refresca.
        if v_cuenta_base or v_cuenta_promo is not null then
          it := jsonb_set(it, '{promo}', ((it -> 'promo') - 'precio_manual') - 'precio_por');
        end if;
      elsif v_cuenta_promo is not null then
        -- Una línea base que vuelve a una cuenta donde la promo se llevó ese plato ENTERO: toma el precio y la marca (si la tiene) de esa línea de promo.
        it := (it - 'precio_manual') - 'precio_por';
        if nullif(v_cuenta_promo -> 'promo' ->> 'precio', '') is not null then
          it := it || jsonb_build_object('precio', (v_cuenta_promo -> 'promo' ->> 'precio')::numeric);
        end if;
        if v_cuenta_promo -> 'promo' ->> 'precio_manual' = 'true' then
          it := it || jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_cuenta_promo -> 'promo' ->> 'precio_por'));
        end if;
      end if;
      v_items := v_items || jsonb_build_array(it);
    end if;
  end loop;
  return v_items;
end;
$function$;

revoke all on function public.deshacer_cobro_sumar(jsonb, jsonb) from public, anon, authenticated, service_role;

-- ── 3. La RPC ───────────────────────────────────────────────

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
  v_enpromo boolean := false;   -- la línea base ya no está: la promo se la llevó ENTERA y su precio vive en la(s) línea(s) de promo
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
    -- Sin línea base: ¿la promo se la llevó entera? Sus líneas de promo la recuerdan en `promo.de`.
    v_enpromo := exists (select 1 from jsonb_array_elements(o.items) e
                          where (e ->> 'id') like 'promo:%' and jsonb_typeof(e -> 'promo') = 'object' and e -> 'promo' ->> 'de' = p_item_id);
    if not v_enpromo then
      -- SQLSTATE PT404: PostgREST lo devuelve como HTTP 404 (un P0xxx que no sea P0001 sale como 500). El POS distingue «la línea no existe» de «la orden no
      -- existe» (P0001) y revierte el precio. PostgREST usa el MESSAGE como texto del estado HTTP: fijo y sin ids de quien llama; la frase va en DETAIL.
      raise exception 'linea inexistente en la orden' using errcode = 'PT404',
        detail = format('la línea %s no existe en la orden %s', p_item_id, p_orden_id);
    end if;
  end if;
  -- Solo productos e ítems manuales: ni el marcador «para llevar», ni un abono (precio negativo), ni una línea de promoción (se recalcula
  -- desde su base: el precio se cambia en la línea de la base).
  if p_item_id = 'para_llevar' or p_item_id like 'abono\_%' or p_item_id like 'promo:%'
     or (v_enpromo and p_item_id like 'manual\_%')
     or (not v_enpromo and coalesce(nullif(it ->> 'precio', '')::numeric, 0) < 0) then
    raise exception 'el precio de la línea % no se puede cambiar a mano', p_item_id using errcode = '22023';
  end if;
  if p_precio is null and p_item_id like 'manual\_%' then
    raise exception 'la línea % es manual: no tiene precio de carta al que volver', p_item_id using errcode = '22023';
  end if;

  v_correo := (select public.mi_correo());

  select coalesce(jsonb_agg(x order by n), '[]'::jsonb) into nuevos
    from (
      select case
               -- la base está DENTRO de la promo: el precio y la marca se escriben en su(s) línea(s) de promo (`promo.precio`, `promo.precio_manual`,
               -- `promo.precio_por`), que `privado.normalizar_items` despliega en una línea base con ese precio y sobre el que la promo se recalcula
               -- (y «volver a la carta» con la base presente: la marca que recuerdan sus líneas de promo se va también; si no, el paso a' se la devolvería)
               when (e ->> 'id') like 'promo:%' and jsonb_typeof(e -> 'promo') = 'object' and e -> 'promo' ->> 'de' = p_item_id and (v_enpromo or p_precio is null) then
                 case
                   -- volver a la carta: se quita la marca y el trigger del precio vivo refresca la base desplegada
                   when p_precio is null then jsonb_set(e, '{promo}', ((e -> 'promo') - 'precio_manual') - 'precio_por')
                   else jsonb_set(
                          jsonb_set(e, '{promo}', (e -> 'promo') || jsonb_strip_nulls(jsonb_build_object('precio', p_precio, 'precio_manual', true, 'precio_por', v_correo))),
                          '{precio}', to_jsonb(round(p_precio * (100 - coalesce(nullif(e -> 'promo' ->> 'descuento', '')::numeric, 0)) / 100.0)))
                 end
               when v_enpromo then e
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
  'Pone a mano el precio de UNA línea de una cuenta abierta (todas sus unidades) y la marca precio_manual: privado.normalizar_items no la refresca desde productos. Si la promo se llevó la línea ENTERA (no hay línea base), lo escribe en su línea de promo (promo.precio, promo.precio_manual) y el precio vivo la despliega. p_precio null = volver al precio de carta. «La línea no existe» sale con SQLSTATE PT404 (HTTP 404); «orden no existe», P0001. Admin y mesero; SECURITY INVOKER (la RLS de ordenes también aplica).';

revoke all on function public.fijar_precio_item(text, text, numeric) from public, anon, service_role;
grant execute on function public.fijar_precio_item(text, text, numeric) to authenticated;

-- ── 4. Comprobación ─────────────────────────────────────────

do $$
begin
  if position('PT404' in pg_get_functiondef('public.fijar_precio_item(text, text, numeric)'::regprocedure)) = 0
     or position('P0002' in pg_get_functiondef('public.fijar_precio_item(text, text, numeric)'::regprocedure)) > 0
     or position('v_enpromo' in pg_get_functiondef('public.fijar_precio_item(text, text, numeric)'::regprocedure)) = 0 then
    raise exception 'public.fijar_precio_item no es la de la promo entera';
  end if;
  if has_function_privilege('anon', 'public.fijar_precio_item(text, text, numeric)', 'execute')
     or has_function_privilege('service_role', 'public.fijar_precio_item(text, text, numeric)', 'execute')
     or not has_function_privilege('authenticated', 'public.fijar_precio_item(text, text, numeric)', 'execute') then
    raise exception 'public.fijar_precio_item tiene que ser de authenticated y de nadie más';
  end if;
  if position('precio_manual' in pg_get_functiondef('privado.normalizar_items(jsonb, smallint)'::regprocedure)) = 0 then
    raise exception 'privado.normalizar_items no respeta precio_manual';
  end if;
  if has_function_privilege('anon', 'privado.normalizar_items(jsonb, smallint)', 'execute')
     or has_function_privilege('authenticated', 'privado.normalizar_items(jsonb, smallint)', 'execute') then
    raise exception 'privado.normalizar_items no puede tener EXECUTE para la API';
  end if;
  -- Una base que vuelve sin marca (domingo: sin promo ese día) la adopta de su línea de promo; con marca propia, la suya manda.
  if privado.normalizar_items('[{"id":"zz","nombre":"X","precio":100,"qty":1,"nota":""},{"id":"promo:pp:zz","nombre":"X · P","precio":622,"qty":1,"nota":"","promo":{"id":"pp","de":"zz","nombre":"X","precio":777,"descuento":20,"precio_manual":true,"precio_por":"a@b.test"}}]'::jsonb, 7::smallint)
     <> '[{"id":"zz","nombre":"X","precio":777,"qty":2,"nota":"","precio_manual":true,"precio_por":"a@b.test"}]'::jsonb then
    raise exception 'privado.normalizar_items no adopta la marca de la línea de promo';
  end if;
  if privado.normalizar_items('[{"id":"zz","nombre":"X","precio":100,"qty":1,"nota":"","precio_manual":true},{"id":"promo:pp:zz","nombre":"X · P","precio":622,"qty":1,"nota":"","promo":{"id":"pp","de":"zz","nombre":"X","precio":777,"descuento":20,"precio_manual":true,"precio_por":"a@b.test"}}]'::jsonb, 7::smallint)
     <> '[{"id":"zz","nombre":"X","precio":100,"qty":2,"nota":"","precio_manual":true}]'::jsonb then
    raise exception 'privado.normalizar_items pisó la marca de la base con la de la línea de promo';
  end if;
  -- La cuenta manda al devolver una venta: la línea de promo que vuelve a una cuenta con ese plato pierde su marca; a una cuenta sin él, la conserva.
  if public.deshacer_cobro_sumar('[{"id":"zz","nombre":"X","precio":100,"qty":1,"nota":""}]'::jsonb,
       '[{"id":"promo:pp:zz","nombre":"X · P","precio":622,"qty":1,"nota":"","promo":{"id":"pp","de":"zz","nombre":"X","precio":777,"descuento":20,"precio_manual":true,"precio_por":"a@b.test"}}]'::jsonb)
     <> '[{"id":"zz","nombre":"X","precio":100,"qty":1,"nota":""},{"id":"promo:pp:zz","nombre":"X · P","precio":622,"qty":1,"nota":"","promo":{"id":"pp","de":"zz","nombre":"X","precio":777,"descuento":20}}]'::jsonb then
    raise exception 'public.deshacer_cobro_sumar no le quitó la marca a la línea de promo que vuelve a una cuenta que ya tiene el plato';
  end if;
  if public.deshacer_cobro_sumar('[{"id":"yy","nombre":"Y","precio":50,"qty":1,"nota":""}]'::jsonb,
       '[{"id":"zz","nombre":"X","precio":777,"qty":1,"nota":"","precio_manual":true,"precio_por":"a@b.test"}]'::jsonb)
     <> '[{"id":"yy","nombre":"Y","precio":50,"qty":1,"nota":""},{"id":"zz","nombre":"X","precio":777,"qty":1,"nota":"","precio_manual":true,"precio_por":"a@b.test"}]'::jsonb then
    raise exception 'public.deshacer_cobro_sumar le quitó la marca a una línea que vuelve a una cuenta que no tiene el plato';
  end if;
  if has_function_privilege('anon', 'public.deshacer_cobro_sumar(jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.deshacer_cobro_sumar(jsonb, jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.deshacer_cobro_sumar(jsonb, jsonb)', 'execute') then
    raise exception 'public.deshacer_cobro_sumar no puede tener EXECUTE para la API';
  end if;
end $$;
