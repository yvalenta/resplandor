// Ola C, parte C2 (la lógica del POS): el <script> REAL de pos.html en un `vm` (scripts/pruebas/_pos-vm.mjs) contra la base falsa, que
// con `olaC: true` modela las migraciones nuevas (aprobación del personal, mesas y pegatinas, ajustes del ticket, deshacer cobros).
//
//   A  Espera de aprobación: solicitar_acceso ANTES de mi_rol; quien espera no sincroniza, no abre Realtime de datos y no guarda caché;
//      reintenta cada 30 s y al volver a la pestaña; al aprobarla arranca sin recargar; «eliminado» no se resucita.
//   B  Personal (admin): solicitudes pendientes en vivo, aprobar y eliminar.
//   C  Mesas y pegatinas (admin): lista, crear, editar, desactivar, copiar enlace y Web NFC (con un NDEFReader falso, sin makeReadOnly).
//   D  Deshacer un cobro parcial o un abono: aviso de 15 s, mesero vs admin, cuadre exacto del total, doble toque, ecos de Realtime.
//   E  Ticket configurable: ajustes, validación, QR generado en el navegador (la librería REAL, el archivo local de assets/vendor/) que se lee igual que el estático.
//   F  «+1 Paloma» y vibración.
//   G  El contrato de nombres y la compatibilidad con la base de antes de la ola C (TRANSITORIO).
//
// Estas pruebas deben FALLAR contra el pos.html de antes de la ola (mutante a mano): POS_HTML=<archivo> node --test scripts/pruebas/pos-ola-c.test.mjs
// La librería del QR es el archivo local assets/vendor/qrcode-generator-1.4.4.js (antes salía de cdnjs con SRI y las pruebas dependían de un caché de la
// máquina): ya no se salta nada. Con VERIFICAR_SRI=1 y red, E5 comprueba ese archivo contra el registro de npm y contra lo que publica cdnjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import {
  RAIZ, TOKEN, asentar, crearBaseFalsa, crearPos, dormir, hastaQue, item, mesaBase, ordenBase, plano, scriptDelStore,
} from './_pos-vm.mjs';
import { decodificarQr, matrizDeSvg } from './_qr-decodificar.mjs';
import { SVG_ESTATICO_POS_PIE } from './_qr-estatico-pos-pie.mjs';

const POS_HTML = fs.readFileSync(process.env.POS_HTML ? path.resolve(process.env.POS_HTML) : path.join(RAIZ, 'pos.html'), 'utf8');
const STORE = scriptDelStore();

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const URL_QR = 'https://resplandor.ynt.codes/';
const ENLACE_3 = `https://resplandor.ynt.codes/carta.html?m=3&k=${TOKEN}`;

// ───────────────────────── montaje ─────────────────────────

/** Un reloj que se mueve a mano: `r.Date` reemplaza al Date del POS. */
function relojFalso(inicio = Date.parse('2026-09-30T18:00:00Z')) {
  const r = { ahora: inicio };
  r.Date = class extends Date {
    constructor(...a) { if (a.length === 0) super(r.ahora); else super(...a); }
    static now() { return r.ahora; }
  };
  return r;
}

/**
 * Un POS con sesión sobre la base falsa de la ola C. Los temporizadores de 1,5 s o más (el aviso de 15 s, «+1», el cierre de avisos) y los
 * setInterval NO corren solos: quedan en `temporizadores` / `intervalos` y la prueba los dispara con `disparar(ms)` o `intervalos[i].fn()`.
 * Lo que sale de la base se copia: la tablet y la base no comparten referencias.
 */
function montar({ rol = 'admin', acceso, olaC = true, mesas = [mesaBase(3)], ordenes = [], personal = [], productos = [], cierres = [], ajustes, almacen, extras = {}, documento = {}, reloj, latenciaMs = 0 } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, personal, productos, cierres, olaC, acceso, ajustes, latenciaMs });
  const original = base.responder;
  base.responder = async (c) => {
    const r = await original(c);
    return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r;
  };
  const intervalos = [];
  const temporizadores = [];
  const reales = { setTimeout, clearTimeout };
  const t = crearPos({
    base, almacen,
    extras: {
      setInterval(fn, ms) { intervalos.push({ fn, ms, limpio: false }); return intervalos.length; },
      clearInterval(id) { if (intervalos[id - 1]) intervalos[id - 1].limpio = true; },
      setTimeout(fn, ms, ...resto) {
        if (ms >= 1500) { const h = { fn, ms, cancelado: false, unref() { return h; } }; temporizadores.push(h); return h; }
        return reales.setTimeout(fn, ms, ...resto);
      },
      clearTimeout(h) { if (h && typeof h === 'object' && 'cancelado' in h) h.cancelado = true; else reales.clearTimeout(h); },
      ...(reloj ? { Date: reloj.Date } : {}),
      ...extras,
    },
    documento: { title: 'POS', visibilityState: 'visible', ...documento },
  });
  t.base = base; t.intervalos = intervalos; t.temporizadores = temporizadores; t.reloj = reloj;
  t.pos.usuario = YO;
  /** Dispara los temporizadores pendientes de `ms` milisegundos. Devuelve cuántos. */
  t.disparar = (ms) => {
    const hechos = t.temporizadores.filter((h) => h.ms === ms && !h.cancelado);
    for (const h of hechos) { h.cancelado = true; h.fn(); }
    return hechos.length;
  };
  return t;
}

/** Arranca y espera lo que el arranque deja en vuelo sin esperarlo (la lista del personal del admin, los ajustes). */
async function listo(t) {
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  if (t.pos.esAdmin) await hastaQue(() => t.pos._personalCargado);
  await asentar();
  return t;
}

const lista = (mapa) => [...mapa.values()];
const mesaDe = (t, id) => t.pos.mesas.find((m) => m.id === id);
const nombres = (llamadas) => llamadas.map((c) => c.nombre);
const tablasLeidas = (t) => t.supabase.llamadas.filter((c) => c.tipo === 'from').map((c) => `${c.op}:${c.tabla}`);
const sinRastro = (almacen) => [...almacen.keys()].filter((k) => k !== 'pos_device_id');

const pendiente = (email, nombre, cuando) => ({ email, nombre, rol: 'mesero', activo: true, estado: 'pendiente', solicitado_en: cuando });
const aprobada = (email, nombre, rol = 'mesero') => ({ email, nombre, rol, activo: true, estado: 'aprobado', creado_en: '2026-09-01T00:00:00Z' });
const producto = (id, categoria, nombre, precio) => ({ id, categoria, nombre, precio, descripcion: `${nombre} de la casa`, activo: true });

// ═════════════════════════ A. Espera de aprobación ═════════════════════════

test('A1 espera: una cuenta que no está en `personal` queda PENDIENTE: pide acceso, no pregunta mi_rol, no lee ni una tabla de datos, no abre canales y no deja nada en la tablet', async () => {
  const almacen = new Map([
    ['pos_mesas', JSON.stringify([mesaBase(9)])], ['pos_ordenes', JSON.stringify([{ id: 'viejo', mesaId: 9, estado: 'abierta', items: [item('x', 5000)] }])],
    ['pos_productos', '[]'], ['pos_cierres', '[{"id":"c1"}]'], ['pos_rol', JSON.stringify({ uid: 'u1', rol: 'admin' })],
    ['pos_delta_queue', '[{"orden_id":"viejo"}]'], ['pos_pendientes', '{"ordenes:viejo":true}'], ['pos_ajustes', '{"ticketPie":"de otro"}'],
  ]);
  const t = montar({
    rol: null, acceso: 'ninguno', almacen,
    mesas: [mesaBase(3), mesaBase(5, { estado: 'libre', capacidad: 2 })],
    ordenes: [ordenBase('o1', 3, [item('p1', 12000)])],
    productos: [producto('p1', 'Platos', 'Bandeja', 12000), { ...producto('p2', 'Platos', 'Oculto', 9000), activo: false }],
  });
  await t.pos.arrancarApp();

  assert.equal(t.pos.estadoAcceso, 'pendiente');
  assert.equal(t.pos.esperaAprobacion, true);
  assert.equal(t.pos.rol, null);
  assert.equal(t.pos.rolCargado, true);
  assert.equal(t.pos.sinAcceso, false, 'no es «sin acceso»: es «espera aprobación» (otra pantalla)');
  assert.equal(t.pos.pantallaSinAcceso, false);
  assert.equal(t.base.personal.get(YO.email).estado, 'pendiente', 'solicitar_acceso dejó la solicitud en la base');
  assert.equal(t.base.personal.get(YO.email).rol, 'mesero', 'rol provisional');
  assert.deepEqual(nombres(t.supabase.rpcs()), ['solicitar_acceso', 'vista_pendiente'], 'ni mi_rol ni nada más');
  assert.deepEqual(tablasLeidas(t), ['select:carta_publica'], 'lo único que lee de las tablas es la carta pública');
  assert.equal(t.supabase.canales.length, 0, 'ningún canal de Realtime (ni sync, ni presencia, ni alertas, ni personal)');
  assert.deepEqual(sinRastro(almacen), [], 'la caché de la sesión anterior se borró y no se guardó nada nuevo');
  assert.deepEqual(plano(t.pos.mesas), []);
  assert.deepEqual(plano(t.pos.ordenes), []);

  assert.deepEqual(plano(t.pos.mesasPendiente), [{ id: 3, capacidad: 4, estado: 'ocupada' }, { id: 5, capacidad: 2, estado: 'libre' }]);
  assert.deepEqual(Object.keys(t.pos.mesasPendiente[0]).sort(), ['capacidad', 'estado', 'id'], 'solo número, capacidad y estado');
  assert.deepEqual(plano(t.pos.cartaPendiente.map((p) => p.nombre)), ['Bandeja']);
  assert.equal(t.pos.cartaPendiente[0].categoria, 'Platos');
  assert.equal(t.pos.cartaPendiente[0].precio, 12000);
  const visible = JSON.stringify([t.pos.mesasPendiente, t.pos.cartaPendiente]);
  assert.ok(!visible.includes(TOKEN) && !visible.includes('o1'), 'ni tokens ni cuentas en lo que ve quien espera');
});

test('A1b espera: aunque la base mandara de más (token, totales, cuentas) en vista_pendiente o en la carta, la tablet SOLO conserva las columnas permitidas', async () => {
  const t = montar({ rol: null, acceso: 'pendiente', mesas: [mesaBase(3)], productos: [producto('p1', 'Platos', 'Bandeja', 12000)] });
  const original = t.base.responder;
  t.base.responder = async (c) => {
    const r = await original(c);
    if (c.tipo === 'rpc' && c.nombre === 'vista_pendiente') return { ...r, data: r.data.map((m) => ({ ...m, token: TOKEN, total: 99000, orden: { id: 'o1' } })) };
    if (c.tipo === 'from' && c.tabla === 'carta_publica') return { ...r, data: r.data.map((p) => ({ ...p, id: 'interno', activo: true, costo: 7000 })) };
    return r;
  };
  await t.pos.arrancarApp();
  assert.deepEqual(Object.keys(t.pos.mesasPendiente[0]).sort(), ['capacidad', 'estado', 'id']);
  assert.deepEqual(Object.keys(t.pos.cartaPendiente[0]).sort(), ['cat', 'categoria', 'desc', 'descripcion', 'nombre', 'precio']);
  const visible = JSON.stringify([t.pos.mesasPendiente, t.pos.cartaPendiente]);
  assert.ok(!visible.includes(TOKEN) && !visible.includes('99000') && !visible.includes('interno') && !visible.includes('7000'));
});

test('A2 espera: ni sincronizar, ni resincronizar, ni leer alertas, ni guardar la caché hacen algo mientras se espera', async () => {
  const t = montar({ rol: null, acceso: 'pendiente', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 12000)])] });
  await t.pos.arrancarApp();
  const antes = t.supabase.llamadas.length;
  await t.pos.sincronizarSupabase();
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  await t.pos._resincronizarEnVivo();
  await t.pos._cargarAlertas();
  await t.pos.cargarAjustes();
  t.pos.mesas = [mesaBase(1)];
  t.pos.guardarCachéLocal();
  assert.equal(t.supabase.llamadas.length, antes, 'cero llamadas a la base');
  assert.deepEqual(sinRastro(t.almacen), [], 'y cero escrituras en la caché');
  assert.equal(t.supabase.canales.length, 0);
});

test('A3 espera: cada 30 s vuelve a preguntar y, al aprobarla, arranca la app normal SIN recargar (con sus canales y sus datos) y deja de preguntar', async () => {
  const t = montar({
    rol: null, acceso: 'pendiente', mesas: [mesaBase(3), mesaBase(5, { estado: 'libre' })],
    ordenes: [ordenBase('o1', 3, [item('p1', 12000)])], productos: [producto('p1', 'Platos', 'Bandeja', 12000)],
  });
  await t.pos.arrancarApp();
  const relojes = t.intervalos.filter((i) => i.ms === 30000);
  assert.equal(relojes.length, 1, 'un solo reloj de 30 s');
  assert.equal(t.base.solicitudes, 1);

  relojes[0].fn();
  await hastaQue(() => t.base.solicitudes === 2);
  await asentar();
  assert.equal(t.pos.esperaAprobacion, true, 'sigue pendiente');
  assert.equal(t.supabase.rpcs('vista_pendiente').length, 2, 'y refresca el mapa de mesas');
  assert.equal(t.supabase.canales.length, 0);

  const fila = t.base.personal.get(YO.email);
  fila.estado = 'aprobado'; fila.rol = 'mesero';          // un admin la aprobó
  relojes[0].fn();
  await hastaQue(() => t.pos._appArrancada && t.pos.mesas.length === 2 && t.pos.ordenes.length === 1);
  await asentar();

  assert.equal(t.pos.estadoAcceso, 'aprobado');
  assert.equal(t.pos.esperaAprobacion, false);
  assert.equal(t.pos.rol, 'mesero');
  assert.equal(t.pos.esMesero, true);
  assert.deepEqual(plano(t.pos.productos.map((p) => p.id)), ['p1']);
  assert.ok(t.supabase.canal('pos_sync') && t.supabase.canal('presencia_pos') && t.supabase.canal('pos_alertas'), 'ahora sí abre sus canales');
  assert.equal(t.supabase.canal('pos_personal'), undefined, 'el canal del personal es solo del admin');
  assert.equal(relojes[0].limpio, true, 'el reloj de espera se apagó');
  assert.deepEqual(plano(t.pos.mesasPendiente), [], 'ya no guarda lo que veía en espera');
  assert.deepEqual(plano(t.pos.cartaPendiente), []);
  assert.ok(t.almacen.has('pos_mesas'), 'y ahora sí guarda la caché');
});

