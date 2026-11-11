-- Sobre de datos — almuerzos a 23.000 y los cuatro bowls a 15.000 (tareas/2026-11-10-almuerzos-y-bowls.md).
-- Lo pega Yonatan en Supabase → SQL Editor del proyecto lccgehvyymladqvumcez (Línea Roja: aparca), DESPUÉS del push del POS
-- y de recargar las tablets (el pie de cada una tiene que mostrar la versión nueva): el POS de antes no sabe preguntar los
-- pasos de «Arma tu bowl» y lo agregaría sin base, proteína, vegetales ni guarnición.
--
-- PÉGALO CON EL LOCAL CERRADO (sin cuentas abiertas). El trigger `productos_tocan_cuentas` (20261005100000) le cambia el
-- precio a toda cuenta ABIERTA en el momento: una mesa que pidió un Seco a 19.000 pasa a deberlo a 23.000 sin que nadie lo
-- toque. Las cuentas cerradas no cambian. Al correr, el aviso (NOTICE) dice cuántas cuentas abiertas hay y los precios que
-- había antes.
--
-- Decidido por Yonatan (2026-11-10, mensajes en la sesión):
--   · Almuerzos a 23.000 («hay un cambio almuerzos a $23.000», que reemplaza el «almuerzos 20000» de la mañana): el Menú
--     Resplandor (ya estaba a 23.000) y el Seco (estaba a 19.000) quedan a 23.000; el precio de 19.000 ya no existe. Sopa y
--     carne (14.000), Sopa, Carne y el Sancocho trifásico no cambian. La promo del domingo «Almuerzos» (Promociones, 20.000) NO
--     se toca: es la promoción del domingo, no el precio del almuerzo. El «3er almuerzo» del lunes sigue sobre toda la categoría
--     Ejecutivos (con los almuerzos a 23.000, el tercero queda en 18.400).
--   · Bowls a 15.000: Bowl criollo, Bowl mixto, Bowl Resplandor y Arma tu bowl.
--   · Los ingredientes de «Arma tu bowl» viven en UN solo lugar: su descripción (la de abajo, en `productos.descripcion`). El
--     POS saca de ella los pasos que pregunta (cada grupo es un paso y cada opción un botón: OPCIONES_EN_LA_DESCRIPCION en
--     pos.html) y la carta y la landing la pintan un grupo por renglón (gruposDe). Cambiar un ingrediente después es editar esa
--     descripción, desde el POS (Productos → «Arma tu bowl» → Descripción) o en el SQL Editor (con un
--     `update public.productos set descripcion = '…' where id = 'bowl_arma'`), con la misma forma: «Rótulo: opción, opción u
--     opción.» por grupo, las opciones separadas por coma y la última por «o»;
--     una «y» queda dentro de la opción («tomate y zanahoria» sería UN botón). Sin saltos de línea: el campo del POS es de un
--     renglón. No hace falta tocar código ni pruebas ni recargar las tablets (les llega por Realtime), y NO mueve las cuentas
--     abiertas (`productos_tocan_cuentas` no mira la descripción): se puede hacer con el local abierto.
--   · La lista del 2026-11-10: Base: arroz, pasta, lechuga, frijol · Proteína: pollo desmechado, carne molida, carne desmechada,
--     atún, huevo cocido · Vegetales: pico de gallo, tomate, zanahoria, pepino, zucchini · Guarnición: plátano maduro, papa
--     cocinada, chips de plátano, yuca frita. Una opción por paso.
--   · «Todos nuestros bowls vienen con guarapo»: cada bowl lleva la etiqueta «Incluye guarapo», la pastilla que la carta,
--     la landing y los agentes ya leen (como el «Incluye jugo» de Sopa y carne). El POS no muestra etiquetas.
--   · Los bowls NO cuentan para el «3er almuerzo» del lunes («No, van aparte»): por eso van en una categoría propia «Bowls»
--     y no en Ejecutivos, que es la que alcanza esa regla.
--
-- Lo que puso la sesión y falta que Yonatan confirme (si no es así, es editar la descripción, no este sobre):
--   · Los vegetales como cinco opciones sueltas: el mensaje decía «tomate zanahoria , pepino zuquini». Si eran parejas:
--     «Vegetales: pico de gallo, tomate y zanahoria, o pepino y zucchini.» «Zuquini» se escribió «zucchini».
--
-- Los ids de los bowls son fijos (bowl_criollo, bowl_mixto, bowl_resplandor, bowl_arma) porque el POS cuelga del id los pasos
-- de «Arma tu bowl». Los almuerzos se buscan por nombre y categoría. Si algo no cuadra, la comprobación de abajo ABORTA sin
-- escribir nada y dice qué. Idempotente: pegarlo otra vez deja lo mismo (también la descripción de «Arma tu bowl»: si ya la
-- editaron en Productos, volver a pegarlo trae de vuelta esta). Todo en UNA transacción.
--
-- Reversa (vuelve al precio de antes y saca los bowls de la carta y del POS sin borrar su historia; el Menú Resplandor ya
-- estaba a 23.000 y no se mueve):
--   update public.productos set precio = 19000 where categoria = 'Ejecutivos' and nombre = 'Seco';
--   update public.productos set activo = false where id in ('bowl_criollo', 'bowl_mixto', 'bowl_resplandor', 'bowl_arma');

begin;

-- ── 1. Comprobación previa (solo lecturas) ────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_mal text;
  v_abiertas int;
  v_antes text;
