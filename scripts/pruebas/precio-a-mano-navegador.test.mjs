// Precio a mano por línea del pedido y + − discretos (pedido de Yonatan, 2026-10-05, tareas/2026-10-05-precio-a-mano-y-botones.md:
// «se debe poder editar el valor a mano de cada producto; los botones + − deben ser sutiles para no comer tanto espacio»).
//
// La base (migración 20261006110000_precio_a_mano.sql: `precio_manual`, `fijar_precio_item`) se prueba en migracion-precio-a-mano.test.mjs.
// Aquí, el POS:
//   · tocar el precio unitario de una línea abre un campo numérico EN LA MISMA línea (pesos enteros, como el monto del abono); Enter o salir guarda,
//     Escape cancela; cambia el precio de TODAS las unidades de la línea; lo pueden hacer el mesero y el admin; la línea queda con «a mano» y un
//     enlace «Volver al precio de carta»; el cambio viaja por la RPC `fijar_precio_item` con reintento y marca pendiente mientras la base no confirma;
//   · los + − de cada línea siguen midiendo 44 px de toque, pero sin caja ni borde (solo el signo en apoyo y la cantidad en medio), y la línea se lee
//     en dos renglones a 390 px.
//
// Tres partes, como pos-para-llevar.test.mjs:
//   A. ESTÁTICA (corre siempre): el marcado y el CSS de pos.html.
//   B. LÓGICA (corre siempre): el <script> real de pos.html en un `vm` (_pos-vm.mjs) con una base falsa que habla como `fijar_precio_item`.
//   C. EN NAVEGADOR (solo con Playwright y un Chromium, si no se salta con el motivo): el arnés con Supabase simulado (_pos-simulado.mjs), a 390 y 1280.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { asentar, crearBaseFalsa, crearPos, dormir, hastaQue, item, mesaBase, ordenBase, ordenLocal, plano } from './_pos-vm.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const sinComentariosHtml = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ');
const CSS = POS.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
/** El cuerpo de las reglas `selector { … }` (selector exacto), juntas. */
const regla = (selector) => {
  const re = new RegExp('(?:^|\\})\\s*' + selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  const cuerpos = [...CSS.matchAll(re)].map((m) => m[1]);
  assert.ok(cuerpos.length, `no encuentro la regla «${selector}»`);
  return cuerpos.join('\n');   // todas las reglas con ese selector exacto, en orden
};

// ═════════════════════════ A. estática: el marcado y el CSS ═════════════════════════

const seccionOrden = (() => {
  const i = POS.indexOf(`<section x-show="$store.pos.vista === 'orden'"`);
  const f = POS.indexOf('<!-- ▲ PARTE orden -->');
  assert.ok(i !== -1 && f > i, 'no encontré la sección de la orden');
  return sinComentariosHtml(POS.slice(i, f));
})();
const filaOrden = seccionOrden.slice(seccionOrden.indexOf('<div class="order-item"'), seccionOrden.indexOf('<div class="sel-unidades"'));

test('estática: el precio unitario es un botón de 44 px que abre el campo (solo donde se puede) y, donde no, sigue siendo texto', () => {
  assert.match(filaOrden, /<button type="button" class="btn-enlace precio-btn tabular"\s+x-show="item\.precio >= 0 && !\$store\.pos\.editaPrecio\(item\) && \$store\.pos\.puedeFijarPrecio\(item\)" x-cloak/);
  assert.match(filaOrden, /@click="\$store\.pos\.abrirPrecio\(item\)"/);
  assert.match(filaOrden, /:aria-label="\$store\.pos\.etiquetaPrecio\(item\)"/, 'con nombre accesible: qué línea y cuánto vale hoy (en una promo sin base, el precio del plato sin el descuento)');
  assert.match(POS, /'Cambiar el precio de ' \+ item\.nombre \+ ' \(ahora \$ ' \+ Number\(item\.precio\)\.toLocaleString\('es-CO'\) \+ ' cada una\)'/);
  assert.match(filaOrden, /<div class="text-fine tabular precio-unit"\s+x-show="item\.precio >= 0 && !\$store\.pos\.editaPrecio\(item\) && !\$store\.pos\.puedeFijarPrecio\(item\)"/, 'una promoción, un abono o una cuenta cobrada: solo texto');
  // La pastilla «a mano» es texto (no solo color) y solo sale con precio a mano (también en una línea de promo cuya base se llevó la promo entera).
  assert.match(filaOrden, /<span class="precio-manual-marca" x-show="\$store\.pos\.tienePrecioManual\(item\)" x-cloak>a mano<\/span>/);
});

test('estática: el campo está en la misma línea: pesos enteros con teclado numérico, Enter y salir guardan, Escape cancela (y no baja la hoja del pedido)', () => {
  const campo = filaOrden.slice(filaOrden.indexOf('<template x-if="$store.pos.editaPrecio(item)">'), filaOrden.indexOf('</template>', filaOrden.indexOf('<template x-if="$store.pos.editaPrecio(item)">')));
  assert.ok(campo.length > 0, 'falta el campo del precio');
  assert.match(campo, /<label class="precio-edit">/);
  assert.match(campo, /<input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done"\s+class="field tabular precio-campo"/);
  assert.match(campo, /:aria-label="\$store\.pos\.etiquetaCampoPrecio\(item\)"/);
  assert.match(POS, /'Precio de ' \+ item\.nombre \+ ' \(pesos, cada unidad\)'/);
  assert.match(campo, /x-init="\$nextTick\(\(\) => \{ \$el\.focus\(\); \$el\.select\(\); \}\)"/, 'toma el foco y deja el valor seleccionado');
  assert.match(campo, /replace\(\/\\D\/g, ''\)/, 'solo dígitos, como el monto del abono');
  assert.match(campo, /@keydown\.enter\.prevent="\$store\.pos\.confirmarPrecio\(\)"/);
  assert.match(campo, /@keydown\.escape\.stop\.prevent="\$store\.pos\.cancelarPrecio\(\)"/, 'Escape cancela y no sube al manejador que baja la hoja');
  assert.match(campo, /@blur="\$store\.pos\.confirmarPrecio\(\)"/, 'salir del campo guarda');
});

test('estática: «Volver al precio de carta» es un enlace de la línea, solo con precio a mano y mientras se puede cambiar el precio', () => {
  assert.match(filaOrden, /<button type="button" class="btn-enlace"\s+x-show="\$store\.pos\.tienePrecioManual\(item\) && \$store\.pos\.puedeFijarPrecio\(item\) && !\$store\.pos\.editaPrecio\(item\)" x-cloak\s+:aria-label="'Volver al precio de carta de ' \+ item\.nombre"\s+@click="\$store\.pos\.volverPrecioCarta\(item\)">Volver al precio de carta<\/button>/);
});

test('estática: el POS distingue «la línea no existe» (PT404: HTTP 404) de «la orden no existe» (P0001) —un PT404 no cae en esOrdenInexistente— y ante cualquier rechazo definitivo revierte el precio, avisa y relee la cuenta', () => {
  assert.match(POS, /const CODIGO_LINEA_INEXISTENTE = 'PT404';/);
  assert.match(POS, /function esLineaInexistente\(e\) \{\s*if \(!e\) return false;\s*return e\.code === CODIGO_LINEA_INEXISTENTE \|\| \/la l\[ií\]nea \.\* no existe en la orden\/i\.test\(String\(e\.message \|\| ''\)\);\s*\}/);
  assert.match(POS, /function esOrdenInexistente\(e\) \{\s*return !!e && e\.code !== CODIGO_LINEA_INEXISTENTE && \/no existe\/i\.test\(String\(e\.message \|\| ''\)\);\s*\}/);
  assert.doesNotMatch(POS, /code === 'P0002'/, 'ya no se compara con P0002 (PostgREST lo devolvía como 500)');
  const cuerpo = POS.slice(POS.indexOf('async _intentarPrecio(clave) {'), POS.indexOf('// Deja la línea como estaba antes de tocar el precio'));
  assert.match(cuerpo, /if \(esErrorOrdenCerrada\(e\) \|\| esOrdenInexistente\(e\) \|\| esLineaInexistente\(e\)\) \{\s*soltar\(\);\s*\/\/[^\n]*\n\s*const hoy = this\.ordenes\.find\(o => o\.id === p\.ordenId\);\s*if \(!hoy \|\| hoy\.estado !== 'abierta'\) return;\s*this\._revertirPrecio\(p\);\s*this\.avisar\([^;]*\);\s*if \(this\.remoto !== 'offline'\) this\._releerOrden\(p\.ordenId, \{ forzar: true \}\)\.catch\(\(\) => \{\}\);\s*return;\s*\}/, 'revierte, avisa y relee; salvo si ESTA tablet ya cobró la cuenta (su fila cerrada lleva el precio)');
  assert.doesNotMatch(cuerpo, /esErrorOrdenCerrada\(e\) \|\| esOrdenInexistente\(e\)\) \{ soltar\(\); return; \}/, 'ya no se suelta en silencio');
  // fijarPrecioLinea y _ponerPrecioLocal trabajan sobre la cuenta del campo, no sobre la activa de ahora
  assert.match(POS, /fijarPrecioLinea\(item, precio, orden = this\._ordenEnEdicion\) \{/);
  assert.match(POS, /this\.fijarPrecioLinea\(linea, precio, orden\);/);
  assert.match(POS, /const orden = this\.ordenes\.find\(o => o\.id === e\.ordenId\);\s*if \(!orden\) return;\s*const fila = orden\.items\.find\(i => i\.id === e\.itemId\);/);
  // y el destino del precio es la línea del PLATO de ahora (la fila, o la base de la promo —reapareció o suelta—); si no hay ninguna, se avisa en vez de perderlo en silencio
  const confirmar = POS.slice(POS.indexOf('confirmarPrecio() {'), POS.indexOf('// Pone el precio de la línea (entero ≥ 0)'));
  assert.match(confirmar, /const linea = !fila \? null : esLineaPromo\(fila\) \? this\._lineaOBase\(orden, fila\.promo\.de\) : fila;\s*if \(!linea\) \{\s*if \(orden\.estado === 'abierta' && String\(e\.texto \?\? ''\)\.trim\(\)\) this\.avisar\('La cuenta cambió, vuelve a tocar el precio\.', 6000\);\s*return;\s*\}\s*if \(!this\.puedeFijarPrecio\(linea, orden\)\) return;/);
});

test('estática: la RPC y el permiso: mesero y admin (como crear y editar productos), con el nombre y los parámetros de la base', () => {
  assert.match(POS, /case 'catalogo_crear': case 'catalogo_editar': case 'ver_cierres': case 'deshacer_cobro': case 'precio_a_mano':\s*return this\.rol === 'admin' \|\| this\.rol === 'mesero';/);
  assert.match(POS, /supabaseClient\.rpc\('fijar_precio_item', \{ p_orden_id: p\.ordenId, p_item_id: p\.itemId, p_precio: p\.precio \}\)/);
  assert.match(POS, /const PRECIO_MANUAL_MAXIMO = 10000000;/, 'el mismo tope que la base');
  // Se cuenta como «algo sin guardar»: recargar espera a que el precio llegue.
  assert.match(POS, /return marcasLlevarPendientes\.size > 0 \|\| preciosPendientes\.size > 0 \|\|/);
  assert.match(POS, /this\._conPreciosPendientes\(orden\);/, 'el eco de Realtime y la lectura de reconexión no borran un precio pendiente');
});

test('estática: los + − de cada línea siguen midiendo 44 px pero sin caja ni borde (apoyo sobre papel, 6,79), y el selector «Cobrar n de qty» conserva la suya', () => {
  // El tamaño de toque no cambia: la regla base sigue en 44.
  const base = regla('.qty-btn');
  assert.match(base, /width:\s*var\(--pos-tactil\)/);
  assert.match(base, /height:\s*var\(--pos-tactil\)/);
  assert.match(base, /border:\s*1px solid var\(--color-apoyo\)/, 'la caja del selector «Cobrar n de qty» sigue');
  // Los de la línea (hijos directos de la fila): sin caja, sin borde, sin hueco.
  const linea = regla('.order-item > .qty-ctrl .qty-btn');
  assert.match(linea, /border:\s*0/);
  assert.match(linea, /background:\s*transparent/);
  assert.match(linea, /color:\s*var\(--color-apoyo\)/);
  assert.doesNotMatch(linea, /(?<![a-z-])width:|(?<![a-z-])height:/, 'no reducen el área de toque');
  assert.match(regla('.order-item > .qty-ctrl'), /gap:\s*0/);
  assert.match(regla('.order-item > .qty-ctrl .qty-btn:active:not(:disabled)'), /background:\s*var\(--color-arroz\)/);
  // Los de dentro de .sel-unidades no son hijos directos de la fila: ninguna regla discreta los alcanza.
  assert.doesNotMatch(CSS, /\.sel-unidades[^{]*\.qty-btn[^{]*\{[^}]*border:\s*0/);
  assert.match(filaOrden, /<div class="qty-ctrl" x-show="item\.precio >= 0">\s*<button class="qty-btn" @click="\$store\.pos\.quitarProducto\(item\)">−<\/button>\s*<span class="qty-val" x-text="item\.qty"><\/span>\s*<button class="qty-btn" @click="\$store\.pos\.incrementarItem\(item\)">\+<\/button>/);
});

test('estática: el campo y la pastilla no llevan colores sueltos (todo por tokens) y el campo mide 44 px sin hacer crecer la fila', () => {
  for (const sel of ['.precio-manual-marca', '.precio-edit', '.precio-edit .precio-campo', '.order-info .btn-enlace.precio-btn', '.order-item > .qty-ctrl .qty-btn']) {
    assert.doesNotMatch(regla(sel), /#[0-9A-Fa-f]{3,8}\b/, `un hex en ${sel}`);
  }
  assert.match(regla('.precio-edit .precio-campo'), /min-height:\s*var\(--pos-tactil\)/);
  assert.match(regla('.precio-edit'), /margin-block:\s*-\.625rem/, 'como los enlaces de la fila: 44 px de toque sin crecer la fila');
});

// ═════════════════════════ B. lógica: el store real ═════════════════════════

const YO = { id: 'u1', email: 'Yo@Ejemplo.test', user_metadata: { full_name: 'Yo' } };
const EJECUTIVO = { id: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, cat: 'Ejecutivos' };
const LIMONADA = { id: 'be1', nombre: 'Limonada de coco', precio: 13000, cat: 'Bebidas' };

function montar({ rol = 'admin', olaC } = {}) {
  const base = crearBaseFalsa({ mesas: [mesaBase(3)], rol, productos: [{ ...EJECUTIVO, categoria: 'Ejecutivos' }, { ...LIMONADA, categoria: 'Bebidas' }], olaC });
  const t = crearPos({ base });
  t.base = base;
  t.pos.usuario = YO;
  t.pos.rol = rol;
  t.pos.rolCargado = true;
  t.pos.productos = [{ ...EJECUTIVO }, { ...LIMONADA }];
  t.pos._esperaMarcasLlevar = () => 5;     // los reintentos, sin esperar segundos
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
const lineaEj = (qty = 2, extra = {}) => ({ ...item('ej1', 21000, qty), nombre: 'Ejecutivo de la casa', ...extra });
const lineaBe = (qty = 1, extra = {}) => ({ ...item('be1', 13000, qty), nombre: 'Limonada de coco', ...extra });
const enLaBase = (t, id = 'o1') => plano(t.base.ordenes.get(id).items);
const lineaBase = (t, itemId, id = 'o1') => enLaBase(t, id).find((i) => i.id === itemId);

test('quién puede: el mesero y el admin; no una cuenta sin rol; y solo en una cuenta ABIERTA de una mesa, no en cobrar por partes ni en un cierre', () => {
  for (const rol of ['admin', 'mesero']) {
    const t = montar({ rol });
    const o = conOrden(t, [lineaEj(), lineaBe()]);
    assert.equal(t.pos.puede('precio_a_mano'), true, rol);
    assert.equal(t.pos.puedeFijarPrecio(o.items[0]), true, rol);
  }
  const sin = montar({ rol: null });
  const os = conOrden(sin, [lineaEj()]);
  assert.equal(sin.pos.puede('precio_a_mano'), false);
  assert.equal(sin.pos.puedeFijarPrecio(os.items[0]), false);
  const t = montar();
  const o = conOrden(t, [lineaEj(), lineaBe(), { id: 'manual_x', nombre: 'Propina', precio: 5000, qty: 1, nota: '' }]);
  assert.equal(t.pos.puedeFijarPrecio(o.items[2]), true, 'un ítem manual también cambia de precio');
  assert.equal(t.pos.puedeFijarPrecio(null), false);
  t.pos.seleccionCobro = true;
  assert.equal(t.pos.puedeFijarPrecio(o.items[0]), false, 'en «Cobrar por partes» el precio no se toca');
  t.pos.seleccionCobro = false;
  t.pos.cierreEditando = { id: 'c1' };
  assert.equal(t.pos.puedeFijarPrecio(o.items[0]), false, 'una venta de un cierre');
  t.pos.cierreEditando = null;
  o.estado = 'cerrada';
  assert.equal(t.pos.puedeFijarPrecio(o.items[0]), false, 'una cuenta cobrada');
});

test('lo que no se edita: el marcador «para llevar», un abono recibido, un abono y una línea de promoción; el enlace «Volver…» solo con precio a mano de un producto', () => {
  const t = montar();
  const o = conOrden(t, [
    lineaEj(), { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' },
    { id: 'abono_recibido_1', nombre: 'Abono recibido', precio: -5000, qty: 1, nota: 'efectivo' },
    { id: 'promo:pr3:ej1', nombre: 'Ejecutivo · 3er almuerzo', precio: 16800, qty: 1, nota: '', promo: { id: 'pr3', de: 'ej1', nombre: 'Ejecutivo', precio: 21000, descuento: 20 } },
    { id: 'manual_x', nombre: 'Propina', precio: 5000, qty: 1, nota: '', precio_manual: true },
  ]);
  assert.deepEqual(o.items.map((i) => t.pos.puedeFijarPrecio(i)), [true, false, false, false, true]);
  assert.equal(t.pos.tienePrecioManual(o.items[0]), false);
  o.items[0].precio_manual = true;
  assert.equal(t.pos.tienePrecioManual(o.items[0]), true);
  assert.equal(t.pos.tienePrecioManual(o.items[4]), false, 'un ítem manual no tiene precio de carta al que volver');
});

test('una línea de promo cuya base la promo se llevó ENTERA (no hay línea base en la cuenta) sí tiene precio a mano y «Volver…»: se cambia por el id de la base; con la base presente, no', () => {
  const t = montar();
  const promo = (extra = {}) => ({ id: 'promo:pr3:ej1', nombre: 'Ejecutivo de la casa · 3er almuerzo', precio: 16800, qty: 1, nota: '', promo: { id: 'pr3', de: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20, ...extra } });
  const con = conOrden(t, [lineaEj(1), promo()]);
  assert.equal(t.pos.puedeFijarPrecio(con.items[1]), false, 'con la base presente, el precio se cambia en la base');
  assert.equal(t.pos.tienePrecioManual(con.items[1]), false);
  assert.equal(t.pos._baseEnPromo(con.items[1]), null);
  const sola = conOrden(t, [promo(), lineaBe(1)]);
  assert.equal(t.pos.puedeFijarPrecio(sola.items[0]), true, 'sin la base, la línea de promo ofrece el precio del plato');
  assert.equal(t.pos.tienePrecioManual(sola.items[0]), false);
  assert.deepEqual(plano(t.pos._baseEnPromo(sola.items[0])), { id: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, precio_manual: false, enPromo: true });
  assert.match(t.pos.etiquetaPrecio(sola.items[0]), /^Cambiar el precio de Ejecutivo de la casa \(sin el descuento: \$ 21\.000 cada una; la promoción se recalcula\)$/);
  assert.match(t.pos.etiquetaCampoPrecio(sola.items[0]), /^Precio de Ejecutivo de la casa sin el descuento \(pesos, cada unidad\)$/);
  assert.equal(t.pos.etiquetaPrecio(sola.items[1]), 'Cambiar el precio de Limonada de coco (ahora $ 13.000 cada una)', 'las demás líneas, como siempre');
  const marcada = conOrden(t, [promo({ precio: 19000, precio_manual: true, precio_por: 'a@b.test' }), lineaBe(1)]);
  assert.equal(t.pos.tienePrecioManual(marcada.items[0]), true, 'la marca la recuerda la línea de promo');
  assert.equal(t.pos.puedeFijarPrecio(marcada.items[1]), true);
  // lo demás sigue igual: ni en «Cobrar por partes» ni en una cuenta cobrada
  t.pos.seleccionCobro = true;
  assert.equal(t.pos.puedeFijarPrecio(marcada.items[0]), false);
  t.pos.seleccionCobro = false;
  marcada.estado = 'cerrada';
  assert.equal(t.pos.puedeFijarPrecio(marcada.items[0]), false);
});

test('fijar el precio: inmediato en pantalla (precio, marca, quién, importe y total) y la base queda igual, por fijar_precio_item', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(2), lineaBe(1)]);
  assert.equal(t.pos.totalOrdenActiva, 2 * 21000 + 13000);
  assert.equal(t.pos.fijarPrecioLinea(o.items[0], 20000), true);
  assert.equal(o.items[0].precio, 20000, 'síncrono: la pantalla ya cambió');
  assert.equal(o.items[0].precio_manual, true);
  assert.equal(o.items[0].precio_por, 'yo@ejemplo.test', 'en minúsculas, como lo guarda la base');
  assert.equal(o.items[0].qty, 2, 'la cantidad no se toca: el precio vale para todas las unidades');
  assert.equal(t.pos.totalOrdenActiva, 2 * 20000 + 13000);
  assert.equal(o.items[1].precio_manual, undefined, 'la otra línea no se marca');
  await asentar();
  assert.deepEqual(plano(t.base.precios), [{ orden: 'o1', item: 'ej1', precio: 20000 }]);
  assert.equal(lineaBase(t, 'ej1').precio, 20000);
  assert.equal(lineaBase(t, 'ej1').precio_manual, true);
  assert.equal(t.base.ordenes.get('o1').total, 2 * 20000 + 13000);
  assert.equal(o.version, 2, 'la versión que la base devolvió: el cierre de la cuenta manda la que esta tablet vio');
  assert.equal(t.pos.puede('precio_a_mano') && t.pos._hayCambiosSinGuardar(), false, 'ya no hay nada pendiente');
});

test('escribir el precio: Enter guarda; vacío, el mismo precio y Escape no cambian nada; algo fuera de rango avisa y deja el precio como estaba', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(2), lineaBe(1)]);
  // Abrir: el campo trae el precio de hoy.
  t.pos.abrirPrecio(o.items[0]);
  assert.deepEqual(plano(t.pos.editandoPrecio), { ordenId: 'o1', itemId: 'ej1', texto: '21000' });
  assert.equal(t.pos.editaPrecio(o.items[0]), true);
  assert.equal(t.pos.editaPrecio(o.items[1]), false);
  // Escape
  t.pos.editandoPrecio.texto = '9999'; t.pos.cancelarPrecio();
  assert.equal(t.pos.editandoPrecio, null);
  // Vacío
  t.pos.abrirPrecio(o.items[0]); t.pos.editandoPrecio.texto = ''; t.pos.confirmarPrecio();
  // El mismo precio
  t.pos.abrirPrecio(o.items[0]); t.pos.confirmarPrecio();
  // Un decimal, un negativo y más del tope (los campos solo dejan dígitos, pero el store no se fía)
  for (const malo of ['20000.50', '-5', '10000001', 'abc']) {
    t.pos.abrirPrecio(o.items[0]); t.pos.editandoPrecio.texto = malo; t.pos.confirmarPrecio();
    assert.match(t.pos.aviso.texto, /entero de \$ 0 a \$ 10\.000\.000/, malo);
    t.pos.cerrarAviso();
  }
  await asentar();
  assert.equal(o.items[0].precio, 21000);
  assert.equal(o.items[0].precio_manual, undefined);
  assert.deepEqual(t.base.precios || [], [], 'ni una llamada a la base');
  // Un valor bueno (con separador de miles, como lo escribe el campo) y 0 (una cortesía)
  t.pos.abrirPrecio(o.items[0]); t.pos.editandoPrecio.texto = '19500'; t.pos.confirmarPrecio();
  assert.equal(t.pos.editandoPrecio, null, 'confirmar cierra el campo');
  t.pos.abrirPrecio(o.items[1]); t.pos.editandoPrecio.texto = '0'; t.pos.confirmarPrecio();
  await asentar();
  assert.deepEqual(plano(t.base.precios), [{ orden: 'o1', item: 'ej1', precio: 19500 }, { orden: 'o1', item: 'be1', precio: 0 }]);
  assert.equal(o.items[1].precio, 0);
  assert.equal(o.items[1].precio_manual, true);
  // Confirmar dos veces (Enter y después el blur del campo que se cierra) no repite la subida.
  t.pos.abrirPrecio(o.items[0]); t.pos.editandoPrecio.texto = '18000'; t.pos.confirmarPrecio(); t.pos.confirmarPrecio();
  await asentar();
  assert.equal(t.base.precios.length, 3);
  // Sin permiso para abrirlo (una cuenta cobrada), no se abre.
  o.estado = 'cerrada'; t.pos.abrirPrecio(o.items[0]);
  assert.equal(t.pos.editandoPrecio, null);
});

test('las líneas de promo de esa base se recalculan al momento (el mismo descuento sobre el precio nuevo) y siguen el precio de la base cuando vuelve a la carta', async () => {
  const t = montar();
  const promo = { id: 'promo:pr3:ej1', nombre: 'Ejecutivo de la casa · 3er almuerzo · 20% OFF', precio: 16800, qty: 1, nota: '', promo: { id: 'pr3', de: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 } };
  const o = conOrden(t, [lineaEj(2), promo]);
  assert.equal(t.pos.totalOrdenActiva, 2 * 21000 + 16800);
  t.pos.fijarPrecioLinea(o.items[0], 20000);
  assert.equal(o.items[1].precio, 16000);
  assert.equal(o.items[1].promo.precio, 20000);
  assert.equal(o.items[1].promo.precio_manual, true, 'la línea de promo recuerda que su base es a mano');
  assert.equal(t.pos.totalOrdenActiva, 2 * 20000 + 16000);
  await asentar();
  assert.equal(lineaBase(t, 'promo:pr3:ej1').precio, 16000);
  // Volver a la carta: el precio de hoy de Productos (21.000) y el descuento sobre él.
  t.pos.volverPrecioCarta(o.items[0]);
  assert.equal(o.items[0].precio, 21000);
  assert.equal(o.items[0].precio_manual, undefined);
  assert.equal(o.items[0].precio_por, undefined);
  assert.equal(o.items[1].precio, 16800);
  assert.equal(o.items[1].promo.precio_manual, undefined);
  await asentar();
  assert.deepEqual(plano(t.base.precios.map((p) => p.precio)), [20000, null], 'volver a la carta manda p_precio null');
  assert.equal(lineaBase(t, 'ej1').precio_manual, undefined);
});

test('volver al precio de carta solo sirve con precio a mano; un ítem manual cambia de precio sin marca', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(1), { id: 'manual_x', nombre: 'Propina', precio: 5000, qty: 1, nota: '' }]);
  t.pos.volverPrecioCarta(o.items[0]);                       // no es a mano: nada
  t.pos.volverPrecioCarta(o.items[1]);
  await asentar();
  assert.equal(t.base.precios, undefined);
  t.pos.fijarPrecioLinea(o.items[1], 6500);
  assert.equal(o.items[1].precio, 6500);
  assert.equal(o.items[1].precio_manual, undefined, 'sin marca: nadie la refresca');
  await asentar();
  assert.equal(lineaBase(t, 'manual_x').precio, 6500);
  assert.equal(lineaBase(t, 'manual_x').precio_manual, undefined);
});

