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
- [ ] Imprimir en la térmica de la caja desde cualquier celular (cola de impresión en Supabase + un agente en el PC de la caja) — **listo en ramas y probado de punta a punta en local, sin aplicar en producción** (ver §07, «Imprimir en la caja»)
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

### La versión del sitio

**Qué es.** Una sola versión para todo el sitio, `AAAA.MM.DD-xxxxxxx`, que sale del **contenido** (no de un contador que alguien tenga que subir): `version.json` en la raíz guarda `{ "version", "fecha", "huella" }`. La `huella` es el sha256 de las cuatro páginas que llevan sello (`pos.html`, `carta.html`, `index.html`, `menu.html`) y de todo `assets/**` (ruta + contenido, en orden estable), con los sellos de versión normalizados (si no, escribir el sello cambiaría lo que se está hasheando). La `fecha` es la del día del cambio **en America/Bogota** (explícita: no depende de la zona de la máquina ni de CI) y `xxxxxxx` son los 7 primeros de la huella. Si la huella no cambió, el script no toca nada: la fecha no se mueve. Cambiar `img/`, `docs/`, el README o los archivos de descubrimiento (`local.json`, `llms.txt`…) **no** cambia la versión: no son del código que corre en el aparato.

**Los sellos.** Cada una de las cuatro páginas lleva la versión en dos sitios, cada uno en su propia línea: `<meta name="resplandor-version" content="…">` en el `<head>` (lo que lee el POS) y `<span data-version>…</span>` en el pie, junto a la firma «Ynt-labs» (la marca de lusof, sin «Hecho por»: Yonatan, 2026-10-03), visible sin JavaScript. En el POS el pie va al final del área de trabajo y en el login; tocar la versión busca una nueva en el momento.

**Por qué existe.** GitHub Pages responde con `Cache-Control: max-age=600` y el sitio no tiene service worker, así que un aparato con el POS abierto todo el día nunca se enteraba de que había versión nueva (2026-10-02: se vio en un aparato el POS «de antes», con «Facturar» e «Imprimir cuenta», horas después de publicar). **Solo el POS lleva el aviso**; carta, landing y menú son de clientes y de visitas cortas.

**El aviso del POS** (`pos.html`, «Versión del sitio» en el store):

- Pide `version.json?t=<ms>` con `cache: "no-store"` al arrancar (también en la pantalla de login), cada 5 minutos, al volver a la pestaña y al volver la red. Sin red o con un error, **en silencio**; solo al tocar la versión del pie se le dice a la persona qué pasó.
- Si lo publicado es distinto del `<meta>` de la página, sale una franja tranquila arriba de todo, en el flujo (no tapa el encabezado, ni la barra de cobro, ni la navegación de abajo): «Hay una versión nueva del POS» con «Recargar» y «Después». «Después» la esconde hasta que salga otra versión o pase 1 hora.
- «Recargar» refresca la caché HTTP del documento y de los `<script src>` y `<link rel="stylesheet">` del mismo origen (`fetch(url, { cache: "reload" })`) y recién entonces llama a `location.reload()`: sin eso, el reload podía volver a pintar la página vieja desde los 10 minutos de caché. **Recargar es siempre un toque de la persona, nunca automático**: si tras recargar la página sigue vieja (un CDN atrasado), el aviso vuelve a salir y se puede intentar otra vez; no hay bucles. **Y solo recarga si recargar es seguro**, en este orden (refutación de la integración con «para llevar», tres rondas):
  1. **Primero espera lo que solo vive en memoria** (un «+1» cuyo delta sigue en vuelo, una marca «Para llevar» que la base aún no confirmó, una fila que se está subiendo, **un papel que viaja a la caja** —el ticket de un cobro: mientras el insert está en vuelo solo vive en memoria y recargar encima se lo llevaba, sin ticket en la caja ni en el teléfono—): no está en la cola ni en el almacenamiento y la recarga lo perdía. Espera hasta ~5 s y reintenta ya las marcas que esperaban su reloj de reintento; **no** adelanta la que todavía espera el «+1» de su línea (la nota llegaría antes que la línea y esta nacería sin la marca). Si no llega, no recarga. Un **ticket sin resolver** (su aviso dice «No hubo respuesta de la caja» o «error» y guarda la orden confirmada para imprimirla desde el teléfono, solo en memoria) cuenta como «algo empezado» (punto 4): la recarga no se hace sola.
  2. **Después mira la red y baja el documento nuevo, y recarga enseguida solo si bajó entero.** La descarga va *después* de la espera a propósito: con la descarga antes, si la red se caía mientras esperaba, la subida en vuelo fallaba y quedaba en la cola, la espera terminaba «bien» y recargar sin internet dejaba al POS en la página de error del navegador (`ERR_INTERNET_DISCONNECTED`), sin pantalla, siendo un POS que sí trabaja sin red. Si la cuenta se movió mientras bajaba (con poca red son segundos), vuelve a esperar y a bajar (hasta 3 descargas). Y como los scripts y hojas se refrescan después del documento y pueden tardar, una mirada diminuta a `version.json` cierra esa espera; entre la última prueba de red y `location.reload()` no queda más que la cola de microtareas.
  3. **Una red lenta no es una red caída, y la descarga se corta por inactividad, no por reloj.** El documento baja **solo** (con todo el ancho de la conexión; pedido junto a los scripts, por debajo de ~90 KB/s no terminaba nunca) y se lee **por partes**, con un `reader`: se abandona si ni las cabeceras llegan en 10 s (no hay red: «¿sin internet?») o si, ya contestado, pasan **15 s sin un solo byte** del cuerpo («la descarga se detuvo»). **Mientras lleguen bytes se sigue**, tarde lo que tarde: un tope fijo de 30 s desde el pedido cortaba una descarga que avanzaba y, por debajo de ~7 KB/s reales, «Recargar» no recargaba nunca (y cada toque empezaba de cero, porque `cache: "reload"` no reusa lo ya bajado). Solo una red de seguridad de 5 minutos la corta aunque avance («la conexión está muy lenta»). Los scripts y hojas del mismo origen son de mejor esfuerzo (20 s): su tope no impide recargar si el documento ya bajó.
  4. **Mientras prepara, la persona decide (y nunca se recarga encima de lo que empezó).** Con una red lenta preparar tarda decenas de segundos y el POS no se bloquea: la persona sigue trabajando. La franja dice «Descargando la versión nueva…» y ofrece **«Cancelar»** (en lugar de «Después», desde el toque en «Recargar», también mientras espera lo pendiente), que lo aborta todo —la espera y las descargas, con un `AbortController`— y deja la franja como estaba: nada queda deshabilitado sin salida. **Al terminar de bajar, recarga en el acto solo si la persona no hizo nada desde el toque**: ni un toque ni una tecla fuera de la franja, ningún diálogo abierto, la misma vista. **Si hizo algo, no recarga**: la franja pasa a «La versión nueva está lista» con **«Recargar ahora»** y «Después», y espera su toque (con un diálogo abierto la franja queda debajo del velo: se ve al cerrarlo). «Recargar ahora» es inmediato —la caché ya está caliente, no baja nada otra vez—, pero sigue esperando lo pendiente (el punto 1) y mirando la red justo antes de `location.reload()` (el punto 2). «Lista» vale solo para la versión que bajó: si sale otra, vuelve el aviso de siempre con su «Recargar», que baja de nuevo.

  **Sin red no recarga** (también si el documento no se pudo descargar ahora mismo: wifi sin salida, un error del servidor). En todos los casos de «no» el POS sigue como estaba, el botón queda libre y la franja dice por qué («Sin conexión…», «No pude descargar la versión nueva…», «La descarga de la versión nueva se detuvo…», «Todavía se está guardando lo último de la cuenta…», «La cuenta siguió cambiando…», y —solo con «Recargar ahora»— «Hay un ticket sin imprimir: recargar borraría su aviso…» (un ticket «dudoso», en error o con la caja callada guarda en memoria la única copia de la orden cobrada: recargar se la llevaría; se imprime desde el teléfono o se cierra con la ✕ y se vuelve a tocar), 12 s; «Recargar ahora» sin red lo dice con sus palabras y la versión sigue «lista»).
- **Qué se pierde al recargar y por qué el aviso no interrumpe.** Sobreviven la sesión de Supabase y la caché local (`pos_mesas`, `pos_ordenes`, …) y, sobre todo, **la cola de reintentos** (`pos_delta_queue`, `pos_pendientes`), que se vacía sola al arrancar. Se pierde lo que solo vive en memoria y no es una subida en camino: la vista abierta (se vuelve a Mesas), un nombre a medio escribir, un diálogo de cobro abierto, el «Deshacer» del último cobro, y el interruptor «Agregar para llevar». (Las subidas en camino sí se esperan: ver arriba.) Por eso el aviso es una franja y no un diálogo, no recarga solo y no bloquea nada: la persona elige cuándo, entre una mesa y otra. Y por eso, si la persona hace algo mientras baja la versión nueva, «Recargar» no la recarga sola: la deja «lista» (punto 4).

**Cómo se mantiene.** `node scripts/version.mjs` se corre **AL FINAL**, **después** de `scripts/css.mjs`, `scripts/iconos.mjs` y `scripts/descubrimiento.mjs` (su huella incluye `assets/css/resplandor.css` y lo que ellos reescriben en las páginas), en **cada cambio de páginas o de assets**, y se commitea `version.json` junto con las cuatro páginas. `node scripts/version.mjs --comprobar` (paso del workflow `comprobar.yml`, y `scripts/pruebas/version.test.mjs`) sale con 1 si `version.json` o algún sello no corresponde, y dice qué correr.

