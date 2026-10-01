-- ════════════════════════════════════════════════════════════
-- Resplandor — DESHACER UN COBRO, «tipo ctrl+z», SIN VENTANA, Y EL CIERRE DEL DÍA ATÓMICO (4 de 4 de la ola C)
-- (pedido de Yonatan, 2026-09-30: «si pagué una parte de una cuenta y la quiero deshacer, si ese pago fue de esa
-- mesa se debería poder editar y devolver a la mesa, por ende recalcular»; 2026-10-01: «el pedido se podrá
-- deshacer cuando quiera el mesero o el admin»; decisión D28 de las alertas)
--
--   1. 20261002150000_aprobacion_personal.sql      quién entra, con aprobación.
--   2. 20261002160000_mesas_y_pegatinas.sql        mesas activas y pegatinas NFC.
--   3. 20261002170000_ajustes_ticket.sql           la URL del QR y el pie del ticket.
--   4. 20261002180000_deshacer_cobro.sql        ← ESTA.
--
-- Qué hace
--   1. `ordenes.parcial_de` (text, null): el id de la orden ABIERTA de la que salió esta orden cerrada, cuando es
--      un cobro parcial (por ítems o por unidades: facturarParcial) o un abono (cobrarMonto). El POS lo escribe al
--      CREAR la orden cerrada. No es clave foránea a propósito: el cierre del día borra órdenes y no debe fallar.
--   2. `deshacer_cobro(p_orden_id)`: deshace un cobro del turno abierto, TODO en una transacción con candado:
--        · un cobro por ítems o por unidades (trae `parcial_de`): cada ítem vuelve a la cuenta abierta de la MISMA
--          mesa con su mismo id, nombre, precio y nota; si la línea ya no está se agrega entera; si sigue, se le
--          suman las unidades.
--        · un abono (trae `parcial_de` y una sola línea `abono_<uid>`): se quita de la cuenta su línea
--          `abono_recibido_<uid>`. Solo si la cuenta la trae EXACTAMENTE así (una línea, cantidad 1, precio igual al
--          opuesto del abono): si alguien la editó, no se devuelve y no se inventa un monto.
--        · el COBRO COMPLETO de una mesa (sin `parcial_de`): si esa mesa está libre, la misma orden se REABRE en ella
--          (la mesa vuelve a «ocupada»); si la mesa ya tiene otra cuenta abierta, los ítems pasan a ESA cuenta y la
--          cerrada se borra (los abonos de la cerrada pasan a apuntar a la cuenta que los recibe).
--      En los tres casos se recalcula `total` (Σ precio × qty) y se sube `version`; el monto que se devuelve (`monto`)
--      es lo que de verdad volvió a la cuenta (el total de después menos el de antes), no el `total` de la cerrada.
--      La señal en vivo de la carta sale sola: el UPDATE de la orden abierta dispara `ordenes_emite_cuenta`
--      (20261001120000); el DELETE de la cerrada no emite. Una sola señal.
--      QUIÉN: el admin y el mesero, EN CUALQUIER MOMENTO, mientras el cobro siga en el turno abierto (todavía no esté
--      en un cierre del día: el cierre borra las órdenes que archiva, y si la purga está en camino, `ya_en_cierre`).
--      Quien no tiene rol, nada. Es SECURITY DEFINER porque el mesero no puede editar ni borrar una orden cerrada
--      (RLS de la ola B): editar en el sitio y eliminar una venta siguen siendo SOLO del admin; deshacer es otra cosa.
--      Devuelve jsonb:
--        {ok: true, tipo ('parcial'|'abono'|'completo'), total_abierta, orden_id (la cuenta abierta), mesa_id,
--         monto (lo que volvió), version, reabierta (true: la cerrada se reabrió en su mesa), fusionada (true: pasó a
--         otra cuenta abierta de la mesa)}
--        {ok: false, codigo}  con codigo =
--          no_autorizado     sin rol (pendiente, eliminado, ajena)
--          no_existe         no hay esa orden (también: ya se deshizo; un doble toque cae aquí la segunda vez)
--          ya_reabierta      la orden existe pero ya está ABIERTA: otra tablet acaba de deshacer ese mismo cobro completo (el
--                            doble toque desde dos tablets de un cobro completo cae aquí la segunda vez)
--          mesa_ocupada      el cobro completo se iba a reabrir y, a la vez, otra tablet abrió esa mesa y se rechazó (23505) sin
--                            que luego se encontrara esa cuenta (rarísimo: se vuelve a intentar). Si SÍ se encuentra, los
--                            ítems pasan a ella (fusionada)
--          no_es_parcial     no está cerrada, o no se puede devolver: un abono sin cuenta (anterior a esta migración),
--                            una orden vacía, un cobro de otra mesa que la cuenta, o un abono que ya no cuadra con ella
--          cuenta_ya_cerrada la cuenta de la que salió (parcial o abono) ya no está abierta: se cobró, se borró o se purgó
--          mesa_inactiva     el cobro completo es de una mesa que un admin desactivó: se activa y se vuelve a intentar
--          ya_en_cierre      el cobro ya está en un cierre del día (la purga de sus órdenes está en camino)
--   3. TRAZABILIDAD (no limita a nadie): la tabla `deshechos` (id, orden_id, mesa_id, tipo, monto, items, hecho_por,
--      hecho_en, cierre_id). SOLO la escribe `deshacer_cobro` (nadie tiene INSERT) y SOLO la lee el admin. `hecho_por` es el correo de
--      la identidad de Google de la sesión, `hecho_en` la hora del servidor. El POS le enseña al admin, en el cierre del
--      día, «Cobros deshechos hoy: N · $X» con quién, mesa, monto y hora. Se guarda 90 días: un disparador al guardar un
--      cierre del día borra lo más viejo (`purgar_deshechos_viejos`). Es dato personal (el correo de quien lo hizo):
--      privacy.html lo dice. `cierre_id` es el cierre del día que los incluyó: null = turno abierto («Cobros deshechos
--      hoy» = los de `cierre_id` null). Lo escribe `cerrar_dia` (punto 6) en la misma transacción que guarda el cierre, así
--      que «hoy» no depende del reloj de ninguna tablet ni se pierde un deshacer hecho mientras el admin miraba el cierre
--      (refutación de la ola C, ronda 2, hallazgo 3).
--   4. Dos guardias sobre `ordenes` (disparador `trg_ordenes_guardia`, solo con sesiones de la API: el dueño, el SQL
--      Editor y las funciones SECURITY DEFINER no se frenan):
--        · `parcial_de` solo lo escribe quien CREA la orden: en un UPDATE se conserva (un mesero que cierra una cuenta
--          suya con `parcial_de = <otra orden>` no engaña a deshacer_cobro) y se pone en null, para todos, cuando una
--          orden cerrada se reabre o se edita (cambia sus ítems, su total o su mesa): el cobro ya no es el que era.
--        · CERRAR CON LO QUE SE VIO: si el UPDATE que pasa una orden de abierta a cerrada trae un `version` distinto del
--          que tiene la base, se rechaza (SQLSTATE RS003, «la cuenta … cambió»). Sin esto, una tablet que estuvo sin red
--          cobraba la mesa con ítems viejos y pisaba lo que otra tablet había devuelto con «Deshacer» (refutación de la
--          ola C, hallazgo 4). El POS manda su `version` al cerrar; quien no la manda (una caché vieja) no se frena. Y
--          `version` sigue a los ítems: cualquier UPDATE que cambie `items` sin tocar `version` la sube.
--   5. D28 de las alertas (privacidad: `alertas.atendida_por` guarda el correo de quien atendió): las alertas que
--      ya no están pendientes y se resolvieron hace MÁS DE UN DÍA se borran solas. Un disparador de sentencia llama
--      a `purgar_alertas_viejas()` en tres momentos: al crear una alerta (la carta), al resolver una (atender,
--      descartar o cerrar la mesa) y al guardar un cierre del día. Así no hace falta darle a nadie permiso de
--      DELETE sobre `alertas`. Lo que `privacy.html` puede decir con verdad: «los avisos ya atendidos o
--      descartados se borran cuando pasa más de un día, la siguiente vez que se crea o se atiende un aviso o se
--      cierra el día». Las pendientes no se borran (sin cierre ni mesa liberada, una pendiente sigue pendiente).
--   6. EL CIERRE DEL DÍA, ATÓMICO (`cerrar_dia`): antes el POS guardaba el cierre con la foto que tenía en la tablet y
--      después borraba esas órdenes por id. Con «deshacer sin ventana» eso pierde cuentas: un mesero reabre un cobro completo
--      mientras la tablet del admin (sin red, o con el eco atrasado) todavía lo tiene cerrado; el admin cierra el día y la purga
--      borra la cuenta que acababan de reabrir, descarta su alerta y cuenta una venta deshecha (refutación de la ola C, ronda 2,
--      hallazgo 1). Ahora un solo SECURITY DEFINER, solo para el admin, con candado y en UNA transacción:
--        · toma el mismo candado que `deshacer_cobro` (un candado de aviso a nivel de la base: los dos se turnan) y las órdenes
--          del cierre FOR UPDATE;
--        · exige que cada venta del cierre siga CERRADA con la `version` que el POS vio, y que no haya ninguna otra cuenta
--          abierta en el local; si algo cambió responde qué (no guarda nada ni borra nada) y el POS rehace la foto;
--        · guarda el cierre, borra las órdenes que archiva y le pone su id a los `deshechos` del turno, todo junto.
--      NUNCA borra una cuenta abierta. Una venta que el POS cerró SIN RED y que la base todavía tiene abierta con la misma
--      `version` tampoco se borra: se devuelve en `restaurar` para que el POS la suba cerrada (la base la rechaza con RS003 si la
--      cuenta cambió) y el admin vuelva a cerrar. Un reintento del mismo cierre (se perdió la respuesta, o quedó una purga
--      pendiente) no vuelve a validar: sus ventas ya están archivadas.
--      Devuelve jsonb:
--        {ok: true, repetido, borradas, deshechos: [{orden_id, mesa_id, tipo, monto, hecho_por, hecho_en}]}
--        {ok: false, codigo} con codigo =
--          no_autorizado   solo el admin cierra el día
--          invalido        sin id de cierre, o `transacciones` no es una lista
--          hay_abiertas    quedan cuentas abiertas: `abiertas` trae sus mesas
--          cambio          alguna venta ya no es la de la foto (reabierta, editada, deshecha): `cambiaron` trae sus ids;
--                          `restaurar`, las que el POS debe volver a subir cerradas
--
--   acción                       | admin | mesero | pendiente / eliminado / ajeno | anon
--   -----------------------------+-------+--------+-------------------------------+------
--   deshacer_cobro               |  sí   |  sí    | no_autorizado                 | no
--   cerrar_dia                   |  sí   | no_autorizado | no_autorizado          | no
--   deshechos  leer              |  sí   |  no    | no                            | no
--   deshechos  escribir          | solo la función deshacer_cobro (nadie tiene INSERT/UPDATE/DELETE)
--   ordenes.parcial_de           | lo escribe el POS al crear la cerrada (INSERT: ordenes_crear); en UPDATE no cambia
--
-- Necesita las alertas (20261002130000), las policies por rol (20261002140000) y las mesas activas (20261002160000):
-- si falta alguna, se niega a correr SIN cambiar nada. Aplicarla antes del POS que la usa es inocuo.
--
-- REVERSA (menos de 1 minuto; el POS que escribe `parcial_de` debe volver atrás ANTES: sin la columna, el guardado
-- de un cobro parcial fallaría; se pierden los registros de `deshechos`: guardar antes lo que se quiera conservar):
--
--   begin;
--   drop trigger if exists trg_ordenes_guardia on public.ordenes;
--   drop function if exists public.ordenes_guardia();
--   drop trigger if exists trg_cierres_purga_deshechos on public.cierres;
--   drop function if exists public.purgar_deshechos_viejos();
--   drop trigger if exists trg_cierres_purga_alertas on public.cierres;
--   drop trigger if exists trg_alertas_nueva_purga on public.alertas;
--   drop trigger if exists trg_alertas_resuelta_purga on public.alertas;
--   drop function if exists public.purgar_alertas_viejas();
--   drop function if exists public.cerrar_dia(text, timestamp with time zone, numeric, jsonb, jsonb);
--   drop function if exists public.deshacer_cobro(text);
--   drop function if exists public.deshacer_cobro_sumar(jsonb, jsonb);
--   drop table if exists public.deshechos;
--   alter table public.ordenes drop column if exists parcial_de;
--   commit;
--
-- Idempotente donde se puede. Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ───────────────────────────────────────────

