# Resplandor — landing homogénea + capa para agentes (especificación compartida)

Repo: `/Users/yonatan/Developer/resplandor/resplandor` (git, público, GitHub Pages en
`https://resplandor.ynt.codes`, `main` = al aire). Referencia del patrón: el repo `lusof` (`~/Developer/lusof`).

## Reglas duras (Línea Roja)
- NO `git commit`, NO `git push`, NO `wrangler deploy`, NO migraciones ni escrituras a Supabase,
  NO borrar archivos existentes del repo. `npm install` local sí. La sesión madre revisa y comitea.
- `img/referencias/_originales/` está fuera de git a propósito (crudos con gente sin recortar,
  capturas de Maps, promos con precios): nunca lo referencies desde HTML ni lo copies tal cual.
  El resto de `img/referencias/<categoría>/` (ya recortado y optimizado) SÍ es publicable y SÍ
  entra a git — `img/referencias/recursos.json` es su única verdad (`publicable`, `alt`,
  variantes por ancho con sus `bytes` reales). El HTML de landing/carta/menú solo usa recursos
  con `publicable: true` de ahí, nunca `_originales/` ni un id `publicidad-*`. Ver
  `img/referencias/LEEME.md` y la receta `scripts/recursos-imagen.sh`.
- Tocá SOLO los archivos que tu parte posee (lista abajo). Si necesitás algo de otra parte, adaptate
  al contrato de esta especificación; no edites archivos ajenos.
- Todo el texto visible en español de Colombia, trato de «tú» (como la landing actual).
- Fuera de alcance: `pos.html` (el POS de uso diario; su lado visual lo rige `docs/pos-visual.md`), `resplandor.html`,
  `landing_old.html`, `resplandor_printer.html`, `resplandor-pos-sdd.html`, `supabase/`.

## Raíz del sitio: dónde vive cada página (mudanza del 2026-09-29)
`https://resplandor.ynt.codes/` es la landing. Hasta esa fecha la raíz era el POS, así que Google y los escáneres de
agentes veían un login en vez de la landing.
- `/` → `index.html`: la landing (canonical, `og:url` y JSON-LD a la raíz; WebMCP; indexable).
- `/pos.html` → el POS de uso diario (login de Google con Supabase). Lleva `<meta name="robots" content="noindex, nofollow">`,
  `robots.txt` le pone un `Disallow: /pos.html` en CADA grupo (un bot con grupo propio ignora el de `*`) y el
  `sitemap.xml` no lo lista. Su OAuth pide volver a `origin + pathname`, o sea a `/pos.html`; del POS no cambió nada más.
- `/landing.html` → una redirección mínima a `/` (`location.replace` con la query y el ancla, `<noscript>` con el meta
  refresh, canonical a la raíz, `noindex`, un enlace visible), para no romper los enlaces ya publicados (Maps,
  Instagram, lo impreso). `robots.txt` NO la bloquea: bloqueada, un rastreador no llegaría a ver la redirección.
- `carta.html` y `menu.html` no cambian de lugar: los enlaces de las pegatinas NFC (`carta.html?m=&k=`) se arman con
  `location.origin`. Todos enlazan de vuelta a la landing con `href="/"`.
- Reenvío del login: si `/pos.html` no está entre las Redirect URLs de Supabase (Authentication → URL Configuration; esa
  lista no vive en el repo), Supabase devuelve a la Site URL, que es la raíz, con `?code=…` (PKCE, el flujo del POS),
  `#access_token=…` o `#error_description=…`. El primer script del `<head>` de `index.html` se lo pasa al POS
  (`location.replace('/pos.html' + search + hash)`) y la sesión llega igual.
- «Abrir POS»: un enlace discreto en el pie de la landing, oculto (`hidden`) salvo que `localStorage` tenga una clave
  `/^sb-.+-auth-token$/` (la sesión de supabase-js del mismo origen). Nunca redirige por su cuenta.
- Lo que los generadores leen por nombre: `assets/css/entrada-tailwind.css` escanea `index.html`, `carta.html`, `menu.html`
  y `assets/js` (nunca `pos.html`, que carga su propio Tailwind CDN; su lado visual lo rige `docs/pos-visual.md`), `scripts/iconos.mjs` procesa esas tres páginas y
  `scripts/descubrimiento.mjs` escribe el JSON-LD en `index.html` (`--landing <ruta>` sigue existiendo para las pruebas).
  Las pruebas de la mudanza están en `scripts/pruebas/raiz.test.mjs`.
- Lo aparcado para Yonatan (Redirect URLs de Supabase, volver a guardar el acceso al POS en los equipos del restaurante y
  el push fuera del horario de servicio) vive en la bitácora de `tareas/2026-09-26-landing-homogenea-y-mcp.md`.

## Funciones que se pueden apagar (2026-09-29)
**Pedido de Yonatan (2026-09-29), con Supabase en 402 (cuota; se arregla después y no se toca desde acá):** apagar el menú de
hoy y el almuerzo programado «por el momento» con una especie de feature flag, y que la carta se vea aunque Supabase no
responda. Hoy la landing mostraba dos cajas de error («No pudimos cargar el menú de hoy» y «No pudimos cargar la carta en
vivo»).

**Las banderas** viven en UN solo lugar: `const FUNCIONES` de `assets/js/local.js` (expuestas como `RESPLANDOR.funciones`), con
el comentario de cómo re-encender pegado a ellas. Hoy las tres están en `false`.

| Bandera | Es | Con `false` desaparece |
|---|---|---|
| `menuDeHoy` | El menú de hoy y de la semana: sección `#hoy` de la landing, el menú semanal y su votación (`menu.html`), y las herramientas `ver_menu_semana` (WebMCP) / `resplandor_ver_menu_semana` (MCP). Todo vive de la tabla `menus` de Supabase. | La sección `#hoy` (no se pinta, no llama a Supabase), su enlace en el menú de escritorio y en el móvil, la viñeta «Un menú de la semana que la gente vota» del hero, «Menú de la semana» del pie de la landing, de `carta.html` y de `menu.html`, el enlace «Ver las opciones de la semana» de la tarjeta del día y la acción de la barra fija de `carta.html` (pasa a «Reservar por WhatsApp»). `menu.html` queda como un aviso sereno («El menú de la semana no está disponible por ahora») con enlaces a la carta y a reservar por WhatsApp: no carga supabase-js, no crea cliente, no toca `localStorage`, pide `noindex` y sale del sitemap. `leerMenuSemana` (vivo.js) rechaza sin hacer ninguna llamada, `landing.js` ni registra el componente `menuSemana`, y el Worker no lista ni atiende `resplandor_ver_menu_semana`. Fuera también de `local.json` (`enlaces.menu`, `menu_semana_en_vivo`), `llms.txt`, `sitemap.xml`, `auth.md`, api-catalog, ai-catalog, server-card, skills, las páginas de texto, la descripción del JSON-LD y la del MCP. |
| `almuerzoProgramado` | El almuerzo programado: sección `#almuerzo-programado`, el tipo de solicitud `almuerzo` y lo que solo existe para él (entrega, dirección, frecuencia). | La sección `#almuerzo-programado` y sus enlaces del menú de escritorio y móvil, la pregunta frecuente del domicilio del almuerzo, la frase «la única excepción es el almuerzo programado» de las preguntas, el bloque de frecuencia/entrega/dirección del diálogo y el tipo `almuerzo` del `<select>` (sale de `RESPLANDOR.tipos`). Los campos `entrega`, `direccion` y `frecuencia` desaparecen de `anotar_solicitud` (WebMCP) y de `resplandor_preparar_solicitud` (MCP); `local.json` no lleva `entregas`, `frecuencias` ni `politicas.almuerzoDomicilioCostoCliente`, y ni los ejemplos ni ninguna prosa generada hablan del almuerzo programado. Pedir el tipo `almuerzo` a mano cae en el aviso de «tipo que no existe» de `armarSolicitud`. El «Almuerzo todos los días, 12:00–17:00» del local no es esta función y no se toca. |
| `pagarEnMesa` | El botón «Pagar» de «Mi cuenta» en `carta.html` (hoja y panel): el cliente elige QR, transferencia o efectivo y eso avisa al mesero (POST a la Edge Function `alerta`). Solo es de `carta.html`: no se anuncia a los agentes (`local.json`, `llms.txt`, WebMCP, MCP). Lo único generado que la lee es `privacy.html` y `auth.md`: con ella encendida dicen que «Pagar» solo avisa al personal y que ninguna página muestra a dónde pagar (apagada, no hablan de un botón que no existe). | El botón, las tres opciones y el estado «avisado» (van dentro de `<template x-if="pagarEnMesa…">`: ni existen en el DOM) y toda llamada a `alerta`. Se enciende cuando `alerta` esté desplegada. |

