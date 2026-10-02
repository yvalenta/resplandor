// Cuenta en mesa, fase 1: correcciones de la refutación a la resincronización de pos.html
// (docs/sdd-cuenta-en-mesa.md §04.8, 1D «pos_sync»). Cada prueba nace de un caso que el refutador
// reprodujo sobre `d5828f5` (R1 a R4) y falla si se quita lo que lo arregla.
//
//   H1 (crítico)  flushDeltas() ya no se ejecuta dos veces en paralelo: `aplicar_delta_orden` NO es
//                 idempotente y la carga inicial, cada SUBSCRIBED y el `online` la llamaban casi juntos.
//   H2 (alto)     la resincronización ya no pisa lo que esta tablet no pudo subir (cobro parcial,
//                 facturar, cerrar el día, abrir mesa, productos): `_pendientes` + `_fusionar…`, y se
//                 vuelve a subir. Un cierre sin subir (o con la purga sin confirmar) no devuelve sus
//                 órdenes a las ventas de hoy: el día no se cierra dos veces.
//   H3 (medio)    una lectura vieja no pisa un eco de Realtime más nuevo (se mira `version`).
//
// El <script> REAL de pos.html corre en un `vm` (scripts/pruebas/_pos-vm.mjs) contra una base falsa con
// las reglas que importan: la RPC de deltas no es idempotente y falla si la orden no existe, el índice
// único «una abierta por mesa», y la red se corta con un interruptor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asentar, crearBaseFalsa, crearPos, delta, dormir, hastaQue, item, mesaBase, ordenBase, ordenLocal,
  plano, soltar, textoDelScript,
} from './_pos-vm.mjs';

const lista = (mapa) => [...mapa.values()];
const qty = (orden, id) => orden.items.find((i) => i.id === id)?.qty ?? 0;
const sinPendientes = (pos) => Object.keys(plano(pos._pendientes)).length === 0;

// ───────────────────────── H1: un solo vaciado de la cola de deltas ─────────────────────────

test('H1: con 4 deltas +1 en cola, la carga inicial, el primer SUBSCRIBED y el `online` la vacían UNA vez (4 RPC, 4 limonadas)', async () => {
  const base = crearBaseFalsa({ latenciaMs: 15, mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 5000)])] });
  const { pos, supabase, eventosVentana } = crearPos({ base });
  // la tablet estuvo sin red: el mesero sumó 4 limonadas (4 deltas +1) y recargó el POS
  pos.colaDeltas = [1, 2, 3, 4].map(() => delta('o1', 'p2', +1));

  await pos.sincronizarSupabase();                 // arrancarApp: la carga inicial arranca la primera vaciada
  pos.escucharEventosRealtime();
  supabase.canal('pos_sync').suscripcion('SUBSCRIBED');   // el canal se une enseguida
  pos.flushDeltas();                               // y el navegador avisa `online`
  await hastaQue(() => pos.colaDeltas.length === 0);
  await dormir(250);                               // por si una segunda vaciada llegara tarde

  assert.equal(base.rpcs.length, 4, `RPC enviados: ${base.rpcs.length} (con la carrera eran 7)`);
  assert.equal(qty(base.ordenes.get('o1'), 'p2'), 4, 'cada delta se aplicó una sola vez');
  assert.equal(pos.colaDeltas.length, 0);
  assert.equal(typeof eventosVentana, 'object');
});

test('H1: dos deltas -1 (cobro parcial) tampoco se aplican dos veces: de 3 unidades quedan 1, no 0', async () => {
  const base = crearBaseFalsa({ latenciaMs: 15, mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 5000, 3)])] });
  const { pos, supabase } = crearPos({ base });
  pos.colaDeltas = [delta('o1', 'p1', -1, 5000), delta('o1', 'p1', -1, 5000)];

  await pos.sincronizarSupabase();
  pos.escucharEventosRealtime();
  supabase.canal('pos_sync').suscripcion('SUBSCRIBED');
  await hastaQue(() => pos.colaDeltas.length === 0);
  await dormir(250);

  assert.equal(base.rpcs.length, 2);
  assert.equal(qty(base.ordenes.get('o1'), 'p1'), 1, 'el ítem no desaparece de la orden sin cobrarse');
});

