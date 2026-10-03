// Pedido de Yonatan (2026-10-01, noche) sobre el POS en producción: tres cosas de la pantalla de la orden y los colores del cierre.
//
//   1. «Dividir cuenta por persona»: cada persona tiene NOMBRE editable (toque en el nombre → campo de 16 px; Enter o salir del
//      campo guarda; vacío vuelve a «Persona N») y un DESPLEGABLE con su detalle (ítems, cantidades, opciones, precio, subtotal).
//      El nombre vive en la `nota` de los ítems de la persona, como sufijo «— Persona 2 (Camila)»: el mismo campo jsonb y el
//      mismo RPC (actualizar_nota_item) que ya guardaban la asignación, sin migración.
//   2. Un solo botón de cobro: «Facturar» de la cabecera se fue (abría el mismo modal que «Generar ticket y cobrar»), y la
//      precuenta se llama «Imprimir precuenta» y dice que no cobra.
//   3. Botones primarios legibles: coral profundo con rótulo claro, los mismos valores en el POS, la carta y la landing.
//   4. Colores del cierre: total vendido manda, pastillas suaves, «Editar» discreto, papelera que no grita.
//
// Segunda vuelta (crítica y refutación de la rama): cada persona es UNA fila de ~56 px y todo el resumen abre el detalle; Enter y
// Escape devuelven el foco al botón del nombre; el cobro sigue a la vista desde 1024 con avisos encima; renombrar no pisa una
// reasignación posterior; el ticket con un nombre largo no desborda; «Cerrar día» deja de ser una losa; «Editar» queda en columna.
//
// Cuatro partes:
//   A. ESTÁTICA (corre siempre, también en CI): el marcado de pos.html.
//   B. LÓGICA (corre siempre): el <script> real de pos.html en un `vm` (_pos-vm.mjs) con una base falsa.
//   C. EN NAVEGADOR (solo con Playwright y un Chromium; si no, se salta con el motivo): el arnés con Supabase simulado
//      (_pos-simulado.mjs), la landing y la carta. Mide estilos calculados y contrastes de verdad.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, nuevoContexto, servirPos } from './_pos-simulado.mjs';
import { asentar, crearBaseFalsa, crearPos, dormir, item, mesaBase, ordenBase, ordenLocal, plano } from './_pos-vm.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');

// ═════════════════════════ A. estática: el marcado ═════════════════════════

const seccionOrden = (() => {
  const i = POS.indexOf(`<section x-show="$store.pos.vista === 'orden'"`);
  const f = POS.indexOf('<!-- ▲ PARTE orden -->');
  assert.ok(i !== -1 && f > i, 'no encontré la sección de la orden');
  return POS.slice(i, f);
})();
const sinComentariosHtml = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ');

test('un solo botón de cobro: la orden abre modalConfirmFactura UNA vez (la barra de cobro) y «Facturar» ya no existe como botón', () => {
  const marcado = sinComentariosHtml(seccionOrden);
  assert.equal((marcado.match(/modalConfirmFactura = true/g) || []).length, 1, 'dos botones abrían el mismo modal: queda uno');
  assert.doesNotMatch(sinComentariosHtml(POS), /'Facturar'|>\s*Facturar\s*</, 'ningún rótulo «Facturar» en el marcado del POS');
  // El que queda es el primario de la barra de cobro; con edicionSinMesa dice «Guardar cambios».
  assert.match(marcado, /<button class="btn-primary lg:w-full" x-show="!\$store\.pos\.seleccionCobro"[\s\S]*?edicionSinMesa \? 'Guardar cambios' : 'Generar ticket y cobrar'/);
  // La cabecera de la orden conserva solo «Ítem manual».
  const cabecera = marcado.slice(marcado.indexOf('class="orden-cab'), marcado.indexOf('fila-acciones'));
  assert.match(cabecera, /Ítem manual/);
  assert.doesNotMatch(cabecera, /btn-telon|receipt/);
});

test('la precuenta se llama «Imprimir precuenta», dice que no cobra y la ayuda se enlaza al botón (y no sale al guardar una cuenta cerrada)', () => {
  const marcado = sinComentariosHtml(seccionOrden);
  assert.match(marcado, /<button class="btn-secondary btn-sm" aria-describedby="ayuda-precuenta"[\s\S]*?imprimirPreCuenta\(\)[\s\S]*?Imprimir precuenta\s*(?:<span class="precuenta-chevron"[\s\S]*?<\/span>\s*)?<\/button>/);   // (con la caja en línea el botón lleva además su chevron y abre la elección de destino)
  assert.doesNotMatch(marcado, /Imprimir cuenta/);
  const ayuda = marcado.match(/<p id="ayuda-precuenta"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(ayuda, 'falta la ayuda de la precuenta');
  assert.match(ayuda[0], /x-show="!\$store\.pos\.edicionSinMesa"/, 'en «Guardar cambios» (cuenta cerrada) no hay precuenta ni ayuda');
  assert.match(ayuda[1], /no cobra/);
  // Una línea a 390 px y pegada a SU botón: «Imprimir precuenta» va última de la fila de acciones (antes, «Enlace NFC» quedaba entre las dos).
  assert.ok(ayuda[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length <= 48, 'la ayuda cabe en una línea de teléfono');
  const acciones = marcado.slice(marcado.indexOf('class="fila-acciones'), marcado.indexOf('<div id="precuenta-destino"'));   // (la elección «En la caja / En este teléfono» va después de la fila)
  const botones = [...acciones.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.match(botones.at(-1), /Imprimir precuenta/, '«Imprimir precuenta» es el último de la fila, pegado a su ayuda');
});

test('dividir por persona: nombre en un botón que se vuelve campo de 16 px, chevron con aria-expanded, detalle y «Cobrar»', () => {
  const marcado = sinComentariosHtml(seccionOrden);
  const tarjeta = marcado.slice(marcado.indexOf('class="card mb-4 p-4 split-personas"'), marcado.indexOf('$store.pos.otrosEnMesa($store.pos.mesaActiva.id).length > 0'));
  assert.match(tarjeta, /persona-nombre-btn/);
  assert.match(tarjeta, /<input type="text" x-ref="campo"\s+class="field persona-campo"/);
  assert.match(tarjeta, /empezar\(\) \{[^}]*editando = true;[^}]*\.focus\(\)/, 'el foco va dentro del toque (iOS no abre el teclado con un focus() posterior)');
  assert.doesNotMatch(tarjeta, /<input[^>]*x-show/, 'el campo no se oculta con display:none: no podría tomar el foco dentro del toque');
  assert.match(tarjeta, /@keydown\.enter\.prevent="terminar\(true\)"/, 'Enter guarda');
  assert.match(tarjeta, /@blur="guardar\(\)"/, 'salir del campo guarda');
  assert.match(tarjeta, /@keydown\.escape\.prevent="terminar\(false\)"/, 'Escape cancela');
  assert.match(tarjeta, /terminar\(guarda\) \{[^}]*\$refs\.boton\.focus\(\)/, 'Enter y Escape devuelven el foco al botón del nombre (el campo inactivo mide 0×0)');
  assert.match(tarjeta, /<button type="button" class="persona-nombre-btn" x-ref="boton"\s+:aria-label/, 'el botón del nombre se esconde con la clase de la fila, no con x-show (que lo esconde un instante después del campo)');
  // El total ES el botón del detalle (toda la línea de resumen abre el desplegable); el chevron es solo el indicador.
  assert.match(tarjeta, /<button type="button" class="persona-meta tabular" @click="abierto = !abierto" :aria-expanded="abierto"\s+:aria-controls="'persona-detalle-'/);
  assert.match(tarjeta, /<button type="button" class="persona-chev" tabindex="-1" aria-hidden="true"\s+@click="abierto = !abierto">/, 'un solo control de lectores por fila');
  assert.match(tarjeta, /persona-detalle/);
  assert.doesNotMatch(tarjeta, /Subtotal|persona-subtotal/, 'sin subtotal: repetía el total de la fila');
  assert.match(tarjeta, /<div class="persona-split-nombre">/);
  assert.doesNotMatch(tarjeta, /class="persona-nombre"/, '.persona-nombre es la lista del Personal: una clase para dos cosas hacía que una regla pisara a la otra');
  assert.match(tarjeta, /cobrarGrupoPersona\(persona\)/, '«Cobrar» de la persona se mantiene');
  assert.doesNotMatch(tarjeta, /data-lucide/, 'íconos en SVG: la lista cambia con Realtime y lucide no se vuelve a correr');
  // CSS: campo de 16 px (iOS no hace zoom), 44 px táctiles.
  const css = POS.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.persona-campo\s*\{[^}]*font-size:\s*1rem/);
  assert.match(css, /\.persona-campo\s*\{[^}]*min-height:\s*var\(--pos-tactil\)/);
  assert.match(css, /\.persona-chev\s*\{[^}]*width:\s*var\(--pos-tactil\)[^}]*height:\s*var\(--pos-tactil\)|\.persona-chev\s*\{[^}]*height:\s*var\(--pos-tactil\)[^}]*width:\s*var\(--pos-tactil\)/);
  assert.match(css, /\.persona-nombre-btn\s*\{[^}]*min-height:\s*var\(--pos-tactil\)/);
});

