// El audio del Chromium de las pruebas (2026-10-04). El POS crea un AudioContext al primer toque (_desbloquearAudio) y pita con
// WebAudio (_pitar). Con el Chromium de Playwright tal cual, eso pide al servicio de audio (un proceso aparte) la autorización del
// dispositivo de audio REAL del Mac y abre un stream en él; con la máquina ahogada (load 450–870, varias suites de Chromium a la
// vez) algo de eso falló en 2 de ~10 corridas de pos-para-llevar.test.mjs y la página recibió por console.error «The AudioContext
// encountered an error from the audio device or the WebAudio renderer», que prepararPagina (_pos-simulado.mjs) cuenta en
// diag.errores — y debe seguir contando: es un error de la página, no del arnés. Dos caminos llevan a ese mensaje y el arreglo
// tiene dos capas:
//   · el stream del dispositivo falla o no se crea → `--disable-audio-output` (ARGS_CHROMIUM, _navegador.mjs): Chromium usa una
//     salida FALSA (AudioParameters::AUDIO_FAKE) y nunca toca el dispositivo; el WebAudio de la página corre igual;
//   · la autorización del dispositivo tarda más de 10 s (el renderer la pide al servicio de audio aun con la salida falsa; blink
//     audio_device_factory.cc) → el arnés del POS da por defecto un AudioContext de mentira (prepararPagina, `audioFalso`), con la
//     misma API que el POS usa y sin ningún dispositivo ni servicio detrás; cuenta en window.__posAudio.
// Lo que se vigila acá:
//   1. (siempre)  chromiumDeLaCasa suma ARGS_CHROMIUM a launch() y launchPersistentContext() y conserva los args del que llama.
//   2. (Chromium) el arnés por defecto: el recorrido que falló (la orden a 390 px, el toque en el switch, el pitido) crea UN contexto
//                 de mentira y dos osciladores por pitido, y diag.errores queda vacío.
//   3. (Chromium) `audioFalso: false` con el Chromium de la casa: el WebAudio real sobre la salida falsa — el contexto corre,
//                 currentTime avanza, sin errores. (Es la única prueba que ejercita el WebAudio real del POS: un AudioContext
//                 nativo llamado a través del Proxy de Alpine lanza «Illegal invocation», y una clase de mentira no lo haría.)
//   4. (Chromium) la prueba negativa: con --fail-audio-stream-creation el servicio de audio no crea el stream (lo que hizo el
//                 dispositivo bajo carga) y, con el WebAudio real, diag.errores trae ese mismo mensaje → ni la salida falsa ni el
//                 arnés filtran nada: un error de audio de verdad sigue a la vista. El flag gana aun con --disable-audio-output
//                 (el fallo se decide antes que el formato, media/audio/audio_manager_base.cc), así que pasa por el mismo ayudante.
//   5. (Chromium) ese mismo Chromium roto, con el arnés por defecto: el pitido se cuenta y diag.errores queda vacío — la clase de
//                 mentira no depende de ningún dispositivo.
// Las pruebas que MIDEN el pitido (pos-roles-alertas-cobros.test.mjs) corren el store en un `vm` con su propio AudioContext de
// mentira: no pasan por Chromium y nada de esto las toca.
// Se salta, con el motivo, si no hay Playwright con Chromium (ver _navegador.mjs).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { ARGS_CHROMIUM, buscarPlaywright, chromiumDeLaCasa } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { RAIZ } from './_pos-vm.mjs';

const MENSAJE = 'The AudioContext encountered an error from the audio device or the WebAudio renderer.';

