---
estado: bloqueada
dueño: sesión
fecha: 2026-10-03
tema: subir el puntaje de agentes de ora.ai (hoy 59/100, C) con lo que GitHub Pages puede servir, sin anunciar nada que no exista
criterio_cierre: `node scripts/descubrimiento.mjs --comprobar` en 0 con todo lo nuevo generado y la suite en verde; y, después del push de Yonatan, `POST https://ora.ai/api/scan/checks` (ids en «Cómo re-medir») devuelve pass en al menos 12 de los 16 chequeos marcados «estático: sí» y el puntaje total de https://ora.ai/score/resplandor.ynt.codes queda en 70 o más (B)
---

Pedido de Yonatan del 2026-10-03: «https://ora.ai/score/resplandor.ynt.codes soluciona los problemas y mejóralo para
aumentar puntaje». Esta tarea deja el diagnóstico completo, el plan exacto y las decisiones ya tomadas, para que una
sesión fría la ejecute sin volver a investigar (la sesión que la declaró pasó la regla de corte de 200k de contexto
antes de escribir código: ver la bitácora).

**Dónde se trabaja:** worktree `~/Developer/worktrees/resplandor--puntaje-ora`, rama `tarea/puntaje-ora`, nacida de
`main` en `c971532` (= `origin/main` el 2026-10-03 20:40 Bogotá). Ya tiene `npm ci` hecho y los cuatro generadores en 0
(`css`, `iconos`, `descubrimiento`, `version` con `--comprobar`). Para retomar:
`cd ~/Developer/worktrees/resplandor--puntaje-ora && claude` y leer esta tarea entera.

**Material guardado** (el scratchpad de la sesión se borra; esto no): `~/Developer/worktrees/resplandor--coordinacion/puntaje-ora/`
→ `ora-score.json` (el reporte completo, 125 chequeos con `details` y `recommendation`), `ora-checks.json` (el catálogo de
chequeos con su `maxScore`, `bonus`, `tier`, `applicability`), `agent-skills-rfc.md`, `ard-spec.txt`, `nlweb-schema-spec.md`,
`workos-auth-md.md`, `mcp-server-schema.json`.

## Cómo mide ora (medido, no supuesto)

- `GET https://ora.ai/api/score/resplandor.ynt.codes` → el reporte en JSON, sin llave. `POST https://ora.ai/api/scan/checks`
  con `{"url":"https://resplandor.ynt.codes","checkIds":["json-ld","sitemap-lastmod"]}` re-corre solo esos chequeos en vivo
  (probado: HTTP 200, `results[]` con `status/score/maxScore/details`). Cuota: 30 escaneos por IP cada 24 h, 6 con `force`.
  Un `GET /score/...` servido de caché no gasta cuota. También hay MCP (`https://ora.ai/api/mcp`, tools `run_checks`,
  `scan_domain`) y CLI (`npx ax audit resplandor.ynt.codes --json`).
- Capas: Discovery 12/20, Access 16/30, Usability 26/40, Payments N/A (sin señales de comercio: sus chequeos son bonus y no
  restan). El puntaje de capa sale de los chequeos no-bonus APLICABLES; los bonus suman encima. Grados: 70–85 = B, 86–94 = A.
- Chequeos de ora que fallan hoy y se arreglan con ARCHIVOS ESTÁTICOS en GitHub Pages (id · puntos · qué pide):