test('A4 espera: una cuenta «eliminada» por un admin ve la misma pantalla de espera y NO se resucita sola', async () => {
  const t = montar({ rol: null, acceso: 'eliminado', mesas: [mesaBase(3)] });
  await t.pos.arrancarApp();
  assert.equal(t.pos.estadoAcceso, 'eliminado');
  assert.equal(t.pos.esperaAprobacion, true, 'eliminado también espera (y solo ve lo mismo)');
  assert.equal(t.pos.sinAcceso, false);
  assert.equal(t.base.personal.get(YO.email).activo, false, 'la fila sigue dada de baja');
  assert.equal(t.base.solicitudes, 1);
  assert.deepEqual(tablasLeidas(t), ['select:carta_publica']);
  assert.equal(t.supabase.canales.length, 0);
});

test('A5 espera: al volver a la pestaña o al volver la red vuelve a preguntar (como mucho cada 15 s); al aprobarla arranca', async () => {
  const t = montar({ rol: null, acceso: 'pendiente', mesas: [mesaBase(3)] });
  await t.pos.arrancarApp();
  assert.equal(typeof t.eventosDocumento.visibilitychange, 'function', 'la espera también oye el regreso a la pestaña');
  assert.equal(typeof t.eventosVentana.online, 'function', 'y la reconexión');

  t.eventosDocumento.visibilitychange();                   // acaba de preguntar: lo frena el límite de 15 s
  await asentar();
  assert.equal(t.base.solicitudes, 1, 'no pregunta dos veces seguidas');

  t.pos._rolRevisadoEn = 0;
  t.eventosDocumento.visibilitychange();
  await hastaQue(() => t.base.solicitudes === 2);
  assert.equal(t.pos.esperaAprobacion, true);

  const fila = t.base.personal.get(YO.email);
  fila.estado = 'aprobado';
  t.pos._rolRevisadoEn = 0;
  t.eventosVentana.online();
  await hastaQue(() => t.pos._appArrancada && t.pos.mesas.length === 1);
  assert.equal(t.pos.estadoAcceso, 'aprobado');
  assert.equal(t.pos.rol, 'mesero');
});

test('A6 espera: a quien ya trabajaba y un admin le quita el acceso, la tablet lo suelta TODO en la siguiente consulta (caché, cuentas, canales)', async () => {
  const t = montar({ rol: 'mesero', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [item('p1', 12000)])] });
  await listo(t);
  assert.equal(t.pos.mesas.length, 1);
  assert.ok(t.almacen.has('pos_ordenes') && t.almacen.has('pos_rol'));

  t.base.personal.get(YO.email).activo = false;            // un admin la eliminó
  await t.pos.revalidarRol(true);
  await asentar();

  assert.equal(t.pos.estadoAcceso, 'eliminado');
  assert.equal(t.pos.esperaAprobacion, true);
  assert.equal(t.pos.rol, null);
  assert.deepEqual(plano(t.pos.mesas), []);
  assert.deepEqual(plano(t.pos.ordenes), []);
  assert.deepEqual(sinRastro(t.almacen), [], 'la caché local se borró, también el rol guardado');
  assert.ok(t.supabase.canales.length > 0 && t.supabase.canales.every((c) => c.removido), 'todos los canales se cerraron');
  assert.equal(t.pos._appArrancada, false);
});

test('A7 espera: un fallo de red NO cambia la pantalla de quien ya esperaba (ni la pasa a «no pudimos comprobar»); sin red desde el principio, sí', async () => {
  const t = montar({ rol: null, acceso: 'pendiente', mesas: [mesaBase(3)] });
  await t.pos.arrancarApp();
  t.base.red = false;
  await t.pos.revalidarRol(true);
  assert.equal(t.pos.esperaAprobacion, true);
  assert.equal(t.pos.accesoSinComprobar, false);
  assert.equal(t.pos.sinAcceso, false);

  const sinRed = montar({ rol: 'mesero', mesas: [mesaBase(3)] });
  sinRed.base.red = false;
  await sinRed.pos.arrancarApp();
  assert.equal(sinRed.pos.estadoAcceso, null);
  assert.equal(sinRed.pos.esperaAprobacion, false, 'sin saber nada no se supone «pendiente»');
  assert.equal(sinRed.pos.accesoSinComprobar, true, 'como en la ola B: sin red y sin rol guardado, no se sabe');
});

test('A8 espera: con la sesión que no es de Google (o con el tope de solicitudes lleno) solicitar_acceso no deja entrar a nadie: se sigue con mi_rol y sale «sin acceso»', async () => {
  const sinGoogle = montar({ rol: null, acceso: 'ninguno', mesas: [mesaBase(3)] });
  sinGoogle.base.sinGoogle = true;
  await sinGoogle.pos.arrancarApp();
  assert.equal(sinGoogle.pos.estadoAcceso, null);
  assert.equal(sinGoogle.pos.sinAcceso, true);
  assert.deepEqual(nombres(sinGoogle.supabase.rpcs()), ['solicitar_acceso', 'mi_rol']);

  const filas = Array.from({ length: 50 }, (_, i) => pendiente(`p${i}@ejemplo.test`, `P${i}`, '2026-09-30T10:00:00Z'));
  const lleno = montar({ rol: null, acceso: 'ninguno', personal: filas, mesas: [mesaBase(3)] });
  await lleno.pos.arrancarApp();
  assert.equal(lleno.pos.esperaAprobacion, false, 'el tope no la deja crear la solicitud');
  assert.equal(lleno.pos.sinAcceso, true);
  assert.equal(lleno.base.personal.has(YO.email), false);
});

test('A9 TRANSITORIO: sin la migración de aprobación (la base de la ola B) el POS sigue como antes: mi_rol decide, nada de espera', async () => {
  const t = montar({ olaC: false, rol: 'admin', mesas: [mesaBase(3)] });
  await listo(t);
  assert.deepEqual(nombres(t.supabase.rpcs()).slice(0, 2), ['solicitar_acceso', 'mi_rol'], 'pregunta, no existe, y sigue con mi_rol');
  assert.equal(t.pos.estadoAcceso, null);
  assert.equal(t.pos.esperaAprobacion, false);
  assert.equal(t.pos.rol, 'admin');
  assert.equal(t.pos.mesas.length, 1);
  assert.deepEqual(plano(t.pos.ajustes), { ticketQrUrl: URL_QR, ticketQrVisible: true, ticketPie: 'Gracias por su visita' }, 'ajustes de fábrica');
  assert.equal(t.pos.ajustesError, '');
  assert.equal(t.supabase.canal('pos_personal') !== undefined, true, 'el admin sí oye al personal (la tabla existe aunque no tenga `estado`)');
});

// ═════════════════════════ B. Personal: solicitudes, aprobar, eliminar ═════════════════════════

const PERSONAL = () => [
  pendiente('ana@ejemplo.test', 'Ana', '2026-09-30T13:00:00Z'),
  pendiente('beto@ejemplo.test', 'Beto', '2026-09-30T12:00:00Z'),
  aprobada('cami@ejemplo.test', 'Camila', 'admin'),
];

test('B1 personal: el admin recibe las solicitudes pendientes (la más antigua primero) AL ENTRAR, sin abrir el panel, y oye al personal en vivo; el mesero ni lee ni oye', async () => {
  const admin = montar({ rol: 'admin', personal: PERSONAL() });
  await listo(admin);
  assert.deepEqual(plano(admin.pos.personalPendientes), [
    { email: 'beto@ejemplo.test', nombre: 'Beto', solicitadoEn: '2026-09-30T12:00:00Z' },
    { email: 'ana@ejemplo.test', nombre: 'Ana', solicitadoEn: '2026-09-30T13:00:00Z' },
  ]);
  assert.equal(admin.pos.numPendientes, 2);
  assert.deepEqual(plano(admin.pos.personal.map((p) => p.email)), ['cami@ejemplo.test', 'yo@ejemplo.test'], 'los aprobados, por nombre; las solicitudes no se mezclan con ellos');
  const canal = admin.supabase.canal('pos_personal');
  assert.ok(canal, 'abre el canal del personal');
  assert.deepEqual(plano(canal.eventos[0]), { tipo: 'postgres_changes', filtro: { event: '*', schema: 'public', table: 'personal' } });

  const mesero = montar({ rol: 'mesero', personal: PERSONAL() });
  await listo(mesero);
  assert.equal(mesero.pos.numPendientes, 0);
  assert.deepEqual(plano(mesero.pos.personalPendientes), []);
  assert.equal(mesero.supabase.canal('pos_personal'), undefined);
  assert.ok(!tablasLeidas(mesero).includes('select:personal'), 'el mesero no pide la lista del personal');
});

test('B2 personal: aprobarPersonal(email, rol) llama personal_aprobar, mueve a la persona de pendientes a aprobados con ese rol y baja el contador', async () => {
  const t = montar({ rol: 'admin', personal: PERSONAL() });
  await listo(t);

  assert.equal(await t.pos.aprobarPersonal(' ANA@ejemplo.test ', 'mesero'), true);
  assert.deepEqual(plano(t.supabase.rpcs('personal_aprobar').at(-1).args), { p_email: 'ana@ejemplo.test', p_rol: 'mesero' }, 'correo normalizado');
  assert.deepEqual(plano(t.pos.personalPendientes.map((p) => p.email)), ['beto@ejemplo.test']);
  assert.equal(t.pos.numPendientes, 1);
  const ana = t.pos.personal.find((p) => p.email === 'ana@ejemplo.test');
  assert.deepEqual([ana.nombre, ana.rol, ana.activo, ana.estado], ['Ana', 'mesero', true, 'aprobado']);
  assert.equal(t.base.personal.get('ana@ejemplo.test').estado, 'aprobado');

  assert.equal(await t.pos.aprobarPersonal('beto@ejemplo.test', 'admin'), true);
  assert.equal(t.pos.numPendientes, 0);
  assert.equal(t.pos.personal.find((p) => p.email === 'beto@ejemplo.test').rol, 'admin');
  assert.equal(t.base.personal.get('beto@ejemplo.test').rol, 'admin');
  assert.equal(t.pos.personalError, '');

  assert.equal(await t.pos.aprobarPersonal('ana@ejemplo.test', 'mesero'), false, 'ya está aprobada');
  assert.equal(t.pos.personalError, 'Esa persona ya está aprobada.');
  assert.equal(t.pos.personalErrorDe, 'ana@ejemplo.test', 'el error se muestra en la fila de esa persona');

  const llamadas = t.supabase.rpcs('personal_aprobar').length;
  assert.equal(await t.pos.aprobarPersonal('x@ejemplo.test', 'dueño'), false);
  assert.equal(t.pos.personalError, 'El rol debe ser admin o mesero.');
  assert.equal(t.supabase.rpcs('personal_aprobar').length, llamadas, 'un rol inválido ni llega a la base');
});

test('B3 personal: un mesero NO aprueba ni elimina (ni llama a la base); sin la migración sale el aviso claro', async () => {
  const mesero = montar({ rol: 'mesero', personal: PERSONAL() });
  await listo(mesero);
  assert.equal(mesero.pos.puede('aprobar_personal'), false);
  assert.equal(await mesero.pos.aprobarPersonal('ana@ejemplo.test', 'mesero'), false);
  assert.equal(await mesero.pos.eliminarPersonal('ana@ejemplo.test'), false);
  assert.equal(mesero.pos.personalError, 'Solo un admin puede gestionar el personal.');
  assert.equal(mesero.supabase.rpcs('personal_aprobar').length + mesero.supabase.rpcs('personal_eliminar').length, 0);
  assert.equal(mesero.base.personal.get('ana@ejemplo.test').estado, 'pendiente', 'la base quedó igual');

  const vieja = montar({ olaC: { aprobacion: false }, rol: 'admin', personal: [aprobada('cami@ejemplo.test', 'Camila', 'admin')] });
  await listo(vieja);
  assert.equal(await vieja.pos.aprobarPersonal('cami@ejemplo.test', 'mesero'), false);
  assert.equal(vieja.pos.personalError, 'Falta aplicar la migración del personal en la base.');
});

test('B4 personal: eliminarPersonal quita una solicitud o a una persona aprobada (baja lógica); no deja al sistema sin admin', async () => {
  const t = montar({ rol: 'admin', personal: PERSONAL() });
  await listo(t);

  assert.equal(await t.pos.eliminarPersonal('beto@ejemplo.test'), true);
  assert.deepEqual(plano(t.supabase.rpcs('personal_eliminar').at(-1).args), { p_email: 'beto@ejemplo.test' });
  assert.deepEqual(plano(t.pos.personalPendientes.map((p) => p.email)), ['ana@ejemplo.test']);
  assert.equal(t.pos.personal.find((p) => p.email === 'beto@ejemplo.test').activo, false, 'queda como dada de baja, igual que en la base');
  assert.equal(t.base.personal.get('beto@ejemplo.test').activo, false);

  assert.equal(await t.pos.eliminarPersonal('cami@ejemplo.test'), true, 'hay otro admin (yo): se puede');
  assert.equal(t.pos.personal.find((p) => p.email === 'cami@ejemplo.test').activo, false);

  assert.equal(await t.pos.eliminarPersonal(YO.email), false, 'yo soy ahora el último admin');
  assert.equal(t.pos.personalError, 'Debe quedar al menos un admin activo.');
  assert.equal(t.pos.personalErrorDe, YO.email);
  assert.equal(t.base.personal.get(YO.email).activo, true);
  assert.equal(t.pos.personal.find((p) => p.email === YO.email).activo, true, 'la pantalla no cambió');
});

