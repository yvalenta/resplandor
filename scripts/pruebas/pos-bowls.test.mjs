// Los bowls y los almuerzos a 20.000 (pedido de Yonatan, 2026-11-10; tareas/2026-11-10-almuerzos-y-bowls.md). Los precios y los
// productos viven en Supabase (los carga el sobre docs/sobres/2026-11-10-almuerzos-y-bowls.sql); lo que vive en pos.html es «Arma tu
// bowl» (OPCIONES_PRODUCTO, colgado del id fijo `bowl_arma`), el lugar de los Bowls en la carta del mesero y la semilla local.
//
//   A. ESTÁTICA: el sobre y el POS hablan de los mismos ids, y el sobre deja los dos almuerzos a 20.000 y los bowls a 15.000 con guarapo.
//   B. LÓGICA: el <script> real de pos.html en un `vm` (_pos-vm.mjs) con una base falsa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { asentar, crearBaseFalsa, crearPos, mesaBase, ordenBase, ordenLocal, plano, RAIZ } from './_pos-vm.mjs';

const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const SOBRE = fs.readFileSync(path.join(RAIZ, 'docs/sobres/2026-11-10-almuerzos-y-bowls.sql'), 'utf8');
const sinComentariosSql = (t) => t.replace(/--[^\n]*/g, ' ');
const IDS = ['bowl_criollo', 'bowl_mixto', 'bowl_resplandor', 'bowl_arma'];

// ═════════════════════════ A. estática ═════════════════════════

