// Decodificador de QR PARA PRUEBAS: toma la matriz de módulos (arreglo de filas de booleanos, true = oscuro, sin margen) y devuelve el
// texto que un lector sacaría de ella. Existe para una sola cosa: comprobar que el QR que el POS genera en el navegador (librería
// `qrcode-generator`, versión fija) SE LEE y dice lo mismo que el SVG estático que reemplazó (generado con el paquete `qrcode`). Las
// dos matrices NO son idénticas módulo a módulo (cada librería elige otra máscara de las 8 válidas), así que comparar módulos no
// sirve: lo que importa es lo que dicen al leerlas.
//
// Hace lo que un lector real: lee la información de formato (con su BCH, tolerando hasta 3 bits malos), des-enmascara, recorre los
// módulos en zigzag, separa los bloques, COMPRUEBA que los codewords de corrección de errores (Reed-Solomon) sean exactos y lee el
// modo byte. Solo versiones 1 a 10 y corrección M (la del ticket); fuera de eso lanza. Verificado contra la matriz del paquete
// `qrcode` y, a mano, con CoreImage de macOS (el detector de QR del sistema) sobre las mismas dos matrices.
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre como prueba.

// versión → [codewords de corrección por bloque, [[cantidad de bloques, codewords de datos por bloque], …]], nivel M
const BLOQUES_M = {
  1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
  6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]],
};
const ALINEACION = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

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
  const centros = ALINEACION[v];
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
  if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error(`versión ${v} fuera de lo que este decodificador sabe (1 a 10)`);

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
  if (nivel !== 'M') throw new Error(`corrección ${nivel}: este decodificador solo sabe M`);

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
  const [ec, grupos] = BLOQUES_M[v];
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
