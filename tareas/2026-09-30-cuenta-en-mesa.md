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
