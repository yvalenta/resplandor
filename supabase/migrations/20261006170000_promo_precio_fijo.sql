-- ════════════════════════════════════════════════════════════
-- Resplandor — PROMOCIONES DE PRECIO FIJO: «Combo hamburguesas: 2 Hamburguesa Resplandor por $ 50.000» se aplica SOLO en la cuenta, como ya lo hacen las de descuento
-- (pedido de Yonatan, 2026-10-06, tareas/2026-10-06-promo-precio-fijo.md: «si agrego 2 hamburguesas resplandor no hace el descuento cuando se adiciona y queda el precio
-- normal 60, del martes ni del día actual»: la mesa 1 tenía 2 × Hamburguesa Resplandor a 30.000 = 60.000 y el combo de 50.000 había que agregarlo aparte, a mano)
--
-- QUÉ HACE
--   Desde 20261005100000 la base aplica las promociones como REGLA (`productos.promo_regla`): `{ cada: N, descuento: %, aplica: { categorias, productos } }` y la
--   unidad más barata de cada grupo de N lleva el %. Las promos de PRECIO FIJO («2 por $ 50.000») no cabían: sin `descuento` la regla se rechazaba, así que seguían
--   siendo un producto más que el mesero agregaba a mano. Esta migración les da regla, con DOS `create or replace` y un comentario (ninguna tabla, dato, policy ni trigger):
--   1. `privado.promo_regla_ok(regla)` (la llama el CHECK `productos_promo_regla_valida`, que NO cambia): la forma nueva
--          { "cada": 2, "precio": 50000, "aplica": { "productos": ["<id>"] } }
--      es válida con `precio` ENTERO de 1 a 10.000.000 (el costo del GRUPO de N unidades), y la regla tiene que traer EXACTAMENTE UNO de `descuento` o `precio`
--      (`{cada, descuento, precio}` juntos se rechazan, y, de paso, una regla sin ninguno, que la versión de antes dejaba pasar por un NULL que nadie miró).
--      Todo lo demás es igual: `cada` de 2 a 10, `aplica` con al menos una categoría o producto, strings no vacíos, y nunca lanza (un CHECK no puede lanzar).
--   2. `privado.normalizar_items(items, dia)`: el cuerpo vigente (el de 20261006140000, la unión del pliegue y del precio a mano) MÁS el cálculo del precio fijo. Por cada
--      grupo completo de N unidades elegibles (las N de mayor precio juntas, luego las N siguientes… la misma lista ordenada que ya usa el descuento) la unidad MÁS BARATA
--      del grupo sale a la línea `promo:<promo>:<base>` con el precio
--          max(0, X − Σ precio de las otras N−1 unidades del grupo)        —y nunca más que su propio precio de lista—
--      y la línea de promo lleva `promo: { id, de, nombre, precio: <el de la base>, precio_fijo: X }` (sin `descuento`; con la marca `precio_manual`/`precio_por`
--      de su base, si la tiene, como hoy). Con la regla de la captura (2 Hamburguesa Resplandor a 30.000, X = 50.000):
--          2 unidades → 1 × 30.000 + promo 1 × 20.000 = 50.000;   3 → 80.000;   4 → dos grupos, 100.000.
--      El precio a mano entra en la suma como hoy (cada unidad cuenta con el precio de su línea). Dos bordes: si X es MENOR que la suma de las otras
--      N−1 unidades, la unidad de promo queda en 0 (no hay precios negativos; es una regla mal puesta, no un caso); y un grupo que ya costaba X o menos NO genera línea de
--      promo (un combo nunca sube una cuenta: con la hamburguesa a 20.000 las dos cuestan 40.000 y se quedan en 40.000, no en 50.000).
--      Una línea base que reparte unidades entre varios grupos de DISTINTO costo (una regla por categoría con precios mezclados y más de un grupo) recibe en su línea de
--      promo el PROMEDIO redondeado a peso de lo que costó cada unidad con promo: la diferencia, si hay, es de menos de N pesos y solo en ese caso; con una regla de un
--      solo producto (el combo) todas valen lo mismo y el cálculo es exacto.
--      El descuento sigue igual, byte a byte en su comportamiento: la misma lista ordenada, la misma N-ésima unidad, el mismo redondeo; las promos de descuento ni se enteran.
--      Idempotente en la segunda pasada: las líneas de promo se pliegan a su base (paso a') y se recalculan; la adopción del precio a mano del paso a' y todo lo del precio a
--      mano (el paso b no refresca una línea con `precio_manual`, la promo la cuenta con ese precio) quedan intactos.
--   3. El comentario de la columna `productos.promo_regla`, al día con las dos formas.
--   LO QUE NO CAMBIA, A PROPÓSITO: `public.fijar_precio_item` (20261006130000). Cuando el precio a mano se escribe en una línea de promo que se llevó su base ENTERA, esa RPC
--   le pone a la línea de promo un precio provisional (el del plato con el descuento que traiga; con precio fijo no trae, y queda el mismo plato), pero el UPDATE de `ordenes`
--   pasa por `trg_ordenes_a_precio_vivo`, que pliega la línea de promo a su base —con `promo.precio` y la marca— y la recalcula entera: el precio que importa lo pone
--   `normalizar_items`, que es el de arriba. Una prueba con precio fijo y la base absorbida lo comprueba. Tampoco toca el POS que ya está al aire: una línea con `precio_fijo`
--   le llega como cualquier línea de promo (id `promo:…`, objeto `promo`).
--
-- POR QUÉ ESTE NOMBRE Y ESTA BASE (y no la que se pensó al principio)
--   Se pensó como 20261006140000_promo_precio_fijo.sql sobre el cuerpo de 20261006130000, pero ese prefijo YA lo usa la unión
--   (20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql, que las pruebas exigen con prefijo único) y la versión VIGENTE de `normalizar_items` es la de esa unión, no la de
--   20261006130000: cortar de 130000 con un `create or replace` habría borrado en silencio el pliegue de la promo sin objeto (20261005130000), que es justo lo que la unión
--   existe para impedir. Por eso va como 20261006170000 (después de la lápida, 20261006150000, y de «servida», 20261006160000, que no tocan estas funciones) y parte del
--   cuerpo de la unión. Frente a 20261006140000 el cuerpo de `normalizar_items` cambia SOLO en el paso c:
--     · se declaran `v_fijo` y `v_pre` y se lee `precio` de la regla;
--     · la CTE `u` lleva también el precio de cada unidad, se agrega `gr` (cuánto suma cada grupo de N) y `d` cuenta además el precio de la unidad con promo (y, en una regla
--       de precio fijo, solo las unidades de un grupo que cuesta más que X);
--     · al armar la línea de promo: su precio (el descuento de siempre, o el del precio fijo) y su objeto `promo` (`descuento`, o `precio_fijo`).
--   Lo demás —pasos a, a', b y d, la firma, los atributos y los permisos— es idéntico.
--
-- QUIÉN LO VE Y QUIÉN LO CAMBIA
--   Igual que antes: `promo_regla` la lee y escribe quien ya puede leer y escribir `productos` (el personal con Google; la carta pública no la expone, muestra la etiqueta y el
--   precio del producto). `privado.promo_regla_ok` sigue siendo la ÚNICA función de `privado` que `authenticated` y `service_role` ejecutan (el CHECK corre con el rol de quien
--   escribe: 20261005120000); no se le quita ese permiso. `privado.normalizar_items` sigue SIN EXECUTE para anon ni authenticated (la llaman los triggers, SECURITY DEFINER).
--   No cambia ninguna policy, tabla, vista, trigger ni Realtime. Sin datos: ninguna cuenta ni producto cambia al aplicarla. Las reglas las pone el sobre
--   docs/sobres/2026-10-06-promo-precio-fijo.sql («Combo hamburguesas») o, después, el modal de producto del POS.
--
-- Necesita 20261005100000_precio_vivo_y_promos.sql (`privado.promo_regla_ok`, `privado.normalizar_items`), 20261006130000_precio_a_mano_promo_entera.sql (el precio a mano y
-- su ronda 2: `public.fijar_precio_item` con la base dentro de la promo) y 20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql (la unión: el pliegue y el precio a
-- mano juntos); si falta alguna, se niega a correr SIN cambiar nada. Idempotente (create or replace): pegarla repetida no cambia nada.
-- OJO con el orden: va ÚLTIMA de las que redefinen `normalizar_items` y `promo_regla_ok`. Si alguna vez se vuelve a pegar 20261005100000, 20261005130000, 20261006110000,
-- 20261006130000 o 20261006140000, esa función vuelve a la de antes (y una regla de precio fijo deja de cumplirse en las cuentas): hay que pegar ésta otra vez detrás.
--
-- REVERSA (menos de 1 minuto; las líneas de promo de precio fijo que ya estén en cuentas abiertas se pliegan solas a su base con la primera escritura). Primero la regla
-- del combo vuelve a null (si no, `normalizar_items` de antes la leería sin `descuento`) y se devuelve el validador a la forma de antes y su comentario; la reversa de
-- `normalizar_items` es volver a pegar la de antes (idempotente), enseguida:
--   begin;
--   update public.productos set promo_regla = null where promo_regla ? 'precio';
--   create or replace function privado.promo_regla_ok(p_regla jsonb)
--     returns boolean
--     language plpgsql
--     immutable
--     set search_path = ''
--   as $f$
--   declare
--     v_cada int;
--     v_desc int;
--     v_cats jsonb;
--     v_prods jsonb;
--   begin
--     if p_regla is null then return true; end if;
--     if jsonb_typeof(p_regla) <> 'object' then return false; end if;
--     if (p_regla ->> 'cada') !~ '^[0-9]{1,3}$' or (p_regla ->> 'descuento') !~ '^[0-9]{1,3}$' then return false; end if;
--     v_cada := (p_regla ->> 'cada')::int;
--     v_desc := (p_regla ->> 'descuento')::int;
--     if v_cada < 2 or v_cada > 10 or v_desc < 1 or v_desc > 100 then return false; end if;
--     if jsonb_typeof(p_regla -> 'aplica') <> 'object' then return false; end if;
--     v_cats := coalesce(p_regla -> 'aplica' -> 'categorias', '[]'::jsonb);
--     v_prods := coalesce(p_regla -> 'aplica' -> 'productos', '[]'::jsonb);
--     if jsonb_typeof(v_cats) <> 'array' or jsonb_typeof(v_prods) <> 'array' then return false; end if;
--     if jsonb_array_length(v_cats) + jsonb_array_length(v_prods) = 0 then return false; end if;
--     if exists (select 1 from jsonb_array_elements(v_cats) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') = 0)
--        or exists (select 1 from jsonb_array_elements(v_prods) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') = 0) then
--       return false;
--     end if;
--     return true;
--   exception when others then
--     return false;
--   end $f$;
--   revoke all on function privado.promo_regla_ok(jsonb) from public, anon;
--   grant execute on function privado.promo_regla_ok(jsonb) to authenticated, service_role;
--   comment on column public.productos.promo_regla is
--     'Regla de una promoción de descuento (solo filas de la categoría Promociones): { cada: N, descuento: %, aplica: { categorias: [...], productos: [...] } }. Null en todo lo demás. La aplica privado.normalizar_items en las cuentas abiertas.';
--   commit;
--   y, enseguida, volver a pegar 20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql ENTERA (la unión; su `create or replace` devuelve `normalizar_items` a la de antes,
--   con el pliegue y el precio a mano). Con eso la base queda como antes de ésta (las pruebas lo comparan: catálogo y cuerpo de las funciones).
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Orden de salida al aire: 1) esta migración, 2) push del POS (el modal y el anuncio de la regla nueva; con el POS
-- de antes la cuenta ya se calcula bien, solo que su banner y su chip de la promo no dicen «combo»), 3) el sobre de datos docs/sobres/2026-10-06-promo-precio-fijo.sql, que
-- pone la regla a «Combo hamburguesas» y, al hacerlo, `productos_tocan_cuentas` re-normaliza las cuentas abiertas.
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regprocedure('privado.promo_regla_ok(jsonb)') is null or to_regprocedure('privado.normalizar_items(jsonb, smallint)') is null then
    raise exception 'Falta 20261005100000_precio_vivo_y_promos.sql (privado.promo_regla_ok y privado.normalizar_items): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.fijar_precio_item(text, text, numeric)') is null
     or position('v_enpromo' in pg_get_functiondef('public.fijar_precio_item(text, text, numeric)'::regprocedure)) = 0 then
    raise exception 'Falta 20261006130000_precio_a_mano_promo_entera.sql (public.fijar_precio_item con la base dentro de la promo): aplicala primero. No se cambió nada.';
  end if;
  if position('precio_manual' in pg_get_functiondef('privado.normalizar_items(jsonb, smallint)'::regprocedure)) = 0
     or position('^promo:[^:]*:(.+)' in pg_get_functiondef('privado.normalizar_items(jsonb, smallint)'::regprocedure)) = 0 then
    raise exception 'Falta 20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql (la unión de privado.normalizar_items: el pliegue de la promo sin objeto y el precio a mano): aplicala primero, o esta migración borraría una de las dos. No se cambió nada.';
  end if;
