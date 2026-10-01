#!/usr/bin/env node
// Capturas de cada vista y modal del POS (pos.html) con Supabase simulado y datos ficticios,
// sin login real y sin tocar la base: el arnés vive en scripts/pruebas/_pos-simulado.mjs (ahí
// está el detalle de cómo se simula todo y cómo se llega a cada vista).
//
// Uso (Node ≥ 20; Playwright con Chromium se busca como en las pruebas, ver _navegador.mjs; no
// se instala nada):
//   PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH node scripts/capturas-pos.mjs <directorio-de-salida> [opciones]
//
//   <directorio-de-salida>   donde caen los PNG: <vista>-<ancho>.png (se crea; los PNG viejos de la
//                            misma vista y ancho se pisan). No va al repo: úsalo fuera de él.
//   --lista                  solo muestra las vistas disponibles y sale
//   --vistas a,b,c           solo esas vistas (por defecto, todas)
//   --anchos 360,390         anchos de pantalla (por defecto 360, 390, 768 y 1440, con su alto:
//                            360×780, 390×844, 768×1024 y 1440×900; ver ALTOS). Docs/pos-visual.md §0:
//                            el teléfono vertical (360 a 430) es el primario, tablet y escritorio van después.
//                            Por debajo de 768 px la ventana EMULA UN TELÉFONO (isMobile, hasTouch y
//                            deviceScaleFactor 2): el viewport del <meta> se respeta y el puntero es táctil.
//                            Las vistas de impresión (ticket-impreso a 302, cierre-impreso a 794) NO se
//                            emulan como teléfono: salen a escala 1, igual que siempre, para compararlas.
//   --ventana                captura solo la ventana (lo que se ve sin hacer scroll) en TODAS las vistas,
//                            no la página entera: así se ven las barras fijas donde las ve el mesero. En la
//                            página entera, una barra fija abajo cae al final de la imagen.
//   --raiz <dir>             carpeta del sitio que se sirve (por defecto, el repo donde vive este script)
//   --cache <dir>            donde se guardan Tailwind, Alpine, Lucide y las fuentes la primera vez
//                            (por defecto, <tmp>/resplandor-pos-cdn); usa la misma para «antes» y «después»
//   --puerto <n>             puerto del servidor local (por defecto 4173; si está ocupado, uno libre)
//   --escala <n>             deviceScaleFactor (por defecto 2 en teléfono y 1 en el resto)
//
// Antes y después de un cambio visual:
//   node scripts/capturas-pos.mjs $CAPTURAS/antes   --cache $CAPTURAS/_cdn
//   …cambios en pos.html…
//   node scripts/capturas-pos.mjs $CAPTURAS/despues --cache $CAPTURAS/_cdn
//   node scripts/capturas-pos.mjs $CAPTURAS/despues/ventana --cache $CAPTURAS/_cdn --anchos 360,390 --ventana
//
// Qué se captura: las vistas con la página entera (o solo la ventana con --ventana) y los modales
// solo con la ventana (el fondo es fixed). Cada vista usa una página nueva (sin localStorage de la anterior). Termina con
// código 1 si el POS dejó algún error de consola propio (pageerror, console.error del origen
// local, avisos de Alpine) o si algo intentó salir a un host no permitido; los errores de
// terceros (un CDN que no respondió) solo se informan.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarPlaywright } from './pruebas/_navegador.mjs';
import { VISTAS, abrirPos, nuevoContexto, servirPos, PUERTO_FIJO } from './pruebas/_pos-simulado.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Alto de ventana por ancho (docs/pos-visual.md §0.1): 360×780 y 390×844 son las referencias del teléfono.
const ALTOS = { 320: 640, 360: 780, 375: 812, 390: 844, 412: 915, 430: 932, 768: 1024, 1024: 768, 1440: 900 };
const altoPara = (ancho) => ALTOS[ancho] || (ancho < 500 ? 800 : 900);
// §0.1: de 360 a 767 px es teléfono. Lo impreso (media print) nunca se emula como teléfono.
const TELEFONO_MAX = 767;
const esTelefono = (ancho, def) => ancho <= TELEFONO_MAX && def.media !== 'print';

function leerArgumentos(argv) {
  const a = { salida: null, vistas: Object.keys(VISTAS), anchos: [360, 390, 768, 1440], raiz: RAIZ, cache: path.join(os.tmpdir(), 'resplandor-pos-cdn'), puerto: PUERTO_FIJO, escala: null, lista: false, ventana: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const valor = () => { if (i + 1 >= argv.length) throw new Error(`${x} necesita un valor`); return argv[++i]; };
    if (x === '--lista') a.lista = true;
    else if (x === '--ventana') a.ventana = true;
    else if (x === '--vistas') a.vistas = valor().split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--anchos') a.anchos = valor().split(',').map(Number).filter(Boolean);
    else if (x === '--raiz') a.raiz = path.resolve(valor());
    else if (x === '--cache') a.cache = path.resolve(valor());
    else if (x === '--puerto') a.puerto = Number(valor());
    else if (x === '--escala') a.escala = Number(valor());
    else if (x.startsWith('--')) throw new Error(`opción desconocida ${x}`);
    else if (!a.salida) a.salida = path.resolve(x);
    else throw new Error(`sobra el argumento ${x}`);
  }
  return a;
}

