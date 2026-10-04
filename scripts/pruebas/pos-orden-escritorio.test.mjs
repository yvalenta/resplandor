// La cuenta de una mesa en escritorio (≥ 1024 px): UN solo criterio de altura (pedido de Yonatan, 2026-10-03, con una captura a 1422 px:
// «hay un comportamiento extraño con los scroll en versión escritorio; se identifica un espacio innecesario blanco al final que se puede aprovechar»).
//
// Lo que se veía: tres barras a la vez (la de la página, la de la carta y la del pedido), un hueco blanco bajo el último producto de la carta y
// aire de más entre las tarjetas y el pie. Y, midiendo, algo peor: la página CRECÍA al bajar. Cada panel tenía su propia cuenta de alto —la carta
// «ventana − nav − 16rem», la columna del pedido «ventana − lo que hay encima, medido desde el borde de la ventana»— y ninguna sabía de la otra: la
// columna (pegajosa) se alargaba con cada scroll, arrastraba a la rejilla y la página medía más cuando ya se había bajado que cuando se empezó
// (1126 → 1275 px a 1422×1010); la carta, estirada por la columna, quedaba más alta que su buscador y su lista (el hueco blanco).
//
// LA REGLA (docs/pos-visual.md §0.25): la rejilla de la cuenta mide max( piso , ventana − lo ocupado ).
//   · lo ocupado = todo lo que no es la rejilla (aviso de versión, nav, cabecera, avisos de arriba, el aire de abajo y el pie), medido en coordenadas de
//     la PÁGINA: no cambia al hacer scroll;
//   · el piso = lo que necesita la columna del pedido para enseñar al menos TRES renglones enteros (los tres más altos que haya) junto al total. Se MIDE,
//     no se supone: un renglón liso mide 97 o 114 px, uno con variante o con la pastilla de persona a 1024 de ancho 141, uno con su selector de
//     «Cobrar − n +» 181.
// Mientras el piso cabe en la ventana, la rejilla la llena y la página no scrollea. Cuando no cabe, la rejilla vale su piso, la PÁGINA baja (a un alto
// fijo: no depende del scroll, así que no crece al desplazar) y la tarjeta del total, con «Generar ticket y cobrar», queda pegada al borde de abajo de la
// ventana (sticky), así que se ve siempre. La carta se encoge a su contenido: nunca deja hueco bajo el último producto.
//
// Por qué esta prueba mira «tres renglones» y no un número de píxeles: la primera versión tenía un piso de 13rem (la lista del pedido se quedaba en 0 px);
// la ronda 1 de refutación lo subió a 21.75rem con variantes por estado (23.5rem con personas, 18rem en el cobro por partes), calibrado para un renglón
// liso de 114 px; la ronda 2 mostró que con la cuenta dividida el botón de cobro arrancaba FUERA de la ventana y que un renglón de 141 o de 181 px no
// cabía. Con el pos.html de d3963d8 (RAIZ_POS=<carpeta con él>) fallan la cuenta dividida, los renglones altos, la carta corta y la barra del cobro.
//
// Dos partes:
//   A. ESTÁTICA (corre siempre, también en CI): la hoja y el store de pos.html.
//   B. EN NAVEGADOR (solo con Playwright y Chromium; si no, se salta con el motivo): el arnés de _pos-simulado.mjs.
//      · cinco tamaños (1024×768, 1280×800, 1422×1010 —la captura de Yonatan—, 1440×900 y 1920×1080), con el aviso de versión escondido y visible;
//      · una tabla de CASOS (cuenta dividida entre tres personas, con nombres largos, con el enlace NFC abierto, con un aviso de cobro, con variantes a 1024,
//        «Todo para llevar», con las casillas del cobro por partes…) en ocho tamaños (los cinco, 1366×768, 1366×657 y 1024×614 = 1280×768 al 125 % de zoom):
//        en TODOS el botón de cobro está entero dentro de la ventana sin desplazar, el pedido enseña ≥ 3 renglones o la página puede bajar hasta verlos, la
//        página no crece al desplazar y la carta no deja hueco; 390 y 768 no cambian.
//
// Para ver qué hacía el POS de antes: RAIZ_POS=<carpeta con el pos.html viejo y assets/> node --test scripts/pruebas/pos-orden-escritorio.test.mjs
'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { VISTAS, datosFicticios, esperarEstable, esperarListo, nuevoContexto, prepararPagina, servirPos } from './_pos-simulado.mjs';

const RAIZ = process.env.RAIZ_POS ? path.resolve(process.env.RAIZ_POS) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const VERSION_PAGINA = POS.match(/<meta name="resplandor-version" content="([^"]+)"/)[1];
const VERSION_NUEVA = '2099.01.01-abcdef0';
const DIR_CACHE = path.join(os.tmpdir(), 'resplandor-pos-cdn');

// Los cinco tamaños del pedido (1422×1010 es la ventana de la captura de Yonatan).
const TAMANOS = [[1024, 768], [1280, 800], [1422, 1010], [1440, 900], [1920, 1080]];
// Los ocho de los casos: los cinco, un portátil de 1366×768 (con la barra del navegador queda de 657 px) y 1280×768 al 125 % de zoom
// (= 1024×614 px CSS con densidad 1,25: lo que ve el navegador al hacer zoom).
const OCHO = [[1024, 768], [1280, 800], [1366, 768], [1366, 657], [1422, 1010], [1440, 900], [1920, 1080], [1024, 614, 1.25]];
const FILAS_MINIMAS = 3;
const AIRE_TOTAL = 0;     // la tarjeta del total pegada va a ras del borde de abajo de la ventana (más la zona segura: 0 en el arnés)

// ═════════════════════════ A. estática: la hoja y el store ═════════════════════════

