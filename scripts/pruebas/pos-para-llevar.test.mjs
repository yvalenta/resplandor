// «Para llevar» en el POS (pedido de Yonatan, 2026-10-02): «qué pasa si piden algo para llevar, debería haber un ítem no obligatorio
// para identificar si es para llevar el producto, no el pedido completo… pero también el pedido completo». Sin migración. Diseño y
// tabla de decisiones de cada recorrido que itera ítems: docs/para-llevar.md.
//
//   · POR PRODUCTO: el token «Para llevar» al final de la BASE de la nota de la línea («Sopa · Pollo · Para llevar — Persona 2 (Camila)»);
//     se alterna con actualizar_nota_item, conserva persona y variante, y «1 aquí y 1 para llevar» del mismo plato son dos líneas.
//   · PEDIDO COMPLETO: una línea de $0 con id fijo `para_llevar` puesta y quitada con aplicar_delta_orden; no es un producto: fuera de
//     «N ítem(s)», de dividir por persona, de los cobros por unidades y de los abonos, y una cuenta que solo la tiene no se cobra.
//
// Tres partes, como pos-personas-botones.test.mjs:
//   A. ESTÁTICA (corre siempre): el marcado de pos.html.
//   B. LÓGICA (corre siempre): el <script> real de pos.html en un `vm` (_pos-vm.mjs) con una base falsa.
//   C. EN NAVEGADOR (solo con Playwright y un Chromium, si no se salta con el motivo): el arnés con Supabase simulado (_pos-simulado.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { asentar, crearBaseFalsa, crearPos, dormir, hastaQue, item, mesaBase, ordenBase, ordenLocal, plano } from './_pos-vm.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const sinComentariosHtml = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ');

// ═════════════════════════ A. estática: el marcado ═════════════════════════

const seccionOrden = (() => {
  const i = POS.indexOf(`<section x-show="$store.pos.vista === 'orden'"`);
  const f = POS.indexOf('<!-- ▲ PARTE orden -->');
  assert.ok(i !== -1 && f > i, 'no encontré la sección de la orden');
  return sinComentariosHtml(POS.slice(i, f));
})();

test('estática: el interruptor «Agregar para llevar» junto al buscador es un switch con nombre, estado y bolsa en SVG en línea', () => {
  const buscador = seccionOrden.slice(seccionOrden.indexOf('class="buscador-carta"'), seccionOrden.indexOf('<!-- Categories -->'));
  assert.match(buscador, /<button type="button" class="btn-alterna btn-llevar-agregar" role="switch"/);
  assert.match(buscador, /:aria-checked="String\(\$store\.pos\.agregarLlevar\)" aria-label="Agregar para llevar"/);
  assert.match(buscador, /@click="\$store\.pos\.alternarAgregarLlevar\(\)"/);
  assert.match(buscador, /x-show="!\$store\.pos\.pedidoParaLlevar"/, 'con «Todo para llevar» puesto el interruptor no hace falta');
  assert.match(buscador, /<svg viewBox="0 0 24 24"[^>]*aria-hidden="true">/);
  assert.doesNotMatch(buscador.slice(buscador.indexOf('btn-llevar-agregar'), buscador.indexOf('</button>', buscador.indexOf('btn-llevar-agregar'))), /data-lucide/, 'la lista cambia con Realtime y lucide no se vuelve a correr: SVG en línea');
});

