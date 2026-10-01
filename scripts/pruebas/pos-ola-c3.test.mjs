// Ola C, parte c3: la pantalla del POS (marcado y CSS) para la aprobación del personal, «Mesas y pegatinas», los ajustes del ticket,
// deshacer un cobro y los avisos del pulgar. Prueba estática: lee pos.html como texto (no abre un navegador; las capturas, el desborde
// y los 44 px viven en el arnés, scripts/capturas-pos.mjs, y el comportamiento en pos-ola-c3-navegador.test.mjs).
//
// Qué verifica:
//   1. El marcado usa TODOS los nombres del contrato de la ola C (los que c2 implementa en el <script>) y solo esos para lo nuevo.
//      Mientras c2 no esté integrado, pos-ola-b2.test.mjs §1 acepta esos nombres como «excepción por contrato».
//   2. Compuertas: la espera de aprobación sustituye al POS (y a «sin acceso»); las vistas nuevas y sus entradas piden su puede(...);
//      el aviso de deshacer pide deshacer_cobro y se esconde sin red.
//   3. Confirmaciones en la página (nada de confirm() ni alert() nuevos): eliminar una solicitud, aprobar como admin, rotar el enlace
//      y devolver a la cuenta; y aprobar como mesero es de un toque.
//   4. Campos: 16 px, con el teclado que toca (url, numérico) y solo dígitos donde son números.
//   5. El ticket: el pie y el QR salen de los ajustes, el QR se dibuja con qrTicketSvg y falta sin romper; el SVG estático de antes se fue.
//   6. CSS del bloque c3: nada que fije o pegue bajo un max-width sin `screen`; la pila del pulgar (z 60) va entre el diálogo y el login;
//      todo :hover dentro de (hover: hover); sin opacidad en el texto, ni nada infinito; la respuesta al tocar quita la escala con
//      prefers-reduced-motion; las variables que usa están declaradas.
//   7. El arnés trae las vistas nuevas y su relleno del contrato solo agrega lo que el store todavía no tiene.
//   8. La documentación (docs/pos-visual.md §0.19) dice lo que se decidió.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const SIMULADO = fs.readFileSync(path.join(RAIZ, 'scripts/pruebas/_pos-simulado.mjs'), 'utf8');
const DOC = fs.readFileSync(path.join(RAIZ, 'docs/pos-visual.md'), 'utf8');

/** Lo que c2 promete en Alpine.store('pos') y c3 usa en el marcado (el contrato de la ola C). `vibrar` lo llama c2 desde agregarProducto: el marcado no. */
const CONTRATO = [
  'estadoAcceso', 'esperaAprobacion', 'mesasPendiente', 'cartaPendiente',
  'personalPendientes', 'numPendientes', 'aprobarPersonal', 'eliminarPersonal',
  'mesasAdmin', 'mesasAdminError', 'cargarMesasAdmin', 'crearMesa', 'editarMesa', 'activarMesa', 'copiarEnlace', 'nfcDisponible',
  'escribirPegatina', 'revisarPegatina', 'nfcEstado', 'cancelarNfc',
  'ultimoCobro', 'deshacerUltimoCobro', 'puedeDevolver', 'devolverACuenta', 'deshacerError',
  'ajustes', 'cargarAjustes', 'guardarAjustes', 'ajustesError', 'ajustesGuardados', 'qrTicketSvg',
  'agregadoReciente',
];

const MARCADO = POS.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const parte = (clave, tipo) => {
  const abre = tipo === 'css' ? `/* ▼ PARTE ${clave} :: css */` : `<!-- ▼ PARTE ${clave} -->`;
  const cierra = tipo === 'css' ? `/* ▲ PARTE ${clave} :: css */` : `<!-- ▲ PARTE ${clave} -->`;
  const a = POS.indexOf(abre), b = POS.indexOf(cierra);
  assert.ok(a !== -1 && b > a, `faltan los marcadores ${abre} … ${cierra}`);
  return POS.slice(a, b);
};
const CSS = parte('ola-c-c3', 'css');
const PARTES_MARCADO = ['ola-c-c3 :: espera', 'ola-c-c3 :: mesas-admin', 'ola-c-c3 :: ajustes', 'ola-c-c3 :: avisos'];
const sinHtmlComentarios = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

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

