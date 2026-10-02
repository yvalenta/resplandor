// Integración de «personas, un solo cobro y botones» (tarea/pos-personas-botones) con «Imprimir en la caja» (tarea/impresion-caja), los dos
// encima de la ola C (f9b2625). Lo que las dos ramas, escritas por separado, no podían probar:
//
//   1. La impresora de la caja es una TARJETA del tablero de Administración (el gancho de docs/pos-visual.md §0.20), no una entrada suelta
//      de la navegación: «En línea» / «Sin conexión» con el último latido, «Sin configurar», y «Configurar impresora» abre su vista.
//   2. Una sola precuenta: «Imprimir precuenta» es el ÚNICO botón; con la caja en línea abre «En la caja / En este teléfono». El ticket del
//      cobro ofrece la caja primero (el coral) y «En este teléfono» al lado. Nada se manda solo.
//   3. El documento que va a la caja lleva lo mismo que el ticket de pantalla: el nombre de la persona («Cerdo — Camila», nunca
//      «Persona 1 (Camila)») y «Cuenta de Camila» en el cobro de una persona.
//   4. La migración de la cola es la última del directorio (20261003140000, después de la de la carta, 20261003130000).
//
// Tres partes: A. LÓGICA (corre siempre; el <script> real de pos.html en un vm), B. MARCADO (siempre), C. EN NAVEGADOR (Chromium con el arnés
// de Supabase simulado; se salta con el motivo si no hay).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { asentar, crearBaseFalsa, crearPos, mesaBase, ordenBase, plano } from './_pos-vm.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const MARCADO = POS.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');

// ═════════════════════════ A. lógica ═════════════════════════

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const CAJA = { id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: new Date(Date.now() - 12000).toISOString(), version_agente: '1.0.0' };
const conNota = (id, precio, qty, nota, nombre) => ({ id, nombre: nombre || id, precio, qty, nota });
const PEDIDO = () => [
  conNota('a', 21000, 1, 'Sin cebolla — Persona 1 (Camila)', 'Ejecutivo de la casa'),
  conNota('b', 13000, 1, 'Persona 1 (Camila)', 'Limonada de coco'),
  conNota('c', 16000, 2, 'Persona 2', 'Empanadas de la casa'),
  conNota('d', 9000, 1, '', 'Jugo natural'),
];

function montar({ rol = 'admin', impresoras = [CAJA], items = PEDIDO() } = {}) {
  const base = crearBaseFalsa({ rol, mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, items)], impresoras });
  const relojes = [];
  const extras = { setTimeout: (fn, ms) => relojes.push({ fn, ms }) && relojes.length, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} };
  const t = crearPos({ base, extras, documento: { title: 'Resplandor — POS', visibilityState: 'visible' } });
  t.base = base;
  t.pos.usuario = YO;
  t.pos.imprimir = () => {};
  return t;
}
async function arrancar(t) {
  await t.pos.arrancarApp();
  await asentar();
  t.pos.mesaActiva = t.pos.mesas.find((m) => m.id === 3) || null;
  t.pos.ordenActiva = t.pos.ordenes.find((o) => o.id === 'o1') || null;
  t.pos.vista = 'orden';
  return t;
}
const texto = (doc, t) => doc.lineas.find((l) => l.texto === t);

test('documento: la precuenta que va a la caja dice el nombre de la persona («Sin cebolla — Camila»), como el ticket de pantalla, y no el sufijo guardado', async () => {
  const t = await arrancar(montar());
  assert.equal(await t.pos.imprimirCuentaEnCaja(), true);
  const [fila] = [...t.base.impresiones.values()];
  const lineas = fila.contenido.lineas;
  const sangradas = lineas.filter((l) => l.sangria === 2 && !/^c\/u /.test(l.texto)).map((l) => l.texto);
  assert.ok(sangradas.includes('Sin cebolla - Camila'), `la nota con la persona por su nombre, con el guion del papel (${sangradas.join(' | ')})`);
  assert.ok(sangradas.includes('Camila'), 'un ítem que solo trae la persona dice su nombre');
  assert.ok(sangradas.includes('Persona 2'), 'una persona sin nombre sigue siendo «Persona 2»');
  assert.equal(lineas.some((l) => /\(Camila\)/.test(l.texto)), false, 'el paréntesis del sufijo no sale al papel');
  // La misma regla que el ticket de pantalla (notaTxt del <body>): lo que se imprime en papel y en la caja coincide.
  const items = t.pos.ordenActiva.items;
  assert.deepEqual(plano(items.map((i) => t.pos._notaTicketTxt(i, { items }))), plano(items.map((i) => t.pos.notaLegible(i, true, items))));
});