test('estática: cada línea trae su pastilla «Para llevar» (con bolsa, aparte de la variante) y su control, y ninguno sale con «Todo para llevar»', () => {
  assert.match(seccionOrden, /<div class="nota-item nota-llevar" x-show="\$store\.pos\.llevarDe\(item\) && !\$store\.pos\.pedidoParaLlevar"[^>]*>\s*<svg[^>]*aria-hidden="true">[\s\S]*?<\/svg>\s*<span>Para llevar<\/span>/);
  assert.match(seccionOrden, /<button type="button" class="btn-enlace btn-enlace-llevar" x-show="item\.precio >= 0 && !\$store\.pos\.pedidoParaLlevar"[^>]*\s+:aria-pressed="String\(\$store\.pos\.llevarDe\(item\)\)"\s+:aria-label="'Para llevar: ' \+ item\.nombre"\s+@click="\$store\.pos\.alternarLlevar\(item\)">Para llevar<\/button>/);
  // La pastilla de la variante lee la variante SOLA (sin el token: va en su propia pastilla).
  assert.match(seccionOrden, /x-text="item\.precio < 0 \? 'Pagó con ' \+ metodoTxt\(item\.nota\) : \$store\.pos\.notaVariante\(item\)"/);
  // «Asignar a persona» sigue como estaba.
  assert.match(seccionOrden, /<button type="button" class="btn-enlace" x-show="item\.precio >= 0"\s+:aria-label="\$store\.pos\.pagadorDe\(item\)/);
});

test('estática: «Todo para llevar» en la cabecera del pedido (alternable) y el encabezado «Para llevar · todo el pedido»', () => {
  assert.match(seccionOrden, /<button type="button" class="btn-alterna btn-llevar-pedido"\s+x-show="\$store\.pos\.ordenActiva" x-cloak\s+:aria-pressed="String\(\$store\.pos\.pedidoParaLlevar\)"\s+@click="\$store\.pos\.alternarLlevarPedido\(\)">[\s\S]*?<span>Todo para llevar<\/span>/);
  assert.match(seccionOrden, /<div class="llevar-banner" role="status" x-show="\$store\.pos\.pedidoParaLlevar" x-cloak>[\s\S]*?<span>Para llevar · todo el pedido<\/span>/);
});

test('estática: el marcador no se dibuja como producto ni cuenta como «algo»: la lista usa lineasDe y los botones de cobro, precuenta y liberar usan hayLineas', () => {
  assert.match(seccionOrden, /<template x-for="item in \$store\.pos\.lineasDe\(\$store\.pos\.ordenActiva\?\.items\)" :key="item\.id">/);
  assert.doesNotMatch(seccionOrden, /\$store\.pos\.ordenActiva\.items\.length/, 'ninguna condición de «vacío» mira items.length: el marcador solo es una cuenta vacía');
  assert.equal((seccionOrden.match(/!\$store\.pos\.hayLineas/g) || []).length, 5, 'cobro, cobro por partes, precuenta, liberar y el estado vacío (la lista usa hayLineas a secas)');
  assert.match(seccionOrden, /<div x-show="\$store\.pos\.ordenActiva && \$store\.pos\.hayLineas">/);
  // El mapa: la bolsa de la tarjeta y el total sin contar el marcador.
  const mesas = POS.slice(POS.indexOf('<!-- Mesa grid'), POS.indexOf('<!-- Quick stats'));
  assert.match(mesas, /class="mesa-llevar" x-show="\$store\.pos\.mesaParaLlevar\(mesa\.id\)"/);
  assert.match(mesas, /!\$store\.pos\.hayLineasDe\(o\.items\)/);
});

test('estática: el ticket lleva el encabezado de «Todo para llevar», «Para llevar» bajo el producto marcado y no cuenta el marcador en «Ítems»', () => {
  const ticket = sinComentariosHtml(POS.slice(POS.indexOf(`<section x-show="$store.pos.vista === 'ticket'"`)));
  assert.match(ticket, /<div class="ticket-llevar" x-show="\$store\.pos\.llevarPedidoDe\(\$store\.pos\.ordenTicket\?\.items\)" x-cloak>PARA LLEVAR — todo el pedido<\/div>/);
  assert.match(ticket, /<template x-for="item in \$store\.pos\.lineasDe\(\$store\.pos\.ordenTicket\?\.items\)" :key="item\.id">/);
  assert.match(ticket, /<span class="opt" x-show="\$store\.pos\.llevarDe\(item\) && !\$store\.pos\.llevarPedidoDe\(\$store\.pos\.ordenTicket\?\.items\)">Para llevar<\/span>/);
  assert.match(ticket, /x-text="\$store\.pos\.lineasDe\(\$store\.pos\.ordenTicket\?\.items\)\.filter\(i => i\.precio >= 0\)\.reduce/);
});

test('estática: los controles de «Para llevar» miden 44 px, no llevan color suelto y el ticket térmico lo dibuja en negro', () => {
  const css = POS.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.btn-alterna\s*\{[^}]*min-height:\s*var\(--pos-tactil\)/);
  assert.match(css, /\.btn-alterna\[aria-checked="true"\],\s*\.btn-alterna\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--color-telon\)/);
  // (la regla del rollo térmico, `body.print-termico .ticket-llevar`, es la única con #000, como las demás del rollo)
  const reglas = [...css.matchAll(/(\.(?:btn-alterna|llevar-banner|nota-llevar|ticket-llevar|mesa-llevar)[^{]*)\{([^}]*)\}/g)].filter((m) => !css.slice(Math.max(0, m.index - 20), m.index).includes('print-termico')).map((m) => m[0]);
  assert.ok(reglas.length >= 8);
  for (const r of reglas) assert.doesNotMatch(r, /#[0-9A-Fa-f]{3,8}\b/, `un hex en: ${r}`);
  assert.match(css, /body\.print-termico \.ticket-llevar\s*\{[^}]*border:\s*1\.5px solid #000 !important[^}]*color:\s*#000 !important/);
});

// ═════════════════════════ B. lógica: el store real ═════════════════════════

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const conNota = (id, precio, qty, nota, nombre = id) => ({ ...item(id, precio, qty), nombre, nota });
const MARCADOR = { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' };
const LIMONADA = { id: 'be1', nombre: 'Limonada de coco', precio: 13000, cat: 'Bebidas' };
const SECO = { id: 'ej2', nombre: 'Seco con proteína', precio: 18000, cat: 'Ejecutivos' };
const EJECUTIVO = { id: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, cat: 'Ejecutivos' };

/**
 * La base falsa con `actualizar_nota_item` como la función real: cambia la nota del ítem, sube la versión y devuelve la fila. Interruptores:
 * `notaFallos` (cuántas llamadas fallan sin red antes de responder), `notaError` (un error de la base, p. ej. 42501) y `notas` (lo que llegó).
 */
function conNotaRpc(base) {
  const original = base.responder;
  base.notas = [];
  base.notaFallos = 0;
  base.notaError = null;
  base.responder = async (c) => {
    if (c.tipo === 'rpc' && c.nombre === 'actualizar_nota_item') {
      if (base.latenciaMs) await dormir(base.latenciaMs);
      if (!base.red || base.notaFallos > 0) { if (base.notaFallos > 0) base.notaFallos--; return { data: null, error: { message: 'TypeError: Failed to fetch' } }; }
      if (base.notaError) return { data: null, error: base.notaError };
      const o = base.ordenes.get(c.args.p_orden_id);
      if (!o) return { data: null, error: { code: 'P0001', message: `orden ${c.args.p_orden_id} no existe` } };
      o.items = o.items.map((i) => (i.id === c.args.p_item_id ? { ...i, nota: c.args.p_nota } : i));
      o.version = (o.version || 0) + 1;
      base.notas.push([c.args.p_item_id, c.args.p_nota]);
      return { data: o, error: null };
    }
    return original(c);
  };
  return base;
}

function montar() {
  const base = conNotaRpc(crearBaseFalsa({ mesas: [mesaBase(3)] }));
  const t = crearPos({ base });
  t.base = base;
  t.pos.usuario = YO;
  t.pos._esperaMarcasLlevar = () => 5;     // los reintentos de la marca, sin esperar segundos
  return t;
}

/** Una orden abierta de la mesa 3 en la base y en el store. */
function conOrden(t, items, { id = 'o1' } = {}) {
  t.base.ordenes.set(id, { ...ordenBase(id, 3, items.map((i) => ({ ...i })), 1) });
  t.pos.mesas = [mesaBase(3)];
  t.pos.ordenes = [ordenLocal(id, 3, items.map((i) => ({ ...i })), 1)];
  t.pos.mesaActiva = t.pos.mesas[0];
  t.pos.ordenActiva = t.pos.ordenes[0];
  t.pos.remoto = 'ok';
  return t.pos.ordenActiva;
}

const notasDe = (t) => plano(t.pos.ordenActiva.items.map((i) => [i.id, i.nota]));
const enLaBase = (t, id = 'o1') => plano(t.base.ordenes.get(id).items);
const deltas = (t) => t.base.rpcs.map((r) => [r.item, r.delta]);

test('funciones puras: leer, poner y quitar el token conservan variante y persona, y no se repiten', () => {
  const { pos } = montar();
  const leer = (base) => plano(pos._parsearLlevar(base));
  assert.deepEqual(leer('Sopa · Pollo · Para llevar'), { base: 'Sopa · Pollo', llevar: true });
  assert.deepEqual(leer('Para llevar'), { base: '', llevar: true }, 'sin variante, la base ES el token');
  assert.deepEqual(leer('Sin cebolla'), { base: 'Sin cebolla', llevar: false });
  assert.deepEqual(leer(''), { base: '', llevar: false });
  assert.deepEqual(leer('Sopa · Para llevar · Para llevar'), { base: 'Sopa', llevar: true }, 'dos tablets a la vez: se lee como uno y se quitan todos juntos');
  assert.deepEqual(leer('Sin sal para llevar'), { base: 'Sin sal para llevar', llevar: false }, 'solo el token exacto al final de la base cuenta');
  assert.deepEqual(leer('Para llevar · Sopa'), { base: 'Para llevar · Sopa', llevar: false }, 'y solo al final');
  assert.equal(pos._ponerLlevar('Sopa · Pollo', true), 'Sopa · Pollo · Para llevar');
  assert.equal(pos._ponerLlevar('', true), 'Para llevar');
  assert.equal(pos._ponerLlevar('Sopa · Pollo · Para llevar', true), 'Sopa · Pollo · Para llevar', 'poner dos veces no lo repite');
  assert.equal(pos._ponerLlevar('Sopa · Pollo · Para llevar', false), 'Sopa · Pollo');
  assert.equal(pos._ponerLlevar('Para llevar', false), '');
  assert.equal(pos._ponerLlevar('Sopa · Para llevar · Para llevar', false), 'Sopa');
});

test('leer una línea: llevarDe, la variante sola, la persona y la nota legible del ticket (sin el token, que va en su propia línea)', () => {
  const { pos } = montar();
  const n = 'Sopa · Pollo · Para llevar — Persona 2 (Camila)';
  const linea = { id: 'ej1__sopa-pollo__para-llevar', precio: 21000, nota: n };
  assert.equal(pos.llevarDe(linea), true);
  assert.equal(pos.notaVariante(linea), 'Sopa · Pollo');
  assert.equal(pos.pagadorDe(linea), 'Persona 2');
  assert.equal(pos._nombresDe([linea])['Persona 2'], 'Camila');
  assert.equal(pos.notaLegible(linea), 'Sopa · Pollo — Camila');
  assert.equal(pos.notaLegible(linea, false), 'Sopa · Pollo');
  assert.equal(pos.notaLegible({ nota: 'Para llevar — Persona 3' }), 'Persona 3', 'sin variante, la persona sola');
  assert.equal(pos.notaLegible({ nota: 'Para llevar' }), '');
  assert.equal(pos.llevarDe({ id: 'be1', precio: 13000, nota: 'Sin hielo' }), false);
  assert.equal(pos.llevarDe({ id: 'be1', precio: 13000, nota: '' }), false);
  assert.equal(pos.llevarDe({ id: 'be1', precio: 13000 }), false, 'una línea sin nota');
  assert.equal(pos.llevarDe({ id: 'para_llevar', precio: 0, nota: 'Para llevar' }), false, 'el marcador no es un producto marcado');
  assert.equal(pos.llevarDe({ id: 'abono_x', precio: -5000, nota: 'Para llevar' }), false, 'ni un abono');
});

test('alternarLlevar: marca y desmarca la línea entera conservando persona y variante, de inmediato en pantalla y por actualizar_nota_item', async () => {
  const t = montar();
  const orden = conOrden(t, [
    conNota('ej1__sopa-pollo', 21000, 2, 'Sopa · Pollo — Persona 2 (Camila)'), conNota('be1', 13000, 3, ''), conNota('en1', 16000, 1, 'Persona 1'),
  ]);
  t.pos.alternarLlevar(orden.items[0]);
  assert.equal(orden.items[0].nota, 'Sopa · Pollo · Para llevar — Persona 2 (Camila)', 'síncrono: la pantalla ya cambió');
  assert.equal(orden.items[0].qty, 2, 'marca la línea entera: la cantidad no se toca');
  t.pos.alternarLlevar(orden.items[1]);
  assert.equal(orden.items[1].nota, 'Para llevar', 'sin variante ni persona: el token solo');
  t.pos.alternarLlevar(orden.items[2]);
  assert.equal(orden.items[2].nota, 'Para llevar — Persona 1', 'con persona y sin variante');
  await asentar();
  assert.deepEqual(t.base.notas, [
    ['ej1__sopa-pollo', 'Sopa · Pollo · Para llevar — Persona 2 (Camila)'], ['be1', 'Para llevar'], ['en1', 'Para llevar — Persona 1'],
  ]);
  assert.deepEqual(enLaBase(t).map((i) => i.nota), ['Sopa · Pollo · Para llevar — Persona 2 (Camila)', 'Para llevar', 'Para llevar — Persona 1'], 'la base guarda lo mismo que la pantalla');
  // Y otra vez: se quita, y persona y variante quedan como estaban.
  t.pos.alternarLlevar(orden.items[0]); t.pos.alternarLlevar(orden.items[1]); t.pos.alternarLlevar(orden.items[2]);
  assert.deepEqual(notasDe(t), [['ej1__sopa-pollo', 'Sopa · Pollo — Persona 2 (Camila)'], ['be1', ''], ['en1', 'Persona 1']]);
  await asentar();
  assert.deepEqual(enLaBase(t).map((i) => i.nota), ['Sopa · Pollo — Persona 2 (Camila)', '', 'Persona 1']);
  assert.deepEqual(plano(t.pos.gruposPorPersona['Persona 2'].map((i) => i.id)), ['ej1__sopa-pollo'], 'la persona sigue siendo la misma para dividir y cobrar');
  assert.equal(t.pos.totalOrdenActiva, 21000 * 2 + 13000 * 3 + 16000, 'marcar no cambia el total');
});

test('alternarLlevar: no toca el marcador, un abono ni una línea que no existe; y sobre una venta de un cierre en edición solo cambia en local', async () => {
  const t = montar();
  const orden = conOrden(t, [conNota('a', 5000, 1, ''), { ...MARCADOR }, conNota('abono_recibido_x', -2000, 1, 'efectivo')]);
  t.pos.alternarLlevar(orden.items[1]);
  t.pos.alternarLlevar(orden.items[2]);
  t.pos.alternarLlevar(null);
  assert.deepEqual(notasDe(t), [['a', ''], ['para_llevar', 'Todo el pedido'], ['abono_recibido_x', 'efectivo']]);
  t.pos.cierreEditando = { id: 'c1' };
  t.pos.alternarLlevar(orden.items[0]);
  await asentar();
  assert.equal(orden.items[0].nota, 'Para llevar');
  assert.deepEqual(t.base.notas, [], 'una venta embebida en un cierre se guarda con el cierre (como la asignación de persona)');
});

test('la marca no parpadea ni se pierde: el eco de Realtime y la lectura de la base que llegan MIENTRAS sube no la quitan de la pantalla', async () => {
  const t = montar();
  t.base.latenciaMs = 25;
  const orden = conOrden(t, [conNota('a', 5000, 1, 'Persona 1'), conNota('b', 7000, 1, '')]);
  t.pos.alternarLlevar(orden.items[1]);                                       // «b» sube (25 ms)…
  // …y llega el eco de OTRO cambio, con «b» todavía sin marcar (y una persona nueva en «a», puesta por otra tablet).
  const fila = { ...ordenBase('o1', 3, [conNota('a', 5000, 1, 'Persona 3'), conNota('b', 7000, 1, '')], 5) };
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(fila)) });
  const hoy = t.pos.ordenes[0];
  assert.deepEqual(plano(hoy.items.map((i) => [i.id, i.nota])), [['a', 'Persona 3'], ['b', 'Para llevar']], 'la persona nueva de la base entra y la marca pendiente sigue puesta');
  // La lectura de reconexión (_fusionarOrdenes) hace lo mismo.
  const fusion = t.pos._fusionarOrdenes([JSON.parse(JSON.stringify({ ...fila, version: 9 }))]);
  assert.deepEqual(plano(fusion[0].items.map((i) => i.nota)), ['Persona 3', 'Para llevar']);
  await dormir(80);
  assert.deepEqual(enLaBase(t).map((i) => i.nota), ['Persona 1', 'Para llevar'], 'y la base termina con la marca');
  // Confirmada, ya no se repone: lo que diga la base manda (otra tablet la pudo quitar).
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify({ ...fila, version: 20 })) });
  assert.deepEqual(plano(t.pos.ordenes[0].items.map((i) => i.nota)), ['Persona 3', '']);
});

test('sin red la marca se reintenta (1,5 s, 3 s… aquí 5 ms) y llega cuando la red vuelve; al volver la red, `online` la sube de una vez', async () => {
  const t = montar();
  const orden = conOrden(t, [conNota('a', 5000, 1, '')]);
  t.base.notaFallos = 2;                                                      // dos fallos de red y a la tercera responde
  t.pos.alternarLlevar(orden.items[0]);
  assert.equal(await hastaQue(() => t.base.notas.length === 1), true, 'a la tercera llega');
  assert.deepEqual(t.base.notas, [['a', 'Para llevar']]);
  assert.deepEqual(enLaBase(t).map((i) => i.nota), ['Para llevar']);
  // Fuera de línea: no se intenta, queda pendiente, y al volver `online` (flushDeltas + marcas) la sube.
  t.pos.remoto = 'offline';
  t.pos.alternarLlevar(orden.items[0]);                                       // se quita
  await dormir(30);
  assert.deepEqual(t.base.notas, [['a', 'Para llevar']], 'offline no sale nada');
  assert.equal(orden.items[0].nota, '', 'pero la pantalla ya lo muestra');
  t.pos.remoto = 'ok';
  t.pos._escucharEntorno();
  t.eventosVentana.online();
  assert.equal(await hastaQue(() => t.base.notas.length === 2), true);
  assert.deepEqual(enLaBase(t).map((i) => i.nota), ['']);
});

