# Cuenta en mesa: ver en vivo y liquidar desde la pegatina NFC

> **Software Design Document · v0.2, refutado, para aprobación de Yonatan**

La pegatina NFC de cada mesa muestra la cuenta **en vivo** y **solo para ver**. Desde ahí el cliente puede **pedir la cuenta**. El mesero la **presenta** y le dice un **código de 4 dígitos**. Con ese código el cliente ve **a dónde transferir** (Bre-B o cuenta Bancolombia) y avisa «ya pagué». **El mesero confirma el pago y la mesa se cierra en una sola operación de la base. Nada se cierra solo.**

| Versión | Estado | Tarea | Rama | Actualizado |
|---|---|---|---|---|
| 0.1 | Borrador. Lo revisaron dos refutadores: seguridad y dinero, operación y UX | `tareas/2026-09-30-cuenta-en-mesa.md` | `tarea/cuenta-en-mesa` | 2026-09-30 |
| **0.2** | **Incorpora los 2 críticos, los 9 altos y los medios baratos (§11). Sin implementar** | ídem | ídem (desde `3bae016`) | 2026-09-30 |

Pedido de Yonatan del 2026-09-30, con sus palabras:

- Cuando el mesero agrega algo, se ve en la pegatina en tiempo real. Es solo para ver, sin permiso de editar.
- Desde la pegatina se puede liquidar la mesa.
- Hay enlaces a las formas de pago, que son Bre-B y cuenta Bancolombia.

Requisito duro que agregó después (`tareas/2026-09-30-cuenta-en-mesa.md:26-31`): el cambio llega solo, sin botón. Varios celulares ven lo mismo. El cierre y la rotación del token también se ven en vivo. Si se cae el canal, un sondeo silencioso lo respalda y se avisa «sin conexión».

Este documento se apoya en lo que ya existe: el token por mesa, la Edge Function `cuenta` y «Mi cuenta» en `carta.html` (`README.md:242-251`). **No lo reemplaza.**

**Qué cambió de v0.1 a v0.2:**

1. Confirmar el pago **cierra la orden y libera la mesa en la misma transacción**, y exige que el monto recibido cubra el total actual (§03.9).
2. Los datos de pago y el «ya pagué» piden un **código por cuenta** que dice el mesero (§03.4).
3. Los reportes de pago **se acumulan** y nunca se borran. El cliente escribe lo que transfirió, así que una cuenta dividida se puede reportar (§03.8).
4. Las pegatinas llevan **contraseña de escritura**, y las funciones solo aceptan CORS de `resplandor.ynt.codes` (§03.10).
5. La carta **detecta un canal mudo** y no dice «En vivo» si no lo está (§03.2).
6. Los arreglos de lógica de `pos.html` pasan a fase 1. Solo el marcado espera a `tarea/pos-visual` (§08).

> **Línea Roja** (`~/Developer/sigilo/LINEA_ROJA.md`). Ningún agente hace estas cosas; quedan para Yonatan:
> - mover dinero;
> - cargar datos de pago o correos del personal;
> - poner contraseña a las pegatinas;
> - aplicar migraciones, desplegar funciones o hacer push.
>
> Los datos de pago reales los dan Yonatan o Camila, la dueña: llave Bre-B, número de cuenta y titular. **No hay un solo valor de ejemplo en este documento ni en el código.** El repo es público (`privacy.html:79`).

---

## Contenidos