test('chromiumDeLaCasa: cada launch() lleva --disable-audio-output delante y conserva los args y las opciones del que llama', async () => {
  assert.deepEqual(ARGS_CHROMIUM, ['--disable-audio-output']);
  const llamadas = [];
  const falso = {
    launch: async (o) => { llamadas.push(['launch', o]); return 'navegador'; },
    launchPersistentContext: async (dir, o) => { llamadas.push(['persistente', dir, o]); return 'contexto'; },
    name: () => 'chromium',
    executablePath: () => '/un/chromium',
  };
  const c = chromiumDeLaCasa(falso);
  assert.equal(await c.launch(), 'navegador');
  assert.equal(await c.launch({ headless: false, args: ['--lang=es-CO'] }), 'navegador');
  assert.equal(await c.launchPersistentContext('/perfil', { args: ['--otro'] }), 'contexto');
  assert.deepEqual(llamadas, [
    ['launch', { args: ['--disable-audio-output'] }],
    ['launch', { headless: false, args: ['--disable-audio-output', '--lang=es-CO'] }],
    ['persistente', '/perfil', { args: ['--disable-audio-output', '--otro'] }],
  ]);
  assert.equal(c.name(), 'chromium');
  assert.equal(c.executablePath(), '/un/chromium');
});

// ───────────────────────────── en Chromium ─────────────────────────────

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivo = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidor = await servirPos(RAIZ, 0);
  } catch (e) {
    motivo = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await servidor.cerrar();
});
const saltar = { skip: navegador ? false : `navegador no disponible: ${motivo}` };

/**
 * El recorrido de la prueba que falló bajo carga: la orden a 390 px, el toque en el switch (pointerdown → _desbloquearAudio) y el
 * pitido. Devuelve lo medido dentro de la página: el contador del arnés (window.__posAudio, solo con audioFalso) y un AudioContext
 * propio de la prueba, del mismo documento y la misma salida, porque el del POS vive fuera del store (audioAlertas) y no se alcanza.
 */
async function tocarYPitar(nav, { audioFalso = true } = {}) {
  const ctx = await nuevoContexto(nav, { ancho: 390, alto: 844, movil: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const { diag } = await abrirPos(page, { url: servidor.url, vista: 'orden', bloquearFuentes: true, audioFalso });
  const antes = await page.evaluate(() => (window.__posAudio ? { ...window.__posAudio } : null));
  await page.getByRole('switch', { name: 'Agregar para llevar' }).click();
  const medido = await page.evaluate(async () => {
    const pos = Alpine.store('pos');
    const sono = pos._pitar();
    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    await new Promise((r) => setTimeout(r, 600));
    return { sonidoListo: pos.sonidoListo, sono, estado: ctx.state, avanzo: ctx.currentTime - t0, esFalso: ctx.constructor.name === 'AudioContextFalso', cuenta: window.__posAudio ? { ...window.__posAudio } : null };
  });
  return { ctx, page, diag, antes, medido };
}

/** Espera hasta `ms` a que diag.errores tenga algo (el error del dispositivo llega después, por IPC). */
async function esperarErrores(page, diag, ms) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta && diag.errores.length === 0) await page.waitForTimeout(100);
}

/**
 * Arranca el servicio de audio de `nav` antes de medir con el WebAudio real: un AudioContext en una página vacía, hasta que corra.
 * La autorización del dispositivo vence a los 10 s (y bajo carga el servicio tarda en nacer); con el servicio ya despierto, la del
 * POS es un viaje corto. Lo que pase en esta página no se mide.
 */
async function despertarAudio(nav) {
  const ctx = await nav.newContext();
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(90000);
    await page.setContent('<button style="width:200px;height:200px">audio</button>');
    await page.getByRole('button').click();   // gesto: sin él el contexto nace suspendido
    await page.evaluate(() => new Promise((listo) => {
      const c = new AudioContext();
      const mirar = () => (c.state === 'running' ? listo() : setTimeout(mirar, 50));
      c.resume().catch(() => {});
      mirar();
    }));
  } finally {
    await ctx.close();
  }
}

