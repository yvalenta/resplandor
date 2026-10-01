// Ola C, ronda 5 (la tercera refutación y el rehacer del cierre del día): los documentos dicen lo que la base y el POS hacen de verdad, y no prometen lo que se fue.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');

test('ola C r5 · el README y el SDD describen el cierre que decide la base, el cierre sin red que ya no existe, el registro de ventas archivadas y los deltas idempotentes', () => {
  for (const [nombre, texto] of [['README', leer('README.md')], ['SDD', leer('docs/sdd-cuenta-en-mesa.md')]]) {
    assert.match(texto, /cerrar_dia\(p_id, p_esperado\)/, `${nombre}: la firma nueva`);
    assert.doesNotMatch(texto, /cerrar_dia\(p_id, p_fecha, p_total, p_transacciones, p_versiones\)/, `${nombre}: la firma de la ronda 4 ya no existe`);
    for (const c of ['hay_abiertas', 'sin_ventas', 'cambio', 'invalido', 'no_autorizado']) assert.match(texto, new RegExp(c), `${nombre}: ${c}`);
    assert.match(texto, /Nunca borra una cuenta abierta/, `${nombre}: la regla que no se negocia`);
    assert.match(texto, /cierre_ordenes/, `${nombre}: el registro de ventas archivadas`);
    assert.match(texto, /RS004/, `${nombre}: el rechazo de una venta en dos cierres`);
    assert.match(texto, /p_delta_id/, `${nombre}: el id de cada delta`);
    assert.match(texto, /deltas_aplicados/, `${nombre}: la tabla de deltas aplicados`);
    assert.match(texto, /deltas_ids/, `${nombre}: los ids que viajan en la fila cerrada`);
    assert.match(texto, /trg_ordenes_guardia_borrar/, `${nombre}: el guardia de DELETE`);
    assert.match(texto, /Sin conexión/, `${nombre}: el botón dice «Sin conexión»`);
    assert.match(texto, /Hay N cambios sin subir/, `${nombre}: y «Hay N cambios sin subir»`);
    assert.match(texto, /Reintentar subir/, `${nombre}: con «Reintentar subir»`);
    assert.match(texto, /_sondearBase/, `${nombre}: el sondeo de columnas (hallazgo G)`);
  }
  const sdd = leer('docs/sdd-cuenta-en-mesa.md');
  assert.match(sdd, /\*\*0\.7\*\*/, 'el SDD sube de versión (v0.7)');
  for (const r of ['R-24', 'R-25', 'R-26']) assert.match(sdd, new RegExp(r), `el SDD trae la prueba en una mesa real ${r}`);
  assert.match(sdd, /_recuperarCierresViejos/, 'el SDD explica qué pasa con un cierre «Sin respaldo» viejo');
  assert.match(sdd, /ya no se reaplica/, 'y que el límite de los deltas que se reaplicaban se fue');
  assert.doesNotMatch(sdd, /no es idempotente\): la cuenta lo muestra de más/, 'el SDD ya no admite el límite de la ronda 4');
});

test('ola C r5 · la migración dice en su cabecera lo que hace ahora (puntos 6 a 8) y su reversa devuelve aplicar_delta_orden a la de siete parámetros', () => {
  const sql = leer('supabase/migrations/20261002180000_deshacer_cobro.sql');
  assert.match(sql, /6\. EL CIERRE DEL DÍA LO DECIDE LA BASE/);
  assert.match(sql, /7\. UNA VENTA NUNCA ENTRA EN DOS CIERRES/);
  assert.match(sql, /8\. DELTAS IDEMPOTENTES/);
  assert.match(sql, /EL CIERRE DEL DÍA LO DECIDE LA BASE; DELTAS IDEMPOTENTES \(4 de 4 de la ola C\)/);
  assert.doesNotMatch(sql, /p_transacciones|p_versiones|v_restaurar/, 'nada de la foto de la tablet');
});

test('ola C r5 · la bitácora de la tarea lleva la ronda 5 y el POS ya no habla de «Sin respaldo» para cierres nuevos', () => {
  const t = leer('tareas/2026-10-01-ola-c.md');
  assert.match(t, /ronda 5/i);
  assert.match(t, /cierre/);
  const pos = leer('pos.html');
  assert.doesNotMatch(pos.replace(/\/\/.*$/gm, ''), /sinSubir|_cierreRechazado|_cerrarDiaEnBase/, 'ni rastro de la máquina que se fue');
});
