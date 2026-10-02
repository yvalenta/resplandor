// «Pagar con Bre-B» DE PUNTA A PUNTA: la integración de las tres partes (BD, función `cuenta`, carta y tablero) sin ningún doble entre ellas.
//
//   Postgres 17 desechable con TODAS las migraciones del repo (la cola de impresión y la de Bre-B incluidas)
//     → la Edge Function `cuenta` REAL (supabase/functions/cuenta/index.ts) corriendo contra esa base como `service_role`
//       (con sus GRANT por columna: sin ellos el QR nunca llegaría a la carta)
//     → la carta REAL (carta.html) en Chromium, cuyo `fetch` a `cuenta` cae en esa función (el resto de la red, simulado)
//     → el tablero REAL (pos.html → Ajustes → «Pago con Bre-B») en Chromium, cuyo guardado se aplica a la MISMA base como admin
//       (RLS, GRANT y CHECK de verdad: lo que el tablero manda es lo que la base recibe).
//
// Lo que NO es real aquí, dicho claro: la función `alerta` (la carta le manda su POST y se comprueba el cuerpo; `alerta` no cambia con
// esta tarea y tiene sus propias pruebas), el WebSocket de Realtime (se bloquea supabase-js: la carta cae a sondeo, que es lo que hace
// cuando el canal no conecta), PostgREST (el tablero habla con el stub de _pos-simulado.mjs; su `.update()` se traduce a SQL a mano) y el
// «Verify JWT» de la plataforma.
//
// TODOS los datos de pago son FICTICIOS (_breb-ficticio.mjs y _pago-breb-vectores.mjs): el dato real vive fuera del repo.
// Con EVIDENCIA_PAGO_BREB=<carpeta> guarda capturas de pantalla (solo de esos datos ficticios) y un resumen en JSON.
//
// Corre si hay Docker, Node ≥ 22.18 (la función es .ts) y Playwright con Chromium; si no, se salta con el motivo.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, prepararSimulacion, aplicarMigraciones, DIR_MIGRACIONES } from './_cola-impresion-pg.mjs';
import { cargarFuncion, importarModulo } from './_funcion-simulada.mjs';
import { basePostgres } from './_funcion-pg.mjs';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { decodificarQr, matrizDeSvgConMargen } from './_qr-decodificar.mjs';
import { crearCarta } from './_carta-vm.mjs';
import { LLAVE_FICTICIA, LLAVE_OTRA_FICTICIA, QR_FICTICIO, QR_FICTICIO_CORTO, VECTORES_LLAVE, VECTORES_QR } from './_breb-ficticio.mjs';
import { LLAVES_BUENAS, LLAVES_MALAS, qrMalos, qrDeLargo, llaveQrVectores } from './_pago-breb-vectores.mjs';

const docker = buscarDocker();
const pw = buscarPlaywright();
const HAY_TS = Boolean(process.features?.typescript);
const MOTIVO = docker.motivo ? `${docker.motivo}`
  : !HAY_TS ? 'correr index.ts pide Node ≥ 22.18 (type stripping)'
  : !pw.chromium ? pw.motivo
  : false;

const DIR_EVIDENCIA = process.env.EVIDENCIA_PAGO_BREB || '';
const FUNCION_CUENTA = 'supabase/functions/cuenta/index.ts';
const MIGRACION_BREB = '20261003150000_pago_breb.sql';
const URL_ALERTA = 'https://lccgehvyymladqvumcez.supabase.co/functions/v1/alerta';
const WHATSAPP = '573225542434';
const TOKEN_7 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';   // mesa 7: cuenta abierta
const TOKEN_8 = 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607182a';   // mesa 8: libre, sin cuenta
const TOKEN_9 = 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607182a3b';   // mesa 9: solo una cuenta ya cerrada
const TOTAL = 99000;                                                   // 2×23.000 + 32.000 + 3×7.000
const TOTAL_TEXTO = '$ 99.000';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const ALPINE = fs.readFileSync(path.join(RAIZ, 'assets/vendor/alpinejs-3.17.4.min.js'));
/** `pg.sql` con claims antepone la línea del set_config: lo que cuenta es la última línea de la salida. */
const ultimaLinea = (r) => r.salida.split('\n').pop();

const resumen = { pruebas: {} };
const anotar = (clave, valor) => { resumen.pruebas[clave] = valor; };
const guardarCaptura = async (page, nombre, opciones = {}) => {
  if (!DIR_EVIDENCIA) return;
  fs.mkdirSync(DIR_EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(DIR_EVIDENCIA, nombre + '.png'), ...opciones });
};

