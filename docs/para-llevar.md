# «Para llevar» en el POS

Pedido de Yonatan (2026-10-02): «qué pasa si piden algo para llevar, debería haber un ítem no obligatorio para identificar si es para llevar el producto, no el pedido completo», y enseguida: «pero también el pedido completo». Rama `tarea/para-llevar`, sobre `origin/main` `90f8c00`. **Sin migración, sin función nueva, sin tocar `cuenta`:** todo viaja por los caminos que ya existían (Realtime, la cola de reintentos, el cierre, deshacer, el ticket, la impresión en la caja y la carta). Las pruebas están en `scripts/pruebas/pos-para-llevar.test.mjs` y `scripts/pruebas/carta-para-llevar.test.mjs`.

## Los dos niveles

| | Por producto | Pedido completo |
|---|---|---|
| Qué es | el token `Para llevar` al **final de la base de la nota** de la línea, separado por ` · ` como las variantes | una línea de **$0** con id fijo `para_llevar` (nombre «Para llevar», nota «Todo el pedido», cantidad 1) |
| Ejemplos | `Sopa · Pollo · Para llevar — Persona 2 (Camila)`; sin variante, `Para llevar` | `{ id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' }` |
| Control | «Para llevar» en cada línea del pedido (junto a «Asignar a persona»); «Agregar para llevar» junto al buscador | «Todo para llevar» en la cabecera del pedido |
| Se sube con | `actualizar_nota_item` (como la persona) | `aplicar_delta_orden` +1 / −cantidad (deltas idempotentes, cola de reintentos) |
| Se ve | pastilla propia con bolsa (SVG en línea) bajo el nombre | encabezado «Para llevar · todo el pedido» en el pedido, bolsa en la tarjeta de la mesa del mapa |
| Ticket / precuenta / caja | «Para llevar» bajo el producto | encabezado «PARA LLEVAR — todo el pedido» (en el papel de la caja, `-`), sin la línea de $0 |
| Carta del cliente | no se ve (`cuenta` no manda las notas) | etiqueta «Para llevar» sobre la lista, no una línea de $0 |

**Persona y variante se conservan siempre**: el token va en la base, antes del sufijo `— Persona N (nombre)`. Las funciones puras (`_parsearLlevar`, `_ponerLlevar`, `llevarDe`, `notaVariante`) viven junto a `_parsearPersona`. Si dos tablets lo ponen a la vez quedan tokens de más: se leen como uno y se quitan todos juntos.

### Marcar una línea
`alternarLlevar(item)` marca la línea **entera** (todas sus unidades), cambia la pantalla al instante y sube la nota con `actualizar_nota_item`. La marca queda **pendiente** hasta que la base la confirma: si falla por la red se reintenta (1,5 s, 3 s, 6 s… hasta 8 veces, unos 3 min, y en cuanto vuelve la red), un rechazo de permisos o una cuenta ya cobrada se sueltan sin reintentar, y lo que llegue de la base mientras tanto (el eco de Realtime de otro cambio, la lectura de reconexión) no la borra de la pantalla (`_conMarcasPendientes`). Espera a las subidas de esa cuenta que ya iban en camino: una línea recién agregada puede no existir todavía en la base. **Límite:** los reintentos viven en memoria; si se recarga la página antes de que la base confirme, la marca no se recupera (la asignación de persona se comporta igual).

### Agregar: «1 aquí y 1 para llevar» son dos líneas
Sumar un producto busca una línea del **mismo producto + variante + estado de llevar** (`_esLineaDe`), no solo el mismo id. La línea que entra marcada toma el id `<id natural>__para-llevar` (p. ej. `be1__para-llevar`, `ej1__sopa-pollo__para-llevar`); si el id que le toca lo ocupa una línea de otro estado (porque se alternó después), entra con un id único (`<natural>__<uid>`) que no pisa ninguno. «Agregar para llevar» (`agregarParaLlevar`) guarda el **id de la cuenta** en la que se encendió: otra mesa lo encuentra apagado y `volverAMesas`/`abrirMesa` lo limpian. Lo respeta también la hoja de variantes. Con «Todo para llevar» puesto, las líneas nuevas no se marcan (el interruptor se esconde).

### El marcador
Encendido = cantidad ≥ 1. Dos tablets a la vez, o un «Deshacer» que devuelve la copia del marcador a la cuenta que ya lo tiene (la base suma cantidades), lo dejan en 2 y se ve igual; apagarlo manda **−cantidad**, no −1. Un POS viejo sin recargar lo ve como una línea de $0 legible («Para llevar», «Todo el pedido») y, si le asigna una persona, no pasa nada: el POS nuevo ignora la persona del marcador.

## Tabla de decisiones: cada recorrido que itera ítems

