// Ola B, parte b2, EN NAVEGADOR: la pantalla del POS se comporta como promete con el arnés (Supabase simulado).
// Es el complemento de pos-ola-b2.test.mjs (estática, corre siempre). Esta solo corre si hay Playwright con Chromium
// y los CDN de Tailwind, Alpine y Lucide (la primera vez se guardan en $TMP/resplandor-pos-cdn o en $POS_CDN_CACHE); si no, se salta con el
// motivo. Ni CI ni el repo traen Playwright. Nunca toca Supabase: el arnés lo reemplaza por un stub en memoria.
//
// Cómo prueba: las funciones del store que cambian datos (atenderAlerta, descartarAlerta, altaPersonal, bajaPersonal,
// cobrarMonto…) se REEMPLAZAN por espías: lo que se comprueba es que el marcado las llama con los argumentos del
// contrato, y eso vale igual con el relleno del contrato del arnés que con la lógica real de b1. La selección por
// unidades y el rol (lo que el marcado lee, no lo que escribe) sí corren con lo que haya en el store.
//   1. Teléfono: «Administración» del admin abre el tablero (de él cuelgan Menú semanal, Personal, Mesas y pegatinas y Ajustes); el mesero tiene 4 destinos y no la tiene.
//   2. Alertas: «Descartar» pide confirmar antes de llamar a descartarAlerta; «Atender» llama a atenderAlerta con el id.
//   3. Cobro por monto: el campo deja solo dígitos, el botón sigue a abonoValido y el método se elige con aria-pressed.
//   4. Cobro por unidades: marcar una línea con 3 unidades abre «Cobrar [−] 3 [+] de 3»; se baja a 2 y la barra suma $ 26.000.
//   5. Personal: el alta llama a altaPersonal(correo, nombre, rol); la baja pide confirmar.
//   6. Roles: el mesero no ve borrar producto, cerrar el día, editar cerradas ni rotar el token; el admin sí.
//   7. Sin desborde horizontal y sin controles de menos de 44 px en las vistas nuevas, a 360 y 1440 px.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
// Dónde se guardan Tailwind, Alpine y Lucide: por defecto $TMP/resplandor-pos-cdn; POS_CDN_CACHE lo cambia (p. ej. a la caché de las capturas).
const DIR_CACHE = process.env.POS_CDN_CACHE || undefined;

let servidor = null;
let navegador = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});

/** Abre una vista del arnés; si no hay red para los CDN, salta la prueba con el motivo (y devuelve null). */
async function abrir(t, vista, ancho, { rol } = {}) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    const { diag } = await abrirPos(page, { url: servidor.url, vista, dirCache: DIR_CACHE });
    if (rol) { await page.evaluate((r) => { const p = Alpine.store('pos'); p.rol = r; p.rolCargado = true; p.sinAcceso = false; }, rol); await reposo(page); }
    return { page, diag };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para los CDN?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}
const espiar = (page, nombres) => page.evaluate((ns) => {
  const p = Alpine.store('pos'); window.__espias = [];
  for (const n of ns) p[n] = (...args) => { window.__espias.push([n, ...args]); };
}, nombres);
const espias = (page) => page.evaluate(() => window.__espias);
/** Alpine muestra con x-show dentro de un setTimeout (evita que un @click.away se cierre solo): tras cada acción se deja asentar. */
const reposo = (page) => page.waitForTimeout(200);
const visible = async (page, selector) => { await reposo(page); return page.locator(selector).first().isVisible(); };
const enlacesVisibles = (page) => page.locator('.nav-destinos .nav-link:visible').allInnerTexts().then((l) => l.map((x) => x.replace(/\s+/g, ' ').trim()));

