# Restaurante Resplandor POS

> **Software Design Document · v2.0 — Implementado**

Punto de venta táctil para gestión de mesas, facturación y cierre diario, con sincronización multi-dispositivo en tiempo real y acceso restringido por login de Google.
Stack: HTML + Tailwind CDN + Alpine.js + Lucide Icons + Supabase (Postgres + Realtime + Auth).

| Versión | Estado | Stack | Actualizado |
|---------|--------|-------|-------------|
| 1.0 — Open Spec | Definición inicial (solo localStorage, sin backend) | HTML · Tailwind · Alpine.js | Junio 2026 |
| **2.0 — Implementado** | **En producción, uso diario del restaurante** | **+ Supabase (Postgres · Realtime · Auth)** | **Julio 2026** |

> **Dónde vive cada página** (desde el 2026-09-29): la raíz `https://resplandor.ynt.codes/` es la landing pública (`index.html`); el POS que describe este documento vive en `/pos.html` (uso interno: `noindex` y `Disallow` en `robots.txt`); `landing.html` solo redirige a la raíz para no romper enlaces ya publicados; la carta NFC y el menú siguen en `/carta.html` y `/menu.html`. Detalle en `docs/landing-y-agentes.md`.

> **Estado de los roles y las alertas (2026-09-30):** la compuerta de personal, los permisos por rol (mesero y admin), las alertas de «pedir la cuenta» y el cobro por monto y por unidades están **diseñados y probados en local, en ramas, y NO están al aire**. Aplicarlos es de Yonatan, en el orden de §07. Hasta entonces, lo que describen las secciones de abajo como «hoy» sigue siendo cierto en producción; lo nuevo va marcado con «ola B». El diseño completo está en [`docs/sdd-cuenta-en-mesa.md`](docs/sdd-cuenta-en-mesa.md).

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

- [ ] Roles diferenciados (admin vs. mesero) y compuerta de personal — **listos en ramas y probados en local, sin aplicar en producción**: hoy cualquier cuenta de Google que pase el login tiene acceso total (ver §07, «Modelo de acceso por roles»)
- [ ] Alertas de «pedir la cuenta» en el POS, y el cobro por monto y por unidades de una línea (ola B, en ramas)
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
| **Tailwind CSS CDN** | Utilidades + design tokens |
| **Lucide Icons** | SVG íconos vía CDN |
| **Fraunces + DM Sans** | Tipografía display / body (Google Fonts) |
| **Supabase Postgres** | Fuente de verdad remota (`productos`, `mesas`, `ordenes`, `cierres`) |
| **Supabase Realtime — Postgres Changes** | Sincroniza cambios de fila entre dispositivos |
| **Supabase Realtime — Presence** | Quién tiene abierta cada mesa, en vivo, sin tocar Postgres |
| **Supabase Auth (Google OAuth)** | Login obligatorio, única puerta de entrada a la app |
| **Row Level Security (RLS)** | Control de acceso real — reemplaza la confianza en el secreto de la anon key |
| **localStorage** | Caché de lectura + cola de sincronización offline |
| **window.print()** | Ticket imprimible |

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

Con la ola B, tras el login el POS pregunta su rol a la base (`mi_rol()`) y el store suma `esAdmin` y `tieneAcceso`; una cuenta sin fila activa en `personal` ve «Tu cuenta no está habilitada» y no carga nada.

### Personal (ola B, aún no al aire)

Quién entra al POS y con qué rol. Una fila por correo de Google, en minúsculas. La baja es lógica.

| Campo (Postgres) | Tipo |
|---|---|
| `email` | **PK**, `text`, minúsculas y con forma de correo |
| `nombre` | `text`, hasta 80 caracteres |
| `rol` | `'admin' \| 'mesero'` |
| `activo` | `boolean` (la baja es `false`; la fila no se borra) |

Solo se escribe con las RPC `personal_alta`, `personal_baja` y `personal_cambiar_rol` (solo admin). El admin ve a todos y cada quien ve su propia fila. **Los correos reales nunca van en el repo** (es público): el alta inicial la pega Yonatan en el SQL Editor.

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

Una sola alerta pendiente por mesa (índice único parcial): un segundo toque cambia el método y la hora. La crea solo `service_role` (la Edge Function `alerta`) y la atiende el personal con `atender_alerta` o `descartar_alerta`.

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

**Qué hace cada rol.** Esconder en la interfaz es una comodidad; la regla real la pone la base: lo que un mesero no puede, la base lo rechaza aunque llame a la API a mano (con `42501` si es un `insert`, y en silencio, con 0 filas, si es editar o borrar; por eso el POS de la ola B tiene que esconderlo antes de aplicar los permisos). Una excepción, en la nota ¹.

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

¹ **La rotación del token solo la esconde el POS; la base no la impide.** El POS guarda las mesas con `upsert` y un permiso por columna no sirve (mesero y admin son el mismo rol de Postgres), así que la policy deja que cualquier persona del personal edite `mesas`, token incluido: un mesero que llame a la API a mano podría rotarlo y dejar inservible la pegatina hasta que Yonatan la reescriba con su contraseña. Cerrarlo en la base (un `BEFORE UPDATE` que conserve el token viejo si quien llama no es admin, SDD §04.5) queda como mejora pendiente. Lo que sí impide la base: renumerar una mesa (solo admin).

