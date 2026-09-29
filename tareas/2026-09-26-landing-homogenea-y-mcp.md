---
estado: en-curso
dueño: sesión
fecha: 2026-09-26
tema: landing de Resplandor con visual homogénea, datos reales (30 personas, sin eventos a domicilio, fachada) y MCP para agentes como en lusof
criterio_cierre: landing.html dice «30 personas» y ya no ofrece eventos fuera del restaurante (grep), muestra la fachada real y la ubicación del mapa, pasa sus pruebas de MCP/WebMCP como las de lusof, sin errores de consola en escritorio y 375 px; visto de Yonatan antes de empujar a main (main = resplandor.ynt.codes al aire). Ampliado el 2026-09-28: las fotos y videos del 28-sep quedan clasificados, renombrados y optimizados en `img/referencias/<categoría>/` con un índice, y la landing renovada toma su carácter de esas fotos (como lusof de las suyas). Y pasa con buen puntaje https://isitagentready.com/ e https://is-agentic.com/ medidos sobre resplandor.ynt.codes al aire (puntaje y captura en la bitácora). Y la landing queda en la raíz (https://resplandor.ynt.codes/) y el POS en `/pos.html` (con `noindex` y `Disallow` en `robots.txt`), `landing.html` redirige a la raíz y, al aire, el login de Google del POS entra por `/pos.html`
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
- 2026-09-27: ronda 3 cerrada en sesión nueva (Yonatan: «continúa, no me preguntes, itera
  hasta finalizar»). Commit `35c4173` + el commit de cierre de esta entrada, en la rama local
  `landing-homogenea-y-mcp` (sin push). Hecho: los 5 puntos de «Falta (ronda 3)» — `.btn`
  ya no es ancho completo por defecto (menu.html a 375 sin scroll: 408→375), táctiles ≥ 44
  (FAQ, pie, chips de día, pestañas de la carta en vivo, labels de entrega, nav de
  escritorio), menu.html registra el 402 con `console.warn`, «hoy» en America/Bogota en
  landing, menú y carta (`scripts/pruebas/hoy.test.mjs`), N1–N8 del refutador. Refutador
  ronda 3 sobre `102e3a3..35c4173`: 0 crít/alto, 3 medios (R1 el recorte por grafemas perdió
  el techo —×10 en el Worker—, R2 aviso de domicilio heredado, R3 el mutante del clic a
  wa.me sobrevivía) + 5 bajos; revisión de contenido: «usted» mezclado en carta.html (pasado
  a «tú»). Todo cerrado y re-verificado con los propios repros del refutador (zalgo → 300
  puntos, amplificación ×0,1, mutantes de R1 y R3 matan la suite). Evidencia final:
  **160/160 pruebas**, css/iconos/descubrimiento `--comprobar` en 0; Playwright a 375 y
  1440 en landing/carta/menú: sin scroll horizontal, 0 táctiles < 44, 0 errores de consola.
  | ronda | sha | crít/alto | regresiones propias |
  | 1 | (sin commit) | — | — (30 hallazgos corregidos) |
  | 2 | 102e3a3 | 0 | — |
  | 3 | 35c4173 | 0 | 2 (R1, R2), cerradas |
  Dos rondas seguidas sin crít/alto: se para por la regla del refutador; no se lanzó ronda 4.
  Aceptado sin tocar: el paso transitorio del foco por `<body>` al tabular en el `<dialog>`
  (nativo de `showModal`); U+180E (MVS mongol) se borra como relleno de ancho cero; el
  fallback `localDePrueba()` de `mcp.test.mjs` lista 3 ejemplos (solo corre sin local.json).
  Supabase sigue en **402** (medido hoy: `carta_publica` y `menus`); la carta muestra su foto
  del 3-sep, la landing y el menú su estado de error.
  **Bloqueada por Yonatan**, en orden: (1) el visto a la rama a 375 y 1440
  (`python3 -m http.server` en el repo → `landing.html`, `carta.html`, `menu.html`), incluido
  el cambio de trato «usted» → «tú» en la cuenta de carta.html; (2) merge a `main` y push
  (`main` = resplandor.ynt.codes al aire); (3) Supabase 402 (plan / tope de gasto; tumba
  carta en vivo, menú y POS); (4) desplegar el MCP (`mcp/LEEME.md`) y poner su URL en
  `local.json.agentes.mcp` (hoy `mcp: null` en `scripts/descubrimiento.mjs:227`, y el
  texto de :273) + `node scripts/descubrimiento.mjs`;
  (5) corregir en Google Maps el horario del domingo (dice 11:00); (6) OK a «Plan menú
  ejecutivo», «Plan barril» y «All-inclusive» como paquetes en el local; (7) decidir si se
  borran `img/hero-portrait.jpg` (8 MB) y `img/dia_del_padre1.png` (7 MB).
