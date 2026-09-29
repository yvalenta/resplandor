---
estado: en-curso
dueño: sesión
fecha: 2026-09-29
tema: el correo público y el rango de precios del local (JSON-LD, local.json, contact.html) sin scroll lateral a 320 px, y los ejecutivos de la carta de respaldo como los corrigió Yonatan
criterio_cierre: la suite entera en verde, con desborde.test.mjs midiendo 0 px de scroll lateral en contact.html a 320 px y funciones.test.mjs pidiendo el seco a 19.000 y la sopa y carne a 14.000, y css/iconos/descubrimiento --comprobar en 0; el texto del rango de precios confirmado por Yonatan frente a la carta; al aire con el GO de Yonatan
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
- 2026-09-29: sale del rojo. `construirContact` pone un `<wbr>` antes de la @ del correo; el `mailto:` y el texto que
  se copia siguen enteros. Además, el `<main>` de las páginas de texto lleva `overflow-wrap: anywhere` como red para
  cualquier palabra que no quepa; por eso se regeneran about, contact, privacy y 404. Medido en Chromium con Archivo
  cargada: a 320 y 375 px el correo ocupa dos renglones («resplandorcomidamixta» y «@gmail.com»), a 1440 px uno, y en
  los tres anchos hay 0 px de scroll lateral (captura `contacto-320.png` en el scratchpad de la sesión). Cinta: 501/501
  (0 saltadas; `desborde.test.mjs` en contact.html a 320×640, verde); css, iconos y descubrimiento `--comprobar` en 0.
  Falta: que Yonatan confirme el texto del rango de precios, unir a `landing-homogenea-y-mcp`, su GO para el push y
  verlo al aire.
- 2026-09-29: Yonatan corrigió los ejecutivos: «el seco vale 19.000 no viene incluida sopa ni frijol (Arroz proteína
  guarnición Ensalada), Sopa y carne 14.000». En `carta-respaldo.js`, «Frijoles con proteína» (19.000) pasa a «Seco»
  (19.000; arroz, proteína, guarnición y ensalada, sin sopa ni frijol) y «Sopa con proteína» (19.000) a «Sopa y carne»
  (14.000). Siguen 30 platos y la `FECHA` del 3-sep, porque los otros 28 no se volvieron a confirmar.
  `rangoDePrecios` pasa a `$$ · desde 14.000 COP`, el precio del ejecutivo más barato. Eso lo infirió la sesión y
  Yonatan lo confirma con el GO del push. Medido en Chromium con Supabase simulado en 402, a 375 px: carta.html y la
  pestaña Ejecutivos de la landing muestran «Sopa y carne $ 14.000» y «Seco … $ 19.000», sin las filas viejas y sin
  scroll lateral. Cinta: 501/501 (0 saltadas); css, iconos y descubrimiento `--comprobar` en 0. Falta:
  - la confirmación de Yonatan;
  - unir a landing, el GO y el push;
  - corregir las dos filas en `productos` de Supabase (desde el POS, cuando salga del 402), o la carta en vivo las
    trae de vuelta. El catálogo de respaldo de `pos.html` y la semilla `resplandor_bd.sql` tienen las mismas filas
    viejas: se corrigen solo si Yonatan lo pide, porque tocan el cobro del día a día.
- 2026-09-29: Yonatan agregó: «tambien hay menu de 23.000 que si tiene sopa o frijol». En la instantánea, el Menú
  Resplandor pasa a «Menú del día, con sopa o frijol» (lo pide `funciones.test.mjs`). Con eso, «Frijoles con
  proteína» no vuelve como plato aparte: el frijol viene en el menú. La pestaña Ejecutivos de la landing lo muestra
  (Chromium, Supabase simulado en 402, 375 px). Cinta: 501/501; css, iconos y descubrimiento `--comprobar` en 0. Sin
  tocar: la tarjeta del día de `carta.html` (`carta.html:390`, escrita a mano) dice «Sopa, principal, guarnición,
  ensalada y jugo», «Tres opciones cada día; la tercera es siempre frijolada» y «También por plato: frijoles, sopa o
  sancocho con proteína». La última línea ya no cuadra con la carta corregida; se cambia cuando Yonatan dé el texto.
- 2026-09-29: Yonatan dio el visto y el GO: «si dale con tu propuesta, desde 14.000 y go push». La tarjeta del día de
  `carta.html` cambia dos líneas: «Sopa o frijol, arroz, proteína, guarnición y ensalada» (sin «y jugo», que no se
  confirmó) y «También por plato: el seco, la sopa y carne o el sancocho». «Tres opciones cada día; la tercera es
  siempre frijolada» queda igual. `desde 14.000` queda confirmado. Medido en Chromium (402 simulado, 375 px): la
  tarjeta muestra las dos líneas nuevas, sin scroll lateral. Cinta: 501/501 (0 saltadas); css, iconos y descubrimiento
  `--comprobar` en 0. Queda aparte: `menu.html` (apagada) conserva «Sopa, principal, guarnición, ensalada y jugo» en
  `og:description` y `twitter:description`; se alinea cuando vuelva a encenderse el menú de hoy. El push lo corre
  Yonatan, porque el clasificador del modo automático se lo niega a la sesión.
