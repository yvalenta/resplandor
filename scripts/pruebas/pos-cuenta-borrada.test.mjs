// UNA CUENTA QUE LA BASE YA NO TIENE NO SE COBRA, y un cambio PROPIO en camino no es «otra tablet la tocó» (séptima refutación, 2026-10-06; tareas/2026-10-04-hallazgos-domingo.md).
// El POS REAL (el <script> de pos.html en un `vm`) contra la base falsa de _pos-vm.mjs con la LÁPIDA (migración 20261006150000: `lapida: true`). Con supabase-js y Postgres reales, dos tablets: pos-cuenta-borrada-real.test.mjs.
//
// El defecto (r7, ALTO; ya estaba en producción): otra tablet cobró TODA la cuenta por partes y liberó la mesa (o la anuló y la liberó): la fila de la cuenta ya no existe. La relectura de la mesa completa
// trataba «0 filas» como «no se pudo leer» y cerraba con la copia vieja; el upsert la INSERTABA como una venta cerrada nueva (124.000 por una mesa de 62.000, o una venta fantasma). Sin red, igual.
//   B. La relectura distingue «no existe» (200 con 0 filas, o PGRST116) de un fallo de lectura: no cobra, avisa, relee las mesas y muestra la mesa libre; un error de red o de la base NO es «no existe».
//   N. Una cuenta que NUNCA estuvo en la base (abierta sin red, jamás subida) sigue pudiendo cerrarse (su venta se inserta); la marca de «subida» (`subida` / `version` > 0) lo decide.
//   R. La base rechaza el INSERT cerrado (RS007: la lápida): sin red la tablet cierra PROVISIONAL, y al volver la red la fila se rechaza; el POS descarta esa venta, la saca del ticket, suelta lo pendiente (también la cola de cambios) y avisa.
//   P. Lo propio y lo ajeno: un +1 propio todavía en vuelo al tocar «Sí, cobrar» (día de promo: la base pone la línea de promo) NO se anuncia como «otra tablet la tocó»; lo ajeno sí.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asentar, hastaQue, POS_HTML, SECO, JUGO, cerradas, local, montar, abrir, producto, mesaBase, LUNES, MARTES,
} from './_pos-cobro-duda-vm.mjs';

