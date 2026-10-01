// Ola C, parte c3, EN NAVEGADOR: la pantalla del POS se comporta como promete con el arnés (Supabase simulado). Es el complemento de
// pos-ola-c3.test.mjs (estática, corre siempre). Esta solo corre si hay Playwright con Chromium y los CDN de Tailwind, Alpine y Lucide
// (la primera vez se guardan en $TMP/resplandor-pos-cdn o en $POS_CDN_CACHE); si no, se salta con el motivo. Nunca toca Supabase.
//
// Cómo prueba: las funciones del store que escriben (aprobarPersonal, eliminarPersonal, crearMesa, escribirPegatina, guardarAjustes,
// deshacerUltimoCobro, devolverACuenta…) se REEMPLAZAN por espías: lo que se comprueba es que el marcado las llama con los argumentos
// del contrato, y eso vale igual con el relleno del contrato del arnés que con la lógica real de c2. Lo que el marcado solo LEE (estado
// de acceso, pendientes, mesas del panel, ajustes, ultimoCobro) se fija en el store.
//   1. Espera de aprobación: sustituye al POS; el salón es de solo lectura; pestañas; «eliminado» sin pestañas; se cierra al aprobarla.
//   2. Personal: pendientes con sus tres acciones (mesero de un toque; admin y eliminar con confirmación) y la insignia con el contador.
//   3. Mesas y pegatinas: copiar, escribir, revisar, editar, activar, rotar (con advertencia) y agregar; sin NFC no hay escribir ni revisar.
//   4. Hoja de NFC: sus tres fases y Cancelar.
//   5. Ajustes: el borrador no toca el store hasta guardar; validación; guardar manda los nombres del contrato.
//   6. Ticket: el pie y el QR salen de los ajustes; sin QR no se rompe; en papel térmico el QR mide 18 mm.
//   7. Deshacer: el aviso, su botón, la barra, su lugar sobre las acciones del ticket y bajo el aviso de alertas, sin red y rol.
//   8. Devolver a la cuenta: confirmación con lo que vuelve y el total resultante.
//   9. «+3 Paloma»: sobre la barra de cobro y sin tapar los toques.
//  10. «Más» desde 768 px; la respuesta al tocar (y que prefers-reduced-motion la quita).
//  11. Sin desborde horizontal y sin controles de menos de 44 px en las vistas nuevas, a 360 y 1440 px.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Abre una vista del arnés; si no hay red para los CDN, salta la prueba con el motivo (y devuelve null). */
async function abrir(t, vista, ancho, { rol } = {}) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const alto = { 360: 780, 390: 844, 768: 1024, 1024: 768, 1440: 900 }[ancho] || 900;
    const ctx = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
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
/** Alpine muestra con x-show dentro de un setTimeout y los x-for tardan un tic: tras cada acción se deja asentar. */
const reposo = (page) => page.waitForTimeout(200);
const visible = async (page, selector) => { await reposo(page); return page.locator(selector).first().isVisible(); };
const boton = (loc, nombre) => loc.getByRole('button', { name: nombre, exact: true });
const caja = async (page, selector) => { const b = await page.locator(selector).first().boundingBox(); assert.ok(b, `no hay caja para ${selector}`); return b; };
const limpio = (txt) => txt.replace(/\s+/g, ' ').trim();

// ───────────────────────── 1. espera de aprobación ─────────────────────────

