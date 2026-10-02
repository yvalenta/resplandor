// Imprimir en la caja (POS), EN NAVEGADOR: la pantalla se comporta como promete con el arnés (Supabase simulado, con la cola de impresión
// y un «agente» que cambia el estado a mano). Es el complemento de pos-impresion-caja.test.mjs (lógica en vm) y de
// pos-impresion-caja-estatica.test.mjs (marcado y CSS). Solo corre si hay Playwright con Chromium; si no, se salta con el motivo.
// Nunca toca Supabase: el arnés lo reemplaza por un stub en memoria.
//
//   1. Orden        UN solo «Imprimir precuenta»: con la caja en línea abre «En la caja / En este teléfono» (nada sale solo); «En la caja»
//                   inserta el documento, la pantalla no cambia y el aviso sigue En cola → Imprimiendo → Impreso, o Error con Reintentar
//   2. Sin caja     sin la cola, con la caja apagada o rechazada: el POS de siempre y window.print()
//   3. Ticket       «Imprimir en la caja» en coral y «En este teléfono» secundario; el papel no cambia ni una línea
//   4. Admin        la pantalla de la impresora (se llega por la tarjeta del tablero de Administración): crear, token una sola vez, copiar,
//                   rotar con confirmación; el mesero no entra
//   5. Medidas      sin desborde horizontal y sin controles de menos de 44 px en las vistas nuevas, a 360 y 1440 px
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

async function abrir(t, vista, ancho, opciones = {}) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    const { diag } = await abrirPos(page, { url: servidor.url, vista, dirCache: DIR_CACHE, ...opciones });
    return { page, diag };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}
const reposo = (page) => page.waitForTimeout(200);
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const impresiones = (page) => page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.insert' && l.tabla === 'impresiones').map((l) => l.carga));
const filas = (page) => page.evaluate(() => window.__posSim.tablas.impresiones || []);
const conteoPrint = (page) => page.evaluate(() => window.__posImpresiones || 0);
const aviso = (page) => page.locator('.toast-impresion-fila').first().innerText().then((x) => x.replace(/\s+/g, ' ').trim());
const estado = (page, e, error) => page.evaluate(([e2, m]) => window.__posSim.imprimirAhora(window.__posSim.tablas.impresiones.at(-1).id, e2, m), [e, error]);
const vistaActual = (page) => page.evaluate(() => Alpine.store('pos').vista);
const CAJA = { id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: '2026-09-30T18:29:48.000Z', version_agente: '1.0.0' };
const conCaja = (extra = {}) => (d) => { d.impresoras = [{ ...CAJA, ...extra }]; };
// La precuenta de la orden: UN botón, «Imprimir precuenta». Con la caja en línea abre la elección de destino; sin ella imprime en el teléfono.
const precuentaACaja = async (page) => { await boton(page, 'Imprimir precuenta').click(); await boton(page, 'En la caja').click(); };
const precuentaAlTelefono = async (page) => { await boton(page, 'Imprimir precuenta').click(); await boton(page, 'En este teléfono').click(); };

