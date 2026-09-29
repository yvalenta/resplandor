#!/usr/bin/env node
// Resplandor Restaurante — descubrimiento estático para agentes.
//
// Genera, a partir de la ÚNICA fuente (assets/js/local.js + assets/js/solicitud.js):
//   1. local.json      — los datos del local, las reglas de la solicitud y un ejemplo
//      real de armarSolicitud, para quien no ejecuta JavaScript.
//   2. llms.txt         — resumen en el formato de llmstxt.org.
//   3. sitemap.xml       — landing, carta y menú.
//   4. robots.txt        — permitir todo + Sitemap.
//   5. el <script type="application/ld+json"> (schema.org Restaurant) entre los
//      marcadores «datos-estructurados» de landing.html.
//
// El paso 5 es independiente de los otros cuatro: si landing.html (o el archivo que dé
// --landing) todavía no tiene los marcadores, ese paso falla con un mensaje claro pero
// los otros cuatro se generan/comprueban igual — así este script sirve desde antes de
// que la landing tenga los marcadores (los pone la parte que construye landing.html).
//
// Sin paquetes: solo node:fs, node:path, node:url y node:module. local.js y
// solicitud.js son scripts clásicos (globalThis.RESPLANDOR / globalThis.RESPLANDOR_SOLICITUD);
// se cargan por su efecto secundario con `require` (CommonJS), tal como los carga
// <script defer> en el navegador.
//
// CLI:
//   node scripts/descubrimiento.mjs                     escribe los archivos y dice qué cambió
//   node scripts/descubrimiento.mjs --comprobar          no escribe nada; sale 1 si algo difiere
//   node scripts/descubrimiento.mjs --landing <ruta>     usa <ruta> en vez de landing.html (para
//                                                         probar la inyección del JSON-LD sobre una
//                                                         copia temporal, sin tocar la landing real)
'use strict';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ruta = (...partes) => join(RAIZ, ...partes);

require(ruta('assets/js/local.js')); // deja globalThis.RESPLANDOR
require(ruta('assets/js/solicitud.js')); // deja globalThis.RESPLANDOR_SOLICITUD (usa RESPLANDOR)

const R = globalThis.RESPLANDOR;
const S = globalThis.RESPLANDOR_SOLICITUD;

// Herramientas WebMCP que agentes.js registra DE VERDAD: se ejecutan los 5 archivos
// reales (local, solicitud, vivo, landing, agentes) en un contexto `vm` con un
// document/Alpine mínimos — el mismo arnés que scripts/pruebas/webmcp.test.mjs — y se lee
// window.RESPLANDOR_AGENTES.herramientas.map(h => h.name). NUNCA una regex sobre el texto
// del archivo: una regex la engaña un comentario («// { name: 'reservar_y_pagar' }») o un
// `name` con comillas dobles, y local.json terminaría anunciando una herramienta que no
// existe (o le faltaría una que sí existe). Si el vm no puede correr (agentes.js todavía
// no existe en este checkout, o algo revienta), se usa la lista fija de siempre para no
// romper la generación de los otros archivos.
function herramientasWebmcp() {
  const porDefecto = ['ver_local', 'ver_carta', 'ver_menu_semana', 'anotar_solicitud', 'ver_solicitud', 'abrir_solicitud'];
  if (!existsSync(ruta('assets/js/agentes.js'))) return porDefecto;
  try {
    const nombres = herramientasWebmcpDeVerdad();
    return nombres.length ? nombres : porDefecto;
  } catch (err) {
    console.error(`No pude ejecutar assets/js/agentes.js en un vm para leer sus herramientas de verdad (${err.message}); uso la lista fija.`);
    return porDefecto;
  }
}

