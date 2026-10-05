// Los bordes que quedaban de «imprimir siempre en la caja» (tarea/pulido-bordes, sobre f32577d). Cuatro hallazgos de las refutaciones de la integración
// impresion-defecto + escritorio-scroll y de la rama que se descartó (tarea/integracion-impresion-promo):
//
//   B2  «Recargar» (el aviso de versión) recargaba ENCIMA del envío a la caja del ticket de un cobro: el papel solo vive en memoria mientras viaja, y el
//       ticket no salía ni en la caja ni en el teléfono. Un papel en vuelo cuenta ahora como «cambio sin guardar» (la recarga espera, como con un delta) y
//       un ticket sin resolver cuenta como «algo empezado» (la recarga no se hace sola).
//   B3  El ticket de un cobro o un abono cuyo envío falla DESPUÉS de que el mesero tocó «Volver»: antes se le traía la pantalla de vuelta a los 10 s (aunque
//       atendiera otra mesa) y se cancelaba el trabajo tardío —también el que SÍ había llegado a la cola, cuya respuesta solo era lenta—. Ahora: un trabajo
//       que llegó a la cola NO se cancela (sale en la caja y el aviso lo sigue); si no se sabe, queda «dudoso» y se vigila su respuesta tardía; si no llegó,
//       el aviso ofrece «Imprimir desde este teléfono» con la orden CONFIRMADA (no la cuenta abierta de ahora).
//   B4  «En cola…»: ese mismo papel ya en cola (también «dudoso») no se vuelve a pedir desde la pregunta, y el tope de trabajos recordados no borra lo que sigue
//       en cola (el botón se reactivaba y pedirlo otra vez sacaba dos papeles). Esto último ya lo cerraba impresion-defecto: aquí se fija con los estados nuevos.
//
// Ronda 1 de la refutación (r1, al final del archivo): «Recargar ahora» no recarga encima de un ticket sin resolver (dudoso con su insert en vuelo, error o caja que no
// responde); el ticket de un cobro que SÍ entró a la cola y cuya caja no responde también se puede imprimir desde el teléfono con el mesero fuera; un «dudoso» arma
// solo su respaldo de lectura; y «Deshacer» un cobro revoca el aviso de su ticket (y cancela lo que quedó en la cola).
//
// Corre el <script> REAL de pos.html en un `vm` (_pos-vm.mjs) contra la base falsa con la cola de impresión. La pantalla (el aviso compacto con un diálogo
// abierto, la rejilla de escritorio) se mide en navegador en pulido-bordes-aviso-navegador.test.mjs y pos-orden-escritorio.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asentar, crearBaseFalsa, crearPos, mesaBase, ordenBase, plano } from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const CAJA = { id: 'impresora-1', nombre: 'Caja', en_linea: true, ultimo_latido: new Date().toISOString(), version_agente: '1.0.0' };
const PEDIDO = () => [
  { id: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, qty: 2, nota: 'Sopa · Pollo' },
  { id: 'en1', nombre: 'Empanadas de la casa', precio: 16000, qty: 1, nota: '' },
  { id: 'be1', nombre: 'Limonada de coco', precio: 13000, qty: 3, nota: '' },
];
const TOPE_ENVIO = 10000;
const ESPERA_IMPRIMIENDO_MS = 150000;     // (pos.html) una impresión que la caja tomó y no termina: «se calló»
const VIEJA = '2026.10.02-1111111';
const NUEVA = '2026.10.04-2222222';

/** Relojes espía: lo pendiente se dispara a mano, salvo la espera corta de «Recargar» (5 ms), que corre de verdad. */
function relojesEspia() {
  const pendientes = [];
  let n = 0;
  return {
    pendientes,
    setTimeout: (fn, ms, ...a) => { if (ms === 5) return setTimeout(fn, ms, ...a); const id = ++n; pendientes.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const i = pendientes.findIndex((p) => p.id === id); if (i >= 0) pendientes.splice(i, 1); else clearTimeout(id); },
    setInterval: () => 0, clearInterval: () => {},
    async disparar(ms) { for (const p of pendientes.filter((x) => x.ms === ms)) { this.clearTimeout(p.id); await p.fn(); } await asentar(); },
  };
}

