// La cola de impresión de la caja: supabase/migrations/20261003140000_cola_impresion.sql
// («imprimir en el PC del restaurante sin importar desde qué dispositivo esté conectado»: el POS encola un trabajo en la
// base, un agente en el PC de la caja lo toma con su TOKEN y lo imprime; sin Tailscale, sin puertos abiertos).
//
// Dos partes, como migracion-cuenta-en-vivo.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. Las firmas que comparten la base, el agente y el POS,
//      search_path vacío y SECURITY DEFINER donde toca, REVOKE de cada función y solo los GRANT previstos, ningún GRANT de tabla
//      a anon/service_role, permiso por columna en `impresoras` (nunca token_hash), cero policies en realtime.messages, los
//      triggers que no pueden romper la inserción, SKIP LOCKED, el vector del tópico (el mismo de la cuenta en vivo), que la
//      reversa nombre TODO lo que crea y que no haya correos reales (el repo es público).
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker, ver _supabase-simulado.mjs): la cadena COMPLETA de migraciones del
//      repo (base, carta, cuenta en vivo, presencia, compuerta, alertas, permisos por rol y esta) como `migrador`, que no es
//      superusuario, y las baterías SQL de scripts/pruebas/sql/cola-impresion/:
//         10 permisos      la matriz admin · mesero · ajena · pendiente · eliminado · cuenta por correo · anon, por tabla, por
//                          columna y por función; token_hash ilegible; EXECUTE de cada función desde el catálogo
//         15 forma y tope  el contenido (forma y 32768 bytes), el tipo, y el tope de 30 por minuto por persona (también con un
//                          INSERT de muchas filas y en la frontera de 59 / 61 s)
//         20 cola          tomar, confirmar, reintentos hasta el error definitivo, trabados, caducidad, p_max, cancelar,
//                          rotación y desactivación del token, token inválido sin pistas, latido
//         30 admin         crear, rotar, activar, estado «Caja en línea» (umbral de 90 s), latido
//         40 señal         a quién avisa y con qué tópico, que un realtime.send roto o ausente NO rompa la inserción, el
//                          mantenimiento (caducar, rendirse, purgar de a 500) y que tampoco rompa la inserción
//      más SESIONES SIMULTÁNEAS reales (con un portón para que salgan juntas): tres agentes tomando 75 trabajos sin repetir
//      ninguno, doble confirmación, cancelar contra tomar, el tope en el borde y dos INSERT de 20 a la vez. Y la migración
//      dos veces, la reversa comentada de la cabecera y volver a aplicarla (el catálogo queda idéntico).
//
// Lo que NO prueba (necesita el proyecto vivo, con el GO de Yonatan): que el servidor de Realtime reparta la señal al agente y
// que `postgres` pueda ejecutar el realtime.send real (las mismas pruebas S-1 a S-6 de la cuenta en vivo, con el tópico impresora:*).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buscarDocker, levantarPostgres, topicoCuenta } from './_supabase-simulado.mjs';
import {
  RAIZ, DIR_MIGRACIONES, DIR_SQL, MIGRACION, ESCENARIOS,
  prepararSimulacion, aplicarMigraciones, correrEscenario, concurrencia, radiografia, reversa,
  comprobarIdempotencia, comprobarReversa, comprobarPrecondiciones,
} from './_cola-impresion-pg.mjs';

const REL = `supabase/migrations/${MIGRACION}`;
const SQL = fs.readFileSync(path.join(RAIZ, REL), 'utf8');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CODIGO = sinComentarios(SQL);
const CUENTA = fs.readFileSync(path.join(DIR_MIGRACIONES, '20261001120000_cuenta_en_vivo.sql'), 'utf8');

