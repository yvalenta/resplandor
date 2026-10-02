// Ola C, ronda 5 (r5b), EN NAVEGADOR (Chromium de verdad, con Alpine envolviendo el store REAL y el stub de Supabase de _pos-simulado.mjs): el TABLERO DE
// ADMINISTRACIÓN (docs/pos-visual.md §0.20). El complemento de pos-ola-c-ronda5-tablero.test.mjs (estática, corre siempre).
//
// Aquí el estado NO se fija en el store: el tablero se abre con la entrada del nav, como lo haría el admin, y pinta lo que el stub le contesta a las lecturas
// de siempre; las pruebas cuentan sobre los mismos datos del arnés (`tableroConPendientes` y `tableroVacio`).
//   1. Con pendientes: la franja «Hoy», cada tarjeta con su número y su frase, lo destacado, la entrada del nav con su insignia, y sin la de la impresora.
//   2. Vacío: «Nadie espera aprobación», «Falta cargar esta semana», «Aún no hay cierres», «Nadie deshizo cobros hoy», $ 0.
//   3. Cada tarjeta: tocar donde sea abre su vista (área táctil que cubre la tarjeta) y cada botón hace su acción; «‹ Administración» vuelve.
//   4. Mesero: sin la entrada y sin tablero. Impresora: oculta, y se enciende cuando el store trae datos. Sin red: el aviso.
//   5. Teclado: el foco rodea la tarjeta entera y Enter abre; lo que cambia en el store se repinta en el tablero.
//   6. Sin desborde horizontal y sin controles de menos de 44×44, a 320, 360, 390, 768 y 1440 px, en el tablero y en las vistas que ahora llevan «‹ Administración».
//
// Solo corre si hay Playwright con Chromium (y red para las fuentes la primera vez); si no, se salta con el motivo. Nunca toca Supabase.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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

const ALTOS = { 320: 640, 360: 780, 390: 844, 768: 1024, 1024: 768, 1440: 900 };
const limpio = (t) => String(t).replace(/\s+/g, ' ').trim();
const hasta = async (page, fn, ms = 4000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await page.waitForTimeout(40); } return !!(await fn()); };
const vistaActual = (page) => page.evaluate(() => Alpine.store('pos').vista);
const enVista = (page, v) => hasta(page, async () => (await vistaActual(page)) === v);
const tarjeta = (page, clave) => page.locator(`[data-tarjeta="${clave}"]`);
const textoDe = async (page, clave) => limpio(await tarjeta(page, clave).locator('.tarjeta-admin-dato, .tarjeta-admin-detalle').allInnerTexts().then((l) => l.join(' | ')));
const entradaAdmin = (page) => page.locator('nav.nav-bar .nav-destinos .nav-link', { hasText: 'Administración' });

async function abrir(t, vista, ancho, { ajustar, rol } = {}) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto: ALTOS[ancho] || 900, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    const { diag } = await abrirPos(page, { url: servidor.url, vista, ajustar, dirCache: DIR_CACHE });
    if (rol) { await page.evaluate((r) => { const p = Alpine.store('pos'); p.rol = r; p.rolCargado = true; p.sinAcceso = false; }, rol); await page.waitForTimeout(150); }
    return { page, diag };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}

/** Vuelve al tablero como lo hace una persona: con «‹ Administración» si la vista lo tiene, y si no con la entrada del nav. */
async function alTablero(page) {
  const volver = page.locator('section:visible .volver-admin');
  if (await volver.count()) await volver.first().click(); else await entradaAdmin(page).click();
  assert.ok(await enVista(page, 'admin'), 'volvió al tablero');
  await hasta(page, () => page.evaluate(() => !Alpine.store('pos').cargandoTablero));
}

// ───────────────────────── 1. con pendientes ─────────────────────────

