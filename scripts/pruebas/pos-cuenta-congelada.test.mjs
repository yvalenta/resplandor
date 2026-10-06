// LA CUENTA CONGELADA (quinta refutación, 2026-10-06; tareas/2026-10-04-hallazgos-domingo.md): una regla única que cierra la clase «un cobro en duda más un cambio de la misma cuenta».
// El POS REAL (el <script> de pos.html en un `vm`) contra la base falsa de _pos-vm.mjs (cobrar_parcial y cobrar_abono con el orden de juicios de la función).
// Con Postgres y supabase-js reales en Chromium: pos-cuenta-congelada-real.test.mjs.
//
// El defecto (r5, ALTO): la base aplicaba un cobro por partes (o un abono) y la respuesta se perdía; la tablet decía «Sin red… la mesa completa sí se puede cobrar» y dejaba tocar la cuenta. Un cambio
// de esa cuenta (asignar una persona, marcar para llevar, un +1) subía la versión de la copia (`_anotarVersion`, hoy `_anotarRespuesta`) SIN los ítems que el cobro ya había sacado; la mesa completa cerraba con la copia
// vieja y la guardia RS003 la dejaba pasar: la base registraba 75.000 (o 82.000 con un abono) por una mesa de 62.000. Y el ticket PROVISIONAL de la mesa completa ignoraba lo ya cobrado.
// La regla: una cuenta con un cobro en duda queda CONGELADA en esa tablet hasta que la reconciliación con la base diga si el cobro entró o no. Congelada = no se agrega, quita, reasigna, marca para
// llevar ni cobra (mesa completa, por partes, persona, abono, precuenta); se muestra con un velo y «Reintentar ahora». La reconciliación: si existe, adopta la venta y la cuenta de la base (ticket real)
// y descongela; si no existe, suelta el intento, relee la cuenta y descongela.
//   C. La regla y sus puertas (cada gesto, cada cobro, los escritores de fondo, _anotarRespuesta).
//   M. Los guiones de la refutación: M5 (75.000 por 62.000), M6 (82.000 por 62.000), M1/M2 (el ticket provisional) y M3/M4 (el +1 en cola).
//   R. La reconciliación: «Reintentar ahora» con y sin red, la silenciosa, una recarga, el tope de 6 h, las otras mesas.
//   H. El hallazgo bajo: una cuenta escrita ayer, con la regla de hoy, no se ofrece por partes.
//   S. Estática: ningún gesto sin su puerta (completitud), el orden de las puertas, el velo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asentar, hastaQue, plano, POS_HTML, LUNES, MARTES, CLAVE, SECO, JUGO, SOPA, cerradas, local, llamadas, enDuda,
  CONGELADA, SIN_RED, SIN_RED_EN_DUDA, avisoEnDuda, montar, abrir, producto, marcar, otraTablet, releer, reintentoDeRed, envejecer,
} from './_pos-cobro-duda-vm.mjs';

const AYER = '2026-10-04T23:30:00Z';   // 18:30 en Bogotá, domingo
const escrituras = (t) => t.supabase.llamadas.filter((c) => c.tipo === 'rpc' || c.op !== 'select').length;
const hijo = (t, nombre, id) => t.supabase.llamadas.filter((c) => c.tipo === 'rpc' && c.nombre === nombre && (!id || c.args.p_orden_id === id)).length;
const baseCuenta = (t, id = 'o1') => JSON.stringify(t.base.ordenes.get(id));
/** Todo lo que un gesto no puede mover en una cuenta congelada: la copia de aquí, la de la base, la cola y lo que salió hacia la base. */
const foto = (t, id = 'o1') => ({ items: JSON.stringify(local(t, id).items), version: local(t, id).version, base: baseCuenta(t, id), cola: JSON.stringify(t.pos.colaDeltas), escrituras: escrituras(t), almacen: t.almacen.get('pos_delta_queue') ?? null });
const enDudaId = (t, id = 'o1') => t.pos._cuentaCongelada(id);

/** Un intento enviado «a mano» (lo que deja una llamada de cobro sin respuesta), para las pruebas que no necesitan recorrer el cobro. */
const sembrar = (t, extra = {}) => {
  const i = { cobroId: 'c-x', ventaId: 'v-x', uidAbono: 'u-x', tipo: 'parcial', cuentaId: 'o1', creadoEn: Date.now(), enviado: true, enviadoEn: Date.now(), version: 3, mesaId: 1, persona: '', metodo: '', esperado: 12000, ...extra };
  t.pos._guardarCobroEnDuda(i);
  return i;
};
/** El recorrido real: un cobro (por partes de 1 Jugo, o un abono de 20.000) que la base APLICA y cuya respuesta se pierde. La cuenta queda congelada y la tablet sin red. */
async function congelar(t, { abono = false, lineas = { jugo: 1 } } = {}) {
  t.base.cobroRespuestaPerdida = true;
  if (abono) { t.pos.toggleModoCobroParcial(); t.pos.montoAbono = '20000'; assert.equal(await t.pos.cobrarMonto(), false); }
  else { marcar(t, lineas); assert.equal(await t.pos.facturarParcial(), false); }
  t.base.cobroRespuestaPerdida = false;
  assert.equal(enDudaId(t), true, 'la cuenta quedó congelada');
  assert.equal(cerradas(t).length, 1, 'la base sí aplicó el cobro');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'y la tablet no lo sabe');
  return t.pos.cobrosEnDuda.o1;
}
const ticketsProvisionales = (t) => t.pos.ordenes.filter((o) => o.provisional || o.estado === 'cerrada');
const sinCambios = async (t, gesto, { aviso = true } = {}) => {
  const antes = foto(t);
  await gesto();
  await asentar(20);
  assert.deepEqual(foto(t), antes, 'la cuenta congelada no cambió: ni aquí, ni en la cola, ni hacia la base, ni en la base');
  if (aviso) assert.equal(t.pos.aviso && t.pos.aviso.texto, CONGELADA, 'y se dijo por qué');
};

// ═══════════════════ C. La regla y sus puertas ═══════════════════

test('C1 la regla: un cobro que SALIÓ y no tuvo respuesta congela la cuenta; uno que nunca salió (la cola no se pudo vaciar) no; y lo que la base contesta (rechazo, éxito) la libera', async () => {
  const t = await abrir();
  assert.equal(t.pos.cuentaCongelada, false);
  await congelar(t);
  assert.equal(t.pos.cuentaCongelada, true, 'la cuenta que se ve');
  assert.equal(t.pos.cuentaCongeladaVisible, true, 'con el velo (no hay una llamada de cobro en camino)');
  assert.equal(t.pos.mesaCongelada(1), true);
  assert.equal(t.pos.motivoSinCobro, CONGELADA);
  assert.equal(t.pos.detalleCobroEnDuda.startsWith('Cobro por partes de $ 12.000'), true, t.pos.detalleCobroEnDuda);
  avisoEnDuda(t);
  // un cobro que nunca salió: la espera de la cola venció
  const u = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(2), JUGO(2)], version: 3 }] });
  u.base.red = false;
  u.pos.agregarProducto(producto(u, 'sopa'));
  await asentar(20);
  marcar(u, { seco: 1 });
  assert.equal(await u.pos.facturarParcial(), false);
  assert.equal(u.pos._cuentaCongelada('o1'), false, 'lo que nunca salió no congela');
  assert.equal(u.pos.cuentaCongelada, false);
  assert.equal(u.pos.mesaCongelada(1), false);
});

