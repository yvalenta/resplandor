---
estado: en-curso
dueño: ambos
fecha: 2026-10-04
tema: lo que Yonatan encontró el domingo usando el POS en el local — precio vivo en las cuentas abiertas, promociones automáticas por día, el pedido flotante en el celular, modo oscuro del POS y la hoja de pago de la carta en una sola pantalla
criterio_cierre: (1) cambiar un precio en Productos cambia ese precio en las cuentas abiertas que lo tienen (en el POS, en la carta NFC y en el ticket) sin tocar las cerradas; (2) el lunes, con 3 almuerzos en la cuenta, el tercero (el más barato) sale con 20 % menos como línea propia, y las promos de precio fijo solo se ofrecen su día; (3) en un celular el pedido es una hoja que sube desde la barra del total y la carta queda siempre a la vista; (4) con el celular en oscuro el POS se ve en telón/arroz, no café sobre café; (5) «Pagar» en la carta muestra QR, llave, valor y efectivo en una sola pantalla y avisa al mesero sin que el cliente elija nada; migraciones aplicadas y función `alerta` desplegada por Yonatan; visto de Yonatan con la pegatina real
---

Pedido de Yonatan del 2026-10-04 (domingo), después de pasar el día en el restaurante tratando de usar el sistema:

1. **Precio vivo.** «Si un producto se actualiza de precio en productos las cuentas en proceso deben tener ese precio… y el precio
   debe ser el mismo de la base de datos en la carta.» Hoy cada línea de una orden copia el precio al agregarse (`_agregarAlPedido`,
   `aplicar_delta_orden`) y nada lo vuelve a tocar.
2. **Promociones por día, con el valor correcto y discriminando productos.** «Si son 2 menú resplandor = 46.000 + 1 menú resplandor
   con 20 % = 18.400; si es 2 seco = 19.000 cada uno + el tercer seco sale a 15.200. Aunque se repita producto se debe especificar.»
   Hoy «Promociones» es solo una categoría: el mesero ve «3er almuerzo $ 0» y las promos de todos los días, todos los días.
3. **El pedido flotante en el celular.** «A veces en la pantalla del mesero en la mesa queda abajo entonces no se puede ver bien…
   que en la mesa se pueda tener el pedido actual flotante y poder escoger de la carta o viceversa… similar a ver mi cuenta en el
   enlace NFC.» En iPhone (sin `overflow-anchor`) la carta va primero y el pedido queda al final de la página.
4. **Modo oscuro.** «Cuando el tema de un celular es dark el fondo se ve café sobre café; adaptalo a los colores del sistema pero
   conservando nuestras bases ya definidas.» El POS no declara modo oscuro: el navegador (Brave con modo noche) oscurece el arroz y el
   papel a dos cafés.
5. **La hoja de pago de la carta.** «Podemos simplificar esta pantalla y evitar esos 3 tabs; demos la información de las 3 cosas en
   esa misma. Evitemos depender de inputs del usuario… la menor interacción posible.»

## Diseño (lo que se hace y por qué)

- **La base manda (README §10).** Migración `20261005100000_precio_vivo_y_promos.sql`: un trigger BEFORE en `ordenes`
  (`trg_ordenes_a_precio_vivo`, corre antes que `trg_ordenes_guardia`) normaliza los ítems de toda cuenta ABIERTA en cada escritura:
  refresca el precio de cada línea desde `productos` (no las manuales, ni abonos, ni el marcador «para llevar») y aplica las
  promociones del día de la cuenta (`abierta_en` en Bogotá). Un trigger AFTER en `productos` «toca» las cuentas abiertas cuando cambia
  un precio o una regla, así el cambio llega solo: Realtime al POS (misma `version`), señal `cuenta:` a la carta, y el ticket y el
  cierre leen los mismos ítems. Las cuentas cerradas no se tocan.
- **Promociones como regla, no como línea de $ 0.** `productos.promo_regla jsonb` en las filas de la categoría Promociones:
  `{ cada: 3, descuento: 20, aplica: { categorias: [...], productos: [...] } }` = por cada N unidades elegibles, la más barata de cada
  grupo de N lleva X % (100 = gratis, el 2x1). La unidad con descuento sale como LÍNEA PROPIA, positiva, con el nombre del producto y
  el de la promo («Seco · 3er almuerzo · 20% OFF», 1 × 15.200) junto a la línea normal («Seco», 2 × 19.000): discriminada aunque se
  repita el producto, y el POS, la carta, el ticket y el cierre la ven sin cambios (un precio negativo sería un abono). Las promos de
  precio fijo (Almuerzos del domingo, Combo hamburguesas…) siguen siendo productos, pero el mesero solo las ve su día. El admin pone la
  regla en el modal de producto. Las reglas de las tres promos de descuento van en un sobre de datos aparte (docs/sobres/).
