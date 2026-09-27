# Resplandor — landing homogénea + capa para agentes (especificación compartida)

Repo: `/Users/yonatan/Developer/resplandor/resplandor` (git, público, GitHub Pages en
`https://resplandor.ynt.codes`, `main` = al aire). Referencia del patrón: el repo `lusof` (`~/Developer/lusof`).

## Reglas duras (Línea Roja)
- NO `git commit`, NO `git push`, NO `wrangler deploy`, NO migraciones ni escrituras a Supabase,
  NO borrar archivos existentes del repo. `npm install` local sí. La sesión madre revisa y comitea.
- `img/referencias/` está fuera de git a propósito (fotos crudas con gente y captura de Maps): nunca
  la referencies desde HTML ni la copies tal cual; lo publicable sale recortado a `img/`.
- Tocá SOLO los archivos que tu parte posee (lista abajo). Si necesitás algo de otra parte, adaptate
  al contrato de esta especificación; no edites archivos ajenos.
- Todo el texto visible en español de Colombia, trato de «tú» (como la landing actual).
- Fuera de alcance: `index.html` (el POS de uso diario), `index2.html`, `resplandor.html`,
  `landing_old.html`, `resplandor_printer.html`, `resplandor-pos-sdd.html`, `supabase/`.

## Datos reales del local (única verdad; los dio Yonatan el 2026-09-26 o salen de la ficha de Maps)
- Nombre: «Resplandor Restaurante» (ficha: «Resplandor restaurante»). Cocina: colombiana, asados, cocina mixta.
- Dirección: Cra. 61 #79 Sur-62, Poblado del Sur, La Estrella, Antioquia, Colombia. Plus code 5954+9J.
- Geo: lat 6.1584468, lng -75.6434789.
  Ficha: `https://www.google.com/maps/place/Resplandor+restaurante/@6.1584468,-75.6434789,17z`
  Cómo llegar: `https://www.google.com/maps/dir/?api=1&destination=6.1584468%2C-75.6434789`
- Teléfono / WhatsApp: +57 322 554 2434 (`573225542434`, el mismo `waPhone` de la landing actual).
- Horario: TODOS los días, 12:00–17:00 (almuerzo). (Maps dice que el domingo abre 11:00; manda lo de Yonatan.)
- Capacidad: 30 personas. **Todo evento/celebración es en el local.** Nunca eventos a domicilio,
  nunca «catering externo», nunca «llevamos el barril hasta donde estés».
- Almuerzo programado (almuerzos con frecuencia fija): **se recoge en el local, o domicilio si el
  cliente asume el costo del domicilio.** Es lo único que puede salir del local.
- Reseñas: Google Maps muestra 5,0 con 2 reseñas. Se muestra VISIBLE como enlace a la ficha
  («5,0 en Google Maps · 2 reseñas»). **No** va `aggregateRating` en el JSON-LD (Google prohíbe marcar
  reseñas tomadas de otro sitio). Sin testimonios inventados (se quitan Luisa P., Carlos A., Marcela R.).
- Precios: **sin precios en eventos/paquetes/celebraciones** (se cotizan por WhatsApp). Los precios de
  la carta se leen EN VIVO de la vista `carta_publica` de Supabase (como `carta.html`), nunca a mano.
- Se quitan: «10 a 500 personas», «salón privado hasta 150», «+2.000 eventos», «Domicilios y catering
  externo», la FAQ de catering externo, el combo «Día del Padre» (promo vencida de junio), el selector
  de 5 paletas, AOS, los horarios viejos (12pm–11pm y 9am–9pm), «5–7 días para +50 personas».
- Supabase público: URL `https://yjtcrhmdztbuylgpuvsm.supabase.co`, publishable key
  `sb_publishable_1YEHWCyA6er72OsiXzpSyQ_eZx59p_7` (ya es pública en `carta.html:280-281`).
  Lectura anónima permitida SOLO de: vista `carta_publica` (categoria, nombre, precio, descripcion) y
  tabla `menus` (menú de la semana; ver `docs/menu_semanal.sql` y cómo la lee `menu.html:516-533`).
  Jamás la función `votar` ni `cuenta`, ni tablas del POS.

