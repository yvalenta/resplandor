// «Personas y botones» + «Imprimir en la caja», sobre la ola C, DE PUNTA A PUNTA y todo local: el POS REAL (pos.html con su supabase-js, en
// Chromium a 390, 920 y 1440 px) → la base REAL (Postgres 17 con la cadena COMPLETA de migraciones, tablas y RPC con la RLS de verdad, a
// través del «PostgREST» de mentira de _pila-impresion.mjs) → el AGENTE REAL (impresora/agente.mjs, un proceso aparte en --simular).
// Lo que ninguna de las dos ramas probaba sola:
//
//   1. Tablero     la tarjeta «Impresora de la caja» (Sin configurar → alta desde «Configurar impresora» → Sin conexión → En línea con su
//                  último latido), sin entrada suelta en la barra
//   2. Personas    dividir la cuenta por persona con NOMBRES (Camila, Andrés) contra la base real: la nota de cada ítem lleva
//                  «— Persona 1 (Camila)» y el detalle desplegable dice qué lleva cada una
//   3. Caja        «Imprimir precuenta» → «¿Imprimir la precuenta en la caja?» → «Imprimir en la caja» (imprimir va SIEMPRE a la caja, con una
//                  confirmación): el .bin del agente lleva los nombres, no el sufijo guardado; el «Precuenta» de Andrés lleva SOLO sus líneas y
//                  su total; el cobro de Camila → «Imprimir» (→ «¿Imprimir el ticket en la caja?»): lleva «Cuenta de Camila» y el ticket de
//                  papel y el de la caja dicen lo mismo
//   4. Deshacer    «Cobrado $ X · Deshacer» (deshacer_cobro de verdad): la cuenta vuelve entera, con los nombres, y queda en `deshechos`
//   5. Cierre      el cierre del día con sus colores nuevos y lo que sumó la ola C: «Cobros deshechos hoy» (pastilla suave, tres filas),
//                  Facturada, Editar discreto y «Cerrar día» en el primario
//
// Solo corre con Docker y Playwright (Chromium) y Node ≥ 22; si no, se salta con el motivo. Con PILA_EVIDENCIA=<carpeta> deja las capturas,
// los .bin y su vista de texto, el ticket de papel frente al de la caja y un resumen JSON (sin config.json: ahí iría el token).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buscarDocker } from './_supabase-simulado.mjs';
import { buscarPlaywright } from './_navegador.mjs';
import { nuevoContexto, prepararPagina, esperarListo, servirPos } from './_pos-simulado.mjs';
import { levantarPila, CLAVE_PUBLICABLE } from './_pila-impresion.mjs';
import { bytesATexto } from '../../impresora/ticket/vista-texto.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const AGENTE = path.join(RAIZ, 'impresora', 'agente.mjs');
const docker = buscarDocker();
const pw = buscarPlaywright();
const SALTAR = docker.motivo || pw.motivo || (Number(process.versions.node.split('.')[0]) < 22 ? 'el agente pide Node ≥ 22' : false);
const EVIDENCIA = process.env.PILA_EVIDENCIA ? path.resolve(process.env.PILA_EVIDENCIA) : null;
const ANCHOS = [390, 920, 1440];

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

/** Un agente real (proceso aparte, --simular) con su carpeta, config.json y salida/. `base` es lo que arma el POS en «Copiar config.json». */
function arrancarAgente(nombre, token, base) {
  const carpeta = path.join(carpetaTrabajo, `agente-${nombre}`);
  fs.mkdirSync(carpeta, { recursive: true });
  const config = path.join(carpeta, 'config.json');
  fs.writeFileSync(config, JSON.stringify({
    ...base, supabaseUrl: pila.url, publishableKey: CLAVE_PUBLICABLE, token, impresora: 'IMPRESORA-SIMULADA', simular: true,
    sondeoSegundos: 60, latidoSegundos: 10, carpetaSalida: path.join(carpeta, 'salida'),
  }));
  const proceso = spawn(process.execPath, [AGENTE, '--config', config, '--simular'], { cwd: carpeta, stdio: ['ignore', 'pipe', 'pipe'] });
  const a = { nombre, proceso, carpeta, lineas: [] };
  const guardar = (d) => { for (const l of String(d).split('\n')) if (l.trim()) a.lineas.push(l); };
  proceso.stdout.on('data', guardar);
  proceso.stderr.on('data', guardar);
  a.cerrado = new Promise((r) => proceso.on('close', (code, senal) => r({ code, senal })));
  a.vivo = () => proceso.exitCode === null && proceso.signalCode === null;
  a.texto = () => a.lineas.join('\n');
  a.esperarLinea = (re, limite = 20000) => hasta(() => a.lineas.find((l) => re.test(l)), { limite, motivo: `una línea del agente ${nombre} con ${re}` }).catch((e) => { throw new Error(`${e.message}\n--- lo que dijo el agente:\n${a.texto().slice(-1500)}`); });
  a.bins = () => (fs.existsSync(path.join(carpeta, 'salida')) ? fs.readdirSync(path.join(carpeta, 'salida')).sort().filter((f) => f.endsWith('.bin')).map((f) => path.join(carpeta, 'salida', f)) : []);
  a.parar = async (senal = 'SIGTERM') => {
    if (a.vivo()) proceso.kill(senal);
    await Promise.race([a.cerrado, esperar(8000)]);
    if (a.vivo()) proceso.kill('SIGKILL');
  };
  agentes.push(a);
  return a;
}

