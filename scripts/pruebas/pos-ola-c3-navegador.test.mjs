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
//  10. La fila de destinos desde 768 px (sin «Más»); la respuesta al tocar (y que prefers-reduced-motion la quita).
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
  assert.match(await page.locator('.espera-nota').innerText(), /Solo para mirar/, 'el salón dice que es solo para mirar');
  assert.equal(await page.locator('.espera-mesas .mesa-solo').first().evaluate((e) => getComputedStyle(e).boxShadow), 'none', 'sin la sombra que invita a tocar');
  // «Reintentar» ya no recarga la página en silencio: llama a comprobarEspera() y, si sigue en espera, lo dice.
  await page.evaluate(() => { const p = Alpine.store('pos'); window.__espias = []; p.comprobarEspera = (...a) => { window.__espias.push(['comprobarEspera', ...a]); return Promise.resolve(false); }; });
  await boton(page.locator('.espera-hero'), 'Ya me aprobaron · Reintentar').click();
  assert.deepEqual(await espias(page), [['comprobarEspera']]);
  assert.equal(await page.locator('.espera-sigue').isVisible(), false, 'el aviso de «sigues en espera» solo sale cuando la comprobación lo dijo');
  await page.evaluate(() => { Alpine.store('pos').esperaSigue = true; });
  await reposo(page);
  assert.match(await page.locator('.espera-sigue').innerText(), /Sigues en espera\. Se revisa sola cada 30 segundos\./);
  await page.evaluate(() => { const p = Alpine.store('pos'); p.esperaSigue = false; p.comprobandoEspera = true; });
  await reposo(page);
  assert.match(limpio(await page.locator('.espera-hero .btn-telon').innerText()), /Comprobando…/);
  assert.equal(await page.locator('.espera-hero .btn-telon').isDisabled(), true, 'y no se toca dos veces');
  await page.evaluate(() => { Alpine.store('pos').comprobandoEspera = false; });
  await reposo(page);
  // Salir llama a cerrarSesion (discreto: «Salir y usar otra cuenta»); y la misma pantalla tiene su Salir arriba (ícono).
  await espiar(page, ['abrirMesa', 'cerrarSesion']);
  await boton(page.locator('.espera-hero'), 'Salir y usar otra cuenta').click();
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
  assert.match(await tarjetas.nth(1).innerText(), /Mesero: opera mesas, cobra y atiende alertas/, 'la línea que dice qué es cada rol, a la vista antes de elegir');
  // Rechazar (a una solicitud no se le «da de baja»): pregunta y solo el «Sí» llama.
  await boton(tarjetas.nth(1), 'Rechazar').click();
  await reposo(page);
  assert.match(await tarjetas.nth(1).innerText(), /¿Rechazar a Andrés Demo\? No podrá entrar al POS\./);
  assert.equal((await espias(page)).length, 2);
  await boton(tarjetas.nth(1), 'Sí, rechazar').click();
  assert.deepEqual((await espias(page))[2], ['eliminarPersonal', 'andres.demo@ejemplo.test']);
  // Teléfono: la insignia va sobre «Administración» (Personal cuelga de su tablero), y el nombre accesible la dice.
  const admin = page.locator('.nav-destinos').getByRole('button', { name: /^Administración/ });
  assert.equal(limpio(await admin.getAttribute('aria-label')), 'Administración (2 por revisar)', 'el nombre accesible dice cuántos hay por revisar (aquí, las dos solicitudes)');
  assert.equal(limpio(await page.locator('.nav-destinos .nav-link .insignia', { hasText: '2' }).innerText()), '2');
  // Un error de esa persona sale dentro de su tarjeta.
  await page.evaluate(() => { const p = Alpine.store('pos'); p.personalErrorDe = 'laura.demo@ejemplo.test'; p.personalError = 'Solo un admin puede gestionar el personal.'; });
  await reposo(page);
  assert.match(await tarjetas.nth(0).innerText(), /Solo un admin puede gestionar el personal/);
  assert.deepEqual(a.diag.errores, []);
});