test('documento: el cobro de UNA persona dice «Cuenta de Camila» y no repite su nombre en cada línea, igual que el ticket de pantalla', async () => {
  const t = await arrancar(montar());
  t.pos.cobrarGrupoPersona('Persona 1');
  await asentar();
  const tk = t.pos.ticketMostrado;
  assert.equal(tk.persona, 'Camila');
  const doc = t.pos.documentoTicket(tk, 'ticket');
  assert.deepEqual(plano(texto(doc, 'Cuenta de')), { texto: 'Cuenta de', der: 'Camila' }, 'la fila «Cuenta de» como en pantalla');
  const iMesa = doc.lineas.findIndex((l) => l.texto === 'Mesa');
  assert.equal(doc.lineas[iMesa + 1].texto, 'Cuenta de', 'va justo después de la mesa (como en el ticket de pantalla)');
  assert.deepEqual(plano(doc.lineas.filter((l) => l.sangria === 2).map((l) => l.texto)), ['Sin cebolla'], 'solo la nota del ítem: la persona ya está arriba');
  assert.equal(texto(doc, 'TOTAL').der, '$ 34.000');
  // La cuenta entera (sin persona) no trae la fila.
  const entera = t.pos.documentoTicket({ ...t.pos.ordenActiva, items: t.pos.ordenActiva.items, total: 1, cerradaEn: new Date().toISOString(), esPreCuenta: true }, 'cuenta');
  assert.equal(texto(entera, 'Cuenta de'), undefined);
});

test('tablero: sin la cola en la base la tarjeta «Impresora de la caja» no existe; con la cola dice En línea / Sin conexión / Sin configurar', async () => {
  const sinCola = await arrancar(montar({ impresoras: null }));
  assert.equal(sinCola.pos.impresora, null);
  assert.equal(sinCola.pos.tieneImpresora, false, 'sin la migración nadie ve la tarjeta');

  const enLinea = await arrancar(montar());
  assert.equal(enLinea.pos.tieneImpresora, true);
  const a = plano({ ...enLinea.pos.tableroImpresora });
  assert.deepEqual({ texto: a.texto, tono: a.tono, estado: a.estado, destacada: a.destacada }, { texto: 'En línea', tono: 'ok', estado: 'en_linea', destacada: false });
  assert.match(a.detalle, /^Caja · Último latido hace \d+ s$/, 'el último latido del agente como dato vivo');

  const apagada = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false, ultimo_latido: new Date(Date.now() - 7 * 60000).toISOString() }] }));
  const b = plano({ ...apagada.pos.tableroImpresora });
  assert.deepEqual({ texto: b.texto, tono: b.tono, estado: b.estado }, { texto: 'Sin conexión', tono: 'off', estado: 'sin_conexion' });
  assert.match(b.detalle, /^Caja · Último latido hace 7 min\. Mientras tanto, las cuentas salen del teléfono\.$/);

  const nunca = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false, ultimo_latido: null }] }));
  assert.match(nunca.pos.tableroImpresora.detalle, /^Caja · Aún no ha latido\./);

  const vacia = await arrancar(montar({ impresoras: [] }));
  assert.equal(vacia.pos.tieneImpresora, true, 'con la cola y sin impresora el admin la ve para configurarla');
  const c = plano({ ...vacia.pos.tableroImpresora });
  assert.deepEqual({ texto: c.texto, tono: c.tono, estado: c.estado }, { texto: 'Sin configurar', tono: '', estado: 'sin_configurar' });
  assert.match(c.detalle, /^Agrega la impresora del PC de la caja/);

  const dos = await arrancar(montar({ impresoras: [CAJA, { ...CAJA, id: 'impresora-2', nombre: 'Cocina', en_linea: false }] }));
  assert.match(dos.pos.tableroImpresora.detalle, /· \+1 más$/, 'con dos, lo dice (el POS manda a la primera en línea)');
  // Nada de esto cuenta como «algo que pide al admin»: una caja apagada de noche no enciende la insignia del nav.
  assert.equal(apagada.pos.tableroImpresora.destacada, false);
  assert.equal(apagada.pos.numAtencionAdmin, enLinea.pos.numAtencionAdmin);
});