test('estática (segunda vuelta): fila de una línea, campo y detalle acotados, columna del pedido con medida, «Cerrar día» de pie, ticket que parte el valor largo', () => {
  const css = POS.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  // A1: una sola fila ≥ 360 px (chevron, nombre, total, cobrar) y en dos solo por debajo.
  assert.match(css, /@media \(min-width: 360px\)\s*\{\s*\.persona-split\s*\{[^}]*"chev nombre meta cobrar"\s*"det\s+det\s+det\s+det"/);
  // A2: el total mide 44 px de alto (es un botón).
  assert.match(css, /\.persona-meta\s*\{[^}]*min-height:\s*var\(--pos-tactil\)/);
  // M1: el contenedor del nombre de la tarjeta ya no se llama como el de la lista del Personal.
  assert.match(css, /\.persona-split-nombre\s*\{[^}]*position:\s*relative/);
  // M5 y B3: el campo y el detalle no se estiran por toda la columna.
  assert.match(css, /\.persona-campo\s*\{[^}]*max-width:\s*20rem/);
  assert.match(css, /\.persona-detalle\s*\{[^}]*max-width:\s*36rem/);
  // Editando: el botón del nombre y el total se esconden con la clase de la fila.
  assert.match(css, /\.persona-split\.editando \.persona-nombre-btn,\s*\.persona-split\.editando \.persona-meta\s*\{\s*display:\s*none/);
  // La rejilla de la cuenta (≥ 1024) toma su alto de lo medido (--orden-ocupado: lo que NO es la rejilla), con piso y con una cuenta gruesa si no hay medida.
  // (El detalle y la medida en navegador: pos-orden-escritorio.test.mjs.)
  assert.match(css, /\.vista-orden > \.orden-rejilla\s*\{[^}]*height:\s*max\(13rem, calc\(100dvh - var\(--orden-ocupado, calc\(var\(--pos-nav-alto\) \+ 17\.5rem\)\)\)\)/);
  assert.match(POS, /x-init="\$store\.pos\.vigilarAltoPedido\(\$el\)"/);
  // M4: el importe de cada transacción mide lo mismo desde 640, y «Editar» cae en columna.
  assert.match(css, /\.fila-tx-der > \.importe\s*\{[^}]*min-width:\s*6\.5rem[^}]*text-align:\s*right/);
  // «Cerrar día»: botón de pie (sin btn-lg), a la derecha desde 640.
  const cierre = POS.match(/<button class="([^"]*)" :disabled="!\$store\.pos\.puedeCerrarAhora"/);   // (la ola C lo apaga también sin red: puedeCerrarAhora)
  assert.ok(cierre, 'no encontré «Cerrar día»');
  assert.match(cierre[1], /\bbtn-primary\b/);
  assert.doesNotMatch(cierre[1], /btn-lg/, 'sin btn-lg: 48 px, no una losa de 56');
  assert.match(cierre[1], /sm:w-auto/);
  assert.match(cierre[1], /sm:ml-auto/);
  // El valor largo de «Cuenta de» se parte por dentro (como ya hacía el rollo térmico) y la etiqueta no.
  assert.match(css, /\.ticket-meta \.meta-row span:last-child\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
});

test('el pedido muestra la persona con su nombre en una pastilla aparte y «Reasignar»/«Asignar a persona» lo nombran para lectores', () => {
  const marcado = sinComentariosHtml(seccionOrden);
  assert.match(marcado, /nota-persona[\s\S]*?x-text="\$store\.pos\.nombrePersona\(\$store\.pos\.pagadorDe\(item\)\)"/);
  assert.match(marcado, /<button type="button" class="btn-enlace" x-show="item\.precio >= 0"\s+:aria-label="[^"]*nombrePersona\(\$store\.pos\.pagadorDe\(item\)\)[^"]*"/);
  assert.match(marcado, /'Reasignar'\s*:\s*'Asignar a persona'/, 'el texto visible no cambia');
});

test('el ticket de una persona dice «Cuenta de <nombre>» y no repite el nombre en cada línea', () => {
  assert.match(POS, /<span>Cuenta de<\/span>\s*<span x-text="\$store\.pos\.ordenTicket\?\.persona"><\/span>/);
  assert.match(POS, /notaTxt\(item, !\$store\.pos\.ordenTicket\?\.persona, \$store\.pos\.ordenTicket\?\.items\)/, 'el nombre sale de la cuenta entera: dos «Camila» se distinguen');
});

// ═════════════════════════ B. lógica: el store real ═════════════════════════

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
const conNota = (id, precio, qty, nota, nombre = id) => ({ ...item(id, precio, qty), nombre, nota });

function montar() {
  const base = crearBaseFalsa({ mesas: [mesaBase(3)] });
  const t = crearPos({ base });
  t.base = base;
  t.pos.usuario = YO;
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
const llamadasNota = (t) => t.supabase.rpcs('actualizar_nota_item').map((c) => [c.args.p_item_id, c.args.p_nota]);

test('la nota se lee con el sufijo de antes («Persona 1») y con el nuevo («Persona 1 (Camila)»): clave, nombre y nota base', () => {
  const { pos } = montar();
  const leer = (nota) => plano({ pagador: pos.pagadorDe({ nota }), base: pos.notaBase({ nota }), nombre: pos._parsearPersona(nota).nombre });
  assert.deepEqual(leer('Persona 1'), { pagador: 'Persona 1', base: '', nombre: '' });
  assert.deepEqual(leer('Sopa · Pollo — Persona 2'), { pagador: 'Persona 2', base: 'Sopa · Pollo', nombre: '' });
  assert.deepEqual(leer('Persona 3 (Camila)'), { pagador: 'Persona 3', base: '', nombre: 'Camila' });
  assert.deepEqual(leer('Sopa · Pollo — Persona 4 (Ana María)'), { pagador: 'Persona 4', base: 'Sopa · Pollo', nombre: 'Ana María' });
  assert.deepEqual(leer('Sin cebolla'), { pagador: '', base: 'Sin cebolla', nombre: '' });
  assert.deepEqual(leer(''), { pagador: '', base: '', nombre: '' });
  assert.deepEqual(leer('Para Persona 2'), { pagador: '', base: 'Para Persona 2', nombre: '' }, 'solo el sufijo cuenta');
});

test('el nombre se limpia: sin paréntesis ni rayas, espacios colapsados, hasta 24 caracteres, y «Persona N» o vacío = sin nombre', () => {
  const { pos } = montar();
  const l = (x) => pos._limpiarNombrePersona(x);
  assert.equal(l('  Camila  '), 'Camila');
  assert.equal(l('Ana   María'), 'Ana María');
  assert.equal(l('Cami (la jefa) — hoy'), 'Cami la jefa hoy', 'lo que rompería el sufijo se va');
  assert.equal(l('x'.repeat(40)).length, 24);
  assert.equal(l(''), '');
  assert.equal(l('   '), '');
  assert.equal(l('Persona 2'), '');
  assert.equal(l('persona 4'), '');
  assert.equal(l(null), '');
  assert.equal(l('Persona 2 Camila'), 'Persona 2 Camila', 'solo el nombre de fábrica exacto vuelve al de fábrica');
});

test('ciclarPagador: asigna, rota Persona 1 → 4 → sin asignar y guarda con el mismo RPC; la persona que ya tiene nombre se lo pasa al ítem nuevo', async () => {
  const t = montar();
  const orden = conOrden(t, [conNota('a', 5000, 1, 'Persona 1 (Camila)'), conNota('b', 7000, 1, 'Sin sal'), conNota('c', 9000, 1, '')]);
  t.pos.ciclarPagador(orden.items[1]);                                  // sin asignar → Persona 1, que ya se llama Camila
  assert.equal(orden.items[1].nota, 'Sin sal — Persona 1 (Camila)');
  t.pos.ciclarPagador(orden.items[1]);                                  // → Persona 2 (sin nombre)
  assert.equal(orden.items[1].nota, 'Sin sal — Persona 2');
  t.pos.ciclarPagador(orden.items[2]);                                  // sin nota → «Persona 1 (Camila)», sin base
  assert.equal(orden.items[2].nota, 'Persona 1 (Camila)');
  for (let i = 0; i < 4; i++) t.pos.ciclarPagador(orden.items[1]);      // 2 → 3 → 4 → sin asignar → 1
  assert.equal(orden.items[1].nota, 'Sin sal — Persona 1 (Camila)');
  t.pos.ciclarPagador(orden.items[1]); t.pos.ciclarPagador(orden.items[1]); t.pos.ciclarPagador(orden.items[1]); t.pos.ciclarPagador(orden.items[1]);
  assert.equal(orden.items[1].nota, 'Sin sal', 'tras la 4 vuelve a sin asignar y la nota base queda intacta');
  await asentar();
  assert.equal(llamadasNota(t).length, 2 + 1 + 4 + 4, 'una llamada a actualizar_nota_item por cada cambio');
  assert.deepEqual(llamadasNota(t)[0], ['b', 'Sin sal — Persona 1 (Camila)']);
});

test('renombrarPersona: reescribe el sufijo de TODOS los ítems de la persona, en orden y de inmediato en pantalla, y los guarda uno a uno con el RPC de la nota', async () => {
  const t = montar();
  const orden = conOrden(t, [
    conNota('a', 21000, 1, 'Sopa · Pollo — Persona 1'), conNota('b', 13000, 1, 'Persona 1'),
    conNota('c', 21000, 1, 'Persona 2 (Andrés)'), conNota('d', 9000, 2, ''),
  ]);
  const prometida = t.pos.renombrarPersona('Persona 1', '  Camila ');
  // Antes de que llegue la primera respuesta, la pantalla ya cambió (la copia local se escribe síncrona).
  assert.deepEqual(notasDe(t), [['a', 'Sopa · Pollo — Persona 1 (Camila)'], ['b', 'Persona 1 (Camila)'], ['c', 'Persona 2 (Andrés)'], ['d', '']]);
  assert.equal(t.pos.nombrePersona('Persona 1'), 'Camila');
  assert.equal(t.pos.nombrePersona('Persona 2'), 'Andrés');
  assert.equal(t.pos.nombrePersona('Persona 3'), 'Persona 3', 'sin ítems ni nombre: el de fábrica');
  assert.equal(await prometida, 'Camila');
  await asentar();
  assert.deepEqual(llamadasNota(t), [['a', 'Sopa · Pollo — Persona 1 (Camila)'], ['b', 'Persona 1 (Camila)']], 'solo los ítems de esa persona, en el orden de la orden');
  assert.equal(t.supabase.rpcs('actualizar_nota_item')[0].args.p_orden_id, orden.id);
  assert.deepEqual(plano(t.pos.gruposPorPersona['Persona 1'].map((i) => i.id)), ['a', 'b'], 'la clave de grupo sigue siendo «Persona 1»');
});

test('renombrarPersona: vacío o «Persona N» vuelve al nombre de fábrica; el mismo nombre no llama a nada; sin ítems no hay nada que renombrar', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 1, 'Sopa — Persona 1 (Camila)'), conNota('b', 5000, 1, 'Persona 1 (Camila)')]);
  assert.equal(await t.pos.renombrarPersona('Persona 1', 'Camila'), 'Camila');
  await asentar();
  assert.deepEqual(llamadasNota(t), [], 'sin cambios no hay llamadas');

  assert.equal(await t.pos.renombrarPersona('Persona 1', ''), '');
  assert.deepEqual(notasDe(t), [['a', 'Sopa — Persona 1'], ['b', 'Persona 1']]);
  assert.equal(t.pos.nombrePersona('Persona 1'), 'Persona 1');
  assert.equal(llamadasNota(t).length, 2);

  await t.pos.renombrarPersona('Persona 1', 'Valentina');
  assert.equal(await t.pos.renombrarPersona('Persona 1', 'Persona 3'), '', 'escribir «Persona 3» en la 1 tampoco es un nombre');
  assert.deepEqual(notasDe(t), [['a', 'Sopa — Persona 1'], ['b', 'Persona 1']]);

  assert.equal(await t.pos.renombrarPersona('Persona 4', 'Nadie'), null, 'una persona sin ítems no se renombra');
  assert.equal(await t.pos.renombrarPersona('Persona 9', 'Nadie'), null, 'ni una clave que no existe');
});

