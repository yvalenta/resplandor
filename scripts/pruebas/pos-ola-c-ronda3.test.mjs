// Ola C, ronda 3 (las correcciones de la refutación y la decisión nueva de Yonatan: «el pedido se podrá deshacer cuando quiera el
// mesero o el admin»): la lógica del POS (pos.html, su <script> REAL en un `vm`) contra la base falsa de _pos-vm.mjs, que modela
// supabase/migrations/20261002180000_deshacer_cobro.sql (sin ventana de tiempo) y el guardia de `ordenes`.
//
//   R1  el cobro completo se deshace: con la mesa libre la REABRE; con otra cuenta abierta en la mesa, SE FUSIONA con ella
//   R2  un abono y un parcial de una cuenta de otra mesa o que ya no cuadra no se devuelven; el mensaje lo dice
//   R3  cerrar con lo que se vio (hallazgo 4): una tablet atrasada no cierra la cuenta con lo viejo: «La cuenta cambió, revísala»
//   R4  la version se anota al volver cada delta y el cierre espera a los deltas en vuelo (ninguna falsa alarma propia)
//   R5  parcial_de se manda null a propósito al reabrir o editar una venta cerrada
//   R6  pegatinas con el token que de verdad se escribió o se leyó (hallazgo 3); el eco de Realtime refresca el panel
//   R7  «Cobros deshechos hoy»: lo que lee el cierre del día (solo admin) y desde cuándo cuenta
//   R8  la espera de aprobación: «Reintentar» pregunta sin recargar y dice qué encontró
//   R9  los avisos con acción («Ver») y lo que dice aprobar a alguien
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKEN, asentar, crearBaseFalsa, crearPos, hastaQue, item, mesaBase, ordenBase, plano,
} from './_pos-vm.mjs';

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const ENLACE = (id, token = TOKEN) => `https://resplandor.ynt.codes/carta.html?m=${id}&k=${token}`;