/** Una persona del personal con el POS abierto, hablando con la pila (supabase-js real). */
async function abrirPos(persona, ancho) {
  const ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
  contextos.push(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
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
const dialogo = (page, nombre = /^Imprimir (precuenta|ticket)$/) => page.getByRole('dialog', { name: nombre });
const enVista = (page, v) => page.waitForFunction((x) => Alpine.store('pos').vista === x, v);
const limpio = (x) => String(x).replace(/\s+/g, ' ').trim();
const conteoPrint = (page) => page.evaluate(() => window.__posImpresiones || 0);
const aOrden = async (page, n = 3) => {
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) }).click();
  await enVista(page, 'orden');
  await page.locator('.menu-item').first().waitFor();
};
const aTablero = async (page) => {
  await page.locator('nav.nav-bar .nav-destinos .nav-link:has-text("Administración")').first().click();
  await enVista(page, 'admin');
  await page.locator('[data-tarjeta="impresora"]').waitFor({ state: 'visible', timeout: 20000 });
};
const aCierre = async (page) => {
  await page.locator('nav.nav-bar .nav-destinos .nav-link:has-text("Cierre")').first().click();
  await enVista(page, 'cierre');
  await page.locator('.bento-kpis').waitFor();
};
const avisoCaja = (page) => page.locator('.toast-impresion-fila').first().innerText().then(limpio).catch(() => '');
const captura = async (page, nombre, { completa = false } = {}) => {
  if (!EVIDENCIA) return;
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nombre}.png`), fullPage: completa }).catch(() => {});
};
/** ¿Lo que se ve en el centro del botón ES el botón? `boundingBox` solo dice dónde está: no si otra cosa (la barra de abajo, un aviso) lo tapa. */
const alcanzable = (page, nombre) => page.evaluate((n) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && x.textContent.replace(/\s+/g, ' ').trim() === n);
  if (!b) return { existe: false };
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { existe: true, arriba: !!el && (el === b || b.contains(el)), tapa: el ? (el.closest('button')?.textContent.replace(/\s+/g, ' ').trim() || String(el.className || el.tagName)) : null, y: Math.round(r.y), alto: Math.round(r.height), vh: innerHeight };
}, nombre);
const filasBd = (sql) => pila.pg.filas(sql);
/** Lo que dice la tarjeta «Dividir cuenta por persona»: { nombre: total }. El orden de las filas es el de los ítems en la cuenta (al deshacer, lo devuelto va al final). */
const personasDeLaTarjeta = async (page) => {
  const nombres = (await page.locator('.persona-nombre-txt').allInnerTexts()).map(limpio);
  const totales = (await page.locator('.persona-meta').allInnerTexts()).map(limpio);
  return Object.fromEntries(nombres.map((n, i) => [n, totales[i]]));
};

// WCAG 2.x sobre colores CALCULADOS por el navegador.
const rgb = (c) => { const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/); assert.ok(m, `color ilegible: ${c}`); return [m[1], m[2], m[3]].map(Number); };
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contraste = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** El ticket de papel del POS (lo que sale por window.print): una lista de líneas «izquierda derecha». */
async function ticketDePapel(page) {
  return page.evaluate(() => {
    const t = (e) => (e ? e.innerText.replace(/\s+/g, ' ').trim() : '');
    const raiz = document.querySelector('.print-zone .ticket');
    const L = [t(raiz.querySelector('.ticket-brand')), t(raiz.querySelector('.ticket-sub'))];
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
const lineasDeVista = (txt) => txt.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && !/^[-=_*.~#]{3,}$/.test(l) && !l.startsWith('[ QR:') && !l.includes('✂'));
const norm = (l) => l.toLowerCase().replace(/—/g, '-').replace(/\s+/g, ' ').trim();

describe('personas y botones + imprimir en la caja, de punta a punta, sobre la ola C', { skip: SALTAR }, () => {
  let token = null;
  let agente = null;
  const estadoTarjeta = (page) => page.locator('[data-tarjeta="impresora"] .tarjeta-admin-dato').innerText().then(limpio);
  const detalleTarjeta = (page) => page.locator('[data-tarjeta="impresora"] .tarjeta-admin-detalle').innerText().then(limpio);

  before(async () => {
    carpetaTrabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-integracion-'));
    pila = await levantarPila({ conCola: true });
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
      fs.writeFileSync(path.join(EVIDENCIA, 'resumen-integracion.json'), JSON.stringify(resumen, null, 2));
    }
    await pila?.parar().catch(() => {});
    if (carpetaTrabajo) fs.rmSync(carpetaTrabajo, { recursive: true, force: true });
  });

  test('1 · tablero: con la cola en la base y sin impresora, la tarjeta dice «Sin configurar» (a 390, 920 y 1440) y no hay entrada suelta en la barra', async () => {
    for (const ancho of ANCHOS) {
      const { page, ctx, diag } = await abrirPos('admin', ancho);
      await aTablero(page);
      assert.equal(await estadoTarjeta(page), 'Sin configurar');
      assert.match(await detalleTarjeta(page), /^Agrega la impresora del PC de la caja/);
      assert.equal(await page.locator('.tarjeta-admin:visible').count(), 9, 'nueve tarjetas con la de la impresora');
      assert.equal(await page.locator('nav.nav-bar').getByText('Impresora de la caja').count(), 0, 'la barra no tiene una entrada «Impresora»');
      assert.equal(await page.locator('#nav-mas').count(), 0, 'y «Más» ya no existe');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${ancho}: sin desborde`);
      await captura(page, `tablero-sin-configurar-${ancho}`, { completa: true });
      assert.deepEqual(diag.errores.filter((e) => !/Failed to load resource|404/i.test(e)), [], 'sin errores propios en la consola');
      await ctx.close();
    }
    nota('1_tablero_sin_configurar', { anchos: ANCHOS, tarjetas: 9, entradaSuelta: 0 });
  });

  test('2 · alta desde el tablero: «Configurar impresora» → el token sale una vez → «Sin conexión» hasta que el agente late → «En línea» con su último latido', async () => {
    const a = await abrirPos('admin', 1440);
    const { page } = a;
    await aTablero(page);
    await page.locator('[data-tarjeta="impresora"]').getByRole('button', { name: 'Configurar impresora', exact: true }).click();
    await enVista(page, 'impresora');
    assert.equal(await page.evaluate(() => Alpine.store('pos').enAdministracion), true, 'la entrada «Administración» sigue activa dentro de la vista');
    await page.locator('#caja-nombre').fill('Caja');
    await boton(page, 'Agregar impresora').click();
    await page.locator('.caja-token').waitFor();
    token = await page.locator('#caja-token').inputValue();
    assert.match(token, /^imp_[0-9a-f]{64}$/);
    await captura(page, 'impresora-token-1440');
    const filas = filasBd('select id, nombre, token_hash, ultimo_latido from public.impresoras');
    assert.equal(filas.length, 1);
    assert.equal(filas[0].token_hash, pila.tokenHash(token), 'la base guarda sha256(token), nunca el token');
    const configPos = JSON.parse(await page.evaluate(() => Alpine.store('pos').configAgente));
    assert.equal(configPos.token, token);
    await boton(page, 'Listo, ya lo copié').click();
    assert.equal(await page.evaluate(() => Alpine.store('pos').cajaToken), null, 'el token ya no está en memoria');
    // De vuelta al tablero: la impresora existe pero nadie ha latido.
    await page.locator('.volver-admin:visible').click();
    await enVista(page, 'admin');
    await hasta(async () => (await estadoTarjeta(page)) === 'Caja sin conexión', { motivo: 'la tarjeta dice «Caja sin conexión» con la impresora recién creada', limite: 20000 });
    assert.match(await detalleTarjeta(page), /^Aún no ha dado señal/);
    assert.equal(await page.locator('[data-tarjeta="impresora"]').evaluate((e) => e.classList.contains('destacada')), false, 'una caja apagada no pide nada');
    await captura(page, 'tablero-sin-conexion-1440', { completa: true });
    // El agente real arranca con el token y la tarjeta se enciende sola (se vuelve a leer cada 10 s mientras el tablero está a la vista).
    agente = arrancarAgente('caja', token, configPos);
    await agente.esperarLinea(/Esperando trabajos de impresión/);
    await hasta(async () => (await estadoTarjeta(page)) === 'Caja en línea', { motivo: 'la tarjeta dice «Caja en línea» (la lectura de 10 s del tablero)', limite: 30000 });
    assert.match(await detalleTarjeta(page), /^Última señal (ahora|hace \d+ s)$/);
    const punto = await page.locator('[data-tarjeta="impresora"] .status-dot').evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.equal(punto, 'rgb(42, 115, 138)', 'punto lleno turquesa');
    await captura(page, 'tablero-en-linea-1440', { completa: true });
    await a.ctx.close();
    for (const ancho of [390, 920]) {
      const b = await abrirPos('admin', ancho);
      await aTablero(b.page);
      await hasta(async () => (await estadoTarjeta(b.page)) === 'Caja en línea', { motivo: `Caja en línea a ${ancho} px`, limite: 20000 });
      assert.equal(await b.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${ancho}: sin desborde`);
      await captura(b.page, `tablero-en-linea-${ancho}`, { completa: true });
      await b.ctx.close();
    }
    nota('2_alta_desde_tablero', { tokenForma: 'imp_ + 64 hex', hashEnBase: true, tarjeta: ['Sin configurar', 'Caja sin conexión', 'Caja en línea'] });
  });

  test('3 · dividir por persona con nombres contra la base real: asignar, renombrar (Camila, Andrés) y abrir el detalle, a 390, 920 y 1440', async () => {
    const a = await abrirPos('mesero', 1440);
    const { page } = a;
    await aOrden(page, 3);
    // Los tres ítems: Ejecutivo ×2 → Persona 1, Empanadas → Persona 2, Limonada ×3 → Persona 1.
    const filas = page.locator('.order-item');
    assert.equal(await filas.count(), 3);
    // «Asignar a persona» es el único `.btn-enlace` SIN `.btn-enlace-llevar`: cada línea trae también «Para llevar» (para-llevar), y Playwright corta por modo estricto con dos.
    const asignar = async (i, veces) => { for (let k = 0; k < veces; k++) await filas.nth(i).locator('.btn-enlace').filter({ hasText: /^(Asignar a persona|Reasignar)$/ }).click(); };   // el enlace de la persona (la línea tiene también «Para llevar», el precio a mano y «Volver al precio de carta»)
    await asignar(0, 1); await asignar(1, 2); await asignar(2, 1);
    await page.locator('.persona-split').nth(1).waitFor();
    assert.equal(await page.locator('.persona-split').count(), 2);
    // Renombrar: un toque en el nombre abre el campo; Enter guarda en TODOS los ítems de la persona (RPC actualizar_nota_item, uno por ítem).
    const renombrar = async (i, nombre) => {
      await page.locator('.persona-split').nth(i).locator('.persona-nombre-btn').click();
      await page.locator('.persona-split').nth(i).locator('input.persona-campo').fill(nombre);
      await page.keyboard.press('Enter');
    };
    await renombrar(0, 'Camila');
    await renombrar(1, 'Andrés');
    await hasta(() => filasBd("select count(*)::int as n from public.ordenes o, jsonb_array_elements(o.items) i where o.id = 'ord-abierta-3' and i->>'nota' like '%(%)'")[0].n === 3, { motivo: 'los tres ítems con el nombre en la nota de la base', limite: 20000 });
    const notas = filasBd("select i->>'nombre' as nombre, i->>'nota' as nota from public.ordenes o, jsonb_array_elements(o.items) i where o.id = 'ord-abierta-3' order by i->>'nombre'");
    assert.deepEqual(notas.map((n) => n.nota).sort(), ['Persona 1 (Camila)', 'Persona 2 (Andrés)', 'Sopa · Pollo — Persona 1 (Camila)'], 'la base guarda «Persona N (Nombre)» al final de la nota: clave estable + nombre, sin migración');
    assert.deepEqual((await page.locator('.persona-nombre-txt').allInnerTexts()).map(limpio), ['Camila', 'Andrés']);
    assert.deepEqual((await page.locator('.persona-meta').allInnerTexts()).map(limpio), ['$ 81.000', '$ 16.000']);
    await page.locator('.persona-meta').first().click();
    await page.locator('.persona-detalle:visible').first().waitFor();
    assert.deepEqual((await page.locator('.persona-detalle:visible .persona-linea').allInnerTexts()).map(limpio), ['2 × Ejecutivo de la casa Sopa · Pollo $ 42.000', '3 × Limonada de coco $ 39.000']);
    assert.equal(await boton(page, 'Imprimir en la caja').count(), 0, 'la orden no trae un segundo botón de impresión');
    await captura(page, 'personas-detalle-1440');
    await a.ctx.close();
    for (const ancho of [390, 920]) {
      const b = await abrirPos('mesero', ancho);
      await aOrden(b.page, 3);
      assert.deepEqual((await b.page.locator('.persona-nombre-txt').allInnerTexts()).map(limpio), ['Camila', 'Andrés'], `${ancho}: los nombres sobreviven a una recarga (viven en la base)`);
      await b.page.locator('.persona-meta').first().click();
      await b.page.locator('.persona-detalle:visible').first().waitFor();
      assert.equal(await b.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${ancho}: sin desborde`);
      const cobro = await boton(b.page, 'Generar ticket y cobrar').boundingBox();
      assert.ok(cobro && cobro.y + cobro.height <= (ancho < 768 ? 844 : 900) + 1, `${ancho}: el cobro sigue a la vista`);
      const toque = await alcanzable(b.page, 'Generar ticket y cobrar');
      assert.ok(toque.existe && toque.arriba, `${ancho}: «Generar ticket y cobrar» se puede tocar (arriba de la nav y de todo): ${JSON.stringify(toque)}`);
      await captura(b.page, `personas-detalle-${ancho}`);
      await b.ctx.close();
    }
    nota('3_personas', { notasEnBase: notas.map((n) => n.nota), anchos: ANCHOS });
  });

  test('4 · «Imprimir precuenta» → confirmar: el agente imprime la cuenta con los NOMBRES; la precuenta de Andrés lleva solo lo suyo; el cobro de Camila lleva «Cuenta de Camila» y el papel dice lo mismo que la caja', async () => {
    const a = await abrirPos('mesero', 920);
    const { page } = a;
    await aOrden(page, 3);
    await hasta(() => page.evaluate(() => Alpine.store('pos').puedeImprimirEnCaja), { motivo: 'la caja está en línea', limite: 20000 });
    assert.equal(await boton(page, 'Imprimir en la caja').count(), 0, 'un solo botón de precuenta');
    await boton(page, 'Imprimir precuenta').click();
    await dialogo(page).waitFor();
    assert.match(limpio(await dialogo(page).innerText()), /¿Imprimir la precuenta en la caja\?/);
    assert.equal(await conteoPrint(page), 0, 'tocar el botón no imprime nada solo');
    assert.equal(filasBd('select count(*)::int as n from public.impresiones')[0].n, 0, 'ni manda nada solo');
    await captura(page, 'precuenta-confirma-920');
    const antes = agente.bins().length;
    await boton(page, 'Imprimir en la caja').click();
    await page.locator('.toast-impresion-fila').first().waitFor();
    assert.match(await avisoCaja(page), /Cuenta · Mesa 3/);
    await hasta(async () => /Impreso en la caja/.test(await avisoCaja(page)), { limite: 25000, motivo: '«Impreso en la caja»' });
    await captura(page, 'precuenta-impresa-920');
    await hasta(() => agente.bins().length === antes + 1, { motivo: 'el .bin de la precuenta' });
    const precuenta = bytesATexto(fs.readFileSync(agente.bins().at(-1)), { columnas: 48, tablaEscPos: 2 });
    if (EVIDENCIA) { fs.mkdirSync(EVIDENCIA, { recursive: true }); fs.writeFileSync(path.join(EVIDENCIA, 'precuenta-caja-vista.txt'), precuenta); fs.copyFileSync(agente.bins().at(-1), path.join(EVIDENCIA, 'precuenta-caja.bin')); }
    assert.match(precuenta, /Limonada de coco\n?\s*[\s\S]*Camila/, 'la precuenta nombra a Camila');
    assert.ok(/Sopa · Pollo - Camila/.test(precuenta) || /Camila/.test(precuenta), 'la nota con el nombre');
    assert.ok(/Andr/.test(precuenta), 'y a Andrés');
    assert.doesNotMatch(precuenta, /Persona 1 \(Camila\)|Persona 2 \(/, 'el sufijo guardado no sale al papel');
    const fila = filasBd('select tipo, estado, mesa_id from public.impresiones order by creada_en limit 1')[0];
    assert.deepEqual({ tipo: fila.tipo, estado: fila.estado, mesa: fila.mesa_id }, { tipo: 'cuenta', estado: 'impresa', mesa: 3 });

    // La precuenta de UNA persona (el botón «Precuenta» de la fila de Andrés): «¿Imprimir la precuenta de Andrés en la caja?», y el papel lleva SOLO sus
    // líneas, su total, «PRECUENTA - no es un cobro» y «Cuenta de Andrés · Mesa 3» (sin nada de Camila). Con la base real y el agente real.
    await captura(page, 'precuenta-persona-orden-920');
    await boton(page, 'Imprimir la precuenta de Andrés').click();
    await dialogo(page).waitFor();
    assert.match(limpio(await dialogo(page).innerText()), /¿Imprimir la precuenta de Andrés en la caja\?/);
    assert.match(limpio(await dialogo(page).innerText()), /Mesa 3 · 1 ítem · \$ 16\.000/);
    assert.equal(filasBd('select count(*)::int as n from public.impresiones')[0].n, 1, 'nada sale sin confirmar');
    await captura(page, 'precuenta-persona-confirma-920');
    await boton(page, 'Imprimir en la caja').click();
    await page.locator('.toast-impresion-fila').first().waitFor();
    assert.match(await avisoCaja(page), /Cuenta de Andrés · Mesa 3/);
    await hasta(() => agente.bins().length === antes + 2, { limite: 25000, motivo: 'el .bin de la precuenta de Andrés' });
    await hasta(async () => /Impreso en la caja/.test(await avisoCaja(page)), { limite: 25000, motivo: '«Impreso» de la precuenta de Andrés' });
    const vistaAndres = bytesATexto(fs.readFileSync(agente.bins().at(-1)), { columnas: 48, tablaEscPos: 2 });
    if (EVIDENCIA) { fs.writeFileSync(path.join(EVIDENCIA, 'precuenta-persona-caja-vista.txt'), vistaAndres); fs.copyFileSync(agente.bins().at(-1), path.join(EVIDENCIA, 'precuenta-persona-caja.bin')); }
    const lineasAndres = lineasDeVista(vistaAndres).map(norm);
    assert.ok(lineasAndres.includes('precuenta - no es un cobro'), `el encabezado de la precuenta de una persona:\n${vistaAndres}`);
    assert.ok(lineasAndres.includes('cuenta de andrés · mesa 3'), 'y «Cuenta de Andrés · Mesa 3»');
    assert.ok(lineasAndres.some((l) => l.includes('1 x empanadas de la casa') && l.includes('$ 16.000')), 'su única línea, con su precio');
    assert.ok(lineasAndres.some((l) => /^total \$ 16\.000$/.test(l)), 'su total');
    assert.equal(lineasAndres.some((l) => /limonada|ejecutivo|camila|cuenta de cobro/.test(l)), false, 'nada de las demás personas (ni «CUENTA DE COBRO»: ese es el encabezado de la cuenta entera)');
    assert.equal(lineasAndres.some((l) => /^mesa\b|^cuenta de\s{2,}/.test(l)), false, 'sin las filas «Mesa» y «Cuenta de»: lo dice la línea de arriba');
    const filaAndres = filasBd("select tipo, estado, mesa_id, orden_id from public.impresiones order by creada_en offset 1 limit 1")[0];
    assert.deepEqual({ tipo: filaAndres.tipo, estado: filaAndres.estado, mesa: filaAndres.mesa_id }, { tipo: 'cuenta', estado: 'impresa', mesa: 3 });
    assert.equal(filasBd('select count(*)::int as n from public.ordenes o, jsonb_array_elements(o.items) i where o.id = \'ord-abierta-3\'')[0].n, 3, 'la precuenta no saca nada de la cuenta (a diferencia de «Cobrar»)');

    // El cobro de Camila: ticket → «Imprimir» (el coral) → «¿Imprimir el ticket de Camila en la caja?» con «Cuenta de Camila».
    await boton(page, 'Cobrar a Camila').click();
    await enVista(page, 'ticket');
    assert.equal(limpio(await page.locator('.ticket-meta .meta-row', { hasText: 'Cuenta de' }).innerText()), 'Cuenta de Camila');
    assert.match(await boton(page, 'Imprimir').evaluate((e) => e.className), /btn-primary/, 'el único botón de imprimir es el coral');
    assert.equal(await boton(page, 'En este teléfono').count(), 0, 'sin «En este teléfono» como opción normal');
    assert.equal(await page.locator('.ticket-acciones .btn-primary:visible').count(), 1, 'un solo coral por pantalla');
    const papel = await ticketDePapel(page);
    await captura(page, 'ticket-camila-920');
    await boton(page, 'Imprimir').click();
    await dialogo(page, 'Imprimir ticket').waitFor();
    assert.match(limpio(await dialogo(page, 'Imprimir ticket').innerText()), /¿Imprimir el ticket de Camila en la caja\?/);
    await captura(page, 'ticket-camila-confirma-920');
    await boton(page, 'Imprimir en la caja').click();
    await hasta(() => agente.bins().length === antes + 3, { limite: 25000, motivo: 'el .bin del cobro de Camila' });
    await hasta(async () => /Impreso en la caja/.test(await avisoCaja(page)), { limite: 25000, motivo: '«Impreso» del cobro' });
    const bin = agente.bins().at(-1);
    const vista = bytesATexto(fs.readFileSync(bin), { columnas: 48, tablaEscPos: 2 });
    if (EVIDENCIA) {
      fs.writeFileSync(path.join(EVIDENCIA, 'ticket-camila-caja-vista.txt'), vista);
      fs.writeFileSync(path.join(EVIDENCIA, 'ticket-camila-papel-del-pos.txt'), papel.join('\n') + '\n');
      fs.copyFileSync(bin, path.join(EVIDENCIA, 'ticket-camila-caja.bin'));
    }
    // «Queda por pagar» (cobro parcial de una persona) lo dicen los dos; el ayudante del papel pone el TOTAL al final y la caja lo imprime después
    // del TOTAL, así que se comprueba aparte y el resto se compara en orden.
    const sinQueda = (l) => !/^queda por pagar/.test(l);
    assert.ok(papel.map(norm).includes('queda por pagar $ 16.000') && lineasDeVista(vista).map(norm).includes('queda por pagar $ 16.000'), 'los dos dicen lo que queda por pagar: $ 16.000 (lo de Andrés)');
    const enPapel = papel.map(norm).filter(sinQueda);
    const enCaja = lineasDeVista(vista).map(norm).filter(sinQueda);
    let desde = 0;
    const faltan = [];
    for (const l of enPapel) { const i = enCaja.indexOf(l, desde); if (i === -1) faltan.push(l); else desde = i + 1; }
    assert.deepEqual(faltan, [], `lo que el ticket de papel dice y el de la caja no:\n--- papel\n${papel.join('\n')}\n--- caja\n${vista}`);
    assert.ok(enCaja.includes('cuenta de camila'), 'la caja dice «Cuenta de Camila»');
    assert.ok(enCaja.some((l) => /^total \$ 81\.000$/.test(l)), 'el TOTAL de Camila');
    assert.equal((await ticketDePapel(page)).some((l) => /persona 1/i.test(l)), false, 'ni en el papel ni en la caja se repite «Persona 1»');
    // «Cobrado $ 81.000 · Deshacer»: el aviso del pulgar, con la cuenta regresiva.
    await hasta(() => page.locator('.deshacer-monto').isVisible(), { motivo: 'el aviso «Cobrado $ … · Deshacer»', limite: 10000 });
    assert.match(limpio(await page.locator('.deshacer-monto').innerText()), /^Cobrado \$ 81\.000$/);
    await captura(page, 'cobrado-deshacer-920');
    nota('4_caja', { precuentaConNombres: true, cuentaDeCamila: true, papelIgualQueCaja: true, trabajos: filasBd('select tipo, estado, intentos from public.impresiones order by creada_en') });
    await a.ctx.close();
  });

  test('5 · «Cobrado $ X · Deshacer» contra deshacer_cobro de verdad: la cuenta vuelve entera con sus nombres y queda en `deshechos` (a 390, 920 y 1440)', async () => {
    // El cobro de Camila de la prueba 4 sigue ahí (15 s de aviso ya vencidos): se deshace desde «Transacciones del turno» (sin ventana de tiempo).
    // Luego, a cada ancho: cobrar a Camila otra vez, ver el aviso, y deshacerlo con él.
    const admin = await abrirPos('admin', 1440);
    await aCierre(admin.page);
    await admin.page.locator('.devolver-btn').first().waitFor({ timeout: 20000 });
    await admin.page.locator('.devolver-btn').first().click();
    await boton(admin.page, 'Sí, deshacer el cobro').click();   // pide confirmar dentro de la página (sin confirm() nativo)
    await hasta(() => filasBd("select count(*)::int as n from public.deshechos")[0].n === 1, { motivo: 'el primer deshacer quedó registrado', limite: 20000 });
    await admin.ctx.close();
    let esperados = 1;
    for (const ancho of ANCHOS) {
      const a = await abrirPos('mesero', ancho);
      const { page } = a;
      await aOrden(page, 3);
      assert.deepEqual(await personasDeLaTarjeta(page), { Camila: '$ 81.000', Andrés: '$ 16.000' }, `${ancho}: la cuenta volvió con sus nombres y con todo lo de Camila`);
      await boton(page, 'Cobrar a Camila').click();
      await enVista(page, 'ticket');
      await hasta(() => page.locator('.deshacer-monto').isVisible(), { motivo: 'el aviso «Cobrado $ … · Deshacer»', limite: 10000 });
      assert.match(limpio(await page.locator('.deshacer-monto').innerText()), /^Cobrado \$ 81\.000$/);
      const geom = await page.locator('.toast-deshacer, .deshacer-monto').first().evaluate((e) => { const r = e.closest('[class*="toast"]')?.getBoundingClientRect() || e.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; });
      assert.ok(geom.x >= -0.5 && geom.x + geom.w <= ancho + 0.5, `${ancho}: el aviso cabe`);
      // Con «Cobrado · Deshacer» a la vista, «Imprimir» (el coral del ticket) y «Volver» siguen al alcance: ni el aviso ni la barra de abajo los tapan.
      for (const nombre of ['Imprimir', 'Volver', 'Deshacer']) {
        const q = await alcanzable(page, nombre);
        assert.ok(q.existe && q.arriba, `${ancho}: «${nombre}» se puede tocar con el aviso a la vista: ${JSON.stringify(q)}`);
      }
      await captura(page, `cobrado-deshacer-${ancho}`);
      const btn = page.getByRole('button', { name: /Deshacer/ }).first();
      assert.ok((await btn.boundingBox()).height >= 43.5, `${ancho}: «Deshacer» tocable`);
      await btn.click();
      esperados += 1;
      await hasta(() => filasBd('select count(*)::int as n from public.deshechos')[0].n === esperados, { motivo: `deshacer #${esperados} registrado`, limite: 20000 });
      await enVista(page, 'orden');
      assert.deepEqual(await personasDeLaTarjeta(page), { Camila: '$ 81.000', Andrés: '$ 16.000' }, `${ancho}: tras deshacer, la cuenta vuelve entera`);
      await a.ctx.close();
    }
    const abiertas = filasBd("select estado, jsonb_array_length(items)::int as n from public.ordenes where mesa_id = 3 and estado = 'abierta'");
    assert.deepEqual(abiertas.map((o) => o.n), [3], 'una sola cuenta abierta en la mesa 3, con sus 3 ítems');
    const notas = filasBd("select i->>'nota' as nota from public.ordenes o, jsonb_array_elements(o.items) i where o.mesa_id = 3 and o.estado = 'abierta'").map((n) => n.nota).sort();
    assert.deepEqual(notas, ['Persona 1 (Camila)', 'Persona 2 (Andrés)', 'Sopa · Pollo — Persona 1 (Camila)'], 'los nombres sobrevivieron al cobro y a deshacerlo');
    const d = filasBd('select tipo, monto, mesa_id from public.deshechos order by hecho_en');
    assert.equal(d.length, 4);
    assert.ok(d.every((x) => x.mesa_id === 3 && Number(x.monto) === 81000));
    nota('5_deshacer', { deshechos: d.length, cuentaAbierta: 'entera, con sus nombres' });
  });

  test('6 · el cierre del día con sus colores nuevos y lo que sumó la ola C («Cobros deshechos hoy», Facturada, Editar discreto, «Cerrar día»), a 390, 920 y 1440', async () => {
    // Una venta cobrada entera (Facturada) para que «Transacciones del turno» tenga filas: la mesa 3 completa.
    const c = await abrirPos('mesero', 920);
    await aOrden(c.page, 3);
    await boton(c.page, 'Generar ticket y cobrar').click();
    await boton(c.page, 'Sí, cobrar').click();
    await enVista(c.page, 'ticket');
    await hasta(() => filasBd("select count(*)::int as n from public.ordenes where mesa_id = 3 and estado = 'cerrada'")[0].n >= 1, { motivo: 'la venta quedó cerrada en la base', limite: 20000 });
    await c.ctx.close();
    for (const ancho of ANCHOS) {
      const a = await abrirPos('admin', ancho);
      const { page } = a;
      await aCierre(page);
      await page.locator('#deshechos-titulo').waitFor({ timeout: 20000 });
      await hasta(async () => (await page.locator('.deshecho-fila:visible').count()) === 4, { motivo: 'las cuatro filas de «Cobros deshechos hoy»', limite: 20000 });
      const estilo = (loc, props) => loc.first().evaluate((e, ps) => { const s = getComputedStyle(e); return Object.fromEntries(ps.map((p) => [p, s[p]])); }, props);
      // Total vendido manda: la única tarjeta oscura, con su cifra arroz.
      const principal = await estilo(page.locator('.bento-main'), ['backgroundColor']);
      assert.equal(principal.backgroundColor, 'rgb(10, 17, 18)', `${ancho}: tarjeta telón`);
      assert.ok(contraste((await estilo(page.locator('.bento-main .stat-value'), ['color'])).color, principal.backgroundColor) >= 4.5);
      // «Cobros deshechos hoy»: pastilla suave en tinte barro, no el maíz pleno de antes.
      const pastilla = page.locator('#deshechos-titulo + .chip');
      assert.match(limpio(await pastilla.innerText()), /^4 cobros · \$ 324\.000$/);
      const p = await estilo(pastilla, ['backgroundColor', 'color']);
      assert.equal(p.backgroundColor, 'rgb(243, 234, 226)', `${ancho}: tinte barro`);
      assert.ok(contraste(p.color, p.backgroundColor) >= 4.5, `${ancho}: contraste de la pastilla`);
      // Facturada: pastilla suave con su punto; Editar discreto sin subrayado; Cerrar día en el primario.
      const fact = await estilo(page.locator('.fila-tx .chip.green'), ['backgroundColor', 'color']);
      assert.equal(fact.backgroundColor, 'rgb(225, 234, 232)', `${ancho}: Facturada, tinte turquesa`);
      const editar = await estilo(page.locator('.fila-tx-der .btn-discreto'), ['textDecorationLine', 'color']);
      assert.equal(editar.textDecorationLine, 'none');
      assert.ok(contraste(editar.color, 'rgb(255, 253, 247)') >= 4.5);
      const cerrar = await estilo(boton(page, 'Cerrar día'), ['backgroundColor', 'color']);
      assert.deepEqual(cerrar, { backgroundColor: 'rgb(196, 62, 38)', color: 'rgb(255, 253, 247)' }, `${ancho}: «Cerrar día» en el primario nuevo`);
      assert.equal(await page.locator('.fila-tx-der .btn-enlace, #cierre-razon .btn-enlace, #cierre-viejo-aviso .btn-enlace').count(), 0, `${ancho}: ningún enlace coral subrayado en el cierre`);
      const tocables = await page.locator('section:visible button:visible').evaluateAll((l) => l.map((e) => ({ n: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })).filter((x) => x.h < 43 || x.w < 43));
      assert.deepEqual(tocables, [], `${ancho}: ningún control de menos de 44 px en el cierre`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${ancho}: sin desborde`);
      await captura(page, `cierre-${ancho}`, { completa: true });
      assert.deepEqual(a.diag.errores.filter((e) => !/Failed to load resource|404/i.test(e)), [], `${ancho}: sin errores de consola`);
      await a.ctx.close();
    }
    nota('6_cierre', { anchos: ANCHOS, deshechosHoy: 4, pastilla: 'tinte barro', cerrarDia: 'primario #C43E26' });
  });

  test('7 · los ajustes del ticket llegan al papel de la caja: el admin cambia el pie, apaga el QR o lo manda a otra dirección (RLS de verdad) y el .bin lo dice', async () => {
    // El admin cambia los ajustes con la RLS de verdad (solo el admin puede escribir `ajustes`).
    const cambiar = async (cambios) => {
      const ad = await abrirPos('admin', 920);
      assert.equal(await ad.page.evaluate((c) => Alpine.store('pos').guardarAjustes(c), cambios), true, 'el admin guardó los ajustes');
      await ad.ctx.close();
    };
    // La cuenta abierta de la mesa 6 (la 3 ya la cobró la prueba 6) y su precuenta a la caja; devuelve la vista de texto del .bin.
    const precuentaALaCaja = async () => {
      const m = await abrirPos('mesero', 920);
      const { page } = m;
      await aOrden(page, 6);
      await hasta(() => page.evaluate(() => Alpine.store('pos').puedeImprimirEnCaja), { motivo: 'la caja está en línea', limite: 20000 });
      const antes = agente.bins().length;
      await boton(page, 'Imprimir precuenta').click();
      await dialogo(page).waitFor();
      await boton(page, 'Imprimir en la caja').click();
      await hasta(() => agente.bins().length === antes + 1, { motivo: 'el .bin de la precuenta con los ajustes nuevos', limite: 25000 });
      await hasta(async () => /Impreso en la caja/.test(await avisoCaja(page)), { limite: 25000, motivo: '«Impreso»' });
      const texto = bytesATexto(fs.readFileSync(agente.bins().at(-1)), { columnas: 48, tablaEscPos: 2 });
      await m.ctx.close();
      return texto;
    };
    // De fábrica: «Gracias por su visita» y el QR de resplandor.ynt.codes.
    const fabrica = await precuentaALaCaja();
    assert.match(fabrica, /Gracias por su visita/);
    assert.match(fabrica, /\[ QR: https:\/\/resplandor\.ynt\.codes\/ \]/);
    // Pie nuevo y QR apagado: el papel de la caja dice el pie nuevo y NO lleva QR (antes imprimía el de fábrica).
    await cambiar({ ticketPie: 'Martes 2x1 en jugos', ticketQrVisible: false });
    assert.deepEqual(filasBd('select ticket_pie, ticket_qr_visible from public.ajustes')[0], { ticket_pie: 'Martes 2x1 en jugos', ticket_qr_visible: false });
    const apagado = await precuentaALaCaja();
    assert.match(apagado, /Martes 2x1 en jugos/);
    assert.doesNotMatch(apagado, /Gracias por su visita/);
    assert.doesNotMatch(apagado, /\[ QR:/, 'con el QR apagado la caja no imprime QR');
    // QR encendido hacia otra dirección: el .bin lleva ESA dirección.
    await cambiar({ ticketQrVisible: true, ticketQrUrl: 'https://g.page/r/resplandor-resena' });
    const otra = await precuentaALaCaja();
    assert.match(otra, /\[ QR: https:\/\/g\.page\/r\/resplandor-resena \]/);
    assert.match(otra, /g\.page\/r\/resplandor-resena/, 'con su etiqueta corta');
    if (EVIDENCIA) { fs.writeFileSync(path.join(EVIDENCIA, 'ajustes-caja-apagado-vista.txt'), apagado); fs.writeFileSync(path.join(EVIDENCIA, 'ajustes-caja-otra-direccion-vista.txt'), otra); }
    // Se deja como estaba.
    await cambiar({ ticketPie: 'Gracias por su visita', ticketQrUrl: 'https://resplandor.ynt.codes/' });
    nota('7_ajustes_en_la_caja', { fabrica: 'pie y QR de siempre', apagado: 'pie nuevo, sin QR', otraDireccion: 'g.page/r/resplandor-resena' });
  });
});
