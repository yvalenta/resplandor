---
estado: en-curso
dueño: yonatan
fecha: 2026-10-04
tema: integración de `impresion-defecto` (imprimir siempre a la caja con confirmación, precuenta por persona) y `escritorio-scroll` (la cuenta en escritorio con un solo criterio de altura, piso de 3 renglones, total pegado abajo) sobre `origin/main` a207f90, lista para publicar con avance rápido
criterio_cierre: visto de Yonatan en el POS en uso: imprimir una precuenta (pregunta, luego papel en la caja), la precuenta de una persona con la cuenta dividida entre 3, y la cuenta de una mesa en su pantalla de 1422 px (sin hueco, sin barra de más, «Generar ticket y cobrar» a la vista)
---

Las dos ramas llegaron refutadas dos rondas cada una (sin críticos ni altos) y se mezclan en `tarea/integracion-impresion-scroll`, con `--no-ff` y en este orden: primero `tarea/impresion-defecto`, luego `tarea/escritorio-scroll`. No entran `tarea/promo-dia` ni `tarea/integracion-impresion-promo` (la promo se rehace aparte). Sin push: lo publica Yonatan (los pasos exactos y la reversa, en la carpeta de coordinación de la tarea).

Conflictos de texto: solo los sellos de versión (carta, index, menu, pos y `version.json`, en los dos merges), que se resuelven con cualquier lado y `node scripts/version.mjs` al final; y, sin marca de git, `docs/pos-visual.md`, donde las dos ramas abrieron un «### 0.24»: queda el de impresión como §0.24, el de escritorio pasa a §0.25 y sus referencias se renumeraron.

Un cruce que ningún merge marcaba y rompía una prueba: la pregunta de imprimir (`confirmaImpresion`) no estaba en `_hayModalAbierto`, así que una versión nueva con la pregunta abierta recargaba encima y se la llevaba (`version-aviso.test.mjs` lo exige). Corregido con su caso de comportamiento. Los demás cruces (fila de personas contra la rejilla de altura fija y el piso de 3 renglones, la pregunta contra el total pegado abajo, la precuenta por persona con la cuenta dividida a 390 y en escritorio, «Cobrar por partes» sin carta con los botones de precuenta) se midieron y quedaron cubiertos por `scripts/pruebas/integracion-impresion-scroll-navegador.test.mjs`.

## Bitácora
- 2026-10-04: merges de `tarea/impresion-defecto` (3f130a0) y `tarea/escritorio-scroll` (da4244d) sobre `origin/main` a207f90, `_hayModalAbierto` con `confirmaImpresion` y prueba de los cruces en navegador. Evidencia (suite en UTC, generadores en verde, capturas, reversa probada en un clon desechable): `NOTAS.md` y `PASOS-AL-AIRE.md` en la carpeta de coordinación de la tarea.
