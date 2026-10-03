// El aviso de versión nueva y el pie del POS, en Chromium de verdad (arnés de _pos-simulado.mjs: Supabase simulado, datos ficticios,
// reloj fijo). La lógica fina (los 5 minutos, el tope de «Recargar», que nunca recarga solo) está en version-aviso.test.mjs, con el
// script del store en un `vm`; acá se mira lo que solo un navegador dice:
//   · que el aviso sale con una versión distinta, no sale con la misma ni sin red, y «Después» lo esconde;
//   · que NO tapa el encabezado, ni la barra de cobro, ni la navegación de abajo (ni nada fijo), a 390 y a 1280 px;
//   · que «Recargar» pide el documento y cada script del mismo origen ANTES de recargar, que recarga una sola vez y que, si la página
//     sigue vieja, el aviso vuelve a salir sin recargar otra vez;
//   · qué sobrevive a la recarga (la sesión y la cola de reintentos, en el almacenamiento) y qué no (la vista abierta);
//   · el pie «Hecho por Ynt-labs · versión X» en todas las vistas, sin quedar tapado, y el toque en la versión.
// `version.json` se contesta desde la prueba (page.route): nunca se toca el del repo ni la red.
// Se salta, con el motivo, si no hay Playwright con Chromium (ver _navegador.mjs).
'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarPlaywright } from './_navegador.mjs';
import { VISTAS, datosFicticios, esperarEstable, esperarListo, nuevoContexto, prepararPagina, servirPos, FECHA_FIJA } from './_pos-simulado.mjs';
import { leerSellos } from '../version.mjs';
import { RAIZ } from './_pos-vm.mjs';

const VERSION_PAGINA = leerSellos(fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8')).metas[0];
const VERSION_NUEVA = '2099.01.01-abcdef0';
const VERSION_OTRA = '2099.02.02-1234567';
const DIR_CACHE = path.join(os.tmpdir(), 'resplandor-pos-cdn');
const MIN = 60 * 1000;

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivo = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidor = await servirPos(RAIZ, 0);
  } catch (e) {
    motivo = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await servidor.cerrar();
});
const saltar = { skip: navegador ? false : `navegador no disponible: ${motivo}` };

/** Cómo contesta version.json en cada prueba (se cambia sobre la marcha) y qué pidieron. */
const nuevoEstado = (version = VERSION_PAGINA) => ({ version, modo: 'ok', retardo: 0, pedidos: [] });

/**
 * Abre pos.html como abrirPos (_pos-simulado.mjs), pero con un `version.json` controlado por `estado` y un instantáneo del
 * almacenamiento tomado al empezar CADA carga (window.__almacenAlCargar: lo que sobrevivió a una recarga).
 */
async function abrir(page, { estado, vista = 'mesas', ajustar, antesDeCargar }) {
  const def = VISTAS[vista];
  const sesion = def.sesion !== false;
  const diag = await prepararPagina(page, { url: servidor.url, datos: datosFicticios((d) => { def.ajustar?.(d); ajustar?.(d); }), sesion, dirCache: DIR_CACHE, bloquearFuentes: true });
  if (antesDeCargar) await antesDeCargar(page);
  // Registrada DESPUÉS de la del arnés: Playwright da prioridad a la última, así que version.json lo contestamos nosotros.
  await page.route(/\/version\.json(\?|$)/, async (route) => {
    estado.pedidos.push({ url: route.request().url(), cabeceras: route.request().headers() });
    if (estado.modo === 'sin-red') return route.abort('failed');
    if (estado.modo === 'http') return route.fulfill({ status: 503, contentType: 'text/plain', body: 'no disponible' });
    if (estado.retardo) await new Promise((r) => setTimeout(r, estado.retardo));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: estado.version, fecha: '2099-01-01', huella: 'x' }) });
  });
  await page.addInitScript(() => {
    window.__almacenAlCargar = Object.fromEntries(Object.entries(localStorage));
    // Apunta cada fetch con su modo de caché en sessionStorage (sobrevive a la recarga): así la prueba lee, después de recargar, QUÉ se
    // pidió antes y con qué `cache`. (Con page.route activo Chromium apaga su caché HTTP: lo observable acá es la petición, no el efecto.)
    const fetchReal = window.fetch.bind(window);
    window.fetch = (url, opciones) => {
      try { const l = JSON.parse(sessionStorage.getItem('__fetches') || '[]'); l.push([String(url), opciones && opciones.cache]); sessionStorage.setItem('__fetches', JSON.stringify(l)); } catch { /* sin almacenamiento */ }
      return fetchReal(url, opciones);
    };
  });
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page, { sesion });
  await def.llegar(page);
  await esperarEstable(page);
  return diag;
}