test('b2 (navegador): teléfono: «Administración» del admin abre el tablero (Menú semanal, Personal, Mesas y pegatinas y Ajustes cuelgan de él); el mesero tiene 4 destinos y no tiene «Administración»', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas', 390); if (!a) return;
  const { page } = a;
  assert.equal((await enlacesVisibles(page)).length, 5, 'admin: Mesas, Alertas, Productos, Cierre y Admin (ya no hay «Más»)');
  assert.equal(await page.locator('#nav-mas').count(), 0, 'ya no existe la hoja de «Más»');
  await page.getByRole('button', { name: 'Administración', exact: true }).click();
  await reposo(page);
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'admin');
  assert.equal(await page.locator('section:visible h1').first().innerText(), 'Administración');
  const titulos = (await page.locator('.tarjeta-admin:visible .tarjeta-admin-titulo').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());   // («e historial» va en sr-only dentro del título «Cierres»)
  assert.deepEqual(titulos, ['Personal', 'Menú semanal', 'Mesas y pegatinas', 'Productos', 'Ticket y ajustes', 'Cierres e historial', 'Cobros deshechos hoy', 'Alertas'], 'la tarjeta de la impresora no sale');
  await page.locator('[data-tarjeta="personal"]').getByRole('button', { name: 'Personal', exact: true }).click();
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'personal');
  await reposo(page);
  assert.equal(await page.locator('section:visible h1').first().innerText(), 'Personal');
  // El mesero: cuatro destinos, sin «Administración», sin Personal ni Menú semanal.
  await page.evaluate(() => { Alpine.store('pos').rol = 'mesero'; Alpine.store('pos').vista = 'mesas'; });
  await reposo(page);
  const enlaces = await enlacesVisibles(page);
  assert.equal(enlaces.length, 4, `mesero: ${enlaces.join(' | ')}`);
  assert.ok(!enlaces.some((x) => /Admin|Más|Personal|Menú/.test(x)));
  assert.ok(enlaces.some((x) => /Cierre del día/.test(x)), 'el nombre accesible sigue siendo «Cierre del día»');
  assert.deepEqual(a.diag.errores, [], 'sin errores de consola');
});

test('b2 (navegador): alertas: «Descartar» pide confirmar; «Voy yo» y «Ir a la mesa» llaman con el id', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'alertas', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['atenderAlerta', 'descartarAlerta', 'irAMesaDeAlerta', 'silenciarAlertas']);
  const tarjetas = page.locator('.alerta-tarjeta');
  assert.equal(await tarjetas.count(), 2);
  assert.match(await tarjetas.nth(0).innerText(), /Mesa 3[\s\S]*Pidió la cuenta[\s\S]*hace 4 min[\s\S]*Paga con\s+QR[\s\S]*Por cobrar \$ 97\.000/);
  assert.match(await tarjetas.nth(1).innerText(), /Mesa 6[\s\S]*hace 1 min[\s\S]*Paga con\s+Efectivo/);
  // hace 4 min → maíz (atención); hace 1 min → neutro.
  assert.equal(await tarjetas.nth(0).locator('.alerta-hace').evaluate((e) => e.classList.contains('badge-maiz')), true);
  assert.equal(await tarjetas.nth(1).locator('.alerta-hace').evaluate((e) => e.classList.contains('badge-maiz')), false);
  await tarjetas.nth(0).getByRole('button', { name: 'Descartar', exact: true }).click();
  await reposo(page);
  assert.equal(await tarjetas.nth(0).getByText('¿Falsa alarma?').isVisible(), true);
  assert.deepEqual(await espias(page), [], 'descartar todavía no llamó a nada: pide confirmar');
  await tarjetas.nth(0).getByRole('button', { name: 'Volver', exact: true }).click();
  await reposo(page);
  assert.equal(await tarjetas.nth(0).getByText('¿Falsa alarma?').isVisible(), false);
  await tarjetas.nth(0).getByRole('button', { name: 'Descartar', exact: true }).click();
  await tarjetas.nth(0).getByRole('button', { name: 'Sí, descartar', exact: true }).click();
  await tarjetas.nth(1).getByRole('button', { name: 'Voy yo', exact: true }).click();
  await tarjetas.nth(1).getByRole('button', { name: 'Ir a la mesa', exact: true }).click();
  assert.deepEqual(await espias(page), [['descartarAlerta', 'al-1'], ['atenderAlerta', 'al-2'], ['irAMesaDeAlerta', 'al-2']]);
  // Silenciar: llama con 10, y el aviso de «en silencio» sale con la hora.
  await page.getByRole('button', { name: 'Silenciar 10 min', exact: true }).click();
  assert.deepEqual((await espias(page)).at(-1), ['silenciarAlertas', 10]);
});