const upserts = (t) => t.supabase.de('ordenes', 'upsert');
const cierres = (t) => upserts(t).filter((c) => c.cuerpo && c.cuerpo.estado === 'cerrada');
const sumaVentas = (t) => cerradas(t).reduce((s, o) => s + Number(o.total), 0);
const aviso = (t) => (t.pos.aviso && t.pos.aviso.texto) || '';
/** Lo que otra tablet dejó en la base: la cuenta cobrada por partes y la mesa liberada (la fila no existe; la lápida lo recuerda). */
const otraTabletCobroYLibero = (t, id = 'o1', mesa = 1) => {
  t.base.ordenes.delete(id);
  if (t.base.lapida) t.base.lapida.add(id);
  t.base.mesas.get(mesa).estado = 'libre';
};
/** El eco de lo que la base contesta a la lectura de UNA cuenta por id. */
const leerPorId = (c) => c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'select' && c.filtros.length === 1 && c.filtros[0][0] === 'id';
const cuerpo = (nombre) => {
  const i = POS_HTML.search(new RegExp(`^ {12}(?:async\\s+)?${nombre}\\(`, 'm'));
  assert.ok(i !== -1, `no encontré ${nombre} en pos.html`);
  const j = POS_HTML.slice(i + 1).search(/^ {12}(?:async\s+|get\s+)?[A-Za-z_$][\w$]*\(.*\) \{$/m);
  return POS_HTML.slice(i, j === -1 ? undefined : i + 1 + j);
};

// ═══════════════════ B. «no existe» no es «no se pudo leer» ═══════════════════

test('B1 (X1/X2) otra tablet cobró todo por partes y liberó la mesa: «Sí, cobrar» NO cierra, avisa que la cuenta ya no está en la base, relee las mesas y muestra la mesa libre — ni una venta de más', async () => {
  const t = await abrir({ lapida: true });
  assert.equal(local(t).subida, true, 'la cuenta vino de la base: está marcada como subida');
  otraTabletCobroYLibero(t);
  t.pos.modalConfirmFactura = true;
  await t.pos.facturar();
  await asentar(40);
  assert.equal(cierres(t).length, 0, 'ni un cierre: el upsert habría INSERTADO una venta que no existe');
  assert.equal(cerradas(t).length, 0, 'la base no tiene ninguna venta');
  assert.equal(t.pos.modalConfirmFactura, false, 'el diálogo se cerró');
  assert.match(aviso(t), /Esta cuenta ya no está en la base: otra tablet la cobró o la liberó/);
  assert.match(aviso(t), /No se cobró nada/);
  assert.equal(t.pos.vista, 'mesas', 'sale de una cuenta que ya no existe');
  assert.equal(t.pos.ordenActiva, null);
  assert.equal(local(t), undefined, 'se releyó la base: la copia vieja ya no está');
  assert.equal(t.pos.mesas.find((m) => m.id === 1).estado, 'libre', 'y la mesa se ve libre');
});

test('B2 la misma respuesta de la base dicha como PGRST116 («0 filas» al pedir un objeto único) también es «no existe»', async () => {
  const t = await abrir({ lapida: true });
  otraTabletCobroYLibero(t);
  const original = t.base.responder;
  t.base.responder = (c) => (leerPorId(c) ? { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' } } : original(c));
  t.pos.modalConfirmFactura = true;
  await t.pos.facturar();
  await asentar(40);
  assert.equal(cierres(t).length, 0);
  assert.match(aviso(t), /Esta cuenta ya no está en la base/);
  assert.equal(t.pos.remoto, 'ok', 'la base contestó: no es un fallo de red');
});

test('B3 un fallo de lectura que NO es «no hay esa fila» (sin red, 5xx, un error de la base) no es «no existe»: la mesa completa sigue por el camino de siempre (PROVISIONAL)', async () => {
  for (const [nombre, error] of [['sin red', { message: 'TypeError: Failed to fetch' }], ['5xx', { message: 'Bad Gateway', code: '' }], ['un error de la base', { code: 'XX000', message: 'fallo inyectado en la lectura' }]]) {
    const t = await abrir({ lapida: true });
    const original = t.base.responder;
    t.base.responder = (c) => (leerPorId(c) ? { data: null, error } : original(c));
    t.pos.modalConfirmFactura = true;
    await t.pos.facturar();
    await hastaQue(() => local(t) && local(t).estado === 'cerrada');
    assert.equal(local(t).estado, 'cerrada', `${nombre}: no es «no existe»: cierra`);
    assert.equal(local(t).provisional, true, `${nombre}: PROVISIONAL hasta que la base conteste`);
    assert.doesNotMatch(aviso(t), /ya no está en la base/, nombre);
  }
});

test('B4 la lectura que SÍ trae la cuenta sigue igual que antes (igual, cambio, no abierta, ocupada): lo de esta tarea no tocó esos caminos', async () => {
  const t = await abrir({ lapida: true });
  t.pos.modalConfirmFactura = true;
  await t.pos.facturar();
  await hastaQue(() => cierres(t).length === 1);
  await asentar(30);
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(sumaVentas(t), 2 * 19000 + 2 * 12000);
  assert.equal(t.base.lapida.size, 0, 'nadie borró nada');
  assert.doesNotMatch(aviso(t), /ya no está en la base/);
});

// ═══════════════════ N. La cuenta que NUNCA estuvo en la base ═══════════════════

/** Una tablet con la mesa 2 libre que abre la mesa SIN red: la cuenta nace aquí y jamás sube. */
async function tabletSinRedConCuentaNueva(opciones = {}) {
  const t = montar({ lapida: true, ...opciones });
  t.base.mesas.set(2, mesaBase(2, { estado: 'libre' }));
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  await asentar();
  t.base.red = false; t.pos.remoto = 'offline';
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 2));
  const id = t.pos.ordenActiva.id;
  t.pos._agregarAlPedido(producto(t, 'seco'), '');
  t.pos._agregarAlPedido(producto(t, 'jugo'), '');
  await asentar(10);
  return { t, id };
}

test('N1 una cuenta abierta SIN red y jamás subida (sin marca de subida, versión 0) que se cierra sin red SIGUE pudiendo cerrarse: al volver la red su venta entra, y desde entonces la cuenta lleva la marca', async () => {
  const { t, id } = await tabletSinRedConCuentaNueva();
  assert.equal(local(t, id).subida, undefined, 'nunca estuvo en la base');
  assert.equal(t.pos._cuentaYaEstuvoEnBase(local(t, id)), false);
  assert.ok(!(local(t, id).version > 0));
  t.pos.facturar();
  assert.equal(local(t, id).estado, 'cerrada', 'sin red se cierra al instante (PROVISIONAL)');
  assert.equal(local(t, id).cobradaSinRed, true);
  assert.equal(t.base.ordenes.has(id), false, 'la base no la conoce');
  t.base.red = true; t.pos.remoto = 'ok';
  await t.pos._subirLoPendiente();
  await asentar(40);
  assert.equal(t.base.ordenes.get(id).estado, 'cerrada', 'la venta entró');
  assert.equal(Number(t.base.ordenes.get(id).total), 19000 + 12000);
  assert.equal(local(t, id).subida, true, 'y la marca de subida quedó puesta');
  assert.doesNotMatch(aviso(t), /ya no existe/);
});

test('N2 con red, una cuenta sin la marca de subida a la que la lectura no encuentra (jamás estuvo allá) NO se frena: se cierra como siempre; la MISMA cuenta con la marca (o con versión > 0) sí es «ya no existe»', async () => {
  for (const [nombre, marca, esperaFrenada] of [['sin marca', {}, false], ['con subida', { subida: true }, true], ['con versión > 0', { version: 5 }, true]]) {
    const t = await abrir({ lapida: true });
    const o = local(t);
    delete o.subida; o.version = 0; Object.assign(o, marca);
    otraTabletCobroYLibero(t);
    t.pos.modalConfirmFactura = true;
    await t.pos.facturar();
    await asentar(40);
    if (esperaFrenada) {
      assert.equal(cierres(t).length, 0, `${nombre}: no cierra`);
      assert.match(aviso(t), /ya no está en la base/, nombre);
    } else {
      await hastaQue(() => cierres(t).length === 1);
      assert.equal(cierres(t).length, 1, `${nombre}: la cuenta jamás estuvo en la base: su venta se inserta (la guardia de la base no la conoce)`);
      assert.doesNotMatch(aviso(t), /ya no está en la base/, nombre);
    }
  }
});

test('N3 la marca de subida: la trae `parseOrden` (todo lo que viene de la base) y la pone la primera subida que la base acepta; `_cuentaYaEstuvoEnBase` es subida o versión > 0', async () => {
  const t = await abrir();
  assert.equal(t.pos.parseOrden({ id: 'x', mesa_id: 1, estado: 'abierta', items: [], total: 0 }).subida, true);
  assert.equal(t.pos._cuentaYaEstuvoEnBase({ subida: true }), true);
  assert.equal(t.pos._cuentaYaEstuvoEnBase({ version: 1 }), true);
  assert.equal(t.pos._cuentaYaEstuvoEnBase({ version: 0 }), false);
  assert.equal(t.pos._cuentaYaEstuvoEnBase({}), false);
  assert.equal(t.pos._cuentaYaEstuvoEnBase(null), false);
  const { t: u, id } = await tabletSinRedConCuentaNueva();
  assert.equal(local(u, id).subida, undefined);
  u.base.red = true; u.pos.remoto = 'ok';
  await u.pos._subirLoPendiente();
  await asentar(30);
  assert.equal(u.base.ordenes.has(id), true);
  assert.equal(local(u, id).subida, true, 'la primera subida que entra pone la marca');
  assert.equal(JSON.parse(u.almacen.get('pos_ordenes')).find((o) => o.id === id).subida, true, 'y se guarda con la copia local');
});

// ═══════════════════ R. La base rechaza el INSERT cerrado (RS007) ═══════════════════

test('R1 (X3) SIN red la tablet cierra PROVISIONAL; otra tablet cobra todo por partes y libera; al volver la red la fila cerrada sube y la base la rechaza (RS007): el POS descarta esa venta, la saca del ticket, suelta lo pendiente, relee las mesas y AVISA que el cobro sin conexión NO quedó', async () => {
  const t = await abrir({ lapida: true });
  t.pos.remoto = 'offline'; t.base.red = false;
  t.pos.facturar();
  assert.equal(local(t).estado, 'cerrada');
  assert.equal(local(t).cobradaSinRed, true);
  assert.equal(t.pos.vista, 'ticket');
  otraTabletCobroYLibero(t);
  t.base.red = true; t.pos.remoto = 'ok';
  await t.pos._subirLoPendiente();
  await asentar(60);
  assert.equal(cierres(t).length, 1, 'se intentó una vez');
  assert.equal(cerradas(t).length, 0, 'la base no registró nada: ninguna venta fantasma');
  assert.equal(local(t), undefined, 'la venta que la base rechazó ya no está aquí');
  assert.equal(t.pos._pendientes['ordenes:o1'], undefined, 'y no queda pendiente (no se reintenta para siempre)');
  assert.equal(t.pos.vista, 'mesas', 'se sale del ticket de una venta que no existe');
  assert.equal(t.pos.ultimoCobro, null, 'y «Deshacer» ya no apunta a ella');
  assert.match(aviso(t), /El cobro de la Mesa 1 que hiciste sin conexión NO quedó registrado/);
  assert.match(aviso(t), /esa cuenta ya no existe en la base/);
  assert.match(aviso(t), /no lo pierdas de vista/);
  assert.equal(t.pos.mesas.find((m) => m.id === 1).estado, 'libre');
  await t.pos._subirLoPendiente();
  await asentar(20);
  assert.equal(cierres(t).length, 1, 'un segundo pase no la vuelve a subir');
});

test('R1b RS007 y la red cae justo después: la venta que la base rechazó se descarta de la tablet igual (no depende de que la relectura salga)', async () => {
  const t = await abrir({ lapida: true });
  t.pos.remoto = 'offline'; t.base.red = false;
  t.pos.facturar();
  otraTabletCobroYLibero(t);
  t.base.red = true; t.pos.remoto = 'ok';
  const original = t.base.responder;
  t.base.responder = async (c) => { const r = await original(c); if (r && r.error && r.error.code === 'RS007') t.base.red = false; return r; };   // la red se cae con el rechazo
  await t.pos._subirLoPendiente();
  await asentar(60);
  assert.equal(cierres(t).length, 1, 'se intentó una vez y la base lo rechazó');
  assert.equal(local(t), undefined, 'la copia cerrada que la base rechazó ya no está aquí aunque la relectura no pudo salir');
  assert.equal(t.pos.vista, 'mesas');
  assert.equal(cerradas(t).length, 0);
});

test('R2 con red, si la lectura no pudo responder (un error de la base) la tablet cierra con su copia y el upsert da RS007: mismo trato, el aviso no dice «sin conexión»', async () => {
  const t = await abrir({ lapida: true });
  const original = t.base.responder;
  t.base.responder = (c) => (leerPorId(c) ? { data: null, error: { code: 'XX000', message: 'fallo inyectado en la lectura' } } : original(c));
  otraTabletCobroYLibero(t);
  t.pos.modalConfirmFactura = true;
  await t.pos.facturar();
  await hastaQue(() => !local(t), { ms: 4000 });
  await asentar(40);
  assert.equal(cierres(t).length, 1, 'cerró con su copia y la base lo rechazó (RS007)');
  assert.equal(cerradas(t).length, 0);
  assert.equal(local(t), undefined);
  assert.match(aviso(t), /El cobro de la Mesa 1 NO quedó registrado/);
  assert.doesNotMatch(aviso(t), /sin conexión/);
});

test('R3 RS007 no se confunde con RS003 (cambió), RS005 (cierre del día) ni «orden no existe»: los detectores del POS se reconocen cada uno por lo suyo', async () => {
  const t = await abrir();
  const re = (nombre) => new Function(`${POS_HTML.match(new RegExp(`function ${nombre}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`))[0]}; return ${nombre};`)();
  const borrada = re('esErrorCuentaBorrada');
  const cambio = re('esErrorCuentaCambio');
  const archivada = re('esErrorCuentaArchivada');
  const e7 = { code: 'RS007', message: 'esa cuenta ya no existe: la cobró o la liberó otra tablet' };
  assert.equal(borrada(e7), true);
  assert.equal(borrada({ message: 'esa cuenta ya no existe: la cobró o la liberó otra tablet' }), true, 'también por el texto');
  assert.equal(cambio(e7), false);
  assert.equal(archivada(e7), false);
  assert.equal(borrada({ code: 'RS003', message: 'la cuenta de la orden o1 cambió desde que se vio: revísala antes de cobrar' }), false);
  assert.equal(borrada({ code: 'RS005', message: 'la cuenta o1 ya estaba en un cierre del día: revísala con el admin' }), false);
  assert.equal(borrada({ code: 'P0001', message: 'orden o1 no existe' }), false);
  assert.equal(borrada(null), false);
  assert.equal(re('esFilaInexistente')({ code: 'PGRST116' }), true);
  assert.equal(re('esFilaInexistente')({ code: 'PGRST202' }), false);
});

test('R4 lo que esa tablet tenía en la cola (agregó un Seco sin red) y la venta que la base rechazó con RS007: los cambios se SUELTAN, ninguno sale hacia una cuenta que ya no existe', async () => {
  const t = await abrir({ lapida: true });
  t.pos.remoto = 'offline'; t.base.red = false;
  t.pos._agregarAlPedido(producto(t, 'seco'), '');
  await asentar(10);
  assert.ok(t.pos.colaDeltas.some((d) => d.orden_id === 'o1'), 'el +1 quedó en la cola (sin red)');
  t.pos.facturar();
  assert.equal(local(t).estado, 'cerrada', 'sin red cierra PROVISIONAL, con su Seco de más');
  otraTabletCobroYLibero(t);
  t.base.red = true; t.pos.remoto = 'ok';
  await t.pos._subirLoPendiente();
  await asentar(60);
  assert.equal(t.pos.colaDeltas.filter((d) => d.orden_id === 'o1').length, 0, 'la cola ya no tiene nada de esa cuenta');
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, 0, 'y ningún cambio salió hacia una cuenta que no existe');
  assert.equal(cerradas(t).length, 0);
  assert.equal(local(t), undefined);
  assert.match(aviso(t), /que hiciste sin conexión NO quedó registrado/);
});