// Arnés mínimo (document/Alpine falsos) para ejecutar de verdad local.js, solicitud.js,
// vivo.js, landing.js y agentes.js fuera del navegador, y leer lo que agentes.js
// registra. Deliberadamente chico: solo lo que necesitan los `alpine:init`/
// `alpine:initialized` de landing.js/agentes.js para no reventar (nada de red: no hace
// falta pedir la carta ni el menú solo para listar nombres de herramientas).
function herramientasWebmcpDeVerdad() {
  const ARCHIVOS = ['assets/js/local.js', 'assets/js/solicitud.js', 'assets/js/vivo.js', 'assets/js/landing.js', 'assets/js/agentes.js'];

  const dialogo = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const document = new EventTarget();
  document.title = '';
  document.documentElement = { classList: { add() {}, remove() {} } };
  document.activeElement = null;
  document.getElementById = (id) => (id === 'solicitud' ? dialogo : null);
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.contains = () => true;

  const stores = new Map();
  const Alpine = {
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

  const sandbox = {
    console,
    document,
    location: { hash: '' },
    history: {},
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => (fn(), 0),
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => (typeof fn === 'function' && fn(), 0),
    clearTimeout: () => {},
    Alpine,
    fetch: async () => {
      throw new Error('sin red en este arnés: listar herramientas no debería pedir nada en vivo.');
    },
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const archivo of ARCHIVOS) {
    vm.runInContext(readFileSync(ruta(archivo), 'utf8'), sandbox, { filename: archivo });
  }
  document.dispatchEvent(new Event('alpine:init'));
  document.dispatchEvent(new Event('alpine:initialized'));

  const lista = sandbox.window.RESPLANDOR_AGENTES?.herramientas ?? [];
  return lista.map((h) => h.name);
}
const HERRAMIENTAS_WEBMCP = herramientasWebmcp();

const IMAGEN_OG = `${R.sitio}img/og-resplandor.jpg`;

// ───────────────────────── local.json ─────────────────────────

// Ejemplos de solicitud reales, armados con el mismo armarSolicitud() que usan la web y
// los agentes: `ejemplos` no se escribe a mano, sale de acá para no poder divergir del
// mensaje real. Más de uno a propósito (hallazgo N3 de la ronda 3 de refutación): la
// «huella» que compara mcp/worker.mjs (local.json en vivo contra las reglas del bundle,
// para detectar un despliegue atrasado) solo puede notar una deriva en las líneas que el
// ejemplo ejercita. Con un solo ejemplo (reserva simple) una deriva en la línea
// «Entrega:», en el saneo de la nota o en el aviso «los eventos son solo en el local»
// pasaba desapercibida. Cubren: reserva simple; almuerzo con domicilio + dirección + nota
// (ejercita frecuencia, la línea de entrega y «El domicilio corre por mi cuenta»); un tipo
// que NO es almuerzo pidiendo domicilio (ejercita el aviso de N1); y — hallazgo de una
// SEGUNDA ronda de refutación sobre este mismo N3: ninguno de los tres de arriba llevaba
// salto de línea, control, relleno invisible ni texto de más de MAX_TEXTO, así que la
// deriva que introdujo la propia ronda 3 (saneo de rellenos con/sin ancho, recorte por
// grafema con tope duro de puntos de código) pasaba la huella sin que se note. El cuarto
// ejemplo ejercita las cuatro cosas en una sola nota: un salto de línea real (se ve como
// « / »), un carácter de control (se ve como un espacio), un relleno CON ancho entre
// palabras (U+2800: se cambia por espacio, nunca pega las dos palabras) y más de
// MAX_TEXTO puntos de código con una secuencia ZWJ (familia 👨‍👩‍👧‍👦, 7 puntos de código
// que forman UN solo grafema) justo en el borde del corte, para que el recorte tenga que
// retroceder al grafema completo anterior en vez de partir la secuencia.
const NOTA_EJEMPLO_4 =
  'Cumpleaños\ncon\x07control y relleno⠀braille entre palabras, ' + 'x'.repeat(238) + '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
// El quinto ejemplo (fiesta-quince con 5 personas) ejercita la regla de Yonatan del
// 2026-09-28 (eventos/celebraciones/paquetes de 10 a 30 personas, con aviso si piden menos):
// sin este ejemplo, una deriva en MIN_PERSONAS_EVENTO o en esTipoEvento podía desplegarse sin
// que la «huella» de mcp/worker.mjs#reglasDesactualizadas lo note (mismo patrón que N3).
//
// Hallazgo de refutación (ronda de identidad v2, sobre TIPOS_SIN_MINIMO_EVENTO en
// assets/js/solicitud.js): el ejemplo de «cena-romantica» de abajo NO llevaba `personas` —
// así que un Worker desplegado con un bundle VIEJO (cena-romantica todavía tratada como
// evento, con el mínimo de 10) y un local.json NUEVO (ya sin ese mínimo) no lo notaba:
// ningún ejemplo ejercitaba justo la línea que cambió (esTipoEvento('cena-romantica')). Con
// `personas: 2` acá, la huella de reglasDesactualizadas() SÍ nota la diferencia: el bundle
// viejo recalcularía «Personas: 10» con un aviso de ajuste, mientras que el mensaje/aviso
// guardado en el ejemplo (armado con el bundle de HOY, sin ese mínimo) no tiene ninguno de
// los dos — la comparación falla y pide redesplegar (ver scripts/pruebas/mcp.test.mjs).
const ENTRADAS_EJEMPLOS = [
  { tipo: 'reserva', fecha: '2026-10-03', hora: '19:00', personas: 4, nombre: 'Ana' },
  { tipo: 'almuerzo', entrega: 'domicilio', direccion: 'Cra. 50 #10-20, La Estrella', frecuencia: 'semanal', nota: 'Sin picante, por favor' },
  { tipo: 'evento-corporativo', personas: 12, entrega: 'domicilio' },
  { tipo: 'cena-romantica', personas: 2, nombre: 'Camila', nota: NOTA_EJEMPLO_4 },
  { tipo: 'fiesta-quince', personas: 5, nombre: 'Valentina' },
];

function construirLocal() {
  const ejemplos = ENTRADAS_EJEMPLOS.map((entrada) => {
    const armado = S.armarSolicitud(entrada);
    return { entrada, mensaje: armado.mensaje, enlace: armado.enlace, avisos: armado.avisos };
  });
  return {
    marca: R.marca,
    sitio: R.sitio,
    descripcion: R.descripcion,
    cocina: R.cocina,
    whatsapp: R.whatsapp,
    whatsappVisible: R.whatsappVisible,
    direccion: R.direccion,
    direccionPartes: R.direccionPartes,
    plusCode: R.plusCode,
    geo: R.geo,
    horario: R.horario,
    capacidad: R.capacidad,
    minimoPersonasEvento: R.minimoPersonasEvento,
    resenas: R.resenas,
    enlaces: R.enlaces,
    politicas: R.politicas,
    generado_de: 'assets/js/local.js + assets/js/solicitud.js',
    solicitud: {
      reglas: {
        maxPersonas: S.MAX_PERSONAS,
        minPersonasEvento: S.MIN_PERSONAS_EVENTO,
        maxTexto: S.MAX_TEXTO,
        tipos: S.TIPOS.map((t) => t.id),
        entregas: S.ENTREGAS,
        frecuencias: S.FRECUENCIAS.map((f) => f.id),
      },
      tipos: S.TIPOS,
      entregas: S.ENTREGAS,
      frecuencias: S.FRECUENCIAS,
      como:
        'Con un tipo (de los de «tipos») y los datos que apliquen, armarSolicitud (assets/js/solicitud.js) arma el ' +
        'mensaje y el enlace wa.me (el mensaje va codificado con encodeURIComponent); la persona abre ese enlace y lo ' +
        'envía ella misma desde WhatsApp — ni el sitio ni un agente lo mandan. Todo evento y toda celebración es en el ' +
        'restaurante — la única excepción es el almuerzo programado (tipo «almuerzo»), que puede ser a domicilio si la ' +
        'persona asume el costo. «personas» va de 1 a maxPersonas (sin mínimo) para una reserva de mesa (tipo «reserva»), ' +
        'un almuerzo programado (tipo «almuerzo») o una cena romántica / aniversario (tipo «cena-romantica» — se anuncia ' +
        '«en pareja», decisión por defecto pendiente de confirmar con Camila), y de minPersonasEvento a maxPersonas para cualquier ' +
        'otro tipo (evento/celebración/paquete); fuera de rango se ajusta al límite más cercano con aviso, nunca se ' +
        'rechaza la solicitud entera.',
      ejemplos,
    },
    carta_en_vivo: {
      como: 'GET a la vista `carta_publica` de Supabase (categoria, nombre, precio, descripcion); ver assets/js/vivo.js#leerCarta. Nunca se embebe acá: cambia en vivo.',
      supabase: { url: R.supabase.url, key: R.supabase.key, vista: R.supabase.vistaCarta, columnas: R.supabase.columnasCarta },
      paginaHumana: R.enlaces.carta,
    },
    menu_semana_en_vivo: {
      como: 'GET a la tabla `menus` de Supabase (activo=true, la semana actual); ver assets/js/vivo.js#leerMenuSemana. Nunca se embebe acá: cambia en vivo.',
      supabase: { url: R.supabase.url, key: R.supabase.key, tabla: R.supabase.tablaMenus },
      paginaHumana: R.enlaces.menu,
    },
    agentes: {
      // `donde` es solo el nombre de la API (para citarla entre backticks sin arrastrar
      // una URL adentro — ver llms.txt más abajo); `pagina` es dónde vive, aparte.
      webmcp: { donde: 'document.modelContext', pagina: `${R.sitio}landing.html`, herramientas: HERRAMIENTAS_WEBMCP },
      mcp: null, // todavía no hay Worker desplegado: no anunciar un endpoint que no existe
    },
  };
}

// ───────────────────────── llms.txt ─────────────────────────

function construirLlmsTxt(local) {
  return [
    `# ${local.marca}`,
    '',
    `> ${local.descripcion} El mensaje de reserva o cotización sale por WhatsApp al ${local.whatsappVisible}.`,
    '',
    '## Cómo reservar o cotizar',
    '',
    'El agente (o la propia web) arma la solicitud: el mensaje, con los datos (tipo, fecha, hora, personas, nombre, ' +
      'nota) y la misma receta de `armarSolicitud` en assets/js/solicitud.js, más el enlace ' +
      `\`https://wa.me/${local.whatsapp}?text=\` con ese mensaje codificado con \`encodeURIComponent\`. La persona abre ` +
      'ese enlace y la manda ella misma desde WhatsApp: ni el sitio ni un agente la envían.',
    '',
    '## El local',
    '',
    `- Dirección: ${local.direccion} (plus code ${local.plusCode}).`,
    `- Horario: ${local.horario.texto}.`,
    `- Capacidad: ${local.capacidad} personas. Todo evento y toda celebración es en el restaurante: no hay eventos a domicilio ni catering externo.`,
    `- Eventos, celebraciones y paquetes en el local: de ${local.minimoPersonasEvento} a ${local.capacidad} personas. Una reserva de mesa (tipo «reserva»), un almuerzo programado (tipo «almuerzo») o una cena romántica / aniversario (tipo «cena-romantica», que se anuncia «en pareja») no tienen ese mínimo — solo el máximo de ${local.capacidad}.`,
    `- Cómo llegar: ${local.enlaces.comoLlegar}`,
    `- Reseñas: ${local.resenas.texto} — ${local.resenas.url}`,
    '',
    '## Tipos de solicitud',
    '',
    ...local.solicitud.tipos.map((t) => `- ${t.id}: ${t.etiqueta}`),
    '',
    '## Carta y menú (en vivo)',
    '',
    `La carta (${local.enlaces.carta}) y el menú de la semana (${local.enlaces.menu}) se leen en vivo de Supabase ` +
      '(la vista `carta_publica` y la tabla `menus`, públicas y de solo lectura); este archivo nunca lleva precios ' +
      'embebidos porque cambian ahí, no acá.',
    '',
    '## Archivos',
    '',
    '- [local.json](local.json): los datos del local, las reglas de la solicitud y ejemplos, en JSON.',
    '',
    '## Agentes',
    '',
    `Herramientas WebMCP en \`${local.agentes.webmcp.donde}\` (${local.agentes.webmcp.pagina}): ${local.agentes.webmcp.herramientas.join(', ')}. Un MCP remoto ` +
      '(resplandor_ver_local, resplandor_ver_carta, resplandor_ver_menu_semana, resplandor_preparar_solicitud) existe en el ' +
      'repo (mcp/worker.mjs) pero todavía no está desplegado.',
    '',
    '## Aviso',
    '',
    'Ningún agente reserva, cotiza, envía ni paga nada por la persona: arma la solicitud y el enlace de WhatsApp, y la ' +
      'persona lo abre y lo manda ella misma. Sin USDC ni pagos: acá no hay nada que pagar.',
  ].join('\n');
}

// ───────────────────────── sitemap.xml / robots.txt ─────────────────────────

function construirSitemap(local) {
  const paginas = [local.enlaces.landing, local.enlaces.carta, local.enlaces.menu];
  const urls = paginas.map((u) => `  <url>\n    <loc>${u}</loc>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function construirRobots(local) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${local.sitio}sitemap.xml\n`;
}

// ───────────────────────── JSON-LD (schema.org) ─────────────────────────

function construirJsonLd(local) {
  const partes = local.direccionPartes || {};
  // addressLocality/addressRegion en sus propios campos (no enterrados dentro de
  // streetAddress): Google recomienda separarlos para que un Restaurant se geolocalice
  // bien. postalCode solo si se conoce; no se inventa uno.
  const address = {
    '@type': 'PostalAddress',
    streetAddress: partes.calle || local.direccion,
    ...(partes.ciudad ? { addressLocality: partes.ciudad } : {}),
    ...(partes.region ? { addressRegion: partes.region } : {}),
    ...(partes.postalCode ? { postalCode: partes.postalCode } : {}),
    addressCountry: (partes.pais || 'CO'),
  };
  const datos = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: local.marca,
    description: local.descripcion,
    url: `${local.sitio}landing.html`,
    image: IMAGEN_OG,
    telephone: local.whatsappVisible,
    servesCuisine: local.cocina,
    address,
    geo: { '@type': 'GeoCoordinates', latitude: local.geo.lat, longitude: local.geo.lng },
    hasMap: local.enlaces.maps,
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: local.horario.abre,
      closes: local.horario.cierra,
    },
    maximumAttendeeCapacity: local.capacidad,
    acceptsReservations: true,
    menu: local.enlaces.carta,
    // SIN aggregateRating: Google prohíbe marcar reseñas tomadas de otro sitio (las
    // reseñas reales viven en la ficha de Google Maps, no en este sitio).
  };
  // '<' escapado a < (válido dentro de un string JSON) para que un «</script>»
  // dentro de un texto no cierre la etiqueta de verdad.
  const json = JSON.stringify(datos, null, 2).replace(/</g, '\\u003c');
  const indentado = json
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n');
  return `  <script type="application/ld+json">\n${indentado}\n  </script>`;
}