function uso(codigo) {
  console.error('uso: node scripts/capturas-pos.mjs <directorio-de-salida> [--lista] [--vistas a,b] [--anchos 360,390,768,1440] [--ventana] [--raiz dir] [--cache dir] [--puerto n] [--escala n]');
  process.exit(codigo);
}

let args;
try { args = leerArgumentos(process.argv.slice(2)); } catch (e) { console.error(e.message); uso(2); }

if (args.lista) {
  const ancho = Math.max(...Object.keys(VISTAS).map((v) => v.length));
  for (const [id, v] of Object.entries(VISTAS)) console.log(`${id.padEnd(ancho)}  ${v.descripcion}${v.anchos ? `  [ancho ${v.anchos.join(',')}]` : ''}`);
  process.exit(0);
}
if (!args.salida) uso(2);
const desconocidas = args.vistas.filter((v) => !VISTAS[v]);
if (desconocidas.length) { console.error(`vistas desconocidas: ${desconocidas.join(', ')} (mira --lista)`); process.exit(2); }
if (!fs.existsSync(path.join(args.raiz, 'pos.html'))) { console.error(`no hay pos.html en ${args.raiz}`); process.exit(2); }

const pw = buscarPlaywright();
if (!pw.chromium) { console.error(`sin navegador: ${pw.motivo}`); process.exit(2); }

fs.mkdirSync(args.salida, { recursive: true });
fs.mkdirSync(args.cache, { recursive: true });
const servidor = await servirPos(args.raiz, args.puerto);
const navegador = await pw.chromium.launch();
const resumen = { raiz: args.raiz, salida: args.salida, servidor: servidor.url, capturas: [], fallos: [], errores: [], externos: [], bloqueadas: [], dialogos: [] };

try {
  for (const id of args.vistas) {
    const def = VISTAS[id];
    for (const ancho of def.anchos || args.anchos) {
      const archivo = path.join(args.salida, `${id}-${ancho}.png`);
      const movil = esTelefono(ancho, def);
      const contexto = await nuevoContexto(navegador, { ancho, alto: altoPara(ancho), escala: args.escala ?? undefined, movil });
      try {
        const page = await contexto.newPage();
        const { diag } = await abrirPos(page, { url: servidor.url, vista: id, dirCache: args.cache });
        const toma = { path: archivo, animations: 'disabled', caret: 'hide' };
        if (def.selector) await page.locator(def.selector).screenshot(toma);
        else await page.screenshot({ ...toma, fullPage: !(def.ventana || args.ventana) });
        const aviso = [diag.errores.length && `${diag.errores.length} error(es)`, diag.bloqueadas.length && `${diag.bloqueadas.length} bloqueada(s)`].filter(Boolean).join(', ');
        console.log(`${aviso ? '✗' : '✓'} ${archivo}${aviso ? `  ← ${aviso}` : ''}`);
        resumen.capturas.push(archivo);
        for (const [dest, lista] of [['errores', diag.errores], ['externos', diag.externos], ['bloqueadas', diag.bloqueadas], ['dialogos', diag.dialogos]]) {
          lista.forEach((m) => resumen[dest].push(`${id}-${ancho}: ${m}`));
        }
      } catch (e) {
        console.log(`✗ ${id}-${ancho}  ← no se pudo capturar: ${e.message.split('\n')[0]}`);
        resumen.fallos.push(`${id}-${ancho}: ${e.message.split('\n')[0]}`);
      } finally {
        await contexto.close();
      }
    }
  }
} finally {
  await navegador.close();
  await servidor.cerrar();
}

fs.writeFileSync(path.join(args.salida, '_resumen.json'), JSON.stringify(resumen, null, 2) + '\n');
console.log(`\n${resumen.capturas.length} capturas en ${args.salida}`);
console.log(`${resumen.fallos.length} captura(s) fallida(s)\nconsola del POS: ${resumen.errores.length} error(es) propios · ${resumen.externos.length} de terceros · ${resumen.bloqueadas.length} pedido(s) bloqueado(s) · ${resumen.dialogos.length} diálogo(s) descartado(s)`);
for (const [titulo, lista] of [['capturas fallidas', resumen.fallos], ['errores propios', resumen.errores], ['de terceros', resumen.externos], ['bloqueadas', resumen.bloqueadas], ['diálogos', resumen.dialogos]]) {
  if (lista.length) console.log(`  ${titulo}:\n${[...new Set(lista)].slice(0, 20).map((m) => `    - ${m}`).join('\n')}`);
}
process.exit(resumen.errores.length || resumen.bloqueadas.length || resumen.fallos.length ? 1 : 0);
