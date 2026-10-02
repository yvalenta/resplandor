// Del documento de la cola a los bytes ESC/POS de la térmica. Sin dependencias.
//
// Entra el `contenido` de una fila de `impresiones` (JSON que armó el POS) y salen los bytes que se le
// mandan RAW a la impresora. El agente NO confía en ese JSON: lo puede escribir cualquier cuenta del
// personal y el nombre de un producto lo teclea una persona. Por eso hay una sola puerta hacia los bytes:
//
//   texto → limpiarTexto (quita todo lo de control) → aImprimible (solo lo que la tabla sabe dibujar)
//         → distribución en columnas → codificar (bytes 0x20-0x7E y 0x80-0xFF)
//
// Los únicos bytes por debajo de 0x20 que salen de aquí son los comandos que ESTE archivo escribe a mano
// (ESC @, ESC t, ESC a, ESC E, GS !, GS ( k, GS V, ESC d, LF). Un nombre de producto con \x1b o \x1d no
// puede mandarle comandos a la impresora (prueba: scripts/pruebas/impresora-escpos.test.mjs).
//
// ── FORMATO DEL DOCUMENTO (`impresiones.contenido`) ──────────────────────────────────────────────────
// Lo que el POS inserta. Todo es opcional salvo que haya algo que imprimir (titulo, lineas o qr):
//
//   {
//     "titulo": "RESPLANDOR",                 // centrado, negrita, el doble de grande (alto y ancho si cabe)
//     "lineas": [                             // cada una es un texto o un objeto:
//       "Mesa 4",                             //   texto suelto
//       { "texto": "Fecha", "der": "01/10/2026" },      // izquierda + derecha en la misma línea (precio)
//       { "texto": "2x Hamburguesa", "der": "$ 56.000" },
//       { "texto": "  sin cebolla" },         //   sublínea: los espacios del comienzo son la sangría
//       { "texto": "Nota larga ...", "sangria": 4 },    //   o sangría explícita (columnas)
//       { "texto": "----" },                  //   tres o más '-', '=', '_', '*', '.', '~' o '#': regla de lado a lado
//       { "texto": "TOTAL", "der": "$ 56.000", "negrita": true },
//       { "texto": "Gracias por su visita", "alinear": "centro" },     // izq | centro | der
//       { "texto": "Abonos", "doble": true }  // doble alto; "ancho" = doble ancho; "ambos" = las dos cosas
//       { "texto": "…", "columnas": 48 }      // (raro) distribuir esta línea como si el papel tuviera 48 columnas;
//                                             //   la usa la página de prueba para medir el papel (16 a 80)
//     ],
//     "qr": "https://resplandor.ynt.codes/t/abc",     // o { "texto": "...", "etiqueta": "Tu cuenta", "tamano": 6 }
//     "cortar": true                          // false = no corta (solo avanza el papel)
//   }
//
// Equivalencias que se aceptan por comodidad del POS: `izq` es `texto`; dentro de `texto`, un TAB separa
// izquierda y derecha ("2x Café\t$ 8.000"); un salto de línea (\n) parte el texto en varias líneas con el
// mismo estilo. Una línea que no cabe se parte en palabras (la sangría se repite) y el precio de la derecha
// queda en la primera, sin partirse nunca. Las claves desconocidas se ignoran.
//
// Qué NO hace: no calcula precios ni totales (el POS ya mandó el texto), no pone fechas y no abre el cajón.

import { TABLAS } from './tablas.mjs';

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const LF = 0x0a;

export const MAX_LINEAS = 500;        // líneas por documento
export const MAX_RENGLONES = 600;     // renglones FÍSICOS de papel por ticket (~2,25 m): un ticket de verdad ronda 20-60; las líneas
                                      // largas se parten y un «\n» suma uno, así que MAX_LINEAS solo no acota el papel (8 líneas con
                                      // 1.998 «\n» cada una salían en ~16.000 renglones: un rollo entero)
export const MAX_BYTES = 128 * 1024;  // bytes por trabajo (un ticket de verdad ronda 1-3 KB)
export const MAX_CAMPO = 2000;        // caracteres por campo de texto
export const MAX_QR = 400;            // bytes del texto de un QR

export class ErrorDocumento extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorDocumento';
  }
}

