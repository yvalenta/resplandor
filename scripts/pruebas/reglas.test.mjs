// La «trampa de reglas» que el contrato pedía y no existía (r0: «Ninguna prueba lee
// index.html buscando "30 personas", catering, domicilio de eventos, 500/150 personas,
// +2.000, desayuno ni "$" seguido de un dígito. Los datos que mandan en el texto visible
// quedan sin guardia: una regresión del texto pasa con la suite verde.» — repro con dos
// mutantes concretos, ver más abajo). Lee index.html, carta.html, menu.html, llms.txt y
// local.json — las cinco superficies que una persona o un agente pueden leer — y falla si
// alguna vuelve a decir lo que los datos que mandan (docs/landing-y-agentes.md) prohíben:
// una capacidad inflada («500 personas», «150 personas», «+2.000»), catering, un evento a
// domicilio, o un precio en pesos escrito a mano fuera de lo que sirve la carta EN VIVO
// (Supabase). También exige que la frase «de 10 a 30 personas» aparezca donde tiene que
// aparecer: en la sección de celebraciones de index.html, y en llms.txt/local.json (las dos
// superficies que un agente lee sin ejecutar JavaScript).
//
// 2026-10-01 (pedido de Yonatan, rama carta-promos): los DESAYUNOS y las PROMOCIONES de la semana
// dejaron de estar prohibidos. Desayunos: todos los días, 7:00 a.m. – 11:00 a.m. (dato de los
// afiches oficiales); los platos y precios de desayuno son los del letrero del local y viven en la
// carta en vivo, así que ninguna otra superficie los escribe (el precio a mano sigue prohibido, abajo). Promociones: la landing las
// muestra como los afiches de assets/img/promos/ (sección #promociones, vigilada por
// promos.test.mjs); sus precios van dentro de las imágenes y de su alt escritos en palabras
// («50.000 pesos»), nunca como «$» + dígito, y llms.txt/local.json siguen sin llevar precios.
//
// Nunca se prueba contra `img/referencias/**`, `assets/js/**` ni el resto del CSS: esto es
// una trampa de TEXTO VISIBLE Y DE DATOS, no de marcado ni de estilos (eso lo cubren
// contraste.test.mjs/imagenes.test.mjs). Tampoco mira `pos.html` (el POS): sus reglas de
// negocio son otras y no son parte de esta capa pública.
//
// Dos matices deliberados, para no fallar contra texto que HOY es correcto:
//   1. «catering»/«desayuno»/«a domicilio» + evento en las páginas HTML (lo que lee una
//      PERSONA) están prohibidos SIN EXCEPCIÓN — ni para ofrecerlos ni para negarlos: la
//      cara pública simplemente no habla de eso (landing-y-agentes.md: «se quitan… la FAQ
//      de catering externo»). Si index.html necesitara negarlo alguna vez, ese texto
//      iría igual contra esta prueba a propósito — la señal es «se dejó de mencionar del
//      todo», no «se negó bien».
//   2. En llms.txt/local.json (lo que lee un AGENTE) SÍ es correcto y necesario declarar la
//      política en negativo («no hay eventos a domicilio ni catering externo»): un agente
//      necesita saber qué NO se ofrece. Ahí la trampa exige que la mención esté acompañada
//      de una negación cercana (nunca/ni/no hay/sin) — si apareciera SIN ninguna negación
//      cerca, sería una oferta real, y eso sí tiene que fallar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => path.join(RAIZ, ...p);
const leer = (p) => fs.readFileSync(ruta(p), 'utf8');

createRequire(import.meta.url)(ruta('assets/js/local.js'));
const R = globalThis.RESPLANDOR;