test('H1: muchas llamadas a flushDeltas a la vez hacen UNA pasada; un delta que entra durante el vaciado también sale, una vez', async () => {
  const base = crearBaseFalsa({ latenciaMs: 20, ordenes: [ordenBase('o1', 3, [])], mesas: [mesaBase(3)] });
  const { pos } = crearPos({ base });
  pos.remoto = 'ok';
  pos.colaDeltas = [delta('o1', 'a', +1), delta('o1', 'b', +1)];

  const llamadas = [pos.flushDeltas(), pos.flushDeltas(), pos.flushDeltas(), pos.flushDeltas(), pos.flushDeltas()];
  await dormir(30);                                // la primera RPC va en vuelo
  pos._encolarDelta(delta('o1', 'c', +1));         // entra un delta nuevo mientras se vacía…
  llamadas.push(pos.flushDeltas());                // …y alguien pide otra vaciada
  await Promise.all(llamadas);

  assert.deepEqual(base.rpcs.map((r) => r.item).sort(), ['a', 'b', 'c'], 'cada delta salió exactamente una vez');
  assert.equal(pos.colaDeltas.length, 0);
  assert.ok(!pos._vaciando, 'el candado queda libre');
});

test('H1: si un RPC falla, el candado se suelta y el siguiente intento reintenta (sin duplicar nada)', async () => {
  const base = crearBaseFalsa({ ordenes: [ordenBase('o1', 3, [])], mesas: [mesaBase(3)] });
  const { pos } = crearPos({ base });
  pos.remoto = 'ok';
  pos.colaDeltas = [delta('o1', 'a', +1)];

  base.fallar('rpc:aplicar_delta_orden');
  await pos.flushDeltas();
  assert.equal(pos.colaDeltas.length, 1, 'el delta que no se pudo aplicar sigue en la cola');
  assert.ok(!pos._vaciando);

  base.repararTodo();
  await pos.flushDeltas();
  assert.equal(pos.colaDeltas.length, 0);
  assert.deepEqual(base.rpcs.map((r) => [r.item, r.delta]), [['a', 1]], 'se aplicó una sola vez');
});

test('H1: offline no vacía nada, y con la cola vacía no hay trabajo', async () => {
  const base = crearBaseFalsa({ ordenes: [ordenBase('o1', 3, [])] });
  const { pos } = crearPos({ base });
  pos.colaDeltas = [delta('o1', 'a', +1)];
  pos.remoto = 'offline';
  await pos.flushDeltas();
  assert.equal(base.rpcs.length, 0);
  pos.remoto = 'ok'; pos.colaDeltas = [];
  await pos.flushDeltas();
  assert.equal(base.rpcs.length, 0);
});

// ───────────────────────── H2: lo que no subió no se pierde ─────────────────────────

for (const modo of ['ok', 'offline']) {
  // `ok`: la red cayó a mitad de turno y el POS aún no lo sabe (cada subida lanza). `offline`: el POS ya
  // lo marcó (pushASupabase descarta). Los dos terminan igual.
  test(`H2 (cobro parcial, remoto «${modo}»): lo cobrado sin red NO desaparece al reconectar: se conserva, se sube y el cierre del día lo cuenta`, async () => {
    const base = crearBaseFalsa({ mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 5000), item('p2', 7000)], 3)] });
    const { pos } = crearPos({ base });
    pos.mesas = [mesaBase(3)];
    pos.ordenes = [ordenLocal('o1', 3, [item('p1', 5000), item('p2', 7000)], 3)];
    pos.mesaActiva = pos.mesas[0]; pos.ordenActiva = pos.ordenes[0];
    pos.remoto = modo;
    base.red = false;

    pos.facturarParcial(['p2']);                    // se cobran 7.000 sin red
    await asentar();
    assert.equal(pos.totalHoy, 7000);
    assert.equal(pos.colaDeltas.length, 1, 'el descuento de la orden abierta quedó en la cola');
    assert.equal(Object.keys(plano(pos._pendientes)).filter((k) => k.startsWith('ordenes:')).length, 1, 'y la orden cerrada nueva, marcada como sin subir');

    base.red = true;                                 // vuelve la red: SUBSCRIBED
    await pos._resincronizarEnVivo();
    await hastaQue(() => pos.colaDeltas.length === 0 && sinPendientes(pos));

    assert.equal(pos.totalHoy, 7000, 'ventas de hoy: siguen siendo 7.000 (con el defecto quedaban en 0)');
    const cerradas = lista(base.ordenes).filter((o) => o.estado === 'cerrada');
    assert.equal(cerradas.length, 1, 'la orden cerrada llegó a la base');
    assert.deepEqual(cerradas[0].items.map((i) => i.id), ['p2']);
    assert.equal(cerradas[0].total, 7000);
    assert.deepEqual(base.ordenes.get('o1').items.map((i) => i.id), ['p1'], 'y la abierta quedó solo con lo no cobrado');
    assert.ok(sinPendientes(pos), 'nada queda marcado como sin subir');
  });
}