test('c3 (navegador): personal: desde 768 px la insignia va sobre el link «Administración» y sin pendientes no hay sección ni insignia', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'personal-pendientes', 1024); if (!a) return;
  const { page } = a;
  const link = page.locator('.nav-destinos .nav-link', { hasText: 'Administración' });
  assert.equal(limpio(await link.locator('.insignia').innerText()), '2');
  assert.match(await link.innerText(), /Administración/);
  assert.equal(await link.evaluate((e) => e.classList.contains('active')), true, 'dentro de Personal, la entrada «Administración» queda activa');
  // La insignia no tapa la primera letra: termina antes de donde empieza el texto.
  const ins = await link.locator('.insignia').boundingBox();
  const txt = await link.locator('.nav-etiqueta').boundingBox();
  assert.ok(ins.x + ins.width <= txt.x + 2, `la insignia (${ins.x + ins.width}) pisa el texto (${txt.x})`);
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
  // Copiar enlace devuelve si de verdad copió (el espía por defecto devuelve nada): aquí, que sí.
  await page.evaluate(() => { const p = Alpine.store('pos'); p.copiarEnlace = (...a) => { window.__espias.push(['copiarEnlace', ...a]); return Promise.resolve(true); }; });
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
  await t1.getByRole('button', { name: 'Revisar la pegatina de la mesa 1', exact: true }).click();
  assert.deepEqual((await espias(page)).slice(1), [['escribirPegatina', 1], ['revisarPegatina', 1]]);
  // «Revisar» (corto: «Revisar pegatina» se partía en dos líneas) va junto a «Escribir pegatina», que es el paso siguiente; «Copiar enlace» después.
  const orden = (await t1.locator('.mesa-adm-acciones').first().locator('button:visible').allInnerTexts()).map(limpio);
  assert.deepEqual(orden.map((x) => (x === 'Copiado' ? 'Copiar enlace' : x)), ['Escribir pegatina', 'Revisar', 'Copiar enlace'], '(el «Copiado» es de la pulsación de arriba)');
  // Si el portapapeles falla, NO dice «Copiado»: muestra el enlace seleccionado para copiarlo a mano.
  await page.evaluate(() => { const p = Alpine.store('pos'); p.copiarEnlace = (id) => { window.__espias.push(['copiarEnlace', id]); p.enlaceManualId = id; return Promise.resolve(false); }; });
  await boton(t2, 'Copiar enlace').click();
  await reposo(page);
  assert.equal(await boton(t2, 'Copiado').isVisible(), false, 'copiar falló: no puede decir «Copiado»');
  assert.match(await t2.locator('code.nfc-enlace').innerText(), /\/carta\.html\?m=2&k=[0-9a-f]{48}$/, 'el enlace queda a la vista');
  assert.match(await t2.innerText(), /No se pudo copiar solo/);
  await page.evaluate(() => { Alpine.store('pos').enlaceManualId = null; });
  await reposo(page);
  await boton(t9, 'Activar').click();
  assert.deepEqual((await espias(page)).at(-1), ['activarMesa', 9, true]);
  // Lo de menos uso, detrás de «Más opciones».
  assert.equal(await boton(t1, 'Rotar enlace').isVisible(), false);
  await boton(t1, 'Más opciones').click();
  await reposo(page);
  for (const n of ['Puestos', 'Desactivar', 'Rotar enlace', 'Ver enlace']) assert.equal(await (n === 'Puestos' ? t1.getByRole('button', { name: 'Editar la capacidad de la mesa 1', exact: true }) : boton(t1, n)).isVisible(), true, n);
  await boton(t1, 'Ver enlace').click();
  await reposo(page);
  assert.match(await t1.locator('code.nfc-enlace').innerText(), /\/carta\.html\?m=1&k=[0-9a-f]{48}$/);
  await boton(t1, 'Desactivar').click();
  assert.deepEqual((await espias(page)).at(-1), ['activarMesa', 1, false]);
  // Editar capacidad: campo numérico que solo guarda dígitos.
  await t1.getByRole('button', { name: 'Editar la capacidad de la mesa 1', exact: true }).click();
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
  // Agregar mesa (en secundario: es una acción rara; el coral queda para escribir la pegatina).
  assert.match(await boton(page.locator('section:visible'), 'Agregar mesa').first().getAttribute('class'), /btn-secondary/);
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
  assert.equal(await page.getByRole('button', { name: /^Revisar la pegatina de la mesa/ }).first().isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Copiar enlace' }).first().isVisible(), true, 'copiar el enlace sigue');
  const guia = page.locator('.aviso', { hasText: 'se escriben con NFC Tools' });
  assert.equal(await guia.count(), 1, 'una sola guía, no una por tarjeta');
  assert.match(await guia.innerText(), /Toca «Copiar enlace»[\s\S]*NFC Tools[\s\S]*debe abrir la carta de esa mesa[\s\S]*Ya la revisé/, 'tres pasos, y cómo revisarla');
  assert.doesNotMatch(await guia.innerText(), /no escribe/i, 'neutro: no suena a error');
  // Sin NFC no hay forma de saber si quedó escrita: «Ya la escribí» y «Ya la revisé» la anotan, con el token del enlace que se copió.
  await espiar(page, ['marcarPegatinaManual']);
  const tarjeta = page.locator('.mesa-adm').first();
  await tarjeta.getByRole('button', { name: /^Anotar que la pegatina de la mesa 1 ya está escrita$/ }).click();
  await tarjeta.getByRole('button', { name: /^Anotar que la pegatina de la mesa 1 ya está revisada$/ }).click();
  assert.deepEqual(await espias(page), [['marcarPegatinaManual', 1, 'escrita'], ['marcarPegatinaManual', 1, 'revisada']]);
  // Con NFC la guía no sale, ni los botones manuales.
  const b = await abrir(t, 'mesas-admin', 390); if (!b) return;
  assert.equal(await b.page.locator('.aviso', { hasText: 'se escriben con NFC Tools' }).isVisible(), false);
  assert.equal(await b.page.getByRole('button', { name: 'Ya la escribí' }).first().isVisible(), false);
});