| id | pts | qué pide (resumen del `recommendation`) | decisión |
|---|---|---|---|
| json-ld | 4 (hoy 1) | un bloque con `@type` de identidad: Organization/LocalBusiness/Person/… (no reconoce `Restaurant` solo) | bloque `Organization` aparte, ver plan 1 |
| org-schema-completeness | 2 | `Organization` con `contactPoint` (teléfono/correo + contactType) Y `address` | ídem |
| schema-type-breadth | 2 | tipos extendidos: FAQPage, WebSite, BreadcrumbList, Service… | FAQPage + WebSite |
| json-ld-entity-linking | 2 | `sameAs` (Wikipedia/Wikidata/GitHub/redes) | sameAs honesto: Maps + Instagram (ya están); NO el repo (no es identidad del local) |
| agent-discovery-file | 2 (hoy 1) | cada skill del índice con `name` y `description` | plan 3 |
| agent-skills-index-v2 | 2b (hoy 1) | `$schema` 0.2.0, `type`, `url`, `digest: sha256:<64 hex>` | plan 3 |
| agent-instruction | 3 (hoy 2) | «cuándo usar» explícito en llms.txt | plan 7 |
| pricing-info | 3 | página `/pricing` o `Offer` | `pricing.html` + `pricing.md` (plan 4) |
| pricing-md | 2 | `/pricing.md` en Markdown | ídem |
| public-api-docs | 3 | docs de API enlazadas desde la portada (/docs, /api, /developers) | `/api/` (plan 5) |
| openapi-spec | 7 | `/openapi.json` válido | plan 5 |
| api-schema-analysis | 2 | operationId + descripción + tipos + schemas de respuesta | plan 5 |
| function-calling-compat | 2 | lo mismo, apto para function calling | plan 5 |
| json-error-responses | 4 | errores en JSON «en una ruta inválida de la API» | depende de dónde sondee: PostgREST SÍ responde JSON (`{"code":"PGRST205",…}` con 404; sin apikey 401 JSON); Pages responde 404 HTML. Se documenta y se mide después |
| markdown-url-fallback | 2b | `/index.md` (y un .md gemelo por página) con `text/markdown` | plan 6 |
| markdown-frontmatter | 1 | los .md servidos abren con `---` (title + description/canonical/last-updated) | plan 6 (auth.md NO: su primera línea tiene que seguir siendo `# auth.md`) |
| markdown-link-alternate | 1b | `<link rel="alternate" type="text/markdown" href>` en las páginas | plan 6 |
| modular-llms-txt | 1b | `/api/llms.txt` (o /docs/, /developers/) | plan 5 |
| sitemap-lastmod | 1b | `<lastmod>` W3C en el sitemap | plan 8 |
| ard-catalog (rec.) | — | servir también `/.well-known/ard.json` (ruta canónica ARD v0.91) | plan 2 |
| ard-trust-manifest | 2b | `trustManifest` en las entradas | plan 2 |
| auth-md-structure | 2b (hoy 1) | las 8 secciones de WorkOS: Discover, Pick a method, Register, Claim, Exchange, Use the access_token, Errors, Revocation | plan 9 |
| nlweb-schema-feeds | 1 | `schemamap:` en robots.txt → XML → feed JSONL de schema.org | plan 10 |
| agent-rules-repo | 1 | `AGENTS.md` en el repo público, y el repo enlazado desde portada/docs/llms.txt | plan 11 |
| agent-plugins-repo | 1b | `plugin.json` en la raíz del repo con `$schema` de agent-plugins.org | plan 11 |
| mcp-server-card (rec.) | — | `icons` (logo) para «registry-branding» cuando el MCP exista | plan 12 |
| llms-txt-links-resolve | 2 (hoy n/a) | enlaces Markdown en llms.txt que resuelvan | plan 7: enlaces absolutos |

Nota de riesgo asumido: publicar un OpenAPI hace «aplicables» los chequeos de API (rate-limit-headers 2, api-error-model 3,
api-versioning-policy 3, pagination-shape 2, response-schema-coverage 2, idempotency 3, async-job 2, batch 2b). PostgREST no
manda cabeceras RateLimit (ese se pierde); los demás se cubren documentando en el spec lo que PostgREST hace de verdad
(errores `{code,message,details,hint}`, versión en la ruta `/rest/v1`, paginación por `Range`/`limit`/`offset`, solo GET).
Saldo esperado positivo (openapi 7 + 2 + 2 + quizá 4 contra, a lo sumo, 5 perdidos).

## Lo que NO se puede desde GitHub Pages (aparcado para Yonatan)

GitHub Pages sirve la raíz de `main` tal cual: sin cabeceras propias, sin negociación por `Accept`, sin leer la query, sin
POST. Eso deja afuera, hasta que haya algo delante del dominio: `link-headers-discovery` (1b), `markdown-negotiation-vary`
(1b), `agent-friendly-404` 2/2 (hoy 1/2: Pages no puede responder Markdown a `Accept: text/markdown`), `agent-ua-markdown`
(1b), `agent-mode-view` (`?mode=agent`, 2b), `api-catalog-rfc9727` 2/2 (el archivo sin extensión sale como
`application/octet-stream`; RFC 9727 fija la ruta sin extensión), NLWeb `/ask` (2), A2A agent-card (2b: exige un endpoint
JSON-RPC real), OAuth (0 puntos hoy porque está «n/a»: NO fabricar metadata de OAuth sin un flujo real — decisión vieja de
`auth.md`).

- **Qué lo destrabaría:** la zona `ynt.codes` YA está en Cloudflare (NS `amos.ns.cloudflare.com` / `norah.ns.cloudflare.com`), pero
  `resplandor.ynt.codes` es un CNAME directo a `yvalenta.github.io` sin proxy (`server: GitHub.com`). Prender el proxy
  (nube naranja) y poner reglas de transformación o un Worker delante daría cabeceras `Link`/`Vary`, `Content-Type` del
  api-catalog, 404 en Markdown y `?mode=agent`: unos 8 puntos. Alternativa: mudar el sitio a Cloudflare Pages (`_headers`,
  Functions). Las dos son despliegue/infra: decisión y mano de Yonatan.