**`descubrimiento.mjs` no lee la versión** (desde 2026-10-04): el `<lastmod>` del sitemap y del schemamap y el `last-updated` de los `.md` gemelos son **una fecha por página** —el día en que cambió el contenido de ESA página—, guardada junto con la huella de la página en `scripts/fechas-paginas.json`. Un cambio solo del POS (o solo del sello de versión) no mueve ninguna, así que **no hay segunda corrida** de `descubrimiento.mjs` después de `version.mjs`: el orden es css, iconos, descubrimiento, version, y listo. Si dos ramas tocan páginas distintas, sus fechas no chocan; si tocan la misma, hay marcas de conflicto en `scripts/fechas-paginas.json`: se resuelven (cualquier lado) y se regenera con `node scripts/descubrimiento.mjs`. **Con marcas sin resolver (o con un archivo roto) el generador se niega** (sale 1, no escribe nada, también con `--comprobar`): no lo toma por vacío, que llevaría a hoy las fechas de todas las páginas. Por qué no la fecha de `version.json` ni la de git: `docs/landing-y-agentes.md`, «Fechas de las páginas».

**Si dos ramas chocan en `version.json`** (las dos cambiaron páginas o assets, así que las dos reescribieron la versión y los sellos), no hay nada que decidir: resuelve el conflicto dejando cualquiera de los dos lados (los sellos son una línea cada uno) y **vuelve a correr `node scripts/version.mjs`**; la versión se recalcula del contenido ya mezclado. Con marcas de conflicto sin resolver en una página, el script se niega a sellar y lo dice.


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
| `etiqueta` | — (el POS no la toca) | `text \| null`, de 1 a 40 caracteres: nota corta que la carta pública muestra como pastilla («Incluye jugo», «Algunos fines de semana», «2 x 1», «20% OFF»). Migración `20261003130000`. |
| `dia_semana` | — (el POS no la toca) | `smallint \| null`, 1 (lunes) a 7 (domingo): solo para las promociones. Migración `20261003130000`. |

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

Un `OrdenItem` puede llevar `precio_manual: true` y `precio_por` (correo de quien puso el precio a mano, atribución que pone la RPC y no un dato a prueba de falsificación): la base no refresca esa línea desde `productos` (ver «Precio a mano por línea del pedido»).

Un `OrdenItem` de **precio negativo** es un **abono**: un cobro por monto («Cobrar por partes → monto», ola B). La orden cerrada «Abono · Mesa N» lleva el cobro y la orden abierta recibe una línea «Abono recibido» con precio negativo (`aplicar_delta_orden`, `p_precio = −monto`, delta +1), así que su `total` es lo que **queda** por pagar. La carta pública (`carta.html`) la muestra como abono, con signo menos, y no como un producto (`docs/sdd-cuenta-en-mesa.md` §03.5 y §04.7).

**«Para llevar»** (2026-10-02; sin migración; diseño y tabla de decisiones en [`docs/para-llevar.md`](docs/para-llevar.md)): opcional, por producto y para el pedido completo. **Por producto:** el token `Para llevar` al final de la **base de la nota** de la línea, separado por ` · ` («Sopa · Pollo · Para llevar — Persona 2 (Camila)»); se alterna con `actualizar_nota_item`, marca la línea entera y conserva persona y variante. **Pedido completo:** un `OrdenItem` de **$0 con id fijo `para_llevar`** (nombre «Para llevar», nota «Todo el pedido», cantidad 1), puesto y quitado con `aplicar_delta_orden`; no es un producto: no cuenta en «N ítem(s)», ni en dividir por persona, ni en cobros por unidades o abonos, y una cuenta que solo lo tiene no se cobra (sí se libera). Los tickets, la precuenta y el papel de la caja lo dicen («PARA LLEVAR — todo el pedido»), y la carta del cliente lo muestra como etiqueta.

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

### Impresora e impresión (cola de impresión, aún no al aire)

El PC de la caja es una **impresora**; cada ticket que un teléfono manda a la caja es una **impresión** en cola. El token del agente solo se guarda como hash.

| Campo (Postgres) | Tipo |
|---|---|
| `impresoras.id`, `nombre` | `uuid` y el nombre que le pone el admin («Caja») |
| `impresoras.token_hash` | `sha256` en hex del token del agente; **ningún rol de la API puede leerlo** (permiso por columna) |
| `impresoras.activa`, `ultimo_latido`, `version_agente` | el agente late cada 30 s; **en línea = último latido de menos de 90 s** |
| `impresiones.id` | **PK**, `uuid` que pone el teléfono (un reintento sin red da `23505` y no sale otra copia) |
| `impresiones.impresora_id` | la impresora destino (`null` = la toma cualquiera de las activas) |
| `impresiones.tipo` | `'cuenta' \| 'ticket' \| 'abono' \| 'cierre' \| 'prueba'` |
| `impresiones.contenido` | `jsonb`: el documento **ya armado por el POS** (`{v, titulo, lineas[], qr, cortar}`, máximo 32 KB y 500 líneas); el agente no confía en él y filtra los bytes de control |
| `impresiones.estado`, `intentos`, `error` | `'pendiente' \| 'imprimiendo' \| 'impresa' \| 'error'`; hasta 3 intentos; lo que lleva más de 15 min sin imprimirse (sin tomar, o tomado y trabado) pasa a `error` («caducó») |
| `impresiones.creada_por`, `creada_en`, `tomada_en`, `impresa_en`, `tomada_por` | quién lo pidió (lo pone la base) y los tiempos |

Las impresiones impresas o fallidas de más de 7 días se borran solas. El personal las ve y las crea (tope de 30 por minuto y por persona, `RS030`); nadie las edita ni las borra por la API.

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
| Cobrar y cerrar («Generar ticket y cobrar», el único botón de cobro), cobro por partes (por ítems, por unidades de una línea o por monto), cuenta dividida por persona con nombre (con su «Precuenta» y su «Cobrar» en cada fila), «Imprimir precuenta» (no cobra; **imprimir va siempre a la caja, con una confirmación**: ver §07, «Imprimir en la caja»), liberar una mesa vacía (abierta y sin ítems) | Sí | Sí |
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
| **Tablero de Administración** (ola C, ronda 5): la entrada del menú y sus tarjetas | No | Sí |
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
5. **La ola C**, en este orden: las **cuatro migraciones** (`20261002150000_aprobacion_personal.sql`, `20261002160000_mesas_y_pegatinas.sql`, `20261002170000_ajustes_ticket.sql` y `20261002180000_deshacer_cobro.sql`, todas idempotentes y compatibles con el POS de la ola B: las filas de `personal` que ya existen quedan aprobadas); luego la Edge Function `cuenta` (una mesa desactivada es un enlace inválido: lee `mesas.activa`, y por eso va **después** de la migración) y `alerta` si cambió; y por último el **POS de la ola C**. (El orden de aplicación no es el del directorio: la migración de la carta, `20261003130000_carta_etiqueta_y_promos.sql`, ya está aplicada en producción y en el directorio va después de estas cuatro; no comparten ningún objeto —`carta_publica`, `productos.etiqueta`, `productos.dia_semana`—, así que las cuatro se aplican encima de ella y dan el mismo catálogo que la cadena en el orden del directorio. Si algún día se usa `supabase db push`, pide `--include-all`.)
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

Pedido de Yonatan (2026-10-02): «en la funcionalidad para pagar hazlo dinámico y si selecciona pagar, abrir QR de Bre-B» y «ese botón, al convertirse en QR, también debe tener la opción de enviar comprobante al WhatsApp de Resplandor». **Pago con Bre-B.** Vista **Ajustes**, sección «Pago con Bre-B», solo para el admin: el interruptor «Mostrar en la carta» (`pago_breb_visible`), la **llave** (`pago_breb_llave`) y el **contenido del QR** (`pago_breb_qr`: el texto que dice el QR, no una imagen; se pega o, si el navegador tiene `BarcodeDetector`, se lee de una foto), con la validación del formato EMV y del CRC antes de guardar y la vista previa del QR generado. La foto va primero (botón principal) y el texto es la otra manera; la llave **sale sola del QR** cuando está vacía; una etiqueta junto al título dice si la carta lo muestra («Visible para clientes» o «Apagado»), «Guardado» dice lo mismo, y un QR que trae un valor fijo (campo 54) o es de un solo uso (campo 01 en «12») **avisa** (todas las mesas pagarían ese valor). **Los datos reales no están en el repo** (es público): los carga el admin desde ahí. La base los valida con `check` (`supabase/migrations/20261003150000_pago_breb.sql`; la llave es «@alfanumérica», un número de 5 a 20 dígitos, un celular `+57…` o un correo; el QR, un contenido EMV de 20 a 700 caracteres cuyo último campo es el «6304» y su CRC es el correcto; **y la llave que se muestra tiene que ser la que cobra el QR**: el subcampo 04 del único campo 26 con el subcampo 00 `CO.COM.RBM.LLA`, leído campo por campo (`privado.emv_llave` y el `check` `ajustes_pago_breb_qr_llave`; sin eso un pegado equivocado dejaría «Llave: @a» bajo un QR que paga a «@b»). Lo mismo exigen la función, la carta y el tablero) y la Edge Function `cuenta` los entrega en `pago: { breb: { llave, qr } }` **solo con la cuenta abierta** y el interruptor encendido (nunca por `carta_publica`; `service_role` solo lee esas tres columnas de `ajustes`). Si la función **no puede leer** `ajustes` (un corte, la migración sin aplicar) no manda `pago` pero sí `pago_desconocido: true`, y la carta se queda con lo que ya mostraba: «no pude leer» no es «apagado». En la carta, «Pagar» → «QR (Bre-B)» convierte la hoja en el QR dibujado en el navegador (`assets/vendor/qrcode-generator-1.4.4.js`, corrección M), con «Llave: …» y «Copiar llave», el total y «Enviar comprobante por WhatsApp» (`wa.me` al número de `assets/js/local.js`, con la mesa y el total; sin datos personales); «Transferencia» muestra la llave con el mismo botón; «Efectivo» no cambia; todos avisan al mesero. En el celular **«Transferencia» va primero** (un QR en la pantalla del mismo celular que tendría que escanearlo no se puede leer: el QR dice «Para escanear con otro celular») y en escritorio, el QR. La vista del QR o la llave es compacta (sin la hora de apertura ni «Consumo en vivo»; la pastilla de conexión solo si dice algo malo), con una sola salida hacia atrás (la flecha «Cambiar método»), el subtítulo con el **valor en vivo** («escribe $ 99.000 en tu app del banco»: el QR del local es estático y no lo trae), «Copiar valor» (solo dígitos) y el botón del comprobante **pegado sobre el total**, a la vista sin desplazar desde 320×568 hasta 412×915; el mismo botón está en la tarjeta «Listo, le avisamos». Sin datos configurados el flujo es el de antes, sin QR ni llave. Se prueba de punta a punta (base real, `cuenta` real, carta y tablero en Chromium) en `scripts/pruebas/integracion-pago-breb.test.mjs`. Lo único en que la interfaz es más estricta que la base: el CRC en minúscula (EMV lo pide en mayúscula).

