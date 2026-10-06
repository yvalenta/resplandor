// Precio a mano por línea del pedido: supabase/migrations/20261006110000_precio_a_mano.sql
// (pedido de Yonatan, 2026-10-05, tareas/2026-10-05-precio-a-mano-y-botones.md: «se debe poder editar el valor a mano de cada producto»).
//
// Qué cambia: la línea de una cuenta puede llevar `precio_manual: true` (y `precio_por`, el correo de quien lo puso); `privado.normalizar_items`
// (el precio vivo de 20261005100000) NO refresca esa línea y las promociones sí la cuentan con su precio a mano; y la RPC
// `public.fijar_precio_item(orden, línea, precio)` lo pone (o, con null, devuelve la línea al precio de carta).
//
// Dos partes, como migracion-precio-vivo.test.mjs:
//
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. Que `normalizar_items` sea el mismo de 20261005100000 con SOLO
//      los tres cambios de la marca (línea por línea), que la RPC sea SECURITY INVOKER con los guardias de `aplicar_delta_orden` (orden
//      bloqueada, abierta, `version` que sube) y los de los permisos por rol (42501), que rechace lo que no es un precio de producto, que no dé
//      ningún permiso de más (authenticated y nadie más), que se niegue a correr sin cambiar nada, que sea idempotente y que la reversa de la
//      cabecera nombre todo lo que crea; y que el POS la llame con la forma que la base espera.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker): la cadena COMPLETA de migraciones y esta encima, como `migrador`; y los
//      escenarios con personas de verdad (rol `authenticated` + claims de Google): mesero y admin pueden; anon, service_role, una cuenta ajena, una
//      sesión que no es de Google no; el precio a mano sobrevive a un cambio de precio en Productos, a otro delta de la misma línea y al cobro;
//      las promos del lunes cuentan la línea con su precio a mano (y su línea de promo recuerda la marca); volver al precio de carta; lo que se
//      rechaza (negativos, decimales, de más de 10.000.000, el marcador «para llevar», los abonos, las promos, una cuenta cerrada); la señal a la
//      carta; la migración dos veces; la reversa de la cabecera; y que se niegue a correr, sin cambiar nada, si falta el precio vivo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal, topicoCuenta } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa } from './_cola-impresion-pg.mjs';

const MIGRACION = '20261006110000_precio_a_mano.sql';
const PREVIA = '20261005100000_precio_vivo_y_promos.sql';
const ALERTA = '20261005110000_alerta_pedir_cuenta.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${MIGRACION}`);
const SQL_PREVIA = leer(`supabase/migrations/${PREVIA}`);
const POS = leer('pos.html');
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CODIGO = sinComentarios(SQL);
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CP = compacto(CODIGO);
const SIN_CUERPOS = CP.replace(/\$\$.*?\$\$/g, ' $$…$$ ').replace(/\$function\$.*?\$function\$/g, ' $function$…$function$ ');

/** El cuerpo (texto crudo, sin comentarios) de `create or replace function privado.normalizar_items` de una migración. */
function normalizarDe(sql) {
  const c = sinComentarios(sql);
  const a = c.indexOf('create or replace function privado.normalizar_items');
  const b = c.indexOf('revoke all on function privado.normalizar_items', a);
  assert.ok(a >= 0 && b > a, 'no encuentro privado.normalizar_items');
  return c.slice(a, b);
}
/** La RPC de la migración: argumentos, tipo, lenguaje, atributos y cuerpo. */
function rpc() {
  const m = CP.match(/create or replace function public\.fijar_precio_item\(([^)]*)\) returns ([a-z. ]+?) language (\w+) set search_path = public as \$function\$ (.*?) \$function\$;/);
  assert.ok(m, 'no encuentro «create or replace function public.fijar_precio_item(…) … as $function$ … $function$;»');
  return { args: m[1], retorna: m[2], lenguaje: m[3], cuerpo: m[4] };
}

// ───────────────────────── 1. estática ─────────────────────────

test('la migración va la última de la cadena (después de la alerta «pide la cuenta»), con prefijo único', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(nombres.includes(MIGRACION));
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  for (const previa of [PREVIA, ALERTA, '20261002140000_permisos_por_rol.sql', '20261002180000_deshacer_cobro.sql']) assert.ok(nombres.includes(previa) && previa < MIGRACION, `${previa} tiene que ir antes`);
  assert.ok(nombres.slice(nombres.indexOf(MIGRACION) + 1).every((n) => n > MIGRACION));
});

test('la cabecera dice lo que hace, quién la corre, qué necesita, cómo se deshace, en qué orden sale y que la aplica Yonatan', () => {
  const cab = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos'));
  for (const frase of [
    'precio_manual', 'precio_por', 'privado.normalizar_items', 'public.fijar_precio_item', 'p_precio = null', 'aplicar_delta_orden', 'SECURITY INVOKER', 'RS001',
    '42501', '22023', '10.000.000', 'admin` o `mesero', 'el marcador «para llevar», los abonos y las líneas de promoción', 'QUIÉN LO VE Y QUIÉN LO CAMBIA',
    'REVERSA (menos de 1 minuto', 'lo aplica Yonatan: aparca', 'Idempotente', '20261005100000_precio_vivo_y_promos.sql', 'Orden de salida al aire',
    'falta aplicar la base',
  ]) assert.ok(cab.includes(frase), `la cabecera no dice «${frase}»`);
});