- 2026-09-27: recorrido en Chrome real a pedido de Yonatan («hazlo tú, integra navegador y navega
  por cada uno»): landing, carta y menú en ventana de 2256 px y en marcos de 375 px. Formulario,
  enlace wa.me (`_blank`, `noopener`), Escape y foco de vuelta a «Reservar» funcionan. Salieron 10
  hallazgos que las pruebas no veían, todos cerrados en el commit de esta entrada y re-medidos
  en Playwright por un verificador aparte: A anclas del nav bajo la cabecera sticky
  (`scroll-padding-top: 5rem`); B barra fija de carta.html tapando el pie en pantalla ancha;
  C secciones de la landing con dos anchos (los 7 h2 ahora arrancan en el mismo borde: 168 px a
  1440); D letrero cortado «RESPLANDO» en #la-casa (proporción nativa de cada foto); E diálogo
  al 45 % del alto en escritorio (ahora `min(90dvh, 52rem)`); F coma de sobra en «a domicilio
  (falta la dirección)»; G fecha cortada a 375 (fecha y hora apiladas); H estado de error de
  menu.html sin emoji, sin culpar a la red y con el patrón de la landing; I la pestaña activa de
  la carta se desplaza a la vista; J botones del hero iguales en móvil. 160/160 pruebas,
  css/iconos/descubrimiento `--comprobar` en 0, 0 hallazgos nuevos del verificador.
  Mural: Yonatan pasó una foto de un mural del restaurante (mujer indígena con flores y tocado);
  quedó en `img/referencias/mural-mujer-indigena.png`, fuera de git. Es 400×698 (parece
  captura) con un borde oscuro abajo a la izquierda: recortar; para algo grande pedir la foto
  original y el nombre de quien lo pintó (crédito). Lugar natural: #la-casa, junto a la fachada.
  **Corte por regla de 200k** (sesión en 242k). Lo próximo, en sesión nueva: (1) sumar el mural
  a #la-casa (recortado, webp, alt fiel, crédito si Yonatan lo da); (2) mirar una vez #hoy y
  #carta de la landing con datos reales cuando Supabase vuelva (el ancho nuevo `max-w-2xl` solo
  se vio en estados de error). Lo de Yonatan sigue igual que en la entrada anterior (visto,
  merge y push, Supabase 402, MCP, Maps domingo, paquetes, imágenes pesadas).

