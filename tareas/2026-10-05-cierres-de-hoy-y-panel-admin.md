---
estado: en-curso
dueño: ambos
fecha: 2026-10-05
tema: «Transacciones del turno» solo de hoy, un aviso sutil y descartable cuando el día anterior quedó sin cerrar, y un panel de cierres diarios (ver, corregir) solo para el admin
criterio_cierre: en el POS al aire, «Transacciones del turno» muestra solo las ventas de HOY (día de Bogotá); con ventas de un día anterior sin cerrar aparece un aviso discreto que se puede descartar (y no vuelve ese día) y lleva a cerrar ese día; en Administración hay un panel de cierres donde solo el admin ve, corrige y deja rastro de cada cambio; con sus pruebas; visto de Yonatan
---

Pedido de Yonatan del 2026-10-05 (noche), mirando «Cierre del día» en producción con la Mesa 1 del domingo todavía abierta:
«transacciones del turno deben ser de hoy y debe haber un aviso sutil que diga que no se ha cerrado el día de ayer y pueda
dejar de ser visto; poder tener un panel para cierres diarios, modificar cierres y demás, modo admin solo para admin».

## Lo que hay hoy (para una sesión fría)
- `pos.html`, vista `cierre`: `ordenesHoy` filtra por fecha (revisar que sea el día de Bogotá y no el del aparato); la lista
  «Transacciones del turno» y los KPIs salen de ahí; `cerrarDia()` llama a la RPC `cerrar_dia(p_id, p_esperado)` (solo admin,
  `supabase/migrations/20261002180000_deshacer_cobro.sql`), que archiva TODAS las órdenes cerradas no archivadas (no solo las de
  hoy): si ayer no se cerró, hoy se archivan juntas. `cierre_ordenes` dice a qué cierre pertenece cada venta; `reabrir_venta_de_cierre`
  saca una venta de un cierre (admin). Historial de cierres: en la misma vista, plegado.
- Roles: `mi_rol()` / `puede('…')` en el POS; `cierres` tiene policies por rol (`20261002140000_permisos_por_rol.sql`): revisar qué
  puede UPDATE el admin hoy y si hay rastro (`deshechos` guarda los cobros deshechos; para cierres no hay bitácora).
- Diseño propuesto, a refutar:
  1. «Transacciones del turno» = ventas cerradas con `cerrada_en` de HOY en Bogotá; las de días anteriores sin archivar no se
     mezclan: van al aviso.
  2. Aviso discreto (una línea, como `.promo-hoy`): «Ayer (dom 4) quedó sin cerrar: N ventas · $ X — Cerrar ayer · Ocultar».
     «Ocultar» lo guarda por día en `localStorage` (vuelve al día siguiente si sigue sin cerrar). «Cerrar ayer» cierra SOLO las
     ventas de ese día (hace falta que `cerrar_dia` acepte el día, o una RPC `cerrar_dia_de(fecha)`), con la fecha del cierre = ese día.
  3. Panel «Cierres» en Administración (solo admin, `puede('cierres_admin')`): lista por fecha con total y n; abrir uno: sus ventas,
     sacar una venta (ya existe `reabrir_venta_de_cierre`), corregir fecha/nota; cada cambio deja fila en una tabla `cierres_cambios`
     (quién, cuándo, qué, antes/después). Nada se borra: un cierre equivocado se anula con rastro.
  4. Migración con RLS: UPDATE de `cierres` solo admin y solo las columnas que el panel toca; `cierres_cambios` solo INSERT por la RPC.
- Decisiones para Yonatan antes de empezar: ¿qué se puede corregir de un cierre (fecha, total manual, quitar/poner ventas)?; ¿el
  mesero ve el aviso de «ayer sin cerrar» o solo el admin?; ¿cerrar un día pasado puede hacerlo el mesero?

## Bitácora
- 2026-10-05: declarada por la sesión de hallazgos-domingo (que ya pasaba los 800k de contexto) para que la tome una sesión fresca:
  `cd ~/Developer/resplandor/resplandor && claude` → `/casa cierres-de-hoy-y-panel-admin`. Nada hecho todavía.
