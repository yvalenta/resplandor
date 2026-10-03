// Las correcciones de la refutación y la crítica de la integración «personas y botones» + «imprimir en la caja» (tarea/integracion-personas-impresion,
// sobre la ola C). Cada prueba es lo contrario de lo que fallaba:
//
//   R1  la caja imprime el pie y el QR de los AJUSTES del ticket (no los de fábrica), y nada de QR si el admin lo apagó
//   R2  un insert que tarda más de 10 s y una cancelación que llega antes («no existe»): el POS vuelve a cancelar, no sale una segunda copia
//   R3  renombrar o asignar y cobrar la mesa completa enseguida: la `version` que devuelve la base se anota y cobrar espera las notas en vuelo
//   R4  el sobre de la cola se puede aplicar DESPUÉS de recargar el POS: abrir Administración o la vista de la impresora vuelve a preguntar
//   P2  «Imprimir aquí» en el aviso de «la caja no responde» (solo si la pantalla muestra esa cuenta)
//   L1  (navegador) el ticket con la caja en línea y «Reabrir» (tres filas): ni «Cobrado · Deshacer» ni el aviso de la caja tapan un botón, a
//       390, 768, 1024 y 1440 px; y la barra de cobro de la orden está encima de la nav desde el primer instante (sin fundido que la esconda)
//
// Dos partes: A. LÓGICA (el <script> real de pos.html en un vm; corre siempre) y B. EN NAVEGADOR (Chromium con el arnés de Supabase simulado; se
// salta con el motivo si no hay).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos, FECHA_FIJA } from './_pos-simulado.mjs';
import { asentar, crearBaseFalsa, crearPos, mesaBase, ordenBase, plano } from './_pos-vm.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');

// ═════════════════════════ A. lógica ═════════════════════════

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const CAJA = { id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: new Date().toISOString(), version_agente: '1.0.0' };
const NADA = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} };
const DOC = { title: 'POS', visibilityState: 'visible' };

/** Relojes que no corren solos: guardan cada setTimeout con su espera para dispararlos a mano (`disparar(ms)` corre todos los de esa espera). */
function relojesEspia() {
  const pendientes = []; const intervalos = []; let n = 0;
  return {
    pendientes, intervalos,
    setTimeout: (fn, ms) => { const id = ++n; pendientes.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const i = pendientes.findIndex((p) => p.id === id); if (i >= 0) pendientes.splice(i, 1); },
    setInterval: (fn, ms) => { intervalos.push({ fn, ms }); return ++n; }, clearInterval: () => {},
    esperas: () => pendientes.map((p) => p.ms).sort((a, b) => a - b),
    async disparar(ms) { for (const p of pendientes.filter((x) => x.ms === ms)) { this.clearTimeout(p.id); await p.fn(); } await asentar(); },
  };
}

async function montarPos({ base, relojes = NADA, rol = 'admin' } = {}) {
  const t = crearPos({ base, extras: relojes, documento: DOC });
  t.base = base; t.pos.usuario = YO; t.pos.imprimir = () => {};
  return t;
}
async function arrancarEnOrden(t, ordenId = 'o1', mesaId = 3) {
  await t.pos.arrancarApp(); await asentar();
  t.pos.mesaActiva = t.pos.mesas.find((m) => m.id === mesaId);
  t.pos.ordenActiva = t.pos.ordenes.find((o) => o.id === ordenId);
  t.pos.vista = 'orden';
  return t;
}

// ───────────── R1 · el documento de la caja usa los ajustes del ticket ─────────────

const baseConAjustes = (ajustes, extra = {}) => crearBaseFalsa({
  rol: 'admin', olaC: { ajustes: true }, ajustes: ajustes ? [{ id: 1, ...ajustes }] : undefined, mesas: [mesaBase(3)],
  ordenes: [ordenBase('o1', 3, [{ id: 'a', nombre: 'Paloma', precio: 10000, qty: 1, nota: '' }])], impresoras: [CAJA], ...extra,
});
async function cuentaEnCaja(ajustes) {
  const base = baseConAjustes(ajustes);
  const t = await montarPos({ base });
  await arrancarEnOrden(t);
  await t.pos.cargarAjustes(); await asentar();
  assert.equal(await t.pos.imprimirCuentaEnCaja(), true);
  const [fila] = [...base.impresiones.values()];
  return { doc: fila.contenido, pos: t.pos, textos: fila.contenido.lineas.map((l) => l.texto) };
}