### Tablero de Administración (ola C, ronda 5: listo en ramas, **no está al aire**)

Pedido de Yonatan (2026-10-01): «construir un panel o dashboard del admin donde pueda agregar meseros, editar menús semanales y demás administración». Una sola entrada **Administración** en la navegación (solo admin; el mesero no la ve) abre un **tablero de tarjetas**, móvil primero (una columna en el teléfono, rejilla de 2 y de 3 desde tablet). **No duplica ninguna vista:** cada tarjeta lleva a la que ya existía, con un dato vivo y su acción principal. Reemplaza al botón «Más» y a los links sueltos de Menú semanal y Personal.

- **Hoy** (franja de arriba): ventas del turno, mesas ocupadas y alertas pendientes.
- **Tarjetas:** Personal (solicitudes por aprobar y activos; «Agregar mesero»), Menú semanal (la semana en curso: cargada, incompleta o sin cargar; «Editar menú»), Mesas y pegatinas (activas y pegatinas sin revisar; «Revisar pegatinas»), Productos (en carta; «Agregar producto»), Ticket y ajustes (la dirección del QR actual), Cierres (el último cierre; «e historial» va solo para el lector de pantalla), Cobros deshechos hoy y Alertas. Las que piden algo del admin se destacan con un filete maíz y un chip («Por aprobar», «Por cargar» o «Por definir», «Por revisar», «Por decidir», «Por atender») y **suben al principio** (Alertas primero); con solicitudes esperando, el botón de Personal es «Revisar solicitudes (N)». La insignia de «Admin» cuenta las solicitudes por aprobar más una por cada tarjeta que pide algo (menú, pegatinas, ventas sin subir); las alertas tienen la suya.
- **Ventas sin subir de esta tablet (un cierre «Sin respaldo» de la versión anterior):** si una tablet trae uno sin decidir, la tarjeta de Cierres se destaca («Un cierre por decidir», chip «Por decidir») y su primer botón es «Revisar ventas sin subir», que abre la hoja de la ronda 5a, redactada de nuevo en la ronda 6 (subir las ventas que faltan o descartar la copia). Esa hoja también se abre sola al arrancar, una vez por sesión, y el aviso «Revisar» de la vista de Cierre la abre. Es solo del admin.
- **Impresora de la caja:** con la cola de impresión en la base la tarjeta sale sola: dato vivo «Caja en línea» (punto lleno) o «Caja sin conexión» (anillo hueco) con la **última señal** del agente («Última señal hace 12 s»), o «Sin configurar»; si la caja se cayó hace poco la tarjeta sube y dice «Por revisar»; su acción, «Configurar impresora», abre la vista de la impresora (crear la impresora, su token que se muestra una vez, rotarlo, imprimir una prueba), que cuelga de Administración con su «‹ Administración». Sin la cola en la base la tarjeta no existe (`impresora = null`, `tieneImpresora`: el gancho de `docs/pos-visual.md` §0.20, ya conectado).
- **Datos:** solo reutiliza lo que el POS ya lee (personal, mesas, cobros deshechos, ajustes) más **una** lectura liviana nueva: el menú de la semana en curso (a lo más 18 filas). No hay migración ni función nueva en la base.
- **En el teléfono** la barra inferior del admin queda Mesas · Alertas · Productos · Cierre · Admin (Alertas se queda: la campana de arriba solo existe desde tablet).

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
- **No hay cierre sin red.** «Cerrar día» solo se habilita con conexión y con la cola vacía (sin deltas, filas ni cierres editados sin subir); si no, el botón se apaga y dice «Sin conexión…» o «Hay N cambios sin subir: espera a que suban» (con «Reintentar subir»). Se fue el camino del cierre «Sin respaldo» para los cierres nuevos y todo lo que existía solo por él (`sinSubir`, `_cierreRechazado`, el archivo local antes de que la base conteste). Un cierre «Sin respaldo» **viejo** que haya quedado en el `localStorage` (del POS de la ola B, el de producción) **ya no se resuelve solo** (ronda 5a): lo decide el admin, ver «Sin descartes silenciosos, reabrir con red y cierres viejos a decisión del admin» más abajo; **nunca se purga nada a partir de él**.
- **Una venta nunca entra en dos cierres:** la tabla interna `cierre_ordenes` (`orden_id` es la clave primaria) la mantiene un disparador de `cierres`; un segundo cierre con una venta ya archivada se rechaza (`RS004`) y el cobro de una venta cerrada ya archivada se rechaza con `RS005` (ronda 5a: antes se descartaba en silencio). Ronda 6: editar un cierre que la base ya tiene tampoco puede meter una venta que está **viva** en `ordenes` (`RS004`: una copia atrasada del historial no resucita una venta que otro admin reabrió y se volvió a cobrar; el POS vuelve a leer el historial y avisa).
- **Deltas idempotentes:** `aplicar_delta_orden` gana `p_delta_id` (opcional). El POS le pone un id a cada delta al encolarlo y lo reenvía igual en cada reintento; la base lo anota en `deltas_aplicados` dentro de la misma transacción y, si ya estaba, no aplica nada. Una cuenta cobrada sin red sube con los ítems de los deltas que nunca se mandaron: la fila lleva sus ids en `ordenes.deltas_ids` y el guardia los anota en la misma transacción que la fila. Con eso, reenviar un delta cuya respuesta se perdió ya no lo duplica (era el límite admitido de la ronda anterior).
- **El POS sabe qué trae la base** (`_sondearBase`): pregunta por `ordenes.parcial_de` (el guardia de `version`) y `ordenes.deltas_ids` con una lectura de cero filas, así que no depende de que haya órdenes cargadas. Sin un sí confirmado no manda `version`; sin los ids, cae al camino de antes.
- **Un POS viejo sin recargar no corrompe nada con la base nueva:** además, un guardia de DELETE (`trg_ordenes_guardia_borrar`) no deja que la API borre una cuenta abierta con ítems, así que el cierre del día de una tablet con el POS viejo (guardar el cierre con su foto y borrar por id) ya no se lleva la cuenta que otro dispositivo reabrió con «Deshacer». Ronda 6: tampoco deja borrar por la API una venta **cerrada que ningún cierre archivó**: una purga que se quedó pendiente en una tablet (K1.purgar) no puede llevarse el segundo cobro de una venta que un admin reabrió con el mismo id; el cierre que guarda esa tablet queda anotado en `cierre_ordenes`, así que esas ventas no se cuentan dos veces.

### Sin descartes silenciosos, reabrir con red y cierres viejos a decisión del admin (ola C, ronda 5a: listo en ramas, **no está al aire**)

La refutación de la ronda 4 encontró tres fallos que nacían del paso del POS viejo al nuevo. Yonatan eligió **simplificar**: en vez de más código de recuperación, menos máquina y decisiones a la vista.