test('b2 (navegador): aviso flotante y insignia: al subir las pendientes sale «Mesa 3 pidió la cuenta · QR» y la mesa lleva la campana', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas-alertas', 390); if (!a) return;
  const { page } = a;
  assert.equal((await page.locator('.toast-alerta-txt').innerText()).trim(), 'Mesa 3 pidió la cuenta · QR');
  assert.match(await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^3$/ }) }).locator('.mesa-alerta .sr-only').innerText(), /Pide la cuenta · QR/);
  assert.match(await page.locator('.nav-destinos .nav-link', { hasText: 'Alertas' }).locator('.insignia').innerText(), /^1$/);
  await page.locator('.toast-alerta-cuerpo').click();
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'alertas', 'tocar el aviso abre la vista');
  assert.equal(await visible(page, '.toast-alerta-cuerpo'), false, 'y el aviso se va');
});

test('b2 (navegador): cobro por monto: solo dígitos, el botón sigue a abonoValido y el método se marca con aria-pressed', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['cobrarMonto']);
  assert.equal(await visible(page, '.bloque-monto'), false, 'el bloque solo existe en «Cobrar por partes»');
  await page.getByRole('button', { name: 'Cobrar por partes', exact: true }).click();
  assert.equal(await visible(page, '.bloque-monto'), true);
  const campo = page.locator('#monto-abono');
  assert.equal(await campo.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize)), 16, 'campo de 16 px (iOS no hace zoom)');
  assert.equal(await campo.getAttribute('inputmode'), 'numeric');
  assert.match(await page.locator('.bloque-monto-queda').innerText(), /Queda\s*\$ 97\.000/);
  await campo.fill('99999abc');
  assert.equal(await campo.inputValue(), '99.999', 'el campo deja solo dígitos y los muestra con separador de miles (como el botón)');
  assert.equal(await page.evaluate(() => String(Alpine.store('pos').montoAbono)), '99999', 'el store guarda solo dígitos');
  const boton = page.locator('.bloque-monto .btn-telon');
  await reposo(page);
  assert.equal(await boton.isDisabled(), true, 'un monto mayor que lo pendiente no se puede cobrar');
  assert.equal(await page.locator('#monto-ayuda.invalido').isVisible(), true);
  await campo.fill('30000');
  await reposo(page);
  assert.equal(await boton.isDisabled(), false);
  assert.equal((await boton.innerText()).replace(/\s+/g, ' ').trim(), 'Recibir $ 30.000 · Efectivo', 'el botón dice el monto Y el método');
  assert.match((await page.locator('#monto-ayuda').innerText()).replace(/\s+/g, ' '), /Quedará por pagar \$ 67\.000/, 'y debajo del campo, lo que quedará');
  const chips = page.locator('.bloque-monto .grupo-metodo .opt-chip');
  assert.deepEqual(await chips.allInnerTexts().then((l) => l.map((x) => x.trim())), ['Efectivo', 'QR', 'Transferencia']);
  assert.equal(await chips.nth(0).getAttribute('aria-pressed'), 'true', 'por defecto, efectivo');
  await chips.nth(1).click();
  await reposo(page);
  assert.equal(await chips.nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await chips.nth(0).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => Alpine.store('pos').metodoAbono), 'qr');
  assert.equal((await boton.innerText()).replace(/\s+/g, ' ').trim(), 'Recibir $ 30.000 · QR');
  // El abono NO se registra de un toque: el botón abre la confirmación, con el monto, el método y lo que quedará.
  await boton.click();
  await reposo(page);
  assert.deepEqual(await espias(page), [], 'el botón todavía no cobró');
  const modal = page.locator('.modal', { hasText: 'Confirmar abono' });
  assert.equal(await modal.isVisible(), true);
  assert.match((await modal.innerText()).replace(/\s+/g, ' '), /Abono de \$ 30\.000 por QR en la mesa 3\. Quedan por pagar \$ 67\.000\./);
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await reposo(page);
  assert.deepEqual(await espias(page), [], 'cancelar no cobra');
  await boton.click();
  await reposo(page);
  await modal.getByRole('button', { name: 'Sí, recibir', exact: true }).click();
  assert.deepEqual(await espias(page), [['cobrarMonto']]);
  // Cada chip y el botón miden al menos 44 px de alto.
  for (const e of [boton, ...(await chips.all())]) assert.ok((await e.boundingBox()).height >= 44);
});