// ───────────────────────── 1. nombres del store ─────────────────────────

test('c3 §1: el marcado usa cada nombre del contrato de la ola C (menos vibrar, que llama c2) con $store.pos o Alpine.store(\'pos\')', () => {
  const usados = new Set([
    ...[...MARCADO.matchAll(/\$store\.pos\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...MARCADO.matchAll(/Alpine\.store\('pos'\)\??\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  ]);
  const faltan = CONTRATO.filter((n) => !usados.has(n));
  assert.deepEqual(faltan, [], `el contrato promete y el marcado no usa: ${faltan.join(', ')}`);
  // Y el rotar enlace del panel pasa el número de la mesa a la función que ya existía (c2 la deja aceptar un id opcional).
  assert.match(MARCADO, /\$store\.pos\.rotarTokenMesa\(m\.id, \{ confirmado: true \}\)/, 'el panel ya confirmó dentro de la página: sin «confirmado: true» el store preguntaría otra vez con confirm() y avisaría con alert()');
  // El marcado no inventa nombres propios de la ola: todo lo que pida al store que NO sea del contrato ni de antes debe estar definido.
  assert.doesNotMatch(MARCADO, /\$store\.pos\.(?:personalAprobar|mesaCrear|pegatinaMarcar|vistaPendiente|solicitarAcceso)\b/, 'esos son nombres de la base, no del store');
});

test('c3 §1: las vistas nuevas son \'mesas-admin\' y \'ajustes\' del store.vista', () => {
  assert.match(MARCADO, /\$store\.pos\.vista === 'mesas-admin'/);
  assert.match(MARCADO, /\$store\.pos\.vista === 'ajustes'/);
});

// ───────────────────────── 2. compuertas ─────────────────────────

test('c3 §2: la espera de aprobación sustituye al POS y a «sin acceso»; el POS la excluye', () => {
  assert.match(MARCADO, /<div x-data="\{[\s\S]*?x-show="\$store\.pos\.usuario && \$store\.pos\.esperaAprobacion" x-cloak\s+class="espera-pantalla"/);
  assert.match(MARCADO, /\(\$store\.pos\.sinAcceso \|\| \$store\.pos\.accesoSinComprobar\) && !\$store\.pos\.esperaAprobacion/);
  assert.match(MARCADO, /!\$store\.pos\.accesoSinComprobar && !\$store\.pos\.esperaAprobacion" x-cloak>/);
  // Sin sincronizar, ni abrir nada: el mapa de la espera son <div>, nunca <button>, y no lleva @click.
  const espera = sinHtmlComentarios(parte(PARTES_MARCADO[0], 'html'));
  const mapa = espera.slice(espera.indexOf('class="espera-mesas"'), espera.indexOf('id="espera-panel-carta"'));
  assert.ok(mapa.length > 200, 'no encontré el mapa de la espera');
  assert.doesNotMatch(mapa, /<button|@click|abrirMesa/, 'el salón de la espera es solo para mirar');
  assert.doesNotMatch(espera, /abrirMesa|agregarProducto|\$store\.pos\.mesas\b|\$store\.pos\.ordenes|\$store\.pos\.productos/, 'la espera no toca datos del restaurante');
  // La variante «eliminado» no enseña mesas ni carta.
  assert.match(espera, /<section class="espera-vista" x-show="pendiente"/);
  assert.match(espera, /Pídele a Camila o al admin que te apruebe/);
  assert.match(espera, /Esta cuenta no tiene acceso/);
});

test('c3 §2: las vistas y las entradas nuevas piden su puede(...)', () => {
  assert.match(MARCADO, /<section x-show="\$store\.pos\.vista === 'mesas-admin' && \$store\.pos\.puede\('mesas_admin'\)"/);
  assert.match(MARCADO, /<section x-show="\$store\.pos\.vista === 'ajustes' && \$store\.pos\.puede\('ajustes'\)"/);
  assert.match(MARCADO, /x-show="\$store\.pos\.puede\('aprobar_personal'\) && \$store\.pos\.numPendientes > 0"/, 'los pendientes, solo para quien aprueba y si hay');
  assert.match(MARCADO, /x-if="\$store\.pos\.puede\('deshacer_cobro'\) && \$store\.pos\.ultimoCobro && \$store\.pos\.conexion !== 'offline'"/, 'deshacer: con permiso y con red');
  assert.match(MARCADO, /x-show="\$store\.pos\.puedeDevolver\(orden\)"/, 'devolver: lo decide puedeDevolver (sin ventana de tiempo: ya no hace falta que `ahora` lo reevalúe)');
  assert.match(MARCADO, /<button type="button" class="btn-peligro btn-sm" x-show="\$store\.pos\.puede\('rotar_token'\)"/, 'rotar sigue siendo del admin');
});

// ───────────────────────── 3. confirmaciones ─────────────────────────

test('c3 §3: eliminar, aprobar como admin, rotar y devolver se confirman EN la página; aprobar como mesero es de un toque; sin confirm() ni alert() nuevos', () => {
  const nuevo = PARTES_MARCADO.map((c) => sinHtmlComentarios(parte(c, 'html'))).join('\n');
  assert.doesNotMatch(nuevo, /\bconfirm\(|\balert\(|\bprompt\(/, 'ni un diálogo nativo en el marcado nuevo');
  // Pendientes: aprobar como mesero llama directo; admin y eliminar pasan por un paso de confirmación.
  assert.match(MARCADO, /class="btn-telon" @click="\$store\.pos\.aprobarPersonal\(q\.email, 'mesero'\)"/);
  assert.match(MARCADO, /class="btn-secondary" @click="paso = 'admin'"/);
  assert.match(MARCADO, /@click="paso = ''; \$store\.pos\.aprobarPersonal\(q\.email, 'admin'\)">Sí, aprobar como admin</);
  assert.match(MARCADO, /class="btn-peligro pendiente-eliminar" @click="paso = 'eliminar'"/);
  assert.match(MARCADO, /@click="paso = ''; \$store\.pos\.eliminarPersonal\(q\.email\)">Sí, rechazar</, 'a una solicitud se la «rechaza»');
  // El equipo aprobado: «Dar de baja» también se confirma.
  assert.match(MARCADO, /@click="\$store\.pos\.eliminarPersonal\(p\.email\); baja = false">Sí, dar de baja</);
  // Rotar: la advertencia va antes y dice que la pegatina vieja deja de servir.
  assert.match(MARCADO, /La pegatina que está pegada deja de servir y hay que reescribirla/);
  assert.match(MARCADO, /@click="rotar = false; \$store\.pos\.rotarTokenMesa\(m\.id, \{ confirmado: true \}\)">Sí, rotar</);
  // Devolver: dice qué vuelve y cómo queda la cuenta (de A a B), y llama con el id de la orden.
  assert.match(MARCADO, /Sí, deshacer el cobro</, 'la misma confirmación para los cinco tipos (sin ventana de tiempo)');
  assert.match(MARCADO, /devolverACuenta\(orden\.id\)/);
  assert.match(MARCADO, /totalMesa\(orden\.mesaId\) \|\| 0\) \+ orden\.total/, 'el total resultante = lo que hay en la cuenta + lo que vuelve');
});

// ───────────────────────── 4. campos ─────────────────────────

test('c3 §4: campos de 16 px con su teclado: url, números solo dígitos, interruptor accesible', () => {
  const campos = [...MARCADO.matchAll(/<input[^>]*>/g)].map((m) => m[0]).filter((t) => /id="(?:mesa-nueva-num|mesa-nueva-cap|ajuste-url|ajuste-pie)"|:id="'cap-'/.test(t));
  assert.equal(campos.length, 5, 'los cinco campos de la ola C (número, capacidad, capacidad al editar, URL del QR y pie)');
  for (const c of campos) {
    assert.match(c, /class="field[ "]/, `usa .field (16 px): ${c.slice(0, 60)}`);
    assert.doesNotMatch(c, /text-(sm|xs)/, 'ningún campo con text-sm o text-xs: iOS haría zoom');
  }
  const url = campos.find((c) => /ajuste-url/.test(c));
  assert.match(url, /type="url"/);
  assert.match(url, /inputmode="url"/);
  assert.match(url, /autocapitalize="off"/);
  for (const c of campos.filter((x) => /mesa-nueva|cap-/.test(x))) {
    assert.match(c, /inputmode="numeric"/);
    assert.match(c, /replace\(\/\\D\/g, ''\)/, 'solo dígitos');
  }
  assert.match(campos.find((c) => /ajuste-pie/.test(c)), /maxlength="120"/, 'el pie: hasta 120, como la base');
  // La misma regla que los dos check de la tabla ajustes: https://, sin espacios, 3 a 200 caracteres y sin < > " ` \ (integración de la ola C).
  assert.match(MARCADO, /get urlOk\(\) \{ const u = this\.url\.trim\(\); return \/\^https:\\\/\\\/\[\^\\s\]\{3,200\}\$\/\.test\(u\) && !\/\[<>\\x22`\\\\\]\/\.test\(u\); \}/, 'la dirección: la misma regla de la base (https://, sin espacios, hasta 200, sin < > \" ` \\)');
  assert.match(MARCADO, /<button type="button" role="switch" class="interruptor"[^>]*:aria-checked="visible"[^>]*aria-labelledby="ajuste-qr-etiqueta"/, 'el interruptor es un switch con nombre');
});

test('c3 §4: «Guardar» manda el borrador con los nombres del contrato y solo se activa con algo que cambiar y válido', () => {
  assert.match(MARCADO, /guardarAjustes\(\{ ticketQrUrl: url\.trim\(\), ticketQrVisible: visible, ticketPie: pie \}\)/);
  assert.match(MARCADO, /:disabled="!urlOk \|\| !pieOk \|\| !cambia"/);
  // Los campos editan un borrador de la vista, no el store: lo que se imprime solo cambia al guardar.
  assert.doesNotMatch(MARCADO, /x-model="\$store\.pos\.ajustes/, 'editar el store en vivo imprimiría una dirección sin guardar');
});

// ───────────────────────── 5. ticket ─────────────────────────

test('c3 §5: el pie y el QR del ticket salen de los ajustes; el QR se dibuja con qrTicketSvg y, si falta, no se rompe', () => {
  assert.match(MARCADO, /<div class="ticket-footer" x-text="\$store\.pos\.ajustes\?\.ticketPie \?\? BUSINESS\.pie"><\/div>/);
  const plantilla = MARCADO.slice(MARCADO.indexOf('<template x-if="$store.pos.ajustes?.ticketQrVisible !== false'));
  assert.match(plantilla.slice(0, 700), /\$store\.pos\.ajustes\?\.ticketQrVisible !== false && \$store\.pos\.qrTicketSvg && \/\^https:\\\/\\\//, 'visible, con dibujo y con https://');
  assert.match(plantilla.slice(0, 900), /<div class="ticket-qr-svg" aria-hidden="true" x-html="\$store\.pos\.qrTicketSvg"><\/div>/);
  assert.match(plantilla.slice(0, 900), /:href="\$store\.pos\.ajustes\.ticketQrUrl" target="_blank" rel="noopener"/);
  // El SVG estático de pos-pie ya no está en el ticket (ni su dirección escrita a mano).
  assert.doesNotMatch(MARCADO, /viewBox="0 0 29 29"/, 'el QR estático se fue');
  assert.doesNotMatch(MARCADO, /<a class="ticket-qr" href="https:\/\/resplandor\.ynt\.codes\/"/);
  // El pie impreso conserva el margen, la sangría y el QR de 18 mm (clases y reglas de pos-pie, sin tocar).
  assert.match(POS, /body\.print-termico \.ticket-qr svg\s*\{\s*width: 18mm;\s*height: 18mm;/);
  assert.match(CSS, /\.ticket-qr-svg\s*\{[^}]*display:\s*block/);
});

test('c3 §5: la vista previa de Ajustes usa el mismo marcado del ticket y qrTicketSvg', () => {
  const previa = MARCADO.slice(MARCADO.indexOf('class="ajuste-previa"'), MARCADO.indexOf('class="aviso-peligro mt-4"'));
  assert.ok(previa.length > 300, 'no encontré la vista previa');
  assert.match(previa, /class="ticket-footer" x-text="pie \|\| ' '"/);
  assert.match(previa, /class="ticket-qr" x-show="visible"/);
  assert.match(previa, /x-html="\$store\.pos\.qrSvgPara\(urlPrevia\)"/, 'dibuja el QR de lo que se está escribiendo, no el guardado (que puede estar apagado)');
});

// ───────────────────────── 6. CSS ─────────────────────────

test('c3 §6: el CSS de la parte no fija ni pega bajo un max-width sin `screen`; la pila del pulgar va entre el diálogo y el login', () => {
  for (const { condicion, cuerpo } of bloquesMedia(CSS)) {
    if (!/max-width/.test(condicion) || /^screen\b/.test(condicion) || /\bprint\b/.test(condicion) || /prefers-reduced-motion/.test(condicion)) continue;
    assert.doesNotMatch(cuerpo, /position\s*:\s*(?:fixed|sticky)|[\s;{]order\s*:/, `@media ${condicion} fija, pega o reordena sin \`screen\``);
  }
  const css = sinComentarios(CSS);
  const z = Number(css.match(/\.avisos-pulgar\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  const dialogo = Number(sinComentarios(POS).match(/\.modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  assert.ok(z > dialogo && z < 100, `la pila del pulgar (z ${z}) va sobre el diálogo (${dialogo}) y bajo el login (100)`);
  assert.match(css, /\.avisos-pulgar\s*\{[^}]*pointer-events:\s*none/, 'la pila deja pasar los toques; solo sus avisos con botón los reciben');
  assert.match(css, /\.agregado-aviso\s*\{[^}]*pointer-events:\s*none/, '«+1 Paloma» no tapa los «+»');
  assert.doesNotMatch(CSS, /@media print/, 'un @media print propio iría antes del de la sección 7 y la prueba del ticket térmico lo tomaría por el suyo');
  // La pila se asienta sobre la barra que haya: la de cobro en la orden, las acciones del ticket, la de navegación en el resto.
  assert.match(css, /\.avisos-pulgar\.en-orden\s*\{[^}]*--pos-pulgar-base:\s*calc\(var\(--pos-accion-inf\)/);
  assert.match(css, /\.avisos-pulgar\.en-ticket\s*\{[^}]*var\(--pos-ticket-acciones\)/);
  assert.match(css, /\.hay-toast-alerta \.avisos-pulgar\s*\{[^}]*--pos-pulgar-extra/, 'sube sobre el aviso de alertas, que ocupa ese sitio');
});

test('c3 §6: todo :hover del bloque va dentro de (hover: hover), sin opacidad en el texto, sin nada infinito, sin funciones que las tablets viejas no entienden', () => {
  const css = sinComentarios(CSS);
  const fuera = css.replace(/@media \(hover: hover\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.doesNotMatch(fuera, /:hover/, 'un :hover fuera de @media (hover: hover) se queda pegado tras el toque');
  // (la entrada de un aviso, @keyframes, anima la opacidad del cuadro entero durante 120 a 180 ms: no es texto con transparencia)
  assert.doesNotMatch(css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''), /(^|[;{\s])opacity\s*:/, 'sin opacity: el texto con transparencia no pasa el contraste');
  assert.doesNotMatch(css, /infinite/, 'nada infinito (§1.2): ni pulso ni giro');
  assert.doesNotMatch(css, /color-mix\(|rgb\(from|:has\(|text-wrap|backdrop-filter/, 'nada que las tablets viejas no entiendan');
  const marcado = PARTES_MARCADO.map((c) => parte(c, 'html')).join('\n');
  assert.doesNotMatch(marcado, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'sin emojis en la UI');
  assert.doesNotMatch(marcado, /text-\w+\/\d+/, 'sin texto con transparencia');
});

test('c3 §6: la respuesta al tocar existe y con prefers-reduced-motion se quita la escala (quedan el fondo y la sombra)', () => {
  const css = sinComentarios(CSS);
  for (const sel of ['.btn-primary:active:not(:disabled)', '.mesa-card:active', '.btn-icon:active', '.qty-btn:active:not(:disabled)', '.nav-link:active', '.menu-item:active']) {
    assert.ok(css.includes(sel), `falta la respuesta al tocar de ${sel}`);
  }
  assert.match(css, /\.btn-primary:active:not\(:disabled\),[\s\S]*?\{\s*transform:\s*scale\(\.97\)/, 'los botones se hunden a .97 (antes .985, casi invisible)');
  const reducido = bloquesMedia(CSS).filter((b) => /prefers-reduced-motion:\s*reduce/.test(b.condicion)).map((b) => b.cuerpo).join('\n');
  assert.match(reducido, /\.mesa-card:active[\s\S]*?\{\s*transform:\s*none/);
  assert.match(reducido, /\.btn-primary:active:not\(:disabled\)/);
  assert.match(reducido, /\.opt-chip:active/);
  // La respuesta es corta: transiciones de --pos-dur-press (.1 s).
  assert.match(css, /\.qty-btn,\s*\.menu-item-btn,[\s\S]*?transform var\(--pos-dur-press\)/);
});

test('c3 §6: la cuenta regresiva de deshacer sigue la hora (no es una animación) y dura 15 s', () => {
  const marcado = parte('ola-c-c3 :: avisos', 'html');
  assert.match(marcado, /get fraccion\(\) \{ return Math\.min\(1, this\.resta \/ 15000\); \}/);
  assert.match(marcado, /:style="\{ transform: 'scaleX\(' \+ fraccion \+ '\)' \}"/);
  assert.match(marcado, /init\(\) \{ this\.iv = setInterval/);
  assert.match(marcado, /destroy\(\) \{ clearInterval\(this\.iv\); \}/, 'el reloj se detiene al desmontar el aviso');
  assert.match(sinComentarios(CSS), /\.deshacer-barra-relleno\s*\{[^}]*transition:\s*transform \.25s linear/);
});

test('c3 §6: toda var(--x) del bloque sin respaldo está declarada, y la altura de las acciones del ticket coincide con la del CSS compartido', () => {
  const css = sinComentarios(CSS);
  const declaradas = new Set([...sinComentarios(POS).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const sinDeclarar = [...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]).filter((v) => !declaradas.has(v));
  assert.deepEqual([...new Set(sinDeclarar)], [], `var() sin declarar: ${[...new Set(sinDeclarar)].join(', ')}`);
  // 8.25rem = 52 + 12 + 52 + 2 × 8 px = 132 px = dos botones de --pos-boton-alto (3.25rem) con .75rem entre sí y .5rem arriba y abajo.
  assert.match(css, /--pos-ticket-acciones:\s*8\.25rem/);
  assert.match(POS, /--pos-boton-alto:\s*3\.25rem/);
  assert.match(POS, /\.ticket-acciones\s*\{[^}]*padding-block:\s*\.5rem/);
});

test('c3 §6: «Más» desde 768: el envoltorio desaparece en teléfono y el menú cuelga del botón en tablet y escritorio', () => {
  const css = sinComentarios(CSS);
  assert.match(css, /\.nav-mas-wrap\s*\{\s*display:\s*contents/);
  const desde768 = bloquesMedia(CSS).find((b) => b.condicion === 'screen and (min-width: 768px)' && /\.nav-mas\s*\{/.test(b.cuerpo));
  assert.ok(desde768, 'falta el menú de «Más» desde 768 px con `screen`');
  assert.match(desde768.cuerpo, /\.nav-mas-wrap\s*\{[^}]*position:\s*relative/);
  assert.match(desde768.cuerpo, /\.nav-mas\s*\{[^}]*position:\s*absolute/);
  assert.match(desde768.cuerpo, /\.nav-link-mas\s*\{[^}]*min-width:\s*var\(--pos-tactil\)/, 'el botón de «Más» mide 44 px de ancho');
  // En teléfono sigue siendo la hoja fija de la ola B (con `screen`).
  assert.match(sinComentarios(POS), /@media screen and \(max-width: 767\.98px\)\s*\{\s*\.nav-mas\s*\{[^}]*position:\s*fixed/);
});

// ───────────────────────── 7. arnés ─────────────────────────

test('c3 §7: el arnés trae las vistas de la ola C y fija su estado en el store REAL (el relleno provisional del contrato salió al integrar c2)', async () => {
  const { VISTAS } = await import(path.join(RAIZ, 'scripts/pruebas/_pos-simulado.mjs'));
  const esperadas = ['espera', 'espera-carta', 'espera-eliminado', 'personal-pendientes', 'personal-pendientes-admin', 'personal-pendientes-eliminar',
    'mas-pendientes', 'mas-escritorio', 'mesas-admin', 'mesas-admin-sin-nfc', 'mesas-admin-rotar', 'mesas-admin-editar', 'mesas-admin-agregar',
    'nfc-esperando', 'nfc-ok', 'nfc-error', 'ajustes', 'ajustes-invalido', 'ajustes-sin-qr', 'ticket-pie-ajustado', 'ticket-sin-qr',
    'deshacer-ticket', 'deshacer-mesas-alerta', 'cierre-devolver', 'cierre-devolver-confirma', 'cierre-devolver-abono', 'orden-agregado'];
  for (const v of esperadas) {
    assert.ok(VISTAS[v], `falta la vista «${v}» del arnés`);
    assert.ok(VISTAS[v].descripcion && typeof VISTAS[v].llegar === 'function', `${v}: descripción y llegar()`);
  }
  assert.doesNotMatch(SIMULADO, /rellenarContratoOlaC|instalarContratoOlaC/, 'integrada la lógica de c2, el arnés ya no rellena el store: lo que el marcado usa tiene que existir de verdad');
  assert.match(SIMULADO, /DATOS\.nfc\) window\.NDEFReader/, 'Web NFC se simula pidiéndolo en los datos de la vista');
});

// ───────────────────────── 8. documentación ─────────────────────────

test('c3 §8: docs/pos-visual.md §0.19 dice lo que se decidió (navegación, aprobación, pegatinas, ajustes, deshacer y avisos)', () => {
  const i = DOC.indexOf('### 0.19');
  assert.ok(i !== -1, 'falta «### 0.19» en docs/pos-visual.md');
  const sec = DOC.slice(i, DOC.indexOf('\n---\n', i) === -1 ? undefined : DOC.indexOf('\n---\n', i));
  for (const frase of ['Más', 'Mesas y pegatinas', 'Ajustes', 'Tu cuenta espera aprobación', 'Pendientes', 'Deshacer', 'Paloma', 'qrTicketSvg', 'borrador', 'prefers-reduced-motion', 'rotarTokenMesa']) {
    assert.ok(sec.includes(frase), `§0.19 debería hablar de «${frase}»`);
  }
});
