// Un QR de Bre-B FICTICIO para las pruebas de «Pagar con Bre-B» (carta y tablero), y las reglas del contenido EMV de un QR de pago.
//
// NADA de esto es un dato real. La llave y el contenido del QR que usa el restaurante viven SOLO en el sobre privado de datos de Yonatan
// (fuera del repo) y llegan a la carta desde la base, que el admin llena desde el tablero: ni este archivo, ni una prueba, ni una captura,
// ni un mensaje de commit llevan el dato real. Aquí todo es inventado y de la forma de un QR estático de Bre-B (EMVCo, «Merchant-Presented
// Mode»): 00 formato, 01 = 11 estático, 26 con el identificador de la red y la llave, 49/50/51 campos propios de la red, 53 = 170 (peso
// colombiano), 58 = CO, 59 y 60 y 63 el CRC. El largo está cerca del de uno de verdad (≈ 490 caracteres) a propósito: un QR así sale muy
// denso (versión 17 con corrección M) y las pruebas de tamaño y de lectura se hacen con el peor caso, no con uno cómodo.
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre como prueba, solo lo importan las que lo necesitan.

/** CRC-16/CCITT-FALSE (polinomio 0x1021, valor inicial 0xFFFF, sin reflejar, sin XOR final): el del campo 63 de EMVCo. Devuelve un entero de 16 bits. */
export function crc16(texto) {
  let crc = 0xffff;
  for (const byte of Buffer.from(String(texto), 'latin1')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** Los cuatro dígitos hexadecimales (en mayúscula) del CRC de un texto. */
export const crcHex = (texto) => crc16(texto).toString(16).toUpperCase().padStart(4, '0');

/** Un campo TLV de EMV: etiqueta de 2 dígitos, largo de 2 dígitos y el valor. */
export const tlv = (etiqueta, valor) => {
  if (String(valor).length > 99) throw new Error(`el campo ${etiqueta} pasa de 99 caracteres`);
  return etiqueta + String(valor.length).padStart(2, '0') + valor;
};

/** Arma un contenido EMV completo: los campos `[etiqueta, valor]` en orden y, al final, el 63 con su CRC bueno. */
export function emvConCrc(campos) {
  const base = campos.map(([e, v]) => tlv(e, v)).join('') + '6304';
  return base + crcHex(base);
}

/** La llave de mentira. Empieza por @ como una llave alfanumérica de Bre-B; no es de nadie. */
export const LLAVE_FICTICIA = '@prueba.ficticia';
/** Otra llave de mentira: la del QR corto (QR_FICTICIO_CORTO cobra a esta). */
export const LLAVE_OTRA_FICTICIA = '@otra.ficticia';

// Relleno inventado con la forma de los campos de la red (identificadores largos en mayúscula y números). No significa nada.
const relleno = (semilla, largo) => {
  let s = '';
  for (let i = 0; s.length < largo; i++) s += ((semilla * 7919 + i * 104729) % 36).toString(36).toUpperCase();
  return s.slice(0, largo);
};

/** El contenido del QR ficticio, de unos 490 caracteres, con CRC bueno. */
export const QR_FICTICIO = emvConCrc([
  ['00', '01'],
  ['01', '11'],
  ['26', tlv('00', 'CO.COM.RBM.LLA') + tlv('04', LLAVE_FICTICIA) + tlv('05', 'FICTICIO')],
  ['27', tlv('00', 'CO.COM.RBM.REF') + tlv('01', relleno(2, 60))],
  ['49', tlv('00', 'CO.COM.RBM.RED') + tlv('01', relleno(3, 60)) + tlv('02', relleno(5, 11))],
  ['50', tlv('00', 'CO.COM.RBM.IDC') + tlv('01', relleno(11, 60)) + tlv('02', relleno(13, 11))],
  ['51', tlv('00', 'CO.COM.RBM.TRX') + tlv('01', relleno(17, 60)) + tlv('02', relleno(19, 11))],
  ['53', '170'],
  ['58', 'CO'],
  ['59', '0'],
  ['60', '0'],
]);

/** Uno corto (≈ 100 caracteres, versión 7 u 8), también ficticio y con CRC bueno. */
export const QR_FICTICIO_CORTO = emvConCrc([
  ['00', '01'],
  ['01', '11'],
  ['26', tlv('00', 'CO.COM.RBM.LLA') + tlv('04', LLAVE_OTRA_FICTICIA)],
  ['53', '170'],
  ['58', 'CO'],
  ['59', '0'],
  ['60', '0'],
]);

/** Cambia un carácter del contenido (no el del CRC): el CRC deja de cuadrar. */
export const conUnCaracterCambiado = (qr, posicion = 40) => qr.slice(0, posicion) + (qr[posicion] === 'X' ? 'Y' : 'X') + qr.slice(posicion + 1);

/** Las reglas del contenido, escritas aparte y a propósito de otra manera que las del navegador (el tablero y la carta): las pruebas comparan las dos. */
export function reglaDelContenido(texto) {
  if (typeof texto !== 'string') return 'no es texto';
  if (texto.length < 20 || texto.length > 700) return 'largo';
  if (!/^[\x20-\x7e]+$/.test(texto)) return 'caracteres';
  if (!texto.startsWith('000201')) return 'inicio';
  const m = texto.match(/6304([0-9A-F]{4})$/);
  if (!m) return 'sin crc';
  if (crcHex(texto.slice(0, -4)) !== m[1]) return 'crc';
  // Los campos de primer nivel tienen que sumar exactamente el texto, y el 63 tiene que ser el último.
  let i = 0;
  let ultimo = '';
  while (i < texto.length) {
    if (!/^\d{4}$/.test(texto.slice(i, i + 4))) return 'estructura';
    const largo = Number(texto.slice(i + 2, i + 4));
    if (i + 4 + largo > texto.length) return 'estructura';
    ultimo = texto.slice(i, i + 4);   // etiqueta + largo: el último campo tiene que ser «6304» (el 63 de EXACTAMENTE 4), no cualquier 63
    i += 4 + largo;
  }
  return ultimo === '6304' ? null : 'estructura';
}

/**
 * La llave a la que cobra el contenido, escrita aparte y a propósito de otra manera que las del navegador: recorre los campos con un índice y
 * un objeto en vez de filtrar arreglos. null si no hay UN solo 26, con UN solo 00 «CO.COM.RBM.LLA» y UN solo 04.
 */
export function reglaDeLaLlave(texto) {
  const recorrer = (t) => {
    const mapa = {}; let i = 0;
    while (i < t.length) {
      if (!/^\d{4}$/.test(t.slice(i, i + 4))) return null;
      const largo = Number(t.slice(i + 2, i + 4)); const etiqueta = t.slice(i, i + 2);
      if (i + 4 + largo > t.length) return null;
      (mapa[etiqueta] ||= []).push(t.slice(i + 4, i + 4 + largo));
      i += 4 + largo;
    }
    return mapa;
  };
  if (typeof texto !== 'string') return null;
  const alto = recorrer(texto);
  if (!alto || !alto['26'] || alto['26'].length !== 1) return null;
  const bajo = recorrer(alto['26'][0]);
  if (!bajo || !bajo['00'] || bajo['00'].length !== 1 || !bajo['04'] || bajo['04'].length !== 1) return null;
  return bajo['00'][0] === 'CO.COM.RBM.LLA' ? bajo['04'][0] : null;
}

// ───────────────────────── vectores compartidos por la carta y el tablero ─────────────────────────
// [nombre, contenido, ¿sirve?]: la misma lista la corren la carta, el tablero y la regla de arriba; si una de las tres se aparta, la prueba lo dice.
export const VECTORES_QR = [
  ['el ficticio largo', QR_FICTICIO, true],
  ['el ficticio corto', QR_FICTICIO_CORTO, true],
  ['un carácter cambiado (el CRC ya no cuadra)', conUnCaracterCambiado(QR_FICTICIO), false],
  ['sin el campo 63', QR_FICTICIO.slice(0, -8), false],
  ['el CRC en minúscula (EMV pide mayúscula)', QR_FICTICIO.slice(0, -4) + QR_FICTICIO.slice(-4).toLowerCase(), QR_FICTICIO.slice(-4) === QR_FICTICIO.slice(-4).toLowerCase()],
  ['no empieza por 000201', emvConCrc([['00', '02'], ['01', '11'], ['53', '170'], ['58', 'CO'], ['59', '0'], ['60', '0']]), false],
  ['un espacio al final', QR_FICTICIO + ' ', false],
  ['un salto de línea dentro', QR_FICTICIO.slice(0, 50) + '\n' + QR_FICTICIO.slice(50), false],
  ['con una tilde (no es ASCII imprimible)', emvConCrc([['00', '01'], ['01', '11'], ['59', 'Rincón'], ['58', 'CO'], ['60', '0']]), false],
  ['muy corto', '000201', false],
  ['vacío', '', false],
  ['más de 700 caracteres (con CRC bueno)', emvConCrc([['00', '01'], ['01', '11'], ...Array.from({ length: 8 }, (_, i) => [String(26 + i), 'X'.repeat(99)]), ['58', 'CO']]), false],
  ['el último campo es un 63 de largo 08 con valor «6304» + CRC (termina como uno bueno)', (() => { const base = QR_FICTICIO.slice(0, -8) + '6308' + '6304'; return base + crcHex(base); })(), false],
  ['campos que no suman (el largo de un campo se pasa)', (() => { const base = '00020101021126990004abc'; return base + '6304' + crcHex(base + '6304'); })(), false],
  ['un número', 123, false],
  ['null', null, false],
  ['un objeto', { toString: () => QR_FICTICIO }, false],
];

// [llave, ¿sirve?]: la regla de los CHECK de `ajustes` (migración 20261003150000), que la función `cuenta`, la carta y el tablero repiten.
// (El tablero es igual de estricto en la llave; en el CRC en minúscula es más estricto: ver integracion-pago-breb.test.mjs.)
export const VECTORES_LLAVE = [
  ['@prueba.ficticia', true], ['@a', true], ['@' + 'x'.repeat(59), true], ['@' + 'x'.repeat(60), false], ['@a.b_c-d9', true],
  ['3001234567', true], ['12345', true], ['1234', false], ['1'.repeat(20), true], ['1'.repeat(21), false], ['+573001234567', true], ['+57300123456', false],
  ['nombre@correo.co', true], ['a.b+c@mail.ejemplo.co', true], ['nombre@correo', false],
  ['@con espacio', false], ['@con<tag>', false], ['@con"comilla', false], ["@con'comilla", false], ['@con`tilde', false], ['@con\\barra', false],
  ['@canción', false], ['@a;b', false], ['@a@b', false], ['@a/b', false], ['a/b@correo.co', false], ['ñandú@correo.co', false],
  ['', false], ['@', false], [' @espacio', false], ['@tab\t', false], [null, false], [undefined, false], [12345678, false], ['sin-arroba-ni-numero', false],
];