test('la marca no se reintenta sin remedio: permisos y una cuenta ya cobrada se sueltan; tras el último intento avisa', async () => {
  const t = montar();
  const orden = conOrden(t, [conNota('a', 5000, 1, ''), conNota('b', 5000, 1, '')]);
  t.base.notaError = { code: '42501', message: 'permission denied' };
  t.pos.alternarLlevar(orden.items[0]);
  await asentar();
  assert.equal(t.supabase.rpcs('actualizar_nota_item').length, 1, 'un rechazo de permisos no se reintenta');
  t.base.notaError = { code: 'P0001', message: 'orden o1 no existe' };       // lo que un mesero recibe ante una cuenta ya cerrada
  t.pos.alternarLlevar(orden.items[1]);
  await asentar();
  assert.equal(t.supabase.rpcs('actualizar_nota_item').length, 2, 'una cuenta que ya no está abierta tampoco');
  // Una red que nunca vuelve (en una tablet aparte: lo de arriba ya subió filas completas): 8 intentos y un aviso con el producto y la mesa.
  const u = montar();
  const ordenU = conOrden(u, [conNota('c', 5000, 1, '')]);
  u.base.notaFallos = 99;
  u.pos.alternarLlevar(ordenU.items[0]);
  assert.equal(await hastaQue(() => u.supabase.rpcs('actualizar_nota_item').length === 8, { ms: 3000 }), true);
  await dormir(30);
  assert.equal(u.supabase.rpcs('actualizar_nota_item').length, 8, 'ni uno más');
  assert.match(u.pos.aviso?.texto || '', /No se pudo guardar «Para llevar» de «c» en la mesa 3/);
});

test('una marca sobre una línea que aún no existe en la base espera a que su delta llegue (la nota no cae en el vacío)', async () => {
  const t = montar();
  t.base.latenciaMs = 20;
  conOrden(t, []);
  t.pos.remoto = 'ok';
  t.pos.agregarProducto(LIMONADA);                                            // el delta sale (20 ms)…
  t.pos.alternarLlevar(t.pos.ordenActiva.items[0]);                           // …y la marca se pide antes de que la base tenga la línea
  await dormir(150);
  assert.deepEqual(enLaBase(t).map((i) => [i.id, i.nota]), [['be1', 'Para llevar']], 'primero la línea, después su marca');
  assert.deepEqual(deltas(t), [['be1', 1]]);
});

// ── Agregar: «1 aquí y 1 para llevar» son dos líneas ──

test('«Agregar para llevar» encendido: cada producto entra como línea aparte marcada, y sumar el mismo producto suma a SU línea', async () => {
  const t = montar();
  conOrden(t, []);
  t.pos.agregarProducto(LIMONADA);                                            // «aquí»
  t.pos.alternarAgregarLlevar();
  assert.equal(t.pos.agregarLlevar, true);
  t.pos.agregarProducto(LIMONADA);                                            // para llevar: línea aparte
  t.pos.agregarProducto(LIMONADA);                                            // suma a la de llevar
  t.pos.alternarAgregarLlevar();
  t.pos.agregarProducto(LIMONADA);                                            // «aquí» otra vez: suma a la de aquí
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.id, i.qty, i.nota])), [['be1', 2, ''], ['be1__para-llevar', 2, 'Para llevar']]);
  await asentar();
  assert.deepEqual(enLaBase(t).map((i) => [i.id, i.qty, i.nota]), [['be1', 2, ''], ['be1__para-llevar', 2, 'Para llevar']], 'la base tiene las mismas dos líneas');
  assert.equal(t.pos.totalOrdenActiva, 13000 * 4);
});

test('«Agregar para llevar» también vale para la hoja de variantes: la variante queda en la nota y el token detrás, y cada variante sigue siendo su línea', async () => {
  const t = montar();
  conOrden(t, []);
  t.pos.alternarAgregarLlevar();
  t.pos.agregarProducto(EJECUTIVO);
  assert.equal(t.pos.modalOpciones, true);
  t.pos.elegirOpcion('Entrada', 'Sopa'); t.pos.elegirOpcion('Proteína', 'Pollo');   // la última opción agrega sola
  assert.equal(t.pos.modalOpciones, false);
  t.pos.alternarAgregarLlevar();
  t.pos.agregarProducto(EJECUTIVO);
  t.pos.elegirOpcion('Entrada', 'Sopa'); t.pos.elegirOpcion('Proteína', 'Pollo');   // la misma variante «aquí»
  t.pos.agregarProducto(EJECUTIVO);
  t.pos.elegirOpcion('Entrada', 'Frijol'); t.pos.elegirOpcion('Proteína', 'Res');   // otra variante «aquí»
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.id, i.qty, i.nota])), [
    ['ej1__sopa-pollo__para-llevar', 1, 'Sopa · Pollo · Para llevar'], ['ej1__sopa-pollo', 1, 'Sopa · Pollo'], ['ej1__frijol-res', 1, 'Frijol · Res'],
  ]);
  await asentar();
  assert.deepEqual(deltas(t), [['ej1__sopa-pollo__para-llevar', 1], ['ej1__sopa-pollo', 1], ['ej1__frijol-res', 1]]);
});

test('sumar DESPUÉS de alternar no mezcla: la línea marcada después conserva su id, y el producto «aquí» entra en una línea nueva con un id único', async () => {
  const t = montar();
  conOrden(t, []);
  t.pos.agregarProducto(LIMONADA);                                            // be1 ×1, «aquí»
  t.pos.alternarLlevar(t.pos.ordenActiva.items[0]);                           // se marca después: sigue siendo be1, ahora «para llevar»
  t.pos.agregarProducto(LIMONADA);                                            // «aquí»: NO es la línea be1 (marcada): línea nueva
  t.pos.agregarProducto(LIMONADA);                                            // y esta suma a la nueva
  const [marcada, nueva] = t.pos.ordenActiva.items;
  assert.equal(marcada.id, 'be1'); assert.equal(marcada.nota, 'Para llevar'); assert.equal(marcada.qty, 1);
  assert.notEqual(nueva.id, 'be1', 'no pisa la línea marcada');
  assert.match(nueva.id, /^be1__[a-z0-9]+$/); assert.equal(nueva.nota, ''); assert.equal(nueva.qty, 2);
  t.pos.alternarAgregarLlevar();
  t.pos.agregarProducto(LIMONADA);                                            // «para llevar»: suma a la marcada de antes (mismo producto, variante y estado)
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.qty, i.nota])), [[2, 'Para llevar'], [2, '']]);
  await asentar();
  const base = enLaBase(t);
  assert.equal(base.length, 2, 'en la base también son dos líneas');
  assert.deepEqual(base.map((i) => i.qty).sort(), [2, 2]);
  assert.equal(t.pos.totalOrdenActiva, 13000 * 4);
  // Un segundo par: alternar «be1» de nuevo a «aquí» deja DOS líneas «aquí» del mismo plato; sumar va a la primera y el total no se pierde.
  t.pos.alternarAgregarLlevar();
  t.pos.alternarLlevar(t.pos.ordenActiva.items[0]);
  t.pos.agregarProducto(LIMONADA);
  assert.equal(t.pos.ordenActiva.items.reduce((s, i) => s + i.qty, 0), 5);
});

test('«Agregar para llevar» se apaga al salir de la mesa, vale solo para su cuenta y con «Todo para llevar» no marca línea por línea', async () => {
  const t = montar();
  const orden = conOrden(t, []);
  t.pos.alternarAgregarLlevar();
  assert.equal(t.pos.agregarParaLlevar, orden.id);
  t.pos.ordenActiva = { ...orden, id: 'otra' };                               // otra cuenta: lo encuentra apagado
  assert.equal(t.pos.agregarLlevar, false);
  t.pos.ordenActiva = orden;
  assert.equal(t.pos.agregarLlevar, true);
  t.pos.alternarLlevarPedido();                                               // el pedido completo ya es para llevar
  t.pos.agregarProducto(LIMONADA);
  assert.deepEqual(plano(t.pos.ordenActiva.items.filter((i) => i.id !== 'para_llevar').map((i) => [i.id, i.nota])), [['be1', '']], 'la línea no se marca: el encabezado ya lo dice');
  t.pos.volverAMesas();
  assert.equal(t.pos.agregarParaLlevar, '');
  assert.equal(t.pos.agregarLlevar, false);
  t.pos.agregarParaLlevar = orden.id;
  await t.pos.abrirMesa(t.pos.mesas[0]);
  assert.equal(t.pos.agregarParaLlevar, '', 'al entrar a una mesa también arranca apagado');
});

test('el ítem manual también entra marcado con «Agregar para llevar» encendido (y sin marcar, como siempre: sin nota)', async () => {
  const t = montar();
  conOrden(t, []);
  t.pos.itemManualNombre = 'Postre de la casa'; t.pos.itemManualPrecio = '9000';
  t.pos.agregarItemManual();
  t.pos.alternarAgregarLlevar();
  t.pos.itemManualNombre = 'Café'; t.pos.itemManualPrecio = '3000';
  t.pos.agregarItemManual();
  // «sin nota» como siempre: el ítem manual sin marcar no trae el campo (plano() pasaría un undefined a null).
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => [i.nombre, 'nota' in i ? i.nota : '(sin nota)'])), [['Postre de la casa', '(sin nota)'], ['Café', 'Para llevar']]);
  assert.equal(t.pos.agregadoTexto, '+1 Café · para llevar');
  await asentar();
  assert.deepEqual(enLaBase(t).map((i) => [i.nombre, i.nota]), [['Postre de la casa', ''], ['Café', 'Para llevar']]);
});

test('«+1 Limonada · para llevar»: el aviso de agregado distingue la línea de llevar de la de aquí (no las acumula)', () => {
  const t = montar();
  conOrden(t, []);
  t.pos.agregarProducto(LIMONADA);
  t.pos.alternarAgregarLlevar();
  t.pos.agregarProducto(LIMONADA);
  assert.equal(t.pos.agregadoTexto, '+1 Limonada de coco · para llevar');
  t.pos.agregarProducto(LIMONADA);
  assert.equal(t.pos.agregadoTexto, '+2 Limonada de coco · para llevar');
});

// ── El pedido completo: el marcador ──