test('renombrarPersona: un nombre con paréntesis o rayas no rompe el sufijo (se agrupa igual) y la base solo recibe notas bien formadas', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 1, 'Persona 2')]);
  await t.pos.renombrarPersona('Persona 2', 'Cami (la jefa) — 12');
  assert.equal(t.pos.ordenActiva.items[0].nota, 'Persona 2 (Cami la jefa 12)');
  assert.equal(t.pos.pagadorDe(t.pos.ordenActiva.items[0]), 'Persona 2');
  assert.deepEqual(plano(Object.keys(t.pos.gruposPorPersona)), ['Persona 2']);
});

test('nombres de una misma persona distintos (otra tablet con la pantalla vieja): gana el del primer ítem con nombre, y no cambia mientras llegan los ecos', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 1000, 1, 'Persona 1 (Camila)'), conNota('b', 1000, 1, 'Persona 1 (Cami)'), conNota('c', 1000, 1, 'Persona 1')]);
  assert.equal(t.pos.nombrePersona('Persona 1'), 'Camila');
  // Renombrar los reescribe a todos con el mismo nombre.
  await t.pos.renombrarPersona('Persona 1', 'Camila Ríos');
  assert.deepEqual(notasDe(t).map(([, n]) => n), ['Persona 1 (Camila Ríos)', 'Persona 1 (Camila Ríos)', 'Persona 1 (Camila Ríos)']);
});

test('con una orden cerrada en edición el nombre se guarda solo en local (como la asignación): ningún RPC', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 1, 'Persona 1')]);
  t.pos.cierreEditando = { id: 'c1' };
  assert.equal(await t.pos.renombrarPersona('Persona 1', 'Camila'), 'Camila');
  await asentar();
  assert.equal(t.pos.ordenActiva.items[0].nota, 'Persona 1 (Camila)');
  assert.deepEqual(llamadasNota(t), []);
});

test('renombrarPersona: una reasignación hecha mientras se guardan los ítems GANA (la nota de cada ítem se arma justo antes de enviarla), y la base no vuelve a «Persona 1 (Ana)»', async () => {
  const t = montar();
  t.base.latenciaMs = 20;
  conOrden(t, [conNota('a', 21000, 1, 'Persona 1'), conNota('b', 13000, 1, 'Persona 1'), conNota('c', 9000, 1, 'Persona 1')]);
  const prometida = t.pos.renombrarPersona('Persona 1', 'Ana');
  await dormir(5);                                                       // el primer RPC aún no volvió: el mesero reasigna «b» a la Persona 2
  t.pos.ciclarPagador(t.pos.ordenActiva.items[1]);
  assert.equal(t.pos.ordenActiva.items[1].nota, 'Persona 2');
  await prometida;
  await dormir(80);
  const ultima = {};
  llamadasNota(t).forEach(([id, nota]) => { ultima[id] = nota; });         // las llamadas salen en el orden en que llegan a la base
  assert.deepEqual(ultima, { a: 'Persona 1 (Ana)', b: 'Persona 2', c: 'Persona 1 (Ana)' }, 'lo posterior gana: «b» queda en la Persona 2');
  assert.equal(t.pos.ordenActiva.items[1].nota, 'Persona 2', 'y la pantalla tampoco vuelve atrás');
});

test('renombrarPersona: un segundo renombrado de la misma persona toma el relevo (el primero deja de enviar y la base termina con el último nombre)', async () => {
  const t = montar();
  t.base.latenciaMs = 15;
  conOrden(t, [conNota('a', 1000, 1, 'Persona 1'), conNota('b', 1000, 1, 'Persona 1'), conNota('c', 1000, 1, 'Persona 1')]);
  const primero = t.pos.renombrarPersona('Persona 1', 'Ana');
  await dormir(5);
  const segundo = t.pos.renombrarPersona('Persona 1', 'Bea');
  await Promise.all([primero, segundo]);
  await dormir(80);
  const ultima = {};
  llamadasNota(t).forEach(([id, nota]) => { ultima[id] = nota; });
  assert.deepEqual(ultima, { a: 'Persona 1 (Bea)', b: 'Persona 1 (Bea)', c: 'Persona 1 (Bea)' });
  assert.equal(llamadasNota(t).filter(([, n]) => /Ana/.test(n)).length, 1, 'el primero solo alcanzó a mandar el ítem que ya iba en camino');
});

test('una tablet con la pantalla de antes apila sufijos («Sopa — Persona 2 (Camila) — Persona 1»): el último manda y la base queda limpia, también al renombrar', async () => {
  const t = montar();
  const { pos } = t;
  assert.deepEqual(plano({ pagador: pos.pagadorDe({ nota: 'Sopa — Persona 2 (Camila) — Persona 1' }), base: pos.notaBase({ nota: 'Sopa — Persona 2 (Camila) — Persona 1' }) }), { pagador: 'Persona 1', base: 'Sopa' });
  assert.equal(pos.notaBase({ nota: 'Persona 2 (Camila) — Persona 3 (Ana) — Persona 1' }), '');
  assert.equal(pos.notaLegible({ nota: 'Sopa — Persona 2 (Camila) — Persona 1' }), 'Sopa — Persona 1', 'el ticket no imprime el sufijo viejo');
  assert.equal(pos.notaBase({ nota: 'Sin cebolla — Persona 2' }), 'Sin cebolla', 'lo de siempre no cambia');
  conOrden(t, [conNota('a', 1000, 1, 'Sopa — Persona 2 (Camila) — Persona 1')]);
  await t.pos.renombrarPersona('Persona 1', 'Ana');
  assert.equal(t.pos.ordenActiva.items[0].nota, 'Sopa — Persona 1 (Ana)', 'renombrar reescribe la nota limpia');
});

test('dos personas con el mismo nombre se distinguen: «Camila (P2)» en pastillas y tickets, y el campo de edición conserva el nombre tal cual', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 1000, 1, 'Persona 1 (Camila)'), conNota('b', 1000, 1, 'Persona 2 (camila)'), conNota('c', 1000, 1, 'Persona 3 (Andrés)'), conNota('d', 1000, 1, 'Persona 4')]);
  assert.equal(t.pos.nombrePersona('Persona 1'), 'Camila (P1)');
  assert.equal(t.pos.nombrePersona('Persona 2'), 'camila (P2)', 'sin distinguir mayúsculas');
  assert.equal(t.pos.nombrePersona('Persona 3'), 'Andrés', 'un nombre único no cambia');
  assert.equal(t.pos.nombrePersona('Persona 4'), 'Persona 4');
  assert.equal(t.pos.nombresPersonas['Persona 1'], 'Camila', 'el nombre guardado es el que se escribió');
  const items = t.pos.ordenActiva.items;
  assert.equal(t.pos.notaLegible(items[1], true, items), 'camila (P2)', 'el ticket de la cuenta entera también las distingue');
  assert.equal(t.pos.notaLegible(items[2], true, items), 'Andrés');
  assert.equal(t.pos.notaLegible(items[1]), 'camila', 'sin la lista de la cuenta, el nombre del propio ítem');
  t.pos.cobrarGrupoPersona('Persona 2');
  await asentar();
  assert.equal(t.pos.ticketMostrado.persona, 'camila (P2)', 'y «Cuenta de» dice cuál');
});

test('notaLegible: el sufijo de persona sale con su nombre («Cerdo — Camila»), sin nombre con «Persona N», y se puede omitir', () => {
  const { pos } = montar();
  assert.equal(pos.notaLegible({ nota: 'Cerdo — Persona 1 (Camila)' }), 'Cerdo — Camila');
  assert.equal(pos.notaLegible({ nota: 'Cerdo — Persona 1' }), 'Cerdo — Persona 1');
  assert.equal(pos.notaLegible({ nota: 'Persona 2 (Andrés)' }), 'Andrés');
  assert.equal(pos.notaLegible({ nota: 'Cerdo — Persona 1 (Camila)' }, false), 'Cerdo');
  assert.equal(pos.notaLegible({ nota: 'Persona 2' }, false), '');
  assert.equal(pos.notaLegible({ nota: 'Sopa · Pollo' }), 'Sopa · Pollo');
  assert.equal(pos.notaLegible({ nota: '' }), '');
});

