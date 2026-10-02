// El formateador ESC/POS del agente de la impresora (impresora/ticket/escpos.mjs): bytes EXACTOS.
//
// Lo que se vigila, y por qué cada cosa sale mal en silencio si alguien la toca:
//   1. Tildes y ñ en CP850 (y el resto de tablas): un byte equivocado y «Café» sale «Caf‚».
//   2. Columnas: el precio queda pegado al margen derecho en 48, 42 y 32; la sangría de las sublíneas se
//      conserva y una línea larga se parte sin partir el precio.
//   3. QR nativo (GS ( k), corte, doble alto/ancho, negrita: los bytes de cada comando.
//   4. SEGURIDAD: un nombre de producto con \x1b o \x1d NO puede mandar comandos a la impresora. Lo escribe una
//      persona y viaja por la base; el agente es la última barrera antes del papel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirTicket, aImprimible, codificar, limpiarTexto, partirEnRenglones, resolverOpciones,
  ErrorDocumento, MAX_LINEAS, MAX_RENGLONES, OPCIONES_POR_DEFECTO,
} from '../../impresora/ticket/escpos.mjs';
import { TABLAS } from '../../impresora/ticket/tablas.mjs';
import { bytesATexto } from '../../impresora/ticket/vista-texto.mjs';
import { documentoDePrueba } from '../../impresora/ticket/prueba.mjs';

const SIN_COLA = { cortar: false, avance: 0 };                 // sin avance ni corte: solo cabecera + cuerpo
const CABECERA = '1b40' + '1b7402';                             // ESC @ + ESC t 2 (PC850)
const hex = (b) => Buffer.from(b).toString('hex');
const ticket = (doc, op = {}) => construirTicket(doc, { ...SIN_COLA, ...op });
// Las líneas impresas (cada una termina en LF), como texto latin1 «crudo» (un byte = un carácter) y sin los
// comandos de estilo, que se prueban aparte.
const renglones = (bytes, op = {}) => {
  const b = ticket(bytes, op);
  const cuerpo = b.subarray(5).toString('latin1').replace(/\x1b[aE][\x00-\x02]|\x1d![\x00-\x7f]/g, '');   // sin ESC a / ESC E / GS !
  return cuerpo.split('\n').slice(0, -1);
};

// ───────────────────────── 1. tildes y tablas ─────────────────────────

test('«Café ñandú»: bytes exactos en PC850 con ESC @ y ESC t 2 al principio', () => {
  assert.equal(hex(ticket({ lineas: ['Café ñandú'] })), CABECERA + '43616682' + '20' + 'a4616e64a3' + '0a');
});

test('PC850: todas las tildes y signos del español caen en su byte', () => {
  const esperado = { á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a, '¿': 0xa8, '¡': 0xad, Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, '°': 0xf8, '·': 0xfa };
  for (const [c, b] of Object.entries(esperado)) assert.deepEqual(codificar(aImprimible(c, 2), 2), [b], `${c} en PC850`);
});

test('las demás tablas: PC437, PC858 (con €), WPC1252 y PC860 dan sus bytes', () => {
  assert.deepEqual(codificar(aImprimible('ñé', 0), 0), [0xa4, 0x82], 'PC437');
  assert.deepEqual(codificar(aImprimible('€', 19), 19), [0xd5], 'PC858 trae el €');
  assert.equal(aImprimible('€', 2), 'EUR', 'PC850 no lo tiene: sale como EUR, no como un signo equivocado');
  assert.deepEqual(codificar(aImprimible('€ñá', 16), 16), [0x80, 0xf1, 0xe1], 'WPC1252');
  assert.deepEqual(codificar(aImprimible('ãõ', 3), 3), [0x84, 0x94], 'PC860 (portugués)');
  assert.equal(hex(ticket({ lineas: ['ñ'] }, { tablaEscPos: 16 })), '1b40' + '1b7410' + 'f1' + '0a', 'ESC t 16 y el byte de la 1252');
});

test('las tablas tienen sus 128 caracteres y ASCII a la baja', () => {
  for (const [n, t] of Object.entries(TABLAS)) {
    assert.equal(t.alta.length, 128, `tabla ${n} (${t.nombre})`);
    assert.equal(new Set(t.alta).size >= 120, true, `tabla ${n}: casi todos distintos`);
  }
});

