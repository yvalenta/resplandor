// «Cierre del día» solo de hoy, el aviso de «ayer quedó sin cerrar» y el panel de cierres del admin (pedido de Yonatan, 2026-10-05,
// tareas/2026-10-05-cierres-de-hoy-y-panel-admin.md: «transacciones del turno deben ser de hoy y debe haber un aviso sutil que diga que no se ha
// cerrado el día de ayer y pueda dejar de ser visto; poder tener un panel para cierres diarios, modificar cierres y demás, modo admin solo para admin»).
// La base real (migración 20261006100000) la prueba migracion-cierres-de-hoy.test.mjs; aquí, el POS.
//
//   1. ESTÁTICA (siempre): el marcado del aviso, de la ventana de confirmación y del panel; las RPC con sus argumentos; el panel es de admin.
//   2. LÓGICA, el <script> REAL del POS en un `vm` contra la base falsa de _pos-vm.mjs (que modela cerrar_dia_de, cierre_corregir_nota y cierre_anular):
//      «Transacciones del turno» y los KPIs son de HOY en Bogotá (la venta de las 23:30 de ayer no; la de las 00:10 de hoy sí); el aviso (ayer, o «El lun 28»,
//      y «y N días más»), que lo ven todos y «Cerrar» solo el admin; «Ocultar» por día y que vuelve; cerrar hoy cierra solo lo de hoy; cerrar ayer cierra solo lo de
//      ayer, con la fecha de ayer y aunque haya una cuenta abierta; el admin firma lo que ve; una base sin la migración cierra como antes; el panel: nota, rastro,
//      anular (el cierre se queda, tachado, y las ventas vuelven por cerrar), todo del admin y nada del mesero.
//   3. EN NAVEGADOR (solo si hay Playwright y Chromium; arnés _pos-simulado.mjs, reloj fijo en el miércoles 2026-09-30): el aviso a 390 y a 1280 px (una línea
//      discreta, sin desborde, «Ocultar» lo esconde y se queda así tras recargar), «Cerrar ayer» abre la ventana de ESE día y cierra solo lo de ayer, el mesero ve el
//      aviso sin «Cerrar ayer», el panel desde la tarjeta de Administración (abrir un cierre, corregir la nota, ver el rastro, anular con motivo), y sin errores de consola.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asentar, crearBaseFalsa, crearPos, fechaBogotaFalsa, haceMin, hastaQue, item, mesaBase, ordenBase, plano,
} from './_pos-vm.mjs';
import { buscarPlaywright } from './_navegador.mjs';
import { servirPos, nuevoContexto, abrirPos } from './_pos-simulado.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');

// ───────────────────────── 1. estática ─────────────────────────

