---
estado: hecha
dueño: ambos
fecha: 2026-10-03
tema: fallo intermitente en CI de «se une al tópico…» (impresora-cola.test.mjs): el arnés esperaba la vista del servidor falso y asertaba la del cliente
criterio_cierre: el test solo en bucle bajo carga de CPU, ≥ 200 corridas, 0 fallos (antes fallaba ~1 de cada 8); la suite completa en verde con --test-concurrency=2; el commit en main con CI verde lo confirma Yonatan al publicar
---

En CI (GitHub Actions, run 37149230236 del commit `ed050dd`, workflow `comprobar.yml`, paso «pruebas») falló una vez
`not ok 556 - se une al tópico con la clave publicable y oye el broadcast del trigger` (`scripts/pruebas/impresora-cola.test.mjs:167`):
`expected ['conectando','unido']` contra `actual ['conectando','detenido']`. En local pasaba siempre y en `152e5d7` CI había pasado;
ninguno de los tres archivos involucrados (`impresora/realtime.mjs`, el test, `scripts/pruebas/_impresora-simulada.mjs`) cambió
entre los dos commits: una carrera latente que la carga del runner destapó.

- **Causa (el arnés, no el agente):** el test esperaba `S.unidos() === 1`, que es la vista del servidor falso (marca `socket.unido`
  en el mismo tick en que escribe el `phx_reply`), y asertaba enseguida sobre `estados`, la vista del cliente (`CanalRealtime` oye
  ese reply en una vuelta posterior del event loop). Con la CPU ocupada, el timer de 10 ms de `esperarHasta()` se disparaba entre
  la escritura y la lectura y el assert veía `['conectando']`. El `'detenido'` lo agrega `t.after → canal.detener()` al terminar
  el test fallido (y deja `this.ws = null`, así que el reply que llega después se descarta); el reporter TAP serializa el array
  vivo, por eso `actual:` trae `'detenido'` mientras el mensaje del error, generado al lanzar, muestra solo `'conectando'`.
- **Arreglo:** esperar el evento real del cliente (`canal.estado === 'unido'`) y recién después asertar que el servidor también
  lo tiene por unido. Sin aflojar el assert, sin reintentos, sin tocar `impresora/realtime.mjs` ni su contrato (la señal es solo
  para despertarse; el sondeo de 5 s sigue siendo el respaldo). Las otras esperas sobre `S.unidos()` del archivo no asertan
  estado del cliente a continuación, o lo esperan explícitamente, y el orden TCP garantiza que la señal llega después del reply.
- **Lección para el arnés:** `S.unidos()` sirve para «el servidor aceptó el join», nunca como sustituto de «el cliente ya lo
  oyó». Quedó dicho en un comentario junto a la espera.

## Bitácora
- 2026-10-03: hecho en el worktree `claude/upbeat-diffie-30622c` desde `origin/main` `ed050dd`; commit `1ea45e0`
  (`scripts/pruebas/impresora-cola.test.mjs`), sin push (lo publica Yonatan). Medido en macOS, Node 22.18.0, TZ=UTC, con
  12 procesos quemando CPU como carga:
  - sonda en proceso (misma secuencia, sondeo de 10 ms sobre `S.unidos()`): sin carga 0/300 ven `['conectando']`; con carga 2/300.
  - el test solo en bucle con carga: antes 27 fallos / 200 corridas (todos el assert de `:167`, la misma forma que CI);
    después 0 fallos / 300.
  - `impresora-cola.test.mjs` entero, misma carga: 0 fallos / 50.
  - suite completa, `node --test --test-concurrency=2 scripts/pruebas/*.test.mjs`: 2129 tests, 2127 pass, 0 fail, 2 skipped (735 s).
