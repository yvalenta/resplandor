-- ════════════════════════════════════════════════════════════
-- Carta NFC — peldaños 1 y 2 (tarea tareas/2026-09-06-carta-nfc-y-cuenta.md)
--
-- 1. `carta_publica`: la ÚNICA superficie de `productos` que ve `anon`.
--    Las 4 tablas del POS siguen authenticated-only (README §07/§11); la
--    vista es SECURITY DEFINER a propósito —misma decisión deliberada que
--    las policies de SELECT anon en `menus`— y expone solo 4 columnas de
--    las filas marcadas `en_carta`. El advisor de Supabase la va a listar
--    como "security_definer_view": es el diseño, no un descuido.
-- 2. `mesas.token`: secreto por mesa para la pegatina NFC. La carta manda
--    `?m=<mesa>&k=<token>` a la Edge Function `cuenta`, que valida el par
--    con service-role y devuelve SOLO la orden abierta. `anon` sigue sin
--    poder leer `mesas` ni `ordenes`.
--
-- Idempotente. Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

-- ── 1. Carta pública ────────────────────────────────────────

alter table public.productos
  add column if not exists en_carta boolean not null default false;

comment on column public.productos.en_carta is
  'Sale en la carta pública (carta.html). Los atajos de caja (p.ej. el "Juguito") quedan en false.';

-- Backfill inicial: todo lo activo va a la carta salvo el atajo de caja
-- `Jugo · "Juguito" · $2.000` (medido 3-sep-2026: 31 filas, todas activas).
update public.productos
   set en_carta = true
 where not (nombre ilike 'jug%' and precio <= 2000);

create or replace view public.carta_publica
  with (security_invoker = false) as
  select categoria, nombre, precio, descripcion
    from public.productos
   where activo and en_carta;

comment on view public.carta_publica is
  'Lo que la carta NFC puede leer sin sesión. SECURITY DEFINER a propósito: anon no tiene policies sobre productos.';

revoke all on public.carta_publica from anon, authenticated;
grant select on public.carta_publica to anon, authenticated;

-- ── 2. Token por mesa ───────────────────────────────────────

create extension if not exists pgcrypto with schema extensions;

alter table public.mesas
  add column if not exists token text;

update public.mesas
   set token = encode(gen_random_bytes(24), 'hex')
 where token is null;

alter table public.mesas
  alter column token set not null,
  alter column token set default encode(gen_random_bytes(24), 'hex');

create unique index if not exists mesas_token_unico on public.mesas (token);

comment on column public.mesas.token is
  'Secreto de la pegatina NFC (48 hex). El POS lo rota desde la vista de la mesa; la Edge Function `cuenta` lo valida.';
