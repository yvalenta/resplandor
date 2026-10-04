---
estado: hecha
dueño: ambos
fecha: 2026-10-04
tema: fallo intermitente bajo carga de «Agregar para llevar… (y la hoja de variantes también)» (pos-para-llevar.test.mjs, navegador 390 px): la prueba leía el aviso «+1 …» desde Node después de que se cerrara solo a los 2,2 s
criterio_cierre: la prueba sola en bucle con el renderer frenado (CDP ×200 desde que se enciende el interruptor hasta que se abre la hoja de variantes, la forma de reproducir el fallo a voluntad) ≥ 30 corridas válidas, 0 fallos, cuando la prueba vieja en las mismas condiciones cae en el aviso; pos-para-llevar.test.mjs y pos-ola-c-navegador.test.mjs completos en verde; el commit en main con CI verde lo confirma Yonatan al publicar
---

Visto el 2026-10-04 con 16 procesos quemando CPU, corriendo `TZ=UTC node --test scripts/pruebas/pos-para-llevar.test.mjs`:
`not ok 49 - navegador (390 px): «Agregar para llevar» es un switch junto al buscador; encendido, lo que se toca entra como línea aparte
marcada (y la hoja de variantes también)`, `The input did not match the regular expression /Limonada de coco · para llevar/. Input: ''`.
Sin carga pasaba siempre.

- **Causa (la prueba, no el POS):** el toque deja «+1 Limonada de coco · para llevar» (`store.agregadoReciente`, `_anotarAgregado` en
  `pos.html`), que se cierra solo con un `setTimeout` de `VENTANA_AGREGADO_MS` = 2200 ms. La prueba tocaba, esperaba `.nota-llevar:visible`
  y recién entonces leía `page.locator('.agregado-aviso').innerText()`. Con el renderer sin CPU, esas idas y vueltas pasan de 2,2 s: el
  nodo ya no está, `innerText()` espera sus 60 s y el `.catch(() => '')` devuelve `''`. El reloj fijo del arnés (`page.clock.setFixedTime`)
  fija `Date.now()` pero deja correr los temporizadores, así que el cierre llega a su hora de pared.
- **Arreglo:** `anotarAvisos(page)`, instalado antes del toque, anota EN LA PÁGINA cada texto que muestra `.agregado-aviso` en el momento
  en que cambia (un MutationObserver sobre `.avisos-pulgar`, con los cambios de `style` para ver lo que x-show termina de ocultar), y la
  prueba aserta con la misma expresión sobre el último texto que se vio (`ultimoAviso`). El MutationObserver corre en la misma tarea del
  toque, antes de cualquier lectura desde Node: no depende de cuánto tarde la máquina. Sin aflojar el assert, sin tocar `pos.html` ni la
  duración del aviso.
- **Por qué no `waitFor` del aviso ni leer el store tras el clic** (lo que proponía el pedido): acortan la ventana pero no la cierran:
  con el renderer a ×100, entre que vuelve `click()` y la primera mirada ya pasaban hasta 2268 ms, del orden de lo que vive el aviso con
  ese freno (2,7–4,0 s). **Por qué no `page.clock.pauseAt`** en
  esta prueba: congela también `requestAnimationFrame`, con el que x-show muestra y oculta lo ya montado, y el aviso se lee con
  «· van 1» a la vista, algo que el mesero nunca ve.
- **La otra prueba con la misma carrera:** `pos-ola-c-navegador.test.mjs` (`navegador: cobrar por unidades y deshacer…; el toque en un
  producto deja «+1» que se acumula`) leía `agregadoTexto` del store después de cada toque, y el «+2» pide además que el segundo toque
  llegue con el primer aviso abierto. Ahí sí va `page.clock.pauseAt(new Date(FECHA_FIJA))` antes de los toques y `resume()` después:
  `pauseAt` a la hora ya fija no adelanta nada (no toca `isFixedTime` del reloj de Playwright), solo detiene los temporizadores de la
  página, y dentro de la pausa solo se lee el store.
- **Las que no la tienen:** `pos-ola-c3-navegador.test.mjs` (~678) y la vista `orden-agregado` de `_pos-simulado.mjs` (~1410) ponen
  `agregadoReciente` directo en el store, sin pasar por `_anotarAgregado`: no hay temporizador que lo cierre. Las demás menciones del
  aviso son estáticas (`pos-ola-c3.test.mjs`, `integracion-correcciones.test.mjs`) o en el `vm` con reloj falso (`pos-ola-c.test.mjs`,
  `pos-para-llevar.test.mjs` parte B).

## Cómo se reprodujo (y lo que no lo reproduce)

Los procesos `node -e 'for(;;){}'` solos **no** lo reproducen en este Mac (12 núcleos): con 16 o 48 quemadores (16 también a la misma
prioridad que la prueba), la lectura llegaba 3–10 ms después del toque y el archivo completo pasaba (57/57). macOS castiga a los procesos que no
duermen y deja pasar a Chromium. Lo que tumba la prueba es un renderer sin CPU, que es lo que pasa con varias suites de Chromium a la
vez (así cayó la primera corrida de esta sesión, con load ~440 por las suites de otras sesiones). Para pedirlo a voluntad, una
precarga de Node (fuera del repo) parchea el `chromium` de Playwright y le aplica `Emulation.setCPUThrottlingRate` a la página.

