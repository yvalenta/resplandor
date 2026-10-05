# Cuenta en mesa: ver en vivo, avisar cómo se paga y roles del POS

> **Software Design Document · v0.5 (con la ola C, §12, y su ronda 3), para aprobación de Yonatan**

La pegatina NFC de cada mesa muestra la cuenta **en vivo** y **solo para ver**. Desde ahí el cliente toca **Pagar** y elige **cómo**: QR, transferencia o efectivo. Eso **crea una alerta** en el POS. El mesero llega con el QR impreso o los datos de la cuenta, o recibe el efectivo, y **cobra y cierra la mesa en el POS**, como siempre. **Nada se cobra ni se cierra desde la pegatina.** La carta solo muestra a dónde pagar (la llave y el QR de Bre-B del restaurante) a quien tiene el enlace de una mesa con la cuenta abierta, y solo si el admin lo encendió (ver el aviso de abajo). El POS pasa a tener dos roles, **mesero** y **admin**, y la base hace cumplir sus permisos.

> **Decisión posterior, 2026-10-02: «Pagar» con QR de Bre-B (reemplaza «la página nunca muestra datos de pago»).** Pedido de Yonatan: «hazlo dinámico y si selecciona pagar, abrir QR de Bre-B» y «ese botón, al convertirse en QR, también debe tener la opción de enviar comprobante al WhatsApp». Ahora, con «Pagar» encendido: (1) la llave y el contenido del QR de Bre-B **no están en el código ni en el repo**: los carga el admin en `ajustes` (`pago_breb_visible`, `pago_breb_llave`, `pago_breb_qr`, migración `20261003150000_pago_breb.sql`, desde Administración → «Ticket y ajustes» → «Pago con Bre-B»); (2) la función `cuenta` los entrega **solo con la cuenta abierta** y el interruptor encendido, en `pago: { breb: { llave, qr } }`, y nunca salen por `carta_publica` ni para `anon` fuera de `cuenta`; (3) al elegir «QR (Bre-B)» la hoja se convierte en el QR (dibujado en el navegador), con la llave y «Copiar llave», y el botón «Enviar comprobante por WhatsApp» (`wa.me` al número de `assets/js/local.js`, con la mesa y el total, sin datos personales); «Transferencia» muestra la llave con el mismo botón; «Efectivo» no cambia; todos avisan al mesero. Sin datos configurados el flujo es el de antes, sin QR ni llave. (4) **La llave que se muestra es la que cobra el QR** (ronda de refutación, 2026-10-02): la base, la función, la carta y el tablero exigen que la llave sea el subcampo 04 del único campo 26 del QR (`ajustes_pago_breb_qr_llave`); si la función no puede leer `ajustes` responde `pago_desconocido: true` y la carta no saca a quien mira el QR. El QR del local es estático (no trae el valor): la hoja le dice al cliente cuánto escribir y le deja copiarlo; un QR con valor fijo o de un solo uso avisa al admin. **Lo que cambia en este documento:** el texto fijo «Esta página nunca muestra datos bancarios ni códigos para pagar» (§03.3 paso 2, A2), §04.6, el principio «La página nunca muestra a dónde pagar», D2, P10 y S2. **Riesgo que se acepta a ojos abiertos (S2):** un clon de la pegatina que copie la carta podría mostrar **otra** llave (antes no podía porque no mostraba ninguna). Lo frena lo mismo de siempre (contraseña de escritura en la NTAG215, revisión diaria de las pegatinas, CORS con lista) y que el QR solo aparece con una cuenta abierta; ya no frena que la página «se delate» por mostrar datos. Es una decisión de Yonatan.

| Versión | Estado | Tarea | Rama | Actualizado |
|---|---|---|---|---|
| 0.1 | Borrador. Lo revisaron dos refutadores: seguridad y dinero, operación y UX | `tareas/2026-09-30-cuenta-en-mesa.md` | `tarea/cuenta-en-mesa` | 2026-09-30 |
| 0.2 | Incorporó los 2 críticos, los 9 altos y los medios baratos (§11). La fase 1 se construye desde aquí | ídem | ídem (desde `3bae016`) | 2026-09-30 |
| 0.3 | Pedidos nuevos de Yonatan: sin propina, Pagar con método → alerta, roles y permisos, carta de escritorio. La fase 2 se reemplaza por las olas A y B (§08). La fase 1 no cambia | ídem | `tarea/cuenta-en-mesa--sdd-v03` (desde `7028919`) | 2026-09-30 |
| 0.3.1 | Las decisiones de Yonatan de la tarde: caja = admin, el mesero crea y edita productos (D21), el mesero ve ventas y cierres (D29), Google sale de Testing solo después de la compuerta (D23), cobro por monto y por unidades. Y lo que la parte A1 construyó distinto del boceto (§04.5) | ídem | `tarea/ola-b--b4-docs-carta` (desde `tarea/ola-b`, `b8cf0b3`) | 2026-09-30 |
| 0.3.2 | Rondas de correcciones de la ola B: tope de 5 alertas por orden en la base (D31), `trg_mesas_token_solo_admin` (D24) y las órdenes cerradas (el mesero no deja una venta cerrada negativa; `aplicar_delta_orden` con `p_solo_abierta`). Sin versión propia del documento: lo anotan las filas de §04.5 | ídem | `tarea/ola-b` | 2026-10-01 |
| **0.4** | **La ola C (§12): el modelo de aprobación del personal (pendiente → aprobado → eliminado), el panel de Mesas y pegatinas, el ticket configurable, deshacer un cobro parcial y el pulido de interacción. Google sale de Testing solo con esta ola al aire (D23). El borrado de las alertas pasa a la base (D28, §12.7). La carta dice con amabilidad «este enlace ya no sirve» para una mesa desactivada, y hay una guía para escribir y rotar las pegatinas (`docs/pegatinas.md`)** | ídem y `tareas/2026-10-01-ola-c.md` | `tarea/ola-c--c4-docs` (desde `tarea/ola-b`, `24487b9`) | 2026-10-01 |
| **0.5** | **Ronda 3 de la ola C:** la decisión de Yonatan «el pedido se podrá deshacer cuando quiera el mesero o el admin» (sin ventana de tiempo; también la mesa completa; `deshechos` y «Cobros deshechos hoy», §12.4), y las correcciones de la refutación (misma mesa, `parcial_de` inmutable, abono exacto, pegatina con el token que se escribió, cerrar con la `version` que se vio, capacidad de 1 a 50) y de la crítica visual | `tareas/2026-10-01-ola-c.md` | `tarea/ola-c` | 2026-10-01 |
| **0.6** | **Ronda 4 de la ola C (segunda refutación):** el **cierre del día es atómico** (`cerrar_dia`, §12.4: una foto vieja ya no borra la cuenta que un mesero acaba de reabrir con «Deshacer»); una cuenta cobrada sin red ya no pierde los ítems agregados sin red cuando la base rechaza el cobro (`RS003`) y el aviso dice la verdad; «Cobros deshechos hoy» lo atribuye la base al cerrar (`deshechos.cierre_id`); el POS solo manda `version` si la base tiene el guardia; `ya_reabierta`; la capacidad de una mesa solo la cambia `mesa_editar` | `tareas/2026-10-01-ola-c.md` | `tarea/ola-c` | 2026-10-01 |
| **0.7** | **Ronda 5 de la ola C (tercera refutación):** se **simplifica** el cierre del día: lo decide la base (`cerrar_dia(p_id, p_esperado)`, §12.4: toma todas las ventas cerradas sin cierre y el admin firma lo que ve), **no hay cierre sin red** (botón apagado con su motivo y «Reintentar subir»), una venta nunca entra en dos cierres (`cierre_ordenes`), los **deltas son idempotentes** (`p_delta_id`, `deltas_aplicados`, `ordenes.deltas_ids`), el POS averigua qué trae la base con un sondeo de columnas (`_sondearBase`) y un guardia de DELETE protege las cuentas abiertas de un POS viejo | `tareas/2026-10-01-ola-c.md` | `tarea/ola-c` | 2026-10-01 |
| **0.8** | **Ronda 5a de la ola C («simplificar»):** se quita máquina en vez de agregar recuperación. El guardia de `ordenes` **rechaza con `RS005`** el cobro de una venta cuyo id ya está archivado (antes lo descartaba en silencio), **reabrir una venta de un cierre pasado exige red y es una sola transacción** (`reabrir_venta_de_cierre`, §12.4), y los **cierres «Sin respaldo» viejos** del POS de antes los decide el admin en una hoja (`cierresViejos`: «Subir las que faltan» o «Descartar este cierre local»); se va la recuperación automática | `tareas/2026-10-01-ola-c.md` | `tarea/ola-c` | 2026-10-01 |

### Pedidos de Yonatan

**Primera tanda, 2026-09-30** (origen de v0.1 y v0.2):

- Cuando el mesero agrega algo, se ve en la pegatina en tiempo real. Es solo para ver, sin permiso de editar.
- Desde la pegatina se puede liquidar la mesa.
- ~~Hay enlaces a las formas de pago, que son Bre-B y cuenta Bancolombia.~~ Lo reemplaza la segunda tanda.

Requisito duro (`tareas/2026-09-30-cuenta-en-mesa.md:26-31`): el cambio llega solo, sin botón. Varios celulares ven lo mismo. El cierre y la rotación del token también se ven en vivo. Si se cae el canal, un sondeo silencioso lo respalda y se avisa «sin conexión».

**Segunda tanda, 2026-09-30** (origen de v0.3), con sus palabras:

- «añade botón pagar con QR, transferencia, efectivo para alertar al mesero que pidieron la cuenta».
- «siendo así se debe añadir una sección de alertas para que el mesero/admin/caja lo sepa».
- «se debe implementar un sistema de permisos básicos: mesero puede editar mesas, añadir productos, cerrar, visualizar; y el admin gestiona todo, incluida la programación del menú semanal, añade meseros, quita meseros».
- «quita todo lo relacionado a que den propina, eso no se hace acá». Ya se quitó de `carta.html` en `tarea/cuenta-hoja` (`83a2f70`).
- «mejora también la versión escritorio» de la carta.

> **Nota sobre la propina (2026-09-30).** Por pedido expreso de Yonatan, en Resplandor no se pide, no se sugiere y no se registra propina. v0.3 la quita de todo el documento: flujos, datos (`ordenes.propina`, `propina_sugerida`, `propina_confirmada`), contratos, decisiones (D4 y D10 de v0.2), normativa, pruebas y costos. Las obligaciones que v0.2 tomaba de la Ley 1935 de 2018 y de la CU de la SIC 2.4.1-2.4.2 (preguntar, publicar la advertencia, repartir) nacían de que el local sugiriera propina. Sin sugerirla, salen del diseño. Es la lectura de esta tarea, no una consulta legal (§10). Lo que había queda en el registro (§11).

Este documento se apoya en lo que ya existe: el token por mesa, la Edge Function `cuenta` y «Mi cuenta» en `carta.html` (`README.md:242-251`). **No lo reemplaza.**

**Qué cambió de v0.2 a v0.3:**

1. **Sin propina** en ningún lado (nota de arriba).
2. **Se retira la fase 2 «liquidar y pagar».** En su lugar va **Pagar con método → alerta → el mesero cobra y cierra en el POS** (§03.3 a §03.5). Salen los datos de pago en la página, el código de 4 dígitos, los reportes «ya pagué», `medios_pago`, `liquidaciones`, `liquidar` y `confirmar_y_cerrar` (registro v0.3, §11).
3. **Sección de alertas en el POS**, con sonido, atender y descartar, en vivo en todas las tablets (§03.4).
4. **Roles `mesero` y `admin`** en `public.personal`, con `public.mi_rol()`. La policy restrictiva `solo_personal` reemplaza a `solo_google`: sin fila activa no hay acceso (§02.2 a §02.5).
5. **El admin gestiona el personal** desde el POS: alta, baja y rol (§02.4).
6. **Carta de escritorio:** a ≥ 1024 px, la cuenta va en un panel lateral (§03.6).
7. **Se rehace §08:** la fase 1 sigue igual, la **ola A** está en curso y la **ola B** espera; se fija el orden seguro de salida al aire. **Se rehace §09** con las decisiones nuevas.

**Qué cambió de v0.3 a v0.3.1** (2026-09-30, por la tarde; las decisiones están en §09 y en el registro, §11):

1. **D21: el mesero SÍ crea y edita productos.** Borrar sigue siendo del admin (§02.2, §02.3, §04.5). Cambia también R-3 (§08).
2. **D19 y D20, cerradas:** caja = admin y el cierre del día es solo del admin.
3. **D29, cerrada:** el mesero ve las ventas del día y el historial de cierres, en solo lectura.
4. **D23, cerrada:** Google OAuth sale de Testing, pero **solo después** de que la compuerta de personal esté aplicada y verificada. Entra al orden de salida al aire como el paso 4 (§02.5 y §08).
5. **Cobro por monto (abono) y por unidades de una línea**, en el POS (§03.5 y §04.8), y la carta muestra el abono (§04.7). Va en la ola B.
6. **`menu.html` sin sesión compartida** con el POS (`persistSession: false`, parte B4).
7. **Sin propina**, confirmado: está fuera de todo (nota de arriba; publicado en `83a2f70`).
8. **Lo que A1 construyó** (`tarea/roles-alertas-bd`, `2d163f5`) difiere del boceto de §04.5 en nombres de archivos y de funciones y en cuatro puntos de fondo. Se lista en la tabla de §04.5, con quién debe cerrar cada uno.
9. **Las líneas de `pos.html` que cita este documento** (`pos.html:2488`, `:2445`…) son de `7028919`. Con `tarea/pos-visual` integrado en `tarea/ola-b` los números cambiaron (por ejemplo, `facturarParcial` pasó de `:2488` a `:4258`, y `liberarMesaVacia` de `:2578` a `:4348`): se busca por nombre de función.

**Qué cambió de v0.3.1 a v0.4** (2026-10-01; el detalle, en §12 y en el registro de §11):

1. **Modelo de aprobación del personal (§12.2).** Quien entra con Google pide acceso y queda **pendiente**; un admin lo aprueba o lo elimina. Un pendiente solo ve el mapa de mesas y la carta. Reemplaza al alta solo por correo como camino normal.
2. **D23, refinada:** Google sale de Testing **solo con la ola C al aire** (antes: después de la compuerta). §02.4, §02.5 y §08.
3. **Mesas y pegatinas (§12.3):** el admin crea, edita, desactiva y rota mesas, y escribe y revisa la pegatina desde el POS con Web NFC. Una mesa desactivada es un enlace inválido. Guía: `docs/pegatinas.md`.
4. **Deshacer un cobro, sin ventana de tiempo (§12.4):** un parcial, un abono o la mesa completa; el admin y el mesero, cuando quieran. Cada deshacer queda en `deshechos` y el admin lo ve en el cierre del día (D34 y D37, cerradas).
5. **Ticket configurable (§12.5)** y **pulido de interacción (§12.6).**
6. **D28 construida (§12.7):** las alertas resueltas se borran solas pasado un día.
7. **La compuerta ya está al aire** (2026-09-30, de noche), con Yonatan como único admin (§08, «Orden de salida al aire»).
8. **Correcciones de textos viejos** de la ola B: el token de la mesa ya lo protege la base (§02.2), y el borrado de alertas ya no depende del cierre del día.

> **Línea Roja** (`~/Developer/sigilo/LINEA_ROJA.md`). Ningún agente hace estas cosas; quedan para Yonatan:
> - aplicar migraciones en `lccgehvyymladqvumcez`, desplegar funciones o hacer push;
> - el alta inicial del personal. Los correos reales **nunca** van al repo, que es público (`privacy.html:79`);
> - tocar identidad: Google Cloud (modo Testing o producción, usuarios de prueba) y el registro de Auth;
> - poner contraseña a las pegatinas;
> - mover dinero. Cobrar es del mesero, nunca de un agente ni de la página.
>
> Todo se prueba en local: Postgres 17 desechable en Docker con los roles de Supabase simulados, y Playwright con la red simulada (§08).

---

## Contenidos