- **El MCP remoto** (`mcp/worker.mjs`) sigue SIN desplegar: `mcp.resplandor.ynt.codes` no resuelve. Desplegarlo
  (`mcp/LEEME.md`) vale: `mcp-server` 2→6, `mcp-server-card` +1b, `mcp-well-known-discovery` 2b, `registry-branding` 2,
  `mcp-registry-listed` 1 (si además se registra), y los bonus `mcp-tool-descriptions` 3, `mcp-param-schemas` 2,
  `mcp-server-identity` 1, `mcp-tool-listing` 3, `mcp-tool-naming` 2, `mcp-tool-annotations` 2, `mcp-error-handling` 2,
  `mcp-transport-modern` 1. Es, lejos, lo que más sube. Después del deploy: `MCP_DESPLEGADO = true` en
  `scripts/descubrimiento.mjs`, regenerar, y la server-card/api-catalog/local.json anuncian la URL solos.
- `brand-search-accuracy` (3), `agentic-search-specific` (3), `wikipedia-presence` (4b): indexación de buscadores y
  Wikidata (P856 = resplandor.ynt.codes), no código. `chatgpt-app-listed`, `skills-sh-listed/quality` (registrar con
  `npx skills add` es publicar: Yonatan; el repo queda listo con `skills/` y `plugin.json`).
- Un túnel temporal (`cloudflared tunnel --url`) para re-medir con ora ANTES del push lo negó el clasificador de permisos
  de la sesión («External Ingress Tunnel»): no insistir. La re-medición es después del push, con el POST de arriba.

## Plan de implementación (todo sale de `scripts/descubrimiento.mjs`, salvo lo marcado «a mano»)

Regla de siempre: NUNCA a mano lo generado; una sola fuente (`assets/js/local.js` + `solicitud.js`), banderas
`RESPLANDOR.funciones` respetadas en todo lo nuevo (con `menuDeHoy` apagada nada nombra `menus`/menú de la semana; con
`almuerzoProgramado` apagada nada nombra almuerzo/domicilio/entrega), español de Colombia con «tú», ningún precio escrito a
mano (`reglas.test.mjs`: nada de `$` + dígito; el único «precio» permitido es `rangoDePrecios` = «$$ · desde 14.000 COP»),
y nada que anuncie un endpoint que no responde.

1. **JSON-LD en VARIOS bloques** entre los marcadores `datos-estructurados` de `index.html` (hoy uno; ora cuenta
   «block(s)» y no reconoce `Restaurant` como identidad). En orden: (a) el `Restaurant` de siempre, con `@id`
   `https://resplandor.ynt.codes/#restaurante` y `parentOrganization: {"@id": "…#organizacion"}`; (b) un
   `Organization` (`@id` `#organizacion`, `name`, `url`, `description`, `logo` → `ImageObject` con
   `https://resplandor.ynt.codes/img/logo-r.webp` 256×256, `email`, `telephone`, `contactPoint` idéntico al del
   Restaurant, `address` idéntica, `sameAs` = los MISMOS dos de siempre (ficha de Maps por CID e Instagram), `location:
   {"@id": "#restaurante"}`); (c) un `WebSite` (`name`, `url`, `inLanguage: "es"`, `publisher: {"@id": "#organizacion"}`);
   (d) un `FAQPage` con las preguntas de `<section id="preguntas">` de `index.html`, LEÍDAS del propio HTML al generar
   (parsear `<details><summary>…</summary><p>…</p></details>`; quitar antes los `<template x-if="RESPLANDOR.funciones.X">`
   con X apagada y desenvolver los de X encendida; texto sin etiquetas, espacios colapsados; si la sección existe y no se
   parsea nada, fallar con mensaje claro; si no hay sección —la landing temporal de las pruebas— no se emite el bloque).
   Se mantiene lo decidido: sin `offers`, sin `aggregateRating`, sin `review`, sin redes inventadas. El escape de `<` como
   `<` sigue por bloque.
2. **ARD**: escribir el mismo catálogo en `.well-known/ard.json` y en `.well-known/ai-catalog.json` (byte a byte iguales),
   y en cada entrada sumar `representativeQueries` (2 a 5 frases naturales, en español y una en inglés, p. ej. «horario y
   dirección de Resplandor Restaurante en La Estrella», «carta y precios de Resplandor en JSON», «prepare a reservation
   message for Resplandor») y `trustManifest`: `{ "identity": { "type": "domain", "domain": "resplandor.ynt.codes",
   "publisher": "<marca>" }, "trustSchema": { "governanceUri": "https://resplandor.ynt.codes/auth.md",
   "verificationMethods": ["same-origin-https", "sha-256-content-digest"] }, "attestations": [ { "type":
   "content-digest", "algorithm": "sha-256", "digest": "<hex del archivo tal como lo escribe este generador>" } ] }` —
   la atestación solo en las entradas cuyo artefacto genera este script (llms.txt, local.json, api-catalog, server-card,
   índice de skills, auth.md, openapi.json, index.md…); la de WebMCP (`text/html`, index.html) lleva solo `identity` (el
   sello de versión reescribe index.html después y el hash quedaría viejo). Spec (ARD v0.91 §4.2, §4.5): `identifier`,
   `displayName`, `type`, `url`/`data` obligatorios; `representativeQueries` SHOULD (2–5); `trustManifest.identity` es lo
   único que ARD lee y su dominio DEBE coincidir con el `<publisher>` del URN (`urn:air:resplandor.ynt.codes:…`). Nuevas
   entradas: `api:openapi` (`application/vnd.oai.openapi+json`), `docs:api` (`text/html`, /api/), `docs:index-md`,
   `docs:pricing` (`text/markdown`).
