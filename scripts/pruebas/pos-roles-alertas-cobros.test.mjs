// Ola B, parte B1: la LÓGICA del POS para roles, alertas «pedir la cuenta», personal y los dos cobros nuevos
// (por monto y por unidades). Corre el <script> REAL de pos.html en un `vm` (scripts/pruebas/_pos-vm.mjs)
// contra una base falsa con las reglas que importan: mi_rol(), atender/descartar_alerta, personal_*, la RPC
// de deltas (NO idempotente, falla si la orden no existe) y la red como interruptor.
//
//   1. Rol y sin acceso   rpc('mi_rol') ANTES de sincronizar; sin rol no se lee, no se escucha y se borra la caché;
//                         la RPC sin crear = admin (transitorio); sin red = el último rol guardado.
//   2. Guardas            las acciones de admin no corren con rol de mesero (el mesero SÍ crea y edita productos).
//   3. Errores de permiso un 42501 avisa, vuelve a leer y NO deja la cola de deltas atascada.
//   4. Alertas            lista, Realtime, pitido (WebAudio simulado), silencio, recordatorio, título, atender y descartar.
//   5. Personal           las RPC personal_* y sus errores en `personalError`.
//   6. Cobro por unidades marcar, ajustar entre 1 y qty, cobrar n y dejar qty − n.
//   7. Cobro por monto    abono + resto = total; «Liberar mesa vacía» y reabrir con líneas negativas.
//
// Cada prueba falla si se quita lo que prueba (los mutantes que corrí a mano están en el informe de la parte).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertaBase, asentar, crearBaseFalsa, crearPos, delta, hastaQue, item, mesaBase, ordenBase, ordenLocal, plano, soltar,
} from './_pos-vm.mjs';

const lista = (mapa) => [...mapa.values()];
const abiertaDe = (base, mesaId) => lista(base.ordenes).find((o) => o.mesa_id === mesaId && o.estado === 'abierta');
const cerradas = (base) => lista(base.ordenes).filter((o) => o.estado === 'cerrada');
const sumar = (items) => items.reduce((s, i) => s + i.precio * i.qty, 0);
const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };

/** Un AudioContext de mentira: cuenta los osciladores (2 por pitido). */
function audioFalso({ estado = 'running' } = {}) {
  const creados = [];
  class AudioContext {
    constructor() { this.state = estado; this.currentTime = 0; this.destination = {}; this.osciladores = []; this.reanudado = 0; creados.push(this); }
    resume() { this.reanudado++; this.state = 'running'; }
    createOscillator() { const o = { frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; this.osciladores.push(o); return o; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  return { AudioContext, creados, pitidos: () => creados.reduce((s, c) => s + c.osciladores.length, 0) / 2 };
}

/** Relojes espía: setInterval registra {fn, ms, id}; clearInterval anota los ids. */
function relojesEspia() {
  const intervalos = [];
  const limpiados = [];
  return {
    intervalos, limpiados,
    setInterval: (fn, ms) => { const id = intervalos.length + 1; intervalos.push({ fn, ms, id }); return id; },
    clearInterval: (id) => { if (id != null) limpiados.push(id); },
  };
}

/**
 * Un POS «con sesión» listo para probar: base falsa + store en un vm. Por defecto, sin arrancar (cada prueba decide:
 * `await t.pos.arrancarApp()` o `await t.pos.cargarRol()`).
 */
function montar({
  rol = 'admin', mesas = [mesaBase(3)], ordenes = [], productos = [], alertas = [], personal = [], conAudio = false, usuario = YO, almacen,
  interceptar, despues,
} = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, productos, alertas, personal });
  // `interceptar(llamada)` contesta ANTES que la base (devuelve una respuesta o undefined); `despues(llamada, respuesta)` mira
  // lo que la base contestó. Se envuelve aquí porque crearPos se queda con `base.responder` al crearse.
  if (interceptar || despues) {
    const original = base.responder;
    base.responder = async (c) => {
      const r = (interceptar && interceptar(c)) ?? await original(c);
      if (despues) despues(c, r);
      return r;
    };
  }
  const audio = audioFalso();
  const relojes = relojesEspia();
  const extras = { setInterval: relojes.setInterval, clearInterval: relojes.clearInterval, navigator: { vibrate() { t.vibraciones++; } } };
  if (conAudio) extras.AudioContext = audio.AudioContext;
  const t = crearPos({ base, almacen, extras, documento: { title: 'Resplandor — POS', visibilityState: 'visible' } });
  t.base = base; t.audio = audio; t.relojes = relojes; t.vibraciones = 0;
  t.pos.usuario = usuario;
  return t;
}

/** Una orden abierta de la mesa 3 en la base y en el store, lista para cobrar. */
function conOrdenAbierta(t, items, { mesaId = 3, id = 'o1' } = {}) {
  t.base.ordenes.set(id, { ...ordenBase(id, mesaId, items, 1) });
  t.pos.mesas = [mesaBase(mesaId)];
  t.pos.ordenes = [ordenLocal(id, mesaId, items.map((i) => ({ ...i })), 1)];
  t.pos.mesaActiva = t.pos.mesas[0];
  t.pos.ordenActiva = t.pos.ordenes[0];
  t.pos.remoto = 'ok';
  return t.pos.ordenActiva;
}

// ═════════════════════════ 1. Rol y sin acceso ═════════════════════════

test('rol: arrancarApp pregunta solicitar_acceso y mi_rol ANTES de leer nada y, con rol, todo sigue como hoy (caché, lecturas, canales)', async () => {
  const t = montar({ rol: 'admin', mesas: [mesaBase(3)] });
  await t.pos.arrancarApp();

  assert.equal(t.pos.rol, 'admin');
  assert.equal(t.pos.rolCargado, true);
  assert.equal(t.pos.sinAcceso, false);
  assert.equal(t.pos.esAdmin, true);
  assert.equal(t.pos.esMesero, false);
  // Ola C: solicitar_acceso va ANTES de mi_rol (si la base aún no la tiene, el POS sigue como en la ola B con mi_rol).
  const [primera, segunda] = t.supabase.llamadas;
  assert.deepEqual([primera.tipo, primera.nombre], ['rpc', 'solicitar_acceso'], 'lo primero que pregunta el POS es si la cuenta tiene acceso');
  assert.deepEqual([segunda.tipo, segunda.nombre], ['rpc', 'mi_rol'], 'y enseguida, el rol');
  assert.ok(t.supabase.de('mesas', 'select').length >= 1, 'con rol sincroniza');
  assert.ok(t.supabase.canal('pos_sync') && t.supabase.canal('presencia_pos') && t.supabase.canal('pos_alertas'), 'y abre sus canales');
  assert.equal(t.pos.mesas.length, 1);
});

test('rol: mesero (esMesero) y la matriz de puede(): 6 acciones solo del admin, 3 de los dos, y lo desconocido no se permite', async () => {
  const mesero = montar({ rol: 'mesero' });
  await mesero.pos.cargarRol();
  const admin = montar({ rol: 'admin' });
  await admin.pos.cargarRol();

  assert.equal(mesero.pos.esMesero, true);
  for (const a of ['catalogo_borrar', 'menu_semanal', 'cierre_dia', 'personal', 'editar_cerradas', 'rotar_token']) {
    assert.equal(admin.pos.puede(a), true, `admin puede ${a}`);
    assert.equal(mesero.pos.puede(a), false, `mesero NO puede ${a}`);
  }
  for (const a of ['catalogo_crear', 'catalogo_editar', 'ver_cierres']) {
    assert.equal(admin.pos.puede(a), true, `admin puede ${a}`);
    assert.equal(mesero.pos.puede(a), true, `mesero SÍ puede ${a} (decisión de Yonatan)`);
  }
  assert.equal(admin.pos.puede('inventada'), false);
  assert.equal(montar().pos.puede('cierre_dia'), false, 'sin rol cargado nadie puede nada');
});

test('sin acceso: mi_rol() devuelve null SIN error → sinAcceso, no se lee la caché ni la base, no se abre ningún canal y se borra lo guardado', async () => {
  const almacen = new Map([
    ['pos_mesas', JSON.stringify([mesaBase(3)])],
    ['pos_ordenes', JSON.stringify([ordenLocal('o1', 3, [item('p1', 5000)])])],
    ['pos_productos', JSON.stringify([{ id: 'p1', cat: 'X', nombre: 'p1', precio: 5000 }])],
    ['pos_cierres', JSON.stringify([{ id: 'c1', total: 100 }])],
    ['pos_delta_queue', JSON.stringify([delta('o1', 'p1', 1)])],
    ['pos_pendientes', JSON.stringify({ 'ordenes:o1': true })],
    ['pos_rol', JSON.stringify({ uid: 'u1', rol: 'admin' })],
    ['pos_device_id', 'tablet-1'],
    ['pos_alertas_silencio', '99'],
  ]);
  const t = montar({ rol: null, almacen });
  await t.pos.arrancarApp();

  assert.equal(t.pos.sinAcceso, true);
  assert.equal(t.pos.rol, null);
  assert.equal(t.pos.rolCargado, true);
  assert.equal(t.pos.tieneAcceso, false);
  assert.equal(t.supabase.llamadas.filter((c) => c.tipo === 'from').length, 0, 'no lee ni escribe ninguna tabla');
  assert.equal(t.supabase.canales.length, 0, 'ni sync, ni presencia, ni alertas');
  assert.equal(t.pos._appArrancada, false);
  for (const k of ['pos_mesas', 'pos_ordenes', 'pos_productos', 'pos_cierres', 'pos_delta_queue', 'pos_pendientes', 'pos_rol']) {
    assert.ok(!almacen.has(k), `${k} se borró`);
  }
  assert.equal(almacen.get('pos_device_id'), 'tablet-1', 'el id de la tablet no es dato de la sesión');
  assert.equal(almacen.get('pos_alertas_silencio'), '99', 'ni el silencio de las alertas');
  assert.deepEqual([t.pos.mesas.length, t.pos.ordenes.length, t.pos.colaDeltas.length], [0, 0, 0], 'y la memoria queda vacía');
  assert.equal(t.pos.productos.length, 0, 'sin siquiera la semilla local de productos');
});

test('sin acceso: darla de alta y «volver a comprobar» arranca la app (reintentarAcceso)', async () => {
  const t = montar({ rol: null });
  await t.pos.arrancarApp();
  assert.equal(t.pos.sinAcceso, true);

  t.base.rol = 'mesero';
  await t.pos.reintentarAcceso();

  assert.equal(t.pos.sinAcceso, false);
  assert.equal(t.pos.rol, 'mesero');
  assert.equal(t.pos._appArrancada, true);
  assert.ok(t.supabase.canal('pos_sync'), 'ahora sí abre sus canales');
});

test('rol: si la base le quita el acceso con la sesión abierta, al revalidar se detiene todo (canales, relojes, caché)', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])], alertas: [alertaBase('a1', 3, 'o1')] });
  await t.pos.arrancarApp();
  assert.equal(t.pos.alertas.length, 1);
  assert.ok(t.relojes.intervalos.length >= 1, 'con una alerta pendiente hay relojes');

  t.base.rol = null;                        // la dieron de baja
  await t.pos.revalidarRol(true);

  assert.equal(t.pos.sinAcceso, true);
  assert.equal(t.pos.rol, null);
  assert.equal(t.pos._appArrancada, false);
  assert.ok(t.supabase.canales.every((c) => c.removido), 'todos los canales se cerraron');
  assert.equal(t.pos.alertas.length, 0);
  assert.equal(t.pos.ordenes.length, 0, 'la caché de la sesión anterior se borró');
  assert.ok(t.relojes.limpiados.length >= 1, 'los relojes de las alertas se pararon');
});

