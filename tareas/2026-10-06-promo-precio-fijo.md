---
estado: en-curso
dueño: ambos
fecha: 2026-10-06
tema: las promociones de PRECIO FIJO («Combo hamburguesas: 2 Hamburguesas Resplandor por $50.000») se aplican solas en la cuenta, como ya lo hacen las de descuento, con una regla nueva «cada N por $X»
criterio_cierre: con la regla puesta en «Combo hamburguesas», agregar 2 Hamburguesa Resplandor el día de la promo deja la cuenta en $50.000 (una unidad en su línea y la otra en la línea de promo), 3 → $80.000 y 4 → $100.000; desde Productos se puede elegir «precio fijo del grupo» en vez de «descuento %»; el banner de promos de hoy, la chip de la línea y la carta lo describen; con sus pruebas (Postgres en Docker y navegador); visto de Yonatan
---

Pedido de Yonatan del 2026-10-06 (noche, martes), mirando la mesa 1 en el POS de escritorio con 2 Hamburguesa Resplandor a $30.000 = $60.000 y el
«Combo hamburguesas» agregado aparte como un producto más de $50.000:
«si agrego 2 hamburguesas resplandor no hace el descuento cuando se adiciona y queda el precio normal 60, del martes ni del día actual».

## Lo que hay hoy y lo que hay que cuidar (para una sesión fría)

- Desde 20261005100000_precio_vivo_y_promos.sql la base aplica las promociones como REGLA (`productos.promo_regla`, solo en filas de la
  categoría Promociones): `{ cada: N, descuento: %, aplica: { categorias: [...], productos: [...] } }`. `privado.normalizar_items(items, dia)`
  arma grupos de N unidades entre las líneas que la regla alcanza y mueve la unidad más barata de cada grupo a una línea
  `promo:<promo>:<base>` con precio positivo (`promo: { id, de, nombre, precio, descuento }`); el día es el de la escritura en Bogotá
  (`privado.dia_promo()`) y la promo vale el día que diga `productos.dia_semana` de la fila promo (README §07 «Precio vivo y promociones como
  regla»). El CHECK `productos_promo_regla_valida` (`privado.promo_regla_ok`) exige `descuento` 1–100.
- Desde 20261006110000/20261006130000 (precio a mano) la línea puede llevar `precio_manual`/`precio_por`, la promo descuenta sobre el precio
  manual y la línea de promo recuerda la marca de su base (`promo.precio_manual`, `promo.precio_por`, `promo.precio`). La última versión vigente de
  `privado.normalizar_items` es la de 20261006130000: cualquier cambio sale de ESE cuerpo con `create or replace` (diff mínimo, declarado).
- El sobre `docs/sobres/2026-10-05-reglas-de-promos.sql` (aplicado en producción) puso regla a las tres promos de descuento (3er almuerzo,
  Entradas de la carta, Cócteles/jugos/sodas) y dejó A PROPÓSITO sin regla a las de precio fijo: Almuerzos, Combo hamburguesas, Dupleta de
  papas, Picada + jarra de Cantarito. Por eso «Combo hamburguesas» sigue siendo un producto con botón + en la carta del mesero.
- En pos.html: `reglaPromoValida` (misma forma que el CHECK), `promosAutomaticasHoy` + `reglaTxt` (banner `.promo-hoy`, solo anuncio),
  `productosPorCategoria` esconde las promos con regla, el modal de producto edita la regla (`guardarProducto`), la chip `.promo-chip` en la línea
  del pedido, `_esLineaDe`, y el recálculo LOCAL de las líneas de promo de una base en `_ponerPrecioLocal` (usa `promo.descuento`). Todo eso tiene
  que entender la regla nueva o, como mínimo, no romperla.
- Producción: proyecto `lccgehvyymladqvumcez`; las migraciones las pega Yonatan en el SQL Editor (Línea Roja: aparca) y se confirman con un
  select. El POS al aire hoy es 2026.10.06-97b0cca (otra sesión publicó esta tarde: cronómetro de espera por mesa, marca «servida», lápida de
  cuentas borradas): esta rama parte de esa `main` (ffe9a75).

## Propuesta (decisiones por defecto, a confirmar con Yonatan)

1. **Regla nueva:** `{ cada: N, precio: X, aplica: {...} }`, con `precio` = lo que cuesta el GRUPO de N unidades (COP enteros, 1 … 10.000.000) y
   EXACTAMENTE uno de `descuento` / `precio`. `privado.promo_regla_ok` lo valida (create or replace; el CHECK existente queda igual porque llama a
   la función). Las reglas de descuento no cambian ni un byte de comportamiento.
2. **Cómo se cuenta:** igual que el descuento: la unidad más barata de cada grupo pasa a la línea `promo:<promo>:<base>`, con precio
   `max(0, X − Σ precio de las otras N−1 unidades del grupo)`; `promo` lleva `precio_fijo: X` (y `precio` = el de la base, como hoy), sin
   `descuento`. Con 2 Hamburguesa Resplandor a 30.000 y el combo a 50.000: base 1 × 30.000 + promo 1 × 20.000 = 50.000; con 3: 80.000; con 4: dos
   grupos, 100.000. Precio a mano: entra en la suma como hoy (sobre el precio manual). Si X es menor que la suma de las otras N−1, la unidad de
   promo queda en 0 (y se anota en la bitácora: es una regla mal puesta, no un caso).
3. **POS:** en el modal de producto, la regla ofrece «descuento %» o «precio fijo del grupo $» (uno u otro); `reglaTxt` dice «2 por $50.000» (y
   sigue diciendo «cada 3, 20 %»); la chip de la línea de promo lo refleja; `_ponerPrecioLocal` (y cualquier otro recálculo local) sabe de
   `precio_fijo`; `reglaPromoValida` acepta la forma nueva. La carta pública: lo que hoy muestre de las promos del día con regla, con el mismo texto.
4. **Datos:** un sobre `docs/sobres/2026-10-06-promo-precio-fijo.sql` que pone a «Combo hamburguesas» la regla
   `{ cada: 2, precio: 50000, aplica: { productos: [<id de Hamburguesa Resplandor>] } }` buscando por nombre y categoría, con comprobación que
   aborta si no cuadra y reversa. El trigger `productos_tocan_cuentas` (20261005100000) re-normaliza las cuentas abiertas al poner la regla:
   la mesa 1 de la captura debería quedar en 50.000 por sí sola. Las otras de precio fijo (Almuerzos, Dupleta de papas) las pone Yonatan desde
   Productos cuando confirme qué incluyen.
5. **Fuera de alcance (anotar, no hacer):** combos de productos DISTINTOS («Picada + jarra de Cantarito»: 1 + 1): la regla de grupo no distingue
   composición. Queda como tarea aparte si Yonatan la quiere.

## Bitácora