const PAGINAS_HTML = ['index.html', 'carta.html', 'menu.html'];
// Lo que un agente lee como DATO del local: dice el horario de los desayunos y niega lo que no se ofrece.
// index.md y pricing.md (puntaje-ora, 2026-10-03) hablan del local entero, como llms.txt y local.json.
const ARCHIVOS_DATO = ['llms.txt', 'local.json', 'index.md', 'pricing.md'];
// El resto de lo que sumó puntaje-ora para agentes: no tienen por qué decir el horario, pero sí respetan las
// prohibiciones absolutas y, si nombran catering o un evento a domicilio, es solo para negarlo.
const ARCHIVOS_AGENTES = [
  'carta.md',
  'about.md',
  'contact.md',
  'privacy.md',
  'pricing.html',
  'api/index.html',
  'api/index.md',
  'api/llms.txt',
  'openapi.json',
  'schema/local.jsonl',
  '.well-known/ard.json',
];
const TODOS = [...PAGINAS_HTML, ...ARCHIVOS_DATO, ...ARCHIVOS_AGENTES];

// ───────────────────────── prohibiciones absolutas (las 5 superficies) ─────────────────────────

// Ninguna razón legítima para que cualquiera de las cinco superficies mencione una
// capacidad inflada de un borrador viejo, ni un precio en pesos escrito a mano: los
// precios de la carta se leen SIEMPRE en vivo (Supabase), nunca embebidos (README/
// landing-y-agentes.md). `\$\d` (el símbolo pegado a un dígito) no choca con Alpine
// (`$store`, `$el`, `$refs`…: siempre `$` + LETRA, nunca `$` + dígito).
const PROHIBICIONES_ABSOLUTAS = [
  { nombre: '«500 personas» o «150 personas» (capacidad inflada de un borrador viejo)', re: /\b(?:500|150)\s*personas\b/i },
  { nombre: '«+2.000» (conteo de eventos de un borrador viejo)', re: /\+2\.000/ },
  { nombre: 'un precio en pesos escrito a mano ($ seguido de un dígito) fuera de la carta en vivo', re: /\$\d/ },
];

for (const archivo of TODOS) {
  test(`${archivo}: sin capacidad inflada, sin «+2.000» ni precios escritos a mano`, () => {
    const texto = leer(archivo);
    const fallas = [];
    for (const { nombre, re } of PROHIBICIONES_ABSOLUTAS) {
      const m = texto.match(re);
      if (m) fallas.push(`${nombre}: encontrado "${m[0]}"`);
    }
    assert.deepEqual(fallas, []);
  });
}

// ───────────────────────── ningún precio a mano, en ninguna de las formas en que se escribe ─────────────────────────
// La regla de arriba (`\$\d`) solo veía «$14.000»: «14.000 COP», «49.000 pesos» o «$ 14.000» (con espacio) pasaban en verde, y así el
// «desde 14.000 COP» de pricing.*, carta.md e index.md salió con la suite verde (refutación r1 de puntaje-ora, 2026-10-04: la carta
// en vivo arranca en 4.000). Esta regla vale para TODO lo que genera scripts/descubrimiento.mjs (su `--listar`, así un archivo nuevo
// entra solo) y para el JSON-LD de la landing; las páginas escritas a mano (index.html, carta.html, menu.html) siguen con la regla de
// arriba: llevan los afiches de promociones con sus precios en palabras («50.000 pesos») en el `alt`, a propósito (ver el encabezado).
//
// La ÚNICA excepción es el «desde» de `rangoDePrecios` de assets/js/local.js, TAL CUAL (`desde 14.000 COP`) y el dato entero
// (`$$ · desde 14.000 COP`, en local.json): un dato de Yonatan que el generador publica dicho como lo que es (fraseRango). Cualquier otra
// cifra —«desayunos desde 9.000 COP», «a 49.000 pesos»— falla.
const RE_PRECIO_A_MANO = new RegExp(
  [
    String.raw`\$\s*\d`, // «$14.000», «$ 14.000», «$14000»
    String.raw`\b\d[\d.,]*\s*(?:COP|pesos)\b`, // «14.000 COP», «49.000 pesos», «14000 COP»
    String.raw`\b\d+\s*mil\s+(?:COP|pesos)\b`, // «14 mil pesos»
    String.raw`\bCOP\s*\$?\s*\d`, // «COP 14.000», «COP$14.000»
  ].join('|'),
  'gi',
);