test('b2 (navegador): cobro por unidades: «Cobrar [−] n [+] de qty» de 1 a qty y la barra suma solo lo elegido', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden', 390); if (!a) return;
  const { page } = a;
  await page.getByRole('button', { name: 'Cobrar por partes', exact: true }).click();
  const limonada = page.locator('.order-item', { hasText: 'Limonada de coco' });
  assert.equal(await limonada.locator('.sel-unidades').isVisible(), false, 'sin marcar no hay selector');
  await limonada.getByRole('checkbox').check();
  await reposo(page);
  const sel = limonada.locator('.sel-unidades');
  assert.equal(await sel.isVisible(), true);
  assert.equal((await sel.locator('.qty-val').innerText()).trim(), '3', 'marcar toma las unidades completas');
  assert.equal(await sel.getByRole('button', { name: 'Cobrar una unidad más' }).isDisabled(), true, 'ya está en qty');
  await sel.getByRole('button', { name: 'Cobrar una unidad menos' }).click();
  await reposo(page);
  assert.equal((await sel.locator('.qty-val').innerText()).trim(), '2');
  assert.match(await sel.innerText(), /\$ 26\.000/);
  // Bajo 1024 el cobro de lo marcado va en la barra de abajo (un solo coral, un solo importe); la barra telón de arriba y la carta no salen.
  assert.equal(await page.locator('.barra-partes').isVisible(), false, 'bajo 1024 no hay segunda barra coral arriba');
  assert.equal(await page.locator('.carta-en-parcial').isVisible(), false, 'ni la carta: en este modo no se agregan productos');
  const cobrar = page.locator('.barra-accion .btn-primary:visible');
  assert.equal(await cobrar.count(), 1, 'un solo botón de cobro a la vista');
  assert.equal((await cobrar.innerText()).replace(/\s+/g, ' ').trim(), 'Cobrar $ 26.000');
  assert.equal(await page.getByRole('button', { name: 'Generar ticket y cobrar' }).isVisible(), false);
  assert.match(await page.locator('.barra-accion .text-label').innerText(), /total|queda por pagar/i);
  await sel.getByRole('button', { name: 'Cobrar una unidad menos' }).click();
  await reposo(page);
  assert.equal(await sel.getByRole('button', { name: 'Cobrar una unidad menos' }).isDisabled(), true, 'el piso es 1');
  // Una línea de una sola unidad no abre selector; los botones del selector miden 44 px.
  await page.locator('.order-item', { hasText: 'Empanadas de la casa' }).getByRole('checkbox').check();
  await reposo(page);
  assert.equal(await page.locator('.order-item', { hasText: 'Empanadas de la casa' }).locator('.sel-unidades').isVisible(), false);
  for (const b of await sel.locator('.qty-btn').all()) { const r = await b.boundingBox(); assert.ok(r.width >= 44 && r.height >= 44, `${r.width}×${r.height}`); }
  await limonada.getByRole('checkbox').uncheck();
  await reposo(page);
  assert.equal(await sel.isVisible(), false);
});

