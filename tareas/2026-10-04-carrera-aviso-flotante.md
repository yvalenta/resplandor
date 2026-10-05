---
estado: en-curso
dueño: ambos
fecha: 2026-10-04
tema: carrera bajo carga en pos-ola-b2-navegador («aviso flotante y insignia»): el aviso de alertas se escondía solo (6 s) antes de que el clic de la prueba llegara; el arnés sube los avisos con temporizador con el reloj de la página congelado
criterio_cierre: la carrera reproducida (natural, bajo carga de CPU, y determinista con 6 s de espera antes del clic) y, con el arreglo, 0 fallos en las mismas condiciones; los dos mutantes de pos.html (el toque sin efecto; el cierre a los 600 ms) hacen fallar las pruebas; los tres archivos de pruebas tocados en verde; la suite completa en verde (la corre una sesión siguiente o Yonatan al integrar: esta sesión cerró por la regla de los 200k)
---

Visto el 2026-10-04 con la máquina en load average ~360 (otras sesiones corriendo suites de Chromium), en
`node --test --test-concurrency=2 scripts/pruebas/*.test.mjs`: `not ok 1291 - b2 (navegador): aviso flotante y insignia…`
(`scripts/pruebas/pos-ola-b2-navegador.test.mjs:124`, `await page.locator('.toast-alerta-cuerpo').click()`): Playwright encontró el
botón («element is visible, enabled and stable»), al ir a hacer clic ya no estaba («element is not visible», 28 reintentos, 30 s) y
venció. Nada en `diag.errores`. Con la máquina descargada, 9/9.

- **Causa (el arnés y la prueba, no la página).** El aviso flotante de alertas (`pos.html`, `.toast-alerta`, el `x-init` del
  componente) se esconde solo a los **6000 ms** (`t = setTimeout(() => visible = false, 6000)`), y el reloj del arnés
  (`prepararPagina` → `page.clock.setFixedTime`) fija la fecha pero **deja correr los temporizadores**. La vista `mesas-alertas`
  subía la alerta y esperaba el aviso; de ahí a que la prueba lo tocara pasaban `esperarEstable` (fuentes, íconos, 250 ms), tres
  asserts con ida y vuelta al navegador y el propio clic. Sin carga son 0,4–0,7 s; con la máquina cargada, cada ida y vuelta tarda
  segundos y el total pasó de 6 s. Es una carrera entre el temporizador de la página y la velocidad del arnés: la prueba medía
  «cuánto tarda la máquina», no «qué hace el POS».
- **Reproducción.** Natural: con un quemador acotado (160 hilos en bucle, 330 s) y 16 Chromium a la vez corriendo el recorrido
  viejo (load 449–686), **23 de 46** corridas fallaron con el mismo `locator.click: Timeout`; en varias el aviso ya estaba escondido
  antes del primer `innerText` (el texto leído era el de la franja fija, sin «· QR»). Con 60 hilos y 8 Chromium (load 79–96), 0 de
  32: hace falta contención de verdad en el renderer, no solo CPU ocupada. Determinista: el mismo recorrido con
  `page.waitForTimeout(6000)` antes del clic (sonda `viejo-espera`, en la bitácora).
- **Arreglo, sin aflojar ni filtrar nada** (`scripts/pruebas/_pos-simulado.mjs`): dos ayudantes exportados, `congelarReloj(page)`
  (`page.clock.pauseAt` en el instante del propio reloj ya fijo: no consume nada ni dispara nada; exige `relojFijo`, el valor por
  defecto, y lo comprueba) y `avanzarReloj(page, ms = 100)` (`page.clock.runFor`). Las cuatro vistas que suben un aviso con
  temporizador —`mesas-alertas` y `deshacer-mesas-alerta` (el aviso de alertas, 6 s), `aviso-cobro-deshecho` (9 s) y `aviso-aprobado`
  (12 s)— lo suben **con el reloj congelado** y avanzan 100 ms de reloj falso para que se pinte. Así el aviso se queda hasta que la
  prueba lo toque, tarde lo que tarde la máquina, y «el aviso se va» solo puede deberse al toque. Verificado en el bundle de
  Playwright 1.63 (`coreBundle.js`): `pauseAt` tras `setFixedTime` está permitido (el servidor instala el reloj una sola vez),
  `pauseAt(t)` consume `t − ahora` = 0 ms, y `runFor` con el reloj fijo mueve los temporizadores sin mover la fecha.
  - **Por qué 100 ms y no 0:** Alpine muestra con `x-show` dentro de un `requestAnimationFrame` (o `setTimeout`) y los íconos de los
    nodos nuevos los pinta el `MutationObserver` del final de `pos.html` con un `setTimeout` de 60 ms; el reloj falso de Playwright
    congela las dos cosas. Y Alpine también **esconde** con `x-show` en un rAF (oculta «después de los hijos»): tras el toque que
    cierra un aviso hay que avanzar el reloj antes de asertar que se fue; la primera corrida de la verificación lo enseñó (b2 «aviso
    flotante» y c3 «avisos del pulgar» en rojo con el aviso todavía a la vista tras el toque). Solo texto y atributos van por
    microtareas. Playwright no se congela: sus esperas y la comprobación de «quieto» antes del clic usan los temporizadores originales (`builtins`).
  - **El stub de Supabase** solo usa `setTimeout(…, 0)` al arrancar (sesión, `subscribe`, `track`), siempre antes de congelar.