async function conPagina(ancho, alto, fn) {
  const contexto = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
  try { return await fn(await contexto.newPage()); } finally { await contexto.close(); }
}

const franja = (page) => page.locator('.aviso-version');
const visible = (page) => franja(page).isVisible();
/** Alpine esconde el aviso en el turno siguiente al toque: se espera a que desaparezca en vez de preguntar en seco. */
const esconde = (page) => franja(page).waitFor({ state: 'hidden' });
const esperarPedidos = async (estado, n) => { for (let i = 0; i < 100 && estado.pedidos.length < n; i++) await new Promise((r) => setTimeout(r, 50)); };
/** Mueve el reloj fijo de la página `ms` hacia adelante (los temporizadores siguen corriendo en tiempo real). */
const adelantar = (page, ms) => page.clock.setFixedTime(new Date(new Date(FECHA_FIJA).getTime() + ms));
const dispararOnline = (page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

// ───────────────────────── sale / no sale ─────────────────────────

for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
  test(`${ancho} px: con una versión publicada distinta sale «Hay una versión nueva del POS» con «Recargar» y «Después»`, saltar, async () => {
    await conPagina(ancho, alto, async (page) => {
      const estado = nuevoEstado(VERSION_NUEVA);
      const diag = await abrir(page, { estado });
      await franja(page).waitFor();
      assert.equal(await franja(page).locator('.aviso-version-txt').innerText(), 'Hay una versión nueva del POS');
      assert.equal(await franja(page).getByRole('button', { name: 'Recargar', exact: true }).isVisible(), true);
      assert.equal(await franja(page).getByRole('button', { name: 'Después', exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('hay-aviso-version')), true);
      assert.equal(await franja(page).getAttribute('role'), 'status', 'un anuncio educado para los lectores de pantalla');
      assert.match(estado.pedidos[0].url, /\/version\.json\?t=\d+$/, 'pidió version.json?t=<ms>');
      assert.deepEqual(diag.errores, []);
    });
  });
}

test('con la misma versión no sale, y el pie dice «versión X» con la de la página', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    const estado = nuevoEstado(VERSION_PAGINA);
    await abrir(page, { estado });
    await esperarPedidos(estado, 1);
    assert.equal(estado.pedidos.length >= 1, true, 'sí preguntó');
    assert.equal(await visible(page), false);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('hay-aviso-version')), false);
    assert.equal((await page.locator('footer.pos-pie .pos-pie-version').innerText()).trim(), `versión ${VERSION_PAGINA}`);
  });
});

test('sin red (la petición falla) o con un error del servidor: en silencio, ni franja ni avisos ni diálogos', saltar, async () => {
  for (const modo of ['sin-red', 'http']) {
    await conPagina(390, 844, async (page) => {
      const estado = nuevoEstado(VERSION_NUEVA);
      estado.modo = modo;
      const diag = await abrir(page, { estado });
      await esperarPedidos(estado, 1);
      await page.waitForTimeout(300);
      assert.equal(await visible(page), false, `${modo}: sin franja`);
      assert.equal(await page.evaluate(() => Alpine.store('pos').aviso), null, `${modo}: ni un aviso breve`);
      assert.deepEqual(diag.dialogos, [], `${modo}: ni un diálogo`);
      assert.equal(await page.locator('footer.pos-pie .pos-pie-version').innerText().then((s) => s.trim()), `versión ${VERSION_PAGINA}`);
    });
  }
});

test('en el login también pregunta y el aviso asoma ENCIMA de la pantalla de entrada (z 101 sobre la cubierta z 100)', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    const estado = nuevoEstado(VERSION_NUEVA);
    await abrir(page, { estado, vista: 'login' });
    await franja(page).waitFor();
    assert.ok(estado.pedidos.length >= 1, 'preguntó sin haber iniciado sesión');
    const alto = await page.evaluate(() => {
      const b = document.querySelector('.aviso-version button').getBoundingClientRect();
      const arriba = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { esElBoton: !!arriba?.closest('.aviso-version'), clase: document.querySelector('.aviso-version').className };
    });
    assert.equal(alto.esElBoton, true, 'se puede tocar: no queda detrás del login');
    assert.match(alto.clase, /sobre-cubierta/);
  });
});

