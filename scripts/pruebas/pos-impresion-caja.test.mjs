// Imprimir en la caja (POS): la LÓGICA del teléfono para mandar la cuenta y el ticket a la cola de impresión del PC de la caja.
// Corre el <script> REAL de pos.html en un `vm` (scripts/pruebas/_pos-vm.mjs) contra una base falsa que modela la cola
// (migración 20261003120000_cola_impresion.sql): impresora_estado / impresora_crear / impresora_rotar y la tabla `impresiones`.
// `base.imprimir(id, estado, error)` hace de agente del PC. Los temporizadores del POS (cierre de «Impreso», «la caja no responde»,
// respaldo de Realtime) son espías: aquí se disparan a mano, sin esperar segundos de verdad.
//
//   1. Compatibilidad     sin la migración (o con la base sin cola) el POS se comporta como hoy: ni botón, ni indicador, ni ciclos
//   2. Estado de la caja  en línea / sin conexión / sin configurar, quién la ve, y el ciclo que pregunta cada 30 s
//   3. El documento       ítems, cantidades, sublíneas, abonos, totales, división y QR; texto limpio para el papel
//   4. Mandar a la caja   el insert, el tipo, la impresora destino, sin salir de la orden y con un solo envío a la vez
//   5. Estado en vivo     En cola → Imprimiendo → Impreso (Realtime y respaldo), error con Reintentar, «la caja no responde»
//   6. Caída al teléfono  caja sin conexión, insert rechazado, sin red o la cola que desaparece: window.print() de siempre
//   7. El admin           crear y rotar el token (una vez, solo en memoria), copiar, la prueba, y el mesero sin acceso
//   8. Ciclo de vida      detener la app, cerrar la sesión y recargar no dejan relojes, canales ni el token a la vista
import test from 'node:test';
import assert from 'node:assert/strict';
import { asentar, crearBaseFalsa, crearPos, item, mesaBase, ordenBase, ordenLocal, plano } from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const CAJA = { id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: '2026-10-03T13:00:00Z', version_agente: '1.0.0' };
const PEDIDO = () => [
  { id: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, qty: 2, nota: 'Sopa · Pollo' },
  { id: 'en1', nombre: 'Empanadas de la casa', precio: 16000, qty: 1, nota: '' },
  { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 3, nota: '' },
];
const CTRL = (n) => String.fromCharCode(n);

/** Relojes espía: setTimeout y setInterval guardan lo pendiente; `disparar(ms)` corre lo que espera exactamente ese tiempo. */
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
    esperando: (ms) => pendientes.filter((p) => p.ms === ms),
    async disparar(ms) { for (const p of this.esperando(ms)) { this.clearTimeout(p.id); await p.fn(); } await asentar(); },
  };
}

/** Un POS con sesión, la base falsa con la cola y, opcionalmente, la orden de la mesa 3 abierta y lista. */
function montar({ rol = 'admin', impresoras = [CAJA], conOrden = true, items = PEDIDO(), almacen, interceptar } = {}) {
  const base = crearBaseFalsa({ rol, mesas: [mesaBase(3)], ordenes: conOrden ? [ordenBase('o1', 3, items)] : [], impresoras });
  // `interceptar(llamada, original)` contesta ANTES que la base (crearPos se queda con `base.responder` al crearse: se envuelve aquí);
  // `original(llamada)` es la respuesta de la base falsa, por si hay que dejarla pasar y hacer algo después.
  if (interceptar) { const original = base.responder; base.responder = async (c) => (interceptar(c, original) ?? original(c)); }
  const relojes = relojesEspia();
  const portapapeles = [];
  const extras = {
    setTimeout: relojes.setTimeout, clearTimeout: relojes.clearTimeout, setInterval: relojes.setInterval, clearInterval: relojes.clearInterval,
    navigator: { clipboard: { writeText: async (x) => { if (portapapeles.fallar) throw new Error('sin permiso'); portapapeles.push(x); } } },
  };
  const t = crearPos({ base, almacen, extras, documento: { title: 'Resplandor — POS', visibilityState: 'visible' } });
  t.base = base; t.relojes = relojes; t.portapapeles = portapapeles;
  t.pos.usuario = YO;
  t.impresiones = [];
  // El teléfono: lo que cae a window.print() de siempre (se espía; el real necesita un documento de verdad).
  t.pos.imprimir = () => { t.impresiones.push('imprimir'); };
  const preCuentaReal = t.pos.imprimirPreCuenta.bind(t.pos);
  t.pos.imprimirPreCuenta = () => { t.impresiones.push('imprimirPreCuenta'); return preCuentaReal(); };
  return t;
}

/** Arranca la app y deja la mesa 3 abierta en pantalla, como cuando el mesero toca la mesa. */
async function arrancar(t) {
  await t.pos.arrancarApp();
  await asentar();
  t.pos.mesaActiva = t.pos.mesas.find((m) => m.id === 3) || null;
  t.pos.ordenActiva = t.pos.ordenes.find((o) => o.id === 'o1') || null;
  t.pos.vista = 'orden';
  return t;
}

const insertsDeImpresion = (t) => t.supabase.de('impresiones', 'insert');
const ultimaFila = (t) => [...t.base.impresiones.values()].at(-1);
const texto = (doc, t) => doc.lineas.find((l) => l.texto === t);
const sinControl = (s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s);

// ═════════════════════════ 1. Compatibilidad ═════════════════════════

test('compat: la base sin la cola (impresora_estado contesta null): el POS se comporta como hoy, sin botón, sin indicador y sin ciclos', async () => {
  const t = montar({ impresoras: null });
  await arrancar(t);
  assert.equal(t.pos.cajaDisponible, false);
  assert.equal(t.pos.cajaVisible, false);
  assert.equal(t.pos.puedeImprimirEnCaja, false);
  assert.equal(t.supabase.rpcs('impresora_estado').length, 1, 'se pregunta una vez y no más');
  assert.equal(t.supabase.canal('pos_impresiones'), undefined, 'ni canal de impresiones');
  assert.deepEqual(t.relojes.intervalos, [], 'ni el ciclo de cada 30 s');
  assert.equal(t.pos._relojCaja, null);
  // Y «Imprimir cuenta» sigue siendo lo de siempre: la pre-cuenta con window.print().
  t.pos.imprimirPreCuenta();
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ticketMostrado.esPreCuenta, true);
});

test('compat: la migración sin aplicar (PGRST202 en la RPC): igual que sin cola, sin ruido y sin volver a preguntar', async () => {
  const t = montar({ impresoras: [CAJA] });
  t.base.colaAusente = true;
  await arrancar(t);
  assert.equal(t.pos.cajaDisponible, false);
  assert.equal(t.pos._cajaNoExiste, true);
  assert.equal(t.pos.puedeImprimirEnCaja, false);
  await t.pos.cargarEstadoCaja();
  await t.pos.cargarEstadoCaja();
  assert.equal(t.supabase.rpcs('impresora_estado').length, 1, 'ni al volver a la pestaña ni con la red: ya se sabe');
  assert.deepEqual(t.relojes.intervalos, []);
  assert.equal(await t.pos.imprimirCuentaEnCaja(), false, 'sin cola, el botón no existe y la acción no hace nada raro');
  assert.deepEqual(insertsDeImpresion(t), []);
});

// ═════════════════════════ 2. Estado de la caja ═════════════════════════

test('estado: en línea / sin conexión / sin configurar, y quién ve el indicador (el admin siempre que haya cola; el mesero solo si hay caja)', async () => {
  const enLinea = await arrancar(montar({ impresoras: [CAJA] }));
  assert.equal(enLinea.pos.cajaDisponible, true);
  assert.equal(enLinea.pos.cajaEnLinea, true);
  assert.equal(enLinea.pos.puedeImprimirEnCaja, true);
  assert.equal(enLinea.pos.cajaTexto, 'Caja: en línea');
  assert.deepEqual(plano(enLinea.pos.cajaImpresoras), [{ id: 'impresora-1', nombre: 'Caja', en_linea: true, activa: true, ultimo_latido: '2026-10-03T13:00:00Z', version_agente: '1.0.0' }]);

  const apagada = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false }] }));
  assert.equal(apagada.pos.cajaEnLinea, false);
  assert.equal(apagada.pos.puedeImprimirEnCaja, false, 'sin latido no se ofrece');
  assert.equal(apagada.pos.cajaTexto, 'Caja: sin conexión');
  assert.equal(apagada.pos.cajaVisible, true);

  const sinCaja = await arrancar(montar({ impresoras: [] }));
  assert.equal(sinCaja.pos.cajaTexto, 'Caja: sin configurar');
  assert.equal(sinCaja.pos.cajaVisible, true, 'el admin la ve para poder registrarla');
  const meseroSinCaja = await arrancar(montar({ rol: 'mesero', impresoras: [] }));
  assert.equal(meseroSinCaja.pos.cajaVisible, false, 'el mesero no ve un indicador de algo que no existe');
  const mesero = await arrancar(montar({ rol: 'mesero', impresoras: [CAJA] }));
  assert.equal(mesero.pos.cajaVisible, true);
  assert.equal(mesero.pos.puedeImprimirEnCaja, true, 'imprimir en la caja es de todo el personal');
});

