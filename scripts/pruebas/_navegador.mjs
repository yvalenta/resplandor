// Chromium para las pruebas que miden en un navegador de verdad (desborde.test.mjs,
// insignia.test.mjs), sin exigirlo. Ni CI ni el repo traen Playwright (el sitio no tiene
// dependencias de runtime), así que se busca en node_modules, en $PLAYWRIGHT_DIR y en la caché
// de npx; si no está, cada prueba se salta con el motivo. Necesita Node ≥ 20.
//
// El `chromium` que devuelve buscarPlaywright suma ARGS_CHROMIUM a cada launch() (ver abajo):
// todas las pruebas y las capturas arrancan el mismo Chromium, sin que cada archivo lo recuerde.
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre
// como prueba, solo lo importan las que lo necesitan.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Flags con que la casa arranca Chromium (pruebas y capturas).
 *   --disable-audio-output  salida de audio FALSA: el servicio de audio de Chromium fuerza AudioParameters::AUDIO_FAKE
 *                           (media/audio/audio_manager_base.cc, MakeAudioOutputStreamProxy) y no abre el dispositivo del
 *                           sistema; el WebAudio de la página corre igual (el contexto queda `running`, currentTime avanza,
 *                           los osciladores suenan en el vacío). Sin esto, el primer toque del POS (_desbloquearAudio) abría
 *                           el dispositivo REAL del Mac y, con la máquina ahogada (load 450–870, varias suites de Chromium a
 *                           la vez), la página recibía «The AudioContext encountered an error from the audio device or the
 *                           WebAudio renderer» por console.error y prepararPagina (_pos-simulado.mjs) lo contaba, con razón,
 *                           en diag.errores (2026-10-04: 2 de ~10 corridas de pos-para-llevar.test.mjs). Ese mensaje es el que
 *                           Blink da cuando el stream del dispositivo falla o no se crea (--fail-audio-stream-creation lo fuerza).
 *                           El --mute-audio que Playwright ya pone no alcanza: silencia lo que se manda al dispositivo, pero
 *                           lo sigue abriendo. Lo que el flag NO quita: la autorización del dispositivo, que el renderer pide
 *                           al servicio de audio (proceso aparte) al crear el contexto y que en el Mac vence a los 10 s con el
 *                           mismo mensaje (blink audio_device_factory.cc); por eso el arnés del POS (prepararPagina,
 *                           _pos-simulado.mjs) da además un AudioContext de mentira, y el flag queda para lo que sí usa el
 *                           WebAudio real (navegador-audio.test.mjs con `audioFalso: false`, y cualquier página sin el arnés).
 *                           navegador-audio.test.mjs vigila las dos caras: sin error con la casa; el error a la vista si el
 *                           stream de verdad falla.
 */
export const ARGS_CHROMIUM = ['--disable-audio-output'];

/** El `chromium` de Playwright con ARGS_CHROMIUM delante de los args de cada launch(); lo demás pasa tal cual. */
export function chromiumDeLaCasa(chromium, args = ARGS_CHROMIUM) {
  const conArgs = (opciones = {}) => ({ ...opciones, args: [...args, ...(opciones.args ?? [])] });
  return {
    launch: (opciones) => chromium.launch(conArgs(opciones)),
    launchPersistentContext: (dir, opciones) => chromium.launchPersistentContext(dir, conArgs(opciones)),
    launchServer: (opciones) => chromium.launchServer(conArgs(opciones)),
    connect: (...a) => chromium.connect(...a),
    connectOverCDP: (...a) => chromium.connectOverCDP(...a),
    name: () => chromium.name(),
    executablePath: () => chromium.executablePath(),
  };
}

/** Busca Playwright sin exigirlo: devuelve { chromium } (con ARGS_CHROMIUM en cada launch()) o un motivo para saltar. */
export function buscarPlaywright() {
  if (Number(process.versions.node.split('.')[0]) < 20) return { motivo: `Playwright pide Node ≥ 20 y esto corre con ${process.versions.node}` };
  const candidatos = ['playwright'];
  if (process.env.PLAYWRIGHT_DIR) candidatos.push(process.env.PLAYWRIGHT_DIR);
  const npx = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npx)) {
    for (const d of fs.readdirSync(npx)) candidatos.push(path.join(npx, d, 'node_modules', 'playwright'));
  }
  const require = createRequire(import.meta.url);
  for (const c of candidatos) {
    try {
      const { chromium } = require(c);
      if (chromium) return { chromium: chromiumDeLaCasa(chromium) };
    } catch { /* siguiente candidato */ }
  }
  return { motivo: 'no hay Playwright (ni en node_modules, ni en $PLAYWRIGHT_DIR, ni en la caché de npx)' };
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};

/** Sirve la raíz del repo en 127.0.0.1 (puerto libre), solo lectura. */
export function servirRaiz(raiz) {
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const archivo = path.join(raiz, path.normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!archivo.startsWith(raiz + path.sep) || !fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) {
      res.writeHead(404).end('no encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  });
  return new Promise((resolver) => servidor.listen(0, '127.0.0.1', () => resolver(servidor)));
}