## Sistema visual (homogéneo en landing, carta y menú)
Una sola hoja compilada `assets/css/resplandor.css` (Tailwind v4.3.3 CLI, minificada, commiteada),
desde `assets/css/entrada-tailwind.css`, que hace:
```css
@import "tailwindcss" source(none);
@source "../../landing.html"; @source "../../carta.html"; @source "../../menu.html"; @source "../js";
@import "./base.css";        /* @theme static con tokens + base + compat v3 (border color, cursor) */
@import "./componentes.css"; /* componentes compartidos */
@import "./landing.css";     /* solo la landing (dueño: parte landing) */
@import "./carta-menu.css";  /* solo carta y menú (dueño: parte carta-menú) */
```
Tokens = la paleta del POS/carta/menú (ya es la de la marca: letrero negro con letras rojas, R dorada):
`ember #B5341C` (acción principal, el rojo del letrero), `amber #C08B2C` (oro de la R: filetes,
monograma, números; con mesura), `ink #1C1A17` (bandas oscuras, como el letrero), `parch #F7F2EC`
(fondo), `card #FFFFFF`, `teal #2A7B72` (solo estados «abierto/confirmado»), y los que ya usan carta y
menú (`muted`, `line`, `soft`, variantes `light/faint`, `parch-d`, `ink-5`, `ink-3`) con sus valores
actuales. Fuentes: **Fraunces** (display, títulos) + **DM Sans** (texto), el mismo `<link>` de Google
Fonts (`display=swap`) en las tres páginas. Adiós Playfair, OKLCH por tema y selector de paletas.
Motivo gráfico: el anillo de la R (círculo fino dorado) para el monograma y marcos; filetes dorados
finos; fotos reales. Nada de degradados de plantilla ni emojis en botones (íconos del sprite).
Movimiento: aparición sutil con IntersectionObserver; todo animado se apaga con
`@media (prefers-reduced-motion: reduce)`.

Íconos: Lucide 1.48.0 (`lucide-static`) como sprite SVG INLINE por página, generado por
`scripts/iconos.mjs` entre `<!-- iconos:inicio -->` y `<!-- iconos:fin -->` (justo después de `<body>`),
con los ids que la página usa (`<svg class="icono" aria-hidden="true"><use href="#i-nombre"/></svg>`).
Ids dinámicos (en atributos Alpine) se declaran en un comentario `<!-- iconos-extra: a b c -->`.
Sin runtime de Lucide en ninguna página.

Librerías fijadas (iguales en las tres páginas): Alpine `https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js`
(defer, al final del orden). `menu.html` además usa supabase-js: fijalo a la última 2.x del registro
(`npm view @supabase/supabase-js version`). Nada `@latest`, `3.x.x` ni `@4`.

Cabecera y pie comunes: monograma R + «Resplandor» en Fraunces; la landing enlaza a carta y menú, y
carta/menú enlazan de vuelta a la landing (`landing.html`). Favicon/apple-touch/theme-color (`#1C1A17`)
en las tres.

## Imágenes publicables (dueño: parte imágenes)
- `img/fachada-rojo-negro.webp` ← `img/referencias/fachada-globos-rojo-negro-captura-maps.webp`
  (610×793): recortar abajo para quitar flechas y «Google Maps» (≈ y>715). Foto principal (hero).
- `img/fachada-banderas.webp` ← `…-banderas.webp` (451×765) y `img/fachada-azules.webp` ←
  `…-azules.webp` (591×749): recortar para que NO se vea gente, el local de al lado ni el afiche «Luci»
  (quedarse con balcones + letrero RESPLANDOR RESTAURANTE).
- `img/logo-r.webp` (monograma recortado al círculo, 256 px) ← `…/logo-r-dorada.png`.
- `favicon.ico` (raíz; hoy da 404), `img/favicon-32.png`, `apple-touch-icon.png` (180, raíz),
  `img/og-resplandor.jpg` (1200×630, fondo ink, fachada + monograma + «Resplandor Restaurante ·
  La Estrella»; sin agrandar la foto más de ~1,1×).
- Nada se agranda de más; webp calidad ~80; verificá cada salida mirándola (Read de la imagen).

## Capa para agentes (dueño: parte agentes) — «la persona envía»
Patrón de lusof adaptado. Nunca se envía, reserva ni cobra nada por la persona: se arma el mensaje y el
enlace `wa.me` y la persona lo abre y lo manda. Sin USDC ni pagos.

Archivos del navegador (UMD como `lusof/assets/js/pedido.js`: `globalThis.X = …` y `module.exports`):
- `assets/js/local.js` → `globalThis.RESPLANDOR` = datos del local (arriba), tipos de solicitud,
  políticas, enlaces (Maps, cómo llegar, carta, menú), Supabase público.
