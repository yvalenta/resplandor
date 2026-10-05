-- Sobre de datos — las reglas de las tres promociones de descuento que ya existen en `productos`
-- (tareas/2026-10-04-hallazgos-domingo.md). Se pega en Supabase → SQL Editor DESPUÉS de aplicar
-- supabase/migrations/20261005100000_precio_vivo_y_promos.sql. Lo pega Yonatan (Línea Roja: aparca).
--
-- Qué hace: a cada promo le pone su regla; las de precio fijo (Almuerzos, Combo hamburguesas, Dupleta de papas,
-- Picada + jarra de Cantarito) se quedan sin regla, como están. Se busca por nombre y categoría, así que si un nombre
-- cambió, esa fila no se toca y la comprobación de abajo ABORTA sin cambiar nada (y dice qué nombre falta). Idempotente:
-- volver a pegarlo deja lo mismo, y pisa una regla anterior (por ejemplo la que traía «todos los Ejecutivos»).
--
-- Decidido por Yonatan (2026-10-03, mensaje en la sesión de la promo del día; las reglas se editan después desde Productos
-- en el POS sin tocar SQL):
--   · «3er almuerzo» (lunes, 20 %): SOLO «Menú Resplandor» (23.000) y «Seco» (19.000). NO cuentan Sopa, Carne, Sopa y carne
--     ni el Sancocho trifásico. Por cada tres unidades de esos dos, la más barata del trío lleva el 20 %.
--   · «Cócteles, jugos y sodas» 2x1 (miércoles): los cócteles (Cóctel Resplandor, Margarita, Paloma, Tequila Smile, Cantarito),
--     el Jugo natural y la Soda saborizada. No entran el Agua, la Gaseosa, la Cerveza, la Corona ni el Vaso michelado.
--   · «Entradas de la carta» 2x1 (sábado): toda la categoría Entradas.
--   · Las promos SÍ se combinan en una cuenta; ninguna unidad cuenta para dos descuentos (lo garantiza privado.normalizar_items).
--
-- Reversa: update public.productos set promo_regla = null where categoria = 'Promociones';

begin;

-- Comprobación previa: cada producto que una regla nombra tiene que existir UNA sola vez (en su categoría). Si falta o está
-- repetido, se aborta antes de escribir nada y el mensaje dice cuál.
do $$
declare
  v_mal text;
begin
  select string_agg('«' || n.nombre || '» en ' || n.categoria || ' (hay ' || n.hay || ')', ', ' order by n.categoria, n.nombre) into v_mal
    from (
      select e.categoria, e.nombre, (select count(*) from public.productos p where p.categoria = e.categoria and p.nombre = e.nombre) as hay
        from (values
          ('Promociones', '3er almuerzo'), ('Promociones', 'Entradas de la carta'), ('Promociones', 'Cócteles, jugos y sodas'),
          ('Ejecutivos', 'Menú Resplandor'), ('Ejecutivos', 'Seco'),
          ('Bebidas', 'Cóctel Resplandor'), ('Bebidas', 'Margarita'), ('Bebidas', 'Paloma'), ('Bebidas', 'Tequila Smile'),
          ('Bebidas', 'Cantarito'), ('Bebidas', 'Jugo natural'), ('Bebidas', 'Soda saborizada')
        ) as e (categoria, nombre)
    ) n
   where n.hay <> 1;
  if v_mal is not null then
    raise exception 'Falta o está repetido un producto que las reglas nombran: %. Revisa los nombres en Productos. No se aplicó nada.', v_mal;
  end if;
  if not exists (select 1 from public.productos where categoria = 'Entradas') then
    raise exception 'La categoría Entradas no tiene ningún producto: la regla del sábado no aplicaría a nada. No se aplicó nada.';
  end if;
end $$;

update public.productos p
   set promo_regla = jsonb_build_object(
         'cada', 3, 'descuento', 20,
         'aplica', jsonb_build_object('productos', coalesce((
           select jsonb_agg(a.id order by a.nombre)
             from public.productos a
            where a.categoria = 'Ejecutivos'
              and a.nombre in ('Menú Resplandor', 'Seco')
         ), '[]'::jsonb)))
 where p.categoria = 'Promociones' and p.nombre = '3er almuerzo';

update public.productos
   set promo_regla = '{"cada": 2, "descuento": 100, "aplica": {"categorias": ["Entradas"]}}'::jsonb
 where categoria = 'Promociones' and nombre = 'Entradas de la carta';

update public.productos p
   set promo_regla = jsonb_build_object(
         'cada', 2, 'descuento', 100,
         'aplica', jsonb_build_object('productos', coalesce((
           select jsonb_agg(b.id order by b.nombre)
             from public.productos b
            where b.categoria = 'Bebidas'
              and b.nombre in ('Cóctel Resplandor', 'Margarita', 'Paloma', 'Tequila Smile', 'Cantarito', 'Jugo natural', 'Soda saborizada')
         ), '[]'::jsonb)))
 where p.categoria = 'Promociones' and p.nombre = 'Cócteles, jugos y sodas';

-- Comprobación: tres promos con regla; la del lunes con sus 2 productos (y sin categorías), la de bebidas con sus 7. Si algo no
-- cuadra, se aborta sin cambiar nada.
do $$
declare
  v_con_regla int;
  v_almuerzos int;
  v_bebidas int;
begin
  select count(*) into v_con_regla from public.productos where categoria = 'Promociones' and promo_regla is not null;
  select jsonb_array_length(promo_regla -> 'aplica' -> 'productos') into v_almuerzos
    from public.productos where categoria = 'Promociones' and nombre = '3er almuerzo';
  select jsonb_array_length(promo_regla -> 'aplica' -> 'productos') into v_bebidas
    from public.productos where categoria = 'Promociones' and nombre = 'Cócteles, jugos y sodas';
  if v_con_regla <> 3 then
    raise exception 'Se esperaban 3 promociones con regla y hay %: revisa los nombres en productos. No se aplicó nada.', v_con_regla;
  end if;
  if coalesce(v_almuerzos, 0) <> 2 then
    raise exception 'La promo del 3er almuerzo quedó con % productos y se esperaban 2 (Menú Resplandor y Seco): revisa los nombres en Ejecutivos. No se aplicó nada.', coalesce(v_almuerzos, 0);
  end if;
  if coalesce(v_bebidas, 0) <> 7 then
    raise exception 'La promo de cócteles, jugos y sodas quedó con % productos y se esperaban 7: revisa los nombres en Bebidas. No se aplicó nada.', coalesce(v_bebidas, 0);
  end if;
end $$;

select nombre, dia_semana, etiqueta, promo_regla from public.productos where categoria = 'Promociones' order by dia_semana;

commit;
