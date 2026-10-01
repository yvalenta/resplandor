// Ola C, ronda 3: la decisión de Yonatan (2026-10-01) «el pedido se podrá deshacer cuando quiera el mesero o el admin» no deja rastro de la ventana de 10 minutos en
// ningún texto del repo (SQL, POS, pruebas, README, SDD, privacy, tareas), y los documentos dicen lo que la base y el POS hacen de verdad.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const SQL = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => `supabase/migrations/${f}`);
const PRUEBAS = fs.readdirSync(path.join(RAIZ, 'scripts', 'pruebas')).filter((f) => f.endsWith('.mjs') && f !== path.basename(fileURLToPath(import.meta.url))).map((f) => `scripts/pruebas/${f}`);
const TEXTOS = ['pos.html', 'README.md', 'docs/sdd-cuenta-en-mesa.md', 'docs/pos-visual.md', 'docs/pegatinas.md', 'privacy.html', 'auth.md', 'tareas/2026-10-01-ola-c.md', 'scripts/descubrimiento.mjs', ...SQL, ...PRUEBAS];

// Lo que NO es la ventana: el silencio de las alertas (10 min) y el bloqueo por IP de la función `cuenta` (10 min) siguen existiendo.
const AJENAS = /silenci|limitador|bloque|bloquea|barrido|IP, mesa|la tiene abierta unos|retry-after|fn-cuenta|cuenta-en-vivo|Retry/i;

test('ola C r3 · ningún texto habla de una ventana de 10 minutos para deshacer un cobro (ni de ventana_vencida)', () => {
  const culpables = [];
  for (const archivo of TEXTOS) {
    const lineas = leer(archivo).split('\n');
    lineas.forEach((l, i) => {
      if (/doesNotMatch|assert\.ok\(!|\bya no\b|[Ss]in ventana|ni rastro|\/ventana_vencida/.test(l)) return;   // las pruebas que EXIGEN su ausencia la nombran
      if (/ventana_vencida|VENTANA_MESERO|cerrada_servidor_en/.test(l)) culpables.push(`${archivo}:${i + 1}: ${l.trim().slice(0, 100)}`);
      if (/10 min(utos)?\b/i.test(l) && /deshac|devolv|devuelv|ventana|mesero/i.test(l) && !AJENAS.test(l)) culpables.push(`${archivo}:${i + 1}: ${l.trim().slice(0, 100)}`);
      if (/\bdiez minutos\b/i.test(l) && /deshac|devolv|ventana/i.test(l)) culpables.push(`${archivo}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(culpables, [], 'quedan restos de la ventana de tiempo:\n' + culpables.join('\n'));
});

test('ola C r3 · el README, el SDD y la guía dicen lo que hace la base: sin ventana, tres clases de cobro, deshechos, RS003, token en la pegatina', () => {
  const readme = leer('README.md'); const sdd = leer('docs/sdd-cuenta-en-mesa.md'); const guia = leer('docs/pegatinas.md');
  for (const [nombre, texto] of [['README', readme], ['SDD', sdd]]) {
    assert.match(texto, /cuando quiera el mesero o el admin/, `${nombre}: la decisión de Yonatan, con sus palabras`);
    assert.match(texto, /deshechos/, `${nombre}: la tabla de trazabilidad`);
    assert.match(texto, /Cobros deshechos hoy/, `${nombre}: lo que ve el admin en el cierre`);
    assert.match(texto, /RS003/, `${nombre}: cerrar con la version que se vio`);
    assert.match(texto, /enlace_cambio/, `${nombre}: la pegatina con el token`);
    assert.match(texto, /ya_en_cierre/, `${nombre}: un cobro archivado no se deshace`);
    assert.match(texto, /mesa_inactiva/, `${nombre}: la mesa desactivada`);
  }
  assert.match(readme, /90 días/);
  assert.match(sdd, /### 12\.4 Deshacer un cobro/);
  assert.match(sdd, /\*\*0\.5\*\*/, 'el SDD sube de versión (v0.5)');
  assert.match(guia, /enlace_cambio|cambió mientras tanto/, 'la guía de pegatinas explica qué pasa si giran el enlace mientras se escribe');
  assert.match(guia, /Ya la escribí/, 'y el iPhone anota con «Ya la escribí» y «Ya la revisé»');
  assert.match(guia, /Reintentar/);
});

test('ola C r3 · privacy.html dice lo que se guarda al deshacer un cobro y por cuánto tiempo (coincide con la base: 90 días)', () => {
  const privacidad = leer('privacy.html').replace(/\s+/g, ' ');
  assert.match(privacidad, /deshace un cobro en el punto de venta/);
  assert.match(privacidad, /quién lo hizo \(su correo de Google\), cuándo, de qué mesa y por cuánto/);
  assert.match(privacidad, /solo un administrador y se borra pasados 90 días/);
  const base = leer('supabase/migrations/20261002180000_deshacer_cobro.sql');
  assert.match(base, /interval '90 days'/, 'la base borra a los 90 días');
});

test('ola C r3 · la bitácora de la tarea lleva la ronda 3 y ya no promete la ventana de 10 minutos', () => {
  const t = leer('tareas/2026-10-01-ola-c.md');
  assert.match(t, /ronda 3/i);
  assert.match(t, /cuando quiera el mesero o el admin/);
  assert.doesNotMatch(t, /dentro de 10 minutos|10 minutos siguientes/);
});