test('R1: con el pie cambiado y el QR apagado, la caja imprime el pie nuevo y NINGÚN QR', async () => {
  const { doc, textos, pos } = await cuentaEnCaja({ ticket_qr_url: 'https://g.page/r/resplandor-resena', ticket_qr_visible: false, ticket_pie: 'Martes 2x1 en jugos' });
  assert.equal(pos.ajustes.ticketPie, 'Martes 2x1 en jugos');
  assert.equal(textos.at(-1), 'Martes 2x1 en jugos', 'el pie es el de los ajustes, la última línea');
  assert.equal(textos.includes('Gracias por su visita'), false);
  assert.equal('qr' in doc, false, 'con el QR apagado el documento no lleva QR');
});

test('R1: con el QR encendido hacia otra dirección, la caja imprime ESA dirección y su etiqueta corta (la misma que el ticket de pantalla)', async () => {
  const { doc, pos } = await cuentaEnCaja({ ticket_qr_url: 'https://g.page/r/resplandor-resena', ticket_qr_visible: true, ticket_pie: 'Gracias por su visita' });
  assert.deepEqual(plano(doc.qr), { texto: 'https://g.page/r/resplandor-resena', etiqueta: 'g.page/r/resplandor-resena' });
  assert.equal(doc.qr.etiqueta, pos.qrTicketHost + new URL(doc.qr.texto).pathname, 'host y ruta, como urlCorta del ticket de pantalla');
});

test('R1: con los ajustes de fábrica (o sin la tabla) sale lo de siempre: «Gracias por su visita» y el QR de resplandor.ynt.codes', async () => {
  for (const ajustes of [undefined, { ticket_qr_url: 'https://resplandor.ynt.codes/', ticket_qr_visible: true, ticket_pie: 'Gracias por su visita' }]) {
    const { doc, textos } = await cuentaEnCaja(ajustes);
    assert.equal(textos.at(-1), 'Gracias por su visita');
    assert.deepEqual(plano(doc.qr), { texto: 'https://resplandor.ynt.codes/', etiqueta: 'resplandor.ynt.codes' });
  }
});

test('R1: la página de prueba lleva el QR de los ajustes aunque el QR del ticket esté apagado (sirve para comprobar que la caja dibuja QR)', async () => {
  const base = baseConAjustes({ ticket_qr_url: 'https://g.page/r/resplandor-resena', ticket_qr_visible: false, ticket_pie: 'Martes 2x1 en jugos' });
  const t = await montarPos({ base });
  await arrancarEnOrden(t);
  await t.pos.cargarAjustes(); await asentar();
  assert.deepEqual(plano(t.pos.documentoPrueba().qr), { texto: 'https://g.page/r/resplandor-resena', etiqueta: 'g.page/r/resplandor-resena' });
  const fabrica = await montarPos({ base: baseConAjustes(undefined) });
  assert.deepEqual(plano(fabrica.pos.documentoPrueba().qr), { texto: 'https://resplandor.ynt.codes/', etiqueta: 'resplandor.ynt.codes' });
});

// ───────────── R2 · el insert tarda y la cancelación llega antes ─────────────

const soloEnCaja = (t, estado = 'pendiente') => [...t.base.impresiones.values()].filter((f) => f.estado === estado);
const cancelaciones = (t) => t.supabase.rpcs('impresion_cancelar');

