-- ════════════════════════════════════════════════════════════
-- Resplandor POS — schema.sql
-- Migración: productos, mesas y órdenes pasan a vivir en Supabase
-- (además del cierre diario, que ya existía). Ejecutar completo en
-- Supabase → SQL Editor. Es idempotente: se puede volver a correr sin
-- duplicar nada (usa IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- ════════════════════════════════════════════════════════════

-- ── 1. TABLAS ──────────────────────────────────────────────

create table if not exists public.productos (
                                                id          text primary key,
                                                categoria   text not null,
                                                nombre      text not null,
                                                precio      integer not null,
                                                descripcion text default '',
                                                activo      boolean not null default true,
                                                created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
    );

create table if not exists public.mesas (
                                            id         integer primary key,
                                            capacidad  integer not null,
                                            estado     text not null default 'libre' check (estado in ('libre', 'ocupada')),
    updated_at timestamptz not null default now()
    );

create table if not exists public.ordenes (
                                              id          text primary key,
                                              mesa_id     integer not null references public.mesas(id),
    estado      text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
    items       jsonb not null default '[]'::jsonb,
    total       numeric not null default 0,
    abierta_en  timestamptz not null default now(),
    cerrada_en  timestamptz,
    updated_at  timestamptz not null default now()
    );

-- Ya existía (respaldo del cierre diario); se deja igual.
create table if not exists public.cierres (
                                              id              text primary key,
                                              fecha           timestamptz not null,
                                              total_ventas    numeric not null,
                                              total_ordenes   integer not null,
                                              transacciones   jsonb not null,
                                              created_at      timestamptz not null default now()
    );

create index if not exists idx_ordenes_mesa on public.ordenes(mesa_id);
create index if not exists idx_ordenes_estado on public.ordenes(estado);
create index if not exists idx_cierres_fecha on public.cierres(fecha desc);

-- updated_at automático en cada UPDATE
create or replace function public.tocar_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
return new;
end;
$$;

drop trigger if exists trg_productos_updated_at on public.productos;
create trigger trg_productos_updated_at before update on public.productos
    for each row execute function public.tocar_updated_at();

drop trigger if exists trg_mesas_updated_at on public.mesas;
create trigger trg_mesas_updated_at before update on public.mesas
    for each row execute function public.tocar_updated_at();

drop trigger if exists trg_ordenes_updated_at on public.ordenes;
create trigger trg_ordenes_updated_at before update on public.ordenes
    for each row execute function public.tocar_updated_at();


-- ── 2. ROW LEVEL SECURITY ──────────────────────────────────

alter table public.productos enable row level security;
alter table public.mesas     enable row level security;
alter table public.ordenes   enable row level security;
alter table public.cierres   enable row level security;

drop policy if exists "anon full access productos" on public.productos;
create policy "anon full access productos" on public.productos
  for all to anon using (true) with check (true);

drop policy if exists "anon full access mesas" on public.mesas;
create policy "anon full access mesas" on public.mesas
  for all to anon using (true) with check (true);

drop policy if exists "anon full access ordenes" on public.ordenes;
create policy "anon full access ordenes" on public.ordenes
  for all to anon using (true) with check (true);

drop policy if exists "anon full access cierres" on public.cierres;
create policy "anon full access cierres" on public.cierres
  for all to anon using (true) with check (true);


-- ── 3. REALTIME ────────────────────────────────────────────
-- Usamos un bloque DO para iterar sobre cada tabla e intentar
-- agregarla a la publicación de Supabase. Si la base de datos
-- responde con el error 42710 (duplicate_object), simplemente
-- lo ignora en silencio y continúa.

DO $$
DECLARE
tabla text;
BEGIN
FOR tabla IN SELECT unnest(ARRAY['productos', 'mesas', 'ordenes', 'cierres'])
                        LOOP
BEGIN
EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tabla);
EXCEPTION WHEN duplicate_object THEN
      -- Silencio: la tabla ya estaba en la publicación de realtime
END;
END LOOP;
END;
$$;


-- ── 4. SEED (datos actuales del index.html) ────────────────