do $$
begin
  if to_regclass('public.alertas') is null or to_regprocedure('public.mi_rol()') is null then
    raise exception 'Falta 20261002130000_alertas.sql (alertas) o la compuerta (mi_rol()): aplicalas primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.mi_correo()') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'mesas' and column_name = 'activa') then
    raise exception 'Falta 20261002160000_mesas_y_pegatinas.sql (mesas.activa) o la compuerta (mi_correo()): aplicalas primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. El vínculo del cobro con su cuenta ───────────────────

alter table public.ordenes add column if not exists parcial_de text;

comment on column public.ordenes.parcial_de is
  'id de la orden ABIERTA de la que salió esta orden cerrada (cobro parcial por ítems o unidades, o abono). Lo escribe el POS al crearla; en UPDATE no cambia, y se pone en null al reabrir o editar la cerrada (trg_ordenes_guardia). deshacer_cobro lo usa para devolverlo. Sin clave foránea: el cierre del día borra órdenes.';

-- ── 1b. Los guardias de `ordenes` ───────────────────────────
-- BEFORE INSERT OR UPDATE, por fila. SECURITY INVOKER: current_user dice quién llama (las funciones SECURITY DEFINER, el
-- dueño en el SQL Editor y service_role no son 'anon' ni 'authenticated': no se frenan). Con un upsert
-- (INSERT … ON CONFLICT DO UPDATE) corren los dos caminos: el de INSERT con la fila propuesta y, si ya existía, el de
-- UPDATE con la fila vieja y la nueva.