test('c3 (navegador): espera de aprobación: sustituye al POS, el salón es de solo lectura y se cierra sola al aprobarla', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'espera', 390); if (!a) return;
  const { page } = a;
  assert.equal(await visible(page, '.espera-pantalla'), true);
  assert.equal(await visible(page, 'nav.nav-bar'), false, 'el POS no se ve mientras espera');
  assert.equal(await visible(page, '.sin-acceso'), false, 'ni la pantalla fría de «sin acceso»');
  assert.equal(limpio(await page.locator('#espera-titulo').innerText()), 'Tu cuenta espera aprobación');
  assert.match(await page.locator('.espera-hero').innerText(), /Pídele a Camila o al admin que te apruebe/);
  assert.match(await page.locator('.espera-hero').innerText(), /mesero\.demo@ejemplo\.test/);
  // Solo lectura: diez mesas que NO son botones, y ni una puede abrir nada.
  assert.equal(await page.locator('.espera-mesas .mesa-solo').count(), 10);
  assert.equal(await page.locator('.espera-mesas button, .espera-mesas a').count(), 0);
  assert.match(await page.locator('.espera-mesas .mesa-solo').nth(2).innerText(), /3\s+Ocupada/);
  assert.match(await page.locator('.espera-mesas .mesa-solo').nth(0).innerText(), /1\s+Libre/);
  await espiar(page, ['abrirMesa', 'cerrarSesion']);
  await page.locator('.espera-mesas .mesa-solo').nth(2).click();
  assert.deepEqual(await espias(page), [], 'tocar una mesa no hace nada');
  // Pestañas: Mesas / Carta.
  assert.equal(await page.getByRole('tab', { name: 'Mesas' }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tab', { name: 'Carta' }).click();
  await reposo(page);
  assert.equal(await page.getByRole('tab', { name: 'Carta' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.espera-mesas').isVisible(), false);
  assert.equal(await page.locator('.espera-categoria').count(), 4, 'Ejecutivos, Entradas, Platos Fuertes y Bebidas');
  assert.match(await page.locator('.espera-categoria').first().innerText(), /Ejecutivo de la casa[\s\S]*\$ 21\.000/);
  assert.equal(await page.locator('.espera-categoria button').count(), 0, 'la carta tampoco agrega nada');
  // Salir llama a cerrarSesion; y la misma pantalla tiene su Salir arriba (ícono) y en la tarjeta.
  await boton(page.locator('.espera-hero'), 'Salir').click();
  assert.deepEqual(await espias(page), [['cerrarSesion']]);
  // Variante «eliminado»: sin pestañas, sin mesas ni carta.
  await page.evaluate(() => { Alpine.store('pos').estadoAcceso = 'eliminado'; });
  await reposo(page);
  assert.equal(limpio(await page.locator('#espera-titulo').innerText()), 'Esta cuenta no tiene acceso');
  assert.equal(await page.locator('.espera-vista').isVisible(), false);
  // Al aprobarla, la pantalla se va y el POS aparece, sin recargar.
  await page.evaluate(() => { Alpine.store('pos').estadoAcceso = 'aprobado'; });
  await reposo(page);
  assert.equal(await page.locator('.espera-pantalla').isVisible(), false);
  assert.equal(await page.locator('nav.nav-bar').isVisible(), true);
  assert.deepEqual(a.diag.errores, [], 'sin errores de consola');
});

// ───────────────────────── 2. personal: pendientes ─────────────────────────

test('c3 (navegador): personal: pendientes con «Aprobar como mesero» de un toque, admin y eliminar con confirmación, y la insignia del contador', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'personal-pendientes', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['aprobarPersonal', 'eliminarPersonal']);
  assert.equal(limpio(await page.locator('#pendientes-titulo').innerText()), 'Pendientes (2)');
  const tarjetas = page.locator('.pendiente-tarjeta');
  assert.equal(await tarjetas.count(), 2);
  assert.match(await tarjetas.nth(0).innerText(), /Laura Demo[\s\S]*laura\.demo@ejemplo\.test[\s\S]*Pidió acceso hace 12 min/);
  assert.match(await tarjetas.nth(1).innerText(), /Andrés Demo[\s\S]*Pidió acceso hace 1 día/);
  // Mesero: un toque.
  await boton(tarjetas.nth(0), 'Aprobar como mesero').click();
  assert.deepEqual(await espias(page), [['aprobarPersonal', 'laura.demo@ejemplo.test', 'mesero']]);
  // Admin: primero pregunta, y solo el «Sí» llama.
  await boton(tarjetas.nth(0), 'Aprobar como admin').click();
  await reposo(page);
  assert.match(await tarjetas.nth(0).innerText(), /¿Aprobar a Laura Demo como admin\?[\s\S]*cerrar el día[\s\S]*personal/);
  assert.equal((await espias(page)).length, 1, 'elegir admin todavía no llama');
  await boton(tarjetas.nth(0), 'Cancelar').click();
  await reposo(page);
  assert.equal(await boton(tarjetas.nth(0), 'Aprobar como admin').isVisible(), true, 'cancelar vuelve a los tres botones');
  await boton(tarjetas.nth(0), 'Aprobar como admin').click();
  await boton(tarjetas.nth(0), 'Sí, aprobar como admin').click();
  assert.deepEqual((await espias(page))[1], ['aprobarPersonal', 'laura.demo@ejemplo.test', 'admin']);
  // Eliminar: pregunta y solo el «Sí» llama.
  await boton(tarjetas.nth(1), 'Eliminar').click();
  await reposo(page);
  assert.match(await tarjetas.nth(1).innerText(), /¿Eliminar a Andrés Demo\? No podrá entrar al POS\./);
  assert.equal((await espias(page)).length, 2);
  await boton(tarjetas.nth(1), 'Sí, eliminar').click();
  assert.deepEqual((await espias(page))[2], ['eliminarPersonal', 'andres.demo@ejemplo.test']);
  // Teléfono: la insignia va sobre «Más» (Personal queda dentro), y el nombre accesible la dice.
  const mas = page.getByRole('button', { name: /^Más/ });
  assert.match(limpio(await mas.innerText()), /Más \(2 por aprobar\)/, 'el nombre accesible de «Más» dice cuántos hay por aprobar');
  assert.equal(limpio(await page.locator('.nav-destinos .nav-link-mas .insignia').innerText()), '2');
  await mas.click();
  await reposo(page);
  assert.match(limpio(await page.locator('#nav-mas .nav-mas-item', { hasText: 'Personal' }).innerText()), /2 Personal/);
  // Un error de esa persona sale dentro de su tarjeta.
  await page.evaluate(() => { const p = Alpine.store('pos'); p.personalErrorDe = 'laura.demo@ejemplo.test'; p.personalError = 'Solo un admin puede gestionar el personal.'; });
  await reposo(page);
  assert.match(await tarjetas.nth(0).innerText(), /Solo un admin puede gestionar el personal/);
  assert.deepEqual(a.diag.errores, []);
});

test('c3 (navegador): personal: desde 768 px la insignia va sobre el link «Personal» y sin pendientes no hay sección ni insignia', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'personal-pendientes', 1024); if (!a) return;
  const { page } = a;
  const link = page.locator('.nav-destinos .nav-link', { hasText: 'Personal' });
  assert.equal(limpio(await link.locator('.insignia').innerText()), '2');
  assert.match(await link.innerText(), /Personal/);
  // La insignia no tapa la primera letra: termina antes de donde empieza el texto.
  const ins = await link.locator('.insignia').boundingBox();
  const txt = await link.locator('.nav-etiqueta').boundingBox();
  assert.ok(ins.x + ins.width <= txt.x + 2, `la insignia (${ins.x + ins.width}) pisa el texto (${txt.x})`);
  // «Más» no lleva insignia aquí (Personal es un link de la fila).
  assert.equal(await page.locator('.nav-link-mas .insignia').isVisible(), false);
  await page.evaluate(() => { Alpine.store('pos').personalPendientes = []; });
  await reposo(page);
  assert.equal(await page.locator('#pendientes-titulo').isVisible(), false);
  assert.equal(await link.locator('.insignia').isVisible(), false);
  // El mesero no ve la sección (aunque haya pendientes en el store).
  await page.evaluate(() => { const p = Alpine.store('pos'); p.personalPendientes = [{ email: 'x@ejemplo.test', nombre: 'X', solicitadoEn: Date.now() }]; p.rol = 'mesero'; p.vista = 'personal'; });
  await reposo(page);
  assert.equal(await page.locator('.pendiente-tarjeta').count() > 0 && await page.locator('.pendiente-tarjeta').first().isVisible(), false);
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 3. mesas y pegatinas ─────────────────────────

test('c3 (navegador): mesas y pegatinas con NFC: el estado de cada pegatina y cada acción llama con el número de mesa', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas-admin', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['copiarEnlace', 'escribirPegatina', 'revisarPegatina', 'editarMesa', 'activarMesa', 'rotarTokenMesa', 'crearMesa']);
  const tarjetas = page.locator('.mesa-adm');
  assert.equal(await tarjetas.count(), 10);
  assert.match(await page.locator('section:visible p.tabular').first().innerText(), /9 de 10 mesas activas/);
  const t1 = tarjetas.nth(0), t2 = tarjetas.nth(1), t3 = tarjetas.nth(2), t4 = tarjetas.nth(3), t9 = tarjetas.nth(8);
  assert.match(await t1.innerText(), /Mesa 1[\s\S]*2 puestos[\s\S]*Activa[\s\S]*Escrita hace 3 días[\s\S]*Revisada hoy/);
  assert.match(await t2.innerText(), /Escrita ayer[\s\S]*Sin revisar/);
  assert.match(await t3.innerText(), /4 puestos · Con cuenta abierta[\s\S]*Escrita hace 20 días[\s\S]*Revisada hace 5 días/);
  assert.match(await t4.innerText(), /Pegatina sin escribir[\s\S]*Sin revisar/);
  assert.match(await t9.innerText(), /Inactiva[\s\S]*Mesa inactiva: no sale en el mapa del salón/);
  assert.equal(await boton(t9, 'Activar').isVisible(), true, 'la inactiva ofrece Activar a la vista');
  assert.equal(await boton(t1, 'Activar').isVisible(), false);
  // Copiar enlace: llama con el número y dice «Copiado».
  await boton(t1, 'Copiar enlace').click();
  await reposo(page);
  assert.deepEqual(await espias(page), [['copiarEnlace', 1]]);
  assert.equal(await boton(t1, 'Copiado').isVisible(), true);
  await boton(t1, 'Escribir pegatina').click();
  await boton(t1, 'Revisar pegatina').click();
  assert.deepEqual((await espias(page)).slice(1), [['escribirPegatina', 1], ['revisarPegatina', 1]]);
  await boton(t9, 'Activar').click();
  assert.deepEqual((await espias(page)).at(-1), ['activarMesa', 9, true]);
  // Lo de menos uso, detrás de «Más opciones».
  assert.equal(await boton(t1, 'Rotar enlace').isVisible(), false);
  await boton(t1, 'Más opciones').click();
  await reposo(page);
  for (const n of ['Editar capacidad', 'Desactivar', 'Rotar enlace', 'Ver enlace']) assert.equal(await boton(t1, n).isVisible(), true, n);
  await boton(t1, 'Ver enlace').click();
  await reposo(page);
  assert.match(await t1.locator('code.nfc-enlace').innerText(), /\/carta\.html\?m=1&k=[0-9a-f]{48}$/);
  await boton(t1, 'Desactivar').click();
  assert.deepEqual((await espias(page)).at(-1), ['activarMesa', 1, false]);
  // Editar capacidad: campo numérico que solo guarda dígitos.
  await boton(t1, 'Editar capacidad').click();
  await reposo(page);
  const campo = t1.locator('input');
  assert.equal(await campo.inputValue(), '2');
  await campo.fill('');
  await campo.pressSequentially('a6b');
  assert.equal(await campo.inputValue(), '6', 'solo dígitos');
  await boton(t1, 'Guardar capacidad').click();
  assert.deepEqual((await espias(page)).at(-1), ['editarMesa', 1, 6]);
  // Rotar: advierte primero y solo el «Sí» llama.
  await reposo(page);
  await boton(t1, 'Rotar enlace').click();
  await reposo(page);
  assert.match(await t1.innerText(), /¿Rotar el enlace de la mesa 1\?[\s\S]*La pegatina que está pegada deja de servir y hay que reescribirla/);
  const antes = (await espias(page)).length;
  await boton(t1, 'Cancelar').click();
  await reposo(page);
  assert.equal((await espias(page)).length, antes, 'cancelar no llama');
  await boton(t1, 'Rotar enlace').click();
  await boton(t1, 'Sí, rotar').click();
  assert.deepEqual((await espias(page)).at(-1), ['rotarTokenMesa', 1, { confirmado: true }], 'el panel ya confirmó: el store no vuelve a preguntar con confirm()');
  // Agregar mesa.
  await boton(page.locator('section:visible'), 'Agregar mesa').first().click();
  await reposo(page);
  const guardar = boton(page, 'Guardar mesa');
  assert.equal(await guardar.isDisabled(), true, 'sin número no se guarda');
  await page.locator('#mesa-nueva-num').pressSequentially('1x1');
  assert.equal(await page.locator('#mesa-nueva-num').inputValue(), '11');
  assert.equal(await guardar.isDisabled(), false);
  await guardar.click();
  assert.deepEqual((await espias(page)).at(-1), ['crearMesa', 11, 4]);
  // Un error de la base sale en la pila del pulgar, con «Entendido».
  await page.evaluate(() => { Alpine.store('pos').mesasAdminError = 'Esa mesa ya existe.'; });
  await reposo(page);
  const err = page.locator('.avisos-pulgar .pulgar-error:visible');
  assert.match(await err.innerText(), /Esa mesa ya existe\./);
  await boton(err, 'Entendido').click();
  await reposo(page);
  assert.equal(await page.locator('.avisos-pulgar .pulgar-error:visible').count(), 0);
  assert.deepEqual(a.diag.errores, []);
});