/** El texto de `create or replace function <nombre>(…)` hasta el cierre de su cuerpo. */
const funcion = (nombre) => {
  const i = CODIGO.indexOf(`create or replace function ${nombre}(`);
  assert.ok(i !== -1, `no encuentro la función ${nombre}`);
  const sigue = CODIGO.indexOf('create or replace function ', i + 10);
  const fin = [CODIGO.indexOf('\n-- ──', i), sigue].filter((x) => x !== -1).sort((a, b) => a - b)[0] ?? CODIGO.length;
  return CODIGO.slice(i, fin);
};

const PUBLICAS = ['impresora_tomar', 'impresora_confirmar', 'impresora_latido', 'impresora_crear', 'impresora_rotar', 'impresora_activar', 'impresora_estado', 'impresion_cancelar'];
const PRIVADAS = ['hash_token', 'topico_impresora', 'impresora_de_token', 'impresiones_caducar', 'impresiones_mantener', 'impresiones_tope', 'impresiones_senal'];
const TODAS = [...PUBLICAS.map((n) => `public.${n}`), ...PRIVADAS.map((n) => `privado.${n}`)];
const TOKEN_CEROS = '0'.repeat(48);
const TOPICO_CEROS = 'impresora:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a';

// ───────────────────────── 1. estática ─────────────────────────

test('la migración va después de las que ya existían, con prefijo único', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(nombres.includes(MIGRACION));
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.ok(nombres.slice(nombres.indexOf(MIGRACION) + 1).every((n) => n > MIGRACION), 'las que le sigan (pago_breb, 20261003150000) son posteriores: se aplican después, nunca antes');
  for (const previa of ['20261002120000_personal_y_compuerta.sql', '20261001120000_cuenta_en_vivo.sql']) assert.ok(previa < MIGRACION, `va después de ${previa}`);
});

test('la cabecera dice lo que hace, cómo sale al aire y cómo se deshace', () => {
  const cab = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos'));
  for (const frase of ['REVERSA (menos de 1 minuto', 'SALIDA AL AIRE', 'CONTRATO DEL CONTENIDO', 'CONTRATO CON EL POS', 'AL MENOS UNA VEZ', 'Línea Roja', TOPICO_CEROS]) {
    assert.ok(cab.includes(frase), `la cabecera no dice «${frase}»`);
  }
  for (const n of [...PUBLICAS, 'RS030', '32768', '90 s', '15 minutos', '7 días']) assert.ok(cab.includes(n), `la cabecera no menciona ${n}`);
  assert.match(CODIGO, /create table if not exists public\.impresoras/);
  assert.match(CODIGO, /create table if not exists public\.impresiones/);
});

test('las firmas que comparten la base, el agente y el POS son exactamente estas', () => {
  const firmas = {
    impresora_tomar: /impresora_tomar\(p_token text, p_max integer default 5\)\s+returns setof public\.impresiones/,
    impresora_confirmar: /impresora_confirmar\(p_token text, p_id uuid, p_ok boolean, p_error text default null\)\s+returns jsonb/,
    impresora_latido: /impresora_latido\(p_token text, p_version text\)\s+returns jsonb/,
    impresora_crear: /impresora_crear\(p_nombre text\)\s+returns jsonb/,
    impresora_rotar: /impresora_rotar\(p_id uuid\)\s+returns jsonb/,
    impresora_activar: /impresora_activar\(p_id uuid, p_activa boolean\)\s+returns jsonb/,
    impresora_estado: /impresora_estado\(\)\s+returns table \(id uuid, nombre text, en_linea boolean, ultimo_latido timestamp with time zone, activa boolean, version_agente text\)/,
    impresion_cancelar: /impresion_cancelar\(p_id uuid\)\s+returns jsonb/,
  };
  for (const [n, re] of Object.entries(firmas)) assert.match(CODIGO, re, `firma de ${n}`);
  // las columnas del contrato
  const impresiones = CODIGO.match(/create table if not exists public\.impresiones \(([\s\S]*?)\n\);/)[1];
  for (const col of ['id uuid', 'impresora_id uuid', 'tipo text not null', 'mesa_id integer', 'orden_id text', 'contenido jsonb not null', "estado text not null default 'pendiente'", 'intentos integer not null default 0', 'error text', 'creada_por text default public.mi_correo()', 'creada_en timestamp with time zone not null default now()', 'tomada_en timestamp with time zone', 'impresa_en timestamp with time zone']) {
    assert.ok(impresiones.includes(col), `impresiones: falta «${col}»`);
  }
  const impresoras = CODIGO.match(/create table if not exists public\.impresoras \(([\s\S]*?)\n\);/)[1];
  for (const col of ['id uuid not null default gen_random_uuid()', 'nombre text not null', 'token_hash text not null', 'activa boolean not null default true', 'ultimo_latido timestamp with time zone', 'version_agente text', 'creada_en timestamp with time zone not null default now()', 'constraint impresoras_token_hash_key unique (token_hash)']) {
    assert.ok(impresoras.includes(col), `impresoras: falta «${col}»`);
  }
  assert.match(impresiones, /tipo = any \(array\['cuenta'::text, 'ticket'::text, 'abono'::text, 'cierre'::text, 'prueba'::text\]\)/);
  assert.match(impresiones, /estado = any \(array\['pendiente'::text, 'imprimiendo'::text, 'impresa'::text, 'error'::text\]\)/);
});