3. **Agent Skills 0.2.0** (`.well-known/agent-skills/index.json`): `{"$schema":
   "https://schemas.agentskills.io/discovery/0.2.0/schema.json", "skills": [{ "name", "type": "skill-md",
   "description", "url": "https://resplandor.ynt.codes/.well-known/agent-skills/<name>.md", "digest":
   "sha256:<64 hex minúsculas del archivo .md tal cual se escribe>" , "id", "path" }]}` (`id`/`path` se quedan por
   compatibilidad: los clientes ignoran campos desconocidos). `name`/`description` = los del frontmatter de cada .md.
   Además, copias idénticas en `skills/consultar-resplandor/SKILL.md` y `skills/preparar-solicitud-resplandor/SKILL.md`
   (es donde `npx skills add yvalenta/resplandor` y agent-plugins las buscan). Generadas, no a mano.
4. **Precios**: `pricing.html` (misma `paginaTexto` que about/contact) y `pricing.md`: rango `rangoDePrecios`; la carta y
   sus precios viven en vivo (`carta.html`, y para máquinas el GET de `carta_publica` del plan 5); con Supabase caído la
   página de la carta muestra la copia del 3 de septiembre con su fecha (no citarla como vigente); eventos, celebraciones y
   paquetes (10 a 30 personas) se cotizan por WhatsApp, sin anticipos ni pagos por este sitio; para agentes y
   desarrolladores TODO es gratis y sin registro (API, WebMCP, MCP, archivos), sin cuota propia (aplican los límites de
   Supabase) y sin pagos máquina (x402/MPP/UCP no aplican). Enlazarla en el pie de `index.html` («Precios y
   cotizaciones», a mano) y en about/contact/404. Agregarla al sitemap.
5. **API**: `api/index.html` (página de documentación, `paginaTexto`, enlazada desde el pie de `index.html` como «API y MCP
   (para agentes)»), `api/openapi.json` y una copia idéntica en `openapi.json` (ora sondea la raíz), `api/llms.txt`
   (llms.txt modular de la sección) y `api/index.md` (gemelo Markdown). OpenAPI 3.1.0 HONESTO: `servers:
   [https://lccgehvyymladqvumcez.supabase.co/rest/v1]`; `securitySchemes.apikey` (`apiKey`, header `apikey`, con la
   llave publishable en la descripción: es pública, ya está en carta.html y local.json); `paths./carta_publica.get`
   (`operationId: listarCarta`; parámetros `select` (default `categoria,nombre,precio,descripcion,etiqueta,dia_semana`),
   `categoria` (sintaxis PostgREST `eq.<texto>`), `order`, `limit`, `offset`, cabeceras `Range` y `Prefer: count=exact`;
   respuestas 200 y 206 (array de `Plato`, cabecera `Content-Range` p. ej. `0-1/43`), 400/401/404/416 con el schema
   `Error` `{code, message, details, hint}` de PostgREST y `ErrorSinLlave` `{message, hint}` para 401; medido en vivo el
   2026-10-03: la vista tiene 43 filas en 6 categorías —Platos Fuertes, Bebidas, Entradas, Ejecutivos, Desayunos,
   Promociones— y 6 columnas); solo con `menuDeHoy` encendida, `paths./menus.get` (`listarMenus`, columnas que pide
   `vivo.js#leerMenuSemana`). Schema `Plato`: `categoria`, `nombre`, `precio` (entero, COP; 0 = promoción de descuento,
   vale su etiqueta), `descripcion` (nullable), `etiqueta` (nullable), `dia_semana` (entero 1–7, nullable; solo en
   «Promociones»: vale solo ese día). Extensiones `x-versionado` (la versión va en la ruta `/rest/v1`; este documento
   `info.version` 1.0.0), `x-limites` (PostgREST/Supabase no devuelven cabeceras RateLimit; pedir con moderación; timeout
   de 4 s en las páginas), `x-idempotencia` (solo GET), `x-entorno-de-pruebas` (no hay uno aparte: todo es lectura, sin
   efectos). Ejemplos SIN precios reales (un «Plato de ejemplo» con 10000 y la nota de que los reales salen de la vista).
   La página `/api/` explica además: WebMCP (`document.modelContext`: ver_local, ver_carta, anotar_solicitud, ver_solicitud,
   abrir_solicitud), el MCP remoto (en el repo, sin desplegar: no dar URL), autenticación (ninguna; enlace a auth.md),
   errores, paginación, límites, sandbox (no hace falta), archivos (llms.txt, local.json, ard.json, skills, api-catalog) y
   el repositorio `https://github.com/yvalenta/resplandor` (ya está en privacy.html y en la server-card). El api-catalog
   pasa a apuntar su `service-desc` a `api/openapi.json` con `type: application/vnd.oai.openapi+json` (además de
   local.json). Enlace `<link rel="alternate" type="application/vnd.oai.openapi+json" href="api/openapi.json">` en
   `index.html` (a mano).