begin
  -- Los dos almuerzos tienen que existir UNA sola vez en Ejecutivos.
  select string_agg('«' || e.nombre || '» en Ejecutivos (hay ' || e.hay || ')', ', ' order by e.nombre) into v_mal
    from (
      select n.nombre, (select count(*) from public.productos p where p.categoria = 'Ejecutivos' and p.nombre = n.nombre) as hay
        from (values ('Menú Resplandor'), ('Seco')) as n (nombre)
    ) e
   where e.hay <> 1;
  if v_mal is not null then
    raise exception 'Falta o está repetido un almuerzo: %. Revisa los nombres en Productos. No se aplicó nada.', v_mal;
  end if;

  -- Ningún bowl puede existir ya con OTRO id (por ejemplo, creado a mano desde el POS): quedaría repetido en la carta.
  select string_agg('«' || p.nombre || '» (id ' || p.id || ', ' || p.categoria || ')', ', ' order by p.nombre) into v_mal
    from public.productos p
   where lower(btrim(p.nombre)) in ('bowl criollo', 'bowl mixto', 'bowl resplandor', 'arma tu bowl')
     and p.id not in ('bowl_criollo', 'bowl_mixto', 'bowl_resplandor', 'bowl_arma');
  if v_mal is not null then
    raise exception 'Ya hay un bowl con otro id: %. Bórralo o renómbralo desde Productos y vuelve a pegar esto. No se aplicó nada.', v_mal;
  end if;

  select string_agg(nombre || ' a ' || precio, ', ' order by nombre) into v_antes
    from public.productos where categoria = 'Ejecutivos' and nombre in ('Menú Resplandor', 'Seco');
  select count(*) into v_abiertas from public.ordenes where estado = 'abierta';
  raise notice 'Cuentas abiertas ahora: %. Antes del sobre: %. Las cuentas abiertas con un almuerzo que no estaba a 23.000 pasan a 23.000.', v_abiertas, v_antes;
end $$;

-- ── 2. Almuerzos a 23.000 ─────────────────────────────────────────────────────────────────────────────────────────────

update public.productos
   set precio = 23000
 where categoria = 'Ejecutivos'
   and nombre in ('Menú Resplandor', 'Seco')
   and precio <> 23000;

-- ── 3. Los cuatro bowls a 15.000 ──────────────────────────────────────────────────────────────────────────────────────

insert into public.productos (id, categoria, nombre, precio, descripcion, etiqueta, activo, en_carta) values
  ('bowl_criollo', 'Bowls', 'Bowl criollo', 15000,
   'Arroz, chicharrón, guacamole, maicitos y plátano maduro en trocitos', 'Incluye guarapo', true, true),
  ('bowl_mixto', 'Bowls', 'Bowl mixto', 15000,
   'Pasta corta sobre mix de lechugas, pollo y carne desmechados, y moneditas de plátano verde', 'Incluye guarapo', true, true),
  ('bowl_resplandor', 'Bowls', 'Bowl Resplandor', 15000,
   'Arroz, pollo agridulce, vegetales salteados y papa con mayonesa', 'Incluye guarapo', true, true),
  ('bowl_arma', 'Bowls', 'Arma tu bowl', 15000,
   'Base: arroz, pasta, lechuga o frijol. '
   || 'Proteína: pollo desmechado, carne molida, carne desmechada, atún o huevo cocido. '
   || 'Vegetales: pico de gallo, tomate, zanahoria, pepino o zucchini. '
   || 'Guarnición: plátano maduro, papa cocinada, chips de plátano o yuca frita.', 'Incluye guarapo', true, true)
on conflict (id) do update
   set categoria = excluded.categoria,
       nombre = excluded.nombre,
       precio = excluded.precio,
       descripcion = excluded.descripcion,
       etiqueta = excluded.etiqueta,
       activo = true,
       en_carta = true;

-- ── 4. Comprobación posterior: si algo no quedó como debe, se deshace todo ────────────────────────────────────────────

do $$
declare
  v_mal text;
begin
  select string_agg(x, ', ') into v_mal from (
    select '«' || nombre || '» quedó en ' || precio as x
      from public.productos
     where categoria = 'Ejecutivos' and nombre in ('Menú Resplandor', 'Seco') and precio <> 23000
    union all
    select 'falta «' || b.id || '»'
      from (values ('bowl_criollo'), ('bowl_mixto'), ('bowl_resplandor'), ('bowl_arma')) as b (id)
     where not exists (select 1 from public.productos p
                        where p.id = b.id and p.categoria = 'Bowls' and p.precio = 15000 and p.activo and p.en_carta
                          and p.etiqueta = 'Incluye guarapo')
  ) t;
  if v_mal is not null then
    raise exception 'El sobre no quedó como debía: %. Se deshizo todo.', v_mal;
  end if;
end $$;

commit;

-- ── 5. El select de confirmación (córrelo aparte después del commit; lo que importa es lo que devuelve) ───────────────
-- Tiene que devolver 6 filas: Menú Resplandor y Seco a 23000, y los 4 bowls a 15000 con «Incluye guarapo». Y la carta
-- pública, igual; la última línea muestra los ingredientes de «Arma tu bowl» tal como los leen la carta y el POS:
--
--   select id, categoria, nombre, precio, etiqueta, activo, en_carta from public.productos
--    where (categoria = 'Ejecutivos' and nombre in ('Menú Resplandor', 'Seco')) or categoria = 'Bowls'
--    order by categoria, nombre;
--
--   select categoria, nombre, precio, etiqueta from public.carta_publica
--    where categoria in ('Ejecutivos', 'Bowls') order by categoria, precio, nombre;
--
--   select descripcion from public.carta_publica where nombre = 'Arma tu bowl';