// ───────────────────────── «Después» ─────────────────────────

test('«Después» la esconde; sigue escondida con la misma versión; vuelve con otra versión o pasada 1 hora', saltar, async () => {
  await conPagina(1280, 800, async (page) => {
    const estado = nuevoEstado(VERSION_NUEVA);
    await abrir(page, { estado });
    await franja(page).waitFor();
    await franja(page).getByRole('button', { name: 'Después', exact: true }).click();
    await esconde(page);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('hay-aviso-version')), false);

    // Otra búsqueda automática (volver la red, 20 s después) con la MISMA versión: sigue escondida.
    await adelantar(page, 20 * 1000);
    await dispararOnline(page);
    await esperarPedidos(estado, 2);
    await page.waitForTimeout(200);
    assert.equal(estado.pedidos.length, 2);
    assert.equal(await visible(page), false, 'la misma versión no la vuelve a mostrar');

    // Sale una versión distinta: vuelve.
    estado.version = VERSION_OTRA;
    await adelantar(page, 40 * 1000);
    await dispararOnline(page);
    await franja(page).waitFor({ state: 'visible' });

    // Se esconde otra vez y pasa 1 hora con esa misma versión: vuelve en la siguiente búsqueda.
    await franja(page).getByRole('button', { name: 'Después', exact: true }).click();
    await esconde(page);
    await adelantar(page, 30 * MIN);
    await dispararOnline(page);
    await page.waitForTimeout(300);
    assert.equal(await visible(page), false, 'a la media hora sigue escondida');
    await adelantar(page, 61 * MIN + 60 * 1000);
    await dispararOnline(page);
    await franja(page).waitFor({ state: 'visible' });
  });
});

// ───────────────────────── no tapa nada ─────────────────────────

/** Rectángulos de todo lo que está fijo y a la vista, y cuánto se solapa cada uno con la franja del aviso. */
const solapes = (page) => page.evaluate(() => {
  const f = document.querySelector('.aviso-version');
  const r = f.getBoundingClientRect();
  const choque = (a) => Math.max(0, Math.min(a.right, r.right) - Math.max(a.left, r.left)) * Math.max(0, Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top));
  const fijos = [...document.querySelectorAll('body *')].filter((el) => {
    if (f.contains(el)) return false;
    const e = getComputedStyle(el);
    if (e.position !== 'fixed' && e.position !== 'sticky') return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && e.visibility !== 'hidden' && e.display !== 'none';
  }).map((el) => ({ el: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, area: choque(el.getBoundingClientRect()) }));
  const nav = document.querySelector('nav.nav-bar');
  return {
    franja: { top: r.top, bottom: r.bottom, alto: r.height, ancho: r.width },
    navTop: nav ? nav.getBoundingClientRect().top : null,
    fijos,
    desbordeX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
  for (const vista of ['mesas', 'orden', 'ticket', 'cierre']) {
    test(`${ancho} px, vista «${vista}»: el aviso no tapa el encabezado, ni la barra de cobro, ni la navegación de abajo, ni nada fijo`, saltar, async () => {
      await conPagina(ancho, alto, async (page) => {
        const estado = nuevoEstado(VERSION_NUEVA);
        await abrir(page, { estado, vista });
        await franja(page).waitFor();
        const s = await solapes(page);
        assert.ok(s.franja.top >= -0.5 && s.franja.top < 1, `la franja está arriba de todo (top ${s.franja.top})`);
        assert.ok(Math.abs(s.franja.ancho - ancho) < 1, `y ocupa el ancho (${s.franja.ancho} de ${ancho})`);
        assert.ok(s.franja.alto <= (ancho < 768 ? 110 : 70), `y es discreta: ${Math.round(s.franja.alto)} px de alto`);
        assert.ok(s.navTop >= s.franja.bottom - 0.5, `el encabezado queda DEBAJO de la franja (nav ${s.navTop} ≥ franja ${s.franja.bottom})`);
        assert.deepEqual(s.fijos.filter((x) => x.area > 0), [], 'ningún elemento fijo o pegajoso se solapa con la franja');
        assert.equal(s.desbordeX, 0, 'sin scroll lateral');
        // Hasta el final de la página: la franja se fue con el scroll y las barras de abajo siguen sin pisarla.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const fin = await solapes(page);
        assert.deepEqual(fin.fijos.filter((x) => x.area > 0), [], 'al final de la página tampoco');
      });
    });
  }
}

// ───────────────────────── el pie ─────────────────────────

const centro = (loc) => loc.evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
/**
 * Baja hasta el final de la página y se queda ahí aunque la página crezca al bajar: desde 1024 px la columna del pedido es pegajosa y su alto
 * máximo (--pedido-ocupado) se achica al hacer scroll, así que la página mide más cuando ya se bajó que cuando se empezó; un solo scrollTo se
 * queda corto (a 1280×800 quedaba a 116 px del final) y se pide otra vez hasta que el final deje de moverse.
 */
async function alFinalDeLaPagina(page) {
  let anterior = -1;
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const fin = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY);
    const alto = await page.evaluate(() => document.documentElement.scrollHeight);
    if (fin <= 1 && alto === anterior) return;
    anterior = alto;
  }
}

