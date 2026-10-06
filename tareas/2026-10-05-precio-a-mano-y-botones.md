---
estado: en-curso
dueño: ambos
fecha: 2026-10-05
tema: en el pedido, el mesero puede poner a mano el precio de una línea (y ese precio no lo pisa el precio vivo), y los botones + − de cada línea pasan a ser discretos para no comer espacio en el celular
criterio_cierre: tocar el precio de una línea abre un campo numérico, el valor queda en la cuenta, el ticket y la carta, y sobrevive a un cambio de precio en Productos (la base lo respeta); los + − miden lo justo (44 px de toque, sin caja grande) y la línea se lee en dos renglones a 390 px; con sus pruebas (arnés de Postgres y navegador); visto de Yonatan
---

Pedido de Yonatan del 2026-10-05 (noche), mirando el pedido en el celular con las líneas de promo ya al aire:
«se debe poder editar el valor a mano de cada producto; los botones + − deben ser sutiles para no comer tanto espacio».

## Lo que hay hoy y lo que hay que cuidar (para una sesión fría)
- Cada línea es `{ id, nombre, precio, qty, nota, promo? }`. Desde `20261005100000_precio_vivo_y_promos.sql` la base **refresca el
  precio de toda línea de producto** desde `productos` en cada escritura (`privado.normalizar_items`, paso b) y recalcula el total.
  Un precio puesto a mano se perdería en la siguiente escritura. Diseño propuesto: la línea lleva `precio_manual: true` (y el POS
  lo manda en `aplicar_delta_orden`, que hoy recibe `p_precio` pero el trigger lo pisa); `normalizar_items` NO refresca las líneas con
  `precio_manual`, y las promos sí las cuentan con su precio manual. Un ítem manual (`manual_…`) ya queda fuera del refresco.
- Dónde se edita: tocar el precio unitario de la línea (`.precio-unit`, pos.html vista orden) abre un campo numérico (como el del
  abono: `campo-monto`); Enter guarda. Cambiar el precio de una línea con qty > 1 cambia las qty unidades. Quién puede: hoy el
  mesero edita productos; decidir si poner precio a mano es de mesero o solo admin (`puede('…')`).
- Cómo viaja: `_enviarDelta` manda `precio` solo al crear la línea; para cambiar el precio de una línea existente hace falta una RPC
  nueva (`fijar_precio_item(orden, item, precio)`) o extender `actualizar_nota_item`; con `version` como el resto.
- Los + −: `.qty-ctrl` / `.qty-btn` (pos.html) son cajas de 44×44 con borde; «sutiles» = 44 px de toque pero sin caja (solo el signo,
  en apoyo), y la cantidad en medio; la línea cabe en dos renglones a 390 px. pos-ola-b2-navegador y pos-para-llevar miden estos
  botones (44 px): adaptar las aserciones de aspecto, no las de tamaño de toque.

## Bitácora
- 2026-10-05: declarada por la sesión de hallazgos-domingo (ya en 840k de contexto) para una sesión fresca:
  `cd ~/Developer/resplandor/resplandor && claude` → `/casa precio-a-mano-y-botones`. Nada hecho todavía.
