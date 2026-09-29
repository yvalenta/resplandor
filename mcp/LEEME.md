# MCP remoto de Resplandor Restaurante

Un Worker de Cloudflare, sin dependencias ni SDK, que expone cuatro herramientas de solo
lectura para agentes que no navegan la página: los datos del local, la carta en vivo, el
menú de la semana en vivo, y preparar una solicitud (reserva, almuerzo programado o
celebración) con su enlace de WhatsApp. **Nunca envía, reserva ni cobra nada**: arma el
mensaje y la persona lo manda ella misma (la misma decisión que la web — ver `README.md`
de la raíz). Todo evento y toda celebración es **en el restaurante**, de 10 a 30 personas
(una reserva de mesa o un almuerzo programado no tienen ese mínimo, solo el máximo de 30 —
dato de Yonatan, 2026-09-28): nunca a domicilio, nunca catering externo. La única excepción
es el almuerzo programado, que puede ser a domicilio si la persona asume el costo. Sin USDC
ni pagos: acá no hay nada que pagar.

Nada acá es secreto: el repo es público y GitHub Pages sirve `mcp/` igual que el resto.

## Piezas

- `worker.mjs` — el servidor: transporte MCP Streamable HTTP a mano (JSON-RPC 2.0,
  `POST /mcp`) y las cuatro herramientas (`resplandor_ver_local`, `resplandor_ver_carta`,
  `resplandor_ver_menu_semana`, `resplandor_preparar_solicitud`). Importa
  `../assets/js/local.js`, `../assets/js/solicitud.js` y `../assets/js/vivo.js` por su
  efecto de lado: la solicitud se arma con el mismo código que usa la web, no una copia.
- `wrangler.toml` — nombre, `LOCAL_URL` (por defecto `local.json` en producción) y la
  ruta al dominio `mcp.resplandor.ynt.codes`.

La carta y el menú de la semana **siempre se piden en vivo** a Supabase (la misma vista
`carta_publica` y tabla `menus` que leen `carta.html`/`menu.html`); si la red o la base
fallan, la herramienta responde con un error claro en vez de servir datos viejos. Los
datos del local y las reglas de la solicitud vienen del bundle (código, no un catálogo
que cambie seguido), pero antes de armar una solicitud de verdad el Worker compara
`local.json` en vivo contra las reglas congeladas en este bundle — si alguien tocó
`assets/js/solicitud.js` y corrió `scripts/descubrimiento.mjs` sin redesplegar este
Worker, se detecta y se pide redesplegar.

## Probarlo en local

```bash
# 1) servir el sitio (para que local.json exista en algún lado)
cd ~/Developer/resplandor/resplandor && node scripts/descubrimiento.mjs && python3 -m http.server 8791 --bind 127.0.0.1 &

# 2) el Worker, apuntando ahí en vez de a producción
cd ~/Developer/resplandor/resplandor/mcp
LOCAL_URL=http://127.0.0.1:8791/local.json npx wrangler dev
```

Y probar con `curl` (el Worker queda en `http://127.0.0.1:8787` por defecto):

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'

curl -s http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"resplandor_ver_local","arguments":{}}}'
```

Las pruebas automáticas (sin red, con `local.json`/la carta/el menú inyectados) están en
`scripts/pruebas/mcp.test.mjs` y corren con `node --test scripts/pruebas/*.test.mjs` desde
la raíz del repo (el directorio a secas, sin el glob, puede fallar con `MODULE_NOT_FOUND`
en algunas máquinas — ver el comentario de `.github/workflows/comprobar.yml`).

## Desplegarlo (pasos de Yonatan — nadie más hace esto)

```bash
cd ~/Developer/resplandor/resplandor/mcp
npx wrangler login          # una vez, por navegador
npx wrangler deploy         # publica en mcp.resplandor.ynt.codes
```

Después de desplegar, sumá la URL real (`https://mcp.resplandor.ynt.codes/mcp`) a
`llms.txt` en la raíz del sitio y, si hace falta anunciarla en algún JSON, actualizá
`agentes.mcp` de `local.json` (vía `scripts/descubrimiento.mjs`, no a mano).

Hasta que eso pase, `local.json` trae `agentes.mcp: null` a propósito — mejor no
anunciar un endpoint que todavía no existe. Esta sesión **no desplegó nada**: se validó
localmente y, si el entorno lo permitió, con `wrangler deploy --dry-run` (ver el informe
de la tarea).
