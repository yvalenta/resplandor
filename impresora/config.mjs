// config.json del agente: se lee y se valida al arrancar, y si algo no sirve se dice EN ESPAÑOL, todo junto
// (todos los problemas de una vez, no uno por intento) y con qué hacer.
//
//   modo 'agente' → hace falta todo: base, clave publicable, token e impresora.
//   modo 'prueba' → solo lo de la impresora (--prueba y --vista-previa no hablan con la base).
//
// Reglas que se hacen cumplir aquí y no se negocian:
//   * La clave de la base es la PUBLICABLE (sb_publishable_… o la «anon»). Si alguien pega la secreta
//     (sb_secret_… o un JWT con role service_role) el agente NO arranca: esa clave nunca sale de Supabase.
//   * Las claves que no conoce son un error (un «colunmas» tecleado mal se quedaría en 48 sin que nadie lo vea).
//     Las que empiezan con «_» son comentarios y se ignoran.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolverOpciones } from './ticket/escpos.mjs';
import { validarNombreImpresora } from './imprimir-windows.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RUTA_CONFIG = path.join(AQUI, 'config.json');
export const CARPETA_AGENTE = AQUI;

export class ErrorConfig extends Error {
  constructor(problemas) {
    super(problemas.join('\n'));
    this.name = 'ErrorConfig';
    this.problemas = problemas;
  }
}

const CLAVES = {
  supabaseUrl: 'dirección del proyecto de Supabase',
  publishableKey: 'clave publicable',
  token: 'token de la impresora',
  impresora: 'nombre de la impresora en Windows',
  columnas: 'columnas del papel',
  tablaEscPos: 'tabla de caracteres',
  cortar: 'corte',
  qrNativo: 'QR de la impresora',
  qrTamano: 'tamaño del QR',
  avance: 'papel antes del corte',
  cancelarKanji: 'cancelar modo ideogramas',
  simular: 'modo simulado',
  carpetaSalida: 'carpeta del modo simulado',
  sondeoSegundos: 'cada cuánto mira la cola',
  latidoSegundos: 'cada cuánto avisa que está en línea',
  caducaMinutos: 'minutos máximos que un ticket puede esperar en la cola',
};

function distancia(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return m[a.length][b.length];
}

function parecida(clave) {
  let mejor = null;
  for (const c of Object.keys(CLAVES)) {
    const d = distancia(clave.toLowerCase(), c.toLowerCase());
    if (d <= 3 && (!mejor || d < mejor.d)) mejor = { c, d };
  }
  return mejor?.c ?? null;
}

// Los textos de relleno de config.ejemplo.json: si siguen ahí, falta pegar el valor de verdad.
// (el último es el que pone el POS en «Copiar config.json»: solo le falta el nombre de la impresora, y si se olvida cambiarlo hay que decirlo aquí, no al primer ticket)
const EJEMPLO = /pega-aqui|tu-proyecto|nombre-de-la-impresora|nombre de la impresora en windows/i;

