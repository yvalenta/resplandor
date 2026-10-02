// Ola C, ronda 5a («simplificar»): los documentos dicen lo que la base y el POS hacen de verdad ahora, y no prometen lo que se fue.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');

test('ola C r5a · el README y el SDD describen RS005, reabrir_venta_de_cierre y la hoja de cierres viejos; ya no hay recuperación automática ni descarte silencioso de un cobro', () => {
  for (const [nombre, texto] of [['README', leer('README.md')], ['SDD', leer('docs/sdd-cuenta-en-mesa.md')]]) {
    assert.match(texto, /RS005/, `${nombre}: el rechazo de una venta archivada`);
    assert.match(texto, /reabrir_venta_de_cierre/, `${nombre}: la reapertura atómica`);
    assert.match(texto, /pos_cierres_viejos|cierresViejos/, `${nombre}: los cierres viejos quedan aparte`);
    assert.match(texto, /Subir las que faltan/, `${nombre}: la acción explícita`);
    assert.match(texto, /Descartar este cierre local/, `${nombre}: la otra acción explícita`);
    assert.match(texto, /en_cierre/, `${nombre}: cerrar_dia dice cuáles mesas abiertas están en un cierre`);
    assert.doesNotMatch(texto, /se resuelve al arrancar: sus ventas que la base no tiene se suben como cobros normales/, `${nombre}: ya no promete la recuperación automática`);
    assert.doesNotMatch(texto, /una venta cerrada ya archivada que se vuelve a subir se descarta en silencio/, `${nombre}: ya no dice que el cobro se descarta en silencio`);
  }
  const sdd = leer('docs/sdd-cuenta-en-mesa.md');
  assert.match(sdd, /\*\*0\.8\*\*/, 'el SDD sube de versión (v0.8)');
  assert.match(sdd, /_reabrirDesdeCierre/, 'y explica cómo reabre el POS');
  assert.match(sdd, /_cuentaArchivada/, 'y qué hace con un RS005');
});

test('ola C r5a · la migración dice en su cabecera lo que hace ahora (RS005 y el punto 9) y su reversa borra la función nueva', () => {
  const sql = leer('supabase/migrations/20261002180000_deshacer_cobro.sql');
  assert.match(sql, /UNA VENTA ARCHIVADA NO VUELVE, Y NO SE DESCARTA EN SILENCIO/);
  assert.match(sql, /9\. REABRIR UNA VENTA DE UN CIERRE PASADO, ATÓMICO/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /orden_archivada\(new\.id\) then\s+return null/, 'sin el return null que se comía el cobro');
  assert.match(sql, /--   drop function if exists public\.reabrir_venta_de_cierre\(text, text, integer\);/);
});

test('ola C r5a · la bitácora de la tarea lleva la ronda 5a', () => {
  const t = leer('tareas/2026-10-01-ola-c.md');
  assert.match(t, /ronda 5a/);
  assert.match(t, /RS005/);
  assert.match(t, /reabrir_venta_de_cierre/);
});
