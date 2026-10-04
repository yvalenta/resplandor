// Imprimir SIEMPRE a la caja, con una confirmación, y la precuenta por persona (tarea/impresion-defecto, pedido de Yonatan del 2026-10-03):
//   «cuando se dé imprimir, por defecto será caja; no se abrirán opciones de este teléfono o en caja: siempre irá a caja, con confirmación
//    para imprimir» y «en la parte de dividir cuenta se podrá imprimir precuenta a cada persona; reorganizarlo visualmente, prioridad celular».
//
// Corre el <script> REAL de pos.html en un `vm` (scripts/pruebas/_pos-vm.mjs) contra la base falsa con la cola de impresión (la misma de
// pos-impresion-caja.test.mjs). La pantalla (modal, fila de dos líneas, medidas a 390 y 1280) se prueba en pos-impresion-defecto-navegador.test.mjs.
//
//   1. El destino        caja en línea → 'caja'; caja registrada sin latir → 'telefono' (emergencia); sin cola o sin caja registrada → null (como hoy)
//   2. La confirmación   pedirImpresion NO manda nada; aceptarImpresion manda UN trabajo y no abre la impresión del teléfono; cancelar no hace nada
//   3. Sin la caja       sin la migración imprime directo sin preguntar; la emergencia lo dice con «última señal hace N min» y no encola
//   4. Sin doble         el botón «En cola…» (trabajoEnCola) y el envío de uno a la vez; el estado que nunca se supo se pregunta antes de decidir
//   5. Una persona       la precuenta lleva SOLO sus líneas y su total, «PRECUENTA - no es un cobro» y «Cuenta de Camila · Mesa 3», respeta «Para llevar»
//                        y no cobra ni saca nada de la cuenta
//   6. El alcance        «Imprimir aquí» y lo que se cancela distinguen la precuenta entera de la de cada persona (misma orden)
//   8. Ronda 1          lo que halló la refutación: el papel de emergencia es lo que se confirmó (no la pantalla de después), la precuenta de una
//                       persona avisa de los abonos de la mesa, ningún trabajo sin terminar se esconde del aviso, «Imprimir en la caja» no se
//                       calla con otro envío en curso, la espera de 2,5 s se ve (y no se suma), y una caja dada de baja no cuenta como caja
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asentar, crearBaseFalsa, crearPos, mesaBase, ordenBase, plano, RAIZ } from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const CAJA = { id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: '2026-10-03T13:00:00Z', version_agente: '1.0.0' };
const HACE = (min) => new Date(Date.now() - min * 60000).toISOString();
// La cuenta de la mesa 3 dividida entre Camila (Persona 1), Andrés (Persona 2) y «Persona 3», con un ítem sin asignar.
const PERSONAS = () => [
  { id: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, qty: 1, nota: 'Sopa · Pollo — Persona 1 (Camila)' },
  { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 1, nota: 'Persona 1 (Camila)' },
  { id: 'ej1__frijol-res', nombre: 'Ejecutivo de la casa', precio: 21000, qty: 1, nota: 'Frijol · Res — Persona 2 (Andrés)' },
  { id: 'en1', nombre: 'Empanadas de la casa', precio: 16000, qty: 1, nota: 'Persona 2 (Andrés)' },
  { id: 'pf3', nombre: 'Pechuga a la plancha', precio: 36000, qty: 1, nota: 'Persona 3' },
  { id: 'be2', nombre: 'Jugo natural', precio: 9000, qty: 2, nota: 'Persona 3' },
  { id: 'be3', nombre: 'Cóctel de la casa', precio: 32000, qty: 1, nota: '' },
];
const PEDIDO = () => [
  { id: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, qty: 2, nota: 'Sopa · Pollo' },
  { id: 'en1', nombre: 'Empanadas de la casa', precio: 16000, qty: 1, nota: '' },
  { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 3, nota: '' },
];

// La cuenta de OTRA mesa, con su propia «Persona 1» (Lucía): la que no debe salir en el papel de la mesa 3.
const MESA5 = () => [{ id: 'bp1', nombre: 'Bandeja de la mesa 5', precio: 55000, qty: 1, nota: 'Persona 1 (Lucía)' }];

/** Relojes espía (como pos-impresion-caja.test.mjs): lo pendiente se dispara a mano. */
function relojesEspia() {
  const pendientes = [];
  const intervalos = [];
  let n = 0;
  return {
    pendientes, intervalos,
    setTimeout: (fn, ms) => { const id = ++n; pendientes.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const i = pendientes.findIndex((p) => p.id === id); if (i >= 0) pendientes.splice(i, 1); },
    setInterval: (fn, ms) => { const id = ++n; intervalos.push({ id, fn, ms }); return id; },
    clearInterval: (id) => { const i = intervalos.findIndex((p) => p.id === id); if (i >= 0) intervalos.splice(i, 1); },
    async disparar(ms) { for (const p of pendientes.filter((x) => x.ms === ms)) { this.clearTimeout(p.id); await p.fn(); } await asentar(); },
  };
}

/** Un POS con sesión y la mesa 3 abierta. `imprimirPreCuenta` e `imprimirEnTelefono` quedan espiados CON sus argumentos (la impresión del teléfono real necesita un documento). */
function montar({ impresoras = [CAJA], items = PEDIDO(), rol = 'mesero', interceptar, mesa5 = false } = {}) {
  const base = crearBaseFalsa({
    rol, impresoras,
    mesas: mesa5 ? [mesaBase(3), mesaBase(5)] : [mesaBase(3)],
    ordenes: mesa5 ? [ordenBase('o1', 3, items), ordenBase('o5', 5, MESA5())] : [ordenBase('o1', 3, items)],
  });
  if (interceptar) { const original = base.responder; base.responder = async (c) => (interceptar(c, original) ?? original(c)); }
  const relojes = relojesEspia();
  const extras = { setTimeout: relojes.setTimeout, clearTimeout: relojes.clearTimeout, setInterval: relojes.setInterval, clearInterval: relojes.clearInterval };
  const t = crearPos({ base, extras, documento: { title: 'Resplandor — POS', visibilityState: 'visible' } });
  t.base = base; t.relojes = relojes;
  t.pos.usuario = YO;
  t.telefono = [];                                   // lo que cae al papel de ESTE teléfono: ['precuenta', 'precuenta:Persona 1', 'ticket']
  const preReal = t.pos.imprimirPreCuenta.bind(t.pos);
  t.pos.imprimirPreCuenta = (persona = '', armada = null) => { t.telefono.push(persona ? 'precuenta:' + persona : 'precuenta'); return preReal(persona, armada); };
  const telReal = t.pos.imprimirEnTelefono.bind(t.pos);
  t.pos.imprimirEnTelefono = () => { t.telefono.push('ticket'); return telReal(); };
  t.pos.imprimir = () => { t.telefono.push('window.print'); };
  return t;
}
async function arrancar(t) {
  await t.pos.arrancarApp();
  await asentar();
  t.pos.mesaActiva = t.pos.mesas.find((m) => m.id === 3) || null;
  t.pos.ordenActiva = t.pos.ordenes.find((o) => o.id === 'o1') || null;
  t.pos.vista = 'orden';
  return t;
}
const inserts = (t) => t.supabase.de('impresiones', 'insert');
const cuerpoDe = (t, i = 0) => plano(inserts(t)[i].cuerpo);
const lineas = (doc) => doc.lineas.map((l) => (l.der !== undefined ? `${l.texto} | ${l.der}` : l.texto));

