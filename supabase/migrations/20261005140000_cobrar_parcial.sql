-- ════════════════════════════════════════════════════════════
-- Resplandor — COBRAR POR PARTES y ABONAR, atómicos en la base: `cobrar_parcial` y `cobrar_abono`
-- (tercera refutación del 2026-10-05 a «cobrar por partes con promoción»; tareas/2026-10-04-hallazgos-domingo.md. Cierra la CLASE de fallos, no los casos.)
--
-- POR QUÉ
--   El POS cobraba por partes en dos pasos: UPSERT de una orden CERRADA con `parcial_de` y, detrás, un delta −qty por línea (`aplicar_delta_orden`) por la cola
--   de reintentos. Eso no converge: el orden de llegada decide el dinero (los deltas que ya esperaban en la cola, los que se mandan después y adelantan, la venta que llega
--   antes o después de ellos), y la base recalcula las promos tras CADA escritura. Con la red de verdad (supabase-js no lanza sin red: devuelve {error}) se midieron
--   57.000 y 54.000 donde la mesa debía pagar 53.200 y 50.400, y una venta válida rechazada. Parchar el orden de la cola caso por caso no acaba nunca.
--
-- QUÉ HACE: el cobro es UNA llamada, UNA transacción, bajo candado de la cuenta
--   · `public.cobrar_parcial(p_orden_id text, p_version integer, p_venta jsonb, p_lineas jsonb, p_delta_id text) → jsonb`
--       p_orden_id  la cuenta ABIERTA de la que sale el cobro
--       p_version   la `version` que la tablet vio de esa cuenta
--       p_venta     {"id": "<id de la venta cerrada>"} (el id lo pone el POS, que lo guarda como `ordenes.id`)
--       p_lineas    [{"id": "<línea de la cuenta>", "qty": <unidades>}, …]  lo que se cobra: líneas completas o unidades de una línea
--       p_delta_id  el id de ESTE cobro (idempotencia; el mismo en cada reintento)
--     Bajo `select … for update` de la cuenta, en este orden:
--       (e) IDEMPOTENTE: si `p_delta_id` ya está en `deltas_aplicados` (el mismo registro que usa `aplicar_delta_orden`), no se aplica nada y se devuelve lo mismo que la
--           primera vez (la venta y la cuenta tal como está ahora), con `repetido: true`. Si esa venta ya no existe (se deshizo o se archivó), RS003: la tablet se relee.
--       (a) `version` ≠ `p_version` → RS003 («la cuenta … cambió desde que se vio»): la tablet está atrasada, se relee y se vuelve a cobrar. Es lo que pasa con el segundo de
--           dos cobros simultáneos sobre la misma cuenta.
--       (b) la cuenta tiene una línea de promoción (`promo:…`), o la tendría al normalizarla con las reglas de hoy → RS005 («tiene una promoción … no se puede cobrar por partes ni por
--           persona»), el MISMO código y mensaje que la guardia de 20261005130000. Una cuenta con promoción no se parte: se cobra completa o con abonos.
--       (c) cada línea pedida existe en la cuenta con esa cantidad (entera, ≥ 1, sin repetir; no se cobra el marcador «para llevar» ni un abono recibido) y lo que quedaría no es
--           negativo; si no → RS006.
--       (d) inserta la venta CERRADA (mismo formato de siempre: `parcial_de`, las líneas con SUS unidades y el precio de HOY de la cuenta, el marcador «para llevar» con cantidad 1
--           si la cuenta lo tiene, `total` = Σ precio × qty calculado aquí, `cerrada_en` = la hora del servidor), saca esas unidades de la cuenta, sube `version` y deja que el
--           trigger de precio vivo normalice lo que queda. Devuelve {ok, repetido, venta, cuenta}: las dos filas, como las dejó la base.
--   · `public.cobrar_abono(p_orden_id text, p_version integer, p_venta jsonb, p_monto numeric, p_metodo text, p_delta_id text) → jsonb`
--       p_venta {"id": "<id de la venta>", "uid": "<uid del abono, solo a-z y 0-9>"}; p_monto en pesos enteros (0 < monto < lo que falta: igual al total es el cobro normal);
--       p_metodo `efectivo` | `qr` | `transferencia`. Lo mismo, para el abono: la venta cerrada «Abono» (una línea `abono_<uid>` por el monto, `parcial_de` = la cuenta) y la línea
--       `abono_recibido_<uid>` (precio −monto) en la cuenta, juntas, con versión (RS003) e idempotencia por `p_delta_id`. Un abono SÍ entra en una cuenta con promoción: no
--       saca unidades, solo baja lo que se debe (por eso es la salida de esas cuentas, junto con la mesa completa).
--   · `privado.items_de_hoy(items, abierta_en)`: los ítems de una cuenta normalizados con el precio y las promos de hoy (la función pura `normalizar_items` + el día de Bogotá de
--       `abierta_en`). SECURITY DEFINER, solo para que las dos RPC (que corren como quien llama) puedan preguntarlo; `privado` no lo expone PostgREST (mismo patrón que
--       `privado.orden_archivada`).
--
-- PERMISOS (los de `aplicar_delta_orden`): SECURITY INVOKER, execute solo para authenticated y service_role (ni public ni anon). Todo corre con la RLS de quien llama: la compuerta
--   `solo_personal` y `mi_rol()` mandan (quien no es del personal no ve la cuenta: «orden … no existe»; el mesero no ve una cuenta cerrada: lo mismo), y las guardias de `ordenes`
--   (`ordenes_guardia`: una cuenta archivada en un cierre no se parte, RS005; `ordenes_guardia_promo`) siguen juzgando el INSERT de la venta. Toma el candado de aviso
--   `resplandor.cobros` que ya toman `deshacer_cobro` y `cerrar_dia`: los cobros por partes, deshacer un cobro y cerrar el día se turnan.
--
-- CÓDIGOS (SQLSTATE; el POS los lee por `code`): RS001 la cuenta ya está cerrada · RS003 la cuenta cambió (versión, o el cobro repetido ya no existe) · RS005 la cuenta tiene una
--   promoción, o ya estaba archivada en un cierre del día (el mensaje dice «por partes») · RS006 el cobro no es válido (línea o cantidad que la cuenta no tiene, línea que no
--   se cobra por partes, monto o método de abono inválido, lo que quedaría en negativo). «orden … no existe» (P0001) si la cuenta no existe o no se ve.
--
-- Deshacer: `deshacer_cobro` ya sabe devolver estas ventas (traen `parcial_de`): las unidades vuelven a la cuenta, el trigger de precio vivo recalcula las promos sobre lo que hay
-- y, si era un abono, se quita su línea `abono_recibido_`. Un cobro que se deshizo no se repite con el mismo `p_delta_id` (queda anotado y la venta ya no existe: RS003).
--
-- NO cambia ninguna tabla, policy ni dato; no toca `aplicar_delta_orden`, `deshacer_cobro`, `cerrar_dia` ni la guardia de 20261005130000 (que se queda: es la red de seguridad de
-- una tablet que todavía tiene el POS de antes, que cobra por partes con un upsert). Idempotente (create or replace; el grant repetido no cambia nada). Necesita
-- 20261005100000 (privado.normalizar_items) y 20261002180000 (deltas_aplicados y sus ayudantes): si falta algo, se niega a correr SIN cambiar nada.
--
-- ORDEN: pegarla ANTES de publicar el POS que la llama (el POS nuevo ya no cobra por partes con un upsert: sin esta función, «Cobrar por partes» y «Abonar» dicen que falta
-- aplicarla). Va después de 20261005130000.
--
-- REVERSA (menos de 1 minuto; las cuentas y las ventas no cambian; el POS que las llama tiene que volver atrás ANTES, o «Cobrar por partes» y «Abonar» no funcionan):
--   begin;
--   drop function if exists public.cobrar_parcial(text, integer, jsonb, jsonb, text);
--   drop function if exists public.cobrar_abono(text, integer, jsonb, numeric, text, text);
--   drop function if exists privado.items_de_hoy(jsonb, timestamp with time zone);
--   commit;
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regprocedure('privado.normalizar_items(jsonb,smallint)') is null or to_regprocedure('privado.dia_bogota(timestamp with time zone)') is null then
    raise exception 'Falta 20261005100000_precio_vivo_y_promos.sql (privado.normalizar_items): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('privado.delta_registrar(text,text)') is null or to_regprocedure('privado.orden_archivada(text)') is null
     or to_regclass('public.deltas_aplicados') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ordenes' and column_name = 'parcial_de') then
    raise exception 'Falta 20261002180000_deshacer_cobro.sql (deltas_aplicados, privado.delta_registrar y ordenes.parcial_de): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. El ayudante: los ítems de una cuenta como deben estar HOY ──

