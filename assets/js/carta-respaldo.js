/* Resplandor Restaurante — la carta de respaldo: la instantánea de la carta al 3 de
 * septiembre de 2026 (los 30 platos de `productos` con `activo and en_carta`, tal como los
 * servía la vista `carta_publica` ese día). Es la MISMA que sacó a carta.html del apuro
 * desde el 2026-09-06 (commit 2cb1d05): entra cuando Supabase no responde. Decisión de
 * Yonatan, 2026-09-29: cuando la carta en vivo no carga (hoy Supabase responde 402), la
 * landing (#carta) y carta.html muestran ESTA carta con su fecha a la vista, en vez de una
 * caja de error — y NUNCA la hacen pasar por la de hoy.
 *
 * Única fuente: carta.html y assets/js/landing.js (cartaVivo) la leen de acá; no hay otra
 * copia. Cuando cambien los precios, se actualiza este archivo (y `FECHA`) a mano, o se
 * arregla Supabase y deja de hacer falta.
 *
 * Lo que NO hace: no alimenta a los agentes. local.json, llms.txt, las herramientas
 * WebMCP (ver_carta) y el MCP remoto (resplandor_ver_carta) siguen siendo solo en vivo: un
 * agente no debe citar como vigente un precio de hace semanas.
 *
 * Sin DOM ni red: solo datos. Corre como <script defer> (antes de landing.js) y como módulo
 * en Node; en los dos deja globalThis.RESPLANDOR_CARTA_RESPALDO.
 */
