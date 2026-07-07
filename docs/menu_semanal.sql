-- Migración: votación pública del menú semanal (aplicada 2026-07-07 vía MCP,
-- nombre de migración: menu_semanal_votacion).
--
-- ⚠️ Las policies `anon` de estas 2 tablas son DELIBERADAS: la página pública
-- menu.html permite ver propuestas y votar sin login (un voto por dispositivo,
-- deduplicado por unique(propuesta_id, device_id); el voto puede cambiarse vía
-- upsert, por eso el update para anon). El riesgo de manipulación anónima se
-- acepta para este caso de uso. NO replicar este patrón en las tablas del POS
-- (productos, mesas, ordenes, cierres) — ver incidente 11.1 del README.

create table propuestas_menu (
  id text primary key,
  semana date not null,                       -- lunes de la semana a la que pertenece
  dia smallint check (dia between 1 and 7),   -- 1=lunes … 7=domingo; null = "cualquier día"
  nombre text not null,
  descripcion text default '',
  activo boolean default true,
  created_at timestamptz default now()
);

create table votos_menu (
  id text primary key,
  propuesta_id text not null references propuestas_menu(id) on delete cascade,
  voto text not null check (voto in ('like','neutral','dislike')),
  device_id text not null,
  created_at timestamptz default now(),
  unique (propuesta_id, device_id)
);

alter table propuestas_menu enable row level security;
alter table votos_menu enable row level security;

create policy propuestas_select_publico on propuestas_menu for select to anon, authenticated using (true);
create policy propuestas_admin on propuestas_menu for all to authenticated using (true) with check (true);
create policy votos_select_publico on votos_menu for select to anon, authenticated using (true);
create policy votos_insert_publico on votos_menu for insert to anon, authenticated with check (true);
create policy votos_update_publico on votos_menu for update to anon, authenticated using (true) with check (true);