- **Hoja del pedido (< 1024 px).** La columna del pedido pasa a ser una hoja fija abajo: la barra del total (ya fija) es su cabecera y
  se toca para subirla; la carta queda detrás, siempre a la vista. Sin cambios desde 1024 ni en «Cobrar por partes».
- **Modo oscuro.** Un bloque `@media screen and (prefers-color-scheme: dark)` que remapea los 15 tokens (telón ↔ arroz, papel a un
  telón elevado) y re-fija el telón en la barra, el login y las barras: las parejas fondo/texto del POS siempre van telón↔arroz, así
  que un solo remapeo las invierte juntas. Los 15 del `:root` no cambian (pos-visual.test.mjs los vigila).
- **Pago en una sola pantalla.** «Pagar» abre directo QR + llave + valor + comprobante + «o en efectivo»; al abrir se avisa al mesero
  con el método `cuenta` («pide la cuenta»), que es nuevo: migración `20261005110000_alerta_pedir_cuenta.sql` y la función `alerta`.
  Copiar la llave o abrir el comprobante refinan la alerta a transferencia sin que el cliente lo pida.

## Bitácora
- 2026-10-04: declarada en `tarea/hallazgos-domingo` desde `origin/main` `db78f33` (la sesión venía en `tarea/supabase-propio`, 174 commits atrás). Medido antes de diseñar: `carta_publica` en vivo trae 7 promos, una por día (lunes «3er almuerzo» 20% OFF, miércoles y sábado 2x1, el resto precio fijo); el POS no tiene ninguna lógica de promos y cada línea copia el precio; ni el POS ni la carta declaran modo oscuro.
- 2026-10-04 (misma sesión, corte por la regla de 200k con 381k de contexto; nada publicado, nada aplicado, sin push). **Hecho en la rama, SIN verificar en navegador ni con la suite:**
  - `supabase/migrations/20261005100000_precio_vivo_y_promos.sql`: `productos.promo_regla` + CHECK (`privado.promo_regla_ok`), `privado.dia_bogota`, `privado.normalizar_items(jsonb, smallint)`, trigger BEFORE `trg_ordenes_a_precio_vivo` y trigger AFTER `productos_tocan_cuentas`; cabecera con reversa y comprobación final. El arnés `scripts/pruebas/arnes/precio-vivo-pg.mjs` (Docker, Postgres 17, toda la cadena; ~8 min con la máquina en load 500) corrió tres veces: la primera falló en la comprobación final por `normalizar_items(jsonb, integer)` (un literal sin cast; corregido con `1::smallint`); la segunda, 35 de 36 (el total de una cuenta abierta no se recalculaba cuando los ítems no cambiaban: ahora el trigger lo pone SIEMPRE en Σ precio × qty); la tercera, **36 de 36, «TODO OK en 15 s»**. Los escenarios del arnés son el contrato: lunes 2 Menú + 1 Seco → «Seco · 3er almuerzo · 20% OFF» a 15.200; 6 almuerzos → 2 descuentos; −1 sobre la línea de promo pliega; cambio de precio toca la abierta (sube `version`) y no la cerrada; manual, abono, `para_llevar` y variante; domingo sin promo y «Almuerzos» como producto; sábado 2x1 a las 22:30 de Bogotá; promo por productos sueltos; promo apagada; idempotencia; reversa y re-aplicación.
  - `supabase/migrations/20261005110000_alerta_pedir_cuenta.sql` (CHECK y `alertar_cuenta` con `cuenta`) y `supabase/functions/alerta/logica.ts` (`METODOS` con `cuenta`). Ojo: `scripts/pruebas/roles-y-alertas.test.mjs:872-875` compara el CHECK y la lista de `alertar_cuenta` contra `METODOS` leyendo la migración vieja: hay que apuntarlo a la nueva.
  - `docs/sobres/2026-10-05-reglas-de-promos.sql`: las reglas de las tres promos de descuento, por nombre, con comprobación que aborta; la lista de bebidas del 2x1 queda por confirmar con Yonatan.
  - `pos.html` (sintaxis del store comprobada con `new Function`; nada más): helpers `esLineaPromo`, `esCategoriaPromo`, `diaSemanaValido`, `reglaPromoValida`, `diaHoyBogota`; `parseProducto`/`formatProducto` con etiqueta, día y regla (`promo_regla` solo se manda si la base la trae: `_conPromoRegla`); `_esLineaDe` no toma una línea de promo por su base; `productosPorCategoria` esconde las promos que no son de hoy y las de regla; `promosAutomaticasHoy` + anuncio `.promo-hoy` arriba de la carta del mesero; pastilla `.promo-chip` en la línea de promo; modal de producto con día, etiqueta y regla (`formEsPromo`, `reglaDelForm`, `reglaFormValida`, chips de categorías y lista de productos); `guardarProducto` admite precio 0 con regla; `metodoTxt('cuenta')` y la alerta «Pide la cuenta · cómo paga, por confirmar»; la hoja del pedido bajo 1024 (`pedidoAbierto`, `alternarPedido`, `pedidoResumen`, asa `.barra-asa` en la barra, velo `.pedido-velo`, `#pedido-hoja.abierta`, CSS en el bloque «PARTE hallazgos-domingo :: css», fuera de «Cobrar por partes»); modo oscuro (`<meta name="color-scheme">`, bloque `@media screen and (prefers-color-scheme: dark)` que remapea telón/arroz/papel/linea/apoyo/ceniza y re-fija `.sobre-telon, .nav-bar, .btn-telon, .toast-alerta-cuerpo`, más los nueve selectores de acento con texto telón).