for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
  for (const vista of ['mesas', 'orden', 'ticket', 'cierre', 'productos']) {
    test(`${ancho} px, vista «${vista}»: el pie «Hecho por Ynt-labs · versión X» está al final y no lo tapa ninguna barra`, saltar, async () => {
      await conPagina(ancho, alto, async (page) => {
        const estado = nuevoEstado(VERSION_PAGINA);
        await abrir(page, { estado, vista });
        const pie = page.locator('footer.pos-pie');
        assert.equal(await pie.count(), 1, 'un pie en el área de trabajo');
        const firma = pie.locator('a.firma');
        assert.equal(await firma.getAttribute('href'), 'https://ynt.codes');
        assert.equal(await firma.getAttribute('target'), '_blank');
        assert.equal(await firma.getAttribute('rel'), 'noopener');
        assert.equal((await firma.innerText()).replace(/\s+/g, ' ').toUpperCase(), 'HECHO POR YNT-LABS');
        const marca = await firma.locator('span').evaluate((s) => { const e = getComputedStyle(s); return { peso: e.fontWeight, mayus: e.textTransform, espacio: e.letterSpacing, tam: e.fontSize }; });
        assert.deepEqual(marca, { peso: '700', mayus: 'uppercase', espacio: '2.4px', tam: '12px' }, '.firma span: 700, mayúsculas, .2em (a 12 px = 2,4 px), como en lusof');
        assert.equal((await pie.locator('.pos-pie-version').innerText()).trim(), `versión ${VERSION_PAGINA}`);

        await alFinalDeLaPagina(page);
        // Visible y sin nada encima: lo que está sobre el centro de la firma y de la versión es la firma y la versión.
        for (const [nombre, loc, sel] of [['la firma', firma, 'a.firma'], ['la versión', pie.locator('.pos-pie-version'), '.pos-pie-version']]) {
          const { x, y } = await centro(loc);
          assert.ok(y > 0 && y < alto && x > 0 && x < ancho, `${nombre} cabe en la pantalla al final de la página (${Math.round(x)}, ${Math.round(y)})`);
          const encima = await page.evaluate(([px, py, s]) => !!document.elementFromPoint(px, py)?.closest(s), [x, y, sel]);
          assert.equal(encima, true, `${nombre} no está tapada por una barra fija`);
        }
        // Y la barra fija de abajo, si la hay (la de cobro o la navegación), arranca donde terminan la firma y la versión: no se meten debajo.
        // (Se mide con lo que se lee, no con la caja del pie: la barra de cobro mide 1 px más que lo que reserva el <body> y se come ese píxel del relleno.)
        const holgura = await page.evaluate(() => {
          const lectura = Math.max(...['footer.pos-pie a.firma', 'footer.pos-pie .pos-pie-version'].map((s) => document.querySelector(s).getBoundingClientRect().bottom));
          return [...document.querySelectorAll('.barra-accion, .barra-inferior')].map((el) => ({ el, caja: el.getBoundingClientRect(), pos: getComputedStyle(el).position }))
            .filter((x) => x.pos === 'fixed' && x.caja.width > 0 && x.caja.height > 0)
            .map((x) => ({ el: x.el.className.split(' ').find((c) => c.startsWith('barra')), lectura, top: x.caja.top }));
        });
        for (const h of holgura) assert.ok(h.lectura <= h.top + 0.5, `la firma y la versión terminan antes de ${h.el} (${Math.round(h.lectura)} ≤ ${Math.round(h.top)})`);
        if (ancho < 1024 && vista === 'orden') assert.ok(holgura.some((h) => h.el === 'barra-accion'), 'en la cuenta, bajo 1024, la barra de cobro es una de las fijas que se miden');
      });
    });
  }
}

