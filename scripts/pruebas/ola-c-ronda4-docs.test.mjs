// Ola C, ronda 4 (la segunda refutación): los documentos dicen lo que la base y el POS hacen de verdad con el cierre del día atómico, los cobros hechos sin
// red y «Cobros deshechos hoy».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');

test('ola C r4 · el README y el SDD describen cerrar_dia: atómico, solo admin, nunca borra una cuenta abierta, con sus códigos', () => {
  const readme = leer('README.md'); const sdd = leer('docs/sdd-cuenta-en-mesa.md');
  for (const [nombre, texto] of [['README', readme], ['SDD', sdd]]) {
    assert.match(texto, /cerrar_dia/, `${nombre}: la RPC`);
    assert.match(texto, /Nunca borra una cuenta abierta/, `${nombre}: la regla que no se negocia`);
    for (const c of ['hay_abiertas', 'cambio', 'no_autorizado']) assert.match(texto, new RegExp(c), `${nombre}: ${c}`);
    assert.match(texto, /cierre_id/, `${nombre}: los deshechos cuelgan del cierre`);
    assert.match(texto, /ya_reabierta/, `${nombre}: el doble toque de un cobro completo`);
  }
  assert.match(sdd, /\*\*0\.6\*\*/, 'el SDD sigue teniendo la v0.6 (y la ronda 5 trae la 0.7)');
  assert.match(sdd, /R-23/, 'y trae la prueba en una mesa real del cierre con una foto vieja');
  assert.match(sdd, /cobradaSinRed|NO quedó registrado/, 'el SDD explica que un cobro sin red rechazado no queda registrado');
  assert.match(sdd, /_baseConGuardia/, 'y que el POS solo manda version si la base tiene el guardia');
  assert.match(leer('docs/pos-visual.md'), /cierre_id/, 'pos-visual: «hoy» ya no es la hora de la tablet');
});

test('ola C r4 · la migración de deshacer lo explica en su cabecera (punto 6) y el POS no usa la hora de la tablet para «hoy»', () => {
  const sql = leer('supabase/migrations/20261002180000_deshacer_cobro.sql');
  assert.match(sql, /6\. EL CIERRE DEL DÍA LO DECIDE LA BASE/);   // (la ronda 5 lo rehízo: antes decía «ATÓMICO»)
  assert.match(sql, /NUNCA borra una cuenta abierta/);
  const pos = leer('pos.html');
  assert.doesNotMatch(pos, /_inicioDelTurno/, '«hoy» de los deshechos ya no depende del reloj de la tablet');
});

test('ola C r4 · la bitácora de la tarea lleva la ronda 4', () => {
  const t = leer('tareas/2026-10-01-ola-c.md');
  assert.match(t, /ronda 4/i);
  assert.match(t, /cerrar_dia/);
});
