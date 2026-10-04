// pulido-bordes · B3, DE PUNTA A PUNTA contra la base REAL: el ticket de un cobro cuyo envío a la caja tarda o falla DESPUÉS de que el mesero tocó «Volver».
//
// La pila es la de impresion-punta-a-punta.test.mjs (_pila-impresion.mjs): el POS REAL (pos.html con su supabase-js, en Chromium) → la base REAL (Postgres 17 con la
// cadena completa de migraciones, a través de un «PostgREST» de mentira) → el AGENTE REAL (impresora/agente.mjs en modo --simular). Lo único que se manipula es la red
// del POS: una ruta de Playwright demora la RESPUESTA del insert a `impresiones` (la fila ya está en la base), la demora entera (la petición sale tarde) o la corta.
//
//   1. Respuesta lenta con la caja sin atender   el insert llega a la cola, su respuesta tarda más de 10 s y el mesero ya está en el salón: NO se cancela (la fila sigue
//                                                «pendiente»), el teléfono no imprime ni se le trae la pantalla, el aviso lo sigue; al volver el agente, sale en la caja
//   2. El insert nunca llega                     la red lo corta: «dudoso», sin cancelar nada; «Imprimir desde este teléfono» saca la orden CONFIRMADA
//   3. El insert llega tarde con el agente vivo  a los 10 s el POS no sabe; el insert entra a los 13 s y el agente lo imprime: una copia, en la caja, sin cancelarlo
//
// Con POS_HTML=<pos.html de f32577d> (servirPos lo sirve como /pos.html) las tres fallan: a los 10 s el POS cancelaba el trabajo y traía la pantalla de vuelta.
// Solo corre con Docker y Playwright (Chromium) y Node ≥ 22; si no, se salta con el motivo. Nada sale a internet ni toca el Supabase de producción.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buscarDocker } from './_supabase-simulado.mjs';
import { buscarPlaywright } from './_navegador.mjs';
import { nuevoContexto, prepararPagina, esperarListo, servirPos } from './_pos-simulado.mjs';
import { levantarPila, CLAVE_PUBLICABLE, HOST_SUPABASE } from './_pila-impresion.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const AGENTE = path.join(RAIZ, 'impresora', 'agente.mjs');
const docker = buscarDocker();
const pw = buscarPlaywright();
const SALTAR = docker.motivo || pw.motivo || (Number(process.versions.node.split('.')[0]) < 22 ? 'el agente pide Node ≥ 22' : false);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, { limite = 40000, cada = 150, motivo = 'la condición' } = {}) {
  const fin = Date.now() + limite;
  let ultimo;
  for (;;) {
    try { const v = await cond(); if (v) return v; } catch (e) { ultimo = e; }
    if (Date.now() > fin) throw new Error(`pasaron ${limite} ms y no se cumplió: ${motivo}${ultimo ? ` (último error: ${ultimo.message})` : ''}`);
    await esperar(cada);
  }
}

let pila = null;
let servidor = null;
let navegador = null;
let carpetaTrabajo = null;
const contextos = [];
const agentes = [];
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-type' };