function montar({ rol = 'admin', acceso, mesas = [mesaBase(3)], ordenes = [], personal = [], cierres = [], latenciaMs = 0, extras = {} } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, personal, cierres, olaC: true, acceso, latenciaMs });
  const original = base.responder;
  base.responder = async (c) => {
    const r = await original(c);
    return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r;
  };
  const temporizadores = [];
  const reales = { setTimeout, clearTimeout };
  const t = crearPos({
    base,
    extras: {
      setInterval() { return 1; }, clearInterval() {},
      setTimeout(fn, ms, ...resto) {
        if (ms >= 1500) { const h = { fn, ms, cancelado: false, unref() { return h; } }; temporizadores.push(h); return h; }
        return reales.setTimeout(fn, ms, ...resto);
      },
      clearTimeout(h) { if (h && typeof h === 'object' && 'cancelado' in h) h.cancelado = true; else reales.clearTimeout(h); },
      ...extras,
    },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  t.base = base; t.temporizadores = temporizadores;
  t.pos.usuario = YO;
  return t;
}
async function listo(t) {
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  if (t.pos.esAdmin) await hastaQue(() => t.pos._personalCargado);
  await asentar();
  return t;
}
const lista = (mapa) => [...mapa.values()];
const mesaDe = (t, id) => t.pos.mesas.find((m) => m.id === id);
const PALOMA = () => ({ id: 'paloma', nombre: 'Paloma', precio: 4500, qty: 2, nota: '' });
const PAN = () => ({ id: 'pan', nombre: 'Pan', precio: 3000, qty: 1, nota: '' });

/** Mesa 3 ocupada con su cuenta (2 palomas y 1 pan: $12.000) abierta en pantalla. */
async function conCuenta(opciones = {}) {
  const t = montar({ mesas: [mesaBase(3), mesaBase(5, { estado: 'libre' })], ordenes: [ordenBase('o1', 3, [PALOMA(), PAN()], 1)], ...opciones });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  return t;
}

// ═════════════════════════ R1. El cobro completo se deshace ═════════════════════════

test('R1a cobro completo: facturar deja «Cobrado $X · Deshacer» y deshacerlo REABRE la mesa (la misma orden, abierta, con la mesa ocupada) y lo anota', async () => {
  const t = await conCuenta();
  t.pos.facturar();
  await asentar();
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(t.base.mesas.get(3).estado, 'libre');
  assert.deepEqual(plano({ ...t.pos.ultimoCobro, hasta: 0 }), { ordenId: 'o1', abiertaId: 'o1', mesaId: 3, monto: 12000, tipo: 'completo', hasta: 0 });
  assert.equal(t.pos.vista, 'ticket');

  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar();
  const o = t.base.ordenes.get('o1');
  assert.equal(o.estado, 'abierta', 'en la base la misma orden volvió a estar abierta');
  assert.equal(o.cerrada_en, null);
  assert.equal(t.base.mesas.get(3).estado, 'ocupada', 'y la mesa, ocupada');
  assert.equal(t.pos.ordenes.find((x) => x.id === 'o1').estado, 'abierta', 'aquí también');
  assert.equal(mesaDe(t, 3).estado, 'ocupada');
  assert.equal(t.pos.aviso.texto, 'Cobro deshecho · la Mesa 3 volvió a estar abierta con $ 12.000');
  assert.equal(t.pos.vista, 'orden', 'estaba viendo el ticket: va a la cuenta de la mesa');
  assert.equal(t.pos.ordenActiva.id, 'o1');
  assert.equal(t.pos.totalOrdenActiva, 12000);
  assert.equal(t.pos.ordenesHoy.length, 0, 'ya no es una venta de hoy');
  assert.equal(t.base.deshechosTabla.length, 1);
  assert.deepEqual(plano(['tipo', 'monto', 'mesa_id', 'hecho_por'].map((k) => t.base.deshechosTabla[0][k])), ['completo', 12000, 3, 'yo@ejemplo.test']);
  assert.equal(t.pos.ultimoCobro, null);
});

test('R1b cobro completo desde «Transacciones del turno» muchos minutos después (mesero y admin): se reabre la mesa libre', async () => {
  for (const rol of ['mesero', 'admin']) {
    const t = await conCuenta({ rol });
    t.pos.facturar();
    await asentar();
    t.pos._limpiarUltimoCobro();
    t.pos.volverAMesas();
    const ayer = new Date(Date.now() - 20 * 3600000).toISOString();
    t.pos.ordenes.find((o) => o.id === 'o1').cerradaEn = ayer; t.base.ordenes.get('o1').cerrada_en = ayer;
    const cobrada = t.pos.ordenes.find((o) => o.id === 'o1');
    assert.equal(t.pos.tipoDevolucion(cobrada), 'reabre', `${rol}: con la mesa libre la venta se reabre`);
    assert.equal(t.pos.puedeDevolver(cobrada), true, `${rol}: sin ventana`);
    assert.equal(await t.pos.devolverACuenta('o1'), true, rol);
    await asentar();
    assert.equal(t.base.ordenes.get('o1').estado, 'abierta', rol);
    assert.equal(t.pos.aviso.texto, 'Cobro deshecho · la Mesa 3 volvió a estar abierta con $ 12.000');
  }
});

test('R1c cobro completo con la mesa YA ocupada por otra cuenta: los ítems pasan a ella, la cerrada se borra y el monto es lo que de verdad subió', async () => {
  const t = montar({
    mesas: [mesaBase(3)],
    ordenes: [ordenBase('c1', 3, [PALOMA()], 3, 'cerrada'), ordenBase('a1', 3, [{ ...PALOMA(), qty: 1, precio: 5000 }, PAN()], 7)],
  });
  await listo(t);
  const cobrada = t.pos.ordenes.find((o) => o.id === 'c1');
  assert.equal(t.pos.tipoDevolucion(cobrada), 'fusiona');
  assert.equal(t.pos.puedeDevolver(cobrada), true);
  assert.equal(await t.pos.devolverACuenta('c1'), true);
  await asentar();
  assert.equal(t.base.ordenes.has('c1'), false, 'la cerrada se borró');
  assert.equal(t.pos.ordenes.some((o) => o.id === 'c1'), false, 'aquí también');
  const a1 = t.base.ordenes.get('a1');
  assert.deepEqual(plano(a1.items.map((i) => [i.id, i.qty])), [['paloma', 3], ['pan', 1]], 'se suma a la línea que ya estaba');
  assert.equal(a1.total, 3 * 5000 + 3000, 'la línea conserva su precio');
  assert.equal(t.pos.aviso.texto, 'Cobro deshecho · $ 10.000 volvió a la cuenta de Mesa 3', 'monto = lo que subió la cuenta (2 × $ 5.000), no el total de la cerrada ($ 9.000)');
  assert.equal(t.pos.ordenes.find((o) => o.id === 'a1').items.find((i) => i.id === 'paloma').qty, 3);
  assert.equal(t.base.deshechosTabla[0].tipo, 'completo');
});

test('R1d cobro completo: los abonos que habían salido de él pasan a apuntar a la cuenta que lo recibe (aquí y en la base) y siguen siendo devolvibles', async () => {
  const credito = { id: 'abono_recibido_u9', nombre: 'Abono recibido', precio: -3000, qty: 1, nota: 'qr' };
  const abono = { id: 'abono_u9', nombre: 'Abono', precio: 3000, qty: 1, nota: 'qr' };
  const t = montar({
    mesas: [mesaBase(3)],
    ordenes: [
      ordenBase('c1', 3, [PALOMA(), credito], 3, 'cerrada'),
      { ...ordenBase('ab9', 3, [abono], 1, 'cerrada'), parcial_de: 'c1' },
      ordenBase('a1', 3, [PAN()], 7),
    ],
  });
  await listo(t);
  assert.equal(t.pos.ordenes.find((o) => o.id === 'ab9').parcialDe, 'c1');
  assert.equal(await t.pos.devolverACuenta('c1'), true);
  await asentar();
  assert.equal(t.base.ordenes.get('ab9').parcial_de, 'a1', 'la base lo re-apuntó');
  assert.equal(t.pos.ordenes.find((o) => o.id === 'ab9').parcialDe, 'a1', 'y esta tablet también');
  assert.ok(t.base.ordenes.get('a1').items.some((i) => i.id === 'abono_recibido_u9'), 'el abono recibido viaja con la cuenta');
  assert.equal(t.pos.puedeDevolver(t.pos.ordenes.find((o) => o.id === 'ab9')), true);
  assert.equal(await t.pos.devolverACuenta('ab9'), true);
  await asentar();
  assert.equal(t.base.ordenes.get('a1').total, 4500 * 2 + 3000, 'sin el abono: la cuenta vuelve a su total');
});

// ═════════════════════════ R2. Lo que NO se devuelve, con su motivo ═════════════════════════

test('R2 un abono sin cuenta, un cobro de una mesa desactivada y uno ya archivado: no hay botón y el motivo es claro; la base lo confirma', async () => {
  const abonoViejo = { id: 'abono_viejo', nombre: 'Abono', precio: 15000, qty: 1, nota: 'qr' };
  const t = montar({
    mesas: [mesaBase(3, { estado: 'libre' })],
    ordenes: [
      ordenBase('v1', 3, [abonoViejo], 1, 'cerrada'),
      ordenBase('c2', 3, [PAN()], 1, 'cerrada'),
    ],
  });
  await listo(t);
  const viejo = t.pos.ordenes.find((o) => o.id === 'v1');
  assert.equal(t.pos.puedeDevolver(viejo), false, 'un abono de antes (sin la cuenta de la que salió) no se reabre como cuenta');
  assert.equal(await t.pos.devolverACuenta('v1'), false);
  assert.match(t.pos.deshacerError, /ya no se puede devolver a la cuenta: no coincide con ella/);
  assert.equal(t.supabase.rpcs('deshacer_cobro').length, 0, 'ni se intenta');
  // La mesa sale del salón (la desactivaron): el cobro completo no ofrece el botón y dice por qué.
  t.pos.mesas = [];
  const c2 = t.pos.ordenes.find((o) => o.id === 'c2');
  assert.equal(t.pos.puedeDevolver(c2), false);
  assert.equal(await t.pos.devolverACuenta('c2'), false);
  assert.match(t.pos.deshacerError, /Esa mesa está desactivada: actívala en Mesas y pegatinas/);
  // Archivada en un cierre cuya purga está en camino: no.
  t.pos.mesas = [mesaBase(3, { estado: 'libre' })];
  t.pos.cierres = [{ id: 'cz', fecha: new Date().toISOString(), total: 3000, ordenes: [], purgar: ['c2'], sync: 'ok' }];
  assert.equal(t.pos.puedeDevolver(c2), false, 'ya está en un cierre del día');
  assert.equal(await t.pos.devolverACuenta('c2'), false);
  assert.equal(t.pos.deshacerError, 'Ese cobro ya está en un cierre del día: no se puede deshacer.');
  // Lo que la tablet no sabía y la base sí: ya_en_cierre / mesa_inactiva se explican y se vuelve a leer.
  t.pos.cierres = [];
  t.base.cierres.set('cz', { id: 'cz', fecha: new Date().toISOString(), total_ventas: 3000, total_ordenes: 1, transacciones: [{ id: 'c2' }] });
  assert.equal(await t.pos.devolverACuenta('c2'), false);
  assert.equal(t.pos.deshacerError, 'Ese cobro ya está en un cierre del día: no se puede deshacer.');
  assert.equal(t.base.ordenes.get('c2').estado, 'cerrada', 'nada cambió');
  t.base.cierres.clear();
  t.base.mesas.get(3).activa = false;
  assert.equal(await t.pos.devolverACuenta('c2'), false);
  assert.match(t.pos.deshacerError, /Esa mesa está desactivada/);
});

test('R2b un abono cuya línea en la cuenta ya no cuadra (alguien la editó) no se devuelve ni inventa un monto', async () => {
  const credito = { id: 'abono_recibido_u1', nombre: 'Abono recibido', precio: -20000, qty: 2, nota: 'efectivo' };   // qty 2: ya no cuadra
  const t = montar({
    mesas: [mesaBase(3)],
    ordenes: [
      ordenBase('o1', 3, [{ id: 'lomo', nombre: 'Lomo', precio: 48000, qty: 1, nota: '' }, credito], 2),
      { ...ordenBase('a1', 3, [{ id: 'abono_u1', nombre: 'Abono', precio: 20000, qty: 1, nota: 'efectivo' }], 1, 'cerrada'), parcial_de: 'o1' },
    ],
  });
  await listo(t);
  assert.equal(await t.pos.devolverACuenta('a1'), false);
  assert.match(t.pos.deshacerError, /ya no se puede devolver a la cuenta/);
  assert.equal(t.base.ordenes.get('o1').total, 48000 - 40000, 'la cuenta quedó como estaba (la base no la tocó)');
  assert.equal(t.base.ordenes.get('o1').items.find((i) => i.id === 'abono_recibido_u1').qty, 2);
  assert.equal(t.base.deshechosTabla.length, 0, 'y no quedó registro de algo que no pasó');
});

// ═════════════════════════ R3. Cerrar con lo que se vio ═════════════════════════

test('R3 hallazgo 4: una tablet atrasada NO cierra la cuenta con lo viejo: la base rechaza (RS003), la cuenta queda abierta y se vuelve a leer con «La cuenta cambió, revísala»', async () => {
  const t = await conCuenta();
  // Otra tablet agregó 3 limonadas y la base lo sabe; esta no recibió el eco (estaba sin red).
  const enBase = t.base.ordenes.get('o1');
  enBase.items.push({ id: 'limonada', nombre: 'Limonada', precio: 7000, qty: 3, nota: '' });
  enBase.total += 21000; enBase.version = 6;
  t.pos.facturar();
  await asentar();
  await asentar();
  assert.equal(t.supabase.de('ordenes', 'upsert').some((c) => c.cuerpo.estado === 'cerrada' && c.cuerpo.version === 1), true, 'el cierre mandó la version que esta tablet vio');
  assert.equal(t.base.ordenes.get('o1').estado, 'abierta', 'la base NO cerró la cuenta con lo viejo');
  assert.equal(t.base.ordenes.get('o1').items.length, 3);
  const local = t.pos.ordenes.find((o) => o.id === 'o1');
  assert.equal(local.estado, 'abierta', 'aquí la cuenta sigue abierta');
  assert.equal(local.items.some((i) => i.id === 'limonada'), true, 'y ya trae lo que cambió: se volvió a leer');
  assert.equal(t.pos.totalOrdenActiva, 12000 + 21000);
  assert.equal(mesaDe(t, 3).estado, 'ocupada');
  assert.equal(t.base.mesas.get(3).estado, 'ocupada', 'la mesa no quedó libre en la base con una cuenta abierta');
  assert.equal(t.pos.vista, 'orden', 'no se queda en un ticket de una venta que no existe');
  assert.equal(t.pos.ticketMostrado, null);
  assert.match(t.pos.aviso.texto, /^La cuenta cambió, revísala/);
  assert.equal(t.pos.ultimoCobro, null, 'no hay «Deshacer» de algo que no se cobró');
  assert.deepEqual(plano(t.pos._pendientes), {}, 'no queda pendiente: reintentar la fila vieja no sirve');
  assert.equal(t.pos.ordenesHoy.length, 0);
  // La persona la revisa y cobra: ahora sí pasa (la version es la de la base).
  t.pos.facturar();
  await asentar();
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(t.base.ordenes.get('o1').total, 33000);
});

test('R4a la version se anota al volver cada delta: cobrar enseguida no da una falsa alarma propia (aunque el eco de Realtime no llegue)', async () => {
  const t = await conCuenta();
  t.pos.agregarProducto({ id: 'pan', nombre: 'Pan', precio: 3000 });
  await asentar();
  assert.equal(t.base.ordenes.get('o1').version, 2);
  assert.equal(t.pos.ordenes.find((o) => o.id === 'o1').version, 2, 'la tablet anotó la version que le contestó la base');
  t.pos.facturar();
  await asentar();
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada', 'sin eco, el cierre pasa: manda la version que sí conoce');
  assert.equal(t.pos.aviso, null);
});

test('R4b el cierre espera a los deltas que siguen en vuelo (agregar y cobrar de inmediato)', async () => {
  const t = await conCuenta({ latenciaMs: 15 });
  t.pos.agregarProducto({ id: 'limonada', nombre: 'Limonada', precio: 7000 });
  t.pos.facturar();                                         // el delta aún no llegó a la base
  await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada', { ms: 3000 });
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
  assert.equal(t.base.ordenes.get('o1').items.some((i) => i.id === 'limonada'), true, 'la limonada quedó en la venta');
  assert.equal(t.base.ordenes.get('o1').total, 12000 + 7000);
  assert.equal(t.pos.aviso, null, 'ninguna «La cuenta cambió»: el cambio era de esta misma tablet');
});

test('R4c sin version en la fila (una caché vieja) la base no frena el cierre, y un cierre sin red sube después con la version que tenía', async () => {
  const t = await conCuenta();
  t.base.red = false;
  t.pos.remoto = 'offline';
  t.pos.facturar();
  await asentar();
  assert.equal(t.pos.ordenes.find((o) => o.id === 'o1').estado, 'cerrada');
  assert.equal(t.pos.ultimoCobro, null, 'sin red no hay «Deshacer»: necesita la base');
  t.base.red = true;
  t.pos.remoto = 'ok';
  await t.pos._subirLoPendiente();
  await asentar();
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada', 'al volver la red la cuenta nadie la tocó: sube');
  assert.equal(t.pos.aviso, null);
});

// ═════════════════════════ R5. parcial_de se anula al reabrir o editar ═════════════════════════

test('R5 reabrir o editar una venta cerrada manda parcial_de null EXPLÍCITO (y la base lo anula); una venta normal no lo manda', async () => {
  const abierta = ordenBase('o1', 3, [PAN()], 1);
  const parcial = { ...ordenBase('p1', 3, [PALOMA()], 1, 'cerrada'), parcial_de: 'o1' };
  const t = montar({ mesas: [mesaBase(3), mesaBase(5, { estado: 'libre' })], ordenes: [abierta, parcial] });
  await listo(t);
  const p1 = t.pos.ordenes.find((o) => o.id === 'p1');
  assert.equal(p1.parcialDe, 'o1');
  // Reabrir en la mesa 5 (la 3 sigue ocupada)
  await t.pos.reabrirOrden(p1, 5);
  await asentar();
  const subida = t.supabase.de('ordenes', 'upsert').find((c) => c.cuerpo.id === 'p1');
  assert.ok(subida, 'se subió');
  assert.ok('parcial_de' in subida.cuerpo && subida.cuerpo.parcial_de === null, 'parcial_de viaja como null, a propósito');
  assert.equal(t.base.ordenes.get('p1').parcial_de, null, 'y en la base quedó cortado el vínculo');
  assert.equal(t.pos.ordenes.find((o) => o.id === 'p1').parcialDe, null);
  // Una orden normal no manda la columna (no hace falta tocarla)
  const normal = t.supabase.de('ordenes', 'upsert').filter((c) => c.cuerpo.id !== 'p1');
  for (const c of normal) assert.equal('parcial_de' in c.cuerpo, false, 'una orden común no lleva parcial_de');

  // Editar sin mesa una venta cerrada: lo mismo.
  const t2 = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [PAN()], 1), { ...ordenBase('p1', 3, [PALOMA()], 1, 'cerrada'), parcial_de: 'o1' }] });
  await listo(t2);
  t2.pos.editarSinMesa(t2.pos.ordenes.find((o) => o.id === 'p1'));
  t2.pos.incrementarItem(t2.pos.ordenActiva.items[0]);       // la edición cambia los ítems de la venta (por el delta de la base)
  await asentar();
  assert.equal(t2.base.ordenes.get('p1').parcial_de, null, 'la base cortó el vínculo con el primer cambio de ítems');
  assert.equal(t2.pos.ordenActiva.parcialDe, null, 'y esta tablet también, de inmediato');
  t2.pos.guardarEdicion();
  await asentar();
  const s2 = t2.supabase.de('ordenes', 'upsert').find((c) => c.cuerpo.id === 'p1');
  assert.ok(s2 && s2.cuerpo.parcial_de === null, 'guardar la edición manda parcial_de null a propósito');
  assert.equal(t2.base.ordenes.get('p1').parcial_de, null);
  // Una edición SIN cambios no corta nada: sigue siendo el cobro de esa cuenta (en la base y aquí).
  const t3 = montar({ mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [PAN()], 1), { ...ordenBase('p1', 3, [PALOMA()], 1, 'cerrada'), parcial_de: 'o1' }] });
  await listo(t3);
  t3.pos.editarSinMesa(t3.pos.ordenes.find((o) => o.id === 'p1'));
  t3.pos.guardarEdicion();
  await asentar();
  assert.equal(t3.base.ordenes.get('p1').parcial_de, 'o1', 'sin cambios, el vínculo sigue (la base lo conserva)');
  assert.equal(t3.pos.ordenes.find((o) => o.id === 'p1').parcialDe, 'o1');
});

