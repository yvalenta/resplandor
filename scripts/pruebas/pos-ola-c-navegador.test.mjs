// Ola C, parte C2, EN NAVEGADOR: la lógica nueva del POS corre en Chromium de verdad (con Alpine envolviendo el store en un Proxy y el stub de
// Supabase de scripts/pruebas/_pos-simulado.mjs). Complementa a pos-ola-c.test.mjs (que corre siempre en un `vm`): lo que solo se ve en un
// navegador es que la librería del QR (archivo local de assets/vendor/) carga sin salir a la red (y que si el archivo no llega el POS sigue entero),
// que un NDEFReader y un AbortController nativos pasan por el Proxy del store sin «Illegal invocation», y que la espera de aprobación no toca la
// base ni la caché de verdad.
//
// Solo corre si hay Playwright con Chromium; si no, se salta con el motivo. Los scripts son locales: lo único que sale a la red es la tipografía de
// Google (la primera vez se guarda en $TMP/resplandor-pos-cdn o en $POS_CDN_CACHE). Nunca toca Supabase: el arnés lo reemplaza por un stub en memoria.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, datosFicticios, esperarListo, nuevoContexto, prepararPagina, servirPos } from './_pos-simulado.mjs';
import { decodificarQr, matrizDeSvg } from './_qr-decodificar.mjs';

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

/** Abre el POS con datos de la ola C; si no se puede abrir (¿sin Chromium, o sin red para la tipografía la primera vez?), salta la prueba con el motivo (y devuelve null). */
async function abrir(t, { ajustar, antes } = {}) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho: 1024, alto: 900 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    if (antes) await antes(page);
    if (!ajustar) throw new Error('falta ajustar');
    const datos = datosFicticios((d) => { d.olaC = true; ajustar(d); });
    const diag = await prepararPagina(page, { url: servidor.url, datos, sesion: true, dirCache: DIR_CACHE });
    return { page, diag, datos, ir: async (despues) => { await despues?.(page, diag); await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' }); await esperarListo(page); } };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador: ${String(e.message).split('\n')[0]}`);
    return null;
  }
}
const store = (page, fn, arg) => page.evaluate(fn, arg);

test('navegador: la librería del QR carga desde assets/vendor/ (sin salir a la red) y el ticket recibe un QR que se lee como la dirección de los ajustes', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { ajustar: () => {} }); if (!a) return;
  const pedidos = [];
  await a.ir(async (page) => { page.on('request', (r) => pedidos.push(r.url())); });
  const { page, diag } = a;
  assert.deepEqual(diag.errores, [], 'ni un error de la página');
  assert.deepEqual(diag.bloqueadas, [], 'ningún pedido a otro host (ni cdnjs: el arnés ya no lo deja pasar)');
  assert.deepEqual(diag.externos, [], 'ni un error de red de otro origen');
  assert.ok(pedidos.some((u) => u.endsWith('/assets/vendor/qrcode-generator-1.4.4.js')), `el navegador pidió el archivo local: ${pedidos.filter((u) => u.includes('qrcode')).join(', ')}`);
  assert.equal(await page.evaluate(() => typeof window.qrcode), 'function', 'la librería cargó');
  const svg = await store(page, () => Alpine.store('pos').qrTicketSvg);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.equal(decodificarQr(matrizDeSvg(svg)).texto, 'https://resplandor.ynt.codes/');
  assert.equal(await store(page, () => Alpine.store('pos').qrLibListo), true, 'y el store lo sabe (repinta el ticket)');
});

test('navegador: si el archivo de la librería del QR no llega (404 o corte de red) el POS sigue entero: el ticket sale SIN QR, sin más errores que el de ese archivo', { skip: SALTAR }, async (t) => {
  for (const [modo, atender] of [['404', (ruta) => ruta.fulfill({ status: 404, contentType: 'text/plain', body: 'no existe' })], ['corte de red', (ruta) => ruta.abort('failed')]]) {
    const a = await abrir(t, { ajustar: () => {} }); if (!a) return;
    await a.ir(async (page) => { await page.route('**/assets/vendor/qrcode-generator-1.4.4.js', atender); });
    const { page, diag } = a;
    assert.equal(await page.evaluate(() => typeof window.qrcode), 'undefined', `${modo}: no hay librería`);
    // Chromium cuenta el archivo que no cargó como un error de consola de la página (es del propio origen).
    const mensajes = [...diag.errores, ...diag.externos];
    assert.ok(mensajes.some((m) => /qrcode-generator-1\.4\.4\.js/.test(m)), `${modo}: el navegador avisó de ese archivo: ${mensajes.join(' | ')}`);
    assert.deepEqual(mensajes.filter((m) => !/qrcode-generator-1\.4\.4\.js/.test(m)), [], `${modo}: y no hay ningún otro error: el POS no se rompió`);
    assert.equal(await store(page, () => Alpine.store('pos').qrTicketSvg), '', `${modo}: sin librería, ticket sin QR`);
    assert.equal(await store(page, () => Alpine.store('pos').qrLibListo), false);
    // El POS sigue cobrando y mostrando el ticket.
    await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^3$/ }) }).click();
    await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
    assert.deepEqual([...diag.errores, ...diag.externos].filter((m) => !/qrcode-generator-1\.4\.4\.js/.test(m)), [], `${modo}: tras abrir una mesa`);
  }
});