test('C2 la puerta de los GESTOS: cada uno de los que tocan la cuenta se rechaza y no mueve NADA (ni la copia, ni la cola, ni la base) y dice por qué', async () => {
  const t = await abrir();
  // antes de congelar: una persona asignada, un precio a mano y una línea para llevar
  const o = () => local(t);
  t.pos.ciclarPagador(o().items.find((i) => i.id === 'seco'));
  await asentar(20);
  t.pos.fijarPrecioLinea(o().items.find((i) => i.id === 'jugo'), 11000);
  await asentar(20);
  assert.equal(o().items.find((i) => i.id === 'jugo').precio_manual, true);
  await congelar(t, { lineas: { seco: 1 } });
  const seco = () => o().items.find((i) => i.id === 'seco');
  const jugo = () => o().items.find((i) => i.id === 'jugo');
  const gestos = {
    agregarProducto: () => t.pos.agregarProducto(producto(t, 'sopa')),
    '_agregarAlPedido (con variante)': () => t.pos._agregarAlPedido(producto(t, 'sopa'), 'sin sal'),
    agregarItemManual: () => { t.pos.itemManualNombre = 'Propina'; t.pos.itemManualPrecio = '3000'; t.pos.agregarItemManual(); },
    quitarProducto: () => t.pos.quitarProducto(jugo()),
    incrementarItem: () => t.pos.incrementarItem(jugo()),
    alternarLlevar: () => t.pos.alternarLlevar(jugo()),
    alternarLlevarPedido: () => t.pos.alternarLlevarPedido(),
    ciclarPagador: () => t.pos.ciclarPagador(jugo()),
    renombrarPersona: () => t.pos.renombrarPersona('Persona 1', 'Ana'),
    fijarPrecioLinea: () => t.pos.fijarPrecioLinea(seco(), 15000),
    volverPrecioCarta: () => t.pos.volverPrecioCarta(jugo()),
  };
  for (const [nombre, gesto] of Object.entries(gestos)) {
    t.pos.aviso = null;
    await sinCambios(t, gesto).catch((e) => { e.message = `${nombre}: ${e.message}`; throw e; });
  }
  assert.equal(t.pos.itemManualNombre, 'Propina', 'el formulario del ítem manual no se vació: no se agregó nada');
});

test('C3 la puerta de los COBROS: mesa completa, por partes, persona, abono (y pagar todo como abono) y precuenta se rechazan y dicen por qué; nada sale hacia la base', async () => {
  const t = await abrir();
  t.pos.ciclarPagador(local(t).items.find((i) => i.id === 'seco'));
  await asentar(20);
  await congelar(t, { lineas: { jugo: 1 } });
  const cobros = () => hijo(t, 'cobrar_parcial') + hijo(t, 'cobrar_abono');
  const antes = cobros();
  const upserts = () => t.supabase.de('ordenes', 'upsert').length;
  const u0 = upserts();
  const todos = {
    'mesa completa (facturar)': async () => { t.pos.facturar(); },
    'por partes': async () => { marcar(t, { seco: 1 }); assert.equal(await t.pos.facturarParcial(), false); },
    'por partes con una lista de ids': async () => { assert.equal(await t.pos.facturarParcial(['seco']), false); },
    'por persona': async () => { assert.equal(await t.pos.cobrarGrupoPersona('Persona 1'), false); },
    abono: async () => { t.pos.montoAbono = '5000'; assert.equal(await t.pos.cobrarMonto(), false); },
    'abono por el total (es la mesa completa)': async () => { t.pos.montoAbono = String(t.pos.totalPendiente); assert.equal(await t.pos.cobrarMonto(), false); },
    precuenta: async () => { assert.equal(await t.pos.pedirImpresion('precuenta'), false); },
  };
  for (const [nombre, hacer] of Object.entries(todos)) {
    t.pos.aviso = null;
    await hacer();
    await asentar(20);
    assert.equal(t.pos.aviso && t.pos.aviso.texto, CONGELADA, `${nombre}: dice por qué`);
    assert.equal(cobros(), antes, `${nombre}: ningún cobro salió hacia la base`);
    assert.equal(upserts(), u0, `${nombre}: ni una fila de ordenes subió`);
    assert.equal(local(t).estado, 'abierta', `${nombre}: la cuenta sigue abierta`);
    assert.equal(t.pos.vista, 'orden', `${nombre}: no saltó a un ticket`);
  }
  assert.equal(ticketsProvisionales(t).length, 0, 'ningún ticket, ni provisional');
});

test('C4 los escritores de FONDO esperan: una marca de «para llevar» o un precio que no pudieron subir antes del cobro no suben mientras la cuenta está congelada, y salen al descongelarse', async () => {
  const t = await abrir();
  // sin red: una marca y un precio quedan pendientes (reintento a los 1,5 s)
  t.base.red = false;
  t.pos.alternarLlevar(local(t).items.find((i) => i.id === 'jugo'));
  t.pos.fijarPrecioLinea(local(t).items.find((i) => i.id === 'seco'), 17000);
  await asentar(20);
  const notas0 = hijo(t, 'actualizar_nota_item');
  const precios0 = hijo(t, 'fijar_precio_item');
  assert.ok(notas0 >= 1 && precios0 >= 1, 'se intentó una vez y falló por la red');
  t.base.red = true;
  sembrar(t);                                                       // la cuenta se congela
  const reintentos = () => t.timers.filter((h) => h.ms === 1500 && !h.cancelado);
  assert.ok(reintentos().length >= 1, 'hay un reintento programado');
  for (const h of reintentos()) await h.fn();
  await asentar(30);
  assert.equal(hijo(t, 'actualizar_nota_item'), notas0, 'la marca de «para llevar» no subió: la cuenta está congelada');
  assert.equal(hijo(t, 'fijar_precio_item'), precios0, 'el precio a mano tampoco');
  assert.ok(reintentos().length >= 1, 'y siguen esperando (se reprograman)');
  t.pos._soltarCobroEnDuda('o1');                                   // la base contestó: descongelada
  for (let k = 0; k < 4 && (hijo(t, 'actualizar_nota_item') === notas0 || hijo(t, 'fijar_precio_item') === precios0); k++) {
    for (const h of reintentos()) await h.fn();
    await asentar(30);
  }
  assert.ok(hijo(t, 'actualizar_nota_item') > notas0, 'descongelada, la marca sube');
  assert.ok(hijo(t, 'fijar_precio_item') > precios0, 'y el precio también');
});

test('C5 _anotarRespuesta: a una cuenta congelada nada le sube la versión (la respuesta de un cambio que iba en camino no la deja con la versión buena y los ítems viejos); descongelada, la fila con los MISMOS ítems sí, y una versión SOLA no', async () => {
  const t = await abrir();
  const v = local(t).version;
  const fila = (extra = {}) => ({ ...JSON.parse(JSON.stringify(t.base.ordenes.get('o1'))), version: v + 5, ...extra });
  sembrar(t);
  t.pos._anotarRespuesta('o1', fila());
  assert.equal(local(t).version, v, 'congelada: la versión no sube');
  t.pos._soltarCobroEnDuda('o1');
  delete local(t).desactualizada;
  t.pos._anotarRespuesta('o1', { version: v + 5 });
  assert.equal(local(t).version, v, 'una versión sin los ítems que la acompañan NO sube la de la copia');
  assert.equal(local(t).desactualizada, true, 'queda «desactualizada» (se relee)');
  t.pos._anotarRespuesta('o1', fila());
  assert.equal(local(t).version, v + 5, 'la fila completa con los mismos ítems: la versión viaja con ellos');
  assert.equal(local(t).desactualizada, undefined);
});

