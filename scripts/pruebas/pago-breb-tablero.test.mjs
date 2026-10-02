// «Pago con Bre-B» en el tablero de Administración (pos.html → Ajustes; tarea pago-breb, parte TABLERO). El admin pega la llave y el CONTENIDO del
// QR de pago del restaurante (el texto EMV, no una imagen), con la opción de leerlo de una foto si el navegador sabe (BarcodeDetector); el POS
// comprueba el formato EMV y el CRC (las MISMAS reglas que la base y que la carta) antes de guardar, dibuja el QR como lo verá el cliente y
// guarda con `.update({ pago_breb_* }).eq('id', 1)` como el resto de los ajustes. Solo el admin. Nada fijo en el código ni en la tablet.
//
// Esta prueba corre siempre (sin navegador): el <script> REAL de pos.html en un `vm` contra la base falsa de _pos-vm.mjs, más lo estático del marcado.
// El comportamiento de la pantalla, en Chromium, está en pago-breb-tablero-navegador.test.mjs. Los datos son los FICTICIOS de _breb-ficticio.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  RAIZ, TOKEN, asentar, crearBaseFalsa, crearPos, hastaQue, mesaBase, plano,
} from './_pos-vm.mjs';
import { decodificarQr, matrizDeSvgConMargen } from './_qr-decodificar.mjs';
import { LLAVE_FICTICIA, QR_FICTICIO, QR_FICTICIO_CORTO, VECTORES_LLAVE, VECTORES_QR, reglaDelContenido } from './_breb-ficticio.mjs';

const POS_HTML = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const LIBRERIA = fs.readFileSync(path.join(RAIZ, 'assets/vendor/qrcode-generator-1.4.4.js'), 'utf8');
const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const FILA = { id: 1, ticket_qr_url: 'https://resplandor.ynt.codes/', ticket_qr_visible: true, ticket_pie: 'Gracias por su visita', pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null };
const sinComentarios = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const sinLineas = (js) => js.replace(/(^|\s)\/\/[^\n]*/g, '$1');   // los comentarios `// …` de un script (no toca «https://»)

/** La tarjeta «Pago con Bre-B»: de su marca de inicio a la de fin (dentro de la vista de Ajustes). */
const TARJETA = (() => {
  const i = POS_HTML.indexOf('<!-- ▼ PARTE pago-breb :: ajustes -->');
  const f = POS_HTML.indexOf('<!-- ▲ PARTE pago-breb :: ajustes -->');
  assert.ok(i > 0 && f > i, 'no encontré las marcas de la parte pago-breb en pos.html');
  return POS_HTML.slice(i, f);
})();

// ───────────────────────── montaje (el de pos-ola-c.test.mjs, más corto) ─────────────────────────