test('B5 personal: el contador sube y baja EN VIVO con postgres_changes de `personal`: una solicitud nueva avisa, una resuelta por otro admin sale, un borrado sale', async () => {
  const t = montar({ rol: 'admin', personal: PERSONAL() });
  await listo(t);
  assert.equal(t.pos.aviso, null, 'la primera lectura no avisa');
  assert.equal(t.pos.numPendientes, 2);

  t.pos.procesarCambioPersonal({ eventType: 'INSERT', new: pendiente('Dora@Ejemplo.test', 'Dora', '2026-09-30T14:00:00Z'), old: {} });
  assert.equal(t.pos.numPendientes, 3);
  assert.deepEqual(plano(t.pos.personalPendientes.map((p) => p.email)), ['beto@ejemplo.test', 'ana@ejemplo.test', 'dora@ejemplo.test'], 'correo en minúsculas, por antigüedad');
  assert.match(t.pos.aviso.texto, /Hay una solicitud nueva: Dora\. Revísala en Personal\./);
  assert.deepEqual(plano(t.pos.aviso.accion), { vista: 'personal', etiqueta: 'Ver' }, 'el aviso lleva un «Ver» que va a Personal (dos toques en vez de buscarla en «Más»)');

  t.pos.procesarCambioPersonal({ eventType: 'UPDATE', new: { ...pendiente('dora@ejemplo.test', 'Dora', '2026-09-30T14:00:00Z'), estado: 'aprobado', rol: 'mesero' }, old: {} });
  assert.equal(t.pos.numPendientes, 2, 'otro admin la aprobó: sale de las pendientes');
  assert.equal(t.pos.personal.find((p) => p.email === 'dora@ejemplo.test').estado, 'aprobado');

  t.pos._personalCargado = false;                          // una solicitud que llega antes de terminar la primera lectura no avisa (la lectura la trae)
  t.pos.procesarCambioPersonal({ eventType: 'INSERT', new: pendiente('eva@ejemplo.test', 'Eva', '2026-09-30T15:00:00Z'), old: {} });
  assert.doesNotMatch(t.pos.aviso.texto, /Eva/);
  t.pos.procesarCambioPersonal({ eventType: 'DELETE', new: {}, old: { email: 'eva@ejemplo.test' } });
  t.pos._personalCargado = true;

  const avisoAnterior = t.pos.aviso.texto;
  t.pos.procesarCambioPersonal({ eventType: 'UPDATE', new: { ...pendiente('ana@ejemplo.test', 'Ana', '2026-09-30T13:00:00Z'), activo: false }, old: {} });
  assert.equal(t.pos.numPendientes, 1, 'otro admin la eliminó');
  assert.equal(t.pos.personal.find((p) => p.email === 'ana@ejemplo.test').activo, false);

  t.pos.procesarCambioPersonal({ eventType: 'DELETE', new: {}, old: { email: 'beto@ejemplo.test' } });
  assert.equal(t.pos.numPendientes, 0);
  assert.equal(t.pos.aviso.texto, avisoAnterior, 'solo la solicitud NUEVA avisa');

  // Un mesero no procesa nada de esto.
  const mesero = montar({ rol: 'mesero' });
  await listo(mesero);
  mesero.pos.procesarCambioPersonal({ eventType: 'INSERT', new: pendiente('z@ejemplo.test', 'Z', '2026-09-30T14:00:00Z'), old: {} });
  assert.equal(mesero.pos.numPendientes, 0);
});

test('B6 personal: si pierde el rol de admin deja de oír al personal y vacía las solicitudes; si lo gana, empieza a oírlo', async () => {
  const t = montar({ rol: 'admin', personal: PERSONAL() });
  await listo(t);
  assert.equal(t.pos.numPendientes, 2);
  const canal = t.supabase.canal('pos_personal');

  t.base.personal.get(YO.email).rol = 'mesero';            // otro admin le quitó el rol
  await t.pos.revalidarRol(true);
  await asentar();
  assert.equal(t.pos.rol, 'mesero');
  assert.equal(t.pos.numPendientes, 0);
  assert.equal(canal.removido, true);

  t.base.personal.get(YO.email).rol = 'admin';             // y se lo devolvieron
  await t.pos.revalidarRol(true);
  await hastaQue(() => t.pos.numPendientes === 2);
  assert.equal(t.pos.numPendientes, 2);
  assert.equal(t.supabase.canales.filter((c) => c.nombre === 'pos_personal' && !c.removido).length, 1, 'un solo canal vivo');
});

test('B6b personal: si el cambio en vivo es de MI propia fila (otro admin me cambió el rol o me eliminó) la tablet lo aplica de una vez, sin esperar a volver a la pestaña', async () => {
  const t = montar({ rol: 'admin', personal: PERSONAL(), mesas: [mesaBase(3)] });
  await listo(t);
  const fila = t.base.personal.get(YO.email);

  t.pos.procesarCambioPersonal({ eventType: 'UPDATE', new: { ...fila }, old: {} });          // mi fila cambió pero sigo igual: nada que revalidar
  await asentar();
  assert.equal(t.supabase.rpcs('mi_rol').length, 1);

  fila.rol = 'mesero';
  t.pos.procesarCambioPersonal({ eventType: 'UPDATE', new: { ...fila }, old: {} });
  await hastaQue(() => t.pos.rol === 'mesero');
  assert.equal(t.pos.rol, 'mesero', 'otro admin me bajó a mesero: la tablet ya lo sabe');
  assert.equal(t.pos.numPendientes, 0);

  const otro = montar({ rol: 'admin', personal: PERSONAL(), mesas: [mesaBase(3)] });
  await listo(otro);
  otro.base.personal.get(YO.email).activo = false;
  otro.pos.procesarCambioPersonal({ eventType: 'UPDATE', new: { ...otro.base.personal.get(YO.email) }, old: {} });
  await hastaQue(() => otro.pos.esperaAprobacion);
  assert.equal(otro.pos.estadoAcceso, 'eliminado', 'y si otro me eliminó: la tablet lo suelta todo');
  assert.deepEqual(plano(otro.pos.mesas), []);
});

test('B7 personal TRANSITORIO: la base sin personal.estado (ola B) se lee igual: todos aprobados, ninguna pendiente', async () => {
  const t = montar({ olaC: false, rol: 'admin', personal: [aprobada('cami@ejemplo.test', 'Camila', 'admin'), { email: 'meli@ejemplo.test', nombre: 'Meli', rol: 'mesero', activo: true }] });
  t.base.sinColumnas.add('personal.estado');
  await listo(t);
  assert.deepEqual(plano(t.pos.personalPendientes), []);
  assert.deepEqual(plano(t.pos.personal.map((p) => p.email).sort()), ['cami@ejemplo.test', 'meli@ejemplo.test']);
  const lecturas = t.supabase.de('personal', 'select');
  assert.ok(lecturas.some((c) => c.columnas.includes('estado')) && lecturas.some((c) => !c.columnas.includes('estado')), 'primero pide estado; al no existir, repite sin esa columna');
});

test('B8 permisos: puede() gana mesas_admin, ajustes y aprobar_personal (solo admin) y deshacer_cobro (admin y mesero); sin rol, nada', async () => {
  const admin = await listo(montar({ rol: 'admin' }));
  const mesero = await listo(montar({ rol: 'mesero' }));
  const sinRol = montar({ rol: null, acceso: 'pendiente' });
  await sinRol.pos.arrancarApp();
  for (const a of ['mesas_admin', 'ajustes', 'aprobar_personal']) {
    assert.equal(admin.pos.puede(a), true, `admin puede ${a}`);
    assert.equal(mesero.pos.puede(a), false, `mesero NO puede ${a}`);
    assert.equal(sinRol.pos.puede(a), false, `quien espera NO puede ${a}`);
  }
  assert.equal(admin.pos.puede('deshacer_cobro'), true);
  assert.equal(mesero.pos.puede('deshacer_cobro'), true, 'deshacer es de admin y mesero: sin ventana de tiempo');
  assert.equal(sinRol.pos.puede('deshacer_cobro'), false);
});

test('B9 personal: irA(vista) comprueba el permiso y pide los datos de la vista; perder el rol de admin saca de las vistas de admin', async () => {
  const t = montar({ rol: 'admin', mesas: [mesaBase(3)], personal: PERSONAL() });
  await listo(t);
  assert.equal(t.pos.irA('mesas-admin'), true);
  assert.equal(t.pos.vista, 'mesas-admin');
  await hastaQue(() => t.pos.mesasAdmin.length === 1);
  assert.equal(t.pos.irA('ajustes'), true);
  assert.equal(t.pos.vista, 'ajustes');

  t.base.personal.get(YO.email).rol = 'mesero';
  await t.pos.revalidarRol(true);
  assert.equal(t.pos.vista, 'mesas', 'la vista de ajustes ya no es suya');
  assert.equal(t.pos.irA('mesas-admin'), false);
  assert.equal(t.pos.irA('personal'), false);
  assert.equal(t.pos.vista, 'mesas');
});

// ═════════════════════════ C. Mesas y pegatinas ═════════════════════════

const SALON = () => [mesaBase(3), mesaBase(5, { estado: 'libre' }), mesaBase(7, { estado: 'libre', activa: false, capacidad: 6 })];

test('C1 mesas: el panel lista TODAS las mesas (también las desactivadas) con su enlace y las fechas de la pegatina; el mapa del salón, solo las activas', async () => {
  const t = montar({ rol: 'admin', mesas: SALON().map((m) => (m.id === 5 ? { ...m, pegatina_escrita_en: '2026-09-29T10:00:00Z', pegatina_revisada_en: '2026-09-30T08:00:00Z' } : m)), ordenes: [ordenBase('o1', 3, [item('p1', 5000)])] });
  await listo(t);
  assert.deepEqual(plano(t.pos.mesas.map((m) => m.id)), [3, 5], 'el salón no trae la 7 (desactivada)');
  assert.deepEqual(plano(t.pos.mesasActivas.map((m) => m.id)), [3, 5]);
  assert.deepEqual(plano(t.pos.mesasLibres.map((m) => m.id)), [5]);

  assert.equal(await t.pos.cargarMesasAdmin(), true);
  assert.deepEqual(plano(t.pos.mesasAdmin.map((m) => [m.id, m.capacidad, m.activa, m.estado])), [[3, 4, true, 'ocupada'], [5, 4, true, 'libre'], [7, 6, false, 'libre']]);
  assert.deepEqual(Object.keys(t.pos.mesasAdmin[0]).sort(), ['activa', 'capacidad', 'enlace', 'escritaEn', 'estado', 'id', 'revisadaEn'], 'las claves del contrato, y ningún token suelto');
  assert.equal(t.pos.mesasAdmin[0].enlace, ENLACE_3);
  assert.equal(t.pos.mesasAdmin[2].enlace, `https://resplandor.ynt.codes/carta.html?m=7&k=${TOKEN}`);
  assert.deepEqual(plano([t.pos.mesasAdmin[0].escritaEn, t.pos.mesasAdmin[0].revisadaEn]), [null, null]);
  assert.deepEqual(plano([t.pos.mesasAdmin[1].escritaEn, t.pos.mesasAdmin[1].revisadaEn]), ['2026-09-29T10:00:00Z', '2026-09-30T08:00:00Z']);
  assert.equal(t.pos.mesasAdminError, '');
  assert.deepEqual(plano(t.pos.mesas.map((m) => m.id)), [3, 5], 'leer el panel no mete la desactivada en el salón');

  // La red de seguridad: aunque una mesa desactivada se colara en `mesas`, no se lista ni se ofrece para reabrir.
  t.pos.mesas.push({ id: 9, capacidad: 2, estado: 'libre', activa: false });
  assert.deepEqual(plano(t.pos.mesasActivas.map((m) => m.id)), [3, 5]);
  assert.deepEqual(plano(t.pos.mesasLibres.map((m) => m.id)), [5]);
});

test('C2 mesas: una mesa desactivada sale del salón (al leer y en vivo) y al reactivarla vuelve; con todas desactivadas NO reaparece la semilla de mesas', async () => {
  const t = montar({ rol: 'admin', mesas: [mesaBase(3, { estado: 'libre' }), mesaBase(5, { estado: 'libre' })] });
  await listo(t);
  assert.deepEqual(plano(t.pos.mesas.map((m) => m.id)), [3, 5]);

  t.pos.procesarCambioEnVivo('mesas', { eventType: 'UPDATE', new: { ...mesaBase(5, { estado: 'libre' }), activa: false }, old: { id: 5 } });
  assert.deepEqual(plano(t.pos.mesas.map((m) => m.id)), [3], 'otro admin la desactivó');
  assert.deepEqual(JSON.parse(t.almacen.get('pos_mesas')).map((m) => m.id), [3], 'y la caché también');

  t.pos.procesarCambioEnVivo('mesas', { eventType: 'UPDATE', new: { ...mesaBase(5, { estado: 'libre' }), activa: true }, old: { id: 5 } });
  assert.deepEqual(plano(t.pos.mesas.map((m) => m.id).sort()), [3, 5], 'reactivada: vuelve');

  const todas = montar({ rol: 'admin', mesas: [mesaBase(3, { estado: 'libre', activa: false })] });
  await listo(todas);
  assert.deepEqual(plano(todas.pos.mesas), [], 'todas desactivadas: el salón queda vacío, no con las 10 mesas de la semilla');
});

test('C3 mesas: crearMesa valida (número 1 a 999, capacidad 1 a 50, como la base) y llama mesa_crear; la mesa nueva sale en el panel con su enlace y en el salón', async () => {
  const t = montar({ rol: 'admin', mesas: SALON() });
  await listo(t);
  await t.pos.cargarMesasAdmin();
  const antes = t.supabase.rpcs('mesa_crear').length;

  for (const [id, cap] of [[0, 4], [1000, 4], [5.5, 4], ['abc', 4], [9, 0], [9, 51], [9, 100], [9, 'x'], [3, 4]]) {
    assert.equal(await t.pos.crearMesa(id, cap), false, `crearMesa(${id}, ${cap}) no se acepta`);
    assert.notEqual(t.pos.mesasAdminError, '');
  }
  assert.equal(t.supabase.rpcs('mesa_crear').length, antes, 'nada de eso llegó a la base');
  assert.equal(t.pos.mesasAdminError, 'Ya existe una mesa con ese número.', 'el último intento era la mesa 3, que ya existe');

  assert.equal(await t.pos.crearMesa('12', '6'), true, 'los números llegan como texto desde el formulario');
  assert.deepEqual(plano(t.supabase.rpcs('mesa_crear').at(-1).args), { p_id: 12, p_capacidad: 6 });
  const nueva = t.pos.mesasAdmin.find((m) => m.id === 12);
  assert.deepEqual([nueva.capacidad, nueva.activa, nueva.estado], [6, true, 'libre']);
  assert.match(nueva.enlace, /^https:\/\/resplandor\.ynt\.codes\/carta\.html\?m=12&k=[0-9a-f]{48}$/, 'el token lo puso la base');
  assert.ok(t.pos.mesas.some((m) => m.id === 12), 'y entra al mapa del salón sin esperar a Realtime');
  assert.equal(t.pos.mesasAdminError, '');

  t.pos.mesasAdmin = [];                                   // una lista vieja: la base es la que dice «ya existe»
  assert.equal(await t.pos.crearMesa(3, 4), false);
  assert.equal(t.pos.mesasAdminError, 'Ya existe una mesa con ese número.');
});

test('C4 mesas: editarMesa cambia la capacidad; activarMesa(false) la saca del salón; con una cuenta abierta la base no la deja desactivar', async () => {
  const t = montar({ rol: 'admin', mesas: SALON(), ordenes: [ordenBase('o1', 3, [item('p1', 5000)])] });
  await listo(t);
  await t.pos.cargarMesasAdmin();

  assert.equal(await t.pos.editarMesa(5, '8'), true);
  assert.deepEqual(plano(t.supabase.rpcs('mesa_editar').at(-1).args), { p_id: 5, p_capacidad: 8 });
  assert.equal(t.pos.mesasAdmin.find((m) => m.id === 5).capacidad, 8);
  assert.equal(mesaDe(t, 5).capacidad, 8, 'el salón también');
  assert.equal(await t.pos.editarMesa(5, 0), false);
  assert.equal(t.pos.mesasAdminError, 'La capacidad debe ser un entero entre 1 y 50.');

  assert.equal(await t.pos.activarMesa(3, false), false, 'la mesa 3 tiene una cuenta abierta');
  assert.equal(t.pos.mesasAdminError, 'Esa mesa tiene una cuenta abierta: cóbrala o libérala antes de desactivarla.');
  assert.ok(mesaDe(t, 3), 'sigue en el salón');
  assert.equal(t.pos.mesasAdmin.find((m) => m.id === 3).activa, true);

  assert.equal(await t.pos.activarMesa(5, false), true);
  assert.deepEqual(plano(t.supabase.rpcs('mesa_activar').at(-1).args), { p_id: 5, p_activa: false });
  assert.equal(t.pos.mesasAdmin.find((m) => m.id === 5).activa, false, 'el panel la sigue mostrando');
  assert.equal(mesaDe(t, 5), undefined, 'pero el salón ya no');
  assert.equal(t.pos.mesasAdminError, '', 'un éxito borra el error de antes');

  assert.equal(await t.pos.activarMesa(5, true), true);
  assert.ok(mesaDe(t, 5), 'reactivada: vuelve al salón');
});