test('rol: si el admin pierde el rol mientras mira «Personal», la vista vuelve a las mesas (no se queda en una pantalla que ya no es suya)', async () => {
  const t = montar({ rol: 'admin' });
  await t.pos.arrancarApp();
  t.pos.vista = 'personal';
  t.base.rol = 'mesero';
  await t.pos.revalidarRol(true);
  assert.equal(t.pos.rol, 'mesero');
  assert.equal(t.pos.vista, 'mesas');

  const u = montar({ rol: 'admin' });
  await u.pos.arrancarApp();
  u.pos.vista = 'personal';
  await u.pos.revalidarRol(true);
  assert.equal(u.pos.vista, 'personal', 'un admin que sigue siendo admin no se mueve');
});

test('rol: revalidarRol no se repite en 15 s (cada SUBSCRIBED y cada vuelta a la pestaña lo llaman) salvo con `forzar`; sin sesión no hace nada', async () => {
  const t = montar({ rol: 'admin' });
  await t.pos.arrancarApp();
  const preguntas = () => t.supabase.rpcs('mi_rol').length;
  assert.equal(preguntas(), 1);
  await t.pos.revalidarRol();
  assert.equal(preguntas(), 1, 'recién preguntado: no vuelve a preguntar');
  await t.pos.revalidarRol(true);
  assert.equal(preguntas(), 2, 'forzar sí');

  const sinSesion = montar({ rol: 'admin', usuario: null });
  await sinSesion.pos.revalidarRol(true);
  assert.equal(sinSesion.supabase.rpcs('mi_rol').length, 0);
});

test('rol: cada SUBSCRIBED de pos_sync revalida el rol (pudieron darla de baja mientras no había red)', async () => {
  const t = montar({ rol: 'admin' });
  await t.pos.arrancarApp();
  t.pos._rolRevisadoEn = 0;                 // pasaron más de 15 s
  t.base.rol = null;
  t.supabase.canal('pos_sync').suscripcion('SUBSCRIBED');
  await hastaQue(() => t.pos.sinAcceso);
  assert.equal(t.pos.sinAcceso, true);
});

test('rol: la RPC mi_rol() aún no existe (migración sin aplicar) → se trata como admin para no romper el POS de hoy, y no es «sin acceso»', async () => {
  const t = montar({ rol: 'mesero' });
  t.base.sinFuncion.add('mi_rol');
  await t.pos.arrancarApp();

  assert.equal(t.pos.rol, 'admin');
  assert.equal(t.pos.sinAcceso, false);
  assert.equal(t.pos.rolSinConfirmar, true);
  assert.ok(t.supabase.canal('pos_sync'), 'y la app arranca');
  assert.ok(t.consola.some((c) => c[0] === 'warn' && /mi_rol/.test(String(c[1]))), 'deja constancia');
});

test('rol: sin red NO se sabe: el último rol CONFIRMADO de ESA cuenta, o «no pudimos comprobar» (sin suponer mesero ni cargar la caché); nunca sinAcceso; al volver la red se confirma', async () => {
  // misma cuenta: usa el guardado
  const conGuardado = montar({ rol: 'admin', almacen: new Map([['pos_rol', JSON.stringify({ uid: 'u1', rol: 'admin' })]]) });
  conGuardado.base.red = false;
  await conGuardado.pos.arrancarApp();
  assert.equal(conGuardado.pos.rol, 'admin');
  assert.equal(conGuardado.pos.rolSinConfirmar, true);
  assert.equal(conGuardado.pos.sinAcceso, false);

  // otra cuenta en la misma tablet: no hereda el rol de la anterior
  const otraCuenta = montar({ rol: 'admin', almacen: new Map([['pos_rol', JSON.stringify({ uid: 'otro', rol: 'admin' })]]) });
  otraCuenta.base.red = false;
  otraCuenta.almacen.set('pos_mesas', JSON.stringify([mesaBase(3)]));   // la caché de la tablet (lleva el token de las mesas)
  await otraCuenta.pos.arrancarApp();
  // refutación de la ola B, hallazgo 7: con un 5xx una cuenta que NO está en `personal` se trataba como mesero y cargaba la caché
  assert.equal(otraCuenta.pos.rol, null, 'sin dato propio NO se supone «mesero»');
  assert.equal(otraCuenta.pos.accesoSinComprobar, true);
  assert.equal(otraCuenta.pos.pantallaSinAcceso, true, 'se ve la pantalla «no pudimos comprobar tu acceso»');
  assert.equal(otraCuenta.pos.sinAcceso, false, 'pero no es un «no»: nada se borra');
  assert.deepEqual(plano(otraCuenta.pos.mesas), [], 'la caché de la tablet no se carga');
  assert.ok(otraCuenta.almacen.has('pos_mesas'), 'ni se borra: puede ser una persona con acceso y la red caída');
  assert.equal(otraCuenta.supabase.canal('pos_sync'), undefined, 'no se abre ningún canal');

  // vuelve la red: se comprueba solo
  otraCuenta.base.red = true;
  await otraCuenta.pos.revalidarRol(true);
  assert.equal(otraCuenta.pos.rol, 'admin');
  assert.equal(otraCuenta.pos.rolSinConfirmar, false);
  assert.equal(otraCuenta.pos.accesoSinComprobar, false);
  assert.ok(otraCuenta.supabase.canal('pos_sync'), 'y la app arranca');
});

test('rol: un 5xx de mi_rol sin rol guardado NO deja pasar a una cuenta sin acceso (aunque la base diga «no» después)', async () => {
  const t = montar({ rol: null });
  t.base.fallar('rpc:mi_rol');                           // error transitorio (5xx), no «sin función»
  await t.pos.arrancarApp();
  assert.equal(t.pos.accesoSinComprobar, true);
  assert.equal(t.pos.tieneAcceso, false);
  t.base.repararTodo();
  await t.pos.reintentarAcceso();
  assert.equal(t.pos.sinAcceso, true, 'la base contesta que no está en personal: ahora sí es «sin acceso»');
  assert.equal(t.pos.accesoSinComprobar, false);
});

test('rol: el rol confirmado se guarda para el próximo arranque sin red; el supuesto NO', async () => {
  const t = montar({ rol: 'mesero' });
  await t.pos.cargarRol();
  assert.deepEqual(t.guardado('pos_rol'), { uid: 'u1', rol: 'mesero' });

  const sinFuncion = montar({ rol: 'mesero' });
  sinFuncion.base.sinFuncion.add('mi_rol');
  await sinFuncion.pos.cargarRol();
  assert.ok(!sinFuncion.almacen.has('pos_rol'), 'el admin «transitorio» no se guarda como si la base lo hubiera dicho');
});

test('rol: cerrar sesión detiene los canales y olvida el rol: la siguiente persona pregunta el suyo', async () => {
  const t = montar({ rol: 'admin' });
  await t.pos.arrancarApp();
  await t.pos.cerrarSesion();
  assert.equal(t.pos.rol, null);
  assert.equal(t.pos.rolCargado, false);
  assert.equal(t.pos._appArrancada, false);
  assert.ok(t.supabase.canales.every((c) => c.removido));
});

test('rol: varias llamadas a arrancarApp a la vez comparten UNA consulta del rol y UN solo juego de canales', async () => {
  const t = montar({ rol: 'admin' });
  await Promise.all([t.pos.arrancarApp(), t.pos.arrancarApp(), t.pos.revalidarRol(true)]);
  assert.equal(t.supabase.rpcs('mi_rol').length, 1);
  assert.equal(t.supabase.canales.filter((c) => c.nombre === 'pos_sync').length, 1);
});

// ═════════════════════════ 2. Guardas de admin ═════════════════════════

test('guardas: un mesero NO borra productos, no cierra el día, no toca el menú semanal, no rota tokens ni edita cierres; avisa y no escribe nada', async () => {
  const t = montar({ rol: 'mesero', ordenes: [] });
  await t.pos.cargarRol();
  t.pos.productos = [{ id: 'p1', cat: 'Bebidas', nombre: 'Jugo', precio: 5000, desc: '', activo: true }];
  t.pos.mesas = [mesaBase(3)]; t.pos.mesaActiva = t.pos.mesas[0];
  t.pos.ordenes = [{ ...ordenLocal('c1', 3, [item('p1', 5000)], 1, 'cerrada'), cerradaEn: new Date().toISOString() }];
  const antes = t.supabase.llamadas.length;

  t.pos.eliminarProducto('p1');
  t.pos.cerrarDia();
  await t.pos.guardarMenu();
  await t.pos.toggleActivoMenu({ id: 'm1', activo: true });
  await t.pos.eliminarMenu({ id: 'm1', principal: 'X' });
  await t.pos.generarSemana();
  assert.equal(await t.pos.rotarTokenMesa(), false);
  t.pos.abrirEditorTransaccion(t.pos.ordenes[0]);
  t.pos.solicitarReapertura(t.pos.ordenes[0]);
  t.pos.editarSinMesa(t.pos.ordenes[0]);
  t.pos.eliminarOrdenDeCierre({ id: 'x', ordenes: [t.pos.ordenes[0]] }, t.pos.ordenes[0]);

  assert.equal(t.supabase.llamadas.length, antes, 'ninguna llamada a la base');
  assert.equal(t.pos.productos.length, 1, 'el producto sigue');
  assert.equal(t.pos.cierres.length, 0, 'no hubo cierre');
  assert.equal(t.pos.modalEditarTransaccion, false);
  assert.equal(t.avisos.length, 11, 'cada intento avisa');
  assert.ok(t.avisos.every((a) => /Solo el admin/.test(a)));
  assert.deepEqual(t.confirmaciones, [], 'y ni siquiera pregunta «¿seguro?»: no se podía');
});

test('guardas: el mesero SÍ crea y edita productos (decisión de Yonatan, 2026-09-30)', async () => {
  const t = montar({ rol: 'mesero' });
  await t.pos.cargarRol();
  t.pos.productos = [{ id: 'p1', cat: 'Bebidas', nombre: 'Jugo', precio: 5000, desc: '', activo: true }];

  t.pos.abrirModalProducto();
  t.pos.productoForm = { categoria: 'Bebidas', nombre: 'Limonada', precio: '6.500', desc: '' };
  t.pos.guardarProducto();
  t.pos.abrirModalProducto(t.pos.productos[0]);
  t.pos.productoForm.precio = '5500';
  t.pos.guardarProducto();
  await asentar();

  const subidos = t.supabase.de('productos', 'upsert').map((c) => c.cuerpo);
  assert.equal(subidos.length, 2);
  assert.equal(subidos[0].nombre, 'Limonada');
  assert.equal(subidos[0].precio, 6500);
  assert.equal(subidos[1].precio, 5500);
  assert.deepEqual(t.avisos, []);
});

