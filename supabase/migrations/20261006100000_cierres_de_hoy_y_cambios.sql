-- ════════════════════════════════════════════════════════════
-- Resplandor — CIERRES POR DÍA (cerrar hoy, o un día pasado que quedó sin cerrar) y PANEL DE CIERRES CON RASTRO (solo admin)
-- (pedido de Yonatan, 2026-10-05, tareas/2026-10-05-cierres-de-hoy-y-panel-admin.md: «transacciones del turno deben ser de hoy y debe haber
-- un aviso sutil que diga que no se ha cerrado el día de ayer y pueda dejar de ser visto; poder tener un panel para cierres diarios,
-- modificar cierres y demás, modo admin solo para admin»)
--
-- QUÉ HACE
--   1. `public.cerrar_dia_de(p_id, p_dia, p_esperado)`: el cierre de UN día (el de hoy o uno pasado que nadie cerró), solo admin, en una
--      transacción y con el mismo candado de aviso que `cerrar_dia`. Cierra SOLO las ventas cerradas y no archivadas cuyo día en
--      America/Bogota (el de `cerrada_en`; si falta, el de `abierta_en`) es `p_dia`: las de otros días no se tocan y siguen por cerrar.
--      Para el día de hoy el cierre se guarda con la hora de ahora y rechaza si hay cuentas abiertas (`hay_abiertas`, como siempre); para
--      un día pasado la fecha del cierre es el final de ese día en Bogotá (23:59:59) y las cuentas abiertas NO lo frenan (una cuenta
--      abierta todavía no es una venta: cuando se cobre será de su día). El admin firma lo que ve: `p_esperado` = {n, total, ids} tiene
--      que ser lo que hay (si no, `cambio` con el resumen y no cambia nada). El mismo `p_id` otra vez devuelve el cierre que ya se guardó.
--      Borra lo que archiva (las ventas del día y los rezagos ya archivados), purga `deltas_aplicados` y marca como de este cierre los
--      cobros deshechos hasta ese día. Devuelve jsonb {ok, repetido, n, total, borradas, dia, cierre, deshechos} o
--      {ok: false, codigo} con codigo = no_autorizado | invalido | hay_abiertas | sin_ventas | cambio.
--      `cerrar_dia(text, jsonb)` (la firma vieja, de 20261002180000) NO se toca: sigue cerrando TODAS las ventas por cerrar de cualquier día,
--      para el POS que todavía no se recargó.
--   2. `cierres` gana `nota` (texto libre, hasta 500) y `anulado_en` / `anulado_por` / `anulado_motivo` (un cierre anulado se queda en la tabla).
--      El UPDATE directo de `authenticated` sobre `cierres` queda limitado a las columnas de siempre (id, fecha, total_ventas,
--      total_ordenes, transacciones): la nota y la anulación solo se escriben por las dos RPC de abajo, que dejan su motivo en el rastro.
--   3. `public.cierre_corregir_nota(p_cierre_id, p_nota)` y `public.cierre_anular(p_cierre_id, p_motivo)`, solo admin, en una transacción:
--        · la nota se corrige sin tocar un solo peso. Los totales de un cierre SALEN de sus ventas: no se editan a mano (ninguna RPC los
--          recibe). Sacar una venta de un cierre sigue siendo `reabrir_venta_de_cierre` (20261002180000), que recalcula el total.
--        · anular un cierre equivocado NO borra nada: el cierre se queda (con su motivo, quién y cuándo) y sus ventas vuelven a las ventas
--          por cerrar (`ordenes` cerradas, sin archivar: cierre_ordenes las libera) para cerrarlas bien con `cerrar_dia_de`. Una venta
--          cuyo id ya vive en `ordenes` (una cuenta que se reabrió o un rezago) no se vuelve a crear: queda como está y se cuenta en
--          `omitidas`. Si la mesa de una venta ya no existe no se cambia nada (`mesa_inexistente`). Un cierre anulado no se descongela:
--          una venta ya no se puede sacar de él ni se edita (RS006); para rehacerlo se cierra el día otra vez.
--   4. `public.cierres_cambios`, el RASTRO: una fila por cada cambio a un cierre (quién, cuándo, qué cierre, qué cambió, antes y después, y
--      el motivo si lo hubo). La escribe SOLO un disparador SECURITY DEFINER sobre `cierres` (`trg_cierres_rastro`), así que nadie la escribe
--      por la API y tampoco se escapa ningún camino: ni las RPC de arriba, ni `reabrir_venta_de_cierre`, ni la edición directa del historial
--      del POS (el admin que quita o corrige una venta desde «Historial») ni el cierre del día mismo. `accion` = cierre | nota | anulado |
--      venta_sacada | edicion. `antes` y `despues` traen el resumen (fecha, total, n, nota, anulado y la lista de ventas con su total) y
--      `detalle` las ventas completas que salieron, entraron o cambiaron: aunque la venta ya no esté en el cierre, queda aquí. La tabla solo se
--      agrega: un disparador rechaza UPDATE y DELETE. NO se borra con el tiempo (es contabilidad, no el seguimiento de los cobros deshechos).
--
-- QUIÉN LO VE Y QUIÉN LO CAMBIA
--   `cierres_cambios`: solo el admin la lee (RLS + GRANT SELECT); nadie la escribe por la API (sin GRANT de escritura). `cerrar_dia_de`,
--   `cierre_corregir_nota` y `cierre_anular`: EXECUTE solo para `authenticated` y adentro `mi_rol() = 'admin'` (el mesero recibe
--   `no_autorizado`). El historial de cierres lo siguen viendo, en solo lectura, todos los del personal (no cambia ninguna policy).
--
-- Necesita 20261002180000_deshacer_cobro.sql (cierre_ordenes, deshechos, cerrar_dia) y el esquema `privado`; si falta algo se niega a
-- correr SIN cambiar nada. Idempotente (add column if not exists, create or replace, drop trigger if exists, el CHECK solo si no existe).
--
-- REVERSA (menos de 1 minuto; BORRA el rastro `cierres_cambios` y las notas y anulaciones: sácales una copia antes si importan; los cierres
-- anulados vuelven a verse como cierres normales, con las ventas que tenían, y sus ventas liberadas se quedan en las ventas por cerrar):
--   begin;
--   drop trigger if exists trg_cierres_rastro on public.cierres;
--   drop trigger if exists trg_cierres_anulado_congelado on public.cierres;
--   drop trigger if exists trg_cierres_cambios_solo_agregar on public.cierres_cambios;
--   drop function if exists public.cierres_rastro();
--   drop function if exists public.cierres_anulado_congelado();
--   drop function if exists public.cierres_cambios_solo_agregar();
--   drop function if exists public.cierre_corregir_nota(text, text);
--   drop function if exists public.cierre_anular(text, text);
--   drop function if exists public.cerrar_dia_de(text, date, jsonb);
--   drop function if exists privado.cierre_resumen(public.cierres);
--   drop function if exists privado.ts_o_null(text);
--   drop function if exists privado.hoy_bogota();
--   drop function if exists privado.fecha_bogota(timestamp with time zone);
--   drop table if exists public.cierres_cambios;
--   revoke update (id, fecha, total_ventas, total_ordenes, transacciones) on public.cierres from authenticated;
--   grant update on public.cierres to authenticated;
--   alter table public.cierres drop constraint if exists cierres_anulado_coherente;
--   alter table public.cierres drop constraint if exists cierres_nota_larga;
--   alter table public.cierres drop column if exists nota;
--   alter table public.cierres drop column if exists anulado_en;
--   alter table public.cierres drop column if exists anulado_por;
--   alter table public.cierres drop column if exists anulado_motivo;
--   commit;
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Orden de salida al aire: 1) esta migración, 2) push del POS. El POS nuevo
-- sin esta migración sigue funcionando: cierra el día por `cerrar_dia` (como antes), no ofrece «Cerrar ayer» y el panel avisa que falta aplicarla.
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regnamespace('privado') is null then
    raise exception 'Falta el esquema privado (20261001120000_cuenta_en_vivo.sql): aplicala primero. No se cambió nada.';
  end if;
  if to_regclass('public.cierre_ordenes') is null or to_regclass('public.deshechos') is null
     or to_regprocedure('public.cerrar_dia(text, jsonb)') is null or to_regprocedure('public.reabrir_venta_de_cierre(text, text, integer)') is null then
    raise exception 'Falta 20261002180000_deshacer_cobro.sql (cierre_ordenes, deshechos, cerrar_dia): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.mi_rol()') is null or to_regprocedure('public.mi_correo()') is null then
    raise exception 'Falta 20261002120000_personal_y_compuerta.sql (mi_rol, mi_correo): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. Columnas nuevas de `cierres` ─────────────────────────

