---
estado: en curso
dueño: sesión
fecha: 2026-09-30
tema: el POS (pos.html) toma el aspecto nuevo de la landing (https://resplandor.ynt.codes/), solo en lo visual, sin cambiar nada de su comportamiento
criterio_cierre: las vistas del POS (login, mesas, orden, ticket, cierre, productos, menú semanal y modales) siguen la identidad de la landing (docs/identidad-visual.md) en tablet ≥768 px y escritorio; las vistas tienen capturas antes y después; ningún binding de Alpine, id ni llamada a Supabase cambia de significado; el ticket impreso sigue legible; la suite entera y los tres --comprobar en verde; visto de Yonatan
---

Pedido de Yonatan del 2026-09-30 (sesión `f7613393`): «ahora el pos debe mejorarse visualmente de acuerdo al nuevo aspecto
de https://resplandor.ynt.codes/ lánzalo en worktrees y coordina».

- **Cambia una decisión escrita:** `docs/landing-y-agentes.md:154` decía «El POS (`pos.html`) conserva los suyos (su propia paleta y fuentes)». La doc se actualiza junto con el cambio.
- **Rama de integración:** `tarea/pos-visual`, worktree `~/Developer/worktrees/resplandor--pos-visual`, desde `1945b1b`.
- **Otra rama abierta sobre `pos.html`:** `tarea/supabase-propio`, sin commitear en el checkout principal. Cambia solo `SUPABASE_URL` y `SUPABASE_KEY` (líneas 1668-1669), así que el merge entre las dos es trivial.

## Bitácora
- 2026-09-30: abierta. Fase 1 (workflow): mapear la identidad de la landing y la estructura del POS, escribir la especificación e implementar la base de tokens y tipografía. Fase 2: secciones en paralelo, cada una en su worktree, integración, verificación y refutación.
