// La página de prueba: la que sale con `node agente.mjs --prueba`.
//
// Sirve para ver de un vistazo si la impresora está bien puesta:
//   - la regla de columnas: si «1234567890…» da la vuelta o se corta, `columnas` no es el del papel;
//   - «¿cuántas columnas tiene mi papel?»: tres reglas de 32, 42 y 48 con una barra | al final. La más larga que
//     sale entera en UNA línea, con su barra pegada, es el `columnas` que va en config.json;
//   - los bordes «|  |»: tienen que verse los dos, pegados a cada lado;
//   - las tildes y la ñ: si salen símbolos raros, es `tablaEscPos` (2 = PC850 casi siempre);
//   - el precio a la derecha, la sangría de las sublíneas, negrita, doble alto, el QR y el corte.
// Es un documento como cualquier otro de la cola (formato en escpos.mjs), así prueba el mismo camino.

export const URL_PRUEBA = 'https://resplandor.ynt.codes/';

export function documentoDePrueba({ columnas = 48, tablaEscPos = 2, nombreImpresora = '', ahora = new Date() } = {}) {
  const regla = '1234567890'.repeat(Math.ceil(columnas / 10)).slice(0, columnas);
  const medida = (n) => ({ texto: '1234567890'.repeat(Math.ceil(n / 10)).slice(0, n - 1) + '|', columnas: n });
  const bordes = '|' + ' '.repeat(columnas - 2) + '|';
  const fecha = ahora.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  return {
    titulo: 'RESPLANDOR',
    lineas: [
      { texto: 'Prueba de la impresora de la caja', alinear: 'centro' },
      { texto: fecha, alinear: 'centro' },
      { texto: '----' },
      { texto: regla },
      { texto: bordes },
      { texto: '----' },
      { texto: 'Cuántas columnas tiene tu papel: la regla más larga que salga entera en UNA línea, con su barra | al final, es el valor de "columnas".' },
      { texto: '32', negrita: true },
      medida(32),
      { texto: '42', negrita: true },
      medida(42),
      { texto: '48', negrita: true },
      medida(48),
      { texto: '----' },
      { texto: `Tabla ${tablaEscPos} · ${columnas} columnas${nombreImpresora ? ' · ' + nombreImpresora : ''}` },
      { texto: 'Tildes: áéíóú ÁÉÍÓÚ üÜ ñÑ ¿? ¡! € °' },
      { texto: 'Si ves símbolos raros aquí, cambia tablaEscPos.' },
      { texto: '----' },
      { texto: '2x Hamburguesa clásica', der: '$ 56.000' },
      { texto: '  sin cebolla, término medio', sangria: 4 },
      { texto: '  c/u $ 28.000', sangria: 4 },
      { texto: '1x Limonada de coco', der: '$ 12.500' },
      { texto: '1x Plato con un nombre larguísimo que no cabe en una sola línea del papel', der: '$ 131.000' },
      { texto: '----' },
      { texto: 'TOTAL', der: '$ 199.500', negrita: true },
      { texto: 'Doble alto', doble: true },
      { texto: 'Negrita', negrita: true },
      { texto: '----' },
      { texto: 'Gracias por su visita', alinear: 'centro' },
    ],
    qr: { texto: URL_PRUEBA, etiqueta: 'Escanéame' },
    cortar: true,
  };
}
