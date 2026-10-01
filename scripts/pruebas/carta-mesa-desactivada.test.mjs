// La carta con una mesa DESACTIVADA (ola C, parte C4; docs/sdd-cuenta-en-mesa.md §12.3 y docs/pegatinas.md).
//
// Desde la ola C el admin puede desactivar una mesa (`mesas.activa = false`). La Edge Function `cuenta` contesta
// entonces lo MISMO que con un token rotado: 404 `enlace_invalido`. Es a propósito (no revela cuál de las tres
// causas es: mesa fuera de servicio, pegatina rotada o enlace mal copiado), así que la carta no puede saber que la
// mesa se desactivó. Lo que sí le toca es decirlo con amabilidad y mandar a la persona a un mesero, no pedirle
// «vuelve a tocar la pegatina» (que no arregla nada si la mesa ya no está en servicio).
//
// Qué se prueba:
//   1. El texto de la hoja (estática): amable, cubre la mesa fuera de servicio, manda a un mesero y no inventa la causa.
//   2. En un vm con reloj virtual (_carta-vm.mjs): la primera lectura con 404 `enlace_invalido`, y una mesa que se
//      desactiva MIENTRAS la miran (la señal del trigger o, en el peor caso, el sondeo de seguridad de 60 s).
//      En los dos, la hoja queda en `vencido`, sin canal, sin más lecturas y sin «Reintentar».
//   3. En navegador (solo con Playwright, ver _navegador.mjs): a 320 y 390 px la hoja dice el texto y no desborda.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crearCarta, RAIZ, TOKEN_CEROS } from './_carta-vm.mjs';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';

const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const sinComentarios = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ');
const INVALIDO = { status: 404, body: { error: 'enlace inválido', codigo: 'enlace_invalido' } };

// ───────────────────────── 1. el texto ─────────────────────────

function bloqueVencido() {
  const html = sinComentarios(leer('carta.html'));
  const m = html.match(/<div x-show="cuenta\.estado === 'vencido'"[\s\S]*?<\/div>\s*(?=<!-- cuenta -->|\s*<div x-show="cuenta\.estado === 'ok'")/);
  assert.ok(m, 'no encontré el bloque de la hoja para el estado «vencido»');
  return m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('carta.html: el enlace inválido (token rotado o mesa desactivada) se dice con amabilidad y manda a un mesero', () => {
  const texto = bloqueVencido();
  assert.match(texto, /Este enlace ya no sirve/);
  assert.match(texto, /ya no esté en servicio/, 'cubre la mesa desactivada');
  assert.match(texto, /pegatina se haya renovado/, 'cubre la pegatina rotada');
  assert.match(texto, /pídele a un mesero/i, 'manda a una persona');
  assert.match(texto, /No pasa nada/, 'amable: no culpa a nadie');
  assert.doesNotMatch(texto, /vuelve a tocar/i, 'tocar la pegatina otra vez no arregla una mesa fuera de servicio');
  assert.doesNotMatch(texto, /error|inv[aá]lido|token|c[oó]digo/i, 'nada técnico a la vista de un cliente');
});

test('carta.html: no inventa la causa: no dice «desactivada», «bloqueada» ni «inactiva» en ningún texto visible', () => {
  // `cuenta` no distingue una mesa desactivada de un token rotado (a propósito); la carta tampoco puede.
  const html = sinComentarios(leer('carta.html')).replace(/<script>[\s\S]*?<\/script>/g, (s) => s.replace(/\/\/[^\n]*/g, ''));
  assert.doesNotMatch(html, /desactivad|inactiv|bloquead/i);
});

test('carta.html: el subtítulo de la hoja y la pastilla también cuadran con una mesa fuera de servicio', async () => {
  const h = await crearCarta({ sinOrden: true });
  h.mundo.fallo = INVALIDO;
  await h.iniciar();
  await h.abrir(500);
  assert.equal(h.c.cuentaSub, 'No podemos mostrar esta cuenta');
  assert.equal(h.c.pastilla.texto, 'Enlace vencido');
});

// ───────────────────────── 2. el comportamiento ─────────────────────────

test('mesa desactivada desde antes: la primera lectura da 404 enlace_invalido y la hoja queda en «vencido», sin Realtime, sin sondeo y sin «Reintentar»', async () => {
  const h = await crearCarta({ sinOrden: true });
  h.mundo.fallo = INVALIDO;                                       // lo que `cuenta` contesta para una mesa con activa = false
  await h.iniciar();
  await h.abrir(500);
  assert.equal(h.c.cuenta.estado, 'vencido');
  assert.equal(h.c.conexion, 'vencido');
  assert.equal(h.supabase.canales.length, 0, 'sin canal: nunca hubo uno que abrir');
  assert.equal(h.supabase.scripts.length, 0, 'ni siquiera baja supabase-js');
  const antes = h.llamadas.cuenta.length;
  assert.equal(antes, 1, 'una sola lectura');
  await h.avanzar(10 * 60 * 1000);
  assert.equal(h.llamadas.cuenta.length, antes, 'diez minutos después, ninguna lectura más');
  // Cerrar y volver a abrir la hoja tampoco lee de nuevo: el enlace ya no sirve.
  h.c.cerrarCuenta();
  h.c.abrirCuenta();
  await h.avanzar(1000);
  assert.equal(h.llamadas.cuenta.length, antes);
  assert.equal(h.c.cuenta.estado, 'vencido');
});

test('la mesa se desactiva mientras miran la cuenta: la señal del trigger hace la lectura, que da 404, y la hoja pasa a «vencido» y suelta el canal', async () => {
  const h = await crearCarta();
  await h.iniciar();
  await h.abrir(500);
  assert.equal(h.c.cuenta.estado, 'ok');
  assert.equal(h.supabase.vivos().length, 1);
  h.mundo.fallo = INVALIDO;                                       // el admin desactiva la mesa
  h.supabase.senal(h.mundo.topico);                               // el trigger de `mesas` avisa
  await h.avanzar(1000);
  assert.equal(h.c.cuenta.estado, 'vencido');
  assert.equal(h.c.conexion, 'vencido');
  assert.equal(h.supabase.vivos().length, 0, 'el canal se suelta');
  assert.deepEqual(Array.from(h.c.cuenta.items), [], 'ni rastro de la cuenta anterior en la hoja');
  assert.equal(h.c.cuenta.total, 0);
  const antes = h.llamadas.cuenta.length;
  await h.avanzar(5 * 60 * 1000);
  assert.equal(h.llamadas.cuenta.length, antes);
});

test('la mesa se desactiva y NINGUNA señal llega (canal mudo): el sondeo de seguridad de 60 s la descubre', async () => {
  const h = await crearCarta();
  await h.iniciar();
  await h.abrir(500);
  assert.equal(h.c.cuenta.estado, 'ok');
  h.mundo.fallo = INVALIDO;
  await h.avanzar(61000);
  assert.equal(h.c.cuenta.estado, 'vencido', 'sin señal, la comprobación de seguridad lo ve en ≤ 60 s');
  assert.equal(h.supabase.vivos().length, 0);
});

test('un 404 que NO es de `cuenta` (la función no está desplegada) no se confunde con una mesa fuera de servicio', async () => {
  const h = await crearCarta();
  h.mundo.fallo = { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } };
  await h.iniciar();
  await h.abrir(500);
  assert.notEqual(h.c.cuenta.estado, 'vencido', 'un fallo del servicio se reintenta; no le dice al cliente que su mesa no sirve');
});

