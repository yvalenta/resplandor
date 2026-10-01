# Cuenta en mesa: ver en vivo, avisar cómo se paga y roles del POS

> **Software Design Document · v0.3, para aprobación de Yonatan**

La pegatina NFC de cada mesa muestra la cuenta **en vivo** y **solo para ver**. Desde ahí el cliente toca **Pagar** y elige **cómo**: QR, transferencia o efectivo. Eso **crea una alerta** en el POS. El mesero llega con el QR impreso o los datos de la cuenta, o recibe el efectivo, y **cobra y cierra la mesa en el POS**, como siempre. **La página nunca muestra datos bancarios ni un QR para pagar. Nada se cobra ni se cierra desde la pegatina.** El POS pasa a tener dos roles, **mesero** y **admin**, y la base hace cumplir sus permisos.

| Versión | Estado | Tarea | Rama | Actualizado |
|---|---|---|---|---|
| 0.1 | Borrador. Lo revisaron dos refutadores: seguridad y dinero, operación y UX | `tareas/2026-09-30-cuenta-en-mesa.md` | `tarea/cuenta-en-mesa` | 2026-09-30 |
| 0.2 | Incorporó los 2 críticos, los 9 altos y los medios baratos (§11). La fase 1 se construye desde aquí | ídem | ídem (desde `3bae016`) | 2026-09-30 |
| **0.3** | **Pedidos nuevos de Yonatan: sin propina, Pagar con método → alerta, roles y permisos, carta de escritorio. La fase 2 se reemplaza por las olas A y B (§08). La fase 1 no cambia** | ídem | `tarea/cuenta-en-mesa--sdd-v03` (desde `7028919`) | 2026-09-30 |

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

---

## 01 — Objetivo y alcance

### Objetivo

Hay cinco resultados que se pueden medir:

1. **En vivo** (fase 1, sin cambios). Un ítem que el mesero agrega aparece en el teléfono en **≤ 2 s (p95)** si es un cambio aislado. Si llega en una ráfaga, el último aparece en ≤ 4 s. Hoy puede tardar 10 s, por el sondeo que dejó `be68c6b` (`carta.html:404`, `:525-552`). Si el canal se cae o enmudece, la carta lo detecta, lo dice y pasa a sondeo.
2. **Pagar avisa.** El cliente toca Pagar y elige QR, transferencia o efectivo. En **≤ 2 s (p95)**, todas las tablets del POS muestran la alerta con la mesa y el método, y suenan.
3. **El mesero cobra y cierra.** Atiende la alerta, cobra con el método elegido y cierra la mesa con «Facturar», como hoy. La alerta se cierra sola al cerrar la orden. Ninguna página muestra a dónde pagar.
4. **Roles.** Una cuenta de Google que no está activa en `personal` no lee ni escribe nada del POS. El mesero no puede cambiar el catálogo, el menú semanal, los cierres ni el personal, **ni siquiera llamando a la API a mano**: lo impide la base.
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
| CORS con lista y rate-limit en `cuenta` y en `alerta` | Rotar el token en cada cierre con las NTAG215 de hoy (§03.7) |
| | Exponer `alerta` a agentes (WebMCP, MCP, `llms.txt`) |

---

## 02 — Actores, roles y permisos

### 02.1 Actores

| Actor | Cómo entra | Qué ve | Qué puede hacer | Qué no puede hacer |
|---|---|---|---|---|
| **Cliente en la mesa** (rol `anon`) | Toca la pegatina o escanea el QR de respaldo: `carta.html?m=<mesa>&k=<token>` (`README.md:251`). Usa la llave *publishable*, sin login | La carta. La orden **abierta** de su mesa: ítems agrupados por nombre y precio, total y hora | Tocar Pagar y elegir el método. Eso crea o actualiza la alerta, siempre a través de `alerta` | Ver datos de pago (no existen en la página), editar ítems, cerrar la mesa, ver otras mesas, leer tablas |
| **Quien guardó el enlace o fotografió el QR** («fuga aceptada», `cuenta/index.ts:10-14`) | El mismo enlace, desde fuera del local | Lo mismo que el cliente | Lo mismo, incluido avisar. Lo acotan el tope de 5 alertas por orden, el rate-limit y «Descartar» (§05, S1 y S4) | Lo mismo que el cliente |
| **Mesero** (rol `authenticated` con Google y fila activa con `rol = 'mesero'`) | `pos.html` | Todo el POS (§02.2) | Operar mesas y órdenes, cobrar y cerrar, atender alertas | Tocar catálogo, menú semanal, cierre del día, cierres pasados, sugerencias o personal (§02.2) |
| **Admin** (ídem, con `rol = 'admin'`). Hoy, Yonatan y Camila (D22) | `pos.html` | Todo | Todo lo del mesero, más catálogo, menú semanal, cierre del día, sugerencias y personal | Dejar el sistema sin ningún admin activo (§02.4) |
| **Cuenta de Google sin fila activa** | `pos.html` | La pantalla «Tu cuenta no está habilitada» | Cerrar sesión | Leer o escribir cualquier tabla del POS (`solo_personal`, §02.3) |
| **Camila** (dueña y admin) | El POS, y la app del banco como titular | Las notificaciones de abono del banco | Verificar transferencias (D1), dar de alta al personal, programar el menú, cerrar el día | — |
| **Yonatan** (admin) | POS, dashboard y SQL Editor de Supabase, GitHub, Google Cloud, app de NFC | Todo | El alta inicial, migrar, desplegar y hacer push, la contraseña de las pegatinas, Google Cloud. Todo con su GO. El SQL Editor es la puerta de atrás si nadie puede entrar (§02.5) | — |
| **Edge Function `cuenta`** (service role) | GET público, `verify_jwt` apagado | `mesas` y `ordenes`. Desde B3, también la alerta de la orden | Solo leer | Escribir |
| **Edge Function `alerta`** (service role) | POST público, `verify_jwt` apagado | — | Ejecutar **solo** `public.alerta_cliente(...)` (§04.5) | Tocar ítems, totales o el estado de la orden o la mesa |
| **Atacante con una pegatina encima o reescrita** | Un clon en otro dominio | Lo que lee de la pegatina real: el token | Mostrar la cuenta real **y datos bancarios propios**, algo que la página real nunca hace (§05, S2) | Reescribir la pegatina real si tiene contraseña (D16). Leer las funciones desde un navegador en otro origen (CORS) |

**Regla que no cambia** (`README.md:227-229`): `anon` sigue sin policies ni GRANT sobre las tablas del POS, y tampoco los tiene sobre las nuevas (`personal` y `alertas`). Todo lo que ve o hace el cliente pasa por `cuenta` o `alerta`, que validan el par `(mesas.id, mesas.token)`.

### 02.2 Roles: qué puede hacer cada uno en el POS

Hoy «cualquier cuenta de Google autorizada tiene acceso total» (`README.md:72`; pendiente en `README.md:423`). v0.3 define dos roles. «Caja» es admin por ahora (D19).