/** El texto sin lo único permitido: el dato `rangoDePrecios` entero y su «desde N COP», tal como salen de local.js. */
function sinElDesdeDeRangoDePrecios(texto) {
  let t = texto.split(R.rangoDePrecios).join('');
  for (const parte of R.rangoDePrecios.match(/desde\s+\d[\d.]*\s*(?:COP|pesos)/gi) ?? []) t = t.split(parte).join('');
  return t;
}
const preciosAMano = (texto) => [...sinElDesdeDeRangoDePrecios(texto).matchAll(RE_PRECIO_A_MANO)].map((m) => m[0]);

const GENERADOS = execFileSync(process.execPath, [ruta('scripts/descubrimiento.mjs'), '--listar'], { cwd: RAIZ }).toString().trim().split('\n');

test('la guarda de «precio a mano» ve todas las formas de escribir un precio (y solo deja pasar el «desde» de rangoDePrecios, tal cual)', () => {
  for (const precio of ['$14.000', '$ 14.000', '$14000', '14.000 COP', '14000 COP', '49.000 pesos', '49.000   pesos', 'COP 14.000', 'COP$14.000', '14 mil pesos', 'desayunos desde 9.000 COP', 'sopa a 7.000 pesos', '4.000 COP']) {
    assert.deepEqual(preciosAMano(`Texto con ${precio} en medio.`).length > 0, true, `no vio «${precio}»`);
  }
  for (const ok of ['en pesos colombianos', 'Rango de precios: $$, en pesos colombianos.', 'precio (COP), sin decimales', '$$', 'de 10 a 30 personas', 'el precio 0 es un descuento', 'wa.me/573225542434', `dato: ${R.rangoDePrecios}`]) {
    assert.deepEqual(preciosAMano(ok), [], `«${ok}» no es un precio`);
  }
  const desde = R.rangoDePrecios.match(/desde\s+\d[\d.]*\s*(?:COP|pesos)/i)?.[0];
  assert.ok(desde, 'rangoDePrecios trae un «desde N COP»: es lo único que la guarda deja pasar');
  assert.deepEqual(preciosAMano(`Referencia: ${desde}.`), [], 'el «desde» de rangoDePrecios, tal cual, es la excepción');
  assert.deepEqual(preciosAMano(`Referencia: ${desde.replace(/\d/, '9')}.`).length > 0, true, 'un «desde» con otra cifra no lo es');
});

test('descubrimiento.mjs --listar nombra todo lo que genera (la guarda de abajo recorre esa lista, así que un archivo nuevo entra solo)', () => {
  assert.ok(GENERADOS.length >= 30, `solo ${GENERADOS.length} archivos listados`);
  for (const esperado of ['llms.txt', 'local.json', 'pricing.md', 'pricing.html', 'index.md', 'carta.md', 'api/openapi.json', 'openapi.json', 'api/index.md', '404.html', '.well-known/ard.json', 'skills/consultar-resplandor/SKILL.md']) {
    assert.ok(GENERADOS.includes(esperado), `--listar no nombra ${esperado}`);
  }
  for (const archivo of GENERADOS) assert.ok(fs.existsSync(ruta(archivo)), `--listar nombra ${archivo}, que no existe: ¿falta regenerar?`);
});

for (const archivo of GENERADOS) {
  test(`${archivo}: ningún precio en pesos escrito a mano en NINGUNA forma («$14.000», «$ 14.000», «14.000 COP», «49.000 pesos»); solo el «desde» de rangoDePrecios, tal cual`, () => {
    assert.deepEqual(preciosAMano(leer(archivo)), []);
  });
}

test('index.html: el JSON-LD generado (entre los marcadores) no lleva ningún precio a mano en ninguna forma', () => {
  const html = leer('index.html');
  const bloque = html.slice(html.indexOf('<!-- datos-estructurados:inicio -->'), html.indexOf('<!-- datos-estructurados:fin -->'));
  assert.ok(bloque.includes('"@type": "Restaurant"'), 'no encontré el JSON-LD entre los marcadores');
  assert.deepEqual(preciosAMano(bloque), []);
});