test('lo que la tabla no tiene se cambia por algo parecido y nunca por basura', () => {
  assert.equal(aImprimible('“Hola” — ‘x’… ™'), '"Hola" - \'x\'... TM');
  assert.equal(aImprimible('Łódź'), '?ódz', 'sin descomposición: «?»; ź → z; ó queda');
  assert.equal(aImprimible('日本'), '??');
  assert.equal(limpiarTexto('Pizza 🍕 grande'), 'Pizza  grande', 'los emojis se quitan');
  assert.equal(limpiarTexto('a b​c­x'), 'a bcx', 'NBSP → espacio; invisibles fuera');
});

// ───────────────────────── 2. columnas, precio, sangría ─────────────────────────

test('el precio queda pegado al margen derecho en 48, 42 y 32 columnas', () => {
  for (const columnas of [48, 42, 32]) {
    const [l] = renglones({ lineas: [{ texto: '2x Café', der: '$ 8.000' }] }, { columnas });
    assert.equal(l.length, columnas, `${columnas} columnas`);
    assert.equal(l, '2x Caf\x82' + ' '.repeat(columnas - 7 - 7) + '$ 8.000');
  }
});

test('izquierda\\tderecha dentro de «texto» es lo mismo que «der»', () => {
  assert.deepEqual(renglones({ lineas: ['1x Té\t$ 3.500'] }), renglones({ lineas: [{ texto: '1x Té', der: '$ 3.500' }] }));
});

test('sangría de las sublíneas: los espacios del comienzo, o «sangria», y se repite al partir', () => {
  assert.deepEqual(renglones({ lineas: ['  sin cebolla'] }), ['  sin cebolla']);
  assert.deepEqual(renglones({ lineas: [{ texto: 'c/u $ 28.000', sangria: 4 }] }), ['    c/u $ 28.000']);
  const largo = renglones({ lineas: [{ texto: 'nota: ' + 'palabra '.repeat(10).trim(), sangria: 3 }] }, { columnas: 32 });
  assert.ok(largo.length > 1);
  for (const l of largo) { assert.ok(l.startsWith('   ') && l[3] !== ' '); assert.ok(l.length <= 32); }
});

test('un nombre largo se parte por palabras y el precio se queda en la primera línea, entero', () => {
  const ls = renglones({ lineas: [{ texto: '1x Plato con un nombre larguísimo que no cabe en una sola línea del papel', der: '$ 131.000' }] }, { columnas: 32 });
  assert.equal(ls.length, 3);
  assert.ok(ls[0].startsWith('1x Plato con un nombre') && ls[0].endsWith(' $ 131.000') && ls[0].length === 32, ls[0]);
  assert.ok(ls.slice(1).every((l) => !l.includes('$')), 'el precio solo en la primera');
  assert.ok(ls[1].length > 22, 'las demás líneas usan el ancho completo, no el que le queda al precio');
  assert.ok(ls.every((l) => l.length <= 32));
  const vista = bytesATexto(ticket({ lineas: [{ texto: '1x Plato con un nombre larguísimo que no cabe en una sola línea del papel', der: '$ 131.000' }] }), { columnas: 32 });
  assert.equal(vista.replace(/\s+/g, ' ').replace(' $ 131.000', '').trim(), '1x Plato con un nombre larguísimo que no cabe en una sola línea del papel', 'no se pierde ni se repite nada');
});

test('una palabra más larga que el papel se corta en vez de salirse', () => {
  assert.deepEqual(partirEnRenglones('A'.repeat(70), 32), ['A'.repeat(32), 'A'.repeat(32), 'A'.repeat(6)]);
  assert.deepEqual(renglones({ lineas: ['x'.repeat(40)] }, { columnas: 32 }), ['x'.repeat(32), 'x'.repeat(8)]);
});

test('un precio que ocupa casi todo el papel va solo a la derecha en vez de pisar el nombre', () => {
  const ls = renglones({ lineas: [{ texto: 'Servicio', der: '$ 1.234.567.890.123' }] }, { columnas: 24 });
  assert.equal(ls.length, 2);
  assert.equal(ls[0], 'Servicio');
  assert.equal(ls[1], '$ 1.234.567.890.123');
  assert.match(hex(ticket({ lineas: [{ texto: 'Servicio', der: '$ 1.234.567.890.123' }] }, { columnas: 24 })), /1b6102/, 'alineado a la derecha por la impresora (ESC a 2)');
});

