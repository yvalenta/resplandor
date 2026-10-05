// El arreglo de 20261005100000_precio_vivo_y_promos.sql: supabase/migrations/20261005120000_promo_regla_ejecutable.sql
// (hallazgo del 2026-10-05, antes de salir al aire: el CHECK `productos_promo_regla_valida` llama a `privado.promo_regla_ok`, Postgres lo evalúa con el
// rol de QUIEN ESCRIBE, y la migración le había quitado el EXECUTE a `authenticated`: desde el POS no se podía crear ni cambiar NINGÚN producto, o sea
// ni siquiera un precio. La prueba de la migración escribía como `postgres`/`migrador` y no lo vio.)
//
// Dos partes, como migracion-pago-breb.test.mjs:
//   1. ESTÁTICA (corre siempre, también en CI): el texto del arreglo. Un solo GRANT, a authenticated y service_role y a nadie más, sobre la única función
//      que corre dentro de una sentencia de quien escribe; el requisito antes de tocar nada; idempotente; la reversa en la cabecera; que ordene después
//      de las dos migraciones de hallazgos-domingo; y que la migración original siga necesitándolo (el CHECK llama a la función).
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker, ver _supabase-simulado.mjs): la cadena de migraciones hasta la alerta, y entonces, con la RLS de
//      verdad (roles `authenticated` con los claims de un admin y de un mesero, `service_role`, `anon`):
//        · SIN el arreglo: el admin y el mesero NO pueden crear ni cambiar un producto («permission denied for function promo_regla_ok», 42501);
//        · CON el arreglo: sí; un cambio de precio hecho por el admin llega a la cuenta abierta; una regla mala sigue rechazada por el CHECK; el mesero
//          escribe una cuenta con la promo del lunes (los triggers son del dueño); service_role escribe productos; anon no ejecuta nada ni escribe;
//        · solo cambió el permiso de esa función (nada más cambia en el catálogo), las otras cuatro de privado siguen sin EXECUTE para anon y authenticated;
//        · dos veces es inocua, la reversa devuelve el defecto, y volver a aplicarlo lo arregla;
//        · y se niega a correr, sin cambiar nada, si falta 20261005100000.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia } from './_cola-impresion-pg.mjs';

const ARREGLO = '20261005120000_promo_regla_ejecutable.sql';
const PRECIO_VIVO = '20261005100000_precio_vivo_y_promos.sql';
const ALERTA = '20261005110000_alerta_pedir_cuenta.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${ARREGLO}`);
const SQL_PRECIO_VIVO = leer(`supabase/migrations/${PRECIO_VIVO}`);
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CP = compacto(sinComentarios(SQL));

// ───────────────────────── 1. estática ─────────────────────────

test('un solo GRANT: EXECUTE de privado.promo_regla_ok(jsonb) a authenticated y service_role, a nadie más; no crea, altera ni borra nada', () => {
  assert.equal((CP.match(/\bgrant\b/g) || []).length, 1);
  assert.match(CP, /grant execute on function privado\.promo_regla_ok\(jsonb\) to authenticated, service_role;/);
  assert.doesNotMatch(CP.match(/grant [^;]*;/)[0], /\b(anon|public)\b/, 'el GRANT no nombra a anon ni a public');
  assert.doesNotMatch(CP, /\b(create|alter|drop|insert|update|delete)\b/i, 'solo concede un permiso: ninguna tabla, función ni dato');
  assert.doesNotMatch(CP, /(create|drop|alter) policy|row level security|publication|revoke/i);
  const nombradas = [...CP.matchAll(/privado\.[a-z_]+/g)].map((m) => m[0]);
  assert.ok(nombradas.length >= 5 && nombradas.every((n) => n === 'privado.promo_regla_ok'), `solo nombra privado.promo_regla_ok; las otras cuatro funciones de privado siguen sin permiso para la API: ${nombradas.join(', ')}`);
});

