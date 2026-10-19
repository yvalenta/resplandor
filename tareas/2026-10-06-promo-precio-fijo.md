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

> **Ronda 5, leer primero:** la neutralización del producto de la promo que describen las rondas 2, 3 y 4 de abajo (el paso c que ponía en 0 el producto, los grupos completos, el trigger que también miraba ventas deshacibles) se RETIRÓ en la ronda 5 («simplificar», decisión de Yonatan): lo que esas rondas dicen sobre ella es historia, no lo que hace el código. Lo vigente está en la entrada de la ronda 5, al final, y en el README §07.

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
  (1) **[CRÍTICO] la neutralización regalaba el combo vendido como producto** (*lo que sigue de este punto lo completó la ronda 4: la heurística de los grupos no distingue un combo servido de verdad de uno repetido, así que la base ya no deja encender la regla con ese producto en una cuenta; ver abajo*)**.** Antes del sobre el combo NO tiene regla: es un producto de 50.000 que el mesero agrega a mano (la única forma de venderlo, también
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
  diferencias**; contra la unión con un catálogo de solo descuento, 0. **Decisiones:** (a) *(reemplazada por la ronda 4: el sobre SÍ se niega con el combo vendido como producto en una cuenta o en una venta que se puede deshacer, y el orden de salida sí pide el combo fuera de las mesas)* el sobre **no** aborta ni lista las cuentas abiertas con el combo y el orden de salida **no** exige vaciarlas: con la
  base corregida un combo solo conserva su precio y con el par se cobra una vez (que es lo que se pidió), así que no hay nada que perder; (b) solo las promos de **precio fijo** de la categoría Promociones: las de
  descuento no cambian ni un byte (*ronda 4: «su producto vale 0 desde siempre» no es cierto, el modal conserva a propósito el precio propio de una promo de descuento y su línea se cobra aparte de su descuento; tampoco se toca*); (c) con más unidades del producto que grupos, la línea se promedia en vez de partirse en dos (partir una línea obligaría a ids nuevos que el POS
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
  **Queda:** igual que en la ronda 2 (el visto de Yonatan y el orden de salida: migración, push del POS, recargar TODAS las tablets y mirar el pie, y por último el sobre). *(La frase «El sobre ya no necesita que las mesas
  estén vacías» la reemplazó la ronda 4: el sobre se niega mientras el combo esté vendido en una cuenta o en una venta que se pueda deshacer.)*

  **Ronda 4** (corrector, rama `tarea/promo-precio-fijo`, sobre 7f72e14; sin push, merge, deploy, migración ni sobre aplicados): la refutación de 7f72e14 dio **1 crítico, 1 medio y 1 bajo** (los grupos,
  el validador, la migración transaccional, el sobre y el POS quedaron bien). Los dos primeros son el mismo problema visto de dos lados: la neutralización de la ronda 3 era una **heurística** («si el par se forma,
  la línea del producto lo repite») y la base no puede saber si esa línea repite el par o es un combo servido de verdad. **Corregido:**
  (1) **[CRÍTICO] un combo vendido de verdad como producto quedaba gratis cuando el par llegaba después** (y al deshacer su venta, y al convertir otra promo desde Productos). Medido por el refutador (Postgres 17, un
  martes): R1, una mesa compra el combo a las 19:30 (50.000), se pega el sobre, piden 1 hamburguesa (80.000) y otra: bajaba a 50.000 (se esperaban 100.000); R2, la Dupleta de papas como producto (38.000) vuelta
  automática desde Productos, la mesa pide 2 Papas: 38.000 en vez de 76.000; F2/F3/F4, deshacer una venta del combo (50.000, o combo + 2 hamburguesas 110.000, o un parcial) después del sobre devolvía lo cobrado y la
  cuenta reabierta quedaba en 50.000; y lo cobrado dependía del orden (A: 50.000; B, con el combo cobrado por partes antes: 100.000). **La decisión no la puede tomar una heurística sino quien tiene las cuentas
  delante (Yonatan), y esta ronda la deja en sus manos con el menor riesgo por defecto** (opciones (a) y (c) de la refutación, generalizadas): un **trigger** sobre `productos`
  (`productos_promo_precio_fijo_en_cuentas`, `BEFORE UPDATE OF promo_regla, activo, categoria`; función `privado.promo_precio_fijo_en_cuentas`, SECURITY DEFINER, solo lee) **rechaza con `RS008` —y se deshace todo el
  UPDATE— que una promo de precio fijo de la categoría Promociones pase a aplicarse sola mientras su producto esté vendido en una cuenta abierta o en una venta cerrada que todavía se puede deshacer** (sin cierre del
  día: `cierre_ordenes`). El mensaje dice en qué mesas y cuántas unidades, y qué hacer (quitar la línea con la ✕ si repite el par, o esperar a que se cobre y a que se haga el cierre del día). Cubre **todos** los
  caminos: el sobre del combo, el modal de producto (Almuerzos y la Dupleta, que Yonatan convertirá desde Productos) y cualquier escritura del personal con la API (la RLS deja editar productos a un mesero). Con eso,
  después de encender la regla las únicas líneas del producto que pueden aparecer son las de una tablet sin recargar, y esas SÍ repiten el par: la neutralización queda como red de seguridad coherente (sin la
  premisa falsa de antes). El POS trata el RS008 como rechazo definitivo (`esErrorPromoEnCuentas`, `_promoEnCuentas` en `pushASupabase`): avisa con el texto de la base (que nombra las mesas), suelta la subida pendiente
  —no se reintenta sola cuando la última cuenta se cierre— y vuelve a leer los productos. Con las pruebas del refutador sobre la base nueva: R1, el sobre se niega («mesa 301 (cuenta abierta: 1 unidad)») y no cambia
  nada; quitada la línea, se aplica y 2 hamburguesas son 50.000; R2, el admin y el mesero se niegan con la Dupleta en una cuenta, y con la línea quitada se aplica; con la venta cobrada del combo sin cierre del día, el
  sobre se niega, y con la venta ya archivada en un cierre, no la cuenta; F2/F3/F4 y A/B ya no se pueden armar porque ninguna cuenta ni venta deshacible lleva el combo cuando la regla se enciende. Los textos dejan de decir
  «nada se regala», «no hay nada que perder», «el sobre ya no necesita que las mesas estén vacías» (cabecera de la migración, sobre, README §07, esta bitácora); el orden de salida pide el combo fuera de las cuentas
  y de las ventas que se pueden deshacer (lo más simple: pegar el sobre con el día cerrado). **Decisiones por defecto** (Yonatan puede cambiarlas): (a) el rechazo y no el congelado: el congelado (opción (b), poner
  `precio_manual` 50.000 a esas líneas) dejaba la captura —2 hamburguesas + el combo agregado a mano— en 100.000 y no resolvía las ventas que se deshacen; (b) las ventas cobradas cuentan hasta el cierre del día, que es
  cuando `deshacer_cobro` deja de poder devolverlas; (c) la línea del combo con **precio a mano se respeta** (una orden explícita del mesero, ya probada desde la ronda 3): combo a 45.000 con el par = 95.000 y
  «Volver al precio de carta» la deja en 0; el refutador lo cuenta como «subir la cuenta» pero es el mesero quien pone ese precio en una línea que muestra $ 0.
  (2) **[MEDIO] con un precio a mano o la hamburguesa a ≤ 25.000 volvía el doble cobro y bajar un precio subía la cuenta** (regresión parcial del arreglo del alto de la ronda 1). La neutralización contaba solo los
  grupos que generan línea de promo (los que cuestan MÁS de X): con el combo en la cuenta, la hamburguesa a mano a 26.000 → 50.000, a 25.001 → 50.000, a 25.000 → 100.000, a 20.000 → 90.000. Ahora cuenta los
  **grupos completos** (`v_u ÷ N`, con `v_u` = las unidades que la regla alcanza, **también las de precio 0 y las del grupo que cuesta X o menos**; CTE `q0` en `privado.normalizar_items`): 30.000 → 50.000, 26.000 → 50.000,
  25.001 → 50.000, 25.000 → **50.000**, 20.000 → **40.000**, 10.000 → 20.000, 1 → 2, 0 → 0 (nunca sube al bajar), lo mismo por catálogo (hamburguesa a 25.000 en la carta), y 3 hamburguesas a 25.000 + 2 combos = 125.000
  (el grupo paga UN combo). Por catálogo, la Hamburguesa Resplandor a 25.000 con combo + 2 daba 100.000 y da 50.000. Sin la línea del combo en la cuenta nada cambia (el diferencial lo prueba byte a byte).
  (3) **[BAJOS de texto, triviales]** «su producto vale 0 desde siempre» (migración, README): no es cierto, el modal conserva a propósito el precio propio de una promo de descuento y su línea se cobra aparte de su
  descuento (Entradas de la carta a 12.000 + 2 Patacones un sábado = 27.000; desde 20261005100000); la ronda 4 lo dice y lo prueba (no se neutraliza; conviene decidir si debería, y por ahora queda como estaba).
  «Las cuentas abiertas vuelven a 60.000» al borrarse la regla (sobre, README): una cuenta con el par y la línea del combo neutralizada vuelve a **110.000** (60.000 del par + 50.000 del combo a precio de carta); el
  sobre y el README lo dicen y hay una prueba.
  **Anotado y no tocado:** (a) el cobro por partes de la línea del combo de una tablet vieja antes de que llegue el par (la guardia RS005 solo mira las líneas de promo) sigue siendo posible y el combo ya cobrado se
  paga una vez más con el par: afecta solo a tablets sin recargar; (b) una venta del combo de un cierre de un día anterior que un admin reabre con `reabrir_venta_de_cierre` después del sobre vuelve a la cuenta sin que el
  trigger la haya visto (ya no está en `cierre_ordenes`); muy raro; (c) `cuentaTendriaPromo` (hallazgo 7 de la ronda 2); (d) editar el combo desde un POS viejo borra la regla.
  **Pruebas (números reales, esta máquina bajo carga):** `node --test scripts/pruebas/migracion-promo-precio-fijo.test.mjs` con Docker **45 de 45** (antes 40: suman el trigger de las cuentas con su prueba de ocho casos y **21 mutantes** que mueren —los 13 de antes y 8 nuevos: contar solo los
  grupos que cuestan más de X, dejar fuera las unidades a precio 0, y seis del trigger—, «bajar un precio nunca sube la cuenta» por precio a mano y por catálogo, la promo de descuento con precio propio y tres del sobre; el diferencial sigue en
  3 × 400 × 8 casos con 0 diferencias en las cuentas sin el combo y, con él, solo cambia el precio de esa línea, hacia abajo: 97 cuentas, 2 de ellas con el grupo barato); `SIN_DOCKER=1 node --test scripts/pruebas/promo-precio-fijo-navegador.test.mjs`
  **24 de 24** (antes 21; con Node 22 corren los dos de navegador a 390 y 1280 px; con el `pos.html` de antes fallan los 2 del RS008); con Docker: migracion-normalizar-items-union 18/18, migracion-precio-vivo 36/36,
  migracion-precio-a-mano-promo-entera 33/33, migracion-carta-etiqueta 22/22, migracion-cobrar-parcial 40/40, migracion-promo-cobro-por-partes 32/32, migracion-precio-a-mano 24/24, migracion-lapida-borradas 31/31,
  migracion-servida 18/18, migracion-promo-regla-ejecutable 14/14; con `SIN_DOCKER=1`: hallazgos-domingo-navegador 10/10, precio-a-mano-navegador 39/39, pos-orden-escritorio 57/57, pos-visual 34/34, version 22/22,
  descubrimiento 61/61, identidad 82/82, raiz 16/16, css 1/1, iconos 6/6; vecinas del POS en `vm`: pos-ola-b2 18/18, pos-roles-alertas-cobros 68/68, pos-resincronizacion 25/25, pos-cobrar-parcial 51/51,
  pos-promo-cobro-por-partes 13/13, pos-promo-red-relectura 16/16, pos-version-con-items 29/29, pos-cuenta-congelada 36/36, pos-cuenta-borrada 31/31, pos-para-llevar 57/57, pos-personas-botones 38/38. A mano, con los guiones
  del refutador sobre una base con la migración final: R1 y R2 se niegan (RS008) con la mesa en el mensaje y, quitada la línea, se aplican; la hamburguesa a mano a 30.000, 26.000, 25.001, 25.000, 20.000, 10.000, 1 y 0 deja
  50.000, 50.000, 50.000, 50.000, 40.000, 20.000, 2 y 0. La suite completa que el orquestador corrió sobre 7f72e14 (antes de esta ronda) dio exit 0; no se repitió entera sobre este commit.
  **Versión sellada:** 2026.10.17-2ba9b2f.
  **Queda:** el visto de Yonatan y, en este orden, 1) la migración (si avisa de reglas que el validador nuevo no acepta, las lista: arreglarlas y volver a pegar), 2) el push del POS, 3) recargar TODAS las tablets y mirar el
  pie, 4) el sobre, **con el combo fuera de las cuentas abiertas y de las ventas que se pueden deshacer** (si no, se niega con RS008 y dice en qué mesas; lo más simple: con el día cerrado). Decidir si el producto de una
  promo de descuento con precio propio debería neutralizarse y si las otras de precio fijo (Almuerzos, Dupleta) también van con regla (el trigger las cuida igual).

  **Ronda 5, simplificar** (corrector, rama `tarea/promo-precio-fijo`, sobre af8e019; sin push, merge, deploy, migración ni sobre aplicados). **Decisión de Yonatan.** Cuatro rondas intentaron «neutralizar» en
  `privado.normalizar_items` la línea del PRODUCTO de la promo (el «Combo hamburguesas» agregado como producto de 50.000) para que una tablet sin recargar no cobrara el combo dos veces, y cada versión regaló combos
  vendidos de verdad o volvió a cobrar doble: la base no puede distinguir un combo real de uno agregado de más. **Yonatan eligió SIMPLIFICAR:** la línea del producto combo es una línea de producto más y vale su
  precio de catálogo (50.000) siempre. Lo que las rondas 2 a 4 dicen arriba sobre la neutralización (el paso c que ponía en 0 el producto, los grupos completos, `q0`, `v_k`) es historia: ya no existe. **Hecho:**
  (1) **`privado.normalizar_items` vuelve al cálculo limpio de la ronda 1:** el cuerpo de la unión `20261006140000` más SOLO el precio fijo del paso c (`v_fijo`, `v_pre`, la CTE `gr`, el precio de la unidad de promo y el
  objeto `promo` con `precio_fijo`, como en 709f270) y, de la ronda 2, el salto de la regla que `privado.promo_regla_ok` no acepta (`if not privado.promo_regla_ok(v_promo.regla) then continue; end if;`, para no lanzar
  nunca). Se fue TODO lo de la neutralización: `v_k`, `v_m`, `v_pp`, `v_u`, la CTE `q0`, el recorrido que ponía en 0 la línea del producto y la columna `categoria` del recorrido de promos, que solo servía para eso. El
  paso b es el de la unión. **Comprobado con `diff`** del cuerpo de la función contra el de `git show 709f270:supabase/migrations/20261006170000_promo_precio_fijo.sql`: la única diferencia son dos líneas, el comentario
  y ese salto. Un combo solo vale 50.000; con 1 hamburguesa 80.000; con el par **100.000** (el grupo de 50.000 y la línea del producto a su precio de catálogo, el cobro doble que el orden de salida evita); 2 combos + 2
  hamburguesas 150.000; otro día 60.000 + 50.000; el precio a mano se respeta y «Volver al precio de carta» la deja en 50.000. Una venta del combo que se deshace vuelve a la cuenta como lo que es, un combo vendido a su precio.
  (2) **Se quedan:** el validador nuevo (`privado.promo_regla_ok` con exactamente uno de descuento / precio), el aborto de la migración si alguna `promo_regla` existente no pasa el validador nuevo (una sola
  transacción), la negativa sin `20261006130000` / sin la unión `20261006140000` (ya no pide `20261002180000`: el trigger no lee `cierre_ordenes`), el precio único del combo en el modal (`ponerTipoRegla`,
  `alAlternarRegla`, el campo de precio de solo lectura con precio fijo) y el sobre con `precio = 50000` explícito.
  (3) **El trigger RS008 se queda, pero SOLO mira cuentas abiertas y SOLO la transición** (`productos_promo_precio_fijo_en_cuentas` / `privado.promo_precio_fijo_en_cuentas`): rechaza, sin cambiar nada, convertir un
  producto en promo de precio fijo (poner la regla de precio fijo donde había una de descuento o ninguna), activarla (estaba apagada) o cambiarle la categoría a Promociones, mientras haya una cuenta abierta con una línea de
  ese producto; el mensaje lista las mesas (hasta 8) y las unidades de cada una y (ronda 6: ahora separa las que tienen el par de las que no) dice qué hacer en cada una. Las ventas cerradas o deshacibles ya no importan (y la migración ya no lee
  `cierre_ordenes`). Una regla igual no dispara nada: editar la etiqueta, el precio o la descripción de un combo que YA tiene su regla activa no se rechaza aunque haya cuentas con el producto, tampoco el upsert del POS
  (que manda todas las columnas: probado con un `insert … on conflict do update` de todas las columnas y en el `vm` con `guardarProducto`), ni apagarlo ni quitarle la regla.
  (4) **Textos** (cabecera de la migración, sobre, README §07, esta bitácora y los comentarios de `pos.html` y de las pruebas) dicen lo que hace el código, sin «nunca se regala», «no hay nada que perder» ni la
  neutralización. Lo que queda dicho: la línea del producto combo vale 50.000 siempre; el sobre (y convertir otra promo desde Productos) se rechaza con RS008 mientras haya mesas abiertas con el producto (se cobran, se cambia la línea por el par o, SOLO si repite el par, se
  quita a mano: ronda 6); el orden de salida es **1) migración, 2) push del POS, 3) recargar TODAS las tablets y comprobar en el pie la versión de `version.json` al aire, 4) el sobre**. **Riesgo que queda, dicho tal
  cual:** una tablet sin recargar después del sobre puede agregar el combo como producto (cobro doble si además pide las hamburguesas) y editar el combo desde ella borra la regla (el par deja de formar el combo y la
  cuenta con la línea del producto sube a 110.000); por eso el paso 3.
  (5) **Pruebas:** quitadas las de la neutralización (el doble cobro, los grupos completos, «bajar un precio nunca sube la cuenta» por catálogo, el diferencial «contra la misma función sin la neutralización») y sus 9
  mutantes (sin neutralizar, neutralizar sin grupos, de más, ignorando el precio a mano o la categoría, solo grupos que cuestan más de X, sin las unidades a precio 0, y los dos del trigger que contaban las
  ventas deshacibles y las archivadas); quedan y se ajustan las del precio fijo, el validador, el aborto, el sobre y el modal. Nuevas: la línea del producto combo vale 50.000 siempre (solo, con 1, con el par, 2 combos, otro día, variante con nota,
  precio a mano, volver a la carta, bajar el precio de la hamburguesa a mano nunca sube la cuenta, un abono, el cobro por partes, «Deshacer» completo y parcial, también con el par); el trigger RS008 solo con cuentas
  abiertas (rechaza con una abierta, con la variante con nota y como admin y como mesero; no rechaza con una cerrada, ni deshacible ni archivada; de descuento a precio fijo, de apagada a activa y el cambio de categoría a
  Promociones sí rechazan; editar la etiqueta, el precio o la descripción, el upsert de todas las columnas, apagarla y quitarle la regla no; el mensaje lista las mesas); el sobre se niega con el combo en cuentas abiertas y
  no con una venta cobrada, y el riesgo que queda (la tablet sin recargar: 100.000, y 110.000 si borra la regla); el simulador `vm` (`normalizadorDeCombo`) vuelve al de 709f270 y deja de neutralizar, y su guardia RS008 mira solo
  cuentas abiertas y la transición. **Diferencial:** cuentas sin precio fijo, byte a byte contra el cuerpo de la unión `20261006140000`, en las dos pasadas y los 8 días: con un catálogo de solo descuento (400 cuentas al
  azar × 8 días × 2 pasadas, 0 diferencias) y con el catálogo completo en cuentas que ninguna regla de precio fijo alcanza, con líneas del producto del combo incluidas (otras 400 × 8 × 2, 0 diferencias). **Mutantes**
  (15, todos mueren): sin el tope del precio de lista, sin el filtro del grupo que ya costaba X, unidad de promo siempre gratis, el grupo suma todo lo elegible, el validador que acepta los dos a la vez, tope de precio
  pasado y precio 0, el paso b que pone en 0 el producto de toda promo con regla, la línea del producto en 0 cuando la regla forma un grupo, y seis del trigger (sin mirar cuentas abiertas, mirando ventas cobradas, disparando
  con una regla igual, sin la transición de activar, solo avisando, sin la variante con nota).
  **Pruebas (números reales, esta máquina):** con Docker, `migracion-promo-precio-fijo` 44/44 (los 15 mutantes mueren), `migracion-normalizar-items-union` 18/18, `migracion-precio-vivo` 36/36, `migracion-precio-a-mano-promo-entera` 33/33,
  `migracion-carta-etiqueta` 22/22, `migracion-cobrar-parcial` 40/40, `migracion-promo-cobro-por-partes` 32/32; con `SIN_DOCKER=1`, `promo-precio-fijo-navegador` 24/24 (a 390 y 1280 px),
  `hallazgos-domingo-navegador` 10/10, `precio-a-mano-navegador` 39/39, `pos-orden-escritorio` 57/57, `pos-visual` 34/34; `version` 22/22 y `descubrimiento` 61/61; además, en un solo lote, cinco vecinas del POS en `vm` (pos-ola-b2, pos-promo-cobro-por-partes, pos-promo-red-relectura, pos-cobrar-parcial,
  pos-version-con-items) más identidad, raiz, css e iconos: 232/232. `css.mjs --comprobar`, `iconos.mjs --comprobar`, `descubrimiento.mjs`, `version.mjs` (el último), `version.mjs --comprobar` y
  `descubrimiento.mjs --comprobar` al día. No se corrió la suite completa.
  **Versión sellada:** 2026.10.18-8f2239f.
  **Queda:** el visto de Yonatan y, en este orden, 1) la migración (si avisa de reglas que el validador nuevo no acepta, las lista: arreglarlas y volver a pegar), 2) el push del POS, 3) recargar TODAS las tablets y mirar el pie
  (la versión de `version.json` al aire), 4) el sobre, **con el combo fuera de las cuentas abiertas** (si no, se niega con RS008 y dice en qué mesas y qué hacer en cada una: ronda 6). Decidir si el producto de una
  promo de descuento con precio propio debería comportarse distinto y si las otras de precio fijo (Almuerzos, Dupleta) también van con regla (el trigger las cuida igual, editando la fila que ya existe).

  **Ronda 6** (corrector, rama `tarea/promo-precio-fijo`, sobre 579a828; sin push, merge, deploy, migración ni sobre aplicados; **sin volver a la neutralización**: la línea del producto combo sigue siendo una línea de
  producto que vale 50.000 siempre). La refutación de 579a828 dio **2 medios y 1 bajo**; todo en el trigger RS008 y sus textos, `normalizar_items` no se tocó. **Corregido:**
  (1) **[MEDIO] el RS008 mandaba quitar la línea del combo sin condición.** Antes del sobre el producto es la ÚNICA forma de vender el combo, así que casi toda línea que lista el RS008 es una venta real, y quitarla
  dejaba de cobrar 50.000 por unidad. Medido por el refutador (dos mesas con 1 combo + 1 Seco, 69.000 cada una): hecho lo que decía el mensaje en la mesa 7, quedaba en 19.000; reemplazar la línea por 2 Hamburguesa
  Resplandor (mesa 8) dejaba 69.000, y ningún texto lo decía. **Ahora el mensaje separa las mesas en dos**, calculando por cuenta cuántas unidades de lo que la regla nueva alcanza hay (`aplica.productos` y
  `aplica.categorias`, una línea de otra promo cuenta para su base, la variante con nota también, un producto con regla propia no; igual que `normalizar_items`): **con el grupo completo** (N o más) la línea puede repetir
  el par y se quita con la ✕ SOLO si lo repite (si es un combo servido de verdad además, se cobra la mesa); **sin él** es un combo vendido de verdad («quitarle la línea dejaría de cobrarlo») y se cobra la mesa o se cambia
  la línea por N unidades de lo que la promoción cubre («cada grupo de 2 vale $ 50.000»). La frase «cobraría el producto además del grupo» ya solo se dice a las primeras. Cada lista muestra hasta 8 mesas y «y N más».
  El rechazo no cambia (cualquier mesa con la línea sigue frenando el sobre: la base no distingue después un combo de uno repetido); cambia lo que se le dice a quien tiene las mesas delante. Mismos textos en la
  cabecera de la migración, el sobre (cabecera), el README (§07, tres pasajes), el comentario de `pos.html` (`esErrorPromoEnCuentas`) y el simulador `vm` (`_pos-vm.mjs`, `guardiaPromoEnCuentas`, que ahora también separa).
  (2) **[MEDIO] el RS008 se esquivaba por la categoría.** Solo cuidaba filas de «Promociones» (`categoria ~* 'promo'` en la transición) pero `normalizar_items` aplica toda regla activa, esté el producto donde esté:
  `update productos set categoria='Combos'` y después `set promo_regla=…` pasaba y la cuenta quedaba en 100.000. **El trigger ya no mira la categoría** (ni en la fila nueva ni en la vieja) y sale de la lista de
  columnas: `BEFORE UPDATE OF promo_regla, activo`. La transición es: la regla nueva es de precio fijo, la promo está activa y antes no (otra forma, ninguna o apagada). Además, si el validador no acepta la regla nueva el
  trigger no hace nada (la rechaza el CHECK, que corre DESPUÉS de los BEFORE). En el POS (`pos.html`) `promosAutomaticasHoy` y `productosPorCategoria` tratan igual TODO producto con regla, esté en «Promociones» o no
  (se anuncia el día que aplica y no se ofrece como producto), para que una regla puesta por la API fuera de Promociones no se venda además del grupo desde tablets recargadas; el modal sigue escribiéndola solo en
  Promociones. La cabecera y el README ya no dicen «cubre todos los caminos» (ver el bajo).
  (3) **[BAJO] el RS008 solo cubre el UPDATE de la fila que ya existe** (volver a crear la promo con el mismo id con INSERT, el upsert de una tablet con la caché vieja después de un borrado, cambiarle el id, o crear
  OTRA promo de precio fijo con la misma regla mientras el producto que vendía la anterior sigue en la carta). **No se arregla en el código, se dice y se fija con una prueba:** cubrir el INSERT no es trivial (el
  `BEFORE INSERT` también corre en el upsert de una fila que ya existe, que es el camino del POS, y habría que distinguirlo), solo ganaría los casos rebuscados (b), (c) y (f), y el realista (d) —una promo NUEVA
  mientras el producto viejo sigue en la carta— no se puede cubrir NUNCA: la fila nueva no tiene líneas propias y la base no sabe qué producto vendía la anterior. Por eso la cabecera de la migración (punto 3, «QUÉ CUBRE Y
  QUÉ NO»), el sobre, el README y esta bitácora dicen: **Almuerzos y la Dupleta de papas se convierten desde Productos EDITANDO la fila que ya existe; si se crean con «Nuevo producto», el producto viejo se apaga o se
  borra ANTES.** Prueba `DECLARADO` (Docker): el UPDATE se niega; el INSERT con el mismo id y otra promo nueva pasan y la cuenta cobra el producto y el grupo (38.000 + 38.000 = 76.000, el cobro doble).
  **Pruebas nuevas (cada una fija un hallazgo):** el cuadro del trigger (`probarTrigger`) suma: fuera de Promociones se niega, esquivar la categoría se niega en el segundo paso, mover la categoría de un combo que ya
  tiene la regla o reescribirle la misma regla fuera de Promociones no despierta nada, activar uno apagado fuera de Promociones se niega; el mensaje con el par va SOLO en «Con el grupo completo» y manda quitar la
  línea «SOLO si repite», el de la mesa sin el par va SOLO en «Sin el grupo completo» y manda cobrar o cambiar la línea (nunca «Quita esa línea» ni «cobraría el producto además del grupo»); dos mesas, cada una en su lista
  (la variante con nota y la línea de otra promo suman al grupo); dos unidades de un producto que la regla no alcanza no forman el grupo; una regla por categoría cuenta por categoría; diez mesas salen ocho y «y 2 más».
  La prueba del trigger con la Dupleta suma una mesa con el par de papas; la del sobre separa las mesas 62 (con el par) y 64, 65 (sin él); y una prueba nueva del sobre sigue el mensaje al pie de la letra con dos mesas
  de combo + Seco (**69.000 antes y después** al cambiar la línea por las 2 hamburguesas; 19.000 si se quita sin más, que es lo que el mensaje ya no manda). Textos de cabecera y sobre fijados con frases exactas y con
  «ya no dice»; navegador: el aviso de la mesa sin el par no manda quitar la línea, uno con las dos clases, y «la categoría no importa» (un producto con regla en «Combos» se anuncia y no se ofrece). **Mutantes:** 12 del
  trigger, todos mueren (los 6 de antes, adaptados a la nueva estructura, y 6 nuevos: volver a exigir la categoría al encender, volver a mirarla en la fila vieja, todas las mesas «con el grupo», todas «sin el grupo»,
  las líneas de otra promo que no suman a su base, sin el tope de 8). Reproducción del refutador sobre la base con la migración nueva: el sobre se niega con «Sin el grupo completo (…): mesa 7 (1 unidad); mesa 8 (1 unidad).
  Cobra esas mesas, o cambia cada unidad de la línea por 2 unidades de lo que cubre la promoción (cada grupo de 2 vale $ 50.000)» y deja de mandar quitar; la mesa 8 reemplazada por el par queda en 69.000; el esquive (a) se niega en el
  segundo paso.
  **Anotado y no tocado:** (a) la columna `productos.promo_regla` sigue comentada como «solo filas de la categoría Promociones» (es lo que escribe el modal; la base la aplica en cualquier categoría); (b) el CHECK no
  prohíbe una regla fuera de Promociones: el trigger y el POS ya no dependen de ello.
  **Pruebas (números reales, esta máquina):** con Docker, `migracion-promo-precio-fijo` **46/46**, y vecinas migracion-normalizar-items-union 18/18, migracion-precio-vivo 36/36, migracion-precio-a-mano-promo-entera 33/33,
  migracion-carta-etiqueta 22/22, migracion-cobrar-parcial 40/40, migracion-promo-cobro-por-partes 32/32, migracion-precio-a-mano 24/24, migracion-lapida-borradas 31/31, migracion-servida 18/18,
  migracion-promo-regla-ejecutable 14/14, pos-cobrar-parcial-real 14/14, pos-cuenta-congelada-real 6/6, pos-cuenta-borrada-real 10/10 (una corrida en paralelo falló por tiempo en N1 y sola dio 10/10); con
  `SIN_DOCKER=1`, `promo-precio-fijo-navegador` **26/26** (a 390 y 1280 px), hallazgos-domingo-navegador 10/10, precio-a-mano-navegador 39/39, pos-orden-escritorio 57/57, pos-visual 34/34, pos-promo-cobro-por-partes-navegador 6/6,
  pos-promo-red-relectura-navegador 8/8, version 22/22, descubrimiento 61/61, identidad 82/82, raiz 16/16, css 1/1, iconos 6/6, carta-promos 31/31, promos 28/28; vecinas del POS en `vm`: pos-ola-b2 18/18,
  pos-roles-alertas-cobros 68/68, pos-resincronizacion 25/25, pos-cobrar-parcial 51/51, pos-promo-cobro-por-partes 13/13, pos-promo-red-relectura 16/16, pos-version-con-items 29/29, pos-cuenta-congelada 36/36,
  pos-cuenta-borrada 31/31, pos-para-llevar 57/57, pos-personas-botones 38/38. `css.mjs --comprobar`, `iconos.mjs --comprobar`, `descubrimiento.mjs`, `version.mjs` (el último), `version.mjs --comprobar` y
  `descubrimiento.mjs --comprobar` al día. No se corrió la suite completa (130 archivos).
  **Versión sellada:** 2026.10.18-11adec6.
  **Queda:** el visto de Yonatan y, en este orden, 1) la migración (si avisa de reglas que el validador nuevo no acepta, las lista: arreglarlas y volver a pegar), 2) el push del POS, 3) recargar TODAS las tablets y mirar el pie
  (la versión de `version.json` al aire), 4) el sobre, **con el combo fuera de las cuentas abiertas** (si no, se niega con RS008 y dice en qué mesas y qué hacer en cada una). Decidir si el producto de una
  promo de descuento con precio propio debería comportarse distinto y si las otras de precio fijo (Almuerzos, Dupleta) también van con regla (editando la fila que ya existe).

  | ronda | sha | crít/alto | regresiones |
  |---|---|---|---|
  | 1 | 709f270 | 0/1 | 0 |
  | 2 | 0d907db | 1/0 | 1 (la neutralización de la ronda 2 regalaba el combo vendido como producto) |
  | 3 | 7f72e14 | 1/0 | 1 (parcial: con un precio a mano o la hamburguesa a ≤ 25.000 volvía el doble cobro de la ronda 1; y la heurística seguía regalando el combo servido de verdad) |
  | 4 | af8e019 | sin refutar, reemplazada | reemplazada por la ronda 5: la neutralización se retiró entera |
  | 5 | 579a828 (simplificar) | 0/0 · 2 medios, 1 bajo | 0 (el RS008 mandaba quitar la línea sin condición; se esquivaba por la categoría) |
  | 6 | 5e63f7c | sin refutar: solo el trigger RS008 (rechaza, no cambia montos; si falla adentro deja pasar) y textos; `normalizar_items` y el validador idénticos a la ronda 5 | — |