end $$;

-- ── 1. El validador de la regla ─────────────────────────────

-- Pura, nunca falla: cualquier cosa que no tenga la forma de arriba da false (un CHECK no puede lanzar por un `::int` sobre texto). La regla trae EXACTAMENTE UNO de
-- `descuento` (1 a 100: % que lleva la unidad más barata de cada grupo) o `precio` (1 a 10.000.000: lo que cuesta el grupo de `cada` unidades).
create or replace function privado.promo_regla_ok(p_regla jsonb)
  returns boolean
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v_cada int;
  v_desc int;
  v_precio bigint;
  v_cats jsonb;
  v_prods jsonb;
begin
  if p_regla is null then return true; end if;
  if jsonb_typeof(p_regla) <> 'object' then return false; end if;
  if not coalesce((p_regla ->> 'cada') ~ '^[0-9]{1,3}$', false) then return false; end if;
  v_cada := (p_regla ->> 'cada')::int;
  if v_cada < 2 or v_cada > 10 then return false; end if;
  -- exactamente uno de los dos: el % de descuento o el precio fijo del grupo (la clave presente con null cuenta como presente, y no vale)
  if (p_regla ? 'descuento') = (p_regla ? 'precio') then return false; end if;
  if p_regla ? 'descuento' then
    if not coalesce((p_regla ->> 'descuento') ~ '^[0-9]{1,3}$', false) then return false; end if;
    v_desc := (p_regla ->> 'descuento')::int;
    if v_desc < 1 or v_desc > 100 then return false; end if;
  else
    if not coalesce((p_regla ->> 'precio') ~ '^[0-9]{1,8}$', false) then return false; end if;
    v_precio := (p_regla ->> 'precio')::bigint;
    if v_precio < 1 or v_precio > 10000000 then return false; end if;
  end if;
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