test('la regla de tres o más guiones llena el ancho; también «separador»', () => {
  assert.deepEqual(renglones({ lineas: ['----'] }, { columnas: 32 }), ['-'.repeat(32)]);
  assert.deepEqual(renglones({ lineas: ['=========================='] }, { columnas: 42 }), ['='.repeat(42)]);
  assert.deepEqual(renglones({ lineas: [{ separador: '*' }] }), ['*'.repeat(48)]);
  assert.deepEqual(renglones({ lineas: ['--'] }), ['--'], 'dos guiones son texto, no regla');
});

test('un salto de línea dentro del texto parte en varias líneas; las líneas vacías son un renglón en blanco', () => {
  assert.deepEqual(renglones({ lineas: ['uno\ndos', '', 'tres'] }), ['uno', 'dos', '', 'tres']);
});

// ───────────────────────── 3. estilos, QR, corte ─────────────────────────

test('título: centrado, negrita y 2×2 si cabe (ESC a 1, ESC E 1, GS ! 0x11); al final se restablece', () => {
  assert.equal(hex(ticket({ titulo: 'RESPLANDOR' })),
    CABECERA + '1b6101' + '1b4501' + '1d2111' + Buffer.from('RESPLANDOR\n').toString('hex') + '1b6100' + '1b4500' + '1d2100');
});

test('un título que no cabe al doble de ancho sale solo a doble alto (GS ! 0x01)', () => {
  const b = ticket({ titulo: 'Restaurante Resplandor de Camila' }, { columnas: 32 });
  assert.match(hex(b), /1d2101/);
  assert.doesNotMatch(hex(b), /1d2111/);
});

test('negrita y doble alto/ancho/ambos: ESC E y GS ! con los bits de cada uno', () => {
  const h = hex(ticket({ lineas: [{ texto: 'a', negrita: true }, { texto: 'b', doble: true }, { texto: 'c', doble: 'ancho' }, { texto: 'd', doble: 'ambos' }, 'e'] }));
  assert.equal(h, CABECERA
    + '1b4501' + '610a'                                   // negrita
    + '1b4500' + '1d2101' + '620a'                        // doble alto (la negrita se apaga sola)
    + '1d2110' + '630a'                                   // doble ancho
    + '1d2111' + '640a'                                   // los dos
    + '1d2100' + '650a');                                 // todo normal otra vez
});

test('doble ancho usa la mitad de las columnas', () => {
  const ls = renglones({ lineas: [{ texto: 'x'.repeat(30), doble: 'ancho' }] }, { columnas: 48 });
  assert.deepEqual(ls.map((l) => l.length), [24, 6]);
});

test('alineación centrada y a la derecha usa ESC a 1 y ESC a 2 y vuelve a la izquierda', () => {
  const h = hex(ticket({ lineas: [{ texto: 'a', alinear: 'centro' }, { texto: 'b', alinear: 'der' }, 'c'] }));
  assert.equal(h, CABECERA + '1b6101' + '610a' + '1b6102' + '620a' + '1b6100' + '630a');
});

test('QR nativo: modelo 2, tamaño, corrección M, datos y a imprimir (GS ( k), centrado', () => {
  const b = ticket({ qr: 'abc' });
  assert.equal(hex(b), CABECERA + '1b6101'
    + '1d286b0400314132' + '00'
    + '1d286b03003143' + '06'
    + '1d286b03003145' + '31'
    + '1d286b0600315030' + '616263'
    + '1d286b03003151' + '30'
    + '0a' + '1b6100');
});

test('QR: tamaño propio, etiqueta encima, y longitud en pL pH con una URL larga', () => {
  const url = 'https://resplandor.ynt.codes/t/' + 'a'.repeat(200);
  const b = ticket({ qr: { texto: url, etiqueta: 'Tu cuenta', tamano: 4 } });
  const h = hex(b);
  assert.match(h, new RegExp('1d286b03003143' + '04'));
  const n = url.length + 3;                                  // 231 = 0xe7, 0x00
  assert.match(h, new RegExp('1d286b' + n.toString(16).padStart(2, '0') + '00' + '315030' + Buffer.from(url).toString('hex')));
  assert.ok(b.toString('latin1').includes('Tu cuenta\n'));
});