test('se niega a correr, sin cambiar nada, si falta el precio vivo (la función y el trigger) o mi_rol()/mi_correo(), y lo comprueba ANTES de crear nada', () => {
  const requisitos = CODIGO.slice(0, CODIGO.indexOf('create or replace function privado.normalizar_items'));
  assert.match(requisitos, /to_regprocedure\('privado\.normalizar_items\(jsonb, smallint\)'\) is null[\s\S]*Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /tgname = 'trg_ordenes_a_precio_vivo'[\s\S]*No se cambió nada/);
  assert.match(requisitos, /to_regprocedure\('public\.mi_rol\(\)'\) is null or to_regprocedure\('public\.mi_correo\(\)'\) is null[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bgrant\b/i);
});

test('normalizar_items es el de 20261005100000 con SOLO los cambios de la marca: respeta precio_manual en el paso b y la lleva en la promo (en las dos direcciones)', () => {
  const nuevo = normalizarDe(SQL).split('\n').map((l) => l.trim()).filter(Boolean);
  const viejo = normalizarDe(SQL_PREVIA).split('\n').map((l) => l.trim()).filter(Boolean);
  const resto = [...viejo];
  const agregadas = [];
  for (const l of nuevo) { const i = resto.indexOf(l); if (i >= 0) resto.splice(i, 1); else agregadas.push(l); }
  // Lo único de la versión anterior que ya no está: las tres líneas que cambian de forma (se cierran con un paréntesis más o se abren con uno).
  assert.deepEqual(resto, [
    "v_lineas := v_lineas || jsonb_build_object(",
    "'nota', coalesce(v_item ->> 'nota', ''));",
    "'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0), 'descuento', v_desc));",
  ], 'qué dejó de estar');
  assert.deepEqual(agregadas, [
    "v_lineas := v_lineas || (jsonb_build_object(",
    "'nota', coalesce(v_item ->> 'nota', ''))",
    "|| case when v_item -> 'promo' ->> 'precio_manual' = 'true'",
    "then jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_item -> 'promo' ->> 'precio_por'))",
    "else '{}'::jsonb end);",
    "if v_item ->> 'precio_manual' = 'true' then continue; end if;",
    "'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0), 'descuento', v_desc)",
    "|| case when v_base ->> 'precio_manual' = 'true'",
    "then jsonb_strip_nulls(jsonb_build_object('precio_manual', true, 'precio_por', v_base ->> 'precio_por'))",
    "else '{}'::jsonb end);",
  ], 'qué se agregó');
  const cp = compacto(normalizarDe(SQL));
  // El paso b: la marca se mira DESPUÉS de los abonos y ANTES de leer el catálogo.
  assert.ok(cp.indexOf("v_item ->> 'precio_manual' = 'true' then continue") > cp.indexOf("< 0 then continue; end if;") && cp.indexOf("v_item ->> 'precio_manual' = 'true' then continue") < cp.indexOf('select p.precio into v_precio'));
  assert.doesNotMatch(cp, /\b(update|insert into|delete from|truncate)\b/, 'sigue sin escribir nada: solo lee productos');
  assert.match(cp, /^create or replace function privado\.normalizar_items\(p_items jsonb, p_dia smallint\) returns jsonb language plpgsql stable set search_path = '' as \$\$/, 'mismo contrato: estable, search_path vacío, sin security definer');
  assert.match(CP, /revoke all on function privado\.normalizar_items\(jsonb, smallint\) from public, anon, authenticated;/, 'y sigue sin EXECUTE para anon ni authenticated');
});

test('public.fijar_precio_item: SECURITY INVOKER (la RLS de ordenes también aplica) y los guardias de aplicar_delta_orden: orden bloqueada, abierta (RS001), `version` que sube; más los permisos por rol', () => {
  const f = rpc();
  assert.equal(f.args, 'p_orden_id text, p_item_id text, p_precio numeric');
  assert.equal(f.retorna, 'public.ordenes');
  assert.equal(f.lenguaje, 'plpgsql');
  assert.doesNotMatch(CP, /fijar_precio_item\([^)]*\) returns public\.ordenes language plpgsql (set search_path = public )?security definer/, 'sin security definer: corre como quien llama');
  assert.doesNotMatch(f.cuerpo, /security definer/i);
  assert.match(f.cuerpo, /select \* into o from ordenes where id = p_orden_id for update; if not found then raise exception 'orden % no existe', p_orden_id;/, 'bloquea la orden, y el mensaje es el de aplicar_delta_orden (el POS lo reconoce)');
  assert.match(f.cuerpo, /if o\.estado <> 'abierta' then raise exception 'orden % está cerrada', p_orden_id using errcode = 'RS001';/);
  assert.match(f.cuerpo, /version = coalesce\(o\.version, 0\) \+ 1, updated_at = now\(\) where id = p_orden_id returning \* into o; return o;/);
  assert.match(f.cuerpo, /if \(select public\.mi_rol\(\)\) is null or \(select public\.mi_rol\(\)\) not in \('admin', 'mesero'\) then raise exception '[^']*' using errcode = '42501';/, 'admin y mesero; cualquier otra cosa 42501');
  // Qué rechaza
  assert.match(f.cuerpo, /p_precio is not null and \(p_precio < 0 or p_precio <> trunc\(p_precio\) or p_precio > 10000000\) then raise exception 'precio inválido[^']*', p_precio using errcode = '22023';/);
  assert.match(f.cuerpo, /p_item_id = 'para_llevar' or p_item_id like 'abono\\_%' or p_item_id like 'promo:%' or coalesce\(nullif\(it ->> 'precio', ''\)::numeric, 0\) < 0 then raise exception '[^']*', p_item_id using errcode = '22023';/);
  assert.match(f.cuerpo, /if it is null then raise exception 'la línea % no existe en la orden %'/);
  assert.match(f.cuerpo, /p_precio is null and p_item_id like 'manual\\_%' then raise exception/);
  // Qué escribe
  assert.match(f.cuerpo, /when p_precio is null then \(e - 'precio_manual'\) - 'precio_por'/, 'volver a la carta: sin marca, y el trigger la refresca');
  assert.match(f.cuerpo, /jsonb_set\(e, '\{precio\}', to_jsonb\(p_precio\)\) \|\| jsonb_strip_nulls\(jsonb_build_object\('precio_manual', true, 'precio_por', v_correo\)\)/);
  assert.match(f.cuerpo, /v_correo := \(select public\.mi_correo\(\)\);/, 'el correo lo pone la base (la identidad de Google), no el POS');
  assert.match(f.cuerpo, /total = \(select coalesce\(sum\(\(e ->> 'precio'\)::numeric \* \(e ->> 'qty'\)::int\), 0\) from jsonb_array_elements\(nuevos\) e\)/);
  assert.doesNotMatch(f.cuerpo, /\bdelete\b|\binsert\b|\bdrop\b/i);
});