test('«Todo para llevar»: el marcador entra como línea de $0 con id fijo por aplicar_delta_orden (+1) y sale con −1; la pantalla cambia al instante', async () => {
  const t = montar();
  const orden = conOrden(t, [conNota('a', 5000, 2, '')]);
  assert.equal(t.pos.pedidoParaLlevar, false);
  t.pos.alternarLlevarPedido();
  assert.equal(t.pos.pedidoParaLlevar, true);
  assert.deepEqual(plano(orden.items.at(-1)), MARCADOR);
  await asentar();
  assert.deepEqual(deltas(t), [['para_llevar', 1]]);
  assert.deepEqual(plano(t.supabase.rpcs('aplicar_delta_orden')[0].args), {
    p_orden_id: 'o1', p_item_id: 'para_llevar', p_nombre: 'Para llevar', p_precio: 0, p_delta: 1, p_nota: 'Todo el pedido', p_delta_id: t.supabase.rpcs('aplicar_delta_orden')[0].args.p_delta_id,
  });
  assert.deepEqual(enLaBase(t).at(-1), MARCADOR, 'la base la tiene como cualquier ítem');
  t.pos.alternarLlevarPedido();
  assert.equal(t.pos.pedidoParaLlevar, false);
  assert.equal(orden.items.some((i) => i.id === 'para_llevar'), false);
  await asentar();
  assert.deepEqual(deltas(t), [['para_llevar', 1], ['para_llevar', -1]]);
  assert.equal(enLaBase(t).some((i) => i.id === 'para_llevar'), false);
  assert.equal(t.pos.totalOrdenActiva, 10000, 'el marcador no suma al total');
});

test('el marcador está «puesto» con cantidad ≥ 1: dos tablets a la vez lo dejan en 2 y apagarlo manda −2 (un −1 lo dejaría puesto)', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 1, ''), { ...MARCADOR, qty: 2 }]);
  assert.equal(t.pos.pedidoParaLlevar, true);
  t.pos.alternarLlevarPedido();
  await asentar();
  assert.deepEqual(deltas(t), [['para_llevar', -2]]);
  assert.equal(enLaBase(t).some((i) => i.id === 'para_llevar'), false, 'queda apagado de verdad');
  assert.equal(t.pos.pedidoParaLlevar, false);
});

test('el marcador llega por Realtime y por la lectura de la base como cualquier línea: las otras tablets lo ven puesto', () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 1, '')]);
  const fila = ordenBase('o1', 3, [conNota('a', 5000, 1, ''), { ...MARCADOR }], 3);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(fila)) });
  assert.equal(t.pos.pedidoParaLlevar, true);
  assert.equal(t.pos.mesaParaLlevar(3), true, 'la tarjeta de la mesa lo indica');
  assert.equal(t.pos.mesaParaLlevar(4), false);
  const sinMarcador = ordenBase('o1', 3, [conNota('a', 5000, 1, '')], 4);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(sinMarcador)) });
  assert.equal(t.pos.pedidoParaLlevar, false);
  assert.equal(t.pos.mesaParaLlevar(3), false);
  const fusion = t.pos._fusionarOrdenes([JSON.parse(JSON.stringify({ ...fila, version: 8 }))]);
  assert.equal(fusion[0].items.some((i) => i.id === 'para_llevar'), true, 'la lectura de reconexión no lo descarta');
});

test('sin red, el marcador entra por la cola de reintentos (deltas idempotentes) y llega al volver la conexión', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 1, '')]);
  t.pos.remoto = 'offline';
  t.pos.alternarLlevarPedido();
  await asentar();
  assert.equal(t.pos.colaDeltas.length, 1);
  assert.deepEqual(plano(t.pos.colaDeltas.map((d) => [d.item_id, d.delta, d.nota])), [['para_llevar', 1, 'Todo el pedido']]);
  assert.ok(t.pos.colaDeltas[0].id, 'lleva su id: reenviarlo no lo duplica');
  t.pos.remoto = 'ok';
  await t.pos.flushDeltas();
  assert.deepEqual(deltas(t), [['para_llevar', 1]]);
  assert.equal(t.pos.colaDeltas.length, 0);
  assert.equal(enLaBase(t).filter((i) => i.id === 'para_llevar').length, 1);
});

test('el marcador se cuenta como NADA: «N ítem(s)», dividir por persona (aunque un POS viejo le asignara una), selección de cobro y pedido vacío', () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 2, 'Persona 1'), { ...MARCADOR, nota: 'Todo el pedido — Persona 2' }]);
  assert.equal(t.pos.nLineas(t.pos.ordenActiva.items), 1);
  assert.deepEqual(Object.keys(t.pos.gruposPorPersona), ['Persona 1'], 'un POS viejo pudo asignarle una persona: no entra a dividir');
  assert.equal(t.pos.haySplitPorPersona, true);
  t.pos.toggleModoCobroParcial();
  t.pos.toggleSeleccion(t.pos.ordenActiva.items[1]);
  t.pos.toggleSeleccionItem('para_llevar');
  assert.deepEqual(plano(t.pos.itemsSeleccionados), {}, 'el marcador no se marca para cobrar');
  assert.equal(t.pos.lineasSeleccionadas, 0);
  assert.equal(t.pos.subtotalSeleccion, 0);
  t.pos.ciclarPagador(t.pos.ordenActiva.items[1]);
  assert.equal(t.pos.ordenActiva.items[1].nota, 'Todo el pedido — Persona 2', 'no se le reasigna');
  assert.equal(t.pos.hayLineas, true);
  assert.equal(t.pos.hayLineasDe([{ ...MARCADOR }]), false);
  assert.deepEqual(plano(t.pos.lineasDe([conNota('a', 1, 1, ''), { ...MARCADOR }]).map((i) => i.id)), ['a']);
});

test('una mesa con SOLO el marcador es $0: no se cobra, no se precuentea, no se divide ni se cobra por partes; pero sí se libera (se borra la cuenta, marcador incluido)', async () => {
  const t = montar();
  conOrden(t, [{ ...MARCADOR }]);
  assert.equal(t.pos.hayLineas, false);
  assert.equal(t.pos.totalOrdenActiva, 0);
  t.pos.facturar();
  assert.equal(t.pos.ordenActiva.estado, 'abierta', 'facturar no hace nada: el botón está apagado como en una mesa vacía');
  assert.equal(t.pos.vista !== 'ticket', true);
  assert.equal(t.pos._armarPreCuenta(), null, 'sin productos no hay precuenta');
  t.pos.facturarParcial({ para_llevar: 1 });
  assert.equal(t.pos.ordenes.length, 1, 'un cobro por partes no saca el marcador');
  assert.equal(t.pos.ordenActiva.items.length, 1);
  await asentar();
  t.pos.liberarMesaVacia();
  assert.deepEqual(t.confirmaciones, ['¿Liberar esta mesa sin generar ningún cobro?'], 'sí se puede liberar');
  assert.equal(t.pos.ordenes.length, 0);
  assert.equal(t.pos.mesas[0].estado, 'libre');
  assert.deepEqual(t.avisos, []);
  await asentar();
  assert.equal(t.base.ordenes.has('o1'), false, 'la fila se borra de la base');
});

test('liberar con abonos recibidos sigue prohibido aunque haya marcador, y con productos no se libera', () => {
  const t = montar();
  conOrden(t, [conNota('abono_recibido_x', -4000, 1, 'efectivo'), { ...MARCADOR }]);
  t.pos.liberarMesaVacia();
  assert.match(t.avisos.at(-1), /Esta mesa tiene abonos recibidos/);
  assert.equal(t.pos.ordenes.length, 1);
  assert.equal(t.pos.ordenSoloAbonos, true, 'el marcador no impide que sea una cuenta de solo abonos');
  const u = montar();
  conOrden(u, [conNota('a', 1000, 1, ''), { ...MARCADOR }]);
  u.pos.liberarMesaVacia();
  assert.equal(u.pos.ordenes.length, 1);
  assert.deepEqual(u.confirmaciones, []);
});

test('cobrar la mesa completa con el marcador: la venta cerrada lo lleva (su ticket dice «PARA LLEVAR»), el total no cambia y la mesa queda libre', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 2, ''), { ...MARCADOR }]);
  t.pos.facturar();
  await asentar();
  const cerrada = t.pos.ordenes[0];
  assert.equal(cerrada.estado, 'cerrada');
  assert.equal(cerrada.total, 10000);
  assert.deepEqual(plano(cerrada.items.map((i) => i.id)), ['a', 'para_llevar']);
  assert.equal(t.pos.llevarPedidoDe(t.pos.ordenTicket.items), true);
  assert.equal(t.pos.nLineas(t.pos.ordenTicket.items), 1);
  assert.equal(t.pos.mesas[0].estado, 'libre');
  assert.equal(t.base.ordenes.get('o1').estado, 'cerrada');
  assert.deepEqual(t.base.ordenes.get('o1').items.map((i) => i.id), ['a', 'para_llevar'], 'queda registrada «para llevar» en la base y en el cierre');
});

test('cobro por unidades o por persona con el marcador: el cobro lleva una copia (cantidad 1, $0) y la cuenta lo CONSERVA; el ticket de la persona dice «PARA LLEVAR»', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 3, 'Persona 1 (Ana)'), conNota('b', 7000, 1, 'Persona 2'), { ...MARCADOR }]);
  t.pos.cobrarGrupoPersona('Persona 1');
  await asentar();
  const cobro = t.pos.ordenes.find((o) => o.parcialDe === 'o1');
  assert.deepEqual(plano(cobro.items.map((i) => [i.id, i.qty])), [['a', 3], ['para_llevar', 1]]);
  assert.equal(cobro.total, 15000);
  assert.equal(t.pos.ticketMostrado.id, cobro.id);
  assert.equal(t.pos.llevarPedidoDe(t.pos.ticketMostrado.items), true);
  const doc = t.pos.documentoTicket(t.pos.ticketMostrado, 'ticket');
  assert.ok(doc.lineas.some((l) => l.texto === 'PARA LLEVAR - todo el pedido'));
  assert.equal(doc.lineas.some((l) => /Para llevar$/i.test(l.texto) && l.texto !== 'PARA LLEVAR - todo el pedido'), false);
  assert.deepEqual(plano(t.pos.ordenes.find((o) => o.id === 'o1').items.map((i) => [i.id, i.qty])), [['b', 1], ['para_llevar', 1]], 'la cuenta conserva el marcador (una sola unidad)');
  assert.deepEqual(enLaBase(t).map((i) => [i.id, i.qty]), [['b', 1], ['para_llevar', 1]]);
  assert.deepEqual(plano(t.base.ordenes.get(cobro.id).items.map((i) => i.id)), ['a', 'para_llevar'], 'el cobro registrado en la base también');
  // Cobro por unidades: selecciona 1 unidad de b; el marcador sigue sin ser seleccionable.
  const u = montar();
  conOrden(u, [conNota('a', 5000, 3, ''), { ...MARCADOR }]);
  u.pos.toggleModoCobroParcial();
  u.pos.toggleSeleccion(u.pos.ordenActiva.items[0]);
  u.pos.ajustarCantidadSeleccion(u.pos.ordenActiva.items[0], -2);
  assert.equal(u.pos.unidadesSeleccionadas, 1);
  assert.equal(u.pos.subtotalSeleccion, 5000);
  u.pos.facturarParcial();
  await asentar();
  assert.deepEqual(plano(u.pos.ordenActiva.items.map((i) => [i.id, i.qty])), [['a', 2], ['para_llevar', 1]]);
  assert.deepEqual(plano(u.pos.ticketMostrado.items.map((i) => [i.id, i.qty])), [['a', 1], ['para_llevar', 1]]);
  assert.equal(u.pos.quedaEnTicket, 10000, 'lo que queda por pagar no cuenta el marcador');
});

