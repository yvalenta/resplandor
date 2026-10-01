// «Mi cuenta» EN VIVO en carta.html (tarea cuenta-en-mesa, parte 1C, docs/sdd-cuenta-en-mesa.md §03.2
// y §04.7): la carta se une al canal del tópico que le da `cuenta`, relee con debounce y cubeta cuando
// llega una señal, detecta un canal MUDO con la `marca` y cae a sondeo, y solo dice «En vivo» si lo está.
//
// Qué se prueba y cómo:
//   1. ESTÁTICA (el HTML): SRI en Alpine, no-referrer, supabase-js diferido y fijo, rótulo, regiones
//      aria-live, ningún x-html, ningún botón «Actualizar», la barra con el total.
//   2. DINÁMICA, en un vm de Node con reloj virtual (scripts/pruebas/_carta-vm.mjs): el <script> de
//      carta.html corrido de verdad contra una `cuenta` simulada según el contrato del SDD §04.3 y un
//      Realtime simulado. Cada prueba está pensada para FALLAR si se quita lo que implementa.
//   3. EN NAVEGADOR (solo con Playwright, ver _navegador.mjs): al final del archivo.
//
// La `cuenta` real es la parte 1B y el trigger la 1A; acá se simulan por contrato. Que el tópico de la
// base y el de la función coincidan lo fija el vector de 1A y 1B (sha256 del token de 48 ceros).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crearCarta, RAIZ, TOKEN_CEROS, topicoDe } from './_carta-vm.mjs';
import { buscarPlaywright, servirRaiz } from './_navegador.mjs';

const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const sinComentarios = (t) => t.replace(/<!--[\s\S]*?-->/g, ' ');
// Lo que sale del vm trae los Array y Object del vm: deepStrictEqual los rechaza por el prototipo.
const plano = (x) => JSON.parse(JSON.stringify(x));
const nombres = (h) => Array.from(h.c.cuenta.items, (i) => i.nombre);

// ───────────────────────── 1. estática: el HTML ─────────────────────────

test('carta.html: Alpine con SRI sha384 + crossorigin, y no-referrer (el enlace de la pegatina lleva el token)', () => {
  const html = sinComentarios(leer('carta.html'));
  const alpine = html.match(/<script\b[^>]*alpinejs[^>]*>/);
  assert.ok(alpine, 'no encontré el <script> de Alpine');
  assert.match(alpine[0], /alpinejs@3\.17\.4\/dist\/cdn\.min\.js/, 'Alpine fijo a una versión exacta');
  assert.match(alpine[0], /\sintegrity="sha384-[A-Za-z0-9+/]{64}"/, 'Alpine sin SRI');
  assert.match(alpine[0], /\scrossorigin="anonymous"/, 'SRI exige crossorigin="anonymous"');
  assert.match(html, /<meta name="referrer" content="no-referrer">/, 'falta <meta name="referrer" content="no-referrer">');
});

