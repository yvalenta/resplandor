-- ════════════════════════════════════════════════════════════
-- Resplandor — MESAS Y PEGATINAS desde el panel de admin (2 de 4 de la ola C)
-- (pedido de Yonatan, 2026-09-30: «en el panel administrativo debemos poder añadir y editar pegatinas»)
--
--   1. 20261002150000_aprobacion_personal.sql      quién entra, con aprobación.
--   2. 20261002160000_mesas_y_pegatinas.sql     ← ESTA.
--   3. 20261002170000_ajustes_ticket.sql           la URL del QR y el pie del ticket.
--   4. 20261002180000_deshacer_cobro.sql           devolver un cobro parcial o un abono a la cuenta.
--
-- Qué hace
--   1. Tres columnas en `mesas`: `activa` (boolean, por defecto true), `pegatina_escrita_en` y
--      `pegatina_revisada_en` (cuándo se escribió y cuándo se comprobó la pegatina NFC de esa mesa).
--   2. Cuatro RPC, solo admin, que devuelven jsonb {ok, codigo, …} en vez de lanzar:
--        mesa_crear(p_id, p_capacidad)      → {ok, id}            (el token sale del default de la tabla)
--        mesa_editar(p_id, p_capacidad)     → {ok, id, capacidad}
--        mesa_activar(p_id, p_activa)       → {ok, id, activa}    (no desactiva una mesa con cuenta abierta)
--        pegatina_marcar(p_id, p_tipo, p_token) → {ok, id, pegatina_escrita_en, pegatina_revisada_en}
--                                              p_tipo = 'escrita' | 'revisada'; p_token = el token que de verdad se
--                                              ESCRIBIÓ en la pegatina o se LEYÓ de ella. Si ya no es el de la mesa
--                                              (alguien giró el enlace mientras tanto), no marca nada y responde
--                                              `enlace_cambio`: la pegatina quedó con el enlace viejo (refutación de
--                                              la ola C, hallazgo 3: una pegatina quedaba «Escrita» y «Revisada» con
--                                              el token viejo y la carta respondía «este enlace ya no sirve»).
--      codigo = no_autorizado | id_invalido | capacidad_invalida | ya_existe | no_existe | activa_invalida |
--               con_cuenta_abierta | tipo_invalido | token_invalido | enlace_cambio.
--   3. Una mesa INACTIVA no existe para el comensal: `alertar_cuenta` la rechaza como `enlace_invalido` (la Edge
--      Function `cuenta` hace lo mismo: ver supabase/functions/cuenta/index.ts) y `vista_pendiente()` no la lista.
--      El POS tampoco la muestra en el mapa del salón (sí en el panel de admin).
--   4. Girar el token de una mesa (rotarTokenMesa del POS, solo admin) deja la pegatina física con el enlace VIEJO:
--      el disparador `trg_mesas_pegatina_obsoleta` pone `pegatina_escrita_en` y `pegatina_revisada_en` en null, y el
--      panel ve «hay que volver a escribirla». La rotación en sí no cambia.
--   5. Las tres columnas nuevas son del admin, como el token (D24): el disparador `trg_mesas_columnas_solo_admin`
--      conserva el valor viejo (sin error: el upsert de una caché vieja no se rompe) si quien las cambia es un
--      mesero. Y, venga de quien venga el cambio (admin por la API, el SQL Editor), no deja desactivar una mesa que
--      tiene una cuenta abierta: es la red de seguridad de mesa_activar, que responde con su propio código.
--   6. La capacidad de una mesa va de 1 a 50 (`mesas_capacidad_rango`, como ya exigían las RPC) y solo la cambia
--      mesa_editar: el mismo disparador de arriba conserva la capacidad vieja cuando la cambia CUALQUIER sesión de la API,
--      mesero o admin. Sin esto, un mesero con `update mesas set capacidad = 999` la dejaba en 999, y el upsert de una
--      tablet con la caché vieja (también la de la caja, que es admin) deshacía una edición (refutación de la ola C,
--      hallazgos 5 de la ronda 1 y 6 de la ronda 2).
--
--   acción                              | admin | mesero | pendiente / ajeno | anon
--   ------------------------------------+-------+--------+--------------------+------
--   mesas  ver, editar estado           |  sí   |  sí    |  no                |  no   (ola B, sin cambios)
--   mesa_crear / _editar / _activar     |  sí   |  no_autorizado | no_autorizado | no
--   pegatina_marcar                     |  sí   |  no_autorizado | no_autorizado | no
--   girar el token                      |  sí   |  se ignora (trg_mesas_token_solo_admin)  | no | no
--   activa / pegatina_* por UPDATE      |  sí   |  se ignora (trg_mesas_columnas_solo_admin) | no | no
--   capacidad por UPDATE de la API      |  se ignora (solo mesa_editar la cambia) | se ignora | no | no
--
-- Qué NO hace (a propósito)
--   · No impide que una tablet con la lista vieja abra una orden en una mesa que se acaba de desactivar: bloquearlo
--     con un disparador haría fallar el guardado del POS de esa tablet, que no sabe qué hacer con ese error.
--     `mesa_activar(false)` rechaza la mesa que YA tiene una cuenta abierta; el caso de la tablet atrasada deja una
--     cuenta abierta e invisible hasta que se reactive la mesa (el panel de admin la sigue viendo «ocupada»).
--   · No borra mesas (la FK de `ordenes` no tiene cascade): se desactivan.
--
-- Necesita 20261002150000 (reemplaza vista_pendiente()) y 20261002130000 (reemplaza alertar_cuenta): si falta
-- alguna, se niega a correr SIN cambiar nada. Idempotente. Aplicarla antes del POS que la usa es inocuo: las
-- mesas de hoy quedan activas, y la función `cuenta` vieja (que no mira `activa`) sigue sirviendo igual.
--
-- Si se vuelve a pegar 20261002130000 (alertas) DESPUÉS de esta, alertar_cuenta pierde la regla de las mesas inactivas: volver
-- a pegar ESTA enseguida (es idempotente).
--
-- ORDEN con la función `cuenta`: esta migración primero, la función después. La función nueva también funciona
-- si la columna todavía no existe (cae a la consulta de antes), pero hasta que se despliegue una mesa inactiva
-- seguiría respondiendo su cuenta.
--
-- REVERSA (menos de 1 minuto; devuelve alertar_cuenta y vista_pendiente tal cual eran y quita lo de este archivo.
-- Se corre ANTES de la reversa de 20261002150000, que es la que quita vista_pendiente):
--
--   begin;
--   drop trigger if exists trg_mesas_pegatina_obsoleta on public.mesas;
--   drop trigger if exists trg_mesas_columnas_solo_admin on public.mesas;
--   drop function if exists public.mesas_pegatina_obsoleta();
--   drop function if exists public.mesas_columnas_solo_admin();
--   drop function if exists public.mesa_crear(integer, integer);
--   drop function if exists public.mesa_editar(integer, integer);
--   drop function if exists public.mesa_activar(integer, boolean);
--   drop function if exists public.pegatina_marcar(integer, text, text);
--   alter table public.mesas drop constraint if exists mesas_capacidad_rango;
--   create or replace function public.vista_pendiente()
--    returns table(id integer, capacidad integer, estado text)
--    language sql
--    stable
--    security definer
--    set search_path = ''
--   as $function$
--     select m.id, m.capacidad, m.estado
--       from public.mesas m
--      where coalesce((select auth.jwt()) -> 'app_metadata' ->> 'provider', '') = 'google'
--      order by m.id
--   $function$;
--   create or replace function public.alertar_cuenta(p_mesa integer, p_token text, p_metodo text)
--    returns jsonb
--    language plpgsql
--    set search_path = ''
--   as $function$
--   declare
--     v_orden text;
--     a public.alertas;
--   begin
--     if p_metodo is null or p_metodo <> all (array['qr', 'transferencia', 'efectivo']) then
--       return jsonb_build_object('ok', false, 'codigo', 'metodo_invalido');
--     end if;
--     if p_mesa is null or p_token is null
--        or not exists (select 1 from public.mesas m where m.id = p_mesa and m.token = p_token) then
--       return jsonb_build_object('ok', false, 'codigo', 'enlace_invalido');
--     end if;
--     select o.id into v_orden
--       from public.ordenes o
--      where o.mesa_id = p_mesa
--        and o.estado = 'abierta'
--      order by o.abierta_en desc
--      limit 1
--        for share;
--     if v_orden is null then
--       return jsonb_build_object('ok', false, 'codigo', 'sin_cuenta');
--     end if;
--     if not exists (select 1 from public.alertas x where x.mesa_id = p_mesa and x.estado = 'pendiente')
--        and (select count(*) from public.alertas x where x.orden_id = v_orden) >= 5 then
--       return jsonb_build_object('ok', false, 'codigo', 'tope');
--     end if;
--     insert into public.alertas as t (mesa_id, orden_id, tipo, metodo)
--     values (p_mesa, v_orden, 'pedir_cuenta', p_metodo)
--     on conflict (mesa_id) where (estado = 'pendiente')
--     do update set metodo = excluded.metodo, orden_id = excluded.orden_id, creada_en = now()
--        where t.metodo is distinct from excluded.metodo
--           or t.orden_id is distinct from excluded.orden_id
--     returning * into a;
--     if not found then
--       select * into a from public.alertas where mesa_id = p_mesa and estado = 'pendiente';
--     end if;
--     return jsonb_build_object('ok', true, 'metodo', a.metodo, 'creada_en', a.creada_en,
--                               'alerta_id', a.id, 'orden_id', a.orden_id);
--   end;
--   $function$;
--   alter table public.mesas drop column if exists pegatina_revisada_en;
--   alter table public.mesas drop column if exists pegatina_escrita_en;
--   alter table public.mesas drop column if exists activa;
--   commit;
--
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ───────────────────────────────────────────