/** Un POS con sesión, la caja en línea y la mesa 3 abierta; con un `fetch` y un `location` de mentira para «Recargar». */
function montar({ interceptar, items = PEDIDO(), mesa5 = false, rol = 'mesero', olaC = false } = {}) {
  const base = crearBaseFalsa({
    rol, olaC, impresoras: [CAJA],
    mesas: mesa5 ? [mesaBase(3), mesaBase(5)] : [mesaBase(3)],
    ordenes: mesa5 ? [ordenBase('o1', 3, items), ordenBase('o5', 5, [{ id: 'bp1', nombre: 'Bandeja de la mesa 5', precio: 55000, qty: 1, nota: '' }])] : [ordenBase('o1', 3, items)],
  });
  if (interceptar) { const original = base.responder; base.responder = async (c) => (interceptar(c, original) ?? original(c)); }
  const relojes = relojesEspia();
  const red = { recargas: 0, version: NUEVA };
  const fetchFalso = () => Promise.resolve({
    ok: true, status: 200,
    json: async () => ({ version: red.version, fecha: '2026-10-04', huella: 'x' }),
    body: { getReader: () => { let n = 3; return { read: async () => (n-- > 0 ? { done: false, value: new Uint8Array(4) } : { done: true, value: undefined }) }; } },
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  const extras = {
    setTimeout: relojes.setTimeout, clearTimeout: relojes.clearTimeout, setInterval: relojes.setInterval, clearInterval: relojes.clearInterval,
    fetch: fetchFalso,
    location: { href: 'http://127.0.0.1/pos.html', origin: 'http://127.0.0.1', search: '', hash: '', pathname: '/pos.html', reload() { red.recargas++; } },
  };
  const documento = {
    title: 'Resplandor — POS', visibilityState: 'visible',
    querySelector: (sel) => (sel.includes('resplandor-version') ? { content: VIEJA } : null),
    querySelectorAll: () => [],
  };
  const t = crearPos({ base, extras, documento });
  t.base = base; t.relojes = relojes; t.red = red;
  t.pos.usuario = YO;
  t.telefono = [];                                        // lo que cae al papel de ESTE teléfono
  const telReal = t.pos.imprimirEnTelefono.bind(t.pos);
  t.pos.imprimirEnTelefono = () => { t.telefono.push('ticket'); return telReal(); };
  t.pos.imprimir = () => { t.telefono.push('window.print'); };
  t.pos._esperaRecargaPasos = 3; t.pos._esperaRecargaMs = 5;
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
const esInsert = (c) => c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'insert';
/** El insert nunca contesta ni llega a la base (red caída a medias): salta el tope de 10 s y el trabajo no existe. */
const cuelgaElInsert = (c) => (esInsert(c) ? new Promise(() => {}) : undefined);
/** El insert llega tarde (red lenta): ni la base lo ve ni contesta hasta que la prueba llama a `soltar()`. */
function insertLento() {
  const x = { soltar: null };
  x.interceptar = (c, original) => (esInsert(c) ? new Promise((r) => { x.soltar = async () => r(await original(c)); }) : undefined);
  return x;
}
/** El insert LLEGA a la base y está en la cola, pero su respuesta tarda: la prueba la suelta con `contestar()`. (El caso de la refutación: «un ticket que sí
 *  entró a la cola pero cuya respuesta tarda más de 10 s».) */
function respuestaLenta() {
  const x = { contestar: null };
  x.interceptar = (c, original) => {
    if (!esInsert(c)) return undefined;
    const llega = original(c);                                         // la base lo recibe YA
    return new Promise((r) => { x.contestar = async () => r(await llega); });
  };
  return x;
}
/** El insert entró a la base y la respuesta nunca llega, y la lectura de verificación también se cae: el teléfono no puede saber que el trabajo existe
 *  (`caida.lectura = false` la repone). Es el «dudoso» de verdad con el trabajo ya en la cola. */
function llegoPeroNadieContesta() {
  const x = { lecturaCaida: true };
  x.interceptar = (c, original) => {
    if (esInsert(c)) { original(c); return new Promise(() => {}); }
    if (x.lecturaCaida && c.tipo === 'from' && c.tabla === 'impresiones' && c.op === 'select') return { data: null, error: { message: 'TypeError: Failed to fetch' } };
    return undefined;
  };
  return x;
}
/** El insert falla DESPUÉS de que la prueba lo suelte (con lo que se le pase): para que falle cuando el mesero ya tocó «Volver», no antes. */
function falloTardio() {
  const x = { soltar: null, usado: false };
  x.interceptar = (c, original) => {
    if (!esInsert(c) || x.usado) return undefined;                     // solo el primer insert: un reintento pasa tal cual
    x.usado = true;
    return new Promise((r) => { x.soltar = async (resultado) => r(typeof resultado === 'function' ? await resultado(original, c) : resultado); });
  };
  return x;
}
const cancelaciones = (t) => t.supabase.rpcs('impresion_cancelar').length;
const filas = (t) => [...t.base.impresiones.values()];
/** El mesero confirma «Imprimir» en el ticket de un cobro, confía en la caja y toca «Volver». */
async function cobrarConfirmarYVolver(t) {
  t.pos.facturar();                                                    // «Generar ticket y cobrar»
  assert.equal(await t.pos.pedirImpresion('ticket'), true);
  const envio = t.pos.aceptarImpresion();
  await asentar();
  assert.equal(t.pos.cajaTrabajos[0]?.estado, 'enviando');
  t.pos.volverDeTicket();
  await asentar();
  return { envio };                                                    // en un objeto: una función async que devolviera la promesa del envío la esperaría
}

// ═════════════════════════ B2 · «Recargar» y el papel en vuelo ═════════════════════════

test('B2 · un papel que viaja a la caja cuenta como «sin guardar»: la recarga espera mientras vuela, y deja de esperar cuando terminó (llegó o falló)', async () => {
  const t = await arrancar(montar({ interceptar: cuelgaElInsert }));
  assert.equal(t.pos._hayCambiosSinGuardar(), false, 'antes de mandar, nada');
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  assert.equal(t.pos.cajaEnviando, true);
  assert.equal(t.pos._hayCambiosSinGuardar(), true, 'el insert sigue en vuelo: solo vive en memoria');
  assert.equal(await t.pos._esperarCambiosSinGuardar(), false, '«Recargar» no recarga encima de un envío en vuelo');
  await t.relojes.disparar(TOPE_ENVIO);                                // pasan 10 s: el envío se da por fallido
  await envio;
  assert.equal(t.pos.cajaEnviando, false);
  assert.equal(t.pos._hayCambiosSinGuardar(), false, 'ya no viaja');
  assert.equal(await t.pos._esperarCambiosSinGuardar(), true);
});

test('B2 · «Recargar» de punta a punta: con el ticket de un cobro todavía viajando NO recarga (la franja dice que está guardando); cuando termina, recarga solo si el ticket no quedó sin resolver', async () => {
  const lento = respuestaLenta();
  const t = await arrancar(montar({ interceptar: lento.interceptar }));
  t.pos._vigilarVersion();
  await asentar();
  assert.equal(t.pos.hayVersionNueva, true);
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  assert.equal(t.pos.cajaEnviando, true);
  // El mesero toca «Recargar» con el papel en vuelo.
  await t.pos.recargarVersionNueva();
  assert.equal(t.red.recargas, 0, 'no recarga encima del envío: el ticket no saldría ni en la caja ni en el teléfono');
  assert.match(t.pos.versionRecargaNota, /guardando|Guardando/i, 'y la franja lo dice');
  // El insert contesta: el ticket quedó en la cola de la caja. Ahora sí se puede recargar.
  await lento.contestar();
  assert.equal(await envio, true);
  assert.equal(t.pos.cajaEnviando, false);
  await t.pos.recargarVersionNueva();
  assert.equal(t.red.recargas, 1, 'con el papel ya en la cola de la caja, recarga');
});

test('B2 · un ticket sin resolver (no se sabe si llegó, o no llegó) cuenta como «algo empezado»: la recarga no se hace sola y espera el toque de «Recargar ahora»; resuelto, deja de contar', async () => {
  const t = await arrancar(montar({ interceptar: cuelgaElInsert }));
  t.pos._vigilarVersion();
  await asentar();
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'dudoso');
  assert.equal(t.pos._hayTicketSinResolver(), true);
  const ctl = () => ({ empezo: false, actividad: false, vista: t.pos.vista });
  assert.equal(t.pos._empezoAlgoDesdeElToque(ctl()), true, 'la franja de la versión nueva espera el toque explícito');
  assert.equal(t.pos._hayCambiosSinGuardar(), false, 'pero no es algo que se espere a guardar: lo resuelve la persona');
  // De punta a punta: baja la versión y NO recarga sola (hay un ticket que solo vive en memoria).
  await t.pos.recargarVersionNueva();
  assert.equal(t.red.recargas, 0, 'no recarga encima de un ticket sin resolver');
  assert.equal(t.pos.versionListaParaRecargar, true, 'la franja pasa a «La versión nueva está lista»');
  // Resuelto desde el teléfono, ya no cuenta.
  t.pos.imprimirAquiTrabajoCaja(e);
  await asentar();
  await t.relojes.disparar(60);
  assert.equal(t.pos._hayTicketSinResolver(), false);
  assert.equal(t.pos._empezoAlgoDesdeElToque({ ...ctl(), vista: 'ticket' }), false, 'resuelto: nada que proteger (misma vista, sin diálogos)');
});

// ═════════════════════════ B3 · el ticket que falla después de «Volver» ═════════════════════════

test('B3 · el insert SÍ llegó a la cola pero su respuesta tarda más de 10 s y el mesero ya tocó «Volver»: NO se cancela, sale en la caja y el aviso lo sigue (el caso a medias de la rama descartada)', async () => {
  const lento = respuestaLenta();
  const t = await arrancar(montar({ interceptar: lento.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  assert.equal(filas(t).length, 1, 'la base ya lo tiene: es el caso de una respuesta lenta, no de un insert perdido');
  await t.relojes.disparar(TOPE_ENVIO);                                // pasan 10 s sin respuesta
  const r = await envio;
  assert.equal(r, true, 'se mira en la base y el trabajo está: es uno más de la cola');
  assert.equal(cancelaciones(t), 0, 'NO se cancela nada: antes el teléfono no imprimía y el trabajo se cancelaba, y no salía ningún papel');
  assert.equal(filas(t)[0].estado, 'pendiente', 'sigue vivo en la cola: el PC de la caja lo imprime');
  assert.deepEqual(t.telefono, [], 'y el teléfono no imprime otra copia');
  assert.equal(t.pos.vista, 'mesas', 'ni se le cambia la pantalla');
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'pendiente', 'el aviso lo sigue: «En cola en la caja…»');
  assert.equal(t.pos.textoTrabajoCaja(e), 'En cola en la caja…');
  // La caja lo imprime y el aviso lo sigue hasta «Impreso».
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(e.id, 'imprimiendo'), old: {} });
  assert.equal(t.pos.cajaTrabajos[0].estado, 'imprimiendo');
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(e.id, 'impresa'), old: {} });
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa');
  // La respuesta tardía por fin llega: no cambia nada (ya se sabía).
  await lento.contestar(); await asentar();
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa');
  assert.equal(cancelaciones(t), 0);
});

