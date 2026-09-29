// Prueba assets/js/agentes.js (WebMCP) cargando los archivos REALES del sitio
// (local.js, solicitud.js, vivo.js, landing.js, agentes.js) dentro de un contexto `vm`
// de Node, con un `document` falso (un EventTarget de verdad, más un <dialog> falso con
// showModal/close/open) y un `Alpine` falso que reproduce lo mínimo de
// store/data/directive/effect/nextTick que landing.js necesita para armar
// Alpine.store('solicitud') tal cual lo arma la web. Así la prueba corre contra el store
// real (mismo código, mismo getter `armado`), no contra una reimplementación de
// agentes.js. `fetch` también es falso: RESPLANDOR_VIVO lo usa para «leer» Supabase sin
// red real.
//
// Corre con: node --test scripts/pruebas/*.test.mjs   (desde la raíz del repo; sin
// paquetes).
//
// Qué NO prueba este archivo (documentado, no verificado acá):
//   - que document.modelContext exista de verdad en algún Chrome: eso depende del
//     origin trial (Chrome 149–156) o de chrome://flags/#enable-webmcp-testing, no de
//     este repo;
//   - Alpine de verdad (reactividad, `x-if`, el `<dialog>` real del navegador): el
//     `Alpine` y el `document.getElementById('solicitud')` de esta prueba son dobles
//     mínimos, documentados abajo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARCHIVOS = ['assets/js/local.js', 'assets/js/solicitud.js', 'assets/js/vivo.js', 'assets/js/landing.js', 'assets/js/agentes.js'];
const NOMBRES_ESPERADOS = ['abrir_solicitud', 'anotar_solicitud', 'ver_carta', 'ver_local', 'ver_menu_semana', 'ver_solicitud'];

const CARTA_PRUEBA = [
  { categoria: 'Ejecutivos', nombre: 'Menú Resplandor', precio: 23000, descripcion: 'Menú del día' },
  { categoria: 'Bebidas', nombre: 'Agua', precio: 4000, descripcion: 'Botella' },
];
const MENU_FILAS_PRUEBA = [{ id: 'lun-1', semana: '2026-09-21', dia: 1, opcion: 1, etiqueta: '', principal: 'Sancocho', sopa: '', guarnicion: 'Arroz', ensalada: '', jugo: 'Mango', fijo: false }];

// `fetch` falso: distingue carta_publica de menus por un pedazo de la URL; guarda cada
// URL pedida en `llamadas` para que las pruebas puedan revisarla (p. ej. que «categoria»
// nunca llegue ahí).
function fetchFalso(llamadas) {
  return async (url) => {
    llamadas.push(url);
    if (url.includes('carta_publica')) return { ok: true, json: async () => CARTA_PRUEBA };
    if (url.includes('/menus')) return { ok: true, json: async () => MENU_FILAS_PRUEBA };
    throw new Error('fetch no esperado en la prueba: ' + url);
  };
}

// Alpine falso: guarda el objeto de cada store (llamando a su init(), como el Alpine de
// verdad) y lo devuelve cuando lo piden solo por nombre. `data` solo necesita existir
// (landing.js registra 'cartaVivo'/'menuSemana' con Alpine.data, pero nada en esta
// prueba los instancia — no hay HTML con x-data).
function alpineFalso() {
  const stores = new Map();
  return {
    store(nombre, definicion) {
      if (definicion === undefined) return stores.get(nombre);
      stores.set(nombre, definicion);
      if (typeof definicion.init === 'function') definicion.init();
      return definicion;
    },
    data() {},
    directive() {},
    effect(fn) {
      fn();
    },
    nextTick(fn) {
      if (fn) fn();
      return Promise.resolve();
    },
    reactive(x) {
      return x;
    },
  };
}