test('tablero: el estado de la tarjeta sigue a la caja (se enciende y se apaga con cada lectura) y se olvida al cerrar la sesión', async () => {
  const t = await arrancar(montar());
  assert.equal(t.pos.tableroImpresora.texto, 'En línea');
  t.base.impresoras[0].en_linea = false;
  await t.pos.cargarEstadoCaja();
  assert.equal(t.pos.tableroImpresora.texto, 'Sin conexión');
  t.base.impresoras[0].en_linea = true;
  await t.pos.cargarEstadoCaja();
  assert.equal(t.pos.tableroImpresora.texto, 'En línea');
  t.pos.cerrarSesion();
  await asentar();
  assert.equal(t.pos.impresora, null, 'otra persona en esta tablet no hereda la tarjeta');
  assert.equal(t.pos.tieneImpresora, false);
});

test('permisos: irA(\'impresora\') es del admin (el mismo permiso del tablero) y deja la vista dentro de Administración; el mesero no entra', async () => {
  const admin = await arrancar(montar());
  assert.equal(admin.pos.irA('impresora'), true);
  assert.equal(admin.pos.vista, 'impresora');
  assert.equal(admin.pos.enAdministracion, true, 'la entrada «Administración» sigue activa dentro de la impresora');
  assert.equal(admin.pos.irA('admin'), true);
  const mesero = await arrancar(montar({ rol: 'mesero' }));
  assert.equal(mesero.pos.irA('impresora'), false);
  assert.notEqual(mesero.pos.vista, 'impresora');
  // Sigue pudiendo imprimir en la caja (la elección de la precuenta es de todo el personal).
  assert.equal(mesero.pos.puedeImprimirEnCaja, true);
});

test('tablero: abrir el tablero vuelve a preguntar por la caja (la tarjeta no muestra un latido viejo)', async () => {
  const t = await arrancar(montar());
  const antes = t.supabase.rpcs('impresora_estado').length;
  t.pos.rol = 'admin';
  await t.pos.cargarTablero();
  assert.ok(t.supabase.rpcs('impresora_estado').length > antes, 'cargarTablero pide impresora_estado');
});

// ═════════════════════════ B. marcado ═════════════════════════

test('marcado: la impresora no tiene entrada propia en la navegación (ni «Más», ni un link): solo la tarjeta del tablero, el aviso del indicador y la vuelta', () => {
  const nav = POS.slice(POS.indexOf('<nav class="nav-bar'), POS.indexOf('</nav>')).replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(nav, /vista = 'impresora'|irA\('impresora'\)/, 'la barra no abre la vista de la impresora');
  assert.doesNotMatch(POS, /id="nav-mas"/, 'ya no existe «Más»');
  assert.doesNotMatch(MARCADO, /vista = 'impresora'/, 'ningún botón fija la vista a mano: todos pasan por irA (con su permiso)');
  const entradas = [...MARCADO.matchAll(/irA\('impresora'\)/g)].length;
  assert.equal(entradas, 2, 'solo el título y la acción de la tarjeta «Impresora de la caja»');
  const tarjeta = MARCADO.slice(MARCADO.indexOf('data-tarjeta="impresora"'), MARCADO.indexOf('</article>', MARCADO.indexOf('data-tarjeta="impresora"')));
  assert.match(tarjeta, /Configurar impresora/);
  assert.match(tarjeta, /x-text="t\.texto"/);
  assert.match(tarjeta, /x-text="t\.detalle"/);
  assert.match(POS, /const VISTAS_ADMIN = \[[^\]]*'impresora'\]/, 'la impresora cuelga de Administración');
  const vista = POS.indexOf(`<section x-show="$store.pos.vista === 'impresora' && $store.pos.puede('impresora')"`);
  assert.ok(vista !== -1 && POS.slice(vista, vista + 2600).includes('class="volver-admin"'), 'la vista lleva «‹ Administración» arriba');
  // El indicador de la barra solo dice el estado (el aviso ofrece «Configurar» al admin).
  const indicador = POS.slice(POS.indexOf('class="btn-icon nav-caja'), POS.indexOf('class="btn-icon nav-caja') + 500);
  assert.match(indicador, /@click="\$store\.pos\.abrirImpresoraCaja\(\)"/);
  assert.doesNotMatch(indicador, /active/, 'no es una pestaña: no se marca activa');
});

