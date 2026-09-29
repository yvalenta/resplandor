// La «trampa de reglas» que el contrato pedía y no existía (r0: «Ninguna prueba lee
// index.html buscando "30 personas", catering, domicilio de eventos, 500/150 personas,
// +2.000, desayuno ni "$" seguido de un dígito. Los datos que mandan en el texto visible
// quedan sin guardia: una regresión del texto pasa con la suite verde.» — repro con dos
// mutantes concretos, ver más abajo). Lee index.html, carta.html, menu.html, llms.txt y
// local.json — las cinco superficies que una persona o un agente pueden leer — y falla si
// alguna vuelve a decir lo que los datos que mandan (docs/landing-y-agentes.md) prohíben:
// una capacidad inflada («500 personas», «150 personas», «+2.000»), catering, un evento a
// domicilio, desayunos, o un precio en pesos escrito a mano fuera de lo que sirve la carta
// EN VIVO (Supabase). También exige que la frase «de 10 a 30 personas» aparezca donde tiene
// que aparecer: en la sección de celebraciones de index.html, y en llms.txt/local.json
// (las dos superficies que un agente lee sin ejecutar JavaScript).
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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => path.join(RAIZ, ...p);
const leer = (p) => fs.readFileSync(ruta(p), 'utf8');

const PAGINAS_HTML = ['index.html', 'carta.html', 'menu.html'];
const ARCHIVOS_DATO = ['llms.txt', 'local.json'];
const TODOS = [...PAGINAS_HTML, ...ARCHIVOS_DATO];

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
  test(`${pagina}: no menciona catering, desayuno(s) ni «a domicilio» para un evento (la cara pública no habla de eso, ni para ofrecerlo ni para negarlo)`, () => {
    const html = leer(pagina);
    const fallas = [];
    if (/\bcatering\b/i.test(html)) fallas.push('menciona "catering"');
    if (/\bdesayuno(s)?\b/i.test(html)) fallas.push('menciona "desayuno(s)"');
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

for (const archivo of ARCHIVOS_DATO) {
  test(`${archivo}: si menciona catering o desayuno, es SIEMPRE dentro de una negación (nunca una oferta real)`, () => {
    const texto = leer(archivo);
    const fallas = [];
    for (const hallado of apareceSinNegar(texto, /catering/i)) fallas.push(`"catering" sin una negación cerca: "${hallado}"`);
    for (const hallado of apareceSinNegar(texto, /desayuno(s)?/i)) fallas.push(`"desayuno(s)" sin una negación cerca: "${hallado}"`);
    assert.deepEqual(fallas, []);
  });

  test(`${archivo}: si menciona «a domicilio» junto a un evento/celebración, es SIEMPRE dentro de una negación`, () => {
    const texto = leer(archivo);
    const hallados = apareceSinNegar(texto, RE_DOMICILIO_EVENTO);
    assert.deepEqual(hallados, [], `«a domicilio» + evento sin negación cerca: ${hallados.join(' | ')}`);
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

test('index.html: el horario visible es 12:00–17:00 (mediodía), nunca de noche (mutante M3)', () => {
  const html = leer('index.html');
  const normalizado = html.replace(/\s+/g, ' ');
  const fallas = [];
  if (!/12:00–17:00/.test(html)) fallas.push('falta (o cambió) «12:00–17:00»');
  if (!normalizado.includes('Todos los días, 12:00 a 5:00 de la tarde')) fallas.push('falta (o cambió) «Todos los días, 12:00 a 5:00 de la tarde»');
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

test('index.html: sin promociones ni «cenas» nocturnas en el hero (mutante M8), y el tercer punto sigue siendo el menú semanal', () => {
  const html = leer('index.html');
  const normalizado = html.replace(/\s+/g, ' ');
  assert.doesNotMatch(html, /\bpromo\b/i, 'index.html no debería mencionar promociones (datos que mandan: sin promos)');
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

test('mutante de control 2: "hasta 30 personas. Desayunos desde $12.000." SÍ falla (desayuno + precio a mano)', () => {
  const mutado = 'Celebra en el local, hasta 30 personas. Desayunos desde $12.000.';
  assert.ok(/\bdesayuno(s)?\b/i.test(mutado));
  assert.ok(PROHIBICIONES_ABSOLUTAS.some(({ re }) => re.test(mutado)), 'el mutante 2 debería chocar con la prohibición del precio a mano');
  assert.ok(!/de 10 a 30 personas/.test(mutado), 'el mutante 2 tampoco trae la frase exigida — otra señal de que es el texto viejo');
});
