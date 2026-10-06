// Ola C, ronda 5 (r5b): el TABLERO DE ADMINISTRACIÓN (docs/pos-visual.md §0.20). Pedido de Yonatan: «construir un panel o dashboard del admin donde pueda
// agregar meseros, editar menús semanales y demás administración». Una sola entrada «Administración» (solo admin) abre un tablero de tarjetas; cada tarjeta
// lleva a la vista que ya existía (Personal, Menú semanal, Mesas y pegatinas, Productos, Ajustes, Cierre, Alertas): no se duplica ninguna.
//
// Esta prueba NO abre un navegador (el comportamiento con Chromium vive en pos-ola-c-ronda5-tablero-navegador.test.mjs):
//   1. Marcado: la sección, la franja «Hoy», las nueve tarjetas con su título, su dato vivo y su acción, y la de la impresora oculta tras `tieneImpresora`.
//   2. Navegación: una sola entrada «Administración»; ya no hay «Más»; el mesero conserva su navegación.
//   3. Permisos: puede('administracion') es solo del admin; irA() rechaza al mesero; quien deja de ser admin sale del tablero. (El <script> REAL en un `vm`.)
//   4. Los getters del tablero (el <script> REAL) con estados de ejemplo: cuentan lo que dicen contar.
//   5. CSS del bloque `ola-c-r5`: rejilla de 1, 2 y 3 columnas, 44 px, nada que fije sin `screen`, :hover solo con puntero, sin opacidad en el texto.
//   6. El gancho de la impresora de la caja (tarea/impresion-caja): `impresora` null, `tieneImpresora` false, y la tarjeta se enciende con datos.
//   7. El arnés trae las vistas nuevas y la documentación (§0.20) dice lo que se decidió.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asentar, crearBaseFalsa, crearPos, hastaQue, plano } from './_pos-vm.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const DOC = fs.readFileSync(path.join(RAIZ, 'docs/pos-visual.md'), 'utf8');
const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const sinHtmlComentarios = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

const parte = (clave, tipo) => {
  const abre = tipo === 'css' ? `/* ▼ PARTE ${clave} :: css */` : `<!-- ▼ PARTE ${clave} -->`;
  const cierra = tipo === 'css' ? `/* ▲ PARTE ${clave} :: css */` : `<!-- ▲ PARTE ${clave} -->`;
  const a = POS.indexOf(abre), b = POS.indexOf(cierra);
  assert.ok(a !== -1 && b > a, `faltan los marcadores ${abre} … ${cierra}`);
  return POS.slice(a + abre.length, b);
};
const MARCADO = sinHtmlComentarios(parte('ola-c-r5 :: tablero', 'html'));
const CSS = sinComentariosCss(parte('ola-c-r5', 'css'));

/** Cada tarjeta del tablero, en el orden en que salen: clave, título, el texto de su acción y qué hace. */
const TARJETAS = [
  ['personal', 'Personal', 'Agregar mesero', /\$store\.pos\.accionTablero\('agregar-persona'\)/, /\$store\.pos\.irA\('personal'\)/],
  ['menu', 'Menú semanal', 'Editar menú', /\$store\.pos\.irA\('menu'\)/, /\$store\.pos\.irA\('menu'\)/],
  ['mesas', 'Mesas y pegatinas', 'Revisar pegatinas', /\$store\.pos\.irA\('mesas-admin'\)/, /\$store\.pos\.irA\('mesas-admin'\)/],
  ['productos', 'Productos', 'Agregar producto', /\$store\.pos\.accionTablero\('agregar-producto'\)/, /\$store\.pos\.irA\('productos'\)/],
  ['ticket', 'Ticket y ajustes', 'Editar ticket', /\$store\.pos\.irA\('ajustes'\)/, /\$store\.pos\.irA\('ajustes'\)/],
  ['cierres', 'Cierres<span class="sr-only"> e historial</span>', 'Ver historial', /\$store\.pos\.accionTablero\('ver-historial'\)/, /\$store\.pos\.irA\('cierre'\)/],
  ['deshechos', 'Cobros deshechos hoy', 'Ver lista', /\$store\.pos\.accionTablero\('ver-deshechos'\)/, /\$store\.pos\.accionTablero\('ver-deshechos'\)/],
  ['alertas', 'Alertas', 'Ver alertas', /\$store\.pos\.irA\('alertas'\)/, /\$store\.pos\.irA\('alertas'\)/],
  ['impresora', 'Impresora de la caja', 'Configurar impresora', /\$store\.pos\.irA\('impresora'\)/, /\$store\.pos\.irA\('impresora'\)/],
];
const tarjeta = (clave) => {
  const a = MARCADO.indexOf(`data-tarjeta="${clave}"`);
  assert.ok(a !== -1, `falta la tarjeta «${clave}»`);
  const ini = MARCADO.lastIndexOf('<article', a);
  return MARCADO.slice(ini, MARCADO.indexOf('</article>', a) + '</article>'.length);
};

