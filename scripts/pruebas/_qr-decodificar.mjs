// Decodificador de QR PARA PRUEBAS: toma la matriz de módulos (arreglo de filas de booleanos, true = oscuro, sin margen) y devuelve el
// texto que un lector sacaría de ella. Existe para comprobar que el QR que el POS y la carta generan en el navegador (librería
// `qrcode-generator`, versión fija) SE LEE y dice lo que debe: el del ticket (una dirección corta, versión 3 a 5) y el de Bre-B (el
// contenido EMV de un QR de pago, de 400 a 700 caracteres: versiones 14 a 21). Las matrices NO son idénticas módulo a módulo entre
// librerías (cada una elige otra máscara de las 8 válidas), así que comparar módulos no sirve: lo que importa es lo que dicen al leerlas.
//
// Hace lo que un lector real: lee la información de formato (con su BCH, tolerando hasta 3 bits malos), des-enmascara, recorre los
// módulos en zigzag, separa los bloques, COMPRUEBA que los codewords de corrección de errores (Reed-Solomon) sean exactos y lee el
// modo byte. Versiones 1 a 40 y los cuatro niveles (L, M, Q, H); solo el modo byte (el que usa la librería sin pedirlo). Verificado contra
// la matriz del paquete `qrcode` y, a mano, con CoreImage de macOS (el detector de QR del sistema) sobre las mismas matrices.
// Las tablas de bloques y de alineación son las del estándar (ISO/IEC 18004) tal como las trae la librería; una prueba
// (pago-breb-qr.test.mjs) las compara con las del archivo de assets/vendor/ para que no se desvíen.
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre como prueba.