-- SECURITY DEFINER a propósito: `normalizar_items` lee `productos` y no tiene EXECUTE para quien llama la API; las dos RPC corren como quien llama (INVOKER, como
-- `aplicar_delta_orden`). Solo devuelve jsonb calculado a partir de lo que se le pasa y del catálogo; no escribe nada.
create or replace function privado.items_de_hoy(p_items jsonb, p_abierta_en timestamp with time zone)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $function$
  select privado.normalizar_items(coalesce(p_items, '[]'::jsonb), privado.dia_bogota(coalesce(p_abierta_en, now())));
$function$;

revoke all on function privado.items_de_hoy(jsonb, timestamp with time zone) from public, anon, authenticated;
grant execute on function privado.items_de_hoy(jsonb, timestamp with time zone) to authenticated, service_role;

-- ── 2. cobrar_parcial ────────────────────────────────────────

create or replace function public.cobrar_parcial(p_orden_id text, p_version integer, p_venta jsonb, p_lineas jsonb, p_delta_id text)
 returns jsonb
 language plpgsql
 set search_path = ''
as $function$
declare
  o public.ordenes;                    -- la cuenta abierta
  v public.ordenes;                    -- la venta cerrada
  v_venta_id text := case when jsonb_typeof(p_venta) = 'object' then p_venta ->> 'id' else null end;
  v_hoy jsonb;                         -- los ítems de la cuenta con el precio y las promos de hoy
  v_pedido jsonb := '{}'::jsonb;       -- { "<línea>": unidades } lo que se pide, ya validado en su forma
  v_lin jsonb;
  v_id text;
  v_item jsonb;
  v_pide integer;
  v_hay integer;
  v_precio numeric;
  v_items_venta jsonb := '[]'::jsonb;
  v_items_quedan jsonb := '[]'::jsonb;
  v_total_venta numeric := 0;
  v_total_quedan numeric := 0;
  v_marcador jsonb;