/** Un agente real (proceso aparte, --simular) con su propia carpeta y config.json. */
function arrancarAgente(nombre, token, { sondeoSegundos = 5, latidoSegundos = 10 } = {}) {      // el agente exige latidoSegundos entre 10 y 300
  const carpeta = path.join(carpetaTrabajo, `agente-${nombre}`);
  fs.mkdirSync(carpeta, { recursive: true });
  const config = path.join(carpeta, 'config.json');
  fs.writeFileSync(config, JSON.stringify({
    columnas: 48, supabaseUrl: pila.url, publishableKey: CLAVE_PUBLICABLE, token, impresora: 'IMPRESORA-SIMULADA', simular: true,
    sondeoSegundos, latidoSegundos, carpetaSalida: path.join(carpeta, 'salida'),
  }));
  const proceso = spawn(process.execPath, [AGENTE, '--config', config, '--simular'], { cwd: carpeta, stdio: ['ignore', 'pipe', 'pipe'] });
  const a = { nombre, proceso, carpeta, lineas: [], cerrado: null };
  const guardar = (d) => { for (const l of String(d).split('\n')) if (l.trim()) a.lineas.push(l); };
  proceso.stdout.on('data', guardar);
  proceso.stderr.on('data', guardar);
  a.cerrado = new Promise((r) => proceso.on('close', (code, senal) => r({ code, senal })));
  a.vivo = () => proceso.exitCode === null && proceso.signalCode === null;
  a.texto = () => a.lineas.join('\n');
  a.esperarLinea = (re, limite = 30000) => hasta(() => a.lineas.find((l) => re.test(l)), { limite, motivo: `una línea del agente ${nombre} con ${re}\n${a.texto().slice(-1200)}` });
  a.impresos = () => a.lineas.map((l) => /Impreso #([0-9a-f]+)/.exec(l)?.[1]).filter(Boolean);
  a.parar = async () => {
    if (a.vivo()) proceso.kill('SIGTERM');
    await Promise.race([a.cerrado, esperar(8000)]);
    if (a.vivo()) proceso.kill('SIGKILL');
  };
  agentes.push(a);
  return a;
}

/** El mesero con el POS abierto, hablando con la pila. `red` decide qué pasa con el insert a `impresiones` (ver más abajo). */
async function abrirPosMesero() {
  const ctx = await nuevoContexto(navegador, { ancho: 1280, alto: 800 });
  contextos.push(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(90000);
  await prepararPagina(page, { url: servidor.url, stubSupabase: false, relojFijo: false, bloquearFuentes: true });
  await pila.conectarPagina(page);
  const red = { modo: 'normal', retraso: 0, inserts: 0 };
  // Más reciente que la de la pila: manda ella y, salvo en el insert que se manipula, delega en la de la pila (`fallback`).
  await page.route((u) => u.hostname === HOST_SUPABASE && u.pathname === '/rest/v1/impresiones', async (route) => {
    const pedido = route.request();
    if (pedido.method() !== 'POST' || red.modo === 'normal') return route.fallback();
    red.inserts++;
    if (red.modo === 'respuesta-lenta') {        // la base lo recibe YA; la respuesta tarda
      const u = new URL(pedido.url());
      const cab = { ...pedido.headers() }; delete cab.host; delete cab['content-length'];
      const r = await fetch(pila.url + u.pathname + u.search, { method: 'POST', headers: cab, body: pedido.postData() || '' });
      const texto = await r.text();
      await esperar(red.retraso);
      return route.fulfill({ status: r.status, headers: { ...CORS, 'content-type': r.headers.get('content-type') || 'application/json' }, body: texto });
    }
    if (red.modo === 'tarde') { await esperar(red.retraso); return route.fallback(); }          // la petición sale tarde: la base no ve nada hasta entonces
    if (red.modo === 'cae') { await esperar(red.retraso); return route.abort('failed'); }        // la red la corta: la base no la ve nunca
    return route.fallback();
  });
  const { sesion } = pila.persona('mesero');
  await page.addInitScript(([k, s]) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch { /* sin almacenamiento */ } }, ['sb-lccgehvyymladqvumcez-auth-token', sesion]);
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load', timeout: 90000 });
  await esperarListo(page);
  return { page, ctx, red };
}

const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const enVista = (page, v) => page.waitForFunction((x) => Alpine.store('pos').vista === x, v);
const aOrden = async (page, n = 3) => {
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).click();
  await enVista(page, 'orden');
  await page.locator('.menu-item').first().waitFor();
};
const cajaLista = (page) => hasta(() => page.evaluate(() => Alpine.store('pos').puedeImprimirEnCaja), { limite: 20000, motivo: 'la caja en línea' });
const dialogo = (page, nombre) => page.getByRole('dialog', { name: nombre });
const impresiones = () => pila.pg.filas('select id, estado, intentos, error, tipo, orden_id, tomada_por from public.impresiones order by creada_en, id');
const conteoPrint = (page) => page.evaluate(() => window.__posImpresiones || 0);
const trabajo = (page) => page.evaluate(() => { const e = Alpine.store('pos').cajaTrabajos[0]; return e ? { estado: e.estado, tipo: e.tipo, titulo: e.titulo, orden: !!e.orden } : null; });
const cancelaciones = () => pila.peticiones.filter((p) => /impresion_cancelar/.test(p.ruta)).length;

/** Cobra la cuenta de la mesa 3, confirma «Imprimir en la caja» del ticket y toca «Volver» (con el envío todavía en vuelo). */
async function cobrarConfirmarYVolver(page) {
  await boton(page, 'Generar ticket y cobrar').click();
  await boton(page, 'Sí, cobrar').click();
  await enVista(page, 'ticket');
  await boton(page, 'Imprimir').click();
  await dialogo(page, 'Imprimir ticket').waitFor();
  await boton(page, 'Imprimir en la caja').click();
  await hasta(async () => (await trabajo(page))?.estado === 'enviando', { limite: 10000, motivo: 'el trabajo «enviando»' });
  await page.evaluate(() => Alpine.store('pos').volverDeTicket());      // el mesero confió en la caja y volvió al salón
  await enVista(page, 'mesas');
}

