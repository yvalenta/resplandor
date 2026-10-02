-- ════════════════════════════════════════════════════════════
-- Carta: una nota corta («etiqueta») y el día de la semana en `productos`, expuestos en `carta_publica`
-- (pedido de Yonatan, 2026-10-01: «Sopa y carne» incluye jugo, el sancocho trifásico solo algunos fines de
-- semana, las promociones de cada día; la carta y la landing las muestran).
--
-- QUÉ HACE
--   1. `productos.etiqueta` text null, de 1 a 40 caracteres: una nota corta y sutil que la carta pinta
--      como una pastilla pequeña («Incluye jugo», «Algunos fines de semana», «2 x 1», «20% OFF»).
--      Una promoción de descuento no tiene precio propio: va con precio 0 y su etiqueta, y la carta
--      muestra la etiqueta en lugar de «$0».
--   2. `productos.dia_semana` smallint null, de 1 a 7 (1 = lunes … 7 = domingo): solo lo usan las
--      promociones de la categoría «Promociones»; el resto de los productos lo deja en null. No se
--      amarra a la categoría con un check a propósito: el POS puede cambiar la categoría de un producto
--      y un check así le haría fallar el guardado en la tablet.
--   3. `carta_publica` se vuelve a crear con DOS columnas más AL FINAL (etiqueta, dia_semana). Todo lo
--      demás queda igual que en 20260906120000_carta_publica_y_token_mesa.sql: SECURITY DEFINER a
--      propósito (`anon` no tiene policies sobre `productos`), mismas filas (`activo and en_carta`),
--      mismos grants (select a anon y authenticated, nada más). `anon` sigue sin poder leer
--      `productos`: lo único nuevo que ve es el texto de esas dos columnas de las filas ya visibles.
--
-- Las categorías nuevas («Desayunos», «Promociones») NO son esquema: son datos (`productos.categoria` es
-- texto libre). Los cambios de datos van aparte, en el sobre de datos de Yonatan (no en una migración).
--
-- EL POS NO SE ENTERA. `pos.html` lee `productos` con select('*') y `parseProducto` ignora lo que no
-- conoce; al guardar hace upsert de siete columnas (id, categoria, nombre, precio, descripcion, activo,
-- updated_at; `formatProducto`), así que NO pisa `etiqueta` ni `dia_semana` (un upsert solo actualiza
-- las columnas que manda). Los GRANT de `productos` son de tabla entera: `authenticated` y `service_role`
-- ya cubren las columnas nuevas y no hay GRANT que agregar. La publicación de Realtime es de tabla
-- entera: tampoco cambia.
--
-- ORDEN. Aplicar ESTA migración ANTES de publicar la carta.html que pide `etiqueta,dia_semana` a la vista:
-- sin las columnas, PostgREST contesta 400 y la carta cae a su copia de respaldo. Aplicarla antes del
-- código es inocua: la carta de hoy pide cuatro columnas y las sigue recibiendo igual. El sobre de datos
-- (las promociones, la etiqueta de «Sopa y carne», etc.) se corre DESPUÉS de publicar la carta nueva:
-- la carta de hoy mostraría las promociones de descuento como «$0».
--
-- Idempotente (add column if not exists, constraints solo si faltan, create or replace view). Se detiene
-- sin cambiar nada si falta `productos.en_carta` (20260906120000). Lo aplica Yonatan en el SQL Editor
-- (Línea Roja: un agente no aplica migraciones); entera, dentro de begin … commit.
--
-- Reversa (< 1 min). Primero se revierte el commit de carta.html (si la carta ya pide las columnas, al
-- quitarlas recibe 400). Después, en el SQL Editor:
--   begin;
--   drop view if exists public.carta_publica;
--   create view public.carta_publica with (security_invoker = false) as
--     select categoria, nombre, precio, descripcion from public.productos where activo and en_carta;
--   comment on view public.carta_publica is 'Lo que la carta NFC puede leer sin sesión. SECURITY DEFINER a propósito: anon no tiene policies sobre productos.';
--   revoke all on public.carta_publica from anon, authenticated;
--   grant select on public.carta_publica to anon, authenticated;
--   alter table public.productos drop constraint if exists productos_etiqueta_valida;
--   alter table public.productos drop constraint if exists productos_dia_semana_valido;
--   alter table public.productos drop column if exists etiqueta;
--   alter table public.productos drop column if exists dia_semana;
--   notify pgrst, 'reload schema';
--   commit;
-- (Quitar las columnas borra las etiquetas y los días que ya se hayan cargado: el sobre de datos los
-- vuelve a poner si se reaplica la migración.)
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisito ────────────────────────────────────────────

do $$
begin
  if to_regclass('public.productos') is null
     or not exists (select 1 from pg_attribute
                     where attrelid = 'public.productos'::regclass and attname = 'en_carta'
                       and attnum > 0 and not attisdropped) then
    raise exception 'Falta 20260906120000_carta_publica_y_token_mesa.sql (productos.en_carta): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. Las dos columnas ─────────────────────────────────────

alter table public.productos
  add column if not exists etiqueta text,
  add column if not exists dia_semana smallint;

-- Los checks por separado y solo si faltan: `add column if not exists … check (…)` se saltaría el check
-- cuando la columna ya existe, y una corrida a medias lo dejaría sin él. Una etiqueta vacía o de puros
-- espacios se rechaza (la carta pintaría una pastilla en blanco); null es «sin etiqueta».
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.productos'::regclass and conname = 'productos_etiqueta_valida') then
    alter table public.productos
      add constraint productos_etiqueta_valida
      check (char_length(etiqueta) <= 40 and btrim(etiqueta) <> '');
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.productos'::regclass and conname = 'productos_dia_semana_valido') then
    alter table public.productos
      add constraint productos_dia_semana_valido
      check (dia_semana between 1 and 7);
  end if;
end $$;

comment on column public.productos.etiqueta is
  'Nota corta y sutil (1 a 40 caracteres) que la carta pública pinta como pastilla: «Incluye jugo», «Algunos fines de semana», «2 x 1», «20% OFF». Null = sin nota. El POS no la maneja: se carga por SQL.';
comment on column public.productos.dia_semana is
  'Solo para las promociones (categoría «Promociones»): 1 = lunes … 7 = domingo. Null en el resto de los productos. El POS no la maneja: se carga por SQL.';

-- ── 2. La carta pública, con las dos columnas nuevas AL FINAL ───────────────
-- (create or replace view solo admite columnas nuevas después de las que ya tiene.)

create or replace view public.carta_publica
  with (security_invoker = false) as
  select categoria, nombre, precio, descripcion, etiqueta, dia_semana
    from public.productos
   where activo and en_carta;

comment on view public.carta_publica is
  'Lo que la carta NFC puede leer sin sesión. SECURITY DEFINER a propósito: anon no tiene policies sobre productos.';

revoke all on public.carta_publica from anon, authenticated;
grant select on public.carta_publica to anon, authenticated;

-- PostgREST recarga su caché de esquema solo con los DDL, pero avisarle no cuesta nada.
notify pgrst, 'reload schema';
