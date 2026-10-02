---
estado: en-curso
dueño: ambos
fecha: 2026-10-01
tema: desayunos, promociones de la semana, «Sopa y carne» con jugo y sancocho «algunos fines de semana» en la carta y la landing: hecho en la rama tarea/carta-promos, falta salir al aire
criterio_cierre: sobre 1 (migración), publicación y sobre 2 (datos) aplicados en producción en ese orden; carta.html al aire muestra Desayunos, las 7 promociones con la de hoy resaltada y las etiquetas, y la landing el carrusel de afiches; visto de Yonatan
---

Pedido de Yonatan (2026-10-01, noche), con los afiches oficiales de `~/Developer/resplandor/marketing/` (fuera del repo):
- Carta, Ejecutivos: «Sopa y carne» incluye jugo; «Sopa» $7.000 y «Carne» $7.000 por separado; el «Sancocho trifásico» se
  programa 1 o 2 veces al mes en fin de semana, resumido en una nota sutil («Algunos fines de semana»).
- Sección nueva Desayunos (todos los días, 7:00 a.m. – 11:00 a.m.). Al principio no había platos ni precios; después Yonatan mandó el letrero
  del local: Calentado Resplandor $17.000, Desayuno sencillo $9.000 y Desayuno Resplandor $12.000 (el Calentado a $17.000 lo confirmó él).
- Promociones de cada día (texto en la carta y como productos en la tabla, con precio y descripción), y en la landing una sección
  tipo scroll con animación con los afiches de la semana.
- Después: afiches nuevos (de color) del viernes, el sábado y el domingo, «la Picada es para 4-6 personas», «Sopa» y «Carne» a $7.000
  confirmados, y «no son descuento, son promociones todos los días» (nada de función de descuento en el POS).

Cómo quedó (un solo contrato BD ↔ carta ↔ landing):
- `productos.etiqueta` (text, 1 a 40) y `productos.dia_semana` (smallint, 1 a 7); `carta_publica` las expone al final. Migración
  `20261003130000_carta_etiqueta_y_promos.sql`. Los datos NO van en una migración: van en un sobre SQL que pega Yonatan.
- La carta lee las dos columnas nuevas y, ante un 400 (base sin migrar), repite con las cuatro de siempre. Desayunos siempre existe (con sus
  tres platos una vez corrido el sobre de datos; sin platos dice «Pregunta por los desayunos del día»); Promociones es de lunes a domingo,
  con la de HOY (hora de Bogotá) resaltada; la del 20% y los 2 x 1 van con precio 0 y su etiqueta, nunca «$ 0».
- La landing no depende de la base: carrusel de afiches con animación, pausa y `prefers-reduced-motion` (`#promociones`).
- El POS no cambia: no hay función de descuento y no se pidió (el ítem manual no admite 0 ni negativos).

Lo que falta es de Yonatan (Línea Roja: aplicar, publicar y hacer push): `PASOS-AL-AIRE.md` en
`~/Developer/worktrees/resplandor--coordinacion/carta-promos/` trae el orden (sobre 1 → publicar → sobre 2), qué cambia producto por
producto, la verificación y la reversa.

Pendiente de decisión de Yonatan: descripción del sancocho (hoy vacía); confirmar las descripciones de los desayunos (son las del letrero con
la puntuación ordenada); originales en buena resolución de los afiches de lunes a jueves de color (hoy la landing usa los de `marketing/`,
negros y dorados); si «Fin de semana como se debe» y «¡Combínalas como quieras!» siguen en las descripciones del viernes y el sábado; si
los agentes (MCP, WebMCP) también muestran las etiquetas.

## Bitácora
- 2026-10-01: tres partes en paralelo (bd `c99fa4b`, carta `8119bcc`, landing `d0adce7`) y fusión en `tarea/carta-promos` (conflictos solo en
  `assets/css/resplandor.css`, regenerado, y en `scripts/pruebas/reglas.test.mjs`, que queda con la versión de la landing: ninguna página tiene
  vetado «desayuno»). Con `tarea/ola-c` se fusiona sin conflictos (prueba en un worktree desechable); `tarea/impresion-caja` no tiene commits propios aún.
- 2026-10-01: integración `19bc773`: afiches nuevos del viernes y el sábado en la landing (recortados 3:4 → 4:5 sin tocar texto), `carta.html#promociones`
  llega a la sección (se quedaba arriba de todo: la sección nace cuando contesta la vista), pie de `menu.html` con los desayunos, contrato en el README.
- 2026-10-01: punta a punta con Postgres 17 en Docker (los 30 platos reales de producción, los dos sobres pegados tal cual) y la carta real en Chromium
  a 390 y 1280 px con el navegador en Tokio y el reloj en el jueves de Bogotá: 63 de 63 (ejecutivos con «Incluye jugo», sancocho con su pastilla, Desayunos
  honesto, 7 promociones con el jueves en «Hoy», ningún «$0»; contra la base de hoy sin migrar la carta se ve como la de antes salvo Desayunos y el sancocho
  ya no repite su nombre; landing con carrusel, pausa, reduced-motion y el enlace a la carta). Evidencia en `integracion/` de la carpeta de coordinación.
- 2026-10-01: arnés de BD (migración y sobres, 14 filas de verificación): 162 de 162. Reversas probadas: la de datos y la de la migración dejan la hoja de
  productos idéntica a la de producción de hoy (mismo hash, 30 filas) y `anon` vuelve a leer 4 columnas.
- 2026-10-01: suite con Node 22: 1055 pruebas, 1054 pasan, 0 fallan, 1 se salta (SRI, pide red); los tres `--comprobar` (descubrimiento, css, iconos) salen en 0.
- 2026-10-01 (más tarde): llegaron nuevas respuestas de Yonatan: el afiche nuevo del domingo, el letrero de desayunos (Calentado $17.000, Desayuno sencillo $9.000,
  Desayuno Resplandor $12.000) y «no son descuento, son promociones todos los días». Se incorporaron: la landing usa los afiches de color del viernes, el sábado y el
  domingo (recortados a 4:5), el sobre de datos carga los 3 desayunos y el domingo nuevo (12 productos nuevos, verificación de 18 filas), la reversa los deshace.
  Arnés de BD 168 de 168; punta a punta 67 de 67 (los desayunos salen de menor a mayor precio, con la descripción del letrero); reversas otra vez idénticas a producción
  (30 filas); suite con Node 22: 1056 pruebas, 1055 pasan, 0 fallan, 1 se salta (SRI); los tres `--comprobar` en 0.