test('sin QR nativo la dirección sale como texto, partida por columnas', () => {
  const ls = renglones({ qr: 'https://resplandor.ynt.codes/t/abc' }, { columnas: 16, qrNativo: false });
  assert.equal(ls.join(''), 'https://resplandor.ynt.codes/t/abc');
  assert.ok(ls.every((l) => l.length <= 16));
  assert.doesNotMatch(hex(ticket({ qr: 'x' }, { qrNativo: false })), /1d286b/);
});

test('un QR demasiado largo para la impresora cae a texto en vez de mandar basura', () => {
  const b = ticket({ qr: 'https://x.co/' + 'a'.repeat(500) });
  assert.doesNotMatch(hex(b), /1d286b/);
});

test('corte parcial por defecto: avanza 3 líneas (ESC d 3) y GS V 66 0; «total» es GS V 65 0', () => {
  assert.equal(hex(construirTicket({ lineas: ['x'] })), CABECERA + '780a' + '1b6403' + '1d564200');
  assert.equal(hex(construirTicket({ lineas: ['x'] }, { cortar: 'total', avance: 5 })), CABECERA + '780a' + '1b6405' + '1d564100');
  assert.equal(hex(construirTicket({ lineas: ['x'] }, { cortar: true })), hex(construirTicket({ lineas: ['x'] })));
});

test('sin corte: o la config lo apaga (cortar:false) o el documento (cortar:false); el papel igual avanza', () => {
  assert.equal(hex(construirTicket({ lineas: ['x'] }, { cortar: false })), CABECERA + '780a' + '1b6403');
  assert.equal(hex(construirTicket({ lineas: ['x'], cortar: false })), CABECERA + '780a' + '1b6403');
  assert.equal(hex(construirTicket({ lineas: ['x'] }, { cortar: false, avance: 0 })), CABECERA + '780a');
});

test('cancelarKanji agrega FS . (1c 2e) tras ESC @, y solo si se pide', () => {
  assert.equal(hex(ticket({ lineas: ['x'] }, { cancelarKanji: true })), '1b40' + '1c2e' + '1b7402' + '780a');
  assert.doesNotMatch(hex(ticket({ lineas: ['x'] })), /1c2e/);
});

// ───────────────────────── 4. SEGURIDAD: nada del contenido es un comando ─────────────────────────

const HOSTIL = 'Coca\x1b@Cola\x1d!\x11 \x10\x04\x00 \x1c.\x1b\x70\x00\x32\x32 \x1dV\x42\x00 \x1d(k\x03\x00\x31\x51\x30 \x07\x7f\x9b\r\x0c';

// Camina los bytes y devuelve la lista de comandos que reconoce (los que escribe escpos.mjs a mano) y el texto
// suelto. Cualquier otro byte por debajo de 0x20 hace fallar la prueba.
function comandos(bytes) {
  const cmds = [];
  let texto = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x20) { texto += String.fromCharCode(b); continue; }
    if (b === 0x0a) { cmds.push('LF'); continue; }
    if (b === 0x1b && [0x40].includes(bytes[i + 1])) { cmds.push('ESC@'); i += 1; continue; }
    if (b === 0x1b && [0x74, 0x61, 0x45, 0x64].includes(bytes[i + 1])) { cmds.push('ESC' + String.fromCharCode(bytes[i + 1])); i += 2; continue; }
    if (b === 0x1d && bytes[i + 1] === 0x21) { cmds.push('GS!'); i += 2; continue; }
    if (b === 0x1d && bytes[i + 1] === 0x56) { cmds.push('GSV'); i += 3; continue; }
    if (b === 0x1d && bytes[i + 1] === 0x28 && bytes[i + 2] === 0x6b) {
      const n = bytes[i + 3] + bytes[i + 4] * 256;
      cmds.push('GS(k');
      const datos = bytes.subarray(i + 5, i + 5 + n);
      if (datos[1] === 0x50) for (const d of datos.subarray(3)) assert.ok(d >= 0x20, 'byte de control dentro de los datos del QR');
      i += 4 + n;
      continue;
    }
    assert.fail(`byte de control inesperado 0x${b.toString(16)} en la posición ${i}`);
  }
  return { cmds, texto };
}