test('H2 (cerrar el día con una base SIN cerrar_dia, la de la ola B): el cierre sube con un upsert y borra las órdenes; no vuelven a las ventas de hoy; no se puede cerrar el mismo día dos veces', async () => {
  const a = ordenBase('a', 3, [item('pa', 30000)], 2, 'cerrada');
  const b = ordenBase('b', 3, [item('pb', 56000)], 2, 'cerrada');
  const base = crearBaseFalsa({ mesas: [mesaBase(3, { estado: 'libre' })], ordenes: [a, b] });
  const { pos } = crearPos({ base });
  pos.mesas = [mesaBase(3, { estado: 'libre' })];
  pos.ordenes = [a, b].map((r) => pos.parseOrden(r));
  pos.remoto = 'ok';

  assert.equal(await pos.cerrarDia(), 'legado', 'la base no tiene cerrar_dia: el POS sigue por el camino de siempre');
  await asentar();
  assert.equal(pos.cierres.length, 1);
  assert.equal(pos.cierres[0].sync, 'ok');
  assert.equal(pos.cierres[0].purgar, undefined, 'la purga ya terminó');
  assert.equal(base.cierres.size, 1, 'el cierre llegó a la base una vez');
  assert.equal(lista(base.cierres)[0].total_ventas, 86000);
  assert.equal(base.ordenes.size, 0, 'y se borraron de la base las órdenes archivadas');

  await pos._resincronizarEnVivo(); await asentar();
  assert.equal(pos.ordenesHoy.length, 0, 'las órdenes archivadas no vuelven a las ventas de hoy');
  assert.equal(pos.totalHoy, 0);
  assert.equal(pos.puedesCerrar, false, 'no se puede cerrar el día otra vez con las mismas ventas');
  assert.equal(await pos.cerrarDia(), 'sin_ventas');   // un segundo «Cerrar día» no hace nada
  assert.equal(pos.cierres.length, 1);
  assert.equal(base.cierres.size, 1);
});

test('H2 (cerrar el día): el cierre subió pero la base no pudo borrar las órdenes: no vuelven, y la purga se reintenta al reconectar', async () => {
  const a = ordenBase('a', 3, [item('pa', 30000)], 2, 'cerrada');
  const base = crearBaseFalsa({ mesas: [mesaBase(3, { estado: 'libre' })], ordenes: [a] });
  const { pos, guardado } = crearPos({ base });
  pos.mesas = [mesaBase(3, { estado: 'libre' })];
  pos.ordenes = [pos.parseOrden(a)];
  pos.remoto = 'ok';
  base.fallar('delete:ordenes');

  pos.cerrarDia();
  await asentar();
  assert.equal(pos.cierres[0].sync, 'ok', 'el cierre sí subió');
  assert.deepEqual(plano(pos.cierres[0].purgar), ['a'], 'pero la purga sigue pendiente (y guardada)');
  assert.deepEqual(plano(guardado('pos_cierres')[0].purgar), ['a']);
  assert.equal(base.ordenes.size, 1);

  await pos._resincronizarEnVivo(); await asentar();
  assert.equal(pos.ordenesHoy.length, 0, 'aunque la base aún devuelve la orden, no vuelve a las ventas de hoy');

  base.repararTodo();
  await pos._resincronizarEnVivo();                // el siguiente SUBSCRIBED reintenta la purga
  await hastaQue(() => !pos.cierres[0].purgar);
  assert.equal(base.ordenes.size, 0, 'la purga se completó');
  assert.equal(guardado('pos_cierres')[0].purgar, undefined);
});

test('H2 (cerrar el día): un cierre «Sin respaldo» de una versión anterior (cerrado sin red) no sobrevive a recargar: sus ventas vuelven a ser cobros normales, el cierre local se descarta y nada se borra de la base', async () => {
  const a = ordenBase('a', 3, [item('pa', 30000)], 2, 'cerrada');
  const base = crearBaseFalsa({ mesas: [mesaBase(3, { estado: 'libre' })], ordenes: [] });
  const almacen = new Map([['pos_cierres', JSON.stringify([{ id: 'viejo', fecha: new Date().toISOString(), total: 30000, sync: 'error', purgar: ['a'],
    ordenes: [{ ...ordenLocal('a', 3, [item('pa', 30000)], 2, 'cerrada'), cerradaEn: new Date().toISOString() }] }])]]);
  const segunda = crearPos({ base, almacen });   // recarga con red: la base NO tiene la venta a (nunca llegó)
  segunda.pos.cargarCachéLocal();
  segunda.pos.rol = 'admin'; segunda.pos.rolCargado = true;
  await segunda.pos.sincronizarSupabase();         // carga inicial: también trae los cierres de la base
  await hastaQue(() => base.ordenes.has('a'));
  assert.equal(segunda.pos.cierres.length, 0, 'el cierre local se descartó: ya no hay «Sin respaldo»');
  assert.equal(base.ordenes.get('a').estado, 'cerrada', 'la venta se subió como un cobro normal');
  assert.equal(base.cierres.size, 0, 'y NO se guardó ningún cierre a partir de él');
  assert.equal(segunda.supabase.de('ordenes', 'delete').length, 0, 'nunca se purga nada a partir de un cierre sin respaldo');
  assert.equal(segunda.pos.ordenesHoy.length, 1, 'la venta está entre las de hoy, para cerrar de nuevo con red');
  assert.match(segunda.pos.aviso.texto, /cierre del día sin respaldo/);
});

