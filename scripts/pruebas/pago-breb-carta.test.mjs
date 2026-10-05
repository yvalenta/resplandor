// «Pagar con Bre-B» en carta.html (tarea pago-breb, parte CARTA), con el flujo de UNA sola pantalla (tareas/2026-10-04-hallazgos-domingo.md, punto 5).
//
// Al tocar «Pagar» la hoja (o el panel) pasa DIRECTO a una pantalla (`pago.vista === 'pagando'`, `#pago-breb`: «Paga como prefieras») que muestra a la
// vez el QR del restaurante dibujado en el navegador (con su pie «para escanear con otro celular»), la llave («Copiar llave»), el valor («Copiar valor»),
// el botón «Enviar comprobante por WhatsApp» y «O en efectivo»; y avisa SOLA al mesero con el método `cuenta` («pide la cuenta»), sin que nadie elija
// nada (ya no hay tres opciones QR / Transferencia / Efectivo, ni la vista `elegir`, ni «Cambiar método»). Copiar la llave o el valor, o abrir el
// comprobante, AFINAN esa misma alerta a `transferencia`; «Avisar que pago en efectivo», a `efectivo`; «Avisar de nuevo» fuerza el reintento. Los datos NO
// están en el código: llegan en la `cuenta` (`pago.breb`) solo si el admin los configuró y la mesa tiene cuenta abierta; sin ellos la pantalla sigue
// abierta y dice que el mesero lleva el QR o los datos (el efectivo siempre está).
//
// Aquí (siempre corre, también en CI; el navegador está en pago-breb-carta-navegador.test.mjs):
//   1. ESTÁTICA: ningún dato de pago puesto a mano (ni la red de pagos, ni un contenido EMV, ni bancos), todo dentro de las plantillas de
//      pagarEnMesa, el generador del QR NO está en el marcado (se baja al tocar «Pagar»), sin CDN, sin x-html, sin alert()/confirm(); qué bloques de la
//      pantalla dependen de los datos de Bre-B y cuáles (el efectivo) no.
//   2. LA REGLA de lo que la carta acepta de la base (llave y contenido del QR con su CRC): la misma que la de las pruebas, escrita aparte.
//   3. EL FLUJO en el <script> real corrido en un vm (scripts/pruebas/_carta-vm.mjs) con el QR FICTICIO de _breb-ficticio.mjs: sin pago → la pantalla
//      sin datos; con pago → QR y llave; al abrir se avisa «cuenta» una sola vez; copiar la llave o el valor afina a «transferencia»; «Avisar que pago en
//      efectivo» afina a «efectivo»; con la misma cuenta no se repite el aviso y «Avisar de nuevo» sí lo fuerza; el aviso al mesero puede fallar sin esconder
//      el QR; el QR dibujado SE LEE y dice lo mismo que el contenido; la llave se copia; el enlace de WhatsApp lleva mesa y total y nada personal; si
//      apagan Bre-B en pleno vuelo la pantalla sigue, sin datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crearCarta, RAIZ, TOKEN_CEROS } from './_carta-vm.mjs';
import { decodificarQr, matrizDeSvgConMargen } from './_qr-decodificar.mjs';
import { LLAVE_FICTICIA, LLAVE_OTRA_FICTICIA, QR_FICTICIO, QR_FICTICIO_CORTO, VECTORES_LLAVE, VECTORES_QR, conUnCaracterCambiado, crc16, crcHex, reglaDelContenido, reglaDeLaLlave } from './_breb-ficticio.mjs';
import { llaveQrVectores, LLAVE_VISIBLE, LLAVE_OTRA, QR_COBRA_A_OTRA, QR_COBRA_A_OTRA_CON_LA_VISIBLE_EN_62 } from './_pago-breb-vectores.mjs';

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
    // La ÚNICA mención permitida es la etiqueta del subcampo que trae la llave, «CO.COM.RBM.LLA»: un nombre de protocolo público (con ella la carta sabe DÓNDE
    // buscar la llave dentro del QR y comprobar que es la que se muestra), no un dato del local. Cualquier otro identificador de la red sigue prohibido.
    assert.doesNotMatch(texto.replaceAll("'CO.COM.RBM.LLA'", ''), /CO\.COM\.RBM/, `${nombre}: el identificador de la red de pagos solo viaja DENTRO del contenido del QR, que llega de la base (salvo la etiqueta «CO.COM.RBM.LLA» del subcampo de la llave)`);
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
  for (const rastro of [/pago-breb/, /breb-qr/, /breb-llave/, /breb-copiar/, /pago-qr-pie/, /pago-copiar-llave/, /pago-copiar-valor/, /pago-sin-datos/, /Copiar llave/, /Enviar comprobante/, /WhatsApp por/, /qrDibujo/, /brebLlave/, /comprobanteUrl/, /Paga como prefieras/, /Ver el QR de pago/, /Paga con el QR/, /Transfiere con Bre-B/, /#i-copy/, /#i-message-circle/]) {
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

test('qué bloques de la pantalla de pago dependen de los datos de Bre-B y cuáles no: el QR, la llave, el valor y el comprobante salen solo con datos; «sin datos» y el EFECTIVO siempre están, y el comprobante afina el aviso a «transferencia»', () => {
  const html = sinScripts(sinComentarios(leer('carta.html')));
  const pantalla = html.slice(html.indexOf('<div id="pago-breb">'), html.indexOf('<div x-show="!pagoEnCuerpo">'));
  assert.ok(pantalla.length > 1500, 'no encontré la pantalla de pago');
  // Cada bloque con su condición.
  assert.match(pantalla, /<template x-if="brebQr">[\s\S]*?id="pago-qr-pie"/, 'el QR (con su pie) solo si hay QR');
  assert.match(pantalla, /<template x-if="brebLlave">[\s\S]*?id="pago-copiar-llave"/, 'la llave solo si hay llave');
  assert.match(pantalla, /<template x-if="valorPagar && breb">[\s\S]*?id="pago-copiar-valor"/, 'el valor solo si hay datos de Bre-B y algo que pagar');
  assert.match(pantalla, /<template x-if="!breb">\s*<p[^>]*id="pago-sin-datos"/, 'sin datos de Bre-B, la línea de «el mesero te lleva…»');
  assert.match(pantalla, /<template x-if="comprobanteUrl && breb">[\s\S]*?id="pago-comprobante-bloque"/, 'el comprobante solo si hay datos de Bre-B y un WhatsApp válido');
  // El efectivo NO depende de nada de eso: quitadas las plantillas que dependen de los datos, sigue ahí.
  const siempre = quitarPlantillas(pantalla, (cond) => /\b(breb|brebQr|brebLlave|valorPagar|comprobanteUrl)\b/.test(cond));
  assert.match(siempre, /id="pago-efectivo"/, 'el efectivo está SIEMPRE');
  assert.match(siempre, /id="pago-avisar-efectivo"[^>]*x-show="pago\.metodo !== 'efectivo'"[^>]*@click="avisarPago\('efectivo'\)"/, 'afina el aviso a «efectivo» y se esconde cuando ya está');
  assert.match(siempre, /Le avisamos: pagas en efectivo\./);
  assert.doesNotMatch(siempre, /pago-copiar|pago-comprobante|breb-qr/, 'sin datos no queda ni QR, ni copiar, ni comprobante');
  // El comprobante (en la pantalla y en la tarjeta «Listo») afina el aviso a «transferencia» al abrirlo.
  const crudo = sinComentarios(leer('carta.html'));
  assert.match(crudo, /id="pago-comprobante" @click="avisarPago\('transferencia'\)"|id="pago-comprobante"[^>]*@click="avisarPago\('transferencia'\)"/);
  assert.match(crudo, /id="pago-comprobante-listo"[^>]*@click="avisarPago\('transferencia'\)"/);
  // «Copiar llave» y «Copiar valor» llaman a copiarLlave()/copiarValor(), que son los que afinan (se prueban en el flujo, abajo).
  assert.match(pantalla, /id="pago-copiar-llave" @click="copiarLlave\(\)"/);
  assert.match(pantalla, /id="pago-copiar-valor" @click="copiarValor\(\)"/);
});

test('el enlace de WhatsApp se abre en pestaña nueva sin dar el origen (noopener) y la página sigue sin mandar el Referer', () => {
  const html = sinComentarios(leer('carta.html'));
  const enlace = html.match(/<a class="btn btn-primary w-full[^"]*" :href="comprobanteUrl"[^>]*>/);
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
/** Afina (o fuerza) un aviso y deja pasar el tiempo virtual que tarda el POST a `alerta` (con el reloj virtual, esperarlo sin avanzar el reloj no termina nunca). */
async function avisar(h, metodo, ms = 300, forzar = false) { const p = h.c.avisarPago(metodo, forzar); await h.avanzar(ms); await p; }
/** «Pagar»: abre la pantalla de pago (que avisa SOLA con «cuenta») y deja pasar el tiempo virtual del POST y de la descarga del generador del QR. */
async function abrirPago(h, ms = 500) { h.c.pedirPago(); await h.avanzar(ms); }
/** Los métodos de los POST a `alerta` que salieron, en orden. */
const avisados = (h) => plano(h.llamadas.alerta.map((a) => a.cuerpo.metodo));

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

test('SIN `pago` en la cuenta (no configurado, apagado, sin cuenta abierta o la `cuenta` de antes) «Pagar» abre igual la pantalla única: sin QR, sin llave, sin comprobante, dice que el mesero lleva los datos, avisa «cuenta» y no baja el generador', async () => {
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
    assert.equal(h.c.tieneDatos('qr'), false);
    assert.equal(h.c.tieneDatos('transferencia'), false);
    await abrirPago(h);
    assert.equal(h.c.pagando, true, `${nombre}: la pantalla no depende de que haya datos de Bre-B`);
    assert.equal(h.c.pagandoBreb, true, `${nombre}: el alias`);
    assert.equal(h.qrcode.scripts.length, 0, `${nombre}: sin QR que dibujar no se baja el generador`);
    assert.deepEqual(plano(h.llamadas.alerta.map((a) => a.cuerpo)), [{ m: 3, k: TOKEN_CEROS, metodo: 'cuenta' }], `${nombre}: abrir «Pagar» avisa «cuenta», una sola vez`);
    assert.deepEqual([h.c.pago.vista, h.c.pago.metodo, h.c.pago.aviso], ['pagando', 'cuenta', 'ok'], nombre);
    assert.equal(h.c.subtituloPago, 'El mesero te lleva el QR o los datos para transferir. O en efectivo.', nombre);
    assert.equal(h.c.qrDibujo.ruta, '');
    assert.equal(h.c.brebLlave, '');
    assert.equal(h.c.brebQr, '');
    assert.equal(Boolean(h.c.comprobanteUrl && h.c.breb), false, `${nombre}: sin datos de Bre-B no sale el comprobante`);
  }
  // Sin cuenta abierta no hay datos aunque la base los tenga (la función no los manda; y la carta no los guardaría), ni pantalla de pago.
  const h = await conCarta({ sinOrden: true });
  await h.iniciar(); await h.abrir();
  assert.equal(h.c.cuenta.estado, 'vacia');
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.breb, null);
  assert.equal(h.c.pagando, false);
});

test('CON `pago.breb`: la pantalla trae QR y llave a la vez (el subtítulo lo dice: el QR es para OTRO celular), el efectivo no lleva datos, y el generador del QR se baja al tocar «Pagar» (no antes, y una sola vez)', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  assert.deepEqual(plano(h.c.pagoBreb), plano(BREB));
  assert.equal(h.qrcode.scripts.length, 0, 'abrir la cuenta no baja el generador: solo «Pagar»');
  assert.equal(h.c.tieneDatos('qr'), true);
  assert.equal(h.c.tieneDatos('transferencia'), true);
  assert.equal(h.c.tieneDatos('efectivo'), false, 'el efectivo nunca lleva datos de Bre-B');
  // Quien abre la carta lo hace desde SU celular, y un QR en la pantalla del mismo celular que tendría que escanearlo no se puede leer: la pantalla dice
  // «con otro celular» y deja la llave, con la que sí se paga desde el mismo aparato.
  assert.match(h.c.subtituloPago, /^Desde tu app del banco, con \$ [\d.]+: escanea el QR con otro celular o copia la llave\. O en efectivo\.$/);
  for (const o of h.c.metodosPago) assert.doesNotMatch(`${o.titulo} ${o.con} ${o.detalle}`, /\d|propina|\$|@/, 'ni cifras ni la llave en el texto de los métodos');
  await abrirPago(h);
  assert.equal(h.qrcode.scripts.length, 1, '«Pagar» baja el generador');
  assert.equal(h.qrcode.scripts[0].src, LIBRERIA_QR, 'el archivo local, relativo: mismo origen, sin CDN');
  assert.equal(h.c.qrListo, true);
  h.c.volverDePago(); h.c.verPago();
  await h.avanzar(500);
  assert.equal(h.qrcode.scripts.length, 1, 'no se vuelve a bajar');
});

test('«Pagar» con datos de Bre-B: la hoja pasa a «pagando» YA, AVISA sola al mesero con «cuenta» (mismo POST de siempre, sin elegir nada), muestra la llave y se queda con el aviso en «ok»', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.c.pedirPago();
  assert.equal(h.c.pago.vista, 'pagando', 'la pantalla sale YA, sin esperar al aviso');
  assert.equal(h.c.pago.aviso, 'enviando');
  assert.equal(h.c.pagando, true);
  assert.equal(h.c.pagandoBreb, true, 'alias de `pagando`');
  assert.equal(h.c.pagoEnCuerpo, true, 'la pantalla toma el lugar de los ítems en el cuerpo de la cuenta');
  await h.avanzar(500);
  assert.deepEqual(plano(h.llamadas.alerta.map((a) => a.cuerpo)), [{ m: 3, k: TOKEN_CEROS, metodo: 'cuenta' }], 'el aviso al mesero es el de siempre: {m, k, metodo}, con «cuenta»');
  assert.deepEqual(Object.keys(h.llamadas.alerta[0].cuerpo).sort(), ['k', 'm', 'metodo'], 'y no lleva la llave ni el QR ni el total');
  assert.equal(h.c.pago.aviso, 'ok');
  assert.equal(h.c.pago.metodo, 'cuenta');
  assert.equal(h.c.pago.vista, 'pagando', 'sigue en la pantalla de pago');
  assert.equal(h.c.pago.error, '');
  assert.equal(h.c.brebLlave, LLAVE_FICTICIA);
  assert.equal(h.c.metodoPago, null, '«cuenta» no es un método de pago: la tarjeta «Listo» no dice «Vas a pagar con …» por ella');
  assert.match(h.c.qrTextoAlternativo, /^Código QR de Bre-B para pagar a la llave @prueba\.ficticia$/);
});

