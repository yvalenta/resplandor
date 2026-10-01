-- ════════════════════════════════════════════════════════════
-- Resplandor — la APROBACIÓN DE PERSONAL (1 de 4 de la ola C)
-- (pedido de Yonatan, 2026-09-30: «un panel de admin donde pueda añadir, aprobar o eliminar usuarios del
-- restaurante; si no se aprueba solo podrá ver, no podrá hacer nada más»; docs/sdd-cuenta-en-mesa.md)
--
-- La ola C sale en cuatro migraciones, después de las tres de la ola B:
--   1. 20261002150000_aprobacion_personal.sql   ← ESTA: quién entra, ahora con aprobación.
--   2. 20261002160000_mesas_y_pegatinas.sql        mesas activas/inactivas y el estado de cada pegatina NFC.
--   3. 20261002170000_ajustes_ticket.sql           la URL del QR y el pie del ticket, desde el panel.
--   4. 20261002180000_deshacer_cobro.sql           devolver un cobro parcial o un abono a la cuenta.
--
-- Qué hace
--   1. `personal.estado` ('pendiente' | 'aprobado') y `personal.solicitado_en`. Las filas que ya existen
--      quedan 'aprobado': quien hoy entra al POS sigue entrando igual.
--   2. `mi_rol()` devuelve el rol SOLO si la fila está activa Y aprobada. Como la compuerta `solo_personal`,
--      las policies por rol, las alertas y la presencia privada preguntan `mi_rol() is not null`, todas
--      exigen «aprobado» por construcción: una cuenta pendiente no ve ni escribe nada de las tablas del POS.
--   3. `solicitar_acceso()`: lo llama el POS al entrar. Con sesión de Google, si la persona no está en
--      `personal` crea su fila PENDIENTE (rol 'mesero' provisional, nombre de los metadatos de Google); si ya
--      está, dice en qué estado. Una persona ELIMINADA (activo = false) recibe 'eliminado' y NO se resucita:
--      volver es decisión de un admin (personal_alta). Tope: 50 pendientes en total (anti-abuso).
--   4. `vista_pendiente()`: las mesas (número, capacidad, estado) para la pantalla «Tu cuenta espera
--      aprobación». SECURITY DEFINER, solo para una sesión de Google; sin token, sin totales, sin órdenes.
--   5. `personal_aprobar(email, rol)` y `personal_eliminar(email)`, solo admin; nunca queda el sistema sin un
--      admin aprobado y activo. `personal_alta` (alta = aprobado directo), `personal_baja` (= personal_eliminar)
--      y `personal_cambiar_rol` siguen funcionando, ahora contando solo admins aprobados.
--   6. `personal` entra a la publicación supabase_realtime: el admin recibe las solicitudes nuevas al instante
--      (la RLS de `personal` ya solo le deja ver todas las filas al admin; cada quien ve la suya).
--
--   tabla / RPC                       | admin | mesero aprobado | pendiente | eliminado | Google sin fila | correo | anon
--   ----------------------------------+-------+-----------------+-----------+-----------+-----------------+--------+------
--   tablas del POS (por rol)          |  sí   |  sí (ola B)     |  no       |  no       |  no             |  no    |  no
--   personal  ver                     | todas |  su fila        |  no       |  no       |  no             |  no    |  no
--   solicitar_acceso()                |  sí   |  sí             |  sí (crea)|  sí       |  sí (crea)      |  no ¹  |  no
--   vista_pendiente()                 |  sí   |  sí             |  sí       |  sí       |  sí             |  no    |  no
--   personal_aprobar / _eliminar      |  sí   |  no_autorizado  |  no_aut.  |  no_aut.  |  no_aut.        |  no    |  no
--   personal_alta / _baja / _cambiar_rol | sí |  no_autorizado  |  no_aut.  |  no_aut.  |  no_aut.        |  no    |  no
--   ¹ Una sesión que no es de Google recibe {estado: null, codigo: 'sin_google'} y no crea nada.
--
-- Códigos (jsonb {ok, codigo}): no_autorizado | correo_invalido | rol_invalido | no_existe | inactivo |
--   ya_aprobado | ya_existe | ultimo_admin | pendiente (cambiar el rol de alguien aún sin aprobar).
--
-- Necesita la compuerta (20261002120000: personal, mi_correo(), mi_rol()); si falta, se niega a correr SIN
-- cambiar nada. No necesita a las otras tres. Aplicarla NO le quita acceso a nadie: las filas de hoy quedan
-- aprobadas. Lo único que cambia para el POS de hoy es que existen funciones nuevas que todavía nadie llama.
--
-- ORDEN: el POS de la ola C llama a solicitar_acceso() ANTES de mi_rol(); si esta migración falta, el POS
-- sigue el flujo de la ola B (la RPC no existe: PGRST202). Aplicarla antes del POS es inocuo.
--
-- Límites conocidos (a ojos abiertos)
--   · Con Google fuera de «Testing», cualquier cuenta de Google puede crear una fila pendiente (hasta el
--     tope de 50). Un abusador con muchas cuentas puede llenar el cupo y bloquear nuevas solicitudes; el admin
--     libera cupo con «Eliminar» y, mientras tanto, personal_alta (por correo) sigue funcionando.
--   · Nadie recibe un correo: el admin ve el contador de pendientes en el POS.
--   · NO volver a pegar la compuerta (20261002120000, ni su sobre) DESPUÉS de esta: redefine mi_rol() sin mirar `estado` (y
--     personal_alta, personal_baja y personal_cambiar_rol sin él), y una fila pendiente entraría como mesero. Si hubo que
--     volver a pegarla, volver a pegar ESTA enseguida (es idempotente). Con las demás de la ola B no pasa: no tocan mi_rol().
--
-- REVERSA (menos de 1 minuto; devuelve las funciones de la compuerta tal cual eran y quita lo de este archivo).
-- ¡Lo PRIMERO es borrar las filas pendientes! Con la `mi_rol()` vieja (que no mira `estado`) una fila pendiente
-- activa entraría como mesero. Se corre DESPUÉS de las reversas de las migraciones 2, 3 y 4 (orden inverso):
--
--   begin;
--   delete from public.personal where estado = 'pendiente';
--   create or replace function public.mi_rol()
--    returns text
--    language sql
--    stable
--    security definer
--    set search_path = ''
--   as $function$
--     select p.rol
--       from public.personal p
--      where p.activo
--        and p.email = (select public.mi_correo())
--   $function$;
--   comment on function public.mi_rol() is 'Rol de quien llama (admin | mesero) o null: identidad de Google (mi_correo()) + fila activa en public.personal. Lo usan las policies y las RPC.';
--   create or replace function public.personal_alta(p_email text, p_nombre text, p_rol text)
--    returns jsonb
--    language plpgsql
--    security definer
--    set search_path = ''
--   as $function$
--   declare
--     v_email text := lower(btrim(coalesce(p_email, '')));
--     v_nombre text := btrim(coalesce(p_nombre, ''));
--     v_fila public.personal;
--   begin
--     if (select public.mi_rol()) is distinct from 'admin' then
--       return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
--     end if;
--     if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
--       return jsonb_build_object('ok', false, 'codigo', 'correo_invalido');
--     end if;
--     if p_rol is null or p_rol <> all (array['admin', 'mesero']) then
--       return jsonb_build_object('ok', false, 'codigo', 'rol_invalido');
--     end if;
--     if length(v_nombre) > 80 then
--       return jsonb_build_object('ok', false, 'codigo', 'nombre_invalido');
--     end if;
--     perform pg_advisory_xact_lock(hashtext('resplandor.personal'));
--     if (select public.mi_rol()) is distinct from 'admin' then
--       return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
--     end if;
--     select * into v_fila from public.personal where email = v_email for update;
--     if found and v_fila.activo then
--       return jsonb_build_object('ok', false, 'codigo', 'ya_existe');
--     end if;
--     insert into public.personal (email, nombre, rol)
--     values (v_email, v_nombre, p_rol)
--     on conflict (email) do update set nombre = excluded.nombre, rol = excluded.rol, activo = true
--     returning * into v_fila;
--     return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
--   end;
--   $function$;
--   create or replace function public.personal_baja(p_email text)
--    returns jsonb
--    language plpgsql
--    security definer
--    set search_path = ''
--   as $function$
--   declare
--     v_email text := lower(btrim(coalesce(p_email, '')));
--     v_fila public.personal;
--   begin
--     if (select public.mi_rol()) is distinct from 'admin' then
--       return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
--     end if;
--     perform pg_advisory_xact_lock(hashtext('resplandor.personal'));
--     if (select public.mi_rol()) is distinct from 'admin' then
--       return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
--     end if;
--     select * into v_fila from public.personal where email = v_email for update;
--     if not found then
--       return jsonb_build_object('ok', false, 'codigo', 'no_existe');
--     end if;
--     if not v_fila.activo then
--       return jsonb_build_object('ok', false, 'codigo', 'inactivo');
--     end if;
--     if v_fila.rol = 'admin'
--        and (select count(*) from public.personal where rol = 'admin' and activo) <= 1 then
--       return jsonb_build_object('ok', false, 'codigo', 'ultimo_admin');
--     end if;
--     update public.personal set activo = false where email = v_email returning * into v_fila;
--     return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
--   end;
--   $function$;
--   create or replace function public.personal_cambiar_rol(p_email text, p_rol text)
--    returns jsonb
--    language plpgsql
--    security definer
--    set search_path = ''
--   as $function$
--   declare
--     v_email text := lower(btrim(coalesce(p_email, '')));
--     v_fila public.personal;
--   begin
--     if (select public.mi_rol()) is distinct from 'admin' then
--       return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
--     end if;
--     if p_rol is null or p_rol <> all (array['admin', 'mesero']) then
--       return jsonb_build_object('ok', false, 'codigo', 'rol_invalido');
--     end if;
--     perform pg_advisory_xact_lock(hashtext('resplandor.personal'));
--     if (select public.mi_rol()) is distinct from 'admin' then
--       return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
--     end if;
--     select * into v_fila from public.personal where email = v_email for update;
--     if not found then
--       return jsonb_build_object('ok', false, 'codigo', 'no_existe');
--     end if;
--     if not v_fila.activo then
--       return jsonb_build_object('ok', false, 'codigo', 'inactivo');
--     end if;
--     if v_fila.rol = 'admin' and p_rol <> 'admin'
--        and (select count(*) from public.personal where rol = 'admin' and activo) <= 1 then
--       return jsonb_build_object('ok', false, 'codigo', 'ultimo_admin');
--     end if;
--     update public.personal set rol = p_rol where email = v_email returning * into v_fila;
--     return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
--   end;
--   $function$;
--   drop function if exists public.solicitar_acceso();
--   drop function if exists public.vista_pendiente();
--   drop function if exists public.personal_aprobar(text, text);
--   drop function if exists public.personal_eliminar(text);
--   alter publication supabase_realtime drop table public.personal;
--   alter table public.personal drop constraint if exists personal_estado_check;
--   alter table public.personal drop column if exists estado;
--   alter table public.personal drop column if exists solicitado_en;
--   commit;
--
-- Idempotente donde se puede. Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisito: la compuerta de personal ───────────────────