test('H2 (facturar sin red una orden con deltas en cola): al reconectar la base queda con los ítems locales UNA vez, la orden cerrada y la mesa libre', async () => {
  const base = crearBaseFalsa({ mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 5000)], 1)] });
  const { pos } = crearPos({ base });
  pos.mesas = [mesaBase(3)];
  pos.ordenes = [ordenLocal('o1', 3, [item('p1', 5000)], 1)];
  pos.mesaActiva = pos.mesas[0]; pos.ordenActiva = pos.ordenes[0];
  pos.remoto = 'ok';
  base.red = false;

  pos._agregarAlPedido({ id: 'p2', nombre: 'p2', precio: 7000 }, '');
  pos._agregarAlPedido({ id: 'p2', nombre: 'p2', precio: 7000 }, '');
  await asentar();
  assert.equal(pos.colaDeltas.length, 2);
  pos.facturar();                                  // factura una orden cuyos ítems solo existen aquí
  await asentar();
  assert.equal(pos.ordenes.find((o) => o.id === 'o1').estado, 'cerrada');

  base.red = true;
  await pos._resincronizarEnVivo();
  await hastaQue(() => pos.colaDeltas.length === 0 && sinPendientes(pos));

  const o1 = base.ordenes.get('o1');
  assert.equal(o1.estado, 'cerrada');
  assert.deepEqual(o1.items.map((i) => [i.id, i.qty]), [['p1', 1], ['p2', 2]], 'los deltas no se cuentan encima de los ítems que ya subió facturar');
  assert.equal(o1.total, 19000);
  assert.equal(base.mesas.get(3).estado, 'libre', 'la mesa también quedó libre en la base');
  assert.equal(pos.mesas.find((m) => m.id === 3).estado, 'libre');
});

test('H2 (facturar sin red, sin deltas): la orden que la base aún tiene abierta no pisa la cerrada de la tablet; se sube y la mesa queda libre', async () => {
  const base = crearBaseFalsa({ mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 5000)], 1)] });
  const { pos } = crearPos({ base });
  pos.mesas = [mesaBase(3)];
  pos.ordenes = [ordenLocal('o1', 3, [item('p1', 5000)], 1)];
  pos.mesaActiva = pos.mesas[0]; pos.ordenActiva = pos.ordenes[0];
  pos.remoto = 'ok';
  base.red = false;
  pos.facturar(); await asentar();
  assert.equal(pos.totalHoy, 5000);

  base.red = true;                                 // la base todavía tiene o1 abierta, con la MISMA versión
  await pos._resincronizarEnVivo();
  assert.equal(pos.ordenes.find((o) => o.id === 'o1').estado, 'cerrada', 'la cobrada sigue cobrada en la tablet');
  assert.equal(pos.totalHoy, 5000, 'y sigue en las ventas de hoy');
  await hastaQue(() => sinPendientes(pos));
  assert.equal(base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(base.mesas.get(3).estado, 'libre');
});

test('H2 (facturar sin red con deltas en cola): la orden cobrada sube ENTERA y sus deltas se sueltan (no se cuentan dos veces ni la venta queda en $0)', async () => {
  // Antes (fase 1) la orden esperaba a que los deltas se aplicaran. Con la RLS de los permisos por rol eso trababa la cola de un
  // mesero (el esqueleto subía «cerrado y vacío» y los deltas fallaban con «no existe»): refutación de la ola B, hallazgo 1.
  // Ahora una orden CERRADA en esta tablet sube su fila completa (los ítems locales ya incluyen los deltas) y sus deltas sobran.
  const base = crearBaseFalsa({ mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 5000)], 1)] });
  const { pos } = crearPos({ base });
  pos.mesas = [mesaBase(3)];
  pos.ordenes = [ordenLocal('o1', 3, [item('p1', 5000)], 1)];
  pos.mesaActiva = pos.mesas[0]; pos.ordenActiva = pos.ordenes[0];
  pos.remoto = 'ok';
  base.red = false;
  pos._agregarAlPedido({ id: 'p2', nombre: 'p2', precio: 7000 }, '');
  pos.facturar();
  await asentar();
  assert.equal(pos.colaDeltas.length, 1, 'sin red el delta queda en cola');

  base.red = true;
  base.fallar('rpc:aplicar_delta_orden');           // vuelve la red y la RPC aún falla: ya no importa, el delta no hace falta
  await pos._resincronizarEnVivo();
  await hastaQue(() => pos.colaDeltas.length === 0 && sinPendientes(pos));
  assert.equal(base.ordenes.get('o1').estado, 'cerrada');
  assert.deepEqual(plano(base.ordenes.get('o1').items.map((i) => [i.id, i.qty])), [['p1', 1], ['p2', 1]], 'p2 una sola vez');
  assert.equal(base.ordenes.get('o1').total, 12000);
  assert.equal(base.rpcs.length, 0, 'ningún delta llegó a la base');
});