test('c3 (navegador): mesas y pegatinas sin NFC (iPhone): ni escribir ni revisar, y una guía arriba', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas-admin-sin-nfc', 390); if (!a) return;
  const { page } = a;
  assert.equal(await page.evaluate(() => Alpine.store('pos').nfcDisponible), false);
  assert.equal(await page.getByRole('button', { name: 'Escribir pegatina' }).count() > 0 && await page.getByRole('button', { name: 'Escribir pegatina' }).first().isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Revisar pegatina' }).first().isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Copiar enlace' }).first().isVisible(), true, 'copiar el enlace sigue');
  const guia = page.locator('.aviso', { hasText: 'no escribe pegatinas' });
  assert.equal(await guia.count(), 1, 'una sola guía, no una por tarjeta');
  assert.match(await guia.innerText(), /NFC Tools/);
  // Con NFC la guía no sale.
  const b = await abrir(t, 'mesas-admin', 390); if (!b) return;
  assert.equal(await b.page.locator('.aviso', { hasText: 'no escribe pegatinas' }).isVisible(), false);
});

// ───────────────────────── 4. hoja de NFC ─────────────────────────

test('c3 (navegador): hoja de NFC: esperando (Cancelar llama a cancelarNfc), ok (Listo) y error (Cerrar)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'nfc-esperando', 390); if (!a) return;
  const { page } = a;
  const hoja = page.locator('.nfc-hoja');
  assert.equal(limpio(await hoja.locator('h2').innerText()), 'Pegatina de la mesa 4');
  assert.match(await hoja.innerText(), /Acerca el teléfono a la pegatina de la mesa 4…[\s\S]*Esto no la bloquea/);
  assert.equal(await boton(hoja, 'Cancelar').isVisible(), true);
  assert.equal(await boton(hoja, 'Listo').isVisible(), false);
  // Es una hoja inferior en teléfono: pegada al borde de abajo.
  const cuerpo = await hoja.boundingBox();
  assert.ok(Math.abs(cuerpo.y + cuerpo.height - 844) <= 1, `la hoja termina en ${cuerpo.y + cuerpo.height}, no en el borde`);
  // Con el store real, la hoja se cierra porque cancelarNfc() limpia nfcEstado: el espía llama a la verdadera (un espía mudo no cerraría nada).
  await page.evaluate(() => {
    const p = Alpine.store('pos'); const real = p.cancelarNfc.bind(p); window.__espias = [];
    p.cancelarNfc = (...args) => { window.__espias.push(['cancelarNfc', ...args]); return real(...args); };
  });
  await boton(hoja, 'Cancelar').click();
  await reposo(page);
  assert.deepEqual(await espias(page), [['cancelarNfc']]);
  assert.equal(await page.locator('.nfc-hoja').isVisible(), false, 'cancelar cierra la hoja');
  // ok y error.
  await page.evaluate(() => { Alpine.store('pos').nfcEstado = { id: 4, fase: 'ok', mensaje: 'Pegatina escrita.' }; });
  await reposo(page);
  assert.equal(await boton(page.locator('.nfc-hoja'), 'Listo').isVisible(), true);
  assert.equal(await page.locator('.nfc-icono.ok').isVisible(), true);
  await page.evaluate(() => { Alpine.store('pos').nfcEstado = { id: 4, fase: 'error', mensaje: 'Esta no es la pegatina de la mesa 4.' }; });
  await reposo(page);
  assert.match(await page.locator('.nfc-hoja').innerText(), /Esta no es la pegatina de la mesa 4\./);
  assert.equal(await boton(page.locator('.nfc-hoja .modal-footer'), 'Cerrar').isVisible(), true);
  await page.keyboard.press('Escape');
  await reposo(page);
  assert.equal(await page.locator('.nfc-hoja').isVisible(), false, 'Escape también cierra');
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 5. ajustes ─────────────────────────

test('c3 (navegador): ajustes: el borrador no toca el store hasta guardar; la dirección se valida; guardar manda los nombres del contrato', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'ajustes', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['guardarAjustes']);
  const guardar = boton(page, 'Guardar cambios');
  assert.equal(await page.locator('#ajuste-url').inputValue(), 'https://resplandor.ynt.codes/');
  assert.equal(await page.locator('#ajuste-pie').inputValue(), 'Gracias por su visita');
  assert.equal(await page.getByRole('switch', { name: 'Mostrar QR' }).getAttribute('aria-checked'), 'true');
  assert.equal(await guardar.isDisabled(), true, 'sin cambios no hay nada que guardar');
  // Dirección sin https: ayuda en barro y no se puede guardar.
  await page.locator('#ajuste-url').fill('http://carta.test');
  await reposo(page);
  assert.equal(await guardar.isDisabled(), true);
  assert.match(await page.locator('#ajuste-url-ayuda').innerText(), /Debe empezar por https:\/\//);
  assert.equal(await page.locator('#ajuste-url').getAttribute('aria-invalid'), 'true');
  await page.locator('#ajuste-url').fill('https://carta.test/r');
  await reposo(page);
  assert.equal(await guardar.isDisabled(), false);
  assert.equal(await page.evaluate(() => Alpine.store('pos').ajustes.ticketQrUrl), 'https://resplandor.ynt.codes/', 'el store NO cambia con lo que se escribe');
  assert.match(await page.locator('.ajuste-previa').innerText(), /El QR de la vista previa es el de la dirección guardada/);
  // El pie y el interruptor sí son en vivo en la vista previa.
  await page.locator('#ajuste-pie').fill('Vuelve pronto');
  await reposo(page);
  assert.equal(limpio(await page.locator('.ajuste-previa .ticket-footer').innerText()), 'Vuelve pronto');
  assert.match(await page.locator('#ajuste-pie-cuenta').innerText(), /13 \/ 120/);
  assert.equal(await page.locator('.ajuste-previa .ticket-qr').isVisible(), true);
  assert.equal(await page.locator('.ajuste-previa .ticket-qr svg').count(), 1, 'el QR se dibuja con qrTicketSvg');
  await page.getByRole('switch', { name: 'Mostrar QR' }).click();
  await reposo(page);
  assert.equal(await page.locator('.ajuste-previa .ticket-qr').isVisible(), false);
  assert.equal(await page.getByRole('switch', { name: 'Mostrar QR' }).getAttribute('aria-checked'), 'false');
  // «Descartar cambios» vuelve a lo guardado.
  await boton(page, 'Descartar cambios').click();
  await reposo(page);
  assert.equal(await page.locator('#ajuste-url').inputValue(), 'https://resplandor.ynt.codes/');
  assert.equal(await page.locator('#ajuste-pie').inputValue(), 'Gracias por su visita');
  assert.equal(await page.getByRole('switch', { name: 'Mostrar QR' }).getAttribute('aria-checked'), 'true');
  // Guardar.
  await page.locator('#ajuste-url').fill('  https://carta.test/r  ');
  await page.getByRole('switch', { name: 'Mostrar QR' }).click();
  await page.locator('#ajuste-pie').fill('Gracias, vuelva pronto');
  await reposo(page);
  await guardar.click();
  assert.deepEqual(await espias(page), [['guardarAjustes', { ticketQrUrl: 'https://carta.test/r', ticketQrVisible: false, ticketPie: 'Gracias, vuelva pronto' }]]);
  // Un error de la base sale arriba del botón, y «guardado» cuando el store lo dice.
  await page.evaluate(() => { Alpine.store('pos').ajustesError = 'La dirección del QR tiene que empezar por https://.'; });
  await reposo(page);
  assert.match(await page.locator('.ajustes-panel [role=alert]').innerText(), /tiene que empezar por https/);
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 6. ticket ─────────────────────────

test('c3 (navegador): ticket: el pie y el QR salen de los ajustes; apagado, sin dibujo o con una dirección insegura no hay QR ni cuadro roto', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'ticket-pie-ajustado', 390); if (!a) return;
  const { page } = a;
  assert.equal(limpio(await page.locator('.print-zone .ticket-footer').innerText()), 'Gracias por venir. ¡Vuelve pronto!');
  const qr = page.locator('a.ticket-qr');
  assert.equal(await qr.getAttribute('href'), 'https://carta.ejemplo.test/resplandor');
  assert.equal(limpio(await qr.locator('span').innerText()), 'carta.ejemplo.test/resplandor');
  assert.equal(await qr.getAttribute('rel'), 'noopener');
  const svg = await qr.locator('svg').boundingBox();
  assert.ok(Math.abs(svg.width - 72) <= 1 && Math.abs(svg.height - 72) <= 1, `el QR en pantalla mide ${svg.width}×${svg.height}, no 72 px (4,5 rem)`);
  // Apagado desde Ajustes.
  await page.evaluate(() => { const p = Alpine.store('pos'); p.ajustes = { ...p.ajustes, ticketQrVisible: false }; });
  await reposo(page);
  assert.equal(await page.locator('.print-zone .ticket-qr').count(), 0, 'sin QR');
  assert.equal(limpio(await page.locator('.print-zone .ticket-footer').innerText()), 'Gracias por venir. ¡Vuelve pronto!');
  // Visible, pero la librería no dibujó nada (qrTicketSvg vacío): ni enlace ni cuadro roto.
  await page.evaluate(() => {
    const p = Alpine.store('pos');
    Object.defineProperty(p, 'qrTicketSvg', { get() { return ''; }, configurable: true });
    p.ajustes = { ...p.ajustes, ticketQrVisible: true };
  });
  await reposo(page);
  assert.equal(await page.locator('.print-zone .ticket-qr').count(), 0, 'sin dibujo no hay QR');
  // Una dirección que no es https:// no se vuelve un enlace.
  await page.evaluate(() => {
    const p = Alpine.store('pos');
    Object.defineProperty(p, 'qrTicketSvg', { get() { return '<svg viewBox="0 0 1 1"></svg>'; }, configurable: true });
    p.ajustes = { ...p.ajustes, ticketQrUrl: 'javascript:alert(1)' };
  });
  await reposo(page);
  assert.equal(await page.locator('.print-zone .ticket-qr').count(), 0, 'una dirección que no es https:// no sale en el ticket');
  assert.deepEqual(a.diag.errores, []);
});