## Bitácora
- 2026-10-04: medido en el worktree `claude/relaxed-bouman-dca0b7` desde `origin/main` `f32577d` (macOS 12 núcleos, Node 22.18.0,
  TZ=UTC, Playwright 1.63, chrome-headless-shell 1243), con otras sesiones corriendo suites a la vez (load 50–870):
  - Primera corrida de la prueba sola, sin quemadores míos y load ~330–440 por las suites de otras sesiones: cayó igual que el reporte
    (`Input: ''`, 3 min: 60 s de innerText esperando un aviso que ya no estaba).
  - Quemadores solos: sonda de la misma secuencia (mide en la página el tiempo del aviso a la lectura) con 16 y 48 `node -e` (nice 5 por
    `BG_NICE` de zsh) y 16 a nice 0: lectura máx. 6–10 ms; la prueba sola 5/5 y el archivo entero 57/57 con 48 quemadores. Con 4 bucles
    del archivo como ruido de navegador, máx. 39 ms; con 12, la máquina se ahogó (vueltas de 530 s que terminan saltadas).
  - Renderer frenado con CDP (`Emulation.setCPUThrottlingRate`, desde la vista de la orden): lectura máx. 17 ms ×4, 223 ×10, 585 ×20,
    1743 ×50; a ×100, 2 de 4 vueltas leen con el aviso ya cerrado (lectura 1,8–4,1 s, vida del aviso 2,7–4,0 s; entre que vuelve
    `click()` y la primera mirada, hasta 2268 ms).
  - Prueba negativa determinista (la secuencia con 3 s forzados entre el toque y la lectura): la lectura de hoy ve `''` 5/5; con
    `page.clock.pauseAt` 5/5 ven el aviso (pero con «· van 1» a la vista); con `anotarAvisos` 5/5 lo ven, ya asentado.
  - La prueba en bucle, freno ×300 desde que se enciende el interruptor y hasta el final: vieja 7 fallos / 9 válidas (todas el aviso, `Input:
    ''`), 1 saltada. Ese freno rompe también otros pasos: el control (la prueba vieja SIN la aserción del aviso) falló 2 de 3 por `click`
    de 60 s esperando «estable»; por eso la medición buena frena solo la ventana del aviso (del interruptor a la hoja de variantes).
  - Freno ×200 del interruptor a la hoja (calibración): vieja 3 fallos / 6 (el aviso); control 6/6 en verde.
  - Freno ×200 del interruptor a la hoja + 16 quemadores + la carga de otras sesiones, los dos bucles a la vez: vieja 5 fallos / 13 válidas
    (todos el aviso), 1 saltada; arreglada 14 en verde / 18 válidas, 0 en el aviso, 4 por `The AudioContext encountered an error from the
    audio device or the WebAudio renderer` en `diag.errores` (todas con load ≥ 458; todas las vueltas con load < 440 pasaron) y 1 saltada.
    Ese error lo escribe Chromium cuando falla el dispositivo de audio real (el primer toque crea el AudioContext del pitido,
    `_desbloquearAudio`): es otra inestabilidad bajo carga, ajena a esta carrera, que no se tapa filtrando `diag.errores`; quedó como
    tarea aparte.
  - `pos-ola-c-navegador`, prueba vieja con freno ×200 desde el primer «+1»: cae `'' !== '+1 Limonada de coco'` (2 de las 3 primeras
    vueltas).
  - La sesión se cortó (reinicio de la máquina, que borra `/private/tmp`: se perdieron la precarga, los bucles y sus registros; las
    cifras de arriba son las que se leyeron antes del corte).
- 2026-10-04 (tras el reinicio, mismas herramientas rehechas): 16 quemadores a prioridad normal encendidos todo el rato, freno ×200
  (para llevar: del interruptor a la hoja; ola C: desde el primer «+1»), los cuatro bucles a la vez, load 19–589:
  - «Agregar para llevar» 390 px: vieja 4 fallos / 10 (los 4 el aviso, `Input: ''`); **arreglada 32 / 32 en verde, 0 fallos, 0 saltos**
    (prueba de 18,6 a 51,7 s, mediana 30,4 s).
  - `pos-ola-c-navegador` («+1» → «+2»): vieja 8 fallos / 8, todos `'+1 Limonada de coco' !== '+2 Limonada de coco'` (el primer aviso se
    cierra entre los dos toques y el segundo empieza de cero); **arreglada 20 / 20 en verde**.
  - Sola y sin freno, la vieja de «para llevar» pasa 4/4 con la máquina recién arrancada (load ~10): el freno solo no basta, hace falta
    además otra prueba frenada a la vez; por eso los bucles corren juntos.
- 2026-10-04: archivos completos, sin freno, con los 16 quemadores: `pos-ola-c-navegador.test.mjs` 5/5 dos veces. `pos-para-llevar.test.mjs`
  sobre este árbol: 57/57, 57/57 y una con 55/57 por las dos pruebas de reintento de la parte B (`:902` `2 !== 1` y `'Para llevar' !== ''`),
  que es la carrera que arregla `c1506d2` (rama `tarea/llevar-reintento-carrera`, de otra sesión, sin publicar). Con este arreglo aplicado
  sobre `c1506d2` (aplica limpio: él toca la parte B, este la C): 10 corridas, 8 en 57/57 y 2 con un fallo cada una en OTRAS pruebas con
  esperas fijas: «una marca sobre una línea que aún no existe…» (parte B, `dormir(150)`) y «navegador (1280 px): «Todo para llevar»…»
  (`reposo(200)` antes de contar `.llevar-banner:visible`, que x-show oculta en el cuadro siguiente). Ninguna lee el aviso; quedan como
  tarea aparte, igual que el `AudioContext`. Commit sin push: lo publica Yonatan.