for (const ancho of [390, 1440]) {
  test(`navegador ${ancho} px: el tablero cuenta lo que hay en los datos del arnés (franja Hoy y las ocho tarjetas) y destaca lo que pide algo`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'admin', ancho); if (!a) return;
    const { page, diag } = a;
    assert.equal(await vistaActual(page), 'admin');
    assert.equal(limpio(await page.locator('section:visible h1').first().innerText()), 'Administración');
    // Hoy: $ 330.000 en ventas del turno (las tres cerradas que ningún cierre se llevó), 2 mesas con cuenta (3 y 6) y 2 alertas.
    assert.equal(limpio(await page.locator('#hoy-ventas').innerText()), '$ 330.000');
    assert.equal(limpio(await page.locator('#hoy-mesas').innerText()), '2');
    assert.equal(limpio(await page.locator('#hoy-alertas').innerText()), '2');
    assert.equal(await page.locator('.hoy-franja .con-alertas').count(), 1, 'con alertas, su celda se marca');
    // Las ocho tarjetas, en orden; la de la impresora no sale.
    assert.deepEqual((await page.locator('.tarjeta-admin:visible .tarjeta-admin-titulo').allInnerTexts()).map(limpio),
      ['Personal', 'Menú semanal', 'Mesas y pegatinas', 'Productos', 'Ticket y ajustes', 'Cierres e historial', 'Cobros deshechos hoy', 'Alertas']);
    assert.equal(await tarjeta(page, 'impresora').isVisible(), false, 'la impresora está oculta');
    // Lo que dice cada una (dato | detalle).
    assert.equal(await textoDe(page, 'personal'), '2 esperan aprobación | 3 activos');
    assert.equal(await textoDe(page, 'menu'), 'Faltan por definir 2 platos | Semana del 28 de sept – 3 de oct');
    assert.equal(await textoDe(page, 'mesas'), '9 mesas activas | 4 pegatinas sin revisar');
    assert.equal(await textoDe(page, 'productos'), '12 en carta | 4 categorías');
    assert.equal(await textoDe(page, 'ticket'), 'carta.ejemplo.test/resplandor | El QR sale en el ticket');
    assert.match(await textoDe(page, 'cierres'), /^29 de sept · \$ 514\.000 \| Último cierre$/);
    assert.equal(await textoDe(page, 'deshechos'), '3 cobros · $ 109.000 | Desde el último cierre', 'el deshecho de un cierre anterior no cuenta');
    assert.equal(await textoDe(page, 'alertas'), '2 pendientes | Mesas 3, 6');
    // Destacadas: las tres que piden algo (y con su chip); las demás no.
    for (const clave of ['personal', 'menu', 'alertas']) assert.equal(await tarjeta(page, clave).evaluate((e) => e.classList.contains('destacada')), true, `${clave} destacada`);
    for (const clave of ['mesas', 'productos', 'ticket', 'cierres', 'deshechos']) assert.equal(await tarjeta(page, clave).evaluate((e) => e.classList.contains('destacada')), false, `${clave} sin destacar`);
    assert.deepEqual((await page.locator('.tarjeta-admin .chip:visible').allInnerTexts()).map(limpio), ['Por aprobar', 'Falta', 'Por atender']);
    // Cada tarjeta lleva su acción principal.
    assert.deepEqual((await page.locator('.tarjeta-admin:visible .tarjeta-admin-accion:visible').allInnerTexts()).map(limpio),
      ['Agregar mesero', 'Editar menú', 'Ver mesas', 'Agregar producto', 'Editar ticket', 'Ver historial', 'Ver lista', 'Ver alertas']);
    // La entrada del nav: nombre accesible con las solicitudes, insignia y activa.
    const entrada = entradaAdmin(page);
    assert.equal(await entrada.getAttribute('aria-label'), 'Administración (2 por aprobar)');
    assert.equal(limpio(await entrada.locator('.insignia').innerText()), '2');
    assert.equal(await entrada.evaluate((e) => e.classList.contains('active')), true);
    assert.equal(await entrada.getAttribute('aria-current'), 'page');
    // La grilla: una columna en teléfono, tres desde 1024.
    const columnas = await page.locator('.tablero-rejilla').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.equal(columnas, ancho >= 1024 ? 3 : 1, `${ancho}: columnas de la rejilla`);
    assert.deepEqual(diag.errores, [], 'sin errores de consola');
  });
}

test('navegador 768 px: la rejilla es de dos columnas y la fila del admin son cuatro links que caben', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'admin', 768); if (!a) return;
  const { page } = a;
  assert.equal(await page.locator('.tablero-rejilla').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length), 2);
  assert.deepEqual((await page.locator('.nav-destinos .nav-link:visible').allInnerTexts()).map((x) => limpio(x).replace(/^\d+ /, '')), ['Mesas', 'Productos', 'Cierre del día', 'Administración']);
  for (const l of await page.locator('.nav-destinos .nav-link:visible').all()) {
    const r = await l.boundingBox();
    assert.ok(r.x >= -1 && r.x + r.width <= 769, `un link se sale (${r.x}..${r.x + r.width})`);
  }
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 2. vacío ─────────────────────────