function dialogoFalso() {
  return {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
}

// Hallazgo R3/N5(a) (ronda 3 de refutación, segunda vuelta): antes, document.querySelector
// devolvía `null` a secas y el <dialog> falso no tenía querySelector — así que un mutante
// que agregara `document.querySelector('#solicitud a[href^="https://wa.me"]')?.click();`
// después de `store.abrir(tipo)` en abrir_solicitud (el agente haciendo clic él mismo en
// el enlace de WhatsApp, en vez de dejar que la persona lo haga) pasaba la suite entera en
// verde: nada podía notar el clic porque no había ningún elemento ahí para hacérselo. Este
// <a> falso SÍ existe (con un href de wa.me, como el real) y sus .click()/.dispatchEvent()
// quedan registrados en `clicks` para que las pruebas de abajo puedan exigir CERO.
function anclaWhatsAppFalsa(clicks) {
  return {
    tagName: 'A',
    href: 'https://wa.me/573225542434?text=prueba',
    getAttribute(nombre) {
      return nombre === 'href' ? this.href : null;
    },
    click() {
      clicks.push({ tipo: 'click' });
    },
    dispatchEvent(evento) {
      clicks.push({ tipo: 'dispatchEvent', evento: evento && evento.type });
      return true;
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

// Arma una «página» nueva: un contexto vm con los cinco scripts reales ya cargados y los
// eventos 'alpine:init' + 'alpine:initialized' ya disparados sobre `document`, igual que
// pasaría en el sitio.
function crearPagina({ conModelContext = true, modelContext, llamadasFetch = [] } = {}) {
  const dialogo = dialogoFalso();
  const clicksWhatsApp = []; // ver anclaWhatsAppFalsa: click()/dispatchEvent() sobre el <a> de wa.me
  const anclaWa = anclaWhatsAppFalsa(clicksWhatsApp);
  // Selector realista pero chico: solo entiende un `href^="..."` sobre algo de wa.me (lo
  // único que agentes.js/landing.html podrían pedir) — cualquier otro selector da null/[],
  // como en cualquier página sin ese elemento.
  const querySelectorFalso = (selector) => (typeof selector === 'string' && /wa\.me/i.test(selector) ? anclaWa : null);
  const querySelectorAllFalso = (selector) => (typeof selector === 'string' && /wa\.me/i.test(selector) ? [anclaWa] : []);

  const document = new EventTarget();
  document.title = '';
  document.documentElement = { classList: { add() {}, remove() {} } };
  document.activeElement = null;
  document.getElementById = (id) => (id === 'solicitud' ? dialogo : null);
  document.querySelector = querySelectorFalso;
  document.querySelectorAll = querySelectorAllFalso;
  document.contains = () => true;
  // El <dialog> real también tiene querySelector/querySelectorAll (agentes.js podría
  // buscar el enlace dentro del propio diálogo, no solo en `document`): mismo <a> falso.
  dialogo.querySelector = querySelectorFalso;
  dialogo.querySelectorAll = querySelectorAllFalso;

  const llamadasRegistro = [];
  if (modelContext) {
    document.modelContext = modelContext;
  } else if (conModelContext) {
    document.modelContext = {
      registerTool(tool) {
        llamadasRegistro.push(tool);
        return Promise.resolve();
      },
    };
  }
  // sin conModelContext y sin modelContext: document.modelContext queda undefined,
  // como en cualquier navegador de hoy sin el origin trial ni el flag.

  const avisos = []; // console.warn del sandbox
  const sandbox = {
    console: { ...console, warn: (...a) => avisos.push(a) },
    document,
    location: { hash: '' },
    history: {},
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => (fn(), 0),
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => (typeof fn === 'function' && fn(), 0),
    clearTimeout: () => {},
    Alpine: alpineFalso(),
    fetch: fetchFalso(llamadasFetch),
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const archivo of ARCHIVOS) {
    const codigo = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    vm.runInContext(codigo, sandbox, { filename: archivo });
  }

  document.dispatchEvent(new Event('alpine:init'));
  document.dispatchEvent(new Event('alpine:initialized'));

  return { sandbox, document, dialogo, llamadasRegistro, avisos, llamadasFetch, clicksWhatsApp };
}

function herramientasPor(sandbox) {
  const lista = sandbox.window.RESPLANDOR_AGENTES?.herramientas ?? [];
  return Object.fromEntries(lista.map((h) => [h.name, h]));
}

test('siempre expone window.RESPLANDOR_AGENTES con las 6 herramientas, y las registra en modelContext', () => {
  const { sandbox, llamadasRegistro } = crearPagina({ conModelContext: true });
  const lista = sandbox.window.RESPLANDOR_AGENTES.herramientas;
  assert.equal(lista.length, 6);

  const nombreValido = /^[A-Za-z0-9_.-]{1,128}$/;
  for (const h of lista) {
    assert.match(h.name, nombreValido, `nombre inválido: ${h.name}`);
    assert.equal(typeof h.description, 'string');
    assert.ok(h.description.length > 0, `${h.name} sin description`);
    assert.equal(typeof h.execute, 'function');
  }
  assert.deepEqual(Array.from(lista, (h) => h.name).sort(), [...NOMBRES_ESPERADOS].sort());

  assert.equal(llamadasRegistro.length, 6);
  assert.deepEqual(llamadasRegistro.map((t) => t.name).sort(), [...NOMBRES_ESPERADOS].sort());

  const porNombre = herramientasPor(sandbox);
  assert.equal(porNombre.ver_local.annotations.readOnlyHint, true);
  assert.equal(porNombre.ver_carta.annotations.readOnlyHint, true);
  assert.equal(porNombre.ver_menu_semana.annotations.readOnlyHint, true);
  assert.equal(porNombre.ver_solicitud.annotations.readOnlyHint, true);
  // El texto de la carta, el menú, la solicitud anotada y lo que ve_solicitud muestra
  // puede venir de la base o de lo que escribió una persona: nunca instrucciones para el
  // agente (contrato (e); hallazgo 20).
  assert.equal(porNombre.ver_carta.annotations.untrustedContentHint, true);
  assert.equal(porNombre.ver_menu_semana.annotations.untrustedContentHint, true);
  assert.equal(porNombre.anotar_solicitud.annotations.untrustedContentHint, true);
  assert.equal(porNombre.ver_solicitud.annotations.untrustedContentHint, true);
});

test('sin document.modelContext no registra nada y no lanza (la página no se rompe)', () => {
  const { sandbox, llamadasRegistro, avisos } = crearPagina({ conModelContext: false });
  assert.equal(llamadasRegistro.length, 0);
  assert.equal(sandbox.window.RESPLANDOR_AGENTES.herramientas.length, 6);
  assert.deepEqual(avisos, []);
});

test('una herramienta que falla al registrarse (throw síncrono) no tumba a las demás', () => {
  const registradas = [];
  const { avisos } = crearPagina({
    modelContext: {
      registerTool(tool) {
        if (tool.name === 'ver_local') throw new Error('registro roto a propósito');
        registradas.push(tool.name);
        return Promise.resolve();
      },
    },
  });
  assert.equal(registradas.length, 5);
  assert.ok(!registradas.includes('ver_local'));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0][0], /\[resplandor\]/);
  assert.match(avisos[0][0], /ver_local/);
});

test('una promesa de registro rechazada (falla async) también queda advertida, no revienta', async () => {
  const { avisos } = crearPagina({
    modelContext: {
      registerTool(tool) {
        return tool.name === 'ver_solicitud' ? Promise.reject(new Error('rechazo async')) : Promise.resolve();
      },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(avisos.length, 1);
  assert.match(avisos[0][0], /ver_solicitud/);
});

test('ver_local trae los datos reales del local (capacidad 30, todo en el local)', async () => {
  const { sandbox } = crearPagina();
  const { ver_local } = herramientasPor(sandbox);
  const r = await ver_local.execute({});
  assert.equal(r.capacidad, 30);
  assert.equal(r.marca, sandbox.window.RESPLANDOR.marca);
  assert.match(r.aviso, /en el restaurante/i);
  // Hallazgo de refutación: nada vigilaba `minimoPersonasEvento` acá — un mutante que
  // borrara esa línea de agentes.js#ver_local pasaba de largo con la suite completa en
  // verde. Dato de Yonatan, 2026-09-28 (eventos/celebraciones/paquetes de 10 a 30).
  assert.equal(r.minimoPersonasEvento, 10);
  assert.equal(r.minimoPersonasEvento, sandbox.window.RESPLANDOR.minimoPersonasEvento);
  assert.match(r.aviso, /10 a 30 personas/);
});

test('ver_carta trae los items reales; el filtro de categoría no llega a la URL de PostgREST', async () => {
  const llamadasFetch = [];
  const { sandbox } = crearPagina({ llamadasFetch });
  const { ver_carta } = herramientasPor(sandbox);

  const todo = await ver_carta.execute({});
  assert.equal(todo.items.length, CARTA_PRUEBA.length);

  const soloBebidas = await ver_carta.execute({ categoria: 'Bebidas' });
  assert.ok(soloBebidas.items.length > 0);
  assert.ok(soloBebidas.items.every((p) => p.categoria === 'Bebidas'));

  assert.ok(llamadasFetch.length >= 2);
  for (const url of llamadasFetch) assert.doesNotMatch(url, /Bebidas/);
});

test('ver_menu_semana trae el menú de la semana en vivo', async () => {
  const { sandbox } = crearPagina();
  const { ver_menu_semana } = herramientasPor(sandbox);
  const r = await ver_menu_semana.execute();
  assert.equal(r.semana, '2026-09-21');
  assert.equal(r.dias.length, MENU_FILAS_PRUEBA.length);
  assert.match(r.aviso, /menu\.html/);
});

test('flujo anotar_solicitud → ver_solicitud da el mismo mensaje que armarSolicitud', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);

  await anotar_solicitud.execute({ tipo: 'reserva', fecha: '2026-10-03', personas: 4, nombre: 'Ana' });
  const solicitud = await ver_solicitud.execute();

  const esperado = sandbox.window.RESPLANDOR_SOLICITUD.armarSolicitud({ tipo: 'reserva', fecha: '2026-10-03', personas: 4, nombre: 'Ana' });
  assert.equal(solicitud.mensaje, esperado.mensaje);
  assert.equal(solicitud.enlace, esperado.enlace);
  assert.match(solicitud.recordatorio, /whatsapp/i);
});

test('anotar_solicitud: personas > 30 no lanza; ver_solicitud muestra el recorte a 30 con aviso', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);
  await anotar_solicitud.execute({ tipo: 'evento-corporativo', personas: 60 });
  const solicitud = await ver_solicitud.execute();
  assert.equal(solicitud.datos.personas, 30);
  assert.ok(solicitud.avisos.some((a) => /capacidad es 30/i.test(a)));
});

// Dato de Yonatan (2026-09-28): eventos/celebraciones/paquetes son de 10 a 30 personas.
// Casos límite exactos (9/31 inválidos, 10/30 válidos) a través del camino completo de un
// agente WebMCP (anotar_solicitud → ver_solicitud), no solo contra armarSolicitud directo.
test('anotar_solicitud: evento con 9 personas no lanza; ver_solicitud muestra el ajuste a 10 con aviso', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);
  await anotar_solicitud.execute({ tipo: 'evento-corporativo', personas: 9 });
  const solicitud = await ver_solicitud.execute();
  assert.equal(solicitud.datos.personas, 10);
  assert.ok(solicitud.avisos.some((a) => /de 10 a 30 personas/i.test(a)));
});