function esLocal(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

function rolDelJwt(clave) {
  const partes = clave.split('.');
  if (partes.length !== 3) return null;
  try { return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')).role ?? null; } catch { return null; }
}

/**
 * Valida el objeto leído de config.json. Devuelve { config, avisos } o lanza ErrorConfig con TODOS los problemas.
 * `config.opcionesTicket` ya está listo para construirTicket.
 */
export function validarConfig(c, { modo = 'agente', simular = false, carpeta = AQUI } = {}) {
  const problemas = [];
  const avisos = [];
  if (c === null || typeof c !== 'object' || Array.isArray(c)) {
    throw new ErrorConfig(['config.json debe ser un objeto: { "supabaseUrl": "…", "token": "…", … } (mira config.ejemplo.json).']);
  }

  for (const k of Object.keys(c)) {
    if (k.startsWith('_') || k in CLAVES) continue;
    const sug = parecida(k);
    problemas.push(`config.json: no conozco la clave «${k}»${sug ? ` (¿quisiste decir «${sug}»?)` : ''}. Si es un comentario, empieza con «_».`);
  }

  const out = {};
  const texto = (k, { obligatoria, defecto }) => {
    const v = c[k];
    if (v === undefined || v === null || v === '') {
      if (obligatoria) problemas.push(`config.json: falta «${k}» (${CLAVES[k]}).`);
      return defecto;
    }
    if (typeof v !== 'string') { problemas.push(`config.json: «${k}» debe ser un texto entre comillas.`); return defecto; }
    if (EJEMPLO.test(v)) { problemas.push(`config.json: «${k}» todavía tiene el texto de ejemplo («${v.slice(0, 40)}»): reemplázalo por el valor de verdad.`); return defecto; }
    return v.trim();
  };

  out.simular = simular || c.simular === true;
  if (c.simular !== undefined && typeof c.simular !== 'boolean') problemas.push('config.json: «simular» debe ser true o false (sin comillas).');

  if (modo === 'agente') {
    const url = texto('supabaseUrl', { obligatoria: true });
    if (url) {
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && esLocal(u.hostname))) {
          problemas.push('config.json: «supabaseUrl» debe empezar con https:// (por ejemplo https://xxxxxxxx.supabase.co).');
        } else if (u.username || u.password) {
          problemas.push('config.json: «supabaseUrl» no debe llevar usuario ni clave dentro.');
        } else {
          if (u.pathname !== '/' || u.search || u.hash) avisos.push(`«supabaseUrl» lleva ruta (${u.pathname}): se usa solo ${u.origin}.`);
          out.supabaseUrl = u.origin;
        }
      } catch {
        problemas.push(`config.json: «supabaseUrl» no es una dirección válida («${url.slice(0, 60)}»).`);
      }
    }

    const clave = texto('publishableKey', { obligatoria: true });
    if (clave) {
      if (clave.startsWith('sb_secret_') || rolDelJwt(clave) === 'service_role') {
        problemas.push('config.json: «publishableKey» es la clave SECRETA de Supabase (sb_secret_… o service_role). NUNCA va en el PC de la caja: usa la clave publicable (sb_publishable_…, o la «anon» si el proyecto usa claves viejas).');
      } else if (/\s/.test(clave) || clave.length < 20) {
        problemas.push('config.json: «publishableKey» no parece una clave de Supabase (debe ser una sola palabra larga, sin espacios).');
      } else out.publishableKey = clave;
    }

    const token = texto('token', { obligatoria: true });
    if (token) {
      if (!/^[\x21-\x7e]{16,256}$/.test(token)) {
        problemas.push('config.json: «token» debe ser una sola palabra de al menos 16 caracteres, sin espacios ni saltos de línea (cópialo completo del POS → Impresora de la caja).');
      } else out.token = token;
    }
  }

  const impresora = texto('impresora', { obligatoria: !out.simular, defecto: '' });
  if (impresora) {
    const mal = validarNombreImpresora(impresora);
    if (mal) problemas.push(`config.json: «impresora» ${mal}.`);
    else out.impresora = impresora;
  } else out.impresora = '';

  const entero = (k, defecto, min, max) => {
    const v = c[k];
    if (v === undefined || v === null) return defecto;
    if (!Number.isInteger(v) || v < min || v > max) {
      problemas.push(`config.json: «${k}» debe ser un número entero entre ${min} y ${max} (sin comillas)${k === 'columnas' ? '; lo normal es 48, 42 o 32' : ''}.`);
      return defecto;
    }
    return v;
  };
  const opciones = {
    columnas: entero('columnas', 48, 16, 80),
    tablaEscPos: c.tablaEscPos === undefined ? 2 : c.tablaEscPos,
    cortar: c.cortar === undefined ? 'parcial' : c.cortar,
    qrNativo: c.qrNativo === undefined ? true : c.qrNativo,
    qrTamano: entero('qrTamano', 6, 1, 16),
    avance: entero('avance', 3, 0, 20),
    cancelarKanji: c.cancelarKanji === undefined ? false : c.cancelarKanji,
  };
  try {
    out.opcionesTicket = resolverOpciones(opciones);
  } catch (e) {
    if (!problemas.some((p) => p.includes('«columnas»') || p.includes('«qrTamano»') || p.includes('«avance»'))) {
      problemas.push(`config.json: ${e.message}.`);
    }
  }
  out.columnas = opciones.columnas;
  out.tablaEscPos = opciones.tablaEscPos;

  out.sondeoSegundos = entero('sondeoSegundos', 5, 2, 60);
  out.latidoSegundos = entero('latidoSegundos', 30, 10, 300);
  out.caducaMinutos = entero('caducaMinutos', 15, 0, 1440);   // igual que la base: lo que lleva más de 15 min sin imprimirse ya no sirve

  const salida = c.carpetaSalida === undefined ? 'salida' : c.carpetaSalida;
  if (typeof salida !== 'string' || salida.trim() === '') problemas.push('config.json: «carpetaSalida» debe ser un texto con una carpeta.');
  else out.carpetaSalida = path.resolve(carpeta, salida);

  if (problemas.length) throw new ErrorConfig(problemas);
  return { config: out, avisos };
}

const AYUDA_JSON = 'Revisa que no falten comillas ni comas, que no sobre una coma al final de la última línea, que las comillas sean las rectas (") y no las curvas (“ ”) y, si pegaste una ruta de Windows, que las barras sean dobles (\\\\) o inclinadas (/).';

/** Lee y valida config.json. Lanza ErrorConfig (mensajes en español) si no existe, no es JSON o no sirve. */
export function cargarConfig({ ruta = RUTA_CONFIG, modo = 'agente', simular = false } = {}) {
  let crudo;
  try {
    crudo = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new ErrorConfig([`No encuentro ${ruta}. Copia config.ejemplo.json como config.json (en la misma carpeta) y llena los datos.`]);
    }
    throw new ErrorConfig([`No pude leer ${ruta}: ${e.message}`]);
  }
  let objeto;
  try {
    objeto = JSON.parse(crudo.replace(/^﻿/, ''));
  } catch (e) {
    throw new ErrorConfig([`${ruta} no es un JSON válido (${e.message}). ${AYUDA_JSON}`]);
  }
  return validarConfig(objeto, { modo, simular, carpeta: path.dirname(ruta) });
}