// ═════════════════════════ 1. El destino ═════════════════════════

test('destino: la caja en línea → «caja»; registrada pero sin latir → «telefono» (la salida de emergencia); sin cola o sin ninguna caja registrada → null (el teléfono, como hoy)', async () => {
  const enLinea = await arrancar(montar({ impresoras: [CAJA] }));
  assert.equal(enLinea.pos.destinoImpresion, 'caja');
  const apagada = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false }] }));
  assert.equal(apagada.pos.destinoImpresion, 'telefono');
  const vacia = await arrancar(montar({ impresoras: [] }));
  assert.equal(vacia.pos.cajaDisponible, true, 'la cola está en la base…');
  assert.equal(vacia.pos.destinoImpresion, null, '…pero nadie registró la caja: no hay a dónde mandar');
  const sinCola = await arrancar(montar({ impresoras: null }));
  assert.equal(sinCola.pos.cajaDisponible, false);
  assert.equal(sinCola.pos.destinoImpresion, null, 'sin la migración, el POS es el de hoy');
});

// ═════════════════════════ 2. La confirmación ═════════════════════════

test('confirmación: «Imprimir precuenta» NO manda nada; pregunta «¿Imprimir la precuenta en la caja?» con el resumen, y solo al confirmar entra UN trabajo, sin tocar el teléfono ni la pantalla', async () => {
  const t = await arrancar(montar());
  assert.equal(await t.pos.pedirImpresion('precuenta'), true);
  assert.deepEqual(inserts(t), [], 'pedir no escribe en la cola');
  assert.deepEqual(t.telefono, [], 'ni abre la impresión del teléfono');
  assert.deepEqual(plano(t.pos.confirmaImpresion), {
    que: 'precuenta', persona: '', destino: 'caja',
    titulo: 'Imprimir precuenta',
    pregunta: '¿Imprimir la precuenta en la caja?',
    resumen: 'Mesa 3 · 6 ítems · $ 97.000',
    boton: 'Imprimir en la caja'
  });
  assert.equal(await t.pos.aceptarImpresion(), true);
  assert.equal(t.pos.confirmaImpresion, null, 'al confirmar la pregunta se cierra');
  assert.equal(inserts(t).length, 1);
  assert.equal(cuerpoDe(t).tipo, 'cuenta');
  assert.equal(cuerpoDe(t).orden_id, 'o1');
  assert.equal(cuerpoDe(t).contenido.lineas.find((l) => l.texto === 'TOTAL').der, '$ 97.000');
  assert.deepEqual(t.telefono, [], 'con la caja en línea NO se abre la impresión del teléfono');
  assert.equal(t.pos.vista, 'orden', 'y no cambia de pantalla');
  assert.equal(t.pos.cajaTrabajos[0].titulo, 'Cuenta · Mesa 3');
  // Un segundo «Imprimir en la caja» (doble toque en el modal) ya no encuentra nada que aceptar.
  assert.equal(await t.pos.aceptarImpresion(), false);
  assert.equal(inserts(t).length, 1, 'una confirmación por toque: no sale doble');
});

test('confirmación: cancelar no hace nada, y pedir sin nada que imprimir (cuenta vacía) ni pregunta', async () => {
  const t = await arrancar(montar());
  await t.pos.pedirImpresion('precuenta');
  t.pos.cancelarImpresion();
  assert.equal(t.pos.confirmaImpresion, null);
  assert.equal(await t.pos.aceptarImpresion(), false, 'sin confirmación abierta, aceptar no manda nada');
  assert.deepEqual(inserts(t), []);
  assert.deepEqual(t.telefono, []);
  const vacia = await arrancar(montar({ items: [] }));
  assert.equal(await vacia.pos.pedirImpresion('precuenta'), false);
  assert.equal(vacia.pos.confirmaImpresion, null, 'una cuenta vacía no se imprime ni se pregunta');
  assert.deepEqual(vacia.telefono, []);
});

test('confirmación: el ticket pregunta «¿Imprimir el ticket en la caja?» y manda el tipo que muestra la pantalla (cobro → ticket, abono → abono, precuenta → cuenta)', async () => {
  const cobro = await arrancar(montar());
  cobro.pos.facturar();
  assert.equal(cobro.pos.vista, 'ticket');
  await cobro.pos.pedirImpresion('ticket');
  assert.equal(cobro.pos.confirmaImpresion.pregunta, '¿Imprimir el ticket en la caja?');
  assert.equal(cobro.pos.confirmaImpresion.titulo, 'Imprimir ticket');
  assert.deepEqual(inserts(cobro), [], 'nada sale sin confirmar');
  await cobro.pos.aceptarImpresion();
  assert.equal(cuerpoDe(cobro).tipo, 'ticket');
  assert.deepEqual(cobro.telefono, []);

  const abono = await arrancar(montar());
  abono.pos.montoAbono = '10000';
  abono.pos.cobrarMonto();
  await abono.pos.pedirImpresion('ticket');
  await abono.pos.aceptarImpresion();
  assert.equal(cuerpoDe(abono).tipo, 'abono');

  const pre = await arrancar(montar());
  pre.pos.ticketMostrado = pre.pos._armarPreCuenta();
  pre.pos.vista = 'ticket';
  await pre.pos.pedirImpresion('ticket');
  assert.equal(pre.pos.confirmaImpresion.pregunta, '¿Imprimir la precuenta en la caja?', 'la pantalla del ticket muestra una precuenta: la pregunta la llama como sale en el papel');
  assert.equal(pre.pos.confirmaImpresion.titulo, 'Imprimir precuenta');
  await pre.pos.aceptarImpresion();
  assert.equal(cuerpoDe(pre).tipo, 'cuenta');

  const persona = await arrancar(montar({ items: PERSONAS() }));
  persona.pos.ticketMostrado = persona.pos._armarPreCuentaPersona('Persona 2');
  persona.pos.vista = 'ticket';
  await persona.pos.pedirImpresion('ticket');
  assert.equal(persona.pos.confirmaImpresion.pregunta, '¿Imprimir la precuenta de Andrés en la caja?');
});

test('confirmación: la caja se cae entre «pedir» y «confirmar»: el teléfono imprime solo y lo dice (la persona ya pidió el papel, no se queda sin él)', async () => {
  const t = await arrancar(montar());
  await t.pos.pedirImpresion('precuenta');
  t.base.impresoras[0].en_linea = false;
  t.pos.cajaRevisadaEn = 0;                          // el estado ya es viejo: se confirma antes de mandar
  assert.equal(await t.pos.aceptarImpresion(), false);
  assert.deepEqual(inserts(t), [], 'no se encola en una caja que no late');
  assert.deepEqual(t.telefono, ['precuenta']);
  assert.equal(t.pos.aviso.texto, 'La caja no está en línea. Se imprime desde este teléfono.');
});

// ═════════════════════════ 3. Sin la caja ═════════════════════════

test('sin la migración (la base de HOY): imprimir va directo al teléfono, sin confirmación extra, como hoy; lo mismo si la cola existe pero nadie registró la caja', async () => {
  for (const impresoras of [null, []]) {
    const t = await arrancar(montar({ impresoras }));
    assert.equal(await t.pos.pedirImpresion('precuenta'), true);
    assert.equal(t.pos.confirmaImpresion, null, 'no hay confirmación: el diálogo de impresión del teléfono ya lo es');
    assert.deepEqual(t.telefono, ['precuenta']);
    assert.equal(t.pos.vista, 'ticket');
    assert.equal(t.pos.ticketMostrado.esPreCuenta, true);
    assert.deepEqual(inserts(t), []);
    await t.pos.pedirImpresion('ticket');
    assert.equal(t.pos.confirmaImpresion, null);
    assert.deepEqual(t.telefono, ['precuenta', 'ticket', 'window.print']);
  }
});

