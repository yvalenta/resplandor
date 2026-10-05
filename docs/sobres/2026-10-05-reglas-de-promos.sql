-- Sobre de datos — las reglas de las tres promociones de descuento que ya existen en `productos`
-- (tareas/2026-10-04-hallazgos-domingo.md). Se pega en Supabase → SQL Editor DESPUÉS de aplicar
-- supabase/migrations/20261005100000_precio_vivo_y_promos.sql. Lo pega Yonatan (Línea Roja: aparca).
--
-- Qué hace: a cada promo le pone su regla; las de precio fijo (Almuerzos, Combo hamburguesas, Dupleta de papas,
-- Picada + jarra de Cantarito) se quedan sin regla, como están. Se busca por nombre y categoría, así que si un nombre
-- cambió, esa fila no se toca (la comprobación de abajo lo dice). Idempotente: volver a pegarlo deja lo mismo.
--
-- Por confirmar con Yonatan (se editan después desde Productos en el POS sin tocar SQL):
--   · «Cócteles, jugos y sodas» 2x1: aquí entran los cócteles (Cóctel Resplandor, Margarita, Paloma, Tequila Smile, Cantarito),
--     el Jugo natural y la Soda saborizada. No entran el Agua, la Gaseosa, la Cerveza, la Corona ni el Vaso michelado.
--   · «3er almuerzo» (20 %): todos los Ejecutivos (Menú Resplandor, Seco, Sopa y carne, Sancocho, Sopa, Carne).
--   · «Entradas de la carta» 2x1: toda la categoría Entradas.
--
-- Reversa: update public.productos set promo_regla = null where categoria = 'Promociones';

begin;

update public.productos
   set promo_regla = '{"cada": 3, "descuento": 20, "aplica": {"categorias": ["Ejecutivos"]}}'::jsonb
 where categoria = 'Promociones' and nombre = '3er almuerzo';

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

-- Comprobación: tres promos con regla, y la de bebidas con sus 7 productos. Si algo no cuadra, se aborta sin cambiar nada.
do $$
declare
  v_con_regla int;
  v_bebidas int;
begin
  select count(*) into v_con_regla from public.productos where categoria = 'Promociones' and promo_regla is not null;
  select jsonb_array_length(promo_regla -> 'aplica' -> 'productos') into v_bebidas
    from public.productos where categoria = 'Promociones' and nombre = 'Cócteles, jugos y sodas';
  if v_con_regla <> 3 then
    raise exception 'Se esperaban 3 promociones con regla y hay %: revisa los nombres en productos. No se aplicó nada.', v_con_regla;
  end if;
  if coalesce(v_bebidas, 0) <> 7 then
    raise exception 'La promo de cócteles, jugos y sodas quedó con % productos y se esperaban 7: revisa los nombres en Bebidas. No se aplicó nada.', coalesce(v_bebidas, 0);
  end if;
end $$;

select nombre, dia_semana, etiqueta, promo_regla from public.productos where categoria = 'Promociones' order by dia_semana;

commit;
