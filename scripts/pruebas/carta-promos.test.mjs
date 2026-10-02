// La carta con desayunos, promociones de la semana y etiquetas (tarea carta-promos, parte CARTA, 2026-10-01).
//
// El pedido de Yonatan (afiches oficiales en ~/Developer/resplandor/marketing/):
//   - «Sopa y carne» ($14.000) incluye jugo; «Sopa» y «Carne» a $7.000 cada una; el sancocho trifásico se
//     programa 1 o 2 veces al mes en fines de semana → «Algunos fines de semana». Eso llega como una
//     ETIQUETA (columna nueva `etiqueta` de la vista `carta_publica`): una pastilla pequeña y sutil junto al nombre.
//   - Sección nueva Desayunos: todos los días, 7:00 a.m. – 11:00 a.m. Los platos y precios NO están en ningún
//     afiche: mientras no haya filas, la carta lo dice («Pregunta por los desayunos del día») y no inventa nada.
//   - Promociones de cada día (lunes a domingo): `dia_semana` 1..7. Las de precio fijo muestran su precio; las de
//     descuento (3er almuerzo 20% OFF, 2 x 1) van con precio 0 y una etiqueta, y la carta NUNCA muestra «$ 0».
//     La de HOY sale resaltada («Hoy») según la hora de Bogotá, aunque el teléfono esté en otra zona, y sube a
//     una franja corta bajo el menú del día con enlace a #promociones.
//   - Compatibilidad: con la vista de antes (sin etiqueta ni dia_semana) PostgREST contesta 400 y la carta vuelve a
//     pedir las cuatro columnas de siempre: se ve como hoy, sin etiquetas ni promociones.
//
// Tres partes, como carta-abonos.test.mjs:
//   1. ESTÁTICA: el pedido de la vista, el precio con su guarda, el orden de las secciones y el CSS sin hex.
//   2. EL SCRIPT de carta.html corrido en un vm con reloj virtual (corre siempre): secciones, etiquetas, días,
//      «hoy» en Bogotá bajo otras zonas del proceso, y la compatibilidad con la base de antes.
//   3. EN NAVEGADOR (solo con Playwright y Chromium, ver _navegador.mjs): la carta con datos simulados a 320, 390
//      y 1280 px, con el reloj del navegador en Tokio mientras en Bogotá es jueves; sin desborde, sin errores.
//      Con CAPTURAS_CARTA=<carpeta> también guarda las capturas (el mismo escenario, sin otra copia).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crearCarta, RAIZ } from './_carta-vm.mjs';
import { filasDeLaVista, responderVista, PROMOCIONES, DESAYUNOS } from './_carta-datos.mjs';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const plano = (x) => JSON.parse(JSON.stringify(x)); // trae a este realm lo que salió de un `vm`

// ───────────────────────── 1. estática ─────────────────────────

test('estática: la vista se pide con etiqueta y dia_semana y, solo ante un 400, otra vez con las cuatro columnas de siempre (nunca select=*)', () => {
  const html = sinComentarios(leer('carta.html'));
  assert.match(html, /const COLUMNAS_VISTA = 'categoria,nombre,precio,descripcion,etiqueta,dia_semana';/);
  assert.match(html, /const COLUMNAS_VISTA_ANTERIOR = 'categoria,nombre,precio,descripcion';/);
  assert.match(html, /if \(r\.status === 400\) r = await pedir\(COLUMNAS_VISTA_ANTERIOR\);/, 'el segundo pedido solo ocurre con 400 (la columna no existe), no con 402/5xx');
  assert.equal(html.match(/carta_publica\?select=/g).length, 1, 'un solo lugar arma la URL de la vista');
  assert.doesNotMatch(html, /select=\*/);
});

