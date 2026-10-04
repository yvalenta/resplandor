# AGENTS.md

Guía para agentes de código (Cursor, Claude Code, Codex, Copilot…) que abren este repo. Es corta a propósito: la verdad vive en los documentos que enlaza.

## Qué es este repo

El sitio del restaurante Resplandor: la landing pública (`index.html`), la carta que abren las pegatinas NFC de cada mesa con su cuenta abierta (`carta.html`), el menú de la semana con su votación (`menu.html`, hoy apagado por bandera) y el POS táctil de uso diario (`pos.html`, interno: `noindex`).

GitHub Pages sirve la raíz de `main` tal cual en https://resplandor.ynt.codes. El sitio publicado no tiene build ni dependencias en runtime: HTML, Alpine.js y Supabase, y el POS es un solo archivo. `package.json` existe solo para las herramientas que generan algunos archivos (Tailwind e íconos). Un push a `main` es publicar: el CI solo lo señala después, no lo bloquea.

## Dónde está la verdad

- `README.md`: el POS (`pos.html`), su diseño, su dominio, la seguridad y las decisiones fijas. Incluye «La versión del sitio».
- `docs/landing-y-agentes.md`: la landing, la carta, el menú y la capa para agentes (reglas duras, raíz del sitio, funciones que se pueden apagar, «la persona envía»).
- `assets/js/local.js` y `assets/js/solicitud.js`: única fuente de los datos del local y de las reglas de las solicitudes. La landing, WebMCP, el Worker de `mcp/` y todo lo generado los leen.
- `img/referencias/recursos.json`: única verdad de las imágenes publicables (`publicable`, `alt`, variantes). Nunca referencies `img/referencias/_originales/`: está fuera de git a propósito.
- Otros: `docs/pos-visual.md` (lado visual del POS), `docs/identidad-visual.md` (tokens), `docs/pegatinas.md`, `mcp/LEEME.md` (el MCP remoto).
- `tareas/`: la bitácora del trabajo, un archivo por tarea con fecha en el nombre.

## Antes de tocar algo

1. **No edites a mano lo generado.** Cambia la fuente y corre el generador:
   - `local.json`, `llms.txt`, `sitemap.xml`, `robots.txt`, `schemamap.xml`, `schema/**`, `scripts/fechas-paginas.json`, `auth.md`, `about.html`, `contact.html`, `privacy.html`, `pricing.html`, `404.html`, todos los `.md` gemelos (`index.md`, `carta.md`, `about.md`, `contact.md`, `privacy.md`, `pricing.md`), `api/**`, `openapi.json`, `plugin.json`, `skills/**`, `.well-known/**` y los bloques JSON-LD de `index.html` (entre `<!-- datos-estructurados:inicio -->` y `<!-- datos-estructurados:fin -->`): `scripts/descubrimiento.mjs`, desde `local.js`, `solicitud.js` y la sección de preguntas de `index.html`. Las fechas de `sitemap.xml`, `schemamap.xml` y los `.md` (`<lastmod>`, `last-updated`) son una por página y salen de la huella de cada una (`scripts/fechas-paginas.json`), no de `version.json`: un cambio solo del POS no mueve ninguna.
   - `assets/css/resplandor.css`: `scripts/css.mjs`, desde `assets/css/entrada-tailwind.css` y los CSS que importa.
   - Los sprites de íconos (entre `<!-- iconos:inicio -->` y `<!-- iconos:fin -->` en `index.html`, `carta.html` y `menu.html`): `scripts/iconos.mjs`.
   - `version.json` y los sellos de versión de `pos.html`, `carta.html`, `index.html` y `menu.html`: `scripts/version.mjs`.
2. **Las funciones se apagan y se encienden en un solo lugar:** `FUNCIONES` en `assets/js/local.js` (`menuDeHoy`, `almuerzoProgramado`, `pagarEnMesa`). Cambia el valor ahí y corre `node scripts/descubrimiento.mjs`; no ocultes nada con ediciones sueltas en el HTML. Detalle en `docs/landing-y-agentes.md`, «Funciones que se pueden apagar».
3. **Ningún precio de la carta escrito a mano.** Salen en vivo de la vista `carta_publica` de Supabase. Lo único estático es el rango `rangoDePrecios` de `assets/js/local.js` (hoy «$$ · desde 14.000 COP»: el «desde» es el del ejecutivo más barato, no el piso de la carta; sale en `local.json`, las páginas lo repiten con esa explicación y el JSON-LD lleva solo el «$$») y la instantánea de respaldo `assets/js/carta-respaldo.js`, que muestra su fecha. `llms.txt` no lleva precios. `scripts/pruebas/reglas.test.mjs` falla si algo de lo que genera `descubrimiento.mjs` trae un precio en pesos escrito a mano en cualquier forma (`$14.000`, `$ 14.000`, `14.000 COP`, `49.000 pesos`; solo se salva el «desde» de `rangoDePrecios` tal cual), y si aparece catering, un evento a domicilio o una capacidad inflada.
4. **«La persona envía».** Nada de este repo envía un mensaje de WhatsApp, reserva ni cobra por una persona: se arma el mensaje y el enlace `wa.me`, y la persona lo abre y lo manda. El sitio no cobra en línea ni ofrece pagos a ningún agente. Todo evento o celebración es en el restaurante, de 10 a 30 personas; nunca catering externo.
5. **Todo texto visible va en español de Colombia, con trato de «tú».**
6. **`pos.html` tiene sus propias reglas visuales** (`docs/pos-visual.md`): léelo antes de tocarlo. No usa `resplandor.css`.
7. Si cambias páginas o `assets/**`, corre los generadores en el orden de la sección siguiente y deja `version.json` y los sellos actualizados junto con tu cambio.

## Comandos

Requiere Node 22 (el del CI).

```bash
npm ci                                      # una vez: Tailwind y lucide-static, solo herramientas de build

# Comprobar (no escribe nada; es lo que corre .github/workflows/comprobar.yml)
node scripts/css.mjs --comprobar
node scripts/iconos.mjs --comprobar
node scripts/descubrimiento.mjs --comprobar
node scripts/version.mjs --comprobar
node --test scripts/pruebas/*.test.mjs      # el glob, no el directorio a secas

# Regenerar (escriben archivos): en este orden, version siempre al final
node scripts/css.mjs
node scripts/iconos.mjs
node scripts/descubrimiento.mjs
node scripts/version.mjs
```

`scripts/version.mjs` va al final porque su huella incluye lo que los otros tres reescriben. No hace falta volver a correr `descubrimiento.mjs` después: no lee `version.json` (sus fechas salen de `scripts/fechas-paginas.json`, que solo cambia cuando cambia el contenido de una página).

## Lo que un agente NO hace solo

Esto es del mantenedor: pídeselo y deja el cambio descrito, sin ejecutarlo.

- `git push`, sobre todo a `main`: publica el sitio.
- Desplegar a Cloudflare (`wrangler deploy` del Worker de `mcp/`).
- Migraciones o escrituras en Supabase (`supabase/` y la base en vivo).
- Borrar archivos del repo.
- Publicar cualquier cosa pública.

## Para agentes que CONSUMEN el sitio (no el código)

No hace falta clonar el repo. Empieza por https://resplandor.ynt.codes/llms.txt; los datos y las reglas de las solicitudes están en https://resplandor.ynt.codes/local.json y el catálogo de APIs en https://resplandor.ynt.codes/.well-known/api-catalog. La carta y el menú se leen siempre en vivo, nunca de una copia.
