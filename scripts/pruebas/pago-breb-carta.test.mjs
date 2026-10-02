// «Pagar con Bre-B» en carta.html (tarea pago-breb, parte CARTA): al tocar «Pagar» y elegir «QR (Bre-B)», la hoja (o el panel) se convierte en el QR
// del restaurante dibujado en el navegador, con su llave («Copiar llave») y el botón «Enviar comprobante por WhatsApp»; «Transferencia» muestra la
// llave con los mismos dos botones; «Efectivo» y todo lo que no trae datos siguen como hoy. Los datos NO están en el código: llegan en la `cuenta`
// (`pago.breb`) solo si el admin los configuró y la mesa tiene cuenta abierta.
//
// Aquí (siempre corre, también en CI; el navegador está en pago-breb-carta-navegador.test.mjs):
//   1. ESTÁTICA: ningún dato de pago puesto a mano (ni la red de pagos, ni un contenido EMV, ni bancos), todo dentro de las plantillas de
//      pagarEnMesa, el generador del QR NO está en el marcado (se baja al tocar «Pagar»), sin CDN, sin x-html, sin alert()/confirm().
//   2. LA REGLA de lo que la carta acepta de la base (llave y contenido del QR con su CRC): la misma que la de las pruebas, escrita aparte.
//   3. EL FLUJO en el <script> real corrido en un vm (scripts/pruebas/_carta-vm.mjs) con el QR FICTICIO de _breb-ficticio.mjs: sin pago → el flujo
//      de hoy; con pago → QR y llave; el aviso al mesero sigue yendo y su fallo no esconde el QR; el QR dibujado SE LEE y dice lo mismo que el
//      contenido; la llave se copia; el enlace de WhatsApp lleva mesa y total y nada personal; si lo apagan en pleno vuelo se vuelve a la cuenta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crearCarta, RAIZ, TOKEN_CEROS } from './_carta-vm.mjs';
import { decodificarQr, matrizDeSvgConMargen } from './_qr-decodificar.mjs';
import { LLAVE_FICTICIA, QR_FICTICIO, QR_FICTICIO_CORTO, VECTORES_LLAVE, VECTORES_QR, conUnCaracterCambiado, crc16, crcHex, reglaDelContenido } from './_breb-ficticio.mjs';

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const plano = (x) => JSON.parse(JSON.stringify(x));
const sinComentarios = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const sinLineas = (js) => js.replace(/(^|\s)\/\/[^\n]*/g, '$1');   // los comentarios `// …` de un script (no toca «https://»)
const sinScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const BREB = Object.freeze({ llave: LLAVE_FICTICIA, qr: QR_FICTICIO });
const LIBRERIA_QR = 'assets/vendor/qrcode-generator-1.4.4.js';

// ───────────────────────── 0. el material ficticio es de verdad como el real ─────────────────────────

test('el QR ficticio: CRC-16/CCITT-FALSE bueno (vector estándar «123456789» → 29B1), ≈ 490 caracteres (versión 17 con corrección M) y cumple la regla', () => {
  assert.equal(crcHex('123456789'), '29B1');
  assert.equal(crc16('') , 0xffff);
  assert.ok(QR_FICTICIO.length >= 450 && QR_FICTICIO.length <= 520, `mide ${QR_FICTICIO.length}: tiene que parecerse al de uno de verdad (≈ 490)`);
  assert.ok(QR_FICTICIO_CORTO.length < 120);
  assert.equal(reglaDelContenido(QR_FICTICIO), null);
  assert.equal(reglaDelContenido(QR_FICTICIO_CORTO), null);
  assert.ok(QR_FICTICIO.startsWith('000201'));
  assert.ok(QR_FICTICIO.includes(LLAVE_FICTICIA), 'la llave ficticia va dentro del campo 26, como la de verdad');
  assert.match(QR_FICTICIO, /6304[0-9A-F]{4}$/);
});

// ───────────────────────── 1. estática ─────────────────────────