test('c3 (navegador): ticket térmico: el QR de los ajustes mide 18 mm y el pie conserva su lugar', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'ticket-impreso', 302); if (!a) return;
  const { page } = a;
  const svg = await page.locator('.print-zone .ticket-qr svg').boundingBox();
  assert.ok(Math.abs(svg.width - 68) <= 1.5 && Math.abs(svg.height - 68) <= 1.5, `18 mm = 68 px; mide ${svg.width}×${svg.height}`);
  assert.equal(limpio(await page.locator('.print-zone .ticket-footer').innerText()), 'Gracias por su visita');
  const pie = await page.locator('.print-zone .ticket-footer').boundingBox();
  const q = await page.locator('.print-zone .ticket-qr').boundingBox();
  assert.ok(q.y >= pie.y + pie.height, 'el QR va debajo del texto del pie');
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 7. deshacer ─────────────────────────

test('c3 (navegador): deshacer: «Cobrado $ X · Deshacer» sobre las acciones del ticket, con su cuenta regresiva y sin red no sale', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'deshacer-ticket', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['deshacerUltimoCobro']);
  const aviso = page.locator('.deshacer-aviso');
  assert.equal(limpio(await aviso.locator('.deshacer-monto').innerText()), 'Cobrado $ 20.000');
  assert.equal(limpio(await aviso.locator('.deshacer-sub').innerText()), 'Mesa 3 · abono · 11 s');
  // La barra: 11 de 15 s.
  const escala = await aviso.locator('.deshacer-barra-relleno').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
  assert.ok(Math.abs(escala - 11 / 15) < 0.02, `la barra está en ${escala}, no en 11/15`);
  // Lugar: justo sobre las acciones fijas del ticket (Imprimir), sin tapar ningún botón.
  const av = await caja(page, '.deshacer-aviso');
  const acc = await caja(page, '.ticket-acciones');
  assert.ok(av.y + av.height <= acc.y + 1, `el aviso (termina en ${av.y + av.height}) tapa las acciones del ticket (empiezan en ${acc.y})`);
  assert.ok(acc.y - (av.y + av.height) <= 24, 'y queda pegado a ellas (zona del pulgar)');
  assert.ok(Math.abs(acc.height - 132) <= 1, `--pos-ticket-acciones (8,25 rem = 132 px) no coincide con las acciones del ticket (${acc.height} px)`);
  // El botón mide 44 px y llama a deshacerUltimoCobro.
  const bt = await boton(aviso, 'Deshacer').boundingBox();
  assert.ok(bt.width >= 44 && bt.height >= 44, `${bt.width}×${bt.height}`);
  await boton(aviso, 'Deshacer').click();
  assert.deepEqual(await espias(page), [['deshacerUltimoCobro']]);
  // El mesero también lo ve (la ventana la decide la base); sin red, no.
  await page.evaluate(() => { Alpine.store('pos').rol = 'mesero'; });
  await reposo(page);
  assert.equal(await page.locator('.deshacer-aviso').isVisible(), true, 'el mesero puede deshacer');
  await page.evaluate(() => { Alpine.store('pos').remoto = 'offline'; });
  await reposo(page);
  assert.equal(await page.locator('.deshacer-aviso').count(), 0, 'sin red no hay botón: deshacer necesita la base');
  await page.evaluate(() => { const p = Alpine.store('pos'); p.remoto = 'ok'; p.ultimoCobro = null; });
  await reposo(page);
  assert.equal(await page.locator('.deshacer-aviso').count(), 0, 'sin ultimoCobro no hay aviso');
  assert.deepEqual(a.diag.errores, []);
});

