---
estado: hecha
dueño: sesión
fecha: 2026-09-29
tema: la insignia «Hoy · fecha» del menú del día en carta.html cabe en una línea a 375 px (se partía en dos)
criterio_cierre: medido en Chromium a 320, 375 y 1440 px con la fecha más ancha del año, la insignia ocupa una línea y la página no tiene scroll lateral; una prueba lo vigila; la suite entera y los tres --comprobar en verde; al aire con el GO de Yonatan
---

Pendiente que dejó la sesión de la tanda del 29-sep (la de `b8f311d`, que ya iba en ~600k) en su
cierre: «en `carta.html` a 375 px, la insignia "Hoy · martes…" se parte en dos líneas». La
insignia es `carta.html:181` (`.badge.badge-barro`, texto `Hoy · ` + `fechaLarga`, que da
«martes, 29 de septiembre» en `es-CO`). Vive en la columna izquierda (`min-w-0`) de una fila
`flex justify-between` que comparte con el precio del menú del día (`$ 23.000`, `whitespace-nowrap`),
así que a 375 px le queda poco ancho y el texto se parte dentro de la píldora.

Se trabaja en el worktree `~/Developer/worktrees/resplandor--insignia-carta` (rama
`tarea/insignia-carta`, desde `d16211b`), porque la sesión vieja seguía usando el árbol
principal (comiteó `d16211b`, el Instagram en `sameAs`, a las 16:06).

## Bitácora
- 2026-09-29: tarea declarada desde `/casa resplandor` (sesión `a8584c3a`), antes de tocar código.
- 2026-09-29: hecho en la rama `tarea/insignia-carta` (`5375d01`, sin push). Medido en Chromium (Playwright de la
  caché de npx, con Archivo cargada) ANTES del arreglo: la insignia se partía en dos renglones de 320 a 375 px con
  cualquier fecha, a 390 px con todas menos «martes, 29 de septiembre», y la del domingo también de 320 a 360 px. A
  375 px la columna le dejaba 204 px. La etiqueta más ancha de las 2.505 fechas sin domingo de 2026 a 2033 es «Hoy ·
  miércoles, N de septiembre»: 233,4 px. DESPUÉS (las insignias cuelgan de la tarjeta, y el nombre y el precio
  comparten fila por la línea base): un renglón a 320, 344, 360, 375, 390, 414, 768 y 1440 px con seis fechas
  (incluidas la más ancha y el domingo), sin scroll lateral ni errores de página. Capturas antes/después en el
  scratchpad de la sesión (`dia-375-antes.png`, `dia-375-despues.png`, `dia-320.png`). La prueba nueva
  `scripts/pruebas/insignia.test.mjs` tiene una parte estática (corre en CI) y una de navegador: contra el marcado
  viejo fallan 4 de sus 5 pruebas. `_navegador.mjs` queda compartido con `desborde.test.mjs`. Cinta: 501/501 (0
  saltadas); css, iconos y descubrimiento `--comprobar` en 0. Falta: unirla a `landing-homogenea-y-mcp` cuando la
  sesión vieja suelte el árbol principal, el GO de Yonatan para el push, y verla al aire.
- 2026-09-29: **corte por la regla de 200k** (sesión `a8584c3a` en 258k). Unida a `landing-homogenea-y-mcp` en local
  (`db2af83`, merge `--no-ff`, sin push). Lleva también `d16211b`, el Instagram en `sameAs`. En la rama, la suite
  quedó en verde (501/501). Yonatan dio el GO en esta sesión: «Sí, empuja todo». Como el GO es del momento, la
  sesión que empuje lo vuelve a pedir. Falta: `git push origin landing-homogenea-y-mcp:main`, esperar `comprobar`
  y Pages en Actions, y ver al aire a 375 px que la insignia ocupa un renglón. Con eso pasa a `hecha`. El worktree
  `~/Developer/worktrees/resplandor--insignia-carta` sigue montado, ahora en la rama `tarea/correo-y-precios` (ver la
  bitácora de landing).
- 2026-09-29: **hecha**. Yonatan dio el GO en la sesión `d299f108`: «go para push deploy», y después «si dale con tu propuesta, desde 14.000 y go push». El clasificador del modo automático le negó el push a la sesión, así que lo corrió Yonatan: `b8f311d..449c8ec` a `main`, junto con `tarea/correo-y-precios`. Antes, sobre el árbol exacto: 501/501 (0 saltadas) y css, iconos y descubrimiento `--comprobar` en 0. En Actions, sobre `449c8ec`: `comprobar` success (run 36642832578) y `pages build and deployment` success (run 36642830935). Al aire, `carta.html` es idéntica byte a byte a la del commit. Medido en Chromium contra https://resplandor.ynt.codes/carta.html: la insignia «Hoy · martes, 29 de septiembre» ocupa un renglón (26 px de alto) a 320 y 375 px, sin scroll lateral.