test('marcado: un solo camino por tipo de impresión — la precuenta es UN botón y la caja se elige dentro; el ticket tiene «Imprimir en la caja» y «En este teléfono»', () => {
  const orden = MARCADO.slice(MARCADO.indexOf(`<section x-show="$store.pos.vista === 'orden'"`), MARCADO.indexOf('<!-- ▲ PARTE orden -->') === -1 ? undefined : undefined);
  const hasta = orden.indexOf('class="grid grid-cols-1 gap-4');
  const cabeza = orden.slice(0, hasta === -1 ? undefined : hasta);
  assert.equal((cabeza.match(/imprimirCuentaEnCaja\(\)/g) || []).length, 1, 'la caja se alcanza desde un solo sitio de la orden: la elección de destino de la precuenta');
  assert.equal((cabeza.match(/imprimirPreCuenta\(\)/g) || []).length, 2, '«Imprimir precuenta» (sin caja) y «En este teléfono» (con caja)');
  assert.doesNotMatch(cabeza, />\s*Imprimir en la caja\s*</, 'no hay un segundo botón «Imprimir en la caja» en la orden');
  const destino = cabeza.slice(cabeza.indexOf('id="precuenta-destino"'), cabeza.indexOf('id="precuenta-destino"') + 900);
  assert.match(destino, /role="group" aria-label="Dónde imprimir la precuenta"/);
  assert.match(destino, /En la caja[\s\S]*?En este teléfono/);
  assert.match(cabeza, /aria-controls="precuenta-destino"/);
  assert.match(cabeza, /:aria-expanded="\$store\.pos\.puedeImprimirEnCaja \? String\(eligiendoPrecuenta\) : null"/);
  const ticket = MARCADO.slice(MARCADO.indexOf('class="ticket-acciones'), MARCADO.indexOf('class="ticket-acciones') + 2200);
  assert.match(ticket, /imprimirTicketEnCaja\(\)[\s\S]*?Imprimir en la caja/);
  assert.match(ticket, /imprimirEnTelefono\(\)[\s\S]*?'En este teléfono' : 'Imprimir'/);
  assert.equal((ticket.match(/btn-primary/g) || []).length, 2, 'dos clases btn-primary en el marcado, pero una sola visible: el del teléfono solo es coral sin caja');
});

test('marcado: «Imprimir precuenta» sigue siendo el de siempre sin la caja y no manda nada con solo tocarlo (la elección es explícita)', async () => {
  const t = await arrancar(montar({ impresoras: [CAJA] }));
  // Con la caja en línea no hay un envío automático: solo las dos acciones explícitas escriben en la cola.
  assert.equal(t.supabase.de('impresiones', 'insert').length, 0);
  assert.equal(t.pos.puedeImprimirEnCaja, true);
  const sin = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false }] }));
  assert.equal(sin.pos.puedeImprimirEnCaja, false, 'sin caja en línea el botón imprime directo (la orden no abre elección)');
});

test('migración: la cola de impresión es la última del directorio y va después de la de la carta (20261003130000 < 20261003140000)', () => {
  const nombres = fs.readdirSync(path.join(RAIZ, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  assert.equal(nombres.at(-1), '20261003140000_cola_impresion.sql');
  assert.ok(nombres.indexOf('20261003130000_carta_etiqueta_y_promos.sql') < nombres.indexOf('20261003140000_cola_impresion.sql'));
  assert.equal(nombres.filter((f) => f.startsWith('20261003120000')).length, 0, 'el nombre viejo ya no existe en el directorio');
  assert.equal(nombres.filter((f) => /cola_impresion/.test(f)).length, 1);
});

// ═════════════════════════ C. en navegador ═════════════════════════

const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
const DIR_CACHE = process.env.POS_CDN_CACHE || undefined;
let servidor = null;
let navegador = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});
async function abrir(t, vista, ancho, opciones = {}) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const { diag } = await abrirPos(page, { url: servidor.url, vista, dirCache: DIR_CACHE, ...opciones });
    return { page, diag, ctx };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const reposo = (page) => page.waitForTimeout(200);
