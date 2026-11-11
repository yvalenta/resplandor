// Los bowls y los almuerzos a 23.000 (pedidos de Yonatan, 2026-11-10; tareas/2026-11-10-almuerzos-y-bowls.md). Los precios y los
// productos viven en Supabase (los carga el sobre docs/sobres/2026-11-10-almuerzos-y-bowls.sql). Los ingredientes de «Arma tu bowl»
// también: viven SOLO en su descripción (`productos.descripcion`), y el POS saca de ella los pasos que pregunta (opcionesDe en
// pos.html, colgado del id fijo `bowl_arma`). Por eso estas pruebas miran la FORMA —los cuatro pasos, listas no vacías, sin
// precios— y nunca la lista de ingredientes: cambiar un ingrediente es editar esa descripción, y aquí no se rompe nada.
//
//   A. ESTÁTICA: el sobre y el POS hablan de los mismos ids; el sobre deja los dos almuerzos a 23.000 y los bowls a 15.000 con
//      guarapo; el POS no lleva una lista fija para «Arma tu bowl» y su gruposDe es la misma de la carta y de la landing.
//   B. LÓGICA: el <script> real de pos.html en un `vm` (_pos-vm.mjs) con una base falsa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { asentar, crearBaseFalsa, crearPos, mesaBase, ordenBase, ordenLocal, plano, RAIZ } from './_pos-vm.mjs';

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const POS = leer('pos.html');
const SOBRE = leer('docs/sobres/2026-11-10-almuerzos-y-bowls.sql');
const sinComentariosSql = (t) => t.replace(/--[^\n]*/g, ' ');
const IDS = ['bowl_criollo', 'bowl_mixto', 'bowl_resplandor', 'bowl_arma'];
const PASOS = ['Base', 'Proteína', 'Vegetales', 'Guarnición'];

// Las tres copias que el repo tiene de la descripción de «Arma tu bowl» (la verdad es la de la base). Las pruebas las LEEN, no
// las escriben: un ingrediente nuevo no obliga a tocar este archivo.
const DESC_SOBRE = (() => {
  const sql = sinComentariosSql(SOBRE);
  const i = sql.indexOf("('bowl_arma'");
  const trozo = sql.slice(i, sql.indexOf("'Incluye guarapo'", i));
  return [...trozo.matchAll(/'([^']*)'/g)].map((m) => m[1]).slice(3).join('');   // después de id, categoría y nombre
})();
const DESC_SEMILLA = (/id: 'bowl_arma', cat: 'Bowls', nombre: '[^']+', precio: \d+,\s*desc: '([^']+)'/.exec(POS) || [])[1];
const DESC_INSTANTANEA = (() => {
  const caja = {};
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leer('assets/js/carta-respaldo.js'), caja);
  return caja.RESPLANDOR_CARTA_RESPALDO.filas.find((f) => f.nombre === 'Arma tu bowl')?.descripcion;
})();

/** La forma de los pasos de «Arma tu bowl»: los cuatro, en orden, cada uno con opciones que empiezan en mayúscula y sin precios. */
function formaDeArma(pasos, donde) {
  assert.deepEqual(pasos.map((p) => p.nombre), PASOS, `${donde}: los cuatro pasos, en orden`);
  for (const p of pasos) {
    assert.ok(p.opciones.length >= 1, `${donde}: «${p.nombre}» trae al menos una opción`);
    assert.equal(new Set(p.opciones).size, p.opciones.length, `${donde}: «${p.nombre}» sin opciones repetidas`);
    for (const o of p.opciones) {
      assert.match(o, /^\p{Lu}/u, `${donde}: «${o}» empieza en mayúscula (es el texto del botón y de la nota)`);
      assert.doesNotMatch(o, /\d|\$|\bpesos?\b|\bmil\b/i, `${donde}: «${o}» sin precios`);
    }
  }
}

// ═════════════════════════ A. estática ═════════════════════════