do $$
begin
  if to_regclass('public.personal') is null
     or to_regprocedure('public.mi_rol()') is null
     or to_regprocedure('public.mi_correo()') is null
     or to_regprocedure('public.personal_alta(text,text,text)') is null then
    raise exception 'Falta 20261002120000_personal_y_compuerta.sql (personal, mi_correo(), mi_rol() y las RPC de personal): aplicala primero. No se cambió nada.';
  end if;
  if to_regclass('public.mesas') is null then
    raise exception 'Falta la base (public.mesas): vista_pendiente() la lee. No se cambió nada.';
  end if;
end $$;

-- ── 1. Estado de cada persona ───────────────────────────────
-- Las filas que ya existen quedan 'aprobado' (el default se aplica al agregar la columna): nadie pierde
-- acceso. La fila nueva que crea solicitar_acceso() nace 'pendiente'; las que crea personal_alta, 'aprobado'.

alter table public.personal add column if not exists estado text not null default 'aprobado'::text;
alter table public.personal add column if not exists solicitado_en timestamp with time zone;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.personal'::regclass and conname = 'personal_estado_check') then
    alter table public.personal
      add constraint personal_estado_check check ((estado = any (array['pendiente'::text, 'aprobado'::text])));
  end if;
end $$;

comment on column public.personal.estado is
  'pendiente = pidió acceso (solicitar_acceso) y un admin aún no la aprueba: mi_rol() la trata como sin rol. aprobado = entra con su rol. La baja sigue siendo activo = false, sea cual sea el estado.';