test('guardas: un admin sí hace todo eso (borra el producto, cierra el día)', async () => {
  const t = montar({ rol: 'admin' });
  await t.pos.cargarRol();
  t.pos.productos = [{ id: 'p1', cat: 'Bebidas', nombre: 'Jugo', precio: 5000, desc: '', activo: true }];
  t.pos.eliminarProducto('p1');
  assert.equal(t.pos.productos.length, 0);
  assert.equal(t.supabase.de('productos', 'delete').length, 1);

  t.pos.mesas = [mesaBase(3, { estado: 'libre' })];
  t.pos.ordenes = [{ ...ordenLocal('c1', 3, [item('p1', 5000)], 1, 'cerrada'), cerradaEn: new Date().toISOString() }];
  t.pos.remoto = 'ok';   // (el cierre del día necesita la base a la vista)
  await t.pos.cerrarDia();
  assert.equal(t.pos.cierres.length, 1);
});

test('guardas: reabrir un abono NO se puede (dejaría un cobro positivo dentro de una cuenta abierta)', async () => {
  const t = montar({ rol: 'admin' });
  await t.pos.cargarRol();
  t.pos.mesas = [mesaBase(3, { estado: 'libre' })];
  const abono = ordenLocal('ab1', 3, [{ id: 'abono_x1', nombre: 'Abono', precio: 15000, qty: 1, nota: 'efectivo' }], 1, 'cerrada');
  t.pos.ordenes = [abono];

  t.pos.solicitarReapertura(abono);
  await t.pos.reabrirOrden(abono, 3);

  assert.equal(abono.estado, 'cerrada');
  assert.equal(t.pos.ordenActiva, null);
  assert.equal(t.pos.mesas[0].estado, 'libre');
  assert.equal(t.avisos.length, 2);
  assert.ok(t.avisos.every((a) => /abono/i.test(a)));
});

// ═════════════════════════ 3. Errores de permiso y cola de deltas ═════════════════════════

const DENEGADO = { code: '42501', message: 'new row violates row-level security policy for table "ordenes"' };

test('permisos: un 42501 al subir una fila avisa UNA vez, suelta la marca de pendiente (no se reintenta sin fin) y vuelve a leer la base', async () => {
  let denegar = false;
  const t = montar({
    rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)], 4, 'cerrada')],
    interceptar: (c) => (denegar && c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert' ? { data: null, error: DENEGADO } : undefined),
  });
  await t.pos.arrancarApp();
  denegar = true;
  const fila = ordenLocal('o1', 3, [item('p1', 5000)], 4, 'abierta');   // el mesero la reabrió; la base no lo acepta
  t.pos.ordenes = [fila];
  const lecturas = t.supabase.de('ordenes', 'select').length;

  await assert.rejects(() => t.pos.pushASupabase('ordenes', fila));
  await asentar();

  assert.equal(t.avisos.length, 1);
  assert.match(t.avisos[0], /Solo el admin puede hacer esto/);
  assert.deepEqual(plano(t.pos._pendientes), {}, 'la fila rechazada no queda «sin subir»: la lectura de la base la reemplaza');
  assert.ok(t.supabase.de('ordenes', 'select').length > lecturas, 'volvió a leer lo que la base sí tiene');
  assert.equal(t.pos.ordenes.find((o) => o.id === 'o1').estado, 'cerrada', 'y el POS quedó con lo que la base aceptó');

  await assert.rejects(() => t.pos.pushASupabase('ordenes', fila));   // otro rechazo seguido: no se repite el aviso
  assert.equal(t.avisos.length, 1, 'un aviso cada 4 s, no uno por intento');
});

test('permisos: un JWT vencido (401, PGRST301) NO es «sin permiso»: la fila sigue pendiente y no se avisa ni se relee (no se pierde lo que no subió)', async () => {
  let vencido = false;
  const t = montar({
    rol: 'mesero',
    interceptar: (c) => (vencido && c.tipo === 'from' && c.op === 'upsert' ? { data: null, error: { code: 'PGRST301', message: 'JWT expired' } } : undefined),
  });
  await t.pos.arrancarApp();
  vencido = true;
  const lecturas = t.supabase.llamadas.filter((c) => c.tipo === 'from' && c.op === 'select').length;
  await assert.rejects(() => t.pos.pushASupabase('ordenes', ordenLocal('o9', 3, [item('p1', 5000)])));
  await asentar();
  assert.deepEqual(Object.keys(plano(t.pos._pendientes)), ['ordenes:o9'], 'sigue pendiente: se reintenta cuando el token se renueve');
  assert.deepEqual(t.avisos, []);
  assert.equal(t.supabase.llamadas.filter((c) => c.tipo === 'from' && c.op === 'select').length, lecturas, 'y no se pisa nada con una lectura');
});

test('permisos: un fallo de RED sigue dejando la fila pendiente (lo de siempre) y no avisa de permisos', async () => {
  const t = montar({ rol: 'mesero' });
  await t.pos.arrancarApp();
  t.base.red = false;
  await assert.rejects(() => t.pos.pushASupabase('ordenes', ordenLocal('o9', 3, [item('p1', 5000)])));
  assert.deepEqual(Object.keys(plano(t.pos._pendientes)), ['ordenes:o9']);
  assert.deepEqual(t.avisos, []);
});

test('cola de deltas: un delta rechazado por permisos (42501) NO traba la cola: se descarta, se aplica el resto y se avisa una vez', async () => {
  const t = montar({
    rol: 'mesero', ordenes: [ordenBase('o1', 3, [])],
    interceptar: (c) => (c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden' && c.args.p_item_id === 'malo' ? { data: null, error: DENEGADO } : undefined),
  });
  await t.pos.arrancarApp();
  t.pos.colaDeltas = [delta('o1', 'malo', +1), delta('o1', 'bueno', +1), delta('o1', 'malo', +2)];

  await t.pos.flushDeltas();
  await asentar();

  assert.equal(t.pos.colaDeltas.length, 0, 'la cola quedó vacía: antes el primero la dejaba trabada para siempre');
  assert.deepEqual(t.base.rpcs.map((r) => r.item), ['bueno'], 'el delta bueno sí se aplicó');
  assert.equal(t.avisos.length, 1, 'un solo aviso por todo el lote');
  assert.deepEqual(t.guardado('pos_delta_queue'), [], 'y la cola guardada también');
});

test('cola de deltas: sin red el delta SE QUEDA (el break de siempre) y el siguiente intento lo aplica', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [])] });
  await t.pos.arrancarApp();
  t.pos.colaDeltas = [delta('o1', 'a', +1), delta('o1', 'b', +1)];
  t.base.red = false;
  await t.pos.flushDeltas();
  assert.equal(t.pos.colaDeltas.length, 2, 'nada se descarta por un fallo de red');
  t.base.red = true;
  await t.pos.flushDeltas();
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.deepEqual(t.base.rpcs.map((r) => r.item), ['a', 'b']);
});

test('cola de deltas: un delta de una orden que ya no existe ni aquí ni pendiente de subir se descarta; el de una orden pendiente se espera y se aplica', async () => {
  const t = montar({ rol: 'mesero', ordenes: [] });
  await t.pos.arrancarApp();
  t.pos.ordenes = [ordenLocal('nueva', 3, [item('y', 4000)])];        // abierta sin red (con su ítem): aún no está en la base
  t.pos._pendientes = { 'ordenes:nueva': true };
  t.pos.colaDeltas = [delta('fantasma', 'x', +1), delta('nueva', 'y', +1)];

  await t.pos.flushDeltas();
  await hastaQue(() => t.base.ordenes.get('nueva')?.items.length === 1);

  assert.ok(!t.pos.colaDeltas.some((d) => d.orden_id === 'fantasma'), 'el fantasma se fue de la cola');
  assert.ok(!t.base.rpcs.some((r) => r.orden === 'fantasma'));
  assert.deepEqual(t.base.ordenes.get('nueva').items.map((i) => i.id), ['y']);
  assert.ok(t.base.rpcs.some((r) => r.orden === 'nueva' && r.item === 'y' && r.delta === 1), 'el de la orden pendiente NO se descartó: esperó a que su esqueleto existiera y se APLICÓ como delta');
  assert.equal(t.pos.colaDeltas.length, 0);
});

test('cola de deltas: un delta que la base rechaza por permisos en el PRIMER intento tampoco se encola (se avisa y se relee)', async () => {
  let denegar = false;
  const t = montar({
    rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])],
    interceptar: (c) => (denegar && c.tipo === 'rpc' && c.nombre === 'aplicar_delta_orden' ? { data: null, error: DENEGADO } : undefined),
  });
  await t.pos.arrancarApp();
  denegar = true;
  conOrdenAbierta(t, [item('p1', 5000)]);

  t.pos.incrementarItem(t.pos.ordenActiva.items[0]);
  await asentar();

  assert.equal(t.pos.colaDeltas.length, 0, 'no queda en la cola');
  assert.equal(t.avisos.length, 1);
  assert.equal(t.pos.ordenActiva.items[0].qty, 1, 'y la lectura de la base deshizo el +1 optimista');
});

// ═════════════════════════ 4. Alertas ═════════════════════════

test('alertas: se leen las PENDIENTES (la más vieja primero) al sincronizar; sin tabla, sin red o sin acceso la lista no se toca', async () => {
  const t = montar({
    rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)]), ordenBase('o2', 4, [item('p1', 5000)])],
    mesas: [mesaBase(3), mesaBase(4)],
    alertas: [
      alertaBase('a-nueva', 4, 'o2', 'efectivo', '2026-09-30T18:40:00Z'),
      alertaBase('a-vieja', 3, 'o1', 'qr', '2026-09-30T18:30:00Z'),
      alertaBase('a-hecha', 5, null, 'qr', '2026-09-30T18:00:00Z', 'atendida'),
    ],
  });
  await t.pos.arrancarApp();

  assert.deepEqual(plano(t.pos.alertas), [
    { id: 'a-vieja', mesaId: 3, ordenId: 'o1', metodo: 'qr', creadaEn: '2026-09-30T18:30:00Z' },
    { id: 'a-nueva', mesaId: 4, ordenId: 'o2', metodo: 'efectivo', creadaEn: '2026-09-30T18:40:00Z' },
  ]);
  assert.equal(t.pos.alertasPendientes, 2, 'alertasPendientes es el número (la píldora)');
  assert.equal(t.pos.alertaDeMesa(4).id, 'a-nueva');
  assert.equal(t.pos.alertaDeMesa(9), null);

  const leida = t.supabase.de('alertas', 'select')[0];
  assert.deepEqual(leida.filtros.map(([c, v]) => [c, v]), [['estado', 'pendiente']], 'pide solo las pendientes');

  // sin red: ni siquiera pregunta
  t.pos.remoto = 'offline';
  const n = t.supabase.de('alertas', 'select').length;
  await t.pos._cargarAlertas();
  assert.equal(t.supabase.de('alertas', 'select').length, n);
});