test('toda función fija search_path = \'\'; son SECURITY DEFINER las que tocan tablas ajenas al que llama; el tope corre con los permisos de quien llama', () => {
  for (const nombre of [...PUBLICAS.map((n) => `public.${n}`), ...PRIVADAS.map((n) => `privado.${n}`)]) {
    assert.match(funcion(nombre), /set search_path = ''/, `${nombre} sin search_path fijo`);
  }
  for (const nombre of [...PUBLICAS.map((n) => `public.${n}`), 'privado.impresora_de_token', 'privado.impresiones_caducar', 'privado.impresiones_mantener', 'privado.impresiones_senal']) {
    assert.match(funcion(nombre), /security definer/, `${nombre} debería ser SECURITY DEFINER`);
  }
  assert.doesNotMatch(funcion('privado.impresiones_tope'), /security definer/, 'el tope corre con los permisos de quien llama (current_user in anon/authenticated)');
  assert.match(funcion('privado.impresiones_tope'), /current_user in \('anon', 'authenticated'\)/);
  // ninguna función referencia objetos sin esquema (con search_path vacío fallaría, pero que no llegue al aire)
  for (const nombre of TODAS) assert.doesNotMatch(funcion(nombre), /\b(from|join|into|update|delete from)\s+(impresoras|impresiones|personal)\b/, `${nombre}: tabla sin esquema`);
});

test('REVOKE de cada función a public, anon, authenticated y service_role; y solo los GRANT EXECUTE previstos', () => {
  for (const nombre of TODAS) {
    const re = new RegExp(`revoke all on function ${nombre.replace('.', '\\.')}\\([^)]*\\) from public, anon, authenticated, service_role;`);
    assert.match(CODIGO, re, `falta el REVOKE de ${nombre}`);
  }
  const grants = [...CODIGO.matchAll(/grant execute on function (\S+?)\(([^)]*)\) to ([^;]+);/g)].map((m) => `${m[1]} -> ${m[3].trim()}`);
  assert.deepEqual(grants.sort(), [
    'public.impresion_cancelar -> authenticated',
    'public.impresora_activar -> authenticated',
    'public.impresora_confirmar -> anon, authenticated',
    'public.impresora_crear -> authenticated',
    'public.impresora_estado -> authenticated',
    'public.impresora_latido -> anon, authenticated',
    'public.impresora_rotar -> authenticated',
    'public.impresora_tomar -> anon, authenticated',
  ].sort(), 'solo el agente (con token) toca anon; nada de privado');
  assert.doesNotMatch(CODIGO, /grant execute on function privado\./);
  assert.doesNotMatch(CODIGO, /grant execute on function[^;]*service_role/);
});