test('C6 otra mesa NO se congela: con la Mesa 1 congelada, la Mesa 2 se toca y se cobra entera como siempre', async () => {
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(2), JUGO(2)] }, { id: 'o2', mesa: 2, items: [SOPA(2), JUGO(1)] }] });
  await congelar(t);
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 2));
  assert.equal(t.pos.cuentaCongelada, false);
  assert.equal(t.pos.cuentaCongeladaVisible, false);
  assert.equal(t.pos.mesaCongelada(2), false);
  assert.equal(t.pos.mesaCongelada(1), true, 'y el mapa sí marca la Mesa 1');
  t.pos.agregarProducto(producto(t, 'sopa'));
  await asentar(20);
  assert.equal(local(t, 'o2').items.find((i) => i.id === 'sopa').qty, 3);
  t.pos.facturar();
  await asentar(30);
  assert.equal(local(t, 'o2').estado, 'cerrada', 'la mesa completa de la Mesa 2 se cobró');
  assert.equal(enDudaId(t, 'o1'), true, 'la Mesa 1 sigue congelada');
});

test('C7 mientras la llamada de cobro está en camino, la cuenta ya está congelada (los gestos no pasan) pero el velo no sale: ahí ya dice «Registrando…»', async () => {
  const t = await abrir();
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'rpc' && c.nombre === 'cobrar_parcial' ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));
  const cobro = t.pos.facturarParcial({ jugo: 1 });
  await hastaQue(() => !!soltar);
  assert.equal(t.pos._cuentaCongelada('o1'), true, 'enviado: ya está en duda');
  assert.equal(t.pos.cuentaCongelada, true);
  assert.equal(t.pos.cuentaCongeladaVisible, false, 'sin velo mientras se registra');
  const antes = escrituras(t);
  t.pos.incrementarItem(local(t).items.find((i) => i.id === 'seco'));
  assert.equal(escrituras(t), antes, 'ni un +1 mientras tanto');
  soltar();
  assert.equal(await cobro, true);
  assert.equal(t.pos._cuentaCongelada('o1'), false, 'la base contestó: libre');
});

test('C8 _cobrarEnBase defiende la regla aunque lo llamen igual (una carrera): con un intento enviado primero PREGUNTA a la base, y ese cobro no sale en la misma llamada — si llegó, lo adopta; si no se puede preguntar, nada; si no llegó, relee', async () => {
  // (a) el cobro anterior SÍ llegó
  const a = await abrir();
  await congelar(a);
  const n = hijo(a, 'cobrar_parcial');
  assert.equal(await a.pos._cobrarEnBase({ orden: local(a), tipo: 'parcial', lineas: [{ id: 'seco', qty: 1 }], subtotal: 19000 }), false);
  assert.equal(hijo(a, 'cobrar_parcial'), n, 'no salió un segundo cobro');
  assert.match(a.pos.aviso.texto, /SÍ quedó registrado en la base/);
  assert.equal(a.pos._cuentaCongelada('o1'), false);
  assert.equal(cerradas(a).length, 1);
  assert.equal(a.pos.vista, 'ticket', 'a quien cobra se le muestra el ticket del cobro que sí entró');
  // (b) no se puede preguntar
  const b = await abrir();
  await congelar(b);
  b.base.red = false;
  const m = hijo(b, 'cobrar_parcial');
  assert.equal(await b.pos._cobrarEnBase({ orden: local(b), tipo: 'parcial', lineas: [{ id: 'seco', qty: 1 }], subtotal: 19000 }), false);
  assert.equal(hijo(b, 'cobrar_parcial'), m);
  assert.match(b.pos.aviso.texto, /sigue sin confirmarse/);
  assert.doesNotMatch(b.pos.aviso.texto, /la mesa completa sí se puede cobrar/);
  assert.equal(b.pos._cuentaCongelada('o1'), true, 'sigue congelada');
  assert.equal(b.pos.cobrandoParcial, false);
  // (c) el anterior nunca llegó: se suelta y se relee, pero este cobro NO sale ahí mismo
  const c = await abrir();
  c.base.red = false;
  marcar(c, { jugo: 1 });
  assert.equal(await c.pos.facturarParcial(), false);
  assert.equal(c.pos._cuentaCongelada('o1'), true);
  c.base.red = true;
  envejecer(c);                                                     // pasó la espera de 30 s desde que la petición se perdió: el «no llegó» ya vale
  const k = hijo(c, 'cobrar_parcial');
  assert.equal(await c.pos._cobrarEnBase({ orden: local(c), tipo: 'parcial', lineas: [{ id: 'seco', qty: 1 }], subtotal: 19000 }), false);
  assert.equal(hijo(c, 'cobrar_parcial'), k, 'no salió: quien cobra revisa la cuenta releída y confirma de nuevo');
  assert.equal(c.pos.aviso.texto, 'El cobro no llegó a la base: la cuenta se volvió a leer tal como está allá y ya se puede tocar y cobrar.');
  assert.equal(c.pos._cuentaCongelada('o1'), false);
  // (d) lo mismo SIN esperar los 30 s: «no llegó» todavía no es definitivo (la petición puede seguir en camino): sigue congelada, y lo dice
  const d = await abrir();
  d.base.red = false;
  marcar(d, { jugo: 1 });
  assert.equal(await d.pos.facturarParcial(), false);
  d.base.red = true;
  const q = hijo(d, 'cobrar_parcial');
  assert.equal(await d.pos._cobrarEnBase({ orden: local(d), tipo: 'parcial', lineas: [{ id: 'seco', qty: 1 }], subtotal: 19000 }), false);
  assert.equal(hijo(d, 'cobrar_parcial'), q, 'no salió');
  assert.match(d.pos.aviso.texto, /la petición puede seguir en camino/);
  assert.equal(d.pos._cuentaCongelada('o1'), true, 'sigue congelada');
});

test('C9 con el Wi-Fi apagado (`navigator.onLine` en false) la llamada de cobro ni sale: no hay nada en duda, la cuenta NO se congela, el aviso es el de siempre y la mesa completa (PROVISIONAL) sigue disponible; la regla congela lo que SALIÓ, no lo que no pudo salir', async () => {
  const t = await abrir();
  t.caja.navigator.onLine = false;
  t.base.red = false;
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  assert.equal(t.pos.aviso.texto, SIN_RED);
  assert.equal(llamadas(t, 'cobrar_parcial').length, 0, 'la llamada ni salió');
  assert.equal(enDudaId(t), false);
  assert.deepEqual(plano(t.pos.cobrosEnDuda), {});
  assert.equal(t.pos.cuentaCongelada, false);
  t.pos.facturar();
  await asentar(30);
  assert.equal(local(t).estado, 'cerrada', 'la mesa completa de una cuenta sin promoción se cobra sin red (el ticket sale PROVISIONAL)');
  assert.equal(local(t).provisional, true);
});

test('C10 «Cobrar» de una persona en una cuenta congelada que además TIENE promoción: ni abre el panel del abono ni escribe el monto (la puerta de los cobros va ANTES de la regla de la promoción)', async () => {
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3)], version: 3, crudo: true, abiertaEn: AYER }], reloj: LUNES });
  t.pos.ciclarPagador(local(t).items[0]);
  await asentar(20);
  assert.equal(t.pos.cuentaConPromo, true);
  sembrar(t);
  t.pos.aviso = null;
  assert.equal(await t.pos.cobrarGrupoPersona('Persona 1'), false);
  assert.equal(t.pos.aviso.texto, CONGELADA, 'no el aviso «lo de esta persona se recibe como un abono»');
  assert.equal(t.pos.montoAbono, '', 'no se escribió el monto del abono');
  assert.equal(t.pos.modalAbono, false);
  assert.equal(t.pos.seleccionCobro, false, 'ni se abrió el modo de cobro por partes');
});

