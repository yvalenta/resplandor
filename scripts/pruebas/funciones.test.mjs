// Banderas de funciones (RESPLANDOR.funciones, assets/js/local.js) — decisión de Yonatan,
// 2026-09-29: mientras Supabase responde 402, el menú de hoy y el almuerzo programado se apagan
// por completo, y la carta se ve igual (con su fecha) cuando la carta en vivo no carga.
//
// Qué se prueba acá, en las cuatro combinaciones de banderas:
//   1. Estructura de las páginas: con la bandera apagada, la función no está en index.html,
//      carta.html ni menu.html fuera de un <template x-if="…bandera…"> (Alpine no pinta lo que
//      no se cumple: la sección no existe, sus enlaces del menú, del pie y de las preguntas
//      tampoco, y no llama a Supabase).
//   2. Los scripts del navegador (local, solicitud, vivo, carta-respaldo, landing, agentes)
//      corridos de verdad en un `vm`: herramientas WebMCP, componentes Alpine registrados, tipos de
//      solicitud y CERO llamadas a Supabase del menú con la función apagada.
//   3. El MCP remoto (mcp/worker.mjs): tools/list, llamadas y `reglasDesactualizadas`.
//   4. Todo lo generado (llms.txt, local.json, sitemap.xml, JSON-LD, server-card, páginas de
//      texto, skills…): ni una mención de una función apagada; las menciones de siempre con ella
//      encendida. Y el ida y vuelta: apagar → encender regenera lo mismo, byte a byte.
//   5. La carta con Supabase caído: se ve la instantánea con su fecha, sin caja de error, en la
//      landing y en carta.html — y de una única fuente (assets/js/carta-respaldo.js).
//
// El repo real queda con las banderas que diga su local.js; estas pruebas NO suponen cuáles son:
// cada verificación del repo real lee sus banderas y espera lo que corresponde, así que la suite
// sigue verde después de encender una función y regenerar (lo que pide el contrato). Las
// combinaciones que no son las del repo se prueban en sitios de prueba temporales
// (scripts/pruebas/_sitio.mjs): copias con las banderas cambiadas de la misma manera que las
// cambiaría una persona.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { RAIZ_REAL, TODAS_APAGADAS, TODAS_ENCENDIDAS, crearSitio } from './_sitio.mjs';

const COMBINACIONES = [
  { nombre: 'todo apagado', funciones: TODAS_APAGADAS },
  { nombre: 'todo encendido', funciones: TODAS_ENCENDIDAS },
  { nombre: 'solo menuDeHoy', funciones: { menuDeHoy: true, almuerzoProgramado: false } },
  { nombre: 'solo almuerzoProgramado', funciones: { menuDeHoy: false, almuerzoProgramado: true } },
];

const leerReal = (rel) => fs.readFileSync(path.join(RAIZ_REAL, rel), 'utf8');
const plano = (x) => JSON.parse(JSON.stringify(x)); // trae a este realm lo que salió de un `vm`

// Las banderas del repo REAL, leídas ejecutando su local.js en un contexto aparte (sin tocar los
// globales de este proceso).
function funcionesDelRepo() {
  const caja = { console };
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leerReal('assets/js/local.js'), caja, { filename: 'assets/js/local.js' });
  return plano(caja.RESPLANDOR.funciones);
}
const FUNCIONES_REAL = funcionesDelRepo();

// ───────────────────────── 0. las banderas mismas ─────────────────────────

test('las banderas viven en UN solo lugar (assets/js/local.js): exactamente menuDeHoy, almuerzoProgramado y pagarEnMesa, booleanas', () => {
  assert.deepEqual(Object.keys(FUNCIONES_REAL).sort(), ['almuerzoProgramado', 'menuDeHoy', 'pagarEnMesa']);
  for (const [nombre, valor] of Object.entries(FUNCIONES_REAL)) assert.equal(typeof valor, 'boolean', `${nombre} debe ser true o false`);
  // Y el comentario junto a ellas dice cómo re-encender (lo primero que lee quien las busca).
  const local = leerReal('assets/js/local.js');
  const bloque = local.slice(local.indexOf('Funciones que se pueden apagar'), local.indexOf('const FUNCIONES'));
  assert.match(bloque, /RE-ENCENDER/);
  assert.match(bloque, /node scripts\/descubrimiento\.mjs/);
  assert.match(bloque, /--comprobar/);
});

test('el sitio de prueba cambia las banderas como lo haría una persona: `false` → `true` en local.js, y solo eso', () => {
  const apagado = crearSitio(TODAS_APAGADAS).leer('assets/js/local.js');
  const encendido = crearSitio(TODAS_ENCENDIDAS).leer('assets/js/local.js');
  const lineasDistintas = apagado.split('\n').flatMap((l, i) => (l === encendido.split('\n')[i] ? [] : [`${l.trim()} → ${encendido.split('\n')[i].trim()}`]));
  assert.deepEqual(lineasDistintas, ['menuDeHoy: false, → menuDeHoy: true,', 'almuerzoProgramado: false, → almuerzoProgramado: true,']);
});

// ───────────────────────── 1. estructura de las páginas ─────────────────────────

const sinComentariosNiJsonLd = (html) =>
  html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
const sinScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

/** Quita cada <template x-if="…"> cuya condición cumpla `coincide`, con sus <template> anidados. */
function quitarPlantillas(html, coincide) {
  let salida = '';
  let i = 0;
  const reAbre = /<template\b[^>]*>/g;
  for (;;) {
    reAbre.lastIndex = i;
    const m = reAbre.exec(html);
    if (!m) return salida + html.slice(i);
    const cond = m[0].match(/\bx-if="([^"]*)"/);
    if (!cond || !coincide(cond[1])) {
      salida += html.slice(i, m.index + m[0].length);
      i = m.index + m[0].length;
      continue;
    }
    let profundidad = 1;
    const re = /<template\b[^>]*>|<\/template>/g;
    re.lastIndex = m.index + m[0].length;
    let t;
    while ((t = re.exec(html))) {
      profundidad += t[0].startsWith('</') ? -1 : 1;
      if (profundidad === 0) break;
    }
    assert.equal(profundidad, 0, `un <template x-if="${cond[1]}"> no cierra`);
    salida += html.slice(i, m.index);
    i = re.lastIndex;
  }
}

const usaBandera = (bandera) => (cond) => new RegExp(`RESPLANDOR\\.funciones\\.${bandera}\\b`).test(cond);

// Lo que solo puede existir con la función encendida. Se busca en el HTML SIN los <template> de
// su propia bandera, sin comentarios y sin el JSON-LD (que es generado y se prueba en la sección 4).
const RASTROS_EN_LANDING = {
  menuDeHoy: [/id="hoy"/, /href="#hoy"/, /menuSemana/, /menu\.html/, /Menú de hoy/i, /menú de la semana/i, /la gente vota/i, /semana completa/i],
  almuerzoProgramado: [/id="almuerzo-programado"/, /href="#almuerzo-programado"/, /almuerzo programado/i, /Programar mi almuerzo/i, /'almuerzo'/, /domicilio/i],
};