**Re-encender es cambiar el `false` por `true` en `assets/js/local.js` y correr `node scripts/descubrimiento.mjs`** (regenera
`llms.txt`, `local.json`, `sitemap.xml`, el JSON-LD de `index.html`, la server-card, `auth.md`, las páginas de texto, las skills,
api-catalog y ai-catalog). El HTML no se regenera: la landing, la carta y el menú leen la bandera en el navegador (cada trozo va
dentro de un `<template x-if="RESPLANDOR.funciones.…">` de Alpine, que no lo pinta si no se cumple), así que `resplandor.css` y
los sprites de íconos no cambian. Si te olvidas de regenerar, `node scripts/descubrimiento.mjs --comprobar` sale en 1 y nombra
lo atrasado (lo corre el CI). Apagar es lo mismo al revés. `scripts/pruebas/funciones.test.mjs` lo prueba en las cuatro
combinaciones y en el ida y vuelta (apagar → encender deja lo generado idéntico, byte a byte); no supone cuáles banderas tiene el
repo, así que sigue verde después de encender una función y regenerar.

**Decisiones tomadas al hacerlo (2026-09-29):**
- `menu.html` (menú semanal y votación) es de `menuDeHoy`: lee la misma tabla `menus` que `#hoy`, `#hoy` lo enlaza («Ver la semana
  completa y votar») y sin `menus` no tiene nada que mostrar. No es de `almuerzoProgramado`, que solo arma un mensaje de WhatsApp y
  no toca Supabase.
- La tarjeta «Del día» de `carta.html` (Menú Resplandor, su precio y lo que incluye) **no se apaga**: es un plato de la carta, su
  precio sale de `carta_publica`, no de `menus`, y sin ella el precio del ejecutivo desaparecería de la carta. Solo pierde el
  enlace a las opciones de la semana.
- Apagado, el HTML sigue teniendo el marcado inerte dentro de los `<template>`: el DOM, la red y todas las superficies para
  máquinas (`llms.txt`, `local.json`, JSON-LD, sitemap, tools) están limpios, pero quien lea el HTML crudo sin un DOM (`curl`, un
  parser de texto) todavía ve el texto de esos trozos.
- Los agentes (WebMCP `ver_carta`, MCP `resplandor_ver_carta`, `local.json`) siguen siendo solo en vivo: la carta de respaldo es
  para las personas. Un agente no debe citar como vigente un precio del 3 de septiembre.

**La carta con Supabase caído (decisión de Yonatan, 2026-09-29).** Cuando `carta_publica` no responde (error, 402, sin red, vacía o
más de 4 s), la sección `#carta` de la landing muestra la carta igual, sin caja de error: la instantánea del 3 de septiembre de
2026 —los 30 platos que ya usaba `carta.html` desde el commit `2cb1d05`, con los ejecutivos que corrigió Yonatan el 2026-09-29: el
seco a 19.000, sin sopa ni frijol; el Menú Resplandor de 23.000, que sí los trae, y la sopa y carne a 14.000—, ahora en un módulo compartido,
`assets/js/carta-respaldo.js`, que leen la landing (`cartaVivo`) y `carta.html`. Dice de qué día son los precios, a la vista y sin
esconderlo: «Precios del 3 de septiembre de 2026; confírmalos al reservar.» (`role="note"` sobre las pestañas; en `carta.html`,
sobre las secciones, apenas la carta en vivo ya falló). **Esto reemplaza la regla «los precios de la carta se muestran solo en
vivo»** de esta especificación y de `docs/identidad-visual.md` (hallazgo H16 de la tarea `landing-homogenea-y-mcp`). Lo que no
cambia: nunca a mano en otro lado —la instantánea vive solo en `carta-respaldo.js`—, `local.json` y `llms.txt` no llevan precios y
las herramientas para agentes leen siempre en vivo. Cuando Supabase vuelva, la carta en vivo pasa sola por encima del respaldo; si
los precios cambian antes, se actualiza `carta-respaldo.js` (y su `FECHA`).

## Datos reales del local (única verdad; los dio Yonatan el 2026-09-26 o salen de la ficha de Maps)
- Nombre: «Resplandor Restaurante» (ficha: «Resplandor restaurante»). Cocina: colombiana, asados, cocina mixta.
- Dirección: Cra. 61 #79 Sur-62, Poblado del Sur, La Estrella, Antioquia, Colombia. Plus code 5954+9J.
- Geo: lat 6.1584468, lng -75.6434789.
  Ficha: `https://www.google.com/maps/place/Resplandor+restaurante/@6.1584468,-75.6434789,17z`
  Cómo llegar: `https://www.google.com/maps/dir/?api=1&destination=6.1584468%2C-75.6434789`
- Teléfono / WhatsApp: +57 322 554 2434 (`573225542434`, el mismo `waPhone` de la landing actual).
- Horario: TODOS los días, almuerzo 12:00–17:00 (Maps dice que el domingo abre 11:00; manda lo de Yonatan) y, desde el
  2026-10-01, desayunos 7:00 a.m. – 11:00 a.m. (pedido de Yonatan; es lo que dicen los afiches oficiales). Ver «Promociones de la
  semana y desayunos».
- Capacidad: 30 personas. **Todo evento/celebración es en el local.** Nunca eventos a domicilio,
  nunca «catering externo», nunca «llevamos el barril hasta donde estés».
- **Corrección de Yonatan (2026-09-28): eventos, celebraciones y paquetes en el local son de 10 a 30
  personas** (antes solo se declaraba el máximo). Una reserva de mesa común (tipo `reserva`) NO tiene
  este mínimo — una mesa para 1 o 2 sigue siendo válida —, y el almuerzo programado (tipo `almuerzo`)
  tampoco es un evento: no le aplica. El máximo de 30 sí aplica a los tres por igual.
- **Decisión por defecto — PREGUNTA ABIERTA para Yonatan:** el tipo `cena-romantica` («Cena
  romántica / aniversario») se anuncia «en pareja» en su tarjeta de Celebraciones, así que por
  defecto se suma también a los tipos SIN el mínimo de arriba (al lado de `reserva`/`almuerzo`):
  una pareja que pide una cena romántica para 2 no debería ver su solicitud ajustada a 10. Esto
  es una decisión por defecto, no una confirmación de Yonatan — si él prefiere que la cena
  romántica sea un evento con el mínimo de 10 (o que la tarjeta deje de anunciarse «en pareja»),
  se revierte en `TIPOS_SIN_MINIMO_EVENTO` (`assets/js/solicitud.js`). El máximo de 30 le sigue
  aplicando igual que a cualquier otro tipo.
- Almuerzo programado (almuerzos con frecuencia fija): **se recoge en el local, o domicilio si el
  cliente asume el costo del domicilio.** Es lo único que puede salir del local.
- Reseñas: Google Maps muestra 5,0 con 2 reseñas. Se muestra VISIBLE como enlace a la ficha
  («5,0 en Google Maps · 2 reseñas»). **No** va `aggregateRating` en el JSON-LD (Google prohíbe marcar
  reseñas tomadas de otro sitio). Sin testimonios inventados (se quitan Luisa P., Carlos A., Marcela R.).
- Precios: **sin precios en eventos/paquetes/celebraciones** (se cotizan por WhatsApp). Los precios de
  la carta se leen EN VIVO de la vista `carta_publica` de Supabase (como `carta.html`), nunca a mano.
  **Desde el 2026-09-29 (decisión de Yonatan)** hay una excepción para las personas: si la carta en vivo no carga,
  la landing y `carta.html` muestran la instantánea del 3 de septiembre de 2026 (`assets/js/carta-respaldo.js`) con su fecha a
  la vista; ver «Funciones que se pueden apagar». Los archivos para agentes siguen sin precios de la carta (solo llevan el rango
  `rangoDePrecios`, dicho como lo que es: ver «Lo que dice la capa de agentes tiene que ser cierto»).
- Se quitan: «10 a 500 personas», «salón privado hasta 150», «+2.000 eventos», «Domicilios y catering
  externo», la FAQ de catering externo, el combo «Día del Padre» (promo vencida de junio), el selector
  de 5 paletas, AOS, los horarios viejos (12pm–11pm y 9am–9pm), «5–7 días para +50 personas».
- Supabase público: URL `https://lccgehvyymladqvumcez.supabase.co`, publishable key
  `sb_publishable_034ZAmpVk0MRwQ9H5HZz-w_lPFGKf3x` (ya es pública en `carta.html:280-281`).
  Lectura anónima permitida SOLO de: vista `carta_publica` (categoria, nombre, precio, descripcion) y
  tabla `menus` (menú de la semana; ver `docs/menu_semanal.sql` y cómo la lee `menu.html:516-533`).
  Jamás la función `votar` ni `cuenta`, ni tablas del POS.