test('caja (navegador): en la orden hay UN botón «Imprimir precuenta»; con la caja en línea abre «En la caja / En este teléfono», y «En la caja» inserta el documento y deja el estado en vivo sin cambiar de pantalla', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden', 390, { ajustar: conCaja() }); if (!a) return;
  const { page } = a;
  const fila = page.locator('.fila-acciones');
  assert.equal((await fila.locator('button:visible').allInnerTexts()).map((x) => x.trim()).at(-1), 'Imprimir precuenta', 'la precuenta sigue siendo el último botón de la fila');
  assert.equal(await boton(page, 'Imprimir en la caja').count(), 0, 'la orden no trae un segundo botón de impresión: el destino se elige dentro de «Imprimir precuenta»');
  assert.match(await page.locator('.caja-estado:visible').innerText(), /Caja: en línea/);
  assert.equal(await page.locator('#precuenta-destino').isVisible(), false, 'la elección sale al tocar el botón');
  assert.equal(await boton(page, 'Imprimir precuenta').getAttribute('aria-expanded'), 'false');
  await boton(page, 'Imprimir precuenta').click();
  assert.equal(await boton(page, 'Imprimir precuenta').getAttribute('aria-expanded'), 'true');
  assert.deepEqual((await page.locator('#precuenta-destino button:visible').allInnerTexts()).map((x) => x.trim()), ['En la caja', 'En este teléfono']);
  assert.equal(await conteoPrint(page), 0, 'tocar el botón no imprime nada solo');
  assert.equal((await impresiones(page)).length, 0, 'ni manda nada solo');
  await boton(page, 'Imprimir precuenta').click();
  await reposo(page);
  assert.equal(await page.locator('#precuenta-destino').isVisible(), false, 'tocarlo otra vez la cierra');

  await boton(page, 'Imprimir precuenta').click();
  await boton(page, 'En la caja').click();
  await reposo(page);
  assert.equal(await page.locator('#precuenta-destino').isVisible(), false, 'al elegir, la elección se cierra');
  await page.locator('.toast-impresion-fila').first().waitFor();
  const [doc] = await impresiones(page);
  assert.equal(doc.tipo, 'cuenta');
  assert.equal(doc.mesa_id, 3);
  assert.equal(doc.impresora_id, 'impresora-1');
  assert.equal(doc.contenido.titulo, 'Resplandor');
  assert.ok(doc.contenido.lineas.some((l) => l.texto === '2 x Ejecutivo de la casa' && l.der === '$ 42.000'));
  assert.ok(doc.contenido.lineas.some((l) => l.texto === 'TOTAL' && l.der === '$ 97.000'));
  assert.equal(await vistaActual(page), 'orden', 'no cambia de pantalla');
  assert.equal(await conteoPrint(page), 0, 'el teléfono no imprime');
  assert.equal(await aviso(page), 'Cuenta · Mesa 3 En cola en la caja…');

  await estado(page, 'imprimiendo');
  await page.getByText('Imprimiendo en la caja…').waitFor();
  await estado(page, 'impresa');
  await page.getByText('Impreso en la caja', { exact: true }).waitFor();
  assert.equal(await page.locator('.toast-impresion-fila').first().evaluate((e) => e.classList.contains('es-ok')), true);
  await page.locator('.toast-impresion-fila').first().getByRole('button', { name: 'Cerrar este aviso' }).click();
  await reposo(page);
  assert.equal(await page.locator('.toast-impresion').isVisible(), false);
  assert.deepEqual(a.diag.errores, [], 'sin errores de consola');
});

test('caja (navegador): un error se ve con su motivo y «Reintentar» manda el mismo documento; «la caja no responde» se explica sin esconder nada', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden', 390, { ajustar: conCaja() }); if (!a) return;
  const { page } = a;
  await precuentaACaja(page);
  await page.locator('.toast-impresion-fila').first().waitFor();
  await estado(page, 'error', 'la impresora no tiene papel');
  await boton(page, 'Reintentar').waitFor();
  assert.equal(await aviso(page), 'Cuenta · Mesa 3 Error: la impresora no tiene papel. Reintentar');
  assert.equal(await page.locator('.toast-impresion-fila').first().evaluate((e) => e.classList.contains('es-error')), true);
  await boton(page, 'Reintentar').click();
  await page.waitForFunction(() => (window.__posSim.tablas.impresiones || []).length === 2);
  const [primero, segundo] = await impresiones(page);
  assert.notEqual(segundo.id, primero.id, 'un trabajo nuevo, con su propio id');
  assert.deepEqual({ ...segundo, id: null }, { ...primero, id: null }, 'el mismo documento');
  assert.equal(await page.locator('.toast-impresion-fila').count(), 1, 'el fallido se reemplaza');
  assert.equal(await aviso(page), 'Cuenta · Mesa 3 En cola en la caja…');

  await page.evaluate(() => { Alpine.store('pos').cajaTrabajos[0].sinRespuesta = true; });
  await page.getByText('La caja no responde').waitFor();
  assert.match(await aviso(page), /Sigue en cola y sale cuando el PC vuelva \(hasta 15 min\); si no puedes esperar, imprime desde este teléfono y se cancela el de la caja\./, 'el aviso nombra el botón de siempre; en el ticket sigue llamándose «Imprimir» sin la caja y «En este teléfono» con ella');
  assert.equal(await page.locator('.toast-impresion-fila').first().evaluate((e) => e.classList.contains('es-espera')), true);
});