// ═════════════════════════ R6. Pegatinas con el token que se escribió ═════════════════════════

/** Un NDEFReader que escribe (o se queda esperando) y escanea lo que la prueba le acerque. */
function nfcFalso() {
  const nfc = { escrituras: [], escaneos: [], instancias: [], soloLectura: 0, liberar: null, aEscribir: null };
  nfc.NDEFReader = class {
    constructor() { nfc.instancias.push(this); }
    write(mensaje, opciones) {
      nfc.escrituras.push({ mensaje, opciones });
      return nfc.aEscribir ? nfc.aEscribir() : Promise.resolve();
    }
    scan(opciones) { nfc.escaneos.push({ opciones }); return Promise.resolve(); }
    makeReadOnly() { nfc.soloLectura++; return Promise.resolve(); }
  };
  nfc.acercar = (url) => {
    const lector = nfc.instancias.at(-1);
    lector.onreading({ message: { records: [{ recordType: 'url', data: new TextEncoder().encode(url) }] } });
  };
  return nfc;
}
async function conPanel() {
  const nfc = nfcFalso();
  const t = montar({ mesas: [mesaBase(3, { estado: 'libre' }), mesaBase(5, { estado: 'libre' })], extras: { NDEFReader: nfc.NDEFReader, TextEncoder } });
  await listo(t);
  await t.pos.cargarMesasAdmin();
  t.nfc = nfc;
  return t;
}
const OTRO = 'b'.repeat(48);

