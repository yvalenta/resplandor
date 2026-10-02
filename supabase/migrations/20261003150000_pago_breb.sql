-- ════════════════════════════════════════════════════════════
-- Resplandor — PAGAR CON BRE-B: la llave y el QR salen de la base, no del código
-- (pedido de Yonatan, 2026-10-02: «en la funcionalidad para pagar hazlo dinámico y si selecciona pagar, abrir QR de
-- Bre-B» y «ese botón, al convertirse en QR, también debe tener la opción de enviar comprobante al WhatsApp»)
--
-- Qué hace
--   `public.ajustes` (la fila única del admin, 20261002170000) gana tres columnas:
--     pago_breb_visible  boolean  si la carta muestra el pago con Bre-B (por defecto false: nada se ve hasta que el admin lo encienda).
--     pago_breb_llave    text     la llave Bre-B del local (null si no hay). 2 a 60 caracteres y una forma válida de llave:
--                                  alfanumérica «@…», número (5 a 20 dígitos), celular con +57 o correo. Sin espacios ni < > " ' ` \.
--     pago_breb_qr       text     el CONTENIDO del QR de Bre-B (un QR EMVCo, texto) tal como lo lee una app del banco (null si no hay).
--                                  20 a 700 caracteres, empieza por «000201», solo ASCII imprimible, campos TLV que cierran justo
--                                  al final con el campo 63 («6304» + CRC) y ese CRC tiene que ser el correcto (CRC-16/CCITT-FALSE).
--   Y un cuarto control: no se puede encender «visible» sin llave y sin QR (`ajustes_pago_breb_completo`): la carta nunca
--   muestra un pago a medias.
--
--   `privado.emv_crc_ok(text)`: la función (pura, sin leer tablas) que valida el contenido EMV: campos de primer nivel bien
--   formados, el último es el 63 con 4 caracteres hexadecimales y ese CRC coincide con el que se calcula sobre todo lo
--   anterior (incluido «6304»). Devuelve false (nunca falla) con cualquier otra cosa. La usa el CHECK `ajustes_pago_breb_qr_crc`.
--
-- QUIÉN LO VE Y QUIÉN LO CAMBIA (no cambia ninguna policy: la tabla ya las tenía)
--   acción                         | admin | mesero | pendiente / ajeno | anon | service_role (Edge Function `cuenta`)
--   -------------------------------+-------+--------+--------------------+------+---------------------------------------
--   leer llave, QR y «visible»     |  sí   |  sí    |  no                |  no  | SÍ, solo estas columnas (id incluido, para el filtro)
--   cambiarlos (UPDATE)            |  sí   |  no    |  no                |  no  |  no
--   `carta_publica` y `anon`       |  nunca los ven: la carta los recibe SOLO de la función `cuenta`, y solo si la mesa tiene
--                                     cuenta ABIERTA y «visible» está encendido.
--   La Edge Function lee `ajustes` con la llave de servicio, y `ajustes` no le daba nada a `service_role` (20261002170000 le
--   quitó todo): por eso esta migración le da SELECT de cuatro columnas (id, pago_breb_visible, pago_breb_llave, pago_breb_qr)
--   y de ninguna más. Sin esto la función recibiría «permission denied» y la carta nunca vería el QR.
--
-- Necesita 20261002170000_ajustes_ticket.sql (la tabla `ajustes`) y el esquema `privado` (20261001120000); si falta algo se niega a
-- correr SIN cambiar nada. Idempotente: volver a correrla no pisa lo que el admin ya configuró (las columnas se agregan solo si
-- faltan y los CHECK se reponen tal cual, validando las filas que haya). Es independiente de 20261003140000 (cola de impresión).
--
-- Lo que el admin carga (llave y contenido del QR) NO va en esta migración ni en ningún archivo del repo: se carga desde el
-- tablero de Administración → «Ticket y ajustes» → «Pago con Bre-B», o con el sobre privado de datos.
--
-- REVERSA (menos de 1 minuto; quita las tres columnas con sus CHECK y el permiso de service_role, y la función; el POS y la carta
-- vuelven a no saber nada de Bre-B; el resto de `ajustes` queda intacto. NO se toca `usage on schema privado`: lo usan otras):
--
--   begin;
--   revoke select (id) on public.ajustes from service_role;
--   alter table public.ajustes drop column if exists pago_breb_qr;
--   alter table public.ajustes drop column if exists pago_breb_llave;
--   alter table public.ajustes drop column if exists pago_breb_visible;
--   drop function if exists privado.emv_crc_ok(text);
--   commit;
--
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ajustes') is null then
    raise exception 'Falta 20261002170000_ajustes_ticket.sql (la tabla public.ajustes): aplicala primero. No se cambió nada.';
  end if;
  if to_regnamespace('privado') is null then
    raise exception 'Falta el esquema privado (20261001120000_cuenta_en_vivo.sql): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. El validador del contenido EMV ───────────────────────