test('caja (navegador): la X de un aviso en cola cancela el trabajo; con la caja imprimiendo no hay X; y «En este teléfono» de la precuenta cancela lo que quedó sin respuesta', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden', 390, { ajustar: conCaja() }); if (!a) return;
  const { page } = a;
  const x = () => page.locator('.toast-impresion-fila').first().locator('.toast-impresion-cerrar');
  await precuentaACaja(page);
  await page.locator('.toast-impresion-fila').first().waitFor();
  await x().waitFor({ state: 'visible' });                  // en cola: la X cancela
  assert.equal(await x().getAttribute('aria-label'), 'Cancelar en la caja y cerrar este aviso');
  await estado(page, 'imprimiendo');
  await page.getByText('Imprimiendo en la caja…').waitFor();
  await x().waitFor({ state: 'hidden' });                   // con la caja imprimiendo no hay X: el aviso se va solo al terminar
  await estado(page, 'impresa');
  await page.getByText('Impreso en la caja', { exact: true }).waitFor();
  await x().waitFor({ state: 'visible' });
  assert.equal(await x().getAttribute('aria-label'), 'Cerrar este aviso');
  await x().click();
  await reposo(page);

  // en cola → la X cancela en la base
  await precuentaACaja(page);
  await page.locator('.toast-impresion-fila').first().waitFor();
  await x().click();
  await page.waitForFunction(() => (window.__posSim.tablas.impresiones || []).at(-1).estado === 'error');
  assert.equal((await filas(page)).at(-1).error, 'cancelada');
  assert.equal(await page.locator('.toast-impresion-fila').count(), 0, 'el aviso se fue DESPUÉS de cancelar');

  // sin respuesta + «En este teléfono» de la precuenta → cancela el de la caja, y el teléfono imprime
  await precuentaACaja(page);
  await page.locator('.toast-impresion-fila').first().waitFor();
  await page.evaluate(() => { Alpine.store('pos').cajaTrabajos[0].sinRespuesta = true; });
  await precuentaAlTelefono(page);
  await page.waitForFunction(() => (window.__posSim.tablas.impresiones || []).at(-1).estado === 'error');
  assert.equal((await filas(page)).at(-1).error, 'cancelada', 'no queda vivo: no sale una segunda copia al volver el PC');
  assert.equal(await page.locator('.toast-impresion-fila').count(), 0);
  await page.waitForFunction(() => (window.__posImpresiones || 0) === 1);   // el teléfono imprime a los 60 ms de elegir «En este teléfono»
  assert.equal(await conteoPrint(page), 1, 'y el teléfono imprimió');
  assert.deepEqual(a.diag.errores, [], 'sin errores de consola');
});

