---
estado: en-curso
dueño: yonatan
fecha: 2026-10-02
tema: integrar «personas, un solo cobro y botones» y «imprimir en la caja» sobre la ola C al aire (f9b2625), con la impresora como tarjeta del tablero de Administración y una sola jerarquía de botones de impresión
criterio_cierre: visto de Yonatan con el POS en uso: dividir por persona con nombres, «Imprimir precuenta» → «En la caja» y «Imprimir en la caja» en el ticket del cobro sacan el papel en la térmica de verdad, «Cobrado $ X · Deshacer» funciona y el cierre se ve calmo; la cola de impresión aplicada (sobre) y el agente corriendo en el PC de la caja
---

Las dos ramas (`tarea/pos-personas-botones` `421b2fb` y `tarea/impresion-caja` `9af472f`, las dos sobre `e3ed55b`) se mezclan encima de `origin/main` `f9b2625` (la ola C, ya al aire con sus sobres C1 a C4 aplicados). Rama de integración: `tarea/integracion-personas-impresion`. Decisiones de diseño y de jerarquía en `docs/pos-visual.md` §0.22; pasos para Yonatan en `~/Developer/worktrees/resplandor--coordinacion/integracion-personas-impresion/PASOS-AL-AIRE.md`.

Nada está aplicado, desplegado ni publicado: lo hace Yonatan.

## Bitácora
- 2026-10-02: mezcla de `tarea/pos-personas-botones` (conflictos en `pos.html` —helpers del store y el cierre—, `docs/pos-visual.md` y el CSS compilado, regenerado). Lo que la ola C sumó al cierre (pastilla de «Cobros deshechos hoy», «Reintentar subir», «Revisar», «Reintentar respaldo») usa los mismos colores calmos de la rama; el botón «Cerrar día» conserva su apagado sin red.
- 2026-10-02: mezcla de `tarea/impresion-caja` (15 zonas en `pos.html`, 4 del arnés y las dos pruebas de la ola B). La impresora de la caja pasa a ser la tarjeta del tablero de Administración (el gancho de §0.20: «En línea» / «Sin conexión» con el último latido, «Configurar impresora»); la vista cuelga de Administración y no hay entrada suelta en la navegación. «Imprimir precuenta» es un solo botón que, con la caja en línea, abre «En la caja / En este teléfono»; el ticket ofrece «Imprimir en la caja» (coral) y «En este teléfono». El documento de la caja lleva los nombres de las personas y «Cuenta de Camila». Migración de la cola renombrada a `20261003140000_cola_impresion.sql` (después de la de la carta); sobres regenerados.
