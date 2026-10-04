# auth.md

Estás leyendo esto como agente: Resplandor Restaurante (https://resplandor.ynt.codes/) NO ofrece registro de agentes, y este archivo sigue el formato de Auth.md (https://workos.com/auth-md) para decirlo de forma explícita.

Resumen: nada público de este sitio pide credenciales, y ningún agente puede autenticarse para reservar, enviar ni cobrar en tu nombre — eso lo hace la PERSONA, desde su propio WhatsApp.

## Registro de agentes

Este sitio no ofrece ninguno de los métodos de registro de Auth.md (`identity_assertion`, `service_auth`, `anonymous`): no hay nada que descubrir (ningún 401 con `WWW-Authenticate`, ningún bloque `agent_auth`), nada que registrar ni que reclamar, ningún `access_token` que canjear, usar ni revocar. Todo lo que un agente puede hacer acá es leer, sin credenciales.

### Discover (descubrir)

No hay nada que descubrir: ninguna respuesta de este sitio devuelve un 401 con `WWW-Authenticate`, ni un bloque `agent_auth`, ni un `identity_endpoint`. Todo lo público responde 200 sin credenciales.

### Pick a method (elegir método)

Ningún método aplica: ni `identity_assertion` (no hay un servidor de identidad que emita un `id-jag`), ni `service_auth`, ni `anonymous`. No existe un recurso que exija elegir.

### Register (registrar)

No hay registro de agentes ni de clientes: ninguna ruta de este sitio recibe un registro y no se emite ningún identificador de cliente.

### Claim (reclamar)

No hay nada que reclamar: no se emiten credenciales, códigos ni enlaces de activación.

### Exchange (canjear)

No hay canje: nunca se emite un `access_token`, así que tampoco hay un `refresh_token`.

### Use the access_token (usar la credencial)

No hay credencial que usar: las lecturas (la carta, los archivos, WebMCP, el MCP) van sin cabecera `Authorization`. Lo único que lleva una lectura es la llave *publishable* de Supabase en la cabecera `apikey`, que es pública y no identifica a nadie.

### Errors (errores)

Sin flujo no hay errores de autenticación propios. Lo más parecido: PostgREST responde 401 en JSON si falta la llave publishable (`{"message": "No API key found in request", "hint": …}`) y se corrige mandándola; los demás errores de la API (400, 404, 416) también van en JSON (`{"code", "message", "details", "hint"}`): ver https://resplandor.ynt.codes/api/.

### Revocation (revocación)

No hay nada que revocar: no existen tokens ni sesiones de agentes. Lo único que se puede dejar de ver es la cuenta de una mesa, y eso lo cierra el restaurante, no un agente.

## Lecturas públicas (sin auth)

- **La carta en vivo** (https://resplandor.ynt.codes/carta.html): GET anónimo a Supabase con una llave *publishable* (no es secreta; ya está en el HTML de carta.html), a la vista de solo lectura `carta_publica`. Por las reglas de la base (RLS), la llave pública solo lee lo que el restaurante tiene público —la carta (`carta_publica`) y otras tablas públicas— y nunca las ventas, las cuentas ni el personal.
- **Los datos del local** (https://resplandor.ynt.codes/local.json, https://resplandor.ynt.codes/llms.txt): archivos estáticos, sin auth porque no hay nada que proteger — son los mismos datos que cualquier persona ve en la página.
- **WebMCP** (`document.modelContext` en https://resplandor.ynt.codes/): corre en el navegador de quien visita la página; no hay token de servidor que pedir ni que filtrar.
- **El MCP remoto** (`mcp/worker.mjs`, todavía sin desplegar — ver mcp/LEEME.md): sin auth, porque expone exactamente las mismas lecturas de arriba más «preparar una solicitud» (que tampoco escribe nada).

## Por qué no hay OAuth ni API key para escribir

No existe ninguna operación de escritura pública que un agente pueda invocar: no hay «reservar», «pagar» ni «enviar» en ninguna herramienta (WebMCP o MCP). `anotar_solicitud`/`resplandor_preparar_solicitud` arman un mensaje y un enlace `wa.me`; la persona lo abre y lo manda **desde su propia cuenta de WhatsApp** — su identidad, no la del agente ni la de este sitio. Por eso este sitio NO publica `.well-known/oauth-authorization-server` ni `.well-known/oauth-protected-resource`: harían pensar que hay un flujo de autorización real detrás de algo que no lo necesita.

## Sin pagos ni cobros

Sin USDC ni ningún otro medio de pago: acá no hay nada que pagar ni que autorizar. El sitio tampoco cobra: ninguna página trae cuentas, llaves ni códigos QR de pago, salvo la carta de una mesa con la cuenta abierta, que (si el restaurante lo tiene activado) muestra la llave y el código QR de Bre-B del propio restaurante para que una persona pague desde la app de su banco. El dinero lo recibe el restaurante, nunca un agente.

El botón «Pagar» de la cuenta de una mesa solo AVISA al personal (QR, transferencia o efectivo): no cobra ni cierra nada, y no se ofrece como herramienta a ningún agente (ni en WebMCP, ni en el MCP, ni en `llms.txt`). Lo toca una persona, desde su mesa.

## Lo que sí pide cuenta: el punto de venta (no es público)

El punto de venta del restaurante (`/pos.html`, de uso interno y con `noindex`) exige una cuenta de Google que además esté aprobada en la lista del personal (rol `mesero` o `admin`); la base de datos hace cumplir lo que cada rol puede hacer. Una cuenta de Google que lo pide sin estar aprobada queda como solicitud pendiente y solo ve el mapa de mesas y la carta. No forma parte de ninguna superficie para agentes: no hay API key, ni forma de que un agente obtenga ese acceso.

## Lo que exige un código, no una cuenta: la cuenta de una mesa

La cuenta de una mesa (`carta.html?m=<mesa>&k=<código>`) no es una lectura abierta: exige el código secreto de la pegatina de esa mesa. No es una autenticación de nadie ni se obtiene registrándose; no está pensada para agentes y no se anuncia en ninguna superficie para agentes (`local.json`, `llms.txt`, WebMCP, MCP). Solo muestra la cuenta abierta de esa mesa, sin datos de personas.

## Más

Agent Skills (`https://resplandor.ynt.codes/.well-known/agent-skills/index.json`), MCP Server Card (`https://resplandor.ynt.codes/.well-known/mcp/server-card.json`) y API Catalog (`https://resplandor.ynt.codes/.well-known/api-catalog`) documentan cada herramienta una por una.