// ───────────────────────── páginas HTML: catering/desayuno/domicilio-evento, sin excepción ─────────────────────────

// La misma regex que exige docs/identidad-visual.md (§13-A4 del brief v2) para «eventos a
// domicilio»: en la MISMA oración (nunca cruza un punto), sin importar en qué orden caigan
// «a domicilio» y «evento»/«celebraci» — así una frase como «recoges en el local o te lo
// llevamos a domicilio» (el almuerzo programado, que SÍ puede salir del local, y no menciona
// evento/celebración en su misma oración) no choca con esto, pero SÍ choca tanto «a domicilio
// para eventos» como «las celebraciones también las llevamos a domicilio» (mutante de
// refutación M31, ronda 1 de la v2: la versión anterior de esta regex solo miraba el orden
// «a domicilio … evento», así que la frase al revés —«celebraciones … a domicilio»— pasaba
// con la suite verde).
const RE_DOMICILIO_EVENTO = /(?:a domicilio[^.]*?(?:evento|celebraci)|(?:evento|celebraci)[^.]*?a domicilio)/i;

for (const pagina of PAGINAS_HTML) {
  test(`${pagina}: no menciona catering ni «a domicilio» para un evento (la cara pública no habla de eso, ni para ofrecerlo ni para negarlo)`, () => {
    const html = leer(pagina);
    const fallas = [];
    if (/\bcatering\b/i.test(html)) fallas.push('menciona "catering"');
    const m = html.match(RE_DOMICILIO_EVENTO);
    if (m) fallas.push(`«a domicilio» junto a un evento/celebración: "${m[0]}"`);
    assert.deepEqual(fallas, []);
  });
}

// ───────────────────────── llms.txt / local.json: catering/desayuno solo si están negados ─────────────────────────

// Un agente SÍ necesita leer la política en negativo («nunca a domicilio», «ni catering
// externo»): acá la trampa no es la palabra sola, es la palabra SIN una negación cerca —
// eso sería una oferta real colada en el archivo que un agente cita tal cual.
const NEGACION_CERCA = /\b(nunca|jamás|ni|no hay|sin|no se ofrece|no ofrecemos)\b/i;
function apareceSinNegar(texto, reOfrecimiento, ventana = 60) {
  const encontrados = [];
  const re = new RegExp(reOfrecimiento.source, reOfrecimiento.flags.includes('g') ? reOfrecimiento.flags : reOfrecimiento.flags + 'g');
  let m;
  while ((m = re.exec(texto))) {
    const desde = Math.max(0, m.index - ventana);
    const hasta = Math.min(texto.length, m.index + m[0].length + ventana);
    if (!NEGACION_CERCA.test(texto.slice(desde, hasta))) encontrados.push(m[0]);
  }
  return encontrados;
}

for (const archivo of [...ARCHIVOS_DATO, ...ARCHIVOS_AGENTES]) {
  test(`${archivo}: si menciona catering, es SIEMPRE dentro de una negación (nunca una oferta real)`, () => {
    const texto = leer(archivo);
    const fallas = [];
    for (const hallado of apareceSinNegar(texto, /catering/i)) fallas.push(`"catering" sin una negación cerca: "${hallado}"`);
    assert.deepEqual(fallas, []);
  });

  test(`${archivo}: si menciona «a domicilio» junto a un evento/celebración, es SIEMPRE dentro de una negación`, () => {
    const texto = leer(archivo);
    const hallados = apareceSinNegar(texto, RE_DOMICILIO_EVENTO);
    assert.deepEqual(hallados, [], `«a domicilio» + evento sin negación cerca: ${hallados.join(' | ')}`);
  });
}