(() => {
  'use strict';

  const FECHA = '2026-09-03'; // día de la instantánea (AAAA-MM-DD)
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // «3 de septiembre de 2026», a mano: sin Intl ni zona horaria de por medio, así que sale
  // igual en cualquier navegador, en Node y bajo cualquier TZ.
  const fechaTexto = (fecha) => {
    const [a, m, d] = fecha.split('-').map(Number);
    return `${d} de ${MESES[m - 1]} de ${a}`;
  };

  // Mismas cuatro columnas que la vista `carta_publica`.
  const FILAS = [
    { categoria: 'Ejecutivos', nombre: 'Menú Resplandor', precio: 23000, descripcion: 'Menú del día' },
    { categoria: 'Ejecutivos', nombre: 'Frijoles con proteína', precio: 19000, descripcion: 'A elección: res, cerdo o chicharrón' },
    { categoria: 'Ejecutivos', nombre: 'Sopa con proteína', precio: 19000, descripcion: 'Con cerdo, res, pollo o chicharrón' },
    { categoria: 'Ejecutivos', nombre: 'Sancocho trifásico', precio: 20000, descripcion: '' },
    { categoria: 'Entradas', nombre: 'Arepitas montadas', precio: 12000, descripcion: '3 uds: guacamole/chorizo, hogao/carne o morcilla/limón' },
    { categoria: 'Entradas', nombre: 'Patacón al estilo mexicano', precio: 15000, descripcion: '3 uds con carne al pastor, guacamole, sour cream y nachos' },
    { categoria: 'Entradas', nombre: 'Empanadas operadas', precio: 18000, descripcion: '3 uds con proteína a elección, queso mozzarella, plátano y salsa' },
    { categoria: 'Entradas', nombre: 'Ceviche de chicharrón', precio: 22000, descripcion: 'Ceviche de mango en chicharrón con chips de plátano' },
    { categoria: 'Entradas', nombre: 'Papas Resplandor', precio: 25000, descripcion: 'Papas a la francesa, chorizo, pollo, maicitos, queso y dip de tocineta' },
    { categoria: 'Platos Fuertes', nombre: 'Menú infantil', precio: 28000, descripcion: '2 opciones (cerdo o nuggets), papas, arepitas, jugo y helado' },
    { categoria: 'Platos Fuertes', nombre: 'Hamburguesa Resplandor', precio: 30000, descripcion: 'Pan ajonjolí, 150 g de carne, dip de tocineta, puerro, queso cheddar y vegetales' },
    { categoria: 'Platos Fuertes', nombre: 'Ensalada con proteína', precio: 30000, descripcion: 'Pollo, julianas de solomo o cañón en salsa de maracuyá' },
    { categoria: 'Platos Fuertes', nombre: 'Filete de pechuga', precio: 39000, descripcion: 'Dorado en BBQ y finas hierbas, papas a la francesa y ensalada' },
    { categoria: 'Platos Fuertes', nombre: 'Solomo salteado', precio: 48000, descripcion: 'Lomo de res con vegetales sobre arroz y chips de plátano' },
    { categoria: 'Platos Fuertes', nombre: 'Bandeja paisa Resplandor', precio: 49000, descripcion: 'Frijoles, arroz, plátano, chorizo, huevo, aguacate, arepa, morcilla, chicharrón, carne molida y hogao' },
    { categoria: 'Platos Fuertes', nombre: 'Churrasco (250 g)', precio: 54000, descripcion: 'Con papa cocida en salsa de cilantro y ensalada' },
    { categoria: 'Platos Fuertes', nombre: 'Punta de anca (250 g)', precio: 58000, descripcion: 'Madurada, con papas a la francesa, ensalada y salsa' },
    { categoria: 'Platos Fuertes', nombre: 'Salmón gratinado', precio: 70000, descripcion: 'Bañado en 3 quesos, puré de papa criolla y vegetales o ensalada' },
    { categoria: 'Platos Fuertes', nombre: 'Picada Resplandor', precio: 110000, descripcion: 'Para 8-10 personas: carnes, chorizo, morcilla, costilla, mazorca, arepa, papa, guacamole y salsa' },
    { categoria: 'Bebidas', nombre: 'Agua', precio: 4000, descripcion: 'Botella' },
    { categoria: 'Bebidas', nombre: 'Gaseosa', precio: 6000, descripcion: 'Coca-Cola, manzana y otras' },
    { categoria: 'Bebidas', nombre: 'Cerveza', precio: 9000, descripcion: 'Águila, Pilsen o Club Colombia' },
    { categoria: 'Bebidas', nombre: 'Corona', precio: 10500, descripcion: '' },
    { categoria: 'Bebidas', nombre: 'Jugo natural', precio: 12000, descripcion: 'Sujeto a disponibilidad' },
    { categoria: 'Bebidas', nombre: 'Soda saborizada', precio: 14000, descripcion: 'Maracuyá, frutos rojos o natural' },
    { categoria: 'Bebidas', nombre: 'Tequila Smile', precio: 28000, descripcion: 'Cóctel' },
    { categoria: 'Bebidas', nombre: 'Cantarito', precio: 28000, descripcion: 'Cóctel' },
    { categoria: 'Bebidas', nombre: 'Paloma', precio: 30000, descripcion: 'Cóctel' },
    { categoria: 'Bebidas', nombre: 'Margarita', precio: 30000, descripcion: 'Cóctel' },
    { categoria: 'Bebidas', nombre: 'Cóctel Resplandor', precio: 35000, descripcion: 'El de la casa' },
  ].map((f) => Object.freeze(f));

  const FECHA_TEXTO = fechaTexto(FECHA);

  const RESPLANDOR_CARTA_RESPALDO = Object.freeze({
    fecha: FECHA,
    fechaTexto: FECHA_TEXTO,
    // La nota que acompaña a estos precios donde se muestren. Honesta a propósito: dice de
    // qué día son y manda a confirmar, sin fingir que es la carta de hoy.
    nota: `Precios del ${FECHA_TEXTO}; confírmalos al reservar.`,
    filas: Object.freeze(FILAS),
  });

  globalThis.RESPLANDOR_CARTA_RESPALDO = RESPLANDOR_CARTA_RESPALDO;
  if (typeof module !== 'undefined' && module.exports) module.exports = RESPLANDOR_CARTA_RESPALDO;
})();
