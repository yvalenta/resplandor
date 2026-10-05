---
estado: en-curso
dueño: yonatan
fecha: 2026-10-04
tema: integración de los dos arreglos de carreras en las pruebas de «Para llevar» (`tarea/llevar-reintento-carrera`, parte B, y `tarea/aviso-agregado-carga`, parte C y ola C) sobre `origin/main` db78f33, lista para publicar con avance rápido
criterio_cierre: `main` con los dos merges y el workflow `comprobar.yml` en verde en GitHub tras el push de Yonatan
---

Las dos ramas salen de f32577d y solo tocan pruebas y tareas; se mezclan sobre `origin/main` db78f33 (que ya trae el arreglo del audio
de Chromium en el arnés) en `tarea/integracion-carreras-llevar`, con `--no-ff` y en este orden: primero `tarea/llevar-reintento-carrera` (c1506d2: las pruebas de reintento esperan el evento real del
reintento, ver `tareas/2026-10-03-llevar-reintento-carrera.md`), después `tarea/aviso-agregado-carga` (f954fb9: el aviso «+1 …» se
lee cuando se muestra; ola C pausa los temporizadores de la página durante los dos toques, ver `tareas/2026-10-04-aviso-agregado-carga.md`).

Sin conflictos: en `pos-para-llevar.test.mjs` una rama toca la parte B y la otra la C, `pos-ola-c-navegador.test.mjs` solo lo toca la
segunda, y el arreglo del audio que ya está en main toca el arnés (`_navegador.mjs`, `_pos-simulado.mjs`) y su propia prueba. Ninguna toca páginas ni `assets/`, así que la versión del sitio no cambia (no hace falta `version.mjs`). Sin push: lo publica
Yonatan (`git push origin tarea/integracion-carreras-llevar:main`, avance rápido sobre db78f33). La reversa, `git revert -m 1` del
merge que sobre.

## Bitácora
- 2026-10-04: merges 314ed00 (`tarea/llevar-reintento-carrera`, c1506d2) y 9a6aaed (`tarea/aviso-agregado-carga`, f954fb9) sobre
  `origin/main` f32577d, en el worktree `claude/relaxed-bouman-dca0b7` (macOS, Node 22.18.0, TZ=UTC). Comprobado:
  - Lo mezclado es exactamente cada rama: las líneas de `git diff f32577d..f954fb9` reaparecen iguales en `git diff c1506d2..HEAD`
    (los dos archivos de prueba) y las de `f32577d..c1506d2` en `f954fb9..HEAD`.
  - `css`, `iconos`, `descubrimiento` y `version` con `--comprobar`: los cuatro salen 0.
  - Suite como el workflow, `TZ=UTC node --test --test-concurrency=2 scripts/pruebas/*.test.mjs`, con otras sesiones corriendo suites
    (load hasta ~600): 2413 tests, 2403 pass, 6 fail, 4 skipped (2509 s). Pasaron las cinco de las dos ramas (el aviso a 390 y 1280 px,
    el «+1» de ola C y las dos de reintento). Las 6 fallas son timeouts en tres archivos que ninguna rama toca: 3 en
    `impresion-punta-a-punta.test.mjs` (15–20 s esperando la tarjeta de la impresora y el sondeo) y 3 en la «Recargar» con la red cortada
    o lenta (`version-recargar-navegador.test.mjs` 2, `version-recargar-muy-lenta-navegador.test.mjs` 1; `waitForNavigation` de 20 y 90 s).
  - Esos archivos solos: `impresion-punta-a-punta` 10/10 y `version-recargar-muy-lenta-navegador` 2/2; `version-recargar-navegador`
    cayó 3/4 con load 469 y, corrido a la vez sobre `origin/main` y sobre esta rama, dos vueltas: 4/4 y 4/4 en los dos (load 176–283).
    Son de carga, no de la mezcla.
  - Sin push: lo publica Yonatan.
- 2026-10-04: mientras tanto `origin/main` pasó a db78f33 (entró el arreglo del audio de Chromium, `claude/vigorous-khayyam-d8d786`), y la
  rama dejó de ser avance rápido. Se rehízo sobre db78f33 con los mismos dos merges: 0514244 (reintento) y 2d10f67 (aviso), que
  reemplazan a 314ed00 y 9a6aaed (sin publicar; quedan en el reflog). Sin conflictos: el arreglo del audio toca el arnés
  (`_navegador.mjs`, `_pos-simulado.mjs`) y su prueba, no los archivos de estas ramas. Comprobado sobre esta base:
  - Lo mezclado es exactamente cada rama (mismas líneas que `f32577d..c1506d2` y `f32577d..f954fb9`).
  - Los cuatro `--comprobar` salen 0.
  - Con load 45–80: `navegador-audio.test.mjs` 4/4, `pos-ola-c-navegador.test.mjs` 5/5 y `pos-para-llevar.test.mjs` 57/57 tres veces.
  - La suite completa se cortó a mano en 855 / 2413 tras 80 min con load 500–815 por otras sesiones: 4 archivos con fallas que ninguna
    rama toca, todas esperas vencidas o el Postgres desechable de Docker rechazando conexiones (`carta-para-llevar` 1 en navegador,
    `impresion-punta-a-punta` 3, `integracion-pago-breb` 6, `migracion-cola-impresion` y `migracion-cuenta-en-vivo`). No es señal: con
    esa carga ni Docker atiende. La suite entera en verde la da el CI de `comprobar.yml` al publicar (criterio de cierre).