test('B3 · el insert llegó y la RESPUESTA se perdió después de «Volver» (sin `code`, como un corte de red): se mira en la base y el trabajo SÍ está → sale en la caja, sin cancelar, sin papel de más', async () => {
  const x = falloTardio();
  const t = await arrancar(montar({ interceptar: x.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await x.soltar(async (original, c) => { await original(c); return { data: null, error: { message: 'TypeError: Failed to fetch' } }; });   // entró, y la respuesta se corta
  assert.equal(await envio, true, 'el trabajo está en la base: es uno más de la cola');
  assert.equal(cancelaciones(t), 0);
  assert.equal(filas(t)[0].estado, 'pendiente');
  assert.equal(t.pos.cajaTrabajos[0].estado, 'pendiente');
  assert.deepEqual(t.telefono, []);
  assert.equal(t.pos.vista, 'mesas');
});

test('B3 · no se sabe si llegó (ni el insert ni la lectura contestan): «dudoso», sin cancelar; si el insert llega después, entra a la cola y el aviso lo sigue (nunca se cancela lo que llegó)', async () => {
  const lento = insertLento();
  const t = await arrancar(montar({ interceptar: lento.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  const r = await envio;
  assert.equal(r, false);
  assert.equal(r === false && t.pos.cajaTrabajos[0].estado, 'dudoso');
  assert.equal(cancelaciones(t), 0, 'ni un intento de cancelar: nadie va a imprimir desde el teléfono');
  assert.deepEqual(t.telefono, []);
  assert.equal(t.pos.vista, 'mesas');
  // El insert por fin llega a la base y contesta.
  await lento.soltar(); await asentar(); await asentar();
  assert.equal(filas(t).length, 1);
  assert.equal(filas(t)[0].estado, 'pendiente', 'el trabajo que llegó NO se cancela');
  assert.equal(cancelaciones(t), 0);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'pendiente', 'el aviso pasó de «dudoso» a «En cola…»: lo sigue');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(t.pos.cajaTrabajos[0]), false, 'y ya no hace falta ofrecer el teléfono: está en la cola y la caja responde');
});

test('B3 · «dudoso» que Realtime o el respaldo de lectura encuentran: pasa a la cola con su reloj de «la caja no responde» y sigue hasta «Impreso»', async () => {
  const x = llegoPeroNadieContesta();
  const t = await arrancar(montar({ interceptar: x.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  assert.equal(await envio, false);
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'dudoso', 'ni la respuesta ni la lectura contestaron: no se sabe');
  assert.equal(cancelaciones(t), 0);
  // El respaldo de lectura (la red volvió) lo encuentra en la base.
  x.lecturaCaida = false;
  await t.pos._refrescarImpresiones();
  await asentar();
  assert.equal(t.pos.cajaTrabajos[0].estado, 'pendiente', 'la base lo tiene: entró a la cola');
  assert.equal(t.relojes.pendientes.some((p) => p.ms === 25000), true, 'armó su reloj de «la caja no responde» (25 s) como cualquier trabajo de la cola');
  // Realtime: la caja lo imprime y el aviso lo sigue hasta «Impreso», y suelta la orden que guardaba.
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(e.id, 'imprimiendo'), old: {} });
  assert.equal(t.pos.cajaTrabajos[0].estado, 'imprimiendo');
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(e.id, 'impresa'), old: {} });
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa');
  assert.equal(t.pos.cajaTrabajos[0].orden, undefined, 'y ya no guarda la orden: salió');
  assert.equal(cancelaciones(t), 0);
});

test('B3 · «dudoso» que Realtime alcanza ANTES de que la lectura conteste (la fila llega por el canal): también pasa a «imprimiendo»/«Impreso» sin tocar nada más', async () => {
  const x = llegoPeroNadieContesta();
  const t = await arrancar(montar({ interceptar: x.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'dudoso');
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(e.id, 'impresa'), old: {} });
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa', 'Realtime trae la fila: ya no es dudoso');
  assert.equal(t.pos._hayTicketSinResolver(), false);
});

test('B3 · no llegó (la base lo rechazó después de «Volver»): el aviso queda en «error» con la orden CONFIRMADA y «Imprimir desde este teléfono»; «Reintentar» manda el mismo ticket y reemplaza al aviso', async () => {
  const x = falloTardio();
  const t = await arrancar(montar({ interceptar: x.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await x.soltar({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "impresiones"' } });
  assert.equal(await envio, false);
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'error');
  assert.equal(e.orden.id, 'o1');
  assert.match(t.pos.textoTrabajoCaja(e), /No salió ningún papel: imprime el ticket desde este teléfono\./);
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), true);
  assert.deepEqual(t.telefono, [], 'no sale nada solo');
  assert.equal(t.pos.vista, 'mesas');
  assert.equal(cancelaciones(t), 0);
  // «Reintentar» (la base ya deja): el mismo ticket entra a la cola y el aviso viejo se va.
  assert.equal(await t.pos.reintentarImpresion(e.clave), true);
  assert.equal(t.pos.cajaTrabajos.length, 1, 'un solo aviso: el nuevo reemplaza al viejo');
  assert.equal(t.pos.cajaTrabajos[0].estado, 'pendiente');
  assert.equal(filas(t).length, 1);
  assert.equal(plano(filas(t)[0].contenido.lineas.find((l) => l.texto === 'TOTAL')).der, '$ 97.000');
});

test('B3 · el reintento que vuelve a fallar con el mesero fuera conserva la orden confirmada en el aviso nuevo (no deja dos avisos ni la pierde)', async () => {
  const x = falloTardio();
  const t = await arrancar(montar({ interceptar: x.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await x.soltar({ data: null, error: { code: '42501', message: 'permiso' } });
  await envio;
  const e = t.pos.cajaTrabajos[0];
  t.base.impresionRechazo = { code: '42501', message: 'permiso' };     // el reintento también lo rechaza
  assert.equal(await t.pos.reintentarImpresion(e.clave), false);
  assert.equal(t.pos.cajaTrabajos.length, 1);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'error');
  assert.equal(t.pos.cajaTrabajos[0].orden.id, 'o1', 'sigue pudiendo imprimirse desde el teléfono');
  assert.notEqual(t.pos.cajaTrabajos[0].clave, e.clave);
});

test('B3 · «Imprimir desde este teléfono» saca la orden CONFIRMADA, no la cuenta abierta de ahora: el mesero ya abrió la mesa 3 otra vez y agregó otra cosa', async () => {
  const lento = insertLento();
  const t = await arrancar(montar({ interceptar: lento.interceptar }));
  t.pos.facturar();
  const total = t.pos.ordenActiva.total;
  assert.equal(total, 97000);
  const { envio } = await (async () => { await t.pos.pedirImpresion('ticket'); const e = t.pos.aceptarImpresion(); await asentar(); t.pos.volverDeTicket(); await asentar(); return { envio: e }; })();
  // La mesa 3 queda libre tras el cobro: la abre otra vez y le agrega algo (la cuenta ABIERTA de ahora no es la que se cobró).
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 3));
  await asentar();
  t.pos.ordenActiva.items.push({ id: 'be9', nombre: 'Jugo de mora', precio: 7000, qty: 1, nota: '' });
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'dudoso');
  t.pos.imprimirAquiTrabajoCaja(e);
  await asentar();
  await t.relojes.disparar(60);
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ordenTicket.id, 'o1', 'la orden cerrada que se cobró…');
  assert.equal(t.pos.ordenTicket.estado, 'cerrada');
  assert.equal(t.pos.ordenTicket.total, 97000, '…con SU total (no el de la cuenta de ahora)');
  assert.equal(t.pos.ordenTicket.items.some((i) => i.id === 'be9'), false, 'sin lo que se agregó después');
  assert.deepEqual(t.telefono, ['ticket', 'window.print']);
});

test('B3 · si el trabajo «dudoso» ya lo tomó la caja cuando la persona toca el teléfono, NO se imprime aquí (saldría doble): el aviso lo sigue', async () => {
  const x = llegoPeroNadieContesta();
  const t = await arrancar(montar({ interceptar: x.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'dudoso');
  // La caja ya lo está imprimiendo, pero ni la respuesta ni Realtime ni la lectura le han contado nada al teléfono.
  t.base.imprimir(filas(t)[0].id, 'imprimiendo');
  t.pos.imprimirAquiTrabajoCaja(e);
  await asentar();
  await asentar();
  await t.relojes.disparar(60);
  assert.deepEqual(t.telefono, [], 'la caja ya lo tiene en las manos: no sale una segunda copia desde el teléfono');
  assert.equal(t.pos.vista, 'mesas', 'ni se le cambia la pantalla');
  assert.match(t.pos.aviso.texto, /La caja ya recibió el ticket: sale allí\./);
  assert.equal(t.pos.cajaTrabajos[0].estado, 'pendiente', 'el aviso lo sigue desde ahora (su lectura traerá «imprimiendo»/«Impreso»)');
  assert.equal(filas(t)[0].estado, 'imprimiendo', 'y no se canceló nada');
});

test('B3 · cerrar (✕) el aviso de un ticket «dudoso» solo lo deja de mostrar: no cancela nada en la caja (lo que llegue, sale)', async () => {
  const t = await arrancar(montar({ interceptar: cuelgaElInsert }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  const e = t.pos.cajaTrabajos[0];
  assert.equal(t.pos.puedeCerrarTrabajoCaja(e), true);
  assert.equal(await t.pos.cerrarTrabajoCaja(e.clave), true);
  assert.equal(t.pos.cajaTrabajos.length, 0);
  assert.equal(cancelaciones(t), 0);
});

test('B3 · con el mesero todavía en la pantalla del ticket nada cambia: a los 10 s el teléfono imprime solo (cancelando antes lo que pudiera llegar tarde)', async () => {
  const t = await arrancar(montar({ interceptar: cuelgaElInsert }));
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  await t.relojes.disparar(TOPE_ENVIO);
  assert.equal(await envio, false);
  assert.deepEqual(t.telefono, ['ticket', 'window.print']);
  assert.match(t.pos.aviso.texto, /No se pudo mandar el ticket a la caja\. Se imprime desde este teléfono\./);
  assert.ok(cancelaciones(t) >= 1);
  assert.equal(t.pos.cajaTrabajos.length, 0, 'no queda un aviso: el teléfono ya resolvió');
});

test('B3 · una PRECUENTA sí se puede volver a pedir: con el mesero fuera no guarda ninguna orden ni ofrece el teléfono; el aviso dice «pídela de nuevo»', async () => {
  const t = await arrancar(montar({ interceptar: cuelgaElInsert }));
  await t.pos.pedirImpresion('precuenta');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  t.pos.volverAMesas();
  await t.relojes.disparar(TOPE_ENVIO);
  assert.equal(await envio, false);
  assert.equal(t.pos.cajaTrabajos.length, 0);
  assert.match(t.pos.aviso.texto, /pídela de nuevo/);
  assert.deepEqual(t.telefono, []);
});

// ═════════════════════════ B4 · «En cola…» y el tope de trabajos ═════════════════════════

test('B4 · un trabajo «dudoso» cuenta como en cola: la pregunta del mismo papel dice «En cola…» y «Imprimir en la caja» no manda otra copia', async () => {
  const t = await arrancar(montar({ interceptar: cuelgaElInsert }));
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;                                                         // el mesero sigue en el ticket: sale por el teléfono, el aviso se va
  // Con el mesero fuera: queda «dudoso».
  const u = await arrancar(montar({ interceptar: cuelgaElInsert }));
  const { envio: envio2 } = await cobrarConfirmarYVolver(u);
  await u.relojes.disparar(TOPE_ENVIO);
  await envio2;
  const e = u.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'dudoso');
  assert.equal(u.pos.trabajoEnCola(e.alcance), true);
  // Vuelve a ese ticket (por el historial) y pide imprimir otra vez: la pregunta ya sabe que ese papel está en cola.
  u.pos.mesaActiva = u.pos.mesas.find((m) => m.id === 3);
  u.pos.ordenActiva = u.pos.ordenes.find((o) => o.id === 'o1');
  u.pos.vista = 'ticket';
  assert.equal(u.pos.alcanceTicket, e.alcance);
  assert.equal(await u.pos.pedirImpresion('ticket'), false, 'el botón del ticket está apagado: no abre otra pregunta del mismo papel');
  assert.equal(u.base.impresiones.size, 0);
});

test('B4 · el tope de trabajos recordados nunca borra lo que sigue en cola o sin resolver (ni «dudoso»): solo se olvida lo ya IMPRESO, el más viejo primero', async () => {
  const t = await arrancar(montar());
  const unos = (estado, n, desde = 0) => Array.from({ length: n }, (_, i) => ({ clave: `${estado}-${desde + i}`, id: `${estado}-${desde + i}`, tipo: 'cuenta', titulo: 'x', estado, alcance: `a:${estado}-${desde + i}` }));
  // El más viejo sigue en cola y hay 11 más: un `slice(-10)` ciego lo borraba (y su botón volvía a «Imprimir en la caja»).
  t.pos.cajaTrabajos = [...unos('pendiente', 1), ...unos('dudoso', 1), ...unos('impresa', 9)];
  const lista = t.pos._acotarTrabajosCaja([...t.pos.cajaTrabajos, ...unos('enviando', 1, 50)]);
  assert.equal(lista.length, 11 - 1, 'sale UNO: el impreso más viejo');
  assert.equal(lista.some((e) => e.clave === 'impresa-0'), false, 'el impreso más viejo se olvida');
  assert.equal(lista.some((e) => e.clave === 'pendiente-0'), true, 'el más viejo, que sigue en cola, se queda');
  assert.equal(lista.some((e) => e.clave === 'dudoso-0'), true, 'y el dudoso también');
  // Sin nada impreso que olvidar no se borra nada, aunque pase del tope.
  const todos = [...unos('pendiente', 8), ...unos('dudoso', 2), ...unos('enviando', 1, 50)];
  assert.equal(t.pos._acotarTrabajosCaja(todos).length, 11, 'la lista pasa del tope y nadie desaparece');
  // …y su botón sigue apagado.
  t.pos.cajaTrabajos = todos;
  assert.equal(t.pos.trabajoEnCola('a:pendiente-0'), true);
  assert.equal(t.pos.trabajoEnCola('a:dudoso-0'), true);
});

// ═════════════════════════ el aviso compacto con un diálogo abierto (lógica) ═════════════════════════

test('B1 · con un diálogo abierto el aviso de la caja se reduce a UNA fila (la que más urge: error o «dudoso» primero) con «y N más»; sin diálogo, todos', async () => {
  const t = await arrancar(montar());
  const fila = (clave, estado, extra = {}) => ({ clave, id: clave, tipo: 'cuenta', titulo: 'Cuenta · ' + clave, estado, alcance: 'a:' + clave, sinRespuesta: false, ...extra });
  t.pos.cajaTrabajos = [fila('uno', 'pendiente', { sinRespuesta: true }), fila('dos', 'pendiente', { sinRespuesta: true }), fila('tres', 'pendiente', { sinRespuesta: true })];
  assert.equal(t.pos.modalAbierto, false);
  assert.equal(t.pos.trabajosCajaVista.length, 3);
  assert.equal(t.pos.trabajosCajaOcultos, 0);
  t.pos.confirmaImpresion = { que: 'precuenta', persona: '', destino: 'caja', alcance: 'cuenta:o1:', titulo: 'Imprimir precuenta', pregunta: '¿?', resumen: '', boton: 'Imprimir en la caja' };
  assert.equal(t.pos.modalAbierto, true);
  assert.equal(t.pos.trabajosCajaVista.length, 1, 'una sola fila mientras hay un diálogo');
  assert.equal(t.pos.trabajosCajaOcultos, 2, '«y 2 más»');
  // La que más urge: un error (o un «dudoso») antes que los que solo esperan.
  t.pos.cajaTrabajos = [fila('uno', 'pendiente', { sinRespuesta: true }), fila('dos', 'error', { error: 'sin papel' }), fila('tres', 'pendiente')];
  assert.equal(t.pos.trabajosCajaVista[0].clave, 'dos');
  t.pos.cajaTrabajos = [fila('uno', 'dudoso'), fila('dos', 'pendiente', { sinRespuesta: true })];
  assert.equal(t.pos.trabajosCajaVista[0].clave, 'uno');
  t.pos.cajaTrabajos = [fila('solo', 'pendiente')];
  assert.equal(t.pos.trabajosCajaVista.length, 1);
  assert.equal(t.pos.trabajosCajaOcultos, 0, 'con uno solo no hay «y N más»');
  t.pos.confirmaImpresion = null;
  assert.equal(t.pos.modalAbierto, false);
});

// ═════════════════════════ r1 · ronda 1 de la refutación ═════════════════════════

/** Deja la versión nueva «lista» (bajada) y devuelve el POS: la franja ofrece «Recargar ahora». */
async function conVersionLista(t) {
  t.pos._vigilarVersion();
  await asentar();
  assert.equal(t.pos.hayVersionNueva, true);
  return t;
}
const ticketSinImprimir = /Hay un ticket sin imprimir: recargar borraría su aviso/;

test('r1 · «Recargar ahora» NO recarga encima de un ticket «dudoso» con su insert todavía en vuelo: lo dice, y recarga cuando el ticket ya se resolvió', async () => {
  const lento = insertLento();
  const t = await conVersionLista(await arrancar(montar({ interceptar: lento.interceptar })));
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'dudoso');
  assert.equal(typeof lento.soltar, 'function', 'el insert REAL sigue en vuelo');
  // 1er toque: baja la versión y, con un ticket sin resolver, no recarga sola.
  await t.pos.recargarVersionNueva();
  assert.equal(t.red.recargas, 0);
  assert.equal(t.pos.versionListaParaRecargar, true, '«La versión nueva está lista»');
  // 2º toque («Recargar ahora»): un toque explícito, pero NO recarga encima del ticket: se llevaría el insert en vuelo y la orden confirmada del aviso.
  await t.pos.recargarVersionNueva();
  assert.equal(t.red.recargas, 0, 'no recarga');
  assert.match(t.pos.versionRecargaNota, ticketSinImprimir, 'y la franja dice por qué');
  assert.equal(t.pos.versionRecargando, false, 'el botón queda libre');
  assert.equal(t.pos.versionListaParaRecargar, true, 'sigue ofreciendo «Recargar ahora»');
  assert.equal(t.pos.cajaTrabajos[0].estado, 'dudoso', 'y el aviso con su orden sigue ahí');
  assert.ok(t.pos.cajaTrabajos[0].orden);
  // La persona lo resuelve (imprime desde el teléfono): ahora sí recarga.
  t.pos.imprimirAquiTrabajoCaja(e);
  await asentar(); await t.relojes.disparar(60);
  assert.equal(t.pos._hayTicketSinResolver(), false);
  await t.pos.recargarVersionNueva();
  assert.equal(t.red.recargas, 1, 'resuelto el ticket, «Recargar ahora» recarga');
});

test('r1 · lo mismo con un ticket en «error» (la base lo rechazó tras «Volver»): «Recargar ahora» no se lleva la única copia de la orden confirmada', async () => {
  const x = falloTardio();
  const t = await conVersionLista(await arrancar(montar({ interceptar: x.interceptar })));
  const { envio } = await cobrarConfirmarYVolver(t);
  await x.soltar({ data: null, error: { code: '42501', message: 'permiso' } });
  await envio; await asentar();
  assert.equal(t.pos.cajaTrabajos[0].estado, 'error');
  await t.pos.recargarVersionNueva();                                  // 1er toque
  await t.pos.recargarVersionNueva();                                  // «Recargar ahora»
  assert.equal(t.red.recargas, 0);
  assert.match(t.pos.versionRecargaNota, ticketSinImprimir);
  // Cerrar el aviso con la ✕ es otra forma de resolverlo (la persona decide perder el papel).
  assert.equal(await t.pos.cerrarTrabajoCaja(t.pos.cajaTrabajos[0].clave), true);
  await t.pos.recargarVersionNueva();
  assert.equal(t.red.recargas, 1);
});

test('r1 · «Recargar ahora» tampoco recarga con un ticket que entró a la cola y cuya caja NO responde (su aviso es la salida), pero sí con la caja respondiendo', async () => {
  const t = await conVersionLista(await arrancar(montar()));
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  assert.equal(await t.pos.aceptarImpresion(), true);
  t.pos.volverDeTicket(); await asentar();
  // En cola y la caja responde (aún no pasaron 25 s): nada que proteger, el papel ya está en la cola.
  assert.equal(t.pos._hayTicketSinResolver(), false);
  await t.pos.recargarVersionNueva();                                  // 1er toque: nadie hizo nada → recarga sola
  assert.equal(t.red.recargas, 1);
  // Pasan 25 s sin que la caja lo tome: ahora el aviso es la única salida.
  const u = await conVersionLista(await arrancar(montar()));
  u.pos.facturar();
  await u.pos.pedirImpresion('ticket');
  await u.pos.aceptarImpresion();
  u.pos.volverDeTicket(); await asentar();
  await u.relojes.disparar(25000);
  assert.equal(u.pos.cajaTrabajos[0].sinRespuesta, true);
  await u.pos.recargarVersionNueva();
  await u.pos.recargarVersionNueva();
  assert.equal(u.red.recargas, 0);
  assert.match(u.pos.versionRecargaNota, ticketSinImprimir);
});

test('r1 · un «dudoso» solo arma su respaldo de lectura: si Realtime no trae la fila y la respuesta del insert se perdió, el aviso pasa a «Impreso» con el reloj de 15 s', async () => {
  const x = llegoPeroNadieContesta();
  const t = await arrancar(montar({ interceptar: x.interceptar }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  assert.equal(t.pos.cajaTrabajos[0].estado, 'dudoso');
  x.lecturaCaida = false;                                              // la red de lectura vuelve
  t.base.imprimir(filas(t)[0].id, 'impresa');                          // la caja lo imprimió (y a este teléfono no le llegó nada por Realtime)
  await t.relojes.disparar(15000);                                     // SOLO el reloj del respaldo de lectura
  assert.equal(t.pos.cajaTrabajos[0]?.estado, 'impresa', 'el respaldo de lectura lo encontró');
  assert.equal(t.pos._hayTicketSinResolver(), false);
  assert.equal(cancelaciones(t), 0);
});

test('r1 · el ticket de un cobro que SÍ entró a la cola y la caja no responde, con el mesero fuera: el aviso ofrece «Imprimir desde este teléfono» con la orden CONFIRMADA (y cancela el de la caja)', async () => {
  const t = await arrancar(montar());
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  assert.equal(await t.pos.aceptarImpresion(), true, 'el insert contestó: el ticket está en la cola');
  t.pos.volverDeTicket(); await asentar();
  assert.equal(t.pos.cajaTrabajos[0].orden.id, 'o1', 'el trabajo trae la orden confirmada desde que entra a la lista');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(t.pos.cajaTrabajos[0]), false, 'mientras la caja responde no hace falta ofrecerlo');
  await t.relojes.disparar(25000);                                     // la caja no lo toma
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.sinRespuesta, true);
  assert.equal(t.pos.vista, 'mesas', 'el mesero ya no está en el ticket (y un mesero no puede volver a un ticket cerrado)');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), true, 'el aviso ofrece el teléfono');
  // Mientras tanto la mesa 3 quedó libre y se abrió otra cuenta: lo que sale es lo que se COBRÓ.
  t.pos.imprimirAquiTrabajoCaja(e);
  await asentar(); await t.relojes.disparar(60);
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ordenTicket.id, 'o1');
  assert.equal(t.pos.ordenTicket.total, 97000);
  assert.deepEqual(t.telefono, ['ticket', 'window.print']);
  assert.equal(filas(t)[0].estado, 'error', 'y el trabajo de la caja se canceló: no sale doble cuando el PC vuelva');
  assert.equal(filas(t)[0].error, 'cancelada');
  assert.equal(t.pos.cajaTrabajos.length, 0, 'el aviso se va');
});

test('r1 · lo mismo con la caja imprimiendo y callada, y con el mesero todavía en ese ticket: se imprime sin rehacer la pantalla', async () => {
  const t = await arrancar(montar());
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  assert.equal(await t.pos.aceptarImpresion(), true);
  const id = filas(t)[0].id;
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(id, 'imprimiendo'), old: {} });
  t.base.impresiones.get(id).trabado = true;                           // (la base falsa solo cancela un «imprimiendo» si lleva más de 2 min)
  await t.relojes.disparar(ESPERA_IMPRIMIENDO_MS);
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'imprimiendo');
  assert.equal(e.sinRespuesta, true);
  assert.equal(t.pos.vista, 'ticket', 'el mesero sigue en el ticket');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), true);
  let alSalon = 0;
  const volverAMesas = t.pos.volverAMesas.bind(t.pos);
  t.pos.volverAMesas = () => { alSalon++; return volverAMesas(); };
  t.pos.imprimirAquiTrabajoCaja(e);
  await asentar();
  assert.equal(alSalon, 0, 'no se rehace la pantalla (no pasa por el salón)');
  assert.deepEqual(t.telefono, ['ticket', 'window.print'], 'imprime ya, sin pasar por el salón');
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ordenTicket.id, 'o1');
});