test('C5 mesas: el mesero no cambia mesas (ni llama a la base); sin la migración sale el aviso claro', async () => {
  const mesero = montar({ rol: 'mesero', mesas: SALON() });
  await listo(mesero);
  const lecturas = tablasLeidas(mesero).filter((x) => x === 'select:mesas').length;
  assert.equal(await mesero.pos.cargarMesasAdmin(), false);
  assert.equal(tablasLeidas(mesero).filter((x) => x === 'select:mesas').length, lecturas, 'ni siquiera lee el panel');
  for (const accion of [() => mesero.pos.crearMesa(9, 4), () => mesero.pos.editarMesa(3, 5), () => mesero.pos.activarMesa(3, false)]) {
    assert.equal(await accion(), false);
    assert.equal(mesero.pos.mesasAdminError, 'Solo un admin puede cambiar las mesas.');
  }
  assert.equal(['mesa_crear', 'mesa_editar', 'mesa_activar'].flatMap((n) => mesero.supabase.rpcs(n)).length, 0);

  const vieja = montar({ olaC: false, rol: 'admin', mesas: [mesaBase(3), mesaBase(5, { estado: 'libre' })] });
  await listo(vieja);
  assert.equal(await vieja.pos.crearMesa(9, 4), false);
  assert.equal(vieja.pos.mesasAdminError, 'Falta aplicar en la base la migración de mesas y pegatinas.');
  vieja.base.sinColumnas.add('mesas.activa');
  assert.equal(await vieja.pos.cargarMesasAdmin(), true, 'sin la columna `activa`: todas activas, sin fechas');
  assert.ok(vieja.pos.mesasAdmin.every((m) => m.activa === true && m.escritaEn === null));
});

test('C6 mesas: copiarEnlace copia el enlace de esa mesa; sin portapapeles deja enlaceManualId y SELECCIONA el texto para copiarlo a mano', async () => {
  const copiado = [];
  const seleccion = { rangos: 0, vaciadas: 0, nodo: null };
  const t = montar({
    rol: 'admin', mesas: SALON(),
    extras: {
      navigator: { clipboard: { writeText: async (x) => { copiado.push(x); } } },
      getSelection: () => ({ removeAllRanges() { seleccion.vaciadas++; }, addRange() { seleccion.rangos++; } }),
    },
    documento: {
      querySelector: (sel) => (sel === '[data-enlace-mesa="3"]' ? { id: 'enlace-3' } : null),
      createRange: () => ({ selectNodeContents(n) { seleccion.nodo = n.id; } }),
    },
  });
  await listo(t);
  await t.pos.cargarMesasAdmin();

  assert.equal(await t.pos.copiarEnlace(99), false, 'una mesa que no existe no copia nada');
  assert.equal(await t.pos.copiarEnlace(3), true);
  assert.deepEqual(copiado, [ENLACE_3]);
  assert.equal(t.pos.enlaceCopiadoId, 3);
  assert.equal(t.pos.enlaceManualId, null);
  assert.equal(t.disparar(1500), 1);
  assert.equal(t.pos.enlaceCopiadoId, null, 'el «Copiado» dura 1,5 s');

  t.caja.navigator.clipboard.writeText = async () => { throw new Error('NotAllowedError'); };
  assert.equal(await t.pos.copiarEnlace(3), false);
  assert.equal(t.pos.enlaceManualId, 3, 'la pantalla muestra el enlace de la mesa 3 para copiarlo a mano');
  assert.equal(t.pos.enlaceCopiadoId, null);
  assert.deepEqual([seleccion.nodo, seleccion.vaciadas, seleccion.rangos], ['enlace-3', 1, 1], 'y selecciona el elemento data-enlace-mesa="3"');

  delete t.caja.navigator.clipboard;                       // ni siquiera existe (página sin https)
  assert.equal(await t.pos.copiarEnlace(5), false);
  assert.equal(t.pos.enlaceManualId, 5);
});

/** Un NDEFReader de mentira. `escribir`: 'ok' | 'colgada' (espera el abort) | el nombre de un error (NotAllowedError…). */
function nfcFalso({ escribir = 'ok', alEscanear } = {}) {
  const registro = { escrituras: [], escaneos: [], soloLectura: 0, instancias: [] };
  registro.NDEFReader = class NDEFReader {
    constructor() { registro.instancias.push(this); }
    write(mensaje, opciones) {
      registro.escrituras.push({ mensaje: JSON.parse(JSON.stringify(mensaje)), opciones });
      if (escribir === 'ok') return Promise.resolve();
      if (escribir === 'colgada') {
        return new Promise((_, rechazar) => opciones.signal.addEventListener('abort', () => { const e = new Error('cancelado'); e.name = 'AbortError'; rechazar(e); }));
      }
      const e = new Error(escribir); e.name = escribir; return Promise.reject(e);
    }
    scan(opciones) {
      registro.escaneos.push({ opciones });
      if (alEscanear) return alEscanear(this, opciones);
      return Promise.resolve();
    }
    makeReadOnly() { registro.soloLectura++; return Promise.resolve(); }
  };
  /** Acerca una pegatina con esa dirección a la última lectura abierta. */
  registro.acercar = (url, tipo = 'url') => registro.instancias.at(-1).onreading({
    message: { records: url == null ? [] : [{ recordType: tipo, data: new TextEncoder().encode(url) }] },
  });
  return registro;
}

async function conPanel(opciones = {}) {
  const nfc = nfcFalso(opciones.nfc);
  const t = montar({ rol: 'admin', mesas: SALON(), ...opciones.montar, extras: { NDEFReader: nfc.NDEFReader, TextEncoder, ...(opciones.montar?.extras || {}) } });
  await listo(t);
  await t.pos.cargarMesasAdmin();
  return Object.assign(t, { nfc });
}

test('C7 NFC: escribirPegatina llama NDEFReader.write con UN registro url (el enlace de la mesa) EN EL MISMO TOQUE, anota «escrita» y NUNCA bloquea la pegatina', async () => {
  const t = await conPanel();
  assert.equal(t.pos.nfcDisponible, true);
  const escritura = t.pos.escribirPegatina(3);
  assert.equal(t.nfc.escrituras.length, 1, 'write() ya se llamó, sin ningún await antes (el permiso de NFC lo pide el navegador en ese toque)');
  assert.deepEqual(t.nfc.escrituras[0].mensaje, { records: [{ recordType: 'url', data: ENLACE_3 }] });
  assert.ok(t.nfc.escrituras[0].opciones.signal, 'con señal de aborto');
  assert.deepEqual(plano(t.pos.nfcEstado), { id: 3, fase: 'esperando', mensaje: plano(t.pos.nfcEstado).mensaje, accion: 'escribir' });
  assert.match(t.pos.nfcEstado.mensaje, /Acerca la pegatina de la mesa\s3/, 'con un espacio duro entre «mesa» y su número: nunca un «3…» solo en la segunda línea');

  assert.equal(await escritura, true);
  assert.equal(t.pos.nfcEstado.fase, 'ok');
  assert.equal(t.pos.nfcEstado.id, 3);
  assert.match(t.pos.nfcEstado.mensaje, /escrita/);
  assert.deepEqual(plano(t.supabase.rpcs('pegatina_marcar').at(-1).args), { p_id: 3, p_tipo: 'escrita', p_token: TOKEN }, 'se anota con el token que de verdad quedó escrito');
  assert.ok(t.pos.mesasAdmin.find((m) => m.id === 3).escritaEn, 'la fecha de «escrita» aparece sin recargar la lista');
  assert.equal(t.base.mesas.get(3).pegatina_escrita_en !== null, true);
  assert.equal(t.nfc.soloLectura, 0, 'makeReadOnly NO se llama: bloquearía la pegatina para siempre');
  assert.ok(!/\.makeReadOnly\s*\(/.test(STORE), 'y el código no lo llama en ninguna parte');
});

test('C8 NFC: permiso denegado, NFC apagado o sin soporte: el estado dice por qué (sin lanzar) y no se anota nada', async () => {
  for (const [error, esperado] of [
    ['NotAllowedError', /permiso de NFC/], ['NotSupportedError', /no tiene NFC, o está apagado/], ['NotReadableError', /No se pudo usar el NFC/],
    ['NetworkError', /bloqueada/], ['SecurityError', /https/], ['AlgoRaro', /No se pudo usar la pegatina/],
  ]) {
    const t = await conPanel({ nfc: { escribir: error } });
    assert.equal(await t.pos.escribirPegatina(3), false, error);
    assert.equal(t.pos.nfcEstado.fase, 'error', error);
    assert.equal(t.pos.nfcEstado.id, 3);
    assert.match(t.pos.nfcEstado.mensaje, esperado, error);
    assert.equal(t.supabase.rpcs('pegatina_marcar').length, 0, 'no anota «escrita» si no se escribió');
    assert.equal(t.pos.mesasAdmin.find((m) => m.id === 3).escritaEn, null);
  }
  const sinNfc = montar({ rol: 'admin', mesas: SALON() });          // iPhone o escritorio: no hay NDEFReader
  await listo(sinNfc);
  await sinNfc.pos.cargarMesasAdmin();
  assert.equal(sinNfc.pos.nfcDisponible, false);
  assert.equal(await sinNfc.pos.escribirPegatina(3), false);
  assert.equal(await sinNfc.pos.revisarPegatina(3), false);
  assert.equal(sinNfc.pos.nfcEstado.fase, 'error');
  assert.match(sinNfc.pos.nfcEstado.mensaje, /NFC Tools|Android/);
  assert.equal(sinNfc.supabase.rpcs('pegatina_marcar').length, 0);
});

test('C9 NFC: cancelarNfc aborta la escritura en curso, limpia el estado y no anota nada; una operación nueva cancela la anterior', async () => {
  const t = await conPanel({ nfc: { escribir: 'colgada' } });
  const primera = t.pos.escribirPegatina(3);
  const senal = t.nfc.escrituras[0].opciones.signal;
  assert.equal(senal.aborted, false);
  t.pos.cancelarNfc();
  assert.equal(senal.aborted, true, 'el AbortController cortó la escritura');
  assert.deepEqual(plano(t.pos.nfcEstado), { id: null, fase: null, mensaje: '', accion: null });
  assert.equal(await primera, false);
  assert.deepEqual(plano(t.pos.nfcEstado), { id: null, fase: null, mensaje: '', accion: null }, 'la escritura cancelada no deja un «error»');
  assert.equal(t.supabase.rpcs('pegatina_marcar').length, 0);

  const a = t.pos.escribirPegatina(3);
  const senalA = t.nfc.escrituras.at(-1).opciones.signal;
  const b = t.pos.escribirPegatina(5);
  assert.equal(senalA.aborted, true, 'tocar otra mesa cancela la anterior');
  assert.equal(t.pos.nfcEstado.id, 5);
  assert.equal(await a, false);
  assert.equal(t.pos.nfcEstado.id, 5, 'y la anterior no pisa el estado de la nueva');
  t.pos.cancelarNfc();
  assert.equal(await b, false);
});

test('C10 NFC: la escritura salió bien pero la base no contestó: la pegatina SÍ quedó escrita y el mensaje lo dice', async () => {
  const t = await conPanel();
  t.base.fallar('rpc:pegatina_marcar');
  assert.equal(await t.pos.escribirPegatina(3), true);
  assert.equal(t.pos.nfcEstado.fase, 'ok');
  assert.match(t.pos.nfcEstado.mensaje, /no quedó anotada/);
  assert.equal(t.pos.mesasAdmin.find((m) => m.id === 3).escritaEn, null);
});

test('C11 NFC: revisarPegatina lee la pegatina y solo anota «revisada» si el enlace es EXACTAMENTE el de esa mesa; si no, dice qué falla sin repetir lo leído', async () => {
  const OTRO_TOKEN = 'b'.repeat(48);
  const casos = [
    [`https://resplandor.ynt.codes/carta.html?m=5&k=${TOKEN}`, /de la mesa 5, no de la 3/],
    [`https://otro-dominio.example/carta.html?m=3&k=${TOKEN}`, /otra dirección/],
    [`https://resplandor.ynt.codes/carta.html?m=3&k=${OTRO_TOKEN}`, /es viejo/],
    [`${ENLACE_3}&x=1`, /no es exactamente el de esta mesa/],
    [`${ENLACE_3}#`, /no es exactamente el de esta mesa/],
    ['no es un enlace', /no trae un enlace válido/],
    [null, /vacía/],
  ];
  for (const [leido, esperado] of casos) {
    const t = await conPanel();
    const revision = t.pos.revisarPegatina(3);
    assert.equal(t.nfc.escaneos.length, 1, 'scan() se llamó en el mismo toque');
    assert.ok(t.nfc.escaneos[0].opciones.signal);
    assert.equal(t.pos.nfcEstado.fase, 'esperando');
    t.nfc.acercar(leido);
    assert.equal(await revision, false, String(leido));
    assert.equal(t.pos.nfcEstado.fase, 'error');
    assert.match(t.pos.nfcEstado.mensaje, esperado, String(leido));
    assert.ok(!t.pos.nfcEstado.mensaje.includes(TOKEN) && !t.pos.nfcEstado.mensaje.includes(OTRO_TOKEN), 'el mensaje no repite ningún token');
    assert.equal(t.supabase.rpcs('pegatina_marcar').length, 0, 'no anota «revisada»');
    assert.equal(t.nfc.escaneos[0].opciones.signal.aborted, true, 'y deja de escuchar');
    assert.equal(t.nfc.soloLectura, 0);
  }

  const bien = await conPanel();
  const revision = bien.pos.revisarPegatina(3);
  bien.nfc.acercar(ENLACE_3);
  bien.nfc.acercar(ENLACE_3);                                // una segunda lectura pegada a la primera no anota dos veces
  assert.equal(await revision, true);
  assert.equal(bien.pos.nfcEstado.fase, 'ok');
  assert.match(bien.pos.nfcEstado.mensaje, /está bien/);
  assert.deepEqual(plano(bien.supabase.rpcs('pegatina_marcar').map((c) => c.args)), [{ p_id: 3, p_tipo: 'revisada', p_token: TOKEN }]);
  assert.ok(bien.pos.mesasAdmin.find((m) => m.id === 3).revisadaEn);
  assert.equal(bien.nfc.escaneos[0].opciones.signal.aborted, true);
  assert.equal(bien.nfc.soloLectura, 0);

  const absoluta = await conPanel();
  const r2 = absoluta.pos.revisarPegatina(3);
  absoluta.nfc.acercar(ENLACE_3, 'absolute-url');
  assert.equal(await r2, true, 'un registro absolute-url también cuenta');
});

test('C12 NFC: un error al leer, el permiso negado al escanear y cancelar la lectura dejan el estado correcto', async () => {
  const lectura = await conPanel();
  const r = lectura.pos.revisarPegatina(3);
  lectura.nfc.instancias.at(-1).onreadingerror();
  assert.equal(await r, false);
  assert.match(lectura.pos.nfcEstado.mensaje, /No se pudo leer esa pegatina/);

  const negado = await conPanel({ nfc: { alEscanear: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) } });
  assert.equal(await negado.pos.revisarPegatina(3), false);
  assert.match(negado.pos.nfcEstado.mensaje, /permiso de NFC/);

  const cancelada = await conPanel({ nfc: { alEscanear: (_, o) => new Promise((_ok, rech) => o.signal.addEventListener('abort', () => rech(Object.assign(new Error('c'), { name: 'AbortError' })))) } });
  const rc = cancelada.pos.revisarPegatina(3);
  cancelada.pos.cancelarNfc();
  assert.equal(await rc, false);
  assert.deepEqual(plano(cancelada.pos.nfcEstado), { id: null, fase: null, mensaje: '', accion: null });
  assert.equal(cancelada.supabase.rpcs('pegatina_marcar').length, 0);
});

