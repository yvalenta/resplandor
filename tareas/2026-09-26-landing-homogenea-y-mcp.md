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
