# Restaurante Resplandor POS

> **Software Design Document · v2.0 — Implementado**

Punto de venta táctil para gestión de mesas, facturación y cierre diario, con sincronización multi-dispositivo en tiempo real y acceso restringido por login de Google.
Stack: HTML + Tailwind Play + Alpine.js + Lucide Icons + Supabase (Postgres + Realtime + Auth). Tailwind, Alpine, Lucide, supabase-js y el generador del QR del ticket son archivos **locales de versión fija** en `assets/vendor/` (origen, versión y sha256 en `assets/vendor/README.md`), no CDNs: desde 2026-10-01 el POS no depende de ningún host de terceros para sus scripts.

| Versión | Estado | Stack | Actualizado |
|---------|--------|-------|-------------|
| 1.0 — Open Spec | Definición inicial (solo localStorage, sin backend) | HTML · Tailwind · Alpine.js | Junio 2026 |
| **2.0 — Implementado** | **En producción, uso diario del restaurante** | **+ Supabase (Postgres · Realtime · Auth)** | **Julio 2026** |

> **Dónde vive cada página** (desde el 2026-09-29): la raíz `https://resplandor.ynt.codes/` es la landing pública (`index.html`); el POS que describe este documento vive en `/pos.html` (uso interno: `noindex` y `Disallow` en `robots.txt`); `landing.html` solo redirige a la raíz para no romper enlaces ya publicados; la carta NFC y el menú siguen en `/carta.html` y `/menu.html`. Detalle en `docs/landing-y-agentes.md`.

> **Estado de los roles, las alertas y la ola C (2026-10-01):** en producción hay hoy **la compuerta de personal** (`personal` y la restrictiva `solo_personal`), aplicada la noche del 2026-09-30 con Yonatan como único admin (`mi_rol()` devolvió `admin`); Camila y los meseros todavía no están dados de alta. **Todo lo demás está diseñado y probado en local, en ramas, y NO está al aire:** los permisos por rol, las alertas de «pedir la cuenta» y el cobro por monto y por unidades (ola B), y el **modelo de aprobación del personal**, el panel de **Mesas y pegatinas**, el **ticket configurable** y **deshacer un cobro** (ola C). Aplicarlos es de Yonatan, en el orden de §07. Hasta entonces, lo que las secciones de abajo describen como «hoy» sigue siendo cierto en producción; lo nuevo va marcado con «ola B» u «ola C». El diseño completo está en [`docs/sdd-cuenta-en-mesa.md`](docs/sdd-cuenta-en-mesa.md); cómo escribir, proteger, revisar y rotar las pegatinas, en [`docs/pegatinas.md`](docs/pegatinas.md).

La diferencia entre v1.0 y v2.0 no es cosmética: el plan original dejaba explícitamente **fuera de alcance** un backend real y la autenticación (ver v1.0, sección 02). La operación real con varios dispositivos en simultáneo hizo necesario sumar ambas cosas. Este documento describe lo que **realmente existe hoy** en `pos.html`, no el plan original.

---

## Contenidos

