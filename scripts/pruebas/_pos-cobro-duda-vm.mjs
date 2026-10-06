// Lo común de las pruebas del cobro «en duda» y de la cuenta CONGELADA con el POS REAL (el <script> de pos.html en un `vm`) sobre la base falsa de _pos-vm.mjs, que modela `cobrar_parcial`
// y `cobrar_abono` con el mismo orden de juicios que la función (el id de cobro ya anotado devuelve lo mismo ANTES de mirar la versión).
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre, solo lo importan (mismo patrón que _pos-vm.mjs).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  RAIZ, asentar, crearBaseFalsa, crearPos, hastaQue, mesaBase, ordenBase, normalizadorDeAlmuerzos, productosDelLunes, plano,
} from './_pos-vm.mjs';

export { RAIZ, asentar, hastaQue, plano, normalizadorDeAlmuerzos, productosDelLunes, mesaBase, ordenBase, crearBaseFalsa, crearPos };

export const POS_HTML = fs.readFileSync(process.env.POS_HTML ? path.resolve(process.env.POS_HTML) : path.join(RAIZ, 'pos.html'), 'utf8');
export const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
export const MARTES = '2026-10-06T18:00:00Z';      // 13:00 en Bogotá, martes: sin promoción
export const LUNES = '2026-10-05T18:00:00Z';       // 13:00 en Bogotá, lunes: «3er almuerzo»
export const CLAVE = 'pos_cobros_en_duda';

export const SECO = (qty, nota = '') => ({ id: 'seco', nombre: 'Seco', precio: 19000, qty, nota });
export const JUGO = (qty, nota = '') => ({ id: 'jugo', nombre: 'Jugo', precio: 12000, qty, nota });
export const SOPA = (qty, nota = '') => ({ id: 'sopa', nombre: 'Sopa', precio: 21000, qty, nota });
export const normalizar = normalizadorDeAlmuerzos();
export const total = (items) => items.reduce((s, i) => s + i.precio * i.qty, 0);
export const cerradas = (t) => [...t.base.ordenes.values()].filter((o) => o.estado === 'cerrada');
export const local = (t, id = 'o1') => t.pos.ordenes.find((o) => o.id === id);
export const llamadas = (t, nombre) => t.supabase.rpcs(nombre);
export const enDuda = (t) => JSON.parse(t.almacen.get(CLAVE) || '{}');

// Lo que la tablet dice cuando el cobro salió y no se sabe qué pasó, y cuando la cuenta está congelada.
export const SIN_RED = 'Sin red: el cobro por partes y los abonos necesitan red; la mesa completa sí se puede cobrar.';
export const SIN_RED_EN_DUDA = 'Sin red: el cobro por partes y los abonos necesitan red.';
export const CONGELADA = 'Cobro pendiente de confirmar con la base: espera a que vuelva la red.';
export const CAMBIO = /La cuenta cambió: revísala y vuelve a cobrar/;
/** El aviso de un cobro que SÍ salió hacia la base y no se supo qué pasó: la cuenta queda congelada y el aviso NO ofrece la mesa completa. */
export const avisoEnDuda = (t) => {
  assert.ok(t.pos.aviso.texto.startsWith(SIN_RED_EN_DUDA), t.pos.aviso.texto);
  assert.match(t.pos.aviso.texto, /Puede que el cobro sí haya llegado a la base y solo se perdió la respuesta/);
  assert.doesNotMatch(t.pos.aviso.texto, /la mesa completa sí se puede cobrar/, 'con la cuenta congelada la mesa completa NO se puede cobrar');
};

/** Un POS con sesión sobre la base falsa. Los temporizadores largos (≥ 1,5 s: los topes de 10 s, el reintento de red de 8 s) no corren solos: la prueba los dispara a mano. */
export function montar({ cuentas = [{ id: 'o1', mesa: 1, items: [SECO(2), JUGO(2)], version: 3 }], rol = 'mesero', base: baseDada, almacen, reloj = MARTES, productos = productosDelLunes() } = {}) {
  // `crudo`: la cuenta tal como se guardó, SIN pasar por el normalizador (como una escrita antes de las reglas, o un día sin promo); `abiertaEn`: cuándo se abrió.
  // El día de la promo es el de la ESCRITURA (privado.dia_promo, desde 312eb93): la base falsa juzga cualquier cuenta con el día del reloj, no con el de su `abierta_en`.
  const normalizarHoy = (items) => normalizar(items, { abierta_en: reloj });
  const base = baseDada || crearBaseFalsa({
    rol, mesas: cuentas.map((c) => mesaBase(c.mesa)), productos, olaC: true, normalizar: normalizarHoy,
    ordenes: cuentas.map((c) => ({ ...ordenBase(c.id, c.mesa, c.crudo ? c.items : normalizar(c.items, { abierta_en: reloj }), c.version ?? 3), abierta_en: c.abiertaEn || reloj })),
  });
  const original = base.responder;
  base.responder = async (c) => { const r = await original(c); return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r; };
  const reales = { setTimeout, clearTimeout };
  const timers = [];
  const t = crearPos({
    base, almacen, reloj,
    extras: {
      setInterval() { return 1; }, clearInterval() {},
      setTimeout(fn, ms, ...resto) { if (ms >= 1500) { const h = { fn, ms, cancelado: false, unref() { return h; } }; timers.push(h); return h; } return reales.setTimeout(fn, ms, ...resto); },
      clearTimeout(h) { if (h && typeof h === 'object') { h.cancelado = true; return; } reales.clearTimeout(h); },
    },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  t.base = base; t.pos.usuario = YO; t.timers = timers;
  t.timer = (ms) => timers.find((h) => h.ms === ms && !h.cancelado);
  return t;
}
export async function abrir(opciones = {}) {
  const t = montar(opciones);
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  await asentar();
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === (opciones.mesa ?? 1)));
  return t;
}
export const producto = (t, id) => t.pos.productos.find((p) => p.id === id);
/** El mesero marca en pantalla «Cobrar por partes» con estas unidades por línea. */
export const marcar = (t, mapa) => { t.pos.toggleModoCobroParcial(); t.pos.itemsSeleccionados = { ...mapa }; };
/** Lo que otra tablet hizo en la base mientras esta no se enteraba. */
export const otraTablet = (t, items, id = 'o1') => { const o = t.base.ordenes.get(id); o.items = normalizar(items, o); o.total = total(o.items); o.version += 1; };
/** El eco de Realtime de la cuenta (o cualquier lectura que NO es la reconciliación del cobro en duda): la tablet pasa a ver la cuenta de la base, con su versión. */
export const releer = async (t, id = 'o1') => { t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(t.base.ordenes.get(id))) }); await asentar(); return true; };
/** El reintento de red de 8 s (`_programarReintentoRed`): lee de nuevo la base y, si sale, `remoto` vuelve a «ok». */
export const reintentoDeRed = async (t) => { const h = t.timer(8000); assert.ok(h, 'hay un reintento de red programado'); await h.fn(); await asentar(40); };