- **Nada se descarta en silencio.** El guardia de `ordenes` (`trg_ordenes_guardia`) ya no devuelve `null` (0 filas y ningún aviso) al subir una venta `cerrada` cuyo id está archivado en un cierre: la **rechaza con `RS005`** («la cuenta … ya estaba en un cierre del día: revísala con el admin»). Antes ese camino también se comía el cobro de una cuenta que existe **abierta** con un id archivado (un POS viejo cerró con una foto vieja y la cuenta la había reabierto un «Deshacer»): quedaba imposible de cobrar y `cerrar_dia` decía `hay_abiertas` para siempre. El POS lo recibe (`esErrorCuentaArchivada` → `_cuentaArchivada`): lee qué hay en la base con ese id y avisa «Esta cuenta ya estaba en un cierre del día: no se cobró y sigue abierta. Revísala con el admin» (al admin le dice dónde: Historial → ese cierre → Editar → Reabrir), deja la cuenta abierta y la mesa ocupada y no deja nada pendiente; si la venta ya se archivó y se purgó, la suelta con aviso. `cerrar_dia` responde `hay_abiertas` con `en_cierre` (cuáles de esas mesas están en ese caso) y la ventana del cierre lo dice. También se rechaza con `RS005` el cobro **por partes**, por persona o el **abono** de una cuenta que existe abierta y archivada (la cuenta cobrada «por partes» se vaciaba, se liberaba la mesa y la venta quedaba contada dos veces): el POS lo recibe (`esErrorCobroParcialArchivado` → `_cobroParcialRechazado`), quita ese cobro, **devuelve a la cuenta lo que se había sacado** (un delta por línea, o quita la línea «Abono recibido») y avisa «El cobro por partes de la Mesa N NO quedó registrado… Si ya recibiste el pago, no lo pierdas de vista». Si la cuenta ya no está abierta (el parcial llegó tarde de una tablet sin red) entra como siempre. Los únicos descartes callados que quedan son los del guardia de DELETE, a propósito (los provoca un POS viejo o una purga atrasada que borran por id y no tienen dónde mostrar un error).
- **Reabrir una venta de un cierre pasado exige conexión y es atómico** (`reabrir_venta_de_cierre(p_cierre_id, p_orden_id, p_mesa_id)`, solo admin): en una sola transacción, con el mismo candado de aviso, saca la venta del cierre (recalcula su total y su cuenta de ventas; el disparador de `cierres` la libera de `cierre_ordenes`) y deja la cuenta abierta en la mesa pedida. Todo o nada. Antes el POS subía la cuenta abierta y **después** editaba el cierre: si la segunda subida no llegaba, la cuenta quedaba abierta y archivada a la vez. Sin red, «Reabrir en mesa» se apaga y dice «Sin conexión: reabrir una venta de un cierre pasado necesita la base…». Es también la **salida limpia del `RS005`**: si la cuenta ya existe abierta con ese id, se la deja tal cual y solo se la saca del cierre (`adoptada`); desde ese momento se cobra y se cierra el día con normalidad (una sola vez en los libros). Códigos: `no_autorizado`, `invalido`, `no_existe`, `no_esta_en_cierre`, `es_abono`, `mesa_inexistente`, `mesa_inactiva`, `mesa_ocupada`. Reabrir una venta del **turno** (no de un cierre) sigue como siempre.
- **Los cierres «Sin respaldo» viejos los decide el admin.** Un cierre que el POS de antes dejó en `localStorage` por cerrar el día sin red (trae `purgar` y `sync` distinto de `ok`; los que arma esta versión por el camino de siempre llevan `origen`) **sale de la lista de cierres** al cargar la caché y se guarda aparte (`pos_cierres_viejos`): nada lo sube con un `upsert`, ni esconde las ventas de hoy, ni purga la base a partir de él. Al arrancar, **al admin** se le abre una hoja: «Ventas sin subir de esta tablet»: «Esta tablet guardó N ventas ($ X) del sistema anterior (cierre del …). Faltan en el sistema: 1 ($ Y)», con la lista de **solo las que faltan o el sistema tiene abiertas** (mesa, día y hora, monto; las demás —ya están, ya estaban en un cierre, se deshicieron— se resumen en una línea) y dos acciones explícitas: **«Subir N ventas ($ Y)»** (solo las que el sistema no tiene en ninguna orden, cierre ni `deshechos`; entran como cobros normales) o **«Descartar copia»** (pide un segundo toque, en el pie fijo y con «Sí, descartar» como botón de peligro y la cifra de lo que se perdería; no sube nada ni toca la base). Las marcas de subida de las ventas de ese cierre que ya no están en `pos_ordenes` se sueltan al cargar la caché (`_soltarPendientesDeCierresViejos`): si la base tiene esa cuenta abierta, la copia atrasada ya no pisa lo que se agregó sin red. La hoja compara con una lectura propia de la base y, si falla, no concluye nada (apaga «Subir»). El mesero no la ve (el cierre queda guardado para el próximo admin que entre en esa tablet). Mientras haya uno sin decidir, «Cerrar día» se apaga y lo dice. Se fue `_recuperarCierresViejos` (la recuperación automática de la ronda 4).

### Cerrar con lo que se vio (ola C: listo en ramas, **no está al aire**)

Refutación de la ola C, hallazgo 4: una tablet que estuvo sin red cobraba la mesa con los ítems que veía y **pisaba lo que otra tablet había devuelto** con «Deshacer» (44.000 de 49.000 consumidos quedaban sin cobrar ni registrar). Ahora el UPDATE que pasa una orden de abierta a cerrada lleva la `version` que la tablet vio, y el disparador `trg_ordenes_guardia` lo **rechaza con `RS003`** si la base tiene otra. El POS anota la `version` que la base le contesta tras cada delta y **espera a los deltas en vuelo antes de cerrar** (así no hay falsas alarmas propias); si de todas formas la cuenta cambió, deja la cuenta abierta y la mesa ocupada, la vuelve a leer y avisa «La cuenta cambió, revísala: … No se cobró nada». Quien no manda `version` (una caché vieja) no se frena.

### Imprimir en la caja (cola de impresión: listo en ramas, **no está al aire**)

**Qué resuelve.** Sacar el ticket en la térmica del PC de la caja **desde cualquier celular**, con wifi o con datos, sin instalar nada en los teléfonos (se descartó Tailscale en cada celular: una VPN por teléfono, por mesero nuevo y por cuenta).

**Cómo se pide: siempre a la caja, con una confirmación (pedido de Yonatan, 2026-10-03; `docs/pos-visual.md` §0.24, que reemplaza la elección de §0.22).** Imprimir tiene **un solo destino, la caja, y una sola pregunta**. «Imprimir precuenta» (la de toda la cuenta), el **«Precuenta» de cada persona** («Dividir cuenta por persona») y el **«Imprimir» del ticket** de un cobro, un abono o una precuenta abren un modal corto («¿Imprimir la precuenta en la caja?», «¿Imprimir la precuenta de Camila en la caja?», «¿Imprimir el ticket en la caja?») con **[Imprimir en la caja] y [Cancelar]** y un resumen («Mesa 3 · 6 ítems · $ 97.000»). **Nada sale hasta confirmar**, y con la caja en línea **no se abre la impresión del teléfono**; el estado (En cola → Imprimiendo → Impreso) sale en el aviso flotante. Ya no hay «En la caja / En este teléfono» ni dos botones en el ticket. Mientras hay un trabajo igual en cola, su botón dice **«En cola…»** y está apagado (sin doble impresión; el de otra persona o el del ticket son otros papeles y siguen libres). Con **otro papel viajando a la caja** (por ejemplo el «Reintentar» del aviso, que va sobre los modales) el botón de la pregunta se apaga y dice **«Enviando el anterior…»**: la confirmación nunca se cierra sin mandar nada (si la tocan igual, avisa y se queda abierta). Y si **ese mismo papel** ya quedó en cola mientras la pregunta seguía abierta (el «Reintentar» era de él), el botón dice **«En cola…»** como el de su fila y «Cancelar» pasa a «Cerrar»: no manda una segunda copia (`confirmaImpresionEnCola`). Qué pasa según lo que el POS sabe de la caja:

| Estado de la caja | Qué hace «Imprimir» |
|---|---|
| **En línea** (último latido de menos de 90 s) | La pregunta de arriba; al confirmar, el trabajo va a la cola |
| **Registrada pero sin latir** | La salida de **emergencia**, con la misma confirmación: «La caja no está en línea (última señal hace 7 min). Se imprime desde este teléfono.» con **[Imprimir aquí] y [Cancelar]**; nada se encola |
| **La cola no está en la base** (la migración sin aplicar: el POS de hoy), **la cola está pero nadie registró la caja** o **todas las cajas están dadas de baja** (`activa = false`, que la base solo le devuelve al admin: una caja de baja es como no tener ninguna y el admin imprime igual que el mesero) | Imprime desde el teléfono **sin confirmación extra**: el diálogo de impresión del propio teléfono ya es la confirmación y el POS no cambia en nada |
| **No se sabe** (la red falló al arrancar) | Primero vuelve a preguntar (hasta 2,5 s) y decide con la respuesta: un «no sé» no se toma por «no hay caja». Mientras espera, el botón dice **«Un momento…»** y ningún botón de imprimir responde (un segundo toque no se suma); si en la espera salió de la cuenta, no abre ninguna pregunta |

El teléfono imprime **solo** en esos casos de emergencia: (1) caja registrada que no late (la confirmación de arriba), (2) si el envío falla **después** de confirmar (la caja se cayó entre medias, sin red, la base lo rechaza, el documento no cabe: el teléfono imprime solo y lo dice, porque la persona ya pidió el papel). **El papel es lo que se confirmó**, no lo que muestre la pantalla cuando por fin falla el envío (un envío lento tarda hasta 10 s: en ese rato pudo abrir otra mesa, con otra «Persona 1»): si esa cuenta sigue a la vista imprime exactamente el documento confirmado; si ya salió de ella, depende de si el papel se puede volver a pedir (`_caerAlTelefono`): una **precuenta** sí (la cuenta sigue abierta), así que **no imprime otra cosa** y el aviso lo dice («No se imprimió: ya saliste de esa cuenta. Vuelve a la Mesa 3 y pídela de nuevo.»); el **ticket de un cobro, de un abono o del «Cobrar» de una persona** no (la cuenta se cerró y ninguna pantalla vuelve a mostrar su ticket: un mesero no tiene «editar_cerradas»): **no se le trae la pantalla de vuelta ni se cancela nada** (antes, a los 10 s, reaparecía sola mientras atendía otra mesa y se cancelaba el trabajo tardío, también el que sí había llegado a la cola con la respuesta lenta). El **aviso del trabajo se queda en la lista con la orden CONFIRMADA** (una copia, no la cuenta abierta de ahora) y dice la verdad: si el trabajo **sí llegó** (se mira en la base) sigue su camino —sale en la caja y el aviso lo sigue—; si **no se sabe**, queda «dudoso» («No hubo respuesta de la caja. Si el ticket llegó, sale allí en unos segundos; si no sale, imprímelo desde este teléfono.»), cuenta como «en cola» para su botón (no se pide otro igual) y se vigila su respuesta tardía; si la base lo **rechazó**, queda en «error». En esos dos últimos el botón **«Imprimir desde este teléfono»** del aviso pone otra vez en pantalla esa orden y la imprime (`_imprimirTrabajoDesdeTelefono`), y antes cierra la puerta de atrás: si el trabajo pudo quedar en la cola lo cancela y, si la caja ya lo tomó, NO imprime aquí (saldría doble). Si quien lo pidió cerró sesión o entró otra persona en la tablet, el aviso se va con la sesión. Y (3) «Imprimir aquí» del aviso «La caja no responde…» (o «se calló mientras imprimía…»), que **cancela el trabajo de la caja** para no salir doble. Lo que se cancela y lo que se ofrece distingue **qué papel es** (la precuenta entera y la de cada persona son de la misma orden; `_alcanceDe`): imprimir aquí la precuenta de Camila no cancela la de Andrés ni la entera.

