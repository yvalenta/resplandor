// Datos simulados de la vista `carta_publica` para las pruebas de la carta con desayunos, promociones y
// etiquetas (carta-promos.test.mjs y el arnés _carta-vm.mjs). NO son los datos de producción: son una carta
// de prueba armada con lo que dice el pedido de Yonatan (2026-10-01) y la instantánea del 3 de septiembre
// (assets/js/carta-respaldo.js), con las dos columnas nuevas de la vista: `etiqueta` y `dia_semana`.
//
//   - Ejecutivos: «Sopa y carne» ($14.000, «Incluye jugo»), «Sopa» y «Carne» ($7.000 cada una) y el sancocho
//     trifásico con la descripción repetida que trae hoy la base («Sancocho trifasico») y la etiqueta
//     «Algunos fines de semana».
//   - Desayunos: SIN filas, a propósito (los afiches no traen platos ni precios; la carta debe decirlo).
//   - Promociones: los siete días, con el texto de los afiches. Las de descuento (lunes, miércoles, sábado)
//     van con precio 0 y una etiqueta; las de precio fijo, con su precio.
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre como prueba.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// La instantánea compartida (la misma que usa carta.html cuando la vista no responde).
const INSTANTANEA = (() => {
  const caja = {};
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'assets/js/carta-respaldo.js'), 'utf8'), caja);
  return JSON.parse(JSON.stringify(caja.RESPLANDOR_CARTA_RESPALDO.filas));
})();

const COLUMNAS = ['categoria', 'nombre', 'precio', 'descripcion', 'etiqueta', 'dia_semana'];
const fila = (categoria, nombre, precio, descripcion = '', etiqueta = null, dia_semana = null) => ({ categoria, nombre, precio, descripcion, etiqueta, dia_semana });

/** Las siete promociones de la semana, de lunes (1) a domingo (7), con el texto de los afiches. */
export const PROMOCIONES = [
  fila('Promociones', '3er almuerzo', 0, 'Por la compra de 2 almuerzos, el tercero te sale con el 20% de descuento', '20% OFF', 1),
  fila('Promociones', 'Combo hamburguesas', 50000, '2 Hamburguesas Resplandor', null, 2),
  fila('Promociones', 'Cócteles, jugos y sodas', 0, '2x1 en cócteles, jugos y sodas saborizadas', '2 x 1', 3),
  fila('Promociones', 'Dupleta de papas', 39000, 'Dos Papas Resplandor', null, 4),
  fila('Promociones', 'Picada + jarra de Cantarito', 160000, '1 Picada Resplandor + 1 jarra de Cantarito. Ideal para 4 a 6 personas. «Fin de semana como se debe»', null, 5),
  fila('Promociones', 'Entradas de la carta', 0, 'Entradas de la carta 2x1. ¡Combínalas como quieras!', '2 x 1', 6),
  fila('Promociones', 'Almuerzos', 20000, 'Almuerzos en familia. Para disfrutar en familia y no cocinar en casa.', null, 7),
];

/** La vista completa (sin desayunos), como la serviría la base ya migrada. */
export function filasDeLaVista() {
  const base = INSTANTANEA
    .filter((f) => !['Sopa y carne', 'Sancocho trifásico'].includes(f.nombre))
    .map((f) => fila(f.categoria, f.nombre, f.precio, f.descripcion));
  return [
    ...base,
    fila('Ejecutivos', 'Sopa y carne', 14000, '', 'Incluye jugo'),
    fila('Ejecutivos', 'Sopa', 7000),
    fila('Ejecutivos', 'Carne', 7000),
    fila('Ejecutivos', 'Sancocho trifasico', 20000, 'Sancocho trifasico', 'Algunos fines de semana'),
    ...PROMOCIONES,
  ];
}

/**
 * Lo que contestaría PostgREST a `GET /rest/v1/carta_publica?select=…` sobre esas filas.
 *   - `anterior: true` es la vista de antes de las promociones (cuatro columnas): pedirle `etiqueta` o
 *     `dia_semana` da 400 («la columna no existe»), como el servidor de verdad.
 *   - `{ status }` fuerza una respuesta de error (402 de cuota, 500…).
 */
export function responderVista(url, { filas = filasDeLaVista(), anterior = false, status = null } = {}) {
  if (status) return { status, body: {} };
  const select = new URL(String(url)).searchParams.get('select') || '*';
  const pedidas = select === '*' ? (anterior ? COLUMNAS.slice(0, 4) : COLUMNAS) : select.split(',').map((c) => c.trim());
  const faltan = pedidas.filter((c) => !COLUMNAS.includes(c) || (anterior && ['etiqueta', 'dia_semana'].includes(c)));
  if (faltan.length) {
    return { status: 400, body: { code: '42703', details: null, hint: null, message: `column carta_publica.${faltan[0]} does not exist` } };
  }
  return { status: 200, body: filas.map((f) => Object.fromEntries(pedidas.map((c) => [c, f[c] ?? null]))) };
}