// ───────────────────────── 1. marcado ─────────────────────────

test('r5b §1: la vista \'admin\' solo la ve el admin y la franja «Hoy» lleva ventas, mesas ocupadas y alertas', () => {
  assert.match(MARCADO, /<section x-show="\$store\.pos\.vista === 'admin' && \$store\.pos\.puede\('administracion'\)" x-cloak\s+class="fade-enter vista max-w-6xl"/);
  assert.match(MARCADO, /<h1 id="tablero-titulo">Administración<\/h1>/);
  const hoy = MARCADO.slice(MARCADO.lastIndexOf('<section', MARCADO.indexOf('id="hoy-titulo"')), MARCADO.indexOf('class="tablero-rejilla"'));
  assert.match(hoy, /<h2 id="hoy-titulo"[^>]*>Hoy<\/h2>/);
  for (const [etiqueta, id] of [['Ventas del turno', 'hoy-ventas'], ['Mesas ocupadas', 'hoy-mesas'], ['Alertas pendientes', 'hoy-alertas']]) {
    assert.match(hoy, new RegExp(`<div class="stat-label">${etiqueta}</div>\\s*<div class="stat-value ink" id="${id}"`), `la franja dice «${etiqueta}»`);
  }
  assert.match(hoy, /Alpine\.store\('pos'\)\.tableroHoy/, 'los tres números salen de un solo getter del store');
});

