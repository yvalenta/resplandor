---
estado: hecha
dueño: ambos
fecha: 2026-10-04
tema: fallo intermitente bajo carga en las pruebas de navegador («The AudioContext encountered an error from the audio device…» en diag.errores): el Chromium de las pruebas abría el dispositivo de audio real del Mac; ahora el arnés da un AudioContext de mentira y Chromium una salida falsa
criterio_cierre: el error forzado (--fail-audio-stream-creation) reproducido y vigilado por una prueba que también muestra que diag.errores sigue contándolo; el recorrido que falló, bajo carga de CPU y con varios Chromium a la vez, con 0 errores en ≥ 30 corridas con el arnés nuevo; pos-para-llevar.test.mjs bajo carga en verde; la suite completa en verde; el commit en main lo publica Yonatan
---

Visto el 2026-10-04 con la máquina en load average 450–870 (varias suites de Chromium a la vez más procesos quemando CPU), en
`scripts/pruebas/pos-para-llevar.test.mjs` («navegador (390 px): «Agregar para llevar» es un switch…»), 2 de ~10 corridas:
`assert.deepEqual(a.diag.errores, [])` recibía `['The AudioContext encountered an error from the audio device or the WebAudio
renderer. (http://127.0.0.1:<puerto>/pos.html)']`.

- **Origen (el audio del sistema, no la página ni el arnés).** El primer toque del POS crea un `AudioContext` (`_desbloquearAudio`,
  `pos.html` ~13429; el pitido `_pitar` ~13441). En el Chromium headless de Playwright ese contexto (1) pide al **servicio de
  audio** —un proceso aparte, `utility-sub-type=audio.mojom.AudioService`— la autorización del dispositivo por defecto, que en el
  Mac vence a los 10 s (`third_party/blink/renderer/modules/media/audio/audio_device_factory.cc`: «There are also cases when
  authorization takes too long on Mac»), y (2) abre un stream en el dispositivo de audio **real** (`AUHALStream`,
  `media/audio/apple/audio_auhal.cc`: si `AudioOutputUnitStart()` falla, `callback->OnError`). Cualquiera de los dos termina en
  `AudioOutputDevice::NotifyRenderCallbackOfError` → `OnRenderError` → ese `console.error` (`third_party/blink/renderer/modules/
  webaudio/audio_context.cc`), y `prepararPagina` (`scripts/pruebas/_pos-simulado.mjs`) lo cuenta, con razón, en `diag.errores`:
  es un error de la página. Afecta a cualquier prueba de navegador que toque la pantalla y luego exija `diag.errores` vacío.
  El `--mute-audio` que Playwright ya pone (`playwright-core/lib/coreBundle.js`) no alcanza: «mutes audio sent to the audio
  device» (`media/base/media_switches.cc`), o sea que lo sigue autorizando y abriendo.
- **Reproducción.** Natural: **no se logró**. Con 36 y luego 160 hilos quemando CPU más 6–8 sondas del recorrido en paralelo (y
  otras sesiones corriendo sus suites), el load llegó a **589** —dentro del rango del fallo— y el Chromium crudo dio 0 errores en
  62 corridas (ver bitácora). Determinista: Chromium trae `--fail-audio-stream-creation` («causes the AudioManager to fail
  creating audio streams», `media_switches.cc`; se decide en `AudioManagerBase::MakeAudioOutputStream` antes del formato, así que
  falla aun con salida falsa). Con ese flag, el mismo recorrido (la orden a 390 px, el toque en el switch, `_pitar()`) deja en
  `diag.errores` exactamente el mensaje de la corrida bajo carga (uno por intento de arrancar el contexto) y el contexto queda
  `suspended` con `currentTime` en 0. Chromium propaga ese flag y `--disable-audio-output` al proceso del servicio de audio
  (`content/browser/service_host/utility_process_host.cc`, «These flags are used by the audio service»).