const CSS = POS.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
/** Cuerpos de las reglas de `selector` (texto exacto del selector) dentro de los @media de ≥ 1024 px. */
function reglasDesde1024(selector) {
  const cuerpos = [];
  for (const m of CSS.matchAll(/@media screen and \(min-width: 1024px\)\s*\{/g)) {
    let nivel = 1; let i = m.index + m[0].length; const ini = i;
    while (i < CSS.length && nivel > 0) { if (CSS[i] === '{') nivel++; else if (CSS[i] === '}') nivel--; i++; }
    const bloque = CSS.slice(ini, i - 1);
    for (const r of bloque.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (r[1].trim() === selector) cuerpos.push(r[2]);
  }
  return cuerpos;
}
/** El texto de una función del store (o '' si no existe: con el pos.html de antes la prueba tiene que FALLAR por eso, no romper al cargar). */
const cuerpoDe = (nombre, texto, hasta) => {
  const i = texto.indexOf(nombre);
  return i === -1 ? '' : texto.slice(i, texto.indexOf(hasta, i));
};
const vigilar = cuerpoDe('vigilarAltoPedido(rejilla) {', POS, '\n            },\n');
const pisoOrden = cuerpoDe('_pisoOrden(rejilla) {', POS, '\n            },\n');

test('la rejilla de la cuenta mide max(piso, ventana − lo ocupado) desde 1024: el piso viene medido, ningún panel tiene alto propio y el total queda pegado al fondo', () => {
  const rejilla = reglasDesde1024('.vista-orden > .orden-rejilla').join('\n');
  assert.match(rejilla, /height:\s*max\(var\(--orden-piso, 21\.75rem\), calc\(100dvh - var\(--orden-ocupado, calc\(var\(--pos-nav-alto\) \+ 17\.5rem\)\)\)\)/, 'la rejilla mide max(piso, ventana − lo ocupado); el piso medido va en --orden-piso y 21.75rem es solo el respaldo del primer cuadro');
  assert.match(rejilla, /height:\s*max\(var\(--orden-piso, 21\.75rem\), calc\(100vh - var\(--orden-ocupado/, 'con la variante vh detrás de la dvh');
  assert.match(rejilla, /grid-template-rows:\s*minmax\(0, auto\) minmax\(0, 1fr\)/, 'la fila del abono toma lo suyo y la de la carta puede encogerse a 0');
  assert.doesNotMatch(rejilla, /--orden-piso:/, 'el respaldo va en el var(): --orden-piso solo se declara en el cobro por partes y lo escribe el store (pos-visual.test.mjs exige un :root para las var() sin respaldo)');
  // Ya no hay pisos por estado calibrados para un renglón liso: el de la cuenta dividida se fue (el piso se mide con el renglón más alto que haya).
  assert.deepEqual(reglasDesde1024('.vista-orden > .orden-rejilla.orden-con-personas'), [], 'sin piso aparte para la cuenta dividida (23.5rem): el piso se mide');
  assert.doesNotMatch(CSS, /23\.5rem/, 'ninguna hoja conserva el número calibrado para las filas con pastilla de persona');
  const parcial = reglasDesde1024('.vista-orden > .orden-rejilla.orden-en-parcial').join(';');
  assert.match(parcial, /--orden-piso:\s*18rem/, '«Cobrar por partes»: 18rem es el respaldo del primer cuadro (el piso real también se mide)');
  assert.match(parcial, /height:\s*auto/, 'y la rejilla toma el alto del abono si la ventana no da…');
  assert.match(parcial, /min-height:\s*max\(var\(--orden-piso, 18rem\), calc\(100dvh - var\(--orden-ocupado/, '…con el piso y la ventana como mínimo');
  assert.match(reglasDesde1024('.orden-rejilla.orden-en-parcial > .col-pedido').join(';'), /contain:\s*size/, 'la columna del pedido no aporta su lista al alto de la rejilla (scrollea por dentro)');
  assert.deepEqual(reglasDesde1024('.bloque-monto'), [], 'el abono no scrollea por dentro: manda el alto de la rejilla');
  // Ningún panel tiene ya su propia cuenta de alto: ni max-height en la lista de la carta ni en la columna, ni sticky en la columna.
  for (const sel of ['.menu-scroll', '.col-pedido', '.pedido-card']) {
    for (const cuerpo of reglasDesde1024(sel)) assert.doesNotMatch(cuerpo, /max-height|position:\s*sticky/, `${sel}: sin alto propio ni sticky`);
  }
  assert.match(reglasDesde1024('.menu-scroll').join(';'), /flex:\s*1 1 0%[^]*min-height:\s*0[^]*overflow-y:\s*auto/, 'la lista de la carta se queda con lo que sobra y scrollea por dentro');
  assert.match(reglasDesde1024('.col-pedido').join(';'), /align-self:\s*stretch/, 'la columna del pedido mide lo que la rejilla (antes, `start` + sticky)');
  assert.match(reglasDesde1024('.pedido-card').join(';'), /min-height:\s*0[^]*overflow-y:\s*auto/, 'la lista del pedido scrollea por dentro');
  // La carta se encoge a su contenido y no pasa del alto de la rejilla: nunca queda un hueco bajo el último producto.
  const carta = reglasDesde1024('.carta-panel').join(';');
  assert.match(carta, /align-self:\s*start/, 'la carta no se estira con la rejilla: mide lo que su contenido…');
  assert.match(carta, /max-height:\s*100%/, '…hasta el alto de la rejilla');
  // El total, pegado al borde de abajo de la ventana con su zona segura cuando el piso hace bajar la página.
  const barra = reglasDesde1024('.col-pedido > .barra-accion').join(';');
  assert.match(barra, /position:\s*sticky/, 'la tarjeta del total (con «Generar ticket y cobrar») es pegajosa');
  assert.match(barra, /bottom:\s*var\(--pos-safe-b\)/, 'a ras del borde de abajo, con la zona segura (sin hueco debajo: por él se asomaba el texto de los renglones)');
  assert.match(barra, /z-index:\s*2/, 'y por encima de la lista del pedido, que es lo que tapa');
  // Con el piso la página puede scrollear: la rueda y el dedo al final de una lista tienen que poder pasar a ella.
  for (const sel of ['.pedido-card', '.menu-scroll']) assert.doesNotMatch(reglasDesde1024(sel).join(';'), /overscroll-behavior/, `${sel}: al final de su lista, el scroll pasa a la página`);
  assert.match(reglasDesde1024('.barra-accion .total-grande').join(';'), /line-height:\s*1;/, 'el total no gasta 3 px de interlínea');
  assert.match(reglasDesde1024('.vista-orden').join(';'), /padding-bottom:\s*1rem/, 'el aire de abajo es de 1rem, no de 2rem + el del pie');
  assert.match(reglasDesde1024('.carta-panel.carta-en-parcial').join(';'), /display:\s*none/, 'en «Cobrar por partes» la carta no se muestra tampoco desde 1024 (decisión documentada en §0.25)');
  assert.match(POS, /<div class="grid grid-cols-1 gap-4[^"]*\borden-rejilla"/, 'la rejilla lleva su clase (al final: integracion-personas-impresion.test.mjs la ubica por el arranque de su class)');
  assert.match(POS, /\borden-rejilla"\s*:class="\{ 'orden-en-parcial': \$store\.pos\.seleccionCobro \}"/, 'y el cobro por partes le pone su clase (la cuenta dividida ya no hace falta: el piso se mide)');
  assert.doesNotMatch(POS, /orden-con-personas/, 'ninguna referencia a la clase de la cuenta dividida');
  assert.match(POS, /<div class="card a-sangre p-0 [^"]*\bcarta-panel"/, 'el panel de la carta lleva su clase');
  assert.match(POS, /<div class="pedido-cab mb-2 lg:mb-4">/, 'la cabecera del pedido conserva su margen de siempre (1rem): con «Todo para llevar» la franja no queda a 4 px del botón');
  assert.doesNotMatch(POS, /columna pegajosa/, 'ya no hay columna pegajosa: ningún comentario del marcado la menciona');
});

test('vigilarAltoPedido mide lo ocupado en coordenadas de la PÁGINA y el piso con los tres renglones más altos; no escucha el scroll', () => {
  assert.ok(vigilar && pisoOrden, 'existen vigilarAltoPedido y _pisoOrden');
  assert.match(vigilar, /--orden-ocupado/);
  assert.doesNotMatch(vigilar, /--pedido-ocupado/, 'la medida vieja («desde el borde de la ventana») se fue');
  assert.doesNotMatch(vigilar, /addEventListener\('scroll'/, 'nada de lo que se mide cambia con el scroll: no hay por qué volver a medir con cada uno');
  assert.match(vigilar, /window\.scrollY/, 'el final del pie se pasa a coordenadas de la página');
  assert.match(vigilar, /new ResizeObserver\(pedir\)\.observe\(rejilla\.parentElement\)/, 'sigue vigilando lo que hay encima');
  assert.match(vigilar, /new ResizeObserver\(pedir\)\.observe\(avisoVersion\)/, 'y el aviso de versión (su lógica no se tocó)');
  assert.match(vigilar, /this\._pisoOrden\(rejilla\)/, 'el piso se mide con lo que hay en pantalla…');
  assert.match(vigilar, /setProperty\('--orden-piso'/, '…y se le pasa a la hoja');
  assert.match(vigilar, /removeProperty\('--orden-piso'\)/, 'y bajo 1024 no hay nada que medir');
  assert.match(vigilar, /new ResizeObserver\(pedir\)[^;]*;[^]*observe\(c\)/, 'se vigila lo que mide por dentro la tarjeta del pedido (renglones, cabecera, «Todo para llevar») y la del total');
  assert.match(pisoOrden, /FILAS_MINIMAS = 3/, 'el piso enseña tres renglones enteros');
  assert.match(pisoOrden, /\.order-item/, 'medidos con los renglones reales…');
  assert.match(pisoOrden, /\.sort\(\(a, b\) => b - a\)[^]*\.slice\(0, FILAS_MINIMAS\)/, '…los más altos que haya, no con un alto supuesto');
  assert.match(pisoOrden, /tarjeta\.scrollTop/, 'en coordenadas del contenido de la tarjeta: no cambia con el scroll de la lista');
  assert.match(pisoOrden, /rowGap/, 'más el hueco entre las tarjetas');
  assert.doesNotMatch(CSS, /--pedido-ocupado/, 'la hoja ya no lee la medida vieja');
});

// ═════════════════════════ B. en navegador ═════════════════════════

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

const presencia = (d) => { d.presencia = [{ mesaId: 3, deviceId: 'otro-dispositivo', nombre: 'Mesera Demo', ts: 1790000000000 }]; };
/** La cuenta dividida de la mesa 3, con nombres de persona de los que se parten en dos líneas dentro de la pastilla. */
const nombresLargos = (d) => {
  const o = d.tablas.ordenes.find((x) => x.id === 'ord-abierta-3');
  for (const i of o.items) {
    i.nota = i.nota.replace('Camila', 'Valentina Alejandra Rodríguez de la Torre').replace('Andrés', 'Juan Sebastián Hernández-Villamizar').replace('Persona 3', 'Persona 3 (María Fernanda Castañeda Echeverry)');
  }
};
const conEnlaceNfc = (page) => page.evaluate(() => { Alpine.store('pos').mostrarEnlaceMesa = true; });
/** «Cobrar por partes» con dos renglones de varias unidades marcados: cada uno despliega su selector «Cobrar − n + de n» (renglones de ≈ 180 px). */
const conCobroPartes = (page) => page.evaluate(() => {
  const p = Alpine.store('pos');
  p.toggleModoCobroParcial();
  const [a, , c] = p.ordenActiva.items;
  p.toggleSeleccion(a); p.toggleSeleccion(c);
});

/** Abre una vista de la cuenta como abrirPos, pero con `version.json` controlado: `aviso` = el aviso de versión sale desde el principio. */
async function abrir({ ancho, alto, escala, vista = 'orden-larga', aviso = false, ajustar, despues }) {
  const estado = { version: aviso ? VERSION_NUEVA : VERSION_PAGINA };
  const contexto = await nuevoContexto(navegador, { ancho, alto, escala });
  const page = await contexto.newPage();
  const def = VISTAS[vista];
  const diag = await prepararPagina(page, { url: servidor.url, datos: datosFicticios((d) => { def.ajustar?.(d); ajustar?.(d); }), sesion: true, dirCache: DIR_CACHE, bloquearFuentes: true });
  await page.route(/\/version\.json(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: estado.version, fecha: '2099-01-01', huella: 'x' }) }));
  await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page);
  await def.llegar(page);
  if (aviso) await page.locator('.aviso-version').waitFor();
  if (despues) await despues(page);
  await esperarEstable(page);
  await page.evaluate(() => window.scrollTo(0, 0));     // algunas vistas del arnés dejan el abono o un renglón a media ventana: se parte de arriba
  await reposo(page);
  return { page, contexto, diag, estado };
}
/** La medida se hace en un cuadro de animación tras el cambio: se deja pasar un rato antes de mirar. */
const reposo = (page, ms = 350) => page.waitForTimeout(ms);

/**
 * Todo lo que cuenta de la altura, de una vez. Los elementos se buscan por estructura (la rejilla es el `.grid` de la vista; el panel de la carta,
 * el padre de su lista) y no por las clases nuevas, para que la misma medida corra contra el pos.html de antes y falle por lo que MIDE, no por
 * no encontrar una clase.
 */
const foto = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const caja = (e) => { if (!vis(e)) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, alto: b.height, scroll: e.scrollHeight, cliente: e.clientHeight, scrollTop: e.scrollTop }; };
  const tarjeta = q('.pedido-card');
  const total = q('.barra-accion');
  const nav = q('nav.nav-bar');
  const navAbajo = nav && getComputedStyle(nav).position !== 'static' ? nav.getBoundingClientRect().bottom : 0;     // el nav pegado arriba tapa lo que pase por debajo
  const rt = tarjeta.getBoundingClientRect();
  const rtot = vis(total) ? total.getBoundingClientRect() : null;
  const cs = getComputedStyle(tarjeta);
  const borde = parseFloat(cs.borderTopWidth);
  const relleno = parseFloat(cs.paddingBottom);
  // La tarjeta del total, pegada al borde de abajo, tapa lo de más abajo de la lista del pedido: ahí no se ve nada.
  const tapa = rtot && rtot.top < rt.bottom && rtot.bottom > rt.top ? rtot.top : Infinity;
  const tope = Math.max(rt.top + borde, navAbajo);
  const fondo = Math.min(rt.bottom - borde, innerHeight, tapa);
  const filas = [...tarjeta.querySelectorAll('.order-item')].filter(vis);
  const altos = filas.map((f) => f.getBoundingClientRect().height);
  const enteras = filas.filter((f) => { const b = f.getBoundingClientRect(); return b.top >= tope - 0.5 && b.bottom <= fondo + 0.5; }).length;
  const n = Math.min(3, filas.length);
  const masAltas = [...altos].sort((a, b) => b - a).slice(0, n).reduce((s, h) => s + h, 0);
  const primeras = altos.slice(0, n).reduce((s, h) => s + h, 0);
  // Con la lista arriba: lo que sobra en la tarjeta bajo el tercer renglón, y lo que de más cabe por ser los tres más altos y no los tres primeros.
  const sobra = filas.length && tarjeta.scrollTop === 0 ? (rt.bottom - borde - relleno) - filas[n - 1].getBoundingClientRect().bottom : null;
  // El límite físico: entre el nav pegado arriba y el total pegado abajo (con su aire) queda esto; los renglones que caben ahí, de los tres primeros.
  const espacio = innerHeight - navAbajo - 0 - (rtot ? rtot.height : 0);
  let caben = 0; let suma = 0;
  for (const h of altos.slice(0, 3)) { if (suma + h > espacio) break; suma += h; caben++; }
  const boton = [...document.querySelectorAll('.barra-accion .btn-primary')].find(vis);
  const bb = boton && boton.getBoundingClientRect();
  const items = [...document.querySelectorAll('.menu-scroll .menu-item')];
  const ultimo = items.length ? items[items.length - 1].getBoundingClientRect() : null;
  const rej = q('.vista-orden > .grid');
  return {
    ventana: innerHeight, documento: document.documentElement.scrollHeight, scrollY: Math.round(scrollY),
    rejilla: caja(rej), carta: caja(q('.menu-scroll')?.parentElement), lista: caja(q('.menu-scroll')), columna: caja(q('.col-pedido')), pedido: caja(tarjeta),
    total: caja(total), pie: caja(q('footer.pos-pie')), aviso: caja(q('.aviso-version')), abono: caja(q('.bloque-monto')),
    aireAbajo: parseFloat(getComputedStyle(q('.vista-orden')).paddingBottom), ultimoProducto: ultimo ? { top: ultimo.top, bottom: ultimo.bottom } : null,
    filas: filas.length, enteras, altos, sobra, demas: masAltas - primeras, caben, navAbajo,
    // el scroll de la página al que cada uno de los tres primeros renglones queda justo bajo el nav (con la lista arriba): donde más de ellos caben
    alineadas: filas.slice(0, 3).map((f) => scrollY + f.getBoundingClientRect().top - navAbajo),
    piso: rej.style.getPropertyValue('--orden-piso'), ocupado: rej.style.getPropertyValue('--orden-ocupado'),
    boton: bb ? { top: bb.top, bottom: bb.bottom, encima: boton.contains(document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2)) } : null,
  };
});
const alFinal = async (page) => {
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollTo(0, 1e5)); await reposo(page, 150); }
  return foto(page);
};
/**
 * «La página puede bajar hasta verlos»: recorre el scroll de la página y devuelve la mejor vista del pedido (más renglones enteros entre el nav pegado
 * arriba y el total pegado abajo). Con el total pegado y un nav de 68 px, en una ventana de 614 px solo queda un hueco de unos 390 px para la tarjeta del
 * pedido: ahí los tres renglones se ven a media bajada, no con la página al final (donde el nav tapa la cabecera y lo de arriba de la lista).
 */
const mejorVista = async (page) => {
  const maximo = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const { alineadas } = await foto(page);
  // Los puntos del barrido (cada ~1/60 del recorrido) y, para no perder un hueco de unos pocos px, los que dejan un renglón justo bajo el nav.
  const puntos = new Set(alineadas.map((y) => Math.min(Math.max(Math.ceil(y), 0), maximo)));
  for (let y = 0; y <= maximo + 8; y += Math.max(8, Math.ceil(maximo / 60))) puntos.add(Math.min(y, maximo));
  let mejor = null;
  for (const y of [...puntos].sort((a, b) => a - b)) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    const m = await foto(page);
    if (!mejor || m.enteras > mejor.enteras) mejor = { ...m, y: m.scrollY };
  }
  return mejor;
};
const cerca = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const disponible = (m) => m.ventana - m.rejilla.top - m.aireAbajo - m.pie.alto;     // con la página arriba