test('alertas: si la tabla `alertas` aún no existe (migración sin aplicar) la lectura falla en silencio y el POS sigue con las mesas', async () => {
  const t = montar({
    rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])],
    interceptar: (c) => (c.tabla === 'alertas' ? { data: null, error: { code: 'PGRST205', message: 'Could not find the table public.alertas in the schema cache' } } : undefined),
  });
  await t.pos.arrancarApp();
  assert.equal(t.pos.alertas.length, 0);
  assert.equal(t.pos.remoto, 'ok');
  assert.equal(t.pos.ordenes.length, 1, 'lo demás se sincronizó');
  assert.ok(t.consola.length === 0 || t.consola.every((c) => c[0] !== 'error'), 'sin errores de consola');
});

test('alertas: el canal pos_alertas escucha postgres_changes de public.alertas (aparte de pos_sync) y cada SUBSCRIBED relee las pendientes', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])] });
  await t.pos.arrancarApp();
  const canal = t.supabase.canal('pos_alertas');
  assert.ok(canal, 'canal propio: si la tabla no existe todavía, falla ese canal y no el de las mesas');
  assert.deepEqual(plano(canal.eventos.map((e) => [e.tipo, e.filtro.event, e.filtro.schema, e.filtro.table])), [['postgres_changes', '*', 'public', 'alertas']]);
  assert.deepEqual(t.supabase.canal('pos_sync').eventos.map((e) => e.filtro.table), ['mesas', 'ordenes', 'productos'], 'pos_sync sigue igual');

  t.base.alertas.set('a1', alertaBase('a1', 3, 'o1'));   // llegó con la tablet dormida
  const lecturas = t.supabase.de('alertas', 'select').length;
  canal.suscripcion('SUBSCRIBED');
  await asentar();
  assert.equal(t.supabase.de('alertas', 'select').length, lecturas + 1);
  assert.equal(t.pos.alertas.length, 1);
});

test('alertas en vivo: INSERT suma, UPDATE de método suena otra vez sobre la MISMA fila, atendida/descartada/DELETE la quitan; título «(N) …» y reloj', async () => {
  const t = montar({ rol: 'mesero', conAudio: true, ordenes: [ordenBase('o1', 3, [item('p1', 5000)])] });
  await t.pos.arrancarApp();
  t.pos._desbloquearAudio();
  const fila = (extra = {}) => ({ ...alertaBase('a1', 3, 'o1', 'qr', '2026-09-30T18:30:00Z'), ...extra });

  t.pos.procesarCambioAlerta({ eventType: 'INSERT', new: fila(), old: {} });
  assert.equal(t.pos.alertas.length, 1);
  assert.equal(t.audio.pitidos(), 1, 'la alerta nueva suena');
  assert.equal(t.vibraciones, 1, 'y vibra donde se puede');
  assert.equal(t.caja.document.title, '(1) Resplandor — POS');

  t.pos.procesarCambioAlerta({ eventType: 'UPDATE', new: fila({ metodo: 'transferencia', creada_en: '2026-09-30T18:32:00Z' }), old: { id: 'a1' } });
  assert.equal(t.pos.alertas.length, 1, 'es la misma fila: no se duplica');
  assert.equal(t.pos.alertas[0].metodo, 'transferencia');
  assert.equal(t.audio.pitidos(), 2, 'cambió el método: suena de nuevo');

  t.pos.procesarCambioAlerta({ eventType: 'UPDATE', new: fila({ metodo: 'transferencia', creada_en: '2026-09-30T18:32:00Z' }), old: { id: 'a1' } });
  assert.equal(t.audio.pitidos(), 2, 'el mismo contenido otra vez no suena');

  t.pos.procesarCambioAlerta({ eventType: 'UPDATE', new: fila({ estado: 'atendida', atendida_en: '2026-09-30T18:33:00Z' }), old: { id: 'a1' } });
  assert.equal(t.pos.alertas.length, 0, 'otra tablet la atendió');
  assert.equal(t.caja.document.title, 'Resplandor — POS', 'el título vuelve a ser el de siempre');

  t.pos.procesarCambioAlerta({ eventType: 'INSERT', new: fila({ id: 'a2' }), old: {} });
  t.pos.procesarCambioAlerta({ eventType: 'DELETE', new: {}, old: { id: 'a2' } });
  assert.equal(t.pos.alertas.length, 0);
  t.pos.procesarCambioAlerta({ eventType: 'INSERT', new: fila({ id: 'a3', estado: 'descartada' }), old: {} });
  assert.equal(t.pos.alertas.length, 0, 'una que ya nace resuelta no entra');
});

test('alertas en vivo: una alerta de una orden que esta tablet ya cerró no cuenta; la de una orden que NO conoce sí (no se esconde una real)', async () => {
  const t = montar({ rol: 'mesero' });
  await t.pos.cargarRol();
  t.pos.ordenes = [ordenLocal('cerrada1', 3, [item('p1', 5000)], 2, 'cerrada')];
  t.pos.procesarCambioAlerta({ eventType: 'INSERT', new: alertaBase('x1', 3, 'cerrada1'), old: {} });
  assert.equal(t.pos.alertas.length, 0);
  t.pos.procesarCambioAlerta({ eventType: 'INSERT', new: alertaBase('x2', 4, 'orden-que-aun-no-llega'), old: {} });
  assert.equal(t.pos.alertas.length, 1);
});

test('alertas: facturar la orden o liberar la mesa vacía las saca de la lista al instante (la base las resuelve con un trigger)', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])] });
  await t.pos.cargarRol();
  conOrdenAbierta(t, [item('p1', 5000)]);
  t.pos.procesarCambioAlerta({ eventType: 'INSERT', new: alertaBase('a1', 3, 'o1'), old: {} });
  assert.equal(t.pos.alertaDeOrdenActiva.id, 'a1');
  t.pos.facturar();
  assert.equal(t.pos.alertas.length, 0);

  const u = montar({ rol: 'mesero' });
  await u.pos.cargarRol();
  conOrdenAbierta(u, []);
  u.pos.procesarCambioAlerta({ eventType: 'INSERT', new: alertaBase('a2', 3, 'o1'), old: {} });
  u.pos.liberarMesaVacia();
  assert.equal(u.pos.alertas.length, 0, 'la orden borrada descarta su alerta');
});

test('alertas: la lectura que trae algo NUEVO suena; la primera lectura (recién abierto el POS) y una lectura sin novedades no', async () => {
  const t = montar({ rol: 'mesero', conAudio: true, ordenes: [ordenBase('o1', 3, [item('p1', 5000)])], alertas: [alertaBase('a1', 3, 'o1')] });
  await t.pos.arrancarApp();
  t.pos._desbloquearAudio();
  assert.equal(t.pos.alertas.length, 1);
  assert.equal(t.audio.pitidos(), 0, 'la primera lectura no pita: la persona acaba de abrir la pantalla');

  await t.pos._cargarAlertas();
  assert.equal(t.audio.pitidos(), 0, 'releer lo mismo tampoco');

  t.base.alertas.set('a2', alertaBase('a2', 4, null, 'efectivo', '2026-09-30T18:45:00Z'));
  await t.pos._cargarAlertas();
  assert.equal(t.pos.alertas.length, 2);
  assert.equal(t.audio.pitidos(), 1, 'una nueva llegó mientras la tablet no escuchaba: suena');
});

test('sonido: solo con la pestaña visible y sin silenciar; sin AudioContext no falla; el primer toque lo desbloquea', async () => {
  const t = montar({ rol: 'mesero', conAudio: true });
  await t.pos.cargarRol();
  assert.equal(t.pos.sonidoListo, false, 'hasta el primer toque: «Toca para activar el sonido»');
  t.pos._desbloquearAudio();
  assert.equal(t.pos.sonidoListo, true);

  assert.equal(t.pos._pitar(), true);
  assert.equal(t.audio.pitidos(), 1);
  assert.equal(t.audio.creados[0].osciladores.length, 2, 'dos tonos cortos');

  t.caja.document.visibilityState = 'hidden';
  assert.equal(t.pos._pitar(), false, 'pestaña oculta: no suena');
  t.caja.document.visibilityState = 'visible';

  t.pos.silenciarAlertas(10);
  assert.equal(t.pos._pitar(), false, 'silenciadas: no suena');
  assert.equal(t.audio.pitidos(), 1);
  t.pos.silenciarAlertas(0);
  assert.equal(t.pos._pitar(), true, 'quitar el silencio');

  const mudo = montar({ rol: 'mesero' });                               // sin AudioContext en el navegador
  await mudo.pos.cargarRol();
  assert.doesNotThrow(() => mudo.pos._desbloquearAudio());
  assert.equal(mudo.pos._pitar(), false);
});

test('sonido: el audio suspendido se reanuda al sonar; el primer pointerdown/keydown del documento lo desbloquea', async () => {
  const t = montar({ rol: 'mesero', conAudio: true });
  await t.pos.arrancarApp();
  assert.equal(typeof t.eventosDocumento.pointerdown, 'function', 'el POS escucha el primer toque');
  t.eventosDocumento.pointerdown();
  assert.equal(t.pos.sonidoListo, true);
  assert.equal(t.audio.creados.length, 1);
  t.audio.creados[0].state = 'suspended';
  t.pos._pitar();
  assert.ok(t.audio.creados[0].reanudado >= 1, 'un contexto suspendido se reanuda');
});

test('silenciar 10 min: queda guardado en la tablet (sobrevive a recargar) y 0 lo quita', async () => {
  const almacen = new Map();
  const t = montar({ rol: 'mesero', almacen });
  const antes = Date.now();
  t.pos.silenciarAlertas(10);
  assert.ok(t.pos.alertasSilenciadasHasta >= antes + 600000 - 5);
  assert.equal(Number(almacen.get('pos_alertas_silencio')), t.pos.alertasSilenciadasHasta);

  const recargado = montar({ rol: 'mesero', almacen });
  assert.equal(recargado.pos.alertasSilenciadasHasta, t.pos.alertasSilenciadasHasta, 'otra carga de la página sigue silenciada');
  recargado.pos.silenciarAlertas(0);
  assert.equal(recargado.pos.alertasSilenciadasHasta, 0);
  assert.equal(almacen.get('pos_alertas_silencio'), '0');
});

test('recordatorio: mientras haya pendientes vuelve a sonar cada 2 min; sin pendientes los relojes se paran; `ahora` se refresca cada 30 s', async () => {
  const t = montar({ rol: 'mesero', conAudio: true, ordenes: [ordenBase('o1', 3, [item('p1', 5000)])] });
  await t.pos.arrancarApp();
  t.pos._desbloquearAudio();
  assert.deepEqual(t.relojes.intervalos, [], 'sin alertas no hay relojes');

  t.pos.procesarCambioAlerta({ eventType: 'INSERT', new: alertaBase('a1', 3, 'o1'), old: {} });
  assert.deepEqual(t.relojes.intervalos.map((i) => i.ms).sort((a, b) => a - b), [30000, 120000]);
  const recordatorio = t.relojes.intervalos.find((i) => i.ms === 120000);
  const reloj = t.relojes.intervalos.find((i) => i.ms === 30000);
  assert.equal(t.audio.pitidos(), 1);

  recordatorio.fn();
  assert.equal(t.audio.pitidos(), 2, 'a los 2 minutos, otro pitido');
  recordatorio.fn();
  assert.equal(t.audio.pitidos(), 3);

  const antes = t.pos.ahora;
  await new Promise((r) => setTimeout(r, 5));
  reloj.fn();
  assert.ok(t.pos.ahora > antes, '«hace X min» se recalcula');

  t.pos.procesarCambioAlerta({ eventType: 'UPDATE', new: alertaBase('a1', 3, 'o1', 'qr', '2026-09-30T18:30:00Z', 'atendida'), old: { id: 'a1' } });
  assert.ok(t.relojes.limpiados.includes(recordatorio.id) && t.relojes.limpiados.includes(reloj.id), 'sin pendientes se paran');
  const despues = t.audio.pitidos();
  t.pos._recordarAlertas();
  assert.equal(t.audio.pitidos(), despues, 'y un recordatorio tardío no suena sin pendientes');
});