test('el precio no parpadea ni se pierde: el eco de Realtime y la lectura de la base que llegan MIENTRAS sube no lo quitan de la pantalla; confirmado, manda la base', async () => {
  const t = montar();
  t.base.latenciaMs = 25;
  const o = conOrden(t, [lineaEj(2), lineaBe(1)]);
  t.pos.fijarPrecioLinea(o.items[0], 20000);                 // sube (25 ms)…
  // …y llega el eco de OTRO cambio, con el precio de carta todavía en la línea.
  const fila = ordenBase('o1', 3, [lineaEj(2), lineaBe(3)], 5);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(fila)) });
  let hoy = t.pos.ordenes[0];
  assert.deepEqual(plano(hoy.items.map((i) => [i.id, i.qty, i.precio])), [['ej1', 2, 20000], ['be1', 3, 13000]], 'la cantidad nueva de la base entra y el precio pendiente sigue puesto');
  assert.equal(hoy.items[0].precio_manual, true);
  const fusion = t.pos._fusionarOrdenes([JSON.parse(JSON.stringify({ ...fila, version: 9 }))]);
  assert.equal(fusion[0].items[0].precio, 20000, 'la lectura de reconexión hace lo mismo');
  await dormir(80);
  assert.equal(lineaBase(t, 'ej1').precio, 20000, 'y la base termina con el precio');
  // Confirmado, ya no se repone: lo que diga la base manda (otra tablet pudo volver a la carta).
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify({ ...fila, version: 20 })) });
  assert.equal(t.pos.ordenes[0].items[0].precio, 21000);
});