-- `create or replace` conserva los permisos que ya tenía; se reafirman igual: el CHECK corre con el rol de quien escribe (20261005120000), así que `authenticated` y
-- `service_role` tienen que poder ejecutarla; anon y public no.
revoke all on function privado.promo_regla_ok(jsonb) from public, anon;
grant execute on function privado.promo_regla_ok(jsonb) to authenticated, service_role;

comment on column public.productos.promo_regla is
  'Regla de una promoción automática (solo filas de la categoría Promociones), de dos formas: { cada: N, descuento: %, aplica: { categorias: [...], productos: [...] } } (la unidad más barata de cada grupo de N lleva el %) o { cada: N, precio: $, aplica: {...} } (el grupo de N unidades cuesta $: «2 por $ 50.000»; exactamente uno de descuento o precio). Null en todo lo demás. La aplica privado.normalizar_items en las cuentas abiertas.';

-- ── 2. normalizar_items: lo de siempre, más el precio fijo del grupo ────

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
  v_fijo numeric;                       -- precio fijo del GRUPO de N unidades (null en una regla de descuento)
  v_cats text[];
  v_prods text[];
  v_idx int[];
  v_cant int[];
  v_pre numeric[];                      -- precio de cada unidad con promo, por línea base (solo con precio fijo)
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
      v_desc := (v_promo.regla ->> 'descuento')::int;     -- null en una regla de precio fijo
      v_fijo := (v_promo.regla ->> 'precio')::numeric;    -- null en una regla de descuento
      v_cats := array(select jsonb_array_elements_text(coalesce(v_promo.regla -> 'aplica' -> 'categorias', '[]'::jsonb)));
      v_prods := array(select jsonb_array_elements_text(coalesce(v_promo.regla -> 'aplica' -> 'productos', '[]'::jsonb)));

      -- Las unidades elegibles, de mayor a menor precio (y en el orden de la cuenta a igual precio); la N-ésima, 2N-ésima… (la más barata de cada grupo
      -- de N) lleva el descuento. Se cuentan por línea base. Con una regla de PRECIO FIJO (`v_fijo`) el grupo cuesta `v_fijo`: esa unidad queda en
      -- max(0, v_fijo − Σ de las otras N−1 unidades del grupo), nunca más que su precio de lista, y solo si el grupo costaba más que `v_fijo`; si una
      -- línea reparte unidades entre grupos de distinto costo, el precio de su línea de promo es el promedio redondeado (`d.precio_unidad`).
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
        select q.i, q.precio, row_number() over (order by q.precio desc, q.i) as rn
          from q, generate_series(1, q.qty) as g
      ), gr as (
        select u.i, u.precio, u.rn, sum(u.precio) over (partition by (u.rn - 1) / v_cada) as total
          from u
      ), d as (
        select gr.i, count(*)::int as n,
               round(avg(gr.precio - least(gr.precio, greatest(0, gr.total - v_fijo))))::numeric as precio_unidad
          from gr
         where gr.rn % v_cada = 0 and (v_fijo is null or gr.total > v_fijo)
         group by gr.i
      )
      select coalesce(array_agg(d.i order by d.i), '{}'), coalesce(array_agg(d.n order by d.i), '{}'), coalesce(array_agg(d.precio_unidad order by d.i), '{}')
        into v_idx, v_cant, v_pre
        from d;

      for v_i in 1 .. coalesce(array_length(v_idx, 1), 0) loop
        v_base := v_lineas[v_idx[v_i]];
        v_n := v_cant[v_i];
        v_precio := case when v_fijo is null
                         then round(coalesce(nullif(v_base ->> 'precio', '')::numeric, 0) * (100 - v_desc) / 100.0)
                         else v_pre[v_i] end;
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
            'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0))
            || case when v_fijo is null then jsonb_build_object('descuento', v_desc) else jsonb_build_object('precio_fijo', v_fijo) end
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