test('estado: una impresora desactivada (impresora_estado trae activa = false) queda en la lista del admin pero nunca se ofrece; sin `activa` se da por activa', async () => {
  const t = await arrancar(montar({ impresoras: [{ ...CAJA, activa: false, en_linea: false }] }));
  assert.equal(t.pos.cajaImpresoras[0].activa, false);
  assert.equal(t.pos.puedeImprimirEnCaja, false);
  assert.equal(t.pos.cajaConfigurada, true, 'sigue registrada: el admin la ve');
  const vieja = await arrancar(montar({ impresoras: [CAJA] }));
  assert.equal(vieja.pos.cajaImpresoras[0].activa, true);
});

test('estado: pregunta cada 30 s (solo con la cola en la base), se apaga si la caja deja de latir y vuelve a ofrecerse cuando late', async () => {
  const t = await arrancar(montar({ impresoras: [CAJA] }));
  assert.deepEqual(t.relojes.intervalos.map((i) => i.ms), [30000]);
  assert.equal(t.pos.puedeImprimirEnCaja, true);
  t.base.impresoras[0].en_linea = false;
  await t.relojes.intervalos[0].fn();
  await asentar();
  assert.equal(t.pos.puedeImprimirEnCaja, false, 'el agente dejó de latir: el botón se va');
  t.base.impresoras[0].en_linea = true;
  await t.relojes.intervalos[0].fn();
  await asentar();
  assert.equal(t.pos.puedeImprimirEnCaja, true);
  // Sin red: no se sabe, y no se promete lo que no se sabe.
  t.base.red = false;
  await t.relojes.intervalos[0].fn();
  await asentar();
  assert.equal(t.pos.cajaEnLinea, false);
  assert.equal(t.pos.cajaDisponible, true, 'la cola sigue existiendo; solo no se sabe si la caja está');
});

test('estado: un fallo de red al arrancar no mata la función: el ciclo lo reintenta y la caja aparece sola', async () => {
  const t = montar({ impresoras: [CAJA] });
  t.base.fallar('rpc:impresora_estado');             // un 5xx de esa consulta (el resto del POS arranca bien)
  await t.pos.arrancarApp();
  await asentar();
  assert.equal(t.pos.cajaDisponible, false);
  assert.equal(t.pos._cajaNoExiste, false, 'no fue «no existe»: fue un fallo pasajero');
  assert.equal(t.relojes.intervalos.length, 1, 'el ciclo de reintento está en marcha');
  t.base.repararTodo();
  await t.relojes.intervalos[0].fn();
  await asentar();
  assert.equal(t.pos.cajaDisponible, true);
  assert.equal(t.pos.puedeImprimirEnCaja, true);
});

test('estado: con la cola abre el canal pos_impresiones (postgres_changes de `impresiones`) y los cambios de otros teléfonos no tocan los trabajos de este', async () => {
  const t = await arrancar(montar({ impresoras: [CAJA] }));
  const canal = t.supabase.canal('pos_impresiones');
  assert.ok(canal, 'abre su propio canal: si la tabla no está en Realtime, solo este falla');
  assert.deepEqual(plano(canal.eventos.map((e) => [e.tipo, e.filtro])), [['postgres_changes', { event: '*', schema: 'public', table: 'impresiones', filter: 'creada_por=eq.yo@ejemplo.test' }]],
    'solo los trabajos de esta persona: cada cambio de estado trae la fila entera, con el documento');
  await t.pos.imprimirCuentaEnCaja();
  const antes = plano(t.pos.cajaTrabajos);
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: { id: 'de-otro-telefono', estado: 'impresa' }, old: {} });
  t.pos.procesarCambioImpresion({ eventType: 'DELETE', new: {}, old: { id: 'x' } });
  assert.deepEqual(plano(t.pos.cajaTrabajos), antes);
});

// ═════════════════════════ 3. El documento ═════════════════════════

test('documento: el ticket de un cobro lleva encabezado, mesa, fecha, hora, quién atendió, cada ítem con su cantidad y sublíneas, ítems, total, pie y QR', async () => {
  const t = await arrancar(montar());
  t.pos.facturar();
  const doc = t.pos.documentoTicket(t.pos.ordenTicket, 'ticket');
  assert.equal(doc.v, 1);
  assert.equal(doc.titulo, 'Resplandor', 'el nombre del local: el agente lo imprime como encabezado (centrado, negrita, grande)');
  assert.equal(doc.cortar, true);
  assert.deepEqual(plano(doc.qr), { texto: 'https://resplandor.ynt.codes/', etiqueta: 'resplandor.ynt.codes' }, 'el QR del pie de papel: la web, con su dirección debajo');
  assert.deepEqual(plano(doc.lineas.slice(0, 2)), [
    { texto: 'RESTAURANTE', alinear: 'centro', negrita: false },
    { texto: '---' },
  ]);
  assert.deepEqual(plano(texto(doc, 'Mesa')), { texto: 'Mesa', der: '3' });
  assert.match(texto(doc, 'Fecha').der, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.match(texto(doc, 'Hora').der, /^\d{1,2}:\d{2}/);
  assert.deepEqual(plano(texto(doc, 'Atendió')), { texto: 'Atendió', der: 'Yo' });

  // Cada ítem: «2 x Nombre» con su importe a la der; la variante y «c/u» van debajo, con sangría.
  const i = doc.lineas.findIndex((l) => l.texto === '2 x Ejecutivo de la casa');
  assert.ok(i > 0);
  assert.deepEqual(plano(doc.lineas.slice(i, i + 5)), [
    { texto: '2 x Ejecutivo de la casa', der: '$ 42.000' },
    { texto: 'Sopa · Pollo', sangria: 2 },
    { texto: 'c/u $ 21.000', sangria: 2 },
    { texto: '1 x Empanadas de la casa', der: '$ 16.000' },   // una unidad: sin «c/u»
    { texto: '3 x Limonada de coco', der: '$ 39.000' },
  ]);
  assert.deepEqual(plano(doc.lineas[i + 5]), { texto: 'c/u $ 13.000', sangria: 2 });
  assert.deepEqual(plano(texto(doc, 'Ítems')), { texto: 'Ítems', der: '6' });
  assert.deepEqual(plano(texto(doc, 'TOTAL')), { texto: 'TOTAL', der: '$ 97.000', negrita: true, doble: true });
  assert.equal(texto(doc, 'Queda por pagar'), undefined, 'un cobro completo no deja nada por pagar');
  assert.deepEqual(plano(doc.lineas.at(-1)), { texto: 'Gracias por su visita', alinear: 'centro' });
});

test('documento: la pre-cuenta dice que no es factura, descuenta los abonos (con guion corto, no el «−» de la pantalla), no los cuenta como ítems y reparte entre N', async () => {
  const items = [...PEDIDO(), { id: 'abono_recibido_x1', nombre: 'Abono recibido', precio: -20000, qty: 1, nota: 'efectivo' }];
  const t = await arrancar(montar({ items }));
  t.pos.dividirN = 3;
  const pre = t.pos._armarPreCuenta();
  assert.equal(pre.esPreCuenta, true);
  const doc = t.pos.documentoTicket(pre, 'cuenta');
  assert.equal(t.pos.tituloTrabajoCaja('cuenta', pre), 'Cuenta · Mesa 3', 'lo que lee la persona en el aviso; no va en el documento');
  assert.deepEqual(plano(doc.lineas[0]), { texto: 'CUENTA DE COBRO - NO ES FACTURA', alinear: 'centro', negrita: true });
  const i = doc.lineas.findIndex((l) => l.texto === '1 x Abono recibido');
  assert.deepEqual(plano(doc.lineas.slice(i, i + 2)), [{ texto: '1 x Abono recibido', der: '- $ 20.000' }, { texto: 'Efectivo', sangria: 2 }]);
  assert.deepEqual(plano(texto(doc, 'Ítems')), { texto: 'Ítems', der: '6' }, 'el abono no es un ítem');
  assert.equal(texto(doc, 'TOTAL').der, '$ 77.000', 'lo que falta por pagar');
  assert.equal(texto(doc, 'División entre 3').negrita, true);
  const personas = doc.lineas.filter((l) => /^Persona \d$/.test(l.texto));
  assert.deepEqual(plano(personas), [1, 2, 3].map((n) => ({ texto: `Persona ${n}`, der: '$ 25.667' })));
  assert.ok(!JSON.stringify(doc).includes(String.fromCharCode(0x2212)), 'ni un «−» (U+2212): no está en CP850');
});

test('documento: el ticket de un abono lleva el método, «Queda por pagar» y no lleva la línea de ítems', async () => {
  const t = await arrancar(montar());
  t.pos.montoAbono = '30000';
  t.pos.metodoAbono = 'qr';
  assert.equal(t.pos.cobrarMonto(), true);
  const doc = t.pos.documentoTicket(t.pos.ordenTicket, 'abono');
  assert.equal(t.pos.tituloTrabajoCaja('abono', t.pos.ordenTicket), 'Abono · Mesa 3');
  const i = doc.lineas.findIndex((l) => l.texto === 'Abono');
  assert.deepEqual(plano(doc.lineas.slice(i, i + 2)), [{ texto: 'Abono', der: '$ 30.000' }, { texto: 'QR', sangria: 2 }]);
  assert.equal(texto(doc, 'Ítems'), undefined);
  assert.equal(texto(doc, 'TOTAL').der, '$ 30.000');
  assert.deepEqual(plano(texto(doc, 'Queda por pagar')), { texto: 'Queda por pagar', der: '$ 67.000' });
});

test('documento: el texto sale limpio para el papel (sin saltos ni control ni emojis, rayas y comillas a ASCII, tope de largo y de líneas)', async () => {
  const sucio = `Pollo${CTRL(10)}asado${CTRL(7)} ${String.fromCharCode(0x2014)} ${String.fromCodePoint(0x1F600)}“bien”${CTRL(0x1b)}[2J${'x'.repeat(300)}`;
  const items = [{ id: 'p1', nombre: sucio, precio: 5000, qty: 1, nota: `sin cebolla ${String.fromCharCode(0x2013)} ${String.fromCharCode(0xa0)}por favor${CTRL(0)}` }];
  const t = await arrancar(montar({ items }));
  const doc = t.pos.documentoTicket(t.pos._armarPreCuenta(), 'cuenta');
  const todas = doc.lineas.flatMap((l) => [l.texto, l.der].filter((x) => x != null));
  assert.ok(todas.every(sinControl), 'ni un carácter de control');
  assert.ok(todas.every((s) => s.length <= 120), 'texto ≤ 120');
  const linea = doc.lineas.find((l) => l.texto.startsWith('1 x Pollo'));
  assert.ok(linea.texto.startsWith('1 x Pollo asado - "bien"'), linea.texto);
  assert.ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify(doc)), 'sin emojis');
  assert.ok(doc.lineas.some((l) => l.texto === 'sin cebolla - por favor' && l.sangria === 2), 'la nota: raya corta y espacio normal');
  assert.ok(doc.lineas.every((l) => l.der == null || l.der.length <= 24));
  // Un pedido enorme NO se recorta (se perdería el TOTAL): el documento sale completo y _enviarACaja lo rechaza (ver la sección 9).
  const muchos = Array.from({ length: 400 }, (_, n) => ({ id: `p${n}`, nombre: `Plato ${n}`, precio: 1000, qty: 1, nota: '' }));
  const grande = await arrancar(montar({ items: muchos }));
  const docGrande = grande.pos.documentoTicket(grande.pos._armarPreCuenta(), 'cuenta');
  assert.ok(docGrande.lineas.length > 300, 'completo: más de 300 líneas');
  assert.ok(docGrande.lineas.some((l) => l.texto === 'TOTAL'), 'con su TOTAL');
  assert.ok(JSON.stringify(doc).length < 8000, 'un pedido normal pesa pocos KB');
});