// ───────────────────────── 3. en navegador ─────────────────────────

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivoNavegador = pw.motivo;
if (pw.chromium) {
  try {
    const cdn = await fetch('https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js', { method: 'HEAD', signal: AbortSignal.timeout(6000) });
    if (!cdn.ok) throw new Error('jsDelivr respondió ' + cdn.status);
    navegador = await pw.chromium.launch();
    servidor = await servirRaiz(RAIZ);
  } catch (e) {
    motivoNavegador = `no pude abrir Chromium o llegar a la CDN (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await new Promise((resolver) => servidor.close(resolver));
});

for (const ancho of [320, 390]) {
  test(`navegador a ${ancho} px: la hoja de una mesa desactivada dice el texto amable y no desborda`, { skip: navegador ? false : `navegador no disponible: ${motivoNavegador}` }, async () => {
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: 640 }, timezoneId: 'America/Bogota', locale: 'es-CO' });
    try {
      const page = await contexto.newPage();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await page.route(/\.supabase\.co\//, (r) => {
        const req = r.request();
        if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
        if (req.url().includes('/functions/v1/cuenta')) return r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: JSON.stringify(INVALIDO.body) });
        return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
      });
      await page.goto(`http://127.0.0.1:${servidor.address().port}/carta.html?m=3&k=${TOKEN_CEROS}`, { waitUntil: 'load' });
      await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
      const dialogo = page.getByRole('dialog');
      await dialogo.waitFor({ state: 'visible' });
      await dialogo.getByText('Este enlace ya no sirve').waitFor({ state: 'visible', timeout: 8000 });
      assert.ok(await dialogo.getByText(/pídele a un mesero que te ayude con tu cuenta/i).isVisible(), 'falta mandar a un mesero');
      assert.equal(await page.getByRole('button', { name: 'Reintentar' }).count(), 0, 'no hay nada que reintentar');
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const d = document.documentElement;
        const hoja = document.querySelector('[role=dialog]');
        return { pagina: d.scrollWidth - d.clientWidth, hoja: hoja.scrollWidth - hoja.clientWidth };
      });
      assert.equal(r.pagina, 0, `la página desborda ${r.pagina} px`);
      assert.equal(r.hoja, 0, `la hoja desborda ${r.hoja} px`);
    } finally {
      await contexto.close();
    }
  });
}