test('C11 liberar una mesa «vacía» que está congelada NO la libera: la cuenta de la base puede tener lo que la tablet ya no ve, y borrarla perdería un cobro (ni siquiera pregunta)', async () => {
  const t = await abrir();
  sembrar(t);
  local(t).items = [];
  const antes = t.pos.ordenes.length;
  t.pos.liberarMesaVacia();
  await asentar(20);
  assert.equal(t.confirmaciones.length, 0, 'ni preguntó «¿Liberar esta mesa?»');
  assert.equal(t.pos.ordenes.length, antes, 'la cuenta sigue ahí');
  assert.equal(t.pos.mesas.find((m) => m.id === 1).estado, 'ocupada');
  assert.equal(t.supabase.de('ordenes', 'delete').length, 0);
  assert.equal(t.pos.aviso.texto, CONGELADA);
});

test('C12 devolver («Deshacer») un cobro anterior a una cuenta congelada no se hace: devolver es cambiar la cuenta, y no se sabe qué pasó con el cobro en duda', async () => {
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3), JUGO(2)], version: 3 }] });
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), true);                    // un cobro normal: venta A
  const ventaA = cerradas(t)[0];
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 1));
  t.base.cobroRespuestaPerdida = true;
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), false);                   // el segundo se aplica y su respuesta se pierde: en duda
  t.base.cobroRespuestaPerdida = false;
  assert.equal(enDudaId(t), true);
  t.pos.remoto = 'ok';                                                  // (con `remoto` en «offline» el deshacer ya dice «sin conexión»: aquí la red responde y lo que frena es la cuenta congelada)
  const n = (nombre) => t.supabase.rpcs(nombre).length;
  assert.equal(await t.pos.devolverACuenta(ventaA.id), false);
  assert.equal(t.pos.deshacerError, CONGELADA);
  assert.equal(n('deshacer_cobro'), 0, 'la llamada ni salió');
  assert.equal(cerradas(t).some((o) => o.id === ventaA.id), true, 'la venta A sigue en la base');
});

test('C13 la mesa completa con red lee primero la cuenta de la base; si MIENTRAS se lee la cuenta se congela, no cierra ni toca la copia (la puerta se vuelve a mirar después de leer)', async () => {
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3)], version: 3, crudo: true, abiertaEn: AYER }], reloj: LUNES });
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'select' && c.filtros.length === 1 && c.filtros[0][1] === 'o1' ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));   // la lectura de la cuenta queda esperando
  t.pos.facturar();
  await hastaQue(() => !!soltar);
  const v = local(t).version;
  sembrar(t);                                                           // mientras se lee, el cobro en duda congela la cuenta
  soltar();
  await asentar(40);
  assert.equal(local(t).version, v, 'y la lectura no tocó la copia congelada');
  assert.equal(local(t).estado, 'abierta', 'la mesa completa no cerró con la cuenta congelada');
  assert.equal(t.supabase.de('ordenes', 'upsert').length, 0);
});

// ═══════════════════ M. Los guiones de la refutación ═══════════════════

test('M5 (r5, ALTO): el cobro por partes se aplicó y la respuesta se perdió; el mesero asigna el Seco a la Persona 1 y toca «Generar ticket y cobrar»: NADA sube la versión sin los ítems y la mesa completa no cierra con la copia vieja — la base registra 12.000 + 50.000 = 62.000, no 74.000', async () => {
  const t = await abrir();
  await congelar(t, { lineas: { jugo: 1 } });
  avisoEnDuda(t);
  assert.equal(t.base.ordenes.get('o1').total, 2 * 19000 + 12000, 'la base: la cuenta ya sin el Jugo cobrado');
  const v = local(t).version;
  // el gesto de la refutación
  t.pos.ciclarPagador(local(t).items.find((i) => i.id === 'seco'));
  await asentar(20);
  assert.equal(local(t).version, v, 'la versión local no subió');
  assert.equal(local(t).items.find((i) => i.id === 'seco').nota, '', 'la persona no se asignó');
  assert.equal(hijo(t, 'actualizar_nota_item'), 0, 'ni salió hacia la base');
  // la mesa completa
  t.pos.facturar();
  await asentar(30);
  assert.equal(local(t).estado, 'abierta');
  assert.equal(t.supabase.de('ordenes', 'upsert').length, 0, 'no subió ningún cierre');
  assert.equal(t.base.ordenes.get('o1').estado, 'abierta');
  assert.equal(cerradas(t).length, 1, 'en la base solo está la venta de 12.000');
  // la red vuelve: la tablet pregunta sola
  await reintentoDeRed(t);
  assert.equal(enDudaId(t), false, 'se reconcilió');
  assert.match(t.pos.aviso.texto, /SÍ quedó registrado en la base/);
  assert.equal(local(t).version, t.base.ordenes.get('o1').version, 'la copia es la de la base');
  assert.equal(local(t).items.find((i) => i.id === 'jugo').qty, 1, 'sin el Jugo cobrado');
  // y ahora la mesa completa cuadra
  t.pos.facturar();
  await asentar(40);
  assert.equal(local(t).estado, 'cerrada');
  const ventas = cerradas(t);
  assert.equal(ventas.length, 2);
  assert.equal(ventas.reduce((s, o) => s + o.total, 0), 62000, 'UNA mesa de 62.000 se registra por 62.000 (antes 74.000)');
  assert.equal(ventas.find((o) => o.parcial_de === 'o1').total, 12000);
  assert.equal(ventas.find((o) => !o.parcial_de).total, 50000);
});

test('M6 (r5): lo mismo con un ABONO de 20.000 y marcar una línea para llevar: la mesa completa no borra el crédito — la base registra 20.000 + 42.000 = 62.000, no 82.000', async () => {
  const t = await abrir();
  await congelar(t, { abono: true });
  avisoEnDuda(t);
  const v = local(t).version;
  t.pos.alternarLlevar(local(t).items.find((i) => i.id === 'seco'));
  await asentar(20);
  assert.equal(local(t).version, v);
  assert.equal(hijo(t, 'actualizar_nota_item'), 0);
  t.pos.facturar();
  await asentar(30);
  assert.equal(local(t).estado, 'abierta');
  assert.equal(t.base.ordenes.get('o1').estado, 'abierta');
  assert.ok(t.base.ordenes.get('o1').items.some((i) => String(i.id).startsWith('abono_recibido_')), 'el crédito del abono sigue en la cuenta de la base');
  await reintentoDeRed(t);
  assert.equal(enDudaId(t), false);
  assert.equal(t.pos.abonosRecibidos, 20000, 'la cuenta de aquí muestra el abono');
  t.pos.facturar();
  await asentar(40);
  assert.equal(local(t).estado, 'cerrada');
  assert.equal(cerradas(t).reduce((s, o) => s + o.total, 0), 62000);
  assert.equal(cerradas(t).find((o) => o.parcial_de === 'o1').total, 20000);
  assert.equal(cerradas(t).find((o) => !o.parcial_de).total, 42000);
});