- **Arreglo, en dos capas, sin filtrar ni aflojar `diag.errores`.**
  1. `scripts/pruebas/_pos-simulado.mjs`, `prepararPagina`: por defecto (`audioFalso: true`) `window.AudioContext` y
     `webkitAudioContext` son una clase de mentira con la misma API que usa el POS (`state`, `resume`, `currentTime`,
     `destination`, `createOscillator`, `createGain` con `setValueAtTime` / `exponentialRampToValueAtTime`), sin dispositivo ni
     servicio detrás, que cuenta en `window.__posAudio { contextos, osciladores, reanudados }` (2 osciladores por pitido). Es la
     misma idea que el `vm` de `pos-roles-alertas-cobros.test.mjs`. Ninguna de las dos fallas puede ocurrir porque Chromium no
     pide nada. `abrirPos` lo pasa; `audioFalso: false` da el WebAudio real.
  2. `scripts/pruebas/_navegador.mjs`: `buscarPlaywright` devuelve el `chromium` envuelto por `chromiumDeLaCasa`, que suma
     `ARGS_CHROMIUM = ['--disable-audio-output']` delante de los args de cada `launch()` / `launchPersistentContext()`: el servicio
     de audio fuerza `AudioParameters::AUDIO_FAKE` (`AudioManagerBase::MakeAudioOutputStreamProxy`) y nunca abre el dispositivo;
     `FakeAudioOutputStream` bombea con un reloj y el WebAudio real corre igual (contexto `running`, `currentTime` avanza 0,619 s
     en 0,6 s, lo mismo que con el dispositivo real). Cubre lo que sí usa el WebAudio real: `navegador-audio.test.mjs` con
     `audioFalso: false` y cualquier página abierta sin el arnés. Los 39 `pw.chromium.launch()` (37 pruebas y las dos capturas)
     lo heredan sin tocarlos.
  Nada de `pos.html` cambia.
- **Lo que mide el pitido sigue midiendo lo mismo.** Las pruebas que cuentan osciladores («sonido: …» en
  `pos-roles-alertas-cobros.test.mjs`) corren el store en un `vm` (`_pos-vm.mjs`) con su propio `AudioContext` de mentira: no
  pasan por Chromium. Ninguna prueba de navegador medía el sonido (no hay `AudioContext`, `_pitar` ni `sonidoListo` en los
  `*-navegador*.test.mjs`; `pos-ola-b2-navegador` solo toca «Silenciar 10 min»). Lo que se pierde al poner la clase de mentira
  por defecto es que el WebAudio real del POS corra en algún navegador —un `AudioContext` nativo llamado a través del Proxy de
  Alpine lanza «Illegal invocation», y una clase de mentira no lo haría—; por eso `navegador-audio.test.mjs` lo ejercita una vez
  con `audioFalso: false` (despertando antes el servicio de audio en una página vacía, para no comer el timeout de autorización).
- **Vigilancia:** `scripts/pruebas/navegador-audio.test.mjs` — (1) `chromiumDeLaCasa` suma el flag y conserva los args del que
  llama; (2) el arnés por defecto: el recorrido que falló crea UN contexto de mentira, dos osciladores por pitido, `diag.errores`
  vacío; (3) `audioFalso: false`: WebAudio real sobre la salida falsa, `running`, avanza, sin errores; (4) la prueba negativa con
  `--fail-audio-stream-creation` y WebAudio real: `diag.errores` trae ese mensaje, anotado como error del propio origen — la
  salida falsa y el arnés no filtran nada; y en el mismo Chromium roto, el arnés por defecto pita y no ve ningún error.