test('sin marcador, un cobro por partes no lo inventa; y un abono NO copia el marcador (su ticket es «Abono», una sola línea)', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 2, ''), conNota('b', 9000, 1, '')]);
  t.pos.facturarParcial({ a: 1 });
  await asentar();
  assert.deepEqual(plano(t.pos.ticketMostrado.items.map((i) => i.id)), ['a']);
  const u = montar();
  conOrden(u, [conNota('a', 20000, 1, ''), { ...MARCADOR }]);
  u.pos.toggleModoCobroParcial();
  u.pos.montoAbono = '5000';
  assert.equal(u.pos.cobrarMonto(), true);
  await asentar();
  const abono = u.pos.ordenes.find((o) => o.parcialDe === 'o1');
  assert.equal(u.pos.esOrdenAbono(abono), true);
  assert.deepEqual(plano(abono.items.map((i) => i.nombre)), ['Abono']);
  assert.equal(u.pos.ordenActiva.items.some((i) => i.id === 'para_llevar'), true, 'el marcador sigue en la cuenta');
  assert.equal(u.pos.totalOrdenActiva, 15000, 'queda por pagar lo de siempre (el marcador es $0)');
  assert.equal(u.pos.ordenSoloAbonos, false);
});

test('un cobro por partes que la base rechaza (RS005) devuelve a la cuenta lo cobrado SIN tocar el marcador: no queda en 2', async () => {
  const t = montar();
  conOrden(t, [conNota('b', 7000, 1, ''), { ...MARCADOR }]);
  const cobro = { id: 'c1', mesaId: 3, estado: 'cerrada', parcialDe: 'o1', total: 15000, items: [conNota('a', 5000, 3, ''), { ...MARCADOR }] };
  t.pos.ordenes.push(cobro);
  await t.pos._cobroParcialRechazado(cobro);
  await asentar();
  assert.deepEqual(deltas(t), [['a', 3]], 'solo se devuelve lo cobrado; el marcador no hace viaje');
  assert.deepEqual(enLaBase(t).map((i) => [i.id, i.qty]), [['b', 1], ['para_llevar', 1], ['a', 3]], 'la cuenta de la base: lo cobrado vuelve y el marcador sigue en una sola unidad');
});

test('un marcador en 2 (dos tablets lo pusieron a la vez) se sigue viendo puesto; apagarlo lo quita de verdad (−cantidad)', async () => {
  const t = montar();
  const orden = conOrden(t, [conNota('b', 7000, 1, ''), { ...MARCADOR, qty: 2 }]);
  assert.equal(t.pos.pedidoParaLlevar, true);
  assert.equal(t.pos.nLineas(orden.items), 1);
  t.pos.alternarLlevarPedido();
  await asentar();
  assert.equal(t.pos.pedidoParaLlevar, false);
  assert.equal(enLaBase(t).some((i) => i.id === 'para_llevar'), false);
});

test('un delta del marcador que la base no aceptó (la mesa ya estaba cobrada en otro dispositivo) avisa «Todo para llevar» y no «lo que agregaste»', () => {
  const t = montar();
  conOrden(t, [conNota('a', 1000, 1, '')]);
  t.pos._deltaDescartado({ orden_id: 'o1', item_id: 'para_llevar', delta: 1 }, { code: 'RS001', message: 'orden o1 está cerrada' }, { leer: false });
  assert.match(t.pos.aviso.texto, /«Todo para llevar» no se guardó/);
  t.pos._deltaDescartado({ orden_id: 'o1', item_id: 'a', delta: 1 }, { code: 'RS001', message: 'orden o1 está cerrada' }, { leer: false });
  assert.match(t.pos.aviso.texto, /lo último que agregaste no se guardó/);
});

test('quitar o subir con −/+ no toca el marcador (si un clic viejo llega), y ni el marcador ni una línea marcada rompen quitar/sumar', async () => {
  const t = montar();
  const orden = conOrden(t, [conNota('a', 5000, 2, 'Para llevar'), { ...MARCADOR }]);
  t.pos.quitarProducto(orden.items[1]);
  t.pos.incrementarItem(orden.items[1]);
  assert.equal(orden.items[1].qty, 1);
  t.pos.incrementarItem(orden.items[0]);
  t.pos.quitarProducto(orden.items[0]);
  t.pos.quitarProducto(orden.items[0]);
  await asentar();
  assert.deepEqual(plano(orden.items.map((i) => [i.id, i.qty, i.nota])), [['a', 1, 'Para llevar'], ['para_llevar', 1, 'Todo el pedido']]);
  assert.deepEqual(deltas(t), [['a', 1], ['a', -1], ['a', -1]]);
});

// ── Ticket, precuenta e impresión en la caja ──

test('el documento de la caja: «Para llevar» bajo cada producto marcado, el encabezado con el marcador (sin la línea de $0 y sin contarla en «Ítems») y nada si no hay', () => {
  const t = montar();
  const lineas = (doc) => plano(doc.lineas.map((l) => (l.der ? `${l.texto} | ${l.der}` : l.texto)));
  // Por producto.
  conOrden(t, [conNota('ej1__sopa-pollo__para-llevar', 21000, 1, 'Sopa · Pollo · Para llevar — Persona 2 (Camila)'), conNota('be1', 13000, 3, ''), conNota('en1', 16000, 2, 'Para llevar')]);
  let doc = t.pos.documentoTicket(t.pos._armarPreCuenta(), 'cuenta');
  let l = lineas(doc);
  const i1 = l.findIndex((x) => x.startsWith('1 x be1') || x.startsWith('1 x ej1'));
  assert.ok(i1 !== -1);
  assert.deepEqual(l.slice(l.findIndex((x) => x === '1 x ej1__sopa-pollo__para-llevar | $ 21.000'), l.findIndex((x) => x === '1 x ej1__sopa-pollo__para-llevar | $ 21.000') + 3),
    ['1 x ej1__sopa-pollo__para-llevar | $ 21.000', 'Sopa · Pollo - Camila', 'Para llevar'], 'la variante y la persona (en el papel la raya es «-»: el «—» no está en CP850), y debajo «Para llevar»');
  const dEntrada = l.findIndex((x) => x.startsWith('2 x en1'));
  assert.deepEqual(l.slice(dEntrada, dEntrada + 3), ['2 x en1 | $ 32.000', 'Para llevar', 'c/u $ 16.000'], 'sin variante ni persona: «Para llevar» y el precio unitario');
  assert.equal(l.filter((x) => x === 'Para llevar').length, 2, 'y la línea sin marcar no lo lleva');
  assert.equal(l.some((x) => /^PARA LLEVAR/.test(x)), false, 'sin el marcador, sin encabezado');
  assert.ok(l.includes('Ítems | 6'));
  // Con el marcador: encabezado; sin línea de $0; «Para llevar» por línea sobra.
  conOrden(t, [conNota('a', 5000, 2, 'Para llevar'), conNota('b', 7000, 1, ''), { ...MARCADOR }]);
  doc = t.pos.documentoTicket(t.pos._armarPreCuenta(), 'cuenta');
  l = lineas(doc);
  const rayas = l.map((x, i) => (x === '---' ? i : -1)).filter((i) => i >= 0);
  assert.equal(l[rayas[1] + 1], 'PARA LLEVAR - todo el pedido', 'justo bajo los datos de la mesa');
  assert.deepEqual(plano(doc.lineas[rayas[1] + 1]), { texto: 'PARA LLEVAR - todo el pedido', alinear: 'centro', negrita: true });
  assert.equal(l.some((x) => /para_llevar|Todo el pedido/.test(x)), false, 'la línea de $0 no sale');
  assert.equal(l.some((x) => x === 'Para llevar'), false, 'con el encabezado, la línea marcada no repite «Para llevar»');
  assert.equal(l.some((x) => /^1 x Para llevar/.test(x)), false);
  assert.ok(l.includes('Ítems | 3'), 'el marcador no cuenta en «Ítems»');
  assert.ok(l.some((x) => x.startsWith('TOTAL | $ 17.000')));
});

test('la precuenta con el marcador: la arma con las líneas de verdad y el marcador, el total sin él; y sin productos no hay precuenta', () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 2, ''), { ...MARCADOR }]);
  const pre = t.pos._armarPreCuenta();
  assert.equal(pre.total, 10000);
  assert.equal(pre.esPreCuenta, true);
  assert.equal(t.pos.llevarPedidoDe(pre.items), true);
  assert.equal(t.pos.nLineas(pre.items), 1);
  assert.equal(t.pos.lineasDe(pre.items).length, 1);
});

// ── Una nota con el token leída por el código de HOY (el POS de las demás tablets sin recargar) ──

