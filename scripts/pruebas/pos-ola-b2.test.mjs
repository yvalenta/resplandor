// Ola B, parte b2: la pantalla del POS (marcado y CSS) para roles, alertas, personal, «sin acceso» y los dos cobros
// nuevos (por unidades y por monto). Prueba estática: lee pos.html como texto (no abre un navegador; las capturas y la
// medición de desborde y de 44 px viven en el arnés, scripts/capturas-pos.mjs).
//
// Qué verifica:
//   1. El marcado (fuera de los <script>) solo usa nombres que el script del store define, y el script define todo el
//      CONTRATO de la ola B (docs/pos-visual.md §0.18). Un nombre inventado, o escrito mal, rompe la pantalla en silencio:
//      Alpine evalúa `undefined` y no avisa.
//   2. Cada acción de puede(...) es una del contrato, y lo que el mesero no puede hacer lleva su puede(...) en el
//      marcado: borrar productos, menú semanal (entrada y vista), cerrar el día, editar o eliminar cuentas cerradas,
//      reabrir desde el ticket y rotar el token. Crear y editar productos se piden con las acciones del mesero.
//   3. Navegación: Alertas es solo de teléfono (md:hidden); Menú semanal, Personal, Mesas y pegatinas y Ajustes ya no son links del nav:
//      cuelgan de la tarjeta de «Administración» (ola C, ronda 5; el botón «Más» desapareció); la campana de arriba es de tablet y escritorio.
//   4. «Sin acceso» y el POS: la pantalla sale con sesión y sinAcceso; el POS, con sesión y sin sinAcceso.
//   5. Cobros: el campo del monto es de 16 px, numérico y solo dígitos; los tres métodos; el botón se deshabilita con
//      abonoValido; el selector de unidades cubre de 1 a qty; «Abono recibido» no se marca ni se asigna.
//   6. CSS del bloque b2: nada que fije o pegue bajo un max-width sin `screen`; el aviso flotante (z 60) va entre el
//      diálogo (50) y el login (100); todo :hover está dentro de (hover: hover); sin opacidad en el texto.
//   7. El arnés trae las vistas nuevas y corre contra el store real (el relleno provisional del contrato salió al integrar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const SIMULADO = fs.readFileSync(path.join(RAIZ, 'scripts/pruebas/_pos-simulado.mjs'), 'utf8');

/** Lo que la parte de lógica (b1) promete en Alpine.store('pos'): la lista de docs/pos-visual.md §0.18. */
const CONTRATO = [
  'rol', 'rolCargado', 'sinAcceso', 'esAdmin', 'esMesero', 'puede',
  'alertas', 'alertasPendientes', 'alertasSilenciadasHasta', 'atenderAlerta', 'descartarAlerta', 'silenciarAlertas', 'irAMesaDeAlerta',
  'personal', 'personalError', 'cargarPersonal', 'altaPersonal', 'bajaPersonal', 'cambiarRolPersonal',
  'estaSeleccionado', 'cantidadSeleccionada', 'toggleSeleccion', 'ajustarCantidadSeleccion',
  'montoAbono', 'metodoAbono', 'totalPendiente', 'abonoValido', 'cobrarMonto',
];
// Ola C (c3): puede() gana 'mesas_admin', 'ajustes' y 'aprobar_personal' (solo admin) y 'deshacer_cobro' (admin y mesero; la ventana de 10
// minutos del mesero la decide la base).
// Ola C, ronda 5: y 'administracion' (el tablero de tarjetas; solo admin).
const ACCIONES_ADMIN = ['catalogo_borrar', 'menu_semanal', 'cierre_dia', 'personal', 'editar_cerradas', 'rotar_token', 'mesas_admin', 'ajustes', 'aprobar_personal', 'administracion', 'impresora'];
const ACCIONES_MESERO = ['catalogo_crear', 'catalogo_editar', 'ver_cierres', 'deshacer_cobro'];