test('la vista de cierre trae el aviso discreto con «Cerrar» (solo admin) y «Ocultar», y no se imprime', () => {
  const i = POS.indexOf('data-aviso="sin-cerrar"');
  assert.ok(i > 0, 'el aviso existe');
  const bloque = POS.slice(POS.lastIndexOf('<div', i), POS.indexOf('<!-- KPIs: bento grid', i));
  assert.match(bloque, /class="sin-cerrar print:hidden"/);
  assert.match(bloque, /x-show="\$store\.pos\.avisoSinCerrar"/);
  assert.match(bloque, /role="status"/);
  assert.match(bloque, /data-accion="cerrar-dia-pasado" x-show="\$store\.pos\.puede\('cierre_dia'\)"/, '«Cerrar ayer» solo para quien puede cerrar el día');
  assert.match(bloque, /@click="\$store\.pos\.cerrarDiaPasado\(\$store\.pos\.avisoSinCerrar\.dia\)/);
  assert.match(bloque, /data-accion="ocultar-aviso" @click="\$store\.pos\.ocultarAvisoSinCerrar\(\)">Ocultar</);
  assert.ok(i < POS.indexOf('<h2 class="font-display">Transacciones del turno</h2>'), 'el aviso va arriba de la lista');
});

test('«Transacciones del turno», el contador y los KPIs salen de ordenesHoy (solo hoy); el vacío dice «de hoy»', () => {
  assert.match(POS, /get ordenesHoy\(\) \{ const hoy = this\.diaHoy; return this\.ordenesPorCerrar\.filter\(o => diaDeVenta\(o\) === hoy\); \}/);
  assert.match(POS, /get totalHoy\(\) \{ return this\.ordenesHoy\.reduce/);
  assert.match(POS, /<template x-for="orden in \$store\.pos\.ordenesHoy" :key="orden\.id">/);
  assert.match(POS, /Aún no hay ventas de hoy/);
  assert.match(POS, /return fechaBogota\(\);/, 'el día de hoy es el de Bogotá, no el del aparato');
  assert.match(POS, /new Intl\.DateTimeFormat\('en-US', \{ timeZone: 'America\/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' \}\)/);
});

test('la ventana de confirmación sabe de qué día es: título, texto, y las cuentas abiertas solo frenan el cierre de HOY', () => {
  const i = POS.indexOf('MODAL: CONFIRMAR CIERRE');
  const modal = POS.slice(i, POS.indexOf('▲ PARTE productos-y-modales', i));
  assert.match(modal, /'Confirmar cierre del ' \+ \$store\.pos\.cierreDiaTxt : 'Confirmar cierre del día'/);
  assert.match(modal, /x-show="\$store\.pos\.ordenesAbiertas\.length > 0 && !\$store\.pos\.cierreEsDePasado"/);
  assert.match(modal, /:disabled="\(\$store\.pos\.ordenesAbiertas\.length > 0 && !\$store\.pos\.cierreEsDePasado\) \|\| !!\$store\.pos\.razonSinCierre/);
  assert.match(modal, /el cierre queda con la fecha de ese día y las de hoy no se tocan/);
  assert.match(modal, /Esta base todavía cierra todas las ventas por cerrar juntas/);
});

test('el panel de cierres es una vista de Administración solo para el admin: puede(\'cierres_admin\'), irA lo exige, la tarjeta de Cierres lo ofrece', () => {
  assert.match(POS, /case 'catalogo_borrar': case 'menu_semanal': case 'cierre_dia': case 'cierres_admin':/, 'cierres_admin es de las acciones de solo admin');
  assert.match(POS, /'cierres-admin': 'cierres_admin' \}\[vista\];/, 'irA exige el permiso');
  assert.match(POS, /else if \(vista === 'cierres-admin'\) this\.cargarCierresAdmin\(\);/);
  assert.match(POS, /<section x-show="\$store\.pos\.vista === 'cierres-admin' && \$store\.pos\.puede\('cierres_admin'\)" x-cloak/);
  assert.match(POS, /\$store\.pos\.accionTablero\('panel-cierres'\)">[\s\S]{0,200}Panel de cierres/);
  assert.match(POS, /case 'panel-cierres':\s*return this\.irA\('cierres-admin'\);/);
  const i = POS.indexOf('data-vista="cierres-admin"');
  const panel = POS.slice(i, POS.indexOf('▲ PARTE cierres-admin :: vista', i));
  for (const hueco of ['data-accion="guardar-nota"', 'data-accion="anular"', 'data-accion="confirmar-anular"', 'data-accion="sacar-venta"', 'data-bloque="rastro"', 'data-bloque="por-cerrar"']) {
    assert.ok(panel.includes(hueco), `el panel trae ${hueco}`);
  }
  assert.match(panel, /Los totales salen de las ventas: no se editan a mano/);
  assert.doesNotMatch(panel, /type="number"|x-model="total/, 'no hay ningún campo para editar un total');
  assert.match(panel, /\.cierresAdminDisponible/, 'avisa si falta la migración');
  assert.match(panel, /<textarea class="field"[^>]*maxlength="500"/);
  assert.match(panel, /class="field" :id="'motivo-' \+ c\.id" maxlength="300"/);
});

test('el POS llama a las tres RPC nuevas con sus argumentos y a `cierres_cambios` solo para leer', () => {
  assert.match(POS, /supabaseClient\.rpc\('cerrar_dia_de', \{ p_id: id, p_dia: this\.diaDelCierre, p_esperado: this\._esperadoCierre\(\) \}\)/);
  assert.match(POS, /supabaseClient\.rpc\('cierre_corregir_nota', \{ p_cierre_id: cierre\.id, p_nota: nota \}\)/);
  assert.match(POS, /supabaseClient\.rpc\('cierre_anular', \{ p_cierre_id: cierre\.id, p_motivo: m \}\)/);
  const usos = [...POS.matchAll(/from\('cierres_cambios'\)\s*\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(usos, ['select'], 'del rastro solo se lee');
  assert.doesNotMatch(POS, /formatCierre\(c\) \{[^}]*(nota|anulado)/, 'formatCierre no manda nota ni anulación: el UPDATE directo no las admite');
});

test('el aviso y el panel no tocan tokens: sus colores salen de los tintes de siempre', () => {
  const i = POS.indexOf('/* ▼ PARTE cierres-admin :: css */');
  const css = POS.slice(i, POS.indexOf('/* ▲ PARTE cierres-admin :: css */', i));
  assert.match(css, /\.sin-cerrar \{[^}]*background: var\(--pos-tinte-barro\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(/, 'ningún color suelto: todo por token');
  assert.doesNotMatch(css, /opacity/, 'ni texto con opacidad');
  assert.doesNotMatch(css, /:hover/, 'ni :hover (el panel es táctil)');
});

// ───────────────────────── 2. la lógica del POS (vm) ─────────────────────────

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const HOY = fechaBogotaFalsa(new Date());
const dia = (n) => fechaBogotaFalsa(new Date(Date.now() - n * 86400000));
const AYER = dia(1);
const ANTEAYER = dia(2);
/** Una hora de ese día en Bogotá, como ISO. */
const a = (d, hhmm) => new Date(`${d}T${hhmm}:00-05:00`).toISOString();
const PAN = () => ({ id: 'pan', nombre: 'Pan', precio: 3000, qty: 1, nota: '' });
const venta = (id, mesa, items, cuando) => ({ ...ordenBase(id, mesa, items, 2, 'cerrada'), cerrada_en: cuando, abierta_en: new Date(Date.parse(cuando) - 1800000).toISOString() });
const libre = (id) => mesaBase(id, { estado: 'libre' });

function montar({ rol = 'admin', mesas = [libre(1), libre(2), libre(3)], ordenes = [], cierres = [], olaC = true, almacen } = {}) {
  const base = crearBaseFalsa({ rol, mesas, ordenes, cierres, olaC });
  const reales = { setTimeout, clearTimeout };
  const t = crearPos({
    base,
    almacen,
    extras: {
      setInterval() { return 1; }, clearInterval() {},
      setTimeout(fn, ms, ...resto) { if (ms >= 1500) { const h = { fn, ms, unref() { return h; } }; return h; } return reales.setTimeout(fn, ms, ...resto); },
      clearTimeout(h) { if (h && typeof h === 'object') return; reales.clearTimeout(h); },
    },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  t.base = base; t.pos.usuario = YO;
  return t;
}
async function listo(t) {
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  if (t.pos.esAdmin) await hastaQue(() => t.pos._personalCargado);
  await asentar();
  return t;
}
const ids = (lista) => [...lista.map((o) => o.id)].sort();

test('«Transacciones del turno» y los KPIs son solo de HOY en Bogotá: la de las 23:30 de ayer (ya de hoy en UTC) no entra y la de las 00:10 de hoy sí', async () => {
  const t = montar({ ordenes: [
    venta('hoy-1', 1, [item('p', 30000)], haceMin(20)),
    venta('hoy-madrugada', 2, [PAN()], a(HOY, '00:10')),
    venta('ayer-noche', 3, [item('q', 9000)], a(AYER, '23:30')),
    venta('ayer-tarde', 1, [item('r', 12000)], a(AYER, '15:00')),
  ] });
  await listo(t);
  assert.equal(t.pos.diaHoy, HOY);
  assert.deepEqual(ids(t.pos.ordenesHoy), ['hoy-1', 'hoy-madrugada']);
  assert.equal(t.pos.totalHoy, 33000);
  assert.equal(t.pos.ticketPromedioHoy, 16500);
  assert.equal(t.pos.ordenesPorCerrar.length, 4, 'las de ayer siguen por cerrar: no se pierden ni se archivan solas');
  assert.deepEqual(plano(t.pos.diasSinCerrar).map((d) => [d.dia, d.n, d.total]), [[AYER, 2, 21000]], 'las dos de ayer, en UN día');
});

test('una venta sin hora de cierre cuenta por su hora de apertura; una sin ninguna hora legible se queda en el turno de hoy', async () => {
  const sinCierre = { ...venta('sin-cierre', 1, [PAN()], a(AYER, '12:00')), cerrada_en: null, abierta_en: a(AYER, '11:00') };
  const sinHora = { ...venta('sin-hora', 2, [PAN()], a(AYER, '12:00')), cerrada_en: null, abierta_en: 'no es una hora' };
  const t = montar({ ordenes: [sinCierre, sinHora] });
  await listo(t);
  assert.deepEqual(ids(t.pos.ordenesHoy), ['sin-hora']);
  assert.deepEqual(plano(t.pos.diasSinCerrar).map((d) => d.ids), [['sin-cierre']]);
});

test('el aviso: «Ayer (dom 4)» con cuántas ventas y cuánto; si no es ayer, «El …» y «y N días más»; lo ven todos y sin ventas viejas no hay aviso', async () => {
  const t = montar({ rol: 'mesero', ordenes: [
    venta('hoy-1', 1, [PAN()], haceMin(10)),
    venta('a1', 2, [item('x', 10000)], a(AYER, '13:00')),
    venta('a2', 3, [item('y', 5000)], a(AYER, '20:00')),
  ] });
  await listo(t);
  const aviso = plano(t.pos.avisoSinCerrar);
  assert.ok(aviso, 'un mesero también lo ve');
  assert.match(aviso.quien, /^Ayer \((lun|mar|mié|jue|vie|sáb|dom) \d{1,2}\)$/);
  assert.equal(aviso.esAyer, true);
  assert.equal(aviso.n, 2);
  assert.equal(aviso.total, 15000);
  assert.equal(aviso.mas, 0);
  assert.equal(aviso.accion, 'Cerrar ayer');
  assert.equal(t.pos.puedeCerrarDiaPasado, false, 'pero «Cerrar» no es del mesero');
  assert.equal(t.pos.cerrarDiaPasado(AYER), false);
  assert.equal(t.avisos.length, 1, 'y le dice que es del admin');
  assert.equal(t.pos.modalConfirmCierre, false);
  // tres días sin cerrar: la línea es del más reciente y dice cuántos más
  const u = montar({ ordenes: [
    venta('a1', 2, [PAN()], a(AYER, '13:00')),
    venta('b1', 2, [PAN()], a(ANTEAYER, '13:00')),
    venta('c1', 2, [PAN()], a(dia(4), '13:00')),
  ] });
  await listo(u);
  assert.equal(u.pos.avisoSinCerrar.mas, 2);
  assert.equal(u.pos.diasSinCerrar.length, 3);
  assert.deepEqual(plano(u.pos.diasSinCerrar).map((d) => d.dia), [AYER, ANTEAYER, dia(4)], 'del más reciente al más viejo');
  const w = montar({ ordenes: [venta('b1', 2, [PAN()], a(ANTEAYER, '13:00'))] });
  await listo(w);
  assert.match(w.pos.avisoSinCerrar.quien, /^El (lun|mar|mié|jue|vie|sáb|dom) \d{1,2}$/);
  assert.match(w.pos.avisoSinCerrar.accion, /^Cerrar el /);
  assert.equal(montar({ ordenes: [venta('h', 1, [PAN()], haceMin(5))] }).pos.avisoSinCerrar, null, 'sin días anteriores no hay aviso');
});

test('«Ocultar» se guarda por día en localStorage: no vuelve en la misma jornada ni al recargar, y vuelve mañana si sigue sin cerrar', async () => {
  const almacen = new Map();
  const t = montar({ almacen, ordenes: [venta('a1', 2, [PAN()], a(AYER, '13:00'))] });
  await listo(t);
  assert.ok(t.pos.avisoSinCerrar);
  t.pos.ocultarAvisoSinCerrar();
  assert.equal(t.pos.avisoSinCerrar, null);
  assert.equal(almacen.get('pos_aviso_sin_cerrar_oculto'), HOY);
  // recargar la página (el mismo almacén): sigue oculto
  const otra = montar({ almacen, ordenes: [venta('a1', 2, [PAN()], a(AYER, '13:00'))] });
  await listo(otra);
  assert.equal(otra.pos.avisoSinCerrar, null, 'sigue oculto tras recargar');
  assert.equal(otra.pos.diasSinCerrar.length, 1, 'pero el día sigue sin cerrar (el panel lo lista)');
  // «mañana»: el día en que se ocultó ya no es hoy
  otra.pos.avisoOcultoEn = dia(1);
  assert.ok(otra.pos.avisoSinCerrar, 'vuelve al día siguiente');
  // sin almacenamiento: se oculta igual mientras la página siga abierta
  const sin = montar({ ordenes: [venta('a1', 2, [PAN()], a(AYER, '13:00'))] });
  await listo(sin);
  sin.caja.localStorage.setItem = () => { throw new Error('cuota'); };
  sin.pos.ocultarAvisoSinCerrar();
  assert.equal(sin.pos.avisoSinCerrar, null);
});

test('«Cerrar día» cierra SOLO lo de hoy: la RPC va con p_dia = hoy y las ventas de hoy; las de ayer siguen por cerrar', async () => {
  const t = montar({ ordenes: [venta('hoy-1', 1, [item('p', 30000)], haceMin(20)), venta('ayer-1', 2, [PAN()], a(AYER, '13:00'))] });
  await listo(t);
  assert.equal(t.pos.puedesCerrar, true);
  t.pos.abrirConfirmarCierre();
  assert.equal(t.pos.cierreEsDePasado, false);
  assert.deepEqual(plano(t.pos.cierreVista), { n: 1, total: 30000 });
  assert.equal(await t.pos.cerrarDia(), 'ok');
  const llamada = t.base.llamadasCierre.at(-1);
  assert.equal(llamada.nombre, 'cerrar_dia_de');
  assert.equal(llamada.dia, HOY);
  assert.deepEqual(plano(llamada.esperado), { n: 1, total: 30000, ids: ['hoy-1'] });
  assert.deepEqual([...t.base.cierres.values()][0].transacciones.map((x) => x.id), ['hoy-1']);
  assert.deepEqual([...t.base.ordenes.keys()], ['ayer-1']);
  await asentar();
  assert.equal(t.pos.puedesCerrar, false, 'hoy ya no tiene nada por cerrar');
  assert.equal(t.pos.diasSinCerrar.length, 1, 'ayer sigue ahí, en su aviso');
});

test('«Cerrar ayer» abre la ventana de ESE día y cierra solo lo de ayer, con la fecha de ayer, aunque haya una cuenta abierta hoy; lo de hoy no se toca', async () => {
  const t = montar({ mesas: [libre(1), libre(2), mesaBase(3)], ordenes: [
    venta('hoy-1', 1, [item('p', 30000)], haceMin(20)),
    venta('ayer-1', 2, [item('x', 10000)], a(AYER, '13:00')),
    venta('ayer-2', 1, [item('y', 5000)], a(AYER, '23:45')),
    ordenBase('abierta-3', 3, [PAN()], 1),
  ] });
  await listo(t);
  assert.equal(t.pos.cerrarDiaPasado(AYER), true);
  assert.equal(t.pos.modalConfirmCierre, true);
  assert.equal(t.pos.cierreDia, AYER);
  assert.equal(t.pos.cierreEsDePasado, true);
  assert.match(t.pos.cierreDiaTxt, /^(lun|mar|mié|jue|vie|sáb|dom) \d{1,2} [a-zñ]{3,4}$/);
  assert.deepEqual(plano(t.pos.cierreVista), { n: 2, total: 15000 }, 'la ventana enseña lo de ayer, no lo de hoy');
  assert.equal(t.pos.ordenesAbiertas.length, 1, 'hay una cuenta abierta');
  assert.equal(await t.pos.cerrarDia(), 'ok', 'y no frena el cierre de ayer');
  const llamada = t.base.llamadasCierre.at(-1);
  assert.equal(llamada.dia, AYER);
  assert.deepEqual(plano(llamada.esperado), { n: 2, total: 15000, ids: ['ayer-1', 'ayer-2'] });
  const cierre = [...t.base.cierres.values()][0];
  assert.deepEqual(cierre.transacciones.map((x) => x.id).sort(), ['ayer-1', 'ayer-2']);
  assert.equal(cierre.fecha, new Date(`${AYER}T23:59:59-05:00`).toISOString(), 'la fecha del cierre es el final de ayer en Bogotá');
  assert.deepEqual([...t.base.ordenes.keys()].sort(), ['abierta-3', 'hoy-1']);
  assert.equal(t.pos.modalConfirmCierre, false);
  assert.equal(t.pos.cierreDia, null, 'la ventana vuelve a ser la de hoy');
  assert.equal(t.pos.cierreEsDePasado, false);
  await asentar();
  assert.equal(t.pos.diasSinCerrar.length, 0);
  assert.deepEqual(plano(t.pos.cierres).map((c) => c.id), [cierre.id], 'el cierre entra al historial');
  assert.equal(t.pos.avisoSinCerrar, null);
  // cerrar HOY con la cuenta abierta sí lo frena (la regla de siempre)
  assert.equal(await t.pos.cerrarDia(), 'hay_abiertas');
});

test('el admin firma lo que ve: si otra tablet vendió algo de ayer mientras tanto, la base dice `cambio` con SU resumen de ese día y, firmándolo, cierra con todo', async () => {
  const t = montar({ ordenes: [venta('ayer-1', 2, [item('x', 10000)], a(AYER, '13:00'))] });
  await listo(t);
  t.pos.cerrarDiaPasado(AYER);
  // la otra tablet cobró otra venta de ayer, que esta no vio
  t.base.ordenes.set('ayer-2', venta('ayer-2', 1, [item('y', 5000)], a(AYER, '18:00')));
  assert.equal(await t.pos.cerrarDia(), 'cambio');
  assert.equal(t.pos.cierreCambio, true);
  assert.deepEqual(plano(t.pos.cierreVista), { n: 2, total: 15000 });
  assert.equal(t.pos.cierreEsDePasado, true, 'sigue siendo el cierre de ayer');
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.deepEqual([...t.base.cierres.values()][0].transacciones.map((x) => x.id).sort(), ['ayer-1', 'ayer-2']);
});

test('sin ventas de ese día la base dice sin_ventas: la ventana se cierra, se explica y no se inventa un cierre', async () => {
  const t = montar({ ordenes: [venta('ayer-1', 2, [PAN()], a(AYER, '13:00'))] });
  await listo(t);
  t.pos.cerrarDiaPasado(AYER);
  await t.base.responder({ tipo: 'rpc', nombre: 'cerrar_dia_de', args: { p_id: 'K-otro', p_dia: AYER, p_esperado: { n: 1, total: 3000, ids: ['ayer-1'] } } });   // otra tablet lo cerró
  assert.equal(await t.pos.cerrarDia(), 'sin_ventas');
  assert.equal(t.pos.modalConfirmCierre, false);
  assert.equal(t.pos.cierreDia, null);
  assert.equal(t.base.cierres.size, 1);
});

test('una base SIN la migración: «Cerrar día» cierra como antes (todas las ventas por cerrar, con `cerrar_dia`), la ventana lo dice y «Cerrar ayer» no se ofrece', async () => {
  const t = montar({ olaC: { deshacer: true }, ordenes: [venta('hoy-1', 1, [item('p', 30000)], haceMin(20)), venta('ayer-1', 2, [PAN()], a(AYER, '13:00'))] });
  await listo(t);
  assert.equal(t.pos.puedeCerrarDiaPasado, true, 'mientras no se sepa, se intenta');
  t.pos.abrirConfirmarCierre();
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.deepEqual(t.base.llamadasCierre.map((l) => l.nombre), ['cerrar_dia'], 'cerrar_dia_de no existe (PGRST202): se siguió por cerrar_dia');
  assert.deepEqual([...t.base.cierres.values()][0].transacciones.map((x) => x.id).sort(), ['ayer-1', 'hoy-1'], 'como antes: lo cerró todo junto');
  assert.equal(t.pos._sinCerrarDiaDe, true);
  assert.equal(t.pos.puedeCerrarDiaPasado, false);
  await asentar();
  // un día pasado, sin la migración: se explica y no cierra nada
  t.base.ordenes.set('ayer-2', venta('ayer-2', 1, [PAN()], a(AYER, '19:00')));
  await t.pos.sincronizarSupabase();
  t.pos.cerrarDiaPasado(AYER);
  assert.equal(t.pos.modalConfirmCierre, false);
  assert.match(t.pos.aviso.texto, /Falta aplicar la migración 20261006100000/);
});

test('con la base sin la migración, la ventana de «cerrar hoy» avisa que entran también las de días anteriores', async () => {
  const t = montar({ olaC: { deshacer: true }, ordenes: [venta('hoy-1', 1, [PAN()], haceMin(5)), venta('ayer-1', 2, [PAN()], a(AYER, '13:00'))] });
  await listo(t);
  t.pos._sinCerrarDiaDe = true;
  t.pos.abrirConfirmarCierre();
  assert.equal(t.pos.cierreViejoAlcance, true);
  assert.deepEqual(plano(t.pos.cierreVista), { n: 2, total: 6000 }, 'la ventana enseña lo que de verdad se va a cerrar');
});

test('el mesero no ve el panel ni puede entrar, ni corregir ni anular (la base también lo niega)', async () => {
  const t = montar({ rol: 'mesero', cierres: [{ id: 'k1', fecha: a(AYER, '23:59'), total_ventas: 3000, total_ordenes: 1, transacciones: [{ id: 'v1', mesaId: 1, total: 3000, items: [PAN()] }] }] });
  await listo(t);
  assert.equal(t.pos.puede('cierres_admin'), false);
  assert.equal(t.pos.irA('cierres-admin'), false);
  assert.notEqual(t.pos.vista, 'cierres-admin');
  assert.equal(await t.pos.corregirNotaCierre(t.pos.cierres[0], 'hola'), false);
  assert.equal(await t.pos.anularCierre(t.pos.cierres[0], 'por error'), false);
  assert.equal(t.avisos.length, 2, 'cada intento avisa que es del admin');
  assert.equal(t.base.cierresCambios.length, 0);
  // y aunque la pantalla estuviera desactualizada, la base lo niega
  const r = await t.base.responder({ tipo: 'rpc', nombre: 'cierre_anular', args: { p_cierre_id: 'k1', p_motivo: 'por error' } });
  assert.equal(r.data.codigo, 'no_autorizado');
});

const CIERRE_AYER = () => ({ id: 'k1', fecha: a(AYER, '23:59'), total_ventas: 13000, total_ordenes: 2, transacciones: [
  { id: 'v1', mesaId: 1, estado: 'cerrada', items: [item('p', 10000)], total: 10000, abiertaEn: a(AYER, '12:00'), cerradaEn: a(AYER, '13:00'), version: 2 },
  { id: 'v2', mesaId: 2, estado: 'cerrada', items: [PAN()], total: 3000, abiertaEn: a(AYER, '18:00'), cerradaEn: a(AYER, '19:00'), version: 2 },
] });

test('el panel (admin): se abre desde irA, lista los cierres, la nota se corrige sin tocar un peso y queda en el rastro con quién y qué', async () => {
  const t = montar({ cierres: [CIERRE_AYER()] });
  await listo(t);
  assert.equal(t.pos.puede('cierres_admin'), true);
  assert.equal(t.pos.irA('cierres-admin'), true);
  await asentar();
  assert.equal(t.pos.vista, 'cierres-admin');
  assert.equal(t.pos.cierres.length, 1);
  assert.equal(t.pos.cierresAdminDisponible, true);
  assert.match(t.pos.etiquetaCierre(t.pos.cierres[0]), /^(lun|mar|mié|jue|vie|sáb|dom) \d{1,2} [a-zñ]{3,4}$/);
  t.pos.abrirCierreAdmin(t.pos.cierres[0]);
  await asentar();
  assert.equal(t.pos.cierreAbiertoAdmin, 'k1');
  assert.deepEqual(plano(t.pos.cambiosDeCierre.k1.filas), [], 'sin cambios anotados todavía');
  const antes = t.pos.cierres[0].total;
  assert.equal(await t.pos.corregirNotaCierre(t.pos.cierres[0], '  Faltó la propina de la mesa 2  '), true);
  await asentar();
  assert.equal(t.pos.cierres[0].nota, 'Faltó la propina de la mesa 2');
  assert.equal(t.pos.cierres[0].total, antes, 'el total no se movió');
  assert.equal(t.base.cierres.get('k1').total_ventas, 13000);
  const filas = plano(t.pos.cambiosDeCierre.k1.filas);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].accion, 'nota');
  assert.equal(filas[0].quien, 'yo@ejemplo.test');
  assert.match(filas[0].texto, /^Nota: «Faltó la propina de la mesa 2»$/);
  // quitarla
  assert.equal(await t.pos.corregirNotaCierre(t.pos.cierres[0], ''), true);
  await asentar();
  assert.equal(t.pos.cierres[0].nota, '');
  assert.equal(plano(t.pos.cambiosDeCierre.k1.filas)[0].texto, 'Se quitó la nota');
  // demasiado larga: ni se manda
  const llamadas = t.supabase.rpcs('cierre_corregir_nota').length;
  assert.equal(await t.pos.corregirNotaCierre(t.pos.cierres[0], 'x'.repeat(501)), false);
  assert.match(t.pos.cierresAdminError, /hasta 500/);
  assert.equal(t.supabase.rpcs('cierre_corregir_nota').length, llamadas);
});

test('anular: exige un motivo, el cierre se queda (tachado, con quién y por qué) y sus ventas vuelven por cerrar con el día que tenían', async () => {
  const t = montar({ cierres: [CIERRE_AYER()] });
  await listo(t);
  t.pos.irA('cierres-admin'); await asentar();
  assert.equal(await t.pos.anularCierre(t.pos.cierres[0], 'ab'), false);
  assert.match(t.pos.cierresAdminError, /por qué se anula/);
  assert.equal(t.supabase.rpcs('cierre_anular').length, 0, 'sin motivo ni se llama');
  assert.equal(await t.pos.anularCierre(t.pos.cierres[0], '  Lo cerré con el día equivocado  '), true);
  await asentar();
  const c = t.pos.cierres[0];
  assert.ok(c.anuladoEn);
  assert.equal(c.anuladoMotivo, 'Lo cerré con el día equivocado');
  assert.equal(c.anuladoPor, 'yo@ejemplo.test');
  assert.equal(c.ordenes.length, 2, 'sus ventas siguen en el cierre (nada se borra)');
  assert.equal(c.total, 13000);
  assert.deepEqual(ids(t.pos.ordenesPorCerrar), ['v1', 'v2'], 'las ventas volvieron por cerrar');
  assert.deepEqual(plano(t.pos.diasSinCerrar).map((d) => [d.dia, d.n, d.total]), [[AYER, 2, 13000]], 'y aparecen en el aviso de su día');
  assert.equal(t.pos.avisoSinCerrar.n, 2);
  assert.match(t.pos.aviso.texto, /Cierre anulado\. Sus 2 ventas volvieron a las ventas por cerrar/);
  assert.deepEqual(plano(t.pos.cambiosDeCierre.k1.filas).map((f) => [f.accion, f.motivo]), [['anulado', 'Lo cerré con el día equivocado']]);
  // un cierre anulado ya no cuenta: ni en la última cifra de Administración ni en el gráfico ni como «archivadas»
  assert.equal(t.pos.tableroCierre.ultimo, null);
  assert.equal(t.pos.sparklineCierres, '');
  // no se puede anular dos veces, ni editar, ni corregir su nota
  assert.equal(await t.pos.anularCierre(c, 'otra vez más'), false);
  assert.match(t.pos.cierresAdminError, /ya estaba anulado/);
  assert.equal(await t.pos.corregirNotaCierre(c, 'x'), false);
  assert.match(t.pos.cierresAdminError, /está anulado/);
  t.pos.abrirEditorTransaccion(c.ordenes[0], c);
  assert.equal(t.pos.modalEditarTransaccion, false, 'su editor no se abre');
  assert.match(t.pos.aviso.texto, /está anulado/);
  // y el día se cierra otra vez, bien
  assert.equal(t.pos.cerrarDiaPasado(AYER), true);
  assert.equal(await t.pos.cerrarDia(), 'ok');
  assert.equal(t.base.cierres.size, 2);
  assert.equal(t.base.ordenes.size, 0);
});

test('una tablet con el historial atrasado edita (o «guarda» sin cambiar nada) un cierre que otro admin ya anuló: la base lo rechaza (RS006), el POS avisa, vuelve a leer el historial y no queda «sin respaldo»', async () => {
  const t = montar({ cierres: [CIERRE_AYER()] });
  await listo(t);
  const k1 = t.pos.cierres.find((c) => c.id === 'k1');
  assert.equal(k1.anuladoEn, null, 'esta tablet aún lo tiene vigente');
  // otra tablet (otro admin) anula el cierre; `cierres` no va por Realtime, así que esta copia no se entera
  const an = await t.base.responder({ tipo: 'rpc', nombre: 'cierre_anular', args: { p_cierre_id: 'k1', p_motivo: 'lo cerré con la fecha mal' } });
  assert.equal(an.data.ok, true, JSON.stringify(an));
  assert.equal(t.pos.cierres.find((c) => c.id === 'k1').anuladoEn, null, 'sigue atrasada');
  assert.deepEqual([...t.base.ordenes.keys()].sort(), ['v1', 'v2'], 'las ventas están libres en la base');
  // «Editar» y guardar sin cambiar nada: el mismo contenido de siempre en el upsert
  t.pos.recalcularYSubirCierre(k1);
  await hastaQue(() => t.pos.aviso && /ese cierre ya estaba anulado/.test(t.pos.aviso.texto));
  await hastaQue(() => t.pos.cierres.find((c) => c.id === 'k1').anuladoEn);
  await asentar(30);
  const despues = t.pos.cierres.find((c) => c.id === 'k1');
  assert.ok(despues.anuladoEn, 'la tablet volvió a leer el historial: el cierre sale anulado');
  assert.notEqual(despues.sync, 'error', 'y no queda «sin respaldo»');
  assert.equal(t.pos.cambiosSinSubir, 0);
  assert.deepEqual([...t.base.ordenes.keys()].sort(), ['v1', 'v2'], 'las ventas liberadas siguen libres');
  assert.deepEqual(ids(t.pos.ordenesPorCerrar), ['v1', 'v2'], 'y por cerrar en el POS');
});

test('anular con una mesa que ya no existe: la base no cambia nada y el POS lo dice con la mesa; sin red no se intenta', async () => {
  const k = CIERRE_AYER();
  k.transacciones[1].mesaId = 77;
  const t = montar({ cierres: [k] });
  await listo(t);
  assert.equal(await t.pos.anularCierre(t.pos.cierres[0], 'prueba de mesa'), false);
  assert.match(t.pos.cierresAdminError, /la mesa 77 de sus ventas ya no existe/);
  assert.equal(t.pos.cierres[0].anuladoEn, null);
  assert.equal(t.base.cierres.get('k1').anulado_en ?? null, null);
  assert.equal(t.base.ordenes.size, 0);
  t.base.red = false; t.pos.remoto = 'offline';
  const n = t.supabase.rpcs('cierre_anular').length;
  assert.equal(await t.pos.anularCierre(t.pos.cierres[0], 'sin red'), false);
  assert.match(t.pos.cierresAdminError, /Sin conexión/);
  assert.equal(t.supabase.rpcs('cierre_anular').length, n);
});

test('una base sin la migración: el panel avisa que falta, los errores son claros y el POS no se rompe', async () => {
  const t = montar({ olaC: { deshacer: true }, cierres: [CIERRE_AYER()] });
  await listo(t);
  assert.equal(t.pos.cierresAdminDisponible, false, 'las filas de cierres no traen anulado_en');
  assert.equal(t.pos.puedeCerrarDiaPasado, false);
  t.pos.irA('cierres-admin'); await asentar();
  assert.equal(await t.pos.corregirNotaCierre(t.pos.cierres[0], 'hola'), false);
  assert.match(t.pos.cierresAdminError, /Falta aplicar la migración 20261006100000/);
  t.pos.abrirCierreAdmin(t.pos.cierres[0]); await asentar();
  assert.match(t.pos.cambiosDeCierre.k1.error, /Falta aplicar la migración 20261006100000/);
});

test('el rastro se cuenta en una línea por cada acción (y no inventa lo que no hay)', () => {
  const t = montar();
  const f = (r) => t.pos.textoCambioCierre(r);
  assert.match(f({ accion: 'cierre', despues: { n: 3, total: 45000 } }), /^Se cerró el día: 3 ventas · \$ 45\.000$/);
  assert.match(f({ accion: 'cierre', despues: { n: 1, total: 9000 } }), /^Se cerró el día: 1 venta · /);
  assert.equal(f({ accion: 'nota', despues: { nota: 'hola' } }), 'Nota: «hola»');
  assert.equal(f({ accion: 'nota', despues: { nota: null } }), 'Se quitó la nota');
  assert.equal(f({ accion: 'anulado', motivo: 'error de día' }), 'Se anuló el cierre: error de día');
  assert.match(f({ accion: 'venta_sacada', antes: { total: 35000 }, despues: { total: 15000 }, detalle: { sacadas: [{ mesaId: 2, total: 20000 }] } }),
    /^Se sacó la venta de la Mesa 2 · \$ 20\.000: el cierre pasó de \$ 35\.000 a \$ 15\.000$/);
  assert.match(f({ accion: 'venta_sacada', antes: { total: 3 }, despues: { total: 1 }, detalle: { sacadas: [{ mesa_id: 4, total: 1 }, { mesa_id: 5, total: 1 }] } }), /Mesa 4 .* y 1 más/);
  assert.match(f({ accion: 'edicion', detalle: { editadas: [{ antes: { total: 10000 }, despues: { mesaId: 1, total: 11000 } }] } }), /^Se editó la venta de la Mesa 1: de \$ 10\.000 a \$ 11\.000$/);
  assert.equal(f({ accion: 'edicion', antes: { total: 2 }, despues: { total: 2 } }), 'Se cambió el cierre');
});

// ───────────────────────── 3. en navegador ─────────────────────────

const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
let navegador = null;
let servidor = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});

// El reloj fijo del arnés: miércoles 2026-09-30, 13:30 en Bogotá. «Ayer» es el martes 29: las ventas de ayer, sin cerrar, y el cierre del 29 a las 22:10 no
// existe en estos datos (el arnés trae cierres del 29 y el 28: se quitan para que ayer quede SIN cerrar).
const conAyerSinCerrar = (d) => {
  d.olaC = true;
  d.tablas.cierres = d.tablas.cierres.filter((c) => c.id !== 'cierre-ayer');
  const h = (hhmm, dia) => `${dia}T${hhmm}:00-05:00`;
  const venta = (id, mesa, hora, items) => ({ id, mesa_id: mesa, estado: 'cerrada', items, total: items.reduce((s, i) => s + i.precio * i.qty, 0), abierta_en: h('12:00', '2026-09-29'), cerrada_en: h(hora, '2026-09-29'), version: 2 });
  d.tablas.ordenes.push(
    venta('ord-ayer-1', 4, '13:25', [{ id: 'pf1', nombre: 'Bandeja del patio', precio: 46000, qty: 2, nota: '' }]),
    venta('ord-ayer-2', 1, '21:15', [{ id: 'pf2', nombre: 'Churrasco 250 g', precio: 52000, qty: 1, nota: '' }]),
  );
  // las dos cuentas abiertas de hoy (mesas 3 y 6) siguen ahí: no frenan el cierre de ayer
};
const comoMesero = (d) => { conAyerSinCerrar(d); d.rol = 'mesero'; };

async function abrir(t, ancho, vista, ajustar = conAyerSinCerrar) {
  let ultimo = null;
  for (let intento = 0; intento < 2; intento++) {
    let ctx = null;
    try {
      servidor ||= await servirPos(RAIZ, 0);
      navegador ||= await pw.chromium.launch();
      ctx = await nuevoContexto(navegador, { ancho, alto: ancho < 768 ? 844 : 900, movil: ancho < 768 });
      contextos.push(ctx);
      const page = await ctx.newPage();
      page.setDefaultTimeout(90000);
      const { diag } = await abrirPos(page, { url: servidor.url, vista, ajustar });
      return { page, diag, ctx };
    } catch (e) { ultimo = e; await ctx?.close().catch(() => {}); }
  }
  t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(ultimo.message).split('\n')[0]}`);
  return null;
}
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const textoDe = (page, sel) => page.locator(sel).first().innerText();
const erroresDe = (diag) => diag.errores.filter((e) => !/Failed to load resource|fonts\.g/i.test(String(e)));

for (const ancho of [390, 1280]) {
  test(`a ${ancho} px: «Transacciones del turno» es solo de hoy y el aviso de ayer es UNA línea discreta, sin desborde; «Ocultar» lo esconde y no vuelve al recargar`, { skip: SALTAR }, async (t) => {
    const r = await abrir(t, ancho, 'cierre');
    if (!r) return;
    const { page, diag } = r;
    // lo de hoy: las tres ventas del arnés; lo de ayer, en el aviso
    assert.equal(await page.locator('.history-row .fila-tx').count(), 3, 'solo las tres de hoy');
    assert.match(await textoDe(page, '.chip:has-text(" hoy")'), /^3 hoy$/);
    const aviso = page.locator('[data-aviso="sin-cerrar"]');
    assert.equal(await aviso.isVisible(), true);
    const texto = (await aviso.innerText()).replace(/\s+/g, ' ');
    assert.match(texto, /^Ayer \(mar 29\) quedó sin cerrar: 2 ventas · \$ 144\.000 Cerrar ayer Ocultar$/);
    // discreto: poco alto (una línea de texto y, en teléfono, la de los botones) y dentro de la pantalla
    const caja = await aviso.boundingBox();
    assert.ok(caja.height <= (ancho < 640 ? 130 : 64), `el aviso mide ${caja.height} px: no es discreto`);
    assert.ok(caja.x >= 0 && caja.x + caja.width <= ancho + 0.5, 'cabe en el ancho');
    assert.equal(await sinDesborde(page), 0, 'sin desborde horizontal');
    // el total de hoy NO suma lo de ayer: 3 ventas de hoy
    assert.equal(await page.evaluate(() => Alpine.store('pos').totalHoy), 98000 + 81000 + 151000, 'el total de hoy no suma lo de ayer ($ 144.000)');
    // «Ocultar»
    await page.locator('[data-accion="ocultar-aviso"]').click();
    await aviso.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => localStorage.getItem('pos_aviso_sin_cerrar_oculto')), '2026-09-30');
    await page.reload();
    await page.waitForFunction(() => window.Alpine && Alpine.store('pos') && Alpine.store('pos').remoto === 'ok' && Alpine.store('pos').diasSinCerrar.length === 1);
    assert.equal(await aviso.isVisible(), false, 'tras recargar sigue oculto');
    assert.equal(await page.evaluate(() => Alpine.store('pos').diasSinCerrar.length), 1, 'pero el día sigue sin cerrar');
    assert.deepEqual(erroresDe(diag), [], 'sin errores de consola');
  });
}

test('«Cerrar ayer» abre la ventana de ESE día (con su total) y cierra solo lo de ayer, con la fecha de ayer; las cuentas abiertas de hoy no lo frenan', { skip: SALTAR }, async (t) => {
  const r = await abrir(t, 390, 'cierre');
  if (!r) return;
  const { page, diag } = r;
  await page.locator('[data-aviso="sin-cerrar"] [data-accion="cerrar-dia-pasado"]').click();
  const modal = page.locator('.modal:has-text("Confirmar cierre del")');
  await modal.waitFor();
  const cabecera = (await modal.locator('h2').innerText()).trim();
  assert.match(cabecera, /^Confirmar cierre del mar 29 sept?$/);
  const cuerpo = (await modal.locator('.modal-body').innerText()).replace(/\s+/g, ' ');
  assert.match(cuerpo, /Se registrarán 2 órdenes con un total de \$ 144\.000/);
  assert.match(cuerpo, /el cierre queda con la fecha de ese día y las de hoy no se tocan/);
  assert.doesNotMatch(cuerpo, /mesa\(s\) abiertas sin cobrar/, 'las cuentas abiertas de hoy no frenan el cierre de ayer');
  assert.equal(await modal.locator('button.btn-primary').isDisabled(), false);
  assert.equal(await sinDesborde(page), 0);
  await modal.locator('button.btn-primary').click();
  await page.waitForFunction(() => !Alpine.store('pos').modalConfirmCierre && Alpine.store('pos').diasSinCerrar.length === 0);
  const estado = await page.evaluate(() => {
    const sim = window.__posSim;
    const cierre = sim.tablas.cierres.find((c) => c.id !== 'cierre-anteayer');
    return { cierre: { fecha: cierre.fecha, total: cierre.total_ventas, n: cierre.total_ordenes }, ordenes: sim.tablas.ordenes.map((o) => o.id).sort(), rpcs: sim.llamadas.filter((l) => l.tipo === 'rpc' && /cerrar_dia/.test(l.nombre)).map((l) => [l.nombre, l.args.p_dia]) };
  });
  assert.deepEqual(estado.cierre, { fecha: '2026-09-30T04:59:59.000Z', total: 144000, n: 2 }, 'la fecha del cierre es el final de ayer en Bogotá');
  assert.deepEqual(estado.rpcs, [['cerrar_dia_de', '2026-09-29']]);
  assert.ok(!estado.ordenes.includes('ord-ayer-1') && !estado.ordenes.includes('ord-ayer-2'), 'lo de ayer salió de las ventas');
  assert.ok(['ord-hoy-1', 'ord-hoy-2', 'ord-hoy-3', 'ord-abierta-3', 'ord-abierta-6'].every((id) => estado.ordenes.includes(id)), 'lo de hoy y las cuentas abiertas no se tocaron');
  assert.equal(await page.locator('[data-aviso="sin-cerrar"]').isVisible(), false, 'el aviso se fue');
  assert.deepEqual(erroresDe(diag), []);
});

test('el mesero ve el aviso pero no «Cerrar ayer»; no hay tarjeta ni panel de cierres', { skip: SALTAR }, async (t) => {
  const r = await abrir(t, 390, 'cierre', comoMesero);
  if (!r) return;
  const { page, diag } = r;
  const aviso = page.locator('[data-aviso="sin-cerrar"]');
  assert.equal(await aviso.isVisible(), true);
  assert.equal(await page.locator('[data-accion="cerrar-dia-pasado"]').count() ? await page.locator('[data-accion="cerrar-dia-pasado"]').first().isVisible() : false, false);
  assert.match((await aviso.innerText()).replace(/\s+/g, ' '), /Ayer \(mar 29\) quedó sin cerrar: 2 ventas/);
  assert.equal(await page.evaluate(() => Alpine.store('pos').irA('cierres-admin')), false);
  assert.equal(await page.locator('[data-vista="cierres-admin"]').isVisible(), false);
  assert.deepEqual(erroresDe(diag), []);
});

for (const ancho of [390, 1280]) {
  test(`a ${ancho} px: el panel de cierres (desde la tarjeta de Administración): abrir un cierre, corregir la nota, ver el rastro y anular con motivo; sin desborde ni errores`, { skip: SALTAR }, async (t) => {
    const r = await abrir(t, ancho, 'admin', (d) => { conAyerSinCerrar(d); d.tablas.cierres = d.tablas.cierres.map((c) => ({ ...c })); });
    if (!r) return;
    const { page, diag } = r;
    await page.locator('[data-tarjeta="cierres"] button:has-text("Panel de cierres")').click();
    const panel = page.locator('[data-vista="cierres-admin"]');
    await panel.waitFor();
    // los días sin cerrar, arriba
    const porCerrar = panel.locator('[data-bloque="por-cerrar"]');
    assert.equal(await porCerrar.isVisible(), true);
    assert.match((await porCerrar.innerText()).replace(/\s+/g, ' '), /mar 29.*2 ventas · \$ 144\.000/);
    // un cierre: el del 28 (el único que tiene el arnés)
    const fila = panel.locator('[data-cierre="cierre-anteayer"]');
    await fila.waitFor();
    await fila.locator('.cierre-admin-cab').click();
    await fila.locator('[data-bloque="rastro"]').waitFor();
    assert.match(await fila.locator('[data-bloque="rastro"]').innerText(), /Sin cambios anotados para este cierre/);
    // la nota
    await fila.locator('textarea').fill('Faltó la propina de la mesa 2');
    await fila.locator('[data-accion="guardar-nota"]').click();
    await fila.locator('.cambio-fila').first().waitFor();
    assert.match((await fila.locator('.cambio-fila').first().innerText()).replace(/\s+/g, ' '), /^Nota: «Faltó la propina de la mesa 2»/);
    assert.equal(await fila.locator('.chip:has-text("Con nota")').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__posSim.tablas.cierres.find((c) => c.id === 'cierre-anteayer').total_ventas), 76000, 'la nota no tocó un peso');
    // no hay dónde editar un total
    assert.equal(await fila.locator('input[type="number"]').count(), 0);
    // sus ventas, con «Sacar o editar» (el editor de siempre)
    assert.equal(await fila.locator('[data-venta]').count(), 2);
    assert.equal(await sinDesborde(page), 0, 'sin desborde con el cierre abierto');
    // anular: pide motivo
    await fila.locator('[data-accion="anular"]').click();
    const confirmar = fila.locator('[data-accion="confirmar-anular"]');
    assert.equal(await confirmar.isDisabled(), true, 'sin motivo no se puede');
    await fila.locator('input[type="text"]').fill('Lo cerré con el día equivocado');
    assert.equal(await confirmar.isDisabled(), false);
    assert.equal(await sinDesborde(page), 0);
    await confirmar.click();
    await fila.locator('.chip:has-text("Anulado")').waitFor();
    assert.equal(await fila.locator('[data-accion="anular"]').isVisible(), false, 'un cierre anulado no se anula otra vez');
    assert.equal(await fila.locator('textarea').isVisible(), false);
    assert.match((await fila.locator('.cambio-fila').first().innerText()).replace(/\s+/g, ' '), /^Se anuló el cierre: Lo cerré con el día equivocado/);
    // sus ventas volvieron: el día 28 aparece entre los días sin cerrar
    assert.equal(await page.evaluate(() => Alpine.store('pos').diasSinCerrar.map((d) => d.dia).join()), '2026-09-29,2026-09-28');
    assert.equal(await sinDesborde(page), 0);
    assert.deepEqual(erroresDe(diag), []);
  });
}
