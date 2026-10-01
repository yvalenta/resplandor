-- ════════════════════════════════════════════════════════════
-- Resplandor — roles del personal y alertas de «pedir la cuenta»
-- (pedido de Yonatan, 2026-09-30; modelo acordado de la ola A)
--
-- Qué hace
--   1. `public.personal`: quién entra al POS y con qué rol ('admin' | 'mesero').
--      Los correos reales NUNCA van en este archivo (el repo es público): el
--      alta inicial de admins llega por un ajuste de la sesión (ver §2) desde
--      un SQL aparte que pega Yonatan.
--   2. `public.mi_rol()`: el rol de quien llama, leído del correo del JWT. Se
--      consulta en cada petición, así que una baja corta el acceso al instante
--      (el JWT no lleva el rol).
--   3. `solo_google` (restrictiva) pasa a exigir además estar en `personal`
--      activo, y las policies permisivas «authenticated using (true)» de las
--      tablas del POS se reemplazan por las de rol.
--   4. `public.alertas`: el cliente elige cómo pagar (qr | transferencia |
--      efectivo) y eso CREA UNA ALERTA para el personal. La página no muestra
--      datos bancarios ni QR; el mesero cobra y cierra en el POS.
--   5. RPC para el POS: atender_alerta, descartar_alerta, personal_alta,
--      personal_baja, personal_cambiar_rol. Y una para la Edge Function
--      `alerta` (solo service_role): alertar_cuenta.
--
-- Permisos (RLS; el GRANT es el mismo de la base, lo que cambia es QUIÉN):
--
--   tabla / acción               | admin | mesero | otra cuenta Google | correo | anon
--   -----------------------------+-------+--------+--------------------+--------+------
--   productos   ver              |  sí   |  sí    |  no                |  no    |  no
--   productos   crear/editar/borrar | sí |  no    |  no                |  no    |  no
--   mesas       ver, editar      |  sí   |  sí    |  no                |  no    |  no
--   mesas       crear (nueva)    |  sí   |  no ¹  |  no                |  no    |  no
--   ordenes     ver, crear, editar |  sí |  sí    |  no                |  no    |  no
--   ordenes     borrar           |  sí   | solo abierta y vacía ²  | no  |  no    |  no
--   cierres     ver              |  sí   |  sí    |  no                |  no    |  no
--   cierres     crear/editar     |  sí   |  no    |  no                |  no    |  no
--   menus       ver              |  sí   |  sí    |  sí ³              |  sí ³  |  sí
--   menus       crear/editar/borrar | sí |  no    |  no                |  no    |  no
--   elecciones_menu, reacciones_menu ver | público (sin cambios)        |        |
--   sugerencias_plato ver        |  sí   |  no    |  no                |  no    |  no
--   personal    ver              | todo  | su fila|  no                |  no    |  no
--   personal    alta/baja/rol    | RPC   |  no    |  no                |  no    |  no
--   alertas     ver y atender    |  sí   |  sí    |  no                |  no    |  no
--   alertas     crear            | solo service_role (función `alerta`)
--
--   ¹ El POS guarda las mesas con upsert (INSERT … ON CONFLICT DO UPDATE) y
--     Postgres revisa la policy de INSERT aunque la fila ya exista. Por eso el
--     mesero tiene un INSERT que solo pasa si el id YA existe (equivale a
--     «solo editar»): no puede crear mesas nuevas.
--   ² Liberar una mesa vacía es lo único que el POS le borra. La purga del
--     cierre del día es del admin (cierre del día = admin). Así un mesero no
--     puede borrar órdenes con venta antes de que el cierre las archive.
--   ³ Lectura pública a propósito (menu.html, con o sin sesión): `menus` ya no
--     lleva la restrictiva; sus escrituras exigen `mi_rol() = 'admin'`.
--   «Caja» por ahora = admin (decisión abierta para Yonatan).
--
-- ORDEN SEGURO para no dejar a nadie afuera (lo corre Yonatan; aparca)
--   La migración se niega a correr si al terminar de leer el alta inicial no
--   hay al menos UN admin activo en `personal`: lanza una excepción ANTES de
--   tocar una sola policy. Por eso se corre así, en el SQL Editor, UNA sola vez
--   y en UNA transacción (el SQL aparte `alta-admins.sql` ya viene armado):
--
--       begin;
--       select set_config('resplandor.admins_iniciales',
--                         'correo1@…, correo2@…', true);   -- is_local = true
--       <este archivo completo>
--       commit;
--
--   · Sin correos y sin admins ya cargados → falla y queda TODO como estaba
--     (las policies viejas siguen en pie; solo pudo quedar la tabla vacía).
--   · Un marcador sin reemplazar (<CORREO_ADMIN_1>) → falla igual.
--   · Volver a correrla con admins ya cargados no necesita el ajuste, y volver a
--     correrla con él reactiva a esos admins (no toca a nadie más).
--   · Después de aplicarla, el POS actual (sin interfaz de roles) sigue
--     funcionando para un admin; para un mesero funciona todo menos lo que el
--     modelo le quita (catálogo, menús, cierre del día): esos botones tienen que
--     ocultarse en pos.html según mi_rol(), porque la base los rechaza (el
--     cierre del día, p. ej., limpiaría el turno local y fallaría al subirse).
--
-- Idempotente donde se puede. Correr en Supabase → SQL Editor (lo aplica
-- Yonatan: aparca). Va fechada DESPUÉS de 20261001120000 (cuenta en vivo,
-- otra rama) y después de las dos primeras.
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
  'Quién entra al POS. Una fila por correo de Google (minúsculas). La baja es lógica (activo = false). Se escribe SOLO con las RPC personal_alta / personal_baja / personal_cambiar_rol; la carga inicial de admins es un SQL aparte (los correos no van al repo).';

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
    raise exception 'Sin un admin activo en public.personal esta migración dejaría a todos afuera del POS. Corré el SQL aparte alta-admins.sql (alta de admins + esta migración en una sola transacción). No se cambió ninguna policy.';
  end if;