create or replace function privado.emv_crc_ok(p_contenido text)
 returns boolean
 language plpgsql
 immutable
 parallel safe
 set search_path = ''
as $function$
declare
  v_n      integer;
  v_pos    integer := 1;
  v_ultimo integer := 0;
  v_bytes  bytea;
  v_crc    integer := 65535;      -- 0xFFFF
  v_i      integer;
  v_j      integer;
begin
  if p_contenido is null then return false; end if;
  v_n := length(p_contenido);
  if v_n < 8 or v_n > 1024 then return false; end if;

  -- Los campos de primer nivel: etiqueta de 2 dígitos + largo de 2 dígitos + valor. Tienen que cerrar JUSTO al final.
  while v_pos <= v_n loop
    if v_pos + 3 > v_n or substr(p_contenido, v_pos, 4) !~ '^[0-9]{4}$' then return false; end if;
    v_ultimo := v_pos;
    v_pos := v_pos + 4 + substr(p_contenido, v_pos + 2, 2)::integer;
  end loop;
  if v_pos <> v_n + 1 then return false; end if;

  -- El último campo es el 63 de 4 caracteres (el CRC, en hexadecimal): como los campos cierran justo al final, un último campo «6304»
  -- ocupa exactamente los últimos 8 caracteres y su valor son los últimos 4.
  if substr(p_contenido, v_ultimo, 4) <> '6304' then return false; end if;
  if substr(p_contenido, v_n - 3, 4) !~ '^[0-9A-Fa-f]{4}$' then return false; end if;

  -- CRC-16/CCITT-FALSE (polinomio 0x1021, valor inicial 0xFFFF, sin reflejar, sin xor final) de todo hasta «6304» inclusive.
  v_bytes := convert_to(substr(p_contenido, 1, v_n - 4), 'UTF8');
  for v_i in 0 .. length(v_bytes) - 1 loop
    v_crc := v_crc # (get_byte(v_bytes, v_i) << 8);
    for v_j in 1 .. 8 loop
      if (v_crc & 32768) <> 0 then
        v_crc := ((v_crc << 1) & 65535) # 4129;     -- 0x1021
      else
        v_crc := (v_crc << 1) & 65535;
      end if;
    end loop;
  end loop;

  return lpad(upper(to_hex(v_crc)), 4, '0') = upper(substr(p_contenido, v_n - 3, 4));
end;
$function$;

comment on function privado.emv_crc_ok(text) is
  'true si el texto es un contenido EMVCo bien formado (campos TLV de primer nivel que cierran al final, el último es 6304 + CRC) y su CRC-16/CCITT-FALSE es el correcto. false con cualquier otra cosa, null incluido. Pura: no lee tablas.';

-- Un CHECK corre con los permisos de quien hace el UPDATE (el admin, «authenticated»): necesita ejecutar esta función.
-- `usage on schema privado` ya lo dio 20261002180000 (los guardias de `ordenes` también corren con los permisos de quien llama);
-- se repite aquí, idempotente, por si esta migración corre sola. PostgREST no expone `privado`.
revoke all on function privado.emv_crc_ok(text) from public, anon, authenticated, service_role;
grant usage on schema privado to authenticated;
grant execute on function privado.emv_crc_ok(text) to authenticated;

-- ── 2. Las columnas de `ajustes` ─────────────────────────────