insert into public.mesas (id, capacidad, estado) values
                                                     (1, 2, 'libre'),
                                                     (2, 4, 'libre'),
                                                     (3, 4, 'libre'),
                                                     (4, 6, 'libre'),
                                                     (5, 2, 'libre'),
                                                     (6, 4, 'libre'),
                                                     (7, 4, 'libre'),
                                                     (8, 6, 'libre'),
                                                     (9, 2, 'libre'),
                                                     (10, 4, 'libre')
    on conflict (id) do nothing;

insert into public.productos (id, categoria, nombre, precio, descripcion, activo) values
                                                                                      ('ej1', 'Ejecutivos', 'Menú Resplandor', 23000, 'Menú del día', true),
                                                                                      ('ej2', 'Ejecutivos', 'Frijoles con proteína', 19000, 'A elección: Res, Cerdo o Chicharrón', true),
                                                                                      ('en1', 'Entradas', 'Patacón al estilo mexicano', 15000, '3 uds con carne al pastor, guacamole, sour cream y nachos', true),
                                                                                      ('en2', 'Entradas', 'Empanadas operadas', 18000, '3 uds con proteína a elección, queso mozzarella, plátano y salsa', true),
                                                                                      ('en3', 'Entradas', 'Arepitas montadas', 12000, '3 uds: guacamole/chorizo, hogao/carne o morcilla/limón', true),
                                                                                      ('en4', 'Entradas', 'Papas Resplandor', 25000, 'Papas a la francesa, chorizo, pollo, maicitos, queso y dip de tocineta', true),
                                                                                      ('en5', 'Entradas', 'Ceviche de chicharrón', 22000, 'Ceviche de mango en chicharrón con chips de plátano', true),
                                                                                      ('pf1', 'Platos Fuertes', 'Salmón gratinado', 70000, 'Bañado en 3 quesos, puré de papa criolla y vegetales o ensalada', true),
                                                                                      ('pf2', 'Platos Fuertes', 'Punta de anca (250g)', 58000, 'Madurada, con papas a la francesa, ensalada y salsa', true),
                                                                                      ('pf3', 'Platos Fuertes', 'Churrasco (250g)', 54000, 'Con papa cocida en salsa de cilantro y ensalada', true),
                                                                                      ('pf4', 'Platos Fuertes', 'Filete de pechuga', 39000, 'Dorado en BBQ y finas hierbas, papas a la francesa y ensalada', true),
                                                                                      ('pf5', 'Platos Fuertes', 'Solomo salteado', 48000, 'Lomo de res con vegetales sobre arroz y chips de plátano', true),
                                                                                      ('pf6', 'Platos Fuertes', 'Bandeja paisa Resplandor', 49000, 'Frijoles, arroz, plátano, chorizo, huevo, aguacate, arepa, morcilla, chicharrón, carne molida y hogao', true),
                                                                                      ('pf7', 'Platos Fuertes', 'Hamburguesa Resplandor', 30000, 'Pan ajonjolí, 150g de carne, dip tocineta, puerro, queso cheddar y vegetales', true),
                                                                                      ('pf8', 'Platos Fuertes', 'Ensalada con proteína', 30000, 'Pollo, julianas de solomo o cañón en salsa de maracuyá', true),
                                                                                      ('pf9', 'Platos Fuertes', 'Menú infantil', 28000, '2 opciones (cerdo o nuggets), papas, arepitas, jugo y helado', true),
                                                                                      ('pf10', 'Platos Fuertes', 'Picada Resplandor', 110000, 'Para 8-10 personas: carnes, chorizo, morcilla, costilla, mazorca, arepa, papa, guacamole y salsa', true),
                                                                                      ('be1', 'Bebidas', 'Soda saborizada', 14000, 'Maracuyá, frutos rojos o natural', true),
                                                                                      ('be2', 'Bebidas', 'Jugo natural', 12000, 'Sujeto a disponibilidad', true),
                                                                                      ('be3', 'Bebidas', 'Margarita', 30000, 'Cóctel', true),
                                                                                      ('be4', 'Bebidas', 'Cantarito', 28000, 'Cóctel', true),
                                                                                      ('be5', 'Bebidas', 'Tequila Smile', 28000, 'Cóctel', true),
                                                                                      ('be6', 'Bebidas', 'Paloma', 30000, 'Cóctel', true),
                                                                                      ('be7', 'Bebidas', 'Cóctel Resplandor', 35000, 'Cóctel firma de la casa', true)
    on conflict (id) do nothing;