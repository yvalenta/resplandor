// Imprimir en la caja, DE PUNTA A PUNTA y todo local: el POS REAL (pos.html con su supabase-js, en Chromium) → la base REAL (Postgres 17
// con la cadena completa de migraciones, a través de un «PostgREST» de mentira) → el AGENTE REAL (impresora/agente.mjs, un proceso
// aparte en modo --simular) → los bytes ESC/POS y su vista de texto → el estado «Impreso» de vuelta en el POS. Es la prueba de que las
// tres piezas (la migración, el agente y el POS) se entienden con los nombres y las formas que de verdad usan.
// La pila está en _pila-impresion.mjs. Nada sale a internet ni toca el Supabase de producción: el host del proyecto está interceptado
// y cualquier otro host externo se aborta (se comprueba al final).
//
// Solo corre con Docker y Playwright (Chromium); si no, se salta con el motivo. Con PILA_EVIDENCIA=<carpeta> deja capturas, los .bin y
// su vista de texto, las bitácoras de los agentes y un resumen en JSON (sin config.json: ahí iría el token).
//
//   0. Compatibilidad   la base de HOY (sin la cola): el POS es el de siempre (sin botón ni indicador) y «Imprimir precuenta» imprime en el teléfono
//   1. Alta             la migración se aplica con el POS ya abierto; el admin crea la impresora en el POS; el token en claro sale UNA vez;
//                       el agente arranca con él y la caja pasa a «en línea»
//   2. Camino feliz     «Imprimir en la caja» (orden y ticket) → el agente lo toma por la SEÑAL de Realtime (sondeo de 60 s, no es él) →
//                       .bin y vista de texto iguales al ticket de papel del POS → «Impreso» en el POS; la prueba del admin también
//   3. Señal perdida    sin señal por Realtime el sondeo lo recoge
//   4. Agente apagado   sin latido la caja figura sin conexión: sin botón, «Imprimir precuenta» imprime en el teléfono y no encola nada;
//                       con el latido todavía fresco el trabajo queda en cola, el POS dice «La caja no responde» y sale al volver el PC
//   5. Token rotado     el agente viejo deja de tomar (y lo dice); el trabajo espera; con el token nuevo sale una sola vez
//   6. Dos agentes      con el mismo token y 12 trabajos juntos: ninguno sale dos veces
//   7. Trabajo malo     bytes de control, campos absurdos y un documento vacío no tumban al agente ni le mandan comandos a la impresora
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buscarDocker } from './_supabase-simulado.mjs';
import { buscarPlaywright } from './_navegador.mjs';
import { nuevoContexto, prepararPagina, esperarListo, esperarEstable, servirPos } from './_pos-simulado.mjs';
import { levantarPila, CLAVE_PUBLICABLE, CORREO_MESERO, HOST_SUPABASE } from './_pila-impresion.mjs';
import { bytesATexto } from '../../impresora/ticket/vista-texto.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const AGENTE = path.join(RAIZ, 'impresora', 'agente.mjs');
const docker = buscarDocker();
const pw = buscarPlaywright();
const SALTAR = docker.motivo || pw.motivo || (Number(process.versions.node.split('.')[0]) < 22 ? 'el agente pide Node ≥ 22' : false);
const EVIDENCIA = process.env.PILA_EVIDENCIA ? path.resolve(process.env.PILA_EVIDENCIA) : null;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, { limite = 30000, cada = 100, motivo = 'la condición' } = {}) {
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
const diags = [];
const agentes = [];
const resumen = { fecha: new Date().toISOString(), node: process.versions.node, pasos: {} };
const nota = (clave, valor) => { resumen.pasos[clave] = valor; };

// ───────────────────────────── ayudantes ─────────────────────────────

/** Un agente real (proceso aparte, --simular) con su propia carpeta, config.json y salida/. */
function arrancarAgente(nombre, token, { sondeoSegundos = 60, latidoSegundos = 30, base = { columnas: 48 } } = {}) {
  const carpeta = path.join(carpetaTrabajo, `agente-${nombre}`);
  fs.mkdirSync(carpeta, { recursive: true });
  const config = path.join(carpeta, 'config.json');
  // `base` es lo que arma el POS en «Copiar config.json» (test 1); aquí solo se apunta a la pila y se pone el modo simulado.
  fs.writeFileSync(config, JSON.stringify({
    ...base, supabaseUrl: pila.url, publishableKey: CLAVE_PUBLICABLE, token, impresora: 'IMPRESORA-SIMULADA', simular: true,
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
  a.esperarLinea = (re, limite = 20000) => hasta(() => a.lineas.find((l) => re.test(l)), { limite, motivo: `una línea del agente ${nombre} con ${re}\n${a.texto().slice(-1500)}` });
  a.salida = () => (fs.existsSync(path.join(carpeta, 'salida')) ? fs.readdirSync(path.join(carpeta, 'salida')).sort() : []);
  a.bins = () => a.salida().filter((f) => f.endsWith('.bin')).map((f) => path.join(carpeta, 'salida', f));
  a.impresos = () => a.lineas.map((l) => /Impreso #([0-9a-f]+)/.exec(l)?.[1]).filter(Boolean);
  a.parar = async (senal = 'SIGTERM') => {
    if (a.vivo()) proceso.kill(senal);
    await Promise.race([a.cerrado, esperar(8000)]);
    if (a.vivo()) proceso.kill('SIGKILL');
  };
  agentes.push(a);
  return a;
}

/** Una persona del personal con el POS abierto, hablando con la pila (supabase-js real). */
async function abrirPos(persona, { ancho = 390 } = {}) {
  const ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
  contextos.push(ctx);
  const page = await ctx.newPage();
  const diag = await prepararPagina(page, { url: servidor.url, stubSupabase: false, relojFijo: false, bloquearFuentes: true });
  diags.push(diag);
  await pila.conectarPagina(page);
  const { sesion } = pila.persona(persona);
  await page.addInitScript(([k, s]) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch { /* sin almacenamiento */ } }, ['sb-lccgehvyymladqvumcez-auth-token', sesion]);
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page);
  return { page, ctx, diag };
}

const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const enVista = (page, v) => page.waitForFunction((x) => Alpine.store('pos').vista === x, v);
const aOrden = async (page, n = 3) => {
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).click();
  await enVista(page, 'orden');
  await page.locator('.menu-item').first().waitFor();
};
// El admin llega a la impresora como una persona: Administración → la tarjeta «Impresora de la caja» → «Configurar impresora» (no hay entrada suelta).
const aImpresora = async (page) => {
  await page.locator('nav.nav-bar .nav-destinos .nav-link:has-text("Administración")').first().click();
  await enVista(page, 'admin');
  const tarjeta = page.locator('[data-tarjeta="impresora"]');
  await tarjeta.waitFor({ state: 'visible', timeout: 15000 });
  await tarjeta.getByRole('button', { name: 'Configurar impresora', exact: true }).click();
  await enVista(page, 'impresora');
};
// La orden: UN botón «Imprimir precuenta». Imprimir va SIEMPRE a la caja y con una confirmación (modal «Imprimir precuenta»): «Imprimir en la caja»
// manda. Con la caja registrada pero sin latir, el mismo modal ofrece «Imprimir aquí» (la salida de emergencia); sin la cola, imprime directo en el teléfono.
const cajaLista = (page, motivo) => hasta(() => page.evaluate(() => Alpine.store('pos').puedeImprimirEnCaja), { limite: 10000, motivo });
const dialogo = (page, nombre = /^Imprimir (precuenta|ticket)$/) => page.getByRole('dialog', { name: nombre });
const precuentaACaja = async (page) => { await boton(page, 'Imprimir precuenta').click(); await dialogo(page).waitFor(); await boton(page, 'Imprimir en la caja').click(); };
const avisoCaja = (page) => page.locator('.toast-impresion-fila').first().innerText().then((x) => x.replace(/\s+/g, ' ').trim()).catch(() => '');
const impresiones = (extra = '') => pila.pg.filas(`select id, impresora_id, tipo, mesa_id, orden_id, estado, intentos, error, creada_por, tomada_por, contenido from public.impresiones ${extra} order by creada_en, id`);
const conteoPrint = (page) => page.evaluate(() => window.__posImpresiones || 0);
const captura = async (page, nombre) => {
  if (!EVIDENCIA) return;
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nombre}.png`), fullPage: false }).catch(() => {});
};

/** El ticket de papel del POS (lo que sale por window.print): una lista de líneas «izquierda derecha», como las leería quien lo tiene en la mano. */
async function ticketDePapel(page) {
  return page.evaluate(() => {
    const t = (e) => (e ? e.innerText.replace(/\s+/g, ' ').trim() : '');
    const raiz = document.querySelector('.print-zone .ticket');
    const L = [t(raiz.querySelector('.ticket-brand')), t(raiz.querySelector('.ticket-sub'))];
    // (la fila «Cuenta de» solo se ve en el cobro de una persona: oculta no es parte del papel, igual que un .ticket-line oculto)
    raiz.querySelectorAll('.meta-row').forEach((r) => { if (r.offsetParent === null) return; const [a, b] = r.querySelectorAll('span'); L.push(`${t(a)} ${t(b)}`); });
    raiz.querySelectorAll('.ticket-line').forEach((r) => {
      if (r.offsetParent === null) return;
      const nombre = r.querySelector('.name');
      const principal = nombre.querySelector(':scope > span:first-child') || nombre;
      L.push(`${t(principal)} ${t(r.querySelector('.price'))}`.trim());
      const opt = nombre.querySelector('.opt'); if (opt && opt.offsetParent !== null) L.push(t(opt));
      const unit = nombre.querySelector('.unit'); if (unit && unit.offsetParent !== null) L.push(t(unit));
    });
    const total = raiz.querySelector('.ticket-total');
    if (total) L.push(`${t(total.querySelector('.label'))} ${t(total.querySelector('.amount'))}`);
    L.push(t(raiz.querySelector('.ticket-footer')));
    return L.filter(Boolean);
  });
}
/** Lo que dice la vista de texto del agente, normalizado igual: sin rayas, sin QR, sin el corte y con los espacios colapsados. */
function lineasDeVista(txt) {
  return txt.split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^[-=_*.~#]{3,}$/.test(l) && !l.startsWith('[ QR:') && !l.includes('✂'));
}
const norm = (l) => l.toLowerCase().replace(/—/g, '-').replace(/\s+/g, ' ').trim();

const docBueno = (texto = 'Prueba punta a punta') => ({
  v: 1, titulo: 'Resplandor',
  lineas: [{ texto }, { texto: '1 x Café', der: '$ 8.000' }, { texto: 'TOTAL', der: '$ 8.000', negrita: true, doble: true }],
  qr: { texto: 'https://resplandor.ynt.codes/', etiqueta: 'resplandor.ynt.codes' }, cortar: true,
});

/** Lo que haría un teléfono del personal: un INSERT a /rest/v1/impresiones con su JWT. */
async function encolarComo(persona, { contenido = docBueno(), tipo = 'cuenta', impresora_id = null, id = crypto.randomUUID() } = {}) {
  const p = pila.persona(persona);
  const r = await fetch(`${pila.url}/rest/v1/impresiones`, {
    method: 'POST',
    headers: { apikey: CLAVE_PUBLICABLE, authorization: `Bearer ${p.jwt}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ id, impresora_id, tipo, mesa_id: 3, orden_id: 'ord-abierta-3', contenido }),
  });
  return { estado: r.status, cuerpo: await r.json().catch(() => null), id };
}