test('emergencia: con la caja registrada pero sin latir, la confirmación dice «La caja no está en línea (última señal hace N min). Se imprime desde este teléfono.» y ofrece «Imprimir aquí»; nada se encola', async () => {
  const t = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false, ultimo_latido: HACE(7) }] }));
  await t.pos.pedirImpresion('precuenta');
  assert.deepEqual(t.telefono, [], 'nada sale sin confirmar');
  const c = plano(t.pos.confirmaImpresion);
  assert.equal(c.destino, 'telefono');
  assert.equal(c.pregunta, 'La caja no está en línea (última señal hace 7 min). Se imprime desde este teléfono.');
  assert.equal(c.boton, 'Imprimir aquí');
  assert.equal(c.titulo, 'Imprimir precuenta');
  assert.equal(await t.pos.aceptarImpresion(), true);
  assert.deepEqual(t.telefono, ['precuenta'], 'la precuenta sale por el teléfono (abre el ticket y, a los 60 ms, su diálogo de impresión)');
  assert.deepEqual(inserts(t), [], 'y no se encola nada en la caja');
  assert.equal(t.pos.vista, 'ticket');
  // Varias cajas: se dice la señal de la que dio señal más reciente; sin ninguna señal, «aún no ha dado señal».
  const dos = await arrancar(montar({ impresoras: [{ ...CAJA, id: 'a', en_linea: false, ultimo_latido: HACE(30) }, { ...CAJA, id: 'b', en_linea: false, ultimo_latido: HACE(3) }] }));
  await dos.pos.pedirImpresion('precuenta');
  assert.match(dos.pos.confirmaImpresion.pregunta, /última señal hace 3 min/);
  const nunca = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false, ultimo_latido: null }] }));
  await nunca.pos.pedirImpresion('precuenta');
  assert.equal(nunca.pos.confirmaImpresion.pregunta, 'La caja no está en línea (aún no ha dado señal). Se imprime desde este teléfono.');
});

test('emergencia: el ticket sin caja en línea pregunta lo mismo y «Imprimir aquí» imprime el del teléfono (imprimirEnTelefono)', async () => {
  const t = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false, ultimo_latido: HACE(4) }] }));
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  assert.equal(t.pos.confirmaImpresion.destino, 'telefono');
  assert.equal(t.pos.confirmaImpresion.titulo, 'Imprimir ticket');
  await t.pos.aceptarImpresion();
  assert.deepEqual(t.telefono, ['ticket', 'window.print']);
  assert.deepEqual(inserts(t), []);
});

// ═════════════════════════ 4. Sin doble impresión ═════════════════════════

test('sin doble impresión: mientras el trabajo está «enviando» o en cola el botón dice «En cola…» (trabajoEnCola) y pedir otro igual no abre nada; terminado, vuelve', async () => {
  const t = await arrancar(montar());
  const alcance = t.pos.alcancePreCuenta();
  assert.equal(alcance, 'cuenta:o1:');
  assert.equal(t.pos.trabajoEnCola(alcance), false);
  await t.pos.pedirImpresion('precuenta');
  const envio = t.pos.aceptarImpresion();
  assert.equal(t.pos.trabajoEnCola(alcance), true, 'enviando ya cuenta');
  assert.equal(await t.pos.pedirImpresion('precuenta'), false, 'un segundo toque en ese instante no abre otra confirmación');
  assert.equal(t.pos.confirmaImpresion, null);
  await envio;
  assert.equal(t.pos.cajaTrabajos[0].estado, 'pendiente');
  assert.equal(t.pos.trabajoEnCola(alcance), true, 'en cola: el botón sigue apagado');
  assert.equal(await t.pos.pedirImpresion('precuenta'), false);
  assert.equal(inserts(t).length, 1);
  // La caja lo toma: el botón vuelve (el papel ya salió o va saliendo).
  const fila = t.base.impresiones.values().next().value;
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(fila.id, 'imprimiendo'), old: {} });
  assert.equal(t.pos.trabajoEnCola(alcance), false);
  assert.equal(await t.pos.pedirImpresion('precuenta'), true, 'y se puede pedir otra vez');
  // El ticket tiene su propio alcance: la precuenta en cola no apaga el «Imprimir» de un cobro.
  assert.notEqual(t.pos.alcanceTicket, alcance);
});

test('estado desconocido: si la red falló al arrancar (no se sabe si hay cola) se pregunta ANTES de decidir, y un «no sé» no se toma por «no hay caja»', async () => {
  const t = montar({ impresoras: [CAJA] });
  t.base.fallar('rpc:impresora_estado');
  await t.pos.arrancarApp(); await asentar();
  t.pos.mesaActiva = t.pos.mesas.find((m) => m.id === 3); t.pos.ordenActiva = t.pos.ordenes.find((o) => o.id === 'o1'); t.pos.vista = 'orden';
  assert.equal(t.pos.cajaDisponible, false);
  assert.equal(t.pos._cajaNoExiste, false, 'no fue «no existe»: fue un fallo pasajero');
  t.base.repararTodo();
  await t.pos.pedirImpresion('precuenta');
  assert.equal(t.pos.confirmaImpresion?.destino, 'caja', 'volvió a preguntar, vio la caja y pregunta por ella en vez de imprimir en el teléfono');
  assert.deepEqual(t.telefono, []);
});

// ═════════════════════════ 5. La precuenta de una persona ═════════════════════════

test('persona: la precuenta lleva SOLO las líneas de esa persona y su total, con su nombre, y no cobra ni saca nada de la cuenta', async () => {
  const t = await arrancar(montar({ items: PERSONAS() }));
  const antes = plano(t.pos.ordenActiva.items);
  const camila = t.pos._armarPreCuentaPersona('Persona 1');
  assert.deepEqual(plano(camila.items.map((i) => i.id)), ['ej1__sopa-pollo', 'be1']);
  assert.equal(camila.total, 34000);
  assert.equal(camila.persona, 'Camila');
  assert.equal(camila.personaClave, 'Persona 1');
  assert.equal(camila.esPreCuenta, true);
  assert.equal(camila.dividirOculto, true, 'no reparte en partes iguales');
  assert.equal(camila.id, 'o1', 'es de la cuenta abierta: nada se cobra');
  const tres = t.pos._armarPreCuentaPersona('Persona 3');
  assert.equal(tres.persona, 'Persona 3', 'sin nombre, «Persona N»');
  assert.equal(tres.total, 54000);
  assert.equal(t.pos._armarPreCuentaPersona('Persona 4'), null, 'quien no tiene nada no tiene precuenta');
  assert.deepEqual(plano(t.pos.ordenActiva.items), antes, 'armarla no toca la cuenta');
  assert.equal(t.pos.ordenes.length, 1, 'ni crea una venta');
});