test('permisos: authenticated y nadie más (ni public, ni anon, ni service_role); ninguna policy, tabla, vista, publicación ni columna tocadas', () => {
  assert.match(CP, /revoke all on function public\.fijar_precio_item\(text, text, numeric\) from public, anon, service_role;/);
  assert.match(CP, /grant execute on function public\.fijar_precio_item\(text, text, numeric\) to authenticated;/);
  assert.equal((CP.match(/\bgrant\b/g) || []).length, 1, 'un solo GRANT');
  assert.doesNotMatch(CP, /(create|drop|alter) policy|enable row level security|disable row level security|publication/);
  assert.doesNotMatch(CP, /create table|create view|alter table|add column|drop column/, 'no hay columna nueva: la marca es un campo del jsonb de las líneas');
  assert.doesNotMatch(CODIGO, /carta_publica/);
});

test('idempotente: dos «create or replace function», ningún drop ni dato escrito fuera de las funciones; la comprobación final mira la marca, el permiso y una línea intacta', () => {
  assert.equal((CP.match(/create or replace function/g) || []).length, 2);
  assert.doesNotMatch(SIN_CUERPOS, /\bdrop\b|\bupdate\s+(public|privado)\.|\binsert into\b|\bdelete from\b|\btruncate\b/i);
  const fin = CODIGO.slice(CODIGO.lastIndexOf('do $$'));
  assert.match(fin, /position\('precio_manual' in pg_get_functiondef\('privado\.normalizar_items\(jsonb, smallint\)'::regprocedure\)\) = 0/);
  assert.match(fin, /has_function_privilege\('anon', 'public\.fijar_precio_item\(text, text, numeric\)', 'execute'\)/);
  assert.match(fin, /"precio_manual":true/);
});

test('la reversa de la cabecera borra la RPC y manda volver a pegar la migración del precio vivo, que devuelve normalizar_items a la de antes', () => {
  const rc = compacto(reversa(SQL));
  assert.equal(rc, 'begin; drop function if exists public.fijar_precio_item(text, text, numeric); commit;');
  const cab = SQL.slice(0, SQL.indexOf('-- ── 0. Requisitos')).replace(/^--\s?/gm, '');
  assert.match(compacto(cab), /volver a pegar 20261005100000_precio_vivo_y_promos\.sql entero \(es idempotente: su `create or replace` devuelve `privado\.normalizar_items` a la versión de antes/);
});

test('el POS habla con la RPC en la forma que la base espera: p_orden_id, p_item_id y p_precio (null = volver a la carta), con permiso admin y mesero', () => {
  assert.match(POS, /supabaseClient\.rpc\('fijar_precio_item', \{ p_orden_id: [^}]*p_item_id: [^}]*p_precio: [^}]*\}\)/);
  assert.match(POS, /case 'catalogo_crear': case 'catalogo_editar': case 'ver_cierres': case 'deshacer_cobro': case 'precio_a_mano':\s*return this\.rol === 'admin' \|\| this\.rol === 'mesero';/);
  assert.match(POS, /Todavía no se puede poner el precio a mano: falta aplicar la actualización de la base/, 'si la base no la tiene (migración sin aplicar), el POS lo dice y deja el precio como estaba');
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;
const TOKEN_91 = 'a'.repeat(48);

