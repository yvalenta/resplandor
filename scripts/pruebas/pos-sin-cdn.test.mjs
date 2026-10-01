// pos.html NO depende de CDNs de terceros para sus scripts.
//
// Por qué existe: el POS (uso diario del restaurante) cargaba Tailwind, Alpine, Lucide y supabase-js
// desde cdn.tailwindcss.com, jsdelivr y unpkg, con versiones que flotaban solas (`alpinejs@3.x.x`,
// `lucide@latest`, `supabase-js@2`). Si la red o el teléfono de un mesero no alcanzaba uno de esos
// hosts, el POS quedaba sin estilos y sin funciones. Hoy los cuatro son archivos locales de versión
// fija en assets/vendor/ (ver su README).
//
// Qué verifica
//   1. (estática) Todo <script src> de pos.html es una ruta relativa a un archivo que existe en
//      assets/vendor/; ningún <script>, <link>, <img>, <source>, <iframe>… pide algo a un host que no
//      sea la tipografía de Google; y ningún script en línea inyecta otro script (createElement,
//      import(), importScripts, document.write). Un CDN nuevo, aunque sea «solo uno», falla aquí.
//   2. (estática) El orden y los atributos que el POS necesita: Tailwind síncrono y ANTES del script
//      que define `tailwind.config`; supabase-js síncrono y antes del script del store; Alpine y
//      Lucide con `defer`.
//   3. (estática) El README de assets/vendor/ dice la verdad: cada archivo de la tabla existe, con
//      los bytes y el sha256 que dice, la versión va en el nombre y aparece dentro del propio archivo
//      (una versión flotante o un archivo cambiado a mano no pasan).
//   4. (navegador) Con TODA la red externa cortada, el POS se ve y funciona: los archivos reales
//      cargan (Tailwind genera su CSS, Alpine arranca, Lucide pinta los íconos, supabase-js existe);
//      y, con Supabase simulado, se abre una mesa, se agrega un producto y se cobra. Ningún pedido
//      sale hacia cdn.tailwindcss.com, jsdelivr ni unpkg.
//
// Los casos de navegador se saltan si no hay Playwright con Chromium (Node ≥ 20): ver _navegador.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './_navegador.mjs';
import { abrirPos, esperarEstable, llamadasSupabase, nuevoContexto, servirPos } from './_pos-simulado.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const POS = leer('pos.html');
const SIN_COMENTARIOS = POS.replace(/<!--[\s\S]*?-->/g, '');

/** Lo único externo que pos.html todavía puede pedir: la tipografía (si falla, cae a la de respaldo). */
const HOSTS_PERMITIDOS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const HOSTS_CDN_PROHIBIDOS = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'unpkg.com'];

/** { nombre: valor|true } de los atributos de una etiqueta (lo que va entre «<script» y «>»). */
function atributos(texto) {
  const a = {};
  for (const m of texto.matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? true;
  return a;
}

/** Cada <script …> del documento (sin los comentarios HTML): { attrs, cuerpo, indice }. */
function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: atributos(m[1]), cuerpo: m[2], indice: m.index }));
}

const SCRIPTS = scripts(SIN_COMENTARIOS);
const CON_SRC = SCRIPTS.filter((s) => s.attrs.src);
const EN_LINEA = SCRIPTS.filter((s) => !s.attrs.src);
const esExterna = (url) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url);

// ───────────────────────── 1. ningún recurso de otro host (salvo la tipografía) ─────────────────────────

test('pos.html: carga exactamente cuatro scripts con src y todos son archivos locales de assets/vendor/ que existen', () => {
  assert.equal(CON_SRC.length, 4, `scripts con src: ${CON_SRC.map((s) => s.attrs.src).join(', ')}`);
  for (const { attrs } of CON_SRC) {
    assert.ok(!esExterna(attrs.src), `<script src="${attrs.src}"> apunta a otro host o esquema: el POS no puede depender de un tercero para sus scripts`);
    assert.match(attrs.src, /^assets\/vendor\/[\w.-]+\.js$/, `<script src="${attrs.src}">: va en assets/vendor/ y con ruta relativa a pos.html`);
    assert.ok(fs.existsSync(path.join(RAIZ, attrs.src)), `${attrs.src} no existe`);
    assert.equal(attrs.type, undefined, `${attrs.src}: sin type (un módulo se cargaría distinto)`);
  }
});

