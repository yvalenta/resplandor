// Chromium para las pruebas que miden en un navegador de verdad (desborde.test.mjs,
// insignia.test.mjs), sin exigirlo. Ni CI ni el repo traen Playwright (el sitio no tiene
// dependencias de runtime), así que se busca en node_modules, en $PLAYWRIGHT_DIR y en la caché
// de npx; si no está, cada prueba se salta con el motivo. Necesita Node ≥ 20.
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre
// como prueba, solo lo importan las que lo necesitan.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Busca Playwright sin exigirlo: devuelve { chromium } o un motivo para saltar. */
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
      if (chromium) return { chromium };
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