begin
  -- La forma del pedido: sin esto no hay cobro que juzgar.
  if p_orden_id is null or p_orden_id = '' or v_venta_id is null or v_venta_id = '' or length(v_venta_id) > 100
     or p_delta_id is null or p_delta_id = '' or length(p_delta_id) > 100
     or jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'cobro por partes inválido: faltan la cuenta, el id de la venta, el id del cobro o las líneas que se cobran' using errcode = 'RS006';
  end if;
  for v_lin in select e from jsonb_array_elements(p_lineas) e loop
    v_id := case when jsonb_typeof(v_lin) = 'object' then v_lin ->> 'id' else null end;
    if v_id is null or v_id = '' or jsonb_typeof(v_lin -> 'qty') is distinct from 'number' or (v_lin ->> 'qty') !~ '^[1-9][0-9]{0,5}$' then
      raise exception 'cobro por partes inválido: cada línea lleva su id y unidades enteras desde 1 (%)', v_lin using errcode = 'RS006';
    end if;
    if v_pedido ? v_id then
      raise exception 'cobro por partes inválido: la línea % viene repetida', v_id using errcode = 'RS006';
    end if;
    v_pedido := v_pedido || jsonb_build_object(v_id, (v_lin ->> 'qty')::int);
  end loop;

  -- Los cobros por partes, deshacer un cobro y el cierre del día se turnan (el mismo candado de aviso que deshacer_cobro y cerrar_dia).
  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));

  -- (e) Idempotente. Con id, PRIMERO se anota y después se bloquea la cuenta (el mismo orden que aplicar_delta_orden): dos reintentos del mismo cobro a la vez se turnan en el índice
  -- de `deltas_aplicados` y el segundo ve el id anotado. Si algo falla más abajo, la transacción entera se deshace, también la anotación.
  if not privado.delta_registrar(p_delta_id, p_orden_id) then
    select * into v from public.ordenes where id = v_venta_id and parcial_de = p_orden_id;
    if not found then
      raise exception 'la cuenta de la orden % cambió desde que se vio: ese cobro ya no existe (se deshizo o se archivó)', p_orden_id using errcode = 'RS003';
    end if;
    select * into o from public.ordenes where id = p_orden_id;
    return jsonb_build_object('ok', true, 'repetido', true, 'venta', to_jsonb(v) - 'deltas_ids',
                              'cuenta', case when found then to_jsonb(o) - 'deltas_ids' else null end);
  end if;

  select * into o from public.ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'orden % no existe', p_orden_id;
  end if;
  if o.estado <> 'abierta' then
    raise exception 'orden % está cerrada', p_orden_id using errcode = 'RS001';
  end if;

  -- (a) La tablet cobra lo que vio.
  if p_version is distinct from o.version then
    raise exception 'la cuenta de la orden % cambió desde que se vio: revísala antes de cobrar', o.id using errcode = 'RS003';
  end if;

  if privado.orden_archivada(o.id) then
    raise exception 'la cuenta % ya estaba en un cierre del día: no se puede cobrar por partes; revísala con el admin', o.id
      using errcode = 'RS005', hint = 'Una cuenta archivada no se cobra, ni entera ni por partes. Un admin la saca del cierre con «Reabrir» en el historial.';
  end if;

  -- (b) Una cuenta con promoción no se parte: la tiene, o la tendría al normalizarla hoy.
  v_hoy := privado.items_de_hoy(o.items, o.abierta_en);
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) e where (e ->> 'id') like 'promo:%')
     or exists (select 1 from jsonb_array_elements(v_hoy) e where (e ->> 'id') like 'promo:%') then
    raise exception 'la cuenta % tiene una promoción: el descuento se calcula con toda la cuenta junta, así que no se puede cobrar por partes ni por persona', o.id
      using errcode = 'RS005',
            hint = 'Cobra la mesa completa, o recibe un abono por cada quien (cobro por monto). Un cobro por partes saca unidades de la cuenta y el descuento se recalcula sobre lo que queda.';
  end if;

  -- (c) Lo pedido existe, con esas unidades. Se recorre la cuenta EN SU ORDEN: lo cobrado va a la venta y el resto se queda.
  for v_item in select e from jsonb_array_elements(v_hoy) with ordinality as x(e, n) order by x.n loop
    v_id := v_item ->> 'id';
    v_hay := coalesce(nullif(v_item ->> 'qty', '')::int, 0);
    v_precio := coalesce(nullif(v_item ->> 'precio', '')::numeric, 0);
    if v_pedido ? v_id then
      v_pide := (v_pedido ->> v_id)::int;
      if v_id = 'para_llevar' or v_id like 'abono\_%' or v_precio < 0 then
        raise exception 'cobro por partes inválido: la línea % no se cobra por partes', v_id using errcode = 'RS006';
      end if;
      if v_pide > v_hay then
        raise exception 'cobro por partes inválido: se pidieron % de «%» y la cuenta tiene %', v_pide, coalesce(v_item ->> 'nombre', v_id), v_hay using errcode = 'RS006';
      end if;
      v_items_venta := v_items_venta || jsonb_build_array(jsonb_set(v_item, '{qty}', to_jsonb(v_pide)));
      v_total_venta := v_total_venta + v_precio * v_pide;
      v_pedido := v_pedido - v_id;
      if v_hay - v_pide > 0 then
        v_items_quedan := v_items_quedan || jsonb_build_array(jsonb_set(v_item, '{qty}', to_jsonb(v_hay - v_pide)));
        v_total_quedan := v_total_quedan + v_precio * (v_hay - v_pide);
      end if;
    else
      v_items_quedan := v_items_quedan || jsonb_build_array(v_item);
      v_total_quedan := v_total_quedan + v_precio * v_hay;
    end if;
  end loop;
  if v_pedido <> '{}'::jsonb then
    raise exception 'cobro por partes inválido: la cuenta no tiene la línea «%»', (select k from jsonb_object_keys(v_pedido) k limit 1) using errcode = 'RS006';
  end if;
  -- Con abonos ya recibidos, lo que falta es menos que la suma de las líneas: cobrar más de eso dejaría la cuenta en negativo (el cliente pagaría de más).
  if v_total_quedan < 0 then
    raise exception 'cobro por partes inválido: la cuenta ya recibió abonos y no alcanza para cobrar eso (quedaría en %)', v_total_quedan using errcode = 'RS006';
  end if;

  -- «Todo para llevar»: la cuenta lo conserva y la venta lleva su copia (cantidad 1, $0) para quedar registrada «para llevar».
  select e into v_marcador from jsonb_array_elements(v_hoy) e
   where (e ->> 'id') = 'para_llevar' and coalesce(nullif(e ->> 'qty', '')::int, 0) > 0 limit 1;
  if v_marcador is not null then
    v_items_venta := v_items_venta || jsonb_build_array(jsonb_set(v_marcador, '{qty}', to_jsonb(1)));
  end if;

  -- (d) La venta y la cuenta, juntas.
  insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de)
  values (v_venta_id, o.mesa_id, 'cerrada', v_items_venta, v_total_venta, o.abierta_en, now(), o.id)
  returning * into v;

  update public.ordenes
     set items = v_items_quedan,
         total = v_total_quedan,
         version = coalesce(o.version, 0) + 1,
         updated_at = now()
   where id = o.id
  returning * into o;

  return jsonb_build_object('ok', true, 'repetido', false, 'venta', to_jsonb(v) - 'deltas_ids', 'cuenta', to_jsonb(o) - 'deltas_ids');