test('dos toques seguidos de la misma línea salen en orden y gana el último; y volver a la carta justo después de un precio también', async () => {
  const t = montar();
  t.base.latenciaMs = 15;
  const o = conOrden(t, [lineaEj(2)]);
  t.pos.fijarPrecioLinea(o.items[0], 20000);
  t.pos.fijarPrecioLinea(o.items[0], 19000);
  await dormir(120);
  assert.equal(lineaBase(t, 'ej1').precio, 19000);
  assert.equal(o.items[0].precio, 19000);
  t.pos.fijarPrecioLinea(o.items[0], 18000);
  t.pos.volverPrecioCarta(o.items[0]);
  await dormir(120);
  assert.equal(lineaBase(t, 'ej1').precio, 21000);
  assert.equal(lineaBase(t, 'ej1').precio_manual, undefined);
  assert.equal(o.items[0].precio, 21000);
});

test('sin red el precio se reintenta (aquí 5 ms) y llega cuando la red vuelve; recargar espera (cuenta como «algo sin guardar»); al volver la red, `online` lo sube de una vez', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(2)]);
  t.base.red = false;
  t.pos.fijarPrecioLinea(o.items[0], 20000);
  // Con reintentos cada 5 ms y tope de 8 intentos, el pendiente vive ~40 ms: se mira a los 12 ms (dos o tres intentos adentro),
  // no a los 40, que en el runner de la CI ya se los había comido todos (2026-10-06).
  await dormir(12);
  assert.equal(t.pos._hayCambiosSinGuardar(), true, 'recargar encima se lo llevaría: espera');
  assert.equal(lineaBase(t, 'ej1').precio, 21000, 'la base aún no lo tiene');
  assert.equal(o.items[0].precio, 20000, 'pero la pantalla lo muestra');
  t.base.red = true;
  assert.equal(await hastaQue(() => lineaBase(t, 'ej1').precio === 20000), true, 'a la primera vuelta con red llega');
  await asentar();
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
  // Fuera de línea (`remoto`): no se intenta, queda pendiente, y al volver `online` lo sube.
  t.pos.remoto = 'offline';
  t.pos.fijarPrecioLinea(o.items[0], 17000);
  await dormir(40);
  assert.equal(lineaBase(t, 'ej1').precio, 20000, 'offline no sale nada');
  assert.equal(t.pos._hayCambiosSinGuardar(), true);
  t.pos.remoto = 'ok';
  t.pos._escucharEntorno();
  t.eventosVentana.online();
  assert.equal(await hastaQue(() => lineaBase(t, 'ej1').precio === 17000), true);
});