comment on column public.personal.solicitado_en is
  'Cuándo pidió acceso (solicitar_acceso). null en quien un admin dio de alta directamente.';

-- ── 2. mi_rol(): solo activo Y aprobado ─────────────────────
-- Misma firma y mismos grants que la de la compuerta. Todo lo que pregunta `mi_rol() is not null`
-- (solo_personal, las policies por rol, alertas, presencia, mesa_existe, ajustes) exige «aprobado».

create or replace function public.mi_rol()
 returns text
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select p.rol
    from public.personal p
   where p.activo
     and p.estado = 'aprobado'
     and p.email = (select public.mi_correo())
$function$;

comment on function public.mi_rol() is
  'Rol de quien llama (admin | mesero) o null: identidad de Google (mi_correo()) + fila activa y APROBADA en public.personal. Lo usan las policies y las RPC.';

-- ── 3. solicitar_acceso() ───────────────────────────────────
-- {estado: 'pendiente' | 'aprobado' | 'eliminado', rol}. `rol` solo viene con 'aprobado'; un pendiente no tiene
-- rol todavía. Sin sesión de Google no crea nada y dice por qué (estado null + codigo). Cada llamada de un
-- pendiente (el POS reintenta cada 30 s) es UNA lectura; el candado de transacción solo se toma al crear la fila.