test('R6a hallazgo 3: si el enlace de la mesa cambia MIENTRAS se escribe la pegatina, no queda «escrita»: la base responde enlace_cambio y la hoja pide escribirla de nuevo', async () => {
  const t = await conPanel();
  let terminar;
  t.nfc.aEscribir = () => new Promise((ok) => { terminar = ok; });
  const escritura = t.pos.escribirPegatina(3);
  assert.deepEqual(plano(t.nfc.escrituras[0].mensaje), { records: [{ recordType: 'url', data: ENLACE(3) }] }, 'escribe el enlace que el panel tenía');
  t.base.mesas.get(3).token = OTRO;                         // otro dispositivo giró el enlace mientras la persona acerca la pegatina
  terminar();
  assert.equal(await escritura, false);
  assert.equal(t.pos.nfcEstado.fase, 'error');
  assert.match(t.pos.nfcEstado.mensaje, /El enlace de la mesa 3 cambió mientras tanto \(otro dispositivo lo giró\): la pegatina quedó con el enlace viejo y no sirve\. Vuelve a escribirla\./);
  assert.equal(t.pos.nfcEstado.accion, 'escribir');
  assert.equal(t.base.mesas.get(3).pegatina_escrita_en ?? null, null, 'la base NO anotó «escrita»');
  assert.deepEqual(plano(t.supabase.rpcs('pegatina_marcar').at(-1).args), { p_id: 3, p_tipo: 'escrita', p_token: TOKEN }, 'se mandó el token que de verdad se escribió');
  await asentar();
  assert.equal(t.pos.mesasAdmin.find((m) => m.id === 3).enlace, ENLACE(3, OTRO), 'y el panel se volvió a leer: ya muestra el enlace nuevo');
  // «Reintentar» escribe de nuevo, ahora con el enlace nuevo, y esta vez sí queda anotada.
  t.nfc.aEscribir = null;
  assert.equal(await t.pos.reintentarNfc(), true);
  assert.deepEqual(plano(t.nfc.escrituras.at(-1).mensaje), { records: [{ recordType: 'url', data: ENLACE(3, OTRO) }] });
  assert.ok(t.base.mesas.get(3).pegatina_escrita_en);
  assert.equal(t.pos.nfcEstado.fase, 'ok');
  assert.equal(t.nfc.soloLectura, 0, 'nunca se bloquea la pegatina');
});

