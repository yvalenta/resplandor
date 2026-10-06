// «Servida»: supabase/migrations/20261006160000_servida.sql
// (pedido de Yonatan, 2026-10-06, tareas/2026-10-06-cronometro-mesa.md: «se le llevó la comida y ahí ya no necesita contar, solo informativo»).
//
// Qué cambia: UNA columna, `public.ordenes.servida_en timestamptz null` (la hora en que se sirvió la mesa; null = no servida). Nada más: ningún trigger, función, policy ni
// permiso; `normalizar_items`, `aplicar_delta_orden` y `ordenes_guardia` quedan como estaban. El POS la escribe con un update directo de esa columna.
//
// Dos partes, como migracion-precio-a-mano.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración (lo que dice, que solo agrega la columna, que es idempotente y se niega a correr sin cambiar nada si falta
//      `ordenes`, que su reversa nombra todo lo que crea) y que el POS la escriba con un update de esa sola columna a una cuenta abierta, sin mandarla jamás en el upsert de la fila.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker): la cadena COMPLETA de migraciones y esta encima, como `migrador`; y con personas de verdad (rol `authenticated` + claims
//      de Google): mesero y admin la escriben en una cuenta abierta, anon y las cuentas ajenas no, y un mesero no toca una cerrada; poner o quitar la marca NO sube la `version`
//      (el guardia la sube solo con los ítems), la marca sobrevive a un `+1` de ítems y a un cambio de precio, un cambio de ítems sigue subiendo la `version`; el eco de Realtime
//      la trae (la publicación no tiene lista de columnas que la deje fuera); la señal a la carta sale como con cualquier update; la migración dos veces, la reversa de la
//      cabecera y volver a aplicarla; se niega a correr, sin cambiar nada, si falta `ordenes` o si `servida_en` ya existe con otra forma.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal, topicoCuenta } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa } from './_cola-impresion-pg.mjs';

const MIGRACION = '20261006160000_servida.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${MIGRACION}`);
const POS = leer('pos.html');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CODIGO = sinComentarios(SQL);
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CP = compacto(CODIGO);
const SIN_BLOQUES = CP.replace(/do \$\$.*?end \$\$;/g, ' do $$…$$; ');
const SIN_TEXTOS = CP.replace(/'[^']*'/g, "''");   // sin lo que va entre comillas (el comentario de la columna habla de «update» y «ítems»)

// ───────────────────────── 1. estática ─────────────────────────

test('la migración va al final de la cadena y con un prefijo que ninguna otra usa (el SQL Editor y `supabase db push` ordenan por él)', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(nombres.includes(MIGRACION));
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  for (const previa of ['20260905000000_resplandor_base.sql', '20261002140000_permisos_por_rol.sql', '20261002180000_deshacer_cobro.sql', '20261006130000_precio_a_mano_promo_entera.sql']) {
    assert.ok(nombres.includes(previa) && previa < MIGRACION, `${previa} tiene que ir antes`);
  }
  assert.ok(nombres.slice(nombres.indexOf(MIGRACION) + 1).every((n) => n > MIGRACION));
});

test('la cabecera dice lo que hace, por qué no sube la version, quién la escribe, qué necesita, cómo se deshace, en qué orden sale y que la aplica Yonatan', () => {
  const cab = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos'));
  for (const frase of [
    'servida_en', 'timestamptz null', 'update directo de esa columna', '`version` NO sube', '`updated_at` sí avanza', 'ordenes_editar', 'supabase_realtime', 'payload.new.servida_en',
    'ordenes_emite_cuenta', 'normalizar_items', 'aplicar_delta_orden', 'ordenes_guardia', 'Edge Function `cuenta`', 'segunda tanda', 'quitar', 'PGRST204', '42703',
    'REVERSA (menos de 1 minuto', 'lo aplica Yonatan: aparca', 'Idempotente', 'Orden de salida', 'public.ordenes',
  ]) assert.ok(cab.includes(frase), `la cabecera no dice «${frase}»`);
});