## Sistema visual (homogéneo en landing, carta y menú)
El contrato de implementación visual — tokens con sus contrastes WCAG medidos, tipografía,
motivos, el plan sección por sección de `index.html` y los ajustes mínimos de `carta.html`/
`menu.html` — vive en [`docs/identidad-visual.md`](identidad-visual.md): leelo antes de tocar
un color, una fuente o un motivo. **En lo visual manda ese documento**; acá va el resumen de lo
que no cambia entre fases, más la infraestructura de build.

**v2, vigente desde el 2026-09-28** («El letrero abre el salón»): la identidad de la cara
pública ya NO es la del POS. Sale de las fotos oficiales del local, no de un catálogo de marca
genérico:
- Paleta de material (15 tokens, `docs/identidad-visual.md` §3): `telon`, `arroz`, `papel`,
  `linea`, `apoyo`, `ceniza`, `pared`, `selva`, `letrero`, `letrero-claro`, `maiz`, `barro`,
  `turquesa`, `naranja`, `oro` — el coral del letrero de la Cra. 61 sobre negro, la pared
  terracota y el verde y la franja del mural, medidos en las fotos. Reemplaza por completo a
  la paleta v1 (`ember`/`amber`/`ink`/`parch`/`teal`/`card`/`muted`/`line`/`soft`/`terracota`).
- Tipografía: **Cinzel** + **Archivo**, con la R de **Cinzel Decorative** en el rótulo (§4).
  Sale **Fraunces + DM Sans**.
- `theme-color` **`#0A1112`** en las tres páginas (antes `#1C1A17`).
- **El POS (`pos.html`) adopta esta identidad desde el 2026-09-30** (pedido de Yonatan). Copia los 15
  tokens y la misma pareja de fuentes en su propio `<style>`, conserva su Tailwind CDN y no carga
  `resplandor.css`. Su contrato es `docs/pos-visual.md`. (Antes decía «el POS conserva los suyos: su propia
  paleta y fuentes»; esa decisión cambió.)

Una sola hoja compilada `assets/css/resplandor.css` (Tailwind v4.3.3 CLI, minificada, commiteada),
desde `assets/css/entrada-tailwind.css`, que hace:
```css
@import "tailwindcss" source(none);
@source "../../index.html"; @source "../../carta.html"; @source "../../menu.html"; @source "../js";
@import "./base.css";        /* @theme static con tokens + base + compat v3 (border color, cursor) */
@import "./componentes.css"; /* componentes compartidos */
@import "./landing.css";     /* solo la landing (dueño: parte landing) */
@import "./carta-menu.css";  /* solo carta y menú (dueño: parte carta-menú) */
```
Hecho de identidad que corrige un `alt` viejo: las letras «RESPLANDOR» en relieve sobre la
pared del salón son oscuras (bronce-negro mate), no doradas — lo dorado (`oro`) es solo el
anillo del monograma R. **Sin itálica** en ninguna de las tres páginas.

Motivos gráficos (`docs/identidad-visual.md` §5, ninguno más en esta fase): `.franja` (el ritmo
de la cenefa del mural — un motivo **propio** de triángulos, inspirado en ella, que nunca la
calca ni reproduce la figura); `.rotulo`/`.rotulo-sub` (el letrero «RESPLANDOR / RESTAURANTE»
en coral sobre `telon`, con la R de Cinzel Decorative en voluta); `.rombo` (el punto de la
franja, girado); `.friso` (las fotos de estudio de la cocina, pegadas como una sola pared); y
`.pared` (el grano de estuco de la banda terracota). El mural del salón es parte de la casa de
Camila y ella dio estas fotos para renovar la página: se usa como identidad (foto, color y
ritmo de la franja) en varias secciones, no solo como una foto suelta. Lo único que no se hace
es copiar la obra literal como patrón — un motivo propio inspirado en su franja geométrica sí.
El crédito al muralista se le pregunta a Camila (§15 de `docs/identidad-visual.md`) y no
bloquea esta fase. El monograma R dorada es de la marca y puede quedarse o reinterpretarse; hoy
sigue siendo el logo real (`img/logo-r.webp`). Nada de degradados de plantilla ni emojis en
botones (íconos del sprite). Movimiento: aparición sutil con IntersectionObserver; todo animado
se apaga con `@media (prefers-reduced-motion: reduce)`.

Íconos: Lucide 1.48.0 (`lucide-static`) como sprite SVG INLINE por página, generado por
`scripts/iconos.mjs` entre `<!-- iconos:inicio -->` y `<!-- iconos:fin -->` (justo después de `<body>`),
con los ids que la página usa (`<svg class="icono" aria-hidden="true"><use href="#i-nombre"/></svg>`).
Ids dinámicos (en atributos Alpine) se declaran en un comentario `<!-- iconos-extra: a b c -->`.
Sin runtime de Lucide en ninguna página.

Librerías fijadas (iguales en las tres páginas): Alpine `https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js`
(defer, al final del orden). `menu.html` además usa supabase-js: fijalo a la última 2.x del registro
(`npm view @supabase/supabase-js version`). Nada `@latest`, `3.x.x` ni `@4`.

Cabecera y pie comunes: monograma R + rótulo «Resplandor» coral sobre `telon`, con la franja
debajo (§5.2 y §7.0/§7.10 de `docs/identidad-visual.md`); la landing enlaza a carta y menú, y
carta/menú enlazan de vuelta a la landing (la raíz, `/`). Favicon/apple-touch sin cambios (la
R dorada de Camila); `theme-color` **`#0A1112`** en las tres.

## Imágenes publicables (dueño: parte imágenes)
El banco oficial vive en `img/referencias/<categoría>/` (`fachada`, `salon`, `platos`,
`en-la-mesa`, `bebidas`, `grupos`, `video`, `marca`), con `img/referencias/recursos.json` como
única verdad: un recurso por foto/video, con `alt`, `publicable`, sus variantes por ancho y los
`bytes` reales de cada una (más `poster` para video). `img/referencias/_originales/` — los
crudos, con gente sin recortar, capturas de Maps, promos con precios — es la única carpeta fuera
de git (`.git/info/exclude`); el resto, ya recortado y optimizado, sí entra a git y sí es
publicable. El HTML de landing/carta/menú solo referencia recursos con `publicable: true` de
`recursos.json`, nunca `_originales/` ni un id `publicidad-*`. La receta para sumar o recortar
una foto o un video es `scripts/recursos-imagen.sh` (ver `img/referencias/LEEME.md` para el paso
a paso completo, las convenciones de nombres/variantes/pesos y cómo se filtra un video antes de
publicarlo).

Qué foto va en cada sección de `index.html` (v2) — el hero es `plato-sopa-jugo-estudio` (un
almuerzo de estudio sobre la tela negra, con la franja del mural detrás); `#hoy` suma, desde
768 px, el recorte `mesa-sopa-plato-mural-fondo-3x4` (el almuerzo servido frente al mural);
`#la-casa` lleva las dos paredes del salón (`mural-mujer-indigena-salon` y
`salon-pared-terracota-letrero`); `#como-llegar` lleva `fachada-dia-flores-balcon` a todo el
ancho del contenedor (`fachada-banderas`/`fachada-azules` siguen sin referenciarse, sin
borrarse) — junto con el recorte nuevo y las correcciones de `alt`, es el plan sección por
sección de [`docs/identidad-visual.md`](identidad-visual.md) §7-§8: ese documento es el
contrato vigente, no lo que sigue debajo de esta línea.

Activos que NO viven en el banco (siguen sueltos en `img/`, con la receta de siempre: nada se
agranda de más, webp calidad ~80, cada salida se mira con Read antes de commitear):
`img/logo-r.webp` (monograma recortado al círculo, 256 px), `favicon.ico`, `img/favicon-32.png`,
`apple-touch-icon.png` (180, raíz) e `img/og-resplandor.jpg` (1200×630, fondo ink, fachada +
monograma + «Resplandor Restaurante · La Estrella»; sin agrandar la foto más de ~1,1×).

## Capa para agentes (dueño: parte agentes) — «la persona envía»
Patrón de lusof adaptado. Nunca se envía, reserva ni cobra nada por la persona: se arma el mensaje y el
enlace `wa.me` y la persona lo abre y lo manda. Sin USDC ni pagos.

Archivos del navegador (UMD como `lusof/assets/js/pedido.js`: `globalThis.X = …` y `module.exports`):
- `assets/js/local.js` → `globalThis.RESPLANDOR` = datos del local (arriba), tipos de solicitud,
  políticas, enlaces (Maps, cómo llegar, carta, menú), Supabase público.
