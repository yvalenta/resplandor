-- ════════════════════════════════════════════════════════════
-- Resplandor — la COMPUERTA DE PERSONAL (1 de 3 de «roles y alertas»)
-- (pedido de Yonatan, 2026-09-30; SDD v0.3 §02.3 a §02.5 y §04.5)
--
-- Los roles y las alertas salen al aire en tres migraciones, cada una a su hora:
--   1. 20261002120000_personal_y_compuerta.sql   ← ESTA: quién entra al POS.
--   2. 20261002130000_alertas.sql                   las alertas de «pedir la cuenta».
--   3. 20261002140000_permisos_por_rol.sql          qué puede hacer cada rol por tabla.
-- Esta es la primera y la única que hace falta ya: cierra el hueco de hoy (cualquier
-- cuenta de Google que pase el login de OAuth lee las ventas y los tokens de las
-- mesas) SIN esperar al POS nuevo ni cambiarle nada a quien trabaja aquí.
--
-- Qué hace
--   1. `public.personal`: quién entra al POS y con qué rol ('admin' | 'mesero').
--      Los correos reales NUNCA van en este archivo (el repo es público): el alta
--      inicial llega por un ajuste de la sesión (ver «ORDEN SEGURO») desde un SQL
--      aparte que pega Yonatan.
--   2. `public.mi_correo()` y `public.mi_rol()`: el rol de quien llama. Identifica a
--      la persona por la identidad de Google que asegura Google (auth.identities),
--      NO por el correo de auth.users (que el usuario puede cambiar con updateUser).
--      Exige además que la sesión sea de Google. Se consulta en cada petición, así
--      que una baja corta el acceso al instante (el JWT no lleva el rol).
--   3. Las RPC de gestión del personal (solo admin; nunca se queda el sistema sin
--      admin): personal_alta, personal_baja y personal_cambiar_rol.
--   4. La policy RESTRICTIVA `solo_personal`, que REEMPLAZA a `solo_google`: Google
--      Y estar en `personal` activo. Va en las tablas que hoy llevan solo_google
--      (productos, mesas, ordenes, cierres, sugerencias_plato; en `menus` solo las
--      escrituras, ver ¹) y en `personal`. Es lo ÚLTIMO que hace el archivo.
--   5. La guardia: se niega a correr (antes de tocar una sola policy) si no queda al
--      menos UN admin activo con una cuenta de Google real en este proyecto.
--
-- Lo que NO hace (a propósito)
--   No toca las policies PERMISIVAS de hoy («authenticated full access …», menus_admin,
--   sug_admin: authenticated using (true)). Por eso el POS de hoy sigue funcionando
--   igual para TODO el personal dado de alta, admin o mesero, con acceso completo;
--   lo único que cambia es que quien no está en `personal` queda afuera. Los permisos
--   por rol (el mesero sin catálogo, sin cierres, etc.) son de 20261002140000.
--
--   tabla                              | en personal (admin o mesero) | otra cuenta Google | correo | anon
--   -----------------------------------+------------------------------+--------------------+--------+------
--   productos, mesas, ordenes, cierres | como hoy (ver y escribir)    |  no                |  no    |  no
--   sugerencias_plato                  | como hoy (ver)               |  no                |  no    |  no
--   menus  ver                         | como hoy                     |  sí ¹              |  sí ¹  |  sí
--   menus  crear/editar/borrar         | como hoy                     |  no                |  no    |  no
--   elecciones_menu, reacciones_menu   | ver (sin cambios)            |  sí (público)      |  sí    |  sí
--   personal  ver                      | admin todo; mesero su fila   |  no                |  no    |  no
--   personal  alta/baja/rol            | RPC, solo admin              |  no                |  no    |  no
--
--   ¹ `menus` se lee en público a propósito (menu.html, con o sin sesión: quien entró
--     al POS con una cuenta ajena y abre después la página del menú, en el mismo
--     navegador, la leería como `authenticated` y la vería vacía). Por eso `menus`
--     lleva `solo_personal` solo en INSERT, UPDATE y DELETE: la lectura sigue en
--     `menus_select_publico`. Hoy `solo_google` la cubre completa; este es el único
--     cambio de lectura (inocuo: anon ya la lee).
--
-- ORDEN SEGURO para no dejar a nadie afuera (lo corre Yonatan; aparca)
--   La migración se niega a correr si al terminar de leer el alta inicial no hay al
--   menos UN admin activo en `personal` con cuenta de Google en este proyecto
--   (auth.identities con provider 'google', y auth.users con
--   raw_app_meta_data.provider = 'google', que es lo que luego lleva el JWT). Un
--   correo mal escrito, o de alguien que nunca entró con Google, no cuenta. Lanza la
--   excepción ANTES de tocar una sola policy. Por eso se corre así, en el SQL Editor,
--   UNA sola vez y en UNA transacción (el SQL aparte `compuerta-al-aire.sql` ya viene
--   armado, con la consulta previa, el alta y la verificación):
--
--       -- 0. ANTES, solo lectura: de dónde sacar los correos exactos.
--       select i.identity_data ->> 'email' as correo_google, u.last_sign_in_at
--         from auth.identities i join auth.users u on u.id = i.user_id
--        where i.provider = 'google' order by u.last_sign_in_at desc nulls last;
--          (si da «permission denied», no sigas: mi_correo() lee esas mismas tablas
--          con los mismos permisos del que corre este archivo)
--
--       begin;
--       select set_config('resplandor.admins_iniciales',
--                         'correo1@…, correo2@…', true);   -- is_local = true
--       <este archivo completo>
--       insert into public.personal (email, nombre, rol) values …;  -- los MESEROS,
--                                              -- en la MISMA transacción, no después
--       commit;
--
--   · Sin correos y sin admins ya cargados → falla y queda TODO como estaba
--     (las policies viejas siguen en pie; solo pudo quedar la tabla vacía).
--   · Un marcador sin reemplazar (<CORREO_ADMIN_1>) → falla igual.
--   · Ningún admin con cuenta de Google (correo mal escrito) → falla igual, y el
--     error lista las cuentas de Google que sí existen (en HINT).
--   · Un admin sin cuenta de Google todavía (p. ej. quien nunca entró) no frena la
--     migración mientras otro admin sí la tenga, pero deja un WARNING con su correo:
--     revisalo, porque esa persona NO tendrá rol hasta que entre.
--   · Volver a correrla con admins ya cargados no necesita el ajuste, y volver a
--     correrla con él reactiva a esos admins (no toca a nadie más).
--   · Aplicarla FUERA del horario de servicio, con tu sesión de Google abierta en
--     pos.html en otra pestaña.
--   · Cómo comprobar que quedó bien (NO sirve «recargá y mirá si carga»: fuera de
--     servicio no hay órdenes abiertas y las mesas salen de la caché local).
--     `supabaseClient` es privado de pos.html (vive dentro de alpine:init), así que
--     desde la consola de pos.html, con la sesión abierta:
--         await window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY).rpc('mi_rol')
--     tiene que dar { data: 'admin' }. Un { data: null } es «sin acceso»: usar la
--     REVERSA (más abajo) antes de que lo note nadie.
--
-- CONDICIONES DE SALIDA AL AIRE
--   1. Dar de alta a TODOS los que hoy entran al POS (admins y meseros), en la misma
--      transacción: el que no esté en `personal` queda afuera al instante.
--   2. Para quien NO está en `personal` activo la RLS devuelve [] SIN error, y el POS
--      de hoy no sabe mostrar «sin acceso»: el badge sigue en «En línea», las mesas y
--      los productos salen de la caché o de la semilla, «Abrir mesa» falla sin avisar
--      y los deltas fantasma quedan primeros en pos_delta_queue (cuando por fin se le
--      da de alta, flushDeltas choca con «orden no existe» y hace `break`: la cola de
--      esa tablet queda trabada). Para esta migración es aceptable: esa persona es
--      justo a quien se quiere dejar afuera, y todo el personal actual ya está dado
--      de alta. La pantalla «sin acceso» (mi_rol() al arrancar) y el arreglo de
--      flushDeltas llegan con el POS nuevo. Hasta entonces, a quien se sume al
--      personal después: dar de alta ANTES de que abra el POS, o limpiar la caché de
--      esa tablet.
--   3. Si el cliente OAuth de Google sigue en modo «Testing», publicarlo (Google
--      Cloud → Google Auth Platform → Audience → «Publish app») solo DESPUÉS de
--      aplicar esto y de comprobarlo: antes de esta migración, publicar dejaba entrar
--      a cualquier cuenta de Google al POS.
--   «Confirm email» / «Secure email change» no son condición: mi_rol() no confía en
--   el correo de auth.users (ver mi_correo()).
--
-- REVERSA (menos de 1 minuto, en el mismo editor; vuelve a `solo_google` y deja
-- `personal` y las funciones sin uso; las policies permisivas nunca se tocaron):
--
--   begin;
--   do $$ declare t text; begin
--     foreach t in array array['productos','mesas','ordenes','cierres','sugerencias_plato','menus'] loop
--       execute format('drop policy if exists solo_google on public.%I', t);
--       execute format('create policy solo_google on public.%I as restrictive for all to authenticated
--         using ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'')
--         with check ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'')', t);
--     end loop;
--     foreach t in array array['productos','mesas','ordenes','cierres','sugerencias_plato','personal'] loop
--       execute format('drop policy if exists solo_personal on public.%I', t);
--     end loop;
--   end $$;
--   drop policy if exists solo_personal_insert on public.menus;
--   drop policy if exists solo_personal_update on public.menus;
--   drop policy if exists solo_personal_delete on public.menus;
--   commit;
--
-- Idempotente donde se puede. Correr en Supabase → SQL Editor (lo aplica Yonatan:
-- aparca). Va fechada DESPUÉS de 20261001120000 (cuenta en vivo, otra rama) y
-- después de las dos primeras.
-- ════════════════════════════════════════════════════════════