test('solo agrega la columna: nada de funciones, triggers, policies, grants ni datos; con la columna, su comentario, el aviso a PostgREST y dos comprobaciones', () => {
  assert.equal((SIN_BLOQUES.match(/alter table public\.ordenes add column if not exists servida_en timestamp with time zone;/g) || []).length, 1);
  assert.doesNotMatch(SIN_TEXTOS, /create (or replace )?(function|trigger|policy|view|table|index)|\bgrant\b|\brevoke\b|\bdrop\b|\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b|enable row level|publication/i);
  assert.match(SIN_BLOQUES, /comment on column public\.ordenes\.servida_en is '[^']+';/);
  assert.match(SIN_BLOQUES, /notify pgrst, 'reload schema';/);
  assert.equal((CODIGO.match(/do \$\$/g) || []).length, 2, 'dos comprobaciones: la de antes y la de después');
  assert.doesNotMatch(SIN_BLOQUES, /add column if not exists servida_en [^;]*default/i, 'sin valor por omisión: una cuenta nueva nace sin marca');
});

test('se niega a correr, sin cambiar nada, si falta public.ordenes, y lo comprueba ANTES de crear nada; y comprueba al final que la columna quedó como se dijo', () => {
  const requisitos = CODIGO.slice(0, CODIGO.indexOf('alter table public.ordenes add column'));
  assert.match(requisitos, /to_regclass\('public\.ordenes'\) is null[\s\S]*Falta public\.ordenes[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bgrant\b/i);
  const fin = CODIGO.slice(CODIGO.lastIndexOf('do $$'));
  assert.match(fin, /data_type = 'timestamp with time zone' and is_nullable = 'YES' and column_default is null/);
  assert.match(fin, /raise exception 'ordenes\.servida_en no quedó como debe/);
});

test('la reversa de la cabecera borra la columna y avisa a PostgREST, y nada más', () => {
  assert.equal(compacto(reversa(SQL)), "begin; alter table public.ordenes drop column if exists servida_en; notify pgrst, 'reload schema'; commit;");
});

test('el POS la escribe con un update de ESA columna a una cuenta ABIERTA, y su fila de upsert (formatOrden) nunca la manda: una tablet con la copia vieja no pisa la marca de otra', () => {
  assert.match(POS, /supabaseClient\.from\('ordenes'\)\.update\(\{ servida_en: p\.valor \}\)\.eq\('id', id\)\.eq\('estado', 'abierta'\)\.select\('id'\)/);
  const formatOrden = POS.slice(POS.indexOf('formatOrden(o) {'), POS.indexOf('formatMesa(m) {'));
  assert.ok(formatOrden.length > 200, 'no encontré formatOrden');
  assert.doesNotMatch(formatOrden.replace(/\/\/.*$/gm, ''), /servida/i, 'formatOrden no sabe de la marca');
  assert.match(POS, /esColumnaInexistente\(e\)\) \{ this\._sinColumnaServida\(\); return false; \}/, 'sin la columna el POS esconde el toque');
  assert.match(POS, /tiene\('servida_en'\)/, 'y la detecta con una lectura de cero filas, como las otras columnas');
});

test('la carta del cliente no la ve: la Edge Function `cuenta` lee `ordenes` por nombre de columna (nunca `*`), y la marca de la carta es la `version`, que la marca «servida» no mueve', () => {
  const cuenta = leer('supabase/functions/cuenta/index.ts');
  const lectura = cuenta.match(/\.from\("ordenes"\)\s*\.select\("([^"]+)"\)/);
  assert.ok(lectura, 'no encuentro la lectura de ordenes de la función cuenta');
  assert.deepEqual(lectura[1].split(',').map((c) => c.trim()), ['id', 'items', 'total', 'abierta_en', 'updated_at', 'version']);
  assert.match(cuenta, /marca: marcaCuenta\(orden\.version\)/);
  assert.doesNotMatch(cuenta, /servida/i);
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;
const TOKEN_71 = 'a'.repeat(48);

describe('contra un Postgres 17 desechable (Supabase simulado, cadena completa de migraciones)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  let despues;
  const avisos = [];
  const sql = (texto, opciones) => {
    const r = pg.sql(texto, opciones);
    for (const a of r.avisos) avisos.push(`${a}  ←  ${compacto(texto).slice(0, 90)}`);
    assert.ok(r.ok, r.error);
    return r;
  };
  const claims = (clave) => {
    const g = pg.filas(`select id, email, provider from t.gente where clave = ${literal(clave)}`)[0];
    return { sub: g.id, role: 'authenticated', email: g.email, app_metadata: { provider: g.provider } };
  };
  const como = (clave) => (clave === 'anon' || clave === 'service_role' ? { como: clave, claims: { role: clave } } : { como: 'authenticated', claims: claims(clave) });
  const orden = (id) => pg.filas(`select items, total, version, servida_en, updated_at, estado from public.ordenes where id = ${literal(id)}`)[0];
  /** Cuántas filas tocó el update de la marca, como esa persona (la RLS esconde las que no puede tocar: 0 filas, sin error). */
  const marcar = (clave, id, valor) => {
    const v = valor === null ? 'null' : literal(valor);
    const r = pg.sql(`with u as (update public.ordenes set servida_en = ${v} where id = ${literal(id)} and estado = 'abierta' returning id) select count(*) from u;`, como(clave));
    for (const a of r.avisos) avisos.push(`${a}  ←  marcar`);
    return { ok: r.ok, filas: r.ok ? Number(String(r.salida).trim().split('\n').pop()) : null, error: r.error };
  };
  const delta = (id, producto, nombre, precio, n) => {
    const r = pg.sql(`select coalesce(json_agg(to_jsonb(t)), '[]'::json) from (select items, total, version from public.aplicar_delta_orden(${literal(id)}, ${literal(producto)}, ${literal(nombre)}, ${precio}, ${n}, '')) t;`, como('mesero'));
    if (!r.ok) throw new Error(r.error);
    return JSON.parse(String(r.salida).trim().split('\n').pop())[0];
  };
  const abrir = (id, mesa) => sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', '[]', 0, now());`);

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 15 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    antes = radiografia(pg);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, `la migración no se aplicó: ${mia[0].error}`);
    assert.deepEqual(mia[0].avisos, [], 'aplicarla no deja ni un WARNING');
    despues = radiografia(pg);
    sql(`insert into public.personal (email, nombre, rol) values ('mesero1@resplandor.test', 'Mesero Prueba', 'mesero') on conflict (email) do nothing;`);
    sql(`
      insert into public.productos (id, categoria, nombre, precio, activo) values ('t-ej1','Ejecutivos','Menú Resplandor',23000,true), ('t-be2','Bebidas','Cerveza',10000,true);
      insert into public.mesas (id, capacidad, estado, token) values (71,4,'ocupada',${literal(TOKEN_71)}),(72,4,'ocupada',repeat('b',48)),(73,4,'ocupada',repeat('c',48)),(74,4,'ocupada',repeat('d',48));
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('la columna existe como se dijo: timestamptz, admite null, sin valor por omisión, con su comentario; una cuenta nueva y las que había nacen sin marca', () => {
    const c = pg.filas("select data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'ordenes' and column_name = 'servida_en'");
    assert.deepEqual(c, [{ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null }]);
    assert.match(pg.filas("select col_description('public.ordenes'::regclass, (select attnum from pg_attribute where attrelid = 'public.ordenes'::regclass and attname = 'servida_en')) as c")[0].c, /Cuándo se sirvió la comida/);
    abrir('t-nueva', 71);
    assert.equal(orden('t-nueva').servida_en, null);
    sql("delete from public.ordenes where id = 't-nueva';");
  });

  test('agrega SOLO la columna: ninguna tabla, vista, policy, trigger, restricción, publicación, función ni permiso cambia (normalizar_items, aplicar_delta_orden y ordenes_guardia, byte a byte)', () => {
    for (const seccion of Object.keys(antes)) assert.deepEqual(despues[seccion], antes[seccion], `${seccion}: cambió`);
    for (const f of ['normalizar_items', 'aplicar_delta_orden', 'ordenes_guardia']) {
      assert.ok(despues.funciones.some((d) => d.proname === f), `no encuentro ${f}`);
    }
  });

  test('quién la escribe: el mesero y el admin en una cuenta abierta; anon, una cuenta de Google fuera de `personal`, una pendiente y una sesión por correo no; un mesero no toca una cuenta cerrada', () => {
    abrir('t-p1', 71);
    delta('t-p1', 't-ej1', 'Menú Resplandor', 23000, 1);
    const quien = (clave) => marcar(clave, 't-p1', '2026-10-06T17:41:00Z');
    const anon = quien('anon');
    assert.ok(!anon.ok && /permission denied|42501/i.test(anon.error), `anon: ${anon.error}`);
    for (const clave of ['ajena', 'correo', 'pendiente']) {
      const r = quien(clave);
      assert.ok(!r.ok || r.filas === 0, `${clave} pudo marcar`);
    }
    assert.equal(orden('t-p1').servida_en, null, 'nada cambió');
    const m = marcar('mesero', 't-p1', '2026-10-06T17:41:00Z');
    assert.ok(m.ok, m.error);
    assert.equal(m.filas, 1);
    assert.equal(new Date(orden('t-p1').servida_en).toISOString(), '2026-10-06T17:41:00.000Z');
    const a = marcar('admin', 't-p1', null);
    assert.ok(a.ok && a.filas === 1, a.error);
    assert.equal(orden('t-p1').servida_en, null, 'el admin la quitó');
    // una cuenta CERRADA: el mesero no la ve para editar (0 filas), el admin sí puede (y el POS ni lo intenta: pide estado = 'abierta')
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now(), servida_en = '2026-10-06T17:00:00Z' where id = 't-p1';");
    const c = pg.sql("with u as (update public.ordenes set servida_en = null where id = 't-p1' returning id) select count(*) from u;", como('mesero'));
    assert.ok(c.ok);
    assert.equal(String(c.salida).trim().split('\n').pop(), '0', 'un mesero no toca una cuenta cerrada');
    assert.equal(new Date(orden('t-p1').servida_en).toISOString(), '2026-10-06T17:00:00.000Z');
  });

  test('NO sube la version (el guardia la sube solo con los ítems), sí avanza updated_at, y no toca los ítems ni el total; quitar la marca tampoco', () => {
    abrir('t-v1', 72);
    const o0 = delta('t-v1', 't-ej1', 'Menú Resplandor', 23000, 2);
    const antesFila = orden('t-v1');
    const r = marcar('mesero', 't-v1', '2026-10-06T17:41:00Z');
    assert.ok(r.ok && r.filas === 1, r.error);
    const marcada = orden('t-v1');
    assert.equal(marcada.version, o0.version, 'poner la marca no sube la version');
    assert.deepEqual(marcada.items, antesFila.items);
    assert.equal(Number(marcada.total), Number(antesFila.total));
    assert.ok(Date.parse(marcada.updated_at) >= Date.parse(antesFila.updated_at), 'updated_at avanza (trg_ordenes_updated_at: todo update lo toca)');
    marcar('mesero', 't-v1', null);
    assert.equal(orden('t-v1').version, o0.version, 'quitarla tampoco');
    assert.equal(orden('t-v1').servida_en, null);
  });

  test('la marca sobrevive a un «+1» de ítems y a un cambio de precio en Productos (no es un ítem: normalizar_items no la ve); un cambio de ítems SIGUE subiendo la version', () => {
    marcar('mesero', 't-v1', '2026-10-06T17:41:00Z');
    const v0 = orden('t-v1').version;
    const o = delta('t-v1', 't-ej1', 'Menú Resplandor', 23000, 1);
    assert.equal(o.version, v0 + 1, 'los ítems siguen subiendo la version (el guardia no cambió)');
    assert.equal(new Date(orden('t-v1').servida_en).toISOString(), '2026-10-06T17:41:00.000Z', 'la marca sigue ahí tras un +1');
    sql("update public.productos set precio = 25000 where id = 't-ej1';");
    const tras = orden('t-v1');
    assert.equal(new Date(tras.servida_en).toISOString(), '2026-10-06T17:41:00.000Z', 'y tras el precio vivo');
    assert.equal(Number(tras.items.find((i) => i.id === 't-ej1').precio), 25000, 'el precio vivo sigue funcionando');
    sql("update public.productos set precio = 23000 where id = 't-ej1';");
    // el POS la quita a mano cuando agrega ítems: dos escrituras, y cada una hace lo suyo
    marcar('mesero', 't-v1', null);
    assert.equal(orden('t-v1').servida_en, null);
  });

  test('el eco de Realtime la trae: `ordenes` está en supabase_realtime SIN lista de columnas (la nueva entra sola) y el UPDATE emite el cambio con ella', () => {
    const pub = pg.filas("select tablename, attnames::text as columnas, rowfilter from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ordenes'");
    assert.equal(pub.length, 1, '`ordenes` está en supabase_realtime');
    assert.match(pub[0].columnas, /servida_en/, 'la publicación incluye la columna nueva');
    assert.equal(pub[0].rowfilter, null);
    const lista = pg.filas("select r.prattrs is null as sin_lista from pg_publication_rel r join pg_publication p on p.oid = r.prpubid where p.pubname = 'supabase_realtime' and r.prrelid = 'public.ordenes'::regclass");
    assert.deepEqual(lista, [{ sin_lista: true }], 'sin lista de columnas: toda columna nueva viaja');
  });

  test('la señal a la carta sale con este UPDATE como con cualquier otro de una cuenta abierta (vacía: la carta vuelve a leer `cuenta`, que no cambió)', () => {
    abrir('t-s1', 71);
    delta('t-s1', 't-ej1', 'Menú Resplandor', 23000, 1);
    pg.limpiarSenales();
    const r = marcar('mesero', 't-s1', '2026-10-06T17:41:00Z');
    assert.ok(r.ok && r.filas === 1, r.error);
    assert.deepEqual(pg.senales(), [topicoCuenta(TOKEN_71)]);
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 't-s1';");
  });

  test('ninguna de las escrituras de arriba dejó un WARNING (los triggers tragan errores, pero no los hubo)', () => {
    assert.deepEqual(avisos, []);
  });

  test('aplicarla dos veces es inocua: el catálogo queda idéntico y las cuentas (y sus marcas) no cambian', () => {
    const cuentas = () => pg.filas('select id, items, total, version, servida_en from public.ordenes order by id');
    const antesCuentas = cuentas();
    const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(otra.length, 1);
    assert.ok(otra[0].ok, otra[0].error);
    assert.deepEqual(otra[0].avisos, [], 'la segunda aplicación no deja WARNING');
    assert.deepEqual(radiografia(pg), despues);
    assert.deepEqual(cuentas(), antesCuentas);
  });

  test('se niega a correr, sin cambiar nada, si falta public.ordenes, o si `servida_en` ya existe con otra forma', () => {
    const sinOrdenes = pg.sql(`begin;\nalter table public.ordenes rename to ordenes_ausente;\n${SQL}\ncommit;`, { como: 'migrador' });
    assert.equal(sinOrdenes.ok, false);
    assert.match(sinOrdenes.error, /Falta public\.ordenes.*No se cambió nada/s);
    assert.equal(pg.filas("select to_regclass('public.ordenes') is not null as hay")[0].hay, true, 'la transacción cayó entera: la tabla sigue con su nombre');
    const otraForma = pg.sql(`begin;\nalter table public.ordenes drop column servida_en;\nalter table public.ordenes add column servida_en text;\n${SQL}\ncommit;`, { como: 'migrador' });
    assert.equal(otraForma.ok, false);
    assert.match(otraForma.error, /servida_en no quedó como debe.*No se cambió nada/s);
    assert.equal(pg.filas("select data_type from information_schema.columns where table_schema = 'public' and table_name = 'ordenes' and column_name = 'servida_en'")[0].data_type, 'timestamp with time zone', 'tras el rechazo, la columna es la de siempre');
  });

  test('la reversa de la cabecera corre en limpio y deja el catálogo como ANTES; reaplicar la migración lo deja como después (con las cuentas intactas)', () => {
    const r = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(r.ok, 'la reversa falló: ' + r.error);
    assert.equal(pg.filas("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'ordenes' and column_name = 'servida_en'")[0].n, 0, 'la columna se fue');
    const ahora = radiografia(pg);
    for (const [seccion, filas] of Object.entries(antes)) assert.deepEqual(ahora[seccion], filas, `tras la reversa quedó distinto: ${seccion}`);
    // sin la columna las cuentas siguen funcionando: un +1 de ítems y su lectura
    const o = delta('t-v1', 't-ej1', 'Menú Resplandor', 23000, 1);
    assert.ok(o.version > 0);
    const reaplicada = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.ok(reaplicada[0].ok, 'no se pudo volver a aplicar tras la reversa: ' + reaplicada[0].error);
    assert.deepEqual(reaplicada[0].avisos, []);
    assert.deepEqual(radiografia(pg), despues, 'reaplicar tras la reversa deja el catálogo como la primera vez');
    assert.equal(orden('t-v1').servida_en, null, 'la marca de antes se fue con la columna (solo informaba)');
  });
});