- 2026-10-06: implementada en la rama `tarea/cierres-de-hoy-y-panel-admin` (worktree `resplandor--cierres-admin`), sin push, sin aplicar nada en producción.
  Hecho: migración `20261006100000_cierres_de_hoy_y_cambios.sql` (`cerrar_dia_de(p_id, p_dia, p_esperado)`, `cierre_corregir_nota`, `cierre_anular`, columnas
  `cierres.nota` / `anulado_*`, tabla `cierres_cambios` escrita solo por el disparador `trg_cierres_rastro`, UPDATE directo de `cierres` limitado a sus 5 columnas de
  siempre, cierre anulado congelado); `cerrar_dia(text, jsonb)` no se toca. POS: «Transacciones del turno» y KPIs solo de hoy (día de Bogotá), aviso de una línea
  «Ayer (dom 4) quedó sin cerrar…» con «Cerrar ayer» (admin) y «Ocultar» (por día, localStorage), ventana de confirmación por día, panel «Cierres» en Administración
  (solo admin: nota, ventas con el editor de siempre, anular con motivo, rastro). Un POS nuevo con una base sin la migración cierra como antes. README (sección nueva y
  tabla de contrato), privacy (generada por `scripts/descubrimiento.mjs`), versión 2026.10.05-7a25d1c.
  Decisiones por defecto (Yonatan puede cambiarlas): (1) turno y KPIs solo de hoy en America/Bogota; (2) aviso de una línea para todos, «Cerrar ayer» solo admin, «Ocultar» por
  día y vuelve mañana; si hay varios días sin cerrar la línea es del más reciente y dice «y N días más» (el panel los lista todos); (3) «Cerrar ayer» cierra solo las
  ventas de ese día en Bogotá y el cierre lleva la fecha de ese día (su 23:59:59), y una cuenta abierta NO frena el cierre de un día pasado (una cuenta abierta no es una
  venta; cerrar HOY sigue exigiendo las mesas cobradas); (4) el panel corrige la NOTA, saca/edita una venta (editor de siempre: «Reabrir en mesa» recalcula el total) y anula; ningún
  total se edita a mano (ninguna RPC recibe un monto); (5) anular = el cierre se queda con motivo, quién y cuándo, y sus ventas vuelven a las ventas por cerrar (sin
  restaurar: se rehace cerrando el día otra vez); (6) el rastro no solo lo escriben las RPC sino un disparador, para que ningún camino se escape (también la edición del
  historial y «Reabrir»), no se purga y solo se agrega; (7) panel limitado a los últimos 30 días (los que ya carga el historial).
  Pruebas (números reales): `node --test scripts/pruebas/migracion-cierres-de-hoy.test.mjs` 32 pasan, 0 fallan (16 estáticas, 15 contra Postgres 17 en Docker y 1 de
  precondiciones; con mutaciones a mano —día en UTC, quitar la guarda de admin— fallan 4 y 3); `node --test scripts/pruebas/cierres-de-hoy-navegador.test.mjs` 28 pasan, 0 fallan
  (6 estáticas, 16 del store en un `vm`, 6 de navegador a 390 y 1280 px); `node --test scripts/pruebas/migracion-carta-etiqueta.test.mjs` 22 pasan; vecinas (un archivo cada una):
  pos-ola-c-ronda5 26, pos-ola-c-ronda4 18, pos-ola-c-r5a 35, pos-ola-c 65 (1 saltada), pos-ola-c-ronda3 19, pos-resincronizacion 25, pos-roles-alertas-cobros 68,
  pos-ola-b-ronda2 24, pos-para-llevar 57, pos-orden-escritorio 57, pos-personas-botones 38, pos-visual 34, descubrimiento 61, ola-c-integracion 8, ola-c-bd 31, contraste 39,
  css 1, todas con 0 fallos. Suite completa `SIN_DOCKER=1 node --test --test-concurrency=1 scripts/pruebas/*.test.mjs`: 2435 pruebas, 2409 pasan, 20 fallan, 5 saltadas,
  1 todo (2968 s). Las 20 eran tests viejos que esta tarea cambia a propósito (el botón nuevo «Panel de cierres» en la tarjeta Cierres: ola-c-r5-integracion-navegador y
  pos-ola-c-ronda5-tablero-navegador; y ventas «de hace 90 min» que a las 00:xx de Bogotá ya son de ayer: pos-ola-c-ronda4 y pos-ola-c-r5a, que ahora usan `haceMin` de
  `_pos-vm.mjs`); ya corregidos y vueltos a correr juntos con migracion-cierres-de-hoy, cierres-de-hoy-navegador, version y descubrimiento: 213 pruebas, 213 pasan, 0 fallan.
  `node scripts/descubrimiento.mjs`, `node scripts/css.mjs --comprobar`, `node scripts/iconos.mjs --comprobar` y `node scripts/version.mjs` corridos.
  Queda (de Yonatan): aplicar la migración en Supabase (SQL Editor) y luego el push del POS, en ese orden; ver en el POS al aire el aviso y el panel; confirmar o cambiar las
  decisiones por defecto; que la suite completa se corrió ANTES de arreglar esos 20 (el resto no cambió después); la suite completa con Docker no se corrió entera.