alter table public.ajustes add column if not exists pago_breb_visible boolean not null default false;
alter table public.ajustes add column if not exists pago_breb_llave text;
alter table public.ajustes add column if not exists pago_breb_qr text;

comment on column public.ajustes.pago_breb_visible is 'Si la carta muestra el pago con Bre-B (QR y llave) a quien tiene una mesa con cuenta abierta. Por defecto false.';
comment on column public.ajustes.pago_breb_llave is 'Llave Bre-B del local: «@alfanumérica», número, celular (+57…) o correo. 2 a 60 caracteres. null = no hay.';
comment on column public.ajustes.pago_breb_qr is 'Contenido del QR de Bre-B (EMVCo, texto): 20 a 700 caracteres, empieza por 000201, ASCII imprimible, campo 63 final con el CRC correcto. null = no hay.';

-- Los CHECK se reponen cada vez (drop + add en UNA sentencia): validan las filas que haya y dejan siempre la definición vigente.
alter table public.ajustes
  drop constraint if exists ajustes_pago_breb_llave_forma,
  add constraint ajustes_pago_breb_llave_forma check (
    pago_breb_llave is null or (
      length(pago_breb_llave) between 2 and 60
      and (
        pago_breb_llave ~ '^@[A-Za-z0-9._-]{1,59}$'                                  -- alfanumérica
        or pago_breb_llave ~ '^[0-9]{5,20}$'                                          -- número (documento, NIT, celular sin prefijo)
        or pago_breb_llave ~ '^\+57[0-9]{10}$'                                        -- celular con indicativo
        or pago_breb_llave ~ '^[A-Za-z0-9._%+-]{1,40}@[A-Za-z0-9.-]{1,40}\.[A-Za-z]{2,}$'   -- correo
      )
    )
  );

-- Los caracteres que nunca van sin escapar en una plantilla. La forma de arriba ya los excluye: este CHECK es defensa en profundidad
-- a propósito (el mismo gesto que ajustes_ticket_qr_url_segura), por si alguien afloja la forma sin acordarse de ellos.
alter table public.ajustes
  drop constraint if exists ajustes_pago_breb_llave_segura,
  add constraint ajustes_pago_breb_llave_segura check (
    pago_breb_llave is null or pago_breb_llave !~ '[\s<>"''`\\]'
  );

alter table public.ajustes
  drop constraint if exists ajustes_pago_breb_qr_largo,
  add constraint ajustes_pago_breb_qr_largo check (
    pago_breb_qr is null or length(pago_breb_qr) between 20 and 700
  );

alter table public.ajustes
  drop constraint if exists ajustes_pago_breb_qr_inicio,
  add constraint ajustes_pago_breb_qr_inicio check (
    pago_breb_qr is null or left(pago_breb_qr, 6) = '000201'
  );

alter table public.ajustes
  drop constraint if exists ajustes_pago_breb_qr_ascii,
  add constraint ajustes_pago_breb_qr_ascii check (
    pago_breb_qr is null or pago_breb_qr ~ '^[ -~]+$'
  );

-- La función se niega sola con más de 1024 caracteres (no calcula nada de más); el largo de verdad lo dice `_largo`.
alter table public.ajustes
  drop constraint if exists ajustes_pago_breb_qr_crc,
  add constraint ajustes_pago_breb_qr_crc check (
    pago_breb_qr is null or privado.emv_crc_ok(pago_breb_qr)
  );

alter table public.ajustes
  drop constraint if exists ajustes_pago_breb_completo,
  add constraint ajustes_pago_breb_completo check (
    not pago_breb_visible or (pago_breb_llave is not null and pago_breb_qr is not null)
  );

-- ── 3. Permisos ──────────────────────────────────────────────
-- authenticated ya tiene SELECT y UPDATE de toda la tabla (las columnas nuevas entran solas) y las policies (leer: personal;
-- editar: solo admin) no cambian. anon sigue sin nada. service_role (la Edge Function `cuenta`): SELECT de estas cuatro columnas,
-- nada de escribir y nada del resto de la tabla (el pie del ticket y quién editó por última vez no son suyos).

revoke all on public.ajustes from anon, service_role;
grant select (id, pago_breb_visible, pago_breb_llave, pago_breb_qr) on public.ajustes to service_role;