test('R6b revisar: se anota el token que TRAE la pegatina; si el enlace de la mesa ya es otro, no queda «revisada»', async () => {
  const t = await conPanel();
  const revision = t.pos.revisarPegatina(3);
  t.base.mesas.get(3).token = OTRO;                         // se giró el enlace; el panel de esta tablet aún no se enteró
  t.nfc.acercar(ENLACE(3));                                 // la pegatina trae el enlace VIEJO, que es igual al que el panel conoce
  assert.equal(await revision, false);
  assert.match(t.pos.nfcEstado.mensaje, /El enlace de la mesa 3 cambió mientras tanto/);
  assert.equal(t.pos.nfcEstado.accion, 'revisar');
  assert.equal(t.base.mesas.get(3).pegatina_revisada_en ?? null, null);
  assert.deepEqual(plano(t.supabase.rpcs('pegatina_marcar').at(-1).args), { p_id: 3, p_tipo: 'revisada', p_token: TOKEN });
  // Una vez el panel conoce el enlace nuevo, la pegatina vieja se juzga contra él (es vieja) y la nueva pasa.
  await asentar();
  const otra = t.pos.revisarPegatina(3);
  t.nfc.acercar(ENLACE(3, OTRO));
  assert.equal(await otra, true);
  assert.ok(t.base.mesas.get(3).pegatina_revisada_en);
});

