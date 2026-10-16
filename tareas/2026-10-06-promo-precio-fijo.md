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
  1 peso de más; el error es de hasta k/2 pesos, k = los grupos de esa línea (corregido en la ronda 2); con la regla del combo es exacto); (4) el texto del POS usa el formato de la casa «$ 50.000» (con espacio), no «$50.000»; (5) una promo de precio fijo sin precio propio
  toma el del grupo al guardarse (es lo que muestra la carta pública; la ronda 2 lo volvió «un solo precio, siempre»). **Pruebas (números reales):** `node --test scripts/pruebas/migracion-promo-precio-fijo.test.mjs` con Docker
  30 de 30; `node --test scripts/pruebas/promo-precio-fijo-navegador.test.mjs` 17 de 17 (a 390 y 1280 px; con el `pos.html` de antes fallan 16 de 17: solo pasa la de «el descuento no
  cambió»); con Docker: migracion-precio-vivo 36/36, migracion-precio-a-mano 24/24, migracion-precio-a-mano-promo-entera 33/33, migracion-carta-etiqueta
  22/22; además, por tocar el final de la cadena: migracion-normalizar-items-union 18/18, migracion-cobrar-parcial 40/40, migracion-lapida-borradas 31/31, migracion-servida 18/18,
  migracion-promo-cobro-por-partes 32/32, migracion-promo-regla-ejecutable 14/14; con `SIN_DOCKER=1`: hallazgos-domingo-navegador 10/10, precio-a-mano-navegador 39/39,
  pos-orden-escritorio 57/57, pos-visual 34/34, version 22/22, descubrimiento 61/61; y las vecinas del POS en `vm`
  (pos-ola-b2 18/18, pos-roles-alertas-cobros 68/68, pos-resincronizacion 25/25, pos-cobrar-parcial 51/51, pos-promo-cobro-por-partes 13/13, pos-promo-red-relectura 16/16, pos-version-con-items 29/29,
  pos-cuenta-congelada 36/36, pos-cuenta-borrada 31/31, pos-para-llevar 57/57, pos-personas-botones 38/38). La prueba de Postgres incluye **mutantes** (7: sin el tope del precio de lista, sin el
  filtro del grupo que ya costaba X, unidad de promo siempre gratis, el grupo suma todo lo elegible, el validador que acepta los dos a la vez, tope de precio pasado y precio 0): todos mueren, ya sea al aplicarse
  (la migración se comprueba a sí misma al final) o en el cuadro de escenarios. No se corrió la suite completa (el encargo lo prohibía).
  **Queda:** (lo de la ronda 1 quedó superado por la ronda 2 de abajo: el orden de salida cambió y el producto del combo ya no hay que quitarlo a mano) el visto de Yonatan y el orden de salida de la ronda 2.

