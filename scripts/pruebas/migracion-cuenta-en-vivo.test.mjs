// La señal de la base de la cuenta en vivo: supabase/migrations/20261001120000_cuenta_en_vivo.sql
// (parte 1A del SDD docs/sdd-cuenta-en-mesa.md §04.1-§04.2, tarea tareas/2026-09-30-cuenta-en-mesa.md).
//
// El trigger de `ordenes` y `mesas` llama a realtime.send hacia un tópico público derivado del token
// (`cuenta:` + sha256 hex), con payload vacío. Dos partes, como desborde.test.mjs y funciones.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. security definer con
//      search_path = '', `exception when others`, realtime.send(…, false), la guarda de
//      `is distinct from`, la rama de liquidaciones que lee la mesa de `ordenes`, cero GRANT a anon, cero
//      policies en realtime.messages, y el VECTOR del tópico que comparte con la Edge Function `cuenta`
//      (1B): token de 48 ceros → cuenta:f9a2ba51…c46a.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker, ver _supabase-simulado.mjs): las migraciones
//      reales (base + carta + esta) sobre roles de Supabase simulados. Cada camino de escritura del POS
//      (apertura, delta, nota, facturar, cobro parcial, liberar vacía, cerrarDia, reabrir en la misma y en
//      otra mesa, rotar token) emite lo que el SDD §08 S-3 dice, y NINGUNO deja de escribir aunque
//      realtime.send falle o no exista. También: la rama de liquidaciones (con una tabla de prueba, porque
//      la crea la fase 2), los privilegios, la idempotencia y que la reversa comentada funciona.
//
// Lo que NO prueba (necesita el proyecto vivo, con el GO de Yonatan): que el servidor de Realtime reparta
// la señal al navegador y que `postgres` pueda ejecutar el realtime.send real. Son las pruebas S-1 a S-6.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RAIZ, buscarDocker, levantarPostgres, topicoCuenta } from './_supabase-simulado.mjs';

const MIGRACION = 'supabase/migrations/20261001120000_cuenta_en_vivo.sql';
const DIR_MIGRACIONES = path.join(RAIZ, 'supabase/migrations');
const SQL = fs.readFileSync(path.join(RAIZ, MIGRACION), 'utf8');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CODIGO = sinComentarios(SQL);
/** El cuerpo de una función `create or replace function <nombre>(…)`, hasta su `$$;` de cierre. */
const funcion = (nombre) => {
  const i = CODIGO.indexOf(`create or replace function ${nombre}`);
  assert.ok(i !== -1, `no encuentro la función ${nombre}`);
  const fin = CODIGO.indexOf('$$;', CODIGO.indexOf('$$', i) + 2);
  return CODIGO.slice(i, fin + 3);
};

// El vector compartido con 1B (scripts/pruebas/fn-cuenta.test.mjs): NO cambiarlo sin cambiar los dos.
const TOKEN_CEROS = '0'.repeat(48);
const TOPICO_CEROS = 'cuenta:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a';

// ───────────────────────── 1. estática ─────────────────────────

test('el vector del tópico: sha256 de un token de 48 ceros, el mismo que usa la Edge Function (1B)', () => {
  assert.equal(TOKEN_CEROS.length, 48);
  assert.equal('cuenta:' + crypto.createHash('sha256').update(TOKEN_CEROS).digest('hex'), TOPICO_CEROS);
  assert.equal(topicoCuenta(TOKEN_CEROS), TOPICO_CEROS);
  assert.ok(CODIGO.includes(`'${TOPICO_CEROS}'`), 'la migración comprueba el vector con el mismo valor (y se detiene si no coincide)');
  assert.match(funcion('privado.topico_cuenta'), /'cuenta:'\s*\|\|\s*encode\(extensions\.digest\(p_token, 'sha256'\), 'hex'\)/);
});

test('el nombre de la migración ordena después de las que ya existen (se aplica al final)', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.equal(nombres[nombres.length - 1] >= path.basename(MIGRACION), true);
  const previas = nombres.filter((f) => f < path.basename(MIGRACION));
  assert.ok(previas.includes('20260905000000_resplandor_base.sql') && previas.includes('20260906120000_carta_publica_y_token_mesa.sql'));
});

test('las dos funciones fijan search_path = \'\' y la del trigger es security definer', () => {
  for (const nombre of ['privado.topico_cuenta', 'privado.emitir_cuenta']) {
    assert.match(funcion(nombre), /set search_path = ''/, `${nombre} sin search_path fijo`);
  }
  assert.match(funcion('privado.emitir_cuenta'), /security definer/);
  assert.doesNotMatch(funcion('privado.emitir_cuenta'), /security invoker/);
});