test('R6c el eco de Realtime de `mesas` refresca el panel (el enlace que se escribiría y las fechas) sin releerlo; marcarPegatinaManual (iPhone) anota con el token del enlace visible', async () => {
  const t = await conPanel();
  const antes = t.pos.mesasAdmin.find((m) => m.id === 3);
  assert.equal(antes.enlace, ENLACE(3));
  t.pos.procesarCambioEnVivo('mesas', { eventType: 'UPDATE', new: { ...mesaBase(3, { estado: 'libre', token: OTRO, activa: true, pegatina_escrita_en: null, pegatina_revisada_en: null }) }, old: {} });
  const despues = t.pos.mesasAdmin.find((m) => m.id === 3);
  assert.equal(despues.enlace, ENLACE(3, OTRO), 'el panel sigue a la base: el enlace ya es el nuevo');
  assert.equal(t.pos.mesasAdmin.length, 2);
  // Una mesa que se desactiva en otro dispositivo sigue en el panel (como inactiva) pero sale del salón.
  t.pos.procesarCambioEnVivo('mesas', { eventType: 'UPDATE', new: { ...mesaBase(5, { estado: 'libre', activa: false }) }, old: {} });
  assert.equal(t.pos.mesasAdmin.find((m) => m.id === 5).activa, false);
  assert.equal(t.pos.mesas.some((m) => m.id === 5), false);

  // iPhone: «Ya la escribí» con el enlace que el panel muestra.
  t.base.mesas.get(3).token = OTRO;
  assert.equal(await t.pos.marcarPegatinaManual(3, 'escrita'), true);
  assert.ok(t.base.mesas.get(3).pegatina_escrita_en);
  assert.deepEqual(plano(t.supabase.rpcs('pegatina_marcar').at(-1).args), { p_id: 3, p_tipo: 'escrita', p_token: OTRO });
  assert.match(t.pos.aviso.texto, /Anotado: la pegatina de la mesa 3 está escrita/);
  t.base.mesas.get(3).token = TOKEN;                        // mientras la persona escribía con NFC Tools, otro dispositivo giró el enlace
  assert.equal(await t.pos.marcarPegatinaManual(3, 'revisada'), false);
  assert.match(t.pos.mesasAdminError, /El enlace de esa mesa cambió|cambió mientras tanto/);
});