const VIEJO = (() => {
  try { return execFileSync('git', ['show', '90f8c00:pos.html'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
})();

test('el POS de HOY (90f8c00, sin recargar en las otras tablets) lee una nota con el token y el marcador sin romperse: persona, variante y una línea de $0 legible', { skip: VIEJO ? false : 'no hay git o el commit 90f8c00 no está en esta copia' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-viejo-'));
  const archivo = path.join(tmp, 'pos.html');
  fs.writeFileSync(archivo, VIEJO);
  const guion = `
    import { crearPos, crearBaseFalsa, mesaBase, plano } from ${JSON.stringify(path.join(RAIZ, 'scripts/pruebas/_pos-vm.mjs'))};
    const t = crearPos({ base: crearBaseFalsa({ mesas: [mesaBase(3)] }) });
    const p = t.pos;
    const marcada = { id: 'ej1__sopa-pollo__para-llevar', nombre: 'Ejecutivo', precio: 21000, qty: 1, nota: 'Sopa · Pollo · Para llevar — Persona 2 (Camila)' };
    const marcador = { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' };
    p.ordenes = [{ id: 'o1', mesaId: 3, estado: 'abierta', items: [marcada, marcador], total: 21000 }];
    p.ordenActiva = p.ordenes[0]; p.mesaActiva = { id: 3 };
    const salida = {
      pagador: p.pagadorDe(marcada), base: p.notaBase(marcada), legible: p.notaLegible(marcada), nombre: p.nombrePersona('Persona 2'),
      nLineas: p.nLineas(p.ordenActiva.items), total: p.totalOrdenActiva, grupos: Object.keys(p.gruposPorPersona),
      legibleMarcador: p.notaLegible(marcador), pagadorMarcador: p.pagadorDe(marcador),
    };
    p.ciclarPagador(marcada);
    salida.tras = marcada.nota;
    console.log(JSON.stringify(salida));`;
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', guion], { env: { ...process.env, POS_HTML: archivo }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(r.stdout.trim().split('\n').at(-1));
    assert.equal(s.pagador, 'Persona 2', 'la persona se lee igual con el token en la nota');
    assert.equal(s.nombre, 'Camila');
    assert.equal(s.base, 'Sopa · Pollo · Para llevar', 'el código de hoy muestra el token como parte de la variante: legible, nada se rompe');
    assert.equal(s.legible, 'Sopa · Pollo · Para llevar — Camila');
    assert.equal(s.total, 21000, 'el marcador es $0: el total no cambia');
    assert.equal(s.legibleMarcador, 'Todo el pedido', 'el marcador se ve como una línea de $0 con una nota legible');
    assert.deepEqual(s.grupos, ['Persona 2']);
    assert.equal(s.tras, 'Sopa · Pollo · Para llevar — Persona 3', 'reasignar con la pantalla vieja conserva la variante y el token (sin el nombre: lo de siempre)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Refutación de la integración (version-nueva × para-llevar): lo que el marcador y las marcas hacen contra la base de la ola C ──
// La base de la ola C es la de producción tras 20261002180000: guardia de DELETE (una cuenta abierta con ítems no se borra por la API),
// deshacer_cobro (suma por id), deltas idempotentes y el guardia de `version` (RS003).

function montarOlaC() {
  const base = conNotaRpc(crearBaseFalsa({ mesas: [mesaBase(3)], olaC: true }));
  const t = crearPos({ base });
  t.base = base;
  t.pos.usuario = YO;
  t.pos.rol = 'admin';
  t.pos._esperaMarcasLlevar = () => 5;
  return t;
}

/**
 * El reloj del reintento de las marcas de «Para llevar», con cuenta: `programados` sube cada vez que el POS programa uno (justo cuando una
 * subida falló). Es el evento que una prueba espera ANTES de tocar la base «mientras tanto». Esperar un tiempo fijo (`asentar()`, `dormir()`)
 * corría una carrera con el reloj real: con la máquina cargada (una pausa de GC, el proceso desalojado) el reintento salía antes de que la
 * prueba cambiara la base, releía la línea sin la marca y la mandaba otra vez (visto una vez con --test-concurrency=2: «2 !== 1»).
 * Por qué no hay carrera: `ms` es mayor que el paso de `hastaQue` (5 ms), así que el sondeo que ve `programados` vence antes que el reloj del
 * reintento; Node corre los temporizadores vencidos por orden de vencimiento y vacía las microtareas entre uno y otro, y lo que la prueba
 * hace tras el `await hastaQue(…)` es síncrono. Aunque el proceso se detenga y los dos venzan juntos, la prueba toca la base antes del reintento.
 */
function relojDeReintento(t, ms) {
  const reloj = { programados: 0 };
  t.pos._esperaMarcasLlevar = () => { reloj.programados++; return ms; };
  return reloj;
}

/** Cobra a una persona por completo y vuelve a abrir la mesa, como lo hace el mesero. */
async function cobrarPersona(t, persona) {
  t.pos.cobrarGrupoPersona(persona);
  await asentar();
  t.pos.volverAMesas();
  t.pos.abrirMesa(t.pos.mesas[0]);
  await asentar();
}

test('liberar la mesa cuando solo queda el marcador BORRA la cuenta en la base (el guardia descarta el borrado de una abierta con ítems, y el marcador cuenta como ítem)', async () => {
  const t = montarOlaC();
  conOrden(t, [conNota('a', 10000, 1, 'Persona 1'), conNota('b', 8000, 1, 'Persona 2')]);
  t.pos.alternarLlevarPedido();
  await asentar();
  await cobrarPersona(t, 'Persona 1');
  await cobrarPersona(t, 'Persona 2');
  // Lo que queda en la cuenta: solo el marcador. El POS ofrece «Liberar mesa».
  assert.equal(t.pos.hayLineas, false);
  assert.deepEqual(enLaBase(t).map((i) => i.id), ['para_llevar']);

  t.pos.liberarMesaVacia();
  await asentar();
  assert.equal(t.pos.ordenes.some((o) => o.id === 'o1'), false, 'en la tablet la cuenta desaparece');
  assert.equal(t.pos.mesas[0].estado, 'libre');
  assert.equal(t.base.ordenes.has('o1'), false, 'y en la base TAMBIÉN: antes quedaba una cuenta fantasma abierta con el marcador');
  assert.equal(t.base.mesas.get(3).estado, 'libre');
  assert.deepEqual(t.avisos, []);
  assert.deepEqual(deltas(t).filter(([id]) => id === 'para_llevar').at(-1), ['para_llevar', -1], 'se quitó con el delta de «Todo para llevar» apagado');
  // Nada vuelve con la siguiente lectura (reconexión, volver a la pestaña) ni bloquea el cierre del día…
  await t.pos.sincronizarSupabase({ soloEnVivo: true });
  assert.equal(t.pos.ordenes.some((o) => o.id === 'o1'), false, 'la lectura de la base no la trae de vuelta');
  assert.notEqual(await t.pos.cerrarDia(), 'hay_abiertas', 'el cierre del día no encuentra una cuenta abierta fantasma');
  // …y los clientes siguientes de la mesa 3 nacen sin «Todo para llevar».
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 3));
  await asentar();
  assert.notEqual(t.pos.ordenActiva?.id, 'o1');
  assert.equal(t.pos.pedidoParaLlevar, false, 'la cuenta nueva no hereda el marcador');
});

test('liberar con el marcador en 2 y con una subida todavía en vuelo: el borrado espera a que el delta llegue, y la cuenta sin marcador se sigue borrando igual', async () => {
  const t = montarOlaC();
  t.base.latenciaMs = 20;
  conOrden(t, [{ ...MARCADOR, qty: 2 }]);
  t.pos.liberarMesaVacia();
  assert.equal(t.base.ordenes.has('o1'), true, 'el delta del marcador aún no llegó: la fila sigue (el borrado no sale antes de tiempo)');
  assert.equal(await hastaQue(() => !t.base.ordenes.has('o1'), { ms: 1500 }), true, 'cuando llega el delta (−2) la cuenta queda vacía y el borrado la quita');
  assert.deepEqual(deltas(t), [['para_llevar', -2]]);
  // Sin marcador no hay delta: la cuenta vacía se borra directo, como siempre.
  const u = montarOlaC();
  conOrden(u, []);
  u.pos.liberarMesaVacia();
  await asentar();
  assert.equal(u.base.ordenes.has('o1'), false);
  assert.deepEqual(deltas(u), []);
});

test('deshacer el cobro de una persona NO vuelve a poner «Todo para llevar» si ya se había quitado (el marcador es un estado de la cuenta, no una línea que se devuelve)', async () => {
  const t = montarOlaC();
  conOrden(t, [conNota('a', 10000, 1, 'Persona 1'), conNota('b', 8000, 1, 'Persona 2')]);
  t.pos.alternarLlevarPedido();
  await asentar();
  t.pos.cobrarGrupoPersona('Persona 1');
  await asentar();
  const cobro = t.pos.ordenes.find((o) => o.parcialDe === 'o1');
  assert.ok(cobro && cobro.items.some((i) => i.id === 'para_llevar'), 'la venta lleva su copia del marcador (su ticket dice «PARA LLEVAR»)');
  t.pos.volverAMesas(); t.pos.abrirMesa(t.pos.mesas[0]);
  t.pos.alternarLlevarPedido();                                              // el cliente que queda: «lo mío es para comer aquí»
  await asentar();
  assert.equal(t.pos.pedidoParaLlevar, false);
  assert.equal(enLaBase(t).some((i) => i.id === 'para_llevar'), false);

  assert.equal(await t.pos.devolverACuenta(cobro.id), true, t.pos.deshacerError);
  await asentar();
  assert.deepEqual(enLaBase(t).map((i) => i.id).sort(), ['a', 'b'], 'vuelven los productos y el marcador NO');
  assert.equal(t.pos.pedidoParaLlevar, false, 'la cuenta no vuelve a decir «Para llevar · todo el pedido» sin que nadie lo pida');
  assert.equal(t.pos.totalOrdenActiva, 18000);
  assert.equal(t.base.deshechosTabla.length, 1, 'y el deshacer quedó anotado');
});

test('deshacer el cobro de una persona con «Todo para llevar» puesto lo deja como estaba: en 1 (no en 2) y apagarlo con −1 lo quita', async () => {
  const t = montarOlaC();
  conOrden(t, [conNota('a', 10000, 1, 'Persona 1'), conNota('b', 8000, 1, 'Persona 2')]);
  t.pos.alternarLlevarPedido();
  await asentar();
  t.pos.cobrarGrupoPersona('Persona 1');
  await asentar();
  const cobro = t.pos.ordenes.find((o) => o.parcialDe === 'o1');
  t.pos.volverAMesas(); t.pos.abrirMesa(t.pos.mesas[0]);
  assert.equal(await t.pos.devolverACuenta(cobro.id), true, t.pos.deshacerError);
  await asentar();
  assert.deepEqual(enLaBase(t).map((i) => [i.id, i.qty]).sort(), [['a', 1], ['b', 1], ['para_llevar', 1]], 'el marcador sigue en una sola unidad');
  assert.equal(t.pos.pedidoParaLlevar, true);
  t.pos.alternarLlevarPedido();                                              // se apaga: manda −cantidad (1), no queda ninguno
  await asentar();
  assert.equal(enLaBase(t).some((i) => i.id === 'para_llevar'), false);
});

test('deshacer el cobro COMPLETO de una mesa «para llevar» cuando los clientes nuevos ya tienen su cuenta: los productos pasan, el marcador no (la cuenta nueva NO queda «para llevar»)', async () => {
  const t = montarOlaC();
  conOrden(t, [conNota('a', 10000, 1, ''), { ...MARCADOR }]);
  t.pos.facturar();                                                          // cobro completo con el marcador: la mesa queda libre
  await asentar();
  const vendida = t.pos.ordenes.find((o) => o.id === 'o1');
  assert.equal(vendida.estado, 'cerrada');
  t.pos.volverAMesas();
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 3));                // los clientes nuevos: cuenta nueva
  await asentar();
  const nueva = t.pos.ordenActiva;
  assert.notEqual(nueva.id, 'o1');
  t.pos.agregarProducto(LIMONADA);
  await asentar();
  assert.equal(t.pos.pedidoParaLlevar, false, 'los clientes nuevos piden para comer aquí');
  assert.equal(t.pos.tipoDevolucion(vendida), 'fusiona');
  assert.equal(await t.pos.devolverACuenta('o1'), true, t.pos.deshacerError);
  await asentar();
  const abiertas = [...t.base.ordenes.values()].filter((o) => o.estado === 'abierta');
  assert.equal(abiertas.length, 1);
  assert.deepEqual(plano(abiertas[0].items.map((i) => i.id).sort()), ['a', 'be1'], 'la cuenta de la mesa trae los productos de los dos clientes');
  const local = t.pos.ordenes.find((o) => o.estado === 'abierta' && o.mesaId === 3);
  assert.equal(local.items.some((i) => i.id === 'para_llevar'), false, 'y la pantalla tampoco lo tiene');
  assert.equal(t.pos.llevarPedidoDe(local.items), false);
});

test('deshacer el cobro completo con la mesa LIBRE reabre la misma cuenta con su marcador (es la misma cuenta, no una línea devuelta)', async () => {
  const t = montarOlaC();
  conOrden(t, [conNota('a', 10000, 1, ''), { ...MARCADOR }]);
  t.pos.facturar();
  await asentar();
  assert.equal(t.pos.tipoDevolucion(t.pos.ordenes.find((o) => o.id === 'o1')), 'reabre');
  assert.equal(await t.pos.devolverACuenta('o1'), true, t.pos.deshacerError);
  await asentar();
  assert.deepEqual(enLaBase(t).map((i) => [i.id, i.qty]), [['a', 1], ['para_llevar', 1]]);
  assert.equal(t.pos.llevarPedidoDe(t.pos.ordenes.find((o) => o.id === 'o1').items), true);
  assert.deepEqual(deltas(t).filter(([id]) => id === 'para_llevar'), [], 'sin delta de más: no hay nada que restar');
});

test('el REINTENTO de una marca no pisa la persona que otra tablet asignó mientras tanto: relee la línea en la base y solo le pone el token', async () => {
  const t = montarOlaC();
  const reloj = relojDeReintento(t, 40);                                     // el reintento sale a los 40 ms de programarse: da tiempo a que «la otra tablet» cambie la línea
  conOrden(t, [conNota('a', 10000, 1, '', 'Sopa'), conNota('b', 8000, 1, 'Persona 2')]);
  t.base.notaFallos = 1;                                                     // la primera subida de esta tablet se cae (wifi)
  t.pos.alternarLlevar(t.pos.ordenActiva.items[0]);
  assert.equal(await hastaQue(() => reloj.programados === 1), true, 'la subida falló y el reintento quedó programado');
  assert.equal(enLaBase(t)[0].nota, '', 'la marca no llegó');
  // La otra tablet (en línea) asigna la Sopa a Persona 2; el eco de Realtime no le llega a esta (su canal estaba caído).
  const fila = t.base.ordenes.get('o1');
  fila.items = fila.items.map((i) => (i.id === 'a' ? { ...i, nota: 'Persona 2' } : i));
  fila.version += 1;
  assert.equal(await hastaQue(() => t.base.notas.length === 1), true, 'el reintento llega');
  assert.equal(enLaBase(t).find((i) => i.id === 'a').nota, 'Para llevar — Persona 2', 'la base conserva la persona de la otra tablet y suma el token');
  await asentar();
  assert.equal(t.pos.ordenActiva.items.find((i) => i.id === 'a').nota, 'Para llevar — Persona 2', 'y la pantalla también');
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(t.base.ordenes.get('o1'))) });
  assert.deepEqual(plano((t.pos.gruposPorPersona['Persona 2'] || []).map((i) => i.id)).sort(), ['a', 'b'], '«Cobrar Persona 2» sigue incluyendo la Sopa');
});