test('la página no lleva NINGÚN dato de pago puesto a mano: ni contenido EMV, ni la red de pagos, ni bancos, ni números de cuenta, ni una imagen de QR', () => {
  const crudo = leer('carta.html');
  const html = sinScripts(sinComentarios(crudo));
  const script = sinLineas(sinComentarios(crudo.slice(crudo.indexOf('<script>\n'))));
  for (const [nombre, texto] of [['el marcado', html], ['el script', script]]) {
    assert.doesNotMatch(texto, /bancolombia|davivienda|nequi|daviplata|nu bank|n[uú]mero de cuenta|cuenta de ahorros|cuenta corriente|\biban\b|\bclabe\b|\bnit\b/i, nombre);
    assert.doesNotMatch(texto, /CO\.COM\.RBM/, `${nombre}: el identificador de la red de pagos solo viaja DENTRO del contenido del QR, que llega de la base`);
    assert.doesNotMatch(texto, /0002010102(11|12)\d\d/, `${nombre}: un contenido EMV puesto a mano`);
    assert.doesNotMatch(texto, /@[a-z0-9._-]{4,}['"`]/i, `${nombre}: una llave alfanumérica puesta a mano`);
  }
  const aside = html.slice(html.indexOf('<aside class="cuenta-ventana'), html.indexOf('</aside>'));
  assert.ok(aside.length > 1500, 'no encontré el <aside> de «Mi cuenta»');
  assert.doesNotMatch(aside, /\d{8,}/, 'un número largo (¿cuenta, teléfono?) dentro de «Mi cuenta»');
  assert.doesNotMatch(html, /<img\b[^>]*qr/i, 'un <img> de QR en la página');
  assert.doesNotMatch(html, /data:image\//, 'una imagen incrustada (¿un QR?) en la página');
  // El WhatsApp sale de local.js (la única fuente), no de un número escrito en la hoja de pago.
  assert.doesNotMatch(aside, /wa\.me/, 'el enlace de WhatsApp de la hoja se arma con RESPLANDOR.whatsapp, no a mano');
  assert.match(script, /window\.RESPLANDOR && window\.RESPLANDOR\.whatsapp/);
});

test('ningún archivo de producto lleva un contenido EMV de pago (la regla de la casa: el dato real vive solo en el sobre privado de Yonatan)', () => {
  const carpetas = ['assets/js', 'assets/css', 'docs', 'supabase', 'mcp'];
  const sueltos = ['carta.html', 'pos.html', 'menu.html', 'index.html', 'landing.html', 'README.md', 'llms.txt', 'local.json'];
  const archivos = sueltos.filter((f) => fs.existsSync(path.join(RAIZ, f)));
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(rel);
      else if (/\.(html|css|js|mjs|md|sql|ts|json|txt)$/.test(e.name) && !rel.startsWith(path.join('assets', 'vendor'))) archivos.push(rel);
    }
  };
  for (const d of carpetas) if (fs.existsSync(path.join(RAIZ, d))) recorrer(d);
  assert.ok(archivos.length > 20);
  for (const rel of archivos) {
    const texto = leer(rel);
    assert.doesNotMatch(texto, /0002010102(11|12)\d\d/, `${rel}: parece un contenido EMV de un QR de pago`);
    assert.doesNotMatch(texto, /CO\.COM\.RBM\.LLA\d/, `${rel}: parece la llave dentro de un QR de pago`);
  }
});

/** Quita cada <template x-if="…"> cuya condición cumpla `coincide`, con sus <template> anidados (igual que pagar.test.mjs). */
function quitarPlantillas(html, coincide) {
  let salida = '';
  let i = 0;
  const reAbre = /<template\b[^>]*>/g;
  for (;;) {
    reAbre.lastIndex = i;
    const m = reAbre.exec(html);
    if (!m) return salida + html.slice(i);
    const cond = m[0].match(/\bx-if="([^"]*)"/);
    if (!cond || !coincide(cond[1])) { salida += html.slice(i, m.index + m[0].length); i = m.index + m[0].length; continue; }
    let profundidad = 1;
    const re = /<template\b[^>]*>|<\/template>/g;
    re.lastIndex = m.index + m[0].length;
    let t;
    while ((t = re.exec(html))) { profundidad += t[0].startsWith('</') ? -1 : 1; if (profundidad === 0) break; }
    assert.equal(profundidad, 0, `un <template x-if="${cond[1]}"> no cierra`);
    salida += html.slice(i, m.index);
    i = re.lastIndex;
  }
}

