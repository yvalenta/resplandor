---
estado: en-curso
dueño: ambos
fecha: 2026-10-06
tema: un cronómetro sutil, en cada mesa ocupada del mapa y en la cabecera de su cuenta, de cuánto lleva esperando el pedido, y un toque «servida» que lo detiene cuando llega la comida
criterio_cierre: en el POS al aire, cada mesa ocupada con pedido muestra «N min» (neutro hasta 20, ámbar de 20 a 40, coral desde 40) que avanza solo cada minuto y se detiene con la pestaña oculta; tocar «servida» (cabecera) o mantenerlo (tarjeta) lo detiene en todas las tablets («servida 12:41 · esperó 17 min»); con la migración 20261006160000_servida.sql aplicada ANTES del push; con sus pruebas (vm, navegador, Postgres); visto de Yonatan en el celular
---

Pedidos de Yonatan del 2026-10-06: «al hacer un pedido, un cronómetro sutil para conocimiento de cuánto llevan esperando el pedido los de la mesa» y, después, «también podrá decidir si fue
atendido para que el cronómetro no siga… me refiero a que se le llevó la comida y ahí ya no necesita contar, solo informativo».

## Lo que hay y lo que hay que cuidar (para una sesión fría)
- Diseño y medidas en `docs/pos-visual.md` §0.27; resumen y contrato de datos en el README («Cronómetro de la mesa y «servida»», y la fila `servida_en` de la entidad Orden).
- Sin migración para el cronómetro: el inicio es `abierta_en`, salvo lo que la propia tablet vio (`pedidoEn` en `localStorage`). La marca «servida» sí necesita UNA columna:
  `supabase/migrations/20261006160000_servida.sql` (`ordenes.servida_en timestamptz null`; no sube `version`; idempotente; REVERSA en la cabecera). La aplica Yonatan, ANTES del push del POS
  (sin ella el POS esconde el toque y sigue con el cronómetro de siempre).
- El prefijo no es `20261006100000` (como pedía el encargo) porque `cierres_de_hoy_y_cambios` ya lo usa; una prueba exige prefijos únicos. Nació como `20261006140000`, pero la rama
  `tarea/promo-regla-ejecutable` ya toma `…140000` (normalizar_items_pliegue_y_precio_a_mano) y `…150000` (lapida_de_cuentas_borradas): se renombró a `20261006160000_servida.sql` para que
  entre a `main` antes o después de ella sin chocar. Es independiente de las dos (una columna; no toca `normalizar_items` ni las funciones que ellas reemplazan).
- Todo en `pos.html` va en bloques `PARTE cronometro-mesa` (helpers, store, tarjeta, cabecera, css) más siete ganchos de una línea (parseOrden, _sondearBase, procesarCambioEnVivo, _enviarDelta,
  _conMarcasPendientes, _fusionarOrdenes y _cobroParcialRechazado), la hora de «Abierta» de la cabecera (`timeZone: 'America/Bogota'`, código de antes) y los dos del ciclo de vida de la app.

## Bitácora
- 2026-10-06 (refutación r1 y su corrección, misma rama): el chip de la tarjeta ya no pisa el total de 768 a 830 px (el chip grande solo desde 1024; barrido de 32 anchos en la prueba);
  la tanda nueva a una mesa servida viaja mejor (se quita la marca después de los ítems; una lectura la reconoce; unas unidades que vuelven no la reinician; la marca ya no se
  anula con el reloj de otra tablet); «Abierta» también en hora de Bogotá. Queda como límite conocido que una tablet SIN copia previa de la cuenta cuenta desde `abierta_en`: pide una
  segunda hora en la base (decisión de Yonatan). Detalle en NOTAS.md de la carpeta de coordinación.
- 2026-10-06 (agente de implementación, rama `tarea/cronometro-mesa`, sin push ni Supabase de producción): **hecho** el código, las pruebas, los documentos y el sobre para Yonatan. Falta el visto de
  Yonatan en el celular y aplicar la migración antes del push. Detalle, decisiones, números de pruebas y el sobre (`sobre-servida.sql`, `reversa-servida.sql`, probados en Docker: aplicar, dos veces,
  reversa, volver a aplicar) en `~/Developer/worktrees/resplandor--coordinacion/cronometro-mesa/NOTAS.md`.
