// Promociones de PRECIO FIJO en el POS (pedido de Yonatan, 2026-10-06, tareas/2026-10-06-promo-precio-fijo.md: «si agrego 2 hamburguesas resplandor no hace el descuento cuando
// se adiciona y queda el precio normal 60»): «Combo hamburguesas», 2 Hamburguesa Resplandor por $ 50.000, se aplica solo en la cuenta, como ya lo hacen las promos de descuento.
//
// La base (migración 20261006170000_promo_precio_fijo.sql: la regla { cada, precio, aplica } y el cálculo del grupo) se prueba en migracion-promo-precio-fijo.test.mjs, contra Postgres.
// Aquí, el POS:
//   · el modal de producto ofrece, en una promoción automática, «Descuento %» o «Precio fijo del grupo $» (uno u otro, validación en pantalla) y guardarProducto escribe la forma nueva;
//   · reglaPromoValida entiende las dos formas (exactamente una); reglaTxt dice «2 por $ 50.000 en Hamburguesa Resplandor» y el anuncio de las promos de hoy (.promo-hoy) la muestra;
//   · la pastilla de la línea de promo dice «Combo · 2 por $ 50.000» (y las de descuento siguen diciendo lo de siempre);
//   · el recálculo LOCAL de las líneas de promo al poner un precio a mano (`_ponerPrecioLocal`) sabe de precio_fijo y coincide con lo que contesta la base;
//   · el combo de la captura: la mesa con 2 Hamburguesa Resplandor queda en 50.000 cuando llega el eco de la base;
//   · UN solo precio (ronda 2): con «Precio fijo del grupo» el campo de precio del producto muestra el del grupo y no se edita aparte (con una línea que lo explica), y al guardar el producto
//     toma el precio del grupo SIEMPRE; al pasar a «Descuento %» el precio del producto vuelve a 0, como en cualquier promo de descuento.
//   · RS008: la base NO deja encender una promo de precio fijo mientras su producto esté en una cuenta ABIERTA (trigger de `productos`; solo la transición: editar algo que no es la regla de un combo que
//     ya la tiene no se rechaza); el POS lo trata como un rechazo definitivo (avisa con el texto de la base, suelta la subida pendiente y vuelve a leer);
//   · ronda 5 («simplificar»): la línea del PRODUCTO del combo es una línea de producto más y vale 50.000 siempre; el arnés `normalizadorDeCombo` ya no la neutraliza.
//
// Tres partes, como precio-a-mano-navegador.test.mjs:
//   A. ESTÁTICA (corre siempre): el marcado y el código de pos.html.
//   B. LÓGICA (corre siempre): el <script> real de pos.html en un `vm` (_pos-vm.mjs) con una base falsa que normaliza como privado.normalizar_items (`normalizadorDeCombo`).
//   C. EN NAVEGADOR (solo con Playwright y un Chromium; si no se salta con el motivo): el arnés con Supabase simulado (_pos-simulado.mjs), a 390 y 1280 px.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { RAIZ, asentar, crearBaseFalsa, crearPos, hastaQue, mesaBase, normalizadorDeCombo, ordenBase, plano, productosDelCombo } from './_pos-vm.mjs';

const POS = fs.readFileSync(process.env.POS_HTML ? path.resolve(process.env.POS_HTML) : path.join(RAIZ, 'pos.html'), 'utf8');
const MIGRACION = fs.readFileSync(path.join(RAIZ, 'supabase/migrations/20261006170000_promo_precio_fijo.sql'), 'utf8');
const sinComentariosHtml = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();

// ═════════════════════════ A. estática: el marcado y el código ═════════════════════════

const helpers = POS.slice(POS.indexOf('// ▼ PARTE hallazgos-domingo :: helpers'), POS.indexOf('// ▲ PARTE hallazgos-domingo :: helpers'));
const modalProducto = (() => {
  const i = POS.indexOf('id="promo-tipo-etiqueta"');
  return i > 0 ? sinComentariosHtml(POS.slice(i - 400, POS.indexOf('<div class="modal-footer">', i))) : '';
})();
const modalProductoCompleto = (() => {
  const i = POS.indexOf('id="producto-precio"');
  return i > 0 ? compacto(sinComentariosHtml(POS.slice(i, POS.indexOf('<div class="modal-footer">', i)))) : '';
})();

test('estática: reglaPromoValida acepta las dos formas con las cotas de la base (precio entero de 1 a 10.000.000, el mismo tope que privado.promo_regla_ok) y exactamente UNA; la de descuento no cambió', () => {
  assert.ok(helpers.length > 0, 'faltan los helpers de hallazgos-domingo en pos.html');
  assert.match(helpers, /if \(r\.descuento !== undefined && r\.precio !== undefined\) return null;/, 'los dos a la vez no son una regla');
  assert.match(helpers, /const PRECIO_PROMO_MAXIMO = 10000000;/);
  assert.match(helpers, /!Number\.isInteger\(precio\) \|\| precio < 1 \|\| precio > PRECIO_PROMO_MAXIMO\) return null;/);
  assert.match(helpers, /cada < 2 \|\| cada > 10 \|\| !Number\.isInteger\(descuento\) \|\| descuento < 1 \|\| descuento > 100\) return null;/, 'la forma de descuento, intacta');
  assert.match(compacto(MIGRACION.replace(/--[^\n]*/g, '')), /if v_precio < 1 or v_precio > 10000000 then return false; end if;/, 'y es el mismo tope de la base');
  assert.match(helpers, /return \{ cada, \.\.\.cobro, aplica:/);
});