test('SEGURIDAD: un nombre de producto con ESC y GS no manda comandos (queda solo el texto)', () => {
  const b = ticket({ lineas: [{ texto: HOSTIL }] });
  const { cmds, texto } = comandos(b);
  assert.deepEqual(cmds, ['ESC@', 'ESCt', 'LF', 'LF'], 'solo la cabecera del propio agente y los saltos de línea (el \\r del final es un salto más)');
  assert.equal(b.includes(Buffer.from([0x1b, 0x70])), false, 'ni ESC p (abrir cajón)');
  assert.ok(texto.includes('Coca@Cola'));
});

test('SEGURIDAD: lo mismo en el precio, el título, el QR (texto y etiqueta) y las líneas anidadas', () => {
  const b = ticket({
    titulo: 'Hola\x1b@\x1dV\x00', lineas: [{ texto: 'x', der: '$\x1b\x70 5' }, 'y\x1d!\x11', { izq: 'z\x1b!' }],
    qr: { texto: 'https://x.co/\x1d(k\x1b@\x00', etiqueta: 'ver\x1bE' },
  });
  const { cmds } = comandos(b);
  // El agente emite: ESC@ ESCt | título: ESCa ESCE GS! LF | 3 líneas (LF c/u) | etiqueta ESCa(ya) LF | QR GS(k×5 LF | reset
  assert.equal(cmds.filter((c) => c === 'ESC@').length, 1, 'un solo ESC @, el del agente');
  assert.equal(cmds.filter((c) => c === 'GSV').length, 0, 'ningún GS V (corte) colado');
  assert.equal(cmds.filter((c) => c === 'GS(k').length, 5, 'los 5 GS ( k del QR del agente y ninguno más');
  assert.equal(cmds.filter((c) => c === 'ESCE').length, 2, 'negrita del título y su apagado: nada más');
});

test('SEGURIDAD (barrido): ningún carácter, solo o en medio de texto, produce un byte de control', () => {
  for (let cp = 0; cp <= 0x3000; cp++) {
    const c = String.fromCodePoint(cp);
    const bytes = codificar(aImprimible(limpiarTexto(`a${c}b`).replace(/[\n\t]/g, ' ')));
    for (const x of bytes) assert.ok(x >= 0x20, `U+${cp.toString(16)} produjo 0x${x.toString(16)}`);
  }
  for (const c of [' ', ' ', '\u0085', '\ud83d', '\udc00', '﻿', '‮', '\u{1f355}', '\u{10ffff}']) {
    for (const x of codificar(aImprimible(limpiarTexto(`a${c}b`)))) assert.ok(x >= 0x20);
  }
});

test('SEGURIDAD (azar): documentos con basura de cualquier tipo solo producen los comandos del agente', () => {
  let semilla = 12345;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cadena = () => Array.from({ length: Math.floor(azar() * 30) }, () => String.fromCodePoint(
    azar() < 0.4 ? Math.floor(azar() * 0x20) : azar() < 0.5 ? 0x7f + Math.floor(azar() * 0x30) : Math.floor(azar() * 0x500))).join('');
  for (let i = 0; i < 300; i++) {
    const doc = { lineas: [cadena(), { texto: cadena(), der: cadena(), alinear: cadena(), doble: cadena(), sangria: azar() * 100 }, cadena()], titulo: cadena(), qr: { texto: cadena(), etiqueta: cadena() } };
    let b;
    try { b = ticket(doc); } catch (e) { assert.ok(e instanceof ErrorDocumento); continue; }
    const { cmds } = comandos(b);
    assert.equal(cmds.filter((c) => c === 'ESC@').length, 1);
    assert.equal(cmds.filter((c) => c === 'GSV').length, 0);
    assert.ok(cmds.filter((c) => c === 'GS(k').length === 0 || cmds.filter((c) => c === 'GS(k').length === 5);
  }
});

// ───────────────────────── 4b. el documento que arma el POS (pos.html · documentoTicket) ─────────────────────────