- 2026-10-06 (refutación, sobre 9ae68df, sin tocar código): tres hallazgos reproducibles, ninguno corregido (los repara la sesión madre y vuelve a llamar).
  (1) CRÍTICO, dinero: un cierre anulado NO queda congelado ante el upsert IDÉNTICO del POS (`guardarEdicion` sin cambios en una tablet con el historial
  atrasado: `cierres` no va por Realtime): `trg_cierres_registrar_ordenes` es `update of transacciones` y vuelve a meter las ventas liberadas en `cierre_ordenes`,
  `trg_cierres_anulado_congelado` no lo frena (nada es distinct) y el rastro no lo anota; el siguiente `cerrar_dia_de` las borra como «rezagos» (`v_ya`) sin
  contarlas: 30.000 de ventas reales fuera de todo cierre vigente. (2) MEDIO: con la base sin la migración, la ventana de confirmación enseña solo lo de hoy
  (1 · $30.000) y el primer «Sí, cerrar día» cae a `cerrar_dia` y cierra todo (2 · $33.000) sin volver a preguntar (`_cerrarDiaPorBase` se llama a sí mismo tras
  poner `_sinCerrarDiaDe`). (3) MEDIO: una venta con `cerrada_en` de mañana (reloj de la tablet adelantado al pasar la medianoche) no está en «Transacciones del
  turno», ni en el aviso, ni en «Días sin cerrar», ni entra en ningún cierre: invisible hasta el día siguiente, y antes de esta tarea sí se cerraba. Bajos (por
  lectura): los `deshechos` ya marcados se quedan colgados del cierre anulado; el POS no reconoce RS006 (`_subirCierre` solo relee con RS004): la copia atrasada queda
  «Sin respaldo» y «Cerrar día» apagado hasta una lectura completa. Reproducciones (en /private/tmp/claude-501/wf-resplandor/cierres-de-hoy-y-panel-admin/refutar/,
  volátil; los pasos están en el objeto devuelto): `node --test …/refutar-anular-upsert.test.mjs` (Postgres 17 en Docker, cadena completa de migraciones) 1 pasa
  = hallazgo 1 reproducido; `node --test …/refutar-pos-vm.test.mjs` (el <script> real en vm) 2 pasan = hallazgos 2 y 3 reproducidos. Confirmado el número del
  implementador: `node --test scripts/pruebas/migracion-cierres-de-hoy.test.mjs` 32 pasan, 0 fallan. Queda: reparar (1) en la migración (congelar también el
  upsert idéntico, o que `cierres_registrar_ordenes` ignore un cierre anulado), (2) y (3) en pos.html, con sus pruebas, y volver a refutar.