export const OPCIONES_POR_DEFECTO = Object.freeze({
  columnas: 48,          // 48 (80 mm, letra A), 42 (80 mm, algunos modelos) o 32 (58 mm)
  tablaEscPos: 2,        // ESC t n: 2 = PC850 (tildes y ñ en español)
  cortar: 'parcial',     // 'parcial' | 'total' | 'no'
  qrNativo: true,        // GS ( k; si la impresora no lo entiende, false imprime la dirección como texto
  qrTamano: 6,           // tamaño del módulo del QR, 1 a 16 (6 = unos 200 puntos con una URL corta)
  avance: 3,             // líneas en blanco antes del corte (la cuchilla queda más abajo que la cabeza)
  cancelarKanji: false,  // FS . — solo para clones chinos que muestran ideogramas en vez de tildes
});

/** Completa y valida las opciones del formateador. Lanza Error (en español) si algo no sirve. */
export function resolverOpciones(entrada = {}) {
  const o = { ...OPCIONES_POR_DEFECTO };
  for (const k of Object.keys(OPCIONES_POR_DEFECTO)) if (entrada[k] !== undefined) o[k] = entrada[k];
  if (!Number.isInteger(o.columnas) || o.columnas < 16 || o.columnas > 80) {
    throw new Error(`columnas debe ser un número entero entre 16 y 80 (normal: 32, 42 o 48); llegó ${JSON.stringify(o.columnas)}`);
  }
  if (!Number.isInteger(o.tablaEscPos) || !TABLAS[o.tablaEscPos]) {
    throw new Error(`tablaEscPos ${JSON.stringify(o.tablaEscPos)} no está soportada; usa ${Object.entries(TABLAS).map(([n, t]) => `${n} (${t.nombre})`).join(', ')}`);
  }
  if (o.cortar === true) o.cortar = 'parcial';
  else if (o.cortar === false) o.cortar = 'no';
  if (!['parcial', 'total', 'no'].includes(o.cortar)) {
    throw new Error(`cortar debe ser true, false, "parcial" o "total"; llegó ${JSON.stringify(o.cortar)}`);
  }
  if (typeof o.qrNativo !== 'boolean') throw new Error('qrNativo debe ser true o false');
  if (typeof o.cancelarKanji !== 'boolean') throw new Error('cancelarKanji debe ser true o false');
  if (!Number.isInteger(o.qrTamano) || o.qrTamano < 1 || o.qrTamano > 16) throw new Error('qrTamano debe ser un entero de 1 a 16');
  if (!Number.isInteger(o.avance) || o.avance < 0 || o.avance > 20) throw new Error('avance debe ser un entero de 0 a 20');
  return o;
}

// ───────────────────────── 1. limpieza: la única puerta ─────────────────────────

const RE_SUBROGADOS = /[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g;      // emojis y mitades sueltas
const RE_SALTOS = /\r\n?|\u2028|\u2029|\u0085/g;
const RE_CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;                          // todo menos \t (09) y \n (0a)
const RE_INVISIBLES = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufe00-\ufe0f]/g;
const RE_ESPACIOS = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;

/**
 * Cualquier valor → texto sin bytes de control. Conserva solo \n y \t (los usa el formato, ver arriba).
 * Un objeto, null o undefined dan ''. Quita emojis, caracteres invisibles y de dirección.
 */
export function limpiarTexto(valor) {
  let s = '';
  if (typeof valor === 'string') s = valor;
  else if (typeof valor === 'number' && Number.isFinite(valor)) s = String(valor);
  else if (typeof valor === 'bigint') s = String(valor);
  if (s.length > MAX_CAMPO) s = s.slice(0, MAX_CAMPO);
  return s
    .normalize('NFC')
    .replace(RE_SUBROGADOS, '')
    .replace(RE_SALTOS, '\n')
    .replace(RE_CONTROL, '')
    .replace(RE_INVISIBLES, '')
    .replace(RE_ESPACIOS, ' ');
}

const unaLinea = (valor) => limpiarTexto(valor).replace(/[\n\t]+/g, ' ');

// Lo que no está en la tabla se cambia por algo parecido y, si no, por '?'. Todo ASCII imprimible.
const SUSTITUTOS = new Map(Object.entries({
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '`': "'",
  '“': '"', '”': '"', '„': '"', '″': '"', '«': '"', '»': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...', '•': '*', '‣': '>', '◦': 'o', '€': 'EUR', '™': 'TM', '№': 'No.', '℅': 'c/o',
  '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '×': 'x', '÷': '/',
  'Œ': 'OE', 'œ': 'oe', 'ß': 'ss', 'Æ': 'AE', 'æ': 'ae',
}));

const inversas = new Map();
function inversaDe(numero) {
  let inv = inversas.get(numero);
  if (!inv) {
    inv = new Map();
    const alta = TABLAS[numero].alta;
    for (let i = 0; i < 128; i++) {
      const c = alta[i];
      if (c !== '\ufffd' && c !== '\u00a0' && c !== '\u00ad' && !inv.has(c)) inv.set(c, 128 + i);
    }
    inversas.set(numero, inv);
  }
  return inv;
}