// ═════════════════════════ 4. Mandar a la caja ═════════════════════════

test('mandar: «Imprimir en la caja» en la orden inserta UN trabajo (tipo cuenta, la mesa, la orden, la impresora y el documento) y NO cambia de pantalla ni imprime en el teléfono', async () => {
  const t = await arrancar(montar());
  const antes = t.pos.vista;
  assert.equal(await t.pos.imprimirCuentaEnCaja(), true);
  assert.equal(t.pos.vista, antes, 'sigue en la orden');
  assert.deepEqual(t.impresiones, [], 'el teléfono no imprime');
  const inserts = insertsDeImpresion(t);
  assert.equal(inserts.length, 1);
  const fila = plano(inserts[0].cuerpo);
  assert.deepEqual(Object.keys(fila).sort(), ['contenido', 'id', 'impresora_id', 'mesa_id', 'orden_id', 'tipo'], 'solo las columnas que el GRANT deja insertar: nada de estado, intentos ni creada_por');
  assert.match(fila.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'el id lo pone el teléfono (un uuid v4)');
  assert.equal(fila.tipo, 'cuenta');
  assert.equal(fila.impresora_id, 'impresora-1');
  assert.equal(fila.mesa_id, 3);
  assert.equal(fila.orden_id, 'o1');
  assert.equal(fila.contenido.v, 1);
  assert.equal(fila.contenido.titulo, 'Resplandor');
  assert.deepEqual(plano(texto(fila.contenido, 'TOTAL')), { texto: 'TOTAL', der: '$ 97.000', negrita: true, doble: true });
  assert.equal(t.pos.cajaTrabajos.length, 1);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'pendiente');
  assert.equal(t.pos.cajaTrabajos[0].titulo, 'Cuenta · Mesa 3', 'el aviso dice qué se mandó');
  assert.equal(t.pos.cajaTrabajos[0].id, fila.id);
  assert.equal(ultimaFila(t).id, fila.id);
});

test('mandar: desde el ticket el tipo sale de lo que muestra la pantalla (cobro → ticket, pre-cuenta → cuenta, abono → abono)', async () => {
  const cobro = await arrancar(montar());
  cobro.pos.facturar();
  await cobro.pos.imprimirTicketEnCaja();
  assert.equal(plano(insertsDeImpresion(cobro)[0].cuerpo).tipo, 'ticket');
  assert.equal(plano(insertsDeImpresion(cobro)[0].cuerpo).orden_id, 'o1');

  const pre = await arrancar(montar());
  pre.pos.ticketMostrado = pre.pos._armarPreCuenta();
  pre.pos.vista = 'ticket';
  await pre.pos.imprimirTicketEnCaja();
  assert.equal(plano(insertsDeImpresion(pre)[0].cuerpo).tipo, 'cuenta');

  const abono = await arrancar(montar());
  abono.pos.montoAbono = '10000';
  abono.pos.cobrarMonto();
  await abono.pos.imprimirTicketEnCaja();
  assert.equal(plano(insertsDeImpresion(abono)[0].cuerpo).tipo, 'abono');
});

test('mandar: un segundo toque mientras el primero viaja no manda otro (un envío a la vez), y con la orden vacía no hay nada que mandar', async () => {
  const t = await arrancar(montar());
  const primero = t.pos.imprimirCuentaEnCaja();
  const segundo = t.pos.imprimirCuentaEnCaja();
  assert.equal(await segundo, false);
  assert.equal(await primero, true);
  assert.equal(insertsDeImpresion(t).length, 1);

  const vacia = await arrancar(montar({ items: [] }));
  assert.equal(await vacia.pos.imprimirCuentaEnCaja(), false);
  assert.deepEqual(insertsDeImpresion(vacia), []);
  assert.deepEqual(vacia.impresiones, [], 'y tampoco cae a imprimir una cuenta vacía');
});

test('mandar: antes de encolar confirma que la caja sigue en línea si el estado tiene unos segundos (no encola a una caja que ya no late)', async () => {
  const t = await arrancar(montar());
  t.base.impresoras[0].en_linea = false;          // el agente se cayó hace un momento; el teléfono aún no se enteró
  t.pos.cajaRevisadaEn = Date.now() - 60000;
  assert.equal(t.pos.puedeImprimirEnCaja, true, 'la pantalla todavía lo cree');
  assert.equal(await t.pos.imprimirCuentaEnCaja(), false);
  assert.deepEqual(insertsDeImpresion(t), [], 'no se encoló nada');
  assert.deepEqual(t.impresiones, ['imprimirPreCuenta'], 'el teléfono imprime él mismo');
  assert.equal(t.pos.puedeImprimirEnCaja, false, 'y ya lo sabe');
});