test('todo lo de Bre-B va dentro de las plantillas de pagarEnMesa: apagada la función, ni el QR, ni la llave, ni el WhatsApp existen en el DOM', () => {
  const html = sinScripts(sinComentarios(leer('carta.html')));
  const visible = quitarPlantillas(html, (cond) => /\bpagarEnMesa\b/.test(cond));
  for (const rastro of [/pago-breb/, /breb-qr/, /breb-llave/, /breb-copiar/, /Copiar llave/, /Enviar comprobante/, /WhatsApp por/, /qrDibujo/, /brebLlave/, /comprobanteUrl/, /Ver el QR de pago/, /Paga con el QR/, /Transfiere con Bre-B/, /#i-copy/, /#i-message-circle/]) {
    assert.doesNotMatch(visible.replace(/Reservar por WhatsApp/g, ''), rastro, `con pagarEnMesa apagada, carta.html todavía deja ${rastro} fuera de sus plantillas`);
  }
});

test('el generador del QR NO está en el marcado: se baja (assets/vendor/, mismo origen, sin CDN) solo al tocar «Pagar» con un QR que dibujar', () => {
  const crudo = leer('carta.html');
  const marcado = sinScripts(sinComentarios(crudo));
  assert.doesNotMatch(marcado, /qrcode/i, 'ni un <script> ni nada del generador en el marcado: la carta sin mesa no lo necesita');
  assert.match(crudo, /const QR_JS = 'assets\/vendor\/qrcode-generator-1\.4\.4\.js';/);
  assert.ok(fs.existsSync(path.join(RAIZ, LIBRERIA_QR)), 'el archivo local existe');
  const script = sinLineas(sinComentarios(crudo.slice(crudo.indexOf('<script>\n'))));
  assert.doesNotMatch(script, /https?:\/\/[^'"\s]*qrcode/i, 'ningún CDN para el generador del QR');
  assert.doesNotMatch(script, /cdnjs|unpkg\.com|qrserver|chart\.googleapis|api\.qrcode/i, 'ningún servicio de terceros que dibuje el QR (el contenido del QR no sale del navegador)');
  // Sin atajos: nada de innerHTML con datos, ni x-html, ni diálogos nativos nuevos.
  assert.doesNotMatch(crudo, /x-html|innerHTML|insertAdjacentHTML/, 'el <svg> del QR es fijo y se enlaza por atributos');
  assert.doesNotMatch(sinComentarios(crudo), /\b(alert|confirm|prompt)\s*\(/, 'sin alert()/confirm() nativos');
});

test('el enlace de WhatsApp se abre en pestaña nueva sin dar el origen (noopener) y la página sigue sin mandar el Referer', () => {
  const html = sinComentarios(leer('carta.html'));
  const enlace = html.match(/<a class="btn btn-primary w-full" :href="comprobanteUrl"[^>]*>/);
  assert.ok(enlace, 'no encontré el botón «Enviar comprobante por WhatsApp»');
  assert.match(enlace[0], /target="_blank"/);
  assert.match(enlace[0], /rel="noopener"/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test('el sprite trae los íconos nuevos (copy y message-circle) y la hoja usa botones de ≥ 44 px (.btn, .btn-ghost, .breb-copiar)', () => {
  const html = leer('carta.html');
  const sprite = html.slice(html.indexOf('<!-- iconos:inicio -->'), html.indexOf('<!-- iconos:fin -->'));
  for (const id of ['copy', 'message-circle', 'check', 'qr-code', 'landmark']) assert.match(sprite, new RegExp(`<symbol id="i-${id}"`), `falta #i-${id} (node scripts/iconos.mjs)`);
  const css = leer('assets/css/carta-menu.css');
  assert.match(css, /\.breb-copiar\s*\{[^}]*min-height:\s*2\.75rem/, '«Copiar llave» mide ≥ 44 px (2,75 rem)');
  assert.doesNotMatch(css.slice(css.indexOf('Pagar con Bre-B')), /#[0-9a-fA-F]{3,8}\b/, 'ningún hex nuevo en el CSS de Bre-B (blanco y negro son colores con nombre)');
});

// ───────────────────────── 2. la regla de lo que la carta acepta ─────────────────────────

async function conCarta(opciones = {}) { return crearCarta({ pagoBreb: BREB, ...opciones }); }
/** Toca un método y deja pasar el tiempo virtual que tarda el POST a `alerta` (con el reloj virtual, esperarlo sin avanzar el reloj no termina nunca). */
async function avisar(h, metodo, ms = 300) { const p = h.c.avisarPago(metodo); await h.avanzar(ms); await p; }

test('qrBrebValido (la regla de la carta) coincide con la regla escrita aparte en las pruebas, en cada vector', async () => {
  const h = await conCarta();
  for (const [nombre, texto, esperado] of VECTORES_QR) {
    assert.equal(h.caja.qrBrebValido(texto), esperado, nombre);
    assert.equal(reglaDelContenido(texto) === null, esperado, `${nombre} (la regla de las pruebas)`);
  }
});

test('llaveBrebValida: de 2 a 60 caracteres, sin espacios ni < > " \' ` \\, y es «@alfanumérica», un número de 5 a 20 dígitos, un celular +57 o un correo (la regla de la base)', async () => {
  const h = await conCarta();
  for (const [llave, esperado] of VECTORES_LLAVE) assert.equal(h.caja.llaveBrebValida(llave), esperado, JSON.stringify(llave));
});

test('lo que llega en `pago.breb` se revisa: una llave mala deja solo el QR, un QR malo deja solo la llave, y sin nada que sirva no queda nada', async () => {
  const casos = [
    [{ llave: LLAVE_FICTICIA, qr: QR_FICTICIO }, { llave: LLAVE_FICTICIA, qr: QR_FICTICIO }],
    [{ llave: '@mala llave', qr: QR_FICTICIO }, { llave: '', qr: QR_FICTICIO }],
    [{ llave: LLAVE_FICTICIA, qr: conUnCaracterCambiado(QR_FICTICIO) }, { llave: LLAVE_FICTICIA, qr: '' }],
    [{ llave: LLAVE_FICTICIA, qr: null }, { llave: LLAVE_FICTICIA, qr: '' }],
    [{ llave: null, qr: QR_FICTICIO }, { llave: '', qr: QR_FICTICIO }],
    [{ llave: '@mala llave', qr: 'x' }, null],
    [{ llave: null, qr: null }, null],
    [{}, null], ['texto', null], [null, null], [[], null],
  ];
  for (const [breb, esperado] of casos) {
    const h = await conCarta({ pagoBreb: breb });
    await h.iniciar(); await h.abrir();
    assert.deepEqual(plano(h.c.pagoBreb), esperado, JSON.stringify(breb)?.slice(0, 60));
  }
  // Y un `pago` que no es un objeto, o sin `breb`, o con otros medios, no cuenta.
  for (const pago of ['x', 7, [], { efectivo: true }, { breb: 'x' }]) {
    const h = await crearCarta();
    h.mundo.responder = ((orig) => (url) => { const r = orig(url); if (r.body && r.body.abierta) r.body.pago = pago; return r; })(h.mundo.responder);
    await h.iniciar(); await h.abrir();
    assert.equal(h.c.pagoBreb, null, JSON.stringify(pago));
  }
});

// ───────────────────────── 3. el flujo ─────────────────────────

const titulos = (c) => plano(c.metodosPago.map((o) => o.titulo));
const metodos = (c) => plano(c.metodosPago.map((o) => o.id));

test('SIN `pago` en la cuenta (no configurado, apagado, sin cuenta abierta o la `cuenta` de antes) el flujo es el de hoy: tres métodos, ni QR ni llave, y no se baja el generador', async () => {
  const casos = [
    ['sin pago', {}],
    ['la cuenta de antes (sin canal ni estado)', { conCanal: false }],
  ];
  for (const [nombre, opciones] of casos) {
    const h = await crearCarta(opciones);
    await h.iniciar(); await h.abrir();
    assert.equal(h.c.cuenta.estado, 'ok', nombre);
    assert.equal(h.c.pagoBreb, null, nombre);
    assert.equal(h.c.breb, null);
    assert.deepEqual(titulos(h.c), ['QR', 'Transferencia', 'Efectivo'], nombre);
    assert.equal(h.c.tieneDatos('qr'), false);
    assert.equal(h.c.tieneDatos('transferencia'), false);
    h.c.pedirPago();
    await h.avanzar(500);
    assert.equal(h.qrcode.scripts.length, 0, `${nombre}: sin QR que dibujar no se baja el generador`);
    await avisar(h, 'qr');
    assert.equal(h.c.pago.vista, 'listo', `${nombre}: elegir QR avisa y queda «avisado», como hoy`);
    assert.equal(h.c.pagandoBreb, false);
    assert.deepEqual(plano(h.llamadas.alerta.map((a) => a.cuerpo)), [{ m: 3, k: TOKEN_CEROS, metodo: 'qr' }]);
    assert.equal(h.c.qrDibujo.ruta, '');
    assert.equal(h.c.brebLlave, '');
  }
  // Sin cuenta abierta no hay datos aunque la base los tenga (la función no los manda; y la carta no los guardaría).
  const h = await conCarta({ sinOrden: true });
  await h.iniciar(); await h.abrir();
  assert.equal(h.c.cuenta.estado, 'vacia');
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.breb, null);
});

test('CON `pago.breb`: «QR (Bre-B)» y «Transferencia» lo dicen, «Efectivo» no cambia, y el generador del QR se baja al tocar «Pagar» (no antes, y una sola vez)', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  assert.deepEqual(plano(h.c.pagoBreb), plano(BREB));
  assert.equal(h.qrcode.scripts.length, 0, 'abrir la cuenta no baja el generador: solo «Pagar»');
  assert.deepEqual(titulos(h.c), ['QR (Bre-B)', 'Transferencia', 'Efectivo']);
  assert.deepEqual(metodos(h.c), ['qr', 'transferencia', 'efectivo'], 'los métodos de `alerta` no cambian');
  assert.match(h.c.metodosPago[0].detalle, /Escanéalo con la app de tu banco/);
  assert.match(h.c.metodosPago[1].detalle, /llave/i);
  assert.equal(h.c.metodosPago[2].detalle, 'Pasan por tu mesa a recibirlo');
  for (const o of h.c.metodosPago) assert.doesNotMatch(`${o.titulo} ${o.con} ${o.detalle}`, /\d|propina|\$|@/, 'ni cifras ni la llave en el texto de las opciones');
  h.c.pedirPago();
  await h.avanzar(500);
  assert.equal(h.qrcode.scripts.length, 1, '«Pagar» baja el generador');
  assert.equal(h.qrcode.scripts[0].src, LIBRERIA_QR, 'el archivo local, relativo: mismo origen, sin CDN');
  assert.equal(h.c.qrListo, true);
  h.c.cambiarMetodo(); h.c.pedirPago();
  await avisar(h, 'qr');
  await h.avanzar(500);
  assert.equal(h.qrcode.scripts.length, 1, 'no se vuelve a bajar');
});

test('«QR (Bre-B)»: la hoja pasa a «pagando», AVISA al mesero como hoy (mismo POST), muestra la llave y se queda con el aviso en «ok»', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  const aviso = h.c.avisarPago('qr');
  assert.equal(h.c.pago.vista, 'pagando', 'el QR sale YA, sin esperar al aviso');
  assert.equal(h.c.pago.ver, 'qr');
  assert.equal(h.c.pago.aviso, 'enviando');
  assert.equal(h.c.pagandoBreb, true);
  assert.equal(h.c.eligiendoPago, false);
  assert.equal(h.c.pagoEnCuerpo, true, 'el QR toma el lugar de los ítems, como las opciones');
  await h.avanzar(300); await aviso;
  assert.deepEqual(plano(h.llamadas.alerta.map((a) => a.cuerpo)), [{ m: 3, k: TOKEN_CEROS, metodo: 'qr' }], 'el aviso al mesero es el de siempre: {m, k, metodo}');
  assert.deepEqual(Object.keys(h.llamadas.alerta[0].cuerpo).sort(), ['k', 'm', 'metodo'], 'y no lleva la llave ni el QR ni el total');
  assert.equal(h.c.pago.aviso, 'ok');
  assert.equal(h.c.pago.metodo, 'qr');
  assert.equal(h.c.pago.vista, 'pagando', 'sigue en el QR');
  assert.equal(h.c.pago.error, '');
  assert.equal(h.c.brebLlave, LLAVE_FICTICIA);
  assert.equal(h.c.metodoPago.con, 'QR de Bre-B');
  assert.match(h.c.qrTextoAlternativo, /^Código QR de Bre-B para pagar a la llave @prueba\.ficticia$/);
});

test('el QR dibujado SE LEE y dice exactamente el contenido (versión 17, corrección M), en negro sobre blanco y con 4 módulos de margen', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  await avisar(h, 'qr'); await h.avanzar(200);
  const { lado, ruta } = h.c.qrDibujo;
  assert.ok(lado > 0 && ruta.length > 0);
  const svg = `<svg viewBox="0 0 ${lado} ${lado}"><rect width="${lado}" height="${lado}" fill="white"/><path fill="black" d="${ruta}"/></svg>`;
  const { matriz, fondoBlanco, trazoNegro, margen } = matrizDeSvgConMargen(svg, 4);
  assert.equal(margen, 4);
  assert.ok(fondoBlanco && trazoNegro);
  assert.equal(lado, matriz.length + 8, 'el dibujo lleva 4 módulos de silencio por cada lado');
  const leido = decodificarQr(matriz);
  assert.equal(leido.texto, QR_FICTICIO, 'lo que un lector saca del dibujo es el contenido del QR, byte por byte');
  assert.equal(leido.nivel, 'M', 'corrección M');
  assert.equal(leido.version, 17, `con ≈ ${QR_FICTICIO.length} caracteres sale la versión 17 (85×85 módulos)`);
  // El corto también (otra versión, otra máscara).
  const corto = await conCarta({ pagoBreb: { llave: LLAVE_FICTICIA, qr: QR_FICTICIO_CORTO } });
  await corto.iniciar(); await corto.abrir();
  corto.c.pedirPago(); await corto.avanzar(200);
  const d2 = corto.c.qrDibujo;
  assert.ok(d2.ruta);
  const m2 = matrizDeSvgConMargen(`<svg viewBox="0 0 ${d2.lado} ${d2.lado}"><path d="${d2.ruta}"/></svg>`, 4).matriz;
  assert.equal(decodificarQr(m2).texto, QR_FICTICIO_CORTO);
  assert.ok(d2.lado < lado, 'un contenido más corto es un QR más chico');
});

test('el dibujo del QR no se rehace con cada lectura de la cuenta (mismo objeto) y lo que dibuja no depende del texto de la base más que por los números de la matriz', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  const antes = h.c.qrDibujo;
  const datos = h.c.pagoBreb;
  h.cambio((m) => m.agregar('Jugo', 6000));
  await h.avanzar(2000);
  assert.equal(h.c.pagoBreb, datos, 'una lectura con los mismos datos no reemplaza el objeto (no repinta el QR)');
  assert.equal(h.c.qrDibujo, antes);
  assert.match(h.c.qrDibujo.ruta, /^(M\d+ \d+h\d+v1h-\d+z)+$/, 'la ruta son solo rectángulos de módulos: ningún texto de la base');
  assert.equal(typeof h.c.qrDibujo.lado, 'number');
});

test('«Transferencia» con llave: muestra la llave (sin QR), avisa con metodo «transferencia» y no baja el generador', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  const antes = h.qrcode.scripts.length;
  await avisar(h, 'transferencia'); await h.avanzar(200);
  assert.equal(h.c.pago.vista, 'pagando');
  assert.equal(h.c.pago.ver, 'transferencia');
  assert.equal(h.c.pagandoBreb, true);
  assert.equal(h.c.pago.aviso, 'ok');
  assert.deepEqual(plano(h.llamadas.alerta.map((a) => a.cuerpo.metodo)), ['transferencia']);
  assert.equal(h.c.brebLlave, LLAVE_FICTICIA);
  assert.equal(h.c.metodoPago.con, 'transferencia');
  assert.equal(h.qrcode.scripts.length, antes, 'transferir no necesita el QR');
});

test('«Efectivo» sigue como hoy aunque haya Bre-B: avisa, queda «avisado» y NO muestra ni QR ni llave', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  await avisar(h, 'efectivo'); await h.avanzar(200);
  assert.deepEqual([h.c.pago.vista, h.c.pago.metodo, h.c.pago.ver, h.c.pagandoBreb], ['listo', 'efectivo', null, false]);
  assert.equal(h.c.tieneDatos('efectivo'), false);
  assert.deepEqual(plano(h.llamadas.alerta.map((a) => a.cuerpo.metodo)), ['efectivo']);
});

test('solo QR (sin llave) o solo llave (sin QR): cada método con datos va a «pagando» y el que no los tiene sigue el flujo de hoy', async () => {
  const soloQr = await conCarta({ pagoBreb: { llave: null, qr: QR_FICTICIO } });
  await soloQr.iniciar(); await soloQr.abrir();
  assert.deepEqual(titulos(soloQr.c), ['QR (Bre-B)', 'Transferencia', 'Efectivo']);
  assert.equal(soloQr.c.tieneDatos('transferencia'), false);
  await avisar(soloQr, 'transferencia');
  assert.equal(soloQr.c.pago.vista, 'listo', 'sin llave, «Transferencia» es la de hoy (avisa al mesero)');
  soloQr.c.cambiarMetodo(); soloQr.c.pedirPago();
  await avisar(soloQr, 'qr'); await soloQr.avanzar(200);
  assert.equal(soloQr.c.pago.vista, 'pagando');
  assert.equal(soloQr.c.qrTextoAlternativo, 'Código QR de Bre-B para pagar', 'sin llave el texto alternativo no inventa una');

  const soloLlave = await conCarta({ pagoBreb: { llave: LLAVE_FICTICIA, qr: null } });
  await soloLlave.iniciar(); await soloLlave.abrir();
  assert.deepEqual(titulos(soloLlave.c), ['QR', 'Transferencia', 'Efectivo'], 'sin QR, «QR» sigue siendo el de hoy: el mesero lo lleva');
  soloLlave.c.pedirPago();
  await soloLlave.avanzar(200);
  assert.equal(soloLlave.qrcode.scripts.length, 0, 'sin QR no se baja el generador');
  await avisar(soloLlave, 'qr');
  assert.equal(soloLlave.c.pago.vista, 'listo');
  soloLlave.c.cambiarMetodo();
  await avisar(soloLlave, 'transferencia');
  assert.equal(soloLlave.c.pago.vista, 'pagando');
});

test('el aviso al mesero FALLA (red, 401 de una función con JWT, 429, 500, tiempo): el QR y la llave siguen a la vista, se explica y «Avisar de nuevo» lo reintenta', async () => {
  const fallos = [
    ['sin red', 'red', /sin conexión/i],
    ['401 (la función con «Verify JWT» encendido)', { status: 401, body: { error: 'Invalid JWT' } }, /no pudimos avisar al mesero/i],
    ['429', { status: 429, body: { error: 'demasiadas solicitudes' } }, /mucha gente avisando/i],
    ['500', { status: 500, body: { error: 'boom' } }, /no pudimos avisar al mesero/i],
    ['tiempo agotado', 'lento', /la red tardó demasiado/i],
  ];
  for (const [nombre, falla, texto] of fallos) {
    const h = await conCarta();
    await h.iniciar(); await h.abrir();
    h.mundo.alerta = falla;
    h.c.pedirPago(); await h.avanzar(200);
    const p = h.c.avisarPago('qr');
    await h.avanzar(9000);
    await p;
    assert.equal(h.c.pago.vista, 'pagando', `${nombre}: el QR sigue a la vista`);
    assert.equal(h.c.pagandoBreb, true);
    assert.equal(h.c.pago.aviso, 'error', nombre);
    assert.match(h.c.pago.error, texto, nombre);
    assert.equal(h.c.pago.metodo, null, `${nombre}: nada quedó «avisado»`);
    assert.equal(h.c.pago.enviando, null, `${nombre}: el botón «Avisar de nuevo» queda libre`);
    assert.ok(h.c.qrDibujo.ruta, `${nombre}: el QR sigue dibujado`);
    assert.equal(h.llamadas.alerta.length, 1, `${nombre}: no se reintenta solo`);
    await h.avanzar(60000);
    assert.equal(h.llamadas.alerta.length, 1, `${nombre}: ni pasado un minuto`);
    h.mundo.alerta = null;
    await avisar(h, h.c.pago.ver); await h.avanzar(200);
    assert.deepEqual([h.c.pago.aviso, h.c.pago.error, h.c.pago.metodo, h.c.pago.vista], ['ok', '', 'qr', 'pagando'], `${nombre}: al reintentar, queda avisado y sigue en el QR`);
    assert.equal(h.llamadas.alerta.length, 2);
  }
});

test('409 al avisar (la cuenta cerró): se vuelve a leer y la hoja lo muestra, sin QR ni llave sueltos', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  h.mundo.alerta = { status: 409, body: { error: 'sin cuenta' } };
  h.mundo.cerrar();
  await avisar(h, 'qr'); await h.avanzar(2000);
  assert.equal(h.c.cuenta.estado, 'cerrada', 'la orden que se miraba ya cerró');
  assert.equal(h.c.pago.vista, 'inicio', 'sin cuenta abierta todo se olvida');
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.pagandoBreb, false);
  assert.equal(h.c.qrDibujo.ruta, '', 'y el QR no queda dibujado sin cuenta');
});