test('anotar_solicitud: evento con 31 personas se recorta a 30 (el tope de capacidad manda sobre el mínimo)', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);
  await anotar_solicitud.execute({ tipo: 'evento-corporativo', personas: 31 });
  const solicitud = await ver_solicitud.execute();
  assert.equal(solicitud.datos.personas, 30);
  assert.ok(solicitud.avisos.some((a) => /capacidad es 30/i.test(a)));
});

test('anotar_solicitud: evento con 10 o 30 (límites exactos) es válido, sin aviso', async () => {
  for (const personas of [10, 30]) {
    const { sandbox } = crearPagina();
    const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);
    await anotar_solicitud.execute({ tipo: 'evento-corporativo', personas });
    const solicitud = await ver_solicitud.execute();
    assert.equal(solicitud.datos.personas, personas);
    // Array.from: `avisos` es un arreglo del realm del vm (gotcha conocido de node:vm — ver
    // el comentario largo sobre esto en el escenario B más arriba).
    assert.deepEqual(Array.from(solicitud.avisos), []);
  }
});

test('anotar_solicitud: una mesa (reserva) con 2 personas es válida, sin aviso de mínimo (no es un evento)', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);
  await anotar_solicitud.execute({ tipo: 'reserva', personas: 2 });
  const solicitud = await ver_solicitud.execute();
  assert.equal(solicitud.datos.personas, 2);
  assert.deepEqual(Array.from(solicitud.avisos), []);
});

