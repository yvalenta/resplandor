---
estado: en-curso
dueño: ambos
fecha: 2026-11-12
tema: las tres Edge Functions (`cuenta`, `alerta`, `votar`) pasan de la llave heredada `SUPABASE_SERVICE_ROLE_KEY` a la llave secreta nueva (`SUPABASE_SECRET_KEYS["default"]`), con la heredada de respaldo, para que sigan andando cuando Supabase apague las heredadas a fin de 2026
criterio_cierre: las tres desplegadas desde esta rama en el proyecto que esté en producción; `functions list` las muestra con versión nueva; Edge Functions → Secrets lista `SUPABASE_SECRET_KEYS`; el curl de `cuenta` y el de `alerta` con un token falso dan 404 `enlace_invalido` y el OPTIONS de `votar` da 200
---

Pedido del 2026-11-12, por la sesión de la mudanza a Supabase (`tarea/mudanza-supabase`): las funciones leen la llave heredada, que
según la documentación de Supabase funciona solo hasta fin de 2026; que lean la llave secreta nueva y dejen la heredada de respaldo.
La sesión deja el código, las pruebas y este guion. El push y el despliegue son de Yonatan (`AGENTS.md`, «Lo que un agente NO hace
solo»): aquí no se desplegó nada.

## Lo que hay que saber

- **Qué dice Supabase** (https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys, leído el 2026-11-12):
  - Las Edge Functions reciben `SUPABASE_SECRET_KEYS`, un JSON con las llaves secretas por nombre, junto a las heredadas. La que
    se crea primero se llama `default`, y la forma de leerla es `JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default']`.
  - `createClient(url, 'sb_secret_…')` sirve tal cual en lugar de la `service_role`. Para la base, la llave secreta es el mismo
    rol `service_role`, así que los GRANT de las migraciones siguen valiendo.
  - Una llave nueva **no es un JWT**: va solo en la cabecera `apikey`. En `Authorization: Bearer` la plataforma intenta leerla
    como JWT y la rechaza. El broadcast por REST de Realtime (`/realtime/v1/api/broadcast`) se documenta solo con `apikey`.
  - Las heredadas (`anon` y `service_role`) se pueden desactivar en Settings → API Keys, y la doc dice que eso se puede deshacer.
- **Qué usa cada cosa hoy.** La carta, el POS, `menu.html`, el agente de impresión y el Worker del MCP ya usan la llave
  publicable (`sb_publishable_…`). En el repo, lo único que usaba una llave heredada eran estas tres funciones; desde este cambio la
  heredada es solo su respaldo (`git grep` del 2026-11-12). Fuera del repo no se puede ver; por ejemplo, una tablet con un POS
  muy viejo en caché.
- **Cómo se elige la llave.** `llaveDeServicio()` es la misma función, al pie de la letra, en los tres `index.ts`:
  - Toma `SUPABASE_SECRET_KEYS["default"]` si es un texto no vacío.
  - Si no (la variable no está, el JSON está roto o no tiene `default`), toma `SUPABASE_SERVICE_ROLE_KEY`, como antes.
  - Devuelve `{ llave, heredada }`. Ninguna función escribe la llave en un log.
- **`votar`** manda la llave también en su broadcast. Con la nueva va **solo** en `apikey`; con la heredada sigue en `apikey` y
  `Authorization`, como siempre. Hoy `menuDeHoy` está apagado (`assets/js/local.js`), así que en producción no corre.
- **El empaquetador** (`scripts/empaquetar-funcion.mjs`, el pegado por el dashboard) sigue sirviendo: `votar` sigue sin imports
  locales y sale idéntica, y el `alerta` y el `cuenta` empaquetados responden igual que los originales. Igual se despliega por
  CLI, nunca por el dashboard.

## Lo que se hizo

Rama `tarea/llave-secreta-funciones`, desde `origin/main` (`6446215`), en el worktree
`~/Developer/worktrees/resplandor--llave-secreta`. Sin push.

- `supabase/functions/{cuenta,alerta,votar}/index.ts`: `llaveDeServicio()`; la constante pasa de `SERVICE_ROLE` a `LLAVE_SERVICIO`.
  En `votar`, `Authorization` va solo con la heredada.
- `scripts/pruebas/_funcion-simulada.mjs`: `CASOS_LLAVE`, nueve entornos de los dos caminos con la llave que `createClient` debe
  recibir. Son la heredada sola; las dos (gana la nueva); la nueva sola, con la heredada ya apagada; y seis maneras en que la nueva
  no sirve y vale la heredada: sin `default`, `default` vacía, `default` que no es texto, un texto suelto, JSON roto y variable vacía.