test('las tablas: nada de GRANT a anon ni service_role, impresoras solo por columna (nunca token_hash) y RLS encendida con la compuerta', () => {
  assert.doesNotMatch(CODIGO, /grant[^;]*on public\.impres\w+ to[^;]*\b(anon|service_role|public)\b/i);
  assert.match(CODIGO, /revoke all on public\.impresoras from anon, authenticated, service_role;/);
  assert.match(CODIGO, /revoke all on public\.impresiones from anon, authenticated, service_role;/);
  const colsImpresoras = CODIGO.match(/grant select \(([^)]*)\) on public\.impresoras to authenticated;/);
  assert.ok(colsImpresoras, 'impresoras se lee por columna');
  assert.doesNotMatch(colsImpresoras[1], /token_hash/);
  assert.deepEqual(colsImpresoras[1].split(',').map((c) => c.trim()), ['id', 'nombre', 'activa', 'ultimo_latido', 'version_agente', 'creada_en']);
  assert.match(CODIGO, /grant select on public\.impresiones to authenticated;/);
  assert.match(CODIGO, /grant insert \(id, impresora_id, tipo, mesa_id, orden_id, contenido\) on public\.impresiones to authenticated;/);
  assert.doesNotMatch(CODIGO, /grant (update|delete|truncate|all)[^;]*on public\.impres/i, 'nadie edita ni borra por la API');
  for (const t of ['impresoras', 'impresiones']) assert.match(CODIGO, new RegExp(`alter table public\\.${t} enable row level security;`));
  assert.match(CODIGO, /foreach t in array array\['impresoras', 'impresiones'\] loop[\s\S]*as restrictive for all to authenticated/);
  assert.match(CODIGO, /create policy impresiones_crear on public\.impresiones for insert to authenticated\s+with check \(\s*\(select public\.mi_rol\(\)\) is not null\s+and estado = 'pendiente'\s+and intentos = 0\s+and creada_por is not distinct from \(select public\.mi_correo\(\)\)/);
  assert.match(CODIGO, /create policy impresoras_ver on public\.impresoras for select to authenticated\s+using \(\(select public\.mi_rol\(\)\) = 'admin'\)/);
});

test('el token nunca se guarda ni se escribe: solo su hash, y ningún RAISE lo nombra', () => {
  assert.match(funcion('public.impresora_crear'), /privado\.hash_token\(v_token\)/);
  assert.match(funcion('public.impresora_rotar'), /token_hash = privado\.hash_token\(v_token\)/);
  assert.doesNotMatch(CODIGO, /insert into public\.impresoras \([^)]*\btoken\b[^_]/);
  for (const m of CODIGO.matchAll(/raise\s[^;]*;/gi)) assert.doesNotMatch(m[0], /\b(p_token|v_token)\b/, `un RAISE nombra el token: ${m[0]}`);
  assert.doesNotMatch(CODIGO, /comment on[^;]*(p_token|v_token)/);
  assert.match(funcion('public.impresora_tomar'), /r\.creada_por := null;/, 'tomar no le da al agente el correo de quien encoló');
  // el token se genera aleatorio: 32 bytes de pgcrypto con prefijo
  assert.match(funcion('public.impresora_crear'), /'imp_' \|\| encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/);
});

