// El pago con Bre-B: supabase/migrations/20261003150000_pago_breb.sql
// («en la funcionalidad para pagar hazlo dinámico y si selecciona pagar, abrir QR de Bre-B»: la llave y el contenido del QR los
// carga el admin en `ajustes` y la Edge Function `cuenta` los entrega SOLO con una cuenta abierta y el interruptor encendido).
//
// (Refutación 2026-10-02, R2: la llave que se muestra tiene que ser la que COBRA el QR, y la base lo exige: privado.emv_llave y el CHECK ajustes_pago_breb_qr_llave.)
//
// Dos partes, como migracion-cola-impresion.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. Las tres columnas y su definición, los siete CHECK, la
//      función del CRC (inmutable, search_path vacío, sin SECURITY DEFINER), los permisos (service_role SOLO las cuatro columnas,
//      anon nada, la función solo para authenticated), que no toque ninguna policy, que sea idempotente, que la reversa nombre TODO
//      lo que crea y que no haya ningún dato de pago escrito (el repo es público).
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker, ver _supabase-simulado.mjs): la cadena COMPLETA de migraciones del repo
//      (con la cola de impresión) y esta encima, como `migrador`, que no es superusuario; y las baterías SQL de
//      scripts/pruebas/sql/pago-breb/:
//         10 checks    llave mala, QR sin 000201, CRC malo, caracteres raros, largo (con los bordes de 20 y 700), el «completo», y que
//                      lo demás de `ajustes` siga igual
//         20 permisos  la matriz admin · mesero · ajena · pendiente · eliminado · cuenta por correo · anon · service_role, por
//                      columna, y el catálogo (ni Realtime ni `carta_publica` ven la llave ni el QR)
//      más: la función `cuenta` CORRIDA contra esa base real con el rol service_role (es la prueba de que sin el GRANT por columna el
//      QR nunca llegaría a la carta), que el CRC de SQL y el de JS dicen lo mismo con cientos de contenidos, la migración dos veces,
//      la reversa comentada de la cabecera y volver a aplicarla, y que se niegue a correr sin cambiar nada si falta `ajustes` o `privado`.
//
// TODO dato de pago de aquí es FICTICIO (_pago-breb-vectores.mjs). El real vive fuera del repo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import {
  RAIZ, DIR_MIGRACIONES, MIGRACION as COLA,
  prepararSimulacion, aplicarMigraciones, radiografia, reversa,
} from './_cola-impresion-pg.mjs';
import { cargarFuncion, importarModulo } from './_funcion-simulada.mjs';
import { basePostgres } from './_funcion-pg.mjs';
import {
  QR_FICTICIO, QR_FICTICIO_2, LLAVE_FICTICIA, LLAVES_BUENAS, LLAVES_MALAS, TOKEN_MESA_3, TOKEN_MESA_4,
  qrMalos, qrDeLargo, corromper, conCrc, tlv, cuerpoFicticio, llaveQrVectores,
} from './_pago-breb-vectores.mjs';

const MIGRACION = '20261003150000_pago_breb.sql';
const REL = `supabase/migrations/${MIGRACION}`;
const SQL = fs.readFileSync(path.join(RAIZ, REL), 'utf8');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CODIGO = sinComentarios(SQL);
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CP = compacto(CODIGO);
const DIR_PAGO = path.join(RAIZ, 'scripts/pruebas/sql/pago-breb');
const mesa = await importarModulo('supabase/functions/_compartido/mesa.js');
const { emvCrcOk, llaveBrebValida, llaveDelQrBreb } = mesa;

// ───────────────────────── 1. estática ─────────────────────────

test('la migración va después de todas las anteriores (la cola de impresión incluida), con prefijo único, y nada se cuela en medio', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(nombres.includes(MIGRACION));
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.ok(COLA < MIGRACION && '20261002170000_ajustes_ticket.sql' < MIGRACION && '20261001120000_cuenta_en_vivo.sql' < MIGRACION);
  assert.ok(nombres.slice(nombres.indexOf(MIGRACION) + 1).every((n) => n > MIGRACION));
});

test('la cabecera dice lo que hace, quién ve qué, qué necesita, cómo se deshace y que el dato real NO va aquí', () => {
  const cab = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos'));
  for (const frase of [
    'pago_breb_visible', 'pago_breb_llave', 'pago_breb_qr', 'privado.emv_crc_ok', 'CRC-16/CCITT-FALSE', '«000201»', 'ajustes_pago_breb_completo',
    'service_role', 'REVERSA (menos de 1 minuto', 'lo aplica Yonatan: aparca', 'NO va en esta migración ni en ningún archivo del repo',
    '20261002170000_ajustes_ticket.sql', 'Idempotente', 'carta_publica', 'cuenta ABIERTA',
  ]) assert.ok(cab.includes(frase), `la cabecera no dice «${frase}»`);
});

test('las tres columnas, exactamente: boolean NOT NULL default false, y dos text que admiten null; con su comentario', () => {
  assert.match(CP, /alter table public\.ajustes add column if not exists pago_breb_visible boolean not null default false;/);
  assert.match(CP, /alter table public\.ajustes add column if not exists pago_breb_llave text;/);
  assert.match(CP, /alter table public\.ajustes add column if not exists pago_breb_qr text;/);
  for (const c of ['pago_breb_visible', 'pago_breb_llave', 'pago_breb_qr']) assert.match(CP, new RegExp(`comment on column public\\.ajustes\\.${c} is`), `comentario de ${c}`);
});