// nivel → versión 1..40 → [codewords de corrección por bloque, [[cantidad de bloques, codewords de datos por bloque], …]]
export const BLOQUES = {
  L: [[7,[[1,19]]],[10,[[1,34]]],[15,[[1,55]]],[20,[[1,80]]],[26,[[1,108]]],[18,[[2,68]]],[20,[[2,78]]],[24,[[2,97]]],[30,[[2,116]]],[18,[[2,68],[2,69]]],[20,[[4,81]]],[24,[[2,92],[2,93]]],[26,[[4,107]]],[30,[[3,115],[1,116]]],[22,[[5,87],[1,88]]],[24,[[5,98],[1,99]]],[28,[[1,107],[5,108]]],[30,[[5,120],[1,121]]],[28,[[3,113],[4,114]]],[28,[[3,107],[5,108]]],[28,[[4,116],[4,117]]],[28,[[2,111],[7,112]]],[30,[[4,121],[5,122]]],[30,[[6,117],[4,118]]],[26,[[8,106],[4,107]]],[28,[[10,114],[2,115]]],[30,[[8,122],[4,123]]],[30,[[3,117],[10,118]]],[30,[[7,116],[7,117]]],[30,[[5,115],[10,116]]],[30,[[13,115],[3,116]]],[30,[[17,115]]],[30,[[17,115],[1,116]]],[30,[[13,115],[6,116]]],[30,[[12,121],[7,122]]],[30,[[6,121],[14,122]]],[30,[[17,122],[4,123]]],[30,[[4,122],[18,123]]],[30,[[20,117],[4,118]]],[30,[[19,118],[6,119]]]],
  M: [[10,[[1,16]]],[16,[[1,28]]],[26,[[1,44]]],[18,[[2,32]]],[24,[[2,43]]],[16,[[4,27]]],[18,[[4,31]]],[22,[[2,38],[2,39]]],[22,[[3,36],[2,37]]],[26,[[4,43],[1,44]]],[30,[[1,50],[4,51]]],[22,[[6,36],[2,37]]],[22,[[8,37],[1,38]]],[24,[[4,40],[5,41]]],[24,[[5,41],[5,42]]],[28,[[7,45],[3,46]]],[28,[[10,46],[1,47]]],[26,[[9,43],[4,44]]],[26,[[3,44],[11,45]]],[26,[[3,41],[13,42]]],[26,[[17,42]]],[28,[[17,46]]],[28,[[4,47],[14,48]]],[28,[[6,45],[14,46]]],[28,[[8,47],[13,48]]],[28,[[19,46],[4,47]]],[28,[[22,45],[3,46]]],[28,[[3,45],[23,46]]],[28,[[21,45],[7,46]]],[28,[[19,47],[10,48]]],[28,[[2,46],[29,47]]],[28,[[10,46],[23,47]]],[28,[[14,46],[21,47]]],[28,[[14,46],[23,47]]],[28,[[12,47],[26,48]]],[28,[[6,47],[34,48]]],[28,[[29,46],[14,47]]],[28,[[13,46],[32,47]]],[28,[[40,47],[7,48]]],[28,[[18,47],[31,48]]]],
  Q: [[13,[[1,13]]],[22,[[1,22]]],[18,[[2,17]]],[26,[[2,24]]],[18,[[2,15],[2,16]]],[24,[[4,19]]],[18,[[2,14],[4,15]]],[22,[[4,18],[2,19]]],[20,[[4,16],[4,17]]],[24,[[6,19],[2,20]]],[28,[[4,22],[4,23]]],[26,[[4,20],[6,21]]],[24,[[8,20],[4,21]]],[20,[[11,16],[5,17]]],[30,[[5,24],[7,25]]],[24,[[15,19],[2,20]]],[28,[[1,22],[15,23]]],[28,[[17,22],[1,23]]],[26,[[17,21],[4,22]]],[30,[[15,24],[5,25]]],[28,[[17,22],[6,23]]],[30,[[7,24],[16,25]]],[30,[[11,24],[14,25]]],[30,[[11,24],[16,25]]],[30,[[7,24],[22,25]]],[28,[[28,22],[6,23]]],[30,[[8,23],[26,24]]],[30,[[4,24],[31,25]]],[30,[[1,23],[37,24]]],[30,[[15,24],[25,25]]],[30,[[42,24],[1,25]]],[30,[[10,24],[35,25]]],[30,[[29,24],[19,25]]],[30,[[44,24],[7,25]]],[30,[[39,24],[14,25]]],[30,[[46,24],[10,25]]],[30,[[49,24],[10,25]]],[30,[[48,24],[14,25]]],[30,[[43,24],[22,25]]],[30,[[34,24],[34,25]]]],
  H: [[17,[[1,9]]],[28,[[1,16]]],[22,[[2,13]]],[16,[[4,9]]],[22,[[2,11],[2,12]]],[28,[[4,15]]],[26,[[4,13],[1,14]]],[26,[[4,14],[2,15]]],[24,[[4,12],[4,13]]],[28,[[6,15],[2,16]]],[24,[[3,12],[8,13]]],[28,[[7,14],[4,15]]],[22,[[12,11],[4,12]]],[24,[[11,12],[5,13]]],[24,[[11,12],[7,13]]],[30,[[3,15],[13,16]]],[28,[[2,14],[17,15]]],[28,[[2,14],[19,15]]],[26,[[9,13],[16,14]]],[28,[[15,15],[10,16]]],[30,[[19,16],[6,17]]],[24,[[34,13]]],[30,[[16,15],[14,16]]],[30,[[30,16],[2,17]]],[30,[[22,15],[13,16]]],[30,[[33,16],[4,17]]],[30,[[12,15],[28,16]]],[30,[[11,15],[31,16]]],[30,[[19,15],[26,16]]],[30,[[23,15],[25,16]]],[30,[[23,15],[28,16]]],[30,[[19,15],[35,16]]],[30,[[11,15],[46,16]]],[30,[[59,16],[1,17]]],[30,[[22,15],[41,16]]],[30,[[2,15],[64,16]]],[30,[[24,15],[46,16]]],[30,[[42,15],[32,16]]],[30,[[10,15],[67,16]]],[30,[[20,15],[61,16]]]],
};
// versión 1..40 → centros de los patrones de alineación
export const ALINEACION = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]];

// Campo de Galois GF(256), polinomio 0x11d.
const EXP = new Array(512); const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Los `grado` codewords de corrección de un bloque de datos. */
function correccion(datos, grado) {
  let gen = [1];
  for (let i = 0; i < grado; i++) {
    const sig = new Array(gen.length + 1).fill(0);
    gen.forEach((g, j) => { sig[j] ^= g; sig[j + 1] ^= mul(g, EXP[i]); });
    gen = sig;
  }
  const resto = [...datos, ...new Array(grado).fill(0)];
  for (let i = 0; i < datos.length; i++) {
    const f = resto[i];
    if (f) gen.forEach((g, j) => { resto[i + j] ^= mul(g, f); });
  }
  return resto.slice(datos.length);
}