const MARCADOR_INICIO = '<!-- datos-estructurados:inicio -->';
const MARCADOR_FIN = '<!-- datos-estructurados:fin -->';

// Reemplaza lo que hay entre los marcadores por el bloque nuevo; conserva el resto del
// archivo intacto. Devuelve null si no encuentra los dos marcadores (contrato roto: la
// landing todavía no los tiene, o el archivo dado no es la landing).
function conBloqueJsonLd(html, bloque) {
  const i = html.indexOf(MARCADOR_INICIO);
  if (i === -1) return null;
  const j = html.indexOf(MARCADOR_FIN, i);
  if (j === -1) return null;
  const antes = html.slice(0, i + MARCADOR_INICIO.length);
  const despues = html.slice(j);
  return `${antes}\n${bloque}\n  ${despues}`;
}

// ───────────────────────── CLI ─────────────────────────

const argv = process.argv.slice(2);
const comprobar = argv.includes('--comprobar');
const iLanding = argv.indexOf('--landing');
const rutaLanding = iLanding !== -1 && argv[iLanding + 1] ? resolve(argv[iLanding + 1]) : ruta('landing.html');
// --salida <dir>: dónde van local.json/llms.txt/sitemap.xml/robots.txt. Por defecto,
// la raíz del repo (el uso normal, en desarrollo y en CI con --comprobar). Las pruebas de
// escritura (scripts/pruebas/descubrimiento.test.mjs) SIEMPRE pasan un directorio
// temporal acá: ninguna prueba debe reescribir estos cuatro archivos en el árbol de
// trabajo real. `--landing` es independiente: sigue siendo su propia ruta.
const iSalida = argv.indexOf('--salida');
const dirSalida = iSalida !== -1 && argv[iSalida + 1] ? resolve(argv[iSalida + 1]) : RAIZ;
const rutaSalida = (...partes) => join(dirSalida, ...partes);