describe('contra un Postgres 17 desechable (Supabase simulado, cadena completa de migraciones)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  let despues;
  const avisos = [];
  let DIA = 1;
  const sql = (texto, opciones) => {
    const r = pg.sql(`set resplandor.dia_promo = ${DIA};\n` + texto, opciones);
    for (const a of r.avisos) avisos.push(`${a}  ←  ${compacto(texto).slice(0, 90)}`);
    assert.ok(r.ok, r.error);
    return r;
  };
  // Con claims, psql imprime antes el resultado del set_config: el JSON de la consulta es la última línea.
  const ultimoJson = (salida) => JSON.parse(String(salida).trim().split('\n').pop());
  const orden = (id) => pg.filas(`select items, total, version from public.ordenes where id = ${literal(id)}`)[0];
  const linea = (o, id) => o.items.find((i) => i.id === id);
  const claims = (clave) => {
    const g = pg.filas(`select id, email, provider from t.gente where clave = ${literal(clave)}`)[0];
    return { sub: g.id, role: 'authenticated', email: g.email, app_metadata: { provider: g.provider } };
  };
  const como = (clave) => ({ como: 'authenticated', claims: claims(clave) });
  /** Llama a la RPC como esa persona y devuelve { ok, fila, error }; los avisos (WARNING) se juntan. */
  const fijar = (clave, id, item, precio) => {
    const arg = precio === null ? 'null' : String(precio);
    const texto = `set resplandor.dia_promo = ${DIA};\n\\set VERBOSITY verbose\nselect coalesce(json_agg(to_jsonb(t)), '[]'::json) from (select items, total, version from public.fijar_precio_item(${literal(id)}, ${literal(item)}, ${arg})) t;`;
    const r = pg.sql(texto, clave === 'anon' || clave === 'service_role' ? { como: clave, claims: { role: clave } } : como(clave));
    for (const a of r.avisos) avisos.push(`${a}  ←  fijar_precio_item`);
    return { ok: r.ok, fila: r.ok ? ultimoJson(r.salida)[0] : null, error: r.error };
  };
  const delta = (id, producto, nombre, precio, n, nota = '') => {
    const r = pg.sql(`set resplandor.dia_promo = ${DIA};\nselect coalesce(json_agg(to_jsonb(t)), '[]'::json) from (select items, total, version from public.aplicar_delta_orden(${literal(id)}, ${literal(producto)}, ${literal(nombre)}, ${precio}, ${n}, ${literal(nota)})) t;`, como('mesero'));
    if (!r.ok) throw new Error(r.error);
    return ultimoJson(r.salida)[0];
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
    // El personal: el admin lo creó la compuerta (admin@resplandor.test); el mesero se da de alta aquí. «ajena» no está en `personal`.
    sql(`insert into public.personal (email, nombre, rol) values ('mesero1@resplandor.test', 'Mesero Prueba', 'mesero') on conflict (email) do nothing;`);
    sql(`
      insert into public.productos (id, categoria, nombre, precio, activo) values
        ('t-ej1','Ejecutivos','Menú Resplandor',23000,true),
        ('t-ej2','Ejecutivos','Seco',19000,true),
        ('t-be1','Bebidas','Margarita',30000,true),
        ('t-be2','Bebidas','Cerveza',10000,true);
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
        ('t-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}');
      insert into public.mesas (id, capacidad, estado, token) values
        (91,4,'ocupada',${literal(TOKEN_91)}),(92,4,'ocupada',repeat('b',48)),(93,4,'ocupada',repeat('c',48)),(94,4,'ocupada',repeat('d',48));
    `);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  test('agrega SOLO lo suyo: la RPC pública y el cuerpo nuevo de normalizar_items; ninguna tabla, vista, policy, trigger, restricción, publicación ni permiso por columna; nada de lo que había cambia', () => {
    const clave = (f) => JSON.stringify(f);
    for (const seccion of Object.keys(antes)) {
      if (seccion === 'funciones') continue;
      assert.deepEqual(despues[seccion], antes[seccion], `${seccion}: cambió`);
    }
    const nuevas = despues.funciones.filter((f) => !antes.funciones.some((a) => clave(a) === clave(f)));
    const sinNombres = (args) => String(args).replace(/\bp_[a-z_]+\s+/g, '');
    assert.deepEqual(nuevas.map((f) => `${f.nspname}.${f.proname}(${sinNombres(f.args)})`).sort(), ['privado.normalizar_items(jsonb, smallint)', 'public.fijar_precio_item(text, text, numeric)']);
    const rpcFila = nuevas.find((f) => f.proname === 'fijar_precio_item');
    assert.match(rpcFila.acl || '', /authenticated=X/);
    assert.doesNotMatch(rpcFila.acl || '', /anon|service_role/);
    const norm = nuevas.find((f) => f.proname === 'normalizar_items');
    assert.doesNotMatch(norm.acl || '', /anon|authenticated/, 'normalizar_items sigue sin EXECUTE para la API');
    // y el resto de las funciones, intactas
    for (const f of antes.funciones.filter((x) => x.proname !== 'normalizar_items')) assert.ok(despues.funciones.some((d) => clave(d) === clave(f)), `cambió ${f.proname}`);
  });

  test('permisos: anon y service_role no tienen EXECUTE (42501); una cuenta de Google fuera de `personal` y una sesión por correo reciben 42501; el mesero y el admin pueden', () => {
    DIA = 3;
    abrir('t-p1', 91);
    delta('t-p1', 't-ej1', 'Menú Resplandor', 23000, 1);
    for (const quien of ['anon', 'service_role']) {
      const r = fijar(quien, 't-p1', 't-ej1', 20000);
      assert.equal(r.ok, false, `${quien} pudo`);
      assert.match(r.error, /42501|permission denied/i, `${quien}: ${r.error}`);
    }
    for (const quien of ['ajena', 'correo', 'pendiente']) {
      const r = fijar(quien, 't-p1', 't-ej1', 20000);
      assert.equal(r.ok, false, `${quien} pudo`);
      assert.match(r.error, /42501/, `${quien}: ${r.error}`);
      assert.match(r.error, /sin permiso para cambiar el precio/, quien);
    }
    assert.equal(Number(linea(orden('t-p1'), 't-ej1').precio), 23000, 'nada cambió');
    const m = fijar('mesero', 't-p1', 't-ej1', 21000);
    assert.ok(m.ok, m.error);
    assert.equal(Number(linea(m.fila, 't-ej1').precio), 21000);
    const a = fijar('admin', 't-p1', 't-ej1', 22000);
    assert.ok(a.ok, a.error);
    assert.equal(Number(linea(a.fila, 't-ej1').precio), 22000);
    assert.equal(linea(a.fila, 't-ej1').precio_por, 'admin@resplandor.test', 'quien lo puso, por su identidad de Google (no un dato del POS)');
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 't-p1';");
  });

  test('el precio a mano queda en la línea con su marca y quién lo puso, recalcula el total, sube la versión y avisa a la carta; las demás líneas siguen al catálogo', () => {
    DIA = 3;
    abrir('t-o1', 91);
    delta('t-o1', 't-ej1', 'Menú Resplandor', 23000, 2);
    const o0 = delta('t-o1', 't-be2', 'Cerveza', 10000, 1);
    pg.limpiarSenales();
    const r = fijar('mesero', 't-o1', 't-ej1', 20000);
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.fila.items.map((i) => [i.id, i.qty, Number(i.precio)]), [['t-ej1', 2, 20000], ['t-be2', 1, 10000]], 'el precio es de TODAS las unidades de la línea');
    assert.equal(linea(r.fila, 't-ej1').precio_manual, true);
    assert.equal(linea(r.fila, 't-ej1').precio_por, 'mesero1@resplandor.test');
    assert.equal(linea(r.fila, 't-be2').precio_manual, undefined, 'la otra línea no se marca');
    assert.equal(Number(r.fila.total), 2 * 20000 + 10000);
    assert.equal(r.fila.version, o0.version + 1);
    assert.deepEqual(orden('t-o1').items, r.fila.items, 'y es lo que quedó guardado');
    assert.ok(pg.senales().includes(topicoCuenta(TOKEN_91)), `la carta de la mesa 91 recibió la señal: ${JSON.stringify(pg.senales())}`);
  });

  test('sobrevive: un cambio de precio en Productos (la línea a mano no cambia, la otra sí), otro «+1» de la misma línea, una nota y tocar la cuenta', () => {
    DIA = 3;
    sql("update public.productos set precio = 25000 where id = 't-ej1'; update public.productos set precio = 11000 where id = 't-be2';");
    let o = orden('t-o1');
    assert.equal(Number(linea(o, 't-ej1').precio), 20000, 'el precio vivo no pisa el de la mano');
    assert.equal(linea(o, 't-ej1').precio_manual, true);
    assert.equal(Number(linea(o, 't-be2').precio), 11000, 'la que no es a mano sigue al catálogo');
    assert.equal(Number(o.total), 2 * 20000 + 11000);
    o = delta('t-o1', 't-ej1', 'Menú Resplandor', 25000, 1);
    assert.equal(linea(o, 't-ej1').qty, 3);
    assert.equal(Number(linea(o, 't-ej1').precio), 20000, 'otro «+1» con el precio de carta no cambia el de la línea');
    assert.equal(linea(o, 't-ej1').precio_manual, true);
    const nota = pg.sql(`select public.actualizar_nota_item('t-o1', 't-ej1', 'Sopa · Res');`, como('mesero'));
    assert.ok(nota.ok, nota.error);
    assert.equal(linea(orden('t-o1'), 't-ej1').precio_manual, true, 'actualizar la nota no suelta la marca');
    sql("update public.ordenes set updated_at = now() where id = 't-o1';");
    assert.equal(Number(linea(orden('t-o1'), 't-ej1').precio), 20000);
    // −1 hasta dejar una unidad: el precio sigue
    o = delta('t-o1', 't-ej1', 'Menú Resplandor', 25000, -2);
    assert.equal(linea(o, 't-ej1').qty, 1);
    assert.equal(Number(linea(o, 't-ej1').precio), 20000);
    delta('t-o1', 't-ej1', 'Menú Resplandor', 25000, 2);
  });

  test('volver al precio de carta (p_precio null): quita la marca y la línea toma el precio de HOY de Productos; sin marca, otro cambio de precio la vuelve a seguir', () => {
    DIA = 3;
    const r = fijar('mesero', 't-o1', 't-ej1', null);
    assert.ok(r.ok, r.error);
    const l = linea(r.fila, 't-ej1');
    assert.equal(Number(l.precio), 25000, 'el precio de carta de hoy');
    assert.equal(l.precio_manual, undefined);
    assert.equal(l.precio_por, undefined);
    assert.equal(Number(r.fila.total), 3 * 25000 + 11000);
    sql("update public.productos set precio = 26000 where id = 't-ej1';");
    assert.equal(Number(linea(orden('t-o1'), 't-ej1').precio), 26000, 'ya no es a mano: vuelve a seguir al catálogo');
    sql("update public.productos set precio = 25000 where id = 't-ej1';");
    // y se puede volver a poner
    const otra = fijar('admin', 't-o1', 't-ej1', 18000);
    assert.ok(otra.ok, otra.error);
    assert.equal(linea(otra.fila, 't-ej1').precio_por, 'admin@resplandor.test', 'el último que lo puso');
  });

  test('0 es un precio válido (una cortesía) y los pesos enteros hasta 10.000.000 también; todo lo demás se rechaza con 22023 sin cambiar nada', () => {
    DIA = 3;
    const v0 = orden('t-o1');
    for (const malo of [-1, -20000, 100.5, 19999.99, 10000001, 99999999999]) {
      const r = fijar('mesero', 't-o1', 't-ej1', malo);
      assert.equal(r.ok, false, `${malo} entró`);
      assert.match(r.error, /22023/, `${malo}: ${r.error}`);
      assert.match(r.error, /precio inválido/);
    }
    assert.deepEqual(orden('t-o1'), v0, 'ninguno cambió nada (ni la versión)');
    const cero = fijar('mesero', 't-o1', 't-be2', 0);
    assert.ok(cero.ok, cero.error);
    assert.equal(Number(linea(cero.fila, 't-be2').precio), 0);
    assert.equal(linea(cero.fila, 't-be2').precio_manual, true);
    const tope = fijar('mesero', 't-o1', 't-be2', 10000000);
    assert.ok(tope.ok, tope.error);
    assert.equal(Number(linea(tope.fila, 't-be2').precio), 10000000);
    fijar('mesero', 't-o1', 't-be2', null);
  });

  test('lo que NO se puede cambiar: una línea que no existe, una orden que no existe, el marcador «para llevar», un abono y una línea de promo; una línea manual cambia de precio (sin marca) y no tiene carta a la que volver', () => {
    DIA = 3;
    sql(`update public.ordenes set items = items || '[{"id":"abono_recibido_1","nombre":"Abono recibido","precio":-10000,"qty":1,"nota":"efectivo"}]'::jsonb where id = 't-o1';`);
    delta('t-o1', 'para_llevar', 'Para llevar', 0, 1);
    delta('t-o1', 'manual_x', 'Propina', 5000, 1);
    const v0 = orden('t-o1');
    const noExiste = fijar('mesero', 't-o1', 'no-hay', 1000);
    assert.equal(noExiste.ok, false);
    assert.match(noExiste.error, /la línea no-hay no existe en la orden t-o1/);
    const sinOrden = fijar('mesero', 'no-hay', 't-ej1', 1000);
    assert.equal(sinOrden.ok, false);
    assert.match(sinOrden.error, /orden no-hay no existe/, 'el mismo mensaje que aplicar_delta_orden: el POS ya lo sabe leer');
    for (const id of ['para_llevar', 'abono_recibido_1']) {
      const r = fijar('mesero', 't-o1', id, 1000);
      assert.equal(r.ok, false, id);
      assert.match(r.error, /22023/, `${id}: ${r.error}`);
      assert.match(r.error, /no se puede cambiar a mano/);
    }
    assert.deepEqual(orden('t-o1'), v0, 'nada cambió');
    const man = fijar('mesero', 't-o1', 'manual_x', 6500);
    assert.ok(man.ok, man.error);
    assert.equal(Number(linea(man.fila, 'manual_x').precio), 6500);
    assert.equal(linea(man.fila, 'manual_x').precio_manual, undefined, 'una línea manual no necesita marca: nadie la refresca');
    const volver = fijar('mesero', 't-o1', 'manual_x', null);
    assert.equal(volver.ok, false);
    assert.match(volver.error, /22023/);
    assert.match(volver.error, /es manual/);
    // la línea de promo: va con su base
    sql("set resplandor.dia_promo = 1;");
  });

  test('lunes, 3 almuerzos: la promo cuenta la línea con su precio A MANO (3.º a 80 % de 20.000 = 16.000), la línea de promo recuerda la marca, y cambiar el precio de la base recalcula la promo', () => {
    DIA = 1;
    abrir('t-o2', 92);
    delta('t-o2', 't-ej1', 'Menú Resplandor', 25000, 3);
    let o = orden('t-o2');
    assert.equal(Number(linea(o, 'promo:t-pr3:t-ej1').precio), 20000, 'sin precio a mano: 80 % de 25.000');
    const r = fijar('mesero', 't-o2', 't-ej1', 20000);
    assert.ok(r.ok, r.error);
    o = r.fila;
    assert.equal(linea(o, 't-ej1').qty, 2);
    assert.equal(Number(linea(o, 't-ej1').precio), 20000);
    assert.equal(linea(o, 't-ej1').precio_manual, true);
    const pr = linea(o, 'promo:t-pr3:t-ej1');
    assert.equal(Number(pr.precio), 16000, 'el descuento cae sobre el precio a mano');
    assert.equal(pr.qty, 1);
    assert.equal(Number(pr.promo.precio), 20000);
    assert.equal(pr.promo.precio_manual, true, 'la línea de promo recuerda que su base es a mano');
    assert.equal(pr.promo.precio_por, 'mesero1@resplandor.test');
    assert.equal(Number(o.total), 2 * 20000 + 16000);
    // cambiar el precio de la base (la línea de 2 unidades) vuelve a calcular todo: las 3 unidades al nuevo precio
    const otra = fijar('admin', 't-o2', 't-ej1', 21000);
    assert.ok(otra.ok, otra.error);
    assert.equal(Number(linea(otra.fila, 'promo:t-pr3:t-ej1').precio), 16800);
    assert.equal(Number(otra.fila.total), 2 * 21000 + 16800);
    // la línea de promo no se cambia a mano
    const promo = fijar('mesero', 't-o2', 'promo:t-pr3:t-ej1', 1000);
    assert.equal(promo.ok, false);
    assert.match(promo.error, /22023/);
    // un cambio de precio en Productos no la mueve, tampoco el descuento
    sql("update public.productos set precio = 30000 where id = 't-ej1';");
    o = orden('t-o2');
    assert.equal(Number(linea(o, 't-ej1').precio), 21000);
    assert.equal(Number(linea(o, 'promo:t-pr3:t-ej1').precio), 16800);
    // volver a la carta: base y promo siguen al catálogo (30.000 y 24.000)
    const carta = fijar('mesero', 't-o2', 't-ej1', null);
    assert.ok(carta.ok, carta.error);
    assert.equal(Number(linea(carta.fila, 't-ej1').precio), 30000);
    assert.equal(Number(linea(carta.fila, 'promo:t-pr3:t-ej1').precio), 24000);
    assert.equal(linea(carta.fila, 'promo:t-pr3:t-ej1').promo.precio_manual, undefined);
    sql("update public.productos set precio = 25000 where id = 't-ej1';");
  });

  test('normalizar_items directo: una base que la promo se llevó entera vuelve CON su precio a mano; sin la marca vuelve al de la carta; y es idempotente con líneas a mano y promos', () => {
    // domingo (7): sin promo ese día, la línea de una pasada anterior vuelve a su base
    const base = (extra) => `[{"id":"promo:t-pr3:t-ej1","nombre":"Menú · 3er almuerzo","precio":16000,"qty":2,"nota":"","promo":{"id":"t-pr3","de":"t-ej1","nombre":"Menú Resplandor","precio":20000,"descuento":20${extra}}}]`;
    const conMarca = pg.filas(`select privado.normalizar_items(${literal(base(',"precio_manual":true,"precio_por":"mesero1@resplandor.test"'))}::jsonb, 7::smallint) as r`)[0].r;
    assert.deepEqual(conMarca.map((i) => [i.id, i.qty, Number(i.precio), i.precio_manual, i.precio_por]), [['t-ej1', 2, 20000, true, 'mesero1@resplandor.test']]);
    const sinMarca = pg.filas(`select privado.normalizar_items(${literal(base(''))}::jsonb, 7::smallint) as r`)[0].r;
    assert.deepEqual(sinMarca.map((i) => [i.id, i.qty, Number(i.precio), i.precio_manual]), [['t-ej1', 2, 25000, undefined]], 'sin marca, el precio de hoy de la carta');
    const items = JSON.stringify([
      { id: 't-ej1', nombre: 'Menú Resplandor', precio: 20000, qty: 4, nota: '', precio_manual: true, precio_por: 'a@b.test' },
      { id: 't-ej2', nombre: 'Seco', precio: 7000, qty: 2, nota: '' },
      { id: 't-be2', nombre: 'Cerveza', precio: 5000, qty: 1, nota: '', precio_manual: true },
    ]);
    const r = pg.filas(`select privado.normalizar_items(${literal(items)}::jsonb, 1::smallint) as uno, privado.normalizar_items(privado.normalizar_items(${literal(items)}::jsonb, 1::smallint), 1::smallint) as dos`)[0];
    assert.deepEqual(r.dos, r.uno, 'normalizar dos veces es normalizar una');
    assert.equal(Number(r.uno.find((i) => i.id === 't-ej2').precio), 19000, 'la que no es a mano toma el de la carta');
    assert.equal(Number(r.uno.find((i) => i.id === 't-be2').precio), 5000, 'la de otra categoría con marca tampoco se refresca');
  });

  test('cobrar: el cierre de la cuenta lleva el precio a mano (la normalización del cierre lo respeta) y después un cambio de precio no toca la venta; una cuenta CERRADA rechaza el cambio (RS001 al admin, «no existe» al mesero)', () => {
    DIA = 3;
    const antesCierre = fijar('mesero', 't-o1', 't-ej1', 19500);
    assert.ok(antesCierre.ok, antesCierre.error);
    const ver = orden('t-o1').version;
    sql(`update public.ordenes set estado = 'cerrada', cerrada_en = now(), version = ${ver} where id = 't-o1';`);
    const cerrada = orden('t-o1');
    assert.equal(Number(linea(cerrada, 't-ej1').precio), 19500, 'el cierre no pisó el precio a mano');
    assert.equal(linea(cerrada, 't-ej1').precio_manual, true);
    sql("update public.productos set precio = 27000 where id = 't-ej1';");
    assert.deepEqual(orden('t-o1'), cerrada, 'la venta cerrada no cambia');
    const admin = fijar('admin', 't-o1', 't-ej1', 1000);
    assert.equal(admin.ok, false);
    assert.match(admin.error, /RS001/);
    assert.match(admin.error, /está cerrada/);
    const mesero = fijar('mesero', 't-o1', 't-ej1', 1000);
    assert.equal(mesero.ok, false);
    assert.match(mesero.error, /no existe/, 'la RLS no le muestra una cuenta cerrada al mesero');
    assert.deepEqual(orden('t-o1'), cerrada);
    sql("update public.productos set precio = 25000 where id = 't-ej1';");
  });

  test('el cobro por partes y «deshacer»: el pedazo cobrado lleva la marca y al devolverlo a la cuenta abierta la línea vuelve con su precio a mano', () => {
    DIA = 3;
    abrir('t-o3', 93);
    delta('t-o3', 't-ej1', 'Menú Resplandor', 25000, 2);
    const r = fijar('mesero', 't-o3', 't-ej1', 18000);
    assert.ok(r.ok, r.error);
    // cobro parcial: una venta cerrada nueva con una unidad (como la arma el POS: { ...item, qty }), y la abierta pierde esa unidad
    const it = linea(orden('t-o3'), 't-ej1');
    sql(`insert into public.ordenes (id, mesa_id, estado, items, total, parcial_de, cerrada_en) values ('t-o3-c', 93, 'cerrada', ${literal(JSON.stringify([{ ...it, qty: 1 }]))}::jsonb, 18000, 't-o3', now());`);
    delta('t-o3', 't-ej1', 'Menú Resplandor', 18000, -1);
    assert.equal(linea(orden('t-o3'), 't-ej1').qty, 1);
    sql("update public.productos set precio = 28000 where id = 't-ej1';");
    assert.equal(Number(linea(orden('t-o3'), 't-ej1').precio), 18000);
    const d = pg.sql("select public.deshacer_cobro('t-o3-c');", como('mesero'));
    assert.ok(d.ok, d.error);
    const o = orden('t-o3');
    assert.equal(linea(o, 't-ej1').qty, 2, 'la unidad cobrada volvió');
    assert.equal(Number(linea(o, 't-ej1').precio), 18000, 'y con su precio a mano');
    assert.equal(linea(o, 't-ej1').precio_manual, true);
    sql("update public.productos set precio = 25000 where id = 't-ej1';");
  });

  test('ninguna de las escrituras de arriba dejó un WARNING (los triggers tragan errores, pero no los hubo)', () => {
    assert.deepEqual(avisos, []);
  });

  test('aplicarla dos veces es inocua: el catálogo queda idéntico y las cuentas no cambian', () => {
    const cuentas = () => pg.filas('select id, items, total, version from public.ordenes order by id');
    const antesCuentas = cuentas();
    const otra = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.equal(otra.length, 1);
    assert.ok(otra[0].ok, otra[0].error);
    assert.deepEqual(otra[0].avisos, [], 'la segunda aplicación no deja WARNING');
    assert.deepEqual(radiografia(pg), despues);
    assert.deepEqual(cuentas(), antesCuentas);
  });

  test('la reversa de la cabecera corre en limpio; volver a pegar la migración del precio vivo deja el catálogo como ANTES (y el precio vivo vuelve a refrescar la línea a mano); reaplicar la mía lo deja como después', () => {
    DIA = 3;
    abrir('t-o4', 94);
    delta('t-o4', 't-ej1', 'Menú Resplandor', 25000, 1);
    assert.ok(fijar('mesero', 't-o4', 't-ej1', 15000).ok);
    const r = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(r.ok, 'la reversa falló: ' + r.error);
    assert.equal(pg.filas("select to_regprocedure('public.fijar_precio_item(text, text, numeric)') is null as n")[0].n, true);
    const previa = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: PREVIA, hasta: PREVIA });
    assert.ok(previa[0].ok, previa[0].error);
    assert.deepEqual(previa[0].avisos, []);
    const ahora = radiografia(pg);
    for (const [seccion, filas] of Object.entries(antes)) assert.deepEqual(ahora[seccion], filas, `tras la reversa quedó distinto: ${seccion}`);
    sql("update public.productos set precio = 26000 where id = 't-ej1';");
    assert.equal(Number(linea(orden('t-o4'), 't-ej1').precio), 26000, 'con la versión de antes, la marca no se mira: el precio vivo la refresca');
    sql("update public.productos set precio = 25000 where id = 't-ej1';");
    const reaplicada = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION, hasta: MIGRACION });
    assert.ok(reaplicada[0].ok, 'no se pudo volver a aplicar tras la reversa: ' + reaplicada[0].error);
    assert.deepEqual(reaplicada[0].avisos, []);
    assert.deepEqual(radiografia(pg), despues, 'reaplicar tras la reversa deja el catálogo como la primera vez');
    sql("update public.ordenes set estado = 'cerrada', cerrada_en = now() where estado = 'abierta';");
  });
});