**La precuenta de una persona** (botón «Precuenta» de su fila): un documento con **solo las líneas de esa persona** (su nombre o «Persona N»), su total, el encabezado **«PRECUENTA — no es un cobro»** y la línea **«Cuenta de Camila · Mesa 3»** (en lugar de las filas «Mesa» y «Cuenta de»), con el mismo formato del documento de la caja y del ticket de pantalla (`_armarPreCuentaPersona`, `documentoTicket`); respeta «Para llevar» (bajo el producto, y el encabezado si es todo el pedido) y **no cobra ni saca nada de la cuenta** (a diferencia de «Cobrar», que sigue igual). **Si la mesa ya recibió abonos «por monto»**, las líneas de cada persona siguen asignadas y suman más de lo que la mesa debe: debajo del TOTAL de sus líneas lleva **«Abonos de la mesa»** y **«Queda por pagar (mesa)»** (la cifra que también hace valer «Cobrar»), para no entregarle al cliente un papel que le cobra otra vez lo ya pagado. La precuenta de toda la cuenta conserva su encabezado «CUENTA DE COBRO — NO ES FACTURA». El aviso dice «Cuenta de Camila · Mesa 3». Sin la caja sale del teléfono con el mismo texto.

**Cómo funciona.** El POS arma el ticket (el mismo contenido que el de papel, con el nombre de cada persona cuando la cuenta se dividió: «Cerdo - Camila», «Cuenta de Camila») y lo **inserta en `impresiones`**. Un **agente** en el PC de la caja (`impresora/`, Node 22 sin dependencias) **solo hace conexiones salientes** a Supabase: oye una señal por Realtime (tópico `impresora:` + `sha256(token)`, sin datos, como la cuenta en vivo), toma el trabajo con `impresora_tomar`, lo convierte a ESC/POS y lo manda RAW al spooler de Windows; luego confirma con `impresora_confirmar`. Si la señal se pierde, sondea la cola cada 5 s. El POS muestra «En cola → Impreso» en vivo (el aviso conserva los tres últimos y, aunque sean más viejos, todo lo que no terminó —en cola, imprimiéndose o con error—, para que su botón «En cola…» siempre tenga salida a la vista: «Imprimir aquí» o la X; con varios se acota y se desliza; el POS recuerda hasta 10 trabajos y, pasado el tope, **solo olvida lo ya impreso** —`_acotarTrabajosCaja`—, nunca lo que no terminó) y, si el insert falla después de confirmar, **cae a `window.print()` del teléfono** si el mesero sigue en esa pantalla, o deja el aviso con «Imprimir desde este teléfono» si ya salió (el ticket de un cobro o un abono nunca se queda sin papel —el aviso guarda la orden cobrada desde que el trabajo entra a la lista, también si entró a la cola y la caja no responde—; una precuenta que ya no está a la vista se vuelve a pedir; sin caja en línea lo dice la confirmación, ver arriba). **«Deshacer» un cobro retira el aviso de su ticket** y cancela lo que quedó en la cola (el papel de un cobro que ya no existe no se ofrece ni sale); si la caja ya lo tomó, el aviso lo dice y sale allí. **Con un diálogo abierto el aviso se compacta** a una línea («y N más»), arriba y sin recibir toques, para no tapar los botones del diálogo (con tres papeles sin respuesta la pila medía 320 px y tapaba «Imprimir en la caja» y «Sí, cobrar»); al cerrarlo vuelve entero. Con la base de hoy (sin la migración) el POS es el de siempre.

**Seguridad.** El agente **no lleva ninguna llave de servicio**: usa la clave publicable y un **token de impresora** aleatorio (256 bits, se muestra una sola vez al crearlo o rotarlo en el POS → Administración → «Impresora de la caja» → «Configurar impresora», solo admin; la base guarda su hash). Las tres RPC del agente (`impresora_tomar`, `impresora_confirmar`, `impresora_latido`) las puede ejecutar `anon`, pero un token inválido, rotado o de una impresora desactivada es indistinguible (vacío / `no_autorizado`). **Rotar** deja sin servicio al agente viejo al instante. El agente filtra todo byte de control del documento: un nombre de producto con `ESC` o `GS` no le manda comandos a la impresora. Garantía de entrega: **al menos una vez** (si el PC se cae entre imprimir y confirmar, a los 2 min sale otra copia si el trabajo tiene menos de 15 min, como mucho 3; el agente toma un trabajo por vez y recuerda en disco lo que ya imprimió). **Nada de más de 15 min sale al volver el PC**, ni lo que nadie tomó ni lo que se colgó a media impresión, y el POS cancela en la base lo que deja sin respuesta cuando el teléfono imprime o se cierra el aviso. El agente se niega a sacar más de 600 renglones de papel, y el POS no recorta una cuenta enorme: la imprime el teléfono.

**Al aire** (todo con el GO de Yonatan; el orden y la reversa de menos de un minuto, en `impresora/README-impresora.md` y en la cabecera de la migración): (1) `20261003140000_cola_impresion.sql` **después de la compuerta** (usa `mi_rol()`/`mi_correo()`), en el SQL Editor; el POS de hoy no la nota; (2) el POS con el botón; (3) en el POS, admin → Administración → tarjeta «Impresora de la caja» → «Configurar impresora» → crear → token; (4) en el PC de la caja: Node 22, la carpeta `impresora/`, `config.json` con el token, `node agente.mjs --impresoras`, `--prueba` y `iniciar.cmd`. Pruebas: `scripts/pruebas/migracion-cola-impresion.test.mjs` (la base), `impresora-*.test.mjs` (el agente), `pos-impresion-caja*.test.mjs` (el POS) y `impresion-punta-a-punta.test.mjs` (los tres juntos, con Docker y Chromium), `integracion-personas-impresion.test.mjs` (la jerarquía de los botones, la tarjeta del tablero y el documento con los nombres de las personas), `pos-impresion-defecto.test.mjs` y `pos-impresion-defecto-navegador.test.mjs` (la confirmación, la emergencia, el «En cola…», la precuenta por persona y la fila de dos líneas a 320, 360, 390 y 1280 px) e `integracion-punta-a-punta.test.mjs` (el POS real a 390, 920 y 1440 px contra la base real y el agente: tablero, dividir por persona con nombres, imprimir en la caja, «Cobrado $ X · Deshacer» y el cierre con sus colores). **Sin probar todavía:** la señal por el Realtime real de Supabase, el spooler de Windows y la térmica de verdad.

### Verificación en modo prueba (Google Cloud)

Mientras el proyecto de Google Cloud esté en modo "Testing", solo pueden loguearse cuentas agregadas manualmente en **Audience → Test users** (límite de 100). Publicar la app a producción quita ese límite; como solo se usan scopes básicos (email/perfil), normalmente no exige la revisión larga de Google reservada a scopes sensibles.

**Decisión (2026-09-30): sí se saca de Testing, pero solo con la ola C al aire** (paso 6 de arriba). Sin la compuerta, «publicar» y «cualquier Gmail entra al POS» son lo mismo: la RLS de antes solo exigía el proveedor Google. La compuerta ya cierra el acceso a los datos, y el modelo de aprobación hace que quien llega sin permiso quede pendiente y solo vea el mapa y la carta, en vez de un callejón sin salida. Es una decisión de identidad y la ejecuta Yonatan.

### Lo único que `anon` puede leer: la carta y su cuenta (2026-09-06)

La carta pública de las pegatinas NFC (`carta.html`) no toca las 4 tablas. Sus dos puertas, ambas en `supabase/`:

| Puerta | Qué expone | Por qué es segura |
|---|---|---|
| Vista `carta_publica` (SECURITY DEFINER a propósito, como las policies de `menus`) | `categoria, nombre, precio, descripcion` de `productos` con `activo and en_carta` | `anon` solo tiene `SELECT` sobre la vista; `productos` sigue sin policies para `anon`. El advisor la lista como `security_definer_view`: es el diseño. |
| Edge Function `cuenta` (`GET ?m=<mesa>&k=<token>`, `--no-verify-jwt` como `votar`) | Solo la orden `abierta` de esa mesa: ítems (nombre, precio, cantidad), total, hora | Valida el par `(mesas.id, mesas.token)` con service-role; token de 48 hex por mesa, rate-limit por IP. **Ola C:** además exige que la mesa esté **activa**; una mesa desactivada responde igual que un token malo («enlace inválido», 404), para no revelar cuál de las dos cosas es. Fuga aceptada: quien guardó el enlace ve la cuenta del siguiente ocupante mientras esté abierta; el mesero rota el token desde "Enlace NFC" en la vista de la orden (con roles, la rotación es solo del admin). |