// ───────────────────────── 4. hoja de NFC ─────────────────────────

test('c3 (navegador): hoja de NFC: esperando (Cancelar llama a cancelarNfc), ok (Listo) y error (Cerrar)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'nfc-esperando', 390); if (!a) return;
  const { page } = a;
  const hoja = page.locator('.nfc-hoja');
  assert.equal(limpio(await hoja.locator('h2').innerText()), 'Escribir pegatina · Mesa 4', 'el título dice la acción (escribir sobrescribe la pegatina que esté cerca)');
  assert.match(await hoja.innerText(), /Acerca la pegatina de la mesa\s4[\s\S]*Tiene que ser la pegatina de la mesa 4[\s\S]*hasta que diga que terminó[\s\S]*Esto no la bloquea/);
  assert.doesNotMatch(await hoja.innerText(), /hasta que vibre/, 'ya no promete una vibración que no era segura');
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
  await espiar(page, ['revisarPegatina', 'reintentarNfc']);
  await page.evaluate(() => { Alpine.store('pos').nfcEstado = { id: 4, fase: 'ok', mensaje: 'Pegatina escrita.', accion: 'escribir' }; });
  await reposo(page);
  assert.equal(await boton(page.locator('.nfc-hoja'), 'Listo').isVisible(), true);
  assert.equal(await page.locator('.nfc-icono.ok').isVisible(), true);
  // Escrita: el paso siguiente (revisarla) a un toque.
  await boton(page.locator('.nfc-hoja .modal-footer'), 'Revisar ahora').click();
  assert.deepEqual(await espias(page), [['revisarPegatina', 4]]);
  // Revisada: solo «Listo» (no hay otro paso).
  await page.evaluate(() => { Alpine.store('pos').nfcEstado = { id: 4, fase: 'ok', mensaje: 'La pegatina está bien.', accion: 'revisar' }; });
  await reposo(page);
  assert.equal(await page.locator('.nfc-hoja .modal-footer').getByRole('button', { name: 'Revisar ahora' }).isVisible(), false);
  assert.equal(limpio(await page.locator('.nfc-hoja h2').innerText()), 'Revisar pegatina · Mesa 4');
  // El fallo típico (se alejó muy pronto) pide volver a intentar: «Reintentar» llama a reintentarNfc().
  await page.evaluate(() => { Alpine.store('pos').nfcEstado = { id: 4, fase: 'error', mensaje: 'Esta no es la pegatina de la mesa 4.', accion: 'escribir' }; });
  await reposo(page);
  assert.match(await page.locator('.nfc-hoja').innerText(), /Esta no es la pegatina de la mesa 4\./);
  await boton(page.locator('.nfc-hoja .modal-footer'), 'Reintentar').click();
  assert.deepEqual((await espias(page)).at(-1), ['reintentarNfc']);
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
  // El rojo sale al SALIR del campo, no con la primera letra tecleada.
  assert.notEqual(await page.locator('#ajuste-url').getAttribute('aria-invalid'), 'true', 'mientras se escribe no se marca en rojo');
  assert.doesNotMatch(await page.locator('#ajuste-url-ayuda').innerText(), /Pega la dirección completa/);
  await page.locator('#ajuste-url').blur();
  await reposo(page);
  assert.match(await page.locator('#ajuste-url-ayuda').innerText(), /Pega la dirección completa: empieza por https:\/\/ y no lleva espacios\./);
  assert.equal(await page.locator('#ajuste-url').getAttribute('aria-invalid'), 'true');
  const qrGuardado = await page.locator('.ajuste-previa .ticket-qr-svg').innerHTML();
  await page.locator('#ajuste-url').fill('https://carta.test/r');
  await reposo(page);
  assert.equal(await guardar.isDisabled(), false);
  assert.equal(await page.evaluate(() => Alpine.store('pos').ajustes.ticketQrUrl), 'https://resplandor.ynt.codes/', 'el store NO cambia con lo que se escribe');
  // La vista previa dibuja el QR de lo que se está escribiendo (no el guardado) y dice su dominio.
  assert.notEqual(await page.locator('.ajuste-previa .ticket-qr-svg').innerHTML(), qrGuardado, 'el QR de la vista previa sigue a la dirección que se escribe');
  assert.match(limpio(await page.locator('.ajuste-previa .ticket-qr span').innerText()), /carta\.test/);
  // Una dirección larga avisa que el QR sale denso.
  await page.locator('#ajuste-url').fill('https://carta.test/' + 'r'.repeat(70));
  await reposo(page);
  assert.match(await page.locator('.ajustes-panel').innerText(), /dirección larga: el QR sale más denso/);
  await page.locator('#ajuste-url').fill('https://carta.test/r');
  await reposo(page);
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
  // Encenderlo desde un QR guardado apagado dibuja el QR (no un cuadro vacío): la vista previa no depende de lo guardado.
  await page.evaluate(() => { const p = Alpine.store('pos'); p.ajustes = { ...p.ajustes, ticketQrVisible: false }; });
  await page.getByRole('switch', { name: 'Mostrar QR' }).click();
  await reposo(page);
  assert.equal(await page.locator('.ajuste-previa .ticket-qr svg').count(), 1, 'con el guardado apagado, encenderlo en el borrador dibuja el QR');
  await page.evaluate(() => { const p = Alpine.store('pos'); p.ajustes = { ...p.ajustes, ticketQrVisible: true }; });
  await page.getByRole('switch', { name: 'Mostrar QR' }).click();
  await reposo(page);
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
  assert.equal(limpio(await aviso.locator('.deshacer-sub').innerText()), 'Mesa 3 · abono', 'a 390 px los segundos se van (la barra de abajo ya muestra el tiempo)');
  assert.equal(await aviso.locator('.deshacer-monto').evaluate((e) => getComputedStyle(e).whiteSpace), 'nowrap', 'el monto no se parte entre el «$» y la cifra');
  assert.ok((await aviso.boundingBox()).height <= 80, 'la barra cabe en dos líneas');
  // La barra: 11 de 15 s.
  const escala = await aviso.locator('.deshacer-barra-relleno').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
  assert.ok(Math.abs(escala - 11 / 15) < 0.02, `la barra está en ${escala}, no en 11/15`);
  // Lugar: justo sobre las acciones fijas del ticket (Imprimir), sin tapar ningún botón.
  const av = await caja(page, '.deshacer-aviso');
  const acc = await caja(page, '.ticket-acciones');
  assert.ok(av.y + av.height <= acc.y + 1, `el aviso (termina en ${av.y + av.height}) tapa las acciones del ticket (empiezan en ${acc.y})`);
  assert.ok(acc.y - (av.y + av.height) <= 24, 'y queda pegado a ellas (zona del pulgar)');
  assert.ok(Math.abs(acc.height - 132) <= 1, `sin la caja las acciones son dos filas: 8,25 rem = 132 px (miden ${acc.height} px)`);
  // El marcado MIDE las acciones (ResizeObserver) y pone su alto real en --pos-ticket-acciones: con la caja en línea y «Reabrir» son tres filas
  // (integracion-correcciones.test.mjs lo mide así, a cuatro anchos), y la variable las sigue.
  const medida = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pos-ticket-acciones')));
  assert.ok(Math.abs(acc.height - medida) <= 1, `--pos-ticket-acciones (${medida} px) no coincide con las acciones del ticket (${acc.height} px)`);
  // Y no tapa ni se pega a «Imprimir»: con un ticket corto (un abono) las acciones van al pie y quedan al menos 8 px de aire.
  assert.ok(acc.y - (av.y + av.height) >= 4, `el aviso (termina en ${av.y + av.height}) se pega a las acciones (empiezan en ${acc.y})`);
  const imp = await boton(page.locator('.ticket-acciones'), 'Imprimir').boundingBox().catch(() => null);
  if (imp) assert.ok(av.y + av.height <= imp.y, '«Deshacer» no se solapa con «Imprimir»');
  // El botón mide 44 px y llama a deshacerUltimoCobro.
  const bt = await boton(aviso, 'Deshacer').boundingBox();
  assert.ok(bt.width >= 44 && bt.height >= 44, `${bt.width}×${bt.height}`);
  await boton(aviso, 'Deshacer').click();
  assert.deepEqual(await espias(page), [['deshacerUltimoCobro']]);
  // Mientras se deshace, el botón se apaga (un toque a la vez).
  await page.evaluate(() => { Alpine.store('pos').deshaciendo = true; });
  await reposo(page);
  assert.equal(await boton(aviso, 'Deshacer').isDisabled(), true);
  await page.evaluate(() => { Alpine.store('pos').deshaciendo = false; });
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

test('c3 (navegador): deshacer el cobro (sin ventana): cinco tipos con su texto, lo que vuelve y el total resultante, y confirma antes de llamar', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'cierre-devolver', 390); if (!a) return;
  const { page } = a;
  await espiar(page, ['devolverACuenta']);
  const botones = page.locator('.devolver-btn:visible');
  assert.equal(await botones.count(), 5, 'las cinco ventas que la lógica real de puedeDevolver acepta (no hay ventana de tiempo)');
  assert.deepEqual((await botones.allInnerTexts()).map(limpio).sort(), [
    'Deshacer · pasar a la cuenta de Mesa 3',
    'Deshacer · reabrir la Mesa 2',
    'Deshacer · reabrir la Mesa 5',
    'Devolver a la cuenta de Mesa 3',
    'Devolver a la cuenta de Mesa 6',
  ].sort());
  // Un abono de antes (sin la cuenta de la que salió) no se puede deshacer: no ofrece el botón.
  const viejo = page.locator('.history-row', { hasText: 'Mesa 7' }).first();
  assert.equal(await viejo.locator('.devolver-btn:visible').count(), 0, 'un abono sin cuenta no ofrece el botón');
  // Cada venta dice lo que es: Facturada, Cobro parcial o Abono.
  assert.deepEqual((await page.locator('.fila-tx .chip').allInnerTexts()).map(limpio).sort(), ['Abono', 'Abono', 'Cobro parcial', 'Facturada', 'Facturada', 'Facturada'].sort());
  for (const b of await botones.all()) { const r = await b.boundingBox(); assert.ok(r.height >= 44, `${r.height}`); }
  // Un cobro parcial: dice qué vuelve y cómo queda la cuenta.
  const fila = page.locator('.history-row', { hasText: 'Cobro parcial' });
  await boton(fila, 'Devolver a la cuenta de Mesa 3').click();
  await reposo(page);
  const txt = limpio(await fila.locator('.persona-confirma').innerText());
  assert.match(txt, /Vuelve a la cuenta de la Mesa 3: 1 × Limonada de coco \(\$ 13\.000\)\./);
  assert.match(txt, /la cuenta pasa de \$ 97\.000 a \$ 110\.000\./);
  assert.match(txt, /Queda anotado quién lo deshizo\./, 'la trazabilidad se dice antes de tocar');
  assert.deepEqual(await espias(page), [], 'todavía no llamó a nada');
  await boton(fila, 'Cancelar').click();
  await reposo(page);
  assert.equal(await boton(fila, 'Devolver a la cuenta de Mesa 3').isVisible(), true, 'cancelar devuelve el botón');
  await boton(fila, 'Devolver a la cuenta de Mesa 3').click();
  await boton(fila, 'Sí, deshacer el cobro').click();
  assert.deepEqual(await espias(page), [['devolverACuenta', 'ord-parcial-3']]);
  // Un abono: se quita el abono y la cuenta sube (la cuenta de la mesa 6 ya tenía descontados esos $ 20.000).
  const filaAbono = page.locator('.history-row', { hasText: 'Devolver a la cuenta de Mesa 6' });
  await boton(filaAbono, 'Devolver a la cuenta de Mesa 6').click();
  await reposo(page);
  const txtAbono = limpio(await filaAbono.locator('.persona-confirma').innerText());
  assert.match(txtAbono, /Se quita el abono de \$ 20\.000 de las ventas y vuelve a la cuenta de la Mesa 6: pasa de \$ 50\.000 a \$ 70\.000\./);
  // Un importe no se parte entre el «$» y la cifra.
  for (const s of await filaAbono.locator('.persona-confirma .tabular').all()) assert.equal(await s.evaluate((e) => getComputedStyle(e).whiteSpace), 'nowrap');
  // El cobro completo de una mesa LIBRE la reabre; el de una mesa con otra cuenta pasa sus ítems a ella.
  const filaLibre = page.locator('.history-row', { hasText: 'Deshacer · reabrir la Mesa 2' });
  await boton(filaLibre, 'Deshacer · reabrir la Mesa 2').click();
  await reposo(page);
  assert.match(limpio(await filaLibre.locator('.persona-confirma').innerText()), /la Mesa 2 vuelve a estar abierta con 3 × Seco con proteína, 3 × Jugo natural\./);
  const filaFusion = page.locator('.history-row', { hasText: 'Deshacer · pasar a la cuenta de Mesa 3' });
  await boton(filaFusion, 'Deshacer · pasar a la cuenta de Mesa 3').click();
  await reposo(page);
  assert.match(limpio(await filaFusion.locator('.persona-confirma').innerText()), /La Mesa 3 ya tiene otra cuenta abierta\. Se quita esta venta de \$ 98\.000 de las ventas y sus ítems pasan a esa cuenta: pasa de \$ 97\.000 a \$ 195\.000\./);
  await boton(filaFusion, 'Sí, deshacer el cobro').click();
  assert.deepEqual((await espias(page)).at(-1), ['devolverACuenta', 'ord-hoy-1']);
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

test('c3 (navegador): el cierre del día enseña «Cobros deshechos hoy» (solo admin): quién, mesa, monto y hora; el mesero no lo ve', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'cierre-deshechos', 390); if (!a) return;
  const { page } = a;
  const tarjeta = page.locator('[aria-labelledby="deshechos-titulo"]');
  assert.equal(limpio(await tarjeta.locator('h2').innerText()), 'Cobros deshechos hoy');
  assert.equal(limpio(await tarjeta.locator('.chip').first().innerText()), '3 cobros · $ 109.000', 'cuántos y cuánto');
  const filas = tarjeta.locator('.deshecho-fila');
  assert.equal(await filas.count(), 3);
  const t0 = limpio(await filas.nth(0).innerText());
  assert.match(t0, /Mesa 2 Mesa completa/);
  assert.match(t0, /camila/, 'quién (la parte del correo antes de la arroba)');
  assert.match(t0, /\$ 63\.000/);
  assert.match(t0, /\d{1,2}:\d{2}/, 'a qué hora');
  assert.match(limpio(await filas.nth(1).innerText()), /Mesa 6 Abono.*mesero\.demo.*\$ 20\.000/);
  assert.match(limpio(await filas.nth(2).innerText()), /Mesa 3 Cobro parcial.*\$ 26\.000/);
  // No pisa nada: va entre las transacciones y «Cerrar día», sin desborde.
  const sinDesborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(sinDesborde, 0);
  // Sin deshechos: «Nadie deshizo cobros hoy».
  await page.evaluate(() => { Alpine.store('pos').deshechosFilas = []; });
  await reposo(page);
  assert.match(await tarjeta.innerText(), /Nadie deshizo cobros hoy\./);
  assert.equal(limpio(await tarjeta.locator('.chip').first().innerText()), '0 cobros · $ 0');
  // El mesero no la ve (la base tampoco se la daría).
  await page.evaluate(() => { Alpine.store('pos').rol = 'mesero'; });
  await reposo(page);
  assert.equal(await tarjeta.isVisible(), false, 'solo el admin');
  assert.deepEqual(a.diag.errores, []);
});