const limpio = (x) => String(x).replace(/\s+/g, ' ').trim();
const hace = (min) => new Date(Date.parse('2026-09-30T13:30:00-05:00') - min * 60000).toISOString();
const CAJA_SIM = (extra = {}) => (d) => { d.impresoras = [{ id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: hace(0.2), version_agente: '1.0.0', ...extra }]; };
const impresiones = (page) => page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.insert' && l.tabla === 'impresiones').map((l) => l.carga));
const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contraste = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const ancho of [390, 920, 1440]) {
  test(`navegador ${ancho} px: la tarjeta «Impresora de la caja» del tablero dice En línea / Sin conexión / Sin configurar con su último latido, cabe, y «Configurar impresora» abre su vista con la vuelta`, { skip: SALTAR }, async (t) => {
    // En línea
    const a = await abrir(t, 'admin-impresora', ancho); if (!a) return;
    const { page } = a;
    const tarjeta = page.locator('[data-tarjeta="impresora"]');
    assert.equal(limpio(await tarjeta.locator('.tarjeta-admin-dato').innerText()), 'En línea');
    assert.match(limpio(await tarjeta.locator('.tarjeta-admin-detalle').innerText()), /^Caja · Último latido hace \d+ s$/);
    const punto = await tarjeta.locator('.status-dot').evaluate((e) => { const c = getComputedStyle(e); return { fondo: c.backgroundColor, ancho: c.width }; });
    assert.equal(punto.fondo, 'rgb(42, 115, 138)', 'punto lleno turquesa');
    const accion = tarjeta.getByRole('button', { name: 'Configurar impresora', exact: true });
    assert.ok((await accion.boundingBox()).height >= 43.5, 'tocable');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde en el tablero');
    const caja = await tarjeta.boundingBox();
    assert.ok(caja.x >= -0.5 && caja.x + caja.width <= ancho + 0.5, 'la tarjeta cabe');
    assert.equal(await page.locator('.tarjeta-admin:visible').count(), 9, 'nueve tarjetas con la de la impresora');
    // Sin entrada suelta: la barra no tiene un destino «Impresora» ni «Más».
    assert.equal(await page.locator('nav.nav-bar').getByText(/Impresora de la caja/).count(), 0);
    await accion.click();
    await page.waitForFunction(() => Alpine.store('pos').vista === 'impresora');
    await page.locator('section:visible h1', { hasText: 'Impresora de la caja' }).waitFor();
    assert.equal(await page.evaluate(() => Alpine.store('pos').enAdministracion), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde en la vista');
    // Crear la impresora desde el tablero → su token, una sola vez; y al volver al tablero ya no está.
    await page.locator('#caja-nombre').fill('Caja 2');
    await boton(page, 'Agregar impresora').click();
    await page.locator('.caja-token').waitFor();
    assert.match(await page.locator('.caja-token h2').innerText(), /Token de «Caja 2»/);
    await page.locator('.volver-admin:visible').click();
    await page.waitForFunction(() => Alpine.store('pos').vista === 'admin');
    assert.equal(await page.evaluate(() => Alpine.store('pos').cajaToken), null, 'el token se olvida al salir de la vista');
    assert.match(limpio(await page.locator('[data-tarjeta="impresora"] .tarjeta-admin-detalle').innerText()), /· \+1 más$/, 'y la tarjeta ya cuenta la impresora nueva');
    assert.deepEqual(a.diag.errores, []);
    await a.ctx.close();

    // Sin conexión
    const b = await abrir(t, 'admin-impresora-sin-conexion', ancho); if (!b) return;
    const tb = b.page.locator('[data-tarjeta="impresora"]');
    assert.equal(limpio(await tb.locator('.tarjeta-admin-dato').innerText()), 'Sin conexión');
    assert.match(limpio(await tb.locator('.tarjeta-admin-detalle').innerText()), /^Caja · Último latido hace 7 min\. Mientras tanto, las cuentas salen del teléfono\.$/);
    const anillo = await tb.locator('.status-dot').evaluate((e) => { const c = getComputedStyle(e); return { fondo: c.backgroundColor, sombra: c.boxShadow }; });
    assert.equal(anillo.fondo, 'rgba(0, 0, 0, 0)', 'anillo hueco: la forma lo dice sin color');
    assert.match(anillo.sombra, /inset/);
    assert.ok(contraste(anillo.sombra.match(/rgb\([^)]*\)/)[0], 'rgb(255, 253, 247)') >= 3, 'el anillo se ve sobre la tarjeta papel (no-texto ≥ 3:1)');
    assert.equal(await tb.evaluate((e) => e.classList.contains('destacada')), false, 'una caja apagada no pide nada: sin filete maíz');
    assert.equal(await b.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await b.ctx.close();

    // Sin configurar
    const c = await abrir(t, 'admin-impresora-sin-configurar', ancho); if (!c) return;
    const tc = c.page.locator('[data-tarjeta="impresora"]');
    assert.equal(limpio(await tc.locator('.tarjeta-admin-dato').innerText()), 'Sin configurar');
    assert.match(limpio(await tc.locator('.tarjeta-admin-detalle').innerText()), /^Agrega la impresora del PC de la caja/);
    assert.equal(await tc.locator('.status-dot').isVisible(), false, 'sin impresora no hay punto');
    await tc.getByRole('button', { name: 'Configurar impresora', exact: true }).click();
    await c.page.locator('section:visible h1', { hasText: 'Impresora de la caja' }).waitFor();
    assert.match(await c.page.locator('.alta-caja h2').innerText(), /Agregar la impresora de la caja/);
    await c.ctx.close();
  });
}

test('navegador 1440 px: sin la cola en la base el tablero tiene ocho tarjetas (la de la impresora no existe) y el mesero no tiene tablero', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'admin', 1440); if (!a) return;
  assert.equal(await a.page.locator('[data-tarjeta="impresora"]').isVisible(), false);
  assert.equal(await a.page.locator('.tarjeta-admin:visible').count(), 8);
  assert.equal(await a.page.evaluate(() => Alpine.store('pos').irA('impresora')), true, 'el admin sí puede pedirla (la vista pide la cola solo para mostrar datos)');
});