**Desayunos y promociones de la semana (2026-10-01, rama `carta-promos`).** Desde la migración `20261003130000` la vista `carta_publica` expone además, al final, `etiqueta` y `dia_semana` (mismas filas, mismos permisos). La carta conoce dos categorías por datos: `Desayunos` (siempre se pinta, con «Todos los días · 7:00 a.m. – 11:00 a.m.»; sus platos y precios son los del letrero del local —Calentado Resplandor $17.000, Desayuno sencillo $9.000, Desayuno Resplandor $12.000— y se cargan con el sobre de datos; sin platos cargados dice «Pregunta por los desayunos del día» en vez de inventar) y `Promociones` (sección «Promociones de la semana», enlace estable `carta.html#promociones`, lunes a domingo según `dia_semana`, con la de HOY resaltada según la hora de Bogotá y no la del teléfono). Las promociones de precio fijo son productos normales; la del lunes (20% en el tercer almuerzo) y los 2 x 1 (miércoles y sábado) no tienen precio propio: van con **precio 0** y una `etiqueta`, y la carta muestra la etiqueta, nunca «$ 0». **No hay función de descuento en el POS y no se pidió** (Yonatan, 2026-10-01: «no son descuento, son promociones todos los días»): cada día es una promoción tal como la dice su afiche. En el POS esas tres aparecen como productos normales (tocarlas suma una línea de $0; el ítem manual no admite 0 ni negativos: `pos.html`, `agregarItemManual`). La carta nueva pide las 6 columnas y, ante un 400 (la base todavía sin la migración), repite con las 4 de siempre. El orden para salir al aire está en `PASOS-AL-AIRE.md` de la coordinación (sobre 1 → publicar → sobre 2) y los datos se cargan con un sobre SQL, no con una migración. La landing no depende de la base para las promociones: muestra los afiches (`assets/img/promos/`), y la carta de la landing (`#carta`, `landing.js`) NO lleva la categoría «Promociones» (saldría sin día y con «$ 0»); sus platos sí traen la `etiqueta`. Las herramientas en vivo para agentes (`vivo.js`: WebMCP `ver_carta`, MCP `resplandor_ver_carta`) piden las 6 columnas con el mismo repliegue ante un 400 y entregan `etiqueta` y `dia` (las promociones valen un solo día). El domingo la carta no ofrece el Menú Resplandor (no hay): la tarjeta del día lo dice y la franja «Promoción de hoy» (Almuerzos) queda justo debajo; «hoy» se vuelve a calcular a la medianoche de Bogotá y al volver a la pestaña.

La pegatina de cada mesa lleva `https://resplandor.ynt.codes/carta.html?m=<mesa>&k=<token>`; el POS lo muestra, lo copia y lo rota. Sin `k` válido la carta no muestra el control "Mi cuenta".

**Cuenta en vivo y «Pagar» (ramas, sin desplegar).** Con la fase 1 de [`docs/sdd-cuenta-en-mesa.md`](docs/sdd-cuenta-en-mesa.md) la carta recibe los cambios por un canal de Realtime cuyo tópico sale de `sha256(token)` y cuyo mensaje va vacío (la carta vuelve a leer `cuenta`); con la ola A, el botón «Pagar» (detrás del interruptor `pagarEnMesa` de `assets/js/local.js`, apagado) hace `POST` a la Edge Function `alerta` (`--no-verify-jwt`, solo ejecuta `alertar_cuenta`), que crea una alerta para el personal. Desde 2026-10-02 la carta SÍ muestra la llave y el QR de Bre-B del restaurante, pero solo con una cuenta abierta y el interruptor del admin encendido (ver «Pago con Bre-B» arriba); el mesero cobra y cierra en el POS. Ninguna de las dos funciones se ofrece a agentes (WebMCP, MCP, `llms.txt`). Una línea de abono (precio negativo) se ve en la cuenta como abono, con signo menos, y el total es lo que queda.

`menu.html` crea su cliente de Supabase **sin sesión** (`persistSession: false`): comparte origen, y por lo tanto `localStorage`, con el POS, y con la compuerta una tablet con la sesión de alguien que no está en `personal` vería la votación sin menús.

---

### Cierres por día y panel de cierres con rastro (2026-10-05: listo en rama, **no está al aire**)

Pedido de Yonatan (`tareas/2026-10-05-cierres-de-hoy-y-panel-admin.md`) tras ver «Cierre del día» con la Mesa 1 del domingo abierta. **«Transacciones del turno» y los KPIs son solo de HOY en Bogotá** (el día de `cerrada_en`, no el del aparato ni el de UTC): las ventas de un día anterior que nadie cerró siguen por cerrar, pero van a **un aviso discreto de una línea** («Ayer (dom 4) quedó sin cerrar: N ventas · $ X — Cerrar ayer · Ocultar»). Lo ven todos; «Cerrar ayer» solo el admin; «Ocultar» se guarda por día en `localStorage` y vuelve al día siguiente si sigue sin cerrar. La base lo hace con `cerrar_dia_de(p_id, p_dia, p_esperado)` (migración `20261006100000_cierres_de_hoy_y_cambios.sql`): cierra **solo** las ventas de ese día, el admin firma lo que ve (`cambio` si otra tablet vendió algo), un día pasado lleva la fecha de ese día (su 23:59:59 en Bogotá) y **una cuenta abierta no lo frena** (una cuenta abierta todavía no es una venta); cerrar HOY sigue exigiendo las mesas cobradas. `cerrar_dia(p_id, p_esperado)`, la firma vieja, no se toca (un POS sin recargar sigue cerrando todo junto) y un POS nuevo con una base sin la migración cae a ella. **Con una base sin la migración, el admin no firma una cosa y cierra otra:** el primer «Sí, cerrar día» descubre que `cerrar_dia_de` no existe, **no cierra nada** y vuelve a la ventana con las cifras nuevas (todas las ventas por cerrar, con el aviso «entran también las de días anteriores» y el botón «Sí, cerrar así», como ante `cambio`); solo el segundo clic llama a `cerrar_dia`. Si no hay ventas de días anteriores, lo firmado es lo mismo que se cerraría y un solo clic basta. Un día pasado, sin la migración, no se cierra por separado.

**Una venta con `cerrada_en` de «mañana» cuenta como de HOY** (decisión por defecto, a confirmar por Yonatan): el reloj de una tablet adelantado cobra una mesa al pasar la medianoche y la venta queda con la fecha de mañana; antes no salía en ninguna lista ni entraba en ningún cierre hasta el día siguiente. Ahora el POS la trata como de hoy (`diaDeVenta` topa el día en hoy: sale en «Transacciones del turno», suma en los KPIs y entra en «Cerrar día») y la base hace lo mismo (migración `20261006120000_cierres_ajustes.sql`: `cerrar_dia_de(HOY)` toma también las ventas cuyo día en Bogotá es posterior a hoy, así lo que el admin firma es lo que la base cierra; un día pasado **no** se las lleva y un día futuro sigue siendo `invalido`). **Con la base intermedia** (`20261006100000` aplicada y `20261006120000` todavía no) **y el POS nuevo**, la base no toma la venta de mañana mientras el POS sí la cuenta como de hoy: si es la **única** del turno, `cerrar_dia_de` responde `sin_ventas` (para la base no hay nada que cerrar) y el POS avisa «La base no ve esas ventas como de hoy: revisa la hora de la tablet»; si hay **otras** ventas de hoy, responde `cambio` con las de hoy sin la de mañana y, firmado eso, el cierre se hace y la de mañana queda sola, con el mismo `sin_ventas`. No se pierde ninguna venta (queda por cerrar hasta que se aplique la segunda migración o llegue mañana), pero es un estado a evitar: **el orden de salida es obligatorio, 100000 → 120000 → push del POS**, y el POS nuevo no sale antes de `20261006120000`.

**Relojes desfasados** (la base cuenta los días con su reloj, cada tablet con el suyo; el POS lo dice en vez de afirmar lo que no sabe): (1) *tablet adelantada y «Cerrar ayer»*: el día que la tablet llama «ayer» es HOY para la base; si la base responde `cambio` con ventas que la tablet cuenta como de hoy, o `hay_abiertas` (que solo frena el cierre de hoy), la ventana dice «Para la base ese día es hoy: el reloj de esta tablet va adelantado. Revisa la hora de la tablet.» y pasa a ser la de **hoy** (con el bloqueo de mesas abiertas y la firma de lo que propone la base), no la de «solo las ventas del día pasado: las de hoy no se tocan»; (2) *tablet atrasada, o la venta de mañana con la base intermedia*: si la base responde `sin_ventas` y la tablet, ya releída la base, sigue teniendo esas ventas por cerrar, el aviso es «La base no ve esas ventas como de hoy: revisa la hora de la tablet» y no «otro dispositivo ya cerró» (ese texto queda para cuando de verdad las ventas ya no están). Lo que **no** se arregla en el POS (la base es quien cuenta los días, y no sabe qué reloj tiene la tablet): una tablet atrasada que cierra «hoy» le pide a la base cerrar un día pasado (sale con la fecha 23:59:59 de ese día y sin exigir las mesas cobradas), y una adelantada que cierra «hoy» pide un día futuro, que la base rechaza (`invalido`, el POS dice «recarga la página»); en los dos casos no se pierde ninguna venta.

