---
estado: en curso
dueño: ambos
fecha: 2026-09-30
tema: la pegatina NFC de cada mesa muestra la cuenta en tiempo real (solo lectura) y permite liquidar la mesa pagando por Bre-B o a una cuenta Bancolombia; el POS se entera y el mesero confirma
criterio_cierre: SDD aprobado por Yonatan (docs/sdd-cuenta-en-mesa.md); implementado por fases con sus pruebas; al aire con el GO de Yonatan y probado con una pegatina real
---

Pedido de Yonatan del 2026-09-30 (sesión `f7613393`). Cada pegatina vive en su mesa. Cuando el mesero agrega cosas,
la pegatina lo refleja en tiempo real, solo para ver, sin permiso de editar. La pegatina permite liquidar la mesa y
tiene enlaces a las formas de pago: Bre-B y cuenta Bancolombia. Pidió armar un SDD bien definido y lanzar agentes en
paralelo para empezarlo.

- **Base que ya existe:**
  - la migración `20260906120000` (`mesas.token`, vista `carta_publica`);
  - la Edge Function `cuenta` (GET `?m&k`, desplegada en `lccgehvyymladqvumcez`);
  - «Mi cuenta» en `carta.html`, con sondeo de 20 s;
  - la rotación del token desde el POS.
  - Decisiones previas en `tareas/2026-09-06-carta-nfc-y-cuenta.md`.
- **Rama `tarea/cuenta-en-mesa`:** worktree `~/Developer/worktrees/resplandor--cuenta-en-mesa`, desde `origin/main` (`3bae016`).
- **Convive con `tarea/pos-visual`,** que rediseña `pos.html` en paralelo. Los cambios de esta tarea en `pos.html` se coordinan con esa rama.

## Bitácora
- 2026-09-30: abierta. Workflow de investigación (Bre-B, Bancolombia, tiempo real en Supabase, estado actual) → SDD → refutación.
- 2026-09-30: Yonatan probó «Mi cuenta» en producción (Mesa 1, una orden abierta). La vista sondea cada 20 s solo mientras la hoja está abierta, y tiene un botón «Actualizar».
  - Pidió: «al ser una SPA debería ser interactivo y en tiempo real multidispositivo y no tener que dar actualizar».
  - **REQUISITO DURO del SDD:**
    - los cambios del POS llegan solos y al instante (push, sin botón);
    - varios celulares de la misma mesa ven lo mismo al mismo tiempo;
    - el cierre de la cuenta y la rotación del token se reflejan en vivo;
    - si se cae el canal, hay un respaldo silencioso por sondeo, con aviso de «sin conexión».
- 2026-09-30: **fase 1 integrada** en `tarea/cuenta-en-mesa` (sin push, sin migrar, sin desplegar: eso es de Yonatan).
  - **Qué entró:** 1A `62f1cfa`, 1B `2f5aac2`, 1C `f1e0b0f` y 1D `a8d7d83`, sin conflictos; `origin/main` (`fac8c62`, trae «fuera la propina»); y `scripts/empaquetar-funcion.mjs` con su prueba (`2a5a15e`), porque el editor del dashboard no resuelve el `import "../_compartido/mesa.js"` de `cuenta` v2 y las funciones se despliegan desde ahí.
  - **Cinta (Node 22.18):** suite 674 (673 ok, 1 omitida: el SRI, que con `VERIFICAR_SRI=1` pasa) y los tres `--comprobar` en 0. Punta a punta local (Postgres 17 + `cuenta` real + carta real en Chromium a 390 y 320 px): 144 comprobaciones, 0 fallas; la hoja cambia sola en 0,43 s de mediana (p95 0,44 s), el canal mudo pasa a sondeo en ≤ 60 s, y 9 de 9 mutantes de la integración mueren.
  - **Falta para salir al aire (todo de Yonatan, con su GO y después de las 17:00):** 1) SQL `20261001120000_cuenta_en_vivo.sql` (y `20261001130000_presencia_privada.sql` si dice sí a D17); 2) pegar `cuenta` v2 en el dashboard (`node scripts/empaquetar-funcion.mjs cuenta | pbcopy`); 3) push; 4) pruebas S-1 a S-10 con una pegatina real. Pasos exactos y reversa en menos de 1 min: `PASOS-AL-AIRE.md` en el scratchpad de la sesión `f7613393` (`cuenta-fase1/integracion/`).
  - **Aviso:** `tarea/carta-escritorio-pagar` ya no mergea limpio con esta rama (conflictos en `carta.html` y `resplandor.css`, por la hoja nueva de 1C); con `origin/main` solo, sí.
