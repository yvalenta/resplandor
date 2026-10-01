-- ════════════════════════════════════════════════════════════
-- Resplandor — base del esquema (tarea tareas/2026-09-29-supabase-propio.md)
--
-- La forma VIVA del proyecto viejo (yjtcrhmdztbuylgpuvsm), leída de los
-- catálogos el 2026-09-30, para recrearla en el proyecto nuevo. Antes de
-- este archivo el esquema solo existía disperso: resplandor_bd.sql,
-- docs/pos_concurrencia.sql y lo que se editó a mano en el dashboard.
-- Va fechada ANTES de 20260906120000_carta_publica_y_token_mesa.sql porque
-- esa migración altera `productos` y `mesas`.
--
-- Orden en el proyecto nuevo (SQL Editor; lo corre Yonatan):
--   1. este archivo            2. datos.sql (respaldo, fuera del repo)
--   3. correcciones de carta   4. 20260906120000_carta_publica_y_token_mesa.sql
--
-- Cinco diferencias con el proyecto viejo, a propósito:
--   · GRANT explícitos y mínimos. Desde 2026-05 los proyectos nuevos de
--     Supabase no dan permisos automáticos sobre tablas nuevas a anon,
--     authenticated ni service_role; sin estos GRANT el POS falla en
--     silencio (supabase-js devuelve el error sin lanzarlo).
--   · Policy restrictiva solo_google en las tablas del POS (ver abajo).
--   · search_path fijo en las funciones (advisor function_search_path_mutable).
--   · Sin la policy sug_select_admin: repetía lo que ya da sug_admin
--     (advisor multiple_permissive_policies).
--   · Sin WodRide (depurado el 2026-09-30) ni la función huérfana
--     set_actualizado_en.
-- ════════════════════════════════════════════════════════════

-- ── Tablas ──────────────────────────────────────────────────

create table public.productos (
  id text not null,
  categoria text not null,
  nombre text not null,
  precio integer not null,
  descripcion text default ''::text,
  activo boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint productos_pkey primary key (id)
);

create table public.mesas (
  id integer not null,
  capacidad integer not null,
  estado text not null default 'libre'::text,
  updated_at timestamp with time zone not null default now(),
  constraint mesas_pkey primary key (id),
  constraint mesas_estado_check check ((estado = any (array['libre'::text, 'ocupada'::text])))
);

create table public.menus (
  id text not null,
  semana date not null,
  dia smallint not null,
  opcion smallint not null,
  etiqueta text default ''::text,
  principal text not null,
  sopa text default ''::text,
  guarnicion text default ''::text,
  ensalada text default ''::text,
  jugo text default ''::text,
  fijo boolean default false,
  activo boolean default true,
  created_at timestamp with time zone default now(),
  constraint menus_pkey primary key (id),
  constraint menus_semana_dia_opcion_key unique (semana, dia, opcion),
  constraint menus_dia_check check (((dia >= 1) and (dia <= 6))),
  constraint menus_opcion_check check (((opcion >= 1) and (opcion <= 3)))
);

create table public.elecciones_menu (
  id text not null,
  semana date not null,
  dia smallint not null,
  opcion_elegida smallint not null,
  device_id text not null,
  created_at timestamp with time zone default now(),
  constraint elecciones_menu_pkey primary key (id),
  constraint elecciones_menu_semana_dia_device_id_key unique (semana, dia, device_id),
  constraint elecciones_menu_dia_check check (((dia >= 1) and (dia <= 6))),
  constraint elecciones_menu_opcion_elegida_check check ((opcion_elegida = any (array[1, 2])))
);

create table public.reacciones_menu (
  id text not null,
  menu_id text not null,
  tipo text not null,
  dia_sugerido smallint,
  comentario text default ''::text,
  device_id text not null,
  created_at timestamp with time zone default now(),
  constraint reacciones_menu_pkey primary key (id),
  constraint reacciones_menu_menu_id_device_id_key unique (menu_id, device_id),
  constraint reacciones_menu_dia_sugerido_check check (((dia_sugerido >= 1) and (dia_sugerido <= 6))),
  constraint reacciones_menu_tipo_check check ((tipo = 'mover'::text)),
  constraint reacciones_menu_menu_id_fkey foreign key (menu_id) references public.menus(id) on delete cascade
);