test('volver y «Ver el QR de pago»: «Volver» regresa a la cuenta (avisado), el botón del pie vuelve a mostrar el QR sin avisar otra vez, y «Cambiar método» abre las opciones', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  await avisar(h, 'qr'); await h.avanzar(200);
  h.c.volverDePago();
  assert.deepEqual([h.c.pago.vista, h.c.pago.ver, h.c.pagoEnCuerpo], ['listo', null, false]);
  assert.equal(h.c.tieneDatos(h.c.pago.metodo), true, 'el botón «Ver el QR de pago» sale');
  h.c.verPagoBreb();
  assert.deepEqual([h.c.pago.vista, h.c.pago.ver, h.c.pago.aviso, h.c.pagandoBreb], ['pagando', 'qr', 'ok', true]);
  assert.equal(h.llamadas.alerta.length, 1, 'volver a mirar el QR no avisa de nuevo');
  h.c.cambiarMetodo();
  assert.deepEqual([h.c.pago.vista, h.c.pago.ver, h.c.eligiendoPago], ['elegir', null, true]);
  await avisar(h, 'efectivo'); await h.avanzar(200);
  assert.equal(h.c.pago.metodo, 'efectivo');
  assert.equal(h.c.tieneDatos(h.c.pago.metodo), false, 'ya avisado «efectivo», no hay QR que ver');
  h.c.verPagoBreb();
  assert.equal(h.c.pago.vista, 'listo', 'verPagoBreb sin datos para el método no hace nada');
  // Si el aviso falló, «Volver» deja el botón «Pagar» del principio (no hay nada avisado).
  const f = await conCarta();
  await f.iniciar(); await f.abrir();
  f.mundo.alerta = { status: 500, body: {} };
  await avisar(f, 'qr'); await f.avanzar(200);
  f.c.volverDePago();
  assert.deepEqual([f.c.pago.vista, f.c.pago.metodo], ['inicio', null]);
});

