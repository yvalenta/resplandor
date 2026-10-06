-- ════════════════════════════════════════════════════════════
-- Resplandor — AJUSTES A LOS CIERRES POR DÍA (lo que dejó la refutación de 20261006100000: una venta «de mañana» y los cobros deshechos de un cierre anulado)
-- (tareas/2026-10-05-cierres-de-hoy-y-panel-admin.md; esta migración va ENCIMA de 20261006100000_cierres_de_hoy_y_cambios.sql, que no se toca)
--
-- QUÉ HACE
--   1. `public.cerrar_dia_de(p_id, p_dia, p_esperado)`, el mismo cuerpo de 20261006100000 con UN cambio: cuando `p_dia` es HOY en Bogotá toma también las
--      ventas cerradas y sin archivar cuyo día en Bogotá es POSTERIOR a hoy (`cerrada_en` «de mañana»: el reloj de una tablet adelantado cobró una mesa
--      al pasar la medianoche). Antes esa venta no entraba en ningún cierre: ni en el de hoy (era de mañana) ni en el de un día pasado, y el POS
--      tampoco la mostraba. Ahora cuenta como de HOY, el POS la suma en «Transacciones del turno» y lo que el admin firma ({n, total, ids}) es lo que
--      la base cierra. Un día pasado NO se lleva las de mañana, y un día futuro sigue siendo `invalido`. Todo lo demás (admin, candado, hay_abiertas
--      solo para hoy, `cambio`, la fecha del cierre, los rezagos, los deshechos hasta ese día) es igual.
--   2. `public.cierre_anular(p_cierre_id, p_motivo)`, el mismo cuerpo con UN cambio: los `deshechos` cuyo `cierre_id` es el cierre que se anula vuelven a
--      `cierre_id = null` (al turno abierto). Antes se quedaban colgados del cierre anulado y, al cerrar ese día otra vez, no pasaban al cierre nuevo.
--      Devuelve además `deshechos` (cuántos soltó). El rastro (`trg_cierres_rastro`) no cambia: anota la anulación con su motivo, quién y cuándo, igual.
--   Solo cambian dos funciones: ninguna tabla, columna, policy, permiso ni disparador. EXECUTE sigue siendo solo de `authenticated` y adentro `mi_rol() = 'admin'`.
--
-- QUIÉN LO VE Y QUIÉN LO CAMBIA
--   Nada cambia: el admin cierra y anula; el mesero recibe `no_autorizado`; el historial lo siguen viendo, en solo lectura, todos los del personal.
--
-- Necesita 20261006100000_cierres_de_hoy_y_cambios.sql (cerrar_dia_de, cierre_anular, cierres_cambios, cierres.anulado_en); si falta se niega a correr SIN cambiar
-- nada. Idempotente (create or replace de dos funciones y sus permisos).
--
-- REVERSA (menos de 1 minuto; no hay datos que borrar: los cobros deshechos que se soltaron al anular se vuelven a marcar solos con el siguiente cierre):
--   volver a correr las secciones 4 (`cerrar_dia_de`) y 6 (`cierre_anular`) de 20261006100000_cierres_de_hoy_y_cambios.sql, que son el create or replace
--   de las dos funciones tal como eran y dejan los mismos permisos.
-- Correr en Supabase → SQL Editor DESPUÉS de 20261006100000 (lo aplica Yonatan: aparca). Orden de salida al aire: 1) 20261006100000, 2) esta, 3) push del POS.
-- El POS nuevo sin esta migración sigue funcionando: solo que una venta «de mañana» no entra en el cierre de hoy hasta que se aplique (la base no la toma y el
-- cierre responde `cambio`: el admin ve los números de la base y firma otra vez).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regprocedure('public.cerrar_dia_de(text, date, jsonb)') is null
     or to_regprocedure('public.cierre_anular(text, text)') is null
     or to_regprocedure('public.cierre_corregir_nota(text, text)') is null
     or to_regclass('public.cierres_cambios') is null
     or to_regprocedure('privado.hoy_bogota()') is null
     or to_regprocedure('privado.fecha_bogota(timestamp with time zone)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cierres' and column_name = 'anulado_en') then
    raise exception 'Falta 20261006100000_cierres_de_hoy_y_cambios.sql (cerrar_dia_de, cierre_anular, cierres_cambios, cierres.anulado_en): aplicala primero. No se cambió nada.';
  end if;
  if to_regclass('public.deshechos') is null or to_regclass('public.cierre_ordenes') is null then
    raise exception 'Falta 20261002180000_deshacer_cobro.sql (deshechos, cierre_ordenes): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 4. cerrar_dia_de: hoy también se lleva las ventas «de mañana» ───────