async function conInsertLento({ relojes }) {
  const base = crearBaseFalsa({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [{ id: 'en1', nombre: 'Empanadas', precio: 16000, qty: 1, nota: '' }])], impresoras: [CAJA] });
  let soltarInsert = null;
  const original = base.responder;
  base.responder = async (c) => {
    if (c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'insert') {
      await new Promise((r) => { soltarInsert = r; });          // el insert queda en vuelo (mala señal)
      return original(c);                                        // …y llega a la base DESPUÉS
    }
    return original(c);
  };
  const t = await montarPos({ base, relojes });
  let papel = 0;
  t.pos.imprimir = () => { papel++; };
  await arrancarEnOrden(t);
  const envio = t.pos.imprimirCuentaEnCaja();
  await asentar();
  assert.equal(typeof soltarInsert, 'function', 'el insert salió');
  await relojes.disparar(10000);                                 // TOPE_ENVIO_CAJA_MS: el insert «no contestó»
  const ok = await envio;
  await relojes.disparar(60);                                    // imprimirPreCuenta → imprimir() del teléfono
  return { t, ok, papel: () => papel, soltarInsert: () => soltarInsert() };
}

test('R2: el insert llega DESPUÉS de que el teléfono imprimió y de que la base dijo «no existe»: el POS lo cancela al llegar, no sale una segunda copia', async () => {
  const relojes = relojesEspia();
  const { t, ok, papel, soltarInsert } = await conInsertLento({ relojes });
  assert.equal(ok, false);
  assert.equal(papel(), 1, 'el teléfono imprimió');
  assert.equal(cancelaciones(t).length, 1, 'la primera cancelación dijo «no existe» (el insert aún no había entrado)');
  assert.deepEqual(relojes.esperas().filter((ms) => [3000, 10000, 30000].includes(ms)), [3000, 10000, 30000], 'y quedaron las tres cancelaciones de respaldo');
  soltarInsert(); await asentar();
  assert.equal(soloEnCaja(t).length, 0, 'ningún trabajo vivo en la cola: el agente no saca la segunda copia');
  const [fila] = [...t.base.impresiones.values()];
  assert.deepEqual({ estado: fila.estado, error: fila.error }, { estado: 'error', error: 'cancelada' });
  assert.equal(cancelaciones(t).length, 2, 'la segunda cancelación fue la que pegó, al contestar el insert');
  assert.equal(t.pos.cajaTrabajos.length, 0, 'y sin aviso colgado: el teléfono ya había resuelto');
});

test('R2: si la respuesta del insert nunca llega pero el trabajo entró, las cancelaciones de respaldo (3, 10 y 30 s) lo cancelan y paran al lograrlo', async () => {
  const relojes = relojesEspia();
  const { t, ok } = await conInsertLento({ relojes });
  assert.equal(ok, false);
  const antes = cancelaciones(t).length;
  // El insert SÍ llegó a la base, pero su respuesta se perdió (no se suelta): entre el segundo 3 y el 10 aparece la fila.
  await relojes.disparar(3000);
  assert.equal(cancelaciones(t).length, antes + 1, 'a los 3 s vuelve a preguntar (todavía «no existe»)');
  const id = cancelaciones(t).at(-1).args.p_id;
  t.base.impresiones.set(id, { id, estado: 'pendiente' });
  await relojes.disparar(10000);
  assert.equal(soloEnCaja(t).length, 0, 'a los 10 s la encontró y la canceló');
  assert.equal(cancelaciones(t).length, antes + 2);
  await relojes.disparar(30000);
  assert.equal(cancelaciones(t).length, antes + 2, 'ya cancelada: el de los 30 s no pregunta otra vez');
});

test('R2: si la caja YA tomó el trabajo cuando por fin se pregunta, no se cancela (se estaba imprimiendo) y las demás cancelaciones paran', async () => {
  const relojes = relojesEspia();
  const { t, ok } = await conInsertLento({ relojes });
  assert.equal(ok, false);
  const id = cancelaciones(t).at(-1).args.p_id;
  t.base.impresiones.set(id, { id, estado: 'imprimiendo' });      // el insert entró y el agente lo tomó antes de la siguiente pregunta
  const n = cancelaciones(t).length;
  await relojes.disparar(3000);
  assert.equal(cancelaciones(t).length, n + 1);
  assert.equal(t.base.impresiones.get(id).estado, 'imprimiendo', 'no se toca lo que la caja está imprimiendo');
  await relojes.disparar(10000);
  assert.equal(cancelaciones(t).length, n + 1, '«no_pendiente» es una respuesta: no se vuelve a preguntar');
});