test('si el admin apaga Bre-B mientras alguien mira el QR, la siguiente lectura lo saca de ahí (vuelve a la cuenta o al botón «Pagar») sin dejar nada dibujado', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  await avisar(h, 'qr'); await h.avanzar(200);
  assert.equal(h.c.pagandoBreb, true);
  h.cambio((m) => { m.pagoBreb = null; m.agregar('Agua', 3000); });
  await h.avanzar(2000);
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.pagandoBreb, false);
  assert.equal(h.c.pago.vista, 'listo', 'ya estaba avisado: queda «Listo, le avisamos al mesero»');
  assert.equal(h.c.qrDibujo.ruta, '');
  assert.deepEqual(titulos(h.c), ['QR', 'Transferencia', 'Efectivo']);
  // Al revés: lo encienden y aparece sin recargar.
  h.cambio((m) => { m.pagoBreb = { ...BREB }; m.agregar('Agua', 3000); });
  await h.avanzar(2000);
  assert.deepEqual(plano(h.c.pagoBreb), plano(BREB));
  assert.deepEqual(titulos(h.c), ['QR (Bre-B)', 'Transferencia', 'Efectivo']);
  // Cambian la llave: la carta usa la nueva.
  h.cambio((m) => { m.pagoBreb = { llave: '@otra.llave', qr: QR_FICTICIO_CORTO }; m.agregar('Agua', 3000); });
  await h.avanzar(2000);
  assert.equal(h.c.brebLlave, '@otra.llave');
  assert.equal(h.c.brebQr, QR_FICTICIO_CORTO);
});