test('c3 (navegador): los avisos del pulgar: «Cobro deshecho», y el de una solicitud nueva con «Ver» que lleva a Personal', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'aviso-aprobado', 390); if (!a) return;
  const { page } = a;
  const aviso = page.locator('.toast-aviso-cuerpo');
  assert.match(limpio(await aviso.innerText()), /Hay una solicitud nueva: Laura Demo\. Revísala en Personal\. Ver$/);
  await aviso.click();
  await reposo(page);
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'personal', '«Ver» lleva a Personal: dos toques en vez de buscarla en el tablero');
  assert.equal(await page.locator('.toast-aviso-cuerpo').count() > 0 && await page.locator('.toast-aviso-cuerpo').first().isVisible(), false, 'y el aviso se va');
  // Un aviso sin acción solo se cierra, con «Entendido».
  await page.evaluate(() => { Alpine.store('pos').avisar('Cobro deshecho · $ 26.000 volvió a la cuenta de Mesa 3'); });
  await reposo(page);
  assert.match(limpio(await page.locator('.toast-aviso-cuerpo').innerText()), /Cobro deshecho · \$ 26\.000 volvió a la cuenta de Mesa 3 Entendido$/);
  await page.locator('.toast-aviso-cuerpo').click();
  await reposo(page);
  assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'personal', 'sin acción no navega');
  assert.equal(await page.evaluate(() => Alpine.store('pos').aviso), null);
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 9. «+3 Paloma» ─────────────────────────