- 2026-10-18 · **Al aire y aplicada en producción.** Push de la rama a `main` (fast-forward, 5e63f7c, versión **2026.10.18-11adec6**; CI `comprobar` en verde y Pages
  sirviendo esa versión en `version.json` y `pos.html`). Verificación sobre 5e63f7c: suite completa sin Docker 2880 pasan, 0 fallan, 45 saltadas (todas «SIN_DOCKER está puesto»), y las
  21 pruebas con Docker 558/558. Sin refutar la ronda 6: Yonatan eligió «simplificar» con «una refutación corta del resultado y push»; la ronda 5 salió 0/0 y la 6 no cambió ningún
  cálculo (`privado.normalizar_items` es el de 709f270 más el salto de una regla ilegible, comprobado con diff). Yonatan siguió el orden de salida: (1) pegó
  `20261006170000_promo_precio_fijo.sql` en el SQL Editor de `lccgehvyymladqvumcez` («Success. No rows returned»); (2) recargó las tablets; (3) pegó el sobre
  `docs/sobres/2026-10-06-promo-precio-fijo.sql`, cuya comprobación previa exige la migración y el trigger, y su select final mostró «Combo hamburguesas» martes, precio 50.000,
  regla `{cada: 2, precio: 50000, aplica: {productos: [pf7]}}`. Visto de paso en ese select: «3er almuerzo» alcanza hoy solo `ej1` y `ej2` (el sobre del 2026-10-05 lo había puesto sobre
  toda la categoría Ejecutivos): alguien lo cambió desde Productos; no se tocó. **Queda:** el visto de Yonatan un martes (2 Hamburguesa Resplandor = 50.000 con la pastilla del combo,
  el combo ya no se ofrece como producto) y, cuando decida qué incluyen, poner desde Productos la regla de «Dupleta de papas» y «Almuerzos» (se convierten editando la fila existente,
  que es lo que cuida el RS008). La «Picada + jarra de Cantarito» (1 + 1 de productos distintos) sigue fuera de alcance.
