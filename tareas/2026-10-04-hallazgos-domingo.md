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