test('el QR dibujado SE LEE y dice exactamente el contenido (versión 17, corrección M), en negro sobre blanco y con 4 módulos de margen', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
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
  const corto = await conCarta({ pagoBreb: { llave: LLAVE_OTRA_FICTICIA, qr: QR_FICTICIO_CORTO } });
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

test('copiar la llave o el valor AFINA el aviso: la misma alerta pasa de «cuenta» a «transferencia», una sola vez; una copia que falla no afina nada', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  assert.deepEqual(avisados(h), ['cuenta']);
  await h.c.copiarLlave(); await h.avanzar(300);
  assert.deepEqual(avisados(h), ['cuenta', 'transferencia'], 'copiar la llave = va a transferir');
  assert.deepEqual(plano(h.llamadas.alerta[1].cuerpo), { m: 3, k: TOKEN_CEROS, metodo: 'transferencia' }, 'el mismo POST de siempre, ni la llave ni el total');
  assert.deepEqual([h.c.pago.vista, h.c.pago.metodo, h.c.pago.aviso], ['pagando', 'transferencia', 'ok'], 'afinar no saca de la pantalla');
  assert.equal(h.c.metodoPago.con, 'transferencia');
  await h.c.copiarValor(); await h.avanzar(300);
  await h.c.copiarLlave(); await h.avanzar(300);
  assert.equal(h.llamadas.alerta.length, 2, 'ya estaba en «transferencia»: copiar otra vez (la llave o el valor) no repite el aviso');
  // Copiar el valor primero también afina.
  const v = await conCarta();
  await v.iniciar(); await v.abrir();
  await abrirPago(v);
  await v.c.copiarValor(); await v.avanzar(300);
  assert.deepEqual(avisados(v), ['cuenta', 'transferencia']);
  // Una copia que FALLA no afina nada: no sabemos que la persona vaya a transferir.
  for (const modo of ['rechaza', 'sin']) {
    const x = await conCarta({ portapapeles: modo });
    await x.iniciar(); await x.abrir();
    await abrirPago(x);
    await x.c.copiarLlave(); await x.avanzar(300);
    assert.equal(x.c.pago.copiaError, true, modo);
    assert.deepEqual(avisados(x), ['cuenta'], `${modo}: sin copia no hay afinado`);
  }
});