- `assets/js/solicitud.js` → `globalThis.RESPLANDOR_SOLICITUD = { armarSolicitud, TIPOS, ENTREGAS,
  MAX_PERSONAS: 30, MAX_TEXTO, ... }`. `armarSolicitud(datos)` → `{ datos, mensaje, enlace, avisos }`,
  pura y determinista. `datos = { tipo, fecha, hora, personas, nombre, nota, entrega, direccion,
  frecuencia }`. Tipos: `reserva` (reserva de mesa), `almuerzo` (almuerzo programado) y las
  celebraciones de la landing actual (select en `landing.html:1679-1690`) SIN lo externo, más `otra`.
  Reglas: personas 1–30 (si piden más: se recorta a 30 y aviso «la capacidad es 30»); `entrega` solo
  aplica a `almuerzo` (`recoger` por defecto | `domicilio` → línea «El domicilio corre por mi cuenta»
  y pide `direccion`, aviso si falta); en cualquier otro tipo `entrega` se ignora con aviso «los eventos
  son solo en el local»; el mensaje dice el lugar (el restaurante, con dirección). Topes de texto,
  saneo de saltos de línea y separadores Unicode (U+0085, U+2028, U+2029), ids como `__proto__` no
  cuelan (copiá las defensas de `lusof/assets/js/pedido.js`). Errores de negocio → `avisos`, no throw.
- `assets/js/vivo.js` → `globalThis.RESPLANDOR_VIVO = { leerCarta(opts), leerMenuSemana(opts) }`:
  GET REST a Supabase con la publishable key (`carta_publica?select=categoria,nombre,precio,descripcion`
  y `menus` como `menu.html`), `fetch` inyectable, timeout, sin pasar texto del usuario a filtros de
  PostgREST (filtrar en JS). Devuelve datos normalizados o lanza Error en español.
- `assets/js/landing.js` → lógica Alpine de la landing (registrada en `alpine:init`):
  `Alpine.store('solicitud', { datos, get armado(), abrir(tipo), cerrar(), reiniciar() })` donde
  `abrir` hace `document.getElementById('solicitud').showModal()` (un `<dialog id="solicitud">`) y
  `armado` llama a `armarSolicitud(this.datos)`; `Alpine.data('cartaVivo')` (carga, estado
  cargando/error/listo, categorías, pestaña activa) y `Alpine.data('menuSemana')` (menú de hoy y de la
  semana); aparición al hacer scroll respetando reducir movimiento. Nada de lógica de negocio en el HTML.
- `assets/js/agentes.js` → WebMCP en `document.modelContext` (NO `navigator`), igual que lusof
  (detección, `try/catch` por herramienta, registro en `alpine:initialized`, `window.RESPLANDOR_AGENTES`):
  `ver_local`, `ver_carta` (en vivo), `ver_menu_semana` (en vivo), `anotar_solicitud` (llena el store,
  valida), `ver_solicitud` (mensaje + enlace + recordatorio «la persona lo envía»;
  `untrustedContentHint`), `abrir_solicitud` (abre el `<dialog>`). Anotaciones `readOnlyHint` donde toca.
- Orden de carga en la landing (todos `defer`): local.js → solicitud.js → vivo.js → landing.js →
  agentes.js → alpinejs.

Descubrimiento estático: `scripts/descubrimiento.mjs` (con `--comprobar`) genera desde `local.js` +
`solicitud.js`: `llms.txt`, `local.json` (datos + reglas de la solicitud + `solicitud.ejemplos`: tres
salidas de `armarSolicitud` — reserva, almuerzo a domicilio con dirección y nota, y un tipo no-almuerzo
que pide domicilio y recibe el aviso; el Worker compara las tres para su huella +
`agentes: { webmcp: [nombres reales de agentes.js], mcp: null }` + cómo leer la carta
en vivo), `sitemap.xml` (landing, carta, menú), `robots.txt` (permitir todo + Sitemap), y el JSON-LD
`Restaurant` de `landing.html` entre `<!-- datos-estructurados:inicio -->` y `<!-- datos-estructurados:fin -->`
(address con streetAddress, geo, telephone, openingHoursSpecification Mo–Su 12:00–17:00,
maximumAttendeeCapacity 30, hasMap, menu → carta.html, acceptsReservations true, image, url
`https://resplandor.ynt.codes/landing.html`, servesCuisine; SIN aggregateRating). Si faltan los
marcadores, falla con un mensaje claro.

