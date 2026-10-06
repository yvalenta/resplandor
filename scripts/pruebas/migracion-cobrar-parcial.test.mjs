// Cobrar por partes y abonar ATÓMICOS en la base: supabase/migrations/20261005140000_cobrar_parcial.sql (`cobrar_parcial`, `cobrar_abono`, `privado.items_de_hoy`).
// Tercera refutación del 2026-10-05 a «cobrar por partes con promoción» (tareas/2026-10-04-hallazgos-domingo.md): el cobro hecho como «fila cerrada + deltas −qty por la cola» no
// converge —el orden de llegada decide el dinero— y la clase entera se cierra con UNA llamada atómica bajo candado de la cuenta.
//
// Dos partes, como migracion-promo-cobro-por-partes.test.mjs:
//   1. ESTÁTICA (corre siempre, también en CI): el texto de la migración. Firmas, SECURITY INVOKER, permisos (ni public ni anon), el candado de aviso, que se anote el id ANTES de bloquear la
//      cuenta, el orden de los juicios (versión, archivada, promoción, líneas), los códigos RS003 / RS005 / RS006 con los mensajes que el POS reconoce, los requisitos, que no cree datos ni toque
//      otras funciones, y la reversa de la cabecera.
//   2. CONTRA UN POSTGRES 17 DESECHABLE (solo si hay Docker): la cadena COMPLETA de migraciones y, con un mesero, un admin y gente que no es del personal de verdad (RLS):
//        · la versión vieja (RS003); dos cobros a la vez sobre la misma cuenta, de verdad (dos sesiones): uno entra y el otro RS003; una cuenta con promoción, o que la tendría (RS005);
//        · lo pedido que la cuenta no tiene, las cantidades inválidas, lo que no se cobra por partes (RS006); la cuenta intacta tras cada rechazo;
//        · idempotencia por p_delta_id (repetir devuelve lo mismo sin duplicar; tras deshacer, RS003); el abono (versión, monto, método, promoción, idempotencia, deshacer);
//        · «deshacer» con las ventas que crea la RPC: la unidad vuelve y la promo se recalcula; el cierre del día suma lo registrado;
//        · los guiones de la segunda y la tercera refutación (80.200, 57.000, 54.000 / 50.400) ya no pueden producirse;
//        · pasos al azar con las invariantes (el total es la suma, ninguna unidad se pierde ni se duplica, ninguna venta por partes lleva promo);
//        · permisos (anon no ejecuta; quien no es del personal no ve la cuenta), se aplica dos veces sin cambiar nada, la reversa, y se niega a correr, sin cambiar nada, si falta lo previo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, DIR_MIGRACIONES, prepararSimulacion, aplicarMigraciones, radiografia, reversa, carrera, fijarDiaPromo } from './_cola-impresion-pg.mjs';

const NUEVA = '20261005140000_cobrar_parcial.sql';
const GUARDIA = '20261005130000_promo_cobro_por_partes.sql';
const PRECIO_VIVO = '20261005100000_precio_vivo_y_promos.sql';
const DESHACER = '20261002180000_deshacer_cobro.sql';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SQL = leer(`supabase/migrations/${NUEVA}`);
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const compacto = (s) => s.replace(/\s+/g, ' ').trim();
const CODIGO = sinComentarios(SQL);
const CP = compacto(CODIGO);
/** El cuerpo $function$ … $function$ de la función que empieza con `firma`. */
const funcion = (firma) => {
  const i = CP.indexOf(firma);
  assert.ok(i >= 0, `no encuentro «${firma}»`);
  const ini = CP.indexOf('$function$', i);
  const fin = CP.indexOf('$function$', ini + 10);
  assert.ok(ini > 0 && fin > ini, `no encuentro el cuerpo de ${firma}`);
  return CP.slice(ini, fin);
};

// ───────────────────────── 1. estática ─────────────────────────

test('va después de la guardia, con prefijo único, y las migraciones anteriores NO se tocaron (la guardia se queda: es la red de seguridad de una tablet con el POS de antes)', () => {
  const nombres = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  const prefijos = nombres.map((n) => n.split('_')[0]);
  assert.equal(new Set(prefijos).size, prefijos.length, 'dos migraciones con el mismo prefijo');
  assert.ok(nombres.indexOf(GUARDIA) < nombres.indexOf(NUEVA), 'se aplica después de la guardia');
  // Después de ella solo vienen las de main (los cierres por día y el precio a mano, 20261006…) y la que une normalizar_items (20261006140000): ninguna toca el cobro atómico.
  const siguientes = nombres.slice(nombres.indexOf(NUEVA) + 1);
  assert.ok(siguientes.length > 0 && siguientes.every((n) => n.startsWith('20261006')), `lo que sigue al cobro atómico: ${siguientes}`);
  assert.equal(siguientes[siguientes.length - 1], '20261006140000_normalizar_items_pliegue_y_precio_a_mano.sql', 'la última de la cadena es la unión de normalizar_items');
  const guardia = compacto(sinComentarios(leer(`supabase/migrations/${GUARDIA}`)));
  assert.ok(guardia.includes('create trigger trg_ordenes_guardia_promo before insert on public.ordenes'), 'la guardia del cobro por partes sigue en su migración');
  const viva = compacto(sinComentarios(leer(`supabase/migrations/${PRECIO_VIVO}`)));
  assert.doesNotMatch(viva, /cobrar_parcial|cobrar_abono|items_de_hoy/, 'las migraciones de main no conocen estas funciones');
  assert.doesNotMatch(CP, /ordenes_guardia_promo|normalizar_items\(p_items jsonb, p_dia smallint\)/, 'esta migración no redefine la guardia ni normalizar_items');
});

test('las firmas son las del diseño, SECURITY INVOKER, search_path vacío, y los permisos son los de aplicar_delta_orden: execute solo para authenticated y service_role', () => {
  assert.match(CP, /create or replace function public\.cobrar_parcial\(p_orden_id text, p_version integer, p_venta jsonb, p_lineas jsonb, p_delta_id text\) returns jsonb language plpgsql set search_path = '' as \$function\$/);
  assert.match(CP, /create or replace function public\.cobrar_abono\(p_orden_id text, p_version integer, p_venta jsonb, p_monto numeric, p_metodo text, p_delta_id text\) returns jsonb language plpgsql set search_path = '' as \$function\$/);
  for (const f of ['public.cobrar_parcial(text, integer, jsonb, jsonb, text)', 'public.cobrar_abono(text, integer, jsonb, numeric, text, text)']) {
    assert.ok(CP.includes(`revoke all on function ${f} from public, anon;`), `revoke ${f}`);
    assert.ok(CP.includes(`grant execute on function ${f} to authenticated, service_role;`), `grant ${f}`);
  }
  assert.doesNotMatch(CP.match(/create or replace function public\.cobrar_parcial.*?\$function\$ language/)?.[0] || CP.slice(0, 0), /security definer/i);
  const cabecera = (firma) => CP.slice(CP.indexOf(firma), CP.indexOf('$function$', CP.indexOf(firma)));
  assert.doesNotMatch(cabecera('create or replace function public.cobrar_parcial'), /security definer/i, 'cobrar_parcial corre como quien llama');
  assert.doesNotMatch(cabecera('create or replace function public.cobrar_abono'), /security definer/i, 'cobrar_abono corre como quien llama');
  assert.match(cabecera('create or replace function privado.items_de_hoy'), /security definer set search_path = ''/, 'el ayudante sí es SECURITY DEFINER (para preguntar por las promos sin darle EXECUTE a la API sobre normalizar_items)');
  assert.ok(CP.includes('revoke all on function privado.items_de_hoy(jsonb) from public, anon, authenticated;'));
  assert.ok(CP.includes('grant execute on function privado.items_de_hoy(jsonb) to authenticated, service_role;'));
  assert.doesNotMatch(CP, /grant execute on function privado\.normalizar_items|grant [^;]*\bto anon\b|grant [^;]*\bto public\b/);
});