for (const archivo of ARCHIVOS_DATO) {
  // Desde el 2026-10-01 el desayuno es un dato del local (7:00–11:00, todos los días): lo lee un
  // agente aquí. Lo que sigue prohibido es inventarle platos o precios (no hay ninguno en los afiches).
  test(`${archivo}: dice el horario de los desayunos (7:00 a 11:00, todos los días) y no le inventa platos ni precios`, () => {
    const texto = leer(archivo);
    assert.match(texto, /desayunos/i, 'falta el horario de los desayunos');
    assert.match(texto, /7:00/, 'el desayuno abre a las 7:00');
    assert.match(texto, /\b11:00/, 'el desayuno cierra a las 11:00');
    assert.doesNotMatch(texto, /desayunos?[^.\n]{0,80}\$\s?\d|\$\s?\d[^.\n]{0,80}desayunos?/i, 'un precio de desayuno a mano');
  });
}

// ───────────────────────── «de 10 a 30 personas»: donde tiene que estar ─────────────────────────

// Extrae una <section id="…">…</section> de index.html contando hasta el siguiente
// <section (esta landing no anida secciones — ver el propio marcado: 9 secciones, todas al
// mismo nivel) o hasta el final del documento si es la última.
function extraerSeccion(html, id) {
  const marcador = new RegExp(`<section\\b[^>]*\\bid=["']${id}["']`, 'i');
  const m = marcador.exec(html);
  assert.ok(m, `no encontré <section id="${id}"> en index.html (¿cambió el id? revisá esta prueba)`);
  const desde = m.index;
  const siguiente = html.slice(desde + m[0].length).search(/<section\b/i);
  return siguiente === -1 ? html.slice(desde) : html.slice(desde, desde + m[0].length + siguiente);
}

test('index.html: la sección #celebraciones dice «de 10 a 30 personas» (el mínimo real de evento, no solo «hasta 30»)', () => {
  const seccion = extraerSeccion(leer('index.html'), 'celebraciones');
  assert.match(seccion, /de 10 a 30 personas/, 'la sección de celebraciones debería decir "de 10 a 30 personas", no solo un máximo');
});

test('llms.txt dice «de 10 a 30 personas» para eventos/celebraciones/paquetes (lo que lee un agente sin ejecutar JS)', () => {
  assert.match(leer('llms.txt'), /de 10 a 30 personas/);
});

test('local.json: minimoPersonasEvento es 10 y capacidad es 30 (el «de 10 a 30» como dato, no solo como prosa)', () => {
  const local = JSON.parse(leer('local.json'));
  assert.equal(local.minimoPersonasEvento, 10);
  assert.equal(local.capacidad, 30);
  assert.equal(local.solicitud?.reglas?.minPersonasEvento, 10);
  assert.equal(local.solicitud?.reglas?.maxPersonas, 30);
});

// ───────────────────────── datos visibles de index.html: guardas por texto exacto ─────────────────────────
// §13-A5 pedía una trampa que mirara el texto visible de verdad, no solo que existan pruebas
// de cálculo. Ronda 1 de refutación de la v2 (scratchpad/refutar-v2/mutantes.json): con la
// suite en verde sobrevivían M1 (WhatsApp), M2 (reseñas infladas), M3 (horario de noche), M4
// (celebraciones «en tu casa, de 5 a 50»), M5 (dirección cambiada), M6 (capacidad a 60), M7
// (testimonio inventado), M8 (promo/cenas de noche) y M9 (nombre de plato en #platos). Cada
// prueba de acá nombra, en su descripción, el mutante que cierra.

test('index.html: el WhatsApp visible sigue siendo +57 322 554 2434 / wa.me/573225542434 (mutante M1)', () => {
  const html = leer('index.html');
  const fallas = [];
  if (!html.includes('https://wa.me/573225542434')) fallas.push('ningún enlace usa https://wa.me/573225542434 (¿cambió el número?)');
  if (!/\+57 322 554 2434/.test(html)) fallas.push('no aparece el teléfono visible +57 322 554 2434');
  assert.deepEqual(fallas, []);
});