test('los ocho CHECK: nombres, reglas y que se reponen sin pisar datos (drop if exists + add en UNA sentencia)', () => {
  const nombres = ['llave_forma', 'llave_segura', 'qr_largo', 'qr_inicio', 'qr_ascii', 'qr_crc', 'qr_llave', 'completo'];
  for (const n of nombres) {
    assert.match(CP, new RegExp(`drop constraint if exists ajustes_pago_breb_${n}, add constraint ajustes_pago_breb_${n} check \\(`), `ajustes_pago_breb_${n}`);
  }
  assert.equal((CP.match(/add constraint ajustes_pago_breb_/g) || []).length, 8, 'ni uno más ni uno menos');
  assert.match(CP, /length\(pago_breb_llave\) between 2 and 60/);
  assert.match(CP, /\^@\[A-Za-z0-9\._-\]\{1,59\}\$/);
  assert.match(CP, /\^\[0-9\]\{5,20\}\$/);
  assert.match(CP, /\^\\\+57\[0-9\]\{10\}\$/);
  assert.match(CP, /pago_breb_llave !~ '\[\\s<>"''`\\\\\]'/, 'sin espacios ni < > " \' ` \\');
  assert.match(CP, /length\(pago_breb_qr\) between 20 and 700/);
  assert.match(CP, /left\(pago_breb_qr, 6\) = '000201'/);
  assert.match(CP, /pago_breb_qr ~ '\^\[ -~\]\+\$'/, 'solo ASCII imprimible');
  assert.match(CP, /pago_breb_qr is null or privado\.emv_crc_ok\(pago_breb_qr\)/);
  assert.match(CP, /not pago_breb_visible or \(pago_breb_llave is not null and pago_breb_qr is not null\)/);
  // la llave que se muestra es la que cobra el QR; con el QR mal formado la función da null y coalesce lo vuelve false (un CHECK deja pasar el null a secas)
  assert.match(CP, /pago_breb_llave is null or pago_breb_qr is null or coalesce\(privado\.emv_llave\(pago_breb_qr\) = pago_breb_llave, false\)/);
  // «qr_llave» y no «llave_qr»: en orden alfabético va DESPUÉS de llave_forma y de qr_crc, así que una llave o un QR malos se reportan por su propio CHECK
  assert.ok('ajustes_pago_breb_llave_forma' < 'ajustes_pago_breb_qr_llave' && 'ajustes_pago_breb_qr_crc' < 'ajustes_pago_breb_qr_llave' && 'ajustes_pago_breb_qr_inicio' < 'ajustes_pago_breb_qr_llave');
  // cada CHECK deja pasar el null (sin QR cargado no hay nada que validar)
  for (const n of ['llave_forma', 'llave_segura', 'qr_largo', 'qr_inicio', 'qr_ascii', 'qr_crc', 'qr_llave']) {
    const m = CP.match(new RegExp(`add constraint ajustes_pago_breb_${n} check \\( (pago_breb_\\w+) is null or`));
    assert.ok(m, `${n}: admite null`);
  }
});

