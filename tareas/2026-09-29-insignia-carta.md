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