| Recorrido | Decisión |
|---|---|
| Total de la cuenta (`totalOrdenActiva`, `totalMesa`, total del mapa, `_subirLoPendiente`, cierre) | Suma igual: el marcador es $0. No cambia ningún total. |
| «N ítem(s)» (`nLineas`) y el modal de cobro | No cuenta el marcador. El modal dice «… para llevar». |
| Lista del pedido | `lineasDe(items)`: el marcador no se dibuja (sin +/−, sin «Asignar a persona»). |
| Mapa de mesas | Bolsa pequeña + texto para lectores si la cuenta lo tiene; con solo el marcador no muestra total ($0). |
| Cobrar la mesa completa (`facturar`) | `hayLineas`: con solo el marcador no se cobra (botón apagado como en mesa vacía). Con productos, el marcador **viaja en la venta cerrada** (queda registrada «para llevar»). |
| Cobro por partes, precuenta, «Liberar mesa» | Apagados / visible según `hayLineas`. Con solo el marcador **sí se puede liberar** (se borra la fila, marcador incluido). Con abonos recibidos sigue prohibido. |
| Dividir por persona (`gruposPorPersona`, `renombrarPersona`, `ciclarPagador`) | El marcador se salta **por id**, aunque una pantalla vieja le asignara una persona. |
| Selección de cobro (`toggleSeleccion`, líneas, unidades, subtotal) | El marcador no se marca nunca (no tiene casilla; `toggleSeleccion` lo rechaza). |
| Cobro por unidades o por persona (`facturarParcial`) | No se saca de la cuenta (nunca entra en `items` a descontar). La venta parcial lleva una **copia** (cantidad 1, $0), así su ticket dice «PARA LLEVAR» y la venta queda registrada; la cuenta lo **conserva**. |
| Abono (`cobrarMonto`) | La venta «Abono» tiene una sola línea: **no** copia el marcador. La cuenta lo conserva. `ordenSoloAbonos` lo ignora. |
| Deshacer un cobro (`deshacer_cobro`, `tipoDevolucion`, espejo local) | Sin cambios: el cobro con copia del marcador vuelve a la cuenta y la base suma (queda en 2, «encendido» sigue igual); un cobro completo reabre la venta con su marcador. Apagarlo manda −cantidad. |
| Cobro por partes rechazado por la base (`_cobroParcialRechazado`) | Salta el marcador: la cuenta nunca lo perdió, devolverlo lo dejaría en 2. |
| Delta perdido (`_deltaDescartado`) | Aviso propio: ««Todo para llevar» no se guardó». |
| Reconciliación con la base (`procesarCambioEnVivo`, `_fusionarOrdenes`, `_releerOrden`, `_subirLoPendiente`, cola de deltas) | El marcador es una línea más: llega por Realtime, sobrevive a la lectura de reconexión y sale por la cola con su id de delta. Las marcas por línea pendientes se reponen encima de lo que llegue. |
| Cierre del día (ventas, KPIs, transacciones, historial, deshechos) | Los totales no cambian. La venta con marcador lleva el chip «Para llevar»; el detalle no dibuja la línea de $0 y dice «Para llevar · todo el pedido»; las líneas marcadas dicen «· para llevar». |
| Editar o reabrir una venta cerrada | El marcador es una línea normal para la base; los controles funcionan (sobre una venta embebida en un cierre, solo en local, como la persona). |
| Ticket de pantalla, documento de la caja, precuenta | Encabezado «PARA LLEVAR — todo el pedido» (en el papel, `PARA LLEVAR - todo el pedido`, centrado y en negrita); sin la línea de $0; «Ítems» no la cuenta; «Para llevar» bajo cada producto marcado (con el encabezado sobra). El ticket de «Cobrar» de una persona, igual (por la copia del marcador). |
| Carta del cliente (función `cuenta`, `carta.html`) | La línea llega como `{nombre: 'Para llevar', precio: 0}`; la carta la reconoce por nombre y precio y la muestra como etiqueta (no suma a «N productos», no se anuncia como «Se agregó»). **No se tocó `cuenta`**: la marca por producto vive en la nota y la función quita las notas, así que la carta no la ve. |

## Pendientes y preguntas
- **«Para llevar» no cobra empaque** (Yonatan, 2026-10-03: «no, para llevar no cobra empaque»). Es solo una marca. Si algún día se cobrara, sería un producto aparte («Empaque») que se agrega a mano, no parte de este diseño (el reconocimiento del marcador en la carta exige precio 0).
- **Marca por producto en la carta del cliente:** requiere tocar `supabase/functions/cuenta` (`agruparItems` en `_compartido/mesa.js`: agrupar también por el token de llevar y mandar `llevar: true`), y redesplegarla es un paso más para Yonatan. No es imprescindible: la carta muestra el pedido completo.
- **Reintentos solo en memoria** para la marca por línea (ver arriba).