for (const ancho of [390, 1440]) {
  test(`navegador ${ancho} px: la precuenta con personas con nombre va a la caja con «Camila» (no «Persona 1 (Camila)») y el cobro de Camila, desde el ticket, con «Cuenta de Camila»`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden-personas', ancho, { ajustar: CAJA_SIM() }); if (!a) return;
    const { page } = a;
    // La precuenta: UN botón; con la caja en línea abre la elección y «En la caja» manda el documento.
    assert.equal(await boton(page, 'Imprimir en la caja').count(), 0, 'la orden no trae otro botón de impresión');
    await boton(page, 'Imprimir precuenta').click();
    await boton(page, 'En la caja').click();
    await page.locator('.toast-impresion-fila').first().waitFor();
    const [precuenta] = await impresiones(page);
    assert.equal(precuenta.tipo, 'cuenta');
    const notas = precuenta.contenido.lineas.filter((l) => l.sangria === 2 && !/^c\/u /.test(l.texto)).map((l) => l.texto);
    assert.ok(notas.includes('Sopa · Pollo - Camila'), `la nota con el nombre, con el guion del papel (${notas.join(' | ')})`);
    assert.ok(notas.includes('Andrés') && notas.includes('Persona 3'), 'y las otras personas: con nombre o «Persona 3»');
    assert.equal(precuenta.contenido.lineas.some((l) => /\(Camila\)|\(Andrés\)/.test(l.texto)), false);
    // Cobrar a Camila → ticket de Camila → «Imprimir en la caja» (el coral) lleva «Cuenta de Camila».
    await page.waitForFunction(() => Alpine.store('pos').cajaTrabajos[0]?.id);
    await page.evaluate(() => window.__posSim.imprimirAhora(window.__posSim.tablas.impresiones.at(-1).id, 'impresa'));
    await boton(page, 'Cobrar a Camila').click();
    await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
    assert.equal(limpio(await page.locator('.ticket-meta .meta-row', { hasText: 'Cuenta de' }).innerText()), 'Cuenta de Camila');
    const clases = (n) => boton(page, n).evaluate((e) => e.className);
    assert.match(await clases('Imprimir en la caja'), /btn-primary/, 'con la caja en línea el destino por omisión es la caja (el coral)');
    assert.match(await clases('En este teléfono'), /btn-secondary/);
    assert.equal(await page.locator('.ticket-acciones .btn-primary:visible').count(), 1);
    await boton(page, 'Imprimir en la caja').click();
    await page.waitForFunction(() => (window.__posSim.tablas.impresiones || []).length === 2);
    const cobro = (await impresiones(page)).at(-1);
    assert.equal(cobro.tipo, 'ticket');
    const filaPersona = cobro.contenido.lineas.find((l) => l.texto === 'Cuenta de');
    assert.deepEqual(filaPersona && { texto: filaPersona.texto, der: filaPersona.der }, { texto: 'Cuenta de', der: 'Camila' });
    assert.deepEqual(cobro.contenido.lineas.filter((l) => l.sangria === 2).map((l) => l.texto), ['Sopa · Pollo'], 'sin el nombre repetido en cada línea');
    assert.equal(cobro.contenido.lineas.find((l) => l.texto === 'TOTAL').der, '$ 34.000');
    assert.deepEqual(a.diag.errores, []);
    await a.ctx.close();
  });
}