for (const [ancho, alto] of TAMANOS) {
  for (const aviso of [false, true]) {
    test(`${ancho}×${alto}, aviso de versión ${aviso ? 'visible' : 'escondido'}: la rejilla mide max(piso, lo que le queda a la ventana) y la página solo baja si el piso no cabe; el total siempre a la vista`, saltar, async () => {
      const { page, contexto, diag } = await abrir({ ancho, alto, aviso });
      try {
        const m = await foto(page);
        const disp = disponible(m);
        assert.ok(m.rejilla.alto >= disp - 1.5, `la rejilla mide ${m.rejilla.alto.toFixed(1)} y le quedan ${disp.toFixed(1)}: nunca menos de lo que le queda a la ventana`);
        const crece = m.rejilla.alto > disp + 1.5;
        assert.equal(m.documento > m.ventana, crece, `la página (${m.documento} en una ventana de ${m.ventana}) solo baja si la rejilla (${m.rejilla.alto.toFixed(1)}) pasó de lo que le queda (${disp.toFixed(1)})`);
        assert.ok(cerca(m.carta.alto, m.rejilla.alto) && cerca(m.columna.alto, m.rejilla.alto), 'la carta (larga) y la columna del pedido miden lo que la rejilla');
        assert.ok(cerca(m.carta.top, m.columna.top) && cerca(m.carta.bottom, m.columna.bottom), 'y empiezan y acaban en la misma línea');
        if (!crece) {
          // Lo de siempre: la página mide lo que la ventana y el pie es lo último, pegado al borde de abajo (sin aire de más).
          assert.equal(m.documento, m.ventana, `la página mide ${m.documento} y la ventana ${m.ventana}`);
          assert.ok(cerca(m.pie.bottom, m.ventana), `el pie termina en ${m.pie.bottom.toFixed(1)} de ${m.ventana}`);
          assert.ok(m.pie.top - m.rejilla.bottom <= 17, `entre los paneles y el pie hay ${(m.pie.top - m.rejilla.bottom).toFixed(1)} px (1rem de aire)`);
        }
        // Dos paneles y nada más con scroll propio; el total con su botón, entero a la vista, sin desplazar (pegado al borde si hace falta).
        assert.ok(m.lista.scroll > m.lista.cliente + 100, 'la lista de la carta hace scroll por dentro');
        assert.ok(m.pedido.scroll > m.pedido.cliente + 50 || crece, 'la lista del pedido hace scroll por dentro (o la rejilla creció para enseñar sus tres renglones)');
        assert.ok(m.total.top >= m.pedido.top && m.total.bottom <= m.ventana - AIRE_TOTAL + 0.5, `el total queda en ${m.total.top.toFixed(0)}–${m.total.bottom.toFixed(0)} de ${m.ventana}`);
        assert.ok(m.boton.top >= 0 && m.boton.bottom <= m.ventana && m.boton.encima, `«Generar ticket y cobrar» está entero a la vista y sin nada encima (${m.boton.top.toFixed(0)}–${m.boton.bottom.toFixed(0)})`);
        assert.equal(aviso, !!m.aviso, 'el aviso de versión está donde la prueba lo pidió');
        // El pedido enseña tres renglones enteros (o los que quepan entre el nav y el total pegados) en cuanto la página baja lo que haga falta.
        const mejor = await mejorVista(page);
        const esperadas = Math.min(FILAS_MINIMAS, mejor.filas, mejor.caben);
        assert.ok(mejor.enteras >= esperadas, `el pedido enseña ${mejor.enteras} de ${esperadas} renglones enteros (la rejilla mide ${m.rejilla.alto.toFixed(0)} y le quedan ${disp.toFixed(0)})`);
        assert.deepEqual(diag.errores, []);
      } finally { await contexto.close(); }
    });

    test(`${ancho}×${alto}, aviso ${aviso ? 'visible' : 'escondido'}: desplazar la página o un panel no cambia nada (la página no crece), y la carta termina en su último producto, sin hueco`, saltar, async () => {
      const { page, contexto } = await abrir({ ancho, alto, aviso });
      try {
        const antes = await foto(page);
        // 1) El documento: pide el final varias veces (antes la página crecía al bajar y un solo scrollTo se quedaba corto).
        const fin = await alFinal(page);
        assert.equal(fin.documento, antes.documento, 'la página no creció al bajar');
        assert.ok(cerca(fin.rejilla.alto, antes.rejilla.alto, 0.5), 'ni la rejilla cambió de alto');
        assert.ok(cerca(fin.rejilla.top, antes.rejilla.top - fin.scrollY, 0.5), 'solo se movió lo que scrolleó la página');
        assert.equal(fin.scrollY > 0, antes.documento > antes.ventana, 'y la página tiene adónde bajar solo si el piso no cabía');
        // 2) Con la rueda sobre la carta, hasta el fondo (y de más): la lista baja y la página no cambia de alto.
        const lista = page.locator('.menu-scroll');
        const c = await lista.boundingBox();
        await page.mouse.move(c.x + c.width / 2, Math.min(c.y + c.height / 2, fin.ventana - 5));
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 4000); await reposo(page, 150); }
        let ahora = await foto(page);
        assert.ok(ahora.lista.scroll - ahora.lista.cliente > 0 && await lista.evaluate((e) => Math.ceil(e.scrollTop + e.clientHeight) >= e.scrollHeight - 1), 'la lista de la carta llegó a su final');
        assert.equal(ahora.documento, antes.documento, 'y la página no cambió de alto');
        // Sin hueco: el último producto acaba en el fondo del panel (a lo sumo el borde de 1 px y 4 px de redondeo).
        assert.ok(ahora.carta.bottom - ahora.ultimoProducto.bottom <= 4, `bajo «${await page.locator('.menu-scroll .menu-item').last().locator('.menu-item-name').innerText()}» quedan ${(ahora.carta.bottom - ahora.ultimoProducto.bottom).toFixed(1)} px de panel`);
        assert.ok(cerca(ahora.lista.bottom, ahora.carta.bottom, 2.5), 'y la lista llega hasta el fondo del panel: no queda una franja sin lista debajo');
        // 3) Lo mismo con la rueda sobre el pedido (con la página al final se ve entera).
        const p = await page.locator('.pedido-card').boundingBox();
        await page.mouse.move(p.x + p.width / 2, Math.min(p.y + p.height / 2, fin.ventana - 5));
        const yAntes = ahora.scrollY; const totalAntes = ahora.total;
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 4000); await reposo(page, 150); }
        ahora = await foto(page);
        assert.equal(ahora.documento, antes.documento);
        assert.equal(ahora.scrollY, yAntes, 'la página ya estaba al final: no se movió');
        assert.ok(cerca(ahora.total.top, totalAntes.top, 0.5), 'el total no se movió');
      } finally { await contexto.close(); }
    });
  }
}