- 2026-10-06 (corrección del hallazgo crítico de la refutación, sin push ni migración aplicada en producción): (1) CRÍTICO corregido en la migración
  `20261006100000` (aún sin aplicar, se editó en su sitio): `trg_cierres_anulado_congelado` pasó a `before update of fecha, total_ventas, total_ordenes, transacciones` y
  rechaza con RS006 CUALQUIER UPDATE de un cierre anulado, aunque el valor sea idéntico (antes solo si era `is distinct from`): `update of` dispara por la columna nombrada
  en el SET, así que el upsert idéntico del POS (`guardarEdicion` sin cambios en una tablet con el historial atrasado) ya no llega a `trg_cierres_registrar_ordenes` y las
  ventas liberadas no vuelven a `cierre_ordenes`. La anulación misma y la nota no nombran esas columnas. Un solo guardia basta (todo camino que dispara el registrar
  pasa antes por este); no se tocó `cierres_registrar_ordenes` (migración vieja). POS: `_subirCierre` reconoce RS006 (como RS004: avisa y relee el historial, el cierre
  sale anulado y no queda «sin respaldo»; era el hallazgo bajo «el POS no reconoce RS006», trivial). README (§ panel de cierres) actualizado.
  Pruebas nuevas: `migracion-cierres-de-hoy.test.mjs` (el guion del refutador, con el upsert idéntico y cada columna sola → RS006, cierre_ordenes sigue vacío, el rastro no
  cambia y cerrar ayer otra vez cuenta 3 · $35.000 con borradas 3 y la suma de los cierres vigentes es 35.000) y `cierres-de-hoy-navegador.test.mjs` (la tablet atrasada:
  aviso, relectura, sin «sin respaldo»; la base falsa `_pos-vm.mjs` modela RS006). Verificado que fallan sin el arreglo: la prueba nueva de la migración 0 pasan/1 falla
  contra la migración vieja y la del POS 0 pasan/1 falla sin el manejo de RS006; y el guion original del refutador (`refutar-anular-upsert.test.mjs`) ahora falla en su
  primera afirmación («el upsert idéntico NO lo frena RS006» → sí lo frena).
  Números reales: `node --test scripts/pruebas/migracion-cierres-de-hoy.test.mjs` 33 pasan, 0 fallan (Postgres 17 en Docker; antes 32);
  `node --test scripts/pruebas/cierres-de-hoy-navegador.test.mjs` 29 pasan, 0 fallan (una corrida con el Docker en paralelo falló una vez el navegador a 390 px del panel;
  sola y completa después pasa); pos-ola-c-r6 11, ola-c-bd 31, ola-c-ronda5-docs 3, version 22, descubrimiento 61, version-contraste 20, todas 0 fallos; `node scripts/version.mjs`
  → 2026.10.06-4eb0801; `descubrimiento.mjs` y `css.mjs --comprobar` al día. La suite completa NO se corrió.
  Queda sin corregir: (2) MEDIO, con la base sin la migración la ventana enseña solo lo de hoy y el primer «Sí, cerrar día» cae a `cerrar_dia` y cierra todo (`_cerrarDiaPorBase`
  se llama a sí mismo): arreglarlo cambia el flujo (hay que volver a preguntar con las cifras nuevas) y obliga a reescribir dos pruebas del implementador; solo ocurre mientras
  la migración no esté aplicada, y la regla de salida (migración primero, POS después) lo evita. (3) MEDIO, una venta con `cerrada_en` de mañana (reloj adelantado) queda fuera
  de todas las listas y cierres: es una decisión de diseño (¿cuenta como hoy?, ¿se avisa?) que le toca a Yonatan. Bajo: los `deshechos` ya marcados se quedan colgados del
  cierre anulado (no pierde dinero; se les puede soltar el `cierre_id` al anular). Falta volver a refutar.

