-- ════════════════════════════════════════════════════════════
-- Resplandor — el TICKET CONFIGURABLE desde el panel de admin (3 de 4 de la ola C)
-- (pedido de Yonatan, 2026-09-30: «código de barras parametrizable en el panel de admin porque puede cambiar
-- el dominio»)
--
--   1. 20261002150000_aprobacion_personal.sql      quién entra, con aprobación.
--   2. 20261002160000_mesas_y_pegatinas.sql        mesas activas y pegatinas NFC.
--   3. 20261002170000_ajustes_ticket.sql        ← ESTA.
--   4. 20261002180000_deshacer_cobro.sql           devolver un cobro parcial o un abono a la cuenta.
--
-- Qué hace
--   `public.ajustes`: UNA fila (id = 1, lo exige un CHECK) con lo que el POS imprime al pie del ticket:
--     ticket_qr_url      text     URL del QR (https://…, hasta 200 caracteres después de «https://»; por defecto
--                                  https://resplandor.ynt.codes/). El POS dibuja el QR en el navegador.
--     ticket_qr_visible  boolean  si el ticket lleva el QR (por defecto true).
--     ticket_pie         text     la línea de despedida (hasta 120 caracteres; por defecto «Gracias por su visita»).
--     actualizado_en, actualizado_por   los sella un disparador (no se pueden falsear desde el POS).
--   Un segundo CHECK rechaza en la URL los caracteres que nunca son válidos sin escapar y que molestarían a
--   cualquier plantilla que la pinte: < > " ` \  (además de los espacios, que ya rechaza el primero).
--
--   acción                       | admin | mesero | pendiente / ajeno | anon
--   -----------------------------+-------+--------+--------------------+------
--   ajustes  ver                 |  sí   |  sí    |  no                |  no
--   ajustes  editar (UPDATE)     |  sí   |  no    |  no                |  no
--   ajustes  insertar / borrar   |  no   |  no    |  no                |  no   (la fila 1 la crea la migración)
--
-- Necesita la compuerta (mi_rol()) y, para que «aprobado» valga, 20261002150000; si falta la compuerta se niega
-- a correr SIN cambiar nada. Idempotente: volver a correrla no pisa lo que el admin ya configuró.
--
-- REVERSA (menos de 1 minuto; borra la tabla y el POS vuelve a los valores por defecto):
--
--   begin;
--   drop table if exists public.ajustes;
--   drop function if exists public.ajustes_sellar();
--   commit;
--
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisito: la compuerta de personal ───────────────────

do $$
begin
  if to_regclass('public.personal') is null or to_regprocedure('public.mi_rol()') is null
     or to_regprocedure('public.mi_correo()') is null then
    raise exception 'Falta 20261002120000_personal_y_compuerta.sql (personal, mi_correo() y mi_rol()): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. La tabla (una sola fila) ─────────────────────────────

create table if not exists public.ajustes (
  id smallint not null,
  ticket_qr_url text not null default 'https://resplandor.ynt.codes/'::text,
  ticket_qr_visible boolean not null default true,
  ticket_pie text not null default 'Gracias por su visita'::text,
  actualizado_en timestamp with time zone not null default now(),
  actualizado_por text,
  constraint ajustes_pkey primary key (id),
  constraint ajustes_una_sola_fila check ((id = 1)),
  constraint ajustes_ticket_qr_url_check check ((ticket_qr_url ~ '^https://[^\s]{3,200}$'::text)),
  constraint ajustes_ticket_qr_url_segura check ((ticket_qr_url !~ '[<>"`\\]'::text)),
  constraint ajustes_ticket_pie_check check ((length(ticket_pie) <= 120))
);

comment on table public.ajustes is
  'Ajustes del POS que cambia el admin. UNA fila (id = 1). Hoy: el pie del ticket (URL del QR, si se ve, línea de despedida). La lee el personal aprobado, la edita solo el admin; nadie inserta ni borra.';

insert into public.ajustes (id) values (1) on conflict (id) do nothing;

-- Sella quién y cuándo. Una sesión de la API firma con su correo (mi_correo()); el dueño en el SQL Editor y
-- service_role, con 'sistema'. Lo que el POS mande en esas dos columnas se ignora.
create or replace function public.ajustes_sellar()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  new.actualizado_en := now();
  new.actualizado_por := case when current_user in ('anon', 'authenticated')
                              then (select public.mi_correo()) else 'sistema' end;
  return new;
end;
$function$;

drop trigger if exists trg_ajustes_sellar on public.ajustes;
create trigger trg_ajustes_sellar
  before update on public.ajustes
  for each row
  execute function public.ajustes_sellar();

-- ── 2. Quién la ve, quién la edita, y la compuerta ──────────

alter table public.ajustes enable row level security;

drop policy if exists ajustes_ver on public.ajustes;
create policy ajustes_ver on public.ajustes for select to authenticated
  using ((select public.mi_rol()) is not null);

drop policy if exists ajustes_editar on public.ajustes;
create policy ajustes_editar on public.ajustes for update to authenticated
  using ((select public.mi_rol()) = 'admin')
  with check ((select public.mi_rol()) = 'admin');

-- La misma compuerta que las demás tablas del POS (restrictiva: Google Y personal aprobado).
drop policy if exists solo_personal on public.ajustes;
create policy solo_personal on public.ajustes as restrictive for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' and (select public.mi_rol()) is not null)
  with check ((select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' and (select public.mi_rol()) is not null);

-- ── 3. Permisos (GRANT explícitos: el proyecto no da permisos automáticos) ──
-- UPDATE de toda la tabla: lo que importa lo decide la policy (solo admin) y el CHECK id = 1; las columnas de
-- sello las pisa el disparador. Sin INSERT ni DELETE para nadie de la API.

revoke all on public.ajustes from anon, authenticated, service_role;
grant select, update on public.ajustes to authenticated;

revoke all on function public.ajustes_sellar() from public, anon, authenticated;