6. **Markdown gemelo**: `index.md` (la landing en Markdown: qué es, horario, dirección y cómo llegar, carta en vivo,
   tipos de celebración, cómo reservar —la persona envía—, para agentes), `about.md`, `contact.md`, `privacy.md` y
   `api/index.md` convertidos del MISMO `cuerpo` HTML de cada página con un `htmlAMarkdown()` chico (h1/h2/p/ul/li/a/
   code/em/wbr), `carta.md` (qué es la carta, dónde se lee —página, GET, herramientas—, nota de la copia con fecha; sin
   precios) y `pricing.md`. Todos abren con front matter `---\ntitle: …\ndescription: …\ncanonical: <url de la
   página>\nlast-updated: <fecha de version.json>\n---` y luego el `# H1`. GitHub Pages ya sirve `.md` como
   `text/markdown; charset=utf-8` (hay `.nojekyll`). `auth.md` NO lleva front matter: `descubrimiento.test.mjs` y el
   chequeo de isitagentready exigen `# auth.md` en la primera línea (vale 2b de `auth-md-exists`; el front matter vale 1).
   A mano: `<link rel="alternate" type="text/markdown" href="index.md" />` en el `<head>` de `index.html` y
   `href="carta.md"` en `carta.html`; en las páginas generadas lo pone `paginaTexto`.
7. **llms.txt**: sumar «## Cuándo usar este sitio» (para qué sirve: reservar mesa o cotizar una celebración en La Estrella,
   consultar carta y precios en vivo, horario y dirección; para qué NO: pagos, pedidos a domicilio, otros locales; en qué
   orden llamar: WebMCP → API → archivos), todos los enlaces como Markdown ABSOLUTOS (`[local.json](https://…/local.json)`,
   API, OpenAPI, index.md, pricing.md, auth.md, ard.json, skills, server-card, repo), y la sección de agentes nombra la API.
8. **Sitemap y `lastmod`**: `<lastmod>` = `fecha` de `version.json` (la única fecha determinista del repo: cambia solo
   cuando cambian páginas o assets). Si falta `version.json` (sitios de prueba), sin `lastmod`; agregar `version.json` a
   `COPIAR` de `scripts/pruebas/_sitio.mjs`. Entran al sitemap `pricing.html` y `api/` (`https://resplandor.ynt.codes/api/`).
   OJO al orden de build: `version.mjs` corre AL FINAL y, si ese día cambió la fecha, hay que correr `descubrimiento.mjs`
   OTRA vez (el sitemap no entra en la huella, así que converge en una pasada). Decirlo en el mensaje de error de
   `--comprobar` y en README «La versión del sitio».
9. **auth.md**: conservar la primera línea `# auth.md`, el único H1, y TODO lo que prueban `descubrimiento.test.mjs` y
   `funciones.test.mjs` («## Registro de agentes», «NO ofrece registro de agentes», `identity_assertion`, «## Sin pagos ni
   cobros», «## Lo que sí pide cuenta: el punto de venta (no es público)», «## Lo que exige un código, no una cuenta: la
   cuenta de una mesa», nada de `POST /agent/auth|register_uri|registration_endpoint|client_secret`, ningún correo). Debajo
   de «## Registro de agentes» sumar las ocho etapas de WorkOS como `###` bilingües — «Discover (descubrir)», «Pick a
   method (elegir método)», «Register (registrar)», «Claim (reclamar)», «Exchange (canjear)», «Use the access_token
   (usar la credencial)», «Errors (errores)», «Revocation (revocación)» — cada una diciendo honestamente que no aplica y
   por qué (sin `WWW-Authenticate`, sin `agent_auth`, sin `identity_endpoint`, sin `id-jag`, sin `service_auth`: las
   palabras de la spec se nombran para negarlas, nunca con una URL).