- `assets/js/solicitud.js` → `globalThis.RESPLANDOR_SOLICITUD = { armarSolicitud, TIPOS, ENTREGAS,
  MAX_PERSONAS: 30, MIN_PERSONAS_EVENTO: 10, esTipoEvento, MAX_TEXTO, ... }`. `armarSolicitud(datos)` →
  `{ datos, mensaje, enlace, avisos }`, pura y determinista. `datos = { tipo, fecha, hora, personas,
  nombre, nota, entrega, direccion, frecuencia }`. Tipos: `reserva` (reserva de mesa), `almuerzo`
  (almuerzo programado) y las celebraciones de la landing actual (select en `landing.html:1679-1690`)
  SIN lo externo, más `otra`.
  Reglas de `personas`: 1–30 para `reserva`, `almuerzo` y `cena-romantica` (sin mínimo — una mesa
  para 1 sigue siendo válida, y la cena romántica se anuncia «en pareja»: decisión por defecto,
  pregunta abierta para Yonatan, ver arriba); 10–30 (`MIN_PERSONAS_EVENTO`–`MAX_PERSONAS`) para
  cualquier otro tipo (evento/celebración/paquete) — **corrección de Yonatan, 2026-09-28**. El
  conjunto sin mínimo es `TIPOS_SIN_MINIMO_EVENTO` en `assets/js/solicitud.js`. El mínimo se
  calcula con `minimoPersonasPara(tipo)`
  sobre el `tipo` CRUDO de la llamada (antes del fallback a `otra`): un `tipo` ausente, `''` o inválido
  NUNCA hereda el mínimo de `otra` — solo lo hereda una elección real de uno de los tipos de TIPOS
  (incluida `otra` puesta a propósito). Fuera de rango se ajusta al límite más cercano con aviso («la
  capacidad es 30…» o «…son de 10 a 30 personas…»), nunca se rechaza la solicitud entera.
  `entrega` solo aplica a `almuerzo` (`recoger` por defecto | `domicilio` → línea «El domicilio corre
  por mi cuenta» y pide `direccion`, aviso si falta); en cualquier otro tipo `entrega` se ignora con
  aviso «los eventos son solo en el local»; el mensaje dice el lugar (el restaurante, con dirección).
  Topes de texto, saneo de saltos de línea y separadores Unicode (U+0085, U+2028, U+2029), ids como
  `__proto__` no cuelan (copiá las defensas de `lusof/assets/js/pedido.js`). Errores de negocio →
  `avisos`, no throw.
- `assets/js/carta-respaldo.js` → `globalThis.RESPLANDOR_CARTA_RESPALDO = { fecha, fechaTexto, nota, filas }`: la instantánea
  de la carta (30 platos, 3 de septiembre de 2026) y la nota que la acompaña. Única copia; la usan `landing.js` y `carta.html`
  cuando la carta en vivo no carga (2026-09-29). Los agentes no la usan.
- `assets/js/vivo.js` → `globalThis.RESPLANDOR_VIVO = { leerCarta(opts), leerMenuSemana(opts) }`:
  GET REST a Supabase con la publishable key (`carta_publica?select=categoria,nombre,precio,descripcion`
  y `menus` como `menu.html`), `fetch` inyectable, timeout, sin pasar texto del usuario a filtros de
  PostgREST (filtrar en JS). Devuelve datos normalizados o lanza Error en español. Con `menuDeHoy` apagada,
  `leerMenuSemana` lanza sin hacer ninguna llamada.
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
- Orden de carga en la landing (todos `defer`): local.js → solicitud.js → vivo.js → carta-respaldo.js → landing.js →
  agentes.js → alpinejs. Las banderas (`RESPLANDOR.funciones`) las leen todos: `landing.js` (registra `menuSemana` solo con
  `menuDeHoy`), `agentes.js` (su lista de herramientas y sus esquemas), `vivo.js`, `solicitud.js` (por `RESPLANDOR.tipos`),
  `mcp/worker.mjs` y `scripts/descubrimiento.mjs`.

Descubrimiento estático: `scripts/descubrimiento.mjs` (con `--comprobar`) genera desde `local.js` +
`solicitud.js`: `llms.txt`, `local.json` (datos + reglas de la solicitud + `solicitud.ejemplos`: tres
salidas de `armarSolicitud` — reserva, almuerzo a domicilio con dirección y nota, y un tipo no-almuerzo
que pide domicilio y recibe el aviso; el Worker compara las tres para su huella +
`agentes: { webmcp: [nombres reales de agentes.js], mcp: null }` + cómo leer la carta
en vivo), `sitemap.xml` (landing, carta, menú), `robots.txt` (permitir todo salvo `/pos.html`, con su `Disallow` en cada grupo, + Sitemap), y el JSON-LD
`Restaurant` de `index.html` entre `<!-- datos-estructurados:inicio -->` y `<!-- datos-estructurados:fin -->`
(address con streetAddress, geo, telephone, openingHoursSpecification Mo–Su en dos tramos, desayunos 07:00–11:00 y almuerzo 12:00–17:00,
maximumAttendeeCapacity 30, hasMap, menu → carta.html, acceptsReservations true, image, url
`https://resplandor.ynt.codes/` (la raíz), servesCuisine; SIN aggregateRating). Desde el 2026-09-29
(puntaje de is-agentic.com) suma `contactPoint` (`ContactPoint`: el mismo teléfono, `contactType`
`reservations`, `availableLanguage` `es`) y `sameAs` con la ficha de Google Maps por CID
(`enlaces.fichaGoogle` en `local.js`, `https://maps.google.com/?cid=4458126308796974783`) y, también
desde el 2026-09-29, el Instagram del local (`enlaces.instagram`,
`https://www.instagram.com/resplandorestaurante`, confirmado por Yonatan). También desde el 2026-09-29
llevan el correo público del local (`correo` en `local.js`, `resplandorcomidamixta@gmail.com`) como
`email` y dentro del `contactPoint`, y `priceRange` (de `rangoDePrecios`, `$$ · desde 14.000 COP`, que dio Yonatan; desde el 2026-10-04 el
`priceRange` lleva **solo el símbolo con que empieza el dato (`$$`)**, porque dicho ahí, sin la frase que lo acompaña en las páginas, el «desde» se lee como el
piso de toda la carta y la carta en vivo tiene desayunos, platos y bebidas más baratos); el rango entero sigue en `local.json`, y el correo también
sale en `contact.html` y `local.json`. NO llevan `offers`,
`aggregateRating` ni otras redes: no hay ese dato en el repo y no se inventa. Si faltan los
marcadores, falla con un mensaje claro.

Lo que sumó la rama `agentes-listos` (2026-09-29, para isitagentready.com e is-agentic.com; el mismo
generador lo escribe todo, nunca a mano): `auth.md` (por qué no hay OAuth: no existe ninguna escritura
pública que proteger, y quien envía es la persona; abre con el H1 literal `# auth.md` que exigen la
especificación de https://workos.com/auth-md y el chequeo de isitagentready.com, y tiene una sección
«Registro de agentes» que dice que no hay ningún método de registro), las páginas de texto sin JS `about.html`,
`contact.html`, `privacy.html` y `404.html`, y el discovery estático `.well-known/api-catalog` (RFC 9727),
`.well-known/mcp/server-card.json` (SEP-2127; sus tools se leen de `mcp/worker.mjs` por su propio
transporte, y `remotes` sigue vacío mientras el Worker no esté desplegado),
`.well-known/agent-skills/` (índice + dos skills en Markdown) y `.well-known/ai-catalog.json`.
`robots.txt` lleva ahora `Content-Signal: search=yes, ai-input=yes, ai-train=no` (entrenar modelos queda
en «no» hasta que decidan Camila y Yonatan) y nombra los bots de IA. Las cuatro páginas de texto NO cargan
`resplandor.css` ni Alpine, pero llevan la identidad v2: el generador lee los tokens de `assets/css/base.css`
y la regla `.franja` de `assets/css/componentes.css` (`leerIdentidadParaPaginas`), usa los mismos dos
`<link>` de fuentes y habla de «tú»; `identidad.test.mjs` (sección 10) lo vigila.

### Puntaje de ora.ai (2026-10-03, tarea `puntaje-ora`)

Pedido de Yonatan: subir el puntaje de agentes de https://ora.ai/score/resplandor.ynt.codes (59/100, C: Discovery
12/20, Access 16/30, Usability 26/40) con lo que GitHub Pages puede servir, sin anunciar nada que no exista. El
diagnóstico completo (los 28 chequeos atacados, qué pide cada uno, cómo re-medir con `POST https://ora.ai/api/scan/checks`)
está en `tareas/2026-10-03-puntaje-ora.md`. Todo lo escribe `scripts/descubrimiento.mjs` desde `local.js` +
`solicitud.js` (y la landing, para las preguntas); lo único a mano son dos `<link rel="alternate">` y dos `<li>` del pie en
`index.html`, y un `<link rel="alternate">` en `carta.html`. Lo que sumó:

- **JSON-LD en varios bloques** entre los marcadores de `index.html`: el `Restaurant` de siempre (ahora con `@id`
  `…/#restaurante` y `parentOrganization`), una `Organization` (`…/#organizacion`: `logo` → `img/logo-r.webp` 256×256,
  el mismo `contactPoint`, `address` y `sameAs`, `location` → el restaurante; ora no reconoce `Restaurant` solo como
  «identidad»), un `WebSite` (`publisher` → la organización) y un `FAQPage` con las preguntas de
  `<section id="preguntas">`, **leídas del propio HTML al generar** (`leerPreguntas`): un `<template x-if>` de una función
  apagada se quita y uno encendido se desenvuelve, igual que Alpine. Siguen SIN `offers`, `aggregateRating`, `review` ni
  redes inventadas. `raiz.test.mjs` y `funciones.test.mjs` buscan el nodo `Restaurant` (sigue siendo el primer bloque).
- **ARD** en la ruta canónica `.well-known/ard.json` y en la vieja `ai-catalog.json`, byte a byte iguales, con
  `representativeQueries` (2–5, español + una en inglés) y `trustManifest` por entrada: `identity` de dominio (lo único
  que ARD lee; tiene que ser el `<publisher>` del URN), `trustSchema` (gobernanza → `auth.md`; métodos: mismo origen por
  HTTPS y sha256 del contenido) y una `attestations[]` con el **sha256 real del archivo tal como lo escribe el generador**
  (por eso el catálogo se arma al final). La entrada de WebMCP (`index.html`, que después sella `version.mjs`) lleva solo
  `identity`.
- **Agent Skills 0.2.0**: `$schema`, y por skill `name`, `description`, `type: skill-md`, `url` absoluta y `digest`
  `sha256:<hex>` del `.md`; `id`/`path` se quedan para el 0.1.0. Copias idénticas en `skills/<name>/SKILL.md` (donde
  buscan `npx skills add` y agent-plugins.org) y un `plugin.json` en la raíz (`$schema` de agent-plugins.org, `name` = el
  del Worker, sin `mcp.json` mientras no esté desplegado). `AGENTS.md` (a mano) es la guía para agentes de código.
- **`pricing.html` + `pricing.md`** (`enlaces.precios` en `local.js`): el rango `rangoDePrecios` tal cual lo declara el restaurante
  («Rango de precios declarado por el restaurante: $$ · desde 14.000 COP. Es una referencia, no el mínimo de toda la carta; el precio de cada
  plato está solo en la carta en vivo»; lo mismo en `index.md` y `carta.md`), dónde viven los precios (la carta en vivo y la API), que las
  celebraciones se cotizan por WhatsApp sin anticipos ni pagos por el sitio, y que leer la carta y los archivos para agentes es
  gratis y sin registro (x402/MPP/UCP no aplican). **Ningún precio de la carta escrito a mano**: `reglas.test.mjs` lo vigila
  también ahí, en todas las formas en que se escribe un precio (ver «Lo que dice la capa de agentes tiene que ser cierto»).
- **`api/`** (`enlaces.api`): `api/index.html` (documentación sin JS: autenticación —ninguna, la llave publishable es
  pública—, la llamada de la carta, errores JSON de PostgREST medidos en vivo —404 `PGRST205`, 400 `42703`, 416
  `PGRST103`, 401 sin llave—, paginación por `limit`/`offset`/`Range` + `Content-Range`, límites, versionado en la ruta
  `/rest/v1`, solo GET, WebMCP, el MCP remoto sin URL, los archivos y el repositorio), `api/index.md`, `api/llms.txt` (el
  llms.txt modular de la sección) y `api/openapi.json` = `openapi.json` (ora sondea la raíz): **OpenAPI 3.1.0 honesto**,
  `servers` = `…supabase.co/rest/v1`, `securitySchemes.apikey` en cabecera, `GET /carta_publica` (`listarCarta`; parámetros
  `select`, `categoria`, `order`, `limit`, `offset`, `Range`, `Prefer`; respuestas 200/206/400/401/404/416 con los schemas
  `Plato`, `Error {code, message, details, hint}` y `ErrorSinLlave {message, hint}`), `GET /menus` (`listarMenus`) solo
  con `menuDeHoy`, y las extensiones `x-versionado`, `x-limites` (PostgREST no manda `RateLimit`), `x-idempotencia`,
  `x-entorno-de-pruebas` (no hay uno aparte: todo es lectura) y `x-la-persona-envia`. El ejemplo de plato se declara
  ejemplo. El api-catalog apunta su `service-desc` al OpenAPI (y `service-doc` a `/api/`).
- **Gemelos Markdown** con front matter (`title`, `description`, `canonical`, `last-updated`): `about.md`, `contact.md`,
  `privacy.md`, `pricing.md`, `api/index.md` salen del **mismo `cuerpo` HTML** de cada página (`htmlAMarkdown`, chico y
  limitado a lo que esas páginas usan); `index.md` y `carta.md` salen de los datos de `local.js` (la landing y la carta se
  pintan con Alpine). Cada página anuncia el suyo con `<link rel="alternate" type="text/markdown">` (`paginaTexto`);
  GitHub Pages ya los sirve como `text/markdown` (hay `.nojekyll`). `auth.md` NO lleva front matter: su primera línea
  tiene que seguir siendo `# auth.md`.
- **`auth.md`** suma, dentro de «Registro de agentes», las ocho etapas de Auth.md (WorkOS) como `###` bilingües —Discover,
  Pick a method, Register, Claim, Exchange, Use the access_token, Errors, Revocation—, cada una diciendo que no aplica y
  por qué, nombrando las palabras de la spec (`WWW-Authenticate`, `agent_auth`, `identity_endpoint`, `identity_assertion`,
  `service_auth`, `id-jag`) para negarlas, nunca con una URL al lado.
- **`llms.txt`**: sección «Cuándo usar este sitio» (para qué sí, para qué no, en qué orden llamar: WebMCP → API →
  archivos) y **todos los enlaces en Markdown y absolutos** (tienen que resolver: la prueba exige que cada ruta exista).
- **Fechas**: `<lastmod>` en el sitemap (que suma `pricing.html` y `api/`), el schemamap y el `last-updated` de los `.md`
  son **una fecha por página** (`scripts/fechas-paginas.json`; ver «Fechas de las páginas» abajo): no la `fecha` de
  `version.json` ni la de git.
- **NLWeb Schema Feeds**: `schemamap:` al final de `robots.txt` → `schemamap.xml` → `schema/local.jsonl` (los mismos
  cuatro nodos del JSON-LD, uno por línea; sin platos ni precios).
- **Server card**: `icons` (apple-touch-icon 180×180 y `logo-r.webp` 256×256). `remotes` sigue vacío.
- `local.json.agentes` suma `api`, `ard`, `markdown`, `precios`, `repositorio`; `about`, `contact` y `404` enlazan lo nuevo.

Las banderas mandan en todo lo nuevo (`funciones.test.mjs`, `SUPERFICIES`): con `menuDeHoy` apagada no hay `/menus` en el
OpenAPI ni `menus` en `/api/`; con `almuerzoProgramado` apagada el FAQ, `pricing` e `index.md` no nombran el almuerzo.
Los criterios de ora están calcados en `scripts/pruebas/_puntaje-ora.mjs` y corren dos veces: sobre lo recién generado
con todo encendido (`descubrimiento.test.mjs`) y sobre el repo real (`puntaje-ora.test.mjs`).

### Fechas de las páginas (2026-10-04, refutación r1 de `puntaje-ora`)

`<lastmod>` del sitemap y del schemamap y `last-updated` de cada `.md` gemelo dicen **cuándo cambió el contenido de ESA página**.
`scripts/fechas-paginas.json` guarda, por página, la huella (sha256) de su contenido y la fecha (AAAA-MM-DD, America/Bogota) en que
apareció esa huella; `descubrimiento.mjs` la lee y la reescribe. Al generar: huella igual → la fecha no se mueve; huella distinta (o página
nueva) → la fecha es la de hoy. El reloj solo se mira al **escribir** y solo para la página que cambió (`--ahora <ISO>` lo fija en las
pruebas, igual que `version.mjs`); `--comprobar` compara huellas y nunca da distinto por el día en que se corra.

