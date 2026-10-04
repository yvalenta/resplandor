---
estado: en-curso
dueño: yonatan
fecha: 2026-10-03
tema: la cuenta del POS en escritorio (≥ 1024 px) tenía tres scrolls a la vez, un hueco blanco bajo el último producto de la carta y una página que crecía al bajar; ahora los dos paneles miden lo que le queda a la ventana y cada uno scrollea por dentro
criterio_cierre: visto de Yonatan en el POS en uso, en su pantalla de 1422 px: abrir la cuenta de una mesa con carta larga, ver que la página no scrollea ni crece, que la carta termina en su último producto sin hueco y que «Generar ticket y cobrar» no sale de la vista
---

Pedido de Yonatan (2026-10-03, con una captura a 1422 px): «hay un comportamiento extraño con los scroll en versión escritorio; se identifica un espacio innecesario blanco al final que se puede aprovechar». La raíz era una sola: cada panel tenía su propia cuenta de alto y ninguna sabía de la otra (la columna del pedido, pegajosa, medía «desde el borde de la ventana» y crecía con cada scroll, arrastrando a la página; la lista de la carta tenía otro tope y la tarjeta, estirada por la columna, quedaba más alta que su lista).

El diagnóstico, con archivo:línea, y las medidas antes/después están en `docs/pos-visual.md` §0.24 (el detalle largo y las capturas, en la carpeta de coordinación de la tarea). Nada que desplegar aparte de publicar `main`: no toca Supabase ni la lógica del aviso de versión (solo la medida de alturas en `vigilarAltoPedido`).

Decisión que Yonatan puede revertir: en «Cobrar por partes», desde 1024 la carta no se muestra (como ya pasaba bajo 1024), porque con el abono arriba le quedaban 8 px de alto. Lo abierto: a 1024×768 y 1280×800 la lista del pedido enseña ≈ 1,5 renglones porque la cabecera de la cuenta ocupa ≈ 265 px; compactarla sería el siguiente paso, no estaba en el pedido.

Otra decisión de la refutación 1 (también revertible): con tanto encima que la ventana no da (la cuenta dividida por persona, otra tablet más el aviso de versión, un portátil de 1366×768 con la barra del navegador), la rejilla ya no se achica hasta dejar la lista del pedido en 0 px: tiene un piso (21.75rem; 23.5rem con la cuenta dividida) y por debajo la página SÍ scrollea, una vez, hacia un alto fijo. Se cambió «el botón de cobro siempre a la vista sin desplazar» (en esos casos) por «la lista del pedido nunca es 0 y el total se alcanza bajando la página». Con un solo aviso a 1024×768 (el de versión o el de otra tablet) no cambia nada: la página sigue sin scrollear.

## Bitácora
- 2026-10-03: corregido en `pos.html` (rejilla `.orden-rejilla` de alto = ventana − `--orden-ocupado`, carta y pedido con scroll por dentro, `vigilarAltoPedido` mide en coordenadas de la página y ya no escucha el scroll). `scripts/pruebas/pos-orden-escritorio.test.mjs`: 32 pruebas, pasan con el árbol nuevo y 30 fallan con el `pos.html` de `b64b53f` (las 2 que pasan son 390 y 768, que no cambian). Capturas antes/después a 1422×1010 y 1280×800 en la carpeta de coordinación. Falta el visto de Yonatan.
- 2026-10-03 (refutación 1): la lista del pedido se quedaba en 0 px con la cuenta dividida o en ventanas bajas, y el abono de «Cobrar por partes» escondía «Recibir…» en un scroll propio. Piso `--orden-piso` por estado (21.75rem, 23.5rem con personas, 18rem + el alto del abono en el cobro por partes), la rueda pasa de un panel a la página, y referencias a la «columna pegajosa» al día. 9 pruebas nuevas en `pos-orden-escritorio.test.mjs` (fallan con `4f4fb02`).