test('cobrarGrupoPersona: cobra solo las líneas de esa persona, el ticket lleva su nombre editado (solo local) y la base no recibe «persona»', async () => {
  const t = montar();
  conOrden(t, [
    conNota('a', 21000, 1, 'Sopa — Persona 1 (Camila)', 'Ejecutivo'), conNota('b', 13000, 1, 'Persona 1 (Camila)', 'Limonada'),
    conNota('c', 16000, 1, 'Persona 2', 'Empanadas'),
  ]);
  t.pos.cobrarGrupoPersona('Persona 1');
  await asentar();
  const tk = t.pos.ticketMostrado;
  assert.equal(tk.persona, 'Camila', 'el ticket dice de quién es');
  assert.deepEqual(plano(tk.items.map((i) => i.id)), ['a', 'b']);
  assert.equal(tk.total, 34000);
  assert.equal(tk.quedan, 16000, 'y lo que queda por pagar en la mesa');
  assert.equal(t.pos.vista, 'ticket');
  assert.deepEqual(plano(t.pos.ordenActiva.items.map((i) => i.id)), ['c'], 'la mesa sigue abierta con lo de la otra persona');
  const cerrada = [...t.base.ordenes.values()].find((o) => o.estado === 'cerrada');
  assert.ok(cerrada && !('persona' in cerrada), 'formatOrden no sube el campo local «persona»');
  assert.equal(cerrada.items[0].nota, 'Sopa — Persona 1 (Camila)', 'la venta cerrada conserva quién pagó, en la nota');
  // Una persona sin nombre: el ticket dice «Persona 2».
  t.pos.ticketMostrado = null; t.pos.vista = 'orden';
  t.pos.cobrarGrupoPersona('Persona 2');
  await asentar();
  assert.equal(t.pos.ticketMostrado.persona, 'Persona 2');
});

test('cobro por partes de siempre (sin persona): el ticket no lleva «persona»', async () => {
  const t = montar();
  conOrden(t, [conNota('a', 5000, 2, ''), conNota('b', 7000, 1, '')]);
  t.pos.facturarParcial({ a: 1 });
  await asentar();
  assert.equal(t.pos.ticketMostrado.persona, '');
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
  // Un reintento: con la máquina cargada (otras pruebas de navegador a la vez) la primera carga puede pasarse de tiempo.
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

/** Una página del sitio público (landing o carta) con el CSS compilado, sin red externa. */
async function abrirSitio(t, pagina, ancho) {
  try {
    servidor ||= await servirPos(RAIZ, 0);
    navegador ||= await pw.chromium.launch();
    const ctx = await nuevoContexto(navegador, { ancho, alto: 900, movil: ancho < 768 });
    contextos.push(ctx);
    const page = await ctx.newPage();
    await page.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(servidor.url).origin ? r.continue() : r.abort()));
    await page.goto(`${servidor.url}/${pagina}`, { waitUntil: 'load' });
    return { page };
  } catch (e) {
    t.skip(`no se pudo abrir ${pagina}: ${String(e.message).split('\n')[0]}`);
    return null;
  }
}

// WCAG 2.x sobre colores CALCULADOS por el navegador: «rgb(r, g, b)» o «rgba(r, g, b, a)».
const aRgb = (css) => { const m = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/); assert.ok(m, `color ilegible: ${css}`); return [m[1], m[2], m[3]].map(Number); };
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrasteCss = (a, b) => { const [x, y] = [lum(aRgb(a)), lum(aRgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const reposo = (page) => page.waitForTimeout(200);
const filas = (page) => page.locator('.persona-split');
const textos = (loc) => loc.allInnerTexts().then((l) => l.map((x) => x.replace(/\s+/g, ' ').trim()));
const llamadasDeNota = (page) => page.evaluate(() => window.__posSim.llamadas.filter((l) => l.tipo === 'rpc' && l.nombre === 'actualizar_nota_item').map((l) => [l.args.p_item_id, l.args.p_nota]));

test('personas (navegador): tres filas con su nombre y su total, plegadas; el total (o el chevron) despliega ítems con cantidad, opciones y precio', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas', 390); if (!a) return;
  const { page } = a;
  assert.deepEqual(await textos(page.locator('.persona-nombre-txt')), ['Camila', 'Andrés', 'Persona 3']);
  assert.deepEqual(await textos(page.locator('.persona-meta')), ['$ 34.000', '$ 37.000', '$ 54.000'], 'la fila dice el total; los ítems van en el detalle');
  assert.equal(await page.locator('.persona-detalle:visible').count(), 0, 'plegadas de entrada');
  const meta = filas(page).nth(0).locator('.persona-meta');
  const chev = filas(page).nth(0).locator('.persona-chev');
  assert.equal(await meta.evaluate((e) => e.tagName), 'BUTTON', 'el total es un botón');
  assert.equal(await meta.getAttribute('aria-expanded'), 'false');
  assert.match(await meta.getAttribute('aria-label'), /^Ver el detalle de Camila: \$ 34\.000$/, 'el nombre accesible lleva el texto visible');
  // Tocar el TOTAL (la línea de resumen) abre el detalle; antes solo lo abría el chevron de 44 px de la izquierda.
  await meta.click(); await reposo(page);
  assert.equal(await meta.getAttribute('aria-expanded'), 'true');
  assert.match(await meta.getAttribute('aria-label'), /^Ocultar el detalle de Camila/);
  const detalle = filas(page).nth(0).locator('.persona-detalle');
  assert.equal(await detalle.isVisible(), true);
  assert.deepEqual(await textos(detalle.locator('.persona-linea')), ['1 × Ejecutivo de la casa Sopa · Pollo $ 21.000', '1 × Limonada de coco $ 13.000']);
  assert.equal(await detalle.locator('.persona-subtotal').count(), 0, 'sin subtotal: el total está en la fila');
  assert.equal(await detalle.getAttribute('id'), await meta.getAttribute('aria-controls'));
  assert.equal(await chev.getAttribute('aria-hidden'), 'true', 'el chevron es el indicador: el control para lectores es el total');
  assert.equal(await chev.evaluate((e) => getComputedStyle(e.querySelector('svg')).transform !== 'none'), true, 'y gira al abrir');
  await meta.click(); await reposo(page);
  assert.equal(await detalle.isVisible(), false, 'se vuelve a plegar');
  await chev.click(); await reposo(page);
  assert.equal(await detalle.isVisible(), true, 'el chevron también abre (blanco de 44 px)');
  assert.equal(await meta.getAttribute('aria-expanded'), 'true');
  await chev.click(); await reposo(page);
  // Las pastillas del pedido usan el nombre; el ítem sin asignar no tiene.
  assert.deepEqual(await textos(page.locator('.nota-persona:visible')), ['Camila', 'Camila', 'Andrés', 'Andrés', 'Persona 3', 'Persona 3']);
  assert.match(await page.locator('.order-item').first().getByRole('button', { name: /Reasignar Ejecutivo de la casa \(ahora de Camila\)/ }).getAttribute('aria-label'), /Camila/);
  assert.ok(await page.locator('.order-item').last().getByRole('button', { name: /Asignar Cóctel de la casa a una persona/ }).count());
  assert.deepEqual(a.diag.errores, []);
});

test('personas (navegador): tocar el nombre abre un campo de 16 px; Enter guarda en TODOS los ítems de la persona, lo ven las pastillas y viaja por el RPC de la nota', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas', 390); if (!a) return;
  const { page } = a;
  const fila = filas(page).nth(2);
  await fila.locator('.persona-nombre-btn').click();
  const campo = fila.locator('.persona-campo');
  await campo.waitFor();
  assert.equal(await campo.isVisible(), true);
  assert.equal(await fila.locator('.persona-nombre-btn').isVisible(), false);
  const caja = await campo.boundingBox();
  assert.ok(caja.height >= 43.5, `el campo mide ${caja.height} px de alto, mínimo 44`);
  assert.equal(await campo.evaluate((e) => getComputedStyle(e).fontSize), '16px', 'a 16 px iOS no hace zoom');
  assert.equal(await campo.inputValue(), '', 'Persona 3 aún no tiene nombre: el campo empieza vacío (el de fábrica se ve de ayuda)');
  assert.equal(await campo.getAttribute('placeholder'), 'Persona 3');
  await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('persona-campo'), null, { timeout: 5000 }); // con el foco puesto (el teclado del teléfono sale solo)
  await campo.fill('Valentina');
  await campo.press('Enter'); await reposo(page);
  assert.deepEqual(await textos(page.locator('.persona-nombre-txt')), ['Camila', 'Andrés', 'Valentina']);
  assert.equal(await campo.isVisible(), false);
  assert.equal(await fila.locator('.persona-nombre-btn').isVisible(), true);
  assert.deepEqual(await textos(page.locator('.nota-persona:visible')), ['Camila', 'Camila', 'Andrés', 'Andrés', 'Valentina', 'Valentina']);
  await page.waitForFunction(() => window.__posSim.llamadas.filter((l) => l.nombre === 'actualizar_nota_item').length >= 2);
  assert.deepEqual(await llamadasDeNota(page), [['pf3', 'Persona 3 (Valentina)'], ['be2', 'Persona 3 (Valentina)']], 'un RPC por ítem, con la misma forma de nota que la asignación');
  // «Sobrevive» y «llega a las otras tablets»: la fila que quedó en la base y que Realtime le lleva a otra tablet trae el nombre.
  const tras = await page.evaluate(() => {
    const fila = window.__posSim.tablas.ordenes.find((o) => o.id === 'ord-abierta-3');
    const p = Alpine.store('pos');
    p.procesarCambioEnVivo('ordenes', { eventType: 'UPDATE', new: JSON.parse(JSON.stringify(fila)) });
    return { notas: fila.items.map((i) => i.nota), nombre: p.nombrePersona('Persona 3') };
  });
  assert.deepEqual(tras.notas, ['Sopa · Pollo — Persona 1 (Camila)', 'Persona 1 (Camila)', 'Frijol · Res — Persona 2 (Andrés)', 'Persona 2 (Andrés)', 'Persona 3 (Valentina)', 'Persona 3 (Valentina)', '']);
  assert.equal(tras.nombre, 'Valentina');
});