- **Las pruebas hermanas con la misma carrera (punto 3 del pedido), revisadas una por una:**
  - `pos-ola-c3-navegador` «deshacer y alertas no se pisan»: la carrera **inversa**: esperaba 6,3 s de reloj real y asertaba que el
    aviso ya se había ido (un temporizador atrasado bajo carga la haría fallar). Ahora avanza el reloj a mano: a los 5,9 s el aviso
    sigue, a los 6,2 s se fue. Más estricta que antes (también mide que no se va ANTES).
  - `pos-ola-c3-navegador` «los avisos del pulgar»: clic sobre un aviso de 12 s y luego sobre uno de 9 s. La vista ya congela; tras el
    segundo `avisar` se avanza 100 ms para pintarlo.
  - `pos-impresion-caja-navegador` «el indicador de la barra…»: clic en «Configurar» de un aviso de 9 s (y las lecturas del mesero):
    `congelarReloj` antes de tocar la barra, `avanzarReloj` después.
  - Sin carrera: `deshacer-ticket` y los demás de `ultimoCobro` (lo pone el arnés sin armar el temporizador de 15 s, y la fecha está
    fija), `toast-impresion-fila` (sin cierre automático), las lecturas de `toast-aviso-txt` justo después de imprimir
    (`pos-impresion-caja-navegador:235`, una ida y vuelta de ventana de 9 s: se deja), `orden-alerta` (la franja fija no depende del
    temporizador). `version-aviso-*` tienen su propio reloj (`relojFijo: false` o `adelantar`), fuera de esto.
- **Lo que mide cada prueba sigue siendo lo mismo o más** (mutantes de `pos.html` servidos con `POS_HTML=…`, en la bitácora): el
  toque sin efecto (`@click="void 0"`) hace fallar «tocar el aviso abre la vista»; el cierre a los 600 ms hace fallar «a los 5,9 s
  el aviso sigue».
- **Lección para el arnés:** una vista que promete algo que se cierra solo es una carrera por construcción; si la prueba va a
  tocarlo, la vista lo sube con el reloj congelado y la prueba avanza el reloj cuando quiere medir el cierre. Quedó dicho en el
  comentario de `congelarReloj`.

## Bitácora
- 2026-10-04: worktree `claude/musing-allen-577e98` desde `main` `a976e91` (= `origin/main` `f32577d` + la bitácora de puntaje-ora).
  macOS (12 núcleos), Node 22.18.0, Playwright 1.63.0, con otras sesiones encima (load 28–330 antes de cargar nada).
  - Sonda del recorrido viejo (la vista `mesas` + la alerta + `esperarEstable` + los tres asserts + el clic), sin carga propia,
    load ~28: del aviso al clic 0,39–0,66 s, 0 fallos / 4.
  - Quemador de 60 hilos × 240 s + 8 sondas × 4: load 79–96, del aviso al clic mediana 0,50 s y máximo 2,0 s, **0 fallos / 32**.
  - Quemador de 160 hilos × 330 s + 16 sondas × 3: load 449–686, del aviso al clic mediana 8,8 s y máximo 18,0 s (`abrir` hasta
    15 s), **23 fallos / 46**, todos `locator.click: Timeout 8000ms exceeded`, `diag.errores` vacío en los 46. La carrera, reproducida.
  - Reproducción determinista (sonda `viejo-espera`: el recorrido viejo con `page.waitForTimeout(6000)` antes del clic), load ~63:
    **2 fallos / 2**, `locator.click: Timeout 8000ms exceeded`, 3 × «element is not visible» en cada una: la forma exacta del fallo
    de la suite.
  - Con el arreglo, la misma espera de 6 s antes del clic (sonda `nuevo-espera`, la vista `mesas-alertas` del arnés), load 103–134:
    **0 fallos / 3**: el aviso sigue ahí a los 6 s, el toque abre Alertas y el aviso se va (tras avanzar 100 ms de reloj falso).
  - Con el arreglo, bajo carga (quemador de 120 hilos × 240 s + 6 sondas × 2, load 96–117): **12 bien / 12**, del aviso al clic
    mediana 2,3 s y máximo 5,3 s (`abrir` hasta 8,3 s).
  - Mutantes de `pos.html` servidos con `POS_HTML=`: el toque sin efecto (`@click="void 0"`) → b2 «aviso flotante» **falla** en
    «tocar el aviso abre la vista» (`expected 'alertas', actual 'mesas'`); el cierre a los 600 ms (`setTimeout(…, 600)`) → c3 «no se
    pisan» **falla** en «a los 5,9 s el aviso sigue» (`expected true, actual false`). Las dos pruebas siguen midiendo la página.
  - Primera corrida de los tres archivos tocados: 35 ok, **2 not ok** (b2 «aviso flotante», c3 «avisos del pulgar»): el aviso seguía
    a la vista tras el toque, porque Alpine también esconde con `x-show` en un rAF y el reloj estaba congelado. Arreglo: `avanzarReloj`
    tras el toque, y el comentario del arnés corregido (no era «lo que se esconde va por microtareas»).
  - Segunda corrida de los tres archivos tocados (`pos-ola-b2-navegador`, `pos-ola-c3-navegador`, `pos-impresion-caja-navegador`,
    `--test-concurrency=3`), con la máquina en load 125–490 por otras sesiones: **38 tests, 37 pass, 0 fail, 1 skipped** (el salto de
    siempre), 16 min 17 s. Commit en la rama `claude/musing-allen-577e98`, sin push.
  - **Queda para una sesión siguiente o para Yonatan al integrar:** la suite completa (`node --test --test-concurrency=2
    scripts/pruebas/*.test.mjs`), que esta sesión no corrió por la regla de los 200k de contexto. Nada de `pos.html` cambia.
