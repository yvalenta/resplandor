---
estado: propuesta
dueño: sesión
fecha: 2026-10-04
tema: segunda ronda del puntaje de ora.ai (hoy 73/100, B): lo que quedó a medias y se arregla con archivos estáticos, sin anunciar nada que no exista
criterio_cierre: los cuatro `--comprobar` en 0 y la suite en verde; tras el push, `POST https://ora.ai/api/scan` da 78 o más y los ids de abajo marcados «+» pasan completos (public-api-docs 3/3, agent-rules-repo 1/1, agent-plugins-repo 1/1, agent-instruction 3/3, pricing-md 2/2, schema-type-breadth 2/2, modular-llms-txt 1/1)
---

Sigue a `tareas/2026-10-03-puntaje-ora.md` (hecha: 59 → 73). Mismo worktree `~/Developer/worktrees/resplandor--puntaje-ora`
(rama `tarea/puntaje-ora`, ya al día con `main` en `f32577d`); mismas reglas: todo sale de `scripts/descubrimiento.mjs`, banderas
respetadas, ningún precio a mano, «la persona envía». El escaneo con el detalle de cada chequeo está en
`~/Developer/worktrees/resplandor--coordinacion/puntaje-ora/ora-score-2026-10-04.json` (y los `details` completos de los que
siguen a medias, pedidos aparte el 2026-10-04, abajo).

## Qué quedó a medias y por qué (detalle literal de ora, 2026-10-04)

| id | hoy | qué dijo ora | arreglo propuesto |
|---|---|---|---|
| public-api-docs (+) | 1/3 | «Documentation found at /api but not linked from homepage» — la portada SÍ enlaza `href="api/"` («API para agentes», pie) | el chequeo no vio el enlace relativo: ponerlo **raíz-relativo** `href="/api/"` y con texto que nombre la documentación («Documentación de la API») — a mano en `index.html`; medir después |
| agent-rules-repo (+) | 0/1 | «Could not locate a public repo…»; el repo está enlazado en llms.txt (línea «Repositorio») y en `/api/`, pero no en la portada | sumar en el pie de `index.html` «Código fuente» → `https://github.com/yvalenta/resplandor` (a mano, mismas clases `enlace-pie`); `AGENTS.md` y `plugin.json` ya están en la raíz del repo |
| agent-plugins-repo (+) | 0/1b | «No Agent Plugins manifest (plugin.json) found in discovered repos» — depende de que descubra el repo | lo mismo de arriba |
| agent-instruction (+) | 2/3 | «Agent instruction file at /.well-known/agent-skills/ but no explicit when-to-use guidance» (es un chequeo juzgado por un modelo, y miró las SKILLS, no llms.txt) | en las dos skills (`construirAgentSkills`), una sección «## Cuándo usar esta skill (when to use)» con disparadores concretos y «cuándo NO» (sin inglés entero: un subtítulo bilingüe basta) |
| pricing-md (+) | 1/2 | «thin (26 lines) - add plan tiers, prices, and feature breakdowns» | sin inventar precios: una tabla de «niveles» para agentes y desarrolladores (lectura de la carta por API, WebMCP, archivos, solicitudes: todo gratis, sin registro, sin cuota propia; pagos máquina: no aplica) y una tabla por tipo de celebración (de `TIPOS`) con «dónde», «personas» (10 a 30; mesa y cena romántica sin mínimo), «cómo se cotiza» (WhatsApp, 48 h) y «qué NO incluye» (domicilio, catering); la misma tabla en `pricing.html` |
| schema-type-breadth (+) | 1/2 | «Some extended schema types found: FAQPage - add FAQPage, Service, or AggregateRating» | un bloque `Service` por familia («Reserva de mesa», «Celebraciones en el local») con `provider` → `#organizacion`, `areaServed` La Estrella, `availableChannel` (WhatsApp) y **sin** `offers` ni precio; nada de AggregateRating (prohibido: reseñas de Maps). Revisar las pruebas que exigen `offers`/`makesOffer` ausentes en el nodo Restaurant: siguen valiendo |
| modular-llms-txt (+) | 0/1b | «Only 1 section-level llms.txt found (api) - add at least one more (/docs/llms.txt…)» | `docs/llms.txt` generado: índice de `docs/*.md` (ruta + primer H1 de cada uno, en orden estable) para agentes de código; `docs/` ya se sirve público |
| pagination-shape | 0/2 | «No pagination pattern found in OpenAPI spec» | comprobar que `listarCarta` declare `limit` y `offset` como `query` con `schema.type: integer` y la cabecera `Content-Range` en 200/206 con `schema`; sumar `x-pagination: { style: "offset", parameters: ["limit","offset"], header: "Range" }`. Baja confianza: medir |
| api-versioning-policy | 2/3 | «no deprecation or sunset policy detected - add Sunset…» | en `info.description` y `x-deprecation-policy`: cómo se avisaría un cambio (`deprecated: true` + nota en este documento y en `/api/`); no prometer una cabecera `Sunset` que PostgREST no manda |
| markdown-url-fallback | 1/2b | muestreó `/api.md`, `/.well-known/api-catalog.md` y `/api/llms.txt.md` (pega `.md` a cualquier enlace) | solo `api.md` (gemelo de `/api/`, mismo contenido que `api/index.md`) tiene sentido; los otros dos, no. Opcional |
| sandbox-environment | 0/2b | «No sandbox or test environment found» | en `/api/` y en el spec, un apartado «Entorno de pruebas (sandbox)» que diga que no hace falta uno (solo lectura, sin efectos) y cómo probar sin riesgo (`limit=1`). Puede seguir en 0: es honesto igual |

No se toca (ya decidido o no estático): json-ld-entity-linking (pide Wikipedia/Wikidata/GitHub como `sameAs`: el repo no es la
identidad del local; lo destraba un ítem de Wikidata con P856, de Yonatan), json-error-responses y agent-friendly-404 (Pages
responde HTML a rutas inexistentes: proxy), rate-limit/idempotency/async/batch (no hay escrituras ni colas: no se inventan),
mcp-* (desplegar el Worker), onboarding-friction (nada que hacer), brand-search/agentic-search/wikipedia (indexación).

## Bitácora
- 2026-10-04: declarada por la sesión que re-midió (73 B) a partir del detalle literal de ora; sin código todavía.