test('b2 (navegador): personal: el alta llama a altaPersonal(correo, nombre, rol); eliminar y el cambio de rol piden confirmar en la página; el error se ve', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'personal', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['altaPersonal', 'eliminarPersonal', 'cambiarRolPersonal']);
  // El formulario no ocupa la primera pantalla: «Agregar persona» lo despliega.
  assert.equal(await page.locator('.alta-persona').isVisible(), false, 'la lista del equipo se ve de entrada, sin formulario');
  await page.getByRole('button', { name: 'Agregar persona', exact: true }).click();
  await reposo(page);
  const alta = page.getByRole('button', { name: 'Dar de alta', exact: true });
  assert.equal(await alta.isDisabled(), true, 'sin correo y nombre no se puede dar de alta');
  await page.locator('#persona-correo').fill('nueva.demo@ejemplo.test');
  await page.locator('#persona-nombre').fill('Nueva Demo');
  await page.locator('.alta-persona').getByRole('button', { name: 'Admin', exact: true }).click();
  await reposo(page);
  assert.equal(await alta.isDisabled(), false);
  await alta.click();
  assert.deepEqual(await espias(page), [['altaPersonal', 'nueva.demo@ejemplo.test', 'Nueva Demo', 'admin']]);
  await reposo(page);
  assert.equal(await page.locator('#persona-correo').inputValue(), '', 'sin error, el formulario se limpia');
  assert.equal(await page.locator('.alta-persona').isVisible(), false, 'y se vuelve a plegar');
  // Dar de baja (en Equipo; a una solicitud pendiente se la «Rechaza») con confirmación sobre la fila del mesero (la activa; «Exmesero Demo» también contiene «Mesero Demo»).
  const fila = page.locator('.persona-fila:not(.inactiva)', { hasText: 'Mesero Demo' });
  await fila.getByRole('button', { name: 'Dar de baja', exact: true }).click();
  await reposo(page);
  assert.match(await fila.innerText(), /¿Dar de baja a Mesero Demo\?/);
  await fila.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await reposo(page);
  await fila.getByRole('button', { name: 'Dar de baja', exact: true }).click();
  await reposo(page);
  await fila.getByRole('button', { name: 'Sí, dar de baja', exact: true }).click();
  await reposo(page);
  assert.deepEqual((await espias(page))[1], ['eliminarPersonal', 'mesero.demo@ejemplo.test']);
  // El espía no cambia los datos: la fila sigue activa. Elegir otro rol pide confirmar en la página (el store ya no usa
  // confirm(): sería doble pregunta); «Cancelar» devuelve el selector al rol de la fila y no llama a nada.
  await fila.locator('select').selectOption('admin');
  await reposo(page);
  assert.match(await fila.innerText(), /¿Cambiar a Mesero Demo a Admin\?/);
  assert.equal((await espias(page)).length, 2, 'elegir el rol todavía no llama a cambiarRolPersonal');
  await fila.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await reposo(page);
  assert.equal(await fila.locator('select').inputValue(), 'mesero', 'cancelar devuelve el selector al rol de la fila');
  assert.equal((await espias(page)).length, 2);
  await fila.locator('select').selectOption('admin');
  await reposo(page);
  await fila.getByRole('button', { name: 'Sí, cambiar', exact: true }).click();
  await reposo(page);
  assert.deepEqual((await espias(page))[2], ['cambiarRolPersonal', 'mesero.demo@ejemplo.test', 'admin']);
  assert.equal(await fila.locator('select').inputValue(), 'mesero', 'con el espía los datos no cambian: el selector vuelve al rol que sigue siendo el de la fila');
  // La fila ya de baja ofrece volver a dar acceso, con los datos que tiene.
  const exfila = page.locator('.persona-fila', { hasText: 'Exmesero Demo' });
  assert.equal(await exfila.getByText('Sin acceso', { exact: true }).isVisible(), true);
  await exfila.getByRole('button', { name: 'Volver a dar acceso', exact: true }).click();
  assert.deepEqual((await espias(page)).at(-1), ['altaPersonal', 'ex.mesero.demo@ejemplo.test', 'Exmesero Demo', 'mesero', true], 'reactivar es un alta cuyo error se muestra en la fila');
  // El error de la última operación sale arriba, como alerta.
  await page.evaluate(() => { Alpine.store('pos').personalError = 'Ese correo ya está en la lista.'; });
  await reposo(page);
  assert.equal(await page.locator('[role=alert]:visible', { hasText: 'Ese correo ya está en la lista.' }).count(), 1);
  assert.equal(await page.locator('.persona-error:visible').count(), 0, 'un error que no es de una fila no aparece dentro de ninguna');
  // Ronda 2 (crítica visual, punto 9): el error de una baja o un cambio de rol sale DENTRO de la fila de esa persona (no arriba, fuera de pantalla).
  await page.evaluate(() => { const s = Alpine.store('pos'); s.personalError = 'Debe quedar al menos un admin activo.'; s.personalErrorDe = 'mesero.demo@ejemplo.test'; });
  await reposo(page);
  assert.equal(await fila.locator('.persona-error').isVisible(), true, 'dentro de la fila de Mesero Demo');
  assert.equal(await page.locator('[role=alert]:visible', { hasText: 'Debe quedar al menos un admin' }).count(), 1, 'una sola vez: arriba no se repite');
  // «Tú»: la fila de quien tiene la sesión lleva su marca.
  assert.equal(await page.locator('.chip-tu:visible').count() <= 1, true);
});

