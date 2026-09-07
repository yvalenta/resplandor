# resplandor en la constelación

Declaración de este repo para el grafo de proyectos de la casa (lo lee
el observatorio interno de la casa, que documenta el formato). Repo público:
solo superficies públicas.

El repo git vive anidado (`~/Developer/resplandor/resplandor`); el barrido
solo mira un nivel, así que `~/Developer/resplandor/CONSTELACION.md` y
`~/Developer/resplandor/tareas` son symlinks a los de acá (2026-09-06).

| campo | valor |
|---|---|
| id | resplandor |
| clase | app |
| qué | el restaurante: POS táctil por mesa (uso diario), carta pública para las pegatinas NFC de cada mesa con su cuenta abierta, votación del menú semanal y landing |
| dónde | GitHub Pages (`resplandor.ynt.codes`); datos en Supabase; mac `~/Developer/resplandor/resplandor` (edición) |
| servicio | `—` (estático + Edge Functions de Supabase: `votar`, `cuenta`) |
| atiende | Yonatan (aplica migraciones, despliega funciones, pushea); sesiones de Claude a demanda |
| contexto | `README.md` · la tarea abierta en `tareas/` |
| visibilidad | público: `github:yvalenta/resplandor` |

## Aristas

| a | b | tipo | por | medición |
|---|---|---|---|---|
| resplandor | github | publica | Pages → `https://resplandor.ynt.codes/` (POS, carta, menú, landing) | `http https://resplandor.ynt.codes/ 200` |
| resplandor | supabase | consume | Postgres + Realtime + Auth Google para el POS; vista `carta_publica` y función `cuenta` para la carta NFC; función `votar` para el menú | `—` |
