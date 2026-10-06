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