alter table public.cierres add column if not exists nota text;
alter table public.cierres add column if not exists anulado_en timestamp with time zone;
alter table public.cierres add column if not exists anulado_por text;
alter table public.cierres add column if not exists anulado_motivo text;

comment on column public.cierres.nota is
  'Nota libre del cierre (hasta 500 caracteres), la corrige el admin con cierre_corregir_nota. No cambia ningún peso.';
comment on column public.cierres.anulado_en is
  'Cuándo se anuló el cierre (cierre_anular). Un cierre anulado se queda en la tabla con sus ventas como estaban; las ventas volvieron a las ventas por cerrar. null = vigente.';
comment on column public.cierres.anulado_por is 'Correo de quien anuló el cierre.';
comment on column public.cierres.anulado_motivo is 'Por qué se anuló (obligatorio, de 3 a 300 caracteres).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cierres_nota_larga' and conrelid = 'public.cierres'::regclass) then
    alter table public.cierres add constraint cierres_nota_larga check (nota is null or length(nota) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cierres_anulado_coherente' and conrelid = 'public.cierres'::regclass) then
    alter table public.cierres add constraint cierres_anulado_coherente check (
      (anulado_en is null and anulado_por is null and anulado_motivo is null)
      or (anulado_en is not null and anulado_por is not null and length(btrim(coalesce(anulado_motivo, ''))) >= 3));
  end if;
end $$;

-- UPDATE directo: solo las columnas de siempre (el POS sube y edita cierres con un upsert de estas cinco). Nota y anulación, por las RPC.
revoke update on public.cierres from authenticated;
grant update (id, fecha, total_ventas, total_ordenes, transacciones) on public.cierres to authenticated;

-- ── 2. El día en Bogotá ─────────────────────────────────────

create or replace function privado.fecha_bogota(p_cuando timestamp with time zone)
  returns date
  language sql
  stable
  set search_path = ''
as $$ select (p_cuando at time zone 'America/Bogota')::date $$;

create or replace function privado.hoy_bogota()
  returns date
  language sql
  stable
  set search_path = ''
as $$ select (now() at time zone 'America/Bogota')::date $$;

-- Un texto a fecha-hora, o null si no lo es (los cierres viejos guardan las horas como texto de JSON, a veces vacío).
create or replace function privado.ts_o_null(p_texto text)
  returns timestamp with time zone
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if p_texto is null or p_texto = '' then return null; end if;
  return p_texto::timestamp with time zone;
exception when others then
  return null;
end $$;

revoke all on function privado.fecha_bogota(timestamp with time zone), privado.hoy_bogota(), privado.ts_o_null(text) from public, anon, authenticated;

-- El resumen de un cierre para el rastro: lo que importa de un vistazo (no las ventas enteras; esas van en `detalle`).
create or replace function privado.cierre_resumen(p_cierre public.cierres)
  returns jsonb
  language sql
  stable
  set search_path = ''
as $$
  select jsonb_build_object(
    'fecha', p_cierre.fecha,
    'total', p_cierre.total_ventas,
    'n', p_cierre.total_ordenes,
    'nota', p_cierre.nota,
    'anulado_en', p_cierre.anulado_en,
    'ventas', coalesce((
      select jsonb_agg(jsonb_build_object('id', e ->> 'id', 'mesa', coalesce(e ->> 'mesaId', e ->> 'mesa_id'), 'total', e -> 'total') order by n)
        from jsonb_array_elements(case when jsonb_typeof(p_cierre.transacciones) = 'array' then p_cierre.transacciones else '[]'::jsonb end)
             with ordinality as x(e, n)
       where jsonb_typeof(e) = 'object'), '[]'::jsonb))
$$;

revoke all on function privado.cierre_resumen(public.cierres) from public, anon, authenticated;

-- ── 3. El rastro: `cierres_cambios` ─────────────────────────

create table if not exists public.cierres_cambios (
  id bigint generated always as identity,
  cierre_id text not null,
  accion text not null,
  quien text,
  cuando timestamp with time zone not null default now(),
  motivo text,
  antes jsonb not null default '{}'::jsonb,
  despues jsonb not null default '{}'::jsonb,
  detalle jsonb not null default '{}'::jsonb,
  constraint cierres_cambios_pkey primary key (id),
  constraint cierres_cambios_accion_check check (accion = any (array['cierre'::text, 'nota'::text, 'anulado'::text, 'venta_sacada'::text, 'edicion'::text]))
);
-- Sin clave foránea a `cierres` a propósito: el rastro tiene que sobrevivir a cualquier cosa que le pase al cierre.

create index if not exists cierres_cambios_cierre on public.cierres_cambios using btree (cierre_id, cuando desc);
create index if not exists cierres_cambios_cuando on public.cierres_cambios using btree (cuando desc);

comment on table public.cierres_cambios is
  'El rastro de los cierres del día: una fila por cada cambio (cierre, nota, anulado, venta_sacada, edicion) con quién (correo de la sesión de Google; null si lo hizo el SQL Editor), cuándo, el motivo, y el antes y el después. La escribe SOLO trg_cierres_rastro (SECURITY DEFINER); solo la lee el admin; solo se agrega (UPDATE y DELETE se rechazan); no se purga.';

alter table public.cierres_cambios enable row level security;

drop policy if exists cierres_cambios_ver on public.cierres_cambios;
create policy cierres_cambios_ver on public.cierres_cambios for select to authenticated
  using ((select public.mi_rol()) = 'admin');

revoke all on public.cierres_cambios from anon, authenticated, service_role;
grant select on public.cierres_cambios to authenticated;

create or replace function public.cierres_cambios_solo_agregar()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  raise exception 'el rastro de los cierres solo se agrega: no se cambia ni se borra' using errcode = 'RS007';
end;
$function$;

revoke all on function public.cierres_cambios_solo_agregar() from public, anon, authenticated;

drop trigger if exists trg_cierres_cambios_solo_agregar on public.cierres_cambios;
create trigger trg_cierres_cambios_solo_agregar
  before update or delete on public.cierres_cambios
  for each row
  execute function public.cierres_cambios_solo_agregar();

-- Quien escribe el rastro: un disparador sobre `cierres`, SECURITY DEFINER (quien guarda el cierre no puede escribir en el rastro). Las RPC le
-- dicen qué hicieron con tres ajustes de la transacción (`resplandor.cierre_accion`, `…_motivo`, `…_origen`); si no dicen nada (un cierre
-- guardado por el POS de siempre, un UPDATE de `reabrir_venta_de_cierre` o la edición del historial) la acción se deduce de lo que cambió.
create or replace function public.cierres_rastro()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_accion text := nullif(current_setting('resplandor.cierre_accion', true), '');
  v_motivo text := nullif(current_setting('resplandor.cierre_motivo', true), '');
  v_origen text := nullif(current_setting('resplandor.cierre_origen', true), '');
  v_quien text := (select public.mi_correo());
  v_viejas jsonb;
  v_nuevas jsonb;
  v_sacadas jsonb;
  v_agregadas jsonb;
  v_editadas jsonb;
  v_ventas boolean;
  v_nota boolean;
  v_anulado boolean;
  v_resto boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.cierres_cambios (cierre_id, accion, quien, motivo, antes, despues, detalle)
    values (new.id, 'cierre', v_quien, v_motivo, '{}'::jsonb, privado.cierre_resumen(new),
            case when v_origen is null then '{}'::jsonb else jsonb_build_object('origen', v_origen) end);
    return null;
  end if;

  v_ventas := new.transacciones is distinct from old.transacciones;
  v_nota := new.nota is distinct from old.nota;
  v_anulado := new.anulado_en is distinct from old.anulado_en;
  v_resto := new.fecha is distinct from old.fecha or new.total_ventas is distinct from old.total_ventas or new.total_ordenes is distinct from old.total_ordenes;
  if not (v_ventas or v_nota or v_anulado or v_resto) then
    return null;                      -- el POS que sube otra vez lo mismo: no es un cambio
  end if;

  v_viejas := case when jsonb_typeof(old.transacciones) = 'array' then old.transacciones else '[]'::jsonb end;
  v_nuevas := case when jsonb_typeof(new.transacciones) = 'array' then new.transacciones else '[]'::jsonb end;
  select coalesce(jsonb_agg(o.e order by o.n), '[]'::jsonb) into v_sacadas
    from jsonb_array_elements(v_viejas) with ordinality as o(e, n)
   where not exists (select 1 from jsonb_array_elements(v_nuevas) x where x ->> 'id' = o.e ->> 'id');
  select coalesce(jsonb_agg(x.e order by x.n), '[]'::jsonb) into v_agregadas
    from jsonb_array_elements(v_nuevas) with ordinality as x(e, n)
   where not exists (select 1 from jsonb_array_elements(v_viejas) o where o ->> 'id' = x.e ->> 'id');
  select coalesce(jsonb_agg(jsonb_build_object('antes', o.e, 'despues', x.e) order by x.n), '[]'::jsonb) into v_editadas
    from jsonb_array_elements(v_nuevas) with ordinality as x(e, n)
    join jsonb_array_elements(v_viejas) as o(e) on o.e ->> 'id' = x.e ->> 'id'
   where o.e is distinct from x.e;

  insert into public.cierres_cambios (cierre_id, accion, quien, motivo, antes, despues, detalle)
  values (
    new.id,
    coalesce(v_accion, case
      when v_anulado then 'anulado'
      when v_ventas and jsonb_array_length(v_sacadas) > 0 and jsonb_array_length(v_agregadas) = 0 and jsonb_array_length(v_editadas) = 0 then 'venta_sacada'
      when v_nota and not v_ventas and not v_resto then 'nota'
      else 'edicion' end),
    v_quien,
    coalesce(v_motivo, case when v_anulado then new.anulado_motivo end),
    privado.cierre_resumen(old),
    privado.cierre_resumen(new),
    jsonb_strip_nulls(jsonb_build_object(
      'sacadas', case when jsonb_array_length(v_sacadas) > 0 then v_sacadas end,
      'agregadas', case when jsonb_array_length(v_agregadas) > 0 then v_agregadas end,
      'editadas', case when jsonb_array_length(v_editadas) > 0 then v_editadas end,
      'origen', v_origen)));
  return null;
end;
$function$;

revoke all on function public.cierres_rastro() from public, anon, authenticated;

drop trigger if exists trg_cierres_rastro on public.cierres;
create trigger trg_cierres_rastro
  after insert or update on public.cierres
  for each row
  execute function public.cierres_rastro();

-- Un cierre anulado no se descongela: sus ventas ya volvieron a las ventas por cerrar, y editarlo o sacarle una venta las duplicaría.
-- Se rechaza CUALQUIER UPDATE que nombre una de sus columnas de contenido, aunque el valor sea idéntico: el upsert del POS (guardarEdicion sin
-- cambios, desde una tablet con el historial atrasado) manda las cinco columnas con el mismo contenido, y `trg_cierres_registrar_ordenes`
-- (`update of transacciones`) volvería a archivar en `cierre_ordenes` las ventas liberadas, que el siguiente cierre borraría sin contarlas.
-- `update of` dispara por la columna nombrada en el SET, haya cambiado o no. La anulación misma (anulado_*) y la nota no están en la lista.
create or replace function public.cierres_anulado_congelado()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  if old.anulado_en is not null then
    raise exception 'el cierre % está anulado: no se edita ni se le sacan ventas (cierra el día otra vez)', old.id using errcode = 'RS006';
  end if;
  return new;
end;
$function$;

revoke all on function public.cierres_anulado_congelado() from public, anon, authenticated;

drop trigger if exists trg_cierres_anulado_congelado on public.cierres;
create trigger trg_cierres_anulado_congelado
  before update of fecha, total_ventas, total_ordenes, transacciones on public.cierres
  for each row
  execute function public.cierres_anulado_congelado();

-- ── 4. cerrar_dia_de: el cierre de UN día ───────────────────
-- Candados, en el mismo orden que cerrar_dia y deshacer_cobro: el candado de aviso y las órdenes por id.

create or replace function public.cerrar_dia_de(p_id text, p_dia date, p_esperado jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  v_hoy date := privado.hoy_bogota();
  v_ids text[];
  v_ya text[];
  v_abiertas integer[];
  v_enlazadas integer[];
  v_n integer;
  v_total numeric;
  v_resumen jsonb;
  v_esp_ids text[];
  v_trans jsonb;
  v_fecha timestamp with time zone;
  v_borradas integer := 0;
  v_deshechos jsonb;
  v_cierre public.cierres;
begin
  if v_rol is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_id is null or p_id = '' or p_dia is null or p_dia > v_hoy or p_esperado is null or jsonb_typeof(p_esperado) <> 'object' then
    return jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));

  -- El mismo cierre otra vez (se perdió la respuesta): el que ya se guardó, tal cual.
  select * into v_cierre from public.cierres where id = p_id;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('orden_id', d.orden_id, 'mesa_id', d.mesa_id, 'tipo', d.tipo, 'monto', d.monto,
                                                 'hecho_por', d.hecho_por, 'hecho_en', d.hecho_en) order by d.hecho_en), '[]'::jsonb)
      into v_deshechos from public.deshechos d where d.cierre_id = p_id;
    return jsonb_build_object('ok', true, 'repetido', true, 'n', v_cierre.total_ordenes, 'total', v_cierre.total_ventas, 'borradas', 0, 'dia', p_dia,
                              'cierre', jsonb_build_object('id', v_cierre.id, 'fecha', v_cierre.fecha, 'total', v_cierre.total_ventas,
                                                           'n', v_cierre.total_ordenes, 'ordenes', v_cierre.transacciones),
                              'deshechos', v_deshechos);
  end if;

  -- Las ventas del día: las cerradas que no están en ningún cierre y son de `p_dia` en Bogotá, con candado y en orden. Y las cerradas que ya
  -- estaban archivadas (rezagos de una purga que no terminó): no se cuentan y se borran al cerrar, como en cerrar_dia.
  perform 1 from public.ordenes where estado = 'cerrada' order by id for update;
  select coalesce(array_agg(o.id order by o.id) filter (where not exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id)
                                                          and privado.fecha_bogota(coalesce(o.cerrada_en, o.abierta_en)) = p_dia), '{}'::text[]),
         coalesce(array_agg(o.id order by o.id) filter (where exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id)), '{}'::text[])
    into v_ids, v_ya
    from public.ordenes o where o.estado = 'cerrada';

  select count(*), coalesce(sum(o.total), 0) into v_n, v_total from public.ordenes o where o.id = any(v_ids);
  v_resumen := jsonb_build_object(
    'n', v_n, 'total', v_total, 'ids', to_jsonb(v_ids), 'dia', p_dia,
    'abonos_por_metodo', coalesce((
      select jsonb_object_agg(m.metodo, m.suma)
        from (select coalesce(nullif(e ->> 'nota', ''), 'sin_metodo') as metodo,
                     sum((e ->> 'precio')::numeric * (e ->> 'qty')::int) as suma
                from public.ordenes o
               cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) e
               where o.id = any(v_ids) and (e ->> 'id') like 'abono\_%' and (e ->> 'id') not like 'abono\_recibido\_%'
               group by 1) m), '{}'::jsonb));

  -- Cerrar HOY exige las mesas cobradas (la regla de siempre). Un día pasado no: una cuenta abierta no es una venta, y cuando se cobre será de su día.
  if p_dia = v_hoy then
    select array_agg(distinct o.mesa_id order by o.mesa_id) into v_abiertas from public.ordenes o where o.estado = 'abierta';
    if v_abiertas is not null then
      select array_agg(distinct o.mesa_id order by o.mesa_id) into v_enlazadas from public.ordenes o
       where o.estado = 'abierta' and exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id);
      return jsonb_build_object('ok', false, 'codigo', 'hay_abiertas', 'abiertas', to_jsonb(v_abiertas),
                                'en_cierre', coalesce(to_jsonb(v_enlazadas), '[]'::jsonb), 'resumen', v_resumen);
    end if;
  end if;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'codigo', 'sin_ventas', 'resumen', v_resumen);
  end if;

  -- El admin firma lo que ve: la cantidad, el total y las ventas que el POS esperaba tienen que ser las de la base.
  if p_esperado ->> 'n' is distinct from v_n::text
     or (case when p_esperado ->> 'total' ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_esperado ->> 'total')::numeric else null end) is distinct from v_total then
    return jsonb_build_object('ok', false, 'codigo', 'cambio', 'resumen', v_resumen);
  end if;
  if p_esperado ? 'ids' then
    if jsonb_typeof(p_esperado -> 'ids') <> 'array' then
      return jsonb_build_object('ok', false, 'codigo', 'invalido');
    end if;
    select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_esp_ids from jsonb_array_elements_text(p_esperado -> 'ids') x;
    if v_esp_ids is distinct from v_ids then
      return jsonb_build_object('ok', false, 'codigo', 'cambio', 'resumen', v_resumen);
    end if;
  end if;

  -- Todo cuadra: el cierre, el borrado y los deshechos hasta ese día, juntos.
  select jsonb_agg(jsonb_build_object('id', o.id, 'mesaId', o.mesa_id, 'estado', 'cerrada', 'items', o.items, 'total', o.total,
                                      'abiertaEn', o.abierta_en, 'cerradaEn', o.cerrada_en, 'version', o.version, 'parcialDe', o.parcial_de)
                   order by o.cerrada_en, o.id)
    into v_trans from public.ordenes o where o.id = any(v_ids);

  -- Hoy: la hora de ahora. Un día pasado: el final de ese día en Bogotá (el cierre cae en su día, no en el de hoy).
  v_fecha := case when p_dia = v_hoy then now() else ((p_dia + 1)::timestamp at time zone 'America/Bogota') - interval '1 second' end;

  perform set_config('resplandor.cierre_origen', 'cerrar_dia_de ' || p_dia::text, true);
  insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones)
  values (p_id, v_fecha, v_total, v_n, v_trans);

  delete from public.ordenes where id = any(v_ids) or id = any(v_ya);
  get diagnostics v_borradas = row_count;

  delete from public.deltas_aplicados d where not exists (select 1 from public.ordenes o where o.id = d.orden_id);

  with marcados as (
    update public.deshechos set cierre_id = p_id
     where cierre_id is null and privado.fecha_bogota(hecho_en) <= p_dia
    returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('orden_id', m.orden_id, 'mesa_id', m.mesa_id, 'tipo', m.tipo, 'monto', m.monto,
                                               'hecho_por', m.hecho_por, 'hecho_en', m.hecho_en) order by m.hecho_en), '[]'::jsonb)
    into v_deshechos from marcados m;

  return jsonb_build_object('ok', true, 'repetido', false, 'n', v_n, 'total', v_total, 'borradas', v_borradas, 'dia', p_dia,
                            'cierre', jsonb_build_object('id', p_id, 'fecha', v_fecha, 'total', v_total, 'n', v_n, 'ordenes', v_trans),
                            'deshechos', v_deshechos);