**Panel «Cierres» dentro de Administración** (solo admin: `puede('cierres_admin')` en el POS; RPC y RLS en la base): los cierres de los últimos 30 días; al abrir uno se ven sus ventas (se saca o edita una con el editor de siempre, que recalcula el total), se **corrige su nota** (`cierre_corregir_nota`), se **anula** con un motivo (`cierre_anular`) y se lee su rastro. **Los totales no se editan a mano** (salen de las ventas: ninguna RPC recibe un monto) y **nada se borra**: un cierre anulado se queda, tachado, con quién, cuándo y por qué, y sus ventas vuelven a las ventas por cerrar (sale su aviso, se cierra el día otra vez); un cierre anulado también suelta sus **cobros deshechos** (`deshechos.cierre_id` vuelve a `null` y no quedan colgados del cierre anulado; ajuste de `20261006120000`; **los toma el PRÓXIMO cierre que se haga, sea del día que sea** —`cerrar_dia_de` marca los `deshechos` con `cierre_id is null` y `fecha_bogota(hecho_en) <= p_dia`, así que solo se libra un cierre de un día anterior al que se deshicieron—: si se cierra HOY antes de rehacer AYER, los cobros deshechos de ayer quedan en el cierre de hoy y el de ayer rehecho sale sin ellos; decisión de Yonatan si prefiere deshechos por día), y queda congelado (RS006: la base rechaza cualquier UPDATE que nombre fecha, totales o ventas, **aunque el contenido sea idéntico**; si no, el upsert idéntico de una tablet con el historial atrasado volvería a archivar las ventas liberadas y el siguiente cierre las borraría sin contarlas; el POS, al recibir RS006, avisa y vuelve a leer el historial). **Cada cambio deja una fila en `cierres_cambios`** (quién, cuándo, qué cierre, qué cambió, antes y después, y la venta completa que salió o cambió): la escribe un solo disparador `SECURITY DEFINER` sobre `cierres`, así que también anota el cierre del día, «Reabrir» y la edición del historial; solo el admin la lee, solo se agrega (RS007) y no se purga. El UPDATE directo de `cierres` queda en las cinco columnas de siempre: la nota y la anulación solo van por las RPC. Orden de salida (obligatorio): 1) `20261006100000_cierres_de_hoy_y_cambios.sql`, 2) `20261006120000_cierres_ajustes.sql` (se niega a correr sin la primera), 3) el push del POS. Pruebas: `migracion-cierres-de-hoy.test.mjs` y `migracion-cierres-ajustes.test.mjs` (dinero y permisos por rol contra Postgres 17; la segunda, además, que las dos funciones son el mismo cuerpo que las de la primera más el cambio puntual) y `cierres-de-hoy-navegador.test.mjs` (la lógica del POS y el navegador a 390 y 1280 px).

### Precio vivo y promociones como regla (2026-10-04)

Desde `tareas/2026-10-04-hallazgos-domingo.md` la base es quien mantiene al día los ítems de toda cuenta **abierta** (migración
`20261005100000_precio_vivo_y_promos.sql`): un trigger BEFORE en `ordenes` refresca el precio de cada línea de producto desde
`productos` y aplica las promociones del día como **línea propia y positiva** («Seco · 3er almuerzo · 20% OFF», 1 × 15.200, junto a
«Seco», 2 × 19.000), y un trigger AFTER en `productos` «toca» las cuentas abiertas cuando cambia un precio o una regla, así el cambio
llega solo a todas las tablets (Realtime, misma `version`), a la carta (señal `cuenta:`) y al ticket. Las cuentas cerradas no se tocan.
La regla vive en `productos.promo_regla` (`{ cada, descuento, aplica: { categorias, productos } }`: por cada N unidades elegibles, la
más barata de cada grupo lleva X %; 100 = gratis, el 2 x 1) y se edita desde el modal de producto; el POS solo muestra las promos del
día (`dia_semana`) y anuncia las de regla, que no se agregan a mano. Pagar en la carta es **una sola pantalla**: al abrir «Pagar» se
avisa al mesero con el método `cuenta` («pide la cuenta», migración `20261005110000_alerta_pedir_cuenta.sql`) y copiar la llave o
abrir el comprobante afinan esa alerta a `transferencia`.

### Precio a mano por línea del pedido (2026-10-06)

Pedido de Yonatan del 2026-10-05 («se debe poder editar el valor a mano de cada producto»; `tareas/2026-10-05-precio-a-mano-y-botones.md`). En la
vista de la orden, **tocar el precio unitario de una línea** abre en esa misma línea un campo en pesos enteros (Enter o salir del campo guarda,
Escape cancela; vacío no cambia nada) y el precio nuevo vale para **todas las unidades de la línea**. Lo pueden hacer el mesero y el admin
(`puede('precio_a_mano')`, como crear y editar productos) y solo en una cuenta abierta: no en cobrar por partes, ni en un abono o el marcador «para
llevar». Una línea de promoción tampoco se cambia ELLA (se recalcula desde su base), **salvo cuando la promo se llevó su base ENTERA** (con «3er
almuerzo», tres ejecutivos distintos × 1 dejan al más barato entero en la línea `promo:…:<base>` y la línea base desaparece de la cuenta): entonces
esa línea de promo ofrece el precio del PLATO (el campo trae el precio sin el descuento, y el descuento se recalcula sobre el nuevo), la pastilla
«a mano» y «Volver al precio de carta», y todo viaja por el id de la base (`promo.de`). La línea queda con `precio_manual: true` y `precio_por`
(el correo de Google de quien lo puso, que escribe la RPC; la línea de promo sin base lo recuerda en `promo.precio`, `promo.precio_manual` y
`promo.precio_por`) dentro del jsonb de `ordenes.items`, sin columna nueva: la carta, el ticket y el cierre leen el mismo `precio`.
**`precio_por` es la atribución que pone la RPC, no un dato a prueba de falsificación**: `ordenes_editar` deja a un mesero escribir `ordenes.items`
por la API y una escritura directa puede traer `precio_manual` y un `precio_por` cualquiera, que el precio vivo respeta; no se usa para decidir
nada (permisos, cierre, carta pública). Cerrarlo con un guardia en `ordenes_guardia` no cupo limpio (la RPC es SECURITY INVOKER y el POS mismo escribe
marcas por escritura directa: la fila entera de una mesa abierta sin red, el cobro completo y por partes), así que queda como **decisión pendiente de
Yonatan** (rechazar la marca directa, o aceptar que `precio_por` es solo informativo). **El precio vivo ya no la pisa**:
`privado.normalizar_items` no refresca desde `productos` una línea con `precio_manual`, y las promociones la cuentan con ese precio (la línea de
promo recuerda la marca de su base; si la base vuelve —otra unidad del plato desde la carta, o un precio que la deja de ser la más barata—, la
adopta de la línea de promo). El cambio viaja por la RPC `public.fijar_precio_item(p_orden_id, p_item_id, p_precio)` (migraciones
`20261006110000_precio_a_mano.sql` y su ronda 2 `20261006130000_precio_a_mano_promo_entera.sql`, la última de la cadena; las aplica Yonatan, en ese orden y
antes del push del POS): los mismos guardias que `aplicar_delta_orden` (orden bloqueada y abierta, `version` que sube, SECURITY INVOKER) más `mi_rol()`
admin o mesero; COP enteros de 0 a 10.000.000 (0 vale: una cortesía y, como una línea gratis no entra a la promo, la base reaparece). «La línea no existe en la
orden» sale con SQLSTATE P0002 y «orden no existe» sigue P0001, y el POS ante cualquiera de los dos —o una cuenta cerrada— deja la línea como estaba, avisa en
una línea («La cuenta de la mesa N cambió: el precio de «X» no se guardó. Quedó como estaba.») y vuelve a leer la cuenta. El POS la llama como
`actualizar_nota_item` llama a la marca de «Para llevar»: inmediato en pantalla, con reintentos y anotado como pendiente (`preciosPendientes`, solo en
memoria: se pierde si el navegador se reinicia antes de que vuelva la red, la misma arquitectura que las marcas «para llevar») hasta que la base confirme, sin
que el eco de Realtime lo borre, y «Recargar» espera a que llegue. El precio va a la cuenta del campo que se tocó, no a la activa de ahora.
**«Volver al precio de carta»** (un enlace en la línea, solo con precio a mano) manda `p_precio = null`, quita la marca y deja que el precio vivo
la refresque. Con el POS puesto y la migración sin aplicar, tocar un precio avisa «falta aplicar la actualización de la base» y deja el precio como estaba
(y, sin la ronda 2, el precio de un plato que está dentro de una promo avisa que la cuenta cambió y lo deja como estaba). **Carreras que no se corrigieron
(decisión de Yonatan):** dos tablets —la A fija el precio y la B, atrasada, cobra por partes esa línea al precio viejo: la venta cerrada queda al precio
viejo y la cuenta al nuevo, la misma carrera que un cambio de precio en Productos (el INSERT cerrado no se normaliza a propósito). En el mismo pedido, los
**+ −** de cada línea pasaron a ser discretos: siguen midiendo 44 px de toque, pero sin caja ni borde (solo el signo en `apoyo`, la cantidad en medio), y a
390 px la línea se lee en dos renglones (`docs/pos-visual.md`, §3.13). Pruebas: `migracion-precio-a-mano.test.mjs` y
`migracion-precio-a-mano-promo-entera.test.mjs` (estática y contra Postgres 17 en Docker: permisos por rol, dinero, promos, la base dentro de la promo,
cobro, reversa) y `precio-a-mano-navegador.test.mjs` (estática, `vm` y navegador a 390 y 1280 px).

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
| `RPC` (2026-10-05) | `cerrar_dia_de(p_id, p_dia, p_esperado)` | El cierre de UN día en Bogotá (hoy o uno pasado sin cerrar), solo admin: solo las ventas de ese día (hoy, también las de «mañana» por un reloj adelantado: `20261006120000`); hoy exige las mesas cobradas, un día pasado no; el cierre de un día pasado lleva la fecha de ese día. `{ok, repetido, n, total, borradas, dia, cierre, deshechos}` o `{ok:false, codigo}`: `no_autorizado`, `invalido`, `hay_abiertas`, `sin_ventas`, `cambio` |
| `RPC` (2026-10-05) | `cierre_corregir_nota(p_cierre_id, p_nota)`, `cierre_anular(p_cierre_id, p_motivo)` | Panel de cierres, solo admin; la nota (hasta 500) no toca ningún peso; anular (motivo de 3 a 300) no borra nada, devuelve las ventas a las ventas por cerrar y suelta los cobros deshechos del cierre (responde `deshechos`: cuántos). `nota_larga`, `anulado`, `ya_anulado`, `motivo_requerido`, `mesa_inexistente`, `no_existe` |
| `TABLE` (2026-10-05) | `cierres_cambios` | El rastro de los cierres: quién, cuándo, acción (`cierre`, `nota`, `anulado`, `venta_sacada`, `edicion`), motivo, antes, después y detalle. La escribe solo `trg_cierres_rastro`; solo el admin la lee; solo se agrega |
| `TABLE` (ola C) | `deshechos` | Cada cobro deshecho: orden, mesa, tipo, monto, ítems, quién (correo) y cuándo. Solo la escribe `deshacer_cobro`; solo el admin la lee; 90 días |
| `ACTION` (ola C) | `deshacerUltimoCobro()`, `devolverACuenta(ordenId)`, `cargarDeshechos()` | El aviso «Cobrado $ X · Deshacer» (15 s), «Devolver a la cuenta / Deshacer el cobro» en «Transacciones del turno» y «Cobros deshechos hoy» en el cierre |
| `ACTION` (ola C) | `guardarAjustes(cambios)`, `cargarAjustes()` | Ajustes del ticket (dirección del QR, QR visible, pie); solo admin escribe |
| `RPC` (cola de impresión) | `impresora_estado()`, `impresion_cancelar(p_id)` | El personal: qué cajas hay y si están en línea; cancelar un trabajo que nadie tomó, o que la caja tomó y lleva más de 2 min sin confirmar (antes de caer a `window.print()` o al cerrar el aviso) |
| `RPC` (cola de impresión, solo admin) | `impresora_crear(p_nombre)`, `impresora_rotar(p_id)`, `impresora_activar(p_id, p_activa)` | Alta, token nuevo (el viejo deja de servir) y baja de una impresora; `{ok, id, token}` con el token en claro **una sola vez** |
| `RPC` (cola de impresión, con el token) | `impresora_tomar(p_token, p_max)`, `impresora_confirmar(p_token, p_id, p_ok, p_error)`, `impresora_latido(p_token, p_version)` | Las tres del agente del PC de la caja; ejecutables por `anon`, autenticadas por el token |
| `ACTION` (cola de impresión) | `pedirImpresion(que, persona?)`, `aceptarImpresion()`, `cancelarImpresion()` | Imprimir siempre a la caja con una confirmación: `pedirImpresion('precuenta' \| 'ticket', persona)` abre el modal (`confirmaImpresion`) y NO manda nada; `aceptarImpresion()` manda UN trabajo (o, en la emergencia, imprime en el teléfono); `cancelarImpresion()` lo cierra |
| `ACTION` (cola de impresión) | `imprimirCuentaEnCaja(persona?)`, `imprimirTicketEnCaja()`, `crearImpresora()`, `rotarImpresora()` | Lo que hace el «Imprimir en la caja» del modal (no preguntan: a la pantalla se llega por `pedirImpresion`; con caída al teléfono) y gestionan la impresora desde la vista «Impresora de la caja» (tarjeta del tablero de Administración) |
| `REALTIME` (cola de impresión) | Canal `pos_impresiones` | `postgres_changes` de `impresiones` filtrado por `creada_por`: el estado en vivo de lo que ese teléfono mandó |
| `ACTION` (ola B) | `facturarParcial` (ítems o unidades) y el cobro por monto | Cobran una parte: una orden cerrada nueva («Abono · Mesa N» si es por monto) y, en la orden abierta, un delta negativo de unidades o una línea «Abono recibido» de precio negativo (`aplicar_delta_orden`). La mesa sigue abierta |