test('c3 (navegador): deshacer y alertas no se pisan: el aviso de una alerta nueva queda debajo y «Deshacer» arriba', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'deshacer-mesas-alerta', 390); if (!a) return;
  const { page } = a;
  const des = await caja(page, '.deshacer-aviso');
  const ale = await caja(page, '.toast-alerta-cuerpo');
  assert.ok(des.y + des.height <= ale.y + 1, `«Deshacer» (termina en ${des.y + des.height}) pisa el aviso de la alerta (empieza en ${ale.y})`);
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('hay-toast-alerta')));
  // Cuando el aviso de la alerta se va (a los 6 s), «Deshacer» baja a su sitio.
  await page.waitForTimeout(6300);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('hay-toast-alerta')), false);
  const solo = await caja(page, '.deshacer-aviso');
  assert.ok(solo.y > des.y, 'sin el aviso de alertas, «Deshacer» baja');
  const nav = await caja(page, '.barra-inferior');
  assert.ok(nav.y - (solo.y + solo.height) <= 12 && nav.y >= solo.y + solo.height, 'y se asienta justo sobre la barra de navegación');
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 8. devolver a la cuenta ─────────────────────────

test('c3 (navegador): devolver a la cuenta: solo donde puedeDevolver, con lo que vuelve y el total resultante, y confirma antes de llamar', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'cierre-devolver', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['devolverACuenta']);
  const botones = page.locator('.devolver-btn:visible');
  assert.equal(await botones.count(), 2, 'solo las dos ventas que puedeDevolver acepta');
  assert.deepEqual((await botones.allInnerTexts()).map(limpio), ['Devolver a la cuenta de Mesa 3', 'Devolver a la cuenta de Mesa 6']);
  const mesa2 = page.locator('.history-row', { hasText: 'Mesa 2' }).first();
  assert.equal(await mesa2.locator('.devolver-btn:visible').count(), 0, 'una venta que no se puede devolver no ofrece el botón');
  for (const b of await botones.all()) { const r = await b.boundingBox(); assert.ok(r.height >= 44, `${r.height}`); }
  // Un cobro parcial: dice qué vuelve y cómo queda la cuenta.
  // Las filas se buscan por el texto de su botón (que sigue en el DOM aunque se esconda): un localizador por «el botón visible» saltaría de fila.
  const fila = page.locator('.history-row', { hasText: 'Devolver a la cuenta de Mesa 3' });
  await boton(fila, 'Devolver a la cuenta de Mesa 3').click();
  await reposo(page);
  const txt = limpio(await fila.locator('.persona-confirma').innerText());
  assert.match(txt, /Vuelve a la cuenta de la Mesa 3: 2 × Pechuga a la plancha, 2 × Limonada de coco \(\$ 98\.000\)\./);
  assert.match(txt, /la cuenta pasa de \$ 97\.000 a \$ 195\.000\./);
  assert.deepEqual(await espias(page), [], 'todavía no llamó a nada');
  await boton(fila, 'Cancelar').click();
  await reposo(page);
  assert.equal(await boton(fila, 'Devolver a la cuenta de Mesa 3').isVisible(), true, 'cancelar devuelve el botón');
  await boton(fila, 'Devolver a la cuenta de Mesa 3').click();
  await boton(fila, 'Sí, devolver').click();
  assert.deepEqual(await espias(page), [['devolverACuenta', 'ord-hoy-1']]);
  // Un abono: se quita el abono y la cuenta sube.
  const filaAbono = page.locator('.history-row', { hasText: 'Devolver a la cuenta de Mesa 6' });
  await boton(filaAbono, 'Devolver a la cuenta de Mesa 6').click();
  await reposo(page);
  const txtAbono = limpio(await filaAbono.locator('.persona-confirma').innerText());
  assert.match(txtAbono, /Se quita el abono de \$ 20\.000 de las ventas y vuelve a la cuenta de la Mesa 6: pasa de \$ 70\.000 a \$ 90\.000\./);
  // Un importe no se parte entre el «$» y la cifra.
  for (const s of await filaAbono.locator('.persona-confirma .tabular').all()) assert.equal(await s.evaluate((e) => getComputedStyle(e).whiteSpace), 'nowrap');
  // El error de deshacer sale dentro de la tarjeta de transacciones.
  await page.evaluate(() => { Alpine.store('pos').deshacerError = 'La cuenta de la mesa 6 ya se cerró: no se puede devolver.'; });
  await reposo(page);
  assert.match(await page.locator('.devolver-error').innerText(), /ya se cerró/);
  assert.equal(await page.locator('.avisos-pulgar .pulgar-error:visible').count(), 0, 'y no se repite en la pila del pulgar');
  await boton(page.locator('.devolver-error'), 'Entendido').click();
  await reposo(page);
  assert.equal(await page.evaluate(() => Alpine.store('pos').deshacerError), '');
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 9. «+3 Paloma» ─────────────────────────