test('H2 (abrir mesa sin red y pedir): la orden no existe en la base; al reconectar se crea y los deltas la llenan, sin duplicar', async () => {
  const base = crearBaseFalsa({ mesas: [mesaBase(3, { estado: 'libre' })] });
  const { pos } = crearPos({ base });
  pos.mesas = [mesaBase(3, { estado: 'libre' })];
  pos.remoto = 'offline';
  base.red = false;

  await pos.abrirMesa(pos.mesas[0]);
  pos._agregarAlPedido({ id: 'p1', nombre: 'p1', precio: 5000 }, '');
  pos._agregarAlPedido({ id: 'p1', nombre: 'p1', precio: 5000 }, '');
  await asentar();
  assert.equal(pos.ordenes.length, 1);
  assert.equal(pos.colaDeltas.length, 2);

  base.red = true;
  await pos._resincronizarEnVivo();
  await hastaQue(() => pos.colaDeltas.length === 0 && sinPendientes(pos));

  assert.equal(base.ordenes.size, 1, 'la orden llegó a la base (antes la resincronización la borraba y los deltas fallaban para siempre)');
  const o = lista(base.ordenes)[0];
  assert.equal(o.estado, 'abierta');
  assert.deepEqual(plano(o.items.map((i) => [i.id, i.qty])), [['p1', 2]], 'dos unidades: ni 4 (ítems + deltas) ni 0');
  assert.equal(o.total, 10000);
  assert.equal(base.mesas.get(3).estado, 'ocupada');
  assert.equal(pos.ordenes.length, 1);
});

test('H2 (fantasma): la orden abierta sin red en una mesa que otra tablet ya ocupó se descarta, con sus deltas (no bloquean la cola)', async () => {
  const base = crearBaseFalsa({ mesas: [mesaBase(3, { estado: 'libre' })] });
  const { pos } = crearPos({ base });
  pos.mesas = [mesaBase(3, { estado: 'libre' })];
  pos.remoto = 'offline';
  base.red = false;
  await pos.abrirMesa(pos.mesas[0]);
  pos._agregarAlPedido({ id: 'p1', nombre: 'p1', precio: 5000 }, '');
  await asentar();
  const fantasma = pos.ordenes[0].id;

  base.ordenes.set('o9', { ...ordenBase('o9', 3, [item('q1', 9000)], 4) });   // mientras tanto, otra tablet ocupó la mesa 3
  base.mesas.get(3).estado = 'ocupada';
  base.red = true;
  await pos._resincronizarEnVivo(); await asentar();

  assert.deepEqual(plano(pos.ordenes.map((o) => o.id)), ['o9'], 'queda la orden real y no el fantasma');
  assert.equal(pos.colaDeltas.length, 0, 'el delta del fantasma no se queda bloqueando la cola');
  assert.ok(!(`ordenes:${fantasma}` in plano(pos._pendientes)));
  assert.equal(base.ordenes.size, 1);
});

test('H2: lo pendiente sobrevive a recargar la página: la carga inicial no pisa la orden sin subir y la sube', async () => {
  const base = crearBaseFalsa({ mesas: [mesaBase(3, { estado: 'libre' })] });
  const primera = crearPos({ base });
  primera.pos.mesas = [mesaBase(3, { estado: 'libre' })];
  primera.pos.remoto = 'offline';
  base.red = false;
  await primera.pos.abrirMesa(primera.pos.mesas[0]);
  const id = primera.pos.ordenes[0].id;
  assert.ok(`ordenes:${id}` in primera.guardado('pos_pendientes'), 'la marca está en localStorage');

  base.red = true;
  const segunda = crearPos({ base, almacen: primera.almacen });
  segunda.pos.cargarCachéLocal();
  assert.ok(`ordenes:${id}` in plano(segunda.pos._pendientes));
  await segunda.pos.sincronizarSupabase();
  assert.deepEqual(plano(segunda.pos.ordenes.map((o) => o.id)), [id], 'la orden sin subir sigue en la tablet');
  assert.equal(segunda.pos.mesas.find((m) => m.id === 3).estado, 'ocupada', 'y su mesa también');
  await hastaQue(() => base.ordenes.has(id) && sinPendientes(segunda.pos));
  assert.equal(base.ordenes.get(id).estado, 'abierta');
  assert.equal(base.mesas.get(3).estado, 'ocupada');
});