test('r1 · cuando el ticket se imprimió en la caja el aviso suelta la orden que guardaba (ya no ofrece el teléfono)', async () => {
  const t = await arrancar(montar());
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  await t.pos.aceptarImpresion();
  t.pos.volverDeTicket(); await asentar();
  const id = filas(t)[0].id;
  assert.ok(t.pos.cajaTrabajos[0].orden);
  t.pos.procesarCambioImpresion({ eventType: 'UPDATE', new: t.base.imprimir(id, 'impresa'), old: {} });
  assert.equal(t.pos.cajaTrabajos[0].estado, 'impresa');
  assert.equal(t.pos.cajaTrabajos[0].orden, undefined);
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(t.pos.cajaTrabajos[0]), false);
});

// ── «Deshacer» un cobro revoca el aviso de su ticket ──
const filaDeshecha = (t) => filas(t)[0];

test('r1 · «Deshacer» el cobro con su ticket «dudoso» (insert en vuelo): el aviso se va, no ofrece el teléfono, y el insert que llegue tarde se cancela en la cola', async () => {
  const lento = insertLento();
  const t = await arrancar(montar({ interceptar: lento.interceptar, olaC: true }));
  const { envio } = await cobrarConfirmarYVolver(t);
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.estado, 'dudoso');
  assert.ok(t.pos.ultimoCobro);
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar(); await asentar();
  assert.equal(t.pos.cajaTrabajos.length, 0, 'su aviso ya no existe: no hay botón con el total de un cobro deshecho');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), false);
  assert.deepEqual(t.telefono, []);
  // El insert por fin llega a la base: entra a la cola… y se cancela (no sale en la caja un «cobrado» de un cobro que no existe).
  await lento.soltar(); await asentar(); await asentar(); await asentar();
  assert.equal(filas(t).length, 1);
  assert.equal(filaDeshecha(t).estado, 'error');
  assert.equal(filaDeshecha(t).error, 'cancelada');
});