test('b2 (navegador): roles: el mesero no ve borrar producto, cerrar el día, editar cerradas ni rotar el token; sí crea y edita productos', { skip: SALTAR }, async (t) => {
  const medir = async (rol) => {
    const a = await abrir(t, 'productos', 1440, { rol }); if (!a) return null;
    const { page } = a;
    const r = {};
    r.nuevo = await page.getByRole('button', { name: 'Nuevo producto', exact: true }).isVisible();
    r.editar = await page.locator('section:visible').getByRole('button', { name: 'Editar', exact: true }).first().isVisible();
    r.eliminar = await page.locator('section:visible').getByRole('button', { name: 'Eliminar', exact: true }).first().isVisible();
    await page.evaluate(() => { Alpine.store('pos').vista = 'cierre'; });
    await reposo(page);
    r.cerrarDia = await page.getByRole('button', { name: 'Cerrar día', exact: true }).isVisible();
    r.avisoCierre = await page.getByText('Solo el administrador cierra el día').isVisible();
    r.editarTurno = await page.locator('section:visible .history-row').first().getByRole('button', { name: 'Editar', exact: true }).isVisible();
    r.historial = await page.getByText('Historial de cierres').isVisible();
    r.editarHistorial = await page.locator('section:visible button[title="Editar"]').first().isVisible();
    r.eliminarHistorial = await page.locator('section:visible button[title="Eliminar"]').first().isVisible();
    r.adminLink = await page.locator('.nav-destinos .nav-link', { hasText: 'Administración' }).isVisible();   // ola C, ronda 5: la única entrada de lo del admin
    await page.evaluate(() => { const p = Alpine.store('pos'); p.vista = 'admin'; });
    await reposo(page);
    r.tablero = await page.locator('section:visible h1', { hasText: 'Administración' }).count() > 0;
    await page.evaluate(() => { const p = Alpine.store('pos'); p.vista = 'menu'; });
    await reposo(page);
    r.vistaMenu = await page.locator('section:visible h1', { hasText: 'Menú semanal' }).count() > 0;
    await page.evaluate(() => { const p = Alpine.store('pos'); p.vista = 'mesas'; });
    await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^3$/ }) }).click();
    await page.getByRole('button', { name: 'Enlace NFC', exact: true }).click();
    await reposo(page);
    r.rotar = await page.getByRole('button', { name: 'Rotar', exact: true }).isVisible();
    r.copiar = await page.getByRole('button', { name: 'Copiar', exact: true }).isVisible();
    return r;
  };
  const mesero = await medir('mesero'); if (!mesero) return;
  assert.deepEqual(mesero, { nuevo: true, editar: true, eliminar: false, cerrarDia: false, avisoCierre: true, editarTurno: false, historial: true,
    editarHistorial: false, eliminarHistorial: false, adminLink: false, tablero: false, vistaMenu: false, rotar: false, copiar: true }, 'mesero');
  const admin = await medir('admin'); if (!admin) return;
  assert.deepEqual(admin, { nuevo: true, editar: true, eliminar: true, cerrarDia: true, avisoCierre: false, editarTurno: true, historial: true,
    editarHistorial: true, eliminarHistorial: true, adminLink: true, tablero: true, vistaMenu: true, rotar: true, copiar: true }, 'admin');
});