const bchFormato = (datos) => {
  let d = datos << 10;
  for (let i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= 0x537 << (i - 10);
  return ((datos << 10) | d) ^ 0x5412;
};
const bits = (n) => { let c = 0; for (; n; n &= n - 1) c++; return c; };

const MASCARAS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** Módulos que NO llevan datos: buscadores, separadores, formato, sincronía, alineación e información de versión. */
function esFuncion(n, v, r, c) {
  if (r <= 8 && c <= 8) return true;
  if (r <= 8 && c >= n - 8) return true;
  if (r >= n - 8 && c <= 8) return true;
  if (r === 6 || c === 6) return true;
  if (v >= 7 && ((r <= 5 && c >= n - 11 && c <= n - 9) || (c <= 5 && r >= n - 11 && r <= n - 9))) return true;
  const centros = ALINEACION[v - 1];
  for (const cy of centros) {
    for (const cx of centros) {
      const enBuscador = (cy === centros[0] && cx === centros[0]) || (cy === centros[0] && cx === centros.at(-1)) || (cy === centros.at(-1) && cx === centros[0]);
      if (!enBuscador && Math.abs(r - cy) <= 2 && Math.abs(c - cx) <= 2) return true;
    }
  }
  return false;
}

/** @returns {{version:number, nivel:string, mascara:number, texto:string, bytes:number[]}} */
export function decodificarQr(m) {
  const n = m.length;
  if (!m.every((fila) => fila.length === n)) throw new Error('la matriz no es cuadrada');
  const v = (n - 17) / 4;
  if (!Number.isInteger(v) || v < 1 || v > 40) throw new Error(`versión ${v} fuera de lo que este decodificador sabe (1 a 40)`);

  // Información de formato (primera copia): 15 bits, MSB primero.
  const lee = (r, c) => (m[r][c] ? 1 : 0);
  let formato = 0;
  for (let i = 0; i < 6; i++) formato = (formato << 1) | lee(8, i);
  formato = (formato << 1) | lee(8, 7);
  formato = (formato << 1) | lee(8, 8);
  formato = (formato << 1) | lee(7, 8);
  for (let j = 5; j >= 0; j--) formato = (formato << 1) | lee(j, 8);
  let mejor = null;
  for (let d = 0; d < 32; d++) {
    const dist = bits(bchFormato(d) ^ formato);
    if (!mejor || dist < mejor.dist) mejor = { d, dist };
  }
  if (mejor.dist > 3) throw new Error('la información de formato no es válida');
  const nivel = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' }[mejor.d >> 3];
  const mascara = mejor.d & 7;

  // Módulos de datos en zigzag, de abajo a la derecha, de dos en dos columnas (salta la de sincronía), des-enmascarados.
  const flujo = [];
  let arriba = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let k = 0; k < n; k++) {
      const r = arriba ? n - 1 - k : k;
      for (const cc of [c, c - 1]) {
        if (esFuncion(n, v, r, cc)) continue;
        flujo.push((m[r][cc] ? 1 : 0) ^ (MASCARAS[mascara](r, cc) ? 1 : 0));
      }
    }
    arriba = !arriba;
  }
  const [ec, grupos] = BLOQUES[nivel][v - 1];
  const bloques = grupos.flatMap(([cant, datos]) => new Array(cant).fill(datos));
  const total = bloques.reduce((s, d) => s + d + ec, 0);
  const codewords = [];
  for (let i = 0; i + 8 <= flujo.length && codewords.length < total; i += 8) codewords.push(parseInt(flujo.slice(i, i + 8).join(''), 2));
  if (codewords.length !== total) throw new Error(`faltan codewords: ${codewords.length} de ${total}`);

  // Des-intercalar datos y corrección, y exigir que la corrección sea la exacta de cada bloque.
  const datosDe = bloques.map(() => []);
  const eccDe = bloques.map(() => []);
  let p = 0;
  const maxDatos = Math.max(...bloques);
  for (let i = 0; i < maxDatos; i++) bloques.forEach((d, b) => { if (i < d) datosDe[b].push(codewords[p++]); });
  for (let i = 0; i < ec; i++) bloques.forEach((_, b) => { eccDe[b].push(codewords[p++]); });
  bloques.forEach((_, b) => {
    const esperado = correccion(datosDe[b], ec);
    if (esperado.join(',') !== eccDe[b].join(',')) throw new Error(`la corrección de errores del bloque ${b} no coincide: el código no se leería`);
  });

  // Datos: modo byte (0100), cuenta de 8 bits (versión < 10), bytes.
  const sec = datosDe.flat().map((x) => x.toString(2).padStart(8, '0')).join('');
  if (sec.slice(0, 4) !== '0100') throw new Error(`modo ${sec.slice(0, 4)}: solo se sabe el modo byte`);
  const cuenta = parseInt(sec.slice(4, 4 + (v < 10 ? 8 : 16)), 2);
  const ini = 4 + (v < 10 ? 8 : 16);
  const bytes = Array.from({ length: cuenta }, (_, i) => parseInt(sec.slice(ini + i * 8, ini + i * 8 + 8), 2));
  return { version: v, nivel, mascara, texto: new TextDecoder('utf-8').decode(Uint8Array.from(bytes)), bytes };
}