end;
$function$;

comment on function public.cerrar_dia_de(text, date, jsonb) is
  'El cierre de UN día (hoy o uno pasado sin cerrar), solo para el admin y en una transacción: toma las ventas cerradas sin archivar de ese día en Bogotá, rechaza si lo que el POS espera no es lo que hay (y, para hoy, si hay cuentas abiertas), guarda el cierre (con la fecha de ese día), borra lo que archiva y marca los deshechos hasta ese día. Las ventas de otros días no se tocan.';

revoke all on function public.cerrar_dia_de(text, date, jsonb) from public, anon, service_role;
grant execute on function public.cerrar_dia_de(text, date, jsonb) to authenticated;

-- ── 5. cierre_corregir_nota ─────────────────────────────────
-- Devuelve {ok: true, sin_cambio, cierre: {id, nota}} o {ok: false, codigo} con codigo = no_autorizado | invalido | nota_larga | no_existe | anulado.

create or replace function public.cierre_corregir_nota(p_cierre_id text, p_nota text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  k public.cierres;
begin
  if v_rol is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_cierre_id is null or p_cierre_id = '' then
    return jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  if length(coalesce(v_nota, '')) > 500 then
    return jsonb_build_object('ok', false, 'codigo', 'nota_larga');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));
  select * into k from public.cierres where id = p_cierre_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  if k.anulado_en is not null then
    return jsonb_build_object('ok', false, 'codigo', 'anulado');
  end if;
  if k.nota is not distinct from v_nota then
    return jsonb_build_object('ok', true, 'sin_cambio', true, 'cierre', jsonb_build_object('id', k.id, 'nota', k.nota));
  end if;

  perform set_config('resplandor.cierre_accion', 'nota', true);
  update public.cierres c1 set nota = v_nota where c1.id = p_cierre_id returning * into k;
  return jsonb_build_object('ok', true, 'sin_cambio', false, 'cierre', jsonb_build_object('id', k.id, 'nota', k.nota));