test('cuando la cuenta cierra, los datos de Bre-B se borran de la carta (no quedan en memoria para la siguiente)', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  const id = h.c.orden;
  assert.ok(h.c.pagoBreb);
  h.cambio((m) => m.cerrar({ pago: true }));
  await h.avanzar(2000);
  assert.equal(h.c.cuenta.estado, 'cerrada');
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.brebLlave, '');
  assert.ok(id);
});

test('si el enlace de la mesa se rota (404 «enlace inválido»), los datos de Bre-B se borran de la carta y no queda nada que mostrar', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  assert.ok(h.c.pagoBreb);
  h.cambio((m) => m.rotarToken());
  await h.avanzar(60000);
  assert.equal(h.c.cuenta.estado, 'vencido');
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.breb, null);
  assert.equal(h.c.pagandoBreb, false);
  assert.equal(h.c.qrDibujo.ruta, '');
});

test('si el generador del QR no carga (error o se cuelga), se dice la verdad y se queda la llave: nunca un cuadro roto ni un QR inventado', async () => {
  const roto = await conCarta({ qr: 'error' });
  await roto.iniciar(); await roto.abrir();
  roto.c.pedirPago(); await roto.avanzar(500);
  await avisar(roto, 'qr'); await roto.avanzar(500);
  assert.equal(roto.c.qrFalla, true);
  assert.equal(roto.c.qrListo, false);
  assert.equal(roto.c.qrDibujo.ruta, '');
  assert.equal(roto.c.pago.vista, 'pagando');
  assert.equal(roto.c.brebLlave, LLAVE_FICTICIA);
  assert.equal(roto.c.pago.aviso, 'ok', 'y el aviso al mesero salió igual');

  const colgado = await conCarta({ qr: 'nunca' });
  await colgado.iniciar(); await colgado.abrir();
  colgado.c.pedirPago(); await colgado.avanzar(500);
  assert.equal(colgado.c.qrFalla, false, 'a los 0,5 s todavía está «Preparando el código…»');
  await colgado.avanzar(9000);
  assert.equal(colgado.c.qrFalla, true, 'pasados 8 s deja de decir «Preparando…»');
  assert.equal(colgado.c.qrDibujo.ruta, '');
});