end;
$function$;

comment on function public.cobrar_parcial(text, integer, jsonb, jsonb, text) is
  'Cobra por partes (por ítems, por unidades o por persona) UNA cuenta abierta, atómico y bajo candado: con la versión que la tablet vio (RS003), sin promoción en la cuenta (RS005), con lo pedido existente (RS006), idempotente por p_delta_id. Inserta la venta cerrada (parcial_de), saca esas unidades de la cuenta y devuelve {ok, repetido, venta, cuenta}.';

revoke all on function public.cobrar_parcial(text, integer, jsonb, jsonb, text) from public, anon;
grant execute on function public.cobrar_parcial(text, integer, jsonb, jsonb, text) to authenticated, service_role;

-- ── 3. cobrar_abono ──────────────────────────────────────────

create or replace function public.cobrar_abono(p_orden_id text, p_version integer, p_venta jsonb, p_monto numeric, p_metodo text, p_delta_id text)
 returns jsonb
 language plpgsql
 set search_path = ''
as $function$
declare
  o public.ordenes;                    -- la cuenta abierta
  v public.ordenes;                    -- la venta cerrada «Abono»
  v_venta_id text := case when jsonb_typeof(p_venta) = 'object' then p_venta ->> 'id' else null end;
  v_uid text := case when jsonb_typeof(p_venta) = 'object' then p_venta ->> 'uid' else null end;
  v_hoy jsonb;
  v_pendiente numeric;
  v_items_venta jsonb;
  v_items_cuenta jsonb;