// El marcado = todo menos los <script> y los comentarios HTML.
const MARCADO = POS.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const STORE = [...POS.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((t) => t.includes("Alpine.store('pos'"));
assert.ok(STORE, "no encontré el <script> que define Alpine.store('pos', …)");
const DEFINIDOS = new Set([...STORE.matchAll(/^ {12}(?:async\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*[:(]/gm)].map((m) => m[1]));

const bloqueCss = (() => {
  const a = POS.indexOf('/* ▼ PARTE ola-b-b2 :: css */');
  const b = POS.indexOf('/* ▲ PARTE ola-b-b2 :: css */');
  assert.ok(a !== -1 && b > a, 'faltan los marcadores del CSS de la parte b2');
  return POS.slice(a, b);
})();
const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Recorre un CSS y devuelve [{ condicion, cuerpo }] de cada @media de primer nivel. */
function bloquesMedia(css) {
  const res = [];
  const limpio = sinComentarios(css);
  for (let i = limpio.indexOf('@media'); i !== -1; i = limpio.indexOf('@media', i + 1)) {
    const abre = limpio.indexOf('{', i);
    let prof = 0, fin = abre;
    for (let j = abre; j < limpio.length; j++) {
      if (limpio[j] === '{') prof++;
      else if (limpio[j] === '}' && --prof === 0) { fin = j; break; }
    }
    res.push({ condicion: limpio.slice(i + 6, abre).trim(), cuerpo: limpio.slice(abre + 1, fin) });
  }
  return res;
}

/** El elemento (la etiqueta de apertura completa) cuya clase contiene `clase` y su texto de apertura. */
const etiquetaCon = (patron) => {
  const m = MARCADO.match(patron);
  assert.ok(m, `no encontré en el marcado ${patron}`);
  return m[0];
};

// ───────────────────────── 1. nombres del store ─────────────────────────

test('b2 §1: todo $store.pos.<nombre> del marcado existe en el store que define el script (integradas las olas B y C: sin excepción por contrato)', () => {
  const usados = new Set([...MARCADO.matchAll(/\$store\.pos\??\.([A-Za-z_$][\w$]*)/g), ...MARCADO.matchAll(/Alpine\.store\('pos'\)\??\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const desconocidos = [...usados].filter((n) => !DEFINIDOS.has(n));
  assert.deepEqual(desconocidos, [], `nombres del store que el script no define: ${desconocidos.join(', ')}`);
});

test('b2 §1: el script del store define cada nombre del contrato de la ola B (b1 cumple lo que b2 espera)', () => {
  const faltan = CONTRATO.filter((n) => !DEFINIDOS.has(n));
  assert.deepEqual(faltan, [], `el contrato promete y el store no define: ${faltan.join(', ')}`);
});

test('b2 §1: el marcado nuevo usa los nombres del contrato (los que pidió el reparto) y ninguno que no exista', () => {
  const usados = new Set([...MARCADO.matchAll(/\$store\.pos\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const n of ['rol', 'sinAcceso', 'esAdmin', 'puede', 'alertas', 'alertasPendientes', 'alertasSilenciadasHasta', 'atenderAlerta',
    'descartarAlerta', 'silenciarAlertas', 'irAMesaDeAlerta', 'personal', 'personalError', 'altaPersonal',
    'eliminarPersonal', 'cambiarRolPersonal', 'estaSeleccionado', 'cantidadSeleccionada', 'toggleSeleccion', 'ajustarCantidadSeleccion',
    'montoAbono', 'metodoAbono', 'totalPendiente', 'abonoValido', 'cobrarMonto', 'subtotalSeleccion']) {
    assert.ok(usados.has(n), `el marcado debería usar $store.pos.${n}`);
  }
  // La selección ya no es una lista de ids: nada de .includes ni de toggleSeleccionItem en el marcado.
  assert.doesNotMatch(MARCADO, /itemsSeleccionados\.includes|toggleSeleccionItem/, 'la selección por unidades es un mapa: estaSeleccionado / toggleSeleccion');
});

test('b2 §1: la confirmación de descartar alerta, dar de baja y cambiar de rol vive en la página y el store no repite la pregunta con confirm()', () => {
  const cuerpo = (nombre) => {
    const i = STORE.search(new RegExp(`^ {12}(?:async\\s+)?${nombre}\\(`, 'm'));
    assert.ok(i !== -1, `no encontré ${nombre} en el store`);
    const j = STORE.slice(i + 1).search(/^ {12}(?:async\s+|get\s+)?[A-Za-z_$][\w$]*\(.*\) \{$/m);
    return STORE.slice(i, j === -1 ? undefined : i + 1 + j);
  };
  for (const n of ['descartarAlerta', 'bajaPersonal', 'cambiarRolPersonal']) assert.doesNotMatch(cuerpo(n), /\bconfirm\(/, `${n} no debe llamar a confirm()`);
  assert.match(MARCADO, /Sí, descartar/);
  assert.match(MARCADO, /Sí, dar de baja/, 'en Equipo se vuelve a decir «Dar de baja» (eliminarPersonal, con su confirmación)');
  assert.match(MARCADO, /Sí, rechazar/, 'y a una solicitud pendiente se la «Rechaza» (la misma RPC, con su confirmación)');
  assert.match(MARCADO, /Sí, cambiar/);
});

// ───────────────────────── 2. permisos ─────────────────────────

test('b2 §2: toda acción de puede(...) es del contrato', () => {
  const usadas = new Set([...MARCADO.matchAll(/puede\('([a-z_]+)'\)/g)].map((m) => m[1]));
  const raras = [...usadas].filter((a) => ![...ACCIONES_ADMIN, ...ACCIONES_MESERO].includes(a));
  assert.deepEqual(raras, [], `acciones fuera del contrato: ${raras.join(', ')}`);
  for (const a of [...ACCIONES_ADMIN, ...ACCIONES_MESERO]) assert.ok(usadas.has(a), `el marcado debería usar puede('${a}')`);
});

test('b2 §2: lo que el mesero no puede hacer está detrás de su puede(...)', () => {
  const casos = [
    ['borrar productos', /<button[^>]*x-show="\$store\.pos\.puede\('catalogo_borrar'\)"[^>]*eliminarProducto/, 'catalogo_borrar'],
    ['rotar el token', /<button[^>]*x-show="\$store\.pos\.puede\('rotar_token'\)"[^>]*rotarTokenMesa/, 'rotar_token'],
    ['cerrar el día', /<button[^>]*x-show="\$store\.pos\.puede\('cierre_dia'\)"[^>]*:class="[^"]*"[^>]*abrirConfirmarCierre\(\)/, 'cierre_dia'],
    ['editar una transacción del turno', /<button[^>]*x-show="\$store\.pos\.puede\('editar_cerradas'\)"[^>]*abrirEditorTransaccion\(orden\)"/, 'editar_cerradas'],
    ['editar una orden de un cierre', /<button[^>]*x-show="\$store\.pos\.puede\('editar_cerradas'\)"[^>]*abrirEditorTransaccion\(orden, cierre\)/, 'editar_cerradas'],
    ['eliminar una orden de un cierre', /<button[^>]*x-show="\$store\.pos\.puede\('editar_cerradas'\)"[^>]*eliminarOrdenDeCierre/, 'editar_cerradas'],
    ['reabrir desde el ticket', /<button[^>]*x-show="[^"]*puede\('editar_cerradas'\)"[^>]*solicitarReapertura\(\$store\.pos\.ordenActiva\)/, 'editar_cerradas'],
    ['reintentar el respaldo de un cierre', /<button[^>]*x-show="cierre\.sync === 'error' && \$store\.pos\.puede\('cierre_dia'\)"/, 'cierre_dia'],
    ['la vista del menú semanal', /<section x-show="\$store\.pos\.vista === 'menu' && \$store\.pos\.puede\('menu_semanal'\)"/, 'menu_semanal'],
    ['la vista de personal', /<section x-show="\$store\.pos\.vista === 'personal' && \$store\.pos\.puede\('personal'\)"/, 'personal'],
  ];
  for (const [que, patron] of casos) assert.match(MARCADO, patron, `${que}: falta su puede(...)`);
});

test('b2 §2: el mesero sí crea y edita productos (acciones de mesero), no solo el admin', () => {
  assert.match(MARCADO, /<button[^>]*x-show="\$store\.pos\.puede\('catalogo_crear'\)"[^>]*abrirModalProducto\(\)/, '«Nuevo producto» con catalogo_crear');
  assert.match(MARCADO, /<button[^>]*x-show="\$store\.pos\.puede\('catalogo_editar'\)"[^>]*abrirModalProducto\(prod\)/, '«Editar» con catalogo_editar');
  // El mesero ve el cierre del día y el historial (solo lectura): la vista y su entrada piden ver_cierres, que tiene el mesero.
  assert.match(MARCADO, /<section x-show="\$store\.pos\.vista === 'cierre' && \$store\.pos\.puede\('ver_cierres'\)"/, 'la vista del cierre pide ver_cierres');
  assert.match(MARCADO, /<button class="nav-link"[^>]*:class="\{ active: \$store\.pos\.vista === 'cierre' \}"\s+x-show="\$store\.pos\.puede\('ver_cierres'\)"/, 'la entrada del nav pide ver_cierres');
});

test('b2 §2: cuando el mesero no puede cerrar el día, la vista lo explica (no queda un hueco mudo)', () => {
  assert.match(MARCADO, /x-show="!\$store\.pos\.puede\('cierre_dia'\)"[\s\S]{0,300}Solo el administrador cierra el día/);
});

// ───────────────────────── 3. navegación ─────────────────────────

test('b2 §3: Alertas es solo de teléfono; la campana, de tablet en adelante; «Administración» (ola C, ronda 5) es la única entrada de lo del admin y ya no hay «Más»', () => {
  const nav = MARCADO.slice(MARCADO.indexOf('<nav class="nav-bar'), MARCADO.indexOf('</nav>'));
  assert.match(nav, /<button class="nav-link md:hidden"[^>]*:class="\{ active: \$store\.pos\.vista === 'alertas' \}"/, 'Alertas del teléfono (md:hidden)');
  assert.match(nav, /class="btn-icon nav-campana hidden md:inline-flex"/, 'la campana va desde 768 px (ahí el nav es fijo)');
  // «Administración»: un solo link, solo admin, en todos los anchos; abre el tablero con irA('admin') y queda activo en sus vistas.
  assert.match(nav, /<button class="nav-link"[^>]*:class="\{ active: \$store\.pos\.enAdministracion \}"\s+x-show="\$store\.pos\.puede\('administracion'\)"/, 'Administración: solo admin, en todos los anchos');
  assert.match(nav, /@click="\$store\.pos\.irA\('admin'\)"/, 'abre el tablero con irA(\'admin\')');
  assert.match(nav, /:aria-label="\$store\.pos\.numAtencionAdmin > 0 \? 'Administración \(' \+ \$store\.pos\.numAtencionAdmin \+ ' por revisar\)' : 'Administración'"/, 'el nombre accesible es «Administración» (con lo que hay por revisar: solicitudes, menú, pegatinas, ventas sin subir)');
  assert.match(nav, /<span class="md:hidden">Admin<\/span><span class="hidden md:inline">Administración<\/span>/, 'en teléfono la etiqueta es «Admin»: «Administración» no cabe en 72 px');
  // Lo que antes eran links o items de «Más» ya no está en el nav: vive en el tablero.
  assert.doesNotMatch(nav, /nav-mas|nav-link-mas|aria-controls="nav-mas"/, 'ya no hay «Más»');
  assert.doesNotMatch(nav, /vista === 'menu'|vista === 'personal'|vista === 'mesas-admin'|vista === 'ajustes'/, 'Menú semanal, Personal, Mesas y pegatinas y Ajustes salen del tablero, no del nav');
  assert.doesNotMatch(nav, /puede\('menu_semanal'\)|puede\('personal'\)|puede\('mesas_admin'\)|puede\('ajustes'\)/);
});

test('b2 §3: el teléfono reparte la barra inferior por destino visible (4 con rol de mesero, 5 con «Admin»), sin repeat(4)', () => {
  const css = sinComentarios(POS);
  assert.doesNotMatch(css, /\.nav-destinos\s*\{[^}]*repeat\(4/, 'las columnas ya no son 4 fijas');
  assert.match(css, /\.nav-destinos\s*\{[^}]*grid-auto-flow:\s*column;[^}]*grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
  // La etiqueta corta («Cierre») solo en teléfono: el nombre accesible sigue siendo «Cierre del día».
  assert.match(MARCADO, /Cierre<span class="sr-only md:not-sr-only"> del día<\/span>/);
});

// ───────────────────────── 4. sin acceso ─────────────────────────

test('b2 §4: «sin acceso» sale con sesión y sinAcceso; el POS, con sesión y sin sinAcceso; el botón es Salir', () => {
  // Ronda 2 (hallazgo 7): la misma pantalla sirve para «no pudimos comprobar tu acceso» (accesoSinComprobar: la base no contestó y
  // esta tablet no tiene un rol confirmado de la cuenta).
  // Ola C (c3): las dos pantallas ceden ante «espera de aprobación» (esperaAprobacion: pendiente o eliminado).
  assert.match(MARCADO, /<div x-data x-show="\$store\.pos\.usuario && \(\$store\.pos\.sinAcceso \|\| \$store\.pos\.accesoSinComprobar\) && !\$store\.pos\.esperaAprobacion"[^>]*class="[^"]*sin-acceso[^"]*"/);
  assert.match(MARCADO, /<div x-data x-show="\$store\.pos\.usuario && !\$store\.pos\.sinAcceso && !\$store\.pos\.accesoSinComprobar && !\$store\.pos\.esperaAprobacion" x-cloak>/);
  const pantalla = MARCADO.slice(MARCADO.indexOf('sin-acceso-titulo'), MARCADO.indexOf('<div x-data x-show="$store.pos.usuario && !$store.pos.sinAcceso'));
  assert.ok(pantalla.length > 200, 'no encontré el texto de la pantalla «sin acceso»');
  assert.match(pantalla, /no está dada de alta en el personal/);
  assert.match(pantalla, /Habla con el administrador/);
  assert.match(pantalla, /\$store\.pos\.cerrarSesion\(\)[\s\S]{0,200}Salir/);
});

// ───────────────────────── 5. cobros ─────────────────────────

test('b2 §5: «Cobrar un monto»: campo numérico de 16 px solo con dígitos, tres métodos y botón con abonoValido', () => {
  const campo = etiquetaCon(/<input id="monto-abono"[^>]*>/);
  assert.match(campo, /inputmode="numeric"/);
  assert.match(campo, /class="field[ "]/, 'usa .field (16 px)');
  assert.doesNotMatch(campo, /text-(sm|xs)/, 'ningún campo con text-sm o text-xs: iOS haría zoom');
  assert.match(campo, /replace\(\/\\D\/g, ''\)/, 'solo dígitos');
  assert.match(MARCADO, /x-for="m in \['efectivo', 'qr', 'transferencia'\]"/, 'los tres métodos, con las claves del contrato');
  // Ronda 2 (crítica visual, punto 1): el botón NO cobra de un toque; abre la confirmación (modalAbono) y es esa la que llama a cobrarMonto().
  assert.match(MARCADO, /<button type="button" class="btn-telon[^"]*"\s+:disabled="!\$store\.pos\.abonoValido"\s+@click="\$store\.pos\.modalAbono = true/);
  assert.match(MARCADO, /<button class="btn-primary" :disabled="!\$store\.pos\.abonoValido" @click="\$store\.pos\.cobrarMonto\(\)">/);
  assert.match(MARCADO, /Quedará por pagar[\s\S]{0,120}abonoQuedaria/, 'antes de tocar: lo que quedará por pagar');
  assert.match(MARCADO, /Queda\s*<strong x-text="'\$ ' \+ \(\$store\.pos\.totalPendiente \|\| 0\)/, '«Queda $ X» con totalPendiente');
  // Solo en «Cobrar por partes» y sin un tercer coral: el botón es telón.
  assert.match(MARCADO, /<div x-show="\$store\.pos\.seleccionCobro" x-cloak class="card a-sangre bloque-monto/);
});

test('b2 §5: cobro por unidades: el selector va de 1 a qty, con botones de 44 px y las funciones del contrato', () => {
  assert.match(MARCADO, /ajustarCantidadSeleccion\(item, -1\)/);
  assert.match(MARCADO, /ajustarCantidadSeleccion\(item, 1\)/);
  assert.match(MARCADO, /:disabled="\$store\.pos\.cantidadSeleccionada\(item\) <= 1"/);
  assert.match(MARCADO, /:disabled="\$store\.pos\.cantidadSeleccionada\(item\) >= item\.qty"/);
  assert.match(MARCADO, /item\.qty > 1 && \$store\.pos\.estaSeleccionado\(item\)/, 'el selector solo en líneas marcadas con más de una unidad');
  assert.match(MARCADO, />\s*de <span x-text="item\.qty"><\/span>/, '«de qty»');
  // La barra «2 ítems · $ X» cuenta líneas del mapa y suma subtotalSeleccion (solo las unidades elegidas).
  assert.match(MARCADO, /\$store\.pos\.lineasSeleccionadas === 0/);
  assert.match(MARCADO, /\$store\.pos\.resumenSeleccion/);
  assert.match(MARCADO, /subtotalSeleccion\.toLocaleString/);
});

test('b2 §5: «Abono recibido» (precio negativo): sin casilla, sin stepper y sin «Asignar a persona»', () => {
  const fila = MARCADO.slice(MARCADO.indexOf('<div class="order-item"'), MARCADO.indexOf('<div class="sel-unidades"'));
  assert.match(fila, /x-show="\$store\.pos\.seleccionCobro && item\.precio >= 0"/, 'la casilla no sale en un abono');
  assert.match(fila, /<div class="qty-ctrl" x-show="item\.precio >= 0">/, 'ni el stepper');
  assert.match(fila, /<button type="button" class="btn-enlace" x-show="item\.precio >= 0"/, 'ni «Asignar a persona»');
  assert.match(fila, /'es-abono': item\.precio < 0/);
  assert.match(fila, /precioTxt\(item\.precio \* item\.qty\)/, 'el importe con signo menos, no «$ -20.000»');
});

// ───────────────────────── 6. CSS ─────────────────────────

test('b2 §6: el CSS de la parte no fija ni pega bajo un max-width sin `screen`, y el aviso flotante va entre el diálogo y el login', () => {
  for (const { condicion, cuerpo } of bloquesMedia(bloqueCss)) {
    if (!/max-width/.test(condicion) || /^screen\b/.test(condicion) || /\bprint\b/.test(condicion)) continue;
    assert.doesNotMatch(cuerpo, /position\s*:\s*(?:fixed|sticky)|[\s;{]order\s*:/, `@media ${condicion} fija, pega o reordena sin \`screen\``);
  }
  const z = Number(sinComentarios(bloqueCss).match(/\.toast-alerta\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  const dialogo = Number(sinComentarios(POS).match(/\.modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  assert.ok(z > dialogo && z < 100, `el aviso flotante (z ${z}) va sobre el diálogo (${dialogo}) y bajo el login (100)`);
  assert.match(MARCADO, /class="toast-alerta sobre-telon print:hidden"/, 'el aviso flotante no sale en el papel');
  assert.doesNotMatch(bloqueCss, /@media print/, 'un @media print propio iría antes del de la sección 7 y la prueba del ticket térmico lo tomaría por el suyo');
});

test('b2 §6: todo :hover del bloque va dentro de (hover: hover), y no hay opacidad en el texto ni emojis', () => {
  const css = sinComentarios(bloqueCss);
  const fuera = css.replace(/@media \(hover: hover\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.doesNotMatch(fuera, /:hover/, 'un :hover fuera de @media (hover: hover) se queda pegado tras el toque');
  assert.doesNotMatch(css, /(^|[;{\s])opacity\s*:/, 'sin opacity: el texto con transparencia no pasa el contraste');
  assert.doesNotMatch(css, /color-mix\(|rgb\(from|:has\(|text-wrap/, 'nada que las tablets viejas no entiendan');
  const marcadoNuevo = MARCADO.slice(MARCADO.indexOf('Cobrar un monto'), MARCADO.length);
  assert.doesNotMatch(marcadoNuevo, /\p{Extended_Pictographic}/u, 'sin emojis en la UI (docs/pos-visual.md §1.3)');
});

test('b2 §6: los botones táctiles nuevos miden ≥ 44 px (las clases compartidas ya lo garantizan; aquí, las de la parte)', () => {
  const css = sinComentarios(bloqueCss);
  const alto = (selector) => css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*min-height:\\s*([^;]+);`))?.[1].trim();
  assert.equal(alto('.alerta-ir'), 'var(--pos-boton-lg)');
  assert.equal(alto('.toast-alerta-cuerpo'), '3.5rem');
});

// ───────────────────────── 7. arnés ─────────────────────────

test('b2 §7: el arnés trae las vistas de la ola B y ya no lleva el relleno provisional del contrato (corre contra el store real)', async () => {
  const { VISTAS } = await import(path.join(RAIZ, 'scripts/pruebas/_pos-simulado.mjs'));
  for (const v of ['alertas', 'alertas-vacia', 'alertas-silencio', 'mesas-alertas', 'orden-alerta', 'personal', 'personal-error', 'sin-acceso',
    'orden-cobro-unidades', 'orden-cobro-monto', 'orden-cobro-abono', 'orden-cobro-monto-invalido', 'ticket-abono',
    'mesas-mesero', 'productos-mesero', 'cierre-mesero', 'orden-nfc-mesero']) {
    assert.ok(VISTAS[v], `falta la vista «${v}» del arnés`);
    assert.ok(VISTAS[v].descripcion && typeof VISTAS[v].llegar === 'function', `${v}: descripción y llegar()`);
  }
  assert.doesNotMatch(SIMULADO, /ContratoOlaB|rellenarContratoOlaB/, 'el relleno provisional taparía un nombre que el store real no tiene');
});