MCP remoto `mcp/worker.mjs` (Cloudflare Worker, JSON-RPC a mano sin SDK, stateless, POST /mcp, CORS
abierto, versiones `2025-11-25`, `2025-06-18`, `2025-03-26`, igual que lusof): tools
`resplandor_ver_local`, `resplandor_ver_carta` (vivo, filtro de categoría en JS),
`resplandor_ver_menu_semana` (vivo), `resplandor_preparar_solicitud` (usa `armarSolicitud`; devuelve
mensaje + enlace + aviso «no se envió nada»). Compara las reglas de `local.json` en vivo contra las
del bundle y pide redesplegar si difieren (patrón lusof). `mcp/wrangler.toml` (nombre
`resplandor-mcp`, ruta `mcp.resplandor.ynt.codes`, vars públicas), `mcp/LEEME.md` (probar local y
desplegar = pasos de Yonatan; NO desplegado). `local.json.agentes.mcp` queda `null`.

Pruebas `node --test scripts/pruebas/*.test.mjs` (glob expandido, nunca el directorio):
`solicitud`, `descubrimiento`, `mcp`, `webmcp` (vm con document/Alpine falsos como lusof),
`css` (compila a temporal y compara byte a byte; se salta con aviso si falta el CLI), `iconos`.
CI `.github/workflows/comprobar.yml` como el de lusof (npm ci, --comprobar de css/iconos/descubrimiento,
pruebas; solo señala, no bloquea el deploy de Pages).

## Landing nueva (dueño: parte landing) — `landing.html`
Secciones, en este orden (ids estables):
1. Franja superior: «Abierto todos los días · 12:00–17:00 · Cra. 61 #79 Sur-62, La Estrella».
2. Nav: monograma + Resplandor; enlaces (La casa, Menú de hoy, Carta, Celebraciones, Almuerzo
   programado, Cómo llegar); CTA «Reservar» → `$store.solicitud.abrir('reserva')`; menú móvil.
3. `#inicio` hero con `img/fachada-rojo-negro.webp` (fetchpriority high, width/height): H1, bajada
   honesta (cocina colombiana, asados y cocina mixta en La Estrella), 3 puntos (almuerzo todos los días
   12–5 · celebraciones en el local hasta 30 personas · menú de la semana que vota la gente), CTAs:
   Reservar mesa / Cotizar una celebración / Ver la carta.
4. `#hoy` menú de hoy y de la semana en vivo (`menuSemana`) + enlace a `menu.html` para votar.
5. `#carta` carta en vivo (`cartaVivo`, pestañas por categoría, precios COP sin decimales) +
   enlace a `carta.html`; estado de error con enlace a la carta.
6. `#celebraciones` tipos de celebración EN EL LOCAL (sin precios; «hasta 30 personas»), decoración
   con globos (se ve en la fachada), cada tarjeta → `abrir('<tipo>')`.
7. `#almuerzo-programado`: recoger en el local o domicilio con costo a cargo del cliente;
   CTA → `abrir('almuerzo')`.
8. `#la-casa`: la fachada real (`fachada-banderas`/`fachada-azules`), capacidad 30, reseñas: enlace
   «5,0 en Google Maps · 2 reseñas» a la ficha.
9. `#como-llegar`: dirección, plus code, horario, botones Google Maps / Cómo llegar / WhatsApp.
10. `#preguntas` FAQ con `<details>` (eventos solo en el local, capacidad 30, anticipación
    recomendada 48 h, almuerzo programado: recoger o domicilio a tu costo, cómo se paga/confirma: por
    WhatsApp con el restaurante). Nada de catering externo.
11. Pie: dirección, horario, WhatsApp, enlaces carta/menú, «para agentes: llms.txt».
12. Barra fija inferior en móvil (Reservar / WhatsApp), sin tapar contenido.
13. `<dialog id="solicitud">` con el formulario ligado a `$store.solicitud.datos` (tipo, fecha, hora,
    personas 1–30, nombre, nota; si tipo=almuerzo: frecuencia, entrega recoger/domicilio y dirección con
    la aclaración del costo), vista previa del mensaje (`armado.mensaje`), avisos, y el enlace
    «Abrir WhatsApp» (`armado.enlace`, target _blank, rel noopener) — la persona envía. Cerrar con
    botón y Escape; el foco vuelve al botón que lo abrió.
Head: title/description honestos, canonical, og:* (og:url, og:image `img/og-resplandor.jpg`),
twitter:*, theme-color, favicon, `<link rel="alternate" type="application/json" href="local.json">`,
`<link rel="alternate" type="text/plain" href="llms.txt">`, JSON-LD entre marcadores, sprite entre
marcadores, `assets/css/resplandor.css`, fuentes, scripts en el orden de arriba. `[x-cloak]` oculto.
Sin errores de consola; 375 px sin scroll horizontal; objetivos táctiles ≥ 44 px; contraste AA.