1. [Objetivo y alcance](#01--objetivo-y-alcance)
2. [Actores y permisos](#02--actores-y-permisos)
3. [Flujos, estados y errores](#03--flujos-estados-y-errores)
4. [Arquitectura](#04--arquitectura)
5. [Seguridad](#05--seguridad)
6. [Normativa y UX](#06--normativa-y-ux)
7. [Costos frente al plan Free](#07--costos-frente-al-plan-free)
8. [Fases de implementación](#08--fases-de-implementación)
9. [Decisiones abiertas](#09--decisiones-abiertas)
10. [sin_dato](#10--sin_dato)
11. [Registro de refutación](#11--registro-de-refutación)

---

## 01 — Objetivo y alcance

### Objetivo

Hay tres resultados que se pueden medir:

1. **En vivo.** Un ítem que el mesero agrega aparece en el teléfono en **≤ 2 s (p95)** si es un cambio aislado. Si llega en una ráfaga, el último ítem aparece en ≤ 4 s. Hoy puede tardar 20 s (`carta.html:518`). Si el canal se cae o enmudece, la carta lo detecta, lo dice y pasa a sondeo.
2. **Liquidar.** El cliente pide la cuenta. El POS lo avisa con insignia, píldora y sonido. El mesero la presenta, pregunta por la propina y dice el código. El cliente ve el total, elige la propina y ve los datos de pago.
3. **Confirmar y cerrar.** El cliente avisa cuánto transfirió. El mesero confirma **solo** al ver el abono en el banco. Una sola RPC registra el medio y la propina, cierra la orden y libera la mesa.

### Qué entra y qué no

| Entra (fases 1 y 2) | No entra (fase 3 o fuera de alcance) |
|---|---|
| Cuenta en vivo, de solo lectura, con sondeo de seguridad cada 60 s y respaldo a 20 s si el canal falla | Que el cliente agregue o quite ítems (peldaño 3, `tareas/2026-09-06-carta-nfc-y-cuenta.md:120`) |
| «Pedir la cuenta» con confirmación y «Ya no la quiero» mientras nadie la presenta | Dividir la cuenta **por ítems** desde la pegatina. El POS ya cobra por partes (`pos.html:2488`) |
| El mesero presenta la cuenta: fija el total y genera el código | Facturación electrónica DIAN (`README.md:78`) |
| Propina voluntaria: tres opciones, ninguna preseleccionada | Pasarela con contrato y confirmación automática (Wompi, Bold, Botón o QR Bancolombia por API) |
| Datos de Bre-B y de la cuenta Bancolombia, con «Copiar», detrás del código | Un QR Bre-B generado por el sitio o un enlace que abra el banco con el monto: no existe mecanismo público (§10) |
| Mostrar el QR del banco **en la página** | El QR del banco va solo impreso en el mostrador (D2): pesa 40 KB y sale en cada lectura (§11, SD8) |
| «Ya pagué» con el monto que se transfirió; varios reportes por cuenta | Subir la foto del comprobante (D9) |
| Confirmar y cerrar en una sola RPC, con Efectivo, Datáfono y Mixto | Rotar el token en cada cierre con las NTAG215 de hoy (§03.10) |
| Línea de propina en el ticket y propinas del día en el cierre | Reporte del cierre por medio de pago (D14) |
| Contraseña de escritura en las pegatinas; canal de presencia del POS privado (D17) | Pasar todo Realtime a «solo privados» (R5) |
| | Exponer pagos o `liquidar` a agentes (WebMCP, MCP, `llms.txt`) |

---

## 02 — Actores y permisos

| Actor | Cómo entra | Qué ve | Qué puede hacer | Qué no puede hacer |
|---|---|---|---|---|
| **Cliente en la mesa** (rol `anon`) | Toca la pegatina o escanea el QR de respaldo: `carta.html?m=<mesa>&k=<token>` (`README.md:251`). Usa la llave *publishable*, sin login | La carta. La orden **abierta** de su mesa: ítems agrupados por nombre y precio, total y hora. El estado de la liquidación y los reportes. Los datos de pago **solo con el código** | Pedir y cancelar la cuenta. Con el código: ver los datos de pago y reportar pagos. Todo por `liquidar` | Editar ítems, cerrar la mesa, confirmar un pago, ver otras mesas, ver notas, leer tablas |
| **Quien guardó el enlace o fotografió el QR** («fuga aceptada», `cuenta/index.ts:10-14`) | El mismo enlace, desde fuera del local | Lo mismo que el cliente, **sin** datos de pago | Pedir la cuenta, que se acota con 5 pedidos por orden y el «Atendido» del mesero | Ver datos de pago o reportar pagos: no oyó el código |
| **Personal del POS** (rol `authenticated`, Google, `solo_google` en base.sql:270-279, y la lista blanca de D15 para las RPC de dinero) | `pos.html` | Todo el POS, más avisos y código de cada liquidación | Presentar, atender, confirmar y cerrar, anular, rotar el token | Cambiar datos de pago (`medios_pago` no tiene GRANT para `authenticated`). Escribir `liquidaciones` directo (solo SELECT) |
| **Camila** (dueña) | El POS, y la app del banco como titular | Las notificaciones de abono: titular y, en persona jurídica, hasta 6 delegados (blog Bancolombia, §10) | Entregar los datos de pago, verificar abonos, decidir propina, lo legal y la lista del personal | — |
| **Yonatan** | POS, dashboard y SQL Editor de Supabase, GitHub, app de NFC | Todo | Cargar `medios_pago` y `privado.personal`, encender `liquidar`, poner contraseña a las pegatinas, migrar, desplegar y hacer push. Todo con su GO | — |
| **Edge Function `cuenta`** (service role) | GET público, `verify_jwt` apagado | `mesas`, `ordenes`, `liquidaciones` (sin código), `ajustes_cuenta` | Solo leer | Escribir. Devolver datos de pago o el código |
| **Edge Function `liquidar`** (service role) | POST público, `verify_jwt` apagado | — | Ejecutar **solo** `public.liquidacion_cliente(...)` (§04.5) | Tocar ítems, totales, estado de la orden o la mesa |
| **Banco y Bre-B** | Fuera del sistema | — | Mover el dinero entre la app del cliente y la cuenta de Camila | Hablar con este sitio |
| **Atacante con una pegatina encima o reescrita** | Un clon en otro dominio | Lo que lee de la pegatina real: el token | Mostrar la cuenta real y su propia llave | Reescribir la pegatina real con contraseña (D16). Llamar a las funciones desde un navegador en otro origen (CORS) |

**Regla que no cambia** (`README.md:227-229`): `anon` sigue sin policies ni GRANT sobre las tablas del POS y sobre las tablas nuevas. Todo lo que ve o hace el cliente pasa por `cuenta` o `liquidar`, que validan el par `(mesas.id, mesas.token)`.

---

## 03 — Flujos, estados y errores

### 03.1 Estados de la liquidación (tabla `liquidaciones`, una fila por orden)

```
             pedir (cliente, ≤5)              presentar (mesero: total + código)
 (sin fila) ─────────────────► pedida ──────────────────────────► presentada ◄──────────┐
     │                          │  ▲ cancelar → anulada              │                    │ presentar de nuevo
     │                          │  └── pedir (anulada → pedida)      │ reportar_pago      │ (CONSERVA los reportes)
     └── presentar ─────────────┼────────────────────────────────────┘ (con código)       │
                                │                                    ▼                    │
                                │                              pago_reportado ────────────┘
                                │                        (reportes acumulados, ≤ 8)
                                ▼                                    │
          confirmar_y_cerrar (mesero) desde cualquier estado ─────► confirmada  + orden cerrada + mesa libre
          anular (mesero) desde cualquier estado no final ───────► anulada
```

| Estado actual | `pedir` | `cancelar` | `ver_pagos` | `reportar_pago` | `presentar` | `atender` | `confirmar_y_cerrar` | `anular` |
|---|---|---|---|---|---|---|---|---|
| sin fila | crea `pedida` | 409 `no_pedida` | 409 `no_presentada` | 409 `no_presentada` | crea `presentada` con código | no hace nada | cierra y crea `confirmada` | no hace nada |
| `pedida` | idempotente | → `anulada` | 409 `no_presentada` | 409 `no_presentada` | → `presentada` | marca el aviso atendido | → `confirmada`, cierra | → `anulada` |
| `presentada` | idempotente | 409 `ya_presentada` | datos de pago, con código y si está vigente | → `pago_reportado`, con código | vuelve a fijar el total. El código se conserva salvo bloqueado | marca | → `confirmada`, cierra | → `anulada` |
| `pago_reportado` | idempotente | 409 `ya_presentada` | ídem | agrega un reporte (≤ 8) | → `presentada` y conserva los reportes | marca | → `confirmada`, cierra | → `anulada` |
| `confirmada` | 409 `ya_confirmada` | 409 | 409 | 409 | 409 `ya_confirmada` | no hace nada | idempotente con los mismos datos; si no, 409 `ya_cerrada` | solo al reabrir la orden (§03.9.5) |
| `anulada` | → `pedida` si `pedidos < 5` | 409 `no_pedida` | 409 | 409 | → `presentada` | no hace nada | → `confirmada`, cierra | idempotente |

- **Vigente** significa `total_presentado = round(ordenes.total)`. Se compara el total y no `version`, porque la etiqueta «Persona N» sube `version` sin cambiar el monto (base.sql:204-234; `pos.html:2545-2560`).
- **Sin vigencia** la pegatina esconde los datos de pago y dice «El mesero ajustó la cuenta; espera a que la presente de nuevo». **Un reporte sí se acepta**, porque el cliente puede haber transferido antes del cambio: queda guardado con `vigente:false` y el total al que se refería (§11, A2).
- **Los topes viven en la base**, no en la memoria de la función:
  - 5 `pedir` por orden;
  - 8 reportes por orden;
  - 5 códigos fallidos, y entonces el código queda bloqueado hasta que el mesero vuelva a presentar.

### 03.2 Flujo A: ver la cuenta en vivo (fase 1)

1. El cliente toca la pegatina y se abre `carta.html?m&k`. Con un par válido aparece «Ver mi cuenta · Mesa N» (`carta.html:256-260`).
2. Al tocarla, `GET cuenta` pinta la cuenta. La respuesta trae `canal.topico` y `marca`, una huella del estado (§04.3).
3. La carta carga supabase-js en diferido, con SRI (§04.7), y se une al canal público `canal.topico` para escuchar `cambio`.
4. Al recibir `SUBSCRIBED` hace un segundo `GET`, para recoger lo que haya cambiado entre la primera lectura y la suscripción. La pastilla dice «En vivo».
5. El mesero agrega un ítem. El trigger emite `realtime.send('{}', 'cambio', topico, false)`. La carta recibe la señal y lee de nuevo:
   - con *debounce* de 400 ms;
   - con una cubeta de 6 lecturas que se recarga a razón de 1 cada 10 s. La ráfaga normal del mesero pasa entera; una inundación de señales queda en unas 7 lecturas por minuto (§05, S6).
6. La carta resalta los ítems nuevos y lo anuncia en `role="status" aria-live="polite"`: «Se agregó 1 × Limonada». Muestra «Leída hace X s», calculado con la hora del servidor.
7. **Sondeo de seguridad, también en «En vivo».** Cada 60 s, con la hoja abierta y la página visible, hace un `GET`. Si la `marca` cambió y no llegó ninguna señal desde la lectura anterior, el canal está **mudo**. La carta pasa a sondeo cada 20 s y la pastilla dice «Se actualiza cada 20 s». Esto cubre:
   - el trigger borrado por la reversa;
   - la función desplegada antes que la migración;
   - una partición de `realtime.messages` que falta;
   - un `realtime.send` que falló en silencio.
8. Si no llega `SUBSCRIBED` en 4 s o el canal se cae, también pasa a sondeo de 20 s y reintenta el canal cada 60 s.
9. Con la página oculta más de 60 s, cierra el canal. Al volver, lee y se suscribe de nuevo.

### 03.3 Flujo B: pedir la cuenta (fase 2)

1. Con la orden abierta y sin liquidación, la hoja muestra «Pedir la cuenta». Al tocarlo sale una confirmación en línea: «¿Le avisamos al mesero que quieren la cuenta?», con «Sí, avisar» y «No».
2. La carta hace `POST liquidar {accion:'pedir'}` y la fila queda en `pedida`. Es idempotente.
3. La pegatina dice: «Le avisamos al mesero en la tablet. Si en 2 minutos nadie viene, hazle una seña». A los 2 min en `pedida` cambia a «¿Nadie vino? Hazle una seña al mesero». Mientras siga en `pedida` hay un botón «Ya no la quiero», que hace `cancelar`.
4. El POS recibe el `postgres_changes` de `liquidaciones`. Si la orden está abierta, aparecen:
   - la insignia «Pide la cuenta» en la tarjeta de la mesa;
   - la píldora «N avisos» en la barra (`.nav-pill-aviso`, de `docs/pos-visual.md` §3.8);
   - un pitido corto y `document.title` con «(1) Mesa 3 pide la cuenta», si el POS está visible (D11).
5. «Atendido» quita el aviso en todas las tablets sin cambiar lo que ve el cliente. El aviso vuelve solo si hay un pedido nuevo después de esa marca.

### 03.4 Flujo C: el mesero presenta la cuenta y dice el código

1. En la orden, el mesero toca «Presentar cuenta». Puede hacerlo aunque el cliente no la haya pedido.
2. **Antes de llamar a la RPC**, el POS:
   - vacía su cola de deltas (`flushDeltas`, `pos.html:2347`);
   - **se niega a presentar** si queda algún delta de esa orden en `colaDeltas`: «Hay cambios sin subir. Revisa la conexión».
3. Llama a `presentar_cuenta(orden_id, total_visto)`, donde `total_visto` es `totalOrdenActiva` (`pos.html:2197`). Si la base tiene otro total, responde `cuenta_cambio`: otra tablet tiene cambios que esta no ve, así que se recarga y se revisa.
4. La RPC fija `total_presentado` y `propina_sugerida` y genera un **código de 4 dígitos**, o conserva el que había si no está bloqueado.
5. El modal muestra en grande «Código para la mesa: ····». También muestra el texto **«Pregúntale si quiere incluir propina. Es voluntaria; la sugerida es $Y»**. Así se cumple que «la persona que atiende» pregunte (Ley 1935, art. 4).
6. La pegatina recibe la señal y muestra «Total a pagar $X» y la pregunta de la propina. Ese total viene de la base.

**Por qué el código** (§11, SD4 y B1). El QR de respaldo deja el token a la vista de todo el salón, y `cuenta` entrega el `orden_id`, así que atar las acciones al `orden_id` no frena a quien tiene el enlace. El código solo se dice en la mesa: quien guardó el enlace o fotografió el QR no puede ver los datos de pago ni reportar pagos.

### 03.5 Flujo D: propina voluntaria

1. Con la cuenta `presentada` y vigente aparecen tres opciones con el mismo peso visual, **ninguna preseleccionada**:
   - «Sin propina»;
   - «Propina sugerida 10 % ($Y)», donde `$Y` es `propina_sugerida`, calculada en SQL;
   - «Otro valor».
2. Encima hay un enlace a «Aviso de propina», con el texto que fije Camila (D10).
3. Al elegir, la carta muestra «Total de la mesa $X», «Propina $Y» y «**Monto a transferir $X+Y**», con «Copiar monto».
4. La elección se guarda en `sessionStorage['liq:'+orden_id]`. Si iOS descarta la pestaña mientras el cliente está en la app del banco, no se pierde.
5. **Siempre es el total de toda la mesa**: «Si pagan por separado, díganselo al mesero antes de transferir». La propina que cuenta es la que resulta del dinero recibido (§03.9). La elección en pantalla solo calcula una sugerencia.

### 03.6 Flujo E: ver los datos de pago y pagar por Bre-B

1. «Ver a dónde transferir» pide el código: 4 dígitos, `inputmode="numeric"`, con el texto «el que te dijo el mesero». La carta hace `POST liquidar {accion:'ver_pagos', codigo}`.
   - Si el código está mal, aparece «Código incorrecto. Te quedan N intentos».
   - Al quinto fallo queda bloqueado: «Pídele al mesero que vuelva a presentar la cuenta».
2. Con el código bien, la respuesta trae `pagos` y el código queda en memoria y en `sessionStorage`, para reportar después.
3. El bloque Bre-B muestra:
   - la llave en texto, con «Copiar llave»;
   - el **titular tal como lo verá el cliente en su banco**;
   - la instrucción: «En la app de tu banco: Bre-B → Transferir con llave → pega la llave → escribe el monto → verifica que el destinatario diga "‹titular›"».
4. No hay enlace profundo, monto prellenado ni QR en la página (§10, D2). El QR del banco está impreso en el mostrador, junto con la llave y el titular. Ese cartel es un **segundo canal** para comparar (§05, S2).

### 03.7 Flujo F: pagar a la cuenta Bancolombia

Se muestra solo si existe la fila `bancolombia` activa (D2).

1. El bloque muestra el tipo de cuenta, el número con «Copiar número» y el titular.
2. Lleva el texto: «Desde Bancolombia es inmediato. Desde otro banco puede que tengas que inscribir la cuenta: es más rápido Bre-B». Por eso Bre-B va primero. Desde Mi Bancolombia también se transfiere a una llave (Bre-B → Transferir con llaves; ayuda de Bancolombia, §10).

### 03.8 Flujo G: «Ya pagué», con o sin comprobante (y cuenta dividida)

1. «Ya pagué» abre un formulario corto:
   - método: Bre-B o Bancolombia, preseleccionado según el bloque que usó;
   - **monto que transferiste**: dos opciones, «$X+Y (lo que calculamos)» y «Otro valor», ninguna marcada. Con «Otro valor», el cliente escribe un entero;
   - referencia opcional, de hasta 24 caracteres `[A-Za-z0-9-]`.
2. La carta hace `POST liquidar {accion:'reportar_pago', codigo, metodo, monto, referencia?}`. El reporte **se agrega** a `reportes`. Lleva el total al que se refería y si estaba vigente. Nada se borra ni se pisa.
3. La pegatina muestra la lista:
   - «Avisaron $50.600 por Bre-B a las 13:42 · sin confirmar»;
   - debajo, «Total avisado $Z» y «Falta según la cuenta $max(0, X − Z)».
   - Cada teléfono de la mesa puede agregar su propio reporte. Eso cubre la cuenta dividida sin dividir ítems.
4. **Comprobante:** no se sube ninguna imagen (D9). El cliente lo enseña en su pantalla si el mesero se lo pide. La prueba es el abono en el banco.
5. Un reporte equivocado no se edita: el mesero lo ve rotulado «no verificado» y confirma lo que ve en el banco.

### 03.9 Flujo H: el mesero confirma y cierra (atómico)

1. El banner de la orden dice «Mesa N reporta pagos: $Z en K avisos (no verificados)». Tiene tres acciones: **«Confirmar pago y cerrar»**, «Presentar de nuevo» y «Atendido». «Anular liquidación» queda en un menú secundario.
2. «Confirmar pago y cerrar» abre un modal con:
   - el **Total actual**, que es el total local y debe coincidir con la base;
   - el **Presentado**, si existe. Si difiere, una franja dice «La cuenta cambió después de presentarla: cobra la diferencia»;
   - los reportes, con el rótulo «no verificados»;
   - el medio: Bre-B, Bancolombia, Efectivo, Datáfono o Mixto;
   - «**Monto que se queda el restaurante**», incluida la propina. El campo arranca **vacío** y se escribe a mano;
   - la propina que resulta, `monto − total`, en solo lectura;
   - el texto fijo **«Confirma solo si ya ves la plata en la app del banco. El pantallazo del cliente no basta.»**
3. La RPC `confirmar_y_cerrar(orden_id, total_visto, metodo, monto)` hace todo en **una transacción** (§04.5):
   - revisa que el usuario sea del personal;
   - revisa que `round(total) = total_visto` y que `monto ≥ round(total)`;
   - cierra la orden, con `estado`, `cerrada_en`, `medio_pago`, `propina = monto − total` y `version + 1`;
   - libera la mesa;
   - deja la liquidación en `confirmada`.
4. El POS revisa `{error}` y `data.ok`:
   - **Si falla**, muestra un error que bloquea, con el motivo: «La cuenta cambió», «Falta $N» o «Sin conexión: no se cerró nada». La mesa sigue abierta en todas partes.
   - **Si sale bien**, refleja el cierre en local, **sin** el `pushASupabase` de `facturar()`, porque la base ya está cerrada, y muestra el ticket. Si se repite la llamada tras una respuesta perdida, la RPC responde `repetida:true`.
5. **El «Facturar» de siempre** (`pos.html:3316-3321` → `modalConfirmFactura` → `facturar()`, `:2445`):
   - Si la orden **no tiene** una liquidación activa (`pedida`, `presentada` o `pago_reportado`), funciona igual que hoy.
   - Si la tiene, `facturar()` cierra el modal viejo y abre «Confirmar pago y cerrar». Así no queda una liquidación colgada ni se pierden el medio y la propina (§11, A6).
6. **Reabrir** una orden (`pos.html:2689`) primero llama a `anular_liquidacion`, que limpia `medio_pago` y `propina`. Si eso falla, no reabre.
7. La pegatina recibe la señal. Con la `o` de esa orden ve «Pago confirmado. ¡Gracias!». Sin `o`, ve «Todavía no hay cuenta abierta».

### 03.10 Rotar el token al cerrar, la fuga y la pegatina misma

**Por qué no se rota al cerrar.** La URL va escrita en la NTAG215, y rotar obliga a reescribirla. El POS lo advierte: «La pegatina actual deja de servir y hay que reescribirla» (`pos.html:2615`). Rotar en cada cierre significaría reescribir las 10 pegatinas varias veces al día.

| Opción | Cierra la fuga | Costo | Recomendación |
|---|---|---|---|
| **A. Aceptarla para ver** | No para ver. **Sí para pagar**, con el código (§03.4). La cuenta no lleva datos personales (§05, S8) | Ninguno | **Sí, en fases 1 y 2** |
| A+. La `o` de la pestaña | Parcial: una pestaña que siguió abierta ve «cerrada» y no la orden siguiente (§04.3). **No** se ofrece «Ver la cuenta actual»: hay que volver a tocar la pegatina (§11, SD12) | Bajo | Sí, incluido |
| B. Código también para **ver** | Sí | Fricción antes de que exista la cuenta: el mesero no ha presentado | Solo si hay abuso (D7) |
| C. Pegatinas **NTAG 424 DNA con SUN**: en cada toque el chip agrega a la URL un contador y un CMAC AES que el servidor verifica (NXP AN12196, https://www.nxp.com/docs/en/application-note/AN12196.pdf) | Sí, para NFC. El QR de respaldo sigue siendo estático | Pegatinas nuevas (precio sin dato), una llave AES por pegatina y una tabla de contadores | Al reemplazar las pegatinas (D7) |
| ~~D. Espejo de UID o contador de la NTAG215~~ | No: copia el UID y un contador en ASCII **sin MAC** (hoja de datos NTAG213/215/216, https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf) | — | Descartada |

**Proteger la pegatina** (§11, SD1). De fábrica, cualquier teléfono puede reescribir una NTAG215. La hoja de datos lo explica (§8.5.7): AUTH0 vale FFh y, si es mayor que la última página, «la protección por contraseña queda deshabilitada». Un comensal con una app de NFC podría poner la URL de un clon en 5 segundos sin que se note por fuera.

- **Qué se hace (D16):** Yonatan fija en las 10 pegatinas la contraseña PWD/PACK con **AUTH0 = 04h y PROT = 0** (hoja de datos §8.8). La lectura sigue libre y la escritura exige la contraseña. Así se puede reescribir al rotar, pero solo con la contraseña.
- **Dónde vive la contraseña:** en el gestor de Yonatan, nunca en el repo.
- **Lo que no cubre:** la PWD es de 32 bits y viaja en claro por NFC al escribir. Es un freno, no criptografía. Tampoco impide **pegar otra pegatina encima**. Por eso hay revisión diaria (§03.12) y el cartel del mostrador (§03.6).

### 03.11 Casos de error y bordes

| Caso | Qué ve el cliente | Qué hace el sistema |
|---|---|---|
| Sin red al abrir | «No pudimos leer la cuenta», con Reintentar (`carta.html:297-301`) | No abre el canal y reintenta al tocar |
| Sin red con la cuenta cargada | La última cuenta, con «Sin conexión · leída a las hh:mm» | No pisa la cuenta buena (`carta.html:535`). Reintenta con *backoff* y lee al reconectar |
| Realtime no conecta | «Se actualiza cada 20 s» | Sondeo de 20 s y reintento del canal cada 60 s |
| **Canal mudo** (trigger caído, despliegue fuera de orden) | Pasa de «En vivo» a «Se actualiza cada 20 s» en ≤ 60 s después del primer cambio perdido | El sondeo de seguridad detecta la `marca` distinta sin señal (§03.2.7) |
| **Token rotado** mientras mira | «Este enlace ya no sirve. Vuelve a tocar la pegatina o pide el enlace al mesero» | El trigger de `mesas` avisa al tópico viejo. El `GET` da 404 y la carta cierra el canal |
| **Mesa sin orden** | «Todavía no hay cuenta abierta. Cuando el mesero tome su pedido, aparece aquí» | Sigue suscrita: el INSERT de la orden emite y la cuenta aparece sola |
| **Orden cerrada mientras mira** | «Mesa cerrada. ¡Gracias!», o «Pago confirmado» si la confirmó la RPC. Sin botón para ver la cuenta actual | `GET ?o=<orden_id>` devuelve `estado:'cerrada'` (§04.3) |
| Pestaña reutilizada por una pegatina nueva | La cuenta actual, no «cerrada» | `o` se recupera de `sessionStorage` solo si la navegación es `reload` o `back_forward`. Un toque nuevo es `navigate` y arranca limpio (§04.7) |
| Cobro parcial en el POS (`pos.html:2488-2525`) | Los ítems cobrados desaparecen. Si estaba presentada: «El mesero ajustó la cuenta» | La cuenta deja de estar vigente. Los reportes se conservan |
| Orden reabierta en otra mesa (`pos.html:2702`) | En la mesa vieja, «cerrada». En la nueva, aparece | El trigger avisa a las dos mesas. Reabrir anula la liquidación (§03.9.6). El aviso del POS sale de `ordenes.mesa_id`, no de la liquidación (§11, B5) |
| Mesa liberada vacía (`pos.html:2578-2593`) | «Sin orden», o «cerrada» si tiene `o` | El DELETE de la orden abierta emite |
| POS sin red, con deltas en cola (`pos.html:2342-2360`) | La cuenta se atrasa. «Leída hace X s» dice cuándo se leyó, **no** si el POS está al día | No se puede presentar con la cola llena (§03.4.2) |
| 429 | La última cuenta, con «Muchas consultas, reintentando…» | Respeta `Retry-After` |
| Varios teléfonos en la mesa | Todos ven lo mismo. Cada uno puede reportar su pago | `pedir` es idempotente y los reportes se acumulan |
| El cliente transfirió y luego la cuenta cambió | Su reporte queda, con «sin confirmar», junto a «Falta según la cuenta» | `reportar_pago` acepta sin vigencia. El POS avisa «hay pagos reportados» al agregar ítems |
| `liquidar` con una orden que cambió | «Tu cuenta cambió, revísala» | 409 `orden_cambio` o `cuenta_cambio`, y la carta lee de nuevo |
| Código bloqueado | «Pídele al mesero que vuelva a presentar la cuenta» | `presentar` genera un código nuevo y pone los fallos en 0 |
| Datos de pago sin cargar | «Paga con el mesero: efectivo o datáfono» | `pagos: []`. Se puede pedir y presentar la cuenta igual |
| Interruptor `liquidar` apagado | Solo la fase 1: ver la cuenta | `cuenta` devuelve `liquidar_activo:false` y `liquidar` responde 503 `apagado` |

### 03.12 Operación diaria

- **Al abrir (12:00):** tocar cada pegatina con un teléfono y **leer el dominio en la barra de direcciones**: `resplandor.ynt.codes`. Mirarla no basta, porque un clon pinta la misma página (§11, SD1). Pasar la uña por el borde para notar una pegatina encima.
- **Cartel en el mostrador**, impreso por Camila: la llave Bre-B, el titular y el QR del banco. Es el segundo canal con el que el cliente compara.
- **Plan B siempre:** efectivo, datáfono y la carta física. El aviso de propina va en la entrada (D10). La pegatina complementa, no reemplaza (CU 2.4).
- **Si una pegatina se pierde o se sospecha de ella:** «Enlace NFC → Rotar» en el POS y reescribirla con la contraseña.

---

## 04 — Arquitectura

### 04.1 Tiempo real: decisión

**Se elige un trigger en `ordenes`, `liquidaciones` y `mesas` que llama a `realtime.send` hacia un tópico público derivado del token, con una señal sin datos (d2). El cliente vuelve a leer la cuenta en `cuenta`, y un sondeo de seguridad cada 60 s detecta si el canal está mudo.**

| Opción | Seguridad | Latencia | Cupo Free | Complejidad | Veredicto |
|---|---|---|---|---|---|
| (a) Sondear `cuenta` más rápido | Igual que hoy | N/2 + ~0,4 s | Es el cuello: a 5 s, el techo es 1.080.000 invocaciones al mes (216 %) | Ninguna | Solo de respaldo |
| (b) Broadcast desde el POS | Anon puede publicar en canales públicos | ~6 ms (benchmark de Supabase) | Bajo | Toca **cada** camino de escritura de `pos.html` (`:2331`, `:2445`, `:2589`, `:2835`). No es atómico con la escritura | No |
| (c) `postgres_changes` para anon | Exige SELECT sobre `ordenes` para anon, contra `README.md:227-229` | Baja | — | — | No |
| (d1) Trigger con tópico **privado** y policy para anon | La mejor: nadie puede publicar | ~46 ms (benchmark) + ~0,4 s de lectura | ~1,9 % | Policy sobre `realtime.messages` | **Pendiente de la prueba S-0.** La doc dice «Private (`true`) → Only authenticated clients can subscribe» (https://supabase.com/docs/guides/realtime/broadcast) |
| **(d2) Trigger con tópico público `cuenta:<sha256(token)>` y payload `{}`** | Equivale al sondeo: quien conoce el tópico ya conocía el token. Por el canal no viaja ningún dato. Una señal falsa solo provoca una lectura, y la cubeta la acota | Igual que d1 | ~1,9 % de mensajes y ~12 % de invocaciones (§07) | Una migración y unas 80 líneas en `carta.html` | **Elegida** |
| SSE desde una Edge Function | — | — | Pared de 150 s en Free (functions/limits) | La función tendría que sondear por dentro | No |

Por qué funciona d2:

- **Una sola fuente de datos.** Todo dato del cliente sale de `cuenta`, que valida el token y sanea la respuesta (`cuenta/index.ts:79-115`).
- **Cubre todos los caminos.** El trigger atrapa RPC, upsert y DELETE, incluida la cola offline cuando se vacía.
- **Sin problemas de orden.** La lectura siempre trae el estado actual.
- **Nada guardado.** `realtime.messages` retiene las filas 3 días (realtime/broadcast) y el payload va vacío.
- **Se vigila a sí mismo.** El sondeo de seguridad de 60 s compara la `marca` (§03.2.7): una señal perdida no deja la cuenta congelada.
- **Depende de que «Allow public access» siga encendido.** Lo usa el POS (`pos.html:2048-2054`). Si algún día se pasa a «solo privados», este canal se migra junto con el POS (R5).
- **Si S-0 pasa** (anon se une a un canal privado con policy), se cambia a d1 sin tocar la carta: `cuenta` devuelve `canal.privado:true` y la carta abre el canal con `private:true`.

### 04.2 Migración de fase 1: `20261001120000_cuenta_en_vivo.sql`

Es un **boceto sin probar**; la parte 1A lo cierra y lo prueba.

```sql
create schema if not exists privado;            -- fuera de PostgREST (solo expone public)
revoke all on schema privado from public, anon, authenticated;

-- Única derivación del tópico. `cuenta` la replica en JS con el mismo vector de prueba.
create or replace function privado.topico_cuenta(p_token text) returns text
  language sql immutable set search_path = ''
as $$ select 'cuenta:' || encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

create or replace function privado.emitir_cuenta() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare v_mesas int[] := '{}'; v_mesa int; v_token text;
begin
  begin                                               -- NUNCA romper la escritura del POS
    if tg_table_name = 'mesas' then
      if new.token is distinct from old.token then   -- el upsert del POS reenvía el token igual
        perform realtime.send('{}'::jsonb, 'cambio', privado.topico_cuenta(old.token), false);
      end if;
      return null;
    end if;

    if tg_table_name = 'ordenes' then
      -- Solo lo que estaba o queda abierto: se ignoran la purga de cerrarDia (pos.html:2835)
      -- y el INSERT ya cerrado del cobro parcial (pos.html:2505).
      if tg_op = 'INSERT' then
        if new.estado = 'abierta' then v_mesas := array[new.mesa_id]; end if;
      elsif tg_op = 'DELETE' then
        if old.estado = 'abierta' then v_mesas := array[old.mesa_id]; end if;
      elsif old.estado = 'abierta' or new.estado = 'abierta' then
        v_mesas := array[old.mesa_id, new.mesa_id];   -- reabrirOrden puede cambiar de mesa
      end if;
    elsif tg_op <> 'DELETE' then                      -- liquidaciones (fase 2)
      -- La mesa sale de la ORDEN, no de la liquidación (una orden reabierta cambia de mesa).
      select array[o.mesa_id] into v_mesas from public.ordenes o where o.id = new.orden_id;
    end if;

    -- coalesce: FOREACH sobre NULL lanza error
    foreach v_mesa in array coalesce(
        (select array_agg(distinct x) from unnest(v_mesas) x where x is not null), '{}') loop
      select token into v_token from public.mesas where id = v_mesa;
      if v_token is not null then
        perform realtime.send('{}'::jsonb, 'cambio', privado.topico_cuenta(v_token), false);
      end if;
    end loop;
  exception when others then
    raise warning 'emitir_cuenta: %', sqlerrm;        -- se pierde la señal (la carta lo detecta), NO la orden
  end;
  return null;
end $$;

revoke all on function privado.emitir_cuenta() from public, anon, authenticated;
revoke all on function privado.topico_cuenta(text) from public, anon, authenticated;

create trigger ordenes_emite_cuenta after insert or update or delete on public.ordenes
  for each row execute function privado.emitir_cuenta();
create trigger mesas_emite_cuenta after update of token on public.mesas
  for each row execute function privado.emitir_cuenta();

-- Reversa en < 1 min (Línea Roja). La carta cae sola a sondeo (§03.2.7):
--   drop trigger ordenes_emite_cuenta on public.ordenes;
--   drop trigger mesas_emite_cuenta on public.mesas;
--   drop schema privado cascade;   -- en fase 2, solo los dos triggers: privado ya tiene más objetos
```

- `realtime.send(payload, event, topic, is_private)` captura sus propios errores (realtime/concepts). El bloque `exception` cubre además los errores del propio trigger. **Sin esa protección, un fallo del trigger impediría escribir órdenes.** Por eso se aplica después de las 17:00, con la reversa a mano.
- `extensions.digest` viene de pgcrypto (carta_publica_y_token_mesa.sql:53).
- No se agregan policies en `realtime.messages` ni GRANT a anon.
- **Migración aparte de 1D, solo si D17 es sí:** `20261001130000_presencia_privada.sql`. Agrega policies `select` e `insert` en `realtime.messages` para `authenticated`, con `extension = 'presence'`, `realtime.topic() = 'presencia_pos'` y proveedor `google`. La reversa es borrar las dos policies y revertir el commit de 1D.

### 04.3 Contrato: `GET /functions/v1/cuenta` (extendida, compatible con la carta de hoy)

**Request:** `GET ?m=<\d{1,4}>&k=<[0-9a-f]{32,64}>[&o=<orden_id>]`, con las cabeceras de hoy: `apikey` y `Authorization: Bearer <publishable>` (`carta.html:527-528`). `o` es el `orden_id` que la pestaña ya estaba mirando.

**CORS** (§11, SD1):

- `Access-Control-Allow-Origin` devuelve el `Origin` solo si es `https://resplandor.ynt.codes`, más `http://localhost:<puerto>` para desarrollo. Va con `Vary: Origin`.
- Sin un origen permitido, no se manda la cabecera. El navegador de un clon no puede leer la respuesta.
- No impide un *proxy* del lado del servidor del atacante: es una capa más, no la defensa.

**Respuesta 200 con la orden abierta.** Es plana y **conserva los campos de hoy** (`abierta`, `items`, `total`, `abierta_en`), para que la `carta.html` publicada siga funcionando durante el despliegue.

```json
{
  "mesa": 3,
  "estado": "abierta",
  "abierta": true,
  "orden_id": "<id de la orden>",
  "marca": "14.0",
  "abierta_en": "<ISO>",
  "actualizada_en": "<ISO>",
  "items": [{ "nombre": "<producto>", "precio": 5000, "cantidad": 2 }],
  "total": 10000,
  "canal": { "topico": "cuenta:<64 hex>", "evento": "cambio", "privado": false },
  "liquidar_activo": false,
  "liquidacion": null,
  "servidor_en": "<ISO>"
}
```

| Campo | Regla |
|---|---|
| `estado` | Vale `abierta`, `sin_orden` o `cerrada`. **`cerrada` solo sale cuando llega `o`** y `o` ya no es la orden abierta de esa mesa: cerrada, borrada o movida. En ese caso solo se devuelven `mesa`, `estado`, `abierta:false`, `pago_confirmado` (la liquidación de `o` está `confirmada`), `canal` y `servidor_en`, sin ítems y sin decir si hay otra orden. Sin `o`, se responde con la orden abierta |
| `abierta` | `estado === 'abierta'`. Se mantiene para la carta de hoy |
| `orden_id`, `actualizada_en` | `ordenes.id` y `ordenes.updated_at` (base.sql:110-123) |
| **`marca`** | `"<ordenes.version>.<epoch de liquidaciones.updated_at o 0>"`. En `sin_orden` vale `"0"`. Sirve para detectar el canal mudo (§03.2.7) |
| `items` | `{nombre, precio, cantidad}`, **sin notas ni ids** (`cuenta/index.ts:100-105`), **agrupados por (nombre, precio)** y sumando la cantidad, en el orden de su primera aparición. Las 8 combinaciones del «Menú Resplandor» (`pos.html:2374-2381`) ya no salen como líneas repetidas (§11, B2) |
| `canal` | Lo calcula el servidor con la misma fórmula que `privado.topico_cuenta`. `privado` vale `false` mientras S-0 no pase |
| `liquidar_activo` | Lee `ajustes_cuenta.activo` donde `clave = 'liquidar'` (§04.5). En fase 1 siempre vale `false` |
| `liquidacion` (fase 2) | `null` o `{estado, vigente, total_a_pagar, propina_sugerida, propina_pct, pide_codigo, codigo_bloqueado, reportes:[{metodo, monto, vigente, en}], reportado_total, puede_cancelar, pedida_en}`. **Nunca** trae el código, los datos de pago ni las referencias |
| `servidor_en` | Para calcular «hace X s» sin depender del reloj del teléfono |

**Errores.** Todos llevan `{error, codigo}`.

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `formato` | `m`, `k` u `o` con un formato inválido. `o` debe cumplir `^[A-Za-z0-9_-]{1,64}$` |
| 403 | `origen` | Un `Origin` presente que no está en la lista |
| 404 | `enlace_invalido` | El par `(m,k)` no existe, por ejemplo porque se rotó el token |
| 405 | `metodo` | Cualquier método que no sea GET u OPTIONS |
| 429 | `demasiadas` | Lleva `Retry-After` |
| 500 | `interno` | — |

**Rate-limit** (§11, M3). Reemplaza el de 40 por minuto por IP (`cuenta/index.ts:36`):

- **120 por minuto por (IP, mesa)**: son 3 o 4 teléfonos de la misma mesa detrás del wifi del local;
- **600 por minuto por IP**;
- **más de 20 respuestas 404 por minuto desde una IP para una misma mesa** bloquean esa pareja (IP, mesa) 10 minutos, para frenar el barrido de tokens de esa mesa. Es por pareja y no por IP porque todo el local sale por la misma IP: con un bloqueo por IP, 21 enlaces inventados dejaban sin «Mi cuenta» a todas las mesas durante 10 minutos (refutación de la fase 1, H4). Con un token de 192 bits el barrido no es viable de todos modos; el bloqueo solo acota el ruido, y la IP entera sigue acotada por los 600 por minuto.

Sigue en la memoria del isolate, con el mismo aviso de hoy (`cuenta/index.ts:32-33`). Toma el primer valor de `x-forwarded-for` (`:68`). Si la plataforma deja pasar el XFF que manda el cliente, este límite se esquiva (§10). Por eso los topes que importan viven en la base (§03.1).

**Código compartido.** Va en `supabase/functions/_compartido/mesa.js`: CORS con lista, `json`, validadores, limitador, `topicoCuenta` con `crypto.subtle` y `agruparItems`. Es **JS plano**, para que `node --test` lo pruebe sin Deno: en esta máquina no hay Deno ni supabase CLI. El guion bajo sigue la convención de Supabase para código compartido (https://supabase.com/docs/guides/functions/development-tips).

**En fase 2**, `cuenta` lee todo en **una** llamada a `public.cuenta_cliente(p_mesa, p_token, p_orden_vista)`. Es `security invoker` y solo `service_role` la puede ejecutar. Devuelve el JSON de arriba menos `canal` y `servidor_en`, en un solo *snapshot*.

### 04.4 Contrato: `POST /functions/v1/liquidar` (nueva, fase 2)

- Se despliega con `--no-verify-jwt`, como `votar` y `cuenta`.
- Solo acepta POST y OPTIONS, con `Content-Type: application/json` y un cuerpo de hasta 1 KB.
- Usa el mismo CORS con lista que `cuenta`.
- Si `ajustes_cuenta.liquidar` está apagado, responde 503 `apagado` antes de tocar nada más.

```json
{ "m": 3, "k": "<token>", "orden_id": "<id>", "accion": "pedir" }
{ "m": 3, "k": "<token>", "orden_id": "<id>", "accion": "cancelar" }
{ "m": 3, "k": "<token>", "orden_id": "<id>", "accion": "ver_pagos", "codigo": "<4 dígitos>" }
{ "m": 3, "k": "<token>", "orden_id": "<id>", "accion": "reportar_pago", "codigo": "<4 dígitos>",
  "metodo": "breb", "monto": 50600, "referencia": "<opcional>" }
```

| Campo | Regla |
|---|---|
| `accion` | `pedir`, `cancelar`, `ver_pagos` o `reportar_pago` |
| `codigo` | `^[0-9]{4}$`. Obligatorio en `ver_pagos` y `reportar_pago` |
| `metodo` | `breb` o `bancolombia`, y activo en `medios_pago`. Si no, 422 `metodo_inactivo` |
| `monto` | Entero entre 1 y `2 × total_presentado`. Si no, 422 `dato_invalido` |
| `referencia` | Opcional, `^[A-Za-z0-9-]{1,24}$` |

**Respuestas 200:**

- `pedir`, `cancelar` y `reportar_pago` devuelven `{ "ok": true, "liquidacion": { …la misma forma que en cuenta… } }`.
- `ver_pagos` devuelve además `pagos`, en el orden de `medios_pago.orden`:
  - `{id:'breb', titulo, titular, llave, tipo_llave, instrucciones}`;
  - `{id:'bancolombia', titulo, titular, tipo_cuenta, numero, instrucciones}`.
  - Si no hay filas activas, `[]`.

**Errores** (todos con `{error, codigo}`):

| HTTP | `codigo` |
|---|---|
| 400 | `formato` |
| 403 | `origen`; `codigo_incorrecto` (con `intentos_restantes`); `codigo_bloqueado` |
| 404 | `enlace_invalido` |
| 409 | `orden_cambio` (el `orden_id` ya no es la orden abierta de esa mesa), `no_pedida`, `no_presentada`, `ya_presentada`, `cuenta_cambio` (solo `ver_pagos`, sin vigencia) o `ya_confirmada` |
| 413 | `cuerpo` |
| 415 | `tipo` |
| 422 | `dato_invalido`, `metodo_inactivo` |
| 429 | `demasiadas` (memoria) o `tope` (5 `pedir`, 8 reportes; en la base) |
| 503 | `apagado` |
| 500 | `interno` |

**Rate-limit en memoria:** 10 por minuto por (IP, mesa) y 60 por minuto por IP.

**Implementación.** La función valida formato, origen y rate-limit, y llama a **una sola** función SQL, `public.liquidacion_cliente(...)` (§04.5). Traduce su `codigo` a HTTP. Nunca toca tablas directamente.

### 04.5 Modelo de datos de fase 2: migración `20261005120000_liquidaciones.sql`

**Boceto sin probar; la parte 2A lo cierra.**

```sql
-- 1. Liquidación: una fila por orden. Sin mesa_id: la mesa sale siempre de la orden (B5).
create table public.liquidaciones (
  orden_id           text primary key references public.ordenes(id) on delete cascade,
  estado             text not null check (estado in ('pedida','presentada','pago_reportado','confirmada','anulada')),
  pedidos            smallint not null default 0 check (pedidos between 0 and 5),
  pedida_en          timestamptz,
  aviso_atendido_en  timestamptz,
  presentada_en      timestamptz,
  presentada_por     uuid,                                     -- auth.uid()
  total_presentado   integer check (total_presentado >= 0),
  propina_sugerida   integer check (propina_sugerida >= 0),
  codigo             text check (codigo ~ '^[0-9]{4}$'),       -- lo ve el POS; cuenta/liquidar NUNCA lo devuelven
  codigo_fallos      smallint not null default 0 check (codigo_fallos between 0 and 5),
  reportes           jsonb not null default '[]'::jsonb
                       check (jsonb_typeof(reportes) = 'array' and jsonb_array_length(reportes) <= 8),
                       -- [{n, metodo, monto, referencia, total_ref, vigente, en}], solo se agrega
  ultimo_reporte_en  timestamptz,
  confirmada_en      timestamptz,
  confirmada_por     uuid,
  metodo_confirmado  text check (metodo_confirmado in ('breb','bancolombia','efectivo','datafono','mixto')),
  monto_recibido     integer check (monto_recibido >= 0),
  propina_confirmada integer check (propina_confirmada >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index liquidaciones_activas on public.liquidaciones (estado)
  where estado in ('pedida','presentada','pago_reportado');
create trigger trg_liquidaciones_updated_at before update on public.liquidaciones
  for each row execute function public.tocar_updated_at();         -- base.sql:143-152
create trigger liquidaciones_emite_cuenta after insert or update on public.liquidaciones
  for each row execute function privado.emitir_cuenta();          -- §04.2

-- 2. Lo que el cierre necesita para cuadrar caja y propinas (Ley 1935, art. 5).
alter table public.ordenes
  add column if not exists medio_pago text check (medio_pago in ('breb','bancolombia','efectivo','datafono','mixto')),
  add column if not exists propina integer check (propina >= 0);

-- 3. Datos de pago PÚBLICOS para el cliente. Se crea VACÍA. Las filas las inserta Yonatan
--    en el SQL Editor con lo que dé Camila; nunca un agente. Sin QR (D2, SD8).
create table public.medios_pago (
  id            text primary key check (id in ('breb','bancolombia')),
  activo        boolean not null default false,
  orden         smallint not null default 0,
  titulo        text not null check (char_length(titulo) between 1 and 40),
  titular       text not null check (char_length(titular) between 1 and 80),
  llave         text check (char_length(llave) between 1 and 80),
  tipo_llave    text check (tipo_llave in ('alfanumerica','celular','correo','documento','comercio')),
  tipo_cuenta   text check (tipo_cuenta in ('ahorros','corriente')),
  numero_cuenta text check (numero_cuenta ~ '^[0-9-]{6,20}$'),
  instrucciones text check (char_length(instrucciones) <= 280),
  updated_at    timestamptz not null default now(),
  check (id <> 'breb'        or (llave is not null and tipo_llave is not null)),
  check (id <> 'bancolombia' or (tipo_cuenta is not null and numero_cuenta is not null))
);

-- 4. Interruptor de la fase 2 (SD11): apagado hasta que el POS (2D+2E) esté al aire.
create table public.ajustes_cuenta (
  clave      text primary key check (clave in ('liquidar')),
  activo     boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.ajustes_cuenta (clave, activo) values ('liquidar', false) on conflict do nothing;

-- 5. Lista blanca del personal para las RPC de dinero (D15). Se crea VACÍA: la carga Yonatan.
create table privado.personal (email text primary key check (email = lower(email)));
create or replace function privado.es_personal() returns boolean
  language sql stable security definer set search_path = ''
as $$ select coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
         and exists (select 1 from privado.personal p
                      where p.email = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;
-- Si D15 es «no», la función queda solo con la primera condición.
```

**Funciones.** Todas usan `search_path = ''` y devuelven `jsonb` con `{ok, codigo, …}`. Devolver en vez de lanzar sirve para que el contador de fallos del código se guarde aunque el resultado sea un error.

| Función | Seguridad | EXECUTE | Qué hace |
|---|---|---|---|
| `liquidacion_cliente(p_mesa int, p_token text, p_orden_id text, p_accion text, p_codigo text, p_metodo text, p_monto int, p_referencia text)` | **`security invoker`**: corre como `service_role`. Si alguien la llamara como anon, no tendría GRANT sobre ninguna tabla (§11, SD6) | `revoke all … from public, anon, authenticated`; `grant … to service_role` | Busca la orden `where o.id = p_orden_id and o.mesa_id = p_mesa and m.token = p_token and o.estado = 'abierta' for update of o`, con *join* a `mesas`. **La mesa sale de la orden**, nunca del parámetro. Aplica la tabla de §03.1 y los topes. Compara el código y, si falla, suma a `codigo_fallos`. Agrega reportes. Solo lee `medios_pago` en `ver_pagos`. **No toca `ordenes` ni `mesas`** |
| `cuenta_cliente(p_mesa int, p_token text, p_orden_vista text)` | `security invoker` | Solo `service_role` | La lectura de §04.3 en un solo *snapshot* |
| `presentar_cuenta(p_orden_id text, p_total_visto int)` | `security definer` | `revoke … from public, anon`; `grant … to authenticated` | Exige `privado.es_personal()`. Bloquea la orden. Exige `abierta` y `round(total) = p_total_visto`; si no, `cuenta_cambio`. Fija `total_presentado` y `propina_sugerida = floor(total × 0,10 / 100) × 100`. Genera el código con `extensions.gen_random_bytes` si no hay o está bloqueado, y pone los fallos en 0. **Conserva los reportes**. Devuelve `{codigo, total_presentado, propina_sugerida}` |
| `atender_aviso(p_orden_id text)` | `security definer` | `authenticated` | Exige personal. Pone `aviso_atendido_en = now()` |
| `confirmar_y_cerrar(p_orden_id text, p_total_visto int, p_metodo text, p_monto int)` | `security definer` | `authenticated` | Ver el boceto de abajo |
| `anular_liquidacion(p_orden_id text)` | `security definer` | `authenticated` | Exige personal. Pasa a `anulada` y **limpia `ordenes.medio_pago` y `ordenes.propina`**, con `version + 1` (§11, M1). La usa también `reabrirOrden` |

Son `security definer` y no `invoker` como `aplicar_delta_orden` (base.sql:155-159) por una razón. Así `authenticated` solo necesita SELECT sobre `liquidaciones` y no puede saltarse la máquina de estados escribiendo la tabla directo. Cada una revisa `privado.es_personal()`, porque se salta la RLS.

```sql
-- Boceto: confirmar y cerrar en UNA transacción (SD2, A4).
create or replace function public.confirmar_y_cerrar(
  p_orden_id text, p_total_visto integer, p_metodo text, p_monto integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.ordenes; l public.liquidaciones; v_total integer;
begin
  if not privado.es_personal() then return jsonb_build_object('ok',false,'codigo','no_autorizado'); end if;
  if p_metodo is null or p_metodo not in ('breb','bancolombia','efectivo','datafono','mixto')
     or p_monto is null or p_monto < 0 then
    return jsonb_build_object('ok',false,'codigo','dato_invalido');
  end if;
  select * into o from public.ordenes where id = p_orden_id for update;
  if not found then return jsonb_build_object('ok',false,'codigo','orden_no_existe'); end if;
  select * into l from public.liquidaciones where orden_id = p_orden_id for update;
  if o.estado = 'cerrada' then                                   -- reintento tras respuesta perdida
    if l.estado = 'confirmada' and l.metodo_confirmado = p_metodo and l.monto_recibido = p_monto then
      return jsonb_build_object('ok',true,'repetida',true,'orden',to_jsonb(o));
    end if;
    return jsonb_build_object('ok',false,'codigo','ya_cerrada');
  end if;
  v_total := round(o.total);
  if v_total <> p_total_visto then
    return jsonb_build_object('ok',false,'codigo','cuenta_cambio','total_actual',v_total);
  end if;
  if p_monto < v_total then
    return jsonb_build_object('ok',false,'codigo','monto_insuficiente','falta',v_total - p_monto);
  end if;
  update public.ordenes
     set estado = 'cerrada', cerrada_en = now(), medio_pago = p_metodo,
         propina = p_monto - v_total, version = version + 1
   where id = p_orden_id returning * into o;
  update public.mesas set estado = 'libre' where id = o.mesa_id;
  insert into public.liquidaciones as x (orden_id, estado, confirmada_en, confirmada_por,
         metodo_confirmado, monto_recibido, propina_confirmada)
  values (p_orden_id, 'confirmada', now(), auth.uid(), p_metodo, p_monto, p_monto - v_total)
  on conflict (orden_id) do update
     set estado = 'confirmada', confirmada_en = excluded.confirmada_en,
         confirmada_por = excluded.confirmada_por, metodo_confirmado = excluded.metodo_confirmado,
         monto_recibido = excluded.monto_recibido, propina_confirmada = excluded.propina_confirmada;
  return jsonb_build_object('ok',true,'orden',to_jsonb(o),'propina',p_monto - v_total);
end $$;
```

**RLS y GRANT.** Siguen los patrones de base.sql:242-307.

| Objeto | anon | authenticated | service_role |
|---|---|---|---|
| `liquidaciones` | Nada | Policy `for select using (true)` y la restrictiva `solo_google`. **Solo `select`**: se escribe por RPC | `select, insert, update` |
| `medios_pago` | Nada | **Nada**: ningún mesero puede cambiar a dónde va la plata (`README.md:72`, no hay roles) | Solo `select` |
| `ajustes_cuenta` | Nada | `select`, con `solo_google` | `select` |
| `privado.personal` | Nada (esquema revocado) | Nada | Nada. Solo la lee `es_personal()` como dueña |
| `ordenes.medio_pago` y `propina` | — | Cubiertas por el GRANT de `ordenes`. **`formatOrden` no las manda**, así que solo las escriben las RPC | Cubiertas |
| Publicación | — | `alter publication supabase_realtime add table public.liquidaciones`, para el POS | — |

**La propina sugerida se calcula en un solo lugar,** `presentar_cuenta`:

- `floor(base × 0,10 / 100) × 100`, redondeando **hacia abajo** a la centena para no pasar nunca del 10 % (§06).
- Por ahora `base = total`. Si Camila confirma que es responsable de impoconsumo y elige la base sin impuesto, pasa a `round(total / 1,08)` (D4).

**La propina confirmada no es un parámetro:** es `monto − total`, calculada en SQL (§11, SD7).

**Ciclo de vida.** `cerrarDia` borra las órdenes (`pos.html:2835`) y, con ellas, las liquidaciones en cascada: es minimización de datos. El medio y la propina sobreviven en `cierres.transacciones`, porque el cierre copia el objeto de la orden (`pos.html:2812`) y `parseOrden` los mapea (§04.8).

### 04.6 Dónde viven los datos de pago

| Dónde | A favor | En contra | Veredicto |
|---|---|---|---|
| `assets/js/local.js` | Versionado | **El repo es público**. `local.js` alimenta la landing, los agentes y el MCP (`local.js:1-10`) | No |
| Un archivo estático aparte | Lo carga solo `carta.html` | También queda en el repo público y en Pages | No |
| Una tabla editable desde el POS | Cómoda | Cualquier cuenta del POS podría poner su llave: no hay roles | No |
| Secretos de la Edge Function | Fuera del repo | Sin rastro de cambios. Hay que esperar a que la función arranque de nuevo | Posible, peor |
| **La tabla `medios_pago`, sin GRANT para anon ni authenticated, servida solo detrás del código** | Fuera del repo. Solo la ve quien está en la mesa con la cuenta presentada. Solo la cambia Yonatan. Guarda `updated_at`. Encender o apagar no exige desplegar | Un paso manual en el SQL Editor | **Sí** |

El interruptor de la fase 2 también vive en la base (`ajustes_cuenta`) y no en `local.js`. Hay tres razones:

1. Se apaga en segundos con un `update`, sin desplegar Pages.
2. Lo leen las dos funciones, que son la puerta real.
3. No arrastra a `descubrimiento.mjs` ni a la prueba que fija las banderas (`scripts/pruebas/funciones.test.mjs:57`).

### 04.7 Cambios en `carta.html`

| Fase | Cambio | Dónde engancha |
|---|---|---|
| 1 | Carga diferida de supabase-js 2.117.2 (la de `menu.html:45`), con `document.createElement('script')`, `integrity="sha384-…"` y `crossorigin="anonymous"`. **SRI también en Alpine** (`carta.html:41`). 1C calcula los *hashes* del archivo exacto (§11, SD10) | `carta.html:39-41` |
| 1 | `<meta name="referrer" content="no-referrer">` | `<head>` |
| 1 | Máquina de conexión: estados `vivo`, `sondeo`, `sin_red` y `vencido`. Canal, *debounce* de 400 ms, cubeta de 6 lecturas que recarga 1 cada 10 s, sondeo de seguridad de 60 s con detección por `marca`, cierre a los 60 s oculta. **Sin `canal` en la respuesta se queda en sondeo**: es compatible con la `cuenta` de hoy | Reemplaza el `setInterval` de `carta.html:514-520`. `cargarCuenta` (`:521-538`) suma `o` y los campos nuevos |
| 1 | `o`: se guarda en memoria y en `sessionStorage['cuenta:'+mesa]`. Al cargar, se recupera **solo** si `performance.getEntriesByType('navigation')[0].type` es `reload` o `back_forward` | `init()`, `carta.html:416-420` |
| 1 | Estados nuevos de la hoja, `cerrada` y `vencido`, además de `cargando`, `error`, `vacia` y `ok` | Marcado del sheet, `carta.html:271-337` |
| 1 | El rótulo «**Consumo en vivo · no es factura**». «Leída hace X s». Pastilla de conexión con texto, no solo color. `role="status" aria-live="polite"` con «Se agregó…», calculado por diferencia de grupos. Resaltado que respeta `prefers-reduced-motion` | Encabezado y lista del sheet |
| 1 | La barra fija muestra el total: «Ver mi cuenta · Mesa 3 · $ 45.000» | `carta.html:256-260` |
| 1 | La propina calculada en el navegador (`carta.html:320`) se queda en fase 1 con su texto y se va en fase 2 | `carta.html:319-326` |
| 2 | Solo con `liquidar_activo`: «Pedir la cuenta» con confirmación, `pedida` con «Ya no la quiero» y el aviso de 2 min, «Total a pagar», la propina (3 opciones), «Ver a dónde transferir» con el código, los bloques Bre-B y Bancolombia con «Copiar», «Ya pagué» con el monto, la lista de reportes con «Falta según la cuenta», y «Pago confirmado» | Pie y cuerpo del sheet (`carta.html:330-335`) |
| 2 | `sessionStorage['liq:'+orden_id]` guarda la propina elegida y el código | — |
| 2 | Todo dato del servidor se pinta con `x-text`, nunca con `x-html`. **Ningún dato de pago se lee de la URL** | — |
| 1 y 2 | Iconos nuevos (copiar, check, señal) con `node scripts/iconos.mjs`, y clases nuevas con `node scripts/css.mjs` | El sprite de `carta.html:45+` y `assets/css/resplandor.css` |

### 04.8 Cambios en `pos.html`

`tarea/pos-visual` ya commiteó su base (`b242a2b`, con +1.143 y −1.000 líneas en `pos.html` frente a `3bae016`). Sus 4 partes están en worktrees propios (`git worktree list`, 2026-09-30). Su especificación fija que los dos `<script>` (`pos.html:1652-3091` y `:4392-4408`) quedan **byte a byte iguales** y que ninguna parte toca `<script>` (`docs/pos-visual.md` §4.2 y §5). `git merge-tree` de esta rama con `tarea/pos-visual` sale limpio (2026-09-30).

**Consecuencia:** la lógica (dentro del `<script>`) puede ir ya; el marcado espera el merge de pos-visual.

| Parte | Cambio | Dónde engancha | Tamaño |
|---|---|---|---|
| **1D** | `pushASupabase('mesas')` manda solo `{id, capacidad, estado}`, nunca `token`. Hoy sube la fila local completa (`:2133-2138`), y una tablet con caché vieja **deshace una rotación** | `pos.html:2130-2144` | ~4 líneas |
| **1D** | `rotarTokenMesa` hace `update({token}).eq('id', …)` con `await` y revisa `error`. Si falla, revierte el token local y avisa; hoy lo traga `.catch(()=>{})` (`:2618`). Luego dice «Reescribe la pegatina con la contraseña» | `pos.html:2612-2619` | ~8 líneas |
| **1D** | `.subscribe(estado => …)` de `pos_sync`: al reconectar llama a `sincronizarSupabase()`. Hoy no tiene callback (`:2053`) | `pos.html:2048-2054` | ~6 líneas |
| **1D** (si D17) | `presencia_pos` con `config: { private: true, presence: {key} }` | `pos.html:2089-2092` | 1 línea |
| **1D** (refutación, H1) | `flushDeltas()` con candado: un solo vaciado de la cola de deltas a la vez en todo el POS (`aplicar_delta_orden` no es idempotente). Una llamada que llega durante un vaciado lo espera y pide una vuelta más. Pendiente a futuro: una llave de idempotencia por delta en la RPC, que también cubre una respuesta perdida | `flushDeltas`, `_vaciarCola` | ~25 líneas |
| **1D** (refutación, H2 y H3) | La resincronización **fusiona** la lectura con lo que la tablet aún no subió, en vez de pisar la lista. `pushASupabase` marca `ordenes`, `mesas` y `productos` en `_pendientes` (guardado en `localStorage`) mientras la subida no está confirmada, y devuelve `false` si el POS está offline. Una orden local se conserva si tiene deltas en cola, si su subida está pendiente o si su `version` es mayor que la de la lectura. Una orden pendiente que la base no devuelve se conserva y se vuelve a subir (sin ítems y con `ignoreDuplicates` si tiene deltas en cola, para no contarlos dos veces), salvo que la base ya tenga otra orden abierta en esa mesa. `cerrarDia()` guarda en el cierre las órdenes por purgar (`purgar`, solo local): no vuelven a las ventas de hoy hasta que la base las borre, y «Reintentar» las purga | `sincronizarSupabase`, `_fusionar…`, `_subirLoPendiente` | ~150 líneas |
| **2D** | `parseOrden` mapea `medio_pago → medioPago` y `propina`. **`formatOrden` NO los incluye** | `pos.html:1957-1972` | 2 líneas |
| **2D** | La colección `liquidaciones` con `parseLiquidacion` (`id: row.orden_id`, porque `procesarCambioEnVivo` busca por `id`, `:2070`). Se carga en `sincronizarSupabase` (`:2016-2034`) y se escucha en `pos_sync`. También lee `ajustes_cuenta` | Store | ~30 líneas |
| **2D** | Getters: `liquidacionDe(ordenId)` y `liquidacionActiva(orden)`. `avisoDeMesa(mesaId)` sale de la orden **abierta** de esa mesa, no de la liquidación. `avisosPendientes`: solo `pedida` o `pago_reportado` sin atender y con la orden abierta (§11, M2). `propinasHoy`, `propinasDeCierre(c)` | Junto a `ordenesAbiertas` (`:2217`) | ~25 líneas |
| **2D** | Acciones con `await`, `error` y `data.ok` revisados, y error que bloquea si fallan. Ninguna tiene cola offline: exigen red | Junto a `facturar` (`:2445`) | ~70 líneas |
| | · `presentarCuenta()`: hace `flushDeltas`, se niega con la cola llena y manda `total_visto` | | |
| | · `atenderAviso()` | | |
| | · `confirmarYCerrar({metodo, monto})`: con `ok`, refleja en local igual que `facturar()` **sin push** | | |
| | · `anularLiquidacion()` | | |
| **2D** | `facturar()`: con una liquidación activa abre «Confirmar pago y cerrar» en lugar de cerrar | `pos.html:2445` | ~4 líneas |
| **2D** | `reabrirOrden`: antes llama a `anular_liquidacion` y aborta si falla | `pos.html:2689-2745` | ~6 líneas |
| **2D** | Pitido corto con WebAudio (sin archivo) y `document.title` con el número de avisos, solo con el POS visible (D11). Aviso «Esta mesa tiene pagos reportados» al agregar ítems a una orden en `pago_reportado` | Store | ~20 líneas |
| **2E** | Insignia en la tarjeta de mesa (patrón `.mesa-presence`, `:3247-3251`) | Mapa de mesas | ~10 líneas |
| **2E** | Píldora «N avisos» con `.nav-pill-aviso` | Barra (`:3152-3160`) | ~8 líneas |
| **2E** | Banner `.aviso-atencion` en la orden, con Presentar, Confirmar, Atendido y el menú Anular | Junto a `ordenReabiertaAviso` (`:3415-3419`) | ~25 líneas |
| **2E** | Modal «Presentar cuenta» (código grande y pregunta de propina) y modal «Confirmar pago y cerrar» (§03.9.2) | Patrón `modalConfirmFactura` (`:4221-4263`) | ~90 líneas |
| **2E** | Ticket: líneas «Propina» y «Medio» si existen; el código si la pre-cuenta se imprime con la cuenta presentada. Cierre: «Propinas del día» | Ticket y vista de cierres | ~20 líneas |

---

## 05 — Seguridad

**Principio:** el mesero SIEMPRE confirma. Ni «ya pagué», ni una señal de Realtime, ni un error ni un tiempo agotado cierran una mesa o marcan un pago. El cierre con pago es una sola transacción que exige que el monto cubra el total actual.

| # | Amenaza | Vector | Mitigación | Residual |
|---|---|---|---|---|
| S1 | **Pago falso reportado** | «Ya pagué» sin pagar, un pantallazo editado, o un reporte desde fuera del local | Un reporte solo agrega una línea «no verificada». Reportar exige el código, que solo se dice en la mesa (§03.4), y hay 8 reportes por orden como máximo. `confirmar_y_cerrar` es humana: el monto se escribe a mano y arranca vacío. Las notificaciones del banco le llegan al titular o a sus delegados (D1) | Error humano del mesero. Se mitiga con D1 y entrenamiento |
| S2 | **Suplantación de datos de pago o phishing** | (a) Pegatina reescrita o pegada encima, que lleva a un clon con otra llave (FTC: https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information). El clon puede leer el token y mostrar la cuenta real. (b) Datos de pago por la URL. (c) Un mesero que cambia la llave. (d) Un Realtime falso con datos. (e) Repo o Pages comprometidos. (f) CDN comprometido | (a) Contraseña de escritura en las NTAG215 (D16). Revisión diaria leyendo el dominio en la barra (§03.12). Cartel en el mostrador con llave, titular y QR del banco como segundo canal. El mesero dice el titular en voz alta. CORS con lista en las dos funciones (§04.3). **«Mesa N · resplandor.ynt.codes» dentro de la página no protege: el clon lo copia.** (b) La carta **nunca** toma datos de pago de parámetros. (c) `medios_pago` no tiene GRANT para `authenticated`. (d) Payload vacío. (e) 2FA en GitHub y Supabase (sin dato, §10) y revisar el diff de `carta.html` en cada merge. (f) SRI en Alpine y supabase-js (§04.7) | Un cliente que pagó a un estafador por una pegatina pegada encima. El restaurante no pierde, porque solo confirma lo que ve en su banco |
| S3 | **Fuga o reuso del token** | Un enlace guardado, el QR fotografiado o el token en el Referer | Fuga aceptada **solo para ver**, sin datos personales (S8). Pagar exige el código. `o` evita que una pestaña vieja vea la orden siguiente. `no-referrer`. Rotación manual con `update` dedicado y error visible (1D). El token sale en los logs de la función, que solo ve Yonatan. Opciones B y C de §03.10 | Un tercero con el enlace ve la cuenta abierta de la mesa y puede pedirla (S4) |
| S4 | **Spam de solicitudes** | Repetir `pedir`, o pedir desde fuera del local | 5 `pedir` por orden en la base. «Atendido» del mesero. Idempotencia. Rate-limit de 10 por minuto por (IP, mesa) y 60 por minuto por IP. El POS solo avisa en transiciones | Hasta 5 avisos falsos por orden. Molestia, sin pérdida |
| S5 | **Fuerza bruta del código** | Probar los 10.000 códigos | 5 fallos y el código se bloquea en la base, independiente de la IP. Para seguir, el mesero tiene que presentar de nuevo | 5/10.000 = 0,05 % por presentación |
| S6 | **Canal Realtime expuesto** | Escuchar el tópico, publicar señales falsas o saturar los límites del proyecto | El tópico es `sha256(token)`. El payload va vacío. Cada teléfono lee como mucho ~7 veces por minuto ante una inundación (cubeta, §03.2.5). Los límites por proyecto (100 mensajes/s, 200 conexiones; realtime/limits) se comparten con el POS: **ese riesgo ya existe hoy** (R5). S-0 permitiría pasar a d1 | DoS del Realtime del proyecto, como hoy. Egress acotado (§07) |
| S7 | **Integridad del monto** | El cliente cambia el total, la cuenta cambia después de presentada, o una cola offline separa el total local del de la base | No hay ruta de escritura a ítems ni total. `presentar_cuenta` exige `total_visto = total de la base` y una cola vacía. `confirmar_y_cerrar` exige `total_visto = total actual` y `monto ≥ total actual`, y calcula la propina en SQL. El modal muestra «Presentado» frente a «Actual» | Un pago parcial que el mesero confirma escribiendo un monto falso. Es un error humano, visible en el cierre |
| S8 | **Privacidad** (Ley 1581) | Datos personales en la cuenta o en los reportes. Nombres del personal en presencia | La cuenta no lleva nombres, teléfonos ni documentos. La referencia es opcional y alfanumérica. No se sube comprobante. Las liquidaciones se borran con `cerrarDia`. `presencia_pos` publica `nombre: nombreUsuario` en un canal público (`pos.html:2119-2124`) → privado con D17. Actualizar `privacy.html` y `auth.md`, que hoy dicen «Sin pagos» y que el sitio no cobra (`auth.md:22-24`, `privacy.html:60`) | Bajo |
| S9 | **Cualquier cuenta de Google como «mesero»** | Registro abierto en Auth o Google OAuth fuera de Testing (`README.md:240`; LEEME en `tareas/2026-09-29-supabase-propio.md:86`). `solo_google` solo mira el proveedor (base.sql:270-279) | Puerta L-0 de la fase 2: Yonatan verifica que el registro está apagado o que Google está en Testing con usuarios de prueba. Lista blanca `privado.personal` en las 4 RPC de dinero (D15) | Una cuenta de Google en la lista que se compromete. Ya es un riesgo del POS hoy |
| S10 | **Abuso de `liquidar` o de las RPC** | Inyección, un cuerpo enorme, o llamar a `/rest/v1/rpc/...` directo | Cuerpo de hasta 1 KB, validadores estrictos y un único `rpc` con parámetros tipados. `liquidacion_cliente` y `cuenta_cliente` son `security invoker`, con `revoke … from public, anon, authenticated`: llamadas como anon no tienen GRANT. Las RPC del mesero revisan `es_personal()` | Bajo |
| S11 | **El trigger rompe escrituras del POS** | Un error dentro de `emitir_cuenta` | Bloque `exception when others`, aplicar fuera de horario, reversa en menos de 1 min y prueba S-3. La señal perdida la detecta la carta (§03.2.7) | Bajo |
| S12 | **XSS** | Una referencia o un titular con HTML | `x-text` en la carta y el POS, y `check` de formato en la base | Bajo |
| S13 | **Agentes** | Un agente que «paga» o que lee datos de pago | `liquidar` y `pagos` no se exponen en WebMCP, MCP ni `llms.txt`. El comentario de `local.js:176` suma `liquidar` | Ninguno |
| S14 | **Confirmar sin cerrar** (orden abierta con «Pago confirmado») | El push de `facturar()` falla o el POS está offline (`pos.html:2131`, `:2462`) | No existe ese estado: confirmar **es** cerrar, en la base (§03.9). El POS solo refleja después del `ok` | Ninguno en el camino con liquidación. El `facturar()` sin liquidación sigue como hoy (R9) |

---

## 06 — Normativa y UX

| Tema | Regla | Fuente | Qué hace el diseño |
|---|---|---|---|
| **Propina voluntaria** | Es voluntaria. El establecimiento puede sugerir hasta el 10 %. Se pregunta al cliente cuando pide la liquidación. Va completa al equipo de servicio, que se la reparte en no más de un mes | Ley 1935 de 2018, arts. 2-5 (https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=80985). CU de la SIC 2.4.1-2.4.2 (https://normas.cra.gov.co/gestor/docs/circular_superindustria_unica.htm) | Tres opciones sin preselección. La sugerida se redondea hacia abajo. **El modal de presentar le dice al mesero que pregunte** (§03.4.5). La propina se registra en `ordenes.propina`, con su línea en el ticket y el total del día en el cierre, para poder repartirla (art. 5) |
| **Aviso de propina** | «ADVERTENCIA PROPINA» en la entrada y en las cartas: porcentaje, derecho a aceptarla, rechazarla o modificarla, destino y canal de queja ante la SIC | CU 2.4.2 | Hoy `carta.html:233` tiene solo una frase. Camila fija el texto (D10). **D10 bloquea la fase 2** |
| **Precuenta** | «Queda prohibido expedir al consumidor documentos diferentes a la factura», lo que incluye prefactura y precuenta. Solo los hoteles tienen excepción | CU 2.4.3-2.4.4 | El rótulo «Consumo en vivo · no es factura», y nunca llamar «factura» a la pantalla. **Consulta legal antes de sacar la fase 2 al aire** (D5). El POS ya imprime una «pre-cuenta» rotulada «solo informativa» (`pos.html:3551`) |
| **Factura** | Un responsable de impoconsumo expide factura o documento equivalente por cada operación. El comprobante bancario no lo reemplaza | Resolución DIAN 165 de 2023 (https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm). ET 616-1 | Fuera de alcance (`README.md:78`). Camila define qué documento entrega (§10) |
| **Impuesto en la carta** | Los restaurantes tributan impoconsumo del 8 % | ET 512-1 y 512-9 | `carta.html:232` dice «IVA incluido»: se confirma con el régimen real (D6), en otra tarea |
| **Precios** | Lista visible o carta física, sin registro para verlos, sin «20K» | CU 2.4 y sus parágrafos | La pegatina complementa la carta física. Sin login. Formato `$ 23.000` (`pesos()`, `carta.html:414`) |
| **Habeas data** | Un dato personal es lo asociable a una persona. En internet, solo con acceso restringido | Ley 1581 de 2012, arts. 3 y 4 | S8. El token controla el acceso; el código, los datos de pago. Presencia del POS privada (D17) |
| **Táctil** | Mínimo 24 × 24 px; la meta es 44 px | WCAG 2.2, 2.5.8 (https://www.w3.org/TR/WCAG22/) | Botones de 44 px. Código con `inputmode="numeric"` y teclado grande |
| **Contenido que se actualiza solo** | Se puede pausar o controlar | WCAG 2.2.2 | El canal se abre solo con la hoja abierta. «Actualizar» queda. No mueve el foco ni el scroll |
| **Mensajes de estado** | Se anuncian sin mover el foco | WCAG 4.1.3 | `role="status" aria-live="polite"` |
| **NFC** | Los iPhone XR y SE 2 en adelante leen en segundo plano; del 7 al X hace falta el Centro de control | Apple (https://support.apple.com/en-euro/guide/iphone/aside/asd-nfc-reader/15.0/ios) | QR impreso de respaldo en cada pegatina, con «acerca el teléfono o escanea» |
| **Celular primero** | — | — | Cabe en 320 px (`scripts/pruebas/desborde.test.mjs`). Una acción principal por pantalla. Monto en letra grande. supabase-js solo al abrir la cuenta |

**Diez principios,** condensados de la investigación de UX:

1. Ver no es pagar.
2. Liquidar es avisar al mesero, y se puede deshacer mientras nadie viene.
3. La propina es una pregunta, en la pantalla y en la voz del mesero.
4. El total que se ve es el que dice la base.
5. El pago es externo y la confirmación es humana.
6. Una cuenta dividida se reporta por partes; dividir ítems queda para después.
7. Siempre hay mesero y papel: efectivo, datáfono, carta física y cartel en el mostrador.
8. En vivo y honesto: «En vivo» solo si lo está, «leída hace X s» y «sin conexión».
9. Celular primero.
10. Mínimo de datos y confianza en un canal aparte: la barra de direcciones y el cartel.

---

## 07 — Costos frente al plan Free

**Cupos del proyecto `lccgehvyymladqvumcez`** (plan Free, org propia; fuente: el encargo de esta tarea):

| Recurso | Cupo |
|---|---|
| Egress | 5 GB + 5 GB al mes. Se usa 5 GB, porque las respuestas son `no-store` (§11, M6) |
| Realtime | 2 M mensajes y 200 conexiones pico |
| Edge Functions | 500 k invocaciones al mes |

**Hipótesis, no medidas.** El origen tenía 24 órdenes en total (`tareas/2026-09-29-supabase-propio.md:65`).

- **H1.** 10 mesas × 3 cuentas por día × 30 días = **900 cuentas al mes**. Es un techo holgado.
- **H2.** 8 cambios de `ordenes` más 6 de `liquidaciones` = **14 señales por cuenta**. Las de liquidaciones son pedir, presentar, uno o dos reportes, y confirmar, que emite dos.
- **H3.** **2 teléfonos por mesa.** Cada uno abre la hoja 3 veces y la tiene abierta unos 10 minutos.

Cada broadcast cuenta 1 mensaje enviado más 1 por receptor (platform/manage-your-usage/realtime-messages).

| Recurso | Cálculo | Uso al mes | % del cupo |
|---|---|---|---|
| Mensajes Realtime | 900 × 14 × (1 + 2) | 37.800 | **1,9 %** de 2 M |
| Conexiones pico | 10 mesas × 2 + ~4 dispositivos del POS | ~24 | **12 %** de 200 (se comparten con `menu.html` cuando se encienda) |
| Invocaciones de `cuenta` | Por teléfono: 3 aperturas × 2 GET + 14 señales + 10 sondeos de seguridad = 30. × 2 teléfonos × 900 | 54.000 | 10,8 % |
| Invocaciones de `liquidar` | ~5 por cuenta (pedir, 2 `ver_pagos`, 1-2 reportes) × 900 | 4.500 | 0,9 % |
| **Total de invocaciones** (sin `votar`, hoy apagada) | — | ~58.500 | **11,7 %** de 500 k |
| Peor caso: Realtime caído todo el mes y sondeo de 20 s con un teléfono siempre abierto (1.500 h-visor) | 1.500 × 3.600 / 20 | 270.000 | 54 % |
| Ataque: inundación de señales en una mesa, 3 teléfonos abiertos 5 h al día durante 30 días | 7 GET/min × 3 × 300 min × 30 | 189.000 | 38 %. Se corta rotando el token de esa mesa |
| Egress | 58.500 × ~2,2 KB + 37.800 × ~0,3 KB | ~0,14 GB | **~2,8 %** de 5 GB |
| Egress, peor caso | 270.000 × 2,2 KB | ~0,6 GB | 12 % |
| Filas en la base | ≤ 900 liquidaciones al mes, purgadas con `cerrarDia`. `realtime.messages` retiene ~1.300 filas (3 días) | — | Despreciable |

**Notas:**

- Los ~2,2 KB son 1.139 B de cabeceras medidos más ~1 KB de cuerpo supuesto (investigación de tiempo real).
- Sin el QR, ninguna respuesta pasa de unos pocos KB. Con el QR dentro de `cuenta` serían ~40 KB por lectura (§11, SD8 y M6).
- Las invocaciones se cobran aunque respondan 404 o 429 (platform/manage-your-usage/edge-function-invocations).
- **El egress importa más que el resto:** el proyecto anterior murió por `exceed_egress_quota` (`tareas/2026-09-29-supabase-propio.md:15`), y un 402 tumba también el POS. Después de un día real se revisa el reporte de uso (S-9).

---

## 08 — Fases de implementación

**Reglas comunes:**

- Cada parte vive en su propio worktree, `~/Developer/worktrees/resplandor--cuenta-en-mesa--<clave>`, con la rama `tarea/cuenta-en-mesa--<clave>` creada desde `tarea/cuenta-en-mesa`. Es la misma convención que `tarea/pos-visual--<clave>`.
- La integración se hace en `tarea/cuenta-en-mesa`. **Nunca push.**
- Al cerrar, cada parte corre con Node 22, como CI (`.github/workflows/comprobar.yml`). El Node por defecto de esta máquina es v16 y no sirve.
  - `node --test scripts/pruebas/*.test.mjs`;
  - `node scripts/css.mjs --comprobar`;
  - `node scripts/iconos.mjs --comprobar`;
  - `node scripts/descubrimiento.mjs --comprobar`.
- Dos pruebas afectan a todas las partes: `css.test.mjs:21-30` exige regenerar `resplandor.css`, y `desborde.test.mjs` exige 320 px.
- **Desplegar es de Yonatan, con su GO** (Línea Roja). El orden es:
  1. la migración, en el SQL Editor y después de las 17:00;
  2. `supabase functions deploy … --no-verify-jwt`;
  3. `git push`.
  - Con la detección del canal mudo, cualquier otro orden degrada a sondeo sin congelar la cuenta.

### Fase 0: decisiones, datos y preparación (sin código)

| Qué | Quién | Bloquea |
|---|---|---|
| Responder D1 a D18 (§09) | Yonatan y Camila | La fase 2 al aire queda bloqueada por D3, D4, D5, D7, D10, D15 y D16. Nada bloquea el código de la fase 1 |
| Datos de pago reales: llave, tipo y titular; la cuenta, si D2 lo decide | Camila. Los carga Yonatan | Solo encender `liquidar`. El código de fase 2 se integra con `medios_pago` vacía |
| Correos del personal para `privado.personal` (D15) | Camila. Los carga Yonatan | Solo encender `liquidar` |
| Contraseña de escritura en las 10 pegatinas (D16) | Yonatan | La fase 2 al aire |
| Verificar en Auth que el registro está apagado o que Google está en Testing (S9) | Yonatan | La fase 2 al aire (L-0) |
| Consulta legal sobre la precuenta y texto del aviso de propina | Camila | La fase 2 al aire |
| Cartel del mostrador con llave, titular y QR del banco | Camila | La fase 2 al aire |

### Fase 1: cuenta en vivo, solo lectura, y arreglos de lógica del POS

- **Objetivo:** la pegatina refleja en ≤ 2 s (p95) un cambio aislado. Detecta el canal mudo y cae a sondeo. La rotación del token ya no se deshace.
- **La bloquea:** nada para el código. Para salir al aire, el GO de Yonatan.

| Parte | Archivos (exclusivos) | Alcance | Depende de |
|---|---|---|---|
| **1A `senal-bd`** | `supabase/migrations/20261001120000_cuenta_en_vivo.sql` (nueva) y `scripts/pruebas/migracion-cuenta-en-vivo.test.mjs` (nueva) | El SQL de §04.2 con la reversa comentada. La prueba estática revisa el texto: `security definer` y `search_path = ''`; `exception when others`; `realtime.send(…, false)`; la guarda `is distinct from`; la rama de liquidaciones lee la mesa de `ordenes`; cero `grant … to anon`; cero policies en `realtime.messages`. Fija el vector del tópico, compartido con 1B: `cuenta:` + sha256 de un token de 48 ceros | — |
| **1B `cuenta-v2`** | `supabase/functions/cuenta/index.ts`, `supabase/functions/_compartido/mesa.js` (nueva) y `scripts/pruebas/fn-cuenta.test.mjs` (nueva) | El contrato de §04.3 con `liquidacion: null` y `liquidar_activo: false`. Incluye `estado`, `orden_id`, `marca`, `actualizada_en`, `canal`, `servidor_en`, `o`, los `codigo`, ítems agrupados, CORS con lista, el rate-limit nuevo y el corte por 404. `mesa.js` en JS puro, probado en Node: validadores, limitador, `agruparItems` y `topicoCuenta` contra el vector de 1A | Vector de 1A, ya fijado aquí |
| **1C `carta-vivo`** | `carta.html`, `assets/css/resplandor.css` (regenerada), `scripts/pruebas/_carta-vm.mjs` (nueva: arnés copiado de `funciones.test.mjs:771-798`, con `location.search`, `performance`, `sessionStorage`, `supabase` y `fetch` simulados) y `scripts/pruebas/cuenta-en-vivo.test.mjs` (nueva) | Filas de fase 1 de §04.7: SRI, `no-referrer`, máquina de conexión, cubeta, sondeo de seguridad con `marca`, regla de `o` por tipo de navegación, estados `cerrada` y `vencido`, `aria-live`, «leída hace X s», rótulo y total en la barra. Pruebas: canal mudo → sondeo; sin `canal` → sondeo; inundación de 60 señales → ≤ 7 lecturas por minuto; `navigate` descarta `o` | El contrato de 1B, simulado |
| **1D `pos-logica-base`** | `pos.html`, **solo dentro de `<script>` (`:1652-3091`)**; `supabase/migrations/20261001130000_presencia_privada.sql` (nueva, si D17); `scripts/pruebas/pos-cuenta-base.test.mjs` (nueva, estática) | Filas 1D de §04.8. Prueba estática: `pushASupabase('mesas')` no manda `token`; `rotarTokenMesa` usa `update` y revisa `error`; `pos_sync` tiene callback; y si D17, `presencia_pos` es `private` | — |

- **Orden de merge:** 1A, 1B, 1C y 1D no comparten archivos; el orden da igual.
- 1D toca el `<script>` de `pos.html`, que pos-visual no toca (`docs/pos-visual.md` §5). Antes de integrar se repite `git merge-tree` con `tarea/pos-visual`.

**Pruebas de humo, en vivo y con el GO de Yonatan:**

| Prueba | Qué verifica |
|---|---|
| S-0 (opcional) | Anon con la llave publishable se une a un canal **privado** con una policy `to anon`. Si pasa, se propone d1 (§04.1) |
| S-1 | Anon con publishable se une a `cuenta:<hash>` público y recibe `SUBSCRIBED` |
| S-2 | Un delta produce exactamente 1 señal, y la carta se actualiza en ≤ 2 s p95. Se mide 20 veces, en 4G y en el wifi del local |
| S-3 | Una señal por camino: delta, nota, facturar, cobro parcial, liberar vacía, reabrir en otra mesa (2 señales) y rotar token (señal al tópico viejo y 404). `cerrarDia` no emite por órdenes cerradas. **Cada escritura del POS sigue funcionando** |
| S-4 | Con el WebSocket bloqueado, la carta cae a sondeo de 20 s |
| S-5 | Con el POS offline, las señales llegan al sincronizar. Un fallo de `realtime.send` no rompe la orden: en los logs de Postgres se busca `emitir_cuenta` **y también `ErrorSendingBroadcastMessage`**, porque `realtime.send` atrapa sus propios errores de INSERT (RLS, permisos, partición) y solo avisa con ese mensaje, nunca con `emitir_cuenta` (refutación de la fase 1, H5). La carta lo cubre igual: detecta el canal mudo y pasa a sondeo |
| S-6 | **Canal mudo:** con la reversa aplicada, la carta pasa a «Se actualiza cada 20 s» en ≤ 60 s después del primer cambio |
| S-7 | 4 teléfonos en el mismo wifi y la misma mesa, mientras el mesero carga 10 ítems seguidos: ningún 429 |
| S-8 | Rotar el token en la tablet A con la tablet B con caché vieja: B no deshace la rotación al facturar otra mesa |
| S-9 | Tras un día real: mensajes, conexiones, invocaciones y egress en el reporte de uso |
| S-10 (si D17) | La presencia del POS funciona en el canal privado, y anon no puede unirse a `presencia_pos` |

**Criterio de cierre:**

- suite y los tres `--comprobar` en verde;
- S-1 a S-9 pasadas, y S-10 si D17;
- la pegatina piloto real muestra un ítem agregado en ≤ 2 s p95;
- el visto de Yonatan.

### Fase 2: liquidar y pagar

- **Objetivo:** pedir la cuenta, presentarla con código, elegir propina, ver los datos de pago, reportar pagos, y que el mesero confirme y cierre de forma atómica.
- **La bloquean:**
  - la fase 1 integrada;
  - el **merge de `tarea/pos-visual` a `main`**, solo para la parte 2E;
  - para salir al aire: D3, D4, D5, D7, D10, D15, D16, la puerta L-0 y los datos de pago (para encender `liquidar`).

| Parte | Archivos (exclusivos) | Alcance | Depende de |
|---|---|---|---|
| **2A `liquidaciones-bd`** | `supabase/migrations/20261005120000_liquidaciones.sql` (nueva) y `scripts/pruebas/migracion-liquidaciones.test.mjs` (nueva) | Todo §04.5: tablas, columnas, `ajustes_cuenta` (apagado), `privado.personal` (vacía), `es_personal`, RLS, GRANT, índice, triggers y publicación. Las 6 funciones con la tabla de §03.1 y los topes. Prueba estática: `revoke … from public` en todas; `security invoker` en `liquidacion_cliente` y `cuenta_cliente`; `es_personal()` en las 4 del mesero; la orden se busca con `mesa_id = p_mesa`; `floor` en la propina; propina confirmada `= monto − total`; `monto < total` → `monto_insuficiente`; cero INSERT en `medios_pago` y en `privado.personal`; `ajustes_cuenta` nace en `false` | Fase 1 (`privado.emitir_cuenta`) |
| **2B `funciones-liquidar`** | `supabase/functions/liquidar/index.ts` (nueva), `supabase/functions/cuenta/index.ts`, `supabase/functions/_compartido/liquidacion.js` (nueva), `supabase/functions/_compartido/mesa.js` y `scripts/pruebas/fn-liquidar.test.mjs` (nueva) | §04.4 completo, con el 503 `apagado`. `cuenta` pasa a `cuenta_cliente` y devuelve `liquidacion` y `liquidar_activo`. `liquidacion.js`, en JS puro: validación del cuerpo, mapeo de `codigo` a HTTP y forma de la respuesta | El contrato SQL de 2A, fijado aquí. Merge después de 2A |
| **2C `carta-pagar`** | `carta.html`, `assets/css/resplandor.css` y `scripts/pruebas/carta-pagar.test.mjs` (nueva). Usa `_carta-vm.mjs` de 1C sin modificarlo | Filas de fase 2 de §04.7 y §03.3 a §03.8. Pruebas: nada de fase 2 sin `liquidar_activo`; ninguna propina preseleccionada; ningún monto marcado; pagos solo después de `ver_pagos` correcto; nada de pagos leídos de la URL; `x-text`; 320 px; estados `pedida` (con cancelar y aviso de 2 min), `pago_reportado` con varios reportes y `confirmada`; 409 con relectura; `sessionStorage` sobrevive a una recarga | El contrato de 2B, simulado |
| **2D `pos-logica-liquidar`** | `pos.html`, **solo `<script>`**, y `scripts/pruebas/pos-liquidacion.test.mjs` (nueva) | Filas 2D de §04.8. La prueba es estática y de vm sobre el store extraído: `formatOrden` no manda `medio_pago` ni `propina`; `presentarCuenta` se niega con cola; `confirmarYCerrar` no llama a `pushASupabase`; `facturar` desvía con una liquidación activa; `reabrirOrden` anula antes; los avisos solo cuentan órdenes abiertas | El contrato de 2A. Se puede hacer **antes** del merge de pos-visual |
| **2E `pos-marcado-liquidar`** | `pos.html`, **solo marcado**; `scripts/pruebas/pos-liquidacion-vistas.test.mjs` (nueva, sobre `scripts/pruebas/_pos-simulado.mjs`, que llega con pos-visual, commit `4da9030`) | Filas 2E de §04.8, con las clases de pos-visual (`.aviso-atencion`, `.nav-pill-aviso`; `docs/pos-visual.md` §3.8) | **El merge de pos-visual a `main`** y el rebase de `tarea/cuenta-en-mesa`. 2D integrada |
| **2F `docs-y-confianza`** | `README.md` (§02, §06, §07, §08 y §10, más la tabla de `:244-251`), `scripts/descubrimiento.mjs` (genera `privacy.html` y `auth.md`; `:641`, `:760`), `privacy.html` y `auth.md` (regenerados), `assets/js/local.js` (solo el comentario de `:176`: «ni `liquidar`») y `scripts/pruebas/descubrimiento.test.mjs` si cambia lo esperado | `privacy.html`: «Mi cuenta», el token en la URL, el código y qué guarda una liquidación. `auth.md`: el sitio **muestra** a dónde transferir y **no cobra ni recibe** dinero ni datos bancarios; ningún agente puede pagar ni liquidar. El README documenta tablas, funciones, interruptor y lista blanca | — |

**Orden de merge:**

1. 2A.
2. 2B.
3. 2C y 2D, en cualquier orden: no comparten archivos.
4. 2E, cuando pos-visual esté en `main`, y siempre después de 2D, porque es el mismo archivo.
5. 2F, en cualquier momento.

**Despliegue de la fase 2, todo junto** y con `liquidar` apagado:

1. la migración;
2. `liquidar` y `cuenta`;
3. push.
- Pruebas L con el interruptor encendido solo durante la prueba.
- Se enciende para el público con el visto de Yonatan y Camila.
- Si falta 2E, nadie puede presentar y ninguna liquidación llega a existir: el desvío de `facturar()` nunca se activa.

**Pruebas de humo de fase 2** (con el GO de Yonatan, en una mesa real):

| Prueba | Qué verifica |
|---|---|
| L-0 | **Puerta.** El registro de Auth está apagado o Google está en Testing. Una cuenta de Google que no está en `privado.personal` recibe `no_autorizado` al presentar |
| L-1 | `pedir` dos veces genera 1 aviso, con pitido y título. «Ya no la quiero» lo quita. «Atendido» lo quita en las dos tablets |
| L-2 | `presentar` muestra el total, la propina sugerida redondeada hacia abajo y el código. Con un delta en cola, se niega. Con otro total en la base, da `cuenta_cambio` |
| L-3 | 5 códigos mal → bloqueado. Presentar de nuevo da un código nuevo |
| L-4 | Si se agrega un ítem después de presentar, `ver_pagos` da 409, `reportar_pago` se acepta con `vigente:false` y el POS avisa |
| L-5 | Dos teléfonos reportan $23.000 cada uno: la pegatina muestra los dos, la suma y «Falta según la cuenta» |
| L-6 | `confirmar_y_cerrar` con monto menor que el total → `monto_insuficiente`; con `total_visto` viejo → `cuenta_cambio`. Con éxito, un `SELECT` muestra la orden cerrada, la mesa libre y la liquidación confirmada. Repetir la llamada da `repetida:true` |
| L-7 | «Facturar» con una liquidación activa abre «Confirmar pago y cerrar». Sin liquidación, cierra como hoy |
| L-8 | Reabrir una orden confirmada limpia `medio_pago` y `propina`, y la vuelve a cerrar en efectivo |
| L-9 | Con `liquidar` apagado, la carta solo muestra la fase 1 y `liquidar` responde 503 |
| L-10 | Con `medios_pago` vacía, aparece «Paga con el mesero» |
| L-11 | Un segundo teléfono intenta reescribir una pegatina con contraseña y falla. Una petición a `cuenta` desde otro origen no se puede leer en el navegador |
| L-12 | **Una transferencia real de monto pequeño, hecha por Camila o Yonatan (nunca un agente)**, que el mesero confirma viendo el abono. Se verifica que la app del pagador muestra el titular (§10) |
| L-13 | En un servicio real, el tiempo entre pedir y presentar. Si la mediana pasa de 3 min, se revisan los avisos |

**Criterio de cierre:**

- suite y los `--comprobar` en verde;
- L-0 a L-13 pasadas;
- D5 y D10 respondidas;
- datos de pago y personal cargados por Yonatan;
- el visto de Yonatan y Camila.

### Fase 3: opcionales, cada uno con su propia decisión

| Opcional | Para qué | Decisión |
|---|---|---|
| Pegatinas NTAG 424 DNA con SUN | Cerrar la fuga para ver | D7 |
| QR por mesa con el Plan Avanzado de Bancolombia | Saber de qué mesa vino cada pago | D13 |
| Pasarela con webhook (Wompi o Bold) | Confirmación automática, con comisión | D13 |
| Dividir por ítems desde la pegatina | «Solo lo mío» | — |
| Reporte del cierre por medio de pago | Totales por medio | D14 |
| Canales del POS privados (`pos_sync`) y modo «solo privados» | Cerrar R5 | — |
| QR del banco en la página, en un endpoint aparte con caché | Pagar desde la galería del mismo teléfono | D2 |

---

## 09 — Decisiones abiertas

| # | Pregunta | Recomendación | Por qué |
|---|---|---|---|
| D1 | ¿Quién confirma los pagos por transferencia en el POS? | Solo quien ve la notificación del banco: Camila o sus delegados. El mesero sin acceso le pregunta antes de confirmar | La única prueba es el abono. En una cuenta de persona natural, la notificación le llega solo al titular (§10) |
| D2 | ¿Qué datos de pago se publican y dónde va el QR? | La llave Bre-B de negocio, primero. La cuenta Bancolombia solo si Camila quiere. El QR del banco, **solo impreso en el mostrador**, no en la página | Bre-B funciona desde cualquier banco sin inscribir. Pagar con el QR desde el mismo teléfono obliga a descargarlo, y meterlo en `cuenta` multiplica el egress (SD8, M6) |
| D3 | ¿El mesero presenta la cuenta antes de que se vean los datos de pago? | Sí, con código de 4 dígitos | Congela el monto, hace que el mesero pregunte por la propina y deja fuera a quien no está en la mesa (SD4) |
| D4 | ¿Base y redondeo de la propina sugerida? | El 10 % del total, hacia abajo a la centena, hasta que el contador confirme el régimen | La CU habla de «valor de la cuenta» y la ley de «servicio prestado». Hacia abajo nunca pasa del tope |
| D5 | ¿Una cuenta en vivo con «liquidar» es una «precuenta» prohibida (CU 2.4.3)? ¿Qué documento se entrega? | Consulta legal antes de sacar la fase 2 al aire. Mientras tanto, «Consumo en vivo · no es factura» | Multas de hasta 2.000 SMMLV y ningún pronunciamiento encontrado |
| D6 | ¿Es correcto «IVA incluido» (`carta.html:232`)? | Que el contador confirme el régimen; se corrige en otra tarea | Los restaurantes suelen tributar impoconsumo del 8 % (ET 512-1) |
| D7 | ¿Qué se hace con la «fuga aceptada»? | Aceptarla **para ver**. Para pagar, código obligatorio. NTAG 424 DNA al reemplazar pegatinas | Las NTAG215 son estáticas. La cuenta no tiene datos personales, y el dinero ya queda detrás del código |
| D8 | ¿El cliente ve la variante de cada ítem? | No. Se agrupa por nombre y precio | `nota` mezcla variante, «Persona N» y texto libre (`pos.html:2404`, `:2535`) |
| D9 | ¿Se sube la foto del comprobante? | No | Trae datos personales, abre un endpoint de subida y no prueba nada |
| D10 | ¿Quién redacta «ADVERTENCIA PROPINA» y dónde va? | Camila, con los elementos de la CU 2.4.2. En la entrada, la carta física y `carta.html`. **Bloquea la fase 2** | La pegatina enlaza ese texto y la ley obliga a informarlo (M5) |
| D11 | ¿El POS suena con un aviso? | Sí: pitido corto y título de la pestaña, solo con el POS visible | Sin sonido nadie ve los avisos en hora pico (A5) |
| D12 | ¿Hay que esperar a `tarea/pos-visual` para tocar `pos.html`? | Solo para el **marcado** (2E). La lógica (1D, 2D) va ya | pos-visual congela el `<script>` byte a byte (`docs/pos-visual.md` §5) y el `merge-tree` sale limpio |
| D13 | ¿QR por mesa (Plan Avanzado) o pasarela con webhook? | No por ahora | Cuestan (Wompi: 2,65 % + $700 + IVA, https://wompi.com/es/co/planes-tarifas/) y Bre-B es gratis en el Plan Básico |
| D14 | ¿Reporte del cierre por medio de pago? | Fase 3. En fase 2 solo la línea de propina en el ticket y las propinas del día | El reparto (Ley 1935, art. 5) necesita el total de propinas ya; el desglose por medio, no |
| D15 | ¿Lista blanca de correos del personal para las RPC de dinero? | Sí. Tabla `privado.personal`, la carga Yonatan. Solo para presentar, atender, confirmar y anular. No se toca el resto del POS | Hoy «mesero» es cualquier cuenta de Google que pase `solo_google` (SD5). Toca identidad: decide Yonatan |
| D16 | ¿Contraseña de escritura en las NTAG215? | Sí: PWD/PACK con AUTH0 = 04h y PROT = 0, en el gestor de Yonatan. Sin bloqueo permanente | De fábrica cualquier teléfono las reescribe (SD1). El bloqueo permanente impediría rotar |
| D17 | ¿Pasar `presencia_pos` a canal privado? | Sí, en 1D, con su policy y la prueba S-10 | Hoy publica el nombre del personal en un canal que cualquiera puede escuchar y falsificar (SD9) |
| D18 | ¿El interruptor de la fase 2 en la base o en `local.js`? | En la base (`ajustes_cuenta`) | Se apaga en segundos sin desplegar, lo leen las funciones y no arrastra a `descubrimiento.mjs` (§04.6) |

---

## 10 — sin_dato

| Tema | Motivo |
|---|---|
| Que anon pueda unirse a un canal **privado** con una policy | La doc dice que solo `authenticated` (realtime/broadcast). No se probó: es S-0 |
| La configuración viva del proyecto nuevo: «Allow public access», policies de `realtime.messages`, particiones y signing keys | `list_projects` no ve esa org. Se toma del encargo |
| Que lo desplegado de `cuenta` y `votar` coincida con `index.ts`, y su `verify_jwt` | `list_edge_functions` fue denegado. Se toma del encargo |
| Si la plataforma de Edge Functions sobrescribe `x-forwarded-for` o deja pasar el del cliente | No verificado. Por eso los topes que importan están en la base |
| Que la policy de presencia privada funcione con `extension = 'presence'` y `realtime.topic()` | Sale de la doc de Realtime Authorization, sin probar. Lo cubre S-10 |
| Que `SUPABASE_SERVICE_ROLE_KEY` siga inyectada después de fin de 2026 | La doc dice que las llaves legacy funcionan hasta fin de 2026 (realtime/getting_started) |
| La latencia real de la señal y el arranque en frío de `cuenta` en este proyecto | Las cifras de §04.1 son benchmarks de Supabase |
| El volumen real de cuentas por día | §07 son hipótesis |
| Si Bre-B tiene enlace profundo o QR dinámico con monto para un sitio web | No está en el documento técnico, la circular DSP-465 ni el estándar ACH revisados. Las solicitudes de pago llegarían en 2027. `banrep.gov.co` tiene un antibot que no se evadió |
| Que la app del pagador muestre el nombre del titular antes de confirmar una transferencia por llave | Sin fuente. Se verifica en L-12 |
| Si la cuenta de Camila es de persona natural o jurídica, y si ya tiene llave de negocio | De eso dependen D1 y el tipo de llave |
| Si una transferencia desde otro banco a la cuenta Bancolombia llega al instante | No verificado. Si no, el mesero no puede confirmar en el momento: otra razón para Bre-B primero |
| El precio del Plan Avanzado de Bancolombia y la vigencia del Plan Básico de Wompi | No figuran en las fuentes revisadas, o dieron 403 |
| El régimen tributario de Resplandor y qué documento de venta entrega hoy | Define D4, D5 y D6 |
| Un pronunciamiento de la SIC sobre cuentas en vivo como «precuenta», y si basta una pantalla para que «la persona que atiende» pregunte | No encontrado. Por eso el mesero pregunta en voz alta (§03.4.5) |
| Qué URL tienen las pegatinas ya escritas | `tareas/2026-09-06-carta-nfc-y-cuenta.md:128-130` menciona `{TAG-ID}` de NFC Tools; el código usa `?m&k` (`README.md:251`) |
| Si la app de escritura de Yonatan configura PWD/PACK y AUTH0 en NTAG215, y el límite de intentos fallidos de la contraseña | No investigado. El límite está en la hoja de datos (§8.8), sin leer en detalle |
| El precio de las NTAG 424 DNA | No investigado |
| 2FA en GitHub y Supabase | No verificable desde el repo |
| Si existe wifi para clientes en el local | De eso depende cuánto pesa el límite por IP (M3) |
| Si las tablets del POS se quedan despiertas y en primer plano durante el servicio | Si no, el WebSocket se suspende y los avisos llegan al despertar (resincronización de 1D) |
| El NFC en Android | No verificado |
| Si una nota libre del pagador llega al movimiento del comercio en Bre-B | No verificado. La referencia es opcional y no sirve para conciliar |
| Si el egress de Edge Functions y Realtime cuenta como «sin caché» | La doc de Supabase no lo dice. §07 usa el cupo de 5 GB, el más conservador |

---

## 11 — Registro de refutación

Hubo dos refutaciones de la v0.1:

- **SD:** seguridad y dinero, con 12 hallazgos;
- **OU:** operación y UX, con 6 altos (A), 7 medios (M) y 5 bajos (B).

| # | Severidad | Hallazgo | Cómo quedó en v0.2 | Dónde |
|---|---|---|---|---|
| SD1 | Crítico | La NTAG215 se reescribe con cualquier teléfono, y un clon muestra la cuenta real con otra llave | **Resuelto:** PWD/PACK con AUTH0 = 04h y PROT = 0 (D16). Revisión diaria leyendo el dominio. Cartel del mostrador como segundo canal. CORS con lista. Prueba L-11. Se aclara que «Mesa N · dominio» en la página no protege | §03.10, §03.12, §04.3, §05 S2 |
| SD2 | Crítico | `confirmar_pago` no exigía vigencia ni monto suficiente, y no cerraba la orden en la misma operación | **Resuelto:** `confirmar_y_cerrar` atómica, con `total_visto = total actual`, `monto ≥ total`, orden cerrada y mesa libre en la misma transacción, e idempotente. El modal muestra «Presentado» frente a «Actual» | §03.9, §04.5, L-6 |
| SD3 | Alto | El total presentado sale de la base, pero el POS cobra su total local, y la cola de deltas los separa | **Resuelto:** `presentar_cuenta(…, total_visto)` responde 409 si no coinciden, el POS no presenta con la cola llena, y el cierre usa el total de la base | §03.4, §04.5 |
| SD4 | Alto | `orden_id` no protege de quien tiene el token, el QR está impreso, y «Descartar» abría un bucle | **Resuelto:** código obligatorio por cuenta para pagos y reportes, con 5 fallos guardados en la base. 8 reportes y 5 pedidos por orden. «Atendido» definido. Rótulo «no verificado». El XFF queda en sin_dato | §03.1, §03.4, §04.4, §05 S1/S4/S5 |
| SD5 | Alto (condicional) | «Mesero» es cualquier cuenta de Google | **Resuelto en el diseño, a decidir:** puerta L-0 y lista blanca `privado.personal` en las 4 RPC de dinero (D15) | §04.5, §05 S9, D15 |
| SD6 | Medio | `liquidacion_cliente` era SECURITY DEFINER en `public`, sin revocar a `public` ni exigir `mesa_id` | **Resuelto:** pasa a `security invoker`, con `revoke … from public, anon, authenticated`. La orden se busca con `mesa_id = p_mesa` y el token por *join*. La prueba de 2A lo exige | §04.5 |
| SD7 | Medio | El modal venía prellenado y la propina no dependía del monto | **Resuelto:** el monto arranca vacío y la propina es `monto − total`, calculada en SQL | §03.9, §04.5 |
| SD8 | Medio | El QR de 40 KB viajaba en cada GET, y el corte por amplificación nunca se activaba | **Resuelto:** sin QR en la página (D2). Los datos de pago solo salen por `ver_pagos`. La cubeta acota a ~7 lecturas por minuto por teléfono | §03.2, §04.4, §07 |
| SD9 | Medio | `presencia_pos` es público y expone y deja falsificar el nombre del personal | **Resuelto, a decidir:** canal privado con su policy en 1D (D17), y prueba S-10 | §04.2, §04.8, §05 S8 |
| SD10 | Bajo | Scripts de CDN sin SRI en la página que muestra la llave | **Resuelto:** `integrity` y `crossorigin` en Alpine y en supabase-js diferido (1C) | §04.7 |
| SD11 | Bajo | No había bandera para la fase 2 | **Resuelto de otra forma:** interruptor `ajustes_cuenta.liquidar` en la base, que leen las dos funciones (D18). Se descartó `local.js` por `funciones.test.mjs:57` y por `descubrimiento.mjs` | §04.5, §04.6, L-9 |
| SD12 | Bajo | «Ver la cuenta actual de la mesa» anulaba la mitigación de `o` | **Resuelto:** se quita el botón. Además, `o` se descarta en una navegación nueva | §03.10, §03.11, §04.7 |
| A1 | Alto | Una señal perdida dejaba la cuenta congelada con «En vivo» | **Resuelto:** sondeo de seguridad de 60 s también en vivo, detección del canal mudo por `marca`, y prueba S-6 | §03.2.7, §04.3 |
| A2 | Alto | Si la cuenta cambiaba después de transferir, se podía pagar dos veces y el reporte se borraba | **Resuelto:** los reportes se acumulan y nunca se borran, se aceptan sin vigencia con su total, y presentar de nuevo los conserva. El POS avisa al agregar ítems | §03.1, §03.8 |
| A3 | Alto | La cuenta dividida no estaba contemplada | **Resuelto en lo mínimo:** el aviso «total de toda la mesa», el monto lo escribe el cliente, y los reportes se acumulan con «Falta según la cuenta». Dividir por ítems queda en fase 3 | §03.5, §03.8 |
| A4 | Alto | Confirmar y cerrar no era atómico, y los errores pasaban en silencio | **Resuelto:** igual que SD2, y el POS revisa `error` y `ok` con un error que bloquea | §03.9.4, §04.8 |
| A5 | Alto | Avisos que nadie ve, avisos falsos y toques accidentales | **Resuelto:** pitido y título (D11), resincronización al reconectar (1D), texto honesto con aviso a los 2 min, confirmación antes de pedir, «Ya no la quiero» y medición en L-13 | §03.3, §04.8 |
| A6 | Alto | El «Facturar» de siempre dejaba la liquidación colgada y perdía medio y propina | **Resuelto:** con una liquidación activa, `facturar()` abre «Confirmar pago y cerrar». Los avisos solo cuentan órdenes abiertas | §03.9.5, §04.8 |
| M1 | Medio | Medio y propina viejos después de anular o reabrir | **Resuelto:** `anular_liquidacion` limpia las dos columnas y `reabrirOrden` la llama antes de reabrir | §03.9.6, §04.5 |
| M2 | Medio | «Descartar aviso» no existía en la máquina de estados | **Resuelto:** `atender` está en la tabla. Los avisos son `pedida` y `pago_reportado` sin atender | §03.1, §03.3.5 |
| M3 | Medio | El límite por (IP, mesa) lo comparten los teléfonos del wifi | **Resuelto:** 120 por minuto por (IP, mesa), 600 por IP, corte por 404 y prueba S-7 | §04.3 |
| M4 | Medio | POS desincronizado y un «hace X s» que prometía de más | **Resuelto:** `total_visto`, la cola vacía, y «Leída hace X s» con la aclaración de que no mide el POS | §03.4, §03.11 |
| M5 | Medio | La propina frente a la ley | **Resuelto:** D10 bloquea la fase 2, el modal le dice al mesero que pregunte, y la propina va en el ticket y en el total del día | §03.4.5, §06, §04.8 |
| M6 | Medio | Egress por el QR | **Resuelto:** igual que SD8. §07 usa el cupo de 5 GB | §07 |
| M7 | Medio | El arreglo de la reversión del token esperaba sin necesidad | **Resuelto:** pasa a 1D, con la lógica en fase 1 y solo el marcado esperando | §04.8, §08 |
| B1 | Bajo | El QR de respaldo expone el token a todo el salón | **Mitigado:** el código deja fuera de los pagos a quien no está en la mesa. Ver la cuenta sigue en la fuga aceptada (D7) | §03.4, §05 S3 |
| B2 | Bajo | Las variantes se veían como líneas repetidas | **Resuelto:** `cuenta` agrupa por (nombre, precio) | §04.3 |
| B3 | Bajo | La meta de 2 s chocaba con el mínimo de 2 s entre GET | **Resuelto:** una cubeta en vez del mínimo fijo. La meta queda en ≤ 2 s para un cambio aislado y ≤ 4 s para el último ítem de una ráfaga | §01, §03.2.5 |
| B4 | Bajo | El SDD estaba desactualizado sobre pos-visual | **Resuelto:** base commiteada (`b242a2b`), 4 partes en worktrees, `<script>` congelado y `merge-tree` limpio. Se usan `.nav-pill-aviso` y `.aviso-atencion` | §04.8 |
| B5 | Bajo | Al reabrir en otra mesa, el aviso salía en la tarjeta equivocada, y la propina elegida se perdía si iOS descartaba la pestaña | **Resuelto:** `liquidaciones` ya no tiene `mesa_id`; la mesa sale siempre de la orden. `sessionStorage` por orden | §04.5, §03.5.4 |

**Lo que v0.2 deja abierto a propósito:**

- el `facturar()` sin liquidación sigue sin esperar su push (`pos.html:2462`). Ya pasa hoy y queda como R9;
- la fuga para **ver** sigue aceptada (D7).

**Refutación del código de la fase 1** (`tarea/cuenta-en-mesa` en `d5828f5`, 2026-09-30). Los hallazgos eran de la resincronización de `pos_sync` (1D) y del limitador de `cuenta`:

| # | Severidad | Hallazgo | Cómo quedó | Dónde |
|---|---|---|---|---|
| H1 | Crítico | La cola de deltas se vaciaba dos veces en paralelo (carga inicial, SUBSCRIBED y `online`) y `aplicar_delta_orden` no es idempotente: 4 limonadas en cola quedaban como 7 en la base | **Resuelto:** candado en `flushDeltas` con vuelta extra. Queda abierto, a futuro, la llave de idempotencia por delta en la RPC (cubriría también una respuesta perdida) | §04.8 |
| H2 | Alto | La resincronización reemplazaba `this.ordenes` por la lectura y borraba cobros parciales, facturas y cierres del día hechos sin red; el día se podía cerrar dos veces | **Resuelto:** fusión con `_pendientes` (guardado en `localStorage`), nueva subida de lo pendiente, y `purgar` en el cierre. Se extendió a mesas y productos, que la resincronización también pisaba | §04.8 |
| H3 | Medio | La lectura de reconexión no miraba `version` y pisaba un eco más nuevo | **Resuelto:** una orden local con `version` mayor se conserva. Con la misma versión manda la base (un `upsert` no sube `version`) | §04.8 |
| H4 | Medio | 21 solicitudes con un `k` inventado bloqueaban por IP, y por NAT a todo el local, 10 minutos | **Resuelto:** el bloqueo es por (IP, mesa). Límite aceptado: quien conozca el número de una mesa puede bloquear esa mesa desde esa IP 10 minutos | §04.3 |
| H5 | Bajo | S-5 no detectaba que `realtime.send` fallara en silencio | **Resuelto:** S-5 busca también `ErrorSendingBroadcastMessage` | §08 |

**Pendiente de medir (de esa misma refutación):** el egress de la lectura de reconexión, que trae `ordenes` completa en cada SUBSCRIBED (S-9), y un `statement_timeout` por un lock sobre `realtime.messages`, que `when others` no atrapa. Los dos son teóricos.

---

### Riesgos residuales

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Una pegatina pegada encima lleva a un clon y el cliente le paga a un estafador | Revisión diaria, cartel del mostrador, titular en voz alta. El restaurante no pierde |
| R2 | El mesero confirma sin ver el abono | D1, el texto fijo del modal y entrenamiento |
| R3 | Lo legal: precuenta y aviso de propina | D5 y D10 bloquean la salida al aire |
| R4 | El trigger rompe escrituras del POS | `exception`, fuera de horario, reversa en menos de 1 min, S-3 |
| R5 | DoS del Realtime con la llave pública: canales públicos y límites por proyecto | Ya existe hoy. Fase 3: modo «solo privados» |
| R6 | El rate-limit por IP se esquiva si la plataforma confía en el XFF del cliente | Topes en la base |
| R7 | El merge de pos-visual se atrasa y bloquea 2E | La lógica (2D) avanza aparte y el interruptor espera |
| R8 | Volver al 402 por egress | §07: ~3 % del cupo, sin QR y con lecturas acotadas. S-9 lo mide |
| R9 | `facturar()` sin liquidación sigue sin esperar su push (`pos.html:2462`) | Ya existe hoy. Fuera de alcance |
| R10 | La llave legacy de service role deja de inyectarse después de 2026 | Revisar antes de diciembre (§10) |

### Fuentes externas principales

**Supabase**, todas bajo `https://supabase.com/docs/guides/`:

- `realtime/broadcast` (`realtime.send`, público y privado, 3 días de retención);
- `realtime/concepts`, `realtime/authorization`, `realtime/limits`, `realtime/benchmarks`;
- `realtime/getting_started` (llaves legacy hasta fin de 2026);
- `functions/development-tips` (carpeta `_` compartida) y `functions/limits`;
- `platform/manage-your-usage/{realtime-messages, edge-function-invocations, egress}`.

**NXP:**

- NTAG213/215/216 (§8.5.7 AUTH0, §8.8 PWD/PACK y PROT): https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf
- NTAG 424 DNA: https://www.nxp.com/docs/en/data-sheet/NT4H2421Gx.pdf
- AN12196: https://www.nxp.com/docs/en/application-note/AN12196.pdf

**Bre-B y Bancolombia:**

- Documento técnico de Bre-B, feb 2026: https://d1b4gd4m8561gs.cloudfront.net/sites/default/files/publicaciones/archivos/documento-tecnico-bre-b-febrero-2026.pdf
- Blog de Bancolombia: https://blog.bancolombia.com/negocios/preguntas-frecuentes-breb-negocios/
- Enviar con llaves en Mi Bancolombia: https://www.bancolombia.com/centro-de-ayuda/preguntas-frecuentes/como-enviar-plata-transfiya-app-bancolombia

**Normativa:** las fuentes enlazadas en §06.