test('navegador: una cuenta que espera aprobación ve el mapa de mesas y la carta, y NADA más: ni lecturas de datos, ni Realtime, ni caché', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { ajustar: (d) => { d.rol = null; d.acceso = 'pendiente'; } }); if (!a) return;
  await a.ir(async (page) => {
    await page.addInitScript(() => {   // restos de otra sesión en esta tablet
      localStorage.setItem('pos_ordenes', '[{"id":"viejo","mesaId":9,"estado":"abierta","items":[]}]');
      localStorage.setItem('pos_mesas', '[{"id":9,"token":"secreto"}]');
    });
  });
  const { page } = a;
  const estado = await store(page, () => {
    const p = Alpine.store('pos');
    return {
      acceso: p.estadoAcceso, espera: p.esperaAprobacion, sinAcceso: p.sinAcceso, rol: p.rol, remoto: p.remoto,
      mesas: p.mesasPendiente.map((m) => Object.keys(m).sort().join()), nMesas: p.mesasPendiente.length, nCarta: p.cartaPendiente.length,
      mesasLocal: p.mesas.length, ordenesLocal: p.ordenes.length,
      llamadas: window.__posSim.llamadas.map((c) => (c.tipo === 'rpc' ? `rpc:${c.nombre}` : `${c.tipo}:${c.tabla || c.nombre || ''}`)),
      canales: window.__posSim.canales.length,
      cache: ['pos_mesas', 'pos_ordenes', 'pos_productos', 'pos_cierres', 'pos_rol'].filter((k) => localStorage.getItem(k) !== null),
    };
  });
  assert.equal(estado.acceso, 'pendiente');
  assert.equal(estado.espera, true);
  assert.equal(estado.sinAcceso, false);
  assert.equal(estado.rol, null);
  assert.equal(estado.nMesas, 10);
  assert.equal(new Set(estado.mesas).size, 1, 'todas las filas con las mismas tres columnas');
  assert.equal(estado.mesas[0], 'capacidad,estado,id', 'sin token');
  assert.equal(estado.nCarta, 12);
  assert.deepEqual([estado.mesasLocal, estado.ordenesLocal], [0, 0]);
  assert.deepEqual(estado.llamadas.filter((l) => l !== 'rpc:solicitar_acceso' && l !== 'rpc:vista_pendiente'), ['db.select:carta_publica'], 'solo la carta pública (ni mesas, ni órdenes, ni mi_rol)');
  assert.equal(estado.canales, 0);
  assert.deepEqual(estado.cache, [], 'y la caché de la sesión anterior se borró');
  assert.deepEqual(a.diag.errores, [], 'sin errores de la página');
});

