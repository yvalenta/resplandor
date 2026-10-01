-- ════════════════════════════════════════════════════════════
-- Resplandor — las ALERTAS de «pedir la cuenta» (2 de 3 de «roles y alertas»)
-- (pedido de Yonatan, 2026-09-30; SDD v0.3 §03.3, §03.4 y §04.5)
--
--   1. 20261002120000_personal_y_compuerta.sql      quién entra al POS (sale primero).
--   2. 20261002130000_alertas.sql                ← ESTA.
--   3. 20261002140000_permisos_por_rol.sql          qué puede hacer cada rol por tabla.
--
-- Qué hace
--   1. `public.alertas`: el cliente elige cómo pagar (qr | transferencia | efectivo)
--      y eso CREA UNA ALERTA para el personal. La página no muestra datos bancarios
--      ni QR; el mesero cobra y cierra en el POS.
--   2. Una sola alerta pendiente por mesa (índice único parcial): un segundo toque
--      con OTRO método actualiza el método y la hora; con el MISMO método no escribe
--      nada (no mueve la hora: la mesa no pierde su lugar en la fila ni suenan otra
--      vez todas las tablets). Tope de 5 alertas por orden (D31): la sexta responde
--      `tope`.
--   3. Dos disparadores sobre `ordenes`: cerrar la mesa (abierta → cerrada) atiende
--      la alerta pendiente; liberar una mesa vacía (borrar la orden abierta) la
--      descarta. Sin esto el panel seguiría mostrando «mesa 5 pidió la cuenta» con
--      la mesa ya libre.
--   4. RLS: el personal las ve (y Realtime se las entrega); `alertas` entra a la
--      publicación supabase_realtime y a la compuerta `solo_personal`. Nadie
--      escribe directo: crea service_role (Edge Function `alerta`) y atienden las RPC.
--   5. RPC para el POS: atender_alerta y descartar_alerta. Y una para la Edge
--      Function `alerta` (solo service_role): alertar_cuenta.
--
-- Necesita la primera (mi_rol(), mi_correo(), la tabla personal): si falta, se
-- niega a correr SIN cambiar nada. No cambia los permisos de ninguna tabla del POS
-- ni a nadie le quita acceso; solo agrega una tabla, dos disparadores y funciones.
--
--   tabla / acción        | admin | mesero | otra cuenta Google | correo | anon
--   ----------------------+-------+--------+--------------------+--------+------
--   alertas  ver y atender|  sí   |  sí    |  no                |  no    |  no
--   alertas  crear        | solo service_role (función `alerta`, RPC alertar_cuenta)
--
-- Salida al aire: aplicarla cuando quieras (no cambia nada visible para el POS de
-- hoy); la función se despliega DESPUÉS, porque llama a public.alertar_cuenta:
--     supabase functions deploy alerta --no-verify-jwt --project-ref lccgehvyymladqvumcez
-- y la carta no muestra «Pagar» hasta que esté el POS que oye las alertas.
--
-- REVERSA (menos de 1 minuto; quita todo lo de este archivo):
--
--   begin;
--   drop trigger if exists trg_ordenes_cierre_resuelve_alertas on public.ordenes;
--   drop trigger if exists trg_ordenes_borrada_resuelve_alertas on public.ordenes;
--   alter publication supabase_realtime drop table public.alertas;
--   drop table public.alertas;
--   drop function public.alertar_cuenta(integer, text, text), public.atender_alerta(uuid),
--     public.descartar_alerta(uuid), public.resolver_alerta(uuid, text),
--     public.resolver_alertas_de_mesa();
--   commit;
--
-- Idempotente donde se puede. Correr en Supabase → SQL Editor (lo aplica Yonatan:
-- aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisito: la compuerta de personal ───────────────────

do $$
begin
  if to_regclass('public.personal') is null
     or to_regprocedure('public.mi_rol()') is null
     or to_regprocedure('public.mi_correo()') is null then
    raise exception 'Falta 20261002120000_personal_y_compuerta.sql (personal, mi_rol() y mi_correo()): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. Alertas ──────────────────────────────────────────────

create table if not exists public.alertas (
  id uuid not null default gen_random_uuid(),
  mesa_id integer not null,
  orden_id text,
  tipo text not null default 'pedir_cuenta'::text,
  metodo text not null,
  estado text not null default 'pendiente'::text,
  creada_en timestamp with time zone not null default now(),
  atendida_en timestamp with time zone,
  atendida_por text,
  constraint alertas_pkey primary key (id),
  constraint alertas_tipo_check check ((tipo = 'pedir_cuenta'::text)),
  constraint alertas_metodo_check check ((metodo = any (array['qr'::text, 'transferencia'::text, 'efectivo'::text]))),
  constraint alertas_estado_check check ((estado = any (array['pendiente'::text, 'atendida'::text, 'descartada'::text]))),
  -- Una alerta pendiente no tiene resolución, y una resuelta siempre la tiene.
  constraint alertas_resolucion_check check (((estado = 'pendiente'::text) = (atendida_en is null))),
  constraint alertas_mesa_id_fkey foreign key (mesa_id) references public.mesas(id),
  constraint alertas_orden_id_fkey foreign key (orden_id) references public.ordenes(id) on delete set null
);

comment on table public.alertas is
  'Avisos al personal desde la carta NFC. Hoy un solo tipo: pedir_cuenta con el método elegido (qr | transferencia | efectivo). Una sola pendiente por mesa (ux_alertas_una_pendiente_por_mesa). Se crea SOLO con alertar_cuenta (Edge Function `alerta`, service_role); el POS la atiende con atender_alerta / descartar_alerta. En atendida/descartada, atendida_en y atendida_por dicen cuándo y quién (o «sistema» si se resolvió sola al cerrar o liberar la mesa).';

-- Una sola pendiente por mesa: un segundo toque actualiza método y hora.
create unique index if not exists ux_alertas_una_pendiente_por_mesa
  on public.alertas using btree (mesa_id) where (estado = 'pendiente'::text);
create index if not exists idx_alertas_mesa on public.alertas using btree (mesa_id, creada_en desc);
create index if not exists idx_alertas_orden on public.alertas using btree (orden_id);

alter table public.alertas enable row level security;

-- Al cerrar la mesa (orden abierta → cerrada) la alerta se da por atendida; si
-- la orden abierta se borra (liberar mesa vacía) se descarta.
create or replace function public.resolver_alertas_de_mesa()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  update public.alertas
     set estado = case when tg_op = 'DELETE' then 'descartada' else 'atendida' end,
         atendida_en = now(),
         atendida_por = coalesce((select public.mi_correo()), 'sistema')
   where mesa_id = old.mesa_id
     and estado = 'pendiente';
  return null;
end;
$function$;

drop trigger if exists trg_ordenes_cierre_resuelve_alertas on public.ordenes;
create trigger trg_ordenes_cierre_resuelve_alertas
  after update of estado on public.ordenes
  for each row
  when (old.estado = 'abierta' and new.estado = 'cerrada')
  execute function public.resolver_alertas_de_mesa();

drop trigger if exists trg_ordenes_borrada_resuelve_alertas on public.ordenes;
create trigger trg_ordenes_borrada_resuelve_alertas
  after delete on public.ordenes
  for each row
  when (old.estado = 'abierta')
  execute function public.resolver_alertas_de_mesa();

-- ── 2. Quién las ve y la compuerta ──────────────────────────
-- El personal las ve (y Realtime se las entrega). Sin policies de escritura:
-- crea service_role, atienden las RPC.

drop policy if exists alertas_ver on public.alertas;
create policy alertas_ver on public.alertas for select to authenticated
  using ((select public.mi_rol()) is not null);

-- La misma compuerta que las demás tablas del POS (restrictiva: Google Y personal).
drop policy if exists solo_google on public.alertas;
drop policy if exists solo_personal on public.alertas;
create policy solo_personal on public.alertas as restrictive for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' and (select public.mi_rol()) is not null)
  with check ((select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' and (select public.mi_rol()) is not null);

-- ── 3. Permisos (GRANT) ─────────────────────────────────────

revoke all on public.alertas from anon, authenticated, service_role;
grant select on public.alertas to authenticated;
-- La función `alerta` (service role) crea y actualiza; no borra.
grant select, insert, update on public.alertas to service_role;

-- ── 4. RPC ──────────────────────────────────────────────────
-- Todas devuelven jsonb {ok, codigo?, …} en vez de lanzar, como pedirá el POS:
--   ok:false codigo = no_autorizado | no_existe | no_pendiente |
--                     enlace_invalido | sin_cuenta | metodo_invalido | tope

-- Resuelve una alerta pendiente (uso interno de atender/descartar).
create or replace function public.resolver_alerta(p_id uuid, p_estado text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  a public.alertas;
begin
  if (select public.mi_rol()) is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  update public.alertas
     set estado = p_estado,
         atendida_en = now(),
         atendida_por = (select public.mi_correo())
   where id = p_id
     and estado = 'pendiente'
  returning * into a;
  if found then
    return jsonb_build_object('ok', true, 'alerta', to_jsonb(a));
  end if;

  select * into a from public.alertas where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  -- Otro mesero llegó primero: el POS lo trata como «ya atendida».
  return jsonb_build_object('ok', false, 'codigo', 'no_pendiente', 'estado', a.estado);
end;
$function$;

create or replace function public.atender_alerta(p_id uuid)
 returns jsonb
 language sql
 security definer
 set search_path = ''
as $function$
  select public.resolver_alerta(p_id, 'atendida')
$function$;

create or replace function public.descartar_alerta(p_id uuid)
 returns jsonb
 language sql
 security definer
 set search_path = ''
as $function$
  select public.resolver_alerta(p_id, 'descartada')
$function$;

-- Para la Edge Function `alerta` (service_role): valida el par (mesa, token),
-- exige una orden abierta y deja UNA alerta pendiente por mesa. Todo en una
-- sentencia atómica: dos toques a la vez no chocan con el índice único, el
-- segundo actualiza (solo si cambió el método) o devuelve la que hay.
-- SECURITY INVOKER: corre como service_role.
-- codigo = metodo_invalido | enlace_invalido | sin_cuenta | tope.
create or replace function public.alertar_cuenta(p_mesa integer, p_token text, p_metodo text)
 returns jsonb
 language plpgsql
 set search_path = ''
as $function$
declare
  v_orden text;
  a public.alertas;
begin
  if p_metodo is null or p_metodo <> all (array['qr', 'transferencia', 'efectivo']) then
    return jsonb_build_object('ok', false, 'codigo', 'metodo_invalido');
  end if;

  if p_mesa is null or p_token is null
     or not exists (select 1 from public.mesas m where m.id = p_mesa and m.token = p_token) then
    return jsonb_build_object('ok', false, 'codigo', 'enlace_invalido');
  end if;

  -- FOR SHARE: si el mesero cierra la mesa justo ahora, su UPDATE espera a que
  -- esta alerta exista y el disparador la resuelve; no queda una pendiente suelta.
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

  -- TOPE de 5 alertas por orden (SDD §03.1, D31), contando las atendidas y las descartadas: el mesero
  -- ya está avisado y «Descartar» no frena a quien guardó el enlace. Actualizar la pendiente que ya hay
  -- no suma una fila, así que no cuenta. (Si la orden se purga con el cierre del día, orden_id queda en
  -- null y el contador se va con ella.)
  if not exists (select 1 from public.alertas x where x.mesa_id = p_mesa and x.estado = 'pendiente')
     and (select count(*) from public.alertas x where x.orden_id = v_orden) >= 5 then
    return jsonb_build_object('ok', false, 'codigo', 'tope');
  end if;

  -- Un segundo toque con el MISMO método no escribe nada (el WHERE del DO UPDATE lo salta): no mueve
  -- `creada_en`, así la mesa no pierde su lugar en la fila «la más vieja primero» ni vuelven a sonar todas
  -- las tablets (refutación de la ola B, hallazgo 6). Con otro método sí actualiza método y hora.
  insert into public.alertas as t (mesa_id, orden_id, tipo, metodo)
  values (p_mesa, v_orden, 'pedir_cuenta', p_metodo)
  on conflict (mesa_id) where (estado = 'pendiente')
  do update set metodo = excluded.metodo, orden_id = excluded.orden_id, creada_en = now()
     where t.metodo is distinct from excluded.metodo
        or t.orden_id is distinct from excluded.orden_id
  returning * into a;

  if not found then
    -- ya había una pendiente igual: se devuelve tal cual está
    select * into a from public.alertas where mesa_id = p_mesa and estado = 'pendiente';
  end if;

  return jsonb_build_object('ok', true, 'metodo', a.metodo, 'creada_en', a.creada_en,
                            'alerta_id', a.id, 'orden_id', a.orden_id);
end;
$function$;

-- Quién puede ejecutar qué (por defecto Supabase da EXECUTE a anon).
revoke all on function public.resolver_alerta(uuid, text) from public, anon, authenticated;
revoke all on function public.atender_alerta(uuid) from public, anon;
revoke all on function public.descartar_alerta(uuid) from public, anon;
revoke all on function public.alertar_cuenta(integer, text, text) from public, anon, authenticated;
revoke all on function public.resolver_alertas_de_mesa() from public, anon, authenticated;
grant execute on function public.atender_alerta(uuid) to authenticated;
grant execute on function public.descartar_alerta(uuid) to authenticated;
grant execute on function public.alertar_cuenta(integer, text, text) to service_role;

-- ── 5. Realtime: el POS recibe las alertas al instante ──────
-- (la RLS de `alertas` decide quién las recibe: solo el personal).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alertas'
  ) then
    alter publication supabase_realtime add table public.alertas;
  end if;
end $$;
