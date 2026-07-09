-- Migración: calendario semanal de menús con votación (v2, aplicada 2026-07-07
-- vía MCP, nombre de migración: menus_calendario_v2). Reemplaza el esquema
-- inicial de una-fila-un-plato (propuestas_menu / votos_menu).
--
-- ⚠️ Las policies `anon` de SELECT son DELIBERADAS: la página pública menu.html
-- permite VER los menús y los conteos sin login.
--
-- 🔒 ESCRITURA (actualizado, migración `votos_via_edge_function`): el cliente ya
-- NO inserta/actualiza directo. Se quitaron las policies anon INSERT/UPDATE de
-- elecciones_menu / reacciones_menu / sugerencias_plato. Todo voto pasa por la
-- Edge Function `votar` (supabase/functions/votar/index.ts), que valida, aplica
-- rate-limit por IP y escribe con la service-role key (omite RLS). Así el
-- rate-limit deja de depender del cliente y se cierra el spam directo a la API.
-- Deduplicación real por unique(...device_id). Los conteos en vivo llegan por
-- Broadcast de Realtime (canal `menu-<semana>`), sin recargar.
--
-- Las sugerencias de plato en texto libre NO son legibles por anon (solo admin).
-- NO replicar el acceso anónimo en las tablas del POS (productos, mesas, ordenes,
-- cierres) — ver incidente 11.1 del README.

drop table if exists votos_menu cascade;
drop table if exists propuestas_menu cascade;

-- Cada día (lun=1 … sáb=6) tiene 3 opciones: 1 y 2 varían; 3 = frijolada fija.
-- Cada menú es completo: sopa + principal + guarnición + ensalada + jugo.
create table menus (
  id text primary key,
  semana date not null,                                    -- lunes ISO de la semana
  dia smallint not null check (dia between 1 and 6),
  opcion smallint not null check (opcion between 1 and 3),
  etiqueta text default '',
  principal text not null,
  sopa text default '', guarnicion text default '', ensalada text default '', jugo text default '',
  fijo boolean default false,                              -- true = opción 3 (frijolada)
  activo boolean default true,
  created_at timestamptz default now(),
  unique (semana, dia, opcion)
);

-- Votación: el cliente elige 1 de las 2 opciones del día (la opción 3 fija no se
-- vota). Una elección por dispositivo por día; cambiar de opción es un UPDATE.
create table elecciones_menu (
  id text primary key,
  semana date not null,
  dia smallint not null check (dia between 1 and 6),
  opcion_elegida smallint not null check (opcion_elegida in (1, 2)),
  device_id text not null,
  created_at timestamptz default now(),
  unique (semana, dia, device_id)
);

-- Sugerencia de "mover a otro día": lleva día sugerido + comentario opcional
-- (visible solo en el admin; no mueve nada, lo decide el admin).
create table reacciones_menu (
  id text primary key,
  menu_id text not null references menus(id) on delete cascade,
  tipo text not null check (tipo in ('mover')),
  dia_sugerido smallint check (dia_sugerido between 1 and 6),
  comentario text default '',
  device_id text not null,
  created_at timestamptz default now(),
  unique (menu_id, device_id)
);

-- Sugerencias de plato en texto libre. Se insertan público, se leen solo admin.
create table sugerencias_plato (
  id text primary key,
  semana date not null,
  dia smallint check (dia between 1 and 6),
  texto text not null,
  device_id text not null,
  created_at timestamptz default now()
);

alter table menus enable row level security;
alter table elecciones_menu enable row level security;
alter table reacciones_menu enable row level security;
alter table sugerencias_plato enable row level security;

create policy menus_select_publico on menus for select to anon, authenticated using (true);
create policy menus_admin on menus for all to authenticated using (true) with check (true);

-- Lectura pública de conteos; la escritura (insert/update) YA NO es anónima:
-- ver migración `votos_via_edge_function` más abajo. Se conserva sólo SELECT.
create policy elec_select_publico on elecciones_menu for select to anon, authenticated using (true);
create policy reacc_select_publico on reacciones_menu for select to anon, authenticated using (true);

create policy sug_select_admin on sugerencias_plato for select to authenticated using (true);
create policy sug_admin on sugerencias_plato for all to authenticated using (true) with check (true);

-- ── Migración `votos_via_edge_function` (aplicada 2026-07-08) ──────────────────
-- Cierra la escritura anónima directa. Los votos entran por la Edge Function
-- `votar` (service-role, omite RLS). Idempotente:
drop policy if exists elec_insert_publico  on elecciones_menu;
drop policy if exists elec_update_publico  on elecciones_menu;
drop policy if exists reacc_insert_publico on reacciones_menu;
drop policy if exists reacc_update_publico on reacciones_menu;
drop policy if exists sug_insert_publico   on sugerencias_plato;
-- Nota: `menus_admin` y `sug_admin` (authenticated ALL) permiten al POS seguir
-- administrando; `authenticated` conserva escritura para el panel admin.
