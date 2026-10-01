#!/usr/bin/env node
// Junta una Edge Function con el código compartido que importa (`../_compartido/*.js`) en UN solo archivo.
//
// Para qué. Las funciones se despliegan desde el editor del dashboard de Supabase (así se desplegaron `votar` y
// `cuenta`, tareas/2026-09-29-supabase-propio.md), y ese editor trabaja con la carpeta de UNA función: no resuelve
// `import ... from "../_compartido/mesa.js"`. Con la CLI (`supabase functions deploy <función> --no-verify-jwt`) no
// hace falta, porque la CLI sí empaqueta los imports relativos.
//
// Uso:   node scripts/empaquetar-funcion.mjs cuenta | pbcopy        (y pegar TODO en el editor → Deploy)
//        node scripts/empaquetar-funcion.mjs cuenta salida.ts        (a un archivo en vez de la salida estándar)
//
// Qué hace, sin cambiar una línea de lógica:
//   · deja los imports de `npm:` / `jsr:` / `https:` arriba, una sola vez;
//   · pone el código de cada módulo local antes del de `index.ts`, quitándole `export` a sus declaraciones;
//   · quita `export` también de `type` e `interface` (TypeScript, p. ej. `alerta`);
//   · se niega (y dice por qué) si algo no lo cubre: un `export default`, un `export { … }`, un `import` por defecto o
//     `* as`, un nombre declarado en dos archivos, o una ruta fuera de `supabase/functions/`.
// Una función sin imports locales (como `votar`) sale idéntica, byte a byte.
// Solo lee el repo; no lo modifica. Lo prueba scripts/pruebas/empaquetar-funcion.test.mjs, que corre el archivo
// empaquetado y comprueba que responde igual que el original.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 12);

