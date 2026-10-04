// La guarda de «precio a mano»: qué cuenta como un precio escrito en un archivo que no es la carta en vivo, y la única excepción.
// La usan reglas.test.mjs (sobre el repo real: todo lo que genera scripts/descubrimiento.mjs y el JSON-LD de la landing) y
// puntaje-ora.test.mjs (sobre sitios de prueba con OTRO `rangoDePrecios`). Este archivo no termina en «.test.mjs»: no corre como prueba.
//
// Historia (puntaje-ora, 2026-10-04):
//  - r1: la guarda solo veía «$14.000» y dejó pasar «desde 14.000 COP» como el rango de toda la carta, con la suite en verde. Pasó a ver
//    «$ 14.000», «14.000 COP», «49.000 pesos», «COP 14.000» y «14 mil pesos».
//  - r2: la excepción era el LITERAL del «desde» (`desde 14.000 COP`), esté donde esté, así que «La carta va desde 14.000 COP» en cualquier
//    archivo pasaba; y no veía cifras sin moneda («desde 9.000») ni «7 mil». Ahora la excepción es el CONTEXTO: el dato `rangoDePrecios`
//    solo se permite dentro de la frase exacta que escribe el generador (`fraseRango`: «Rango de precios declarado por el restaurante: <dato>»)
//    y como el valor de la llave `rangoDePrecios` de local.json. Cualquier otra cifra, en cualquier forma, falla.

const NUMERO_EN_PALABRAS = String.raw`(?:un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veinti\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento)`;

export const RE_PRECIO_A_MANO = new RegExp(
  [
    String.raw`\$\s*\d`, // «$14.000», «$ 14.000», «$14000»
    String.raw`\b\d[\d.,]*\s*(?:COP|pesos)\b`, // «14.000 COP», «49.000 pesos», «14000 COP», «desde 14.000 COP»
    String.raw`\bCOP\s*\$?\s*\d`, // «COP 14.000», «COP$14.000»
    String.raw`\b\d{1,3}(?:[.,]\d{3})+\b`, // una cifra con separador de miles, sin moneda: «9.000», «14.000»
    String.raw`\bdesde\s+\$?\s*(?!(?:19|20)\d{2}\b)\d{3,}\b`, // «desde 9000» (no un año: «desde 2024»)
    String.raw`\b\d+(?:[.,]\d+)?\s*(?:mil|k)\b`, // «7 mil», «14 mil pesos», «9k»
    String.raw`\b${NUMERO_EN_PALABRAS}\s+mil\b`, // «catorce mil»
    String.raw`\bmil\s+(?:COP|pesos)\b`, // «mil pesos»
  ].join('|'),
  'gi',
);

const escaparHtml = (texto) => texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** La frase exacta con que el generador publica el dato (scripts/descubrimiento.mjs, `fraseRango`), hasta el dato inclusive. */
export const prefijoDeLaFrase = (dato) => `Rango de precios declarado por el restaurante: ${dato}`;

/**
 * El texto SIN lo único permitido: (1) la frase exacta del rango, con el dato `rangoDePrecios` tal cual (en HTML va escapado);
 * (2) la llave `"rangoDePrecios": "<dato>"` de local.json. El mismo «desde 14.000 COP» en otro lugar queda a la vista.
 */
export function sinElRangoDeclarado(texto, dato) {
  let t = texto;
  for (const variante of new Set([dato, escaparHtml(dato)])) t = t.split(prefijoDeLaFrase(variante)).join('');
  return t.split(`"rangoDePrecios": ${JSON.stringify(dato)}`).join('');
}

/** Cada precio escrito a mano que queda a la vista (vacío = limpio). */
export const preciosAMano = (texto, dato) => [...sinElRangoDeclarado(texto, dato).matchAll(RE_PRECIO_A_MANO)].map((m) => m[0]);