test('«Avisar que pago en efectivo» AFINA el aviso a «efectivo» y deja la pantalla como está (el QR y la llave siguen a la vista); una segunda vez no lo repite', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  await avisar(h, 'efectivo'); await h.avanzar(200);
  assert.deepEqual(avisados(h), ['cuenta', 'efectivo']);
  assert.deepEqual(plano(h.llamadas.alerta[1].cuerpo), { m: 3, k: TOKEN_CEROS, metodo: 'efectivo' });
  assert.deepEqual([h.c.pago.vista, h.c.pago.metodo, h.c.pago.aviso, h.c.pagando], ['pagando', 'efectivo', 'ok', true]);
  assert.equal(h.c.brebLlave, LLAVE_FICTICIA, 'la llave sigue a la vista: el efectivo no esconde nada');
  assert.ok(h.c.qrDibujo.ruta, 'ni el QR');
  assert.equal(h.c.metodoPago.con, 'efectivo');
  await avisar(h, 'efectivo');
  assert.equal(h.llamadas.alerta.length, 2, 'ya avisado el efectivo no se repite');
  h.c.volverDePago();
  assert.deepEqual([h.c.pago.vista, h.c.pago.metodo], ['listo', 'efectivo'], 'al volver, «Listo, le avisamos» con «Vas a pagar con efectivo»');
});