| Capacidad en el POS | Mesero | Admin | Dónde engancha hoy |
|---|---|---|---|
| Entrar al POS | Con fila activa | Con fila activa | La puerta de sesión (`pos.html:3096`), más `solo_personal` |
| Ver mesas, órdenes, productos, menús, votos y cierres | Sí | Sí | `sincronizarSupabase` (`pos.html:2016`) y `cargarMenuSemanal` (`:2893`) |
| Abrir mesa, agregar y quitar ítems, «Ítem manual», notas, «Persona N» | Sí | Sí | `agregarProducto` (`:2362`), `agregarItemManual` (`:2429`) y las RPC de deltas |
| Editar la mesa (estado, capacidad) | Sí | Sí | `pushASupabase('mesas')` (`:2130`) |
| Cobrar y cerrar («Facturar»), cobrar por partes, imprimir la pre-cuenta | Sí | Sí | `facturar` (`:2445`), `facturarParcial` (`:2488`), `imprimirPreCuenta` (`:2622`) |
| Liberar una mesa vacía | Sí | Sí | `liberarMesaVacia` (`:2578`) |
| Reabrir una orden del turno | Sí | Sí | `reabrirOrden` (`:2689`) |
| Reabrir, editar o eliminar una orden **de un cierre pasado** | No | Sí | `reabrirOrden` con `transaccionCierre` (`:2689`), `editarOrdenDeCierre` (`:2766`), `eliminarOrdenDeCierre` (`:2797`) |
| Ver y copiar el enlace NFC de la mesa | Sí | Sí | `enlaceMesa` (`:2598`) |
| Rotar el token de la pegatina | No (D24) | Sí | `rotarTokenMesa` (`:2612`) |
| Ver, atender y descartar alertas | Sí | Sí | Nuevo (§03.4) |
| Crear, editar o eliminar productos (catálogo y precios) | No (D21) | Sí | `abrirModalProducto` (`:2844`), `eliminarProducto` (`:2854`) y `guardarProducto` (`:2868`) |
| Programar el menú semanal: crear, editar, activar, borrar, generar la semana | No | Sí | `guardarMenu` (`:2974`), `toggleActivoMenu` (`:2999`), `eliminarMenu` (`:3009`) y `generarSemana` (`:3022`) |
| Leer las sugerencias de platos | No | Sí | `cargarMenuSemanal` (`:2916`) |
| Cierre del día | No (D20) | Sí | `cerrarDia` (`:2804`) |
| Gestionar el personal: alta, baja y rol | No | Sí | Nuevo (§02.4) |

Esconder en la interfaz es una comodidad. La regla real la pone la base (§02.3): un mesero que llame a la API a mano recibe `42501`.

### 02.3 Permisos por tabla y operación

| Tabla u objeto | Operación | `anon` | Mesero | Admin | `service_role` | Nota |
|---|---|---|---|---|---|---|
| `productos` | select | No. Lee la vista `carta_publica` | Sí | Sí | Sí | |
| | insert, update, delete | No | **No** | Sí | Sí | Policy con `mi_rol() = 'admin'` |
| `mesas` | select | No | Sí | Sí | Sí | |
| | insert | No | Sí, por el upsert del POS (nota 1) | Sí | Sí | |
| | update | No | Sí. El token, no (D24, nota 2) | Sí | Sí | |
| | delete | No | No | No | Sí | Sin GRANT, como hoy |
| `ordenes` | select, insert, update, delete | No | Sí | Sí | Sí | El delete sirve para liberar una mesa vacía y para la purga del cierre |
| `cierres` | select | No | Sí (D29) | Sí | Sí | |
| | insert, update | No | **No** | Sí | Sí | Cierre del día y cierres pasados |
| | delete | No | No | No | Sí | Sin GRANT, como hoy |
| `menus` | select | Sí (votación pública) | Sí | Sí | Sí | `menus_select_publico` sigue igual |
| | insert, update, delete | No | **No** | Sí | Sí | |
| `elecciones_menu`, `reacciones_menu` | select | Sí | Sí | Sí | Sí | Sin cambios. Los votos entran por `votar` |
| `sugerencias_plato` | select | No | **No** | Sí | Sí | Entran por `votar` |
| `personal` | select | No | Solo su fila | Sí | Sí | |
| | insert, update, delete | No | No | Sí, sin dejar 0 admins activos | Sí | Trigger `personal_ultimo_admin` |
| `alertas` | select | No | Sí | Sí | Sí | |
| | update, solo la columna `estado` | No | Sí, de `pendiente` a `atendida` o `descartada` | Ídem | Sí | Un trigger sella `atendida_en` y `atendida_por` |
| | insert | No | No | No | Sí, solo por `alerta_cliente` | |
| | delete | No | No | Sí, las no pendientes (D28) | Sí | |
| RPC `aplicar_delta_orden`, `actualizar_nota_item` | execute | No | Sí | Sí | Sí | `security invoker`: les aplica la RLS de `ordenes` |
| RPC `mi_rol()` | execute | No | Sí | Sí | Sí | El POS la llama para saber qué mostrar |
| RPC `alerta_cliente(...)` | execute | No | No | No | Sí | `security invoker`. Solo la llama `alerta` |
| Vista `carta_publica` | select | Sí | Sí | Sí | — | Sin cambios |

1. **`pushASupabase` hace `upsert`** (`pos.html:2138`). En Postgres, `INSERT … ON CONFLICT DO UPDATE` exige el privilegio y la policy de INSERT aunque la fila ya exista. Por eso el mesero necesita INSERT en `mesas` y en `ordenes`. El POS no tiene botón para crear mesas. Si algún día se quiere «crear mesa = admin», primero hay que cambiar ese push a `update`; 1D ya lo toca.
2. **El token de la mesa** no se protege con un GRANT por columna, porque mesero y admin son el mismo rol de Postgres (`authenticated`). Lo protege un trigger `BEFORE UPDATE` que **conserva el token viejo** cuando lo cambia alguien que no es admin, sin romper el upsert (§04.5). Cubre además la caché vieja que hoy deshace las rotaciones (1D).
3. **Restrictiva.** Las 6 tablas que hoy llevan `solo_google` (`20260905000000_resplandor_base.sql:271-280`) pasan a `solo_personal`: `as restrictive … using ((select public.mi_rol()) is not null)`. `personal` y `alertas` ya exigen `mi_rol()` en cada policy. `mi_rol()` exige además el proveedor Google (§04.5).
4. **Realtime** aplica la RLS en `postgres_changes`. Una cuenta sin fila, o dada de baja, deja de recibir cambios de `mesas`, `ordenes`, `productos` y `alertas`.

### 02.4 Gestión del personal (admin)

Hay una vista nueva, «Personal», solo para el admin (parte B2).

