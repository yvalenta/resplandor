-- Sobre de datos — la regla de «Combo hamburguesas» (precio fijo: 2 Hamburguesa Resplandor por $ 50.000)
-- (tareas/2026-10-06-promo-precio-fijo.md). Lo pega Yonatan en Supabase → SQL Editor (Línea Roja: aparca), al FINAL del orden de salida, que es este y no otro:
--   1) supabase/migrations/20261006170000_promo_precio_fijo.sql (DESPUÉS de aplicar esa migración: este sobre se niega a correr sin ella);
--   2) el push del POS;
--   3) recargar TODAS las tablets y comprobar, en el pie de cada una, que muestran la versión nueva (la misma que version.json publica al aire);
--   4) recién entonces, este sobre.
-- Por qué el 3 antes del 4: el POS nunca se recarga solo, y el POS de antes no entiende la regla de precio fijo (la ve como si no tuviera regla). Una tablet que siga con él, con
-- el sobre ya puesto, (a) seguiría ofreciendo el combo como producto: si lo agrega junto a 2 hamburguesas, la cuenta cobra el grupo (50.000) MÁS el producto (50.000), 100.000, cobro doble; y
-- (b) si alguien edita el combo desde ella —aunque sea solo la etiqueta— sube `promo_regla: null` y BORRA la regla: el par de hamburguesas deja de formar el combo (60.000). Ninguna de las
-- dos cosas tiene arreglo en la base: por eso el paso 3 va antes que este sobre. ESE ES EL RIESGO QUE QUEDA si una tablet se salta la recarga.
--
-- ANTES DE PEGARLO (lo decide quien tiene las cuentas delante, no la base): el sobre se NIEGA —error RS008, sin cambiar nada— mientras «Combo hamburguesas» esté en una CUENTA ABIERTA como
-- producto (solo cuentan las mesas abiertas; una venta ya cobrada no estorba). La base no puede saber si esa línea repite el par de hamburguesas (la captura: una tablet vieja) o es un combo
-- servido de verdad antes de la regla, y con el par formado después la cuenta cobraría el grupo y el producto. El error dice en qué mesas está y separa dos clases, porque la orden no es la misma:
--   · mesas que tienen además las 2 hamburguesas: la línea del combo se quita con la ✕ SOLO si repite el par; si es un combo servido de verdad además de las hamburguesas, se cobra la mesa;
--   · mesas sin el par (el combo vendido de verdad, solo o con otro plato): se cobra la mesa, o se cambia la línea por 2 Hamburguesa Resplandor, que con la regla valen 50.000. Quitarla sin más dejaría
--     de cobrar 50.000: el combo era la única forma de venderlo.
-- Y se vuelve a pegar. La línea del producto vale 50.000 siempre: la base no la toca.
--
-- Qué hace: a la promo «Combo hamburguesas» (categoría Promociones) le pone la regla
--     { "cada": 2, "precio": 50000, "aplica": { "productos": ["<id de «Hamburguesa Resplandor»>"] } }
-- = cada 2 Hamburguesa Resplandor en una cuenta cuestan $ 50.000 (la más barata del par queda en 50.000 − lo que cuesta la otra: con la hamburguesa a
-- 30.000, una de 30.000 y la otra de 20.000), 3 → 80.000, 4 → 100.000. El día lo sigue diciendo la fila de la promo (`dia_semana`: el martes). Y deja UN solo precio: el del
-- producto —el que muestra la carta pública, «Combo hamburguesas $ 50.000»— es el mismo del grupo, `precio = 50000` (explícito: el POS nuevo lo escribe así al guardar una promo de
-- precio fijo). El POS deja de ofrecer la promo como producto: las promos con regla se aplican solas y se anuncian en la carta del mesero.
--
-- Se busca por nombre y categoría («Combo hamburguesas» en Promociones, «Hamburguesa Resplandor» en Platos Fuertes), así que si un nombre cambió, no se
-- toca nada: la comprobación de abajo ABORTA (y dice cuál) antes de escribir. Idempotente: pegarlo otra vez deja lo mismo. Lo hace en UNA transacción.
--
-- OJO, lo que pasa al correrlo: `productos_tocan_cuentas` (20261005100000) «toca» todas las cuentas abiertas cuando cambia una regla o un precio, y
-- `trg_ordenes_a_precio_vivo` las RE-NORMALIZA: una mesa abierta con 2 Hamburguesa Resplandor un martes queda en 50.000 por sí sola, y llega a todas las tablets y
-- a la carta por Realtime. Como el sobre no corre con el combo en ninguna cuenta abierta (arriba), las cuentas abiertas solo tienen hamburguesas: ninguna línea del combo cambia de precio al
-- pegarlo. Si DESPUÉS una tablet sin recargar agrega el combo como producto junto al par, la cuenta cobra las dos cosas (100.000) y se corrige quitando la línea con la ✕; solo, el combo vale sus $ 50.000.
--
-- Fuera de alcance: las otras promos de precio fijo (Almuerzos, Dupleta de papas, Picada + jarra de Cantarito) NO se tocan: las dos primeras las pone Yonatan desde
-- Productos cuando confirme qué incluyen («cada N por $X» solo cubre el MISMO producto o categoría repetido) —EDITANDO la fila que ya existe, no creando una nueva con «Nuevo producto» mientras la
-- vieja siga en la carta: la base solo cuida la edición de la fila existente (si la promo es nueva, el producto que la vendía se apaga o se borra antes)— y la picada con la jarra mezcla productos
-- distintos (1 + 1), que esta regla no sabe contar.
--
-- Reversa (menos de 1 minuto; las cuentas abiertas se re-normalizan solas y el combo vuelve a ser un producto que se agrega a mano, a su precio):
--   update public.productos set promo_regla = null where categoria = 'Promociones' and nombre = 'Combo hamburguesas';