create or replace function public.solicitar_acceso()
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_correo text := (select public.mi_correo());
  v_nombre text;
  v_fila public.personal;
begin
  if v_correo is null then
    return jsonb_build_object('estado', null, 'rol', null, 'codigo', 'sin_google');
  end if;
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_correo) > 254 then
    return jsonb_build_object('estado', null, 'rol', null, 'codigo', 'correo_invalido');
  end if;

  select * into v_fila from public.personal where email = v_correo;
  if not found then
    -- El mismo candado que el resto de la gestión del personal: dos solicitudes a la vez no pasan del tope.
    perform pg_advisory_xact_lock(hashtext('resplandor.personal'));
    select * into v_fila from public.personal where email = v_correo;
    if not found then
      if (select count(*) from public.personal where estado = 'pendiente' and activo) >= 50 then
        return jsonb_build_object('estado', null, 'rol', null, 'codigo', 'tope');
      end if;
      -- El nombre sale de los metadatos de Google (full_name, o name). Sin saltos de línea ni caracteres de
      -- control, a lo sumo 80 caracteres (el CHECK de la tabla).
      select left(btrim(regexp_replace(
               coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                        nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), ''),
               '[[:cntrl:]]+', ' ', 'g')), 80)
        into v_nombre
        from auth.users u
       where u.id = (select auth.uid());
      insert into public.personal (email, nombre, rol, estado, solicitado_en)
      values (v_correo, coalesce(v_nombre, ''), 'mesero', 'pendiente', now())
      on conflict (email) do nothing
      returning * into v_fila;
      if not found then
        select * into v_fila from public.personal where email = v_correo;
      end if;
    end if;
  end if;

  -- Una baja (activo = false) manda sobre el estado: NO se resucita.
  if not v_fila.activo then
    return jsonb_build_object('estado', 'eliminado', 'rol', null);
  end if;
  if v_fila.estado = 'aprobado' then
    return jsonb_build_object('estado', 'aprobado', 'rol', v_fila.rol);
  end if;
  return jsonb_build_object('estado', 'pendiente', 'rol', null);
