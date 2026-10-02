// De los bytes ESC/POS a una vista de texto: lo que saldría en el papel, para mirarlo sin impresora.
//
// Lo usan `--simular` (escribe el .txt junto al .bin), `--vista-previa` y las pruebas (ida y vuelta:
// documento → bytes → texto). Solo entiende los comandos que escpos.mjs escribe; un byte de control que
// no conoce lo deja marcado como «‹0x1b›» en lugar de esconderlo, así un comando colado se ve.

import { TABLAS } from './tablas.mjs';

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const LF = 0x0a;

/**
 * @param {Uint8Array|Buffer} bytes
 * @param {{columnas?: number, tablaEscPos?: number}} [opciones] columnas del papel para centrar y alinear
 * @returns {string} texto con una línea por renglón impreso (sin espacios al final)
 */
export function bytesATexto(bytes, { columnas = 48, tablaEscPos = 2 } = {}) {
  const lineas = [];
  let tabla = tablaEscPos;
  let alinear = 0;
  let ancho = 1;                                 // 2 = doble ancho
  let actual = '';
  let qr = null;

  const decodificar = (b) => (b < 0x80 ? String.fromCharCode(b) : (TABLAS[tabla]?.alta[b - 128] ?? '?'));
  const cerrar = () => {
    const w = actual.length * ancho;
    const margen = alinear === 1 ? Math.max(0, Math.floor((columnas - w) / 2)) : alinear === 2 ? Math.max(0, columnas - w) : 0;
    lineas.push((' '.repeat(margen) + actual).replace(/\s+$/, ''));
    actual = '';
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === LF) { cerrar(); continue; }
    if (b === ESC) {
      const c = bytes[++i];
      if (c === 0x40) { alinear = 0; ancho = 1; tabla = tablaEscPos; }          // ESC @
      else if (c === 0x74) tabla = bytes[++i];                                   // ESC t n
      else if (c === 0x61) alinear = bytes[++i];                                 // ESC a n
      else if (c === 0x45) i++;                                                  // ESC E n (negrita)
      else if (c === 0x64) { const n = bytes[++i]; for (let k = 0; k < n; k++) lineas.push(''); }   // ESC d n
      else actual += `‹0x1b 0x${(c ?? 0).toString(16)}›`;
      continue;
    }
    if (b === GS) {
      const c = bytes[++i];
      if (c === 0x21) ancho = (bytes[++i] & 0x70) ? 2 : 1;                       // GS ! n
      else if (c === 0x56) {                                                     // GS V m [n]: corte
        const m = bytes[++i];
        const parcial = m === 0x42 || m === 0x01 || m === 0x31;
        if (m === 0x41 || m === 0x42) i++;
        lineas.push(`- - - - - - ✂ corte ${parcial ? 'parcial' : 'total'} - - - - - -`);
      } else if (c === 0x28 && bytes[i + 1] === 0x6b) {                          // GS ( k: QR
        const largo = bytes[i + 2] + bytes[i + 3] * 256;
        const cuerpo = bytes.slice(i + 4, i + 4 + largo);
        if (cuerpo[0] === 0x31 && cuerpo[1] === 0x50) qr = Buffer.from(cuerpo.slice(3)).toString('utf8');
        else if (cuerpo[0] === 0x31 && cuerpo[1] === 0x51) { lineas.push(...cajaQr(qr, columnas)); qr = null; }
        i += 3 + largo;
      } else actual += `‹0x1d 0x${(c ?? 0).toString(16)}›`;
      continue;
    }
    if (b === FS) { i++; continue; }                                             // FS .
    if (b < 0x20) { actual += `‹0x${b.toString(16).padStart(2, '0')}›`; continue; }
    actual += decodificar(b);
  }
  if (actual) cerrar();
  return lineas.join('\n') + '\n';
}

function cajaQr(texto, columnas) {
  const marco = `[ QR: ${texto ?? ''} ]`;
  const pad = ' '.repeat(Math.max(0, Math.floor((columnas - marco.length) / 2)));
  return [pad + marco];
}