test('los dos triggers que corren tras insertar NUNCA rompen la inserción: bloque protegido que solo avisa; el tope sí rechaza, a propósito', () => {
  for (const nombre of ['privado.impresiones_senal', 'privado.impresiones_mantener']) {
    const f = funcion(nombre);
    const abre = f.indexOf('begin', f.indexOf('begin') + 1);
    const captura = f.indexOf('exception when others');
    assert.ok(abre !== -1 && captura > abre, `${nombre}: hay un bloque interno con su exception`);
    const tras = f.slice(captura);
    assert.match(tras, /raise warning/);
    assert.doesNotMatch(tras, /raise exception/, 'el handler no relanza');
    assert.match(tras, /return null;/);
  }
  const senal = funcion('privado.impresiones_senal');
  assert.ok(senal.indexOf('realtime.send') > senal.indexOf('begin', senal.indexOf('begin') + 1) && senal.indexOf('realtime.send') < senal.indexOf('exception when others'), 'realtime.send va dentro del bloque protegido');
  assert.match(senal, /realtime\.send\('\{\}'::jsonb, 'trabajo', privado\.topico_impresora\(v_hash\), false\)/, 'payload vacío, evento «trabajo», canal público');
  const tope = funcion('privado.impresiones_tope');
  assert.match(tope, /errcode = 'RS030'/);
  assert.doesNotMatch(tope, /exception when others/);
  assert.match(tope, /pg_advisory_xact_lock/, 'el candado hace exacto el tope con dos sesiones a la vez');
  assert.match(CODIGO, /after insert on public\.impresiones\s+referencing new table as nuevas\s+for each statement execute function privado\.impresiones_tope\(\)/);
  assert.match(CODIGO, /after insert on public\.impresiones\s+for each row\s+when \(new\.estado = 'pendiente'\)\s+execute function privado\.impresiones_senal\(\)/);
});

test('la cola reparte con FOR UPDATE SKIP LOCKED y el mantenimiento no espera a nadie', () => {
  assert.match(funcion('public.impresora_tomar'), /for update skip locked/);
  assert.match(funcion('public.impresora_tomar'), /intentos = i\.intentos \+ 1/);
  assert.match(funcion('public.impresora_tomar'), /x\.tomada_en < now\(\) - interval '2 minutes' and x\.intentos < 3/);
  // el latido por sondeo salta la fila de la impresora si otra transacción la tiene (SKIP LOCKED) y pide el lock más flojo (NO KEY UPDATE):
  // con FOR UPDATE le haría esperar al FOR KEY SHARE que la llave foránea `tomada_por` pide justo después (lo mata K7, en la parte de Docker)
  assert.match(funcion('public.impresora_tomar'), /where x\.id = v\.id[\s\S]*?for no key update skip locked/);
  assert.doesNotMatch(funcion('public.impresora_tomar'), /where x\.id = v\.id[\s\S]*?\n\s+for update skip locked\);/, 'el lock de la fila de la impresora no puede ser FOR UPDATE');
  // Refutación, hallazgo 1: la reentrega de un «imprimiendo» trabado exige menos de 15 min de creado (no resucita cuentas viejas),
  // y el mantenimiento pasa a error el trabado de más de 15 min (tres sentencias: caducó sin tomar, caducó trabado, se trabó tras 3).
  assert.match(funcion('public.impresora_tomar'), /x\.intentos < 3\s+and x\.creada_en > now\(\) - interval '15 minutes'\)/);
  assert.equal((funcion('privado.impresiones_caducar').match(/for update skip locked/g) || []).length, 3);
  assert.match(funcion('privado.impresiones_caducar'), /x\.estado = 'imprimiendo'\s+and x\.tomada_en < now\(\) - interval '2 minutes'\s+and x\.creada_en < now\(\) - interval '15 minutes'/);
  // …y un trabajo trabado (2 min sin confirmar) se puede cancelar: es lo que el POS llama «la caja no responde»
  assert.match(funcion('public.impresion_cancelar'), /estado = 'pendiente'\s+or \(estado = 'imprimiendo' and tomada_en < now\(\) - interval '2 minutes'\)/);
  assert.match(funcion('privado.impresiones_mantener'), /for update skip locked/);
  assert.match(funcion('public.impresora_confirmar'), /for update;/, 'confirmar toma la fila para no pisar un tomar o un cancelar');
  assert.match(funcion('public.impresora_confirmar'), /i\.estado <> 'imprimiendo' or i\.tomada_por is distinct from v\.id/);
});