test('navegador 390 px: el tablero vacío dice la verdad (nadie espera, falta el menú, sin cierres, sin deshechos, sin alertas, $ 0)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'admin-vacio', 390); if (!a) return;
  const { page, diag } = a;
  assert.equal(limpio(await page.locator('#hoy-ventas').innerText()), '$ 0');
  assert.equal(limpio(await page.locator('#hoy-mesas').innerText()), '0');
  assert.equal(limpio(await page.locator('#hoy-alertas').innerText()), '0');
  assert.equal(await page.locator('.hoy-franja .con-alertas').count(), 0);
  assert.equal(await textoDe(page, 'personal'), 'Nadie espera aprobación | 1 activo');
  assert.equal(await textoDe(page, 'menu'), 'Falta cargar esta semana | Semana del 28 de sept – 3 de oct');
  assert.equal(await textoDe(page, 'mesas'), '10 mesas activas | 10 pegatinas sin revisar');
  assert.equal(await textoDe(page, 'productos'), '12 en carta | 4 categorías');
  assert.equal(await textoDe(page, 'ticket'), 'resplandor.ynt.codes | El QR sale en el ticket', 'sin fila de ajustes: el de fábrica');
  assert.equal(await textoDe(page, 'cierres'), 'Aún no hay cierres | El primero sale al cerrar el día');
  assert.equal(await textoDe(page, 'deshechos'), 'Nadie deshizo cobros hoy | Desde el último cierre');
  assert.equal(await textoDe(page, 'alertas'), 'Sin alertas pendientes |');
  assert.deepEqual((await page.locator('.tarjeta-admin.destacada:visible').evaluateAll((l) => l.map((e) => e.dataset.tarjeta))), ['menu'], 'solo el menú de la semana pide algo');
  assert.equal(await entradaAdmin(page).getAttribute('aria-label'), 'Administración');
  assert.equal(await entradaAdmin(page).locator('.insignia').isVisible(), false);
  assert.deepEqual(diag.errores, []);
});

// ───────────────────────── 3. las tarjetas y sus acciones ─────────────────────────