// ───────────── la tabla de casos: en todos, el botón de cobro a la vista y los tres renglones del pedido a mano ─────────────

const CASOS = [
  { nombre: 'la cuenta de la mesa 3 (primer renglón: ejecutivo con variante, 141 px a 1024)', vista: 'orden' },
  { nombre: 'carta larga y cuenta de 9 renglones', vista: 'orden-larga' },
  { nombre: 'la cuenta dividida entre 3 personas', vista: 'orden-personas' },
  { nombre: 'la cuenta dividida entre 3 personas con nombres largos', vista: 'orden-personas', ajustar: nombresLargos },
  { nombre: 'el enlace NFC abierto', vista: 'orden-larga', despues: conEnlaceNfc },
  { nombre: 'un aviso de cobro («pidió la cuenta»)', vista: 'orden-alerta' },
  { nombre: 'otra tablet en la mesa', vista: 'orden', ajustar: presencia },
  { nombre: '«Todo para llevar»', vista: 'orden-llevar-todo' },
  { nombre: '«Cobrar por partes» con casillas y el selector «Cobrar − n +»', vista: 'orden-larga', despues: conCobroPartes, parcial: true },
  { nombre: '«Cobrar por partes» con un abono escrito', vista: 'orden-cobro-monto', parcial: true },
];