begin;

-- Comprobación previa: la migración está aplicada, y cada fila que la regla nombra existe UNA sola vez (en su categoría). Si no, se aborta antes de escribir.
do $$
declare
  v_mal text;
begin
  if to_regprocedure('privado.normalizar_items(jsonb, smallint)') is null
     or position('precio_fijo' in pg_get_functiondef('privado.normalizar_items(jsonb, smallint)'::regprocedure)) = 0
     or to_regprocedure('privado.promo_precio_fijo_en_cuentas()') is null then
    raise exception 'Falta aplicar supabase/migrations/20261006170000_promo_precio_fijo.sql (privado.normalizar_items todavía no sabe de precio fijo, o falta el trigger que cuida las cuentas con el combo). No se aplicó nada.';
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
   set precio = 50000,
       promo_regla = jsonb_build_object(
         'cada', 2, 'precio', 50000,
         'aplica', jsonb_build_object('productos', jsonb_build_array((
           select h.id from public.productos h where h.categoria = 'Platos Fuertes' and h.nombre = 'Hamburguesa Resplandor'))))
 where c.categoria = 'Promociones' and c.nombre = 'Combo hamburguesas';

-- Comprobación: el combo quedó con su regla (2 por 50.000, sobre la hamburguesa y solo ella) y con UN solo precio, el del grupo. Si algo no cuadra, se aborta sin cambiar nada.
do $$
declare
  v_regla jsonb;
  v_precio numeric;
  v_ham text;
begin
  select promo_regla, precio into v_regla, v_precio from public.productos where categoria = 'Promociones' and nombre = 'Combo hamburguesas';
  select id into v_ham from public.productos where categoria = 'Platos Fuertes' and nombre = 'Hamburguesa Resplandor';
  if v_regla is null
     or v_regla ->> 'cada' <> '2' or v_regla ->> 'precio' <> '50000' or v_regla ? 'descuento'
     or v_precio is distinct from 50000
     or jsonb_array_length(coalesce(v_regla -> 'aplica' -> 'productos', '[]'::jsonb)) <> 1
     or v_regla -> 'aplica' -> 'productos' ->> 0 is distinct from v_ham
     or v_regla -> 'aplica' ? 'categorias' then
    raise exception 'El combo quedó con la regla % y el precio % y se esperaba 2 por 50.000 y precio 50000 sobre «Hamburguesa Resplandor» (%). No se aplicó nada.', v_regla, v_precio, v_ham;
  end if;
end $$;

select nombre, dia_semana, etiqueta, precio, promo_regla from public.productos where categoria = 'Promociones' order by dia_semana, nombre;

commit;