test('atender: la alerta sale de la lista al instante, la RPC lleva {p_id} y un segundo toque en vuelo no manda otra', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])], alertas: [alertaBase('a1', 3, 'o1')] });
  await t.pos.arrancarApp();

  const primero = t.pos.atenderAlerta('a1');
  const segundo = t.pos.atenderAlerta('a1');
  assert.equal(t.pos.alertas.length, 0, 'optimista: ya no está');
  assert.equal(await primero, true);
  assert.equal(await segundo, false);

  const llamadas = t.supabase.rpcs('atender_alerta');
  assert.equal(llamadas.length, 1);
  assert.deepEqual(plano(llamadas[0].args), { p_id: 'a1' });
  assert.equal(t.base.alertas.get('a1').estado, 'atendida');
  assert.deepEqual(t.avisos, []);
});

test('atender: sin red se REVIERTE (la alerta vuelve) y se avisa; no hay cola offline', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])], alertas: [alertaBase('a1', 3, 'o1')] });
  await t.pos.arrancarApp();
  t.base.red = false;

  assert.equal(await t.pos.atenderAlerta('a1'), false);

  assert.equal(t.pos.alertas.length, 1, 'la alerta sigue pendiente en pantalla');
  assert.equal(t.pos.alertas[0].id, 'a1');
  assert.equal(t.avisos.length, 1);
  assert.match(t.avisos[0], /Sin conexión/);
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(t.base.alertas.get('a1').estado, 'pendiente');
});

test('atender: otra tablet llegó antes (no_pendiente) → se queda fuera, se avisa y se relee; sin permiso (no_autorizado) se revierte', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])], alertas: [alertaBase('a1', 3, 'o1')] });
  await t.pos.arrancarApp();
  t.base.alertas.get('a1').estado = 'atendida';           // la atendió otra tablet y esta aún no lo sabía
  const lecturas = t.supabase.de('alertas', 'select').length;

  assert.equal(await t.pos.atenderAlerta('a1'), false);
  await asentar();
  assert.equal(t.pos.alertas.length, 0, 'ya está resuelta: no vuelve');
  assert.match(t.pos.aviso.texto, /ya la atendió otra persona/i, 'un aviso en la pantalla, no un diálogo nativo');
  assert.deepEqual(t.avisos, [], 'sin alert() en medio del servicio');
  assert.equal(t.supabase.de('alertas', 'select').length, lecturas + 1, 'y se vuelve a leer');

  // no_autorizado: la RPC dice que esta cuenta ya no puede
  const u = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])], alertas: [alertaBase('a1', 3, 'o1')] });
  await u.pos.arrancarApp();
  u.base.rol = null;                                       // mi_rol ahora es null y la RPC contesta no_autorizado
  assert.equal(await u.pos.atenderAlerta('a1'), false);
  await hastaQue(() => u.pos.sinAcceso);
  assert.equal(u.pos.sinAcceso, true, 'y se revalida el rol: pasa a sin acceso');
});

test('descartar: el store NO pregunta con confirm() (la vista Alertas confirma en la página): una alerta que no existe no llama a nada y la que existe, sí', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])], alertas: [alertaBase('a1', 3, 'o1')] });
  await t.pos.arrancarApp();

  assert.equal(await t.pos.descartarAlerta('no-existe'), false);
  assert.equal(t.supabase.rpcs('descartar_alerta').length, 0);
  assert.equal(t.pos.alertas.length, 1);
  assert.equal(await t.pos.descartarAlerta('a1'), true);
  assert.equal(t.supabase.rpcs('descartar_alerta').length, 1);
  assert.deepEqual(t.confirmaciones, [], 'ni un confirm(): sería la segunda pregunta tras «Sí, descartar»');
});

test('descartar: confirmado, sale de la lista y la base la deja descartada', async () => {
  const t = montar({ rol: 'mesero', ordenes: [ordenBase('o1', 3, [item('p1', 5000)])], alertas: [alertaBase('a1', 3, 'o1')] });
  await t.pos.arrancarApp();
  assert.equal(await t.pos.descartarAlerta('a1'), true);
  assert.equal(t.pos.alertas.length, 0);
  assert.equal(t.base.alertas.get('a1').estado, 'descartada');
  assert.equal(t.supabase.rpcs('atender_alerta').length, 0, 'descartar no es atender');
});

test('irAMesaDeAlerta: abre la cuenta de esa mesa; con la mesa «libre» en esta tablet lee antes y NUNCA abre una cuenta nueva por error', async () => {
  const t = montar({
    rol: 'mesero', mesas: [mesaBase(3, { estado: 'ocupada' })], ordenes: [ordenBase('o1', 3, [item('p1', 5000)])],
    alertas: [alertaBase('a1', 3, 'o1')],
  });
  await t.pos.arrancarApp();
  assert.equal(await t.pos.irAMesaDeAlerta('a1'), true);
  assert.equal(t.pos.vista, 'orden');
  assert.equal(t.pos.ordenActiva.id, 'o1');
  assert.equal(t.pos.mesaActiva.id, 3);

  // datos atrasados: esta tablet cree la mesa libre y sin orden, la base no
  const u = montar({
    rol: 'mesero', mesas: [mesaBase(3, { estado: 'ocupada' })], ordenes: [ordenBase('o1', 3, [item('p1', 5000)])],
    alertas: [alertaBase('a1', 3, 'o1')],
  });
  await u.pos.arrancarApp();
  u.pos.mesas[0].estado = 'libre'; u.pos.ordenes = []; u.pos.volverAMesas();
  assert.equal(await u.pos.irAMesaDeAlerta('a1'), true, 'releyó y encontró la cuenta');
  assert.equal(u.pos.ordenActiva.id, 'o1', 'la cuenta real, no una nueva');
  assert.equal(lista(u.base.ordenes).length, 1, 'no se abrió ninguna orden nueva en la base');

  // la mesa de verdad ya no tiene cuenta
  const v = montar({ rol: 'mesero', mesas: [mesaBase(3, { estado: 'libre' })], ordenes: [], alertas: [] });
  await v.pos.arrancarApp();
  v.pos.alertas = [{ id: 'fantasma', mesaId: 3, ordenId: 'o9', metodo: 'qr', creadaEn: '2026-09-30T18:30:00Z' }];
  assert.equal(await v.pos.irAMesaDeAlerta('fantasma'), false);
  assert.match(v.avisos.at(-1), /ya no tiene una cuenta abierta/);
  assert.equal(lista(v.base.ordenes).length, 0, 'tampoco se abrió una cuenta');
});

// ═════════════════════════ 5. Personal ═════════════════════════

const PERSONAL = [
  { email: 'ana@ejemplo.test', nombre: 'Ana', rol: 'admin', activo: true },
  { email: 'beto@ejemplo.test', nombre: 'Beto', rol: 'mesero', activo: true },
  { email: 'cata@ejemplo.test', nombre: 'Cata', rol: 'mesero', activo: false },
];

test('personal: cargarPersonal lee la lista (activos primero) solo para el admin; el mesero no la pide', async () => {
  const t = montar({ rol: 'admin', personal: PERSONAL });
  await t.pos.cargarRol();
  assert.equal(await t.pos.cargarPersonal(), true);
  assert.deepEqual(plano(t.pos.personal).map((p) => p.email), ['ana@ejemplo.test', 'beto@ejemplo.test', 'cata@ejemplo.test']);
  assert.equal(t.pos.personal[2].activo, false);

  const m = montar({ rol: 'mesero', personal: PERSONAL });
  await m.pos.cargarRol();
  assert.equal(await m.pos.cargarPersonal(), false);
  assert.equal(m.supabase.de('personal').length, 0, 'ni siquiera pregunta');
  assert.equal(m.pos.personal.length, 0);
});

test('personal: alta normaliza el correo (espacios y mayúsculas), manda las RPC con sus parámetros y suma a la lista', async () => {
  const t = montar({ rol: 'admin', personal: PERSONAL });
  await t.pos.cargarRol();
  await t.pos.cargarPersonal();

  assert.equal(await t.pos.altaPersonal('  Dani@Ejemplo.TEST ', ' Dani ', 'mesero'), true);

  const llamada = t.supabase.rpcs('personal_alta')[0];
  assert.deepEqual(plano(llamada.args), { p_email: 'dani@ejemplo.test', p_nombre: 'Dani', p_rol: 'mesero' });
  assert.equal(t.pos.personalError, '');
  assert.ok(t.pos.personal.some((p) => p.email === 'dani@ejemplo.test' && p.activo));
  assert.equal(t.pos.personal.length, 4);
});

test('personal: los errores de la base salen en personalError con palabras claras (ya_existe, ultimo_admin, no_autorizado, red, RPC sin crear)', async () => {
  const t = montar({ rol: 'admin', personal: PERSONAL });
  await t.pos.cargarRol();
  await t.pos.cargarPersonal();

  assert.equal(await t.pos.altaPersonal('beto@ejemplo.test', 'Beto', 'mesero'), false);
  assert.match(t.pos.personalError, /ya está activo/);

  assert.equal(await t.pos.bajaPersonal('ana@ejemplo.test'), false);     // la última admin
  assert.equal(t.pos.personalError, 'Debe quedar al menos un admin activo.');
  assert.equal(await t.pos.cambiarRolPersonal('ana@ejemplo.test', 'mesero'), false);
  assert.equal(t.pos.personalError, 'Debe quedar al menos un admin activo.');
  assert.equal(t.base.personal.get('ana@ejemplo.test').rol, 'admin', 'la base la dejó como estaba');
  assert.equal(t.pos.esUltimoAdmin(t.pos.personal.find((p) => p.email === 'ana@ejemplo.test')), true, 'la pantalla puede deshabilitar el botón');

  assert.equal(await t.pos.altaPersonal('no-es-un-correo', '', 'mesero'), false);
  assert.match(t.pos.personalError, /correo válido/);
  assert.equal(t.supabase.rpcs('personal_alta').length, 1, 'un correo inválido ni sale a la red');
  assert.equal(await t.pos.altaPersonal('x@ejemplo.test', '', 'jefe'), false);
  assert.match(t.pos.personalError, /admin o mesero/);

  t.base.red = false;
  assert.equal(await t.pos.altaPersonal('z@ejemplo.test', 'Z', 'mesero'), false);
  assert.match(t.pos.personalError, /Sin conexión/);
  t.base.red = true;

  t.base.sinFuncion.add('personal_alta');
  assert.equal(await t.pos.altaPersonal('z@ejemplo.test', 'Z', 'mesero'), false);
  assert.match(t.pos.personalError, /Falta aplicar la migración/);
  t.base.sinFuncion.clear();

  assert.equal(await t.pos.altaPersonal('z@ejemplo.test', 'Z', 'mesero'), true);
  assert.equal(t.pos.personalError, '', 'un éxito limpia el error');
});