const local = construirLocal();
const localJson = JSON.stringify(local, null, 2) + '\n';
const llmsTxt = construirLlmsTxt(local) + '\n';
const sitemapXml = construirSitemap(local);
const robotsTxt = construirRobots(local);

// Los cuatro archivos de siempre: no dependen de que landing.html tenga marcadores.
const objetivosBase = [
  { archivo: rutaSalida('local.json'), etiqueta: 'local.json', contenido: localJson },
  { archivo: rutaSalida('llms.txt'), etiqueta: 'llms.txt', contenido: llmsTxt },
  { archivo: rutaSalida('sitemap.xml'), etiqueta: 'sitemap.xml', contenido: sitemapXml },
  { archivo: rutaSalida('robots.txt'), etiqueta: 'robots.txt', contenido: robotsTxt },
];

// El JSON-LD de la landing: paso independiente y que puede fallar solo (ver cabecera).
let objetivoLanding = null;
let landingOk = true;
if (!existsSync(rutaLanding)) {
  console.error(`No existe ${rutaLanding}: no genero el JSON-LD ahí.`);
  landingOk = false;
} else {
  const htmlActual = readFileSync(rutaLanding, 'utf8');
  const htmlNuevo = conBloqueJsonLd(htmlActual, construirJsonLd(local));
  if (htmlNuevo === null) {
    console.error(
      `${rutaLanding} no tiene los marcadores «${MARCADOR_INICIO}» … «${MARCADOR_FIN}»: no genero el JSON-LD ahí ` +
        '(esperado hasta que la landing los tenga; usá --landing <ruta> para probar sobre una copia con los marcadores).',
    );
    landingOk = false;
  } else {
    objetivoLanding = { archivo: rutaLanding, etiqueta: rutaLanding, contenido: htmlNuevo };
  }
}

