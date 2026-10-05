---
estado: hecha
dueño: ambos
fecha: 2026-10-03
tema: fallo intermitente de «un reintento cuando la base YA tiene la marca…» (pos-para-llevar.test.mjs): la prueba corría una carrera entre una espera fija y el reloj real del reintento
criterio_cierre: las pruebas de reintento en bucle bajo carga de CPU, ≥ 100 corridas, 0 fallos (la prueba vieja, en las mismas condiciones, sí falla); el archivo completo y la suite con --test-concurrency=2 en verde; el commit en main lo publica Yonatan
---

Visto una vez en una corrida concurrente (`TZ=UTC node --test --test-concurrency=2`, 8 archivos a la vez, máquina cargada) sobre
`64a09bd` (main): `not ok 238 - un reintento cuando la base YA tiene la marca (la subida sí llegó y solo se perdió la respuesta) no
manda nada más…` (`scripts/pruebas/pos-para-llevar.test.mjs:902`), `2 !== 1`: la tablet mandó una segunda `actualizar_nota_item`.
Sola pasaba 57/57 tres veces seguidas.

- **Causa (la prueba, no el POS):** la prueba hacía `alternarLlevar` con la primera subida condenada a fallar, `await asentar()` (12
  vueltas de `setImmediate`) y recién entonces ponía la marca en la base falsa («sí había llegado»), confiando en que el reloj REAL del
  reintento (`_esperaMarcasLlevar = () => 40` ms) no se hubiera disparado. No hay reloj falso: el arnés (`_pos-vm.mjs`) usa los
  temporizadores de Node. Con la CPU ocupada (una pausa de GC, el proceso desalojado) esas 12 vueltas tardan más de 40 ms: el reintento
  releía la línea ANTES de que la prueba la marcara, la veía sin la marca y la mandaba otra vez. Esa segunda subida es la correcta para
  lo que el reintento vio, y el assert también: lo que estaba mal era la espera fija. Las dos pruebas vecinas («el REINTENTO… no pisa la
  persona», «una cuenta ya cobrada en esta tablet…») tenían la misma carrera, con 40 y 30 ms.
- **Arreglo:** `relojDeReintento(t, ms)` cuenta cada vez que el POS llama a `_esperaMarcasLlevar` (justo al programar el reloj, tras
  una subida fallida) y las tres pruebas esperan ese evento con `hastaQue` antes de tocar la base «mientras tanto»; después esperan el
  efecto real del reintento (`!_hayCambiosSinGuardar()`, la fila cerrada en la base) en vez de `dormir(60)` / `dormir(200)`. Por qué ya
  no hay carrera: el sondeo de `hastaQue` (5 ms) vence antes que el reloj del reintento (30 o 40 ms), Node corre los temporizadores
  vencidos por orden de vencimiento y vacía las microtareas entre uno y otro, y lo que la prueba hace tras el `await` es síncrono.
  Ningún assert se aflojó; `pos.html` no cambia.
- **¿Dos subidas vivas a la vez en el POS?** Sí existe, pero no fue esta falla: el reloj del reintento y el reintento forzado por
  `online` o «Recargar» (`_vaciarMarcasLlevar`), o `online` mientras la primera subida aún no contesta, pueden correr juntos para la
  misma marca. Se probó un candado por marca (`p.enVuelo`) y una refutación de cuatro lentes lo tumbó: con una subida COLGADA (no
  lenta: wifi sin salida, supabase-js sin tope), `online` y «Recargar» se sumaban a la promesa muerta en vez de mandar una nueva, y
  `_vaciarMarcasLlevar` frenaba a las marcas de atrás. Sin candado, ese `online` sí la rescataba. Un candado correcto pide un tope por
  pedido (`abortSignal`, tocar los dos Supabase falsos) y ese tope es una decisión de contrato: quedó fuera de este cambio, como tarea
  aparte para que Yonatan decida.
- **Visto de paso, fuera de este cambio:** bajo la misma carga, la prueba de navegador «Agregar para llevar… (390 px)» leyó tarde el
  aviso «+1 Limonada de coco · para llevar» (se cierra solo a los 2,2 s) y falló con `''`; sin carga pasa. Quedó como tarea aparte.

## Bitácora
- 2026-10-03: reproducido en el worktree `claude/upbeat-diffie-30622c` sobre `64a09bd` (macOS, Node 22.18.0, TZ=UTC, 16 procesos
  quemando CPU como carga): las tres pruebas del patrón `reintento|ya cobrada en esta tablet` en bucle, 5 fallos / 100 corridas, los
  cinco el assert de `:902`, `2 !== 1`. Sonda del mecanismo (la misma secuencia en proceso; cuenta si el reintento relee la base antes de
  que la prueba la toque): sin carga 0/200; con 16 procesos 0/200; con 32 procesos 14/500, cada uno con su segunda subida (las 12 vueltas
  de `asentar()` llegaron a tardar 1424 ms); con una pausa ocupada tras el toque, 6/50 con 25 ms y 50/50 con 45 ms. Con la espera nueva:
  0/100 con una pausa de 60 ms en el peor sitio (dentro del sondeo que ve el reloj) y 0/300 con 16 procesos.
- 2026-10-04: refutación de cuatro lentes (workflow `wf_370583fa-26a`): las tres pruebas arregladas aguantaron pausas inyectadas en
  temporizadores y `setImmediate`, de hasta 1 s, sin fallar (40/40, 30/30, 15/15 corridas). El candado por marca que iba en el mismo
  cambio cayó (la subida colgada, arriba) y se retiró de este commit; quedó como tarea aparte, igual que el aviso «+1» de la prueba de
  navegador.
- 2026-10-04: rebasado sobre `origin/main` `f32577d` (27 commits nuevos; ninguno toca la prueba, el arnés ni las marcas). Medido sobre
  el árbol final, con 16 procesos quemando CPU y los dos bucles a la vez, patrón `REINTENTO|reintento|ya cobrada en esta tablet`
  (4 pruebas): la prueba vieja de `f32577d`, 1 fallo / 120 (la corrida 30, «el REINTENTO… no pisa la persona»: `'Para llevar' !== ''`,
  el reintento llegó durante la espera fija, la misma carrera del otro lado); la arreglada, 0 fallos / 120. El archivo completo sin carga
  artificial: 57/57 tres veces. La suite, `TZ=UTC node --test --test-concurrency=2 scripts/pruebas/*.test.mjs`, con la máquina cargada
  por otras sesiones (load average entre 240 y 450): 2413 tests, 2408 pass, 3 fail, 2 skipped (2734 s). Las tres fallas son de navegador
  en archivos que este cambio no toca (`integracion-correcciones.test.mjs:427`, `pos-ola-b2-navegador.test.mjs:118`,
  `pos-ola-c3-navegador.test.mjs:539`) y las tres pasan con esos archivos corridos solos (0 fail; 12 skipped por no poder abrir
  Chromium con load average ~700, ninguna de las tres). Las de reintento pasaron en la suite. Commit solo con la prueba y esta
  bitácora, sin push (lo publica Yonatan).
