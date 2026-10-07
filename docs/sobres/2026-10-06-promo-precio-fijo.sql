-- Sobre de datos — la regla de «Combo hamburguesas» (precio fijo: 2 Hamburguesa Resplandor por $ 50.000)
-- (tareas/2026-10-06-promo-precio-fijo.md). Se pega en Supabase → SQL Editor DESPUÉS de aplicar
-- supabase/migrations/20261006170000_promo_precio_fijo.sql. Lo pega Yonatan (Línea Roja: aparca).
--
-- Qué hace: a la promo «Combo hamburguesas» (categoría Promociones) le pone la regla
--     { "cada": 2, "precio": 50000, "aplica": { "productos": ["<id de «Hamburguesa Resplandor»>"] } }
-- = cada 2 Hamburguesa Resplandor en una cuenta cuestan $ 50.000 (la más barata del par queda en 50.000 − lo que cuesta la otra: con la hamburguesa a
-- 30.000, una de 30.000 y la otra de 20.000), 3 → 80.000, 4 → 100.000. El día lo sigue diciendo la fila de la promo (`dia_semana`: el martes); el
-- precio del producto (50.000) y su etiqueta no cambian: la carta pública sigue mostrando «Combo hamburguesas $ 50.000». El POS deja de
-- ofrecerla como producto (las promos con regla se aplican solas y se anuncian en la carta del mesero).
--
-- Se busca por nombre y categoría («Combo hamburguesas» en Promociones, «Hamburguesa Resplandor» en Platos Fuertes), así que si un nombre cambió, no se
-- toca nada: la comprobación de abajo ABORTA (y dice cuál) antes de escribir. Idempotente: pegarlo otra vez deja lo mismo. Lo hace en UNA transacción.
--
-- OJO, lo que pasa al correrlo: `productos_tocan_cuentas` (20261005100000) «toca» todas las cuentas abiertas cuando cambia una regla, y
-- `trg_ordenes_a_precio_vivo` las RE-NORMALIZA: una mesa abierta con 2 Hamburguesa Resplandor un martes queda en 50.000 por sí sola, y llega a todas las tablets y
-- a la carta por Realtime. Una cuenta que ya tenga el producto «Combo hamburguesas» agregado A MANO (como la de la captura) lo conserva como una línea más de
-- 50.000 y cobraría el combo dos veces: hay que quitárselo (el POS ya no lo ofrece, pero la línea que ya está sigue ahí).
--
-- Fuera de alcance: las otras promos de precio fijo (Almuerzos, Dupleta de papas, Picada + jarra de Cantarito) NO se tocan: las dos primeras las pone Yonatan desde
-- Productos cuando confirme qué incluyen («cada N por $X» solo cubre el MISMO producto o categoría repetido) y la picada con la jarra mezcla productos
-- distintos (1 + 1), que esta regla no sabe contar.
--
-- Reversa (menos de 1 minuto; las cuentas abiertas se re-normalizan solas y el combo vuelve a ser un producto que se agrega a mano):
--   update public.productos set promo_regla = null where categoria = 'Promociones' and nombre = 'Combo hamburguesas';

begin;

-- Comprobación previa: la migración está aplicada, y cada fila que la regla nombra existe UNA sola vez (en su categoría). Si no, se aborta antes de escribir.
do $$
declare
  v_mal text;
begin
  if to_regprocedure('privado.normalizar_items(jsonb, smallint)') is null
     or position('precio_fijo' in pg_get_functiondef('privado.normalizar_items(jsonb, smallint)'::regprocedure)) = 0 then
    raise exception 'Falta aplicar supabase/migrations/20261006170000_promo_precio_fijo.sql (privado.normalizar_items todavía no sabe de precio fijo). No se aplicó nada.';
  end if;
  select string_agg('«' || n.nombre || '» en ' || n.categoria || ' (hay ' || n.hay || ')', ', ' order by n.categoria, n.nombre) into v_mal
    from (
      select e.categoria, e.nombre, (select count(*) from public.productos p where p.categoria = e.categoria and p.nombre = e.nombre) as hay
        from (values ('Promociones', 'Combo hamburguesas'), ('Platos Fuertes', 'Hamburguesa Resplandor')) as e (categoria, nombre)
    ) n
   where n.hay <> 1;
  if v_mal is not null then
    raise exception 'Falta o está repetido un producto que la regla nombra: %. Revisa los nombres en Productos. No se aplicó nada.', v_mal;
  end if;
end $$;

update public.productos c
   set promo_regla = jsonb_build_object(
         'cada', 2, 'precio', 50000,
         'aplica', jsonb_build_object('productos', jsonb_build_array((
           select h.id from public.productos h where h.categoria = 'Platos Fuertes' and h.nombre = 'Hamburguesa Resplandor'))))
 where c.categoria = 'Promociones' and c.nombre = 'Combo hamburguesas';

-- Comprobación: el combo quedó con su regla (2 por 50.000, sobre la hamburguesa y solo ella). Si algo no cuadra, se aborta sin cambiar nada.
do $$
declare
  v_regla jsonb;
  v_ham text;
begin
  select promo_regla into v_regla from public.productos where categoria = 'Promociones' and nombre = 'Combo hamburguesas';
  select id into v_ham from public.productos where categoria = 'Platos Fuertes' and nombre = 'Hamburguesa Resplandor';
  if v_regla is null
     or v_regla ->> 'cada' <> '2' or v_regla ->> 'precio' <> '50000' or v_regla ? 'descuento'
     or jsonb_array_length(coalesce(v_regla -> 'aplica' -> 'productos', '[]'::jsonb)) <> 1
     or v_regla -> 'aplica' -> 'productos' ->> 0 is distinct from v_ham
     or v_regla -> 'aplica' ? 'categorias' then
    raise exception 'El combo quedó con la regla % y se esperaba 2 por 50.000 sobre «Hamburguesa Resplandor» (%). No se aplicó nada.', v_regla, v_ham;
  end if;
end $$;

select nombre, dia_semana, etiqueta, precio, promo_regla from public.productos where categoria = 'Promociones' order by dia_semana, nombre;

commit;