test('arnés por defecto: el toque crea UN AudioContext de mentira, el pitido dos osciladores, ningún dispositivo y diag.errores vacío', saltar, async () => {
  const { ctx, page, diag, antes, medido } = await tocarYPitar(navegador);
  try {
    await esperarErrores(page, diag, 2000);
    assert.deepEqual(antes, { contextos: 1, osciladores: 0, reanudados: 0 }, 'llegar a la orden ya toca la pantalla (la mesa): un contexto, nada sonó');
    assert.equal(medido.sonidoListo, true, 'el POS dio por desbloqueado el sonido');
    assert.equal(medido.sono, true, '_pitar intentó sonar');
    assert.equal(medido.esFalso, true, 'window.AudioContext es la clase del arnés');
    assert.deepEqual(medido.cuenta, { contextos: 2, osciladores: 2, reanudados: 1 }, 'el del POS y el de la prueba; dos osciladores por pitido; el resume() de la prueba');
    assert.deepEqual(diag.errores, []);
  } finally {
    await ctx.close();
  }
});

test('audioFalso: false con el Chromium de la casa: el WebAudio real corre sobre la salida falsa (running, currentTime avanza) y diag.errores queda vacío', saltar, async () => {
  await despertarAudio(navegador);
  const { ctx, page, diag, antes, medido } = await tocarYPitar(navegador, { audioFalso: false });
  try {
    await esperarErrores(page, diag, 2000);   // si el dispositivo fuera a fallar, acá aparecería (ver la prueba negativa)
    assert.equal(antes, null, 'sin el contador del arnés: es el AudioContext de Chromium');
    assert.equal(medido.esFalso, false);
    assert.equal(medido.sonidoListo, true);
    assert.equal(medido.sono, true);
    assert.equal(medido.estado, 'running', 'la salida falsa corre: el contexto no se queda suspendido');
    assert.ok(medido.avanzo > 0.3, `currentTime avanzó ${medido.avanzo.toFixed(3)} s en 0,6 s: la salida falsa bombea el audio`);
    assert.deepEqual(diag.errores, []);
  } finally {
    await ctx.close();
  }
});

test('prueba negativa: si el servicio de audio no crea el stream (--fail-audio-stream-creation), el WebAudio real deja el mensaje en diag.errores — ni el flag ni el arnés filtran — y el arnés por defecto ni se entera', saltar, async () => {
  const roto = await pw.chromium.launch({ args: ['--fail-audio-stream-creation'] });
  try {
    {
      const { ctx, page, diag, medido } = await tocarYPitar(roto, { audioFalso: false });
      try {
        await esperarErrores(page, diag, 10000);
        assert.ok(diag.errores.length >= 1, 'el error del AudioContext tiene que llegar a diag.errores');
        assert.deepEqual([...new Set(diag.errores.map((e) => e.split(' (http')[0]))], [MENSAJE], `solo ese mensaje, el mismo de la corrida bajo carga; hubo: ${JSON.stringify(diag.errores)}`);
        assert.match(diag.errores[0], /\(http:\/\/127\.0\.0\.1:\d+\/pos\.html\)$/, 'anotado como error del propio origen (pos.html), no como externo');
        assert.equal(medido.sonidoListo, true, 'el POS no se entera: new AudioContext() no lanza, el fallo llega después por la consola');
        assert.equal(medido.estado, 'suspended', 'sin stream el contexto nunca arranca');
        assert.equal(medido.avanzo, 0);
      } finally {
        await ctx.close();
      }
    }
    {
      const { ctx, page, diag, medido } = await tocarYPitar(roto);   // el arnés por defecto, en el mismo Chromium roto
      try {
        await esperarErrores(page, diag, 3000);
        assert.deepEqual(medido.cuenta, { contextos: 2, osciladores: 2, reanudados: 1 });
        assert.equal(medido.estado, 'running');
        assert.deepEqual(diag.errores, [], 'la clase de mentira no depende de ningún dispositivo');
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await roto.close();
  }
});