// ═══════════════════ P. Lo propio en camino no es «otra tablet la tocó» ═══════════════════

const enLunes = { cuentas: [{ id: 'o1', mesa: 1, items: [SECO(2), JUGO(1)], version: 3 }], reloj: LUNES };
/** Un +1 de Seco propio cuya respuesta la prueba retiene hasta soltarla. */
async function masUnoEnVuelo(t) {
  const original = t.base.responder;
  const estado = { soltar: null };
  t.base.responder = (c) => (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden' ? new Promise((r) => { estado.soltar = () => r(original(c)); }) : original(c));
  t.pos.incrementarItem(local(t).items.find((i) => i.id === 'seco'));
  await hastaQue(() => !!estado.soltar);
  return estado;
}

test('P1 (N3) día de promo: un +1 propio todavía en vuelo al tocar «Sí, cobrar» (la base responde con la línea de promo) cierra a la primera, SIN el aviso de «otra tablet la tocó» y con el total que registra la base', async () => {
  const t = await abrir({ ...enLunes, lapida: true });
  assert.equal(t.pos.totalOrdenActiva, 2 * 19000 + 12000);
  const vuelo = await masUnoEnVuelo(t);
  assert.equal(t.pos.totalOrdenActiva, 3 * 19000 + 12000, 'la pantalla mostraba el Seco de más al precio de lista (69.000)');
  t.pos.modalConfirmFactura = true;
  const cobro = t.pos.facturar();
  await asentar(10);
  assert.equal(cierres(t).length, 0, 'espera al +1 en vuelo');
  vuelo.soltar();
  await cobro;
  await hastaQue(() => cierres(t).length === 1);
  await asentar(30);
  assert.equal(cierres(t).length, 1, 'cierra a la primera: sin confirmar de nuevo');
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(Number(t.base.ordenes.get('o1').total), 53200 + 12000, 'la base aplicó la promo: 3 Seco con el 20 % en el tercero + el Jugo');
  assert.doesNotMatch(aviso(t), /otra tablet/, 'ninguna otra tablet la tocó');
  assert.doesNotMatch(aviso(t), /cambió en la base/);
});

test('P2 lo AJENO sí se avisa: con un +1 propio en vuelo, otra tablet también cobró un Jugo (las unidades difieren) → no cierra y avisa «otra tablet la tocó» con el total nuevo', async () => {
  const t = await abrir({ ...enLunes, lapida: true });
  const vuelo = await masUnoEnVuelo(t);
  t.base.ordenes.get('o1').items = t.base.ordenes.get('o1').items.filter((i) => i.id !== 'jugo');   // otra tablet cobró el Jugo (la copia de aquí no se entera)
  t.base.ordenes.get('o1').version += 1;
  t.pos.modalConfirmFactura = true;
  const cobro = t.pos.facturar();
  await asentar(10);
  vuelo.soltar();
  await cobro;
  await asentar(40);
  assert.equal(cierres(t).length, 0, 'no cierra a ciegas');
  assert.equal(t.pos.modalConfirmFactura, true, 'el diálogo sigue abierto con el total nuevo');
  assert.match(aviso(t), /La cuenta cambió en la base desde que la abriste \(otra tablet la tocó\)/);
  assert.doesNotMatch(aviso(t), /por lo que acabas de cambiar/);
});

test('P3 un cambio ajeno SIN nada propio en camino se avisa como siempre (la regla de propios no lo toca)', async () => {
  const t = await abrir({ ...enLunes, lapida: true });
  t.base.ordenes.get('o1').items = t.base.ordenes.get('o1').items.filter((i) => i.id !== 'jugo');
  t.base.ordenes.get('o1').version += 1;
  t.pos.modalConfirmFactura = true;
  await t.pos.facturar();
  await asentar(40);
  assert.equal(cierres(t).length, 0);
  assert.match(aviso(t), /La cuenta cambió en la base desde que la abriste \(otra tablet la tocó\)/);
});

test('P4 lo propio que SUBE el total (quitar un Seco deshace la promo y la base cobra más de lo que la pantalla mostraba): no cierra, se confirma de nuevo, y el aviso dice que fue por lo que cambió esta tablet, no por otra', async () => {
  const t = await abrir({ cuentas: [{ id: 'o1', mesa: 1, items: [SECO(3)], version: 3 }], reloj: LUNES, lapida: true });
  t.pos.quitarProducto(local(t).items.find((i) => i.id === 'seco'));
  assert.equal(t.pos.totalOrdenActiva, 34200, 'la tablet lo mostraba así');
  t.pos.modalConfirmFactura = true;
  await t.pos.facturar();
  await asentar(40);
  assert.equal(cierres(t).length, 0, 'no cierra con lo que mostraba');
  assert.equal(t.pos.totalOrdenActiva, 38000);
  assert.equal(t.pos.modalConfirmFactura, true);
  assert.match(aviso(t), /La cuenta cambió en la base por lo que acabas de cambiar/);
  assert.doesNotMatch(aviso(t), /otra tablet/);
  assert.match(aviso(t), /38\.000/);
  assert.match(aviso(t), /34\.200/);
  await t.pos.facturar();
  await hastaQue(() => cierres(t).length === 1);
  await asentar(30);
  assert.equal(Number(t.base.ordenes.get('o1').total), 38000);
});

test('P5 `_unidadesPlanas` cuenta una línea de promoción como unidades de su plato: la promo recalculada no cambia lo pedido, otra cantidad sí', async () => {
  const t = await abrir();
  const base = [{ id: 'seco', nombre: 'Seco', precio: 19000, qty: 2, nota: '' }, { id: 'jugo', nombre: 'Jugo', precio: 12000, qty: 1, nota: '' }];
  const promo = [{ id: 'seco', nombre: 'Seco', precio: 19000, qty: 2, nota: '' }, { id: 'promo:p1:seco', nombre: 'Seco · 3er almuerzo', precio: 15200, qty: 1, nota: '', promo: { id: 'p1', de: 'seco', nombre: 'Seco', precio: 19000, descuento: 20 } }, { id: 'jugo', nombre: 'Jugo', precio: 12000, qty: 1, nota: '' }];
  const tres = [{ id: 'seco', nombre: 'Seco', precio: 19000, qty: 3, nota: '' }, { id: 'jugo', nombre: 'Jugo', precio: 12000, qty: 1, nota: '' }];
  assert.equal(t.pos._unidadesPlanas(promo), t.pos._unidadesPlanas(tres), 'la promo es el tercer Seco');
  assert.notEqual(t.pos._unidadesPlanas(base), t.pos._unidadesPlanas(tres));
  assert.equal(t.pos._unidadesPlanas(null), '[]');
});

// ═══════════════════ S. estática ═══════════════════

test('S1 estática: la relectura trata 0 filas como «no existe» (no como «sin lectura»), solo con la marca de subida, y la mesa completa lo atiende ANTES de juzgar lo demás', () => {
  const l = cuerpo('_leerCuentaParaCobrar');
  assert.match(l, /esFilaInexistente\(r\.error\)/, 'PGRST116 es una respuesta de la base');
  assert.match(l, /if \(!fila\) return this\._cuentaYaEstuvoEnBase\(local\) \? \{ estado: 'no_existe' \} : \{ estado: 'sin_lectura' \};/);
  assert.ok(l.indexOf("{ estado: 'no_existe' }") < l.indexOf("fila.estado !== 'abierta'"), 'antes de mirar el estado de la fila');
  const r = cuerpo('_facturarReleyendo');
  assert.match(r, /if \(lectura\.estado === 'no_existe'\) \{ await this\._cuentaYaNoEsta\(orden\.id\); return; \}/);
  assert.ok(r.indexOf("lectura.estado === 'no_existe'") < r.indexOf('const actual = this.ordenes.find'), 'antes de la guardia de la cuenta que se ve');
  assert.match(cuerpo('_cuentaYaNoEsta'), /TEXTO_CUENTA_YA_NO_ESTA/);
  assert.match(POS_HTML, /const TEXTO_CUENTA_YA_NO_ESTA = 'Esta cuenta ya no está en la base: otra tablet la cobró o la liberó\./);
});

test('S2 estática: pushASupabase reconoce RS007, suelta la fila (denegada: no se reintenta) y la trata en `_cuentaBorrada`; y la primera subida que entra pone la marca', () => {
  const p = cuerpo('pushASupabase');
  assert.match(p, /if \(tabla === 'ordenes' && esErrorCuentaBorrada\(e\)\) \{ denegada = true; cuentaBorrada = true; \}/);
  assert.match(p, /else if \(cuentaBorrada\) this\._cuentaBorrada\(payload\.id\)/);
  assert.match(p, /if \(tabla === 'ordenes'\) this\._marcarSubida\(payload\.id\);/);
  const b = cuerpo('_cuentaBorrada');
  assert.match(b, /this\._soltarPendiente\('ordenes:' \+ ordenId\)/);
  assert.match(b, /this\._soltarDeltasDe\(ordenId\)/);
  assert.match(b, /this\.sincronizarSupabase\(\{ soloEnVivo: true \}\)/);
});