/** Revisa un caso en un tamaño y devuelve lo que falla (vacío si todo va bien). */
async function revisar(caso, [ancho, alto, escala = 1]) {
  const donde = `${ancho}×${alto}${escala !== 1 ? ` (zoom del ${Math.round(escala * 100)} %)` : ''}`;
  const fallas = [];
  const falla = (texto) => fallas.push(`${donde}: ${texto}`);
  const { page, contexto, diag } = await abrir({ ancho, alto, escala, ...caso });
  try {
    const f0 = await foto(page);
    const disp = disponible(f0);
    const crece = f0.rejilla.alto > disp + 1.5;
    const min = Math.min(FILAS_MINIMAS, f0.filas);
    if (f0.rejilla.alto < disp - 1.5) falla(`la rejilla mide ${f0.rejilla.alto.toFixed(1)} y a la ventana le quedan ${disp.toFixed(1)}`);
    if (!caso.parcial && (f0.documento > f0.ventana) !== crece) falla(`la página mide ${f0.documento} en una ventana de ${f0.ventana} y la rejilla ${f0.rejilla.alto.toFixed(1)} (le quedan ${disp.toFixed(1)})`);
    // 1) El botón de cobro (o, en «Cobrar por partes», la tarjeta del total), entero dentro de la ventana, sin desplazar. Solo hay una excepción física: que lo de
    //    arriba (cabecera, avisos, la tarjeta de las personas) llegue tan abajo que ni con el total en lo más alto de su columna quepa; entonces se mira que
    //    quepa al bajar lo que falta, y siempre con la página al final.
    const botonOTotal = caso.parcial ? { top: f0.total.top, bottom: f0.total.bottom, encima: true } : f0.boton;
    if (!botonOTotal) falla('no hay botón de «Generar ticket y cobrar»');
    else {
      const bajoTotal = caso.parcial ? 0 : f0.boton.bottom - f0.total.top;          // lo que hay del borde de arriba de la tarjeta al fondo del botón
      const imposible = f0.rejilla.top + bajoTotal > f0.ventana;
      if (!imposible && !(botonOTotal.top >= 0 && botonOTotal.bottom <= f0.ventana && botonOTotal.encima)) falla(`${caso.parcial ? 'el total' : '«Generar ticket y cobrar»'} está en ${botonOTotal.top.toFixed(0)}–${botonOTotal.bottom.toFixed(0)} de una ventana de ${f0.ventana} (página de ${f0.documento})`);
      if (!caso.parcial && !imposible && f0.total.bottom > f0.ventana - AIRE_TOTAL + 0.5) falla(`la tarjeta del total acaba en ${f0.total.bottom.toFixed(0)}: no queda pegada al borde de abajo (${f0.ventana})`);
    }
    // 2) El pedido enseña tres renglones enteros o la página puede bajar hasta verlos.
    //    Con el nav pegado arriba y el total pegado abajo, en una ventana baja solo queda un hueco para la lista: se pide lo que cabe en él (f0.caben, ≤ 3).
    const esperadas = Math.min(min, f0.caben);
    if (f0.enteras < esperadas && !(f0.documento > f0.ventana)) falla(`el pedido enseña ${f0.enteras} de ${esperadas} renglones y la página no baja`);
    const mejor = await mejorVista(page);
    if (mejor.enteras < esperadas) falla(`bajando la página, lo más que se ve del pedido son ${mejor.enteras} de ${esperadas} renglones enteros (${mejor.altos.slice(0, 3).map((h) => h.toFixed(0)).join('/')} px; el hueco entre el nav y el total deja ${f0.caben} de ${min})`);
    const fin = await alFinal(page);
    if (!caso.parcial && !(fin.boton && fin.boton.top >= 0 && fin.boton.bottom <= fin.ventana && fin.boton.encima)) falla(`con la página al final «Generar ticket y cobrar» no está entero a la vista (${fin.boton && fin.boton.top.toFixed(0)}–${fin.boton && fin.boton.bottom.toFixed(0)})`);
    // 3) Y no más de lo que hace falta: con la rejilla crecida, bajo los tres renglones sobra a lo sumo lo que hay de los tres más altos a los tres primeros.
    if (!caso.parcial && crece && fin.sobra !== null && fin.sobra > fin.demas + 2) falla(`la rejilla creció de más: bajo el renglón ${min} sobran ${fin.sobra.toFixed(1)} px (de más por los más altos: ${fin.demas.toFixed(1)})`);
    // 4) La página no crece al desplazar (ni de arriba abajo ni de vuelta) ni al volver a medir, y la rejilla no cambia de alto.
    if (fin.documento !== f0.documento) falla(`la página crece al bajar: ${f0.documento} → ${fin.documento}`);
    if (!cerca(fin.rejilla.alto, f0.rejilla.alto, 0.5)) falla(`la rejilla cambia de alto al bajar: ${f0.rejilla.alto.toFixed(1)} → ${fin.rejilla.alto.toFixed(1)}`);
    //    Volver a medir con la página bajada y con la lista del pedido llevada a su final (lo medido está en coordenadas de la página y del contenido de la
    //    tarjeta: no depende de cuánto se ha desplazado ni la una ni la otra) da lo mismo que al empezar.
    await page.locator('.pedido-card').evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await reposo(page);
    const bajada = await foto(page);
    if (bajada.documento !== f0.documento || bajada.piso !== f0.piso || bajada.ocupado !== f0.ocupado) falla(`al volver a medir con la página y la lista bajadas cambia la página (${f0.documento} → ${bajada.documento}), el piso (${f0.piso} → ${bajada.piso}) o lo ocupado (${f0.ocupado} → ${bajada.ocupado})`);
    await page.locator('.pedido-card').evaluate((e) => { e.scrollTop = 0; });
    await page.evaluate(() => { window.scrollTo(0, 0); window.dispatchEvent(new Event('resize')); });
    await reposo(page);
    const otra = await foto(page);
    if (otra.documento !== f0.documento || otra.piso !== f0.piso || otra.ocupado !== f0.ocupado) falla(`al volver a medir cambia la página (${f0.documento} → ${otra.documento}), el piso (${f0.piso} → ${otra.piso}) o lo ocupado (${f0.ocupado} → ${otra.ocupado})`);
    // 5) La carta, si está, no deja hueco bajo el último producto con su lista llevada al final.
    if (fin.carta) {
      await page.locator('.menu-scroll').evaluate((e) => { e.scrollTop = e.scrollHeight; });
      await reposo(page, 100);
      const c = await foto(page);
      if (c.carta.bottom - c.ultimoProducto.bottom > 4) falla(`la carta deja ${(c.carta.bottom - c.ultimoProducto.bottom).toFixed(1)} px bajo su último producto`);
    }
    if (diag.errores.length) falla(`errores de la página: ${diag.errores.join(' | ')}`);
  } finally { await contexto.close(); }
  return fallas;
}
for (const caso of CASOS) {
  test(`${caso.nombre}, en los ocho tamaños (1024×768 a 1920×1080 y el zoom del 125 %): «Generar ticket y cobrar» entero dentro de la ventana sin desplazar, tres renglones del pedido a la vista o la página puede bajar hasta verlos, la página no crece al desplazar y la carta no deja hueco`, saltar, async () => {
    const fallas = [];
    for (const tam of OCHO) fallas.push(...await revisar(caso, tam));
    assert.deepEqual(fallas, []);
  });
}

test('la tarjeta del total queda pegada al borde de abajo mientras la página baja y vuelve a su sitio al pie de la columna al llegar al final', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800, vista: 'orden-personas' });
  try {
    const sticky = await page.locator('.col-pedido > .barra-accion').evaluate((e) => getComputedStyle(e).position);
    assert.equal(sticky, 'sticky');
    const arriba = await foto(page);
    assert.ok(arriba.documento > arriba.ventana, 'la cuenta dividida no cabe a 1280×800: la página baja');
    assert.ok(arriba.rejilla.bottom > arriba.ventana, 'el pie natural de la columna queda bajo el pliegue…');
    assert.ok(cerca(arriba.total.bottom, arriba.ventana - AIRE_TOTAL, 1), `…y el total se pega al borde de abajo (acaba en ${arriba.total.bottom.toFixed(1)} de ${arriba.ventana})`);
    // A media bajada, sigue pegado; al final recupera su sitio: el fondo de la rejilla.
    const falta = arriba.documento - arriba.ventana;
    for (const y of [Math.round(falta / 3), Math.round(falta * 2 / 3)]) {
      await page.evaluate((v) => window.scrollTo(0, v), y); await reposo(page, 200);
      const m = await foto(page);
      assert.ok(m.total.bottom <= m.ventana - AIRE_TOTAL + 0.5 && m.total.top > 0, `a ${y} px de scroll el total sigue a la vista (${m.total.top.toFixed(0)}–${m.total.bottom.toFixed(0)})`);
      assert.equal(m.documento, arriba.documento, 'sin que la página cambie de alto');
    }
    const fin = await alFinal(page);
    assert.ok(cerca(fin.total.bottom, fin.rejilla.bottom, 1), `al final de la página el total está en su sitio, al pie de la columna (${fin.total.bottom.toFixed(1)} y la rejilla acaba en ${fin.rejilla.bottom.toFixed(1)})`);
    assert.ok(fin.pie.top >= fin.rejilla.bottom, 'sin pisar el pie');
  } finally { await contexto.close(); }
});