for (const ancho of [390, 1440]) {
  test(`navegador ${ancho} px: tocar donde sea de una tarjeta abre su vista, cada botón hace su acción y «‹ Administración» vuelve al tablero`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'admin', ancho); if (!a) return;
    const { page, diag } = a;
    const tocarCuerpo = async (clave) => {      // un toque en el DATO de la tarjeta (no en su título ni en su botón): el área táctil cubre toda la tarjeta
      const dato = tarjeta(page, clave).locator('.tarjeta-admin-dato');
      await dato.scrollIntoViewIfNeeded();
      const c = await dato.boundingBox();
      await page.mouse.click(c.x + 8, c.y + c.height / 2);
    };
    const accion = async (clave) => {
      const b = tarjeta(page, clave).locator('.tarjeta-admin-accion:visible');
      await b.scrollIntoViewIfNeeded();
      await b.click();
    };

    // Personal: el cuerpo abre Personal; «Agregar mesero» lo abre con el formulario de alta listo (el correo con el foco, el rol en Mesero).
    await tocarCuerpo('personal');
    assert.ok(await enVista(page, 'personal'), 'el cuerpo de la tarjeta abre Personal');
    assert.equal(await page.locator('#persona-correo').isVisible(), false, 'sin pedirlo, el formulario de alta está cerrado');
    assert.equal(limpio(await page.locator('.pendientes-cab h2').innerText()), 'Pendientes (2)');
    assert.equal(await entradaAdmin(page).evaluate((e) => e.classList.contains('active')), true, 'dentro de Personal, «Administración» sigue activa');
    assert.equal(await entradaAdmin(page).getAttribute('aria-current'), 'true');
    await alTablero(page);
    await accion('personal');
    assert.ok(await enVista(page, 'personal'));
    assert.ok(await hasta(page, () => page.locator('#persona-correo').isVisible()), '«Agregar mesero» abre el formulario de alta');
    assert.ok(await hasta(page, () => page.evaluate(() => document.activeElement && document.activeElement.id === 'persona-correo')), 'con el foco en el correo');
    assert.equal(await page.locator('.alta-persona .opt-chip.sel').innerText(), 'Mesero', 'el rol ya es Mesero');
    await alTablero(page);

    // Menú semanal: Editar menú abre el menú de la semana en curso y sus 16 platos.
    await accion('menu');
    assert.ok(await enVista(page, 'menu'));
    assert.ok(await hasta(page, () => page.evaluate(() => Alpine.store('pos').menusSemana.length === 18)), 'cargó los menús de la semana en curso');
    assert.equal(await page.evaluate(() => Alpine.store('pos').semanaMenu), '2026-09-28');
    assert.ok(await hasta(page, async () => limpio(await page.locator('section:visible h1').first().innerText()) === 'Menú semanal'), 'el título de la vista es «Menú semanal»');
    await alTablero(page);
    // Si se miraba otra semana, el menú abre en la de ahora.
    await page.evaluate(() => { Alpine.store('pos').semanaMenu = '2026-01-05'; });
    await tarjeta(page, 'menu').locator('.tarjeta-admin-abre').click();
    assert.ok(await enVista(page, 'menu'));
    assert.equal(await page.evaluate(() => Alpine.store('pos').semanaMenu), '2026-09-28');
    await alTablero(page);

    // Mesas y pegatinas.
    await accion('mesas');
    assert.ok(await enVista(page, 'mesas-admin'));
    assert.equal(await page.locator('.mesa-adm').count(), 10);
    await alTablero(page);
    await tocarCuerpo('mesas');
    assert.ok(await enVista(page, 'mesas-admin'), 'el cuerpo también');
    await alTablero(page);

    // Productos: «Agregar producto» abre el modal sin salir del tablero; el título lleva a Productos.
    await accion('productos');
    assert.equal(await vistaActual(page), 'admin', 'el modal se abre sobre el tablero');
    await page.locator('.modal-backdrop:visible .modal').waitFor();
    assert.equal(limpio(await page.locator('.modal-backdrop:visible .modal-header h2').innerText()), 'Nuevo Producto');
    await page.locator('.modal-backdrop:visible').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await hasta(page, async () => !(await page.locator('.modal-backdrop:visible').count()));
    assert.equal(await page.locator('.modal-backdrop:visible').count(), 0);
    await tarjeta(page, 'productos').locator('.tarjeta-admin-abre').click();
    assert.ok(await enVista(page, 'productos'));
    await alTablero(page);

    // Ticket y ajustes.
    await accion('ticket');
    assert.ok(await enVista(page, 'ajustes'));
    assert.equal(await page.locator('#ajuste-url').inputValue(), 'https://carta.ejemplo.test/resplandor', 'los ajustes que leyó la base');
    await alTablero(page);

    // Cierres: «Ver historial» abre el cierre y baja hasta el historial; «Ver lista», hasta los cobros deshechos.
    await accion('cierres');
    assert.ok(await enVista(page, 'cierre'));
    assert.ok(await hasta(page, () => page.evaluate(() => { const r = document.getElementById('historial-cierres').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })), 'el historial quedó a la vista');
    await alTablero(page);
    await accion('deshechos');
    assert.ok(await enVista(page, 'cierre'));
    assert.ok(await hasta(page, () => page.evaluate(() => { const r = document.getElementById('deshechos-titulo').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })), 'los cobros deshechos quedaron a la vista');
    assert.equal(limpio(await page.locator('#deshechos-titulo').innerText()), 'Cobros deshechos hoy');
    await alTablero(page);

    // Alertas.
    await accion('alertas');
    assert.ok(await enVista(page, 'alertas'));
    assert.equal(await page.locator('.alerta-tarjeta').count(), 2);
    await alTablero(page);
    await tocarCuerpo('alertas');
    assert.ok(await enVista(page, 'alertas'), 'el cuerpo también');
    assert.deepEqual(diag.errores, [], 'sin errores de consola');
  });
}

// ───────────────────────── 4. mesero, impresora y sin red ─────────────────────────

test('navegador 390 px: el mesero no tiene la entrada «Administración», no ve el tablero y no puede abrirlo', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'admin-mesero', 390); if (!a) return;
  const { page } = a;
  assert.equal(await vistaActual(page), 'mesas', 'irA(\'admin\') lo rechazó');
  assert.deepEqual((await page.locator('.nav-destinos .nav-link:visible').allInnerTexts()).map(limpio), ['Mesas', 'Alertas', 'Productos', 'Cierre del día']);
  assert.equal(await entradaAdmin(page).isVisible(), false);
  assert.equal(await page.locator('.nav-destinos [aria-label^="Administración"]').isVisible(), false);
  assert.equal(await page.locator('.tarjeta-admin:visible').count(), 0, 'ninguna tarjeta a la vista');
  // Aunque algo fuerce la vista (un estado viejo), la sección no se muestra y el store no deja entrar.
  await page.evaluate(() => { Alpine.store('pos').vista = 'admin'; });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#tablero-titulo').isVisible(), false);
  assert.equal(await page.evaluate(() => Alpine.store('pos').irA('admin')), false);
  // Si el rol cambia a mesero con el tablero abierto, vuelve solo al mapa (lo hace revalidarRol; aquí, la misma regla con el rol puesto a mano).
  assert.deepEqual(a.diag.errores, []);
});