test('persona: el documento de la caja dice «PRECUENTA - no es un cobro», «Cuenta de Camila · Mesa 3», solo sus líneas y su total (con el mismo formato del ticket de la caja)', async () => {
  const t = await arrancar(montar({ items: PERSONAS() }));
  const doc = plano(t.pos.documentoTicket(t.pos._armarPreCuentaPersona('Persona 1'), 'cuenta'));
  const l = lineas(doc);
  assert.equal(doc.titulo, 'Resplandor');
  assert.deepEqual(plano(doc.lineas[0]), { texto: 'PRECUENTA - no es un cobro', alinear: 'centro', negrita: true });
  assert.deepEqual(plano(doc.lineas[1]), { texto: 'Cuenta de Camila · Mesa 3', alinear: 'centro' });
  assert.equal(doc.lineas[2].texto, '---');
  assert.ok(!l.some((x) => /^Mesa \|/.test(x) || /^Cuenta de \|/.test(x)), 'esa línea reemplaza a las filas «Mesa» y «Cuenta de»');
  assert.ok(!l.some((x) => /COBRO|FACTURA/.test(x)), 'no lleva el encabezado de la cuenta entera');
  assert.ok(l.includes('1 x Ejecutivo de la casa | $ 21.000'));
  assert.ok(l.includes('Sopa · Pollo'), 'con su variante, sin el sufijo «— Persona 1 (Camila)» ni el nombre repetido');
  assert.ok(l.includes('1 x Limonada de coco | $ 13.000'));
  assert.ok(!l.some((x) => /Andr|Persona|Pechuga|Jugo|Empanadas|Frijol|Cóctel/.test(x)), `nada de los demás:\n${l.join('\n')}`);
  assert.ok(l.includes('Ítems | 2'));
  assert.deepEqual(plano(doc.lineas.find((x) => x.texto === 'TOTAL')), { texto: 'TOTAL', der: '$ 34.000', negrita: true, doble: true });
  assert.ok(!l.some((x) => /^Queda por pagar|^División entre|^Persona \d/.test(x)), 'sin «Queda por pagar» ni reparto en partes iguales');
  assert.ok(!l.some((x) => x.length > 120), 'cada texto cabe en el papel');
  // Sin nombre: «Persona 3».
  const p3 = lineas(plano(t.pos.documentoTicket(t.pos._armarPreCuentaPersona('Persona 3'), 'cuenta')));
  assert.ok(p3.includes('Cuenta de Persona 3 · Mesa 3'));
  assert.ok(p3.includes('2 x Jugo natural | $ 18.000'));
  assert.ok(p3.includes('c/u $ 9.000'));
  // La precuenta de TODA la cuenta no cambia: sigue con su encabezado y sus filas.
  const toda = lineas(plano(t.pos.documentoTicket(t.pos._armarPreCuenta(), 'cuenta')));
  assert.equal(toda[0], 'CUENTA DE COBRO - NO ES FACTURA');
  assert.ok(toda.includes('Mesa | 3'));
  assert.ok(!toda.some((x) => /^PRECUENTA|^Cuenta de /.test(x)));
});

test('persona: «Para llevar» se respeta (el encabezado si es todo el pedido; bajo el producto si es solo uno) y un nombre de 24 letras con un total de 7 cifras entran enteros', async () => {
  const todo = await arrancar(montar({ items: [...PERSONAS(), { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' }] }));
  const pre = todo.pos._armarPreCuentaPersona('Persona 2');
  assert.ok(pre.items.some((i) => i.id === 'para_llevar' && i.qty === 1), 'lleva su copia del marcador');
  assert.equal(pre.total, 37000, 'el marcador no suma');
  const l = lineas(plano(todo.pos.documentoTicket(pre, 'cuenta')));
  assert.ok(l.includes('PARA LLEVAR - todo el pedido'), 'el encabezado si es todo el pedido');
  assert.ok(!l.some((x) => /^Para llevar$/.test(x)), 'y entonces no se repite bajo cada producto');
  assert.ok(l.includes('Ítems | 2'), 'el marcador no cuenta como ítem');
  assert.ok(!l.some((x) => /Para llevar \|/.test(x)), 'ni sale la línea de $0');
  assert.equal(todo.pos.ordenActiva.items.find((i) => i.id === 'para_llevar').qty, 1, 'y la cuenta conserva el suyo');

  const uno = await arrancar(montar({ items: [
    { id: 'ej1__sopa-pollo__para-llevar', nombre: 'Ejecutivo de la casa', precio: 21000, qty: 1, nota: 'Sopa · Pollo · Para llevar — Persona 1 (Camila)' },
    { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 1, nota: 'Persona 1 (Camila)' },
  ] }));
  const l2 = lineas(plano(uno.pos.documentoTicket(uno.pos._armarPreCuentaPersona('Persona 1'), 'cuenta')));
  assert.ok(l2.includes('Para llevar') && l2.indexOf('Para llevar') === l2.indexOf('Sopa · Pollo') + 1, '«Para llevar» bajo el producto marcado');
  assert.ok(!l2.includes('PARA LLEVAR - todo el pedido'));

  const largo = await arrancar(montar({ items: [
    { id: 'pf3', nombre: 'Pechuga a la plancha', precio: 1250000, qty: 1, nota: 'Persona 1 (Maria Fernanda Rodriguez)' },
    { id: 'en1', nombre: 'Empanadas de la casa', precio: 16000, qty: 1, nota: 'Persona 1 (Maria Fernanda Rodriguez)' },
  ] }));
  const pl = largo.pos._armarPreCuentaPersona('Persona 1');
  assert.equal(pl.persona, 'Maria Fernanda Rodriguez');
  assert.equal(pl.persona.length, 24);
  const l3 = lineas(plano(largo.pos.documentoTicket(pl, 'cuenta')));
  assert.ok(l3.includes('Cuenta de Maria Fernanda Rodriguez · Mesa 3'));
  assert.ok(l3.includes('TOTAL | $ 1.266.000'));
});

test('persona: «Precuenta» pregunta con su nombre, manda UN trabajo de tipo cuenta con solo sus líneas y el aviso dice «Cuenta de Camila · Mesa 3»', async () => {
  const t = await arrancar(montar({ items: PERSONAS() }));
  await t.pos.pedirImpresion('precuenta', 'Persona 1');
  assert.deepEqual(plano(t.pos.confirmaImpresion), {
    que: 'precuenta', persona: 'Persona 1', destino: 'caja',
    titulo: 'Imprimir precuenta',
    pregunta: '¿Imprimir la precuenta de Camila en la caja?',
    resumen: 'Mesa 3 · 2 ítems · $ 34.000',
    boton: 'Imprimir en la caja'
  });
  assert.deepEqual(inserts(t), [], 'nada sale sin confirmar');
  await t.pos.aceptarImpresion();
  assert.equal(inserts(t).length, 1);
  const fila = cuerpoDe(t);
  assert.equal(fila.tipo, 'cuenta');
  assert.equal(fila.mesa_id, 3);
  assert.equal(fila.orden_id, 'o1');
  assert.equal(fila.contenido.lineas.find((x) => x.texto === 'TOTAL').der, '$ 34.000');
  assert.equal(t.pos.cajaTrabajos[0].titulo, 'Cuenta de Camila · Mesa 3');
  assert.equal(t.pos.cajaTrabajos[0].alcance, 'cuenta:o1:Persona 1');
  assert.equal(t.pos.cajaTrabajos[0].personaClave, 'Persona 1');
  assert.deepEqual(t.telefono, []);
  assert.equal(t.pos.vista, 'orden');
  assert.equal(t.pos.ordenActiva.items.length, 7, 'la cuenta queda como estaba');
  // El mismo botón de OTRA persona sigue libre; el suyo dice «En cola…».
  assert.equal(t.pos.trabajoEnCola(t.pos.alcancePreCuenta('Persona 1')), true);
  assert.equal(t.pos.trabajoEnCola(t.pos.alcancePreCuenta('Persona 2')), false);
  assert.equal(t.pos.trabajoEnCola(t.pos.alcancePreCuenta()), false, 'y el de la precuenta entera también');
  assert.equal(await t.pos.pedirImpresion('precuenta', 'Persona 2'), true);
  assert.match(t.pos.confirmaImpresion.pregunta, /Andrés/);
});

test('persona: el cobro de esa persona (Cobrar) sigue igual, y el ticket de «Cobrar» pregunta por «el ticket de Camila»', async () => {
  const t = await arrancar(montar({ items: PERSONAS() }));
  t.pos.cobrarGrupoPersona('Persona 1');
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ticketMostrado.persona, 'Camila');
  assert.equal(t.pos.ticketMostrado.esPreCuenta, undefined);
  await t.pos.pedirImpresion('ticket');
  assert.equal(t.pos.confirmaImpresion.pregunta, '¿Imprimir el ticket de Camila en la caja?');
  await t.pos.aceptarImpresion();
  assert.equal(t.pos.cajaTrabajos[0].titulo, 'Ticket de Camila · Mesa 3');
  const l = lineas(cuerpoDe(t).contenido);
  assert.ok(l.includes('Cuenta de | Camila'), 'el ticket del cobro sigue con sus filas «Mesa» y «Cuenta de»');
  assert.ok(l.includes('Mesa | 3'));
});

// ═════════════════════════ 6. El alcance ═════════════════════════

test('alcance: «Imprimir aquí» de una precuenta de persona imprime ESA precuenta (no la entera), y no se ofrece si la persona ya no tiene ítems ni desde el ticket de otra cosa', async () => {
  const t = await arrancar(montar({ items: PERSONAS() }));
  await t.pos.pedirImpresion('precuenta', 'Persona 1');
  await t.pos.aceptarImpresion();
  const e = t.pos.cajaTrabajos[0];
  e.sinRespuesta = true;
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), true);
  assert.equal(t.pos.imprimirAquiTrabajoCaja(e), true);
  assert.deepEqual(t.telefono, ['precuenta:Persona 1'], 'la precuenta de Camila, no la de toda la mesa');
  assert.equal(t.pos.ticketMostrado.persona, 'Camila');
  assert.deepEqual(plano(t.pos.ticketMostrado.items.map((i) => i.id)), ['ej1__sopa-pollo', 'be1']);
  assert.equal(t.pos.vista, 'ticket');
  // En el ticket de esa precuenta, el mismo trabajo se ofrece; el de OTRA persona o el de la entera, no (es otro papel).
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), true);
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja({ ...e, alcance: 'cuenta:o1:Persona 2', personaClave: 'Persona 2' }), false);
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja({ ...e, alcance: 'cuenta:o1:', personaClave: '' }), false);
  // En la orden: si todo lo de esa persona se reasignó, ya no hay nada que imprimir aquí.
  t.pos.vista = 'orden'; t.pos.ticketMostrado = null;
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), true);
  t.pos.ordenActiva.items.forEach((i) => { if (/Persona 1/.test(i.nota)) i.nota = ''; });
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), false);
});