test('estática: el sobre crea los cuatro bowls con los ids que usa el POS, a 15.000, en Bowls, en la carta y con «Incluye guarapo»', () => {
  const sql = sinComentariosSql(SOBRE);
  for (const id of IDS) {
    const fila = new RegExp(`\\('${id}', 'Bowls', '[^']+', 15000,[\\s\\S]*?'Incluye guarapo', true, true\\)`);
    assert.match(sql, fila, `la fila de ${id}`);
    assert.match(POS, new RegExp(`id: '${id}', cat: 'Bowls', nombre: '[^']+', precio: 15000`), `la semilla local de ${id}`);
  }
  assert.match(POS, /\n\s*bowl_arma: \[\n/, 'las opciones de «Arma tu bowl» cuelgan del mismo id que crea el sobre');
  assert.match(sql, /set precio = 20000\s+where categoria = 'Ejecutivos'\s+and nombre in \('Menú Resplandor', 'Seco'\)/);
  assert.doesNotMatch(sql, /23000|19000/, 'fuera de los comentarios (la reversa), el sobre no escribe los precios viejos');
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

test('estática: la semilla local ya no trae los almuerzos de 23.000 ni de 19.000', () => {
  const i = POS.indexOf('const CATALOGO = [');
  const f = POS.indexOf('];', i);
  const semilla = POS.slice(i, f);
  assert.match(semilla, /nombre: 'Menú Resplandor', precio: 20000/);
  assert.match(semilla, /nombre: 'Seco', precio: 20000/);
  assert.doesNotMatch(semilla, /precio: (23000|19000)\b/);
});

// ═════════════════════════ B. lógica ═════════════════════════

const ARMA = { id: 'bowl_arma', nombre: 'Arma tu bowl', precio: 15000, cat: 'Bowls' };
const CRIOLLO = { id: 'bowl_criollo', nombre: 'Bowl criollo', precio: 15000, cat: 'Bowls' };

function montar() {
  const base = crearBaseFalsa({ mesas: [mesaBase(3)] });
  const t = crearPos({ base });
  t.base = base;
  t.pos.usuario = { id: 'u1', email: 'mesero@resplandor.test', user_metadata: { full_name: 'Mesero' } };
  t.base.ordenes.set('o1', { ...ordenBase('o1', 3, [], 1) });
  t.pos.mesas = [mesaBase(3)];
  t.pos.ordenes = [ordenLocal('o1', 3, [], 1)];
  t.pos.mesaActiva = t.pos.mesas[0];
  t.pos.ordenActiva = t.pos.ordenes[0];
  t.pos.remoto = 'ok';
  return t;
}

test('«Arma tu bowl» pregunta base, proteína, vegetales y guarnición, y al elegir la cuarta se agrega solo con la elección en la nota', async () => {
  const t = montar();
  t.pos.agregarProducto(ARMA);
  assert.equal(t.pos.modalOpciones, true, 'abre la hoja de opciones en vez de agregar directo');
  assert.deepEqual(plano(t.pos.opcionesGrupos), [
    { nombre: 'Base', opciones: ['Arroz', 'Pasta', 'Frijol', 'Mix de lechugas'] },
    { nombre: 'Proteína', opciones: ['Pollo desmechado', 'Pollo agridulce', 'Carne desmechada', 'Carne molida', 'Atún', 'Huevo cocido'] },
    { nombre: 'Vegetales', opciones: ['Pico de gallo', 'Tomate y zanahoria', 'Pepino y zucchini'] },
    { nombre: 'Guarnición', opciones: ['Plátano maduro', 'Chips de plátano', 'Yuca frita', 'Papa cocinada'] },
  ]);
  t.pos.elegirOpcion('Base', 'Arroz');
  t.pos.elegirOpcion('Proteína', 'Atún');
  t.pos.elegirOpcion('Vegetales', 'Pico de gallo');
  assert.equal(t.pos.ordenActiva.items.length, 0, 'con tres de cuatro todavía no se agrega');
  t.pos.elegirOpcion('Guarnición', 'Yuca frita');
  assert.equal(t.pos.modalOpciones, false);
  const [linea] = plano(t.pos.ordenActiva.items);
  assert.equal(linea.nombre, 'Arma tu bowl');
  assert.equal(linea.precio, 15000);
  assert.equal(linea.qty, 1);
  assert.equal(linea.nota, 'Arroz · Atún · Pico de gallo · Yuca frita');

  // Otra combinación es otra línea; la misma combinación suma cantidad.
  t.pos.agregarProducto(ARMA);
  for (const [g, v] of [['Base', 'Mix de lechugas'], ['Proteína', 'Huevo cocido'], ['Vegetales', 'Pepino y zucchini'], ['Guarnición', 'Papa cocinada']]) t.pos.elegirOpcion(g, v);
  t.pos.agregarProducto(ARMA);
  for (const [g, v] of [['Base', 'Arroz'], ['Proteína', 'Atún'], ['Vegetales', 'Pico de gallo'], ['Guarnición', 'Yuca frita']]) t.pos.elegirOpcion(g, v);
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.nota, i.qty])), [
    ['Arroz · Atún · Pico de gallo · Yuca frita', 2],
    ['Mix de lechugas · Huevo cocido · Pepino y zucchini · Papa cocinada', 1],
  ]);
  assert.equal(t.pos.totalOrdenActiva, 3 * 15000);
  await asentar();
  assert.equal(t.base.rpcs.reduce((n, r) => n + r.delta, 0), 3, 'las tres unidades llegaron a la base');
});

test('los bowls fijos (criollo, mixto, Resplandor) se agregan directo, sin hoja de opciones', () => {
  const t = montar();
  t.pos.agregarProducto(CRIOLLO);
  assert.equal(t.pos.modalOpciones, false);
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.nombre, i.precio, i.qty, i.nota])), [['Bowl criollo', 15000, 1, '']]);
});

test('en la carta del mesero los Bowls van justo después de Ejecutivos', () => {
  const t = montar();
  t.pos.productos = [
    { id: 'be1', cat: 'Bebidas', nombre: 'Agua', precio: 4000, activo: true },
    { id: 'en1', cat: 'Entradas', nombre: 'Arepitas montadas', precio: 12000, activo: true },
    { ...CRIOLLO, activo: true },
    { id: 'ej1', cat: 'Ejecutivos', nombre: 'Menú Resplandor', precio: 20000, activo: true },
  ];
  assert.deepEqual(Object.keys(t.pos.productosPorCategoria), ['Ejecutivos', 'Bowls', 'Bebidas', 'Entradas']);
});
