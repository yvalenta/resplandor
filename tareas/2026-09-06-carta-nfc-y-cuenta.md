---
estado: en-curso
dueño: ambos
fecha: 2026-09-06
tema: carta digital para las pegatinas NFC de las mesas + ver la cuenta al tocar (peldaño 2)
criterio_cierre: carta.html nueva desplegada en resplandor.ynt.codes leyendo la vista carta_publica; una mesa piloto con pegatina que muestra su cuenta abierta; visto de Yonatan sobre el diseño
---

Yonatan compró pegatinas NFC (NTAG215). Cada mesa lleva una que abre la carta
de Resplandor; el paso siguiente es que la misma pegatina muestre la cuenta de
esa mesa. Esta tarea nació en una sesión de `audited-vault` que pasó los 200k y
cerró por la regla de corte; **todo lo medido está acá para arrancar en frío.**

## Hechos medidos (con fuente)

**Stack real del sitio** — README del POS §03/§05: HTML + Tailwind CDN +
Alpine.js + Lucide + Supabase. Tokens implementados: `ember #B5341C`
(acción), `teal #2A7B72`, `amber #C08B2C` (precios/totales), `parch #F7F2EC`
(fondo), `ink #1C1A17`, `card #FFFFFF`. Tipografía Fraunces (display) + DM Sans.

**La clave del color.** El aviso de la calle es rojo sobre negro (foto de
Yonatan, 6-sep); el logo es un monograma "R" monolínea **dorado** en un aro
(imagen de Yonatan, 6-sep). Los dos coexisten mal en crudo — Yonatan: *"el
color no combina"*. Pero la paleta del POS ya los reconcilió: `ember` es el
rojo del aviso domesticado y `amber` es el oro del logo domesticado. **Usar
los tokens del POS**; rojo y oro no se juntan salvo en el lockup del logo.

**Marca vencida en el repo.** `img/logo.png` (ladrillo/crema/salvia, "cocina
mixta") NO es el logo. `landing.html` tema "Selva" (verde `#0a2a1a` + dorado)
y el brief del pptx (`../README.md`, mostaza `#F4A127`) también divergen.
El aviso dice RESTAURANTE, no "cocina mixta". El aviso se queda (decisión
de Yonatan, 6-sep).

**Datos.** `productos` tiene 31 filas, todas `activo=true` (SELECT vía MCP,
3-sep). Es lista de facturación, no carta: `Jugo · "Juguito" · $2.000` es un
atajo de caja → fuera de la carta pública. `carta.html` actual tiene 8 platos
hardcodeados y ya miente (sin cerveza, Corona, agua, gaseosa, sopa, sancocho).

**Seguridad.** Las 4 tablas del POS son authenticated-only tras el incidente
11.1 (README §11). Una página pública en cada mesa NO puede leerlas ni debe.
⚠️ `resplandor_bd.sql` en el repo TODAVÍA declara `anon full access` sobre
productos/mesas/ordenes/cierres: correrlo reabre la fuga. Deuda: quitarlas.

**Supabase.** Proyecto `yjtcrhmdztbuylgpuvsm`; key pública `sb_publishable_…`
en `menu.html`. Precedente a copiar: `supabase/functions/votar/index.ts`
(service-role, rate-limit por IP en memoria, CORS, `verify_jwt=false`, y
por qué: la RLS bloquea a anon y la función es la única puerta).

**Esquema que toca el peldaño 2** (`resplandor_bd.sql`):
`mesas(id int pk, capacidad, estado libre|ocupada)`;
`ordenes(id text pk, mesa_id → mesas, estado abierta|cerrada, items jsonb,
total numeric, abierta_en, cerrada_en)`; índice único parcial
`ordenes(mesa_id) where estado='abierta'` (incidente 11.2). Forma exacta de
`items`: ver `parseOrden()` en `index.html`.

## Lo hecho

- **Carta v2 en el repo: `carta.html`** (reemplaza a la vieja de 8 platos; el
  borrador `carta-nfc.html` se retiró). Stack del POS: Tailwind CDN + Alpine
  3.14.9 (cdnjs) + Lucide 0.475 (jsdelivr), pineados. Tokens del POS: `ember`
  solo en la acción principal y la pestaña activa, `amber` en precios, Fraunces
  en nombre y títulos, monograma dorado como sello sobre `parch`. Lenguaje
  shadcn: tarjetas neutras, badges ("De la casa", "Hoy"), tabs pegajosas con
  scroll-spy, sheet que sube, reveal escalonado (respeta reduced-motion).
  Datos: lee `carta_publica` por REST con la key pública; si no responde en 4 s
  cae a la FOTO del 3-sep (31 filas, el "Menú Resplandor" alimenta la tarjeta
  del día). Artifact de revisión (privado, muestra la FOTO por la CSP):
  https://claude.ai/code/artifact/864c23e7-025c-49e1-9c6b-2fee92404c30
- **Peldaño 2 escrito, no desplegado:**
  - `supabase/migrations/20260906120000_carta_publica_y_token_mesa.sql`:
    `productos.en_carta` + backfill (todo menos el Juguito), vista
    `carta_publica` (SECURITY DEFINER a propósito, 4 columnas, grant SELECT a
    anon), `mesas.token` (48 hex, default `gen_random_bytes`, único).
  - `supabase/functions/cuenta/index.ts`: `GET ?m=&k=` → valida el par
    (id, token) con service-role, devuelve SOLO la orden abierta (nombre,
    precio, cantidad, total, hora); rate-limit 40/min/IP; `Cache-Control:
    no-store`. Patrón de `votar`.
  - `carta.html`: con `?m=<mesa>&k=<token>` válidos la barra fija pasa a "Ver
    mi cuenta · Mesa N" y abre el sheet (cargando / vacía / error / cuenta,
    refresco cada 20 s mientras esté abierto, propina 10% mostrada aparte).
  - POS `index.html`: botón "Enlace NFC" en las acciones secundarias de la
    orden → panel con la URL de la pegatina, "Copiar" y "Rotar" (token nuevo
    con `crypto.getRandomValues`, `pushASupabase('mesas')`).