- **Qué tiene huella:** las páginas del sitemap (su HTML, **sin el sello de versión**: `normalizar` de `version.mjs`), cada `.md` gemelo (sin
  su propia línea de fecha: la fecha no entra en su propia huella) y `schema/local.jsonl` (la fecha del schemamap). Las dos páginas a mano
  con sello (`carta.html`, `menu.html`) se leen del repo; `index.html` cuenta con su JSON-LD ya generado. **Qué NO mueve ninguna fecha:**
  volver a correr el generador, un cambio solo del POS (no está en el sitemap), reescribir el sello de versión, un cambio en otra página, ni un
  cambio solo en `assets/**` (la fecha sigue al **contenido de la página**, su HTML o su `.md`, no a los scripts o estilos que carga).
  `carta.md` e `index.md` salen de `local.js`: se mueven cuando cambia su propio texto, no cuando cambia el HTML de la landing o de la carta.
- **Por qué no la `fecha` de `version.json`** (la primera versión): se mueve con CUALQUIER cambio de páginas o de assets. Medido por la
  refutación: un cambio solo en `pos.html` reescribía `sitemap.xml`, los siete `.md`, `schemamap.xml`, `ard.json` y `ai-catalog.json`
  (11 archivos que ninguna página justificaba), y dos ramas de días distintos chocaban en 16 archivos en vez de los 5 de siempre
  (`version.json` y los cuatro sellos). Además obligaba a una segunda corrida de `descubrimiento.mjs` después de `version.mjs`.
- **Por qué no `git log -1 --format=%cs -- <página>`** (la otra opción de la refutación): el CI hace `actions/checkout@v4` con profundidad 1
  (todas las páginas tendrían la fecha del último commit y `--comprobar` saldría 1); la fecha del commit no existe mientras se genera (la
  comprobación previa al commit nunca coincidiría, y habría que commitear dos veces); y un rebase o un «Merge» la reescribe.
- **Ramas y conflictos:** cada entrada del JSON ocupa cuatro líneas y va en orden alfabético, así que dos ramas que tocan páginas distintas
  mezclan limpio (también las líneas de `sitemap.xml`, cada `<url>` en las suyas). Con el pedido de la refutación (una rama toca `pos.html` el
  día 4 y otra `carta.html` el 5) quedan los 5 conflictos de siempre —`version.json` y los cuatro sellos—, no 16. Si las dos tocan la
  MISMA página, el conflicto es del archivo de fechas: se resuelven las marcas (se deja cualquier lado) y se corre `node scripts/descubrimiento.mjs`
  (la huella de la página ya mezclada no coincide con ninguno de los dos lados, así que toma la fecha de hoy y solo ella).
- **Un archivo de fechas que no se puede leer no es un archivo vacío** (re-refutación r2). Con marcas de conflicto de git sin resolver, con un JSON roto
  o sin el objeto `paginas`, `descubrimiento.mjs` **se niega** (sale 1, no escribe nada, también con `--comprobar`) y dice por qué y qué hacer: tomarlo por
  vacío llevaba a hoy las fechas de TODAS las páginas y reescribía el sitemap, el schemamap y los siete `.md` aunque solo una página hubiera
  cambiado. Solo un archivo que **no existe** (la primera generación) cuenta como «nada guardado». `--listar` no lo lee. Igual que `version.mjs` con las
  marcas en una página.
- **Orden de build:** css, iconos, descubrimiento, version. `descubrimiento.mjs` ya no lee `version.json`, así que **no hay segunda corrida**
  (AGENTS.md y el README ya no la piden).

### Lo que dice la capa de agentes tiene que ser cierto (2026-10-04, refutación r1)

Lo que `descubrimiento.mjs` escribe lo leen agentes que lo citan tal cual, así que cada afirmación se apoya en una fuente y tiene su prueba
(`scripts/pruebas/_puntaje-ora.mjs`, que corre sobre lo generado y sobre el repo real):

- **El rango de precios.** `rangoDePrecios` es un dato de Yonatan (hoy «$$ · desde 14.000 COP») y se publica **tal cual**: ver «Re-refutación r2»
  abajo (la primera versión explicaba el «desde» y la r2 lo midió falso con otro valor). Ningún número sale de otro lado ni se lee de la carta al
  generar: la regla es que un archivo estático no copia precios de la carta.
- **De dónde salen los precios.** La carta en vivo (`carta_publica`). Los archivos para agentes no los copian; lo único estático es el rango
  de `local.json` (que algunas páginas repiten) y, para personas, la copia de respaldo con fecha de la página de la carta
  (`assets/js/carta-respaldo.js`). Ya no se dice «ningún archivo del sitio copia precios». (Los afiches de promociones de `index.html`,
  escritos en palabras en su `alt`, son aparte y están a mano a propósito.)
- **Pedidos.** `llms.txt` ya no dice «todo se come en el restaurante». La r1 lo cambió por «lo que se quiera llevar se pide en el local», que tampoco
  tenía fuente: ver «Re-refutación r2» abajo.
- **La llave publishable.** Ya no se dice que «solo alcanza la vista de la carta»: `anon` también lee `menus`, `elecciones_menu` y
  `reacciones_menu` (`supabase/migrations/20260905000000_resplandor_base.sql`, «grant select … to anon»; medido en vivo con GET de cero
  filas). Se dice, sin atarlo a `menuDeHoy` (la bandera decide qué anuncia el sitio, no qué lee la llave), que la llave solo lee lo que el
  restaurante tiene público y nunca las ventas, las cuentas ni el personal; `puntaje-ora.test.mjs` compara eso con todos los GRANT a `anon`
  de las migraciones. Misma frase en `openapi.json`, `/api/`, `auth.md` y `privacy.html`.
- **Paginación.** PostgREST responde 206 y 416 solo con `Prefer: count=exact`; sin eso, siempre 200 (un rango fuera de las filas da un arreglo
  vacío) y sin `order` no hay orden: el parámetro `order` del OpenAPI ya no declara un `default`.
- **404.** GitHub Pages sirve `404.html` en la URL que no existe, bajo `/api/v1` también: sus enlaces (cuerpo y pie) son absolutos desde la raíz.
- **Nombres.** «API para agentes» (no «API y MCP») mientras el MCP no esté desplegado; la descripción de `pricing` ya no termina en «Para agentes,
  todo es gratis»; `carta.md` dice que las herramientas WebMCP las registra la página principal, no la carta.

### Re-refutación r2 (2026-10-04, `puntaje-ora`)

La r2 midió cuatro fallos de la corrección de la r1. Los cuatro tenían la suite en verde: dos pruebas **fijaban** la frase equivocada.

- **Pedidos, para llevar y domicilios (ALTO).** «Lo que se quiera llevar se pide en el local» no tenía fuente (ni `local.js`, ni el README, ni
  `docs/para-llevar.md`, que solo describe la marca que el POS pone en una cuenta) y el afiche de la semana de la landing dice «Domicilios en todo el
  sur». `llms.txt` dice ahora solo lo que tiene fuente (`pedidosYDomicilios` en `descubrimiento.mjs`, con las fuentes en su comentario): este sitio no
  toma pedidos de ningún tipo; el WhatsApp del restaurante (`whatsapp` y `whatsappVisible` de `local.js`) se da como **contacto**, no como «la vía
  para pedir» (la re-refutación r3 del 2026-10-04 señaló que eso no tenía fuente); y el restaurante atiende en el local y para llevar (README, `docs/para-llevar.md`) y anuncia «Domicilios en todo el
  sur» en el afiche de su página principal (`index.html`, el `alt` del resumen de la semana; la frase se cita tal cual, sin zona, costo ni horario, que no
  están en ningún dato). Con `almuerzoProgramado` encendida el almuerzo se dice **aparte** y sin «excepción»: tampoco es un pedido que el sitio tome, solo arma la
  solicitud que la persona manda; se recoge en el local o va a domicilio a costo de la persona (`local.js`, la landing). La FAQ de la landing con el almuerzo
  encendido dejó de decir «es lo único que sale del local» (`index.md` y el feed la copian). La prueba recorre las 33 superficies con `afirmacionesFalsasDePedidos`
  (`_puntaje-ora.mjs`): «todo se come en el local», «se pide en el local», «nada sale del local», «no hay domicilios», «sin domicilio», «no hay para llevar»; las
  oraciones sobre eventos («nunca hay eventos a domicilio ni catering externo») no se miran porque son ciertas (`politicas` de `local.js`). El detector tiene sus
  propios ejemplos que deben caer y otros que no, y el chequeo corre con las cuatro combinaciones de banderas. **Para Yonatan:** si quiere que el sitio diga
  condiciones de domicilio (zona, costo, horario), hay que dárselas: hoy no existen en el repo, así que no se publican.