test('M1/M2 (r5, MEDIO): con un cobro en duda el aviso NO recomienda la mesa completa y el ticket PROVISIONAL no se ofrece; si la base ya tiene el cobro no hay un RS003 que diga «no se cobró nada»', async () => {
  for (const abono of [true, false]) {
    const t = await abrir();
    await congelar(t, { abono });
    avisoEnDuda(t);                                                   // «…Sin red: el cobro por partes y los abonos necesitan red.» y NADA de «la mesa completa sí se puede cobrar»
    t.pos.facturar();
    await asentar(30);
    assert.equal(t.pos.aviso.texto, CONGELADA);
    assert.equal(t.pos.vista, 'orden', 'no hay un ticket');
    assert.equal(ticketsProvisionales(t).length, 0, 'ni un provisional');
    assert.equal(t.pos.ordenes.some((o) => o.cobradaSinRed), false, 'nadie cobró sin red');
    assert.equal(t.supabase.de('ordenes', 'upsert').length, 0, 'no se subió un cierre que la base tendría que rechazar (RS003)');
    assert.doesNotMatch(String(t.pos.aviso.texto), /No se cobró nada/);
  }
});

test('M3/M4 (r5, ALTO): un +1 Jugo de la cuenta congelada (que la refutación dejaba en cola) no se agrega: la cola no crece y la mesa completa tampoco cierra con la copia vieja', async () => {
  const t = await abrir();
  await congelar(t, { lineas: { jugo: 1 } });
  t.base.red = false;                                               // y la lectura por parcial_de tampoco sale (el recurso de D3/M4)
  t.pos.agregarProducto(producto(t, 'jugo'));
  t.pos.incrementarItem(local(t).items.find((i) => i.id === 'jugo'));
  await asentar(30);
  assert.deepEqual(plano(t.pos.colaDeltas), [], 'ningún +1 en cola');
  assert.equal(local(t).items.find((i) => i.id === 'jugo').qty, 2, 'la copia sigue con sus 2 Jugos (la de antes del cobro)');
  t.base.red = true;
  t.pos.facturar();
  await asentar(30);
  assert.equal(local(t).estado, 'abierta');
  assert.equal(t.base.ordenes.get('o1').estado, 'abierta');
  assert.equal(cerradas(t).length, 1);
});

// ═══════════════════ R. La reconciliación ═══════════════════

test('R1 «Reintentar ahora» SIN red: sigue congelada, lo dice, y el botón queda libre para volver a probar (una sola pregunta por toque)', async () => {
  const t = await abrir();
  await congelar(t);
  t.base.red = false;
  const lecturas = () => t.supabase.de('ordenes', 'select').filter((c) => c.filtros.some(([col, val]) => col === 'id' && val === t.pos.cobrosEnDuda.o1?.ventaId)).length;
  const antes = lecturas();
  const p = t.pos.reintentarCobroEnDuda();
  assert.equal(t.pos.reintentandoCobros.o1, true, 'mientras pregunta, el botón dice «Preguntando…»');
  assert.equal(await t.pos.reintentarCobroEnDuda(), null, 'un segundo toque mientras tanto no pregunta otra vez');
  assert.equal(await p, 'sin_respuesta');
  assert.equal(lecturas(), antes + 1, 'una sola pregunta');
  assert.equal(t.pos.aviso.texto, 'La base sigue sin contestar: el cobro sigue pendiente de confirmar y la mesa, congelada. Reintenta cuando vuelva la red.');
  assert.equal(enDudaId(t), true);
  assert.equal(t.pos.cuentaCongeladaVisible, true);
  assert.deepEqual(plano(t.pos.reintentandoCobros), {}, 'el botón queda libre');
});

test('R2 «Reintentar ahora» CON red y el cobro SÍ está en la base: adopta la venta y la cuenta de la base (ticket real), descongela, y los gestos vuelven a pasar', async () => {
  const t = await abrir();
  await congelar(t, { lineas: { jugo: 1 } });
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado');
  assert.equal(enDudaId(t), false);
  assert.equal(t.pos.cuentaCongelada, false);
  assert.equal(t.almacen.has(CLAVE), false, 'el intento ya no está en localStorage');
  assert.equal(t.pos.vista, 'ticket', 'a quien toca el botón se le muestra el ticket del cobro');
  assert.equal(t.pos.ticketMostrado.id, cerradas(t)[0].id);
  assert.equal(t.pos.ticketMostrado.total, 12000);
  assert.match(t.pos.aviso.texto, /SÍ quedó registrado en la base/);
  assert.equal(hijo(t, 'cobrar_parcial'), 1, 'preguntar no cobra');
  assert.equal(local(t).version, t.base.ordenes.get('o1').version);
  assert.equal(local(t).items.find((i) => i.id === 'jugo').qty, 1);
  assert.deepEqual(plano(t.pos.reintentandoCobros), {});
  // descongelada: se vuelve a la cuenta y se puede tocar (la base contestó, así que `remoto` volvió a «ok» y la resincronización que eso dispara termina antes de que alguien toque nada)
  await asentar(40);
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 1));
  t.pos.agregarProducto(producto(t, 'sopa'));
  await asentar(20);
  assert.equal(local(t).items.find((i) => i.id === 'sopa').qty, 1);
});

test('R3 «Reintentar ahora» CON red y el cobro NUNCA llegó: suelta el intento, RELEE la cuenta de la base y descongela (los gestos pasan y se puede cobrar de nuevo con ids propios)', async () => {
  const t = await abrir();
  t.base.red = false;
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  avisoEnDuda(t);
  assert.equal(enDudaId(t), true);
  const viejo = enDuda(t).o1;
  assert.equal(cerradas(t).length, 0, 'la base nunca lo recibió');
  otraTablet(t, [SECO(2), JUGO(3)]);                                // mientras tanto otra tablet sumó un Jugo
  t.base.red = true;
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'en_espera', 'recién asentada: el «no llegó» todavía no es definitivo');
  assert.equal(enDudaId(t), true);
  envejecer(t);                                                     // pasaron los 30 s desde que se perdió la petición
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'sin_rastro');
  assert.equal(enDudaId(t), false);
  assert.equal(t.almacen.has(CLAVE), false);
  assert.equal(t.pos.aviso.texto, 'El cobro no llegó a la base: la cuenta se volvió a leer tal como está allá y ya se puede tocar y cobrar.');
  assert.equal(local(t).version, t.base.ordenes.get('o1').version, 'la copia es la de la base');
  assert.equal(local(t).items.find((i) => i.id === 'jugo').qty, 3, 'con lo que hizo la otra tablet');
  assert.equal(t.pos.vista, 'orden', 'sin ticket: no hubo cobro');
  // y se puede cobrar de nuevo: un intento NUEVO
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), true);
  const nuevo = llamadas(t, 'cobrar_parcial').at(-1).args;
  assert.notEqual(nuevo.p_delta_id, viejo.cobroId);
  assert.notEqual(nuevo.p_venta.id, viejo.ventaId);
  assert.equal(cerradas(t).length, 1);
});

test('R4 la reconciliación SILENCIOSA al volver la red (sin que nadie toque nada): adopta la venta y la cuenta, descongela y la pantalla no salta a un ticket', async () => {
  const t = await abrir();
  await congelar(t, { abono: true });
  await reintentoDeRed(t);
  assert.equal(enDudaId(t), false);
  assert.match(t.pos.aviso.texto, /El abono de la Mesa 1 \(\$ 20\.000\) SÍ quedó registrado en la base/);
  assert.equal(t.pos.vista, 'orden', 'la pantalla no salta');
  assert.equal(t.pos.ultimoCobro, null);
  assert.equal(cerradas(t).length, 1);
  assert.equal(t.pos.abonosRecibidos, 20000);
});