test('mandar: con dos cajas va a la que está en línea, y la prueba de una impresora va a ESA', async () => {
  const dos = [{ ...CAJA, id: 'impresora-1', en_linea: false }, { ...CAJA, id: 'impresora-2', nombre: 'Barra', en_linea: true }];
  const t = await arrancar(montar({ impresoras: dos }));
  await t.pos.imprimirCuentaEnCaja();
  assert.equal(plano(insertsDeImpresion(t)[0].cuerpo).impresora_id, 'impresora-2');
  t.base.impresoras[0].en_linea = true;
  t.pos.cajaRevisadaEn = 0;
  await t.pos.cargarEstadoCaja();
  t.pos.cajaTrabajos = [];
  await t.pos.imprimirPruebaEnCaja('impresora-1');
  assert.equal(plano(insertsDeImpresion(t)[1].cuerpo).impresora_id, 'impresora-1');
  assert.equal(plano(insertsDeImpresion(t)[1].cuerpo).tipo, 'prueba');
});

// ═════════════════════════ 5. Estado en vivo ═════════════════════════

test('en vivo: En cola → Imprimiendo → Impreso por Realtime, con el texto de cada paso; «Impreso» se quita solo a los 6 s', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const id = ultimaFila(t).id;
  const trabajo = () => t.pos.cajaTrabajos[0];
  assert.equal(t.pos.textoTrabajoCaja(trabajo()), 'En cola en la caja…');
  assert.equal(trabajo().titulo, 'Cuenta · Mesa 3');

  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(id, 'imprimiendo'), old: {} });
  assert.equal(trabajo().estado, 'imprimiendo');
  assert.equal(t.pos.textoTrabajoCaja(trabajo()), 'Imprimiendo en la caja…');

  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(id, 'impresa'), old: {} });
  assert.equal(trabajo().estado, 'impresa');
  assert.equal(t.pos.textoTrabajoCaja(trabajo()), 'Impreso en la caja');
  assert.deepEqual(plano(t.pos.trabajosCaja.map((e) => e.estado)), ['impresa']);
  assert.equal(t.relojes.esperando(6000).length, 1, 'se quita solo en 6 s');
  await t.relojes.disparar(6000);
  assert.deepEqual(plano(t.pos.cajaTrabajos), []);
});

test('en vivo: el respaldo lee el estado cuando Realtime no avisa (tabla fuera de la publicación) y se detiene cuando no queda nada en curso', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const id = ultimaFila(t).id;
  assert.equal(t.relojes.esperando(4000).length, 1, 'hay un ciclo de lectura cada 4 s mientras algo está en curso');
  t.base.imprimir(id, 'imprimiendo');
  await t.relojes.disparar(4000);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'imprimiendo');
  const lecturas = t.supabase.de('impresiones', 'select');
  assert.ok(lecturas.length >= 1);
  assert.deepEqual(plano(lecturas.at(-1).filtros), [['id', [id], 'in']], 'solo lo que este teléfono mandó');
  assert.equal(t.relojes.esperando(4000).length, 1, 'sigue mientras no termine');
  t.base.imprimir(id, 'impresa');
  await t.relojes.disparar(4000);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa');
  assert.equal(t.relojes.esperando(4000).length + t.relojes.esperando(15000).length, 0, 'terminó: ya no se lee');
});

test('en vivo: un error de la impresora se ve con su motivo, «Reintentar» manda el mismo documento otra vez y reemplaza al fallido', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const id = ultimaFila(t).id;
  const clave = t.pos.cajaTrabajos[0].clave;
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(id, 'error', 'la impresora no tiene papel'), old: {} });
  assert.equal(t.pos.cajaTrabajos[0].estado, 'error');
  assert.equal(t.pos.textoTrabajoCaja(t.pos.cajaTrabajos[0]), 'Error: la impresora no tiene papel.');
  assert.equal(t.relojes.esperando(6000).length, 0, 'un error no se quita solo');

  assert.equal(await t.pos.reintentarImpresion(clave), true);
  const inserts = insertsDeImpresion(t);
  assert.equal(inserts.length, 2);
  assert.notEqual(plano(inserts[1].cuerpo).id, plano(inserts[0].cuerpo).id, 'un trabajo nuevo, con su propio id');
  assert.deepEqual({ ...plano(inserts[1].cuerpo), id: null }, { ...plano(inserts[0].cuerpo), id: null }, 'el mismo documento, el mismo destino');
  assert.equal(t.pos.cajaTrabajos.length, 1, 'el fallido se reemplaza por el nuevo');
  assert.notEqual(t.pos.cajaTrabajos[0].id, id);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'pendiente');
  // Reintentar solo existe para un error: un trabajo en cola no se duplica.
  assert.equal(await t.pos.reintentarImpresion(t.pos.cajaTrabajos[0].clave), false);
  assert.equal(insertsDeImpresion(t).length, 2);
});

test('en vivo: «Reintentando…» cuando la base ya va por el segundo intento, y un reintento que no sale deja el error a la vista', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const id = ultimaFila(t).id;
  t.base.imprimir(id, 'imprimiendo');
  t.base.imprimir(id, 'imprimiendo');
  t.base.imprimir(id, 'pendiente');
  await t.pos._refrescarImpresiones();
  assert.equal(t.pos.cajaTrabajos[0].intentos, 2);
  assert.equal(t.pos.textoTrabajoCaja(t.pos.cajaTrabajos[0]), 'Reintentando en la caja…');

  t.base.imprimir(id, 'error', 'se agotaron los intentos');
  await t.pos._refrescarImpresiones();
  t.base.impresionRechazo = { code: '42501', message: 'new row violates row-level security policy for table "impresiones"' };
  assert.equal(await t.pos.reintentarImpresion(t.pos.cajaTrabajos[0].clave), false);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'error', 'el error sigue a la vista');
  assert.match(t.pos.aviso.texto, /La base no dejó mandar el ticket a la caja/);
});

test('en vivo: a los 25 s en cola dice que la caja no responde (sigue en cola), y si el PC vuelve y imprime, el aviso se corrige solo', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const id = ultimaFila(t).id;
  assert.equal(t.relojes.esperando(25000).length, 1);
  await t.relojes.disparar(25000);
  assert.equal(t.pos.cajaTrabajos[0].sinRespuesta, true);
  assert.match(t.pos.textoTrabajoCaja(t.pos.cajaTrabajos[0]), /La caja no responde\. Sigue en cola y sale cuando el PC vuelva \(hasta 15 min\); si no puedes esperar, usa «Imprimir» de este teléfono y se cancela el de la caja\./);
  assert.ok(t.supabase.rpcs('impresora_estado').length >= 2, 'y de paso vuelve a preguntar si la caja está en línea');
  await t.relojes.disparar(4000);                    // la lectura que ya estaba en marcha termina y se reprograma más lenta
  assert.equal(t.relojes.esperando(15000).length, 1, 'baja el ritmo de lectura: lo que queda ya lleva rato sin responder');
  t.base.imprimir(id, 'impresa');
  await t.relojes.disparar(15000);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa');
  assert.equal(t.pos.cajaTrabajos[0].sinRespuesta, false);
  assert.equal(t.pos.textoTrabajoCaja(t.pos.cajaTrabajos[0]), 'Impreso en la caja');
});

test('en vivo: «cerrar» quita el aviso, el aviso flotante muestra los tres últimos (el más nuevo primero) y la lista no crece sin tope', async () => {
  const t = await arrancar(montar());
  for (let i = 0; i < 12; i++) {
    t.pos.cajaTrabajos = [];   // un trabajo por vez para no chocar con «un envío a la vez»
    await t.pos.imprimirCuentaEnCaja();
    t.pos.cajaTrabajos[0].estado = 'impresa';
  }
  t.pos.cajaTrabajos = Array.from({ length: 5 }, (_, n) => ({ clave: `c${n}`, id: `i${n}`, estado: 'impresa', titulo: `T${n}`, error: '', intentos: 0, sinRespuesta: false }));
  assert.deepEqual(plano(t.pos.trabajosCaja.map((e) => e.titulo)), ['T4', 'T3', 'T2']);
  t.pos.cerrarTrabajoCaja('c4');
  assert.deepEqual(plano(t.pos.trabajosCaja.map((e) => e.titulo)), ['T3', 'T2', 'T1']);
  const lleno = await arrancar(montar());
  lleno.pos.cajaTrabajos = Array.from({ length: 10 }, (_, n) => ({ clave: `c${n}`, id: `i${n}`, estado: 'impresa', titulo: `T${n}`, error: '', intentos: 0, sinRespuesta: false }));
  await lleno.pos.imprimirCuentaEnCaja();
  assert.equal(lleno.pos.cajaTrabajos.length, 10, 'el tope de lo que recuerda el teléfono');
});

// ═════════════════════════ 6. Caída al teléfono ═════════════════════════