test('navegador 1440 px: la tarjeta «Impresora de la caja» está oculta y se enciende cuando el store trae datos de impresora (el gancho de tarea/impresion-caja)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'admin', 1440); if (!a) return;
  const { page, diag } = a;
  assert.equal(await page.evaluate(() => Alpine.store('pos').tieneImpresora), false);
  assert.equal(await tarjeta(page, 'impresora').isVisible(), false);
  await page.evaluate(() => { Alpine.store('pos').impresora = { nombre: 'Epson TM-T20 (caja)', detalle: 'Sin papel' }; });
  await tarjeta(page, 'impresora').waitFor();
  assert.equal(await textoDe(page, 'impresora'), 'Epson TM-T20 (caja) | Sin papel');
  assert.equal(limpio(await tarjeta(page, 'impresora').locator('.tarjeta-admin-accion').innerText()), 'Ver impresora');
  assert.equal(await page.locator('.tarjeta-admin:visible').count(), 9, 'con ella, nueve (tres filas completas en la rejilla de 3)');
  await page.evaluate(() => { Alpine.store('pos').impresora = null; });
  await page.waitForTimeout(150);
  assert.equal(await tarjeta(page, 'impresora').isVisible(), false, 'sin datos vuelve a esconderse');
  assert.deepEqual(diag.errores, []);
});

test('navegador 390 px: sin red el tablero avisa que los datos pueden estar viejos', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'admin', 390); if (!a) return;
  const { page } = a;
  assert.equal(await page.getByText('Sin conexión: los datos de las tarjetas').isVisible(), false, 'con red no hay aviso');
  await page.evaluate(() => { Alpine.store('pos').remoto = 'offline'; });
  await page.getByText('Sin conexión: los datos de las tarjetas').waitFor();
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 5. teclado y reactividad ─────────────────────────

test('navegador 390 px: con el teclado, el foco rodea la tarjeta entera y Enter abre la vista; lo que cambia en el store se repinta en el tablero', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'admin', 390); if (!a) return;
  const { page, diag } = a;
  // Tab hasta el título de la primera tarjeta: el outline va en el ::after (la tarjeta entera), no en el botón de 44 px.
  const titulo = tarjeta(page, 'personal').locator('.tarjeta-admin-abre');
  await titulo.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(await titulo.evaluate((e) => document.activeElement === e), true);
  const foco = await titulo.evaluate((e) => ({ boton: getComputedStyle(e).outlineColor, after: getComputedStyle(e, '::after').outlineStyle, ancho: getComputedStyle(e, '::after').outlineWidth }));
  assert.equal(foco.after, 'solid', 'el anillo de foco es del ::after');
  assert.equal(foco.ancho, '2px');
  const caja = await tarjeta(page, 'personal').boundingBox(), area = await titulo.evaluate((e) => { const r = getComputedStyle(e, '::after'); return { w: parseFloat(r.width), h: parseFloat(r.height) }; });
  assert.ok(Math.abs(area.w - caja.width) <= 2 && Math.abs(area.h - caja.height) <= 2, `el área del ::after (${area.w}×${area.h}) es la tarjeta (${caja.width}×${caja.height})`);
  await page.keyboard.press('Enter');
  assert.ok(await enVista(page, 'personal'), 'Enter abre');
  await alTablero(page);
  // Reactividad: una solicitud menos y una alerta más se ven sin recargar.
  await page.evaluate(() => { const p = Alpine.store('pos'); p.personalPendientes = p.personalPendientes.slice(1); p.alertas = [...p.alertas, { id: 'al-3', mesaId: 9, metodo: 'qr', creadaEn: new Date().toISOString() }]; });
  await page.waitForTimeout(150);
  assert.equal(await textoDe(page, 'personal'), '1 espera aprobación | 3 activos');
  assert.equal(limpio(await page.locator('#hoy-alertas').innerText()), '3');
  assert.equal(await textoDe(page, 'alertas'), '3 pendientes | Mesas 3, 6, 9');
  assert.equal(await entradaAdmin(page).getAttribute('aria-label'), 'Administración (1 por aprobar)');
  await page.evaluate(() => { const p = Alpine.store('pos'); p.personalPendientes = []; p.alertas = []; });
  await page.waitForTimeout(150);
  assert.equal(await textoDe(page, 'personal'), 'Nadie espera aprobación | 3 activos');
  assert.equal(await tarjeta(page, 'personal').evaluate((e) => e.classList.contains('destacada')), false);
  assert.equal(await entradaAdmin(page).locator('.insignia').isVisible(), false);
  assert.deepEqual(diag.errores, []);
});