- 2026-10-06 (corrección de lo que quedó sin corregir en la refutación; sin push, sin aplicar nada en producción; `20261006100000` no se tocó, está aplicándose):
  (2) MEDIO corregido, con base sin la migración el admin ya no firma una cosa y cierra otra: `_cerrarDiaPorBase`, ante PGRST202 de `cerrar_dia_de`, pone `_sinCerrarDiaDe = true`,
  **no reintenta solo** y VUELVE a la ventana de confirmación con las cifras nuevas (todas las ventas por cerrar, aviso ámbar «Esta base todavía no cierra un día por separado…»,
  el de «entran también las de días anteriores» y el botón «Sí, cerrar así», como ante `cambio`; devuelve `'cambio'`); recién el segundo clic llama a `cerrar_dia`. Un matiz que no
  estaba en el pedido y que se dejó a propósito: si lo firmado (n, total, ids) es idéntico a lo que se cerraría (no hay ventas de días anteriores), no hay nada nuevo que firmar y
  un solo clic cierra, para no pedir dos veces lo mismo (y porque así siguen en verde las pruebas vecinas con bases sin la migración). Reescritas las dos pruebas del implementador
  (la de la base sin la migración y la de la ventana de «cerrar hoy») y agregado el guion del refutador (prueba 1 de `refutar-pos-vm.test.mjs`) como prueba que ahora PASA por lo
  correcto, más una de navegador a 390 y 1280 px (ventana con el aviso, sin desborde, segundo clic cierra 5 · todo).
  (3) MEDIO corregido, **decisión por defecto, a confirmar por Yonatan**: una venta por cerrar cuyo día en Bogotá es FUTURO (reloj de la tablet adelantado) cuenta como de HOY.
  POS: `diaDeVenta(o, hoy)` topa el día en hoy (sale en «Transacciones del turno», suma en los KPIs, `puedesCerrar` no se apaga, entra en «Cerrar día»; cerrar ayer no se la
  lleva). Base, en la migración NUEVA `20261006120000_cierres_ajustes.sql` (create or replace de `cerrar_dia_de`, mismo cuerpo más una cláusula): cuando `p_dia` es hoy toma también
  las ventas con `fecha_bogota(cerrada_en) > hoy`, así lo que el admin firma coincide con lo que la base cierra; un día pasado no, un día futuro sigue `invalido`. Si Yonatan prefiere
  otra cosa (avisar en vez de contarla; o que cuente como del día siguiente), se cambia `diaDeVenta` y esa cláusula. Con el POS nuevo y la base sin `20261006120000`, la venta de
  mañana la ve el POS pero no la base: el cierre responde `cambio` con los números de la base y el admin firma otra vez (no se pierde nada).
  (bajo) corregido: `cierre_anular` (misma migración nueva) suelta los `deshechos` del cierre anulado (`cierre_id = null`) y responde cuántos (`deshechos`); el siguiente
  `cerrar_dia_de` los toma. El rastro (`trg_cierres_rastro`) no cambió: sigue anotando `cierre` y `anulado` con su motivo, quién y cuándo (la prueba lo comprueba).
  Orden de salida ahora: 1) `20261006100000`, 2) `20261006120000` (se niega a correr sin la primera, sin cambiar nada), 3) push del POS. Reversa de la nueva: volver a correr las
  secciones 4 y 6 de la primera (probado). Las dos funciones nuevas son EL MISMO cuerpo que las de `20261006100000` más el cambio puntual: una prueba estática compara el texto.
  Pruebas nuevas/ajustadas: `scripts/pruebas/migracion-cierres-ajustes.test.mjs` (Postgres 17 en Docker; verificado que 7 fallan si se quitan los dos cambios de la migración),
  `cierres-de-hoy-navegador.test.mjs` (las dos reescritas, la del refutador, la de «cerrar hoy» sin ventas de ayer, las de la venta de mañana, la estática del flujo y la de navegador),
  `_pos-vm.mjs` y `_pos-simulado.mjs` (las bases falsas modelan la cláusula de mañana y soltar los deshechos), `migracion-carta-etiqueta.test.mjs` (la lista de migraciones
  posteriores) y `pos-ola-c-ronda5.test.mjs` (R5-E: la llamada a `cerrar_dia` va con `firmado`). Verificado que las pruebas nuevas del POS fallan con el `pos.html` viejo (10 de 35).
  Versión sellada: 2026.10.06-0628ded (`css`, `iconos`, `descubrimiento` y `version` corridos en ese orden; los `--comprobar` en verde).
  Sigue pendiente (no es de esta corrección): (a) las pruebas con ventas «a la hora de ahora» (pos-ola-c-r6 y otras) pueden fallar cerca de la medianoche de Bogotá (las vecinas
  de ronda4, r5a y ronda5 ya usan `haceMin`); (b) el panel de cierres lista solo los últimos 30 días, sin paginación de los más viejos; (c) el rastro `cierres_cambios` no se purga
  (decisión por defecto: es contabilidad; si crece, hay que decidir una purga); (d) la suite completa no se corrió (la hace otro agente); (e) falta volver a refutar el diff de esta
  corrección; (f) de Yonatan: aplicar las dos migraciones en ese orden y después el push del POS, y confirmar o cambiar las decisiones por defecto (la venta de mañana cuenta como hoy es la nueva).
  Números reales de esta corrección (un archivo cada vez, sin la suite completa): `node --test scripts/pruebas/migracion-cierres-de-hoy.test.mjs` 33 pasan, 0 fallan, 0 saltadas;
  `migracion-cierres-ajustes.test.mjs` 18 pasan, 0 fallan, 0 saltadas (Postgres 17 en Docker); `migracion-carta-etiqueta.test.mjs` 22 pasan; `cierres-de-hoy-navegador.test.mjs`
  37 pasan, 0 fallan (antes 29; una corrida con el Docker de otras sesiones en paralelo falló una vez el navegador a 390 px del panel; repetida, pasa); pos-ola-c-r6 11, ola-c-bd 31,
  pos-ola-c-ronda4 18, pos-ola-c-r5a 35, pos-ola-c-ronda5 26 (arreglada su R5-E), todas 0 fallos; y las que usan los cierres o aplican la cadena completa de migraciones con la
  nueva encima: pos-ola-c-ronda3 19, pos-resincronizacion 25, pos-ola-c 65 (1 saltada), pos-roles-alertas-cobros 68, pos-para-llevar 57, pos-ola-c-ronda5-navegador 6,
  pos-ola-c-ronda5-tablero-navegador 13, ola-c-r5-integracion-navegador 4, ola-c-integracion 8, version 22, descubrimiento 61, version-contraste 20, contraste 39, css 1, los docs
  de ola-c (ronda3 4, ronda4 3, ronda5 3, r5a 3), migracion-precio-vivo 36, migracion-pago-breb 32, migracion-cuenta-en-vivo 42, migracion-cola-impresion 26 e
  integracion-pago-breb 21: todas con 0 fallos.