test('R5 mientras haya una cuenta congelada la tablet vuelve a preguntar sola cada 7 s (el velo no se queda puesto porque nadie lo toque): sin red sigue, con red se quita', async () => {
  const t = await abrir();
  await congelar(t);
  const h = t.timer(7000);
  assert.ok(h, 'hay una pregunta programada');
  t.base.red = false;
  await h.fn(); await asentar(40);
  assert.equal(enDudaId(t), true, 'sin red sigue congelada');
  const siguiente = t.timers.filter((x) => x.ms === 7000 && !x.cancelado).at(-1);
  assert.ok(siguiente && siguiente !== h, 'y se programó la siguiente');
  t.base.red = true;
  await siguiente.fn(); await asentar(40);
  assert.equal(enDudaId(t), false, 'con red, la reconciliación la libera');
  assert.equal(t.timers.filter((x) => x.ms === 7000 && !x.cancelado && x !== siguiente && x !== h).length, 0, 'y ya no hay nada que vigilar');
});

test('R6 una RECARGA con el cobro en duda: la cuenta nace congelada (el intento sobrevive en localStorage) aunque no haya red, y se libera sola al volver', async () => {
  const t = await abrir();
  await congelar(t);
  t.base.red = false;
  const u = montar({ base: t.base, almacen: t.almacen });
  await u.pos.arrancarApp();
  await asentar(30);
  assert.equal(u.pos._cuentaCongelada('o1'), true, 'congelada desde el arranque');
  await u.pos.abrirMesa(u.pos.mesas.find((m) => m.id === 1));
  assert.equal(u.pos.cuentaCongelada, true);
  assert.equal(u.pos.cuentaCongeladaVisible, true);
  const antes = escrituras(u);
  u.pos.agregarProducto(producto(u, 'sopa'));
  u.pos.facturar();
  await asentar(20);
  assert.equal(escrituras(u), antes, 'ni un gesto ni un cobro');
  t.base.red = true;
  await hastaQue(() => !u.pos._cuentaCongelada('o1') || !!u.timer(7000) || !!u.timer(8000), 3000);
  await (u.timer(8000) || u.timer(7000)).fn();
  await asentar(60);
  assert.equal(u.pos._cuentaCongelada('o1'), false, 'al volver la red se reconcilia');
  assert.equal(cerradas(u).length, 1);
});

test('R7 pasadas 6 h sin poder preguntar, el cobro ya no cuenta: se descongela (la única salida que no sabe) y avisa que se revise la cuenta', async () => {
  const t = await abrir();
  await congelar(t);
  t.base.red = false;
  t.pos.cobrosEnDuda = { o1: { ...plano(t.pos.cobrosEnDuda).o1, enviadoEn: Date.now() - 7 * 3600 * 1000 } };
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'vencido');
  assert.equal(enDudaId(t), false);
  assert.match(t.pos.aviso.texto, /Pasaron más de 6 horas/);
  assert.equal(t.almacen.has(CLAVE), false);
});

test('R8 la adopción trae la CUENTA o no descongela: si la venta está pero la cuenta no se pudo leer, sigue congelada (con una copia vieja descongelada un cambio subiría la versión sin los ítems)', async () => {
  const t = await abrir();
  await congelar(t);
  const original = t.base.responder;
  t.base.responder = async (c) => (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'select' && c.filtros.some(([col, val]) => col === 'id' && val === 'o1') && !c.filtros.some(([col]) => col === 'parcial_de')
    ? { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } } : original(c));
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'sin_respuesta');
  assert.equal(enDudaId(t), true);
  assert.equal(cerradas(t).length, 1);
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'no se adoptó nada a medias');
});

test('R9 los gestos y cobros de una cuenta congelada que se cobró ENTERA en otra tablet: la reconciliación adopta el cobro y relee, la copia no queda abierta con lo ya cobrado', async () => {
  const t = await abrir();
  await congelar(t);
  // otra tablet cobra la mesa completa (la cuenta de la base se cierra)
  const o = t.base.ordenes.get('o1');
  o.estado = 'cerrada'; o.cerrada_en = new Date().toISOString(); o.version += 1;
  assert.equal(await t.pos.reintentarCobroEnDuda(), 'aplicado');
  assert.equal(enDudaId(t), false);
  assert.equal(t.pos.ordenes.filter((x) => x.id === 'o1' && x.estado === 'abierta').length, 0, 'la copia de aquí no sigue abierta');
});

test('R10 mientras se RELEE la cuenta tras un «no llegó» sigue congelada: el intento se suelta DESPUÉS de la lectura (un +1 que saliera durante la lectura quedaría pisado por ella: la copia sin ese ítem y con la versión nueva)', async () => {
  const t = await abrir();
  t.base.red = false;
  marcar(t, { jugo: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  t.base.red = true;
  envejecer(t);
  const original = t.base.responder;
  let soltar = null;
  t.base.responder = (c) => (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'select' && c.filtros.length === 1 && c.filtros[0][0] === 'id' && c.filtros[0][1] === 'o1'
    ? new Promise((r) => { soltar = () => r(original(c)); }) : original(c));    // la relectura de la cuenta queda esperando
  const reintento = t.pos.reintentarCobroEnDuda();
  await hastaQue(() => !!soltar);
  assert.equal(enDudaId(t), true, 'mientras se lee, la cuenta sigue congelada');
  const antes = escrituras(t);
  t.pos.agregarProducto(producto(t, 'sopa'));
  assert.equal(escrituras(t), antes, 'y un gesto en ese momento no pasa');
  assert.equal(t.pos.aviso.texto, CONGELADA);
  soltar();
  assert.equal(await reintento, 'sin_rastro');
  assert.equal(enDudaId(t), false, 'leída la cuenta, se descongela');
  assert.equal(local(t).version, t.base.ordenes.get('o1').version);
});

// ═══════════════════ H. El hallazgo bajo: la cuenta de ayer con la regla de hoy ═══════════════════

const hoyLunes = (extra = {}) => ({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3)], version: 3, crudo: true, abiertaEn: AYER }], reloj: LUNES, ...extra });

test('H1 una cuenta escrita ayer (3 Seco sin descuento) y hoy hay regla: la tablet NO ofrece partirla (usa la regla de HOY sobre las unidades, como la base) y no llama a cobrar_parcial', async () => {
  const t = await abrir(hoyLunes());
  assert.equal(local(t).items.some((i) => String(i.id).startsWith('promo:')), false, 'la cuenta no trae línea de promo: se escribió antes de la regla');
  assert.equal(t.pos.cuentaConPromo, true, 'pero la base la juzgaría con la regla de hoy');
  assert.equal(t.pos._cuentaConPromoHoy(local(t)), true);
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(local(t).items[0]);
  assert.deepEqual(plano(t.pos.itemsSeleccionados), {}, 'no se marca nada');
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false);
  assert.equal(t.pos.aviso.texto, 'Esta mesa tiene una promoción: el descuento se calcula con toda la cuenta junta, así que no se cobra por partes ni por persona. Cobra la mesa completa, o recibe un abono por cada quien.');
  assert.equal(hijo(t, 'cobrar_parcial'), 0, 'ni una llamada: no se espera a que la base diga RS005 una y otra vez');
  // por persona: se convierte en un abono por su total
  t.pos.ciclarPagador(local(t).items[0]);
  await asentar(20);
  t.pos.aviso = null;
  assert.equal(await t.pos.cobrarGrupoPersona('Persona 1'), false);
  assert.match(t.pos.aviso.texto, /se recibe como un abono por su total/);
  assert.equal(t.pos.montoAbono, String(3 * 19000));
  assert.equal(hijo(t, 'cobrar_parcial'), 0);
});