test('espera a la línea: con un delta de ESA línea sin subir (cola sin red) el precio no sale, porque la base aún no la tiene; sale cuando la cola se vacía', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(2)]);
  t.pos.colaDeltas = [{ id: 'd1', orden_id: 'o1', item_id: 'ej1', nombre: 'Ejecutivo', precio: 21000, nota: '', delta: 1 }];
  t.pos.fijarPrecioLinea(o.items[0], 20000);
  await dormir(60);
  assert.equal(t.base.precios, undefined, 'esperando el delta');
  t.pos.colaDeltas = [];
  assert.equal(await hastaQue(() => (t.base.precios || []).length === 1), true);
});

test('un precio que no se pudo guardar tras 8 intentos avisa con la mesa y la línea; la pantalla ya no lo repone', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(2)]);
  t.base.fallar('rpc:fijar_precio_item');
  t.pos.fijarPrecioLinea(o.items[0], 20000);
  assert.equal(await hastaQue(() => /No se pudo guardar el precio de «Ejecutivo de la casa» en la mesa 3/.test(t.pos.aviso?.texto || ''), { ms: 4000 }), true);
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(ordenBase('o1', 3, [lineaEj(2)], 9))) });
  assert.equal(t.pos.ordenes[0].items[0].precio, 21000, 'lo que diga la base');
});

test('la base lo rechaza por permisos (42501): no se reintenta, el precio vuelve a como estaba y se avisa; una cuenta cerrada en la base también lo deja como estaba y lo avisa', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(2, { precio_manual: true, precio_por: 'otra@ejemplo.test', precio: 19000 })]);
  t.base.rol = null;
  t.pos.fijarPrecioLinea(o.items[0], 15000);
  assert.equal(o.items[0].precio, 15000);
  await asentar();
  assert.equal(o.items[0].precio, 19000, 'vuelve al precio a mano que tenía');
  assert.equal(o.items[0].precio_manual, true);
  assert.equal(o.items[0].precio_por, 'otra@ejemplo.test');
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
  // La base ya tiene la cuenta cerrada (otra tablet cobró): «no existe» para el mesero; nada que reintentar, y el precio que la base nunca aceptó no se queda en pantalla.
  const u = montar({ rol: 'mesero' });
  const ou = conOrden(u, [lineaEj(2)]);
  u.base.ordenes.get('o1').estado = 'cerrada';
  u.pos.fijarPrecioLinea(ou.items[0], 15000);
  await asentar();
  assert.equal(u.pos._hayCambiosSinGuardar(), false);
  assert.equal(u.base.precios, undefined);
  assert.equal(ou.items[0].precio, 21000, 'el precio vuelve a como estaba');
  assert.equal(ou.items[0].precio_manual, undefined);
  assert.match(u.pos.aviso.texto, /La cuenta de la mesa 3 cambió: el precio de «Ejecutivo de la casa» no se guardó\. Quedó como estaba\./);
});

test('la base contesta «la línea X no existe en la orden Y» (PT404, HTTP 404; con la RPC vieja, P0001 con el mismo texto): no es «orden no existe», el precio vuelve a como estaba, se avisa y se relee la cuenta', async () => {
  for (const code of ['PT404', 'P0001']) {
    const t = montar();
    // En la base la cuenta YA NO tiene la línea ej1 (otra tablet la quitó); esta tablet todavía la ve.
    const o = conOrden(t, [lineaEj(2), lineaBe(1)]);
    t.base.ordenes.get('o1').items = [lineaBe(2)];
    const original = t.base.responder;
    if (code === 'P0001') t.base.responder = async (c) => (c.tipo === 'rpc' && c.nombre === 'fijar_precio_item' ? { data: null, error: { code: 'P0001', message: `la línea ${c.args.p_item_id} no existe en la orden ${c.args.p_orden_id}` } } : original(c));
    assert.equal(t.pos.fijarPrecioLinea(o.items[0], 15000), true);
    assert.equal(o.items[0].precio, 15000, 'síncrono: la pantalla ya cambió');
    await asentar(40);
    assert.equal(t.base.precios, undefined, `${code}: la base no escribió nada`);
    const hoy = t.pos.ordenes[0];
    assert.equal(hoy.items.find((i) => i.id === 'ej1'), undefined, `${code}: la lectura de la base manda: la línea ya no está, y el precio a mano que nunca aceptó tampoco`);
    assert.equal(t.pos._hayCambiosSinGuardar(), false, `${code}: ya no hay nada pendiente`);
    assert.match(t.pos.aviso.texto, /La cuenta de la mesa 3 cambió: el precio de «Ejecutivo de la casa» no se guardó\. Quedó como estaba\./, code);
    assert.ok(!hoy.items.some((i) => i.precio_manual), `${code}: ninguna marca sin confirmar`);
    assert.equal(hoy.items.find((i) => i.id === 'be1').qty, 2, `${code}: lo que dice la base`);
  }
});