/** La matriz de módulos de un SVG como el del ticket (<path d="M0 0.5h7M…">: rachas horizontales, en absolutos o en relativos). */
export function matrizDeSvg(svg) {
  const caja = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const d = svg.match(/<path[^>]*\sd="([^"]+)"/);
  if (!caja || !d) throw new Error('no es un SVG de QR con viewBox y path');
  const n = Number(caja[1]);
  const mat = Array.from({ length: n }, () => new Array(n).fill(false));
  let x = 0; let y = 0; let t;
  const re = /([Mmh])\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?/g;
  while ((t = re.exec(d[1]))) {
    if (t[1] === 'M') { x = Number(t[2]); y = Number(t[3]); }
    else if (t[1] === 'm') { x += Number(t[2]); y += Number(t[3]); }
    else { const largo = Number(t[2]); const fila = Math.floor(y); for (let i = 0; i < largo; i++) mat[fila][x + i] = true; x += largo; }
  }
  return mat;
}

/**
 * La matriz de módulos de un SVG como el de la carta y el del tablero de Bre-B: un <rect> blanco de fondo y UN <path fill="black"> de rectángulos
 * `M x y h w v1 h-w z` (una racha de módulos oscuros por cada uno), con una zona de silencio de `margen` módulos adentro del viewBox.
 * Devuelve { matriz (sin margen), lado, margen, fondoBlanco, trazoNegro }: comprueba que los módulos oscuros nunca caigan en el margen.
 */
export function matrizDeSvgConMargen(svg, margen = 4) {
  const caja = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const d = svg.match(/<path\b[^>]*\sd="([^"]+)"/);
  if (!caja || !d || caja[1] !== caja[2]) throw new Error('no es un SVG de QR cuadrado con viewBox y path');
  const lado = Number(caja[1]);
  const n = lado - 2 * margen;
  const matriz = Array.from({ length: n }, () => new Array(n).fill(false));
  const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
  let t;
  let resto = d[1];
  while ((t = re.exec(d[1]))) {
    const [x, y, w, w2] = [Number(t[1]), Number(t[2]), Number(t[3]), Number(t[4])];
    if (w !== w2) throw new Error('un rectángulo con ancho distinto de ida y vuelta');
    if (x < margen || y < margen || x + w > lado - margen || y >= lado - margen) throw new Error(`un módulo oscuro cae en la zona de silencio (x=${x}, y=${y}, w=${w})`);
    for (let i = 0; i < w; i++) matriz[y - margen][x - margen + i] = true;
    resto = resto.replace(t[0], '');
  }
  if (resto.trim() !== '') throw new Error(`el path trae algo que no es un rectángulo de módulos: «${resto.slice(0, 40)}»`);
  return {
    matriz, lado, margen,
    fondoBlanco: new RegExp(`<rect width="${lado}" height="${lado}" fill="white"/>`).test(svg),
    trazoNegro: /<path fill="black"/.test(svg),
  };
}