test('r1 · «Deshacer» el cobro con su ticket en cola (la caja responde o no): se cancela en la caja y el aviso se va', async () => {
  const t = await arrancar(montar({ olaC: true }));
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  assert.equal(await t.pos.aceptarImpresion(), true);
  t.pos.volverDeTicket(); await asentar();
  assert.equal(filas(t)[0].estado, 'pendiente');
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar(); await asentar();
  assert.equal(filaDeshecha(t).estado, 'error', 'cancelado en la cola');
  assert.equal(filaDeshecha(t).error, 'cancelada');
  assert.equal(t.pos.cajaTrabajos.length, 0);
  assert.deepEqual(t.telefono, []);
});

test('r1 · «Deshacer» el cobro mientras su ticket todavía VIAJA («enviando»): al contestar el insert se cancela lo que llegó, sin aviso y sin que el teléfono imprima', async () => {
  const lento = respuestaLenta();
  const t = await arrancar(montar({ interceptar: lento.interceptar, olaC: true }));
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  assert.equal(t.pos.cajaTrabajos[0].estado, 'enviando');
  assert.equal(await t.pos.deshacerUltimoCobro(), true);               // la lleva a la cuenta de la mesa: ya no está en el ticket
  assert.equal(t.pos.cajaTrabajos[0].estado, 'enviando', 'sigue viajando (nada que cancelar todavía)');
  assert.equal(t.pos.cajaTrabajos[0].orden, undefined, 'pero ya no guarda la orden del cobro deshecho');
  await lento.contestar();
  assert.equal(await envio, false);
  await asentar(); await asentar();
  assert.equal(t.pos.cajaTrabajos.length, 0);
  assert.equal(filaDeshecha(t).estado, 'error');
  assert.equal(filaDeshecha(t).error, 'cancelada', 'lo que llegó a la cola se canceló');
  assert.deepEqual(t.telefono, [], 'y no salió ningún papel: ni el del teléfono');
});