test('c3 (navegador): «+3 Paloma»: sobre la barra de cobro, a la derecha y sin tapar los toques; con otro toque se vuelve a montar', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-agregado', 390); if (!a) return;
  const { page } = a;
  const aviso = page.locator('.agregado-aviso');
  assert.equal(limpio(await aviso.innerText()), '+3 Paloma');
  assert.equal(await aviso.evaluate((e) => getComputedStyle(e).pointerEvents), 'none');
  const av = await caja(page, '.agregado-aviso');
  const barra = await caja(page, '.barra-accion');
  assert.ok(av.y + av.height <= barra.y + 1 && barra.y - (av.y + av.height) <= 16, 'justo sobre la barra de cobro');
  assert.ok(av.x + av.width / 2 > 390 / 2, 'a la derecha, donde están los «+»');
  // Los toques pasan: lo que hay bajo la píldora no es la píldora.
  const bajo = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.agregado-aviso') === null, [av.x + av.width / 2, av.y + av.height / 2]);
  assert.equal(bajo, true);
  // Otro toque: «+4 Paloma» con otra marca de tiempo, y el elemento es nuevo (saltito).
  await page.evaluate(() => { window.__nodo = document.querySelector('.agregado-aviso'); Alpine.store('pos').agregadoReciente = { nombre: 'Paloma', qty: 4, ts: Date.now() + 1 }; });
  await reposo(page);
  assert.equal(limpio(await aviso.innerText()), '+4 Paloma');
  assert.equal(await page.evaluate(() => window.__nodo !== document.querySelector('.agregado-aviso')), true, 'se vuelve a montar con cada toque');
  await page.evaluate(() => { Alpine.store('pos').agregadoReciente = null; });
  await reposo(page);
  assert.equal(await page.locator('.agregado-aviso').count(), 0);
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 10. «Más» desde 768 y respuesta al tocar ─────────────────────────

test('c3 (navegador): desde 768 px «Más» abre un menú justo bajo su botón con Mesas y pegatinas y Ajustes; el mesero no lo tiene', { skip: SALTAR }, async (t) => {
  for (const ancho of [768, 1024, 1440]) {
    const a = await abrir(t, 'mas-escritorio', ancho); if (!a) return;
    const { page } = a;
    const menu = page.locator('#nav-mas');
    assert.deepEqual((await menu.locator('.nav-mas-item:visible').allInnerTexts()).map(limpio), ['Mesas y pegatinas', 'Ajustes'], `${ancho}: Menú semanal y Personal ya son links de la fila`);
    const m = await menu.boundingBox();
    const btn = await page.locator('nav.nav-bar .nav-link-mas').boundingBox();
    const navb = await page.locator('nav.nav-bar').boundingBox();
    assert.ok(Math.abs((m.x + m.width) - (btn.x + btn.width)) <= 2, `${ancho}: el menú termina en ${m.x + m.width} y el botón en ${btn.x + btn.width}`);
    assert.ok(m.y >= navb.y + navb.height - 1, `${ancho}: el menú (${m.y}) debe empezar bajo la barra (${navb.y + navb.height})`);
    assert.ok(btn.width >= 44 && btn.height >= 44, `${ancho}: «Más» mide ${btn.width}×${btn.height}`);
    // Elegir una entrada navega y cierra el menú.
    await menu.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await reposo(page);
    assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'ajustes');
    assert.equal(await page.locator('#nav-mas').isVisible(), false);
    // Los links de la fila caben sin recortar: ningún link se sale de la barra.
    const fila = await page.locator('.nav-fila').boundingBox();
    for (const l of await page.locator('.nav-destinos .nav-link:visible').all()) {
      const r = await l.boundingBox();
      assert.ok(r.x >= -1 && r.x + r.width <= ancho + 1, `${ancho}: un link se sale de la ventana (${r.x}..${r.x + r.width})`);
    }
    assert.ok(fila.width <= ancho + 1);
    assert.deepEqual(a.diag.errores, []);
  }
  // El mesero: sin «Más» y con sus tres links.
  const b = await abrir(t, 'mesas', 768, { rol: 'mesero' }); if (!b) return;
  assert.equal(await b.page.locator('.nav-mas-wrap').isVisible(), false);
  assert.equal((await b.page.locator('.nav-destinos .nav-link:visible').allInnerTexts()).map(limpio).length, 3);
});