test('con la misma cuenta no se repite el aviso (abrir «Pagar» otra vez, copiar de nuevo o tocar el mismo método no manda nada), y «Avisar de nuevo» (forzar) sí', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  h.c.volverDePago(); await abrirPago(h);
  h.c.volverDePago(); h.c.verPago(); await h.avanzar(300);
  await avisar(h, 'cuenta');
  assert.deepEqual(avisados(h), ['cuenta'], 'abrir la pantalla de nuevo (o «cuenta» otra vez) no vuelve a avisar');
  await h.c.copiarLlave(); await h.avanzar(300);
  await h.c.copiarLlave(); await h.avanzar(300);
  assert.deepEqual(avisados(h), ['cuenta', 'transferencia'], 'copiar dos veces afina una sola');
  await avisar(h, 'transferencia', 300, true);
  assert.deepEqual(avisados(h), ['cuenta', 'transferencia', 'transferencia'], '«Avisar de nuevo» fuerza el aviso aunque el método sea el mismo');
  // Otra cuenta en la misma mesa vuelve a avisar sola al abrir «Pagar» (se cubre en pagar.test.mjs: «el aviso se olvida…»).
});

test('solo QR (sin llave) o solo llave (sin QR): la pantalla muestra lo que haya, el subtítulo lo dice y el generador solo se baja si hay un QR que dibujar', async () => {
  const soloQr = await conCarta({ pagoBreb: { llave: null, qr: QR_FICTICIO } });
  await soloQr.iniciar(); await soloQr.abrir();
  assert.equal(soloQr.c.tieneDatos('qr'), true);
  assert.equal(soloQr.c.tieneDatos('transferencia'), false);
  await abrirPago(soloQr);
  assert.equal(soloQr.qrcode.scripts.length, 1, 'con QR se baja el generador');
  assert.equal(soloQr.c.pago.vista, 'pagando');
  assert.equal(soloQr.c.brebLlave, '');
  assert.ok(soloQr.c.qrDibujo.ruta);
  assert.match(soloQr.c.subtituloPago, /: escanea el QR con otro celular\. O en efectivo\.$/);
  assert.equal(soloQr.c.qrTextoAlternativo, 'Código QR de Bre-B para pagar', 'sin llave el texto alternativo no inventa una');
  assert.deepEqual(avisados(soloQr), ['cuenta']);

  const soloLlave = await conCarta({ pagoBreb: { llave: LLAVE_FICTICIA, qr: null } });
  await soloLlave.iniciar(); await soloLlave.abrir();
  assert.equal(soloLlave.c.tieneDatos('qr'), false, 'sin QR, no hay QR que mostrar: el mesero lo lleva');
  assert.equal(soloLlave.c.tieneDatos('transferencia'), true);
  await abrirPago(soloLlave);
  assert.equal(soloLlave.qrcode.scripts.length, 0, 'sin QR no se baja el generador');
  assert.equal(soloLlave.c.pago.vista, 'pagando');
  assert.equal(soloLlave.c.brebQr, '');
  assert.equal(soloLlave.c.qrDibujo.ruta, '');
  assert.equal(soloLlave.c.brebLlave, LLAVE_FICTICIA);
  assert.match(soloLlave.c.subtituloPago, /: copia la llave\. O en efectivo\.$/);
  assert.deepEqual(avisados(soloLlave), ['cuenta']);
});

test('el aviso al mesero FALLA (red, 401 de una función con JWT, 429, tope, 500, tiempo): el QR y la llave siguen a la vista, se explica y «Avisar de nuevo» (forzado) lo reintenta', async () => {
  const fallos = [
    ['sin red', 'red', /sin conexión.*toca «avisar de nuevo»/i],
    ['401 (la función con «Verify JWT» encendido)', { status: 401, body: { error: 'Invalid JWT' } }, /no pudimos avisar al mesero/i],
    ['429', { status: 429, body: { error: 'demasiadas solicitudes' } }, /mucha gente avisando.*toca «avisar de nuevo»/i],
    ['429 «tope» (ya se avisó varias veces)', { status: 429, body: { error: 'demasiadas solicitudes', codigo: 'tope' } }, /ya le avisamos varias veces al mesero/i],
    ['500', { status: 500, body: { error: 'boom' } }, /no pudimos avisar al mesero/i],
    ['tiempo agotado', 'lento', /la red tardó demasiado.*toca «avisar de nuevo»/i],
  ];
  for (const [nombre, falla, texto] of fallos) {
    const h = await conCarta();
    await h.iniciar(); await h.abrir();
    h.mundo.alerta = falla;
    h.c.pedirPago();
    await h.avanzar(9000);
    assert.equal(h.c.pago.vista, 'pagando', `${nombre}: el QR sigue a la vista`);
    assert.equal(h.c.pagando, true);
    assert.equal(h.c.pago.aviso, 'error', nombre);
    assert.match(h.c.pago.error, texto, nombre);
    assert.equal(h.c.pago.metodo, null, `${nombre}: nada quedó «avisado»`);
    assert.equal(h.c.pago.enviando, null, `${nombre}: el botón «Avisar de nuevo» queda libre`);
    assert.ok(h.c.qrDibujo.ruta, `${nombre}: el QR sigue dibujado`);
    assert.equal(h.llamadas.alerta.length, 1, `${nombre}: no se reintenta solo`);
    await h.avanzar(60000);
    assert.equal(h.llamadas.alerta.length, 1, `${nombre}: ni pasado un minuto`);
    // «Avisar de nuevo» = avisarPago(metodo || 'cuenta', true): con la función ya buena, queda avisado y sigue en la pantalla.
    h.mundo.alerta = null;
    await avisar(h, h.c.pago.metodo || 'cuenta', 300, true); await h.avanzar(200);
    assert.deepEqual([h.c.pago.aviso, h.c.pago.error, h.c.pago.metodo, h.c.pago.vista], ['ok', '', 'cuenta', 'pagando'], `${nombre}: al reintentar, queda avisado y sigue en la pantalla`);
    assert.equal(h.llamadas.alerta.length, 2);
  }
});