test('se niega a correr, sin cambiar nada, si falta privado.promo_regla_ok (el requisito va ANTES del GRANT) y comprueba al final quién puede ejecutarla', () => {
  const codigo = sinComentarios(SQL);
  const iGrant = codigo.indexOf('grant execute');
  const requisito = codigo.slice(0, iGrant);
  assert.match(requisito, /to_regprocedure\('privado\.promo_regla_ok\(jsonb\)'\) is null[\s\S]*Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisito, /\bgrant\b|\bcreate\b|\balter\b/i);
  const final = codigo.slice(iGrant);
  assert.match(final, /has_function_privilege\('authenticated'/);
  assert.match(final, /has_function_privilege\('service_role'/);
  assert.match(final, /has_function_privilege\('anon'/);
  assert.match(final, /has_function_privilege\('public'/);
});

test('cabecera: dice qué pasaba y por qué (el CHECK corre con el rol de quien escribe), cita el mismo patrón de pago_breb, es idempotente y trae su reversa', () => {
  for (const frase of ['permission denied for function promo_regla_ok', 'QUIEN ESCRIBE', 'privado.emv_crc_ok', '20261003150000_pago_breb.sql', 'Idempotente', 'REVERSA', 'lo aplica Yonatan: aparca']) {
    assert.ok(SQL.includes(frase), `la cabecera no dice «${frase}»`);
  }
  assert.match(SQL, /--   revoke execute on function privado\.promo_regla_ok\(jsonb\) from authenticated, service_role;/);
});

test('va después de las dos migraciones de hallazgos-domingo, con prefijo único, y no se escribe ningún dato (el repo es público)', () => {
  const nombres = fs.readdirSync(path.join(RAIZ, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.ok(nombres.indexOf(PRECIO_VIVO) < nombres.indexOf(ALERTA) && nombres.indexOf(ALERTA) < nombres.indexOf(ARREGLO));
  assert.doesNotMatch(SQL, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ni un correo');
});

test('la migración original NO se tocó: sigue revocando el EXECUTE de las cinco funciones, y su CHECK llama a promo_regla_ok (por eso hace falta el arreglo)', () => {
  const cp = compacto(sinComentarios(SQL_PRECIO_VIVO));
  assert.ok(cp.includes('revoke all on function privado.promo_regla_ok(jsonb) from public, anon, authenticated;'));
  assert.match(cp, /add constraint productos_promo_regla_valida check \(privado\.promo_regla_ok\(promo_regla\)\)/);
  assert.doesNotMatch(cp, /\bgrant\b/, 'la migración de 20261005100000 sigue sin ningún GRANT: el permiso va en el arreglo');
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

const CLAIMS = {
  admin: { sub: '00000000-0000-4000-8000-0000000000a1', role: 'authenticated', email: 'admin@resplandor.test', app_metadata: { provider: 'google' } },
  mesero: { sub: '00000000-0000-4000-8000-0000000000b1', role: 'authenticated', email: 'mesero1@resplandor.test', app_metadata: { provider: 'google' } },
};
const MALO = /permission denied for function promo_regla_ok/;

describe('contra un Postgres 17 desechable: el POS (authenticated, con la RLS) escribe productos', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  const comoAdmin = (texto) => pg.sql(texto, { como: 'authenticated', claims: CLAIMS.admin });
  const comoMesero = (texto) => pg.sql(texto, { como: 'authenticated', claims: CLAIMS.mesero });
  const sql = (texto, opciones) => { const r = pg.sql(texto, opciones); assert.ok(r.ok, r.error); return r; };
  const una = (select) => pg.filas(select)[0];
  const aplicarArreglo = () => pg.sql(SQL, { como: 'migrador' });

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: ARREGLO });
    assert.ok(previas.length >= 16 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    assert.ok(previas.some((m) => m.archivo === PRECIO_VIVO) && previas.some((m) => m.archivo === ALERTA));
    antes = radiografia(pg);
    sql(`
      insert into public.personal (email, nombre, rol, activo, estado) values ('mesero1@resplandor.test', 'Mesero Uno', 'mesero', true, 'aprobado');
      insert into public.productos (id, categoria, nombre, precio, activo) values
        ('t-ej1','Ejecutivos','Menú Resplandor',23000,true), ('t-ej2','Ejecutivos','Seco',19000,true), ('t-be1','Bebidas','Margarita',30000,true);
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
        ('t-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"productos":["t-ej1","t-ej2"]}}');
      insert into public.mesas (id, capacidad, estado, token) values (91,4,'ocupada',repeat('a',48)),(92,4,'ocupada',repeat('b',48));
      insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values
        ('t-o1', 91, 'abierta', '[{"id":"t-ej2","nombre":"Seco","precio":19000,"qty":2,"nota":""}]', 38000, '2026-10-05 17:00:00+00');
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('el defecto, SIN el arreglo: ni el admin ni el mesero pueden crear o cambiar un producto, ni siquiera con promo_regla en null (42501); borrar sí', () => {
    for (const [quien, como] of [['admin', comoAdmin], ['mesero', comoMesero]]) {
      const cambiar = como("update public.productos set precio = 20000 where id = 't-ej2';");
      assert.equal(cambiar.ok, false, `${quien} pudo cambiar un precio SIN el arreglo: el defecto no se reprodujo`);
      assert.match(cambiar.error, MALO, `${quien}: ${cambiar.error}`);
      const crear = como("insert into public.productos (id, categoria, nombre, precio) values ('t-nuevo', 'Bebidas', 'Nueva', 1000);");
      assert.equal(crear.ok, false);
      assert.match(crear.error, MALO);
    }
    assert.equal(una("select precio from public.productos where id = 't-ej2'").precio, 19000, 'nada cambió');
    const borrar = comoAdmin("delete from public.productos where id = 't-nada';");
    assert.ok(borrar.ok, 'un DELETE no evalúa el CHECK: ' + borrar.error);
  });

  test('el arreglo se aplica como migrador (no superusuario), sin WARNING, y SOLO cambia el permiso de esa función: nada más del catálogo', () => {
    const r = aplicarArreglo();
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    const despues = radiografia(pg);
    const clave = (f) => JSON.stringify(f);
    const cambios = [];
    for (const [seccion, filas] of Object.entries(antes)) {
      const ahora = new Set(despues[seccion].map(clave));
      const antesSet = new Set(filas.map(clave));
      for (const f of filas) if (!ahora.has(clave(f))) cambios.push(`${seccion}: ya no está ${clave(f)}`);
      for (const f of despues[seccion]) if (!antesSet.has(clave(f))) cambios.push(`${seccion}: nuevo ${clave(f)}`);
    }
    // Una función cambió de ACL: sale como «ya no está la de antes» y «nueva la de ahora», las dos de privado.promo_regla_ok y de la sección «funciones».
    assert.equal(cambios.length, 2, cambios.join('\n'));
    assert.ok(cambios.every((c) => c.startsWith('funciones:') && c.includes('promo_regla_ok')), cambios.join('\n'));
    const f = una("select proacl::text as acl from pg_proc where oid = 'privado.promo_regla_ok(jsonb)'::regprocedure");
    assert.match(f.acl, /authenticated=X/);
    assert.match(f.acl, /service_role=X/);
    assert.doesNotMatch(f.acl, /anon=/, 'anon no tiene EXECUTE');
    assert.doesNotMatch(f.acl, /(^|[{,])=X\//, 'public (=X) no tiene EXECUTE');
  });

  test('CON el arreglo: el admin cambia un precio y la cuenta abierta lo sigue; el mesero crea y edita productos; el admin le pone una regla buena a una promo y una mala la rechaza el CHECK', () => {
    let r = comoAdmin("update public.productos set precio = 20000 where id = 't-ej2';");
    assert.ok(r.ok, r.error);
    const o = una("select items, total, version from public.ordenes where id = 't-o1'");
    assert.equal(o.items[0].precio, 20000, 'el precio vivo llegó a la cuenta abierta');
    assert.equal(Number(o.total), 40000);
    assert.ok(o.version >= 1, 'y la versión subió');
    r = comoMesero("insert into public.productos (id, categoria, nombre, precio) values ('t-nuevo', 'Bebidas', 'Nueva', 1000);");
    assert.ok(r.ok, r.error);
    r = comoMesero("update public.productos set activo = false where id = 't-nuevo';");
    assert.ok(r.ok, r.error);
    r = comoAdmin(`update public.productos set promo_regla = ${literal('{"cada":2,"descuento":50,"aplica":{"categorias":["Entradas"]}}')}::jsonb where id = 't-pr3';`);
    assert.ok(r.ok, r.error);
    r = comoAdmin(`update public.productos set promo_regla = ${literal('{"cada":1,"descuento":50,"aplica":{"categorias":["Entradas"]}}')}::jsonb where id = 't-pr3';`);
    assert.equal(r.ok, false);
    assert.match(r.error, /productos_promo_regla_valida/, 'una regla mala la rechaza el CHECK, no el permiso');
    sql(`update public.productos set promo_regla = ${literal('{"cada":3,"descuento":20,"aplica":{"productos":["t-ej1","t-ej2"]}}')}::jsonb where id = 't-pr3'; update public.productos set precio = 19000 where id = 't-ej2'; delete from public.productos where id = 't-nuevo';`);
  });

  test('un mesero (authenticated) escribe una cuenta del lunes y el 3.er Seco sale con la promo: los triggers son del dueño y no necesitan permiso de la API', () => {
    let r = comoMesero("insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('t-o2', 92, 'abierta', '[{\"id\":\"t-ej2\",\"nombre\":\"Seco\",\"precio\":1,\"qty\":2,\"nota\":\"\"}]', 2, '2026-10-05 17:00:00+00');");
    assert.ok(r.ok, r.error);
    r = comoMesero("select public.aplicar_delta_orden('t-o2', 't-ej2', 'Seco', 19000, 1, '');");
    assert.ok(r.ok, r.error);
    const o = una("select items, total from public.ordenes where id = 't-o2'");
    assert.equal(Number(o.total), 2 * 19000 + 15200, JSON.stringify(o.items));
    assert.ok(o.items.some((i) => i.id === 'promo:t-pr3:t-ej2' && i.nombre === 'Seco · 3er almuerzo · 20% OFF' && Number(i.precio) === 15200));
  });

  test('service_role también escribe productos; anon ni escribe ni ejecuta la función', () => {
    let r = pg.sql("update public.productos set precio = 19000 where id = 't-ej2';", { como: 'service_role' });
    assert.ok(r.ok, r.error);
    r = pg.sql("insert into public.productos (id, categoria, nombre, precio) values ('t-svc', 'Bebidas', 'Svc', 1);", { como: 'service_role' });
    assert.ok(r.ok, r.error);
    sql("delete from public.productos where id = 't-svc';");
    r = pg.sql("update public.productos set precio = 1 where id = 't-ej2';", { como: 'anon' });
    assert.equal(r.ok, false, 'anon no escribe productos');
    r = pg.sql('\\set VERBOSITY verbose\nselect privado.promo_regla_ok(null);', { como: 'anon' });
    assert.equal(r.ok, false);
    assert.match(r.error, /42501/);
  });

  test('las otras cuatro funciones de privado siguen SIN EXECUTE para anon, authenticated y public; la de la regla solo para authenticated y service_role', () => {
    const quien = (fn) => ['anon', 'authenticated', 'service_role', 'public'].filter((rol) => pg.sql(`select has_function_privilege(${literal(rol)}, ${literal(fn)}, 'execute');`).salida === 't');
    for (const fn of ['privado.dia_bogota(timestamp with time zone)', 'privado.normalizar_items(jsonb,smallint)', 'privado.ordenes_precio_vivo()', 'privado.productos_tocan_cuentas()']) {
      assert.deepEqual(quien(fn), [], `${fn}`);
    }
    assert.deepEqual(quien('privado.promo_regla_ok(jsonb)'), ['authenticated', 'service_role']);
    for (const llamada of ["privado.normalizar_items('[]'::jsonb, 1::smallint)", 'privado.dia_bogota(now())']) {
      const r = pg.sql(`\\set VERBOSITY verbose\nselect ${llamada};`, { como: 'authenticated', claims: CLAIMS.admin });
      assert.equal(r.ok, false);
      assert.match(r.error, /42501/);
    }
  });

  test('aplicarlo otra vez es inocuo: el catálogo queda idéntico y sin WARNING', () => {
    const antesDeOtra = radiografia(pg);
    const r = aplicarArreglo();
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(radiografia(pg), antesDeOtra);
  });

  test('la reversa de la cabecera devuelve el defecto (el POS vuelve a no poder escribir productos) y volver a aplicarlo lo arregla', () => {
    const m = SQL.match(/^--   (revoke execute on function privado\.promo_regla_ok\(jsonb\) from authenticated, service_role;)$/m);
    assert.ok(m, 'no encuentro la reversa en la cabecera');
    const rev = pg.sql(m[1], { como: 'migrador' });
    assert.ok(rev.ok, rev.error);
    let r = comoAdmin("update public.productos set precio = 19000 where id = 't-ej2';");
    assert.equal(r.ok, false);
    assert.match(r.error, MALO);
    const ya = aplicarArreglo();
    assert.ok(ya.ok, ya.error);
    r = comoAdmin("update public.productos set precio = 19000 where id = 't-ej2';");
    assert.ok(r.ok, r.error);
  });
});

describe('se niega a correr, sin cambiar nada, si falta 20261005100000 (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: PRECIO_VIVO });
    assert.ok(previas.length >= 14 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('sin privado.promo_regla_ok el arreglo aborta con el mensaje que dice qué migración falta, y no deja ningún permiso', () => {
    const antes = radiografia(pg);
    const r = pg.sql(SQL, { como: 'migrador' });
    assert.equal(r.ok, false);
    assert.match(r.error, /Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
    assert.deepEqual(radiografia(pg), antes);
  });
});
