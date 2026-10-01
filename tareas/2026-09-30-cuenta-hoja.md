---
estado: hecha
dueño: sesión
fecha: 2026-09-30
tema: la hoja «Mi cuenta» de carta.html se actualiza sola (sin botón «Actualizar»), dice «Total» a secas y ordena el texto por importancia
criterio_cierre: medido en Chromium móvil a 390 px con la función cuenta simulada (un ítem nuevo llega solo, se resalta y el total cambia, sin desborde ni errores); la suite y los tres --comprobar en verde; al aire con el GO de Yonatan
---

Pedido de Yonatan del 2026-09-30 (sesión `f7613393`), sobre una captura de «Mi cuenta» en producción:
«esto al ser una SPA debería ser interactivo y en tiempo real multidispositivo y no tener que dar actualizar»,
«quita sin propina de total sin propina y sin mensaje», «hazlo más interactivo, texto más importante más grande,
distribuido de acuerdo a la importancia».

- **Jerarquía:** arriba, «En vivo» con un punto que late y «Mesa N» en grande. En el medio, los ítems con la cantidad en pastilla, el precio unitario cuando hay más de uno y el subtotal. Al pie, fijo, «Total» en 2,25 rem, con la propina voluntaria (10%) debajo, chica. Quitados «sin propina» y el mensaje.
- **Se actualiza sola** cada 10 s mientras la hoja está abierta y visible, y al instante al volver a la pestaña o recuperar la red.
  - Ante un 429 (el rate-limit de `cuenta` es de 40/min por IP y el wifi del local comparte IP) o un error, espera hasta 30 s en silencio y dice «Reconectando…».
  - Lo que llega se ilumina 1,8 s y el total cambia de color.
  - El botón de la barra muestra el total en vivo.
- Las variantes del POS (mismo nombre y precio, sin nota) se agrupan en una línea.
- Es un puente: el tiempo real empujado (push) sale del SDD de `tarea/cuenta-en-mesa`, y este sondeo queda de respaldo.

## Bitácora
- 2026-09-30: hecho en `tarea/cuenta-hoja`, desde `origin/main` `3bae016`.
  - Chromium móvil 390×844 con `cuenta` simulada: total $60.000 a $86.000 sin tocar nada, destello visto a los 8,8 s, sin desborde ni errores.
  - Suite 501 de 501; css, iconos y descubrimiento `--comprobar` en 0.
- 2026-09-30: Yonatan: «quita todo lo relacionado a que den propina, eso no se hace acá».
  - Fuera la línea «Propina voluntaria (10%)» de la hoja y la nota del pie de la carta. La hoja queda con «Total» a secas.
  - Suite 501 de 501 y los tres `--comprobar` en 0.