- `scripts/pruebas/_funcion-alerta.mjs`: `cargarAlerta` acepta `entorno` y devuelve `clientesCreados`. Su gancho síncrono no convive
  en un proceso con el de `cargarFuncion`; por eso los casos de `alerta` van en su propio archivo.
- `scripts/pruebas/fn-llave-secreta.test.mjs` (21 pruebas):
  - el texto de `llaveDeServicio()` es igual en las tres funciones;
  - cada función lee las dos variables una sola vez y solo ahí, y no las manda a un log;
  - `cuenta` y `votar` corren con cada caso y responden 200, y `createClient` recibe la llave que toca;
  - el broadcast lleva la llave en las cabeceras que tocan;
  - un broadcast que falla no rompe el voto y no deja la llave en el log.
- `scripts/pruebas/roles-y-alertas.test.mjs`: B5l (los nueve casos con `alerta`, que crea la alerta con la llave que toca) y B5m
  (con solo la nueva, un fallo de la base es 500 sin la llave en logs ni en la respuesta).
- `docs/sdd-cuenta-en-mesa.md` §10: la fila «que `SUPABASE_SERVICE_ROLE_KEY` siga inyectada después de fin de 2026» pasa a ser «que
  el proyecto inyecte la nueva», que es lo que sigue sin verse desde el repo.

## Pruebas (2026-11-12, Node 22.23.4)

- `fn-llave-secreta`, `roles-y-alertas`, `empaquetar-funcion`, `fn-cuenta`, `fn-cuenta-pago` y `fn-cuenta-mesa-inactiva`:
  149 de 149.
- `pos-ola-c`, `pos-roles-alertas-cobros`, `integracion-pago-breb` y `migracion-pago-breb`: 186 de 187. El salto es la comprobación
  SRI de `qrcode.js`, que necesita red.
- Ocho mutantes de las funciones, todos muertos:
  - `cuenta` lee solo la heredada; `alerta` lee solo la heredada; `cuenta` prefiere la heredada;
  - `votar` manda siempre `Authorization`; `votar` nunca lo manda; `votar` lee otra llave que `default`;
  - `alerta` sin `try` (un JSON roto revienta al arrancar); `alerta` acepta una `default` vacía.
- Los cuatro `--comprobar` salen con exit 0. El sello sigue en `2026.11.10-9a6fe34`, porque su huella no cubre las funciones, las
  pruebas ni `docs/`.
- Lo que estas pruebas no ven:
  - El Deno de verdad, la CLI y la plataforma: en esta máquina no hay Deno ni supabase CLI, y las funciones corren en Node con
    Deno y supabase-js simulados.
  - Que el `supabase-js@2` del despliegue acepte la llave `sb_secret_` en `createClient`. Lo dice la doc citada arriba.
  - Que el proyecto tenga la llave secreta `default`. Hay un indicio: la carta usa la publicable de ese mismo proyecto, y la doc
    dice que la publicable y la secreta se crean juntas con el nombre `default`.

## Para Yonatan: desplegar y confirmar

Producción hoy es `lccgehvyymladqvumcez`. Si la mudanza ya pasó, cambia el ref por `lauiasfcbrbjzdkxnbag` en todos los comandos.

**0. La CLI con la cuenta buena.** `npx supabase projects list` tiene que listar `lccgehvyymladqvumcez`. Si no lo lista, está
entrada con la cuenta vieja: `npx supabase logout` y `npx supabase login` con la cuenta de producción.

**1. La llave nueva existe.**
- En el dashboard (la URL tiene que decir `project/lccgehvyymladqvumcez`), Settings → API Keys, pestaña «Publishable and secret
  API keys»: tiene que haber una secret key `default`.
- Si sale el botón «Create new API keys», el proyecto no tiene llaves nuevas. Crearlas no toca las heredadas.
- Después, Edge Functions → Secrets tiene que listar `SUPABASE_SECRET_KEYS`.
- Sin ella, las funciones desplegadas siguen con la heredada: nada se rompe, pero no queda hecho.

**2. Desplegar** desde este worktree (o desde `main`, cuando la rama esté fusionada):

```bash
cd ~/Developer/worktrees/resplandor--llave-secreta && for f in cuenta alerta votar; do npx supabase functions deploy $f --no-verify-jwt --project-ref lccgehvyymladqvumcez || break; done
```

**3. Confirmar.**

```bash
npx supabase functions list --project-ref lccgehvyymladqvumcez
```

Las tres tienen que salir con la versión una arriba de la que tenían y la hora de ahora. Eso dice que lo desplegado es este código.