test('estática: el sobre crea los cuatro bowls con los ids que usa el POS, a 15.000, en Bowls, en la carta y con «Incluye guarapo», y deja los dos almuerzos a 23.000', () => {
  const sql = sinComentariosSql(SOBRE);
  for (const id of IDS) {
    const fila = new RegExp(`\\('${id}', 'Bowls', '[^']+', 15000,[\\s\\S]*?'Incluye guarapo', true, true\\)`);
    assert.match(sql, fila, `la fila de ${id}`);
    assert.match(POS, new RegExp(`id: '${id}', cat: 'Bowls', nombre: '[^']+', precio: 15000`), `la semilla local de ${id}`);
  }
  assert.match(sql, /set precio = 23000\s+where categoria = 'Ejecutivos'\s+and nombre in \('Menú Resplandor', 'Seco'\)/);
  assert.doesNotMatch(sql, /19000|20000/, 'fuera de los comentarios (la reversa), el sobre no escribe el precio viejo ni el de la mañana');
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

test('estática: la semilla local trae los dos almuerzos a 23.000', () => {
  const i = POS.indexOf('const CATALOGO = [');
  const semilla = POS.slice(i, POS.indexOf('];', i));
  assert.match(semilla, /id: 'ej1', cat: 'Ejecutivos', nombre: 'Menú Resplandor', precio: 23000,/);
  assert.match(semilla, /id: 'ej2', cat: 'Ejecutivos', nombre: 'Seco', precio: 23000,/);
});

test('estática: «Arma tu bowl» no tiene una lista fija en el POS: sus pasos salen de la descripción del producto, colgados del id que crea el sobre', () => {
  const i = POS.indexOf('const OPCIONES_PRODUCTO = {');
  assert.ok(i >= 0, 'no encontré OPCIONES_PRODUCTO');
  assert.doesNotMatch(POS.slice(i, POS.indexOf('};', i)), /bowl_arma/, 'OPCIONES_PRODUCTO no trae una lista para «Arma tu bowl»');
  assert.match(POS, /const OPCIONES_EN_LA_DESCRIPCION = new Set\(\['bowl_arma'\]\);/);
  for (const [donde, desc] of [['el sobre', DESC_SOBRE], ['la semilla del POS', DESC_SEMILLA], ['la instantánea de la carta', DESC_INSTANTANEA]]) {
    assert.equal(typeof desc, 'string', `no encontré la descripción de «Arma tu bowl» en ${donde}`);
    assert.doesNotMatch(desc, /\n/, `${donde}: un solo renglón (el campo de descripción del POS es de un renglón)`);
  }
});

test('estática: la gruposDe del POS es la misma de carta.html y de assets/js/landing.js: la carta y el POS leen la descripción igual', () => {
  const funcion = (texto, archivo) => {
    const i = texto.indexOf('const gruposDe = (desc) => {');
    assert.ok(i >= 0, `${archivo}: no encontré gruposDe`);
    return texto.slice(i, texto.indexOf('};', i) + 2).replace(/\s+/g, ' ');
  };
  const pos = funcion(POS, 'pos.html');
  assert.equal(funcion(leer('carta.html'), 'carta.html'), pos, 'carta.html');
  assert.equal(funcion(leer('assets/js/landing.js'), 'assets/js/landing.js'), pos, 'assets/js/landing.js');
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
// Los pasos que el POS pregunta para un producto (abre la hoja y la cierra sin agregar nada).
function pasosDe(t, prod) {
  t.pos.agregarProducto(prod);
  const abrio = t.pos.modalOpciones;
  const pasos = plano(t.pos.opcionesGrupos);
  t.pos.modalOpciones = false;
  t.pos.opcionesProd = null;
  return abrio ? pasos : null;
}

test('las tres copias de la descripción (el sobre, la semilla del POS y la instantánea de la carta) dan los cuatro pasos con opciones y sin precios', () => {
  const t = montar();
  for (const [donde, desc] of [['el sobre', DESC_SOBRE], ['la semilla del POS', DESC_SEMILLA], ['la instantánea de la carta', DESC_INSTANTANEA]]) {
    const pasos = pasosDe(t, { ...ARMA, desc });
    assert.ok(pasos, `${donde}: «Arma tu bowl» abre la hoja de opciones`);
    formaDeArma(pasos, donde);
  }
  assert.equal(t.pos.ordenActiva.items.length, 0, 'abrir la hoja no agrega nada');
});

test('«Arma tu bowl» pregunta los cuatro pasos de su descripción y, al elegir el cuarto, se agrega solo con la elección en la nota', async () => {
  const t = montar();
  const arma = { ...ARMA, desc: DESC_SEMILLA };
  t.pos.agregarProducto(arma);
  assert.equal(t.pos.modalOpciones, true, 'abre la hoja de opciones en vez de agregar directo');
  const pasos = plano(t.pos.opcionesGrupos);
  formaDeArma(pasos, 'la semilla del POS');
  const eleccion = pasos.map((p) => p.opciones[0]);
  for (const [i, p] of pasos.slice(0, 3).entries()) t.pos.elegirOpcion(p.nombre, eleccion[i]);
  assert.equal(t.pos.ordenActiva.items.length, 0, 'con tres de cuatro todavía no se agrega');
  t.pos.elegirOpcion(pasos[3].nombre, eleccion[3]);
  assert.equal(t.pos.modalOpciones, false);
  const [linea] = plano(t.pos.ordenActiva.items);
  assert.equal(linea.nombre, 'Arma tu bowl');
  assert.equal(linea.precio, 15000);
  assert.equal(linea.qty, 1);
  assert.equal(linea.nota, eleccion.join(' · '));
  await asentar();
  assert.equal(t.base.rpcs.reduce((n, r) => n + r.delta, 0), 1, 'la unidad llegó a la base');
});

// La gramática de la descripción, con una descripción inventada (no la del restaurante): comas, la última con «o» o «u», una «y»
// que queda dentro de la opción, mayúscula inicial, sin repetidas. Y si la descripción cambia, los pasos cambian con ella.
test('los pasos siguen a la descripción: cada grupo un paso, las opciones por coma y la última por «o» o «u», una «y» queda dentro de la opción; otra combinación es otra línea y la misma suma cantidad', async () => {
  const t = montar();
  const arma = { ...ARMA, desc: 'Base: arroz o pasta. Proteína: pollo, res u hongos. Vegetales: pico de gallo, tomate y zanahoria, o pepino. Guarnición: papa, papa o yuca.' };
  assert.deepEqual(pasosDe(t, arma), [
    { nombre: 'Base', opciones: ['Arroz', 'Pasta'] },
    { nombre: 'Proteína', opciones: ['Pollo', 'Res', 'Hongos'] },
    { nombre: 'Vegetales', opciones: ['Pico de gallo', 'Tomate y zanahoria', 'Pepino'] },
    { nombre: 'Guarnición', opciones: ['Papa', 'Yuca'] },
  ]);
  const elegir = (valores) => { t.pos.agregarProducto(arma); PASOS.forEach((g, i) => t.pos.elegirOpcion(g, valores[i])); };
  elegir(['Arroz', 'Hongos', 'Tomate y zanahoria', 'Yuca']);
  elegir(['Pasta', 'Pollo', 'Pepino', 'Papa']);
  elegir(['Arroz', 'Hongos', 'Tomate y zanahoria', 'Yuca']);
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.nota, i.qty])), [
    ['Arroz · Hongos · Tomate y zanahoria · Yuca', 2],
    ['Pasta · Pollo · Pepino · Papa', 1],
  ]);
  assert.equal(t.pos.totalOrdenActiva, 3 * 15000);
  await asentar();
  assert.equal(t.base.rpcs.reduce((n, r) => n + r.delta, 0), 3, 'las tres unidades llegaron a la base');

  // Editada la descripción (desde Productos, o un update que llega por Realtime), el POS pregunta lo nuevo: sin tocar código.
  assert.deepEqual(pasosDe(t, { ...arma, desc: 'Base: quinua o arroz. Proteína: tofu.' }), [
    { nombre: 'Base', opciones: ['Quinua', 'Arroz'] },
    { nombre: 'Proteína', opciones: ['Tofu'] },
  ]);
});

test('sin grupos en la descripción, «Arma tu bowl» se agrega directo como cualquier producto; y solo «Arma tu bowl» lee pasos en su descripción', () => {
  for (const desc of ['', 'Elige base, proteína, vegetales y guarnición', 'Base: arroz o pasta']) {
    const t = montar();
    t.pos.agregarProducto({ ...ARMA, desc });
    assert.equal(t.pos.modalOpciones, false, `«${desc}»: sin hoja de opciones`);
    assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.nombre, i.qty, i.nota])), [['Arma tu bowl', 1, '']], `«${desc}»: se agregó directo`);
  }
  const t = montar();
  t.pos.agregarProducto({ ...CRIOLLO, desc: 'Base: arroz. Proteína: chicharrón.' });
  assert.equal(t.pos.modalOpciones, false, 'otro producto con una descripción por grupos no pregunta nada');
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
    { id: 'ej1', cat: 'Ejecutivos', nombre: 'Menú Resplandor', precio: 23000, activo: true },
  ];
  assert.deepEqual(Object.keys(t.pos.productosPorCategoria), ['Ejecutivos', 'Bowls', 'Bebidas', 'Entradas']);
});