10. **NLWeb Schema Feeds**: `schemamap: https://resplandor.ynt.codes/schemamap.xml` al final de `robots.txt` (después de
    `Sitemap:`; la prueba de robots cuenta grupos por `User-agent:` y no se ve afectada), `schemamap.xml` =
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:sf="http://schema.org/schemas/schemafeed/0.1"><url>
    <loc>https://resplandor.ynt.codes/schema/local.jsonl</loc><lastmod>…</lastmod><sf:contentType>structuredData/schema.org
    </sf:contentType></url></urlset>` y `schema/local.jsonl` = un objeto JSON-LD por línea (los mismos cuatro bloques del
    plan 1: Restaurant, Organization, WebSite, FAQPage, cada uno con `@context`, `@type` y `@id`). Sin platos ni precios.
11. **Repo para agentes de código**: `AGENTS.md` en la raíz (a mano; el borrador lo dejó un subagente de la sesión del
    2026-10-03 — revisarlo contra README/docs antes de commitear) y `plugin.json` en la raíz, generado: `{"$schema":
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "resplandor-restaurante", "version": "<la del
    MCP, 0.1.0>", "description": …, "homepage": "https://resplandor.ynt.codes/", "repository":
    "https://github.com/yvalenta/resplandor", "license": "Apache-2.0", "keywords": [...]}` (spec: solo `$schema` y `name`
    son obligatorios; las skills se descubren en `skills/`; NO escribir `mcp.json` mientras el Worker no esté desplegado).
    Enlazar el repo desde `/api/`, llms.txt y about.html.
12. **Server card**: sumar `icons: [{ "src": "https://resplandor.ynt.codes/apple-touch-icon.png", "mimeType":
    "image/png", "sizes": ["180x180"] }, { "src": "https://resplandor.ynt.codes/img/logo-r.webp", "mimeType":
    "image/webp", "sizes": ["256x256"] }]` (campo `icons` del schema 2025-10-17; `src` https, mime de la lista). `remotes`
    sigue vacío hasta el deploy.
13. **Páginas generadas**: about/contact/404 enlazan lo nuevo (pricing, /api/, index.md, ard.json); `paginaTexto` recibe
    la ruta del gemelo .md para el `<link rel="alternate">`.
14. **A mano en `index.html`** (y `carta.html` solo el `<link>`): los dos `<link rel="alternate">` nuevos del head y, en
    el pie «Explorar», dos `<li>` con las clases que ya existen (`enlace-pie text-arroz underline hover:no-underline`):
    «Precios y cotizaciones» → `pricing.html` y «API y MCP (para agentes)» → `api/`. Después, correr `node
    scripts/version.mjs` AL FINAL (index.html y carta.html llevan sello) y volver a correr `descubrimiento.mjs` si la
    fecha cambió (plan 8).
15. **Orden de build al cerrar**: `node scripts/css.mjs --comprobar` (no cambia nada: no hay clases nuevas) → `node
    scripts/iconos.mjs --comprobar` → `node scripts/descubrimiento.mjs` → `node scripts/version.mjs` → `node
    scripts/descubrimiento.mjs --comprobar` (si sale 1 por la fecha, regenerar y repetir) → `node --test
    scripts/pruebas/*.test.mjs`.

## Pruebas que hay que actualizar o sumar

- `scripts/pruebas/descubrimiento.test.mjs`: `ARCHIVOS_GENERADOS` suma todo lo nuevo (index.md, about.md, contact.md,
  privacy.md, carta.md, pricing.md, pricing.html, api/index.html, api/index.md, api/openapi.json, openapi.json,
  api/llms.txt, schemamap.xml, schema/local.jsonl, plugin.json, skills/*/SKILL.md, .well-known/ard.json). Las pruebas del
  JSON-LD hoy leen el PRIMER `<script type="application/ld+json">` y comparan `@type === 'Restaurant'`: pasar a leer TODOS
  los bloques y buscar el nodo `Restaurant` (y nuevas aserciones para Organization/WebSite/FAQPage, ard.json == ai-catalog,
  digests sha256 del índice de skills que coincidan con los bytes de cada .md, openapi con `openapi: 3.1.0`, `servers`,
  `operationId` únicos, 200/400/401/404 con schema; front matter de cada .md; `lastmod` W3C en sitemap/schemamap; cada
  URL `https://resplandor.ynt.codes/<ruta>` de llms.txt existe como archivo del repo). La aserción `sameAs` sigue siendo
  exactamente los dos de siempre.
- `scripts/pruebas/raiz.test.mjs` línea ~57 (lee el primer bloque y espera `Restaurant`): igual, buscar el nodo.
- `scripts/pruebas/funciones.test.mjs`: `SUPERFICIES` suma los archivos nuevos; `verificarSuperficies` parsea el JSON-LD
  con el primer bloque (sigue siendo el Restaurant: ok) y `PRESENTE_SI_ENCENDIDA.menuDeHoy` debería sumar
  `'openapi.json': /\/menus/` y `'api/index.html': /menus/`.
- `scripts/pruebas/identidad.test.mjs`: `PAGINAS_ANCLA` suma `pricing.html` y `api/index.html` (identidad v2 + trato de
  «tú»).