// Hallazgo N1 (rondas 2 y 3 de refutación, cerrado dos veces desde direcciones opuestas —
// ver el comentario largo sobre estadoSolicitud() en assets/js/agentes.js):
//   - Antes de la ronda 3: ver_solicitud salía de `store.armado` (el getter de landing.js,
//     que filtra entrega/dirección/frecuencia cuando el tipo no es «almuerzo») y se
//     quedaba mudo aunque un agente pidiera domicilio DE VERDAD en esa misma llamada de
//     anotar_solicitud, mientras que mcp/worker.mjs (armarSolicitud directo) sí avisaba.
//   - El cierre de la ronda 3 pasó al otro extremo: estadoSolicitud() llamaba a
//     armarSolicitud(store.datos) SIEMPRE, sin filtro — una entrega que quedó de una
//     elección anterior de almuerzo seguía viva en store.datos, así que ver_solicitud
//     avisaba «se ignoró la entrega» aunque NADIE pidió domicilio para esa reserva, y la
//     vista previa del propio formulario (store.armado) no mostraba nada.
// Ahora: ver_solicitud SIEMPRE refleja store.armado (lo mismo que ve la persona);
// anotar_solicitud arma SIN el filtro (avisando de verdad) solo cuando la entrega vino en
// ESA MISMA llamada. Escenarios A/B/C tal como los armó refutar/n1_estado.mjs.
test('N1 escenario A: domicilio elegido en almuerzo y luego cambiado a reserva no deja un aviso falso en ver_solicitud (coincide con la vista previa del formulario)', async () => {
  const { sandbox } = crearPagina();
  const { ver_solicitud } = herramientasPor(sandbox);
  const store = sandbox.Alpine.store('solicitud');
  store.abrir('almuerzo');
  store.datos.entrega = 'domicilio';
  store.datos.direccion = 'Cra 1';
  store.datos.tipo = 'reserva'; // la persona cambió de opinión: ahora es una reserva
  const vista = store.armado; // lo que ve la persona en el <dialog>
  const agente = await ver_solicitud.execute();
  assert.equal(vista.avisos.length, 0, 'nadie pidió domicilio para esta reserva: la vista previa no debería avisar nada');
  assert.deepEqual(Array.from(agente.avisos), Array.from(vista.avisos), 'ver_solicitud debe coincidir EXACTO con la vista previa del formulario');
  assert.equal(agente.mensaje, vista.mensaje);
});

test('N1 escenario B: anotar_solicitud avisa en el momento en que de verdad pide domicilio fuera de almuerzo, pero no arrastra ese aviso a una llamada posterior que ya no lo pide', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud } = herramientasPor(sandbox);
  const r1 = await anotar_solicitud.execute({ tipo: 'almuerzo', entrega: 'domicilio', direccion: 'Cra 1' });
  assert.deepEqual(Array.from(r1.avisos), [], 'domicilio en almuerzo es válido: sin aviso');
  const r2 = await anotar_solicitud.execute({ tipo: 'cena-romantica' }); // no vuelve a pedir domicilio
  assert.deepEqual(Array.from(r2.avisos), [], 'no debería heredar el aviso de una entrega vieja que esta llamada no volvió a pedir');
});