end;
$function$;

comment on function public.cierre_corregir_nota(text, text) is
  'Corrige la nota de un cierre (solo admin, hasta 500 caracteres; vacío la quita). No toca ningún peso. El cambio queda en cierres_cambios.';

revoke all on function public.cierre_corregir_nota(text, text) from public, anon, service_role;
grant execute on function public.cierre_corregir_nota(text, text) to authenticated;

-- ── 6. cierre_anular ────────────────────────────────────────
-- Anular un cierre equivocado, sin borrar nada: el cierre se queda con su motivo, y sus ventas vuelven a las ventas por cerrar (`ordenes`
-- cerradas, ya sin cierre_ordenes) con sus ítems, su total y sus horas, para cerrarlas bien con cerrar_dia_de. Todo o nada.
-- Devuelve {ok: true, liberadas, omitidas, total, cierre: {id, anulado_en, anulado_por, anulado_motivo}} o {ok: false, codigo} con codigo =
--   no_autorizado | invalido | motivo_requerido (de 3 a 300 caracteres) | no_existe | ya_anulado | mesa_inexistente (con `mesas`)

create or replace function public.cierre_anular(p_cierre_id text, p_motivo text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_quien text := coalesce((select public.mi_correo()), 'desconocido');
  k public.cierres;
  v_ventas jsonb;
  v_sin_mesa text[];
  v_liberadas integer := 0;
  v_omitidas integer := 0;
  v_total numeric := 0;
begin
  if v_rol is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_cierre_id is null or p_cierre_id = '' then
    return jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 300 then
    return jsonb_build_object('ok', false, 'codigo', 'motivo_requerido');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));
  select * into k from public.cierres where id = p_cierre_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  if k.anulado_en is not null then
    return jsonb_build_object('ok', false, 'codigo', 'ya_anulado');
  end if;

  -- Las ventas como las guardó el cierre (una por id; las horas y la mesa, con los dos nombres que han usado los cierres).
  select coalesce(jsonb_agg(v.fila order by v.n), '[]'::jsonb) into v_ventas
    from (select distinct on (x.e ->> 'id') x.n, jsonb_build_object(
            'id', x.e ->> 'id',
            'mesa_id', case when coalesce(x.e ->> 'mesaId', x.e ->> 'mesa_id') ~ '^[0-9]+$' then (coalesce(x.e ->> 'mesaId', x.e ->> 'mesa_id'))::int end,
            'items', case when jsonb_typeof(x.e -> 'items') = 'array' then x.e -> 'items' else '[]'::jsonb end,
            'total', case when x.e ->> 'total' ~ '^-?[0-9]+(\.[0-9]+)?$' then (x.e ->> 'total')::numeric else 0 end,
            'abierta_en', coalesce(privado.ts_o_null(coalesce(x.e ->> 'abiertaEn', x.e ->> 'abierta_en')), k.fecha),
            'cerrada_en', coalesce(privado.ts_o_null(coalesce(x.e ->> 'cerradaEn', x.e ->> 'cerrada_en')), k.fecha),
            'version', case when x.e ->> 'version' ~ '^[0-9]+$' then (x.e ->> 'version')::int else 0 end,
            'parcial_de', coalesce(x.e ->> 'parcialDe', x.e ->> 'parcial_de')) as fila
            from jsonb_array_elements(case when jsonb_typeof(k.transacciones) = 'array' then k.transacciones else '[]'::jsonb end)
                 with ordinality as x(e, n)
           where jsonb_typeof(x.e) = 'object' and x.e ->> 'id' is not null and not exists (select 1 from public.ordenes o where o.id = x.e ->> 'id')
           order by x.e ->> 'id', x.n) v;

  -- Todo o nada: si a alguna venta le falta su mesa, no se cambia nada.
  select array_agg(distinct coalesce(f ->> 'mesa_id', '?')) into v_sin_mesa
    from jsonb_array_elements(v_ventas) f
   where f ->> 'mesa_id' is null or not exists (select 1 from public.mesas m where m.id = (f ->> 'mesa_id')::int);
  if v_sin_mesa is not null then
    return jsonb_build_object('ok', false, 'codigo', 'mesa_inexistente', 'mesas', to_jsonb(v_sin_mesa));
  end if;

  insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, version, parcial_de)
  select f ->> 'id', (f ->> 'mesa_id')::int, 'cerrada', f -> 'items', (f ->> 'total')::numeric,
         (f ->> 'abierta_en')::timestamp with time zone, (f ->> 'cerrada_en')::timestamp with time zone, (f ->> 'version')::int, f ->> 'parcial_de'
    from jsonb_array_elements(v_ventas) f;
  get diagnostics v_liberadas = row_count;
  select coalesce(sum((f ->> 'total')::numeric), 0) into v_total from jsonb_array_elements(v_ventas) f;
  v_omitidas := (select count(distinct e ->> 'id')::int from jsonb_array_elements(case when jsonb_typeof(k.transacciones) = 'array' then k.transacciones else '[]'::jsonb end) e
                  where e ->> 'id' is not null) - v_liberadas;

  -- Las ventas quedan libres (ya no pertenecen a ningún cierre) y el cierre se queda, anulado, con sus ventas como estaban.
  delete from public.cierre_ordenes where cierre_id = p_cierre_id;
  perform set_config('resplandor.cierre_accion', 'anulado', true);
  perform set_config('resplandor.cierre_motivo', v_motivo, true);
  update public.cierres c1
     set anulado_en = now(), anulado_por = v_quien, anulado_motivo = v_motivo
   where c1.id = p_cierre_id
  returning * into k;

  return jsonb_build_object('ok', true, 'liberadas', v_liberadas, 'omitidas', v_omitidas, 'total', v_total,
                            'cierre', jsonb_build_object('id', k.id, 'anulado_en', k.anulado_en, 'anulado_por', k.anulado_por, 'anulado_motivo', k.anulado_motivo));
end;
$function$;

comment on function public.cierre_anular(text, text) is
  'Anula un cierre equivocado (solo admin, con motivo): el cierre se queda con su motivo y sus ventas vuelven a las ventas por cerrar. No borra nada; todo o nada. El cambio queda en cierres_cambios.';

revoke all on function public.cierre_anular(text, text) from public, anon, service_role;
grant execute on function public.cierre_anular(text, text) to authenticated;