test('C13 mesas: rotarTokenMesa(id, {confirmado:true}) rota la mesa del panel SIN confirm() ni alert() nativos y actualiza el enlace del panel; sin argumentos sigue rotando la mesa abierta', async () => {
  const t = await conPanel();
  // La pegatina de la mesa 5 estaba escrita y revisada: al girar el token la base borra las dos fechas (integración de la ola C) y el panel no puede seguir diciendo «Escrita hoy».
  t.base.mesas.get(5).pegatina_escrita_en = '2026-09-30T10:00:00Z'; t.base.mesas.get(5).pegatina_revisada_en = '2026-09-30T10:05:00Z';
  await t.pos.cargarMesasAdmin();
  assert.ok(t.pos.mesasAdmin.find((m) => m.id === 5).escritaEn && t.pos.mesasAdmin.find((m) => m.id === 5).revisadaEn, 'punto de partida: escrita y revisada');
  assert.equal(await t.pos.rotarTokenMesa(5, { confirmado: true }), true);
  assert.deepEqual([t.pos.mesasAdmin.find((m) => m.id === 5).escritaEn, t.pos.mesasAdmin.find((m) => m.id === 5).revisadaEn], [null, null], 'rotar el enlace deja la pegatina sin escribir ni revisar en el panel');
  assert.deepEqual([t.base.mesas.get(5).pegatina_escrita_en, t.base.mesas.get(5).pegatina_revisada_en], [null, null], 'y la base (trigger) las borró');
  assert.deepEqual(t.confirmaciones, [], 'ni un confirm()');
  assert.deepEqual(t.avisos, [], 'ni un alert()');
  assert.match(t.pos.aviso.texto, /Enlace de la mesa 5 rotado/);
  const nuevo = t.base.mesas.get(5).token;
  assert.notEqual(nuevo, TOKEN);
  assert.equal(t.pos.mesasAdmin.find((m) => m.id === 5).enlace, `https://resplandor.ynt.codes/carta.html?m=5&k=${nuevo}`);
  assert.equal(t.pos.mesasAdmin.find((m) => m.id === 3).enlace, ENLACE_3, 'las demás no cambian');

  t.pos.mesaActiva = mesaDe(t, 3);                          // la forma de antes: la mesa abierta en pantalla (con confirm)
  assert.equal(await t.pos.rotarTokenMesa(), true);
  assert.equal(t.confirmaciones.length, 1);
  assert.notEqual(t.base.mesas.get(3).token, TOKEN);

  const mesero = montar({ rol: 'mesero', mesas: SALON(), extras: { NDEFReader: class {} } });
  await listo(mesero);
  assert.equal(await mesero.pos.rotarTokenMesa(5, { confirmado: true }), false);
  assert.equal(mesero.base.mesas.get(5).token, TOKEN);
});

// ═════════════════════════ D. Deshacer un cobro parcial o un abono ═════════════════════════

const PALOMA = () => ({ id: 'paloma', nombre: 'Paloma', precio: 4500, qty: 4, nota: '' });
const SOPA = () => ({ id: 'sopa', nombre: 'Sopa', precio: 6000, qty: 2, nota: 'sin cilantro' });
const TOTAL_CUENTA = 4 * 4500 + 2 * 6000;                    // 30.000

/** Una mesa 3 con su cuenta abierta (4 palomas y 2 sopas, $30.000) abierta en pantalla. */
async function conCuenta(opciones = {}) {
  const t = montar({ mesas: [mesaBase(3), mesaBase(5, { estado: 'libre' })], ordenes: [ordenBase('o1', 3, [PALOMA(), SOPA()], 1)], ...opciones });
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  return t;
}
const cerradas = (t) => lista(t.base.ordenes).filter((o) => o.estado === 'cerrada');
const abiertaBase = (t) => t.base.ordenes.get('o1');
const lineaDe = (orden, id) => orden.items.find((i) => i.id === id);
/** Cobra `n` unidades de una línea con el cobro por partes y espera a que suba todo. */
async function cobrarUnidades(t, id = 'paloma', n = 2) {
  t.pos.toggleModoCobroParcial();
  const linea = lineaDe(t.pos.ordenActiva, id);
  t.pos.toggleSeleccion(linea);
  t.pos.ajustarCantidadSeleccion(linea, -(linea.qty - n));
  t.pos.facturarParcial();
  await asentar();
  return t.pos.ultimoCobro;
}

test('D1 deshacer: cobrar por unidades sube la orden cerrada con `parcial_de` y deja el aviso «Cobrado $X · Deshacer» por 15 s', async () => {
  const t = await conCuenta();
  const cobro = await cobrarUnidades(t);
  const cerrada = cerradas(t);
  assert.equal(cerrada.length, 1);
  assert.equal(cerrada[0].parcial_de, 'o1', 'la orden cerrada apunta a la cuenta abierta de la que salió');
  assert.equal(cerrada[0].total, 9000);
  assert.equal(lineaDe(abiertaBase(t), 'paloma').qty, 2, 'la cuenta abierta quedó con 2 palomas');
  assert.equal(abiertaBase(t).total, TOTAL_CUENTA - 9000);

  assert.deepEqual(plano({ ...cobro, hasta: 0 }), { ordenId: cerrada[0].id, abiertaId: 'o1', mesaId: 3, monto: 9000, tipo: 'parcial', hasta: 0 });
  assert.ok(cobro.hasta > Date.now() + 14000 && cobro.hasta <= Date.now() + 15000, 'dura unos 15 s');
  assert.equal(t.temporizadores.filter((h) => h.ms === 15000 && !h.cancelado).length, 1, 'con su temporizador de 15 s');
  assert.equal(t.disparar(15000), 1);
  assert.equal(t.pos.ultimoCobro, null, 'a los 15 s el aviso desaparece');
});

test('D2 deshacer: «Deshacer» devuelve los ítems a la cuenta (cuadre EXACTO del total), borra la orden cerrada y lo avisa; la persona va a la cuenta de la mesa', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t);
  const idCerrada = t.pos.ultimoCobro.ordenId;
  assert.equal(t.pos.vista, 'ticket');
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA - 9000);
  assert.equal(t.pos.totalHoy, 9000);
  assert.equal(t.pos.puedeDevolver(t.pos.ordenes.find((o) => o.id === idCerrada)), true);

  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar();
  assert.deepEqual(plano(t.supabase.rpcs('deshacer_cobro').map((c) => c.args)), [{ p_orden_id: idCerrada }]);
  assert.equal(t.pos.deshacerError, '');
  assert.equal(t.pos.ultimoCobro, null);
  assert.equal(t.pos.aviso.texto, 'Cobro deshecho · $ 9.000 volvió a la cuenta de Mesa 3');

  // Aquí y en la base: la cuenta tal como era antes de cobrar.
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA, 'el total volvió a $30.000 sin un peso de más ni de menos');
  assert.equal(abiertaBase(t).total, TOTAL_CUENTA);
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.id, i.nombre, i.precio, i.qty, i.nota])), [['paloma', 'Paloma', 4500, 4, ''], ['sopa', 'Sopa', 6000, 2, 'sin cilantro']]);
  assert.deepEqual(plano(abiertaBase(t).items.map((i) => [i.id, i.qty])), [['paloma', 4], ['sopa', 2]]);
  assert.equal(cerradas(t).length, 0, 'la orden cerrada se borró en la base');
  assert.equal(t.pos.ordenes.some((o) => o.estado === 'cerrada'), false, 'y aquí');
  assert.equal(t.supabase.de('ordenes', 'select').filter((c) => c.filtros.some(([col, val]) => col === 'id' && val === 'o1')).length, 1, 'relee la cuenta abierta de la base');
  assert.equal(t.pos.totalHoy, 0, 'las ventas de hoy se recalculan: ya no cuentan esos $9.000');
  assert.equal(t.pos.ordenesHoy.length, 0);
  assert.equal(sinPendientes(t.pos), true);
  assert.equal(t.pos.vista, 'orden', 'estaba viendo el ticket de ese cobro: va a la cuenta de la mesa');
  assert.equal(t.pos.ticketMostrado, null);
  assert.equal(t.pos.ordenActiva.id, 'o1');
  assert.equal(t.pos.mesaActiva.id, 3);
});
const sinPendientes = (pos) => Object.keys(plano(pos._pendientes)).length === 0;

test('D3 deshacer: un ABONO se deshace quitando la línea «Abono recibido» y borrando la orden «Abono» (el total vuelve exacto)', async () => {
  const t = await conCuenta();
  t.pos.montoAbono = '7500';
  t.pos.metodoAbono = 'qr';
  assert.equal(t.pos.cobrarMonto(), true);
  await asentar();
  assert.equal(t.pos.ultimoCobro.tipo, 'abono');
  assert.equal(t.pos.ultimoCobro.monto, 7500);
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA - 7500);
  assert.equal(cerradas(t)[0].parcial_de, 'o1');
  assert.ok(abiertaBase(t).items.some((i) => i.id.startsWith('abono_recibido_')));

  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar();
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA);
  assert.equal(abiertaBase(t).total, TOTAL_CUENTA);
  assert.equal(t.pos.ordenActiva.items.some((i) => i.id.startsWith('abono_')), false, 'sin ninguna línea de abono');
  assert.equal(abiertaBase(t).items.some((i) => i.id.startsWith('abono_')), false);
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.pos.totalHoy, 0);
  assert.equal(t.pos.aviso.texto, 'Cobro deshecho · $ 7.500 volvió a la cuenta de Mesa 3');
  assert.equal(t.pos.abonosRecibidos, 0);
});

test('D4 deshacer: dos cobros seguidos (unidades y abono) se deshacen de uno en uno y la cuenta vuelve exacta; el aviso es siempre el del ÚLTIMO cobro', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t, 'sopa', 1);                       // $6.000
  const primero = t.pos.ultimoCobro.ordenId;
  t.pos.volverAMesas(); await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.montoAbono = '3000';
  assert.equal(t.pos.cobrarMonto(), true);
  await asentar();
  assert.equal(t.pos.ultimoCobro.tipo, 'abono', 'el aviso del abono reemplazó al del cobro anterior');
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA - 6000 - 3000);

  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA - 6000);
  assert.equal(t.pos.ultimoCobro, null);
  const anterior = t.pos.ordenes.find((o) => o.id === primero);
  assert.equal(t.pos.puedeDevolver(anterior), true, 'el cobro anterior se devuelve desde «Transacciones del turno»');
  assert.equal(await t.pos.devolverACuenta(primero), true);
  await asentar();
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA);
  assert.equal(abiertaBase(t).total, TOTAL_CUENTA);
  assert.equal(cerradas(t).length, 0);
  assert.deepEqual(plano(abiertaBase(t).items.map((i) => [i.id, i.qty])), [['paloma', 4], ['sopa', 2]], 'la sopa vuelve a su línea, no a una nueva');
});

test('D5 deshacer SIN ventana: el mesero y el admin deshacen un cobro de hace tres días igual que uno de hace tres segundos (la base decide, no el reloj)', async () => {
  const hace3dias = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
  for (const rol of ['mesero', 'admin']) {
    const t = await conCuenta({ rol });
    await cobrarUnidades(t);
    const id = t.pos.ultimoCobro.ordenId;
    t.pos.ordenes.find((o) => o.id === id).cerradaEn = hace3dias;
    t.base.ordenes.get(id).cerrada_en = hace3dias;
    assert.equal(t.pos.puedeDevolver(t.pos.ordenes.find((o) => o.id === id)), true, `${rol}: el botón aparece (no hay ventana)`);
    assert.equal(t.pos.puede('deshacer_cobro'), true);
    assert.equal(await t.pos.devolverACuenta(id), true, rol);
    await asentar();
    assert.equal(t.pos.deshacerError, '');
    assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA, `${rol}: la cuenta vuelve exacta`);
    assert.equal(cerradas(t).length, 0);
    assert.equal(t.base.deshechosTabla.length, 1, 'la base anotó el deshacer');
    assert.equal(t.base.deshechosTabla[0].hecho_por, 'yo@ejemplo.test');
  }
  assert.ok(!/ventana_vencida|10 minutos|VENTANA_MESERO/.test(STORE), 'el store ya no sabe de una ventana de 10 minutos');
});

test('D6 deshacer: lo que la base dice de una orden que la tablet no sabe (ya archivada en un cierre) se explica y se vuelve a leer la verdad', async () => {
  const t = await conCuenta({ rol: 'mesero' });
  await cobrarUnidades(t);
  const id = t.pos.ultimoCobro.ordenId;
  t.base.cierres.set('c1', { id: 'c1', fecha: new Date().toISOString(), total_ventas: 9000, total_ordenes: 1, transacciones: [{ id, mesaId: 3, total: 9000 }] });   // otra tablet cerró el día
  assert.equal(await t.pos.deshacerUltimoCobro(), false);
  await asentar();
  assert.equal(t.pos.deshacerError, 'Ese cobro ya está en un cierre del día: no se puede deshacer.');
  assert.equal(t.supabase.rpcs('deshacer_cobro').length, 1);
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA - 9000, 'nada cambió en la cuenta');
  assert.equal(cerradas(t).length, 1);
});