for (const [bandera, rastros] of Object.entries(RASTROS_EN_LANDING)) {
  test(`index.html: todo lo de «${bandera}» (sección, enlaces del menú de escritorio y móvil, CTA, pie, preguntas) va dentro de un <template x-if="RESPLANDOR.funciones.${bandera}">`, () => {
    const html = sinComentariosNiJsonLd(leerReal('index.html'));
    const visible = quitarPlantillas(html, usaBandera(bandera));
    const halladas = rastros.filter((re) => re.test(visible)).map(String);
    assert.deepEqual(halladas, [], `con «${bandera}» apagada, index.html aún nombra: ${halladas.join(' ')}`);
    // ...y las plantillas existen y guardan lo que tienen que guardar (no basta con borrar el texto).
    const plantillas = html.match(new RegExp(`<template\\b[^>]*x-if="[^"]*RESPLANDOR\\.funciones\\.${bandera}\\b[^"]*"`, 'g')) || [];
    assert.ok(plantillas.length >= 4, `se esperaban al menos 4 <template x-if> de «${bandera}» (sección, menú de escritorio, menú móvil, …), hay ${plantillas.length}`);
  });
}

test('index.html: la sección #hoy y la sección #almuerzo-programado son un <template x-if> con la sección como ÚNICO elemento raíz (Alpine solo clona el primero)', () => {
  const html = leerReal('index.html');
  for (const [bandera, id] of [['menuDeHoy', 'hoy'], ['almuerzoProgramado', 'almuerzo-programado']]) {
    const m = html.match(new RegExp(`<template\\b[^>]*x-if="RESPLANDOR\\.funciones\\.${bandera}"[^>]*>\\s*<section id="${id}"`));
    assert.ok(m, `#${id} tiene que ser el primer elemento de su <template x-if="RESPLANDOR.funciones.${bandera}">`);
  }
});