function montar({ rol = 'admin', ajustes = [FILA], extras = {}, libreria = true } = {}) {
  const base = crearBaseFalsa({ rol, mesas: [mesaBase(3)], olaC: true, ajustes });
  const almacen = new Map();
  const temporizadores = [];
  const reales = { setTimeout, clearTimeout };
  const t = crearPos({
    base, almacen,
    extras: {
      setInterval() { return 0; },
      clearInterval() {},
      setTimeout(fn, ms, ...resto) {
        if (ms >= 1500) { const h = { fn, ms, cancelado: false, unref() { return h; } }; temporizadores.push(h); return h; }
        return reales.setTimeout(fn, ms, ...resto);
      },
      clearTimeout(h) { if (h && typeof h === 'object' && 'cancelado' in h) h.cancelado = true; else reales.clearTimeout(h); },
      ...extras,
    },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  t.base = base; t.temporizadores = temporizadores;
  t.pos.usuario = YO;
  if (libreria) vm.runInContext(LIBRERIA, t.caja, { filename: 'assets/vendor/qrcode-generator-1.4.4.js' });
  t.disparar = (ms) => {
    const hechos = temporizadores.filter((h) => h.ms === ms && !h.cancelado);
    for (const h of hechos) { h.cancelado = true; h.fn(); }
    return hechos.length;
  };
  t.escrituras = () => t.supabase.de('ajustes', 'update');
  return t;
}
async function listo(t) {
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  if (t.pos.esAdmin) await hastaQue(() => t.pos._personalCargado);
  await asentar();
  return t;
}
const COLUMNAS_BREB = ['pago_breb_llave', 'pago_breb_qr', 'pago_breb_visible'];

// ───────────────────────── 1. estática: el marcado ─────────────────────────

test('la tarjeta «Pago con Bre-B» vive DENTRO de la vista de Ajustes, que es solo del admin (x-show con puede(\'ajustes\')), tras la tarjeta del ticket', () => {
  const ini = POS_HTML.indexOf('<!-- ▼ PARTE ola-c-c3 :: ajustes -->');
  const fin = POS_HTML.indexOf('<!-- ▲ PARTE ola-c-c3 :: ajustes -->');
  const vista = POS_HTML.slice(ini, fin);
  assert.ok(vista.includes(TARJETA), 'la tarjeta está dentro de las marcas de la vista de Ajustes');
  assert.match(vista, /<section x-show="\$store\.pos\.vista === 'ajustes' && \$store\.pos\.puede\('ajustes'\)"/, 'la vista solo se ve con el permiso «ajustes»');
  assert.ok(vista.indexOf('Dirección del QR') < vista.indexOf('Pago con Bre-B'), 'va después del ticket');
  const puede = POS_HTML.match(/puede\(accion\) \{[\s\S]*?\n            \},/)[0];
  assert.match(puede, /case 'mesas_admin': case 'ajustes':[\s\S]*return this\.rol === 'admin'/, 'el permiso «ajustes» es solo del admin');
});

test('la tarjeta trae lo pedido: interruptor «Mostrar en la carta», campo Llave, «Contenido del QR» (para pegar), «Leer desde una foto del QR», validación y vista previa con la llave debajo', () => {
  const visible = sinComentarios(TARJETA);
  assert.match(visible, /<h2 class="titulo-panel mb-1" id="breb-titulo">Pago con Bre-B<\/h2>/);
  assert.match(visible, /role="switch"[\s\S]*aria-labelledby="breb-visible-etiqueta"/);
  assert.match(visible, /id="breb-visible-etiqueta">Mostrar en la carta</);
  assert.match(visible, /<label class="field-label text-label mt-4" for="breb-llave">Llave<\/label>/);
  assert.match(visible, /<textarea id="breb-qr"[^>]*x-model="bQr"/);
  assert.match(visible, /<label class="field-label text-label mt-4" for="breb-qr">Contenido del QR<\/label>/);
  assert.match(visible, /Leer desde una foto del QR/);
  assert.match(visible, /<input id="breb-foto" type="file" accept="image\/\*"/);
  assert.match(visible, /Este navegador no sabe leer un QR desde una foto\. Escanea el QR con otra app/, 'sin BarcodeDetector la ayuda dice cómo copiar el contenido');
  assert.match(visible, /Formato EMV y CRC correctos/);
  assert.match(visible, /Así lo ve el cliente en la carta/);
  assert.match(visible, /Llave: <span class="font-semibold" x-text="llave"><\/span>/, 'la llave va bajo el QR de la vista previa');
  assert.match(visible, /guardarPagoBreb\(\{ visible: bVisible, llave: bLlave, qr: bQr \}\)/, 'guardar manda el contrato');
  assert.match(visible, /Guardar pago con Bre-B/);
});

test('la tarjeta no usa x-html, ni estilos en línea, ni diálogos nativos, ni emojis; el <svg> de la vista previa es fijo y solo enlaza viewBox, ancho, alto y trazo', () => {
  const visible = sinComentarios(TARJETA);
  assert.doesNotMatch(visible, /x-html|innerHTML|\sstyle="/);
  assert.doesNotMatch(visible, /\b(alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(visible, /\p{Extended_Pictographic}/u);
  const svg = visible.match(/<svg\b[\s\S]*?<\/svg>/)[0];
  assert.match(svg, /:view-box\.camel="'0 0 ' \+ dibujo\.lado \+ ' ' \+ dibujo\.lado"/);
  assert.match(svg, /<rect fill="white" :width="dibujo\.lado" :height="dibujo\.lado"\/>/);
  assert.match(svg, /<path fill="black" :d="dibujo\.ruta"\/>/);
  assert.match(svg, /aria-hidden="true"/);
  // El dibujo tiene una descripción para quien no lo ve.
  assert.match(visible, /:aria-label="'Código QR de Bre-B para pagar' \+ \(llaveOk && llave \? ' a la llave ' \+ llave : ''\)"/);
});

test('los controles de la tarjeta miden ≥ 44 px (campos .field, botones .btn-*, interruptor) y nada fija un ancho que desborde', () => {
  const css = POS_HTML.slice(POS_HTML.indexOf('/* ── Ajustes: «Pago con Bre-B» ──'), POS_HTML.indexOf('/* El dibujo del QR (qrTicketSvg)'));
  assert.ok(css.length > 300, 'no encontré el CSS de Bre-B');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'ningún hex nuevo (blanco y negro son colores con nombre; el resto, tokens)');
  assert.match(css, /\.breb-contenido \{[^}]*overflow-wrap: anywhere/, 'el contenido (una sola palabra larguísima) se parte, no desborda');
  assert.match(css, /\.breb-previa-llave \{[^}]*overflow-wrap: anywhere/, 'y la llave también');
  assert.doesNotMatch(css.replace(/max-width:[^;]+;/g, ''), /(^|[^-])width:\s*\d+(px|rem)\b/, 'sin anchos fijos (solo topes con max-width)');
  assert.match(POS_HTML, /--pos-tactil:\s*2\.75rem/, 'la medida táctil del POS sigue siendo 44 px');
  for (const clase of ['btn-primary', 'btn-secondary', 'btn-lg']) assert.match(POS_HTML, new RegExp(`\\.${clase}\\b[^{]*\\{[^}]*min-height`), `.${clase} fija su alto mínimo`);
});

test('ningún dato de pago real o puesto a mano en pos.html: ni contenido EMV, ni la red de pagos, ni una llave', () => {
  assert.doesNotMatch(POS_HTML, /0002010102(11|12)\d\d/);
  assert.doesNotMatch(POS_HTML, /CO\.COM\.RBM/);
  assert.doesNotMatch(sinLineas(sinComentarios(POS_HTML)), /@[a-z0-9._-]{4,}['"`]\s*[,;)]/i, 'una llave alfanumérica entre comillas');
});

// ───────────────────────── 2. las reglas (las mismas que la carta y que la base) ─────────────────────────

test('motivoQrBreb y llaveBrebValida del POS coinciden, vector por vector, con la regla escrita aparte en las pruebas (y con la de la carta)', async () => {
  const t = await listo(montar());
  for (const [nombre, texto, sirve] of VECTORES_QR) {
    // El POS recorta los espacios y saltos de los lados (lo que deja un pegado) ANTES de aplicar la regla; la carta y la base reciben el valor tal cual.
    const motivo = t.pos.motivoQrBreb(texto);
    const recortado = typeof texto === 'string' ? texto.trim() : texto;
    assert.equal(motivo === '', typeof texto === 'string' ? reglaDelContenido(recortado) === null : false, `${nombre}: ${motivo}`);
    if (typeof texto !== 'string' || texto === recortado) assert.equal(motivo === '', sirve, nombre);
    assert.equal(reglaDelContenido(texto) === null, sirve, `${nombre} (la regla de las pruebas)`);
  }
  for (const [llave, sirve] of VECTORES_LLAVE) {
    if (typeof llave === 'string' && llave !== llave.trim()) continue;   // el POS recorta los lados (un pegado); la base y la carta no
    assert.equal(t.pos.llaveBrebValida(llave), sirve, JSON.stringify(llave));
  }
  assert.equal(t.pos.llaveBrebValida(' @prueba.ficticia \n'), true, 'el POS recorta los lados de lo que se pega');
  // La carta tiene su copia de las mismas reglas: tienen que decir lo mismo.
  const { crearCarta } = await import('./_carta-vm.mjs');
  const carta = await crearCarta();
  for (const [nombre, texto, sirve] of VECTORES_QR) assert.equal(carta.caja.qrBrebValido(texto), sirve, `carta: ${nombre}`);
  for (const [llave, sirve] of VECTORES_LLAVE) assert.equal(carta.caja.llaveBrebValida(llave), sirve, `carta: ${JSON.stringify(llave)}`);
  // Un barrido de mutaciones: cada carácter cambiado del contenido bueno rompe el CRC (en la carta, en el POS y en la regla de las pruebas).
  for (let i = 0; i < QR_FICTICIO.length - 4; i += 7) {
    const roto = QR_FICTICIO.slice(0, i) + (QR_FICTICIO[i] === '7' ? '8' : '7') + QR_FICTICIO.slice(i + 1);
    assert.notEqual(t.pos.motivoQrBreb(roto), '', `la posición ${i} cambiada tiene que dejar de servir`);
    assert.equal(carta.caja.qrBrebValido(roto), false);
    assert.notEqual(reglaDelContenido(roto), null);
  }
});

test('los mensajes dicen qué pasa (no «inválido» a secas): corto, largo, caracteres, inicio, sin campo 63, CRC y estructura', async () => {
  const t = await listo(montar());
  const m = (x) => t.pos.motivoQrBreb(x);
  assert.match(m('000201'), /muy corto/);
  assert.match(m('0'.repeat(701)), /demasiado largo.*700/);
  assert.match(m(QR_FICTICIO.slice(0, 60) + '\n' + QR_FICTICIO.slice(61)), /saltos de línea, tildes/);
  assert.match(m('https://resplandor.ynt.codes/carta.html?mesa=3'), /empezar por 000201/);
  assert.match(m(QR_FICTICIO.slice(0, -8)), /código de verificación \(campo 63\)/);
  assert.match(m(QR_FICTICIO.slice(0, 50) + 'X' + QR_FICTICIO.slice(51)), /\(CRC\) no cuadra/);
  assert.equal(m(QR_FICTICIO), '');
  assert.equal(m(QR_FICTICIO_CORTO), '');
});

// ───────────────────────── 3. leer y guardar ─────────────────────────

test('cargarPagoBreb: lee SOLO las tres columnas pago_breb_* de la fila 1, lo deja en el store y NO lo guarda en la tablet', async () => {
  const t = await listo(montar({ ajustes: [{ ...FILA, pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }] }));
  assert.equal(await t.pos.cargarPagoBreb(), true);
  const lectura = t.supabase.de('ajustes', 'select').at(-1);
  assert.deepEqual(lectura.columnas.split(',').map((c) => c.trim()).sort(), COLUMNAS_BREB, 'solo esas tres');
  assert.deepEqual(lectura.filtros, [['id', 1, 'eq']]);
  assert.deepEqual(plano(t.pos.pagoBreb), { visible: true, llave: LLAVE_FICTICIA, qr: QR_FICTICIO });
  assert.equal(t.pos.pagoBrebCargado, true);
  assert.equal(t.pos.pagoBrebSinMigracion, false);
  // Ni una sola clave de la tablet lleva la llave ni el contenido del QR (el dato de pago no se queda en un teléfono).
  await t.pos.cargarAjustes();
  const guardado = [...t.almacen.values()].join('\n');
  assert.ok(!guardado.includes(LLAVE_FICTICIA) && !guardado.includes('000201'), 'nada del pago en el almacenamiento de la tablet');
  // El ticket sigue leyéndose con sus tres columnas (cargarAjustes no cambió).
  assert.equal(t.supabase.de('ajustes', 'select').find((c) => c.columnas.includes('ticket_qr_url')).columnas.includes('pago_breb'), false);
});

test('abrir Ajustes (irA) pide los ajustes del ticket y el pago con Bre-B; un mesero no entra ni lee el pago', async () => {
  const t = await listo(montar({ ajustes: [{ ...FILA, pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }] }));
  assert.equal(t.pos.irA('ajustes'), true);
  await hastaQue(() => t.pos.pagoBrebCargado);
  assert.equal(t.pos.vista, 'ajustes');
  assert.equal(t.pos.pagoBreb.llave, LLAVE_FICTICIA);
  const mesero = await listo(montar({ rol: 'mesero', ajustes: [{ ...FILA, pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }] }));
  assert.equal(mesero.pos.irA('ajustes'), false, 'el mesero no abre Ajustes');
  const antes = mesero.supabase.de('ajustes', 'select').length;
  assert.equal(await mesero.pos.cargarPagoBreb(), false, 'ni lo lee por la puerta de atrás');
  assert.equal(mesero.supabase.de('ajustes', 'select').length, antes, 'cero lecturas del pago');
  assert.deepEqual(plano(mesero.pos.pagoBreb), { visible: false, llave: '', qr: '' }, 'y el store del mesero no lo tiene');
  assert.equal(await mesero.pos.guardarPagoBreb({ visible: true, llave: LLAVE_FICTICIA, qr: QR_FICTICIO }), false);
  assert.equal(mesero.pos.pagoBrebError, 'Solo un admin puede cambiar el pago con Bre-B.');
  assert.equal(mesero.escrituras().length, 0, 'ni una escritura');
});

test('cargarPagoBreb sin las columnas (migración sin aplicar): no es un error, la sección lo dice y no guarda', async () => {
  const t = await listo(montar());
  t.base.sinColumnas.add('ajustes.pago_breb_qr');
  assert.equal(await t.pos.cargarPagoBreb(), false);
  assert.equal(t.pos.pagoBrebSinMigracion, true);
  assert.deepEqual(t.consola.filter(([nivel, m]) => nivel === 'warn' && /Bre-B/.test(String(m))), [], 'no es una advertencia: la base es la de antes');
  assert.equal(await t.pos.guardarPagoBreb({ visible: false, llave: LLAVE_FICTICIA, qr: QR_FICTICIO }), false);
  assert.equal(t.pos.pagoBrebError, 'Falta aplicar en la base la migración del pago con Bre-B.');
  assert.equal(t.pos.pagoBrebGuardado, false);
});

test('guardarPagoBreb manda SOLO las tres columnas pago_breb_*, a la fila 1, y deja el store al día; «Guardado» se apaga a los 4 s', async () => {
  const t = await listo(montar());
  assert.equal(await t.pos.guardarPagoBreb({ visible: true, llave: `  ${LLAVE_FICTICIA}  `, qr: `\n${QR_FICTICIO}\n` }), true, 'con espacios y saltos a los lados (lo que deja un pegado)');
  const e = t.escrituras().at(-1);
  assert.deepEqual(plano(e.cuerpo), { pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }, 'ya limpios y solo esas tres');
  assert.deepEqual(e.filtros, [['id', 1, 'eq']], 'update(...).eq(id, 1), como el resto de los ajustes');
  assert.equal(e.retorno, 'id', 'y .select(id) para saber que de verdad tocó la fila');
  assert.deepEqual(plano(t.base.ajustes.get(1)), { ...FILA, pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }, 'el ticket de la fila no se tocó');
  assert.deepEqual(plano(t.pos.pagoBreb), { visible: true, llave: LLAVE_FICTICIA, qr: QR_FICTICIO });
  assert.equal(t.pos.pagoBrebError, '');
  assert.equal(t.pos.pagoBrebGuardado, true);
  assert.equal(t.disparar(4000), 1);
  assert.equal(t.pos.pagoBrebGuardado, false, '«Guardado» se apaga solo');
  const guardado = [...t.almacen.values()].join('\n');
  assert.ok(!guardado.includes(LLAVE_FICTICIA) && !guardado.includes('000201'), 'guardar tampoco deja el dato en la tablet');
  // Apagarlo conserva los datos (el admin puede encenderlo de nuevo sin volver a pegarlos).
  assert.equal(await t.pos.guardarPagoBreb({ visible: false, llave: LLAVE_FICTICIA, qr: QR_FICTICIO }), true);
  assert.deepEqual(plano(t.escrituras().at(-1).cuerpo), { pago_breb_visible: false, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO });
  // Y vaciarlo todo manda null (no cadenas vacías: los check de la base piden NULL o un valor válido).
  assert.equal(await t.pos.guardarPagoBreb({ visible: false, llave: '  ', qr: '' }), true);
  assert.deepEqual(plano(t.escrituras().at(-1).cuerpo), { pago_breb_visible: false, pago_breb_llave: null, pago_breb_qr: null });
  assert.deepEqual(plano(t.pos.pagoBreb), { visible: false, llave: '', qr: '' });
});

test('guardarPagoBreb valida ANTES de mandar nada: llave mala, contenido con el CRC roto, contenido que no es de pago y «mostrar» sin los dos datos', async () => {
  const t = await listo(montar());
  const intenta = async (cambios) => { const r = await t.pos.guardarPagoBreb(cambios); return [r, t.pos.pagoBrebError]; };
  assert.deepEqual(await intenta({ visible: false, llave: '@con espacio', qr: QR_FICTICIO }), [false, 'La llave no es válida: de 2 a 60 caracteres, sin espacios, y tiene que ser «@algo» (letras y números), un número, un celular con +57 o un correo.']);
  for (const llave of ['@', 'x'.repeat(61), '@con"comilla', '@con<tag>', 'sin-arroba']) {
    assert.equal((await intenta({ visible: false, llave, qr: '' }))[0], false, llave);
  }
  const roto = QR_FICTICIO.slice(0, 80) + 'Z' + QR_FICTICIO.slice(81);
  const [ok, msg] = await intenta({ visible: true, llave: LLAVE_FICTICIA, qr: roto });
  assert.equal(ok, false);
  assert.match(msg, /^El contenido del QR no sirve\. El código de verificación \(CRC\) no cuadra/);
  assert.match((await intenta({ visible: false, llave: '', qr: 'hola' }))[1], /muy corto/);
  assert.match((await intenta({ visible: false, llave: '', qr: 'https://ejemplo.test/un-enlace-largo-de-prueba' }))[1], /empezar por 000201/);
  assert.equal((await intenta({ visible: true, llave: LLAVE_FICTICIA, qr: '' }))[1], 'Para mostrarlo en la carta pon la llave y el contenido del QR.');
  assert.equal((await intenta({ visible: true, llave: '', qr: QR_FICTICIO }))[1], 'Para mostrarlo en la carta pon la llave y el contenido del QR.');
  assert.equal(t.escrituras().length, 0, 'nada de eso llegó a la base');
  assert.equal(t.pos.pagoBrebGuardado, false);
  assert.deepEqual(plano(t.pos.pagoBreb), { visible: false, llave: '', qr: '' }, 'y el store no cambió');
  // Solo llave (sin QR) o solo QR (sin llave) se pueden guardar mientras no se muestren (borrador).
  assert.equal((await intenta({ visible: false, llave: LLAVE_FICTICIA, qr: '' }))[0], true);
  assert.equal((await intenta({ visible: false, llave: '', qr: QR_FICTICIO }))[0], true);
});

test('guardarPagoBreb: si la base falla, el valor NO cambia y el motivo queda dicho (sin red, sin permiso, check de la tabla, sin fila, sin migración)', async () => {
  const t = await listo(montar());
  const cambios = { visible: true, llave: LLAVE_FICTICIA, qr: QR_FICTICIO };
  t.base.red = false;
  assert.equal(await t.pos.guardarPagoBreb(cambios), false);
  assert.equal(t.pos.pagoBrebError, 'No se pudo guardar. Revisa la conexión e inténtalo de nuevo.');
  t.base.red = true;
  t.base.errorAjustes = { code: '42501', message: 'permission denied for table ajustes' };
  assert.equal(await t.pos.guardarPagoBreb(cambios), false);
  assert.equal(t.pos.pagoBrebError, 'Solo un admin puede cambiar el pago con Bre-B.');
  t.base.errorAjustes = { code: '23514', message: 'new row for relation "ajustes" violates check constraint "ajustes_pago_breb_qr_check"' };
  assert.equal(await t.pos.guardarPagoBreb(cambios), false);
  assert.equal(t.pos.pagoBrebError, 'La base no aceptó la llave o el contenido del QR. Revísalos y vuelve a pegarlos.');
  t.base.errorAjustes = null;
  t.base.sinColumnas.add('ajustes.pago_breb_visible');
  assert.equal(await t.pos.guardarPagoBreb(cambios), false);
  assert.equal(t.pos.pagoBrebError, 'Falta aplicar en la base la migración del pago con Bre-B.');
  t.base.sinColumnas.clear();
  t.base.ajustes.clear();                         // sin la fila 1 (o la RLS no la deja ver): cero filas actualizadas
  assert.equal(await t.pos.guardarPagoBreb(cambios), false);
  assert.equal(t.pos.pagoBrebError, 'No se pudo guardar. Revisa la conexión e inténtalo de nuevo.');
  assert.deepEqual(plano(t.pos.pagoBreb), { visible: false, llave: '', qr: '' }, 'sin base no se muestra algo que la base nunca recibió');
  assert.equal(t.pos.pagoBrebGuardado, false);
  assert.equal(t.pos.guardandoPagoBreb, false, 'y el botón queda libre');
});

test('un doble toque en «Guardar» manda UNA sola escritura', async () => {
  const t = await listo(montar());
  const cambios = { visible: true, llave: LLAVE_FICTICIA, qr: QR_FICTICIO };
  const [a, b] = await Promise.all([t.pos.guardarPagoBreb(cambios), t.pos.guardarPagoBreb(cambios)]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(t.escrituras().length, 1);
});

test('al cerrar sesión (_olvidarTodo) el pago con Bre-B se borra del store: el dato de pago no sobrevive a la cuenta', async () => {
  const t = await listo(montar({ ajustes: [{ ...FILA, pago_breb_visible: true, pago_breb_llave: LLAVE_FICTICIA, pago_breb_qr: QR_FICTICIO }] }));
  await t.pos.cargarPagoBreb();
  assert.equal(t.pos.pagoBreb.llave, LLAVE_FICTICIA);
  t.pos._olvidarTodo();
  assert.deepEqual(plano(t.pos.pagoBreb), { visible: false, llave: '', qr: '' });
  assert.equal(t.pos.pagoBrebCargado, false);
  assert.equal(t.pos.pagoBrebError, '');
});

// ───────────────────────── 4. el dibujo de la vista previa ─────────────────────────

test('la vista previa dibuja el QR que lee un lector: el contenido, byte por byte (versión 17, corrección M), negro sobre blanco y con 4 módulos de silencio', async () => {
  const t = await listo(montar());
  const d = t.pos.qrBrebParaVista(`  ${QR_FICTICIO}\n`);
  assert.ok(d.ruta && d.lado > 0);
  const svg = `<svg viewBox="0 0 ${d.lado} ${d.lado}"><rect width="${d.lado}" height="${d.lado}" fill="white"/><path fill="black" d="${d.ruta}"/></svg>`;
  const { matriz, fondoBlanco, trazoNegro } = matrizDeSvgConMargen(svg, 4);
  assert.ok(fondoBlanco && trazoNegro);
  assert.equal(d.lado, matriz.length + 8);
  const leido = decodificarQr(matriz);
  assert.equal(leido.texto, QR_FICTICIO);
  assert.equal(leido.nivel, 'M');
  assert.equal(leido.version, 17);
  const corto = t.pos.qrBrebParaVista(QR_FICTICIO_CORTO);
  assert.equal(decodificarQr(matrizDeSvgConMargen(`<svg viewBox="0 0 ${corto.lado} ${corto.lado}"><path d="${corto.ruta}"/></svg>`, 4).matriz).texto, QR_FICTICIO_CORTO);
  assert.match(d.ruta, /^(M\d+ \d+h\d+v1h-\d+z)+$/, 'solo rectángulos de módulos: ningún texto');
});

test('la vista previa no dibuja lo que no sirve (CRC roto, vacío, otro tipo) ni cuando la librería no cargó: queda vacía, nunca un cuadro roto', async () => {
  const t = await listo(montar());
  for (const malo of ['', '   ', 'hola', QR_FICTICIO.slice(0, 80) + 'Z' + QR_FICTICIO.slice(81), null, undefined, 42]) {
    assert.deepEqual(plano(t.pos.qrBrebParaVista(malo)), { lado: 0, ruta: '' }, JSON.stringify(malo));
  }
  const sinLib = await listo(montar({ libreria: false }));
  assert.deepEqual(plano(sinLib.pos.qrBrebParaVista(QR_FICTICIO_CORTO)), { lado: 0, ruta: '' });
  // La librería carga después (el <script defer> termina tras Alpine): el siguiente dibujo ya sale.
  vm.runInContext(LIBRERIA, sinLib.caja);
  sinLib.pos.qrLibListo = true;
  assert.ok(sinLib.pos.qrBrebParaVista(QR_FICTICIO_CORTO).ruta);
});

// ───────────────────────── 5. leer desde una foto ─────────────────────────

const foto = (extra = {}) => ({ type: 'image/png', size: 5000, name: 'qr.png', ...extra });

test('leerQrDeFoto con BarcodeDetector: lee solo QR de la foto, en el dispositivo, y devuelve el texto (recortado) sin guardar nada', async () => {
  const cierres = [];
  const usos = [];
  class Detector {
    constructor(opciones) { usos.push(['new', plano(opciones)]); }
    async detect(img) { usos.push(['detect', img.id]); return [{ rawValue: '' }, { rawValue: `  ${QR_FICTICIO}\n` }]; }
  }
  const t = await listo(montar({ extras: { BarcodeDetector: Detector, createImageBitmap: async (a) => ({ id: a.name, close() { cierres.push(a.name); } }) } }));
  assert.equal(t.pos.lectorQrFoto, true);
  const r = await t.pos.leerQrDeFoto(foto());
  assert.deepEqual(plano(r), { texto: QR_FICTICIO });
  assert.deepEqual(usos, [['new', { formats: ['qr_code'] }], ['detect', 'qr.png']], 'solo busca códigos QR');
  assert.deepEqual(cierres, ['qr.png'], 'libera la imagen');
  assert.deepEqual(plano(t.pos.pagoBreb), { visible: false, llave: '', qr: '' }, 'leer no guarda: el texto va al campo, donde se valida');
  assert.equal(t.escrituras().length, 0);
  assert.equal(t.supabase.llamadas.filter((c) => c.tipo === 'from' && c.op !== 'select').length >= 0, true);
});

test('leerQrDeFoto: sin BarcodeDetector lo dice (y el marcado ofrece pegar); una foto sin QR, un archivo que no es imagen, uno enorme y un error del detector se explican', async () => {
  const sin = await listo(montar());
  assert.equal(sin.pos.lectorQrFoto, false);
  assert.match((await sin.pos.leerQrDeFoto(foto())).error, /no sabe leer un QR desde una foto\. Pega el contenido/);

  const conDetector = (detect, extras = {}) => montar({ extras: { BarcodeDetector: class { async detect(i) { return detect(i); } }, createImageBitmap: async () => ({ close() {} }), ...extras } });
  const vacio = await listo(conDetector(() => []));
  assert.match((await vacio.pos.leerQrDeFoto(foto())).error, /No encontré un QR en esa foto/);
  assert.match((await vacio.pos.leerQrDeFoto(foto({ type: 'application/pdf' }))).error, /Elige una foto/);
  assert.match((await vacio.pos.leerQrDeFoto(null)).error, /Elige una foto/);
  assert.match((await vacio.pos.leerQrDeFoto(foto({ size: 25 * 1024 * 1024 }))).error, /pesa demasiado/);
  const roto = await listo(conDetector(() => { throw new Error('NotSupportedError'); }));
  assert.match((await roto.pos.leerQrDeFoto(foto())).error, /No pude leer esa foto/);
  const sinBitmap = await listo(montar({ extras: { BarcodeDetector: class { async detect() { return []; } }, createImageBitmap: async () => { throw new Error('decode'); } } }));
  assert.match((await sinBitmap.pos.leerQrDeFoto(foto())).error, /No pude leer esa foto/);
});

test('lo que lee la foto pasa por la MISMA validación: un QR de otra cosa (un enlace) se lee, pero no se puede guardar', async () => {
  class Detector { async detect() { return [{ rawValue: 'https://ejemplo.test/mesa/3' }]; } }
  const t = await listo(montar({ extras: { BarcodeDetector: Detector, createImageBitmap: async () => ({ close() {} }) } }));
  const r = await t.pos.leerQrDeFoto(foto());
  assert.equal(r.texto, 'https://ejemplo.test/mesa/3');
  assert.match(t.pos.motivoQrBreb(r.texto), /empezar por 000201/);
  assert.equal(await t.pos.guardarPagoBreb({ visible: false, llave: '', qr: r.texto }), false);
  assert.equal(t.escrituras().length, 0);
});