test('c3 (navegador): «+3 Paloma · van 7»: sobre la barra de cobro, a la izquierda (sin tapar la columna de los «+») y sin tapar los toques; con otro toque se vuelve a montar', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-agregado', 390); if (!a) return;
  const { page } = a;
  const aviso = page.locator('.agregado-aviso');
  assert.equal(limpio(await aviso.innerText()), '+3 Paloma · van 7', 'dice cuántas lleva ya la línea: el pedido va arriba del catálogo y no se ve al agregar');
  assert.equal(await aviso.evaluate((e) => getComputedStyle(e).pointerEvents), 'none');
  const av = await caja(page, '.agregado-aviso');
  const barra = await caja(page, '.barra-accion');
  assert.ok(av.y + av.height <= barra.y + 1 && barra.y - (av.y + av.height) <= 16, 'justo sobre la barra de cobro');
  assert.ok(av.x + av.width / 2 < 390 / 2 + 40, 'a la izquierda (sobre «TOTAL»): a la derecha taparía la columna de los «+», que es donde se toca');
  for (const mas of await page.locator('.qty-btn:visible').all()) {
    const m = await mas.boundingBox();
    assert.ok(m.x >= av.x + av.width - 1 || m.y + m.height <= av.y || m.y >= av.y + av.height, 'ningún botón «+» queda bajo la píldora');
  }
  // Los toques pasan: lo que hay bajo la píldora no es la píldora.
  const bajo = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.agregado-aviso') === null, [av.x + av.width / 2, av.y + av.height / 2]);
  assert.equal(bajo, true);
  // Otro toque: «+4 Paloma» con otra marca de tiempo, y el elemento es nuevo (saltito).
  await page.evaluate(() => { window.__nodo = document.querySelector('.agregado-aviso'); Alpine.store('pos').agregadoReciente = { nombre: 'Paloma', qty: 4, ts: Date.now() + 1, van: 8 }; });
  await reposo(page);
  assert.equal(limpio(await aviso.innerText()), '+4 Paloma · van 8');
  assert.equal(await page.evaluate(() => window.__nodo !== document.querySelector('.agregado-aviso')), true, 'se vuelve a montar con cada toque');
  await page.evaluate(() => { Alpine.store('pos').agregadoReciente = null; });
  await reposo(page);
  assert.equal(await page.locator('.agregado-aviso').count(), 0);
  assert.deepEqual(a.diag.errores, []);
});