test('N1 escenario B (variante): anotar_solicitud SÍ avisa cuando la MISMA llamada pide domicilio en un tipo que no es almuerzo (paridad con el Worker)', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud } = herramientasPor(sandbox);
  const r = await anotar_solicitud.execute({ tipo: 'cena-romantica', entrega: 'domicilio', direccion: 'Calle 1' });
  assert.equal(r.datos.entrega, null); // la entrega no aplica: no se cuela en los datos de una cena-romántica
  assert.ok(r.avisos.some((a) => /solo en el local/i.test(a)), 'debería avisar: esta llamada sí pidió domicilio fuera de almuerzo');

  // La misma entrada, armada directo con RESPLANDOR_SOLICITUD.armarSolicitud (lo que usa
  // el Worker, sin estado), tiene que dar EXACTAMENTE los mismos avisos — no una
  // aproximación por regex. Array.from copia del realm del vm al de este archivo (gotcha
  // conocido de node:vm: comparar arreglos de dos realms distintos con deepEqual falla
  // aunque el contenido sea idéntico).
  const esperado = sandbox.window.RESPLANDOR_SOLICITUD.armarSolicitud({ tipo: 'cena-romantica', entrega: 'domicilio', direccion: 'Calle 1' });
  assert.deepEqual(Array.from(r.avisos), Array.from(esperado.avisos));
});

test('N1 escenario C: el Worker, sin estado, con la entrada final del escenario B (sin domicilio) tampoco avisa — paridad completa', () => {
  const { sandbox } = crearPagina();
  const S = sandbox.window.RESPLANDOR_SOLICITUD;
  const sinAviso = S.armarSolicitud({ tipo: 'cena-romantica' });
  assert.deepEqual(Array.from(sinAviso.avisos), []);
});

// Dato de Yonatan (2026-09-28): el campo «Personas» del <dialog> (landing.html) usa
// store.personasMin/personasEtiqueta para el atributo `min` y la etiqueta — se prueban acá
// directo contra el store real (mismo código que landing.js registra), sin depender de un
// DOM/Alpine reactivo de verdad.
test('store.personasMin y personasEtiqueta: 1/"hasta 30" para reserva y almuerzo, 10/"de 10 a 30" para cualquier otro tipo', () => {
  const { sandbox } = crearPagina();
  const store = sandbox.Alpine.store('solicitud');
  for (const tipo of ['reserva', 'almuerzo']) {
    store.datos.tipo = tipo;
    assert.equal(store.personasMin, 1, `tipo ${tipo} debería tener personasMin 1`);
    assert.equal(store.personasEtiqueta, 'Personas (hasta 30)', `tipo ${tipo} debería mostrar "hasta 30"`);
  }
  for (const tipo of sandbox.window.RESPLANDOR.tipos.map((t) => t.id)) {
    if (tipo === 'reserva' || tipo === 'almuerzo') continue;
    store.datos.tipo = tipo;
    assert.equal(store.personasMin, 10, `tipo ${tipo} debería tener personasMin 10`);
    assert.equal(store.personasEtiqueta, 'Personas (de 10 a 30)', `tipo ${tipo} debería mostrar "de 10 a 30"`);
  }
});

// Hallazgo de refutación: `datos.tipo` empieza en '' (el <option> «Elige una opción…», antes
// de que la persona elija algo) — y esTipoEvento('') daba `true` (solo excluye 'reserva' y
// 'almuerzo'), así que el campo mostraba «de 10 a 30» y el placeholder «Ej.: 6» ANTES de
// cualquier elección. minimoPersonasPara exige además que el valor ya sea un tipo real de
// TIPOS: '' y un tipo inválido no son una elección explícita, así que no heredan el mínimo.
test('store.personasMin/personasEtiqueta/personasAyuda/personasEjemplo: sin elegir tipo (\'\'), o con un tipo inválido, es 1/"hasta 30"/sin mínimo — nunca 10 antes de elegir', () => {
  const { sandbox } = crearPagina();
  const store = sandbox.Alpine.store('solicitud');
  for (const tipo of ['', 'boda-en-la-playa']) {
    store.datos.tipo = tipo;
    assert.equal(store.personasMin, 1, `tipo «${tipo}» debería tener personasMin 1 (nadie eligió un evento)`);
    assert.equal(store.personasEtiqueta, 'Personas (hasta 30)');
    assert.equal(store.personasAyuda, 'Sin mínimo: hasta 30 personas.');
    assert.equal(store.personasEjemplo, '6');
  }
  // Elegir «otra» A PROPÓSITO (el <option> «Otra celebración») sigue exigiendo el mínimo:
  // solo la AUSENCIA de una elección (o una inválida) queda exenta.
  store.datos.tipo = 'otra';
  assert.equal(store.personasMin, 10);
  assert.equal(store.personasEtiqueta, 'Personas (de 10 a 30)');
  assert.equal(store.personasAyuda, 'Eventos, celebraciones y paquetes: de 10 a 30 personas.');
  assert.equal(store.personasEjemplo, '10');
});