test('caída: si la base rechaza el insert (RLS, límite por minuto) el teléfono imprime él mismo, avisa y no deja un aviso de «en cola» colgado', async () => {
  const t = await arrancar(montar());
  t.base.impresionRechazo = { code: '42501', message: 'new row violates row-level security policy for table "impresiones"' };
  assert.equal(await t.pos.imprimirCuentaEnCaja(), false);
  assert.deepEqual(t.impresiones, ['imprimirPreCuenta'], 'la cuenta sale por window.print() como siempre');
  assert.equal(t.pos.vista, 'ticket', 'y se ve el ticket que se imprime');
  assert.match(t.pos.aviso.texto, /Se imprime desde este teléfono\./);
  assert.deepEqual(plano(t.pos.cajaTrabajos), [], 'nada colgado');
});

test('caída: sin red el teléfono imprime él mismo (el ticket de un cobro: window.print(), no la pre-cuenta)', async () => {
  const t = await arrancar(montar());
  t.pos.facturar();
  t.base.red = false;
  assert.equal(await t.pos.imprimirTicketEnCaja(), false);
  assert.deepEqual(t.impresiones, ['imprimir']);
  assert.match(t.pos.aviso.texto, /No se pudo mandar el ticket a la caja\. Se imprime desde este teléfono\./);
  assert.deepEqual(plano(t.pos.cajaTrabajos), []);
});

test('caída: si la cola desaparece de la base entre tanto, se apaga la función (no se vuelve a ofrecer) y el teléfono imprime', async () => {
  const t = await arrancar(montar());
  t.base.colaAusente = true;
  t.pos.cajaRevisadaEn = Date.now();                 // el estado es reciente: el insert es lo que falla
  assert.equal(await t.pos.imprimirCuentaEnCaja(), false);
  assert.equal(t.pos.cajaDisponible, false);
  assert.equal(t.pos.puedeImprimirEnCaja, false);
  assert.deepEqual(t.impresiones, ['imprimirPreCuenta']);
});

test('caída: la caja sin conexión al tocar (el botón ya no estaba) cae al teléfono con el aviso, y nunca queda el ticket sin imprimir', async () => {
  const t = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false }] }));
  t.pos.facturar();
  assert.equal(await t.pos.imprimirTicketEnCaja(), false);
  assert.deepEqual(t.impresiones, ['imprimir']);
  assert.equal(t.pos.aviso.texto, 'La caja no está en línea. Se imprime desde este teléfono.');
  assert.deepEqual(insertsDeImpresion(t), []);
});

test('caída: el insert llegó pero la respuesta se perdió y la caja aún no lo tomó: se cancela con el id del teléfono y el teléfono imprime (sin copia doble en la caja)', async () => {
  const t = await arrancar(montar());
  t.base.respuestaPerdida = true;
  assert.equal(await t.pos.imprimirCuentaEnCaja(), false);
  const llamadas = t.supabase.rpcs('impresion_cancelar');
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].args.p_id, ultimaFila(t).id, 'cancela EL trabajo que el teléfono mandó');
  assert.equal(ultimaFila(t).estado, 'error');
  assert.equal(ultimaFila(t).error, 'cancelada');
  assert.deepEqual(t.impresiones, ['imprimirPreCuenta']);
  assert.deepEqual(plano(t.pos.cajaTrabajos), [], 'sin aviso colgado');
});

test('caída: el insert llegó, la respuesta se perdió y la caja YA lo tomó: no se imprime dos veces, el trabajo sigue en el aviso y se sigue en vivo', async () => {
  const t = await arrancar(montar({
    // El agente del PC lo toma en el mismo instante en que se pierde la respuesta del insert.
    interceptar: (c, original) => (c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'insert'
      ? original(c).then(() => { t.base.imprimir(ultimaFila(t).id, 'imprimiendo'); return { data: null, error: { message: 'TypeError: Failed to fetch' } }; })
      : undefined),
  }));
  assert.equal(await t.pos.imprimirCuentaEnCaja(), true, 'la caja ya lo tiene: no hay nada que imprimir en el teléfono');
  assert.deepEqual(t.impresiones, []);
  assert.equal(ultimaFila(t).estado, 'imprimiendo', 'no se canceló lo que ya se estaba imprimiendo');
  assert.equal(t.supabase.rpcs('impresion_cancelar').length, 1);
  assert.equal(t.pos.cajaTrabajos.length, 1);
  assert.equal(t.pos.cajaTrabajos[0].id, ultimaFila(t).id);
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(ultimaFila(t).id, 'impresa'), old: {} });
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa');
});

test('caída: el insert no contesta a tiempo (10 s) y la cancelación tampoco: el teléfono imprime igual (mejor dos copias que ninguna)', async () => {
  const t = await arrancar(montar({ interceptar: (c) => (c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'insert') || c.nombre === 'impresion_cancelar' ? new Promise(() => {}) : undefined }));
  const envio = t.pos.imprimirCuentaEnCaja();
  await asentar();
  await t.relojes.disparar(10000);       // se acaba la espera del insert
  await asentar();
  await t.relojes.disparar(4000);        // y la de la cancelación
  assert.equal(await envio, false);
  assert.deepEqual(t.impresiones, ['imprimirPreCuenta']);
  assert.match(t.pos.aviso.texto, /Se imprime desde este teléfono\./);
  assert.deepEqual(plano(t.pos.cajaTrabajos), []);
});

test('caída: un rechazo claro de la base (RLS, tope por minuto) no intenta cancelar nada: el trabajo nunca existió', async () => {
  const t = await arrancar(montar());
  t.base.impresionRechazo = { code: 'RS030', message: 'demasiadas impresiones seguidas: espera un momento' };
  assert.equal(await t.pos.imprimirCuentaEnCaja(), false);
  assert.equal(t.supabase.rpcs('impresion_cancelar').length, 0);
  assert.match(t.pos.aviso.texto, /No se pudo mandar el ticket a la caja\. Se imprime desde este teléfono\./);
});

test('caída: un ticket más grande de lo que la base acepta (32 KB) no se manda: el teléfono imprime él mismo', async () => {
  const largo = 'x'.repeat(115);
  const muchos = Array.from({ length: 280 }, (_, n) => ({ id: `p${n}`, nombre: `${largo}${n}`, precio: 1000, qty: 1, nota: largo }));
  const t = await arrancar(montar({ items: muchos }));
  assert.ok(JSON.stringify(t.pos.documentoTicket(t.pos._armarPreCuenta(), 'cuenta')).length > 30000, 'el caso de prueba pesa más que el tope');
  assert.equal(await t.pos.imprimirCuentaEnCaja(), false);
  assert.deepEqual(insertsDeImpresion(t), [], 'ni se intentó');
  assert.match(t.pos.aviso.texto, /demasiado largo para la caja\. Se imprime desde este teléfono\./);
  assert.deepEqual(t.impresiones, ['imprimirPreCuenta']);
});

test('en vivo: si Realtime avisa antes de que conteste el insert, vale lo más nuevo (no vuelve a «En cola» un trabajo que ya está impreso)', async () => {
  const t = await arrancar(montar({
    interceptar: (c, original) => (c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'insert'
      ? original(c).then((r) => { t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(ultimaFila(t).id, 'impresa'), old: {} }); return r; })   // llega antes que la respuesta
      : undefined),
  }));
  assert.equal(await t.pos.imprimirCuentaEnCaja(), true);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa');
  assert.equal(t.relojes.esperando(6000).length, 1, '«Impreso» se quita solo, una sola vez');
  assert.equal(t.pos.cajaEnviando, false);
});

// ═════════════════════════ 7. El admin ═════════════════════════

test('admin: crear la impresora llama impresora_crear con el nombre, muestra el token UNA vez, solo en memoria, y la lista la trae', async () => {
  const almacen = new Map();
  const t = await arrancar(montar({ impresoras: [], almacen }));
  assert.equal(t.pos.puede('impresora'), true);
  assert.equal(await t.pos.crearImpresora('  Caja principal  '), true);
  const llamadas = t.supabase.rpcs('impresora_crear');
  assert.deepEqual(plano(llamadas.map((l) => l.args)), [{ p_nombre: 'Caja principal' }]);
  assert.equal(t.pos.cajaToken.nombre, 'Caja principal');
  assert.ok(t.pos.cajaToken.token.length >= 16);
  assert.equal(t.pos.cajaImpresoras.length, 1, 'la lista se vuelve a leer: aparece la nueva');
  assert.equal(t.pos.cajaImpresoras[0].id, t.pos.cajaToken.id);
  assert.equal(t.pos.cajaConfigurada, true);
  assert.equal(t.pos.cajaEnLinea, false, 'hasta que el agente del PC late, sin conexión');
  // Ni en el almacenamiento, ni en la consola, ni en la lista que se pinta.
  const token = t.pos.cajaToken.token;
  assert.ok(![...almacen.values()].some((v) => String(v).includes(token)), 'el token no se guarda en localStorage');
  assert.ok(!JSON.stringify(t.consola).includes(token), 'ni se escribe en la consola');
  assert.ok(!JSON.stringify(plano(t.pos.cajaImpresoras)).includes(token), 'ni viaja en la lista de impresoras');
  // «Listo, ya lo copié» lo olvida.
  t.pos.olvidarTokenCaja();
  assert.equal(t.pos.cajaToken, null);
  assert.equal(t.pos.configAgente, '');
});