test('carta.html: supabase-js NO está en el marcado (se baja solo al abrir la cuenta), fijo a 2.117.2 y con SRI', () => {
  const html = sinComentarios(leer('carta.html'));
  const marcado = html.replace(/<script>\n[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(marcado, /supabase-js/, 'supabase-js no se pide en el marcado: la carta sin mesa no lo necesita');
  assert.doesNotMatch(html, /document\.write/, 'nada de document.write');
  const fija = html.match(/const SUPABASE_JS = Object\.freeze\(\{\s*src: '([^']+)',\s*integrity: '([^']+)'/);
  assert.ok(fija, 'no encontré la constante SUPABASE_JS');
  assert.match(fija[1], /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js$/, 'versión exacta, archivo del paquete');
  assert.match(fija[2], /^sha384-[A-Za-z0-9+/]{64}$/);
});

// El hash se calcula sobre el archivo EXACTO. Con red: VERIFICAR_SRI=1 node --test scripts/pruebas/cuenta-en-vivo.test.mjs
test('SRI: los hashes de carta.html son los de los archivos de verdad (VERIFICAR_SRI=1, necesita red)', { skip: !process.env.VERIFICAR_SRI && 'se corre con VERIFICAR_SRI=1 (necesita red)' }, async () => {
  const html = leer('carta.html');
  const pares = [
    [html.match(/alpinejs@3\.17\.4\/dist\/cdn\.min\.js"\s+integrity="([^"]+)"/)[1], 'https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js'],
    [html.match(/integrity: '(sha384-[^']+)'/)[1], 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'],
  ];
  for (const [esperado, url] of pares) {
    const cuerpo = Buffer.from(await (await fetch(url)).arrayBuffer());
    assert.equal(esperado, 'sha384-' + createHash('sha384').update(cuerpo).digest('base64'), url);
  }
});

test('carta.html: rótulo «Consumo en vivo · no es factura», dos regiones role="status" aria-live="polite", cero x-html, sin botón «Actualizar»', () => {
  const html = sinComentarios(leer('carta.html'));
  assert.match(html, /Consumo en vivo · no es factura/);
  const regiones = html.match(/role="status" aria-live="polite"/g) || [];
  assert.ok(regiones.length >= 2, 'la pastilla de conexión y el anuncio de cambios son regiones role="status" aria-live="polite"');
  assert.match(html, /<p class="sr-only" role="status" aria-live="polite" x-text="anuncio">/, 'el anuncio de cambios no se ve pero se lee');
  assert.doesNotMatch(html, /x-html/, 'todo dato del servidor se pinta con x-text, nunca con x-html');
  assert.doesNotMatch(html, />\s*Actualizar\s*</, 'Yonatan: la cuenta se actualiza sola, sin botón «Actualizar»');
  assert.doesNotMatch(html, /Reconectando/, 'el texto viejo «Reconectando…» ya no existe: la pastilla dice la verdad (Conectando…, Se actualiza cada 20 s, Sin conexión…)');
  // «Reintentar» existe solo en el error de la primera lectura.
  const error = html.match(/<div x-show="cuenta\.estado === 'error'"[\s\S]*?(?=<div x-show="cuenta\.estado === 'vacia'")/);
  assert.ok(error && /Reintentar/.test(error[0]), '«Reintentar» va en el bloque de error');
  assert.equal((html.replace(/<script>[\s\S]*?<\/script>/g, '').match(/Reintentar/g) || []).length, 1, '«Reintentar» solo ahí');
});

test('carta.html: la hoja tiene los estados cerrada y vencido, y la barra fija conserva «Ver mi cuenta · Mesa N · total»', () => {
  const html = sinComentarios(leer('carta.html'));
  for (const estado of ['cargando', 'error', 'vacia', 'ok', 'cerrada', 'vencido']) {
    assert.match(html, new RegExp(`x-show="cuenta\\.estado === '${estado}'"`), `falta el estado «${estado}» en la hoja`);
  }
  assert.match(html, /Mesa cerrada\. ¡Gracias!/);
  assert.match(html, /Pago confirmado\. ¡Gracias!/);
  assert.match(html, /Este enlace ya no sirve/);
  assert.match(html, /Vuelve a tocar la pegatina o pide el enlace al mesero/);
  assert.match(html, /Ver mi cuenta · Mesa <span x-text="mesa"><\/span><span class="tabular" x-show="cuenta\.estado === 'ok'" x-text="' · ' \+ pesos\(cuenta\.total\)">/, 'la barra fija muestra el total');
  assert.doesNotMatch(html, /Ver la cuenta actual|ver la cuenta actual/, 'sin botón para ver la cuenta actual (SDD §03.10, A+)');
});

// ───────────────────────── 2. dinámica: la máquina en un vm con reloj virtual ─────────────────────────

/** Abre la hoja y deja que conecte (lectura, supabase-js, SUBSCRIBED, segunda lectura). */
async function abierta(opciones = {}) {
  const h = await crearCarta(opciones);
  await h.iniciar();
  await h.abrir(500);
  return h;
}

/** «En vivo» solo si de verdad hay un canal suscrito y vivo. Se llama después de cada paso de un recorrido. */
function honesto(h, donde) {
  if (h.c.pastilla.texto === 'En vivo') {
    assert.equal(h.c.conexion, 'vivo', `${donde}: dice «En vivo» sin conexion «vivo»`);
    assert.equal(h.c._canalEstado, 'suscrito', `${donde}: dice «En vivo» sin canal suscrito`);
    assert.equal(h.c._mudo, false, `${donde}: dice «En vivo» con el canal mudo`);
    assert.ok(h.supabase.vivos().some((c) => c.estadoActual === 'SUBSCRIBED'), `${donde}: dice «En vivo» y no hay ningún canal suscrito`);
  }
}

test('al abrir la hoja: lee `cuenta` (sin `o`), baja supabase-js con SRI recién entonces y se une al canal del servidor', async () => {
  const h = await crearCarta();
  await h.iniciar();
  assert.equal(h.supabase.scripts.length, 0, 'antes de abrir la hoja no se baja supabase-js');
  assert.equal(h.supabase.canales.length, 0);
  assert.equal(h.llamadas.cuenta.length, 0, 'antes de abrir la hoja no se lee la cuenta');

  h.c.abrirCuenta();
  await h.avanzar(0);
  assert.equal(h.llamadas.cuenta.length, 1);
  const url = new URL(h.llamadas.cuenta[0].url);
  assert.equal(url.pathname, '/functions/v1/cuenta');
  assert.equal(url.searchParams.get('m'), '3');
  assert.equal(url.searchParams.get('k'), TOKEN_CEROS);
  assert.equal(url.searchParams.get('o'), null, 'una pestaña nueva no manda `o`');
  assert.equal(h.c.pastilla.texto, 'Conectando…', 'todavía no hay canal: no puede decir «En vivo»');

  await h.avanzar(500);
  assert.equal(h.supabase.scripts.length, 1);
  const script = h.supabase.scripts[0];
  assert.equal(script.src, 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js');
  assert.match(script.integrity, /^sha384-[A-Za-z0-9+/]{64}$/, 'supabase-js se baja con SRI');
  assert.equal(script.crossOrigin, 'anonymous');

  assert.equal(h.supabase.clientes.length, 1);
  assert.deepEqual(plano(h.supabase.clientes[0].opciones.auth), { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, 'sin sesión guardada: la carta es anónima');
  assert.equal(h.supabase.clientes[0].opciones.realtime.disconnectOnEmptyChannelsAfterMs, 0, 'sin canales el socket se cierra al instante (cupo de conexiones)');
  assert.equal(h.supabase.canales.length, 1);
  const canal = h.supabase.canales[0];
  assert.equal(canal.topico, topicoDe(TOKEN_CEROS), 'el tópico es el que dio el servidor (canal.topico)');
  assert.equal(canal.config.config.private, false, 'público mientras S-0 no pase');
  assert.deepEqual(canal.manejadores.map((m) => [m.tipo, m.filtro.event]), [['broadcast', 'cambio']]);
});

test('«En vivo» solo al llegar SUBSCRIBED; entonces hace una segunda lectura (lo que cambió entre la lectura y la suscripción)', async () => {
  const h = await crearCarta();
  await h.iniciar();
  h.supabase.latenciaSuscripcion = 400;
  h.c.abrirCuenta();
  await h.avanzar(200);                                     // ya leyó y ya bajó la librería, aún sin SUBSCRIBED
  assert.equal(h.c.conexion, 'conectando');
  assert.notEqual(h.c.pastilla.texto, 'En vivo');
  assert.equal(h.llamadas.cuenta.length, 1);
  // El mesero agrega algo AHORA: nadie escucha todavía, la señal se pierde.
  h.cambio((m) => m.agregar('Jugo', 4000));
  assert.equal(h.c.cuenta.items.length, 1, 'la primera lectura no lo vio');
  await h.avanzar(300);                                     // llega SUBSCRIBED
  assert.equal(h.c.conexion, 'vivo');
  assert.equal(h.c.pastilla.texto, 'En vivo');
  assert.equal(h.llamadas.cuenta.length, 2, 'SUBSCRIBED dispara la segunda lectura');
  assert.deepEqual(nombres(h), ['Limonada', 'Jugo'], 'la segunda lectura recoge lo que se perdió');
});

test('una señal relee con debounce de 400 ms: tres señales seguidas son UNA lectura, 400 ms después de la última', async () => {
  const h = await abierta();
  const antes = h.llamadas.cuenta.length;
  h.cambio((m) => m.agregar('Jugo', 4000));
  await h.avanzar(100);
  h.supabase.senal(h.mundo.topico);
  await h.avanzar(100);
  h.supabase.senal(h.mundo.topico);                         // t = 200 ms desde la primera
  await h.avanzar(399);
  assert.equal(h.llamadas.cuenta.length, antes, 'a los 399 ms de la última señal todavía no leyó');
  await h.avanzar(2);
  assert.equal(h.llamadas.cuenta.length, antes + 1, 'una sola lectura');
  assert.deepEqual(nombres(h), ['Limonada', 'Jugo']);
});

test('la señal no trae datos: lo que diga el payload se ignora, y un evento con otro nombre no lee', async () => {
  const h = await abierta();
  const antes = h.llamadas.cuenta.length;
  h.supabase.canales[0].emitir('otro-evento', { total: 1 });
  await h.avanzar(2000);
  assert.equal(h.llamadas.cuenta.length, antes, 'solo el evento `cambio` provoca una lectura');
  h.cambio((m) => m.agregar('Jugo', 4000), { senal: false });
  h.supabase.canales[0].emitir('cambio', { total: 1, items: [{ nombre: 'Falso', precio: 1, cantidad: 1 }] });
  await h.avanzar(500);
  assert.equal(h.c.cuenta.total, 9000, 'el total sale de la lectura, no de la señal');
  assert.deepEqual(nombres(h), ['Limonada', 'Jugo']);
});

test('un cambio aislado aparece en ≤ 2 s (con 400 ms de latencia por lectura), resaltado y anunciado: «Se agregó 1 × Jugo»', async () => {
  const h = await abierta();
  h.mundo.latencia = 400;
  assert.equal(h.c.anuncio, '', 'la primera carga no anuncia nada');
  const t0 = h.reloj.ahora();
  h.cambio((m) => m.agregar('Jugo', 4000));
  let visible = null;
  for (let ms = 100; ms <= 3000 && visible === null; ms += 100) {
    await h.avanzar(100);
    if (h.c.cuenta.items.some((i) => i.nombre === 'Jugo')) visible = h.reloj.ahora() - t0;
  }
  assert.ok(visible !== null && visible <= 2000, `el ítem tardó ${visible} ms (meta ≤ 2000)`);
  assert.deepEqual(plano(h.c.resaltados), ['Jugo|4000'], 'lo nuevo se resalta');
  await h.avanzar(100);
  assert.equal(h.c.anuncio, 'Se agregó 1 × Jugo');
  assert.equal(h.c.totalCambio, true);
  await h.avanzar(2000);
  assert.deepEqual(plano(h.c.resaltados), [], 'el resaltado dura un momento');
  assert.equal(h.c.totalCambio, false);
});

test('el anuncio dice qué cambió por diferencia de grupos: agregar, quitar y varios a la vez (tope de 3)', async () => {
  const h = await abierta();
  h.cambio((m) => m.agregar('Limonada', 5000, 2));
  await h.avanzar(1000);
  assert.equal(h.c.anuncio, 'Se agregó 2 × Limonada');
  h.cambio((m) => { m.orden.items = m.orden.items.filter((i) => i.nombre !== 'Limonada'); m.agregar('Jugo', 4000); m.orden.version++; });
  await h.avanzar(1000);
  assert.equal(h.c.anuncio, 'Se agregó 1 × Jugo. Se quitó 3 × Limonada');
  h.cambio((m) => { for (const n of ['A', 'B', 'C', 'D', 'E']) m.agregar(n, 1000); });
  await h.avanzar(1000);
  assert.equal(h.c.anuncio, 'Se agregó 1 × A. Se agregó 1 × B. Se agregó 1 × C. y 2 cambios más');
});

test('ráfaga normal del mesero (6 ítems, uno por segundo): cada uno aparece en ≤ 2 s y el último en ≤ 4 s', async () => {
  const h = await abierta();
  h.mundo.latencia = 400;
  const demoras = [];
  for (let i = 1; i <= 6; i++) {
    const t0 = h.reloj.ahora();
    h.cambio((m) => m.agregar('Plato ' + i, 1000 * i));
    let visible = null;
    for (let ms = 100; ms <= 1000; ms += 100) {
      await h.avanzar(100);
      if (visible === null && h.c.cuenta.items.some((x) => x.nombre === 'Plato ' + i)) visible = h.reloj.ahora() - t0;
    }
    demoras.push(visible);
  }
  assert.ok(demoras.every((d) => d !== null && d <= 2000), `demoras: ${demoras}`);
  assert.ok(demoras[5] <= 4000);
  honesto(h, 'ráfaga');
});

test('inundación de señales (una por segundo, 3 minutos): la cubeta deja ~6 lecturas por minuto en régimen (≤ 7), y nada se pierde al terminar', async () => {
  const h = await abierta();
  const t0 = h.reloj.ahora();
  const base = h.llamadas.cuenta.length;
  for (let i = 0; i < 180; i++) {
    h.cambio((m) => m.agregar('Item ' + i, 100));
    await h.avanzar(1000);
  }
  const ventana = (n) => h.lecturasDesde(t0 + n * 60000, t0 + (n + 1) * 60000);
  const [m1, m2, m3] = [ventana(0), ventana(1), ventana(2)];
  assert.ok(m1 <= 12, `primer minuto: ${m1} (la cubeta llena deja pasar 6 y recarga 6)`);
  assert.ok(m2 <= 7, `segundo minuto: ${m2} (el SDD dice «unas 7 por minuto»)`);
  assert.ok(m3 <= 7, `tercer minuto: ${m3}`);
  assert.ok(h.llamadas.cuenta.length - base <= 12 + 7 + 7);
  assert.ok(m2 >= 4 && m3 >= 4, 'no se queda ciega: sigue leyendo en régimen');
  // Dejan de llegar señales: la última lectura pendiente igual se hace, y la cuenta queda al día.
  await h.avanzar(12000);
  assert.equal(h.c.cuenta.items.length, 181, 'la cuenta converge: ni una señal se pierde, solo se espera la ficha');
  honesto(h, 'inundación');
});

test('veinte señales en 300 ms son una sola lectura', async () => {
  const h = await abierta();
  const antes = h.llamadas.cuenta.length;
  h.cambio((m) => m.agregar('Jugo', 4000));
  for (let i = 0; i < 19; i++) { await h.avanzar(15); h.supabase.senal(h.mundo.topico); }
  await h.avanzar(1000);
  assert.equal(h.llamadas.cuenta.length, antes + 1);
});

test('una ráfaga LARGA (10 ítems, uno por segundo) agota la cubeta y se atrasa, pero converge sola en ≤ 12 s: nada se pierde', async () => {
  const h = await abierta();
  const antes = h.llamadas.cuenta.length;
  for (let i = 1; i <= 10; i++) { h.cambio((m) => m.agregar('Plato ' + i, 1000)); await h.avanzar(1000); }
  const durante = h.llamadas.cuenta.length - antes;
  assert.ok(durante <= 8, `durante la ráfaga hizo ${durante} lecturas (cubeta de 6 + 1 recarga)`);
  await h.avanzar(12000);
  assert.equal(h.c.cuenta.items.length, 11);
});

// ── canal mudo (S-6) ──

test('canal MUDO: la marca cambia sin señal y en ≤ 60 s la pastilla pasa a «Se actualiza cada 20 s» (y la cuenta se pone al día)', async () => {
  const h = await abierta();
  assert.equal(h.c.pastilla.texto, 'En vivo');
  await h.avanzar(1000);
  const t0 = h.reloj.ahora();
  h.cambio((m) => m.agregar('Jugo', 4000), { senal: false });   // el trigger no emitió (reversa aplicada, migración sin aplicar...)
  assert.equal(h.c.pastilla.texto, 'En vivo', 'la carta todavía no lo sabe');
  let aviso = null;
  for (let s = 1; s <= 70 && aviso === null; s++) {
    await h.avanzar(1000);
    honesto(h, 'esperando al sondeo de seguridad');
    if (h.c.pastilla.texto === 'Se actualiza cada 20 s') aviso = h.reloj.ahora() - t0;
  }
  assert.ok(aviso !== null && aviso <= 60000, `la pastilla tardó ${aviso} ms (meta ≤ 60000)`);
  assert.equal(h.c.conexion, 'sondeo');
  assert.deepEqual(nombres(h), ['Limonada', 'Jugo'], 'además, esa lectura ya trajo el cambio');
  // En sondeo lee cada 20 s.
  const t1 = h.reloj.ahora();
  await h.avanzar(60000);
  assert.equal(h.lecturasDesde(t1), 3, 'sondeo cada 20 s');
});

test('canal mudo: solo una señal de verdad lo devuelve a «En vivo»', async () => {
  const h = await abierta();
  h.cambio((m) => m.agregar('Jugo', 4000), { senal: false });
  await h.avanzar(61000);
  assert.equal(h.c.conexion, 'sondeo');
  const topico = h.mundo.topico;
  await h.avanzar(30000);
  assert.equal(h.c.conexion, 'sondeo', 'sin señales sigue en sondeo aunque el canal esté suscrito');
  h.cambio((m) => m.agregar('Pan', 1000));                       // ahora sí emite
  await h.avanzar(1000);
  assert.equal(h.c.conexion, 'vivo');
  assert.equal(h.c.pastilla.texto, 'En vivo');
  assert.equal(h.mundo.topico, topico);
  honesto(h, 'tras la señal');
});

test('sin falsos positivos: 5 minutos tranquilos siguen «En vivo», con una lectura de seguridad por minuto', async () => {
  const h = await abierta();
  const t0 = h.reloj.ahora();
  for (let s = 0; s < 300; s++) { await h.avanzar(1000); honesto(h, 'tranquilo'); }
  assert.equal(h.c.conexion, 'vivo');
  assert.equal(h.c.pastilla.texto, 'En vivo');
  const n = h.lecturasDesde(t0);
  assert.ok(n >= 4 && n <= 6, `${n} lecturas de seguridad en 5 minutos`);
});

test('sin falsos positivos: un cambio CON señal entre dos sondeos de seguridad no lo declara mudo', async () => {
  const h = await abierta();
  await h.avanzar(30000);
  h.cambio((m) => m.agregar('Jugo', 4000));
  await h.avanzar(40000);                                         // pasa el sondeo de seguridad
  assert.equal(h.c.conexion, 'vivo');
  assert.equal(h.c._mudo, false);
});

test('sin falsos positivos: la señal que llega MIENTRAS vuela el sondeo de seguridad cuenta (la respuesta ya trae el cambio)', async () => {
  const h = await abierta();
  h.mundo.latencia = 400;
  // Llevar el reloj hasta justo antes del sondeo de seguridad (60 s después de la última lectura).
  const ultima = h.llamadas.cuenta[h.llamadas.cuenta.length - 1].en;
  await h.avanzar(ultima + 60000 - h.reloj.ahora() + 50);          // el sondeo ya salió, su respuesta llega en 400 ms
  assert.equal(h.llamadas.cuenta.length, 3, 'el sondeo de seguridad está en vuelo');
  h.cambio((m) => m.agregar('Jugo', 4000));                        // el trigger emite; el cambio entra en la respuesta que vuela
  await h.avanzar(2000);
  assert.equal(h.c._mudo, false, 'una señal vista durante el vuelo explica el cambio de marca');
  assert.equal(h.c.conexion, 'vivo');
});

test('sin `canal` en la respuesta (la `cuenta` de hoy): queda en sondeo de 20 s, sin supabase-js ni canal, y la cuenta se ve igual', async () => {
  const h = await crearCarta({ conCanal: false });
  await h.iniciar();
  await h.abrir(500);
  assert.equal(h.c.cuenta.estado, 'ok');
  assert.equal(h.c.cuenta.total, 5000);
  assert.equal(h.c.conexion, 'sondeo');
  assert.equal(h.c.pastilla.texto, 'Se actualiza cada 20 s');
  assert.equal(h.supabase.scripts.length, 0, 'sin canal no se baja supabase-js');
  assert.equal(h.supabase.canales.length, 0);
  const t0 = h.reloj.ahora();
  h.mundo.agregar('Jugo', 4000);
  await h.avanzar(20000);
  assert.deepEqual(nombres(h), ['Limonada', 'Jugo'], 'el sondeo de 20 s lo recoge');
  assert.equal(h.lecturasDesde(t0), 1);
  honesto(h, 'sin canal');
});

test('sin `canal` y sin orden (la `cuenta` de hoy, mesa libre): «Todavía no hay cuenta abierta»', async () => {
  const h = await crearCarta({ conCanal: false, sinOrden: true });
  await h.iniciar();
  await h.abrir(500);
  assert.equal(h.c.cuenta.estado, 'vacia');
});

test('SUBSCRIBED que no llega en 4 s: sondeo de 20 s y el canal se reintenta a los 60 s', async () => {
  const h = await crearCarta();
  await h.iniciar();
  h.supabase.suscripcion = 'nunca';
  h.c.abrirCuenta();
  await h.avanzar(3900);
  assert.equal(h.c.conexion, 'conectando');
  await h.avanzar(200);                                           // pasan los 4 s desde subscribe()
  assert.equal(h.c.conexion, 'sondeo');
  assert.equal(h.c.pastilla.texto, 'Se actualiza cada 20 s');
  honesto(h, 'sin SUBSCRIBED');
  const t0 = h.reloj.ahora();
  await h.avanzar(20000);
  assert.ok(h.lecturasDesde(t0) >= 1, 'sondea');
  h.supabase.suscripcion = 'ok';                                  // vuelve Realtime
  await h.avanzar(60000);                                         // el reintento del canal
  assert.equal(h.supabase.canales.length, 2, 'se abrió un canal nuevo');
  assert.equal(h.supabase.canales[0].quitado, true, 'y el viejo se quitó');
  assert.equal(h.c.conexion, 'vivo');
  honesto(h, 'tras reintentar');
});

test('el canal se cae (CHANNEL_ERROR): sondeo; si supabase-js se reconecta solo (SUBSCRIBED otra vez), vuelve a «En vivo» con una lectura', async () => {
  const h = await abierta();
  const canal = h.supabase.canales[0];
  canal.estado('CHANNEL_ERROR');
  assert.equal(h.c.conexion, 'sondeo');
  assert.equal(h.c.pastilla.texto, 'Se actualiza cada 20 s');
  await h.avanzar(1000);
  const antes = h.llamadas.cuenta.length;
  h.mundo.agregar('Jugo', 4000);                                  // se perdió mientras estaba caído
  canal.estado('SUBSCRIBED');
  await h.avanzar(100);
  assert.equal(h.c.conexion, 'vivo');
  assert.equal(h.llamadas.cuenta.length, antes + 1, 'al reconectar lee de nuevo');
  assert.equal(h.c.cuenta.items.length, 2);
});

test('si supabase-js no carga (red o SRI que no coincide): sondeo de 20 s, la cuenta se ve, y a los 60 s reintenta la librería', async () => {
  const h = await crearCarta();
  await h.iniciar();
  h.supabase.libreria = 'error';
  h.c.abrirCuenta();
  await h.avanzar(500);
  assert.equal(h.c.cuenta.estado, 'ok');
  assert.equal(h.c.conexion, 'sondeo');
  assert.equal(h.supabase.canales.length, 0);
  h.supabase.libreria = 'ok';
  await h.avanzar(61000);
  assert.equal(h.supabase.scripts.length, 2, 'volvió a pedir la librería');
  assert.equal(h.c.conexion, 'vivo');
});

// ── `o`: la orden que la pestaña miraba ──

test('`o`: se guarda al ver la orden, se manda en las lecturas siguientes y vive en sessionStorage por mesa', async () => {
  const h = await abierta();
  assert.equal(h.c.orden, 'orden1');
  assert.equal(h.almacen.get('cuenta:3'), 'orden1');
  h.cambio((m) => m.agregar('Jugo', 4000));
  await h.avanzar(1000);
  assert.equal(h.ordenes()[0], null);
  assert.equal(h.ordenes()[h.ordenes().length - 1], 'orden1', 'las lecturas siguientes mandan `o`');
});

for (const tipo of ['reload', 'back_forward']) {
  test(`navegación «${tipo}»: la pestaña recupera su \`o\` de sessionStorage y la manda desde la primera lectura`, async () => {
    const h = await crearCarta({ navegacion: tipo, almacen: { 'cuenta:3': 'orden1' } });
    await h.iniciar();
    await h.abrir(100);
    assert.equal(h.c.orden, 'orden1');
    assert.equal(h.ordenes()[0], 'orden1');
  });
}

test('navegación «navigate» (un toque nuevo de la pegatina): descarta la `o` vieja, no la manda y limpia el almacén', async () => {
  const h = await crearCarta({ navegacion: 'navigate', almacen: { 'cuenta:3': 'orden-vieja' } });
  await h.iniciar();
  assert.equal(h.c.orden, null);
  assert.equal(h.almacen.has('cuenta:3'), false, 'se limpió');
  await h.abrir(100);
  assert.equal(h.ordenes()[0], null);
  assert.equal(h.c.cuenta.estado, 'ok', 've la orden actual, no «cerrada»');
});

test('`o` recuperada que ya no es la orden abierta: «cerrada», y NO salta a la orden siguiente de la mesa', async () => {
  const h = await crearCarta({ navegacion: 'reload', almacen: { 'cuenta:3': 'orden-de-ayer' } });
  await h.iniciar();
  await h.abrir(500);
  assert.equal(h.c.cuenta.estado, 'cerrada');
  assert.equal(h.c.conexion, 'vencido');
  assert.deepEqual(plano(h.c.cuenta.items), [], 'no enseña nada de la orden que está abierta ahora');
  assert.equal(h.supabase.canales.length, 0, 'ni abre el canal');
});

test('una `o` guardada con formato raro se ignora (no llega a la URL) y sessionStorage que lanza no rompe nada', async () => {
  const h1 = await crearCarta({ navegacion: 'reload', almacen: { 'cuenta:3': '"><script>' } });
  await h1.iniciar(); await h1.abrir(100);
  assert.equal(h1.c.orden, 'orden1', 'ignoró la basura y tomó la orden que dijo el servidor');
  assert.equal(h1.ordenes()[0], null);

  const h2 = await crearCarta({ navegacion: 'reload', almacenLanza: true });
  await h2.iniciar(); await h2.abrir(500);
  assert.equal(h2.c.cuenta.estado, 'ok');
  assert.equal(h2.c.orden, 'orden1', 'sin almacén igual la guarda en memoria');
  assert.equal(h2.c.conexion, 'vivo');
});

// ── cerrada y vencido ──

test('orden cerrada mientras mira: «Mesa cerrada. ¡Gracias!», se cierra el canal y no se vuelve a leer', async () => {
  const h = await abierta();
  h.cambio((m) => m.cerrar());
  await h.avanzar(1000);
  assert.equal(h.c.cuenta.estado, 'cerrada');
  assert.equal(h.c.cuenta.pagoConfirmado, false);
  assert.equal(h.c.conexion, 'vencido');
  assert.equal(h.c.pastilla.texto, 'Cuenta cerrada');
  assert.equal(h.supabase.vivos().length, 0, 'el canal se cerró');
  const antes = h.llamadas.cuenta.length;
  h.mundo.abrirOrden([{ nombre: 'Del siguiente cliente', precio: 9999, cantidad: 1 }]);
  await h.avanzar(300000);
  assert.equal(h.llamadas.cuenta.length, antes, 'cinco minutos después no hay una sola lectura más');
  assert.deepEqual(plano(h.c.cuenta.items), [], 'y no enseña la orden siguiente');
});

test('orden cerrada con el pago confirmado por el mesero: «Pago confirmado. ¡Gracias!»', async () => {
  const h = await abierta();
  h.cambio((m) => m.cerrar({ pago: true }));
  await h.avanzar(1000);
  assert.equal(h.c.cuenta.estado, 'cerrada');
  assert.equal(h.c.cuenta.pagoConfirmado, true);
});

test('un servidor que ignora `o` y devuelve OTRA orden abierta: la carta la trata como cerrada (no salta a la siguiente)', async () => {
  const h = await abierta();
  h.mundo.cerrar();
  h.mundo.abrirOrden([{ nombre: 'Del siguiente cliente', precio: 9999, cantidad: 1 }]);
  const original = h.mundo.responder;
  h.mundo.responder = (url) => original(url.replace(/&o=[^&]*/, ''));   // simula una función sin soporte de `o`
  h.supabase.senal(h.mundo.topico);
  await h.avanzar(1000);
  assert.equal(h.c.cuenta.estado, 'cerrada');
  assert.deepEqual(plano(h.c.cuenta.items), []);
});

test('token rotado mientras mira: la señal llega al canal viejo, `cuenta` da 404 y la hoja dice «Este enlace ya no sirve» sin más lecturas', async () => {
  const h = await abierta();
  const viejo = h.mundo.topico;
  h.mundo.rotarToken();
  h.supabase.senal(viejo);                                        // el trigger de `mesas` avisa al tópico viejo
  await h.avanzar(1000);
  assert.equal(h.c.cuenta.estado, 'vencido');
  assert.equal(h.c.conexion, 'vencido');
  assert.equal(h.c.pastilla.texto, 'Enlace vencido');
  assert.equal(h.supabase.vivos().length, 0);
  const antes = h.llamadas.cuenta.length;
  await h.avanzar(300000);
  assert.equal(h.llamadas.cuenta.length, antes);
  // Cerrar y volver a abrir la hoja tampoco lee: el enlace ya no sirve.
  h.c.cerrarCuenta();
  h.c.abrirCuenta();
  await h.avanzar(1000);
  assert.equal(h.llamadas.cuenta.length, antes);
  assert.equal(h.c.cuenta.estado, 'vencido');
});

test('404 con el cuerpo de la `cuenta` de hoy ({error:"enlace inválido"}) también es enlace vencido; un 404 de otra cosa NO', async () => {
  const h = await abierta();
  h.mundo.fallo = { status: 404, body: { error: 'enlace inválido' } };
  h.supabase.senal(h.mundo.topico);
  await h.avanzar(1000);
  assert.equal(h.c.cuenta.estado, 'vencido');

  const g = await abierta();
  g.mundo.fallo = { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } };
  g.supabase.senal(g.mundo.topico);
  await g.avanzar(1000);
  assert.equal(g.c.cuenta.estado, 'ok', 'una función que no está no es un enlace vencido: se queda con la cuenta');
  assert.equal(g.c.conexion, 'sin_red');
  assert.equal(g.c.pastilla.texto, 'No se pudo actualizar');
});

// ── sin conexión, 429, página oculta ──

test('sin conexión con la cuenta cargada: no la pisa, dice «Sin conexión · leída a las 13:00», reintenta con espera creciente y vuelve al reconectar', async () => {
  const h = await abierta();
  assert.equal(h.c.pastilla.texto, 'En vivo');
  h.mundo.fallo = 'red';
  h.cambio((m) => m.agregar('Jugo', 4000));
  await h.avanzar(500);
  assert.equal(h.c.conexion, 'sin_red');
  assert.match(h.c.pastilla.texto, /^Sin conexión · leída a las 0?1:00/, 'lleva la hora de la última lectura (13:00 en Bogotá)');
  assert.equal(h.c.cuenta.estado, 'ok', 'la cuenta buena no se pisa');
  assert.deepEqual(nombres(h), ['Limonada']);
  honesto(h, 'sin red');
  // Espera creciente: 5, 10, 20, 30, 30 s.
  const t0 = h.reloj.ahora();
  const antes = h.llamadas.cuenta.length;
  await h.avanzar(100000);
  const tiempos = h.llamadas.cuenta.slice(antes).map((l) => l.en - t0);
  const huecos = tiempos.slice(1).map((t, i) => t - tiempos[i]);
  assert.ok(tiempos.length >= 5, `reintentó ${tiempos.length} veces`);
  assert.deepEqual(huecos.slice(0, 4), [10000, 20000, 30000, 30000], 'espera creciente con tope de 30 s');
  // Vuelve la red: al evento `online` lee al instante y vuelve a «En vivo» (el canal seguía suscrito).
  h.mundo.fallo = null;
  h.ventana.despachar('online');
  await h.avanzar(100);
  assert.equal(h.c.conexion, 'vivo');
  assert.deepEqual(nombres(h), ['Limonada', 'Jugo']);
});

test('el evento `offline` pasa a «Sin conexión» al instante, sin esperar a que falle una lectura', async () => {
  const h = await abierta();
  h.ventana.despachar('offline');
  assert.equal(h.c.conexion, 'sin_red');
  assert.match(h.c.pastilla.texto, /^Sin conexión · leída a las /);
});

test('sin red al abrir: «No pudimos leer la cuenta» con «Reintentar», reintenta sola, y «Reintentar» lee ya', async () => {
  const h = await crearCarta();
  await h.iniciar();
  h.mundo.fallo = 'red';
  h.c.abrirCuenta();
  await h.avanzar(100);
  assert.equal(h.c.cuenta.estado, 'error');
  assert.equal(h.c.conexion, 'sin_red');
  assert.equal(h.supabase.scripts.length, 0, 'sin cuenta todavía no hay canal que abrir');
  const antes = h.llamadas.cuenta.length;
  await h.avanzar(5000);
  assert.equal(h.llamadas.cuenta.length, antes + 1, 'reintenta sola a los 5 s');
  h.mundo.fallo = null;
  h.c.reintentar();
  assert.equal(h.c.cuenta.estado, 'cargando');
  await h.avanzar(500);
  assert.equal(h.c.cuenta.estado, 'ok');
  assert.equal(h.c.conexion, 'vivo', 'con la cuenta ya abre el canal');
});

test('una lectura que no contesta se corta a los 8 s y cuenta como fallo (no se queda colgada)', async () => {
  const h = await crearCarta();
  await h.iniciar();
  h.mundo.fallo = 'lento';
  h.c.abrirCuenta();
  await h.avanzar(7900);
  assert.equal(h.c.cuenta.estado, 'cargando');
  await h.avanzar(200);
  assert.equal(h.c.cuenta.estado, 'error');
  assert.match(h.c.cuenta.error, /La red tardó demasiado/);
});

test('429: conserva la cuenta, dice «Muchas consultas, reintentando…» y respeta Retry-After (aunque lleguen señales)', async () => {
  const h = await abierta();
  h.mundo.fallo = { status: 429, body: { error: 'demasiadas solicitudes', codigo: 'demasiadas' }, headers: { 'retry-after': '20' } };
  h.cambio((m) => m.agregar('Jugo', 4000));
  await h.avanzar(500);
  assert.equal(h.c.pastilla.texto, 'Muchas consultas, reintentando…');
  assert.equal(h.c.cuenta.estado, 'ok');
  assert.notEqual(h.c.conexion, 'sin_red', 'un 429 no es estar sin conexión');
  const t0 = h.reloj.ahora();
  const antes = h.llamadas.cuenta.length;
  for (let i = 0; i < 5; i++) { h.supabase.senal(h.mundo.topico); await h.avanzar(3000); }   // 15 s de señales
  assert.equal(h.llamadas.cuenta.length, antes, 'durante el Retry-After no sale ni un pedido');
  h.mundo.fallo = null;
  await h.avanzar(6000);                                          // pasan los 20 s
  assert.ok(h.llamadas.cuenta.length > antes, 'reintentó al vencer');
  assert.ok(h.llamadas.cuenta[antes].en - t0 >= 4000);
  assert.equal(h.c.pastilla.texto, 'En vivo');
  assert.deepEqual(nombres(h), ['Limonada', 'Jugo']);
});

test('429 sin Retry-After espera 30 s; con 1 s se sube a 5 s; con 9999 s se baja a 120 s', async () => {
  for (const [cabecera, esperado] of [[undefined, 30000], ['1', 5000], ['9999', 120000]]) {
    const h = await abierta();
    h.mundo.fallo = { status: 429, body: {}, headers: cabecera === undefined ? {} : { 'retry-after': cabecera } };
    const t0 = h.reloj.ahora();
    h.supabase.senal(h.mundo.topico);
    await h.avanzar(500);
    const n = h.llamadas.cuenta.length;
    h.mundo.fallo = null;
    await h.avanzar(esperado - 600);
    assert.equal(h.llamadas.cuenta.length, n, `Retry-After ${cabecera}: no antes de ${esperado} ms (pasó ${h.reloj.ahora() - t0})`);
    await h.avanzar(1500);
    assert.equal(h.llamadas.cuenta.length, n + 1, `Retry-After ${cabecera}: sí a los ${esperado} ms`);
  }
});

test('página oculta: con menos de 60 s el canal sigue y al volver lee; con más de 60 s se cierra, y al volver lee y se suscribe de nuevo', async () => {
  const h = await abierta();
  await h.ocultar();
  await h.avanzar(30000);
  assert.equal(h.supabase.vivos().length, 1, 'oculta 30 s: el canal sigue');
  const antes = h.llamadas.cuenta.length;
  await h.mostrar();
  await h.avanzar(100);
  assert.equal(h.llamadas.cuenta.length, antes + 1, 'al volver lee');
  assert.equal(h.supabase.canales.length, 1);

  await h.ocultar();
  await h.avanzar(61000);
  assert.equal(h.supabase.vivos().length, 0, 'oculta más de 60 s: el canal se cierra');
  const n = h.llamadas.cuenta.length;
  await h.avanzar(300000);
  assert.equal(h.llamadas.cuenta.length, n, 'y mientras está oculta no lee nada');
  h.mundo.agregar('Jugo', 4000);
  await h.mostrar();
  await h.avanzar(1000);
  assert.equal(h.supabase.canales.length, 2, 'se suscribe de nuevo');
  assert.equal(h.supabase.vivos().length, 1);
  assert.equal(h.c.conexion, 'vivo');
  assert.equal(h.c.cuenta.items.length, 2, 'y lo que cambió mientras estaba oculta aparece');
});

test('una señal que llega con la página oculta (canal aún abierto) no gasta una lectura: se lee al volver', async () => {
  const h = await abierta();
  await h.ocultar();
  const antes = h.llamadas.cuenta.length;
  h.cambio((m) => m.agregar('Jugo', 4000));
  await h.avanzar(5000);
  assert.equal(h.llamadas.cuenta.length, antes, 'oculta no lee');
  assert.equal(h.c.cuenta.items.length, 1);
  await h.mostrar();
  await h.avanzar(100);
  assert.equal(h.llamadas.cuenta.length, antes + 1, 'al volver, una lectura');
  assert.equal(h.c.cuenta.items.length, 2);
});

test('al volver de estar oculta NO declara mudo el canal aunque la marca haya cambiado (esa lectura reconcilia, no vigila)', async () => {
  const h = await abierta();
  await h.ocultar();
  h.mundo.agregar('Jugo', 4000);                                  // el WebSocket estaba dormido: la señal no llegó
  await h.avanzar(20000);
  await h.mostrar();
  await h.avanzar(70000);
  assert.equal(h.c._mudo, false);
  assert.equal(h.c.conexion, 'vivo');
  assert.equal(h.c.cuenta.items.length, 2);
});

// ── «Leída hace X s», reloj del servidor ──

test('«Leída hace X s» cuenta desde que llegó la respuesta, y no depende del reloj del teléfono', async () => {
  const h = await abierta();
  assert.equal(h.c.leida, 'Leída ahora');
  await h.avanzar(12000);                                         // el reloj de la hoja late cada segundo: ±1 s
  const seg = Number(h.c.leida.match(/^Leída hace (\d+) s$/)[1]);
  assert.ok(seg === 11 || seg === 12, h.c.leida);
  // Una lectura nueva reinicia la cuenta.
  h.cambio((m) => m.agregar('Jugo', 4000));
  await h.avanzar(1500);
  assert.match(h.c.leida, /^Leída (ahora|hace 1 s)$/);
  // Con un 429 de 120 s no hay lecturas nuevas: pasado el minuto se dice en minutos.
  h.mundo.fallo = { status: 429, body: {}, headers: { 'retry-after': '120' } };
  h.supabase.senal(h.mundo.topico);
  await h.avanzar(72000);
  assert.match(h.c.leida, /^Leída hace 1 min$/, h.c.leida);
});

test('«leída a las hh:mm» sale de servidor_en (hora de Bogotá), no del reloj del teléfono', async () => {
  const h = await abierta();
  const original = h.mundo.responder;
  h.mundo.responder = (url) => {
    const r = original(url);
    if (r.body.servidor_en) r.body.servidor_en = '2026-10-01T21:07:00.000Z';     // el teléfono marca 13:00 de Bogotá; el servidor dice 16:07
    return r;
  };
  h.cambio((m) => m.agregar('Jugo', 4000));
  await h.avanzar(1000);
  h.mundo.fallo = 'red';
  h.ventana.despachar('offline');
  assert.match(h.c.pastilla.texto, /^Sin conexión · leída a las 0?4:07/, h.c.pastilla.texto);
  assert.equal(h.c.leida, '', 'sin conexión la hora ya está en la pastilla');
});

// ── cerrar la hoja ──

test('cerrar la hoja lo detiene todo: canal quitado, ningún temporizador, ninguna lectura, sin escuchas; al reabrir vuelve a empezar', async () => {
  const h = await abierta();
  h.c.cerrarCuenta();
  assert.equal(h.supabase.vivos().length, 0);
  assert.equal(h.doc.cuantos('visibilitychange'), 0);
  assert.equal(h.ventana.cuantos('online'), 0);
  assert.equal(h.ventana.cuantos('offline'), 0);
  await h.avanzar(200);
  assert.equal(h.reloj.pendientes(), 0, 'no queda ningún temporizador vivo');
  const antes = h.llamadas.cuenta.length;
  await h.avanzar(600000);
  assert.equal(h.llamadas.cuenta.length, antes, 'cerrada, no gasta lecturas');

  h.mundo.agregar('Jugo', 4000);
  h.c.abrirCuenta();
  await h.avanzar(1000);
  assert.equal(h.c.cuenta.items.length, 2, 'al reabrir ya trae lo nuevo');
  assert.equal(h.supabase.canales.length, 2, 'y abre un canal nuevo');
  assert.equal(h.supabase.scripts.length, 1, 'sin volver a bajar la librería');
  assert.equal(h.c.conexion, 'vivo');
});

test('cerrar la hoja mientras conecta no deja un canal huérfano', async () => {
  const h = await crearCarta();
  await h.iniciar();
  h.supabase.latenciaLibreria = 1000;
  h.c.abrirCuenta();
  await h.avanzar(300);
  h.c.cerrarCuenta();
  await h.avanzar(5000);
  assert.equal(h.supabase.vivos().length, 0, 'la librería llegó después de cerrar y no abrió ningún canal');
});

test('el cliente y el canal de supabase-js viven FUERA del objeto reactivo de Alpine (un Proxy los rompería)', async () => {
  const h = await abierta();
  const propios = Object.getOwnPropertyNames(h.c).map((k) => h.c[k]);
  for (const algo of [...h.supabase.canales, ...h.supabase.clientes]) {
    assert.ok(!propios.includes(algo), 'un cliente o un canal de supabase quedó guardado en el objeto de Alpine');
  }
});

test('«En vivo» es honesto durante todo un recorrido: conecta, se pierde una señal, se cae el canal, vuelve, cierran la mesa', async () => {
  const h = await crearCarta();
  await h.iniciar();
  const pasos = [
    ['abre', async () => { h.c.abrirCuenta(); await h.avanzar(500); }],
    ['cambio con señal', async () => { h.cambio((m) => m.agregar('A', 1000)); await h.avanzar(1000); }],
    ['cambio sin señal', async () => { h.cambio((m) => m.agregar('B', 1000), { senal: false }); await h.avanzar(65000); }],
    ['vuelve la señal', async () => { h.cambio((m) => m.agregar('C', 1000)); await h.avanzar(1000); }],
    ['se cae el canal', async () => { h.supabase.canales[0].estado('CHANNEL_ERROR'); await h.avanzar(5000); }],
    ['sin red', async () => { h.mundo.fallo = 'red'; await h.avanzar(30000); }],
    ['vuelve la red', async () => { h.mundo.fallo = null; h.ventana.despachar('online'); await h.avanzar(500); }],
    ['cierran la mesa', async () => { h.cambio((m) => m.cerrar()); await h.avanzar(1000); }],
  ];
  const vistos = [];
  for (const [nombre, paso] of pasos) {
    await paso();
    honesto(h, nombre);
    vistos.push(h.c.pastilla.texto);
  }
  assert.ok(vistos.includes('Se actualiza cada 20 s') && vistos.includes('En vivo') && vistos.includes('Cuenta cerrada'), vistos.join(' | '));
  assert.ok(vistos.some((t) => t.startsWith('Sin conexión')), vistos.join(' | '));
});

// ───────────────────────── 3. en navegador: los estados de la hoja a 320 px ─────────────────────────
// Solo si hay Playwright y Chromium (ver _navegador.mjs) y la CDN de Alpine responde (la página lo carga con
// SRI desde jsDelivr): si no, se salta con el motivo. Nunca toca Supabase: `cuenta` y la vista se contestan
// aquí, y sin `canal` en la respuesta la carta se queda en sondeo (no abre WebSocket ni baja supabase-js).

const pw = buscarPlaywright();
let navegador = null;
let servidor = null;
let motivoNavegador = pw.motivo;
if (pw.chromium) {
  try {
    const cdn = await fetch('https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js', { method: 'HEAD', signal: AbortSignal.timeout(6000) });
    if (!cdn.ok) throw new Error('jsDelivr respondió ' + cdn.status);
    navegador = await pw.chromium.launch();
    servidor = await servirRaiz(RAIZ);
  } catch (e) {
    motivoNavegador = `no pude abrir Chromium o llegar a la CDN (${String(e.message).split('\n')[0]})`;
    if (navegador) await navegador.close();
    navegador = null;
  }
}
after(async () => {
  if (navegador) await navegador.close();
  if (servidor) await new Promise((resolver) => servidor.close(resolver));
});

const LARGO = 'Bandeja paisa Resplandor para compartir entre toda la mesa con arepa y aguacate';
const cuerpoAbierta = (items) => ({
  mesa: 3, estado: 'abierta', abierta: true, orden_id: 'orden1', marca: '5.0', abierta_en: '2026-10-01T17:00:00.000Z', actualizada_en: '2026-10-01T17:05:00.000Z',
  items, total: items.reduce((n, i) => n + i.precio * i.cantidad, 0), liquidar_activo: false, liquidacion: null, servidor_en: '2026-10-01T18:00:00.000Z',
});
const ESTADOS = {
  'ok, con nombres largos y muchas líneas': { respuesta: { status: 200, body: cuerpoAbierta(Array.from({ length: 14 }, (_, i) => ({ nombre: i % 3 ? 'Limonada ' + i : LARGO, precio: 1234567, cantidad: 1 + (i % 4) }))) }, espera: /Consumo en vivo/i },
  'error al abrir (sin red)': { respuesta: null, espera: /No pudimos leer la cuenta/i, boton: 'Reintentar' },
  'mesa cerrada': { respuesta: { status: 200, body: { mesa: 3, estado: 'cerrada', abierta: false, pago_confirmado: false, servidor_en: '2026-10-01T18:00:00.000Z' } }, espera: /Mesa cerrada\. ¡Gracias!/i },
  'pago confirmado': { respuesta: { status: 200, body: { mesa: 3, estado: 'cerrada', abierta: false, pago_confirmado: true, servidor_en: '2026-10-01T18:00:00.000Z' } }, espera: /Pago confirmado\. ¡Gracias!/i },
  'enlace vencido': { respuesta: { status: 404, body: { error: 'enlace inválido', codigo: 'enlace_invalido' } }, espera: /Este enlace ya no sirve/i },
  'sin conexión con la cuenta cargada (pastilla larga)': { respuesta: { status: 200, body: cuerpoAbierta([{ nombre: 'Limonada', precio: 5000, cantidad: 1 }]) }, antes: /Limonada/i, espera: /Sin conexión · leída a las/i, alCargar: (page) => page.evaluate(() => window.dispatchEvent(new Event('offline'))) },
};
for (const ancho of [320, 390]) {
  for (const [nombre, caso] of Object.entries(ESTADOS)) {
    test(`navegador a ${ancho} px: la hoja «${nombre}» no desborda y dice lo que debe`, { skip: navegador ? false : `navegador no disponible: ${motivoNavegador}` }, async () => {
      const contexto = await navegador.newContext({ viewport: { width: ancho, height: 640 }, timezoneId: 'America/Bogota', locale: 'es-CO' });
      try {
        const page = await contexto.newPage();
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        await page.route(/\.supabase\.co\//, (r) => {
          const req = r.request();
          if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
          if (req.url().includes('/functions/v1/cuenta')) {
            if (!caso.respuesta) return r.abort('connectionfailed');
            return r.fulfill({ status: caso.respuesta.status, headers: cors, contentType: 'application/json', body: JSON.stringify(caso.respuesta.body) });
          }
          return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
        });
        await page.goto(`http://127.0.0.1:${servidor.address().port}/carta.html?m=3&k=${TOKEN_CEROS}`, { waitUntil: 'load' });
        await page.getByRole('button', { name: /Ver mi cuenta/ }).click();
        const dialogo = page.getByRole('dialog');
        await dialogo.waitFor({ state: 'visible' });
        // El texto de la hoja usa mayúsculas por CSS (innerText las devuelve así): se compara sin distinguirlas.
        const esperar = (re, ms) => page.waitForFunction(([fuente, banderas]) => new RegExp(fuente, banderas).test(document.querySelector('[role=dialog]').innerText), [re.source, re.flags], { timeout: ms });
        await esperar(caso.antes || caso.espera, 8000);
        if (caso.alCargar) { await caso.alCargar(page); await esperar(caso.espera, 4000); }
        if (caso.boton) assert.ok(await page.getByRole('button', { name: caso.boton }).isVisible(), `falta el botón «${caso.boton}»`);
        await page.waitForTimeout(400);
        const r = await page.evaluate(() => {
          const d = document.documentElement;
          const hoja = document.querySelector('[role=dialog]');
          const pastilla = document.querySelector('.cuenta-vivo').getBoundingClientRect();
          return { pagina: d.scrollWidth - d.clientWidth, hoja: hoja.scrollWidth - hoja.clientWidth, pastillaDerecha: pastilla.right, ancho: window.innerWidth };
        });
        assert.equal(r.pagina, 0, `la página desborda ${r.pagina} px`);
        assert.equal(r.hoja, 0, `la hoja desborda ${r.hoja} px`);
        assert.ok(r.pastillaDerecha <= r.ancho + 0.5, `la pastilla se sale de la pantalla (${r.pastillaDerecha} de ${r.ancho})`);
        assert.ok(await dialogo.getByText('Consumo en vivo · no es factura').isVisible(), 'falta el rótulo «Consumo en vivo · no es factura»');
      } finally {
        await contexto.close();
      }
    });
  }
}