-- ── 1. Personal ─────────────────────────────────────────────

create table if not exists public.personal (
  email text not null,
  nombre text not null default ''::text,
  rol text not null,
  activo boolean not null default true,
  creado_en timestamp with time zone not null default now(),
  constraint personal_pkey primary key (email),
  constraint personal_email_check check (((email = lower(email)) and (length(email) <= 254) and (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))),
  constraint personal_nombre_check check ((length(nombre) <= 80)),
  constraint personal_rol_check check ((rol = any (array['admin'::text, 'mesero'::text])))
);

comment on table public.personal is
  'Quién entra al POS. Una fila por correo de Google (minúsculas). La baja es lógica (activo = false). Se escribe SOLO con las RPC personal_alta / personal_baja / personal_cambiar_rol; la carga inicial es un SQL aparte (los correos no van al repo).';

alter table public.personal enable row level security;

-- ── 2. Alta inicial de admins y guardia anti-bloqueo ────────
-- Lee `resplandor.admins_iniciales` (correos separados por coma o punto y
-- coma) si la sesión lo trae. Va ANTES de tocar ninguna policy.

do $$
declare
  v_lista text := nullif(btrim(coalesce(current_setting('resplandor.admins_iniciales', true), '')), '');
  v_email text;
begin
  if v_lista is not null then
    foreach v_email in array regexp_split_to_array(v_lista, '\s*[,;]\s*') loop
      v_email := lower(btrim(v_email));
      if v_email = '' then
        continue;
      end if;
      if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
        raise exception 'resplandor.admins_iniciales: correo no válido (%). ¿Quedó un marcador <CORREO_ADMIN_n> sin reemplazar? No se cambió nada.', v_email;
      end if;
      insert into public.personal (email, rol)
      values (v_email, 'admin')
      on conflict (email) do update set rol = 'admin', activo = true;
    end loop;
  end if;

  if not exists (select 1 from public.personal p where p.rol = 'admin' and p.activo) then
    raise exception 'Sin un admin activo en public.personal esta migración dejaría a todos afuera del POS. Corré el SQL aparte compuerta-al-aire.sql (alta de admins + esta migración en una sola transacción). No se cambió ninguna policy.';
  end if;

  -- Un correo con forma de correo no basta: tiene que ser el de una cuenta de
  -- Google que exista en ESTE proyecto, la misma condición con la que mi_rol()
  -- reconocerá a la persona. Si ningún admin la cumple, el correo está mal
  -- escrito (o nadie entró nunca con Google) y la migración dejaría a todos afuera.
  if not exists (
    select 1
      from public.personal p
      join auth.identities i on i.provider = 'google' and lower(i.identity_data ->> 'email') = p.email
      join auth.users u on u.id = i.user_id
     where p.rol = 'admin' and p.activo
       and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
  ) then
    raise exception 'Ningún admin activo de public.personal coincide con una cuenta de Google de este proyecto (auth.identities). Revisá que el correo esté bien escrito y que esa persona haya entrado alguna vez con Google. No se cambió ninguna policy.'
      using hint = 'Cuentas de Google de este proyecto: ' || coalesce(
        (select left(string_agg(distinct lower(i.identity_data ->> 'email'), ', '), 500)
           from auth.identities i where i.provider = 'google'), '(ninguna)');
  end if;

  -- Los demás admins sin cuenta de Google no frenan la migración, pero no tendrán rol
  -- hasta que entren por primera vez: que se vea.
  for v_email in
    select p.email
      from public.personal p
     where p.rol = 'admin' and p.activo
       and not exists (
         select 1
           from auth.identities i
           join auth.users u on u.id = i.user_id
          where i.provider = 'google' and lower(i.identity_data ->> 'email') = p.email
            and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google')
     order by p.email
  loop
    raise warning 'admin sin cuenta de Google todavía: % (no tendrá rol hasta que entre con Google; si está mal escrito, corregilo con personal_alta)', v_email;
  end loop;
end $$;

-- ── 3. mi_correo() y mi_rol() ───────────────────────────────
-- mi_correo(): el correo de la identidad de Google de quien llama, o null. Sale de
-- auth.identities (lo asegura Google), NO de auth.jwt() ->> 'email', que es el
-- correo de auth.users y el usuario puede cambiarlo con updateUser: con «Confirm
-- email» apagado, alguien con cualquier sesión de Google podría ponerse el correo
-- de una persona dada de alta que todavía no entró y quedarse con su rol
-- (refutación 2026-09-30, hallazgo 4). Una cuenta por correo (sin identidad de
-- Google) tampoco obtiene nada. SECURITY DEFINER para leer el esquema auth;
-- search_path vacío.

create or replace function public.mi_correo()
 returns text
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select lower(i.identity_data ->> 'email')
    from auth.identities i
   where i.user_id = (select auth.uid())
     and i.provider = 'google'
     and coalesce((select auth.jwt()) -> 'app_metadata' ->> 'provider', '') = 'google'
$function$;

comment on function public.mi_correo() is
  'Correo de la identidad de Google de quien llama (auth.identities), en minúsculas, o null. No usa el correo de auth.users: el usuario puede cambiarlo.';

-- mi_rol(): 'admin' | 'mesero' | null. Exige sesión de Google (mi_correo()) Y fila
-- activa en `personal`: un usuario por correo con el MISMO correo de un admin no
-- obtiene rol. SECURITY DEFINER para leer `personal` pese a su RLS.

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
     and p.email = (select public.mi_correo())
$function$;

comment on function public.mi_rol() is
  'Rol de quien llama (admin | mesero) o null: identidad de Google (mi_correo()) + fila activa en public.personal. Lo usan las policies y las RPC.';

-- ── 4. Quién ve `personal` y permisos de la tabla ───────────
-- El admin ve a todos; cada quien ve su propia fila (el POS lee su nombre y su
-- rol; «su fila» por la identidad de Google, no por el correo de auth.users, que
-- se puede cambiar). Sin policies de escritura: solo las RPC de abajo.

drop policy if exists personal_ver on public.personal;
create policy personal_ver on public.personal for select to authenticated
  using (
    (select public.mi_rol()) = 'admin'
    or email = (select public.mi_correo())
  );

-- Los GRANT de las tablas del POS no cambian (base.sql). Aquí solo `personal`:
-- nada para anon, el personal la lee (la RLS dice qué filas), service_role no la ve.
revoke all on public.personal from anon, authenticated, service_role;
grant select on public.personal to authenticated;

-- ── 5. Gestión del personal (solo admin) ────────────────────
-- Todas devuelven jsonb {ok, codigo?, …} en vez de lanzar, como pedirá el POS:
--   ok:false codigo = no_autorizado | no_existe | ya_existe | inactivo |
--                     ultimo_admin | correo_invalido | rol_invalido | nombre_invalido
-- Cada una toma el mismo candado de transacción y REVISA el rol después de
-- tomarlo: así dos admins que se quitan el rol a la vez no pueden dejar el
-- sistema sin admin, y uno al que le quitan el rol mientras espera no alcanza a
-- actuar.

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
  if found and v_fila.activo then
    -- Cambiar el rol de alguien activo es personal_cambiar_rol (con su guardia).
    return jsonb_build_object('ok', false, 'codigo', 'ya_existe');
  end if;

  insert into public.personal (email, nombre, rol)
  values (v_email, v_nombre, p_rol)
  on conflict (email) do update set nombre = excluded.nombre, rol = excluded.rol, activo = true
  returning * into v_fila;
  return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
end;
$function$;

create or replace function public.personal_baja(p_email text)
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
  if v_fila.rol = 'admin'
     and (select count(*) from public.personal where rol = 'admin' and activo) <= 1 then
    return jsonb_build_object('ok', false, 'codigo', 'ultimo_admin');
  end if;

  update public.personal set activo = false where email = v_email returning * into v_fila;
  return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
end;
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
  if v_fila.rol = 'admin' and p_rol <> 'admin'
     and (select count(*) from public.personal where rol = 'admin' and activo) <= 1 then
    -- Ni un admin se quita a sí mismo el último rol admin, ni nadie lo quita.
    return jsonb_build_object('ok', false, 'codigo', 'ultimo_admin');
  end if;

  update public.personal set rol = p_rol where email = v_email returning * into v_fila;
  return jsonb_build_object('ok', true, 'personal', to_jsonb(v_fila));
end;
$function$;

-- Quién puede ejecutar qué (por defecto Supabase da EXECUTE a anon).
revoke all on function public.mi_correo() from public, anon;
revoke all on function public.mi_rol() from public, anon;
revoke all on function public.personal_alta(text, text, text) from public, anon;
revoke all on function public.personal_baja(text) from public, anon;
revoke all on function public.personal_cambiar_rol(text, text) from public, anon;
grant execute on function public.mi_correo() to authenticated;
grant execute on function public.mi_rol() to authenticated, service_role;
grant execute on function public.personal_alta(text, text, text) to authenticated;
grant execute on function public.personal_baja(text) to authenticated;
grant execute on function public.personal_cambiar_rol(text, text) to authenticated;

-- ── 6. La compuerta: `solo_personal` reemplaza a `solo_google` ──
-- Va AL FINAL: es lo único del archivo que le quita acceso a alguien. La restrictiva
-- se SUMA (AND) a todas las permisivas, que no se tocan: sesión de Google y fila
-- activa en `personal`. Sin fila → sin acceso. (La condición de Google es redundante
-- con mi_rol(), que ya la exige: se deja a propósito, es la de `solo_google`.)

do $$
declare t text;
begin
  foreach t in array array['productos', 'mesas', 'ordenes', 'cierres', 'sugerencias_plato', 'personal'] loop
    execute format('drop policy if exists solo_google on public.%I', t);
    execute format('drop policy if exists solo_personal on public.%I', t);
    execute format(
      'create policy solo_personal on public.%I as restrictive for all to authenticated
         using ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'' and (select public.mi_rol()) is not null)
         with check ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'' and (select public.mi_rol()) is not null)', t);
  end loop;
end $$;

-- `menus`: la lectura es pública (menus_select_publico, de la base); la compuerta
-- cubre solo sus escrituras (ver ¹ arriba). Tres policies porque una restrictiva
-- «for all» también filtraría el SELECT.
drop policy if exists solo_google on public.menus;
drop policy if exists solo_personal_insert on public.menus;
drop policy if exists solo_personal_update on public.menus;
drop policy if exists solo_personal_delete on public.menus;
create policy solo_personal_insert on public.menus as restrictive for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' and (select public.mi_rol()) is not null);
create policy solo_personal_update on public.menus as restrictive for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' and (select public.mi_rol()) is not null)
  with check ((select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' and (select public.mi_rol()) is not null);
create policy solo_personal_delete on public.menus as restrictive for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google' and (select public.mi_rol()) is not null);