test('el pie del login lleva la misma firma y la versión (se puede tocar para buscar una nueva)', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    const estado = nuevoEstado(VERSION_PAGINA);
    await abrir(page, { estado, vista: 'login' });
    const pie = page.locator('.pos-pie-login');
    assert.equal(await pie.locator('a.firma').getAttribute('href'), 'https://ynt.codes');
    assert.equal((await pie.locator('.pos-pie-version').innerText()).trim(), `versión ${VERSION_PAGINA}`);
    const antes = estado.pedidos.length;
    await pie.locator('.pos-pie-version').click();
    await esperarPedidos(estado, antes + 1);
    assert.equal(estado.pedidos.length, antes + 1);
  });
});

test('tocar la versión del pie: «Buscando…», luego «Estás en la última versión»', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    const estado = nuevoEstado(VERSION_PAGINA);
    await abrir(page, { estado });
    estado.retardo = 600;
    const boton = page.locator('footer.pos-pie .pos-pie-version');
    const antes = estado.pedidos.length;
    await boton.click();
    await page.waitForFunction(() => document.querySelector('footer.pos-pie .pos-pie-version').innerText.trim() === 'Buscando…');
    assert.equal(await boton.isDisabled(), true, 'sin segundo toque mientras busca');
    await page.waitForFunction(() => /Estás en la última versión/.test(document.querySelector('footer.pos-pie .pos-pie-version').innerText));
    assert.equal(estado.pedidos.length, antes + 1, 'una sola búsqueda por toque');
    assert.equal(await visible(page), false, 'y sin aviso');
    // A los 4 s vuelve a decir la versión.
    await page.waitForFunction((v) => document.querySelector('footer.pos-pie .pos-pie-version').innerText.trim() === `versión ${v}`, VERSION_PAGINA, { timeout: 8000 });
  });
});

test('tocar la versión del pie con una versión nueva: sale el aviso aunque estuviera escondido, y la página sube hasta él', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    const estado = nuevoEstado(VERSION_NUEVA);
    await abrir(page, { estado, vista: 'orden' });
    await franja(page).getByRole('button', { name: 'Después', exact: true }).click();
    await esconde(page);
    // Se baja hasta el pie (la franja queda arriba, fuera de pantalla) y se toca la versión.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert.equal(await page.evaluate(() => scrollY > 50), true, 'la página es más larga que la pantalla');
    await adelantar(page, 30 * 1000);
    await page.locator('footer.pos-pie .pos-pie-version').click();
    await franja(page).waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.aviso-version').getBoundingClientRect().top >= -1, null, { timeout: 5000 });
    assert.match((await page.locator('footer.pos-pie .pos-pie-version').innerText()).trim(), /Hay una versión nueva/);
  });
});

test('tocar la versión del pie sin red lo dice: «Sin conexión: no pude comprobarlo»', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    const estado = nuevoEstado(VERSION_PAGINA);
    await abrir(page, { estado });
    estado.modo = 'sin-red';
    await page.locator('footer.pos-pie .pos-pie-version').click();
    await page.waitForFunction(() => /Sin conexión: no pude comprobarlo/.test(document.querySelector('footer.pos-pie .pos-pie-version').innerText));
    assert.equal(await visible(page), false);
  });
});

// ───────────────────────── «Recargar» ─────────────────────────