test('b2 (navegador): «sin acceso»: explica, muestra la cuenta, oculta el POS y Salir cierra la sesión', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'sin-acceso', 390); if (!a) return;
  const { page } = a;
  const texto = await page.locator('.sin-acceso').innerText();
  assert.match(texto, /Esta cuenta aún no tiene acceso/i);
  assert.match(texto, /no está dada de alta en el personal/);
  assert.match(texto, /Habla con el administrador/);
  assert.match(texto, /mesero\.demo@ejemplo\.test/, 'dice con qué cuenta entró');
  assert.equal(await visible(page, '.nav-bar'), false, 'el POS no se ve');
  assert.equal(await visible(page, '.mesa-card'), false);
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await page.waitForFunction(() => window.__posSim.llamadas.some((l) => l.tipo === 'auth.signOut'));
});

test('b2 (navegador): las vistas nuevas no desbordan en horizontal y ningún control mide menos de 44 px (360 y 1440)', { skip: SALTAR }, async (t) => {
  const vistas = ['alertas', 'personal', 'sin-acceso', 'orden-cobro-unidades', 'orden-cobro-monto', 'orden-cobro-abono', 'mesas-alertas', 'cierre-mesero'];
  const fallas = [];
  for (const ancho of [360, 1440]) for (const vista of vistas) {
    const a = await abrir(t, vista, ancho); if (!a) return;
    const r = await a.page.evaluate(() => {
      const visibleEl = (e) => { if (!e.getClientRects().length) return false; for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return !(getComputedStyle(e).position === 'absolute' && e.getBoundingClientRect().width <= 1); };
      const chicos = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter(visibleEl)
        .map((e) => { const b = e.getBoundingClientRect(); return { n: `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} «${(e.getAttribute('aria-label') || e.textContent || e.type).trim().slice(0, 20)}»`, w: b.width, h: b.height }; })
        .filter((x) => x.w < 43.5 || x.h < 43.5).map((x) => `${x.n} ${Math.round(x.w)}×${Math.round(x.h)}`);
      return { desborde: document.documentElement.scrollWidth - innerWidth, chicos };
    });
    if (r.desborde > 0) fallas.push(`${vista}@${ancho}: desborde de ${r.desborde} px`);
    if (r.chicos.length) fallas.push(`${vista}@${ancho}: ${r.chicos.join('; ')}`);
    if (a.diag.errores.length) fallas.push(`${vista}@${ancho}: errores de consola ${a.diag.errores.join('; ')}`);
    await a.page.context().close();
  }
  assert.deepEqual(fallas, []);
});