- **Lo que falta, en orden, para la siguiente sesión** (`cd ~/Developer/worktrees/resplandor--hallazgos-domingo`, rama `tarea/hallazgos-domingo`; `node_modules` es un enlace al del checkout principal):
  1. Escribir `scripts/pruebas/migracion-precio-vivo.test.mjs` con el patrón de `migracion-pago-breb.test.mjs` (estática + Postgres) a partir de los escenarios del arnés.
  2. Verificar el POS en el navegador (agregar a `.claude/launch.json` un servidor con `--directory` a este worktree, como «pos-nuevo»): la hoja del pedido a 390 px (asa, velo, Escape, «Cobrar por partes» sin hoja), el anuncio de promos de hoy, el modal de producto con una promo, y el modo oscuro con `colorScheme: dark` a 390 y 1280 (buscar café sobre café, maíz con texto claro, campos y chips). Correr `pos-visual`, `pos-sin-cdn`, `pos-orden-escritorio`, `pos-para-llevar`, `pos-personas-botones`, `integracion-punta-a-punta` y arreglar lo que la hoja rompa (las de 390 px pueden esperar `.order-item` visible: abrir la hoja antes).
  3. La carta (`carta.html`): «Pagar» (`pedirPago`) pasa directo a una sola vista con QR + llave + valor + comprobante + «o en efectivo: el mesero pasa por tu mesa»; al abrir, `avisarPago('cuenta')` solo (sin elegir); `copiarLlave`/comprobante refinan a `transferencia`; se quitan la vista `elegir` y «Cambiar método»; el pie «Listo, le avisamos al mesero» queda con «Ver cómo pagar». Adaptar `pagar.test.mjs`, `pago-breb-carta.test.mjs`, `pago-breb-carta-navegador.test.mjs`, `integracion-pago-breb.test.mjs` (≈3.000 líneas: la mayoría prueban el QR, la llave y el copiado, que siguen) y `roles-y-alertas.test.mjs` (punto de arriba). `node scripts/css.mjs` si se toca `carta-menu.css`.
  4. Suite completa en segundo plano con tope (`node --test scripts/pruebas/*.test.mjs`), `--comprobar` de css, iconos y descubrimiento, y `node scripts/version.mjs` al final. README §07/§10 y `docs/sdd-cuenta-en-mesa.md` §03.3: una línea sobre `cuenta` y sobre el precio vivo.
  5. Yonatan (aparca): aplicar las dos migraciones en el SQL Editor (en ese orden), desplegar `alerta`, push, y después pegar el sobre de datos; confirmar la lista de bebidas del 2x1 y si el 3er almuerzo cubre todos los Ejecutivos.
