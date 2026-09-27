// Prueba del CSS de Tailwind compilado (scripts/css.mjs): assets/css/resplandor.css no puede
// divergir de assets/css/entrada-tailwind.css / base.css / componentes.css / landing.css /
// carta-menu.css ni de las clases que landing.html/carta.html/menu.html/assets/js realmente
// usan (la comprobación las escanea de nuevo con el CLI y compara byte a byte).
//
// Necesita node_modules/.bin/tailwindcss (`npm install`). En un clon nuevo o un worktree
// recién creado sin ese paso, esta prueba se salta con un aviso en vez de tumbar toda la
// suite: `node --test` solo necesita Node para el resto de pruebas, y CI
// (.github/workflows/comprobar.yml) siempre corre `npm ci` antes, así que ahí sí se corre.
// Patrón igual al de lusof (~/Developer/lusof/scripts/pruebas/css.test.mjs).
'use strict';

import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ruta = (...p) => join(RAIZ, ...p);
const CLI = ruta('node_modules/.bin/tailwindcss');

test(
  'node scripts/css.mjs --comprobar sale 0 (assets/css/resplandor.css está al día)',
  { skip: !existsSync(CLI) && 'falta node_modules/.bin/tailwindcss — corré `npm install` primero' },
  () => {
    execFileSync(process.execPath, [ruta('scripts/css.mjs'), '--comprobar'], { cwd: RAIZ });
  },
);