test('el vector del tópico: sha256 de 48 ceros, el mismo de la cuenta en vivo y del agente', () => {
  assert.equal(TOKEN_CEROS.length, 48);
  const hex = crypto.createHash('sha256').update(TOKEN_CEROS).digest('hex');
  assert.equal('impresora:' + hex, TOPICO_CEROS);
  assert.equal(topicoCuenta(TOKEN_CEROS).replace('cuenta:', ''), hex, 'el mismo hash que el vector de la cuenta en vivo');
  assert.ok(CUENTA.includes(hex));
  assert.ok(CODIGO.includes(`'${TOPICO_CEROS}'`), 'la migración comprueba el vector y se detiene si no coincide');
  assert.match(funcion('privado.topico_impresora'), /'impresora:' \|\| p_token_hash/);
  assert.match(funcion('privado.hash_token'), /encode\(extensions\.digest\(p_token, 'sha256'\), 'hex'\)/);
});

test('la migración no agrega policies a realtime.messages (canal público, como la cuenta) y no toca nada que ya exista', () => {
  assert.doesNotMatch(CODIGO, /realtime\.messages/);
  assert.doesNotMatch(CODIGO, /create policy[^;]*on realtime\./i);
  // solo crea o borra lo suyo
  for (const m of CODIGO.matchAll(/(?:alter table|drop table(?: if exists)?|drop policy(?: if exists)? \S+ on|create policy \S+ on|create trigger \S+\s+after insert on)\s+(public\.\w+)/g)) {
    assert.match(m[1], /^public\.impres(oras|iones)$/, `toca una tabla que no es suya: ${m[1]}`);
  }
  assert.doesNotMatch(CODIGO, /drop schema/);
  assert.doesNotMatch(CODIGO, /revoke[^;]*on schema/i, 'no le quita a nadie el uso de privado (la ola C se lo da a authenticated)');
  assert.match(CODIGO, /alter publication supabase_realtime add table public\.impresiones/);
  assert.doesNotMatch(CODIGO, /add table public\.impresoras/);
});

test('se detiene sin cambiar nada si falta la compuerta, pgcrypto o realtime.send', () => {
  const requisitos = CODIGO.slice(CODIGO.indexOf('create schema if not exists privado'), CODIGO.indexOf('-- ── 1.'));
  assert.match(requisitos, /to_regclass\('public\.personal'\) is null[\s\S]*to_regprocedure\('public\.mi_rol\(\)'\) is null[\s\S]*to_regprocedure\('public\.mi_correo\(\)'\) is null/);
  assert.match(requisitos, /to_regprocedure\('extensions\.digest\(text,text\)'\) is null[\s\S]*to_regprocedure\('extensions\.gen_random_bytes\(integer\)'\) is null/);
  assert.match(requisitos, /to_regprocedure\('realtime\.send\(jsonb,text,text,boolean\)'\) is null/);
  assert.match(requisitos, /has_function_privilege\('realtime\.send\(jsonb,text,text,boolean\)', 'execute'\)/);
});

test('la reversa de la cabecera nombra TODO lo que crea la migración, las funciones antes que las tablas', () => {
  const bloque = reversa(SQL);
  assert.match(bloque, /^begin;/);
  assert.match(bloque, /commit;\s*$/);
  const creadas = [...CODIGO.matchAll(/create or replace function (\S+?)\(([^)]*)\)/g)].map((m) => `${m[1]}/${m[2].trim() === '' ? 0 : m[2].split(',').length}`).sort();
  const borradas = [...bloque.matchAll(/drop function if exists (\S+?)\(([^)]*)\);/g)].map((m) => `${m[1]}/${m[2].trim() === '' ? 0 : m[2].split(',').length}`).sort();
  assert.deepEqual(borradas, creadas, 'la reversa borra exactamente las funciones que crea la migración');
  assert.equal(creadas.length, 15);
  for (const t of ['impresiones', 'impresoras']) assert.match(bloque, new RegExp(`drop table if exists public\\.${t};`));
  const tablas = bloque.indexOf('drop table if exists public.impresiones');
  assert.ok(tablas > bloque.indexOf('drop function if exists public.impresora_tomar'), 'impresora_tomar devuelve el tipo de la tabla: va antes');
  assert.ok(tablas > bloque.indexOf('drop function if exists privado.impresora_de_token'), 'impresora_de_token devuelve el tipo de impresoras: va antes');
  for (const f of ['impresiones_senal', 'impresiones_tope', 'impresiones_mantener']) assert.ok(bloque.indexOf(`drop function if exists privado.${f}`) > tablas, `${f} es la función de un trigger: va después de la tabla`);
  assert.ok(bloque.indexOf('drop table if exists public.impresoras') > bloque.indexOf('drop table if exists public.impresiones'), 'impresiones apunta a impresoras');
  assert.doesNotMatch(bloque, /cascade/i);
  assert.doesNotMatch(bloque, /drop schema/i, 'privado lo comparte la cuenta en vivo');
});