// ───────────────────────────── la prueba ─────────────────────────────

describe('imprimir en la caja, de punta a punta', { skip: SALTAR }, () => {
  let admin = null;
  let impresoraId = null;
  let token1 = null;
  let agente1 = null;

  before(async () => {
    carpetaTrabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-pila-'));
    pila = await levantarPila({ conCola: false });
    servidor = await servirPos(RAIZ, 0);
    navegador = await pw.chromium.launch();
  });

  after(async () => {
    for (const a of agentes) await a.parar().catch(() => {});
    for (const c of contextos) await c.close().catch(() => {});
    await navegador?.close().catch(() => {});
    await servidor?.cerrar().catch(() => {});
    if (EVIDENCIA && pila) {
      fs.mkdirSync(EVIDENCIA, { recursive: true });
      resumen.peticionesSinSoporte = pila.noSoportadas;
      resumen.hostsBloqueados = diags.flatMap((d) => d.bloqueadas);
      fs.writeFileSync(path.join(EVIDENCIA, 'resumen-punta-a-punta.json'), JSON.stringify(resumen, null, 2));
    }
    await pila?.parar().catch(() => {});
    if (carpetaTrabajo) fs.rmSync(carpetaTrabajo, { recursive: true, force: true });
  });

  /** Guarda lo que dejó un agente (salida/ y bitácora sin secretos) para mirarlo después. */
  const guardarAgente = (a, etiqueta) => {
    if (!EVIDENCIA) return;
    const dest = path.join(EVIDENCIA, `agente-${etiqueta}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of a.salida()) fs.copyFileSync(path.join(a.carpeta, 'salida', f), path.join(dest, f));
    fs.writeFileSync(path.join(dest, 'consola.log'), a.texto() + '\n');
  };

  test('0 · la base de HOY (sin la cola): el POS es el de siempre y «Imprimir precuenta» imprime en el teléfono', async () => {
    const { page, diag } = await abrirPos('mesero');
    await aOrden(page);
    assert.equal(await boton(page, 'Imprimir en la caja').count(), 0, 'sin la migración no hay botón');
    assert.equal(await page.locator('.caja-estado:visible').count(), 0, 'ni indicador de la caja');
    assert.equal(await page.evaluate(() => Alpine.store('pos').cajaDisponible), false);
    await boton(page, 'Imprimir precuenta').click();
    await enVista(page, 'ticket');
    await hasta(async () => (await conteoPrint(page)) === 1, { motivo: 'window.print() del teléfono' });
    assert.equal(await boton(page, 'Imprimir en la caja').count(), 0);
    const peticiones = pila.peticiones.filter((p) => /impresora_estado/.test(p.ruta));
    assert.ok(peticiones.length >= 1, 'el POS sí preguntó por impresora_estado()');
    assert.deepEqual(diag.errores.filter((e) => !/impresora_estado|404|Failed to load resource/i.test(e)), [], 'sin errores propios en la consola');
    nota('0_compatibilidad', { botonEnCaja: 0, indicador: 0, impresionesEnTelefono: 1, preguntoImpresoraEstado: peticiones.length });
    await captura(page, 'integracion-0-sin-cola');
    await page.context().close();
  });

  test('1 · se aplica la migración; el admin crea la impresora en el POS (el token sale una vez) y el agente arranca con él', async () => {
    pila.aplicarCola();
    const a = await abrirPos('admin');
    admin = a;
    await aImpresora(a.page);
    await a.page.getByText('Aún no hay una impresora').waitFor();
    await captura(a.page, 'integracion-1-admin-vacia');
    await a.page.locator('#caja-nombre').fill('Caja principal');
    await boton(a.page, 'Agregar impresora').click();
    await a.page.locator('.caja-token').waitFor();
    token1 = await a.page.locator('#caja-token').inputValue();
    assert.match(token1, /^imp_[0-9a-f]{64}$/, 'el token en claro tiene la forma del contrato');
    await captura(a.page, 'integracion-1-admin-token');
    // en la base solo existe el hash
    const filas = pila.pg.filas('select id, nombre, token_hash, activa, ultimo_latido from public.impresoras');
    assert.equal(filas.length, 1);
    assert.equal(filas[0].nombre, 'Caja principal');
    assert.equal(filas[0].token_hash, pila.tokenHash(token1), 'la base guarda sha256(token), nunca el token');
    assert.ok(!JSON.stringify(filas).includes(token1));
    impresoraId = filas[0].id;
    // «Copiar config.json»: lo que el POS entrega para pegar en el PC (el agente real lo tiene que aceptar tal cual, salvo el nombre de Windows)
    const configPos = JSON.parse(await a.page.evaluate(() => Alpine.store('pos').configAgente));
    assert.deepEqual(Object.keys(configPos).sort(), ['columnas', 'cortar', 'impresora', 'publishableKey', 'qrNativo', 'supabaseUrl', 'tablaEscPos', 'token']);
    assert.equal(configPos.token, token1);
    assert.equal(configPos.supabaseUrl, `https://${HOST_SUPABASE}`);
    assert.match(configPos.publishableKey, /^sb_publishable_/);
    assert.equal(configPos.impresora, 'NOMBRE DE LA IMPRESORA EN WINDOWS');
    // «Listo, ya lo copié»: el token desaparece de la pantalla y de la memoria del POS
    await boton(a.page, 'Listo, ya lo copié').click();
    assert.equal(await a.page.evaluate(() => Alpine.store('pos').cajaToken), null);
    await a.page.locator('#caja-token').waitFor({ state: 'hidden', timeout: 5000 });

    agente1 = arrancarAgente('caja', token1, { sondeoSegundos: 60, latidoSegundos: 30, base: configPos });
    await agente1.esperarLinea(/Esperando trabajos de impresión/);
    await agente1.esperarLinea(/Señal en tiempo real conectada/, 20000);
    await hasta(() => pila.pg.filas('select ultimo_latido, version_agente from public.impresoras')[0].ultimo_latido, { motivo: 'el primer latido del agente en la base' });
    const f = pila.pg.filas('select ultimo_latido, version_agente from public.impresoras')[0];
    assert.match(f.version_agente, /\d/);
    await hasta(async () => (await a.page.evaluate(() => Alpine.store('pos').cajaEnLinea)) === true, { limite: 15000, motivo: 'el admin ve la caja en línea (la lista se refresca cada 10 s)' });
    await a.page.getByText('En línea', { exact: true }).first().waitFor();
    await captura(a.page, 'integracion-1-admin-en-linea');
    nota('1_alta', { impresoraId, versionAgente: f.version_agente, tokenForma: 'imp_ + 64 hex', hashEnBase: true, tokenSoloUnaVez: true });
  });

  test('2 · camino feliz: orden → «Imprimir en la caja» → el agente lo toma por la señal → bytes y vista iguales al ticket de papel → «Impreso» en el POS', async () => {
    const { page, diag } = await abrirPos('mesero');
    await aOrden(page);
    await cajaLista(page, 'la caja está en línea (la confirmación de la precuenta ofrece «Imprimir en la caja»)');
    assert.match(await page.locator('.caja-estado:visible').first().innerText(), /Caja: en línea/);
    await captura(page, 'integracion-2-orden');

    // (a) Desde la orden
    const antes = agente1.bins().length;
    const t0 = Date.now();
    await precuentaACaja(page);
    await page.locator('.toast-impresion-fila').first().waitFor();
    assert.match(await avisoCaja(page), /Cuenta · Mesa 3/);
    await hasta(async () => /Impreso en la caja/.test(await avisoCaja(page)), { limite: 25000, motivo: '«Impreso en la caja» en el POS' });
    const ms = Date.now() - t0;
    await captura(page, 'integracion-2-impreso');
    assert.ok(ms < 30000, `salió mucho antes del sondeo de 60 s: tardó ${ms} ms`);
    assert.equal(await conteoPrint(page), 0, 'el teléfono no imprimió');
    await hasta(() => agente1.bins().length === antes + 1, { motivo: 'un .bin nuevo del agente' });

    let filas = await impresiones();
    assert.equal(filas.length, 1);
    assert.equal(filas[0].estado, 'impresa');
    assert.equal(filas[0].intentos, 1);
    assert.equal(filas[0].tipo, 'cuenta');
    assert.equal(filas[0].mesa_id, 3);
    assert.equal(filas[0].tomada_por, impresoraId);
    assert.equal(filas[0].creada_por, CORREO_MESERO, 'la base puso quién lo pidió');
    const espera = pila.pg.filas("select extract(epoch from (tomada_en - creada_en))::float8 as s from public.impresiones order by creada_en limit 1")[0].s;
    assert.ok(espera < 8, `lo tomó ${espera.toFixed(1)} s después de crearse: por la señal, no por el sondeo de 60 s`);
    assert.equal(filas[0].contenido.v, 1);
    const topico = `impresora:${pila.tokenHash(token1)}`;
    assert.ok(pila.hub.difundidas.some((s) => s.topico === topico && s.evento === 'trabajo'), 'el trigger avisó al tópico de la impresora');

    // (b) Desde el ticket: la precuenta en el teléfono (la salida de emergencia: con la caja en línea el botón de la orden ya no la ofrece, así que se
    // llama al mismo camino que usa «Imprimir aquí») y «Imprimir» (con su confirmación) sobre EL MISMO ticket, y se comparan
    await page.evaluate(() => Alpine.store('pos').imprimirPreCuenta());
    await enVista(page, 'ticket');
    await hasta(async () => (await conteoPrint(page)) === 1, { motivo: 'window.print() del ticket' });
    const papel = await ticketDePapel(page);
    await captura(page, 'integracion-2-ticket');
    assert.equal(await boton(page, 'Imprimir en la caja').count(), 0, 'el ticket trae UN «Imprimir»; «Imprimir en la caja» es del modal');
    await boton(page, 'Imprimir').click();
    await dialogo(page, 'Imprimir precuenta').waitFor();
    assert.match(await dialogo(page, 'Imprimir precuenta').innerText(), /¿Imprimir la precuenta en la caja\?/, 'el ticket que muestra la pantalla es una precuenta: la pregunta la llama como sale en el papel');
    await boton(page, 'Imprimir en la caja').click();
    await hasta(() => agente1.bins().length === antes + 2, { limite: 25000, motivo: 'el .bin del ticket' });
    await hasta(async () => /Impreso en la caja/.test(await avisoCaja(page)), { limite: 25000, motivo: '«Impreso» del ticket' });

    const bin = agente1.bins().at(-1);
    const bytes = fs.readFileSync(bin);
    const vista = bytesATexto(bytes, { columnas: 48, tablaEscPos: 2 });
    const enPapel = papel.map(norm);
    const enCaja = lineasDeVista(vista).map(norm);
    // Cada línea del ticket de papel está en la vista de texto del agente, y en el mismo orden
    let desde = 0;
    const faltan = [];
    for (const l of enPapel) {
      const i = enCaja.indexOf(l, desde);
      if (i === -1) faltan.push(l); else desde = i + 1;
    }
    assert.deepEqual(faltan, [], `lo que el ticket de papel dice y el de la caja no:\n--- papel\n${papel.join('\n')}\n--- caja\n${vista}`);
    assert.ok(enCaja.some((l) => /^total \$ 97\.000$/.test(l)), 'el TOTAL de la mesa 3');
    assert.ok(enCaja.some((l) => l.includes('2 x ejecutivo de la casa') && l.includes('$ 42.000')), 'el ítem con su precio a la derecha');
    assert.ok(enCaja.some((l) => l === 'sopa · pollo'), 'la sublínea de la variante');
    assert.ok(vista.includes('[ QR: https://resplandor.ynt.codes/ ]'), 'el QR de la web');
    assert.ok(vista.includes('✂ corte parcial'), 'el corte');
    assert.equal(bytes.subarray(0, 2).toString('hex'), '1b40', 'empieza con ESC @');
    assert.ok(bytes.includes(Buffer.from([0x1b, 0x74, 0x02])), 'tabla de caracteres PC850');
    // Las tildes y la ñ van en CP850 (0xa2 = ó, 0xa0 = á…), no en UTF-8
    assert.ok(!bytes.includes(Buffer.from('·', 'utf8')) && !bytes.includes(Buffer.from('é', 'utf8')), 'nada de UTF-8 en el papel');

    // (c) La prueba del admin (tipo «prueba»), desde su pantalla
    const { page: pa } = admin;
    await pa.reload({ waitUntil: 'load' });
    await esperarListo(pa);
    await aImpresora(pa);
    await hasta(async () => await boton(pa, 'Imprimir prueba').isEnabled(), { limite: 15000, motivo: '«Imprimir prueba» habilitado' });
    const antesPrueba = agente1.bins().length;
    await boton(pa, 'Imprimir prueba').click();
    await hasta(() => agente1.bins().length === antesPrueba + 1, { limite: 25000, motivo: 'el .bin de la prueba' });
    await hasta(async () => /Impreso en la caja/.test(await avisoCaja(pa)), { limite: 25000, motivo: '«Impreso» de la prueba' });
    const prueba = bytesATexto(fs.readFileSync(agente1.bins().at(-1)), { columnas: 48, tablaEscPos: 2 });
    assert.match(prueba, /Prueba/i);
    assert.ok(prueba.includes('[ QR:'));

    filas = await impresiones();
    assert.deepEqual(filas.map((f) => f.estado), ['impresa', 'impresa', 'impresa']);
    assert.deepEqual(filas.map((f) => f.tipo), ['cuenta', 'cuenta', 'prueba']);
    assert.ok(filas.every((f) => f.intentos === 1), 'ninguno se imprimió dos veces');
    assert.equal(agente1.bins().length, 3);
    assert.deepEqual(diag.errores.filter((e) => !/Failed to load resource/i.test(e)), [], 'sin errores propios en la consola del mesero');

    nota('2_camino_feliz', { msDeClicAImpreso: ms, segundosDeCreadaATomada: espera, bytes: bytes.length, lineasDelTicketDePapel: papel.length, lineasComparadas: enPapel.length, faltan, vista });
    if (EVIDENCIA) {
      fs.mkdirSync(EVIDENCIA, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCIA, 'ticket-papel-del-pos.txt'), papel.join('\n') + '\n');
      fs.writeFileSync(path.join(EVIDENCIA, 'ticket-caja-vista.txt'), vista);
      fs.copyFileSync(bin, path.join(EVIDENCIA, 'ticket-caja.bin'));
    }
    await page.context().close();
  });

  test('3 · sin la señal de Realtime el agente igual lo recoge, por el sondeo', async () => {
    await agente1.parar();
    guardarAgente(agente1, 'caja-1');
    pila.sinSenales = true;
    const a2 = arrancarAgente('sondeo', token1, { sondeoSegundos: 3, latidoSegundos: 10 });
    await a2.esperarLinea(/Esperando trabajos/);
    const base = a2.bins().length;
    const { estado, cuerpo } = await encolarComo('mesero', { contenido: docBueno('Solo por sondeo') });
    assert.equal(estado, 201, JSON.stringify(cuerpo));
    const t0 = Date.now();
    await hasta(() => a2.bins().length === base + 1, { limite: 20000, motivo: 'el sondeo de 3 s lo recoge' });
    const ms = Date.now() - t0;
    assert.ok(ms <= 9000, `el sondeo de 3 s tardó ${ms} ms`);
    await hasta(() => pila.pg.filas(`select estado from public.impresiones where id = '${cuerpo[0].id}'`)[0].estado === 'impresa', { motivo: 'confirmado en la base' });
    pila.sinSenales = false;
    nota('3_sin_senal', { sondeoSegundos: 3, msHastaImpreso: ms });
    await a2.parar();
    guardarAgente(a2, 'sondeo');
  });

  test('4 · agente apagado: sin latido «Imprimir precuenta» pregunta con la salida de emergencia («Imprimir aquí») y no encola nada; con el latido fresco el trabajo espera y el POS lo dice', async () => {
    // (a) Más de 90 s sin latido (se envejece el último latido: esperar 90 s de verdad no cambia nada)
    pila.pg.sql("update public.impresoras set ultimo_latido = now() - interval '3 minutes'");
    const filasAntes = (await impresiones()).length;
    const { page } = await abrirPos('mesero');
    await aOrden(page);
    await hasta(async () => /Caja: sin conexión/.test(await page.locator('.caja-estado:visible').first().innerText()), { limite: 10000, motivo: '«Caja: sin conexión»' });
    assert.equal(await boton(page, 'Imprimir en la caja').count(), 0, 'sin botón');
    const texto = await page.locator('.caja-estado:visible').first().innerText();
    assert.match(texto, /teléfono/, 'la línea explica que se imprime desde el teléfono');
    await captura(page, 'integracion-4-sin-conexion');
    await boton(page, 'Imprimir precuenta').click();
    await dialogo(page).waitFor();
    assert.match(await dialogo(page).innerText(), /La caja no está en línea \(última señal hace \d+ min\)\. Se imprime desde este teléfono\./);
    assert.equal(await conteoPrint(page), 0, 'nada sale sin confirmar');
    await captura(page, 'integracion-4-emergencia');
    await boton(page, 'Imprimir aquí').click();
    await enVista(page, 'ticket');
    await hasta(async () => (await conteoPrint(page)) === 1, { motivo: 'window.print() del teléfono' });
    assert.equal((await impresiones()).length, filasAntes, 'no se encoló nada');
    nota('4a_sin_latido', { texto, impresionesEnTelefono: 1, trabajosEncolados: 0 });
    await page.context().close();

    // (b) El agente murió hace poco (el latido sigue fresco): el POS ofrece la caja, el trabajo queda en cola y el POS lo dice
    const a3 = arrancarAgente('vuelve', token1, { sondeoSegundos: 3, latidoSegundos: 10 });
    await a3.esperarLinea(/Esperando trabajos/);
    await hasta(() => pila.pg.filas('select ultimo_latido > now() - interval \'30 seconds\' as fresco from public.impresoras')[0].fresco, { motivo: 'latido fresco' });
    const b = await abrirPos('mesero');
    await aOrden(b.page);
    await cajaLista(b.page, 'la caja con el latido fresco');
    await a3.parar('SIGKILL');                                           // sin avisar a nadie: como un PC al que le quitan la luz
    // Un sondeo que ya iba por el camino cuando murió todavía lo atiende la base y se llevaría el trabajo (quedaría «imprimiendo» 2 min):
    // se espera a que no quede ninguna petición en vuelo, como el cable que ya no tiene a nadie al otro lado.
    await hasta(() => pila.enVuelo === 0, { limite: 15000, motivo: 'que la base termine lo que el agente muerto dejó en el aire' });
    await esperar(300);
    const colaAntes = (await impresiones()).length;
    await precuentaACaja(b.page);
    await b.page.locator('.toast-impresion-fila').first().waitFor();
    const nuevo = await hasta(async () => (await impresiones()).length === colaAntes + 1 && (await impresiones()).at(-1), { motivo: 'el trabajo entró a la cola' });
    assert.equal(nuevo.estado, 'pendiente');
    await hasta(async () => /En cola en la caja/.test(await avisoCaja(b.page)), { limite: 10000, motivo: '«En cola en la caja…» (la base recibió el trabajo)' });
    await hasta(async () => /La caja no responde/.test(await avisoCaja(b.page)), { limite: 40000, cada: 500, motivo: '«La caja no responde» a los 25 s' });
    await captura(b.page, 'integracion-4-no-responde');
    const aviso = await avisoCaja(b.page);
    assert.match(aviso, /imprime desde este teléfono/);
    assert.equal(await conteoPrint(b.page), 0);
    assert.equal((await impresiones()).at(-1).estado, 'pendiente', 'sigue en cola');
    // El PC vuelve: lo toma y sale UNA vez, y el POS lo ve
    const a4 = arrancarAgente('vuelve2', token1, { sondeoSegundos: 3, latidoSegundos: 10 });
    await a4.esperarLinea(/Esperando trabajos/);
    await hasta(async () => /Impreso en la caja/.test(await avisoCaja(b.page)), { limite: 30000, motivo: '«Impreso» al volver el PC' });
    assert.equal(a4.bins().length, 1);
    assert.equal((await impresiones()).at(-1).intentos, 1);
    nota('4b_latido_fresco', { avisoAl25s: aviso, salioAlVolver: true });
    await a4.parar();
    guardarAgente(a4, 'vuelve2');
    await b.page.context().close();
  });

  test('5 · token rotado: el agente viejo deja de tomar (y lo dice), el trabajo espera y con el token nuevo sale una sola vez', async () => {
    const viejo = arrancarAgente('viejo', token1, { sondeoSegundos: 2, latidoSegundos: 10 });
    await viejo.esperarLinea(/Esperando trabajos/);
    await hasta(() => pila.pg.filas('select ultimo_latido is not null as late from public.impresoras')[0].late, { motivo: 'el viejo late' });

    // Rotar desde el POS del admin
    const { page: pa } = admin;
    await pa.reload({ waitUntil: 'load' });
    await esperarListo(pa);
    await aImpresora(pa);
    await boton(pa, 'Rotar token').click();
    await boton(pa, 'Sí, rotar').click();
    await pa.locator('.caja-token').waitFor();
    const token2 = await pa.locator('#caja-token').inputValue();
    assert.match(token2, /^imp_[0-9a-f]{64}$/);
    assert.notEqual(token2, token1);
    await captura(pa, 'integracion-5-rotado');
    assert.equal(pila.pg.filas('select token_hash from public.impresoras')[0].token_hash, pila.tokenHash(token2));
    assert.equal(pila.pg.filas('select ultimo_latido from public.impresoras')[0].ultimo_latido, null, 'tras rotar, la caja figura sin conexión de inmediato');

    // El viejo se entera y lo dice, sin caerse
    await viejo.esperarLinea(/no reconoce este token/, 30000);
    assert.ok(viejo.vivo(), 'el agente viejo sigue vivo (avisando)');

    // Un teléfono que aún creía que había caja encola; nadie lo toma
    const { estado, cuerpo } = await encolarComo('mesero', { contenido: docBueno('Esperando al agente nuevo'), impresora_id: impresoraId });
    assert.equal(estado, 201, JSON.stringify(cuerpo));
    await esperar(7000);                                                    // tres sondeos del viejo
    assert.equal(pila.pg.filas(`select estado from public.impresiones where id = '${cuerpo[0].id}'`)[0].estado, 'pendiente');
    assert.equal(viejo.bins().length, 0, 'el agente viejo no imprimió nada');

    const nuevo = arrancarAgente('nuevo', token2, { sondeoSegundos: 3, latidoSegundos: 10 });
    await hasta(() => nuevo.bins().length === 1, { limite: 25000, motivo: 'el agente nuevo imprime lo que esperaba' });
    await hasta(() => pila.pg.filas(`select estado, intentos from public.impresiones where id = '${cuerpo[0].id}'`)[0].estado === 'impresa', { motivo: 'confirmado' });
    assert.equal(pila.pg.filas(`select intentos from public.impresiones where id = '${cuerpo[0].id}'`)[0].intentos, 1);
    assert.equal(viejo.bins().length, 0);
    nota('5_token_rotado', { viejoDijo: viejo.lineas.find((l) => /no reconoce este token/.test(l))?.replace(/imp_[0-9a-f]+/g, '«token»') ?? null, viejoImprimio: 0, nuevoImprimio: 1 });
    token1 = token2;
    await viejo.parar();
    guardarAgente(viejo, 'viejo');
    agente1 = nuevo;
  });

  test('6 · dos agentes con el mismo token y 12 trabajos a la vez: ninguno sale dos veces', async () => {
    await agente1.parar();
    guardarAgente(agente1, 'nuevo');
    const A = arrancarAgente('dosA', token1, { sondeoSegundos: 2, latidoSegundos: 10 });
    const B = arrancarAgente('dosB', token1, { sondeoSegundos: 2, latidoSegundos: 10 });
    await Promise.all([A.esperarLinea(/Esperando trabajos/), B.esperarLinea(/Esperando trabajos/)]);
    const ya = (await impresiones()).length;
    const ids = [];
    // Doce teléfonos pulsando casi juntos (en paralelo)
    const respuestas = await Promise.all(Array.from({ length: 12 }, (_, i) => encolarComo('mesero', { contenido: docBueno(`Trabajo ${i + 1} de 12`) })));
    for (const r of respuestas) { assert.equal(r.estado, 201, JSON.stringify(r.cuerpo)); ids.push(r.id); }
    await hasta(() => pila.pg.filas(`select count(*)::int as n from public.impresiones where estado = 'impresa' and id in (${ids.map((i) => `'${i}'`).join(',')})`)[0].n === 12, { limite: 60000, motivo: 'los 12 impresos' });
    const filas = pila.pg.filas(`select id, intentos, tomada_por from public.impresiones where id in (${ids.map((i) => `'${i}'`).join(',')})`);
    assert.ok(filas.every((f) => f.intentos === 1 && f.tomada_por === impresoraId), 'cada trabajo se tomó una sola vez');
    await esperar(2500);                                                    // por si alguno se repitiera tras el último sondeo
    const deA = A.impresos();
    const deB = B.impresos();
    const interseccion = deA.filter((x) => deB.includes(x));
    assert.deepEqual(interseccion, [], 'ningún trabajo lo imprimieron los dos');
    assert.equal(new Set([...deA, ...deB]).size, deA.length + deB.length, 'ninguno repetido dentro de un mismo agente');
    assert.equal(deA.length + deB.length, 12);
    assert.equal(A.bins().length + B.bins().length, 12, 'doce papeles en total');
    assert.equal(ya + 12, (await impresiones()).length);
    nota('6_dos_agentes', { trabajos: 12, imprimioA: deA.length, imprimioB: deB.length, repetidos: 0, papeles: A.bins().length + B.bins().length });
    await Promise.all([A.parar(), B.parar()]);
    guardarAgente(A, 'dosA');
    guardarAgente(B, 'dosB');
  });

  test('7 · un trabajo malo no tumba al agente ni le manda comandos a la impresora; el siguiente bueno sale', async () => {
    const M = arrancarAgente('malo', token1, { sondeoSegundos: 2, latidoSegundos: 10 });
    await M.esperarLinea(/Esperando trabajos/);
    const hostil = {
      v: 1, titulo: '\u001b@PWNED\u001bdÿ\u001dVB',
      lineas: [
        { texto: 'Antes\u001bV\u0001\u001dVB\u001b@\u001b!ÿ\u001ct\u0001 después', der: '\u001b!\u0001\u001dV' },
        12345, null, true, ['anidado'],
        { texto: { objeto: 1 }, der: { x: 2 } },
        { texto: 'x'.repeat(5000) },
        { texto: 'tab\ty \u0007campana \u007f del \u0008 retroceso \u001b[2J', alinear: 'centro', negrita: true, doble: true, sangria: 999 },
        { texto: 'ñandú ÁÉÍÓÚ ¿¡€ 日本語 😀 ‮ rtl' },
        { texto: 'Gracias', columnas: 4 },
      ],
      qr: { texto: 'javascript:\u001b[2J\u001dVB', etiqueta: '\u001bV' },
      cortar: true,
    };
    const r1 = await encolarComo('mesero', { contenido: hostil, tipo: 'ticket' });
    assert.equal(r1.estado, 201, JSON.stringify(r1.cuerpo));
    const vacio = await encolarComo('mesero', { contenido: { lineas: [null] }, tipo: 'cuenta' });   // la base lo acepta (1 línea); el agente: «el documento está vacío»
    assert.equal(vacio.estado, 201, JSON.stringify(vacio.cuerpo));
    const bueno = await encolarComo('mesero', { contenido: docBueno('El bueno después de los malos') });
    assert.equal(bueno.estado, 201);

    await hasta(() => pila.pg.filas(`select estado from public.impresiones where id = '${bueno.id}'`)[0].estado === 'impresa', { limite: 40000, motivo: 'el bueno sale' });
    await hasta(() => ['impresa', 'error'].includes(pila.pg.filas(`select estado from public.impresiones where id = '${vacio.id}'`)[0].estado), { limite: 40000, motivo: 'el vacío termina (impreso o error)' });
    assert.ok(M.vivo(), 'el agente sigue vivo');
    const e1 = pila.pg.filas(`select estado, intentos, error from public.impresiones where id = '${r1.id}'`)[0];
    const e2 = pila.pg.filas(`select estado, intentos, error from public.impresiones where id = '${vacio.id}'`)[0];
    assert.equal(e1.estado, 'impresa', `el hostil se imprime filtrado: ${JSON.stringify(e1)}`);
    assert.equal(e1.intentos, 1);

    // Los bytes del hostil: ningún comando que no haya escrito el agente
    const bins = M.bins();
    const bytesHostil = fs.readFileSync(bins[0]);
    const vista = bytesATexto(bytesHostil, { columnas: 48, tablaEscPos: 2 });
    assert.ok(!vista.includes('‹0x'), `la vista no encontró comandos que el agente no escribió:\n${vista}`);
    const cuenta = (patron) => { let n = 0; for (let i = 0; i + patron.length <= bytesHostil.length; i++) if (patron.every((b, k) => bytesHostil[i + k] === b)) n++; return n; };
    assert.equal(cuenta([0x1b, 0x40]), 1, 'un solo ESC @ (el del arranque del agente)');
    assert.equal(cuenta([0x1d, 0x56]), 1, 'un solo corte (el del agente, al final)');
    assert.equal(cuenta([0x1b, 0x64]), 1, 'un solo avance de papel (el del agente, antes del corte)');
    assert.ok(vista.includes('PWNED'), 'el texto del hostil sí sale, como texto');
    assert.ok(vista.includes('ñandú ÁÉÍÓÚ'), 'tildes y ñ salen bien');
    assert.ok(bytesHostil.length < 8192, `${bytesHostil.length} bytes (el campo de 5000 caracteres se recortó)`);

    // Y el siguiente bueno está en el papel
    const bytesBueno = fs.readFileSync(bins.at(-1));
    assert.ok(bytesATexto(bytesBueno).includes('El bueno después de los malos'));
    nota('7_trabajo_malo', { hostil: e1, vacio: e2, agenteVivo: true, papeles: bins.length, bytesHostil: bytesHostil.length });
    if (EVIDENCIA) { fs.mkdirSync(EVIDENCIA, { recursive: true }); fs.writeFileSync(path.join(EVIDENCIA, 'trabajo-malo-vista.txt'), vista); fs.copyFileSync(bins[0], path.join(EVIDENCIA, 'trabajo-malo.bin')); }
    await M.parar();
    guardarAgente(M, 'malo');
  });

  test('8 · el tope de 30 por minuto: la base corta el que sobra, el POS cae al teléfono con un aviso y el mesero no se queda sin ticket', async () => {
    // El POS ya abierto en la orden y la caja en línea (un latido fresco, sin agente: aquí importa lo que hace la base con el que pasa del tope)
    pila.pg.sql('update public.impresoras set ultimo_latido = now()');
    const { page } = await abrirPos('mesero');
    await aOrden(page);
    await cajaLista(page, 'la caja figura en línea');
    // Treinta teléfonos pulsando seguidos: la base corta el que pasa de 30 en el minuto
    let rechazo = null;
    const ids = [];
    for (let i = 0; i < 45 && !rechazo; i++) {
      const r = await encolarComo('mesero', { contenido: docBueno(`Relleno ${i}`) });
      if (r.estado === 201) ids.push(r.id); else rechazo = r;
    }
    assert.ok(rechazo, 'la base cortó antes del trabajo 45 del minuto');
    assert.equal(rechazo.cuerpo.code, 'RS030');
    assert.match(rechazo.cuerpo.message, /demasiadas impresiones seguidas/);
    // Y para que la ventana de un minuto no se deslice mientras el POS actúa: quince trabajos más del mismo correo, puestos por el dueño (sin tope)
    const r = pila.pg.sql(`insert into public.impresiones (impresora_id, tipo, contenido, creada_por) select null, 'cuenta', '{"lineas":["relleno"]}'::jsonb, '${CORREO_MESERO}' from generate_series(1, 15)`);
    assert.ok(r.ok, r.error);
    const hay = (await impresiones()).length;
    await precuentaACaja(page);
    await hasta(async () => /Se imprime desde este teléfono/.test(await page.evaluate(() => Alpine.store('pos').aviso?.texto || '')), { limite: 15000, motivo: 'el aviso de que se imprime desde el teléfono' });
    const aviso = await page.evaluate(() => Alpine.store('pos').aviso.texto);
    await enVista(page, 'ticket');
    await hasta(async () => (await conteoPrint(page)) === 1, { motivo: 'window.print() del teléfono' });
    assert.equal((await impresiones()).length, hay, 'la base no aceptó el trabajo de más');
    assert.equal(await page.locator('.toast-impresion-fila').count(), 0, 'no queda un trabajo colgado en el aviso de la caja');
    await captura(page, 'integracion-8-tope');
    nota('8_tope_por_minuto', { aceptados: ids.length, rechazo: { estado: rechazo.estado, code: rechazo.cuerpo.code }, avisoDelPos: aviso, impresionesEnTelefono: 1 });
    // Lo que quedó en cola no debe salir en ninguna prueba posterior
    pila.pg.sql("update public.impresiones set estado = 'error', error = 'cancelada' where estado = 'pendiente'");
    await page.context().close();
  });

  test('9 · nada salió a internet: lo único que tocó el host de Supabase fue la pila local; ningún otro host externo se pidió', async () => {
    // Las páginas cerradas ya no se pueden consultar: lo que quedó anotado en cada `diag` vive en `resumen`; aquí se ve lo que
    // la pila vio y que el host de producción nunca llegó a la red (todo pasó por page.route / routeWebSocket).
    assert.ok(pila.peticiones.length > 20, 'la pila atendió peticiones del POS y de los agentes');
    assert.deepEqual(pila.noSoportadas, [], 'el POS no pidió nada que la pila no supiera hacer');
    const metodos = [...new Set(pila.peticiones.map((p) => `${p.metodo} ${p.ruta.split('?')[0].replace(/\/rpc\/.*/, '/rpc/…')}`))].sort();
    nota('9_peticiones_distintas', metodos);
    nota('9_realtime', { uniones: pila.uniones.length, tipos: [...new Set(pila.uniones.map((u) => u.topic.replace(/[0-9a-f]{64}/, '«hash»')))].sort(), señalesRepartidas: pila.hub.difundidas.length });
    assert.ok(pila.uniones.some((u) => u.vsn === 1 && /^realtime:impresora:/.test(u.topic)), 'el agente se unió a su tópico');
    assert.ok(pila.uniones.some((u) => u.vsn === 2 && u.topic === 'realtime:pos_impresiones'), 'el POS se unió al canal de impresiones');
    assert.deepEqual(diags.flatMap((d) => d.bloqueadas), [], 'ninguna petición a un host externo (todo lo del proyecto de Supabase fue a la pila local)');
    assert.equal(HOST_SUPABASE, 'lccgehvyymladqvumcez.supabase.co');
  });
});