test('privado.emv_crc_ok: inmutable, search_path vacío, sin SECURITY DEFINER, devuelve boolean; polinomio 0x1021, inicio 0xFFFF, y no falla con null', () => {
  const f = CP.match(/create or replace function privado\.emv_crc_ok\(p_contenido text\) returns boolean language plpgsql immutable parallel safe set search_path = '' as \$function\$ (.*?) \$function\$;/);
  assert.ok(f, 'firma y atributos');
  const cuerpo = f[1];
  assert.doesNotMatch(CP, /emv_crc_ok\(p_contenido text\)[^$]*security definer/, 'no es SECURITY DEFINER: no lee nada');
  assert.match(cuerpo, /v_crc\s+integer := 65535/);
  assert.match(cuerpo, /# 4129/, 'polinomio 0x1021');
  assert.match(cuerpo, /& 32768/);
  assert.match(cuerpo, /if p_contenido is null then return false; end if;/);
  assert.match(cuerpo, /v_n > 1024/, 'no calcula con contenidos enormes');
  assert.match(cuerpo, /substr\(p_contenido, v_ultimo, 4\) <> '6304'/);
  assert.doesNotMatch(cuerpo, /\b(from|join|into|update|delete from|insert into)\s+(public|privado)\./, 'no toca ninguna tabla');
});

test('privado.emv_llave: inmutable, search_path vacío, sin SECURITY DEFINER, devuelve text; lee campos (no busca texto) y exige UN solo 26, UN solo 00 «CO.COM.RBM.LLA» y UN solo 04', () => {
  const f = CP.match(/create or replace function privado\.emv_llave\(p_contenido text\) returns text language plpgsql immutable parallel safe set search_path = '' as \$function\$ (.*?) \$function\$;/);
  assert.ok(f, 'firma y atributos');
  const cuerpo = f[1];
  assert.doesNotMatch(CP, /emv_llave\(p_contenido text\)[^$]*security definer/, 'no es SECURITY DEFINER: no lee nada');
  assert.match(cuerpo, /if p_contenido is null then return null; end if;/);
  assert.match(cuerpo, /v_n > 1024/, 'no calcula con contenidos enormes');
  assert.match(cuerpo, /substr\(p_contenido, v_pos, 2\) = '26'/, 'el campo 26');
  assert.match(cuerpo, /v_stag = '00'[\s\S]*v_stag = '04'/, 'los subcampos 00 y 04');
  assert.match(cuerpo, /v_campos <> 1 or v_sred <> 1 or v_s04 <> 1 then return null/, 'uno solo de cada uno: lo ambiguo no cuenta');
  assert.match(cuerpo, /v_red <> 'CO\.COM\.RBM\.LLA' then return null/);
  assert.doesNotMatch(cuerpo, /\b(position|strpos|like|ilike)\b|\bin\b\s+p_contenido/i, 'no busca la llave como texto suelto: lee los campos');
  assert.doesNotMatch(cuerpo, /\b(from|join|into|update|delete from|insert into)\s+(public|privado)\./, 'no toca ninguna tabla');
});

test('permisos: la función solo para authenticated; service_role SOLO SELECT de las cuatro columnas; anon nada; ninguna policy tocada', () => {
  assert.match(CP, /revoke all on function privado\.emv_crc_ok\(text\) from public, anon, authenticated, service_role;/);
  assert.match(CP, /revoke all on function privado\.emv_llave\(text\) from public, anon, authenticated, service_role;/);
  const grants = [...CP.matchAll(/grant ([^;]+?) on ([^;]+?) to ([^;]+);/g)].map((m) => `${m[1]} | ${m[2]} | ${m[3]}`).sort();
  assert.deepEqual(grants, [
    'execute | function privado.emv_crc_ok(text) | authenticated',
    'execute | function privado.emv_llave(text) | authenticated',
    'select (id, pago_breb_visible, pago_breb_llave, pago_breb_qr) | public.ajustes | service_role',
    'usage | schema privado | authenticated',
  ].sort());
  assert.match(CP, /revoke all on public\.ajustes from anon, service_role;/);
  assert.doesNotMatch(CP, /\bgrant [^;]*\banon\b/, 'nada para anon');
  assert.doesNotMatch(CP, /\bgrant (all|insert|update|delete|truncate|references)[^;]*service_role/, 'service_role no escribe');
  assert.doesNotMatch(CP, /(create|drop|alter) policy/, 'esta migración no toca ninguna policy: las de ajustes son las de siempre');
  assert.doesNotMatch(CP, /enable row level security|disable row level security|publication/, 'ni la RLS ni Realtime');
  assert.doesNotMatch(CP, /carta_publica/, 'la vista pública ni se menciona en el código');
});

test('se niega a correr, sin cambiar nada, si falta la tabla ajustes o el esquema privado (y lo comprueba ANTES de crear nada)', () => {
  const requisitos = CODIGO.slice(0, CODIGO.indexOf('create or replace function privado.emv_crc_ok'));
  assert.match(requisitos, /to_regclass\('public\.ajustes'\) is null[\s\S]*Falta 20261002170000_ajustes_ticket\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /to_regnamespace\('privado'\) is null[\s\S]*Falta el esquema privado[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bgrant\b/i);
});

test('idempotente: columnas «if not exists», CHECK «drop if exists + add», función «create or replace»; nada que pise lo cargado', () => {
  assert.equal((CP.match(/add column if not exists/g) || []).length, 3);
  assert.doesNotMatch(CP, /\b(update|insert into|delete from|truncate)\b/i, 'no escribe datos');
  assert.doesNotMatch(CP, /drop (table|column|function)/i, 'no borra nada');
});

test('la reversa de la cabecera nombra TODO lo que crea (las tres columnas, las dos funciones y el permiso de service_role) y no toca `usage on schema privado`', () => {
  const r = reversa(SQL);
  const rc = compacto(r);
  assert.match(rc, /^begin; /);
  assert.match(rc, / commit;$/);
  for (const c of ['pago_breb_visible', 'pago_breb_llave', 'pago_breb_qr']) assert.match(rc, new RegExp(`alter table public\\.ajustes drop column if exists ${c};`), c);
  assert.match(rc, /drop function if exists privado\.emv_crc_ok\(text\);/);
  assert.match(rc, /drop function if exists privado\.emv_llave\(text\);/);
  assert.match(rc, /revoke select \(id\) on public\.ajustes from service_role;/);
  assert.doesNotMatch(rc, /usage on schema/, 'otras migraciones usan ese permiso');
  assert.ok(rc.indexOf('drop column if exists pago_breb_visible') < rc.indexOf('drop function'), 'primero las columnas (sus CHECK usan la función), luego la función');
});

test('ni la migración, ni los vectores, ni las baterías, ni las pruebas, ni la función traen una llave o un contenido de QR reales: solo los ficticios', () => {
  // Un QR de Bre-B real trae los subcampos «CO.COM.RBM.*» con valores propios del local. Aquí ninguno está escrito a mano: los de prueba
  // se ARMAN con tlv() y sus valores son «XXX», ceros y «PRUEBA-FICTICIA».
  const archivos = [
    REL, 'scripts/pruebas/_pago-breb-vectores.mjs', 'scripts/pruebas/_funcion-pg.mjs', 'scripts/pruebas/migracion-pago-breb.test.mjs',
    'scripts/pruebas/fn-cuenta-pago.test.mjs', 'supabase/functions/cuenta/index.ts', 'supabase/functions/_compartido/mesa.js',
    ...fs.readdirSync(DIR_PAGO).map((f) => `scripts/pruebas/sql/pago-breb/${f}`),
  ];
  for (const rel of archivos) {
    const t = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    assert.ok(!/0014CO\.COM\.RBM/.test(t), `${rel}: un subcampo de QR de Bre-B escrito a mano`);
    assert.ok(!/0002010102\d\d26\d\d/.test(t), `${rel}: un contenido de QR escrito a mano`);
  }
  // Los ficticios dicen que lo son.
  assert.ok(QR_FICTICIO.includes('PRUEBA-FICTICIA') && LLAVE_FICTICIA.includes('Ficticia'));
  assert.ok(QR_FICTICIO.includes('CO.COM.RBM.CU' + '0108' + '00000000'));
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;
const HAY_TS = Boolean(process.features?.typescript);
const FUNCION = 'supabase/functions/cuenta/index.ts';
const ORIGEN = 'https://resplandor.ynt.codes';
const MINIMO = { '10-checks.sql': 130, '20-permisos.sql': 58 };

/** Un generador pseudoaleatorio con semilla (las pruebas son reproducibles). */
function azar(semilla) {
  let s = semilla >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Corre un archivo de sql/pago-breb/ y devuelve lo que anotó en t.res desde antes de correrlo. */
function correr(pg, archivo) {
  const desde = Number(pg.filas('select coalesce(max(n), 0) as n from t.res')[0].n);
  const r = pg.sql(fs.readFileSync(path.join(DIR_PAGO, archivo), 'utf8'));
  const resultados = pg.filas(`select nombre, ok, detalle from t.res where n > ${desde} order by n`);
  return { ok: r.ok, error: r.error, avisos: r.avisos, resultados, fallan: resultados.filter((x) => !x.ok) };
}

/** Los vectores ficticios, a la base (tablas t.*): los arma Node con otra implementación del CRC. */
function cargarVectores(pg) {
  const valores = (filas) => filas.map((f) => `(${f.map((x) => (x === null ? 'null' : literal(x))).join(', ')})`).join(', ');
  const r = pg.sql(`
    truncate t.qr_malos, t.llaves_buenas, t.llaves_malas, t.llave_qr_vectores restart identity;
    insert into t.qr_malos (nombre, valor, restriccion) values ${valores(qrMalos())};
    insert into t.llave_qr_vectores (nombre, qr, esperada, llave_a_guardar, guardar_esperado) values ${valores(llaveQrVectores())};
    insert into t.llaves_buenas (valor) values ${LLAVES_BUENAS.map((l) => `(${literal(l)})`).join(', ')};
    insert into t.llaves_malas (nombre, valor) values ${valores(LLAVES_MALAS)};
    select t.g('qr_ok', ${literal(QR_FICTICIO)});
    select t.g('qr_ok2', ${literal(QR_FICTICIO_2)});
    select t.g('qr_20', ${literal(qrDeLargo(20))});
    select t.g('qr_700', ${literal(qrDeLargo(700))});
    select t.g('qr_minusculas', ${literal(QR_FICTICIO.slice(0, -4) + QR_FICTICIO.slice(-4).toLowerCase())});
  `);
  if (!r.ok) throw new Error('no se cargaron los vectores: ' + r.error);
}

describe('contra un Postgres 17 desechable (Supabase simulado, cadena completa de migraciones)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  let despues;
  const avisosDe = {};

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: MIGRACION });
    assert.ok(previas.length >= 13 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    antes = radiografia(pg);
    const mia = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(mia.length, 1);
    assert.ok(mia[0].ok, `la migración no se aplicó: ${mia[0].error}`);
    assert.deepEqual(mia[0].avisos, [], 'aplicarla no deja ni un WARNING');
    despues = radiografia(pg);
    const r = pg.sql(fs.readFileSync(path.join(DIR_PAGO, '00-partida.sql'), 'utf8'));
    assert.ok(r.ok, 'ayudantes: ' + r.error);
    cargarVectores(pg);
  }, { timeout: 300000 });

  after(() => { if (pg) pg.parar(); });

  test('agrega SOLO lo suyo: dos funciones, ocho CHECK y el permiso por columna de service_role; nada de lo que había cambia', () => {
    const clave = (f) => JSON.stringify(f);
    for (const [seccion, filas] of Object.entries(antes)) {
      const ahora = new Set(despues[seccion].map(clave));
      for (const f of filas) assert.ok(ahora.has(clave(f)), `${seccion}: cambió algo que ya existía: ${clave(f)}`);
    }
    const nuevas = (seccion) => despues[seccion].filter((f) => !antes[seccion].some((a) => clave(a) === clave(f)));
    assert.deepEqual(nuevas('funciones').map((f) => `${f.nspname}.${f.proname}`).sort(), ['privado.emv_crc_ok', 'privado.emv_llave']);
    assert.deepEqual(nuevas('relaciones'), [], 'ninguna tabla ni vista nueva, ni cambió el ACL de la tabla');
    assert.deepEqual(nuevas('policies'), [], 'ninguna policy nueva');
    assert.deepEqual(nuevas('triggers'), [], 'ningún trigger nuevo');
    assert.deepEqual(nuevas('publicacion'), [], 'nada nuevo en Realtime');
    assert.deepEqual(nuevas('restricciones').map((c) => c.conname).sort(), [
      'ajustes_pago_breb_completo', 'ajustes_pago_breb_llave_forma', 'ajustes_pago_breb_llave_segura',
      'ajustes_pago_breb_qr_ascii', 'ajustes_pago_breb_qr_crc', 'ajustes_pago_breb_qr_inicio', 'ajustes_pago_breb_qr_largo', 'ajustes_pago_breb_qr_llave',
    ]);
    assert.deepEqual(nuevas('columnas').map((c) => `${c.tabla}.${c.attname}`).sort(), [
      'ajustes.id', 'ajustes.pago_breb_llave', 'ajustes.pago_breb_qr', 'ajustes.pago_breb_visible',
    ], 'permisos por columna: las cuatro de service_role');
    for (const c of nuevas('columnas')) assert.match(c.acl, /^\{service_role=r\/migrador\}$/, `${c.attname}: solo SELECT para service_role`);
  });

  for (const archivo of ['10-checks.sql', '20-permisos.sql']) {
    test(`batería SQL ${archivo}`, () => {
      const r = correr(pg, archivo);
      avisosDe[archivo] = r.avisos;
      assert.ok(r.ok, `el archivo terminó con error: ${r.error}`);
      assert.deepEqual(r.fallan, [], r.fallan.map((f) => `${f.nombre} [${f.detalle}]`).join('\n'));
      assert.ok(r.resultados.length >= MINIMO[archivo], `${archivo}: solo ${r.resultados.length} comprobaciones (se esperaban ≥ ${MINIMO[archivo]})`);
    });
  }

  test('las baterías no dejan ni un WARNING', () => {
    for (const [archivo, avisos] of Object.entries(avisosDe)) assert.deepEqual(avisos, [], archivo);
  });

  test('el CRC de SQL (privado.emv_crc_ok) y el de JS (emvCrcOk) dicen LO MISMO con cientos de contenidos: los fijos, los de borde y los al azar', () => {
    const rnd = azar(20261003);
    const base = QR_FICTICIO;
    const casos = [
      QR_FICTICIO, QR_FICTICIO_2, corromper(QR_FICTICIO), '', ' ', '6304', '00020163040000', cuerpoFicticio(), conCrc(cuerpoFicticio()) + tlv('99', 'X'),
      QR_FICTICIO.slice(0, -4) + QR_FICTICIO.slice(-4).toLowerCase(), QR_FICTICIO + '0', QR_FICTICIO.slice(0, -1), 'ñandú', 'a\nb',
      ...qrMalos().map((m) => m[1]),
      ...[14, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 50, 100, 101, 102, 103, 104, 105, 200, 500, 699, 700, 701, 1000, 1023, 1024, 1025, 1100].map(qrDeLargo),
    ];
    // un carácter cambiado al azar en un QR bueno (casi siempre rompe el CRC o la estructura)
    for (let i = 0; i < 120; i++) {
      const p = Math.floor(rnd() * base.length);
      const c = String.fromCharCode(32 + Math.floor(rnd() * 95));
      casos.push(base.slice(0, p) + c + base.slice(p + 1));
    }
    // estructuras al azar con el CRC bien calculado (válidas) o roto
    for (let i = 0; i < 80; i++) {
      let cuerpo = tlv('00', '01');
      const campos = 1 + Math.floor(rnd() * 8);
      for (let j = 0; j < campos; j++) cuerpo += tlv(String(10 + Math.floor(rnd() * 80)), 'v'.repeat(Math.floor(rnd() * 30)));
      const bueno = conCrc(cuerpo);
      casos.push(bueno, corromper(bueno), bueno.slice(0, -4) + '00' + bueno.slice(-2));
    }
    // cadenas de dígitos y de relleno que parecen TLV
    for (let i = 0; i < 40; i++) casos.push(Array.from({ length: 8 + Math.floor(rnd() * 40) }, () => String(Math.floor(rnd() * 10))).join(''));
    const lista = casos.map(literal).join(', ');
    const r = pg.sql(`select coalesce(json_agg(privado.emv_crc_ok(v) order by n), '[]'::json) from unnest(array[${lista}]::text[]) with ordinality as u(v, n);`);
    assert.ok(r.ok, r.error);
    const sql = JSON.parse(r.salida);
    assert.equal(sql.length, casos.length);
    const distintos = casos.map((c, i) => [c, sql[i], emvCrcOk(c)]).filter(([, a, b]) => a !== b);
    assert.deepEqual(distintos.map(([c, a, b]) => `${JSON.stringify(c.slice(0, 40))}… SQL=${a} JS=${b}`), []);
    const verdaderos = sql.filter(Boolean).length;
    assert.ok(verdaderos >= 90 && verdaderos <= casos.length - 150, `la muestra tiene de las dos clases: ${verdaderos} válidos de ${casos.length}`);
  });

  test('la llave del QR de SQL (privado.emv_llave) y la de JS (llaveDelQrBreb) dicen LO MISMO: los vectores del cruce, los QR malos y cientos al azar', () => {
    const rnd = azar(1003);
    const casos = [
      ...llaveQrVectores().map((v) => v[1]), QR_FICTICIO, QR_FICTICIO_2, '', ' ', '2604', '000201010211' + '2602', '00020101021126', 'ñandú', null,
      ...qrMalos().map((m) => m[1]),
      ...[14, 20, 26, 100, 700, 1023, 1024, 1025].map(qrDeLargo),
    ];
    // un carácter cambiado al azar en QR buenos: la mayoría rompe la estructura del 26 o del 04
    for (const base of [QR_FICTICIO, QR_FICTICIO_2]) {
      for (let i = 0; i < 120; i++) {
        const p = Math.floor(rnd() * base.length);
        casos.push(base.slice(0, p) + String.fromCharCode(32 + Math.floor(rnd() * 95)) + base.slice(p + 1));
      }
    }
    // estructuras al azar: campos 26/27 con subcampos 00/04 repetidos, ausentes o con otra red
    const subs = () => Array.from({ length: Math.floor(rnd() * 5) }, () => tlv(['00', '04', '05'][Math.floor(rnd() * 3)], ['CO.COM.RBM.LLA', '@una', '@dos', 'x', 'CO.COM.RBM.REF'][Math.floor(rnd() * 5)])).join('');
    for (let i = 0; i < 150; i++) {
      let cuerpo = tlv('00', '01');
      const n = 1 + Math.floor(rnd() * 4);
      for (let j = 0; j < n; j++) cuerpo += tlv(['26', '26', '27', '49'][Math.floor(rnd() * 4)], subs());
      casos.push(conCrc(cuerpo));
    }
    const lista = casos.map((c) => (c === null ? 'null' : literal(c))).join(', ');
    const r = pg.sql(`select coalesce(json_agg(privado.emv_llave(v) order by n), '[]'::json) from unnest(array[${lista}]::text[]) with ordinality as u(v, n);`);
    assert.ok(r.ok, r.error);
    const sql = JSON.parse(r.salida);
    assert.equal(sql.length, casos.length);
    const distintos = casos.map((c, i) => [c, sql[i], llaveDelQrBreb(c)]).filter(([, a, b]) => a !== b);
    assert.deepEqual(distintos.map(([c, a, b]) => `${JSON.stringify(String(c).slice(0, 50))}… SQL=${a} JS=${b}`), []);
    const con = sql.filter((x) => x !== null).length;
    assert.ok(con >= 30 && con <= casos.length - 100, `la muestra tiene de las dos clases: ${con} con llave de ${casos.length}`);
  });

  test('las reglas de la llave de SQL (los CHECK) y de JS (llaveBrebValida) coinciden con cientos de llaves: buenas, malas y al azar', () => {
    const rnd = azar(7);
    const alfabeto = ['a', 'Z', '0', '9', '@', '.', '_', '-', '+', '%', ' ', '<', '>', '"', "'", '`', '\\', 'ñ', '\n', '\t', ';', '3', '5', '7'];
    const casos = [...LLAVES_BUENAS, ...LLAVES_MALAS.map((m) => m[1]).filter((l) => l !== '')];
    for (let i = 0; i < 150; i++) casos.push(Array.from({ length: 1 + Math.floor(rnd() * 24) }, () => alfabeto[Math.floor(rnd() * alfabeto.length)]).join(''));
    for (let i = 0; i < 60; i++) casos.push('@' + Array.from({ length: Math.floor(rnd() * 70) }, () => alfabeto[Math.floor(rnd() * 8)]).join(''));
    for (let i = 0; i < 60; i++) casos.push(Array.from({ length: 3 + Math.floor(rnd() * 22) }, () => String(Math.floor(rnd() * 10))).join(''));
    for (let i = 0; i < 40; i++) casos.push(`${'ab.c_d+%'.slice(0, 1 + Math.floor(rnd() * 8))}@${['mail', 'x.y', 'a-b.c'][i % 3]}.${['co', 'com', 'c', 'c0m'][i % 4]}`);
    for (const l of ['+573001234567', '+57300123456', '+5730012345678', '+58300123456', '300123456', '3001234567', '12345678901234567890', '123456789012345678901']) casos.push(l);
    const unicos = [...new Set(casos)];
    // Sin QR guardado: con uno puesto, la base solo deja la llave que cobra ese QR (ajustes_pago_breb_qr_llave) y aquí se prueba la FORMA de la llave.
    assert.ok(pg.sql('select t.partida_pago();').ok);
    const r = pg.sql(`select coalesce(json_agg(t.llave_acepta('admin', v) order by n), '[]'::json) from unnest(array[${unicos.map(literal).join(', ')}]::text[]) with ordinality as u(v, n);`);
    assert.ok(r.ok, r.error);
    const sql = JSON.parse(r.salida);
    assert.equal(sql.length, unicos.length);
    const distintos = unicos.map((l, i) => [l, sql[i], llaveBrebValida(l)]).filter(([, a, b]) => a !== b);
    assert.deepEqual(distintos.map(([l, a, b]) => `${JSON.stringify(l)} SQL=${a} JS=${b}`), []);
    const buenas = sql.filter(Boolean).length;
    assert.ok(buenas >= 40 && buenas <= unicos.length - 100, `la muestra tiene de las dos clases: ${buenas} buenas de ${unicos.length}`);
    pg.sql(`update public.ajustes set pago_breb_llave = null where id = 1;`);
  });

  // ── la función `cuenta` corrida contra esta base, con el rol service_role de verdad ──
  describe('cuenta/index.ts contra la base real, como service_role (lo que hace en Supabase)', { skip: HAY_TS ? false : 'correr index.ts pide Node ≥ 22.18 (type stripping)' }, () => {
    const TOKEN_5 = 'a'.repeat(48);
    const TOKEN_6 = 'b'.repeat(48);
    let f;
    let base;
    const ajustes = (sets) => { const r = pg.sql(`update public.ajustes set ${sets} where id = 1;`); assert.ok(r.ok, r.error); };
    const pedir = (q) => f.atender(new Request(`https://prueba.invalid/functions/v1/cuenta?${new URLSearchParams(q)}`, { method: 'GET', headers: { origin: ORIGEN, 'x-forwarded-for': '203.0.113.7' } }));
    const cuerpo = async (r) => JSON.parse(await r.text());
    const PAGO = { breb: { llave: LLAVE_FICTICIA, qr: QR_FICTICIO } };
    const encender = (llave = LLAVE_FICTICIA, qr = QR_FICTICIO) =>
      ajustes(`pago_breb_visible = true, pago_breb_llave = ${literal(llave)}, pago_breb_qr = ${literal(qr)}`);

    before(async () => {
      const r = pg.sql(`
        select t.partida_pago();
        delete from public.ordenes; delete from public.mesas;
        insert into public.mesas (id, capacidad, estado, token) values
          (3, 4, 'ocupada', ${literal(TOKEN_MESA_3)}), (4, 4, 'ocupada', ${literal(TOKEN_MESA_4)}), (5, 4, 'libre', ${literal(TOKEN_5)}), (6, 4, 'ocupada', ${literal(TOKEN_6)});
        update public.mesas set activa = false where id = 6;
        insert into public.ordenes (id, mesa_id, estado, items, total) values
          ('abierta3', 3, 'abierta', '[{"id":"i1","nombre":"Menú Resplandor","precio":23000,"qty":2,"nota":"Sopa · Res"},{"id":"i2","nombre":"Limonada","precio":5000,"qty":2,"nota":"Persona 2"}]', 56000),
          ('abierta4', 4, 'abierta', '[{"id":"z","nombre":"Café","precio":3000,"qty":1,"nota":"x"}]', 3000),
          ('vieja3',   3, 'cerrada', '[{"id":"y","nombre":"Postre","precio":9000,"qty":1}]', 9000),
          ('dormida6', 6, 'abierta', '[{"id":"w","nombre":"Agua","precio":2000,"qty":1}]', 2000);
        update public.ajustes set ticket_pie = 'Pie secreto del ticket' where id = 1;
      `);
      assert.ok(r.ok, r.error);
      base = basePostgres(pg);   // rol service_role
      f = await cargarFuncion(FUNCION, { base });
      encender();
    });

    test('con cuenta abierta y «visible» encendido: la respuesta trae pago.breb con SOLO llave y qr, tal como están en la base', async () => {
      const r = await pedir({ m: '3', k: TOKEN_MESA_3 });
      assert.equal(r.status, 200);
      const d = await cuerpo(r);
      assert.deepEqual(d.pago, PAGO);
      assert.deepEqual(Object.keys(d.pago.breb).sort(), ['llave', 'qr']);
      assert.equal(d.estado, 'abierta');
      assert.equal(d.orden_id, 'abierta3');
      assert.equal(d.total, 56000);
      assert.deepEqual(d.items, [{ nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 }, { nombre: 'Limonada', precio: 5000, cantidad: 2 }]);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.headers.get('access-control-allow-origin'), ORIGEN);
    });

    test('la respuesta completa de la cuenta abierta, campo por campo (los datos de la base y la ficticia)', async () => {
      const d = await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3 }));
      const { servidor_en, abierta_en, actualizada_en, marca, canal, ...resto } = d;
      assert.deepEqual(resto, {
        mesa: 3, estado: 'abierta', abierta: true, orden_id: 'abierta3',
        items: [{ nombre: 'Menú Resplandor', precio: 23000, cantidad: 2 }, { nombre: 'Limonada', precio: 5000, cantidad: 2 }],
        total: 56000, liquidar_activo: false, liquidacion: null,
        pago: { breb: { llave: '@PruebaFicticia', qr: QR_FICTICIO } },
      });
      assert.match(marca, /^\d+\.0$/);
      assert.match(canal.topico, /^cuenta:[0-9a-f]{64}$/);
      assert.match(abierta_en, /^\d{4}-\d\d-\d\dT/);
      assert.match(actualizada_en, /^\d{4}-\d\d-\d\dT/);
      assert.match(servidor_en, /^\d{4}-\d\d-\d\dT/);
    });

    test('lo demás de la respuesta es IGUAL con y sin el pago (salvo la clave pago y la hora del servidor)', async () => {
      const con = await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3 }));
      ajustes('pago_breb_visible = false');
      const sin = await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3 }));
      encender();
      for (const d of [con, sin]) delete d.servidor_en;
      assert.ok(!('pago' in sin));
      const { pago, ...resto } = con;
      assert.deepEqual(resto, sin);
    });

    test('lee `ajustes` con service_role y SOLO las tres columnas que tiene permitidas (con «*» recibiría 42501)', async () => {
      const antesN = base.consultas.filter((c) => c.tabla === 'ajustes').length;
      await pedir({ m: '3', k: TOKEN_MESA_3 });
      const nuevas = base.consultas.filter((c) => c.tabla === 'ajustes').slice(antesN);
      assert.equal(nuevas.length, 1);
      assert.equal(nuevas[0].columnas, 'pago_breb_visible, pago_breb_llave, pago_breb_qr');
      assert.deepEqual(nuevas[0].filtros, [['id', 1]]);
    });

    test('«visible» apagado → sin pago (ni la clave); encenderlo otra vez lo trae: dinámico, sin caché', async () => {
      ajustes('pago_breb_visible = false');
      const apagado = await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3 }));
      assert.ok(!('pago' in apagado));
      assert.equal(apagado.estado, 'abierta');
      encender();
      assert.deepEqual((await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3 }))).pago, PAGO);
    });

    test('lo que el admin cambia se ve en la siguiente lectura: otra llave y otro QR', async () => {
      encender('@OtraFicticia9', QR_FICTICIO_2);
      assert.deepEqual((await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3 }))).pago, { breb: { llave: '@OtraFicticia9', qr: QR_FICTICIO_2 } });
      encender();
      assert.deepEqual((await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3 }))).pago, PAGO);
    });

    test('es un ajuste del local: la mesa 4 también lo recibe, con SU cuenta', async () => {
      const d = await cuerpo(await pedir({ m: '4', k: TOKEN_MESA_4 }));
      assert.deepEqual(d.pago, PAGO);
      assert.equal(d.orden_id, 'abierta4');
      assert.deepEqual(d.items, [{ nombre: 'Café', precio: 3000, cantidad: 1 }]);
    });

    test('sin cuenta abierta (mesa libre), con la cuenta cerrada (`o` vieja) o con un token malo: NUNCA pago, y `ajustes` ni se lee', async () => {
      const antesN = base.consultas.filter((c) => c.tabla === 'ajustes').length;
      const libre = await cuerpo(await pedir({ m: '5', k: TOKEN_5 }));
      assert.equal(libre.estado, 'sin_orden');
      assert.ok(!('pago' in libre));
      const cerrada = await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3, o: 'vieja3' }));
      assert.equal(cerrada.estado, 'cerrada');
      assert.ok(!('pago' in cerrada));
      const ajena = await pedir({ m: '3', k: TOKEN_MESA_4 });
      assert.equal(ajena.status, 404);
      const desactivada = await pedir({ m: '6', k: TOKEN_6 });
      assert.equal(desactivada.status, 404, 'la mesa desactivada responde como un enlace que no existe');
      for (const r of [ajena, desactivada]) {
        const t = await r.text();
        assert.ok(!t.includes('pago') && !t.includes('breb') && !t.includes(QR_FICTICIO));
      }
      assert.equal(base.consultas.filter((c) => c.tabla === 'ajustes').length, antesN, 'ninguna de esas respuestas leyó ajustes');
    });

    test('el cuerpo no deja pasar nada más de `ajustes` (ni el pie del ticket, ni quién editó, ni su correo)', async () => {
      const texto = await (await pedir({ m: '3', k: TOKEN_MESA_3 })).text();
      for (const prohibido of ['Pie secreto del ticket', 'resplandor.test', 'actualizado', 'ticket_', 'pago_breb', 'ajustes', 'visible']) {
        assert.ok(!texto.includes(prohibido), `la respuesta no debe contener «${prohibido}»`);
      }
    });

    test('si service_role pierde el permiso de una columna (migración a medias): la cuenta sale igual, sin pago, y el aviso trae el 42501', async (t) => {
      const registro = [];
      t.mock.method(console, 'error', (...a) => { registro.push(a); });
      try {
        assert.ok(pg.sql('revoke select (pago_breb_qr) on public.ajustes from service_role;', { como: 'migrador' }).ok);
        const r = await pedir({ m: '3', k: TOKEN_MESA_3 });
        assert.equal(r.status, 200);
        const d = await cuerpo(r);
        assert.equal(d.estado, 'abierta');
        assert.equal(d.total, 56000);
        assert.ok(!('pago' in d), 'sin el permiso no se inventa nada');
        assert.equal(d.pago_desconocido, true, 'no pudo leer: lo dice (no es lo mismo que «apagado»)');
        assert.ok(registro.some((a) => String(a[0]).includes('no se pudo leer el pago') && a.includes('42501')), JSON.stringify(registro));
      } finally {
        assert.ok(pg.sql('grant select (pago_breb_qr) on public.ajustes to service_role;', { como: 'migrador' }).ok);
      }
      assert.deepEqual((await cuerpo(await pedir({ m: '3', k: TOKEN_MESA_3 }))).pago, PAGO, 'con el permiso de vuelta, vuelve el pago');
    });

    test('una columna que no existe (42703 real de Postgres: la función nueva con la migración sin aplicar): la cuenta sale como siempre, 200 y sin pago', async (t) => {
      const registro = [];
      t.mock.method(console, 'error', (...a) => { registro.push(a); });
      const viejo = basePostgres(pg);
      const desde = viejo.cliente.from;
      viejo.cliente.from = (tabla) => {
        const c = desde(tabla);
        if (tabla !== 'ajustes') return c;
        const sel = c.select.bind(c);
        c.select = () => sel('pago_viejo_inexistente');
        return c;
      };
      const g = await cargarFuncion(FUNCION, { base: viejo });
      const r = await g.atender(new Request(`https://prueba.invalid/functions/v1/cuenta?m=3&k=${TOKEN_MESA_3}`, { method: 'GET', headers: { origin: ORIGEN } }));
      assert.equal(r.status, 200);
      const d = await cuerpo(r);
      assert.equal(d.estado, 'abierta');
      assert.ok(!('pago' in d));
      assert.equal(d.pago_desconocido, true);
      assert.ok(registro.some((a) => a.includes('42703')), 'el aviso trae el código de Postgres: columna que no existe');
    });
  });

  test('aplicarla dos veces es inocua: con el pago cargado adentro, el catálogo queda idéntico y no se pierde ni un dato', () => {
    const r0 = pg.sql(`select t.partida_pago();
      update public.ajustes set pago_breb_visible = true, pago_breb_llave = ${literal(LLAVE_FICTICIA)}, pago_breb_qr = ${literal(QR_FICTICIO)}, ticket_pie = 'Con datos' where id = 1;`);
    assert.ok(r0.ok, r0.error);
    const fila = () => pg.filas('select * from public.ajustes')[0];
    const antesFila = fila();
    const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(otra.length, 1);
    assert.ok(otra[0].ok, otra[0].error);
    assert.deepEqual(otra[0].avisos, [], 'la segunda aplicación no deja WARNING');
    assert.deepEqual(radiografia(pg), despues, 'el catálogo no cambió');
    assert.deepEqual(fila(), antesFila, 'la fila de ajustes (con el pago y el sello de quién editó) quedó exacta');
  });

  test('la reversa comentada de la cabecera funciona en limpio, deja el catálogo como antes (incluido el ACL por columna), y reaplicar lo deja como después', async () => {
    const r = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(r.ok, 'la reversa falló: ' + r.error);
    assert.deepEqual(r.avisos, []);
    const ahora = radiografia(pg);
    for (const [seccion, filas] of Object.entries(antes)) assert.deepEqual(ahora[seccion], filas, `tras la reversa quedó distinto: ${seccion}`);
    assert.equal(pg.filas("select count(*) as n from information_schema.columns where table_name = 'ajustes' and column_name like 'pago_breb_%'")[0].n, 0);
    assert.equal(pg.filas("select to_regprocedure('privado.emv_crc_ok(text)') is null as n")[0].n, true);
    assert.equal(pg.filas("select to_regprocedure('privado.emv_llave(text)') is null as n")[0].n, true);
    assert.equal(pg.filas('select ticket_pie from public.ajustes')[0].ticket_pie, 'Con datos', 'el resto de ajustes sigue intacto');
    // Y la función NUEVA contra la base SIN la migración (el orden «desplegar la función antes de aplicar el SQL»): la cuenta sale, sin pago.
    if (HAY_TS) {
      const registro = [];
      const g = await cargarFuncion(FUNCION, { base: basePostgres(pg) });
      const original = console.error;
      console.error = (...a) => { registro.push(a); };
      try {
        const rr = await g.atender(new Request(`https://prueba.invalid/functions/v1/cuenta?m=3&k=${TOKEN_MESA_3}`, { method: 'GET', headers: { origin: ORIGEN } }));
        assert.equal(rr.status, 200);
        const d = JSON.parse(await rr.text());
        assert.equal(d.estado, 'abierta');
        assert.equal(d.total, 56000);
        assert.ok(!('pago' in d), 'sin la migración, sin pago');
        assert.equal(d.pago_desconocido, true);
        assert.ok(registro.some((a) => a.includes('42703')), 'el aviso trae el 42703: columna que no existe');
      } finally { console.error = original; }
    }
    const reaplicada = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.ok(reaplicada[0].ok, 'no se pudo volver a aplicar tras la reversa: ' + reaplicada[0].error);
    assert.deepEqual(radiografia(pg), despues, 'reaplicar tras la reversa deja el catálogo como la primera vez');
    // la batería de permisos vuelve a pasar sobre lo reaplicado
    cargarVectores(pg);
    const p = correr(pg, '20-permisos.sql');
    assert.ok(p.ok, p.error);
    assert.deepEqual(p.fallan, [], p.fallan.map((x) => `${x.nombre} [${x.detalle}]`).join('\n'));
  });
});