test('index.html: «5,0 en Google Maps · 2 reseñas» sigue siendo el dato real (mutante M2: no se infla a 4,9 · 120)', () => {
  const normalizado = leer('index.html').replace(/\s+/g, ' ');
  assert.ok(normalizado.includes('5,0 en Google Maps · 2 reseñas'), 'falta (o cambió) «5,0 en Google Maps · 2 reseñas»');
  assert.doesNotMatch(normalizado, /4,9 en Google Maps|120 reseñas/);
});

test('index.html: el horario visible es almuerzo 12:00–17:00 y desayunos 7:00–11:00 (mañana y mediodía), nunca de noche (mutante M3)', () => {
  const html = leer('index.html');
  const normalizado = html.replace(/\s+/g, ' ');
  const fallas = [];
  if (!/12:00–17:00/.test(html)) fallas.push('falta (o cambió) «12:00–17:00»');
  if (!normalizado.includes('Almuerzos todos los días, 12:00 a 5:00 de la tarde')) fallas.push('falta (o cambió) «Almuerzos todos los días, 12:00 a 5:00 de la tarde»');
  // Desayunos (2026-10-01): la frase de los afiches, tal cual, y el 7:00–11:00 de las franjas cortas.
  if (!normalizado.includes('Desayunos todos los días · 7:00 a.m. – 11:00 a.m.')) fallas.push('falta (o cambió) «Desayunos todos los días · 7:00 a.m. – 11:00 a.m.»');
  if (!/Desayunos 7:00–11:00/.test(html)) fallas.push('falta «Desayunos 7:00–11:00» (la franja superior)');
  // Cada vez que el texto habla de desayunos, lo que sigue (hasta que empiece a hablar de almuerzo) no es de la tarde ni de la noche.
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const m of texto.matchAll(/desayunos?/gi)) {
    const tramo = texto.slice(m.index, m.index + 90).split(/almuerzo/i)[0];
    if (/\bp\.?\s?m\b|tarde|noche|\b(?:1[2-9]|2[0-3]):\d\d/i.test(tramo)) fallas.push(`un desayuno que no es de la mañana: «${tramo.trim()}»`);
  }
  if (/12:00–22:00/.test(html)) fallas.push('aparece un horario de noche «12:00–22:00»');
  if (/de la noche\b/i.test(html)) fallas.push('el horario menciona «de la noche» (se sugiere servicio nocturno)');
  assert.deepEqual(fallas, []);
});

test('index.html: el hero (#inicio) sigue diciendo «Celebraciones en el local, de 10 a 30 personas» (mutante M4: no «en tu casa, de 5 a 50»)', () => {
  const normalizado = leer('index.html').replace(/\s+/g, ' ');
  assert.ok(normalizado.includes('Celebraciones en el local, de 10 a 30 personas.'), 'el hero debería decir esto en su lista de tres puntos');
  assert.doesNotMatch(normalizado, /en tu casa, de 5 a 50 personas/);
});

test('index.html: la dirección de #como-llegar sigue siendo Cra. 61 #79 Sur-62 (mutante M5)', () => {
  const html = leer('index.html');
  const normalizado = html.replace(/\s+/g, ' ');
  const fallas = [];
  if (!html.includes('<p class="font-medium">Cra. 61 #79 Sur-62, Poblado del Sur</p>')) fallas.push('cambió el párrafo de dirección de #como-llegar');
  if (!normalizado.includes('en la Cra. 61 #79 Sur-62.')) fallas.push('cambió el pie de foto «Busca este letrero… en la Cra. 61 #79 Sur-62.»');
  if (/Cra\. 16\b/.test(html)) fallas.push('aparece «Cra. 16»');
  assert.deepEqual(fallas, []);
});

test('index.html: la capacidad visible sigue siendo 30, nunca 60 (mutante M6)', () => {
  const html = leer('index.html');
  const normalizado = html.replace(/\s+/g, ' ');
  const fallas = [];
  if (!html.includes('30 personas en el salón')) fallas.push('#la-casa ya no dice «30 personas en el salón»');
  if (!normalizado.includes('Hasta 30 personas. Es el mismo')) fallas.push('la FAQ de capacidad ya no dice «Hasta 30 personas. Es el mismo»');
  if (!html.includes('Mesas de madera para 30 personas')) fallas.push('#la-casa ya no dice «Mesas de madera para 30 personas»');
  if (/\b60 personas\b/.test(html)) fallas.push('aparece «60 personas»');
  assert.deepEqual(fallas, []);
});