test('el piso es lo que mide la cuenta, no un número: un renglón más alto (una nota larga) sube el piso en lo que sube la suma de los tres más altos', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800, vista: 'orden-larga' });
  try {
    const antes = await foto(page);
    const pisoAntes = parseFloat(antes.piso);
    assert.ok(pisoAntes > 300 && antes.piso.endsWith('px'), `el store pasa un piso en px (${antes.piso})`);
    const nota = 'Sin cebolla, sin picante, sin sal, con el limón aparte, bien cocido y la salsa en un recipiente, por favor, y sin los cubiertos de plástico';
    await page.evaluate((n) => { Alpine.store('pos').ordenActiva.items[0].nota = n; }, nota);
    await reposo(page);
    const despues = await foto(page);
    const subio = despues.altos[0] - antes.altos[0];
    assert.ok(subio > 20, `el renglón creció ${subio.toFixed(1)} px`);
    assert.ok(cerca(parseFloat(despues.piso) - pisoAntes, subio, 1.5), `el piso subió ${(parseFloat(despues.piso) - pisoAntes).toFixed(1)} px y el renglón más alto, ${subio.toFixed(1)}`);
    const mejor = await mejorVista(page);
    assert.ok(mejor.enteras >= 3, `bajando la página se ven ${mejor.enteras} renglones enteros`);
    // El renglón alto no tiene que ser de los tres primeros: son los tres MÁS ALTOS de la lista (cualquier tramo de tres cabe), y la lista puede llevarse hasta él.
    await page.evaluate((n) => { const o = Alpine.store('pos').ordenActiva; o.items[0].nota = ''; o.items[6].nota = n; }, nota);
    await reposo(page);
    const lejos = await foto(page);
    const subioLejos = lejos.altos[6] - antes.altos[6];
    assert.ok(subioLejos > 20, `el séptimo renglón creció ${subioLejos.toFixed(1)} px`);
    assert.ok(cerca(parseFloat(lejos.piso) - pisoAntes, subioLejos, 1.5), `el piso sube ${(parseFloat(lejos.piso) - pisoAntes).toFixed(1)} px por un renglón alto que no es de los tres primeros (el renglón creció ${subioLejos.toFixed(1)})`);
    // Con menos de tres renglones, el piso es de los que hay: una cuenta de un renglón no obliga a nada.
    await page.evaluate(() => { const o = Alpine.store('pos').ordenActiva; o.items = o.items.slice(0, 1); });
    await page.evaluate(() => window.scrollTo(0, 0));
    await reposo(page);
    const uno = await foto(page);
    assert.equal(uno.filas, 1);
    assert.ok(parseFloat(uno.piso) < pisoAntes - 100, `con un solo renglón el piso baja (${uno.piso} contra ${antes.piso})`);
    assert.equal(uno.enteras, 1);
  } finally { await contexto.close(); }
});

test('una carta corta (una búsqueda con uno o tres resultados) se encoge a su contenido: sin hueco bajo el último producto; al borrar la búsqueda vuelve a llenar la rejilla', saltar, async () => {
  for (const [ancho, alto] of [[1422, 1010], [1280, 800], [1920, 1080]]) {
    const { page, contexto } = await abrir({ ancho, alto });
    try {
      const antes = await foto(page);
      for (const [texto, esperados] of [['Brownie', 1], ['Ejecutivo', 3]]) {
        await page.getByPlaceholder('Buscar producto…').fill(texto);
        await reposo(page);
        const m = await foto(page);
        assert.equal(await page.locator('.menu-scroll .menu-item').count(), esperados);
        assert.ok(m.lista.scroll <= m.lista.cliente + 1, `${ancho}×${alto} «${texto}»: sin scroll en una lista que cabe`);
        assert.ok(m.carta.alto < antes.carta.alto - 100, `${ancho}×${alto} «${texto}»: la tarjeta de la carta se encoge (${m.carta.alto.toFixed(0)} de ${antes.carta.alto.toFixed(0)})`);
        assert.ok(m.carta.bottom - m.ultimoProducto.bottom <= 2, `${ancho}×${alto} «${texto}»: bajo el último producto quedan ${(m.carta.bottom - m.ultimoProducto.bottom).toFixed(1)} px de tarjeta`);
        assert.ok(cerca(m.carta.top, m.rejilla.top, 0.5), 'y arranca donde la rejilla');
        assert.equal(m.documento, antes.documento, 'sin cambiar la página');
        assert.ok(cerca(m.rejilla.alto, antes.rejilla.alto, 0.5) && cerca(m.columna.alto, antes.columna.alto, 0.5), 'ni la rejilla ni la columna del pedido');
        const fondos = await page.evaluate(() => [getComputedStyle(document.querySelector('.menu-scroll').parentElement).backgroundColor, getComputedStyle(document.querySelector('.menu-scroll')).backgroundColor]);
        assert.equal(fondos[1], 'rgba(0, 0, 0, 0)', 'la lista no pinta otro fondo: se ve el de la tarjeta');
        assert.notEqual(fondos[0], 'rgba(0, 0, 0, 0)');
      }
      await page.getByPlaceholder('Buscar producto…').fill('');
      await reposo(page);
      const otra = await foto(page);
      assert.ok(cerca(otra.carta.alto, otra.rejilla.alto), `${ancho}×${alto}: sin búsqueda la carta llena otra vez la rejilla`);
    } finally { await contexto.close(); }
  }
});

test('el aviso de versión que sale y se va con la cuenta abierta (empuja la página): la rejilla se acorta lo que él mide y la página sigue midiendo lo que la ventana (cuando el piso cabe)', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1920, alto: 1080 });
  try {
    const sin = await foto(page);
    assert.equal(sin.aviso, null);
    // Sale: se le cambia al store la versión publicada (lo que haría version.json al responder otra).
    await page.evaluate((v) => { Alpine.store('pos').versionPublicada = v; }, VERSION_NUEVA);
    await page.locator('.aviso-version').waitFor();
    await reposo(page);
    const con = await foto(page);
    assert.ok(con.aviso.alto > 20, `el aviso mide ${con.aviso.alto.toFixed(0)} px`);
    assert.ok(cerca(sin.rejilla.alto - con.rejilla.alto, con.aviso.alto, 1.5), `la rejilla se acortó ${(sin.rejilla.alto - con.rejilla.alto).toFixed(1)} px y el aviso mide ${con.aviso.alto.toFixed(1)}`);
    assert.equal(con.documento, con.ventana, 'con el aviso, la página sigue midiendo lo que la ventana');
    assert.ok(cerca(con.pie.bottom, con.ventana) && con.total.bottom <= con.ventana, 'el pie y el total siguen a la vista');
    // «Después» lo esconde y la rejilla recupera su alto.
    await page.locator('.aviso-version').getByRole('button', { name: 'Después', exact: true }).click();
    await page.locator('.aviso-version').waitFor({ state: 'hidden' });
    await reposo(page);
    const otra = await foto(page);
    assert.ok(cerca(otra.rejilla.alto, sin.rejilla.alto, 1), `la rejilla volvió a ${otra.rejilla.alto.toFixed(1)} (era ${sin.rejilla.alto.toFixed(1)})`);
    assert.equal(otra.documento, otra.ventana);
  } finally { await contexto.close(); }
});