test('personas (navegador): salir del campo guarda, Escape cancela y dejarlo vacío vuelve a «Persona N»', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas', 390); if (!a) return;
  const { page } = a;
  const nombreDe = (n) => filas(page).nth(n).locator('.persona-nombre-txt').innerText();
  // Escape: descarta lo escrito.
  await filas(page).nth(0).locator('.persona-nombre-btn').click();
  await filas(page).nth(0).locator('.persona-campo').fill('Otra cosa');
  await filas(page).nth(0).locator('.persona-campo').press('Escape'); await reposo(page);
  assert.equal(await nombreDe(0), 'Camila');
  assert.deepEqual(await llamadasDeNota(page), [], 'cancelar no escribe nada');
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'persona-nombre-btn', 'el foco vuelve al botón del nombre, no se queda en el campo de 0×0');
  // Blur: guarda (se toca otra parte de la pantalla).
  await filas(page).nth(1).locator('.persona-nombre-btn').click();
  await filas(page).nth(1).locator('.persona-campo').fill('Andrés Felipe');
  await page.locator('h1.titulo-orden').click(); await reposo(page);
  assert.equal(await nombreDe(1), 'Andrés Felipe');
  // Vacío: vuelve al de fábrica.
  await filas(page).nth(0).locator('.persona-nombre-btn').click();
  await filas(page).nth(0).locator('.persona-campo').fill('');
  await filas(page).nth(0).locator('.persona-campo').press('Enter'); await reposo(page);
  assert.equal(await nombreDe(0), 'Persona 1');
  assert.deepEqual(await textos(page.locator('.nota-persona:visible')), ['Persona 1', 'Persona 1', 'Andrés Felipe', 'Andrés Felipe', 'Persona 3', 'Persona 3']);
  assert.deepEqual(a.diag.errores, []);
});

test('personas (navegador): «Cobrar» de una persona lleva al ticket «Cuenta de <nombre>» con solo sus líneas, y la mesa sigue abierta con el resto', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'ticket-persona', 390); if (!a) return;
  const { page } = a;
  const ticket = await page.locator('.ticket').innerText();
  assert.match(ticket.replace(/\s+/g, ' '), /Cuenta de Camila/);
  assert.match(ticket, /1 x Ejecutivo de la casa/);
  assert.match(ticket, /1 x Limonada de coco/);
  assert.doesNotMatch(ticket, /Empanadas|Pechuga|Cóctel/, 'solo lo de Camila');
  const lineas = await page.locator('.ticket-line .name').allInnerTexts();
  assert.ok(lineas.length >= 2 && lineas.every((l) => !/Camila/.test(l)), `el nombre no se repite en cada línea: ${lineas.join(' | ')}`);
  assert.match(ticket.replace(/\s+/g, ' '), /Total \$ 34\.000/i);
  assert.match(ticket.replace(/\s+/g, ' '), /Queda por pagar \$ 123\.000/);
  assert.deepEqual(a.diag.errores, []);
});