1. [Introducción](#01--introducción)
2. [Alcance](#02--alcance)
3. [Stack tecnológico](#03--stack-tecnológico)
4. [Arquitectura](#04--arquitectura)
5. [Sistema de diseño](#05--sistema-de-diseño)
6. [Entidades del dominio](#06--entidades-del-dominio)
7. [Seguridad y autenticación](#07--seguridad-y-autenticación)
8. [Contrato de datos](#08--contrato-de-datos)
9. [Flujos principales](#09--flujos-principales)
10. [Sincronización multi-dispositivo](#10--sincronización-multi-dispositivo)
11. [Incidentes resueltos](#11--incidentes-resueltos)
12. [Fases de desarrollo](#12--fases-de-desarrollo)
13. [Decisiones fijas](#13--decisiones-fijas)
14. [Estructura del HTML](#14--estructura-del-html)
15. [Componentes](#15--componentes)
16. [Checklist de producción](#16--checklist-de-producción)

---

## 01 — Introducción

### ¿Qué es hoy Resplandor POS?

Una aplicación web táctil, **single-file** (`pos.html`, sin build step), que gestiona el flujo completo de un turno de restaurante: login del personal, mapa de mesas, toma de pedidos, facturación y cierre diario — sincronizado en tiempo real entre todos los dispositivos del local (tablets de meseros, caja, administración).

A diferencia del plan original, la persistencia **no** es solo `localStorage`: es un modelo híbrido donde `localStorage` actúa como caché de lectura instantánea y cola de escritura, y **Supabase (Postgres)** es la fuente de verdad remota, sincronizada por Realtime.

> **Principio rector actualizado:** el cliente sigue siendo la capa de interacción (Alpine.js, sin framework pesado), pero la verdad de los datos vive en Supabase. El single-file HTML no significa "sin backend" — significa "sin build step ni servidor propio que mantener".

---

## 02 — Alcance

### Qué entra y qué no (actualizado a v2.0)

#### ✅ En producción

- [x] Login obligatorio con Google (Supabase Auth) — toda la app está detrás de este gate
- [x] Mapa de mesas con estado libre/ocupada, sincronizado en tiempo real
- [x] Apertura y asignación de orden por mesa, protegida contra duplicados por condición de carrera
- [x] Catálogo de productos (CRUD) con categorías
- [x] Agregar ítems de menú e ítems manuales a una orden abierta
- [x] Facturación: cálculo de total + ticket imprimible
- [x] Cierre diario: total ventas + historial de cierres, con reintentos automáticos si falla la subida
- [x] **Realtime Presence**: saber qué otro dispositivo/persona tiene abierta la misma mesa ahora mismo
- [x] Persistencia híbrida: `localStorage` (caché + cola offline) + Supabase (verdad remota)
- [x] Seguridad a nivel de base de datos (RLS): sin login, cero acceso a ningún dato
- [x] Responsive: tablet ≥ 768px + desktop

#### ❌ Todavía fuera de alcance

- [ ] Roles diferenciados (admin vs. mesero) — la **compuerta** de personal ya está al aire (solo entra quien esté en `personal`; hoy, un admin); los **permisos por rol** y el **modelo de aprobación** (quien entra pide acceso y un admin lo aprueba) están **listos en ramas y probados en local, sin aplicar** (ver §07)
- [ ] Alertas de «pedir la cuenta» en el POS, y el cobro por monto y por unidades de una línea (ola B, en ramas)
- [ ] Panel de **Mesas y pegatinas** (crear y editar mesas, escribir y revisar la pegatina NFC), ajustes del **ticket** (QR y pie) y **deshacer un cobro** (parcial, abono o la mesa completa; sin ventana de tiempo; ola C, en ramas)
- [ ] Impresión térmica automática (se resolvió por fuera de esta app, a nivel de driver/OS)
- [ ] Fotos de producto (Supabase Storage) — próxima fase
- [ ] Resumen de cierre generado con IA — próxima fase
- [ ] Inventario con control de stock
- [ ] Comandas en cocina (Kitchen Display)
- [ ] Facturación electrónica (DIAN)
- [ ] Multi-restaurante / multi-sucursal

---

## 03 — Stack tecnológico

| Tecnología | Rol |
|---|---|
| **HTML5 + Alpine.js v3** | Estructura y reactividad declarativa, sin build step |
| **Tailwind CSS (Play, 3.4.17, local)** | Utilidades + design tokens; compila en el navegador desde `assets/vendor/` |
| **Lucide Icons (1.49.0, local)** | SVG íconos desde `assets/vendor/` |
| **Fraunces + DM Sans** | Tipografía display / body (Google Fonts) |
| **Supabase Postgres** | Fuente de verdad remota (`productos`, `mesas`, `ordenes`, `cierres`) |
| **Supabase Realtime — Postgres Changes** | Sincroniza cambios de fila entre dispositivos |
| **Supabase Realtime — Presence** | Quién tiene abierta cada mesa, en vivo, sin tocar Postgres |
| **Supabase Auth (Google OAuth)** | Login obligatorio, única puerta de entrada a la app |
| **Row Level Security (RLS)** | Control de acceso real — reemplaza la confianza en el secreto de la anon key |
| **localStorage** | Caché de lectura + cola de sincronización offline |
| **window.print()** | Ticket imprimible |
| **Librería de QR chica** (ola C; `qrcode-generator` 1.4.4, MIT, 56 KB sin minificar, archivo local en `assets/vendor/`: el `qrcode.js` del paquete de npm, verificado contra npm y contra lo que publica cdnjs) | Dibuja en el navegador el QR del ticket a partir de `ajustes.ticket_qr_url`. Si no carga, el ticket sale sin QR, nunca roto |
| **Web NFC (`NDEFReader`)** (ola C, solo Chrome para Android, HTTPS y con un toque del usuario) | Escribir y revisar la pegatina de cada mesa desde el POS (`docs/pegatinas.md`) |

### ¿Por qué se sumó Supabase si el plan decía "sin backend"?

El plan v1.0 asumía un solo dispositivo por turno. En la práctica, un restaurante tiene varios meseros con tablets simultáneas — sin una fuente de verdad remota y sincronización en tiempo real, dos meseros facturando la misma mesa es un riesgo real de negocio, no un detalle técnico. Supabase se eligió porque no rompe la regla de "cero build step": todo se consume por HTTP/WebSocket desde el mismo `pos.html`, sin bundler ni servidor propio.

---

## 04 — Arquitectura

### Capas (actualizado)

| Capa | Responsabilidad | Implementación |
|------|----------------|----------------|
| **Config** | Design tokens, Tailwind config, credenciales de Supabase (anon key) | `<script>` al inicio del `<head>` |
| **Store** | Estado global reactivo + sesión de usuario + presencia | `Alpine.store('pos', {...})` |
| **Auth gate** | Bloquea toda la UI hasta que exista sesión de Google | Contenedor `x-show="$store.pos.usuario"` que envuelve nav + vistas + modales |
| **Components** | Bloques HTML con `x-data` local | Secciones comentadas en `<body>` |
| **Services** | Mapeo camelCase ↔ snake_case, cálculo de totales, sync | Funciones dentro del store (`parseX` / `formatX`) |
| **Persistence local** | Caché de lectura + cola de reintentos | `localStorage` (`pos_mesas`, `pos_ordenes`, `pos_productos`, `pos_cierres`, `pos_device_id`) |
| **Persistence remota** | Verdad de negocio | Supabase Postgres, protegido por RLS |
| **Realtime** | Sincronización viva | Canal `pos_sync` (postgres_changes) + canal `presencia_pos` (Presence) |

### Principios de diseño (vigentes)

- **Separación Store / UI** — el Alpine store sigue siendo la única fuente de verdad del cliente; los componentes solo leen y llaman métodos del store.
- **Boundary camelCase ↔ snake_case** — el store y los templates usan camelCase (`mesaId`, `abiertaEn`); Supabase usa snake_case (`mesa_id`, `abierta_en`). La traducción pasa siempre por `parseOrden()` / `formatOrden()` (y equivalentes para producto/cierre). **Este boundary se rompió en 5 lugares del template durante el desarrollo** (ver sección 11) — si tocas templates que muestran datos de una orden, usa siempre los nombres camelCase del objeto ya parseado, nunca los de la columna de Postgres.
- **Fire-and-forget está prohibido** — toda escritura a Supabase (`pushASupabase`) tiene `try/catch`; todo handler de Realtime también.
- **La UI nunca confía en el estado local para decisiones de concurrencia** — desde el incidente de mesas duplicadas, la base de datos (no el cliente) es quien arbitra condiciones de carrera (ver sección 10).

---

## 05 — Sistema de diseño

El POS usa desde el 2026-09-30 la **identidad v2 de la landing** («El letrero abre el salón»): barra y login en telón, área de trabajo en arroz, tarjetas en papel; Cinzel para marca y títulos, Archivo para texto, botones, precios y totales. Esta sección ya no lista tokens, porque la paleta que había aquí (`--ember #B5341C`, Fraunces + DM Sans) quedó obsoleta.

- **Tokens, tipografía y contratos de color:** [`docs/identidad-visual.md`](docs/identidad-visual.md). La única fuente de los 15 tokens es `assets/css/base.css`.
- **Cómo se aplica al POS** (mapa de lo viejo a lo nuevo, recetas de componentes, medidas táctiles, restricciones y verificación): [`docs/pos-visual.md`](docs/pos-visual.md).
- **Dónde vive en `pos.html`:** un solo `<style>` con los 15 tokens copiados, alias temporales de la v1 y un bloque CSS por parte; `pos.html` conserva su Tailwind CDN y no carga `resplandor.css`. `scripts/pruebas/pos-visual.test.mjs` vigila que los tokens sigan siendo los de `base.css`.

---

## 06 — Entidades del dominio

### Mesa

| Campo (Postgres) | Campo (store, camelCase) | Tipo |
|---|---|---|
| `id` | `id` | **PK**, integer |
| `capacidad` | `capacidad` | `number` |
| `estado` | `estado` | `'libre' \| 'ocupada'` |
| `updated_at` | — | `timestamptz` |
| `token` | `token` | `text`, 48 caracteres hexadecimales: la llave del enlace de la pegatina (§07). Solo un admin lo cambia (`trg_mesas_token_solo_admin`) |
| `activa` (ola C) | `activa` | `boolean`, por defecto `true`. `false` = fuera de servicio: no sale en el mapa del salón, su enlace responde «inválido» y no se le puede avisar. **Una mesa no se borra** (tiene historial de cuentas): se desactiva, y no se puede desactivar con una cuenta abierta |
| `pegatina_escrita_en`, `pegatina_revisada_en` (ola C) | `escritaEn`, `revisadaEn` | `timestamptz \| null`: cuándo se escribió y cuándo se revisó por última vez la pegatina de la mesa (`pegatina_marcar`) |

### Producto

| Campo (Postgres) | Campo (store) | Tipo |
|---|---|---|
| `id` | `id` | **PK**, text |
| `categoria` | `cat` | `string` |
| `nombre` | `nombre` | `string` |
| `precio` | `precio` | `number` |
| `descripcion` | `desc` | `string` |
| `activo` | `activo` | `boolean` |

### Orden

| Campo (Postgres) | Campo (store) | Tipo |
|---|---|---|
| `id` | `id` | **PK**, text |
| `mesa_id` | `mesaId` | `number` |
| `estado` | `estado` | `'abierta' \| 'cerrada'` |
| `items` | `items` | `jsonb` → `OrdenItem[]` |
| `total` | `total` | `numeric` |
| `abierta_en` | `abiertaEn` | `timestamptz` |
| `cerrada_en` | `cerradaEn` | `timestamptz \| null` |
| `parcial_de` (ola C) | `parcialDe` | `text \| null`: el `id` de la orden **abierta** de la que salió este cobro parcial o abono. Lo escribe el POS al **crear** la orden cerrada (`facturarParcial`, cobro por monto) y es lo que permite **deshacer** el cobro (§07, «Deshacer un cobro»). **No cambia por UPDATE** (lo conserva el disparador `trg_ordenes_guardia`, también para el admin: un mesero que cierra una cuenta suya con un `parcial_de` inventado no engaña a `deshacer_cobro`) y se pone en `null` al **reabrir o editar** esa venta |
| `version` | `version` | `integer`: sube con cada cambio de los ítems (`aplicar_delta_orden`, `deshacer_cobro` y, sin pedirlo, cualquier UPDATE que cambie `items`). **Cobrar la mesa manda la `version` que la tablet vio**: si la base ya tiene otra, rechaza el cierre (`RS003`) y el POS avisa «La cuenta cambió, revísala» y la vuelve a leer (§07, «Cerrar con lo que se vio») |

Un `OrdenItem` de **precio negativo** es un **abono**: un cobro por monto («Cobrar por partes → monto», ola B). La orden cerrada «Abono · Mesa N» lleva el cobro y la orden abierta recibe una línea «Abono recibido» con precio negativo (`aplicar_delta_orden`, `p_precio = −monto`, delta +1), así que su `total` es lo que **queda** por pagar. La carta pública (`carta.html`) la muestra como abono, con signo menos, y no como un producto (`docs/sdd-cuenta-en-mesa.md` §03.5 y §04.7).

**Restricción a nivel de base de datos (nueva, ver sección 11):** índice único parcial `ux_ordenes_una_abierta_por_mesa (mesa_id) WHERE estado = 'abierta'` — garantiza que nunca exista más de una orden abierta por mesa, sin importar cuántos dispositivos intenten abrirla a la vez.

### CierreDiario

| Campo (Postgres) | Campo (store) | Tipo |
|---|---|---|
| `id` | `id` | **PK**, text |
| `fecha` | `fecha` | `timestamptz` |
| `total_ventas` | `total` | `numeric` |
| `total_ordenes` | — (se calcula de `ordenes.length`) | `integer` |
| `transacciones` | `ordenes` | `jsonb` → `Orden[]` (guardadas ya en camelCase) |

### Usuario / Sesión (nuevo en v2.0)

No es una tabla propia: la sesión vive en **Supabase Auth**, poblada por el proveedor Google OAuth. El store expone:

```javascript
usuario            // objeto de sesión de Supabase Auth, o null si no hay login
nombreUsuario      // getter: user_metadata.full_name || email
avatarUsuario      // getter: user_metadata.avatar_url
```

Con la ola B, tras el login el POS pregunta su rol a la base (`mi_rol()`) y el store suma `esAdmin` y `tieneAcceso`; una cuenta sin fila activa en `personal` ve «Tu cuenta no está habilitada» y no carga nada. **Con la ola C**, antes de eso el POS llama a `solicitar_acceso()`: quien entra con Google y no está en `personal` queda como **pendiente** y ve una pantalla de solo lectura (`estadoAcceso`, §07, «Modelo de aprobación»).

### Personal (la tabla y la compuerta ya están al aire; los permisos por rol y la aprobación, no)

Quién entra al POS y con qué rol. Una fila por correo de Google, en minúsculas. La baja es lógica.

| Campo (Postgres) | Tipo |
|---|---|
| `email` | **PK**, `text`, minúsculas y con forma de correo |
| `nombre` | `text`, hasta 80 caracteres |
| `rol` | `'admin' \| 'mesero'` (el de un pendiente es provisional: `'mesero'` hasta que un admin lo apruebe) |
| `activo` | `boolean` (la baja es `false`; la fila no se borra) |
| `estado` (ola C) | `'pendiente' \| 'aprobado'`, por defecto `'aprobado'`: las filas que ya existían quedan aprobadas |
| `solicitado_en` (ola C) | `timestamptz`: cuándo pidió acceso, si lo pidió él mismo |

Se escribe con las RPC `personal_alta`, `personal_baja` y `personal_cambiar_rol` (solo admin) y, desde la ola C, `personal_aprobar` y `personal_eliminar` (solo admin); la única fila que alguien crea por su cuenta es la suya, **pendiente**, con `solicitar_acceso()`. El admin ve a todos (los pendientes también) y cada quien ve su propia fila. **Los correos reales nunca van en el repo** (es público): el alta inicial la pega Yonatan en el SQL Editor.

### Alerta (ola B, aún no al aire)

El aviso «esta mesa pidió la cuenta»: el cliente elige QR, transferencia o efectivo y eso no cobra nada, solo avisa al personal.

| Campo (Postgres) | Tipo |
|---|---|
| `id` | **PK**, `uuid` |
| `mesa_id`, `orden_id` | la mesa y la orden abierta a la que se avisó |
| `tipo` | `'pedir_cuenta'` |
| `metodo` | `'qr' \| 'transferencia' \| 'efectivo'` |
| `estado` | `'pendiente' \| 'atendida' \| 'descartada'` |
| `creada_en`, `atendida_en` | `timestamptz` |
| `atendida_por` | correo de quien la atendió (o `sistema` si se cerró sola al facturar o liberar la mesa) |

Una sola alerta pendiente por mesa (índice único parcial): un segundo toque cambia el método y la hora. La crea solo `service_role` (la Edge Function `alerta`) y la atiende el personal con `atender_alerta` o `descartar_alerta`. **Retención (ola C, D28):** una alerta que ya no está pendiente (atendida o descartada) se **borra un día después**, porque guarda el correo de quien la atendió; las pendientes no se borran solas.

### Ajustes (ola C, aún no al aire)

Cómo sale el ticket impreso. **Una sola fila** (`id = 1`).

| Campo (Postgres) | Campo (store) | Tipo |
|---|---|---|
| `ticket_qr_url` | `ticketQrUrl` | `text`, por defecto `https://resplandor.ynt.codes/`; debe empezar por `https://` y tener hasta 200 caracteres |
| `ticket_qr_visible` | `ticketQrVisible` | `boolean`, por defecto `true` |
| `ticket_pie` | `ticketPie` | `text`, por defecto «Gracias por su visita», hasta 120 caracteres |
| `actualizado_en`, `actualizado_por` | — | quién y cuándo lo cambió |

La lee todo el personal aprobado y **solo la escribe un admin** (nadie inserta ni borra la fila). Sin la tabla, el POS usa esos mismos valores por defecto.

### Presencia (nuevo en v2.0 — no persiste en Postgres)

Vive solo mientras dura la conexión Realtime de cada pestaña/dispositivo, en el canal `presencia_pos`:

```javascript
{ mesaId: number | null, deviceId: string, nombre: string, ts: number }
```

`deviceId` es estable por navegador (`localStorage.pos_device_id`), no por persona — dos pestañas del mismo navegador comparten identidad de presencia.

---

## 07 — Seguridad y autenticación

### Modelo de acceso

Toda la app está detrás de un gate: sin sesión de Google activa, no se renderiza absolutamente nada (ni el mapa de mesas, ni el catálogo). Esto se refuerza a **dos niveles**, porque uno solo no basta:

| Nivel | Qué protege | Cómo |
|---|---|---|
| **Cliente (UX)** | Qué ve el usuario | `<div x-show="$store.pos.usuario">` envuelve nav + vistas + modales |
| **Base de datos (real)** | Qué puede leer/escribir cualquiera con la anon key, sin pasar por la UI | Row Level Security: las 4 tablas (`productos`, `mesas`, `ordenes`, `cierres`) solo tienen policies para el rol `authenticated`. **Cero policies para `anon`.** |

> El nivel de cliente es cosmético — cualquiera puede leer la anon key desde "Ver código fuente" y llamar a la API REST de Supabase directamente. La única protección real es RLS. Este proyecto tuvo, por un tiempo, exactamente ese hueco (ver sección 11) — no vuelvas a dejar una tabla con policy para `anon` sin una razón explícita y documentada aquí.

### Flujo de login

1. `init()` resuelve la sesión existente (`supabaseClient.auth.getSession()`).
2. Si no hay sesión, se muestra la pantalla de login; la app real (caché, sync, Realtime, presencia) **no arranca** hasta que hay usuario.
3. Al autenticarse, `onAuthStateChange` dispara `arrancarApp()` — con guarda propia (`_appArrancada`) para no duplicar suscripciones de Realtime si el evento de auth se dispara más de una vez.
4. El nombre y avatar de Google se usan también en Presence, así que "quién tiene la mesa abierta" muestra un nombre real, no un dispositivo anónimo.
5. **Ola C:** antes de preguntar el rol, el POS llama a `solicitar_acceso()`. Quien ya está en `personal` y aprobado sigue de largo; quien no está queda **pendiente** y ve una pantalla de solo lectura hasta que un admin lo apruebe (§07, «Modelo de aprobación del personal»).

### Modelo de acceso por roles (ola B: listo en ramas, **no está al aire**)

**El hueco de hoy.** La policy restrictiva `solo_google` solo mira que la sesión venga de Google (`supabase/migrations/20260905000000_resplandor_base.sql`). Mientras el proyecto de Google Cloud esté en modo «Testing», eso se contiene con la lista de usuarios de prueba; pero **cualquier cuenta de Google que pase el login lee las ventas y los tokens de las mesas**, y si se publica la app, cualquier Gmail entra. Los roles cierran ese hueco y además reparten lo que puede hacer cada persona. Diseño completo, decisiones y pruebas de humo: [`docs/sdd-cuenta-en-mesa.md`](docs/sdd-cuenta-en-mesa.md) §02.

**Las piezas** (tres migraciones, de la rama `tarea/roles-alertas-bd`, cada una sale a su hora; nada de esto está aplicado en `lccgehvyymladqvumcez`):

| Pieza | Qué hace |
|---|---|
| Tabla `personal` | Quién entra y con qué rol (`admin` o `mesero`). Una fila por correo de Google; la baja es lógica (`activo = false`). Se crea vacía: el alta inicial va en un SQL aparte, **fuera del repo** |
| `mi_correo()` y `mi_rol()` | El rol de quien llama, o `null`. Se reconoce a la persona por su **identidad de Google** (`auth.identities`), no por el correo de `auth.users`, que el usuario puede cambiar; una cuenta con contraseña y el correo de un admin no hereda su rol. Se consulta en cada petición: una baja surte efecto en la siguiente consulta, no cuando vence la sesión |
| La compuerta `solo_personal` | Policy **restrictiva** que reemplaza a `solo_google`: Google **y** fila activa en `personal`. Cubre `productos`, `mesas`, `ordenes`, `cierres`, `sugerencias_plato` y `alertas`; en `menus` solo las escrituras, porque la votación pública (`menu.html`) lee `menus` como `anon`. Sin fila activa no hay acceso, con o sin Google |
| `personal_alta`, `personal_baja`, `personal_cambiar_rol` | Gestión del personal, solo admin, con `ultimo_admin` si la operación dejaría el sistema sin admins. El POS las llama desde la vista «Personal» |
| Permisos por rol | Policies por tabla y operación, con `mi_rol()` (tabla de abajo). El GRANT no cambia; cambia **quién** puede |
| `alertas`, `atender_alerta`, `descartar_alerta`, `alertar_cuenta` | Las alertas de «pedir la cuenta». `alertar_cuenta` solo la ejecuta `service_role` (la Edge Function `alerta`); las otras dos, el personal |

**Qué hace cada rol.** Esconder en la interfaz es una comodidad; la regla real la pone la base: lo que un mesero no puede, la base lo rechaza aunque llame a la API a mano (con `42501` si es un `insert`, y en silencio, con 0 filas, si es editar o borrar; por eso el POS de la ola B tiene que esconderlo antes de aplicar los permisos). Una salvedad, en la nota ¹. Las filas marcadas «ola C» son de la ola C (secciones siguientes).

| Capacidad | Mesero | Admin |
|---|---|---|
| Entrar al POS | Con fila activa | Con fila activa |
| Ver mesas, órdenes, productos, menús, ventas del día y **historial de cierres** | Sí (los cierres, en solo lectura) | Sí |
| Abrir mesa, agregar y quitar ítems, «Ítem manual», editar la mesa, notas y «Persona N» | Sí | Sí |
| Cobrar y cerrar (Facturar), cobro por partes (por ítems, por unidades de una línea o por monto), pre-cuenta, liberar una mesa vacía (abierta y sin ítems) | Sí | Sí |
| Reabrir, editar o eliminar una orden **cerrada** (una venta del turno o de un cierre pasado) | No | Sí |
| Ver, atender y descartar alertas | Sí | Sí |
| **Crear y editar productos** (catálogo y precios) | **Sí** | Sí |
| **Borrar productos** | No | Sí |
| Programar el menú semanal y leer las sugerencias de platos | No | Sí |
| **Cierre del día** (escribir en `cierres`) | No | Sí |
| Rotar el token de la pegatina de una mesa | No ¹ | Sí |
| Gestionar el personal: alta, baja, rol | No | Sí |
| **Aprobar o eliminar personal** y ver las solicitudes pendientes (ola C) | No | Sí |
| **Mesas y pegatinas**: crear y editar mesas, desactivarlas, escribir y revisar la pegatina (ola C) | No | Sí |
| **Ajustes del ticket**: dirección del QR, QR visible y pie (ola C) | No (el ticket impreso sí lo usa) | Sí |
| **Deshacer un cobro** (ola C): un parcial, un abono o la mesa completa | Sí, **en cualquier momento** mientras el cobro siga en el turno (sin ventana de tiempo) | Sí, en cualquier momento |
| Ver **«Cobros deshechos hoy»** en el cierre del día (quién, mesa, monto y hora; ola C) | No | Sí |

¹ **La rotación del token la impide la base, sin lanzar error.** El POS guarda las mesas con `upsert` y un permiso por columna no sirve (mesero y admin son el mismo rol de Postgres), así que la policy deja que cualquier persona del personal edite `mesas`. Lo que lo frena es `trg_mesas_token_solo_admin` (en `permisos_por_rol`, desde la ronda 2 de la ola B): un `BEFORE UPDATE` que **conserva el token viejo** si quien lo cambia no es admin, sin romper el `upsert` de un mesero. Por eso el cambio de token de un mesero no falla: simplemente no cambia. También impide la base renumerar una mesa (solo admin).

- **Caja = admin.** No hay un tercer rol: el cierre del día y los cierres pasados son del admin (decisión de Yonatan, 2026-09-30). Si algún día hay un cajero que no deba tocar catálogo, menú ni personal, se agrega `'caja'` al `check` de `personal.rol`.
- **El mesero sí crea y edita productos** (decisión de Yonatan, 2026-09-30): INSERT y UPDATE en `productos`, también el `upsert` del POS. Borrar sigue siendo del admin. Lo que un mesero cambie en el catálogo sale en la carta pública (`carta_publica`), la landing y el MCP.
- **El mesero ve las ventas del día y el historial de cierres, en solo lectura** (D29). Escribir en `cierres` es solo del admin.
- **Sin propina**: ni la carta, ni el POS, ni el ticket, ni el cierre la piden, la sugieren o la registran (decisión de Yonatan, 2026-09-30).
- **Nunca cero admins**: la baja o el cambio de rol que dejaría la tabla sin un admin activo se rechaza.

**Arranque seguro: el orden en que sale al aire** (todo con el GO de Yonatan y fuera del horario de servicio; el detalle y las reversas, en el SDD §02.5, §08 y §12.9):

1. **La compuerta** (`20261002120000_personal_y_compuerta.sql`) junto con el alta inicial. **Ya está aplicada** (2026-09-30, de noche), con Yonatan como único admin y `mi_rol()` verificado. La migración se niega a correr (y no toca una sola policy) si no queda al menos un admin con una cuenta de Google real; quien no esté dado de alta queda afuera al instante, y por eso Camila y los meseros esperan el paso 3. Reversa en menos de un minuto: la cabecera de la migración vuelve a `solo_google`.
2. **Las alertas** (`20261002130000_alertas.sql`) y la Edge Function `alerta`; y el **POS de la ola B**, que oye las alertas, ya le esconde al mesero lo del admin y trae el panel Personal con el alta por correo.
3. **Dar de alta a Camila y a los meseros** desde ese panel (o con el SQL de Yonatan), con la ola B al aire.
4. **Los permisos por rol** (`20261002140000_permisos_por_rol.sql`) **después** de publicar el POS de la ola B: al revés, el POS de hoy le mostraría al mesero botones que la base rechaza (y la base los rechaza en silencio, con 0 filas).
5. **La ola C**, en este orden: las **cuatro migraciones** (`20261002150000_aprobacion_personal.sql`, `20261002160000_mesas_y_pegatinas.sql`, `20261002170000_ajustes_ticket.sql` y `20261002180000_deshacer_cobro.sql`, todas idempotentes y compatibles con el POS de la ola B: las filas de `personal` que ya existen quedan aprobadas); luego la Edge Function `cuenta` (una mesa desactivada es un enlace inválido: lee `mesas.activa`, y por eso va **después** de la migración) y `alerta` si cambió; y por último el **POS de la ola C**.
6. **Google fuera de «Testing»** (decisión D23, 2026-09-30), **solo con la ola C al aire**: antes, publicar la app deja a cualquier Gmail abrir el login. Con el modelo de aprobación, esa cuenta queda pendiente y solo ve el mapa y la carta.

### Modelo de aprobación del personal (ola C: listo en ramas, **no está al aire**)

Pedido de Yonatan (2026-09-30): «haz mejor un panel de admin donde pueda añadir, aprobar o eliminar usuarios del restaurante; si no se aprueba solo podrá ver, no podrá hacer nada más». Es el camino normal desde la ola C, y reemplaza al alta **solo por correo** de la ola B: quien entra con Google **pide acceso solo**, y un admin lo **aprueba** o lo **elimina**. El alta por correo (`personal_alta`) sigue existiendo y crea a la persona **ya aprobada**. Diseño: [`docs/sdd-cuenta-en-mesa.md`](docs/sdd-cuenta-en-mesa.md) §12.2.

| Estado | Cómo se llega | Qué ve | Qué puede hacer |
|---|---|---|---|
| **Pendiente** | La primera vez que entra con Google sin estar en `personal`: el POS llama a `solicitar_acceso()`, que crea su fila (`estado = 'pendiente'`, rol `mesero` provisional, nombre del perfil de Google) | «Tu cuenta espera aprobación», el **mapa de mesas en solo lectura** (número, capacidad y libre u ocupada, de `vista_pendiente()`) y la **carta** (`carta_publica`) | Mirar. **Nada más**: ni cuentas, ni totales, ni ventas, ni tokens, ni órdenes, ni alertas |
| **Aprobado** | Un admin lo aprueba como `mesero` o como `admin` (`personal_aprobar(email, rol)`), o lo dio de alta por correo | El POS de su rol (tabla de arriba) | Lo de su rol |
| **Eliminado** | Un admin lo elimina (`personal_eliminar(email)`): baja lógica, `activo = false`; la fila no se borra | La misma pantalla de espera, sin datos | Nada. Si vuelve a entrar, `solicitar_acceso()` responde `eliminado` y **no la resucita**: solo un admin puede volver a darla de alta |

- **Lo impone la base, no la pantalla.** `mi_rol()` devuelve un rol **solo si la fila está activa y aprobada**: para un pendiente devuelve `null`, y la compuerta `solo_personal` le niega todas las tablas, igual que a una cuenta sin fila. Lo único que ve es lo que le dan a propósito `vista_pendiente()` (número, capacidad y estado de las mesas **activas**; **sin token, sin totales, sin órdenes**) y la carta, que es pública. `solicitar_acceso()` no deja que nadie se apruebe a sí mismo: solo crea la fila pendiente.
- **Qué hace el POS en espera:** no sincroniza datos, no abre Realtime de datos y no guarda caché; vuelve a preguntar cada 30 s y al volver a la pestaña, y cuando un admin lo aprueba arranca el flujo normal **sin recargar**. Si la base aún no tiene `solicitar_acceso` (migración sin aplicar), el POS sigue el flujo de la ola B.
- **Quién aprueba:** solo un admin. En **Personal** ve el **contador de pendientes en vivo** (le llegan los cambios de la tabla `personal` por Realtime; la RLS solo entrega las filas de los demás a un admin) y, por cada pendiente, «Aprobar como mesero», «Aprobar como admin» y «Eliminar»; por cada aprobado, cambiar el rol y eliminar. Eliminar se confirma **dentro de la página**, nunca con el `confirm()` del navegador.
- **Nunca cero admins:** `personal_eliminar`, `personal_baja` y el cambio de rol rechazan lo que dejaría la tabla sin un admin aprobado y activo; un admin tampoco puede eliminarse si es el último.
- **Anti-abuso:** hay un tope de solicitudes pendientes en total (lo fija la migración): llenado el tope se rechaza la solicitud nueva hasta que un admin limpie la lista. Una solicitud solo guarda el correo de Google y el nombre del perfil, y la hora.
- **Privacidad:** el correo y el nombre de un pendiente se guardan aunque nunca se aprueben, y solo los ve un admin. `privacy.html` lo dice. Para que se borre del todo un registro, la persona se lo pide al restaurante.

**Google fuera de «Testing»: solo con la ola C al aire** (decisión de Yonatan, 2026-09-30). Fuera de Testing, **cualquier** cuenta de Google puede abrir el login. Con la compuerta sola, esa cuenta ve «sin acceso»; con la aprobación, queda **pendiente** y solo ve el mapa y la carta. Antes de la ola C no se publica: mientras tanto, solo entra quien Yonatan agregó como usuario de prueba en Google Cloud (límite de 100) y esté en `personal`.

### Mesas y pegatinas (ola C: listo en ramas, **no está al aire**)

Pedido de Yonatan: «en el panel administrativo debemos poder añadir y editar pegatinas». Vista **Mesas y pegatinas** del POS, solo para el admin. La guía para quien escribe las pegatinas, con los pasos de NFC Tools y de la contraseña, es [`docs/pegatinas.md`](docs/pegatinas.md).

- **La lista** trae todas las mesas, **también las desactivadas**: número, capacidad, estado (libre u ocupada), si está activa, su **enlace** (`carta.html?m=<mesa>&k=<token>`, con «Copiar enlace») y cuándo se **escribió** y se **revisó** por última vez su pegatina.
- **Agregar mesa** (`mesa_crear(id, capacidad)`): el número y la capacidad; el token nace del default de la base. Responde `ya_existe` si el número ya está. **Editar la capacidad** (`mesa_editar`). El número no se cambia.
- **Desactivar o activar** (`mesa_activar(id, activa)`). Una mesa **desactivada** sale del mapa del salón (no del panel), su enlace responde «inválido» (la Edge Function `cuenta`; la carta le dice a quien la toque que el enlace ya no sirve y que pida ayuda a un mesero) y no se le puede avisar (`alertar_cuenta` la rechaza). No se puede desactivar una mesa con una cuenta abierta (`con_cuenta_abierta`). **Las mesas no se borran:** las órdenes apuntan a ellas y la clave foránea no tiene cascade. Reactivar una mesa devuelve su pegatina a la vida sin reescribirla.
- **Rotar el token** sigue como hoy: solo admin (`rotarTokenMesa`, frenado en la base por `trg_mesas_token_solo_admin`), e invalida la pegatina actual.
- **Escribir la pegatina** desde el POS con Web NFC (`NDEFReader.write` con un registro de tipo URL): solo **Chrome para Android**, con HTTPS, NFC encendido y un toque del usuario. Al terminar marca la pegatina como «escrita» (`pegatina_marcar`). **Nunca** `makeReadOnly`: bloquearía la pegatina para siempre. Sin NFC (iPhone, otro navegador): «Copiar enlace» y NFC Tools.
- **Revisar la pegatina** (`NDEFReader.scan`): compara que la URL leída sea **exactamente** el enlace de esa mesa y del dominio del restaurante; solo si coincide la marca como «revisada» (`pegatina_marcar`).
- **La contraseña PWD/PACK de la pegatina (D16) no se pone desde Web NFC:** va con NFC Tools. Por qué existe, cómo se pone y por qué **nunca** se bloquea para siempre: `docs/pegatinas.md`.
- Las cuatro funciones de la base (`mesa_crear`, `mesa_editar`, `mesa_activar`, `pegatina_marcar`) son solo de admin y responden `{ok, codigo?}`.

### Ajustes del ticket (ola C: listo en ramas, **no está al aire**)

Pedido de Yonatan: «código de barras parametrizable en el panel de admin porque puede cambiar el dominio». Vista **Ajustes**, sección «Ticket», solo para el admin: la dirección que lleva el **QR del ticket** (`ticket_qr_url`), si el QR sale (`ticket_qr_visible`) y el **pie** (`ticket_pie`, «Gracias por su visita» por defecto). Reemplaza el QR estático de la rama `pos-pie`: el POS **dibuja el QR en el navegador** con una librería chica fijada por versión exacta y servida desde `assets/vendor/` (§03), y si esa librería no carga el ticket sale **sin QR**, nunca roto. La dirección debe empezar por `https://` y tener hasta 200 caracteres: lo valida el POS y lo impone la base (un `check`). La lee todo el personal aprobado; la escribe solo un admin. El QR del ticket lleva a la landing: no muestra datos de pago.

### Deshacer un cobro (ola C: listo en ramas, **no está al aire**)

Pedidos de Yonatan: «si pagué una parte de una cuenta y la quiero deshacer, si ese pago fue de esa mesa se debería poder editar y devolver a la mesa, por ende recalcular» (2026-09-30) y «**el pedido se podrá deshacer cuando quiera el mesero o el admin**» (2026-10-01). Se acabó el límite de tiempo que tenía el mesero. `deshacer_cobro(orden_id)` deshace tres clases de cobro del **turno abierto**:

- **Un cobro parcial** (por ítems o por unidades) y **un abono** crean una orden **cerrada** que apunta a la orden abierta de la que salieron (`ordenes.parcial_de`). Deshacerlos los **devuelve a la cuenta de la misma mesa**: cada ítem vuelve con su mismo id, nombre, precio y nota (se le suma a la línea si sigue); un abono quita su línea «Abono recibido», y solo si la cuenta la trae **exactamente** así (una línea, cantidad 1, precio igual al opuesto del abono: si alguien la editó, no se devuelve y no se inventa un monto).
- **El cobro completo de una mesa** (sin `parcial_de`): si la mesa está **libre**, la misma orden se **reabre** en ella (la mesa vuelve a «ocupada»); si la mesa **ya tiene otra cuenta abierta**, sus ítems **pasan a esa cuenta** y la cerrada se borra (los abonos que habían salido de ella pasan a apuntar a la cuenta que los recibe, y siguen siendo devolvibles).
- **Cómo se ofrece:** (1) justo después de cobrar (por partes o la mesa completa), un aviso «Cobrado $ X · Deshacer» de unos 15 segundos; (2) en el cierre, en «Transacciones del turno»: «Devolver a la cuenta de Mesa N» (parcial y abono), «Deshacer · reabrir la Mesa N» o «Deshacer · pasar a la cuenta de Mesa N» (la mesa completa), con una confirmación dentro de la página que dice qué vuelve y cómo queda la cuenta. Sin red no se ofrece: necesita la base.
- **Qué hace**, en una sola transacción con candado (sobre los cobros que salieron de la orden, la orden, la mesa y la cuenta abierta, siempre en ese orden: sin interbloqueo): vuelve los ítems, recalcula `total` y `version`, y **borra la orden cerrada** (o la reabre). Como el cobro desaparece, **las ventas de hoy y el cierre del día cuadran solos**. El monto que devuelve es **lo que de verdad volvió a la cuenta**, no el total de la cerrada. La cuenta en vivo de la carta se actualiza con la señal de siempre (una sola). Un segundo toque responde `no_existe`: no devuelve dos veces.
- **Quién y cuándo:** el **admin y el mesero, en cualquier momento**, mientras el cobro siga en el turno abierto (todavía no esté archivado en un cierre del día: el cierre borra las órdenes que archiva, y si la purga está en camino responde `ya_en_cierre`). Una cuenta sin rol, nunca (`no_autorizado`). **Editar en el sitio y eliminar una venta cerrada siguen siendo solo del admin**; deshacer es otra cosa, y por eso es una RPC con permisos propios y no un `delete` suelto: el mesero **no** tiene permiso de editar ni borrar órdenes cerradas (SDD §02.3, nota 5).
- **Cuándo no se puede:** `cuenta_ya_cerrada` (el parcial o abono salió de una cuenta que ya se cobró completa: deshaz primero el cobro de la mesa), `no_es_parcial` (de otra mesa que la cuenta, un abono de antes sin cuenta —se corrige editándolo sin mesa, admin— o un abono que ya no cuadra), `mesa_inactiva` (la mesa se desactivó: se activa y se vuelve a intentar) y `ya_en_cierre`.
- **Trazabilidad, no un freno** (decisión de Yonatan): cada deshacer deja una fila en la tabla **`deshechos`** (orden, mesa, tipo —`parcial`, `abono` o `completo`—, monto, los ítems, quién —el correo de la sesión de Google— y cuándo —la hora del servidor—). Solo la escribe `deshacer_cobro` (nadie tiene INSERT) y **solo el admin la lee**. El cierre del día le enseña al admin **«Cobros deshechos hoy: N · $ X»** con la lista (quién, mesa, monto, hora); «hoy» es el turno: lo que todavía no cuelga de ningún cierre (`cierre_id` null; lo pone `cerrar_dia` al cerrar, así que no depende del reloj de ninguna tablet), y cada día del historial cuenta los suyos. Se guarda **90 días** (al guardar un cierre del día se borra lo más viejo). Es un dato personal (el correo de quien lo hizo): `privacy.html` lo dice.

### El cierre del día lo decide la base, y los deltas llevan un id (ola C, ronda 5: listo en ramas, **no está al aire**)

Las dos rondas anteriores trajeron casi tantas regresiones propias como hallazgos nuevos, y todas nacían de lo mismo: el cierre del día comparaba una **foto de la tablet** y además se podía cerrar **sin red** y subir después. Esta ronda no parchó esa máquina: la simplificó.

- **El cierre lo decide la base** (`cerrar_dia(p_id, p_esperado)`, solo admin, una transacción con el candado de aviso común con `deshacer_cobro`). Ya no recibe la lista de la tablet: toma **todas** las ventas cerradas que ningún cierre se llevó (también las de ayer que nadie cerró), rechaza si queda una cuenta abierta (`hay_abiertas`), arma el cierre, lo guarda, borra lo que archiva, purga los ids de deltas que ya no tienen orden y le pone su `cierre_id` a los deshechos del turno. **Nunca borra una cuenta abierta.** Para que el admin firme lo que ve, el POS manda lo que espera (`p_esperado`: cuántas ventas, cuánto y cuáles); si la base tiene otra cosa responde `cambio` con su resumen (sin guardar ni borrar nada) y el POS vuelve a mostrar la confirmación con **los números de la base** («Los números cambiaron mientras mirabas… Sí, cerrar así»). La hora del cierre es la del servidor. (El método de pago solo se guarda en las líneas de abono: una venta normal no lo lleva, así que el cierre no trae un total por método más que `abonos_por_metodo` en el resumen.)
- **No hay cierre sin red.** «Cerrar día» solo se habilita con conexión y con la cola vacía (sin deltas, filas ni cierres editados sin subir); si no, el botón se apaga y dice «Sin conexión…» o «Hay N cambios sin subir: espera a que suban» (con «Reintentar subir»). Se fue el camino del cierre «Sin respaldo» para los cierres nuevos y todo lo que existía solo por él (`sinSubir`, `_cierreRechazado`, el archivo local antes de que la base conteste). Un cierre «Sin respaldo» **viejo** que haya quedado en el `localStorage` (del POS de la ronda 4 o del de la ola B) se resuelve al arrancar: sus ventas que la base no tiene se suben como cobros normales, el cierre local se descarta y se le pide al admin cerrar de nuevo con red; **nunca se purga nada a partir de él**.
- **Una venta nunca entra en dos cierres:** la tabla interna `cierre_ordenes` (`orden_id` es la clave primaria) la mantiene un disparador de `cierres`; un segundo cierre con una venta ya archivada se rechaza (`RS004`) y una venta cerrada ya archivada que se vuelve a subir se descarta en silencio.
- **Deltas idempotentes:** `aplicar_delta_orden` gana `p_delta_id` (opcional). El POS le pone un id a cada delta al encolarlo y lo reenvía igual en cada reintento; la base lo anota en `deltas_aplicados` dentro de la misma transacción y, si ya estaba, no aplica nada. Una cuenta cobrada sin red sube con los ítems de los deltas que nunca se mandaron: la fila lleva sus ids en `ordenes.deltas_ids` y el guardia los anota en la misma transacción que la fila. Con eso, reenviar un delta cuya respuesta se perdió ya no lo duplica (era el límite admitido de la ronda anterior).
- **El POS sabe qué trae la base** (`_sondearBase`): pregunta por `ordenes.parcial_de` (el guardia de `version`) y `ordenes.deltas_ids` con una lectura de cero filas, así que no depende de que haya órdenes cargadas. Sin un sí confirmado no manda `version`; sin los ids, cae al camino de antes.
- **Un POS viejo sin recargar no corrompe nada con la base nueva:** además, un guardia de DELETE (`trg_ordenes_guardia_borrar`) no deja que la API borre una cuenta abierta con ítems, así que el cierre del día de una tablet con el POS viejo (guardar el cierre con su foto y borrar por id) ya no se lleva la cuenta que otro dispositivo reabrió con «Deshacer»; el cierre que guarda esa tablet queda anotado en `cierre_ordenes`, así que esas ventas no se cuentan dos veces.

### Cerrar con lo que se vio (ola C: listo en ramas, **no está al aire**)

Refutación de la ola C, hallazgo 4: una tablet que estuvo sin red cobraba la mesa con los ítems que veía y **pisaba lo que otra tablet había devuelto** con «Deshacer» (44.000 de 49.000 consumidos quedaban sin cobrar ni registrar). Ahora el UPDATE que pasa una orden de abierta a cerrada lleva la `version` que la tablet vio, y el disparador `trg_ordenes_guardia` lo **rechaza con `RS003`** si la base tiene otra. El POS anota la `version` que la base le contesta tras cada delta y **espera a los deltas en vuelo antes de cerrar** (así no hay falsas alarmas propias); si de todas formas la cuenta cambió, deja la cuenta abierta y la mesa ocupada, la vuelve a leer y avisa «La cuenta cambió, revísala: … No se cobró nada». Quien no manda `version` (una caché vieja) no se frena.

### Verificación en modo prueba (Google Cloud)

Mientras el proyecto de Google Cloud esté en modo "Testing", solo pueden loguearse cuentas agregadas manualmente en **Audience → Test users** (límite de 100). Publicar la app a producción quita ese límite; como solo se usan scopes básicos (email/perfil), normalmente no exige la revisión larga de Google reservada a scopes sensibles.

**Decisión (2026-09-30): sí se saca de Testing, pero solo con la ola C al aire** (paso 6 de arriba). Sin la compuerta, «publicar» y «cualquier Gmail entra al POS» son lo mismo: la RLS de antes solo exigía el proveedor Google. La compuerta ya cierra el acceso a los datos, y el modelo de aprobación hace que quien llega sin permiso quede pendiente y solo vea el mapa y la carta, en vez de un callejón sin salida. Es una decisión de identidad y la ejecuta Yonatan.

### Lo único que `anon` puede leer: la carta y su cuenta (2026-09-06)

La carta pública de las pegatinas NFC (`carta.html`) no toca las 4 tablas. Sus dos puertas, ambas en `supabase/`:

| Puerta | Qué expone | Por qué es segura |
|---|---|---|
| Vista `carta_publica` (SECURITY DEFINER a propósito, como las policies de `menus`) | `categoria, nombre, precio, descripcion` de `productos` con `activo and en_carta` | `anon` solo tiene `SELECT` sobre la vista; `productos` sigue sin policies para `anon`. El advisor la lista como `security_definer_view`: es el diseño. |
| Edge Function `cuenta` (`GET ?m=<mesa>&k=<token>`, `--no-verify-jwt` como `votar`) | Solo la orden `abierta` de esa mesa: ítems (nombre, precio, cantidad), total, hora | Valida el par `(mesas.id, mesas.token)` con service-role; token de 48 hex por mesa, rate-limit por IP. **Ola C:** además exige que la mesa esté **activa**; una mesa desactivada responde igual que un token malo («enlace inválido», 404), para no revelar cuál de las dos cosas es. Fuga aceptada: quien guardó el enlace ve la cuenta del siguiente ocupante mientras esté abierta; el mesero rota el token desde "Enlace NFC" en la vista de la orden (con roles, la rotación es solo del admin). |

La pegatina de cada mesa lleva `https://resplandor.ynt.codes/carta.html?m=<mesa>&k=<token>`; el POS lo muestra, lo copia y lo rota. Sin `k` válido la carta no muestra el control "Mi cuenta".

**Cuenta en vivo y «Pagar» (ramas, sin desplegar).** Con la fase 1 de [`docs/sdd-cuenta-en-mesa.md`](docs/sdd-cuenta-en-mesa.md) la carta recibe los cambios por un canal de Realtime cuyo tópico sale de `sha256(token)` y cuyo mensaje va vacío (la carta vuelve a leer `cuenta`); con la ola A, el botón «Pagar» (detrás del interruptor `pagarEnMesa` de `assets/js/local.js`, apagado) hace `POST` a la Edge Function `alerta` (`--no-verify-jwt`, solo ejecuta `alertar_cuenta`), que crea una alerta para el personal. **La página nunca muestra datos bancarios ni un QR para pagar**: el mesero lleva el QR impreso o dice los datos, cobra y cierra en el POS. Ninguna de las dos funciones se ofrece a agentes (WebMCP, MCP, `llms.txt`). Una línea de abono (precio negativo) se ve en la cuenta como abono, con signo menos, y el total es lo que queda.

`menu.html` crea su cliente de Supabase **sin sesión** (`persistSession: false`): comparte origen, y por lo tanto `localStorage`, con el POS, y con la compuerta una tablet con la sesión de alguien que no está en `personal` vería la votación sin menús.

---

## 08 — Contrato de datos

| Tipo | Operación | Descripción |
|------|-----------|-------------|
| `AUTH` | `store.iniciarSesionGoogle()` | Redirige a Google OAuth vía Supabase Auth |
| `AUTH` | `store.cerrarSesion()` | Cierra sesión y limpia `usuario` |
| `ACTION` | `store.abrirMesa(mesaId)` | Crea orden vacía; si la BD rechaza por duplicado, adopta la orden real (`resolverConflictoDeMesa`) |
| `ACTION` | `store.agregarItem(...)` / `quitarItem(itemId)` | Modifican la orden activa |
| `ACTION` | `store.facturar()` | Cierra orden, libera mesa, genera ticket |
| `ACTION` | `store.cerrarDia()` | Genera `CierreDiario`, purga órdenes archivadas de Supabase, reintenta si falla |
| `CRUD` | `store.productos` | CRUD completo, restringido a `authenticated` por RLS |
| `REALTIME` | Canal `pos_sync` | Escucha `postgres_changes` en `mesas`, `ordenes`, `productos` |
| `REALTIME` | Canal `presencia_pos` | `track()` de `{mesaId, deviceId, nombre}`; no toca Postgres |
| `RPC` (ola B) | `mi_rol()`, `mi_correo()` | El rol (`admin` \| `mesero` \| `null`) y el correo de Google de quien llama; el POS decide qué mostrar |
| `RPC` (ola B) | `personal_alta(p_email, p_nombre, p_rol)`, `personal_baja(p_email)`, `personal_cambiar_rol(p_email, p_rol)` | Gestión del personal, solo admin; responden `{ok, codigo?}` (`ultimo_admin`, `ya_existe`, `no_autorizado`…) |
| `RPC` (ola B) | `atender_alerta(p_id)`, `descartar_alerta(p_id)` | El personal resuelve una alerta pendiente; si otra tablet llegó antes, `{ok:false, codigo:'no_pendiente'}` |
| `RPC` (ola B, solo `service_role`) | `alertar_cuenta(p_mesa, p_token, p_metodo)` | La única puerta de escritura del cliente de la pegatina: la ejecuta la Edge Function `alerta` |
| `RPC` (ola C) | `solicitar_acceso()` | Quien entra con Google pide acceso: crea su fila pendiente. Responde `{estado: 'pendiente' \| 'aprobado' \| 'eliminado', rol}`; una persona eliminada no se resucita |
| `RPC` (ola C) | `vista_pendiente()` | Lo único que ve un pendiente: `id`, `capacidad` y `estado` de las mesas activas. Sin token, totales ni órdenes |
| `RPC` (ola C) | `personal_aprobar(p_email, p_rol)`, `personal_eliminar(p_email)` | Solo admin; responden `{ok, codigo?}` y nunca dejan la tabla sin un admin aprobado y activo |
| `RPC` (ola C) | `mesa_crear(p_id, p_capacidad)`, `mesa_editar(p_id, p_capacidad)`, `mesa_activar(p_id, p_activa)`, `pegatina_marcar(p_id, p_tipo, p_token)` | Panel de Mesas y pegatinas, solo admin; `ya_existe`, `con_cuenta_abierta`; `p_tipo` es `'escrita'` o `'revisada'`; `p_token` es el que **de verdad se escribió o se leyó**: si la mesa ya tiene otro (giraron el enlace mientras tanto) responde `enlace_cambio` y no marca nada. La capacidad va de 1 a 50 (`mesas_capacidad_rango`) |
| `RPC` (ola C) | `deshacer_cobro(p_orden_id)` | Deshace un cobro del turno: un parcial o un abono vuelven a la cuenta de la misma mesa; el cobro completo reabre la mesa o pasa a la cuenta que ya tiene. Admin y mesero, **sin ventana**. `{ok, tipo, total_abierta, orden_id, mesa_id, monto, version, reabierta, fusionada}` o `{ok:false, codigo}`: `cuenta_ya_cerrada`, `no_es_parcial`, `mesa_inactiva`, `ya_en_cierre`, `no_autorizado`, `no_existe`, `ya_reabierta`, `mesa_ocupada`. Deja su fila en `deshechos` |
| `RPC` (ola C) | `cerrar_dia(p_id, p_esperado)` | El cierre del día lo decide la base (solo admin, una transacción): toma **todas** las ventas cerradas que ningún cierre se llevó, rechaza si hay una cuenta abierta o si lo que el POS espera (`p_esperado`: `{n, total, ids}`) no es lo que hay, guarda el cierre, borra lo que archiva y marca los `deshechos` del turno con el id del cierre. **Nunca borra una cuenta abierta.** `{ok, repetido, n, total, borradas, cierre, deshechos}` o `{ok:false, codigo}`: `no_autorizado`, `invalido`, `hay_abiertas`, `sin_ventas`, `cambio` (con el `resumen` de la base) |
| `TABLE` (ola C) | `deshechos` | Cada cobro deshecho: orden, mesa, tipo, monto, ítems, quién (correo) y cuándo. Solo la escribe `deshacer_cobro`; solo el admin la lee; 90 días |
| `ACTION` (ola C) | `deshacerUltimoCobro()`, `devolverACuenta(ordenId)`, `cargarDeshechos()` | El aviso «Cobrado $ X · Deshacer» (15 s), «Devolver a la cuenta / Deshacer el cobro» en «Transacciones del turno» y «Cobros deshechos hoy» en el cierre |
| `ACTION` (ola C) | `guardarAjustes(cambios)`, `cargarAjustes()` | Ajustes del ticket (dirección del QR, QR visible, pie); solo admin escribe |
| `ACTION` (ola B) | `facturarParcial` (ítems o unidades) y el cobro por monto | Cobran una parte: una orden cerrada nueva («Abono · Mesa N» si es por monto) y, en la orden abierta, un delta negativo de unidades o una línea «Abono recibido» de precio negativo (`aplicar_delta_orden`). La mesa sigue abierta |

---

## 09 — Flujos principales

### Flujo 0 — Login (nuevo)

1. El dispositivo abre la app → ve la pantalla "Continuar con Google" si no hay sesión.
2. Tras loguearse, Supabase redirige de vuelta a la misma URL con la sesión activa.
3. La app arranca: carga caché local, sincroniza con Supabase, abre los canales Realtime.

### Flujo A — Pedido completo (sin cambios de fondo, con protección nueva)

1. **Seleccionar mesa** — si dos meseros la abren casi al mismo tiempo, la base de datos garantiza que solo una orden gane; el segundo dispositivo adopta la orden real automáticamente, sin duplicar nada.
2. **Agregar ítems** / **ítem manual** — igual que antes.
3. **Ver aviso de presencia** — si otro dispositivo también tiene la mesa abierta, aparece un banner con su nombre antes de facturar.
4. **Facturar** — genera ticket, libera la mesa, libera la presencia.

### Flujo B — Cierre del día

Sin cambios de flujo para el usuario; internamente, si falla la subida del cierre, queda en cola (`colaPendiente`) con reintento automático cada 20s y al recuperar conexión.

---

## 10 — Sincronización multi-dispositivo

### Mecanismos vigentes

| Mecanismo | Qué resuelve |
|---|---|
| **Postgres Changes** (`pos_sync`) | Refleja cambios de fila entre dispositivos (abrir mesa, agregar ítem, facturar) |
| **Cola `colaPendiente`** | Si falla la subida de un cierre, no se pierde — se reintenta automáticamente |
| **`cerrarDia()` purga `ordenes`** | Evita que órdenes archivadas "reaparezcan" fantasma en otro dispositivo al recargar |
| **Índice único `mesa_id + 'abierta'`** | Garantiza a nivel de base de datos que nunca haya dos órdenes abiertas para la misma mesa |
| **`resolverConflictoDeMesa()`** | Cuando la base de datos rechaza una orden duplicada, el dispositivo perdedor adopta la orden ganadora sin intervención del mesero |
| **Realtime Presence** | Visibilidad humana de "quién más está aquí", complementaria (no sustituye) a la garantía de la base de datos |

### Principio

Desde el incidente de mesas duplicadas, la regla es: **cualquier invariante de negocio que dependa de "solo debería pasar una vez" se refuerza en Postgres, no solo en el cliente.** El cliente puede tener bugs, race conditions o quedarse con caché vieja; la base de datos es la última línea de defensa.

---

## 11 — Incidentes resueltos

Esta sección documenta bugs reales encontrados en producción, para que no se repitan.

### 11.1 — Fuga de datos por policies `anon` legacy

**Síntoma:** un `fetch` sin login a la tabla `cierres` devolvía datos de ventas reales.
**Causa:** la tabla `cierres` existía desde antes de la migración completa a Supabase, con policies (`cierres_select_publico`, `cierres_insert_publico`) que la migración de seguridad no detectó por tener nombres distintos a los esperados.
**Fix:** se eliminaron esas policies; hoy las 4 tablas solo tienen acceso para `authenticated`.
**Lección:** al migrar políticas de seguridad, verificar el nombre real de las policies existentes (`pg_policies`), no asumirlo por el nombre usado en un script anterior.

### 11.2 — Órdenes duplicadas por condición de carrera

**Síntoma:** una misma mesa mostraba pedidos distintos en dos dispositivos (uno con ítems, otro vacío); coincide con reportes previos de "órdenes vacías duplicadas" en exportes de la tabla.
**Causa:** `abrirMesa()` confiaba en el estado local (`mesa.estado === 'libre'`) para decidir si crear una orden nueva. Si dos dispositivos leían "libre" antes de que la primera escritura propagara, ambos creaban una orden nueva para la misma mesa.
**Fix:** índice único parcial en `ordenes(mesa_id) WHERE estado = 'abierta'` + manejo de conflicto en el cliente (`resolverConflictoDeMesa`) que adopta la orden ganadora.
**Lección:** ninguna invariante de "solo uno a la vez" puede depender solo de lógica de cliente en un sistema multi-dispositivo.

### 11.3 — Bindings snake_case filtrados al template

**Síntoma:** el total de una mesa ocupada nunca aparecía en el mapa de mesas; la hora de apertura de la orden siempre mostraba la hora actual; "Transacciones del turno" mostraba el número de mesa en blanco.
**Causa:** 5 lugares del HTML leían `mesa_id` / `abierta_en` / `cerrada_en` directo sobre objetos ya convertidos a camelCase por `parseOrden()`.
**Fix:** corregidos a `mesaId` / `abiertaEn` / `cerradaEn`.
**Lección:** el boundary camelCase ↔ snake_case (sección 04) es fácil de romper por copiar-pegar de un objeto crudo de Supabase; revisar siempre contra qué objeto está apuntando un `x-text` antes de nombrar el campo.

---

## 12 — Fases de desarrollo

| Fase | Estado |
|------|--------|
| 1 — UI Kit & Design System | ✅ Completa |
| 2 — Gestión de Menú (CRUD productos) | ✅ Completa |
| 3 — Motor de Pedidos | ✅ Completa |
| 4 — Facturación & Ticket | ✅ Completa |
| 5 — Cierre & Reportes | ✅ Completa |
| 6 — Migración a Supabase (Postgres + Realtime) | ✅ Completa |
| 7 — Confiabilidad de sincronización (colas, reintentos, purga) | ✅ Completa |
| 8 — Realtime Presence | ✅ Completa |
| 9 — Login con Google + RLS | ✅ Completa |
| 10 — Fix de condición de carrera (mesas duplicadas) | ✅ Completa |
| 11 — Fotos de producto (Supabase Storage) | ⏳ Pendiente |
| 12 — Resumen de cierre con IA | ⏳ Pendiente |
| 13 — Roles diferenciados (admin vs. mesero) | 🔧 La **compuerta ya está al aire** (2026-09-30, con Yonatan como único admin). Listos en ramas y probados en local: los permisos por rol, las alertas y el POS de la ola B; **faltan por salir**, con el GO de Yonatan y en el orden de §07 |
| 14 — Aprobación del personal, mesas y pegatinas, ticket configurable y deshacer cobros (ola C) | 🔧 Listo en ramas y probado en local; **sale después de la ola B**, con el GO de Yonatan y en el orden de §07. Google sale de Testing solo con esta ola al aire |

---

## 13 — Decisiones fijas

| Área | Decisión | Razón |
|------|----------|-------|
| **Estructura** | Single-file HTML | Sin build, sin servidor propio |
| **Scripts de terceros** | Archivos locales de versión fija en `assets/vendor/`, nunca un CDN ni una versión flotante (`pos-sin-cdn.test.mjs` lo vigila) | Si la red del teléfono no alcanzaba un CDN, el POS quedaba sin estilos y sin funciones (2026-10-01). Las fuentes de Google siguen siendo externas: si fallan, cae a la tipografía de respaldo |
| **Persistencia** | Híbrida: localStorage (caché/cola) + Supabase (verdad) | localStorage solo ya no basta con múltiples dispositivos |
| **Login** | Google OAuth obligatorio, para toda la app | Es la base para que RLS pueda cerrar el acceso anónimo |
| **Seguridad** | RLS restringido a `authenticated`, cero acceso `anon` | La anon key es pública por diseño; el control real vive en las policies |
| **Concurrencia** | Invariantes "solo uno a la vez" se refuerzan en Postgres (constraints/índices), nunca solo en el cliente | Ver incidente 11.2 |
| **Reactividad** | Alpine.js v3 | Sin cambios respecto a v1.0 |
| **IDs** | `crypto.randomUUID()` / equivalente propio (`uid()`) | Sin cambios |
| **Precio** | COP, sin decimales | Sin cambios |
| **Acceso** (ola B) | Cuenta de Google **y** fila activa en `personal`, con rol `mesero` o `admin`; la base hace cumplir los permisos | La compuerta cierra el hueco de «cualquier cuenta de Google» y permite sacar Google de Testing (§07) |
| **Caja** (ola B) | Caja = admin; el cierre del día es solo del admin | Yonatan, 2026-09-30. Un tercer rol solo si aparece un cajero que no deba tocar catálogo, menú ni personal |
| **Catálogo** (ola B) | El mesero crea y edita productos; borrar es del admin | Yonatan, 2026-09-30 |
| **Propina** | No se pide, no se sugiere ni se registra, en ningún lado | Yonatan, 2026-09-30: «eso no se hace acá» |
| **Pagar** (ola A y B) | El cliente elige el método y eso solo **avisa** al personal; ninguna página muestra datos bancarios ni un QR para pagar; el mesero cobra y cierra en el POS | Un clon de la pegatina no puede mostrar «la llave correcta» de una página que no la tiene |
| **Aprobación del personal** (ola C) | Quien entra con Google pide acceso y queda **pendiente**; un admin lo aprueba (mesero o admin) o lo elimina. Un pendiente solo ve el mapa de mesas y la carta | Yonatan, 2026-09-30: «si no se aprueba solo podrá ver, no podrá hacer nada más». Reemplaza el alta solo por correo y deja sacar Google de Testing sin abrir el POS a cualquier Gmail |
| **Google fuera de Testing** | Solo con la ola C al aire | Yonatan, 2026-09-30. La compuerta sola deja un callejón sin salida; con la aprobación, el pendiente ve el mapa y la carta |
| **Mesas y pegatinas** (ola C) | El admin crea, edita, desactiva y rota mesas, y escribe y revisa la pegatina desde el POS con Web NFC. Las mesas no se borran: se desactivan. Nunca `makeReadOnly`. La contraseña PWD/PACK (D16) va con NFC Tools | Yonatan, 2026-09-30: «debemos poder añadir y editar pegatinas». Bloquear una pegatina para siempre impediría rotarla |
| **Ticket configurable** (ola C) | La dirección del QR, si sale y el pie se cambian desde Ajustes (solo admin); el QR se dibuja en el navegador | Yonatan, 2026-09-30: «puede cambiar el dominio» |
| **Deshacer un cobro** (ola C) | Se puede deshacer un cobro parcial, un abono o el cobro completo de una mesa: el admin **y el mesero, en cualquier momento** (sin ventana de tiempo), mientras el cobro siga en el turno | Yonatan, 2026-09-30: «tipo ctrl+z»; 2026-10-01: «el pedido se podrá deshacer cuando quiera el mesero o el admin». Editar en el sitio y eliminar una venta cerrada siguen siendo solo del admin |
| **Trazabilidad de lo deshecho** (ola C) | Cada deshacer queda en `deshechos` (quién, mesa, monto, hora) y el admin lo ve en el cierre del día: «Cobros deshechos hoy». No limita al mesero | Yonatan, 2026-10-01. Resuelve D37 (antes: «¿deja un registro?»). 90 días de retención (privacidad) |
| **Alertas** (ola C, D28) | Una alerta resuelta se borra un día después | Guarda el correo de quien la atendió: minimización (Ley 1581). `privacy.html` lo dice |
| **Cobro por partes** (ola B) | Por ítems, por unidades de una línea y por monto; el abono es una línea de precio negativo en la orden abierta | El total de la orden es lo que queda, y el cierre del día cuadra solo |

---

## 14 — Estructura del HTML

```
pos.html
│
├── <head>
│   ├── Fonts (Google) y scripts locales de assets/vendor/ (Tailwind, Alpine, Lucide, Supabase JS, qrcode-generator)
│   └── <style> — design tokens reales (sección 05), componentes, print
│
├── <body x-data x-init="$store.pos.init()">
│   ├── <script> — Alpine.store('pos', {...}) con:
│   │     Auth (usuario, iniciarSesionGoogle, cerrarSesion)
│   │     Presencia (deviceId, presenciaMesas, iniciarPresencia, actualizarPresencia)
│   │     Sync (parseX/formatX, pushASupabase, procesarCambioEnVivo)
│   │     Lógica de negocio (abrirMesa, facturar, cerrarDia, resolverConflictoDeMesa)
│   │
│   ├── [Gate] Pantalla de login — visible solo sin sesión
│   │
│   └── <div x-show="$store.pos.usuario"> — todo lo demás, solo con sesión:
│         ├── Nav (mesas/productos/cierre + badge de usuario + logout)
│         ├── Vista Mesas (con badge de presencia)
│         ├── Vista Orden (con banner de conflicto de presencia)
│         ├── Vista Ticket
│         ├── Vista Cierre
│         ├── Vista Productos
│         └── Modales (producto, ítem manual, confirmar cierre)
```

---

## 15 — Componentes

| Componente | Novedad en v2.0 |
|------------|-----------------|
| `LoginGate` | Pantalla fija que reemplaza toda la app sin sesión |
| `MesaCard` | Ahora incluye badge de presencia (punto ámbar pulsante) |
| `OrdenPanel` | Ahora incluye banner de conflicto de presencia |
| `NavBar` | Ahora incluye avatar, nombre y botón de logout |
| Resto (`CatalogoGrid`, `TicketView`, `ProductoCRUD`, `CierreView`) | Sin cambios funcionales |

---

## 16 — Checklist de producción

- [x] Login con Google funcionando de punta a punta
- [x] RLS verificado: cero acceso sin autenticar (`fetch` anónimo devuelve vacío/error)
- [x] Índice único de una orden abierta por mesa, verificado en la base real
- [x] Presence mostrando nombres reales, no dispositivos anónimos
- [x] Bindings camelCase corregidos en las 5 vistas afectadas
- [ ] Probar apertura simultánea de una mesa desde dos dispositivos reales (la garantía es de base de datos, pero vale confirmar la UX del lado perdedor)
- [x] Definir roles admin/mesero: decididos por Yonatan (caja = admin; el mesero crea y edita productos; el mesero ve ventas y cierres en solo lectura) y probados en local
- [x] Aplicar la compuerta de personal y verificar con `mi_rol()` (2026-09-30, de noche; solo con Yonatan como admin: Camila y los meseros quedan para la ola B o la C)
- [ ] Publicar el POS de la ola B y recién entonces aplicar `permisos_por_rol`
- [ ] Dar de alta a Camila y a los meseros (con el panel Personal de la ola B, o aprobándolos con la ola C)
- [ ] Ola C: aplicar las cuatro migraciones (`aprobacion_personal`, `mesas_y_pegatinas`, `ajustes_ticket`, `deshacer_cobro`), después `cuenta` y por último el POS (§07, «Arranque seguro»)
- [ ] Solo con la ola C al aire, sacar Google OAuth de Testing (D23)
- [ ] Revisar en una mesa real: escribir y revisar una pegatina desde Android, y deshacer un cobro parcial con la cuenta abierta (`docs/pegatinas.md`; SDD §12.9)
- [ ] Fotos de producto (Storage) — próxima fase
- [ ] Resumen de cierre con IA — próxima fase