test('R2: sin tiempo agotado (el insert contesta) no queda ningún reloj de cancelación ni se llama a impresion_cancelar', async () => {
  const relojes = relojesEspia();
  const base = crearBaseFalsa({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [{ id: 'en1', nombre: 'Empanadas', precio: 16000, qty: 1, nota: '' }])], impresoras: [CAJA] });
  const t = await montarPos({ base, relojes });
  await arrancarEnOrden(t);
  assert.equal(await t.pos.imprimirCuentaEnCaja(), true);
  assert.equal(cancelaciones(t).length, 0);
  assert.equal(relojes.esperas().includes(3000), false);
});

// ───────────── R3 · renombrar o asignar y cobrar enseguida ─────────────

const ITEMS_PERSONAS = () => [
  { id: 'a', nombre: 'Ejecutivo', precio: 21000, qty: 1, nota: 'Persona 1' },
  { id: 'b', nombre: 'Limonada', precio: 13000, qty: 1, nota: 'Persona 1' },
  { id: 'c', nombre: 'Empanadas', precio: 16000, qty: 1, nota: 'Persona 2' },
];
/** Una base con el guardia de `version` de la ola C y `actualizar_nota_item` como la función real: cambia la nota y sube la versión. `retener` (opcional) frena la respuesta. */
function baseDePersonas({ retener = null } = {}) {
  const base = crearBaseFalsa({ rol: 'mesero', olaC: { deshacer: true }, mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, ITEMS_PERSONAS(), 1)] });
  const original = base.responder;
  base.responder = async (c) => {
    if (c.tipo === 'rpc' && c.nombre === 'actualizar_nota_item') {
      if (retener) await retener();
      const o = base.ordenes.get(c.args.p_orden_id);
      o.items = o.items.map((i) => (i.id === c.args.p_item_id ? { ...i, nota: c.args.p_nota ?? '' } : i));
      o.version = (o.version || 0) + 1;
      return { data: { ...o }, error: null };
    }
    return original(c);
  };
  return base;
}
const relojesRapidos = { setTimeout: (fn, ms) => { if ((ms || 0) < 100) Promise.resolve().then(fn); return 0; }, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} };