test('alcance: imprimir en el teléfono la precuenta de Camila cancela SOLO lo suyo que quedó sin respuesta; la de Andrés y la entera siguen vivas', async () => {
  const t = await arrancar(montar({ items: PERSONAS() }));
  for (const persona of ['Persona 1', 'Persona 2', '']) {
    await t.pos.pedirImpresion('precuenta', persona);
    await t.pos.aceptarImpresion();
    t.relojes.pendientes.length = 0;
  }
  assert.equal(t.pos.cajaTrabajos.length, 3);
  t.pos.cajaTrabajos.forEach((e) => { e.sinRespuesta = true; });
  t.pos.imprimirPreCuenta('Persona 1');
  await asentar();
  const estados = Object.fromEntries([...t.base.impresiones.values()].map((f) => [f.contenido.lineas.find((x) => /^Cuenta de |^CUENTA DE COBRO/.test(x.texto))?.texto, f.estado]));
  assert.equal(estados['Cuenta de Camila · Mesa 3'], 'error', 'la de Camila se canceló (no sale doble al volver el PC)');
  assert.equal(estados['Cuenta de Andrés · Mesa 3'], 'pendiente', 'la de Andrés sigue en cola');
  assert.equal(estados['CUENTA DE COBRO - NO ES FACTURA'], 'pendiente', 'y la de toda la cuenta también');
  assert.deepEqual(plano(t.pos.cajaTrabajos.map((e) => e.titulo)).sort(), ['Cuenta de Andrés · Mesa 3', 'Cuenta · Mesa 3'].sort());
});

test('alcance: «Reintentar» tras un error manda el mismo documento con su alcance (la precuenta de la persona sigue siendo suya)', async () => {
  const t = await arrancar(montar({ items: PERSONAS() }));
  await t.pos.pedirImpresion('precuenta', 'Persona 2');
  await t.pos.aceptarImpresion();
  const primero = [...t.base.impresiones.values()][0];
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(primero.id, 'error', 'sin papel'), old: {} });
  const clave = t.pos.cajaTrabajos[0].clave;
  assert.equal(await t.pos.reintentarImpresion(clave), true);
  assert.equal(inserts(t).length, 2);
  const nuevo = t.pos.cajaTrabajos[0];
  assert.equal(nuevo.alcance, 'cuenta:o1:Persona 2');
  assert.equal(nuevo.personaClave, 'Persona 2');
  assert.equal(nuevo.titulo, 'Cuenta de Andrés · Mesa 3');
});

test('persona: si el envío falla tras confirmar, el teléfono imprime SU precuenta (no la entera) y lo dice; cerrar la sesión olvida la confirmación abierta', async () => {
  const t = await arrancar(montar({ items: PERSONAS() }));
  t.base.impresionRechazo = { code: '42501', message: 'new row violates row-level security policy for table "impresiones"' };
  await t.pos.pedirImpresion('precuenta', 'Persona 2');
  assert.equal(await t.pos.aceptarImpresion(), false);
  assert.deepEqual(t.telefono, ['precuenta:Persona 2']);
  assert.equal(t.pos.ticketMostrado.persona, 'Andrés');
  assert.deepEqual(plano(t.pos.ticketMostrado.items.map((i) => i.id)), ['ej1__frijol-res', 'en1']);
  assert.match(t.pos.aviso.texto, /Se imprime desde este teléfono\./);
  assert.deepEqual(plano(t.pos.cajaTrabajos), [], 'sin un «en cola» colgado');

  const u = await arrancar(montar());
  await u.pos.pedirImpresion('precuenta');
  assert.ok(u.pos.confirmaImpresion);
  u.pos._reiniciarCaja();
  assert.equal(u.pos.confirmaImpresion, null, 'otra persona puede entrar a esta tablet sin heredar la pregunta');
});

// ═════════════════════════ 8. Ronda 1 de la refutación ═════════════════════════

// El insert a la cola nunca contesta (red lenta): salta TOPE_ENVIO_CAJA_MS (10 s) y el envío cuenta como fallo.
const cuelgaElInsert = (c) => (c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'insert' ? new Promise(() => {}) : undefined);
const TOPE_ENVIO = 10000;