- `scripts/pruebas/reglas.test.mjs`: `ARCHIVOS_DATO` suma `index.md`, `pricing.md`, `carta.md`, `api/llms.txt` (sin `$` +
  dígito, catering/domicilio solo negados, horario de desayunos presente donde aplique: ojo, esa prueba exige
  «desayunos» + 7:00 + 11:00 en cada archivo de la lista: index.md y pricing.md sí lo dicen; `api/llms.txt`/`carta.md`
  quizá no → agregarlos a una lista aparte solo para las prohibiciones, no para el horario).
- `scripts/pruebas/_sitio.mjs`: `COPIAR` suma `version.json`.
- Nueva `scripts/pruebas/puntaje-ora.test.mjs`: los criterios de ora calcados en local (lo de arriba), para que una
  regresión se note sin gastar cuota.

## Documentación

- `docs/landing-y-agentes.md`: sección nueva «Puntaje de ora.ai (2026-10-03)» con estas decisiones y la lista de lo
  aparcado (es el contrato de la capa de agentes; la sección «Capa para agentes» enumera lo generado: sumar lo nuevo).
- `README.md`, «La versión del sitio»: la línea de «si cambió la fecha, descubrimiento otra vez» (plan 8).
- `mcp/LEEME.md`: nada que cambiar (ya dice cómo desplegar).

## Cómo re-medir (después del push de Yonatan)

```bash
curl -s -X POST https://ora.ai/api/scan/checks -H 'Content-Type: application/json' -d '{"url":"https://resplandor.ynt.codes","checkIds":["json-ld","org-schema-completeness","schema-type-breadth","json-ld-entity-linking","agent-discovery-file","agent-skills-index-v2","agent-instruction","pricing-info","pricing-md","public-api-docs","openapi-spec","api-schema-analysis","function-calling-compat","json-error-responses","markdown-url-fallback","markdown-frontmatter","markdown-link-alternate","modular-llms-txt","sitemap-lastmod","ard-catalog","ard-trust-manifest","auth-md-structure","nlweb-schema-feeds","agent-rules-repo","agent-plugins-repo","mcp-server-card","llms-txt-links-resolve","api-catalog-rfc9727"]}' | jq '.results[] | {id, status, score, maxScore, details}'
```

Y el total: `https://ora.ai/scan/resplandor.ynt.codes?rescan=1` (o `curl -s https://ora.ai/api/score/resplandor.ynt.codes | jq .score`).
Gasta 1 de los 30 escaneos diarios por IP cada vez.