create or replace function public.ordenes_guardia()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
declare
  v_api boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- Cerrar una cuenta con lo que se vio. `version` solo viaja si el cliente la manda (el upsert del POS la manda al
  -- cobrar la mesa): una tablet atrasada cobraba con ítems viejos y pisaba lo que otra había devuelto.
  if v_api and old.estado = 'abierta' and new.estado = 'cerrada'
     and new.version is distinct from old.version then
    raise exception 'la cuenta de la orden % cambió desde que se vio: revísala antes de cobrar', old.id
      using errcode = 'RS003';
  end if;

  -- `version` sigue a los ítems (aplicar_delta_orden y deshacer_cobro ya la suben ellos mismos).
  if new.items is distinct from old.items and new.version is not distinct from old.version then
    new.version := coalesce(old.version, 0) + 1;
  end if;

  -- `parcial_de` solo lo escribe quien crea la orden.
  if v_api then
    new.parcial_de := old.parcial_de;
  end if;
  -- Una orden cerrada que se reabre o se edita ya no es «el cobro de» nada: el vínculo se corta, para todos.
  if old.estado = 'cerrada'
     and (new.estado is distinct from 'cerrada'
          or new.items is distinct from old.items
          or new.total is distinct from old.total
          or new.mesa_id is distinct from old.mesa_id) then
    new.parcial_de := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.ordenes_guardia() from public, anon, authenticated;