function caracterImprimible(c, inv) {
  const cp = c.codePointAt(0);
  if (cp >= 0x20 && cp <= 0x7e) return c;
  if (inv.has(c)) return c;
  if (SUSTITUTOS.has(c)) return SUSTITUTOS.get(c);
  const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (base !== c && /^[\x20-\x7e]+$/.test(base)) return base;
  return '?';
}

/**
 * Deja solo lo que la tabla puede dibujar: ASCII 0x20-0x7E y los caracteres de la mitad alta. Después de esto,
 * cada carácter de la cadena es exactamente un byte (y una columna del papel).
 */
export function aImprimible(texto, tablaEscPos = OPCIONES_POR_DEFECTO.tablaEscPos) {
  const inv = inversaDe(tablaEscPos);
  let r = '';
  for (const c of texto) r += caracterImprimible(c, inv);
  return r;
}

/** Texto ya imprimible → bytes de la tabla. Nunca da un byte por debajo de 0x20. */
export function codificar(texto, tablaEscPos = OPCIONES_POR_DEFECTO.tablaEscPos) {
  const inv = inversaDe(tablaEscPos);
  const bytes = [];
  for (const c of texto) {
    const cp = c.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) bytes.push(cp);
    else if (inv.has(c)) bytes.push(inv.get(c));
    else bytes.push(0x3f);                                              // no debería pasar: ya pasó por aImprimible
  }
  return bytes;
}

// ───────────────────────── 2. el documento ─────────────────────────