test('navegador: escribir y revisar una pegatina con un NDEFReader y un AbortController NATIVOS atraviesan el Proxy de Alpine; makeReadOnly no se llama nunca', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, {
    ajustar: () => {},
    antes: (page) => page.addInitScript(() => {
      window.__nfc = { escrituras: [], escaneos: 0, soloLectura: 0, lector: null };
      window.NDEFReader = class NDEFReader {
        constructor() { window.__nfc.lector = this; }
        async write(mensaje, opciones) { window.__nfc.escrituras.push({ mensaje: JSON.parse(JSON.stringify(mensaje)), senal: opciones && opciones.signal instanceof AbortSignal }); }
        async scan(opciones) { window.__nfc.escaneos++; window.__nfc.senal = opciones.signal; }
        async makeReadOnly() { window.__nfc.soloLectura++; }
      };
    }),
  }); if (!a) return;
  await a.ir();
  const { page, diag } = a;
  assert.equal(await store(page, () => Alpine.store('pos').nfcDisponible), true);
  await store(page, () => Alpine.store('pos').cargarMesasAdmin());
  assert.equal(await store(page, () => Alpine.store('pos').mesasAdmin.length), 10);

  const enlace = await store(page, () => Alpine.store('pos').mesasAdmin.find((m) => m.id === 3).enlace);
  assert.match(enlace, /\/carta\.html\?m=3&k=[0-9a-f]{48}$/);
  assert.equal(await store(page, () => Alpine.store('pos').escribirPegatina(3)), true);
  const escritura = await page.evaluate(() => window.__nfc.escrituras);
  assert.deepEqual(escritura, [{ mensaje: { records: [{ recordType: 'url', data: enlace }] }, senal: true }]);
  assert.equal(await store(page, () => Alpine.store('pos').nfcEstado.fase), 'ok');
  assert.ok(await store(page, () => Alpine.store('pos').mesasAdmin.find((m) => m.id === 3).escritaEn), 'la fecha de «escrita» quedó anotada por la RPC');
  assert.ok(await page.evaluate(() => window.__posSim.tablas.mesas.find((m) => m.id === 3).pegatina_escrita_en));

  // Revisar: se acerca la pegatina con el mismo enlace.
  const revision = page.evaluate(() => Alpine.store('pos').revisarPegatina(3));
  await page.waitForFunction(() => window.__nfc.escaneos === 1);
  await page.evaluate((url) => window.__nfc.lector.onreading({ message: { records: [{ recordType: 'url', data: new TextEncoder().encode(url) }] } }), enlace);
  assert.equal(await revision, true);
  assert.equal(await store(page, () => Alpine.store('pos').nfcEstado.fase), 'ok');
  assert.equal(await page.evaluate(() => window.__nfc.senal.aborted), true, 'al terminar deja de escuchar');
  assert.ok(await page.evaluate(() => window.__posSim.tablas.mesas.find((m) => m.id === 3).pegatina_revisada_en));
  assert.equal(await page.evaluate(() => window.__nfc.soloLectura), 0, 'makeReadOnly nunca');
  assert.deepEqual(diag.errores, [], 'ni «Illegal invocation» ni ningún otro error');
});

test('navegador: cobrar por unidades y deshacer desde el aviso de 15 s deja la cuenta exacta (stub de la base); el toque en un producto deja «+1» que se acumula', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, { ajustar: () => {} }); if (!a) return;
  await a.ir();
  const { page, diag } = a;
  await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^3$/ }) }).click();
  await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
  await page.locator('.menu-item').first().waitFor();

  // «+1 Limonada de coco», y «+2» al volver a tocar.
  const limonada = page.locator('.menu-item', { hasText: 'Limonada de coco' });
  await limonada.click();
  assert.equal(await store(page, () => Alpine.store('pos').agregadoTexto), '+1 Limonada de coco');
  await limonada.click();
  assert.equal(await store(page, () => Alpine.store('pos').agregadoTexto), '+2 Limonada de coco');

  const antes = await store(page, () => Alpine.store('pos').totalOrdenActiva);
  const cobro = await store(page, async () => {
    const p = Alpine.store('pos');
    p.toggleModoCobroParcial();
    const linea = p.ordenActiva.items.find((i) => i.id === 'be1');
    p.toggleSeleccion(linea);
    p.ajustarCantidadSeleccion(linea, -(linea.qty - 2));
    p.facturarParcial();
    await new Promise((r) => setTimeout(r, 150));
    return { ...p.ultimoCobro, total: p.totalOrdenActiva };
  });
  assert.equal(cobro.tipo, 'parcial');
  assert.equal(cobro.monto, 26000);
  assert.equal(cobro.total, antes - 26000);
  assert.ok(cobro.hasta - Date.now() < 15000 + 60000);   // el reloj del arnés está fijo: solo se comprueba que lleva una hora

  const hecho = await store(page, async () => { const p = Alpine.store('pos'); const ok = await p.deshacerUltimoCobro(); await new Promise((r) => setTimeout(r, 150)); return { ok, total: p.totalOrdenActiva, error: p.deshacerError, aviso: p.aviso && p.aviso.texto, vista: p.vista, ultimo: p.ultimoCobro }; });
  assert.equal(hecho.ok, true, hecho.error);
  assert.equal(hecho.total, antes, 'el total vuelve exacto');
  assert.equal(hecho.aviso, 'Cobro deshecho · $ 26.000 volvió a la cuenta de Mesa 3');
  assert.equal(hecho.vista, 'orden');
  assert.equal(hecho.ultimo, null);
  const enBase = await page.evaluate(() => { const o = window.__posSim.tablas.ordenes; return { cerradasParcial: o.filter((x) => x.parcial_de).length, total: o.find((x) => x.id === 'ord-abierta-3').total }; });
  assert.equal(enBase.cerradasParcial, 0, 'la orden cerrada del cobro se borró en la base');
  assert.equal(enBase.total, antes);
  assert.deepEqual(diag.errores, []);
});