-- (la numeración sigue la de 20261006100000, de la que esta función es el mismo cuerpo)
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

  -- Las ventas del día: las cerradas que no están en ningún cierre y son de `p_dia` en Bogotá, con candado y en orden. HOY también se lleva las
  -- de «mañana» (`cerrada_en` en un día futuro: el reloj de una tablet adelantado al pasar la medianoche): una venta cerrada nunca queda fuera de
  -- todo cierre, y lo que el POS cuenta como de hoy es lo que la base cierra. Un día pasado, no. Y las cerradas que ya estaban archivadas
  -- (rezagos de una purga que no terminó): no se cuentan y se borran al cerrar, como en cerrar_dia.
  perform 1 from public.ordenes where estado = 'cerrada' order by id for update;
  select coalesce(array_agg(o.id order by o.id) filter (where not exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id)
                                                          and (privado.fecha_bogota(coalesce(o.cerrada_en, o.abierta_en)) = p_dia
                                                               or (p_dia = v_hoy and privado.fecha_bogota(coalesce(o.cerrada_en, o.abierta_en)) > v_hoy))), '{}'::text[]),
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
  'El cierre de UN día (hoy o uno pasado sin cerrar), solo para el admin y en una transacción: toma las ventas cerradas sin archivar de ese día en Bogotá (hoy, también las de «mañana» por un reloj adelantado), rechaza si lo que el POS espera no es lo que hay (y, para hoy, si hay cuentas abiertas), guarda el cierre (con la fecha de ese día), borra lo que archiva y marca los deshechos hasta ese día. Las ventas de otros días no se tocan.';

revoke all on function public.cerrar_dia_de(text, date, jsonb) from public, anon, service_role;
grant execute on function public.cerrar_dia_de(text, date, jsonb) to authenticated;

-- ── 6. cierre_anular: los cobros deshechos del cierre anulado vuelven al turno ───────
-- Anular un cierre equivocado, sin borrar nada: el cierre se queda con su motivo, y sus ventas vuelven a las ventas por cerrar (`ordenes`
-- cerradas, ya sin cierre_ordenes) con sus ítems, su total y sus horas, para cerrarlas bien con cerrar_dia_de; y sus cobros deshechos vuelven al
-- turno. Devuelve {ok: true, liberadas, omitidas, total, deshechos, cierre: {id, anulado_en, anulado_por, anulado_motivo}} o {ok: false, codigo} con codigo =
--   no_autorizado | invalido | motivo_requerido (de 3 a 300 caracteres) | no_existe | ya_anulado | mesa_inexistente (con `mesas`). Todo o nada.

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
  v_deshechos integer := 0;
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
  -- Los cobros deshechos que este cierre se había llevado vuelven al turno (cierre_id null): el siguiente cerrar_dia_de los toma, y no quedan colgados
  -- de un cierre anulado. El rastro no cambia: el disparador de `cierres` anota lo mismo (la anulación, su motivo, quién y cuándo).
  update public.deshechos set cierre_id = null where cierre_id = p_cierre_id;
  get diagnostics v_deshechos = row_count;
  perform set_config('resplandor.cierre_accion', 'anulado', true);
  perform set_config('resplandor.cierre_motivo', v_motivo, true);
  update public.cierres c1
     set anulado_en = now(), anulado_por = v_quien, anulado_motivo = v_motivo
   where c1.id = p_cierre_id
  returning * into k;

  return jsonb_build_object('ok', true, 'liberadas', v_liberadas, 'omitidas', v_omitidas, 'total', v_total, 'deshechos', v_deshechos,
                            'cierre', jsonb_build_object('id', k.id, 'anulado_en', k.anulado_en, 'anulado_por', k.anulado_por, 'anulado_motivo', k.anulado_motivo));
end;
$function$;

comment on function public.cierre_anular(text, text) is
  'Anula un cierre equivocado (solo admin, con motivo): el cierre se queda con su motivo, sus ventas vuelven a las ventas por cerrar y sus cobros deshechos vuelven al turno. No borra nada; todo o nada. El cambio queda en cierres_cambios.';

revoke all on function public.cierre_anular(text, text) from public, anon, service_role;
grant execute on function public.cierre_anular(text, text) to authenticated;