// Calcado de lo que inserta el POS (ver «DOCUMENTO» en pos.html): v:1, la raya como «---», `der` para los precios, sublíneas con
// `sangria`, el TOTAL en doble alto y negrita, y el QR con etiqueta. Si el POS cambia de forma, esta prueba es donde se nota.
const DOC_POS = {
  v: 1,
  titulo: 'Resplandor',
  lineas: [
    { texto: 'CUENTA DE COBRO - NO ES FACTURA', alinear: 'centro', negrita: true },
    { texto: '---' },
    { texto: 'Mesa', der: '4' },
    { texto: 'Fecha', der: '01/10/2026' },
    { texto: 'Hora', der: '07:45 p. m.' },
    { texto: 'Atendió', der: 'Camila' },
    { texto: '---' },
    { texto: '2 x Ejecutivo de la casa', der: '$ 42.000' },
    { texto: 'Sopa · Pollo · Jugo de maracuyá sin azúcar', sangria: 2 },
    { texto: 'c/u $ 21.000', sangria: 2 },
    { texto: '1 x Limonada de coco', der: '$ 12.500' },
    { texto: '---' },
    { texto: 'Ítems', der: '3' },
    { texto: 'TOTAL', der: '$ 54.500', negrita: true, doble: true },
    { texto: 'Queda por pagar', der: '$ 20.000' },
    { texto: '' },
    { texto: 'Gracias por su visita', alinear: 'centro' },
  ],
  qr: { texto: 'https://resplandor.ynt.codes/', etiqueta: 'resplandor.ynt.codes' },
  cortar: true,
};

test('el documento del POS (v:1, der, sangria, «---», TOTAL en doble alto, QR con etiqueta) sale completo en 48, 42 y 32 columnas', () => {
  for (const columnas of [48, 42, 32]) {
    const bytes = construirTicket(DOC_POS, { columnas });
    const vista = bytesATexto(bytes, { columnas }).split('\n');
    assert.ok(!vista.join('\n').includes('‹'), 'sin comandos sin interpretar');
    assert.ok(vista.every((l) => l.includes('✂') || l.includes('[ QR:') || l.length <= columnas), `${columnas} columnas: ninguna línea se pasa`);
    assert.ok(vista.includes('-'.repeat(columnas)), 'la raya llena el papel');
    const fila = (ini) => vista.find((l) => l.startsWith(ini));
    assert.equal(fila('Mesa').length, columnas);
    assert.ok(fila('Mesa').endsWith(' 4'));
    const plato = fila('2 x Ejecutivo');                 // a 32 columnas el nombre se parte («…de la» / «casa») y el precio queda en la 1ª
    assert.ok(plato.endsWith('$ 42.000') && plato.length === columnas, plato);
    assert.equal(vista.join(' ').replace(/\s+/g, ' ').includes(columnas === 32 ? 'de la $ 42.000 casa' : 'de la casa $ 42.000'), true);
    assert.ok(fila('TOTAL').endsWith('$ 54.500') && fila('TOTAL').length === columnas, 'el total contra el margen (doble alto no cambia las columnas)');
    assert.ok(vista.includes('  c/u $ 21.000'), 'la sublínea conserva su sangría de 2');
    assert.ok(vista.some((l) => l.startsWith('  Sopa') ), 'la sublínea larga empieza con su sangría');
    assert.ok(vista.filter((l) => /^ {2}\S/.test(l) && !l.includes('c/u')).every((l) => l.length <= columnas));
    assert.ok(vista.some((l) => l.includes('Gracias por su visita')));
    assert.ok(vista.some((l) => l.includes('[ QR: https://resplandor.ynt.codes/ ]')));
    assert.ok(vista.some((l) => l.trim() === 'resplandor.ynt.codes'), 'la etiqueta del QR, aparte');
    assert.ok(vista.some((l) => l.includes('corte parcial')));
    assert.match(vista.join('\n'), /Atendió/, 'las tildes de CP850 salen como entraron');
    assert.match(hex(bytes), /1d21011b4501|1b45011d2101/, 'el TOTAL va en negrita y doble alto (ESC E 1, GS ! 1)');
    assert.equal(bytes.includes(Buffer.from([0x1d, 0x28, 0x6b])), true, 'el QR es el nativo de la impresora');
  }
});

test('el documento del POS: «v» y las claves que el agente no conoce se ignoran sin error', () => {
  assert.deepEqual(ticket({ ...DOC_POS, v: 99, inventado: { x: 1 } }), ticket(DOC_POS));
});

// ───────────────────────── 5. documentos inválidos y opciones ─────────────────────────

