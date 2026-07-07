-- Migración: calendario semanal de menús con votación (v2, aplicada 2026-07-07
-- vía MCP, nombre de migración: menus_calendario_v2). Reemplaza el esquema
-- inicial de una-fila-un-plato (propuestas_menu / votos_menu).
--
-- ⚠️ Las policies `anon` son DELIBERADAS: la página pública menu.html permite
-- ver los menús y votar sin login. Deduplicación real por unique(menu_id,
-- device_id). Las sugerencias de plato en texto libre NO son legibles por anon
-- (solo admin) para evitar exponer spam. NO replicar el acceso anónimo en las
-- tablas del POS (productos, mesas, ordenes, cierres) — ver incidente 11.1 del README.

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

-- Reacciones de los clientes. 'mover' lleva día sugerido + comentario opcional
-- (el comentario solo se muestra en el admin; no mueve nada, decide el admin).
create table reacciones_menu (
  id text primary key,
  menu_id text not null references menus(id) on delete cascade,
  tipo text not null check (tipo in ('like','igual','dislike','mover')),
  dia_sugerido smallint check (dia_sugerido between 1 and 6),
  comentario text default '',
  device_id text not null,
  created_at timestamptz default now(),
  unique (menu_id, device_id)                              -- una reacción por dispositivo por menú
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
alter table reacciones_menu enable row level security;
alter table sugerencias_plato enable row level security;

create policy menus_select_publico on menus for select to anon, authenticated using (true);
create policy menus_admin on menus for all to authenticated using (true) with check (true);

create policy reacc_select_publico on reacciones_menu for select to anon, authenticated using (true);
create policy reacc_insert_publico on reacciones_menu for insert to anon, authenticated with check (true);
create policy reacc_update_publico on reacciones_menu for update to anon, authenticated using (true) with check (true);

create policy sug_insert_publico on sugerencias_plato for insert to anon, authenticated with check (true);
create policy sug_select_admin on sugerencias_plato for select to authenticated using (true);
create policy sug_admin on sugerencias_plato for all to authenticated using (true) with check (true);