test('personal: baja y cambio de rol NO usan confirm() (la vista Personal confirma en la página: «Sí, dar de baja» y «Sí, cambiar»)', async () => {
  const t = montar({ rol: 'admin', personal: [...PERSONAL, { email: 'dora@ejemplo.test', nombre: 'Dora', rol: 'admin', activo: true }] });
  await t.pos.cargarRol();
  await t.pos.cargarPersonal();

  assert.equal(await t.pos.cambiarRolPersonal('beto@ejemplo.test', 'admin'), true);
  assert.equal(await t.pos.bajaPersonal('beto@ejemplo.test'), true);
  assert.deepEqual(t.confirmaciones, [], 'sin confirm(): sería la segunda pregunta');

});

test('personal: confirmadas, la baja desactiva, el cambio de rol cambia y reactivar vuelve a activar', async () => {
  const t = montar({ rol: 'admin', personal: [...PERSONAL, { email: 'dora@ejemplo.test', nombre: 'Dora', rol: 'admin', activo: true }] });
  await t.pos.cargarRol();
  await t.pos.cargarPersonal();

  assert.equal(await t.pos.bajaPersonal('beto@ejemplo.test'), true);
  assert.equal(t.pos.personal.find((p) => p.email === 'beto@ejemplo.test').activo, false);
  assert.deepEqual(plano(t.pos.personal).map((p) => p.activo), [true, true, false, false], 'los activos primero');

  assert.equal(await t.pos.reactivarPersonal(t.pos.personal.find((p) => p.email === 'beto@ejemplo.test')), true);
  assert.equal(t.pos.personal.find((p) => p.email === 'beto@ejemplo.test').activo, true);

  assert.equal(await t.pos.cambiarRolPersonal('beto@ejemplo.test', 'admin'), true);
  assert.equal(t.base.personal.get('beto@ejemplo.test').rol, 'admin');
  assert.deepEqual(plano(t.supabase.rpcs('personal_cambiar_rol')[0].args), { p_email: 'beto@ejemplo.test', p_rol: 'admin' });
});

test('personal: un mesero no gestiona personal ni llamando al store; si el admin se baja o se cambia el rol a sí mismo, su rol se revalida', async () => {
  const m = montar({ rol: 'mesero', personal: PERSONAL });
  await m.pos.cargarRol();
  assert.equal(await m.pos.altaPersonal('x@ejemplo.test', 'X', 'admin'), false);
  assert.match(m.pos.personalError, /Solo un admin/);
  assert.equal(m.supabase.rpcs('personal_alta').length, 0);

  let base;
  const a = montar({
    rol: 'admin', usuario: { ...YO, email: 'Ana@Ejemplo.test' }, personal: [...PERSONAL, { email: 'dora@ejemplo.test', nombre: 'Dora', rol: 'admin', activo: true }],
    despues: (c) => { if (c.tipo === 'rpc' && c.nombre === 'personal_cambiar_rol') base.rol = 'mesero'; },   // la base ya la dejó de mesero
  });
  base = a.base;
  await a.pos.arrancarApp();
  await a.pos.cargarPersonal();
  const preguntas = a.supabase.rpcs('mi_rol').length;
  assert.equal(await a.pos.cambiarRolPersonal('ana@ejemplo.test', 'mesero'), true);
  await hastaQue(() => a.pos.rol === 'mesero');
  assert.equal(a.pos.rol, 'mesero');
  assert.ok(a.supabase.rpcs('mi_rol').length > preguntas, 'volvió a preguntar quién es');
});

// ═════════════════════════ 6. Cobro por UNIDADES ═════════════════════════

const palomas = () => [{ id: 'be6', nombre: 'Paloma', precio: 30000, qty: 4, nota: '' }, item('en1', 12000, 1)];

test('unidades: marcar toma la línea COMPLETA; ajustar sube y baja entre 1 y qty; el subtotal cuenta solo las unidades elegidas', () => {
  const t = montar();
  const orden = conOrdenAbierta(t, palomas());
  const [paloma, entrada] = orden.items;

  assert.equal(t.pos.estaSeleccionado(paloma), false);
  assert.equal(t.pos.cantidadSeleccionada(paloma), 0);
  t.pos.ajustarCantidadSeleccion(paloma, +1);
  assert.equal(t.pos.estaSeleccionado(paloma), false, 'ajustar una línea sin marcar no la marca');

  t.pos.toggleSeleccion(paloma);
  assert.equal(t.pos.estaSeleccionado(paloma), true);
  assert.equal(t.pos.cantidadSeleccionada(paloma), 4, 'marcar = todas las unidades (como antes: marcar cobraba las 4)');
  assert.equal(t.pos.subtotalSeleccion, 120000);

  t.pos.ajustarCantidadSeleccion(paloma, -3);
  assert.equal(t.pos.cantidadSeleccionada(paloma), 1);
  assert.equal(t.pos.subtotalSeleccion, 30000, '«qué pasa si quiero pagar solo una paloma»');
  t.pos.ajustarCantidadSeleccion(paloma, -1);
  assert.equal(t.pos.cantidadSeleccionada(paloma), 1, 'no baja de 1: para no cobrar, se desmarca');
  t.pos.ajustarCantidadSeleccion(paloma, +99);
  assert.equal(t.pos.cantidadSeleccionada(paloma), 4, 'ni sube de las que hay');
  assert.equal(plano(t.pos.itemsSeleccionados).be6, 4, 'y lo guardado tampoco se pasa (no solo lo que se lee)');

  t.pos.ajustarCantidadSeleccion(paloma, -2);
  t.pos.toggleSeleccion(entrada);
  assert.equal(t.pos.subtotalSeleccion, 2 * 30000 + 12000);
  assert.equal(t.pos.lineasSeleccionadas, 2);
  assert.equal(t.pos.unidadesSeleccionadas, 3);

  t.pos.toggleSeleccion(paloma);
  assert.equal(t.pos.estaSeleccionado(paloma), false, 'tocar otra vez desmarca');
  t.pos.toggleSeleccion(paloma);
  assert.equal(t.pos.cantidadSeleccionada(paloma), 4, 'y al volver a marcar vuelve completa');

  paloma.qty = 2;                                                         // otra tablet quitó dos
  assert.equal(t.pos.cantidadSeleccionada(paloma), 2, 'nunca más de las que tiene hoy');

  t.pos.toggleModoCobroParcial();
  assert.deepEqual(plano(t.pos.itemsSeleccionados), {}, 'entrar o salir del modo limpia la selección');
});

test('unidades: cobrar n de una línea de qty → orden cerrada con qty n, esa resta en la abierta (la base la hace en UNA llamada) y la cuenta CUADRA (cobrado + resto = total)', async () => {
  const t = montar();
  conOrdenAbierta(t, palomas());
  const total = 4 * 30000 + 12000;
  const paloma = t.pos.ordenActiva.items[0];

  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(paloma);
  t.pos.ajustarCantidadSeleccion(paloma, -3);                             // 1 de 4
  await t.pos.facturarParcial();
  await asentar();

  const [cerrada] = cerradas(t.base);
  assert.deepEqual(plano(cerrada.items), [{ id: 'be6', nombre: 'Paloma', precio: 30000, qty: 1, nota: '' }], 'la cerrada lleva UNA paloma');
  assert.equal(cerrada.total, 30000);
  assert.equal(cerrada.mesa_id, 3);
  assert.deepEqual(plano(t.supabase.rpcs('cobrar_parcial').map((c) => c.args.p_lineas)), [[{ id: 'be6', qty: 1 }]], 'la base recibe UNA línea con 1 unidad, no 4');
  assert.equal(t.base.rpcs.length, 0, 'ningún delta −qty: lo que sale de la cuenta lo hace la base');
  assert.equal(abiertaDe(t.base, 3).items.find((i) => i.id === 'be6').qty, 3, 'en la base quedan 3');
  assert.equal(t.pos.ordenActiva.items.find((i) => i.id === 'be6').qty, 3, 'y en pantalla también');
  assert.equal(cerrada.total + abiertaDe(t.base, 3).total, total, 'cobrado + lo que falta = el total de la mesa');
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ticketMostrado.items[0].qty, 1);
  assert.equal(t.pos.seleccionCobro, false);
  assert.deepEqual(plano(t.pos.itemsSeleccionados), {});

  // ahora las 3 restantes (marcar toma la línea completa) → la línea desaparece y el total sigue cuadrando
  t.pos.vista = 'orden'; t.pos.ticketMostrado = null;
  t.pos.toggleSeleccion(t.pos.ordenActiva.items[0]);
  assert.equal(t.pos.cantidadSeleccionada(t.pos.ordenActiva.items[0]), 3);
  await t.pos.facturarParcial();
  await asentar();
  assert.deepEqual(abiertaDe(t.base, 3).items.map((i) => i.id), ['en1'], 'la línea cobrada completa se fue');
  assert.equal(cerradas(t.base).reduce((s, o) => s + o.total, 0) + abiertaDe(t.base, 3).total, total);
});

test('unidades: cobrar con las unidades por defecto (línea completa) se comporta como antes; y la lista de ids de siempre sigue sirviendo (cobrarGrupoPersona)', async () => {
  const t = montar();
  conOrdenAbierta(t, [item('p1', 5000), item('p2', 7000, 3)]);
  await t.pos.facturarParcial(['p2']);                                          // la firma de antes: lista de ids
  await asentar();
  assert.deepEqual(plano(cerradas(t.base)[0].items.map((i) => [i.id, i.qty])), [['p2', 3]], 'una lista de ids cobra cada línea COMPLETA');
  assert.equal(cerradas(t.base)[0].total, 21000);
  assert.deepEqual(plano(t.supabase.rpcs('cobrar_parcial').map((c) => c.args.p_lineas)), [[{ id: 'p2', qty: 3 }]]);

  const u = montar();
  conOrdenAbierta(u, [{ ...item('p1', 5000, 2), nota: 'Persona 1' }, { ...item('p2', 7000, 1), nota: 'Persona 2' }]);
  await u.pos.cobrarGrupoPersona('Persona 1');
  await asentar();
  assert.deepEqual(plano(cerradas(u.base)[0].items.map((i) => [i.id, i.qty])), [['p1', 2]], 'cobrarGrupoPersona sigue con líneas completas');
});