- 2026-10-04: suite completa (`node --test --test-concurrency=2 scripts/pruebas/*.test.mjs`) desde `ac48744`, en 2.º plano con tope de
  2 h, con otras sesiones encima (load 15 min hasta 322 al final): **2413 tests, 2386 pass, 7 fail, 7 cancelled, 13 skipped**, 100 min
  46 s, exit 1. **No quedó en verde, así que la tarea sigue `en-curso` y no hay push.** Los rojos, uno por uno, ninguno es el aviso
  flotante ni toca lo que cambió esta tarea:
  - `integracion-pago-breb` (Postgres real en Docker): 3 subpruebas con `locator.click` 30 s, `page.goto` 30 s y `waitForFunction` 8 s
    vencidos (una tardó 650 s); `integracion-punta-a-punta`: «Postgres no quedó listo en 90 s» en el hook, y sus 7 subpruebas son los 7
    `cancelled`. Docker y Chromium a la vez, bajo esa carga.
  - `pos-ola-b2-navegador` «cobro por monto»: `locator.innerText` 30 s vencido esperando `.bloque-monto .btn-telon`, y la prueba
    siguiente del archivo saltó con `page.goto: Timeout 30000ms` (la página ni cargó en 30 s). `pos-ola-c-navegador` ×3: `locator.click`
    30 s y `page.goto` 30 s ×2. Topes de Playwright con la máquina saturada, no asserts de la página.
  - Las cuatro pruebas de esta tarea pasaron dentro de esa misma suite: b2 «aviso flotante» (57 s), c3 «no se pisan» (3,1 s), c3
    «avisos del pulgar», caja «indicador de la barra». «AudioContext» aparece 2 veces, las dos en el NOMBRE de una prueba que pasó.
  - Queda: repetir la suite con la máquina descargada (o solo los dos archivos de integración con Docker y los dos de navegador que
    vencieron) antes de marcar `hecha` y hacer push; es el mismo síntoma de carga de siempre, con topes fijos de 30 s en `page.goto`.
- 2026-10-04: los cuatro archivos que vencieron, solos (`--test-concurrency=2`, tope de 90 min), con la máquina en load 90–250 por
  otras sesiones: **42 tests, 26 pass, 16 fail**, 48 min 16 s, exit 1. **Los dos de navegador quedaron en verde**:
  `pos-ola-b2-navegador` 9/9 (con el aviso flotante) y `pos-ola-c-navegador` 5/5. **Los dos de integración con Postgres en Docker, en
  rojo otra vez**, y peor que en la suite: `integracion-pago-breb` 12 ok / 9 subpruebas vencidas (una tardó 1204 s),
  `integracion-punta-a-punta` 0 / 7. Todos los errores son topes de Playwright —`page.waitForFunction` 30 s (×7) y 8 s (×3),
  `locator.click` y `locator.waitFor` 30 s— con Chromium y dos o tres Postgres de Docker a la vez sobre esa carga; ningún assert de la
  página. **No hay verde, así que sigue `en-curso` y sin push.** Lo que falta es correr `integracion-pago-breb` e
  `integracion-punta-a-punta` con la máquina descargada (sin otras suites encima); si pasan, con la suite completa de arriba y esta
  corrida, los 2413 quedan cubiertos y la tarea pasa a `hecha`.