test('admin: sin nombre se llama «Caja»; un nombre de más de 60 caracteres se rechaza en la pantalla, sin llamar a la base', async () => {
  const t = await arrancar(montar({ impresoras: [] }));
  assert.equal(await t.pos.crearImpresora('   '), true);
  assert.deepEqual(plano(t.supabase.rpcs('impresora_crear').map((l) => l.args)), [{ p_nombre: 'Caja' }]);
  assert.equal(await t.pos.crearImpresora('x'.repeat(61)), false);
  assert.equal(t.supabase.rpcs('impresora_crear').length, 1);
  assert.match(t.pos.cajaAdminError, /máximo 60 caracteres/);
});

test('admin: rotar llama impresora_rotar con el id y entrega un token NUEVO; un doble toque en vuelo no rota dos veces', async () => {
  const t = await arrancar(montar());
  const primero = t.pos.rotarImpresora('impresora-1');
  const segundo = t.pos.rotarImpresora('impresora-1');
  assert.equal(await segundo, false);
  assert.equal(await primero, true);
  assert.deepEqual(plano(t.supabase.rpcs('impresora_rotar').map((l) => l.args)), [{ p_id: 'impresora-1' }]);
  const uno = t.pos.cajaToken.token;
  assert.equal(t.pos.cajaToken.nombre, 'Caja', 'con el nombre de la impresora rotada');
  await t.pos.rotarImpresora('impresora-1');
  assert.notEqual(t.pos.cajaToken.token, uno);
  assert.equal(await t.pos.rotarImpresora('no-existe'), false);
  assert.match(t.pos.cajaAdminError, /ya no existe/);
});

test('admin: el config.json del agente sale armado con la dirección de la base, el token y los valores por omisión; copiar usa el portapapeles y avisa si no se puede', async () => {
  const t = await arrancar(montar({ impresoras: [] }));
  await t.pos.crearImpresora('Caja');
  const config = JSON.parse(t.pos.configAgente);
  assert.deepEqual(Object.keys(config), ['supabaseUrl', 'publishableKey', 'token', 'impresora', 'columnas', 'tablaEscPos', 'cortar', 'qrNativo']);
  assert.match(config.supabaseUrl, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
  assert.match(config.publishableKey, /^sb_publishable_/, 'la llave pública que ya vive en pos.html; nunca la service_role');
  assert.equal(config.token, t.pos.cajaToken.token);
  assert.deepEqual([config.columnas, config.tablaEscPos, config.cortar, config.qrNativo], [48, 2, true, true]);

  assert.equal(await t.pos.copiarTokenCaja(), true);
  assert.equal(t.pos.cajaCopiado, 'token');
  assert.equal(t.portapapeles.at(-1), t.pos.cajaToken.token);
  assert.equal(await t.pos.copiarConfigCaja(), true);
  assert.equal(t.pos.cajaCopiado, 'config');
  assert.equal(t.portapapeles.at(-1), t.pos.configAgente);

  t.portapapeles.fallar = true;
  assert.equal(await t.pos.copiarTokenCaja(), false);
  assert.equal(t.pos.cajaCopiado, 'manual', 'sin portapapeles: queda seleccionado para copiarlo a mano');
  assert.equal(await t.pos.copiarConfigCaja(), false);
  assert.equal(t.pos.cajaCopiado, 'fallo');
});

test('admin: el mesero no puede crear ni rotar (ni por la pantalla ni llamando al store), la base tampoco; y sigue pudiendo imprimir en la caja', async () => {
  const t = await arrancar(montar({ rol: 'mesero' }));
  assert.equal(t.pos.puede('impresora'), false);
  assert.equal(await t.pos.crearImpresora('Otra'), false);
  assert.equal(await t.pos.rotarImpresora('impresora-1'), false);
  assert.match(t.pos.cajaAdminError, /Solo un admin/);
  assert.equal(t.supabase.rpcs('impresora_crear').length + t.supabase.rpcs('impresora_rotar').length, 0, 'ni siquiera llega a la base');
  assert.equal(await t.pos.imprimirPruebaEnCaja(), false);
  assert.deepEqual(t.avisos, [], 'sin un alert() nativo');
  assert.equal(t.pos.cajaToken, null);

  // Si alguien se salta la pantalla (el rol aún no cargado), la base lo corta: 42501, y el mensaje lo dice.
  const cruda = await arrancar(montar({ rol: 'mesero' }));
  cruda.pos.rolCargado = false;
  assert.equal(await cruda.pos.crearImpresora('Otra'), false);
  assert.match(cruda.pos.cajaAdminError, /Solo un admin/);
  assert.equal(cruda.pos.cajaToken, null);
  assert.equal(await cruda.pos.cargarEstadoCaja() !== undefined, true);

  assert.equal((await arrancar(montar({ rol: 'mesero' }))).pos.puedeImprimirEnCaja, true);
});

test('admin: errores de la base en palabras (sin conexión, sin la migración) y el token que no llega no se da por bueno', async () => {
  const sinRed = await arrancar(montar({ impresoras: [] }));
  sinRed.base.red = false;
  assert.equal(await sinRed.pos.crearImpresora('Caja'), false);
  assert.match(sinRed.pos.cajaAdminError, /Sin conexión: no se guardó/);
  assert.equal(sinRed.pos.cajaToken, null);

  const sinMigracion = await arrancar(montar({ impresoras: [] }));
  sinMigracion.base.sinFuncion.add('impresora_crear');
  assert.equal(await sinMigracion.pos.crearImpresora('Caja'), false);
  assert.match(sinMigracion.pos.cajaAdminError, /Falta aplicar la migración de la cola de impresión/);

  const sinToken = await arrancar(montar({ impresoras: [], interceptar: (c) => (c.nombre === 'impresora_crear' ? { data: { id: 'x' }, error: null } : undefined) }));
  assert.equal(await sinToken.pos.crearImpresora('Caja'), false);
  assert.match(sinToken.pos.cajaAdminError, /no devolvió el token/);
});

test('admin: la prueba va a la impresora en línea con tipo «prueba» y un papelito con tildes, ñ, precio y QR; sin caja en línea lo dice sin imprimir en el teléfono', async () => {
  const t = await arrancar(montar());
  assert.equal(await t.pos.imprimirPruebaEnCaja(), true);
  const fila = plano(insertsDeImpresion(t)[0].cuerpo);
  assert.equal(fila.tipo, 'prueba');
  assert.equal(fila.mesa_id, null);
  assert.equal(fila.orden_id, null);
  assert.equal(fila.contenido.titulo, 'Resplandor');
  assert.ok(fila.contenido.lineas.some((l) => l.texto === 'PRUEBA DE IMPRESIÓN'));
  assert.ok(fila.contenido.lineas.some((l) => /áéíóú/.test(l.texto) && /ñ/.test(l.texto)));
  assert.equal(fila.contenido.qr.texto, 'https://resplandor.ynt.codes/');
  assert.equal(t.pos.cajaTrabajos[0].titulo, 'Prueba de impresión');
  assert.deepEqual(t.impresiones, [], 'una prueba nunca cae al teléfono');

  const apagada = await arrancar(montar({ impresoras: [{ ...CAJA, en_linea: false }] }));
  assert.equal(await apagada.pos.imprimirPruebaEnCaja(), false);
  assert.match(apagada.pos.cajaAdminError, /La caja no está en línea\. Revisa que el PC de la caja esté encendido/);
  assert.deepEqual(apagada.impresiones, []);
});

test('admin: «Último latido hace…» en segundos, minutos u horas, y «Aún no ha latido» si el agente nunca se conectó', async () => {
  const t = await arrancar(montar());
  const hace = (s) => ({ ultimo_latido: new Date(Date.now() - s * 1000).toISOString() });
  assert.equal(t.pos.latidoCajaTxt(hace(12)), 'Último latido hace 12 s');
  assert.equal(t.pos.latidoCajaTxt(hace(125)), 'Último latido hace 2 min');
  assert.equal(t.pos.latidoCajaTxt(hace(7300)), 'Último latido hace 2 h');
  assert.equal(t.pos.latidoCajaTxt({ ultimo_latido: null }), 'Aún no ha latido');
  assert.equal(t.pos.latidoCajaTxt(null), 'Aún no ha latido');
});

test('admin: abrirImpresoraCaja lleva al admin a su pantalla y al mesero le dice el estado en un aviso breve', async () => {
  const admin = await arrancar(montar());
  admin.pos.vista = 'mesas';
  admin.pos.abrirImpresoraCaja();
  assert.equal(admin.pos.vista, 'impresora');
  const mesero = await arrancar(montar({ rol: 'mesero', impresoras: [{ ...CAJA, en_linea: false }] }));
  mesero.pos.vista = 'mesas';
  mesero.pos.abrirImpresoraCaja();
  assert.equal(mesero.pos.vista, 'mesas', 'esa pantalla no es del mesero');
  assert.equal(mesero.pos.aviso.texto, 'Caja: sin conexión. Mientras no esté en línea, la cuenta se imprime desde este teléfono.');
  const linea = await arrancar(montar({ rol: 'mesero' }));
  linea.pos.abrirImpresoraCaja();
  assert.equal(linea.pos.aviso.texto, 'Caja: en línea. Las cuentas se imprimen en la impresora de la caja.');
});

test('admin: si le quitan el rol de admin con la pantalla de la impresora abierta, sale de ella', async () => {
  const t = await arrancar(montar());
  t.pos.vista = 'impresora';
  t.base.rol = 'mesero';
  await t.pos.cargarRol();
  assert.equal(t.pos.vista, 'mesas');
});

// ═════════════════════════ 8. Ciclo de vida ═════════════════════════

test('vida: detener la app cierra el canal y apaga los relojes de la caja; volver a arrancarla los pone de nuevo', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const canal = t.supabase.canal('pos_impresiones');
  assert.ok(t.relojes.intervalos.length === 1 && t.relojes.pendientes.length > 0);
  t.pos._detenerApp();
  assert.equal(canal.removido, true);
  assert.deepEqual(t.relojes.intervalos, [], 'el ciclo de 30 s');
  assert.deepEqual(t.relojes.pendientes, [], 'ni el de cierre ni el de lectura ni el de «no responde»');
  await t.pos.arrancarApp();
  await asentar();
  assert.equal(t.relojes.intervalos.length, 1);
  assert.ok(t.supabase.canales.filter((c) => c.nombre === 'pos_impresiones').length >= 2, 'canal nuevo');
});