- 2026-10-06 (agente de implementación, rama `tarea/precio-a-mano-y-botones`, sin push ni migración aplicada): **hecho** el código y las pruebas; falta el visto de Yonatan
  y la salida al aire. **Decisiones por defecto** (Yonatan puede cambiarlas): (1) tocar el precio unitario abre un campo en pesos enteros en la misma línea (Enter o
  salir guarda, Escape cancela, vacío no cambia nada) y cambia el precio de TODAS las unidades de la línea; mientras se escribe, los otros enlaces de esa línea se esconden
  para que la fila no crezca; (2) mesero y admin (`puede('precio_a_mano')`), solo en cuenta abierta de una mesa: no en cobrar por partes, ni en promoción, abono o marcador
  «para llevar»; (3) la línea queda con `precio_manual: true` y `precio_por` (el correo de Google, lo escribe la base con `mi_correo()`, no el POS); `privado.normalizar_items`
  no la refresca y las promociones la cuentan con su precio manual, y la línea de promo recuerda la marca de su base (`promo.precio_manual`: si la base se va entera a la
  promo y vuelve, vuelve a mano); todo en la migración nueva `20261006110000_precio_a_mano.sql` (create or replace, idempotente, reversa en la cabecera: borrar la RPC y volver
  a pegar 20261005100000, que es idempotente y devuelve `normalizar_items` a la de antes); (4) RPC `fijar_precio_item(p_orden_id, p_item_id, p_precio)`: SECURITY INVOKER con los guardias
  de `aplicar_delta_orden` (orden bloqueada y abierta, `version` sube) más `mi_rol()` admin o mesero (42501); el POS la llama como `actualizar_nota_item` con reintento y marca pendiente
  (`preciosPendientes`: el eco de Realtime no la borra, recargar espera); (5) «Volver al precio de carta» = enlace en la línea con precio a mano, manda `p_precio = null` y la base quita
  la clave `precio_manual` (en vez de dejarla en `false`) para que el jsonb quede limpio; (6) los + − de cada línea (hijos directos de la fila) siguen en 44×44 de toque pero sin caja
  ni borde, apoyo sobre papel, la cantidad en medio y sin hueco; el selector «Cobrar n de qty» conserva su caja. **Decisiones mías** (el pedido no las fijaba): el tope es de 0 a
  10.000.000 por unidad y 0 vale (una cortesía); un ítem manual (`manual_…`) también cambia de precio, pero sin marca ni «volver a la carta»; la base rechaza con 22023 lo que no es un
  producto o un ítem manual; sin la migración, tocar un precio avisa «falta aplicar la actualización de la base» y deja el precio como estaba; la pastilla «a mano» es texto, no solo color;
  el margen de `.order-info` pasó de .5 a .25rem y el hueco de `.item-acciones` de .375 a .25rem para que precio, «Asignar a persona» y «Para llevar» quepan en un renglón a 390 px
  (la línea de la mesa 3 pasó de 141/114/113 px a 97/94/93). **Lo hecho:** migración + `migracion-precio-a-mano.test.mjs`; `pos.html` (campo, enlace, pendientes, `_devolverLocal` conserva
  la marca, CSS); arneses `_pos-vm.mjs` (`rpcPrecioAMano`) y `_pos-simulado.mjs` (`fijar_precio_item` y `rpcFalla`); `precio-a-mano-navegador.test.mjs` (estática, `vm`, 390 y 1280 px);
  README (sección «Precio a mano por línea del pedido») y `docs/pos-visual.md`; `migracion-carta-etiqueta.test.mjs` suma la migración a la lista de posteriores; versión sellada
  **2026.10.06-c304651** (`css.mjs --comprobar`, `iconos.mjs --comprobar` y `descubrimiento.mjs` al día, sin cambios). **Pruebas (números reales):**
  `node --test scripts/pruebas/migracion-precio-a-mano.test.mjs` con Docker 24 de 24 (y con mutantes: sin el respeto por la marca en el paso b o sin la guarda de `mi_rol()` fallan 11 y 8);
  `node --test scripts/pruebas/precio-a-mano-navegador.test.mjs` 28 de 28; vecinas con `SIN_DOCKER=1`: pos-orden-escritorio 57/57, pos-para-llevar 57/57, pos-personas-botones 38/38,
  pos-ola-b2 18/18, pos-ola-b2-navegador 9/9, hallazgos-domingo-navegador 10/10, pos-visual 34/34, pos-ola-c3 17/17, pos-ola-c3-navegador 18/18, integracion-correcciones 28/28, desborde 10/10,
  contraste 39/39, version 22/22, descubrimiento 61/61; con Docker: migracion-precio-vivo 36/36, migracion-carta-etiqueta 22/22, migracion-pago-breb 32/32, migracion-cola-impresion 26/26,
  migracion-cuenta-en-vivo 42/42, integracion-pago-breb 21/21 (a la primera, con la máquina en load 400, falló 1 de 21 —el «R2» de la llave con el QR de otra— y repetida sola pasó 21/21);
  **suite completa** `SIN_DOCKER=1 node --test --test-concurrency=1 scripts/pruebas/*.test.mjs`: **2428 pruebas, 2425 pasan, 0 fallan, 2 saltadas, 1 todo** (36 min).
  **Queda:** el visto de Yonatan en el celular; aplicar `20261006110000_precio_a_mano.sql` en Supabase (SQL Editor, lo hace él) ANTES del push del POS; y decidir si 0 pesos debe pedir un
  paso más (hoy se acepta sin confirmar) y si el tope de 10.000.000 es el que quiere.