test('un solo cobro (navegador): sin «Facturar» a 390 y 1440; «Generar ticket y cobrar» abre «Confirmar cobro»; con una cuenta cerrada en edición dice «Guardar cambios»', { skip: SALTAR }, async (t) => {
  for (const ancho of [390, 1440]) {
    const a = await abrir(t, 'orden', ancho); if (!a) return;
    const { page } = a;
    assert.equal(await page.getByRole('button', { name: /Facturar/ }).count(), 0, `sin «Facturar» a ${ancho} px`);
    assert.equal(await page.getByRole('button', { name: 'Imprimir precuenta', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: /Imprimir cuenta/ }).count(), 0);
    assert.equal(await page.locator('#ayuda-precuenta').isVisible(), true);
    assert.match(await page.locator('#ayuda-precuenta').innerText(), /no cobra/);
    assert.equal(await page.getByRole('button', { name: 'Imprimir precuenta' }).getAttribute('aria-describedby'), 'ayuda-precuenta');
    const cobrar = page.getByRole('button', { name: 'Generar ticket y cobrar', exact: true });
    assert.equal(await cobrar.isVisible(), true, 'siempre a la vista');
    const caja = await cobrar.boundingBox();
    assert.ok(caja.y + caja.height <= (ancho < 768 ? 844 : 900), 'dentro de la ventana, sin bajar');
    await cobrar.click(); await reposo(page);
    assert.equal(await page.locator('.modal-backdrop:visible h2').innerText(), 'Confirmar cobro');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click(); await reposo(page);
    // Una cuenta cerrada que se edita sin mesa: el mismo botón dice «Guardar cambios» y la precuenta no se ofrece.
    await page.evaluate(() => { Alpine.store('pos').edicionSinMesa = true; });
    await reposo(page);
    assert.equal(await page.getByRole('button', { name: 'Guardar cambios', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Guardar cambios' }).count(), 1, 'un solo botón también en edición');
    assert.equal(await page.getByRole('button', { name: 'Imprimir precuenta', exact: true }).isVisible(), false);
    assert.equal(await page.locator('#ayuda-precuenta').isVisible(), false);
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click(); await reposo(page);
    assert.equal(await page.locator('.modal-backdrop:visible h2').innerText(), 'Confirmar cambios');
    await a.ctx.close();
  }
});

test('un solo cobro (navegador): en «Cobrar por partes» sigue habiendo un solo coral que cobra lo marcado', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden', 390); if (!a) return;
  const { page } = a;
  await page.getByRole('button', { name: 'Cobrar por partes', exact: true }).click(); await reposo(page);
  assert.equal(await page.getByRole('button', { name: 'Generar ticket y cobrar', exact: true }).isVisible(), false);
  const primarios = await page.locator('.btn-primary:visible').allInnerTexts();
  assert.equal(primarios.length, 1, `un solo botón primario a la vista: ${primarios.join(' | ')}`);
  assert.match(primarios[0], /Marca lo que paga/);
});

test('botones primarios (navegador): en el POS, la landing y la carta son el mismo coral profundo con rótulo papel en negrita (≥ 4,5:1 medido en el navegador)', { skip: SALTAR }, async (t) => {
  const medir = (page, selector) => page.locator(selector).first().evaluate((e) => {
    const c = getComputedStyle(e);
    return { fondo: c.backgroundColor, texto: c.color, peso: c.fontWeight, sombra: c.boxShadow, sombraTexto: c.textShadow };
  });
  const esperado = { fondo: 'rgb(196, 62, 38)', texto: 'rgb(255, 253, 247)', peso: '700' };
  const a = await abrir(t, 'orden', 1440); if (!a) return;
  const pos = await medir(a.page, 'button:has-text("Generar ticket y cobrar")');
  const l = await abrirSitio(t, 'index.html', 1440); if (!l) return;
  const landing = await medir(l.page, 'button.btn-letrero');
  const c = await abrirSitio(t, 'carta.html', 1440); if (!c) return;
  // La carta arma «Reservar por WhatsApp» con Alpine (que viene de un CDN); la sonda lleva la misma clase que ese botón.
  await c.page.evaluate(() => { const x = document.createElement('a'); x.className = 'btn btn-primary w-full'; x.id = 'sonda-primario'; x.textContent = 'Reservar por WhatsApp'; document.body.appendChild(x); });
  const carta = await medir(c.page, '#sonda-primario');
  for (const [donde, m] of [['POS', pos], ['landing', landing], ['carta', carta]]) {
    assert.equal(m.fondo, esperado.fondo, `${donde}: relleno`);
    assert.equal(m.texto, esperado.texto, `${donde}: rótulo claro`);
    assert.equal(m.peso, esperado.peso, `${donde}: negrita`);
    assert.match(m.sombra, /inset/, `${donde}: borde interior claro y sutil`);
    assert.ok(contrasteCss(m.texto, m.fondo) >= 4.5, `${donde}: contraste ${contrasteCss(m.texto, m.fondo).toFixed(2)} < 4,5`);
  }
  // Hover (con puntero) y active: más hondos, y el rótulo sigue ≥ 4,5.
  const boton = a.page.getByRole('button', { name: 'Generar ticket y cobrar', exact: true });
  await boton.hover(); await reposo(a.page);
  const hover = await boton.evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.equal(hover, 'rgb(184, 56, 31)');
  assert.ok(contrasteCss('rgb(255, 253, 247)', hover) >= 4.5);
  await a.page.mouse.move(0, 0);
  await a.page.mouse.move((await boton.boundingBox()).x + 20, (await boton.boundingBox()).y + 20);
  await a.page.mouse.down(); await reposo(a.page);
  const activo = await boton.evaluate((e) => getComputedStyle(e).backgroundColor);
  await a.page.mouse.up();
  assert.equal(activo, 'rgb(163, 47, 27)');
  assert.ok(contrasteCss('rgb(255, 253, 247)', activo) >= 4.5);
  // El foco por teclado sigue siendo el anillo global (2 px con aire), visible sobre el coral.
  await boton.focus(); await a.page.keyboard.press('Shift+Tab'); await a.page.keyboard.press('Tab');
  const foco = await boton.evaluate((e) => { const c = getComputedStyle(e); return { ancho: c.outlineWidth, estilo: c.outlineStyle, aire: c.outlineOffset }; });
  assert.deepEqual(foco, { ancho: '2px', estilo: 'solid', aire: '2px' });
});

test('cierre (navegador): total vendido manda (tarjeta telón, cifra arroz), pastillas suaves con texto oscuro, «Editar» discreto, papelera sin gritar y «Cerrar día» en el primario nuevo', { skip: SALTAR }, async (t) => {
  for (const ancho of [390, 1440]) {
    const a = await abrir(t, 'cierre', ancho); if (!a) return;
    const { page } = a;
    const estilo = (selector, props) => page.locator(selector).first().evaluate((e, ps) => { const c = getComputedStyle(e); return Object.fromEntries(ps.map((p) => [p, c[p]])); }, props);
    // Jerarquía: el total vendido es la única tarjeta oscura y su cifra es la más grande.
    const principal = await estilo('.bento-main', ['backgroundColor']);
    const cifra = await estilo('.bento-main .stat-value', ['color', 'fontSize']);
    const otra = await estilo('.stat-card:not(.bento-main) .stat-value', ['color', 'fontSize']);
    assert.equal(principal.backgroundColor, 'rgb(10, 17, 18)', 'tarjeta telón');
    assert.equal(cifra.color, 'rgb(244, 240, 227)', 'cifra arroz');
    assert.ok(contrasteCss(cifra.color, principal.backgroundColor) >= 4.5);
    assert.ok(parseFloat(cifra.fontSize) > parseFloat(otra.fontSize), `el total (${cifra.fontSize}) manda sobre Órdenes (${otra.fontSize})`);
    const etiqueta = await estilo('.bento-main .stat-label', ['color']);
    assert.ok(contrasteCss(etiqueta.color, principal.backgroundColor) >= 4.5, 'etiqueta ceniza sobre telón');
    assert.equal((await estilo('.kpi-tendencia', ['color'])).color, 'rgb(233, 169, 31)', 'la tendencia, en maíz');
    // Pastillas suaves: tinte turquesa, texto telón, punto turquesa.
    for (const [selector, nombre] of [['.fila-tx .chip.green', 'Facturada'], ['.history-row .chip.green', 'Respaldado']]) {
      const chip = await estilo(selector, ['backgroundColor', 'color', 'borderTopColor']);
      assert.equal(chip.backgroundColor, 'rgb(225, 234, 232)', `${nombre}: tinte`);
      assert.equal(chip.color, 'rgb(10, 17, 18)', `${nombre}: texto oscuro`);
      assert.ok(contrasteCss(chip.color, chip.backgroundColor) >= 4.5, `${nombre}: contraste`);
      const punto = await page.locator(selector).first().evaluate((e) => getComputedStyle(e, '::before').backgroundColor);
      assert.equal(punto, 'rgb(42, 115, 138)', `${nombre}: punto turquesa`);
    }
    // «Editar» de las transacciones del turno: botón discreto, sin subrayado ni coral, de 44 px.
    const editar = page.locator('.fila-tx-der .btn-discreto').first();
    const e = await editar.evaluate((x) => { const c = getComputedStyle(x); return { color: c.color, linea: c.textDecorationLine, fondo: c.backgroundColor }; });
    assert.equal(e.linea, 'none');
    assert.equal(e.color, 'rgb(79, 93, 89)', 'apoyo');
    assert.ok(contrasteCss(e.color, 'rgb(255, 253, 247)') >= 4.5, 'apoyo sobre papel');
    assert.ok((await editar.boundingBox()).height >= 43.5);
    assert.equal(await page.locator('.fila-tx-der .btn-enlace').count(), 0, 'ya no es el enlace subrayado');
    // Lápiz y papelera del historial: quietos; la papelera en barro, sin relleno, y se tiñe al tocar.
    const lapiz = await estilo('.btn-icon-tenue:not(.btn-icon-peligro)', ['color', 'borderTopColor']);
    const papelera = await estilo('.btn-icon-tenue.btn-icon-peligro', ['color', 'backgroundColor']);
    assert.equal(lapiz.color, 'rgb(79, 93, 89)');
    assert.equal(papelera.color, 'rgb(138, 61, 34)', 'barro');
    assert.notEqual(papelera.color, lapiz.color, 'se distingue sin gritar');
    assert.equal(papelera.backgroundColor, 'rgb(255, 253, 247)', 'sin relleno de color');
    assert.ok(contrasteCss(papelera.color, papelera.backgroundColor) >= 4.5);
    // «Cerrar día»: el primario nuevo.
    const cerrar = await page.getByRole('button', { name: 'Cerrar día', exact: true }).evaluate((x) => { const c = getComputedStyle(x); return { fondo: c.backgroundColor, texto: c.color }; });
    assert.deepEqual(cerrar, { fondo: 'rgb(196, 62, 38)', texto: 'rgb(255, 253, 247)' });
    assert.deepEqual(a.diag.errores, []);
    await a.ctx.close();
  }
});

test('personas, cobro y cierre (navegador): sin desborde horizontal y ningún control de menos de 44 px a 320, 360 y 1440 (con un nombre de 24 letras)', { skip: SALTAR }, async (t) => {
  const fallas = [];
  for (const ancho of [320, 360, 1440]) for (const vista of ['orden-personas', 'orden-personas-detalle', 'cierre']) {
    const a = await abrir(t, vista, ancho); if (!a) return;
    if (vista !== 'cierre') {
      // El peor caso: el nombre más largo posible (24 letras anchas) y el detalle de las tres personas abierto.
      await a.page.evaluate(() => Alpine.store('pos').renombrarPersona('Persona 2', 'W'.repeat(24)));
      for (let i = 0; i < 3; i++) { const meta = a.page.locator('.persona-meta').nth(i); if (await meta.getAttribute('aria-expanded') === 'false') await meta.click(); }
      await reposo(a.page);
    }
    const r = await a.page.evaluate(() => {
      const visibleEl = (e) => { if (!e.getClientRects().length) return false; for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return !(getComputedStyle(e).position === 'absolute' && e.getBoundingClientRect().width <= 1); };
      const chicos = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter(visibleEl)
        .map((e) => { const b = e.getBoundingClientRect(); return { n: `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} «${(e.getAttribute('aria-label') || e.textContent || e.type).trim().slice(0, 24)}»`, w: b.width, h: b.height }; })
        .filter((x) => x.w < 43.5 || x.h < 43.5).map((x) => `${x.n} ${Math.round(x.w)}×${Math.round(x.h)}`);
      const fuera = [...document.querySelectorAll('.persona-split *')].filter(visibleEl).filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).map((e) => String(e.className).split(' ')[0] || e.tagName);
      return { desborde: document.documentElement.scrollWidth - innerWidth, chicos, fuera: [...new Set(fuera)] };
    });
    if (r.desborde > 0) fallas.push(`${vista}@${ancho}: desborde de ${r.desborde} px`);
    if (r.fuera.length) fallas.push(`${vista}@${ancho}: se sale de la pantalla ${r.fuera.join(', ')}`);
    if (r.chicos.length) fallas.push(`${vista}@${ancho}: ${r.chicos.join('; ')}`);
    if (a.diag.errores.length) fallas.push(`${vista}@${ancho}: errores de consola ${a.diag.errores.join('; ')}`);
    await a.ctx.close();
  }
  assert.deepEqual(fallas, []);
});

test('personas (navegador): cada persona es UNA fila de ~56 px a 360 y 390 (la tarjeta no empuja el pedido fuera del pliegue); a 1440 el campo y el detalle no se estiran', { skip: SALTAR }, async (t) => {
  for (const ancho of [360, 390]) {
    const a = await abrir(t, 'orden-personas', ancho); if (!a) return;
    const { page } = a;
    const altos = await filas(page).evaluateAll((l) => l.map((f) => Math.round(f.getBoundingClientRect().height)));
    assert.deepEqual(altos.map((h) => h <= 60), [true, true, true], `${ancho}: filas de ${altos.join(', ')} px (antes ~80)`);
    const tarjeta = await page.locator('.split-personas').boundingBox();
    assert.ok(tarjeta.height <= 250, `${ancho}: la tarjeta mide ${Math.round(tarjeta.height)} px con tres personas (antes ~290)`);
    const f = filas(page).nth(0);
    const [nombre, meta, cobrar] = await Promise.all(['.persona-nombre-btn', '.persona-meta', '.persona-cobrar'].map((s) => f.locator(s).boundingBox()));
    assert.ok(Math.abs((nombre.y + nombre.height / 2) - (meta.y + meta.height / 2)) <= 2 && Math.abs((nombre.y + nombre.height / 2) - (cobrar.y + cobrar.height / 2)) <= 2, `${ancho}: nombre, total y «Cobrar» en la misma línea`);
    assert.deepEqual(a.diag.errores, []);
    await a.ctx.close();
  }
  // Editando a 390: el campo toma también el sitio del total (no se queda en 120 px).
  const b = await abrir(t, 'orden-personas', 390); if (!b) return;
  await filas(b.page).nth(2).locator('.persona-nombre-btn').click();
  const campo = filas(b.page).nth(2).locator('.persona-campo');
  await campo.waitFor();
  assert.equal(await filas(b.page).nth(2).locator('.persona-meta').isVisible(), false, 'editando, el total se esconde');
  assert.ok((await campo.boundingBox()).width >= 170, 'y el campo ocupa su lugar');
  // 1440: el campo ≤ 20rem y el detalle ≤ 36rem.
  const c = await abrir(t, 'orden-personas-detalle', 1440); if (!c) return;
  assert.ok((await filas(c.page).nth(2).locator('.persona-campo').boundingBox()).width <= 321, 'el campo no se estira por toda la columna');
  assert.ok((await filas(c.page).nth(0).locator('.persona-detalle').boundingBox()).width <= 577, 'el detalle tampoco');
});

test('personas (navegador): Enter y Escape devuelven el foco al botón del nombre; lo que se escribe después no cae en un campo invisible ni cambia el nombre', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden-personas', 390); if (!a) return;
  const { page } = a;
  const fila = filas(page).nth(2);
  const foco = () => page.evaluate(() => { const e = document.activeElement; return { clase: e?.className, etiqueta: e?.tagName, oculto: !!e?.closest('[aria-hidden="true"]') }; });
  await fila.locator('.persona-nombre-btn').click();
  await fila.locator('.persona-campo').fill('Ana');
  await fila.locator('.persona-campo').press('Enter'); await reposo(page);
  assert.deepEqual(await foco(), { clase: 'persona-nombre-btn', etiqueta: 'BUTTON', oculto: false }, 'tras Enter el foco está en un botón visible');
  await page.keyboard.type('xyz'); await reposo(page);   // antes, estas letras caían en el campo escondido (0×0) y «Listo» no cerraba el teclado
  assert.equal(await fila.locator('.persona-nombre-txt').innerText(), 'Ana', 'escribir sin editar no cambia nada');
  assert.equal(await fila.locator('.persona-campo').inputValue(), 'Ana', 'ni deja texto en el campo escondido');
  // Y el botón del nombre no se ve a la vez que el campo: se esconden en el mismo repintado.
  await fila.locator('.persona-nombre-btn').click();
  await fila.locator('.persona-campo').press('Escape'); await reposo(page);
  assert.deepEqual(await foco(), { clase: 'persona-nombre-btn', etiqueta: 'BUTTON', oculto: false });
  assert.deepEqual(a.diag.errores, []);
});