test('estática: el modal de producto ofrece «Descuento %» o «Precio fijo del grupo $» (uno u otro, con aria-pressed), el campo del precio del grupo y el mensaje de lo que falta según el tipo', () => {
  assert.ok(modalProducto.length > 0, 'no encuentro el selector del tipo de regla en el modal de producto');
  assert.match(modalProducto, /<button type="button" id="promo-tipo-descuento" class="opt-chip"[^>]*aria-pressed[^>]*ponerTipoRegla\('descuento'\)">Descuento %<\/button>/);
  assert.match(modalProducto, /<button type="button" id="promo-tipo-precio" class="opt-chip"[^>]*aria-pressed[^>]*ponerTipoRegla\('precio'\)">Precio fijo del grupo \$<\/button>/);
  assert.match(modalProducto, /<div x-show="\$store\.pos\.productoForm\.tipoRegla !== 'precio'">\s*<label class="field-label" for="promo-descuento">/, 'el descuento solo se ve con el tipo descuento');
  assert.match(modalProducto, /<input id="promo-precio-grupo" type="number" min="1" max="10000000" inputmode="numeric" class="field"\s+placeholder="Ej: 50000" x-model="\$store\.pos\.productoForm\.precioGrupo" \/>/);
  assert.match(modalProducto, /<p class="text-fine invalido" x-show="!\$store\.pos\.reglaFormValida" x-cloak role="alert" x-text="\$store\.pos\.reglaFormFalta"><\/p>/);
  assert.doesNotMatch(modalProducto, /el precio queda en 0/, 'ya no dice que el precio queda en 0: una promo de precio fijo conserva el del grupo');
});

test('estática: el campo de precio del producto muestra el del grupo y no se edita aparte cuando la promo es de precio fijo (readonly + la línea que lo explica); en cualquier otro caso es el campo de siempre', () => {
  const i = POS.indexOf('id="producto-precio"');
  assert.ok(i > 0, 'falta el campo de precio con id');
  const campo = compacto(sinComentariosHtml(POS.slice(POS.lastIndexOf('<label', i), POS.indexOf('<label class="field-label">Descripción', i))));
  assert.match(campo, /<label class="field-label" for="producto-precio">Precio \(COP\)<\/label>/);
  assert.match(campo, /:value="\$store\.pos\.precioProductoFijo \? \$store\.pos\.productoForm\.precioGrupo : \$store\.pos\.productoForm\.precio"/, 'con precio fijo muestra el del grupo');
  assert.match(campo, /@input="\$store\.pos\.productoForm\.precio = \$event\.target\.value"/, 'y escribe en el precio del producto cuando se edita');
  assert.match(campo, /:readonly="\$store\.pos\.precioProductoFijo"/);
  assert.match(campo, /:aria-describedby="\$store\.pos\.precioProductoFijo \? 'producto-precio-nota' : null"/);
  assert.match(campo, /<p class="text-fine mt-1" id="producto-precio-nota" x-show="\$store\.pos\.precioProductoFijo" x-cloak>Con «Precio fijo del grupo» el producto cuesta lo mismo que el grupo/);
  const g = POS.indexOf('guardarProducto() {');
  const cuerpo = compacto(POS.slice(g, POS.indexOf('// --- Menú semanal', g)));
  assert.match(cuerpo, /const precio = regla && regla\.precio !== undefined \? regla\.precio : \(regla && !precioTxt \? 0 : parseInt\(precioTxt, 10\)\);/, 'el precio de una promo de precio fijo es SIEMPRE el del grupo');
  // ronda 3 (bajo): el precio propio se guarda al pasar a precio fijo y se recupera al volver a descuento; solo si el precio venía del grupo vuelve a 0; y desmarcar «automática» no deja el Guardar mudo
  const t = compacto(POS.slice(POS.indexOf('ponerTipoRegla(tipo) {'), POS.indexOf('eliminarProducto(id) {')));
  assert.match(t, /if \(nuevo === 'precio' && f\.tipoRegla !== 'precio'\) f\.precioPropio = f\.precio;/, 'al pasar a precio fijo se guarda el precio propio');
  assert.match(t, /if \(nuevo === 'descuento' && f\.tipoRegla === 'precio'\) \{ f\.precio = f\.precioPropio === null \|\| f\.precioPropio === undefined \? '0' : f\.precioPropio; f\.precioPropio = null; \}/, 'al volver a descuento: el precio propio, o 0 si venía del grupo');
  assert.match(t, /alAlternarRegla\(activa\) \{[^}]*if \(!f \|\| activa\) return;/, 'solo al desmarcar');
  assert.match(modalProductoCompleto, /<input type="checkbox" x-model="\$store\.pos\.productoForm\.conRegla" @change="\$store\.pos\.alAlternarRegla\(\$event\.target\.checked\)" \/>/, 'la casilla avisa al store');
  assert.match(cuerpo, /if \(!precioOk\) \{ this\.avisar\(esPromo \? 'Falta el precio del producto \(de \$ 1 en adelante\) para guardarlo sin promoción automática\.'/, 'y si guardarProducto no puede guardar por el precio, lo dice');
});

test('estática: el anuncio de las promos de hoy no cambió de marcado (lo mismo sirve para las dos formas) y la pastilla de la línea sale de pastillaPromo, no de una expresión suelta', () => {
  assert.match(POS, /class="promo-hoy" x-show="\$store\.pos\.promosAutomaticasHoy\.length"/);
  assert.match(POS, /<span x-text="\$store\.pos\.reglaTxt\(p\)"><\/span>\. Se aplica sola en la cuenta\./);
  assert.match(POS, /<span class="promo-chip" x-show="item\.promo" x-cloak\s+x-text="\$store\.pos\.pastillaPromo\(item\)"><\/span>/);
  assert.doesNotMatch(POS, /item\.promo\.descuento >= 100/, 'la expresión suelta de la pastilla se fue a pastillaPromo');
});

test('estática: el recálculo local de las líneas de promo de una base (`_ponerPrecioLocal`) deja la cuenta del descuento como estaba y manda las de precio fijo a repartoPrecioFijo, que ordena las unidades como la base', () => {
  const i = POS.indexOf('_ponerPrecioLocal(orden, item, { precio, manual, por = \'\' }) {');
  assert.ok(i > 0);
  const cuerpo = compacto(POS.slice(i, POS.indexOf('_subirPrecio(orden, item, precio, anterior) {', i)));
  assert.match(cuerpo, /if \(l\.promo\.precio_fijo === undefined\) l\.precio = Math\.round\(precio \* \(100 - \(Number\(l\.promo\.descuento\) \|\| 0\)\) \/ 100\);/);
  assert.match(cuerpo, /repartoPrecioFijo\(orden\.items, this\.productos, promoId\)/);
  assert.match(cuerpo, /reparto\.has\(l\.promo\.de\) \? reparto\.get\(l\.promo\.de\)\.precio : Number\(l\.promo\.precio\)/, 'sin descuento (el grupo ya no pasa de X) la línea vale su precio de base');
  const r = compacto(helpers.slice(helpers.indexOf('function repartoPrecioFijo')));
  assert.match(r, /unidades\.sort\(\(a, b\) => b\.precio - a\.precio \|\| a\.orden - b\.orden\);/, 'de mayor a menor precio y, a igual precio, en el orden de la cuenta');
  assert.match(r, /if \(total <= r\.precio\) continue;/, 'un grupo que ya costaba X o menos no genera promo');
  assert.match(r, /barata\.precio - Math\.min\(barata\.precio, Math\.max\(0, total - r\.precio\)\)/, 'max(0, X − las otras), nunca más que su precio de lista');
  assert.match(r, /Math\.round\(x\.suma \/ x\.n\)/, 'promedio redondeado por línea, como la base');
});

test('estática: pushASupabase trata el RS008 de la base («no se puede aplicar sola todavía») como un rechazo definitivo de `productos`: suelta la subida pendiente, avisa con el texto de la base y vuelve a leer; y NO usa el aviso de permisos', () => {
  assert.match(compacto(POS), /function esErrorPromoEnCuentas\(e\) \{ if \(!e\) return false; return e\.code === 'RS008' \|\| \/no se puede aplicar sola todav\[ií\]a\/i\.test\(String\(e\.message \|\| ''\)\); \}/);
  const i = POS.indexOf('async pushASupabase(tabla, payload) {');
  assert.ok(i > 0);
  const push = compacto(POS.slice(i, i + 12000));
  assert.match(push, /if \(tabla === 'productos' && esErrorPromoEnCuentas\(e\)\) \{ denegada = true; promoEnCuentas = String\(e\.message \|\| ''\) \|\| '[^']+'; \}/, 'solo para productos, y la subida se da por rechazada (denegada)');
  assert.match(push, /else if \(cuentaBorrada\) [^;]+; else if \(promoEnCuentas\) this\._promoEnCuentas\(promoEnCuentas\); else if \(denegada\) this\._permisoDenegado\(tabla\);/, 'avisa lo suyo ANTES del aviso genérico de permisos («Solo el admin puede hacer esto»)');
  const m = compacto(POS.slice(POS.indexOf('_promoEnCuentas(mensaje) {'), POS.indexOf('async iniciarSesionGoogle() {')));
  assert.match(m, /this\.avisar\(mensaje, 30000\); if \(this\.remoto !== 'offline'\) this\.sincronizarSupabase\(\{ soloEnVivo: true \}\)/, 'avisa con lo que dice la base y vuelve a leer');
  assert.match(compacto(MIGRACION), /errcode = 'RS008'/, 'y es el mismo código que lanza el trigger de la migración');
});

// ═════════════════════════ B. lógica: el store real ═════════════════════════

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const MARTES = '2026-10-06T18:00:00Z';       // 13:00 en Bogotá, martes (el día del combo)
const MIERCOLES = '2026-10-07T18:00:00Z';
const HAM = (qty, extra = {}) => ({ id: 'ham', nombre: 'Hamburguesa Resplandor', precio: 30000, qty, nota: '', ...extra });
const DB_PROMO = { id: 'promo:p-combo:ham', nombre: 'Hamburguesa Resplandor · Combo hamburguesas', precio: 20000, qty: 1, nota: '',
  promo: { id: 'p-combo', de: 'ham', nombre: 'Hamburguesa Resplandor', precio: 30000, precio_fijo: 50000 } };
const total = (items) => items.reduce((s, i) => s + i.precio * i.qty, 0);
const forma = (items) => items.map((i) => [i.id, i.qty, Number(i.precio)]);

/** Un POS con sesión sobre la base falsa, que normaliza como la de verdad (el combo del martes). */
function montar({ items = [HAM(1)], reloj = MARTES, rol = 'admin', productos = productosDelCombo(), normalizador = normalizadorDeCombo({ dia: 2 }) } = {}) {
  const fila = { ...ordenBase('o1', 1, normalizador(items, { abierta_en: reloj }), 3), abierta_en: reloj };
  const base = crearBaseFalsa({ rol, mesas: [mesaBase(1)], ordenes: [fila], productos, olaC: true, normalizar: normalizador });
  const original = base.responder;   // la base falsa devuelve su propia fila: el POS recibe una COPIA, como por la red
  base.responder = async (c) => { const r = await original(c); return r && r.data ? { ...r, data: JSON.parse(JSON.stringify(r.data)) } : r; };
  const reales = { setTimeout, clearTimeout };
  const t = crearPos({
    base, reloj,
    extras: {
      setInterval() { return 1; }, clearInterval() {},
      setTimeout(fn, ms, ...resto) { if (ms >= 1500) { const h = { fn, ms, cancelado: false, unref() { return h; } }; return h; } return reales.setTimeout(fn, ms, ...resto); },
      clearTimeout(h) { if (h && typeof h === 'object') { h.cancelado = true; return; } reales.clearTimeout(h); },
    },
    documento: { title: 'POS', visibilityState: 'visible' },
  });
  t.base = base; t.pos.usuario = YO; t.pos.rol = rol; t.pos.rolCargado = true;
  t.pos._esperaMarcasLlevar = () => 5;
  return t;
}
async function abrir(opciones = {}) {
  const t = montar(opciones);
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  await asentar();
  await t.pos.abrirMesa(t.pos.mesas.find((m) => m.id === 1));
  return t;
}
const promoDe = (t) => t.pos.productos.find((p) => p.id === 'p-combo');
const hamDe = (t) => t.pos.productos.find((p) => p.id === 'ham');
const subidas = (t) => t.supabase.llamadas.filter((c) => c.tipo === 'from' && c.tabla === 'productos' && c.op === 'upsert');

test('el catálogo trae la regla de precio fijo con su forma (y la de descuento sigue igual): reglaPromoValida la deja pasar, y la rechaza con los dos a la vez, ninguno, precio 0, pasado de tope, decimal o cada fuera de 2 a 10', async () => {
  const t = await abrir();
  assert.deepEqual(plano(promoDe(t).promoRegla), { cada: 2, precio: 50000, aplica: { productos: ['ham'] } });
  // por el formulario (que pasa por reglaPromoValida): lo válido y lo que no
  const f = (extra) => { t.pos.abrirModalProducto(promoDe(t)); Object.assign(t.pos.productoForm, extra); return plano(t.pos.reglaDelForm); };
  assert.deepEqual(f({}), { cada: 2, precio: 50000, aplica: { productos: ['ham'] } });
  assert.deepEqual(f({ precioGrupo: '10000000' }), { cada: 2, precio: 10000000, aplica: { productos: ['ham'] } });
  assert.deepEqual(f({ precioGrupo: '50.000' }), { cada: 2, precio: 50000, aplica: { productos: ['ham'] } }, 'con separador de miles, como el precio a mano');
  assert.deepEqual(f({ precioGrupo: '1' }), { cada: 2, precio: 1, aplica: { productos: ['ham'] } });
  for (const malo of ['', '0', '10000001', '49999.5', '-5', 'cincuenta', '5e4']) assert.equal(f({ precioGrupo: malo }), null, `precio «${malo}»`);
  for (const cada of [1, 11, 0, 'x']) assert.equal(f({ cada }), null, `cada ${cada}`);
  assert.equal(f({ aplicaProds: [], aplicaCats: [] }), null, 'sin categoría ni producto');
  // y la de descuento de siempre
  t.pos.abrirModalProducto(promoDe(t));
  t.pos.ponerTipoRegla('descuento');
  assert.deepEqual(plano(t.pos.reglaDelForm), { cada: 2, descuento: 20, aplica: { productos: ['ham'] } }, 'uno u otro: la forma de descuento NO lleva precio');
  Object.assign(t.pos.productoForm, { descuento: 100 });
  assert.deepEqual(plano(t.pos.reglaDelForm), { cada: 2, descuento: 100, aplica: { productos: ['ham'] } });
  for (const malo of [0, 101, 'x']) { t.pos.productoForm.descuento = malo; assert.equal(t.pos.reglaDelForm, null, `descuento ${malo}`); }
});

test('el modal de producto: abre con el tipo que tiene la regla (precio fijo o descuento), uno u otro, valida en pantalla (la regla y el mensaje de lo que falta) y la frase dice lo que hará', async () => {
  const t = await abrir();
  t.pos.abrirModalProducto(promoDe(t));
  assert.equal(t.pos.productoForm.conRegla, true);
  assert.equal(t.pos.productoForm.tipoRegla, 'precio');
  assert.equal(t.pos.productoForm.precioGrupo, '50000');
  assert.equal(t.pos.productoForm.descuento, 20, 'el descuento de reserva, por si cambia de tipo');
  assert.equal(t.pos.reglaFormValida, true);
  assert.equal(t.pos.precioProductoFijo, true, 'con precio fijo el producto no tiene un precio aparte');
  assert.equal(t.pos.reglaFormTxt, 'Hoy: 2 por $ 50.000 en Hamburguesa Resplandor. Cada grupo de 2 cuesta $ 50.000 y las unidades que sobran pagan su precio.');
  // lo que falta, según el tipo
  t.pos.productoForm.precioGrupo = '';
  assert.equal(t.pos.reglaFormValida, false);
  assert.match(t.pos.reglaFormFalta, /el precio del grupo \(pesos enteros, de \$ 1 a \$ 10\.000\.000\)/);
  assert.match(t.pos.reglaFormTxt, /el grupo cuesta el precio fijo/);
  t.pos.ponerTipoRegla('descuento');
  assert.equal(t.pos.precioProductoFijo, false, 'con descuento el campo del precio vuelve a ser el de siempre');
  assert.equal(t.pos.productoForm.precio, '0', 'y al pasar de precio fijo a descuento el producto vuelve a 0, como cualquier promo de descuento');
  assert.equal(t.pos.reglaFormValida, true, 'con el tipo descuento, el precio del grupo vacío no estorba');
  assert.equal(t.pos.reglaFormTxt, 'Hoy: cada 2, el más barato con 20 % menos en Hamburguesa Resplandor. Con 2 Menú de 23.000 y 1 Seco de 19.000, cada 3 el descuento cae en el Seco.');
  t.pos.productoForm.descuento = 0;
  assert.equal(t.pos.reglaFormValida, false);
  assert.match(t.pos.reglaFormFalta, /el descuento de 1 a 100/);
  assert.doesNotMatch(t.pos.reglaFormFalta, /precio del grupo/);
  // un tipo que no existe vuelve a descuento (uno u otro, nunca otra cosa)
  t.pos.ponerTipoRegla('cualquier cosa');
  assert.equal(t.pos.productoForm.tipoRegla, 'descuento');
  // una promo de descuento abre en descuento, con el precio del grupo vacío
  t.pos.productos.push({ id: 'p-x', cat: 'Promociones', nombre: 'Entradas', precio: 0, desc: '', activo: true, etiqueta: '2 x 1', diaSemana: 6, promoRegla: { cada: 2, descuento: 100, aplica: { categorias: ['Entradas'] } } });
  t.pos.abrirModalProducto(t.pos.productos.find((p) => p.id === 'p-x'));
  assert.equal(t.pos.productoForm.tipoRegla, 'descuento');
  assert.equal(t.pos.productoForm.descuento, 100);
  assert.equal(t.pos.productoForm.precioGrupo, '');
  assert.equal(t.pos.precioProductoFijo, false);
  // sin la casilla de promoción automática, o en una categoría que no es de promociones, el campo del precio es el de siempre aunque el tipo diga precio
  t.pos.abrirModalProducto(promoDe(t));
  t.pos.productoForm.conRegla = false;
  assert.equal(t.pos.precioProductoFijo, false);
  t.pos.productoForm.conRegla = true;
  t.pos.productoForm.categoria = 'Platos Fuertes';
  assert.equal(t.pos.precioProductoFijo, false);
  // un producto nuevo: sin regla, descuento por defecto
  t.pos.abrirModalProducto();
  assert.deepEqual([t.pos.productoForm.conRegla, t.pos.productoForm.tipoRegla, t.pos.productoForm.precioGrupo, t.pos.productoForm.cada, t.pos.productoForm.descuento], [false, 'descuento', '', 3, 20]);
});

test('guardarProducto escribe la forma nueva ({cada, precio, aplica}, sin descuento) y la de descuento sigue como siempre (sin precio); una regla a medias no se guarda; una promo de precio fijo sin precio propio toma el del grupo', async () => {
  const t = await abrir();
  // editar el combo: el grupo a 45.000
  t.pos.abrirModalProducto(promoDe(t));
  t.pos.productoForm.precioGrupo = '45000';
  t.pos.guardarProducto();
  await asentar();
  let fila = subidas(t).at(-1).cuerpo;
  assert.deepEqual(plano(fila.promo_regla), { cada: 2, precio: 45000, aplica: { productos: ['ham'] } });
  assert.equal(fila.precio, 45000, 'UN solo precio: el del producto (el que muestra la carta) pasa a ser el del grupo');
  assert.equal(promoDe(t).precio, 45000, 'también en la copia local');
  assert.equal(fila.dia_semana, 2);
  assert.equal(t.base.productos.get('p-combo').promo_regla.precio, 45000, 'y la base lo recibió');
  assert.equal(promoDe(t).promoRegla.precio, 45000, 'y la copia local');
  assert.equal(t.pos.modalProducto, false, 'cierra el modal');
  // una regla a medias (precio vacío) no se guarda: el modal sigue abierto y no sube nada
  const n = subidas(t).length;
  t.pos.abrirModalProducto(promoDe(t));
  t.pos.productoForm.precioGrupo = '';
  t.pos.guardarProducto();
  await asentar();
  assert.equal(subidas(t).length, n, 'nada subió');
  assert.equal(t.pos.modalProducto, true);
  // aunque el campo del precio del producto traiga otra cosa (un POS que lo dejó editar, un valor viejo), con precio fijo el producto toma el del grupo
  t.pos.productoForm.precioGrupo = '47000';
  t.pos.productoForm.precio = '12345';
  t.pos.guardarProducto();
  await asentar();
  fila = subidas(t).at(-1).cuerpo;
  assert.equal(fila.precio, 47000, 'el precio del producto es el del grupo, siempre');
  assert.deepEqual(plano(fila.promo_regla), { cada: 2, precio: 47000, aplica: { productos: ['ham'] } });
  // cambiarla a descuento: la fila lleva descuento y NO precio (uno u otro), y el producto vuelve a valer 0
  t.pos.abrirModalProducto(promoDe(t));
  t.pos.ponerTipoRegla('descuento');
  t.pos.productoForm.descuento = 25;
  t.pos.guardarProducto();
  await asentar();
  fila = subidas(t).at(-1).cuerpo;
  assert.deepEqual(plano(fila.promo_regla), { cada: 2, descuento: 25, aplica: { productos: ['ham'] } });
  assert.equal('precio' in fila.promo_regla, false);
  assert.equal(fila.precio, 0, 'al pasar de precio fijo a descuento el precio del producto vuelve a 0 (la carta muestra la etiqueta, no «$ 0»)');
  assert.equal(promoDe(t).precio, 0);
  // una promo nueva de precio fijo sin precio propio: toma el del grupo (es el que muestra la carta pública); de descuento sin precio, 0 como siempre
  t.pos.abrirModalProducto();
  Object.assign(t.pos.productoForm, { categoria: 'Promociones', nombre: 'Dúo de papas', precio: '', conRegla: true, tipoRegla: 'precio', cada: 2, precioGrupo: '39000', aplicaProds: ['ham'], diaSemana: 4, etiqueta: '2 papas' });
  t.pos.guardarProducto();
  await asentar();
  fila = subidas(t).at(-1).cuerpo;
  assert.equal(fila.nombre, 'Dúo de papas');
  assert.equal(fila.precio, 39000);
  assert.deepEqual(plano(fila.promo_regla), { cada: 2, precio: 39000, aplica: { productos: ['ham'] } });
  t.pos.abrirModalProducto();
  Object.assign(t.pos.productoForm, { categoria: 'Promociones', nombre: 'Dos por uno', precio: '', conRegla: true, tipoRegla: 'descuento', cada: 2, descuento: 100, aplicaProds: ['ham'], diaSemana: 5 });
  t.pos.guardarProducto();
  await asentar();
  fila = subidas(t).at(-1).cuerpo;
  assert.equal(fila.precio, 0);
  assert.deepEqual(plano(fila.promo_regla), { cada: 2, descuento: 100, aplica: { productos: ['ham'] } });
});

test('RONDA 3 (bajo): el modal no se queda mudo ni pierde el precio propio: precio fijo → descuento → desmarcar «automática» deja el combo como producto de 50.000 y sube; una promo de descuento con precio propio de 12.000 lo recupera tras mirar el precio fijo; sin precio, guardarProducto lo dice', async () => {
  const t = await abrir();
  // caso 7 del refutador: combo de precio fijo → «Descuento %» → desmarcar «automática» → Guardar. Antes: el precio quedaba en '0', no subía nada y el modal seguía abierto sin un mensaje
  t.pos.abrirModalProducto(promoDe(t));
  t.pos.ponerTipoRegla('descuento');
  assert.equal(t.pos.productoForm.precio, '0', 'el precio venía del grupo: como promo de descuento vale 0');
  t.pos.productoForm.conRegla = false;
  t.pos.alAlternarRegla(false);                    // lo que hace la casilla al cambiar
  assert.equal(t.pos.productoForm.precio, '50000', 'al desmarcar, el producto toma el precio del grupo (con el que ya se vendía)');
  t.pos.guardarProducto();
  await asentar();
  let fila = subidas(t).at(-1).cuerpo;
  assert.equal(fila.precio, 50000);
  assert.equal(fila.promo_regla ?? null, null, 'sin regla: vuelve a ser un producto que se agrega a mano');
  assert.equal(t.pos.modalProducto, false, 'y el modal cierra');
  // caso 6: desmarcar «automática» directamente, sin pasar por descuento, conserva el precio (50.000) y no lo toca la casilla
  const t2 = await abrir();
  t2.pos.abrirModalProducto(promoDe(t2));
  t2.pos.productoForm.conRegla = false;
  t2.pos.alAlternarRegla(false);
  assert.equal(t2.pos.productoForm.precio, '50000');
  // y marcar la casilla no cambia nada
  t2.pos.alAlternarRegla(true);
  assert.equal(t2.pos.productoForm.precio, '50000');
  // caso 10: una promo de descuento con PRECIO PROPIO (12.000) → precio fijo → descuento: el precio propio vuelve; si ya venía del grupo, vuelve a 0
  t.pos.productos.push({ id: 'p-d', cat: 'Promociones', nombre: 'Cócteles 2x1', precio: 12000, desc: '', activo: true, etiqueta: '2x1', diaSemana: 3, promoRegla: { cada: 2, descuento: 100, aplica: { productos: ['ham'] } } });
  const pd = t.pos.productos.find((p) => p.id === 'p-d');
  t.pos.abrirModalProducto(pd);
  assert.equal(t.pos.productoForm.precio, '12000');
  t.pos.ponerTipoRegla('precio');
  t.pos.productoForm.precioGrupo = '40000';
  assert.equal(t.pos.precioProductoFijo, true, 'con precio fijo el campo muestra el del grupo');
  t.pos.ponerTipoRegla('descuento');
  assert.equal(t.pos.productoForm.precio, '12000', 'el precio propio no se pierde por mirar el otro tipo');
  t.pos.ponerTipoRegla('precio'); t.pos.ponerTipoRegla('descuento');
  assert.equal(t.pos.productoForm.precio, '12000', 'y tampoco con una segunda vuelta');
  t.pos.guardarProducto();
  await asentar();
  fila = subidas(t).at(-1).cuerpo;
  assert.equal(fila.precio, 12000);
  assert.deepEqual(plano(fila.promo_regla), { cada: 2, descuento: 100, aplica: { productos: ['ham'] } });
  // una promo de descuento SIN precio propio (0) que se desmarca no tiene qué restaurar: guardarProducto lo dice en vez de quedarse muda
  t.pos.productos.push({ id: 'p-e', cat: 'Promociones', nombre: 'Entradas 2x1', precio: 0, desc: '', activo: true, etiqueta: '2x1', diaSemana: 6, promoRegla: { cada: 2, descuento: 100, aplica: { categorias: ['Entradas'] } } });
  const n = subidas(t).length;
  t.pos.abrirModalProducto(t.pos.productos.find((p) => p.id === 'p-e'));
  t.pos.productoForm.conRegla = false;
  t.pos.alAlternarRegla(false);
  assert.equal(t.pos.productoForm.precio, '0', 'no hay precio del grupo que restaurar');
  t.pos.aviso = null;
  t.pos.guardarProducto();
  await asentar();
  assert.match(t.pos.aviso?.texto || '', /^Falta el precio del producto \(de \$ 1 en adelante\) para guardarlo sin promoción automática\.$/);
  assert.equal(subidas(t).length, n, 'nada subió');
  assert.equal(t.pos.modalProducto, true, 'el modal sigue abierto');
  // un producto normal sin precio: también lo dice (antes no hacía nada)
  t.pos.abrirModalProducto();
  Object.assign(t.pos.productoForm, { categoria: 'Platos Fuertes', nombre: 'Sin precio', precio: '' });
  t.pos.aviso = null;
  t.pos.guardarProducto();
  assert.match(t.pos.aviso?.texto || '', /^Falta el precio del producto \(de \$ 1 en adelante\)\.$/);
});

test('el arnés normaliza el producto del combo como la base: es una línea de producto más que vale 50.000 SIEMPRE (solo, con 1 hamburguesa 80.000, con el par 100.000: el grupo y el producto), y es idempotente', () => {
  const COMBO = (qty, extra = {}) => ({ id: 'p-combo', nombre: 'Combo hamburguesas', precio: 50000, qty, nota: '', ...extra });
  const norm = normalizadorDeCombo({ dia: 2 });
  const en = (items, reloj = MARTES) => norm(items, { abierta_en: reloj });
  assert.equal(total(en([COMBO(1)])), 50000, 'el combo solo vale sus 50.000');
  assert.equal(total(en([COMBO(2)])), 100000);
  assert.equal(total(en([HAM(1), COMBO(1)])), 80000, 'combo + 1 hamburguesa');
  assert.deepEqual(forma(en([HAM(2), COMBO(1)])), [['ham', 1, 30000], ['promo:p-combo:ham', 1, 20000], ['p-combo', 1, 50000]], 'el par forma el grupo y la línea del producto sigue valiendo lo suyo');
  assert.equal(total(en([HAM(2), COMBO(1)])), 100000, 'el grupo (50.000) y el producto (50.000): el cobro doble que el orden de salida evita recargando las tablets antes del sobre');
  assert.equal(total(en([HAM(2), COMBO(2)])), 150000, '2 combos + 2 hamburguesas');
  assert.equal(total(en([HAM(2), COMBO(1)], MIERCOLES)), 110000, 'fuera de su día no hay grupos: 60.000 + 50.000');
  assert.equal(total(en([HAM(2), COMBO(1, { precio: 40000, precio_manual: true })])), 90000, 'el precio a mano se respeta');
  assert.equal(total(en([HAM(2), COMBO(1, { id: 'p-combo__sin-sal' })])), 100000, 'también la variante con nota');
  for (const items of [[HAM(2), COMBO(1)], [HAM(3), COMBO(2)], [COMBO(1)], [HAM(1), COMBO(1)], [HAM(2), COMBO(2)]]) {
    const una = en(items);
    assert.deepEqual(en(una), una, `dos pasadas ≠ una: ${JSON.stringify(items)}`);
  }
});

test('RS008: la base RECHAZA volver automática una promo de precio fijo cuyo producto está en una cuenta ABIERTA; el POS avisa con el texto de la base (con la mesa), SUELTA la subida pendiente (no la reintenta sola cuando la cuenta se cobre), vuelve a leer (la promo sigue sin regla) y, quitada la línea, el mismo guardado funciona; una venta cobrada no estorba', async () => {
  const COMBO = (qty) => ({ id: 'p-combo', nombre: 'Combo hamburguesas', precio: 50000, qty, nota: '' });
  const productos = productosDelCombo().map((p) => (p.id === 'p-combo' ? { ...p, promo_regla: null } : p));    // hoy: un producto de 50.000 sin regla
  const t = await abrir({ items: [COMBO(1)], productos });
  t.base.guardiaPromoEnCuentas = true;
  // una venta ya cobrada con el combo (otra mesa): no cuenta
  t.base.ordenes.set('o-cobrada', { ...ordenBase('o-cobrada', 2, [COMBO(1)], 3), estado: 'cerrada', cerrada_en: MARTES });
  const encender = () => {
    t.pos.abrirModalProducto(promoDe(t));
    Object.assign(t.pos.productoForm, { conRegla: true, tipoRegla: 'precio', cada: 2, precioGrupo: '50000', aplicaProds: ['ham'], aplicaCats: [] });
    t.pos.guardarProducto();
  };
  assert.equal(promoDe(t).promoRegla, null);
  encender();
  await asentar();
  await asentar();
  assert.equal(subidas(t).length, 1, 'se intentó una vez');
  assert.match(t.pos.aviso?.texto || '', /^La promoción «Combo hamburguesas» no se puede aplicar sola todavía: su producto está en cuentas abiertas: mesa 1 \(1 unidad\)\./, 'el aviso es el texto de la base, con la mesa');
  assert.doesNotMatch(t.pos.aviso?.texto || '', /mesa 2/, 'la venta cobrada no se lista');
  assert.doesNotMatch(t.pos.aviso?.texto || '', /Solo el admin puede hacer esto/);
  assert.equal(t.pos._pendientes['productos:p-combo'], undefined, 'la subida NO queda pendiente (no se reintenta sola)');
  assert.equal(t.base.productos.get('p-combo').promo_regla, null, 'la base no la tiene');
  assert.equal(promoDe(t).promoRegla, null, 'y la tablet volvió a leer: ya no tiene una promo automática que solo existe aquí');
  // otra pasada de subir lo pendiente no la reenvía
  await t.pos._subirLoPendiente();
  await asentar();
  assert.equal(subidas(t).length, 1, 'no se reintentó');
  // quitada la línea del combo de la cuenta abierta (la ✕), el mismo guardado funciona aunque la venta cobrada siga con su combo
  t.base.ordenes.get('o1').items = [];
  t.pos.cerrarAviso();
  encender();
  await asentar();
  assert.equal(subidas(t).length, 2);
  assert.deepEqual(plano(t.base.productos.get('p-combo').promo_regla), { cada: 2, precio: 50000, aplica: { productos: ['ham'] } }, 'la base ya la tiene');
  assert.equal(t.pos.aviso, null, 'sin aviso');
});

test('RS008 solo es la TRANSICIÓN: editar la etiqueta, el precio o la descripción de un combo que YA tiene su regla (el upsert del POS manda todas las columnas) no se rechaza aunque haya cuentas abiertas con el producto', async () => {
  const COMBO = (qty) => ({ id: 'p-combo', nombre: 'Combo hamburguesas', precio: 50000, qty, nota: '' });
  const t = await abrir({ items: [HAM(1)] });                         // el combo ya tiene su regla (productosDelCombo)
  t.base.guardiaPromoEnCuentas = true;
  t.base.ordenes.get('o1').items = [HAM(1), COMBO(1)];                  // una tablet sin recargar lo agregó como producto
  t.pos.abrirModalProducto(promoDe(t));
  Object.assign(t.pos.productoForm, { etiqueta: 'Dos hamburguesas', desc: 'Una descripción nueva', precioGrupo: '55000' });
  t.pos.guardarProducto();
  await asentar();
  await asentar();
  assert.equal(subidas(t).length, 1);
  assert.equal(t.pos.aviso, null, 'sin aviso de la base');
  const fila = t.base.productos.get('p-combo');
  assert.equal(fila.etiqueta, 'Dos hamburguesas');
  assert.deepEqual(plano(fila.promo_regla), { cada: 2, precio: 55000, aplica: { productos: ['ham'] } });
  assert.equal(fila.precio, 55000, 'UN solo precio');
});

test('en el POS, una cuenta con el combo vendido como producto (una tablet sin recargar): sola vale 50.000; con 1 hamburguesa 80.000; con la segunda, al llegar el eco la mesa queda con el grupo (50.000) y el producto (50.000): 100.000, el riesgo que el orden de salida evita recargando las tablets antes del sobre', async () => {
  const COMBO = (qty) => ({ id: 'p-combo', nombre: 'Combo hamburguesas', precio: 50000, qty, nota: '' });
  const solo = await abrir({ items: [COMBO(1)] });
  assert.equal(solo.pos.totalOrdenActiva, 50000);
  assert.deepEqual(forma(solo.pos.ordenActiva.items), [['p-combo', 1, 50000]]);
  const t = await abrir({ items: [COMBO(1), HAM(1)] });
  assert.equal(t.pos.totalOrdenActiva, 80000, 'combo + 1 hamburguesa');
  t.pos.agregarProducto(hamDe(t));
  await asentar();
  assert.deepEqual(forma(t.pos.ordenActiva.items), [['p-combo', 1, 50000], ['ham', 1, 30000], ['promo:p-combo:ham', 1, 20000]]);
  assert.equal(t.pos.totalOrdenActiva, 100000, 'el grupo y el producto: la base no decide cuál de las dos sobra');
  assert.equal(total(plano(t.base.ordenes.get('o1').items)), 100000, 'y es lo que quedó en la base');
});

test('reglaTxt: «2 por $ 50.000 en Hamburguesa Resplandor» (precio fijo), y las de descuento dicen lo de siempre («2 x 1 en Entradas», «cada 3, el más barato con 20 % menos en …»)', async () => {
  const t = await abrir();
  assert.equal(t.pos.reglaTxt(promoDe(t)), '2 por $ 50.000 en Hamburguesa Resplandor');
  assert.equal(t.pos.reglaTxt({ promoRegla: { cada: 3, precio: 120000, aplica: { categorias: ['Entradas'] } } }), '3 por $ 120.000 en Entradas');
  assert.equal(t.pos.reglaTxt({ promoRegla: { cada: 2, descuento: 100, aplica: { categorias: ['Entradas'] } } }), '2 x 1 en Entradas');
  assert.equal(t.pos.reglaTxt({ promoRegla: { cada: 3, descuento: 20, aplica: { categorias: ['Ejecutivos'], productos: ['ham'] } } }), 'cada 3, el más barato con 20 % menos en Ejecutivos, Hamburguesa Resplandor');
  assert.equal(t.pos.reglaTxt({}), '');
  assert.equal(t.pos.reglaTxt(null), '');
});

test('el anuncio de las promos de hoy lleva el combo el martes (su día) y no el miércoles; y el combo NO se ofrece como producto (se aplica solo); lo demás de la carta sigue', async () => {
  const martes = await abrir({ reloj: MARTES });
  assert.deepEqual(plano(martes.pos.promosAutomaticasHoy.map((p) => p.nombre)), ['Combo hamburguesas']);
  assert.equal(martes.pos.reglaTxt(martes.pos.promosAutomaticasHoy[0]), '2 por $ 50.000 en Hamburguesa Resplandor');
  const cat = plano(martes.pos.productosPorCategoria);
  assert.deepEqual(Object.keys(cat), ['Platos Fuertes'], 'solo la hamburguesa: ninguna promo con regla se agrega a mano');
  const miercoles = await abrir({ reloj: MIERCOLES });
  assert.deepEqual(plano(miercoles.pos.promosAutomaticasHoy), [], 'el miércoles el combo no se anuncia');
  assert.deepEqual(Object.keys(plano(miercoles.pos.productosPorCategoria)), ['Platos Fuertes'], 'ni se ofrece: tiene regla, aunque hoy no aplique');
});

test('la pastilla de la línea de promo: «Combo · 2 por $ 50.000» (precio fijo; sin la regla en el catálogo, «Combo a precio fijo») y las de descuento dicen lo de siempre', async () => {
  const t = await abrir();
  assert.equal(t.pos.pastillaPromo(DB_PROMO), 'Combo · 2 por $ 50.000');
  assert.equal(t.pos.pastillaPromo({ ...DB_PROMO, promo: { ...DB_PROMO.promo, id: 'otra-promo' } }), 'Combo a precio fijo', 'la regla no está en el catálogo de esta tablet');
  assert.equal(t.pos.pastillaPromo({ id: 'x', promo: { id: 'p', de: 'x', nombre: 'X', precio: 1000, descuento: 20 } }), '−20 % por promoción');
  assert.equal(t.pos.pastillaPromo({ id: 'x', promo: { id: 'p', de: 'x', nombre: 'X', precio: 1000, descuento: 100 } }), 'Gratis por promoción');
  assert.equal(t.pos.pastillaPromo({ id: 'x', nombre: 'Seco' }), '');
  assert.equal(t.pos.pastillaPromo(null), '');
});

test('EL COMBO DE LA CAPTURA: 1 hamburguesa a 30.000; al agregar la segunda la pantalla dice 60.000 hasta que llega el eco, y con el eco la mesa queda en 50.000 (30.000 + 20.000 de la línea de promo); 3 → 80.000, 4 → 100.000', async () => {
  const t = await abrir({ items: [HAM(1)] });
  assert.equal(t.pos.totalOrdenActiva, 30000);
  assert.deepEqual(forma(t.pos.ordenActiva.items), [['ham', 1, 30000]]);
  t.pos.agregarProducto(hamDe(t));
  assert.equal(t.pos.totalOrdenActiva, 60000, 'mientras llega el eco la línea toca su precio de catálogo: el precio normal');
  await asentar();
  assert.deepEqual(forma(t.pos.ordenActiva.items), [['ham', 1, 30000], ['promo:p-combo:ham', 1, 20000]]);
  assert.equal(t.pos.totalOrdenActiva, 50000, 'con el eco de la base, el combo');
  assert.deepEqual(plano(t.pos.ordenActiva.items[1].promo), DB_PROMO.promo, 'la línea de promo trae precio_fijo y el precio de la base, sin descuento (la misma forma que arma la base de verdad)');
  assert.equal(t.pos.pastillaPromo(t.pos.ordenActiva.items[1]), 'Combo · 2 por $ 50.000');
  assert.equal(total(plano(t.base.ordenes.get('o1').items)), 50000, 'y es lo que quedó en la base');
  t.pos.agregarProducto(hamDe(t)); await asentar();
  assert.equal(t.pos.totalOrdenActiva, 80000);
  t.pos.agregarProducto(hamDe(t)); await asentar();
  assert.deepEqual(forma(t.pos.ordenActiva.items), [['ham', 2, 30000], ['promo:p-combo:ham', 2, 20000]]);
  assert.equal(t.pos.totalOrdenActiva, 100000);
});

test('con la cuenta en 2 hamburguesas la tablet YA sabe que la base le pondrá una promoción (no ofrece cobrar por partes ni sin red): cuentaTendriaPromo mira reglas de precio fijo igual que las de descuento', async () => {
  const t = await abrir({ items: [HAM(2)] });
  // 2 hamburguesas con el combo: la base ya devolvió la línea de promo
  assert.equal(t.pos._cuentaConPromoHoy(t.pos.ordenActiva), true);
  // una cuenta local con 2 hamburguesas aún sin eco: el POS lo prevé por la regla
  assert.equal(t.pos._cuentaConPromoHoy({ id: 'x', estado: 'abierta', items: [HAM(2)] }), true);
  assert.equal(t.pos._cuentaConPromoHoy({ id: 'x', estado: 'abierta', items: [HAM(1)] }), false, 'con una sola, no');
  const mier = await abrir({ items: [HAM(2)], reloj: MIERCOLES });
  assert.equal(mier.pos._cuentaConPromoHoy({ id: 'x', estado: 'abierta', items: [HAM(2)] }), false, 'el miércoles el combo no aplica');
});

test('poner un precio a mano en la base de un combo: la pantalla recalcula YA la línea de promo con el grupo (no con un descuento) y coincide con lo que contesta la base', async () => {
  const caso = async (precio, esperado) => {
    const t = await abrir({ items: [HAM(2)] });
    const o = t.pos.ordenActiva;
    assert.deepEqual(forma(o.items), [['ham', 1, 30000], ['promo:p-combo:ham', 1, 20000]]);
    t.pos.fijarPrecioLinea(o.items[0], precio);
    const local = forma(o.items);
    assert.deepEqual(local, esperado.local, `ya en pantalla, con ${precio}`);
    assert.equal(t.pos.totalOrdenActiva, esperado.total, `total en pantalla con ${precio}`);
    assert.equal(o.items[0].precio_manual, true);
    assert.equal(o.items[1].promo.precio, precio, 'la línea de promo recuerda el precio de su base');
    assert.equal(o.items[1].promo.precio_fijo, 50000);
    await asentar();
    const base = plano(t.base.ordenes.get('o1').items);
    assert.equal(total(base), esperado.total, `la base dice lo mismo (${precio})`);
    assert.deepEqual(forma(t.pos.ordenActiva.items), forma(base), 'y tras el eco la pantalla es la de la base');
  };
  // 35.000 + 35.000 = 70.000 > 50.000: la de promo cuesta 50.000 − 35.000 = 15.000
  await caso(35000, { local: [['ham', 1, 35000], ['promo:p-combo:ham', 1, 15000]], total: 50000 });
  // 25.000 + 25.000 = 50.000: el grupo ya costaba X, no hay promo: la base pliega la línea y la pantalla la deja a su precio de base
  await caso(25000, { local: [['ham', 1, 25000], ['promo:p-combo:ham', 1, 25000]], total: 50000 });
  // 20.000 + 20.000 = 40.000: tampoco (un combo no sube la cuenta)
  await caso(20000, { local: [['ham', 1, 20000], ['promo:p-combo:ham', 1, 20000]], total: 40000 });
  // 60.000 + 60.000 = 120.000: X menor que lo que cuesta la otra → 0, nunca negativo
  await caso(60000, { local: [['ham', 1, 60000], ['promo:p-combo:ham', 1, 0]], total: 60000 });
});

test('el recálculo local con una regla por CATEGORÍA y precios distintos (40.001 y 30.000) coincide con la base: la unidad más barata del grupo queda en X − la otra', async () => {
  const productos = [
    { id: 'te-a', categoria: 'Entradas', nombre: 'Papas Resplandor', precio: 40001, descripcion: '', activo: true, etiqueta: null, dia_semana: null, promo_regla: null },
    { id: 'te-b', categoria: 'Entradas', nombre: 'Arepitas montadas', precio: 30000, descripcion: '', activo: true, etiqueta: null, dia_semana: null, promo_regla: null },
    { id: 'p-ent', categoria: 'Promociones', nombre: 'Combo entradas', precio: 50000, descripcion: '', activo: true, etiqueta: null, dia_semana: null, promo_regla: { cada: 2, precio: 50000, aplica: { categorias: ['Entradas'] } } },
  ];
  const normalizador = normalizadorDeCombo({ elegibles: { 'te-a': { nombre: 'Papas Resplandor', precio: 40001 }, 'te-b': { nombre: 'Arepitas montadas', precio: 30000 } }, promoId: 'p-ent', nombre: 'Combo entradas' });
  const items = [{ id: 'te-a', nombre: 'Papas Resplandor', precio: 40001, qty: 1, nota: '' }, { id: 'te-b', nombre: 'Arepitas montadas', precio: 30000, qty: 1, nota: '' }];
  const t = await abrir({ items, productos, normalizador });
  const o = t.pos.ordenActiva;
  assert.deepEqual(forma(o.items), [['te-a', 1, 40001], ['promo:p-ent:te-b', 1, 9999]]);
  // la base que la promo se llevó entera se rotula «sin el combo» (en una de descuento sigue siendo «sin el descuento»)
  assert.equal(t.pos.etiquetaPrecio(o.items[1]), 'Cambiar el precio de Arepitas montadas (sin el combo: $ 30.000 cada una; la promoción se recalcula)');
  assert.equal(t.pos.etiquetaCampoPrecio(o.items[1]), 'Precio de Arepitas montadas sin el combo (pesos, cada unidad)');
  // Las Arepitas (que la promo se llevó ENTERAS: no hay línea base) a mano a 28.000: 40.001 + 28.000 = 68.001 → la de promo cuesta 50.000 − 40.001 = 9.999 (sigue siendo la más barata y la que se lleva el grupo)
  const suelta = t.pos._lineaDePrecio(o.items[1], o);
  assert.equal(suelta.id, 'te-b');
  t.pos.fijarPrecioLinea(suelta, 28000, o);
  assert.deepEqual(forma(o.items), [['te-a', 1, 40001], ['promo:p-ent:te-b', 1, 9999]], 'ya en pantalla');
  assert.equal(o.items[1].promo.precio, 28000);
  await asentar();
  const base = plano(t.base.ordenes.get('o1').items);
  assert.equal(total(base), 50000);
  assert.deepEqual(forma(t.pos.ordenActiva.items), forma(base), 'tras el eco la pantalla es la de la base');
});

test('los cambios de precio a mano con una promo de DESCUENTO siguen calculando por el descuento (no se tocó): 80 % de 20.000 = 16.000', async () => {
  const t = await abrir({ items: [HAM(1)] });
  t.pos.ordenActiva.items.push({ id: 'promo:pr3:ham', nombre: 'Hamburguesa Resplandor · 3er almuerzo · 20% OFF', precio: 24000, qty: 1, nota: '', promo: { id: 'pr3', de: 'ham', nombre: 'Hamburguesa Resplandor', precio: 30000, descuento: 20 } });
  t.pos._ponerPrecioLocal(t.pos.ordenActiva, t.pos.ordenActiva.items[0], { precio: 20000, manual: true, por: 'yo@ejemplo.test' });
  assert.equal(t.pos.ordenActiva.items[1].precio, 16000);
  assert.equal(t.pos.ordenActiva.items[1].promo.precio, 20000);
  assert.equal(t.pos.ordenActiva.items[1].promo.precio_manual, true);
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

// El reloj fijo del arnés es el miércoles 2026-09-30 (3): el combo de esta prueba trae dia_semana 3. La cuenta de la mesa 3 es una sola hamburguesa a 30.000.
const NORMALIZAR_NAV = normalizadorDeCombo({ elegibles: { hamb: { nombre: 'Hamburguesa Resplandor', precio: 30000 } }, promoId: 'prc', dia: null });
const conCombo = (d) => {
  d.tablas.productos.push(
    { id: 'hamb', categoria: 'Platos Fuertes', nombre: 'Hamburguesa Resplandor', precio: 30000, descripcion: 'Pan ajonjolí, 150 g de carne', activo: true, etiqueta: null, dia_semana: null, promo_regla: null },
    { id: 'prc', categoria: 'Promociones', nombre: 'Combo hamburguesas', precio: 50000, descripcion: '', activo: true, etiqueta: '2 Hamburguesas Resplandor', dia_semana: 3,
      promo_regla: { cada: 2, precio: 50000, aplica: { productos: ['hamb'] } } },
  );
  const o = d.tablas.ordenes.find((x) => x.id === 'ord-abierta-3');
  o.items = [{ id: 'hamb', nombre: 'Hamburguesa Resplandor', precio: 30000, qty: 1, nota: '' }];
  o.total = 30000;
};

async function abrirOrden(t, ancho) {
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
      const { diag } = await abrirPos(page, { url: servidor.url, vista: 'orden', ajustar: conCombo });
      return { page, diag, errores };
    } catch (e) { ultimo = e; await ctx?.close().catch(() => {}); }
  }
  t.skip(`no se pudo abrir el POS en el navegador (¿sin red para las fuentes?): ${String(ultimo.message).split('\n')[0]}`);
  return null;
}
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const caja = (loc) => loc.boundingBox();
const reposo = (page) => page.waitForTimeout(300);

for (const ancho of [390, 1280]) {
  test(`navegador ${ancho}: el anuncio de hoy dice «2 por $ 50.000», el combo no se ofrece como producto, la segunda hamburguesa deja la mesa en 50.000 cuando llega el eco (con su pastilla «Combo») y el modal elige entre descuento y precio fijo`, { skip: SALTAR }, async (t) => {
    const r = await abrirOrden(t, ancho);
    if (!r) return;
    const { page, errores } = r;
    assert.deepEqual(errores, [], 'sin errores de página');
    // 1. El anuncio de las promos de hoy
    const anuncio = (await page.locator('.promo-hoy').innerText()).replace(/\s+/g, ' ');
    assert.match(anuncio, /Combo hamburguesas/);
    assert.match(anuncio, /2 Hamburguesas Resplandor/, 'la etiqueta de la promo');
    assert.match(anuncio, /2 por \$ 50\.000 en Hamburguesa Resplandor/);
    assert.match(anuncio, /Se aplica sola en la cuenta/);
    // 2. El combo no es un producto de la carta; la hamburguesa sí
    const carta = await page.locator('.menu-scroll').innerText();
    assert.match(carta, /Hamburguesa Resplandor/);
    assert.equal(await page.locator('.menu-item', { hasText: 'Combo hamburguesas' }).count(), 0, 'el combo no se agrega a mano');
    // 3. La segunda hamburguesa: 60.000 hasta que llega el eco; con el eco, 50.000 y la pastilla del combo
    const pedido = page.locator('.pedido-card');
    assert.match((await pedido.innerText()).replace(/\s+/g, ' '), /\$ 30\.000/);
    await page.locator('.menu-item', { hasText: 'Hamburguesa Resplandor' }).first().click();
    await reposo(page);
    assert.match((await pedido.innerText()).replace(/\s+/g, ' '), /\$ 60\.000/, 'sin el eco, el precio normal');
    const eco = await page.evaluate((fila) => {
      const sim = window.__posSim;
      const o = sim.tablas.ordenes.find((x) => x.id === 'ord-abierta-3');
      const antes = JSON.parse(JSON.stringify(o));
      o.items = fila.items; o.total = fila.total; o.version = (o.version || 0) + 1; o.updated_at = new Date().toISOString();
      sim.emitirCambio('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(o)), old: antes });
      return { version: o.version };
    }, (() => { const items = NORMALIZAR_NAV([{ id: 'hamb', nombre: 'Hamburguesa Resplandor', precio: 30000, qty: 2, nota: '' }], {}); return { items, total: items.reduce((s, i) => s + i.precio * i.qty, 0) }; })());
    assert.ok(eco.version > 0);
    await reposo(page);
    const texto = (await pedido.innerText()).replace(/\s+/g, ' ');
    assert.match(texto, /\$ 50\.000/, 'con el eco, el combo: 50.000');
    assert.doesNotMatch(texto, /\$ 60\.000/);
    const filaPromo = page.locator('.order-item.es-promo');
    assert.equal(await filaPromo.count(), 1, 'la línea de promo del combo');
    assert.match((await filaPromo.innerText()).replace(/\s+/g, ' '), /Hamburguesa Resplandor · Combo hamburguesas/);
    assert.match((await filaPromo.innerText()).replace(/\s+/g, ' '), /Combo · 2 por \$ 50\.000/, 'la pastilla de la línea');
    assert.match((await filaPromo.innerText()).replace(/\s+/g, ' '), /\$ 20\.000/, 'a 20.000 la unidad');
    assert.ok(await sinDesborde(page) <= 0, 'sin desborde horizontal');
    // 4. El modal de producto del combo: precio fijo del grupo, y el cambio de tipo (uno u otro)
    await page.evaluate(() => { const p = Alpine.store('pos'); p.abrirModalProducto(p.productos.find((x) => x.id === 'prc')); });
    await reposo(page);
    const modal = page.locator('.modal:visible').first();
    const tPrecio = modal.locator('#promo-tipo-precio');
    const tDesc = modal.locator('#promo-tipo-descuento');
    assert.equal(await tPrecio.getAttribute('aria-pressed'), 'true');
    assert.equal(await tDesc.getAttribute('aria-pressed'), 'false');
    assert.equal(await modal.locator('#promo-precio-grupo').inputValue(), '50000');
    assert.equal(await modal.locator('#promo-descuento').isVisible(), false, 'con precio fijo no se ve el %');
    // UN solo precio: el campo del producto muestra el del grupo, no se edita aparte y una línea lo explica
    const precioProd = modal.locator('#producto-precio');
    assert.equal(await precioProd.inputValue(), '50000');
    assert.equal(await precioProd.evaluate((e) => e.readOnly), true, 'con precio fijo el campo del producto es de solo lectura');
    assert.equal(await precioProd.getAttribute('aria-describedby'), 'producto-precio-nota');
    assert.equal(await modal.locator('#producto-precio-nota').isVisible(), true);
    assert.match((await modal.locator('#producto-precio-nota').innerText()).replace(/\s+/g, ' '), /el producto cuesta lo mismo que el grupo/);
    assert.match((await modal.innerText()).replace(/\s+/g, ' '), /Hoy: 2 por \$ 50\.000 en Hamburguesa Resplandor\. Cada grupo de 2 cuesta \$ 50\.000/);
    for (const b of [tPrecio, tDesc]) { const c = await caja(b); assert.ok(c.height >= 44 - 0.5, `el botón mide ${c.height} de alto: blanco táctil de 44 px`); }
    assert.ok(await sinDesborde(page) <= 0, 'sin desborde con el modal abierto');
    await tDesc.click(); await reposo(page);
    assert.equal(await tDesc.getAttribute('aria-pressed'), 'true');
    assert.equal(await modal.locator('#promo-descuento').isVisible(), true);
    assert.equal(await modal.locator('#promo-precio-grupo').isVisible(), false);
    assert.match((await modal.innerText()).replace(/\s+/g, ' '), /cada 2, el más barato con 20 % menos en Hamburguesa Resplandor/);
    assert.equal(await precioProd.evaluate((e) => e.readOnly), false, 'con descuento el campo del precio vuelve a editarse');
    assert.equal(await precioProd.inputValue(), '0', 'y vale 0 (la promo de descuento no tiene precio propio)');
    assert.equal(await modal.locator('#producto-precio-nota').isVisible(), false);
    await tPrecio.click(); await reposo(page);
    assert.equal(await precioProd.inputValue(), '50000', 'de vuelta a precio fijo, muestra el del grupo');
    assert.equal(await precioProd.evaluate((e) => e.readOnly), true);
    // validación en pantalla: sin precio no es una regla y lo dice
    await modal.locator('#promo-precio-grupo').fill('');
    await reposo(page);
    assert.match((await modal.locator('[role="alert"]').innerText()).replace(/\s+/g, ' '), /Falta algo: «por cada» de 2 a 10, el precio del grupo \(pesos enteros, de \$ 1 a \$ 10\.000\.000\) y al menos una categoría o un producto\./);
    assert.equal(await precioProd.inputValue(), '', 'sin precio del grupo, el del producto tampoco muestra uno');
    await modal.locator('#promo-precio-grupo').fill('45000');
    await reposo(page);
    assert.equal(await precioProd.inputValue(), '45000', 'el campo del producto sigue al del grupo');
    assert.equal(await modal.locator('[role="alert"]').isVisible(), false);
    assert.match((await modal.innerText()).replace(/\s+/g, ' '), /2 por \$ 45\.000 en Hamburguesa Resplandor/);
    // guardar: la fila sube con la forma nueva (y sin descuento)
    await modal.getByRole('button', { name: /Guardar/ }).click();
    await reposo(page);
    const subida = await page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'db.upsert' && l.tabla === 'productos').map((l) => (Array.isArray(l.carga) ? l.carga[0] : l.carga)));
    const combo = subida.at(-1);
    assert.deepEqual(combo.promo_regla, { cada: 2, precio: 45000, aplica: { productos: ['hamb'] } });
    assert.equal(combo.precio, 45000, 'UN solo precio: el del producto es el del grupo');
    assert.deepEqual(errores, [], 'sin errores de página al final');
  });
}