// ───────────────────────── 10. la fila de destinos desde 768 y respuesta al tocar ─────────────────────────

test('c3 (navegador, enmendado en la ronda 5): desde 768 px la fila del admin son cuatro links (Mesas, Productos, Cierre del día, Administración) que caben sin recortar; el mesero tiene tres', { skip: SALTAR }, async (t) => {
  for (const ancho of [768, 1024, 1440]) {
    const a = await abrir(t, 'mesas', ancho); if (!a) return;
    const { page } = a;
    const enlaces = (await page.locator('.nav-destinos .nav-link:visible').allInnerTexts()).map(limpio);
    assert.deepEqual(enlaces, ['Mesas', 'Productos', 'Cierre del día', 'Administración'], `${ancho}: la fila del admin`);
    assert.equal(await page.locator('.nav-mas-wrap, #nav-mas').count(), 0, `${ancho}: ya no hay «Más»`);
    // Los links de la fila caben sin recortar: ningún link se sale de la ventana y todos miden ≥ 44 px de alto.
    const fila = await page.locator('.nav-fila').boundingBox();
    for (const l of await page.locator('.nav-destinos .nav-link:visible').all()) {
      const r = await l.boundingBox();
      assert.ok(r.x >= -1 && r.x + r.width <= ancho + 1, `${ancho}: un link se sale de la ventana (${r.x}..${r.x + r.width})`);
      assert.ok(r.height >= 44, `${ancho}: un link mide ${r.height} px de alto`);
    }
    assert.ok(fila.width <= ancho + 1);
    assert.deepEqual(a.diag.errores, []);
  }
  // El mesero: sin «Administración» y con sus tres links.
  const b = await abrir(t, 'mesas', 768, { rol: 'mesero' }); if (!b) return;
  assert.deepEqual((await b.page.locator('.nav-destinos .nav-link:visible').allInnerTexts()).map(limpio), ['Mesas', 'Productos', 'Cierre del día']);
});

test('c3 (navegador): respuesta al tocar: los botones y las mesas se hunden al presionar; con prefers-reduced-motion no se mueven', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas', 390); if (!a) return;
  const { page } = a;
  const escala = async (selector) => {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
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
  // Un botón: usamos el botón principal de la vista de cierre (arriba).
  await page.evaluate(() => { Alpine.store('pos').vista = 'cierre'; });
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
  'mesas-admin-sin-nfc', 'mesas-admin-rotar', 'mesas-admin-editar', 'mesas-admin-agregar', 'nfc-esperando', 'nfc-revisando', 'nfc-ok', 'nfc-error', 'ajustes', 'ajustes-invalido',
  'ajustes-sin-qr', 'deshacer-ticket', 'deshacer-mesas-alerta', 'cierre-devolver', 'cierre-devolver-confirma', 'cierre-devolver-abono', 'cierre-deshechos', 'orden-agregado',
  'ticket-pie-ajustado', 'ticket-sin-qr', 'ticket-completo', 'aviso-cobro-deshecho', 'aviso-aprobado'];

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