- **El rango de precios (MEDIO).** `fraseRango` ya **no interpreta** el dato: «Rango de precios declarado por el restaurante: `<rangoDePrecios>`. Es una referencia, no el
  mínimo de toda la carta; el precio de cada plato está solo en la carta en vivo.» Nada depende de la forma del texto (ni «$$ · desde N COP», ni dónde cae el «desde»): si
  Yonatan lo cambia a «$$ · desayunos desde 9.000 · almuerzos desde 14.000», se publica igual de bien sin tocar código (`puntaje-ora.test.mjs` lo prueba con tres valores
  generando un sitio de prueba cada vez; con «$$ · desde 4.000 COP» la versión anterior publicaba «el almuerzo ejecutivo completo (sopa y carne), desde 4.000 COP»,
  falso). El `priceRange` del JSON-LD y del feed lleva solo el símbolo con que empieza el dato («$$»), o el dato entero si no empieza por uno: nunca algo que el dato no diga.
- **Marcas de conflicto en `fechas-paginas.json` (BAJO).** Ver «Fechas de las páginas»: el generador se niega.
- **La guarda de precios (BAJO).** `scripts/pruebas/_precios-a-mano.mjs` (la usan `reglas.test.mjs` y `puntaje-ora.test.mjs`). La excepción ya no es el literal «desde
  14.000 COP» esté donde esté, sino el **contexto**: el dato solo pasa dentro de la frase exacta del generador y como valor de `"rangoDePrecios"` en `local.json`; la misma cifra
  en cualquier otro lugar falla. Y ve más formas: «desde N COP» y «N COP» sueltos, cifras sin moneda con separador de miles («9.000») o tras «desde» («desde 9000», no un
  año), «7 mil», «catorce mil», «9k» y «mil pesos». Medido sobre todo lo que genera `descubrimiento.mjs` y el JSON-LD de `index.html`: ningún falso positivo. El mutante de la
  r2 («La carta va desde 14.000 COP; los desayunos, desde 9.000, y la sopa sola a 7 mil» en `llms.txt`) pasaba con la suite en verde; ahora falla.

**Lo que NO se puede desde GitHub Pages** (aparcado, decisión de Yonatan; detalle y puntos en la tarea): cabeceras
`Link`/`Vary`, `Content-Type` del api-catalog (sale `application/octet-stream`: RFC 9727 fija la ruta sin extensión), 404
en Markdown por `Accept`, `?mode=agent`, NLWeb `/ask`, A2A (exige JSON-RPC vivo). Lo destrabaría prender el proxy de
Cloudflare sobre `resplandor.ynt.codes` (la zona ya está ahí) o mudar a Cloudflare Pages. Y lo que más sube, lejos, es
**desplegar el Worker del MCP** (`mcp/LEEME.md`; después `MCP_DESPLEGADO = true` y regenerar). OAuth sigue en «n/a» a
propósito: no se fabrica metadata de un flujo que no existe.

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