## Bitácora
- 2026-10-04: hecho en el worktree `claude/vigorous-khayyam-d8d786` desde `origin/main` `f32577d`. Medido en macOS (12 núcleos),
  Node 22.18.0, Playwright 1.63.0 (`chromium_headless_shell-1243`), con otras sesiones corriendo suites de Chromium a la vez
  (load 28–90 antes de cargar nada).
  - Sonda del recorrido que falló (la orden a 390 px, el toque en el switch, `_pitar()`, 2 s de espera), un Chromium por
    variante, WebAudio real: sin flags → sin error, `running`, avanza 0,619 s; `--mute-audio` → igual (ya lo pone Playwright);
    `--fail-audio-stream-creation` → 3× «The AudioContext encountered an error from the audio device or the WebAudio renderer.
    (http://127.0.0.1:<puerto>/pos.html)», `suspended`, avanza 0; `--disable-audio-output` → sin error, `running`, avanza
    0,619 s; `--disable-audio-output --fail-audio-stream-creation` → el error (el fallo gana).
  - Intento de reproducción natural, pareado (los dos brazos a la vez, misma carga), Chromium crudo vs `--disable-audio-output`,
    WebAudio real: 36 hilos quemando CPU + 6 y 6 sondas en paralelo, 5 rondas, load 61–74: 0/30 y 0/30. 160 hilos + 8 y 8 sondas,
    4 rondas, load 204 → 340 → 463 → **589** (cada sonda tardó 17–73 s): 0/32 y 0/32. El fallo natural no se reprodujo con carga
    de CPU sola; queda la reproducción forzada.
  - `navegador-audio.test.mjs`: 4/4. `pos-para-llevar.test.mjs`: 57/57. `pos-roles-alertas-cobros.test.mjs` (los que miden el
    pitido en el `vm`): 68/68. Con el arnés nuevo, también `pos-ola-b2-navegador` 9/9, `version-aviso-navegador` 35/35,
    `pos-impresion-defecto-navegador` 20/20.
  - Evidencia bajo carga con el arreglo (120 hilos quemando CPU, 8 sondas en paralelo y otras sesiones encima):
    `pos-para-llevar.test.mjs` entero ×3, load 49–155 al arrancar cada corrida: 57/57, 57/57, 57/57, sin ningún `AudioContext`
    en la salida; la sonda con el arnés por defecto, 3 rondas × 8, load 71–115: 0/24 con error.
  - Suite completa, primer intento (`node --test --test-concurrency=2 scripts/pruebas/*.test.mjs`), con otras sesiones llevando la
    máquina a load 268–387: a los 40 min (el tope del proceso en segundo plano) iba en 1426 ok y 1 not ok, y se detuvo antes de
    terminar. El not ok no es de audio: `pos-ola-b2-navegador.test.mjs:124`, el clic en el aviso flotante «Mesa 3 pidió la cuenta»
    venció a los 30 s porque el aviso se escondió solo antes de que el clic llegara (timeout de Playwright, nada en `diag.errores`);
    queda declarado aparte (chip «Arreglar la carrera del aviso flotante en pos-ola-b2-navegador»). Ningún «AudioContext» en toda la
    salida parcial.
  - Suite completa, segundo intento, mismo comando, load 177 al arrancar y 7 al terminar (las otras sesiones acabaron a mitad):
    **2417 tests, 2415 pass, 0 fail, 2 skipped**, 14 min 41 s; cero «AudioContext» en la salida. Commit en la rama
    `claude/vigorous-khayyam-d8d786` (`scripts/pruebas/_navegador.mjs`, `scripts/pruebas/_pos-simulado.mjs`,
    `scripts/pruebas/navegador-audio.test.mjs` y esta tarea), sin push: lo publica Yonatan.
- 2026-10-04: Yonatan decidió dejar las dos capas (el AudioContext de mentira por defecto en el arnés más `--disable-audio-output`), frente a la alternativa de solo el flag; el push a `main` lo hace él.
- 2026-10-04: Yonatan pidió también el push: la rama `claude/vigorous-khayyam-d8d786` queda en `origin` (CI `comprobar.yml` corre solo con el push); el merge a `main` —lo que GitHub Pages publica— sigue siendo suyo.
- 2026-10-04: Yonatan pidió también el merge a `main`; se integra con un merge sin fast-forward desde esta rama (sin tocar páginas ni assets: la versión del sitio no cambia, se comprueba con `node scripts/version.mjs --comprobar` antes de empujar).