test('estática: el precio solo se pinta con precio > 0 (ningún pesos(p.precio) sin su guarda) y la etiqueta ocupa el lugar del precio: nunca «$ 0»', () => {
  const html = sinComentarios(leer('carta.html'));
  const usos = [...html.matchAll(/x-text="pesos\(p\.precio\)"/g)];
  assert.equal(usos.length, 2, 'el precio de la franja de hoy y el de cada plato');
  for (const m of usos) {
    assert.match(html.slice(Math.max(0, m.index - 260), m.index), /<template x-if="p\.precio > 0">\s*<span [^>]*$/, 'el precio va dentro de <template x-if="p.precio > 0">: el DOM ni siquiera tiene «$ 0»');
  }
  const marcas = [...html.matchAll(/<template x-if="!\(p\.precio > 0\) && p\.etiqueta">\s*<span class="carta-marca[^"]*" x-text="p\.etiqueta"><\/span>/g)];
  assert.equal(marcas.length, 2, 'sin precio, la etiqueta (2 x 1, 20% OFF) sale en su lugar, en la franja y en la lista');
  assert.match(html, /<span class="badge carta-etiqueta" x-show="p\.precio > 0 && p\.etiqueta" x-text="p\.etiqueta"><\/span>/, 'con precio, la etiqueta es una pastilla sutil junto al nombre');
  assert.doesNotMatch(html, /x-html/);
});

test('estática: el ancla de la URL (carta.html#promociones) se atiende cuando la carta en vivo ya está pintada, no antes', () => {
  const html = sinComentarios(leer('carta.html'));
  assert.match(html, /if \(vivo\) \{ this\.armar\(vivo, 'vivo'\); this\.pintar\(\); this\.irAlAncla\(\); \}/, 'se llama justo después de pintar la carta en vivo (la sección nace ahí)');
  assert.equal(html.match(/this\.irAlAncla\(\)/g).length, 1, 'una sola llamada: con la foto la sección no existe todavía');
  assert.match(html, /if \(!id \|\| scrollY > 40\) return;/, 'quien ya se movió no se arrastra');
  assert.match(html, /el\.matches\('main section\[id\]'\)/, 'solo hacia una sección de la carta');
});

test('estática: Desayunos con su nota de horario y su texto honesto, Promociones con id estable #promociones y la franja de hoy enlaza a ella', () => {
  const html = sinComentarios(leer('carta.html'));
  assert.match(html, /'Desayunos':\s+\{ id: 'desayunos',\s+titulo: 'Desayunos', nota: 'Todos los días · 7:00 a\.m\. – 11:00 a\.m\.'/);
  assert.match(html, /vacio: 'Pregunta por los desayunos del día\.'/);
  assert.match(html, /'Promociones':\s+\{ id: 'promociones', titulo: 'Promociones de la semana', corto: 'Promociones'/);
  assert.match(html, /<a class="carta-hoy card card-soft" href="#promociones">/);
  assert.match(html, /<template x-if="!sec\.platos\.length">\s*<p class="card card-soft carta-vacia" x-text="sec\.vacio"><\/p>/);
  // La franja de hoy cuelga de #dia y no es una sección (no entra en las pestañas ni en el scroll-spy).
  assert.ok(html.indexOf('</section>', html.indexOf('<section id="dia"')) < html.indexOf('class="carta-hoy card card-soft"'), 'la franja va después del menú del día');
  assert.ok(html.indexOf('class="carta-hoy card card-soft"') < html.indexOf('<template x-for="(sec, si) in secciones"'), 'y antes de las secciones');
  assert.doesNotMatch(html.slice(html.indexOf('<template x-if="promosHoy.length">'), html.indexOf('<template x-for="(sec, si) in secciones"')), /<section\b/);
});

test('estática: el CSS nuevo sale de los tokens (ni un hex ni un rgb suelto) y las clases que usa el marcado existen', () => {
  const css = leer('assets/css/carta-menu.css');
  const bloque = css.slice(css.indexOf('/* ── Etiquetas y promociones (carta.html) ──'), css.indexOf('/* ═══════════════════ Escritorio de carta.html'));
  assert.ok(bloque.length > 800, 'no encontré el bloque de etiquetas y promociones en carta-menu.css');
  assert.doesNotMatch(bloque, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(bloque, /\brgba?\(/);
  for (const clase of ['carta-etiqueta', 'carta-marca', 'carta-dia', 'carta-plato--hoy', 'carta-hoy', 'carta-hoy-cabeza', 'carta-hoy-ver', 'carta-vacia']) {
    assert.match(bloque, new RegExp(`\\.${clase}\\b`), `falta .${clase} en carta-menu.css`);
    assert.match(leer('carta.html'), new RegExp(`\\b${clase}\\b`), `carta.html no usa ${clase}`);
  }
});

test('estática: el pie de la carta dice el horario de los desayunos junto al de siempre, sin precios', () => {
  const pie = sinComentarios(leer('carta.html')).match(/<footer class="carta-pie[\s\S]*?<\/footer>/)[0];
  assert.match(pie, /<p>Desayunos todos los días, 7:00–11:00<\/p>/);
  assert.match(pie, /<p>Todos los días, 12:00–17:00<\/p>/);
  assert.doesNotMatch(pie, /\$\s?\d/);
});

// ───────────────────────── 2. el script en un vm ─────────────────────────

/** La carta (sin mesa) con la vista simulada, lista para mirar. */
async function conVista({ vista = {}, ...resto } = {}) {
  const h = await crearCarta({ search: '', vista, ...resto });
  await h.iniciar();
  return h;
}
const seccion = (h, id) => plano(h.c.secciones.find((s) => s.id === id));
const nombres = (s) => s.platos.map((p) => p.nombre);
const ids = (h) => plano(h.c.secciones).map((s) => s.id);

test('vm, base ya migrada: Desayunos, Ejecutivos, Entradas, Platos fuertes, Bebidas y al final Promociones; las pestañas igual (la última, «Promociones»)', async () => {
  const h = await conVista();
  assert.equal(h.c.fuente, 'vivo');
  assert.deepEqual(ids(h), ['desayunos', 'ejecutivos', 'entradas', 'fuertes', 'bebidas', 'promociones']);
  assert.deepEqual(plano(h.c.tabs).map((t) => t.titulo), ['Del día', 'Desayunos', 'Ejecutivos', 'Entradas', 'Platos fuertes', 'Bebidas', 'Promociones']);
  assert.deepEqual(plano(h.c.tabs).map((t) => t.icono), ['sparkles', 'coffee', 'utensils-crossed', 'salad', 'beef', 'cup-soda', 'badge-percent']);
  assert.equal(seccion(h, 'promociones').titulo, 'Promociones de la semana');
  assert.equal(h.llamadas.vista, 1, 'la base ya migrada contesta a la primera');
  assert.match(h.llamadas.vistas[0], /select=categoria,nombre,precio,descripcion,etiqueta,dia_semana$/);
});

test('vm, Desayunos: la sección existe aunque no haya platos (nota de horario de los afiches y texto honesto), y con platos cargados los muestra', async () => {
  const h = await conVista();
  const d = seccion(h, 'desayunos');
  assert.equal(d.nota, 'Todos los días · 7:00 a.m. – 11:00 a.m.');
  assert.deepEqual(d.platos, []);
  assert.equal(d.vacio, 'Pregunta por los desayunos del día.');
  // Con la carta de respaldo (la vista caída) también existe: el horario no depende de la base.
  const foto = await conVista({ vista: { status: 402 } });
  assert.equal(foto.c.fuente, 'foto');
  assert.deepEqual(ids(foto).slice(0, 2), ['desayunos', 'ejecutivos']);
  assert.deepEqual(seccion(foto, 'desayunos').platos, []);
  // El día que carguen platos, salen en su sección (el nombre es de prueba: ningún afiche trae uno).
  const filas = [...filasDeLaVista(), { categoria: 'Desayunos', nombre: 'Desayuno de prueba', precio: 1000, descripcion: '', etiqueta: null, dia_semana: null }];
  const con = await conVista({ vista: { filas } });
  assert.deepEqual(nombres(seccion(con, 'desayunos')), ['Desayuno de prueba']);
});

test('vm, Desayunos con los tres platos del letrero: salen de menor a mayor precio, con su descripción, y el texto honesto ya no aparece', async () => {
  const h = await conVista({ vista: { filas: filasDeLaVista({ desayunos: true }) } });
  const d = seccion(h, 'desayunos');
  assert.equal(d.nota, 'Todos los días · 7:00 a.m. – 11:00 a.m.', 'la nota de horario sigue');
  assert.deepEqual(plano(d.platos).map((p) => [p.nombre, p.precio]), [['Desayuno sencillo', 9000], ['Desayuno Resplandor', 12000], ['Calentado Resplandor', 17000]]);
  assert.deepEqual(plano(d.platos).map((p) => p.desc), ['Desayuno sencillo', 'Desayuno Resplandor', 'Calentado Resplandor'].map((n) => DESAYUNOS.find((f) => f.nombre === n).descripcion));
  assert.ok(d.platos.every((p) => !p.etiqueta && !p.dia), 'sin etiqueta ni día: solo Promociones usa el día');
  assert.deepEqual(ids(h), ['desayunos', 'ejecutivos', 'entradas', 'fuertes', 'bebidas', 'promociones'], 'el orden de las secciones no cambia');
});

test('vm, Ejecutivos: «Sopa y carne» incluye jugo, «Sopa» y «Carne» a $7.000 aparecen solos, el sancocho lleva «Algunos fines de semana» y su descripción repetida no se muestra', async () => {
  const h = await conVista();
  const e = seccion(h, 'ejecutivos');
  assert.deepEqual(e.platos.map((p) => [p.nombre, p.precio, p.etiqueta]), [
    ['Sopa', 7000, ''],
    ['Carne', 7000, ''],
    ['Sopa y carne', 14000, 'Incluye jugo'],
    ['Seco', 19000, ''],
    ['Sancocho trifasico', 20000, 'Algunos fines de semana'],
  ]);
  assert.equal(e.platos.find((p) => p.nombre === 'Sancocho trifasico').desc, '', '«Sancocho trifasico» como descripción de «Sancocho trifasico» no aporta nada');
  assert.equal(e.platos.find((p) => p.nombre === 'Seco').desc, 'Arroz, proteína, guarnición y ensalada (sin sopa ni frijol)', 'una descripción de verdad se queda');
  assert.equal(h.c.dia.precio, 23000, 'el Menú Resplandor sigue siendo la tarjeta del día');
});

test('vm, Promociones: los siete días de lunes a domingo con su texto; las de descuento van con precio 0 y etiqueta, las de precio fijo con su precio', async () => {
  const h = await conVista({ vista: { filas: [...filasDeLaVista()].reverse() } }); // llegan desordenadas: la carta las ordena por día
  const p = seccion(h, 'promociones');
  assert.deepEqual(p.platos.map((x) => x.dia), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(p.platos.map((x) => [x.nombre, x.precio, x.etiqueta]), [
    ['3er almuerzo', 0, '20% OFF'],
    ['Combo hamburguesas', 50000, ''],
    ['Cócteles, jugos y sodas', 0, '2 x 1'],
    ['Dupleta de papas', 39000, ''],
    ['Picada + jarra de Cantarito', 160000, ''],
    ['Entradas de la carta', 0, '2 x 1'],
    ['Almuerzos', 20000, ''],
  ]);
  assert.deepEqual(p.platos.map((x) => x.desc), PROMOCIONES.map((x) => x.descripcion), 'el texto de cada afiche, sin tocar');
  for (const x of p.platos.filter((y) => y.precio === 0)) assert.ok(x.etiqueta, `${x.nombre}: sin precio hay etiqueta (si no, la carta no tendría nada que mostrar)`);
  // El día solo cuenta en las promociones: un día suelto en otra categoría no se muestra.
  const filas = filasDeLaVista().map((f) => (f.nombre === 'Seco' ? { ...f, dia_semana: 3 } : f));
  const otra = await conVista({ vista: { filas } });
  assert.equal(seccion(otra, 'ejecutivos').platos.find((x) => x.nombre === 'Seco').dia, 0);
});

// «Hoy» es el de Bogotá (UTC−5): mediodía de cada día de la semana del lunes 28 de septiembre de 2026.
const MEDIODIA_BOGOTA = { 1: '2026-09-28T17:00:00Z', 2: '2026-09-29T17:00:00Z', 3: '2026-09-30T17:00:00Z', 4: '2026-10-01T17:00:00Z', 5: '2026-10-02T17:00:00Z', 6: '2026-10-03T17:00:00Z', 7: '2026-10-04T17:00:00Z' };

test('vm, hoy: cada día de la semana resalta SU promoción (lunes a domingo) y esa es la de la franja de arriba', async () => {
  for (const [dia, instante] of Object.entries(MEDIODIA_BOGOTA)) {
    const h = await conVista({ ahora: Date.parse(instante) });
    assert.equal(h.c.diaHoy, Number(dia), instante);
    assert.deepEqual(plano(h.c.promosHoy).map((x) => x.nombre), [PROMOCIONES[dia - 1].nombre], `promoción de hoy el día ${dia}`);
    assert.equal(h.c.nombreDia(h.c.diaHoy), ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][dia]);
  }
});

async function bajoZona(zona, fn) {
  const anterior = process.env.TZ;
  process.env.TZ = zona;
  try { return await fn(); } finally { if (anterior === undefined) delete process.env.TZ; else process.env.TZ = anterior; }
}

test('vm, hoy en Bogotá aunque el reloj del dispositivo esté en otra zona: domingo 22:00 y lunes 00:30 de Bogotá, bajo Tokio, Auckland, Madrid, Los Ángeles y UTC', async () => {
  const casos = [
    { instante: '2026-10-05T03:00:00Z', esperado: 7, que: 'domingo 22:00 en Bogotá (en Tokio, Auckland, Madrid y UTC ya es lunes)' },
    { instante: '2026-10-05T05:30:00Z', esperado: 1, que: 'lunes 00:30 en Bogotá (en Los Ángeles todavía es domingo)' },
  ];
  for (const zona of ['Asia/Tokyo', 'Pacific/Auckland', 'Europe/Madrid', 'America/Los_Angeles', 'UTC', 'America/Bogota']) {
    await bajoZona(zona, async () => {
      let discrimina = zona === 'America/Bogota';
      for (const { instante, esperado, que } of casos) {
        // Con el día de la zona del dispositivo (getDay) la respuesta sería otra: la prueba muerde.
        if ((new Date(instante).getDay() || 7) !== esperado) discrimina = true;
        const h = await conVista({ ahora: Date.parse(instante) });
        assert.equal(h.c.diaHoy, esperado, `${que} con TZ=${zona}`);
        assert.deepEqual(plano(h.c.promosHoy).map((x) => x.nombre), [PROMOCIONES[esperado - 1].nombre], `${que} con TZ=${zona}`);
      }
      assert.ok(discrimina, `con TZ=${zona} ninguno de los dos instantes distingue la hora de Bogotá de la del dispositivo`);
    });
  }
});

// Refutación (hallazgo 4): «hoy» se calculaba una vez y nada lo recalculaba; del domingo 23:59:30 al lunes 00:01:30 en Bogotá la franja seguía
// diciendo «Promoción de hoy · Domingo» (una pestaña del celular que se retoma al día siguiente sin recargar).
const DOMINGO_23_59_30 = Date.parse('2026-10-05T04:59:30Z'); // domingo 4 de octubre de 2026, 23:59:30 en Bogotá (lunes 05:59:30 en Madrid)
const nombreDe = (h) => plano(h.c.promosHoy).map((x) => x.nombre);

test('vm, «hoy» sigue al reloj: a la medianoche de Bogotá cambian solos el día, la franja y el menú del día (domingo → lunes → martes), con un solo temporizador que se vuelve a armar', async () => {
  const h = await conVista({ ahora: DOMINGO_23_59_30 });
  assert.deepEqual([h.c.diaHoy, h.c.hayMenu, nombreDe(h)], [7, false, ['Almuerzos']]);
  const j0 = h.c.jornada;
  const t0 = h.c._tJornada;
  assert.ok(t0, 'hay un temporizador a la próxima medianoche');
  await h.avanzar(20000); // 23:59:50: todavía domingo
  assert.deepEqual([h.c.jornada, h.c.diaHoy], [j0, 7]);
  await h.avanzar(11000); // 00:00:01 del lunes
  assert.equal(h.c.jornada, j0 + 1, 'la medianoche (más un segundo) avisó a la página');
  assert.deepEqual([h.c.diaHoy, h.c.hayMenu, nombreDe(h)], [1, true, ['3er almuerzo']]);
  assert.match(h.c.fechaLarga, /^lunes\b/);
  assert.notEqual(h.c._tJornada, t0, 'se volvió a armar para la medianoche siguiente');
  await h.avanzar(86400000); // 00:00:01 del martes
  assert.deepEqual([h.c.jornada, h.c.diaHoy, nombreDe(h)], [j0 + 2, 2, ['Combo hamburguesas']], 'y la siguiente también');
});

test('vm, «hoy» al volver: si el celular congeló el temporizador (pestaña oculta), visibilitychange y pageshow vuelven a calcularlo; con la pestaña oculta no hace nada', async () => {
  const h = await conVista({ ahora: DOMINGO_23_59_30 });
  assert.equal(h.doc.cuantos('visibilitychange'), 1);
  assert.equal(h.ventana.cuantos('pageshow'), 1);
  h.reloj.clear(h.c._tJornada); // el navegador no dispara el temporizador con la pestaña oculta
  await h.avanzar(3 * 3600000); // pasan tres horas: ya es lunes de madrugada y nada se enteró
  const j = h.c.jornada;
  h.documento.visibilityState = 'hidden';
  h.doc.despachar('visibilitychange');
  assert.equal(h.c.jornada, j, 'al ocultarse no recalcula');
  h.documento.visibilityState = 'visible';
  h.doc.despachar('visibilitychange');
  assert.equal(h.c.jornada, j + 1, 'al volver recalcula');
  assert.deepEqual([h.c.diaHoy, nombreDe(h)], [1, ['3er almuerzo']]);
  assert.ok(h.c._tJornada, 'y vuelve a armar el temporizador de la medianoche');
  h.ventana.despachar('pageshow'); // la página restaurada de la caché de ida y vuelta
  assert.equal(h.c.jornada, j + 2);
});

test('vm, el temporizador de la medianoche cuenta con la hora de Bogotá, no la del dispositivo (bajo Tokio, Auckland, Madrid, Los Ángeles y UTC dispara a la misma hora)', async () => {
  for (const zona of ['Asia/Tokyo', 'Pacific/Auckland', 'Europe/Madrid', 'America/Los_Angeles', 'UTC']) {
    await bajoZona(zona, async () => {
      const h = await conVista({ ahora: DOMINGO_23_59_30 });
      const j = h.c.jornada;
      await h.avanzar(30500); // 00:00:00,5: todavía no (dispara a las 00:00:01)
      assert.equal(h.c.jornada, j, `con TZ=${zona} no dispara antes de la medianoche de Bogotá`);
      await h.avanzar(1000);
      assert.equal(h.c.jornada, j + 1, `con TZ=${zona} dispara justo después`);
    });
  }
});

test('vm, la franja de hoy no existe si hoy no hay promoción cargada (la base de antes, o un día sin promoción)', async () => {
  const sinMartes = filasDeLaVista().filter((f) => f.dia_semana !== 2);
  const h = await conVista({ vista: { filas: sinMartes }, ahora: Date.parse(MEDIODIA_BOGOTA[2]) });
  assert.deepEqual(plano(h.c.promosHoy), []);
  assert.equal(seccion(h, 'promociones').platos.length, 6, 'la semana sigue mostrando los otros seis días');
});

test('vm, compatibilidad: con la vista de antes (sin etiqueta ni dia_semana) pide dos veces —la segunda con las cuatro columnas de siempre— y la carta sale como hoy', async () => {
  const anterior = filasDeLaVista().filter((f) => f.categoria !== 'Promociones');
  const h = await conVista({ vista: { anterior: true, filas: anterior } });
  assert.equal(h.llamadas.vista, 2);
  assert.match(h.llamadas.vistas[0], /select=categoria,nombre,precio,descripcion,etiqueta,dia_semana$/);
  assert.match(h.llamadas.vistas[1], /select=categoria,nombre,precio,descripcion$/);
  assert.equal(h.c.fuente, 'vivo', 'es la carta en vivo, no la foto');
  assert.deepEqual(ids(h), ['desayunos', 'ejecutivos', 'entradas', 'fuertes', 'bebidas']);
  assert.deepEqual(plano(h.c.promosHoy), []);
  for (const s of h.c.secciones) for (const p of s.platos) assert.equal(p.etiqueta, '', `${p.nombre}: sin etiqueta en la base de antes`);
  assert.deepEqual(nombres(seccion(h, 'ejecutivos')), ['Sopa', 'Carne', 'Sopa y carne', 'Seco', 'Sancocho trifasico']);
});

test('vm, un 402 (cuota) o un 500 no se reintenta —un solo pedido— y se queda con la foto; un 400 que también falla con las cuatro columnas, igual', async () => {
  for (const status of [402, 500]) {
    const h = await conVista({ vista: { status } });
    assert.equal(h.llamadas.vista, 1, `${status}: un solo pedido`);
    assert.equal(h.c.fuente, 'foto');
    assert.equal(h.c.vivoTerminado, true);
    assert.equal(h.c.secciones.reduce((n, s) => n + s.platos.length, 0), 29);
    assert.deepEqual(plano(h.c.promosHoy), []);
  }
  const h = await conVista({ vista: { status: 400 } });
  assert.equal(h.llamadas.vista, 2, 'el 400 reintenta una vez con las cuatro columnas');
  assert.equal(h.c.fuente, 'foto');
});

test('vm, la etiqueta se limpia (espacios, tope de 40) y una descripción igual al nombre —sin tildes ni mayúsculas— se oculta', async () => {
  const largo = 'x'.repeat(60);
  const filas = [
    { categoria: 'Bebidas', nombre: 'Jugo natural', precio: 12000, descripcion: 'JUGO NATURAL', etiqueta: '  Incluye hielo  ', dia_semana: null },
    { categoria: 'Bebidas', nombre: 'Café', precio: 4000, descripcion: 'Cafe', etiqueta: largo, dia_semana: null },
    { categoria: 'Bebidas', nombre: 'Té', precio: 5000, descripcion: 'Té de la casa', etiqueta: 12, dia_semana: null },
  ];
  const h = await conVista({ vista: { filas } });
  const b = seccion(h, 'bebidas').platos;
  const por = (n) => b.find((p) => p.nombre === n);
  assert.deepEqual([por('Jugo natural').etiqueta, por('Jugo natural').desc], ['Incluye hielo', '']);
  assert.deepEqual([por('Café').etiqueta.length, por('Café').desc], [40, '']);
  assert.deepEqual([por('Té').etiqueta, por('Té').desc], ['', 'Té de la casa'], 'una etiqueta que no es texto no se muestra');
});

// ───────────────────────── 3. en navegador ─────────────────────────

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivoNavegador = pw.motivo;
if (pw.chromium) {
  try {
    navegador = await pw.chromium.launch();
    servidor = await servirRaiz(RAIZ);
  } catch (e) {
    motivoNavegador = `no pude abrir Chromium (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await new Promise((resolver) => servidor.close(resolver));
});
const saltar = () => (navegador ? false : `navegador no disponible: ${motivoNavegador}`);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const CAPTURAS = process.env.CAPTURAS_CARTA || '';
// Jueves 1 de octubre de 2026, 12:00 en Bogotá. En Tokio ya es viernes 2 (02:00): si la carta mirara el reloj del
// dispositivo resaltaría el viernes.
const JUEVES_MEDIODIA = '2026-10-01T17:00:00Z';

/** carta.html con la red simulada, el reloj fijo y el navegador en otra zona. */
async function abrir({ ancho, alto = 900, instante = JUEVES_MEDIODIA, zona = 'Asia/Tokyo', vista = {}, mesa = false, sinMovimiento = false, ancla = '', relojCorre = false }) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, timezoneId: zona, locale: 'es-CO', reducedMotion: sinMovimiento ? 'reduce' : 'no-preference' });
  const page = await contexto.newPage();
  const consola = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location().url || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
    if (vista.anterior && /status of 400/.test(m.text())) return; // el 400 de la vista de antes es el caso que se prueba
    consola.push(m.text());
  });
  page.on('pageerror', (e) => consola.push(`pageerror: ${e.message}`));
  // Reloj fijo (lo normal: nada se mueve solo) o reloj que corre desde `instante` y se adelanta con page.clock.runFor (la medianoche).
  if (relojCorre) await page.clock.install({ time: new Date(instante) });
  else await page.clock.setFixedTime(new Date(instante));
  const items = [{ nombre: 'Limonada', precio: 5000, cantidad: 2 }];
  await page.route(/\.supabase\.co\//, (r) => {
    const req = r.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (url.includes('/rest/v1/carta_publica')) {
      const { status, body } = responderVista(url, vista);
      return r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    }
    if (url.includes('/functions/v1/cuenta')) {
      return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ mesa: 7, abierta: true, abierta_en: '2026-10-01T17:10:00Z', items, total: 10000 }) });
    }
    return r.fulfill({ status: 404, headers: CORS, body: '{}' });
  });
  await page.goto(`http://127.0.0.1:${servidor.address().port}/carta.html${mesa ? `?m=7&k=${TOKEN}` : ''}${ancla}`, { waitUntil: 'load' });
  const alpine = await page.waitForFunction(() => window.Alpine && document.body._x_dataStack && document.body._x_dataStack[0].vivoTerminado === true, null, { timeout: 8000 }).then(() => true, () => false);
  if (alpine) {
    await page.evaluate(() => document.fonts.ready);
    // La aparición escalonada termina (las del reloj de la página que no son infinitas: ni el latido ni las de scroll), para medir y capturar lo ya pintado.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished)));
  }
  return { contexto, page, consola, alpine };
}
const limpio = (t) => String(t).replace(/\s+/g, ' ').trim();
const texto = async (page, selector) => limpio(await page.locator(selector).first().innerText());
const desborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Cada plato de la sección: día, nombre, lo que hay en el lugar del precio y si es el de hoy. */
const filasDe = (page, id) => page.locator(`#${id} .carta-plato`).evaluateAll((els) => els.map((e) => ({
  dia: (e.querySelector('.carta-dia span') || {}).textContent || '',
  nombre: e.querySelector('.font-medium').textContent.trim(),
  lugarDelPrecio: e.querySelector(':scope > span').textContent.trim(),
  hoy: e.classList.contains('carta-plato--hoy'),
  actual: e.getAttribute('aria-current'),
  insignias: [...e.querySelectorAll('.badge')].filter((b) => b.getClientRects().length).map((b) => b.textContent.trim()),
})));
async function capturar(page, ancho, nombre, selector) {
  if (!CAPTURAS) return;
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const archivo = path.join(CAPTURAS, `${ancho}-${nombre}.png`);
  if (selector) {
    // Las pestañas pegajosas y la barra de abajo se montan sobre el recorte de una sección: se esconden solo para la foto.
    await page.addStyleTag({ content: 'nav.carta-nav, div.fixed.bottom-0 { visibility: hidden !important; }' });
    await page.locator(selector).first().screenshot({ path: archivo });
  }
  else if (nombre === 'completa') await page.screenshot({ path: archivo, fullPage: true });
  else await page.screenshot({ path: archivo });
}

const PROMOS_ESPERADAS = [
  { dia: 'Lunes', nombre: '3er almuerzo', lugarDelPrecio: '20% OFF' },
  { dia: 'Martes', nombre: 'Combo hamburguesas', lugarDelPrecio: '$ 50.000' },
  { dia: 'Miércoles', nombre: 'Cócteles, jugos y sodas', lugarDelPrecio: '2 x 1' },
  { dia: 'Jueves', nombre: 'Dupleta de papas', lugarDelPrecio: '$ 39.000' },
  { dia: 'Viernes', nombre: 'Picada + jarra de Cantarito', lugarDelPrecio: '$ 160.000' },
  { dia: 'Sábado', nombre: 'Entradas de la carta', lugarDelPrecio: '2 x 1' },
  { dia: 'Domingo', nombre: 'Almuerzos', lugarDelPrecio: '$ 20.000' },
];

for (const [ancho, alto] of [[320, 700], [390, 844], [1280, 800]]) {
  test(`${ancho} px, jueves en Bogotá con el dispositivo en Tokio: desayunos honestos, promociones de lunes a domingo con la de hoy resaltada, descuentos sin «$ 0», etiquetas sutiles; sin desborde ni errores`, { skip: saltar() }, async (t) => {
    const c = await abrir({ ancho, alto, sinMovimiento: true });
    try {
      if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
      const { page } = c;

      // El orden de la página: menú del día, franja de hoy, y las seis secciones.
      const y = await page.evaluate(() => Object.fromEntries(['dia', 'desayunos', 'ejecutivos', 'entradas', 'fuertes', 'bebidas', 'promociones'].map((id) => [id, document.getElementById(id).getBoundingClientRect().top + scrollY])));
      const franja = await page.locator('.carta-hoy').evaluate((e) => e.getBoundingClientRect().top + scrollY);
      assert.ok(y.dia < franja && franja < y.desayunos && y.desayunos < y.ejecutivos && y.ejecutivos < y.entradas && y.entradas < y.fuertes && y.fuertes < y.bebidas && y.bebidas < y.promociones, `orden vertical: ${JSON.stringify({ ...y, franja })}`);
      assert.deepEqual((await page.locator('nav[aria-label="Secciones de la carta"] .tab').allInnerTexts()).map(limpio), ['Del día', 'Desayunos', 'Ejecutivos', 'Entradas', 'Platos fuertes', 'Bebidas', 'Promociones']);

      // Desayunos: el horario de los afiches y, sin platos, la verdad.
      const desayunos = await texto(page, '#desayunos');
      assert.match(desayunos, /Desayunos/);
      assert.match(desayunos, /Todos los días · 7:00 a\.m\. – 11:00 a\.m\./);
      assert.match(desayunos, /Pregunta por los desayunos del día\./);
      assert.equal(await page.locator('#desayunos .carta-plato').count(), 0, 'no hay platos inventados');

      // Promociones: los siete días, en orden, y SOLO el jueves (Bogotá) resaltado aunque en Tokio sea viernes.
      const promos = await filasDe(page, 'promociones');
      assert.deepEqual(promos.map(({ dia, nombre, lugarDelPrecio }) => ({ dia, nombre, lugarDelPrecio })), PROMOS_ESPERADAS);
      assert.deepEqual(promos.map((p) => p.hoy), [false, false, false, true, false, false, false]);
      assert.deepEqual(promos.map((p) => p.actual), [null, null, null, 'date', null, null, null], 'el de hoy es aria-current="date"');
      assert.deepEqual(promos.map((p) => p.insignias.includes('Hoy')), [false, false, false, true, false, false, false], '«Hoy» solo en el jueves');
      assert.equal(await page.evaluate(() => new Date().getDay()), 5, 'el navegador cree que es viernes (Tokio): el resaltado no sale de ahí');
      assert.match(await texto(page, '#promociones'), /Una promoción distinta cada día, de lunes a domingo\./);

      // Descuento: la etiqueta, nunca «$ 0» (ni visible, ni escondido en el DOM).
      const lunes = await texto(page, '#promociones .carta-plato:nth-of-type(1)');
      assert.match(lunes, /20% OFF/);
      assert.doesNotMatch(lunes, /\$/);
      assert.match(lunes, /Por la compra de 2 almuerzos, el tercero te sale con el 20% de descuento/);
      assert.doesNotMatch(await page.locator('main').evaluate((e) => e.textContent), /\$\s?0(?![\d.])/, 'ni un «$ 0» en el DOM de la carta');
      assert.doesNotMatch(await page.locator('body').innerText(), /\$\s?0(?![\d.])/);

      // La franja de hoy: la promoción del día con su precio y enlace a la semana.
      const hoy = await texto(page, '.carta-hoy');
      assert.match(hoy, /Promoción de hoy · Jueves/i);
      assert.match(hoy, /Dupleta de papas/);
      assert.match(hoy, /\$ 39\.000/);
      assert.match(hoy, /Dos Papas Resplandor/);
      assert.match(hoy, /Ver las promociones de la semana/);
      assert.equal(await page.locator('.carta-hoy').getAttribute('href'), '#promociones');

      // Ejecutivos: «Sopa y carne · Incluye jugo», «Sopa» y «Carne» a $7.000, el sancocho con su nota.
      const ejec = await page.locator('#ejecutivos .carta-plato').evaluateAll((els) => els.map((e) => ({
        nombre: e.querySelector('.font-medium').textContent.trim(),
        etiqueta: ((e.querySelector('.carta-etiqueta') || {}).textContent || '').trim(),
        etiquetaVisible: !!e.querySelector('.carta-etiqueta') && e.querySelector('.carta-etiqueta').getClientRects().length > 0,
        precio: e.querySelector(':scope > span').textContent.trim(),
        texto: e.innerText.replace(/\s+/g, ' ').trim(),
      })));
      assert.deepEqual(ejec.map((e) => [e.nombre, e.precio]), [['Sopa', '$ 7.000'], ['Carne', '$ 7.000'], ['Sopa y carne', '$ 14.000'], ['Seco', '$ 19.000'], ['Sancocho trifasico', '$ 20.000']]);
      assert.deepEqual(ejec.filter((e) => e.etiquetaVisible).map((e) => [e.nombre, e.etiqueta]), [['Sopa y carne', 'Incluye jugo'], ['Sancocho trifasico', 'Algunos fines de semana']]);
      assert.equal((ejec.find((e) => e.nombre === 'Sancocho trifasico').texto.match(/Sancocho trifasico/g) || []).length, 1, 'el nombre no se repite como descripción');

      // La pastilla es sutil: neutra (arroz, texto apoyo, borde línea), de 12 px y peso 500; no compite con «De la casa» ni con el precio.
      const pastilla = await page.locator('#ejecutivos .carta-etiqueta:visible').first().evaluate((e) => { const s = getComputedStyle(e); return { color: s.color, fondo: s.backgroundColor, borde: s.borderTopColor, tamano: s.fontSize, peso: s.fontWeight }; });
      assert.deepEqual(pastilla, { color: 'rgb(79, 93, 89)', fondo: 'rgb(244, 240, 227)', borde: 'rgb(217, 211, 191)', tamano: '12px', peso: '500' });

      // Nada se sale de su tarjeta ni de la pantalla.
      assert.equal(await desborde(page), 0, 'sin desborde horizontal');
      const fuera = await page.evaluate(() => {
        const malos = [];
        for (const caja of document.querySelectorAll('.carta-plato, .carta-hoy, .carta-vacia')) {
          const r = caja.getBoundingClientRect();
          for (const e of caja.querySelectorAll('*')) {
            const q = e.getBoundingClientRect();
            if (q.width && (q.right > r.right + 0.5 || q.left < r.left - 0.5)) malos.push(`${e.tagName}.${e.className} «${(e.textContent || '').trim().slice(0, 30)}»`);
          }
        }
        return malos;
      });
      assert.deepEqual(fuera, [], 'ningún texto se sale de su fila');

      // Escritorio, sin mesa: dos columnas de platos y, con siete promociones, el domingo ocupa las dos.
      if (ancho >= 1024) {
        const cols = await page.locator('#promociones .carta-platos').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
        assert.equal(cols, 2);
        const cajas = await page.locator('#promociones .carta-plato').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; }));
        assert.ok(cajas[6].w > cajas[0].w * 1.9 && cajas[6].x === cajas[0].x, 'el domingo, solo en su fila, ocupa las dos columnas');
      }

      // Capturas (solo con CAPTURAS_CARTA): arriba, completa y las secciones nuevas.
      await capturar(page, ancho, 'arriba');
      await capturar(page, ancho, 'completa');
      await capturar(page, ancho, 'desayunos', '#desayunos');
      await capturar(page, ancho, 'ejecutivos', '#ejecutivos');
      await capturar(page, ancho, 'promociones', '#promociones');
      assert.deepEqual(c.consola, []);
    } finally {
      await c.contexto.close();
    }
  });
}

test('390 px: tocar la franja de hoy lleva a #promociones y tocar la pestaña «Promociones» la marca como la activa', { skip: saltar() }, async (t) => {
  const c = await abrir({ ancho: 390, alto: 844, sinMovimiento: true });
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    const { page } = c;
    await page.locator('.carta-hoy').click();
    await page.waitForFunction(() => { const r = document.getElementById('promociones').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; });
    assert.equal(new URL(page.url()).hash, '#promociones');
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('nav[aria-label="Secciones de la carta"] a.tab', { hasText: 'Promociones' }).click();
    await page.waitForFunction(() => { const r = document.getElementById('promociones').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; });
    await page.waitForFunction(() => document.querySelector('.tab-on') && /Promociones/.test(document.querySelector('.tab-on').textContent));
    assert.equal(limpio(await page.locator('.tab-on').innerText()), 'Promociones');
    assert.deepEqual(c.consola, []);
  } finally {
    await c.contexto.close();
  }
});

test('el domingo a las 22:00 en Bogotá (lunes en Tokio) resalta el DOMINGO; y el lunes de madrugada en Bogotá (domingo en Los Ángeles), el lunes', { skip: saltar() }, async (t) => {
  for (const [instante, zona, dia] of [['2026-10-05T03:00:00Z', 'Asia/Tokyo', 'Domingo'], ['2026-10-05T05:30:00Z', 'America/Los_Angeles', 'Lunes']]) {
    const c = await abrir({ ancho: 390, alto: 844, instante, zona, sinMovimiento: true });
    try {
      if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
      const promos = await filasDe(c.page, 'promociones');
      assert.deepEqual(promos.filter((p) => p.hoy).map((p) => p.dia), [dia], `${instante} con el navegador en ${zona}`);
      assert.match(await texto(c.page, '.carta-hoy'), new RegExp(`Promoción de hoy · ${dia}`, 'i'));
      assert.deepEqual(c.consola, []);
    } finally {
      await c.contexto.close();
    }
  }
});

// Refutación de la crítica (P1): el domingo la tarjeta de arriba decía «sin menú del día» y debajo seguía el «Menú Resplandor $ 23.000» con sus
// tres marcas: dos precios de almuerzo, uno de un menú que dice que no existe. El domingo no se ofrece el menú ni su precio.
test('el domingo la tarjeta del día NO ofrece el Menú Resplandor (ni $ 23.000 ni lo que incluye): dice que es de lunes a sábado y la promoción de hoy (Almuerzos $ 20.000) viene justo debajo; el jueves sigue igual', { skip: saltar() }, async (t) => {
  for (const ancho of [320, 390, 1280]) {
    const dom = await abrir({ ancho, alto: 900, instante: '2026-10-04T17:00:00Z', sinMovimiento: true }); // domingo 12:00 en Bogotá (lunes en Tokio)
    try {
      if (!dom.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
      const { page } = dom;
      const tarjeta = await texto(page, '#dia');
      assert.match(tarjeta, /Domingo · sin Menú Resplandor/, `${ancho}: la insignia`);
      assert.match(tarjeta, /El Menú Resplandor se sirve de lunes a sábado\./, `${ancho}: la frase`);
      assert.doesNotMatch(tarjeta, /23\.000|\$ 2\d\.\d{3}/, `${ancho}: ningún precio de almuerzo en la tarjeta del día`);
      assert.doesNotMatch(tarjeta, /Sopa o frijol|frijolada|ensalada|sancocho/i, `${ancho}: nada de lo que incluye el menú`);
      assert.equal(await page.locator('#dia li:visible').count(), 0, `${ancho}: ninguna marca de lo que incluye`);
      assert.equal(await page.locator('#dia h2:visible').count(), 0, `${ancho}: ni el título «Menú Resplandor» con su precio`);
      const franja = await texto(page, '.carta-hoy');
      assert.match(franja, /Promoción de hoy · Domingo/i);
      assert.match(franja, /Almuerzos/);
      assert.match(franja, /\$ 20\.000/);
      // La franja viene justo debajo de la tarjeta del día (la promoción de hoy es lo único que se ofrece ese día arriba).
      const [tarj, fran] = await Promise.all([page.locator('#dia .card').boundingBox(), page.locator('.carta-hoy').boundingBox()]);
      assert.ok(fran.y >= tarj.y + tarj.height - 1 && fran.y - (tarj.y + tarj.height) < 40, `${ancho}: la franja de hoy sigue a la tarjeta`);
      assert.equal(await desborde(page), 0, `${ancho}: sin desborde`);
      assert.deepEqual(dom.consola, []);
      if (ancho === 390) await capturar(page, ancho, 'domingo-arriba');
    } finally { await dom.contexto.close(); }
  }
  const jue = await abrir({ ancho: 390, alto: 900, sinMovimiento: true });
  try {
    if (!jue.alpine) return t.skip('Alpine no cargó');
    const tarjeta = await texto(jue.page, '#dia');
    assert.match(tarjeta, /Hoy · jueves/);
    assert.match(tarjeta, /Menú Resplandor/);
    assert.match(tarjeta, /\$ 23\.000/);
    assert.match(tarjeta, /También por plato: seco, sopa, carne o sopa y carne \(con jugo\)/, 'P2: el sancocho no entra en lo que se ofrece cualquier día');
    assert.doesNotMatch(tarjeta, /sancocho/i);
    assert.doesNotMatch(tarjeta, /lunes a sábado/);
  } finally { await jue.contexto.close(); }
});

// Refutación (hallazgo 4), con Alpine de verdad y el reloj de Chromium: del domingo 23:59:50 al lunes 00:00:05 en Bogotá la página cambia sola.
test('a la medianoche de Bogotá la página cambia sola: el domingo (sin menú, «Hoy» en Almuerzos) pasa a lunes (con Menú Resplandor $ 23.000, «Hoy» en el 3er almuerzo), sin recargar', { skip: saltar() }, async (t) => {
  const c = await abrir({ ancho: 390, alto: 900, instante: '2026-10-05T04:59:50Z', relojCorre: true, sinMovimiento: true });
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    const { page } = c;
    assert.match(await texto(page, '#dia'), /Domingo · sin Menú Resplandor/);
    assert.match(await texto(page, '.carta-hoy'), /Promoción de hoy · Domingo[\s\S]*Almuerzos/i);
    assert.deepEqual((await filasDe(page, 'promociones')).filter((p) => p.hoy).map((p) => p.dia), ['Domingo']);
    await page.clock.runFor(15000); // 00:00:05 del lunes
    await page.waitForFunction(() => /Promoción de hoy · Lunes/i.test(document.querySelector('.carta-hoy')?.textContent || ''), null, { timeout: 5000 });
    const tarjeta = await texto(page, '#dia');
    assert.match(tarjeta, /Hoy · lunes/);
    assert.match(tarjeta, /Menú Resplandor/);
    assert.match(tarjeta, /\$ 23\.000/);
    assert.doesNotMatch(tarjeta, /sin Menú Resplandor/);
    assert.match(await texto(page, '.carta-hoy'), /3er almuerzo/);
    assert.deepEqual((await filasDe(page, 'promociones')).filter((p) => p.hoy).map((p) => p.dia), ['Lunes'], 'la marca «Hoy» de la semana también se corrió');
    assert.deepEqual(c.consola, []);
  } finally { await c.contexto.close(); }
});

test('con la vista de antes (sin etiqueta ni dia_semana) la carta se ve como hoy: sin franja ni promociones ni etiquetas, con Desayunos honesto; el 400 se reintenta y no hay errores', { skip: saltar() }, async (t) => {
  const anterior = filasDeLaVista().filter((f) => f.categoria !== 'Promociones');
  const c = await abrir({ ancho: 390, alto: 844, vista: { anterior: true, filas: anterior }, sinMovimiento: true });
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    const { page } = c;
    assert.equal(await page.locator('.carta-hoy').count(), 0);
    assert.equal(await page.locator('#promociones').count(), 0);
    assert.equal(await page.locator('.carta-etiqueta:visible').count(), 0);
    assert.deepEqual((await page.locator('nav[aria-label="Secciones de la carta"] .tab').allInnerTexts()).map(limpio), ['Del día', 'Desayunos', 'Ejecutivos', 'Entradas', 'Platos fuertes', 'Bebidas']);
    assert.match(await texto(page, '#desayunos'), /Pregunta por los desayunos del día\./);
    assert.deepEqual((await page.locator('#ejecutivos .carta-plato .font-medium').allInnerTexts()).map(limpio), ['Sopa', 'Carne', 'Sopa y carne', 'Seco', 'Sancocho trifasico']);
    assert.equal(await page.locator('[x-data]').first().evaluate((e) => window.Alpine.$data(e).fuente), 'vivo');
    assert.equal(await desborde(page), 0);
    assert.deepEqual(c.consola, []);
  } finally {
    await c.contexto.close();
  }
});

test('cuando carguen platos de desayuno la sección los muestra y deja de decir «Pregunta por los desayunos del día»', { skip: saltar() }, async (t) => {
  const filas = [...filasDeLaVista(), { categoria: 'Desayunos', nombre: 'Desayuno de prueba', precio: 1000, descripcion: 'Solo para esta prueba', etiqueta: null, dia_semana: null }];
  const c = await abrir({ ancho: 390, alto: 844, vista: { filas }, sinMovimiento: true });
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    const d = await texto(c.page, '#desayunos');
    assert.match(d, /Desayuno de prueba/);
    assert.match(d, /\$ 1\.000/);
    assert.doesNotMatch(d, /Pregunta por los desayunos/);
    assert.deepEqual(c.consola, []);
  } finally {
    await c.contexto.close();
  }
});

test('1280 px con mesa: riel, carta y panel de la cuenta; la franja de hoy y las promociones caben en la columna central, sin desborde ni errores', { skip: saltar() }, async (t) => {
  const c = await abrir({ ancho: 1280, alto: 800, mesa: true, sinMovimiento: true });
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    const { page } = c;
    await page.locator('.cuenta-total').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.carta-hoy').isVisible(), true);
    const promos = await filasDe(page, 'promociones');
    assert.equal(promos.length, 7);
    assert.deepEqual(promos.map((p) => p.hoy), [false, false, false, true, false, false, false]);
    const cols = await page.locator('#promociones .carta-platos').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 1, 'con la cuenta al lado la carta mide ≈ 660 px: una columna');
    assert.equal(await desborde(page), 0);
    await capturar(page, '1280-mesa', 'arriba');
    await capturar(page, '1280-mesa', 'promociones', '#promociones');
    assert.deepEqual(c.consola, []);
  } finally {
    await c.contexto.close();
  }
});