- **Lista:** nombre, correo, rol, activo y fecha de alta. Los activos van primero.
- **Alta:** correo de Google (el principal de la cuenta), nombre y rol, con `mesero` por defecto. El POS normaliza el correo (`trim` y minúsculas), y la base lo exige (`check (email = lower(email))`). Si el correo ya existe dado de baja, se ofrece «Reactivar».
- **Baja:** `activo = false`, con confirmación. La fila no se borra: queda el historial y se puede reactivar. **Surte efecto en la siguiente consulta de esa persona**, no cuando vence su sesión, porque `mi_rol()` lee la tabla cada vez. Su POS pasa a «sin acceso» al revalidar el rol (§03.8).
- **Cambiar de rol:** de mesero a admin o al revés, con confirmación.
- **Nunca cero admins.** Un trigger diferido rechaza la baja, el cambio de rol o el borrado que dejaría la tabla sin admins activos (`ultimo_admin`). El POS deshabilita esos botones en el último admin y explica por qué.
- **Lo que el admin no puede hacer solo.** Si Google OAuth sigue en modo Testing, la persona también tiene que estar en «Audience → Test users» de Google Cloud (`README.md:239-241`), y eso lo hace Yonatan. D23 propone salir de Testing para que baste con el alta del admin.
- **Privacidad.** El correo y el nombre del personal son datos personales (Ley 1581). Solo los ve el admin; el mesero ve su propia fila. `personal` no entra en la publicación de Realtime ni en ningún contrato público.

### 02.5 Arranque seguro de los roles

El riesgo: si `solo_personal` entra antes que las filas, **nadie** entra al POS, y puede pasar en pleno servicio. Este es el orden seguro:

1. **Migración `personal_y_alertas`** (ola A, §04.5), después de las 17:00. Crea `personal` vacía, `mi_rol()`, `alertas`, `alerta_cliente` y los triggers. **No toca** `solo_google` ni las policies de hoy, así que nadie nota nada.
2. **Alta inicial, fuera del repo.** Yonatan la pega en el SQL Editor, que corre como `postgres` y se salta la RLS. Va **todo el personal actual**, no solo los admins: quien falte se queda afuera en el paso 4. Esta es la plantilla, sin un solo correo real:
   ```sql
   insert into public.personal (email, nombre, rol) values
     (lower('<correo de Google de Yonatan>'), '<nombre>', 'admin'),
     (lower('<correo de Google de Camila>'),  '<nombre>', 'admin'),
     (lower('<correo de Google de cada mesero>'), '<nombre>', 'mesero')
   on conflict (email) do update set rol = excluded.rol, nombre = excluded.nombre, activo = true;
   ```
