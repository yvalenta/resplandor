-- =============================================================================
-- POS · Concurrencia de órdenes (race condition de `items`)  — SIN APLICAR AÚN
-- =============================================================================
-- PROBLEMA: hoy cada mesero reescribe el array `items` COMPLETO con un upsert de
-- fila entera (index.html: pushASupabase('ordenes', orden)). Si dos meseros
-- editan la misma mesa a la vez, el último en escribir pisa los ítems del otro
-- (last-write-wins → se pierden productos).
--
-- SOLUCIÓN: mover la mutación al servidor con un DELTA atómico. El cliente ya no
-- manda el array completo; manda "suma/resta N de este ítem" y Postgres aplica el
-- cambio bajo un lock de fila (SELECT ... FOR UPDATE). Como `ordenes` ya está en
-- la publicación de Realtime (canal pos_sync), la fila resultante se propaga sola
-- al otro mesero. El total se recalcula en el servidor (no se confía en el cliente).
--
-- Los deltas son CONMUTATIVOS → la cola offline del POS puede reproducirlos en
-- orden sin riesgo (mejor que reenviar el array completo, que sí pisaría cambios).
--
-- ⚠️ ENTREGA: este archivo NO se ha aplicado a producción. Aplicar con
--    apply_migration ANTES de mergear los cambios de index.html de la rama
--    `pos-concurrencia`, o el POS llamaría a una función inexistente.
-- Verificación previa (solo lógica jsonb) hecha en read-only: incrementar,
-- quitar-al-llegar-a-0 y agregar-ítem-nuevo dan el resultado esperado.
-- =============================================================================

-- Columna de versión: se incrementa en cada delta. El cliente descarta ecos de
-- Realtime más viejos que su estado local (evita parpadeos bajo concurrencia).
alter table ordenes add column if not exists version int not null default 0;

create or replace function aplicar_delta_orden(
  p_orden_id text,
  p_item_id  text,
  p_nombre   text,
  p_precio   numeric,
  p_delta    int
) returns ordenes
language plpgsql
security invoker          -- corre como el mesero autenticado; RLS del POS ya lo cubre
as $$
declare
  o      ordenes;
  nuevos jsonb;
  existe boolean;
begin
  -- Lock de fila: serializa los deltas concurrentes sobre la misma orden.
  select * into o from ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'orden % no existe', p_orden_id;
  end if;

  select exists(
    select 1 from jsonb_array_elements(o.items) e where e->>'id' = p_item_id
  ) into existe;

  if existe then
    -- Ajusta qty del ítem; lo elimina si queda en 0 o menos.
    select coalesce(jsonb_agg(x), '[]'::jsonb) into nuevos
    from (
      select case when e->>'id' = p_item_id
                  then jsonb_set(e, '{qty}', to_jsonb(greatest(0, (e->>'qty')::int + p_delta)))
                  else e end as x
      from jsonb_array_elements(o.items) e
    ) s
    where (x->>'qty')::int > 0;
  else
    -- Ítem nuevo: solo tiene sentido si el delta es positivo.
    nuevos := case when p_delta > 0
      then o.items || jsonb_build_array(
             jsonb_build_object('id', p_item_id, 'nombre', p_nombre, 'precio', p_precio, 'qty', p_delta))
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
end $$;

grant execute on function aplicar_delta_orden(text, text, text, numeric, int) to authenticated;


-- =============================================================================
-- Parte 5 del pedido: RLS para empleados en mesas / ordenes / productos / cierres
-- =============================================================================
-- ⚠️ YA ESTÁ APLICADO EN PRODUCCIÓN. Se documenta aquí por completitud; NO hace
-- falta re-ejecutar. Estado verificado (pg_policies): las 4 tablas tienen RLS ON
-- y una única policy `ALL to authenticated using(true) with check(true)`, es
-- decir SOLO usuarios autenticados (meseros con Google OAuth) leen y escriben;
-- `anon` no tiene ninguna policy → acceso denegado por defecto.
--
-- Modelo de confianza: en un restaurante de un solo local todos los meseros son
-- de confianza plena, por eso `using(true)` es intencional (el linter de Supabase
-- lo marca como "RLS Policy Always True", es esperado). Si algún día se quiere
-- multi-sucursal o roles, aquí se restringiría por columna (p. ej. sucursal_id)
-- o por claim del JWT.
--
-- Forma idempotente (equivalente a lo ya existente):
--   alter table mesas     enable row level security;
--   alter table ordenes   enable row level security;
--   alter table productos enable row level security;
--   alter table cierres   enable row level security;
--   create policy if not exists "authenticated full access mesas"
--     on mesas     for all to authenticated using (true) with check (true);
--   create policy if not exists "authenticated full access ordenes"
--     on ordenes   for all to authenticated using (true) with check (true);
--   create policy if not exists "authenticated full access productos"
--     on productos for all to authenticated using (true) with check (true);
--   create policy if not exists "authenticated full access cierres"
--     on cierres   for all to authenticated using (true) with check (true);
