---
estado: en-curso
dueño: yonatan
fecha: 2026-10-02
tema: «Para llevar» opcional en el POS, por producto y para el pedido completo, sin migración (la marca viaja en la nota de la línea y el pedido completo en una línea de $0 con id `para_llevar`)
criterio_cierre: visto de Yonatan en el POS en uso: marcar un producto «para llevar» y «Todo para llevar» en una mesa, ver el ticket y la precuenta con la marca, y la carta de la mesa con la etiqueta
---

Pedido de Yonatan (2026-10-02): «qué pasa si piden algo para llevar, debería haber un ítem no obligatorio para identificar si es para llevar el producto, no el pedido completo», y enseguida: «pero también el pedido completo». Rama `tarea/para-llevar` desde `origin/main` `90f8c00`. Diseño, tabla de decisiones de cada recorrido que itera ítems y pendientes en [`docs/para-llevar.md`](../docs/para-llevar.md).

Nada que aplicar ni desplegar: sin migración, sin tocar la función `cuenta`. «Para llevar» no cobra empaque (Yonatan, 2026-10-03): es solo una marca.

## Bitácora
- 2026-10-02: implementado en `pos.html` y `carta.html` (por producto con `actualizar_nota_item`, con reintentos y sin parpadeo; pedido completo con `aplicar_delta_orden`; ticket, precuenta y caja; etiqueta en la carta). Pruebas nuevas: `scripts/pruebas/pos-para-llevar.test.mjs` y `carta-para-llevar.test.mjs`. Evidencia y notas en `~/Developer/worktrees/resplandor--coordinacion/para-llevar/`.