```bash
B=https://lccgehvyymladqvumcez.supabase.co/functions/v1
curl -s -w ' → %{http_code}\n' "$B/cuenta?m=1&k=ffffffffffffffffffffffffffffffffffffffffffffffff"
curl -s -w ' → %{http_code}\n' -X POST "$B/alerta" -H 'content-type: application/json' -d '{"m":1,"k":"ffffffffffffffffffffffffffffffffffffffffffffffff","metodo":"qr"}'
curl -s -o /dev/null -w 'votar → %{http_code}\n' -X OPTIONS "$B/votar"
```

| Llamada | Esperado | Qué prueba |
|---|---|---|
| `cuenta` con un token falso | `{"error":"enlace inválido","codigo":"enlace_invalido"}` → 404 | arrancó y leyó `mesas` con la llave de servicio |
| `alerta` con un token falso | `codigo` `enlace_invalido` → 404 | arrancó y la RPC `alertar_cuenta` corrió con la llave (no escribe nada: el par no existe) |
| OPTIONS a `votar` | 200 | arrancó |

- Un **500** en `cuenta` o en `alerta` es la llave: la base no la aceptó.
  - Vuelve atrás desplegando las tres desde `6446215`, el commit de antes de este cambio: `git worktree add
    ~/Developer/worktrees/resplandor--antes-llave 6446215`, `cd` ahí y el mismo `for`. Así vuelven a leer solo la heredada. Con esta
    rama ya en `main`, `main` no sirve para volver atrás.
  - Mira en Edge Functions → Logs el error de `cuenta`.
- El curl solo no dice **cuál** llave se usó. Lo dice la cadena del paso 1 (la variable existe), el `functions list` (el código
  nuevo está) y el 404 (la llave que ese código eligió entra a la base).

**4. Confirmación definitiva (opcional, con el local cerrado).**
- En Settings → API Keys, desactiva las llaves heredadas y repite los dos primeros curl.
- Si `cuenta` y `alerta` siguen dando 404, las funciones ya no dependen de la heredada. Si alguna da 500, todavía depende: vuelve a
  activar las heredadas. La doc dice que se pueden reactivar.
- Desactivarlas también corta cualquier cosa de fuera del repo que siga con la `anon` o la `service_role` (en el repo no queda
  ninguna). Por eso va con el local cerrado: si algo de la sala falla, reactívalas.

## La mudanza

`tarea/mudanza-supabase` salió de `6446215` igual que esta rama, y sus funciones siguen leyendo solo la heredada. Si su paso 6
(desplegar las tres en `lauiasfcbrbjzdkxnbag`) se corre desde su worktree antes de fusionar esta rama, el proyecto nuevo se queda
con la heredada. Hay dos salidas: fusionar esta rama en la de la mudanza antes del paso 6, o desplegar desde `main` cuando las dos
estén fusionadas. El guion de la mudanza ya avisa que un 500 en `cuenta` es la llave.

## Bitácora

- 2026-11-12: código, pruebas, §10 y este guion en `tarea/llave-secreta-funciones` (`606cb85`, `6776fa2`). Sin push y sin desplegar.
- 2026-11-12, más tarde: Yonatan pidió en el chat «merge a main y dpeloy». La sesión que hizo el código ya había pasado la regla de
  corte (200k), así que el push a `main` y el despliegue los hace una sesión fresca desde esta tarea. Falta:
  - `git fetch` y comprobar que `origin/main` siga en `6446215`; si se movió, fusionar y volver a correr las pruebas de las funciones;
  - `git push origin tarea/llave-secreta-funciones:main`;
  - los pasos 0 a 3 de arriba, con el ref de producción que diga `local.json` al aire;
  - anotar aquí el rango del push, las versiones de `functions list` y lo que dieron los curl.
- 2026-11-13: Yonatan corrió los comandos en su terminal.
  - `origin/main` estaba en `6446215`; el push entró como fast-forward, `6446215..86443e9`. Pages sigue con `2026.11.10-9a6fe34`.
  - Desplegó `cuenta`, `alerta` y `votar` en `lccgehvyymladqvumcez` con `npx supabase@3.1.0` (empaquetado con
    `edge-runtime v1.78.1` en Docker; la CLI 3 avisa que `--project-ref` pasa a `--remote` en la v4).
  - Curl de la sesión: `cuenta` y `alerta` con un token falso dan 404 `enlace_invalido` y el OPTIONS de `votar` da 200.
  - Falta para cerrar: ver en Edge Functions → Secrets que exista `SUPABASE_SECRET_KEYS`. Sin ella, las funciones siguen con la
    heredada.