test('R3: renombrar «Persona 1» a «Camila» (dos ítems) y cobrar la mesa completa enseguida: la `version` se anotó y el cobro entra (sin RS003)', async () => {
  const base = baseDePersonas();
  const t = await montarPos({ base, relojes: relojesRapidos });
  await arrancarEnOrden(t);
  assert.equal(t.pos._baseConGuardia, true, 'el POS sabe que la base tiene el guardia de version (ola C)');
  assert.equal(await t.pos.renombrarPersona('Persona 1', 'Camila'), 'Camila');
  assert.equal(t.pos.ordenActiva.version, base.ordenes.get('o1').version, 'la versión local es la de la base (1 + una por ítem)');
  assert.equal(base.ordenes.get('o1').version, 3);
  t.pos.facturar(); await asentar(30);
  assert.equal(base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(String(t.pos.aviso?.texto || '').includes('otra persona'), false);
});

test('R3: cobrar la mesa completa MIENTRAS el renombrado sigue en vuelo espera a que terminen las notas (el cobro sube con la versión final)', async () => {
  let soltar = null; let llamadas = 0;
  const base = baseDePersonas({ retener: () => { llamadas++; return new Promise((r) => { soltar = r; }); } });
  const t = await montarPos({ base, relojes: relojesRapidos });
  await arrancarEnOrden(t);
  const renombre = t.pos.renombrarPersona('Persona 1', 'Camila');
  await asentar();
  assert.equal(llamadas, 1, 'la primera nota salió y la base no contesta todavía');
  t.pos.facturar(); await asentar(30);
  assert.equal(base.ordenes.get('o1').estado, 'abierta', 'el cobro espera: aún no subió');
  soltar(); await asentar(); soltar(); await asentar(30);        // contesta la primera nota, sale la segunda y contesta
  await renombre;
  await asentar(30);
  assert.equal(llamadas, 2);
  assert.equal(base.ordenes.get('o1').estado, 'cerrada', 'terminadas las notas, el cobro entra con la versión que la base ya tenía');
  assert.deepEqual(base.ordenes.get('o1').items.map((i) => i.nota), ['Persona 1 (Camila)', 'Persona 1 (Camila)', 'Persona 2']);
});

test('R3: asignar a una persona («Asignar», ciclarPagador, una sola llamada) y cobrar enseguida tampoco da RS003', async () => {
  const base = baseDePersonas();
  const t = await montarPos({ base, relojes: relojesRapidos });
  await arrancarEnOrden(t);
  const item = t.pos.ordenActiva.items.find((i) => i.id === 'c');
  t.pos.ciclarPagador(item);                                      // Persona 2 → Persona 3
  t.pos.facturar(); await asentar(30);
  assert.equal(base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(base.ordenes.get('o1').items.find((i) => i.id === 'c').nota, 'Persona 3');
});

// ───────────── R4 · el sobre se aplica después de recargar ─────────────

test('R4: un POS que arrancó SIN la cola la encuentra al abrir Administración (y arma el reloj); sin abrirla, sigue callado', async () => {
  const relojes = relojesEspia();
  const base = crearBaseFalsa({ rol: 'admin', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [{ id: 'a', nombre: 'Paloma', precio: 10000, qty: 1, nota: '' }])], impresoras: [] });
  base.colaAusente = true;                                        // §2: la base de hoy, sin la cola
  const t = await montarPos({ base, relojes });
  await t.pos.arrancarApp(); await asentar();
  const preguntas = () => t.supabase.llamadas.filter((c) => c.tipo === 'rpc' && c.nombre === 'impresora_estado').length;
  assert.equal(t.pos.tieneImpresora, false);
  assert.equal(relojes.intervalos.filter((i) => i.ms === 30000).length, 0, 'sin cola no hay ciclo de preguntas');
  const n = preguntas();
  await t.pos.cargarEstadoCaja(); await t.pos.cargarEstadoCaja();
  assert.equal(preguntas(), n, 'una pregunta normal no vuelve a insistir (se calla hasta recargar o hasta abrir Administración)');
  base.colaAusente = false;                                       // §3: se pega el sobre
  assert.equal(t.pos.irA('admin'), true);
  await asentar(30);
  assert.equal(t.pos.tieneImpresora, true, 'la tarjeta «Impresora de la caja · Sin configurar» ya existe');
  assert.equal(t.pos._cajaNoExiste, false);
  assert.equal(relojes.intervalos.filter((i) => i.ms === 30000).length, 1, 'y el ciclo que pregunta si la caja late quedó armado');
});

test('R4: abrir la vista de la impresora también vuelve a preguntar; y si la cola sigue sin existir, vuelve a callarse', async () => {
  const base = crearBaseFalsa({ rol: 'admin', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [{ id: 'a', nombre: 'Paloma', precio: 10000, qty: 1, nota: '' }])], impresoras: [] });
  base.colaAusente = true;
  const t = await montarPos({ base });
  await t.pos.arrancarApp(); await asentar();
  t.pos.irA('impresora'); await asentar(30);
  assert.equal(t.pos.tieneImpresora, false, 'la cola sigue sin existir');
  assert.equal(t.pos._cajaNoExiste, true, 'y el POS vuelve a callarse');
  base.colaAusente = false;
  t.pos.irA('impresora'); await asentar(30);
  assert.equal(t.pos.tieneImpresora, true);
});

// ───────────── P2 · «Imprimir aquí» en la caja que no responde ─────────────