test('caja (navegador): sin la cola en la base, o con la caja apagada, el POS es el de siempre (sin elección de destino ni indicador) y «Imprimir precuenta» imprime directo en el teléfono', { skip: SALTAR }, async (t) => {
  const sin = await abrir(t, 'orden', 390); if (!sin) return;
  assert.equal(await boton(sin.page, 'Imprimir en la caja').count(), 0);
  assert.equal(await sin.page.locator('.caja-estado:visible').isVisible(), false);
  assert.equal(await sin.page.locator('button.nav-caja').isVisible(), false);
  assert.equal(await boton(sin.page, 'Imprimir precuenta').getAttribute('aria-expanded'), null, 'sin la caja no hay elección que anunciar');
  assert.equal(await sin.page.locator('.precuenta-chevron').isVisible(), false, 'ni chevron');
  await boton(sin.page, 'Imprimir precuenta').click();
  assert.equal(await sin.page.locator('#precuenta-destino').isVisible(), false, 'sin la caja no se pregunta: imprime');
  await sin.page.waitForFunction(() => window.__posImpresiones === 1);
  assert.equal(await vistaActual(sin.page), 'ticket');
  assert.deepEqual(await impresiones(sin.page), []);
  assert.deepEqual(sin.diag.errores, []);

  const apagada = await abrir(t, 'orden', 390, { ajustar: conCaja({ en_linea: false }) }); if (!apagada) return;
  assert.equal(await boton(apagada.page, 'Imprimir en la caja').count(), 0, 'sin latido no se ofrece');
  assert.equal(await boton(apagada.page, 'Imprimir precuenta').getAttribute('aria-expanded'), null, 'con la caja apagada, «Imprimir precuenta» imprime directo (sin elección)');
  assert.match(await apagada.page.locator('.caja-estado:visible').innerText(), /Caja: sin conexión: la cuenta se imprime desde este teléfono\./);
});

test('caja (navegador): si la base rechaza el trabajo, el teléfono imprime él mismo la cuenta y avisa; el mesero nunca se queda sin ticket', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden', 390, { ajustar: (d) => { conCaja()(d); d.impresionFalla = { code: '42501', message: 'new row violates row-level security policy for table "impresiones"' }; } }); if (!a) return;
  const { page } = a;
  await precuentaACaja(page);
  await page.waitForFunction(() => window.__posImpresiones === 1);
  assert.equal(await vistaActual(page), 'ticket', 'se ve el ticket que se imprime');
  assert.match(await page.locator('.toast-aviso-txt').innerText(), /La base no dejó mandar el ticket a la caja .* Se imprime desde este teléfono\./);
  assert.equal(await page.locator('.toast-impresion').isVisible(), false, 'sin un «en cola» colgado');
});

test('caja (navegador): el ticket ofrece «Imprimir en la caja» en coral y el del teléfono pasa a «En este teléfono», secundario; sin caja queda solo «Imprimir» en coral; el papel no cambia', { skip: SALTAR }, async (t) => {
  const con = await abrir(t, 'ticket', 390, { ajustar: conCaja() }); if (!con) return;
  const { page } = con;
  const clases = (nombre) => boton(page, nombre).evaluate((e) => e.className);
  assert.match(await clases('Imprimir en la caja'), /btn-primary/);
  assert.match(await clases('En este teléfono'), /btn-secondary/);
  assert.equal(await boton(page, 'Imprimir').count(), 0, 'con la caja en línea, el del teléfono se llama «En este teléfono» (las mismas dos palabras que la elección de la precuenta)');
  assert.equal(await page.locator('.ticket-acciones .btn-primary:visible').count(), 1, 'un solo coral por pantalla');
  assert.match(await page.locator('.caja-estado:visible').innerText(), /Caja: en línea/);
  const papelCon = await (async () => { await page.emulateMedia({ media: 'print' }); const x = await page.locator('.print-zone').innerText(); await page.emulateMedia({ media: 'screen' }); return x; })();
  const lineaDelTicket = page.locator('.caja-estado.print\\:hidden');
  assert.equal(await lineaDelTicket.evaluate((e) => getComputedStyle(e).display), 'flex');
  await page.emulateMedia({ media: 'print' });
  assert.equal(await lineaDelTicket.evaluate((e) => getComputedStyle(e).display), 'none', 'la línea de estado no sale en el papel');
  await page.emulateMedia({ media: 'screen' });

  await boton(page, 'Imprimir en la caja').click();
  await page.locator('.toast-impresion-fila').first().waitFor();
  const [doc] = await impresiones(page);
  assert.equal(doc.tipo, 'ticket');
  assert.equal(doc.contenido.titulo, 'Resplandor');
  assert.equal(await aviso(page), 'Ticket · Mesa 3 En cola en la caja…');
  assert.ok(doc.contenido.lineas.some((l) => l.texto === 'TOTAL' && l.der === '$ 97.000'));
  assert.equal(await conteoPrint(page), 0);
  await boton(page, 'En este teléfono').click();
  await page.waitForFunction(() => window.__posImpresiones === 1);

  const sin = await abrir(t, 'ticket', 390); if (!sin) return;
  assert.equal(await boton(sin.page, 'Imprimir en la caja').count(), 0);
  assert.match(await boton(sin.page, 'Imprimir').evaluate((e) => e.className), /btn-primary/);
  await sin.page.emulateMedia({ media: 'print' });
  const papelSin = await sin.page.locator('.print-zone').innerText();
  assert.equal(papelCon, papelSin, 'el ticket de papel es idéntico con y sin la caja');
});

