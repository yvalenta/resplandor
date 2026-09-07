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

- Carta v1 publicada como artifact (privado):
  https://claude.ai/code/artifact/4ec32917-b088-4340-88e8-dec68a564f9f
  Borrador guardado en el repo: `carta-nfc.html` (30 platos reales como FOTO
  del 3-sep, menú del día por fecha con estado cerrado los domingos, estado
  `agotado`, monograma redibujado en SVG, enlace a `menu.html`).
  Cinco iteraciones de identidad: placeholder → logo ladrillo → aviso rojo →
  monograma oro → oro+rojo. Veredicto de Yonatan: no combina → rediseñar.
- Migración `carta_publica` redactada y **bloqueada por el clasificador**
  (no aplicada, no rodeada):
  ```sql
  alter table public.productos add column if not exists en_carta boolean not null default false;
  create or replace view public.carta_publica with (security_invoker = false) as
    select categoria, nombre, precio, descripcion from public.productos where activo and en_carta;
  revoke all on public.carta_publica from anon, authenticated;
  grant select on public.carta_publica to anon, authenticated;
  ```
  Es SECURITY DEFINER a propósito (misma decisión deliberada que las policies
  anon de SELECT en `menus`). Tras aplicar: `en_carta=true` a todo menos el
  Juguito; correr `get_advisors` security.

## Lo que falta — plan para la sesión fría

**A. Rediseño (brief de Yonatan, 6-sep).** "Mejorar increíblemente" con
lenguaje shadcn: superficies neutras, UN acento, cards/badges/tabs/sheet,
iconos Lucide por categoría, animaciones tipo transitions.dev (reveal
escalonado al cargar, sheet que sube). Referencias: paceui.com/components,
transitions.dev, shadcnstudio.com/templates/admin-dashboard. Stack: el del
POS (Tailwind CDN + Alpine + Lucide) para que reemplace a `carta.html` sin
cambiar de mundo. Datos desde `carta_publica` con fallback a la FOTO.
Sugerencia de plan: tokens = los del POS; `ember` solo en la acción principal
y el tab activo; `amber` en precios; Fraunces solo en el nombre y títulos;
firma = el monograma dorado como sello sobre `parch`, no sobre negro.

**B. Peldaño 2 — ver la cuenta al tocar.** Diseño acordado con Yonatan:
1. Pegatina por mesa con `?m=<mesa>&k=<token>`; token aleatorio ≥32 chars en
   columna nueva `mesas.token text unique` (migración → aparca / clasificador).
2. Edge Function `cuenta` (copiar patrón de `votar`): `GET` valida (m,k) y
   devuelve SOLO la orden `abierta` de esa mesa: items, total, abierta_en.
   Service-role; rate-limit; nunca anon contra tablas. Deploy = aparca.
3. UI: sheet "Mi cuenta" en la carta; sin `k` en la URL el control no existe.
   En el artifact no hay fetch (CSP): probar en resplandor.ynt.codes.
4. Fuga conocida y aceptada a ojos abiertos: quien guardó el link ve la
   cuenta del siguiente ocupante mientras esté abierta. Acotar: responder solo
   con orden abierta; el mesero puede rotar el token desde el POS.
Peldaño 3 (pedir → `pedidos_pendientes` que el mesero acepta) NO arrancado.

**C. Lo que aparca para Yonatan** (LINEA_ROJA lista 2 + clasificador):
aplicar las dos migraciones, desplegar la función, `git push` (GitHub Pages).

**D. Datos que faltan:** horario real de apertura (el "lunes a sábado" era el
del ejecutivo, se retiró); vectorial del monograma; número de WhatsApp.

**E. Deuda encontrada:** policies anon en `resplandor_bd.sql`; alinear
`landing.html`, `img/logo.png` y el brief a la marca real; `resplandor` no
está en `sigilo/scripts/constelacion.json` ni rutea por `/casa`.

## Bitácora
- 2026-09-06: tarea creada al cerrar por regla de corte (208k). Evidencia:
  artifact 4ec32917 (5 versiones), SELECT a `productos` (31 filas), foto del
  aviso y del monograma, README POS §05/§11, `votar/index.ts`. Borrador en
  `carta-nfc.html`. Migración `carta_publica` bloqueada por el clasificador,
  no aplicada. Nada desplegado, nada pusheado.
