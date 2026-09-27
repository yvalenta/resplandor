---
estado: en-curso
dueño: sesión
fecha: 2026-09-26
tema: landing de Resplandor con visual homogénea, datos reales (30 personas, sin eventos a domicilio, fachada) y MCP para agentes como en lusof
criterio_cierre: landing.html dice «30 personas» y ya no ofrece eventos fuera del restaurante (grep), muestra la fachada real y la ubicación del mapa, pasa sus pruebas de MCP/WebMCP como las de lusof, sin errores de consola en escritorio y 375 px; visto de Yonatan antes de empujar a main (main = resplandor.ynt.codes al aire)
---

Pedido de Yonatan del 2026-09-26, escrito en una sesión de `lusof` que ya iba en 402k y
cortó por la regla de corte: **nada de esto se empezó**. Lo que sigue es para arrancar
en frío.

## El pedido

«Actualicemos la landing de Resplandor: su visual, que sea homogénea; agreguémosle MCP
para que sea alcanzable por agentes, tal cual se hizo en lusof. La capacidad del
restaurante es de 30 personas. No se atienden eventos a domicilio. Sí se ve el
restaurante. Mejoremos la visual, la tecnología y demás.»

## Datos nuevos (de Yonatan, esta vez)

- **Capacidad: 30 personas.** Todo evento es en el local.
- **No hay eventos a domicilio.** Revisar cada CTA del cotizador de `landing.html`
  (`abrirCotizador(...)`, ~15 botones) y el mensaje de WhatsApp: nada que ofrezca ir a
  otro lugar.
- **Mostrar el restaurante.** Fotos que pasó, guardadas en `img/referencias/` sin
  optimizar:
  - `logo-r-dorada.png` — monograma «R» dorado dentro de un círculo.
  - `fachada-globos-banderas.webp`, `fachada-globos-azules.webp` — la fachada con el
    letrero «RESPLANDOR RESTAURANTE» y decoración de globos. En las dos se ve gente
    dentro del local de al lado y un afiche de otro negocio: recortar antes de publicar.
  - `fachada-globos-rojo-negro-captura-maps.webp` — **captura de Google Maps** (se ven
    las flechas y la marca «Google Maps»). No publicarla tal cual: preguntar si la foto
    es del restaurante o de un usuario de Maps.
- **Ubicación** (enlace de Google Maps que pasó): «Resplandor restaurante», lat
  `6.1584468`, lng `-75.6434789`, place `0x8e46810068dfd997:0x3dde7241f7aac6bf`.
  Sirve para el mapa/enlace «Cómo llegar» y el JSON-LD.

## Qué es «tal cual se hizo en lusof»

Leer en `~/Developer/lusof` antes de diseñar nada:

- `tareas/2026-09-26-mcp-pedidos.md` — la decisión de fondo: **la persona envía** (el
  agente arma el mensaje/enlace de WhatsApp, nunca envía ni cobra por su cuenta).
- `llms.txt` — la cara de texto para agentes.
- `assets/js/agentes.js` — WebMCP en la página.
- `mcp/worker.mjs`, `mcp/wrangler.toml`, `mcp/LEEME.md` — servidor MCP como Worker de
  Cloudflare. Desplegarlo es de Yonatan (Línea Roja: desplegar se aparca).
- `scripts/pruebas/mcp.test.mjs`, `scripts/pruebas/webmcp.test.mjs` — las pruebas que
  tienen que tener su gemela acá.
- Commit `173623e` de lusof («Agentes, pago USDC en Base y pase móvil; Tailwind
  compilado»): el pago en USDC **no** es parte de este pedido; no copiarlo sin preguntar.

En Resplandor el MCP solo puede tocar superficies públicas: la carta sale de la vista
`carta_publica` de Supabase (la de `carta.html`), y lo demás son datos del local
(horario, dirección, capacidad, cómo reservar o cotizar un evento en el local).
Nada del POS (`index.html`, RLS con login de Google).

## Visual homogénea: lo que ya se sabe

De la investigación del 26-sep (`~/Developer/lusof/docs/investigacion-2026-09-26.md`,
sección Resplandor):

- `landing.html` usa Tailwind v4 en el navegador con `@theme` y paleta OKLCH con selector
  de temas; `carta.html` y el resto usan el CDN viejo de Tailwind v3 con
  `tailwind.config` en JS. Dos sistemas de color y de tokens: esa es la falta de
  homogeneidad de fondo.
- Alpine sin fijar en la landing (`3.x.x`) y fijo en la carta (3.14.9); Lucide en
  `@latest` en unos archivos y 0.475.0 en otros. Fijar todo a la última del registro de
  npm (re-medir; el 26-sep eran alpinejs 3.17.4, lucide 1.48.0, @tailwindcss/browser
  4.3.3) o compilar Tailwind como terminó haciendo lusof.
- Faltas a no repetir: sin favicon, AOS sin respeto por «reducir movimiento», modales
  sin foco atrapado (lusof resolvió el cajón con `<dialog>` + `showModal()`).
- El JSON-LD de la landing declara `aggregateRating`, horarios y `acceptsReservations`:
  verificar con Yonatan antes de mantener cualquier cifra.

## Bitácora