if (comprobar) {
  const difieren = objetivosBase.filter((o) => !existsSync(o.archivo) || readFileSync(o.archivo, 'utf8') !== o.contenido);
  if (objetivoLanding && (!existsSync(objetivoLanding.archivo) || readFileSync(objetivoLanding.archivo, 'utf8') !== objetivoLanding.contenido)) {
    difieren.push(objetivoLanding);
  }
  if (difieren.length) {
    console.error('Desactualizado respecto de assets/js/local.js y assets/js/solicitud.js:');
    for (const o of difieren) console.error(`  - ${o.etiqueta}`);
    console.error('Corré `node scripts/descubrimiento.mjs` para regenerarlos.');
  }
  if (difieren.length || !landingOk) process.exit(1);
  console.log('local.json, llms.txt, sitemap.xml, robots.txt y el JSON-LD de la landing están al día.');
  process.exit(0);
}

for (const o of objetivosBase) {
  const previo = existsSync(o.archivo) ? readFileSync(o.archivo, 'utf8') : null;
  if (previo === o.contenido) {
    console.log(`${o.etiqueta}: sin cambios.`);
    continue;
  }
  writeFileSync(o.archivo, o.contenido);
  console.log(`${o.etiqueta}: ${previo === null ? 'creado' : 'actualizado'}.`);
}
if (objetivoLanding) {
  const previo = existsSync(objetivoLanding.archivo) ? readFileSync(objetivoLanding.archivo, 'utf8') : null;
  if (previo === objetivoLanding.contenido) {
    console.log(`${objetivoLanding.etiqueta}: sin cambios.`);
  } else {
    writeFileSync(objetivoLanding.archivo, objetivoLanding.contenido);
    console.log(`${objetivoLanding.etiqueta}: ${previo === null ? 'creado' : 'actualizado'}.`);
  }
}
process.exit(landingOk ? 0 : 1);