create table public.sugerencias_plato (
  id text not null,
  semana date not null,
  dia smallint,
  texto text not null,
  device_id text not null,
  created_at timestamp with time zone default now(),
  constraint sugerencias_plato_pkey primary key (id),
  constraint sugerencias_plato_dia_check check (((dia >= 1) and (dia <= 6)))
);

create table public.ordenes (
  id text not null,
  mesa_id integer not null,
  estado text not null default 'abierta'::text,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  abierta_en timestamp with time zone not null default now(),
  cerrada_en timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  version integer not null default 0,
  constraint ordenes_pkey primary key (id),
  constraint ordenes_estado_check check ((estado = any (array['abierta'::text, 'cerrada'::text]))),
  constraint ordenes_mesa_id_fkey foreign key (mesa_id) references public.mesas(id)
);

create table public.cierres (
  id text not null,
  fecha timestamp with time zone not null,
  total_ventas numeric not null default 0,
  total_ordenes integer not null default 0,
  transacciones jsonb not null default '[]'::jsonb,
  creado_en timestamp with time zone not null default now(),
  constraint cierres_pkey primary key (id)
);

create index idx_cierres_fecha on public.cierres using btree (fecha desc);
create index idx_ordenes_estado on public.ordenes using btree (estado);
create index idx_ordenes_mesa on public.ordenes using btree (mesa_id);
-- Una sola orden abierta por mesa, arbitrada por la base (README §11.2).
create unique index ux_ordenes_una_abierta_por_mesa on public.ordenes using btree (mesa_id) where (estado = 'abierta'::text);

-- ── Funciones y triggers ────────────────────────────────────

create or replace function public.tocar_updated_at()
 returns trigger
 language plpgsql
 set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- Delta atómico sobre los ítems de una orden (docs/pos_concurrencia.sql).
create or replace function public.aplicar_delta_orden(p_orden_id text, p_item_id text, p_nombre text, p_precio numeric, p_delta integer, p_nota text default ''::text)
 returns public.ordenes
 language plpgsql
 set search_path = public
as $function$
declare
  o      ordenes;
  nuevos jsonb;
  existe boolean;
begin
  select * into o from ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'orden % no existe', p_orden_id;
  end if;

  select exists(
    select 1 from jsonb_array_elements(o.items) e where e->>'id' = p_item_id
  ) into existe;

  if existe then
    -- Ajusta qty; conserva el resto de campos del ítem (nombre, precio, nota).
    select coalesce(jsonb_agg(x), '[]'::jsonb) into nuevos
    from (
      select case when e->>'id' = p_item_id
                  then jsonb_set(e, '{qty}', to_jsonb(greatest(0, (e->>'qty')::int + p_delta)))
                  else e end as x
      from jsonb_array_elements(o.items) e
    ) s
    where (x->>'qty')::int > 0;
  else
    nuevos := case when p_delta > 0
      then o.items || jsonb_build_array(
             jsonb_build_object('id', p_item_id, 'nombre', p_nombre,
                                'precio', p_precio, 'qty', p_delta, 'nota', coalesce(p_nota, '')))
      else o.items end;
  end if;

  update ordenes
     set items = nuevos,
         total = (select coalesce(sum((e->>'precio')::numeric * (e->>'qty')::int), 0)
                  from jsonb_array_elements(nuevos) e),
         version = coalesce(o.version, 0) + 1,
         updated_at = now()
   where id = p_orden_id
  returning * into o;

  return o;
end $function$;

create or replace function public.actualizar_nota_item(p_orden_id text, p_item_id text, p_nota text)
 returns public.ordenes
 language plpgsql
 set search_path = public
as $function$
declare
  o      ordenes;
  nuevos jsonb;
begin
  select * into o from ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'orden % no existe', p_orden_id;
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into nuevos
  from (
    select case when e->>'id' = p_item_id
                then jsonb_set(e, '{nota}', to_jsonb(coalesce(p_nota, '')))
                else e end as x
    from jsonb_array_elements(o.items) e
  ) s;

  update ordenes
     set items = nuevos,
         version = coalesce(o.version, 0) + 1,
         updated_at = now()
   where id = p_orden_id
  returning * into o;

  return o;
end $function$;