test('r1 · «Deshacer» con el ticket viajando y el insert perdido (10 s): tampoco imprime el teléfono aunque el mesero siguiera en ese ticket; se vigila el insert tardío', async () => {
  const lento = insertLento();
  const t = await arrancar(montar({ interceptar: lento.interceptar, olaC: true }));
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await t.relojes.disparar(TOPE_ENVIO);
  assert.equal(await envio, false);
  await asentar();
  assert.deepEqual(t.telefono, [], 'el cobro ya no existe: ni el papel de emergencia');
  assert.equal(t.pos.cajaTrabajos.length, 0);
  await lento.soltar(); await asentar(); await asentar(); await asentar();
  assert.equal(filaDeshecha(t).error, 'cancelada', 'el insert que entró después se canceló');
});

test('r1 · «Deshacer» cuando la caja ya tomó el ticket (no se puede parar): el aviso se queda siguiéndolo, sin botón de papel, y la persona lo sabe', async () => {
  const t = await arrancar(montar({ olaC: true }));
  t.pos.facturar();
  await t.pos.pedirImpresion('ticket');
  await t.pos.aceptarImpresion();
  t.pos.volverDeTicket(); await asentar();
  t.base.imprimir(filas(t)[0].id, 'imprimiendo');                      // la caja lo tomó justo ahora y a este teléfono aún no le llegó
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar(); await asentar();
  assert.match(t.pos.aviso.texto, /La caja ya tomó el ticket del cobro que deshiciste/);
  assert.equal(filaDeshecha(t).estado, 'imprimiendo', 'no se cancela lo que la caja ya tiene en las manos');
  assert.equal(t.pos.cajaTrabajos.length, 1);
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(t.pos.cajaTrabajos[0]), false);
  assert.deepEqual(t.telefono, []);
});