## Landing nueva (dueño: parte landing) — `index.html`
Secciones, en este orden (ids estables):
1. Franja superior: «Abierto todos los días · Desayunos 7:00–11:00 · Almuerzos 12:00–17:00» (y, desde `lg`, « · Cra. 61 #79 Sur-62, La Estrella»).
2. Nav: monograma + Resplandor; enlaces (La casa, Menú de hoy, Carta, Celebraciones, Almuerzo
   programado, Cómo llegar); CTA «Reservar» → `$store.solicitud.abrir('reserva')`; menú móvil.
3. `#inicio` hero con `img/fachada-rojo-negro.webp` (fetchpriority high, width/height): H1, bajada
   honesta (cocina colombiana, asados y cocina mixta en La Estrella), puntos (almuerzo todos los días
   12–5 · desayunos todos los días, 7:00 a.m. – 11:00 a.m. · celebraciones en el local de 10 a 30 personas · menú de la
   semana que vota la gente), CTAs: Reservar mesa / Cotizar una celebración / Ver la carta.
3b. `#promociones` (2026-10-01): los afiches de la semana en un carrusel animado; ver «Promociones de la semana y desayunos».
4. `#hoy` menú de hoy y de la semana en vivo (`menuSemana`) + enlace a `menu.html` para votar.
   **Función `menuDeHoy`: hoy apagada** (sección, enlaces y `menu.html` incluidos); ver «Funciones que se pueden apagar».
5. `#carta` carta en vivo (`cartaVivo`, pestañas por categoría, precios COP sin decimales) +
   enlace a `carta.html`. Si la carta en vivo no carga, se ve la instantánea con fecha de `carta-respaldo.js` (desde el
   2026-09-29); el estado de error con enlace a la carta solo queda si tampoco hay respaldo.
6. `#celebraciones` tipos de celebración EN EL LOCAL (sin precios; «de 10 a 30 personas»), decoración
   con globos (se ve en la fachada), cada tarjeta → `abrir('<tipo>')`.
7. `#almuerzo-programado`: recoger en el local o domicilio con costo a cargo del cliente;
   CTA → `abrir('almuerzo')`. **Función `almuerzoProgramado`: hoy apagada** (2026-09-29).
8. `#la-casa`: la fachada real (`fachada-banderas`/`fachada-azules`), capacidad 30, reseñas: enlace
   «5,0 en Google Maps · 2 reseñas» a la ficha.
9. `#como-llegar`: dirección, plus code, horario, botones Google Maps / Cómo llegar / WhatsApp.
10. `#preguntas` FAQ con `<details>` (eventos solo en el local de 10 a 30 personas, capacidad del local
    30, anticipación recomendada 48 h, almuerzo programado: recoger o domicilio a tu costo, cómo se
    paga/confirma: por WhatsApp con el restaurante). Nada de catering externo.
11. Pie: dirección, horario, WhatsApp, enlaces carta/menú, «para agentes: llms.txt».
12. Barra fija inferior en móvil (Reservar / WhatsApp), sin tapar contenido.
13. `<dialog id="solicitud">` con el formulario ligado a `$store.solicitud.datos` (tipo, fecha, hora,
    personas 1–30 para mesa/almuerzo o 10–30 para el resto — etiqueta y atributo `min` dinámicos según
    el tipo elegido, vía `store.personasMin`/`personasEtiqueta`/`personasAyuda` —, nombre, nota; si
    tipo=almuerzo: frecuencia, entrega recoger/domicilio y dirección con la aclaración del costo),
    vista previa del mensaje (`armado.mensaje`), avisos, y el enlace «Abrir WhatsApp» (`armado.enlace`,
    target _blank, rel noopener) — la persona envía. Cerrar con botón y Escape; el foco vuelve al botón
    que lo abrió.
Head: title/description honestos, canonical, og:* (og:url, og:image `img/og-resplandor.jpg`),
twitter:*, theme-color, favicon, `<link rel="alternate" type="application/json" href="local.json">`,
`<link rel="alternate" type="text/plain" href="llms.txt">`, JSON-LD entre marcadores, sprite entre
marcadores, `assets/css/resplandor.css`, fuentes, scripts en el orden de arriba. `[x-cloak]` oculto.
Sin errores de consola; 375 px sin scroll horizontal; objetivos táctiles ≥ 44 px; contraste AA.

## Promociones de la semana y desayunos (2026-10-01, pedido de Yonatan; rama `carta-promos`, parte landing)
**Qué pidió:** adicionar a la landing una sección con las promociones de la semana, «tipo scroll en animación», con los afiches
de la carpeta `marketing` (`~/Developer/resplandor/marketing/`, fuera del repo), y mostrar el horario de los desayunos.
Esto levanta las reglas de la v2 «sin promociones y sin desayunos» y «nunca un id `publicidad-*`» solo para estas piezas y este
horario; el resto de esas reglas sigue.

- **Sección `#promociones`** (entre `#inicio` y `#hoy`, banda `arroz`; diseño en `identidad-visual.md` §7.1b): 8 afiches
  «feed» de 1080×1350 — el resumen de la semana y lunes a domingo — en una tira con `scroll-snap`. La landing **no depende de la
  base** para esto: son imágenes estáticas.
- **Imágenes:** `assets/img/promos/` (segundo banco, aparte de `img/referencias/` porque son publicidad con precios).
  `promos.json` es la única verdad de lo editorial (id, día, `alt`, afiche de origen, y el `recorte` si hace falta) y de los bytes
  reales; `node scripts/promos-imagenes.mjs ~/Developer/resplandor/marketing <afiches-vigentes>` regenera los archivos (webp
  480/720/960, jpg 480/720) y los bytes (el segundo argumento solo hace falta si algún afiche sale de `afiches-vigentes/`).
  **De miércoles a domingo son los afiches VIGENTES de Yonatan** (2026-10-01, «hay un cambio en los días viernes y sábado», el del
  domingo y, de lunes a jueves, los de color que mandó antes): de color, no negros y dorados, y casi 4:5 o 3:4 (miércoles 1393×1736,
  jueves 1302×1463, viernes 1337×1789, sábado 1333×1780 y domingo 1326×1778), así que `promos.json` los recorta a 4:5 exacto
  (`recorte`, solo margen sin texto: 2 px a los lados el miércoles, 30 px a la izquierda y el resto a la derecha el jueves, 15 px
  arriba y el resto abajo el viernes, solo abajo el sábado, 62 px arriba y el resto abajo el domingo) para que la tira siga con una
  sola proporción. **Solo el resumen, el lunes y el martes siguen siendo los de `marketing/`** (negros y dorados): Yonatan mandó el
  lunes (una captura horizontal con «1 of 3») y el martes (424×599) de color, pero en una resolución que no sirve, así que NO se
  usaron; cuando lleguen los originales se cambia `origen` y se regenera. (El miércoles y el jueves se habían dejado por error con los
  de `marketing/` por creerlos también de mala resolución: la crítica visual del 2026-10-01 mostró que sí servían, y el miércoles
  de `marketing/` traía una letra chica —«Aplica para todas nuestras sodas saborizadas»— que contradecía su titular.) Los cinco
  afiches de color pesan más (ver el tope propio en `promos.test.mjs`).
  Su alt dice lo que dicen ellos: sin «Fin de semana como se debe», «¡Combínalas como quieras!» ni «no cocinar en casa», que eran de
  los de antes. **El domingo** dice «Hoy tenemos un delicioso Sancocho», un letrero que se muestra los siete días y que no es de
  todos: el sancocho se programa solo algunos fines de semana. Por eso el alt dice «un sello anuncia el sancocho, que se programa
  solo algunos fines de semana» y debajo del afiche va, en texto, «Con sancocho algunos fines de semana» (`.promo-nota`).
  *Para Yonatan:* lo ideal es una versión del afiche del domingo sin ese sello (y sin el QR de la mesa 7, que sale cortado y
  no se puede leer).
  Peso total 2,4 MB en el repo; una persona descarga un webp por afiche (30–120 KB según el ancho de su pantalla). Con la
  página recién cargada no se pide ninguno: Chrome carga TODAS las imágenes `loading="lazy"` de una tira horizontal que caigan
  en su umbral (medido: los 8, 734 KB a 3x, con la sección bajo el pliegue), así que cada afiche lleva `content-visibility: auto`
  (con su alto reservado exacto para que no haya saltos) y se piden al acercarse la sección (221 KB en escritorio a 1x, ~540 KB
  en un teléfono a 3x tras el primer avance).
  `imagenes.test.mjs` aplica al banco de afiches las mismas reglas que al de fotos (existe, alt idéntico al del manifiesto,
  `width`/`height`, `loading="lazy" decoding="async"`, una familia por `<picture>`).
- **Alt:** fiel a cada afiche (día, promoción, precio o descuento, y una línea de la foto), con el precio en palabras
  («50.000 pesos»): `reglas.test.mjs` sigue prohibiendo «$» + dígito en todo el sitio. **El texto del afiche manda sobre el
  resumen de `pedido.md`:** el martes dice «2 Hamburguesas Resplandor + papas + gaseosa» y el lunes «el tercero va con
  descuento» (el 20% está en el titular).
- **Movimiento** (`assets/js/promos.js`, JS propio, sin Alpine ni red, ~215 líneas; con comentarios que explican cada decisión):
  la tira nace en el afiche de HOY, marcado con «Hoy», un anillo y `aria-current="date"`; el día es el de Bogotá (UTC−5 fijo, sin
  Intl); esa marca sigue al reloj: se corre a la medianoche de Bogotá (un temporizador que se rearma) y al volver a la pestaña
  o a la página (`visibilitychange`, `pageshow`: el celular congela los temporizadores con la pestaña oculta), sin mover la tira.
  Avanza sola un afiche cada 5 s (`data-promos-intervalo` en la sección lo cambia) con desplazamiento suave y al final
  vuelve al primero **de golpe** (un barrido suave de extremo a extremo cruzaba los afiches en 0,8 s, como un latigazo; la vuelta
  hacia atrás, igual). Se pausa al pasar el mouse, al enfocar con el teclado (`:focus-visible`: un clic con el mouse no la deja
  pausada), al tocar (y espera 1,6 intervalos tras soltar), con la pestaña oculta, cuando la sección no se ve y con el botón de
  pausa (WCAG 2.2.2). Con `prefers-reduced-motion: reduce` no hay movimiento automático ni suave y el botón de pausa se esconde.
  Botones anterior / pausa / siguiente de 44 px (solo con JS); el arrastre táctil, la rueda y las flechas son los nativos.
  Los afiches de adelante se piden un paso antes (`loading="lazy"` no basta dentro de una tira horizontal).
- **Desayunos:** `horario.desayunos` en `assets/js/local.js` (`07:00`–`11:00`, todos los días) y `horario.texto` dice los dos
  tramos. De ahí salen el JSON-LD (`openingHoursSpecification` en dos tramos), `local.json`, `llms.txt`, `about.html`,
  `contact.html` y lo que leen los agentes. En `index.html`: franja superior, un punto del hero («Desayunos todos los días ·
  7:00 a.m. – 11:00 a.m.»), `#la-casa`, `#como-llegar`, el pie y las meta descripciones. **Los platos y precios de los desayunos
  (el letrero del local: Calentado Resplandor, Desayuno sencillo y Desayuno Resplandor) viven en la carta en vivo, no en la landing, `llms.txt` ni
  `local.json`** (la regla del repo: un precio escrito a mano se desactualiza; `reglas.test.mjs` lo vigila).
- **La carta de la landing (`#carta`) no lleva «Promociones»** (`assets/js/landing.js`, `agruparCarta`): las promociones tienen su
  sección (los afiches) y, con su día y su etiqueta, `carta.html#promociones`. En una pestaña de la carta salían ordenadas por
  nombre, sin día y con «$ 0» (las de 2 x 1 y el 20% van con precio 0 y una etiqueta). Los platos sí traen su `etiqueta` («Incluye
  jugo», «Algunos fines de semana») como la pastilla sutil de `carta.html`; sin precio (0) no se escribe «$ 0».
- **Datos para agentes:** el horario de los desayunos, y en las herramientas en vivo (WebMCP `ver_carta`, MCP `resplandor_ver_carta`)
  cada plato trae `etiqueta` y, si es una promoción, `dia` («Jueves»): una promoción vale ese día y no todos. `assets/js/vivo.js`
  pide las seis columnas de la vista y, ante un 400 (la base todavía sin la migración), repite con las cuatro de siempre; una de
  precio 0 dice su etiqueta en `precioTexto`, nunca «$ 0». `local.json` y la skill siguen anunciando las cuatro columnas de
  siempre y avisan de las dos nuevas («si la vista contesta 400, pide solo las cuatro»). `llms.txt`, `local.json` y el JSON-LD siguen sin precios de platos ni
  `offers` (`local.json` lleva el rango `rangoDePrecios` y el JSON-LD solo su símbolo): los precios y las promociones viven en la carta en vivo (la categoría «Promociones» la carga el sobre SQL de
  `carta-promos`), no en un archivo que se queda viejo cada semana.
- **«Domicilios en todo el sur»** (franja dorada del resumen de la semana y de los afiches): NO se escribe como texto de la
  landing ni en los datos para agentes. Solo aparece en el `alt` del resumen de la semana, porque ahí el alt tiene que decir lo
  que dice el afiche. Razón: `funciones.test.mjs` exige que, con `almuerzoProgramado` apagada, `index.html` no nombre
  «domicilio» (era un rastro de esa función), y un domicilio en general, sin costo, horario ni condiciones, no está en ningún
  dato de Yonatan: no encaja con lo que la landing ya dice y no se inventa. Esa prueba deja pasar solo esa frase exacta. **Para
  Yonatan:** si quiere que la landing anuncie domicilios con todas las letras, hay que decir costo y condiciones, y revisar
  de paso `politicas` («nunca a domicilio» es solo para eventos y celebraciones). (La FAQ del almuerzo programado, apagado, decía «es lo único que sale del
  local»: la r2 lo quitó, porque con la función encendida lo copiaban `index.md` y el feed y el afiche dice lo contrario.)
- **Pruebas:** `scripts/pruebas/promos.test.mjs` (estática siempre; en navegador si hay Playwright: 320 px, botones de 44 px, día
  de hoy, avance, pausas por mouse/foco/toque/pestaña/botón, `prefers-reduced-motion`, anterior/siguiente) y los cambios de
  `imagenes.test.mjs`, `reglas.test.mjs` (los desayunos y las promociones dejaron de estar prohibidos; el precio a mano sigue
  prohibido) y `descubrimiento.test.mjs` (JSON-LD con dos tramos).
