// «Recargar» (y el evento `online`) no deben adelantar una marca «Para llevar» a su línea (re-refutación de la integración version-nueva × para-llevar).
//
// Una línea recién agregada puede no existir todavía en la base: su «+1» (aplicar_delta_orden) va en camino. Por eso _subirMarcaLlevar espera a
// las subidas previas de la cuenta antes de mandar la nota. Pero _vaciarMarcasLlevar —lo que «Recargar» llama para reintentar ya las marcas
// pendientes, y lo que llama el evento `online`— mandaba TODAS las marcas pendientes, también esta, sin esperar al «+1»: la nota llegaba a la
// base antes que la línea, actualizar_nota_item no la encontraba y aun así contestaba bien (sube la `version`), la marca se soltaba como
// guardada, y después llegaba el «+1» con la nota vacía: la línea nacía «aquí» y nada la iba a reintentar.
//
// Arnés: el <script> real de pos.html en un `vm` (_pos-vm.mjs), base falsa de la ola C, con actualizar_nota_item como la función real
// (sin la línea no cambia nada, pero sube la `version` y contesta bien). Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asentar, crearBaseFalsa, crearPos, item, mesaBase, ordenBase, ordenLocal, plano } from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const LIMONADA = { id: 'limonada', nombre: 'Limonada', precio: 5000 };

/** Una cuenta abierta (mesa 3, con un plato) y una base cuyo «+1» de la limonada tarda hasta que la prueba llame a `soltarDelta()`. */
function montarCuenta() {
  const base = crearBaseFalsa({ mesas: [mesaBase(3)], olaC: true });
  const original = base.responder;
  const control = { soltarDelta: null, notas: [] };
  base.responder = async (c) => {
    if (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden' && c.args.p_item_id === LIMONADA.id && !control.soltarDelta) {
      await new Promise((r) => { control.soltarDelta = r; });          // el «+1» de la línea nueva tarda
    }
    if (c.tipo === 'rpc' && c.nombre === 'actualizar_nota_item') {     // como la función real
      control.notas.push([c.args.p_item_id, c.args.p_nota]);
      const o = base.ordenes.get(c.args.p_orden_id);
      if (!o) return { data: null, error: { code: 'P0001', message: `orden ${c.args.p_orden_id} no existe` } };
      o.items = o.items.map((i) => (i.id === c.args.p_item_id ? { ...i, nota: c.args.p_nota } : i));
      o.version = (o.version || 0) + 1;
      return { data: { ...o }, error: null };
    }
    return original(c);
  };
  const t = crearPos({ base });
  t.pos.usuario = YO; t.pos.rol = 'admin';
  base.ordenes.set('o1', { ...ordenBase('o1', 3, [item('a', 10000, 1)], 1) });
  t.pos.mesas = [mesaBase(3)];
  t.pos.ordenes = [ordenLocal('o1', 3, [item('a', 10000, 1)], 1)];
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = t.pos.ordenes[0]; t.pos.remoto = 'ok';
  const enLaBase = () => base.ordenes.get('o1').items.find((i) => i.id === LIMONADA.id);
  const enPantalla = () => t.pos.ordenActiva.items.find((i) => i.id === LIMONADA.id);
  return { t, base, control, enLaBase, enPantalla };
}

/** Agrega la limonada (su «+1» queda en vuelo) y la marca «Para llevar» antes de que la base tenga la línea. */
async function marcarLaLineaNueva({ t }) {
  t.pos._agregarAlPedido(LIMONADA, '');
  await asentar();
  t.pos.alternarLlevar(t.pos.ordenActiva.items.find((i) => i.id === LIMONADA.id));      // la marca espera al «+1» (las subidas previas)
  await asentar();
  assert.equal(t.pos._hayCambiosSinGuardar(), true, 'hay algo sin guardar: la marca y el «+1»');
}