test('store.abrir("reserva") sin tocar nada más no da avisos falsos (entrega:"recoger" por defecto no cuenta fuera de almuerzo)', () => {
  const { sandbox } = crearPagina();
  const store = sandbox.Alpine.store('solicitud');
  store.abrir('reserva');
  assert.equal(store.armado.avisos.length, 0);
});

test('anotar_solicitud: almuerzo a domicilio sin dirección no lanza; ver_solicitud avisa que falta', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);
  await anotar_solicitud.execute({ tipo: 'almuerzo', entrega: 'domicilio' });
  const solicitud = await ver_solicitud.execute();
  assert.ok(solicitud.avisos.some((a) => /falta la dirección/i.test(a)));
});

test('ver_solicitud nunca menciona USDC ni pide pagar: acá no hay pagos', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);
  await anotar_solicitud.execute({ tipo: 'reserva' });
  const solicitud = await ver_solicitud.execute();
  assert.doesNotMatch(solicitud.recordatorio, /usdc/i);
  assert.doesNotMatch(JSON.stringify(solicitud), /usdc/i);
});

// Hallazgo N5(a) (ronda 3 de refutación, cerrado dos veces): esta prueba solo miraba
// `dialogo.open`/`r.abierto` — un mutante que, además de showModal(), hiciera
// `window.open(store.armado.enlace)` (o navegara con `location.href =`/
// `location.assign(...)`) para «adelantar» la solicitud pasaba en verde igual, porque nada
// acá vigilaba esas llamadas. Ese primer cierre agregó open/location/fetch vigilados, pero
// dejó un hueco (hallazgo R3 de la SEGUNDA ronda de refutación sobre esto): un mutante que
// hiciera `document.querySelector('#solicitud a[href^="https://wa.me"]')?.click();` (el
// agente haciendo clic él mismo en el enlace, en vez de la persona) pasaba la suite entera
// en 144/144 verde, porque `document.querySelector` devolvía `null` y el <dialog> falso ni
// tenía querySelector — no había ELEMENTO ahí para hacerle clic. Ahora `anclaWhatsAppFalsa`
// (ver arriba) SÍ existe con ese selector, y se exige CERO clicks/dispatchEvent sobre ella,
// además de open/location/fetch en cero. Mutante probado a mano y confirmado que hace
// fallar la suite (ver «pruebas» en la entrega, y la segunda red de abajo, que falla si
// agentes.js contiene «.click(»/«dispatchEvent(» en el código fuente).
test('abrir_solicitud abre el <dialog> real del store (solo showModal): nunca abre/navega/hace clic en el enlace de WhatsApp', async () => {
  const llamadasFetch = [];
  const { sandbox, dialogo, clicksWhatsApp } = crearPagina({ llamadasFetch });
  const prohibidas = [];
  sandbox.window.open = (...args) => {
    prohibidas.push(['open', String(args[0])]);
    return null;
  };
  sandbox.location.assign = (...args) => prohibidas.push(['location.assign', String(args[0])]);
  Object.defineProperty(sandbox.location, 'href', {
    configurable: true,
    get: () => '',
    set: (v) => prohibidas.push(['location.href', String(v)]),
  });

  const { abrir_solicitud } = herramientasPor(sandbox);
  assert.equal(dialogo.open, false);
  const r = await abrir_solicitud.execute({ tipo: 'reserva' });
  assert.equal(r.abierto, true);
  assert.equal(dialogo.open, true);
  assert.equal(sandbox.Alpine.store('solicitud').datos.tipo, 'reserva');

  assert.deepEqual(prohibidas, [], 'abrir_solicitud no debería abrir/navegar el enlace de WhatsApp por su cuenta');
  assert.deepEqual(llamadasFetch, [], 'abrir_solicitud no debería llamar a fetch (ni al enlace de wa.me ni a ningún otro lado)');
  assert.deepEqual(clicksWhatsApp, [], 'abrir_solicitud no debería hacer clic (ni dispatchEvent) sobre el enlace de WhatsApp por su cuenta');
});

// Segunda red (R3): ni siquiera hace falta ejecutar nada — si agentes.js alguna vez
// contiene «.click(» o «dispatchEvent(», es una señal de que algún camino podría estar
// tocando un elemento por su cuenta (el enlace de WhatsApp u otro). El agente arma la
// solicitud; la PERSONA hace clic. Esta prueba de texto es la segunda red que pidió R3
// además del arnés de arriba (que ya ejercita el camino real con el <a> falso).
test('agentes.js nunca llama a .click() ni a dispatchEvent(): ningún camino toca un elemento por su cuenta', async () => {
  const codigoAgentes = fs.readFileSync(path.join(RAIZ, 'assets/js/agentes.js'), 'utf8');
  assert.ok(!codigoAgentes.includes('.click('), 'agentes.js no debería llamar a .click() en ningún elemento (regla dura: hace clic la persona, no el agente)');
  assert.ok(!codigoAgentes.includes('dispatchEvent('), 'agentes.js no debería usar dispatchEvent() para simular una interacción');
});

