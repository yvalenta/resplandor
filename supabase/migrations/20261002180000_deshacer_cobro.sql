-- ════════════════════════════════════════════════════════════
-- Resplandor — DESHACER UN COBRO PARCIAL, «tipo ctrl+z» (4 de 4 de la ola C)
-- (pedido de Yonatan, 2026-09-30: «si pagué una parte de una cuenta y la quiero deshacer, si ese pago fue de esa
-- mesa se debería poder editar y devolver a la mesa, por ende recalcular»; decisión D28 de las alertas)
--
--   1. 20261002150000_aprobacion_personal.sql      quién entra, con aprobación.
--   2. 20261002160000_mesas_y_pegatinas.sql        mesas activas y pegatinas NFC.
--   3. 20261002170000_ajustes_ticket.sql           la URL del QR y el pie del ticket.
--   4. 20261002180000_deshacer_cobro.sql        ← ESTA.
--
-- Qué hace
--   1. `ordenes.parcial_de` (text, null): el id de la orden ABIERTA de la que salió esta orden cerrada, cuando es
--      un cobro parcial (por ítems o por unidades: facturarParcial) o un abono (cobrarMonto). El POS lo escribe al
--      crear la orden cerrada. No es clave foránea a propósito: el cierre del día borra órdenes y no debe fallar.
--   2. `deshacer_cobro(p_orden_id)`: devuelve a la cuenta abierta lo que se cobró y borra la orden cerrada, TODO en
--      una transacción con candado sobre las dos órdenes:
--        · un cobro por ítems o por unidades: cada ítem de la orden cerrada vuelve a la abierta con su mismo id,
--          nombre, precio y nota (qty se SUMA a la línea si todavía existe; si ya no, la línea se vuelve a crear);
--        · un abono (la orden cerrada trae un ítem `abono_<uid>`): se quita de la abierta la línea
--          «Abono recibido» cuyo id es `abono_recibido_<uid>`; no se devuelve ningún ítem;
--        · se recalcula `total` (Σ precio × qty) y se sube `version` de la abierta. La señal en vivo de la carta
--          sale sola: el UPDATE de la orden abierta dispara `ordenes_emite_cuenta` (20261001120000), y el DELETE de
--          la cerrada no emite (el disparador solo mira lo que estaba o queda abierto). Una sola señal.
--      Quién puede: el admin siempre; el mesero solo si la orden se cerró hace menos de 10 minutos
--      (`cerrada_en`); quien no tiene rol, nada. Es SECURITY DEFINER porque el mesero no puede editar ni borrar una
--      orden cerrada (RLS de la ola B): la regla de los 10 minutos vive aquí, no en una policy.
--      Devuelve jsonb:
--        {ok: true, total_abierta, orden_id (la abierta), mesa_id, monto (lo que se devolvió), version}
--        {ok: false, codigo}  con codigo =
--          no_autorizado    sin rol (pendiente, eliminado, ajena)
--          no_existe        no hay esa orden (también: ya se deshizo; un doble toque cae aquí la segunda vez)
--          no_es_parcial    la orden no está cerrada o no es un cobro parcial (no trae parcial_de)
--          cuenta_ya_cerrada  la cuenta de la que salió ya no está abierta (se cobró, se borró o se purgó)
--          ventana_vencida  mesero, y pasaron los 10 minutos
--   3. D28 de las alertas (privacidad: `alertas.atendida_por` guarda el correo de quien atendió): las alertas que
--      ya no están pendientes y se resolvieron hace MÁS DE UN DÍA se borran solas. Un disparador de sentencia llama
--      a `purgar_alertas_viejas()` en tres momentos: al crear una alerta (la carta), al resolver una (atender,
--      descartar o cerrar la mesa) y al guardar un cierre del día. Así no hace falta darle a nadie permiso de
--      DELETE sobre `alertas`. Lo que `privacy.html` puede decir con verdad: «los avisos ya atendidos o
--      descartados se borran cuando pasa más de un día, la siguiente vez que se crea o se atiende un aviso o se
--      cierra el día». Las pendientes no se borran (sin cierre ni mesa liberada, una pendiente sigue pendiente).
--
--   acción                       | admin | mesero             | pendiente / eliminado / ajeno | anon
--   -----------------------------+-------+--------------------+-------------------------------+------
--   deshacer_cobro               | sí, siempre | solo en los 10 min | no_autorizado           | no
--   ordenes.parcial_de           | lo escribe el POS al crear la cerrada (INSERT: lo permite ordenes_crear)
--
-- Necesita las alertas (20261002130000) y las policies por rol. Aplicarla antes del POS que la usa es inocuo.
--
-- REVERSA (menos de 1 minuto; el POS que escribe `parcial_de` debe volver atrás ANTES: sin la columna, el guardado
-- de un cobro parcial fallaría):
--
--   begin;
--   drop trigger if exists trg_cierres_purga_alertas on public.cierres;
--   drop trigger if exists trg_alertas_nueva_purga on public.alertas;
--   drop trigger if exists trg_alertas_resuelta_purga on public.alertas;
--   drop function if exists public.purgar_alertas_viejas();
--   drop function if exists public.deshacer_cobro(text);
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
end $$;