test('un reintento cuando la base YA tiene la marca (la subida sí llegó y solo se perdió la respuesta) no manda nada más; y si la cuenta ya no está abierta en la base, la suelta', async () => {
  const t = montarOlaC();
  const reloj = relojDeReintento(t, 40);
  conOrden(t, [conNota('a', 10000, 1, '', 'Sopa')]);
  t.base.notaFallos = 1;
  t.pos.alternarLlevar(t.pos.ordenActiva.items[0]);
  assert.equal(await hastaQue(() => reloj.programados === 1), true, 'la subida falló y el reintento quedó programado');
  assert.equal(t.supabase.rpcs('actualizar_nota_item').length, 1);
  const fila = t.base.ordenes.get('o1');
  fila.items = fila.items.map((i) => ({ ...i, nota: 'Para llevar' }));        // sí había llegado
  fila.version += 1;
  assert.equal(await hastaQue(() => !t.pos._hayCambiosSinGuardar()), true, 'el reintento releyó la base y soltó la marca: ya no está pendiente');
  assert.equal(t.supabase.rpcs('actualizar_nota_item').length, 1, 'no se vuelve a mandar');
  // Otra: la base ya la tiene cerrada → se suelta sin reintentar.
  const u = montarOlaC();
  const relojU = relojDeReintento(u, 40);
  conOrden(u, [conNota('a', 10000, 1, '', 'Sopa')]);
  u.base.notaFallos = 1;
  u.pos.alternarLlevar(u.pos.ordenActiva.items[0]);
  assert.equal(await hastaQue(() => relojU.programados === 1), true, 'la subida falló y el reintento quedó programado');
  u.base.ordenes.get('o1').estado = 'cerrada';
  assert.equal(await hastaQue(() => !u.pos._hayCambiosSinGuardar()), true, 'el reintento vio la cuenta cerrada en la base y soltó la marca');
  assert.equal(u.supabase.rpcs('actualizar_nota_item').length, 1);
});

test('una cuenta ya cobrada en esta tablet no recibe marcas: el reintento pendiente se suelta y el cobro no se rechaza (RS003) ni culpa a «otra persona»', async () => {
  const t = montarOlaC();
  const reloj = relojDeReintento(t, 30);
  t.pos._baseConGuardia = true;                                              // la base tiene el guardia de `version` (20261002180000)
  conOrden(t, [conNota('a', 10000, 1, '', 'Sopa')]);
  const original = t.base.responder;
  t.base.responder = async (c) => {                                          // el upsert del cierre tarda más que el reintento (red lenta)
    if (c.tipo === 'from' && c.tabla === 'ordenes' && c.op === 'upsert' && [].concat(c.cuerpo).some((f) => f.estado === 'cerrada')) await dormir(60);
    return original(c);
  };
  t.base.notaFallos = 1;
  t.pos.alternarLlevar(t.pos.ordenActiva.items[0]);                          // la primera subida falla: queda un reintento programado
  assert.equal(await hastaQue(() => reloj.programados === 1), true, 'la primera subida falló y el reintento quedó programado');
  assert.equal(t.pos._hayDeltasEnVuelo('o1'), false, 'entre reintentos la marca no cuenta como subida en vuelo');
  t.pos.facturar();                                                          // «Generar ticket y cobrar» → confirmar
  assert.equal(await hastaQue(() => t.base.ordenes.get('o1').estado === 'cerrada'), true, 'la base aceptó el cobro');
  assert.equal(await hastaQue(() => !t.pos._hayCambiosSinGuardar()), true, 'el reintento (a los 30 ms, en plena subida del cierre) vio la cuenta cobrada y soltó la marca');
  await asentar();
  assert.equal(t.pos.ordenes.find((o) => o.id === 'o1').estado, 'cerrada', 'y la tablet no la reabrió');
  assert.equal(t.pos.aviso?.texto || '', '', 'sin el aviso «otra persona la modificó antes de que cobraras»');
  assert.equal(t.supabase.rpcs('actualizar_nota_item').length, 1, 'la marca no se mandó: la fila cerrada ya lleva la nota que se veía');
  assert.equal(t.base.ordenes.get('o1').items[0].nota, 'Para llevar', 'y el cobro cerrado lleva la marca');
});

// ═════════════════════════ C. en navegador ═════════════════════════

const pw = buscarPlaywright();
const SALTAR = pw.chromium ? false : pw.motivo;
const DIR_CACHE = process.env.POS_CDN_CACHE || undefined;

let servidor = null;
let navegador = null;
const contextos = [];
after(async () => {
  for (const c of contextos) await c.close().catch(() => {});
  await navegador?.close().catch(() => {});
  await servidor?.cerrar().catch(() => {});
});

