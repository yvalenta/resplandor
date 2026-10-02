#!/usr/bin/env node
// Capturas de «Pagar con Bre-B» en la carta (carta.html) con la red SIMULADA y el QR FICTICIO de scripts/pruebas/_breb-ficticio.mjs: ni se toca
// Supabase ni hay un dato de pago real (la llave y el contenido del QR reales viven solo en el sobre privado de Yonatan, fuera del repo).
//
// Uso (Node ≥ 20; Playwright con Chromium se busca como en las pruebas, ver _navegador.mjs; no se instala nada):
//   PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH node scripts/capturas-pago-breb.mjs <directorio-de-salida>
//
// Saca, a 390 px (hoja del celular) y a 1280 px (panel de escritorio): las opciones de «¿Cómo quieres pagar?», el QR, «Transferencia» y el QR con
// el aviso al mesero caído. Los PNG caen en <directorio>/carta-<ancho>-<pantalla>.png y NO van al repo: úsalo con una carpeta fuera de él.
// Las del tablero (Ajustes → Pago con Bre-B) salen con scripts/capturas-pos.mjs (vistas ajustes-breb*).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright, servirRaiz } from './pruebas/_navegador.mjs';
import { LLAVE_FICTICIA, QR_FICTICIO } from './pruebas/_breb-ficticio.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const salida = process.argv[2];
if (!salida) { console.error('Uso: node scripts/capturas-pago-breb.mjs <directorio-de-salida>'); process.exit(2); }
fs.mkdirSync(salida, { recursive: true });
const pw = buscarPlaywright();
if (!pw.chromium) { console.error(pw.motivo); process.exit(2); }

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const caja = {}; caja.globalThis = caja; vm.createContext(caja);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'assets/js/carta-respaldo.js'), 'utf8'), caja);
const FILAS = JSON.parse(JSON.stringify(caja.RESPLANDOR_CARTA_RESPALDO.filas));
const ITEMS = [
  { nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 },
  { nombre: 'Hamburguesa Resplandor', precio: 32000, cantidad: 1 },
  { nombre: 'Jugo natural en agua', precio: 7000, cantidad: 3 },
];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

const servidor = await servirRaiz(RAIZ);
const navegador = await pw.chromium.launch();
let errores = 0;
try {
  for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
    const movil = ancho < 1024;
    const pantallas = [
      ['elegir', async (page) => { await page.locator('.pago-opcion').first().waitFor({ state: 'visible' }); }, {}],
      ['qr', async (page) => { await page.locator('.pago-opcion').filter({ hasText: 'QR (Bre-B)' }).click(); await page.locator('.breb-qr svg path').waitFor({ state: 'attached' }); await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' }); }, {}],
      ['transferencia', async (page) => { await page.locator('.pago-opcion').filter({ hasText: 'Transferencia' }).click(); await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' }); }, {}],
      ['qr-sin-aviso', async (page) => { await page.locator('.pago-opcion').filter({ hasText: 'QR (Bre-B)' }).click(); await page.locator('.breb-qr svg path').waitFor({ state: 'attached' }); await page.locator('#pago-breb .pago-aviso').waitFor({ state: 'visible' }); }, { alertaFalla: true }],
    ];
    for (const [nombre, llegar, { alertaFalla } = {}] of pantallas) {
      const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: movil ? 2 : 1, ...(movil ? { isMobile: true, hasTouch: true } : {}) });
      const page = await contexto.newPage();
      page.on('pageerror', (e) => { errores++; console.error('pageerror', e.message); });
      page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || '')) { errores++; console.error('consola', m.text()); } });
      await page.route(/\.supabase\.co\//, (r) => {
        const req = r.request(); const url = req.url();
        if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
        if (url.includes('/rest/v1/carta_publica')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(FILAS) });
        if (url.includes('/functions/v1/cuenta')) {
          return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ mesa: 7, abierta: true, abierta_en: '2026-09-30T17:41:00Z', items: ITEMS, total: 99000, pago: { breb: { llave: LLAVE_FICTICIA, qr: QR_FICTICIO } } }) });
        }
        if (url.includes('/functions/v1/alerta')) {
          const cuerpo = JSON.parse(req.postData() || '{}');
          if (alertaFalla) return r.fulfill({ status: 401, contentType: 'application/json', headers: CORS, body: JSON.stringify({ code: 401, message: 'Invalid JWT' }) });
          return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, metodo: cuerpo.metodo, creada_en: 'x' }) });
        }
        return r.fulfill({ status: 404, headers: CORS, body: '{}' });
      });
      await page.goto(`http://127.0.0.1:${servidor.address().port}/carta.html?m=7&k=${TOKEN}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Alpine && document.querySelector('[x-data]') && document.querySelector('[x-data]')._x_dataStack, null, { timeout: 15000 });
      if (movil) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      await page.locator('.cuenta-total').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      await llegar(page);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700);                      // la hoja termina de subir y los avisos de aparecer
      const archivo = path.join(salida, `carta-${ancho}-${nombre}.png`);
      await page.screenshot({ path: archivo });
      console.log('OK', archivo);
      await contexto.close();
    }
  }
} finally {
  await navegador.close();
  await new Promise((r) => servidor.close(r));
}
process.exit(errores ? 1 : 0);