test('P2: «Imprimir aquí» solo se ofrece si el trabajo no responde Y la pantalla muestra esa misma cuenta; lleva a los caminos de siempre', async () => {
  const base = crearBaseFalsa({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [{ id: 'en1', nombre: 'Empanadas', precio: 16000, qty: 1, nota: '' }])], impresoras: [CAJA] });
  const t = await montarPos({ base });
  const llamadas = [];
  t.pos.imprimirPreCuenta = () => llamadas.push('precuenta');
  t.pos.imprimirEnTelefono = () => llamadas.push('telefono');
  await arrancarEnOrden(t);
  const e = { clave: 'k', id: 'i1', tipo: 'cuenta', estado: 'pendiente', sinRespuesta: true, ordenId: 'o1' };
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), true, 'en la orden de esa cuenta');
  assert.equal(t.pos.imprimirAquiTrabajoCaja(e), true);
  assert.deepEqual(llamadas, ['precuenta']);
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja({ ...e, sinRespuesta: false }), false, 'sin «no responde» no se ofrece (la caja aún puede imprimirlo)');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja({ ...e, estado: 'impresa' }), false);
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja({ ...e, ordenId: 'otra' }), false, 'otra cuenta: el papel del teléfono saldría de lo que muestra la pantalla');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja({ ...e, tipo: 'ticket' }), false, 'un cobro no se ofrece desde la orden');
  t.pos.vista = 'mesas';
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), false, 'en otra pantalla tampoco');
  t.pos.vista = 'ticket';
  t.pos.ticketMostrado = { id: 'o1', esPreCuenta: true, items: [], total: 0 };
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja({ ...e, tipo: 'ticket' }), true, 'en el ticket de esa cuenta, sí');
  llamadas.length = 0;
  assert.equal(t.pos.imprimirAquiTrabajoCaja({ ...e, tipo: 'ticket' }), true);
  assert.deepEqual(llamadas, ['telefono']);
  assert.equal(t.pos.imprimirAquiTrabajoCaja({ ...e, ordenId: 'otra' }), false);
});

// ═════════════════════════ marcado ═════════════════════════