test('lo que no es un documento da ErrorDocumento con un mensaje en español', () => {
  for (const malo of [null, undefined, 'texto', 42, [], [1, 2]]) {
    assert.throws(() => ticket(malo), (e) => e instanceof ErrorDocumento && /no es un documento/.test(e.message), JSON.stringify(malo));
  }
  assert.throws(() => ticket({ lineas: 'x' }), /"lineas" del documento debe ser una lista/);
  assert.throws(() => ticket({}), /está vacío/);
  assert.throws(() => ticket({ lineas: [] }), /está vacío/);
  assert.throws(() => ticket({ lineas: new Array(MAX_LINEAS + 1).fill('x') }), /líneas; el máximo/);
  // 500 líneas de 2000 caracteres: antes chocaba con el tope de bytes; ahora el de papel salta primero.
  assert.throws(() => ticket({ lineas: new Array(MAX_LINEAS).fill('x'.repeat(2000)) }), (e) => e instanceof ErrorDocumento && /pasa de 600 renglones de papel/.test(e.message));
});

// Refutación, hallazgo 3: 8 líneas con 1.998 «\n» cada una caben en 32 KB, la base las acepta y salían ~16.000 renglones (~60 m: un rollo).
test('papel: un documento que cabe en la base pero saldría en miles de renglones se rechaza ENTERO, sin bytes a medias', () => {
  const campo = 'x' + '\n'.repeat(1998) + 'x';
  const doc = { v: 1, lineas: Array.from({ length: 8 }, () => ({ texto: campo })) };
  assert.ok(Buffer.byteLength(JSON.stringify(doc)) < 32768, 'la base lo aceptaría: es el escenario de la refutación');
  assert.throws(() => construirTicket(doc, {}), (e) => e instanceof ErrorDocumento && /saltos de línea; el ticket no puede pasar de 600 renglones/.test(e.message), 'ErrorDocumento: el agente lo confirma como error, no se cae');
  // con saltos que no revientan una sola línea (299 por campo) el tope lo pone el emisor, a medio camino, sin devolver nada
  const repartido = { v: 1, lineas: Array.from({ length: 20 }, () => ({ texto: 'x' + '\n'.repeat(298) + 'x' })) };
  assert.throws(() => construirTicket(repartido, {}), (e) => e instanceof ErrorDocumento && /pasa de 600 renglones de papel \(~2,3 m\)/.test(e.message));
  // una sola línea con miles de saltos: ni siquiera se normaliza
  assert.throws(() => ticket({ lineas: [{ texto: '\n'.repeat(1999) }] }), /saltos de línea; el ticket no puede pasar de 600 renglones/);
  // otras formas de inflar el papel: líneas partidas por ancho, título, etiqueta y QR como texto
  assert.throws(() => ticket({ lineas: new Array(300).fill('palabra '.repeat(60)) }, { columnas: 32 }), /pasa de 600 renglones/);
  assert.throws(() => ticket({ lineas: new Array(300).fill('a\nb\nc') }), /pasa de 600 renglones/, '300 líneas de 3 renglones: 900');
});

test('papel: 600 renglones exactos salen; 601 no; y un ticket grande de verdad (100 platos con nota y c/u a 32 columnas) sale', () => {
  // k renglones físicos: líneas de dos renglones («a\nb») y, si k es impar, una de uno
  const n = (k) => ticket({ lineas: [...Array.from({ length: Math.floor(k / 2) }, () => 'a\nb'), ...(k % 2 ? ['c'] : [])] });
  assert.equal(MAX_RENGLONES, 600);
  assert.equal(n(MAX_RENGLONES).filter((b) => b === 0x0a).length, 600);
  assert.throws(() => n(MAX_RENGLONES + 1), /pasa de 600 renglones/);
  const platos = [];
  for (let i = 0; i < 100; i++) {
    platos.push({ texto: `2 x Plato número ${i} con un nombre bastante largo`, der: '$ 42.000' });
    platos.push({ texto: 'sin cebolla, bien cocido, para llevar', sangria: 2 });
    platos.push({ texto: 'c/u $ 21.000', sangria: 2 });
  }
  const b = construirTicket({ titulo: 'Resplandor', lineas: platos, qr: 'https://resplandor.ynt.codes', cortar: true }, { columnas: 32 });
  const filas = b.filter((x) => x === 0x0a).length;
  assert.ok(filas > 300 && filas <= MAX_RENGLONES, `un ticket real de 100 platos a 32 columnas son ${filas} renglones y sale`);
});