1. [Objetivo y alcance](#01--objetivo-y-alcance)
2. [Actores, roles y permisos](#02--actores-roles-y-permisos)
3. [Flujos, estados y errores](#03--flujos-estados-y-errores)
4. [Arquitectura](#04--arquitectura)
5. [Seguridad](#05--seguridad)
6. [Normativa y UX](#06--normativa-y-ux)
7. [Costos frente al plan Free](#07--costos-frente-al-plan-free)
8. [Fases, olas y partición en worktrees](#08--fases-olas-y-partición-en-worktrees)
9. [Decisiones abiertas](#09--decisiones-abiertas)
10. [sin_dato](#10--sin_dato)
11. [Registro](#11--registro)
12. [Ola C: aprobación, mesas y pegatinas, ticket y deshacer](#12--ola-c-aprobación-del-personal-mesas-y-pegatinas-ticket-y-deshacer-cobros)

---

## 01 — Objetivo y alcance

### Objetivo

Hay cinco resultados que se pueden medir:

1. **En vivo** (fase 1, sin cambios). Un ítem que el mesero agrega aparece en el teléfono en **≤ 2 s (p95)** si es un cambio aislado. Si llega en una ráfaga, el último aparece en ≤ 4 s. Hoy puede tardar 10 s, por el sondeo que dejó `be68c6b` (`carta.html:404`, `:525-552`). Si el canal se cae o enmudece, la carta lo detecta, lo dice y pasa a sondeo.
2. **Pagar avisa.** El cliente toca Pagar y elige QR, transferencia o efectivo. En **≤ 2 s (p95)**, todas las tablets del POS muestran la alerta con la mesa y el método, y suenan.
3. **El mesero cobra y cierra.** Atiende la alerta, cobra con el método elegido y cierra la mesa con «Facturar», como hoy. La alerta se cierra sola al cerrar la orden. Ninguna página muestra a dónde pagar.
4. **Roles.** Una cuenta de Google que no está activa en `personal` no lee ni escribe nada del POS. El mesero no puede borrar productos, ni cambiar el menú semanal, ni escribir cierres, ni tocar el personal, **ni siquiera llamando a la API a mano**: lo impide la base. Sí crea y edita productos (D21).
5. **Escritorio.** A ≥ 1024 px, la carta usa el ancho de la pantalla. Con un enlace de mesa válido, la cuenta queda en un panel lateral siempre visible. A 320 px no se rompe nada.

### Qué entra y qué no

| Entra (fase 1 y olas A y B) | No entra |
|---|---|
| Cuenta en vivo, de solo lectura, con sondeo de seguridad cada 60 s y respaldo a 20 s (fase 1) | **Propina**, de ninguna forma (nota del encabezado) |
| «Pagar» con tres métodos, que crea o actualiza **una** alerta pendiente por mesa | **Datos bancarios, llaves o QR de pago en la página** (§04.6) |
| Sección de alertas en el POS: píldora, insignia en la mesa, lista, sonido, atender y descartar, en vivo | Cobro o confirmación automática: pasarela, webhook, QR dinámico (fase 3) |
| La alerta se cierra sola al facturar o al liberar la mesa | Que el cliente agregue o quite ítems (peldaño 3, `tareas/2026-09-06-carta-nfc-y-cuenta.md:120`) |
| Roles `mesero` y `admin`, con RLS por rol y por operación | Un rol «caja» aparte. Por ahora, caja = admin (D19) |
| Gestión del personal por el admin y arranque seguro, sin dejar a nadie afuera | Asignar mesas a meseros: todos ven todas las alertas |
| Carta de escritorio con la cuenta en un panel lateral | Dividir la cuenta por ítems desde la pegatina. El POS ya cobra por partes (`pos.html:2488`) |
| Contraseña de escritura en las pegatinas (D16) y presencia del POS privada (D17) | Facturación electrónica DIAN (`README.md:78`) |
| Cobro por monto (abono) y por unidades de una línea, en el POS, y la carta que muestra el abono (§03.5) | |
| CORS con lista y rate-limit en `cuenta` y en `alerta` | Rotar el token en cada cierre con las NTAG215 de hoy (§03.7) |
| | Exponer `alerta` a agentes (WebMCP, MCP, `llms.txt`) |

---

## 02 — Actores, roles y permisos

### 02.1 Actores

| Actor | Cómo entra | Qué ve | Qué puede hacer | Qué no puede hacer |
|---|---|---|---|---|
| **Cliente en la mesa** (rol `anon`) | Toca la pegatina o escanea el QR de respaldo: `carta.html?m=<mesa>&k=<token>` (`README.md:251`). Usa la llave *publishable*, sin login | La carta. La orden **abierta** de su mesa: ítems agrupados por nombre y precio, total y hora | Tocar Pagar y elegir el método. Eso crea o actualiza la alerta, siempre a través de `alerta` | Ver datos de pago (no existen en la página), editar ítems, cerrar la mesa, ver otras mesas, leer tablas |
| **Quien guardó el enlace o fotografió el QR** («fuga aceptada», `cuenta/index.ts:10-14`) | El mismo enlace, desde fuera del local | Lo mismo que el cliente | Lo mismo, incluido avisar. Lo acotan el tope de 5 alertas por orden, el rate-limit y «Descartar» (§05, S1 y S4) | Lo mismo que el cliente |
| **Mesero** (rol `authenticated` con Google y fila activa con `rol = 'mesero'`) | `pos.html` | Todo el POS (§02.2), con las ventas y los cierres en solo lectura (D29) | Operar mesas y órdenes, cobrar y cerrar (por ítems, por unidades o por monto), atender alertas, **crear y editar productos (D21)** | Borrar productos, tocar el menú semanal, escribir cierres (el del día o uno pasado), reabrir o editar una orden cerrada, leer las sugerencias o tocar el personal (§02.2) |
| **Admin** (ídem, con `rol = 'admin'`). Hoy, Yonatan y Camila (D22) | `pos.html` | Todo | Todo lo del mesero, más borrar productos, menú semanal, cierre del día (caja = admin, D19 y D20), sugerencias y personal | Dejar el sistema sin ningún admin activo (§02.4) |
| **Cuenta de Google sin fila activa** | `pos.html` | La pantalla «Tu cuenta no está habilitada» | Cerrar sesión | Leer o escribir cualquier tabla del POS (`solo_personal`, §02.3) |
| **Cuenta pendiente** (ola C) | `pos.html`, con una cuenta de Google que pidió acceso con `solicitar_acceso()` y que ningún admin ha aprobado | «Tu cuenta espera aprobación», el mapa de mesas (número, capacidad, libre u ocupada) y la carta | Mirar, y cerrar sesión | Leer o escribir cualquier tabla (`mi_rol()` es `null`, §12.2); ver cuentas, totales, tokens o personal |
| **Camila** (dueña y admin) | El POS, y la app del banco como titular | Las notificaciones de abono del banco | Verificar transferencias (D1), dar de alta al personal, programar el menú, cerrar el día | — |
| **Yonatan** (admin) | POS, dashboard y SQL Editor de Supabase, GitHub, Google Cloud, app de NFC | Todo | El alta inicial, migrar, desplegar y hacer push, la contraseña de las pegatinas, Google Cloud. Todo con su GO. El SQL Editor es la puerta de atrás si nadie puede entrar (§02.5) | — |
| **Edge Function `cuenta`** (service role) | GET público, `verify_jwt` apagado | `mesas` y `ordenes`. Desde B3, también la alerta de la orden | Solo leer | Escribir |
| **Edge Function `alerta`** (service role) | POST público, `verify_jwt` apagado | — | Ejecutar **solo** `public.alerta_cliente(...)` (§04.5) | Tocar ítems, totales o el estado de la orden o la mesa |
| **Atacante con una pegatina encima o reescrita** | Un clon en otro dominio | Lo que lee de la pegatina real: el token | Mostrar la cuenta real **y datos bancarios propios**, algo que la página real nunca hace (§05, S2) | Reescribir la pegatina real si tiene contraseña (D16). Leer las funciones desde un navegador en otro origen (CORS) |

**Regla que no cambia** (`README.md:227-229`): `anon` sigue sin policies ni GRANT sobre las tablas del POS, y tampoco los tiene sobre las nuevas (`personal` y `alertas`). Todo lo que ve o hace el cliente pasa por `cuenta` o `alerta`, que validan el par `(mesas.id, mesas.token)`.

### 02.2 Roles: qué puede hacer cada uno en el POS

Hoy «cualquier cuenta de Google autorizada tiene acceso total» (`README.md:72`; pendiente en `README.md:423`). v0.3 define dos roles. **«Caja» es admin** (D19, cerrada): el cierre del día y los cierres pasados son del admin (D20, cerrada).

| Capacidad en el POS | Mesero | Admin | Dónde engancha hoy |
|---|---|---|---|
| Entrar al POS | Con fila activa | Con fila activa | La puerta de sesión (`pos.html:3096`), más `solo_personal` |
| Ver mesas, órdenes, productos, menús, votos, **ventas del día y el historial de cierres** | Sí. Las ventas y los cierres, en solo lectura (D29) | Sí | `sincronizarSupabase` (`pos.html:2016`) y `cargarMenuSemanal` (`:2893`) |
| Abrir mesa, agregar y quitar ítems, «Ítem manual», notas, «Persona N» | Sí | Sí | `agregarProducto` (`:2362`), `agregarItemManual` (`:2429`) y las RPC de deltas |
| Editar la mesa (estado, capacidad) | Sí | Sí | `pushASupabase('mesas')` (`:2130`) |
| Cobrar y cerrar («Facturar»), imprimir la pre-cuenta | Sí | Sí | `facturar` (`:2445`), `imprimirPreCuenta` (`:2622`) |
| **Cobrar por partes**: por ítems, **por unidades de una línea** y **por monto** (abono, §03.5) | Sí | Sí | `facturarParcial` (`:2488`) y el cobro por monto (nuevo, B1) |
| Liberar una mesa vacía (abierta y sin ítems) | Sí | Sí | `liberarMesaVacia` (`:2578`) |
| Reabrir, editar o eliminar una orden **cerrada**: una venta del turno o de un cierre pasado | **No** (lo construyó A1, §04.5) | Sí | `reabrirOrden` (`:2689`), `editarOrdenDeCierre` (`:2766`), `eliminarOrdenDeCierre` (`:2797`) |
| Ver y copiar el enlace NFC de la mesa | Sí | Sí | `enlaceMesa` (`:2598`) |
| Rotar el token de la pegatina | No (D24). **La base lo impide**: `trg_mesas_token_solo_admin` conserva el token viejo (§02.3, nota 2) | Sí | `rotarTokenMesa` (`:2612`) |
| **Aprobar o eliminar personal** y ver las solicitudes pendientes (ola C) | No | Sí | `aprobarPersonal`, `eliminarPersonal` (§12.2) |
| **Mesas y pegatinas**: crear, editar, desactivar, escribir y revisar (ola C) | No | Sí | `crearMesa`, `editarMesa`, `activarMesa`, `escribirPegatina`, `revisarPegatina` (§12.3) |
| **Ajustes del ticket** (ola C) | No | Sí | `guardarAjustes` (§12.5) |
| **Deshacer un cobro** (ola C): un parcial, un abono o la mesa completa | Sí, en cualquier momento mientras el cobro siga en el turno (sin ventana de tiempo) | Sí, en cualquier momento | `deshacerUltimoCobro`, `devolverACuenta` (§12.4) |
| Ver «Cobros deshechos hoy» en el cierre del día (ola C) | No | Sí | `cargarDeshechos`, tabla `deshechos` (§12.4) |
| Ver, atender y descartar alertas | Sí | Sí | Nuevo (§03.4) |
| **Crear y editar productos** (catálogo y precios) | **Sí (D21, cerrada)** | Sí | `abrirModalProducto` (`:2844`) y `guardarProducto` (`:2868`) |
| **Borrar productos** | No | Sí | `eliminarProducto` (`:2854`) |
| Programar el menú semanal: crear, editar, activar, borrar, generar la semana | No | Sí | `guardarMenu` (`:2974`), `toggleActivoMenu` (`:2999`), `eliminarMenu` (`:3009`) y `generarSemana` (`:3022`) |
| Leer las sugerencias de platos | No | Sí | `cargarMenuSemanal` (`:2916`) |
| Cierre del día (caja = admin) | No (D20, cerrada) | Sí | `cerrarDia` (`:2804`) |
| Gestionar el personal: alta, baja y rol | No | Sí | Nuevo (§02.4) |

Esconder en la interfaz es una comodidad. La regla real la pone la base (§02.3): un mesero que llame a la API a mano recibe `42501` si es un `insert`, y 0 filas, en silencio, si es editar o borrar. La rotación del token, que en v0.3.1 era la excepción, ya la impide la base (§02.3, nota 2).

**Lo que el mesero cambia en el catálogo sale en público** (D21): `carta_publica` alimenta la carta, la landing y el MCP. Un precio mal puesto se ve afuera en el acto. Es un riesgo aceptado por Yonatan (R13, §11); el admin lo corrige y es el único que borra.

### 02.3 Permisos por tabla y operación

| Tabla u objeto | Operación | `anon` | Mesero | Admin | `service_role` | Nota |
|---|---|---|---|---|---|---|
| `productos` | select | No. Lee la vista `carta_publica` | Sí | Sí | Sí | |
| | insert, update | No | **Sí (D21)** | Sí | Sí | Policies con `mi_rol()` en (`admin`, `mesero`). Incluye el `upsert` del POS |
| | delete | No | **No** | Sí | Sí | Policy con `mi_rol() = 'admin'` |
| `mesas` | select | No | Sí | Sí | Sí | |
| | insert | No | Solo si el id ya existe, por el upsert del POS (nota 1) | Sí | Sí | |
| | update | No | Sí. **El token también** (D24, nota 2) | Sí | Sí | Renumerar una mesa (cambiar `id`) es solo del admin |
| | delete | No | No | No | Sí | Sin GRANT, como hoy |
| `ordenes` | select, insert | No | Sí | Sí | Sí | Las ventas del día (cerradas) las ve todo el personal |
| | update | No | **Solo órdenes abiertas** (nota 5) | Sí | Sí | Cobrar es un `update` de abierta a cerrada: pasa. Una venta cerrada ya no |
| | delete | No | Solo una orden abierta y vacía (liberar mesa) | Sí | Sí | El admin también hace la purga del cierre |
| `cierres` | select | No | Sí (D29) | Sí | Sí | |
| | insert, update | No | **No** | Sí | Sí | Cierre del día y cierres pasados |
| | delete | No | No | No | Sí | Sin GRANT, como hoy |
| `menus` | select | Sí (votación pública) | Sí | Sí | Sí | `menus_select_publico` sigue igual |
| | insert, update, delete | No | **No** | Sí | Sí | |
| `elecciones_menu`, `reacciones_menu` | select | Sí | Sí | Sí | Sí | Sin cambios. Los votos entran por `votar` |
| `sugerencias_plato` | select | No | **No** | Sí | Sí | Entran por `votar` |
| `personal` | select | No | Solo su fila | Sí | No (nota 6) | |
| | insert, update, delete | No | No | **Solo por las RPC** `personal_alta`, `personal_baja` y `personal_cambiar_rol`, sin dejar 0 admins activos | No | Sin policy de escritura: solo las RPC (`ultimo_admin`) |
| `alertas` | select | No | Sí | Sí | Sí | |
| | insert, update | No | **Solo por las RPC** `atender_alerta` y `descartar_alerta`, de `pendiente` a `atendida` o `descartada` | Ídem | Sí, `alertar_cuenta` crea y actualiza | La RPC sella `atendida_en` y `atendida_por` con el correo de Google de quien llama (nota 6) |
| | delete | No | No | **Sin policy ni GRANT** (nota 6) | No | D28 (v0.4, §12.7): las no pendientes con más de un día las borra la base sola, sin puerta para el POS |
| RPC `aplicar_delta_orden`, `actualizar_nota_item` | execute | No | Sí | Sí | Sí | `security invoker`: les aplica la RLS de `ordenes` |
| RPC `mi_rol()` y `mi_correo()` | execute | No | Sí | Sí | `mi_rol()`: Sí | El POS llama a `mi_rol()` para saber qué mostrar |
| RPC `personal_alta`, `personal_baja`, `personal_cambiar_rol` | execute | No | Sí, pero responde `no_autorizado` | Sí | No | Revisan el rol dentro, después de tomar un candado de transacción |
| RPC `atender_alerta` y `descartar_alerta` | execute | No | Sí | Sí | No | Responden `{ok, codigo?}`; `no_pendiente` si otra tablet llegó antes |
| RPC `alertar_cuenta(p_mesa, p_token, p_metodo)` | execute | No | No | No | Sí | `security invoker`. Solo la llama la función `alerta` (§04.4). Antes se llamaba `alerta_cliente` |
| Vista `carta_publica` | select | Sí | Sí | Sí | — | Sin cambios |

1. **`pushASupabase` hace `upsert`** (`pos.html:2138`). En Postgres, `INSERT … ON CONFLICT DO UPDATE` exige el privilegio y la policy de INSERT aunque la fila ya exista. Por eso el mesero necesita INSERT en `mesas` y en `ordenes`. El POS no tiene botón para crear mesas. Si algún día se quiere «crear mesa = admin», primero hay que cambiar ese push a `update`; 1D ya lo toca.
2. **El token de la mesa** no se protege con un GRANT por columna, porque mesero y admin son el mismo rol de Postgres (`authenticated`). El boceto de v0.3 lo protegía con un trigger `BEFORE UPDATE` que **conserva el token viejo** cuando lo cambia alguien que no es admin, sin romper el upsert. **A1 no lo construyó** (§04.5) y **la ronda 2 de la ola B sí**: `trg_mesas_token_solo_admin` en `permisos_por_rol`. Antes, la base dejaba que cualquier persona del personal edite `mesas`, token incluido, y la rotación (D24) solo la escondía el POS. Lo que sí queda es 1D: el POS ya no sube el token en el `upsert`, así que una caché vieja no deshace una rotación. Un mesero que llame a la API a mano podría rotarlo.
3. **Restrictiva.** Las tablas que hoy llevan `solo_google` (`20260905000000_resplandor_base.sql:271-280`) pasan a `solo_personal`: `as restrictive … using ((select public.mi_rol()) is not null)`, y exige además el proveedor Google. Cubre `productos`, `mesas`, `ordenes`, `cierres`, `sugerencias_plato`, `alertas` y `personal`; en **`menus` solo cubre las escrituras**, porque `menu.html` lee `menus` como `anon` y como `authenticated`. `mi_rol()` exige Google y reconoce a la persona por su identidad de Google (§04.5).
4. **Realtime** aplica la RLS en `postgres_changes`. Una cuenta sin fila, o dada de baja, deja de recibir cambios de `mesas`, `ordenes`, `productos` y `alertas`.
5. **Una orden cerrada solo la toca el admin** (decisión de A1, de su refutación, no de Yonatan): sin esto, un mesero podía reabrir una venta cerrada, vaciarla y borrarla. Consecuencias: «Editar» y «Reabrir» de las transacciones del turno son del admin, y el POS debe esconderlas al mesero (B2). El mesero sigue cobrando: es un `update` de una orden que está abierta.
6. **`personal` y `alertas` se escriben por RPC**, no por `insert` o `update` directos, y devuelven `{ok, codigo?}` en vez de lanzar. `atendida_por` es el correo de la **identidad de Google** de quien llama (`mi_correo()`), o `sistema` si la alerta se cerró sola al facturar o al liberar la mesa. Para `service_role`, `personal` no tiene ni GRANT: el alta inicial se hace en el SQL Editor, que corre como `postgres`.

### 02.4 Gestión del personal (admin)

Hay una vista nueva, «Personal», solo para el admin (parte B2). Escribe con tres RPC (`personal_alta`, `personal_baja` y `personal_cambiar_rol`), que responden `{ok, codigo?}` y revisan el rol dentro, después de tomar un candado de transacción: dos admins que se quitan el rol a la vez no pueden dejar el sistema sin admin.

- **Lista:** nombre, correo, rol, activo y fecha de alta. Los activos van primero.
- **Alta:** correo de Google (el principal de la cuenta), nombre y rol, con `mesero` por defecto. La RPC normaliza el correo (`trim` y minúsculas) y la tabla lo exige (`check (email = lower(email))`). Si el correo ya existe dado de baja, el mismo `personal_alta` lo reactiva y le pone el nombre y el rol nuevos; el POS lo ofrece como «Reactivar». Si ya está activo, responde `ya_existe`.
- **Baja:** `activo = false`, con confirmación. La fila no se borra: queda el historial y se puede reactivar. **Surte efecto en la siguiente consulta de esa persona**, no cuando vence su sesión, porque `mi_rol()` lee la tabla cada vez. Su POS pasa a «sin acceso» al revalidar el rol (§03.8).
- **Cambiar de rol:** de mesero a admin o al revés, con confirmación.
- **Nunca cero admins.** La baja o el cambio de rol que dejaría la tabla sin admins activos responde `ultimo_admin` (la guarda vive dentro de las RPC; el boceto de v0.3 hablaba de un trigger diferido). El POS deshabilita esos botones en el último admin y explica por qué.
- **Lo que el admin no puede hacer solo, mientras Google siga en Testing.** La persona también tiene que estar en «Audience → Test users» de Google Cloud (`README.md:239-241`), y eso lo hace Yonatan. **D23 (cerrada, 2026-09-30):** Google sale de Testing, para que baste con el alta del admin, pero **solo después de que la compuerta esté aplicada y verificada** (§02.5). Antes de eso, publicar abre el POS a cualquier cuenta de Gmail, porque `solo_google` solo mira el proveedor. **Refinada en v0.4:** Yonatan precisó que sale **solo con la ola C al aire**, cuando quien llega sin permiso queda pendiente y ve el mapa y la carta en vez de un callejón sin salida (§12.2). **Con la ola C, el alta por correo deja de ser el camino normal:** la persona pide acceso y el admin la aprueba.
- **Privacidad.** El correo y el nombre del personal son datos personales (Ley 1581). Solo los ve el admin; el mesero ve su propia fila. `personal` no entra en la publicación de Realtime ni en ningún contrato público.

### 02.5 Arranque seguro de los roles

El riesgo: si la compuerta entra antes que las filas, **nadie** entra al POS, y puede pasar en pleno servicio. A1 lo resolvió juntando la compuerta y el alta en **una sola transacción**, que se niega a correr sin un admin que pueda entrar. Este es el orden seguro:

1. **La compuerta y el alta inicial, juntas** (`20261002120000_personal_y_compuerta.sql`, ola A, después de las 17:00). Crea `personal` (vacía), `mi_correo()`, `mi_rol()`, las RPC de personal y `solo_personal`, y **no toca las policies permisivas de hoy**: el POS sigue igual para todo el personal dado de alta, admin o mesero, con acceso completo. Lo que cambia es que quien no está en `personal` queda afuera, al instante. El alta es **un SQL aparte que pega Yonatan en el SQL Editor** (corre como `postgres` y se salta la RLS), **fuera del repo** (los correos reales nunca van en un repo público). Va **todo el personal actual**, no solo los admins: quien falte se queda afuera. La plantilla, sin un solo correo real:
   ```sql
   begin;
   select set_config('resplandor.admins_iniciales', '<correo de Google de Yonatan>, <correo de Google de Camila>', true);
   -- <aquí, el texto completo de la migración personal_y_compuerta>
   insert into public.personal (email, nombre, rol) values
     (lower('<correo de Google de cada mesero>'), '<nombre>', 'mesero')
   on conflict (email) do update set rol = excluded.rol, nombre = excluded.nombre, activo = true;
   commit;
   ```
   La migración lee los admins de ese ajuste de la sesión y **se niega a correr, antes de tocar una sola policy**, si no queda al menos un admin activo **con una cuenta de Google real en el proyecto** (`auth.identities`): un correo mal escrito, o de alguien que nunca entró con Google, no cuenta, y el error lista en el `HINT` las cuentas de Google que sí existen. Un marcador sin reemplazar (`<correo…>`) falla igual. Los meseros van en la misma transacción, no después.
2. **Verificar** que el admin sí entra, sin salir de la sesión. `mi_rol()` reconoce a la persona por su identidad de Google y no por un `jwt` simulado, así que la prueba es desde el POS: con la sesión de un admin abierta en `pos.html`, en la consola, `await window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY).rpc('mi_rol')` debe devolver `{ data: 'admin' }`. Un `{ data: null }` es «sin acceso»: se aplica la reversa antes de que lo note nadie. Y una cuenta de Google que no esté en la lista debe ver cero filas en las tablas del POS (R-0). «Recargar y mirar si carga» **no** sirve fuera de servicio: sin órdenes abiertas, las mesas salen de la caché.
3. **Google fuera de Testing (D23)**. *(v0.4: se mueve al final de la ola C, §08 y §12.2; lo de abajo describe por qué hace falta la compuerta antes.)* Con la compuerta verificada, una cuenta de Google cualquiera no ve nada, y publicar el cliente de OAuth (Google Cloud → Audience → «Publish app») deja de abrir el POS a cualquier Gmail. Es identidad: lo hace Yonatan. Si algo sale mal, se vuelve a Testing y se aplica la reversa de la compuerta (§10 anota que no se verificó que la consola permita volver).
4. **Las alertas** (`20261002130000_alertas.sql`) se aplican cuando se quiera: se niegan a correr sin la compuerta y no cambian nada visible para el POS de hoy. La función `alerta` se despliega después, porque llama a `alertar_cuenta`.
5. **Los permisos por rol van después, junto con el POS que los entiende** (ola B). Primero se publica el POS de la ola B, que ya le esconde al mesero lo de admin. Después se aplica `20261002140000_permisos_por_rol.sql`. Al revés, el POS de hoy le mostraría al mesero botones que la base rechaza **en silencio**: `eliminarProducto`, `cerrarDia` o la edición de un cierre cambiarían el estado local sin que la base lo acepte, hasta la siguiente sincronización. Y con el cierre del día pasaría algo peor: «Reabrir en mesa» de un cierre hace `insert` de una orden abierta (pasa) y luego `update` del cierre (lo rechaza la RLS), así que la misma venta queda en el cierre viejo y en `ordenes`, y el próximo cierre del día la cuenta dos veces.

**Reversas, en menos de 1 minuto:**

- **La compuerta:** el bloque comentado en la cabecera de la migración. Borra `solo_personal` y recrea `solo_google` tal como está en `20260905000000_resplandor_base.sql:271-280`. Deja `personal` y las funciones sin uso; las policies permisivas nunca se tocaron.
- **Las alertas:** el bloque comentado de su cabecera (triggers, publicación de Realtime, tabla y funciones).
- **`permisos_por_rol`:** el bloque comentado de su cabecera. Recrea las policies `authenticated full access …`, `menus_admin` y `sug_admin`, y deja a `solo_personal` en pie.
- **Si nadie puede entrar** (por ejemplo, por un correo mal escrito): el SQL Editor sigue funcionando porque corre como `postgres`. Se corrige la fila con un `insert` o `update` directo sobre `public.personal` desde el editor (las RPC de personal no sirven ahí: revisan `mi_rol()`, y el editor no es una sesión de Google), o se aplica la reversa.

---

## 03 — Flujos, estados y errores

### 03.1 Estados de la alerta (tabla `alertas`)

```
                  toque en Pagar (cliente)                    «Atender» (mesero o admin)
 (sin pendiente) ────────────────────────► pendiente ──────────────────────────────────► atendida
                                           │  ▲  │      «Facturar» cierra la orden (trigger) ──► atendida
                                           │  └──┘ otro toque: cambia el método y la hora
                                           │
                                           ├── «Descartar» (mesero o admin) ─────────────────► descartada
                                           └── se borra la orden (liberar mesa vacía) ───────► descartada
```

| Estado actual | Toque del cliente (`alerta`) | «Atender» | «Descartar» | Facturar (la orden pasa a cerrada) | Liberar mesa vacía (DELETE de la orden) |
|---|---|---|---|---|---|
| La mesa no tiene pendiente | Crea una `pendiente` si hay orden abierta y no se pasa el tope. Si no, 409 o 429 | — | — | No hace nada | No hace nada |
| `pendiente` | Actualiza `metodo` y `creada_en`. Sigue siendo **una** fila | → `atendida`, con `atendida_por` = quien tocó | → `descartada` | → `atendida`, con `atendida_por` = quien facturó | → `descartada` |
| `atendida` o `descartada` | No la toca: crea otra `pendiente`, que cuenta para el tope | No hace nada (0 filas) | No hace nada | No hace nada | No hace nada |

- **Una sola pendiente por mesa**, con el índice único parcial `(mesa_id) where estado = 'pendiente'`.
- **Tope en la base: 5 alertas por orden**, contando las atendidas y las descartadas. El sexto aviso de la misma orden da 429 `tope`, porque el mesero ya está avisado. Actualizar la pendiente no suma.
- Una alerta cerrada no vuelve a `pendiente`: lo impide el trigger de sellado. Reabrir una orden no reabre sus alertas.

### 03.2 Flujo A: ver la cuenta en vivo (fase 1, sin cambios)

1. El cliente toca la pegatina y se abre `carta.html?m&k`. Con un par válido aparece «Ver mi cuenta · Mesa N» (`carta.html:248-262`).
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

### 03.3 Flujo B: Pagar con método → alerta (ola A, en la carta)

1. Si la orden está abierta y tiene al menos un ítem, el pie de la hoja (o del panel lateral, §03.6) muestra **«Pagar»** como acción principal, bajo el total. «Listo» pasa a ser secundaria.
2. Al tocarlo, en la misma hoja aparece **«¿Cómo quieres pagar?»** con tres botones del mismo peso visual, **ninguno preseleccionado** y de al menos 44 px de alto:
   - **QR:** «El mesero te trae el código para escanear con la app de tu banco»;
   - **Transferencia:** «El mesero te da los datos de la cuenta»;
   - **Efectivo:** «El mesero viene a recibirlo».

   *(Reemplazado el 2026-10-02 por el pago con Bre-B: ver el aviso del inicio.)* Debajo iba un texto fijo: **«Esta página nunca muestra datos bancarios ni códigos para pagar.»** Y un «Cancelar», que vuelve a la cuenta sin avisar a nadie.
3. Tocar un método es la confirmación. La carta hace `POST alerta {m, k, metodo}` (§04.4). El botón dice «Avisando…» y queda deshabilitado (`aria-busy`).
4. Con un 200, la hoja pasa al estado **avisado**: «Listo, le avisamos al mesero. Pagarás con **QR**», con la hora («13:42») y «Si en 3 minutos nadie viene, hazle una seña». A los 3 minutos cambia a «¿Nadie vino? Hazle una seña al mesero». Todo se anuncia en `role="status" aria-live="polite"`. Un enlace «Cambiar método» vuelve al paso 2; el toque nuevo **actualiza** la misma alerta.
5. El estado avisado se guarda en `sessionStorage['alerta:'+mesa]`, con el método, la hora y la orden (`orden_id` si `cuenta` lo trae; si no, `abierta_en`). Así sobrevive a una recarga, o a que iOS descarte la pestaña. Se borra cuando la cuenta pasa a `cerrada` o `sin_orden`, o cuando cambia la orden.
6. **Varios teléfonos.** Hasta la parte B3, cada teléfono solo sabe de su propio aviso. Si otro teléfono toca Pagar, actualiza la misma alerta (hay una por mesa) y el POS ve el último método. Con B3, `cuenta` trae la alerta: todos los teléfonos ven «Ya avisamos: QR · 13:42» y, cuando alguien la atiende, «El mesero ya vio el aviso».
7. **Errores** (detalle en §03.8):
   - 409 `sin_cuenta`: «Todavía no hay cuenta abierta», y la carta lee de nuevo;
   - 404: «Este enlace ya no sirve. Pídele al mesero que te atienda» (el de la hoja de la cuenta, v0.4, dice además que la mesa puede estar fuera de servicio);
   - 429: «Ya le avisamos hace un momento. Si nadie viene, hazle una seña»;
   - 503 `apagado`, red caída o 5xx: «No pudimos avisar desde aquí. Hazle una seña al mesero».
8. Cuando el mesero cierra la mesa, la fase 1 lo refleja: «Mesa cerrada. ¡Gracias!».

**Por qué no había datos de pago** (§04.6). *(Reemplazado el 2026-10-02 por el pago con Bre-B: ver el aviso del inicio.)* Una página que nunca muestra a dónde pagar no se puede suplantar cambiando la llave. Y el cliente tiene una regla simple para desconfiar de un clon: si una pantalla de la pegatina le pide transferir a algún lado, no es Resplandor.

> **Cambio del 2026-10-04 (tareas/2026-10-04-hallazgos-domingo.md, 5):** ya no se elige el método. «Pagar» abre una sola pantalla
> (QR, llave, valor, comprobante y «O en efectivo») y avisa sola con el método `cuenta` («pide la cuenta», migración
> `20261005110000_alerta_pedir_cuenta.sql`, `METODOS` de `alerta/logica.ts`); copiar la llave o el valor, o abrir el comprobante,
> afinan la misma alerta pendiente a `transferencia`, y «Avisar que pago en efectivo» a `efectivo`. El POS muestra «Pide la cuenta ·
> cómo paga, por confirmar» mientras el método sea `cuenta`.

### 03.4 Flujo C: la sección de alertas del POS (ola B)

**Dónde aparece.** Las clases son las de `tarea/pos-visual` (`docs/pos-visual.md` §3.8).

- **Píldora «N por cobrar»** en la barra (`.nav-pill-aviso`), en todas las vistas y para los dos roles. Al tocarla, abre la vista Alertas.
- **Insignia en la tarjeta de la mesa** del mapa: «Pide la cuenta · QR», con el ícono del método. Sigue el patrón de `.mesa-presence` (`pos.html:3247-3251`).
- **Franja en la orden** (`.aviso-atencion`) cuando la orden abierta tiene una alerta pendiente: «Esta mesa pidió la cuenta · Transferencia · hace 2 min», con «Atender».
- **Vista «Alertas»** (`vista === 'alertas'`), con una pestaña nueva en la barra (`pos.html:3184-3203`):
  - **Pendientes**, de la más vieja a la más nueva. Cada tarjeta muestra la mesa, el método (ícono y texto), el **total actual de la orden** según el POS (lo que hay que cobrar) y «hace X min». Ese tiempo se recalcula cada 30 s y pasa a maíz a los 3 minutos. Tiene tres acciones: «Ir a la mesa», **«Atender»** y **«Descartar»**, esta última con la confirmación «¿Falsa alarma?».
  - **Hoy:** las atendidas y descartadas del día, con quién las cerró y cuánto se tardó.

**Qué ve cada rol:**

| | Mesero | Admin (= caja, D19) |
|---|---|---|
| Píldora, insignia, franja y sonido | Sí | Sí |
| Pendientes de **todas** las mesas | Sí. No hay asignación de mesas | Sí |
| Atender y descartar | Sí | Sí |
| «Hoy», con quién atendió | Sí | Sí |
| Mediana del tiempo de respuesta del día | No | Sí |
| Borrar el historial | No | Al cerrar el día (D28) |

**Atender y descartar:**

- **«Atender»** quiere decir «voy yo»: les avisa a las otras tablets que alguien ya la tomó. **No cobra ni cierra**; eso lo hace «Facturar» (§03.5).
- Las dos acciones llaman a una RPC, `atender_alerta(p_id)` o `descartar_alerta(p_id)`, que solo resuelve una alerta que sigue `pendiente`. Si otra tablet llegó antes, responde `{ok:false, codigo:'no_pendiente', estado}`: el POS dice «Ya la atendió» y vuelve a leer. (El boceto de v0.3 hacía un `update` condicional desde el POS; A1 lo pasó a RPC, §04.5.)
- **Exigen red.** No usan cola offline y revisan `error` y `ok`. Un fallo se ve: «Sin conexión: no se marcó».
- `atendida_por` y `atendida_en` los pone la RPC en la base, no el POS: `atendida_por` es el correo de la identidad de Google de quien llama. Nadie puede firmar por otro.

**Sonido** (D11):

- **Pitido corto** con WebAudio, sin archivo, cuando llega una alerta nueva o cambia el método de una pendiente. En Android, además, `navigator.vibrate(200)` si existe.
- **Recordatorio** cada 2 minutos mientras haya pendientes de más de 2 minutos.
- `document.title` lleva el número: «(2) Resplandor POS».
- **Los navegadores bloquean el audio hasta el primer toque.** Ese primer toque en el POS desbloquea el `AudioContext`. Mientras tanto, la píldora dice «Toca para activar el sonido».
- **«Silenciar 10 min»**, por tablet, guardado en `localStorage`.
- Suena también con la pestaña en segundo plano si el navegador la mantiene viva. Si la tablet se duerme, el WebSocket se suspende y la alerta llega al despertar (§10).

**Tiempo real:**

- El canal `pos_sync` suma `postgres_changes` de `alertas` (INSERT y UPDATE), junto a los de `mesas`, `ordenes` y `productos` (`pos.html:2048-2054`). La RLS filtra: solo el personal activo los recibe.
- **Al suscribirse o resuscribirse** (con el callback que agrega 1D) y al volver a la pestaña, el POS lee de nuevo las alertas pendientes y las del día. Así no se pierde una alerta que llegó con la tablet dormida.
- Una pendiente solo se muestra si su `orden_id` es la orden abierta de esa mesa en el POS. La base ya las cierra al facturar; esto cubre un POS con datos atrasados.
- La meta es ver la alerta en las tablets en ≤ 2 s (p95) desde el toque (R-5).

### 03.5 Flujo D: el mesero cobra y cierra

1. Con la alerta a la vista, el mesero va a la mesa. Si quiere avisar a los demás, toca «Atender».
2. Según el método:
   - **QR:** lleva el QR del banco **impreso**, en un soporte de mesa o en una tarjeta. El cliente lo escanea con la app de su banco.
   - **Transferencia:** lleva una tarjeta impresa con los datos de la cuenta, o se los dice.
   - **Efectivo:** lo recibe.

   Si el cliente cambia de idea en la mesa, se cobra como diga. El método de la alerta solo sirve para que el mesero llegue con lo correcto.
3. **El QR y la transferencia solo se dan por pagados con el abono a la vista**, en la app o en la notificación del banco. El pantallazo del cliente no basta (D1).
4. **Cierra con «Facturar»**, como hoy (`pos.html:3316-3321` → `modalConfirmFactura` → `facturar()`, `:2445`). La orden queda cerrada y la mesa libre.
5. **La alerta se cierra sola.** El trigger `ordenes_cierra_alertas` (§04.5) la pasa a `atendida` cuando la orden pasa de `abierta` a `cerrada`, con `atendida_por` igual a quien facturó. Vale para cualquier camino que cierre la orden: otra tablet, la cola offline al vaciarse o el SQL Editor. Si la orden se borra (liberar mesa vacía), la alerta pasa a `descartada`.
6. **Cobro por partes** (`facturarParcial`, `pos.html:2488-2525` en `7028919`; ahora `:4258`): la mesa sigue abierta y la alerta también, hasta que la orden se cierre o alguien la atienda. Hay tres maneras de cobrar una parte: por ítems, **por unidades de una línea** y **por monto** (§03.5.1).
7. **Sin propina:** el modal, el ticket y el cierre no tienen línea ni campo de propina. Un abono no es una propina.

**Por qué ya no hace falta `confirmar_y_cerrar`.** En v0.2, la operación atómica protegía un pago que el cliente reportaba desde afuera. Ahora lo único que llega de afuera es «quieren pagar», y la coherencia entre alerta y orden la da el trigger, dentro de la misma transacción del cierre. Lo que sigue igual: `facturar()` no espera su push (`pos.html:2462`), un riesgo que ya existe hoy (R9).

#### 03.5.1 Cobrar por partes: ítems, unidades y monto (ola B, decisiones de Yonatan de 2026-09-30)

Las tres usan el mismo modo «Cobrar por partes» del POS y el mismo mecanismo: **una orden cerrada nueva** con lo cobrado, y la orden abierta que lo descuenta con `aplicar_delta_orden` (atómico y seguro bajo concurrencia). La mesa sigue ocupada y la alerta sigue pendiente.

| Manera | Qué cobra | Cómo queda |
|---|---|---|
| **Por ítems** (hoy) | Las líneas completas que se marcan | `cobrarGrupoPersona` sigue con líneas completas (la etiqueta «Persona N»; desde 2026-10-01 con nombre editable: el sufijo de la nota pasa a «— Persona N (Nombre)», sin migración, `docs/pos-visual.md` §7.1) |
| **Por unidades de una línea** (nueva) | Una parte de una línea: «pagar solo una paloma», de una línea de 4. Hoy, marcar la línea cobra las 4 | En el modo «Cobrar por partes», `itemsSeleccionados` pasa de una lista de ids a `{itemId: cantidad}`. Por defecto va la cantidad completa. Si `qty > 1`, se muestra el selector **«Cobrar [−] n [+] de qty»**. `subtotalSeleccion` es Σ precio × cantidad elegida. `facturarParcial` mueve **n** unidades: la orden cerrada lleva ese ítem con `qty = n`, y la abierta recibe un delta de **−n** |
| **Por monto** (nueva) | Un valor que escribe la persona: «se debe poder pagar un valor introducido por el usuario» (captura de «Cobrar por partes» del POS nuevo) | Una orden **cerrada** «Abono · Mesa N» con un ítem `abono_<uid>` por el monto, y en la orden **abierta** una línea «Abono recibido» con **precio negativo**, por `aplicar_delta_orden` (`p_precio = −monto`, delta +1). El método (efectivo, QR o transferencia) va en la nota. **Validación: 0 < monto < total pendiente**; si el monto es igual al total, es el cobro normal («Facturar»). El ticket del abono dice cuánto queda. **El cierre del día cuadra solo**: la orden del abono suma el cobro y la orden abierta, al facturarse, suma lo que queda |

**Lo que ve el cliente.** La carta recibe la línea negativa como cualquier otra (`cuenta` no la distingue) y la muestra como **abono**: sin «1×», con signo menos y otro tono, y el total de abajo es lo que **queda** (§04.7).

**Bordes que hay que cerrar** (la decisión de Yonatan pidió revisarlos; B4 los dejó dichos):

| Borde | Qué pasa | Qué se decide |
|---|---|---|
| El agrupado por nombre y precio | `cuenta` v2 y la carta agrupan por (nombre, precio) (§04.3). Dos abonos de **montos distintos** tienen precios distintos: nunca se funden en una línea. Dos del **mismo monto** se agrupan | **Se deja así** (B4). La carta pinta el grupo como una sola línea: «2 abonos de $ 10.000», con su suma, y no «2×». Los abonos van al final de la lista |
| «Liberar mesa vacía» | Exige `items.length === 0` (`liberarMesaVacia`). Una orden con un abono tiene una línea negativa: **no está vacía** | Correcto: hay un cobro hecho, y la base tampoco deja borrarla (`ordenes_borrar` pide `items = '[]'`). Devolver un abono sería una acción propia, no «liberar» |
| Reabrir la orden «Abono · Mesa N» | `reabrirOrden` la volvería a abrir, en otra mesa libre (la suya está ocupada por la orden con la línea negativa): el dinero quedaría contado dos veces | Reabrir una orden cerrada ya es del admin (§02.3, nota 5). **B2 no debe ofrecer «Reabrir» ni «Editar» sobre una orden de abono** (se reconoce por su ítem `abono_…`) |
| Quitar la línea «Abono recibido» | Con `quitarProducto` (delta −1) la línea negativa desaparece, el total de la mesa sube, y la orden cerrada del abono sigue sumando en el cierre del día | **B1 y B2 no deben dejar quitar esa línea con los controles de cantidad.** Si no se cierra, queda como R14 (§11) |
| Un abono mayor que lo pendiente | El total quedaría negativo | La validación 0 < monto < total pendiente. La carta, si aun así recibiera un total ≤ 0, lo muestra como «Total» con su signo |


### 03.6 Carta de escritorio (≥ 1024 px, ola A)

Hoy toda la carta vive en una columna `max-w-lg`, de 32 rem (`carta.html:150`, `:157`, `:236`, `:249` y `:271`). La cuenta es una hoja que sube desde abajo (`carta.html:266-338`). En un monitor queda una tira angosta en el centro.

A partir de **1024 px** (`lg:` de Tailwind):

- **Sin enlace de mesa,** dos columnas. A la izquierda, el índice de categorías **fijo** (`sticky`), con la categoría visible resaltada; hoy son pestañas horizontales (`carta.html:150`). A la derecha, la carta, de hasta `max-w-5xl`, con los platos en dos columnas desde 1280 px y descripciones de 70 caracteres por línea como máximo.
- **Con enlace de mesa válido,** tres columnas: índice, carta y **la cuenta en un panel lateral** de unos 22 rem, `sticky` y siempre visible. A ese ancho no se usan la barra fija de abajo (`carta.html:248-262`) ni la hoja modal.
- **El panel** es el mismo estado de Alpine que la hoja, con otro marcado: `<aside aria-labelledby="…">`, **no** `role="dialog"`. No tiene velo, no atrapa el foco y no lleva `aria-modal`. Tiene «Ocultar cuenta», que lo pliega a una pestaña lateral y se recuerda en `sessionStorage` (WCAG 2.2.2, §06). En el pie van el total y «Pagar» (§03.3).
- **El canal de la fase 1** se abre cuando el panel está visible y desplegado y la pestaña está visible. Eso es la «hoja abierta» del escritorio.
- **Hover y foco:** las tarjetas tienen estado `:hover` y el foco de teclado se ve. «Pagar» y los métodos funcionan con Tab y Enter.
- **Debajo de 1024 px no cambia nada.** La hoja y la barra siguen como hoy, y a 320 px no hay desborde (`scripts/pruebas/desborde.test.mjs`).
- Las clases nuevas se generan con `node scripts/css.mjs`, que regenera `assets/css/resplandor.css`. Los íconos de los métodos, con `node scripts/iconos.mjs`.

### 03.7 Rotar el token al cerrar, la fuga y la pegatina misma

**Por qué no se rota al cerrar.** La URL va escrita en la NTAG215, y rotar obliga a reescribirla. El POS lo advierte: «La pegatina actual deja de servir y hay que reescribirla» (`pos.html:2615`). Rotar en cada cierre significaría reescribir las 10 pegatinas varias veces al día.

| Opción | Cierra la fuga | Costo | Recomendación |
|---|---|---|---|
| **A. Aceptarla para ver y para avisar** | No. Quien tiene el enlace ve la cuenta abierta y puede crear una alerta. Lo peor que pasa es una alerta falsa, que el mesero descarta (tope de 5 por orden). No hay datos de pago que filtrar, y la cuenta no lleva datos personales (§05, S8) | Ninguno | **Sí** |
| A+. La `o` de la pestaña | Parcial: una pestaña que siguió abierta ve «cerrada», no la orden siguiente (§04.3). **No** se ofrece «Ver la cuenta actual»: hay que volver a tocar la pegatina (§11, SD12) | Bajo | Sí, incluida (fase 1) |
| B. Un código también para **ver** | Sí | Fricción en cada visita | Solo si hay abuso (D7) |
| C. Pegatinas **NTAG 424 DNA con SUN**: en cada toque, el chip agrega a la URL un contador y un CMAC AES que el servidor verifica (NXP AN12196, https://www.nxp.com/docs/en/application-note/AN12196.pdf) | Sí, para NFC. El QR de respaldo sigue siendo estático | Pegatinas nuevas (precio sin dato), una llave AES por pegatina y una tabla de contadores | Al reemplazar las pegatinas (D7) |
| ~~D. Espejo de UID o contador de la NTAG215~~ | No: copia el UID y un contador en ASCII **sin MAC** (hoja de datos NTAG213/215/216, https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf) | — | Descartada |

**Proteger la pegatina** (§11, SD1). De fábrica, cualquier teléfono puede reescribir una NTAG215. La hoja de datos lo explica (§8.5.7): AUTH0 vale FFh y, si es mayor que la última página, «la protección por contraseña queda deshabilitada». Un comensal con una app de NFC podría poner la URL de un clon en 5 segundos sin que se note por fuera.

- **Qué se hace (D16).** Yonatan fija en las 10 pegatinas la contraseña PWD/PACK con **AUTH0 = 04h y PROT = 0** (hoja de datos, §8.8). La lectura sigue libre y la escritura exige la contraseña. Así se puede reescribir al rotar, pero solo con la contraseña.
- **Dónde vive la contraseña:** en el gestor de Yonatan, nunca en el repo.
- **Lo que no cubre.** La PWD es de 32 bits y viaja en claro por NFC al escribir: es un freno, no criptografía. Tampoco impide **pegar otra pegatina encima**. Por eso hay revisión diaria (§03.9), y la página real dice que nunca muestra datos de pago (§03.3).

### 03.8 Casos de error y bordes

| Caso | Qué ve el cliente o el personal | Qué hace el sistema |
|---|---|---|
| Sin red al abrir | «No pudimos leer la cuenta», con Reintentar (`carta.html:297-301`) | No abre el canal y reintenta al tocar |
| Sin red con la cuenta cargada | La última cuenta, con «Sin conexión · leída a las hh:mm» | No pisa la cuenta buena. Reintenta con *backoff* y lee al reconectar |
| Realtime no conecta | «Se actualiza cada 20 s» | Sondeo de 20 s y reintento del canal cada 60 s |
| **Canal mudo** (trigger caído, despliegue fuera de orden) | Pasa de «En vivo» a «Se actualiza cada 20 s» en ≤ 60 s después del primer cambio perdido | El sondeo de seguridad detecta la `marca` distinta sin señal (§03.2.7) |
| **Token rotado** mientras mira | «Este enlace ya no sirve. Puede que esta mesa ya no esté en servicio o que su pegatina se haya renovado. No pasa nada: pídele a un mesero que te ayude con tu cuenta» (v0.4: el mismo texto que la mesa desactivada) | El trigger de `mesas` avisa al tópico viejo. El `GET` da 404 y la carta cierra el canal |
| **Mesa desactivada** (ola C) mientras mira, o con un enlace de una mesa que ya no está en servicio | El mismo texto de arriba. La carta no puede distinguirla de un token rotado, y no debe (§12.3) | `cuenta` da 404 `enlace_invalido`; la carta cierra el canal y no vuelve a leer. Si no llega la señal, el sondeo de 60 s lo descubre (`carta-mesa-desactivada.test.mjs`) |
| **Mesa sin orden** | «Todavía no hay cuenta abierta. Cuando el mesero tome su pedido, aparece aquí» | Sigue suscrita: el INSERT de la orden emite y la cuenta aparece sola |
| **Orden cerrada mientras mira** | «Mesa cerrada. ¡Gracias!», sin botón para ver la cuenta actual | `GET ?o=<orden_id>` devuelve `estado:'cerrada'` (§04.3) |
| Pestaña reutilizada por una pegatina nueva | La cuenta actual, no «cerrada» | `o` se recupera de `sessionStorage` solo si la navegación es `reload` o `back_forward`. Un toque nuevo es `navigate` y arranca limpio (§04.7) |
| Cobro parcial en el POS por ítems o por unidades (`facturarParcial`, §03.5.1) | Los ítems (o las unidades) cobrados desaparecen de la lista y el total baja | La alerta sigue pendiente |
| **Cobro por monto (abono)** | Una línea «Abono recibido» con signo menos, sin «1×», y abajo «Queda por pagar» con lo que falta. Se anuncia como «Se registró un abono de $ X», no como «Se agregó» | La línea llega como cualquier otra, con precio negativo: `cuenta` no la distingue y la carta la reconoce por el signo del precio (§04.7). La alerta sigue pendiente |
| Orden reabierta en otra mesa (`pos.html:2702`) | En la mesa vieja, «cerrada». En la nueva, aparece | El trigger avisa a las dos mesas. Sus alertas ya estaban cerradas y no se reabren |
| Mesa liberada vacía (`pos.html:2578-2593`) | «Sin orden», o «cerrada» si la pestaña tiene `o` | El DELETE de la orden abierta emite, y su alerta pendiente pasa a `descartada` |
| POS sin red, con deltas en cola (`pos.html:2342-2360`) | La cuenta se atrasa. «Leída hace X s» dice cuándo se leyó, **no** si el POS está al día | — |
| 429 de `cuenta` | La última cuenta, con «Muchas consultas, reintentando…» | Respeta `Retry-After` |
| Varios teléfonos en la mesa | Todos ven lo mismo. Cualquiera puede tocar Pagar | Hay una sola pendiente por mesa: gana el último método |
| Pagar justo después de que se cerró la orden | «Todavía no hay cuenta abierta» | 409 `sin_cuenta`, y la carta lee de nuevo |
| Pagar y facturar al mismo tiempo | «Mesa cerrada» | `alerta_cliente` toma la orden con `for share`. O la alerta entra primero y el cierre la atiende, o el cierre gana y la función responde 409 |
| Toques repetidos | «Ya le avisamos hace un momento» | 429 `demasiadas` (memoria) o `tope` (5 por orden, en la base) |
| Interruptor apagado (D25) o `alerta` caída | «No pudimos avisar desde aquí. Hazle una seña al mesero» | 503 `apagado`, o error de red |
| Nadie atiende | A los 3 minutos, «¿Nadie vino? Hazle una seña al mesero» | El POS repite el pitido cada 2 minutos |
| Tablet dormida o sin red cuando llega la alerta | La ve al reconectar | El callback de `pos_sync` lee de nuevo las pendientes (1D y B1) |
| El navegador bloquea el sonido | La píldora dice «Toca para activar el sonido» | El primer toque desbloquea el `AudioContext` |
| Dos tablets atienden a la vez | Una gana. La otra ve «Ya la atendió ‹nombre›» | `update` condicional sobre `estado = 'pendiente'` |
| Cuenta de Google sin fila, o dada de baja con la sesión abierta | «Tu cuenta no está habilitada. Pídele al admin que te agregue» | La RLS devuelve 0 filas y rechaza escrituras. El POS borra su caché local (B1) |
| Un mesero intenta algo de admin por la API | «Solo el admin puede hacer esto» | `42501` si es un `insert`; si es editar o borrar, 0 filas y **sin error** (así rechaza la RLS un `update` o un `delete`). Por eso el POS tiene que esconderlo antes de aplicar `permisos_por_rol`, y revisar las filas devueltas. Luego sincroniza |
| El último admin intenta darse de baja | «Debe quedar al menos un admin activo» | `ultimo_admin` |
| `menu.html` abierto en una tablet con la sesión de alguien que no está en `personal` | La votación, sin menús | `menu.html` compartía la sesión del POS (mismo origen y `localStorage`, `createClient` sin opciones), y con la compuerta le habría llegado `menus` vacío. **Hecho en B4**: `createClient(…, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`, como `carta.html`. Lo vigila `scripts/pruebas/menu-sesion.test.mjs`. A1 además deja la lectura de `menus` fuera de la compuerta (solo restringe las escrituras) |

### 03.9 Operación diaria

- **Al abrir (12:00):** tocar cada pegatina con un teléfono y **leer el dominio en la barra de direcciones**: `resplandor.ynt.codes`. Mirar la página no basta, porque un clon pinta la misma (§11, SD1). Pasar la uña por el borde para notar una pegatina encima.
- **Tablets del POS:** abrir el POS y tocar una vez para activar el sonido (§03.4). Dejarlas despiertas y enchufadas (§10).
- **Material del mesero,** que prepara Camila: el QR del banco impreso y una tarjeta con los datos de la cuenta. Nunca en la página ni en el repo.
- **Plan B siempre:** efectivo, datáfono y la carta física. La pegatina complementa, no reemplaza (CU 2.4).
- **Personal:** cuando llega alguien nuevo, el admin lo da de alta en «Personal». Si Google sigue en Testing, Yonatan además lo agrega como usuario de prueba (D23). Cuando alguien se va, «Baja».
- **Si una pegatina se pierde o se sospecha de ella:** un admin toca «Enlace NFC → Rotar» en el POS (D24) y Yonatan la reescribe con la contraseña.
- **Al cerrar:** un admin hace el cierre del día (D20). **Desde la ola C, el cierre ya no borra las alertas** (§12.7): las resueltas se borran solas pasado un día (D28).

---

## 04 — Arquitectura

### 04.1 Tiempo real: decisión

**Se elige un trigger en `ordenes` y `mesas` (y en `alertas` desde la ola A) que llama a `realtime.send` hacia un tópico público derivado del token, con una señal sin datos (d2). El cliente vuelve a leer la cuenta en `cuenta`, y un sondeo de seguridad cada 60 s detecta si el canal está mudo.**

| Opción | Seguridad | Latencia | Cupo Free | Complejidad | Veredicto |
|---|---|---|---|---|---|
| (a) Sondear `cuenta` más rápido | Igual que hoy | N/2 + ~0,4 s | Es el cuello: a 5 s, el techo es 1.080.000 invocaciones al mes (216 %) | Ninguna | Solo de respaldo |
| (b) Broadcast desde el POS | Anon puede publicar en canales públicos | ~6 ms (benchmark de Supabase) | Bajo | Toca **cada** camino de escritura de `pos.html` (`:2331`, `:2445`, `:2589`, `:2835`). No es atómico con la escritura | No |
| (c) `postgres_changes` para anon | Exige SELECT sobre `ordenes` para anon, contra `README.md:227-229` | Baja | — | — | No |
| (d1) Trigger con tópico **privado** y policy para anon | La mejor: nadie puede publicar | ~46 ms (benchmark) + ~0,4 s de lectura | ~1,8 % | Policy sobre `realtime.messages` | **Pendiente de la prueba S-0.** La doc dice «Private (`true`) → Only authenticated clients can subscribe» (https://supabase.com/docs/guides/realtime/broadcast) |
| **(d2) Trigger con tópico público `cuenta:<sha256(token)>` y payload `{}`** | Equivale al sondeo: quien conoce el tópico ya conocía el token. Por el canal no viaja ningún dato. Una señal falsa solo provoca una lectura, y la cubeta la acota | Igual que d1 | ~1,8 % de mensajes y ~10 % de invocaciones (§07) | Una migración y unas 80 líneas en `carta.html` | **Elegida** |
| SSE desde una Edge Function | — | — | Pared de 150 s en Free (functions/limits) | La función tendría que sondear por dentro | No |

Por qué funciona d2:

- **Una sola fuente de datos.** Todo dato del cliente sale de `cuenta`, que valida el token y sanea la respuesta (`cuenta/index.ts:79-115`).
- **Cubre todos los caminos.** El trigger atrapa RPC, upsert y DELETE, incluida la cola offline cuando se vacía.
- **Sin problemas de orden.** La lectura siempre trae el estado actual.
- **Nada guardado.** `realtime.messages` retiene las filas 3 días (realtime/broadcast), y el payload va vacío.
- **Se vigila a sí mismo.** El sondeo de seguridad de 60 s compara la `marca` (§03.2.7): una señal perdida no deja la cuenta congelada.
- **Depende de que «Allow public access» siga encendido.** Lo usa el POS (`pos.html:2048-2054`). Si algún día se pasa a «solo privados», este canal se migra junto con el POS (R5).
- **Si S-0 pasa** (anon se une a un canal privado con policy), se cambia a d1 sin tocar la carta: `cuenta` devuelve `canal.privado:true` y la carta abre el canal con `private:true`.

### 04.2 Migración de fase 1: `20261001120000_cuenta_en_vivo.sql`

Es un **boceto sin probar**; la parte 1A lo cierra y lo prueba. v0.3 solo cambia dos comentarios: la rama que v0.2 escribió para `liquidaciones` sirve tal cual para `alertas`, porque las dos tablas tienen `orden_id`.

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
    elsif tg_op <> 'DELETE' then                      -- tablas con orden_id: alertas (ola A)
      -- La mesa sale de la ORDEN, no de la fila (una orden reabierta cambia de mesa).
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
--   drop schema privado cascade;   -- con la ola A aplicada, solo los triggers: privado ya tiene más objetos
```

- `realtime.send(payload, event, topic, is_private)` captura sus propios errores (realtime/concepts). El bloque `exception` cubre además los errores del propio trigger. **Sin esa protección, un fallo del trigger impediría escribir órdenes.** Por eso se aplica después de las 17:00, con la reversa a mano.
- `extensions.digest` viene de pgcrypto (`20260906120000_carta_publica_y_token_mesa.sql:53`).
- No se agregan policies en `realtime.messages` ni GRANT a anon.
- **Migración aparte de 1D, solo si D17 es sí:** `20261001130000_presencia_privada.sql`. Agrega policies `select` e `insert` en `realtime.messages` para `authenticated`, con `extension = 'presence'`, `realtime.topic() = 'presencia_pos'` y proveedor `google`. La reversa es borrar las dos policies y revertir el commit de 1D. Con la ola A, esas policies pueden pasar a exigir `public.mi_rol() is not null` (B1). **Hecho en la integración de la ola B** (la corrida en Postgres 17 con las siete migraciones encontró que `solo_personal` cubría las tablas del POS pero no `realtime.messages`, así que una cuenta de Google fuera de `personal` leía los nombres del personal): `20261001130000_presencia_privada.sql` agrega `public.mi_rol() is not null` si la compuerta ya existe, y `20261002140000_permisos_por_rol.sql` (§4) vuelve a crear las dos policies si se habían aplicado antes. Lo fija `scripts/pruebas/presencia-compuerta.test.mjs`.

### 04.3 Contrato: `GET /functions/v1/cuenta` (extendida, compatible con la carta de hoy)

**Request:** `GET ?m=<\d{1,4}>&k=<[0-9a-f]{32,64}>[&o=<orden_id>]`, con las cabeceras de hoy: `apikey` y `Authorization: Bearer <publishable>` (`carta.html:578`). `o` es el `orden_id` que la pestaña ya estaba mirando.

**CORS** (§11, SD1):

- `Access-Control-Allow-Origin` devuelve el `Origin` solo si es `https://resplandor.ynt.codes`, más `http://localhost:<puerto>` para desarrollo. Va con `Vary: Origin`.
- Sin un origen permitido no se manda la cabecera, así que el navegador de un clon no puede leer la respuesta.
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
  "servidor_en": "<ISO>"
}
```

| Campo | Regla |
|---|---|
| `estado` | Vale `abierta`, `sin_orden` o `cerrada`. **`cerrada` solo sale cuando llega `o`** y `o` ya no es la orden abierta de esa mesa: cerrada, borrada o movida. En ese caso solo se devuelven `mesa`, `estado`, `abierta:false`, `canal` y `servidor_en`, sin ítems y sin decir si hay otra orden. Sin `o`, se responde con la orden abierta |
| `abierta` | `estado === 'abierta'`. Se mantiene para la carta de hoy |
| `orden_id`, `actualizada_en` | `ordenes.id` y `ordenes.updated_at` (`20260905000000_resplandor_base.sql:110-123`) |
| **`marca`** | `"<ordenes.version>.<segundo componente>"`. En la fase 1, el segundo componente vale `0`. B3 lo reemplaza por el epoch del último cambio de la alerta de esa orden. En `sin_orden` vale `"0"`. Sirve para detectar el canal mudo (§03.2.7) |
| `items` | `{nombre, precio, cantidad}`, **sin notas ni ids** (`cuenta/index.ts:100-105`), **agrupados por (nombre, precio)** y sumando la cantidad, en el orden de su primera aparición. Las 8 combinaciones del «Menú Resplandor» (`pos.html:2374-2381`) ya no salen como líneas repetidas (§11, B2) |
| `canal` | Lo calcula el servidor con la misma fórmula que `privado.topico_cuenta`. `privado` vale `false` mientras S-0 no pase |
| **Abonos** (ola B) | Una línea con **precio negativo** (`{nombre:'Abono recibido', precio:-10000, cantidad:1}`) es un abono. `cuenta` no la distingue ni la trata aparte: el `total` ya la descuenta (suma de precio × cantidad), y la agrupación por (nombre, precio) funciona igual. Dos abonos de montos distintos tienen precios distintos y quedan como líneas distintas; dos del mismo monto se agrupan con `cantidad: 2`. **La carta decide cómo se ve** (§04.7): por el signo del precio, no por el nombre |
| `alerta` (B3) | `null` o `{metodo, estado, creada_en, atendida_en}` de la última alerta de la orden abierta. **Nunca** trae `atendida_por` |
| `servidor_en` | Para calcular «hace X s» sin depender del reloj del teléfono |

Los campos `liquidar_activo` y `liquidacion` de v0.2 salen del contrato. Si 1B ya los emite (`false` y `null`), no rompen nada, y B3 los reemplaza por `alerta`.

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

Sigue en la memoria del isolate, con el mismo aviso de hoy (`cuenta/index.ts:32-33`). Toma el primer valor de `x-forwarded-for` (`:68`). Si la plataforma deja pasar el XFF que manda el cliente, este límite se esquiva (§10). Por eso los topes que importan viven en la base.

**Código compartido.** Va en `supabase/functions/_compartido/mesa.js`: CORS con lista, `json`, validadores, limitador, `topicoCuenta` con `crypto.subtle` y `agruparItems`. Es **JS plano**, para que `node --test` lo pruebe sin Deno: en esta máquina no hay Deno ni supabase CLI. El guion bajo sigue la convención de Supabase para código compartido (https://supabase.com/docs/guides/functions/development-tips).

**En B3**, `cuenta` lee la alerta junto con la orden. Si las dos lecturas no salen del mismo *snapshot*, la `marca` cubre la carrera: la señal siguiente provoca otra lectura.

### 04.4 Contrato: `POST /functions/v1/alerta` (nueva, ola A)

- Se despliega con `--no-verify-jwt`, como `votar` y `cuenta`.
- Solo acepta POST y OPTIONS, con `Content-Type: application/json` y un cuerpo de hasta 1 KB.
- Lleva las mismas cabeceras que `cuenta`: `apikey` y `Authorization: Bearer <publishable>`.
- **CORS:** devuelve el `Origin` en `Access-Control-Allow-Origin` solo si es `https://resplandor.ynt.codes`, `http://127.0.0.1:8787` o `http://localhost:8787` (estos dos, para las pruebas). Va con `Vary: Origin`. Un `Origin` presente que no está en la lista recibe 403 `origen`. Sin `Origin` (curl) se atiende: CORS no frena a un servidor.

```json
{ "m": 3, "k": "<token>", "metodo": "qr" }
```

| Campo | Regla |
|---|---|
| `m` | Entero entre 1 y 9999 |
| `k` | `^[0-9a-f]{32,64}$` |
| `metodo` | `qr`, `transferencia` o `efectivo` |

**Respuesta 200:** `{ "ok": true, "metodo": "qr", "creada_en": "<ISO>" }`. `creada_en` es la hora de la pendiente, es decir, la del último toque.

**Errores** (todos con `{error, codigo}`):

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `formato` | `m` o `k` inválidos, o JSON roto: el enlace no sirve |
| 400 | `metodo_invalido` | `metodo` no es uno de los tres |
| 403 | `origen` | `Origin` fuera de la lista |
| 404 | `enlace_invalido` | El par `(m,k)` no existe, por ejemplo porque se rotó el token |
| 405 | `metodo_http` | Ni POST ni OPTIONS |
| 409 | `sin_cuenta` | La mesa no tiene orden abierta |
| 413 | `cuerpo` | Más de 1 KB |
| 415 | `tipo` | No es JSON |
| 429 | `demasiadas` | Rate-limit en memoria. Lleva `Retry-After` |
| 429 | `tope` | La orden ya tuvo 5 alertas (en la base) |
| 503 | `apagado` | Solo si D25: el interruptor está apagado |
| 500 | `interno` | — |

**Rate-limit en memoria:** 6 por minuto por (IP, mesa) y 30 por minuto por IP. Vale el mismo aviso que para `cuenta` sobre el XFF (§10); por eso el tope que importa está en la base.

**Implementación.** La función valida el formato, el origen y el rate-limit, y llama a **una sola** función SQL: `public.alerta_cliente(p_mesa, p_token, p_metodo)` (§04.5). Traduce su `codigo` a HTTP y nunca toca tablas directamente. **¿Por qué una RPC y no un upsert de supabase-js?** PostgREST no puede expresar `on conflict … where estado = 'pendiente'` sobre un índice único parcial. Además, validar el par, exigir la orden abierta, aplicar el tope y hacer el upsert tiene que ir en una sola transacción.

**Código compartido:** `supabase/functions/_compartido/alerta.js`, en JS plano (validación del cuerpo, CORS con lista, limitador, mapeo de códigos), probado con `node --test`. No importa `_compartido/mesa.js` de 1B mientras 1B no esté integrada; B3 los une.

### 04.5 Modelo de datos de las olas A y B: tres migraciones

**Estado (v0.3.1).** A1 cerró y probó estas migraciones en Docker (`tarea/roles-alertas-bd`, `2d163f5`, sin aplicar en ningún Supabase). **Mandan sus archivos, no los bocetos de abajo**, que se conservan como el diseño original y como referencia del porqué. Se separan en tres porque cada una sale al aire en un momento distinto (§02.5 y §08). A1 sigue en curso: si cambia algo, manda A1. Lo que construyó, frente al boceto:

| Tema | Boceto de v0.3 (abajo) | Lo que construyó A1 | Qué falta o qué cambia |
|---|---|---|---|
| Archivos | `…120000_personal_y_alertas`, `…130000_solo_personal`, `…140000_permisos_por_rol` | `20261002120000_personal_y_compuerta.sql` (personal, `mi_correo`, `mi_rol`, RPC y `solo_personal`), `20261002130000_alertas.sql` y `20261002140000_permisos_por_rol.sql` | La compuerta sale **sola y primero**, con el alta en la misma transacción (§02.5). Las alertas, aparte |
| `mi_rol()` | Correo del JWT y proveedor Google | **La identidad de Google** (`auth.identities`, vía `mi_correo()`) y fila activa | El correo del JWT (`auth.users`) lo puede cambiar el usuario con `updateUser`: una cuenta con contraseña y el correo de un admin no hereda su rol. La verificación con claims simulados del boceto ya no sirve (§02.5, paso 2) |
| Gestión del personal | `insert`/`update`/`delete` con policies de admin y un trigger diferido `personal_ultimo_admin` | RPC `personal_alta`, `personal_baja` y `personal_cambiar_rol`, con la guarda `ultimo_admin` adentro. Sin GRANT de escritura | B1 llama a las RPC y mira `{ok, codigo}` |
| Atender y descartar | `update` de `estado` desde el POS y un trigger que sella | RPC `atender_alerta` y `descartar_alerta` | §03.4 y B1 |
| Crear la alerta | `alerta_cliente`, con **tope de 5 alertas por orden en la base** | `alertar_cuenta(p_mesa, p_token, p_metodo)`. **v0.3.2 (ronda 2 de la ola B): lleva el tope de 5 por orden** (la sexta responde `tope`, 429 en la función) **y un segundo toque con el mismo método no escribe nada** (no mueve `creada_en`); con otro método actualiza la pendiente. Además la acotan los límites de la función `alerta` (6 por minuto por mesa, 30 por IP) y la pendiente única | Cerrada: D31 se construyó (refutación de la ola B, hallazgo 6) |
| Cerrar la alerta con la orden | Triggers por `orden_id`, con `exception when others` para no romper el cierre | `trg_ordenes_cierre_resuelve_alertas` y `trg_ordenes_borrada_resuelve_alertas`, por `mesa_id`, sin `exception when others` | Vigilar S11 y R-7: un fallo del trigger no debe romper el cierre del POS |
| **Borrar alertas (D28)** | `delete` del admin sobre las no pendientes | **Sin policy ni GRANT de `delete`** | **v0.4: la construye la ola C en la base** (un trigger; las no pendientes con más de un día se borran solas) y el POS no hace nada (§12.7) |
| **Token de la pegatina (D24)** | Trigger `token_solo_admin` | **v0.3.2 (ronda 2 de la ola B): construido** en `permisos_por_rol` como `trg_mesas_token_solo_admin` (conserva el token viejo si quien lo cambia no es admin; no lanza error). Antes solo existía el trigger que impide renumerar una mesa y un mesero rotaba el token por la API (hallazgo 4) | Cerrada (§02.3, nota 2) |
| **Órdenes cerradas** | El mesero las reabre y edita | **Solo el admin**; el mesero edita órdenes abiertas. **v0.3.2:** el mesero tampoco inserta ni deja una venta cerrada con total negativo, y `aplicar_delta_orden` ya no modifica una orden cerrada salvo `p_solo_abierta := false` (solo «Editar» del admin). Ante una orden cerrada, la base le contesta al mesero «orden X no existe» (P0001), no 42501 | B2 esconde «Editar» y «Reabrir» de las ventas cerradas al mesero (§02.3, nota 5). El POS entiende «no existe» y el SQLSTATE `RS001` (pos.html: `_deltaHuerfano`) |
| **Interruptor de Pagar (D25)** | Tabla `ajustes_cuenta` y 503 `apagado` | **No construido.** A2 puso la bandera `pagarEnMesa` (apagada) en `assets/js/local.js` | Se apaga con un commit y un push, no con un `update`. Pendiente decidir si se agrega la tabla |
| Señal de la alerta a la carta | Trigger `alertas_emite_cuenta` | **No construido** | Es de B3: hoy `cuenta` no trae la alerta |
| Códigos de error de `alerta` | `origen`, `demasiadas`, `tope`, `apagado`, `cuerpo`, `tipo`… (§04.4) | `solicitud_invalida`, `enlace_invalido`, `metodo_invalido`, `sin_cuenta`, `origen_no_permitido`, `metodo_no_permitido`, `demasiadas_solicitudes` y `error_interno` (`supabase/functions/alerta/logica.ts`) | A2 y B3 mapean los códigos reales |
| `productos` y `cierres` (D21 y D29) | El mesero no escribe productos | **Sí crea y edita productos; borrar, solo el admin. Lee `cierres`, sin escribir** | Es lo que dice la decisión de Yonatan. El boceto de abajo ya lo refleja |

**1. `20261002120000_personal_y_alertas.sql`** (ola A; se puede aplicar apenas esté la fase 1, y no le cambia nada a nadie):

```sql
create schema if not exists privado;            -- ya existe si la fase 1 está aplicada
revoke all on schema privado from public, anon, authenticated;

-- ── Personal y rol ──────────────────────────────────────────
create table public.personal (
  email     text primary key
              check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  nombre    text not null check (char_length(btrim(nombre)) between 1 and 80),
  rol       text not null check (rol in ('admin','mesero')),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);
-- Se crea VACÍA. El alta inicial la pega Yonatan (§02.5). Ningún correo real en el repo.

-- El rol de quien llama, o NULL. Exige Google: una cuenta con contraseña y el correo de un
-- admin, sin verificar, no hereda su rol (§05 S9).
create or replace function public.mi_rol() returns text
  language sql stable security definer set search_path = ''
as $$
  select p.rol from public.personal p
   where p.activo
     and p.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
$$;
revoke all on function public.mi_rol() from public, anon;
grant execute on function public.mi_rol() to authenticated, service_role;

-- Nunca cero admins activos. Diferido: deja intercambiar admins en una transacción.
create or replace function privado.guarda_ultimo_admin() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.personal where rol = 'admin' and activo) then
    raise exception 'ultimo_admin: debe quedar al menos un admin activo';
  end if;
  return null;
end $$;
create constraint trigger personal_ultimo_admin after update or delete on public.personal
  deferrable initially deferred for each row execute function privado.guarda_ultimo_admin();

alter table public.personal enable row level security;
create policy personal_admin_ver    on public.personal for select to authenticated using ((select public.mi_rol()) = 'admin');
create policy personal_propio       on public.personal for select to authenticated
  using ((select public.mi_rol()) is not null and email = lower(coalesce((select auth.jwt() ->> 'email'), '')));
create policy personal_admin_crear  on public.personal for insert to authenticated with check ((select public.mi_rol()) = 'admin');
create policy personal_admin_editar on public.personal for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');
create policy personal_admin_borrar on public.personal for delete to authenticated using ((select public.mi_rol()) = 'admin');
revoke all on public.personal from anon, authenticated;
grant select, insert, update, delete on public.personal to authenticated;
grant select on public.personal to service_role;

-- ── Alertas ─────────────────────────────────────────────────
create table public.alertas (
  id           uuid primary key default gen_random_uuid(),
  mesa_id      integer not null references public.mesas(id),
  orden_id     text references public.ordenes(id) on delete set null,
  tipo         text not null default 'pedir_cuenta' check (tipo in ('pedir_cuenta')),
  metodo       text not null check (metodo in ('qr','transferencia','efectivo')),
  estado       text not null default 'pendiente' check (estado in ('pendiente','atendida','descartada')),
  creada_en    timestamptz not null default now(),
  atendida_en  timestamptz,
  atendida_por text,                                   -- correo del personal; lo pone el trigger
  check ((estado = 'pendiente') = (atendida_en is null))
);
create unique index alertas_una_pendiente_por_mesa on public.alertas (mesa_id) where estado = 'pendiente';
create index alertas_por_orden on public.alertas (orden_id);

-- Sella quién y cuándo. Una alerta cerrada no vuelve a cambiar.
create or replace function privado.sellar_alerta() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if old.estado <> 'pendiente' then raise exception 'alerta_cerrada'; end if;
  if new.estado <> old.estado then
    new.atendida_en  := now();
    new.atendida_por := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  end if;
  return new;
end $$;
create trigger alertas_sellar before update on public.alertas
  for each row execute function privado.sellar_alerta();

alter table public.alertas enable row level security;
create policy alertas_ver     on public.alertas for select to authenticated using ((select public.mi_rol()) is not null);
create policy alertas_atender on public.alertas for update to authenticated
  using ((select public.mi_rol()) is not null and estado = 'pendiente')
  with check (estado in ('atendida','descartada'));
create policy alertas_purgar  on public.alertas for delete to authenticated
  using ((select public.mi_rol()) = 'admin' and estado <> 'pendiente');
revoke all on public.alertas from anon, authenticated;
grant select, delete on public.alertas to authenticated;
grant update (estado) on public.alertas to authenticated;      -- solo el estado; el resto lo sella el trigger
grant select, insert, update, delete on public.alertas to service_role;
alter publication supabase_realtime add table public.alertas;  -- para el POS (RLS filtra)

-- La única puerta de escritura del cliente. Solo service_role (la función `alerta`).
create or replace function public.alerta_cliente(p_mesa integer, p_token text, p_metodo text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_orden text; v_a public.alertas;
begin
  if p_metodo is null or p_metodo not in ('qr','transferencia','efectivo') then
    return jsonb_build_object('ok', false, 'codigo', 'metodo_invalido');
  end if;
  perform 1 from public.mesas m where m.id = p_mesa and m.token = p_token;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'enlace_invalido'); end if;
  -- FOR SHARE: un cierre simultáneo espera a que la alerta exista, y el trigger la atiende.
  select o.id into v_orden from public.ordenes o
   where o.mesa_id = p_mesa and o.estado = 'abierta' for share;
  if v_orden is null then return jsonb_build_object('ok', false, 'codigo', 'sin_cuenta'); end if;
  if not exists (select 1 from public.alertas where mesa_id = p_mesa and estado = 'pendiente')
     and (select count(*) from public.alertas where orden_id = v_orden) >= 5 then
    return jsonb_build_object('ok', false, 'codigo', 'tope');
  end if;
  insert into public.alertas as a (mesa_id, orden_id, metodo)
  values (p_mesa, v_orden, p_metodo)
  on conflict (mesa_id) where estado = 'pendiente'
  do update set metodo = excluded.metodo, creada_en = now(), orden_id = excluded.orden_id
  returning * into v_a;
  return jsonb_build_object('ok', true, 'metodo', v_a.metodo, 'creada_en', v_a.creada_en);
end $$;
revoke all on function public.alerta_cliente(integer, text, text) from public, anon, authenticated;
grant execute on function public.alerta_cliente(integer, text, text) to service_role;

-- Cerrar la orden cierra su alerta, venga de donde venga el cierre (§03.5).
create or replace function privado.cerrar_alertas_de_orden() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'DELETE' then
      if old.estado = 'abierta' then
        update public.alertas set estado = 'descartada' where orden_id = old.id and estado = 'pendiente';
      end if;
    elsif old.estado = 'abierta' and new.estado = 'cerrada' then
      update public.alertas set estado = 'atendida' where orden_id = new.id and estado = 'pendiente';
    end if;
  exception when others then
    raise warning 'cerrar_alertas_de_orden: %', sqlerrm;   -- NUNCA romper el cierre del POS
  end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger ordenes_cierra_alertas after update of estado on public.ordenes
  for each row execute function privado.cerrar_alertas_de_orden();
create trigger ordenes_descarta_alertas before delete on public.ordenes   -- antes del ON DELETE SET NULL
  for each row execute function privado.cerrar_alertas_de_orden();

-- Señal a la carta (la usa B3). Solo si la fase 1 ya creó privado.emitir_cuenta.
do $$ begin
  if to_regprocedure('privado.emitir_cuenta()') is not null then
    create trigger alertas_emite_cuenta after insert or update on public.alertas
      for each row execute function privado.emitir_cuenta();
  else
    raise notice 'Sin la fase 1: alertas_emite_cuenta no se crea. Aplicar la fase 1 primero.';
  end if;
end $$;

-- Si D25 es sí: interruptor de Pagar, apagado de nacimiento. alerta_cliente lo lee primero
-- y devuelve {ok:false, codigo:'apagado'}.
--   create table public.ajustes_cuenta (clave text primary key check (clave in ('alertas')),
--     activo boolean not null default false, updated_at timestamptz not null default now());
--   insert into public.ajustes_cuenta values ('alertas', false, now());

-- Reversa (< 1 min), en este orden:
--   drop trigger if exists alertas_emite_cuenta on public.alertas;
--   drop trigger ordenes_cierra_alertas on public.ordenes; drop trigger ordenes_descarta_alertas on public.ordenes;
--   alter publication supabase_realtime drop table public.alertas;
--   drop table public.alertas; drop function public.alerta_cliente(integer, text, text);
--   drop table public.personal; drop function public.mi_rol();
--   drop function privado.sellar_alerta(), privado.cerrar_alertas_de_orden(), privado.guarda_ultimo_admin();
```

**2. `20261002130000_solo_personal.sql`** (ola A, **solo después del alta inicial**, §02.5):

```sql
-- La puerta. Sin fila activa en public.personal (y sin Google) no hay acceso al POS.
-- (Boceto. A1 la juntó con `personal` y el alta en `20261002120000_personal_y_compuerta.sql`, y en
-- `menus` solo restringe las escrituras.)
-- Reversa (< 1 min): por cada tabla, `drop policy solo_personal on public.<t>;` y recrear
-- solo_google con el bloque de 20260905000000_resplandor_base.sql:271-280.
do $$
declare t text;
begin
  if not exists (select 1 from public.personal where rol = 'admin' and activo) then
    raise exception 'solo_personal: no hay ningún admin activo en public.personal. Primero el alta inicial (SDD §02.5).';
  end if;
  foreach t in array array['productos','mesas','ordenes','cierres','menus','sugerencias_plato'] loop
    execute format('drop policy if exists solo_google on public.%I', t);
    execute format(
      'create policy solo_personal on public.%I as restrictive for all to authenticated
         using ((select public.mi_rol()) is not null)
         with check ((select public.mi_rol()) is not null)', t);
  end loop;
end $$;
```

**3. `20261002140000_permisos_por_rol.sql`** (ola B, **después del push del POS de la ola B**, §02.5):

```sql
-- Reemplaza las policies permisivas de base.sql:253-261 por otras con rol.
-- (Boceto. A1 cerró otra versión: mesas y ordenes también llevan policies por rol, y el mesero solo
-- edita órdenes abiertas. Aquí «mesas» y «ordenes» conservaban «authenticated full access».)
drop policy "authenticated full access productos" on public.productos;
drop policy "authenticated full access cierres"   on public.cierres;
drop policy menus_admin on public.menus;
drop policy sug_admin   on public.sugerencias_plato;

-- D21: el mesero crea y edita productos; borrar es del admin.
create policy productos_ver    on public.productos for select to authenticated using (true);
create policy productos_crear  on public.productos for insert to authenticated with check ((select public.mi_rol()) in ('admin','mesero'));
create policy productos_editar on public.productos for update to authenticated
  using ((select public.mi_rol()) in ('admin','mesero')) with check ((select public.mi_rol()) in ('admin','mesero'));
create policy productos_borrar on public.productos for delete to authenticated using ((select public.mi_rol()) = 'admin');

-- D29: el mesero ve las ventas y el historial de cierres, en solo lectura.
create policy cierres_ver    on public.cierres for select to authenticated using (true);
create policy cierres_crear  on public.cierres for insert to authenticated with check ((select public.mi_rol()) = 'admin');
create policy cierres_editar on public.cierres for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');

-- menus: el select lo sigue dando menus_select_publico (anon y authenticated).
create policy menus_crear  on public.menus for insert to authenticated with check ((select public.mi_rol()) = 'admin');
create policy menus_editar on public.menus for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');
create policy menus_borrar on public.menus for delete to authenticated using ((select public.mi_rol()) = 'admin');

create policy sug_ver on public.sugerencias_plato for select to authenticated using ((select public.mi_rol()) = 'admin');

-- El token de la mesa solo lo cambia un admin (D24). No lanza error: conserva el viejo,
-- así el upsert del mesero (o una caché vieja) no rompe ni deshace una rotación.
create or replace function privado.token_solo_admin() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.token is distinct from old.token
     and coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and public.mi_rol() is distinct from 'admin' then
    new.token := old.token;
  end if;
  return new;
end $$;
create trigger mesas_token_solo_admin before update of token on public.mesas
  for each row execute function privado.token_solo_admin();

-- Reversa (< 1 min): borrar las policies de arriba y el trigger, y recrear
-- "authenticated full access productos/cierres", menus_admin y sug_admin (base.sql:253-261).
```

**Por qué así:**

- **`mi_rol()` es `security definer` con `search_path` vacío** y no recibe parámetros: solo puede contestar por quien llama. Así lee `personal` sin que el mesero tenga SELECT sobre las filas ajenas, y no hay recursión de RLS.
- **`(select public.mi_rol())`** en las policies se evalúa una vez por consulta, no por fila.
- **`alerta_cliente` es `security invoker`** y solo la ejecuta `service_role`. Si alguien la llamara como anon, no tendría GRANT sobre ninguna tabla (§11, SD6).
- **Los triggers sobre `ordenes` llevan `exception when others`**, como `emitir_cuenta`: perder el cierre automático de una alerta es aceptable; impedir un cierre del POS, no.
- **`ordenes_descarta_alertas` es `BEFORE DELETE`** para correr antes de que el `ON DELETE SET NULL` deje la alerta sin `orden_id`.
- **El tope de 5 vive en la base**, no en la memoria de la función, igual que los topes de v0.2.

**Ciclo de vida.** `cerrarDia` borra las órdenes cerradas (`pos.html:2835`). Sus alertas, ya cerradas, quedan con `orden_id = null`. B1 las borra después de subir el cierre (D28). `personal` nunca se purga; una baja es `activo = false`.

### 04.6 Por qué la página no muestra datos de pago

> **Reemplazado el 2026-10-02** por el pago con Bre-B (aviso al inicio del documento). Lo que sigue es el razonamiento de v0.3, que se conserva como historia: hoy la carta SÍ muestra la llave y el QR del restaurante a quien tiene el enlace de una mesa con cuenta abierta, y el costo (un clon podría mostrar otra llave) es el que ese aviso acepta.

| v0.2 | v0.3 | Por qué |
|---|---|---|
| Bre-B y Bancolombia en `medios_pago`, servidos por `liquidar` detrás de un código de 4 dígitos | **No hay datos bancarios en el repo, en la base ni en la página.** El mesero los lleva impresos o los dice | Un clon no puede «cambiar la llave» de una página que no la tiene. El cliente tiene una regla simple: si la pegatina le pide transferir, no es Resplandor |
| Una tabla que solo Yonatan podía cambiar, para que ningún mesero pusiera su llave | Sin tabla: nada que proteger | Desaparecen S2 (c), D2 y el paso manual de cargar los datos |
| Código por cuenta, con 5 fallos y bloqueo | Sin código | Ya no hay nada detrás que proteger. El peor abuso del enlace es una alerta falsa (§05, S1) |
| Cartel del mostrador como segundo canal para comparar la llave | Sin cartel de datos | Ya no hay nada que comparar en la pantalla |
| — | El costo: el mesero va a la mesa | Igual tenía que ir para ver el abono (D1) |

El interruptor de Pagar, si D25 dice que sí, vive en la base (`ajustes_cuenta`), no en `local.js`. Por tres razones: se apaga en segundos con un `update`, sin desplegar Pages; lo lee la función, que es la puerta real; y no arrastra a `descubrimiento.mjs` ni a la prueba que fija las banderas (`scripts/pruebas/funciones.test.mjs:57`).

> **v0.3.1.** Lo construido es la otra opción: A2 puso la bandera `pagarEnMesa` (apagada) en `assets/js/local.js`, junto a `menuDeHoy` y `almuerzoProgramado`, y la prueba que fija las banderas ya la espera. La tabla `ajustes_cuenta` y el 503 `apagado` no existen. La diferencia práctica: apagar «Pagar» exige un commit y un push de Pages, no un `update`. Y como `pagarEnMesa` no se anuncia a los agentes, `privacy.html` y `auth.md` solo hablan del botón con ella encendida (§04.7, B4).

### 04.7 Cambios en `carta.html`

Las líneas citadas son de `7028919`, que ya trae el sondeo de 10 s de `be68c6b`. A2 sale de `83a2f70` (sin propina), que difiere de `7028919` en 4 líneas de `carta.html`.

| Fase | Cambio | Dónde engancha |
|---|---|---|
| 1 | Carga diferida de supabase-js 2.117.2 (la de `menu.html:45`), con `document.createElement('script')`, `integrity="sha384-…"` y `crossorigin="anonymous"`. **SRI también en Alpine** (`carta.html:41`). 1C calcula los *hashes* del archivo exacto (§11, SD10) | `carta.html:39-41` |
| 1 | `<meta name="referrer" content="no-referrer">` | `<head>` |
| 1 | Máquina de conexión con estados `vivo`, `sondeo`, `sin_red` y `vencido`. Canal, *debounce* de 400 ms, cubeta de 6 lecturas que recarga 1 cada 10 s, sondeo de seguridad de 60 s con detección por `marca` y cierre a los 60 s oculta. **Sin `canal` en la respuesta se queda en sondeo**: es compatible con la `cuenta` de hoy | Reemplaza el sondeo de 10 s (`carta.html:404`, `:525-552`). `cargarCuenta` (`:573-598`) suma `o` y los campos nuevos |
| 1 | `o`: se guarda en memoria y en `sessionStorage['cuenta:'+mesa]`. Al cargar, se recupera **solo** si `performance.getEntriesByType('navigation')[0].type` es `reload` o `back_forward` | `init()` (`carta.html:424`) |
| 1 | Estados nuevos de la hoja, `cerrada` y `vencido`, además de `cargando`, `error`, `vacia` y `ok` | Marcado de la hoja (`carta.html:271-338`) |
| 1 | El rótulo «**Consumo en vivo · no es factura**». «Leída hace X s». Pastilla de conexión con texto, no solo color. `role="status" aria-live="polite"` con «Se agregó…», calculado por diferencia de grupos. Resaltado que respeta `prefers-reduced-motion` | Encabezado y lista de la hoja |
| 1 | La barra fija muestra el total: «Ver mi cuenta · Mesa 3 · $ 45.000» (ya lo hace `be68c6b`, `carta.html:252`) | `carta.html:248-262` |
| A2 | **Escritorio** (§03.6): rejilla de dos o tres columnas desde `lg:`, índice de categorías `sticky`, panel `<aside>` con «Ocultar cuenta». La barra fija y la hoja modal quedan solo por debajo de 1024 px | `<main>` (`:157`), pestañas (`:150`), barra (`:248-262`), hoja (`:266-338`) |
| A2 | **Pagar** (§03.3): estados `elegir`, `avisando` y `avisado`, más los errores; `POST alerta`; `sessionStorage['alerta:'+mesa]`; anuncios en `aria-live`; el aviso de 3 minutos | Pie de la hoja (`:325-338`) y del panel |
| A2 | *(Reemplazado el 2026-10-02: el texto fijo se quitó; ver el aviso del inicio.)* El texto fijo «Esta página nunca muestra datos bancarios ni códigos para pagar». **Ningún dato de pago en el HTML ni leído de la URL** (sigue valiendo: la llave y el QR llegan de `cuenta`, no del HTML ni de la URL). Todo dato del servidor se pinta con `x-text`, nunca con `x-html` | — |
| A2 | Íconos de QR, transferencia y efectivo con `node scripts/iconos.mjs`, y clases nuevas con `node scripts/css.mjs` | El sprite (`carta.html:45+`) y `assets/css/resplandor.css` |
| B3 | Con `cuenta.alerta`, todos los teléfonos muestran «Ya avisamos: ‹método› · hh:mm» y «El mesero ya vio el aviso» | El mismo bloque de Pagar |
| **B4** | **Abonos** (§03.5.1): una línea de **precio negativo** se muestra como abono, no como producto. En lugar de «1×» lleva un «−»; el monto va con signo menos real (`−$ 40.000`, U+2212) y en turquesa (`cuenta-cant--abono`, `cuenta-monto--abono`, el tono de «confirmado» sobre papel, 5,27); no suma a «N productos»; se anuncia «Se registró un abono de $ X», nunca «Se agregó 1 × Abono recibido». Los abonos van **al final** de la lista | La lista de ítems de la hoja y del panel (`carta.html`), `_agrupar`, `_anunciar` y `pesos()`. Se detecta por el signo del precio, no por el nombre |
| **B4** | **El total es lo que queda.** Con abonos, el pie suma «Consumo» y «Abonos recibidos» sobre el total, y el rótulo pasa de «Total» a **«Queda por pagar»** (mientras quede algo, `total > 0`). El `total` es el del servidor (la suma de precio × cantidad de todas las líneas), no se recalcula | El pie de la hoja y del panel. Sin abonos, el pie es el de siempre (`<template x-if="hayAbonos">`) |
| **B4** | **La agrupación no suma abonos distintos.** La llave sigue siendo nombre + precio: abonos de montos distintos son líneas distintas; los del mismo monto se agrupan como el servidor y se leen «2 abonos de $ 10.000» con su suma, sin el «2×» de un producto | `_agrupar` (carta) y `agruparItems` (`cuenta`, §04.3). Vigilado por `scripts/pruebas/carta-abonos.test.mjs` |
| **B4** | `privacy.html` y `auth.md` (generados por `scripts/descubrimiento.mjs`): «Mi cuenta», el código en el enlace, el canal en vivo, el `sessionStorage` de la carta, el personal y, **solo con `pagarEnMesa` encendida**, que «Pagar» solo avisa. Ningún correo ni dato de pago. `menu.html` crea su cliente sin sesión | `construirPrivacy` y `construirAuthMd`; `menu.html` (`menuCal`) |

### 04.8 Cambios en `pos.html`

`tarea/pos-visual` ya commiteó su base (`b242a2b`, con +1.143 y −1.000 líneas en `pos.html` frente a `3bae016`). Sus 4 partes están en worktrees propios (`git worktree list`, 2026-09-30). Su especificación fija que los dos `<script>` (`pos.html:1652-3091` y `:4392-4408`) quedan **byte a byte iguales** y que ninguna parte toca `<script>` (`docs/pos-visual.md` §4.2 y §5).

**Consecuencia:** la lógica (dentro del `<script>`) puede ir antes; el marcado espera el merge de pos-visual. B1 espera además a 1D, porque las dos tocan `pushASupabase`, `pos_sync` y `rotarTokenMesa`.

| Parte | Cambio | Dónde engancha | Tamaño |
|---|---|---|---|
| **1D** | `pushASupabase('mesas')` manda solo `{id, capacidad, estado}`, nunca `token`. Hoy sube la fila local completa (`:2133-2138`), y una tablet con caché vieja **deshace una rotación** | `pos.html:2130-2144` | ~4 líneas |
| **1D** | `rotarTokenMesa` hace `update({token}).eq('id', …)` con `await` y revisa `error`. Si falla, revierte el token local y avisa; hoy lo traga `.catch(()=>{})` (`:2618`). Luego dice «Reescribe la pegatina con la contraseña» | `pos.html:2612-2619` | ~8 líneas |
| **1D** | `.subscribe(estado => …)` de `pos_sync`: al reconectar llama a `sincronizarSupabase()`. Hoy no tiene callback (`:2053`) | `pos.html:2048-2054` | ~6 líneas |
| **1D** (si D17) | `presencia_pos` con `config: { private: true, presence: {key} }` | `pos.html:2089-2092` | 1 línea |
| **1D** (refutación, H1) | `flushDeltas()` con candado: un solo vaciado de la cola de deltas a la vez en todo el POS (`aplicar_delta_orden` no es idempotente). Una llamada que llega durante un vaciado lo espera y pide una vuelta más. Pendiente a futuro: una llave de idempotencia por delta en la RPC, que también cubre una respuesta perdida | `flushDeltas`, `_vaciarCola` | ~25 líneas |
| **1D** (refutación, H2 y H3) | La resincronización **fusiona** la lectura con lo que la tablet aún no subió, en vez de pisar la lista. `pushASupabase` marca `ordenes`, `mesas` y `productos` en `_pendientes` (guardado en `localStorage`) mientras la subida no está confirmada, y devuelve `false` si el POS está offline. Una orden local se conserva si tiene deltas en cola, si su subida está pendiente o si su `version` es mayor que la de la lectura. Una orden pendiente que la base no devuelve se conserva y se vuelve a subir (sin ítems y con `ignoreDuplicates` si tiene deltas en cola, para no contarlos dos veces), salvo que la base ya tenga otra orden abierta en esa mesa. `cerrarDia()` guarda en el cierre las órdenes por purgar (`purgar`, solo local): no vuelven a las ventas de hoy hasta que la base las borre, y «Reintentar» las purga | `sincronizarSupabase`, `_fusionar…`, `_subirLoPendiente` | ~150 líneas |
| **B1** | **Rol.** Tras el login, `rpc('mi_rol')` **antes** de `cargarCachéLocal()`. Si devuelve `null` con red, borra la caché local y pasa a `vista = 'sin_acceso'`, sin sincronizar, sin Realtime y sin presencia. Sin red, usa el último rol guardado. Revalida al reconectar `pos_sync` y al volver a la pestaña. Getters `esAdmin` y `tieneAcceso` | `arrancarApp` (`pos.html:1921-1932`) | ~30 líneas |
| **B1** | Guardas de admin en las acciones, además de esconderlas: **borrar productos** (crear y editar son del mesero, D21), menú semanal, `cerrarDia`, reabrir, editar y eliminar órdenes cerradas y cierres pasados, y `rotarTokenMesa` (D24; aquí es la única guarda, porque la base no la impide, §02.3 nota 2) | `:2804`, `:2854`, `:2974-3045`, `:2689`, `:2766`, `:2797`, `:2612` | ~20 líneas |
| **B1** | Un rechazo de RLS (`42501`) en `pushASupabase` muestra «Solo el admin puede hacer esto» y llama a `sincronizarSupabase()`, para no quedar con estado local que la base no aceptó | `pushASupabase` (`:2130-2144`) | ~10 líneas |
| **B1** | Colección `alertas`: se carga en `sincronizarSupabase` y se escucha en `pos_sync`. Getters `alertasPendientes` (la más vieja primero, solo si la orden abierta coincide), `alertaDeMesa(mesaId)`, `alertasHoy` y `medianaRespuestaHoy` (admin) | `:2016-2047`, `:2048-2054`, junto a `ordenesAbiertas` (`:2217`) | ~40 líneas |
| **B1** | `atenderAlerta(id, estado)`: llama a la RPC `atender_alerta` o `descartar_alerta` con `await` y revisa `error` y `ok` (`no_pendiente` = «Ya la atendió»). Sin cola offline | Junto a `facturar` (`:2445`) | ~20 líneas |
| **B1** | **Cobro por unidades:** `itemsSeleccionados` pasa a `{itemId: cantidad}` (por defecto, la cantidad completa); `subtotalSeleccion` es Σ precio × cantidad elegida; `facturarParcial` mueve **n** unidades (la orden cerrada lleva el ítem con `qty = n` y la abierta recibe un delta de −n). `cobrarGrupoPersona` sigue con líneas completas | `toggleSeleccionItem`, `subtotalSeleccion`, `facturarParcial`, `cobrarGrupoPersona` (`pos.html:4241-4345`) | ~30 líneas |
| **B1** | **Cobro por monto:** una orden cerrada «Abono · Mesa N» con un ítem `abono_<uid>` por el monto, y en la abierta una línea «Abono recibido» de precio negativo por `aplicar_delta_orden` (`p_precio = −monto`, delta +1). El método va en la nota. Valida 0 < monto < total pendiente; si el monto iguala el total, es el cobro normal. El ticket dice cuánto queda. **La línea «Abono recibido» no se puede quitar con los controles de cantidad** (§03.5.1) | Junto a `facturarParcial` | ~50 líneas |
| **B1** | Sonido: WebAudio, desbloqueo en el primer `pointerdown`, recordatorio cada 2 minutos, «Silenciar 10 min» en `localStorage`, `document.title` y `navigator.vibrate` | Store | ~35 líneas |
| **B1** | Personal (admin): `cargarPersonal`, `altaPersona`, `cambiarRol`, `darDeBaja` y `reactivar`. Normaliza el correo y traduce el error `ultimo_admin` | Store | ~40 líneas |
| **B1** | ~~`cerrarDia` borra las alertas no pendientes después de subir el cierre (D28).~~ **v0.4: no hace falta, lo hace la base (§12.7).** *(Antes:* A1 no deja a `authenticated` borrar `alertas`, §04.5.*)* | `:2804-2843` | ~3 líneas |
| **B1** (si D17) | La policy de `presencia_pos` exige `public.mi_rol() is not null` en lugar de solo el proveedor | Migración de 1D | 2 líneas. **Hecho en la integración** (§04.2) |
| **B2** | Pantalla «Tu cuenta no está habilitada», con el correo y «Cerrar sesión» | Junto a la puerta (`pos.html:3096`) | ~20 líneas |
| **B2** | Barra: píldora «N por cobrar» (`.nav-pill-aviso`) y pestañas «Alertas» y «Personal» (esta, con `x-show="$store.pos.esAdmin"`) | `:3184-3203` | ~20 líneas |
| **B2** | Vista Alertas, insignia en la tarjeta de la mesa y franja en la orden | `:3211+`, `:3247-3251`, junto a `ordenReabiertaAviso` (`:3415-3419`) | ~80 líneas |
| **B2** | Vista Personal: lista, alta, rol, baja y reactivar, con confirmaciones | Sección nueva | ~70 líneas |
| **B2** | Esconder al mesero: **«Eliminar» producto** (no «Nuevo producto» ni editar: el mesero los tiene, D21); «Cerrar día» y las acciones sobre cierres pasados; **«Editar» y «Reabrir» de las órdenes cerradas, y ninguno de los dos sobre una orden de abono**; la edición del menú semanal y las sugerencias; «Rotar» | `:3972+`, `:3658+`, `:3856+` y el bloque del enlace NFC | ~25 líneas |
| **B2** | **Cobrar por partes:** el selector «Cobrar [−] n [+] de qty» de las líneas con más de una unidad, y el campo de monto con el método (efectivo, QR o transferencia) y el aviso de cuánto queda | Modo «Cobrar por partes» de la orden (`pos.html:5145-5210`) | ~60 líneas |

---

## 05 — Seguridad

**Principio:** nada se cobra ni se cierra desde la pegatina, y la página nunca dice a dónde pagar. Pagar solo avisa; el mesero cobra y cierra. Lo que puede hacer cada persona del POS lo decide la base, no la interfaz.

| # | Amenaza | Vector | Mitigación | Residual |
|---|---|---|---|---|
| S1 | **Alerta falsa o broma** | Toques desde la mesa, o desde fuera con el enlace | Una alerta solo avisa: no cobra ni cierra nada. Una pendiente por mesa, 5 alertas por orden en la base, rate-limit y «Descartar» | Hasta 5 avisos falsos por orden. Molestia, sin pérdida |
| S2 | **Phishing: datos de pago falsos** | (a) Pegatina reescrita o pegada encima, que lleva a un clon que pide transferir a otra cuenta (FTC: https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information). (b) Datos de pago por la URL. (c) Repo o Pages comprometidos. (d) CDN comprometido | *(Reemplazado el 2026-10-02: la carta muestra la llave y el QR del restaurante; ver el aviso del inicio.)* **La página real nunca muestra datos de pago, y lo dice al pagar:** un clon que los muestre se delata. Los datos van impresos con el mesero. (a) Contraseña de escritura en las NTAG215 (D16), revisión diaria leyendo el dominio (§03.9) y CORS con lista en las dos funciones. **«Mesa N · resplandor.ynt.codes» dentro de la página no protege: el clon lo copia.** (b) No hay ningún dato de pago que leer. (c) 2FA en GitHub y Supabase (sin dato, §10) y revisar el diff de `carta.html` en cada merge. Una prueba estática de A2 falla si aparece un número de cuenta, una llave o un QR en la carta. (d) SRI en Alpine y supabase-js (§04.7) | Un cliente que no lee el aviso y le paga a un clon. El restaurante no pierde, porque solo da por pagado lo que ve en su banco |
| S3 | **Fuga o reuso del token** | Un enlace guardado, el QR fotografiado o el token en el Referer | Fuga aceptada para ver y para avisar, sin datos de pago ni personales (S8). `o` evita que una pestaña vieja vea la orden siguiente. `no-referrer`. Rotación por un admin (D24) con `update` dedicado y error visible (1D). El token sale en los logs de las funciones, que solo ve Yonatan. Opciones B y C de §03.7 | Un tercero con el enlace ve la cuenta abierta de la mesa y puede avisar (S1) |
| S4 | **Spam de alertas e inundación de `alerta`** | Repetir toques, o un script contra la función | 6 por minuto por (IP, mesa) y 30 por minuto por IP. Tope de 5 por orden en la base. Los toques repetidos actualizan la misma pendiente. El POS solo suena con una alerta nueva o un cambio de método | Las invocaciones se cobran aunque respondan 429 (§07) |
| S5 | **Escalada de rol** | Un mesero que se pone `admin`, edita precios o el menú por la API, o firma como otro | `personal` solo la escribe un admin (RLS). Los permisos por rol están en la base (§02.3). `atendida_por` lo pone un trigger. `mi_rol()` es `security definer` con `search_path` vacío y sin parámetros | Un admin comprometido. Ya es un riesgo del POS hoy |
| S6 | **Canal Realtime expuesto** | Escuchar el tópico, publicar señales falsas o saturar los límites del proyecto | El tópico es `sha256(token)` y el payload va vacío. Cada teléfono lee como mucho ~7 veces por minuto ante una inundación (cubeta, §03.2.5). Las alertas llegan al POS por `postgres_changes` con RLS, no por un canal público. Los límites por proyecto (100 mensajes/s, 200 conexiones; realtime/limits) se comparten con el POS: **ese riesgo ya existe hoy** (R5). S-0 permitiría pasar a d1 | DoS del Realtime del proyecto, como hoy. Egress acotado (§07) |
| S7 | **Integridad del monto** | El cliente cambia el total, o el mesero cobra un total viejo | No hay ruta de escritura a ítems ni total desde la pegatina. El mesero cobra el total del POS, que es el de la base después de vaciar la cola | Un cobro con el total local atrasado si la tablet tenía la cola llena. Ya pasa hoy |
| S8 | **Privacidad** (Ley 1581) | Datos del personal; el nombre en la presencia | La cuenta no lleva nombres, teléfonos ni documentos. `personal` (correo y nombre) solo la lee el admin. `alertas.atendida_por` guarda el correo de alguien del personal y se borra pasado un día de resuelta la alerta (D28, ola C, §12.7). `presencia_pos` publica `nombre: nombreUsuario` en un canal público (`pos.html:2119-2124`) y pasa a privado con D17. **Hecho en B4:** `privacy.html` y `auth.md` (generados por `scripts/descubrimiento.mjs`) explican la cuenta de la mesa, el personal y que «Pagar» solo avisa (solo con `pagarEnMesa` encendida); ninguno lleva un correo. La retención de los avisos que promete `privacy.html` («se borra pasado un día», v0.4) la cumple la base (§12.7) | Bajo |
| S9 | **Cualquier cuenta de Google como «mesero»** | Registro abierto o Google fuera de Testing (`README.md:239-241`). `solo_google` solo mira el proveedor (`20260905000000_resplandor_base.sql:265-281`) | **Lo resuelve `solo_personal`:** sin fila activa no hay acceso (§02.3). `mi_rol()` exige Google y reconoce a la persona por su **identidad de Google**, no por el correo de `auth.users`, que el usuario puede cambiar: una cuenta con contraseña y el correo de un admin no hereda su rol. **D23: Google sale de Testing solo después de que la compuerta esté aplicada y verificada** (§02.5, paso 3); antes, publicar abre el POS a cualquier Gmail. Proveedor Email apagado, como recomendación | Una cuenta de Google del personal que se compromete |
| S10 | **Abuso de `alerta` o de las RPC** | Inyección, un cuerpo enorme, o llamar a `/rest/v1/rpc/alerta_cliente` directo | Cuerpo de hasta 1 KB, validadores estrictos y un único `rpc` con parámetros tipados. `alerta_cliente` es `security invoker` y solo `service_role` la ejecuta | Bajo |
| S11 | **Un trigger rompe escrituras del POS** | `emitir_cuenta` (fase 1), `ordenes_cierra_alertas`, `ordenes_descarta_alertas` o `token_solo_admin` (olas A y B) | `exception when others` con `raise warning` en los triggers de `ordenes`. Aplicar después de las 17:00, reversas en menos de 1 minuto y pruebas S-3 y R-7 | Bajo |
| S12 | **XSS** | Un nombre del personal o un texto con HTML | `x-text` en la carta y el POS, y `check` de formato en la base | Bajo |
| S13 | **Agentes** | Un agente que dispara alertas | `alerta` no se expone en WebMCP, MCP ni `llms.txt`. El comentario de `local.js:172-175` la suma | Ninguno |
| S14 | **Una baja que no surte efecto** | La sesión abierta o la caché local de un mesero dado de baja | `mi_rol()` lee la tabla en cada consulta. Realtime aplica la RLS. El POS revalida el rol y borra la caché (B1) | Lo que ya estaba en la pantalla o en la caché de un dispositivo sin red |
| S15 | **Nadie puede entrar al POS** | `solo_personal` antes del alta, o un correo mal escrito | El orden de §02.5. La migración se niega sin un admin activo. El trigger `ultimo_admin`. El SQL Editor como puerta de atrás. Reversa en menos de 1 minuto | Minutos sin POS si se aplica en servicio. Por eso, después de las 17:00 |

---

## 06 — Normativa y UX

| Tema | Regla | Fuente | Qué hace el diseño |
|---|---|---|---|
| **Propina** | — | Nota del encabezado (2026-09-30) | No se pide, no se sugiere y no se registra. No hay opciones en la carta, ni campo en el POS, ni línea en el ticket |
| **Precuenta** | «Queda prohibido expedir al consumidor documentos diferentes a la factura», lo que incluye prefactura y precuenta. Solo los hoteles tienen excepción | CU de la SIC 2.4.3-2.4.4 (https://normas.cra.gov.co/gestor/docs/circular_superindustria_unica.htm) | El rótulo «Consumo en vivo · no es factura», y nunca llamar «factura» a la pantalla. Pagar no muestra un monto a transferir ni datos: solo avisa. Consulta legal recomendada (D5), que ya no bloquea. El POS ya imprime una «pre-cuenta» rotulada «solo informativa» (`pos.html:3551`) |
| **Factura** | Un responsable de impoconsumo expide factura o documento equivalente por cada operación. El comprobante bancario no lo reemplaza | Resolución DIAN 165 de 2023 (https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm). ET 616-1 | Fuera de alcance (`README.md:78`). Camila define qué documento entrega (§10) |
| **Impuesto en la carta** | Los restaurantes tributan impoconsumo del 8 % | ET 512-1 y 512-9 | `carta.html:226` dice «IVA incluido»: se confirma con el régimen real (D6), en otra tarea |
| **Precios** | Lista visible o carta física, sin registro para verlos, sin «20K» | CU 2.4 y sus parágrafos | La pegatina complementa la carta física. Sin login. Formato `$ 23.000` (`pesos()`, `carta.html:422`) |
| **Habeas data** | Un dato personal es lo que se puede asociar a una persona. En internet, solo con acceso restringido | Ley 1581 de 2012, arts. 3 y 4 | S8. El token controla el acceso a la cuenta. `personal` solo la ve el admin. Presencia del POS privada (D17) |
| **Táctil** | Mínimo 24 × 24 px; la meta es 44 px | WCAG 2.2, 2.5.8 (https://www.w3.org/TR/WCAG22/) | Botones de 44 px, incluidos los tres métodos y «Atender» y «Descartar» |
| **Contenido que se actualiza solo** | Se puede pausar, detener u ocultar | WCAG 2.2.2 | La hoja se cierra con «Listo» y el panel de escritorio se pliega con «Ocultar cuenta»: ese es el mecanismo. El botón «Actualizar» se quitó por pedido de Yonatan (`tareas/2026-09-30-cuenta-hoja.md`). No mueve el foco ni el scroll |
| **Mensajes de estado** | Se anuncian sin mover el foco | WCAG 4.1.3 | `role="status" aria-live="polite"` para «Se agregó…» y «Le avisamos al mesero» |
| **Panel no modal** | Un diálogo modal atrapa el foco; un complementario, no | WAI-ARIA, roles `dialog` y `complementary` | El panel de escritorio es un `<aside>` con nombre, no un diálogo |
| **NFC** | Los iPhone XR y SE 2 en adelante leen en segundo plano; del 7 al X hace falta el Centro de control | Apple (https://support.apple.com/en-euro/guide/iphone/aside/asd-nfc-reader/15.0/ios) | QR impreso de respaldo en cada pegatina, con «acerca el teléfono o escanea» |
| **Celular primero, escritorio completo** | — | — | Cabe en 320 px (`scripts/pruebas/desborde.test.mjs`). Una acción principal por pantalla. supabase-js solo al abrir la cuenta. A ≥ 1024 px, panel lateral (§03.6) |

**Nueve principios:**

1. Ver no es pagar.
2. Pagar es avisar: la pegatina solo llama al mesero, con el método.
3. ~~La página nunca muestra a dónde pagar: ni cuenta, ni llave, ni QR.~~ *(Reemplazado el 2026-10-02: la carta muestra la llave y el QR de Bre-B del restaurante solo con una cuenta abierta; ver el aviso del inicio.)*
4. El dinero lo recibe una persona, y la confirmación es humana.
5. El total que se ve es el que dice la base.
6. Siempre hay mesero y papel: efectivo, datáfono y carta física.
7. En vivo y honesto: «En vivo» solo si lo está, «leída hace X s» y «sin conexión».
8. Celular primero; en escritorio, sin perder nada.
9. Mínimo de datos: cada quien ve lo que su rol necesita.

---

## 07 — Costos frente al plan Free

**Cupos del proyecto `lccgehvyymladqvumcez`** (plan Free, org propia; fuente: el encargo de la tarea):

| Recurso | Cupo |
|---|---|
| Egress | 5 GB + 5 GB al mes. Se usa 5 GB, porque las respuestas son `no-store` (§11, M6) |
| Realtime | 2 M mensajes y 200 conexiones pico |
| Edge Functions | 500 k invocaciones al mes |

**Hipótesis, no medidas.** El origen tenía 24 órdenes en total (`tareas/2026-09-29-supabase-propio.md:65`).

- **H1.** 10 mesas × 3 cuentas por día × 30 días = **900 cuentas al mes**. Es un techo holgado.
- **H2.** 8 cambios de `ordenes` más 2 de `alertas` (crearla y cerrarla) = **10 señales por cuenta**.
- **H3.** **2 teléfonos por mesa.** Cada uno abre la hoja 3 veces y la tiene abierta unos 10 minutos. Un escritorio con enlace de mesa cuenta como un teléfono: es raro, porque en la mesa se usa el celular.
- **H4.** **4 dispositivos del POS** reciben los cambios de `alertas`.

Cada mensaje cuenta 1 enviado más 1 por receptor (platform/manage-your-usage/realtime-messages). Los `postgres_changes` de `ordenes` al POS ya existen hoy y no se suman.

| Recurso | Cálculo | Uso al mes | % del cupo |
|---|---|---|---|
| Mensajes Realtime a la carta | 900 × 10 × (1 + 2) | 27.000 | 1,35 % |
| Mensajes Realtime de `alertas` al POS | 900 × 2 × (1 + 4) | 9.000 | 0,45 % |
| **Total de mensajes** | — | 36.000 | **1,8 %** de 2 M |
| Conexiones pico | 10 mesas × 2 + ~4 dispositivos del POS | ~24 | **12 %** de 200 (se comparten con `menu.html` cuando se encienda) |
| Invocaciones de `cuenta` | Por teléfono: 3 aperturas × 2 GET + 10 señales + 10 sondeos de seguridad = 26. × 2 teléfonos × 900 | 46.800 | 9,4 % |
| Invocaciones de `alerta` | ~1,2 por cuenta (un toque y algún cambio de método) × 900 | ~1.100 | 0,2 % |
| **Total de invocaciones** (sin `votar`, hoy apagada) | — | ~47.900 | **9,6 %** de 500 k |
| Peor caso: Realtime caído todo el mes y sondeo de 20 s con un teléfono siempre abierto (1.500 h-visor) | 1.500 × 3.600 / 20 | 270.000 | 54 % |
| Ataque: inundación de señales en una mesa, 3 teléfonos abiertos 5 h al día durante 30 días | 7 GET/min × 3 × 300 min × 30 | 189.000 | 38 %. Se corta rotando el token de esa mesa |
| Egress | 47.900 × ~2,2 KB + 36.000 × ~0,3 KB | ~0,12 GB | **~2,3 %** de 5 GB |
| Egress, peor caso | 270.000 × 2,2 KB | ~0,6 GB | 12 % |
| Filas en la base | ≤ ~1.100 alertas al mes, borradas un día después de resueltas (D28). `personal`, menos de 20. `realtime.messages` retiene ~900 filas (3 días) | — | Despreciable |

**Notas:**

- Los ~2,2 KB son 1.139 B de cabeceras medidos más ~1 KB de cuerpo supuesto (investigación de tiempo real).
- Sin QR ni datos de pago, ninguna respuesta pasa de unos pocos KB. Con el QR dentro de `cuenta` serían ~40 KB por lectura (§11, SD8 y M6).
- Las invocaciones se cobran aunque respondan 404 o 429 (platform/manage-your-usage/edge-function-invocations). Un script contra `alerta` gasta invocaciones igual que uno contra `cuenta` hoy.
- **El egress importa más que el resto:** el proyecto anterior murió por `exceed_egress_quota` (`tareas/2026-09-29-supabase-propio.md:15`), y un 402 tumba también el POS. Después de un día real se revisa el reporte de uso (S-9).

---

## 08 — Fases, olas y partición en worktrees

**Reglas comunes:**

- **Cada parte vive en su propio worktree.**
  - Fase 1: `~/Developer/worktrees/resplandor--cuenta-en-mesa--<clave>`, con la rama `tarea/cuenta-en-mesa--<clave>` creada desde `tarea/cuenta-en-mesa`.
  - Olas A y B: `~/Developer/worktrees/resplandor--<clave>` con la rama `tarea/<clave>`, como las que ya existen (`git worktree list`, 2026-09-30).
- La integración se hace en `tarea/cuenta-en-mesa`. **Nunca push.** Commits con rutas explícitas.
- Al cerrar, cada parte corre con Node 22, como CI (`.github/workflows/comprobar.yml`): `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH`. El Node por defecto de esta máquina es v16 y no sirve.
  - `node --test scripts/pruebas/*.test.mjs`;
  - `node scripts/css.mjs --comprobar`;
  - `node scripts/iconos.mjs --comprobar`;
  - `node scripts/descubrimiento.mjs --comprobar`.
- Dos pruebas afectan a todas las partes: `css.test.mjs:21-30` exige regenerar `resplandor.css`, y `desborde.test.mjs` exige 320 px.
- **Pruebas locales, nunca contra producción:**
  - **Base:** Postgres 17 desechable en Docker, con los roles `anon`, `authenticated` y `service_role` simulados y `auth.jwt()` leyendo `request.jwt.claims`. La prueba se salta sola si no hay Docker, para no romper la suite ni CI.
  - **Navegador:** Playwright, encontrado con `buscarPlaywright` de `scripts/pruebas/_navegador.mjs`, con la red simulada.
- **Desplegar es de Yonatan, con su GO** (Línea Roja). El orden está al final de esta sección.

### Fase 0: decisiones, datos y preparación (sin código)

| Qué | Quién | Bloquea |
|---|---|---|
| Responder las decisiones abiertas (§09) | Yonatan y Camila | La salida al aire de las olas, no su código |
| Correos de Google, nombres y rol de **todo** el personal actual (D22) | Camila. Los pega Yonatan (§02.5) | `solo_personal` |
| Google OAuth fuera de Testing, **solo después de la compuerta verificada** (D23, decidida), y proveedor Email apagado | Yonatan | El alta de meseros desde el POS |
| Contraseña de escritura en las 10 pegatinas (D16) | Yonatan | Pagar al aire |
| QR del banco impreso y una tarjeta con los datos de la cuenta para el mesero | Camila | Pagar al aire |
| Quién y cómo ve los abonos (D1) | Camila | Pagar al aire |

### Fase 1: cuenta en vivo, solo lectura, y arreglos de lógica del POS (sin cambios)

- **Objetivo:** la pegatina refleja en ≤ 2 s (p95) un cambio aislado. Detecta el canal mudo y cae a sondeo. La rotación del token ya no se deshace.
- **Estado:** en construcción en cuatro worktrees: `1a-senal-bd`, `1b-cuenta-v2`, `1c-carta-vivo` y `1d-pos-logica`.
- **La bloquea:** nada para el código. Para salir al aire, el GO de Yonatan.

| Parte | Archivos (exclusivos) | Alcance | Depende de |
|---|---|---|---|
| **1A `senal-bd`** | `supabase/migrations/20261001120000_cuenta_en_vivo.sql` (nueva) y `scripts/pruebas/migracion-cuenta-en-vivo.test.mjs` (nueva) | El SQL de §04.2 con la reversa comentada. La prueba estática revisa el texto: `security definer` y `search_path = ''`; `exception when others`; `realtime.send(…, false)`; la guarda `is distinct from`; la rama de tablas con `orden_id` lee la mesa de `ordenes`; cero `grant … to anon`; cero policies en `realtime.messages`. Fija el vector del tópico, compartido con 1B: `cuenta:` + sha256 de un token de 48 ceros | — |
| **1B `cuenta-v2`** | `supabase/functions/cuenta/index.ts`, `supabase/functions/_compartido/mesa.js` (nueva) y `scripts/pruebas/fn-cuenta.test.mjs` (nueva) | El contrato de §04.3: `estado`, `orden_id`, `marca` (con `0` como segundo componente), `actualizada_en`, `canal`, `servidor_en`, `o`, los `codigo`, ítems agrupados, CORS con lista, el rate-limit nuevo y el corte por 404. `mesa.js` en JS puro, probado en Node: validadores, limitador, `agruparItems` y `topicoCuenta` contra el vector de 1A. (v0.2 pedía además `liquidacion: null` y `liquidar_activo: false`; ya no hacen falta, y si están no estorban) | Vector de 1A, ya fijado aquí |
| **1C `carta-vivo`** | `carta.html`, `assets/css/resplandor.css` (regenerada), `scripts/pruebas/_carta-vm.mjs` (nueva: arnés copiado de `funciones.test.mjs:771-798`, con `location.search`, `performance`, `sessionStorage`, `supabase` y `fetch` simulados) y `scripts/pruebas/cuenta-en-vivo.test.mjs` (nueva) | Filas de fase 1 de §04.7: SRI, `no-referrer`, máquina de conexión, cubeta, sondeo de seguridad con `marca`, regla de `o` por tipo de navegación, estados `cerrada` y `vencido`, `aria-live`, «leída hace X s», rótulo y total en la barra. Pruebas: canal mudo → sondeo; sin `canal` → sondeo; inundación de 60 señales → ≤ 7 lecturas por minuto; `navigate` descarta `o` | El contrato de 1B, simulado |
| **1D `pos-logica`** | `pos.html`, **solo dentro de `<script>` (`:1652-3091`)**; `supabase/migrations/20261001130000_presencia_privada.sql` (nueva, si D17); `scripts/pruebas/pos-cuenta-base.test.mjs` (nueva, estática) | Filas 1D de §04.8. Prueba estática: `pushASupabase('mesas')` no manda `token`; `rotarTokenMesa` usa `update` y revisa `error`; `pos_sync` tiene callback; y si D17, `presencia_pos` es `private` | — |

- **Orden de merge:** 1A, 1B, 1C y 1D no comparten archivos; el orden da igual.
- 1D toca el `<script>` de `pos.html`, que pos-visual no toca (`docs/pos-visual.md` §5). Antes de integrar se repite `git merge-tree` con `tarea/pos-visual`.

**Pruebas de humo de la fase 1, en vivo y con el GO de Yonatan:**

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

**Criterio de cierre de la fase 1:** la suite y los tres `--comprobar` en verde; S-1 a S-9 pasadas, y S-10 si D17; la pegatina piloto real muestra un ítem agregado en ≤ 2 s p95; el visto de Yonatan.

### Ola A (en curso): base de roles y alertas, carta de escritorio y Pagar

- **Objetivo:** dejar listas, y probadas en local, la base de roles y alertas, la función `alerta` y la carta con escritorio y Pagar.
- **La bloquea:** nada para el código. Para salir al aire, el orden de abajo.

| Parte | Rama y worktree | Archivos (exclusivos) | Alcance | Depende de |
|---|---|---|---|---|
| **A1 `roles-alertas-bd`** | `tarea/roles-alertas-bd`, desde `7028919`, en `resplandor--roles-alertas-bd` | Las tres migraciones de §04.5 (nuevas); `supabase/functions/alerta/index.ts` y `supabase/functions/_compartido/alerta.js` (nuevas); las pruebas `scripts/pruebas/migracion-roles-alertas.test.mjs` (estática), `bd-roles-alertas.test.mjs` (Docker) y `fn-alerta.test.mjs` (nuevas). Nombres propuestos: si la parte ya eligió otros, mandan los suyos. **Construida (`2d163f5`) con otros nombres y la compuerta aparte: ver la tabla de §04.5** | §04.4 y §04.5. Pruebas en Docker, por rol: anon no lee nada; una cuenta de Google sin fila no lee nada; el mesero lee todo, crea y edita productos (D21) y no borra productos ni escribe menú, cierres ni personal; el admin, todo; `ultimo_admin`; el token se le ignora al mesero (**no construido**, §04.5); `alertar_cuenta` con par malo, sin orden, upsert de la pendiente, tope (**no construido**) y carrera con el cierre; trigger de cierre (`atendida`) y de borrado (`descartada`); `atendida_por` sellado; `solo_personal` se niega sin admin; cero correos reales en el repo, solo marcadores `<…>` | La fase 1, solo para el trigger `alertas_emite_cuenta`, que se crea si existe `privado.emitir_cuenta` |
| **A2 `carta-escritorio-pagar`** | `tarea/carta-escritorio-pagar`, desde `83a2f70` (`carta.html` sin propina), en `resplandor--carta-escritorio-pagar` | `carta.html`, `assets/css/resplandor.css` (regenerada), el sprite de íconos, `scripts/pruebas/carta-escritorio.test.mjs` y `scripts/pruebas/carta-pagar.test.mjs` (nuevas) | §03.3, §03.6 y las filas A2 de §04.7. Pruebas en Playwright con `alerta` y `cuenta` simuladas: a 1024 y 1440 px, el panel lateral, sin desborde; sin `m&k` no hay panel; a 320 px, igual que hoy; ningún método preseleccionado; 200 → avisado; 409, 404, 429, 503 y red caída, cada uno con su texto; `sessionStorage` sobrevive a una recarga; ningún dato bancario ni QR en el HTML; foco y teclado. **Dos commits separados, escritorio y Pagar**, para poder sacar el escritorio antes | El contrato de A1 (§04.4), simulado |

- **Conflictos:** A2 y 1C tocan `carta.html` y `resplandor.css`. La que se integre segunda se rebasa sobre la primera. `resplandor.css` se regenera con `node scripts/css.mjs`; no se resuelve a mano. A1 y 1A no comparten archivos, y A1 crea `privado` con `if not exists`.
- **Orden de merge:** después de la fase 1, A1 y luego A2 (A2 solo necesita el contrato de A1).

### Ola B (espera): el POS con alertas, personal y roles

- **Objetivo:** el POS oye las alertas, el admin gestiona el personal, el mesero deja de ver lo que no le toca, y el POS cobra por unidades de una línea y por monto (§03.5.1).
- **La bloquean:**
  - el **merge de `tarea/pos-visual` a `main`**, para B2 (marcado);
  - **la fase 1 integrada en `pos.html`** (1D), para B1: las dos tocan `pushASupabase`, `pos_sync` y `rotarTokenMesa`;
  - B3 espera además a 1B, 1C, A1 y A2.

| Parte | Archivos (exclusivos) | Alcance | Depende de |
|---|---|---|---|
| **B1 `pos-roles-alertas-logica`** | `pos.html`, **solo `<script>`**, y `scripts/pruebas/pos-roles-alertas.test.mjs` (nueva, estática y en vm sobre el store extraído) | Filas B1 de §04.8, **con el cobro por unidades y por monto** (§03.5.1). Pruebas: sin rol, la caché se borra y no sincroniza; guardas de admin; un 42501 avisa y resincroniza; una alerta nueva dispara el pitido (simulado), el título y la píldora; atender por RPC y «Ya la atendió»; recordatorio a los 2 minutos; personal con `ultimo_admin`; cobro por unidades (`{itemId: cantidad}`, la orden cerrada con `qty = n`, delta de −n) y por monto (0 < monto < pendiente, línea negativa, el cierre del día cuadra, la línea del abono no se quita) | 1D integrada y el contrato de A1 |
| **B2 `pos-roles-alertas-marcado`** | `pos.html`, **solo marcado**, y `scripts/pruebas/pos-roles-alertas-vistas.test.mjs` (nueva, sobre `scripts/pruebas/_pos-simulado.mjs`, que llega con pos-visual en `4da9030`) | Filas B2 de §04.8, con las clases de pos-visual, **y el selector de unidades y el campo de monto** del modo «Cobrar por partes». Pruebas: el mesero no ve los controles de admin (sí «Nuevo producto» y editar, no «Eliminar»); el admin ve Personal; una alerta en dos tablets simuladas; 320 px | El merge de pos-visual a `main` y el rebase de `tarea/cuenta-en-mesa`. B1 integrada |
| **B3 `cuenta-alerta`** | `supabase/functions/cuenta/index.ts`, `supabase/functions/_compartido/mesa.js` y `alerta.js`, `carta.html` y sus pruebas | `cuenta` devuelve `alerta`, y la `marca` la incluye. La carta muestra el aviso en todos los teléfonos. Une el código compartido de `cuenta` y `alerta` | 1B, 1C, A1 y A2 integradas |
| **B4 `docs-y-confianza`** | `README.md` (§02, §06, §07, §08, §12, §13 y §16), `scripts/descubrimiento.mjs` (genera `privacy.html` y `auth.md`), `privacy.html` y `auth.md` (regenerados), `assets/js/local.js` (solo el comentario de `:172-175`), `menu.html` (`persistSession: false`), `carta.html` y `assets/css/carta-menu.css` (los abonos, §04.7), este SDD y las bitácoras de `tareas/`; pruebas: `carta-abonos.test.mjs` y `menu-sesion.test.mjs` (nuevas) y `descubrimiento.test.mjs` | `privacy.html`: «Mi cuenta», el token en la URL, qué guarda una alerta y qué se guarda del personal. `auth.md`: el sitio no muestra a dónde pagar ni cobra; Pagar solo avisa; ningún agente puede disparar alertas. El README documenta roles, tablas, funciones y el arranque. **Hecha** en `tarea/ola-b--b4-docs-carta` | — |

**Orden de merge en `tarea/cuenta-en-mesa`:** fase 1 → A1 → A2 → B1 → B2 → B3. B4, en cualquier momento.

### Ola C (v0.4): aprobación del personal, mesas y pegatinas, ticket y deshacer cobros

- **Objetivo:** que el admin apruebe al personal desde el POS, administre las mesas y sus pegatinas, configure el ticket y pueda devolver un cobro parcial a la cuenta (§12).
- **Parte de:** `tarea/ola-b` (`24487b9`), que ya trae los roles, las alertas, el panel Personal, el cobro por monto y por unidades, el pie del POS y el QR estático. **La ola B sale al aire antes que la C.**
- **Partes:** C1 (base de datos y funciones), C2 (lógica del POS), C3 (pantalla del POS) y C4 (documentos, carta y guía); detalle y contrato en §12.8.
- **Las migraciones** de la ola C llevan fechas posteriores a `20261002140000` (`150000` a `180000`), son idempotentes y corren encima de todas las anteriores.

### Orden de salida al aire

Todo con el GO de Yonatan. Las migraciones, después de las 17:00.

> **Estado (v0.4, 2026-10-01).** Los pasos **2 y 3 se hicieron** (2026-09-30, de noche): la compuerta quedó aplicada con **Yonatan como único admin** y `mi_rol()` devolvió `admin` desde su sesión (que R-0 se haya probado con una cuenta ajena, no consta). Camila y los meseros todavía no están dados de alta: entran con la ola B (alta por correo) o con la ola C (aprobación). **El paso 4 se pospone hasta el final de la ola C** (pasos C-1 a C-4, §12.9): Yonatan decidió que Google sale de Testing solo con la ola C al aire.

| Paso | Qué | Quién | Cómo se verifica | Si sale mal |
|---|---|---|---|---|
| 1 | Fase 1: migración de 1A → desplegar `cuenta` (1B) → push de 1C y 1D | Yonatan | S-1 a S-9 | Reversa de 1A; la carta cae a sondeo |
| 2 | **La compuerta y el alta inicial, en una sola transacción** (`personal_y_compuerta`, §02.5), con todo el personal. El SQL del alta va aparte, fuera del repo | Yonatan, con los correos que da Camila | La migración se niega si no hay un admin con cuenta de Google real. Después, `mi_rol()` devuelve `admin` desde la sesión de cada admin | La reversa de su cabecera (vuelve a `solo_google`) |
| 3 | **Verificar la compuerta** | Yonatan | R-0: un admin ve las mesas; una cuenta de Google fuera de la lista ve «sin acceso» y cero filas | Reversa en menos de 1 minuto |
| ~~**4**~~ | ~~**Google OAuth fuera de Testing** (D23). Solo con el paso 3 hecho~~ **Pospuesto (v0.4): se hace en C-4, con la ola C al aire** | Yonatan | Una cuenta de Google ajena entra al login y ve «espera aprobación», el mapa y la carta (R-15, §12.9) | Volver a Testing |
| 5 | Migración `alertas` y desplegar `alerta` (`--no-verify-jwt`). La carta no muestra «Pagar» mientras `pagarEnMesa` esté apagada | Yonatan | `curl` sin cuenta abierta → 409; con un origen ajeno → 403 | La reversa de la cabecera de `alertas`; borrar la función |
| 6 | Push del escritorio de A2, sin Pagar | Yonatan | R-9 | `git revert` |
| 7 | Push del POS de la ola B (B1 y B2, con el cobro por monto y por unidades), de Pagar (A2, encendiendo `pagarEnMesa`) y de B4 | Yonatan | R-3 y R-5 a R-10, R-13 y R-14 | `git revert` |
| 8 | Migración `permisos_por_rol` | Yonatan | R-1 a R-4 | Reversa en menos de 1 minuto |
| 9 | Dar por encendido Pagar (la bandera de `pagarEnMesa`), con el visto de Camila | Yonatan | R-11 y R-12 en un servicio real | Apagar la bandera y hacer push |
| 10 | B3 (`cuenta` con la alerta), cuando esté lista | Yonatan | S-2, ahora con la alerta | Volver a desplegar la `cuenta` anterior |
| C-1 a C-4 | **La ola C** (después de los pasos 7 y 8): las cuatro migraciones, `cuenta`, el POS de la ola C y, **al final, Google fuera de Testing** | Yonatan | R-15 a R-26 (§12.9) | La reversa de cada migración, volver a desplegar la `cuenta` anterior, `git revert` y volver a Testing |

Por qué este orden:

- Pagar (paso 7) nunca sale antes que el POS que lo oye. Si no, los clientes avisarían a nadie.
- Los permisos por rol (paso 8) nunca salen antes que el POS que los respeta (§02.5).
- La compuerta nunca sale sin el alta (paso 2: van juntas, en una transacción), y la migración se niega si no hay un admin que pueda entrar.
- **Google no sale de Testing antes de la compuerta verificada (pasos 2 y 3), y, desde v0.4, tampoco antes de la ola C.** Es la decisión D23 de Yonatan: antes de la compuerta, publicar abre el POS a cualquier Gmail; con la compuerta sola, esa cuenta ve «sin acceso», y con la aprobación queda pendiente y ve el mapa y la carta.
- La puerta (paso 2) sale lo antes posible, porque cierra S9 sin esperar a la ola B.

**Pruebas de humo de las olas** (con el GO de Yonatan, en una mesa real):

| Prueba | Qué verifica |
|---|---|
| R-0 | **Puerta.** Una cuenta de Google fuera de `personal` ve «sin acceso», y con su JWT las 6 tablas devuelven 0 filas. Un admin ve las mesas |
| R-1 | **Baja inmediata.** Un admin da de baja a un mesero con la sesión abierta: su siguiente escritura falla, su POS pasa a «sin acceso» al revalidar y deja de recibir cambios por Realtime |
| R-2 | **Último admin.** Dar de baja o degradar al único admin activo devuelve `ultimo_admin` |
| R-3 | **Mesero.** No ve los controles de admin (pero sí «Nuevo producto» y editar, D21). Un `upsert` directo a `menus` o `cierres` con su JWT devuelve 42501, y un `delete` de un producto devuelve 0 filas. **Sí** puede crear y editar un producto, abrir mesa, agregar, «Ítem manual», facturar, cobrar por partes (por ítems, por unidades y por monto), liberar una mesa vacía y ver las ventas y los cierres. **No** puede reabrir ni editar una orden cerrada |
| R-4 | **Token.** Un mesero, o una tablet con caché vieja, que manda otro token no lo cambia (si D24) |
| R-5 | **Alerta.** `POST alerta` con orden abierta → 200, y dos tablets suenan y muestran la píldora en ≤ 2 s. Un segundo toque con otro método actualiza la misma alerta (1 fila pendiente). Sin orden → 409; token malo → 404; método raro → 400; origen ajeno → 403; ráfaga → 429; sexta alerta de la orden → 429 `tope` |
| R-6 | Atender en la tablet A la quita de la B. Atender a la vez en A y B: una gana y la otra ve «Ya la atendió…» |
| R-7 | Facturar con una alerta pendiente la deja `atendida` con el correo de quien cerró. Liberar una mesa vacía la deja `descartada` |
| R-8 | **Sonido.** Suena tras el primer toque; «Silenciar 10 min» funciona; el recordatorio llega a los 2 minutos |
| R-9 | **Escritorio.** A 1024 y 1440 px, el panel lateral con la cuenta, sin desborde. A 320 px, igual que hoy |
| R-10 | **Ningún dato de pago.** La página publicada no tiene números de cuenta, llaves ni imágenes de QR |
| R-11 | Interruptor (si D25): apagado → 503, y la carta dice «Hazle una seña al mesero» |
| R-12 | En un servicio real, el tiempo entre la alerta y «Atender» o «Facturar». Si la mediana pasa de 3 minutos, se revisan el sonido y la operación |
| R-13 | **Cobro por monto.** En una mesa con 3 productos, abonar un monto menor al pendiente: se crea la orden cerrada «Abono · Mesa N», la mesa sigue abierta con la línea «Abono recibido» en negativo y el ticket dice cuánto queda. **La carta** del teléfono muestra la línea con signo menos y «Queda por pagar» con lo que falta, y anuncia «Se registró un abono». Un monto igual o mayor al pendiente no se acepta como abono. **El cierre del día cuadra** (abono + resto = total). La línea del abono no se puede quitar con los controles de cantidad, y «Liberar mesa vacía» no se ofrece |
| R-14 | **Cobro por unidades.** Una línea de 4 unidades: «Cobrar 1 de 4» deja 3 en la mesa, cobra 1 en una orden cerrada y baja el total. «Cobrar 4 de 4» cobra la línea entera |

**Criterio de cierre de las olas:** la suite y los `--comprobar` en verde; R-0 a R-14 pasadas (y R-15 a R-26 para la ola C, §12.9); D1 y D19 a D24 respondidas; el alta (o la aprobación) hecha por Yonatan; el visto de Yonatan y Camila.

### Fase 3: opcionales, cada uno con su propia decisión

| Opcional | Para qué | Decisión |
|---|---|---|
| Registrar el medio de pago al cerrar | Cuadrar caja por medio | D27 |
| Rol «caja» aparte | Un cajero que no toque catálogo, menú ni personal | D19 (cerrada: por ahora, caja = admin) |
| Guardar en el cierre el tiempo de respuesta del día | Medir el servicio sin conservar las alertas | D28 |
| Pegatinas NTAG 424 DNA con SUN | Cerrar la fuga para ver y avisar | D7 |
| Pasarela con webhook (Wompi o Bold) | Confirmación automática, con comisión | D13 |
| Dividir por ítems desde la pegatina | «Solo lo mío» | — |
| Canales del POS privados (`pos_sync`) y modo «solo privados» | Cerrar R5 | — |

---

## 09 — Decisiones abiertas

Para que las referencias de la fase 1 sigan valiendo, las decisiones de v0.2 conservan su número. Las nuevas empiezan en D19.

**Abiertas, para Yonatan** (D22 y D1 bloquean la salida al aire de las olas; D31 la acota):

| # | Pregunta | Recomendación | Por qué |
|---|---|---|---|
| D22 | ¿Qué correos van en el alta inicial? | Yonatan y Camila como admin, y **todos** los meseros actuales en la misma alta. Los da Camila y los pega Yonatan en el SQL Editor. Nunca van al repo | Quien falte se queda afuera al aplicar `solo_personal` (§02.5). El repo es público. **v0.4:** la compuerta ya se aplicó con **solo Yonatan**; Camila y los meseros se suman con el alta por correo de la ola B o, mejor, con el modelo de aprobación de la ola C (§12.2): piden acceso y Yonatan los aprueba |
| D1 | ¿Cómo sabe el mesero que llegó una transferencia o un pago por QR? | Solo con el abono a la vista: la notificación del banco en un teléfono del local, o preguntándole a Camila (o a sus delegados) antes de facturar. El pantallazo del cliente no basta | Es la única prueba. En una cuenta de persona natural, la notificación le llega solo al titular; en una de persona jurídica, hasta a 6 delegados (blog de Bancolombia, §10) |
| D24 | ¿Quién rota el token de la pegatina? | Solo el admin. El mesero ve y copia el enlace. En la base, un trigger ignora el cambio de token que no venga de un admin | Rotar inutiliza la pegatina hasta reescribirla con la contraseña (D16), que solo tiene Yonatan. **v0.3.1:** A1 no construyó el trigger; hoy solo lo esconde el POS (§02.3, nota 2). Decidir si se agrega a la base |
| D25 | ¿Un interruptor en la base para Pagar? | Sí: la fila `alertas` en `ajustes_cuenta`, que `alertar_cuenta` lee primero. Apagado, responde 503 y la carta dice «Hazle una seña al mesero» | Se apaga en segundos, sin desplegar (Línea Roja: reversible en menos de 1 minuto). Sirve para probar en vivo y para un mal día en servicio. **v0.3.1:** lo construido es la bandera `pagarEnMesa` de `local.js` (§04.6): se apaga con un push. Decidir si se agrega además la tabla |
| D28 | ¿Cuánto viven las alertas? | **v0.4: un día después de resueltas.** Las atendidas y las descartadas con más de un día las borra la base sola; las pendientes no | Guardan el correo de quien atendió (minimización, Ley 1581). **La ola C lo construye como propuesta** (§12.7): sin puerta de borrado para el POS, y `privacy.html` promete «se borra pasado un día» (solo con `pagarEnMesa` encendida). Yonatan decide si deja un día u otro plazo antes de encender Pagar. Si Camila quiere tiempos de respuesta, en fase 3 se guarda el promedio del día antes de borrar. *(En v0.3.1 la recomendación era «el cierre del día borra las resueltas», que dejaba una promesa sin puerta, §04.5.)* |
| D31 | ¿Tope de alertas por orden en la base? | Sí, el de v0.3 (5 por orden, contando las atendidas y las descartadas), dentro de `alertar_cuenta` | S1 y S4 contaban con él. A1 no lo construyó: quedan la pendiente única por mesa y los límites de la función `alerta` (6 por minuto por mesa y 30 por IP, en memoria). Sin tope, un script con el enlace puede crear una alerta pendiente tras otra cada vez que el mesero atiende la anterior |
| D26 | ¿Más métodos, como datáfono? | Por ahora, los tres que pidió Yonatan. Si el local cobra con datáfono, se agrega `'datafono'`: una línea en el `check` y un botón | El mesero llega igual. El método solo le dice con qué ir |
| D27 | ¿Registrar el medio de pago al cerrar, para cuadrar caja? | Sí, pero en fase 3. El modal de Facturar precarga el método de la alerta, lo guarda en `ordenes.medio_pago` y el cierre suma por medio | Toca `formatOrden`, el ticket y el cierre, que son de pos-visual. No cabe en la ola B sin agrandarla |
| D30 | ¿El cliente puede retirar el aviso desde la pegatina? | No. Un segundo toque solo cambia el método; el mesero descarta | Menos estados y menos superficie anónima |
| D11 | ¿Cómo suena el POS con una alerta? | Pitido al llegar y recordatorio cada 2 minutos mientras haya pendientes de más de 2 minutos. «Silenciar 10 min» por tablet. Suena también en segundo plano si el navegador lo deja | Sin sonido, nadie ve las alertas en hora pico (§11, A5). v0.2 lo limitaba al POS visible |
| D5 | ¿Una cuenta en vivo es una «precuenta» prohibida (CU 2.4.3)? ¿Qué documento se entrega? | Consulta legal cuando se pueda. Mientras tanto, «Consumo en vivo · no es factura». Ya no bloquea: Pagar no muestra montos a transferir ni datos | Multas de hasta 2.000 SMMLV y ningún pronunciamiento encontrado. «Mi cuenta» ya está al aire |
| D6 | ¿Es correcto «IVA incluido» (`carta.html:226`)? | Que el contador confirme el régimen; se corrige en otra tarea | Los restaurantes suelen tributar impoconsumo del 8 % (ET 512-1) |
| D7 | ¿Qué se hace con la «fuga aceptada»? | Aceptarla para ver y para avisar. NTAG 424 DNA al reemplazar las pegatinas | Las NTAG215 son estáticas. La cuenta no tiene datos personales, y lo peor que se puede hacer es una alerta falsa |
| D16 | ¿Contraseña de escritura en las NTAG215? | Sí: PWD/PACK con AUTH0 = 04h y PROT = 0, en el gestor de Yonatan. Sin bloqueo permanente | De fábrica, cualquier teléfono las reescribe (SD1). El bloqueo permanente impediría rotar |
| D17 | ¿Pasar `presencia_pos` a un canal privado? | Sí, en 1D, con su policy y la prueba S-10. Con la ola A, la policy exige `mi_rol()` | Hoy publica el nombre del personal en un canal que cualquiera puede escuchar y falsificar (SD9) |

**Cerradas por Yonatan el 2026-09-30 (v0.3.1):**

| # | Pregunta | Decisión |
|---|---|---|
| D19 | ¿«Caja» como rol aparte? | **No: caja = admin.** Decisión cerrada. Si aparece un cajero que no deba tocar catálogo, menú ni personal, se agrega `'caja'` al `check` de `personal.rol` y a las policies de `cierres` |
| D20 | ¿Quién hace el cierre del día? | **Solo el admin.** Escribe `cierres`, el único registro de ventas que queda tras la purga, y borra las órdenes del turno |
| D21 | ¿El mesero crea productos en el catálogo, o solo los agrega a la cuenta? | **El mesero SÍ crea y edita productos** («2 sí puede»). **Borrar sigue siendo del admin.** Corrige la migración de roles (INSERT y UPDATE en `productos` para el mesero), las pruebas y este documento. Riesgo aceptado: un precio mal puesto sale en `carta_publica`, la landing y el MCP (R13) |
| D23 | ¿Google OAuth en Testing o en producción? | **Sí, se saca de Testing, pero SOLO DESPUÉS de que la compuerta de personal (`personal` y la restrictiva `solo_personal`) esté aplicada en producción y verificada.** Antes de eso, publicar abre el POS a cualquier Gmail. Entra al orden de salida como el paso 4 (§08). Lo ejecuta Yonatan. **Refinada el 2026-09-30 (v0.4): solo con la ola C al aire**, cuando quien llega sin permiso queda pendiente y ve el mapa y la carta (§12.2). Paso C-4 de §12.9 |
| D29 | ¿El mesero ve las ventas y el historial de cierres? | **Sí, en solo lectura** («visualizar») |
| — | **Propina** | **Eliminada de todo**, publicado en `83a2f70` (nota del encabezado) |
| — | **Cobro por monto** y **cobro por unidades de una línea** | **Sí**, en la ola B, sobre `tarea/pos-visual` (§03.5.1) |

**Cerradas por Yonatan el 2026-09-30, para la ola C (v0.4):**

| # | Pregunta | Decisión |
|---|---|---|
| D32 | ¿Cómo entra el personal nuevo? | **Con aprobación.** «Haz mejor un panel de admin donde pueda añadir, aprobar o eliminar usuarios del restaurante; si no se aprueba solo podrá ver, no podrá hacer nada más.» Quien entra con Google queda **pendiente**, ve el mapa de mesas y la carta, y un admin lo aprueba o lo elimina. Reemplaza el alta solo por correo como camino normal (§12.2) |
| D33 | ¿Se pueden añadir y editar las pegatinas desde el POS? | **Sí, en un panel de Mesas y pegatinas** para el admin: lista con el enlace y las fechas de escritura y revisión, añadir mesa, editar capacidad, desactivar (las mesas no se borran), rotar el token (solo admin) y escribir la pegatina con Web NFC, con «Copiar enlace» como respaldo para iPhone. **Sin `makeReadOnly`.** La contraseña PWD/PACK (D16) va con NFC Tools (§12.3, `docs/pegatinas.md`) |
| D34 | ¿Se puede deshacer un cobro? | **Sí, «tipo ctrl+z», y sin ventana de tiempo** (Yonatan, 2026-10-01: «el pedido se podrá deshacer cuando quiera el mesero o el admin»): un aviso «Cobrado $ X · Deshacer» de unos 15 s tras cobrar por ítems, unidades, monto o la mesa completa, y «Devolver a la cuenta» o «Deshacer el cobro» en «Transacciones del turno», **en cualquier momento mientras el cobro siga en el turno**. Un parcial o un abono vuelven a la cuenta de la misma mesa; la mesa completa se reabre (mesa libre) o pasa a la cuenta que ya tiene. **Admin y mesero**; editar y eliminar una venta cerrada siguen siendo solo del admin. *(Antes: «admin siempre, mesero dentro de una ventana de tiempo»; Yonatan la quitó.)* (§12.4) |
| D35 | ¿El código del ticket es configurable? | **Sí:** «código de barras parametrizable en el panel de admin porque puede cambiar el dominio». Tabla `ajustes` con `ticket_qr_url` (`https://resplandor.ynt.codes/` por defecto), `ticket_qr_visible` y `ticket_pie`; el QR se dibuja en el navegador (§12.5) |
| D36 | ¿Pulido de interacción? | **Sí:** el aviso «+1 Paloma» al agregar un producto (se acumula) y respuesta visual al tocar (§12.6) |
| D23 | Google fuera de Testing | **Refinada: solo con la ola C al aire** (arriba) |

**Abiertas desde v0.4, para Yonatan:**

| # | Pregunta | Recomendación | Por qué |
|---|---|---|---|
| ~~D37~~ | ~~¿`deshacer_cobro` deja un registro de auditoría?~~ | **Resuelta (Yonatan, 2026-10-01): sí, como trazabilidad y sin limitar al mesero.** Tabla `deshechos` (orden, mesa, tipo, monto, ítems, quién, cuándo), solo la escribe `deshacer_cobro`, solo la lee el admin, 90 días. El cierre del día muestra «Cobros deshechos hoy: N · $ X» con la lista | Cierra S17 (§12.10) |
| D38 | ¿Cuántas solicitudes pendientes caben a la vez? | El contrato propone **50**; basta con la lista del admin | Es el tope anti-abuso de `solicitar_acceso()` (§12.2). Se ajusta con una línea de la migración |

**Cerradas o retiradas desde v0.2:**

| # | Pregunta de v0.2 | En v0.3 |
|---|---|---|
| D2 | ¿Qué datos de pago se publican y dónde va el QR? | **Retirada.** La página no muestra datos de pago; el QR va impreso con el mesero (§04.6). *(Reemplazada el 2026-10-02: la llave y el QR salen de `ajustes`, solo con cuenta abierta; ver el aviso del inicio.)* |
| D3 | ¿El mesero presenta la cuenta, con código, antes de que se vean los datos de pago? | **Retirada.** No hay datos de pago ni código |
| D4 | ¿Base y redondeo de la propina sugerida? | **Retirada.** Sin propina (nota del encabezado) |
| D8 | ¿El cliente ve la variante de cada ítem? | **Cerrada:** no. Se agrupa por nombre y precio (1B) |
| D9 | ¿Se sube la foto del comprobante? | **Retirada.** No hay reportes de pago |
| D10 | ¿Quién redacta la advertencia de propina? | **Retirada.** Sin propina |
| D12 | ¿Hay que esperar a `tarea/pos-visual` para tocar `pos.html`? | **Cerrada como regla de §08:** el marcado (B2) espera el merge; la lógica (1D y luego B1) va antes |
| D13 | ¿QR por mesa o pasarela con webhook? | **Cerrada:** no por ahora. Queda en fase 3 |
| D14 | ¿Reporte del cierre por medio de pago? | **La reemplaza D27** |
| D15 | ¿Lista blanca de correos para las RPC de dinero? | **La reemplaza el modelo acordado:** `public.personal` con rol, como puerta de todo el POS |
| D18 | ¿El interruptor de la fase 2 en la base o en `local.js`? | **La reemplaza D25** (en la base, por las mismas razones) |

---

## 10 — sin_dato

| Tema | Motivo |
|---|---|
| Que anon pueda unirse a un canal **privado** con una policy | La doc dice que solo `authenticated` (realtime/broadcast). No se probó: es S-0 |
| La configuración viva del proyecto nuevo: «Allow public access», policies de `realtime.messages`, particiones y signing keys | `list_projects` no ve esa org. Se toma del encargo |
| Si Google OAuth está hoy en Testing o en producción, y si «Allow new users to sign up» está encendido | No visible desde el repo. Lo decide y lo mira Yonatan (D23) |
| Que `auth.identities` traiga el correo de Google (`identity_data ->> 'email'`) en las sesiones reales de este proyecto, que es de lo que `mi_correo()` saca el rol | A1 lo probó en Docker con identidades simuladas. Lo verifica R-0, y la guarda de la migración lo comprueba contra las cuentas de Google que existen |
| Que la consola de Google Cloud permita volver de «Publicado» a «Testing» | No verificado. La reversa del paso 4 del orden de salida lo supone; si no se pudiera, la protección es la compuerta, que se revierte sola |
| Que `postgres_changes` filtre bien con policies que llaman a una función `security definer` en el Realtime real | La doc dice que respeta la RLS (realtime/postgres-changes). Lo cubren R-1 y R-5 |
| Que lo desplegado de `cuenta` y `votar` coincida con `index.ts`, y su `verify_jwt` | `list_edge_functions` fue denegado. Se toma del encargo |
| Si la plataforma de Edge Functions sobrescribe `x-forwarded-for` o deja pasar el del cliente | No verificado. Por eso los topes que importan están en la base |
| Que la policy de presencia privada funcione con `extension = 'presence'` y `realtime.topic()` | Sale de la doc de Realtime Authorization, sin probar. Lo cubre S-10 |
| Que `SUPABASE_SERVICE_ROLE_KEY` siga inyectada después de fin de 2026 | La doc dice que las llaves legacy funcionan hasta fin de 2026 (realtime/getting_started) |
| La latencia real de la señal y el arranque en frío de `cuenta` y `alerta` en este proyecto | Las cifras de §04.1 son benchmarks de Supabase |
| El volumen real de cuentas por día | §07 son hipótesis |
| Cuántas personas trabajan y con qué cuentas de Google | Lo da Camila (D22) |
| Si las tablets del POS se quedan despiertas y en primer plano durante el servicio, y si permiten audio sin gesto tras recargar | Si no, el WebSocket se suspende, las alertas llegan al despertar y hay que tocar para activar el sonido. Lo mide R-8 |
| Si la cuenta de Camila es de persona natural o jurídica, y quién recibe las notificaciones de abono | De eso depende D1 |
| Si el local cobra con datáfono | De eso depende D26 |
| El régimen tributario de Resplandor y qué documento de venta entrega hoy | Define D5 y D6 |
| Un pronunciamiento de la SIC sobre cuentas en vivo como «precuenta» | No encontrado (D5) |
| Que, sin sugerir propina, no apliquen las obligaciones de la Ley 1935 y de la CU 2.4.1-2.4.2 | Lectura de esta tarea. No se consultó a un abogado |
| Qué URL tienen las pegatinas ya escritas | `tareas/2026-09-06-carta-nfc-y-cuenta.md:128-130` menciona `{TAG-ID}` de NFC Tools; el código usa `?m&k` (`README.md:251`) |
| Si la app de escritura de Yonatan configura PWD/PACK y AUTH0 en NTAG215, y el límite de intentos fallidos de la contraseña | No investigado. El límite está en la hoja de datos (§8.8), sin leer en detalle |
| El precio de las NTAG 424 DNA | No investigado |
| 2FA en GitHub y Supabase | No verificable desde el repo |
| Si existe wifi para clientes en el local | De eso depende cuánto pesa el límite por IP (M3) |
| El NFC en Android | No verificado |
| **Ola C:** que Web NFC (`NDEFReader.write` y `scan`) escriba y lea las NTAG215 de las pegatinas del local, con el HTTPS de `resplandor.ynt.codes` | No se probó con una pegatina real (la ola C se probó en local, sin NFC). Lo cubre R-19 |
| **Ola C:** que Web NFC falle de forma clara al escribir una pegatina con contraseña PWD/PACK, y que `scan` la lea sin contraseña con `PROT = 0` | No se probó. R-19 y `docs/pegatinas.md` §4 (prueba 3) |
| **Ola C:** que NFC Tools ponga **solo la escritura** protegida (`PROT = 0`) y deje la lectura libre, y el nombre exacto de sus menús (**Otros → Establecer / Quitar contraseña**) | No se verificó la app. La guía obliga a probar con un teléfono ajeno antes de dar la pegatina por buena |
| **Ola C:** cómo reacciona Google Cloud al publicar la app (pantalla de consentimiento y la revisión de Google) | Lo ve Yonatan en la consola (D23). Con scopes básicos suele no pedir la revisión larga |
| **Ola C:** cuándo corre exactamente el borrado de las alertas resueltas (al insertar un cierre o al resolver una alerta) | Lo elige C1 y lo documenta en la cabecera de `20261002180000_deshacer_cobro.sql` (§12.7) |
| Si el egress de Edge Functions y Realtime cuenta como «sin caché» | La doc de Supabase no lo dice. §07 usa el cupo de 5 GB, el más conservador |

---

## 11 — Registro

### Registro v0.4: la ola C

| # | Qué | En v0.3.1 | En v0.4 | Por qué |
|---|---|---|---|---|
| P24 | **Cómo entra el personal (D32)** | El admin da de alta por correo a cada persona antes de que entre | **Aprobación:** la persona pide acceso, queda pendiente (solo ve el mapa y la carta), y un admin la aprueba o la elimina (§12.2) | «Haz mejor un panel de admin donde pueda añadir, aprobar o eliminar usuarios» |
| P25 | **Google fuera de Testing (D23)** | Después de la compuerta aplicada y verificada | **Solo con la ola C al aire** | La compuerta sola deja un callejón sin salida; con la aprobación, el pendiente ve el mapa y la carta |
| P26 | **La compuerta** | Diseñada, sin aplicar | **Aplicada** (2026-09-30, de noche), con Yonatan como único admin | Camila y los meseros se suman con la ola B o la C |
| P27 | **Mesas y pegatinas (D33)** | Las mesas se editaban solo con SQL; el POS no creaba ni desactivaba mesas | **Panel de admin:** crear, editar, desactivar, rotar, escribir y revisar la pegatina con Web NFC (§12.3) | «En el panel administrativo debemos poder añadir y editar pegatinas» |
| P28 | **Mesa desactivada en la carta** | Un token rotado decía «vuelve a tocar la pegatina o pide el enlace al mesero» | Un solo texto amable para el token rotado y la mesa desactivada, que manda a un mesero (§12.3) | `cuenta` no distingue las dos causas (a propósito) |
| P29 | **Deshacer un cobro (D34)** | Un abono o un cobro parcial no se podía devolver: «Reabrir» exige una mesa libre | **`deshacer_cobro`:** el aviso de 15 s y «Devolver a la cuenta»; **v0.5: sin ventana de tiempo, también para la mesa completa, con registro en `deshechos`** (§12.4) | «Si pagué una parte de una cuenta y la quiero deshacer… devolver a la mesa»; «el pedido se podrá deshacer cuando quiera el mesero o el admin» |
| P30 | **Ticket (D35)** | QR estático de `pos-pie` | **`ajustes`:** dirección, visibilidad y pie, y el QR dibujado en el navegador (§12.5) | «Puede cambiar el dominio» |
| P31 | **Borrado de alertas (D28)** | El cierre del día las borraba (sin puerta, §04.5) | **La base las borra un día después de resueltas** (§12.7); `privacy.html` lo promete | Cumplir la promesa sin darle al POS un `delete` |
| P32 | **El token de la mesa** | §02.2 decía que solo lo esconde el POS | **Lo impide la base** (`trg_mesas_token_solo_admin`, ronda 2 de la ola B) | Corrección de un texto viejo |

### Registro v0.3.1: las decisiones de Yonatan de la tarde del 2026-09-30

| # | Qué | En v0.3 | En v0.3.1 | Por qué |
|---|---|---|---|---|
| P14 | **Catálogo (D21)** | El mesero solo agrega productos a la cuenta; crear, cambiar precios y eliminar era del admin | **El mesero crea y edita productos; borrar es del admin** | «2 sí puede». Cambia la migración de roles, sus pruebas, §02 y R-3 |
| P15 | **Caja (D19) y cierre del día (D20)** | Recomendados: caja = admin y cierre solo del admin | **Cerradas** | Coincide con el modelo de la ola A |
| P16 | **Ventas y cierres para el mesero (D29)** | Recomendado: sí, en solo lectura | **Cerrada: sí** | «Visualizar» |
| P17 | **Google OAuth (D23)** | Recomendado: salir de Testing, con el registro abierto | **Sí, pero solo después de la compuerta aplicada y verificada** | Sin la compuerta, publicar abre el POS a cualquier Gmail. Entra al orden de salida como el paso 4 |
| P18 | **Cobro por monto** | — | **Abono**: una orden cerrada «Abono · Mesa N» y una línea «Abono recibido» de precio negativo en la orden abierta (§03.5.1) | «Se debe poder pagar un valor introducido por el usuario» |
| P19 | **Cobro por unidades de una línea** | Marcar una línea cobraba todas sus unidades | **«Cobrar [−] n [+] de qty»** (§03.5.1) | «¿Qué pasa si quiero pagar solo una paloma?» |
| P20 | **La carta muestra el abono** | — | Línea con signo menos, otro tono, sin «1×», y «Queda por pagar» (§04.7, B4) | El total debe ser lo que queda |
| P21 | **`menu.html` sin sesión del POS** | Pendiente de B4 | **Hecho** (`persistSession: false`) | Con la compuerta, la votación quedaría sin menús en una tablet con la sesión de alguien fuera de `personal` |
| P22 | **Propina** | Fuera de todo | **Confirmado**, publicado en `83a2f70` | «Eso no se hace acá» |
| P23 | **Lo que A1 construyó distinto** | Bocetos de §04.5 | Tres migraciones con otros nombres y cuatro diferencias de fondo: sin tope de 5 por orden, sin trigger de token, sin puerta para borrar alertas (D28) y sin tabla `ajustes_cuenta` (§04.5) | Quedan abiertas: D24, D25, D28 y D31 |

### Registro v0.3: los pedidos de Yonatan del 2026-09-30

| # | Qué | En v0.2 | En v0.3 | Por qué |
|---|---|---|---|---|
| P1 | **Propina** | Tres opciones sin preselección, sugerida del 10 % redondeada hacia abajo, `ordenes.propina`, línea en el ticket, «Propinas del día» en el cierre, el mesero preguntaba en voz alta, D4, D10 y la Ley 1935 en §06 | **Fuera de todo el documento** | «quita todo lo relacionado a que den propina, eso no se hace acá». La carta ya no la muestra (`83a2f70`) |
| P2 | **Liquidar** | Pedir → presentar con código → ver los datos → «ya pagué» → confirmar y cerrar | **Pagar con método → alerta → el mesero cobra y cierra** (§03.3 a §03.5) | «añade botón pagar con QR, transferencia, efectivo para alertar al mesero». Modelo acordado |
| P3 | **Datos de pago en la página** | Bre-B y Bancolombia en `medios_pago`, con «Copiar», detrás del código | **Retirados.** Cero datos bancarios en la página, el repo y la base | Cero riesgo de phishing por la pegatina (§04.6) |
| P4 | **Código de 4 dígitos** | Lo generaba `presentar_cuenta`; 5 fallos y bloqueo | **Retirado** | No queda nada detrás que proteger |
| P5 | **«Ya pagué» y reportes acumulados** | Hasta 8 por orden, con monto, referencia y vigencia | **Retirados** | El mesero ve el dinero; nadie reporta desde afuera |
| P6 | **QR en la página** | Ya descartado (D2, SD8) | **Sigue fuera.** El QR va impreso con el mesero | Ídem, y por el egress |
| P7 | **Objetos de la base** | `liquidaciones`, `medios_pago`, `liquidacion_cliente`, `cuenta_cliente`, `presentar_cuenta`, `atender_aviso`, `confirmar_y_cerrar`, `anular_liquidacion`, la función `liquidar` | **Retirados.** En su lugar: `alertas`, `alerta_cliente`, la función `alerta` y los triggers de cierre | Modelo acordado |
| P8 | **Lista del personal** | `privado.personal`, sin rol, solo para 4 RPC de dinero (D15) | **`public.personal` con rol**, y puerta de todo el POS con `solo_personal` | «mesero puede editar mesas, añadir productos, cerrar, visualizar; y el admin gestiona todo» |
| P9 | **Interruptor** | `ajustes_cuenta.liquidar` (D18) | La fila `alertas`, si D25 dice que sí | Lo mismo para Pagar |
| P10 | **Cartel del mostrador** con llave, titular y QR como segundo canal | Parte de la defensa de S2 | **Retirado como segundo canal.** Lo reemplaza el texto de la página: nunca muestra datos de pago | Ya no hay nada que comparar |
| P11 | **Atomicidad** | `confirmar_y_cerrar` en una transacción | **Retirada.** La coherencia entre alerta y orden la da `ordenes_cierra_alertas`. R9 sigue | Nada llega de afuera salvo «quieren pagar» |
| P12 | **Lo que sigue valiendo** | — | CORS con lista, rate-limit en memoria con topes en la base, contraseña de escritura (D16), presencia privada (D17), toda la fase 1 (`o`, `no-referrer`, SRI, cubeta, canal mudo) | No dependían de la propina ni de los datos de pago |
| P13 | **Escritorio** | — | Panel lateral a ≥ 1024 px (§03.6) | «mejora también la versión escritorio» |

### Refutación de v0.1 (hecha para v0.2) y su estado en v0.3

Hubo dos refutaciones de la v0.1:

- **SD:** seguridad y dinero, con 12 hallazgos;
- **OU:** operación y UX, con 6 altos (A), 7 medios (M) y 5 bajos (B).

| # | Severidad | Hallazgo | Cómo quedó en v0.2 | En v0.3 |
|---|---|---|---|---|
| SD1 | Crítico | La NTAG215 se reescribe con cualquier teléfono, y un clon muestra la cuenta real con otra llave | PWD/PACK (D16), revisión diaria, cartel del mostrador, CORS con lista y prueba L-11 | **Sigue,** salvo el cartel. La página dice que nunca muestra datos de pago |
| SD2 | Crítico | `confirmar_pago` no exigía vigencia ni monto suficiente, y no cerraba la orden | `confirmar_y_cerrar` atómica | **Retirado:** no hay confirmación remota. Trigger de cierre |
| SD3 | Alto | El total presentado sale de la base, pero el POS cobra su total local | `presentar_cuenta(…, total_visto)` | **Retirado:** no hay total presentado. El mesero cobra el total del POS (S7) |
| SD4 | Alto | `orden_id` no protege de quien tiene el token | Código obligatorio, topes en la base | **Retirado** el código. Siguen el tope por orden y el rate-limit |
| SD5 | Alto (condicional) | «Mesero» es cualquier cuenta de Google | Lista blanca `privado.personal` en 4 RPC (D15) | **Cambia:** `public.personal` con rol y `solo_personal` en todo el POS |
| SD6 | Medio | `liquidacion_cliente` era SECURITY DEFINER en `public` | `security invoker` con `revoke` | **Se aplica a `alerta_cliente`** |
| SD7 | Medio | El modal venía prellenado | El monto arrancaba vacío | **Retirado** |
| SD8 | Medio | El QR de 40 KB viajaba en cada GET | Sin QR en la página | **Sigue** |
| SD9 | Medio | `presencia_pos` es público | Canal privado en 1D (D17) | **Sigue** |
| SD10 | Bajo | Scripts de CDN sin SRI | SRI en Alpine y supabase-js | **Sigue** |
| SD11 | Bajo | No había bandera para la fase 2 | `ajustes_cuenta.liquidar` | **Cambia:** D25 |
| SD12 | Bajo | «Ver la cuenta actual» anulaba la mitigación de `o` | Se quitó el botón | **Sigue** |
| A1 | Alto | Una señal perdida dejaba la cuenta congelada con «En vivo» | Sondeo de seguridad y canal mudo | **Sigue** |
| A2 | Alto | Pago doble si la cuenta cambiaba después de transferir | Reportes acumulados | **Retirado:** no hay reportes |
| A3 | Alto | La cuenta dividida no estaba contemplada | Reportes por teléfono | **Cambia:** el mesero divide con el cobro por partes del POS |
| A4 | Alto | Confirmar y cerrar no era atómico | Igual que SD2 | **Retirado** |
| A5 | Alto | Avisos que nadie ve | Pitido, título, resincronización, L-13 | **Sigue:** pitido, recordatorio, título, resincronización y R-12 |
| A6 | Alto | El «Facturar» de siempre dejaba la liquidación colgada | `facturar()` desviaba a confirmar | **Cambia:** el trigger cierra la alerta al facturar |
| M1 | Medio | Medio y propina viejos después de reabrir | `anular_liquidacion` | **Retirado** |
| M2 | Medio | «Descartar aviso» no existía | `atender` en la máquina | **Cambia:** «Descartar» es un estado de la alerta |
| M3 | Medio | El límite por (IP, mesa) lo comparten los teléfonos del wifi | 120 y 600 por minuto, corte por 404 | **Sigue** |
| M4 | Medio | POS desincronizado y un «hace X s» que prometía de más | `total_visto` y la aclaración | **Sigue** la aclaración; `total_visto` se retira |
| M5 | Medio | La propina frente a la ley | D10 bloqueaba la fase 2 | **Retirado:** sin propina |
| M6 | Medio | Egress por el QR | Sin QR | **Sigue** |
| M7 | Medio | El arreglo de la reversión del token esperaba sin necesidad | Pasó a 1D | **Sigue,** reforzado por el trigger de D24 |
| B1 | Bajo | El QR de respaldo expone el token a todo el salón | El código dejaba fuera de los pagos a quien no está en la mesa | **Cambia:** sin código, ver y avisar quedan en la fuga aceptada (D7) |
| B2 | Bajo | Las variantes se veían como líneas repetidas | `cuenta` agrupa | **Sigue** |
| B3 | Bajo | La meta de 2 s chocaba con el mínimo entre GET | Cubeta | **Sigue** |
| B4 | Bajo | El SDD estaba desactualizado sobre pos-visual | Base commiteada, `merge-tree` limpio | **Sigue:** B2 espera el merge |
| B5 | Bajo | Al reabrir en otra mesa, el aviso salía en la tarjeta equivocada | La mesa salía de la orden | **Cambia:** la alerta guarda `mesa_id`, porque una orden abierta no cambia de mesa (solo `reabrirOrden` lo hace, sobre órdenes cerradas, `pos.html:2702`). La señal a la carta sigue sacando la mesa de la orden |

**Lo que v0.3 deja abierto a propósito:**

- `facturar()` sigue sin esperar su push (`pos.html:2462`). Ya pasa hoy y queda como R9.
- La fuga para **ver y avisar** sigue aceptada (D7).
- Hasta B3, cada teléfono solo sabe de su propio aviso.

**Refutación del código de la fase 1** (`tarea/cuenta-en-mesa` en `d5828f5`, 2026-09-30). Los hallazgos eran de la resincronización de `pos_sync` (1D) y del limitador de `cuenta`:

| # | Severidad | Hallazgo | Cómo quedó | Dónde |
|---|---|---|---|---|
| H1 | Crítico | La cola de deltas se vaciaba dos veces en paralelo (carga inicial, SUBSCRIBED y `online`) y `aplicar_delta_orden` no es idempotente: 4 limonadas en cola quedaban como 7 en la base | **Resuelto:** candado en `flushDeltas` con vuelta extra. Queda abierto, a futuro, la llave de idempotencia por delta en la RPC (cubriría también una respuesta perdida) | §04.8 |
| H2 | Alto | La resincronización reemplazaba `this.ordenes` por la lectura y borraba cobros parciales, facturas y cierres del día hechos sin red; el día se podía cerrar dos veces | **Resuelto:** fusión con `_pendientes` (guardado en `localStorage`), nueva subida de lo pendiente, y `purgar` en el cierre. Se extendió a mesas y productos, que la resincronización también pisaba | §04.8 |
| H3 | Medio | La lectura de reconexión no miraba `version` y pisaba un eco más nuevo | **Resuelto:** una orden local con `version` mayor se conserva. Con la misma versión manda la base (un `upsert` no sube `version`) | §04.8 |
| H4 | Medio | 21 solicitudes con un `k` inventado bloqueaban por IP, y por NAT a todo el local, 10 minutos | **Resuelto:** el bloqueo es por (IP, mesa). Límite aceptado: quien conozca el número de una mesa puede bloquear esa mesa desde esa IP 10 minutos | §04.3 |
| H5 | Bajo | S-5 no detectaba que `realtime.send` fallara en silencio | **Resuelto:** S-5 busca también `ErrorSendingBroadcastMessage` | §08 |

**Pendiente de medir (de esa misma refutación):** el egress de la lectura de reconexión, que trae `ordenes` completa en cada SUBSCRIBED (S-9), y un `statement_timeout` por un lock sobre `realtime.messages`, que `when others` no atrapa. Los dos son teóricos.

### Riesgos residuales

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Una pegatina pegada encima lleva a un clon que pide transferir a otra cuenta | La página real nunca muestra datos y lo dice. Revisión diaria. El restaurante no pierde |
| R2 | El mesero da por pagada una transferencia sin ver el abono | D1 y entrenamiento |
| R3 | Lo legal: la precuenta | D5 |
| R4 | Un trigger rompe escrituras del POS | `exception`, fuera de horario, reversas en menos de 1 minuto, S-3 y R-7 |
| R5 | DoS del Realtime con la llave pública: canales públicos y límites por proyecto | Ya existe hoy. Fase 3: modo «solo privados» |
| R6 | El rate-limit por IP se esquiva si la plataforma confía en el XFF del cliente | Topes en la base |
| R7 | El merge de pos-visual se atrasa y bloquea B2 | B1 avanza aparte. Pagar no sale sin B2 (paso 7) |
| R8 | Volver al 402 por egress | §07: ~2,3 % del cupo, sin QR y con lecturas acotadas. S-9 lo mide |
| R9 | `facturar()` sigue sin esperar su push (`pos.html:2462`) | Ya existe hoy. Fuera de alcance |
| R10 | La llave legacy de service role deja de inyectarse después de 2026 | Revisar antes de diciembre (§10) |
| R11 | Alguien queda afuera al aplicar `solo_personal` | §02.5, la guarda de la migración y el SQL Editor |
| R12 | Alertas que nadie oye: tablet dormida o audio bloqueado | Recordatorio, título, resincronización, operación diaria (§03.9). R-12 lo mide |
| R13 | Un mesero cambia un precio por error (o mala fe) y sale en la carta pública, la landing y el MCP | Riesgo aceptado con D21. El admin lo corrige y es el único que borra. No hay historial de cambios de precio: queda fuera de alcance |
| R14 | Un abono se cuenta dos veces: se quita la línea «Abono recibido» con los controles de cantidad, o se reabre la orden «Abono · Mesa N» | §03.5.1: B1 no deja quitar esa línea, B2 no ofrece «Reabrir» ni «Editar» sobre una orden de abono, y reabrir una orden cerrada es del admin. R-13 lo prueba |
| R15 | Lo que A1 no construyó (tope por orden, trigger del token, borrar alertas, `ajustes_cuenta`) se queda sin dueño | §04.5 lo lista fila por fila. Las decisiones D24, D25, D28 y D31 lo cierran |
| RC1 | ~~Deshacer un cobro no deja rastro (S17)~~ | **Cerrado en v0.5:** `deshechos` (quién, cuándo, mesa, monto) y «Cobros deshechos hoy» en el cierre del día (§12.4). Ya no hay ventana de tiempo: lo que acota al mesero es el registro, no un reloj |
| RC2 | Google fuera de Testing con la ola C: cualquier cuenta de Google crea una fila pendiente (S16) | El tope de pendientes (D38), el contador del admin y que el pendiente solo vea el mapa y la carta |
| RC3 | Lo que la ola C promete y todavía no se probó con hardware: Web NFC y NFC Tools con las pegatinas reales (§10) | R-19 en una mesa real y la prueba de lectura sin contraseña de `docs/pegatinas.md` |

### Fuentes externas principales

**Supabase**, todas bajo `https://supabase.com/docs/guides/`:

- `realtime/broadcast` (`realtime.send`, público y privado, 3 días de retención);
- `realtime/postgres-changes` (respeta la RLS);
- `realtime/concepts`, `realtime/authorization`, `realtime/limits`, `realtime/benchmarks`;
- `realtime/getting_started` (llaves legacy hasta fin de 2026);
- `database/postgres/row-level-security` (policies permisivas y restrictivas);
- `functions/development-tips` (carpeta `_` compartida) y `functions/limits`;
- `platform/manage-your-usage/{realtime-messages, edge-function-invocations, egress}`.

**NXP:**

- NTAG213/215/216 (§8.5.7 AUTH0, §8.8 PWD/PACK y PROT): https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf
- NTAG 424 DNA: https://www.nxp.com/docs/en/data-sheet/NT4H2421Gx.pdf
- AN12196: https://www.nxp.com/docs/en/application-note/AN12196.pdf

**Banco** (solo para D1): blog de Bancolombia sobre notificaciones y delegados, https://blog.bancolombia.com/negocios/preguntas-frecuentes-breb-negocios/

**Normativa:** las fuentes enlazadas en §06. Las de Bre-B que citaba v0.2 dejan de usarse con P3.


---

## 12 — Ola C: aprobación del personal, mesas y pegatinas, ticket y deshacer cobros

**Estado (2026-10-01).** Diseñada y construida en cuatro worktrees (C1 a C4, §12.8) sobre `tarea/ola-b` (`24487b9`); sin push y sin aplicar nada: eso es de Yonatan (Línea Roja). **Los nombres de esta sección son los del contrato de la ola.** Si el código quedó con otro, **manda el código** y esta sección se corrige en la integración. Cada migración es idempotente, lleva su reversa comentada en la cabecera y corre encima de todas las anteriores.

**Qué es y qué no.** Cuatro pedidos de Yonatan de 2026-09-30 y un pulido de interacción. Ninguno mueve dinero: deshacer un cobro **devuelve** a la cuenta lo que ya se había apartado en una orden cerrada, y nada se cobra ni se cierra desde la pegatina (§04.6 sigue igual).

### 12.1 Los pedidos, con sus palabras

| Pedido | Palabras de Yonatan | Dónde |
|---|---|---|
| **Aprobación del personal** | «haz mejor un panel de admin donde pueda añadir, aprobar o eliminar usuarios del restaurante; si no se aprueba solo podrá ver, no podrá hacer nada más» | §12.2 |
| **Mesas y pegatinas** | «en el panel administrativo debemos poder añadir y editar pegatinas» | §12.3 |
| **Deshacer un cobro** | «si pagué una parte de una cuenta y la quiero deshacer, si ese pago fue de esa mesa se debería poder editar y devolver a la mesa, por ende recalcular» (con la captura de «Reabrir cuenta», que obliga a elegir una mesa libre porque la mesa 1 está ocupada). Y, el 2026-10-01: «**el pedido se podrá deshacer cuando quiera el mesero o el admin**» | §12.4 |
| **Ticket configurable** | «código de barras parametrizable en el panel de admin porque puede cambiar el dominio» | §12.5 |
| **Pulido de interacción** | El aviso «+1 Paloma» al agregar un producto, y una respuesta visual y táctil al tocar | §12.6 |
| **Google fuera de Testing** | D23: sí, pero solo cuando la ola C esté al aire (antes: «después de la compuerta») | §12.2 y §08 |

### 12.2 Modelo de aprobación del personal

**Qué cambia.** En la ola B el admin da de alta por correo a cada persona antes de que entre. Desde la ola C el camino normal se invierte: quien entra con Google **pide acceso solo**, y un admin lo **aprueba** o lo **elimina**. Mientras no esté aprobado, solo puede mirar. El alta por correo (`personal_alta`) sigue existiendo y crea a la persona **ya aprobada**; sirve para adelantarse a alguien o para reactivar a una persona eliminada.

**Los tres estados de una persona:**

| Estado | Cómo se llega | Qué ve en el POS | Qué ve en la base | Cómo sale |
|---|---|---|---|---|
| **Pendiente** | `solicitar_acceso()`: la primera vez que entra con Google sin fila | «Tu cuenta espera aprobación», el mapa de mesas en solo lectura y la carta | `mi_rol()` es `null`: `solo_personal` le niega todas las tablas. Solo `vista_pendiente()` y `carta_publica` | Un admin la aprueba (`personal_aprobar`) o la elimina (`personal_eliminar`) |
| **Aprobado** | `personal_aprobar(email, rol)` (rol `mesero` o `admin`), o `personal_alta` | El POS de su rol (§02.2) | `mi_rol()` devuelve su rol | Un admin la elimina, o cambia su rol |
| **Eliminado** | `personal_eliminar(email)` (o `personal_baja`): `activo = false`, la fila no se borra | La misma pantalla de espera, sin datos | `mi_rol()` es `null` | Solo un admin la reactiva (`personal_alta`) |

**La base** (`20261002150000_aprobacion_personal.sql`):

- `personal.estado text not null default 'aprobado' check (estado in ('pendiente','aprobado'))`: las filas que ya existen (la de Yonatan) quedan **aprobadas**. `personal.solicitado_en timestamptz`.
- `solicitar_acceso() returns jsonb` `{estado: 'pendiente' | 'aprobado' | 'eliminado', rol}`. `security definer`, solo para una sesión de **Google** (el mismo criterio de `mi_correo()`: la identidad de `auth.identities`, no el correo de `auth.users`). Crea la fila pendiente (rol `mesero` **provisional**; nombre de `raw_user_meta_data` `full_name` o `name`) si no existe. Si la fila existe y `activo = false` responde `eliminado` **sin resucitarla**. Sin sesión de Google, `null` o un error claro. Tiene un **tope anti-abuso** de pendientes en total (el contrato propone 50; lo fija la migración).
- `mi_rol()` devuelve el rol **solo si** `activo and estado = 'aprobado'`. Con eso, `solo_personal`, la presencia estricta y las alertas **exigen aprobado por construcción**: no se tocó ninguna policy.
- `vista_pendiente() returns table(id int, capacidad int, estado text)`: `security definer`, solo `authenticated` con Google. **Sin token, sin totales, sin órdenes**, y solo de las mesas activas.
- `personal_aprobar(p_email, p_rol)` y `personal_eliminar(p_email)`, solo admin, responden `{ok, codigo}`. **Nunca dejan cero admins aprobados y activos**; un admin no se elimina a sí mismo si es el último (`ultimo_admin`). `personal_alta`, `personal_baja` y `personal_cambiar_rol` siguen igual.
- **Realtime de `personal` para el admin:** la tabla entra en `supabase_realtime` si no estaba, y la RLS solo entrega las filas de los demás a un admin (cada quien sigue viendo la suya). Así el contador de pendientes se actualiza en vivo.

**El POS** (`pos.html`; el store lo escribe C2 y el marcado C3):

```text
entrar con Google
  └─ rpc('solicitar_acceso')           ── si la RPC no existe (PGRST202 / 42883): sigue el flujo de la ola B
        ├─ 'aprobado'  → rpc('mi_rol') → arranca la app (sincroniza, Realtime, presencia)
        ├─ 'pendiente' → estadoAcceso = 'pendiente'  → pantalla de espera
        └─ 'eliminado' → estadoAcceso = 'eliminado'  → la misma pantalla, sin datos
```

- **En espera** (`esperaAprobacion`: pendiente o eliminado): **no** sincroniza, **no** abre Realtime de datos y **no** guarda caché. Carga `mesasPendiente` (`vista_pendiente`) y `cartaPendiente` (la vista `carta_publica`, solo lectura). **Reintenta cada 30 s y al volver a la pestaña**; al pasar a aprobado arranca el flujo normal **sin recargar**.
- **Panel Personal (admin):** `personalPendientes` (`{email, nombre, solicitadoEn}`), `numPendientes` (el contador, en vivo), `aprobarPersonal(email, rol)` y `eliminarPersonal(email)`. Cada pendiente trae «Aprobar como mesero», «Aprobar como admin» y «Eliminar»; cada aprobado, cambiar el rol y eliminar. **La confirmación va dentro de la página**, nunca con `confirm()`. Siguen `personal`, `altaPersonal`, `bajaPersonal`, `cambiarRolPersonal` y `personalError`.
- `puede('aprobar_personal')` es solo del admin.

**Casos de error y bordes:**

| Caso | Qué pasa |
|---|---|
| Sesión sin Google (cuenta de contraseña) | `solicitar_acceso()` no crea nada; el POS muestra «Tu cuenta no está habilitada», como en la ola B |
| La base todavía no tiene `solicitar_acceso` | El POS cae al flujo de la ola B (`mi_rol()`): la ola C se puede publicar antes o después de la migración sin dejar a nadie afuera |
| Se llenó el tope de pendientes | La solicitud nueva se rechaza hasta que un admin elimine o apruebe. El admin ve el contador alto (R-17) |
| Un eliminado vuelve a entrar | `solicitar_acceso()` responde `eliminado` y **no la resucita**; ve la pantalla de espera |
| Un admin aprueba a alguien que está mirando la pantalla de espera | Su POS lo detecta (30 s o al volver a la pestaña) y arranca sin recargar |
| Un admin elimina a alguien con la sesión abierta | Igual que una baja (S14): su siguiente consulta falla, y al revalidar el POS borra la caché y deja de cargar datos; `solicitar_acceso()` ya le contesta `eliminado` |
| Eliminar o degradar al último admin | `ultimo_admin`; el POS deshabilita el botón y lo explica |

**Google fuera de «Testing» (D23, refinada).** Yonatan decidió el 2026-09-30 que Google sale de Testing **solo con la ola C al aire**. Con la compuerta sola, publicar deja a cualquier Gmail abrir el login y ver «sin acceso», un callejón sin salida. Con la aprobación, esa cuenta queda **pendiente** y solo ve el mapa y la carta, y el admin decide en el panel. Por eso el paso de §08 se mueve al final de la ola C. **La ola B y la compuerta no necesitan esto:** mientras Google siga en Testing, solo entra quien Yonatan agregó como usuario de prueba.

**Lo que expone, a propósito, a cualquier cuenta de Google** (una vez publicada): el número, la capacidad y si está libre u ocupada cada mesa activa, y la carta (que ya es pública). Es lo que pidió Yonatan («solo podrá ver») y no incluye cuentas, totales, tokens ni personal. Queda anotado como S16 (§12.10).

**Privacidad.** `solicitar_acceso()` guarda el correo y el nombre de Google de quien pide acceso, y la hora, aunque nunca se apruebe, y solo un admin los ve (Ley 1581). `privacy.html` lo dice (generado por `scripts/descubrimiento.mjs`). Eliminar a alguien conserva su fila (para no resucitarla); borrarla del todo es una petición al restaurante, que Yonatan hace desde el SQL Editor.

### 12.3 Mesas y pegatinas

**La base** (`20261002160000_mesas_y_pegatinas.sql`):

- `mesas.activa boolean not null default true`, `mesas.pegatina_escrita_en timestamptz` y `mesas.pegatina_revisada_en timestamptz`.
- `mesa_crear(p_id int, p_capacidad int) returns jsonb` `{ok, codigo, id}`: el token sale **del default que ya existe** (`ya_existe` si el número ya está).
- `mesa_editar(p_id int, p_capacidad int)`.
- `mesa_activar(p_id int, p_activa boolean)`: **no desactiva una mesa con una orden abierta** (`con_cuenta_abierta`).
- `pegatina_marcar(p_id int, p_tipo text)`, con `p_tipo` `'escrita'` o `'revisada'`: sella la columna con la hora.
- Las cuatro son **solo del admin** y responden `{ok, codigo?}`. La rotación del token sigue como hoy (`rotarTokenMesa` del POS y `trg_mesas_token_solo_admin`).
- **Mesa inactiva = enlace inválido.** La Edge Function `cuenta` responde 404 `enlace_invalido` (lo mismo que con un token malo, para no revelar cuál de las dos cosas es) y `alertar_cuenta` la rechaza. El POS no la muestra en el mapa del salón, pero sí en el panel.
- **No se borran mesas.** Las órdenes apuntan a `mesas` sin cascade; una mesa que ya no existe se desactiva.

**El POS** (vista `'mesas-admin'`; `puede('mesas_admin')`, solo admin):

| Pieza del store | Qué hace |
|---|---|
| `mesasAdmin`, `cargarMesasAdmin()` | La lista de **todas** las mesas: `{id, capacidad, activa, estado, enlace, escritaEn, revisadaEn}` |
| `crearMesa(id, capacidad)`, `editarMesa(id, capacidad)`, `activarMesa(id, activa)` | Llaman a las RPC y releen la lista. `mesasAdminError` guarda el error legible |
| `copiarEnlace(id)` | `navigator.clipboard`, con respaldo: selecciona el texto del enlace para copiarlo a mano |
| `nfcDisponible` | `'NDEFReader' in window` |
| `escribirPegatina(id)` | `new NDEFReader().write({records: [{recordType: 'url', data: enlace}]})`, **con un toque del usuario**. **Nunca `makeReadOnly`** (bloquearía la pegatina para siempre). Al terminar llama `pegatina_marcar(id, 'escrita')` |
| `revisarPegatina(id)` | `scan()`: compara que la URL leída sea **exactamente** el enlace de esa mesa y del dominio del restaurante. Solo si coincide, `pegatina_marcar(id, 'revisada')` |
| `nfcEstado`, `cancelarNfc()` | `{id, fase: 'esperando' \| 'ok' \| 'error', mensaje}` y un `AbortController` |
| El mapa del salón | Lista solo las mesas **activas** |

**Web NFC, lo que sabemos y lo que no.** Web NFC solo existe en **Chrome para Android**, con HTTPS, NFC encendido, pantalla desbloqueada y **un gesto del usuario** (un toque en un botón). No existe en iPhone, Safari ni Firefox: ahí quedan «Copiar enlace» y NFC Tools (`docs/pegatinas.md` §3). Web NFC **no puede usar la contraseña PWD/PACK** (D16): no escribe una pegatina que ya la tiene. Por eso el flujo con contraseña es: quitarla con NFC Tools, escribir, ponerla de nuevo. **La contraseña (D16) no se pone desde Web NFC**; sus pasos, y por qué **nunca** se bloquea una pegatina para siempre, están en [`docs/pegatinas.md`](pegatinas.md) §4. El enlace que escribe el POS sale de `location.origin`: abierto en otro dominio, se escribiría otro enlace; la guía lo advierte y `revisarPegatina` lo detecta.

**La carta con una mesa desactivada** (`carta.html`, parte C4). `cuenta` no distingue una mesa desactivada de un token rotado, y la carta tampoco debe saberlo. El estado `vencido` dice, para las dos causas: «**Este enlace ya no sirve.** Puede que esta mesa ya no esté en servicio o que su pegatina se haya renovado. No pasa nada: pídele a un mesero que te ayude con tu cuenta.» Ya no manda a «volver a tocar la pegatina», que no arregla una mesa fuera de servicio. La hoja deja de leer y suelta el canal (como con el token rotado, §03.8). Prueba: `scripts/pruebas/carta-mesa-desactivada.test.mjs`.

**Casos de error y bordes:**

| Caso | Qué pasa |
|---|---|
| Crear una mesa con un número que ya existe | `ya_existe`; el panel lo dice junto a la fila |
| Desactivar una mesa con una cuenta abierta | `con_cuenta_abierta`; hay que cobrarla o liberarla primero |
| Un cliente toca la pegatina de una mesa desactivada | La carta abre y la hoja de «Ver mi cuenta» dice que el enlace ya no sirve y manda a un mesero; la carta en sí se ve normal |
| Reactivar la mesa | La misma pegatina vuelve a servir: el token no cambió |
| El teléfono no tiene Web NFC | No sale «Escribir pegatina» ni «Revisar pegatina» (`nfcDisponible`); queda «Copiar enlace» |
| Escribir en una pegatina con contraseña | Falla y el POS lo dice; no anota «escrita» |
| `revisarPegatina` lee otra mesa, otro dominio o un token viejo | No coincide: no anota «revisada» y dice por qué |
| El admin cierra la hoja o cancela mientras espera la pegatina | `cancelarNfc()` aborta; `nfcEstado` vuelve a su estado inicial |
| Una mesa se desactiva con un cliente mirando su cuenta | La señal del trigger o el sondeo de 60 s lo lleva a «vencido» (probado) |

### 12.4 Deshacer un cobro

> **v0.5 (2026-10-01).** Yonatan: «el pedido se podrá deshacer cuando quiera el mesero o el admin». La ventana de tiempo del mesero se fue, y con ella todo lo que servía solo para medirla. Lo que acota al mesero ahora es la **trazabilidad** (`deshechos`), no un reloj.

**La base** (`20261002180000_deshacer_cobro.sql`):

- `ordenes.parcial_de text null`: el `id` de la orden **abierta** de la que salió un cobro parcial o un abono. El POS lo escribe **al crear** la orden cerrada, en `facturarParcial` (por ítems o unidades) y en `cobrarMonto` (abono). El disparador `trg_ordenes_guardia` lo **conserva en todo UPDATE de la API** (también para el admin) y lo pone en `null` cuando una orden cerrada se reabre o se edita (cambian su estado, ítems, total o mesa). Así un mesero que cierra una cuenta suya con un `parcial_de` inventado no engaña a `deshacer_cobro` (refutación de la ola C, hallazgos 1 y 2).
- `deshacer_cobro(p_orden_id text) returns jsonb` `{ok, tipo, total_abierta, orden_id, mesa_id, monto, version, reabierta, fusionada}` o `{ok: false, codigo}`, `security definer`. **Admin y mesero, en cualquier momento.**

| Condición | Resultado |
|---|---|
| La persona no tiene rol (pendiente, eliminada o ajena) | `no_autorizado` |
| La orden no existe (por ejemplo, el segundo toque de un parcial o un abono, que se borran al deshacerse) | `no_existe` |
| La orden ya está **abierta** (otra tablet acaba de deshacer ese mismo cobro completo) | `ya_reabierta` («Ese cobro ya se había deshecho») |
| Está vacía | `no_es_parcial` |
| Ya está archivada en un cierre del día (la purga de sus órdenes puede estar en camino) | `ya_en_cierre` |
| Trae `parcial_de` y esa cuenta ya no está **abierta** | `cuenta_ya_cerrada` |
| Trae `parcial_de` y la cuenta es de **otra mesa**, o es un abono que **no cuadra** con la línea de la cuenta | `no_es_parcial` |
| No trae `parcial_de` y es un abono suelto (de antes de esta migración) | `no_es_parcial` (se corrige editándolo sin mesa, admin) |
| No trae `parcial_de` (cobro completo) y la mesa está desactivada | `mesa_inactiva` |
| Todo en orden | `ok`: `tipo` = `parcial`, `abono` o `completo`; `monto` = lo que **de verdad volvió** a la cuenta |

- **Tres tipos, atómico y con candado** (en este orden: los cobros que salieron de la orden, la orden, la mesa y la cuenta abierta: sin interbloqueo; probado con dos sesiones a la vez):
  - **Parcial** (por ítems o unidades): cada ítem vuelve a la cuenta de la misma mesa con su mismo id, nombre, precio y nota (`+qty` si la línea sigue; se crea de nuevo si ya no estaba). Solo líneas de producto: una línea de abono o un precio negativo en un cobro parcial se rechaza.
  - **Abono:** se quita de la cuenta la línea `abono_recibido_<uid>`, **solo si hay exactamente una**, con cantidad 1 y precio igual al opuesto del abono. Si alguien la editó, no se devuelve y no se inventa un monto (refutación, hallazgo 2).
  - **Cobro completo** (sin `parcial_de`): si la mesa está **libre**, la misma orden se **reabre** en ella (`estado = 'abierta'`, `cerrada_en = null`) y la mesa pasa a «ocupada»; si la mesa **ya tiene otra cuenta abierta**, los ítems pasan a **esa** cuenta, la cerrada se borra y los abonos que habían salido de ella pasan a apuntar a la cuenta que los recibe.
  - En los tres: recalcula `total` y `version`, y señala en vivo (el UPDATE de la orden abierta dispara `privado.emitir_cuenta`: **una sola señal**).
- **Idempotente ante el doble toque:** la segunda vez, `no_existe` (parcial y abono) o `ya_reabierta` (cobro completo, que sigue existiendo, ya abierto). Si otra tablet ocupa la mesa libre justo cuando se reabre el cobro completo, el `UPDATE` choca con el índice de una cuenta abierta por mesa (`23505`): la función lo absorbe y los ítems pasan a la cuenta nueva (en la práctica el `INSERT` de la otra tablet toma `FOR KEY SHARE` sobre la mesa por la clave foránea y las dos se turnan; el manejo queda como red de seguridad y se prueba sin la clave foránea). Y toman un **candado de aviso común** con `cerrar_dia` (sin él, deshacer un parcial contra cerrar el día con la cuenta y el parcial se enredaba: `40P01` en 7 de 20 vueltas).
- **Trazabilidad:** la tabla `deshechos` (`id`, `orden_id`, `mesa_id`, `tipo`, `monto`, `items`, `hecho_por`, `hecho_en`, `cierre_id`). **Solo** la escribe `deshacer_cobro` (nadie tiene INSERT, UPDATE ni DELETE por la API), **solo el admin la lee**, `hecho_por` es el correo de la identidad de Google de la sesión y `hecho_en` la hora del servidor. Se guarda **90 días**: un disparador al guardar un cierre del día borra lo más viejo. Es un dato personal: `privacy.html` lo dice. **`cierre_id`** es el cierre del día que incluyó ese cobro deshecho (null = el turno sigue abierto): lo pone `cerrar_dia` en la misma transacción que guarda el cierre.
- **El cierre del día lo decide la base (`cerrar_dia(p_id, p_esperado)`; refutación de la ola C, rondas 2 a 4, y el rehacer de la ronda 5).** Antes el POS guardaba el cierre con la foto que tenía en la tablet y después borraba esas órdenes por `id`. Con varias tablets y «deshacer sin ventana» eso pierde cuentas (un mesero reabre un cobro mientras la tablet del admin lo tiene cerrado; la purga borra la cuenta recién reabierta), deja fuera las ventas que la tablet no vio (ronda 4, hallazgo B) y archiva dos veces la misma venta si una respuesta se pierde (hallazgo Z). Las rondas 2 y 3 lo parcharon comparando la foto de la tablet consigo misma, y cada parche trajo su regresión (A, A2, A4, D). La ronda 5 quitó la causa: **la foto de la tablet ya no cuenta**. `cerrar_dia(p_id text, p_esperado jsonb) returns jsonb` (`security definer`, **solo admin**) hace todo en **una transacción**, con el candado de aviso común con `deshacer_cobro`: toma **todas** las órdenes `cerrada` que no estén en ningún cierre (con candado, en orden, de cualquier día); si queda alguna cuenta `abierta` responde `hay_abiertas` (con las mesas) y no hace nada; compara lo que la base tiene con lo que el POS espera (`p_esperado`: `{n, total, ids}`: cuántas ventas, cuánto y cuáles) y, si difiere, responde `cambio` con su `resumen` (`{n, total, ids, abonos_por_metodo}`) sin guardar ni borrar nada; si cuadra, arma el cierre (cada venta con sus ítems, como las guarda el POS), lo guarda con la hora del servidor, borra las órdenes que archiva (y las cerradas que ya estaban archivadas: rezagos de una purga que no terminó), purga los `deltas_aplicados` sin orden y le pone su id a los `deshechos` del turno. Responde `{ok: true, repetido, n, total, borradas, cierre: {id, fecha, total, n, ordenes}, deshechos: [...]}` o `{ok: false, codigo}`: `no_autorizado`, `invalido` (sin id o sin `p_esperado`: no se cierra a ciegas), `hay_abiertas`, `sin_ventas`, `cambio`. **Nunca borra una cuenta abierta.** Un reintento con el mismo id (se perdió la respuesta) devuelve el cierre que ya se guardó. (El método de pago solo se guarda en las líneas de abono; una venta normal no lo lleva, así que no hay otro «total por método».)
- **Una venta nunca entra en dos cierres (`cierre_ordenes`).** Tabla interna (RLS sin policies y sin GRANT) con `orden_id` como **clave primaria**: un disparador de `cierres` (`trg_cierres_registrar_ordenes`) apunta cada id de `transacciones` a su cierre; un segundo cierre que traiga una venta ya archivada se rechaza (`RS004`), quitarla de un cierre (editarlo, reabrirla) la libera, y los cierres que ya existían se registran al aplicar la migración (si un id estaba en dos, se queda en el más antiguo; editar un cierre viejo no revisa lo que ya traía). El guardia de `ordenes` **rechaza con `RS005`** el INSERT (o upsert) de una venta **cerrada** cuyo id ya está archivado («la cuenta … ya estaba en un cierre del día: revísala con el admin»): la cobrada cuya respuesta se perdió y que otro dispositivo ya cerró no resucita, y tampoco se descarta en silencio (antes devolvía `null`: 0 filas y ningún aviso, y eso se comía también el cobro de una cuenta que existe **abierta** con un id archivado, que quedaba imposible de cobrar con `cerrar_dia` en `hay_abiertas` para siempre, ronda 4, hallazgo 1). `deshacer_cobro` usa el mismo registro para `ya_en_cierre`. **Ronda 6 (refutación de la ronda 5):** (a) el mismo `RS005` rechaza el INSERT de una orden cerrada nueva con `parcial_de` = una cuenta que existe **abierta** y archivada (cobro por partes, por persona o abono; si la cuenta ya no está abierta, el parcial que llega tarde entra); (b) el disparador de `cierres` rechaza con `RS004` un UPDATE que meta una venta **viva** en `ordenes` (una edición atrasada del cierre no resucita una venta reabierta y recobrada).
- **Deltas idempotentes (`aplicar_delta_orden(…, p_delta_id)`, `deltas_aplicados`, `ordenes.deltas_ids`).** El POS le pone un `id` a cada delta al encolarlo y lo reenvía igual en cada reintento (se guarda con la cola). La base lo anota **primero** en `deltas_aplicados` (clave primaria `id`), después bloquea la orden y aplica, todo en una transacción; si el id ya estaba, devuelve la orden tal cual y no aplica nada (también si está cerrada: ya se aplicó). Anotar antes de bloquear es el mismo orden en que llega una fila cerrada con `deltas_ids` (el guardia anota antes de que el upsert alcance la fila que ya existe): al revés se enredaban (40P01; lo encontró la prueba de concurrencia de esta ronda). Una cuenta cobrada sin red sube con los ítems de los deltas que nunca se mandaron: la fila lleva sus ids en `ordenes.deltas_ids` y el guardia los anota en la misma transacción que la fila (la columna queda en null); si la fila se rechaza (`RS003`), no quedan anotados y los deltas se aplican a la cuenta que sigue abierta. Sin id (el POS de la ola B) todo sigue como antes. `deltas_aplicados` se purga con el cierre del día.
- **Un guardia de DELETE** (`trg_ordenes_guardia_borrar`): por la API, una cuenta **abierta con ítems** no se borra (el borrado se salta y los demás de la misma sentencia siguen; es **el único descarte callado que queda, a propósito**: lo provoca un POS viejo que borra por id y no tiene dónde mostrar un error). El único borrado legítimo de una abierta es «liberar una mesa vacía». Así el cierre del día de un POS **viejo sin recargar** (guardar el cierre con su foto y borrar por id) ya no se lleva la cuenta que otro dispositivo reabrió con «Deshacer». **Ronda 6:** por la API tampoco se borra una venta **cerrada que ningún cierre archivó** (no está en `cierre_ordenes`): una lista de purga pendiente en una tablet (`cierre.purgar`) ya no alcanza el segundo cobro de una venta que un admin reabrió con el mismo id; solo se purga lo ya archivado.
- **Cerrar con lo que se vio (refutación, hallazgo 4).** El UPDATE que pasa una orden de abierta a cerrada lleva la `version` que la tablet vio; `trg_ordenes_guardia` lo rechaza con `RS003` si la base tiene otra. Sin esto, una tablet que estuvo sin red cobraba la mesa con ítems viejos y pisaba lo que otra había devuelto con «Deshacer». `version` también sigue a los ítems (cualquier UPDATE que los cambie la sube).
- **Por qué una RPC y no un `delete`.** El mesero no tiene permiso de editar ni borrar órdenes cerradas (§02.3, nota 5): «Editar en el sitio» y «Eliminar» siguen siendo solo del admin. `deshacer_cobro` es **la única puerta**, y lo que hace es devolver, no editar.

**El POS** (`pos.html`):

- `ultimoCobro` (`{ordenId, abiertaId, mesaId, monto, tipo: 'parcial' | 'abono' | 'completo', hasta}`) se llena tras `facturarParcial`, `cobrarMonto` o `facturar` (la mesa completa) y **dura 15 s**: es el aviso «**Cobrado $ X · Deshacer**». `deshacerUltimoCobro()` lo ejecuta.
- `tipoDevolucion(orden)` dice qué haría deshacer: `'abono'`, `'parcial'`, `'reabre'` o `'fusiona'` (o `null`). `puedeDevolver(orden)`: la orden es cerrada, **no está archivada**, hay base y permiso (**sin ventana**), y su tipo no es `null`. `devolverACuenta(ordenId)` lo ofrece en **«Transacciones del turno»** con una confirmación dentro de la página que dice qué vuelve y cómo queda la cuenta: «Devolver a la cuenta de Mesa N», «Deshacer · reabrir la Mesa N» o «Deshacer · pasar a la cuenta de Mesa N». `deshacerError` guarda el error legible.
- Tras deshacer, el POS actualiza lo local, relee la orden abierta (la base manda) y avisa: «**Cobro deshecho · $ X volvió a la cuenta de Mesa N**» o «**… la Mesa N volvió a estar abierta con $ X**». Si el cobro se hizo hace un instante, espera a que sus subidas lleguen antes de pedir que se deshaga.
- **El cierre del día** le enseña al admin «**Cobros deshechos hoy: N · $ X**» (`cargarDeshechos()`, `deshechosHoy`): quién (la parte del correo antes de la arroba), mesa, tipo, monto y hora. «Hoy» es el turno: lo que todavía no cuelga de ningún cierre (`cierre_id` null), así que no depende del reloj de ninguna tablet. Se vuelve a leer al abrir la ventana «Cerrar día»; el aviso «Día cerrado. En este turno se deshicieron N cobros por $ X» y la línea de cada día en el historial (`deshechosDeCierre`) cuentan lo que quedó en ese cierre, también lo que se deshizo mientras el admin miraba la pantalla.
- **El cierre del día en el POS** (`cerrarDia` → `_cerrarDiaPorBase`): **no hay cierre sin red.** El botón «Cerrar día» solo se habilita con conexión (`remoto === 'ok'`) y con la cola vacía (`cambiosSinSubir`: deltas en la cola + filas pendientes + cierres editados sin subir); si no, se apaga y dice por qué (`razonSinCierre`: «Sin conexión…», «Conectando…» o «Hay N cambios sin subir: espera a que suban», con «Reintentar subir»). Con las condiciones, el POS manda a `cerrar_dia` lo que espera (`_esperadoCierre`: cuántas, cuánto y cuáles) con un id de intento que se reutiliza si la respuesta se pierde. `ok`: el cierre que armó la base entra al historial («Respaldado») y las ventas salen de las de hoy. `cambio`: se guardan los números de la base (`cierreResumen`), la ventana de confirmación avisa que cambiaron y los muestra, se vuelve a leer todo y el admin firma otra vez. `hay_abiertas` y `sin_ventas` cierran la ventana con su aviso y releen; `no_autorizado` revalida el rol. No existe un cierre local que haya que deshacer: nada se archiva en la tablet antes de que la base conteste. Las «ventas de hoy» son las del turno abierto (`ordenesPorCerrar`: todas las cerradas que ningún cierre se llevó, no solo las de la fecha de hoy). Si la base aún no tiene `cerrar_dia` (migración sin aplicar), el cierre sigue por el camino de siempre (`_cerrarDiaLocalPrimero`: guardar el cierre y purgar por id, con `purgar`), con las mismas condiciones de red y cola.
- **Un cierre «Sin respaldo» de la versión anterior** (el que dejó en `localStorage` el POS de la ola B, que es el de producción: trae `purgar`, su `sync` nunca llegó a `ok` y no trae `origen`; los que arma esta versión por el camino de siempre, con una base sin `cerrar_dia`, sí lo traen) **ya no se recupera solo** (ronda 5a; se fue `_recuperarCierresViejos`, que en la ronda 4 subía sus ventas, purgaba y descartaba el cierre y trajo tres regresiones). Al cargar la caché (`_separarCierresViejos`) sale de `cierres` y se guarda aparte (`pos_cierres_viejos`; se escribe primero el aparte y luego la lista, y se deduplica por id): nada lo sube con un `upsert`, ni esconde las ventas de hoy (`_fusionarOrdenes`), ni purga la base a partir de él, ni cuenta como «cambio sin subir». Al arrancar, **al admin** se le abre la hoja «**Ventas sin subir de esta tablet**» («Esta tablet guardó N ventas ($ X) del sistema anterior. Faltan en el sistema: N ($ Y)»; `abrirCierresViejos`, una vez por sesión y con red) con la lista de las que **faltan** o están **abiertas** (mesa, día y hora, monto; el resto, resumido en una línea; cada una es `cerrada`, `abierta`, `cierre`, `deshecha` o `falta`), comparada con una lectura propia de la base (`_compararCierreViejo`: `ordenes`, `cierres` y `deshechos`; si falla no concluye nada y apaga «Subir») y dos acciones explícitas: **«Subir N ventas ($ X)»** (`subirFaltantesCierreViejo`: solo las que no están en ninguna orden, cierre ni `deshechos`; vuelve a comparar justo antes y entran como cobros normales marcados para subir, y el cierre local se quita) y **«Descartar copia»** (`descartarCierreViejo`, con un segundo toque, en el pie fijo, que avisa cuántas ventas faltan y cuánto se perdería; solo borra la copia de la tablet). El mesero no ve la hoja (el cierre queda guardado para el próximo admin de esa tablet). Mientras haya uno sin decidir, `razonSinCierre` apaga «Cerrar día» y lo dice, y la vista del cierre ofrece «Revisar». Un cierre editado sin red (no trae `purgar`) conserva su «Reintentar respaldo».
- **Reabrir una venta de un cierre pasado** (`reabrirOrden` → `_reabrirDesdeCierre`): una sola llamada a `reabrir_venta_de_cierre` y nada más desde el POS (ni un upsert de la orden ni la edición del cierre). Sin red (`razonSinReaperturaDeCierre`) el botón «Reabrir en mesa» de «Editar transacción» se apaga y lo explica, y ni el store lo intenta. `mesa_ocupada` pide otra mesa sin cambiar nada; si la respuesta se pierde, el aviso lo dice y, al reintentar, `no_esta_en_cierre` con la cuenta ya abierta en la base la abre. Una cuenta que ya existe abierta con ese id (quedó «archivada y abierta») se reabre en su mesa y la base solo la saca del cierre.
- **Cobrar una cuenta archivada** (`pushASupabase` → `esErrorCuentaArchivada` → `_cuentaArchivada`): la base respondió `RS005`; el POS suelta la subida (no se reintenta), lee qué hay con ese id y avisa «Esta cuenta ya estaba en un cierre del día (Mesa N): no se cobró y sigue abierta. Revísala con el admin» (con «Historial → ese cierre → Editar → Reabrir» para el admin), deja la cuenta abierta y la mesa ocupada; si ya no existe (se archivó y purgó mientras reintentaba), la suelta con «Esta venta ya estaba en un cierre del día… no se vuelve a cobrar». La ventana del cierre del día señala las mesas abiertas que están en un cierre (`abiertasEnCierre`; `cerrar_dia` responde `hay_abiertas` con `en_cierre`).
- **Cobro por partes / abono de una cuenta archivada y abierta** (ronda 6; `esErrorCobroParcialArchivado` → `_cuentaArchivada(id, {parcial})` → `_cobroParcialRechazado`): la base rechazó con `RS005` («… no se puede cobrar por partes») la orden cerrada nueva; `facturarParcial` / `cobrarMonto` ya habían sacado de la cuenta lo cobrado (un delta por línea, o la línea «Abono recibido»). El POS quita ese cobro (y su subida pendiente y su «Deshacer»), **devuelve a la cuenta lo que se había sacado** (deltas con id: si el original ya se aplicó o aún está en cola, el neto es cero), vuelve a la cuenta si el ticket estaba a la vista, avisa «El cobro por partes de la Mesa N NO quedó registrado: esa cuenta ya estaba en un cierre del día… Si ya recibiste el pago, no lo pierdas de vista» y relee la cuenta. En el aviso de la cuenta cobrada completa sin red (`_cuentaArchivada` sin `parcial`) se lee `cobradaSinRed` antes de limpiarla: «El cobro … que hiciste sin conexión NO quedó registrado».
- **Un cierre editado con una copia atrasada** (ronda 6; `_subirCierre`): la base responde `RS004` (la edición mete una venta viva); el cierre queda `error`, se avisa «No se guardó el cambio en el cierre: otra persona reabrió o volvió a cobrar una de sus ventas mientras lo editabas» y se vuelve a leer todo (la base pisa la copia local).
- **Cerrar con la version que se vio:** `facturar` manda la `version` que la tablet conoce (la anota al volver cada delta y espera a los que siguen en vuelo) **solo si la base tiene el guardia** (`_baseConGuardia`: la base de la ola B no lo tiene, y escribiría esa `version` hacia atrás, dejando cuentas abiertas fantasma en las otras tablets); si la base responde `RS003`, el POS deja la cuenta abierta y la mesa ocupada, la vuelve a leer y avisa «**La cuenta cambió, revísala**». **Si el cobro se hizo sin red** (`cobradaSinRed`, o con ítems agregados sin subir), los deltas de esa cuenta **esperan a que su fila cerrada entre** (`_subirLoPendiente`, paso 1b; `_vaciarCola` no los toca): si la base la rechaza, esos deltas se aplican a la cuenta que sigue abierta (se pueden reproducir en cualquier orden) y después se lee, de modo que la tablet muestra la base **más lo que se agregó sin red**, y el aviso dice «**El cobro … que hiciste sin conexión NO quedó registrado**» en vez de «No se cobró nada». Un delta que la base ya había aplicado y cuya respuesta se perdió **ya no se reaplica**: lleva un id (`p_delta_id`) y la base lo reconoce; una fila cerrada que lleva el efecto de deltas que nunca se mandaron manda sus ids en `deltas_ids` (ronda 5). Sin los ids (la base sin la migración) el POS cae al camino de antes. **Cuándo viaja la `version`:** el POS pregunta qué trae la base con una lectura de cero filas (`_sondearBase`: `parcial_de` y `deltas_ids`), así que no depende de tener órdenes cargadas; solo con un sí confirmado manda la `version` (`_baseConGuardia === true`).
- **Sin red, el botón no aparece:** necesita la base. `puede('deshacer_cobro')` es de admin y mesero.

**Un ejemplo.** Mesa 3 con tres productos por $48.000. Se abonan $20.000: queda la orden cerrada «Abono · Mesa 3» por $20.000 y la abierta con la línea «Abono recibido» de −$20.000 y total $28.000. Se deshace: la abierta vuelve a $48.000 sin la línea negativa, la cerrada desaparece, y **las ventas de hoy bajan en $20.000**, así que el cierre del día sigue cuadrando. La carta del cliente vuelve a mostrar $48.000 y deja de decir «Se registró un abono». En `deshechos` queda una fila `abono` por $20.000 con el correo de quien lo hizo.

**Casos de error y bordes:**

| Caso | Qué pasa |
|---|---|
| Doble toque en «Deshacer» | El segundo recibe `no_existe` (parcial o abono) o `ya_reabierta` (cobro completo): «Ese cobro ya se había deshecho»; no devuelve dos veces |
| El admin cierra el día con una foto vieja (otro dispositivo cobró, editó o deshizo una venta) | `cerrar_dia` responde `cambio` con SUS números y no guarda ni borra nada; la ventana de confirmación los muestra («Los números cambiaron…») y el admin firma de nuevo |
| Otro dispositivo reabrió una cuenta (o hay una abierta que esa tablet no veía) | `cerrar_dia` responde `hay_abiertas` con las mesas; la cuenta reabierta sigue abierta y entera |
| Se intenta cerrar el día sin red, o con cambios sin subir | No se puede: el botón está apagado y dice «Sin conexión…» o «Hay N cambios sin subir: espera a que suban» (con «Reintentar subir»); nunca queda un cierre «Sin respaldo» nuevo |
| Una cuenta cobrada sin red con ítems agregados sin red | Al volver la red sube entera, una vez (la fila lleva los ids de esos deltas), y entra en el cierre de después |
| Un cierre «Sin respaldo» viejo en `localStorage` | Al arrancar, al admin se le abre la hoja «Ventas sin subir de esta tablet» (cuántas faltan y cuánto; las que faltan o están abiertas) y elige «Subir N ventas ($ X)» o «Descartar copia»; nada se sube, purga ni descarta solo, y «Cerrar día» espera la decisión |
| Se cobra una cuenta cuyo id ya está archivado en un cierre | La base rechaza (`RS005`, no 0 filas en silencio): el POS avisa «Esta cuenta ya estaba en un cierre… revísala con el admin» y la deja abierta; un admin la saca del cierre con «Reabrir» (la base lo hace en una transacción) y entonces se cobra |
| Se reabre una venta de un cierre pasado sin red | No se puede: «Reabrir en mesa» está apagado y dice «Sin conexión…»; con red es una sola llamada que la saca del cierre y la deja abierta, todo o nada |
| La respuesta de una fila cerrada se pierde y otro mesero toca «Deshacer» | Al reintentar, los deltas ya anotados no se aplican otra vez: la cuenta no se infla |
| Otro admin ya archivó una venta que esta caja vuelve a subir | La base la rechaza con `RS005` (no resucita), la caja la suelta con un aviso y aparece en un solo cierre |
| Una tablet con el POS viejo sin recargar cierra el día con su foto | La cuenta abierta con ítems no se borra (guardia de DELETE); si esa foto trae una venta ya archivada, el cierre se rechaza (`RS004`) y queda «Sin respaldo» sin contar nada de más |
| Se cobró primero un abono y luego otro | Cada abono lleva su propio `uid`: se deshace uno sin tocar el otro |
| La mesa se cobró entera después del abono | `cuenta_ya_cerrada`: se deshace primero el cobro de la mesa (reabre o pasa a otra cuenta) y entonces el abono vuelve a poder devolverse |
| Un mesero lo intenta horas después del cobro | **Pasa**: no hay ventana. Queda en `deshechos` y el admin lo ve |
| Un cobro de otra mesa con un `parcial_de` inventado (por la API) | `no_es_parcial`: exige la misma mesa; y por UPDATE el `parcial_de` no cambia |
| El cobro ya está en un cierre del día | `ya_en_cierre` |
| Se agregó un ítem a la cuenta después del cobro | La cuenta abierta lo conserva; el total se recalcula sobre todo lo que hay |
| Otra tablet sin red cobra la mesa con lo que veía | La base rechaza (`RS003`); el POS avisa «La cuenta cambió, revísala» y no cierra nada |
| El POS está sin red | El botón no aparece: deshacer no se encola, porque necesita la base y no se hace «a medias» |

### 12.5 Ticket configurable

**La base** (`20261002170000_ajustes_ticket.sql`): la tabla `ajustes`, **una sola fila** (`id smallint primary key check (id = 1)`, insertada en la migración):

| Columna | Tipo y regla | Por defecto |
|---|---|---|
| `ticket_qr_url` | `text not null`, `check (ticket_qr_url ~ '^https://[^\s]{3,200}$')` | `https://resplandor.ynt.codes/` |
| `ticket_qr_visible` | `boolean not null` | `true` |
| `ticket_pie` | `text not null`, hasta 120 caracteres | `Gracias por su visita` |
| `actualizado_en`, `actualizado_por` | `timestamptz` y el correo de quien cambió | — |

- **SELECT** para el personal aprobado (`mi_rol() is not null`); **UPDATE** solo para el admin; **sin insert ni delete** para `authenticated`. Con los **GRANT explícitos**: este proyecto no da grants automáticos.
- **El POS** (`pos.html`): `ajustes` (`{ticketQrUrl, ticketQrVisible, ticketPie}`, con los valores por defecto si la tabla no existe), `cargarAjustes()`, `guardarAjustes(cambios)` (solo admin; valida `https://` y hasta 200 caracteres; `ajustesError`, `ajustesGuardados`) y la vista **`'ajustes'`**, con la sección «Ticket». `puede('ajustes')` es solo del admin.
- **El QR se dibuja en el navegador** (`qrTicketSvg`, un getter), con **una librería chica fijada por versión exacta y servida desde `assets/vendor/qrcode-generator-1.4.4.js`** (`qrcode-generator` 1.4.4: es el `qrcode.js` del paquete de npm, byte por byte, y su sha512 es el que cdnjs publica para su `qrcode.js`; antes la ola C la cargaba de cdnjs con SRI y, al pasar el POS a scripts locales, `pos-sin-cdn.test.mjs` no admite ningún host de terceros), y reemplaza el SVG estático que trajo `pos-pie`. **Si la librería no carga, el ticket sale sin QR, nunca roto.** El pie del ticket usa `ajustes.ticketPie`.
- **Por qué configurable:** el dominio puede cambiar. Con la dirección en la base, cambiarlo no pide un commit ni un push.
- **Lo que no hace:** el QR del ticket lleva a la landing y **no muestra datos de pago** (§04.6).

### 12.6 Pulido de interacción

Solo del POS, sin base de datos:

- `agregadoReciente` (`{nombre, qty, ts}`): tras agregar un producto, el aviso «**+1 Paloma**», que **se acumula si tocan varias veces seguidas** («+3 Paloma»). Es lo que el mesero necesita para saber, sin mirar la cuenta, que su toque contó.
- `vibrar(ms)`: `navigator.vibrate` si existe. **Las animaciones respetan `prefers-reduced-motion`.**
- Respuesta visual al tocar los controles que cambian la cuenta (estado `:active`, sin esperar a la red). El detalle visual es de C3 (`docs/pos-visual.md`).

### 12.7 D28: el borrado de las alertas

Una alerta guarda el correo de quien la atendió (`atendida_por`), así que no se conserva para siempre (minimización, Ley 1581). **La ola C lo construye en la base, sin puerta para el POS:** las alertas que **no están pendientes** y tienen **más de un día** se borran solas. La migración `20261002180000_deshacer_cobro.sql` lo hace con un trigger (al insertar en `cierres`, o al resolver una alerta; **C1 elige uno y lo documenta en la cabecera**). Las **pendientes no se borran**.

- Cambia lo que dijo v0.3: ya **no** lo hace `cerrarDia` ni queda sin puerta (§04.5). El POS no hace nada.
- **Integrada (C1 elige tres disparadores de sentencia sobre `purgar_alertas_viejas()`):** al crear una alerta, al resolver una (atender, descartar o cerrar la mesa) y al guardar un cierre del día. Por eso `privacy.html` promete, **solo con `pagarEnMesa` encendida**, lo que de verdad pasa: «un aviso que ya se atendió o se descartó se borra cuando pasa más de un día, la siguiente vez que alguien crea o atiende un aviso o se cierra el día» (hay una prueba en `descubrimiento.test.mjs` que fija la frase). Un día sin ningún aviso ni cierre no borra nada: tampoco hay quien lo lea.
- **D28 sigue abierta para Yonatan** (§09): lo que se construyó es una propuesta (un día). Si Camila quiere medir tiempos de respuesta, en la fase 3 se guarda el promedio del día antes de borrar.

### 12.8 Partición, contrato y qué hace cada parte

Cuatro worktrees en `~/Developer/worktrees/resplandor--ola-c--<parte>` (rama `tarea/ola-c--<parte>`) desde `tarea/ola-c` (`= tarea/ola-b`, `24487b9`). **Contrato** (nombres y firmas de §12.2 a §12.6): lo respetan las cuatro partes. Si un nombre resulta imposible, la parte lo implementa lo más parecido posible, lo dice en su informe y el integrador reconcilia.

| Parte | Archivos (exclusivos) | Alcance |
|---|---|---|
| **C1 base de datos y funciones** | Las cuatro migraciones de §12.2 a §12.7 (`20261002150000` a `20261002180000`, nuevas), `supabase/functions/cuenta` (y `alerta` si hace falta) y sus pruebas, incluido Docker con Postgres 17 | `aprobacion_personal`, `mesas_y_pegatinas`, `ajustes_ticket` y `deshacer_cobro` (con D28). `cuenta` y `alertar_cuenta` rechazan la mesa inactiva. `scripts/empaquetar-funcion.mjs` las sigue juntando |
| **C2 lógica del POS** | `pos.html`, **solo `<script>`**, y sus pruebas | El store de §12.2 a §12.6, con los nombres del contrato. `puede()` gana `mesas_admin`, `ajustes`, `aprobar_personal` y `deshacer_cobro` |
| **C3 pantalla del POS** | `pos.html`, **solo marcado y CSS**, y `docs/pos-visual.md` | La pantalla de espera, el panel Personal con pendientes, las vistas `mesas-admin` y `ajustes`, el aviso «Cobrado · Deshacer», «Devolver a la cuenta» y el aviso «+1» |
| **C4 documentos, carta y guía** (esta) | `docs/pegatinas.md` (nuevo), `README.md` §07, `scripts/descubrimiento.mjs` (genera `privacy.html` y `auth.md`), `privacy.html` y `auth.md` (regenerados), `carta.html` (el texto de «enlace inválido»), este SDD, `tareas/` y `scripts/pruebas/carta-mesa-desactivada.test.mjs` | Lo de §12.3 sobre la carta, la guía de pegatinas, el modelo de aprobación en el README, `privacy.html` (el pendiente y el borrado de alertas) y la bitácora |

**Conflictos conocidos:** C2 y C3 comparten `pos.html` (el `<script>` y el marcado no se tocan entre sí, como en la ola B). C1 y C4 no comparten archivos. Orden de merge: C1, C2, C3 y C4, en cualquier orden entre C1 y C4.

### 12.9 Orden de salida al aire de la ola C y pruebas de humo

Todo con el GO de Yonatan, **después de la ola B** (§08) y fuera del servicio. La ola C es **compatible hacia atrás** con la B: las migraciones dejan a las filas de `personal` aprobadas, y el POS de la ola C cae al flujo de la B si `solicitar_acceso` no existe.

| Paso | Qué | Cómo se verifica | Si sale mal |
|---|---|---|---|
| C-1 | Las **cuatro migraciones**, en orden (`150000`, `160000`, `170000`, `180000`) | `mi_rol()` de Yonatan sigue devolviendo `admin`; las filas de `personal` quedan `aprobado`; `ajustes` tiene su fila | La reversa comentada de la cabecera de cada una, en menos de 1 minuto |
| C-2 | Desplegar `cuenta` (y `alerta` si cambió). **Después** de la migración `160000`: lee `mesas.activa` | `curl` con el enlace de una mesa → 200; `mesa_activar(…, false)` en una mesa de prueba → 404 `enlace_invalido` | Volver a desplegar la `cuenta` anterior |
| C-3 | Push del POS de la ola C (con la carta del enlace inválido y los documentos) | R-15 a R-26 | `git revert` |
| C-4 | **Google fuera de «Testing»** (D23), **solo ahora** | Una cuenta de Google ajena entra, ve «espera aprobación» y el mapa, y **no** ve cuentas ni totales (R-15) | Volver a Testing |

| Prueba | Qué verifica |
|---|---|
| R-15 | **Pendiente.** Una cuenta de Google ajena entra al POS: crea su fila pendiente, ve la pantalla de espera, el mapa y la carta, y con su JWT las tablas del POS, `personal` y `alertas` devuelven 0 filas. `vista_pendiente()` no trae token, total ni orden |
| R-16 | **Aprobar.** El admin ve el contador subir **en vivo**, aprueba como mesero, y el POS de la persona arranca **sin recargar**. «Eliminar» pide confirmación dentro de la página, y la persona eliminada que vuelve a entrar sigue sin acceso |
| R-17 | **Tope y último admin.** Con el tope lleno, la solicitud nueva se rechaza. Eliminar o degradar al único admin da `ultimo_admin` |
| R-18 | **Mesas.** El admin crea la mesa 11, edita su capacidad, la desactiva (sale del salón, no del panel), y su enlace da «enlace inválido» en la carta con el mensaje amable. Desactivar una mesa con cuenta abierta da `con_cuenta_abierta`. Un mesero no ve el panel y la base le rechaza las cuatro RPC |
| R-19 | **Pegatinas.** En un Android con Chrome, «Escribir pegatina» escribe el enlace y anota «escrita»; «Revisar pegatina» con la pegatina correcta anota «revisada» y con una de otra mesa o dominio **no**. Si el enlace de la mesa se gira mientras se escribe, la base responde `enlace_cambio`, la pegatina **no** queda «escrita» y la hoja pide escribirla de nuevo. En un iPhone no aparecen esos botones: «Copiar enlace» funciona y «Ya la escribí» y «Ya la revisé» la anotan. Una pegatina con contraseña no se deja escribir desde el POS, y se lee sin contraseña con un teléfono ajeno (`docs/pegatinas.md` §4) |
| R-20 | **Deshacer.** Un abono de $20.000 en una mesa de $48.000, y «Deshacer» dentro de 15 s: la cuenta vuelve a $48.000, la orden cerrada desaparece, las ventas de hoy bajan en $20.000 y la carta del teléfono lo ve en vivo. **Sin ventana:** el mismo abono, desde «Transacciones del turno», con un mesero horas después (y con un admin): también vuelve. El **cobro completo** de una mesa libre se reabre; el de una mesa con otra cuenta pasa a ella. Cada uno deja su fila en `deshechos` y el admin la ve en el cierre del día |
| R-21 | **Ticket.** El admin cambia la dirección y el pie y el ticket los usa; una dirección sin `https://` no se guarda; el mesero no ve «Ajustes»; sin la librería de QR, el ticket sale sin QR |
| R-22 | **Alertas viejas.** Una alerta atendida de hace más de un día se borra; una pendiente de hace más de un día **no** |
| R-23 | **Cierre del día con una foto vieja.** Con dos tablets: en la A (admin) la mesa 3 está cobrada; en la B un mesero la reabre con «Deshacer» (la A no se entera: sin red o con el eco atrasado). En la A, «Cerrar día»: no cierra, la cuenta de la mesa 3 sigue abierta y entera (con su alerta pendiente si la mesa pidió la cuenta) y el aviso dice «No se cerró el día: hay cuentas abiertas (Mesa 3)…». Después del cobro de la mesa 3 sí cierra, y «Cobros deshechos hoy» (y el aviso de cierre) cuenta el deshacer |
| R-24 | **No hay cierre sin red.** En la tablet del admin, sin red: agregar algo a una mesa, cobrarla y abrir «Cierre del día»: «Cerrar día» está apagado y dice «Sin conexión…». Al volver la red la venta sube sola y el botón se habilita; el cierre incluye esa venta |
| R-25 | **Una venta que la tablet no vio.** Con dos dispositivos: un mesero cobra la mesa 5 y la tablet del admin no recibe el eco. «Cerrar día» → «Sí, cerrar día»: la ventana avisa «Los números cambiaron» y muestra los de la base (con la venta de la mesa 5); «Sí, cerrar así» cierra con las dos ventas |
| R-26 | **El POS de ahora con la base de antes y el POS de antes con la base de ahora.** Con la ola B al aire y el POS nuevo publicado antes de las migraciones: el admin trabaja, cobra y cierra el día por el camino de siempre. Con las migraciones aplicadas y una tablet con el POS viejo sin recargar: cobra y cierra el día; una cuenta que otro reabrió no se borra. Se evita igual recargando todas las tablets el primer día |

**Criterio de cierre de la ola C:** la suite y los tres `--comprobar` en verde; las cuatro migraciones en Postgres 17 con su reversa; R-15 a R-26 pasadas en una mesa real; el visto de Yonatan y de Camila.

### 12.10 Riesgos nuevos

| # | Riesgo | Qué lo acota | Residual |
|---|---|---|---|
| S16 | **Cualquier cuenta de Google crea una fila pendiente** (cuando Google salga de Testing) y ve el mapa de mesas | El tope de pendientes, el contador del admin, `vista_pendiente` sin datos sensibles y la carta, que ya es pública | Un script con muchas cuentas llena el tope y estorba; el admin limpia. Se anota el correo y el nombre de cada una (§12.2, privacidad) |
| S17 | **Deshacer un cobro borra una venta cerrada** (un mesero podría recibir un abono en efectivo y deshacerlo después) | **Ya deja rastro** (v0.5, decisión de Yonatan): `deshechos` guarda quién, cuándo, mesa, monto e ítems, solo el admin la lee y el cierre del día la enseña; no hay ventana de tiempo, así que el registro es lo que acota. Además `parcial_de` no se puede falsificar por la API y deshacer exige la misma mesa | Quien tenga el rol de mesero puede deshacer un cobro propio y la caja queda corta **con rastro**: el admin lo ve en «Cobros deshechos hoy» |
| S18 | **Una pegatina reescrita** desde el panel o desde fuera (ya era S2) | Revisión diaria y `revisarPegatina`, que compara la URL entera; la contraseña (D16); nunca `makeReadOnly` | Una cuenta de admin comprometida puede escribir una pegatina con otro enlace |
| S19 | **Un admin desactiva por error una mesa con clientes** | No se puede con una cuenta abierta (`con_cuenta_abierta`); reactivarla devuelve la pegatina a la vida sin reescribirla | Una mesa libre desactivada sin querer se ve rara en el salón hasta que se reactive |
| S20 | **Un QR de ticket que lleva a donde no debe** (un admin pone otra dirección) | Solo el admin cambia `ticket_qr_url`; la base exige `https://`; quedan `actualizado_por` y `actualizado_en` | Un admin comprometido o equivocado. El QR no muestra datos de pago |
| S21 | **El borrado de alertas se promete** en `privacy.html` | Prueba que fija la frase, y la base lo hace (§12.7): tres disparadores (crear, resolver, cierre del día) | La promesa dice «la siguiente vez que…»: no promete una hora exacta |