describe('se niega a correr, sin cambiar nada, si falta una condición (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
  }, { timeout: 300000 });
  after(() => { if (pg) pg.parar(); });

  test('sin la tabla ajustes, y sin el esquema privado: error claro y NADA creado; con todo en orden, sin avisos', () => {
    const aplicarMia = () => pg.sql(SQL, { como: 'migrador' });
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: '20261002170000' });   // todo menos ajustes
    assert.ok(previas.length >= 8 && previas.every((m) => m.ok), JSON.stringify(previas.filter((m) => !m.ok)));
    const a0 = radiografia(pg);

    const sinAjustes = aplicarMia();
    assert.equal(sinAjustes.ok, false);
    assert.match(sinAjustes.error, /Falta 20261002170000_ajustes_ticket\.sql.*No se cambió nada/s);
    assert.deepEqual(radiografia(pg), a0, 'sin ajustes: no dejó nada creado');
    assert.equal(pg.filas("select to_regprocedure('privado.emv_crc_ok(text)') is null as n")[0].n, true);

    const resto = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: '20261002170000', antesDe: MIGRACION });
    assert.ok(resto.every((m) => m.ok), JSON.stringify(resto.filter((m) => !m.ok)));
    // Sin el esquema privado (en esta base desechable se borra con todo lo que cuelga de él). `radiografia` mira privado, así que aquí
    // la foto es la de `ajustes`: columnas, restricciones y permisos por columna.
    const foto = () => pg.filas(`select 'columna' as tipo, attname::text as nombre, attacl::text as acl from pg_attribute where attrelid = 'public.ajustes'::regclass and attnum > 0 and not attisdropped
      union all select 'restriccion', conname::text, null from pg_constraint where conrelid = 'public.ajustes'::regclass order by 1, 2`);
    assert.ok(pg.sql('drop schema privado cascade;', { como: 'migrador' }).ok);
    const f0 = foto();
    const sinPrivado = aplicarMia();
    assert.equal(sinPrivado.ok, false);
    assert.match(sinPrivado.error, /Falta el esquema privado.*No se cambió nada/s);
    assert.deepEqual(foto(), f0, 'sin privado: no dejó nada creado');
    assert.equal(pg.filas("select count(*) as n from information_schema.columns where table_name = 'ajustes' and column_name like 'pago_breb_%'")[0].n, 0);
    assert.equal(pg.filas("select count(*) as n from pg_proc where proname = 'emv_crc_ok'")[0].n, 0);

    // Con todo en orden: se aplica limpia (en una base nueva de la cadena completa esto ya lo prueba la otra describe).
    assert.ok(pg.sql('create schema privado;', { como: 'migrador' }).ok);
    const bien = aplicarMia();
    assert.ok(bien.ok, bien.error);
    assert.deepEqual(bien.avisos, []);
  });
});