begin
  if p_orden_id is null or p_orden_id = '' or v_venta_id is null or v_venta_id = '' or length(v_venta_id) > 100
     or v_uid is null or v_uid !~ '^[a-z0-9]{1,60}$'
     or p_delta_id is null or p_delta_id = '' or length(p_delta_id) > 100 then
    raise exception 'abono inválido: faltan la cuenta, el id de la venta, el uid del abono (solo a-z y 0-9) o el id del cobro' using errcode = 'RS006';
  end if;
  if p_monto is null or p_monto <> trunc(p_monto) or p_monto <= 0 or p_monto > 1000000000 then
    raise exception 'abono inválido: el monto es en pesos enteros y mayor que cero (%)', p_monto using errcode = 'RS006';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'qr', 'transferencia') then
    raise exception 'abono inválido: el método es efectivo, qr o transferencia (%)', p_metodo using errcode = 'RS006';
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));

  -- Idempotente (ver cobrar_parcial).
  if not privado.delta_registrar(p_delta_id, p_orden_id) then
    select * into v from public.ordenes where id = v_venta_id and parcial_de = p_orden_id;
    if not found then
      raise exception 'la cuenta de la orden % cambió desde que se vio: ese cobro ya no existe (se deshizo o se archivó)', p_orden_id using errcode = 'RS003';
    end if;
    select * into o from public.ordenes where id = p_orden_id;
    return jsonb_build_object('ok', true, 'repetido', true, 'venta', to_jsonb(v) - 'deltas_ids',
                              'cuenta', case when found then to_jsonb(o) - 'deltas_ids' else null end);
  end if;

  select * into o from public.ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'orden % no existe', p_orden_id;
  end if;
  if o.estado <> 'abierta' then
    raise exception 'orden % está cerrada', p_orden_id using errcode = 'RS001';
  end if;
  if p_version is distinct from o.version then
    raise exception 'la cuenta de la orden % cambió desde que se vio: revísala antes de cobrar', o.id using errcode = 'RS003';
  end if;
  if privado.orden_archivada(o.id) then
    raise exception 'la cuenta % ya estaba en un cierre del día: no se puede cobrar por partes; revísala con el admin', o.id
      using errcode = 'RS005', hint = 'Una cuenta archivada no se cobra, ni entera ni por partes. Un admin la saca del cierre con «Reabrir» en el historial.';
  end if;

  -- Lo que falta por pagar: la suma de la cuenta como queda hoy (con los abonos ya recibidos restados). Un abono es MENOR que eso; igual es el cobro normal.
  v_hoy := privado.items_de_hoy(o.items, o.abierta_en);
  select coalesce(sum(coalesce(nullif(e ->> 'precio', '')::numeric, 0) * coalesce(nullif(e ->> 'qty', '')::int, 0)), 0) into v_pendiente from jsonb_array_elements(v_hoy) e;
  if p_monto >= v_pendiente then
    raise exception 'abono inválido: falta por pagar % y el abono (%) tiene que ser menor; para pagar todo se cobra la mesa completa', v_pendiente, p_monto using errcode = 'RS006';
  end if;

  v_items_venta := jsonb_build_array(jsonb_build_object('id', 'abono_' || v_uid, 'nombre', 'Abono', 'precio', p_monto, 'qty', 1, 'nota', p_metodo));
  v_items_cuenta := v_hoy || jsonb_build_array(jsonb_build_object('id', 'abono_recibido_' || v_uid, 'nombre', 'Abono recibido', 'precio', -p_monto, 'qty', 1, 'nota', p_metodo));

  insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de)
  values (v_venta_id, o.mesa_id, 'cerrada', v_items_venta, p_monto, o.abierta_en, now(), o.id)
  returning * into v;

  update public.ordenes
     set items = v_items_cuenta,
         total = v_pendiente - p_monto,
         version = coalesce(o.version, 0) + 1,
         updated_at = now()
   where id = o.id
  returning * into o;

  return jsonb_build_object('ok', true, 'repetido', false, 'venta', to_jsonb(v) - 'deltas_ids', 'cuenta', to_jsonb(o) - 'deltas_ids');