end $$;

-- ── 3. mi_rol() ─────────────────────────────────────────────
-- 'admin' | 'mesero' | null. Exige sesión de Google Y fila activa en
-- `personal`: un usuario por correo con el MISMO correo de un admin no obtiene
-- rol. SECURITY DEFINER para leer `personal` pese a su RLS; search_path vacío.

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
     and coalesce((select auth.jwt()) -> 'app_metadata' ->> 'provider', '') = 'google'
     and p.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
$function$;

comment on function public.mi_rol() is
  'Rol de quien llama (admin | mesero) o null: sesión de Google + fila activa en public.personal. Lo usan las policies y las RPC.';

-- ── 4. Alertas ──────────────────────────────────────────────

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
-- la orden abierta se borra (liberar mesa vacía) se descarta. Sin esto el panel
-- seguiría mostrando «mesa 5 pidió la cuenta» con la mesa ya libre.
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
         atendida_por = coalesce(nullif(lower(coalesce((select auth.jwt()) ->> 'email', '')), ''), 'sistema')
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

-- ── 5. Policies por rol ─────────────────────────────────────
-- Fuera las permisivas «authenticated using (true)» de la base.

drop policy if exists "authenticated full access productos" on public.productos;
drop policy if exists "authenticated full access mesas" on public.mesas;
drop policy if exists "authenticated full access ordenes" on public.ordenes;
drop policy if exists "authenticated full access cierres" on public.cierres;
drop policy if exists menus_admin on public.menus;
drop policy if exists sug_admin on public.sugerencias_plato;

-- La restrictiva se SUMA (AND) a todas las permisivas: sesión de Google y fila
-- activa en `personal`. Sin fila → sin acceso. `menus` queda fuera a propósito
-- (lectura pública también con una sesión ajena; sus escrituras ya exigen admin).
drop policy if exists solo_google on public.menus;
do $$
declare t text;
begin
  foreach t in array array['productos', 'mesas', 'ordenes', 'cierres', 'sugerencias_plato', 'personal', 'alertas'] loop
    execute format('drop policy if exists solo_google on public.%I', t);
    execute format(
      'create policy solo_google on public.%I as restrictive for all to authenticated
         using ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'' and (select public.mi_rol()) is not null)
         with check ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'' and (select public.mi_rol()) is not null)', t);
  end loop;
end $$;