test('409 al avisar (la cuenta cerró): se vuelve a leer y la hoja lo muestra, sin QR ni llave sueltos', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  h.mundo.alerta = { status: 409, body: { error: 'sin cuenta' } };
  h.mundo.cerrar();
  await abrirPago(h, 2000);
  assert.equal(h.c.cuenta.estado, 'cerrada', 'la orden que se miraba ya cerró');
  assert.equal(h.c.pago.vista, 'inicio', 'sin cuenta abierta todo se olvida');
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.pagando, false, 'y la pantalla de pago ya no se pinta');
  assert.equal(h.c.qrDibujo.ruta, '', 'y el QR no queda dibujado sin cuenta');
});

test('«Volver a la cuenta» y «Ver cómo pagar»: volver deja la tarjeta «Listo» (avisado), «Ver cómo pagar» reabre la pantalla SIN avisar otra vez; si el aviso falló, volver deja «Pagar» y abrirla de nuevo sí avisa', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  h.c.volverDePago();
  assert.deepEqual([h.c.pago.vista, h.c.pago.aviso, h.c.pagoEnCuerpo, h.c.pago.metodo], ['listo', '', false, 'cuenta'], '«Volver a la cuenta» deja «Listo, le avisamos al mesero»');
  assert.equal(h.c.metodoPago, null, 'y, con «cuenta», sin «Vas a pagar con …»');
  h.c.verPago(); await h.avanzar(200);
  assert.deepEqual([h.c.pago.vista, h.c.pago.aviso, h.c.pagando], ['pagando', 'ok', true], '«Ver cómo pagar» reabre la pantalla');
  assert.equal(h.llamadas.alerta.length, 1, 'volver a mirarla no avisa de nuevo');
  h.c.volverDePago(); h.c.verPagoBreb(); await h.avanzar(200);
  assert.equal(h.c.pago.vista, 'pagando', 'verPagoBreb sigue siendo un alias');
  assert.equal(h.llamadas.alerta.length, 1);
  // Ya avisado el efectivo: la tarjeta lo dice.
  await avisar(h, 'efectivo'); await h.avanzar(200);
  h.c.volverDePago();
  assert.deepEqual([h.c.pago.vista, h.c.metodoPago.con], ['listo', 'efectivo']);
  // Si el aviso falló, «Volver a la cuenta» deja el botón «Pagar» del principio (no hay nada avisado), y abrirla otra vez avisa.
  const f = await conCarta();
  await f.iniciar(); await f.abrir();
  f.mundo.alerta = { status: 500, body: {} };
  await abrirPago(f, 300);
  assert.equal(f.c.pago.aviso, 'error');
  f.c.volverDePago();
  assert.deepEqual([f.c.pago.vista, f.c.pago.metodo], ['inicio', null]);
  f.mundo.alerta = null;
  await abrirPago(f, 300);
  assert.deepEqual(avisados(f), ['cuenta', 'cuenta'], 'como no quedó nada avisado, «Pagar» vuelve a avisar');
  assert.deepEqual([f.c.pago.vista, f.c.pago.metodo, f.c.pago.aviso], ['pagando', 'cuenta', 'ok']);
});

test('si el admin apaga Bre-B mientras alguien mira la pantalla de pago, la siguiente lectura le quita el QR y la llave (queda «el mesero te lleva…» y el efectivo) sin dejar nada dibujado, y la pantalla NO se cierra', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  assert.equal(h.c.pagando, true);
  h.cambio((m) => { m.pagoBreb = null; m.agregar('Agua', 3000); });
  await h.avanzar(2000);
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.pagando, true, 'la pantalla sigue abierta: el aviso y el efectivo no dependen de Bre-B');
  assert.deepEqual([h.c.pago.vista, h.c.pago.metodo], ['pagando', 'cuenta'], 'y el aviso que ya salió sigue valiendo');
  assert.equal(h.c.qrDibujo.ruta, '');
  assert.equal(h.c.brebLlave, '');
  assert.equal(h.c.subtituloPago, 'El mesero te lleva el QR o los datos para transferir. O en efectivo.');
  // Al revés: lo encienden y aparece sin recargar.
  h.cambio((m) => { m.pagoBreb = { ...BREB }; m.agregar('Agua', 3000); });
  await h.avanzar(2000);
  assert.deepEqual(plano(h.c.pagoBreb), plano(BREB));
  assert.equal(h.c.brebLlave, LLAVE_FICTICIA);
  // Cambian la llave y el QR (juntos: la llave es la que cobra el QR): la carta usa los nuevos.
  h.cambio((m) => { m.pagoBreb = { llave: LLAVE_OTRA_FICTICIA, qr: QR_FICTICIO_CORTO }; m.agregar('Agua', 3000); });
  await h.avanzar(2000);
  assert.equal(h.c.brebLlave, LLAVE_OTRA_FICTICIA);
  assert.equal(h.c.brebQr, QR_FICTICIO_CORTO);
});

