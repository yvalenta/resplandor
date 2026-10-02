// Los datos de prueba del pago con Bre-B: TODO FICTICIO. Ninguna llave ni QR de estas pruebas es el del local (el dato real vive
// fuera del repo, que es público, y solo viaja en un sobre privado de datos).
//
// Aquí está además una segunda implementación del CRC-16/CCITT-FALSE, a propósito DISTINTA de las dos que se prueban (la de
// `privado.emv_crc_ok` en SQL, bit a bit, y la de `emvCrc16` en JS, bit a bit): esta va por tabla de 256 entradas y se fija con el
// valor de control estándar («123456789» → 0x29B1). Con ella se arman los QR de prueba, así que SQL y JS se prueban contra algo que
// no comparten.
//
// No termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre, solo lo importan las pruebas.

const TABLA = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

/** CRC-16/CCITT-FALSE por tabla (poly 0x1021, init 0xFFFF, sin reflejar, sin xor final). «123456789» → 0x29B1. */
export function crcPorTabla(texto) {
  let crc = 0xffff;
  for (const byte of Buffer.from(texto, 'utf8')) crc = ((crc << 8) & 0xffff) ^ TABLA[((crc >> 8) ^ byte) & 0xff];
  return crc;
}
export const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

/** Un campo TLV de EMVCo: etiqueta (2) + largo (2 dígitos) + valor. */
export const tlv = (etiqueta, valor) => etiqueta + String(valor.length).padStart(2, '0') + valor;

/** Cierra un contenido con el campo 63 y su CRC correcto. */
export const conCrc = (cuerpo) => { const base = cuerpo + '6304'; return base + hex4(crcPorTabla(base)); };

/** La llave de todas las pruebas: ficticia. */
export const LLAVE_FICTICIA = '@PruebaFicticia';

/** El cuerpo (sin el campo 63) de un QR estático de Bre-B de mentira, con la misma forma que los reales. */
export const cuerpoFicticio = (llave = LLAVE_FICTICIA) =>
  tlv('00', '01') + tlv('01', '11') +
  tlv('26', tlv('00', 'CO.COM.RBM.LLA') + tlv('04', llave)) +
  tlv('49', tlv('00', 'CO.COM.RBM.RED') + tlv('01', 'XXX')) +
  tlv('50', tlv('00', 'CO.COM.RBM.CU') + tlv('01', '00000000')) +
  tlv('51', tlv('00', 'CO.COM.RBM.CA') + tlv('01', '0')) +
  tlv('52', '0000') + tlv('53', '170') + tlv('58', 'CO') + tlv('59', '0') + tlv('60', '0') +
  tlv('62', tlv('05', 'PRUEBA-FICTICIA'));

/** El QR ficticio válido de las pruebas (y otro distinto, para comprobar que se entrega el que está en la base). */
export const QR_FICTICIO = conCrc(cuerpoFicticio());
export const QR_FICTICIO_2 = conCrc(cuerpoFicticio('@OtraFicticia9'));

/** Cambia UN carácter (el del medio) por otro distinto: el CRC deja de cuadrar. */
export function corromper(texto) {
  const i = Math.floor(texto.length / 2);
  return texto.slice(0, i) + (texto[i] === 'X' ? 'Y' : 'X') + texto.slice(i + 1);
}

/**
 * Un contenido EMV con el CRC válido y EXACTAMENTE n caracteres (n ≥ 14): «000201», campos de relleno «99» y el 63.
 * Sirve para los bordes de largo (20, 700 y 701).
 */
export function qrDeLargo(n) {
  let resto = n - 14;                                  // 6 de «000201» + 8 de «6304XXXX»
  if (resto < 0) throw new Error('mínimo 14 caracteres');
  let cuerpo = '000201';
  while (resto > 0) {
    let trozo = Math.min(103, resto);                  // un campo mide 4 + (0 a 99)
    if (resto - trozo > 0 && resto - trozo < 4) trozo = resto - 4;
    if (trozo < 4) throw new Error('largo imposible de armar con campos de relleno');
    cuerpo += '99' + String(trozo - 4).padStart(2, '0') + 'z'.repeat(trozo - 4);
    resto -= trozo;
  }
  const qr = conCrc(cuerpo);
  if (qr.length !== n) throw new Error(`salió de ${qr.length}, no de ${n}`);
  return qr;
}

// Dos contenidos que SOLO se rechazan por la forma del campo final: los últimos cuatro caracteres SÍ son el CRC de todo lo anterior.
function ultimoCampoQueNoEs63(cuerpo) { const x = cuerpo + '9904'; return x + hex4(crcPorTabla(x)); }
function ultimoCampo63DeCinco(cuerpo) { const x = cuerpo + '6305X'; return x + hex4(crcPorTabla(x)); }
// El contenido termina en «6304AB»: el campo 63 queda TRUNCADO (dice 4 caracteres y solo trae 2). Los últimos cuatro caracteres, «04AB»,
// SON el CRC de todo lo anterior: se busca (determinista) un relleno que lo logre. Solo lo rechaza que los campos cierren justo al final.
function ultimoCampo63Truncado(cuerpo) {
  for (let i = 0; i < 4_000_000; i++) {
    const cuerpoConRelleno = cuerpo + '9906' + i.toString(36).padStart(6, '0');
    if (hex4(crcPorTabla(cuerpoConRelleno + '63')) === '04AB') return cuerpoConRelleno + '6304AB';
  }
  throw new Error('no se encontró un relleno que cuadre el CRC truncado');
}

/**
 * Lo que un QR EMV de Bre-B real NUNCA debería traer y los CHECK deben rechazar. [nombre, valor, el CHECK que lo rechaza].
 * Postgres revisa los CHECK en orden alfabético de nombre y reporta el primero que falla: aquí va ese (ascii < crc < inicio < largo).
 */