## Bitácora
- 2026-10-03: diagnóstico completo con el reporte JSON de ora (59/100, C; #1462 de 105348; escaneado 19:34 UTC) y su
  catálogo de 125 chequeos; comprobado en vivo que el sitio está en GitHub Pages sin proxy (CNAME a `yvalenta.github.io`,
  `server: GitHub.com`), que `.well-known/api-catalog` sale como `application/octet-stream`, que `/.well-known/ard.json`,
  `/openapi.json`, `/api`, `/pricing`, `/index.md` dan 404, que `/about` (sin extensión) sí resuelve a `about.html`, que
  `mcp.resplandor.ynt.codes` no resuelve (Worker sin desplegar) y que PostgREST responde JSON en sus errores (404
  `PGRST205`, 401 sin llave, 400 columna inexistente) y `Content-Range: 0-1/43` con `Range`. Specs leídas y guardadas en
  coordinación (ver arriba). Worktree `resplandor--puntaje-ora` creado desde `main` (`c971532`), `npm ci` hecho, cuatro
  generadores en 0. El clasificador de permisos negó el túnel temporal para re-medir antes del push. Un subagente
  (sonnet) dejó el borrador de `AGENTS.md`. La sesión pasó la regla de corte de 200k ANTES de escribir código: queda este
  plan, ningún archivo generado tocado. Lo retoma una sesión fresca desde el worktree.
- 2026-10-03: suite base en el worktree (sin tocar nada): 692 `ok` y 1 `not ok` («imprimir en la caja, de punta a punta»,
  de la impresión, ajena a esta tarea) a los 25 minutos, cuando el límite de la sesión la cortó: la suite entera tarda más
  (hay pruebas de 60–70 s con navegador y Postgres). Para la sesión que retome: correrla en segundo plano con el tope
  máximo o por archivos (`node --test scripts/pruebas/descubrimiento.test.mjs scripts/pruebas/funciones.test.mjs
  scripts/pruebas/reglas.test.mjs scripts/pruebas/identidad.test.mjs scripts/pruebas/raiz.test.mjs scripts/pruebas/mcp.test.mjs`
  cubre lo que esta tarea toca).
- 2026-10-03 (sesión fresca, Fable 5.1): **plan ejecutado completo** en la rama `tarea/puntaje-ora` (este commit). Generador
  (`scripts/descubrimiento.mjs`): JSON-LD en 4 bloques (Restaurant con `@id` + Organization + WebSite + FAQPage leído de
  `<section id="preguntas">` respetando los `<template x-if>`), `.well-known/ard.json` = `ai-catalog.json` con
  `representativeQueries` y `trustManifest` (identidad de dominio + `attestations[]` con el sha256 real de cada archivo: el
  catálogo se arma al final; WebMCP solo identidad), índice de skills 0.2.0 con digests + copias en `skills/*/SKILL.md`,
  `plugin.json`, `pricing.html`/`pricing.md`, `api/` (index.html, index.md, llms.txt, openapi.json) + `openapi.json` en la
  raíz (OpenAPI 3.1.0: `listarCarta`, `listarMenus` solo con `menuDeHoy`, errores de PostgREST, Range/Content-Range,
  extensiones `x-*`), gemelos `.md` con front matter desde el mismo `cuerpo` (`htmlAMarkdown`) e `index.md`/`carta.md`
  desde los datos, `<lastmod>` = `fecha` de `version.json` (`FECHA_SITIO`), `schemamap.xml` + `schema/local.jsonl` +
  `schemamap:` en robots, las 8 etapas de WorkOS en `auth.md`, `icons` en la server card, llms.txt con «Cuándo usar» y
  enlaces absolutos, api-catalog apuntando al OpenAPI. A mano: `index.html` (2 `<link rel="alternate">` + 2 `<li>` del
  pie), `carta.html` (`<link>`), `assets/js/local.js` (`enlaces.precios`, `enlaces.api`), `AGENTS.md` (lista de
  generados). Pruebas: `scripts/pruebas/_puntaje-ora.mjs` (11 chequeos calcados de ora, corren dos veces: sobre lo
  generado con todo encendido en `descubrimiento.test.mjs` y sobre el repo real en `puntaje-ora.test.mjs`, nuevo) y
  actualizadas `descubrimiento`, `funciones` (SUPERFICIES + presencias encendida), `reglas` (index.md/pricing.md como
  dato; el resto solo prohibiciones), `identidad` (pricing y api como páginas ancla), `raiz` (busca el nodo Restaurant),
  `_sitio` (copia `version.json`). Docs: README («La versión del sitio»: la fecha también la lee descubrimiento; si
  cambió, correrlo otra vez) y `docs/landing-y-agentes.md` («Puntaje de ora.ai»). **Medido:** los cuatro `--comprobar`
  en 0 (versión nueva `2026.10.03-ca7f5ca`); las pruebas que toca la tarea, por archivo: 236 + 107 + 253 = **596 ok, 0
  fallos**; la suite entera en paralelo (`node --test --test-force-exit scripts/pruebas/*.test.mjs`, log en
  `~/Developer/worktrees/resplandor--coordinacion/puntaje-ora/suite-completa.log`): 2073 pruebas, 1965 ok, 45 fallos,
  22 canceladas, 41 saltadas — **todos** los fallos en POS/impresión/Bre-B/Postgres desechable/navegador (topes de 8 s
  bajo carga), ninguno en un archivo de esta tarea; dos de esos archivos re-corridos solos (`version-aviso-navegador`,
  `pos-ola-c3-navegador`) dan 53/53. Criterio de cierre 1 cumplido; el 2 (POST a ora ≥ 12/16 y total ≥ 70) espera el
  push. Sin túnel: la re-medición es después del push.
- 2026-10-03: `estado: bloqueada`. **La desbloquea Yonatan**: (1) el push a `main` —ojo: `origin/main` avanzó a `64a09bd`
  mientras tanto (aviso de la sesión madre de la migración); al mezclar, correr `node scripts/version.mjs` y, si cambió la
  fecha, `node scripts/descubrimiento.mjs` otra vez—; (2) la re-medición de «Cómo re-medir» y anotar acá el resultado
  (→ `hecha` si ≥ 70, o la lista de lo que faltó). Lo que más subiría después y es suyo: desplegar el Worker del MCP y
  prender el proxy de Cloudflare sobre el dominio (sección «Lo que NO se puede desde GitHub Pages»).
- 2026-10-03: decisiones tomadas al ejecutar que no estaban escritas en el plan: `attestations[].artifact` con la URL
  del archivo atestiguado; `paginaTexto` ganó `prefijo` (los enlaces del pie de `api/index.html` suben un nivel),
  `markdown` y `extrasHead`; `htmlAMarkdown` es chico a propósito (h1–h3, p, ul/ol, pre, a, code, em/strong, wbr) y los
  enlaces del `.md` quedan absolutos; `pre`/`pre code` entraron al estilo de las páginas de texto; `--test-force-exit`
  para que la suite entera termine (sin eso la corrida en segundo plano no salía nunca). No se tocó `main` ni se hizo
  push (regla de la casa y pedido explícito de la sesión madre).