test('unidades: un id que no existe, una cantidad 0 o una selección vacía no cobran nada; el abono recibido no se puede marcar ni cobrar', async () => {
  const t = montar();
  const orden = conOrdenAbierta(t, [item('p1', 5000, 2), { id: 'abono_recibido_x1', nombre: 'Abono recibido', precio: -3000, qty: 1, nota: 'efectivo' }]);
  await t.pos.facturarParcial({});
  await t.pos.facturarParcial({ nada: 2 });
  await t.pos.facturarParcial({ p1: 0 });
  await t.pos.facturarParcial(['abono_recibido_x1']);
  t.pos.toggleSeleccion(orden.items[1]);
  assert.equal(t.pos.estaSeleccionado(orden.items[1]), false, 'el descuento no se marca');
  await asentar();
  assert.equal(cerradas(t.base).length, 0);
  assert.equal(t.base.rpcs.length, 0);
  assert.equal(t.supabase.rpcs('cobrar_parcial').length, 0, 'ni siquiera se le pregunta a la base');
});

test('unidades: pedir más de las que hay cobra solo las que hay (no deja la línea en negativo)', async () => {
  const t = montar();
  conOrdenAbierta(t, [item('p1', 5000, 2)]);
  await t.pos.facturarParcial({ p1: 99 });
  await asentar();
  assert.equal(cerradas(t.base)[0].items[0].qty, 2);
  assert.deepEqual(plano(t.supabase.rpcs('cobrar_parcial')[0].args.p_lineas), [{ id: 'p1', qty: 2 }], 'se pide lo que hay, no 99');
});

test('unidades: marcar por id (toggleSeleccionItem, como lo hace el arnés de capturas) sigue funcionando', () => {
  const t = montar();
  conOrdenAbierta(t, [item('p1', 5000, 2)]);
  t.pos.toggleSeleccionItem('p1');
  assert.equal(t.pos.cantidadSeleccionada(t.pos.ordenActiva.items[0]), 2);
  t.pos.toggleSeleccionItem('no-existe');
  assert.equal(t.pos.lineasSeleccionadas, 1);
});

// ═════════════════════════ 7. Cobro por MONTO (abono) ═════════════════════════

const MESA_ABONO = () => [item('pf1', 20000, 1), item('be1', 10000, 2)];     // total 40.000

test('abono: el monto se valida: entero en pesos, 0 < monto < lo que falta; «15.000», «15,000» y «$ 15 000» valen; decimales, negativos y letras no', () => {
  const t = montar();
  conOrdenAbierta(t, MESA_ABONO());
  assert.equal(t.pos.totalPendiente, 40000);
  const valido = (texto) => { t.pos.montoAbono = texto; return t.pos.abonoValido; };

  for (const bueno of ['15000', '15.000', '15,000', '$ 15 000', ' 15000 ', '1', '39999', '39.999']) assert.equal(valido(bueno), true, `«${bueno}» es un abono válido`);
  for (const malo of ['', '0', '00', '-5000', '1500.50', '15000,50', '1e4', 'abc', '15.00', '15 0000', '40000', '40.000', '40001', '999999']) {
    assert.equal(valido(malo), false, `«${malo}» no es un abono válido`);
  }
  t.pos.montoAbono = '15.000';
  assert.equal(t.pos.montoAbonoNumero, 15000);
  assert.equal(t.pos.abonoQuedaria, 25000);
  t.pos.montoAbono = '40000';
  assert.equal(t.pos.montoEsTotal, true, 'igual al total no es abono: es el cobro normal');
  assert.equal(t.pos.abonoQuedaria, null);

  t.pos.montoAbono = '50000';
  assert.match(t.pos.abonoError, /Falta por pagar/);
  t.pos.montoAbono = '-5';
  assert.match(t.pos.abonoError, /solo números/);
  t.pos.montoAbono = '0';
  assert.match(t.pos.abonoError, /mayor que cero/);
  t.pos.montoAbono = '';
  assert.equal(t.pos.abonoError, '', 'sin escribir nada no se regaña');
  assert.equal(t.pos.metodoAbono, 'efectivo', 'por defecto, efectivo');
});

test('abono: cierra «Abono · Mesa N» con UN ítem abono_<uid> por el monto, y descuenta de la abierta con «Abono recibido» de precio negativo, todo en UNA llamada a la base (cobrar_abono)', async () => {
  const t = montar();
  conOrdenAbierta(t, MESA_ABONO());
  t.pos.montoAbono = '15.000';
  t.pos.metodoAbono = 'qr';

  assert.equal(await t.pos.cobrarMonto(), true);
  await asentar();

  const [abono] = cerradas(t.base);
  assert.equal(abono.mesa_id, 3);
  assert.equal(abono.items.length, 1);
  assert.match(abono.items[0].id, /^abono_[0-9a-z]+$/);
  assert.deepEqual(plano({ ...abono.items[0], id: '' }), { id: '', nombre: 'Abono', precio: 15000, qty: 1, nota: 'qr' });
  assert.equal(abono.total, 15000);
  assert.equal(t.pos.esOrdenAbono(abono), true);
  assert.equal(t.pos.tituloOrden(abono), 'Abono · Mesa 3');
  assert.equal(t.pos.tituloOrden({ mesaId: 3, items: [item('p1', 1)] }), 'Mesa 3');

  const llamada = t.supabase.rpcs('cobrar_abono').at(-1).args;
  assert.equal(llamada.p_orden_id, 'o1');
  assert.match(llamada.p_venta.uid, /^[0-9a-z]+$/, 'el uid que une las dos líneas: abono_<uid> y abono_recibido_<uid>');
  assert.equal(llamada.p_monto, 15000);
  assert.equal(llamada.p_metodo, 'qr');
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, 0, 'ningún delta +1 del crédito: lo pone la base junto con la venta');
  const credito = abiertaDe(t.base, 3).items.find((i) => i.id.startsWith('abono_recibido_'));
  assert.deepEqual(plano({ ...credito, id: '' }), { id: '', nombre: 'Abono recibido', precio: -15000, qty: 1, nota: 'qr' }, 'precio NEGATIVO');
  assert.equal(credito.id, 'abono_recibido_' + abono.items[0].id.slice('abono_'.length), 'el mismo uid');

  const abierta = abiertaDe(t.base, 3);
  assert.equal(abierta.items.length, 3);
  assert.equal(abierta.total, 25000, 'la base recalcula: 40.000 − 15.000');
  assert.equal(t.pos.totalPendiente, 25000, 'y la pantalla también');
  assert.equal(t.pos.abonosRecibidos, 15000);
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.ticketMostrado.id, abono.id);
  assert.deepEqual(plano(t.pos.ticketMostrado.abono), { monto: 15000, metodo: 'qr', quedan: 25000, mesaId: 3 }, 'el ticket dice cuánto QUEDA');
  assert.equal(t.pos.montoAbono, '', 'el campo se limpia (un doble toque no cobra dos veces)');
  assert.equal(t.pos.metodoAbono, 'efectivo');
  assert.equal(t.pos.mesaActiva.estado, 'ocupada', 'la mesa sigue abierta');
});

test('abono: la CUENTA CUADRA: abono + resto = total, con varios abonos y el cobro final; ventas del día = lo que valía la mesa', async () => {
  const t = montar();
  conOrdenAbierta(t, MESA_ABONO());
  const total = sumar(MESA_ABONO());

  t.pos.montoAbono = '15000'; t.pos.metodoAbono = 'efectivo';
  await t.pos.cobrarMonto();
  await asentar();
  t.pos.vista = 'orden'; t.pos.ticketMostrado = null;
  assert.equal(cerradas(t.base).reduce((s, o) => s + o.total, 0) + abiertaDe(t.base, 3).total, total, 'tras el primer abono');

  t.pos.montoAbono = '4000'; t.pos.metodoAbono = 'transferencia';
  await t.pos.cobrarMonto();
  t.pos.vista = 'orden'; t.pos.ticketMostrado = null;
  await asentar();
  assert.equal(abiertaDe(t.base, 3).items.filter((i) => i.id.startsWith('abono_recibido_')).length, 2, 'dos abonos = dos líneas distintas (ids únicos, no se funden)');
  assert.equal(cerradas(t.base).reduce((s, o) => s + o.total, 0) + abiertaDe(t.base, 3).total, total, 'tras el segundo');
  assert.equal(t.pos.totalPendiente, 21000);

  t.pos.facturar();                                                       // el cobro final: lo que falta
  await asentar();
  assert.equal(abiertaDe(t.base, 3), undefined, 'la orden se cerró');
  const final = cerradas(t.base).find((o) => o.items.length === 4);
  assert.equal(final.total, 21000, 'la última cuenta es lo que faltaba, neta de los abonos');
  assert.deepEqual(plano(final.items.filter((i) => i.precio < 0).map((i) => [i.nombre, i.precio, i.nota])).sort(), [['Abono recibido', -15000, 'efectivo'], ['Abono recibido', -4000, 'transferencia']]);
  assert.equal(cerradas(t.base).reduce((s, o) => s + o.total, 0), total, 'lo cobrado en total = la mesa');
  assert.equal(t.pos.totalHoy, total, 'el cierre del día cuadra solo');
  assert.equal(t.pos.ordenesHoy.length, 3);
});

test('abono: con el monto IGUAL al total pendiente usa el cobro normal (cierra la orden; no crea ningún «Abono»)', async () => {
  const t = montar();
  conOrdenAbierta(t, MESA_ABONO());
  t.pos.montoAbono = '40.000';
  assert.equal(await t.pos.cobrarMonto(), true);
  await asentar();
  assert.equal(cerradas(t.base).length, 1);
  assert.equal(cerradas(t.base)[0].items.length, 2, 'es la orden entera (sus 2 líneas), no un abono');
  assert.ok(!cerradas(t.base)[0].items.some((i) => i.id.startsWith('abono_')));
  assert.equal(cerradas(t.base)[0].total, 40000);
  assert.equal(t.pos.mesas[0].estado, 'libre');
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.montoAbono, '');
});

test('abono: un monto inválido (cero, de más, texto, negativo) o sin cuenta abierta no cobra nada y no toca la base', async () => {
  const t = montar();
  conOrdenAbierta(t, MESA_ABONO());
  for (const malo of ['', '0', '45000', 'abc', '-100', '1500.5']) {
    t.pos.montoAbono = malo;
    assert.equal(await t.pos.cobrarMonto(), false, `«${malo}» no cobra`);
  }
  await asentar();
  assert.equal(cerradas(t.base).length, 0);
  assert.equal(t.base.rpcs.length, 0);
  assert.equal(t.pos.ordenActiva.items.length, 2);
  assert.equal(t.pos.vista, 'mesas', 'y no cambia de pantalla');

  // editando una cuenta cerrada sin mesa no hay abono posible
  t.pos.montoAbono = '1000';
  t.pos.edicionSinMesa = true;
  assert.equal(await t.pos.cobrarMonto(), false);
  t.pos.edicionSinMesa = false;
  t.pos.cierreEditando = { id: 'c1', ordenes: [] };
  assert.equal(await t.pos.cobrarMonto(), false);
  t.pos.cierreEditando = null;

  const vacia = montar();
  vacia.pos.montoAbono = '1000';
  assert.equal(await vacia.pos.cobrarMonto(), false, 'sin orden activa');
});