---

## 09 — Flujos principales

### Flujo 0 — Login (nuevo)

1. El dispositivo abre la app → ve la pantalla "Continuar con Google" si no hay sesión.
2. Tras loguearse, Supabase redirige de vuelta a la misma URL con la sesión activa.
3. La app arranca: carga caché local, sincroniza con Supabase, abre los canales Realtime.

### Flujo A — Pedido completo (sin cambios de fondo, con protección nueva)

1. **Seleccionar mesa** — si dos meseros la abren casi al mismo tiempo, la base de datos garantiza que solo una orden gane; el segundo dispositivo adopta la orden real automáticamente, sin duplicar nada.
2. **Agregar ítems** / **ítem manual** — igual que antes. Opcional: «Agregar para llevar» (junto al buscador), «Para llevar» en cada línea y «Todo para llevar» en la cabecera del pedido (`docs/para-llevar.md`).
3. **Ver aviso de presencia** — si otro dispositivo también tiene la mesa abierta, aparece un banner con su nombre antes de facturar.
4. **Generar ticket y cobrar** — genera ticket, libera la mesa, libera la presencia.
5. **Imprimir** (opcional, sin cobrar) — «Imprimir precuenta» (toda la cuenta) o, con la cuenta dividida por persona, el «Precuenta» de cada fila (solo lo de esa persona): pregunta «¿Imprimir la precuenta en la caja?» y nada sale hasta confirmar (§07, «Imprimir en la caja»).

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
| **Pagar** (ola A y B) | El cliente elige el método y eso **avisa** al personal; el mesero cobra y cierra en el POS. **Desde 2026-10-02 (Bre-B):** con una cuenta abierta y el interruptor encendido, «QR (Bre-B)» convierte la hoja en el QR de pago del restaurante, con su llave y «Enviar comprobante por WhatsApp»; los datos los carga el admin en `ajustes` (nunca en el repo) | Yonatan, 2026-10-02: «hazlo dinámico y si selecciona pagar, abrir QR de Bre-B». Reemplaza «ninguna página muestra a dónde pagar»; el costo (un clon de la pegatina podría mostrar otra llave) lo frenan la contraseña de escritura y la revisión diaria (`docs/sdd-cuenta-en-mesa.md`, aviso del inicio) |
| **Aprobación del personal** (ola C) | Quien entra con Google pide acceso y queda **pendiente**; un admin lo aprueba (mesero o admin) o lo elimina. Un pendiente solo ve el mapa de mesas y la carta | Yonatan, 2026-09-30: «si no se aprueba solo podrá ver, no podrá hacer nada más». Reemplaza el alta solo por correo y deja sacar Google de Testing sin abrir el POS a cualquier Gmail |
| **Google fuera de Testing** | Solo con la ola C al aire | Yonatan, 2026-09-30. La compuerta sola deja un callejón sin salida; con la aprobación, el pendiente ve el mapa y la carta |
| **Mesas y pegatinas** (ola C) | El admin crea, edita, desactiva y rota mesas, y escribe y revisa la pegatina desde el POS con Web NFC. Las mesas no se borran: se desactivan. Nunca `makeReadOnly`. La contraseña PWD/PACK (D16) va con NFC Tools | Yonatan, 2026-09-30: «debemos poder añadir y editar pegatinas». Bloquear una pegatina para siempre impediría rotarla |
| **Ticket configurable** (ola C) | La dirección del QR, si sale y el pie se cambian desde Ajustes (solo admin); el QR se dibuja en el navegador | Yonatan, 2026-09-30: «puede cambiar el dominio» |
| **Deshacer un cobro** (ola C) | Se puede deshacer un cobro parcial, un abono o el cobro completo de una mesa: el admin **y el mesero, en cualquier momento** (sin ventana de tiempo), mientras el cobro siga en el turno | Yonatan, 2026-09-30: «tipo ctrl+z»; 2026-10-01: «el pedido se podrá deshacer cuando quiera el mesero o el admin». Editar en el sitio y eliminar una venta cerrada siguen siendo solo del admin |
| **Trazabilidad de lo deshecho** (ola C) | Cada deshacer queda en `deshechos` (quién, mesa, monto, hora) y el admin lo ve en el cierre del día: «Cobros deshechos hoy». No limita al mesero | Yonatan, 2026-10-01. Resuelve D37 (antes: «¿deja un registro?»). 90 días de retención (privacidad) |
| **Alertas** (ola C, D28) | Una alerta resuelta se borra un día después | Guarda el correo de quien la atendió: minimización (Ley 1581). `privacy.html` lo dice |
| **Cobro por partes** (ola B) | Por ítems, por unidades de una línea y por monto; el abono es una línea de precio negativo en la orden abierta | El total de la orden es lo que queda, y el cierre del día cuadra solo |
| **Versión del sitio y aviso de versión nueva** | Una versión (`version.json`, `scripts/version.mjs`) que sale del contenido; cada página la lleva sellada y firmada («Ynt-labs · versión X»). Solo el POS avisa, con una franja que no interrumpe, y recargar es siempre un toque de la persona (§04, «La versión del sitio») | Yonatan, 2026-10-02: «sí, agrega el aviso de versión nueva» y «en pie de página ynt-labs + versión». GitHub Pages cachea 10 minutos y el POS pasa el día abierto |
| **Para llevar** (2026-10-02) | Opcional y sin migración, en dos niveles: por producto (el token `Para llevar` al final de la base de la nota de la línea) y el pedido completo (una línea de $0 con id fijo `para_llevar`). El marcador no es un producto: fuera de «N ítem(s)», de dividir, de los cobros por unidades y de los abonos; una cuenta que solo lo tiene no se cobra. **No cobra empaque** (Yonatan, 2026-10-03): es solo una marca | Yonatan, 2026-10-02: «qué pasa si piden algo para llevar… un ítem no obligatorio para identificar si es para llevar el producto, no el pedido completo… pero también el pedido completo». Viaja por caminos que ya existen: nada que aplicar ni desplegar |

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