test('caja (navegador): el admin crea la impresora, ve el token UNA vez (copiar y config.json), y al salir de la pantalla se olvida', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'caja-admin-vacia', 1440); if (!a) return;
  const { page } = a;
  await page.evaluate(() => { window.__copiado = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (x) => { window.__copiado.push(x); } } }); });
  assert.match(await page.locator('section:visible').innerText(), /Aún no hay una impresora/);
  assert.equal(await page.locator('.caja-token').isVisible(), false);
  await boton(page, 'Agregar impresora').click();
  await page.locator('.caja-token').waitFor();
  const token = await page.locator('#caja-token').inputValue();
  assert.match(token, /^token-falso-/);
  assert.match(await page.locator('.caja-token').innerText(), /solo se muestra esta vez/);
  await boton(page, 'Copiar token').click();
  await page.getByText('Token copiado').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__copiado), [token]);
  await boton(page, 'Copiar config.json').click();
  await page.getByText('Archivo copiado').waitFor();
  const config = JSON.parse((await page.evaluate(() => window.__copiado)).at(-1));
  assert.equal(config.token, token);
  assert.match(config.supabaseUrl, /^https:\/\/.+\.supabase\.co$/);
  assert.match(await page.locator('section:visible').innerText(), /Caja\s+Sin conexión/, 'la impresora aparece, sin latido todavía');
  assert.match(await page.locator('section:visible').innerText(), /Aún no ha latido/);
  // El token jamás se guarda en el navegador.
  const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  assert.ok(!guardado.includes(token), 'ni en localStorage ni en sessionStorage');
  // Al salir de la pantalla se olvida.
  await page.locator('nav.nav-bar button.nav-link', { hasText: 'Mesas' }).click();
  // De vuelta a la impresora como una persona: Administración → tarjeta «Impresora de la caja» → «Configurar impresora».
  await page.locator('nav.nav-bar button.nav-link', { hasText: 'Administración' }).first().click();
  await page.locator('[data-tarjeta="impresora"]').getByRole('button', { name: 'Configurar impresora', exact: true }).click();
  await page.locator('section:visible h1', { hasText: 'Impresora de la caja' }).waitFor();
  assert.equal(await page.locator('.caja-token').isVisible(), false, 'el token no vuelve a mostrarse');
  assert.deepEqual(a.diag.errores, []);
});

test('caja (navegador): rotar pide confirmar dentro de la página, entrega un token nuevo y «Listo, ya lo copié» lo oculta', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'caja-admin', 390); if (!a) return;
  const { page } = a;
  await boton(page, 'Rotar token').click();
  await page.getByText('¿Rotar el token de').waitFor();
  assert.equal(await page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'rpc' && l.nombre === 'impresora_rotar').length), 0, 'todavía no rotó: pide confirmar');
  assert.match(await page.locator('section:visible').innerText(), /El PC deja de imprimir hasta que le pongas el token nuevo/);
  await boton(page, 'Cancelar').click();
  await reposo(page);
  assert.equal(await boton(page, 'Rotar token').isVisible(), true);
  await boton(page, 'Rotar token').click();
  await boton(page, 'Sí, rotar').click();
  await page.locator('.caja-token').waitFor();
  assert.equal(await page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'rpc' && l.nombre === 'impresora_rotar').map((l) => l.args)).then((x) => x.length), 1);
  assert.match(await page.locator('.caja-token h2').innerText(), /Token de «Caja»/);
  await boton(page, 'Listo, ya lo copié').click();
  await reposo(page);
  assert.equal(await page.locator('.caja-token').isVisible(), false);
});