test('pos.html: ninguna etiqueta que el navegador pide sola (script, link, img, source, iframe, video, audio, embed, object) apunta a un host que no sea la tipografía de Google', () => {
  const prohibidos = [];
  const hosts = new Set();
  for (const m of SIN_COMENTARIOS.matchAll(/<(script|link|img|source|iframe|video|audio|embed|object|track|input)\b([^>]*)>/gi)) {
    const a = atributos(m[2]);
    for (const url of [a.src, a.href, a.poster, a.data, a.srcset].filter((v) => typeof v === 'string')) {
      for (const candidata of url.split(',').map((x) => x.trim().split(/\s+/)[0])) {
        if (!esExterna(candidata)) continue;
        const host = new URL(candidata.startsWith('//') ? `https:${candidata}` : candidata).host;
        hosts.add(host);
        if (!HOSTS_PERMITIDOS.has(host)) prohibidos.push(`<${m[1]} ${candidata}>`);
      }
    }
  }
  assert.deepEqual(prohibidos, [], `pos.html pide recursos a hosts de terceros: ${prohibidos.join(' · ')}`);
  for (const h of HOSTS_CDN_PROHIBIDOS) assert.ok(!hosts.has(h), `${h} no debe aparecer en una etiqueta de pos.html`);
});

test('pos.html: ni un CDN de scripts en ningún lugar del archivo fuera de los comentarios (ni en un @import, ni en una cadena del script)', () => {
  for (const h of HOSTS_CDN_PROHIBIDOS) {
    assert.ok(!SIN_COMENTARIOS.includes(h), `«${h}» aparece en pos.html fuera de un comentario HTML: ¿una ruta o un @import a un CDN?`);
  }
  assert.doesNotMatch(SIN_COMENTARIOS, /\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\/(?:cdn|unpkg|esm\.sh|cdnjs|ajax\.googleapis|code\.jquery|stackpath|maxcdn|bootstrapcdn)/i);
});