test('H2: una mesa y un producto sin subir conservan lo local (la mesa, con el token que tiene la base); los demás toman lo de la base', async () => {
  const TOKEN_BASE = 'b'.repeat(48);
  const base = crearBaseFalsa({
    mesas: [mesaBase(3, { token: TOKEN_BASE }), mesaBase(4, { estado: 'ocupada', token: 'c'.repeat(48) })],
    productos: [
      { id: 'p1', categoria: 'X', nombre: 'p1', precio: 5000, descripcion: '', activo: true },
      { id: 'p2', categoria: 'X', nombre: 'p2', precio: 8000, descripcion: '', activo: true },
    ],
    ordenes: [ordenBase('o3', 3, [item('p1', 5000)], 1)],
  });
  const { pos } = crearPos({ base });
  pos.mesas = [mesaBase(3), mesaBase(4)];
  pos.ordenes = [ordenLocal('o3', 3, [item('p1', 5000)], 1)];
  pos.productos = [
    { id: 'p1', cat: 'X', nombre: 'p1', precio: 5000, desc: '', activo: true },
    { id: 'p2', cat: 'X', nombre: 'p2', precio: 7000, desc: '', activo: true },   // la caché está atrasada
  ];
  pos.mesaActiva = pos.mesas[0]; pos.ordenActiva = pos.ordenes[0];
  pos.remoto = 'offline';
  base.red = false;

  pos.facturar();                                  // libera la mesa 3 sin red
  pos.productoEditando = pos.productos[0];
  pos.productoForm = { categoria: 'X', nombre: 'p1', precio: '6500', desc: '' };
  pos.guardarProducto();                           // sube el precio del producto p1 sin red
  await asentar();

  base.red = true;
  await pos._resincronizarEnVivo();
  await hastaQue(() => sinPendientes(pos));

  assert.equal(base.mesas.get(3).estado, 'libre', 'la mesa libre llegó a la base');
  assert.equal(base.mesas.get(3).token, TOKEN_BASE, 'sin tocar el token (formatMesa no lo manda)');
  assert.equal(base.productos.get('p1').precio, 6500, 'el precio editado sin red llegó a la base');
  assert.equal(pos.productos.find((p) => p.id === 'p1').precio, 6500);
  assert.equal(pos.productos.find((p) => p.id === 'p2').precio, 8000, 'el producto sin cambios locales toma lo de la base');
  assert.equal(pos.mesas.find((m) => m.id === 3).token, TOKEN_BASE);
  assert.equal(pos.mesas.find((m) => m.id === 4).token, 'c'.repeat(48), 'la mesa 4 toma la fila de la base');
});

test('H2: una orden local que la base no devuelve y NO está pendiente (otra tablet la archivó) se descarta', async () => {
  const base = crearBaseFalsa({ mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 5000)], 1)] });
  const { pos } = crearPos({ base });
  pos.ordenes = [ordenLocal('o1', 3, [item('p1', 5000)], 1), ordenLocal('zz', 4, [item('p1', 5000)], 1, 'cerrada')];
  await pos.sincronizarSupabase({ soloEnVivo: true });
  assert.deepEqual(plano(pos.ordenes.map((o) => o.id)), ['o1']);
});

test('H2: pushASupabase devuelve true si la base recibió la fila, false si no se intentó (offline) y lanza si falla; la marca solo se suelta con la base confirmada', async () => {
  const base = crearBaseFalsa({ mesas: [mesaBase(3)] });
  const { pos, guardado } = crearPos({ base });
  const mesa = { id: 3, capacidad: 4, estado: 'libre' };

  assert.equal(await pos.pushASupabase('mesas', mesa), true);
  assert.ok(sinPendientes(pos), 'subida confirmada: sin marca');

  pos.remoto = 'offline';
  assert.equal(await pos.pushASupabase('mesas', mesa), false);
  assert.ok('mesas:3' in plano(pos._pendientes), 'no se intentó: queda marcada');
  assert.ok('mesas:3' in guardado('pos_pendientes'), 'y la marca se guarda');

  pos.remoto = 'ok';
  base.red = false;
  await assert.rejects(pos.pushASupabase('mesas', mesa));
  assert.ok('mesas:3' in plano(pos._pendientes));

  base.red = true;
  assert.equal(await pos.pushASupabase('mesas', mesa), true);
  assert.ok(sinPendientes(pos), 'ahora sí: la base confirmó');
  assert.deepEqual(guardado('pos_pendientes'), {});

  // cierres y otras tablas sin marca: devuelven igual true/false
  assert.equal(await pos.pushASupabase('cierres', { id: 'c', fecha: new Date().toISOString(), total: 0, ordenes: [] }), true);
  assert.ok(sinPendientes(pos), 'los cierres no se marcan: tienen su propio sync');
});