test('ronda 1 · caída tras confirmar: el papel del teléfono es la precuenta que se CONFIRMÓ (mesa 3, Camila), no la de la pantalla de después (mesa 5, otra «Persona 1»)', async () => {
  // Si el mesero sigue en esa misma cuenta cuando el envío falla, el teléfono imprime exactamente lo confirmado, aunque la cuenta haya cambiado en el rato.
  const igual = await arrancar(montar({ items: PERSONAS(), interceptar: cuelgaElInsert }));
  await igual.pos.pedirImpresion('precuenta', 'Persona 1');
  const envioIgual = igual.pos.aceptarImpresion();
  await asentar();
  igual.pos.ordenActiva.items.push({ id: 'be9', nombre: 'Jugo de mora', precio: 7000, qty: 1, nota: 'Persona 1 (Camila)' });   // se agregó algo mientras tanto
  await igual.relojes.disparar(TOPE_ENVIO);
  assert.equal(await envioIgual, false);
  assert.deepEqual(igual.telefono, ['precuenta:Persona 1']);
  assert.deepEqual(plano(igual.pos.ticketMostrado.items.map((i) => i.id)), ['ej1__sopa-pollo', 'be1'], 'lo confirmado: las dos líneas de entonces, no lo que se agregó después');
  assert.equal(igual.pos.ticketMostrado.total, 34000);
  assert.match(igual.pos.aviso.texto, /No se pudo mandar el ticket a la caja\. Se imprime desde este teléfono\./);

  // Si ya abrió OTRA mesa (con otra «Persona 1»), no sale NADA de la otra cuenta ni se le cambia la pantalla: el aviso dice que no se imprimió.
  const t = await arrancar(montar({ items: PERSONAS(), mesa5: true, interceptar: cuelgaElInsert }));
  await t.pos.pedirImpresion('precuenta', 'Persona 1');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  assert.equal(t.pos.cajaTrabajos[0]?.estado, 'enviando');
  t.pos.volverAMesas();
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 5));
  await asentar();
  assert.equal(t.pos.mesaActiva.id, 5);
  await t.relojes.disparar(TOPE_ENVIO);
  assert.equal(await envio, false);
  assert.deepEqual(t.telefono, [], 'el papel de la mesa 5 (Lucía) NO sale en lugar del de la mesa 3 (Camila)');
  assert.equal(t.pos.ticketMostrado, null);
  assert.equal(t.pos.vista, 'orden', 'y no le cambia la pantalla: sigue en la mesa 5');
  assert.equal(t.pos.mesaActiva.id, 5);
  assert.equal(t.pos.aviso.texto, 'No se pudo mandar el ticket a la caja. No se imprimió: ya saliste de esa cuenta. Vuelve a la Mesa 3 y pídela de nuevo.');
});

test('ronda 1 · caída tras confirmar: si el mesero volvió al salón, el aviso NO promete «Se imprime desde este teléfono» (no sale nada); el ticket de un cobro que se dejó con «Volver» tampoco imprime el salón', async () => {
  const pre = await arrancar(montar({ interceptar: cuelgaElInsert }));
  await pre.pos.pedirImpresion('precuenta');
  const envio = pre.pos.aceptarImpresion();
  await asentar();
  pre.pos.volverAMesas();
  await pre.relojes.disparar(TOPE_ENVIO);
  await envio;
  assert.deepEqual(pre.telefono, []);
  assert.doesNotMatch(pre.pos.aviso.texto, /Se imprime desde este teléfono/);
  assert.match(pre.pos.aviso.texto, /No se imprimió: ya saliste de esa cuenta\. Vuelve a la Mesa 3 y pídela de nuevo\./);

  const cobro = await arrancar(montar({ interceptar: cuelgaElInsert }));
  cobro.pos.facturar();
  await cobro.pos.pedirImpresion('ticket');
  const envioCobro = cobro.pos.aceptarImpresion();
  await asentar();
  cobro.pos.volverDeTicket();
  await cobro.relojes.disparar(TOPE_ENVIO);
  await envioCobro;
  assert.equal(cobro.pos.vista, 'mesas');
  assert.deepEqual(cobro.telefono, [], 'con la pantalla del ticket cerrada, el teléfono no saca en el rollo la vista «mesas»');
  assert.match(cobro.pos.aviso.texto, /No se imprimió/);

  // Y si se queda en el ticket, sale el del teléfono como siempre.
  const queda = await arrancar(montar({ interceptar: cuelgaElInsert }));
  queda.pos.facturar();
  await queda.pos.pedirImpresion('ticket');
  const envioQueda = queda.pos.aceptarImpresion();
  await asentar();
  await queda.relojes.disparar(TOPE_ENVIO);
  await envioQueda;
  assert.deepEqual(queda.telefono, ['ticket', 'window.print']);
  assert.match(queda.pos.aviso.texto, /Se imprime desde este teléfono\./);
});

test('ronda 1 · abonos: la precuenta de una persona en una mesa con abonos dice los abonos de la MESA y lo que le queda a la mesa (sus líneas suman más de lo que se debe)', async () => {
  const items = [...PERSONAS().slice(0, 2), { id: 'en1', nombre: 'Empanadas de la casa', precio: 16000, qty: 1, nota: 'Persona 2 (Andrés)' },
    { id: 'abono_recibido_x1', nombre: 'Abono recibido', precio: -40000, qty: 1, nota: 'efectivo' }];
  const t = await arrancar(montar({ items }));
  assert.equal(t.pos.totalOrdenActiva, 10000, 'la mesa debe $ 10.000');
  const camila = t.pos._armarPreCuentaPersona('Persona 1');
  assert.equal(camila.total, 34000, 'sus líneas suman lo suyo');
  assert.equal(camila.abonosMesa, 40000);
  assert.equal(camila.quedan, 10000);
  assert.equal(t.pos._quedaDe(camila), 10000);
  const l = lineas(plano(t.pos.documentoTicket(camila, 'cuenta')));
  assert.ok(l.includes('TOTAL | $ 34.000'));
  assert.ok(l.includes('Abonos de la mesa | $ 40.000'), `la precuenta avisa del abono:\n${l.join('\n')}`);
  assert.ok(l.includes('Queda por pagar (mesa) | $ 10.000'));
  assert.ok(l.indexOf('TOTAL | $ 34.000') < l.indexOf('Abonos de la mesa | $ 40.000') && l.indexOf('Abonos de la mesa | $ 40.000') < l.indexOf('Queda por pagar (mesa) | $ 10.000'));
  assert.ok(!l.some((x) => /abono recibido/i.test(x)), 'la línea del abono no es de Camila: no sale como ítem suyo');
  // La pantalla del ticket de esa precuenta dice lo mismo (quedaEnTicket) y el modal sigue resumiendo sus líneas.
  t.pos.ticketMostrado = camila; t.pos.vista = 'ticket';
  assert.equal(t.pos.quedaEnTicket, 10000);
  // Sin abonos nada cambia: ni la línea de abonos ni «Queda por pagar».
  const sin = await arrancar(montar({ items: PERSONAS() }));
  const p = sin.pos._armarPreCuentaPersona('Persona 1');
  assert.equal(p.abonosMesa, undefined);
  assert.equal(sin.pos._quedaDe(p), null);
  assert.ok(!lineas(plano(sin.pos.documentoTicket(p, 'cuenta'))).some((x) => /Abonos|Queda por pagar/.test(x)));
  // La precuenta de TODA la cuenta no cambia: ya descuenta el abono (TOTAL $ 10.000, con su línea) y no repite «Abonos de la mesa».
  const entera = lineas(plano(t.pos.documentoTicket(t.pos._armarPreCuenta(), 'cuenta')));
  assert.ok(entera.includes('TOTAL | $ 10.000'));
  assert.ok(!entera.some((x) => /^Abonos de la mesa|^Queda por pagar/.test(x)));
  assert.ok(entera.some((x) => /Abono recibido \| -\$ 40\.000|Abono recibido/.test(x)));
});