test('«Recargar» pide el documento y cada script del mismo origen ANTES de recargar, recarga UNA vez y, con la página aún vieja, el aviso vuelve sin recargar solo', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    const estado = nuevoEstado(VERSION_NUEVA);
    await abrir(page, { estado, vista: 'mesas' });
    await franja(page).waitFor();

    const pedidos = [];
    page.on('request', (r) => pedidos.push({ url: r.url(), tipo: r.resourceType(), pedido: r, navegacion: r.isNavigationRequest() }));
    const esperados = await page.evaluate(() => [...new Set([location.href.split('#')[0],
      ...[...document.querySelectorAll('script[src], link[rel~="stylesheet"][href]')].map((e) => new URL(e.getAttribute('src') || e.getAttribute('href'), location.href).href).filter((u) => new URL(u).origin === location.origin)])]);
    assert.ok(esperados.length >= 6, `el documento y sus cinco scripts locales (son ${esperados.length})`);

    // Algo a medio camino: lo que sobrevive tiene que estar en el almacenamiento, y la vista abierta no (se documenta).
    const historiaAntes = await page.evaluate(() => { window.__marcaDeEstaCarga = true; return history.length; });
    await page.evaluate(() => {
      localStorage.setItem('sb-prueba-auth-token', '{"access_token":"falso"}');
      localStorage.setItem('pos_delta_queue', JSON.stringify([{ id: 'delta-1', orden_id: 'o1', item_id: 'a', nombre: 'a', precio: 1000, nota: '', delta: 1 }]));
      localStorage.setItem('pos_pendientes', JSON.stringify(['ordenes:o1']));
      Alpine.store('pos').vista = 'productos';
    });
    const antes = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));

    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), franja(page).getByRole('button', { name: 'Recargar', exact: true }).click()]);
    await esperarListo(page);

    // 1) La caché se refrescó con pedidos fetch (cache «reload» manda Pragma: no-cache) y ANTES de la navegación.
    const iNav = pedidos.findIndex((p) => p.navegacion && p.url.split('#')[0] === esperados[0]);
    assert.ok(iNav > 0, 'la navegación de la recarga llegó después de otros pedidos');
    const fetches = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__fetches')));
    for (const url of esperados) {
      const i = pedidos.findIndex((p) => p.url === url && p.tipo === 'fetch');
      assert.ok(i >= 0 && i < iNav, `${url} se pidió con fetch ANTES de recargar`);
      assert.ok(fetches.some(([u, cache]) => u === url && cache === 'reload'), `${url}: se pidió con cache «reload» (a la red, y deja la respuesta en la caché)`);
    }
    assert.ok(fetches.some(([u, cache]) => /^version\.json\?t=\d+$/.test(u) && cache === 'no-store'), 'y version.json, con cache «no-store»');
    // 2) La recarga fue una recarga, y una sola.
    assert.equal(pedidos.filter((p) => p.navegacion).length, 1, 'una sola navegación');
    assert.equal(await page.evaluate(() => window.__marcaDeEstaCarga), undefined, 'la página se volvió a cargar (la marca que se le puso antes ya no está)');
    assert.equal(await page.evaluate(() => history.length), historiaAntes, 'y fue una recarga: no se agregó una entrada al historial');

    // 3) Lo que sobrevive y lo que no.
    const alCargar = await page.evaluate(() => window.__almacenAlCargar);
    for (const k of ['sb-prueba-auth-token', 'pos_delta_queue', 'pos_pendientes']) assert.equal(alCargar[k], antes[k], `${k} sobrevive a la recarga, intacto`);
    assert.equal(await page.evaluate(() => Alpine.store('pos').vista), 'mesas', 'la vista abierta NO sobrevive: se vuelve a Mesas (README, «La versión del sitio»)');
    assert.equal(await page.evaluate(() => !!Alpine.store('pos').usuario), true, 'y la sesión sigue');

    // 4) El servidor (un CDN atrasado) sigue publicando otra versión: el aviso vuelve, y nada recarga solo.
    await franja(page).waitFor({ state: 'visible' });
    await page.waitForTimeout(1500);
    assert.equal(pedidos.filter((p) => p.navegacion).length, 1, 'sigue habiendo una sola navegación: recargar es siempre un toque');
  });
});

test('con dos toques seguidos en «Recargar» (en el mismo instante) solo se recarga una vez', saltar, async () => {
  await conPagina(1280, 800, async (page) => {
    const estado = nuevoEstado(VERSION_NUEVA);
    await abrir(page, { estado });
    await franja(page).waitFor();
    let navegaciones = 0;
    page.on('request', (r) => { if (r.isNavigationRequest()) navegaciones++; });
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.evaluate(() => {
      const b = [...document.querySelectorAll('.aviso-version button')].find((x) => /Recargar/.test(x.textContent));
      b.click(); b.click();           // dos toques en el mismo turno: el segundo cae sobre un botón que ya está «Recargando…»
    })]);
    await page.waitForTimeout(300);
    assert.equal(navegaciones, 1);
  });
});