test('vida: al cerrar la sesión se olvida todo de la caja (estado, trabajos y el token que se mostró): otra persona puede entrar en esta tablet', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  await t.pos.rotarImpresora('impresora-1');
  assert.ok(t.pos.cajaToken && t.pos.cajaTrabajos.length === 1);
  t.pos._alSalirLaSesion();
  assert.equal(t.pos.cajaToken, null);
  assert.deepEqual(plano(t.pos.cajaTrabajos), []);
  assert.deepEqual(plano(t.pos.cajaImpresoras), []);
  assert.equal(t.pos.cajaDisponible, false);
  assert.equal(t.pos.cajaVisible, false);
  assert.deepEqual(t.relojes.pendientes, []);
});

test('vida: una cuenta sin acceso no deja nada de la caja (_olvidarTodo) y volver a la pestaña o a la red repregunta una sola vez', async () => {
  const t = await arrancar(montar());
  t.pos._olvidarTodo();
  assert.equal(t.pos.cajaDisponible, false);
  assert.deepEqual(plano(t.pos.cajaImpresoras), []);

  const u = await arrancar(montar());
  const antes = u.supabase.rpcs('impresora_estado').length;
  u.eventosDocumento.visibilitychange?.();
  await asentar();
  assert.equal(u.supabase.rpcs('impresora_estado').length, antes + 1, 'al volver a la pestaña (la tablet pudo dormir)');
  u.eventosVentana.online?.();
  await asentar();
  assert.equal(u.supabase.rpcs('impresora_estado').length, antes + 2, 'y al volver la red');
});

// ═════════════════════════ 9. Refutación de 49cba6b: nada vivo en la cola que nadie vea ═════════════════════════
// Hallazgos 1 (POS: el «imprimiendo» que se calla), 2 (copias dobles: caída al teléfono, X y «Enviando…») y 4 (la cuenta larga no se recorta).

const ESPERA_IMPRIMIENDO = 150000;
const vivos = (t) => [...t.base.impresiones.values()].filter((f) => f.estado === 'pendiente' || f.estado === 'imprimiendo');
const cancelaciones = (t) => t.supabase.rpcs('impresion_cancelar').length;
const sinRespuesta = async (t) => { await t.pos.imprimirCuentaEnCaja(); await t.relojes.disparar(25000); return t.pos.cajaTrabajos[0]; };

test('R1: «La caja no responde» → el mesero usa «Imprimir cuenta» del teléfono → el POS CANCELA el trabajo de la caja: sale UNA copia, no dos al volver el PC', async () => {
  const t = await arrancar(montar());
  const e = await sinRespuesta(t);
  assert.equal(e.sinRespuesta, true);
  assert.match(t.pos.textoTrabajoCaja(e), /se cancela el de la caja/, 'el aviso lo promete y el POS lo cumple');
  t.pos.imprimirPreCuenta();
  await t.relojes.disparar(60);
  assert.deepEqual(t.impresiones, ['imprimirPreCuenta', 'imprimir'], 'el teléfono imprime, sin esperar a la red');
  assert.equal(cancelaciones(t), 1);
  assert.equal(t.supabase.rpcs('impresion_cancelar')[0].args.p_id, e.id);
  assert.equal(vivos(t).length, 0, 'nada vivo en la cola: la caja no imprimirá otra copia al volver');
  assert.equal(ultimaFila(t).error, 'cancelada');
  assert.deepEqual(plano(t.pos.cajaTrabajos), [], 'y el aviso de «no responde» se va');
});

test('R1: lo mismo desde la pantalla del ticket («Imprimir» a secas): imprimirEnTelefono cancela lo que esa cuenta dejó sin respuesta', async () => {
  const t = await arrancar(montar());
  const e = await sinRespuesta(t);
  t.pos.ticketMostrado = t.pos._armarPreCuenta();
  t.pos.vista = 'ticket';
  t.pos.imprimirEnTelefono();
  await asentar();
  assert.deepEqual(t.impresiones, ['imprimir']);
  assert.equal(cancelaciones(t), 1);
  assert.equal(vivos(t).length, 0);
  assert.equal(t.pos._trabajo(e.clave), null);
});

test('R1: solo se cancela lo SIN respuesta y de ESA cuenta: lo que va en cola con la caja respondiendo, o de otra mesa, no se toca', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();                       // en cola, hace segundos: la caja todavía puede tomarlo
  t.pos.imprimirPreCuenta();                                // el mesero pidió las dos copias (caja y teléfono)
  await t.relojes.disparar(60);
  assert.equal(cancelaciones(t), 0, 'una cuenta en cola con la caja respondiendo no se cancela: se pidieron las dos');
  assert.equal(vivos(t).length, 1);
  // sin respuesta pero de OTRA cuenta
  await t.relojes.disparar(25000);
  t.pos.cajaTrabajos[0].ordenId = 'otra-orden';
  t.pos.imprimirPreCuenta();
  await t.relojes.disparar(60);
  assert.equal(cancelaciones(t), 0, 'la cuenta de otra mesa sigue su camino');
  assert.equal(vivos(t).length, 1);
});

test('R1: la caja justo lo tomó mientras el teléfono imprimía: no se puede cancelar, el aviso se corrige y no se toca nada más', async () => {
  const t = await arrancar(montar());
  const e = await sinRespuesta(t);
  t.base.imprimir(e.id, 'imprimiendo');                      // el PC volvió y lo tomó justo ahora
  t.pos.imprimirPreCuenta();
  await t.relojes.disparar(60);
  assert.equal(cancelaciones(t), 1);
  assert.equal(ultimaFila(t).estado, 'imprimiendo', 'la base no lo cancela');
  assert.equal(t.pos.cajaTrabajos[0].estado, 'imprimiendo', 'y el aviso lo refleja');
  assert.equal(t.pos.cajaTrabajos[0].sinRespuesta, false);
});

test('R1b: la X de un trabajo en cola lo CANCELA en la base antes de quitar el aviso (no queda vivo para salir más tarde sin que nadie lo espere)', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const e = t.pos.cajaTrabajos[0];
  assert.equal(t.pos.puedeCerrarTrabajoCaja(e), true);
  assert.equal(await t.pos.cerrarTrabajoCaja(e.clave), true);
  assert.equal(cancelaciones(t), 1);
  assert.equal(vivos(t).length, 0);
  assert.equal(ultimaFila(t).error, 'cancelada');
  assert.equal(t.pos.cajaTrabajos.length, 0);
  assert.match(t.pos.aviso.texto, /Cancelado: no saldrá en la caja/);
});