- 2026-09-26: tarea declarada desde la sesión de lusof (402k, regla de corte). Fotos
  copiadas a `img/referencias/`, **fuera de git** a propósito (`.git/info/exclude`): el
  repo es público y tienen gente y una captura de Maps. Las versiones recortadas y
  optimizadas que se publiquen van a otra ruta (p. ej. `img/fachada-*.webp`). No se tocó
  ningún HTML.
- 2026-09-26: en curso. Sesión nueva (arrancó en lusof; Yonatan pidió seguir desde ahí
  con rutas absolutas porque el harness no cambia de directorio). Primero: leer lusof y
  la landing, preguntar lo que no se puede verificar (foto de Maps, calificación y
  horario del JSON-LD).
- 2026-09-26: respuestas de Yonatan: la foto de Maps es del restaurante (se publica
  recortada, sin flechas ni marca); calificación = la de Google Maps (5,0 con 2 reseñas,
  leída de la ficha; va visible con enlace, NO en el JSON-LD porque Google prohíbe marcar
  reseñas de otro sitio); horario todos los días 12:00–17:00 (Maps dice domingo 11:00:
  corregir la ficha); almuerzo programado existe: se recoge en el local o domicilio con
  costo a cargo del cliente; testimonios fuera; precios de eventos fuera (la carta se lee
  en vivo de `carta_publica`). Dirección de la ficha: Cra. 61 #79 Sur-62, Poblado del Sur.
- 2026-09-26: **Supabase responde 402 `exceed_egress_quota`** (proyecto restringido por
  cuota de egress): afecta carta, menú y probablemente el POS en producción. Es de
  Yonatan (plan / tope de gasto). Las secciones en vivo de la landing muestran su estado
  de error mientras tanto.
- 2026-09-26: implementado por workflow (base visual, imágenes, capa de agentes, landing,
  carta/menú): 95/95 pruebas, `--comprobar` de css/iconos/descubrimiento en 0. Diseño en
  el scratchpad de la sesión; verificación (navegador, contenido, refutación, regresiones)
  en curso.
- 2026-09-26: **corte por regla de 200k** (sesión en 220k). Todo en la rama local
  `landing-homogenea-y-mcp` (sin push; `main` intacto salvo los commits de esta tarea).
  Diseño y contratos: `docs/landing-y-agentes.md`. Hecho: landing nueva (datos reales,
  `<dialog>` de solicitud → WhatsApp, carta y menú en vivo), carta y menú en el sistema
  común (Tailwind 4.3.3 compilado `assets/css/resplandor.css`, sprite Lucide inline,
  Alpine 3.17.4 fijo), imágenes recortadas sin gente ni marca de Maps, favicon/OG, capa
  para agentes (WebMCP 6 tools, `mcp/worker.mjs` 4 tools SIN desplegar, `llms.txt`,
  `local.json`, JSON-LD generado), CI `comprobar.yml`. Dos rondas de verificación
  (navegador, contenido, refutador, regresiones): 30 hallazgos de la ronda 1 corregidos;
  **114/114 pruebas**, los tres `--comprobar` en 0.
  **Falta (ronda 3), en orden:**
  1. CRÍTICO `menu.html` a 375 px: scroll horizontal por el botón «Hoy» sin `w-auto`
     (`.btn` de `componentes.css` es `width:100%`); revisar todo `.btn` de carta/menú.
  2. Táctiles < 44 px en la landing: `a.btn.btn-ghost` de los estados de error (39),
     `<summary>` del FAQ (24), enlaces del pie (16).
  3. Refutador ronda 2 (sin crít/alto): N1 WebMCP no avisa entrega-domicilio fuera de
     almuerzo y el Worker sí (unificar); N2 `llms.txt:7` y `RECORDATORIO` de
     `agentes.js` aún le hablan al lector en imperativo (tercera persona: la persona
     abre y envía); N3 la huella del Worker usa un solo ejemplo (sumar almuerzo +
     domicilio + nota); N4 tope de cuerpo sin Content-Length y en bytes; N5 pruebas
     que pasan con mutantes (click al enlace wa.me en `abrir_solicitud`, fetch del
     enlace solo en almuerzo); N6 «hoy» de la landing en hora del visitante y
     `menu.html:351` también (todo a UTC−5); N7 rellenos invisibles U+2800, U+3164,
     U+115F, U+200B en la nota; N8 el Worker descarta en silencio campos no-string,
     `agentes.js:166` corta emojis por la mitad, `worker.mjs:346` filtra `err.message`.
  4. `menu.html`: registrar el 402 por `console.warn` como la landing.
  5. Re-verificar (navegador a 375/1440 + refutador solo del diff); después, visto de
     Yonatan y merge a `main`.
  **De Yonatan:** Supabase 402 (plan/tope de gasto; tumba carta, menú y POS); push;
  desplegar el MCP (`mcp/LEEME.md`) y luego poner su URL en `local.json.agentes.mcp`;
  corregir en Google Maps el horario del domingo (dice 11:00); OK a los tipos «Plan
  menú ejecutivo», «Plan barril» y «All-inclusive» como paquetes EN el local (se quitó
  «Buffet al barril» porque era externo); decidir si se borran `img/hero-portrait.jpg`
  (8 MB) y `img/dia_del_padre1.png` (7 MB), que nada referencia. Fuera de alcance: el POS.