const ALINEACIONES = new Map(Object.entries({
  izq: 0, izquierda: 0, left: 0, centro: 1, centrado: 1, center: 1, der: 2, derecha: 2, right: 2,
}));
const RE_REGLA = /^([-=_*.~#])\1{2,}$/;

function tamanoDe(doble) {
  if (doble === true || doble === 'alto') return 0x01;     // GS ! 0x01: doble alto
  if (doble === 'ancho') return 0x10;
  if (doble === 'ambos') return 0x11;
  return 0;
}

function normalizarLinea(entrada, tabla) {
  if (typeof entrada === 'string' || typeof entrada === 'number') entrada = { texto: entrada };
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) return null;
  let izq = limpiarTexto(entrada.texto ?? entrada.izq);
  let der = unaLinea(entrada.der);
  if (!der && izq.includes('\t')) {                       // "izq\tder"
    const i = izq.indexOf('\t');
    der = unaLinea(izq.slice(i + 1));
    izq = izq.slice(0, i);
  }
  const alinear = ALINEACIONES.get(String(entrada.alinear ?? 'izq').toLowerCase()) ?? 0;
  const sangria = Number.isInteger(entrada.sangria) ? Math.max(0, Math.min(entrada.sangria, 40)) : null;
  const regla = RE_REGLA.test(izq.trim()) && !der ? izq.trim()[0]
    : (typeof entrada.separador === 'string' && /^[-=_*.~#]$/.test(entrada.separador) ? entrada.separador : null);
  const trozos = izq.split('\n');
  if (trozos.length > MAX_RENGLONES) throw new ErrorDocumento(`Una línea del documento trae ${trozos.length} saltos de línea; el ticket no puede pasar de ${MAX_RENGLONES} renglones.`);
  return {
    texto: trozos.map((t) => aImprimible(t.replace(/\t/g, ' '), tabla)),
    der: aImprimible(der, tabla),
    alinear,
    sangria,
    regla,
    columnas: Number.isInteger(entrada.columnas) && entrada.columnas >= 16 && entrada.columnas <= 80 ? entrada.columnas : null,
    negrita: entrada.negrita === true,
    tamano: tamanoDe(entrada.doble),
  };
}

/**
 * Valida y limpia el documento. Lanza ErrorDocumento si no es un documento; lo demás (campos raros,
 * tipos equivocados, bytes de control) se limpia en silencio: el ticket sale, aunque sea con menos.
 */
export function normalizarDocumento(doc, tabla = OPCIONES_POR_DEFECTO.tablaEscPos) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ErrorDocumento('El contenido de la impresión no es un documento (se esperaba un objeto con "lineas").');
  }
  if (doc.lineas !== undefined && !Array.isArray(doc.lineas)) {
    throw new ErrorDocumento('"lineas" del documento debe ser una lista.');
  }
  const entradas = doc.lineas ?? [];
  if (entradas.length > MAX_LINEAS) {
    throw new ErrorDocumento(`El documento tiene ${entradas.length} líneas; el máximo es ${MAX_LINEAS}.`);
  }
  const lineas = [];
  for (const e of entradas) {
    const l = normalizarLinea(e, tabla);
    if (l) lineas.push(l);
  }
  const titulo = aImprimible(unaLinea(doc.titulo).trim(), tabla);

  let qr = null;
  if (doc.qr !== undefined && doc.qr !== null && doc.qr !== false) {
    const crudo = typeof doc.qr === 'object' ? (doc.qr.texto ?? doc.qr.url) : doc.qr;
    const texto = unaLinea(crudo).trim();
    if (texto) {
      qr = {
        texto,
        etiqueta: typeof doc.qr === 'object' ? aImprimible(unaLinea(doc.qr.etiqueta).trim(), tabla) : '',
        tamano: typeof doc.qr === 'object' && Number.isInteger(doc.qr.tamano) ? doc.qr.tamano : null,
      };
    }
  }
  if (!titulo && lineas.length === 0 && !qr) throw new ErrorDocumento('El documento está vacío: no trae titulo, lineas ni qr.');
  return { titulo, lineas, qr, cortar: doc.cortar !== false };
}

// ───────────────────────── 3. distribución en columnas ─────────────────────────

/** Parte `texto` en renglones de a lo más `ancho`, por palabras; una palabra larga se corta. */
export function partirEnRenglones(texto, ancho) {
  if (ancho < 1) return [''];
  const limpio = texto.replace(/\s+$/, '');
  if (limpio.length <= ancho) return [limpio];
  const renglones = [];
  let actual = '';
  const poner = (palabra) => {
    while (palabra.length > ancho) {                       // una palabra más ancha que el papel
      if (actual) { renglones.push(actual); actual = ''; }
      renglones.push(palabra.slice(0, ancho));
      palabra = palabra.slice(ancho);
    }
    if (!palabra) return;
    if (!actual) actual = palabra;
    else if (actual.length + 1 + palabra.length <= ancho) actual += ' ' + palabra;
    else { renglones.push(actual); actual = palabra; }
  };
  for (const p of limpio.trim().split(/ +/)) poner(p);
  if (actual) renglones.push(actual);
  return renglones.length ? renglones : [''];
}

/**
 * Una línea lógica → los renglones físicos (cada uno de a lo más `ancho` columnas) con su alineación.
 * Con `der`, izquierda y derecha comparten el primer renglón: el precio nunca se parte.
 */
export function distribuir(linea, ancho) {
  if (linea.regla) return [{ texto: linea.regla.repeat(ancho), alinear: 0 }];
  const salida = [];
  const trozos = linea.texto.length ? linea.texto : [''];
  trozos.forEach((trozo, idx) => {
    const espacios = trozo.match(/^ */)[0].length;
    const sangria = Math.min(linea.sangria ?? espacios, Math.floor(ancho / 2));
    const cuerpo = trozo.replace(/^ +/, '');
    const pad = ' '.repeat(sangria);
    if (idx === 0 && linea.der) {
      const der = linea.der.length > ancho - 4 ? linea.der.slice(0, ancho - 4) : linea.der;
      const libre = ancho - sangria - der.length - 1;
      if (libre < Math.ceil(ancho / 4)) {                  // el precio ocupa casi todo: va solo, a la derecha
        for (const r of partirEnRenglones(cuerpo, ancho - sangria)) salida.push({ texto: pad + r, alinear: linea.alinear });
        salida.push({ texto: der, alinear: 2 });
        return;
      }
      const [primero] = partirEnRenglones(cuerpo, libre);   // el primer renglón cede sitio al precio; los demás, no
      const izq = pad + primero;
      salida.push({ texto: izq + ' '.repeat(Math.max(1, ancho - izq.length - der.length)) + der, alinear: 0 });
      const resto = cuerpo.length <= libre ? [] : partirEnRenglones(cuerpo.trim().replace(/ +/g, ' ').slice(primero.length).trim(), ancho - sangria);
      for (const r of resto) salida.push({ texto: pad + r, alinear: linea.alinear });
      return;
    }
    for (const r of partirEnRenglones(cuerpo, ancho - sangria)) salida.push({ texto: pad + r, alinear: linea.alinear });
  });
  return salida;
}

// ───────────────────────── 4. los bytes ─────────────────────────

class Emisor {
  constructor() {
    this.bytes = [];
    this.renglones = 0;
    this.alinear = 0;
    this.negrita = false;
    this.tamano = 0;
  }
  poner(...b) { for (const x of b) this.bytes.push(x); }
  estilo(alinear, negrita, tamano) {
    if (alinear !== this.alinear) { this.poner(ESC, 0x61, alinear); this.alinear = alinear; }
    if (negrita !== this.negrita) { this.poner(ESC, 0x45, negrita ? 1 : 0); this.negrita = negrita; }
    if (tamano !== this.tamano) { this.poner(GS, 0x21, tamano); this.tamano = tamano; }
  }
  renglon(texto, tabla) {
    // Tope de PAPEL, no de bytes: se corta aquí, sin haber mandado nada a la impresora (construirTicket devuelve todo o nada).
    if (++this.renglones > MAX_RENGLONES) {
      throw new ErrorDocumento(`El ticket pasa de ${MAX_RENGLONES} renglones de papel (~${(MAX_RENGLONES * 3.75 / 1000).toFixed(1).replace('.', ',')} m); no se imprime para no gastar el rollo.`);
    }
    for (const b of codificar(texto, tabla)) this.bytes.push(b);
    this.bytes.push(LF);
  }
}

function qrNativo(e, texto, tamano) {
  const datos = Buffer.from(texto, 'utf8');
  const n = datos.length + 3;
  e.poner(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);                    // modelo 2
  e.poner(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, tamano);                         // tamaño del módulo
  e.poner(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);                           // corrección M (49)
  e.poner(GS, 0x28, 0x6b, n & 0xff, (n >> 8) & 0xff, 0x31, 0x50, 0x30, ...datos);  // guardar
  e.poner(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);                           // imprimir
}

/**
 * Documento → Buffer ESC/POS. `documento` es el JSON de la cola (ver el formato arriba).
 * Lanza ErrorDocumento si no sirve y Error si las opciones no sirven; nunca devuelve bytes a medias.
 */
export function construirTicket(documento, opcionesEntrada = {}) {
  const o = resolverOpciones(opcionesEntrada);
  const doc = normalizarDocumento(documento, o.tablaEscPos);
  const e = new Emisor();

  e.poner(ESC, 0x40);                                    // ESC @: arranque limpio
  if (o.cancelarKanji) e.poner(FS, 0x2e);                // FS .
  e.poner(ESC, 0x74, o.tablaEscPos);                     // ESC t n: tabla de caracteres

  if (doc.titulo) {
    const ambos = doc.titulo.length * 2 <= o.columnas;
    const tamano = ambos ? 0x11 : 0x01;
    const ancho = ambos ? Math.floor(o.columnas / 2) : o.columnas;
    for (const r of partirEnRenglones(doc.titulo, ancho)) {
      e.estilo(1, true, tamano);
      e.renglon(r, o.tablaEscPos);
    }
  }

  for (const linea of doc.lineas) {
    const base = linea.columnas ?? o.columnas;
    const anchoLinea = linea.tamano & 0x10 ? Math.floor(base / 2) : base;
    for (const r of distribuir(linea, anchoLinea)) {
      e.estilo(r.alinear, linea.negrita, linea.tamano);
      e.renglon(r.texto, o.tablaEscPos);
    }
  }

  if (doc.qr) {
    const caben = Buffer.byteLength(doc.qr.texto, 'utf8') <= MAX_QR;
    if (doc.qr.etiqueta) {
      for (const r of partirEnRenglones(doc.qr.etiqueta, o.columnas)) { e.estilo(1, false, 0); e.renglon(r, o.tablaEscPos); }
    }
    if (o.qrNativo && caben) {
      e.estilo(1, false, 0);
      qrNativo(e, doc.qr.texto, doc.qr.tamano ? Math.max(1, Math.min(doc.qr.tamano, 16)) : o.qrTamano);
      e.poner(LF);
    } else {                                            // sin QR de la impresora: la dirección, como texto
      const url = aImprimible(doc.qr.texto, o.tablaEscPos);
      for (let i = 0; i < url.length; i += o.columnas) { e.estilo(1, false, 0); e.renglon(url.slice(i, i + o.columnas), o.tablaEscPos); }
    }
  }

  e.estilo(0, false, 0);                                 // que la impresora no quede en negrita ni centrada
  const corta = doc.cortar && o.cortar !== 'no';
  if (o.avance > 0) e.poner(ESC, 0x64, o.avance);        // ESC d n: papel hasta la cuchilla (o hasta donde se rompe)
  if (corta) e.poner(GS, 0x56, o.cortar === 'total' ? 0x41 : 0x42, 0x00);                          // GS V 65|66 0

  if (e.bytes.length > MAX_BYTES) throw new ErrorDocumento(`El ticket pesa ${e.bytes.length} bytes; el máximo es ${MAX_BYTES}.`);
  return Buffer.from(e.bytes);
}