test('cerrar() del store devuelve el foco a quien abrió', async () => {
  const { sandbox, document, dialogo } = crearPagina();
  const foco = { focus_llamado: false, focus() { this.focus_llamado = true; } };
  document.activeElement = foco;
  const store = sandbox.Alpine.store('solicitud');
  store.abrir('reserva');
  assert.equal(dialogo.open, true);
  store.cerrar();
  assert.equal(dialogo.open, false);
  assert.equal(foco.focus_llamado, true);
});

test('entradas inválidas lanzan Error en español, y no dejan el store a medio cambiar', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, abrir_solicitud } = herramientasPor(sandbox);

  await assert.rejects(() => anotar_solicitud.execute({ tipo: 'boda-en-la-playa' }), /no existe/i);
  await assert.rejects(() => anotar_solicitud.execute({ personas: 0 }), /entero/i);
  await assert.rejects(() => anotar_solicitud.execute({ personas: 1.5 }), /entero/i);
  await assert.rejects(() => anotar_solicitud.execute({ entrega: 'volando' }), /no existe/i);
  await assert.rejects(() => anotar_solicitud.execute({ frecuencia: 'mensual' }), /no existe/i);
  await assert.rejects(() => anotar_solicitud.execute({ nota: 42 }), /texto/i);
  assert.equal(sandbox.Alpine.store('solicitud').datos.tipo, ''); // ninguna entrada inválida tocó el store

  await assert.rejects(() => abrir_solicitud.execute({ tipo: 'no-existe' }), /no existe/i);
});

// Hallazgo: antes, cada campo se aplicaba al store apenas se validaba, así que
// {tipo:'almuerzo', personas:0} dejaba «tipo» ya cambiado a 'almuerzo' aunque «personas»
// rechazara la llamada entera. Ahora se valida TODO primero (en `cambios`) y se aplica de
// una sola vez: si algo falla, el store queda EXACTAMENTE como estaba antes de llamar.
test('anotar_solicitud con varios campos, uno inválido: no deja ningún campo a medio cambiar (atómico)', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud } = herramientasPor(sandbox);
  const store = sandbox.Alpine.store('solicitud');

  // `store.datos` vive en el realm del vm: se compara como texto (JSON.stringify da un
  // string del realm de ESTE archivo, sin el gotcha de node:vm con deepEqual entre
  // objetos/arreglos de dos realms distintos).
  const antes1 = JSON.stringify(store.datos);
  await assert.rejects(() => anotar_solicitud.execute({ tipo: 'almuerzo', personas: 0 }), /entero/i);
  assert.equal(JSON.stringify(store.datos), antes1, 'tipo no debería haber cambiado a "almuerzo" si personas fue rechazado');

  const antes2 = JSON.stringify(store.datos);
  await assert.rejects(() => anotar_solicitud.execute({ nombre: 'Ana', nota: 42 }), /texto/i);
  assert.equal(JSON.stringify(store.datos), antes2, 'nombre no debería haber quedado anotado si nota fue rechazada');
});

// Hallazgo N8(b) (ronda 3 de refutación): agentes.js:166 (aprox.) truncaba con
// `entrada[campo].slice(0, S.MAX_TEXTO)` — por UNIDADES UTF-16, no por punto de código.
// Un emoji astral (par de surrogates, como 😀) que cayera justo en el límite quedaba
// partido a la mitad: un surrogate alto suelto en store.datos. Ahora usa
// S.recortarTexto (solicitud.js: por grafema con Intl.Segmenter, o por punto de código si
// no está disponible) — la MISMA función que usan los topes de solicitud.js.
test('anotar_solicitud trunca por grafema/punto de código al llegar a MAX_TEXTO: nunca corta un emoji por la mitad', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud } = herramientasPor(sandbox);
  const S = sandbox.window.RESPLANDOR_SOLICITUD;
  // El emoji cae exactamente en el límite en UNIDADES UTF-16 (299 'a' + 2 unidades del
  // emoji = 301; slice(0,300) por UTF-16 corta justo la mitad del emoji).
  const nombre = 'a'.repeat(S.MAX_TEXTO - 1) + '😀' + 'b'.repeat(10);
  await anotar_solicitud.execute({ nombre });
  const guardado = sandbox.Alpine.store('solicitud').datos.nombre;
  assert.ok(!/[\uD800-\uDBFF]$/.test(guardado), `no debería terminar en un surrogate alto suelto (emoji cortado a la mitad): ${JSON.stringify(guardado.slice(-4))}`);
  assert.ok(!/^[\uDC00-\uDFFF]/.test(guardado.slice(S.MAX_TEXTO - 1)), 'tampoco un surrogate bajo suelto al principio del resto');
});