drop trigger if exists trg_ordenes_guardia on public.ordenes;
create trigger trg_ordenes_guardia
  before insert or update on public.ordenes
  for each row
  execute function public.ordenes_guardia();

-- ── 2. Los cobros deshechos (trazabilidad) ──────────────────

create table if not exists public.deshechos (
  id bigint generated always as identity,
  orden_id text not null,
  mesa_id integer not null,
  tipo text not null,
  monto numeric not null,
  items jsonb not null default '[]'::jsonb,
  hecho_por text not null default ''::text,
  hecho_en timestamp with time zone not null default now(),
  cierre_id text,
  constraint deshechos_pkey primary key (id),
  constraint deshechos_tipo_check check ((tipo = any (array['parcial'::text, 'abono'::text, 'completo'::text])))
);

-- (la tabla ya podía existir de una corrida anterior: la columna se agrega aparte)
alter table public.deshechos add column if not exists cierre_id text;

create index if not exists deshechos_hecho_en on public.deshechos using btree (hecho_en desc);

comment on table public.deshechos is
  'Cada cobro que se deshizo con deshacer_cobro: qué orden, de qué mesa, de qué tipo, cuánto, con qué ítems, quién (correo de la sesión de Google) y cuándo (hora del servidor). Solo la escribe deshacer_cobro (y cerrar_dia le pone cierre_id); solo la lee el admin; se guarda 90 días (purgar_deshechos_viejos, al guardar un cierre del día).';
comment on column public.deshechos.cierre_id is
  'El cierre del día que incluyó este cobro deshecho (lo pone cerrar_dia, en su transacción). null = el turno sigue abierto.';

alter table public.deshechos enable row level security;

drop policy if exists deshechos_ver on public.deshechos;
create policy deshechos_ver on public.deshechos for select to authenticated
  using ((select public.mi_rol()) = 'admin');

revoke all on public.deshechos from anon, authenticated, service_role;
grant select on public.deshechos to authenticated;

-- ── 3. deshacer_cobro ───────────────────────────────────────
-- Suma los ítems de `p_extra` a los de `p_base`: la línea que ya está recibe las unidades (el resto de sus campos no se
-- toca); la que no está se agrega tal cual. Función aparte para no repetir el cuerpo en los dos caminos.

create or replace function public.deshacer_cobro_sumar(p_base jsonb, p_extra jsonb)
 returns jsonb
 language plpgsql
 immutable
 set search_path = ''