test('si mientras sube ESTA tablet cobró la cuenta, el rechazo «cerrada» de la base no revierte el precio ni avisa: la fila cerrada que subió ya lo lleva', async () => {
  const t = montar();
  t.base.latenciaMs = 30;
  const o = conOrden(t, [lineaEj(2)]);
  t.pos.fijarPrecioLinea(o.items[0], 15000);                 // sube (30 ms)…
  o.estado = 'cerrada';                                      // …y esta tablet cobra la cuenta antes de que conteste
  t.base.ordenes.get('o1').estado = 'cerrada';
  await dormir(120);
  assert.equal(o.items[0].precio, 15000, 'el precio que se cobró se queda');
  assert.equal(t.pos.aviso, null, 'sin aviso');
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
});

test('el campo abierto en una mesa y la cuenta activa que cambia antes de confirmar: el precio va a la LÍNEA QUE SE TOCÓ (la cuenta del campo), no a la activa de ahora', async () => {
  const t = montar();
  t.base.ordenes.set('o3', { ...ordenBase('o3', 3, [lineaEj(2)], 1) });
  t.base.ordenes.set('o4', { ...ordenBase('o4', 4, [lineaEj(1)], 1) });
  t.pos.mesas = [mesaBase(3), mesaBase(4)];
  t.pos.ordenes = [ordenLocal('o3', 3, [lineaEj(2)], 1), ordenLocal('o4', 4, [lineaEj(1)], 1)];
  t.pos.mesaActiva = t.pos.mesas[0];
  t.pos.ordenActiva = t.pos.ordenes[0];
  t.pos.remoto = 'ok';
  const [o3, o4] = t.pos.ordenes;
  t.pos.abrirPrecio(o3.items[0]);
  assert.equal(t.pos.editandoPrecio.ordenId, 'o3');
  t.pos.editandoPrecio.texto = '15000';
  // la cuenta activa cambia sin que el campo se confirme (lo que haría cualquier cambio de mesa que no sea un toque)
  t.pos.mesaActiva = t.pos.mesas[1];
  t.pos.ordenActiva = t.pos.ordenes[1];
  t.pos.confirmarPrecio();
  assert.equal(o3.items[0].precio, 15000, 'la pantalla cambia la línea de la mesa 3');
  assert.equal(o3.items[0].precio_manual, true);
  assert.equal(o4.items[0].precio, 21000, 'la de la mesa 4 no se toca');
  assert.equal(o4.items[0].precio_manual, undefined);
  await asentar(30);
  assert.deepEqual(plano(t.base.precios), [{ orden: 'o3', item: 'ej1', precio: 15000 }], 'a la base, solo la cuenta del campo');
  assert.equal(t.base.ordenes.get('o3').items[0].precio, 15000);
  assert.equal(t.base.ordenes.get('o4').items[0].precio, 21000);
});

test('promo que se llevó la base entera: tocar el precio de la línea de promo abre el campo con el precio del plato (sin descuento), guarda por el id de la base, recalcula la promo al momento y «Volver» manda null', async () => {
  const t = montar();
  const promo = { id: 'promo:pr3:ej1', nombre: 'Ejecutivo de la casa · 3er almuerzo', precio: 16800, qty: 1, nota: '', promo: { id: 'pr3', de: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 } };
  const o = conOrden(t, [promo, lineaBe(1)]);
  const fila = o.items[0];
  assert.equal(t.pos.totalOrdenActiva, 16800 + 13000);
  t.pos.abrirPrecio(fila);
  assert.deepEqual(plano(t.pos.editandoPrecio), { ordenId: 'o1', itemId: 'promo:pr3:ej1', texto: '21000' }, 'el campo trae el precio del plato, no el de la línea con el descuento');
  assert.equal(t.pos.editaPrecio(fila), true);
  t.pos.editandoPrecio.texto = '19000';
  t.pos.confirmarPrecio();
  assert.equal(fila.promo.precio, 19000, 'síncrono: el precio del plato');
  assert.equal(fila.promo.precio_manual, true, 'la marca vive en la línea de promo');
  assert.equal(fila.promo.precio_por, 'yo@ejemplo.test');
  assert.equal(fila.precio, 15200, 'la línea con el mismo descuento sobre el precio nuevo');
  assert.equal(t.pos.totalOrdenActiva, 15200 + 13000);
  assert.equal(t.pos.tienePrecioManual(fila), true);
  assert.equal(o.items.length, 2, 'la pantalla no inventa una línea base: la base la despliega la base de datos');
  await asentar();
  assert.deepEqual(plano(t.base.precios), [{ orden: 'o1', item: 'ej1', precio: 19000 }], 'por el id de la base, no el de la promo');
  const guardada = lineaBase(t, 'promo:pr3:ej1');
  assert.equal(guardada.promo.precio, 19000);
  assert.equal(guardada.promo.precio_manual, true);
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
  // un cambio igual al de ahora no sube nada; Volver al precio de carta: el de hoy en Productos (21.000) y el 20 % sobre él
  t.pos.abrirPrecio(fila);
  t.pos.editandoPrecio.texto = '19000';
  t.pos.confirmarPrecio();
  await asentar();
  assert.equal(t.base.precios.length, 1, 'el mismo precio no sube nada');
  t.pos.volverPrecioCarta(fila);
  assert.equal(fila.promo.precio, 21000);
  assert.equal(fila.promo.precio_manual, undefined);
  assert.equal(fila.promo.precio_por, undefined);
  assert.equal(fila.precio, 16800);
  assert.equal(t.pos.tienePrecioManual(fila), false);
  await asentar();
  assert.deepEqual(plano(t.base.precios.map((p) => [p.item, p.precio])), [['ej1', 19000], ['ej1', null]]);
  assert.equal(lineaBase(t, 'promo:pr3:ej1').promo.precio_manual, undefined);
});

test('V1 de la refutación (ronda 2), invertido: el campo abierto sobre la línea de promo SIN base y un eco que trae la base de vuelta antes de Enter: lo escrito va a la BASE (por su id), no se pierde en silencio', async () => {
  const t = montar();
  const promo = () => ({ id: 'promo:pr3:ej1', nombre: 'Ejecutivo de la casa · 3er almuerzo', precio: 16800, qty: 1, nota: '', promo: { id: 'pr3', de: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 } });
  const o = conOrden(t, [promo(), lineaBe(1)]);
  t.pos.abrirPrecio(o.items[0]);
  assert.deepEqual(plano(t.pos.editandoPrecio), { ordenId: 'o1', itemId: 'promo:pr3:ej1', texto: '21000' });
  // otra tablet sumó una unidad del plato desde la carta: la base vuelve (sin marca) y la promo sigue
  const eco = ordenBase('o1', 3, [lineaEj(1), promo(), lineaBe(1)], 2);
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(eco)) });
  const hoy = t.pos.ordenes[0];
  assert.ok(hoy.items.some((i) => i.id === 'ej1'), 'la base reapareció');
  t.pos.editandoPrecio.texto = '19000';
  t.pos.confirmarPrecio();
  assert.equal(t.pos.editandoPrecio, null, 'el campo se cerró');
  const base = hoy.items.find((i) => i.id === 'ej1');
  assert.equal(base.precio, 19000, 'síncrono: el precio va a la base');
  assert.equal(base.precio_manual, true);
  assert.equal(hoy.items.find((i) => i.id === 'promo:pr3:ej1').promo.precio, 19000, 'y la línea de promo recalcula sobre él');
  assert.equal(hoy.items.find((i) => i.id === 'promo:pr3:ej1').precio, 15200);
  assert.equal(t.pos.aviso, null, 'sin aviso: se guardó');
  await asentar();
  assert.deepEqual(plano(t.base.precios), [{ orden: 'o1', item: 'ej1', precio: 19000 }], 'a la base, por el id del plato (no el de la promo)');
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
});