export function qrMalos() {
  const cuerpo = cuerpoFicticio();
  const resto = cuerpo.slice(6);                       // sin el «000201» del inicio
  return [
    ['no empieza por 000201 (000202), con CRC válido', conCrc('000202' + resto), 'ajustes_pago_breb_qr_inicio'],
    ['empieza por otro campo, con CRC válido', conCrc(resto), 'ajustes_pago_breb_qr_inicio'],
    ['CRC malo: un carácter cambiado', corromper(QR_FICTICIO), 'ajustes_pago_breb_qr_crc'],
    ['CRC malo: otros cuatro hexadecimales', QR_FICTICIO.slice(0, -4) + (QR_FICTICIO.endsWith('0000') ? '0001' : '0000'), 'ajustes_pago_breb_qr_crc'],
    ['CRC malo: el contenido sin el campo 63', cuerpo, 'ajustes_pago_breb_qr_crc'],
    ['CRC con letras que no son hexadecimales', QR_FICTICIO.slice(0, -4) + 'ZZZZ', 'ajustes_pago_breb_qr_crc'],
    ['el campo 63 no es el último (cola de más), con CRC válido en el 63', conCrc(cuerpo) + tlv('99', 'XX'), 'ajustes_pago_breb_qr_crc'],
    ['el largo de un campo se pasa del final, con CRC calculado igual', conCrc(cuerpo + '9999abc'), 'ajustes_pago_breb_qr_crc'],
    ['etiqueta que no son dígitos, con CRC calculado igual', conCrc(cuerpo + 'ab02xy'), 'ajustes_pago_breb_qr_crc'],
    ['salto de línea adentro, con CRC válido', conCrc(cuerpo + tlv('99', 'a\nb')), 'ajustes_pago_breb_qr_ascii'],
    ['tabulador adentro, con CRC válido', conCrc(cuerpo + tlv('99', 'a\tb')), 'ajustes_pago_breb_qr_ascii'],
    ['carácter no ASCII (ñandú), con CRC válido', conCrc(cuerpo + tlv('99', 'ñandú')), 'ajustes_pago_breb_qr_ascii'],
    ['carácter de control (0x01), con CRC válido', conCrc(cuerpo + tlv('99', 'a\u0001b')), 'ajustes_pago_breb_qr_ascii'],
    ['demasiado corto: 14 caracteres con CRC válido', qrDeLargo(14), 'ajustes_pago_breb_qr_largo'],
    ['demasiado corto: 19 caracteres con CRC válido', qrDeLargo(19), 'ajustes_pago_breb_qr_largo'],
    ['demasiado largo: 701 caracteres con CRC válido', qrDeLargo(701), 'ajustes_pago_breb_qr_largo'],
    ['demasiado largo: 1000 caracteres con CRC válido', qrDeLargo(1000), 'ajustes_pago_breb_qr_largo'],
    ['el último campo es el 99 y no el 63, con un «CRC» que cuadra', ultimoCampoQueNoEs63(cuerpo), 'ajustes_pago_breb_qr_crc'],
    ['el campo 63 mide 5 y no 4, con el CRC cuadrado al final', ultimoCampo63DeCinco(cuerpo), 'ajustes_pago_breb_qr_crc'],
    ['el campo 63 está truncado (6304AB), con los últimos 4 caracteres cuadrando como CRC', ultimoCampo63Truncado(cuerpo), 'ajustes_pago_breb_qr_crc'],
    ['cadena vacía', '', 'ajustes_pago_breb_qr_ascii'],
    ['solo espacios', ' '.repeat(30), 'ajustes_pago_breb_qr_crc'],
  ];
}

/** Llaves que SÍ y que NO. */
export const LLAVES_BUENAS = [
  '@PruebaFicticia', '@ab', '@' + 'a'.repeat(59), '@a.b_c-d9',
  '3001234567', '12345', '1'.repeat(20), '+573001234567',
  'caja@ejemplo.test', 'a.b+c@mail.ejemplo.co',
  'a'.repeat(30) + '@' + 'b'.repeat(26) + '.co',   // un correo de EXACTAMENTE 60 caracteres
];
export const LLAVES_MALAS = [
  ['vacía', ''], ['un solo carácter', '@'], ['sin @ ni forma', 'hola'], ['letras sin arroba', 'abcdef'],
  ['con espacio', '@hola mundo'], ['espacio al inicio', ' @hola'], ['espacio al final', '@hola '], ['salto de línea', '@hola\nmundo'],
  ['tabulador', '@ho\tla'], ['menor que', '@a<b'], ['mayor que', '@a>b'], ['comilla doble', '@a"b'], ['comilla simple', "@a'b"],
  ['acento grave', '@a`b'], ['contrabarra', '@a\\b'], ['etiqueta script', '<script>alert(1)</script>'],
  ['61 caracteres', '@' + 'a'.repeat(60)], ['número corto (4 dígitos)', '1234'], ['número de 21 dígitos', '1'.repeat(21)],
  ['celular con letras', '300123456a'], ['+57 con 9 dígitos', '+57300123456'], ['correo sin dominio', 'a@b'], ['correo sin punto', 'a@localhost'],
  ['correo de 62 caracteres', 'a'.repeat(30) + '@' + 'b'.repeat(28) + '.co'],
  ['dos arrobas', '@a@b'], ['arroba y punto y coma', '@a;b'], ['con tilde', '@canción'],
];

/** Un token de mesa y datos de órdenes para la prueba de la función (los mismos de fn-cuenta.test.mjs, en pequeño). */
export const TOKEN_MESA_3 = '0'.repeat(48);
export const TOKEN_MESA_4 = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a3928';