do $$
begin
  if to_regprocedure('public.vista_pendiente()') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'personal' and column_name = 'estado') then
    raise exception 'Falta 20261002150000_aprobacion_personal.sql (personal.estado y vista_pendiente()): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.alertar_cuenta(integer,text,text)') is null then
    raise exception 'Falta 20261002130000_alertas.sql (alertar_cuenta): aplicala primero. No se cambió nada.';
  end if;
  -- El tope de capacidad (1 a 50) no se agrega sobre datos que ya lo incumplen: una mesa así no podría volver a guardarse.
  if exists (select 1 from public.mesas m where m.capacidad < 1 or m.capacidad > 50) then
    raise exception 'Hay mesas con capacidad fuera de 1 a 50 (%): corregilas antes. No se cambió nada.',
      (select string_agg(m.id::text || '=' || m.capacidad::text, ', ' order by m.id)
         from public.mesas m where m.capacidad < 1 or m.capacidad > 50);
  end if;
end $$;

-- ── 1. Columnas de `mesas` ──────────────────────────────────

alter table public.mesas add column if not exists activa boolean not null default true;
alter table public.mesas add column if not exists pegatina_escrita_en timestamp with time zone;
alter table public.mesas add column if not exists pegatina_revisada_en timestamp with time zone;

alter table public.mesas drop constraint if exists mesas_capacidad_rango;
alter table public.mesas add constraint mesas_capacidad_rango check (capacidad between 1 and 50);