test('cobrar_parcial: candado de aviso `resplandor.cobros`, el id se anota ANTES de bloquear la cuenta, y los juicios van en orden: versión (RS003), archivada, promoción (RS005), líneas (RS006)', () => {
  const f = funcion('create or replace function public.cobrar_parcial');
  const en = (frag) => { const i = f.indexOf(frag); assert.ok(i >= 0, `falta «${frag}»`); return i; };
  assert.ok(en("perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));") < en('privado.delta_registrar(p_delta_id, p_orden_id)'), 'primero el candado de aviso');
  assert.ok(en('privado.delta_registrar(p_delta_id, p_orden_id)') < en('for update;'), 'el id se anota antes de bloquear la cuenta (como aplicar_delta_orden)');
  const orden = ['for update;', "raise exception 'orden % está cerrada'", 'if p_version is distinct from o.version', 'privado.orden_archivada(o.id)', 'privado.items_de_hoy(o.items)', "like 'promo:%'",
    "v_id like 'abono\\_%'", 'if v_pedido <> ', 'if v_total_quedan < 0', 'insert into public.ordenes', 'update public.ordenes'];
  let previo = -1;
  for (const frag of orden) { const i = f.indexOf(frag, previo + 1); assert.ok(i > previo, `«${frag}» no va después del anterior`); previo = i; }
  assert.match(f, /raise exception 'la cuenta de la orden % cambió desde que se vio: revísala antes de cobrar', o\.id using errcode = 'RS003'/);
  assert.match(f, /raise exception 'la cuenta % tiene una promoción: el descuento se calcula con toda la cuenta junta, así que no se puede cobrar por partes ni por persona', o\.id using errcode = 'RS005'/);
  assert.match(f, /raise exception 'la cuenta % ya estaba en un cierre del día: no se puede cobrar por partes; revísala con el admin', o\.id using errcode = 'RS005'/);
  assert.match(f, /raise exception 'orden % está cerrada', p_orden_id using errcode = 'RS001'/);
  assert.match(f, /raise exception 'orden % no existe', p_orden_id;/);
  assert.equal((f.match(/errcode = 'RS006'/g) || []).length >= 6, true, 'RS006 para lo que la cuenta no tiene o no se cobra');
  // idempotente: repetir devuelve lo mismo; si esa venta ya no existe, RS003
  assert.match(f, /'repetido', true/);
  assert.match(f, /ese cobro ya no existe[^']*' , p_orden_id using errcode = 'RS003'|ese cobro ya no existe[^']*', p_orden_id using errcode = 'RS003'/);
  // el cobro: la venta cerrada con parcial_de y el total que calcula la base; la cuenta sube de versión
  assert.match(f, /insert into public\.ordenes \(id, mesa_id, estado, items, total, abierta_en, cerrada_en, parcial_de\) values \(v_venta_id, o\.mesa_id, 'cerrada', v_items_venta, v_total_venta, o\.abierta_en, now\(\), o\.id\)/);
  assert.match(f, /update public\.ordenes set items = v_items_quedan, total = v_total_quedan, version = coalesce\(o\.version, 0\) \+ 1, updated_at = now\(\) where id = o\.id/);
  // el marcador «para llevar» de la cuenta viaja con una copia en la venta (cantidad 1)
  assert.match(f, /\(e ->> 'id'\) = 'para_llevar'[\s\S]*jsonb_set\(v_marcador, '\{qty\}', to_jsonb\(1\)\)/);
});

test('cobrar_abono: lo mismo para el abono (candado, id anotado antes, versión, archivada), monto entero menor que lo que falta, método válido, y SIN juicio de promoción (un abono sí entra en una cuenta con promoción)', () => {
  const f = funcion('create or replace function public.cobrar_abono');
  assert.ok(f.indexOf("pg_advisory_xact_lock(hashtext('resplandor.cobros'))") < f.indexOf('privado.delta_registrar(p_delta_id, p_orden_id)'));
  assert.ok(f.indexOf('privado.delta_registrar(p_delta_id, p_orden_id)') < f.indexOf('for update;'));
  assert.match(f, /if p_version is distinct from o\.version then raise exception '[^']*cambió desde que se vio[^']*', o\.id using errcode = 'RS003'/);
  assert.match(f, /privado\.orden_archivada\(o\.id\)/);
  assert.doesNotMatch(f, /like 'promo:%'/, 'un abono no mira promociones: no saca unidades');
  assert.match(f, /p_monto <> trunc\(p_monto\) or p_monto <= 0/);
  assert.match(f, /p_metodo not in \('efectivo', 'qr', 'transferencia'\)/);
  assert.match(f, /if p_monto >= v_pendiente then raise exception/);
  assert.match(f, /v_uid !~ '\^\[a-z0-9\]\{1,60\}\$'/, 'el uid solo lleva a-z y 0-9: abono_recibido_ no se confunde con abono_ + uid');
  assert.match(f, /'abono_' \|\| v_uid, 'nombre', 'Abono', 'precio', p_monto, 'qty', 1, 'nota', p_metodo/);
  assert.match(f, /'abono_recibido_' \|\| v_uid, 'nombre', 'Abono recibido', 'precio', -p_monto, 'qty', 1, 'nota', p_metodo/);
});

test('requisitos ANTES de crear nada; sin datos (el repo es público); la comprobación final prueba permisos, INVOKER/DEFINER y el ayudante; la reversa de la cabecera nombra lo que crea', () => {
  const iPrimero = Math.min(CODIGO.indexOf('create or replace function'), CODIGO.indexOf('drop function'));
  const requisitos = CODIGO.slice(0, iPrimero);
  // lo único que se quita es la firma de antes de 312eb93 de su propio ayudante (el día lo daba abierta_en): no queda un segundo juez del día
  assert.deepEqual(CODIGO.match(/drop function[^;]*;/g), ['drop function if exists privado.items_de_hoy(jsonb, timestamp with time zone);']);
  assert.match(requisitos, /to_regprocedure\('privado\.normalizar_items\(jsonb,smallint\)'\) is null[\s\S]*Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
  assert.match(requisitos, /to_regprocedure\('privado\.dia_promo\(\)'\) is null[\s\S]*Falta privado\.dia_promo[\s\S]*312eb93[\s\S]*No se cambió nada/, 'pide el día de la promo de la escritura (312eb93)');
  assert.match(requisitos, /to_regprocedure\('privado\.delta_registrar\(text,text\)'\) is null[\s\S]*Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/);
  assert.doesNotMatch(requisitos, /\bcreate\b|\balter\b|\bdrop\b|\binsert\b|\bupdate\b/i);
  assert.doesNotMatch(SQL, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ni un correo');
  const fuera = CP.replace(/\$function\$.*?\$function\$/g, ' ').replace(/\$\$.*?\$\$/g, ' ').replace(/'[^']*'/g, ' ');
  assert.doesNotMatch(fuera, /\b(insert into|delete from|update \S+ set|create table|alter table|create policy|create trigger)\b/i, 'fuera de los cuerpos no escribe datos ni cambia tablas, policies o triggers');
  const final = CODIGO.slice(CODIGO.lastIndexOf('do $$'));
  assert.match(final, /has_function_privilege\('anon', 'public\.cobrar_parcial/);
  assert.match(final, /p\.prosecdef/);
  assert.match(final, /privado\.items_de_hoy cambió una línea manual/);
  const rev = reversa(SQL);
  assert.match(rev, /drop function if exists public\.cobrar_parcial\(text, integer, jsonb, jsonb, text\);/);
  assert.match(rev, /drop function if exists public\.cobrar_abono\(text, integer, jsonb, numeric, text, text\);/);
  assert.match(rev, /drop function if exists privado\.items_de_hoy\(jsonb\);/);
  assert.match(rev, /drop function if exists privado\.items_de_hoy\(jsonb, timestamp with time zone\);/, 'y la firma de antes de 312eb93, por si se llegó a crear');
  for (const frase of ['REVERSA', 'Idempotente', 'lo aplica Yonatan: aparca', 'ANTES de publicar el POS', 'RS006', 'se turnan']) {
    assert.ok(SQL.includes(frase), `la cabecera no dice «${frase}»`);
  }
});

// ───────────────────────── 2. contra un Postgres 17 desechable ─────────────────────────

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

// Ayudantes de las pruebas (esquema t, que prepararSimulacion ya creó): corren con el rol de quien los llama, como el POS.
const AYUDANTES = String.raw`
-- «Lo que se ve»: las líneas de una orden como «2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200».
create or replace function t.ver(p_orden text) returns text language sql as
$$ select coalesce((select string_agg((e ->> 'qty') || '×' || (e ->> 'nombre') || '@' || (e ->> 'precio'), ' + ' order by o)
                      from public.ordenes x, jsonb_array_elements(x.items) with ordinality as q(e, o) where x.id = p_orden), '(vacía)')
       || ' = ' || coalesce((select total::text from public.ordenes where id = p_orden), '-') $$;

-- cobrar_parcial como quien está conectado: 'ok {json}' o 'SQLSTATE mensaje'. Cada llamada es su propia sentencia (como una petición del POS).
create or replace function t.cp(p_orden text, p_version int, p_venta text, p_lineas jsonb, p_delta text) returns text language plpgsql as
$$ begin
  return 'ok ' || public.cobrar_parcial(p_orden, p_version, jsonb_build_object('id', p_venta), p_lineas, p_delta)::text;
exception when others then return sqlstate || ' ' || sqlerrm; end $$;

create or replace function t.ca(p_orden text, p_version int, p_venta text, p_uid text, p_monto numeric, p_metodo text, p_delta text) returns text language plpgsql as
$$ begin
  return 'ok ' || public.cobrar_abono(p_orden, p_version, jsonb_build_object('id', p_venta, 'uid', p_uid), p_monto, p_metodo, p_delta)::text;
exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- La versión de una cuenta.
create or replace function t.v(p_orden text) returns int language sql as $$ select version from public.ordenes where id = p_orden $$;

-- Cobra la mesa completa, como el upsert del POS: UPDATE a cerrada con la version que se vio.
create or replace function t.cobrar_todo(p_orden text) returns numeric language plpgsql as
$$ declare v int; r numeric; begin
  select version into v from public.ordenes where id = p_orden;
  update public.ordenes set estado = 'cerrada', cerrada_en = now(), version = v where id = p_orden returning total into r;
  return r;
end $$;

-- Deja la base sin cuentas, sin ventas ni cierres (como el dueño: ningún guardia de la API se mete).
create or replace function t.limpiar() returns void language plpgsql as
$$ begin
  perform t.fuera();
  delete from public.deshechos; delete from public.alertas; delete from public.ordenes; delete from public.cierres; delete from public.cierre_ordenes; delete from public.deltas_aplicados;
  update public.mesas set estado = 'libre';
end $$;
`;

// La simulación al azar vive en la base (plpgsql): cada paso se hace con el rol de un mesero (RLS) y después se revisan las invariantes como dueño.
const SIMULACION = String.raw`
-- El total de una cuenta del LUNES calculado sin normalizar_items: las unidades de Seco y Menú de mayor a menor precio; la 3.ª, 6.ª… lleva 20 %.
create or replace function t.sim_oraculo(p_items jsonb) returns numeric language plpgsql as $$
declare v_tot numeric := 0; v_pos int := 0; e jsonb; q int; k int; v_p numeric;
begin
  for e in select x from jsonb_array_elements(p_items) x where (x ->> 'id') not like 'abono\_%' loop
    q := (e ->> 'qty')::int; v_p := (e ->> 'precio')::numeric;
    if split_part(coalesce(e -> 'promo' ->> 'de', e ->> 'id'), '__', 1) not in ('zc-seco', 'zc-menu') or v_p <= 0 then v_tot := v_tot + v_p * q; end if;
  end loop;
  for e in select x from jsonb_array_elements(p_items) x
            where (x ->> 'id') not like 'abono\_%' and split_part(coalesce(x -> 'promo' ->> 'de', x ->> 'id'), '__', 1) in ('zc-seco', 'zc-menu')
            order by coalesce((x -> 'promo' ->> 'precio')::numeric, (x ->> 'precio')::numeric) desc loop
    q := (e ->> 'qty')::int; v_p := coalesce((e -> 'promo' ->> 'precio')::numeric, (e ->> 'precio')::numeric);
    for k in 1 .. q loop
      v_pos := v_pos + 1;
      v_tot := v_tot + case when v_pos % 3 = 0 then round(v_p * 0.8) else v_p end;
    end loop;
  end loop;
  return v_tot;
end $$;

create or replace function t.sim_invariantes(p_id text, p_neto jsonb) returns text language plpgsql as $$
declare o public.ordenes; v_suma numeric; v_elegibles int; v_promo int; r record; v_abierto int; v_cerrado int;
begin
  select * into o from public.ordenes where id = p_id;
  select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_suma from jsonb_array_elements(o.items) e;
  if o.total is distinct from v_suma then return 'el total ' || o.total || ' no es la suma de las líneas ' || v_suma; end if;
  select coalesce(sum((e ->> 'qty')::int), 0) into v_elegibles from jsonb_array_elements(o.items) e
   where split_part(coalesce(e -> 'promo' ->> 'de', e ->> 'id'), '__', 1) in ('zc-seco', 'zc-menu') and (e ->> 'id') not like 'abono\_%';
  select coalesce(sum((e ->> 'qty')::int), 0) into v_promo from jsonb_array_elements(o.items) e where (e ->> 'id') like 'promo:%';
  if v_promo <> v_elegibles / 3 then return 'hay ' || v_promo || ' unidades con descuento y ' || v_elegibles || ' elegibles (deberían ser ' || (v_elegibles / 3) || ')'; end if;
  if exists (select 1 from jsonb_array_elements(o.items) e where (e ->> 'id') like 'promo:%'
              and (not (e ? 'promo') or e ->> 'id' <> 'promo:' || (e -> 'promo' ->> 'id') || ':' || (e -> 'promo' ->> 'de'))) then return 'una línea de promo suelta o mal formada: ' || o.items::text; end if;
  select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_suma from jsonb_array_elements(o.items) e where (e ->> 'id') not like 'abono\_%';
  if v_suma is distinct from t.sim_oraculo(o.items) then return 'el total de las líneas ' || v_suma || ' no es el del cálculo independiente ' || t.sim_oraculo(o.items) || ': ' || o.items::text; end if;
  if exists (select 1 from public.ordenes c, jsonb_array_elements(c.items) e where c.parcial_de = p_id and c.estado = 'cerrada' and (e ->> 'id') like 'promo:%') then
    return 'una venta por partes lleva una línea de promo';
  end if;
  for r in select k.key as prod, k.value::int as neto from jsonb_each_text(p_neto) k loop
    select coalesce(sum((e ->> 'qty')::int), 0) into v_abierto from jsonb_array_elements(o.items) e where split_part(coalesce(e -> 'promo' ->> 'de', e ->> 'id'), '__', 1) = r.prod;
    select coalesce(sum((e ->> 'qty')::int), 0) into v_cerrado from public.ordenes c, jsonb_array_elements(c.items) e
     where c.parcial_de = p_id and c.estado = 'cerrada' and (e ->> 'id') not like 'abono\_%' and split_part(coalesce(e -> 'promo' ->> 'de', e ->> 'id'), '__', 1) = r.prod;
    if v_abierto + v_cerrado <> r.neto then return 'unidades de ' || r.prod || ': agregadas − quitadas = ' || r.neto || ' pero hay ' || v_abierto || ' en la cuenta y ' || v_cerrado || ' en ventas por partes'; end if;
  end loop;
  -- lo cobrado por la RPC: cada venta por partes suma lo que dicen sus líneas, y tiene su parcial_de
  if exists (select 1 from public.ordenes c where c.parcial_de = p_id and c.estado = 'cerrada'
               and c.total is distinct from (select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) from jsonb_array_elements(c.items) e)) then
    return 'una venta por partes no suma sus líneas';
  end if;
  return null;
end $$;

create or replace function t.simular(p_semilla double precision, p_pasos int, p_mesa int) returns jsonb language plpgsql as $$
declare
  v_id text := 'sim-' || p_mesa;
  v_catalogo text[][] := array[['zc-seco', 'Seco', '19000'], ['zc-menu', 'Menú Resplandor', '23000'], ['zc-sopa', 'Sopa', '7000'], ['zc-jugo', 'Jugo natural', '12000']];
  v_neto jsonb := '{}'::jsonb;
  v_aceptados int := 0; v_rechazados int := 0; v_negativos int := 0; v_viejos int := 0; v_abonos int := 0; v_deshechos int := 0; v_paso int; v_op int; v_k int; v_prod text;
  v_lineas jsonb; o public.ordenes; v_err text; v_hay_promo boolean; v_cobro text; v_monto numeric; v_res jsonb; v_r text; v_ver int; v_stale boolean; v_sub numeric; v_antes numeric;
begin
  perform setseed(p_semilla);
  perform t.limpiar();
  insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (v_id, p_mesa, 'abierta', '[]', 0, '2026-10-05 17:00:00+00');
  for v_paso in 1 .. p_pasos loop
    v_op := floor(random() * 100);
    perform t.como('mesero');
    begin
      if v_op < 30 then                                                         -- agregar una unidad
        v_k := 1 + floor(random() * 4);
        perform public.aplicar_delta_orden(v_id, v_catalogo[v_k][1], v_catalogo[v_k][2], v_catalogo[v_k][3]::numeric, 1, '');
        v_neto := jsonb_set(v_neto, array[v_catalogo[v_k][1]], to_jsonb(coalesce((v_neto ->> v_catalogo[v_k][1])::int, 0) + 1));
      elsif v_op < 42 then                                                      -- quitar una unidad de una línea BASE (el POS no deja tocar una línea de promo)
        select e ->> 'id' into v_prod from public.ordenes x, jsonb_array_elements(x.items) e
         where x.id = v_id and (e ->> 'id') not like 'promo:%' and (e ->> 'id') not like 'abono\_%' order by random() limit 1;
        if v_prod is not null then
          perform public.aplicar_delta_orden(v_id, v_prod, 'x', 1, -1, '');
          v_neto := jsonb_set(v_neto, array[split_part(v_prod, '__', 1)], to_jsonb(coalesce((v_neto ->> split_part(v_prod, '__', 1))::int, 0) - 1));
        end if;
      elsif v_op < 70 then                                                      -- cobrar por partes: un subconjunto al azar de las líneas, cada una con 1..qty unidades
        select jsonb_agg(jsonb_build_object('id', e ->> 'id', 'qty', 1 + floor(random() * (e ->> 'qty')::int)::int))
          into v_lineas
          from public.ordenes x, jsonb_array_elements(x.items) e
         where x.id = v_id and (e ->> 'id') not like 'abono\_%' and random() < 0.5;
        if v_lineas is not null then
          v_cobro := 'sp-' || p_mesa || '-' || v_paso;
          select exists (select 1 from jsonb_array_elements(x.items) e where (e ->> 'id') like 'promo:%'), t.v(v_id), x.total into v_hay_promo, v_ver, v_antes from public.ordenes x where x.id = v_id;
          select coalesce(sum((e ->> 'precio')::numeric * (l ->> 'qty')::int), 0) into v_sub
            from jsonb_array_elements(v_lineas) l join public.ordenes x on x.id = v_id, jsonb_array_elements(x.items) e where e ->> 'id' = l ->> 'id';
          v_stale := random() < 0.15;                                           -- una tablet atrasada: manda una versión vieja
          v_r := t.cp(v_id, case when v_stale then v_ver - 1 else v_ver end, v_cobro, v_lineas, 'd-' || v_cobro);
          if v_stale then
            if left(v_r, 5) <> 'RS003' then raise exception 'una versión vieja se dejó pasar (paso %): %', v_paso, v_r; end if;
            v_viejos := v_viejos + 1;
          elsif v_hay_promo then
            if left(v_r, 5) <> 'RS005' then raise exception 'SE DEJÓ cobrar por partes una cuenta con promoción (paso %): %', v_paso, v_r; end if;
            v_rechazados := v_rechazados + 1;
          elsif v_sub > v_antes then                                            -- con abonos recibidos, cobrar más de lo que falta dejaría la cuenta en negativo
            if left(v_r, 5) <> 'RS006' then raise exception 'SE DEJÓ cobrar más de lo que falta (paso %): %', v_paso, v_r; end if;
            v_negativos := v_negativos + 1;
          else
            if left(v_r, 2) <> 'ok' then raise exception 'se RECHAZÓ un cobro por partes sin promoción (paso %): %', v_paso, v_r; end if;
            v_aceptados := v_aceptados + 1;
          end if;
        end if;
      elsif v_op < 80 then                                                      -- un abono por un monto cualquiera menor que lo que falta
        select * into o from public.ordenes where id = v_id;
        if o.total >= 3000 then
          v_monto := 1000 * (1 + floor(random() * ((o.total / 1000)::int - 1)));
          v_cobro := 'sa-' || p_mesa || '-' || v_paso;
          v_r := t.ca(v_id, o.version, v_cobro, 'u' || p_mesa || 'x' || v_paso, v_monto, 'efectivo', 'd-' || v_cobro);
          if left(v_r, 2) <> 'ok' then raise exception 'se RECHAZÓ un abono válido (paso %): %', v_paso, v_r; end if;
          v_abonos := v_abonos + 1;
        end if;
      elsif v_op < 92 then                                                      -- deshacer un cobro (por partes o abono) de esta cuenta
        select c.id into v_cobro from public.ordenes c where c.parcial_de = v_id and c.estado = 'cerrada' order by random() limit 1;
        if v_cobro is not null then
          v_res := public.deshacer_cobro(v_cobro);
          if (v_res ->> 'ok') <> 'true' then raise exception 'deshacer_cobro % respondió %', v_cobro, v_res; end if;
          v_deshechos := v_deshechos + 1;
        end if;
      end if;
    exception when others then
      perform t.fuera();
      return jsonb_build_object('semilla', p_semilla, 'paso', v_paso, 'op', v_op, 'falla', sqlerrm, 'cuenta', (select t.ver(v_id)));
    end;
    perform t.fuera();
    v_err := t.sim_invariantes(v_id, v_neto);
    if v_err is not null then
      return jsonb_build_object('semilla', p_semilla, 'paso', v_paso, 'op', v_op, 'falla', v_err, 'cuenta', (select t.ver(v_id)));
    end if;
  end loop;
  -- Al final, la mesa completa se cobra (si los abonos no la dejaron en negativo: la RLS no deja cerrar una cuenta con total negativo)
  select * into o from public.ordenes where id = v_id;
  if o.total >= 0 then
    perform t.como('mesero');
    perform t.cobrar_todo(v_id);
    perform t.fuera();
  end if;
  return jsonb_build_object('semilla', p_semilla, 'aceptados', v_aceptados, 'rechazados', v_rechazados, 'negativos', v_negativos, 'viejos', v_viejos, 'abonos', v_abonos, 'deshechos', v_deshechos);
end $$;
`;

describe('contra un Postgres 17 desechable: cobrar_parcial y cobrar_abono con un mesero, un admin y gente de fuera de verdad (RLS)', { skip: MOTIVO }, () => {
  let pg;
  let antes;
  const comoMesero = (texto) => pg.sql(`select t.como('mesero');\n${texto}`);
  const comoAdmin = (texto) => pg.sql(`select t.como('admin');\n${texto}`);
  const sql = (texto, opciones) => { const r = pg.sql(texto, opciones); assert.ok(r.ok, r.error); return r; };
  const una = (select) => pg.filas(select)[0];
  const aplicarNueva = () => pg.sql(SQL, { como: 'migrador' });
  const limpiar = () => sql('select t.limpiar();');
  const ultima = (r) => r.salida.split('\n').pop();
  /** Una cuenta abierta del lunes 2026-10-05 12:00 (Bogotá) en la mesa `mesa`, con los ítems dados; la base la normaliza (precio de hoy y promo del día). */
  const cuenta = (id, mesa, items, dia = '2026-10-05 17:00:00+00') => sql(`select t.fuera(); insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values (${literal(id)}, ${mesa}, 'abierta', ${literal(JSON.stringify(items))}::jsonb, 0, '${dia}'); update public.mesas set estado = 'ocupada' where id = ${mesa};`);
  const ver = (id) => una(`select t.ver(${literal(id)}) as v`).v;
  const total = (id) => Number(una(`select total from public.ordenes where id = ${literal(id)}`).total);
  const version = (id) => Number(una(`select version from public.ordenes where id = ${literal(id)}`).version);
  const ventas = () => pg.filas("select id, total, parcial_de, items, cerrada_en from public.ordenes where estado = 'cerrada' order by id");
  const foto = (id) => una(`select version, items, total, estado from public.ordenes where id = ${literal(id)}`);
  const SECO = (qty) => ({ id: 'zc-seco', nombre: 'Seco', precio: 19000, qty, nota: '' });
  const MENU = (qty) => ({ id: 'zc-menu', nombre: 'Menú Resplandor', precio: 23000, qty, nota: '' });
  const SOPA = (qty) => ({ id: 'zc-sopa', nombre: 'Sopa', precio: 7000, qty, nota: '' });
  const JUGO = (qty) => ({ id: 'zc-jugo', nombre: 'Jugo natural', precio: 12000, qty, nota: '' });
  const PROMO_SECO = 'promo:zc-promo:zc-seco';
  /** Llama cobrar_parcial como quien dice `rol` (mesero | admin) y devuelve {ok, codigo, texto, json}. */
  const lit = (x) => (x === null ? 'null' : literal(x));
  const cobrar = (rol, orden, v, venta, lineas, delta) => {
    const r = pg.sql(`select t.como(${literal(rol)});\nselect t.cp(${lit(orden)}, ${v}, ${lit(venta)}, ${literal(JSON.stringify(lineas))}::jsonb, ${lit(delta)});`);
    assert.ok(r.ok, r.error);
    return leerRespuesta(ultima(r));
  };
  const abonar = (rol, orden, v, venta, uid, monto, metodo, delta) => {
    const r = pg.sql(`select t.como(${literal(rol)});\nselect t.ca(${lit(orden)}, ${v}, ${lit(venta)}, ${lit(uid)}, ${monto}, ${lit(metodo)}, ${lit(delta)});`);
    assert.ok(r.ok, r.error);
    return leerRespuesta(ultima(r));
  };
  const leerRespuesta = (linea) => {
    if (linea.startsWith('ok ')) return { ok: true, json: JSON.parse(linea.slice(3)) };
    const i = linea.indexOf(' ');
    return { ok: false, codigo: linea.slice(0, i), texto: linea.slice(i + 1) };
  };
  const L = (id, qty) => ({ id, qty });
  // (volver a conceder un permiso cambia el ORDEN de la lista de permisos de una función, no su contenido: se comparan ordenadas)
  const ordenada = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'acl' && typeof v === 'string' ? v.slice(1, -1).split(',').sort().join(',') : v)));
  let n = 0;
  const nuevo = (p) => `${p}-${++n}`;

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: NUEVA });
    assert.ok(previas.length >= 18 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    assert.ok(previas.some((m) => m.archivo === GUARDIA), 'la guardia va antes');
    fijarDiaPromo(pg, 1);   // el día de la promo es el de la ESCRITURA: estas pruebas son de un lunes salvo las que dicen otra cosa
    sql(AYUDANTES);
    sql(SIMULACION);
    sql(`
      insert into public.personal (email, nombre, rol, activo, estado) values ('mesero1@resplandor.test', 'Mesero Uno', 'mesero', true, 'aprobado');
      insert into public.productos (id, categoria, nombre, precio, activo) values
        ('zc-menu','Ejecutivos','Menú Resplandor',23000,true), ('zc-seco','Ejecutivos','Seco',19000,true), ('zc-sopa','Ejecutivos','Sopa',7000,true),
        ('zc-jugo','Bebidas','Jugo natural',12000,true), ('zc-marga','Bebidas','Margarita',30000,true);
      insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
        ('zc-promo','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"productos":["zc-menu","zc-seco"]}}'),
        ('zc-promo-mie','Promociones','Cócteles',0,true,'2 x 1',3,'{"cada":2,"descuento":100,"aplica":{"productos":["zc-marga"]}}');
      insert into public.mesas (id, capacidad, estado, token) select g, 4, 'libre', lpad(g::text, 48, 'a') from generate_series(1, 60) g;
    `);
    antes = radiografia(pg);
  }, { timeout: 600000 });

  after(() => { if (pg) pg.parar(); });

  // ── la migración ──

  test('la migración se aplica como migrador (no superusuario), sin WARNING, y cambia SOLO lo suyo: tres funciones (cobrar_parcial, cobrar_abono, privado.items_de_hoy) y ningún trigger, tabla ni policy', () => {
    const r = aplicarNueva();
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
    const esperados = [
      /^funciones: nuevo .*"proname":"cobrar_parcial"/,
      /^funciones: nuevo .*"proname":"cobrar_abono"/,
      /^funciones: nuevo .*"proname":"items_de_hoy"/,
    ];
    assert.equal(cambios.length, esperados.length, cambios.join('\n'));
    for (const e of esperados) assert.ok(cambios.some((c) => e.test(c)), `falta el cambio ${e}: ${cambios.join('\n')}`);
    antes = despues;
  });

  // ── lo básico ──

  test('un cobro por partes SIN promoción: la venta cerrada (parcial_de, líneas con sus unidades, total de la base, cerrada_en) y la cuenta sin esas unidades, con la versión +1; el mesero y el admin', () => {
    limpiar();
    cuenta('b1', 1, [SOPA(3), JUGO(1)]);
    assert.equal(ver('b1'), '3×Sopa@7000 + 1×Jugo natural@12000 = 33000');
    const v0 = version('b1');
    const r = cobrar('mesero', 'b1', v0, 'b1-v', [L('zc-sopa', 2), L('zc-jugo', 1)], 'd-b1');
    assert.ok(r.ok, r.texto);
    assert.equal(r.json.repetido, false);
    assert.equal(r.json.venta.id, 'b1-v');
    assert.equal(r.json.venta.estado, 'cerrada');
    assert.equal(r.json.venta.parcial_de, 'b1');
    assert.equal(r.json.venta.mesa_id, 1);
    assert.equal(Number(r.json.venta.total), 26000, 'el total lo calcula la base: 2 × 7.000 + 12.000');
    assert.deepEqual(r.json.venta.items.map((i) => `${i.qty}×${i.nombre}@${i.precio}`), ['2×Sopa@7000', '1×Jugo natural@12000']);
    assert.ok(r.json.venta.cerrada_en, 'trae cerrada_en (la hora del servidor)');
    assert.equal(r.json.cuenta.estado, 'abierta');
    assert.equal(r.json.cuenta.version, v0 + 1);
    assert.equal(Number(r.json.cuenta.total), 7000);
    assert.deepEqual(r.json.cuenta.items.map((i) => `${i.qty}×${i.nombre}`), ['1×Sopa']);
    assert.equal(ver('b1'), '1×Sopa@7000 = 7000', 'y es lo que quedó guardado');
    assert.deepEqual(ventas().map((v) => [v.id, v.parcial_de, Number(v.total)]), [['b1-v', 'b1', 26000]]);
    // el admin cobra lo que queda por partes (una sola línea, todas sus unidades): la cuenta queda vacía y abierta
    const a = cobrar('admin', 'b1', version('b1'), 'b1-w', [L('zc-sopa', 1)], 'd-b1-w');
    assert.ok(a.ok, a.texto);
    assert.equal(ver('b1'), '(vacía) = 0');
    assert.equal(una("select estado from public.ordenes where id = 'b1'").estado, 'abierta');
    assert.equal(ventas().reduce((s, v) => s + Number(v.total), 0), 33000, 'lo cobrado suma la cuenta');
  });

  test('los precios que cobra son los de HOY de la cuenta (la base manda, no la tablet) y el marcador «Todo para llevar» viaja con una copia en la venta (cantidad 1, $0) y la cuenta lo conserva', () => {
    limpiar();
    cuenta('b2', 2, [SOPA(2), { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' }]);
    sql("update public.productos set precio = 8000 where id = 'zc-sopa';");
    try {
      // el precio cambió DESPUÉS de la última escritura de la cuenta: la tablet la ve a 7.000; la base la cobra a 8.000 (y la cuenta se normaliza con lo que queda)
      const r = cobrar('mesero', 'b2', version('b2'), 'b2-v', [L('zc-sopa', 1)], 'd-b2');
      assert.ok(r.ok, r.texto);
      assert.deepEqual(r.json.venta.items.map((i) => `${i.qty}×${i.nombre}@${i.precio}`), ['1×Sopa@8000', '1×Para llevar@0']);
      assert.equal(Number(r.json.venta.total), 8000);
      assert.deepEqual(r.json.cuenta.items.map((i) => `${i.qty}×${i.nombre}@${i.precio}`), ['1×Sopa@8000', '1×Para llevar@0'], 'la cuenta conserva el marcador y sigue a precio de hoy');
    } finally { sql("update public.productos set precio = 7000 where id = 'zc-sopa';"); }
  });

  // ── (a) la versión ──

  test('(a) RS003: con una versión vieja (la tablet está atrasada) no se cobra nada y la cuenta queda intacta; con null tampoco', () => {
    limpiar();
    cuenta('v1', 3, [SOPA(2), JUGO(1)]);
    sql("select public.aplicar_delta_orden('v1', 'zc-jugo', 'Jugo natural', 12000, 1, '') is not null;", { como: 'migrador' });
    const f0 = foto('v1');
    for (const v of [f0.version - 1, 0, 999, 'null']) {
      const r = cobrar('mesero', 'v1', v, nuevo('vv'), [L('zc-sopa', 1)], nuevo('dv'));
      assert.equal(r.ok, false, `se dejó pasar la versión ${v}`);
      assert.equal(r.codigo, 'RS003');
      assert.match(r.texto, /cambió desde que se vio/);
    }
    assert.deepEqual(foto('v1'), f0, 'la cuenta no cambió ni en la versión');
    assert.deepEqual(ventas(), []);
    assert.equal(una("select count(*) as n from public.deltas_aplicados where id like 'dv-%'").n, 0, 'y ningún id de cobro quedó anotado (la transacción se deshizo)');
  });

  test('(a) dos cobros a la vez sobre la misma cuenta, de verdad (dos sesiones a la vez): uno entra, el otro RS003; la cuenta y las ventas cuadran', async () => {
    limpiar();
    for (let ronda = 1; ronda <= 6; ronda += 1) {
      const id = `cc${ronda}`;
      cuenta(id, 10 + ronda, [SOPA(4), JUGO(2)]);
      const v = version(id);
      const llamada = (venta, linea) => `select t.como('mesero');\nselect t.cp(${literal(id)}, ${v}, ${literal(venta)}, ${literal(JSON.stringify([linea]))}::jsonb, ${literal('d-' + venta)});`;
      const res = await carrera(pg, [llamada(`${id}-x`, L('zc-sopa', 1)), llamada(`${id}-y`, L('zc-jugo', 1))], 4343);
      const salidas = res.map((r) => { assert.equal(r.code, 0, r.error); return r.salida.split('\n').pop(); });
      const buenas = salidas.filter((s) => s.startsWith('ok '));
      const viejas = salidas.filter((s) => s.startsWith('RS003 '));
      assert.equal(buenas.length, 1, `ronda ${ronda}: exactamente un cobro entra (${salidas.map((s) => s.slice(0, 30)).join(' | ')})`);
      assert.equal(viejas.length, 1, `ronda ${ronda}: el otro recibe RS003`);
      assert.equal(ventas().filter((x) => x.parcial_de === id).length, 1, `ronda ${ronda}: una sola venta`);
      assert.equal(version(id), v + 1);
      // lo cobrado + lo que queda = la cuenta de antes
      const cobrado = ventas().filter((x) => x.parcial_de === id).reduce((s, x) => s + Number(x.total), 0);
      assert.equal(cobrado + total(id), 4 * 7000 + 2 * 12000);
    }
  });

  // ── (b) la promoción ──

  test('(b) RS005: una cuenta con promoción no se cobra por partes, de ninguna forma (la línea base, la de promo, las dos, todo), y la cuenta y la versión quedan INTACTAS', () => {
    limpiar();
    cuenta('p1', 5, [SECO(3)]);
    assert.equal(ver('p1'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
    const f0 = foto('p1');
    const intentos = [
      [[L('zc-seco', 1)], 'una unidad de la línea base'],
      [[L('zc-seco', 2)], 'toda la línea base'],
      [[L(PROMO_SECO, 1)], 'solo la línea de promo'],
      [[L('zc-seco', 2), L(PROMO_SECO, 1)], 'las dos líneas del grupo'],
    ];
    for (const [lineas, que] of intentos) {
      for (const rol of ['mesero', 'admin']) {
        const r = cobrar(rol, 'p1', f0.version, nuevo('pv'), lineas, nuevo('dp'));
        assert.equal(r.ok, false, `${rol}: se dejó cobrar por partes: ${que}`);
        assert.equal(r.codigo, 'RS005', que);
        assert.match(r.texto, /la cuenta p1 tiene una promoción: el descuento se calcula con toda la cuenta junta, así que no se puede cobrar por partes ni por persona/);
      }
    }
    assert.deepEqual(foto('p1'), f0, 'la cuenta no cambió ni en la versión');
    assert.deepEqual(ventas(), []);
  });

  test('el día de la promo es el de la ESCRITURA (312eb93), no el de abierta_en: una mesa abierta el DOMINGO se juzga HOY (lunes) — con promoción (RS005) igual que el trigger — y el domingo ya no, aunque la cuenta diga lunes', () => {
    limpiar();
    // una cuenta abierta el domingo 2026-10-04 (19:30 en Bogotá); hoy (la escritura) es lunes
    cuenta('ay', 25, [SECO(3)], '2026-10-05 00:30:00+00');
    assert.equal(ver('ay'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200', 'el trigger la normaliza con el lunes de hoy');
    const f0 = foto('ay');
    assert.equal(cobrar('mesero', 'ay', f0.version, 'ay-v', [L('zc-seco', 1)], 'd-ay').codigo, 'RS005', 'la base juzga con hoy: tiene promoción');
    // guardada SIN normalizar (el trigger apagado) y abierta el domingo: la función la juzga con el lunes de hoy, no con el domingo de su apertura
    sql(`alter table public.ordenes disable trigger trg_ordenes_a_precio_vivo;
         insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('ay2', 26, 'abierta', '[{"id":"zc-seco","nombre":"Seco","precio":19000,"qty":3,"nota":""}]', 57000, '2026-10-05 00:30:00+00');
         alter table public.ordenes enable trigger trg_ordenes_a_precio_vivo;`, { como: 'migrador' });
    assert.equal(ver('ay2'), '3×Seco@19000 = 57000', 'guardada sin descuento');
    assert.equal(cobrar('mesero', 'ay2', version('ay2'), 'ay2-v', [L('zc-seco', 1)], 'd-ay2').codigo, 'RS005', 'abierta el domingo, hoy lunes: la TENDRÍA (con abierta_en sería un cobro por partes válido a 57.000)');
    assert.deepEqual(ventas(), []);
    // el mismo ayudante: la fecha de apertura no existe para él
    fijarDiaPromo(pg, 7);   // hoy es domingo
    try {
      const dom = una(`select privado.items_de_hoy('[{"id":"zc-seco","nombre":"Seco","precio":1,"qty":3,"nota":""}]'::jsonb) as v`).v;
      assert.deepEqual(dom.map((i) => `${i.qty}×${i.nombre}@${i.precio}`), ['3×Seco@19000'], 'el domingo no hay 3er almuerzo');
      cuenta('ay3', 27, [SECO(3)], '2026-10-05 17:00:00+00');   // abierta «el lunes», pero hoy es domingo
      assert.equal(ver('ay3'), '3×Seco@19000 = 57000', 'abierta un lunes y escrita un domingo: sin promo');
      assert.ok(cobrar('mesero', 'ay3', version('ay3'), 'ay3-v', [L('zc-seco', 1)], 'd-ay3').ok, 'sin promoción se cobra por partes');
    } finally { fijarDiaPromo(pg, 1); }
  });

  test('cobrar_abono también juzga con las reglas de HOY: una cuenta guardada un MARTES con 3 Seco sin descuento (57.000), recibida un lunes: un abono de 54.000 es RS006 (más de lo que falta hoy, 53.200) y uno de 20.000 la deja al día con su promo (33.200)', () => {
    limpiar();
    fijarDiaPromo(pg, 2);
    try { cuenta('ab1', 28, [SECO(3)]); } finally { fijarDiaPromo(pg, 1); }
    assert.equal(ver('ab1'), '3×Seco@19000 = 57000', 'escrita un martes: sin descuento');
    const f0 = foto('ab1');
    const grande = abonar('mesero', 'ab1', f0.version, 'ab1-g', 'uab1g', 54000, 'efectivo', 'd-ab1-g');
    assert.equal(grande.codigo, 'RS006', 'con las ítems guardados (57.000) cabría; con las reglas de hoy (53.200) no');
    assert.deepEqual(foto('ab1'), f0, 'la cuenta no cambió');
    assert.deepEqual(ventas(), []);
    const bien = abonar('mesero', 'ab1', f0.version, 'ab1-a', 'uab1a', 20000, 'efectivo', 'd-ab1-a');
    assert.ok(bien.ok, bien.texto);
    assert.equal(total('ab1'), 33200, '53.200 de hoy − 20.000 (no 37.000)');
    assert.ok(ver('ab1').includes('3er almuerzo'), 'la cuenta quedó al día con su línea de promo');
  });

  test('(b) RS005 también cuando la cuenta la TENDRÍA al normalizarla hoy (guardada sin normalizar: el trigger falló o es anterior a las reglas): 3 Seco guardados sin descuento', () => {
    limpiar();
    // El dueño guarda 3 Seco SIN que el trigger los normalice (como una cuenta anterior a las reglas del lunes).
    sql(`alter table public.ordenes disable trigger trg_ordenes_a_precio_vivo;
         insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('p2', 6, 'abierta', '[{"id":"zc-seco","nombre":"Seco","precio":19000,"qty":3,"nota":""}]', 57000, '2026-10-05 17:00:00+00');
         alter table public.ordenes enable trigger trg_ordenes_a_precio_vivo;`, { como: 'migrador' });
    assert.equal(ver('p2'), '3×Seco@19000 = 57000', 'guardada sin descuento');
    const r = cobrar('mesero', 'p2', version('p2'), 'p2-v', [L('zc-seco', 1)], 'd-p2');
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'RS005');
    assert.equal(ver('p2'), '3×Seco@19000 = 57000', 'no se tocó');
    assert.deepEqual(ventas(), []);
  });

  test('(b) con dos Seco (no es un trío) se cobra por partes; el tercero que se pide después hace que el siguiente cobro, con la versión nueva, sea RS005 — y con la vieja, RS003', () => {
    limpiar();
    cuenta('p3', 7, [SECO(2)]);
    assert.equal(ver('p3'), '2×Seco@19000 = 38000');
    const v0 = version('p3');
    sql("select public.aplicar_delta_orden('p3', 'zc-seco', 'Seco', 19000, 1, '') is not null;", { como: 'migrador' });
    assert.ok(ver('p3').includes('3er almuerzo'));
    assert.equal(cobrar('mesero', 'p3', v0, 'p3-a', [L('zc-seco', 1)], 'd-p3-a').codigo, 'RS003', 'la tablet atrasada (no vio el tercero) se relee');
    assert.equal(cobrar('mesero', 'p3', version('p3'), 'p3-b', [L('zc-seco', 1)], 'd-p3-b').codigo, 'RS005', 'la tablet al día ve la promoción: la base no la parte');
    assert.deepEqual(ventas(), []);
  });

  test('un cobro por partes de OTRA cuenta (sin promoción) no se frena por la promoción de una vecina; y el 2x1 del miércoles también bloquea', () => {
    limpiar();
    cuenta('p4', 8, [SECO(3)]);
    cuenta('p5', 9, [SOPA(2)]);
    assert.ok(cobrar('mesero', 'p5', version('p5'), 'p5-v', [L('zc-sopa', 1)], 'd-p5').ok);
    fijarDiaPromo(pg, 3);   // miércoles
    try {
      cuenta('w1', 10, [{ id: 'zc-marga', nombre: 'Margarita', precio: 30000, qty: 2, nota: '' }], '2026-10-07 17:00:00+00');
      assert.equal(ver('w1'), '1×Margarita@30000 + 1×Margarita · Cócteles · 2 x 1@0 = 30000');
      for (const lineas of [[L('zc-marga', 1)], [L('promo:zc-promo-mie:zc-marga', 1)]]) {
        const r = cobrar('mesero', 'w1', version('w1'), nuevo('wv'), lineas, nuevo('dw'));
        assert.equal(r.codigo, 'RS005', JSON.stringify(lineas));
      }
      cuenta('w2', 11, [{ id: 'zc-marga', nombre: 'Margarita', precio: 30000, qty: 1, nota: '' }, SOPA(1)], '2026-10-07 17:00:00+00');
      assert.ok(cobrar('mesero', 'w2', version('w2'), 'w2-v', [L('zc-marga', 1)], 'd-w2').ok, 'una sola Margarita no tiene pareja: sin promoción, se cobra por partes');
    } finally { fijarDiaPromo(pg, 1); }
  });

  // ── (c) lo pedido ──

  test('(c) RS006: líneas que la cuenta no tiene, cantidades inválidas, repetidas, el marcador «para llevar», un abono recibido, el pedido vacío o mal formado: nada se cobra y la cuenta queda intacta', () => {
    limpiar();
    cuenta('c1', 12, [SOPA(2), JUGO(1), { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' }]);
    comoMesero("select t.ca('c1', t.v('c1'), 'c1-ab', 'uab', 5000, 'efectivo', 'd-c1-ab');");
    const f0 = foto('c1');
    const casos = [
      [[L('zc-sopa', 3)], 'más unidades de las que hay'],
      [[L('zc-menu', 1)], 'una línea que la cuenta no tiene'],
      [[{ id: 'zc-sopa', qty: 0 }], 'cantidad 0'],
      [[{ id: 'zc-sopa', qty: -1 }], 'cantidad negativa'],
      [[{ id: 'zc-sopa', qty: 1.5 }], 'cantidad con decimales'],
      [[{ id: 'zc-sopa', qty: '1' }], 'cantidad como texto'],
      [[{ id: 'zc-sopa', qty: null }], 'cantidad nula'],
      [[{ id: 'zc-sopa' }], 'sin cantidad'],
      [[{ qty: 1 }], 'sin id'],
      [[L('zc-sopa', 1), L('zc-sopa', 1)], 'la misma línea dos veces'],
      [[L('para_llevar', 1)], 'el marcador «para llevar»'],
      [[L('abono_recibido_uab', 1)], 'una línea de abono recibido'],
      [[], 'ninguna línea'],
      [['zc-sopa'], 'una línea que no es un objeto'],
      [[L('zc-sopa', 1000000)], 'una cantidad enorme'],
    ];
    for (const [lineas, que] of casos) {
      const r = cobrar('mesero', 'c1', f0.version, nuevo('cv'), lineas, nuevo('dc'));
      assert.equal(r.ok, false, `se dejó pasar: ${que}`);
      assert.equal(r.codigo, 'RS006', `${que}: ${r.texto}`);
    }
    for (const [pedido, que] of [['null', 'sin lineas'], ["'{\"a\":1}'::jsonb", 'lineas no es un arreglo']]) {
      const r = pg.sql(`select t.como('mesero');\nselect t.cp('c1', ${f0.version}, 'c1-x', ${pedido.replace(/^null$/, 'null::jsonb')}, 'd-c1-x');`);
      assert.match(ultima(r), /^RS006 /, que);
    }
    for (const [llamada, que] of [
      ["select t.cp('c1', %V, null, '[{\"id\":\"zc-sopa\",\"qty\":1}]'::jsonb, 'd-n1');", 'sin id de venta'],
      ["select t.cp('c1', %V, 'c1-x', '[{\"id\":\"zc-sopa\",\"qty\":1}]'::jsonb, null);", 'sin id de cobro'],
      ["select t.cp('c1', %V, 'c1-x', '[{\"id\":\"zc-sopa\",\"qty\":1}]'::jsonb, '');", 'id de cobro vacío'],
    ]) {
      const r = pg.sql(`select t.como('mesero');\n${llamada.replace('%V', f0.version)}`);
      assert.match(ultima(r), /^RS006 /, que);
    }
    assert.deepEqual(foto('c1'), f0, 'la cuenta no cambió ni en la versión');
    assert.deepEqual(ventas().filter((v) => v.id !== 'c1-ab'), [], 'ninguna venta por partes');
  });

  test('(c) RS006: con abonos ya recibidos, cobrar más de lo que falta dejaría la cuenta en negativo (el cliente pagaría de más): se rechaza; cobrar hasta lo que falta, no', () => {
    limpiar();
    cuenta('c2', 13, [SOPA(2), JUGO(1)]);                                   // 26.000
    assert.ok(abonar('mesero', 'c2', version('c2'), 'c2-ab', 'uc2', 10000, 'efectivo', 'd-c2-ab').ok);   // faltan 16.000 (las tres líneas siguen en la cuenta)
    assert.equal(total('c2'), 16000);
    const f0 = foto('c2');
    const mucho = cobrar('mesero', 'c2', f0.version, 'c2-v', [L('zc-sopa', 2), L('zc-jugo', 1)], 'd-c2');   // 26.000 > 16.000
    assert.equal(mucho.codigo, 'RS006');
    assert.match(mucho.texto, /abonos/);
    assert.deepEqual(foto('c2'), f0);
    const justo = cobrar('mesero', 'c2', f0.version, 'c2-w', [L('zc-jugo', 1), L('zc-sopa', 0 + 0 + 1)], 'd-c2-w');   // 19.000 > 16.000: tampoco
    assert.equal(justo.codigo, 'RS006');
    const bien = cobrar('mesero', 'c2', f0.version, 'c2-x', [L('zc-sopa', 2)], 'd-c2-x');                       // 14.000 ≤ 16.000: queda el Jugo (12.000) menos el abono (10.000)
    assert.ok(bien.ok, bien.texto);
    assert.equal(Number(bien.json.cuenta.total), 2000, 'faltan 2.000: el Jugo de 12.000 con el abono de 10.000 ya recibido');
    assert.equal(ver('c2'), '1×Jugo natural@12000 + 1×Abono recibido@-10000 = 2000');
  });

  // ── (e) idempotencia ──

  test('(e) repetir el MISMO cobro (la respuesta se perdió) devuelve lo mismo sin duplicar: una sola venta, la cuenta con una sola resta, repetido: true; también con la versión vieja que mandó la primera vez', () => {
    limpiar();
    cuenta('i1', 14, [SOPA(3), JUGO(1)]);
    const v0 = version('i1');
    const primero = cobrar('mesero', 'i1', v0, 'i1-v', [L('zc-sopa', 1)], 'd-i1');
    assert.ok(primero.ok, primero.texto);
    assert.equal(primero.json.repetido, false);
    const f1 = foto('i1');
    for (let k = 0; k < 3; k += 1) {
      const otra = cobrar('mesero', 'i1', v0, 'i1-v', [L('zc-sopa', 1)], 'd-i1');
      assert.ok(otra.ok, otra.texto);
      assert.equal(otra.json.repetido, true);
      assert.equal(otra.json.venta.id, 'i1-v');
      assert.deepEqual(otra.json.venta.items, primero.json.venta.items);
      assert.equal(Number(otra.json.venta.total), 7000);
      assert.equal(otra.json.cuenta.version, f1.version, 'devuelve la cuenta como está ahora');
    }
    assert.deepEqual(foto('i1'), f1, 'la cuenta no se movió');
    assert.equal(ventas().length, 1, 'una sola venta');
    // el mismo id de cobro con OTRA venta no es «lo mismo»: la venta que dice no existe → RS003
    const raro = cobrar('mesero', 'i1', v0, 'i1-otra', [L('zc-sopa', 1)], 'd-i1');
    assert.equal(raro.codigo, 'RS003');
    // un cobro DISTINTO (otro id) sobre la misma versión vieja: RS003 (la versión ya subió)
    assert.equal(cobrar('mesero', 'i1', v0, 'i1-w', [L('zc-sopa', 1)], 'd-i1-w').codigo, 'RS003');
    // deshacer el cobro y repetirlo con el mismo id: no se vuelve a aplicar (la venta ya no existe): RS003
    const d = comoMesero("select public.deshacer_cobro('i1-v') ->> 'ok';");
    assert.equal(ultima(d), 'true');
    assert.equal(ver('i1'), '3×Sopa@7000 + 1×Jugo natural@12000 = 33000');
    assert.equal(cobrar('mesero', 'i1', v0, 'i1-v', [L('zc-sopa', 1)], 'd-i1').codigo, 'RS003', 'un cobro deshecho no se repite');
    assert.equal(ver('i1'), '3×Sopa@7000 + 1×Jugo natural@12000 = 33000');
  });

  test('(e) dos reintentos del mismo cobro A LA VEZ (dos sesiones): una venta y una sola resta; los dos reciben la venta', async () => {
    limpiar();
    cuenta('i2', 15, [SOPA(4)]);
    const v = version('i2');
    const llamada = `select t.como('mesero');\nselect t.cp('i2', ${v}, 'i2-v', '[{"id":"zc-sopa","qty":2}]'::jsonb, 'd-i2');`;
    const res = await carrera(pg, [llamada, llamada], 4344);
    const salidas = res.map((r) => { assert.equal(r.code, 0, r.error); return r.salida.split('\n').pop(); });
    assert.ok(salidas.every((s) => s.startsWith('ok ')), `los dos reciben la venta: ${salidas.map((s) => s.slice(0, 40)).join(' | ')}`);
    assert.equal(salidas.filter((s) => s.includes('"repetido": true') || s.includes('"repetido":true')).length, 1, 'uno la hizo, el otro la repitió');
    assert.equal(ventas().length, 1);
    assert.equal(ver('i2'), '2×Sopa@7000 = 14000');
  });

  test('(e) EL ID MANDA SOBRE LA VERSIÓN (cuarta refutación): con el cobro ya aplicado y la cuenta en otra versión, repetirlo con CUALQUIER versión (la vieja de la primera vez, la nueva que la tablet leyó después, una inventada o null) devuelve la misma venta, sin duplicar; un id NUEVO con la versión vieja sí es RS003', () => {
    limpiar();
    cuenta('iv', 24, [SOPA(3), JUGO(2)]);
    const v0 = version('iv');
    const primero = cobrar('mesero', 'iv', v0, 'iv-v', [L('zc-jugo', 1)], 'd-iv');
    assert.ok(primero.ok, primero.texto);
    const v1 = version('iv');
    assert.equal(v1, v0 + 1, 'el propio cobro subió la versión');
    const f1 = foto('iv');
    for (const v of [v0, v1, v1 + 7, 0, 'null']) {
      const otra = cobrar('mesero', 'iv', v, 'iv-v', [L('zc-jugo', 1)], 'd-iv');
      assert.ok(otra.ok, `con la versión ${v}: ${otra.texto}`);
      assert.equal(otra.json.repetido, true, `con la versión ${v}`);
      assert.equal(otra.json.venta.id, 'iv-v');
      assert.equal(Number(otra.json.venta.total), 12000);
      assert.equal(otra.json.cuenta.version, v1, 'y devuelve la cuenta como está ahora');
    }
    // el mismo id con las líneas de otro intento: la venta es la de la primera vez (el id es del intento, no de las líneas)
    const otraLinea = cobrar('mesero', 'iv', v1, 'iv-v', [L('zc-sopa', 1)], 'd-iv');
    assert.ok(otraLinea.ok);
    assert.equal(otraLinea.json.repetido, true);
    assert.deepEqual(otraLinea.json.venta.items.map((i) => i.id), ['zc-jugo'], 'no se cobra la línea nueva: es el cobro de la primera vez');
    assert.deepEqual(foto('iv'), f1, 'la cuenta no se movió');
    assert.equal(ventas().length, 1, 'una sola venta');
    // un id NUEVO con la versión que ya no es: RS003 (el id es lo que protege, no la versión)
    assert.equal(cobrar('mesero', 'iv', v0, 'iv-w', [L('zc-jugo', 1)], 'd-iv-w').codigo, 'RS003');
    assert.equal(ventas().length, 1);
    // lo mismo con el abono
    const ab = abonar('mesero', 'iv', v1, 'iv-ab', 'uiv', 5000, 'efectivo', 'd-iv-ab');
    assert.ok(ab.ok, ab.texto);
    const v2 = version('iv');
    for (const v of [v1, v2, v2 + 3, 'null']) {
      const otro = abonar('mesero', 'iv', v, 'iv-ab', 'uiv', 5000, 'efectivo', 'd-iv-ab');
      assert.ok(otro.ok, `abono con la versión ${v}: ${otro.texto}`);
      assert.equal(otro.json.repetido, true, `abono con la versión ${v}`);
      assert.equal(Number(otro.json.venta.total), 5000);
    }
    assert.equal(ventas().length, 2, 'la venta por partes y el abono: nada duplicado');
    assert.equal(ver('iv'), '3×Sopa@7000 + 1×Jugo natural@12000 + 1×Abono recibido@-5000 = 28000');
    assert.equal(abonar('mesero', 'iv', v1, 'iv-ab2', 'uiv2', 5000, 'efectivo', 'd-iv-ab2').codigo, 'RS003', 'un abono NUEVO con la versión vieja sí es RS003');
  });

  // ── el abono ──

  test('el abono: la venta cerrada «Abono» (abono_<uid>, parcial_de) y la línea abono_recibido_<uid> (−monto) en la cuenta, juntas y con la versión +1; mesero y admin', () => {
    limpiar();
    cuenta('a1', 16, [SOPA(3), JUGO(1)]);
    const v0 = version('a1');
    const r = abonar('mesero', 'a1', v0, 'a1-ab', 'ua1', 20000, 'qr', 'd-a1');
    assert.ok(r.ok, r.texto);
    assert.equal(r.json.repetido, false);
    assert.deepEqual(r.json.venta.items, [{ id: 'abono_ua1', nombre: 'Abono', precio: 20000, qty: 1, nota: 'qr' }]);
    assert.equal(Number(r.json.venta.total), 20000);
    assert.equal(r.json.venta.parcial_de, 'a1');
    assert.equal(r.json.cuenta.version, v0 + 1);
    assert.equal(Number(r.json.cuenta.total), 13000);
    assert.deepEqual(r.json.cuenta.items.slice(-1), [{ id: 'abono_recibido_ua1', nombre: 'Abono recibido', precio: -20000, qty: 1, nota: 'qr' }]);
    assert.equal(ver('a1'), '3×Sopa@7000 + 1×Jugo natural@12000 + 1×Abono recibido@-20000 = 13000');
    const a = abonar('admin', 'a1', version('a1'), 'a1-ab2', 'ua2', 5000, 'transferencia', 'd-a1-2');
    assert.ok(a.ok, a.texto);
    assert.equal(total('a1'), 8000);
    // abonos + lo que queda = la cuenta; la mesa completa cierra con lo que falta
    assert.equal(Number(comoMesero("select t.cobrar_todo('a1');").salida.split('\n').pop()), 8000);
    assert.equal(ventas().reduce((s, v) => s + Number(v.total), 0), 33000);
  });

  test('el abono: RS003 con versión vieja, RS006 con monto inválido (cero, negativo, decimales, nulo, ≥ lo que falta) o método inválido o uid inválido; la cuenta intacta', () => {
    limpiar();
    cuenta('a2', 17, [SOPA(2), JUGO(1)]);                                   // 26.000
    const f0 = foto('a2');
    const v = f0.version;
    assert.equal(abonar('mesero', 'a2', v - 1, nuevo('av'), 'uvv', 5000, 'efectivo', nuevo('da')).codigo, 'RS003');
    for (const [monto, que] of [[0, 'cero'], [-5000, 'negativo'], [1500.5, 'decimales'], ['null', 'nulo'], [26000, 'igual a lo que falta'], [30000, 'mayor que lo que falta']]) {
      const r = abonar('mesero', 'a2', v, nuevo('av'), 'uvm', monto, 'efectivo', nuevo('da'));
      assert.equal(r.codigo, 'RS006', `monto ${que}: ${r.texto}`);
    }
    for (const metodo of ['tarjeta', 'EFECTIVO', '']) assert.equal(abonar('mesero', 'a2', v, nuevo('av'), 'uvm', 5000, metodo, nuevo('da')).codigo, 'RS006', `método «${metodo}»`);
    for (const uid of ['a_b', 'ABC', 'x y', '']) assert.equal(abonar('mesero', 'a2', v, nuevo('av'), uid, 5000, 'efectivo', nuevo('da')).codigo, 'RS006', `uid «${uid}»`);
    assert.equal(abonar('mesero', 'a2', v, null, 'uvm', 5000, 'efectivo', nuevo('da')).codigo, 'RS006', 'sin id de venta');
    assert.equal(abonar('mesero', 'a2', v, nuevo('av'), 'uvm', 5000, 'efectivo', null).codigo, 'RS006', 'sin id de cobro');
    assert.deepEqual(foto('a2'), f0);
    assert.deepEqual(ventas(), []);
    // 25.999 sí (es menor que lo que falta)
    assert.ok(abonar('mesero', 'a2', v, 'a2-ok', 'uok', 25999, 'efectivo', 'd-a2-ok').ok);
  });

  test('el abono SÍ entra en una cuenta con promoción y NO mueve el descuento; abonos + la mesa completa = 61.200; y es idempotente', () => {
    limpiar();
    cuenta('a3', 18, [MENU(2), SECO(1)]);
    assert.equal(ver('a3'), '2×Menú Resplandor@23000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 61200');
    const r1 = abonar('mesero', 'a3', version('a3'), 'a3-1', 'u31', 30000, 'efectivo', 'd-a3-1');
    assert.ok(r1.ok, r1.texto);
    const v1 = version('a3');
    const r2 = abonar('mesero', 'a3', v1, 'a3-2', 'u32', 11200, 'qr', 'd-a3-2');
    assert.ok(r2.ok, r2.texto);
    const lineas = pg.filas("select e ->> 'id' as id, (e ->> 'qty')::int as qty, (e ->> 'precio')::numeric as precio from public.ordenes o, jsonb_array_elements(o.items) e where o.id = 'a3' order by 1");
    assert.deepEqual(lineas.filter((l) => !l.id.startsWith('abono_recibido_')).map((l) => `${l.id}×${l.qty}@${l.precio}`), [`${PROMO_SECO}×1@15200`, 'zc-menu×2@23000'], 'el descuento sigue donde estaba');
    assert.equal(total('a3'), 61200 - 30000 - 11200);
    // el segundo abono repetido con la versión vieja que mandó: la misma respuesta, sin duplicar
    const otra = abonar('mesero', 'a3', v1, 'a3-2', 'u32', 11200, 'qr', 'd-a3-2');
    assert.ok(otra.ok, otra.texto);
    assert.equal(otra.json.repetido, true);
    assert.equal(ventas().filter((v) => v.parcial_de === 'a3').length, 2);
    assert.equal(total('a3'), 20000);
    assert.equal(Number(comoMesero("select t.cobrar_todo('a3');").salida.split('\n').pop()), 20000);
    assert.equal(ventas().reduce((s, v) => s + Number(v.total), 0), 61200, 'abono + abono + el resto = lo que da la cuenta junta');
  });

  // ── deshacer, con las ventas que crea la RPC ──

  test('deshacer_cobro con las ventas de la RPC: la unidad vuelve, el marcador se suma por id (el POS lo resta), y si aparece un trío la promo se recalcula; un abono quita su línea', () => {
    limpiar();
    cuenta('d1', 19, [SECO(2), JUGO(1)]);
    const r = cobrar('mesero', 'd1', version('d1'), 'd1-v', [L('zc-seco', 1), L('zc-jugo', 1)], 'd-d1');
    assert.ok(r.ok, r.texto);
    assert.equal(ver('d1'), '1×Seco@19000 = 19000');
    // llegan dos Seco más: tres en la cuenta → promo
    sql("select public.aplicar_delta_orden('d1', 'zc-seco', 'Seco', 19000, 2, '') is not null;", { como: 'migrador' });
    assert.equal(ver('d1'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
    // deshacer el cobro: el Seco y el Jugo vuelven, y con cuatro Seco la promo se recalcula (tres completos y un descuento)
    const d = comoMesero("select public.deshacer_cobro('d1-v') ->> 'ok';");
    assert.equal(ultima(d), 'true');
    assert.equal(ver('d1'), '3×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 + 1×Jugo natural@12000 = 84200', 'la promo se recalcula con las cuatro unidades: un solo descuento');
    assert.equal(ventas().filter((v) => v.id === 'd1-v').length, 0);
    // el abono
    cuenta('d2', 20, [SECO(3)]);
    assert.ok(abonar('mesero', 'd2', version('d2'), 'd2-ab', 'ud2', 20000, 'efectivo', 'd-d2').ok);
    assert.equal(total('d2'), 33200);
    assert.equal(ultima(comoMesero("select public.deshacer_cobro('d2-ab') ->> 'ok';")), 'true');
    assert.equal(ver('d2'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
    // con «para llevar»: la venta lleva una copia del marcador y deshacer la suma a la cuenta (el POS la resta)
    cuenta('d3', 21, [SOPA(2), { id: 'para_llevar', nombre: 'Para llevar', precio: 0, qty: 1, nota: 'Todo el pedido' }]);
    assert.ok(cobrar('mesero', 'd3', version('d3'), 'd3-v', [L('zc-sopa', 1)], 'd-d3').ok);
    assert.equal(ultima(comoMesero("select public.deshacer_cobro('d3-v') ->> 'ok';")), 'true');
    assert.equal(ver('d3'), '2×Sopa@7000 + 2×Para llevar@0 = 14000', 'el marcador se sumó por id (el POS resta la copia)');
  });

  test('el cierre del día suma lo registrado: ventas por partes + abonos + la mesa completa; y una venta por partes ya archivada no se repite', () => {
    limpiar();
    cuenta('k1', 22, [SOPA(3), JUGO(2)]);
    cuenta('k2', 23, [SECO(3)]);
    assert.ok(cobrar('mesero', 'k1', version('k1'), 'k1-v', [L('zc-sopa', 1), L('zc-jugo', 1)], 'd-k1').ok);   // 19.000
    assert.ok(abonar('mesero', 'k1', version('k1'), 'k1-ab', 'uk1', 10000, 'efectivo', 'd-k1-ab').ok);          // 10.000
    assert.equal(Number(comoMesero("select t.cobrar_todo('k1');").salida.split('\n').pop()), 14000 + 12000 - 10000);
    assert.equal(Number(comoMesero("select t.cobrar_todo('k2');").salida.split('\n').pop()), 53200);
    const esperado = 19000 + 10000 + 16000 + 53200;
    assert.equal(ventas().reduce((s, v) => s + Number(v.total), 0), esperado);
    const ids = ventas().map((v) => v.id);
    const cierre = comoAdmin(`select public.cerrar_dia('cierre-k', ${literal(JSON.stringify({ n: ids.length, total: esperado, ids }))}::jsonb) ->> 'ok';`);
    assert.equal(ultima(cierre), 'true', cierre.error);
    assert.equal(Number(una("select total_ventas from public.cierres where id = 'cierre-k'").total_ventas), esperado, 'el cierre del día suma lo registrado');
    assert.deepEqual(ventas(), [], 'las ventas se archivaron');
  });

  // ── cuentas que no se pueden cobrar ──

  test('una cuenta cerrada (RS001 para el admin, «no existe» para el mesero: no la ve), una que no existe, y una archivada en un cierre del día (RS005, «por partes»)', () => {
    limpiar();
    cuenta('x1', 24, [SOPA(2)]);
    const v = version('x1');
    comoMesero("select t.cobrar_todo('x1');");
    assert.equal(cobrar('admin', 'x1', v, 'x1-a', [L('zc-sopa', 1)], 'd-x1-a').codigo, 'RS001');
    const m = cobrar('mesero', 'x1', v, 'x1-b', [L('zc-sopa', 1)], 'd-x1-b');
    assert.equal(m.codigo, 'P0001');
    assert.match(m.texto, /orden x1 no existe/);
    assert.equal(cobrar('mesero', 'no-hay', 1, 'x-c', [L('zc-sopa', 1)], 'd-x-c').codigo, 'P0001');
    assert.equal(abonar('admin', 'x1', v, 'x1-d', 'ux1', 1000, 'efectivo', 'd-x1-d').codigo, 'RS001');
    // archivada: una cuenta ABIERTA cuyo id ya está en un cierre (un POS viejo cerró con una foto vieja)
    cuenta('x2', 25, [SOPA(2)]);
    sql(`insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('cierre-x2', now(), 14000, 1, '[{"id":"x2","mesaId":25,"estado":"cerrada","items":[],"total":14000}]'::jsonb);`, { como: 'migrador' });
    for (const r of [cobrar('mesero', 'x2', version('x2'), 'x2-v', [L('zc-sopa', 1)], 'd-x2'), abonar('mesero', 'x2', version('x2'), 'x2-ab', 'ux2', 1000, 'efectivo', 'd-x2-ab')]) {
      assert.equal(r.codigo, 'RS005');
      assert.match(r.texto, /ya estaba en un cierre del día: no se puede cobrar por partes/);
    }
    assert.equal(ver('x2'), '2×Sopa@7000 = 14000');
  });

  test('una cuenta archivada la rechaza la propia función (RS005), no solo la guardia de la API: también si la llama el dueño (SQL Editor), que no pasa por esa guardia', () => {
    limpiar();
    cuenta('x3', 27, [SOPA(2)]);
    sql(`insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones) values ('cierre-x3', now(), 14000, 1, '[{"id":"x3","mesaId":27,"estado":"cerrada","items":[],"total":14000}]'::jsonb);`, { como: 'migrador' });
    const v = version('x3');
    const r = pg.sql(`\\set VERBOSITY verbose\nselect public.cobrar_parcial('x3', ${v}, '{"id":"x3-v"}'::jsonb, '[{"id":"zc-sopa","qty":1}]'::jsonb, 'd-x3');`, { como: 'migrador' });
    assert.equal(r.ok, false);
    assert.match(r.error, /RS005/);
    assert.match(r.error, /ya estaba en un cierre del día: no se puede cobrar por partes/);
    const a = pg.sql(`\\set VERBOSITY verbose\nselect public.cobrar_abono('x3', ${v}, '{"id":"x3-ab","uid":"ux3"}'::jsonb, 1000, 'efectivo', 'd-x3-ab');`, { como: 'migrador' });
    assert.equal(a.ok, false);
    assert.match(a.error, /RS005/);
    assert.equal(ver('x3'), '2×Sopa@7000 = 14000');
    assert.deepEqual(ventas().filter((x) => x.parcial_de === 'x3'), []);
  });

  test('los cobros se turnan con deshacer y cerrar el día: cobrar_parcial espera el candado de aviso `resplandor.cobros` (otra sesión lo tiene) y entra cuando lo sueltan', async () => {
    limpiar();
    cuenta('k9', 28, [SOPA(3)]);
    const v = version('k9');
    const espera = `select t.como('mesero');\nselect extract(epoch from clock_timestamp())::text; select pg_sleep(0.6); select extract(epoch from clock_timestamp())::text; select left(t.cp('k9', ${v}, 'k9-v', '[{"id":"zc-sopa","qty":1}]'::jsonb, 'd-k9'), 2);\nselect extract(epoch from clock_timestamp())::text;`;
    const retiene = "begin; select pg_advisory_xact_lock(hashtext('resplandor.cobros')); select pg_sleep(2.5); commit;";
    const res = await carrera(pg, [retiene, espera], 4545);
    const [r1, r2] = res;
    assert.equal(r1.code, 0, r1.error); assert.equal(r2.code, 0, r2.error);
    const lineas = r2.salida.split('\n').filter(Boolean);
    const [, , cobro, fin] = [lineas[0], lineas[1], lineas[lineas.length - 2], lineas[lineas.length - 1]];
    assert.equal(cobro, 'ok', 'el cobro entró');
    const inicio = Number(lineas.find((l) => /^\d+\.\d+$/.test(l)));
    assert.ok(Number(fin) - inicio >= 1.5, `esperó el candado (${(Number(fin) - inicio).toFixed(2)} s)`);
    assert.equal(ventas().filter((x) => x.parcial_de === 'k9').length, 1);
  });

  // ── permisos ──

  test('permisos: anon no ejecuta ninguna; quien no es del personal (una cuenta de Google ajena) no ve la cuenta («no existe») ni deja huella; el dueño (SQL Editor) tampoco se frena', () => {
    limpiar();
    cuenta('q1', 26, [SOPA(2)]);
    const v = version('q1');
    for (const fn of ["select public.cobrar_parcial('q1', 1, '{\"id\":\"a\"}'::jsonb, '[{\"id\":\"zc-sopa\",\"qty\":1}]'::jsonb, 'dq')", "select public.cobrar_abono('q1', 1, '{\"id\":\"a\",\"uid\":\"u\"}'::jsonb, 100, 'efectivo', 'dq')"]) {
      const a = pg.sql(`\\set VERBOSITY verbose\n${fn};`, { como: 'anon', claims: { role: 'anon' } });
      assert.equal(a.ok, false);
      assert.match(a.error, /42501/, 'anon: permission denied');
    }
    // una cuenta de Google que no está en `personal`
    const ajena = { sub: '00000000-0000-4000-8000-0000000000f9', role: 'authenticated', email: 'ajena@resplandor.test', app_metadata: { provider: 'google' } };
    const r = pg.sql(`select t.cp('q1', ${v}, 'q1-v', '[{"id":"zc-sopa","qty":1}]'::jsonb, 'd-q1');`, { como: 'authenticated', claims: ajena });
    assert.match(ultima(r), /^P0001 orden q1 no existe/);
    assert.equal(una("select count(*) as n from public.deltas_aplicados where id = 'd-q1'").n, 0, 'sin huella: el id no quedó anotado');
    assert.deepEqual(foto('q1').items, [SOPA(2)].map((i) => ({ ...i })));
    // el dueño (SQL Editor) y service_role: las funciones corren, sin RLS de por medio
    const d = pg.sql(`select public.cobrar_parcial('q1', ${v}, '{"id":"q1-v"}'::jsonb, '[{"id":"zc-sopa","qty":1}]'::jsonb, 'd-q1-d') ->> 'ok';`, { como: 'migrador' });
    assert.ok(d.ok, d.error);
    assert.equal(ultima(d), 'true');
    assert.equal(ver('q1'), '1×Sopa@7000 = 7000');
  });

  test('el ayudante privado.items_de_hoy: authenticated lo ejecuta, anon no; da el precio y las promos de hoy', () => {
    const quien = (fn) => ['anon', 'authenticated', 'public'].filter((rol) => pg.sql(`select has_function_privilege(${literal(rol)}, ${literal(fn)}, 'execute');`).salida === 't');
    assert.deepEqual(quien('privado.items_de_hoy(jsonb)'), ['authenticated']);
    assert.deepEqual(quien('public.cobrar_parcial(text,integer,jsonb,jsonb,text)'), ['authenticated']);
    assert.deepEqual(quien('public.cobrar_abono(text,integer,jsonb,numeric,text,text)'), ['authenticated']);
    const tres = `select privado.items_de_hoy('[{"id":"zc-seco","nombre":"Seco","precio":1,"qty":3,"nota":""}]'::jsonb) as v`;
    const hoy = una(tres).v;
    assert.deepEqual(hoy.map((i) => `${i.qty}×${i.nombre}@${i.precio}`), ['2×Seco@19000', '1×Seco · 3er almuerzo · 20% OFF@15200'], 'el precio de hoy y la promo del lunes');
    fijarDiaPromo(pg, 2);
    try {
      const martes = una(tres).v;
      assert.deepEqual(martes.map((i) => `${i.qty}×${i.nombre}@${i.precio}`), ['3×Seco@19000'], 'el martes no hay promo');
    } finally { fijarDiaPromo(pg, 1); }
  });

  // ── los guiones de las refutaciones (r2 y r3) ya no pueden producirse ──

  test('r2 (80.200): una tablet con la cuenta atrasada (1 Menú + 1 Seco; la base ya tiene 2 Menú + «Seco · 3er almuerzo») cobra «el Seco»: RS003/RS005, la cuenta queda en 61.200 y NO se suma ningún Seco de más', () => {
    limpiar();
    cuenta('r2', 30, [MENU(1), SECO(1)]);
    const vVista = version('r2');                                           // lo que la tablet vio
    sql("select public.aplicar_delta_orden('r2', 'zc-menu', 'Menú Resplandor', 23000, 1, '') is not null;", { como: 'migrador' });
    assert.equal(ver('r2'), '2×Menú Resplandor@23000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 61200');
    const r = cobrar('mesero', 'r2', vVista, 'r2-v', [L('zc-seco', 1)], 'd-r2');
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'RS003');
    // aun con la versión al día (la tablet releyó) la cuenta tiene promoción: no se parte
    assert.equal(cobrar('mesero', 'r2', version('r2'), 'r2-w', [L(PROMO_SECO, 1)], 'd-r2-w').codigo, 'RS005');
    assert.equal(ver('r2'), '2×Menú Resplandor@23000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 61200');
    assert.deepEqual(ventas(), []);
  });

  test('r2 y r3 (57.000 y 54.000 / 50.400): 2 Seco + un tercero que llega después y un Seco por partes en el orden que sea (con la versión que la tablet vio, o con la nueva): la mesa NUNCA paga más que la cuenta junta', () => {
    for (const orden of ['cobro-antes-del-tercero', 'tercero-antes-del-cobro-viejo', 'tercero-antes-del-cobro-nuevo']) {
      limpiar();
      cuenta('r3', 31, [SECO(2)]);
      const vVista = version('r3');
      if (orden === 'cobro-antes-del-tercero') {
        assert.ok(cobrar('mesero', 'r3', vVista, 'r3-v', [L('zc-seco', 1)], 'd-r3').ok, 'con dos Seco (sin trío) el cobro por partes es válido');
        sql("select public.aplicar_delta_orden('r3', 'zc-seco', 'Seco', 19000, 1, '') is not null;", { como: 'migrador' });
        // 1 Seco cobrado (19.000) + 2 Seco que hay ahora (sin trío): 57.000 por 3 Seco que juntos eran 53.200: «lo cobrado antes del trío no cuenta para el trío que se arme después»
        // (decisión de 20261005130000: la promo se calcula sobre lo que hay en la cuenta abierta). Lo que SÍ no puede pasar es lo de abajo.
        assert.equal(total('r3'), 38000);
      } else {
        sql("select public.aplicar_delta_orden('r3', 'zc-seco', 'Seco', 19000, 1, '') is not null;", { como: 'migrador' });
        assert.equal(ver('r3'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
        const r = cobrar('mesero', 'r3', orden === 'tercero-antes-del-cobro-viejo' ? vVista : version('r3'), 'r3-v', [L('zc-seco', 1)], 'd-r3');
        assert.equal(r.ok, false, orden);
        assert.equal(r.codigo, orden === 'tercero-antes-del-cobro-viejo' ? 'RS003' : 'RS005');
        assert.equal(ver('r3'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200', 'la cuenta queda como estaba');
        assert.deepEqual(ventas(), []);
      }
      // la mesa completa paga lo que dice la base
      const cobrado = Number(comoMesero("select t.cobrar_todo('r3');").salida.split('\n').pop());
      const pagado = ventas().reduce((s, v) => s + Number(v.total), 0);
      assert.equal(pagado, orden === 'cobro-antes-del-tercero' ? 19000 + 38000 : 53200, `${orden}: la mesa paga ${pagado}`);
      assert.ok(cobrado > 0);
    }
  });

  test('«los tres Seco por persona» (cada comensal paga el suyo, tocando la línea base o la de promo): la RPC rechaza los tres y la mesa completa da 53.200; con abonos cada uno paga lo suyo y la suma es 53.200', () => {
    limpiar();
    cuenta('r4', 32, [SECO(3)]);
    for (let i = 1; i <= 3; i += 1) {
      const r = cobrar('mesero', 'r4', version('r4'), `r4-v${i}`, [L(i % 2 ? 'zc-seco' : PROMO_SECO, 1)], `d-r4-${i}`);
      assert.equal(r.codigo, 'RS005', `intento ${i}`);
    }
    assert.equal(ver('r4'), '2×Seco@19000 + 1×Seco · 3er almuerzo · 20% OFF@15200 = 53200');
    // abonos: 19.000 + 19.000 + 15.200 = 53.200 (la mesa completa cobra lo que queda, 0 no se puede: el último abono tiene que ser MENOR que lo que falta)
    assert.ok(abonar('mesero', 'r4', version('r4'), 'r4-a1', 'ur41', 19000, 'efectivo', 'd-r4-a1').ok);
    assert.ok(abonar('mesero', 'r4', version('r4'), 'r4-a2', 'ur42', 19000, 'qr', 'd-r4-a2').ok);
    assert.equal(Number(comoMesero("select t.cobrar_todo('r4');").salida.split('\n').pop()), 15200);
    assert.equal(ventas().reduce((s, v) => s + Number(v.total), 0), 53200);
  });

  // ── pasos al azar ──

  test('pasos al azar con la RPC (agregar, quitar, cobrar por partes —con versiones viejas a veces—, abonar, deshacer): el total es la suma, los descuentos son los de un cálculo independiente, ninguna unidad se pierde ni se duplica, y ninguna venta por partes lleva promo', () => {
    let aceptados = 0; let rechazados = 0; let viejos = 0; let abonos = 0; let deshechos = 0;
    const fallas = [];
    for (let semilla = 1; semilla <= 60; semilla += 1) {
      const r = una(`select t.simular(${(semilla / 200).toFixed(3)}, 50, ${20 + (semilla % 18)}) as r`).r;
      if (r.falla) fallas.push(JSON.stringify(r)); else { aceptados += r.aceptados; rechazados += r.rechazados; viejos += r.viejos; abonos += r.abonos; deshechos += r.deshechos; }
    }
    assert.deepEqual(fallas, [], `una invariante se rompió:\n${fallas.join('\n')}`);
    assert.ok(aceptados > 100 && rechazados > 60 && viejos > 30 && abonos > 100 && deshechos > 100, `la simulación tiene que ejercitar todo: aceptados ${aceptados}, rechazados ${rechazados}, viejos ${viejos}, abonos ${abonos}, deshechos ${deshechos}`);
  });

  // ── instalación ──

  test('aplicarla otra vez es inocua: el catálogo queda idéntico y sin WARNING, y los datos (ventas, cuentas, ids anotados) no se tocan', () => {
    limpiar();
    cuenta('z0', 40, [SOPA(2)]);
    assert.ok(cobrar('mesero', 'z0', version('z0'), 'z0-v', [L('zc-sopa', 1)], 'd-z0').ok);
    const otra = radiografia(pg);
    const datos = () => ({ ordenes: pg.filas('select id, items, total, version, estado from public.ordenes order by id'), deltas: pg.filas('select id from public.deltas_aplicados order by id') });
    const d0 = datos();
    const r = aplicarNueva();
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(ordenada(radiografia(pg)), ordenada(otra));
    assert.deepEqual(datos(), d0);
  });

  test('la reversa de la cabecera quita las tres funciones y deja el resto como estaba (las cuentas y las ventas no cambian); volver a aplicar lo deja idéntico', () => {
    limpiar();
    cuenta('z1', 41, [SOPA(2)]);
    assert.ok(cobrar('mesero', 'z1', version('z1'), 'z1-v', [L('zc-sopa', 1)], 'd-z1').ok);
    const con = radiografia(pg);
    const datos = pg.filas('select id, items, total, version from public.ordenes order by id');
    const rev = pg.sql(reversa(SQL), { como: 'migrador' });
    assert.ok(rev.ok, rev.error);
    const sin = radiografia(pg);
    const nombres = (r) => r.funciones.map((f) => `${f.nspname}.${f.proname}`);
    assert.ok(!nombres(sin).some((f) => /cobrar_parcial|cobrar_abono|items_de_hoy/.test(f)), 'las tres funciones se fueron');
    for (const seccion of ['relaciones', 'columnas', 'policies', 'triggers', 'restricciones', 'publicacion']) assert.deepEqual(sin[seccion], con[seccion], seccion);
    assert.deepEqual(sin.funciones, con.funciones.filter((f) => !/cobrar_parcial|cobrar_abono|items_de_hoy/.test(f.proname)));
    assert.deepEqual(pg.filas('select id, items, total, version from public.ordenes order by id'), datos, 'los datos no cambiaron');
    const r = aplicarNueva();
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(ordenada(radiografia(pg)), ordenada(con));
    assert.ok(cobrar('mesero', 'z1', version('z1'), 'z1-w', [L('zc-sopa', 1)], 'd-z1-w').ok, 'y vuelve a funcionar');
  });
});

describe('se niega a correr, sin cambiar nada, si falta 20261005100000 o 20261002180000 (Postgres desechable propio)', { skip: MOTIVO }, () => {
  const propio = async (hasta, quitar = '') => {
    const pg = await levantarPostgres();
    prepararSimulacion(pg);
    const previas = aplicarMigraciones(pg, DIR_MIGRACIONES, { antesDe: hasta });
    assert.ok(previas.length >= 10 && previas.every((m) => m.ok), `la cadena previa no se aplicó: ${previas.map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    if (quitar) { const q = pg.sql(quitar); assert.ok(q.ok, q.error); }
    return pg;
  };

  test('sin privado.normalizar_items aborta con el mensaje que dice qué migración falta, y no deja funciones', async () => {
    const pg = await propio(PRECIO_VIVO);
    try {
      const antes = radiografia(pg);
      const r = pg.sql(SQL, { como: 'migrador' });
      assert.equal(r.ok, false);
      assert.match(r.error, /Falta 20261005100000_precio_vivo_y_promos\.sql[\s\S]*No se cambió nada/);
      assert.deepEqual(radiografia(pg), antes);
    } finally { pg.parar(); }
  });

  test('sin privado.dia_promo (un 20261005100000 de antes de 312eb93: el día lo daba abierta_en) aborta con el mensaje que lo dice, y no deja funciones', async () => {
    const pg = await propio(NUEVA, 'drop function privado.dia_promo();');
    try {
      const antes = radiografia(pg);
      const r = pg.sql(SQL, { como: 'migrador' });
      assert.equal(r.ok, false);
      assert.match(r.error, /Falta privado\.dia_promo[\s\S]*312eb93[\s\S]*No se cambió nada/);
      assert.deepEqual(radiografia(pg), antes);
    } finally { pg.parar(); }
  });

  test('sin privado.delta_registrar (20261002180000) también aborta, sin cambiar nada', async () => {
    const pg = await propio(NUEVA, 'drop function privado.delta_registrar(text, text);');
    try {
      const antes = radiografia(pg);
      const r = pg.sql(SQL, { como: 'migrador' });
      assert.equal(r.ok, false);
      assert.match(r.error, /Falta 20261002180000_deshacer_cobro\.sql[\s\S]*No se cambió nada/);
      assert.deepEqual(radiografia(pg), antes);
    } finally { pg.parar(); }
  });
});
