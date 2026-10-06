---
estado: propuesta
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