// ═════════════════════════ R7. Cobros deshechos hoy ═════════════════════════

test('R7 «Cobros deshechos hoy»: el admin lee la tabla `deshechos`; «hoy» es el turno (lo que aún no cuelga de un cierre); el mesero no la lee', async () => {
  const t = await conCuenta({ rol: 'admin', cierres: [{ id: 'c0', fecha: '2026-09-30T22:00:00Z', total_ventas: 0, total_ordenes: 0, transacciones: [] }] });
  // `cierre_id` lo pone cerrar_dia: null = el turno sigue abierto. No depende del reloj de la tablet (la fila 1 es POSTERIOR al cierre por hora y aun así
  // es de ese cierre; la 2 es ANTERIOR por hora y sigue en el turno abierto: la hora ya no decide nada).
  const fila = (id, mesa, tipo, monto, quien, cuando, cierre = null) => ({ id, orden_id: `x${id}`, mesa_id: mesa, tipo, monto, items: [], hecho_por: quien, hecho_en: cuando, cierre_id: cierre });
  t.base.deshechosTabla.push(
    fila(1, 3, 'parcial', 26000, 'mesero1@ejemplo.test', '2026-09-30T23:55:00Z', 'c0'),    // ya cuelga del último cierre: es de otro turno
    fila(2, 6, 'abono', 20000, 'camila@ejemplo.test', '2026-09-30T21:10:00Z'),
    fila(3, 2, 'completo', 63000, 'mesero1@ejemplo.test', '2026-09-30T23:40:00Z'),
  );
  assert.equal(await t.pos.cargarDeshechos(), true);
  assert.equal(t.pos.deshechosFilas.length, 3, 'leyó las tres filas');
  assert.deepEqual(plano(t.pos.deshechosHoy.map((d) => d.id)), [3, 2], 'el más reciente primero, y solo lo de este turno');
  assert.deepEqual(plano(t.pos.deshechosDeCierre('c0').map((d) => d.id)), [1], 'y el cierre c0 sabe cuál es el suyo');
  assert.equal(t.pos.deshechosDeCierre('c0').length === 1 && t.pos.deshechosDeCierreMonto('c0'), 26000);
  assert.deepEqual(plano(t.pos.deshechosDeCierre('otro')), []);
  assert.equal(t.pos.deshechosHoyMonto, 83000);
  assert.equal(t.pos.quienDeshizo(t.pos.deshechosHoy[1]), 'camila', 'la parte del correo antes de la arroba (el correo completo va de título)');
  assert.equal(t.pos.etiquetaDeshecho(t.pos.deshechosHoy[0]), 'Mesa completa');
  assert.equal(t.pos.etiquetaDeshecho({ tipo: 'abono' }), 'Abono');
  assert.equal(t.pos.etiquetaDeshecho({ tipo: 'parcial' }), 'Cobro parcial');
  assert.deepEqual(plano(t.supabase.de('deshechos', 'select').at(-1).filtros), []);

  // El mesero: ni la pide ni la ve (la base tampoco se la daría).
  const m = await conCuenta({ rol: 'mesero' });
  const antes = m.supabase.de('deshechos').length;
  assert.equal(await m.pos.cargarDeshechos(), false);
  assert.equal(m.supabase.de('deshechos').length, antes, 'no hace ni la consulta');
  assert.deepEqual(plano(m.pos.deshechosHoy), []);
  // Sin la migración (la tabla no existe): no es un error.
  const v = montar({ rol: 'admin', mesas: [mesaBase(3)] });
  v.base.olaC.deshacer = false;
  await listo(v);
  assert.equal(await v.pos.cargarDeshechos(), false);
  assert.equal(v.pos.deshechosError, '');
  // Un fallo de red sí se dice.
  const f = await conCuenta({ rol: 'admin' });
  f.base.fallar('select:deshechos');
  assert.equal(await f.pos.cargarDeshechos(), false);
  assert.match(f.pos.deshechosError, /No se pudieron leer los cobros deshechos/);
});