test('c3 (navegador): respuesta al tocar: los botones y las mesas se hunden al presionar; con prefers-reduced-motion no se mueven', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas', 390); if (!a) return;
  const { page } = a;
  const escala = async (selector) => {
    const c = await page.locator(selector).first().boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(220);
    const m = await page.locator(selector).first().evaluate((e) => getComputedStyle(e).transform);
    await page.mouse.up();
    return m === 'none' ? 1 : Number(m.match(/matrix\(([^,]+)/)[1]);
  };
  const mesa = '.mesa-card.libre';
  assert.ok(Math.abs(await escala(mesa) - 0.97) < 0.005, 'la mesa se hunde a .97');
  await page.waitForTimeout(150);
  // Un botón: «Más» abre su hoja y dentro un item; usamos la barra inferior (un link con escala en el ícono).
  await page.evaluate(() => { Alpine.store('pos').vista = 'mesas-admin'; });
  await reposo(page);
  assert.ok(Math.abs(await escala('section:visible .btn-primary:visible') - 0.97) < 0.005, 'el botón principal se hunde a .97');
  await page.waitForTimeout(150);
  // Con movimiento reducido no hay escala.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await escala('section:visible .btn-primary:visible'), 1, 'con prefers-reduced-motion no se mueve');
  await page.evaluate(() => { Alpine.store('pos').vista = 'mesas'; });
  await reposo(page);
  assert.equal(await escala(mesa), 1, 'ni la mesa');
});

