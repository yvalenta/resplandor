-- ════════════════════════════════════════════════════════════
-- Resplandor — la alerta «pide la cuenta» SIN método: la carta avisa al abrir «Pagar», sin que el cliente elija nada
-- (pedido de Yonatan, 2026-10-04, tareas/2026-10-04-hallazgos-domingo.md: «podemos simplificar esta pantalla y evitar esos 3 tabs,
-- demos la información de las 3 cosas en esa misma; evitemos depender de inputs del usuario… la menor interacción posible»)
--
-- QUÉ HACE
--   La hoja «Pagar» de carta.html ya no pregunta «¿Cómo quieres pagar?»: muestra de una vez el QR de Bre-B, la llave, el valor,
--   el comprobante por WhatsApp y «o en efectivo». Al abrirla, la carta avisa al mesero con el método `cuenta` («pide la cuenta»,
--   todavía sin método); si después copia la llave o abre el comprobante, la misma alerta pasa a `transferencia` (el UPSERT de
--   `alertar_cuenta` ya cambia el método de la alerta pendiente). Por eso:
--     1. el CHECK `alertas_metodo_check` admite `cuenta` además de qr, transferencia y efectivo;
--     2. `public.alertar_cuenta` acepta `cuenta` (misma firma, mismo cuerpo que 20261002160000; solo cambia la lista).
--   La Edge Function `alerta` (supabase/functions/alerta/logica.ts, METODOS) lleva la misma lista: desplegarla con esta migración.
--   El POS muestra «Pide la cuenta» a secas cuando el método es `cuenta` (en vez de «Paga con …»).
--
-- No cambia ninguna policy ni ningún permiso. Idempotente. Necesita 20261002160000_mesas_y_pegatinas.sql (la versión de
-- `alertar_cuenta` que exige `mesas.activa`); si falta, se niega a correr SIN cambiar nada.
--
-- REVERSA (menos de 1 minuto; antes de volver al CHECK viejo, las alertas pendientes con `cuenta` pasan a `efectivo`, que es lo
-- que el mesero haría de todos modos: pasar por la mesa):
--   begin;
--   update public.alertas set metodo = 'efectivo' where metodo = 'cuenta';
--   alter table public.alertas drop constraint if exists alertas_metodo_check;
--   alter table public.alertas add constraint alertas_metodo_check
--     check ((metodo = any (array['qr'::text, 'transferencia'::text, 'efectivo'::text])));
--   -- y volver a crear public.alertar_cuenta con la lista de tres (el cuerpo de 20261002160000_mesas_y_pegatinas.sql).
--   commit;
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Orden de salida al aire: 1) esta migración, 2) desplegar `alerta`,
-- 3) push de la carta y el POS.
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regclass('public.alertas') is null or to_regprocedure('public.alertar_cuenta(integer, text, text)') is null then
    raise exception 'Falta 20261002130000_alertas.sql (alertas, alertar_cuenta): aplicala primero. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'mesas' and column_name = 'activa') then
    raise exception 'Falta 20261002160000_mesas_y_pegatinas.sql (mesas.activa): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. El CHECK ─────────────────────────────────────────────

alter table public.alertas drop constraint if exists alertas_metodo_check;
alter table public.alertas add constraint alertas_metodo_check
  check ((metodo = any (array['qr'::text, 'transferencia'::text, 'efectivo'::text, 'cuenta'::text])));

-- ── 2. La función ───────────────────────────────────────────

create or replace function public.alertar_cuenta(p_mesa integer, p_token text, p_metodo text)
 returns jsonb
 language plpgsql
 set search_path = ''
as $function$
declare
  v_orden text;
  a public.alertas;
begin
  if p_metodo is null or p_metodo <> all (array['qr', 'transferencia', 'efectivo', 'cuenta']) then
    return jsonb_build_object('ok', false, 'codigo', 'metodo_invalido');
  end if;

  if p_mesa is null or p_token is null
     or not exists (select 1 from public.mesas m where m.id = p_mesa and m.token = p_token and m.activa) then
    return jsonb_build_object('ok', false, 'codigo', 'enlace_invalido');
  end if;

  select o.id into v_orden
    from public.ordenes o
   where o.mesa_id = p_mesa
     and o.estado = 'abierta'
   order by o.abierta_en desc
   limit 1
     for share;
  if v_orden is null then
    return jsonb_build_object('ok', false, 'codigo', 'sin_cuenta');
  end if;

  if not exists (select 1 from public.alertas x where x.mesa_id = p_mesa and x.estado = 'pendiente')
     and (select count(*) from public.alertas x where x.orden_id = v_orden) >= 5 then
    return jsonb_build_object('ok', false, 'codigo', 'tope');
  end if;

  insert into public.alertas as t (mesa_id, orden_id, tipo, metodo)
  values (p_mesa, v_orden, 'pedir_cuenta', p_metodo)
  on conflict (mesa_id) where (estado = 'pendiente')
  do update set metodo = excluded.metodo, orden_id = excluded.orden_id, creada_en = now()
     where t.metodo is distinct from excluded.metodo
        or t.orden_id is distinct from excluded.orden_id
  returning * into a;

  if not found then
    select * into a from public.alertas where mesa_id = p_mesa and estado = 'pendiente';
  end if;

  return jsonb_build_object('ok', true, 'metodo', a.metodo, 'creada_en', a.creada_en,
                            'alerta_id', a.id, 'orden_id', a.orden_id);
end;
$function$;

revoke all on function public.alertar_cuenta(integer, text, text) from public, anon, authenticated;
grant execute on function public.alertar_cuenta(integer, text, text) to service_role;

-- ── 3. Comprobación ─────────────────────────────────────────

do $$
begin
  if (public.alertar_cuenta(null, null, 'cuenta') ->> 'codigo') is distinct from 'enlace_invalido' then
    raise exception 'alertar_cuenta no acepta el método cuenta';
  end if;
  if (public.alertar_cuenta(null, null, 'tarjeta') ->> 'codigo') is distinct from 'metodo_invalido' then
    raise exception 'alertar_cuenta dejó de rechazar un método desconocido';
  end if;
end $$;