test('abono: un método raro se cambia a efectivo; qr y transferencia se respetan y van en la nota de las dos líneas', async () => {
  for (const [pedido, esperado] of [['transferencia', 'transferencia'], ['qr', 'qr'], ['bitcoin', 'efectivo'], [undefined, 'efectivo']]) {
    const t = montar();
    conOrdenAbierta(t, MESA_ABONO());
    t.pos.montoAbono = '5000'; t.pos.metodoAbono = pedido;
    await t.pos.cobrarMonto();
    await asentar();
    assert.equal(cerradas(t.base)[0].items[0].nota, esperado);
    assert.equal(t.supabase.rpcs('cobrar_abono').at(-1).args.p_metodo, esperado);
    assert.equal(abiertaDe(t.base, 3).items.find((i) => i.id.startsWith('abono_recibido_')).nota, esperado);
  }
});

test('abono: «Liberar mesa vacía» NO se activa con una mesa que solo tiene abonos (ya se cobró plata en ella); con la mesa de verdad vacía, sí', async () => {
  const t = montar();
  conOrdenAbierta(t, [item('p1', 10000, 1)]);
  t.pos.montoAbono = '4000';
  await t.pos.cobrarMonto();
  await asentar();
  t.pos.vista = 'orden'; t.pos.ticketMostrado = null;
  t.pos.quitarProducto(t.pos.ordenActiva.items.find((i) => i.id === 'p1'));   // se devolvieron los platos: solo queda el abono
  await asentar();
  assert.equal(t.pos.ordenSoloAbonos, true);
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => i.id.startsWith('abono_recibido_'))), [true]);

  t.pos.liberarMesaVacia();
  await asentar();
  assert.equal(t.supabase.de('ordenes', 'delete').length, 0, 'no se borró la orden de la base');
  assert.ok(t.pos.ordenes.some((o) => o.id === 'o1'), 'ni de la lista local');
  assert.equal(t.pos.mesas[0].estado, 'ocupada', 'la mesa sigue ocupada');
  assert.ok(t.avisos.some((a) => /abonos recibidos/.test(a)), 'y se dice por qué');
  assert.deepEqual(t.confirmaciones, [], 'ni siquiera pregunta «¿liberar?»');
  assert.equal(t.pos.totalPendiente, -4000, 'queda a favor del cliente: se devuelve cerrando la cuenta');

  const vacia = montar();
  conOrdenAbierta(vacia, []);
  vacia.pos.liberarMesaVacia();
  await asentar();
  assert.equal(vacia.supabase.de('ordenes', 'delete').length, 1, 'una mesa realmente vacía sí se libera');
  assert.equal(vacia.pos.mesas[0].estado, 'libre');
});

test('abono: la línea «Abono recibido» no se quita ni se sube desde la cuenta (descuadraría la caja contra la orden «Abono»)', async () => {
  const t = montar();
  conOrdenAbierta(t, MESA_ABONO());
  t.pos.montoAbono = '5000';
  await t.pos.cobrarMonto();
  await asentar();
  const credito = t.pos.ordenActiva.items.find((i) => i.id.startsWith('abono_recibido_'));
  const antes = t.supabase.rpcs('aplicar_delta_orden').length;

  t.pos.quitarProducto(credito);
  t.pos.incrementarItem(credito);
  await asentar();

  assert.equal(credito.qty, 1);
  assert.equal(t.supabase.rpcs('aplicar_delta_orden').length, antes, 'ningún delta');
  assert.equal(t.avisos.length, 2);
  assert.equal(abiertaDe(t.base, 3).total, 35000);
});

test('abono: cobrar por partes con abonos ya recibidos no deja la cuenta en negativo (más que lo que falta se rechaza); hasta lo que falta, sí', async () => {
  const t = montar();
  conOrdenAbierta(t, [item('a', 20000, 1), item('b', 5000, 1)]);          // total 25.000
  t.pos.montoAbono = '15000';
  await t.pos.cobrarMonto();
  await asentar();
  t.pos.vista = 'orden'; t.pos.ticketMostrado = null;
  assert.equal(t.pos.totalPendiente, 10000);
  const cerradasAntes = cerradas(t.base).length;

  await t.pos.facturarParcial({ a: 1 });                                         // 20.000 > 10.000 que faltan
  await asentar();
  assert.equal(cerradas(t.base).length, cerradasAntes, 'se rechazó');
  assert.ok(t.avisos.some((a) => /solo falta por pagar/.test(a)));
  assert.equal(abiertaDe(t.base, 3).items.some((i) => i.id === 'a'), true);

  await t.pos.facturarParcial({ b: 1 });                                         // 5.000 ≤ 10.000
  await asentar();
  assert.equal(cerradas(t.base).length, cerradasAntes + 1);
  assert.equal(t.pos.totalPendiente, 5000);
});

test('abono: reabrir la cuenta FINAL (con su línea negativa) no se rompe: el total es el neto, editar suma bien, guardar deja el total bien calculado', async () => {
  const t = montar();
  const final = ordenLocal('fin', 3, [item('pf1', 20000), { id: 'abono_recibido_z9', nombre: 'Abono recibido', precio: -15000, qty: 1, nota: 'efectivo' }], 2, 'cerrada');
  final.cerradaEn = new Date().toISOString();
  t.pos.mesas = [mesaBase(3, { estado: 'libre' })];
  t.pos.ordenes = [final];
  t.pos.remoto = 'ok';

  t.pos.solicitarReapertura(final);                                       // la mesa está libre: reabre ahí mismo
  await asentar();
  assert.equal(final.estado, 'abierta');
  assert.equal(t.pos.ordenActiva.id, 'fin');
  assert.equal(t.pos.totalOrdenActiva, 5000, 'neto: 20.000 − 15.000');
  assert.equal(Number.isNaN(t.pos.totalOrdenActiva), false);

  t.pos.incrementarItem(t.pos.ordenActiva.items[0]);
  assert.equal(t.pos.totalOrdenActiva, 25000);
  t.pos.quitarProducto(t.pos.ordenActiva.items[0]);
  assert.equal(t.pos.totalOrdenActiva, 5000);

  t.pos.facturar();                                                       // se vuelve a cerrar con su línea negativa
  await asentar();
  assert.equal(t.base.ordenes.get('fin').total, 5000);
  assert.equal(t.base.ordenes.get('fin').estado, 'cerrada');

  // y editarla SIN mesa (admin, desde el historial) tampoco se rompe con la línea negativa
  const u = montar();
  const vieja = ordenLocal('v1', 3, [item('pf1', 20000, 2), { id: 'abono_recibido_z9', nombre: 'Abono recibido', precio: -15000, qty: 1, nota: 'qr' }], 2, 'cerrada');
  u.pos.editarSinMesa(vieja);
  u.pos.quitarProducto(u.pos.ordenActiva.items[0]);
  assert.equal(u.pos.totalOrdenActiva, 5000);
  u.pos.guardarEdicion();
  assert.equal(vieja.total, 5000, 'guardarEdicion calcula el total con la línea negativa');
  assert.equal(Number.isNaN(vieja.total), false);
});

test('abono: sin red NO se hace ni se encola (necesita red): sin venta, sin crédito en la cuenta, sin cola; al volver la red el mismo abono entra una sola vez', async () => {
  const t = montar();
  conOrdenAbierta(t, MESA_ABONO());
  t.pos.remoto = 'offline';
  t.base.red = false;

  t.pos.montoAbono = '12000';
  assert.equal(await t.pos.cobrarMonto(), false);
  await asentar();
  assert.match(t.pos.aviso.texto, /Sin red: el cobro por partes y los abonos necesitan red; la mesa completa sí se puede cobrar/);
  assert.equal(t.pos.colaDeltas.length, 0, 'nada se encoló');
  assert.equal(t.pos.ordenes.filter((o) => o.estado === 'cerrada').length, 0, 'ni hay una venta local');
  assert.equal(t.pos.totalPendiente, 40000, 'la cuenta sigue entera');
  assert.equal(Object.keys(plano(t.pos._pendientes)).length, 0, 'ni nada marcado como sin subir');
  assert.equal(t.almacen.has('pos_delta_queue'), false, 'y la cola persistida sigue vacía');

  t.base.red = true;
  t.pos.remoto = 'ok';
  assert.equal(await t.pos.cobrarMonto(), true, 'con red, el mismo abono entra');
  await asentar();
  assert.equal(cerradas(t.base).length, 1);
  assert.equal(cerradas(t.base)[0].items[0].precio, 12000);
  assert.equal(abiertaDe(t.base, 3).total, 28000, 'la base quedó igual que la pantalla');
  assert.equal(abiertaDe(t.base, 3).items.filter((i) => i.id.startsWith('abono_recibido_')).length, 1, 'el crédito se puso una sola vez');
});

test('abono: el POS ya no sube el abono con un upsert (ni los campos locales del ticket: `abono`, `dividirOculto`): le pide a la base el abono con cobrar_abono y esos campos quedan solo en la copia de la tablet', async () => {
  const t = montar();
  conOrdenAbierta(t, MESA_ABONO());
  t.pos.montoAbono = '5000';
  await t.pos.cobrarMonto();
  await asentar();
  assert.equal(t.supabase.de('ordenes', 'upsert').filter((c) => c.cuerpo.estado === 'cerrada').length, 0, 'ningún upsert de la venta');
  const llamada = t.supabase.rpcs('cobrar_abono').at(-1).args;
  assert.deepEqual(Object.keys(llamada).sort(), ['p_delta_id', 'p_metodo', 'p_monto', 'p_orden_id', 'p_venta', 'p_version']);
  assert.deepEqual(Object.keys(llamada.p_venta).sort(), ['id', 'uid']);
  const [venta] = cerradas(t.base);
  assert.equal('abono' in venta || 'dividirOculto' in venta, false, 'la fila de la base no lleva lo local');
  assert.ok(t.pos.ticketMostrado.abono && t.pos.ticketMostrado.dividirOculto, 'la copia local de la tablet sí');
});

test('abono: eliminar un abono de un cierre avisa que la cuenta final conserva su descuento; una transacción común no lleva el aviso', async () => {
  const t = montar();
  await t.pos.cargarRol();
  const abono = ordenLocal('ab1', 3, [{ id: 'abono_k1', nombre: 'Abono', precio: 15000, qty: 1, nota: 'qr' }], 1, 'cerrada');
  const comun = ordenLocal('c1', 3, [item('p1', 5000)], 1, 'cerrada');
  const cierre = { id: 'cz', ordenes: [abono, comun], total: 20000, sync: 'ok' };
  t.pos.cierres = [cierre];

  t.pos.eliminarOrdenDeCierre(cierre, abono);
  t.pos.eliminarOrdenDeCierre(cierre, comun);

  assert.match(t.confirmaciones[0], /ABONO/);
  assert.doesNotMatch(t.confirmaciones[1], /ABONO/);
});

test('sin acceso: sincronizarSupabase no lee nada ni repuebla la caché que se acaba de borrar', async () => {
  const t = montar({ rol: null, ordenes: [ordenBase('o1', 3, [item('p1', 5000)])] });
  await t.pos.arrancarApp();
  await t.pos.sincronizarSupabase();
  await t.pos._resincronizarEnVivo();
  assert.equal(t.supabase.llamadas.filter((c) => c.tipo === 'from').length, 0);
  assert.equal(t.pos.mesas.length, 0);
  assert.ok(!t.almacen.has('pos_mesas'));
});
