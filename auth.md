# Autenticación — Resplandor Restaurante

Resumen: nada público de este sitio pide credenciales, y ningún agente puede autenticarse para reservar, enviar ni cobrar en tu nombre — eso lo hace la PERSONA, desde su propio WhatsApp.

## Lecturas públicas (sin auth)

- **La carta y el menú en vivo** (https://resplandor.ynt.codes/carta.html, https://resplandor.ynt.codes/menu.html): GET anónimo a Supabase con una llave *publishable* (no es secreta; ya está en el HTML de carta.html), protegida por reglas de base de datos (RLS) a exactamente dos vistas de solo lectura: `carta_publica` y `menus`. Ninguna otra tabla es alcanzable con esa llave.
- **Los datos del local** (https://resplandor.ynt.codes/local.json, https://resplandor.ynt.codes/llms.txt): archivos estáticos, sin auth porque no hay nada que proteger — son los mismos datos que cualquier persona ve en la página.
- **WebMCP** (`document.modelContext` en https://resplandor.ynt.codes/): corre en el navegador de quien visita la página; no hay token de servidor que pedir ni que filtrar.
- **El MCP remoto** (`mcp/worker.mjs`, todavía sin desplegar — ver mcp/LEEME.md): sin auth, porque expone exactamente las mismas lecturas de arriba más «preparar una solicitud» (que tampoco escribe nada).

## Por qué no hay OAuth ni API key para escribir

No existe ninguna operación de escritura pública que un agente pueda invocar: no hay «reservar», «pagar» ni «enviar» en ninguna herramienta (WebMCP o MCP). `anotar_solicitud`/`resplandor_preparar_solicitud` arman un mensaje y un enlace `wa.me`; la persona lo abre y lo manda **desde su propia cuenta de WhatsApp** — su identidad, no la del agente ni la de este sitio. Por eso este sitio NO publica `.well-known/oauth-authorization-server` ni `.well-known/oauth-protected-resource`: harían pensar que hay un flujo de autorización real detrás de algo que no lo necesita.

## Sin pagos

Sin USDC ni ningún otro medio de pago: acá no hay nada que pagar ni que autorizar.

## Más

Agent Skills (`https://resplandor.ynt.codes/.well-known/agent-skills/index.json`), MCP Server Card (`https://resplandor.ynt.codes/.well-known/mcp/server-card.json`) y API Catalog (`https://resplandor.ynt.codes/.well-known/api-catalog`) documentan cada herramienta una por una.