3. **Verificar sin salir del SQL Editor**, simulando la sesión de cada admin:
   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims',
     '{"role":"authenticated","email":"<correo>","app_metadata":{"provider":"google"}}', true);
   select public.mi_rol();   -- debe decir admin
   rollback;
   ```
4. **Migración `solo_personal`.** Cambia `solo_google` por `solo_personal` en las 6 tablas del POS. **Se niega a correr** (`raise exception`) si no hay al menos un admin activo. Justo después, un admin abre el POS y ve las mesas, y una cuenta de Google fuera de la lista ve «sin acceso» (R-0). Esto cierra S9 sin esperar la ola B: hoy cualquier cuenta de Google que pase el login lee ventas y tokens.
5. **Los permisos por rol van después, junto con el POS que los entiende** (ola B). Primero se publica el POS de la ola B, que ya le esconde al mesero lo de admin. Después se aplica la migración `permisos_por_rol`. Al revés, el POS de hoy le mostraría al mesero botones que la base rechaza: `guardarProducto` (`pos.html:2868`) o `cerrarDia` (`:2804`) cambiarían el estado local sin que la base lo acepte, hasta la siguiente sincronización.

**Reversas, en menos de 1 minuto:**

- **`solo_personal`:** el bloque comentado en la cabecera de la migración. Borra `solo_personal` y recrea `solo_google` tal como está en `20260905000000_resplandor_base.sql:271-280`.
- **`permisos_por_rol`:** recrea las policies `authenticated full access …`, `menus_admin` y `sug_admin` (`:253-261`) y borra el trigger del token.
- **Si nadie puede entrar** (por ejemplo, por un correo mal escrito): el SQL Editor sigue funcionando porque corre como `postgres`. Se corrige la fila o se aplica la reversa.

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

   Debajo va un texto fijo: **«Esta página nunca muestra datos bancarios ni códigos para pagar.»** Y un «Cancelar», que vuelve a la cuenta sin avisar a nadie.
3. Tocar un método es la confirmación. La carta hace `POST alerta {m, k, metodo}` (§04.4). El botón dice «Avisando…» y queda deshabilitado (`aria-busy`).
4. Con un 200, la hoja pasa al estado **avisado**: «Listo, le avisamos al mesero. Pagarás con **QR**», con la hora («13:42») y «Si en 3 minutos nadie viene, hazle una seña». A los 3 minutos cambia a «¿Nadie vino? Hazle una seña al mesero». Todo se anuncia en `role="status" aria-live="polite"`. Un enlace «Cambiar método» vuelve al paso 2; el toque nuevo **actualiza** la misma alerta.
5. El estado avisado se guarda en `sessionStorage['alerta:'+mesa]`, con el método, la hora y la orden (`orden_id` si `cuenta` lo trae; si no, `abierta_en`). Así sobrevive a una recarga, o a que iOS descarte la pestaña. Se borra cuando la cuenta pasa a `cerrada` o `sin_orden`, o cuando cambia la orden.
6. **Varios teléfonos.** Hasta la parte B3, cada teléfono solo sabe de su propio aviso. Si otro teléfono toca Pagar, actualiza la misma alerta (hay una por mesa) y el POS ve el último método. Con B3, `cuenta` trae la alerta: todos los teléfonos ven «Ya avisamos: QR · 13:42» y, cuando alguien la atiende, «El mesero ya vio el aviso».
7. **Errores** (detalle en §03.8):
   - 409 `sin_cuenta`: «Todavía no hay cuenta abierta», y la carta lee de nuevo;
   - 404: «Este enlace ya no sirve. Vuelve a tocar la pegatina o pide el enlace al mesero»;
   - 429: «Ya le avisamos hace un momento. Si nadie viene, hazle una seña»;
   - 503 `apagado`, red caída o 5xx: «No pudimos avisar desde aquí. Hazle una seña al mesero».
8. Cuando el mesero cierra la mesa, la fase 1 lo refleja: «Mesa cerrada. ¡Gracias!».

**Por qué no hay datos de pago** (§04.6). Una página que nunca muestra a dónde pagar no se puede suplantar cambiando la llave. Y el cliente tiene una regla simple para desconfiar de un clon: si una pantalla de la pegatina le pide transferir a algún lado, no es Resplandor.

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
- Las dos acciones hacen un `update` condicional: `.update({estado}).eq('id', id).eq('estado', 'pendiente').select()`. Si vuelven 0 filas, otra tablet llegó antes: el POS dice «Ya la atendió ‹nombre›» y vuelve a leer.
- **Exigen red.** No usan cola offline y revisan `error`. Un fallo se ve: «Sin conexión: no se marcó».
- `atendida_por` y `atendida_en` los pone la base con un trigger, no el POS. Nadie puede firmar por otro.

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
6. **Cobro por partes** (`pos.html:2488-2525`): la mesa sigue abierta y la alerta también, hasta que la orden se cierre o alguien la atienda.
7. **Sin propina:** el modal, el ticket y el cierre no tienen línea ni campo de propina.

**Por qué ya no hace falta `confirmar_y_cerrar`.** En v0.2, la operación atómica protegía un pago que el cliente reportaba desde afuera. Ahora lo único que llega de afuera es «quieren pagar», y la coherencia entre alerta y orden la da el trigger, dentro de la misma transacción del cierre. Lo que sigue igual: `facturar()` no espera su push (`pos.html:2462`), un riesgo que ya existe hoy (R9).

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
| **Token rotado** mientras mira | «Este enlace ya no sirve. Vuelve a tocar la pegatina o pide el enlace al mesero» | El trigger de `mesas` avisa al tópico viejo. El `GET` da 404 y la carta cierra el canal |
| **Mesa sin orden** | «Todavía no hay cuenta abierta. Cuando el mesero tome su pedido, aparece aquí» | Sigue suscrita: el INSERT de la orden emite y la cuenta aparece sola |
| **Orden cerrada mientras mira** | «Mesa cerrada. ¡Gracias!», sin botón para ver la cuenta actual | `GET ?o=<orden_id>` devuelve `estado:'cerrada'` (§04.3) |
| Pestaña reutilizada por una pegatina nueva | La cuenta actual, no «cerrada» | `o` se recupera de `sessionStorage` solo si la navegación es `reload` o `back_forward`. Un toque nuevo es `navigate` y arranca limpio (§04.7) |
| Cobro parcial en el POS (`pos.html:2488-2525`) | Los ítems cobrados desaparecen | La alerta sigue pendiente |
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
| Un mesero intenta algo de admin por la API | «Solo el admin puede hacer esto» | 42501. El POS avisa y vuelve a sincronizar |
| El último admin intenta darse de baja | «Debe quedar al menos un admin activo» | `ultimo_admin` |
| `menu.html` abierto en una tablet con la sesión de alguien que no está en `personal` | La votación, sin menús | `menu.html` comparte la sesión del POS (`menu.html:485`, `createClient` sin opciones), y `solo_personal` le niega `menus`. Se arregla con `persistSession: false` en `menu.html` (B4) |

### 03.9 Operación diaria

- **Al abrir (12:00):** tocar cada pegatina con un teléfono y **leer el dominio en la barra de direcciones**: `resplandor.ynt.codes`. Mirar la página no basta, porque un clon pinta la misma (§11, SD1). Pasar la uña por el borde para notar una pegatina encima.
- **Tablets del POS:** abrir el POS y tocar una vez para activar el sonido (§03.4). Dejarlas despiertas y enchufadas (§10).
- **Material del mesero,** que prepara Camila: el QR del banco impreso y una tarjeta con los datos de la cuenta. Nunca en la página ni en el repo.
- **Plan B siempre:** efectivo, datáfono y la carta física. La pegatina complementa, no reemplaza (CU 2.4).
- **Personal:** cuando llega alguien nuevo, el admin lo da de alta en «Personal». Si Google sigue en Testing, Yonatan además lo agrega como usuario de prueba (D23). Cuando alguien se va, «Baja».
- **Si una pegatina se pierde o se sospecha de ella:** un admin toca «Enlace NFC → Rotar» en el POS (D24) y Yonatan la reescribe con la contraseña.
- **Al cerrar:** un admin hace el cierre del día (D20), que borra las alertas ya cerradas (D28).

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
- **Migración aparte de 1D, solo si D17 es sí:** `20261001130000_presencia_privada.sql`. Agrega policies `select` e `insert` en `realtime.messages` para `authenticated`, con `extension = 'presence'`, `realtime.topic() = 'presencia_pos'` y proveedor `google`. La reversa es borrar las dos policies y revertir el commit de 1D. Con la ola A, esas policies pueden pasar a exigir `public.mi_rol() is not null` (B1).

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

**Bocetos sin probar.** La parte A1 los cierra y los prueba en Docker. Los nombres de archivo son propuestos; si A1 ya eligió otros, mandan los de A1. Se separan en tres porque cada uno sale al aire en un momento distinto (§02.5 y §08).

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
-- mesas y ordenes conservan «authenticated full access»: el mesero puede todo lo que el GRANT deja.
drop policy "authenticated full access productos" on public.productos;
drop policy "authenticated full access cierres"   on public.cierres;
drop policy menus_admin on public.menus;
drop policy sug_admin   on public.sugerencias_plato;

create policy productos_ver    on public.productos for select to authenticated using (true);
create policy productos_crear  on public.productos for insert to authenticated with check ((select public.mi_rol()) = 'admin');
create policy productos_editar on public.productos for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');
create policy productos_borrar on public.productos for delete to authenticated using ((select public.mi_rol()) = 'admin');

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

| v0.2 | v0.3 | Por qué |
|---|---|---|
| Bre-B y Bancolombia en `medios_pago`, servidos por `liquidar` detrás de un código de 4 dígitos | **No hay datos bancarios en el repo, en la base ni en la página.** El mesero los lleva impresos o los dice | Un clon no puede «cambiar la llave» de una página que no la tiene. El cliente tiene una regla simple: si la pegatina le pide transferir, no es Resplandor |
| Una tabla que solo Yonatan podía cambiar, para que ningún mesero pusiera su llave | Sin tabla: nada que proteger | Desaparecen S2 (c), D2 y el paso manual de cargar los datos |
| Código por cuenta, con 5 fallos y bloqueo | Sin código | Ya no hay nada detrás que proteger. El peor abuso del enlace es una alerta falsa (§05, S1) |
| Cartel del mostrador como segundo canal para comparar la llave | Sin cartel de datos | Ya no hay nada que comparar en la pantalla |
| — | El costo: el mesero va a la mesa | Igual tenía que ir para ver el abono (D1) |

El interruptor de Pagar, si D25 dice que sí, vive en la base (`ajustes_cuenta`), no en `local.js`. Por tres razones: se apaga en segundos con un `update`, sin desplegar Pages; lo lee la función, que es la puerta real; y no arrastra a `descubrimiento.mjs` ni a la prueba que fija las banderas (`scripts/pruebas/funciones.test.mjs:57`).

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
| A2 | El texto fijo «Esta página nunca muestra datos bancarios ni códigos para pagar». **Ningún dato de pago en el HTML ni leído de la URL.** Todo dato del servidor se pinta con `x-text`, nunca con `x-html` | — |
| A2 | Íconos de QR, transferencia y efectivo con `node scripts/iconos.mjs`, y clases nuevas con `node scripts/css.mjs` | El sprite (`carta.html:45+`) y `assets/css/resplandor.css` |
| B3 | Con `cuenta.alerta`, todos los teléfonos muestran «Ya avisamos: ‹método› · hh:mm» y «El mesero ya vio el aviso» | El mismo bloque de Pagar |

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
| **B1** | Guardas de admin en las acciones, además de esconderlas: productos, menú semanal, `cerrarDia`, cierres pasados y `rotarTokenMesa` (D24) | `:2804`, `:2844-2890`, `:2974-3045`, `:2689`, `:2766`, `:2797`, `:2612` | ~20 líneas |
| **B1** | Un rechazo de RLS (`42501`) en `pushASupabase` muestra «Solo el admin puede hacer esto» y llama a `sincronizarSupabase()`, para no quedar con estado local que la base no aceptó | `pushASupabase` (`:2130-2144`) | ~10 líneas |
| **B1** | Colección `alertas`: se carga en `sincronizarSupabase` y se escucha en `pos_sync`. Getters `alertasPendientes` (la más vieja primero, solo si la orden abierta coincide), `alertaDeMesa(mesaId)`, `alertasHoy` y `medianaRespuestaHoy` (admin) | `:2016-2047`, `:2048-2054`, junto a `ordenesAbiertas` (`:2217`) | ~40 líneas |
| **B1** | `atenderAlerta(id, estado)`: `update` condicional con `await`, que revisa `error` y las filas devueltas. Sin cola offline | Junto a `facturar` (`:2445`) | ~20 líneas |
| **B1** | Sonido: WebAudio, desbloqueo en el primer `pointerdown`, recordatorio cada 2 minutos, «Silenciar 10 min» en `localStorage`, `document.title` y `navigator.vibrate` | Store | ~35 líneas |
| **B1** | Personal (admin): `cargarPersonal`, `altaPersona`, `cambiarRol`, `darDeBaja` y `reactivar`. Normaliza el correo y traduce el error `ultimo_admin` | Store | ~40 líneas |
| **B1** | `cerrarDia` borra las alertas no pendientes después de subir el cierre (D28) | `:2804-2843` | ~3 líneas |
| **B1** (si D17) | La policy de `presencia_pos` exige `public.mi_rol() is not null` en lugar de solo el proveedor | Migración de 1D | 2 líneas |
| **B2** | Pantalla «Tu cuenta no está habilitada», con el correo y «Cerrar sesión» | Junto a la puerta (`pos.html:3096`) | ~20 líneas |
| **B2** | Barra: píldora «N por cobrar» (`.nav-pill-aviso`) y pestañas «Alertas» y «Personal» (esta, con `x-show="$store.pos.esAdmin"`) | `:3184-3203` | ~20 líneas |
| **B2** | Vista Alertas, insignia en la tarjeta de la mesa y franja en la orden | `:3211+`, `:3247-3251`, junto a `ordenReabiertaAviso` (`:3415-3419`) | ~80 líneas |
| **B2** | Vista Personal: lista, alta, rol, baja y reactivar, con confirmaciones | Sección nueva | ~70 líneas |
| **B2** | Esconder al mesero: «Nuevo producto», editar y eliminar; «Cerrar día» y las acciones sobre cierres pasados; la edición del menú semanal y las sugerencias; «Rotar» | `:3972+`, `:3658+`, `:3856+` y el bloque del enlace NFC | ~25 líneas |

---

## 05 — Seguridad

**Principio:** nada se cobra ni se cierra desde la pegatina, y la página nunca dice a dónde pagar. Pagar solo avisa; el mesero cobra y cierra. Lo que puede hacer cada persona del POS lo decide la base, no la interfaz.

| # | Amenaza | Vector | Mitigación | Residual |
|---|---|---|---|---|
| S1 | **Alerta falsa o broma** | Toques desde la mesa, o desde fuera con el enlace | Una alerta solo avisa: no cobra ni cierra nada. Una pendiente por mesa, 5 alertas por orden en la base, rate-limit y «Descartar» | Hasta 5 avisos falsos por orden. Molestia, sin pérdida |
| S2 | **Phishing: datos de pago falsos** | (a) Pegatina reescrita o pegada encima, que lleva a un clon que pide transferir a otra cuenta (FTC: https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information). (b) Datos de pago por la URL. (c) Repo o Pages comprometidos. (d) CDN comprometido | **La página real nunca muestra datos de pago, y lo dice al pagar:** un clon que los muestre se delata. Los datos van impresos con el mesero. (a) Contraseña de escritura en las NTAG215 (D16), revisión diaria leyendo el dominio (§03.9) y CORS con lista en las dos funciones. **«Mesa N · resplandor.ynt.codes» dentro de la página no protege: el clon lo copia.** (b) No hay ningún dato de pago que leer. (c) 2FA en GitHub y Supabase (sin dato, §10) y revisar el diff de `carta.html` en cada merge. Una prueba estática de A2 falla si aparece un número de cuenta, una llave o un QR en la carta. (d) SRI en Alpine y supabase-js (§04.7) | Un cliente que no lee el aviso y le paga a un clon. El restaurante no pierde, porque solo da por pagado lo que ve en su banco |
| S3 | **Fuga o reuso del token** | Un enlace guardado, el QR fotografiado o el token en el Referer | Fuga aceptada para ver y para avisar, sin datos de pago ni personales (S8). `o` evita que una pestaña vieja vea la orden siguiente. `no-referrer`. Rotación por un admin (D24) con `update` dedicado y error visible (1D). El token sale en los logs de las funciones, que solo ve Yonatan. Opciones B y C de §03.7 | Un tercero con el enlace ve la cuenta abierta de la mesa y puede avisar (S1) |
| S4 | **Spam de alertas e inundación de `alerta`** | Repetir toques, o un script contra la función | 6 por minuto por (IP, mesa) y 30 por minuto por IP. Tope de 5 por orden en la base. Los toques repetidos actualizan la misma pendiente. El POS solo suena con una alerta nueva o un cambio de método | Las invocaciones se cobran aunque respondan 429 (§07) |
| S5 | **Escalada de rol** | Un mesero que se pone `admin`, edita precios o el menú por la API, o firma como otro | `personal` solo la escribe un admin (RLS). Los permisos por rol están en la base (§02.3). `atendida_por` lo pone un trigger. `mi_rol()` es `security definer` con `search_path` vacío y sin parámetros | Un admin comprometido. Ya es un riesgo del POS hoy |
| S6 | **Canal Realtime expuesto** | Escuchar el tópico, publicar señales falsas o saturar los límites del proyecto | El tópico es `sha256(token)` y el payload va vacío. Cada teléfono lee como mucho ~7 veces por minuto ante una inundación (cubeta, §03.2.5). Las alertas llegan al POS por `postgres_changes` con RLS, no por un canal público. Los límites por proyecto (100 mensajes/s, 200 conexiones; realtime/limits) se comparten con el POS: **ese riesgo ya existe hoy** (R5). S-0 permitiría pasar a d1 | DoS del Realtime del proyecto, como hoy. Egress acotado (§07) |
| S7 | **Integridad del monto** | El cliente cambia el total, o el mesero cobra un total viejo | No hay ruta de escritura a ítems ni total desde la pegatina. El mesero cobra el total del POS, que es el de la base después de vaciar la cola | Un cobro con el total local atrasado si la tablet tenía la cola llena. Ya pasa hoy |
| S8 | **Privacidad** (Ley 1581) | Datos del personal; el nombre en la presencia | La cuenta no lleva nombres, teléfonos ni documentos. `personal` (correo y nombre) solo la lee el admin. `alertas.atendida_por` guarda el correo de alguien del personal y se borra al cerrar el día (D28). `presencia_pos` publica `nombre: nombreUsuario` en un canal público (`pos.html:2119-2124`) y pasa a privado con D17. Actualizar `privacy.html` y `auth.md` (B4), que hoy dicen «Sin pagos» y que el sitio no cobra (`auth.md:22-24`, `privacy.html:60`) | Bajo |
| S9 | **Cualquier cuenta de Google como «mesero»** | Registro abierto o Google fuera de Testing (`README.md:239-241`). `solo_google` solo mira el proveedor (`20260905000000_resplandor_base.sql:265-281`) | **Lo resuelve `solo_personal`:** sin fila activa no hay acceso (§02.3). `mi_rol()` exige Google, así que una cuenta con contraseña y el correo de un admin, sin verificar, no hereda su rol. Proveedor Email apagado (D23) | Una cuenta de Google del personal que se compromete |
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
3. La página nunca muestra a dónde pagar: ni cuenta, ni llave, ni QR.
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
| Filas en la base | ≤ ~1.100 alertas al mes, borradas al cerrar el día (D28). `personal`, menos de 20. `realtime.messages` retiene ~900 filas (3 días) | — | Despreciable |

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
| Google OAuth en Testing o en producción, y proveedor Email apagado (D23) | Yonatan | El alta de meseros desde el POS |
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
| **A1 `roles-alertas-bd`** | `tarea/roles-alertas-bd`, desde `7028919`, en `resplandor--roles-alertas-bd` | Las tres migraciones de §04.5 (nuevas); `supabase/functions/alerta/index.ts` y `supabase/functions/_compartido/alerta.js` (nuevas); las pruebas `scripts/pruebas/migracion-roles-alertas.test.mjs` (estática), `bd-roles-alertas.test.mjs` (Docker) y `fn-alerta.test.mjs` (nuevas). Nombres propuestos: si la parte ya eligió otros, mandan los suyos | §04.4 y §04.5. Pruebas en Docker, por rol: anon no lee nada; una cuenta de Google sin fila no lee nada; el mesero lee todo y no escribe catálogo, menú, cierres ni personal; el admin, todo; `ultimo_admin`; el token se le ignora al mesero; `alerta_cliente` con par malo, sin orden, upsert de la pendiente, tope y carrera con el cierre; trigger de cierre (`atendida`) y de borrado (`descartada`); `atendida_por` sellado; `solo_personal` se niega sin admin; cero correos reales en el repo, solo marcadores `<…>` | La fase 1, solo para el trigger `alertas_emite_cuenta`, que se crea si existe `privado.emitir_cuenta` |
| **A2 `carta-escritorio-pagar`** | `tarea/carta-escritorio-pagar`, desde `83a2f70` (`carta.html` sin propina), en `resplandor--carta-escritorio-pagar` | `carta.html`, `assets/css/resplandor.css` (regenerada), el sprite de íconos, `scripts/pruebas/carta-escritorio.test.mjs` y `scripts/pruebas/carta-pagar.test.mjs` (nuevas) | §03.3, §03.6 y las filas A2 de §04.7. Pruebas en Playwright con `alerta` y `cuenta` simuladas: a 1024 y 1440 px, el panel lateral, sin desborde; sin `m&k` no hay panel; a 320 px, igual que hoy; ningún método preseleccionado; 200 → avisado; 409, 404, 429, 503 y red caída, cada uno con su texto; `sessionStorage` sobrevive a una recarga; ningún dato bancario ni QR en el HTML; foco y teclado. **Dos commits separados, escritorio y Pagar**, para poder sacar el escritorio antes | El contrato de A1 (§04.4), simulado |

- **Conflictos:** A2 y 1C tocan `carta.html` y `resplandor.css`. La que se integre segunda se rebasa sobre la primera. `resplandor.css` se regenera con `node scripts/css.mjs`; no se resuelve a mano. A1 y 1A no comparten archivos, y A1 crea `privado` con `if not exists`.
- **Orden de merge:** después de la fase 1, A1 y luego A2 (A2 solo necesita el contrato de A1).

### Ola B (espera): el POS con alertas, personal y roles

- **Objetivo:** el POS oye las alertas, el admin gestiona el personal y el mesero deja de ver lo que no le toca.
- **La bloquean:**
  - el **merge de `tarea/pos-visual` a `main`**, para B2 (marcado);
  - **la fase 1 integrada en `pos.html`** (1D), para B1: las dos tocan `pushASupabase`, `pos_sync` y `rotarTokenMesa`;
  - B3 espera además a 1B, 1C, A1 y A2.

| Parte | Archivos (exclusivos) | Alcance | Depende de |
|---|---|---|---|
| **B1 `pos-roles-alertas-logica`** | `pos.html`, **solo `<script>`**, y `scripts/pruebas/pos-roles-alertas.test.mjs` (nueva, estática y en vm sobre el store extraído) | Filas B1 de §04.8. Pruebas: sin rol, la caché se borra y no sincroniza; guardas de admin; un 42501 avisa y resincroniza; una alerta nueva dispara el pitido (simulado), el título y la píldora; atender condicional; recordatorio a los 2 minutos; personal con `ultimo_admin` | 1D integrada y el contrato de A1 |
| **B2 `pos-roles-alertas-marcado`** | `pos.html`, **solo marcado**, y `scripts/pruebas/pos-roles-alertas-vistas.test.mjs` (nueva, sobre `scripts/pruebas/_pos-simulado.mjs`, que llega con pos-visual en `4da9030`) | Filas B2 de §04.8, con las clases de pos-visual. Pruebas: el mesero no ve los controles de admin; el admin ve Personal; una alerta en dos tablets simuladas; 320 px | El merge de pos-visual a `main` y el rebase de `tarea/cuenta-en-mesa`. B1 integrada |
| **B3 `cuenta-alerta`** | `supabase/functions/cuenta/index.ts`, `supabase/functions/_compartido/mesa.js` y `alerta.js`, `carta.html` y sus pruebas | `cuenta` devuelve `alerta`, y la `marca` la incluye. La carta muestra el aviso en todos los teléfonos. Une el código compartido de `cuenta` y `alerta` | 1B, 1C, A1 y A2 integradas |
| **B4 `docs-y-confianza`** | `README.md` (§02, «fuera de alcance» en `:72`; §06, entidades; §07, acceso; la lista de `:423`), `scripts/descubrimiento.mjs` (genera `privacy.html` y `auth.md`), `privacy.html` y `auth.md` (regenerados), `assets/js/local.js` (solo el comentario de `:172-175`), `menu.html` (`persistSession: false` en `:485`) y `scripts/pruebas/descubrimiento.test.mjs` si cambia lo esperado | `privacy.html`: «Mi cuenta», el token en la URL, qué guarda una alerta y qué se guarda del personal. `auth.md`: el sitio no muestra a dónde pagar ni cobra; Pagar solo avisa; ningún agente puede disparar alertas. El README documenta roles, tablas, funciones y el arranque | — |

**Orden de merge en `tarea/cuenta-en-mesa`:** fase 1 → A1 → A2 → B1 → B2 → B3. B4, en cualquier momento.

### Orden de salida al aire

Todo con el GO de Yonatan. Las migraciones, después de las 17:00.

| Paso | Qué | Quién | Cómo se verifica | Si sale mal |
|---|---|---|---|---|
| 1 | Fase 1: migración de 1A → desplegar `cuenta` (1B) → push de 1C y 1D | Yonatan | S-1 a S-9 | Reversa de 1A; la carta cae a sondeo |
| 2 | Migración `personal_y_alertas` | Yonatan | Las tablas existen, `personal` está vacía y nada cambia en el POS | La reversa de su cabecera |
| 3 | Alta inicial de todo el personal (§02.5), fuera del repo | Yonatan, con los correos que da Camila | `mi_rol()` simulado devuelve `admin` para cada admin | Corregir las filas |
| 4 | Migración `solo_personal` | Yonatan | R-0 | Reversa en menos de 1 minuto |
| 5 | Push del escritorio de A2, sin Pagar | Yonatan | R-9 | `git revert` |
| 6 | Desplegar `alerta` (`--no-verify-jwt`), con el interruptor apagado si D25 | Yonatan | `curl` sin cuenta abierta → 409; con un origen ajeno → 403 | Borrar la función |
| 7 | Push del POS de la ola B (B1 y B2), de Pagar (A2) y de B4 | Yonatan | R-3 y R-5 a R-10 | `git revert` |
| 8 | Migración `permisos_por_rol` | Yonatan | R-1 a R-4 | Reversa en menos de 1 minuto |
| 9 | Encender el interruptor, si D25 | Yonatan, con el visto de Camila | R-11 y R-12 en un servicio real | Apagarlo |
| 10 | B3 (`cuenta` con la alerta), cuando esté lista | Yonatan | S-2, ahora con la alerta | Volver a desplegar la `cuenta` anterior |

Por qué este orden:

- Pagar (paso 7) nunca sale antes que el POS que lo oye. Si no, los clientes avisarían a nadie.
- Los permisos por rol (paso 8) nunca salen antes que el POS que los respeta (§02.5).
- `solo_personal` (paso 4) nunca sale antes del alta (paso 3), y la migración se niega si no hay un admin.
- La puerta (paso 4) sale lo antes posible, porque cierra S9 sin esperar a la ola B.

**Pruebas de humo de las olas** (con el GO de Yonatan, en una mesa real):

| Prueba | Qué verifica |
|---|---|
| R-0 | **Puerta.** Una cuenta de Google fuera de `personal` ve «sin acceso», y con su JWT las 6 tablas devuelven 0 filas. Un admin ve las mesas |
| R-1 | **Baja inmediata.** Un admin da de baja a un mesero con la sesión abierta: su siguiente escritura falla, su POS pasa a «sin acceso» al revalidar y deja de recibir cambios por Realtime |
| R-2 | **Último admin.** Dar de baja o degradar al único admin activo devuelve `ultimo_admin` |
| R-3 | **Mesero.** No ve los controles de admin. Un `upsert` directo a `productos`, `menus` o `cierres` con su JWT devuelve 42501. Sí puede abrir mesa, agregar, «Ítem manual», facturar, cobrar por partes, liberar una mesa vacía y reabrir una orden del turno |
| R-4 | **Token.** Un mesero, o una tablet con caché vieja, que manda otro token no lo cambia (si D24) |
| R-5 | **Alerta.** `POST alerta` con orden abierta → 200, y dos tablets suenan y muestran la píldora en ≤ 2 s. Un segundo toque con otro método actualiza la misma alerta (1 fila pendiente). Sin orden → 409; token malo → 404; método raro → 400; origen ajeno → 403; ráfaga → 429; sexta alerta de la orden → 429 `tope` |
| R-6 | Atender en la tablet A la quita de la B. Atender a la vez en A y B: una gana y la otra ve «Ya la atendió…» |
| R-7 | Facturar con una alerta pendiente la deja `atendida` con el correo de quien cerró. Liberar una mesa vacía la deja `descartada` |
| R-8 | **Sonido.** Suena tras el primer toque; «Silenciar 10 min» funciona; el recordatorio llega a los 2 minutos |
| R-9 | **Escritorio.** A 1024 y 1440 px, el panel lateral con la cuenta, sin desborde. A 320 px, igual que hoy |
| R-10 | **Ningún dato de pago.** La página publicada no tiene números de cuenta, llaves ni imágenes de QR |
| R-11 | Interruptor (si D25): apagado → 503, y la carta dice «Hazle una seña al mesero» |
| R-12 | En un servicio real, el tiempo entre la alerta y «Atender» o «Facturar». Si la mediana pasa de 3 minutos, se revisan el sonido y la operación |

**Criterio de cierre de las olas:** la suite y los `--comprobar` en verde; R-0 a R-12 pasadas; D1 y D19 a D24 respondidas; el alta hecha por Yonatan; el visto de Yonatan y Camila.

### Fase 3: opcionales, cada uno con su propia decisión

| Opcional | Para qué | Decisión |
|---|---|---|
| Registrar el medio de pago al cerrar | Cuadrar caja por medio | D27 |
| Rol «caja» aparte | Un cajero que no toque catálogo, menú ni personal | D19 |
| Guardar en el cierre el tiempo de respuesta del día | Medir el servicio sin conservar las alertas | D28 |
| Pegatinas NTAG 424 DNA con SUN | Cerrar la fuga para ver y avisar | D7 |
| Pasarela con webhook (Wompi o Bold) | Confirmación automática, con comisión | D13 |
| Dividir por ítems desde la pegatina | «Solo lo mío» | — |
| Canales del POS privados (`pos_sync`) y modo «solo privados» | Cerrar R5 | — |

---

## 09 — Decisiones abiertas

Para que las referencias de la fase 1 sigan valiendo, las decisiones de v0.2 conservan su número. Las nuevas empiezan en D19.

**Abiertas, para Yonatan** (las cinco primeras bloquean la salida al aire de las olas):

| # | Pregunta | Recomendación | Por qué |
|---|---|---|---|
| D22 | ¿Qué correos van en el alta inicial? | Yonatan y Camila como admin, y **todos** los meseros actuales en la misma alta. Los da Camila y los pega Yonatan en el SQL Editor. Nunca van al repo | Quien falte se queda afuera al aplicar `solo_personal` (§02.5). El repo es público |
| D23 | ¿Google OAuth en Testing o en producción, y el registro abierto? | Proveedor Email **apagado**. Google **publicado** (fuera de Testing) y el registro de Google abierto, porque `personal` pasa a ser la puerta. Alternativa: seguir en Testing y que Yonatan agregue a cada mesero como usuario de prueba | En Testing, cada alta necesita también a Yonatan en Google Cloud, y el admin no puede sumar meseros solo. Con `solo_personal`, una cuenta de Google cualquiera no ve nada. Toca identidad: decide Yonatan |
| D1 | ¿Cómo sabe el mesero que llegó una transferencia o un pago por QR? | Solo con el abono a la vista: la notificación del banco en un teléfono del local, o preguntándole a Camila (o a sus delegados) antes de facturar. El pantallazo del cliente no basta | Es la única prueba. En una cuenta de persona natural, la notificación le llega solo al titular; en una de persona jurídica, hasta a 6 delegados (blog de Bancolombia, §10) |
| D20 | ¿Quién hace el cierre del día? | Solo el admin | Escribe `cierres`, el único registro de ventas que queda tras la purga, y borra las órdenes del turno. Si a diario lo hace alguien que no es admin, esa es la señal para D19 (rol caja), no para abrírselo a todos los meseros |
| D21 | ¿El mesero crea productos en el catálogo, o solo los agrega a la cuenta? | Solo los agrega a la cuenta. Así se lee «añadir productos». Crear, cambiar precios y eliminar es del admin. Para algo que no está en la carta, el mesero ya tiene «Ítem manual» (`pos.html:2429`), que va a la orden sin tocar el catálogo | Un precio mal cambiado sale en la carta pública, la landing y el MCP (`carta_publica`) |
| D19 | ¿«Caja» como rol aparte? | No por ahora: caja = admin. Si aparece un cajero que no debe tocar catálogo, menú ni personal, se agrega `'caja'` al `check` de `personal.rol` y a las policies de `cierres` | Hoy cobran los meseros y cierra el admin. Un tercer rol es una migración chica, que se puede hacer cuando haga falta |
| D24 | ¿Quién rota el token de la pegatina? | Solo el admin. El mesero ve y copia el enlace. En la base, un trigger ignora el cambio de token que no venga de un admin | Rotar inutiliza la pegatina hasta reescribirla con la contraseña (D16), que solo tiene Yonatan. El trigger cubre además la caché vieja que hoy deshace rotaciones |
| D25 | ¿Un interruptor en la base para Pagar? | Sí: la fila `alertas` en `ajustes_cuenta`, que `alerta_cliente` lee primero. Apagado, responde 503 y la carta dice «Hazle una seña al mesero» | Se apaga en segundos, sin desplegar (Línea Roja: reversible en menos de 1 minuto). Sirve para probar en vivo y para un mal día en servicio |
| D29 | ¿El mesero ve las ventas y el historial de cierres? | Sí, en solo lectura, como pidió Yonatan («visualizar») | Si Camila prefiere reservar las ventas, `cierres` pasa a select solo para el admin (una policy) y se esconde la vista |
| D28 | ¿Cuánto viven las alertas? | El cierre del día borra las atendidas y las descartadas | Guardan el correo de quien atendió (minimización, Ley 1581). Si Camila quiere tiempos de respuesta, en fase 3 el cierre guarda el promedio del día antes de borrar |
| D26 | ¿Más métodos, como datáfono? | Por ahora, los tres que pidió Yonatan. Si el local cobra con datáfono, se agrega `'datafono'`: una línea en el `check` y un botón | El mesero llega igual. El método solo le dice con qué ir |
| D27 | ¿Registrar el medio de pago al cerrar, para cuadrar caja? | Sí, pero en fase 3. El modal de Facturar precarga el método de la alerta, lo guarda en `ordenes.medio_pago` y el cierre suma por medio | Toca `formatOrden`, el ticket y el cierre, que son de pos-visual. No cabe en la ola B sin agrandarla |
| D30 | ¿El cliente puede retirar el aviso desde la pegatina? | No. Un segundo toque solo cambia el método; el mesero descarta | Menos estados y menos superficie anónima |
| D11 | ¿Cómo suena el POS con una alerta? | Pitido al llegar y recordatorio cada 2 minutos mientras haya pendientes de más de 2 minutos. «Silenciar 10 min» por tablet. Suena también en segundo plano si el navegador lo deja | Sin sonido, nadie ve las alertas en hora pico (§11, A5). v0.2 lo limitaba al POS visible |
| D5 | ¿Una cuenta en vivo es una «precuenta» prohibida (CU 2.4.3)? ¿Qué documento se entrega? | Consulta legal cuando se pueda. Mientras tanto, «Consumo en vivo · no es factura». Ya no bloquea: Pagar no muestra montos a transferir ni datos | Multas de hasta 2.000 SMMLV y ningún pronunciamiento encontrado. «Mi cuenta» ya está al aire |
| D6 | ¿Es correcto «IVA incluido» (`carta.html:226`)? | Que el contador confirme el régimen; se corrige en otra tarea | Los restaurantes suelen tributar impoconsumo del 8 % (ET 512-1) |
| D7 | ¿Qué se hace con la «fuga aceptada»? | Aceptarla para ver y para avisar. NTAG 424 DNA al reemplazar las pegatinas | Las NTAG215 son estáticas. La cuenta no tiene datos personales, y lo peor que se puede hacer es una alerta falsa |
| D16 | ¿Contraseña de escritura en las NTAG215? | Sí: PWD/PACK con AUTH0 = 04h y PROT = 0, en el gestor de Yonatan. Sin bloqueo permanente | De fábrica, cualquier teléfono las reescribe (SD1). El bloqueo permanente impediría rotar |
| D17 | ¿Pasar `presencia_pos` a un canal privado? | Sí, en 1D, con su policy y la prueba S-10. Con la ola A, la policy exige `mi_rol()` | Hoy publica el nombre del personal en un canal que cualquiera puede escuchar y falsificar (SD9) |

**Cerradas o retiradas desde v0.2:**

| # | Pregunta de v0.2 | En v0.3 |
|---|---|---|
| D2 | ¿Qué datos de pago se publican y dónde va el QR? | **Retirada.** La página no muestra datos de pago; el QR va impreso con el mesero (§04.6) |
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
| Que `auth.jwt() ->> 'email'` llegue siempre en las sesiones de Google de este proyecto | Solo se probó con claims simulados en Docker. Lo verifica R-0 |
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
| Si el egress de Edge Functions y Realtime cuenta como «sin caché» | La doc de Supabase no lo dice. §07 usa el cupo de 5 GB, el más conservador |

---

## 11 — Registro

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