test('el campo abierto sobre la línea de promo sin base y la línea desaparece del todo antes de Enter (la promo se desarma y la base vuelve en otra línea, o el plato se va): ya no se pierde en silencio; si la base está se guarda en ella, si no hay línea alguna se avisa', async () => {
  const promo = () => ({ id: 'promo:pr3:ej1', nombre: 'Ejecutivo de la casa · 3er almuerzo', precio: 16800, qty: 1, nota: '', promo: { id: 'pr3', de: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 } });
  // (a) alguien quitó un plato: la promo se desarma, la línea de promo ya no está y la base vuelve (la fila del campo no existe más)
  const a = montar();
  const oa = conOrden(a, [promo(), lineaBe(1)]);
  a.pos.abrirPrecio(oa.items[0]);
  a.pos.editandoPrecio.texto = '19000';
  a.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(ordenBase('o1', 3, [lineaEj(1), lineaBe(1)], 2))) });
  assert.equal(a.pos.ordenes[0].items.some((i) => i.id === 'promo:pr3:ej1'), false);
  a.pos.confirmarPrecio();
  assert.equal(a.pos.aviso.texto, 'La cuenta cambió, vuelve a tocar el precio.', 'lo escrito no se pudo poner en ningún lado y la persona lo sabe');
  assert.equal(a.pos.aviso.texto.length < 60, true, 'en una línea');
  await asentar();
  assert.equal(a.base.precios, undefined, 'a la base no llegó nada');
  assert.equal(a.pos.ordenes[0].items.find((i) => i.id === 'ej1').precio, 21000, 'y el precio de la pantalla es el de la carta');
  // (b) el plato se fue entero: ni la promo ni la base
  const b = montar();
  const ob = conOrden(b, [promo(), lineaBe(1)]);
  b.pos.abrirPrecio(ob.items[0]);
  b.pos.editandoPrecio.texto = '19000';
  b.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(ordenBase('o1', 3, [lineaBe(1)], 2))) });
  b.pos.confirmarPrecio();
  assert.equal(b.pos.aviso.texto, 'La cuenta cambió, vuelve a tocar el precio.');
  await asentar();
  assert.equal(b.base.precios, undefined);
  // (c) la fila SIGUE y la base sigue ausente: como siempre, el precio va por el id de la base y no hay aviso
  const c = montar();
  const oc = conOrden(c, [promo(), lineaBe(1)]);
  c.pos.abrirPrecio(oc.items[0]);
  c.pos.editandoPrecio.texto = '19000';
  c.pos.confirmarPrecio();
  assert.equal(c.pos.aviso, null);
  await asentar();
  assert.deepEqual(plano(c.base.precios), [{ orden: 'o1', item: 'ej1', precio: 19000 }]);
  // (d) un campo vacío sobre una línea que desapareció no avisa (no había nada escrito)
  const d = montar();
  const od = conOrden(d, [promo(), lineaBe(1)]);
  d.pos.abrirPrecio(od.items[0]);
  d.pos.editandoPrecio.texto = '';
  d.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(ordenBase('o1', 3, [lineaBe(1)], 2))) });
  d.pos.confirmarPrecio();
  assert.equal(d.pos.aviso, null);
});

test('promo que se llevó la base entera: el eco de Realtime que llega MIENTRAS sube no quita el precio de la pantalla; sin red se reintenta y llega; la base que la rechaza lo deja como estaba', async () => {
  const t = montar();
  t.base.latenciaMs = 25;
  const promo = () => ({ id: 'promo:pr3:ej1', nombre: 'Ejecutivo de la casa · 3er almuerzo', precio: 16800, qty: 1, nota: '', promo: { id: 'pr3', de: 'ej1', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 } });
  const o = conOrden(t, [promo(), lineaBe(1)]);
  t.pos.abrirPrecio(o.items[0]);
  t.pos.editandoPrecio.texto = '19000';
  t.pos.confirmarPrecio();                                      // sube (25 ms)…
  const fila = ordenBase('o1', 3, [promo(), lineaBe(3)], 5);    // …y llega el eco de OTRO cambio, con el precio de carta todavía en la promo
  t.pos.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(fila)) });
  const hoy = t.pos.ordenes[0];
  assert.equal(hoy.items[0].promo.precio, 19000, 'el precio pendiente sigue puesto sobre lo que llegó');
  assert.equal(hoy.items[0].promo.precio_manual, true);
  assert.equal(hoy.items[0].precio, 15200);
  assert.equal(hoy.items[1].qty, 3, 'y la cantidad nueva de la base entra');
  await dormir(80);
  assert.equal(lineaBase(t, 'promo:pr3:ej1').promo.precio, 19000);
  // sin red: se reintenta y llega cuando vuelve
  t.base.red = false;
  t.pos.abrirPrecio(t.pos.ordenes[0].items[0]);
  t.pos.editandoPrecio.texto = '18000';
  t.pos.confirmarPrecio();
  await dormir(40);
  assert.equal(t.pos._hayCambiosSinGuardar(), true);
  assert.equal(lineaBase(t, 'promo:pr3:ej1').promo.precio, 19000, 'la base aún no lo tiene');
  t.base.red = true;
  assert.equal(await hastaQue(() => lineaBase(t, 'promo:pr3:ej1').promo.precio === 18000), true);
  await asentar();
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
  // la base ya no tiene la promo ni la línea (otra tablet la quitó): se revierte, se avisa y se relee
  t.base.ordenes.get('o1').items = [lineaBe(3)];
  t.pos.abrirPrecio(t.pos.ordenes[0].items[0]);
  t.pos.editandoPrecio.texto = '15000';
  t.pos.confirmarPrecio();
  assert.equal(await hastaQue(() => /La cuenta de la mesa 3 cambió: el precio de «Ejecutivo de la casa» no se guardó/.test(t.pos.aviso?.texto || ''), { ms: 2000 }), true);
  await dormir(80);
  assert.equal(t.pos.ordenes[0].items.some((i) => i.promo), false, 'la lectura de la base manda');
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
});

test('la base sin la migración (PGRST202): el POS lo dice, deja el precio como estaba y no reintenta', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(2)]);
  t.base.sinFuncion.add('fijar_precio_item');
  t.pos.fijarPrecioLinea(o.items[0], 20000);
  await asentar();
  assert.match(t.pos.aviso.texto, /Todavía no se puede poner el precio a mano: falta aplicar la actualización de la base/);
  assert.equal(o.items[0].precio, 21000);
  assert.equal(o.items[0].precio_manual, undefined);
  assert.equal(t.pos._hayCambiosSinGuardar(), false);
  assert.equal(t.base.precios, undefined);
});

test('la base rechaza el precio (22023, por si el POS y la base no coinciden en el tope): se avisa y vuelve el precio de antes', async () => {
  const t = montar();
  const o = conOrden(t, [lineaEj(2)]);
  const original = t.base.responder;
  t.base.responder = async (c) => (c.tipo === 'rpc' && c.nombre === 'fijar_precio_item' ? { data: null, error: { code: '22023', message: 'precio inválido (20000): pesos enteros, de 0 a 10.000.000' } } : original(c));
  t.pos.fijarPrecioLinea(o.items[0], 20000);
  await asentar();
  assert.match(t.pos.aviso.texto, /La base no aceptó el precio de «Ejecutivo de la casa»/);
  assert.equal(o.items[0].precio, 21000);
});

test('cobrar la cuenta con un precio pendiente: espera a que llegue, y el cierre lleva el precio a mano; y «deshacer» un cobro local conserva la marca', async () => {
  const t = montar();
  t.base.latenciaMs = 20;
  const o = conOrden(t, [lineaEj(2, { precio_manual: true, precio: 19000, precio_por: 'a@b.test' }), lineaBe(1)]);
  assert.equal(o.items.length, 2);
  // _devolverLocal: lo cobrado vuelve a la cuenta con su marca de precio a mano.
  const abierta = { id: 'o1', items: [lineaBe(1)], total: 0 };
  t.pos._devolverLocal({ id: 'c1', items: [lineaEj(1, { precio_manual: true, precio: 19000, precio_por: 'a@b.test' })] }, abierta);
  assert.deepEqual(plano(abierta.items.map((i) => [i.id, i.precio, i.precio_manual, i.precio_por])), [['be1', 13000, null, null], ['ej1', 19000, true, 'a@b.test']]);
  // Fijar y cobrar enseguida: el cobro espera la subida del precio (queda registrada como en vuelo).
  t.pos.fijarPrecioLinea(o.items[0], 18000);
  assert.equal(t.pos._hayDeltasEnVuelo('o1'), true, 'la cuenta tiene una subida en vuelo: cobrar la espera');
  await dormir(120);
  assert.equal(lineaBase(t, 'ej1').precio, 18000);
  assert.equal(t.pos._hayDeltasEnVuelo('o1'), false);
});

// ═════════════════════════ C. en navegador ═════════════════════════

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

// El reloj fijo del arnés es el miércoles 2026-09-30 (3). La cuenta de la mesa 3 trae el «Ejecutivo de la casa» (×2, 21.000), las empanadas y la limonada;
// se le suma una línea de promoción de su base para ver que esa NO se edita.
const conPromo = (d) => {
  d.tablas.productos.push({ id: 'pr3', categoria: 'Promociones', nombre: '3er almuerzo', precio: 0, descripcion: 'x', activo: true, etiqueta: '20% OFF', dia_semana: 3,
    promo_regla: { cada: 3, descuento: 20, aplica: { categorias: ['Ejecutivos'] } } });
  const o = d.tablas.ordenes.find((x) => x.id === 'ord-abierta-3');
  o.items.push({ id: 'promo:pr3:ej1__sopa-pollo', nombre: 'Ejecutivo de la casa · 3er almuerzo · 20% OFF', precio: 16800, qty: 1, nota: 'Sopa · Pollo',
    promo: { id: 'pr3', de: 'ej1__sopa-pollo', nombre: 'Ejecutivo de la casa', precio: 21000, descuento: 20 } });
  o.total = o.items.reduce((s, i) => s + i.precio * i.qty, 0);
};

