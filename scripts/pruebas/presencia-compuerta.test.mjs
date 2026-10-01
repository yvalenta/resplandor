// La presencia privada del POS (realtime.messages, canal `presencia_pos`) es del PERSONAL, no de cualquier cuenta de Google.
// Hallazgo de la integración de la ola B (corrida en Docker con la cadena completa de migraciones): la compuerta
// (`solo_personal`) cubría las tablas del POS pero no realtime.messages, así que una cuenta de Google fuera de `personal`
// podía unirse a `presencia_pos` y leer los nombres del personal. Esta prueba fija, sin base, que las dos migraciones
// que tocan esas policies exigen `mi_rol() is not null`. La comprobación real contra Postgres 17 (una cuenta ajena ve 0 filas,
// el personal ve la presencia) la hizo el arnés de Docker de la integración, que no vive en el repo ni corre aquí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (n) => fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', n), 'utf8');
const sinComentarios = (s) => s.replace(/^\s*--.*$/gm, '');
const PRES = leer('20261001130000_presencia_privada.sql');
const PERM = leer('20261002140000_permisos_por_rol.sql');
const POLITICAS = ['presencia_pos: el personal escucha', 'presencia_pos: el personal publica'];

test('presencia_privada: la condición «y está en personal» solo se agrega si la compuerta ya existe (mi_rol), en las dos policies', () => {
  const c = sinComentarios(PRES);
  assert.match(c, /to_regprocedure\('public\.mi_rol\(\)'\) is not null/, 'decide por la existencia de mi_rol()');
  assert.equal((c.match(/\(select public\.mi_rol\(\)\) is not null/g) || []).length, 1, 'la condición viene de UNA variable, no pegada a mano');
  assert.equal((c.match(/%s\s*\n\s*\)\$p\$, v_personal\)/g) || []).length, 2, 'las dos policies la reciben (escucha y publica)');
  for (const p of POLITICAS) assert.ok(c.includes(`"${p}"`), `crea «${p}»`);
  // lo que no cambia: solo Google, solo presencia, solo el tópico de la presencia, y sin anon
  assert.match(c, /realtime\.messages\.extension = 'presence'/);
  assert.match(c, /\(select realtime\.topic\(\)\) = 'presencia_pos'/);
  assert.match(c, /\(select auth\.jwt\(\) -> 'app_metadata' ->> 'provider'\) = 'google'/);
  assert.doesNotMatch(c, /to anon/);
});

test('permisos_por_rol: si la presencia ya se aplicó antes de la compuerta, la vuelve a crear con «y está en personal»', () => {
  const c = sinComentarios(PERM);
  const i = c.indexOf("from pg_policies where schemaname = 'realtime'");
  assert.ok(i !== -1, 'la sección de la presencia existe');
  const bloque = c.slice(i - 200);
  for (const p of POLITICAS) {
    assert.ok(bloque.includes(`policyname = '${p}'`), `solo toca «${p}» si existe`);
    assert.ok(bloque.includes(`drop policy "${p}" on realtime.messages`));
    assert.ok(bloque.includes(`create policy "${p}"`));
  }
  assert.equal((bloque.match(/and \(select public\.mi_rol\(\)\) is not null/g) || []).length, 2, 'las dos con la condición del personal');
  assert.match(bloque, /if exists \(select 1 from pg_policies/, 'sin la presencia aplicada no hace nada');
  // y no crea la presencia donde no estaba: todo `create policy` de realtime va dentro de un `if exists`
  assert.equal((bloque.match(/create policy "presencia_pos/g) || []).length, 2);
  assert.equal((bloque.match(/if exists/g) || []).length, 2);
});

test('la presencia nunca queda MÁS abierta que la compuerta: ninguna de las dos migraciones la deja solo con el criterio de Google si mi_rol() existe', () => {
  // La de presencia, aplicada después de la compuerta, ya sale estricta; la de permisos arregla la que salió antes.
  assert.match(PRES, /Aplicada ANTES de la compuerta queda con el criterio de `solo_google`/);
  assert.match(PERM, /sección 4\) alinea con la compuerta la presencia privada/);
});
