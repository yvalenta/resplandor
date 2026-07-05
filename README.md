# Restaurante Resplandor POS

> **Software Design Document · v2.0 — Implementado**

Punto de venta táctil para gestión de mesas, facturación y cierre diario, con sincronización multi-dispositivo en tiempo real y acceso restringido por login de Google.
Stack: HTML + Tailwind CDN + Alpine.js + Lucide Icons + Supabase (Postgres + Realtime + Auth).

| Versión | Estado | Stack | Actualizado |
|---------|--------|-------|-------------|
| 1.0 — Open Spec | Definición inicial (solo localStorage, sin backend) | HTML · Tailwind · Alpine.js | Junio 2026 |
| **2.0 — Implementado** | **En producción, uso diario del restaurante** | **+ Supabase (Postgres · Realtime · Auth)** | **Julio 2026** |

La diferencia entre v1.0 y v2.0 no es cosmética: el plan original dejaba explícitamente **fuera de alcance** un backend real y la autenticación (ver v1.0, sección 02). La operación real con varios dispositivos en simultáneo hizo necesario sumar ambas cosas. Este documento describe lo que **realmente existe hoy** en `index.html`, no el plan original.

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

Una aplicación web táctil, **single-file** (`index.html`, sin build step), que gestiona el flujo completo de un turno de restaurante: login del personal, mapa de mesas, toma de pedidos, facturación y cierre diario — sincronizado en tiempo real entre todos los dispositivos del local (tablets de meseros, caja, administración).

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

- [ ] Roles diferenciados (admin vs. mesero) — hoy cualquier cuenta de Google autorizada tiene acceso total
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

El plan v1.0 asumía un solo dispositivo por turno. En la práctica, un restaurante tiene varios meseros con tablets simultáneas — sin una fuente de verdad remota y sincronización en tiempo real, dos meseros facturando la misma mesa es un riesgo real de negocio, no un detalle técnico. Supabase se eligió porque no rompe la regla de "cero build step": todo se consume por HTTP/WebSocket desde el mismo `index.html`, sin bundler ni servidor propio.

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

### Paleta de colores (real, tal como está implementada en `:root` y `tailwind.config`)

| Token | Hex | Uso |
|-------|-----|-----|
| `--ember` | `#B5341C` | Acción principal, facturar, alertas |
| `--teal` | `#2A7B72` | Confirmación, mesa libre |
| `--amber` | `#C08B2C` | Totales, precios, destacados |
| `--parch` | `#F7F2EC` | Fondo de página (antes "surface") |
| `--ink` | `#1C1A17` | Texto base |
| `--card` | `#FFFFFF` | Cards y paneles |

> Nota: esta paleta reemplazó a la definida en v1.0 (`Ember #C0392B`, `Gold #B7860B`, `Jungle #1A5C38`) durante la fase de UI Kit. Si ves referencias a "Gold" o "Jungle" en documentación vieja, son las mismas funciones que hoy cumplen `--amber` y `--teal`.

### Tipografía

Sin cambios respecto a v1.0: **Fraunces** (display) + **DM Sans** (body).

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

### Verificación en modo prueba (Google Cloud)

Mientras el proyecto de Google Cloud esté en modo "Testing", solo pueden loguearse cuentas agregadas manualmente en **Audience → Test users** (límite de 100). Publicar la app a producción quita ese límite; como solo se usan scopes básicos (email/perfil), normalmente no exige la revisión larga de Google reservada a scopes sensibles.

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
| 13 — Roles diferenciados (admin vs. mesero) | ⏳ Pendiente |

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

---

## 14 — Estructura del HTML

```
index.html
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
- [ ] Definir roles admin/mesero si se necesita restringir Productos o Cierre a ciertas cuentas
- [ ] Fotos de producto (Storage) — próxima fase
- [ ] Resumen de cierre con IA — próxima fase