// HALLAZGO (2026-10-04): lo deja anotado y reproducible, sin arreglarlo (no es de esta tarea de pruebas). `{ todo }`: se ejecuta y se ve, pero su fallo no tumba la suite;
// cuando carta.html lo arregle, quitar la opción `todo`.
test('si los datos de Bre-B llegan con la pantalla de pago YA abierta (el admin los enciende, o la primera lectura no los traía), el generador del QR se baja y el QR se dibuja', {
  todo: 'carta.html: _asegurarQr() solo se llama desde pedirPago(); con la pantalla abierta y datos que llegan después, el QR se queda en «Preparando el código…» para siempre (qrFalla nunca sube)',
}, async () => {
  const h = await conCarta({ pagoBreb: null });
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  assert.equal(h.c.pagando, true);
  assert.equal(h.qrcode.scripts.length, 0, 'sin QR que dibujar no se bajó el generador');
  h.cambio((m) => { m.pagoBreb = { ...BREB }; m.agregar('Agua', 3000); });
  await h.avanzar(3000);
  assert.ok(h.c.brebQr, 'el QR llegó con la lectura');
  await h.avanzar(1000);
  assert.equal(h.qrcode.scripts.length, 1, 'la pantalla abierta pide el generador al aparecer el QR');
  assert.ok(h.c.qrDibujo.ruta, 'y lo dibuja');
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
  await abrirPago(roto); await roto.avanzar(500);
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
  assert.deepEqual(avisados(h), ['transferencia'], 'copiar la llave avisa «transferencia» (con «Pagar» de por medio, afina el «cuenta»: ver arriba)');

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
    assert.deepEqual(plano(x.llamadas.alerta), [], `${modo}: si no se pudo copiar, no se avisa nada`);
  }
  // Sin llave no hay nada que copiar.
  const sinLlave = await conCarta({ pagoBreb: { llave: null, qr: QR_FICTICIO } });
  await sinLlave.iniciar(); await sinLlave.abrir();
  await sinLlave.c.copiarLlave();
  assert.deepEqual(sinLlave.copiado.textos, []);
  assert.deepEqual(plano(sinLlave.llamadas.alerta), [], 'sin llave no hay nada que copiar ni que afinar');
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
  // Ni «Pagar» (pedirPago) avisa sola con la función apagada, y la pantalla de pago no se pinta.
  await abrirPago(h);
  assert.deepEqual(h.llamadas.alerta, []);
  assert.equal(h.c.pagando, false);
});

test('el contenido del QR y la llave nunca se piden a otro lado ni se mandan a ningún servidor: la única red de «Pagar con Bre-B» es el POST de siempre a `alerta` (sin la llave ni el QR)', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  await h.c.copiarLlave(); await h.c.copiarValor(); await h.avanzar(300);
  await avisar(h, 'efectivo');
  h.c.volverDePago(); h.c.verPago(); await h.avanzar(300);
  await avisar(h, 'cuenta', 300, true);
  const cuerpos = h.llamadas.alerta.map((a) => JSON.stringify(a.cuerpo)).join('|');
  assert.ok(!cuerpos.includes(LLAVE_FICTICIA) && !cuerpos.includes('000201'));
  assert.deepEqual(h.llamadas.cuenta.every((l) => l.url.includes('/functions/v1/cuenta?')), true);
  // Ninguna URL lleva la llave ni el contenido (sería un dato de pago en un registro de acceso).
  for (const l of [...h.llamadas.cuenta, ...h.llamadas.alerta]) {
    assert.ok(!l.url.includes(encodeURIComponent(LLAVE_FICTICIA)) && !l.url.includes('000201'), l.url);
  }
});

test('«no se inventa»: con una `cuenta` cuyo `pago.breb` trae basura (otro tipo, vacío, demasiado largo), no hay QR ni llave: la pantalla dice que el mesero lleva los datos', async () => {
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
    assert.equal(h.c.breb, null);
    await abrirPago(h, 300);
    assert.equal(h.c.pagando, true, 'la pantalla abre (con el efectivo y el aviso) aunque los datos no sirvan');
    assert.equal(h.c.subtituloPago, 'El mesero te lleva el QR o los datos para transferir. O en efectivo.');
    assert.equal(h.qrcode.scripts.length, 0);
  }
});

test('el cambio de contrato queda dicho: la carta ya no promete «nunca muestra datos de pago» y el comentario de local.js tampoco', () => {
  for (const archivo of ['carta.html', 'assets/js/local.js']) {
    assert.doesNotMatch(sinComentarios(leer(archivo)), /nunca muestra datos/i);
    assert.doesNotMatch(leer(archivo), /esta página nunca muestra datos bancarios ni un QR|la página nunca muestra\s+datos bancarios ni QR/i, archivo);
  }
});

// ───────────────────────── 4. refutación (2026-10-02) y crítica visual ─────────────────────────

test('R2: la llave que se muestra TIENE que ser la que cobra el QR (campo 26/04): llaveDelQrBreb lee los campos y coincide con la regla escrita aparte en cada vector', async () => {
  const h = await conCarta();
  for (const [nombre, qr, esperada] of llaveQrVectores()) {
    assert.equal(h.caja.llaveDelQrBreb(qr) || 'null', esperada, nombre);
    assert.equal(reglaDeLaLlave(qr) ?? 'null', esperada, `${nombre} (la regla de las pruebas)`);
  }
  for (const malo of [null, undefined, 7, {}, '', ' ', 'x'.repeat(30)]) assert.equal(h.caja.llaveDelQrBreb(malo), '', String(malo));
});

test('R2: con la llave de una cosa y el QR de otra la carta NO muestra nada (ni la llave, ni el QR, ni el WhatsApp): la pantalla sin datos, con el efectivo', async () => {
  const casos = [
    ['el QR cobra a otra llave', { llave: LLAVE_FICTICIA, qr: QR_FICTICIO_CORTO }],
    ['la llave que empieza igual que la que cobra', { llave: LLAVE_VISIBLE, qr: QR_COBRA_A_OTRA }],
    ['la llave solo está metida en el 62/07', { llave: LLAVE_VISIBLE, qr: QR_COBRA_A_OTRA_CON_LA_VISIBLE_EN_62 }],
  ];
  for (const [nombre, breb] of casos) {
    const h = await conCarta({ pagoBreb: breb });
    await h.iniciar(); await h.abrir();
    assert.equal(h.c.pagoBreb, null, nombre);
    assert.equal(h.c.brebLlave, '', nombre);
    assert.equal(h.c.qrDibujo.ruta, '', nombre);
    assert.equal(h.c.subtituloPago, 'El mesero te lleva el QR o los datos para transferir. O en efectivo.', `${nombre}: sin datos, el mesero los lleva`);
    assert.equal(h.c.tieneDatos('qr') || h.c.tieneDatos('transferencia'), false, nombre);
  }
  // Y el par que SÍ cuadra pasa (control: la regla no bloquea lo bueno).
  const cuadra = await conCarta({ pagoBreb: { llave: LLAVE_OTRA, qr: QR_COBRA_A_OTRA } });
  await cuadra.iniciar(); await cuadra.abrir();
  assert.deepEqual(plano(cuadra.c.pagoBreb), { llave: LLAVE_OTRA, qr: QR_COBRA_A_OTRA });
});