// La promo se llevó la base ENTERA: en la cuenta de la mesa 3 solo queda la línea de promo del Ejecutivo (1 × 16.800, de 21.000 menos 20 %).
const sinBaseDelEjecutivo = (d) => {
  const o = d.tablas.ordenes.find((x) => x.id === 'ord-abierta-3');
  o.items = o.items.filter((i) => i.id !== 'ej1__sopa-pollo');
  o.total = o.items.reduce((s, i) => s + i.precio * i.qty, 0);
};

async function abrirOrden(t, ancho, { rol, sinBase } = {}) {
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
      const errores = [];
      page.on('pageerror', (e) => errores.push(String(e)));
      const { diag } = await abrirPos(page, { url: servidor.url, vista: 'orden', ajustar: (d) => { conPromo(d); if (sinBase) sinBaseDelEjecutivo(d); if (rol) d.rol = rol; } });
      return { page, diag, errores };
    } catch (e) { ultimo = e; await ctx?.close().catch(() => {}); }
  }
  t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(ultimo.message).split('\n')[0]}`);
  return null;
}
const filas = (page) => page.locator('.order-item:visible');
const fila = (page, nombre) => page.locator('.order-item:visible', { hasText: nombre }).first();
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const base = (page, nombre) => page.evaluate((n) => { const o = window.__posSim.tablas.ordenes.find((x) => x.id === 'ord-abierta-3'); return JSON.parse(JSON.stringify(o.items.find((i) => i.nombre === n))); }, nombre);
const llamadasPrecio = (page) => page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'rpc' && l.nombre === 'fijar_precio_item').map((l) => l.args));
const caja = async (loc) => (await loc.boundingBox());
const reposo = (page) => page.waitForTimeout(250);
/** Toca el precio de la línea y espera a que el campo tenga el foco (lo toma en el siguiente ciclo de Alpine). */
const abrirCampo = async (page, ej) => {
  await ej.locator('.precio-btn').click();
  await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('precio-campo'));
};

for (const ancho of [390, 1280]) {
  test(`navegador ${ancho}: tocar el precio abre el campo en la misma línea, Enter lo guarda (importe, total y base), «a mano» y «Volver al precio de carta»`, { skip: SALTAR }, async (t) => {
    const r = await abrirOrden(t, ancho);
    if (!r) return;
    const { page, errores } = r;
    const ej = fila(page, 'Ejecutivo de la casa').first();
    const boton = ej.locator('.precio-btn');
    assert.equal(await boton.count(), 1);
    const b = await caja(boton);
    assert.ok(b.height >= 44 - 0.5 && b.width >= 44 - 0.5, `el precio mide ${b.width}×${b.height}: es un blanco táctil de 44 px`);
    assert.equal((await boton.innerText()).replace(/\s+/g, ' ').trim(), '$ 21.000');
    assert.equal(await ej.locator('.precio-manual-marca').isVisible(), false, 'sin precio a mano no hay pastilla');
    assert.equal(await ej.getByText('Volver al precio de carta').isVisible(), false);
    const alto0 = (await caja(ej)).height;
    // Tocar: el campo ocupa el lugar del precio, con foco y el valor seleccionado.
    await abrirCampo(page, ej);
    const campo = ej.locator('.precio-campo');
    assert.equal(await campo.count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('precio-campo')), true, 'el campo tiene el foco');
    assert.equal(await page.evaluate(() => { const e = document.activeElement; return e.selectionStart === 0 && e.selectionEnd === e.value.length; }), true, 'con el valor seleccionado: escribir lo reemplaza');
    assert.equal(await campo.inputValue(), '21.000');
    assert.equal(await campo.getAttribute('inputmode'), 'numeric');
    const c = await caja(campo);
    assert.ok(c.height >= 44 - 0.5, `el campo mide ${c.height} de alto`);
    const fcampo = await caja(ej);
    assert.ok(Math.abs(fcampo.height - alto0) <= 24, `editar no revienta la línea (${alto0} → ${fcampo.height})`);
    assert.ok(await sinDesborde(page) <= 0, 'sin desborde horizontal con el campo abierto');
    // Escribir: solo dígitos y con separador de miles.
    await page.keyboard.type('20a000');
    assert.equal(await campo.inputValue(), '20.000');
    await page.keyboard.press('Enter');
    await reposo(page);
    assert.equal(await campo.count(), 0, 'Enter cierra el campo');
    assert.equal((await ej.locator('.precio-btn').innerText()).replace(/\s+/g, ' ').trim(), '$ 20.000 a mano');
    assert.equal(await ej.locator('.precio-manual-marca').isVisible(), true);
    assert.match(await ej.innerText(), /\$ 40\.000/, 'el importe de la línea: 2 × 20.000');
    const guardado = await base(page, 'Ejecutivo de la casa');
    assert.equal(guardado.precio, 20000);
    assert.equal(guardado.precio_manual, true);
    assert.equal(guardado.precio_por, 'mesero.demo@ejemplo.test');
    assert.equal(guardado.qty, 2);
    assert.deepEqual(await llamadasPrecio(page), [{ p_orden_id: 'ord-abierta-3', p_item_id: 'ej1__sopa-pollo', p_precio: 20000 }]);
    // La línea de promo siguió a su base (80 % de 20.000) y NO se edita: su precio es texto.
    const promo = fila(page, '3er almuerzo');
    assert.match(await promo.innerText(), /\$ 16\.000/);
    assert.equal(await promo.locator('.precio-btn').count(), 1, 'la plantilla repite el botón en cada línea…');
    assert.equal(await promo.locator('.precio-btn').isVisible(), false, '…pero en la línea de promo no se ve');
    assert.equal(await promo.locator('.precio-unit').isVisible(), true, 'y su precio es texto');
    // Volver al precio de carta.
    const volver = ej.getByText('Volver al precio de carta');
    assert.equal(await volver.isVisible(), true);
    assert.ok((await caja(volver)).height >= 44 - 0.5, 'el enlace mide 44 px de toque');
    await volver.click();
    await reposo(page);
    assert.equal((await ej.locator('.precio-btn').innerText()).replace(/\s+/g, ' ').trim(), '$ 21.000');
    assert.equal(await ej.getByText('Volver al precio de carta').isVisible(), false);
    const vuelta = await base(page, 'Ejecutivo de la casa');
    assert.equal(vuelta.precio, 21000);
    assert.equal(vuelta.precio_manual, undefined);
    assert.equal((await llamadasPrecio(page)).at(-1).p_precio, null);
    assert.ok(await sinDesborde(page) <= 0);
    assert.deepEqual(errores, []);
  });

  test(`navegador ${ancho}: la promo se llevó la base entera: la línea de promo ofrece el precio del plato y «Volver al precio de carta» (por el id de la base), con la marca «a mano»`, { skip: SALTAR }, async (t) => {
    const r = await abrirOrden(t, ancho, { sinBase: true });
    if (!r) return;
    const { page, errores } = r;
    const promo = fila(page, '3er almuerzo');
    assert.equal(await filas(page).filter({ hasText: 'Ejecutivo de la casa' }).count(), 1, 'solo está la línea de promo: no hay línea base');
    const boton = promo.locator('.precio-btn');
    assert.equal(await boton.isVisible(), true, 'la línea de promo sin base tiene el precio como botón');
    const b = await caja(boton);
    assert.ok(b.height >= 44 - 0.5 && b.width >= 44 - 0.5, `el precio mide ${b.width}×${b.height}: un blanco táctil de 44 px`);
    assert.equal((await boton.innerText()).replace(/\s+/g, ' ').trim(), '$ 16.800');
    assert.match(await boton.getAttribute('aria-label'), /^Cambiar el precio de Ejecutivo de la casa \(sin el descuento: \$ 21\.000 cada una; la promoción se recalcula\)$/);
    assert.equal(await promo.locator('.precio-unit').isVisible(), false, 'ya no es texto');
    assert.equal(await promo.locator('.precio-manual-marca').isVisible(), false);
    assert.equal(await promo.getByText('Volver al precio de carta').isVisible(), false);
    assert.equal(await promo.getByText('−20 % por promoción').isVisible(), true, 'y sigue diciendo que es promoción');
    // Tocar: el campo trae el precio del PLATO (21.000), no el de la línea con descuento.
    await abrirCampo(page, promo);
    const campo = promo.locator('.precio-campo');
    assert.equal(await campo.inputValue(), '21.000');
    assert.match(await campo.getAttribute('aria-label'), /^Precio de Ejecutivo de la casa sin el descuento \(pesos, cada unidad\)$/);
    assert.ok(await sinDesborde(page) <= 0, 'sin desborde horizontal con el campo abierto');
    await page.keyboard.type('19000');
    await page.keyboard.press('Enter');
    await reposo(page);
    assert.equal((await promo.locator('.precio-btn').innerText()).replace(/\s+/g, ' ').trim(), '$ 15.200 a mano', 'el 20 % sobre 19.000');
    assert.equal(await promo.locator('.precio-manual-marca').isVisible(), true);
    assert.deepEqual(await llamadasPrecio(page), [{ p_orden_id: 'ord-abierta-3', p_item_id: 'ej1__sopa-pollo', p_precio: 19000 }], 'por el id de la BASE');
    const guardada = await page.evaluate(() => { const o = window.__posSim.tablas.ordenes.find((x) => x.id === 'ord-abierta-3'); return JSON.parse(JSON.stringify(o.items.find((i) => i.id === 'promo:pr3:ej1__sopa-pollo'))); });
    assert.equal(guardada.promo.precio, 19000);
    assert.equal(guardada.promo.precio_manual, true);
    assert.equal(guardada.precio, 15200);
    // Volver al precio de carta, también por la base.
    const volver = promo.getByText('Volver al precio de carta');
    assert.equal(await volver.isVisible(), true);
    assert.ok((await caja(volver)).height >= 44 - 0.5, 'el enlace mide 44 px de toque');
    await volver.click();
    await reposo(page);
    assert.equal((await promo.locator('.precio-btn').innerText()).replace(/\s+/g, ' ').trim(), '$ 16.800');
    assert.equal(await promo.locator('.precio-manual-marca').isVisible(), false);
    assert.equal(await promo.getByText('Volver al precio de carta').isVisible(), false);
    assert.deepEqual((await llamadasPrecio(page)).at(-1), { p_orden_id: 'ord-abierta-3', p_item_id: 'ej1__sopa-pollo', p_precio: null });
    assert.ok(await sinDesborde(page) <= 0);
    assert.deepEqual(errores, []);
  });

  test(`navegador ${ancho}: Escape cancela, salir del campo guarda, un campo vacío no cambia nada, y el total de la barra sigue al precio`, { skip: SALTAR }, async (t) => {
    const r = await abrirOrden(t, ancho);
    if (!r) return;
    const { page, errores } = r;
    const ej = fila(page, 'Ejecutivo de la casa').first();
    const total = () => page.locator('.barra-accion .total-grande, .barra-accion [class*="total"]').first().innerText().then((x) => x.replace(/\s+/g, ' '));
    await abrirCampo(page, ej);
    await page.keyboard.type('5');
    await page.keyboard.press('Escape');
    await reposo(page);
    assert.equal(await ej.locator('.precio-campo').count(), 0, 'Escape cierra el campo');
    assert.deepEqual(await llamadasPrecio(page), [], 'Escape no guarda nada');
    assert.equal((await base(page, 'Ejecutivo de la casa')).precio, 21000);
    // vacío
    await abrirCampo(page, ej);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await reposo(page);
    assert.deepEqual(await llamadasPrecio(page), [], 'un campo vacío no cambia nada');
    assert.equal((await ej.locator('.precio-btn').innerText()).replace(/\s+/g, ' ').trim(), '$ 21.000');
    // salir: tocar fuera guarda
    await abrirCampo(page, ej);
    await page.keyboard.type('18500');
    await fila(page, 'Limonada').locator(':scope > .importe').click();   // fuera del campo: el importe de otra línea (el nombre queda bajo el blanco de 44 px de un enlace de la fila de arriba)
    await reposo(page);
    assert.equal(await ej.locator('.precio-campo').count(), 0);
    assert.equal((await base(page, 'Ejecutivo de la casa')).precio, 18500, 'salir del campo guarda');
    assert.match(await total(), /106\.800/, `Total: 2 × 18.500 + 16.000 + 3 × 13.000 + la promo (80 % de 18.500 = 14.800) = 106.800, y dice ${await total()}`);
    assert.deepEqual(errores, []);
  });

  test(`navegador ${ancho}: los + − de cada línea miden 44 px sin caja ni borde, la cantidad queda en medio y la línea se lee en dos renglones`, { skip: SALTAR }, async (t) => {
    const r = await abrirOrden(t, ancho);
    if (!r) return;
    const { page, errores } = r;
    const ctrl = page.locator('.order-item:visible > .qty-ctrl');
    assert.ok((await ctrl.count()) >= 3);
    for (const c of await ctrl.all()) {
      const botones = await c.locator('.qty-btn').all();
      assert.equal(botones.length, 2);
      for (const b of botones) {
        const k = await caja(b);
        assert.ok(k.width >= 44 - 0.5 && k.height >= 44 - 0.5, `${k.width}×${k.height}: sigue siendo un blanco de 44 px`);
        const est = await b.evaluate((e) => { const s = getComputedStyle(e); return { borde: s.borderTopWidth, estilo: s.borderTopStyle, fondo: s.backgroundColor, color: s.color, sombra: s.boxShadow }; });
        assert.equal(est.borde, '0px', 'sin borde');
        assert.match(est.fondo, /^rgba\(0, 0, 0, 0\)$|^transparent$/, `sin caja: fondo ${est.fondo}`);
        assert.equal(est.sombra, 'none');
      }
      // La cantidad entre los dos signos.
      const [menos, mas] = [await caja(botones[0]), await caja(botones[1])];
      const val = await caja(c.locator('.qty-val'));
      assert.ok(val.x >= menos.x + menos.width - 1 && val.x + val.width <= mas.x + 1, 'la cantidad queda entre el − y el +');
      assert.ok(Math.abs((menos.x + menos.width) - val.x) <= 1 && Math.abs(mas.x - (val.x + val.width)) <= 1, 'sin hueco entre los tres');
    }
    // El signo en apoyo (6,79 sobre papel): el mismo color que ya usan los enlaces de la fila.
    const colores = await page.evaluate(() => {
      const raiz = getComputedStyle(document.documentElement);
      const apoyo = (() => { const e = document.createElement('i'); e.style.color = raiz.getPropertyValue('--color-apoyo'); document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; })();
      return { apoyo, signo: getComputedStyle(document.querySelector('.order-item .qty-ctrl .qty-btn')).color };
    });
    assert.equal(colores.signo, colores.apoyo);
    if (ancho === 390) {
      // Dos renglones: el nombre (y su importe) y, debajo, el precio y los enlaces junto a − n +. Sin la nota de variante ni lo manual, cada línea mide poco.
      for (const nombre of ['Empanadas de la casa', 'Limonada de coco']) {
        const f = fila(page, nombre);
        const k = await caja(f);
        assert.ok(k.height <= 100, `«${nombre}» mide ${k.height}: dos renglones, no tres`);
        const arriba = await Promise.all([f.locator('.precio-btn'), f.locator('.item-acciones').getByText('Asignar a persona'), f.locator('.btn-enlace-llevar')].map(async (l) => (await caja(l)).y));
        assert.ok(Math.max(...arriba) - Math.min(...arriba) <= 4, `el precio y los dos enlaces comparten renglón: ${arriba}`);
        const q = await caja(f.locator(':scope > .qty-ctrl'));
        const l = await caja(f.locator('.precio-btn'));
        assert.ok(Math.abs((q.y + q.height / 2) - (l.y + l.height / 2)) <= 30, 'los + − van en el renglón del precio');
      }
    }
    assert.ok(await sinDesborde(page) <= 0);
    assert.deepEqual(errores, []);
  });
}

test('navegador 390: el mesero también puede (mismo marcado), y en «Cobrar por partes» el precio no se toca y los − + de «Cobrar n de qty» conservan su caja', { skip: SALTAR }, async (t) => {
  const r = await abrirOrden(t, 390, { rol: 'mesero' });
  if (!r) return;
  const { page, errores } = r;
  const ej = fila(page, 'Ejecutivo de la casa').first();
  assert.equal(await ej.locator('.precio-btn').isVisible(), true, 'el mesero ve el precio como botón');
  await abrirCampo(page, ej);
  await page.keyboard.type('19000');
  await page.keyboard.press('Enter');
  await reposo(page);
  assert.equal((await base(page, 'Ejecutivo de la casa')).precio, 19000);
  // Cobrar por partes: el pedido vuelve al flujo, sin edición de precio.
  await page.evaluate(() => Alpine.store('pos').toggleModoCobroParcial());
  await reposo(page);
  assert.equal(await fila(page, 'Ejecutivo de la casa').locator('.precio-btn').isVisible(), false);
  assert.equal(await fila(page, 'Ejecutivo de la casa').locator('.precio-unit').isVisible(), true);
  await fila(page, 'Ejecutivo de la casa').locator('input[type=checkbox]').click();
  await reposo(page);
  const dentro = fila(page, 'Ejecutivo de la casa').locator('.sel-unidades .qty-btn').first();
  assert.equal(await dentro.isVisible(), true);
  assert.equal(await dentro.evaluate((e) => getComputedStyle(e).borderTopWidth), '1px', 'el selector «Cobrar n de qty» conserva su caja');
  assert.deepEqual(errores, []);
});