-- ── 3. Comprobación (solo lecturas: no deja nada) ──────────────

do $$
declare
  v text := pg_get_functiondef('privado.normalizar_items(jsonb, smallint)'::regprocedure);
begin
  -- el validador: las dos formas buenas…
  if not privado.promo_regla_ok('{"cada":3,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}'::jsonb)
     or not privado.promo_regla_ok('{"cada":2,"descuento":100,"aplica":{"productos":["zz"]}}'::jsonb)
     or not privado.promo_regla_ok('{"cada":2,"precio":50000,"aplica":{"productos":["zz"]}}'::jsonb)
     or not privado.promo_regla_ok('{"cada":10,"precio":1,"aplica":{"categorias":["a"],"productos":["b"]}}'::jsonb)
     or not privado.promo_regla_ok('{"cada":2,"precio":10000000,"aplica":{"categorias":["a"]}}'::jsonb)
     or not privado.promo_regla_ok(null) then
    raise exception 'privado.promo_regla_ok rechaza una regla buena';
  end if;
  -- …y las malas: lo de antes, y lo nuevo (los dos a la vez, ninguno, precio 0 o pasado de tope, o que no es un entero)
  if privado.promo_regla_ok('{"cada":1,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":"x","descuento":20,"aplica":{"categorias":["Ejecutivos"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"descuento":100,"aplica":{}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"descuento":0,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"descuento":101,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"descuento":20,"precio":50000,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"precio":0,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"precio":10000001,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"precio":-5,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"precio":1.5,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"precio":"mucho","aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"precio":null,"aplica":{"productos":["zz"]}}'::jsonb)
     or privado.promo_regla_ok('{"cada":2,"precio":50000,"aplica":{"productos":[]}}'::jsonb) then
    raise exception 'privado.promo_regla_ok deja pasar una regla mala';
  end if;
  -- el cuerpo de normalizar_items sigue teniendo el pliegue, el precio a mano y ahora el precio fijo
  if position('precio_fijo' in v) = 0 or position('precio_manual' in v) = 0 or position('^promo:[^:]*:(.+)' in v) = 0 then
    raise exception 'privado.normalizar_items no es la de la unión con el precio fijo';
  end if;
  -- una línea manual no se toca
  if privado.normalizar_items('[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb, 1::smallint)
     <> '[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb then
    raise exception 'privado.normalizar_items cambió una línea manual';
  end if;
  -- los permisos de las dos funciones: ni anon ni (para normalizar) authenticated; authenticated y service_role sí ejecutan el validador
  if has_function_privilege('anon', 'privado.normalizar_items(jsonb,smallint)', 'execute') or has_function_privilege('authenticated', 'privado.normalizar_items(jsonb,smallint)', 'execute') then
    raise exception 'anon o authenticated pueden ejecutar privado.normalizar_items: no tenían que poder';
  end if;
  if has_function_privilege('anon', 'privado.promo_regla_ok(jsonb)', 'execute') or has_function_privilege('public', 'privado.promo_regla_ok(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'privado.promo_regla_ok(jsonb)', 'execute') or not has_function_privilege('service_role', 'privado.promo_regla_ok(jsonb)', 'execute') then
    raise exception 'los permisos de privado.promo_regla_ok no son los de 20261005120000';
  end if;
end $$;