-- BEFORE UPDATE: no se disparan con los INSERT de datos.sql, así que la
-- carga conserva los updated_at originales.
create trigger trg_mesas_updated_at before update on public.mesas for each row execute function public.tocar_updated_at();
create trigger trg_ordenes_updated_at before update on public.ordenes for each row execute function public.tocar_updated_at();
create trigger trg_productos_updated_at before update on public.productos for each row execute function public.tocar_updated_at();

-- ── RLS y policies (README §07: cero acceso anon a las tablas del POS) ──

alter table public.productos enable row level security;
alter table public.mesas enable row level security;
alter table public.ordenes enable row level security;
alter table public.cierres enable row level security;
alter table public.menus enable row level security;
alter table public.elecciones_menu enable row level security;
alter table public.reacciones_menu enable row level security;
alter table public.sugerencias_plato enable row level security;

create policy "authenticated full access productos" on public.productos for all to authenticated using (true) with check (true);
create policy "authenticated full access mesas" on public.mesas for all to authenticated using (true) with check (true);
create policy "authenticated full access ordenes" on public.ordenes for all to authenticated using (true) with check (true);
create policy "authenticated full access cierres" on public.cierres for all to authenticated using (true) with check (true);
create policy "menus_admin" on public.menus for all to authenticated using (true) with check (true);
create policy "menus_select_publico" on public.menus for select to anon, authenticated using (true);
create policy "elec_select_publico" on public.elecciones_menu for select to anon, authenticated using (true);
create policy "reacc_select_publico" on public.reacciones_menu for select to anon, authenticated using (true);
create policy "sug_admin" on public.sugerencias_plato for all to authenticated using (true) with check (true);

-- Solo sesiones de Google. Un proyecto nuevo trae el registro por correo
-- encendido de fábrica, y cualquier cuenta así creada es `authenticated`:
-- con las policies de arriba leería las ventas, los tokens de las mesas y
-- podría cambiar precios. Esta policy RESTRICTIVE se suma (AND) a todas las
-- de arriba: el acceso real sigue siendo el del README §07 (cuentas de
-- Google que admite el cliente OAuth). Va además de apagar el proveedor
-- Email y el registro abierto en el dashboard, no en lugar de eso.
do $$
declare t text;
begin
  foreach t in array array['productos', 'mesas', 'ordenes', 'cierres', 'menus', 'sugerencias_plato'] loop
    execute format(
      'create policy solo_google on public.%I as restrictive for all to authenticated
         using ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'')
         with check ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'')', t);
  end loop;
end $$;

-- ── Permisos (GRANT explícitos; el acceso fino lo siguen dando las policies) ──

revoke all on public.productos, public.mesas, public.ordenes, public.cierres,
              public.menus, public.elecciones_menu, public.reacciones_menu, public.sugerencias_plato
  from anon, authenticated;

-- POS (pos.html, con sesión de Google): upsert en las 4 tablas y en menus.
-- DELETE solo donde el POS borra (órdenes al cerrar el día, productos y
-- menús); `cierres` es el único registro de ventas que queda tras la purga.
grant select, insert, update on public.productos, public.mesas, public.ordenes, public.cierres, public.menus
  to authenticated;
grant delete on public.productos, public.ordenes, public.menus to authenticated;
grant select on public.elecciones_menu, public.reacciones_menu, public.sugerencias_plato to authenticated;

-- Votación pública (menu.html, sin sesión): solo lectura. Los votos entran por la Edge Function votar.
grant select on public.menus, public.elecciones_menu, public.reacciones_menu to anon;

-- Edge Functions votar y cuenta (service role; se salta RLS pero necesita GRANT).
grant select, insert, update, delete on public.productos, public.mesas, public.ordenes, public.cierres,
                                        public.menus, public.elecciones_menu, public.reacciones_menu, public.sugerencias_plato
  to service_role;

revoke all on function public.aplicar_delta_orden(text, text, text, numeric, integer, text) from public, anon;
revoke all on function public.actualizar_nota_item(text, text, text) from public, anon;
revoke all on function public.tocar_updated_at() from public, anon, authenticated;
grant execute on function public.aplicar_delta_orden(text, text, text, numeric, integer, text) to authenticated, service_role;
grant execute on function public.actualizar_nota_item(text, text, text) to authenticated, service_role;

-- ── Realtime: las 4 tablas del POS (pos.html escucha mesas, ordenes y productos) ──

alter publication supabase_realtime add table public.cierres, public.mesas, public.ordenes, public.productos;