test('R4: una lectura en la que la función NO pudo leer `ajustes` (`pago_desconocido`) no le quita el QR a quien lo mira: se queda con lo que ya había, y «apagado» de verdad sí se lo quita (la pantalla sigue, sin datos)', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  assert.equal(h.c.pago.vista, 'pagando');
  const antes = h.c.pagoBreb;
  const totalAntes = h.c.cuenta.total;
  // La lectura siguiente: sin `pago` y con `pago_desconocido: true` (un corte de la base).
  h.cambio((m) => { m.pagoBreb = null; m.pagoDesconocido = true; m.agregar('Agua', 3000); });
  await h.avanzar(1000);
  assert.equal(h.c.pago.vista, 'pagando', 'sigue en la pantalla');
  assert.equal(h.c.pagoBreb, antes, 'el mismo objeto: ni se repinta el QR');
  assert.ok(h.c.qrDibujo.ruta, 'y el QR sigue dibujado');
  assert.equal(h.c.cuenta.total, totalAntes + 3000, 'la cuenta sí se actualizó (esa lectura trajo un producto más)');
  // Vuelve el dato: sigue igual.
  h.cambio((m) => { m.pagoBreb = { ...BREB }; m.pagoDesconocido = false; m.agregar('Agua', 3000); });
  await h.avanzar(1000);
  assert.equal(h.c.pago.vista, 'pagando');
  assert.ok(h.c.qrDibujo.ruta);
  // «Apagado» de verdad (sin `pago` y SIN `pago_desconocido`): ahí sí se quedan sin QR ni llave; la pantalla sigue (el efectivo y el aviso no dependen de Bre-B).
  h.cambio((m) => { m.pagoBreb = null; m.pagoDesconocido = false; m.agregar('Agua', 3000); });
  await h.avanzar(1000);
  assert.equal(h.c.pagoBreb, null);
  assert.equal(h.c.qrDibujo.ruta, '', 'el QR ya no se dibuja');
  assert.equal(h.c.pagando, true, 'la pantalla sigue, con «el mesero te lleva el QR o los datos»');
  // Y si la PRIMERA lectura de la sesión viene «desconocida», no hay nada que conservar: sin pago, sin inventar.
  const nueva = await conCarta({ pagoBreb: null });
  nueva.mundo.pagoDesconocido = true;
  await nueva.iniciar(); await nueva.abrir();
  assert.equal(nueva.c.pagoBreb, null);
  assert.equal(nueva.c.breb, null);
  assert.equal(nueva.c.subtituloPago, 'El mesero te lleva el QR o los datos para transferir. O en efectivo.');
});

test('el valor: la pantalla lo dice en el subtítulo (en vivo, con «$» y la cifra pegados), lo muestra con «Copiar valor» y copia SOLO dígitos', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  const total = h.c.cuenta.total;
  assert.ok(total > 0);
  assert.equal(h.c.valorPagar, total);
  await abrirPago(h);
  const pesos = h.c.pesos(total).replace('$ ', '$ ');
  assert.equal(h.c.subtituloPago, `Desde tu app del banco, con ${pesos}: escanea el QR con otro celular o copia la llave. O en efectivo.`);
  assert.doesNotMatch(h.c.subtituloPago, /mismo celular|con la app de tu banco y paga el total/, 'no promete que se escanea con el mismo celular');
  await h.c.copiarValor(); await h.avanzar(300);
  assert.deepEqual(h.copiado.textos, [String(total)], 'solo dígitos: sin «$», sin el punto de miles, sin espacios');
  assert.match(h.copiado.textos[0], /^\d+$/);
  assert.deepEqual([h.c.pago.copiadoValor, h.c.pago.copiado, h.c.pago.copiaError], [true, false, false]);
  assert.equal(h.c.pago.metodo, 'transferencia', 'copiar el valor también afina el aviso a «transferencia»');
  await h.avanzar(3100);
  assert.deepEqual([h.c.pago.copiadoValor, h.c.pago.copiaError], [false, false]);
  // Copiar la llave después no deja «Valor copiado» a medias.
  await h.c.copiarValor(); await h.c.copiarLlave();
  assert.deepEqual([h.c.pago.copiadoValor, h.c.pago.copiado], [false, true]);
  // El valor sigue a la cuenta en vivo.
  h.cambio((m) => m.agregar('Jugo', 6000));
  await h.avanzar(1500);
  assert.equal(h.c.valorPagar, total + 6000);
  assert.ok(h.c.subtituloPago.includes(h.c.pesos(total + 6000).replace('$ ', '$ ')), 'el subtítulo se actualiza con la cuenta');
  // Sin QR (solo la llave) el subtítulo es el suyo: copiar la llave y escribir el valor.
  const soloLlave = await conCarta({ pagoBreb: { llave: LLAVE_FICTICIA, qr: null } });
  await soloLlave.iniciar(); await soloLlave.abrir();
  assert.equal(soloLlave.c.subtituloPago, `Desde tu app del banco, con ${soloLlave.c.pesos(soloLlave.c.cuenta.total).replace('$ ', '$ ')}: copia la llave. O en efectivo.`);
});