test('H2: con dos subidas de la misma fila en vuelo, si una falla la marca se queda aunque la otra salga bien', async () => {
  let n = 0;
  const { pos } = crearPos({
    responder: async (c) => {
      if (c.op !== 'upsert') return undefined;
      const mia = ++n;
      await dormir(mia === 1 ? 30 : 5);            // la 1.ª termina DESPUÉS de la 2.ª
      return mia === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: null, error: null };
    },
  });
  pos.remoto = 'ok';
  const fila = { id: 3, capacidad: 4, estado: 'libre' };
  const primera = pos.pushASupabase('mesas', fila).catch(() => 'fallo');
  const segunda = pos.pushASupabase('mesas', fila);
  assert.equal(await segunda, true);
  assert.ok('mesas:3' in plano(pos._pendientes), 'la 1.ª sigue en vuelo');
  assert.equal(await primera, 'fallo');
  assert.ok('mesas:3' in plano(pos._pendientes), 'una falló: la marca se queda y la próxima pasada la sube');
});

test('H2: reabrir una orden de un cierre con la purga pendiente la saca de `purgar` (no se borra una orden viva) y la resincronización la conserva', async () => {
  const a = ordenLocal('a', 3, [item('pa', 9000)], 2, 'cerrada');
  const b = ordenLocal('b', 4, [item('pb', 4000)], 2, 'cerrada');
  const base = crearBaseFalsa({
    mesas: [mesaBase(3, { estado: 'libre' }), mesaBase(4, { estado: 'libre' })],
    ordenes: [ordenBase('a', 3, [item('pa', 9000)], 2, 'cerrada'), ordenBase('b', 4, [item('pb', 4000)], 2, 'cerrada')],
  });
  const { pos, supabase } = crearPos({ base });
  pos.mesas = [mesaBase(3, { estado: 'libre' }), mesaBase(4, { estado: 'libre' })];
  pos.remoto = 'ok';
  const cierre = { id: 'c1', fecha: new Date().toISOString(), total: 13000, sync: 'error', ordenes: [a, b], purgar: ['a', 'b'] };
  pos.cierres = [cierre];

  pos.transaccionCierre = pos.cierres[0];
  await pos.reabrirOrden(a, 3);
  await hastaQue(() => pos.cierres[0].sync === 'ok' && !pos.cierres[0].purgar);
  await asentar();

  assert.deepEqual(plano(pos.cierres[0].ordenes.map((o) => o.id)), ['b']);
  assert.equal(pos.cierres[0].purgar, undefined, 'el cierre ya subió y su purga (solo b) terminó');
  assert.equal(base.ordenes.has('b'), false, 'b sí se purgó de la base');
  assert.equal(base.ordenes.get('a').estado, 'abierta', 'la orden reabierta quedó viva en la base');
  const borrados = supabase.de('ordenes', 'delete').flatMap((c) => c.filtros.flatMap(([, v]) => v));
  assert.deepEqual(plano(borrados), ['b'], 'solo se pidió borrar b: a salió de la purga al reabrirla');

  await pos._resincronizarEnVivo(); await asentar();
  assert.equal(pos.ordenes.find((o) => o.id === 'a')?.estado, 'abierta', 'la resincronización la conserva');
});

// ───────────────────────── H3: una lectura vieja no pisa un eco más nuevo ─────────────────────────