end;
$function$;

comment on function public.solicitar_acceso() is
  'Lo llama el POS al entrar. Crea la fila pendiente de quien entra con Google y no está en personal (tope 50); devuelve {estado: pendiente|aprobado|eliminado, rol}. No resucita a un eliminado.';

-- ── 4. vista_pendiente() ────────────────────────────────────
-- Las mesas para la pantalla «Tu cuenta espera aprobación»: número, capacidad y estado. NADA más (ni token, ni
-- totales, ni órdenes). Solo una sesión de Google la lee; incluye a quien aún no está en personal. La migración
-- 20261002160000 la vuelve a definir para listar solo las mesas ACTIVAS (la columna `activa` nace allí).

create or replace function public.vista_pendiente()
 returns table(id integer, capacidad integer, estado text)
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select m.id, m.capacidad, m.estado
    from public.mesas m
   where coalesce((select auth.jwt()) -> 'app_metadata' ->> 'provider', '') = 'google'
   order by m.id
$function$;

comment on function public.vista_pendiente() is
  'Mesas (id, capacidad, estado) para quien espera aprobación. SECURITY DEFINER, solo sesión de Google; sin token, totales ni órdenes.';

-- ── 5. Gestión del personal (solo admin) ────────────────────
-- Misma disciplina que la compuerta: cada una toma el candado de transacción y REVISA el rol después de
-- tomarlo, así dos admins que se quitan el rol a la vez no dejan el sistema sin admin.

create or replace function public.personal_aprobar(p_email text, p_rol text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_fila public.personal;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'codigo', 'correo_invalido');
  end if;
  if p_rol is null or p_rol <> all (array['admin', 'mesero']) then
    return jsonb_build_object('ok', false, 'codigo', 'rol_invalido');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.personal'));
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  select * into v_fila from public.personal where email = v_email for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  if not v_fila.activo then
    -- Un eliminado vuelve SOLO por personal_alta: aprobar no resucita.
    return jsonb_build_object('ok', false, 'codigo', 'inactivo');
  end if;
  if v_fila.estado = 'aprobado' then
    -- Otro admin (o un doble toque) llegó primero: con el mismo rol es lo que se pedía; con otro, no se pisa.
    if v_fila.rol = p_rol then
      return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
    end if;
    return jsonb_build_object('ok', false, 'codigo', 'ya_aprobado', 'rol', v_fila.rol);
  end if;

  update public.personal set estado = 'aprobado', rol = p_rol where email = v_email returning * into v_fila;
  return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
end;
$function$;