test('campos de tipo equivocado se ignoran sin tumbar el ticket', () => {
  const ls = renglones({ lineas: [null, undefined, 7, { texto: { a: 1 } }, { texto: 'ok', alinear: 5, doble: 'raro', negrita: 'si', sangria: 'x' }, ['x'], true] });
  assert.deepEqual(ls, ['7', '', 'ok']);
});

test('las opciones malas dicen cuál es el problema', () => {
  assert.throws(() => resolverOpciones({ columnas: 10 }), /columnas debe ser un número entero entre 16 y 80/);
  assert.throws(() => resolverOpciones({ columnas: '48' }), /columnas/);
  assert.throws(() => resolverOpciones({ tablaEscPos: 99 }), /tablaEscPos 99 no está soportada; usa 0 \(PC437\)/);
  assert.throws(() => resolverOpciones({ cortar: 'mitad' }), /cortar debe ser/);
  assert.throws(() => resolverOpciones({ qrTamano: 40 }), /qrTamano/);
  assert.throws(() => resolverOpciones({ avance: -1 }), /avance/);
  assert.deepEqual(resolverOpciones(), OPCIONES_POR_DEFECTO);
  assert.equal(resolverOpciones({ cortar: false }).cortar, 'no');
});

// ───────────────────────── 6. ida y vuelta con la vista de texto ─────────────────────────

test('la página de prueba cabe en 48, 42 y 32 columnas, con el precio contra el margen y sin comandos sueltos', () => {
  for (const columnas of [48, 42, 32]) {
    const bytes = construirTicket(documentoDePrueba({ columnas, ahora: new Date(2026, 9, 1, 17, 30) }), { columnas });
    const vista = bytesATexto(bytes, { columnas });
    assert.doesNotMatch(vista, /‹/, 'un comando sin interpretar se ve como ‹0x..›');
    for (const l of vista.split('\n')) {
      if (l.includes('✂') || l.includes('[ QR:') || /^[0-9]+\|$/.test(l)) continue;     // el aviso del corte, el cuadro del QR y las reglas de medir (32/42/48)
      assert.ok(l.length <= columnas, `${columnas} columnas: «${l}» mide ${l.length}`);
    }
    assert.ok(vista.includes('1234567890'.repeat(Math.floor(columnas / 10))), 'la regla de columnas');
    assert.ok(vista.split('\n').some((l) => l.startsWith('|') && l.endsWith('|') && l.length === columnas), 'los dos bordes de la página de prueba');
    assert.ok(vista.split('\n').some((l) => l.length === columnas && l.endsWith('$ 199.500') && l.startsWith('TOTAL')), 'el total contra el margen derecho');
    assert.match(vista, /Tildes: áéíóú ÁÉÍÓÚ üÜ ñÑ ¿\? ¡!/, 'las tildes salen como entraron');
    assert.match(vista, /corte parcial/);
    assert.ok(vista.includes('[ QR: https://resplandor.ynt.codes/ ]'));
  }
});

test('la página de prueba trae las reglas de 32, 42 y 48 para medir el papel, con la barra al final, aunque sean más anchas que `columnas`', () => {
  const vista = bytesATexto(construirTicket(documentoDePrueba({ columnas: 32 }), { columnas: 32 }), { columnas: 32 });
  const reglas = vista.split('\n').filter((l) => /^[0-9]+\|$/.test(l));
  assert.deepEqual(reglas.map((l) => l.length), [32, 42, 48]);
  assert.deepEqual(reglas, [
    '1234567890123456789012345678901|',
    '123456789012345678901234567890123456789012'.slice(0, 41) + '|',
    '1234567890123456789012345678901234567890123456' + '7|',
  ].map((r, i) => r.slice(0, [31, 41, 47][i]) + '|'));
  assert.deepEqual(renglones({ lineas: [{ texto: 'x'.repeat(40), columnas: 40 }] }, { columnas: 32 }), ['x'.repeat(40)], 'columnas por línea: no se parte a 32');
  assert.deepEqual(renglones({ lineas: [{ texto: 'x'.repeat(40), columnas: 8 }] }, { columnas: 32 }), ['x'.repeat(32), 'x'.repeat(8)], 'fuera de 16 a 80 se ignora');
});

test('documentoDePrueba es un documento válido para cualquier columnas razonable', () => {
  for (const columnas of [16, 24, 32, 42, 48, 56, 80]) assert.ok(construirTicket(documentoDePrueba({ columnas }), { columnas }).length > 100);
});
