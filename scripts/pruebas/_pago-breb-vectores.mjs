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
// El último campo es un 63 de largo 08 cuyo VALOR es «6304» + el CRC: el contenido TERMINA en 6304XXXX como uno bueno y el CRC cuadra, pero el 63 no
// es «6304». La carta y el tablero lo aceptaban y la base lo rechaza (refutación R1, 2026-10-02).
function ultimoCampo63DeOcho(cuerpo) { const x = cuerpo + '6308' + '6304'; return x + hex4(crcPorTabla(x)); }
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
    ['el campo 63 mide 8 y su valor es «6304» + el CRC (termina como uno bueno)', ultimoCampo63DeOcho(cuerpo), 'ajustes_pago_breb_qr_crc'],
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

// ───────────────────────── el cruce llave ↔ QR ─────────────────────────
// La llave a la que cobra un QR es el subcampo 04 del ÚNICO campo 26 con el subcampo 00 «CO.COM.RBM.LLA» (privado.emv_llave, llaveDelQrBreb de la carta, del
// tablero y de la función). Los vectores: [nombre, QR, la llave que debe salir ('null' si ninguna), la llave que se intenta guardar con ese QR (o null), y qué debe
// pasar al guardar el par: 'ok' o el CHECK que lo rechaza]. TODOS los QR traen CRC bueno y pasan los demás CHECK: lo único que cambia es el cruce.
const lla = (llave) => tlv('00', 'CO.COM.RBM.LLA') + tlv('04', llave);
const comun = (cuentas, extra = '') => conCrc(tlv('00', '01') + tlv('01', '11') + cuentas + extra + tlv('53', '170') + tlv('58', 'CO') + tlv('59', '0') + tlv('60', '0'));
export const LLAVE_VISIBLE = '@casa.prueba';
export const LLAVE_OTRA = '@casa.prueba.otra';
export const QR_COBRA_A_OTRA = comun(tlv('26', lla(LLAVE_OTRA)));
export const QR_COBRA_A_OTRA_CON_LA_VISIBLE_EN_62 = comun(tlv('26', lla(LLAVE_OTRA)), tlv('62', tlv('07', LLAVE_VISIBLE)));
const RECHAZA = 'ajustes_pago_breb_qr_llave';
export function llaveQrVectores() {
  return [
    ['el QR ficticio de siempre', QR_FICTICIO, LLAVE_FICTICIA, LLAVE_FICTICIA, 'ok'],
    ['el otro QR ficticio', QR_FICTICIO_2, '@OtraFicticia9', '@OtraFicticia9', 'ok'],
    ['una llave de correo en el 26/04', comun(tlv('26', lla('caja@ejemplo.test'))), 'caja@ejemplo.test', 'caja@ejemplo.test', 'ok'],
    ['una llave numérica en el 26/04', comun(tlv('26', lla('3001234567'))), '3001234567', '3001234567', 'ok'],
    ['el 26 con más subcampos (el 05) además del 00 y el 04', comun(tlv('26', lla('@conextra') + tlv('05', 'EXTRA'))), '@conextra', '@conextra', 'ok'],
    ['el QR cobra a una llave que EMPIEZA por la que se muestra (@casa.prueba.otra / @casa.prueba)', QR_COBRA_A_OTRA, LLAVE_OTRA, LLAVE_VISIBLE, RECHAZA],
    ['…y guardando la llave que sí cobra', QR_COBRA_A_OTRA, LLAVE_OTRA, LLAVE_OTRA, 'ok'],
    ['el QR cobra a otra pero lleva la llave que se muestra metida en el 62/07', QR_COBRA_A_OTRA_CON_LA_VISIBLE_EN_62, LLAVE_OTRA, LLAVE_VISIBLE, RECHAZA],
    ['la llave que se muestra es un trozo de la del QR (por el final)', comun(tlv('26', lla('@prefijo.casa.prueba'))), '@prefijo.casa.prueba', LLAVE_VISIBLE, RECHAZA],
    ['mayúsculas distintas: la comparación es exacta', comun(tlv('26', lla('@CasaPrueba'))), '@CasaPrueba', '@casaprueba', RECHAZA],
    ['dos campos 26 (los dos con la red de la llave): ambiguo, ninguna', comun(tlv('26', lla('@primera')) + tlv('27', tlv('00', 'CO.COM.RBM.REF') + tlv('01', 'X')) + tlv('26', lla('@segunda'))), 'null', '@primera', RECHAZA],
    ['el 26 sin el subcampo 04', comun(tlv('26', tlv('00', 'CO.COM.RBM.LLA') + tlv('05', 'SOLO'))), 'null', LLAVE_VISIBLE, RECHAZA],
    ['el 26 con dos subcampos 04', comun(tlv('26', lla('@una') + tlv('04', '@dos'))), 'null', '@una', RECHAZA],
    ['el 26 con dos subcampos 00', comun(tlv('26', tlv('00', 'CO.COM.RBM.LLA') + lla('@una'))), 'null', '@una', RECHAZA],
    ['el 26 sin subcampo 00', comun(tlv('26', tlv('04', '@sinred'))), 'null', '@sinred', RECHAZA],
    ['el subcampo 00 no es CO.COM.RBM.LLA', comun(tlv('26', tlv('00', 'CO.COM.RBM.OTRA') + tlv('04', '@otrared'))), 'null', '@otrared', RECHAZA],
    ['la red de la llave pero en el campo 27 y no en el 26', comun(tlv('27', lla('@enelveintisiete'))), 'null', '@enelveintisiete', RECHAZA],
    ['sin ningún campo 26', comun(tlv('27', tlv('00', 'CO.COM.RBM.REF') + tlv('01', 'X'))), 'null', LLAVE_VISIBLE, RECHAZA],
    ['los subcampos del 26 no cierran (el largo del 04 se pasa del campo)', comun(tlv('26', tlv('00', 'CO.COM.RBM.LLA') + '0420@corta')), 'null', '@corta', RECHAZA],
    ['el subcampo 04 truncado (le faltan los dígitos del largo)', comun(tlv('26', tlv('00', 'CO.COM.RBM.LLA') + '04')), 'null', LLAVE_VISIBLE, RECHAZA],
    ['sin llave que guardar (solo se mira lo que devuelve emv_llave)', QR_FICTICIO_2, '@OtraFicticia9', null, null],
  ];
}