test('caja (navegador): teléfono: a «Impresora de la caja» se llega por la tarjeta del tablero (sin entrada suelta en la barra); el mesero no la tiene y, aunque fuerce la vista, no ve la pantalla', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'caja-admin', 390); if (!a) return;
  const { page } = a;   // (la vista del arnés llega por Administración → tarjeta «Impresora de la caja» → «Configurar impresora»)
  assert.equal(await page.locator('section:visible h1', { hasText: 'Impresora de la caja' }).isVisible(), true);
  assert.equal(await page.evaluate(() => Alpine.store('pos').enAdministracion), true, 'la entrada «Administración» sigue activa dentro de la vista');
  assert.equal(await page.locator('.nav-destinos > .nav-link:visible').count(), 5, 'la barra del admin sigue en cinco: Mesas, Alertas, Productos, Cierre y Admin');
  assert.equal(await page.locator('nav.nav-bar').getByText('Impresora de la caja').count(), 0, 'sin entrada propia en la navegación');
  assert.equal(await page.locator('#nav-mas').count(), 0, 'y ya no existe «Más»');
  await page.locator('.volver-admin:visible').click();
  await page.locator('[data-tarjeta="impresora"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-tarjeta="impresora"] .tarjeta-admin-dato').innerText(), /En línea/, 'la vuelta al tablero cae en su tarjeta, con el estado');

  const m = await abrir(t, 'caja-orden-mesero', 390); if (!m) return;
  await boton(m.page, 'Imprimir precuenta').click();
  await boton(m.page, 'En la caja').waitFor({ state: 'visible' });
  assert.equal(await boton(m.page, 'En la caja').isVisible(), true, 'el mesero SÍ imprime en la caja');
  assert.equal(await m.page.locator('.nav-destinos > .nav-link:visible').count(), 4, 'y sigue con sus 4 destinos');
  await m.page.evaluate(() => { Alpine.store('pos').vista = 'impresora'; });
  await reposo(m.page);
  assert.equal(await m.page.locator('section:visible h1', { hasText: 'Impresora de la caja' }).count(), 0, 'la pantalla del admin no se le muestra');
  assert.equal(await m.page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'rpc' && /^impresora_(crear|rotar)$/.test(l.nombre)).length), 0);
  // Y la base se lo diría igual: el simulador responde 42501 a un mesero.
  const respuesta = await m.page.evaluate(() => Alpine.store('pos').crearImpresora('Otra'));
  assert.equal(respuesta, false);
});