test('el aviso de versión que llega con la cuenta ya abierta en una ventana que no da: la rejilla no baja de su piso, la página baja y el total sigue pegado al borde', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800 });
  try {
    const sin = await foto(page);
    await page.evaluate((v) => { Alpine.store('pos').versionPublicada = v; }, VERSION_NUEVA);
    await page.locator('.aviso-version').waitFor();
    await reposo(page);
    const con = await foto(page);
    assert.ok(cerca(con.rejilla.alto, sin.rejilla.alto, 1), `en el piso la rejilla no cambia (${sin.rejilla.alto.toFixed(1)} → ${con.rejilla.alto.toFixed(1)})`);
    assert.ok(con.documento > sin.documento, 'y la página crece lo que mide el aviso (una vez: es lo que él empuja)');
    assert.ok(con.boton.bottom <= con.ventana && con.boton.encima, '«Generar ticket y cobrar» sigue a la vista');
    const fin = await alFinal(page);
    assert.equal(fin.documento, con.documento, 'bajar no hace crecer la página');
    assert.ok((await mejorVista(page)).enteras >= 3, 'y bajando la página se ven tres renglones enteros');
  } finally { await contexto.close(); }
});

test('activar y desactivar «Cobrar por partes» con la cuenta abierta: la barra de arriba empuja, la rejilla se acorta y vuelve, y la página sigue midiendo lo que la ventana (cuando cabe)', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1920, alto: 1080 });
  try {
    const sin = await foto(page);
    await page.getByRole('button', { name: 'Cobrar por partes', exact: true }).click();
    await page.locator('.barra-partes').waitFor();
    await reposo(page);
    const con = await foto(page);
    const barra = await page.locator('.barra-partes').boundingBox();
    assert.equal(con.carta, null, 'la carta no sale');
    assert.ok(sin.rejilla.top - con.rejilla.top < 0.5 || con.rejilla.top > sin.rejilla.top, 'la barra de arriba empujó la rejilla hacia abajo');
    assert.ok(con.rejilla.top - sin.rejilla.top >= barra.height - 1, `la rejilla bajó ${(con.rejilla.top - sin.rejilla.top).toFixed(1)} px y la barra mide ${barra.height.toFixed(1)}`);
    assert.ok(con.rejilla.alto >= disponible(con) - 1.5, 'y nunca mide menos de lo que le queda a la ventana');
    await page.getByRole('button', { name: 'Cancelar selección', exact: true }).click();
    await page.locator('.barra-partes').waitFor({ state: 'hidden' });
    await reposo(page);
    const otra = await foto(page);
    assert.ok(cerca(otra.rejilla.alto, sin.rejilla.alto, 1), `la rejilla volvió a ${otra.rejilla.alto.toFixed(1)} (era ${sin.rejilla.alto.toFixed(1)})`);
    assert.ok(otra.carta && cerca(otra.carta.alto, otra.rejilla.alto, 1), 'la carta volvió a su sitio, entera');
    assert.equal(otra.documento, otra.ventana);
  } finally { await contexto.close(); }
});

test('cambiar el tamaño de la ventana: bajo 1024 la cuenta vuelve a ser una columna que scrollea la página (sin piso medido) y al volver a escritorio recupera su medida', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800 });
  try {
    const grande = await foto(page);
    assert.match(grande.piso, /^\d+px$/, 'a 1280 se mide el piso');
    await page.setViewportSize({ width: 900, height: 800 });
    await reposo(page);
    const medio = await page.evaluate(() => { const g = document.querySelector('.vista-orden > .grid'); return { doc: document.documentElement.scrollHeight, altura: getComputedStyle(g).height, contenido: g.scrollHeight, medida: g.style.getPropertyValue('--orden-ocupado'), piso: g.style.getPropertyValue('--orden-piso') }; });
    assert.ok(medio.doc > 800 && Math.abs(parseFloat(medio.altura) - medio.contenido) <= 1, 'a 900 px es una columna que mide lo que su contenido y la página scrollea');
    assert.deepEqual([medio.medida, medio.piso], ['', ''], 'y ya no se mide nada');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await reposo(page);
    const otra = await foto(page);
    assert.equal(otra.documento, otra.ventana, 'de vuelta a escritorio, y en una ventana que da, la página mide lo que la ventana');
    assert.ok(cerca(otra.carta.alto, otra.columna.alto) && otra.rejilla.alto > grande.rejilla.alto, 'y los paneles se repartieron la ventana nueva');
    assert.match(otra.piso, /^\d+px$/, 'y vuelve a medirse el piso');
  } finally { await contexto.close(); }
});

test('agregar productos hace crecer la lista del pedido por dentro: ni la página ni el piso ni el total se mueven', saltar, async () => {
  for (const [ancho, alto] of [[1440, 900], [1920, 1080]]) {
    const { page, contexto } = await abrir({ ancho, alto });
    try {
      const antes = await foto(page);
      for (let i = 0; i < 6; i++) { await page.locator('.menu-scroll .menu-item').nth(i).click(); }
      await reposo(page);
      const ahora = await foto(page);
      assert.ok(ahora.pedido.scroll > antes.pedido.scroll, 'la lista del pedido creció');
      assert.equal(ahora.documento, antes.documento, `${ancho}×${alto}: la página no cambió de alto`);
      assert.equal(ahora.piso, antes.piso, 'ni el piso (ya había más de tres renglones)');
      assert.ok(cerca(ahora.total.top, antes.total.top, 0.5) && cerca(ahora.rejilla.alto, antes.rejilla.alto, 0.5), 'y el total y la rejilla siguen donde estaban');
    } finally { await contexto.close(); }
  }
});

test('«Cobrar por partes» desde 1024: la carta no sale y el abono se ve ENTERO (con «Recibir…»), sin scroll propio; si el alto no da, es la página la que baja', saltar, async () => {
  for (const [ancho, alto] of [[1024, 768], [1280, 800], [1920, 1080], [1366, 657]]) {
    const { page, contexto } = await abrir({ ancho, alto, vista: 'orden-cobro-monto' });
    try {
      const m = await foto(page);
      assert.equal(m.carta, null, `${ancho}×${alto}: sin carta (antes quedaba una tarjeta de 8 px de alto bajo el abono)`);
      const fin = await alFinal(page);
      const b = await page.locator('.bloque-monto').evaluate((e) => {
        const r = e.getBoundingClientRect(); const btn = [...e.querySelectorAll('button')].find((x) => /Recibir/.test(x.textContent)).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, scroll: e.scrollHeight, cliente: e.clientHeight, botonTop: btn.top, botonBottom: btn.bottom, ventana: innerHeight };
      });
      assert.ok(b.scroll <= b.cliente + 1, `${ancho}×${alto}: el abono no esconde nada en un scroll propio (${b.scroll} de ${b.cliente})`);
      assert.ok(b.botonTop >= b.top && b.botonBottom <= b.bottom, `${ancho}×${alto}: «Recibir…» está dentro del abono (${b.botonTop.toFixed(0)}–${b.botonBottom.toFixed(0)} de ${b.top.toFixed(0)}–${b.bottom.toFixed(0)})`);
      assert.ok(fin.abono.bottom <= fin.rejilla.bottom + 0.5, `${ancho}×${alto}: el abono acaba en ${fin.abono.bottom.toFixed(0)} y la rejilla en ${fin.rejilla.bottom.toFixed(0)}`);
      assert.ok(fin.columna.bottom <= fin.pie.top + 0.5 && fin.total.bottom <= fin.rejilla.bottom + 0.5, `${ancho}×${alto}: ni el pedido ni el total pisan el pie`);
      assert.ok(cerca(fin.pie.bottom, fin.ventana), `${ancho}×${alto}: con la página al final, el pie es lo último y queda al borde de la ventana`);
      assert.ok(b.botonBottom <= b.ventana, `${ancho}×${alto}: con la página al final «Recibir…» está dentro de la ventana`);
      const mejor = await mejorVista(page);
      const quedan = Math.min(3, mejor.filas, mejor.caben);
      assert.ok(mejor.enteras >= quedan, `${ancho}×${alto}: bajando la página se ven ${mejor.enteras} de ${quedan} renglones del pedido (${mejor.altos.map((h) => h.toFixed(0)).join('/')} px, caben ${mejor.caben} entre el nav y el total)`);
      assert.ok(await page.getByRole('button', { name: /^Recibir/ }).count() > 0);
    } finally { await contexto.close(); }
  }
});