-- productos: el personal ve el catálogo; solo el admin lo edita.
drop policy if exists productos_ver on public.productos;
drop policy if exists productos_crear on public.productos;
drop policy if exists productos_editar on public.productos;
drop policy if exists productos_borrar on public.productos;
create policy productos_ver on public.productos for select to authenticated
  using ((select public.mi_rol()) is not null);
create policy productos_crear on public.productos for insert to authenticated
  with check ((select public.mi_rol()) = 'admin');
create policy productos_editar on public.productos for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');
create policy productos_borrar on public.productos for delete to authenticated
  using ((select public.mi_rol()) = 'admin');

-- mesas: todo el personal las ve y las edita (estado, token); crear mesas nuevas
-- es del admin. El INSERT del mesero solo pasa si el id ya existe (ver ¹ arriba).
-- Va por una función porque una policy de `mesas` que consulta `mesas` directo
-- da «infinite recursion detected in policy» (probado en Postgres 17).
create or replace function public.mesa_existe(p_id integer)
 returns boolean
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select public.mi_rol() is not null
     and exists (select 1 from public.mesas m where m.id = p_id)
$function$;

drop policy if exists mesas_ver on public.mesas;
drop policy if exists mesas_crear on public.mesas;
drop policy if exists mesas_editar on public.mesas;
create policy mesas_ver on public.mesas for select to authenticated
  using ((select public.mi_rol()) is not null);
create policy mesas_crear on public.mesas for insert to authenticated
  with check (
    (select public.mi_rol()) = 'admin'
    or ((select public.mi_rol()) = 'mesero' and public.mesa_existe(id))
  );
create policy mesas_editar on public.mesas for update to authenticated
  using ((select public.mi_rol()) is not null) with check ((select public.mi_rol()) is not null);

-- ordenes: el personal las ve, las crea y las edita (cobrar y cerrar es un
-- UPDATE; aplicar_delta_orden corre como quien llama). Borrar: el admin todo; el
-- mesero solo una orden abierta y vacía (liberar mesa sin cobrar).
drop policy if exists ordenes_ver on public.ordenes;
drop policy if exists ordenes_crear on public.ordenes;
drop policy if exists ordenes_editar on public.ordenes;
drop policy if exists ordenes_borrar on public.ordenes;
create policy ordenes_ver on public.ordenes for select to authenticated
  using ((select public.mi_rol()) is not null);
create policy ordenes_crear on public.ordenes for insert to authenticated
  with check ((select public.mi_rol()) is not null);
create policy ordenes_editar on public.ordenes for update to authenticated
  using ((select public.mi_rol()) is not null) with check ((select public.mi_rol()) is not null);
create policy ordenes_borrar on public.ordenes for delete to authenticated
  using (
    (select public.mi_rol()) = 'admin'
    or ((select public.mi_rol()) = 'mesero' and estado = 'abierta' and items = '[]'::jsonb)
  );

-- cierres: el personal ve el historial; el cierre del día lo escribe el admin
-- (el POS usa upsert: INSERT y UPDATE).
drop policy if exists cierres_ver on public.cierres;
drop policy if exists cierres_crear on public.cierres;
drop policy if exists cierres_editar on public.cierres;
create policy cierres_ver on public.cierres for select to authenticated
  using ((select public.mi_rol()) is not null);
create policy cierres_crear on public.cierres for insert to authenticated
  with check ((select public.mi_rol()) = 'admin');
create policy cierres_editar on public.cierres for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');

-- menus: la lectura pública (menus_select_publico, de la base) se queda; la
-- programación semanal es del admin.
drop policy if exists menus_crear on public.menus;
drop policy if exists menus_editar on public.menus;
drop policy if exists menus_borrar on public.menus;
create policy menus_crear on public.menus for insert to authenticated
  with check ((select public.mi_rol()) = 'admin');
create policy menus_editar on public.menus for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');
create policy menus_borrar on public.menus for delete to authenticated
  using ((select public.mi_rol()) = 'admin');

-- sugerencias_plato: solo las lee el admin (entran por la Edge Function votar).
drop policy if exists sugerencias_ver_admin on public.sugerencias_plato;
create policy sugerencias_ver_admin on public.sugerencias_plato for select to authenticated
  using ((select public.mi_rol()) = 'admin');