test('«Recargar» con un producto recién agregado (su «+1» en vuelo) y marcado «Para llevar»: su espera no adelanta la marca, y la línea nace marcada', async () => {
  const c = montarCuenta();
  await marcarLaLineaNueva(c);
  // Lo que hace «Recargar» (con la espera acortada): espera lo guardable y reintenta ya las marcas.
  c.t.pos._esperaRecargaPasos = 3; c.t.pos._esperaRecargaMs = 5;
  assert.equal(await c.t.pos._esperarCambiosSinGuardar(), false, 'no está guardado: el «+1» sigue en vuelo, así que no se recarga');
  assert.deepEqual(c.control.notas, [], 'y la marca NO salió antes que su línea (la nota habría caído en el vacío)');
  assert.equal(c.t.pos._hayCambiosSinGuardar(), true, 'sigue pendiente: nada la dio por guardada');

  c.control.soltarDelta();                                            // llega el «+1»
  await asentar(40);
  assert.deepEqual(plano(c.control.notas), [[LIMONADA.id, 'Para llevar']], 'la marca sale cuando la línea ya está en la base, y una sola vez');
  assert.match(c.enLaBase().nota, /Para llevar/, 'la línea quedó en la base CON «Para llevar»');
  assert.equal(c.t.pos._hayCambiosSinGuardar(), false);
  assert.equal(await c.t.pos._esperarCambiosSinGuardar(), true, 'ahora sí: nada sin guardar, el siguiente «Recargar» recarga');
});

test('reintentar las marcas pendientes (lo que hace el evento `online` al volver la red) tampoco adelanta una marca que espera el «+1» de su línea: es la misma causa', async () => {
  const c = montarCuenta();
  await marcarLaLineaNueva(c);
  const alVolverLaRed = c.t.pos._vaciarMarcasLlevar();                // el controlador de `online` llama a _vaciarMarcasLlevar con el «+1» todavía en vuelo
  await asentar(40);
  assert.deepEqual(c.control.notas, [], 'la marca no salió antes que su línea');
  c.control.soltarDelta();
  await alVolverLaRed;
  await asentar(40);
  assert.match(c.enLaBase().nota, /Para llevar/, 'la línea quedó en la base con su marca');
});

test('«Recargar» sí adelanta lo que ya esperaba su reintento: una marca cuyo primer envío falló sale ya, sin esperar el reloj de 1,5 s', async () => {
  const c = montarCuenta();
  c.t.pos._agregarAlPedido(LIMONADA, '');
  await asentar();
  c.control.soltarDelta();                                            // la línea ya está en la base
  await asentar(40);
  // Un reintento que espera su reloj: el primer envío falló por la red.
  c.t.pos._esperaMarcasLlevar = () => 60000;
  const original = c.base.responder;
  let falla = true;
  c.base.responder = async (x) => (falla && x.tipo === 'rpc' && x.nombre === 'actualizar_nota_item'
    ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : original(x));
  c.t.pos.alternarLlevar(c.enPantalla());
  await asentar(40);
  assert.equal(c.t.pos._hayCambiosSinGuardar(), true, 'la marca espera su reintento');
  falla = false;                                                      // la red vuelve; el reloj de reintento tardaría un minuto
  c.t.pos._esperaRecargaPasos = 20; c.t.pos._esperaRecargaMs = 5;
  assert.equal(await c.t.pos._esperarCambiosSinGuardar(), true, '«Recargar» la reintentó ya y la base la confirmó');
  assert.match(c.enLaBase().nota, /Para llevar/);
});

test('(control) sin tocar «Recargar»: la marca espera al «+1» y se guarda', async () => {
  const c = montarCuenta();
  await marcarLaLineaNueva(c);
  c.control.soltarDelta();                                            // llega el «+1»
  await asentar(40);
  assert.match(c.enLaBase().nota, /Para llevar/, 'la línea quedó en la base con su marca');
  assert.equal(c.t.pos._hayCambiosSinGuardar(), false);
  assert.match(c.enPantalla().nota, /Para llevar/);
});
