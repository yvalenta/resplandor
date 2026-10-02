#!/usr/bin/env node
// Resplandor — genera las variantes optimizadas de los afiches de «Promociones de la semana»
// (la sección #promociones de index.html) y deja sus bytes reales en
// assets/img/promos/promos.json.
//
// Los originales NO viven en el repo. Hay dos orígenes, y cada afiche de promos.json dice de cuál sale
// en `origen` (la primera parte de la ruta es la carpeta):
//   - `marketing/…`: los afiches oficiales de Camila, 1080×1350 («feed»), en ~/Developer/resplandor/marketing/
//     (los de 1080×1920, «estado», son para historias y acá no se usan);
//   - `afiches-vigentes/…`: los que Yonatan mandó después (2026-10-01: el viernes y el sábado nuevos, de color),
//     guardados en ~/Developer/worktrees/resplandor--coordinacion/carta-promos/afiches-vigentes/.
// Se pasan las dos carpetas como argumentos (la segunda solo hace falta si algún afiche sale de ella):
//
//     node scripts/promos-imagenes.mjs ~/Developer/resplandor/marketing \
//          ~/Developer/worktrees/resplandor--coordinacion/carta-promos/afiches-vigentes
//
// Un afiche que no mide 1080×1350 (los vigentes son 3:4) lleva en promos.json un `recorte` {ancho, alto, x, y}
// en píxeles del original, con proporción 4:5 exacta: se recorta ANTES de achicar, solo márgenes sin texto,
// para que todas las diapositivas de la tira midan lo mismo (1080×1350 en el marcado).
//
// promos.json es la única verdad de lo EDITORIAL (id, día, nombre, afiche de origen y el `alt`
// fiel a lo que dice cada afiche); este script solo rellena `variantes` con lo que genera:
//   - webp a 480, 720 y 960 px de ancho (q75 / q75 / q72; la de 960 se reintenta con menos
//     calidad si pasa de 150 KB, como la receta de scripts/recursos-imagen.sh), para el
//     <source type="image/webp"> del <picture>;
//   - jpg progresivo a 480 y 720 px (q70) de respaldo, para el <img> del <picture>.
// Nunca se agranda (el original, ya recortado, mide 1080 o más de ancho). Remuestreo Lanczos, sRGB, sin metadatos.
// Necesita ImageMagick (`magick`) y `cwebp` (brew install imagemagick webp).
//
// La landing referencia SOLO rutas de promos.json; scripts/pruebas/imagenes.test.mjs y
// scripts/pruebas/promos.test.mjs comprueban que el marcado, el manifiesto y los archivos
// coincidan (alt idéntico, bytes reales).
'use strict';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'assets/img/promos');
const MANIFIESTO = join(DESTINO, 'promos.json');

const ANCHO_NATIVO = 1080;
const ALTO_NATIVO = 1350;
const WEBP = [
  { ancho: 480, calidades: [75] },
  { ancho: 720, calidades: [75] },
  { ancho: 960, calidades: [72, 66, 60], tope: 150 * 1024 },
];
const JPG = [
  { ancho: 480, calidad: 70 },
  { ancho: 720, calidad: 70 },
];

const [carpetaMarketing, carpetaVigentes] = process.argv.slice(2);
if (!carpetaMarketing) {
  console.error('Uso: node scripts/promos-imagenes.mjs <carpeta marketing, p. ej. ~/Developer/resplandor/marketing> [<carpeta afiches-vigentes>]');
  process.exit(1);
}
const carpeta = (c) => resolve(c.replace(/^~(?=\/|$)/, process.env.HOME || '~'));
const CARPETAS = { marketing: carpeta(carpetaMarketing), ...(carpetaVigentes ? { 'afiches-vigentes': carpeta(carpetaVigentes) } : {}) };
const rutaDelOriginal = (origen) => {
  const [carpetaDelOrigen, ...resto] = origen.split('/');
  if (!CARPETAS[carpetaDelOrigen]) throw new Error(`«${origen}»: falta pasar la carpeta «${carpetaDelOrigen}» como argumento`);
  return join(CARPETAS[carpetaDelOrigen], ...resto);
};

const alto = (ancho) => Math.round((ancho * ALTO_NATIVO) / ANCHO_NATIVO);
const tmp = mkdtempSync(join(tmpdir(), 'resplandor-promos-'));

try {
  const promos = JSON.parse(readFileSync(MANIFIESTO, 'utf8'));
  for (const promo of promos) {
    const original = rutaDelOriginal(promo.origen);
    statSync(original); // si no existe, falla con el nombre del archivo
    const r = promo.recorte;
    if (r && Math.abs(r.ancho * ALTO_NATIVO - r.alto * ANCHO_NATIVO) > r.ancho) {
      throw new Error(`${promo.id}: el recorte ${r.ancho}×${r.alto} no es 4:5`);
    }
    const recorte = r ? ['-crop', `${r.ancho}x${r.alto}+${r.x}+${r.y}`, '+repage'] : [];
    const variantes = [];

    for (const { ancho, calidades, tope } of WEBP) {
      const png = join(tmp, `${promo.id}-${ancho}.png`);
      execFileSync('magick', [original, ...recorte, '-colorspace', 'sRGB', '-filter', 'Lanczos', '-resize', `${ancho}x${alto(ancho)}!`, '-strip', png]);
      const salida = join(DESTINO, `${promo.id}-${ancho}.webp`);
      for (const q of calidades) {
        execFileSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-metadata', 'none', png, '-o', salida]);
        if (!tope || statSync(salida).size <= tope) break;
      }
      variantes.push({ ruta: `assets/img/promos/${promo.id}-${ancho}.webp`, formato: 'webp', ancho, alto: alto(ancho), bytes: statSync(salida).size });
    }

    for (const { ancho, calidad } of JPG) {
      const salida = join(DESTINO, `${promo.id}-${ancho}.jpg`);
      execFileSync('magick', [
        original, ...recorte, '-colorspace', 'sRGB', '-filter', 'Lanczos', '-resize', `${ancho}x${alto(ancho)}!`, '-strip',
        '-sampling-factor', '4:2:0', '-interlace', 'Plane', '-quality', String(calidad), salida,
      ]);
      variantes.push({ ruta: `assets/img/promos/${promo.id}-${ancho}.jpg`, formato: 'jpg', ancho, alto: alto(ancho), bytes: statSync(salida).size });
    }

    promo.variantes = variantes;
    console.log(`${promo.id}: ${variantes.map((v) => `${v.ancho}.${v.formato} ${(v.bytes / 1024).toFixed(0)} KB`).join(' · ')}`);
  }

  writeFileSync(MANIFIESTO, JSON.stringify(promos, null, 2) + '\n');
  const total = promos.flatMap((p) => p.variantes).reduce((s, v) => s + v.bytes, 0);
  console.log(`assets/img/promos/promos.json actualizado. Total: ${(total / 1024).toFixed(0)} KB (${(total / 1048576).toFixed(2)} MB).`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