test('caja (navegador): desde 768 px el indicador de la barra dice «Caja: en línea / sin conexión» (no es una entrada: al admin su aviso le ofrece «Configurar»); el mesero lee el estado', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas', 1440, { ajustar: conCaja() }); if (!a) return;
  const { page } = a;
  const barra = page.locator('button.nav-caja');
  assert.equal(await barra.getAttribute('aria-label'), 'Caja: en línea');
  assert.equal(await barra.locator('.caja-punto').evaluate((e) => e.classList.contains('ok')), true);
  await page.evaluate(() => { window.__posSim.impresoras[0].en_linea = false; return Alpine.store('pos').cargarEstadoCaja(); });
  await page.waitForFunction(() => document.querySelector('button.nav-caja').getAttribute('aria-label') === 'Caja: sin conexión');
  assert.equal(await barra.locator('.caja-punto').evaluate((e) => e.classList.contains('off')), true, 'sin conexión: anillo hueco, no solo otro color');
  await barra.click();
  assert.equal(await vistaActual(page), 'mesas', 'el indicador no cambia de pantalla: dice el estado');
  assert.match(await page.locator('.toast-aviso-txt').innerText(), /^Caja: sin conexión\. Mientras no esté en línea/);
  assert.equal((await page.locator('.toast-aviso-cerrar').innerText()).trim(), 'Configurar', 'al admin el aviso le ofrece ir a la impresora');
  await page.locator('.toast-aviso-cuerpo').click();
  assert.equal(await vistaActual(page), 'impresora', '«Configurar» lleva a la vista (por irA, con su permiso)');

  const m = await abrir(t, 'mesas', 1440, { ajustar: (d) => { conCaja()(d); d.rol = 'mesero'; } }); if (!m) return;
  await m.page.locator('button.nav-caja').click();
  assert.equal(await vistaActual(m.page), 'mesas', 'el mesero no abre la pantalla del admin');
  assert.equal(await m.page.locator('.toast-aviso-txt').innerText(), 'Caja: en línea. Las cuentas se imprimen en la impresora de la caja.');
  assert.equal((await m.page.locator('.toast-aviso-cerrar').innerText()).trim(), 'Entendido', 'al mesero no se le ofrece «Configurar»');
  // Sin la cola en la base, la barra queda como siempre.
  const sin = await abrir(t, 'mesas', 1440); if (!sin) return;
  assert.equal(await sin.page.locator('button.nav-caja').isVisible(), false);
});

test('caja (navegador): las vistas nuevas no desbordan en horizontal y ningún control mide menos de 44 px (360 y 1440)', { skip: SALTAR }, async (t) => {
  const vistas = ['caja-orden', 'caja-orden-destino', 'caja-orden-sin-conexion', 'admin-impresora', 'admin-impresora-sin-conexion', 'admin-impresora-sin-configurar', 'caja-estado-cola', 'caja-estado-imprimiendo', 'caja-estado-impreso', 'caja-estado-error', 'caja-estado-sin-respuesta',
    'caja-ticket', 'caja-ticket-sin-conexion', 'caja-admin', 'caja-admin-sin-conexion', 'caja-admin-vacia', 'caja-admin-token', 'caja-admin-rotar'];
  const fallas = [];
  for (const ancho of [360, 1440]) for (const vista of vistas) {
    const a = await abrir(t, vista, ancho); if (!a) return;
    const r = await a.page.evaluate(() => {
      const visibleEl = (e) => { if (!e.getClientRects().length) return false; for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return !(getComputedStyle(e).position === 'absolute' && e.getBoundingClientRect().width <= 1); };
      const chicos = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter(visibleEl)
        .map((e) => { const b = e.getBoundingClientRect(); return { n: `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} «${(e.getAttribute('aria-label') || e.textContent || e.type).trim().slice(0, 20)}»`, w: b.width, h: b.height }; })
        .filter((x) => x.w < 43.5 || x.h < 43.5).map((x) => `${x.n} ${Math.round(x.w)}×${Math.round(x.h)}`);
      const fuera = [...document.querySelectorAll('.toast-impresion-fila, .caja-token, .caja-fila, .caja-estado')].filter(visibleEl)
        .map((e) => ({ c: e.className.split(' ')[0], r: e.getBoundingClientRect() })).filter((x) => x.r.left < -0.5 || x.r.right > innerWidth + 0.5).map((x) => x.c);
      return { desborde: document.documentElement.scrollWidth - innerWidth, chicos, fuera };
    });
    if (r.desborde > 0) fallas.push(`${vista}@${ancho}: desborde de ${r.desborde} px`);
    if (r.chicos.length) fallas.push(`${vista}@${ancho}: ${r.chicos.join('; ')}`);
    if (r.fuera.length) fallas.push(`${vista}@${ancho}: fuera de la pantalla ${r.fuera.join(', ')}`);
    if (a.diag.errores.length) fallas.push(`${vista}@${ancho}: errores de consola ${a.diag.errores.join('; ')}`);
    await a.page.context().close();
  }
  assert.deepEqual(fallas, []);
});