test('marcado: el aviso de la caja vive DENTRO de la pila de avisos del pulgar (se apila con «Deshacer»), primero; y las acciones del ticket miden su alto', () => {
  const pila = POS.slice(POS.indexOf('<div class="avisos-pulgar'), POS.indexOf('<!-- ▲ PARTE ola-c-c3 :: avisos -->'));
  assert.ok(pila.includes('class="toast-impresion '), 'el toast de la caja está en la pila');
  assert.ok(pila.indexOf('toast-impresion') < pila.indexOf('agregado-aviso') && pila.indexOf('toast-impresion') < pila.indexOf('deshacer-aviso'), 'va arriba de «+1» y de «Deshacer»');
  assert.equal((POS.match(/class="toast-impresion /g) || []).length, 1, 'y no hay un segundo toast suelto');
  assert.match(POS, /class="ticket-acciones [^"]*"\s+x-init="[^"]*new ResizeObserver[^"]*--pos-ticket-acciones[^"]*offsetHeight/, 'las acciones miden su alto en --pos-ticket-acciones');
  assert.doesNotMatch(POS.match(/<div class="ticket-acciones [^"]*"/)[0], /sm:flex-nowrap/, 'las acciones envuelven también desde 640 (con la caja y «Reabrir» son cuatro botones)');
  assert.match(POS, /<section x-show="\$store\.pos\.vista === 'orden'" x-cloak class="fade-enter vista vista-orden /, 'la orden lleva .vista-orden (sin fundido bajo 1024)');
});

// ═════════════════════════ B. en navegador ═════════════════════════

const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
let servidor = null;
let navegador = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});
async function abrir(t, vista, ancho, alto) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const { diag } = await abrirPos(page, { url: servidor.url, vista, dirCache: process.env.POS_CDN_CACHE || undefined });
    return { page, diag };
  } catch (e) {
    t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(e.message).split('\n')[0]}`);
    return null;
  }
}

/** Qué hay en el centro de un botón: 'ok' si es él, «fuera de la ventana» o «tapado por …». */
const quienTapa = (page, nombre) => page.evaluate((n) => {
  const vis = (b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed';
  const b = [...document.querySelectorAll('button')].find((x) => vis(x) && x.textContent.replace(/\s+/g, ' ').trim().startsWith(n));
  if (!b) return 'no existe';
  const r = b.getBoundingClientRect();
  if (r.y < 0 || r.y + r.height > innerHeight || r.x < 0 || r.x + r.width > innerWidth) return `fuera de la ventana (${Math.round(r.x)}, ${Math.round(r.y)}, ${Math.round(r.width)}×${Math.round(r.height)} en ${innerWidth}×${innerHeight})`;
  const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  if (e === b || b.contains(e)) return 'ok';
  return 'tapado por ' + (e ? (e.closest('.deshacer-aviso') ? 'el aviso de Deshacer' : e.closest('.toast-impresion') ? 'el aviso de la caja' : e.closest('.barra-inferior') ? 'la nav' : String(e.className || e.tagName)) : 'nada (fuera de la ventana)');
}, nombre);

for (const [ancho, alto] of [[320, 640], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
  test(`navegador ${ancho}×${alto}: ticket con la caja en línea y «Reabrir» (tres filas) + «Cobrado · Deshacer» + el aviso de la caja: ningún botón queda tapado ni fuera de la ventana`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'caja-ticket', ancho, alto); if (!a) return;
    const { page } = a;
    await page.evaluate(([hasta]) => {
      const p = Alpine.store('pos');
      p.ultimoCobro = { ordenId: 'x', abiertaId: null, mesaId: 3, monto: 81000, tipo: 'completo', hasta };
      p.cajaTrabajos = [{ clave: 'k1', id: 'i1', tipo: 'ticket', titulo: 'Ticket · Mesa 3', estado: 'pendiente', error: '', intentos: 0, sinRespuesta: false }];
    }, [Date.parse(FECHA_FIJA) + 11000]);
    await page.locator('.deshacer-aviso').waitFor();
    await page.waitForTimeout(300);
    const acc = await page.locator('.ticket-acciones').boundingBox();
    const medida = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pos-ticket-acciones')));
    assert.ok(Math.abs(acc.height - medida) <= 1, `--pos-ticket-acciones (${medida} px) es el alto real de las acciones (${acc.height} px)`);
    assert.ok(acc.height > 150, `con la caja y «Reabrir» son tres filas, no las dos de antes (${acc.height} px)`);
    for (const nombre of ['Imprimir en la caja', 'En este teléfono', 'Reabrir', 'Volver', 'Deshacer']) {
      assert.equal(await quienTapa(page, nombre), 'ok', `${ancho}×${alto}: «${nombre}»`);
    }
    // La pila de avisos queda justo sobre las acciones (sin taparlas) y el aviso de la caja no pisa «Cobrado · Deshacer».
    const des = await page.locator('.deshacer-aviso').boundingBox();
    assert.ok(des.y + des.height <= acc.y + 1, `«Cobrado · Deshacer» (termina en ${des.y + des.height}) cae sobre las acciones (empiezan en ${acc.y})`);
    assert.ok(acc.y - (des.y + des.height) <= 24, 'y pegado a ellas');
    const toast = await page.locator('.toast-impresion').boundingBox();
    if (ancho >= 1024) assert.ok(toast.y + toast.height <= des.y + 1, `desde 1024 el aviso de la caja se apila ARRIBA de «Deshacer» (termina en ${toast.y + toast.height}; «Deshacer» empieza en ${des.y})`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sin desborde horizontal');
    assert.deepEqual(a.diag.errores, []);
  });
}

for (const [ancho, alto] of [[768, 1024], [1440, 900]]) {
  test(`navegador ${ancho}×${alto}: las acciones del ticket se pegan al pie de la ventana desde 768 (con un ticket corto y con uno largo)`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'caja-ticket', ancho, alto); if (!a) return;
    const { page } = a;
    const pie = async () => { const r = await page.locator('.ticket-acciones').boundingBox(); return Math.round(alto - (r.y + r.height)); };
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ticket-acciones')).position), 'sticky');
    const caja = await page.locator('.caja-estado').boundingBox().catch(() => null);
    const bajo = caja ? Math.round(caja.height + 8) : 0;           // la línea «Caja en línea…» va después de las acciones
    assert.ok(await pie() <= bajo + 36, `ticket corto: las acciones quedan al pie de la ventana (a ${await pie()} px del borde de abajo)`);
    // Un ticket largo (30 líneas): las acciones siguen a la vista aunque haya que desplazarse.
    await page.evaluate(() => {
      const p = Alpine.store('pos');
      const items = Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, nombre: 'Producto ' + i, precio: 1000, qty: 1, nota: '' }));
      p.ticketMostrado = { id: 'larga', mesaId: 3, items, total: 30000, esPreCuenta: true, cerradaEn: new Date().toISOString() };
    });
    await page.waitForTimeout(250);
    const r = await page.locator('.ticket-acciones').boundingBox();
    assert.ok(r.y + r.height <= alto + 1 && r.y >= 0, `ticket largo: las acciones se ven sin desplazarse (y=${r.y}, alto ${alto})`);
    assert.equal(await quienTapa(page, 'Volver'), 'ok');
  });
}

for (const ancho of [390, 360, 320]) {
  test(`navegador ${ancho}: la barra de cobro de la orden queda encima de la nav desde el primer instante (la orden entra sin fundido bajo 1024)`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden-personas-detalle', ancho, ancho === 320 ? 640 : ancho === 360 ? 780 : 844); if (!a) return;
    const { page } = a;
    // Sin esperar a que pase ningún fundido: en el mismo instante en que la orden está a la vista.
    await page.evaluate(() => { const p = Alpine.store('pos'); p.vista = 'mesas'; });
    await page.evaluate(() => { Alpine.store('pos').vista = 'orden'; });
    // Alpine pinta la vista en el turno siguiente al cambio y, con la máquina cargada (la suite completa corre dos archivos a la vez), la consulta
    // llegaba antes y no encontraba el botón («no existe»; suelta pasaba siempre). Se espera a que el botón EXISTA y se vea, no a ningún fundido: se mide en cuanto aparece.
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && b.textContent.replace(/\s+/g, ' ').trim().startsWith('Generar ticket y cobrar')));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.vista-orden')).animationName), 'none', 'bajo 1024 la orden no lleva animación de entrada');
    assert.equal(await quienTapa(page, 'Generar ticket y cobrar'), 'ok');
    // La barra mide 68 px y está por ENCIMA de la nav (z 45 contra 40): el botón es lo que se toca.
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.barra-accion')).zIndex), '45');
    assert.deepEqual(a.diag.errores, []);
  });
}

test('navegador 1440: la orden SÍ conserva su fundido de entrada (la barra de cobro no es fija desde 1024)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas-detalle', 1440, 900); if (!a) return;
  assert.equal(await a.page.evaluate(() => getComputedStyle(document.querySelector('.vista-orden')).animationName), 'posAparecer');
  assert.equal(await a.page.evaluate(() => getComputedStyle(document.querySelector('.barra-accion')).position), 'static', 'desde 1024 es una tarjeta normal');
});

test('navegador 320: el total de la barra de cobro no se parte entre «$» y la cifra', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas-detalle', 320, 640); if (!a) return;
  const total = a.page.locator('.barra-accion .total-grande');
  assert.match(await total.innerText(), /^\$ \d/, 'un espacio duro entre «$» y la cifra');
  const h = (await total.boundingBox()).height;
  assert.ok(h < 40, `el total cabe en una línea (${h} px)`);
});

test('navegador 1440: la cabecera de las tarjetas del tablero mide lo mismo aunque un título se parta en dos líneas (el dato de abajo no baja solo en esa)', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'admin', 1440, 900); if (!a) return;
  const ys = await a.page.locator('.tarjeta-admin:visible .tarjeta-admin-dato').evaluateAll((l) => l.map((e) => Math.round(e.getBoundingClientRect().y - e.closest('.tarjeta-admin').getBoundingClientRect().y)));
  assert.ok(ys.length >= 8, `las tarjetas del tablero (${ys.length})`);
  const min = Math.min(...ys); const max = Math.max(...ys);
  assert.ok(max - min <= 1, `el dato de cada tarjeta arranca a la misma altura dentro de la suya (${ys.join(', ')})`);
});