test('index.html: sin testimonios inventados (mutante M7: ningún <blockquote> ni cita atribuida)', () => {
  const html = leer('index.html');
  assert.doesNotMatch(html, /<blockquote/i, 'index.html no debería tener testimonios (§15: sin testimonios)');
});

// 2026-10-01: la regla «sin promociones» se levantó (pedido de Yonatan): la landing muestra los afiches
// de la semana en #promociones (promos.test.mjs la vigila). Sigue sin haber «cenas» ni servicio de noche.
test('index.html: sin «cenas» nocturnas (mutante M8), y el tercer punto del hero sigue siendo el menú semanal', () => {
  const html = leer('index.html');
  const normalizado = html.replace(/\s+/g, ' ');
  assert.doesNotMatch(html, /\bcenas?\b[^.<]{0,60}\bnoche\b|\bnoche\b[^.<]{0,60}\bcenas?\b/i, 'index.html no debería sugerir cenas de noche');
  assert.ok(normalizado.includes('Un menú de la semana que la gente vota.'), 'el tercer punto del hero debería seguir siendo el menú semanal');
});

test('index.html: #platos no lleva ningún nombre de plato (mutante M9: sin lista «Tacos Resplandor · Bowl … · Arepa …»)', () => {
  const seccion = extraerSeccion(leer('index.html'), 'platos');
  // Hoy #platos no usa el punto medio «·» en ningún texto real (solo separa nombres de
  // plato, que esta sección no debe llevar — §7.3: «Sin nombres de plato ni precios»).
  assert.ok(!seccion.includes('·'), '#platos tiene un «·», señal de una lista de nombres de plato colada en el marcado estático');
});

// ───────────────────────── mutantes de control (el hallazgo de refutación, repetido a propósito) ─────────────────────────

// Los dos mutantes concretos que probaron, en su momento, que la suite pasaba en verde SIN
// esta trampa (ver el encabezado de este archivo). Se reproducen acá, en memoria (nunca se
// escriben al árbol de trabajo real), para dejar Constancia de que la regex de arriba de
// verdad los atrapa — y para que, si algún día alguien afloja la regex sin querer, este
// mismo archivo lo note.
test('mutante de control 1: "hasta 500 personas… catering a domicilio para eventos… $45.000" SÍ falla contra las prohibiciones absolutas y de dominio', () => {
  const mutado = 'Cumpleaños, quinces, aniversarios: aquí, hasta 500 personas, también catering a domicilio para eventos, desde $45.000.';
  assert.ok(PROHIBICIONES_ABSOLUTAS.some(({ re }) => re.test(mutado)), 'el mutante 1 debería chocar con alguna prohibición absoluta');
  assert.ok(/\bcatering\b/i.test(mutado));
  assert.ok(RE_DOMICILIO_EVENTO.test(mutado));
});

test('mutante de control 2: "hasta 30 personas. Desayunos desde $12.000." SÍ falla (precio de desayuno a mano: no hay ninguno en los afiches)', () => {
  const mutado = 'Celebra en el local, hasta 30 personas. Desayunos desde $12.000.';
  assert.ok(PROHIBICIONES_ABSOLUTAS.some(({ re }) => re.test(mutado)), 'el mutante 2 debería chocar con la prohibición del precio a mano');
  assert.ok(/desayunos?[^.\n]{0,80}\$\s?\d/i.test(mutado), 'y con la guardia de «precio de desayuno» de llms.txt/local.json');
  assert.ok(!/de 10 a 30 personas/.test(mutado), 'el mutante 2 tampoco trae la frase exigida — otra señal de que es el texto viejo');
});
