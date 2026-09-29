---
estado: en-curso
dueño: sesión
fecha: 2026-09-29
tema: el correo público y el rango de precios del local en el JSON-LD, local.json y contact.html, sin scroll lateral a 320 px
criterio_cierre: la suite entera en verde, con desborde.test.mjs midiendo 0 px de scroll lateral en contact.html a 320 px, y css/iconos/descubrimiento --comprobar en 0; el texto del rango de precios confirmado por Yonatan frente a la carta; al aire con el GO de Yonatan
---

Datos que dio Yonatan el 2026-09-29 para la ficha del local: el correo público `resplandorcomidamixta@gmail.com` y
el rango de precios («desde 23.000 $$», escrito `$$ · desde 23.000 COP`). Viven en `assets/js/local.js` (`correo`,
`rangoDePrecios`), y `node scripts/descubrimiento.mjs` los lleva al JSON-LD (`email`, `contactPoint.email`,
`priceRange`), a `local.json` y, el correo, a `contact.html`.

La sesión `a8584c3a` lo dejó en la rama `tarea/correo-y-precios` (`5c9f0cd`, worktree
`~/Developer/worktrees/resplandor--insignia-carta`, desde `278b6b6`), EN ROJO: 500/501, porque `desborde.test.mjs`
mide 2 px de scroll lateral en `contact.html` a 320 px (el correo es una sola palabra que no se parte). Hasta acá lo
llevaba la bitácora de `2026-09-26-landing-homogenea-y-mcp.md`; desde acá, esta tarea.

Falta que Yonatan confirme el texto antes de publicar. En la carta del 3-sep (`assets/js/carta-respaldo.js`), el Menú
Resplandor (menú del día) cuesta 23.000, pero hay ejecutivos a 19.000 (frijoles o sopa con proteína) y a 20.000
(sancocho), y entradas desde 12.000: todo eso queda por debajo del «desde 23.000».

## Bitácora
- 2026-09-29: tarea declarada desde `/casa resplandor` (sesión `d299f108`), antes de tocar código.