as $function$
declare
  v_items jsonb := p_base;
  it jsonb;
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
      v_items := v_items || jsonb_build_array(it);
    end if;
  end loop;
  return v_items;
end;
$function$;

-- Candados, siempre en este orden: los cobros que salieron de esta orden (sus «hijos»), la orden, la mesa (solo el
-- cobro completo) y la cuenta abierta. Nadie toma esos candados al revés (el POS solo toca la abierta), así que no
-- hay interbloqueo. Dos toques a la vez: el segundo espera, y cuando obtiene el candado la cerrada ya no existe (o ya
-- no está cerrada) → no_existe / no_es_parcial.

create or replace function public.deshacer_cobro(p_orden_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  c public.ordenes;                 -- la orden cerrada: el cobro
  a public.ordenes;                 -- la cuenta abierta que lo recibe
  v_mesa public.mesas;
  v_tipo text;
  v_items jsonb;
  v_antes numeric := 0;
  v_total numeric;
  v_monto numeric;
  v_reabierta boolean := false;
  v_fusionada boolean := false;
  it jsonb;
  v_uid text;
  v_credito jsonb;
  v_n integer;
begin
  if v_rol is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_orden_id is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;

  -- Un candado de aviso a nivel de la base, el mismo que toma `cerrar_dia`: deshacer un cobro y cerrar el día se turnan (no se
  -- cruzan: uno reabría la cuenta que el otro estaba borrando). Se suelta solo al terminar la transacción.
  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));

  -- Los cobros que salieron de esta orden, primero (el mismo orden que sigue deshacer_cobro de uno de ellos: él toma
  -- su fila y después la de esta orden).
  perform 1 from public.ordenes h where h.parcial_de = p_orden_id order by h.id for update;

  select * into c from public.ordenes where id = p_orden_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  -- Ya está abierta: otra tablet acaba de deshacer este mismo cobro completo (un parcial o un abono, en cambio, se BORRAN al
  -- deshacerse: su segundo toque cae en no_existe). Es lo mismo que «ya se deshizo», no un cobro que no se pueda devolver.
  if c.estado = 'abierta' then
    return jsonb_build_object('ok', false, 'codigo', 'ya_reabierta');
  end if;
  if c.estado <> 'cerrada' or jsonb_typeof(c.items) <> 'array' or jsonb_array_length(c.items) = 0 then
    return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
  end if;
  -- Ya archivada en un cierre del día (la purga de sus órdenes puede estar en camino): se contaría dos veces.
  if exists (select 1 from public.cierres x
              where x.transacciones @> jsonb_build_array(jsonb_build_object('id', c.id))) then
    return jsonb_build_object('ok', false, 'codigo', 'ya_en_cierre');
  end if;

  if c.parcial_de is not null then
    -- Un cobro parcial o un abono: vuelve a la cuenta de la que salió, que tiene que seguir ABIERTA y ser de la MISMA mesa.
    select * into a from public.ordenes where id = c.parcial_de for update;
    if not found or a.estado <> 'abierta' then
      return jsonb_build_object('ok', false, 'codigo', 'cuenta_ya_cerrada');
    end if;
    if a.mesa_id <> c.mesa_id then
      return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
    end if;

    select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_antes
      from jsonb_array_elements(a.items) e;
    v_items := a.items;

    if jsonb_array_length(c.items) = 1 and (c.items -> 0 ->> 'id') like 'abono\_%'
       and (c.items -> 0 ->> 'id') not like 'abono\_recibido\_%' then
      v_tipo := 'abono';
      -- UN abono: exactamente una línea `abono_<uid>` (cantidad 1, precio > 0) y, en la cuenta, exactamente una línea
      -- `abono_recibido_<uid>` (cantidad 1, precio = −el del abono). Si no cuadra, no se devuelve nada.
      it := c.items -> 0;
      if (it ->> 'qty')::int <> 1 or (it ->> 'precio')::numeric <= 0 then
        return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
      end if;
      v_uid := substr(it ->> 'id', 7);
      select count(*) into v_n from jsonb_array_elements(a.items) e where e ->> 'id' = 'abono_recibido_' || v_uid;
      if v_n <> 1 then
        return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
      end if;
      select e into v_credito from jsonb_array_elements(a.items) e where e ->> 'id' = 'abono_recibido_' || v_uid;
      if (v_credito ->> 'qty')::int <> 1 or (v_credito ->> 'precio')::numeric <> -((it ->> 'precio')::numeric) then
        return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
      end if;
      v_items := coalesce((
        select jsonb_agg(x.e order by x.n)
          from jsonb_array_elements(a.items) with ordinality as x(e, n)
         where x.e ->> 'id' <> 'abono_recibido_' || v_uid
      ), '[]'::jsonb);
    else
      v_tipo := 'parcial';
      -- Un cobro por ítems o unidades: solo líneas de producto (nunca de abono), con cantidad y precio sensatos.
      if exists (select 1 from jsonb_array_elements(c.items) e
                  where (e ->> 'id') like 'abono\_%'
                     or coalesce((e ->> 'qty')::int, 0) <= 0
                     or coalesce((e ->> 'precio')::numeric, -1) < 0) then
        return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
      end if;
      v_items := public.deshacer_cobro_sumar(a.items, c.items);
    end if;
  else
    -- El cobro COMPLETO de una mesa. Un abono suelto (anterior a esta migración, sin cuenta) no se reabre como cuenta:
    -- la mesa pagaría dos veces. Sus abonos recibidos (`abono_recibido_…`) sí viajan con la cuenta.
    v_tipo := 'completo';
    if exists (select 1 from jsonb_array_elements(c.items) e
                where (e ->> 'id') like 'abono\_%' and (e ->> 'id') not like 'abono\_recibido\_%') then
      return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
    end if;

    select * into v_mesa from public.mesas where id = c.mesa_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
    end if;
    if not v_mesa.activa then
      return jsonb_build_object('ok', false, 'codigo', 'mesa_inactiva');
    end if;

    select * into a from public.ordenes where mesa_id = c.mesa_id and estado = 'abierta' for update;
    if found then
      -- La mesa ya tiene otra cuenta abierta: los ítems pasan a ella.
      v_fusionada := true;
      select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_antes
        from jsonb_array_elements(a.items) e;
      v_items := public.deshacer_cobro_sumar(a.items, c.items);
    else
      v_reabierta := true;
    end if;
  end if;

  if v_reabierta then
    select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_total
      from jsonb_array_elements(c.items) e;
    v_monto := v_total;
    begin
      update public.ordenes
         set estado = 'abierta',
             cerrada_en = null,
             total = v_total,
             version = coalesce(c.version, 0) + 1,
             updated_at = now()
       where id = c.id
      returning * into a;
      update public.mesas set estado = 'ocupada' where id = c.mesa_id;
    exception when unique_violation then
      -- Otra tablet abrió una cuenta en esa mesa libre justo ahora (ux_ordenes_una_abierta_por_mesa): ya no es «mesa libre».
      -- El sub-bloque deshizo el UPDATE; se hace lo mismo que cuando la mesa ya tenía cuenta: los ítems pasan a ella.
      select * into a from public.ordenes where mesa_id = c.mesa_id and estado = 'abierta' for update;
      if not found then
        return jsonb_build_object('ok', false, 'codigo', 'mesa_ocupada');
      end if;
      v_reabierta := false;
      v_fusionada := true;
      select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_antes
        from jsonb_array_elements(a.items) e;
      v_items := public.deshacer_cobro_sumar(a.items, c.items);
    end;
  end if;
  if not v_reabierta then
    select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0)
      into v_total
      from jsonb_array_elements(v_items) e;
    v_monto := v_total - v_antes;
    update public.ordenes
       set items = v_items,
           total = v_total,
           version = coalesce(a.version, 0) + 1,
           updated_at = now()
     where id = a.id
    returning * into a;
    -- Los abonos que habían salido de la cuenta cerrada ahora los recibe esta otra: siguen siendo devolvibles.
    if v_fusionada then
      update public.ordenes set parcial_de = a.id where parcial_de = c.id;
    end if;
    delete from public.ordenes where id = c.id;
  end if;

  insert into public.deshechos (orden_id, mesa_id, tipo, monto, items, hecho_por)
  values (c.id, c.mesa_id, v_tipo, v_monto, c.items, coalesce((select public.mi_correo()), ''));

  return jsonb_build_object('ok', true, 'tipo', v_tipo, 'total_abierta', a.total, 'orden_id', a.id,
                            'mesa_id', a.mesa_id, 'monto', v_monto, 'version', a.version,
                            'reabierta', v_reabierta, 'fusionada', v_fusionada);