// ───────────────────────── «Recargar» no pierde lo que aún no está guardado ni tira el POS sin red ─────────────────────────
// (refutación de la integración version-nueva × para-llevar). El arnés simula la base dentro de la página: el «servidor» arranca de cero en
// cada carga, así que acá se mira lo que SÍ se puede ver: que no se navega mientras haya algo en camino, y qué dice la franja.

/** Deja a mano el cliente de Supabase (simulado) para poder colgar una RPC: window.__cliente. */
const ganchoDelCliente = (page) => page.addInitScript(() => {
  let sb;
  Object.defineProperty(window, 'supabase', {
    configurable: true,
    get() { return sb; },
    set(v) { const crear = v.createClient; v.createClient = (...a) => (window.__cliente = crear.apply(v, a)); sb = v; },
  });
});
const navegaciones = (page) => { const n = { total: 0 }; page.on('request', (r) => { if (r.isNavigationRequest()) n.total++; }); return n; };
const notaDeLaFranja = (page) => franja(page).locator('.aviso-version-txt').innerText();
const tocarRecargar = (page) => franja(page).getByRole('button', { name: 'Recargar', exact: true }).click();

test('«Recargar» con un «+1» que sigue en vuelo y la cuenta ya cobrada: no recarga mientras no llegue (el cobro y el +1 sobreviven), lo dice, y cuando llega recarga', saltar, async () => {
  await conPagina(390, 844, async (page) => {
    const estado = nuevoEstado(VERSION_NUEVA);
    await abrir(page, { estado, vista: 'orden', antesDeCargar: ganchoDelCliente });
    await franja(page).waitFor();
    await page.evaluate(() => { Alpine.store('pos')._esperaRecargaPasos = 8; });             // ~0,4 s en vez de ~5 s
    // aplicar_delta_orden sale y no contesta (red colgada): el delta solo vive en memoria mientras tanto.
    await page.evaluate(() => {
      const c = window.__cliente; const rpc = c.rpc.bind(c);
      c.rpc = (n, a) => (n === 'aplicar_delta_orden' ? new Promise((r) => { window.__llegar = () => r(rpc(n, a)); }) : rpc(n, a));
    });
    await page.evaluate(() => { const s = Alpine.store('pos'); s.incrementarItem(s.ordenes.find((x) => x.id === 'ord-abierta-3').items.find((i) => i.id === 'be1')); });
    assert.equal(await page.evaluate(() => Alpine.store('pos')._hayDeltasEnVuelo('ord-abierta-3')), true, 'el store sabe que hay una subida en vuelo');
    // Se cobra la mesa completa justo después, como lo haría el mesero: la cuenta se cierra en local y su subida espera al delta.
    await page.getByRole('button', { name: 'Generar ticket y cobrar' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Sí, cobrar' }).click();
    await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
    const nav = navegaciones(page);
    await tocarRecargar(page);
    await page.waitForFunction(() => /Todavía se está guardando/.test(document.querySelector('.aviso-version-txt').innerText));
    assert.equal(nav.total, 0, 'no se navegó: la página sigue');
    assert.equal(await page.evaluate(() => Alpine.store('pos').ordenes.find((x) => x.id === 'ord-abierta-3').estado), 'cerrada', 'el cobro sigue donde estaba');
    assert.equal(await franja(page).getByRole('button', { name: 'Recargar', exact: true }).isEnabled(), true, 'y el botón queda libre');
    // La base contesta: ya no hay nada en camino, y el siguiente toque sí recarga.
    await page.evaluate(() => window.__llegar());
    await page.waitForFunction(() => !Alpine.store('pos')._hayCambiosSinGuardar());
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), tocarRecargar(page)]);
    assert.equal(nav.total, 1, 'recargó una vez');
  });
});