test('«Copiar llave»: copia exactamente la llave, avisa y se apaga solo a los 3 s; sin permiso prueba la selección; sin ninguna dice que no pudo', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await h.c.copiarLlave();
  assert.deepEqual(h.copiado.textos, [LLAVE_FICTICIA], 'se copia la llave, ni el QR ni el total ni «Llave: »');
  assert.deepEqual([h.c.pago.copiado, h.c.pago.copiaError], [true, false]);
  await h.avanzar(3100);
  assert.deepEqual([h.c.pago.copiado, h.c.pago.copiaError], [false, false]);

  // El portapapeles rechaza (sin permiso, o una página sin HTTPS): se prueba la selección de siempre.
  const sinPermiso = await conCarta({ portapapeles: 'rechaza' });
  await sinPermiso.iniciar(); await sinPermiso.abrir();
  let seleccionado = null;
  sinPermiso.documento.body = { appendChild() {}, removeChild() {} };
  sinPermiso.documento.createElement = () => ({ setAttribute() {}, style: {}, select() {}, setSelectionRange() {}, set value(v) { seleccionado = v; } });
  sinPermiso.documento.execCommand = (orden) => orden === 'copy';
  await sinPermiso.c.copiarLlave();
  assert.equal(seleccionado, LLAVE_FICTICIA, 'copió con la selección');
  assert.deepEqual([sinPermiso.c.pago.copiado, sinPermiso.c.pago.copiaError], [true, false]);

  // Ninguna sirve: se dice, y la llave sigue ahí para mantenerla pulsada.
  for (const modo of ['rechaza', 'sin']) {
    const x = await conCarta({ portapapeles: modo });
    await x.iniciar(); await x.abrir();
    await x.c.copiarLlave();
    assert.deepEqual([x.c.pago.copiado, x.c.pago.copiaError], [false, true], modo);
    assert.equal(x.c.brebLlave, LLAVE_FICTICIA);
  }
  // Sin llave no hay nada que copiar.
  const sinLlave = await conCarta({ pagoBreb: { llave: null, qr: QR_FICTICIO } });
  await sinLlave.iniciar(); await sinLlave.abrir();
  await sinLlave.c.copiarLlave();
  assert.deepEqual(sinLlave.copiado.textos, []);
});