describe('pulido-bordes · el ticket de un cobro que tarda o falla después de «Volver», contra la base real', { skip: SALTAR }, () => {
  let token = null;
  let impresoraId = null;
  let agente = null;

  before(async () => {
    carpetaTrabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-pila-pulido-'));
    pila = await levantarPila({ conCola: true });
    servidor = await servirPos(RAIZ, 0);
    navegador = await pw.chromium.launch();
    const admin = pila.persona('admin');
    const r = await fetch(`${pila.url}/rest/v1/rpc/impresora_crear`, {
      method: 'POST', headers: { apikey: CLAVE_PUBLICABLE, authorization: `Bearer ${admin.jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_nombre: 'Caja principal' }),
    });
    assert.equal(r.status, 200, 'el admin crea la impresora');
    const creada = await r.json();
    token = creada.token; impresoraId = creada.id;
    assert.match(token, /^imp_[0-9a-f]{64}$/);
  });
  after(async () => {
    for (const a of agentes) await a.parar().catch(() => {});
    for (const c of contextos) await c.close().catch(() => {});
    await navegador?.close().catch(() => {});
    await servidor?.cerrar().catch(() => {});
    await pila?.parar().catch(() => {});
    if (carpetaTrabajo) fs.rmSync(carpetaTrabajo, { recursive: true, force: true });
  });

  /** Un agente nuevo que ya latió (la caja figura en línea). */
  async function conAgente(nombre) {
    const a = arrancarAgente(nombre, token);
    await a.esperarLinea(/Esperando trabajos de impresión/);
    await a.esperarLinea(/Señal en tiempo real conectada/, 30000);
    await hasta(() => pila.pg.filas('select ultimo_latido from public.impresoras')[0].ultimo_latido, { motivo: 'el primer latido del agente' });
    return a;
  }

  test('1 · la respuesta del insert tarda más de 10 s y el mesero ya está en el salón, con la caja sin atender: el trabajo NO se cancela, el teléfono no imprime y, al volver el agente, sale en la caja', async () => {
    agente = await conAgente('caja-1');
    const { page, red } = await abrirPosMesero();
    await aOrden(page);
    await cajaLista(page);
    await agente.parar();                                          // el PC se apaga: la caja sigue «en línea» unos 90 s (su último latido es fresco)
    red.modo = 'respuesta-lenta'; red.retraso = 16000;
    await cobrarConfirmarYVolver(page);
    // La fila ya está en la base (pendiente, nadie la toma) y el POS lo averigua a los 10 s, antes de que llegue la respuesta.
    await hasta(async () => ['pendiente', 'dudoso'].includes((await trabajo(page))?.estado), { limite: 30000, motivo: 'el POS da por terminado el tope de 10 s' });
    await hasta(async () => (await trabajo(page))?.estado === 'pendiente', { limite: 15000, motivo: 'el POS ve el trabajo en la cola (lo lee de la base)' });
    const filas = impresiones();
    assert.equal(filas.length, 1);
    assert.equal(filas[0].estado, 'pendiente', 'sigue en la cola: NO se canceló (antes: error «cancelada» a los 10 s)');
    assert.equal(cancelaciones(), 0, 'ni se intentó cancelar');
    assert.equal(await conteoPrint(page), 0, 'el teléfono no imprimió');
    assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'mesas', 'ni se le trajo la pantalla de vuelta');
    assert.equal(red.inserts, 1);
    // El PC vuelve: el agente toma lo que está en la cola y lo imprime. UNA copia, en la caja, y el aviso lo sigue hasta «Impreso».
    const agente2 = await conAgente('caja-1b');
    await agente2.esperarLinea(/Impreso #/, 40000);
    await hasta(() => impresiones()[0].estado === 'impresa', { limite: 20000, motivo: 'la base dice «impresa»' });
    await hasta(async () => (await page.locator('.toast-impresion-fila').count()) === 0 || /Impreso/.test(await page.locator('.toast-impresion-fila').first().innerText()), { limite: 30000, motivo: 'el aviso dice «Impreso»' });
    assert.equal(impresiones().length, 1);
    assert.equal(impresiones()[0].intentos, 1, 'una sola impresión');
    assert.equal(agente2.impresos().length, 1);
    assert.equal(await conteoPrint(page), 0, 'y el teléfono nunca imprimió');
    await agente2.parar();
    await page.context().close();
  });

  test('2 · el insert NUNCA llega (la red lo corta) con el mesero ya en el salón: queda «dudoso», sin cancelar nada; «Imprimir desde este teléfono» saca la orden CONFIRMADA', async () => {
    const { page, red } = await abrirPosMesero();
    await aOrden(page, 6);                                          // otra cuenta abierta: la mesa 3 ya se cobró en la prueba anterior
    await cajaLista(page);
    red.modo = 'cae'; red.retraso = 4000;
    const antes = impresiones().length;
    const cancelacionesAntes = cancelaciones();
    await cobrarConfirmarYVolver(page);
    await hasta(async () => (await trabajo(page))?.estado === 'dudoso', { limite: 30000, motivo: 'el aviso queda «dudoso» (la base no lo tiene y no se sabe)' });
    assert.equal(impresiones().length, antes, 'la base no recibió nada');
    assert.equal(cancelaciones(), cancelacionesAntes, 'y no se intentó cancelar (nadie va a imprimir desde el teléfono todavía)');
    assert.equal(await conteoPrint(page), 0);
    assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'mesas');
    const texto = await page.locator('.toast-impresion-fila').first().innerText();
    assert.match(texto, /No hubo respuesta de la caja\. Si el ticket llegó, sale allí en unos segundos; si no sale, imprímelo desde este teléfono\./);
    // Su toque: cierra la puerta de atrás (cancelar: la base dice «no existe»), trae la orden CONFIRMADA y la imprime desde el teléfono.
    await page.getByRole('button', { name: 'Imprimir desde este teléfono', exact: true }).click();
    await enVista(page, 'ticket');
    assert.equal(await page.evaluate(() => Alpine.store('pos').ordenTicket.estado), 'cerrada', 'es la orden cerrada que se cobró');
    assert.equal(await page.evaluate(() => String(Alpine.store('pos').ordenTicket.mesaId)), '6');
    await hasta(async () => (await conteoPrint(page)) === 1, { limite: 10000, motivo: 'window.print() del teléfono' });
    assert.ok(cancelaciones() > cancelacionesAntes, 'antes de imprimir se cerró la puerta de atrás');
    await hasta(async () => (await page.locator('.toast-impresion-fila').count()) === 0, { limite: 10000, motivo: 'el aviso se va: ya salió' });
    await page.context().close();
  });

  test('3 · el insert llega TARDE (a los 13 s) con el agente vivo: a los 10 s el POS no sabe y no cancela nada; entra a la cola, el agente lo imprime (una copia) y el aviso lo sigue', async () => {
    agente = await conAgente('caja-3');
    const { page, red } = await abrirPosMesero();
    // Con las cuentas 3 y 6 ya cobradas, se abre una mesa nueva con un producto (lo que el POS crea y sube igual que cualquier cuenta).
    await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^1$/ }) }).click();
    await enVista(page, 'orden');
    await page.locator('.menu-item').first().waitFor();
    await page.locator('.menu-item', { hasText: 'Limonada de coco' }).first().click();     // un producto sin variantes (el primero abre la hoja de variantes)
    await page.waitForFunction(() => Alpine.store('pos').hayLineas === true);
    await cajaLista(page);
    red.modo = 'tarde'; red.retraso = 13000;
    const antes = impresiones().length;
    const cancelacionesAntes = cancelaciones();
    await cobrarConfirmarYVolver(page);
    await hasta(async () => ['dudoso', 'pendiente', 'imprimiendo', 'impresa'].includes((await trabajo(page))?.estado), { limite: 30000, motivo: 'el POS da por terminado el tope' });
    assert.equal(cancelaciones(), cancelacionesAntes, 'a los 10 s no se cancela nada');
    assert.equal(await conteoPrint(page), 0, 'ni imprime el teléfono');
    // A los 13 s la petición sale, la base la recibe y el agente lo imprime.
    await hasta(() => impresiones().length === antes + 1, { limite: 30000, motivo: 'el insert llega a la base' });
    await hasta(() => impresiones().at(-1).estado === 'impresa', { limite: 40000, motivo: 'el agente lo imprime' });
    const fila = impresiones().at(-1);
    assert.equal(fila.intentos, 1, 'una sola impresión');
    assert.equal(fila.error, null, 'y no se canceló');
    assert.equal(cancelaciones(), cancelacionesAntes, 'ni siquiera cuando por fin entró');
    await hasta(async () => (await page.locator('.toast-impresion-fila').count()) === 0 || /Impreso/.test(await page.locator('.toast-impresion-fila').first().innerText()), { limite: 30000, motivo: 'el aviso dice «Impreso»' });
    assert.equal(await conteoPrint(page), 0, 'el teléfono nunca imprimió');
    assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'mesas');
    await agente.parar();
    await page.context().close();
  });
});