// El enlace de la landing («Ver en la carta» → carta.html#promociones): la sección nace cuando contesta la vista, DESPUÉS de que
// el navegador buscó el ancla al cargar. Sin irAlAncla() la página se quedaba arriba de todo (medido contra Postgres real).
test('carta.html#promociones: la página va a «Promociones de la semana» cuando la carta en vivo la pinta; un ancla mal escrita no rompe nada', { skip: saltar() }, async (t) => {
  const c = await abrir({ ancho: 390, ancla: '#promociones', sinMovimiento: true });
  try {
    if (!c.alpine) return t.skip('Alpine no cargó (¿sin red hacia cdn.jsdelivr.net?): sin él la página no pinta nada');
    await c.page.waitForFunction(() => document.getElementById('promociones'), null, { timeout: 5000 });
    await c.page.waitForTimeout(300);
    const arriba = await c.page.locator('#promociones').evaluate((e) => e.getBoundingClientRect().top);
    // Es la última sección: si la página no da para subirla hasta el borde, queda lo más arriba que el final del documento deja.
    assert.ok(arriba >= 0 && arriba < 300, `«Promociones de la semana» queda en la parte alta de la pantalla (top = ${Math.round(arriba)})`);
    assert.ok((await c.page.evaluate(() => scrollY)) > 1000, 'la página bajó hasta ella');
    assert.deepEqual(c.consola, []);
  } finally { await c.contexto.close(); }

  const malo = await abrir({ ancho: 390, ancla: '#%E0%A4%A', sinMovimiento: true });
  try {
    if (!malo.alpine) return t.skip('Alpine no cargó');
    assert.equal(await malo.page.locator('#promociones .carta-plato').count(), 7, 'la carta se pinta completa');
    assert.equal(await malo.page.evaluate(() => scrollY), 0, 'sin ancla válida se queda arriba');
    assert.deepEqual(malo.consola, []);
  } finally { await malo.contexto.close(); }
});