test('D7 deshacer: si la mesa ya se cobró completa (otra tablet), no hay a dónde devolver: se avisa y no se toca nada', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t);
  abiertaBase(t).estado = 'cerrada';                        // otra tablet cobró el resto
  assert.equal(await t.pos.deshacerUltimoCobro(), false);
  await asentar();
  assert.equal(t.pos.deshacerError, 'La cuenta de esa mesa ya se cobró completa: no hay a dónde devolver este cobro. Deshaz primero el cobro de la mesa.');
  assert.equal(cerradas(t).length, 2, 'el cobro parcial y la cuenta cerrada siguen ahí');
  assert.ok(t.supabase.de('ordenes', 'select').length >= 2, 'y se volvió a leer lo que hay en la base');
});

test('D8 deshacer: un doble toque deshace UNA vez (la base contesta «no existe» a la segunda); una vez deshecho, el cobro ya no se puede devolver', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t);
  const id = t.pos.ultimoCobro.ordenId;
  const [a, b] = await Promise.all([t.pos.devolverACuenta(id), t.pos.devolverACuenta(id)]);
  await asentar();
  assert.deepEqual([a, b], [true, false]);
  assert.equal(t.supabase.rpcs('deshacer_cobro').length, 1, 'un solo viaje a la base');
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA, 'las palomas volvieron UNA vez, no dos');
  assert.equal(await t.pos.devolverACuenta(id), false);
  assert.equal(t.pos.deshacerError, 'Ese cobro ya se había deshecho.');
  assert.deepEqual(t.base.deshechos, [id]);

  // Otra tablet lo deshizo antes (la base lo sabe, esta no): «no existe» se lee como «ya está deshecho» y se alinea.
  const u = await conCuenta();
  await cobrarUnidades(u);
  const idU = u.pos.ultimoCobro.ordenId;
  u.base.ordenes.delete(idU);
  lineaDe(abiertaBase(u), 'paloma').qty = 4; abiertaBase(u).total = TOTAL_CUENTA; abiertaBase(u).version = 9;
  assert.equal(await u.pos.deshacerUltimoCobro(), false);
  await asentar();
  assert.equal(u.pos.deshacerError, 'Ese cobro ya se había deshecho.');
  assert.equal(u.pos.ordenes.some((o) => o.id === idU), false, 'la orden cerrada fantasma sale de la lista');
  assert.equal(u.pos.totalOrdenActiva, TOTAL_CUENTA, 'y la cuenta se vuelve a leer: queda como la base');
});

test('D9 deshacer: sin red no hay aviso «Deshacer» ni botón; devolverACuenta dice que necesita la base y no llama a nadie', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t);
  const id = t.pos.ultimoCobro.ordenId;
  const orden = t.pos.ordenes.find((o) => o.id === id);
  t.pos.remoto = 'offline';
  assert.equal(t.pos.puedeDevolver(orden), false, 'el botón no aparece sin red');
  assert.equal(await t.pos.devolverACuenta(id), false);
  assert.match(t.pos.deshacerError, /Sin conexión: deshacer un cobro necesita la base/);
  assert.equal(t.supabase.rpcs('deshacer_cobro').length, 0);

  const sinRed = await conCuenta();
  sinRed.pos.remoto = 'offline';
  sinRed.base.red = false;
  sinRed.pos.toggleModoCobroParcial();
  sinRed.pos.toggleSeleccion(lineaDe(sinRed.pos.ordenActiva, 'sopa'));
  sinRed.pos.facturarParcial();
  await asentar();
  assert.equal(sinRed.pos.ultimoCobro, null, 'cobrar sin red NO deja el aviso «Deshacer»');
  assert.equal(sinRed.temporizadores.filter((h) => h.ms === 15000).length, 0);
});

test('D10 deshacer: espera a que el cobro llegue a la base ANTES de pedir que se deshaga (la orden cerrada tarda más que la llamada de deshacer)', async () => {
  const t = await conCuenta();
  const original = t.base.responder;
  t.base.responder = async (c) => {
    if (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert') await dormir(60);   // la subida del cobro va lenta
    return original(c);
  };
  t.pos.toggleModoCobroParcial();
  const linea = lineaDe(t.pos.ordenActiva, 'paloma');
  t.pos.toggleSeleccion(linea);
  t.pos.ajustarCantidadSeleccion(linea, -2);
  t.pos.facturarParcial();
  assert.equal(cerradas(t).length, 0, 'la orden cerrada todavía no llegó a la base');
  assert.equal(await t.pos.deshacerUltimoCobro(), true, 'deshacer espera a la subida y entonces sí encuentra el cobro');
  await asentar();
  assert.equal(t.pos.deshacerError, '');
  assert.equal(abiertaBase(t).total, TOTAL_CUENTA);
  assert.equal(cerradas(t).length, 0);
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA);
});

test('D11 deshacer: un cobro que NO llegó a la base (la subida falló) no se deshace desde la base: «todavía se está guardando», sin llamar a deshacer_cobro', async () => {
  const t = await conCuenta();
  t.base.fallar('upsert:ordenes');
  await cobrarUnidades(t);
  assert.ok(t.pos.ultimoCobro, 'el aviso aparece: la tablet no sabe aún que falló');
  assert.equal(await t.pos.deshacerUltimoCobro(), false);
  assert.equal(t.pos.deshacerError, 'El cobro todavía se está guardando. Espera unos segundos y vuelve a intentarlo.');
  assert.equal(t.supabase.rpcs('deshacer_cobro').length, 0);
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA - 9000, 'la cuenta quedó como estaba');
});

test('D12 deshacer TRANSITORIO: sin la columna `parcial_de` el cobro se sube igual (sin ella) y no hay «Deshacer»; sin la función `deshacer_cobro`, el primer intento lo descubre y lo apaga', async () => {
  const sinColumna = await conCuenta({ olaC: { aprobacion: true, mesas: true, ajustes: true, deshacer: false } });
  sinColumna.base.sinColumnas.add('ordenes.parcial_de');
  await cobrarUnidades(sinColumna);
  const subidas = sinColumna.supabase.de('ordenes', 'upsert').filter((c) => c.cuerpo.estado === 'cerrada');
  assert.equal(subidas.length, 2, 'primero con parcial_de, y al no existir la columna, otra vez sin ella');
  assert.ok('parcial_de' in subidas[0].cuerpo && !('parcial_de' in subidas[1].cuerpo));
  assert.equal(cerradas(sinColumna).length, 1, 'el cobro NO se perdió');
  assert.equal(cerradas(sinColumna)[0].total, 9000);
  assert.equal(sinColumna.pos.deshacerDisponible, false);
  assert.equal(sinColumna.pos.ultimoCobro, null, 'y el aviso «Deshacer» no se queda');
  assert.equal(sinPendientes(sinColumna.pos), true);
  sinColumna.pos.toggleModoCobroParcial();
  sinColumna.pos.toggleSeleccion(lineaDe(sinColumna.pos.ordenActiva, 'sopa'));
  sinColumna.pos.facturarParcial();
  await asentar();
  assert.equal(sinColumna.supabase.de('ordenes', 'upsert').filter((c) => c.cuerpo.estado === 'cerrada').length, 3, 'el siguiente cobro sube una sola vez, ya sin la columna');
  assert.equal(sinColumna.pos.ultimoCobro, null);
  assert.equal(sinColumna.supabase.rpcs('deshacer_cobro').length, 0);

  const sinFuncion = await conCuenta();
  sinFuncion.base.sinFuncion.add('deshacer_cobro');
  await cobrarUnidades(sinFuncion);
  assert.ok(sinFuncion.pos.ultimoCobro);
  assert.equal(await sinFuncion.pos.deshacerUltimoCobro(), false);
  assert.equal(sinFuncion.pos.deshacerDisponible, false);
  assert.equal(sinFuncion.pos.ultimoCobro, null);
  assert.match(sinFuncion.pos.deshacerError, /Falta aplicar en la base/);
  sinFuncion.pos.volverAMesas(); await sinFuncion.pos.abrirMesa(mesaDe(sinFuncion, 3));
  await cobrarUnidades(sinFuncion, 'sopa', 1);
  assert.equal(sinFuncion.pos.ultimoCobro, null, 'ya no ofrece «Deshacer»');
});

test('D13 deshacer: cobrar el resto de la mesa (o liberarla) quita el aviso: ya no hay cuenta abierta a la que devolver', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t);
  assert.ok(t.pos.ultimoCobro);
  t.pos.volverAMesas(); await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.facturar();
  // El aviso del cobro parcial se va (esa cuenta ya no está abierta) y el cobro COMPLETO deja el suyo: también se puede deshacer.
  assert.equal(t.pos.ultimoCobro.tipo, 'completo');
  assert.equal(t.pos.ultimoCobro.ordenId, 'o1');
  assert.equal(t.disparar(15000), 1, 'queda un solo temporizador de 15 s: el del cobro completo (el del parcial se canceló)');
  assert.equal(t.pos.ultimoCobro, null);
});

test('D14 deshacer: sin rol (o esperando aprobación) un cobro no deja aviso', async () => {
  const t = montar({ rol: null, acceso: 'pendiente', mesas: [mesaBase(3)] });
  t.pos.mesas = [mesaBase(3)];
  t.pos.ordenes = [{ id: 'o1', mesaId: 3, estado: 'abierta', items: [PALOMA(), SOPA()], total: TOTAL_CUENTA, version: 1 }];
  t.pos.mesaActiva = t.pos.mesas[0]; t.pos.ordenActiva = t.pos.ordenes[0];
  t.pos.seleccionCobro = true; t.pos.itemsSeleccionados = { sopa: 1 };
  t.pos.facturarParcial();
  assert.equal(t.pos.ultimoCobro, null);
  assert.equal(await t.pos.deshacerUltimoCobro(), false);
});

test('D15 deshacer: si el eco de Realtime llega ANTES que la respuesta de la base no se devuelve nada dos veces (el total queda exacto)', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t);
  const id = t.pos.ultimoCobro.ordenId;
  const original = t.base.responder;
  t.base.responder = async (c) => {
    const r = await original(c);
    if (c.tipo === 'rpc' && c.nombre === 'deshacer_cobro') {
      // Los dos ecos de la transacción (la cuenta abierta actualizada, la cobrada borrada) llegan antes que la respuesta.
      t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(abiertaBase(t))), old: { id: 'o1' } });
      t.pos.procesarCambioEnVivo('ordenes', { eventType: 'DELETE', new: {}, old: { id } });
    }
    return r;
  };
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await asentar();
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA, 'ni 39.000 por devolver dos veces ni menos');
  assert.equal(t.pos.ordenActiva.items.find((i) => i.id === 'paloma').qty, 4);
  assert.equal(t.pos.ordenes.some((o) => o.id === id), false);
  const relecturas = t.supabase.de('ordenes', 'select').filter((c) => c.filtros.some(([col]) => col === 'id'));
  assert.equal(relecturas.length, 1, 'y la cuenta se relee una vez (la base manda) y queda igual: no se devolvió nada de más');
  assert.deepEqual(t.consola.filter(([nivel, m]) => nivel === 'warn' && /no es el que dijo la base/.test(String(m))), [], 'el total coincide con el que dijo la base');
});

test('D16 deshacer: si llega el eco de la cuenta pero no el de la cobrada, el total que dice la base delata el doble conteo y la cuenta se vuelve a leer', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t);
  const original = t.base.responder;
  t.base.responder = async (c) => {
    const r = await original(c);
    if (c.tipo === 'rpc' && c.nombre === 'deshacer_cobro') {
      t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(abiertaBase(t))), old: { id: 'o1' } });
    }
    return r;
  };
  assert.equal(await t.pos.deshacerUltimoCobro(), true);
  await hastaQue(() => t.pos.totalOrdenActiva === TOTAL_CUENTA && !t.pos.ordenes.some((o) => o.estado === 'cerrada'));
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA, 'la lectura forzada corrigió el doble conteo');
  assert.equal(t.pos.ordenActiva.items.find((i) => i.id === 'paloma').qty, 4);
});

test('D17 deshacer: un rechazo de permisos de la base no deja un error de red; devolverACuenta de algo que no es un cobro parcial no llama a nadie', async () => {
  const t = await conCuenta();
  await cobrarUnidades(t);
  const id = t.pos.ultimoCobro.ordenId;
  t.base.fallar('rpc:deshacer_cobro');
  assert.equal(await t.pos.devolverACuenta(id), false);
  assert.match(t.pos.deshacerError, /Sin conexión: deshacer un cobro necesita la base/, 'un fallo que no es de permisos se cuenta como red');
  assert.equal(t.pos.totalOrdenActiva, TOTAL_CUENTA - 9000);
  assert.ok(t.pos.ordenes.some((o) => o.id === id), 'el cobro sigue donde estaba');
  t.base.repararTodo();

  const llamadas = t.supabase.rpcs('deshacer_cobro').length;
  const normal = { id: 'z1', mesaId: 3, estado: 'cerrada', items: [item('x', 1000)], total: 1000, cerradaEn: new Date().toISOString() };
  t.pos.ordenes.push(normal);
  assert.equal(t.pos.puedeDevolver(normal), true, 'una venta normal (cobro completo) también se devuelve: reabre o pasa a la cuenta de su mesa');
  t.pos.ordenes.pop();                                      // …pero una orden que aquí no existe no llama a nadie
  assert.equal(await t.pos.devolverACuenta('z1'), false);
  assert.equal(await t.pos.devolverACuenta('no-existe'), false);
  assert.equal(t.supabase.rpcs('deshacer_cobro').length, llamadas);
  assert.equal(await t.pos.devolverACuenta(id), true, 'y cuando la base contesta, se deshace');
});

// ═════════════════════════ E. Ticket configurable: ajustes y QR ═════════════════════════

const FILA_AJUSTES = { id: 1, ticket_qr_url: 'https://nuevo.example/menu', ticket_qr_visible: false, ticket_pie: 'Hasta pronto' };

test('E1 ajustes: al entrar lee la fila 1 (el QR, si se ve y el pie) y la guarda para el próximo arranque sin red; la base sin la tabla deja los de fábrica', async () => {
  const t = montar({ rol: 'mesero', ajustes: [FILA_AJUSTES] });
  await listo(t);
  assert.deepEqual(plano(t.pos.ajustes), { ticketQrUrl: 'https://nuevo.example/menu', ticketQrVisible: false, ticketPie: 'Hasta pronto' });
  assert.deepEqual(JSON.parse(t.almacen.get('pos_ajustes')), plano(t.pos.ajustes));
  const lectura = t.supabase.de('ajustes', 'select')[0];
  assert.deepEqual(lectura.filtros, [['id', 1, 'eq']]);

  const sinRed = montar({ rol: 'mesero', almacen: t.almacen });   // la misma tablet, recargada sin red
  sinRed.base.red = false;
  assert.equal(sinRed.pos.ajustes.ticketPie, 'Hasta pronto', 'los ajustes de la caché están desde el primer instante');
  await sinRed.pos.arrancarApp();
  assert.equal(sinRed.pos.ajustes.ticketPie, 'Hasta pronto');

  const vieja = montar({ olaC: { aprobacion: true }, rol: 'mesero' });   // sin la tabla `ajustes`
  await listo(vieja);
  assert.deepEqual(plano(vieja.pos.ajustes), { ticketQrUrl: URL_QR, ticketQrVisible: true, ticketPie: 'Gracias por su visita' });
  assert.equal(vieja.pos.ajustesError, '');
  assert.deepEqual(vieja.consola.filter(([nivel, mensaje]) => nivel === 'warn' && /ajustes/.test(String(mensaje))), [], 'no es un error: la tabla aún no existe');

  const rara = montar({ rol: 'mesero', ajustes: [{ id: 1, ticket_qr_url: 'http://inseguro.example', ticket_qr_visible: 'sí', ticket_pie: 'x'.repeat(200) }] });
  await listo(rara);
  assert.deepEqual(plano(rara.pos.ajustes), { ticketQrUrl: URL_QR, ticketQrVisible: true, ticketPie: 'Gracias por su visita' }, 'lo inválido vuelve al valor de fábrica, campo por campo');
});