- 2026-10-06 (corrector, **ronda 2**, rama `tarea/promo-precio-fijo`, sobre 709f270; sin push, merge, deploy, migración ni sobre aplicados): la refutación de 709f270 dio **0 críticos, 1 alto, 3 medios y 3 bajos**; el cálculo de
  la base y las promos de descuento estaban bien (24.000 casos comparados contra el cuerpo anterior, byte a byte). **Corregido:**
  (1) **[ALTO] el doble cobro con una tablet sin recargar** (*lo que sigue de este punto lo reemplazó la ronda 3: el producto ya NO vale 0 siempre, regalaba el combo vendido como producto; ver abajo*): se neutraliza en la BASE. En `privado.normalizar_items`, paso b (UNA línea, declarada en la cabecera y comprobada línea por línea contra la unión), una línea
  cuyo producto (`split_part(id, '__', 1)`) tiene `promo_regla` queda con precio 0, **todos los días**, salvo `precio_manual` (se respeta como hoy). Un martes, 2 hamburguesas + el producto «Combo hamburguesas» que una tablet
  vieja sigue ofreciendo dan **50.000** con la línea del combo a 0 (antes 100.000); otro día 60.000 y a 0; con precio a mano la línea conserva su precio; «Volver al precio de carta» la deja en 0. Para las promos de descuento no
  cambia nada: el diferencial (cuentas sin productos-promo de precio fijo, 3.000 cuentas al azar × 8 días, primera y segunda pasada) da **0 diferencias** contra el cuerpo de 709f270 con el catálogo completo y contra el de
  `20261006140000` con un catálogo de solo descuento (también con las líneas de los productos de las promos de descuento, cuyo producto ya valía 0). Como efecto (hoy solo con el par de hamburguesas al lado, ronda 3), la cuenta de la captura (el combo agregado a mano) queda con esa
  línea a $ 0 al correr el sobre y ya no hay que quitársela a mano. **No tiene arreglo en la base**: editar el combo desde un POS viejo (aunque sea solo la etiqueta) sube `promo_regla: null` y borra la regla (y sin red esa
  tablet deja cobrar la cuenta al precio normal); queda como paso obligatorio del orden de salida (abajo).
  (2) **[MEDIO] reglas que ya existían**: la migración es ahora UNA transacción (`begin` … `commit`) y, justo después de poner el validador nuevo, revisa `productos.promo_regla`: si alguna no pasa, aborta **sin cambiar nada** (ni
  el validador nuevo) con un mensaje que lista `id («nombre», regla …)` y dice cómo arreglarla; vale pegada en el SQL Editor y con el arnés. Probado con filas heredadas (`precio: null`, `precio: "x"`, `precio: 0` junto al
  `descuento`, sin `cada`, sin `descuento`): la migración falla y la radiografía de funciones, el comentario, las reglas y las cuentas quedan idénticos; arregladas las filas, aplica sin un aviso. Además `normalizar_items` **nunca lanza
  por una regla rara**: una regla que `privado.promo_regla_ok` no acepta se salta y las demás aplican (probado con seis reglas ilegibles; sin el salto, lanzaba).
  (3) **[MEDIO] volver a pegar una `normalizar_items` anterior**: la consecuencia real no es que «la regla deje de cumplirse» sino que la línea de promo sale con `precio: null`, el total la ignora y cada par se **regala** (2 hamburguesas
  30.000, 4 → 60.000); corregidas la cabecera de la migración y el README; la reversa correcta es la que ya estaba (regla a null primero). No se cambió el formato de la regla.
  (4) **[MEDIO] dos precios del combo**: un solo precio. Al guardar una promo de precio fijo desde el POS, el precio del producto (el que muestra la carta) pasa a ser el del grupo, siempre; en el modal, con «Precio fijo del grupo» el
  campo de precio del producto muestra el del grupo, no se edita aparte (solo lectura, borde de rayas) y una línea lo explica; al pasar a «Descuento %» el producto vuelve a 0. El sobre pone también `precio = 50000` (explícito e idempotente) y
  lo comprueba. `promo-precio-fijo-navegador.test.mjs` cambió su aserción de ~186 (el precio del producto ahora SÍ cambia) y mira el campo a 390 y 1280 px.
  (5) **Orden de salida y textos del ALTO** (README §07, esta bitácora, la cabecera de la migración y el sobre): **1) la migración, 2) el push del POS, 3) recargar TODAS las tablets y comprobar, en el pie de cada una, que muestran la
  versión nueva (la misma de `version.json` al aire), 4) recién entonces el sobre.** Corregido README:772 («con el POS de antes la cuenta ya se calcula bien») y la frase del sobre «el POS ya no lo ofrece»: con la neutralización una tablet vieja ya no
  cobra dos veces, pero editar el combo desde ella borra la regla.
  (6) **[BAJOS de texto]** el error del promedio redondeado es de **hasta k/2 pesos** (k = grupos de esa línea), no «menos de N» (cabecera, README, esta bitácora y el comentario de la prueba); el cálculo local del POS (`_ponerPrecioLocal` +
  `repartoPrecioFijo`) **no** es «la misma cuenta que la base»: es una aproximación que el eco corrige (README).
  **Anotado y no tocado (hallazgo 7, BAJO):** `cuentaTendriaPromo` da por hecho el combo con N unidades aunque el grupo cueste X o menos (2 hamburguesas a mano a 20.000: la base no aplica combo, pero la tablet niega el cobro por partes y
  el cobro sin red); es un error del lado conservador (no cobra de menos).
  **Pruebas (números reales, esta máquina):** `node --test scripts/pruebas/migracion-promo-precio-fijo.test.mjs` con Docker **38 de 38** (ahora con la neutralización: el doble cobro, el diferencial 2 × 400 cuentas × 8 días, las filas heredadas con su base propia, el sobre con su precio único, y **8 mutantes** que mueren, el nuevo «sin neutralizar» incluido); `SIN_DOCKER=1 node --test scripts/pruebas/promo-precio-fijo-navegador.test.mjs` **18 de 18** (a 390 y 1280 px; el campo de precio único, readonly, y el precio del producto que ahora SÍ cambia); con Docker: migracion-normalizar-items-union 18/18, migracion-precio-vivo 36/36, migracion-precio-a-mano-promo-entera 33/33, migracion-carta-etiqueta 22/22; con `SIN_DOCKER=1`: hallazgos-domingo-navegador 10/10, precio-a-mano-navegador 39/39, pos-orden-escritorio 57/57. Además, por tocar el final de la cadena y pos.html: Docker migracion-cobrar-parcial 40/40, migracion-lapida-borradas 31/31, migracion-servida 18/18, migracion-promo-cobro-por-partes 32/32, migracion-promo-regla-ejecutable 14/14, migracion-precio-a-mano 24/24; pos-visual 34/34, version 22/22, descubrimiento 61/61; vecinas del POS en `vm` (pos-ola-b2 18/18, pos-roles-alertas-cobros 68/68, pos-resincronizacion 25/25, pos-cobrar-parcial 51/51, pos-promo-cobro-por-partes 13/13, pos-promo-red-relectura 16/16, pos-version-con-items 29/29, pos-cuenta-congelada 36/36, pos-cuenta-borrada 31/31, pos-para-llevar 57/57, pos-personas-botones 38/38). A mano, con los guiones del refutador: la migración pegada como UNA consulta (como el SQL Editor) aborta con filas heredadas dejando las funciones idénticas (md5 igual) y aplica una vez arregladas; el diferencial de 3.000 cuentas × 8 días × 4 combinaciones da 0 diferencias contra 709f270 y contra la unión. No se corrió la suite completa
  **Versión sellada:** 2026.10.15-51148d9.
  **Queda:** el visto de Yonatan, y que él pegue en este orden: la migración (si avisa de reglas que el validador nuevo no acepta, las lista con id y nombre: arreglarlas y volver a pegar), el push del POS, recargar todas las tablets y mirar el
  pie (la versión de `version.json`), y por último el sobre; confirmar con la select del sobre (la fila «Combo hamburguesas» con su `promo_regla` y `precio` 50000) y mirar la mesa 1 un martes (2 hamburguesas → 50.000); decidir si el combo debe seguir
  valiendo solo el martes y si las otras de precio fijo (Almuerzos, Dupleta de papas) también van con regla; el combo de productos DISTINTOS (Picada + jarra) queda como tarea aparte.

  **Ronda 3** (corrector, rama `tarea/promo-precio-fijo`, sobre 0d907db; sin push, merge, deploy, migración ni sobre aplicados): la refutación de 0d907db dio **1 crítico y 3 bajos** (el cálculo de los grupos, el
  validador, la migración transaccional y el sobre quedaron bien). El crítico era una **regresión de la ronda 2** respecto de 709f270. **Corregido:**
  (1) **[CRÍTICO] la neutralización regalaba el combo vendido como producto.** Antes del sobre el combo NO tiene regla: es un producto de 50.000 que el mesero agrega a mano (la única forma de venderlo, también
  para el POS nuevo entre el paso 2 y el 4 del orden de salida), y el paso b de la ronda 2 ponía en 0 TODA línea de un producto con `promo_regla`, hubiera o no formado grupos la regla en esa cuenta. Medido por el
  refutador (Postgres 17, un martes): Combo ×1 50.000 → 0 al pegar el sobre; Combo + soda 14.000 con un abono de 30.000 → −16.000 (la cuenta «le debía» al cliente); una venta del combo cobrada (50.000) y
  deshecha después del sobre → se devuelven 50.000 y la cuenta reabierta queda en 0; lo mismo con el cobro por partes; y pasar desde el modal una promo que hoy se vende como producto a automática (Dupleta
  38.000) la dejaba en 0 en cada cuenta abierta. **Ahora** (`privado.normalizar_items`, paso c, justo después de contar los grupos de cada regla; el paso b vuelve a ser **idéntico al de la unión**): de las líneas
  del producto de ESA promo de precio fijo (`split_part(id, '__', 1)` = el id de la promo; categoría Promociones, mismo criterio `/promo/i` del POS), **tantas unidades como grupos formó la regla en esa cuenta
  hoy quedan pagadas por esos grupos** (precio 0). Resultados: la captura (2 hamburguesas + el combo) **50.000**; el combo solo **50.000**; combo + 1 hamburguesa **80.000**; 2 combos + 2 hamburguesas **100.000**
  (la línea se promedia a 25.000, un combo de más; el redondeo es de hasta qty/2 pesos); 4 hamburguesas + 2 combos 100.000; un miércoles (sin grupos) 110.000; precio a mano respetado; «Volver al precio de carta»
  la deja en lo que le toca (0 con el par). El precio se calcula siempre desde el catálogo, no del que traiga la línea (idempotente: probado en las dos pasadas). Con los guiones del refutador en mi base:
  `combo-solo` → o-solo **50.000** (antes 0), o-abono **34.000** (antes −16.000), deshacer completo **monto 50.000 con total_abierta 50.000** (antes 0), deshacer parcial **monto 50.000 y el combo vuelve a la
  cuenta a 50.000** (antes @0); `dupleta` → **38.000** (antes 0). Diferencial (semilla 0.777, 3.000 cuentas × 8 días contra el cuerpo de 709f270 con el sobre pegado): de las 6.336 con líneas del combo, **344**
  cambian (antes 5.488), todas hacia abajo (0 suben), solo en el precio de esa línea, y solo donde la regla formó el grupo (Σ 33.699.996 en esos casos sintéticos, antes 1.032.800.000); las 17.664 sin combo, **0
  diferencias**; contra la unión con un catálogo de solo descuento, 0. **Decisiones:** (a) el sobre **no** aborta ni lista las cuentas abiertas con el combo y el orden de salida **no** exige vaciarlas: con la
  base corregida un combo solo conserva su precio y con el par se cobra una vez (que es lo que se pidió), así que no hay nada que perder; (b) solo las promos de **precio fijo** de la categoría Promociones: las de
  descuento no cambian ni un byte (su producto vale 0 desde siempre); (c) con más unidades del producto que grupos, la línea se promedia en vez de partirse en dos (partir una línea obligaría a ids nuevos que el POS
  no espera). Textos corregidos (cabecera de la migración, sobre, README §07, esta bitácora): ya no dicen «queda en $ 0» ni «no hay que quitársela a mano» sin condición; dicen que un combo agregado solo conserva
  sus 50.000. Pruebas nuevas que lo fijan: el combo solo / con 1 hamburguesa / con el par / 2 combos + 2 hamburguesas / otro día / variante con nota / precio a mano / volver a la carta; un abono, el cobro por partes y
  «Deshacer» completo y parcial; la Dupleta vuelta automática; el sobre contra cuentas con el combo solo (69.000) y con 1 hamburguesa (80.000); el diferencial con líneas del combo (solo cambia el precio de esa línea,
  nunca sube, nunca cambia sin grupos); y **6 mutantes nuevos** (sin neutralizar; neutralizar sin grupos; neutralizar todas las unidades; ignorar el precio a mano; ignorar la categoría; volver al paso b de la
  ronda 2): todos mueren.
  (2) **[BAJO] la base ponía en 0 el producto con regla de cualquier categoría** (un «Ensalada con proteína» con regla puesta por SQL quedaba en 0 con un POS que lo sigue ofreciendo): corregido por lo mismo de
  arriba, que solo toca precio fijo en Promociones; el producto con regla fuera de Promociones conserva su precio (prueba con `t-fuera`, un día propio) y el de descuento no se toca.
  (3) **[BAJO] modal: precio fijo → descuento → desmarcar «automática» → Guardar no hacía nada, y pasar por precio fijo perdía el precio propio de una promo de descuento** (pos.html): `ponerTipoRegla` guarda el
  precio propio al pasar a precio fijo y lo recupera al volver a descuento (solo vale 0 si el precio venía del grupo); la casilla llama a `alAlternarRegla`, que al desmarcar deja el precio del grupo en el
  producto si el del formulario no sirve; y `guardarProducto` avisa «Falta el precio del producto (de $ 1 en adelante)…» en vez de quedarse muda. Probado en el vm con los casos 7 y 10 del refutador (fallan con el
  `pos.html` de antes).
  (4) **[BAJO] el arnés vm no neutralizaba el producto del combo** (`normalizadorDeCombo` en `_pos-vm.mjs`): ahora hace lo mismo que la base (grupos formados → unidades pagadas; sin grupos conserva el precio de
  catálogo; precio a mano respetado) y tiene sus casos (la línea del combo en el POS: solo 50.000, con el eco de las 2 hamburguesas 50.000 y la línea en $ 0).
  **Anotado y no tocado:** (a) 40 de 24.000 casos del diferencial no son idempotentes **solo en el orden de las líneas** (una base que la promo se llevó entera vuelve al final de la cuenta, como ya pasa con las promos de
  descuento): los mismos 40 en 709f270, con el mismo total; (b) `cuentaTendriaPromo` sigue dando por hecho el combo con N unidades aunque el grupo cueste X o menos (hallazgo 7 de la ronda 2); (c) editar
  el combo desde un POS viejo sigue borrando la regla (sin arreglo en la base: por eso el orden de salida).
  **Pruebas (números reales, esta máquina bajo carga):** `node --test scripts/pruebas/migracion-promo-precio-fijo.test.mjs` con Docker **40 de 40** (antes 38; el doble cobro se reescribió y suman los cobros/deshacer y
  la Dupleta; el diferencial ahora 3 × 400 × 8 casos); `SIN_DOCKER=1 node --test scripts/pruebas/promo-precio-fijo-navegador.test.mjs` **21 de 21** (antes 18; a 390 y 1280 px); con Docker:
  migracion-normalizar-items-union 18/18, migracion-precio-vivo 36/36, migracion-precio-a-mano-promo-entera 33/33, migracion-carta-etiqueta 22/22, migracion-cobrar-parcial 40/40, migracion-lapida-borradas 31/31,
  migracion-servida 18/18, migracion-promo-cobro-por-partes 32/32, migracion-promo-regla-ejecutable 14/14, migracion-precio-a-mano 24/24; con `SIN_DOCKER=1`: hallazgos-domingo-navegador 10/10,
  precio-a-mano-navegador 39/39, pos-orden-escritorio 57/57, pos-visual 34/34, version 22/22, descubrimiento 61/61; vecinas del POS en `vm`: pos-ola-b2 18/18, pos-roles-alertas-cobros 68/68,
  pos-resincronizacion 25/25, pos-cobrar-parcial 51/51, pos-promo-cobro-por-partes 13/13, pos-promo-red-relectura 16/16, pos-version-con-items 29/29, pos-cuenta-congelada 36/36, pos-cuenta-borrada 31/31,
  pos-para-llevar 57/57, pos-personas-botones 38/38. No se corrió la suite completa.
  **Versión sellada:** 2026.10.15-0a8f263 (`css.mjs --comprobar`, `iconos.mjs --comprobar` y `descubrimiento.mjs` al día, sin cambios; `version.mjs` al final).
  **Queda:** igual que en la ronda 2 (el visto de Yonatan y el orden de salida: migración, push del POS, recargar TODAS las tablets y mirar el pie, y por último el sobre). El sobre ya no necesita que las mesas
  estén vacías: una cuenta con el combo solo conserva sus 50.000 y con el par queda en 50.000.

  | ronda | sha | crít/alto | regresiones |
  |---|---|---|---|
  | 1 | 709f270 | 0/1 | 0 |
  | 2 | 0d907db | 1/0 | 1 (la neutralización de la ronda 2 regalaba el combo vendido como producto) |

  (La ronda 3 queda en el commit siguiente a 0d907db, el último de la rama; a refutar.)