test('H2 la misma cuenta un día SIN regla (martes): se parte como siempre', async () => {
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3)], version: 3, crudo: true, abiertaEn: '2026-10-05T18:00:00Z' }], reloj: MARTES });
  assert.equal(t.pos.cuentaConPromo, false);
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), true);
  assert.equal(cerradas(t).length, 1);
  assert.equal(cerradas(t)[0].total, 19000);
});

test('H3 si la tablet no sabía de la regla (su catálogo es anterior) y la base rechaza con RS005: relee, MUESTRA la promoción (deja de ofrecer partirla) y no vuelve a llamar; un cambio de la cuenta (otra versión) lo olvida', async () => {
  const t = await abrir(hoyLunes());
  // el catálogo de esta tablet no trae la regla
  t.pos.productos = t.pos.productos.map((p) => ({ ...p, promoRegla: null }));
  assert.equal(t.pos.cuentaConPromo, false, 'la tablet no ve la promoción');
  marcar(t, { seco: 1 });
  assert.equal(await t.pos.facturarParcial(), false);
  assert.equal(t.base.cobros.at(-1).resultado, 'RS005');
  assert.match(t.pos.aviso.texto, /esa cuenta tiene una promoción/);
  assert.equal(hijo(t, 'cobrar_parcial'), 1);
  assert.equal(t.pos.cuentaConPromo, true, 'después del RS005 la tablet SÍ ve la promoción (la base la dijo y la cuenta se releyó)');
  assert.equal(local(t).version, t.base.ordenes.get('o1').version, 'se releyó');
  assert.equal(await t.pos.facturarParcial({ seco: 1 }), false, 'el segundo intento ni sale');
  assert.equal(hijo(t, 'cobrar_parcial'), 1);
  assert.equal(enDudaId(t), false, 'un rechazo de la base no deja nada en duda');
  // la cuenta cambia (se quita un Seco: ya no hay 3): el recuerdo vale solo para la versión que se leyó
  t.pos.quitarProducto(local(t).items.find((i) => i.id === 'seco'));
  await asentar(30);
  assert.equal(t.pos.cuentaConPromo, false, 'con 2 Seco no hay promoción: el recuerdo se olvidó con el cambio de versión');
});

// ═══════════════════ S. Estática ═══════════════════