- 2026-10-06 (agente corrector, ronda 2 tras la refutación; sin push ni migración aplicada): la refutación (sin crítico ni alto) dejó un hallazgo medio y cinco bajos; **corregidos** los
  cuatro primeros, **no corregidos** los dos últimos, por decisión. **Corregido:** (1) [medio] una línea que la promo se lleva ENTERA («3er almuerzo»: tres ejecutivos distintos × 1) ya tiene precio
  a mano y «Volver al precio de carta»: la RPC, si no hay línea base pero sí líneas de promo con `promo.de` = ese id, escribe `promo.precio` / `promo.precio_manual` / `promo.precio_por` en ellas y
  el paso a' de `normalizar_items` despliega la base con el precio a mano (con `null` quita la marca por el mismo camino); «volver a la carta» con la base presente también quita la marca que
  recuerdan sus líneas de promo; y, de paso, **un hallazgo mío** (no estaba en la refutación): tocar el plato en la carta mientras la promo se lo lleva entero a precio a mano creaba una línea
  base nueva sin marca y el precio a mano se perdía en silencio; ahora el paso a' adopta la marca de la línea de promo si la base vuelve sin marca (y la que trae marca propia manda). En el POS,
  `puedeFijarPrecio`/`tienePrecioManual` ofrecen el precio (el campo trae el precio del plato sin el descuento), «a mano» y «Volver» en una línea de promo cuya base no está (`_baseEnPromo`,
  `_lineaDePrecio`, `_lineaOBase`; el pendiente, el eco y el revertir operan sobre el id de la base). (2) [bajo] `confirmarPrecio` pasa a `fijarPrecioLinea(item, precio, orden)` la cuenta del
  campo (`e.ordenId`) y `puedeFijarPrecio(item, orden)` mira esa cuenta: el precio ya no cae en la cuenta activa de otra mesa. (3) [bajo] «la línea X no existe en la orden Y» sale con SQLSTATE
  P0002 y «orden X no existe» sigue P0001; el POS (`esLineaInexistente`) ante cualquier rechazo definitivo (línea, orden o cuenta cerrada) revierte el precio, avisa en una línea y relee la
  cuenta, en vez de soltar el pendiente con un precio en pantalla que la base nunca aceptó. Todo en la migración nueva `20261006130000_precio_a_mano_promo_entera.sql` (create or replace de la
  RPC y de `normalizar_items`, con el mismo cuerpo salvo lo dicho, comparado línea por línea en la prueba; se niega a correr si falta 20261006110000; reversa: volver a pegar 20261006110000, que es
  idempotente); la 20261006110000 no se tocó. **No corregido, decisión de Yonatan:** (4) [bajo] `precio_por` forjable por un UPDATE directo de `ordenes.items` (mesero por la API): un guardia en
  `ordenes_guardia` no cupo limpio (la RPC es SECURITY INVOKER, así que haría falta un `set_config` local; y el POS mismo escribe marcas, con su `precio_por` local, por escritura directa: la fila
  entera de una mesa abierta sin red, el cobro completo y por partes que copian la línea; un guardia que rechace o quite la marca rompería cobros que mueven dinero). Queda dicho en la cabecera de la
  migración, en el README y en una prueba (que fallará el día que se agregue el guardia): `precio_por` es la atribución que pone la RPC, no un dato a prueba de falsificación, y no se usa para
  decidir nada; Yonatan decide si se rechaza la marca directa o se acepta que es informativa. **Tampoco corregidos** (heredados, a decisión de Yonatan): el precio a mano pendiente vive solo en memoria
  (`preciosPendientes`: sin red y con un reinicio del navegador antes de que vuelva, la primera lectura de la base lo devuelve a la carta sin aviso; la misma arquitectura que las marcas «para
  llevar»), y la carrera de dos tablets en el cobro parcial (la A fija el precio, la B atrasada cobra por partes esa línea al precio viejo: la venta cerrada queda al precio viejo y la cuenta al nuevo;
  heredada del precio vivo, el INSERT cerrado no se normaliza a propósito). **Nota para el visto de Yonatan:** en la línea de promo sin base, el botón muestra el precio CON el descuento (16.800) y el
  campo se abre con el del plato SIN descuento (21.000); si prefiere otra cosa (mostrar el del plato, o un texto junto al campo), es un cambio de `pos.html` sin tocar la base. **Orden de salida:**
  20261006110000, luego 20261006130000, luego el push del POS (con el POS puesto y sin la 130000, el precio de un plato dentro de una promo avisa «La cuenta … cambió…» y lo deja como estaba).