test('r1 · «Deshacer» no toca la precuenta de esa cuenta (un papel distinto: no es el ticket del cobro)', async () => {
  const lento = insertLento();
  const t = await arrancar(montar({ interceptar: (c, o) => (esInsert(c) && c.cuerpo?.tipo === 'ticket' ? lento.interceptar(c, o) : undefined), olaC: true }));
  // Una precuenta de la cuenta, en cola.
  await t.pos.pedirImpresion('precuenta');
  assert.equal(await t.pos.aceptarImpresion(), true);
  assert.equal(t.pos.cajaTrabajos[0].tipo, 'cuenta');
  assert.equal(t.pos.cajaTrabajos[0].orden, undefined, 'la precuenta no guarda orden: se puede volver a pedir');
  t.pos._revocarTicketsDeCobro('o1');
  await asentar();
  assert.equal(t.pos.cajaTrabajos.length, 1, 'la precuenta sigue en su aviso');
  assert.equal(filas(t)[0].estado, 'pendiente', 'y en la cola');
  assert.equal(cancelaciones(t), 0);
});

test('r1 · el ticket de un ABONO se revoca con el mismo id que usa «Deshacer» (ultimoCobro.ordenId): el aviso del abono deshecho se va y no ofrece el teléfono', async () => {
  const t = await arrancar(montar({ interceptar: cuelgaElInsert, olaC: true }));
  t.pos.montoAbono = '10000';
  assert.equal(t.pos.cobrarMonto(), true);
  await asentar();
  await t.pos.pedirImpresion('ticket');
  const envio = t.pos.aceptarImpresion();
  await asentar();
  t.pos.volverDeTicket(); await asentar();
  await t.relojes.disparar(TOPE_ENVIO);
  await envio;
  const e = t.pos.cajaTrabajos[0];
  assert.equal(e.tipo, 'abono');
  assert.equal(e.estado, 'dudoso');
  assert.equal(t.pos.ultimoCobro?.tipo, 'abono');
  assert.equal(String(e.ordenId), String(t.pos.ultimoCobro.ordenId), 'el trabajo del ticket lleva el id de la orden «Abono» que «Deshacer» devuelve');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), true);
  t.pos._revocarTicketsDeCobro(t.pos.ultimoCobro.ordenId);            // lo que _deshacerCobro hace cuando la base deshizo el abono
  await asentar(); await asentar();
  assert.equal(t.pos.cajaTrabajos.length, 0, 'el aviso del ticket del abono deshecho se fue');
  assert.equal(t.pos.puedeImprimirAquiTrabajoCaja(e), false);
  assert.deepEqual(t.telefono, []);
});