test('ronda 1 · cola: con cuatro o más en cola el aviso conserva TODO lo que no terminó (su botón dice «En cola…»), y solo esconde lo terminado más viejo', async () => {
  const items = [...PERSONAS().slice(0, 3),
    { id: 'pf3', nombre: 'Pechuga a la plancha', precio: 36000, qty: 1, nota: 'Persona 3' },
    { id: 'be2', nombre: 'Jugo natural', precio: 9000, qty: 1, nota: 'Persona 4' }];
  const t = await arrancar(montar({ items }));
  for (const p of ['Persona 1', 'Persona 2', 'Persona 3', 'Persona 4']) { await t.pos.pedirImpresion('precuenta', p); await t.pos.aceptarImpresion(); }
  await t.relojes.disparar(25000);                         // ESPERA_CAJA_MS: la caja no respondió
  assert.ok(t.pos.cajaTrabajos.every((e) => e.sinRespuesta));
  assert.equal(t.pos.trabajoEnCola(t.pos.alcancePreCuenta('Persona 1')), true, 'el botón de Camila dice «En cola…» y está apagado');
  const aLaVista = plano(t.pos.trabajosCaja.map((e) => e.titulo));
  assert.deepEqual(aLaVista, ['Cuenta de Persona 4 · Mesa 3', 'Cuenta de Persona 3 · Mesa 3', 'Cuenta de Andrés · Mesa 3', 'Cuenta de Camila · Mesa 3'],
    'los cuatro, el más nuevo primero: el de Camila (el más viejo) sigue a la vista, con su «Imprimir aquí» y su X');
  const camila = t.pos.trabajosCaja.at(-1);
  assert.equal(t.pos.puedeCerrarTrabajoCaja(camila), true, 'tiene salida: la X (cancela en la caja)');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(camila), true, 'y «Imprimir aquí»');
  // Lo terminado más viejo sí se esconde: seis impresos y uno en cola → los tres últimos y el que sigue vivo.
  const mezcla = await arrancar(montar());
  mezcla.pos.cajaTrabajos = [
    { clave: 'v', id: 'iv', estado: 'pendiente', titulo: 'Vivo viejo', error: '', intentos: 0, sinRespuesta: true },
    ...Array.from({ length: 5 }, (_, n) => ({ clave: `c${n}`, id: `i${n}`, estado: 'impresa', titulo: `T${n}`, error: '', intentos: 0, sinRespuesta: false })),
  ];
  assert.deepEqual(plano(mezcla.pos.trabajosCaja.map((e) => e.titulo)), ['T4', 'T3', 'T2', 'Vivo viejo']);
  // Un error viejo tampoco se pierde (trae su «Reintentar»).
  mezcla.pos.cajaTrabajos[0].estado = 'error';
  assert.ok(plano(mezcla.pos.trabajosCaja.map((e) => e.titulo)).includes('Vivo viejo'));
});

test('ronda 1 · «Imprimir en la caja» con OTRO envío en curso (el «Reintentar» del aviso va sobre el modal) no se cierra en silencio: la confirmación espera, avisa, y al terminar el otro manda', async () => {
  let soltar = null;
  let colgarSiguiente = false;
  const interceptar = (c, original) => {
    if (c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'insert' && colgarSiguiente) {
      colgarSiguiente = false;
      return new Promise((r) => { soltar = async () => r(await original(c)); });
    }
    return undefined;
  };
  const t = await arrancar(montar({ items: PERSONAS(), interceptar }));
  // La precuenta de Camila falló en la caja («sin papel»): su aviso trae «Reintentar».
  await t.pos.pedirImpresion('precuenta', 'Persona 1');
  await t.pos.aceptarImpresion();
  const fila = t.base.impresiones.values().next().value;
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(fila.id, 'error', 'sin papel'), old: {} });
  // El mesero pide la de Andrés (se abre la confirmación)…
  await t.pos.pedirImpresion('precuenta', 'Persona 2');
  assert.match(t.pos.confirmaImpresion.pregunta, /Andrés/);
  // …y antes de confirmar toca «Reintentar» en el aviso (z-index 60, sobre el modal): con la red lenta el reintento queda «enviando».
  colgarSiguiente = true;
  const reintento = t.pos.reintentarImpresion(t.pos.cajaTrabajos[0].clave);
  await asentar();
  assert.equal(t.pos.cajaEnviando, true);
  t.pos.aviso = null;
  assert.equal(await t.pos.aceptarImpresion(), false, '«Imprimir en la caja» no manda con otro envío en curso…');
  assert.ok(t.pos.confirmaImpresion, '…pero tampoco cierra la confirmación como si nada: sigue abierta, esperando');
  assert.equal(t.pos.confirmaImpresion.persona, 'Persona 2');
  assert.match(t.pos.aviso.texto, /Se está enviando otro papel a la caja\. Espera un momento y vuelve a tocar «Imprimir en la caja»\./);
  assert.equal(inserts(t).filter((c) => /Andrés/.test(JSON.stringify(c.cuerpo))).length, 0);
  // Termina el otro envío: el botón vuelve y esta vez sí sale (y no se perdió ni se duplicó nada).
  await soltar(); await reintento; await asentar();
  assert.equal(t.pos.cajaEnviando, false);
  assert.equal(await t.pos.aceptarImpresion(), true);
  assert.equal(t.pos.confirmaImpresion, null);
  assert.equal(inserts(t).filter((c) => /Andrés/.test(JSON.stringify(c.cuerpo))).length, 1, 'la precuenta de Andrés entró a la cola una vez');
  assert.deepEqual(t.telefono, []);
  // La salida de emergencia (el teléfono) no manda nada a la cola: no espera a ningún envío.
  const em = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false, ultimo_latido: HACE(5) }] }));
  await em.pos.pedirImpresion('precuenta');
  assert.equal(em.pos.confirmaImpresion.destino, 'telefono');
  em.pos.cajaTrabajos = [{ clave: 'x', id: 'ix', estado: 'enviando', titulo: 'Otro', error: '', intentos: 0, sinRespuesta: false }];
  assert.equal(await em.pos.aceptarImpresion(), true);
  assert.deepEqual(em.telefono, ['precuenta']);
});