test('el trigger nunca rompe la escritura: todo el cuerpo va dentro de `exception when others`, que solo avisa', () => {
  const f = funcion('privado.emitir_cuenta');
  const abre = f.indexOf('begin', f.indexOf('begin') + 1);          // el bloque interno, después del `begin` de la función
  const captura = f.indexOf('exception when others');
  assert.ok(abre !== -1 && captura > abre, 'hay un bloque interno con su exception');
  assert.ok(f.indexOf('realtime.send') > abre && f.lastIndexOf('realtime.send') < captura, 'toda llamada a realtime.send está dentro del bloque protegido');
  assert.ok(f.indexOf('foreach') > abre && f.indexOf('foreach') < captura, 'el recorrido de mesas también');
  const tras = f.slice(captura);
  assert.match(tras, /raise warning/);
  assert.doesNotMatch(tras, /raise exception|\braise\s+(?!warning)/i, 'el handler no relanza: solo avisa en los logs');
  assert.match(tras, /return null;/, 'y el trigger de después devuelve null');
});

test('toda llamada a realtime.send es pública (private = false), con payload vacío y evento «cambio»', () => {
  const llamadas = [...CODIGO.matchAll(/realtime\.send\(([^;]*?)\);/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  assert.ok(llamadas.length >= 2, 'hay una llamada por rama (mesas y recorrido de mesas)');
  for (const l of llamadas) {
    assert.match(l, /^'\{\}'::jsonb, 'cambio', .+, false$/, `realtime.send mal formada: ${l}`);
  }
  assert.doesNotMatch(CODIGO, /realtime\.send\([^;]*\btrue\b/, 'ningún canal privado: no hay policy para anon (SDD S-0 sin probar)');
});

test('la rotación del token solo avisa si el token CAMBIÓ (el upsert del POS lo reenvía igual) y avisa al tópico viejo', () => {
  const f = funcion('privado.emitir_cuenta');
  assert.match(f, /new\.token is distinct from old\.token/);
  assert.match(f, /topico_cuenta\(old\.token\)/);
  assert.match(CODIGO, /create or replace trigger mesas_emite_cuenta\s+after update of token on public\.mesas\s+for each row execute function privado\.emitir_cuenta\(\)/);
});

test('ordenes: el trigger cubre insert, update y delete, y solo emite por lo que estaba o queda abierto', () => {
  assert.match(CODIGO, /create or replace trigger ordenes_emite_cuenta\s+after insert or update or delete on public\.ordenes\s+for each row execute function privado\.emitir_cuenta\(\)/);
  const f = funcion('privado.emitir_cuenta');
  assert.match(f, /tg_op = 'INSERT' then\s+if new\.estado = 'abierta' then v_mesas := array\[new\.mesa_id\]/);
  assert.match(f, /tg_op = 'DELETE' then\s+if old\.estado = 'abierta' then v_mesas := array\[old\.mesa_id\]/);
  assert.match(f, /old\.estado = 'abierta' or new\.estado = 'abierta' then\s+v_mesas := array\[old\.mesa_id, new\.mesa_id\]/, 'reabrirOrden puede cambiar de mesa: avisa a las dos');
});

test('la rama de liquidaciones (fase 2) saca la mesa de la ORDEN, nunca de la liquidación', () => {
  const f = funcion('privado.emitir_cuenta');
  const rama = f.slice(f.indexOf("elsif tg_op <> 'DELETE'"), f.indexOf('end if;', f.indexOf("elsif tg_op <> 'DELETE'")));
  assert.match(rama, /select array\[o\.mesa_id\] into v_mesas from public\.ordenes o where o\.id = new\.orden_id/);
  assert.doesNotMatch(rama.replace(/o\.mesa_id/g, ''), /mesa_id/, 'la rama no lee ninguna otra columna mesa_id');
  assert.match(f, /foreach v_mesa in array coalesce\(/, 'FOREACH sobre NULL lanza error: va con coalesce');
});

test('cero GRANT a anon, cero policies en realtime.messages y nada que toque datos ni tablas de public', () => {
  assert.doesNotMatch(CODIGO, /\bgrant\b[^;]*\b(anon|public)\b/i, 'ningún grant a anon ni a public');
  assert.doesNotMatch(CODIGO, /\bgrant\b[^;]*\bauthenticated\b/i, 'tampoco a authenticated: nadie llama a estas funciones');
  assert.doesNotMatch(CODIGO, /\b(create|alter|drop)\s+policy\b/i, 'cero policies');
  assert.doesNotMatch(CODIGO, /realtime\.messages/i, 'no toca realtime.messages');
  assert.doesNotMatch(CODIGO, /\b(insert\s+into|delete\s+from|truncate|alter\s+table|create\s+table|create\s+index|create\s+extension)\b/i, 'solo schema, funciones y triggers');
  assert.doesNotMatch(CODIGO, /\bupdate\s+public\./i);
});

test('las funciones y el esquema se cierran a public, anon y authenticated', () => {
  assert.match(CODIGO, /revoke all on schema privado from public, anon, authenticated;/);
  assert.match(CODIGO, /revoke all on function privado\.emitir_cuenta\(\) from public, anon, authenticated;/);
  assert.match(CODIGO, /revoke all on function privado\.topico_cuenta\(text\) from public, anon, authenticated;/);
});

test('se puede correr dos veces (create or replace, if not exists) y se detiene ANTES de crear triggers si falta la señal', () => {
  assert.match(CODIGO, /create schema if not exists privado;/);
  assert.doesNotMatch(CODIGO, /\bcreate\s+trigger\b/i, 'un create trigger pelado falla la segunda vez');
  assert.match(CODIGO, /to_regprocedure\('realtime\.send\(jsonb,text,text,boolean\)'\) is null/);
  assert.match(CODIGO, /not has_function_privilege\('realtime\.send\(jsonb,text,text,boolean\)', 'execute'\)/);
  const iPrecondiciones = CODIGO.indexOf('to_regprocedure');
  assert.ok(iPrecondiciones !== -1 && iPrecondiciones < CODIGO.indexOf('create or replace trigger'), 'las comprobaciones van antes de los triggers');
  assert.match(CODIGO.slice(iPrecondiciones, CODIGO.indexOf('create or replace trigger')), /raise exception/);
});

/** Las sentencias de la reversa comentada, en orden. */
const REVERSA = [...SQL.matchAll(/^--\s{3}(drop [^;\n]+;)/gm)].map((m) => m[1]);

test('la reversa comentada existe: los dos triggers primero y, al final, el esquema SIN cascade', () => {
  assert.deepEqual(REVERSA, [
    'drop trigger if exists ordenes_emite_cuenta on public.ordenes;',
    'drop trigger if exists mesas_emite_cuenta on public.mesas;',
    'drop function if exists privado.emitir_cuenta();',
    'drop function if exists privado.topico_cuenta(text);',
    'drop schema if exists privado;',
  ]);
  assert.doesNotMatch(REVERSA.join(' '), /cascade/i, 'la fase 2 pone más objetos en privado: un cascade se los llevaría');
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();

const TOKEN = { 1: 'a'.repeat(48), 2: 'b'.repeat(48), 3: 'c'.repeat(48) };
const TOKEN_NUEVO = 'd'.repeat(48);
const MESERO = { como: 'authenticated', claims: { role: 'authenticated', app_metadata: { provider: 'google' }, email: 'mesero@example.test' } };

describe('contra un Postgres 17 desechable (Supabase simulado)', { skip: docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false }, () => {
  let pg;
  let antes;
  let despues;

  const radiografia = () => ({
    relaciones: pg.filas("select c.relname, c.relkind::text as tipo, c.relacl::text as acl from pg_class c where c.relnamespace = 'public'::regnamespace order by 1"),
    funciones: pg.filas("select p.proname, p.proacl::text as acl, md5(p.prosrc) as cuerpo from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1"),
    policies: pg.filas('select schemaname, tablename, policyname, cmd, roles::text as roles from pg_policies order by 1, 2, 3'),
    publicacion: pg.filas("select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1, 2"),
    triggers: pg.filas('select tgrelid::regclass::text as tabla, tgname from pg_trigger where not tgisinternal order by 1, 2'),
    mesas: pg.filas('select id, token from public.mesas order by id'),
  });

  /** Estado limpio para cada prueba: mesas 1 a 3 con sus tokens, sin órdenes, sin señales anotadas. */
  const reiniciar = () => {
    const r = pg.sql(`
      truncate public.ordenes cascade;
      delete from public.mesas;
      insert into public.mesas (id, capacidad, estado, token) values
        (1, 4, 'libre', '${TOKEN[1]}'), (2, 4, 'libre', '${TOKEN[2]}'), (3, 2, 'libre', '${TOKEN[3]}');
      truncate realtime.llamadas_prueba restart identity;`);
    assert.ok(r.ok, r.error);
  };
  const pos = (texto) => pg.sql(texto, MESERO);
  /** Una escritura del POS: tiene que salir bien y sin un solo WARNING. */
  const escribe = (texto) => {
    const r = pos(texto);
    assert.ok(r.ok, `la escritura del POS falló: ${r.error}`);
    assert.deepEqual(r.avisos, [], 'una escritura normal no debe dejar WARNING del trigger');
    return r;
  };
  /** Los tópicos que salieron desde el último reinicio, en orden. */
  const topicos = () => pg.senales();
  const t = (mesa) => topicoCuenta(TOKEN[mesa]);

  // Como el POS: upsert de la fila completa (formatOrden: id, mesa_id, estado, items, total, abierta_en, cerrada_en, updated_at).
  const upsertOrden = (id, mesa, estado, cerrada = false) => `
    insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, updated_at)
    values ('${id}', ${mesa}, '${estado}', '[]'::jsonb, 0, now(), ${cerrada ? 'now()' : 'null'}, now())
    on conflict (id) do update set mesa_id = excluded.mesa_id, estado = excluded.estado, items = excluded.items,
      total = excluded.total, abierta_en = excluded.abierta_en, cerrada_en = excluded.cerrada_en, updated_at = excluded.updated_at;`;
  const delta = (orden, item, nombre, precio, d) =>
    `select public.aplicar_delta_orden('${orden}', '${item}', '${nombre}', ${precio}, ${d}, '');`;

  before(async () => {
    pg = await levantarPostgres();
    for (const m of ['20260905000000_resplandor_base.sql', '20260906120000_carta_publica_y_token_mesa.sql']) {
      const r = pg.aplicar(`supabase/migrations/${m}`);
      assert.ok(r.ok, `${m}: ${r.error}`);
    }
    reiniciar();
    antes = radiografia();
    const r = pg.aplicar(MIGRACION);
    assert.ok(r.ok, `la migración no se aplicó: ${r.error}`);
    assert.deepEqual(r.avisos, []);
    despues = radiografia();
    reiniciar();
  }, { timeout: 300000 });

  after(() => { if (pg) pg.parar(); });

  // ── la migración misma ──

  test('se aplica sobre el esquema real y deja EXACTAMENTE dos triggers nuevos, activos', () => {
    const nuevos = despues.triggers.filter((x) => !antes.triggers.some((y) => y.tabla === x.tabla && y.tgname === x.tgname));
    assert.deepEqual(nuevos, [
      { tabla: 'mesas', tgname: 'mesas_emite_cuenta' },
      { tabla: 'ordenes', tgname: 'ordenes_emite_cuenta' },
    ]);
    const estado = pg.filas("select tgname, tgenabled::text as activo from pg_trigger where tgname in ('ordenes_emite_cuenta', 'mesas_emite_cuenta') order by 1");
    assert.deepEqual(estado, [{ tgname: 'mesas_emite_cuenta', activo: 'O' }, { tgname: 'ordenes_emite_cuenta', activo: 'O' }]);
  });

  test('no cambia nada más: ni permisos, ni policies, ni funciones, ni la publicación, ni los datos de public', () => {
    assert.deepEqual(despues.relaciones, antes.relaciones, 'GRANT de las tablas de public');
    assert.deepEqual(despues.funciones, antes.funciones, 'funciones de public');
    assert.deepEqual(despues.policies, antes.policies, 'policies (incluida realtime.messages)');
    assert.deepEqual(despues.publicacion, antes.publicacion);
    assert.deepEqual(despues.mesas, antes.mesas, 'los tokens siguen siendo los mismos');
  });

  test('el tópico en SQL coincide con el de Node para el vector y para tokens de 32, 48 y 64 hex', () => {
    const tokens = [TOKEN_CEROS, 'f'.repeat(32), '0123456789abcdef'.repeat(4), crypto.randomBytes(24).toString('hex')];
    for (const token of tokens) {
      const r = pg.filas(`select privado.topico_cuenta('${token}') as topico`);
      assert.equal(r[0].topico, topicoCuenta(token));
    }
    assert.equal(pg.filas(`select privado.topico_cuenta('${TOKEN_CEROS}') as topico`)[0].topico, TOPICO_CEROS);
  });

  test('anon, authenticated y service_role no pueden ejecutar nada de `privado` ni usar el esquema; realtime.messages sigue sin policies ni GRANT', () => {
    for (const rol of ['anon', 'authenticated', 'service_role']) {
      assert.equal(pg.filas(`select has_schema_privilege('${rol}', 'privado', 'usage') as v`)[0].v, false, `${rol}: usage en privado`);
      assert.equal(pg.filas(`select has_function_privilege('${rol}', 'privado.emitir_cuenta()', 'execute') as v`)[0].v, false, `${rol}: emitir_cuenta`);
      assert.equal(pg.filas(`select has_function_privilege('${rol}', 'privado.topico_cuenta(text)', 'execute') as v`)[0].v, false, `${rol}: topico_cuenta`);
      assert.equal(pg.filas(`select has_table_privilege('${rol}', 'realtime.messages', 'select') as v`)[0].v, false, `${rol}: realtime.messages`);
    }
    const r = pg.sql("select privado.topico_cuenta('x');", { como: 'anon' });
    assert.equal(r.ok, false);
    assert.match(r.error, /permission denied for schema privado/);
    assert.equal(pg.filas("select count(*)::int as n from pg_policies where schemaname = 'realtime'")[0].n, 0);
  });

  test('es idempotente: aplicarla otra vez no falla, no avisa y no duplica nada', () => {
    const r = pg.aplicar(MIGRACION);
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(radiografia().triggers, despues.triggers);
    assert.equal(pg.filas("select count(*)::int as n from pg_proc where pronamespace = 'privado'::regnamespace")[0].n, 2);
  });

  test('se detiene sin crear triggers si no existe realtime.send (en vez de avisar en cada escritura, para siempre)', () => {
    pg.sql(`
      drop trigger ordenes_emite_cuenta on public.ordenes;
      drop trigger mesas_emite_cuenta on public.mesas;
      alter function realtime.send(jsonb, text, text, boolean) rename to send_oculta;`);
    try {
      const r = pg.aplicar(MIGRACION);
      assert.equal(r.ok, false);
      assert.match(r.error, /falta realtime\.send/);
      assert.equal(pg.filas("select count(*)::int as n from pg_trigger where tgname in ('ordenes_emite_cuenta', 'mesas_emite_cuenta')")[0].n, 0, 'sin señal posible, ningún trigger');
    } finally {
      pg.sql('alter function realtime.send_oculta(jsonb, text, text, boolean) rename to send;');
    }
    const otra = pg.aplicar(MIGRACION);
    assert.ok(otra.ok, otra.error);
    assert.deepEqual(radiografia().triggers, despues.triggers, 'y vuelve a quedar igual al aplicarla con la señal disponible');
  });

  test('se detiene también si quien la aplica no puede EJECUTAR realtime.send (el trigger corre con sus permisos)', () => {
    pg.sql(`
      drop trigger ordenes_emite_cuenta on public.ordenes;
      drop trigger mesas_emite_cuenta on public.mesas;
      revoke execute on function realtime.send(jsonb, text, text, boolean) from migrador;`);
    try {
      const r = pg.aplicar(MIGRACION);
      assert.equal(r.ok, false);
      assert.match(r.error, /no puede ejecutar realtime\.send/);
      assert.equal(pg.filas("select count(*)::int as n from pg_trigger where tgname in ('ordenes_emite_cuenta', 'mesas_emite_cuenta')")[0].n, 0);
    } finally {
      pg.sql('grant execute on function realtime.send(jsonb, text, text, boolean) to migrador;');
    }
    const otra = pg.aplicar(MIGRACION);
    assert.ok(otra.ok, otra.error);
    assert.deepEqual(radiografia().triggers, despues.triggers);
  });

  // ── cada camino de escritura del POS (SDD §08 S-3) ──

  test('abrir una mesa (INSERT de una orden abierta, upsert del POS) emite UNA señal a SU tópico, vacía, pública y de tipo «cambio»', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'abierta'));
    const filas = pg.filas('select topico, evento, payload, privado from realtime.llamadas_prueba order by id');
    assert.deepEqual(filas, [{ topico: t(1), evento: 'cambio', payload: {}, privado: false }]);
  });

  test('un delta de ítems emite exactamente 1 señal (S-2); otro, otra; una nota, otra; y solo a la mesa de la orden', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'abierta'));
    pg.limpiarSenales();
    escribe(delta('o1', 'p1', 'Limonada', 5000, 1));
    assert.deepEqual(topicos(), [t(1)]);
    escribe(delta('o1', 'p1', 'Limonada', 5000, 1));
    assert.deepEqual(topicos(), [t(1), t(1)]);
    escribe("select public.actualizar_nota_item('o1', 'p1', 'sin hielo');");
    assert.deepEqual(topicos(), [t(1), t(1), t(1)]);
    const o = pg.filas("select total::int as total, version from public.ordenes where id = 'o1'")[0];
    assert.deepEqual(o, { total: 10000, version: 3 }, 'las escrituras llegaron enteras');
    assert.ok(!topicos().includes(t(2)) && !topicos().includes(t(3)), 'las otras mesas no se enteran');
  });

  test('el delta de una mesa no despierta a otra: cada mesa emite solo a su propio tópico', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'abierta') + upsertOrden('o2', 2, 'abierta'));
    assert.deepEqual(topicos(), [t(1), t(2)]);
    pg.limpiarSenales();
    escribe(delta('o2', 'p9', 'Café', 3000, 2));
    assert.deepEqual(topicos(), [t(2)]);
    assert.notEqual(t(1), t(2));
  });

  test('facturar (UPDATE abierta → cerrada) emite 1; reenviar una orden que ya estaba cerrada no emite', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'abierta'));
    pg.limpiarSenales();
    escribe(upsertOrden('o1', 1, 'cerrada', true));
    assert.deepEqual(topicos(), [t(1)], 'el cierre sí avisa: la carta pasa a «Mesa cerrada»');
    pg.limpiarSenales();
    escribe(upsertOrden('o1', 1, 'cerrada', true));
    escribe("update public.ordenes set total = 123 where id = 'o1';");
    assert.deepEqual(topicos(), [], 'una orden cerrada que se reenvía no es noticia para nadie');
  });

  test('cobro parcial: el INSERT de la orden ya cerrada no emite; los deltas negativos de la abierta, sí, uno cada uno', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'abierta'));
    escribe(delta('o1', 'p1', 'Limonada', 5000, 2) + delta('o1', 'p2', 'Arepa', 3000, 1));
    pg.limpiarSenales();
    escribe(upsertOrden('parcial', 1, 'cerrada', true));
    assert.deepEqual(topicos(), [], 'pos.html:2505 inserta la orden parcial ya cerrada');
    escribe(delta('o1', 'p1', 'Limonada', 5000, -2));
    assert.deepEqual(topicos(), [t(1)]);
  });

  test('liberar una mesa vacía (DELETE de la orden abierta) emite 1 y la carta puede decir «sin orden»', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'abierta'));
    pg.limpiarSenales();
    escribe("delete from public.ordenes where id = 'o1';");
    assert.deepEqual(topicos(), [t(1)]);
  });

  test('cerrarDia (DELETE de órdenes cerradas, varias de golpe) no emite nada y no deja ni un WARNING', () => {
    reiniciar();
    escribe(upsertOrden('c1', 1, 'cerrada', true) + upsertOrden('c2', 2, 'cerrada', true) + upsertOrden('c3', 3, 'cerrada', true));
    escribe(upsertOrden('o1', 1, 'abierta'));
    pg.limpiarSenales();
    escribe("delete from public.ordenes where id in ('c1', 'c2', 'c3');");
    assert.deepEqual(topicos(), []);
  });

  test('reabrir una orden cerrada en su misma mesa emite 1', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'cerrada', true));
    pg.limpiarSenales();
    escribe(upsertOrden('o1', 1, 'abierta'));
    assert.deepEqual(topicos(), [t(1)]);
  });

  test('reabrir en OTRA mesa emite 2: la vieja (deja de verla) y la nueva (aparece)', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'cerrada', true));
    pg.limpiarSenales();
    escribe(upsertOrden('o1', 2, 'abierta'));
    assert.deepEqual([...topicos()].sort(), [t(1), t(2)].sort());
    assert.equal(topicos().length, 2);
  });

  test('mover una orden abierta de mesa también avisa a las dos, una vez cada una', () => {
    reiniciar();
    escribe(upsertOrden('o1', 1, 'abierta'));
    pg.limpiarSenales();
    escribe("update public.ordenes set mesa_id = 3 where id = 'o1';");
    assert.deepEqual([...topicos()].sort(), [t(1), t(3)].sort());
  });

  test('rotar el token emite 1 señal al tópico VIEJO (y ninguna al nuevo); reenviar el mismo token, o cambiar solo el estado, no emite', () => {
    reiniciar();
    escribe(`update public.mesas set token = '${TOKEN_NUEVO}' where id = 1;`);
    assert.deepEqual(topicos(), [t(1)], 'quien miraba con el enlace viejo recibe la señal, lee, obtiene 404 y la carta cierra el canal');
    assert.ok(!topicos().includes(topicoCuenta(TOKEN_NUEVO)));

    pg.limpiarSenales();
    const upsertMesa = (id, estado, token) => `insert into public.mesas (id, capacidad, estado, token) values (${id}, 4, '${estado}', '${token}')
      on conflict (id) do update set capacidad = excluded.capacidad, estado = excluded.estado, token = excluded.token;`;
    escribe(upsertMesa(1, 'libre', TOKEN_NUEVO));                  // el upsert del POS reenvía el token tal cual
    escribe(upsertMesa(2, 'ocupada', TOKEN[2]));
    escribe("update public.mesas set estado = 'ocupada' where id = 3;");
    assert.deepEqual(topicos(), [], 'ni el upsert con el mismo token ni un cambio de estado emiten');

    escribe(upsertMesa(2, 'ocupada', TOKEN_NUEVO.replace(/d/g, 'e')));   // y una rotación por upsert (tablet con caché) sí
    assert.deepEqual(topicos(), [t(2)]);
  });

  test('una orden que nace ya cerrada, o una de una mesa sin tocar, no emite; y ninguna señal lleva datos de la cuenta', () => {
    reiniciar();
    escribe(upsertOrden('x', 3, 'cerrada', true));
    assert.deepEqual(topicos(), []);
    escribe(upsertOrden('o1', 1, 'abierta'));
    escribe(delta('o1', 'p1', 'Menú Resplandor', 23000, 1) + delta('o1', 'p1', 'Menú Resplandor', 23000, 1));
    escribe(upsertOrden('o1', 1, 'cerrada', true));
    const todo = pg.filas('select topico, evento, payload, privado from realtime.llamadas_prueba');
    assert.ok(todo.length >= 4);
    for (const s of todo) {
      assert.deepEqual(s.payload, {});
      assert.equal(s.evento, 'cambio');
      assert.equal(s.privado, false);
      assert.match(s.topico, /^cuenta:[0-9a-f]{64}$/);
    }
  });

  // ── la señal no puede romper la escritura ──

  test('si realtime.send FALLA, la escritura del POS sale bien igual y el trigger solo deja un WARNING (por cada camino)', () => {
    reiniciar();
    const escribeConFalla = (texto) => {
      const r = pos(`set prueba.send_falla = 'si';\n${texto}`);
      assert.ok(r.ok, `el fallo de la señal rompió la escritura: ${r.error}`);
      assert.ok(r.avisos.some((a) => /emitir_cuenta .*realtime\.send simulada/.test(a)), `sin WARNING en: ${r.stderr}`);
      return r;
    };
    escribeConFalla(upsertOrden('o1', 1, 'abierta'));
    escribeConFalla(delta('o1', 'p1', 'Limonada', 5000, 3));
    escribeConFalla("select public.actualizar_nota_item('o1', 'p1', 'con hielo');");
    escribeConFalla(`update public.mesas set token = '${TOKEN_NUEVO}' where id = 2;`);
    escribeConFalla(upsertOrden('o1', 1, 'cerrada', true));
    escribeConFalla(upsertOrden('o3', 3, 'abierta'));
    escribeConFalla("delete from public.ordenes where id = 'o3';");
    assert.deepEqual(topicos(), [], 'se perdieron las señales, no los datos');
    assert.deepEqual(pg.filas('select id, estado from public.ordenes order by id'), [{ id: 'o1', estado: 'cerrada' }], 'el cierre y el delete llegaron');
    assert.equal(pg.filas("select token from public.mesas where id = 2")[0].token, TOKEN_NUEVO, 'la rotación llegó');
  });

  test('si realtime.send NO EXISTE (Realtime apagado, función renombrada), tampoco se rompe nada', () => {
    reiniciar();
    pg.sql('alter function realtime.send(jsonb, text, text, boolean) rename to send_oculta;');
    try {
      const r = pos(upsertOrden('o1', 1, 'abierta') + delta('o1', 'p1', 'Limonada', 5000, 1));
      assert.ok(r.ok, r.error);
      assert.ok(r.avisos.length >= 2 && r.avisos.every((a) => /emitir_cuenta/.test(a)), r.stderr);
      assert.equal(pg.filas("select total::int as total from public.ordenes where id = 'o1'")[0].total, 5000);
    } finally {
      pg.sql('alter function realtime.send_oculta(jsonb, text, text, boolean) rename to send;');
    }
  });

  test('el trigger corre aunque quien escribe NO pueda ejecutar realtime.send ni usar `privado` (es security definer)', () => {
    reiniciar();
    assert.equal(pg.filas("select has_function_privilege('authenticated', 'realtime.send(jsonb, text, text, boolean)', 'execute') as v")[0].v, false);
    const directa = pos("select realtime.send('{}'::jsonb, 'cambio', 'cuenta:x', false);");
    assert.equal(directa.ok, false, 'el mesero no puede publicar a mano: eso es lo que hace seguro el diseño');
    escribe(upsertOrden('o1', 1, 'abierta'));
    assert.deepEqual(topicos(), [t(1)]);
  });

  test('el rol anon sigue sin poder escribir órdenes ni mesas (y por lo tanto sin disparar señales)', () => {
    reiniciar();
    const o = pg.sql(upsertOrden('hack', 1, 'abierta'), { como: 'anon' });
    const m = pg.sql("update public.mesas set token = 'ee' where id = 1;", { como: 'anon' });
    assert.equal(o.ok, false);
    assert.equal(m.ok, false);
    assert.deepEqual(topicos(), []);
  });

  // ── la rama de liquidaciones (la tabla la crea la fase 2; acá, una de prueba con el mismo trigger) ──

  describe('rama de liquidaciones (tabla de prueba + el trigger que le pondrá la fase 2)', () => {
    before(() => {
      const r = pg.sql(`
        create table public.liquidaciones (orden_id text primary key references public.ordenes(id) on delete cascade, estado text not null default 'pedida');
        grant select, insert, update on public.liquidaciones to authenticated, service_role;
        create trigger liquidaciones_emite_cuenta after insert or update on public.liquidaciones
          for each row execute function privado.emitir_cuenta();`, { como: 'migrador' });
      assert.ok(r.ok, r.error);
    });
    after(() => { pg.sql('drop table if exists public.liquidaciones cascade;'); });

    const liq = (orden, estado) => `insert into public.liquidaciones (orden_id, estado) values ('${orden}', '${estado}')
      on conflict (orden_id) do update set estado = excluded.estado;`;

    test('insertar y actualizar una liquidación emite 1 a la mesa de SU orden', () => {
      reiniciar();
      escribe(upsertOrden('o2', 2, 'abierta'));
      pg.limpiarSenales();
      escribe(liq('o2', 'pedida'));
      assert.deepEqual(topicos(), [t(2)]);
      escribe(liq('o2', 'presentada'));
      assert.deepEqual(topicos(), [t(2), t(2)]);
    });

    test('la mesa sale de la ORDEN: si la orden cambió de mesa, la señal va a la mesa nueva y no a la de antes', () => {
      reiniciar();
      escribe(upsertOrden('o1', 1, 'abierta') + liq('o1', 'pedida'));
      escribe("update public.ordenes set mesa_id = 3 where id = 'o1';");
      pg.limpiarSenales();
      escribe(liq('o1', 'presentada'));
      assert.deepEqual(topicos(), [t(3)], 'la liquidación no guarda mesa: la mesa vieja ya no es de esta cuenta');
    });

    test('la confirmación de una orden ya cerrada también llega a su mesa (confirmar_y_cerrar cierra y luego liquida)', () => {
      reiniciar();
      escribe(upsertOrden('o1', 1, 'abierta'));
      escribe(upsertOrden('o1', 1, 'cerrada', true));
      pg.limpiarSenales();
      escribe(liq('o1', 'confirmada'));
      assert.deepEqual(topicos(), [t(1)]);
    });

    test('borrar la orden abierta con su liquidación emite 1 (la del DELETE de la orden); la cascada no suma otra', () => {
      reiniciar();
      escribe(upsertOrden('o1', 1, 'abierta') + liq('o1', 'pedida'));
      pg.limpiarSenales();
      escribe("delete from public.ordenes where id = 'o1';");
      assert.deepEqual(topicos(), [t(1)]);
    });
  });

  // ── la reversa (va al final: deja la base sin la migración) ──

  test('la reversa mínima (las dos primeras líneas) corta las señales y las escrituras siguen igual; aplicar de nuevo las devuelve', () => {
    reiniciar();
    const minima = REVERSA.slice(0, 2).join('\n');
    const r = pg.sql(minima, { como: 'migrador' });
    assert.ok(r.ok, r.error);
    escribe(upsertOrden('o1', 1, 'abierta'));
    escribe(delta('o1', 'p1', 'Limonada', 5000, 1));
    escribe(`update public.mesas set token = '${TOKEN_NUEVO}' where id = 1;`);
    assert.deepEqual(topicos(), [], 'sin triggers no hay señales (la carta cae sola a sondeo)');
    assert.equal(pg.filas("select total::int as total from public.ordenes where id = 'o1'")[0].total, 5000);

    const otra = pg.aplicar(MIGRACION);
    assert.ok(otra.ok, otra.error);
    reiniciar();
    escribe(upsertOrden('o1', 1, 'abierta'));
    assert.deepEqual(topicos(), [t(1)]);
  });

  test('la reversa completa (las 5 líneas, tal como están comentadas) no deja rastro y no rompe el POS', () => {
    reiniciar();
    const r = pg.sql(REVERSA.join('\n'), { como: 'migrador' });
    assert.ok(r.ok, r.error);
    assert.equal(pg.filas("select count(*)::int as n from pg_namespace where nspname = 'privado'")[0].n, 0, 'sin el esquema');
    assert.equal(pg.filas("select count(*)::int as n from pg_trigger where tgname like '%emite_cuenta'")[0].n, 0);
    escribe(upsertOrden('o1', 1, 'abierta'));
    escribe(delta('o1', 'p1', 'Limonada', 5000, 1));
    escribe(upsertOrden('o1', 1, 'cerrada', true));
    assert.deepEqual(topicos(), []);
    const otra = pg.aplicar(MIGRACION);
    assert.ok(otra.ok, 'y la migración se puede volver a aplicar: ' + otra.error);
  });

  test('la reversa no se lleva lo que la fase 2 ponga en `privado`: el `drop schema` sin cascade falla y lo deja', () => {
    reiniciar();
    pg.sql('create table privado.personal (email text primary key); insert into privado.personal values (\'mesero@example.test\');', { como: 'migrador' });
    const r = pg.sql(REVERSA.join('\n'), { como: 'migrador' });
    assert.equal(r.ok, false);
    assert.match(r.error, /cannot drop schema privado because other objects depend on it/);
    assert.equal(pg.filas('select count(*)::int as n from privado.personal')[0].n, 1, 'la lista blanca del personal sigue ahí');
    assert.equal(pg.filas("select count(*)::int as n from pg_trigger where tgname like '%emite_cuenta'")[0].n, 0, 'pero las señales ya están cortadas');
  });
});