const SIN_RED = [
  ['wifi sin internet (navigator.onLine sigue en true)', async (page, red) => { red.caida = true; }],
  ['el aparato sin red (offline del navegador)', async (page, red) => { red.caida = true; await page.context().setOffline(true); }],
];
for (const [nombre, cortar] of SIN_RED) {
  test(`«Recargar» con ${nombre}: el POS que trabajaba sin red NO se tira a la página de error del navegador, la franja lo dice y al volver la red recarga`, saltar, async () => {
    await conPagina(390, 844, async (page) => {
      const estado = nuevoEstado(VERSION_NUEVA);
      const red = { caida: false };
      await abrir(page, { estado, vista: 'mesas' });
      await franja(page).waitFor();
      // La red del local: cuando se «cae», TODO pedido al sitio falla, como en la vida real.
      await page.route(`${servidor.url}/**`, (route) => (red.caida ? route.abort('internetdisconnected') : route.fallback()));
      await cortar(page, red);
      const nav = navegaciones(page);
      await tocarRecargar(page);
      await page.waitForFunction(() => /Sin conexión|No pude descargar/.test(document.querySelector('.aviso-version-txt').innerText), null, { timeout: 15000 });
      assert.equal(page.url().startsWith(servidor.url), true, `el navegador sigue en el POS (no en chrome-error): ${page.url()}`);
      assert.equal(await page.evaluate(() => !!(window.Alpine && Alpine.store('pos') && Alpine.store('pos').avisoVersionVisible)), true, 'el POS está vivo y el aviso sigue');
      assert.equal(nav.total, 0, 'no se intentó navegar');
      assert.equal(await franja(page).getByRole('button', { name: 'Recargar', exact: true }).isEnabled(), true);
      // Vuelve la red: el mismo botón recarga.
      red.caida = false;
      await page.context().setOffline(false);
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), tocarRecargar(page)]);
      assert.equal(page.url().startsWith(servidor.url), true);
      await esperarListo(page);
    });
  });
}

// El aviso que llega con la cuenta ya abierta empuja la página: el pie de la columna del pedido (total y «Generar ticket y cobrar») tiene que seguir a la vista.
const cuentaLarga = (d) => {
  const o = d.tablas.ordenes.find((x) => x.id === 'ord-abierta-3');
  for (let k = 0; k < 11; k++) o.items.push({ id: `manual_${k}`, nombre: `Plato ficticio ${k + 1}`, precio: 10000 + k * 1000, qty: 1, nota: '' });
  o.total = o.items.reduce((s, i) => s + i.precio * i.qty, 0);
};
for (const [ancho, alto] of [[1024, 768], [1280, 800]]) {
  test(`${ancho}×${alto}: el aviso que llega con la cuenta ya abierta no deja «Generar ticket y cobrar» bajo el pliegue (la columna del pedido se vuelve a medir)`, saltar, async () => {
    await conPagina(ancho, alto, async (page) => {
      const estado = nuevoEstado(VERSION_PAGINA);                       // al abrir no hay versión nueva: la cuenta se abre SIN aviso
      await abrir(page, { estado, vista: 'orden', ajustar: cuentaLarga });
      await esperarEstable(page, 500);
      const boton = page.getByRole('button', { name: 'Generar ticket y cobrar' }).filter({ visible: true }).first();
      const medir = async () => { const r = await boton.boundingBox(); return { abajo: Math.round(r.y + r.height), alto: await page.evaluate(() => innerHeight) }; };
      const antes = await medir();
      assert.ok(antes.abajo <= antes.alto, `sin aviso el botón está a la vista (${antes.abajo} ≤ ${antes.alto})`);
      // Se publica una versión nueva y la búsqueda de turno la encuentra (lo mismo que hace el reloj de 5 minutos).
      estado.version = VERSION_NUEVA;
      await page.evaluate(() => Alpine.store('pos').buscarVersion({ manual: true }));
      await franja(page).waitFor();
      await page.waitForTimeout(600);
      const con = await medir();
      assert.ok(con.abajo <= con.alto, `«Generar ticket y cobrar» quedó cortado: termina en ${con.abajo} px y la ventana mide ${con.alto}`);
      // Y al esconder el aviso con «Después», vuelve a medirse (la columna recupera su alto).
      await franja(page).getByRole('button', { name: 'Después', exact: true }).click();
      await esconde(page);
      await page.waitForTimeout(400);
      const sin = await medir();
      assert.ok(sin.abajo <= sin.alto, `sin el aviso otra vez a la vista (${sin.abajo} ≤ ${sin.alto})`);
    });
  });
}