// Hallazgo N5(b) (ronda 3): la prueba combinada de más abajo («ejecutando las 6
// herramientas de verdad») solo ejercita anotar_solicitud con tipo «reserva» y
// abrir_solicitud con tipo «almuerzo» — un mutante que hiciera fetch(enlace) SOLO para
// otro tipo puntual (p. ej. una «fiesta-quince» con nota larga) pasaba de largo. Acá se
// repite el mismo chequeo (fetch con lista blanca, sin wa.me/rpc//functions/) para TODOS
// los tipos de RESPLANDOR.tipos, vía anotar_solicitud → ver_solicitud → abrir_solicitud.
test('ninguna herramienta hace fetch del enlace de WhatsApp para NINGÚN tipo de solicitud (todos los de RESPLANDOR.tipos)', async () => {
  const llamadasFetch = [];
  const { sandbox } = crearPagina({ llamadasFetch });
  const { anotar_solicitud, ver_solicitud, abrir_solicitud } = herramientasPor(sandbox);
  const R = sandbox.window.RESPLANDOR;

  for (const tipo of R.tipos.map((t) => t.id)) {
    await anotar_solicitud.execute({ tipo, personas: 3, nombre: 'Ana', nota: 'una nota cualquiera', entrega: 'domicilio', direccion: 'Calle 1' });
    await ver_solicitud.execute();
    await abrir_solicitud.execute({ tipo });
  }

  assert.ok(llamadasFetch.length >= 0); // esta ronda de tipos no toca Supabase: lo que importa es la lista blanca de abajo
  for (const url of llamadasFetch) {
    assert.doesNotMatch(url, /wa\.me/i, `se pidió wa.me para algún tipo: ${url}`);
    assert.doesNotMatch(url, /\/rpc\//i);
    assert.doesNotMatch(url, /\/functions\//i);
  }
});

// Antes esta prueba era una regex sobre el texto de agentes.js/landing.js: pasaba en
// verde con código que abriera wa.me por una variable (`window.open(store.armado.enlace)`)
// o que llamara a rpc/votar, porque la cadena literal «wa.me» no aparecía en el fetch/open
// en sí. Ahora se EJECUTAN las 6 herramientas de verdad, con `window.open`/
// `location.assign`/el setter de `location.href` vigilados (fallan si se llaman) y
// `fetch` con lista blanca: solo Supabase (carta_publica/menus). Ver hallazgo de
// refutación sobre mcp.test.mjs/webmcp.test.mjs (las mismas mutaciones que engañaban la
// regex del Worker engañaban esta también).
test('ejecutando las 6 herramientas de verdad: ninguna llama a wa.me/votar/cuenta (fetch, open, location y clicks vigilados)', async () => {
  const llamadasFetch = [];
  const { sandbox, clicksWhatsApp } = crearPagina({ llamadasFetch });

  const prohibidas = [];
  sandbox.window.open = (...args) => {
    prohibidas.push(['open', String(args[0])]);
    return null;
  };
  sandbox.location.assign = (...args) => {
    prohibidas.push(['location.assign', String(args[0])]);
  };
  Object.defineProperty(sandbox.location, 'href', {
    configurable: true,
    get() {
      return '';
    },
    set(v) {
      prohibidas.push(['location.href', String(v)]);
    },
  });

  const h = herramientasPor(sandbox);
  await h.ver_local.execute({});
  await h.ver_carta.execute({});
  await h.ver_menu_semana.execute();
  await h.anotar_solicitud.execute({ tipo: 'reserva', personas: 2, nombre: 'Ana' });
  await h.ver_solicitud.execute();
  await h.abrir_solicitud.execute({ tipo: 'almuerzo' });

  assert.deepEqual(prohibidas, [], 'alguna herramienta llamó a open/location por su cuenta');
  assert.deepEqual(clicksWhatsApp, [], 'alguna herramienta hizo clic (o dispatchEvent) en el enlace de WhatsApp por su cuenta');
  assert.ok(llamadasFetch.length > 0, 'ninguna herramienta llamó a fetch (revisar que ver_carta/ver_menu_semana lean en vivo)');
  for (const url of llamadasFetch) {
    assert.doesNotMatch(url, /wa\.me/i);
    assert.doesNotMatch(url, /\/rpc\//i);
    assert.doesNotMatch(url, /\/functions\//i);
    assert.ok(url.includes('carta_publica') || url.includes('/menus'), `URL de fetch inesperada: ${url}`);
  }

  // «wa.me», «votar» y «cuenta» SÍ pueden aparecer en comentarios/avisos (describiendo
  // que la persona abre wa.me, o que la votación pasa en menu.html) — eso no es la
  // llamada real que esta prueba vigila arriba.
  const codigoAgentes = fs.readFileSync(path.join(RAIZ, 'assets/js/agentes.js'), 'utf8');
  assert.ok(!codigoAgentes.includes('.invoke('), 'no debería invocar ninguna Edge Function (votar/cuenta)');
});
