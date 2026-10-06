---
estado: propuesta
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