test('H3: la lectura de reconexión tomada ANTES de un cambio no pisa el eco v2 que llegó primero; facturar sube los ítems nuevos', async () => {
  let soltarLectura;
  const { pos, supabase } = crearPos({
    responder: (c) => {
      if (c.op === 'select' && c.tabla === 'ordenes' && c.limite !== 0) {   // (los sondeos de columnas, limit(0), no son la lectura que se retiene)
        // instantánea tomada antes de que la base aplicara el delta de p2 (versión 1)
        return new Promise((r) => { soltarLectura = () => r({ data: [ordenBase('o1', 3, [item('p1', 5000)], 1)], error: null }); });
      }
      if (c.op === 'select' && c.tabla === 'mesas') return { data: [mesaBase(3)], error: null };
      return undefined;
    },
  });
  pos.mesas = [mesaBase(3)];
  pos.ordenes = [ordenLocal('o1', 3, [item('p1', 5000)], 1)];
  pos.mesaActiva = pos.mesas[0]; pos.ordenActiva = pos.ordenes[0];

  const lectura = pos._resincronizarEnVivo();      // SUBSCRIBED tras reconectar
  await soltar(); await soltar();
  // llega el eco de Realtime con el delta ya aplicado (v2: p1 + p2)
  pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: ordenBase('o1', 3, [item('p1', 5000), item('p2', 7000)], 2) });
  assert.equal(pos.totalOrdenActiva, 12000);
  soltarLectura(); await lectura; await asentar();

  const o1 = pos.ordenes.find((o) => o.id === 'o1');
  assert.equal(o1.version, 2, 'sigue en la versión del eco');
  assert.deepEqual(plano(o1.items.map((i) => i.id)), ['p1', 'p2']);
  assert.equal(pos.totalOrdenActiva, 12000, 'ni la pantalla ni el total vuelven a 5.000');
  pos.facturar(); await asentar();
  const subida = supabase.de('ordenes', 'upsert').at(-1).cuerpo;
  assert.deepEqual(plano(subida.items.map((i) => i.id)), ['p1', 'p2'], 'facturar no borra en la base el ítem de la otra tablet');
  assert.equal(subida.total, 12000);
});

test('H3: con la MISMA versión o una más nueva en la base, manda la base (otra tablet facturó con un upsert, que no sube `version`)', async () => {
  const { pos } = crearPos({
    responder: (c) => {
      if (c.op === 'select' && c.tabla === 'ordenes') {
        return { data: [ordenBase('o1', 3, [item('p1', 5000)], 2, 'cerrada'), ordenBase('o2', 4, [item('q1', 9000)], 7)], error: null };
      }
      return undefined;
    },
  });
  pos.ordenes = [ordenLocal('o1', 3, [item('p1', 5000)], 2), ordenLocal('o2', 4, [], 3)];
  await pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(pos.ordenes.find((o) => o.id === 'o1').estado, 'cerrada', 'misma versión: gana la base');
  assert.deepEqual(plano(pos.ordenes.find((o) => o.id === 'o2').items.map((i) => i.id)), ['q1'], 'versión más nueva en la base: gana la base');
});

test('H3: la segunda lectura de la carga inicial tampoco pisa un eco más nuevo', async () => {
  const { pos } = crearPos({
    responder: (c) => (c.op === 'select' && c.tabla === 'ordenes' ? { data: [ordenBase('o1', 3, [item('p1', 5000)], 1)], error: null } : undefined),
  });
  pos.ordenes = [ordenLocal('o1', 3, [item('p1', 5000), item('p2', 7000)], 2)];
  await pos.sincronizarSupabase();                 // sin soloEnVivo: la carga inicial
  assert.equal(pos.ordenes[0].version, 2);
  assert.equal(pos.ordenes[0].items.length, 2);
});

// ───────────────────────── estáticas ─────────────────────────

test('estático: flushDeltas tiene candado (_vaciando) y espera la vuelta extra; pushASupabase marca _pendientes; cerrarDia guarda `purgar`', () => {
  const src = textoDelScript();
  const flush = src.slice(src.indexOf('flushDeltas() {'), src.indexOf('agregarProducto(prod)'));
  assert.match(flush, /if \(this\._vaciando\)/, 'flushDeltas sale (esperando) si ya hay un vaciado en curso');
  assert.match(flush, /_vaciarDeNuevo/, 'y pide una vuelta más en vez de lanzar otra en paralelo');
  assert.match(flush, /\.finally\(/, 'el candado se suelta pase lo que pase');
  const push = src.slice(src.indexOf('async pushASupabase('), src.indexOf('// --- 6. GETTERS DE UI ---'));
  assert.match(push, /_pendientes\[clave\] = true/);
  assert.match(push, /return false/, 'offline no es éxito');
  const cerrar = src.slice(src.indexOf('cerrarDia() {'), src.indexOf('abrirModalProducto(p = null)'));   // la definición (el tablero de Administración también lo llama, antes)
  assert.match(cerrar, /purgar: \[\.\.\.idsArchivados\]/);
  assert.doesNotMatch(cerrar, /delete\(\)\.in\(/, 'la purga vive en _purgarOrdenesArchivadas, que mira el error');
  for (const f of ['_fusionarOrdenes', '_fusionarMesas', '_fusionarProductos', '_fusionarCierres']) {
    assert.match(src, new RegExp(`this\\.${f}\\(`), `sincronizarSupabase usa ${f}`);
  }
  assert.match(src, /\.upsert\(\{ \.\.\.this\.formatOrden\(fila\), items: \[\], total: 0 \}, \{ ignoreDuplicates: true \}\)/,
    'una orden pendiente con deltas se crea vacía y sin pisar una existente');
});