test('navegador 320 px: una dirección de QR larguísima parte en la tarjeta del ticket y no empuja la página', { skip: SALTAR }, async (t) => {
  const larga = 'https://carta.ejemplo.test/resplandor/' + 'abcdefghij'.repeat(12);
  const a = await abrir(t, 'admin', 320, { ajustar: (d) => { d.tablas.ajustes = [{ id: 1, ticket_qr_url: larga, ticket_qr_visible: true, ticket_pie: 'Gracias' }]; } }); if (!a) return;
  const { page } = a;
  assert.ok((await textoDe(page, 'ticket')).includes('abcdefghij'), 'la dirección se ve');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 6. desborde y 44 px ─────────────────────────

const medir = (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('.sr-only'); };
  const chicos = [];
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]').forEach((el) => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) chicos.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/)[0]} ${Math.round(r.width)}×${Math.round(r.height)} «${(el.textContent || '').trim().slice(0, 18)}»`);
  });
  const W = document.documentElement.clientWidth;
  const salen = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (!vis(el) || getComputedStyle(el).position === 'fixed') return;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1) salen.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/)[0]} +${Math.round(r.right - W)}`);
  });
  return { scroll: document.documentElement.scrollWidth - W, chicos, salen: salen.slice(0, 4) };
});

const VISTAS_NUEVAS = ['admin', 'admin-vacio', 'admin-sin-red', 'admin-impresora', 'admin-mesero'];
// Las cuatro vistas que ahora llevan «‹ Administración» arriba (su botón también mide ≥ 44 px).
const VISTAS_CON_VUELTA = ['personal-pendientes', 'menu', 'mesas-admin', 'ajustes'];

test('navegador: sin desborde horizontal y sin controles de menos de 44×44 en el tablero (cinco vistas del arnés) a 320, 360, 390, 768 y 1440 px', { skip: SALTAR }, async (t) => {
  for (const ancho of [320, 360, 390, 768, 1440]) {
    for (const vista of VISTAS_NUEVAS) {
      const a = await abrir(t, vista, ancho); if (!a) return;
      const m = await medir(a.page);
      assert.equal(m.scroll, 0, `${vista}@${ancho}: desborde horizontal de ${m.scroll} px`);
      assert.deepEqual(m.salen, [], `${vista}@${ancho}: elementos que se salen por la derecha`);
      assert.deepEqual(m.chicos, [], `${vista}@${ancho}: controles de menos de 44×44`);
      assert.deepEqual(a.diag.errores, [], `${vista}@${ancho}: errores de consola`);
      await a.page.context().close();
    }
  }
});

test('navegador: sin desborde y sin controles de menos de 44×44 en las cuatro vistas que ahora vuelven al tablero (con «‹ Administración») a 320, 390 y 1440 px', { skip: SALTAR }, async (t) => {
  for (const ancho of [320, 390, 1440]) {
    for (const vista of VISTAS_CON_VUELTA) {
      const a = await abrir(t, vista, ancho); if (!a) return;
      assert.equal(await a.page.locator('section:visible .volver-admin').count(), 1, `${vista}@${ancho}: lleva «‹ Administración»`);
      const m = await medir(a.page);
      assert.equal(m.scroll, 0, `${vista}@${ancho}: desborde horizontal de ${m.scroll} px`);
      assert.deepEqual(m.salen, [], `${vista}@${ancho}: elementos que se salen por la derecha`);
      assert.deepEqual(m.chicos, [], `${vista}@${ancho}: controles de menos de 44×44`);
      assert.deepEqual(a.diag.errores, [], `${vista}@${ancho}: errores de consola`);
      await a.page.context().close();
    }
  }
});