- 2026-10-06 (ronda 3: corrección de la refutación 2, sobre adfac81; sin push, sin aplicar nada en producción; `20261006100000` no se tocó y `20261006120000` tampoco):
  La refutación 2 dio «aprobar con notas»: 0 crítico, 0 alto, 1 medio y 3 bajos, todos sobre el texto de la ventana ante relojes desfasados y dos frases del README. El dinero
  y la firma del admin aguantaron en todos los caminos. Tabla de la casa (ronda · sha · crít/alto): 1 · 9ae68df · 1/0; 2 · 1028e3d · 0/0; 3 · adfac81 · 0/0 (1 medio, 3 bajos).
  Los cuatro hallazgos de la ronda 3 son sobre lo que agregó adfac81 (la venta de mañana cuenta como hoy y soltar los deshechos al anular), no sobre la corrección del crítico.
  Corregido, todo en `pos.html`, README y pruebas (nada de SQL):
  (1) README, dos frases falsas. (a) Con la base intermedia (100000 sin 120000) y el POS nuevo, la venta de mañana NO hace que el cierre responda `cambio` por sí sola: si es la
  única del turno la base responde `sin_ventas`; si hay otras, `cambio` (las de hoy sin la de mañana) y, firmado eso, la de mañana queda sola con `sin_ventas`. Escrito tal cual, con el
  orden de salida obligatorio 100000 → 120000 → push del POS (D2a del refutador). (b) Los `deshechos` que suelta `cierre_anular` no los toma «el siguiente cierre de ese día» sino EL
  PRÓXIMO cierre que se haga, sea del día que sea (`cerrar_dia_de` marca `cierre_id is null and fecha_bogota(hecho_en) <= p_dia`: solo se libra uno de un día anterior al que se
  deshicieron): si se cierra HOY antes de rehacer AYER, los deshechos de ayer quedan en el cierre de hoy y el de ayer rehecho sale sin ellos (D1). Prueba nueva en
  `migracion-cierres-ajustes.test.mjs` (Postgres 17 en Docker) que lo fija con el guion del refutador.
  (2) [medio] Tablet con el reloj desfasado y «Cerrar ayer». Implementado en `pos.html` (cabía limpio): si la base responde `cambio` para un día PASADO con ids que la tablet cuenta como de HOY
  (`_baseTrataComoHoy`), o `hay_abiertas` para un día pasado (la base solo frena HOY), para la base ese día ES hoy: la ventana dice «Para la base ese día es hoy: el reloj de esta tablet va
  adelantado. Revisa la hora de la tablet.» (bandera `cierreRelojAdelantado`) y pasa a ser la de HOY (`cierreEsDePasado` es falso: título, bloqueo de mesas abiertas, sin «solo las ventas del
  <ayer>»), manda a la base el mismo día que ella entiende y pide firmar lo que ella propone (botón «Sí, cerrar así»); con `hay_abiertas` la ventana se queda abierta con su explicación en vez de
  cerrarse con un aviso suelto. Al revés (T2/D3, tablet atrasada, y T3, la base intermedia): si `sin_ventas` llega y la tablet, ya releída la base, SIGUE teniendo esas ventas por cerrar, el
  aviso es «La base no ve esas ventas como de hoy: revisa la hora de la tablet» y no «otro dispositivo ya cerró» (ese texto queda para cuando las ventas de verdad ya no están: si otro las
  hubiera cerrado, la base las borró y la lectura las quita de la tablet). Con el reloj en hora, un `cambio` de un día pasado sigue siendo «otra tablet vendió algo».
  Lo que NO se arregla en el POS y queda anotado (la base cuenta los días con su reloj y no sabe el de la tablet): una tablet atrasada que cierra «hoy» le pide a la base cerrar un día
  pasado (T2: sale con fecha 23:59:59 de ese día y sin exigir las mesas cobradas; escenario del refutador: tablet un día atrás, `vieja-1` 10.000 de ayer y `otra-1` 30.000 de hoy real, el
  primer cierre toma solo `vieja-1` y la venta de hoy queda para una tablet en hora), y una adelantada que cierra «hoy» pide un día futuro, que la base rechaza con `invalido` (el POS dice
  «recarga la página»). En ninguno se pierde una venta; solo el texto. Si Yonatan lo quiere, es un mensaje más sobre `invalido` y sobre `cambio` de hoy con menos ventas que las firmadas.
  (3) Nota menor: tras `anularCierre` el POS ahora también llama a `cargarDeshechos()`: «Cobros deshechos hoy» cuenta los soltados sin volver a entrar a la vista de cierre.
  (4) Aparte, pedido del coordinador: `migracion-cierres-ajustes.test.mjs` ya no exige que `20261006120000` sea la migración que sigue a `20261006100000` (fallaba al fusionar con
  precio-a-mano, que deja `20261006110000` en medio); exige que vaya después y que entre las dos no haya otra de cierres.
  Pruebas nuevas/ajustadas: `cierres-de-hoy-navegador.test.mjs` 44 pasan, 0 fallan, 0 saltadas (antes 37; +7: T1 con `cambio`, T1 con `hay_abiertas`, T2, T3, `cambio` con el reloj en hora, la
  estática, y «Cobros deshechos hoy» tras anular; además el `sin_ventas` legítimo ahora afirma su texto); contra el `pos.html` de adfac81 (`POS_HTML`) las nuevas fallan (6 de 44 fallan).
  `migracion-cierres-ajustes.test.mjs` 19 pasan, 0 fallan, 0 saltadas (antes 18; +1: los deshechos al próximo cierre).
  Vecinas, un archivo cada vez (0 fallos en todas): pos-ola-c-r6 11, ola-c-bd 31, pos-ola-c-ronda4 18, pos-ola-c-r5a 35, pos-ola-c-ronda5 26, ola-c-ronda3-docs 4, ola-c-ronda4-docs 3,
  ola-c-ronda5-docs 3, ola-c-r5a-docs 3, pos-ola-c 65 (1 saltada), reglas 107, pos-sin-cdn 11, descubrimiento 61, version-contraste 20, version 22 (después de sellar). `css.mjs --comprobar` e
  `iconos.mjs --comprobar` en verde; `descubrimiento.mjs` y `version.mjs` corridos en ese orden: versión sellada 2026.10.06-7e1b642 (`--comprobar` de las dos, en verde). La suite completa
  NO se corrió (la hace otro agente).
  Decisiones que quedan para Yonatan: (a) la venta de mañana cuenta como hoy (por defecto; si prefiere avisar en vez de contarla, se cambia `diaDeVenta` y la cláusula de 120000); (b) los
  deshechos que suelta anular: al próximo cierre que se haga (lo que hay) o por día (cada cierre toma solo los de su día); (c) pos-ola-c-r6 y otras pruebas con ventas «a la hora de ahora» pueden
  fallar cerca de la medianoche de Bogotá (las de ronda4, r5a y ronda5 ya usan `haceMin`); (d) el panel lista los últimos 30 días, sin paginación de los más viejos; (e) el rastro
  `cierres_cambios` no se purga (es contabilidad; si crece, hay que decidir una purga); (f) aplicar `20261006100000`, luego `20261006120000` y recién después el push del POS.