test('R7b después de deshacer, el admin ve el registro al instante (sin cambiar de pantalla)', async () => {
  const t = await conCuenta({ rol: 'admin' });
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(t.pos.ordenActiva.items.find((i) => i.id === 'paloma'));
  await t.pos.facturarParcial();
  await asentar();
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar();
  assert.equal(t.pos.deshechosFilas.length, 1);
  assert.equal(t.pos.deshechosHoy.length, 1);
  assert.equal(t.pos.deshechosHoy[0].tipo, 'parcial');
  assert.equal(t.pos.deshechosHoy[0].monto, 9000);
  assert.equal(t.pos.deshechosHoy[0].quien, 'yo@ejemplo.test');
});

// ═════════════════════════ R8. La espera de aprobación responde ═════════════════════════

test('R8 «Reintentar» de la espera: pregunta sin recargar, dice «sigues en espera» si no la aprobaron y abre la app si ya la aprobaron', async () => {
  const t = montar({ rol: null, acceso: 'ninguno', mesas: [mesaBase(3)] });
  await t.pos.arrancarApp();
  assert.equal(t.pos.esperaAprobacion, true);
  assert.equal(t.pos.comprobandoEspera, false);
  const p = t.pos.comprobarEspera();
  assert.equal(t.pos.comprobandoEspera, true, 'mientras pregunta, el botón dice «Comprobando…»');
  assert.equal(await t.pos.comprobarEspera(), false, 'un toque a la vez');
  assert.equal(await p, false);
  assert.equal(t.pos.comprobandoEspera, false);
  assert.equal(t.pos.esperaSigue, true, 'sigues en espera: la pantalla lo dice');
  assert.equal(t.pos.esperaAprobacion, true);
  assert.ok(t.supabase.rpcs('solicitar_acceso').length >= 2, 'volvió a preguntar a la base');

  // Un admin la aprueba en otro dispositivo.
  t.base.personal.get(YO.email).estado = 'aprobado';
  assert.equal(await t.pos.comprobarEspera(), true);
  await asentar();
  assert.equal(t.pos.esperaAprobacion, false);
  assert.equal(t.pos.esperaSigue, false);
  assert.equal(t.pos.estadoAcceso, 'aprobado');
  assert.equal(t.pos.rol, 'mesero');
  assert.equal(t.pos.mesasPendiente.length, 0, 'el mapa de solo lectura se vacía');
  assert.ok(t.pos.mesas.length > 0, 'y arrancó la app normal sin recargar');
});

// ═════════════════════════ R9. Avisos con acción y aprobar ═════════════════════════

test('R9 un aviso con acción lleva a esa vista con un toque; aprobar dice quién entra y con qué rol; una solicitud nueva no dice «Apruébala» (sin género)', async () => {
  const t = montar({ rol: 'admin', personal: [{ email: 'laura@ejemplo.test', nombre: 'Laura Demo', rol: 'mesero', activo: true, estado: 'pendiente', solicitado_en: '2026-09-30T12:00:00Z' }] });
  await listo(t);
  assert.equal(await t.pos.aprobarPersonal('laura@ejemplo.test', 'mesero'), true);
  assert.equal(t.pos.aviso.texto, 'Laura Demo entra como mesero. Si no era ese rol, cámbialo en Equipo.');
  assert.deepEqual(plano(t.pos.aviso.accion), { vista: 'personal', etiqueta: 'Ver' });
  t.pos.vista = 'mesas';
  t.pos.irDesdeAviso();
  assert.equal(t.pos.vista, 'personal', '«Ver» va a Personal');
  assert.equal(t.pos.aviso, null, 'y cierra el aviso');
  t.pos.avisar('Solo texto');
  assert.equal(t.pos.aviso.accion, null);
  t.pos.irDesdeAviso();
  assert.equal(t.pos.vista, 'personal', 'un aviso sin acción no navega');

  t.pos.procesarCambioPersonal({ eventType: 'INSERT', new: { email: 'dora@ejemplo.test', nombre: 'Dora', rol: 'mesero', activo: true, estado: 'pendiente', solicitado_en: '2026-09-30T14:00:00Z' }, old: {} });
  assert.equal(t.pos.aviso.texto, 'Hay una solicitud nueva: Dora. Revísala en Personal.');
  assert.doesNotMatch(t.pos.aviso.texto, /Apruébala/);
  assert.deepEqual(plano(t.pos.aviso.accion), { vista: 'personal', etiqueta: 'Ver' });
});

test('R9b qrSvgPara dibuja el QR de una dirección sin mirar si el QR está encendido en lo guardado; una dirección inválida no dibuja nada', async () => {
  const t = montar({ rol: 'admin', mesas: [mesaBase(3)] });
  await listo(t);
  t.pos.ajustes = { ...t.pos.ajustes, ticketQrVisible: false };
  assert.equal(t.pos.qrTicketSvg, '', 'apagado en lo guardado: el ticket sale sin QR');
  // (en esta prueba la librería de QR no está cargada: qrSvgPara no lanza y devuelve '' en vez de un cuadro roto)
  assert.doesNotThrow(() => t.pos.qrSvgPara('https://resplandor.ynt.codes/'));
  assert.equal(t.pos.qrSvgPara('javascript:alert(1)'), '');
  assert.equal(t.pos.qrSvgPara(''), '');
  assert.equal(t.pos.qrSvgPara(null), '');
});