/** El texto de un método del store (de su firma, a 12 espacios, hasta la del siguiente). Con los comentarios: algunas comprobaciones miran las marcas. */
const cuerpo = (nombre) => {
  const i = POS_HTML.search(new RegExp(`^ {12}(?:async\\s+)?${nombre}\\(`, 'm'));
  assert.ok(i !== -1, `no encontré ${nombre} en pos.html`);
  const j = POS_HTML.slice(i + 1).search(/^ {12}(?:async\s+|get\s+)?[A-Za-z_$][\w$]*\(.*\) \{$/m);
  return POS_HTML.slice(i, j === -1 ? undefined : i + 1 + j);
};
/** Los métodos del store (nombre → texto) para recorrerlos todos. */
const metodos = () => {
  const re = /^ {12}(?:async\s+)?([A-Za-z_$][\w$]*)\(([^)]*)\) \{$/gm;
  const lista = [];
  let m;
  while ((m = re.exec(POS_HTML))) lista.push({ nombre: m[1], desde: m.index });
  return lista.map((x, i) => ({ nombre: x.nombre, texto: POS_HTML.slice(x.desde, i + 1 < lista.length ? lista[i + 1].desde : x.desde + 20000) }));
};
// Lo que escribe una cuenta ABIERTA hacia la base o hacia la cola desde un gesto de quien atiende.
const ESCRIBE = /this\._enviarDelta\(|this\._subirMarcaLlevar\(|this\._subirPrecio\(|rpc\('actualizar_nota_item'|rpc\('fijar_precio_item'|rpc\('deshacer_cobro'|from\('ordenes'\)\.delete\(\)/;
// Los métodos que escriben y SON la puerta o el motor que la puerta protege (no son gestos de quien atiende): lo que mandan ya lo decidió una puerta de arriba.
const MOTORES = new Set([
  '_enviarDelta', '_subirMarcaLlevar', '_subirPrecio', '_intentarMarcaLlevar', '_intentarPrecio', '_deshacerCobro', 'deshacerUltimoCobro', 'devolverACuenta', '_quitarMarcadorDevuelto',
]);
// Escriben, pero NO una cuenta abierta ni por un gesto de quien atiende: `_purgarOrdenesArchivadas` borra de la base las ventas CERRADAS que un cierre del día ya archivó.
const EXCEPCIONES = new Set(['_purgarOrdenesArchivadas']);
// Los gestos de quien atiende y la puerta de cada uno (cada gesto empieza por mirar si la cuenta está congelada).
const GESTOS = {
  agregarProducto: '_gestoBloqueado', _agregarAlPedido: '_gestoBloqueado', agregarItemManual: '_gestoBloqueado', quitarProducto: '_gestoBloqueado', incrementarItem: '_gestoBloqueado',
  alternarLlevar: '_gestoBloqueado', alternarLlevarPedido: '_gestoBloqueado', ciclarPagador: '_gestoBloqueado', renombrarPersona: '_gestoBloqueado', fijarPrecioLinea: '_gestoBloqueado',
  liberarMesaVacia: '_gestoBloqueado',
};
const COBROS = ['facturar', 'facturarParcial', 'cobrarGrupoPersona', 'cobrarMonto', 'pedirImpresion'];

test('S1 estática (completitud): TODO método del store que escribe una cuenta abierta es un gesto con su puerta, un motor protegido o una excepción conocida — un gesto nuevo sin puerta rompe esta prueba', () => {
  const quienes = metodos().filter((m) => ESCRIBE.test(m.texto.replace(/^ {12}.*\n/, ''))).map((m) => m.nombre);
  assert.ok(quienes.length >= 10, `encontré los escritores: ${quienes.join(', ')}`);
  const sinPuerta = quienes.filter((n) => !(n in GESTOS) && !MOTORES.has(n) && !EXCEPCIONES.has(n));
  assert.deepEqual(sinPuerta, [], `escriben una cuenta y no tienen puerta ni son un motor conocido: ${sinPuerta.join(', ')}`);
  for (const [nombre, puerta] of Object.entries(GESTOS)) {
    const c = cuerpo(nombre);
    const i = c.indexOf(`this.${puerta}(`);
    assert.ok(i > 0, `${nombre} no llama a ${puerta}`);
    // la puerta va ANTES de cualquier cambio: antes de tocar un ítem, la nota, la cola o una subida
    const cambios = [c.indexOf('item.nota ='), c.indexOf('orden.items.push'), c.indexOf('orden.items.splice'), c.indexOf('item.qty'), c.indexOf('this._enviarDelta('), c.indexOf('this._subirMarcaLlevar('), c.indexOf('this._subirPrecio('), c.indexOf('this._ponerPrecioLocal(')].filter((x) => x >= 0);
    assert.ok(cambios.every((x) => x > i), `${nombre}: la puerta tiene que ir antes de cambiar nada`);
  }
  // fijarPrecioLinea la cubre también volverPrecioCarta (llama a fijarPrecioLinea) y la hoja de variantes ya no se abre
  assert.match(cuerpo('volverPrecioCarta'), /this\.fijarPrecioLinea\(/);
  assert.ok(cuerpo('agregarProducto').indexOf('_gestoBloqueado') < cuerpo('agregarProducto').indexOf('abrirOpciones'), 'ni se abre la hoja de variantes');
  // los motores de fondo y el deshacer se detienen por su cuenta
  assert.match(cuerpo('_intentarMarcaLlevar'), /if \(this\._cuentaCongelada\(p\.ordenId\)\) \{ this\._programarMarcasLlevar\(\); return; \}/);
  assert.match(cuerpo('_intentarPrecio'), /if \(this\._cuentaCongelada\(p\.ordenId\)\) \{ this\._programarPrecios\(\); return; \}/);
  assert.match(cuerpo('_deshacerCobro'), /if \(destino && this\._cuentaCongelada\(destino\.id\)\) \{ this\.deshacerError = TEXTO_CUENTA_CONGELADA; return false; \}/);
});

test('S2 estática: todo cobro pasa por _cobroBloqueado, que mira la congelación PRIMERO (antes de la copia sin confirmar y de la red); _anotarRespuesta no sube la versión de una cuenta congelada', () => {
  const motivo = cuerpo('_motivoSinCobro');
  const iCongelada = motivo.indexOf('this._cuentaCongelada(orden.id)');
  assert.ok(iCongelada > 0 && iCongelada < motivo.indexOf('orden.sinConfirmar') && iCongelada < motivo.indexOf('this._sinRedAhora()'), 'la congelación se mira primero');
  assert.match(motivo, /if \(this\._cuentaCongelada\(orden\.id\)\) return TEXTO_CUENTA_CONGELADA;/);
  assert.match(cuerpo('_cobroBloqueado'), /const motivo = this\._motivoSinCobro\(orden\);/);
  for (const nombre of ['facturar', 'facturarParcial', 'cobrarGrupoPersona', 'cobrarMonto', 'pedirImpresion']) assert.match(cuerpo(nombre), /this\._cobroBloqueado\(/, `${nombre} pasa por _cobroBloqueado`);
  assert.match(cuerpo('_facturarConRed'), /this\._cobroBloqueado\(actual\)/, 'y la mesa completa con red lo vuelve a mirar después de preguntar');
  const anotar = cuerpo('_anotarRespuesta');
  assert.ok(anotar.indexOf('this._cuentaCongelada(ordenId)') > 0 && anotar.indexOf('this._cuentaCongelada(ordenId)') < anotar.indexOf('local.version = v'), 'primero la puerta, luego la versión');
  assert.deepEqual(COBROS.filter((n) => !cuerpo(n)), []);
});

test('S3 estática: la regla no deja memoria nueva — el intento no lleva «huella», ya no se reenvía con el mismo id, y la reconciliación suelta el intento y relee la cuenta cuando la base dice que no llegó', () => {
  assert.doesNotMatch(POS_HTML, /huellaDeCobro|intento\.huella|huella:/, 'la huella ya no existe');
  const base = cuerpo('_cobrarEnBase');
  assert.doesNotMatch(base, /intento = \{ \.\.\.\(intento \|\|/, 'el intento no se reutiliza');
  assert.match(base, /const previo = this\.cobrosEnDuda\[orden\.id\];/);
  assert.ok(base.indexOf('const previo = this.cobrosEnDuda[orden.id];') < base.indexOf('intento = { cobroId: uid()'), 'primero se mira el anterior');
  assert.match(base, /return false;   \/\/ 'aplicado' ya avisó/);
  const ya = cuerpo('_resolverCobroEnDudaYa');
  // «no llegó» (sexta refutación): primero la espera, luego la segunda lectura, y solo entonces se RELEE la cuenta y DESPUÉS se suelta el intento (mientras se lee, la cuenta sigue congelada)
  const no = ya.slice(ya.indexOf("if (sondeo.estado === 'no') {"), ya.indexOf('if (vencido) {'));
  const orden = ["this._esperaDeCobroTardio(intento) > 0", "await this._sondearCobro(intento)", "if (intento.enviado) await this._adoptarCuentaDeLaBase(intento.cuentaId);", "this._soltarCobroEnDuda(intento.cuentaId, intento.cobroId);", "return 'sin_rastro';"].map((x) => no.indexOf(x));
  assert.ok(orden.every((x) => x > 0) && orden.every((x, i) => i === 0 || x > orden[i - 1]), `la espera, la segunda lectura, releer y soltar — en ese orden: ${orden}`);
  assert.match(no, /return 'en_espera';/);
  assert.match(cuerpo('_cobroEnDudaAplicado'), /if \(!sondeo\.cuenta\) await this\._adoptarCuentaDeLaBase\(intento\.cuentaId\);/);
  assert.match(cuerpo('_sondearCobro'), /if \(rc\.error\) return \{ estado: 'sin_respuesta' \};/, 'sin la cuenta no se concluye');
  assert.match(cuerpo('_guardarCobroEnDuda'), /if \(intento\.enviado\) this\._programarReconciliacion\(\);/);
  assert.match(cuerpo('_cargarCobrosEnDuda'), /this\._programarReconciliacion\(\);/);
  // el aviso de un cobro que salió NO ofrece la mesa completa
  assert.match(cuerpo('_avisarCobroEnDuda'), /TEXTO_SIN_RED_COBRO_EN_DUDA/);
  assert.doesNotMatch(cuerpo('_cobroNoHecho'), /_avisarSinRedCobro\(TEXTO_COBRO_EN_DUDA\)/);
  assert.match(cuerpo('_cobrarEnBase'), /if \(intento && intento\.enviado\) \{ this\._asentarCobroEnDuda\(intento\); this\._avisarCobroEnDuda\(\); \}/);
});

test('S4 estática: el velo — el texto de la tarea, «Reintentar ahora», sin Escape ni toque afuera, solo en la vista de la orden, y el mapa marca la mesa congelada', () => {
  const velo = POS_HTML.slice(POS_HTML.indexOf('id="velo-cobro-en-duda"'), POS_HTML.indexOf('MODAL: CONFIRMAR UN ABONO'));
  assert.ok(velo.length > 200);
  assert.match(velo, /x-show="\$store\.pos\.vista === 'orden' && \$store\.pos\.cuentaCongeladaVisible"/);
  assert.match(velo, /Cobro pendiente de confirmar con la base: espera a que vuelva la red\./);
  assert.match(velo, /Reintentar ahora/);
  assert.match(velo, /\$store\.pos\.reintentarCobroEnDuda\(\)/);
  assert.match(velo, /role="alertdialog"/);
  assert.doesNotMatch(velo, /keydown\.escape|@click\.outside|@click\.self/, 'no se cierra con Escape ni tocando afuera');
  assert.match(POS_HTML, /x-show="\$store\.pos\.mesaCongelada\(mesa\.id\)"/);
  assert.match(POS_HTML, /const TEXTO_CUENTA_CONGELADA = 'Cobro pendiente de confirmar con la base: espera a que vuelva la red\.';/);
});

test('S5 estática: lo que el aviso de un cobro en duda dice y lo que ya no (la mesa completa no se ofrece)', () => {
  assert.match(POS_HTML, /const TEXTO_SIN_RED_COBRO_EN_DUDA = 'Sin red: el cobro por partes y los abonos necesitan red\.';/);
  assert.match(POS_HTML, /const TEXTO_COBRO_EN_DUDA = '[^']*La mesa queda congelada hasta saberlo[^']*«Reintentar ahora»[^']*';/);
  assert.doesNotMatch(POS_HTML.match(/const TEXTO_COBRO_EN_DUDA = '[^']*';/)[0], /la mesa completa sí se puede cobrar|si lo repites igual/);
  assert.ok(SIN_RED_EN_DUDA.length > 10);
});