test('«Cobrar por partes» a 1366×657: activar el modo no hace crecer la página al bajar ni al volver a bajar, y el pedido (con sus casillas) enseña tres renglones enteros', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1366, alto: 657, vista: 'orden-larga' });
  try {
    const sin = await foto(page);
    assert.equal(await page.locator('.barra-partes').isVisible(), false, 'el modo todavía no está activo');
    await page.getByRole('button', { name: 'Cobrar por partes', exact: true }).click();
    await page.locator('.barra-partes').waitFor();
    await page.locator('.bloque-monto').waitFor();
    await reposo(page);
    const activo = await foto(page);                                   // con el modo activo y la página AÚN arriba
    assert.equal(activo.scrollY, 0);
    assert.equal(activo.carta, null, 'con el modo activo la carta no sale');
    assert.ok(activo.abono && activo.abono.alto > 300, 'y el abono sí');
    assert.ok(activo.documento !== sin.documento, 'el modo cambió la página (la barra de arriba y el abono empujan)');
    const f = await alFinal(page);
    assert.equal(f.documento, activo.documento, `bajar no hace crecer la página (${activo.documento} → ${f.documento})`);
    const mejor = await mejorVista(page);
    assert.ok(mejor.enteras >= 3, `bajando la página se ven ${mejor.enteras} renglón(es) entero(s) de ${mejor.filas} en una tarjeta de ${mejor.pedido.alto.toFixed(0)} px`);
    const otra = await alFinal(page);
    assert.equal(otra.documento, activo.documento, 'pedir el final otra vez no cambia la página');
    assert.equal(otra.scrollY, f.scrollY);
    // Al desactivarlo, todo vuelve a como estaba.
    await page.getByRole('button', { name: 'Cancelar selección', exact: true }).click();
    await page.locator('.barra-partes').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await reposo(page);
    const vuelta = await foto(page);
    assert.equal(vuelta.documento, sin.documento);
  } finally { await contexto.close(); }
});

test('1280×800: tocar «Asignar a persona» en el primer renglón hace aparecer la tarjeta de personas encima: el piso sube con ella, la lista del pedido no se queda en 0 y el botón sigue a la vista', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800, vista: 'orden-larga' });
  try {
    const antes = await foto(page);
    await page.getByRole('button', { name: /^Asignar .* a una persona$/ }).first().click();
    await page.locator('.split-personas').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await reposo(page);
    const ahora = await foto(page);
    assert.ok(ahora.rejilla.top > antes.rejilla.top + 100, 'la tarjeta de personas empujó la rejilla hacia abajo');
    assert.ok(ahora.documento > antes.documento, 'y la página creció lo que mide esa tarjeta (una vez)');
    assert.ok(ahora.boton.top >= 0 && ahora.boton.bottom <= ahora.ventana && ahora.boton.encima, `«Generar ticket y cobrar» sigue entero a la vista sin desplazar (${ahora.boton.top.toFixed(0)}–${ahora.boton.bottom.toFixed(0)})`);
    const f = await mejorVista(page);
    assert.ok(f.enteras >= 3, `bajando la página la lista enseña ${f.enteras} renglones enteros (de ${f.filas})`);
  } finally { await contexto.close(); }
});

test('en el piso (la página scrollea), la rueda sobre el pedido pasa a la página al llegar al final de su lista: es la forma de llegar al resto', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1280, alto: 800, vista: 'orden-personas' });
  try {
    const antes = await foto(page);
    assert.ok(antes.documento > antes.ventana && antes.scrollY === 0, 'la página scrollea y está arriba');
    const p = await page.locator('.pedido-card').boundingBox();
    // La tarjeta empieza en la parte baja de la ventana: se lleva el puntero a un punto de ella que se vea (y que no tape el total).
    await page.mouse.move(p.x + p.width / 2, p.y + 40);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 600); await reposo(page, 700); }
    const ahora = await foto(page);
    assert.ok(await page.locator('.pedido-card').evaluate((e) => Math.ceil(e.scrollTop + e.clientHeight) >= e.scrollHeight - 1), 'la lista del pedido llegó a su final');
    assert.ok(ahora.scrollY > 0, 'y la rueda siguió con la página (antes, overscroll-behavior: contain la dejaba quieta)');
    assert.equal(ahora.documento, antes.documento, 'sin que la página crezca');
  } finally { await contexto.close(); }
});

test('con otra tablet en la mesa y el aviso de versión a 1024×768 (no cabe): la rejilla vale su piso, la página baja una vez, no crece al bajar y el total sigue pegado al borde', saltar, async () => {
  const { page, contexto } = await abrir({ ancho: 1024, alto: 768, aviso: true, ajustar: presencia });
  try {
    await page.getByText('también tiene esta mesa abierta').waitFor();
    await reposo(page);
    const antes = await foto(page);
    assert.ok(antes.documento > antes.ventana, 'no cabe: la página scrollea');
    assert.ok(antes.rejilla.bottom <= antes.pie.top + 0.5, 'la rejilla acaba antes del pie');
    assert.ok(antes.columna.bottom <= antes.rejilla.bottom + 0.5, 'y la columna no se sale de la rejilla');
    assert.ok(antes.boton.top >= 0 && antes.boton.bottom <= antes.ventana && antes.boton.encima, 'el botón de cobro se ve sin desplazar');
    const f = await alFinal(page);
    assert.equal(f.documento, antes.documento, 'bajar no hace crecer la página');
    assert.ok(cerca(f.rejilla.alto, antes.rejilla.alto, 0.5), 'ni la rejilla');
    assert.ok(f.scrollY > 0 && cerca(f.pie.bottom, f.ventana), 'y al final de la página el pie queda al borde');
    assert.ok(f.boton.bottom <= f.ventana, 'y el botón de cobro');
    assert.ok((await mejorVista(page)).enteras >= 3, 'bajando la página se ven tres renglones enteros');
  } finally { await contexto.close(); }
});

for (const [ancho, alto] of [[390, 844], [768, 1024]]) {
  test(`${ancho}×${alto}: sin cambios: la cuenta sigue en una columna, sin scroll por panel y la rejilla toma el alto de su contenido`, saltar, async () => {
    const contexto = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
    try {
      const page = await contexto.newPage();
      const def = VISTAS['orden-larga'];
      await prepararPagina(page, { url: servidor.url, datos: datosFicticios((d) => def.ajustar(d)), sesion: true, dirCache: DIR_CACHE, bloquearFuentes: true });
      await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
      await esperarListo(page);
      await def.llegar(page);
      await esperarEstable(page);
      const e = await page.evaluate(() => {
        const est = (s) => getComputedStyle(document.querySelector(s));
        const rej = document.querySelector('.vista-orden > .grid');
        return {
          alturaRejilla: est('.vista-orden > .grid').height, alturaContenido: rej.scrollHeight, ventana: innerHeight,
          overflowLista: est('.menu-scroll').overflowY, maxLista: est('.menu-scroll').maxHeight, overflowPedido: est('.pedido-card').overflowY,
          posicionColumna: est('.col-pedido').position, posicionTotal: est('.col-pedido > .barra-accion').position, alineacionCarta: est('.carta-panel').alignSelf, maxCarta: est('.carta-panel').maxHeight,
          medida: rej.style.getPropertyValue('--orden-ocupado'), piso: rej.style.getPropertyValue('--orden-piso'), paddingSeccion: est('.vista-orden').paddingBottom,
        };
      });
      assert.ok(Math.abs(parseFloat(e.alturaRejilla) - e.alturaContenido) <= 1, 'la rejilla mide lo que su contenido (sin height fijo)');
      assert.ok(e.alturaContenido > e.ventana, 'y es más alta que la ventana: la página es la que scrollea');
      assert.deepEqual([e.overflowLista, e.maxLista, e.overflowPedido, e.posicionColumna], ['visible', 'none', 'visible', 'static'], 'ni scroll por panel ni columna pegajosa');
      assert.equal(e.posicionTotal, 'fixed', 'la barra de cobro sigue fija abajo (no la pegajosa de escritorio)');
      assert.deepEqual([e.alineacionCarta, e.maxCarta], ['auto', 'none'], 'la carta no se encoge: es una columna');
      assert.deepEqual([e.medida, e.piso], ['', ''], 'y no se mide nada');
      assert.equal(e.paddingSeccion, ancho < 768 ? '24px' : '32px', 'el aire de abajo de la vista es el de siempre');
    } finally { await contexto.close(); }
  });
}