end;
$function$;

comment on function public.cobrar_abono(text, integer, jsonb, numeric, text, text) is
  'Recibe un abono (cobro por monto) de una cuenta abierta, atómico y bajo candado: la venta cerrada «Abono» (parcial_de) y la línea abono_recibido_<uid> en la cuenta, con la versión que la tablet vio (RS003), monto menor que lo que falta y método válido (RS006), idempotente por p_delta_id. Entra también en una cuenta con promoción. Devuelve {ok, repetido, venta, cuenta}.';

revoke all on function public.cobrar_abono(text, integer, jsonb, numeric, text, text) from public, anon;
grant execute on function public.cobrar_abono(text, integer, jsonb, numeric, text, text) to authenticated, service_role;

-- ── 4. Comprobación ─────────────────────────────────────────

do $$
declare
  v jsonb;
begin
  -- Quién puede ejecutar qué: la API del personal sí, anon y public no.
  if not has_function_privilege('authenticated', 'public.cobrar_parcial(text,integer,jsonb,jsonb,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.cobrar_abono(text,integer,jsonb,numeric,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.cobrar_parcial(text,integer,jsonb,jsonb,text)', 'execute')
     or not has_function_privilege('service_role', 'public.cobrar_abono(text,integer,jsonb,numeric,text,text)', 'execute') then
    raise exception 'authenticated o service_role no pueden ejecutar cobrar_parcial o cobrar_abono';
  end if;
  if has_function_privilege('anon', 'public.cobrar_parcial(text,integer,jsonb,jsonb,text)', 'execute')
     or has_function_privilege('public', 'public.cobrar_parcial(text,integer,jsonb,jsonb,text)', 'execute')
     or has_function_privilege('anon', 'public.cobrar_abono(text,integer,jsonb,numeric,text,text)', 'execute')
     or has_function_privilege('public', 'public.cobrar_abono(text,integer,jsonb,numeric,text,text)', 'execute') then
    raise exception 'anon o public pueden ejecutar cobrar_parcial o cobrar_abono: no tenían que poder';
  end if;
  if not has_function_privilege('authenticated', 'privado.items_de_hoy(jsonb,timestamp with time zone)', 'execute')
     or has_function_privilege('anon', 'privado.items_de_hoy(jsonb,timestamp with time zone)', 'execute') then
    raise exception 'privado.items_de_hoy: authenticated tiene que poder ejecutarla y anon no';
  end if;
  -- Corren con los permisos de quien llama (SECURITY INVOKER) y su ayudante, no.
  if exists (select 1 from pg_proc p where p.oid in (to_regprocedure('public.cobrar_parcial(text,integer,jsonb,jsonb,text)'), to_regprocedure('public.cobrar_abono(text,integer,jsonb,numeric,text,text)')) and p.prosecdef)
     or not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('privado.items_de_hoy(jsonb,timestamp with time zone)')) then
    raise exception 'cobrar_parcial y cobrar_abono tienen que ser SECURITY INVOKER y privado.items_de_hoy SECURITY DEFINER';
  end if;
  -- El ayudante normaliza como lo hace el trigger: sin reglas ni productos que coincidan, una línea manual sale tal cual.
  v := privado.items_de_hoy('[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb, '2026-10-05 17:00:00+00'::timestamptz);
  if v <> '[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb then
    raise exception 'privado.items_de_hoy cambió una línea manual: %', v;
  end if;
end $$;