describe('se niega a correr, sin cambiar nada, si falta el precio vivo (Postgres desechable propio)', { skip: MOTIVO }, () => {
  let pg;
  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
  }, { timeout: 600000 });
  after(() => { if (pg) pg.parar(); });

  test('sin 20261005100000: error claro y NADA creado; con la cadena completa, se aplica sin avisos', () => {
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: PREVIA });
    assert.ok(previas.length >= 12 && previas.every((m) => m.ok), JSON.stringify(previas.filter((m) => !m.ok)));
    const a0 = radiografia(pg);
    const sinPrecioVivo = pg.sql(SQL, { como: 'migrador' });
    assert.equal(sinPrecioVivo.ok, false);
    assert.match(sinPrecioVivo.error, /Falta 20261005100000_precio_vivo_y_promos\.sql.*No se cambió nada/s);
    assert.deepEqual(radiografia(pg), a0, 'sin el precio vivo: no dejó nada creado');
    assert.equal(pg.filas("select to_regprocedure('public.fijar_precio_item(text, text, numeric)') is null as n")[0].n, true);
    const resto = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: PREVIA, antesDe: MIGRACION });
    assert.ok(resto.every((m) => m.ok), JSON.stringify(resto.filter((m) => !m.ok)));
    const bien = pg.sql(SQL, { como: 'migrador' });
    assert.ok(bien.ok, bien.error);
    assert.deepEqual(bien.avisos, []);
  });
});