- 2026-10-06 04:00 · **Integración y salida.** Fusionada con precio-a-mano-y-botones en la rama `tarea/integracion-cierres-precio` (merge 90a2fb0, versión sellada **2026.10.06-895b69a**)
  y publicada en `main` esta madrugada con el GO de Yonatan («haz push y deploy de todo»). En la integración hubo que aflojar también el hook de Docker de `migracion-cierres-ajustes.test.mjs`
  («la última de las previas es 20261006100000» → «la última previa de cierres»), porque el precio a mano queda en medio. Suite completa sobre el árbol fusionado: 2511 pasan, 0 fallan,
  2 saltadas; con Docker: migracion-cierres-de-hoy 33, migracion-cierres-ajustes 19 y las nueve vecinas, todas con 0 fallos. Ninguna función Edge cambia. **Refutación 2 (adfac81): aprobar
  con notas** (0 crítico, 0 alto, 1 medio y 3 bajos, todos de texto ante relojes desfasados y dos frases del README; corregidos en la ronda 3, e92c918, salvo lo que es decisión de Yonatan).
  **Lo que queda de Yonatan:** (1) pegar en el SQL Editor `20261006100000_cierres_de_hoy_y_cambios.sql` (junto con 20261006110000, un solo pegado) y confirmar con el select; (2) después
  pegar `20261006120000_cierres_ajustes.sql` (junto con 20261006130000) y confirmar; con el POS nuevo y solo la 100000, una venta «de mañana» (reloj adelantado) hace que el cierre responda
  `sin_ventas`, sin perder nada; (3) el visto en el POS al aire (aviso de ayer sin cerrar, panel de cierres solo admin, nota, anular con motivo y rastro); (4) las decisiones anotadas arriba:
  venta de mañana cuenta como hoy, deshechos al próximo cierre o por día, paginación del panel, purga del rastro. Hasta el visto y el SQL, la tarea sigue en-curso.

- 2026-10-06 04:40 · **Migraciones en producción.** Yonatan pegó en el SQL Editor de `lccgehvyymladqvumcez` primero `20261006100000_cierres_de_hoy_y_cambios.sql` (con 20261006110000, un
  solo pegado) y después `20261006120000_cierres_ajustes.sql` (con 20261006130000); las dos veces «Success. No rows returned» y el select de confirmación en `true` (cerrar_dia_de toma
  la venta «de mañana», cierre_anular suelta los deshechos). El POS al aire (2026.10.06-895b69a) ya corre contra la base completa. Queda solo el visto de Yonatan en el POS.