/** Abre una vista del arnés; si no hay red para las fuentes, salta la prueba con el motivo (y devuelve null). */
async function abrir(t, vista, ancho, { alto = ancho < 768 ? 844 : 900, ajustar } = {}) {
  let ultimo = null;
  for (let intento = 0; intento < 2; intento++) {
    let ctx = null;
    try {
      servidor ||= await servirPos(RAIZ, 0);
      navegador ||= await pw.chromium.launch();
      ctx = await nuevoContexto(navegador, { ancho, alto, movil: ancho < 768 });
      contextos.push(ctx);
      const page = await ctx.newPage();
      page.setDefaultTimeout(60000);
      const { diag } = await abrirPos(page, { url: servidor.url, vista, ajustar, dirCache: DIR_CACHE });
      return { page, diag, ctx };
    } catch (e) {
      ultimo = e;
      await ctx?.close().catch(() => {});
    }
  }
  t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(ultimo.message).split('\n')[0]}`);
  return null;
}

const reposo = (page) => page.waitForTimeout(200);
const textos = (loc) => loc.allInnerTexts().then((l) => l.map((x) => x.replace(/\s+/g, ' ').trim()));
const rpcs = (page, nombre) => page.evaluate((n) => window.__posSim.llamadas.filter((l) => l.tipo === 'rpc' && l.nombre === n).map((l) => l.args), nombre);
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// «+1 …» se cierra solo a los 2,2 s (VENTANA_AGREGADO_MS de pos.html): leerlo desde Node después del toque es una carrera con la carga
// de la máquina (2026-10-04: más de 2,2 s entre el toque y la lectura, el aviso ya no estaba y la prueba leyó ''). Esto anota EN LA
// PÁGINA cada texto que muestra, cuando lo muestra, sin congelar el reloj (con page.clock.pauseAt, x-show deja «· van 1» a la vista).
const anotarAvisos = (page) => page.evaluate(() => {
  const vistos = window.__avisosAgregado = [];
  const pila = document.querySelector('.avisos-pulgar');
  new MutationObserver(() => {
    const txt = pila.querySelector('.agregado-aviso')?.innerText ?? '';
    if (txt !== (vistos.at(-1) ?? '')) vistos.push(txt);
  }).observe(pila, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });
});
/** El último texto que mostró «+1 …» desde anotarAvisos ('' si ninguno), aunque ya se haya cerrado. */
const ultimoAviso = (page) => page.evaluate(() => window.__avisosAgregado.filter(Boolean).at(-1) ?? '');

for (const ancho of [390, 1280]) {
  test(`navegador (${ancho} px): el control «Para llevar» de una línea la marca y la desmarca, con pastilla y bolsa, y conserva persona y variante`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden-personas', ancho); if (!a) return;
    const { page } = a;
    const linea = page.locator('.order-item').first();           // «Sopa · Pollo — Persona 1 (Camila)»
    assert.equal(await linea.locator('.nota-llevar').isVisible(), false, 'apagado por defecto');
    const control = linea.getByRole('button', { name: 'Para llevar: Ejecutivo de la casa' });
    assert.equal(await control.getAttribute('aria-pressed'), 'false');
    assert.ok((await control.boundingBox()).height >= 43.5, 'el control mide 44 px de alto');
    await control.click(); await reposo(page);
    assert.equal(await control.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await textos(linea.locator('.nota-item:visible')), ['Sopa · Pollo', 'Camila', 'Para llevar'], 'la variante sin el token, la persona y la pastilla propia');
    assert.equal(await linea.locator('.nota-llevar svg').count(), 1, 'con la bolsa en SVG en línea');
    await page.waitForFunction(() => window.__posSim.llamadas.some((l) => l.nombre === 'actualizar_nota_item'));
    assert.deepEqual(await rpcs(page, 'actualizar_nota_item'), [{ p_orden_id: 'ord-abierta-3', p_item_id: 'ej1__sopa-pollo', p_nota: 'Sopa · Pollo · Para llevar — Persona 1 (Camila)' }]);
    // El detalle de la persona lo dice.
    await page.locator('.persona-split').nth(0).locator('.persona-meta').click(); await reposo(page);
    assert.match((await textos(page.locator('.persona-split').nth(0).locator('.persona-linea')))[0], /Sopa · Pollo Para llevar/);
    await control.click(); await reposo(page);
    assert.equal(await control.getAttribute('aria-pressed'), 'false');
    assert.equal(await linea.locator('.nota-llevar').isVisible(), false);
    await page.waitForFunction(() => window.__posSim.llamadas.filter((l) => l.nombre === 'actualizar_nota_item').length >= 2);
    assert.equal((await rpcs(page, 'actualizar_nota_item')).at(-1).p_nota, 'Sopa · Pollo — Persona 1 (Camila)');
    assert.deepEqual(a.diag.errores, []);
  });

  test(`navegador (${ancho} px): «Agregar para llevar» es un switch junto al buscador; encendido, lo que se toca entra como línea aparte marcada (y la hoja de variantes también)`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden', ancho); if (!a) return;
    const { page } = a;
    const sw = page.getByRole('switch', { name: 'Agregar para llevar' });
    assert.equal(await sw.getAttribute('aria-checked'), 'false', 'apagado por defecto');
    const caja = await sw.boundingBox();
    assert.ok(caja.height >= 43.5, `el switch mide ${caja.height} px de alto`);
    const buscador = await page.locator('.buscador-campo').boundingBox();
    assert.ok(Math.abs((caja.y + caja.height / 2) - (buscador.y + buscador.height / 2)) < 12, 'va en la misma fila que el buscador');
    assert.ok(buscador.width > 120, 'y el buscador conserva ancho');
    await page.locator('.menu-item', { hasText: 'Limonada de coco' }).click();           // la mesa 3 ya tiene 3 limonadas «aquí»
    await sw.click(); await reposo(page);
    assert.equal(await sw.getAttribute('aria-checked'), 'true');
    await anotarAvisos(page);
    await page.locator('.menu-item', { hasText: 'Limonada de coco' }).click();
    await page.locator('.nota-llevar:visible').first().waitFor();
    assert.match(await ultimoAviso(page), /Limonada de coco · para llevar/);
    await page.locator('.menu-item', { hasText: 'Ejecutivo de la casa' }).click();     // variantes
    await page.locator('.modal-backdrop:visible .opt-chip', { hasText: 'Sopa' }).click();
    await page.locator('.modal-backdrop:visible .opt-chip', { hasText: 'Res' }).first().click();
    await reposo(page);
    const lineas = await page.evaluate(() => Alpine.store('pos').ordenActiva.items.map((i) => [i.id, i.qty, i.nota]));
    assert.deepEqual(lineas.slice(3), [['be1__para-llevar', 1, 'Para llevar'], ['ej1__sopa-res__para-llevar', 1, 'Sopa · Res · Para llevar']]);
    assert.equal(lineas.find((l) => l[0] === 'be1')[1], 4, 'la limonada «aquí» sumó una antes de encender');
    await page.waitForFunction(() => window.__posSim.llamadas.filter((l) => l.nombre === 'aplicar_delta_orden').length >= 3);
    assert.deepEqual((await rpcs(page, 'aplicar_delta_orden')).slice(-2).map((r) => [r.p_item_id, r.p_nota]), [['be1__para-llevar', 'Para llevar'], ['ej1__sopa-res__para-llevar', 'Sopa · Res · Para llevar']]);
    await sw.click(); await reposo(page);
    assert.equal(await sw.getAttribute('aria-checked'), 'false');
    assert.deepEqual(a.diag.errores, []);
  });

  test(`navegador (${ancho} px): «Todo para llevar» pone el encabezado y esconde pastillas, controles por línea e interruptor; el marcador no se dibuja como producto ni cuenta`, { skip: SALTAR }, async (t) => {
    const a = await abrir(t, 'orden-llevar-linea', ancho); if (!a) return;
    const { page } = a;
    const todo = page.getByRole('button', { name: 'Todo para llevar' });
    assert.equal(await todo.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.llevar-banner:visible').count(), 0);
    assert.equal(await page.locator('.nota-llevar:visible').count(), 2, 'dos líneas marcadas');
    assert.equal(await page.getByRole('button', { name: /^Para llevar: / }).count(), 4);
    assert.equal(await page.getByRole('switch', { name: 'Agregar para llevar' }).isVisible(), true);
    assert.match(await page.locator('.pedido-cab').innerText(), /4 ítem\(s\)/);
    await todo.click(); await reposo(page);
    assert.equal(await todo.getAttribute('aria-pressed'), 'true');
    assert.equal((await page.locator('.llevar-banner:visible').innerText()).trim(), 'Para llevar · todo el pedido');
    assert.equal(await page.locator('.nota-llevar:visible').count(), 0, 'las pastillas por línea ya no hacen falta');
    assert.equal(await page.getByRole('button', { name: /^Para llevar: / }).locator('visible=true').count(), 0, 'ni los controles por línea');
    assert.equal(await page.getByRole('switch', { name: 'Agregar para llevar' }).isVisible(), false, 'ni el interruptor de agregar');
    assert.equal(await page.locator('.order-item').count(), 4, 'el marcador no es una fila del pedido (sin +/−, sin «Asignar a persona»)');
    assert.equal(await page.locator('.order-item .menu-item-name', { hasText: /^Para llevar$/ }).count(), 0, 'ninguna fila se llama «Para llevar»: ni línea de $0');
    assert.match(await page.locator('.pedido-cab').innerText(), /4 ítem\(s\)/, 'no cuenta en «N ítem(s)»');
    assert.equal(await page.evaluate(() => Alpine.store('pos').totalOrdenActiva), 97000);
    await page.waitForFunction(() => window.__posSim.llamadas.some((l) => l.nombre === 'aplicar_delta_orden'));
    assert.deepEqual((await rpcs(page, 'aplicar_delta_orden')).map((r) => [r.p_item_id, r.p_precio, r.p_delta, r.p_nota]), [['para_llevar', 0, 1, 'Todo el pedido']]);
    // Apagar: vuelve todo.
    await todo.click(); await reposo(page);
    assert.equal(await page.locator('.llevar-banner:visible').count(), 0);
    assert.equal(await page.locator('.nota-llevar:visible').count(), 2);
    assert.equal(await page.getByRole('switch', { name: 'Agregar para llevar' }).isVisible(), true);
    assert.deepEqual(a.diag.errores, []);
  });
}

test('navegador: el mapa de mesas indica «Todo para llevar» en la tarjeta (bolsa y texto para lectores) y el total no cuenta el marcador', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'mesas-llevar', 390); if (!a) return;
  const { page } = a;
  const tarjeta = page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^3$/ }) });
  assert.equal(await tarjeta.locator('.mesa-llevar').isVisible(), true);
  assert.equal(await tarjeta.locator('.mesa-total .sr-only').innerText(), 'Para llevar.');
  assert.equal((await tarjeta.locator('.mesa-total').innerText()).replace(/\s+/g, ' ').trim(), 'Para llevar. $ 97.000');
  const otra = page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^6$/ }) });
  assert.equal(await otra.locator('.mesa-llevar').isVisible(), false, 'la mesa 6 no');
  assert.equal(await sinDesborde(page), 0);
  assert.deepEqual(a.diag.errores, []);
});

test('navegador: una mesa con SOLO «Todo para llevar» no se cobra ni se precuentea ($0, como una mesa vacía) y se libera', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-vacia', 390); if (!a) return;
  const { page } = a;
  await page.getByRole('button', { name: 'Todo para llevar' }).click(); await reposo(page);
  assert.equal(await page.locator('.llevar-banner:visible').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Generar ticket y cobrar' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Imprimir precuenta' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Cobrar por partes' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Liberar mesa' }).isVisible(), true, 'sí se puede liberar');
  assert.match(await page.locator('.pedido-cab').innerText(), /Sin ítems/);
  assert.equal(await page.locator('.order-item').count(), 0);
  assert.deepEqual(a.diag.errores, []);
});

test('navegador: el ticket de la cuenta dice «Para llevar» bajo cada producto marcado, y con «Todo para llevar» el encabezado y ni rastro de la línea de $0', { skip: SALTAR }, async (t) => {
  const lineas = await abrir(t, 'ticket-llevar-lineas', 390); if (!lineas) return;
  const l = lineas.page.locator('.print-zone');
  assert.deepEqual(await textos(l.locator('.ticket-line')), [
    '1 x Ejecutivo de la casa Sopa · Pollo $ 21.000',
    '1 x Ejecutivo de la casa Sopa · Pollo — Camila Para llevar $ 21.000',
    '1 x Empanadas de la casa $ 16.000',
    '3 x Limonada de coco Para llevar c/u $ 13.000 $ 39.000',
    'Ítems 6',
  ]);
  assert.equal(await l.locator('.ticket-llevar').isVisible(), false);
  const todo = await abrir(t, 'ticket-llevar-todo', 390); if (!todo) return;
  const z = todo.page.locator('.print-zone');
  assert.equal((await z.locator('.ticket-llevar').innerText()).trim(), 'PARA LLEVAR — todo el pedido');
  assert.deepEqual(await textos(z.locator('.ticket-line')), [
    '2 x Ejecutivo de la casa Sopa · Pollo c/u $ 21.000 $ 42.000', '1 x Empanadas de la casa $ 16.000', '3 x Limonada de coco c/u $ 13.000 $ 39.000', 'Ítems 6',
  ]);
  assert.equal(await z.getByText('Todo el pedido', { exact: true }).count(), 0, 'la nota de la línea de $0 no sale');
  assert.deepEqual(todo.diag.errores, []);
});

test('navegador: cobrar la mesa con «Todo para llevar» deja el ticket con el encabezado y la venta del cierre dice «Para llevar»', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'ticket-llevar-impreso', 302); if (!a) return;
  const { page } = a;
  assert.equal((await page.locator('.ticket-llevar').innerText()).trim(), 'PARA LLEVAR — todo el pedido');
  const caja = await page.locator('.ticket-llevar').boundingBox();
  assert.ok(caja.width > 200 && caja.width < 302, 'cabe en el rollo de 80 mm');
  assert.equal(await page.locator('.ticket-llevar').evaluate((e) => getComputedStyle(e).borderTopColor), 'rgb(0, 0, 0)', 'en negro: el papel no tiene color');
  await page.evaluate(() => Alpine.store('pos').volverDeTicket());
  await page.evaluate(() => Alpine.store('pos').irA('cierre'));
  await reposo(page);
  assert.match((await textos(page.locator('.history-row').first().locator('.chip')))[1], /^Para llevar$/);
  assert.deepEqual(a.diag.errores, []);
});

test('navegador (320 px): con todo encendido la orden no se desborda y los controles siguen midiendo 44 px', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-llevar-linea', 320, { alto: 640 }); if (!a) return;
  const { page } = a;
  assert.equal(await sinDesborde(page), 0);
  await page.getByRole('switch', { name: 'Agregar para llevar' }).click(); await reposo(page);
  assert.equal(await sinDesborde(page), 0);
  for (const loc of [page.getByRole('switch', { name: 'Agregar para llevar' }), page.getByRole('button', { name: 'Todo para llevar' }), page.getByRole('button', { name: 'Para llevar: Limonada de coco' })]) {
    assert.ok((await loc.boundingBox()).height >= 43.5);
  }
  await page.getByRole('button', { name: 'Todo para llevar' }).click(); await reposo(page);
  assert.equal(await sinDesborde(page), 0);
  assert.deepEqual(a.diag.errores, []);
});