-- personal: el admin ve a todos; cada quien ve su propia fila (el POS lee su
-- nombre y su rol). Sin policies de escritura: solo las RPC.
drop policy if exists personal_ver on public.personal;
create policy personal_ver on public.personal for select to authenticated
  using (
    (select public.mi_rol()) = 'admin'
    or email = (select lower(coalesce(auth.jwt() ->> 'email', '')))
  );

-- alertas: el personal las ve (y Realtime se las entrega). Sin policies de
-- escritura: crea service_role, atienden las RPC.
drop policy if exists alertas_ver on public.alertas;
create policy alertas_ver on public.alertas for select to authenticated
  using ((select public.mi_rol()) is not null);

-- ── 6. Permisos (GRANT) ─────────────────────────────────────
-- Los de las tablas del POS no cambian (base.sql): lo que cambia es QUIÉN, vía
-- las policies de arriba. Aquí solo las dos tablas nuevas.

revoke all on public.personal, public.alertas from anon, authenticated, service_role;
grant select on public.personal, public.alertas to authenticated;
-- La función `alerta` (service role) crea y actualiza; no borra ni lee personal.
grant select, insert, update on public.alertas to service_role;

-- ── 7. RPC ──────────────────────────────────────────────────
-- Todas devuelven jsonb {ok, codigo?, …} en vez de lanzar, como pedirá el POS:
--   ok:false codigo = no_autorizado | no_existe | no_pendiente | ya_existe |
--                     inactivo | ultimo_admin | correo_invalido | rol_invalido |
--                     nombre_invalido | enlace_invalido | sin_cuenta | metodo_invalido

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
         atendida_por = lower(coalesce((select auth.jwt()) ->> 'email', ''))
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

-- Gestión del personal (solo admin). Cada una toma el mismo candado de
-- transacción y REVISA el rol después de tomarlo: así dos admins que se quitan
-- el rol a la vez no pueden dejar el sistema sin admin, y uno al que le quitan
-- el rol mientras espera no alcanza a actuar.

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

-- Para la Edge Function `alerta` (service_role): valida el par (mesa, token),
-- exige una orden abierta y deja UNA alerta pendiente por mesa. Todo en una
-- sentencia atómica: dos toques a la vez no chocan con el índice único, el
-- segundo actualiza método y hora. SECURITY INVOKER: corre como service_role.
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

  insert into public.alertas (mesa_id, orden_id, tipo, metodo)
  values (p_mesa, v_orden, 'pedir_cuenta', p_metodo)
  on conflict (mesa_id) where (estado = 'pendiente')
  do update set metodo = excluded.metodo, orden_id = excluded.orden_id, creada_en = now()
  returning * into a;

  return jsonb_build_object('ok', true, 'metodo', a.metodo, 'creada_en', a.creada_en,
                            'alerta_id', a.id, 'orden_id', a.orden_id);
end;
$function$;

-- Quién puede ejecutar qué (por defecto Supabase da EXECUTE a anon).
revoke all on function public.mi_rol() from public, anon;
revoke all on function public.mesa_existe(integer) from public, anon;
revoke all on function public.resolver_alerta(uuid, text) from public, anon, authenticated;
revoke all on function public.atender_alerta(uuid) from public, anon;
revoke all on function public.descartar_alerta(uuid) from public, anon;
revoke all on function public.personal_alta(text, text, text) from public, anon;
revoke all on function public.personal_baja(text) from public, anon;
revoke all on function public.personal_cambiar_rol(text, text) from public, anon;
revoke all on function public.alertar_cuenta(integer, text, text) from public, anon, authenticated;
revoke all on function public.resolver_alertas_de_mesa() from public, anon, authenticated;
grant execute on function public.mi_rol() to authenticated, service_role;
grant execute on function public.mesa_existe(integer) to authenticated;
grant execute on function public.atender_alerta(uuid) to authenticated;
grant execute on function public.descartar_alerta(uuid) to authenticated;
grant execute on function public.personal_alta(text, text, text) to authenticated;
grant execute on function public.personal_baja(text) to authenticated;
grant execute on function public.personal_cambiar_rol(text, text) to authenticated;
grant execute on function public.alertar_cuenta(integer, text, text) to service_role;

-- ── 8. Realtime: el POS recibe las alertas al instante ──────
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