test('ronda 1 · estado desconocido y red colgada: la espera de hasta 2,5 s se ve («Un momento…», botones apagados), un segundo toque no se suma y sale UN diálogo con el papel que se pidió', async () => {
  let colgar = false;
  const interceptar = (c) => (colgar && c.tipo === 'rpc' && c.nombre === 'impresora_estado' ? new Promise(() => {}) : undefined);
  const t = montar({ items: PERSONAS(), interceptar });
  t.base.fallar('rpc:impresora_estado');
  await arrancar(t);
  t.base.repararTodo();
  assert.equal(t.pos.cajaDisponible, false);
  assert.equal(t.pos._cajaNoExiste, false, 'no se sabe si hay cola');
  colgar = true;                                           // la red ahora cuelga (no falla rápido)
  const a = t.pos.pedirImpresion('precuenta', 'Persona 1');
  await asentar();
  assert.equal(t.pos.preguntandoImpresion, 'cuenta:o1:Persona 1', 'la espera se ve: el botón de Camila dice «Un momento…» y los demás se apagan');
  assert.equal(await t.pos.pedirImpresion('precuenta', 'Persona 2'), false, 'el segundo toque (Andrés, o el mismo botón) no se suma');
  assert.equal(await t.pos.pedirImpresion('precuenta', 'Persona 1'), false);
  await t.relojes.disparar(2500);
  assert.equal(await a, true);
  assert.equal(t.pos.preguntandoImpresion, '', 'y se apaga al decidir');
  assert.deepEqual(t.telefono, ['precuenta:Persona 1'], 'UNA precuenta, la de Camila');
  assert.equal(t.pos.ticketMostrado.persona, 'Camila');

  // Si en esa espera el mesero salió de la cuenta, no se abre ninguna confirmación huérfana ni se imprime la pantalla de ahora.
  const b = montar({ items: PERSONAS(), interceptar });
  b.base.fallar('rpc:impresora_estado');
  colgar = false;
  await arrancar(b);
  b.base.repararTodo();
  colgar = true;
  const c = b.pos.pedirImpresion('precuenta', 'Persona 1');
  await asentar();
  b.pos.volverAMesas();
  await b.relojes.disparar(2500);
  assert.equal(await c, false);
  assert.deepEqual(b.telefono, []);
  assert.equal(b.pos.confirmaImpresion, null);
  assert.equal(b.pos.preguntandoImpresion, '');
});

test('ronda 1 · caja dada de baja: sin ninguna caja ACTIVA el admin imprime igual que el mesero (directo, sin la «emergencia» de una caja que nadie espera)', async () => {
  const baja = { ...CAJA, activa: false, en_linea: false, ultimo_latido: HACE(3 * 24 * 60) };
  // Lo que contesta la base real (impresora_estado): al admin, la desactivada; al mesero, nada.
  const admin = await arrancar(montar({ rol: 'admin', impresoras: [baja] }));
  const mesero = await arrancar(montar({ rol: 'mesero', impresoras: [] }));
  assert.equal(admin.pos.cajaImpresoras.length, 1);
  assert.equal(admin.pos.cajasActivas.length, 0);
  assert.equal(admin.pos.destinoImpresion, null);
  assert.equal(mesero.pos.destinoImpresion, null);
  await mesero.pos.pedirImpresion('precuenta');
  await admin.pos.pedirImpresion('precuenta');
  assert.equal(admin.pos.confirmaImpresion, null, 'sin la «La caja no está en línea (última señal hace 72 h)…» en cada papel');
  assert.deepEqual(admin.telefono, mesero.telefono, 'igual que el mesero');
  assert.deepEqual(admin.telefono, ['precuenta']);
  admin.pos.facturar();
  await admin.pos.pedirImpresion('ticket');
  assert.equal(admin.pos.confirmaImpresion, null, 'y lo mismo con el ticket');
  // Una caja activa que no late SÍ es la emergencia, y la señal que dice es la de la ACTIVA, no la de la dada de baja que sigue latiendo.
  const mixto = await arrancar(montar({ rol: 'admin', impresoras: [
    { ...CAJA, id: 'vieja', activa: false, en_linea: false, ultimo_latido: HACE(1) },
    { ...CAJA, id: 'nueva', activa: true, en_linea: false, ultimo_latido: HACE(9) },
  ] }));
  await mixto.pos.pedirImpresion('precuenta');
  assert.equal(mixto.pos.confirmaImpresion.destino, 'telefono');
  assert.match(mixto.pos.confirmaImpresion.pregunta, /última señal hace 9 min/);
  // Con una activa en línea (y otra dada de baja) va a la caja.
  const enLinea = await arrancar(montar({ rol: 'admin', impresoras: [{ ...baja, id: 'vieja' }, CAJA] }));
  assert.equal(enLinea.pos.destinoImpresion, 'caja');
});

// ═════════════════════════ 7. Marcado ═════════════════════════

const POS_HTML = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const MARCADO = POS_HTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');

test('marcado: cada persona trae «Precuenta» (secundario, con su íconos en SVG) y «Cobrar» (primario) en una segunda línea, y los dos pasan por la confirmación', () => {
  const tarjeta = MARCADO.slice(MARCADO.indexOf('class="card mb-4 p-4 split-personas"'), MARCADO.indexOf('$store.pos.otrosEnMesa($store.pos.mesaActiva.id).length > 0'));
  const acciones = tarjeta.slice(tarjeta.indexOf('class="persona-split-acciones"'), tarjeta.indexOf('class="persona-detalle"'));
  const botones = [...acciones.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.equal(botones.length, 2);
  assert.match(botones[0], /class="btn-secondary btn-sm"/);
  assert.match(botones[0], /pedirImpresion\('precuenta', persona\)/);
  assert.match(botones[0], /Imprimir la precuenta de ' \+ \$store\.pos\.nombrePersona\(persona\)/, 'el nombre accesible lleva a quién');
  assert.match(botones[0], /trabajoEnCola\(\$store\.pos\.alcancePreCuenta\(persona\)\) \? 'En cola…' : .*'Un momento…' : 'Precuenta'/, 'dice «En cola…» o «Un momento…» mientras no se puede tocar');
  assert.match(botones[0], /:disabled="\$store\.pos\.cajaEnviando \|\| \$store\.pos\.preguntandoImpresion \|\| /, 'y se apaga también mientras el POS averigua si hay cola');
  assert.match(botones[0], /<svg [^>]*aria-hidden="true">/, 'ícono en SVG en línea: la lista cambia con Realtime y lucide no se vuelve a correr');
  assert.match(botones[1], /class="btn-primary btn-sm"/);
  assert.match(botones[1], /cobrarGrupoPersona\(persona\)/);
  assert.doesNotMatch(tarjeta, /data-lucide/);
  assert.ok(tarjeta.indexOf('class="persona-split-acciones"') < tarjeta.indexOf('class="persona-detalle"'), 'el detalle desplegable queda debajo de los botones');
  assert.ok(tarjeta.indexOf('class="persona-meta') < tarjeta.indexOf('class="persona-split-acciones"'), 'y el total (línea 1) arriba');
});

test('marcado: el ticket de pantalla de la precuenta de una persona dice lo mismo que el documento de la caja', () => {
  assert.match(MARCADO, /ticketMostrado\.persona \? 'PRECUENTA — no es un cobro' : 'CUENTA DE COBRO — NO ES FACTURA'/);
  assert.match(MARCADO, /class="ticket-quien"[^>]*x-show="\$store\.pos\.ticketMostrado\?\.esPreCuenta && \$store\.pos\.ticketMostrado\?\.persona"/);
  assert.match(MARCADO, /'Cuenta de ' \+ \$store\.pos\.ticketMostrado\?\.persona \+ ' · Mesa '/);
  assert.match(MARCADO, /<div class="meta-row" x-show="!\(\$store\.pos\.ticketMostrado\?\.esPreCuenta && \$store\.pos\.ticketMostrado\?\.persona\)">\s*<span>Mesa<\/span>/, 'sin las filas «Mesa» y «Cuenta de» en esa precuenta');
});