test('cobro desde 1024 (navegador): con avisos encima (otra tablet en la mesa y la cuenta dividida) «Generar ticket y cobrar» sigue DENTRO de la ventana, sin hacer scroll, y al bajar la página también', { skip: SALTAR }, async (t) => {
  const presencia = (d) => { d.presencia = [{ mesaId: 3, deviceId: 'otro-dispositivo', nombre: 'Mesera Demo', ts: 1790000000000 }]; };
  const fallas = [];
  for (const [w, h, vista] of [[1024, 768, 'orden'], [1180, 820, 'orden'], [1024, 768, 'orden-personas'], [1366, 768, 'orden-personas'], [1440, 900, 'orden-personas']]) {
    const a = await abrir(t, vista, w, { alto: h, ajustar: presencia }); if (!a) return;
    const { page } = a;
    await page.getByText('también tiene esta mesa abierta').waitFor();
    const boton = page.getByRole('button', { name: 'Generar ticket y cobrar', exact: true });
    const dentro = () => boton.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), alto: innerHeight, scroll: Math.round(scrollY) }; });
    // La medida se pide en un cuadro de animación: se espera a que el botón quepa (o a que se acabe el tiempo).
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Generar ticket y cobrar'); return b && b.getBoundingClientRect().bottom <= innerHeight; }, null, { timeout: 4000 }).catch(() => {});
    let r = await dentro();
    if (!(r.top >= 0 && r.bottom <= r.alto)) fallas.push(`${vista}@${w}×${h}: el botón queda en ${r.top}–${r.bottom} de ${r.alto} sin scroll`);
    // Al bajar la página la columna se pega bajo el nav y el botón sigue a la vista.
    await page.evaluate(() => window.scrollTo(0, 400)); await reposo(page);
    r = await dentro();
    if (!(r.top >= 0 && r.bottom <= r.alto)) fallas.push(`${vista}@${w}×${h}: con scroll ${r.scroll} el botón queda en ${r.top}–${r.bottom} de ${r.alto}`);
    await a.ctx.close();
  }
  assert.deepEqual(fallas, []);
});

test('cobro desde 1024 (navegador): la rejilla de la cuenta recibe la medida de lo que NO es ella (con piso de 13rem) y a 390 no hay nada que medir', { skip: SALTAR }, async (t) => {
  const a = await abrir(t, 'orden', 1440); if (!a) return;
  await reposo(a.page);
  const rej = await a.page.locator('.orden-rejilla').evaluate((e) => ({ alto: Math.round(e.getBoundingClientRect().height), medida: e.style.getPropertyValue('--orden-ocupado') }));
  assert.match(rej.medida, /^\d+px$/, 'la rejilla recibe la medida de lo que hay fuera de ella (nav, cabecera, avisos, aire y pie)');
  assert.ok(rej.alto >= 208, `con piso de 13rem: ${rej.alto}`);
  const b = await abrir(t, 'orden', 390); if (!b) return;
  await reposo(b.page);
  assert.equal(await b.page.locator('.orden-rejilla').evaluate((e) => e.style.getPropertyValue('--orden-ocupado')), '', 'bajo 1024 no hay alto que repartir: no se mide');
});

test('ticket de una persona (navegador): un nombre de 24 letras anchas no desborda la hoja a 320 y 390 y «Cuenta de» no se parte', { skip: SALTAR }, async (t) => {
  for (const ancho of [320, 390]) {
    const a = await abrir(t, 'orden-personas', ancho); if (!a) return;
    const { page } = a;
    const largo = 'W'.repeat(24);
    await page.evaluate((n) => Alpine.store('pos').renombrarPersona('Persona 1', n), largo);
    await reposo(page);
    await page.getByRole('button', { name: `Cobrar a ${largo}` }).click();
    await page.locator('.ticket').waitFor(); await reposo(page);
    const r = await page.evaluate(() => {
      const fila = [...document.querySelectorAll('.ticket-meta .meta-row')].find((f) => /Cuenta de/.test(f.textContent));
      const rango = document.createRange(); rango.selectNodeContents(fila.querySelector('span:first-child'));
      return { desborde: document.documentElement.scrollWidth - innerWidth, lineasEtiqueta: new Set([...rango.getClientRects()].map((c) => Math.round(c.top))).size, fueraDeLaHoja: fila.querySelector('span:last-child').getBoundingClientRect().right > document.querySelector('.ticket').getBoundingClientRect().right + 0.5 };
    });
    assert.equal(r.desborde, 0, `${ancho}: el documento no crece a lo ancho`);
    assert.equal(r.fueraDeLaHoja, false, `${ancho}: el nombre queda dentro de la hoja`);
    assert.equal(r.lineasEtiqueta, 1, `${ancho}: «Cuenta de» en una línea`);
    await a.ctx.close();
  }
});

test('cierre y orden (navegador): «Cerrar día» es una acción de pie (52 px, a la derecha desde 640), «Editar» cae en columna y la ayuda de la precuenta cabe en una línea y queda pegada a su botón', { skip: SALTAR }, async (t) => {
  const m = await abrir(t, 'cierre', 390); if (!m) return;
  const cerrar390 = await m.page.getByRole('button', { name: 'Cerrar día', exact: true }).boundingBox();
  const contenedor = await m.page.locator('.bento-kpis').boundingBox();
  assert.ok(cerrar390.height <= 53, `«Cerrar día» mide ${cerrar390.height} px de alto: el primario de siempre (52), no la losa btn-lg de 56`);
  assert.ok(Math.abs(cerrar390.width - contenedor.width) <= 1, 'en teléfono, ancho completo');
  for (const ancho of [920, 1440]) {
    const a = await abrir(t, 'cierre', ancho); if (!a) return;
    const { page } = a;
    const cerrar = await page.getByRole('button', { name: 'Cerrar día', exact: true }).boundingBox();
    const caja = await page.locator('.bento-kpis').boundingBox();
    assert.ok(cerrar.width <= 330, `${ancho}: «Cerrar día» mide ${Math.round(cerrar.width)} px (antes toda la fila)`);
    assert.ok(Math.abs((cerrar.x + cerrar.width) - (caja.x + caja.width)) <= 1, `${ancho}: alineado a la derecha`);
    const xs = await page.locator('.fila-tx-der .btn-discreto').evaluateAll((l) => l.map((e) => Math.round(e.getBoundingClientRect().x)));
    assert.ok(xs.length >= 3 && Math.max(...xs) - Math.min(...xs) <= 1, `${ancho}: «Editar» en una sola columna (x = ${xs.join(', ')})`);
    // Las tarjetas «Órdenes» y «Ticket prom.» centran su contenido en la altura de la tarjeta telón.
    const peq = await page.locator('.bento-kpis .stat-card:not(.bento-main)').first().evaluate((e) => { const c = e.getBoundingClientRect(); const v = e.querySelector('.stat-value').getBoundingClientRect(); const l = e.querySelector('.stat-label').getBoundingClientRect(); return { arriba: l.top - c.top, abajo: c.bottom - v.bottom }; });
    assert.ok(Math.abs(peq.arriba - peq.abajo) <= 6, `${ancho}: contenido centrado (${Math.round(peq.arriba)} arriba, ${Math.round(peq.abajo)} abajo)`);
    await a.ctx.close();
  }
  // La ayuda de la precuenta: una línea a 390 y debajo del botón (que es el último de la fila).
  const o = await abrir(t, 'orden', 390); if (!o) return;
  const ayuda = await o.page.locator('#ayuda-precuenta').evaluate((e) => ({ alto: e.getBoundingClientRect().height, linea: parseFloat(getComputedStyle(e).lineHeight), top: e.getBoundingClientRect().top }));
  assert.ok(ayuda.alto <= ayuda.linea * 1.5, `la ayuda mide ${Math.round(ayuda.alto)} px: una línea de ${Math.round(ayuda.linea)}`);
  const boton = await o.page.getByRole('button', { name: 'Imprimir precuenta' }).boundingBox();
  const nfc = await o.page.getByRole('button', { name: 'Enlace NFC' }).boundingBox();
  assert.ok(boton.y >= nfc.y + nfc.height - 1, 'la precuenta queda después de «Enlace NFC»');
  assert.ok(ayuda.top - (boton.y + boton.height) <= 24, 'y la ayuda, pegada justo debajo de su botón');
});

// ═════════════════ Integración con la ola C: lo que la ola C sumó al cierre usa los mismos colores ═════════════════
//
// La rama de personas y botones se escribió sobre la ola B; la ola C agregó al cierre «Cobros deshechos hoy», los avisos de «Reintentar
// subir» y de las ventas sin subir (con su hoja) y «Reintentar respaldo». Lo que se pidió («pastillas suaves, jerarquía clara, acciones
// que no griten») vale también para eso: la pastilla de los deshechos es suave (tinte barro) y los tres enlaces coral subrayados son
// botones secundarios quietos.