- **Caja = admin.** No hay un tercer rol: el cierre del día y los cierres pasados son del admin (decisión de Yonatan, 2026-09-30). Si algún día hay un cajero que no deba tocar catálogo, menú ni personal, se agrega `'caja'` al `check` de `personal.rol`.
- **El mesero sí crea y edita productos** (decisión de Yonatan, 2026-09-30): INSERT y UPDATE en `productos`, también el `upsert` del POS. Borrar sigue siendo del admin. Lo que un mesero cambie en el catálogo sale en la carta pública (`carta_publica`), la landing y el MCP.
- **El mesero ve las ventas del día y el historial de cierres, en solo lectura** (D29). Escribir en `cierres` es solo del admin.
- **Sin propina**: ni la carta, ni el POS, ni el ticket, ni el cierre la piden, la sugieren o la registran (decisión de Yonatan, 2026-09-30).
- **Nunca cero admins**: la baja o el cambio de rol que dejaría la tabla sin un admin activo se rechaza.

**Arranque seguro: el orden en que sale al aire** (todo con el GO de Yonatan y fuera del horario de servicio; el detalle y las reversas, en el SDD §02.5 y §08):

1. **La compuerta** (`20261002120000_personal_y_compuerta.sql`) junto con el **alta inicial de todo el personal actual**, admins y meseros, en la **misma transacción**. La migración se niega a correr (y no toca una sola policy) si no queda al menos un admin con una cuenta de Google real en el proyecto; quien no esté dado de alta queda afuera al instante. Se verifica con `mi_rol()` desde la sesión de un admin antes de seguir. Reversa en menos de un minuto: la cabecera de la migración vuelve a `solo_google`.
2. **Google fuera de «Testing»** (decisión D23, 2026-09-30): solo **después** de que la compuerta esté aplicada y verificada. Antes de eso, publicar la app abre el POS a cualquier cuenta de Gmail. Con la compuerta, una cuenta de Google que no esté en `personal` no ve nada, y el admin puede dar de alta a un mesero sin pasar por Google Cloud. (El SDD recomienda además apagar el proveedor de Email; no es parte de la decisión de Yonatan.)
3. **Las alertas** (`20261002130000_alertas.sql`) y la Edge Function `alerta`; y el **POS de la ola B**, que oye las alertas y ya le esconde al mesero lo del admin.
4. **Los permisos por rol** (`20261002140000_permisos_por_rol.sql`) **después** de publicar ese POS: al revés, el POS de hoy le mostraría al mesero botones que la base rechaza (y la base los rechaza en silencio, con 0 filas).

### Verificación en modo prueba (Google Cloud)

Mientras el proyecto de Google Cloud esté en modo "Testing", solo pueden loguearse cuentas agregadas manualmente en **Audience → Test users** (límite de 100). Publicar la app a producción quita ese límite; como solo se usan scopes básicos (email/perfil), normalmente no exige la revisión larga de Google reservada a scopes sensibles.

**Decisión (2026-09-30): sí se saca de Testing, pero solo después de la compuerta de personal** (paso 2 de arriba). Sin la compuerta, «publicar» y «cualquier Gmail entra al POS» son lo mismo: la RLS de hoy solo exige el proveedor Google. Es una decisión de identidad y la ejecuta Yonatan.

### Lo único que `anon` puede leer: la carta y su cuenta (2026-09-06)

La carta pública de las pegatinas NFC (`carta.html`) no toca las 4 tablas. Sus dos puertas, ambas en `supabase/`:

| Puerta | Qué expone | Por qué es segura |
|---|---|---|
| Vista `carta_publica` (SECURITY DEFINER a propósito, como las policies de `menus`) | `categoria, nombre, precio, descripcion` de `productos` con `activo and en_carta` | `anon` solo tiene `SELECT` sobre la vista; `productos` sigue sin policies para `anon`. El advisor la lista como `security_definer_view`: es el diseño. |
| Edge Function `cuenta` (`GET ?m=<mesa>&k=<token>`, `--no-verify-jwt` como `votar`) | Solo la orden `abierta` de esa mesa: ítems (nombre, precio, cantidad), total, hora | Valida el par `(mesas.id, mesas.token)` con service-role; token de 48 hex por mesa, rate-limit por IP. Fuga aceptada: quien guardó el enlace ve la cuenta del siguiente ocupante mientras esté abierta; el mesero rota el token desde "Enlace NFC" en la vista de la orden (con roles, la rotación es solo del admin). |

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
| 13 — Roles diferenciados (admin vs. mesero) | 🔧 Listo en ramas y probado en local (compuerta, permisos por rol, alertas, POS de la ola B); **falta salir al aire**, con el GO de Yonatan y en el orden de §07 |

---

## 13 — Decisiones fijas

| Área | Decisión | Razón |
|------|----------|-------|
| **Estructura** | Single-file HTML | Sin build, sin servidor propio |
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
| **Cobro por partes** (ola B) | Por ítems, por unidades de una línea y por monto; el abono es una línea de precio negativo en la orden abierta | El total de la orden es lo que queda, y el cierre del día cuadra solo |

---

## 14 — Estructura del HTML

```
pos.html
│
├── <head>
│   ├── Fonts, CDN (Tailwind, Alpine, Lucide, Supabase JS)
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
- [ ] Aplicar la compuerta de personal con el alta de **todo** el personal en la misma transacción, y verificar con `mi_rol()` (§07)
- [ ] Solo después, sacar Google OAuth de Testing (D23)
- [ ] Publicar el POS de la ola B y recién entonces aplicar `permisos_por_rol`
- [ ] Fotos de producto (Storage) — próxima fase
- [ ] Resumen de cierre con IA — próxima fase