test('R1b: si la base no contesta, la X NO quita el aviso (el trabajo sigue vivo y hay que verlo); y si la caja lo tomó justo ahora, tampoco', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const e = t.pos.cajaTrabajos[0];
  t.base.fallar('rpc:impresion_cancelar');
  assert.equal(await t.pos.cerrarTrabajoCaja(e.clave), false);
  assert.equal(t.pos.cajaTrabajos.length, 1, 'el aviso se queda');
  assert.match(t.pos.aviso.texto, /No se pudo cancelar en la caja \(sin conexión\)/);
  assert.equal(vivos(t).length, 1);
  t.base.repararTodo();
  t.base.imprimir(e.id, 'imprimiendo');                      // el PC lo toma antes del segundo intento
  assert.equal(await t.pos.cerrarTrabajoCaja(e.clave), false);
  assert.match(t.pos.aviso.texto, /La caja justo lo tomó/);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'imprimiendo', 'el aviso muestra lo que de verdad pasa');
  assert.equal(ultimaFila(t).estado, 'imprimiendo');
});

test('R1b: un trabajo terminado (impreso o con error) se cierra sin llamar a la base', async () => {
  const t = await arrancar(montar());
  t.pos.cajaTrabajos = [
    { clave: 'a', id: 'i1', estado: 'impresa', titulo: 'A', error: '', intentos: 1, sinRespuesta: false },
    { clave: 'b', id: 'i2', estado: 'error', titulo: 'B', error: 'sin papel', intentos: 3, sinRespuesta: false },
  ];
  assert.equal(await t.pos.cerrarTrabajoCaja('a'), true);
  assert.equal(await t.pos.cerrarTrabajoCaja('b'), true);
  assert.equal(t.pos.cajaTrabajos.length, 0);
  assert.equal(cancelaciones(t), 0);
});

test('R2: «Enviando…» no se puede cerrar: el botón sigue deshabilitado y el segundo toque no encola OTRO trabajo', async () => {
  let soltarPrimero;
  let n = 0;
  const t = await arrancar(montar({
    interceptar: (c, original) => {
      if (c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'insert' && ++n === 1) {
        return new Promise((r) => { soltarPrimero = () => r(original(c)); });
      }
      return undefined;
    },
  }));
  const primero = t.pos.imprimirCuentaEnCaja();
  await asentar();
  assert.equal(t.pos.cajaEnviando, true);
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'enviando');
  assert.equal(t.pos.puedeCerrarTrabajoCaja(e), false, 'sin X mientras viaja');
  assert.equal(await t.pos.cerrarTrabajoCaja(e.clave), false);
  assert.equal(t.pos.cajaEnviando, true, 'el botón sigue deshabilitado');
  assert.equal(await t.pos.imprimirCuentaEnCaja(), false, 'el segundo toque no hace nada');
  soltarPrimero();
  await primero; await asentar();
  assert.equal(vivos(t).length, 1, 'UN trabajo: un papel en la caja');
  assert.equal(insertsDeImpresion(t).length, 1);
});

test('R2: con la caja imprimiendo (con vida) no hay X; tampoco la acepta la acción', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const e = t.pos.cajaTrabajos[0];
  t.pos.procesarCambioImpresion({ new: { ...t.base.imprimir(e.id, 'imprimiendo') } });
  assert.equal(e.estado, 'imprimiendo');
  assert.equal(t.pos.puedeCerrarTrabajoCaja(e), false);
  assert.equal(await t.pos.cerrarTrabajoCaja(e.clave), false);
  assert.equal(cancelaciones(t), 0);
  assert.equal(t.pos.cajaTrabajos.length, 1);
});

test('1 (POS): un «imprimiendo» que se calla pasa a «sin respuesta» a los 2,5 min, el aviso lo dice, y releer no lo borra; al volver la caja, se corrige', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const e = t.pos.cajaTrabajos[0];
  t.pos.procesarCambioImpresion({ new: { ...t.base.imprimir(e.id, 'imprimiendo') } });     // la caja lo toma… y el PC se cuelga
  assert.equal(e.estado, 'imprimiendo');
  assert.equal(t.relojes.esperando(ESPERA_IMPRIMIENDO).length, 1, 'un reloj vigila el «imprimiendo»');
  assert.equal(t.pos.textoTrabajoCaja(e), 'Imprimiendo en la caja…');
  await t.relojes.disparar(ESPERA_IMPRIMIENDO);
  assert.equal(e.sinRespuesta, true);
  assert.match(t.pos.textoTrabajoCaja(e), /La caja se calló mientras imprimía.*usa «Imprimir» de este teléfono y se cancela el de la caja/);
  assert.ok(t.supabase.rpcs('impresora_estado').length >= 2, 'y de paso vuelve a preguntar si la caja está en línea');
  // el respaldo de lectura cada pocos segundos (sigue «imprimiendo» en la base) NO lo vuelve a poner «Imprimiendo…»
  await t.pos._refrescarImpresiones();
  assert.equal(e.sinRespuesta, true, 'releer lo mismo no es una señal de vida');
  assert.equal(t.pos.puedeCerrarTrabajoCaja(e), true, 'ahora sí se puede quitar (cancelando)');
  // vuelve el PC: la base lo entrega otra vez (intentos + 1) y el aviso se corrige solo
  t.base.imprimir(e.id, 'imprimiendo');
  await t.pos._refrescarImpresiones();
  assert.equal(e.sinRespuesta, false);
  assert.equal(e.intentos, 2);
  assert.equal(t.pos.textoTrabajoCaja(e), 'Imprimiendo en la caja…');
  t.base.imprimir(e.id, 'impresa');
  await t.pos._refrescarImpresiones();
  assert.equal(t.pos.textoTrabajoCaja(e), 'Impreso en la caja');
});

test('1 (POS): cancelar un «imprimiendo» sin respuesta: la base lo deja si lleva más de 2 min trabado; el teléfono imprime sin copia doble', async () => {
  const t = await arrancar(montar());
  await t.pos.imprimirCuentaEnCaja();
  const e = t.pos.cajaTrabajos[0];
  t.pos.procesarCambioImpresion({ new: { ...t.base.imprimir(e.id, 'imprimiendo') } });
  await t.relojes.disparar(ESPERA_IMPRIMIENDO);
  ultimaFila(t).trabado = true;                              // en la base: más de 2 minutos sin confirmar
  t.pos.imprimirPreCuenta();
  await t.relojes.disparar(60);
  assert.equal(cancelaciones(t), 1);
  assert.equal(ultimaFila(t).error, 'cancelada');
  assert.equal(vivos(t).length, 0);
  assert.deepEqual(plano(t.pos.cajaTrabajos), []);
});

test('4: una cuenta que no cabe en la caja NO se recorta (se perdería el TOTAL): no se manda y el teléfono la imprime entera', async () => {
  // 12 líneas fijas + 3 por plato con nota y cantidad > 1: 96 platos son 300 líneas (el tope) y 97 pasan.
  const platos = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, nombre: `Plato ${i}`, precio: 10000, qty: 2, nota: 'sin cebolla' }));
  const justo = await arrancar(montar({ items: platos(96) }));
  assert.equal(await justo.pos.imprimirCuentaEnCaja(), true);
  const doc = plano([...justo.base.impresiones.values()].at(-1).contenido);
  assert.equal(doc.lineas.length, 300);
  assert.ok(doc.lineas.some((l) => l.texto === 'TOTAL'), 'el que cabe llega con su TOTAL');
  assert.equal(doc.lineas.at(-1).alinear, 'centro', 'y con el pie al final (la última línea del documento)');

  const largo = await arrancar(montar({ items: platos(97) }));
  assert.equal(await largo.pos.imprimirCuentaEnCaja(), false, 'no queda en la cola: ya no dice «Impreso» de una cuenta a medias');
  assert.deepEqual(insertsDeImpresion(largo), [], 'nada se insertó');
  await largo.relojes.disparar(60);
  assert.deepEqual(largo.impresiones, ['imprimirPreCuenta', 'imprimir'], 'el teléfono imprime la cuenta completa, como siempre');
  assert.match(largo.pos.aviso.texto, /El ticket es demasiado largo para la caja\. Se imprime desde este teléfono\./);
  assert.deepEqual(plano(largo.pos.cajaTrabajos), [], 'sin avisos colgados');
  // y lo que va a ese papel del teléfono es la cuenta entera, con su TOTAL
  assert.ok(largo.pos.documentoTicket(largo.pos.ticketMostrado, 'cuenta').lineas.some((l) => l.texto === 'TOTAL'));
});
