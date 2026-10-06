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