// ───────────────────────── 11. desborde y 44 px ─────────────────────────

const VISTAS_NUEVAS = ['espera', 'espera-carta', 'espera-eliminado', 'personal-pendientes', 'personal-pendientes-admin', 'personal-pendientes-eliminar', 'mesas-admin',
  'mesas-admin-sin-nfc', 'mesas-admin-rotar', 'mesas-admin-editar', 'mesas-admin-agregar', 'nfc-esperando', 'nfc-ok', 'nfc-error', 'ajustes', 'ajustes-invalido',
  'ajustes-sin-qr', 'deshacer-ticket', 'deshacer-mesas-alerta', 'cierre-devolver', 'cierre-devolver-confirma', 'cierre-devolver-abono', 'orden-agregado',
  'ticket-pie-ajustado', 'ticket-sin-qr'];

test('c3 (navegador): sin desborde horizontal y sin controles de menos de 44×44 en las vistas nuevas, a 360 y 1440 px', { skip: SALTAR }, async (t) => {
  for (const ancho of [360, 1440]) {
    for (const vista of VISTAS_NUEVAS) {
      const a = await abrir(t, vista, ancho); if (!a) return;
      const { page } = a;
      const m = await page.evaluate(() => {
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
      assert.equal(m.scroll, 0, `${vista}@${ancho}: desborde horizontal de ${m.scroll} px`);
      assert.deepEqual(m.salen, [], `${vista}@${ancho}: elementos que se salen por la derecha`);
      assert.deepEqual(m.chicos, [], `${vista}@${ancho}: controles de menos de 44×44`);
      assert.deepEqual(a.diag.errores, [], `${vista}@${ancho}: errores de consola`);
      await page.context().close();
    }
  }
});
