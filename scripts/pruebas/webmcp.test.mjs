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

// Arma una «página» nueva: un contexto vm con los cinco scripts reales ya cargados y los
// eventos 'alpine:init' + 'alpine:initialized' ya disparados sobre `document`, igual que
// pasaría en el sitio.
function crearPagina({ conModelContext = true, modelContext, llamadasFetch = [] } = {}) {
  const dialogo = dialogoFalso();
  const document = new EventTarget();
  document.title = '';
  document.documentElement = { classList: { add() {}, remove() {} } };
  document.activeElement = null;
  document.getElementById = (id) => (id === 'solicitud' ? dialogo : null);
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.contains = () => true;

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

  return { sandbox, document, dialogo, llamadasRegistro, avisos, llamadasFetch };
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

test('anotar_solicitud: entrega a domicilio en un tipo que no es almuerzo no lanza; el store la descarta sin aviso (el getter armado solo pasa entrega/dirección/frecuencia cuando tipo===almuerzo)', async () => {
  const { sandbox } = crearPagina();
  const { anotar_solicitud, ver_solicitud } = herramientasPor(sandbox);
  await anotar_solicitud.execute({ tipo: 'fiesta-quince', entrega: 'domicilio', direccion: 'Calle 1' });
  const solicitud = await ver_solicitud.execute();
  assert.equal(solicitud.datos.entrega, null);
  // Los arreglos que salen del vm son de OTRO realm que este archivo: deepEqual contra un
  // [] literal de acá falla con «same structure but not reference-equal» aunque el
  // contenido sea idéntico (gotcha conocido de node:vm) — por eso se compara el largo.
  assert.equal(solicitud.avisos.length, 0);
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

test('abrir_solicitud abre el <dialog> real del store, y anota el tipo si se da', async () => {
  const { sandbox, dialogo } = crearPagina();
  const { abrir_solicitud } = herramientasPor(sandbox);
  assert.equal(dialogo.open, false);
  const r = await abrir_solicitud.execute({ tipo: 'reserva' });
  assert.equal(r.abierto, true);
  assert.equal(dialogo.open, true);
  assert.equal(sandbox.Alpine.store('solicitud').datos.tipo, 'reserva');
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

// Antes esta prueba era una regex sobre el texto de agentes.js/landing.js: pasaba en
// verde con código que abriera wa.me por una variable (`window.open(store.armado.enlace)`)
// o que llamara a rpc/votar, porque la cadena literal «wa.me» no aparecía en el fetch/open
// en sí. Ahora se EJECUTAN las 6 herramientas de verdad, con `window.open`/
// `location.assign`/el setter de `location.href` vigilados (fallan si se llaman) y
// `fetch` con lista blanca: solo Supabase (carta_publica/menus). Ver hallazgo de
// refutación sobre mcp.test.mjs/webmcp.test.mjs (las mismas mutaciones que engañaban la
// regex del Worker engañaban esta también).
test('ejecutando las 6 herramientas de verdad: ninguna llama a wa.me/votar/cuenta (fetch, open y location vigilados)', async () => {
  const llamadasFetch = [];
  const { sandbox } = crearPagina({ llamadasFetch });

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
