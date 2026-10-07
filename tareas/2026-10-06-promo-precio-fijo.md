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

- 2026-10-06 (agente de implementación, rama `tarea/promo-precio-fijo`, sin push ni migración ni sobre aplicados): **hecho** el código, los datos y las pruebas; falta el visto de Yonatan
  y la salida al aire. **Lo hecho:** (1) migración `supabase/migrations/20261006170000_promo_precio_fijo.sql`: `privado.promo_regla_ok` acepta `{cada, precio, aplica}` (precio entero de 1 a
  10.000.000) y exige EXACTAMENTE uno de `descuento` / `precio`; `privado.normalizar_items` suma el cálculo del precio fijo (la unidad más barata de cada grupo de N → `max(0, X − Σ de las otras
  N−1)`, línea `promo:<promo>:<base>` con `promo.precio_fijo = X`, el precio a mano entra en la suma, idempotente, el paso a' y todo lo del precio a mano intactos); comentario de
  `productos.promo_regla` al día; se niega a correr sin cambiar nada si falta `20261006130000` o la unión `20261006140000`; (2) sobre `docs/sobres/2026-10-06-promo-precio-fijo.sql` (regla de
  «Combo hamburguesas»: `{cada 2, precio 50000, la Hamburguesa Resplandor de Platos Fuertes}`, una transacción que aborta si no hay exactamente una fila de cada nombre ni la migración, con
  reversa); (3) `pos.html`: modal con «Descuento %» o «Precio fijo del grupo $» (uno u otro, validación en pantalla), `guardarProducto` escribe la forma nueva, `reglaPromoValida` con las dos formas,
  `reglaTxt` «2 por $ 50.000 en Hamburguesa Resplandor» (el banner `.promo-hoy` lo muestra), pastilla «Combo · 2 por $ 50.000» (`pastillaPromo`), `_ponerPrecioLocal` con `repartoPrecioFijo`, etiquetas
  accesibles «sin el combo»; `_esLineaDe` y la carta pública no cambian (`carta.html` no muestra la regla: solo la etiqueta y el precio del producto); (4) pruebas
  `migracion-promo-precio-fijo.test.mjs` y `promo-precio-fijo-navegador.test.mjs`, y las bases falsas (`_pos-vm.mjs`: `normalizadorDeCombo`, `productosDelCombo`; `_pos-simulado.mjs`) aprenden el
  precio fijo; (5) README §07 («Promociones de precio fijo») y esta bitácora; versión sellada **2026.10.06-1b4117c** (`css.mjs --comprobar`, `iconos.mjs --comprobar` y `descubrimiento.mjs` al día, sin
  cambios).
  **Dos desviaciones del encargo, a propósito:** (a) la migración se llama `20261006170000_promo_precio_fijo.sql`, NO `20261006140000_…`: ese prefijo ya es de
  `20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql` (las pruebas exigen prefijos únicos) y, sobre todo, esa unión —no `20261006130000`— es la versión VIGENTE de `normalizar_items`
  (pliega la promo sin objeto y respeta el precio a mano a la vez): cortar de `130000` habría borrado el pliegue en silencio. La nueva parte del cuerpo de la unión, va última de la cadena y el diff
  contra la unión es solo el bloque del precio fijo (declarado en la cabecera y comprobado línea por línea en la prueba). Por eso `migracion-carta-etiqueta`, `migracion-cobrar-parcial`,
  `migracion-lapida-borradas` y `migracion-normalizar-items-union` suman la migración al final de la cadena (esta última, también a los tres órdenes de pegado); (b) `public.fijar_precio_item` NO se
  tocó: el precio que pone en una línea de promo con la base absorbida es provisional, y el UPDATE de `ordenes` pasa por `trg_ordenes_a_precio_vivo`, que pliega la línea y la recalcula con
  `normalizar_items` (comprobado en Postgres con precio fijo y la base absorbida).
  **Decisiones por defecto** (Yonatan puede cambiarlas): la propuesta de arriba tal cual, más lo que la propuesta no fijaba: (1) la unidad de promo nunca cuesta más que su precio de lista y un grupo
  que ya costaba X o menos no genera línea de promo (con la hamburguesa a 20.000 las dos siguen en 40.000, no suben a 50.000); (2) X menor que las otras N−1 → 0, nunca negativo (regla mal puesta: se
  anota, no es un caso); (3) con precios mezclados en una regla por categoría, una línea que reparte unidades entre grupos de distinto costo recibe el promedio redondeado (9.999 y 20.000 → 15.000,
  1 peso de más: menos de N pesos; con la regla del combo es exacto); (4) el texto del POS usa el formato de la casa «$ 50.000» (con espacio), no «$50.000»; (5) una promo de precio fijo sin precio propio
  toma el del grupo al guardarse (es lo que muestra la carta pública). **Pruebas (números reales):** `node --test scripts/pruebas/migracion-promo-precio-fijo.test.mjs` con Docker
  30 de 30; `node --test scripts/pruebas/promo-precio-fijo-navegador.test.mjs` 17 de 17 (a 390 y 1280 px; con el `pos.html` de antes fallan 16 de 17: solo pasa la de «el descuento no
  cambió»); con Docker: migracion-precio-vivo 36/36, migracion-precio-a-mano 24/24, migracion-precio-a-mano-promo-entera 33/33, migracion-carta-etiqueta
  22/22; además, por tocar el final de la cadena: migracion-normalizar-items-union 18/18, migracion-cobrar-parcial 40/40, migracion-lapida-borradas 31/31, migracion-servida 18/18,
  migracion-promo-cobro-por-partes 32/32, migracion-promo-regla-ejecutable 14/14; con `SIN_DOCKER=1`: hallazgos-domingo-navegador 10/10, precio-a-mano-navegador 39/39,
  pos-orden-escritorio 57/57, pos-visual 34/34, version 22/22, descubrimiento 61/61; y las vecinas del POS en `vm`
  (pos-ola-b2 18/18, pos-roles-alertas-cobros 68/68, pos-resincronizacion 25/25, pos-cobrar-parcial 51/51, pos-promo-cobro-por-partes 13/13, pos-promo-red-relectura 16/16, pos-version-con-items 29/29,
  pos-cuenta-congelada 36/36, pos-cuenta-borrada 31/31, pos-para-llevar 57/57, pos-personas-botones 38/38). La prueba de Postgres incluye **mutantes** (7: sin el tope del precio de lista, sin el
  filtro del grupo que ya costaba X, unidad de promo siempre gratis, el grupo suma todo lo elegible, el validador que acepta los dos a la vez, tope de precio pasado y precio 0): todos mueren, ya sea al aplicarse
  (la migración se comprueba a sí misma al final) o en el cuadro de escenarios. No se corrió la suite completa (el encargo lo prohibía).
  **Queda:** el visto de Yonatan; **aplicar** `20261006170000_promo_precio_fijo.sql` en Supabase (SQL Editor, lo hace él, **después** de la unión `20261006140000` y de las migraciones que ya haya pegado), luego
  el push del POS y **al final** el sobre `docs/sobres/2026-10-06-promo-precio-fijo.sql` (con el POS de antes el combo seguiría ofreciéndose como producto y la pastilla diría «−undefined %»);
  confirmar con la select que el sobre devuelve (la fila «Combo hamburguesas» con su `promo_regla`) y mirar la mesa 1 un martes (2 hamburguesas → 50.000); **quitar a mano** de las cuentas abiertas el
  producto «Combo hamburguesas» si ya lo habían agregado (el sobre no lo quita: se cobraría dos veces); y decidir si el combo debe seguir valiendo solo el martes (hoy `dia_semana` = 2, como está en producción) y si las
  otras de precio fijo (Almuerzos, Dupleta de papas) también van con regla; el combo de productos DISTINTOS (Picada + jarra) queda como tarea aparte.