test('index.html: #hoy no se inicializa fuera de su plantilla — el único x-data="menuSemana()" está dentro del <template> de menuDeHoy (apagada, no llama a Supabase)', () => {
  const html = sinComentariosNiJsonLd(leerReal('index.html'));
  assert.equal((html.match(/menuSemana\(\)/g) || []).length, 1);
  assert.doesNotMatch(quitarPlantillas(html, usaBandera('menuDeHoy')), /menuSemana|\.init\(\)\s*"[^>]*hoy/);
});

test('las tres páginas solo nombran banderas que existen (un typo en `RESPLANDOR.funciones.menuDeHoi` apagaría algo en silencio)', () => {
  for (const pagina of ['index.html', 'carta.html', 'menu.html']) {
    const usadas = new Set([...leerReal(pagina).matchAll(/RESPLANDOR\.funciones\.(\w+)/g)].map((m) => m[1]));
    for (const nombre of usadas) assert.ok(nombre in FUNCIONES_REAL, `${pagina} usa RESPLANDOR.funciones.${nombre}, que no existe en local.js`);
  }
});

test('carta.html: sin menuDeHoy no enlaza el menú semanal (ni la tarjeta del día, ni la barra fija, ni el pie)', () => {
  const html = sinScripts(sinComentariosNiJsonLd(leerReal('carta.html')));
  const visible = quitarPlantillas(html, (cond) => /\bmenuDeHoy\b/.test(cond));
  assert.doesNotMatch(visible, /menu\.html/, 'carta.html enlaza menu.html fuera de un <template x-if="…menuDeHoy…">');
  assert.doesNotMatch(visible, /Menú de la semana|opciones de la semana/i);
  // Y el hueco de la barra fija no queda vacío: sin menú, la acción es reservar.
  assert.match(html, /Reservar por WhatsApp/);
});

test('menu.html: todo lo vivo (navegación de semana, grilla, diálogos, enlace del pie) va dentro de <template x-if="…apagada…">; apagada solo queda un aviso con la carta y reservar', () => {
  const pagina = sinScripts(sinComentariosNiJsonLd(leerReal('menu.html')));
  const html = pagina.slice(pagina.indexOf('<body')); // el <head> lleva el canonical y el og:url de menu.html: son la identidad de la página
  const visible = quitarPlantillas(html, (cond) => /\bapagada\b/.test(cond));
  for (const rastro of [/cambiarSemana/, /abrirDia/, /irHoy/, /x-for="d in dias"/, /menu\.html/, /Vota tu favorito/i, /Elegir este menú/i]) {
    assert.doesNotMatch(visible, rastro, `menu.html deja ${rastro} fuera de las plantillas de «!apagada»`);
  }
  const aviso = html.match(/<template x-if="apagada">([\s\S]*?)<\/template>/);
  assert.ok(aviso, 'falta el aviso <template x-if="apagada">');
  assert.match(aviso[1], /no está disponible por ahora/i);
  assert.match(aviso[1], /href="carta\.html"/);
  assert.match(aviso[1], /wa\.me/);
  assert.match(aviso[1], /Reservar/);
});

test('menu.html: no pide supabase-js con un <script src> fijo — solo si la función está encendida (document.write guardado por la bandera), y local.js va antes y sin defer', () => {
  const html = leerReal('menu.html');
  // Sin el cuerpo de los <script> en línea (donde el document.write escribe la etiqueta como texto):
  // lo que queda son las etiquetas <script src> de verdad.
  const etiquetasFijas = html.replace(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g, '<script></script>');
  assert.doesNotMatch(etiquetasFijas, /<script\b[^>]*\bsrc="[^"]*supabase[^"]*"/i, 'un <script src> fijo carga supabase-js aunque el menú esté apagado');
  const iLocal = html.search(/<script src="assets\/js\/local\.js"><\/script>/);
  const iGuarda = html.indexOf('document.write(');
  assert.ok(iLocal !== -1 && iGuarda !== -1 && iLocal < iGuarda, 'local.js (sin defer) tiene que cargar antes del guardia de supabase-js');
  assert.match(html.slice(iGuarda - 220, iGuarda), /RESPLANDOR\.funciones\.menuDeHoy/);
  assert.match(html.slice(iGuarda, iGuarda + 200), /supabase-js@2\.\d+\.\d+/, 'supabase-js sigue fijado a una versión');
});

// menu.html corrido de verdad: la función apagada no crea cliente de Supabase, no toca localStorage
// (ni id de dispositivo ni cola de reintentos), no pide nada, y le pide a los buscadores que no la indexen.
function menuHtmlEnVm(sitioFunciones) {
  const html = leerReal('menu.html');
  const m = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((x) => x[1]).find((t) => t.includes('function menuCal'));
  assert.ok(m, 'no encontré el <script> inline de menu.html con menuCal()');
  const llamadas = { createClient: 0, storage: [], fetch: 0 };
  const metas = [];
  const caja = {
    console,
    setInterval() {},
    fetch: async () => { llamadas.fetch++; throw new Error('sin red'); },
    navigator: { onLine: true },
    localStorage: {
      getItem(k) { llamadas.storage.push(['get', k]); return null; },
      setItem(k) { llamadas.storage.push(['set', k]); },
    },
    document: {
      title: '',
      head: { appendChild: (el) => metas.push(el) },
      body: { style: {} },
      addEventListener() {},
      querySelector: (selector) => (/robots/.test(selector) ? metas[0] || null : { setAttribute() {} }),
      createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    },
    addEventListener() {},
  };
  caja.window = caja;
  caja.globalThis = caja;
  caja.supabase = { createClient: () => { llamadas.createClient++; return { channel: () => ({ on() { return this; }, subscribe() { return this; } }), from: () => ({ select: () => ({ eq: () => ({}) }) }) }; } };
  // RESPLANDOR de un sitio con esas banderas (solo local.js).
  const sitio = crearSitio(sitioFunciones);
  vm.createContext(caja);
  vm.runInContext(sitio.leer('assets/js/local.js'), caja, { filename: 'assets/js/local.js' });
  vm.runInContext(`${m}\n;globalThis.__menuCal = menuCal;`, caja, { filename: 'menu.html (inline)' });
  return { menuCal: caja.__menuCal, llamadas, metas, caja };
}

test('menu.html con menuDeHoy APAGADA: menuCal() es solo un aviso — sin cliente de Supabase, sin localStorage, sin fetch, y con noindex al iniciar', () => {
  const { menuCal, llamadas, metas, caja } = menuHtmlEnVm(TODAS_APAGADAS);
  const c = menuCal();
  assert.equal(c.apagada, true);
  c.init();
  c.init(); // Alpine lo llama solo y x-init="init()" lo vuelve a llamar: no debe duplicar la meta
  assert.equal(llamadas.createClient, 0, 'creó un cliente de Supabase con el menú apagado');
  assert.deepEqual(llamadas.storage, [], 'tocó localStorage con el menú apagado');
  assert.equal(llamadas.fetch, 0);
  assert.equal(metas.length, 1);
  assert.deepEqual({ ...metas[0].attrs }, { name: 'robots', content: 'noindex' });
  assert.match(caja.document.title, /no está disponible/);
});

test('menu.html con menuDeHoy ENCENDIDA: menuCal() es el menú de siempre — crea el cliente de Supabase y apagada es false', () => {
  const { menuCal, llamadas } = menuHtmlEnVm({ menuDeHoy: true, almuerzoProgramado: false });
  const c = menuCal();
  assert.equal(c.apagada, false);
  assert.equal(llamadas.createClient, 1);
  assert.ok(llamadas.storage.some(([, k]) => k === 'menu_device_id'), 'debería leer su id de dispositivo');
});

// ───────────────────────── 2. los scripts del navegador, corridos de verdad ─────────────────────────

const SCRIPTS_LANDING = ['assets/js/local.js', 'assets/js/solicitud.js', 'assets/js/vivo.js', 'assets/js/carta-respaldo.js', 'assets/js/landing.js', 'assets/js/agentes.js'];

/**
 * Una «landing» en un vm: los scripts reales, un document/Alpine falsos y un fetch espía.
 * `sitio` decide las banderas; `fetch` responde (por defecto, todo cae); `timers` deja controlar
 * el reloj de los timeouts.
 */
function paginaLanding(sitio, { fetch, conRespaldo = true, timers, querySelectorAll, IntersectionObserver, matchMedia, antesDeAlpine } = {}) {
  const llamadas = { fetch: [], warn: [] };
  const documento = new EventTarget();
  documento.title = '';
  documento.documentElement = { classList: { add() {}, remove() {} } };
  documento.activeElement = null;
  documento.getElementById = () => null;
  documento.querySelector = () => null;
  documento.querySelectorAll = querySelectorAll || (() => []);
  documento.contains = () => true;
  const stores = new Map();
  const datos = new Map();
  const Alpine = {
    store(n, d) {
      if (d === undefined) return stores.get(n);
      stores.set(n, d);
      if (typeof d.init === 'function') d.init();
      return d;
    },
    data(n, f) { datos.set(n, f); },
    directive() {},
    effect(fn) { fn(); },
    nextTick(fn) { if (fn) fn(); return Promise.resolve(); },
    reactive(x) { return x; },
  };
  const respuesta = fetch || (async () => { throw new TypeError('Failed to fetch'); });
  const caja = {
    console: { ...console, warn: (...a) => llamadas.warn.push(a) },
    document: documento,
    location: { hash: '' },
    history: {},
    matchMedia: matchMedia || (() => ({ matches: false })),
    requestAnimationFrame: (fn) => (fn(), 0),
    cancelAnimationFrame() {},
    ...(IntersectionObserver ? { IntersectionObserver } : {}),
    setTimeout: timers ? timers.setTimeout : (fn) => (typeof fn === 'function' && setTimeout(() => {}, 0), 0),
    clearTimeout: timers ? timers.clearTimeout : () => {},
    AbortController,
    Alpine,
    fetch: async (url, init) => { llamadas.fetch.push(String(url)); return respuesta(url, init); },
    addEventListener() {},
  };
  caja.window = caja;
  caja.globalThis = caja;
  vm.createContext(caja);
  for (const archivo of SCRIPTS_LANDING) {
    if (archivo.endsWith('carta-respaldo.js') && !conRespaldo) continue;
    vm.runInContext(sitio.leer(archivo), caja, { filename: archivo });
  }
  documento.dispatchEvent(new Event('alpine:init'));
  if (antesDeAlpine) antesDeAlpine(); // Alpine pinta los <template x-if> mientras arranca
  documento.dispatchEvent(new Event('alpine:initialized'));
  return { caja, llamadas, datos, stores, herramientas: caja.window.RESPLANDOR_AGENTES.herramientas };
}

const nombresHerramientas = (pagina) => Array.from(pagina.herramientas, (h) => h.name).sort();

for (const { nombre, funciones } of COMBINACIONES) {
  const sitio = crearSitio(funciones);

  test(`[${nombre}] WebMCP: ver_menu_semana ${funciones.menuDeHoy ? 'está' : 'NO está'} entre las herramientas; el resto sigue`, () => {
    const pagina = paginaLanding(sitio);
    const esperadas = ['abrir_solicitud', 'anotar_solicitud', 'ver_carta', 'ver_local', ...(funciones.menuDeHoy ? ['ver_menu_semana'] : []), 'ver_solicitud'].sort();
    assert.deepEqual(nombresHerramientas(pagina), esperadas);
  });

  test(`[${nombre}] WebMCP: anotar_solicitud ${funciones.almuerzoProgramado ? 'ofrece' : 'NO ofrece'} entrega, dirección y frecuencia, ni el tipo «almuerzo»`, () => {
    const pagina = paginaLanding(sitio);
    const anotar = pagina.herramientas.find((h) => h.name === 'anotar_solicitud');
    const props = Object.keys(anotar.inputSchema.properties).sort();
    const comunes = ['fecha', 'hora', 'nombre', 'nota', 'personas', 'tipo'];
    assert.deepEqual(props, funciones.almuerzoProgramado ? [...comunes, 'direccion', 'entrega', 'frecuencia'].sort() : comunes);
    assert.equal(anotar.inputSchema.properties.tipo.enum.includes('almuerzo'), funciones.almuerzoProgramado);
    const abrir = pagina.herramientas.find((h) => h.name === 'abrir_solicitud');
    assert.equal(abrir.inputSchema.properties.tipo.enum.includes('almuerzo'), funciones.almuerzoProgramado);
    // La prosa de las herramientas tampoco nombra lo apagado.
    const prosa = pagina.herramientas.map((h) => `${h.title} ${h.description}`).join('\n');
    assert.equal(/almuerzo programado/i.test(prosa), funciones.almuerzoProgramado, 'la descripción de las herramientas y el almuerzo programado');
    assert.equal(/menú de la semana/i.test(prosa), funciones.menuDeHoy, 'la descripción de las herramientas y el menú de la semana');
  });

  test(`[${nombre}] Alpine: el componente menuSemana ${funciones.menuDeHoy ? 'se registra' : 'NO se registra'}; cartaVivo y el store de la solicitud siempre`, () => {
    const pagina = paginaLanding(sitio);
    assert.equal(pagina.datos.has('menuSemana'), funciones.menuDeHoy);
    assert.ok(pagina.datos.has('cartaVivo'));
    assert.ok(pagina.stores.has('solicitud'));
  });

  test(`[${nombre}] la landing recién cargada no llama a nadie (ni Supabase ni nada): las llamadas solo las hacen las secciones que se pintan`, () => {
    const pagina = paginaLanding(sitio);
    assert.deepEqual(pagina.llamadas.fetch, []);
  });

  test(`[${nombre}] RESPLANDOR_VIVO.leerMenuSemana ${funciones.menuDeHoy ? 'lee la tabla menus' : 'rechaza SIN llamar a Supabase'}`, async () => {
    const fila = { id: 'lun-1', semana: '2026-09-28', dia: 1, opcion: 1, etiqueta: '', principal: 'Sancocho', sopa: '', guarnicion: '', ensalada: '', jugo: '', fijo: false };
    const pagina = paginaLanding(sitio, { fetch: async () => ({ ok: true, json: async () => [fila] }) });
    const V = pagina.caja.RESPLANDOR_VIVO;
    if (funciones.menuDeHoy) {
      const { dias } = await V.leerMenuSemana();
      assert.equal(dias.length, 1);
      assert.equal(pagina.llamadas.fetch.length, 1);
      assert.match(pagina.llamadas.fetch[0], /supabase\.co\/rest\/v1\/menus\?/);
    } else {
      await assert.rejects(() => V.leerMenuSemana(), /no está disponible por ahora/);
      assert.deepEqual(pagina.llamadas.fetch, [], 'con el menú apagado, leerMenuSemana no debe hacer ni una llamada');
    }
  });

  test(`[${nombre}] tipos de solicitud: «almuerzo» ${funciones.almuerzoProgramado ? 'existe' : 'NO existe — pedirlo cae en el aviso de tipo inexistente'}`, () => {
    const pagina = paginaLanding(sitio);
    const R = pagina.caja.RESPLANDOR;
    const S = pagina.caja.RESPLANDOR_SOLICITUD;
    assert.equal(Array.from(R.tipos, (t) => t.id).includes('almuerzo'), funciones.almuerzoProgramado);
    // pagarEnMesa (solo carta.html) no es de las combinaciones: el sitio de prueba la deja como está en el repo.
    assert.deepEqual(plano(R.funciones), { ...funciones, pagarEnMesa: FUNCIONES_REAL.pagarEnMesa });
    const armado = S.armarSolicitud({ tipo: 'almuerzo', entrega: 'domicilio', direccion: 'Cra. 50 #10-20', frecuencia: 'semanal' });
    if (funciones.almuerzoProgramado) {
      assert.match(armado.mensaje, /Tipo: Almuerzo programado/);
      assert.deepEqual(plano(armado.avisos), []);
    } else {
      assert.match(armado.avisos.join('\n'), /Tipo «almuerzo» no existe/);
      assert.doesNotMatch(armado.mensaje, /Almuerzo programado|Frecuencia:|Entrega: a domicilio/);
      assert.equal(armado.datos.entrega, null);
    }
  });

  test(`[${nombre}] local.js: políticas, enlaces y descripción dicen solo lo que está encendido`, () => {
    const R = paginaLanding(sitio).caja.RESPLANDOR;
    assert.equal('menu' in R.enlaces, funciones.menuDeHoy);
    assert.equal('almuerzoDomicilioCostoCliente' in R.politicas, funciones.almuerzoProgramado);
    assert.equal(/menú de la semana/i.test(R.descripcion), funciones.menuDeHoy);
    assert.equal(R.politicas.eventosSoloEnElLocal, true);
  });
}

// Las secciones de una función encendida (#hoy, #almuerzo-programado) viven en un <template x-if>: Alpine las
// pinta recién al arrancar, DESPUÉS de que landing.js ya buscó los [data-aparecer]. Sin una segunda pasada al
// terminar Alpine quedarían para siempre en su estado inicial «oculto» (opacity 0): la función encendida
// existiría en el DOM y nadie la vería.
test('landing.js: los [data-aparecer] que Alpine pinta después (las secciones de una función encendida) también reciben su aparición', () => {
  const sitio = crearSitio(TODAS_ENCENDIDAS);
  const pintados = []; // lo que hay en el DOM en cada momento
  const observados = [];
  const seccionDeAlpine = { id: 'hoy', añadidas: [], classList: { add(c) { seccionDeAlpine.añadidas.push(c); } } };
  const seccionEstatica = { id: 'carta', añadidas: [], classList: { add(c) { seccionEstatica.añadidas.push(c); } } };
  class ObservadorFalso {
    constructor(cb) { this.cb = cb; }
    observe(el) { observados.push(el.id); }
    unobserve() {}
  }
  pintados.push(seccionEstatica); // ya estaba en el HTML cuando corrió landing.js
  paginaLanding(sitio, {
    querySelectorAll: (selector) => (selector === '[data-aparecer]' ? [...pintados] : []),
    IntersectionObserver: ObservadorFalso,
    antesDeAlpine: () => pintados.push(seccionDeAlpine), // x-if la insertó al arrancar Alpine
  });
  assert.deepEqual(observados, ['carta', 'hoy'], 'la sección pintada por Alpine se observa; la estática no se observa dos veces');
});

test('landing.js: con «reducir movimiento» las secciones que pinta Alpine aparecen de una, sin observador', () => {
  const sitio = crearSitio(TODAS_ENCENDIDAS);
  const seccion = { id: 'hoy', añadidas: [], classList: { add(c) { seccion.añadidas.push(c); } } };
  const pintados = [];
  paginaLanding(sitio, {
    querySelectorAll: () => [...pintados],
    matchMedia: () => ({ matches: true }),
    antesDeAlpine: () => pintados.push(seccion),
  });
  assert.deepEqual(seccion.añadidas, ['en-vista']);
});

// ───────────────────────── 3. el MCP remoto ─────────────────────────

const rpc = async (manejador, method, params, id = 1) => {
  const resp = await manejador.fetch(new Request('http://mcp.prueba/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }));
  return resp.json();
};

async function workerDe(sitio, { local } = {}) {
  const { crearManejador } = await sitio.importar('mcp/worker.mjs');
  const localJson = local || JSON.parse(sitio.leer('local.json'));
  const espia = { menu: 0, carta: 0 };
  const manejador = crearManejador({
    cargarLocal: async () => localJson,
    leerCarta: async () => { espia.carta++; return []; },
    leerMenuSemana: async () => { espia.menu++; return { semana: '2026-09-28', dias: [] }; },
  });
  return { manejador, espia };
}

for (const { nombre, funciones } of COMBINACIONES) {
  const sitio = crearSitio(funciones);

  test(`[${nombre}] MCP: tools/list ${funciones.menuDeHoy ? 'incluye' : 'NO incluye'} resplandor_ver_menu_semana; llamarla apagada da «params inválidos» y no toca Supabase`, async () => {
    const { manejador, espia } = await workerDe(sitio);
    const lista = (await rpc(manejador, 'tools/list')).result.tools.map((t) => t.name).sort();
    assert.deepEqual(lista, ['resplandor_preparar_solicitud', 'resplandor_ver_carta', ...(funciones.menuDeHoy ? ['resplandor_ver_menu_semana'] : []), 'resplandor_ver_local'].sort());
    const llamada = await rpc(manejador, 'tools/call', { name: 'resplandor_ver_menu_semana', arguments: {} }, 2);
    if (funciones.menuDeHoy) {
      assert.equal(llamada.result.isError, undefined);
      assert.equal(espia.menu, 1);
    } else {
      assert.equal(llamada.error.code, -32602);
      assert.doesNotMatch(llamada.error.message, /ver_menu_semana/, 'el mensaje de error no debe listar la herramienta apagada como opción');
      assert.equal(espia.menu, 0, 'con el menú apagado, el Worker no debe leer la tabla menus');
    }
  });

  test(`[${nombre}] MCP: resplandor_preparar_solicitud ${funciones.almuerzoProgramado ? 'ofrece' : 'NO ofrece'} entrega, dirección, frecuencia ni el tipo «almuerzo»`, async () => {
    const { manejador } = await workerDe(sitio);
    const herramienta = (await rpc(manejador, 'tools/list')).result.tools.find((t) => t.name === 'resplandor_preparar_solicitud');
    const props = Object.keys(herramienta.inputSchema.properties).sort();
    const comunes = ['fecha', 'hora', 'nombre', 'nota', 'personas', 'tipo'];
    assert.deepEqual(props, funciones.almuerzoProgramado ? [...comunes, 'direccion', 'entrega', 'frecuencia'].sort() : comunes);
    assert.equal(herramienta.inputSchema.properties.tipo.enum.includes('almuerzo'), funciones.almuerzoProgramado);
    assert.equal(/almuerzo/i.test(herramienta.description), funciones.almuerzoProgramado);
  });

  test(`[${nombre}] MCP: las instrucciones (initialize) y la server-card nombran lo encendido y callan lo apagado`, async () => {
    const { manejador } = await workerDe(sitio);
    const { instructions } = (await rpc(manejador, 'initialize', { protocolVersion: '2025-11-25' })).result;
    assert.equal(/resplandor_ver_menu_semana|menú de la semana|weekly menu/i.test(instructions), funciones.menuDeHoy);
    assert.equal(/almuerzo programado|scheduled lunch/i.test(instructions), funciones.almuerzoProgramado);
    // La server-card sale de las MISMAS herramientas (la lee del propio Worker).
    const tarjeta = JSON.parse(sitio.leer('.well-known/mcp/server-card.json'));
    assert.equal(tarjeta.tools.some((t) => t.name === 'resplandor_ver_menu_semana'), funciones.menuDeHoy);
    assert.equal(tarjeta.tools.find((t) => t.name === 'resplandor_preparar_solicitud').inputSchema.properties.tipo.enum.includes('almuerzo'), funciones.almuerzoProgramado);
  });
}

test('MCP: un Worker desplegado con unas banderas NO arma solicitudes contra un local.json de otras («Worker desactualizado»): se nota el menú y el almuerzo', async () => {
  const apagado = crearSitio(TODAS_APAGADAS);
  const encendido = crearSitio(TODAS_ENCENDIDAS);
  const soloMenu = crearSitio({ menuDeHoy: true, almuerzoProgramado: false });
  const soloAlmuerzo = crearSitio({ menuDeHoy: false, almuerzoProgramado: true });
  const pedir = async (sitioWorker, sitioLocal) => {
    const { manejador } = await workerDe(sitioWorker, { local: JSON.parse(sitioLocal.leer('local.json')) });
    const r = await rpc(manejador, 'tools/call', { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva', personas: 2 } });
    return r.result;
  };
  // Mismas banderas: arma la solicitud.
  for (const s of [apagado, encendido, soloMenu, soloAlmuerzo]) {
    const ok = await pedir(s, s);
    assert.equal(ok.isError, undefined, 'con las mismas banderas debería armar la solicitud');
  }
  // Banderas distintas, en las dos direcciones y por separado: pide redesplegar.
  for (const [w, l] of [[apagado, encendido], [encendido, apagado], [apagado, soloMenu], [soloMenu, apagado], [apagado, soloAlmuerzo], [soloAlmuerzo, apagado]]) {
    const r = await pedir(w, l);
    assert.equal(r.isError, true, `Worker ${JSON.stringify(w.funciones)} contra local.json ${JSON.stringify(l.funciones)} debería pedir redesplegar`);
    assert.match(r.content[0].text, /Worker desactualizado/);
  }
});

// ───────────────────────── 4. todo lo generado ─────────────────────────

const SUPERFICIES = [
  'local.json',
  'llms.txt',
  'sitemap.xml',
  'robots.txt',
  'auth.md',
  'about.html',
  'contact.html',
  'privacy.html',
  '404.html',
  '.well-known/api-catalog',
  '.well-known/mcp/server-card.json',
  '.well-known/agent-skills/index.json',
  '.well-known/agent-skills/consultar-resplandor.md',
  '.well-known/agent-skills/preparar-solicitud-resplandor.md',
  '.well-known/ai-catalog.json',
];

// Lo que solo puede existir con la función encendida (por más que se busque en cualquier superficie).
const RASTROS_GENERADOS = {
  menuDeHoy: [/menu\.html/i, /\bmenus\b/, /ver_menu_semana/, /menu_semana_en_vivo/, /men[uú] de la semana/i, /vota la gente/i, /weekly menu/i],
  almuerzoProgramado: [/programad[oa]/i, /"id": "almuerzo"/, /«almuerzo»/, /`almuerzo`/, /"entregas"/, /"frecuencias"/, /almuerzoDomicilioCostoCliente/, /almuerzo: /, /Frecuencia:/, /scheduled lunch/i],
};

// Y que, encendida, sí aparece donde tiene que aparecer (la prueba no puede pasar «porque no se generó nada»).
const PRESENTE_SI_ENCENDIDA = {
  menuDeHoy: {
    'local.json': /"menu_semana_en_vivo"/,
    'llms.txt': /menú de la semana/,
    'sitemap.xml': /menu\.html/,
    'auth.md': /`menus`/,
    'privacy.html': /menu\.html/,
    '404.html': /href="menu\.html"/,
    '.well-known/api-catalog': /rest\/v1\/menus/,
    '.well-known/mcp/server-card.json': /resplandor_ver_menu_semana/,
    '.well-known/agent-skills/consultar-resplandor.md': /Menú de la semana/,
    '.well-known/ai-catalog.json': /ver_menu_semana/,
    'about.html': /menú de la semana/,
  },
  almuerzoProgramado: {
    'local.json': /"id": "almuerzo"/,
    'llms.txt': /almuerzo: Almuerzo programado/,
    'about.html': /almuerzo programado/,
    'contact.html': /tipo «almuerzo»/,
    '.well-known/mcp/server-card.json': /«almuerzo»/,
    '.well-known/agent-skills/preparar-solicitud-resplandor.md': /`almuerzo`: Almuerzo programado/,
  },
};

// pagarEnMesa es solo de carta.html (el botón «Pagar» de la cuenta): NO se anuncia a los agentes ni a
// los buscadores, ni encendida ni apagada. Sus rastros se buscan SIEMPRE, no solo apagada.
const SOLO_CARTA = new Set(['pagarEnMesa']);
RASTROS_GENERADOS.pagarEnMesa = [/pagarEnMesa/i, /pagar en mesa/i, /functions\/v1\/alerta/i, /alerta al mesero/i];
PRESENTE_SI_ENCENDIDA.pagarEnMesa = {};

function verificarSuperficies(leer, funciones, quien) {
  for (const bandera of Object.keys(funciones)) {
    for (const archivo of SUPERFICIES) {
      const texto = leer(archivo);
      const halladas = RASTROS_GENERADOS[bandera].filter((re) => re.test(texto));
      if (!funciones[bandera] || SOLO_CARTA.has(bandera)) {
        assert.deepEqual(halladas.map(String), [], `${quien}: ${archivo} nombra «${bandera}»${SOLO_CARTA.has(bandera) ? ' (no se anuncia nunca)' : ' estando apagada'}`);
      }
    }
    if (funciones[bandera]) {
      for (const [archivo, re] of Object.entries(PRESENTE_SI_ENCENDIDA[bandera])) {
        assert.match(leer(archivo), re, `${quien}: ${archivo} debería decir algo de «${bandera}» estando encendida`);
      }
    }
  }
  // El JSON-LD de index.html (Restaurant.description) también.
  const jsonLd = leer('index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd, `${quien}: index.html sin JSON-LD`);
  assert.equal(/men[uú] de la semana/i.test(JSON.parse(jsonLd[1]).description), funciones.menuDeHoy, `${quien}: la descripción del JSON-LD y el menú de la semana`);
}

for (const { nombre, funciones } of COMBINACIONES) {
  test(`[${nombre}] lo generado (llms.txt, local.json, sitemap, JSON-LD, server-card, páginas de texto, skills…) ${funciones.menuDeHoy || funciones.almuerzoProgramado ? 'dice solo lo encendido' : 'no nombra ninguna de las dos funciones'}`, () => {
    const sitio = crearSitio(funciones);
    verificarSuperficies((rel) => sitio.leer(rel), funciones, nombre);
  });

  test(`[${nombre}] lo generado se puede comprobar (--comprobar en 0) y las herramientas WebMCP de local.json son las que agentes.js registra`, () => {
    const sitio = crearSitio(funciones);
    const comprobar = sitio.descubrimiento(['--comprobar']);
    assert.equal(comprobar.codigo, 0, comprobar.error);
    const local = JSON.parse(sitio.leer('local.json'));
    const pagina = paginaLanding(sitio);
    assert.deepEqual(local.agentes.webmcp.herramientas, Array.from(pagina.herramientas, (h) => h.name));
    assert.equal(local.enlaces.menu !== undefined, funciones.menuDeHoy);
    assert.equal(local.menu_semana_en_vivo !== undefined, funciones.menuDeHoy);
    assert.equal(local.solicitud.reglas.tipos.includes('almuerzo'), funciones.almuerzoProgramado);
    assert.equal('entregas' in local.solicitud.reglas, funciones.almuerzoProgramado);
    assert.equal('frecuencias' in local.solicitud, funciones.almuerzoProgramado);
    assert.equal(local.solicitud.ejemplos.some((e) => e.entrada.tipo === 'almuerzo'), funciones.almuerzoProgramado);
    const mapa = fs.readFileSync(sitio.ruta('sitemap.xml'), 'utf8');
    assert.equal(mapa.includes('/menu.html'), funciones.menuDeHoy, 'menu.html en el sitemap solo con menuDeHoy encendida');
  });
}

test('el repo real: sus archivos generados dicen lo que sus banderas mandan (sean cuales sean), y --comprobar está en 0', () => {
  verificarSuperficies(leerReal, FUNCIONES_REAL, 'repo real');
  // (El repo real corre `node scripts/descubrimiento.mjs --comprobar` en descubrimiento.test.mjs.)
});

test('re-encender es cambiar `false` por `true` y regenerar: apagar → encender deja lo generado idéntico, byte a byte, y olvidar regenerar lo delata --comprobar', () => {
  const sitio = crearSitio(TODAS_ENCENDIDAS, { fresco: true });
  const instantanea = () => Object.fromEntries([...SUPERFICIES, 'index.html'].map((a) => [a, sitio.leer(a)]));
  const encendido = instantanea();

  // Apagar SIN regenerar: --comprobar sale 1 y nombra lo que quedó atrasado.
  sitio.ponerBanderas(TODAS_APAGADAS);
  const sinRegenerar = sitio.descubrimiento(['--comprobar']);
  assert.equal(sinRegenerar.codigo, 1);
  assert.match(sinRegenerar.error, /Desactualizado/);
  for (const atrasado of ['local.json', 'llms.txt', 'sitemap.xml', '.well-known/mcp/server-card.json']) assert.match(sinRegenerar.error, new RegExp(atrasado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // Regenerar: es exactamente lo que genera un sitio nacido apagado.
  assert.equal(sitio.descubrimiento().codigo, 0);
  const apagado = instantanea();
  const nacidoApagado = crearSitio(TODAS_APAGADAS);
  for (const archivo of SUPERFICIES) assert.equal(apagado[archivo], nacidoApagado.leer(archivo), `${archivo}: apagar y regenerar no da lo mismo que nacer apagado`);
  assert.notEqual(apagado['local.json'], encendido['local.json']);
  assert.equal(sitio.descubrimiento(['--comprobar']).codigo, 0);

  // Volver a encender y regenerar: idéntico al primero.
  sitio.ponerBanderas(TODAS_ENCENDIDAS);
  assert.equal(sitio.descubrimiento(['--comprobar']).codigo, 1, 'encender sin regenerar también se nota');
  assert.equal(sitio.descubrimiento().codigo, 0);
  assert.deepEqual(instantanea(), encendido, 'apagar y volver a encender no dejó lo generado como estaba');
});

// ───────────────────────── 5. la carta con Supabase caído ─────────────────────────

const CARTA = (() => {
  const caja = { console };
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leerReal('assets/js/carta-respaldo.js'), caja, { filename: 'assets/js/carta-respaldo.js' });
  return plano(caja.RESPLANDOR_CARTA_RESPALDO);
})();

test('la instantánea de la carta: 30 platos del 3 de septiembre de 2026, con la fecha escrita en su nota, y es la que había en carta.html (commit 2cb1d05) con los ejecutivos que corrigió Yonatan el 2026-09-29', () => {
  assert.equal(CARTA.fecha, '2026-09-03');
  assert.equal(CARTA.fechaTexto, '3 de septiembre de 2026');
  assert.equal(CARTA.nota, 'Precios del 3 de septiembre de 2026; confírmalos al reservar.');
  assert.equal(CARTA.filas.length, 30);
  assert.deepEqual(Object.keys(CARTA.filas[0]), ['categoria', 'nombre', 'precio', 'descripcion'], 'mismas cuatro columnas que la vista carta_publica');
  assert.deepEqual([...new Set(CARTA.filas.map((f) => f.categoria))], ['Ejecutivos', 'Entradas', 'Platos Fuertes', 'Bebidas']);
  // Algunos platos y precios de la instantánea original (sacados de carta.html en 2cb1d05).
  const precio = (nombre) => CARTA.filas.find((f) => f.nombre === nombre)?.precio;
  assert.equal(precio('Menú Resplandor'), 23000);
  assert.equal(precio('Bandeja paisa Resplandor'), 49000);
  assert.equal(precio('Picada Resplandor'), 110000);
  assert.equal(precio('Cóctel Resplandor'), 35000);
  // La corrección de Yonatan (2026-09-29): el de 19.000 es el seco, sin sopa ni frijol; el menú de 23.000 sí trae sopa o frijol; la sopa y carne vale 14.000.
  assert.equal(precio('Seco'), 19000);
  assert.equal(precio('Sopa y carne'), 14000);
  assert.equal(precio('Frijoles con proteína'), undefined);
  assert.equal(precio('Sopa con proteína'), undefined);
  assert.equal(CARTA.filas.find((f) => f.nombre === 'Menú Resplandor').descripcion, 'Menú del día, con sopa o frijol');
});

test('la instantánea es la ÚNICA copia: ni index.html, ni carta.html, ni landing.js, ni agentes.js llevan una fila de la carta escrita a mano', () => {
  for (const archivo of ['index.html', 'carta.html', 'assets/js/landing.js', 'assets/js/agentes.js', 'assets/js/vivo.js', 'mcp/worker.mjs']) {
    const texto = leerReal(archivo);
    for (const fila of CARTA.filas) {
      assert.ok(!texto.includes(`'${fila.nombre}', ${fila.precio}`) && !texto.includes(`nombre: '${fila.nombre}'`), `${archivo} lleva a mano «${fila.nombre}»: la carta de respaldo vive solo en assets/js/carta-respaldo.js`);
    }
  }
  assert.match(leerReal('index.html'), /<script defer src="assets\/js\/carta-respaldo\.js"><\/script>/);
  assert.match(leerReal('carta.html'), /<script defer src="assets\/js\/carta-respaldo\.js"><\/script>/);
  // Antes de landing.js (la usa al iniciar) y antes de Alpine.
  const indexHtml = leerReal('index.html');
  assert.ok(indexHtml.indexOf('carta-respaldo.js') < indexHtml.indexOf('assets/js/landing.js'));
  assert.ok(indexHtml.indexOf('carta-respaldo.js') < indexHtml.indexOf('alpinejs'));
});

/** Espera a que cartaVivo() termine de cargar y devuelve el componente. */
async function cartaVivoCon(sitio, opciones) {
  const pagina = paginaLanding(sitio, opciones);
  const componente = pagina.datos.get('cartaVivo')();
  await componente.init();
  return { pagina, componente };
}

const FALLAS_DE_SUPABASE = [
  ['sin red (fetch lanza)', async () => { throw new TypeError('Failed to fetch'); }],
  ['402 Payment Required (la cuota de hoy)', async () => ({ ok: false, status: 402, statusText: 'Payment Required', json: async () => ({}) })],
  ['500', async () => ({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) })],
  ['200 pero no es JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } })],
  ['200 con una lista vacía (la vista no devolvió platos)', async () => ({ ok: true, json: async () => [] })],
];

for (const { nombre, funciones } of COMBINACIONES) {
  const sitio = crearSitio(funciones);
  for (const [falla, fetch] of FALLAS_DE_SUPABASE) {
    test(`[${nombre}] landing, carta con Supabase caído (${falla}): se ve la instantánea con su fecha, sin caja de error, y un solo intento`, async () => {
      const { pagina, componente } = await cartaVivoCon(sitio, { fetch });
      assert.equal(componente.estado, 'listo', 'no debe quedar en error ni cargando');
      assert.equal(componente.fuente, 'respaldo');
      assert.equal(componente.nota, CARTA.nota);
      assert.match(componente.nota, /3 de septiembre de 2026/);
      const platos = componente.categorias.reduce((n, c) => n + c.items.length, 0);
      assert.equal(platos, 30);
      assert.deepEqual(Array.from(componente.categorias, (c) => c.nombre).sort(), ['Bebidas', 'Ejecutivos', 'Entradas', 'Platos Fuertes']);
      assert.ok(componente.items.length > 0, 'la pestaña activa muestra platos');
      assert.match(componente.items[0].precioTexto, /^\$ \d{1,3}(\.\d{3})*$/);
      assert.equal(pagina.llamadas.fetch.length, 1, 'un solo intento, sin reintentos que hagan esperar');
      assert.match(pagina.llamadas.fetch[0], /carta_publica/);
      assert.ok(componente.error, 'el motivo queda para la consola, no para la pantalla');
      assert.ok(pagina.llamadas.warn.length >= 1, 'y se avisa en la consola con un warn (no un error)');
    });
  }

  test(`[${nombre}] landing, carta que sí carga en vivo: se ve la de hoy, sin nota de fecha`, async () => {
    const filas = [{ categoria: 'Bebidas', nombre: 'Agua', precio: 4500, descripcion: 'Botella' }];
    const { componente } = await cartaVivoCon(sitio, { fetch: async () => ({ ok: true, json: async () => filas }) });
    assert.equal(componente.estado, 'listo');
    assert.equal(componente.fuente, 'vivo');
    assert.equal(componente.nota, '');
    assert.equal(componente.items[0].precioTexto, '$ 4.500');
  });
}

test('landing, «sin esperar de más»: si Supabase no responde, la instantánea entra a los 4 s (el mismo plazo de carta.html), no antes ni después', async () => {
  const sitio = crearSitio(TODAS_APAGADAS);
  const armados = [];
  const timers = { setTimeout: (fn, ms) => { armados.push({ fn, ms, cancelado: false }); return armados.length; }, clearTimeout: (id) => { if (armados[id - 1]) armados[id - 1].cancelado = true; } };
  // Un fetch que jamás responde por sí solo: solo termina cuando lo aborta el temporizador.
  const colgado = (url, init) => new Promise((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(new Error('aborted'))));
  const pagina = paginaLanding(sitio, { fetch: colgado, timers });
  const componente = pagina.datos.get('cartaVivo')();
  const carga = componente.init();
  await new Promise((r) => setImmediate(r));
  assert.equal(componente.estado, 'cargando');
  assert.deepEqual(armados.map((t) => t.ms), [4000], 'un único temporizador, de 4000 ms');
  armados[0].fn(); // pasan los 4 s
  await carga;
  assert.equal(componente.estado, 'listo');
  assert.equal(componente.fuente, 'respaldo');
});

test('landing: si ni la carta en vivo ni la instantánea están, queda el estado de error de siempre (con enlace a carta.html) — es el último recurso, no el camino normal', async () => {
  const { componente } = await cartaVivoCon(crearSitio(TODAS_APAGADAS), { conRespaldo: false });
  assert.equal(componente.estado, 'error');
  assert.equal(componente.fuente, '');
  const html = leerReal('index.html');
  const seccion = html.slice(html.indexOf('id="carta"'), html.indexOf('id="almuerzo-programado"') > 0 ? html.indexOf('id="almuerzo-programado"') : html.indexOf('id="celebraciones"'));
  assert.match(seccion, /x-show="estado === 'error'"/);
  assert.match(seccion, /No pudimos cargar la carta en vivo\./);
  assert.match(seccion, /href="carta\.html"/);
});

test('index.html #carta: el aviso de la fecha está a la vista cuando la fuente es el respaldo, y «Se lee en vivo» solo cuando lo es de verdad', () => {
  const html = leerReal('index.html');
  const inicio = html.indexOf('id="carta"');
  const seccion = html.slice(inicio, html.indexOf('</section>', inicio));
  const nota = seccion.match(/<p x-show="fuente === 'respaldo'"[^>]*role="note"[\s\S]*?<\/p>/);
  assert.ok(nota, 'falta el aviso role="note" que se muestra con fuente === \'respaldo\'');
  assert.match(nota[0], /x-text="nota"/);
  assert.doesNotMatch(nota[0], /class="[^"]*\b(?:hidden|sr-only)\b/, 'el aviso no puede estar escondido');
  assert.match(seccion, /<span x-show="fuente === 'vivo'"[^>]*>\s*Se lee en vivo/, '«Se lee en vivo» solo se afirma cuando la fuente es en vivo');
  assert.doesNotMatch(seccion, /x-effect="error &&/, 'el error ya no se pinta como advertencia de la sección: va a la consola desde landing.js');
});

// carta.html corrido de verdad (su <script> inline, con la instantánea del módulo compartido).
async function cartaHtmlEnVm({ fetch }) {
  const html = leerReal('carta.html');
  const codigo = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((t) => t.includes('function carta()'));
  assert.ok(codigo, 'no encontré el <script> inline de carta.html');
  const llamadas = [];
  const caja = {
    console,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval() {},
    clearInterval() {},
    location: { search: '' },
    document: { querySelectorAll: () => [], visibilityState: 'visible' },
    fetch: async (url, init) => { llamadas.push(String(url)); return fetch(url, init); },
  };
  caja.window = caja;
  caja.globalThis = caja;
  vm.createContext(caja);
  vm.runInContext(leerReal('assets/js/carta-respaldo.js'), caja, { filename: 'assets/js/carta-respaldo.js' });
  vm.runInContext(crearSitio(TODAS_APAGADAS).leer('assets/js/local.js'), caja, { filename: 'assets/js/local.js' });
  const carta = vm.runInContext(`${codigo}\n;carta`, caja, { filename: 'carta.html (inline)' });
  const c = carta();
  c.$watch = () => {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.$refs = {};
  await c.init();
  return { c, llamadas };
}

test('carta.html con Supabase caído (402): muestra la instantánea de assets/js/carta-respaldo.js, avisa de qué día son los precios y no hay error', async () => {
  const { c, llamadas } = await cartaHtmlEnVm({ fetch: async () => ({ ok: false, status: 402, statusText: 'Payment Required' }) });
  assert.equal(c.fuente, 'foto');
  assert.equal(c.vivoTerminado, true, 'la carta en vivo ya falló: recién ahí se muestra el aviso de la fecha');
  assert.equal(c.nota, CARTA.nota);
  assert.equal(c.secciones.reduce((n, s) => n + s.platos.length, 0), 29, 'los 30 platos menos «Menú Resplandor», que es el precio de la tarjeta del día');
  assert.equal(c.dia.precio, 23000);
  assert.equal(llamadas.length, 1);
});

test('carta.html con Supabase en vivo: la carta de hoy, sin el aviso de la instantánea', async () => {
  const filas = [{ categoria: 'Bebidas', nombre: 'Agua', precio: 4500, descripcion: '' }];
  const { c } = await cartaHtmlEnVm({ fetch: async () => ({ ok: true, json: async () => filas }) });
  assert.equal(c.fuente, 'vivo');
  assert.equal(c.vivoTerminado, true);
  assert.equal(c.secciones[0].platos[0].precio, 4500);
});

test('carta.html: el aviso de la fecha es visible (role="note", con la nota) solo cuando la fuente es la instantánea y la carta en vivo ya falló; mientras llega la de hoy no parpadea', () => {
  const html = leerReal('carta.html');
  const aviso = html.match(/<div class="px-4 pt-5" x-show="fuente === 'foto' && vivoTerminado"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(aviso, 'falta el aviso de la fecha de la carta de respaldo');
  assert.match(aviso[0], /role="note"/);
  assert.match(aviso[0], /x-text="nota"/);
  assert.match(html, /x-text="fuente === 'vivo' \? 'Carta en vivo: lo que ves es lo que hay hoy\.' : nota"/, 'el pie también dice de qué día son los precios');
  assert.doesNotMatch(html, /Carta actualizada el/, 'la frase vieja (sin año ni «confírmalos») ya no se usa');
});

// ───────────────────────── 6. la regla «precios solo en vivo» cambió y la documentación lo dice ─────────────────────────

test('docs: la regla «los precios de la carta se muestran solo en vivo» (H16) se actualizó citando la decisión de Yonatan del 2026-09-29, y el contrato de las banderas está escrito', () => {
  const contrato = leerReal('docs/landing-y-agentes.md');
  assert.match(contrato, /## Funciones que se pueden apagar/);
  assert.match(contrato, /menuDeHoy/);
  assert.match(contrato, /almuerzoProgramado/);
  assert.match(contrato, /carta-respaldo\.js/);
  assert.match(contrato, /2026-09-29/);
  assert.match(contrato, /menu\.html/);
  assert.match(contrato, /descubrimiento\.mjs/);
  // La regla vieja no puede seguir escrita sin su corrección.
  for (const archivo of ['docs/landing-y-agentes.md', 'docs/identidad-visual.md']) {
    const texto = leerReal(archivo);
    for (const linea of texto.split('\n')) {
      if (/precios de la carta[^.]*(solo en vivo|EN VIVO)/i.test(linea)) {
        assert.match(linea, /2026-09-29|respaldo/i, `${archivo} sigue diciendo «precios solo en vivo» sin la decisión del 2026-09-29: ${linea.trim().slice(0, 120)}`);
      }
    }
  }
});