- **Deuda saldada:** `resplandor_bd.sql` ya no declara policies `anon`
  (ahora `authenticated full access` por tabla, en un `do $$` idempotente);
  README §07 documenta la vista y la función como la única superficie de
  `anon`. `resplandor` entró a la constelación (`CONSTELACION.md` + symlinks
  en `~/Developer/resplandor/` porque el barrido mira un nivel; sigilo
  `bc12f77`).
- **No verificado en navegador:** dos Chrome conectados (elegir uno pide
  respuesta) y Brave headless no renderiza en esta Mac. La sintaxis del JS
  nuevo pasó por `new Function`; la mirada real es el artifact y, tras el
  push, resplandor.ynt.codes.

## Lo que falta — plan para la sesión fría

**C. Lo que aparca para Yonatan** (LINEA_ROJA lista 2 + clasificador), en
este orden:
1. Aplicar la migración en Supabase → SQL Editor (o `supabase db push`).
   Luego `get_advisors` security: debe listar `carta_publica` como
   `security_definer_view` (esperado) y nada nuevo sobre las 4 tablas.
2. `supabase functions deploy cuenta --no-verify-jwt` (como `votar`).
3. `git push` → GitHub Pages sirve `carta.html` nueva.
4. Probar en el celular: `carta.html` (debe decir "Carta en vivo"), y con el
   enlace de una mesa desde el POS ("Enlace NFC") con una orden abierta.
5. Escribir la pegatina piloto con ese enlace (NTAG215).

**Después del visto de Yonatan sobre el artifact:** ajustar lo que pida en
`carta.html` y volver a publicar el artifact (misma URL).

**D. Datos que faltan:** horario real de apertura; vectorial del monograma
(el SVG es redibujado); número de WhatsApp.

**E. Deuda que queda:** alinear `landing.html`, `img/logo.png` y el brief
del pptx a la marca real. `nomicheck_ops` nombra a `resplandor` en código
sin arista declarada (lo listó el barrido; es de aquel repo). Los symlinks
de `~/Developer/resplandor/` no están versionados: si esa carpeta se
recrea, rehacerlos.

Peldaño 3 (pedir desde la mesa → `pedidos_pendientes`) NO arrancado.

## Bitácora
- 2026-09-06: tarea creada al cerrar por regla de corte (208k). Evidencia:
  artifact 4ec32917 (5 versiones), SELECT a `productos` (31 filas), foto del
  aviso y del monograma, README POS §05/§11, `votar/index.ts`. Borrador en
  `carta-nfc.html`. Migración `carta_publica` bloqueada por el clasificador,
  no aplicada. Nada desplegado, nada pusheado.
- 2026-09-06 (noche): peldaño 2 pasa de token manual a `{TAG-ID}` de NFC Tools
  (UID del chip en la URL, escritura idéntica para todas las pegatinas).
  Evidencia: pantalla de variables de NFC Tools (captura de Yonatan). Sin
  cambios en producción.
- 2026-09-06 (noche): sesión fría desde `/casa`. Carta v2 (`carta.html`),
  migración, función `cuenta`, "Enlace NFC" en el POS, policies anon fuera
  del SQL, README §07, nodo en la constelación. Artifact 864c23e7 v1. Nada
  aplicado, desplegado ni pusheado: lo aparcado está en C. Sigue `en-curso`.