end;
$function$;

comment on function public.deshacer_cobro(text) is
  'Deshace un cobro del turno abierto, sin ventana de tiempo (admin y mesero): un parcial o un abono vuelven a la cuenta abierta de la misma mesa; un cobro completo reabre la mesa o pasa a la cuenta que ya tiene. Borra la orden cerrada (o la reabre), recalcula, y deja su fila en public.deshechos.';

revoke all on function public.deshacer_cobro_sumar(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.deshacer_cobro(text) from public, anon, service_role;
grant execute on function public.deshacer_cobro(text) to authenticated;

-- ── 3b. cerrar_dia: el cierre del día, atómico ─────────────
-- Ver el punto 6 de la cabecera. `p_transacciones` es lo que el POS ya guarda en `cierres.transacciones` (la lista de las
-- ventas del día, cada una con al menos su `id`); `p_versiones` es {id: version} de lo que la tablet vio de cada una.
-- Candados, siempre en este orden (el mismo que deshacer_cobro, que además toma el candado de aviso): el candado de aviso, y
-- las órdenes del cierre por id. Un POS viejo que borra por id sin pasar por aquí no cambia esto: solo puede esperar a que
-- alguien suelte una fila.

create or replace function public.cerrar_dia(p_id text, p_fecha timestamp with time zone, p_total numeric, p_transacciones jsonb,
                                             p_versiones jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  v_ids text[];
  v_cambiaron text[] := '{}';
  v_restaurar text[] := '{}';
  v_abiertas integer[];
  v_ver text;
  v_borradas integer := 0;
  v_deshechos jsonb;
  r record;
begin
  if v_rol is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_id is null or p_id = '' or p_transacciones is null or jsonb_typeof(p_transacciones) <> 'array' then
    return jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  if p_versiones is null or jsonb_typeof(p_versiones) <> 'object' then
    p_versiones := '{}'::jsonb;
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));

  select coalesce(array_agg(distinct e ->> 'id'), '{}'::text[]) into v_ids
    from jsonb_array_elements(p_transacciones) e
   where e ->> 'id' is not null;

  -- Las ventas del cierre, con candado y en orden (nadie las cambia mientras se revisan).
  perform 1 from public.ordenes where id = any(v_ids) order by id for update;

  if exists (select 1 from public.cierres where id = p_id) then
    -- El mismo cierre otra vez: la respuesta se perdió, o quedó una purga pendiente. Sus ventas ya están archivadas
    -- (deshacer_cobro las rechaza como ya_en_cierre), así que no se vuelve a validar: se deja el cierre como lo manda el POS
    -- (un cierre editado y reenviado) y se termina de borrar lo que siga CERRADO. Una cuenta abierta no se toca nunca.
    insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones)
    values (p_id, coalesce(p_fecha, now()), coalesce(p_total, 0), jsonb_array_length(p_transacciones), p_transacciones)
    on conflict (id) do update
      set fecha = excluded.fecha, total_ventas = excluded.total_ventas,
          total_ordenes = excluded.total_ordenes, transacciones = excluded.transacciones;
    delete from public.ordenes where id = any(v_ids) and estado = 'cerrada';
    get diagnostics v_borradas = row_count;
    return jsonb_build_object('ok', true, 'repetido', true, 'borradas', v_borradas, 'deshechos', '[]'::jsonb);
  end if;

  -- Cada venta del cierre contra lo que hay en la base ahora.
  for r in
    select u.id, o.id as hay, o.estado, o.version
      from unnest(v_ids) as u(id) left join public.ordenes o on o.id = u.id
     order by u.id
  loop
    v_ver := p_versiones ->> r.id;
    if r.hay is null then
      -- No está en la base: o se cobró sin red y nunca llegó (se restaura), o se DESHIZO y desapareció (parcial, abono o
      -- cobro completo fusionado: deshechos lo recuerda). Esta última no se cuenta.
      if exists (select 1 from public.deshechos d where d.orden_id = r.id) then
        v_cambiaron := v_cambiaron || r.id;
      else
        v_restaurar := v_restaurar || r.id;
      end if;
    elsif r.estado = 'cerrada' then
      if v_ver is not null and v_ver ~ '^-?[0-9]+$' and coalesce(r.version, 0) <> v_ver::integer then
        v_cambiaron := v_cambiaron || r.id;   -- la editaron (o la reabrieron y la volvieron a cobrar distinta)
      end if;
    else
      -- Abierta en la base (el cierre dice cerrada): o la reabrieron (versión distinta: cambió) o este POS la cobró sin red y la
      -- base aún no se entera (misma versión: se restaura para subirla cerrada). En ningún caso se borra una cuenta abierta.
      if v_ver is not null and v_ver ~ '^-?[0-9]+$' and coalesce(r.version, 0) = v_ver::integer then
        v_restaurar := v_restaurar || r.id;
      else
        v_cambiaron := v_cambiaron || r.id;
      end if;
    end if;
  end loop;

  select array_agg(distinct o.mesa_id order by o.mesa_id) into v_abiertas
    from public.ordenes o
   where o.estado = 'abierta' and o.id <> all (v_ids);

  if v_abiertas is not null then
    return jsonb_build_object('ok', false, 'codigo', 'hay_abiertas', 'abiertas', to_jsonb(v_abiertas),
                              'cambiaron', to_jsonb(v_cambiaron), 'restaurar', to_jsonb(v_restaurar));
  end if;
  if cardinality(v_cambiaron) > 0 or cardinality(v_restaurar) > 0 then
    return jsonb_build_object('ok', false, 'codigo', 'cambio',
                              'cambiaron', to_jsonb(v_cambiaron), 'restaurar', to_jsonb(v_restaurar));
  end if;

  -- Todo cuadra: el cierre, la purga y los deshechos del turno, juntos.
  insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones)
  values (p_id, coalesce(p_fecha, now()), coalesce(p_total, 0), jsonb_array_length(p_transacciones), p_transacciones)
  on conflict (id) do update
    set fecha = excluded.fecha, total_ventas = excluded.total_ventas,
        total_ordenes = excluded.total_ordenes, transacciones = excluded.transacciones;

  delete from public.ordenes where id = any(v_ids) and estado = 'cerrada';
  get diagnostics v_borradas = row_count;

  with marcados as (
    update public.deshechos set cierre_id = p_id where cierre_id is null returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('orden_id', m.orden_id, 'mesa_id', m.mesa_id, 'tipo', m.tipo, 'monto', m.monto,
                                               'hecho_por', m.hecho_por, 'hecho_en', m.hecho_en) order by m.hecho_en), '[]'::jsonb)
    into v_deshechos from marcados m;

  return jsonb_build_object('ok', true, 'repetido', false, 'borradas', v_borradas, 'deshechos', v_deshechos);