test('sin nada que pagar (cuenta en cero) no hay «Valor» ni «Copiar valor», y el subtítulo no inventa una cifra', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  h.c.cuenta.total = 0;
  assert.equal(h.c.valorPagar, 0);
  assert.doesNotMatch(h.c.subtituloPago, /\$/);
  assert.equal(h.c.subtituloPago, 'Desde tu app del banco: escanea el QR con otro celular o copia la llave. O en efectivo.');
  await h.c.copiarValor();
  assert.deepEqual(h.copiado.textos, [], 'no copia nada');
  h.c.cuenta.total = -5000;
  assert.equal(h.c.valorPagar, 0, 'un total negativo (abonos de más) tampoco es un valor a pagar');
});

test('la pastilla de conexión se esconde SOLO en la pantalla de pago y SOLO si no dice algo malo (sin conexión, demasiadas consultas)', async () => {
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  assert.equal(h.c.verPastilla, true, 'fuera del pago siempre se ve');
  await abrirPago(h);
  assert.equal(h.c.pagando, true);
  assert.equal(h.c.verPastilla, false, 'en la pantalla de pago, «Se actualiza cada 20 s» no aporta y se esconde');
  h.c.limitado = true;
  assert.equal(h.c.verPastilla, true, 'pero «Muchas consultas, reintentando…» sí se ve');
  h.c.limitado = false;
  h.c._red = 'caida';
  assert.equal(h.c.conexion, 'sin_red');
  assert.equal(h.c.verPastilla, true, 'y «Sin conexión» también: la verdad no se esconde');
  h.c._red = 'ok';
  h.c.volverDePago();
  assert.equal(h.c.verPastilla, true, 'al volver a la cuenta, otra vez a la vista');
});

test('el marcado de la pantalla de pago: UNA salida hacia atrás («←», con nombre «Volver a la cuenta»), sin «Volver» ni «Cambiar método», y el comprobante pegado abajo (sticky)', () => {
  const crudo = sinComentarios(leer('carta.html'));
  const pago = crudo.slice(crudo.indexOf('<div id="pago-breb">'), crudo.indexOf('<div x-show="!pagoEnCuerpo">'));
  assert.ok(pago.length > 1500, 'no encontré el bloque de pago');
  assert.doesNotMatch(pago, />\s*Volver\s*</, 'sin «Volver» suelto en la pantalla de pago');
  assert.doesNotMatch(pago, /Cambiar método|cambiarMetodo/, 'ya no hay método que cambiar');
  assert.equal((pago.match(/@click="volverDePago\(\)"/g) || []).length, 1, 'una sola salida hacia atrás');
  assert.match(pago, /id="pago-cambiar-breb"[^>]*aria-label="Volver a la cuenta"[^>]*title="Volver a la cuenta"/);
  assert.match(pago, /class="btn-icon[^"]*"[^>]*id="pago-cambiar-breb"|id="pago-cambiar-breb" class="btn-icon/);
  assert.match(pago, /class="breb-comprobante" id="pago-comprobante-bloque"/);
  const css = leer('assets/css/carta-menu.css');
  assert.match(css, /\.breb-comprobante\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/);
  assert.match(css, /\.breb-comprobante\s*\{[^}]*background:\s*var\(--color-papel\)/, 'opaco: tapa lo que pasa por debajo');
  assert.match(css, /@media \(max-width: 1023px\)\s*\{\s*\.cuenta-hoja--pago\s*\{\s*max-height:\s*94vh;\s*max-height:\s*94dvh;/, 'la hoja sube al 94 % en celular');
  // La hoja y la cabecera saben que se está pagando.
  assert.match(crudo, /:class="pagandoBreb \? 'cuenta-hoja--pago' : ''"/);
  assert.match(crudo, /:class="pagandoBreb \? 'cuenta-cabeza--pago' : ''"/);
  // El cuerpo no tiene relleno abajo en ese modo: el sticky queda pegado al pie de verdad.
  assert.match(crudo, /class="cuenta-cuerpo px-5 overflow-y-auto flex-1" :class="pagandoBreb \? 'pb-0' : 'pb-3'"/);
});

test('el comprobante por WhatsApp también está en la tarjeta «Listo, le avisamos» (quien ya pagó y volvió no tiene que reabrir la pantalla), solo con datos de Bre-B, dentro de las plantillas de pagarEnMesa, y es el mismo enlace', async () => {
  const crudo = sinComentarios(leer('carta.html'));
  assert.match(crudo, /id="pago-comprobante-listo"[^>]*x-show="comprobanteUrl && breb"[^>]*:href="comprobanteUrl \|\| null"[^>]*target="_blank"[^>]*rel="noopener"/);
  const h = await conCarta();
  await h.iniciar(); await h.abrir();
  await abrirPago(h);
  h.c.volverDePago();
  assert.equal(h.c.pago.vista, 'listo');
  assert.ok(h.c.breb, 'la tarjeta «Listo» con datos de Bre-B muestra el botón');
  assert.match(h.c.comprobanteUrl, /^https:\/\/wa\.me\/57\d{10}\?text=/);
  // Sin datos de Bre-B no hay a qué comprobante enviar: el botón no sale (la condición del marcado es `comprobanteUrl && breb`).
  const sin = await conCarta({ pagoBreb: null });
  await sin.iniciar(); await sin.abrir();
  await abrirPago(sin);
  sin.c.volverDePago();
  assert.equal(Boolean(sin.c.comprobanteUrl && sin.c.breb), false);
});

test('el QR dice la verdad sobre cómo se paga con él: «para escanear con OTRO celular», nunca «con la app de tu banco» a secas', () => {
  const crudo = sinComentarios(leer('carta.html'));
  assert.doesNotMatch(crudo, /Escanéalo con la app de tu banco/);
  assert.match(crudo, /id="pago-qr-pie">QR de Bre-B · para escanear con otro celular</, 'el pie del QR lo dice');
  assert.match(crudo, /escanea el QR con otro celular/, 'y el subtítulo también');
  assert.doesNotMatch(crudo, /Escanéalo con otro celular y escribe/, 'el subtítulo de antes (con «Si es el mismo, usa la llave») ya no existe');
});