test('sin correos reales (el repo es público): solo dominios .test y example', () => {
  const textos = [SQL, fs.readFileSync(import.meta.filename, 'utf8'), fs.readFileSync(path.join(DIR_SQL, '00-ayudantes.sql'), 'utf8'),
    ...ESCENARIOS.map((f) => fs.readFileSync(path.join(DIR_SQL, f), 'utf8'))];
  for (const texto of textos) {
    for (const m of texto.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
      assert.match(m[1], /(\.test|^example\.[a-z]+)$/, `correo con dominio real: ${m[0]}`);
    }
  }
});

test('las baterías SQL existen y son las que corre el arnés', () => {
  for (const f of ['00-ayudantes.sql', ...ESCENARIOS]) assert.ok(fs.existsSync(path.join(DIR_SQL, f)), f);
  const dir = fs.readdirSync(DIR_SQL).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(dir, ['00-ayudantes.sql', ...ESCENARIOS].sort(), 'no hay un .sql suelto que nadie corra');
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MINIMO = { '10-permisos.sql': 110, '15-forma-y-tope.sql': 50, '20-cola.sql': 85, '30-admin-y-estado.sql': 55, '40-senal-y-purga.sql': 45 };

describe('contra un Postgres 17 desechable (Supabase simulado, cadena completa de migraciones)', { skip: docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false }, () => {
  let pg;
  let antes;
  let despues;
  const avisosDe = {};

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 7 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    antes = radiografia(pg);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, `la migración no se aplicó: ${mia[0].error}`);
    assert.deepEqual(mia[0].avisos, [], 'aplicarla no deja ni un WARNING');
    despues = radiografia(pg);
  }, { timeout: 300000 });

  after(() => { if (pg) pg.parar(); });

  test('agrega SOLO lo suyo: 2 tablas, 15 funciones, 5 policies, 3 triggers, la publicación; nada de lo que había cambia', () => {
    const clave = (f) => JSON.stringify(f);
    for (const [seccion, filas] of Object.entries(antes)) {
      const ahora = new Set(despues[seccion].map(clave));
      for (const f of filas) assert.ok(ahora.has(clave(f)), `${seccion}: cambió algo que ya existía: ${clave(f)}`);
    }
    const nuevas = (seccion) => despues[seccion].filter((f) => !antes[seccion].some((a) => clave(a) === clave(f)));
    assert.deepEqual(nuevas('relaciones').filter((r) => r.tipo === 'r').map((r) => r.relname).sort(), ['impresiones', 'impresoras']);
    assert.deepEqual(nuevas('funciones').map((f) => `${f.nspname}.${f.proname}`).sort(), [...TODAS].sort());
    assert.deepEqual(nuevas('policies').map((p) => `${p.tablename}:${p.policyname}`).sort(), [
      'impresiones:impresiones_crear', 'impresiones:impresiones_ver', 'impresiones:solo_personal',
      'impresoras:impresoras_ver', 'impresoras:solo_personal',
    ]);
    assert.deepEqual(nuevas('triggers').map((t) => t.tgname).sort(), ['impresiones_mantener', 'impresiones_senal', 'impresiones_tope']);
    assert.deepEqual(nuevas('publicacion'), [{ schemaname: 'public', tablename: 'impresiones' }]);
    assert.deepEqual(nuevas('columnas').map((c) => `${c.tabla}.${c.attname}`).sort(), [
      'impresiones.contenido', 'impresiones.id', 'impresiones.impresora_id', 'impresiones.mesa_id', 'impresiones.orden_id', 'impresiones.tipo',
      'impresoras.activa', 'impresoras.creada_en', 'impresoras.id', 'impresoras.nombre', 'impresoras.ultimo_latido', 'impresoras.version_agente',
    ], 'permisos por columna: seis de impresiones (insert) y seis de impresoras (select, sin token_hash)');
  });

  for (const archivo of ESCENARIOS) {
    test(`batería SQL ${archivo}`, () => {
      const r = correrEscenario(pg, archivo);
      avisosDe[archivo] = r.avisos;
      assert.ok(r.ok, `el archivo terminó con error: ${r.error}`);
      assert.deepEqual(r.fallan, [], r.fallan.map((f) => `${f.nombre} [${f.detalle}]`).join('\n'));
      assert.ok(r.resultados.length >= MINIMO[archivo], `${archivo}: solo ${r.resultados.length} comprobaciones (se esperaban ≥ ${MINIMO[archivo]})`);
    });
  }

  test('los WARNING son SOLO los que las pruebas provocan a propósito (señal rota, send ausente, mantenimiento roto)', () => {
    for (const f of ESCENARIOS.filter((x) => x !== '40-senal-y-purga.sql')) assert.deepEqual(avisosDe[f], [], `${f} no debería dejar WARNING`);
    const a = avisosDe['40-senal-y-purga.sql'].join('\n');
    assert.match(a, /impresiones_senal: realtime\.send simulada: falla a pedido \[P0001\]/);
    assert.match(a, /impresiones_senal: function realtime\.send\(jsonb, unknown, text, boolean\) does not exist \[42883\]/);
    assert.match(a, /impresiones_mantener: roto a propósito \[P0001\]/);
    assert.equal(avisosDe['40-senal-y-purga.sql'].length, 3, 'ni uno más');
  });

  test('sesiones simultáneas: tres agentes sin repetir trabajo, doble confirmación, cancelar contra tomar, el tope en el borde, y nadie espera a nadie', async () => {
    const res = await concurrencia(pg, { rondas: 8 });
    assert.ok(res.length >= 15);
    assert.deepEqual(res.filter((x) => !x.ok), [], res.filter((x) => !x.ok).map((x) => `${x.nombre} [${x.detalle}]`).join('\n'));
  });

  test('aplicarla dos veces es inocua: con datos adentro, el catálogo queda idéntico y no se pierde ni una fila', () => {
    assert.deepEqual(comprobarIdempotencia(pg, despues), []);
  });

  test('la reversa comentada de la cabecera funciona en limpio y deja el catálogo como antes; volver a aplicar lo deja como después', () => {
    assert.deepEqual(comprobarReversa(pg, SQL, antes, despues), []);
    assert.equal(pg.filas("select count(*) as n from pg_publication_tables where tablename like 'impres%'")[0].n, 1, 'impresiones vuelve a la publicación al reaplicar');
    // y la batería de permisos vuelve a pasar sobre lo reaplicado
    assert.deepEqual(correrEscenario(pg, '10-permisos.sql').fallan, []);
  });
});

describe('se niega a correr, sin cambiar nada, si falta una condición (Postgres desechable propio)', { skip: docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
  }, { timeout: 300000 });
  after(() => { if (pg) pg.parar(); });

  test('sin la compuerta de personal, sin realtime.send o sin permiso para ejecutarlo: error claro y NADA creado; con todo en orden, sin avisos', () => {
    assert.deepEqual(comprobarPrecondiciones(pg), []);
  });
});