end;
$function$;

comment on function public.cerrar_dia(text, timestamp with time zone, numeric, jsonb, jsonb) is
  'El cierre del día, atómico y solo para el admin: revisa que cada venta siga cerrada con la version que el POS vio y que no haya cuentas abiertas; guarda el cierre, borra las órdenes que archiva y marca los deshechos del turno con el id del cierre. Nunca borra una cuenta abierta. Si algo cambió, no hace nada y dice qué.';

revoke all on function public.cerrar_dia(text, timestamp with time zone, numeric, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.cerrar_dia(text, timestamp with time zone, numeric, jsonb, jsonb) to authenticated;

-- ── 4. Los registros de `deshechos` viven 90 días ───────────
-- Disparador de SENTENCIA al guardar un cierre del día (el POS lo hace con upsert: INSERT … ON CONFLICT). La función corre
-- como su dueño: nadie gana permiso de DELETE sobre `deshechos`.

create or replace function public.purgar_deshechos_viejos()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  delete from public.deshechos where hecho_en < now() - interval '90 days';
  return null;
end;
$function$;

revoke all on function public.purgar_deshechos_viejos() from public, anon, authenticated;

drop trigger if exists trg_cierres_purga_deshechos on public.cierres;
create trigger trg_cierres_purga_deshechos
  after insert on public.cierres
  for each statement
  execute function public.purgar_deshechos_viejos();

-- ── 5. D28: las alertas viejas se borran solas ──────────────
-- Disparadores de SENTENCIA (una sola pasada por operación, sin importar cuántas filas toque). La función corre
-- como su dueño (SECURITY DEFINER): ni el POS ni service_role ganan permiso de DELETE sobre `alertas`.

create or replace function public.purgar_alertas_viejas()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  delete from public.alertas
   where estado <> 'pendiente'
     and atendida_en < now() - interval '1 day';
  return null;
end;
$function$;

revoke all on function public.purgar_alertas_viejas() from public, anon, authenticated;

drop trigger if exists trg_alertas_nueva_purga on public.alertas;
create trigger trg_alertas_nueva_purga
  after insert on public.alertas
  for each statement
  execute function public.purgar_alertas_viejas();

drop trigger if exists trg_alertas_resuelta_purga on public.alertas;
create trigger trg_alertas_resuelta_purga
  after update of estado on public.alertas
  for each statement
  execute function public.purgar_alertas_viejas();

drop trigger if exists trg_cierres_purga_alertas on public.cierres;
create trigger trg_cierres_purga_alertas
  after insert on public.cierres
  for each statement
  execute function public.purgar_alertas_viejas();