- 2026-09-28: **pedido nuevo de Yonatan**, sesión nueva: «te daré recursos nuevos de imágenes del
  restaurante, necesito renovar la página, mejorarla; tenemos como referencia lusof, una landing que
  refleja justo la identidad del negocio; ahora queremos renovar la landing de Resplandor, que sea
  característica, reflejada en las imágenes; clasifica, renombra, optimiza y ajusta las nuevas imágenes
  como recursos oficiales en la carpeta /img/referencias/*». Y: «coordina agentes para lo que necesites».
  Llegaron 25 fotos y 4 videos de WhatsApp (17:58–17:59) en `img/referencias/`: salón con pared
  terracota y letrero dorado, mural de la mujer indígena en el salón, fachada de día (globos, banderas),
  de día con flores y de noche iluminada, platos en estudio sobre fondo oscuro con el mural de fondo,
  platos servidos en mesa, bebidas en vasos de barro, una pieza publicitaria (lunes 20 %). Plan: los
  crudos pasan a `img/referencias/_originales/` (el único trozo fuera de git); lo oficial sale
  clasificado y optimizado a `img/referencias/<categoría>/` (dentro de git, publicable), con índice.
  La paleta y el carácter de la landing se derivan de las fotos. Reparto por workflow.
- 2026-09-28: **dato nuevo de Yonatan**: eventos y celebraciones «de 10 a 30 personas» (mínimo 10, máximo 30; la
  mesa común no tiene mínimo). Llegó con una captura de WhatsApp de la landing VIEJA al aire en `main` («10–500
  personas», «desde 10 hasta 500», «4,9/5 · 1240 reseñas»), donde el mensaje reenviado dice «10 a 35»; Yonatan
  escribió 30 y 30 es la capacidad declarada: se aplica 30 y el 35 queda como pregunta. Corrección por workflow
  aparte (`wf_e153c97d-a81`) en paralelo a la curaduría de imágenes (`wf_f4ad3256-a0e`).
- 2026-09-28: hecho y comiteado en la rama (sin push): `15d7008` rango 10–30 (regla única en `solicitud.js`,
  refutado, 4 medios cerrados; 182 pruebas, 181 verdes: la roja es la semana fija de `webmcp.test.mjs`) y `fd441a4`
  recursos oficiales (27 publicables en `img/referencias/<categoría>/`, `recursos.json`, `LEEME.md`,
  `scripts/recursos-imagen.sh`; crudos en `_originales/` fuera de git). Brief visual en `docs/identidad-visual.md`
  («Entrar al local»: hero = pared terracota; base P1 «la casa» 24/30 contra P2 «el mural y la mesa» 18,5/30).
  Implementación + verificación + reparación en curso por workflow `wf_305a0835-af1` (base `fd441a4`).
  Preguntas abiertas para Yonatan: 35 o 30 (el mensaje reenviado dice 35); cena romántica en pareja sin mínimo
  (decisión por defecto, a confirmar); autor, permiso y crédito del mural (sin eso no hay motivo del mural); ¿hay
  celebraciones después de las 17:00? (define si se usa la fachada de noche); nombres de los platos de estudio;
  ¿desayunos? (video no publicado); mojarra, hamburguesa y servicio de grupo fuera de la landing (¿recortar o
  retirar?); PNG transparente del logo (archivo fuente).
- 2026-09-28: **giro de dirección** (Yonatan): «Resplandor es de Camila y ella quiere renovar; hacerlo más auténtico con
  los recursos», «no necesariamente la identidad del sistema POS», «libertad absoluta en replantear identidad y
  colores». La v1 (paleta del POS, mural fuera) quedó como punto de control `6626097` (233/233); su ronda 1 de
  reparación se detuvo a medias y sus hallazgos de la ronda 0 pasan a la v2. La cara pública (landing, carta, menú) toma
  identidad propia de las fotos; el POS no se toca; el mural entra como identidad (crédito: pregunta a Camila). Workflow
  `wf_f03d3256-20a`: tres direcciones con maqueta (la selva del salón · barro y terracota · la cocina en escena), juez
  → `docs/identidad-visual.md` v2, implementación, verificación en cuatro lentes y hasta dos rondas de reparación.
  Las preguntas de negocio de las entradas anteriores ahora son para Camila.
- 2026-09-28: **corte por regla de 200k** (sesión en 202k). Pedido nuevo de Yonatan al cierre: «también necesitamos un MCP
  para que la landing sea leída por agentes de IA». **Ya existe en la rama**: WebMCP en la landing
  (`assets/js/agentes.js`), servidor MCP como Worker de Cloudflare (`mcp/worker.mjs`, `mcp/LEEME.md`, **sin
  desplegar**), `llms.txt`, `local.json` y JSON-LD, con sus pruebas (`mcp.test.mjs`, `webmcp.test.mjs`). Falta lo de
  Yonatan: desplegar el Worker según `mcp/LEEME.md`, poner su URL en `local.json.agentes.mcp` (la fuente es
  `scripts/descubrimiento.mjs`, hoy `mcp: null`) y correr `node scripts/descubrimiento.mjs`; y el merge a `main` para
  que la capa quede al aire. No se construyó nada nuevo por este pedido.
  **Quedó corriendo** el workflow `wf_f03d3256-20a` (identidad v2), que escribe en el árbol de trabajo SIN commit. Su
  diario: `~/.claude/projects/-Users-yonatan-Developer-resplandor-resplandor/fe3e622e-3c3f-4dfc-a04f-25b1a2aea8f5/subagents/workflows/wf_f03d3256-20a/journal.jsonl`
  (una línea `result` por agente; la última trae `decision`, `historial` y `verificacion_final`). Insumos y capturas en el
  scratchpad de esta sesión, `/private/tmp/claude-501/-Users-yonatan-Developer-resplandor-resplandor/fe3e622e-3c3f-4dfc-a04f-25b1a2aea8f5/scratchpad/`
  (`v2/direccion-{1,2,3}/`, `v2/capturas/`, `identidad/informe.md`, `lusof-informe.md`, `hallazgos-r0.md`).
  **Lo próximo, en sesión nueva:** (1) ver si el workflow terminó (diario) y en qué ronda quedó; `git diff 6626097`
  es la v2; correr pruebas y los tres `--comprobar`; si está en verde y la verificación final limpia, commit de la v2
  (sin `tareas/` mezclado); si quedó a medias, retomar desde `docs/identidad-visual.md` v2 y los hallazgos abiertos.
  (2) Mostrarle a Yonatan la dirección elegida con capturas a 375 y 1440, antes de nada más. (3) Preguntas para
  Camila: 30 o 35 (el mensaje reenviado dice 35); cena romántica en pareja sin mínimo; autor y crédito del mural;
  ¿celebraciones después de las 17:00? (fachada de noche); nombres de los platos de estudio; ¿desayunos?; mojarra,
  hamburguesa y servicio de grupo; logo fuente para un PNG transparente. (4) De Yonatan, igual que antes: visto,
  merge y push, Supabase 402, desplegar el MCP, domingo en Maps, paquetes, imágenes pesadas de `img/`.
- 2026-09-28: pedido de Yonatan: «añadir a tarea pasar un score en https://isitagentready.com/ y
  https://is-agentic.com/». Sumado al criterio de cierre. Se mide sobre el sitio al aire, así que va después del merge y
  el push (y, para el MCP remoto, después de desplegar el Worker). Primero se corre contra `main` como está hoy para tener
  la línea base, y después contra la rama al aire; se anotan puntaje, fecha y lo que cada sitio reprueba.
- 2026-09-28: Yonatan: «orquesta en worktrees las tareas para que su contexto esté fresco». Lanzado desde la sesión ya
  cortada, con los agentes en contexto propio: workflow `wf_f4311776-1a2` (resplandor-agentes-listos). Mide la línea
  base de resplandor.ynt.codes en isitagentready.com e is-agentic.com (informe en el scratchpad,
  `agentes-listos/linea-base.md`) y cierra lo que falte en un **worktree propio, rama local `agentes-listos`** (commit
  sin push), para no chocar con la v2, que escribe en el árbol principal (`wf_f03d3256-20a`). Los diarios de los dos
  están en `~/.claude/projects/-Users-yonatan-Developer-resplandor-resplandor/fe3e622e-3c3f-4dfc-a04f-25b1a2aea8f5/subagents/workflows/<run>/journal.jsonl`.
  La sesión nueva integra: la v2 primero (commit en esta rama) y después el merge de `agentes-listos`, resolviendo
  conflictos en `scripts/descubrimiento.mjs` y las pruebas de agentes; luego el visto de Yonatan.
- 2026-09-28: Yonatan: «¿pasamos el POS a https://resplandor.ynt.codes/pos.html y la landing a la raíz?» → «sí, súmalo a
  la tarea». Sumado al criterio de cierre. Motivo: hoy la raíz es el POS (`index.html`, login de Google, sin `noindex`
  y con `robots.txt` en `Allow: /`), así que Google y los escáneres de agentes ven un login en vez de la landing; la
  línea base de `agentes-listos` se mide así. **Va en un commit aparte, después de integrar la v2 y `agentes-listos`**
  (las dos tocan `landing.html`, `scripts/descubrimiento.mjs` y las pruebas): `git mv index.html pos.html` y
  `git mv landing.html index.html`; un `landing.html` nuevo que redirige a `/` (meta refresh + canonical) para no romper
  enlaces ya publicados (Maps, Instagram, lo impreso); canonical, `og:url`, `sitemap.xml`, `llms.txt`,
  `scripts/descubrimiento.mjs` y las pruebas pasan a la raíz (`grep -rl 'landing\.html'`: ~25 archivos); `pos.html` con
  `noindex` y `Disallow: /pos.html`; en la landing, un enlace discreto «Abrir POS» que solo se ve en equipos con sesión
  del POS (la clave `sb-…-auth-token` del mismo origen), sin redirección automática. No cambian: los enlaces NFC de la
  carta (se arman con `location.origin`, `index.html:2601`) ni el MCP (`mcp.resplandor.ynt.codes`). **Aparcado para
  Yonatan, antes del push:** (1) en Supabase → Authentication → URL Configuration → Redirect URLs, permitir
  `https://resplandor.ynt.codes/pos.html`: el POS pide volver a su propia ruta (`index.html:1937`) y, si no está
  permitida, Supabase manda al Site URL —la raíz, que será la landing— y nadie entra; esa lista no vive en el repo;
  (2) volver a guardar el acceso al POS en los equipos del restaurante; (3) push fuera del horario de servicio.
- 2026-09-29: **`agentes-listos` cerrado** (worktree `.claude/worktrees/wf_f4311776-1a2-2`, rama local
  `agentes-listos` — sin push, commit de esta entrada). Solo lectura sobre `/resplandor` (el árbol de trabajo
  principal, donde escribe la v2 de identidad): nunca se tocó, solo `git show` contra `landing-homogenea-y-mcp`.
  Línea base medida por la sesión madre (`agentes-listos/linea-base.md` en su scratchpad): isitagentready.com
  0/15 e is-agentic.com 60/100 contra la raíz en vivo (hoy sirve el POS, no esta rama). Esta tarea cierra lo que
  faltaba DE VERDAD en el repo (nunca infraestructura de borde), todo generado extendiendo
  `scripts/descubrimiento.mjs` (nunca a mano), sin tocar `landing.html` más allá del bloque que ya generaba
  (siguió «sin cambios» en las corridas de verificación). Cerrado: `auth.md` (por qué NO hay OAuth: no existe
  ninguna escritura pública que proteger); páginas ancla `about.html`/`contact.html`/`privacy.html` y `404.html`
  (HTML sin `<script>`, contenido real, `sitemap.xml` las suma); `.well-known/api-catalog` (RFC 9727, linkset
  con `carta_publica`/`menus` de Supabase; el MCP remoto queda AFUERA hasta que exista de verdad);
  `.well-known/mcp/server-card.json` (SEP-2127 — nombre, versión y las 4 tools con su inputSchema/anotaciones
  leídos DE VERDAD de `mcp/worker.mjs` por su propio transporte JSON-RPC, nunca copiados a mano; `remotes: []` +
  `_meta.despliegue` mientras el Worker siga sin desplegar, mismo patrón que `agentes.mcp: null`);
  `.well-known/agent-skills/` (índice + 2 skills en Markdown con frontmatter — `consultar-resplandor` y
  `preparar-solicitud-resplandor`, esta última con «la persona envía» explícito; sin una tercera skill de
  enviar/reservar/cobrar porque esa operación no existe en ningún lado del sitio); `.well-known/ai-catalog.json`
  (ARD, esquema de ards-project/ard-spec); `robots.txt` con Content-Signal (`search=yes, ai-input=yes,
  ai-train=yes` — política de apertura total, coherente con que el sitio entero existe para que lo encuentren
  agentes) y 16 bots de IA nombrados (antes solo `User-agent: *`). `mcp/worker.mjs` sumó un solo `export`
  aditivo (`VERSIONES_SOPORTADAS`) para que el generador y sus pruebas lean la lista real en vez de copiarla —
  cero cambio de comportamiento, el Worker sigue sin desplegar. `assets/js/local.js` sumó
  `enlaces.about/contacto/privacidad`. 246/246 pruebas (33 nuevas en `descubrimiento.test.mjs` +
  `mcp.test.mjs`), los tres `--comprobar` (css/iconos/descubrimiento) en 0.
  **Queda de verdad para después** (nada de esto lo da esta rama ni el Worker): Web Bot Auth, DNS-AID, Link
  headers RFC 8288 y negociación Markdown real (infraestructura de borde sobre el DOMINIO PRINCIPAL —
  `mcp.resplandor.ynt.codes` no lo toca — decisión de Yonatan); OAuth discovery NO se fabricó a propósito (ver
  `auth.md`: no hay nada que proteger); todo lo que exige que el Worker se despliegue (entra solo a
  `server-card.json`/`api-catalog`/`ai-catalog.json`/`local.json` al correr `descubrimiento.mjs` después) o que
  la raíz deje de ser el POS (JSON-LD, meta og:/canonical y «contenido sin JS» de la raíz siguen invisibles al
  escáner hasta entonces). **De Yonatan/merge:** desplegar el Worker sigue aparcado (Línea Roja); el merge de
  esta rama a `landing-homogenea-y-mcp`/`main` va DESPUÉS de la v2 de identidad, con conflicto esperado y chico
  en `scripts/descubrimiento.mjs` (bloque `agentes`/`robots`) y ninguno en `landing.html` (no se tocó); publicar
  cualquiera de las dos ramas ya sube robots.txt/sitemap.xml/auth.md/`.well-known/*` en isitagentready.com/
  is-agentic.com sin depender del despliegue.
- 2026-09-29: `wf_f4311776-1a2` terminó. Línea base al aire: **isitagentready 0/15** (informe y capturas en el
  scratchpad, `agentes-listos/`). Hallazgo de fondo: la raíz `resplandor.ynt.codes/` sirve el **POS** (`index.html`),
  no la landing; los escáneres miden la raíz, así que JSON-LD y WebMCP de `landing.html` no cuentan. **Decisión de
  Yonatan:** ¿la raíz pasa a ser la landing y el POS se muda (p. ej. `/pos/`), cuidando marcadores y pegatinas NFC?
  Rama local `agentes-listos` @ `8dd8e88` en el worktree `.claude/worktrees/wf_f4311776-1a2-2` (246/246 pruebas,
  --comprobar en 0): `.well-known/` (server-card MCP, api-catalog, agent-skills, ai-catalog), auth.md, robots con
  Content-Signal y bots de IA, about/contact/privacy/404. **Revisar antes del merge:** `ai-train=yes` en Content-Signal
  (decisión de Camila y Yonatan, no un valor por defecto) y el texto de `privacy.html` (política de privacidad escrita
  por un agente). Ojo: el árbol principal apareció en `329c317`, un commit que no hizo la sesión madre (¿un agente
  de la v2?): revisarlo antes de integrar.