describe('Pagar con Bre-B de punta a punta: Postgres real → `cuenta` real → carta y tablero en Chromium', { skip: MOTIVO }, () => {
  let pg;
  let funcion;
  let base;
  let navegador;
  let servidorCarta;
  let servidorPos;
  let mesa;                       // el módulo _compartido/mesa.js
  let CLAIMS_ADMIN;
  let cartaVm;                    // la carta en un vm (solo para preguntarle sus reglas)
  let ip = 0;
  const contextos = [];

  // ───────────────────────── base y ayudantes ─────────────────────────

  const filaAjustes = () => pg.filas('select pago_breb_visible, pago_breb_llave, pago_breb_qr from public.ajustes where id = 1')[0];
  const limpiarAjustes = () => {
    const r = pg.sql("update public.ajustes set pago_breb_visible = false, pago_breb_llave = null, pago_breb_qr = null where id = 1;");
    assert.ok(r.ok, r.error);
  };
  /** Un UPDATE de `ajustes` COMO EL ADMIN, con el rol de la API: RLS, GRANT y CHECK de verdad. */
  const comoAdmin = (sql) => pg.sql(sql, { como: 'authenticated', claims: CLAIMS_ADMIN });
  const valorSql = (v) => (typeof v === 'boolean' ? String(v) : v === null ? 'null' : literal(v));
  /** Aplica a la base lo que el tablero mandó en su `.update({...}).eq('id', 1)`: solo las tres columnas, y como el admin. */
  function aplicarCargaDelTablero(carga) {
    assert.deepEqual(Object.keys(carga).sort(), ['pago_breb_llave', 'pago_breb_qr', 'pago_breb_visible'], 'el tablero manda SOLO las tres columnas');
    const sets = Object.entries(carga).map(([k, v]) => `${k} = ${valorSql(v)}`).join(', ');
    return comoAdmin(`update public.ajustes set ${sets} where id = 1 returning id;`);
  }
  const configurar = (llave = LLAVE_FICTICIA, qr = QR_FICTICIO, visible = true) => {
    const r = aplicarCargaDelTablero({ pago_breb_visible: visible, pago_breb_llave: llave, pago_breb_qr: qr });
    assert.ok(r.ok, r.error);
  };
  const cuenta = async (m, k, { origen = 'http://localhost:8080', o } = {}) => {
    const r = await funcion.atender(new Request(`https://prueba.invalid/functions/v1/cuenta?${new URLSearchParams({ m: String(m), k, ...(o ? { o } : {}) })}`,
      { method: 'GET', headers: { origin: origen, 'x-forwarded-for': `203.0.113.${(++ip % 240) + 1}` } }));
    return { status: r.status, cabeceras: r.headers, cuerpo: JSON.parse(await r.text()) };
  };

  before(async () => {
    mesa = await importarModulo('supabase/functions/_compartido/mesa.js');
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const hechas = aplicarMigraciones(pg, DIR_MIGRACIONES);
    assert.ok(hechas.length >= 14 && hechas.every((m) => m.ok), `la cadena de migraciones no se aplicó: ${hechas.filter((m) => !m.ok).map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    assert.equal(hechas[hechas.length - 1].archivo, MIGRACION_BREB, 'la de Bre-B es la última');
    assert.ok(hechas.some((m) => m.archivo === '20261003140000_cola_impresion.sql'), 'y la cola de impresión va antes');
    resumen.migraciones = hechas.map((m) => m.archivo);
    const r0 = pg.sql(fs.readFileSync(path.join(RAIZ, 'scripts/pruebas/sql/pago-breb/00-partida.sql'), 'utf8'));
    assert.ok(r0.ok, r0.error);
    const sembrar = pg.sql(`
      select t.partida_pago();
      delete from public.ordenes; delete from public.mesas;
      insert into public.mesas (id, capacidad, estado, token) values
        (7, 4, 'ocupada', ${literal(TOKEN_7)}), (8, 4, 'libre', ${literal(TOKEN_8)}), (9, 4, 'libre', ${literal(TOKEN_9)});
      insert into public.ordenes (id, mesa_id, estado, items, total) values
        ('abierta7', 7, 'abierta', '[{"id":"i1","nombre":"Menú Resplandor","precio":23000,"qty":2,"nota":"Sopa · Res"},{"id":"i2","nombre":"Hamburguesa Resplandor","precio":32000,"qty":1,"nota":""},{"id":"i3","nombre":"Jugo natural en agua","precio":7000,"qty":3,"nota":""}]', ${TOTAL}),
        ('cerrada9', 9, 'cerrada', '[{"id":"y","nombre":"Postre","precio":9000,"qty":1}]', 9000);
    `);
    assert.ok(sembrar.ok, sembrar.error);
    const g = pg.filas("select id, email, provider from t.gente where clave = 'admin'")[0];
    CLAIMS_ADMIN = { sub: g.id, role: 'authenticated', email: g.email, app_metadata: { provider: g.provider } };
    base = basePostgres(pg);                                 // rol service_role, como la Edge Function en Supabase
    funcion = await cargarFuncion(FUNCION_CUENTA, { base });
    cartaVm = await crearCarta();
    navegador = await pw.chromium.launch();
    servidorCarta = await servirRaiz(RAIZ);
    servidorPos = await servirPos(RAIZ, 0);
  }, { timeout: 300000 });

  after(async () => {
    for (const c of contextos) await c.close().catch(() => {});
    await navegador?.close().catch(() => {});
    if (servidorCarta) await new Promise((r) => servidorCarta.close(r));
    await servidorPos?.cerrar().catch(() => {});
    pg?.parar();
    if (DIR_EVIDENCIA) {
      fs.mkdirSync(DIR_EVIDENCIA, { recursive: true });
      fs.writeFileSync(path.join(DIR_EVIDENCIA, 'resumen-integracion.json'), JSON.stringify(resumen, null, 2) + '\n');
    }
  });

  // ───────────────────────── la carta, en Chromium, con `cuenta` REAL ─────────────────────────

  const filasCartaRespaldo = async () => {
    const vm = await import('node:vm');
    const caja = {};
    caja.globalThis = caja;
    vm.createContext(caja);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'assets/js/carta-respaldo.js'), 'utf8'), caja);
    return JSON.parse(JSON.stringify(caja.RESPLANDOR_CARTA_RESPALDO.filas));
  };
  let filasCarta;

  /**
   * Abre carta.html en `localhost` (el origen que la función deja pasar) y manda su `fetch` a `cuenta` a la función REAL contra la base real.
   * Devuelve la página, los POST a `alerta`, lo que la función contestó (status y cuerpo) y los errores de consola.
   */
  async function abrirCarta({ ancho, alto = 800, m = 7, k = TOKEN_7 } = {}) {
    filasCarta ||= await filasCartaRespaldo();
    const origenCarta = `http://localhost:${servidorCarta.address().port}`;
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, ...(ancho < 768 ? { isMobile: true, hasTouch: true } : {}), acceptDownloads: false });
    contextos.push(contexto);
    await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origenCarta }).catch(() => {});
    const page = await contexto.newPage();
    const consola = [];
    const posts = [];
    const respuestas = [];
    page.on('console', (x) => { if (x.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(x.location().url || '')) consola.push(x.text()); });
    page.on('pageerror', (e) => consola.push(`pageerror: ${e.message}`));
    // Sin red de verdad: Alpine sale del archivo local (el MISMO de la versión pedida: el SRI de la carta lo comprueba), supabase-js no carga
    // (la carta cae a sondeo, como cuando el canal no conecta) y las fuentes se omiten.
    await page.route(/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort('failed'));
    await page.route(/cdn\.jsdelivr\.net\/npm\/alpinejs@3\.17\.4\/dist\/cdn\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: CORS, body: ALPINE }));
    await page.route(/\.supabase\.co\//, async (r) => {
      const req = r.request();
      const url = req.url();
      if (url.includes('/functions/v1/cuenta')) {
        const origen = req.headers().origin ?? null;
        const llamada = await funcion.atender(new Request(`https://prueba.invalid/functions/v1/cuenta${new URL(url).search}`, {
          method: req.method(),
          headers: { ...(origen ? { origin: origen } : {}), 'x-forwarded-for': `203.0.113.${(++ip % 240) + 1}` },
        }));
        const texto = await llamada.text();
        if (req.method() === 'GET') { let cuerpo = null; try { cuerpo = JSON.parse(texto); } catch { /* sin cuerpo */ } respuestas.push({ status: llamada.status, cuerpo }); }
        return r.fulfill({ status: llamada.status, headers: Object.fromEntries(llamada.headers), body: texto });
      }
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      if (url.includes('/rest/v1/carta_publica')) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(filasCarta) });
      if (url.includes('/functions/v1/alerta')) {
        const cuerpo = JSON.parse(req.postData() || '{}');
        posts.push({ url, cuerpo });
        return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, metodo: cuerpo.metodo, creada_en: '2026-10-02T18:00:00Z' }) });
      }
      return r.fulfill({ status: 404, headers: CORS, body: '{}' });
    });
    await page.goto(`${origenCarta}/carta.html?m=${m}&k=${k}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Alpine && document.querySelector('[x-data]') && document.querySelector('[x-data]')._x_dataStack, null, { timeout: 8000 });
    return { page, posts, respuestas, consola, contexto };
  }

  const desborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const visible = (page, selector) => page.locator(selector).first().isVisible();
  const norm = (txt) => txt.replace(/\s+/g, ' ').trim();
  const LLAVE_P = '.breb-llave:not(.breb-valor) p';   // la fila de la llave (la del valor comparte la clase .breb-llave)

  /** Abre «Mi cuenta» (la hoja en el teléfono; en escritorio ya es un panel) y espera el total. */
  async function abrirCuenta(page, ancho) {
    if (ancho < 1024) await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
  }
  async function elegirPago(page, ancho, titulo) {
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
    await page.locator('.pago-opcion').filter({ hasText: titulo }).click();
  }
  /** El QR que quedó en el DOM de la carta, leído como lo leería un lector: devuelve el texto, el nivel y la versión. */
  const leerQrDeLaCarta = async (page, selector = '.breb-qr svg') => {
    const q = await page.evaluate((sel) => {
      const svg = document.querySelector(sel);
      return { viewBox: svg.getAttribute('viewBox'), d: svg.querySelector('path').getAttribute('d'), fondo: svg.querySelector('rect').getAttribute('fill'), trazo: svg.querySelector('path').getAttribute('fill') };
    }, selector);
    const lado = Number(q.viewBox.split(' ')[2]);
    const { matriz } = matrizDeSvgConMargen(`<svg viewBox="0 0 ${lado} ${lado}"><path d="${q.d}"/></svg>`, 4);
    return { ...decodificarQr(matriz), fondo: q.fondo, trazo: q.trazo, modulos: lado };
  };

  // ───────────────────────── 1. las reglas: base, función, carta y tablero dicen lo mismo ─────────────────────────

  test('las reglas de la llave y del contenido del QR: la BASE (CHECK), la FUNCIÓN, la CARTA y el TABLERO coinciden en cada vector; la interfaz nunca acepta lo que la base rechaza', async () => {
    const { llaveBrebValida, qrBrebValido } = mesa;
    limpiarAjustes();

    // Los vectores: los de la carta y el tablero, los de la base, y los bordes de largo.
    const llaves = [...new Set([
      ...VECTORES_LLAVE.map(([l]) => l), ...LLAVES_BUENAS, ...LLAVES_MALAS.map(([, l]) => l),
    ].filter((l) => typeof l === 'string'))];
    const bajo = QR_FICTICIO.slice(0, -4) + QR_FICTICIO.slice(-4).toLowerCase();
    assert.notEqual(bajo, QR_FICTICIO, 'el CRC del ficticio lleva letras: el vector en minúscula prueba algo');
    const qrs = [...new Set([
      ...VECTORES_QR.map(([, q]) => q), ...qrMalos().map(([, q]) => q), qrDeLargo(20), qrDeLargo(700), qrDeLargo(701), QR_FICTICIO, QR_FICTICIO_CORTO, bajo,
    ].filter((q) => typeof q === 'string'))];

    // BASE: cada valor, como el admin, contra los CHECK reales.
    const paraSql = (xs) => `array[${xs.map(literal).join(', ')}]::text[]`;
    const rl = pg.filas(`select v, t.llave_acepta('admin', v) as ok from unnest(${paraSql(llaves)}) as v`);
    limpiarAjustes();                       // la última llave buena quedó guardada: con ella, la base solo dejaría pasar un QR que cobre a esa llave (qr_llave)
    const rq = pg.filas(`select v, t.qr_resultado('admin', v) as r from unnest(${paraSql(qrs)}) as v`);
    limpiarAjustes();
    const baseLlave = new Map(rl.map((f) => [f.v, f.ok]));
    const baseQr = new Map(rq.map((f) => [f.v, f.r === 'ok']));
    assert.equal(baseLlave.size, llaves.length);
    assert.equal(baseQr.size, qrs.length);

    // TABLERO: el código REAL de pos.html en Chromium (el store que guarda).
    const ctx = await nuevoContexto(navegador, { ancho: 390, alto: 844, movil: true });
    contextos.push(ctx);
    const page = await ctx.newPage();
    await abrirPos(page, { url: servidorPos.url, vista: 'mesas', ajustar: (d) => { d.tablas.ajustes = [{ id: 1, ticket_qr_url: 'https://resplandor.ynt.codes/', ticket_qr_visible: true, ticket_pie: 'Gracias por su visita', pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null }]; } });
    const llavesTablero = await page.evaluate((xs) => xs.map((x) => Alpine.store('pos').llaveBrebValida(x)), llaves);
    const qrsTablero = await page.evaluate((xs) => xs.map((x) => Alpine.store('pos').motivoQrBreb(x) === ''), qrs);
    const tablero = { llave: new Map(llaves.map((l, i) => [l, llavesTablero[i]])), qr: new Map(qrs.map((q, i) => [q, qrsTablero[i]])) };

    // El tablero recorta los espacios y saltos de los LADOS de lo que se pega y guarda el valor recortado; la base, la función y la carta
    // reciben el valor tal cual. Por eso, con bordes, su respuesta se compara con la del valor recortado.
    const diferencias = [];
    for (const l of llaves) {
      const b = baseLlave.get(l);
      const f = llaveBrebValida(l);
      const c = cartaVm.caja.llaveBrebValida(l);
      const t = tablero.llave.get(l);
      const tEsperado = l !== l.trim() ? llaveBrebValida(l.trim()) : b;
      if (b !== f || b !== c || t !== tEsperado) diferencias.push({ llave: JSON.stringify(l), base: b, funcion: f, carta: c, tablero: t });
      if (c) assert.equal(b, true, `la carta aceptó una llave que la base rechaza: ${JSON.stringify(l)}`);
      if (t) assert.equal(tEsperado, true, `el tablero aceptó una llave que la base rechaza: ${JSON.stringify(l)}`);
    }
    assert.deepEqual(diferencias, [], 'la llave: las cuatro reglas dicen lo mismo en cada vector');

    const soloEstrictas = [];
    for (const q of qrs) {
      const b = baseQr.get(q);
      const f = qrBrebValido(q);
      const c = cartaVm.caja.qrBrebValido(q);
      const t = tablero.qr.get(q);
      assert.equal(f, b, `la función y la base difieren con un QR de ${q.length} caracteres`);
      if (q === q.trim()) assert.equal(c, t, `la carta y el tablero difieren con un QR de ${q.length} caracteres`);
      else assert.equal(t, cartaVm.caja.qrBrebValido(q.trim()), `el tablero (que recorta los lados) difiere de la carta con el QR recortado de ${q.length} caracteres`);
      if (c) assert.equal(b, true, `la carta aceptó un QR que la base rechaza (${q.length} caracteres)`);
      if (t) assert.equal(baseQr.get(q.trim()) ?? mesa.qrBrebValido(q.trim()), true, `el tablero aceptó un QR que la base rechazaría (${q.length} caracteres)`);
      if (b && !c) soloEstrictas.push(q);
    }
    // La ÚNICA diferencia: el CRC en minúscula. La base y la función lo aceptan; la carta y el tablero no (EMV lo pide en mayúscula).
    assert.deepEqual(soloEstrictas, [bajo], 'el único rincón donde la interfaz es más estricta que la base es el CRC en minúscula');
    const motivoBajo = await page.evaluate((x) => Alpine.store('pos').motivoQrBreb(x), bajo);
    assert.match(motivoBajo, /tiene que ir en mayúscula/, 'y el tablero lo dice en claro, no con «falta o sobra algo»');
    anotar('reglas', { llaves: llaves.length, qrs: qrs.length, diferencias: 0, soloMasEstrictaLaInterfaz: ['CRC en minúscula'] });
  });

  // ───────────────────────── 2. sin pago configurado: el flujo de hoy ─────────────────────────

  for (const ancho of [390, 1280]) {
    test(`${ancho} px — SIN pago configurado (interruptor apagado): la función real no manda «pago» y la carta es la de hoy: QR, Transferencia, Efectivo, sin QR, sin llave, sin WhatsApp`, async () => {
      limpiarAjustes();
      const { page, posts, respuestas, consola } = await abrirCarta({ ancho, alto: ancho === 390 ? 844 : 900 });
      await abrirCuenta(page, ancho);
      assert.ok(respuestas.length >= 1);
      for (const r of respuestas) { assert.equal(r.status, 200); assert.equal(r.cuerpo.abierta, true); assert.ok(!('pago' in r.cuerpo), 'la función no manda «pago»'); }
      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      const opciones = page.locator('.pago-opcion');
      await opciones.first().waitFor({ state: 'visible' });
      assert.deepEqual(await opciones.locator('span.font-semibold').allInnerTexts(), ['QR', 'Transferencia', 'Efectivo']);
      await guardarCaptura(page, `sin-pago-${ancho}-elegir`);
      await opciones.filter({ hasText: 'QR' }).click();
      await page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible' });
      assert.match(await page.locator('.pago-listo').innerText(), /Te llevan el código QR a la mesa/);
      assert.equal(await page.locator('.breb-qr, .breb-llave, #pago-comprobante, #pago-ver').count(), 0);
      assert.equal(await page.getByText(/Llave|Copiar|comprobante/).count(), 0);
      assert.deepEqual(posts.map((p) => p.cuerpo), [{ m: 7, k: TOKEN_7, metodo: 'qr' }], 'avisa al mesero, como hoy');
      await guardarCaptura(page, `sin-pago-${ancho}-avisado`);
      assert.equal(await desborde(page), 0);
      assert.deepEqual(consola, []);
      anotar(`sinPago${ancho}`, { opciones: ['QR', 'Transferencia', 'Efectivo'], breb: 0, aviso: posts.map((p) => p.cuerpo.metodo) });
    });
  }

  // ───────────────────────── 3. con pago configurado: QR, transferencia, efectivo ─────────────────────────

  for (const ancho of [390, 1280]) {
    test(`${ancho} px — Pagar → «QR (Bre-B)»: el QR se dibuja, SE LEE y dice lo que está en la base; «Copiar llave» copia la llave de la base; el comprobante va al WhatsApp de Resplandor; avisa al mesero`, async () => {
      configurar();
      const guardado = filaAjustes();
      assert.deepEqual([guardado.pago_breb_visible, guardado.pago_breb_llave, guardado.pago_breb_qr], [true, LLAVE_FICTICIA, QR_FICTICIO], 'lo que la base guardó');
      const alto = ancho === 390 ? 844 : 900;
      const c = await abrirCarta({ ancho, alto });
      const { page, posts, respuestas, consola } = c;
      await abrirCuenta(page, ancho);

      // Lo que la función real contestó: la cuenta de siempre más pago.breb con SOLO llave y qr, tal cual la base.
      const abierta = respuestas.find((r) => r.cuerpo && r.cuerpo.abierta);
      assert.ok(abierta, 'la función respondió con la cuenta abierta');
      assert.deepEqual(abierta.cuerpo.pago, { breb: { llave: guardado.pago_breb_llave, qr: guardado.pago_breb_qr } });
      assert.deepEqual(Object.keys(abierta.cuerpo.pago.breb).sort(), ['llave', 'qr']);
      assert.equal(abierta.cuerpo.total, TOTAL);

      await page.getByRole('button', { name: 'Pagar', exact: true }).click();
      const opciones = page.locator('.pago-opcion');
      await opciones.first().waitFor({ state: 'visible' });
      assert.deepEqual(await opciones.locator('span.font-semibold').allInnerTexts(), ancho < 1024 ? ['Transferencia', 'QR (Bre-B)', 'Efectivo'] : ['QR (Bre-B)', 'Transferencia', 'Efectivo'],
        'en el celular «Transferencia» va primero (con la llave sí se paga desde el mismo aparato); en escritorio, el QR');
      assert.equal(posts.length, 0, 'abrir las opciones no avisa a nadie');
      await guardarCaptura(page, `carta-${ancho}-elegir`);
      await opciones.filter({ hasText: 'QR (Bre-B)' }).click();

      const qr = page.locator('.breb-qr').first();
      await qr.waitFor({ state: 'visible' });
      await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
      const caja = await qr.boundingBox();
      assert.ok(Math.abs(caja.width - caja.height) < 1 && caja.width >= 240, `el QR mide ${caja.width}×${caja.height}`);
      const leido = await leerQrDeLaCarta(page);
      assert.equal(leido.texto, guardado.pago_breb_qr, 'lo que un lector saca del QR en pantalla es el contenido guardado en la base, byte por byte');
      assert.deepEqual([leido.fondo, leido.trazo], ['white', 'black']);
      assert.equal(await qr.getAttribute('role'), 'img');
      assert.equal(await qr.getAttribute('aria-label'), `Código QR de Bre-B para pagar a la llave ${guardado.pago_breb_llave}`);
      assert.equal(norm(await page.locator(LLAVE_P).innerText()), `Llave: ${guardado.pago_breb_llave}`);
      assert.equal(await page.locator('.cuenta-total').innerText(), TOTAL_TEXTO, 'el total a pagar queda a la vista');
      await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(posts.map((p) => p.cuerpo), [{ m: 7, k: TOKEN_7, metodo: 'qr' }], 'elegir QR avisa al mesero, sin la llave ni el QR ni el total');
      assert.equal(posts[0].url, URL_ALERTA);
      await guardarCaptura(page, `carta-${ancho}-qr`);

      // El comprobante por WhatsApp de Resplandor.
      const wa = page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' });
      if (ancho < 1024) {
        const pie = await page.locator('.cuenta-hoja footer').boundingBox();
        const b = await wa.boundingBox();
        assert.ok(b.y >= 0 && b.y + b.height <= pie.y + 1, 'el comprobante se ve SIN desplazar, encima del total (crítica visual, P0)');
      }
      const href = await wa.getAttribute('href');
      assert.equal(href, `https://wa.me/${WHATSAPP}?text=` + encodeURIComponent(`Hola, soy de la mesa 7. Total a pagar: ${TOTAL_TEXTO}. Te envío el comprobante del pago con Bre-B.`));
      assert.equal(await wa.getAttribute('target'), '_blank');
      assert.equal(await wa.getAttribute('rel'), 'noopener');
      assert.ok(!href.includes(TOKEN_7) && !href.includes(encodeURIComponent(guardado.pago_breb_llave)), 'sin token ni llave en el enlace');
      assert.equal(await page.evaluate(() => window.RESPLANDOR.whatsapp), WHATSAPP, 'el número es el de assets/js/local.js');

      // «Copiar llave» copia de verdad la llave que vino de la base.
      const copiar = page.getByRole('button', { name: 'Copiar llave' });
      await copiar.scrollIntoViewIfNeeded();
      const alturaBoton = (await copiar.boundingBox()).height;
      assert.ok(alturaBoton >= 44 - 0.5, `«Copiar llave» mide ${alturaBoton} px`);
      await copiar.click();
      await page.getByRole('button', { name: 'Llave copiada' }).waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), guardado.pago_breb_llave);
      await page.getByRole('button', { name: 'Copiar valor' }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), String(TOTAL), 'el valor, solo dígitos');
      assert.ok((await wa.boundingBox()).height >= 44 - 0.5, 'el botón del comprobante mide ≥ 44 px');
      assert.equal(await desborde(page), 0, 'sin scroll horizontal');
      await guardarCaptura(page, `carta-${ancho}-qr-llave-copiada`);
      assert.deepEqual(consola, []);
      anotar(`cartaQr${ancho}`, { qrLeidoIgualALaBase: true, nivel: leido.nivel, version: leido.version, llaveCopiadaIgualALaBase: true, whatsapp: href.split('?')[0], aviso: posts.map((p) => p.cuerpo.metodo) });
    });

    test(`${ancho} px — «Transferencia»: la llave de la base con «Copiar llave» y el mismo botón de comprobante, sin QR; «Efectivo»: sin QR ni llave; los dos avisan al mesero`, async () => {
      configurar();
      const guardado = filaAjustes();
      const { page, posts, consola } = await abrirCarta({ ancho, alto: ancho === 390 ? 844 : 900 });
      await abrirCuenta(page, ancho);
      await elegirPago(page, ancho, 'Transferencia');
      await page.getByText('Transfiere con Bre-B').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.breb-qr').count(), 0, 'sin QR');
      assert.equal(norm(await page.locator(LLAVE_P).innerText()), `Llave: ${guardado.pago_breb_llave}`);
      await page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
      const wa = page.getByRole('link', { name: 'Enviar comprobante por WhatsApp' });
      assert.match(await wa.getAttribute('href'), new RegExp(`^https://wa\\.me/${WHATSAPP}\\?text=`));
      await page.getByRole('button', { name: 'Copiar llave' }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), guardado.pago_breb_llave);
      await guardarCaptura(page, `carta-${ancho}-transferencia`);
      assert.equal(await desborde(page), 0);

      // Efectivo: cambiar de método y elegirlo. Ni QR ni llave ni comprobante; avisa.
      await page.locator('#pago-cambiar-breb').click();
      await page.locator('.pago-opcion').filter({ hasText: 'Efectivo' }).click();
      await page.getByText(/Vas a pagar con efectivo/).waitFor({ state: 'visible' });
      assert.equal(await page.locator('.breb-qr, .breb-llave, #pago-comprobante').count(), 0);
      assert.equal(await page.getByRole('link', { name: /Enviar comprobante/ }).count(), 0);
      await guardarCaptura(page, `carta-${ancho}-efectivo`);
      assert.deepEqual(posts.map((p) => p.cuerpo.metodo), ['transferencia', 'efectivo']);
      assert.deepEqual(consola, []);
      anotar(`cartaTransferenciaEfectivo${ancho}`, { avisos: posts.map((p) => p.cuerpo.metodo) });
    });
  }

  // ───────────────────────── 4. cuándo la función NO manda «pago» ─────────────────────────

  test('con Bre-B encendido, la función real solo manda «pago» con la cuenta ABIERTA: mesa sin cuenta, cuenta cerrada, token malo y mesa inexistente no lo traen; y «pago» trae SOLO llave y qr', async () => {
    configurar();
    const abierta = await cuenta(7, TOKEN_7);
    assert.equal(abierta.status, 200);
    assert.deepEqual(abierta.cuerpo.pago, { breb: { llave: LLAVE_FICTICIA, qr: QR_FICTICIO } });
    assert.equal(abierta.cabeceras.get('cache-control'), 'no-store');
    assert.equal(abierta.cabeceras.get('access-control-allow-origin'), 'http://localhost:8080');
    const sinCuenta = await cuenta(8, TOKEN_8);
    const cerrada = await cuenta(9, TOKEN_9, { o: 'cerrada9' });
    const tokenMalo = await cuenta(7, 'f'.repeat(48));
    const inexistente = await cuenta(99, TOKEN_7);
    for (const [nombre, r] of [['mesa libre sin cuenta', sinCuenta], ['cuenta cerrada', cerrada], ['token malo', tokenMalo], ['mesa inexistente', inexistente]]) {
      assert.ok(!('pago' in r.cuerpo), `${nombre}: no trae «pago»`);
      assert.ok(!JSON.stringify(r.cuerpo).includes(LLAVE_FICTICIA) && !JSON.stringify(r.cuerpo).includes('000201'), `${nombre}: ni rastro de la llave ni del QR`);
    }
    assert.equal(sinCuenta.status, 200);
    assert.equal(cerrada.status, 200);
    assert.equal(tokenMalo.status, 404);
    assert.equal(inexistente.status, 404);
    assert.equal(sinCuenta.cuerpo.estado, 'sin_orden');
    assert.equal(cerrada.cuerpo.estado, 'cerrada', 'preguntando por la orden que ya se cerró');
    assert.equal((await cuenta(9, TOKEN_9)).cuerpo.estado, 'sin_orden', 'sin preguntar por ella, la mesa no tiene cuenta abierta');
    // Y la base: anon no lee `ajustes` ni la vista pública de la carta trae nada del pago.
    const anon = pg.sql('select pago_breb_llave from public.ajustes', { como: 'anon' });
    assert.equal(anon.ok, false);
    assert.match(anon.error, /permission denied/);
    const cols = pg.filas("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'carta_publica'").map((f) => f.column_name);
    assert.ok(cols.length > 0 && !cols.some((n) => /pago|breb|llave/.test(n)), `carta_publica no trae nada del pago: ${cols.join(', ')}`);
    anotar('funcionSoloConCuentaAbierta', { abierta: 'trae pago', sinCuenta: 'sin pago', cerrada: 'sin pago', tokenMalo: 404, inexistente: 404, anon: 'permission denied', cartaPublica: 'sin columnas de pago' });
  });

  // ───────────────────────── 5. el lazo: tablero → base → función → carta ─────────────────────────

  async function abrirTablero({ ancho, fila }) {
    const ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    const { diag } = await abrirPos(page, { url: servidorPos.url, vista: 'mesas', ajustar: (d) => { d.tablas.ajustes = [{ id: 1, ticket_qr_url: 'https://resplandor.ynt.codes/', ticket_qr_visible: true, ticket_pie: 'Gracias por su visita', ...fila }]; } });
    await page.evaluate(() => Alpine.store('pos').irA('ajustes'));
    await page.locator('#ajustes-breb').waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    return { page, diag };
  }
  const tarjeta = (page) => page.locator('#ajustes-breb');
  const guardarBtn = (page) => tarjeta(page).getByRole('button', { name: 'Guardar pago con Bre-B' });
  const interruptor = (page) => tarjeta(page).getByRole('switch', { name: 'Mostrar en la carta' });
  const updatesDelTablero = (page) => page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.update' && l.tabla === 'ajustes').map((l) => ({ carga: l.carga, filtros: l.filtros })));

  for (const ancho of [390, 1280]) {
    test(`${ancho} px — el lazo completo: el admin configura Bre-B en el TABLERO, la BASE lo acepta, la FUNCIÓN lo entrega y la CARTA dibuja ese mismo QR; apagarlo la devuelve al flujo de hoy`, async () => {
      limpiarAjustes();

      // 0. La carta, antes: sin pago.
      const antes = await abrirCarta({ ancho, alto: ancho === 390 ? 844 : 900 });
      await abrirCuenta(antes.page, ancho);
      assert.ok(antes.respuestas.every((r) => !('pago' in r.cuerpo)), 'antes de configurar: sin «pago»');
      await antes.contexto.close();

      // 1. El tablero (lee la fila de la base: vacía) y el admin pega la llave y el contenido.
      const { page: tab, diag } = await abrirTablero({ ancho, fila: filaAjustes() });
      assert.equal(await interruptor(tab).getAttribute('aria-checked'), 'false');
      assert.equal(await tab.locator('#breb-llave').inputValue(), '');
      await guardarCaptura(tab, `tablero-${ancho}-1-vacio`, { fullPage: false });
      await tab.locator('#breb-llave').fill(`  ${LLAVE_FICTICIA}  `);
      await tab.locator('#breb-qr').fill(`\n${QR_FICTICIO}\n`);
      await tab.waitForTimeout(200);
      assert.match(await tab.locator('#breb-qr-ayuda').innerText(), /Formato y CRC correctos/);
      await tab.locator('.breb-previa-qr').waitFor({ state: 'visible' });
      const previa = await leerQrDeLaCarta(tab, '#ajustes-breb .breb-previa-qr svg');
      assert.equal(previa.texto, QR_FICTICIO, 'la vista previa del tablero dibuja lo que se pegó');
      assert.equal(norm(await tab.locator('.breb-previa-llave').innerText()), `Llave: ${LLAVE_FICTICIA}`);
      await interruptor(tab).click();
      await tarjeta(tab).scrollIntoViewIfNeeded();
      await guardarCaptura(tab, `tablero-${ancho}-2-pegado`);
      assert.equal(await guardarBtn(tab).isDisabled(), false);
      await guardarBtn(tab).click();
      await tab.getByText('Guardado. La carta ya lo muestra así.').waitFor({ state: 'visible' });
      await guardarCaptura(tab, `tablero-${ancho}-3-guardado`);
      const updates = await updatesDelTablero(tab);
      assert.equal(updates.length, 1);
      assert.deepEqual(updates[0].filtros.map((f) => [f.c, f.v, f.t]), [['id', 1, 'eq']]);

      // 2. Lo que el tablero mandó, a la base COMO EL ADMIN (RLS, GRANT y CHECK de verdad).
      const r = aplicarCargaDelTablero(updates[0].carga);
      assert.ok(r.ok, `la base rechazó lo que el tablero mandó: ${r.error}`);
      assert.equal(ultimaLinea(r), '1', 'una fila actualizada');
      assert.deepEqual(filaAjustes(), { pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }, 'la base quedó con lo tecleado, ya sin los espacios ni saltos de los lados');

      // 3. La función real lo entrega y la carta dibuja ESE QR.
      const fn = await cuenta(7, TOKEN_7);
      assert.deepEqual(fn.cuerpo.pago, { breb: { llave: LLAVE_FICTICIA, qr: QR_FICTICIO } });
      const c = await abrirCarta({ ancho, alto: ancho === 390 ? 844 : 900 });
      await abrirCuenta(c.page, ancho);
      await elegirPago(c.page, ancho, 'QR (Bre-B)');
      await c.page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
      const enCarta = await leerQrDeLaCarta(c.page);
      assert.equal(enCarta.texto, QR_FICTICIO, 'el QR de la carta dice lo que el admin pegó en el tablero');
      assert.equal(norm(await c.page.locator(LLAVE_P).innerText()), `Llave: ${LLAVE_FICTICIA}`);
      assert.equal(enCarta.texto, previa.texto, 'y es el mismo que mostró la vista previa del tablero');
      await c.page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(c.posts.map((p) => p.cuerpo.metodo), ['qr']);
      await c.contexto.close();

      // 4. El tablero ve lo guardado al volver a entrar (lee la fila de la base).
      const { page: tab2 } = await abrirTablero({ ancho, fila: filaAjustes() });
      assert.equal(await interruptor(tab2).getAttribute('aria-checked'), 'true');
      assert.equal(await tab2.locator('#breb-llave').inputValue(), LLAVE_FICTICIA);
      assert.equal(await tab2.locator('#breb-qr').inputValue(), QR_FICTICIO);
      assert.equal((await leerQrDeLaCarta(tab2, '#ajustes-breb .breb-previa-qr svg')).texto, QR_FICTICIO);

      // 5. Apagar «Mostrar en la carta» (sin borrar nada): la base lo acepta y la carta vuelve al flujo de hoy.
      await interruptor(tab2).click();
      await guardarBtn(tab2).click();
      await tab2.getByText('Guardado, pero está apagado: la carta NO lo muestra.').waitFor({ state: 'visible' });
      await guardarCaptura(tab2, `tablero-${ancho}-4-apagado-guardado`);
      const [apagar] = await updatesDelTablero(tab2);
      assert.deepEqual(apagar.carga, { pago_breb_visible: false, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO });
      assert.ok(aplicarCargaDelTablero(apagar.carga).ok);
      const apagada = await cuenta(7, TOKEN_7);
      assert.ok(!('pago' in apagada.cuerpo), 'apagado: la función no manda «pago»');
      const d = await abrirCarta({ ancho, alto: ancho === 390 ? 844 : 900 });
      await abrirCuenta(d.page, ancho);
      await d.page.getByRole('button', { name: 'Pagar', exact: true }).click();
      await d.page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
      assert.deepEqual(await d.page.locator('.pago-opcion span.font-semibold').allInnerTexts(), ['QR', 'Transferencia', 'Efectivo'], 'apagado: el flujo de hoy');
      await d.contexto.close();

      // 6. Borrar llave y contenido (con el interruptor apagado): el tablero manda null, nunca '', y la base lo acepta.
      await tab2.locator('#breb-llave').fill('');
      await tab2.locator('#breb-qr').fill('');
      await guardarBtn(tab2).click();
      await tab2.getByText('Guardado, pero está apagado: la carta NO lo muestra.').waitFor({ state: 'visible' });
      const borrar = (await updatesDelTablero(tab2)).at(-1);
      assert.deepEqual(borrar.carga, { pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null });
      assert.ok(aplicarCargaDelTablero(borrar.carga).ok);
      assert.deepEqual(filaAjustes(), { pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null });
      assert.deepEqual(diag.errores, []);
      anotar(`lazoTableroBaseFuncionCarta${ancho}`, { qrDelTableroIgualAlDeLaCarta: true, apagarVuelveAlFlujoDeHoy: true, borrarManda: 'null' });
    });
  }

  test('lo que el tablero NO deja guardar, la base tampoco lo recibiría: CRC roto, llave con espacio y «mostrar» sin los dos datos (la base responde 23514 con el CHECK)', async () => {
    limpiarAjustes();
    const { page } = await abrirTablero({ ancho: 390, fila: filaAjustes() });
    // CRC roto: el tablero apaga «Guardar» y dice por qué; la base, con el mismo valor, lo rechaza por el CHECK del CRC.
    const roto = QR_FICTICIO.slice(0, 100) + (QR_FICTICIO[100] === 'X' ? 'Y' : 'X') + QR_FICTICIO.slice(101);
    await page.locator('#breb-llave').fill(LLAVE_FICTICIA);
    await page.locator('#breb-qr').fill(roto);
    await page.locator('#breb-llave').focus();
    await page.waitForTimeout(150);
    assert.match(await page.locator('#breb-qr-ayuda').innerText(), /CRC\) no cuadra/);
    assert.equal(await page.locator('#breb-qr').getAttribute('aria-invalid'), 'true');
    assert.equal(await guardarBtn(page).isDisabled(), true);
    await guardarCaptura(page, 'tablero-390-4-crc-roto');
    const enBase = comoAdmin(`update public.ajustes set pago_breb_qr = ${literal(roto)} where id = 1;`);
    assert.equal(enBase.ok, false);
    assert.match(enBase.error, /ajustes_pago_breb_qr_crc/);
    // Llave con espacio.
    await page.locator('#breb-llave').fill('@con espacio');
    await page.locator('#breb-qr').fill(QR_FICTICIO);
    await page.locator('#breb-qr').focus();
    await page.waitForTimeout(150);
    assert.match(await page.locator('#breb-llave-ayuda').innerText(), /La llave no es válida/);
    assert.equal(await guardarBtn(page).isDisabled(), true);
    const llaveMala = comoAdmin(`update public.ajustes set pago_breb_llave = '@con espacio' where id = 1;`);
    assert.match(llaveMala.error, /ajustes_pago_breb_llave_(forma|segura)/);
    // «Mostrar» sin llave: el tablero lo impide; la base también (ajustes_pago_breb_completo).
    await page.locator('#breb-llave').fill('');
    await interruptor(page).click();
    await page.waitForTimeout(150);
    assert.equal(await guardarBtn(page).isDisabled(), true);
    assert.match(await page.locator('#ajustes-breb').innerText(), /Para mostrarlo en la carta pon la llave y el contenido del QR/);
    const incompleto = comoAdmin(`update public.ajustes set pago_breb_visible = true, pago_breb_qr = ${literal(QR_FICTICIO)} where id = 1;`);
    assert.match(incompleto.error, /ajustes_pago_breb_completo/);
    assert.deepEqual(filaAjustes(), { pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null }, 'nada de lo rechazado quedó guardado');
    assert.equal((await updatesDelTablero(page)).length, 0, 'y el tablero no mandó nada');
    anotar('tableroYBaseRechazanLoMismo', { crcRoto: 'ajustes_pago_breb_qr_crc', llaveConEspacio: 'ajustes_pago_breb_llave_*', mostrarIncompleto: 'ajustes_pago_breb_completo' });
  });

  test('un mesero NO puede cambiar el pago (la base lo deja en 0 filas) y la carta de una mesa con QR en minúscula cargado por SQL sigue sirviendo: sin QR, con la llave para transferir', async () => {
    configurar();
    // Mesero: RLS lo deja en 0 filas, sin error, y nada cambia.
    const m = pg.filas("select id, email, provider from t.gente where clave = 'mesero'")[0];
    const r = pg.sql("update public.ajustes set pago_breb_llave = '@LaDelMesero' where id = 1 returning id;", { como: 'authenticated', claims: { sub: m.id, role: 'authenticated', email: m.email, app_metadata: { provider: m.provider } } });
    assert.ok(r.ok, r.error);
    assert.notEqual(ultimaLinea(r), '1', 'ninguna fila actualizada');
    assert.equal(filaAjustes().pago_breb_llave, LLAVE_FICTICIA);

    // El rincón de la minúscula: la base y la función lo aceptan; la carta no dibuja un QR que un banco podría no leer.
    const bajo = QR_FICTICIO.slice(0, -4) + QR_FICTICIO.slice(-4).toLowerCase();
    configurar(LLAVE_FICTICIA, bajo);
    const fn = await cuenta(7, TOKEN_7);
    assert.equal(fn.cuerpo.pago.breb.qr, bajo, 'la función lo entrega tal cual está en la base');
    const { page, consola } = await abrirCarta({ ancho: 390, alto: 844 });
    await abrirCuenta(page, 390);
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await page.locator('.pago-opcion').first().waitFor({ state: 'visible' });
    assert.deepEqual(await page.locator('.pago-opcion span.font-semibold').allInnerTexts(), ['QR', 'Transferencia', 'Efectivo'], 'sin QR que dibujar la opción es la de hoy');
    await page.locator('.pago-opcion').filter({ hasText: 'Transferencia' }).click();
    await page.getByText('Transfiere con Bre-B').waitFor({ state: 'visible' });
    assert.equal(norm(await page.locator(LLAVE_P).innerText()), `Llave: ${LLAVE_FICTICIA}`);
    assert.equal(await page.locator('.breb-qr').count(), 0);
    assert.deepEqual(consola, []);
    limpiarAjustes();
    anotar('qrEnMinusculaPorSql', 'la función lo entrega; la carta no lo dibuja y deja la llave');
  });

  test('un QR corto (versión 8) configurado por el mismo camino también se entrega, se dibuja y se lee', async () => {
    configurar('@otra.ficticia', QR_FICTICIO_CORTO);
    const { page } = await abrirCarta({ ancho: 390, alto: 844 });
    await abrirCuenta(page, 390);
    await elegirPago(page, 390, 'QR (Bre-B)');
    await page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
    assert.equal((await leerQrDeLaCarta(page)).texto, QR_FICTICIO_CORTO);
    assert.equal(await page.locator('.breb-qr').getAttribute('aria-label'), 'Código QR de Bre-B para pagar a la llave @otra.ficticia');
    limpiarAjustes();
  });

  // ───────────────────────── 6. refutación y crítica visual (2026-10-02), de punta a punta ─────────────────────────

  test('R2 — la llave que se muestra es la que COBRA el QR, en las cuatro capas: la BASE (CHECK qr_llave), la FUNCIÓN, la CARTA y el TABLERO coinciden en cada vector del cruce', async () => {
    const { pagoBreb } = mesa;
    const vectores = llaveQrVectores().filter((v) => v[3] !== null);
    assert.ok(vectores.length >= 15);
    const ctx = await nuevoContexto(navegador, { ancho: 390, alto: 844, movil: true });
    contextos.push(ctx);
    const page = await ctx.newPage();
    await abrirPos(page, { url: servidorPos.url, vista: 'mesas', ajustar: (d) => { d.tablas.ajustes = [{ id: 1, ticket_qr_url: 'https://resplandor.ynt.codes/', ticket_qr_visible: true, ticket_pie: 'Gracias por su visita', pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null }]; } });
    const tablero = await page.evaluate((vs) => vs.map(([, qr, , llave]) => Alpine.store('pos').llaveDelQrBreb(qr) === llave), vectores);
    const diferencias = [];
    vectores.forEach(([nombre, qr, , llave, esperado], i) => {
      limpiarAjustes();
      const r = comoAdmin(`update public.ajustes set pago_breb_llave = ${literal(llave)}, pago_breb_qr = ${literal(qr)}, pago_breb_visible = true where id = 1;`);
      const baseOk = r.ok;
      const cheque = baseOk ? 'ok' : (/ajustes_pago_breb_[a-z_]+/.exec(r.error) || ['?'])[0];
      const funcionOk = pagoBreb({ pago_breb_visible: true, pago_breb_llave: llave, pago_breb_qr: qr }) !== null;
      const carta = cartaVm.caja.brebDeRespuesta({ pago: { breb: { llave, qr } } });
      const cartaOk = Boolean(carta && carta.llave === llave && carta.qr === qr);
      if (cheque !== esperado || funcionOk !== baseOk || cartaOk !== baseOk || tablero[i] !== baseOk) {
        diferencias.push({ nombre, esperado, base: cheque, funcion: funcionOk, carta: cartaOk, tablero: tablero[i] });
      }
    });
    limpiarAjustes();
    assert.deepEqual(diferencias, [], 'base, función, carta y tablero dicen lo mismo en cada vector del cruce llave ↔ QR');
    anotar('cruceLlaveQr', { vectores: vectores.length, diferencias: 0, regla: 'la llave es el subcampo 04 del único campo 26 con el subcampo 00 CO.COM.RBM.LLA' });
  });

  test('R2 — un admin (o una sesión robada) que intenta guardar la llave de una cosa con el QR de otra: el TABLERO lo frena y lo explica, y la BASE lo rechaza con el mismo motivo si se lo mandan por otro camino', async () => {
    limpiarAjustes();
    const { page, diag } = await abrirTablero({ ancho: 390, fila: filaAjustes() });
    // QR de «@otra.ficticia» con la llave «@prueba.ficticia» a la vista.
    await page.locator('#breb-qr').fill(QR_FICTICIO_CORTO);
    await page.locator('#breb-llave').fill(LLAVE_FICTICIA);
    await interruptor(page).click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#breb-llave-no-cuadra').isVisible(), true);
    assert.match(norm(await page.locator('#breb-llave-no-cuadra').innerText()), new RegExp(`el QR cobra a ${LLAVE_OTRA_FICTICIA.replace('.', '\\.')} y escribiste ${LLAVE_FICTICIA.replace('.', '\\.')}`));
    assert.equal(await guardarBtn(page).isDisabled(), true);
    await tarjeta(page).scrollIntoViewIfNeeded();
    await guardarCaptura(page, 'tablero-390-5-llave-no-cuadra');
    assert.equal((await updatesDelTablero(page)).length, 0, 'el tablero no mandó nada');
    // La base, con el mismo par, por la puerta de atrás: 23514 y el CHECK del cruce.
    const r = comoAdmin(`update public.ajustes set pago_breb_llave = ${literal(LLAVE_FICTICIA)}, pago_breb_qr = ${literal(QR_FICTICIO_CORTO)}, pago_breb_visible = true where id = 1;`);
    assert.equal(r.ok, false);
    assert.match(r.error, /ajustes_pago_breb_qr_llave/);
    assert.deepEqual(filaAjustes(), { pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null });
    // «Usar la llave del QR» y ahora sí: el tablero deja guardar y la base lo acepta.
    await page.locator('#breb-llave-no-cuadra').getByRole('button', { name: 'Usar la llave del QR' }).click();
    await page.waitForTimeout(150);
    assert.equal(await guardarBtn(page).isDisabled(), false);
    await guardarBtn(page).click();
    await page.getByText('Guardado. La carta ya lo muestra así.').waitFor({ state: 'visible' });
    const [u] = await updatesDelTablero(page);
    assert.deepEqual(u.carga, { pago_breb_visible: true, pago_breb_llave: LLAVE_OTRA_FICTICIA, pago_breb_qr: QR_FICTICIO_CORTO });
    assert.ok(aplicarCargaDelTablero(u.carga).ok, 'la base acepta el par que cuadra');
    assert.deepEqual(diag.errores, []);
    limpiarAjustes();
    anotar('llaveNoCuadra', { tablero: 'bloquea y explica', base: 'ajustes_pago_breb_qr_llave', usarLaLlaveDelQr: 'guarda' });
  });

  test('R4 — un fallo pasajero al leer `ajustes` NO saca a quien mira el QR: la función real dice «pago_desconocido», la carta se queda en el QR, y «apagado» de verdad sí la saca', async (t) => {
    configurar();
    const registro = [];
    t.mock.method(console, 'error', (...a) => { registro.push(a); });
    const c = await abrirCarta({ ancho: 390, alto: 844 });
    await abrirCuenta(c.page, 390);
    await elegirPago(c.page, 390, 'QR (Bre-B)');
    await c.page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
    const leerYa = () => c.page.evaluate(() => document.querySelector('[x-data]')._x_dataStack[0]._leer('prueba'));
    const ultima = () => c.respuestas.at(-1).cuerpo;
    // Se le quita a service_role el permiso de la columna (un fallo de la base que la función ve como error de lectura).
    assert.ok(pg.sql('revoke select (pago_breb_qr) on public.ajustes from service_role;', { como: 'migrador' }).ok);
    try {
      await leerYa();
      await c.page.waitForFunction(() => document.querySelector('[x-data]')._x_dataStack[0]._leyendo === false);
      const falla = ultima();
      assert.equal(falla.estado, 'abierta');
      assert.ok(!('pago' in falla), 'sin pago');
      assert.equal(falla.pago_desconocido, true, 'y dice que NO pudo leer');
      assert.equal(await visible(c.page, '.breb-qr'), true, 'la carta sigue en el QR');
      assert.equal(await c.page.locator('.breb-qr svg path').count(), 1);
      assert.equal(norm(await c.page.locator(LLAVE_P).innerText()), `Llave: ${LLAVE_FICTICIA}`);
      assert.ok(registro.some((a) => String(a[0]).includes('no se pudo leer el pago')), 'la función dejó su aviso en el log');
    } finally {
      assert.ok(pg.sql('grant select (pago_breb_qr) on public.ajustes to service_role;', { como: 'migrador' }).ok);
    }
    // El dato regresa: sigue igual, sin tocar nada.
    await leerYa();
    await c.page.waitForFunction(() => document.querySelector('[x-data]')._x_dataStack[0]._leyendo === false);
    assert.ok('pago' in ultima());
    assert.equal(await visible(c.page, '.breb-qr'), true);
    // «Apagado» de verdad (visible = false): ahí sí vuelve a la cuenta.
    assert.ok(comoAdmin('update public.ajustes set pago_breb_visible = false where id = 1;').ok);
    await leerYa();
    await c.page.getByText('Listo, le avisamos al mesero').waitFor({ state: 'visible', timeout: 8000 });
    assert.ok(!('pago' in ultima()) && !('pago_desconocido' in ultima()), 'apagado: ni pago ni «desconocido»');
    assert.equal(await c.page.locator('.breb-qr').count(), 0);
    assert.deepEqual(c.consola, []);
    limpiarAjustes();
    anotar('lecturaFallidaNoSacaDelQr', { funcion: 'pago_desconocido: true', carta: 'se queda en el QR', apagadoDeVerdad: 'sale' });
  });

  // El comprobante por WhatsApp (lo que pidió Yonatan) SIN desplazar la hoja, con la función real y a los cinco tamaños de teléfono de la crítica visual.
  for (const [ancho, alto] of [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915]]) {
    test(`${ancho}×${alto} — con la función real, al convertirse en QR la hoja deja «Enviar comprobante por WhatsApp» a la vista sin desplazar, encima del total (y con la llave y el QR según el alto)`, async () => {
      configurar();
      const c = await abrirCarta({ ancho, alto });
      await abrirCuenta(c.page, ancho);
      await elegirPago(c.page, ancho, 'QR (Bre-B)');
      await c.page.locator('.breb-qr svg path').waitFor({ state: 'attached' });
      await c.page.getByText('Le avisamos al mesero', { exact: true }).waitFor({ state: 'visible' });
      await c.page.waitForTimeout(700);
      const pie = await c.page.locator('.cuenta-hoja footer').boundingBox();
      const wa = await c.page.locator('#pago-comprobante').boundingBox();
      assert.ok(wa.y >= 0 && wa.y + wa.height <= pie.y + 1, `el comprobante se ve sin desplazar (termina en ${wa.y + wa.height}, el total empieza en ${pie.y})`);
      const qr = await c.page.locator('.breb-qr').boundingBox();
      assert.ok(qr.width >= 238 && Math.abs(qr.width - qr.height) < 1, `el QR mide ${qr.width}×${qr.height}`);
      if (alto >= 667) {
        const llave = await c.page.locator('.breb-llave:not(.breb-valor)').boundingBox();
        assert.ok(llave.y + llave.height <= wa.y - 4 + 1, `a ${ancho}×${alto} la llave y «Copiar llave» se ven antes del comprobante`);
      }
      assert.equal(await desborde(c.page), 0);
      assert.deepEqual(c.consola, []);
      await guardarCaptura(c.page, `carta-${ancho}x${alto}-qr`);
      anotar(`comprobanteSinDesplazar${ancho}x${alto}`, { termina: Math.round(wa.y + wa.height), totalEmpieza: Math.round(pie.y), qr: Math.round(qr.width) });
      await c.contexto.close();
    });
  }
});
