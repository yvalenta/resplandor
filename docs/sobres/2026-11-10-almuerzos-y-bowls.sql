-- Sobre de datos — almuerzos a 20.000 y los cuatro bowls a 15.000 (tareas/2026-11-10-almuerzos-y-bowls.md).
-- Lo pega Yonatan en Supabase → SQL Editor del proyecto lccgehvyymladqvumcez (Línea Roja: aparca), DESPUÉS del push del POS
-- y de recargar las tablets (el pie de cada una tiene que mostrar la versión nueva): el POS de antes no sabe preguntar las
-- opciones de «Arma tu bowl» y lo agregaría sin base, proteína, vegetales ni guarnición.
--
-- PÉGALO CON EL LOCAL CERRADO (sin cuentas abiertas). El trigger `productos_tocan_cuentas` (20261005100000) le cambia el
-- precio a toda cuenta ABIERTA en el momento: una mesa que pidió el Menú Resplandor a 23.000 pasa a deberlo a 20.000 sin que
-- nadie lo toque. Las cuentas cerradas no cambian. Al correr, el aviso (NOTICE) dice cuántas cuentas abiertas hay.
--
-- Decidido por Yonatan (2026-11-10, mensaje en la sesión):
--   · Almuerzos a 20.000: los precios de 23.000 (Menú Resplandor) y 19.000 (Seco) ya no existen; los dos pasan a 20.000.
--     Sopa y carne (14.000), Sopa, Carne y el Sancocho trifásico no cambian. El «3er almuerzo» del lunes sigue sobre toda la
--     categoría Ejecutivos (con los almuerzos a 20.000, el tercero queda en 16.000).
--   · Bowls a 15.000: Bowl criollo, Bowl mixto, Bowl Resplandor y Arma tu bowl. Las opciones de «Arma tu bowl» (base, proteína,
--       vegetales y guarnición) las pregunta el POS (OPCIONES_PRODUCTO en pos.html, id `bowl_arma`) y la carta las lee en
--       la descripción, escrita como grupos «Rótulo: opciones.» separados por punto: la carta y la landing la pintan un grupo
--       por renglón (gruposDe). Sin saltos de línea a propósito: el campo de descripción del POS es de un renglón.
--   · «Todos nuestros bowls vienen con guarapo»: cada bowl lleva la etiqueta «Incluye guarapo», la pastilla que la carta,
--     la landing y los agentes ya leen (como el «Incluye jugo» de Sopa y carne). El POS no muestra etiquetas.
--
-- Lo que puso la sesión y falta que Yonatan confirme:
--   · Los bowls van en una categoría propia «Bowls», no en Ejecutivos: así NO cuentan para el «3er almuerzo» del lunes. Si deben
--     contar, se agrega la categoría Bowls a la regla de esa promo desde Productos en el POS (sin tocar este sobre).
--   · «tomate zanahoria» y «pepino zuccini» se leyeron como dos parejas: los vegetales son tres opciones (pico de gallo, tomate y
--     zanahoria, o pepino y zucchini) y se elige una.
--
-- Los ids de los bowls son fijos (bowl_criollo, bowl_mixto, bowl_resplandor, bowl_arma) porque el POS cuelga las opciones
-- del id. Los almuerzos se buscan por nombre y categoría. Si algo no cuadra, la comprobación de abajo ABORTA sin escribir
-- nada y dice qué. Idempotente: pegarlo otra vez deja lo mismo. Todo en UNA transacción.
--
-- Reversa (vuelve a los precios de antes y saca los bowls de la carta y del POS sin borrar su historia):
--   update public.productos set precio = 23000 where categoria = 'Ejecutivos' and nombre = 'Menú Resplandor';
--   update public.productos set precio = 19000 where categoria = 'Ejecutivos' and nombre = 'Seco';
--   update public.productos set activo = false where id in ('bowl_criollo', 'bowl_mixto', 'bowl_resplandor', 'bowl_arma');

begin;

-- ── 1. Comprobación previa (solo lecturas) ────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_mal text;
  v_abiertas int;
begin
  -- Los dos almuerzos que cambian tienen que existir UNA sola vez en Ejecutivos.
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

  select count(*) into v_abiertas from public.ordenes where estado = 'abierta';
  raise notice 'Cuentas abiertas ahora: %. Las que tengan Menú Resplandor o Seco pasan a 20.000 cada uno.', v_abiertas;
end $$;

-- ── 2. Almuerzos a 20.000 ─────────────────────────────────────────────────────────────────────────────────────────────

update public.productos
   set precio = 20000
 where categoria = 'Ejecutivos'
   and nombre in ('Menú Resplandor', 'Seco')
   and precio <> 20000;

-- ── 3. Los cuatro bowls a 15.000 ──────────────────────────────────────────────────────────────────────────────────────

insert into public.productos (id, categoria, nombre, precio, descripcion, etiqueta, activo, en_carta) values
  ('bowl_criollo', 'Bowls', 'Bowl criollo', 15000,
   'Arroz, chicharrón, guacamole, maicitos y plátano maduro en trocitos', 'Incluye guarapo', true, true),
  ('bowl_mixto', 'Bowls', 'Bowl mixto', 15000,
   'Pasta corta sobre mix de lechugas, pollo y carne desmechados, y moneditas de plátano verde', 'Incluye guarapo', true, true),
  ('bowl_resplandor', 'Bowls', 'Bowl Resplandor', 15000,
   'Arroz, pollo agridulce, vegetales salteados y papa con mayonesa', 'Incluye guarapo', true, true),
  ('bowl_arma', 'Bowls', 'Arma tu bowl', 15000,
   'Base: arroz, pasta, frijol o mix de lechugas. '
   || 'Proteína: pollo desmechado, pollo agridulce, carne desmechada, carne molida, atún o huevo cocido. '
   || 'Vegetales: pico de gallo, tomate y zanahoria, o pepino y zucchini. '
   || 'Guarnición: plátano maduro, chips de plátano, yuca frita o papa cocinada.', 'Incluye guarapo', true, true)
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
     where categoria = 'Ejecutivos' and nombre in ('Menú Resplandor', 'Seco') and precio <> 20000
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
-- Tiene que devolver 6 filas: Menú Resplandor y Seco a 20000, y los 4 bowls a 15000 con «Incluye guarapo». Y la carta
-- pública, igual:
--
--   select id, categoria, nombre, precio, etiqueta, activo, en_carta from public.productos
--    where (categoria = 'Ejecutivos' and nombre in ('Menú Resplandor', 'Seco')) or categoria = 'Bowls'
--    order by categoria, nombre;
--
--   select categoria, nombre, precio, etiqueta from public.carta_publica
--    where categoria in ('Ejecutivos', 'Bowls') order by categoria, precio, nombre;