create or replace function public.personal_eliminar(p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_fila public.personal;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.personal'));
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  select * into v_fila from public.personal where email = v_email for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  if not v_fila.activo then
    return jsonb_build_object('ok', false, 'codigo', 'inactivo');
  end if;
  -- Nunca queda el sistema sin un admin aprobado y activo; tampoco si el último admin se elimina a sí mismo.
  if v_fila.rol = 'admin' and v_fila.estado = 'aprobado'
     and (select count(*) from public.personal where rol = 'admin' and activo and estado = 'aprobado') <= 1 then
    return jsonb_build_object('ok', false, 'codigo', 'ultimo_admin');
  end if;

  update public.personal set activo = false where email = v_email returning * into v_fila;
  return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
end;
$function$;

-- personal_alta (alta = aprobado directo). Igual que la de la compuerta, más: dar de alta a quien está PENDIENTE lo
-- aprueba con ese nombre y rol; reactivar a un eliminado lo deja aprobado; un nombre vacío no borra el que ya había.
create or replace function public.personal_alta(p_email text, p_nombre text, p_rol text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_fila public.personal;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'codigo', 'correo_invalido');
  end if;
  if p_rol is null or p_rol <> all (array['admin', 'mesero']) then
    return jsonb_build_object('ok', false, 'codigo', 'rol_invalido');
  end if;
  if length(v_nombre) > 80 then
    return jsonb_build_object('ok', false, 'codigo', 'nombre_invalido');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.personal'));
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  select * into v_fila from public.personal where email = v_email for update;
  if found and v_fila.activo and v_fila.estado = 'aprobado' then
    -- Cambiar el rol de alguien aprobado es personal_cambiar_rol (con su guardia).
    return jsonb_build_object('ok', false, 'codigo', 'ya_existe');
  end if;

  insert into public.personal (email, nombre, rol, estado)
  values (v_email, v_nombre, p_rol, 'aprobado')
  on conflict (email) do update
     set nombre = case when excluded.nombre = '' then public.personal.nombre else excluded.nombre end,
         rol = excluded.rol, activo = true, estado = 'aprobado'
  returning * into v_fila;
  return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
end;
$function$;

-- personal_baja es el nombre de la compuerta; hoy hace lo mismo que personal_eliminar.
create or replace function public.personal_baja(p_email text)
 returns jsonb
 language sql
 security definer
 set search_path = ''
as $function$
  select public.personal_eliminar(p_email)
$function$;

create or replace function public.personal_cambiar_rol(p_email text, p_rol text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_fila public.personal;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_rol is null or p_rol <> all (array['admin', 'mesero']) then
    return jsonb_build_object('ok', false, 'codigo', 'rol_invalido');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.personal'));
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  select * into v_fila from public.personal where email = v_email for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  if not v_fila.activo then
    return jsonb_build_object('ok', false, 'codigo', 'inactivo');
  end if;
  if v_fila.estado <> 'aprobado' then
    -- A un pendiente se le da un rol APROBÁNDOLO (personal_aprobar), no cambiándoselo.
    return jsonb_build_object('ok', false, 'codigo', 'pendiente');
  end if;
  if v_fila.rol = 'admin' and p_rol <> 'admin'
     and (select count(*) from public.personal where rol = 'admin' and activo and estado = 'aprobado') <= 1 then
    -- Ni un admin se quita a sí mismo el último rol admin, ni nadie lo quita.
    return jsonb_build_object('ok', false, 'codigo', 'ultimo_admin');
  end if;

  update public.personal set rol = p_rol where email = v_email returning * into v_fila;
  return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
end;
$function$;

-- Quién puede ejecutar qué (por defecto Supabase da EXECUTE a anon). Las tres de siempre conservan sus grants.
revoke all on function public.mi_rol() from public, anon;
revoke all on function public.solicitar_acceso() from public, anon, service_role;
revoke all on function public.vista_pendiente() from public, anon, service_role;
revoke all on function public.personal_aprobar(text, text) from public, anon, service_role;
revoke all on function public.personal_eliminar(text) from public, anon, service_role;
revoke all on function public.personal_alta(text, text, text) from public, anon;
revoke all on function public.personal_baja(text) from public, anon;
revoke all on function public.personal_cambiar_rol(text, text) from public, anon;
grant execute on function public.mi_rol() to authenticated, service_role;
grant execute on function public.solicitar_acceso() to authenticated;
grant execute on function public.vista_pendiente() to authenticated;
grant execute on function public.personal_aprobar(text, text) to authenticated;
grant execute on function public.personal_eliminar(text) to authenticated;
grant execute on function public.personal_alta(text, text, text) to authenticated;
grant execute on function public.personal_baja(text) to authenticated;
grant execute on function public.personal_cambiar_rol(text, text) to authenticated;

-- ── 6. Realtime: el admin recibe las solicitudes al instante ──
-- La RLS de `personal` (personal_ver + la compuerta solo_personal) decide quién recibe qué: el admin, todas las
-- filas; un mesero, la suya; un pendiente, un eliminado o una cuenta ajena, ninguna (mi_rol() es null).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal'
  ) then
    alter publication supabase_realtime add table public.personal;
  end if;
end $$;