test('E2 ajustes: guardarAjustes valida (https://, sin espacios, hasta 200; pie de 1 a 120), solo el admin, y manda solo las tres columnas', async () => {
  const t = montar({ rol: 'admin', ajustes: [{ ...FILA_AJUSTES, ticket_qr_visible: true }] });
  await listo(t);
  const llamadas = () => t.supabase.de('ajustes', 'update').length;

  for (const url of ['http://resplandor.ynt.codes/', 'resplandor.ynt.codes', 'https://con espacio.example', 'https://', 'ftp://x.example/a', `https://${'a'.repeat(201)}`, 'javascript:alert(1)']) {
    assert.equal(await t.pos.guardarAjustes({ ticketQrUrl: url }), false, url);
    assert.match(t.pos.ajustesError, /https:\/\//);
  }
  assert.equal(await t.pos.guardarAjustes({ ticketPie: '   ' }), false);
  assert.equal(t.pos.ajustesError, 'El mensaje del pie no puede quedar vacío.');
  assert.equal(await t.pos.guardarAjustes({ ticketPie: 'x'.repeat(121) }), false);
  assert.equal(t.pos.ajustesError, 'El mensaje del pie admite hasta 120 caracteres.');
  assert.equal(llamadas(), 0, 'nada de eso llegó a la base');
  assert.equal(t.pos.ajustesGuardados, false);

  assert.equal(await t.pos.guardarAjustes({ ticketQrUrl: '  https://resplandor.com.co/carta  ', ticketPie: ' Vuelva pronto ', ticketQrVisible: false }), true);
  assert.deepEqual(plano(t.supabase.de('ajustes', 'update').at(-1).cuerpo), { ticket_qr_url: 'https://resplandor.com.co/carta', ticket_qr_visible: false, ticket_pie: 'Vuelva pronto' }, 'solo esas tres columnas, ya limpias');
  assert.deepEqual(t.supabase.de('ajustes', 'update').at(-1).filtros, [['id', 1, 'eq']]);
  assert.deepEqual(plano(t.base.ajustes.get(1)), { id: 1, ticket_qr_url: 'https://resplandor.com.co/carta', ticket_qr_visible: false, ticket_pie: 'Vuelva pronto' });
  assert.deepEqual(plano(t.pos.ajustes), { ticketQrUrl: 'https://resplandor.com.co/carta', ticketQrVisible: false, ticketPie: 'Vuelva pronto' });
  assert.deepEqual(JSON.parse(t.almacen.get('pos_ajustes')), plano(t.pos.ajustes), 'y queda en la caché de la tablet');
  assert.equal(t.pos.ajustesError, '');
  assert.equal(t.pos.ajustesGuardados, true);
  assert.equal(t.disparar(4000), 1);
  assert.equal(t.pos.ajustesGuardados, false, '«Guardado» se apaga solo');

  assert.equal(await t.pos.guardarAjustes({ ticketQrVisible: true }), true, 'cambiar solo un campo deja los demás como están');
  assert.equal(t.pos.ajustes.ticketPie, 'Vuelva pronto');
  assert.equal(t.pos.ajustes.ticketQrUrl, 'https://resplandor.com.co/carta');
  assert.equal(t.pos.ajustes.ticketQrVisible, true);
});

test('E3 ajustes: el mesero no guarda (ni llama a la base); sin red o sin permiso en la base el valor NO cambia y el motivo queda en ajustesError', async () => {
  const mesero = montar({ rol: 'mesero', ajustes: [FILA_AJUSTES] });
  await listo(mesero);
  assert.equal(await mesero.pos.guardarAjustes({ ticketPie: 'otro' }), false);
  assert.equal(mesero.pos.ajustesError, 'Solo un admin puede cambiar los ajustes del ticket.');
  assert.equal(mesero.supabase.de('ajustes', 'update').length, 0);
  assert.equal(mesero.pos.ajustes.ticketPie, 'Hasta pronto');

  const t = montar({ rol: 'admin', ajustes: [FILA_AJUSTES] });
  await listo(t);
  t.base.red = false;
  assert.equal(await t.pos.guardarAjustes({ ticketPie: 'Sin red' }), false);
  assert.equal(t.pos.ajustesError, 'No se pudo guardar. Revisa la conexión e inténtalo de nuevo.');
  assert.equal(t.pos.ajustes.ticketPie, 'Hasta pronto', 'sin red no se muestra algo que la base nunca recibió');
  t.base.red = true;
  t.base.ajustes.clear();                                   // sin la fila 1 (o la RLS no la deja ver): cero filas actualizadas
  assert.equal(await t.pos.guardarAjustes({ ticketPie: 'Sin fila' }), false);
  assert.equal(t.pos.ajustes.ticketPie, 'Hasta pronto');
  assert.equal(t.pos.ajustesGuardados, false);

  const sinTabla = montar({ olaC: { aprobacion: true }, rol: 'admin' });
  await listo(sinTabla);
  assert.equal(await sinTabla.pos.guardarAjustes({ ticketPie: 'x' }), false);
  assert.equal(sinTabla.pos.ajustesError, 'Falta aplicar en la base la migración de los ajustes del ticket.');
});

// ───────────────────────── el QR ─────────────────────────

const LIBRERIA_QR_VERSION = '1.4.4';
const LIBRERIA_QR_RUTA = `assets/vendor/qrcode-generator-${LIBRERIA_QR_VERSION}.js`;
const LIBRERIA_QR_BYTES = fs.readFileSync(path.join(RAIZ, LIBRERIA_QR_RUTA));
const LIBRERIA = LIBRERIA_QR_BYTES.toString('utf8');
const ETIQUETA_QR = POS_HTML.match(/<script\b[^>]*qrcode-generator[^>]*><\/script>/s)?.[0] ?? '';

// El SVG estático de tarea/pos-pie (968bd77, en pos.html hasta la ola C): generado con el paquete `qrcode` (nivel M, versión 3, sin margen).

/** Un POS con la librería REAL del QR cargada en su mismo contexto (lo que hace la etiqueta <script> del <head>). */
async function conQr(opciones = {}) {
  const t = montar({ rol: 'admin', ...opciones });
  vm.runInContext(LIBRERIA, t.caja, { filename: LIBRERIA_QR_RUTA });
  assert.equal(typeof t.caja.qrcode, 'function');
  return t;
}

test('E4 QR: la etiqueta del <head> pide el archivo LOCAL de versión exacta (assets/vendor/), con `defer` (no frena la pantalla), sin host externo ni versión flotante', () => {
  assert.ok(ETIQUETA_QR, 'pos.html no pide la librería del QR');
  assert.match(ETIQUETA_QR, /\ssrc="assets\/vendor\/qrcode-generator-1\.4\.4\.js"/, 'ruta relativa a assets/vendor/, con la versión exacta en el nombre');
  assert.doesNotMatch(ETIQUETA_QR, /\/\/|https?:|cdnjs|latest|@\^|@~|\.x\b/, 'ni un host externo (cdnjs ya no) ni «latest» ni rangos');
  assert.doesNotMatch(ETIQUETA_QR, /\sintegrity=|\scrossorigin/, 'un archivo del propio sitio no lleva SRI ni CORS: la integridad la vigila el sha256 del README (pos-sin-cdn.test.mjs)');
  assert.match(ETIQUETA_QR, /\sdefer\b/);
  assert.ok(fs.existsSync(path.join(RAIZ, LIBRERIA_QR_RUTA)), `${LIBRERIA_QR_RUTA} existe`);
  const cabeza = POS_HTML.slice(0, POS_HTML.indexOf('</head>'));
  assert.ok(cabeza.includes(ETIQUETA_QR), 'va en el <head>');
  assert.equal((POS_HTML.match(/<script\b[^>]*qrcode-generator/g) || []).length, 1, 'una sola etiqueta (UNA librería)');
  assert.match(LIBRERIA, /Kazuhiko Arase[\s\S]*MIT license/, 'el archivo conserva el aviso de copyright y de la licencia MIT');
});

/** El contenido de un archivo dentro de un .tar (sin comprimir): cabeceras de 512 bytes, tamaño en octal. */
function archivoDeTar(tar, nombre) {
  for (let pos = 0; pos + 512 <= tar.length;) {
    const nom = tar.toString('utf8', pos, pos + 100).replace(/\0.*$/s, '');
    if (!nom) break;
    const tamano = parseInt(tar.toString('utf8', pos + 124, pos + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    if (nom === nombre) return tar.subarray(pos + 512, pos + 512 + tamano);
    pos += 512 + Math.ceil(tamano / 512) * 512;
  }
  return null;
}

// El archivo local es el original, no uno editado ni de otra versión. Con red: VERIFICAR_SRI=1 node --test scripts/pruebas/pos-ola-c.test.mjs
test('E5 QR: el archivo local es el `qrcode.js` del paquete de npm 1.4.4 (el tarball cumple el integrity del registro) y el sha512 que cdnjs publica para su `qrcode.js` (VERIFICAR_SRI=1, necesita red)', { skip: !process.env.VERIFICAR_SRI && 'se corre con VERIFICAR_SRI=1 (necesita red)' }, async () => {
  const sha512 = (buf) => 'sha512-' + createHash('sha512').update(buf).digest('base64');
  const meta = await (await fetch(`https://registry.npmjs.org/qrcode-generator/${LIBRERIA_QR_VERSION}`)).json();
  assert.equal(meta.version, LIBRERIA_QR_VERSION);
  const tarball = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
  assert.equal(sha512(tarball), meta.dist.integrity, 'el tarball que baja es el que el registro de npm dice (dist.integrity)');
  const dentro = archivoDeTar(zlib.gunzipSync(tarball), 'package/qrcode.js');
  assert.ok(dentro, 'package/qrcode.js está en el tarball');
  assert.ok(dentro.equals(LIBRERIA_QR_BYTES), `${LIBRERIA_QR_RUTA} no es, byte por byte, package/qrcode.js de qrcode-generator@${LIBRERIA_QR_VERSION} en npm`);
  const cdnjs = await (await fetch(`https://api.cdnjs.com/libraries/qrcode-generator/${LIBRERIA_QR_VERSION}`)).json();
  assert.equal(sha512(LIBRERIA_QR_BYTES), cdnjs.sri['qrcode.js'], 'y es el sha512 que cdnjs publica para su qrcode.js (segunda fuente, independiente de npm)');
});

test('E6 QR: el QR generado para https://resplandor.ynt.codes/ se LEE igual que el estático de pos-pie (misma versión 3, nivel M, mismo texto)', async () => {
  const t = await conQr();
  const svg = t.pos.qrTicketSvg;
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" aria-hidden="true" focusable="false" viewBox="0 0 29 29" shape-rendering="crispEdges"><path stroke="currentColor" d="M[^"]+"\/><\/svg>$/, 'el mismo formato que el estático: viewBox 29, módulos en currentColor');
  assert.doesNotMatch(svg, /<script|\son\w+=|javascript:/i, 'solo geometría');

  const nuevo = decodificarQr(matrizDeSvg(svg));
  const estatico = decodificarQr(matrizDeSvg(SVG_ESTATICO_POS_PIE));
  assert.equal(estatico.texto, URL_QR, 'el decodificador lee bien el estático (control)');
  assert.equal(nuevo.texto, estatico.texto, 'el nuevo dice lo mismo que el estático');
  assert.deepEqual([nuevo.version, nuevo.nivel], [estatico.version, estatico.nivel], 'misma versión y mismo nivel de corrección');
  assert.deepEqual([nuevo.version, nuevo.nivel], [3, 'M']);

  // Control con el paquete `qrcode` de la caché de npx (el que generó el estático), si está: lo mismo dice su matriz.
  const npx = path.join(os.homedir(), '.npm', '_npx');
  const paquete = fs.existsSync(npx) ? fs.readdirSync(npx).map((d) => path.join(npx, d, 'node_modules')).find((d) => fs.existsSync(path.join(d, 'qrcode'))) : null;
  if (paquete) {
    const q = createRequire(paquete + path.sep)('qrcode').create(URL_QR, { errorCorrectionLevel: 'M' });
    const matriz = Array.from({ length: q.modules.size }, (_, r) => Array.from({ length: q.modules.size }, (_, c) => !!q.modules.get(r, c)));
    assert.equal(decodificarQr(matriz).texto, nuevo.texto, 'el paquete `qrcode` de npx dice lo mismo');
    assert.deepEqual(matriz, matrizDeSvg(SVG_ESTATICO_POS_PIE), 'y su matriz ES la del estático (el estático sigue siendo el de `qrcode`)');
  }
});

test('E7 QR: cada dirección que el admin guarde se lee tal cual (incluida una larga o con tildes, que se codifica ya normalizada a ASCII); apagar el QR o quitar la librería deja el ticket SIN QR, sin romper', async () => {
  const t = await conQr({ ajustes: [{ id: 1, ticket_qr_url: URL_QR, ticket_qr_visible: true, ticket_pie: 'Gracias' }] });
  await listo(t);
  const largo = `https://resplandor.example/carta.html?mesa=12&token=${'abc123'.repeat(25)}`;
  for (const [url, esperado] of [
    ['https://resplandor.com.co/', 'https://resplandor.com.co/'],
    ['https://a.co', 'https://a.co/'],
    [largo, largo],
    ['https://ñandú.example/café?x=1', new URL('https://ñandú.example/café?x=1').href],
  ]) {
    assert.equal(await t.pos.guardarAjustes({ ticketQrUrl: url }), true, url);
    const svg = t.pos.qrTicketSvg;
    assert.notEqual(svg, '', url);
    assert.equal(decodificarQr(matrizDeSvg(svg)).texto, esperado, `el QR de ${url} se lee como ${esperado}`);
  }
  assert.equal(await t.pos.guardarAjustes({ ticketQrUrl: URL_QR }), true);
  const primero = t.pos.qrTicketSvg;
  assert.equal(t.pos.qrTicketSvg, primero, 'repintar no cambia nada');

  assert.equal(await t.pos.guardarAjustes({ ticketQrVisible: false }), true);
  assert.equal(t.pos.qrTicketSvg, '', 'el admin apagó el QR: el ticket sale sin él');
  assert.equal(await t.pos.guardarAjustes({ ticketQrVisible: true }), true);
  assert.equal(t.pos.qrTicketSvg, primero);

  delete t.caja.qrcode;                                     // la librería no cargó (el archivo no llegó)
  const sinLibreria = montar({ rol: 'admin' });
  assert.equal(sinLibreria.pos.qrTicketSvg, '', 'sin librería: ticket sin QR, sin lanzar');
  assert.equal(sinLibreria.pos.qrTicketHost, 'resplandor.ynt.codes');
  vm.runInContext(LIBRERIA, sinLibreria.caja);               // y si la librería llega después de pintar el ticket, la siguiente pintada ya lo muestra
  assert.notEqual(sinLibreria.pos.qrTicketSvg, '', 'no se queda pegado el «sin QR»');
  assert.equal(decodificarQr(matrizDeSvg(sinLibreria.pos.qrTicketSvg)).texto, URL_QR);
});

test('E8 QR: una librería rota, una dirección que no sirve o una que no cabe dejan el ticket SIN QR y sin lanzar (con una librería falsa)', () => {
  const t = montar({ rol: 'admin' });
  assert.equal(t.pos.qrTicketSvg, '', 'sin window.qrcode');
  t.caja.qrcode = () => { throw new Error('rota'); };
  assert.equal(t.pos.qrTicketSvg, '', 'una librería que lanza');
  t.caja.qrcode = () => ({ addData() { throw new Error('code length overflow'); }, make() {}, getModuleCount: () => 0, isDark: () => false });
  assert.equal(t.pos.qrTicketSvg, '', 'un texto que no cabe');

  // Una librería falsa pero bien portada: 3×3 con la diagonal oscura. El SVG sale de SUS módulos.
  const pedidos = [];
  t.caja.qrcode = (version, nivel) => {
    let texto = '';
    return { addData(x) { texto = x; pedidos.push({ version, nivel, texto: x }); }, make() {}, getModuleCount: () => 3, isDark: (r, c) => r === c };
  };
  assert.equal(t.pos.qrTicketSvg, '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" viewBox="0 0 3 3" shape-rendering="crispEdges"><path stroke="currentColor" d="M0 0.5h1M1 1.5h1M2 2.5h1"/></svg>');
  assert.deepEqual(pedidos, [{ version: 0, nivel: 'M', texto: URL_QR }], 'versión automática, corrección M, y la dirección de los ajustes');
  assert.equal(t.pos.qrTicketSvg.length > 0 && pedidos.length, 1, 'el segundo pintado reutiliza el resultado');

  t.pos.ajustes = { ...t.pos.ajustes, ticketQrUrl: 'http://no-seguro.example/' };
  assert.equal(t.pos.qrTicketSvg, '', 'una dirección que no es https:// nunca llega a la librería');
  assert.equal(pedidos.length, 1);
});

// ═════════════════════════ F. «+1 Paloma» y vibración ═════════════════════════

const prod = (id, nombre, precio = 4500) => ({ id, nombre, precio, cat: 'Platos' });

test('F1 agregado: tocar un producto deja «+1 Paloma»; varios toques seguidos se acumulan («+3 Paloma»); otro producto o pasar la ventana empieza de cero', async () => {
  const reloj = relojFalso();
  const t = await conCuenta({ reloj });
  assert.equal(t.pos.agregadoReciente, null);

  t.pos.agregarProducto(prod('paloma', 'Paloma'));
  assert.deepEqual(plano(t.pos.agregadoReciente), { nombre: 'Paloma', qty: 1, ts: reloj.ahora, van: 5 }, '«+1 Paloma · van 5»: lo que lleva la línea en el pedido');
  assert.equal(t.pos.agregadoTexto, '+1 Paloma');
  reloj.ahora += 600;
  t.pos.agregarProducto(prod('paloma', 'Paloma'));
  reloj.ahora += 600;
  t.pos.agregarProducto(prod('paloma', 'Paloma'));
  assert.equal(t.pos.agregadoReciente.qty, 3);
  assert.equal(t.pos.agregadoTexto, '+3 Paloma');
  assert.equal(t.pos.agregadoReciente.ts, reloj.ahora);

  reloj.ahora += 300;
  t.pos.agregarProducto(prod('limonada', 'Limonada', 7000));
  assert.equal(t.pos.agregadoTexto, '+1 Limonada', 'otro producto: cuenta nueva');
  reloj.ahora += 300;
  t.pos.agregarProducto(prod('paloma', 'Paloma'));
  assert.equal(t.pos.agregadoTexto, '+1 Paloma', 'volver a la paloma tras otro producto no suma a las anteriores');

  reloj.ahora += 3000;                                      // pasó la ventana
  t.pos.agregarProducto(prod('paloma', 'Paloma'));
  assert.equal(t.pos.agregadoTexto, '+1 Paloma', 'pasada la ventana empieza de cero');
  assert.equal(plano(t.pos.ordenActiva.items.find((i) => i.id === 'paloma')).qty, 4 + 1 + 1 + 1 + 1 + 1, 'y las unidades de la cuenta suman cada toque');

  assert.ok(t.temporizadores.some((h) => h.ms === 2200 && !h.cancelado), 'el aviso se apaga solo a los 2,2 s');
  t.disparar(2200);
  assert.equal(t.pos.agregadoReciente, null);
  assert.equal(t.pos.agregadoTexto, '');
});

test('F2 agregado: el aviso de un toque viejo no apaga al de uno nuevo; el producto con variante avisa al elegir la opción; el ítem manual también', async () => {
  const reloj = relojFalso();
  const t = await conCuenta({ reloj });
  t.pos.agregarProducto(prod('paloma', 'Paloma'));
  const primero = t.temporizadores.filter((h) => h.ms === 2200).at(-1);
  reloj.ahora += 1000;
  t.pos.agregarProducto(prod('paloma', 'Paloma'));
  assert.equal(primero.cancelado, true, 'el temporizador del primer toque se cancela al llegar el segundo');
  assert.equal(t.pos.agregadoTexto, '+2 Paloma');

  t.pos.agregarProducto({ id: 'ej2', nombre: 'Frijoles con proteína', precio: 19000, cat: 'Ejecutivos' });   // pide proteína
  assert.equal(t.pos.modalOpciones, true);
  assert.equal(t.pos.agregadoTexto, '+2 Paloma', 'aún no se agregó: falta elegir la proteína');
  t.pos.elegirOpcion('Proteína', 'Res');
  assert.equal(t.pos.agregadoTexto, '+1 Frijoles con proteína');

  t.pos.itemManualNombre = 'Postre'; t.pos.itemManualPrecio = '8000';
  t.pos.agregarItemManual();
  assert.equal(t.pos.agregadoTexto, '+1 Postre');
});

test('F3 vibrar: llama navigator.vibrate al agregar un producto; sin la API, o si lanza, no pasa nada', async () => {
  const toques = [];
  const t = await conCuenta({ extras: { navigator: { vibrate: (ms) => { toques.push(ms); return true; } } } });
  t.pos.agregarProducto(prod('paloma', 'Paloma'));
  assert.deepEqual(toques, [12], 'una vibración corta al tocar');
  assert.equal(t.pos.vibrar(30), true);
  assert.deepEqual(toques, [12, 30]);

  const sinApi = await conCuenta({ extras: { navigator: {} } });
  assert.equal(sinApi.pos.vibrar(), false);
  sinApi.pos.agregarProducto(prod('paloma', 'Paloma'));
  assert.equal(sinApi.pos.agregadoTexto, '+1 Paloma', 'agregar funciona igual sin vibración');

  const rota = await conCuenta({ extras: { navigator: { vibrate: () => { throw new Error('bloqueado'); } } } });
  assert.equal(rota.pos.vibrar(), false);
  rota.pos.agregarProducto(prod('paloma', 'Paloma'));
  assert.equal(rota.pos.ordenActiva.items.find((i) => i.id === 'paloma').qty, 5);

  const bloqueada = await conCuenta({ extras: { navigator: { vibrate: () => false } } });
  assert.equal(bloqueada.pos.vibrar(), false, 'el navegador la rechazó (sin toque previo): false, sin error');
});

test('F4 movimiento reducido: reducirMovimiento sigue a prefers-reduced-motion (la respuesta visual al tocar se apaga; no hay vibración que apagar)', () => {
  const con = montar({ extras: { matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) } });
  assert.equal(con.pos.reducirMovimiento, true);
  const sin = montar({ extras: { matchMedia: () => ({ matches: false }) } });
  assert.equal(sin.pos.reducirMovimiento, false);
  assert.equal(montar().pos.reducirMovimiento, false, 'sin matchMedia: false');
});

// ═════════════════════════ G. Contrato y compatibilidad ═════════════════════════

test('G1 contrato: el store define TODOS los nombres que C3 enlaza', async () => {
  const t = await listo(montar({ rol: 'admin' }));
  const estado = ['estadoAcceso', 'mesasPendiente', 'cartaPendiente', 'personalPendientes', 'personal', 'personalError', 'mesasAdmin', 'nfcEstado', 'mesasAdminError',
    'ultimoCobro', 'deshacerError', 'ajustes', 'ajustesError', 'ajustesGuardados', 'agregadoReciente', 'vista'];
  const getters = ['esperaAprobacion', 'numPendientes', 'nfcDisponible', 'qrTicketSvg'];
  const metodos = ['aprobarPersonal', 'eliminarPersonal', 'altaPersonal', 'bajaPersonal', 'cambiarRolPersonal', 'cargarMesasAdmin', 'crearMesa', 'editarMesa', 'activarMesa',
    'copiarEnlace', 'escribirPegatina', 'revisarPegatina', 'cancelarNfc', 'deshacerUltimoCobro', 'puedeDevolver', 'devolverACuenta', 'cargarAjustes', 'guardarAjustes', 'vibrar', 'puede'];
  for (const n of [...estado, ...getters, ...metodos]) assert.ok(n in t.pos, `falta ${n} en el store`);
  for (const n of metodos) assert.equal(typeof t.pos[n], 'function', `${n} es una función`);
  for (const n of getters) assert.ok(Object.getOwnPropertyDescriptor(t.pos, n)?.get, `${n} es un getter`);
  assert.deepEqual(plano(t.pos.ajustes), { ticketQrUrl: URL_QR, ticketQrVisible: true, ticketPie: 'Gracias por su visita' });
  assert.equal(t.pos.estadoAcceso, 'aprobado');
});

test('G2 contrato: lo nuevo nunca usa alert() ni confirm() nativos (avisos y confirmaciones van dentro de la página)', () => {
  const cuerpo = (nombre) => {
    const i = STORE.search(new RegExp(`^ {12}(?:async\\s+)?${nombre}\\(`, 'm'));
    assert.ok(i !== -1, `no encontré ${nombre} en el store`);
    const j = STORE.slice(i + 1).search(/^ {12}(?:async\s+|get\s+)?[A-Za-z_$][\w$]*\(.*\) \{$/m);
    return STORE.slice(i, j === -1 ? undefined : i + 1 + j).replace(/\/\/.*$/gm, '');
  };
  for (const n of ['_arrancarEspera', '_cargarVistaPendiente', 'aprobarPersonal', 'eliminarPersonal', 'escucharPersonal', 'procesarCambioPersonal', 'cargarMesasAdmin', '_gestionarMesa',
    'crearMesa', 'editarMesa', 'activarMesa', 'copiarEnlace', 'cancelarNfc', 'escribirPegatina', 'revisarPegatina', '_marcarPegatina', 'cargarAjustes', 'guardarAjustes',
    '_registrarUltimoCobro', 'deshacerUltimoCobro', 'devolverACuenta', '_deshacerCobro', '_devolverLocal', '_releerOrden', '_anotarAgregado', 'vibrar', 'irA']) {
    assert.doesNotMatch(cuerpo(n), /\b(?:alert|confirm|prompt)\(/, `${n} no debe usar alert(), confirm() ni prompt()`);
  }
});

test('G3 contrato: sin la base nueva (ola B) todo sigue como antes: cobrar por partes y por monto, sin «Deshacer», sin espera, ajustes de fábrica', async () => {
  const t = montar({ olaC: false, rol: 'admin', mesas: [mesaBase(3)], ordenes: [ordenBase('o1', 3, [PALOMA(), SOPA()], 1)] });
  t.base.sinColumnas.add('ordenes.parcial_de');            // la tabla de antes de la ola C no tiene la columna
  await listo(t);
  await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(lineaDe(t.pos.ordenActiva, 'sopa'));
  t.pos.facturarParcial();
  await asentar();
  assert.equal(cerradas(t).length, 1, 'el cobro por partes funciona');
  assert.equal(cerradas(t)[0].total, 12000);
  assert.equal(t.pos.ultimoCobro, null, 'la base ya rechazó parcial_de (columna inexistente): sin «Deshacer»');
  assert.equal(t.pos.deshacerDisponible, false);
  t.pos.volverAMesas(); await t.pos.abrirMesa(mesaDe(t, 3));
  t.pos.montoAbono = '2000';
  assert.equal(t.pos.cobrarMonto(), true);
  await asentar();
  assert.equal(cerradas(t).length, 2);
  assert.equal(t.pos.totalOrdenActiva, 4 * 4500 - 2000);
  assert.equal(t.pos.esperaAprobacion, false);
  assert.deepEqual(plano(t.pos.ajustes), { ticketQrUrl: URL_QR, ticketQrVisible: true, ticketPie: 'Gracias por su visita' });
});

test('G4 salida: cerrar la sesión suelta la espera, las solicitudes, el aviso de deshacer y el panel de mesas', async () => {
  const t = montar({ rol: null, acceso: 'pendiente', mesas: [mesaBase(3)] });
  await t.pos.arrancarApp();
  assert.equal(t.pos.mesasPendiente.length, 1);
  t.pos._alSalirLaSesion();
  assert.equal(t.pos.estadoAcceso, null);
  assert.deepEqual(plano(t.pos.mesasPendiente), []);
  assert.deepEqual(plano(t.pos.cartaPendiente), []);
  assert.equal(t.intervalos.filter((i) => i.ms === 30000).every((i) => i.limpio), true, 'el reloj de espera se apagó');

  const admin = await conCuenta();
  await cobrarUnidades(admin);
  await admin.pos.cargarMesasAdmin();
  assert.ok(admin.pos.ultimoCobro && admin.pos.mesasAdmin.length > 0 && admin.pos.numPendientes >= 0);
  admin.pos._alSalirLaSesion();
  assert.equal(admin.pos.ultimoCobro, null);
  assert.deepEqual(plano(admin.pos.mesasAdmin), []);
  assert.deepEqual(plano(admin.pos.personalPendientes), []);
  assert.equal(admin.disparar(15000), 0, 'y su temporizador de 15 s se canceló');
});