test('WhatsApp: https://wa.me/<el número de local.js>?text=… con la mesa y lo que queda por pagar, «te envío el comprobante del pago con Bre-B» y NADA personal', async () => {
  const h = await conCarta({ items: [{ nombre: 'Ejecutivo', precio: 23000, cantidad: 2 }, { nombre: 'Jugo', precio: 7000, cantidad: 1 }] });
  await h.iniciar(); await h.abrir();
  const numero = h.caja.RESPLANDOR.whatsapp;
  assert.match(numero, /^573225542434$/, 'el WhatsApp de Resplandor sale de assets/js/local.js');
  const url = h.c.comprobanteUrl;
  const m = url.match(/^https:\/\/wa\.me\/(\d+)\?text=([^&]+)$/);
  assert.ok(m, url);
  assert.equal(m[1], numero);
  const texto = decodeURIComponent(m[2]);
  assert.equal(texto, 'Hola, soy de la mesa 3. Total a pagar: $ 53.000. Te envío el comprobante del pago con Bre-B.');
  assert.match(texto, /te envío el comprobante del pago con Bre-B/i);
  assert.match(texto, /mesa 3/);
  assert.match(texto, /\$ 53\.000/);
  // Nada personal: ni el token del enlace de la mesa, ni la llave, ni el contenido del QR, ni nombres, ni correos.
  assert.ok(!url.includes(TOKEN_CEROS) && !url.includes('k='), 'el token de la mesa no sale en el enlace');
  assert.ok(!url.includes(encodeURIComponent(LLAVE_FICTICIA)) && !texto.includes('@'), 'ni la llave');
  assert.ok(!url.includes('000201'), 'ni el contenido del QR');
  assert.doesNotMatch(url, /@|%40|correo|mail|nombre|tel[eé]fono|c[eé]dula/i);
  assert.equal(url.length < 200, true, 'un enlace corto');
  // Con el total que cambia, el enlace cambia (se arma al momento de tocar).
  h.cambio((x) => x.agregar('Agua', 3000));
  await h.avanzar(2000);
  assert.match(decodeURIComponent(h.c.comprobanteUrl), /\$ 56\.000\./);
  // Con abonos, lo que se manda es lo que QUEDA por pagar (el total de la cuenta).
  h.cambio((x) => x.agregar('Abono recibido', -16000));
  await h.avanzar(2000);
  assert.match(decodeURIComponent(h.c.comprobanteUrl), /Total a pagar: \$ 40\.000\./);
});

test('WhatsApp: sin número válido en local.js el botón no sale (nunca un enlace a nadie); con otro número, el que diga local.js', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.caja.RESPLANDOR.whatsapp = '';
  assert.equal(h.c.comprobanteUrl, '');
  h.caja.RESPLANDOR.whatsapp = 'no es un número';
  assert.equal(h.c.comprobanteUrl, '');
  h.caja.RESPLANDOR.whatsapp = '57 300 123 4567';
  assert.match(h.c.comprobanteUrl, /^https:\/\/wa\.me\/573001234567\?text=/);
  const sinMesa = await crearCarta({ search: '' });
  await sinMesa.iniciar();
  assert.equal(sinMesa.c.comprobanteUrl, '', 'sin mesa no hay comprobante que enviar');
});

test('apagada la función pagarEnMesa nada de esto corre: ni «pagando», ni el generador, ni avisos (aunque la base mande el pago)', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.caja.RESPLANDOR.funciones = { ...h.caja.RESPLANDOR.funciones };
  // pagarEnMesa es de solo lectura en local.js (objeto congelado): se prueba con una copia del objeto.
  Object.defineProperty(h.caja.RESPLANDOR, 'funciones', { value: { pagarEnMesa: false }, configurable: true });
  assert.equal(h.c.pagarEnMesa, false);
  await avisar(h, 'qr');
  assert.deepEqual(h.llamadas.alerta, []);
  assert.equal(h.c.pagandoBreb, false);
  assert.equal(h.c.pago.vista, 'inicio');
  assert.equal(h.qrcode.scripts.length, 0);
});

test('el contenido del QR y la llave nunca se piden a otro lado ni se mandan a ningún servidor: la única red de «Pagar con Bre-B» es el POST de siempre a `alerta` (sin la llave ni el QR)', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago(); await h.avanzar(200);
  await avisar(h, 'qr'); await h.avanzar(200);
  await h.c.copiarLlave();
  h.c.volverDePago(); h.c.verPagoBreb(); h.c.cambiarMetodo();
  const cuerpos = h.llamadas.alerta.map((a) => JSON.stringify(a.cuerpo)).join('|');
  assert.ok(!cuerpos.includes(LLAVE_FICTICIA) && !cuerpos.includes('000201'));
  assert.deepEqual(h.llamadas.cuenta.every((l) => l.url.includes('/functions/v1/cuenta?')), true);
  // Ninguna URL lleva la llave ni el contenido (sería un dato de pago en un registro de acceso).
  for (const l of [...h.llamadas.cuenta, ...h.llamadas.alerta]) {
    assert.ok(!l.url.includes(encodeURIComponent(LLAVE_FICTICIA)) && !l.url.includes('000201'), l.url);
  }
});

test('«no se inventa»: con una `cuenta` cuyo `pago.breb` trae basura (otro tipo, vacío, demasiado largo), no hay botón con datos, ni QR, ni llave', async () => {
  const basura = [
    { llave: 'x'.repeat(5000), qr: 'y'.repeat(5000) },
    { llave: ['@a'], qr: { 0: 1 } },
    { llave: '', qr: '' },
    { llave: '@con espacio', qr: '000201 y algo que no es un QR' },
  ];
  for (const breb of basura) {
    const h = await conCarta({ pagoBreb: breb });
    await h.iniciar(); await h.abrir();
    assert.equal(h.c.pagoBreb, null, JSON.stringify(breb).slice(0, 50));
    assert.deepEqual(titulos(h.c), ['QR', 'Transferencia', 'Efectivo']);
    h.c.pedirPago(); await h.avanzar(300);
    assert.equal(h.qrcode.scripts.length, 0);
  }
});

test('el cambio de contrato queda dicho: la carta ya no promete «nunca muestra datos de pago» y el comentario de local.js tampoco', () => {
  for (const archivo of ['carta.html', 'assets/js/local.js']) {
    assert.doesNotMatch(sinComentarios(leer(archivo)), /nunca muestra datos/i);
    assert.doesNotMatch(leer(archivo), /esta página nunca muestra datos bancarios ni un QR|la página nunca muestra\s+datos bancarios ni QR/i, archivo);
  }
});