comment on column public.mesas.activa is
  'false = la mesa salió del salón: no sale en el mapa del POS, su enlace de la pegatina deja de servir (cuenta y alerta responden enlace inválido) y vista_pendiente() no la lista. Se cambia con mesa_activar (no si tiene una cuenta abierta).';
comment on column public.mesas.pegatina_escrita_en is
  'Cuándo se escribió la pegatina NFC con el enlace ACTUAL de esta mesa (pegatina_marcar). Se pone en null al girar el token: la pegatina física quedó con el enlace viejo.';
comment on column public.mesas.pegatina_revisada_en is
  'Cuándo se leyó la pegatina y se comprobó que trae el enlace de esta mesa (pegatina_marcar). Se pone en null al escribirla de nuevo o al girar el token.';

-- ── 2. RPC de mesas y pegatinas (solo admin) ────────────────
-- El número de mesa va de 1 a 9999 (el enlace de la carta lo exige de 1 a 4 dígitos, supabase/functions/_compartido/mesa.js)
-- y la capacidad de 1 a 50.

create or replace function public.mesa_crear(p_id integer, p_capacidad integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_id integer;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_id is null or p_id < 1 or p_id > 9999 then
    return jsonb_build_object('ok', false, 'codigo', 'id_invalido');
  end if;
  if p_capacidad is null or p_capacidad < 1 or p_capacidad > 50 then
    return jsonb_build_object('ok', false, 'codigo', 'capacidad_invalida');
  end if;

  -- El token sale del default de la columna (48 hex al azar). Dos admins a la vez: gana uno, el otro recibe ya_existe.
  insert into public.mesas (id, capacidad, estado)
  values (p_id, p_capacidad, 'libre')
  on conflict (id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'codigo', 'ya_existe');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;

create or replace function public.mesa_editar(p_id integer, p_capacidad integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_id integer;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_capacidad is null or p_capacidad < 1 or p_capacidad > 50 then
    return jsonb_build_object('ok', false, 'codigo', 'capacidad_invalida');
  end if;

  update public.mesas set capacidad = p_capacidad where id = p_id returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'capacidad', p_capacidad);
end;
$function$;

-- Desactivar con una cuenta abierta no se deja. El FOR UPDATE sobre la mesa espera a quien esté abriendo una
-- orden en ese instante (la clave foránea de `ordenes` toma un candado compartido sobre la fila de la mesa).
create or replace function public.mesa_activar(p_id integer, p_activa boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_mesa public.mesas;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_activa is null then
    return jsonb_build_object('ok', false, 'codigo', 'activa_invalida');
  end if;

  select * into v_mesa from public.mesas where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  -- Solo al PASAR de activa a inactiva: desactivar lo que ya está inactivo (un doble toque) no es un error.
  if not p_activa and v_mesa.activa
     and exists (select 1 from public.ordenes o where o.mesa_id = p_id and o.estado = 'abierta') then
    return jsonb_build_object('ok', false, 'codigo', 'con_cuenta_abierta');
  end if;

  update public.mesas set activa = p_activa where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'activa', p_activa);
end;
$function$;

-- 'escrita': se escribió la pegatina con el enlace actual; la revisión anterior ya no vale (el contenido cambió).
-- 'revisada': se leyó y trae el enlace de esta mesa.
-- `p_token` es el token que de verdad quedó escrito o se leyó. Si la mesa ya tiene otro (se giró el enlace mientras tanto, desde
-- otro dispositivo), no se marca nada: la pegatina física quedó con un enlace que la carta ya no acepta.
-- Se reemplaza la de dos parámetros (si no, PostgREST ve dos candidatas: PGRST203).
drop function if exists public.pegatina_marcar(integer, text);

create or replace function public.pegatina_marcar(p_id integer, p_tipo text, p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_mesa public.mesas;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_tipo is null or p_tipo <> all (array['escrita', 'revisada']) then
    return jsonb_build_object('ok', false, 'codigo', 'tipo_invalido');
  end if;
  if p_token is null or p_token = '' then
    return jsonb_build_object('ok', false, 'codigo', 'token_invalido');
  end if;

  select * into v_mesa from public.mesas where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  if v_mesa.token <> p_token then
    return jsonb_build_object('ok', false, 'codigo', 'enlace_cambio');
  end if;

  if p_tipo = 'escrita' then
    update public.mesas set pegatina_escrita_en = now(), pegatina_revisada_en = null
     where id = p_id returning * into v_mesa;
  else
    update public.mesas set pegatina_revisada_en = now()
     where id = p_id returning * into v_mesa;
  end if;
  return jsonb_build_object('ok', true, 'id', v_mesa.id,
                            'pegatina_escrita_en', v_mesa.pegatina_escrita_en,
                            'pegatina_revisada_en', v_mesa.pegatina_revisada_en);
end;
$function$;

-- ── 3. Girar el token deja la pegatina vieja ────────────────
-- Se dispara después de trg_mesas_token_solo_admin (que le devuelve el token viejo a quien no es admin) o antes:
-- no importa, porque repite su misma condición y solo actúa si el token de verdad cambió Y lo cambia un admin (o
-- quien no es sesión de la API: el dueño en el SQL Editor, service_role).

create or replace function public.mesas_pegatina_obsoleta()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  if new.token is distinct from old.token
     and not (current_user in ('anon', 'authenticated') and (select public.mi_rol()) is distinct from 'admin') then
    new.pegatina_escrita_en := null;
    new.pegatina_revisada_en := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_mesas_pegatina_obsoleta on public.mesas;
create trigger trg_mesas_pegatina_obsoleta
  before update of token on public.mesas
  for each row
  when (old.token is distinct from new.token)
  execute function public.mesas_pegatina_obsoleta();

-- ── 3b. Las columnas nuevas son del admin ──────────────────
-- Igual que el token (permisos_por_rol, D24): un GRANT por columna no sirve (mesero y admin son el mismo rol de
-- Postgres) y lanzar un error rompería el upsert de una caché vieja, así que conserva el valor viejo. Quien no es
-- sesión de la API (el dueño en el SQL Editor, service_role, las funciones SECURITY DEFINER de arriba) no se frena
-- por esto. La CAPACIDAD se conserva para toda sesión de la API, también la del admin: solo la cambia mesa_editar. La segunda parte vale para todos: una mesa con cuenta abierta no se desactiva (SQLSTATE RS002).
-- Solo se dispara si el UPDATE nombra alguna de las tres columnas Y alguna cambia: el upsert del POS
-- ({id, capacidad, estado}) nunca la toca.

create or replace function public.mesas_columnas_solo_admin()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    -- La capacidad solo la cambia mesa_editar (SECURITY DEFINER: no es sesión de la API). Un upsert del POS ({id, capacidad,
    -- estado}) con la capacidad de una caché vieja la devolvía a lo de antes, también cuando lo hacía un admin (la caja):
    -- se conserva la de la base para TODA sesión de la API (refutación de la ola C, ronda 2, hallazgo 6).
    new.capacidad := old.capacidad;
    if (select public.mi_rol()) is distinct from 'admin' then
      new.activa := old.activa;
      new.pegatina_escrita_en := old.pegatina_escrita_en;
      new.pegatina_revisada_en := old.pegatina_revisada_en;
      return new;
    end if;
  end if;
  if old.activa and not new.activa
     and exists (select 1 from public.ordenes o where o.mesa_id = new.id and o.estado = 'abierta') then
    raise exception 'la mesa % tiene una cuenta abierta: no se desactiva', new.id
      using errcode = 'RS002';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_mesas_columnas_solo_admin on public.mesas;
create trigger trg_mesas_columnas_solo_admin
  before update of activa, capacidad, pegatina_escrita_en, pegatina_revisada_en on public.mesas
  for each row
  when (old.activa is distinct from new.activa
        or old.capacidad is distinct from new.capacidad
        or old.pegatina_escrita_en is distinct from new.pegatina_escrita_en
        or old.pegatina_revisada_en is distinct from new.pegatina_revisada_en)
  execute function public.mesas_columnas_solo_admin();

-- ── 4. Una mesa inactiva no existe para el comensal ─────────
-- vista_pendiente(): solo mesas activas.

create or replace function public.vista_pendiente()
 returns table(id integer, capacidad integer, estado text)
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select m.id, m.capacidad, m.estado
    from public.mesas m
   where m.activa
     and coalesce((select auth.jwt()) -> 'app_metadata' ->> 'provider', '') = 'google'
   order by m.id
$function$;

-- alertar_cuenta(): el cuerpo de la migración de alertas, con una condición más: `and m.activa`.
-- SECURITY INVOKER: corre como service_role (Edge Function `alerta`).
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

  -- Una mesa inactiva responde igual que un enlace que no existe.
  if p_mesa is null or p_token is null
     or not exists (select 1 from public.mesas m where m.id = p_mesa and m.token = p_token and m.activa) then
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
  -- las tablets. Con otro método sí actualiza método y hora.
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

-- ── 5. Quién puede ejecutar qué ─────────────────────────────

revoke all on function public.mesa_crear(integer, integer) from public, anon, service_role;
revoke all on function public.mesa_editar(integer, integer) from public, anon, service_role;
revoke all on function public.mesa_activar(integer, boolean) from public, anon, service_role;
revoke all on function public.pegatina_marcar(integer, text, text) from public, anon, service_role;
revoke all on function public.mesas_pegatina_obsoleta() from public, anon, authenticated;
revoke all on function public.mesas_columnas_solo_admin() from public, anon, authenticated;
revoke all on function public.vista_pendiente() from public, anon, service_role;
revoke all on function public.alertar_cuenta(integer, text, text) from public, anon, authenticated;
grant execute on function public.mesa_crear(integer, integer) to authenticated;
grant execute on function public.mesa_editar(integer, integer) to authenticated;
grant execute on function public.mesa_activar(integer, boolean) to authenticated;
grant execute on function public.pegatina_marcar(integer, text, text) to authenticated;
grant execute on function public.vista_pendiente() to authenticated;
grant execute on function public.alertar_cuenta(integer, text, text) to service_role;
