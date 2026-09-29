---
estado: en-curso
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