- 2026-10-06 (agente corrector, ronda 3 tras la refutación de la ronda 2; sin push ni migración aplicada): la refutación de 78462d5 (0 crítico, 0 alto) dejó **un medio (regresión
  propia del diff) y dos bajos**; **corregidos los tres**. **(1) [medio] la marca vieja vuelve por «Deshacer»:** una línea que VUELVE de una venta cerrada (`deshacer_cobro`) traía
  la marca «a mano» de cuando se cobró y el bloque de adopción del paso a' de la ronda 2 se la pegaba a una base presente sin marca: la cuenta cobraba un precio que el mesero ya
  había quitado con «Volver al precio de carta» (D1: catálogo real «3er almuerzo», 50.000 en vez de 55.400) o que era del otro grupo de la misma mesa (D2: el plato que nadie tocó pasaba a
  15.000 «a mano»), firmado con el correo de quien lo puso antes. **Regla nueva: la cuenta manda** (cabecera de la migración y README): al devolver una venta a una cuenta abierta, si la
  cuenta YA tiene ese plato (su base con ese id, o una línea de promo de esa base), las unidades devueltas se suman al precio y la marca que la cuenta tiene hoy y la línea devuelta pierde la
  suya (`precio_manual`/`precio_por` en una base; `promo.precio_manual`/`promo.precio_por` en una línea de promo, cuyo `promo.precio` se queda); si la cuenta NO tiene nada de ese plato, vuelve
  tal como se vendió, con su marca (lo que ya hacía 110000). Implementado con `create or replace` de `public.deshacer_cobro_sumar` DENTRO de `20261006130000` (editada en su sitio: no estaba
  aplicada en ninguna parte), con el mismo cuerpo de 20261002180000 (no se quitó ni una línea; se agregaron 25) y la reversa en la cabecera con el cuerpo viejo exacto; `deshacer_cobro` no
  cambia, y el bloque de adopción del paso a' **se queda**: sigue siendo necesario (tocar en la carta un plato cuya base está absorbida a precio a mano) y correcto; su único peligro era
  recibir una marca vieja, que era este hallazgo. «La cuenta» es la que había antes de sumar (`p_base`), no lo que ya se agregó de la misma venta; una base que vuelve a una cuenta donde
  el plato solo vive dentro de la promo toma el `promo.precio` y la marca de esa línea de promo (si hay varias, la que tiene marca). **(2) [bajo] campo de precio abierto sobre una línea de
  promo SIN base + un eco que trae la base de vuelta:** `confirmarPrecio` resuelve ahora la línea del plato de ahora (la fila, o por `fila.promo.de` con `_lineaOBase`: la base si
  reapareció, la base suelta si todavía está dentro de la promo); si la fila ya no está o no hay línea alguna de ese plato, avisa «La cuenta cambió, vuelve a tocar el precio.» (solo si había
  algo escrito) en vez de perder el precio en silencio. **(3) [bajo] «la línea no existe» salía como HTTP 500** (PostgREST convierte todo `P0xxx` salvo P0001 en 500): ahora `PT404`
  (PostgREST devuelve el estado HTTP que dice el código: 404); como PostgREST usa el MESSAGE como texto de la línea de estado HTTP, el message es fijo y sin ids («linea inexistente en la
  orden») y la frase con los ids va en DETAIL; el POS (`esLineaInexistente`) reconoce `PT404` y el texto de la RPC vieja, y `esOrdenInexistente` no toma un `PT404` por «orden no existe».
  **De paso:** `integracion-punta-a-punta.test.mjs` (Docker + navegador; ya fallaba 4 de 7 en 78462d5, por una cadena de un solo fallo) usaba el selector
  `.btn-enlace:not(.btn-enlace-llevar)` para «Asignar a persona», que desde el precio a mano resuelve a 3 botones (precio, «Volver», persona) y rompía el paso 3 y los que dependen de él
  (incluido «Deshacer contra deshacer_cobro de verdad»); ahora filtra por el texto del enlace de la persona y pasa 7 de 7. Versión sellada **2026.10.06-65d16a2**.
  **No corregido (sin cambios respecto a la ronda 2, decisión de Yonatan):** `precio_por` forjable por escritura directa; el precio pendiente solo en memoria; la carrera de dos tablets en
  el cobro parcial. **Anotado, no tocado (heredado de 20261005100000):** `deshacer_cobro` calcula `monto` ANTES de que el trigger del precio vivo recalcule la cuenta, así que con promos el
  `monto` (y `deshechos.monto`) fue lo que se cobró en D1 (12.000) solo porque la cuenta no tenía nada del plato: en el camino «mismo id» ya no lo era desde 180000 y la regla nueva suma el camino «solo promo» (ver la refutación 3, bajo 1). Pruebas nuevas: D1 y D2 invertidos y los bordes de la regla en
  `migracion-precio-a-mano-promo-entera.test.mjs` (con dos mutantes que matan: sin la regla, y quitando la marca siempre), V1 y su variante (la fila desaparece) en
  `precio-a-mano-navegador.test.mjs`, y las que miraban P0002 ahora miran PT404. **Rondas de refutación:**

  | ronda | sha refutado | crít/alto | medio | bajo | regresiones propias del diff |
  |---|---|---|---|---|---|
  | 1 | 8bc9278 | 0 / 0 | 1 | 5 | — (primera vuelta) |
  | 2 | 78462d5 | 0 / 0 | 1 | 2 | 1 (la marca vieja por «Deshacer», efecto del paso a' de la ronda 2) |
  | 3 | 3cbaf45 | 0 / 0 | 0 | 3 | 1 (`monto` en el camino nuevo; cifra informativa) |

  **Refutación 3 (2026-10-06, sobre 3cbaf45): aprobar con notas.** Tres rondas seguidas sin crítico ni alto y esta sin medio: la regla «la cuenta manda» hace lo que dice el
  README en todos los caminos de dinero probados con el catálogo real (cobro completo reabierto, parcial de base y de promo, varias líneas, deshacer dos veces, dos promos del mismo plato,
  venta con base y promo en los dos órdenes; diferencial sin marcas contra el cuerpo de 180000: 50 de 56 pares byte a byte y los 6 distintos son el camino diseñado). Quedan tres bajos,
  anotados y sin corregir: **(1)** `monto` de `deshacer_cobro` (y `deshechos.monto`) ya no es «lo cobrado» en el camino nuevo «la cuenta solo tiene el plato dentro de la promo» (la línea se
  reprecia antes de que 180000 calcule `v_monto := v_total - v_antes`; sin marcas: cobrado 18.000, `monto` 18.500 si Productos subió el plato); en el camino «mismo id» ya no lo era desde
  180000. Es lo que el POS enseña en «Cobro deshecho · $ X volvió a la cuenta» y en «Cobros deshechos hoy»; no mueve dinero. Qué debe ser `monto` (lo cobrado: una línea en
  `deshacer_cobro`, en su propia migración; o lo que la cuenta creció) es decisión de Yonatan. **(2)** `confirmarPrecio` con el campo abierto sobre la BASE y la promo que se la lleva entera
  antes de Enter avisa «La cuenta cambió» en vez de seguir al plato con `_lineaOBase(orden, e.itemId)` (un toque más, sin pérdida). **(3)** `_devolverLocal` (pos.html) y `juntar` del
  simulador vm no conocen «la cuenta manda»: entre el deshacer y la relectura forzada, en local puede verse la marca vieja; ninguna prueba vm puede verlo hasta que el simulador modele la
  regla. Guiones del refutador en `/private/tmp/claude-501/wf-resplandor/precio-a-mano-y-botones/refutar3/`. **Orden de salida** (igual): 20261006110000, luego 20261006130000, luego el
  push del POS; con el POS puesto y sin la 130000, el precio de un plato dentro de una promo avisa «La cuenta … cambió…» y lo deja como estaba.

- 2026-10-06 04:00 · **Integración y salida.** Fusionada con cierres-de-hoy-y-panel-admin en la rama `tarea/integracion-cierres-precio` (merge 90a2fb0, versión sellada
  **2026.10.06-895b69a**) y publicada en `main` esta madrugada con el GO de Yonatan («haz push y deploy de todo»). Suite completa sobre el árbol fusionado: 2511 pasan, 0 fallan, 2 saltadas;
  con Docker: migracion-precio-a-mano 24, migracion-precio-a-mano-promo-entera 33, migracion-precio-vivo 36, migracion-carta-etiqueta 22, migracion-pago-breb 32, migracion-cola-impresion 26,
  migracion-cuenta-en-vivo 42, integracion-pago-breb 21, integracion-punta-a-punta 7, todas con 0 fallos. Ninguna función Edge cambia. **Lo que queda de Yonatan:** (1) pegar en el SQL
  Editor `20261006110000_precio_a_mano.sql` (junto con 20261006100000, un solo pegado) y confirmar con el select; (2) después pegar `20261006130000_precio_a_mano_promo_entera.sql`
  (junto con 20261006120000) y confirmar; (3) el visto en el celular (campo de precio, pastilla «a mano», «Volver al precio de carta», los + − discretos, y en una línea de promo sin base
  el botón muestra el precio CON descuento y el campo se abre con el del plato SIN descuento); (4) las decisiones anotadas: `monto` al deshacer, `precio_por` forjable, pendiente solo en
  memoria, la carrera de dos tablets, 0 pesos sin confirmación extra y el tope de 10.000.000. Hasta el visto y el SQL, la tarea sigue en-curso.

- 2026-10-06 04:40 · **Migraciones en producción.** Yonatan pegó en el SQL Editor de `lccgehvyymladqvumcez` primero `20261006110000_precio_a_mano.sql` (con 20261006100000, un solo
  pegado) y después `20261006130000_precio_a_mano_promo_entera.sql` (con 20261006120000); las dos veces «Success. No rows returned» y el select de confirmación en `true`
  (deshacer_cobro_sumar con «la cuenta manda», fijar_precio_item con PT404). El POS al aire (2026.10.06-895b69a) ya corre contra la base completa. Queda solo el visto de Yonatan en el celular.