test('pos.html: ningún script en línea inyecta otro script ni importa un módulo de la red (createElement, import(), importScripts, document.write)', () => {
  assert.equal(EN_LINEA.length, 3, 'pos.html tiene tres <script> en línea: el tailwind.config, el store de Alpine y el que pinta los íconos');
  for (const { cuerpo } of EN_LINEA) {
    assert.doesNotMatch(cuerpo, /createElement\(\s*['"`]script['"`]\s*\)/, 'un script en línea crea un <script> por código');
    assert.doesNotMatch(cuerpo, /\bimport\s*\(/, 'un script en línea hace import() dinámico');
    assert.doesNotMatch(cuerpo, /\bimportScripts\s*\(/, 'importScripts');
    assert.doesNotMatch(cuerpo, /document\.write(?:ln)?\s*\(/, 'document.write');
    assert.doesNotMatch(cuerpo, /<script\b/i, 'un script en línea escribe una etiqueta <script>');
  }
  assert.doesNotMatch(SIN_COMENTARIOS, /<style[^>]*>[\s\S]*?@import\s+(?:url\()?['"]?(?:https?:)?\/\//i, 'un <style> hace @import de una hoja remota');
});

// ───────────────────────── 2. orden y atributos ─────────────────────────

test('orden y atributos: Tailwind síncrono antes de tailwind.config; supabase-js síncrono antes del store; Alpine y Lucide con defer', () => {
  const porNombre = (re) => {
    const s = CON_SRC.find((x) => re.test(x.attrs.src));
    assert.ok(s, `pos.html no carga ${re}`);
    return s;
  };
  const tailwind = porNombre(/tailwindcss-play-/);
  const alpine = porNombre(/alpinejs-/);
  const lucide = porNombre(/lucide-/);
  const supabase = porNombre(/supabase-js-/);
  const config = EN_LINEA.find((s) => /tailwind\.config\s*=/.test(s.cuerpo));
  const store = EN_LINEA.find((s) => /Alpine\.store\(\s*['"]pos['"]/.test(s.cuerpo));
  assert.ok(config && store, 'pos.html tiene que definir tailwind.config y Alpine.store(\'pos\') en scripts en línea');

  for (const [nombre, s] of [['Tailwind', tailwind], ['supabase-js', supabase]]) {
    assert.equal(s.attrs.defer, undefined, `${nombre} debe ser síncrono: lo usa un script en línea que corre al encontrarlo`);
    assert.equal(s.attrs.async, undefined, `${nombre} no puede ser async`);
  }
  for (const [nombre, s] of [['Alpine', alpine], ['Lucide', lucide]]) {
    assert.ok(s.attrs.defer, `${nombre} va con defer (Alpine arranca tras registrar el store en alpine:init; Lucide, tras DOMContentLoaded)`);
    assert.equal(s.attrs.async, undefined, `${nombre} no puede ser async: perdería el orden`);
  }
  assert.ok(tailwind.indice < config.indice, 'Tailwind va ANTES del script que define tailwind.config (el CDN lee la variable global al arrancar)');
  assert.ok(config.indice < alpine.indice || alpine.attrs.defer, 'el tailwind.config se define antes de que corra Alpine');
  assert.ok(supabase.indice < store.indice, 'supabase-js va ANTES del store (que llama a window.supabase.createClient al evaluarse)');
  assert.match(store.cuerpo, /alpine:init/, 'el store se registra en alpine:init (por eso Alpine puede ir con defer)');
});

// ───────────────────────── 3. el README de assets/vendor/ dice la verdad ─────────────────────────

/** Cada archivo → un texto que tiene que estar DENTRO del archivo y que confirma su versión. */
const VERSION_DENTRO = {
  'tailwindcss-play-3.4.17.js': { version: '3.4.17', marca: '="3.4.17"' },
  'alpinejs-3.17.4.min.js': { version: '3.17.4', marca: 'version:"3.17.4"' },
  'lucide-1.49.0.min.js': { version: '1.49.0', marca: 'lucide v1.49.0' },
  'supabase-js-2.117.2.umd.js': { version: '2.117.2', marca: 'supabase-js/2.117.2' },
};

function filasDelReadme() {
  const filas = {};
  for (const linea of leer('assets/vendor/README.md').split('\n')) {
    const celdas = linea.split('|').map((c) => c.trim());
    const nombre = celdas[1]?.match(/^`([^`]+\.js)`$/)?.[1];
    if (!nombre) continue;
    filas[nombre] = { version: celdas[4], bytes: Number(celdas[5]), sha256: celdas[6]?.replace(/`/g, ''), origen: celdas[3] };
  }
  return filas;
}

test('assets/vendor/: los .js son exactamente los cuatro de la tabla del README, con la versión en el nombre y sin versiones flotantes', () => {
  const enDisco = fs.readdirSync(path.join(RAIZ, 'assets/vendor')).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(enDisco, Object.keys(VERSION_DENTRO).sort(), 'archivos .js en assets/vendor/');
  assert.deepEqual(Object.keys(filasDelReadme()).sort(), enDisco, 'la tabla del README lista los mismos archivos');
  for (const f of enDisco) {
    assert.match(f, /-\d+\.\d+\.\d+[.\w-]*\.js$/, `${f}: la versión exacta (x.y.z) va en el nombre`);
    assert.doesNotMatch(f, /latest|x\.x/i, `${f}: nombre con versión flotante`);
  }
});

test('assets/vendor/: cada archivo tiene los bytes y el sha256 que dice el README, y su versión aparece dentro del propio archivo', () => {
  const filas = filasDelReadme();
  for (const [nombre, { version, marca }] of Object.entries(VERSION_DENTRO)) {
    const bytes = fs.readFileSync(path.join(RAIZ, 'assets/vendor', nombre));
    const fila = filas[nombre];
    assert.ok(fila, `el README no tiene fila para ${nombre}`);
    assert.equal(fila.version, version, `${nombre}: versión de la tabla`);
    assert.ok(nombre.includes(version), `${nombre}: el nombre lleva la versión ${version}`);
    assert.equal(bytes.length, fila.bytes, `${nombre}: bytes (¿se editó el archivo?)`);
    assert.match(fila.sha256, /^[0-9a-f]{64}$/, `${nombre}: sha256 de la tabla`);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), fila.sha256, `${nombre}: sha256 distinto del que dice el README (¿se editó el archivo o se actualizó sin actualizar la tabla?)`);
    assert.ok(bytes.toString('utf8').includes(marca), `${nombre}: no contiene «${marca}», así que el nombre dice una versión que el archivo no es`);
    assert.match(fila.origen, /^https:\/\/(?:cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|unpkg\.com)\//, `${nombre}: la tabla dice de dónde salió`);
  }
});

test('pos.html carga exactamente los archivos de la tabla del README (ni uno de más, ni uno sin documentar)', () => {
  assert.deepEqual(CON_SRC.map((s) => path.basename(s.attrs.src)).sort(), Object.keys(filasDelReadme()).sort());
});

// ───────────────────────── 3b. el arnés ya no deja pasar un CDN ─────────────────────────

test('el arnés (_pos-simulado.mjs) solo permite la tipografía de Google fuera del propio origen: ya no cachea ni sirve ningún CDN de scripts', () => {
  const arnes = leer('scripts/pruebas/_pos-simulado.mjs');
  const m = arnes.match(/const HOSTS_FUENTES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'no encontré HOSTS_FUENTES en el arnés');
  assert.deepEqual([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort(), ['fonts.googleapis.com', 'fonts.gstatic.com']);
  for (const h of HOSTS_CDN_PROHIBIDOS) {
    assert.ok(!new RegExp(`['"\`]${h.replace(/\./g, '\\.')}['"\`]`).test(arnes), `el arnés nombra ${h} en una cadena: ¿volvió a permitirlo?`);
  }
});

// ───────────────────────── 4. navegador: red externa cortada ─────────────────────────

const PW = buscarPlaywright();
const SALTAR = PW.chromium ? false : PW.motivo;

/** Corre `fn({ navegador, servidor })` con un Chromium y el servidor local del repo. */
async function conNavegador(fn) {
  const servidor = await servirPos(RAIZ, 0);
  const navegador = await PW.chromium.launch();
  try { return await fn({ navegador, servidor }); } finally { await navegador.close(); await servidor.cerrar(); }
}

test('red externa cortada, archivos REALES (sin simular supabase-js): Tailwind, Alpine, Lucide y supabase-js cargan desde assets/vendor/ y la pantalla de entrada se ve con estilos', { skip: SALTAR, timeout: 90000 }, async () => {
  await conNavegador(async ({ navegador, servidor }) => {
    for (const ancho of [390, 1440]) {
      const contexto = await nuevoContexto(navegador, { ancho, alto: ancho === 390 ? 844 : 900, movil: ancho === 390 });
      const page = await contexto.newPage();
      const externos = [];
      const locales = [];
      const errores = [];
      page.on('pageerror', (e) => errores.push(e.message));
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin === servidor.url) { locales.push(url.pathname); return route.continue(); }
        externos.push(url.href);
        return route.abort('blockedbyclient'); // lo que pasa si la red del teléfono no alcanza ese host
      });
      await page.goto(`${servidor.url}/pos.html`, { waitUntil: 'load' });
      await page.getByText('Entrar con Google').waitFor({ timeout: 30000 });
      await esperarEstable(page);

      const estado = await page.evaluate(() => ({
        tailwind: typeof window.tailwind === 'object' && !!window.tailwind.config,
        alpine: typeof window.Alpine === 'object' && !!Alpine.version,
        alpineVersion: window.Alpine?.version,
        lucide: typeof window.lucide?.createIcons === 'function',
        supabase: typeof window.supabase?.createClient === 'function',
        // El CSS que el Play CDN compila en el navegador (lleva su cabecera con la versión).
        cssTailwind: [...document.querySelectorAll('style')].some((s) => /tailwindcss v3\.4\.17/.test(s.textContent)),
        iconosSinPintar: document.querySelectorAll('i[data-lucide]').length,
        iconosPintados: document.querySelectorAll('svg.lucide').length,
        login: (() => { const e = document.querySelector('.login-pantalla'); const c = e && getComputedStyle(e); return c && { posicion: c.position, display: c.display, fondo: c.backgroundColor }; })(),
      }));
      assert.equal(estado.tailwind, true, `${ancho}: window.tailwind no existe: no cargó el script de Tailwind`);
      assert.equal(estado.cssTailwind, true, `${ancho}: Tailwind no compiló su CSS`);
      assert.equal(estado.alpine, true, `${ancho}: Alpine no arrancó`);
      assert.equal(estado.alpineVersion, '3.17.4', `${ancho}: versión de Alpine`);
      assert.equal(estado.lucide, true, `${ancho}: window.lucide no existe`);
      assert.equal(estado.supabase, true, `${ancho}: window.supabase.createClient no existe: no cargó supabase-js`);
      assert.equal(estado.iconosSinPintar, 0, `${ancho}: quedaron <i data-lucide> sin convertir en <svg>`);
      assert.ok(estado.iconosPintados > 0, `${ancho}: Lucide no pintó ningún ícono`);
      assert.deepEqual(estado.login && [estado.login.posicion, estado.login.display], ['fixed', 'flex'], `${ancho}: la pantalla de entrada (clases fixed/flex de Tailwind) no tiene estilos`);
      assert.notEqual(estado.login?.fondo, 'rgba(0, 0, 0, 0)', `${ancho}: la pantalla de entrada no tiene el fondo del telón`);

      for (const vendor of ['tailwindcss-play-3.4.17.js', 'alpinejs-3.17.4.min.js', 'lucide-1.49.0.min.js', 'supabase-js-2.117.2.umd.js']) {
        assert.ok(locales.includes(`/assets/vendor/${vendor}`), `${ancho}: el navegador no pidió /assets/vendor/${vendor}`);
      }
      const hosts = new Set(externos.map((u) => new URL(u).host));
      for (const h of HOSTS_CDN_PROHIBIDOS) assert.ok(!hosts.has(h), `${ancho}: el POS pidió ${h}`);
      assert.deepEqual([...hosts].filter((h) => !HOSTS_PERMITIDOS.has(h)), [], `${ancho}: pedidos a hosts que no son la tipografía: ${externos.join(' · ')}`);
      assert.deepEqual(errores, [], `${ancho}: errores de página con la red externa cortada`);
      await contexto.close();
    }
  });
});

test('red externa TOTALMENTE cortada (ni tipografía) y Supabase simulado: se abre una mesa, se agrega un producto y se cobra; nada sale a un CDN', { skip: SALTAR, timeout: 120000 }, async () => {
  await conNavegador(async ({ navegador, servidor }) => {
    for (const ancho of [390, 1440]) {
      const contexto = await nuevoContexto(navegador, { ancho, alto: ancho === 390 ? 844 : 900, movil: ancho === 390 });
      const page = await contexto.newPage();
      const { diag } = await abrirPos(page, { url: servidor.url, vista: 'mesas', bloquearFuentes: true });

      // La pantalla de mesas, con estilos y con íconos.
      const base = await page.evaluate(() => ({
        mesas: document.querySelectorAll('.mesa-card').length,
        iconos: document.querySelectorAll('svg.lucide').length,
        sinPintar: document.querySelectorAll('i[data-lucide]').length,
        fondo: getComputedStyle(document.body).backgroundColor,
        cssTailwind: [...document.querySelectorAll('style')].some((s) => /tailwindcss v3\.4\.17/.test(s.textContent)),
        alpine: window.Alpine?.version,
      }));
      assert.equal(base.mesas, 10, `${ancho}: el mapa debería tener 10 mesas`);
      assert.ok(base.iconos > 0 && base.sinPintar === 0, `${ancho}: íconos de Lucide (${base.iconos} pintados, ${base.sinPintar} sin pintar)`);
      assert.equal(base.cssTailwind, true, `${ancho}: sin el CSS de Tailwind`);
      assert.equal(base.alpine, '3.17.4');
      assert.notEqual(base.fondo, 'rgba(0, 0, 0, 0)', `${ancho}: el cuerpo no tiene fondo`);

      // Abrir una mesa libre (la 1), agregar un producto y cobrar.
      await page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: /^1$/ }) }).click();
      await page.waitForFunction(() => Alpine.store('pos').vista === 'orden');
      await page.locator('.menu-item', { hasText: 'Churrasco 250 g' }).first().click();
      await page.waitForFunction(() => (Alpine.store('pos').ordenActiva?.items || []).some((i) => i.nombre === 'Churrasco 250 g'));
      await page.getByRole('button', { name: 'Generar ticket y cobrar', exact: true }).click();
      await page.getByRole('button', { name: 'Sí, cobrar', exact: true }).click();
      await page.waitForFunction(() => Alpine.store('pos').vista === 'ticket');
      await esperarEstable(page);

      const ticket = await page.evaluate(() => {
        const p = Alpine.store('pos');
        const o = p.ordenes.find((x) => x.mesaId === 1 && x.estado === 'cerrada');
        return { orden: o && { total: o.total, items: o.items.map((i) => `${i.qty}× ${i.nombre}`) }, mesa1: p.mesas.find((m) => m.id === 1)?.estado };
      });
      assert.deepEqual(ticket.orden, { total: 52000, items: ['1× Churrasco 250 g'] }, `${ancho}: la orden cobrada`);
      assert.equal(ticket.mesa1, 'libre', `${ancho}: la mesa 1 vuelve a quedar libre`);
      const llamadas = JSON.stringify(await llamadasSupabase(page));
      assert.match(llamadas, /ordenes/, `${ancho}: el cobro llegó a Supabase (simulado)`);

      assert.deepEqual(diag.bloqueadas, [], `${ancho}: el POS intentó salir a ${diag.bloqueadas.join(', ')}`);
      assert.deepEqual(diag.errores, [], `${ancho}: errores del POS con la red externa cortada`);
      for (const h of HOSTS_CDN_PROHIBIDOS) {
        assert.ok(![...diag.bloqueadas, ...diag.fuentesBloqueadas].some((u) => new URL(u).host === h), `${ancho}: el POS pidió ${h}`);
      }
      await contexto.close();
    }
  });
});