test('integración ola C (estática): «Cobros deshechos» con pastilla suave y los enlaces del cierre como botones secundarios, sin btn-enlace', () => {
  const cierre = POS.slice(POS.indexOf('<!-- Cobros deshechos hoy'), POS.indexOf('<!-- History of past closes.'));
  assert.ok(cierre.length > 500, 'no encontré el cierre de la ola C');
  assert.match(cierre, /'chip-aviso'/, 'la pastilla de los deshechos va en tinte');
  assert.doesNotMatch(cierre, /badge-maiz/, 'ya no es el maíz pleno');
  assert.doesNotMatch(cierre, /btn-enlace/, '«Reintentar subir» y «Revisar» ya no son enlaces coral subrayados');
  assert.equal((cierre.match(/class="btn-secondary btn-sm flex-shrink-0 -my-2"/g) || []).length, 1, '«Reintentar subir» es secundario');
  assert.equal((cierre.match(/class="btn-primary btn-sm flex-shrink-0 -my-2"/g) || []).length, 2, '«Revisar» (en los dos avisos) es el primario: con ventas viejas «Cerrar día» queda apagado y no habría ningún coral');
  const historial = POS.slice(POS.indexOf('id="historial-cierres"'), POS.indexOf('id="historial-cierres"') + 9000);
  assert.match(historial, /class="btn-secondary btn-sm print:hidden mt-1"[\s\S]{0,200}Reintentar respaldo/);
  assert.doesNotMatch(historial.slice(0, historial.indexOf('Reintentar respaldo') + 40), /btn-enlace/);
  const css = POS.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.chip\.chip-aviso\s*\{[^}]*border-color:\s*var\(--pos-tinte-barro-borde\)[^}]*background:\s*var\(--pos-tinte-barro\)[^}]*color:\s*var\(--color-telon\)/);
  assert.match(css, /\.chip\.chip-aviso::before\s*\{[^}]*background:\s*var\(--color-barro\)/);
});

test('integración ola C (navegador): la pastilla de «Cobros deshechos», los avisos del cierre, «Reintentar respaldo» y la hoja de ventas sin subir con los colores calmos y sin desborde', { skip: SALTAR }, async (t) => {
  for (const ancho of [390, 920, 1440]) {
    const a = await abrir(t, 'cierre-deshechos', ancho); if (!a) return;
    const { page } = a;
    const estilo = (loc, props) => loc.first().evaluate((e, ps) => { const c = getComputedStyle(e); return Object.fromEntries(ps.map((p) => [p, c[p]])); }, props);
    const sinDesborde = async (donde) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${ancho} ${donde}: sin desborde horizontal`);
    // 1. La pastilla de los deshechos: tinte barro, texto telón, punto barro (no el maíz pleno).
    const pastilla = page.locator('#deshechos-titulo + .chip');
    const p = await estilo(pastilla, ['backgroundColor', 'color', 'borderTopColor']);
    assert.equal(p.backgroundColor, 'rgb(243, 234, 226)', `${ancho}: tinte barro`);
    assert.equal(p.color, 'rgb(10, 17, 18)', `${ancho}: texto telón`);
    assert.ok(contrasteCss(p.color, p.backgroundColor) >= 4.5, `${ancho}: contraste de la pastilla`);
    assert.equal(await pastilla.evaluate((e) => getComputedStyle(e, '::before').backgroundColor), 'rgb(138, 61, 34)', `${ancho}: punto barro`);
    assert.match(await pastilla.innerText(), /^3 cobros · \$\s109\.000$/, 'dice qué cuenta («3 cobros»), como la tarjeta del tablero');
    // Sin deshechos queda la pastilla neutra (sin tinte ni punto).
    await page.evaluate(() => { Alpine.store('pos').deshechosFilas = []; }); await reposo(page);
    assert.equal(await pastilla.evaluate((e) => e.classList.contains('chip-aviso')), false, 'cero deshechos: pastilla neutra');
    await page.evaluate(() => { Alpine.store('pos')._pendientes = { 'ordenes:x1': true }; }); await reposo(page);
    // 2. Cambios sin subir: el aviso lleva «Reintentar subir» como botón secundario (papel, texto telón, sin subrayado, 44 px).
    const razon = page.locator('#cierre-razon');
    await razon.waitFor({ state: 'visible' });
    const subir = razon.getByRole('button', { name: 'Reintentar subir', exact: true });
    const s = await estilo(subir, ['backgroundColor', 'color', 'textDecorationLine']);
    assert.equal(s.textDecorationLine, 'none', 'ya no es el enlace subrayado');
    assert.equal(s.color, 'rgb(10, 17, 18)');
    assert.ok(contrasteCss(s.color, s.backgroundColor) >= 4.5, 'texto sobre el botón');
    assert.ok((await subir.boundingBox()).height >= 43.5, '44 px');
    assert.equal(await razon.locator('.btn-enlace').count(), 0);
    await sinDesborde('con el aviso de cambios sin subir');
    // 3. Un cierre «Sin respaldo»: «Reintentar respaldo» también es un botón secundario.
    await page.evaluate(() => { Alpine.store('pos')._pendientes = {}; Alpine.store('pos').cierres[0].sync = 'error'; }); await reposo(page);
    const respaldo = page.locator('#historial-cierres').getByRole('button', { name: 'Reintentar respaldo', exact: true }).first();
    assert.equal(await respaldo.isVisible(), true);
    const r = await estilo(respaldo, ['color', 'textDecorationLine', 'backgroundColor']);
    assert.equal(r.textDecorationLine, 'none');
    assert.ok(contrasteCss(r.color, r.backgroundColor) >= 4.5);
    await page.evaluate(() => { Alpine.store('pos').cierres[0].sync = 'ok'; });
    // 4. Ventas sin subir: el aviso con «Revisar» y la hoja (la primaria nueva, «Faltan en el sistema» en barro, filas con su monto).
    const hace = Date.parse('2026-09-30T13:30:00-05:00');
    await page.evaluate((ahoraMs) => {
      const p = Alpine.store('pos');
      const h = new Date(ahoraMs - 3 * 86400000).toISOString();
      p.cierresViejos = [{ id: 'v1', fecha: h, total: 20000, ordenes: [{ id: 'f1', mesa_id: 3, total: 20000, cerrada_en: h, items: [] }], purgar: [], sync: 'error' }];
      p.cierreViejoVista = { id: 'v1', cargando: false, error: '', yaEnLaBase: false, faltan: 1, faltanMonto: 20000, filas: [{ id: 'f1', mesaId: 3, hora: h, monto: 20000, estado: 'falta', texto: 'Falta en el sistema.' }] };
      p.modalCierresViejos = false;
    }, hace);
    await reposo(page);
    // Con cuentas por cerrar, el aviso de arriba (#cierre-razon) ya lo dice y trae «Revisar»: no sale un segundo aviso con lo mismo.
    const arriba = page.locator('#cierre-razon');
    await arriba.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#cierre-viejo-aviso').isVisible(), false, 'un solo aviso de ventas viejas, no dos seguidos');
    const colores = (loc) => estilo(loc, ['backgroundColor', 'color', 'textDecorationLine']);
    const revisar = arriba.getByRole('button', { name: 'Revisar', exact: true });
    const rv = await colores(revisar);
    assert.deepEqual({ fondo: rv.backgroundColor, texto: rv.color, subrayado: rv.textDecorationLine }, { fondo: 'rgb(196, 62, 38)', texto: 'rgb(255, 253, 247)', subrayado: 'none' }, '«Revisar» es el primario: «Cerrar día» está apagado y es la única salida');
    assert.equal(await arriba.locator('.btn-enlace').count(), 0);
    // Sin cuentas por cerrar, el aviso de arriba no sale y el de las ventas viejas toma su lugar, con el mismo botón.
    await page.evaluate(() => { const p = Alpine.store('pos'); window.__ordenesGuardadas = p.ordenes; p.ordenes = p.ordenes.map((o) => ({ ...o, estado: 'abierta' })); }); await reposo(page);
    const aviso = page.locator('#cierre-viejo-aviso');
    await aviso.waitFor({ state: 'visible' });
    assert.equal(await arriba.isVisible(), false);
    const rv2 = await colores(aviso.getByRole('button', { name: 'Revisar', exact: true }));
    assert.deepEqual({ fondo: rv2.backgroundColor, texto: rv2.color }, { fondo: 'rgb(196, 62, 38)', texto: 'rgb(255, 253, 247)' });
    assert.equal(await aviso.locator('.btn-enlace').count(), 0);
    await page.evaluate(() => { Alpine.store('pos').ordenes = window.__ordenesGuardadas; }); await reposo(page);
    await sinDesborde('con el aviso de ventas sin subir');
    await page.evaluate(() => { Alpine.store('pos').modalCierresViejos = true; }); await reposo(page);
    const hoja = page.locator('.modal-backdrop:visible .modal');
    await hoja.waitFor({ state: 'visible' });
    const subirViejas = hoja.getByRole('button', { name: /^Subir 1 venta/ });
    const sv = await estilo(subirViejas, ['backgroundColor', 'color']);
    assert.deepEqual(sv, { backgroundColor: 'rgb(196, 62, 38)', color: 'rgb(255, 253, 247)' }, 'la hoja sube con el primario nuevo');
    const faltan = await estilo(hoja.locator('.texto-peligro').first(), ['color']);
    assert.equal(faltan.color, 'rgb(138, 61, 34)', '«Faltan en el sistema» en barro');
    assert.ok(contrasteCss(faltan.color, 'rgb(255, 253, 247)') >= 4.5);
    const descartar = await estilo(hoja.getByRole('button', { name: 'Descartar copia', exact: true }), ['backgroundColor', 'color']);
    assert.ok(contrasteCss(descartar.color, descartar.backgroundColor) >= 4.5, 'Descartar copia legible');
    assert.equal(await hoja.locator('.btn-enlace').count(), 0);
    const tocables = await hoja.locator('button:visible').evaluateAll((l) => l.map((e) => Math.round(e.getBoundingClientRect().height)));
    assert.ok(tocables.every((h) => h >= 43), `todos los botones de la hoja miden 44 px o más (${tocables.join(', ')})`);
    await sinDesborde('con la hoja abierta');
    assert.deepEqual(a.diag.errores, []);
    await a.ctx.close();
  }
});