-- ── 1. El vínculo del cobro con su cuenta ───────────────────

alter table public.ordenes add column if not exists parcial_de text;

comment on column public.ordenes.parcial_de is
  'id de la orden ABIERTA de la que salió esta orden cerrada (cobro parcial por ítems o unidades, o abono). Lo escribe el POS al crearla; deshacer_cobro lo usa para devolverlo. Sin clave foránea: el cierre del día borra órdenes.';

-- ── 2. deshacer_cobro ───────────────────────────────────────
-- Candados en este orden: la orden cerrada, y después la abierta. Nadie más toma esas dos en el orden contrario
-- (el POS solo toca la abierta), así que no hay interbloqueo. Dos toques a la vez: el segundo espera, y cuando
-- obtiene el candado la cerrada ya no existe → no_existe.

create or replace function public.deshacer_cobro(p_orden_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  c public.ordenes;                 -- la orden cerrada: el cobro
  a public.ordenes;                 -- la orden abierta de la que salió
  v_items jsonb;
  it jsonb;
  v_total numeric;
begin
  if v_rol is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  select * into c from public.ordenes where id = p_orden_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  if c.estado <> 'cerrada' or c.parcial_de is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
  end if;

  select * into a from public.ordenes where id = c.parcial_de for update;
  if not found or a.estado <> 'abierta' then
    return jsonb_build_object('ok', false, 'codigo', 'cuenta_ya_cerrada');
  end if;

  -- El admin siempre; el mesero, solo dentro de los 10 minutos siguientes al cobro.
  if v_rol <> 'admin'
     and (c.cerrada_en is null or c.cerrada_en <= now() - interval '10 minutes') then
    return jsonb_build_object('ok', false, 'codigo', 'ventana_vencida');
  end if;

  v_items := a.items;
  for it in select e from jsonb_array_elements(c.items) e loop
    if (it ->> 'id') like 'abono\_%' then
      -- Un abono: «Abono recibido» (id abono_recibido_<uid>) sale de la cuenta; el ítem `abono_<uid>` no vuelve.
      v_items := coalesce((
        select jsonb_agg(x.e order by x.n)
          from jsonb_array_elements(v_items) with ordinality as x(e, n)
         where x.e ->> 'id' is distinct from 'abono_recibido_' || substr(it ->> 'id', 7)
      ), '[]'::jsonb);
    elsif coalesce((it ->> 'qty')::int, 0) > 0 then
      if exists (select 1 from jsonb_array_elements(v_items) x where x ->> 'id' = it ->> 'id') then
        -- La línea sigue en la cuenta: se le suman las unidades (el resto de sus campos no se toca).
        v_items := (
          select jsonb_agg(case when x.e ->> 'id' = it ->> 'id'
                                then jsonb_set(x.e, '{qty}', to_jsonb((x.e ->> 'qty')::int + (it ->> 'qty')::int))
                                else x.e end order by x.n)
            from jsonb_array_elements(v_items) with ordinality as x(e, n)
        );
      else
        -- La línea se había cobrado entera: vuelve tal cual salió (id, nombre, precio, qty, nota).
        v_items := v_items || jsonb_build_array(it);
      end if;
    end if;
  end loop;

  select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0)
    into v_total
    from jsonb_array_elements(v_items) e;

  update public.ordenes
     set items = v_items,
         total = v_total,
         version = coalesce(a.version, 0) + 1,
         updated_at = now()
   where id = a.id
  returning * into a;

  delete from public.ordenes where id = c.id;

  return jsonb_build_object('ok', true, 'total_abierta', a.total, 'orden_id', a.id, 'mesa_id', a.mesa_id,
                            'monto', c.total, 'version', a.version);
end;
$function$;

comment on function public.deshacer_cobro(text) is
  'Deshace un cobro parcial o un abono: devuelve sus ítems a la orden abierta de la que salió (o quita la línea «Abono recibido»), recalcula, y borra la orden cerrada. Admin siempre; mesero solo en los 10 minutos siguientes al cobro.';

revoke all on function public.deshacer_cobro(text) from public, anon, service_role;
grant execute on function public.deshacer_cobro(text) to authenticated;

-- ── 3. D28: las alertas viejas se borran solas ──────────────
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