test('navegador (390 y 1440): la elección de destino de la precuenta cabe, mide 44 px, se cierra sola al cambiar de vista y con la caja apagada «Imprimir precuenta» imprime directo', { skip: SALTAR }, async (t) => {
  for (const ancho of [390, 1440]) {
    const a = await abrir(t, 'caja-orden-destino', ancho); if (!a) return;
    const { page } = a;
    const panel = page.locator('#precuenta-destino');
    const caja = await panel.boundingBox();
    assert.ok(caja.x >= -0.5 && caja.x + caja.width <= ancho + 0.5, `${ancho}: la elección cabe`);
    for (const b of await panel.locator('button:visible').all()) assert.ok((await b.boundingBox()).height >= 43.5, `${ancho}: botones de 44 px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${ancho}: sin desborde`);
    assert.equal(await page.locator('.ticket-acciones .btn-primary:visible').count(), 0);
    assert.equal(await page.locator('.btn-primary:visible').count(), 1, `${ancho}: un solo coral en la orden (el del cobro)`);
    // Cambiar de vista la cierra: al volver a la orden empieza cerrada.
    await page.evaluate(() => { Alpine.store('pos').vista = 'mesas'; });
    await reposo(page);
    await page.evaluate(() => { Alpine.store('pos').vista = 'orden'; });
    await reposo(page);
    assert.equal(await panel.isVisible(), false, `${ancho}: se cerró al salir de la orden`);
    // La caja se cae: la elección desaparece y el botón imprime directo.
    await boton(page, 'Imprimir precuenta').click();
    await reposo(page);
    assert.equal(await panel.isVisible(), true);
    await page.evaluate(() => { window.__posSim.impresoras[0].en_linea = false; return Alpine.store('pos').cargarEstadoCaja(); });
    await reposo(page);
    assert.equal(await panel.isVisible(), false, `${ancho}: sin caja en línea la elección se cierra sola`);
    await boton(page, 'Imprimir precuenta').click();
    await page.waitForFunction(() => window.__posImpresiones === 1);
    assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'ticket', 'imprime directo en el teléfono, como siempre');
    assert.deepEqual(a.diag.errores, []);
    await a.ctx.close();
  }
});

test('navegador: el POS real a 390, 920 y 1440 no desborda en el tablero con la tarjeta de la impresora ni en la orden con la elección abierta, y nada mide menos de 44 px', { skip: SALTAR }, async (t) => {
  const fallas = [];
  for (const ancho of [390, 920, 1440]) for (const vista of ['admin-impresora', 'admin-impresora-sin-conexion', 'admin-impresora-sin-configurar', 'caja-orden-destino', 'caja-admin']) {
    const a = await abrir(t, vista, ancho); if (!a) return;
    const r = await a.page.evaluate(() => {
      const visibleEl = (e) => { if (!e.getClientRects().length) return false; for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return !(getComputedStyle(e).position === 'absolute' && e.getBoundingClientRect().width <= 1); };
      const chicos = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter(visibleEl)
        .map((e) => { const b = e.getBoundingClientRect(); return { n: `${e.tagName.toLowerCase()} «${(e.getAttribute('aria-label') || e.textContent || e.type).trim().slice(0, 24)}»`, w: b.width, h: b.height }; })
        .filter((x) => x.w < 43.5 || x.h < 43.5).map((x) => `${x.n} ${Math.round(x.w)}×${Math.round(x.h)}`);
      return { desborde: document.documentElement.scrollWidth - innerWidth, chicos };
    });
    if (r.desborde > 0) fallas.push(`${vista}@${ancho}: desborde de ${r.desborde} px`);
    if (r.chicos.length) fallas.push(`${vista}@${ancho}: ${r.chicos.join('; ')}`);
    if (a.diag.errores.length) fallas.push(`${vista}@${ancho}: errores de consola ${a.diag.errores.join('; ')}`);
    await a.ctx.close();
  }
  assert.deepEqual(fallas, []);
});