// import { a, b } from "./x.js";   (los imports por defecto y `* as` se rechazan más abajo)
const RE_IMPORT = /^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?[ \t]*\n/gm;
const RE_IMPORT_SIN_NOMBRES = /^import\s+["'][^"']+["'];?/m;
const esLocal = (esp) => esp.startsWith('./') || esp.startsWith('../');
const nombresDeclarados = (t) => [...t.matchAll(/^(?:async function\*?|function\*?|const|let|var|class|type|interface) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);

/**
 * Empaqueta `supabase/functions/<nombre>/index.ts`.
 * @param {string} nombre carpeta de la función (p. ej. «cuenta»)
 * @param {{raiz?: string}} [opciones] raíz del repo (las pruebas usan un árbol de mentira)
 * @returns {{texto: string, fuentes: {ruta: string, sha: string}[], empaquetada: boolean}}
 */
export function empaquetar(nombre, { raiz = RAIZ_REPO } = {}) {
  if (!/^[a-z][a-z0-9_-]*$/.test(nombre)) throw new Error(`nombre de función inválido: ${nombre}`);
  const funciones = path.join(raiz, 'supabase', 'functions');
  const entrada = path.join(funciones, nombre, 'index.ts');
  if (!fs.existsSync(entrada)) throw new Error(`no existe ${path.relative(raiz, entrada)}`);
  const rel = (p) => path.relative(raiz, p);

  const externos = new Set();      // líneas de import de npm:, jsr:, https: (se ponen arriba, una vez)
  const partes = [];               // { ruta, cuerpo } en orden: dependencias primero, index.ts al final
  const visto = new Set();

  function cargar(archivo, pila) {
    const real = path.resolve(archivo);
    if (pila.includes(real)) throw new Error(`import circular: ${[...pila, real].map(rel).join(' → ')}`);
    if (visto.has(real)) return;
    if (!real.startsWith(funciones + path.sep)) throw new Error(`${rel(real)} está fuera de supabase/functions/: el dashboard no lo recibiría`);
    if (!fs.existsSync(real)) throw new Error(`no existe ${rel(real)}`);
    const texto = fs.readFileSync(real, 'utf8');
    const esIndex = real === path.resolve(entrada);

    if (RE_IMPORT_SIN_NOMBRES.test(texto)) throw new Error(`${rel(real)}: un «import "x"» sin nombres no está cubierto`);
    let cuerpo = texto.replace(RE_IMPORT, (linea, que, especificador) => {
      if (esLocal(especificador)) {
        if (!/^\{[\s\S]*\}$/.test(que.trim())) throw new Error(`${rel(real)}: solo se cubren imports con llaves de módulos locales («${linea.trim()}»)`);
        cargar(path.resolve(path.dirname(real), especificador), [...pila, real]);
        return '';
      }
      externos.add(linea.trimEnd().replace(/;?$/, ';'));
      return '';
    });
    if (/^\s*import\s/m.test(cuerpo.replace(/\/\*[\s\S]*?\*\//g, ''))) {
      // un import que la expresión no entendió (varias líneas raras, `import(…)` dinámico fuera de strings, etc.)
      const sobra = cuerpo.split('\n').find((l) => /^\s*import\s/.test(l));
      if (sobra && !/^\s*\/\//.test(sobra)) throw new Error(`${rel(real)}: quedó un import sin tratar: ${sobra.trim()}`);
    }
    if (!esIndex) {
      if (/^export\s+(default|\{|\*)/m.test(cuerpo)) throw new Error(`${rel(real)}: «export default», «export { … }» y «export *» no están cubiertos`);
      // `type` e `interface` (TypeScript, p. ej. alerta/logica.ts) también: Deno los entiende y el encabezado trae @ts-nocheck.
      cuerpo = cuerpo.replace(/^export (async function\*?|function\*?|const|let|var|class|type|interface) /gm, '$1 ');
      if (/^export\b/m.test(cuerpo)) throw new Error(`${rel(real)}: quedó un export sin tratar`);
    }
    visto.add(real);
    partes.push({ ruta: rel(real), cuerpo, texto });
  }
  cargar(entrada, []);

  // Sin imports locales no hay nada que juntar: sale la función tal cual está.
  if (partes.length === 1) {
    return { texto: partes[0].texto, fuentes: [{ ruta: partes[0].ruta, sha: sha(partes[0].texto) }], empaquetada: false };
  }

  const dueños = new Map();
  for (const p of partes) {
    for (const n of nombresDeclarados(p.cuerpo)) {
      if (dueños.has(n)) throw new Error(`el nombre «${n}» está declarado en ${dueños.get(n)} y en ${p.ruta}: juntos chocarían`);
      dueños.set(n, p.ruta);
    }
  }

  const fuentes = partes.map((p) => ({ ruta: p.ruta, sha: sha(p.texto) }));
  const cabecera = [
    '// @ts-nocheck',
    '// ═══════════════════════════════════════════════════════════════════════════════════════════',
    `// Edge Function \`${nombre}\` — ARCHIVO ÚNICO PARA EL EDITOR DEL DASHBOARD DE SUPABASE`,
    `// (Edge Functions → ${nombre} → editar el código → pegar TODO esto → Deploy; «Verify JWT» sigue apagado).`,
    '//',
    '// GENERADO por scripts/empaquetar-funcion.mjs a partir de estos archivos, sin cambiar una línea de lógica:',
    ...fuentes.map((f) => `//   ${f.ruta}  sha256 ${f.sha}…`),
    '// No lo edites a mano: cambia el original y vuelve a generarlo. `// @ts-nocheck` evita que un chequeo de',
    '// tipos del editor proteste por los parámetros sin tipo del JavaScript plano de _compartido.',
    '// ═══════════════════════════════════════════════════════════════════════════════════════════',
    ...externos,
    '',
  ].join('\n');
  const cuerpoFinal = partes.map((p) => `// ───────────── ${p.ruta} ─────────────\n${p.cuerpo.replace(/^\n+/, '').trimEnd()}\n`).join('\n');
  return { texto: cabecera + '\n' + cuerpoFinal, fuentes, empaquetada: true };
}

// ── CLI ──
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [nombre, salida] = process.argv.slice(2);
  if (!nombre) {
    console.error('Uso: node scripts/empaquetar-funcion.mjs <función> [archivo-de-salida]');
    process.exit(2);
  }
  try {
    const { texto, fuentes, empaquetada } = empaquetar(nombre);
    if (salida) {
      fs.writeFileSync(salida, texto);
      console.error(`${salida}: ${texto.split('\n').length} líneas, ${empaquetada ? 'empaquetada desde ' + fuentes.length + ' archivos' : 'sin imports locales, igual que el original'}`);
    } else {
      process.stdout.write(texto);
    }
  } catch (e) {
    console.error('No se pudo empaquetar: ' + e.message);
    process.exit(1);
  }
}