test('r5b §1: nueve tarjetas, en este orden, cada una con título (el botón que abre la vista), dato vivo y acción principal', () => {
  const claves = [...MARCADO.matchAll(/data-tarjeta="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(claves, TARJETAS.map((t) => t[0]), 'el orden de las tarjetas');
  for (const [clave, titulo, accion, hace, abre] of TARJETAS) {
    const t = tarjeta(clave);
    assert.match(t, /^<article class="card tarjeta-admin"/, `${clave}: una tarjeta (.card .tarjeta-admin)`);
    assert.match(t, new RegExp(`<h2 class="tarjeta-admin-titulo"><button type="button" class="tarjeta-admin-abre" @click="[^"]*">${titulo}</button></h2>`), `${clave}: el título es el botón que abre la vista`);
    assert.match(t, new RegExp(`<h2 class="tarjeta-admin-titulo"><button[^>]*@click="${abre.source}`), `${clave}: tocar el título abre su vista`);
    // (la de Personal lleva `:class` porque con solicitudes esperando pasa a enlace: lo primero que ofrece la tarjeta es «Revisar solicitudes»)
    assert.match(t, new RegExp(`<button type="button" class="(?:btn-secondary )?tarjeta-admin-accion"(?: :class="[^"]*")? @click="${hace.source}">[\\s\\S]*?${accion}\\s*</button>`), `${clave}: la acción «${accion}»`);
    assert.match(t, /tarjeta-admin-dato/, `${clave}: un dato vivo`);
    assert.match(t, /tarjeta-admin-detalle/, `${clave}: y su detalle`);
    assert.match(t, /x-data="\{ get t\(\) \{ return Alpine\.store\('pos'\)\.tablero[A-Za-z]+; \} \}"/, `${clave}: el dato sale de un getter tablero* del store`);
  }
  // Solo la de la impresora está oculta (y por tieneImpresora); las otras ocho salen siempre.
  assert.match(tarjeta('impresora'), /x-show="\$store\.pos\.tieneImpresora" x-cloak/);
  for (const [clave] of TARJETAS.slice(0, 8)) assert.doesNotMatch(tarjeta(clave).split('\n')[0] + tarjeta(clave).split('\n')[1], /tieneImpresora/, `${clave} no depende de la impresora`);
  // Las que piden algo del admin se destacan (filete maíz); las demás no. «Cierres» solo cuando una tablet trae un cierre «Sin respaldo» de la versión
  // anterior (integración de la ronda 5: la hoja de r5a es alcanzable desde el tablero).
  for (const clave of ['personal', 'menu', 'mesas', 'alertas', 'cierres']) assert.match(tarjeta(clave), /:class="\{ destacada: t\.destacada \}"/, `${clave} se destaca cuando hay algo por hacer`);
  for (const clave of ['productos', 'ticket', 'deshechos']) assert.doesNotMatch(tarjeta(clave), /destacada/, `${clave} no se destaca`);
  // Ronda 6: Personal con solicitudes ofrece «Revisar solicitudes (N)» primero y «Agregar mesero» pasa a enlace; el menú y las pegatinas dicen «Por …» en su chip.
  assert.match(tarjeta('personal'), /x-show="t\.destacada" x-cloak @click="\$store\.pos\.irA\('personal'\)">[\s\S]*?'Revisar solicitudes \(' \+ t\.pendientes \+ '\)'/);
  assert.match(tarjeta('personal'), /:class="t\.destacada \? 'btn-enlace' : 'btn-secondary'"/);
  assert.match(tarjeta('menu'), /t\.estado === 'falta' \? 'Por cargar' : 'Por definir'/);
  assert.match(tarjeta('mesas'), /<span class="chip badge-maiz" x-show="t\.destacada" x-cloak>Por revisar<\/span>/);
});

test('r5b §1: el marcado nuevo no trae diálogos nativos, emojis, x-html ni estilos en línea; los íconos son decorativos', () => {
  assert.doesNotMatch(MARCADO, /\bconfirm\(|\balert\(|\bprompt\(/);
  assert.doesNotMatch(MARCADO, /\p{Extended_Pictographic}/u, 'sin emojis en la UI (docs/pos-visual.md §1.3)');
  assert.doesNotMatch(MARCADO, /x-html|style="/);
  for (const i of MARCADO.match(/<i data-lucide="[^"]+"[^>]*>/g)) {
    const dentro = MARCADO.indexOf(i);
    const padre = MARCADO.slice(Math.max(0, dentro - 160), dentro);
    assert.ok(/aria-hidden="true"/.test(i) || /aria-hidden="true"[^>]*>\s*$/.test(padre), `ícono sin aria-hidden: ${i}`);
  }
  // Los campos y botones nuevos no se achican por debajo de lo táctil con utilidades de Tailwind.
  assert.doesNotMatch(MARCADO, /class="[^"]*\b(?:h-[1-9]|min-h-0|text-xs)\b[^"]*"[^>]*@click/);
});

test('r5b §1: Personal, Menú semanal, Mesas y pegatinas y Ajustes vuelven al tablero con «‹ Administración»; Personal abre su alta cuando el tablero lo pide', () => {
  const volver = POS.match(/<button type="button" class="volver-admin" @click="\$store\.pos\.irA\('admin'\)">\s*<i data-lucide="chevron-left" aria-hidden="true"><\/i>\s*Administración\s*<\/button>/g) || [];
  assert.equal(volver.length, 6, 'una vuelta al tablero en cada una de las seis vistas (la quinta, la impresora de la caja, es de la integración con impresion-caja; la sexta, el panel de cierres, de cierres-de-hoy)');
  for (const vista of ['personal', 'menu', 'mesas-admin', 'ajustes', 'impresora']) {
    const a = POS.indexOf(`<section x-show="$store.pos.vista === '${vista}' && `);
    assert.ok(a !== -1, `falta la vista ${vista}`);
    assert.ok(POS.slice(a, a + 2600).includes('class="volver-admin"'), `${vista}: lleva la vuelta al tablero arriba`);
  }
  assert.match(POS, /@pos-accion\.window="if \(\$event\.detail && \$event\.detail\.accion === 'agregar-persona'\) \{ rol = 'mesero'; abierto = true;/, 'Personal escucha «agregar-persona»');
  assert.match(POS, /<div x-show="\$store\.pos\.cierres\.length > 0" class="mt-6 sm:mt-8" id="historial-cierres">/, '«Ver historial» baja hasta el historial');
});

// ───────────────────────── 2. navegación ─────────────────────────

test('r5b §2: una sola entrada «Administración» (solo admin) y ya no existe «Más»; el mesero conserva sus destinos', () => {
  const nav = sinHtmlComentarios(POS.slice(POS.indexOf('<nav class="nav-bar'), POS.indexOf('</nav>')));
  assert.equal((nav.match(/@click="\$store\.pos\.irA\('admin'\)"/g) || []).length, 1, 'una sola entrada que abre el tablero');
  assert.doesNotMatch(nav, /nav-mas|Más|ellipsis/, 'el botón «Más» y su hoja ya no existen (quedaría vacío)');
  // Entradas del nav: Mesas, Alertas (solo teléfono), Productos, Cierre (admin y mesero) y Administración (admin). Nada más.
  const entradas = [...nav.matchAll(/<button class="nav-link[^"]*"[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.equal(entradas.length, 5);
  const gate = (e) => (e.match(/x-show="\$store\.pos\.puede\('([a-z_]+)'\)"/) || [])[1];
  assert.deepEqual(entradas.map(gate), [undefined, undefined, undefined, 'ver_cierres', 'administracion'], 'quién ve cada entrada: el mesero ve las cuatro primeras, no la última');
  // El CSS de «Más» se fue entero.
  const css = sinComentariosCss(POS);
  assert.doesNotMatch(css, /\.nav-mas|\.nav-link-mas|hay-mas-abierto/);
  assert.doesNotMatch(nav, /\bmas\b/, 'ni el estado `mas` del nav');
});

test('r5b §2: la barra del teléfono reparte una columna por destino visible (5 con «Admin», 4 con rol de mesero) y la etiqueta corta no cambia el nombre accesible', () => {
  const nav = POS.slice(POS.indexOf('<nav class="nav-bar'), POS.indexOf('</nav>'));
  assert.match(nav, /<span class="nav-etiqueta"><span class="md:hidden">Admin<\/span><span class="hidden md:inline">Administración<\/span><\/span>/);
  assert.match(nav, /:aria-label="\$store\.pos\.numAtencionAdmin > 0 \? 'Administración \(' \+ \$store\.pos\.numAtencionAdmin \+ ' por revisar\)' : 'Administración'"/);
  assert.match(nav, /:class="\{ active: \$store\.pos\.enAdministracion \}"/, 'activa en el tablero y en las cuatro vistas a las que lleva');
  assert.match(nav, /<i data-lucide="sliders-horizontal"><\/i>/, 'ya no es «layout-dashboard», que a 22 px se confundía con el «layout-grid» de Mesas');
  assert.doesNotMatch(nav, /layout-dashboard/);
  assert.match(nav, /<span class="insignia" x-show="\$store\.pos\.numAtencionAdmin > 0"/, 'la insignia cuenta lo que el tablero pide: solicitudes, menú, pegatinas y ventas sin subir');
  assert.match(sinComentariosCss(POS), /\.nav-destinos\s*\{[^}]*grid-auto-flow:\s*column;[^}]*grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
});

// ───────────────────────── 3 y 4. el store, con el <script> real ─────────────────────────

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
async function montar(rol) {
  const base = crearBaseFalsa({ rol, olaC: true });
  const t = crearPos({ base, extras: { setInterval() { return 1; }, clearInterval() {} }, documento: { title: 'POS', visibilityState: 'visible' } });
  t.base = base; t.pos.usuario = YO;
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  await asentar();
  return t;
}

test('r5b §3: puede(\'administracion\') es solo del admin; irA() rechaza al mesero y a quien no tiene rol, y no cambia la vista', async () => {
  const admin = await montar('admin'), mesero = await montar('mesero');
  assert.equal(admin.pos.puede('administracion'), true);
  assert.equal(mesero.pos.puede('administracion'), false);
  assert.equal(mesero.pos.irA('admin'), false);
  assert.equal(mesero.pos.vista, 'mesas', 'el mesero se queda donde estaba');
  assert.equal(mesero.pos.irA('impresora'), false, 'la vista de la impresora pide el mismo permiso');
  for (const vista of ['personal', 'menu', 'mesas-admin', 'ajustes']) assert.equal(mesero.pos.irA(vista), false, `irA('${vista}') es del admin`);
  assert.equal(admin.pos.irA('admin'), true);
  assert.equal(admin.pos.vista, 'admin');
  assert.equal(admin.pos.enAdministracion, true);
  for (const vista of ['personal', 'menu', 'mesas-admin', 'ajustes']) { admin.pos.irA(vista); assert.equal(admin.pos.enAdministracion, true, `${vista} cuelga de Administración`); }
  admin.pos.irA('productos');
  assert.equal(admin.pos.enAdministracion, false);
  for (const accion of ['agregar-persona', 'agregar-producto', 'ver-historial', 'ver-deshechos']) {
    assert.equal(mesero.pos.accionTablero(accion), false, `ni la acción «${accion}» de una tarjeta`);
  }
  assert.equal(mesero.pos.vista, 'mesas');
  assert.equal(mesero.pos.modalProducto, false, 'y «Agregar producto» no abre el modal desde el tablero (el mesero lo abre en Productos)');
  assert.equal(admin.pos.accionTablero('desconocida'), false);
  assert.equal(admin.pos.accionTablero('agregar-producto'), true);
  assert.equal(admin.pos.modalProducto, true, 'el admin sí: el modal se abre sin salir del tablero');
});

test('r5b §3: «Menú semanal» abre siempre en la semana en curso, aunque se hubiera mirado otra', async () => {
  const t = await montar('admin');
  t.pos.semanaMenu = '2026-01-05';
  t.pos.irA('menu');
  assert.notEqual(t.pos.semanaMenu, '2026-01-05');
  assert.match(t.pos.semanaMenu, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(t.pos.semanaMenu + 'T00:00:00').getDay(), 1, 'es un lunes');
});

test('r5b §3: a quien le quitan el rol de admin mientras mira el tablero (o una de sus vistas) lo devuelven al mapa', async () => {
  for (const vista of ['admin', 'personal', 'menu', 'mesas-admin', 'ajustes']) {
    const t = await montar('admin');
    t.pos.irA(vista);
    await asentar();
    assert.equal(t.pos.vista, vista);
    t.base.rol = 'mesero';
    await t.pos.revalidarRol(true);
    await asentar();
    assert.equal(t.pos.rol, 'mesero');
    assert.equal(t.pos.vista, 'mesas', `${vista}: ya no es suyo`);
  }
});

test('r5b §4: el tablero cuenta lo que dice contar (personal, menú, mesas, productos, ticket, cierres, deshechos, alertas, hoy)', async () => {
  const t = await montar('admin');
  const p = t.pos;
  // Sin lecturas todavía: «—» y no un cero que sería mentira.
  p._personalCargado = false;
  assert.deepEqual(plano(p.tableroPersonal).numero, '—');
  assert.equal(p.tableroMenu.estado, 'sin-dato');
  assert.equal(p.tableroMenu.texto, 'Sin leer todavía');
  p.mesasAdmin = [];
  assert.equal(p.tableroMesas.sinRevisar, null);
  assert.equal(p.tableroMesas.detalle, 'Pegatinas sin leer todavía');
  assert.equal(p.tableroDeshechos.numero, '', 'sin deshechos y sin error: la frase lo dice');

  // Personal: 2 por aprobar y 3 activos (el dado de baja y los pendientes no cuentan).
  p._personalCargado = true;
  p.personalPendientes = [{ email: 'a@ejemplo.test', nombre: 'A', solicitadoEn: null }, { email: 'b@ejemplo.test', nombre: 'B', solicitadoEn: null }];
  p.personal = [{ email: 'c@ejemplo.test', rol: 'admin', activo: true }, { email: 'd@ejemplo.test', rol: 'mesero', activo: true }, { email: 'e@ejemplo.test', rol: 'mesero', activo: true }, { email: 'f@ejemplo.test', rol: 'mesero', activo: false }];
  assert.deepEqual(plano({ ...p.tableroPersonal }), { pendientes: 2, activos: 3, conDatos: true, destacada: true, numero: '2', texto: 'esperan aprobación', detalle: '3 activos' });
  p.personalPendientes = p.personalPendientes.slice(0, 1);
  assert.equal(p.tableroPersonal.texto, 'espera aprobación', 'singular');
  p.personalPendientes = [];
  assert.equal(p.tableroPersonal.destacada, false);
  assert.equal(p.tableroPersonal.texto, 'Nadie espera aprobación');

  // Menú semanal: falta, incompleta, lista.
  p.menuActual = { semana: '2026-09-28', total: 0, porDefinir: 0 };
  assert.equal(p.tableroMenu.estado, 'falta'); assert.equal(p.tableroMenu.destacada, true); assert.equal(p.tableroMenu.texto, 'Falta cargar esta semana');
  p.menuActual = { semana: '2026-09-28', total: 16, porDefinir: 2 };
  assert.equal(p.tableroMenu.estado, 'incompleta'); assert.equal(p.tableroMenu.texto, 'Faltan por definir 2 platos');
  p.menuActual = { semana: '2026-09-28', total: 16, porDefinir: 1 };
  assert.equal(p.tableroMenu.texto, 'Falta definir 1 plato');
  p.menuActual = { semana: '2026-09-28', total: 16, porDefinir: 0 };
  assert.equal(p.tableroMenu.estado, 'lista'); assert.equal(p.tableroMenu.destacada, false); assert.equal(p.tableroMenu.texto, 'La semana está cargada');
  assert.match(p.tableroMenu.detalle, /^Semana del 28 .* – 3 .*/);

  // Mesas y pegatinas: 3 activas (una inactiva), 2 sin revisar.
  p.mesasAdmin = [{ id: 1, activa: true, revisadaEn: '2026-09-29T10:00:00Z' }, { id: 2, activa: true, revisadaEn: null }, { id: 3, activa: true, revisadaEn: null }, { id: 4, activa: false, revisadaEn: null }];
  assert.deepEqual(plano({ ...p.tableroMesas }), { activas: 3, sinRevisar: 2, conDatos: true, destacada: true, numero: '3', texto: 'mesas activas', detalle: '2 pegatinas sin revisar' }, 'con pegatinas sin revisar la tarjeta se destaca (ronda 6)');
  p.mesasAdmin = p.mesasAdmin.map((m) => ({ ...m, revisadaEn: '2026-09-29T10:00:00Z' }));
  assert.equal(p.tableroMesas.detalle, 'Todas las pegatinas revisadas'); assert.equal(p.tableroMesas.destacada, false);
  p.mesasAdmin = [];
  assert.equal(p.tableroMesas.destacada, false, 'sin lectura de pegatinas no se destaca nada');

  // Productos: los activos, no los desactivados.
  p.productos = [{ id: 'a', cat: 'Entradas', nombre: 'A', precio: 1, activo: true }, { id: 'b', cat: 'Bebidas', nombre: 'B', precio: 2, activo: true }, { id: 'c', cat: 'Bebidas', nombre: 'C', precio: 3, activo: false }];
  assert.deepEqual(plano({ ...p.tableroProductos }), { enCarta: 2, categorias: 2, destacada: false, numero: '2', texto: 'en carta', detalle: '2 categorías' });

  // Ticket: la dirección del QR sin https:// ni la barra final.
  p.ajustes = { ticketQrUrl: 'https://carta.ejemplo.test/resplandor/', ticketQrVisible: true, ticketPie: 'Gracias' };
  assert.equal(p.tableroTicket.texto, 'carta.ejemplo.test/resplandor'); assert.equal(p.tableroTicket.detalle, 'El QR sale en el ticket');
  p.ajustes = { ...p.ajustes, ticketQrVisible: false };
  assert.equal(p.tableroTicket.detalle, 'QR apagado en el ticket');

  // Cierres: el más reciente por fecha (no por posición) y su total.
  p.cierres = [{ id: 'v', fecha: '2026-09-27T22:00:00-05:00', total: 100 }, { id: 'n', fecha: '2026-09-29T22:00:00-05:00', total_ventas: 514000 }];
  assert.equal(p.tableroCierre.ultimo.total, 514000);
  assert.match(p.tableroCierre.texto, /^29 .* · \$ 514\.000$/);
  p.cierres = [];
  assert.equal(p.tableroCierre.texto, 'Aún no hay cierres');
  // La insignia de «Admin»: solicitudes por aprobar + una por cada tarjeta que pide algo (menú, pegatinas, ventas sin subir); las alertas no cuentan.
  p.personalPendientes = [{ email: 'a@ejemplo.test', nombre: 'A', solicitadoEn: null }, { email: 'b@ejemplo.test', nombre: 'B', solicitadoEn: null }];
  p.menuActual = { semana: '2026-09-28', total: 16, porDefinir: 0 };
  p.mesasAdmin = [{ id: 1, activa: true, revisadaEn: '2026-09-29T10:00:00Z' }];
  p.cierresViejos = [];
  assert.equal(p.numAtencionAdmin, 2, 'solo las dos solicitudes');
  p.menuActual = { semana: '2026-09-28', total: 0, porDefinir: 0 };
  p.mesasAdmin = [{ id: 1, activa: true, revisadaEn: null }];
  p.cierresViejos = [{ id: 'viejo', fecha: '2026-09-30T12:30:00-05:00', total: 1, sync: 'error', purgar: [], ordenes: [] }];
  assert.equal(p.numAtencionAdmin, 5, 'dos solicitudes + menú sin cargar + pegatina sin revisar + ventas sin subir');
  p.alertas = [{ id: 'a1', mesaId: 6, metodo: 'efectivo' }];
  assert.equal(p.numAtencionAdmin, 5, 'las alertas tienen su propia insignia');
  p.alertas = []; p.personalPendientes = []; p.cierresViejos = []; p.mesasAdmin = []; p.menuActual = { semana: '', total: null, porDefinir: 0 };

  // Cobros deshechos hoy: solo los que ningún cierre se llevó.
  p.deshechosFilas = [{ id: 1, monto: 26000, cierreId: null }, { id: 2, monto: 20000, cierreId: null }, { id: 3, monto: 63000, cierreId: null }, { id: 0, monto: 41000, cierreId: 'cierre-ayer' }];
  assert.deepEqual(plano({ ...p.tableroDeshechos }), { n: 3, monto: 109000, error: false, destacada: false, numero: '3', texto: 'cobros · $ 109.000', detalle: 'Desde el último cierre' });
  p.deshechosError = 'No se pudieron leer los cobros deshechos. Revisa la conexión.';
  assert.equal(p.tableroDeshechos.numero, '—'); assert.equal(p.tableroDeshechos.texto, 'No se pudo leer');

  // Alertas: las pendientes y de qué mesas.
  p.alertas = [{ id: 'a1', mesaId: 6, metodo: 'efectivo' }, { id: 'a2', mesaId: 3, metodo: 'qr' }];
  assert.deepEqual(plano({ ...p.tableroAlertas }), { n: 2, mesas: [3, 6], destacada: true, numero: '2', texto: 'pendientes', detalle: 'Mesas 3, 6' });
  p.alertas = [];
  assert.equal(p.tableroAlertas.texto, 'Sin alertas pendientes'); assert.equal(p.tableroAlertas.destacada, false);

  // Hoy.
  assert.equal(p.tableroHoy.alertas, 0);
  assert.equal(p.tableroHoy.ventas, p.totalHoy);
  assert.equal(p.tableroHoy.ocupadas, p.mesas.filter((m) => m.activa !== false && m.estado === 'ocupada').length);
});

// ───────────────────────── 6. el gancho de la impresora ─────────────────────────

test('r5b §6: el gancho de la impresora de la caja: sin la cola en la base `impresora` es null y la tarjeta no existe; con datos de impresora (o con la cola, ver impresion-tablero) se enciende', async () => {
  const t = await montar('admin');
  assert.equal(t.pos.impresora, null, 'sin la cola de impresión en la base nadie pone datos de impresora');
  assert.equal(t.pos.tieneImpresora, false);
  t.pos.impresora = { nombre: 'Epson TM-T20 (caja)', detalle: 'Lista · último ticket hace 2 min' };
  assert.equal(t.pos.tieneImpresora, true);
  assert.deepEqual(plano({ ...t.pos.tableroImpresora }), { destacada: false, numero: '', tono: '', estado: '', texto: 'Epson TM-T20 (caja)', detalle: 'Lista · último ticket hace 2 min' }, 'el gancho a secas: el nombre y la línea de estado');
  // El gancho está documentado donde la rama impresion-caja lo usa.
  assert.match(POS, /El gancho de la impresora de la caja \(docs\/pos-visual\.md §0\.20\)/);
  assert.match(MARCADO.length ? POS : '', /Impresora de la caja \(cola de impresión en Supabase \+ agente en el PC de la caja\): el gancho del tablero/);
  assert.ok(DOC.includes('tieneImpresora'), '§0.20 explica el gancho');
});

test('r5b §6: cerrar la sesión (o cambiar de cuenta) vacía lo del tablero: nada de un admin queda a la vista de la cuenta siguiente', async () => {
  const t = await montar('admin');
  t.pos.menuActual = { semana: '2026-09-28', total: 16, porDefinir: 0 };
  t.pos.impresora = { nombre: 'X', detalle: 'Y' };
  await t.pos.cerrarSesion();
  await asentar();
  assert.deepEqual(plano(t.pos.menuActual), { semana: '', total: null, porDefinir: 0 }, 'el menú leído se olvida');
  assert.equal(t.pos.vista, 'mesas');
});

// ───────────────────────── 5. CSS ─────────────────────────

test('r5b §5: la rejilla es de 1 columna en teléfono, 2 desde 768 y 3 desde 1024, con minmax(0, 1fr) (nada se sale)', () => {
  assert.match(CSS, /\.tablero-rejilla\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(CSS, /@media \(min-width: 768px\)\s*\{\s*\.tablero-rejilla\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(CSS, /@media \(min-width: 1024px\)\s*\{\s*\.tablero-rejilla\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

test('r5b §5: el título abre la vista con un área táctil que cubre la tarjeta (≥ 44 px), la acción va encima y el foco rodea la tarjeta entera', () => {
  assert.match(CSS, /\.tarjeta-admin\s*\{[^}]*position:\s*relative/, 'la tarjeta es el bloque contenedor del ::after');
  assert.match(CSS, /\.tarjeta-admin-abre\s*\{[^}]*min-height:\s*var\(--pos-tactil\)/, '44 px de alto');
  assert.doesNotMatch(CSS.match(/\.tarjeta-admin-abre\s*\{[^}]*\}/)[0], /position:/, 'el botón NO se posiciona (el ::after se mide contra la tarjeta)');
  assert.match(CSS, /\.tarjeta-admin-abre::after\s*\{[^}]*content:\s*'';[^}]*position:\s*absolute;[^}]*inset:\s*0/);
  assert.match(CSS, /\.tarjeta-admin-accion\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1/, 'la acción queda por encima del área de la tarjeta');
  assert.match(CSS, /\.tarjeta-admin-abre:focus-visible::after\s*\{[^}]*outline:\s*2px solid var\(--foco, var\(--color-barro\)\)/, 'el foco: barro sobre claro, como el resto');
  assert.match(CSS, /\.volver-admin\s*\{[^}]*min-height:\s*var\(--pos-tactil\)/);
  // Las acciones son .btn-secondary (52 px): 44 y más sin tocar nada.
  assert.match(POS, /--pos-boton-alto:\s*3\.25rem/);
});

test('r5b §5: el CSS del tablero no fija ni pega, todo :hover va con puntero, sin opacidad en el texto, sin :has ni text-wrap, y toda var() está declarada', () => {
  assert.doesNotMatch(CSS, /position:\s*(?:fixed|sticky)/, 'nada fijo: no hace falta `screen`');
  assert.doesNotMatch(CSS, /\bopacity\s*:/, 'sin opacity: el texto con transparencia no pasa el contraste');
  assert.doesNotMatch(CSS, /color-mix\(|rgb\(from|:has\(|text-wrap|@media print/);
  const fuera = CSS.replace(/@media \(hover: hover\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.doesNotMatch(fuera, /:hover/, 'un :hover fuera de @media (hover: hover) se queda pegado tras el toque');
  assert.doesNotMatch(CSS, /animation|@keyframes|infinite/, 'nada se anima');
  const declaradas = new Set([...sinComentariosCss(POS).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const sinDeclarar = [...CSS.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]).filter((v) => !declaradas.has(v));
  assert.deepEqual([...new Set(sinDeclarar)], []);
  // Colores solo de los tokens (o el velo rgb(10 17 18 / .0x), que es el telón).
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/, 'ningún hex suelto');
  assert.doesNotMatch(CSS.replace(/rgb\(10 17 18 \/ \.\d+\)/g, ''), /rgba?\(/, 'ni otro rgb()');
});

// ───────────────────────── 7. arnés y documentación ─────────────────────────

test('r5b §7: el arnés trae las vistas del tablero (con pendientes, vacío, sin red, con impresora y mesero) y ya no las de «Más»', async () => {
  const { VISTAS } = await import(path.join(RAIZ, 'scripts/pruebas/_pos-simulado.mjs'));
  for (const v of ['admin', 'admin-vacio', 'admin-sin-red', 'admin-impresora', 'admin-mesero']) {
    assert.ok(VISTAS[v], `falta la vista «${v}» del arnés`);
    assert.ok(/^ola C r5/.test(VISTAS[v].descripcion) && typeof VISTAS[v].llegar === 'function', `${v}: descripción y llegar()`);
  }
  for (const v of ['mas-pendientes', 'mas-escritorio', 'mesas-admin-mas']) assert.equal(VISTAS[v], undefined, `«${v}» se fue con «Más»`);
});

test('r5b §7: docs/pos-visual.md §0.20 dice lo que se decidió (nav, tarjetas, Hoy, Alertas en la barra, impresora, getters y arnés)', () => {
  const i = DOC.indexOf('### 0.20');
  assert.ok(i !== -1, 'falta «### 0.20» en docs/pos-visual.md');
  const fin = DOC.indexOf('\n---\n', i);
  const sec = DOC.slice(i, fin === -1 ? undefined : fin);
  for (const frase of ['Administración', 'Más', 'Hoy', 'Alertas', 'Admin', 'tieneImpresora', 'impresora', 'irA', 'tableroPersonal', 'tableroMenu', 'accionTablero', 'cargarTablero',
    'volver-admin', 'tarjeta-admin', 'data-tarjeta', 'admin-vacio', 'Menú semanal', 'Personal', 'Mesas y pegatinas', 'Productos', 'Ticket y ajustes', 'Cierres e historial',
    'Cobros deshechos', 'Impresora de la caja', 'pos-accion', 'VISTAS_ADMIN']) {
    assert.ok(sec.includes(frase), `§0.20 debería hablar de «${frase}»`);
  }
  assert.ok(DOC.includes('superada por §0.20'), '§0.19 avisa que su decisión de «Más» quedó superada');
});
