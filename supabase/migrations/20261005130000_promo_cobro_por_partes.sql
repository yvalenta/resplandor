-- ════════════════════════════════════════════════════════════
-- Resplandor — COBRAR POR PARTES una cuenta con promoción: la base lo rechaza (la promo se calcula sobre la cuenta ENTERA y no se parte)
-- (hallazgo ALTO de la refutación del 2026-10-05, antes de salir al aire; reproducido en Docker con un mesero de verdad —rol `authenticated`
-- con la RLS—; tareas/2026-10-04-hallazgos-domingo.md. Corrige lo que 20261005100000 deja abierto; esa migración NO se edita.)
--
-- QUÉ PASABA (medido en Docker con el catálogo real: Seco 19.000, Menú Resplandor 23.000, «3er almuerzo» del lunes)
--   El descuento lo recalcula `trg_ordenes_a_precio_vivo` sobre las unidades que HAY en la cuenta abierta en cada escritura. Cobrar por partes
--   (por ítems, por unidades o por persona: `facturarParcial` del POS) hace DOS cosas por separado: inserta una orden CERRADA con `parcial_de` = la cuenta
--   y, después, saca esas unidades de la abierta con UN `aplicar_delta_orden` (−qty) por línea. Cada delta es una escritura, y después de cada una
--   la base vuelve a calcular las promos con lo que queda. Lo cobrado ya no cuenta para nada, y la línea de promo (id `promo:<promo>:<base>`)
--   puede desaparecer entre un delta y el siguiente. Resultado, con cuentas del lunes y el POS haciendo exactamente lo que hace:
--     · 3 Seco juntos: 53.200. El primer comensal paga UN Seco de la línea base (19.000): la abierta se queda con 2 Seco, la promo se pliega
--       (2 unidades no son un trío) y el segundo y el tercero pagan 38.000: 57.000 en total (el cliente paga 3.800 de más).
--     · 5 Seco juntos: 91.200 (un descuento). Cada comensal paga «su» Seco tocando la línea de promo mientras siga apareciendo: la base la
--       vuelve a crear sobre lo que queda, tres veces: 3 × 15.200 + 2 × 19.000 = 83.600 (el restaurante pierde 7.600 en una mesa). Pagando siempre
--       la línea base, nunca hay descuento: 95.000 (el cliente paga 3.800 de más).
--     · 2 Menú + 1 Seco por persona, el Menú primero: 23.000 + 23.000 + 19.000 = 65.000 en vez de 61.200.
--     · Peor: 3 Seco, se cobran las DOS líneas del grupo en una sola parte (Seco ×2 y «Seco · 3er almuerzo» ×1, 53.200): el primer delta (−2 Seco) deja la promo
--       sola, la base la pliega a un Seco de 19.000 y el segundo delta (−1 sobre la línea de promo) ya no encuentra su línea y NO hace nada: la venta queda
--       cobrada y en la cuenta abierta sigue un Seco de 19.000 que ya se pagó. Esto último no depende de cuánto «recuerde» la base: es el protocolo
--       (fila cerrada primero, deltas uno a uno, cada uno normaliza).
--
-- POR QUÉ NO «RECORDAR LO YA COBRADO» (opción a) Y SÍ BLOQUEAR (opción b)
--   La alternativa (a) era que `normalizar_items` reciba también lo ya cobrado de esa mesa (las órdenes cerradas con `parcial_de` = esta) y cuente esas
--   unidades al armar los grupos de N. Se PROBÓ en Docker (un prototipo, que no se incluye): con UNA línea por cobro arregla el 57.000 (queda 53.200), el 83.600
--   y el 95.000 (91.200 los dos) y el 65.000 (61.200); pero NO el caso de varias líneas (cobrar el grupo entero deja el Seco de 19.000 en la cuenta) y en 30
--   secuencias al azar de agregar, quitar y cobrar por partes, 20 dejaron unidades a la vez cobradas y todavía en la cuenta (cobradas dos veces). Por qué: entre el
--   insert de la cerrada y el último delta hay escrituras intermedias en las que las unidades están a la vez en la cerrada y en la abierta (se cuentan dos veces), la
--   línea de promo se pliega o se rehace, y el delta que sigue apunta a un id que ya no existe. Cerrarlo de verdad exige otro protocolo (un solo RPC
--   atómico que inserte la cerrada, saque las unidades y normalice una vez); eso es un cambio del POS y de la base juntos, con un POS viejo todavía
--   en las tablets, y no es esto. La regla más simple que es correcta y se puede verificar: UNA CUENTA CON PROMOCIÓN NO SE PARTE. Se cobra completa
--   (el descuento sale como lo calcula la base, 91.200 / 61.200 / 53.200 como arriba) o se reparte con ABONOS (cobro por monto: no saca unidades de la
--   cuenta, solo baja lo que se debe, así que la suma cobrada no depende de cómo se reparta).
--
-- QUÉ HACE
--   1. `public.ordenes_guardia_promo()` + el trigger `trg_ordenes_guardia_promo` (BEFORE INSERT, por fila): una orden CERRADA nueva con `parcial_de` que
--      se lleva líneas de PRODUCTO se RECHAZA cuando
--        · la cuenta abierta de la que sale tiene alguna línea de promo (id `promo:…`), o
--        · la propia orden cerrada trae una línea de promo (el POS la marcó a partir de una foto vieja de la cuenta).
--      El error es SQLSTATE RS005 y su mensaje dice «promoción» y «por partes». Es A PROPÓSITO el mismo código que ya usa el cobro por partes de una cuenta
--      archivada en un cierre: el POS publicado (43d1926) lo reconoce como «el cobro por partes NO quedó registrado» y devuelve lo marcado a la
--      cuenta (`_cobroParcialRechazado`). Un código nuevo lo dejaría como un fallo desconocido: la fila cerrada reintentándose para siempre
--      mientras las unidades YA salieron de la cuenta (cobrado y sin registrar). El POS nuevo distingue el motivo por la palabra «promoción» y avisa
--      con sus palabras; además ya no ofrece cobrar por partes en una cuenta con promoción (la guardia de la base es el respaldo de una tablet atrasada).
--      NO se frena: los abonos (su única línea es `abono_<uid>`), un cobro por partes de una cuenta SIN promoción (como hasta hoy), el cobro de la
--      mesa completa (es un UPDATE, no un INSERT), deshacer un cobro, ni nada que no venga de la API (el dueño, el SQL Editor, service_role y las
--      funciones SECURITY DEFINER no son `anon`/`authenticated`, igual que `ordenes_guardia`). Un reintento del upsert de un cobro que YA está en la
--      base tampoco se vuelve a juzgar (si no, un cobro registrado se «rechazaría» después y el POS devolvería a la cuenta lo que ya estaba cobrado).
--   2. `privado.normalizar_items` (misma firma; `create or replace`): una línea con id `promo:<promo>:<base>` que llega SIN el objeto `promo` (la
--      deja así el camino de devolución del POS publicado: `aplicar_delta_orden` solo recibe id, nombre, precio y nota) ya no queda como una línea
--      suelta que cuenta como producto y se suma al descuento nuevo: se pliega en su línea base igual que una con objeto (la base se saca del id). Medido
--      antes: devolver una línea de promo y agregar un Seco dejaba 2 × 19.000 + la promo calculada + la línea suelta = 68.400 en vez de 72.200. Todo lo
--      demás del cuerpo es el de 20261005100000, tal cual.
--   La regla que de verdad vale: lo que paga una mesa con promoción no depende de cómo se parta, porque no se parte. Lo que se cobró aparte ANTES de
--   que hubiera promo en la cuenta (dos amigos que pagaron su Seco y se fueron) no cuenta para un trío que se arme después: la promo se calcula sobre lo
--   que hay en la cuenta abierta. Y nunca hay más descuentos que tríos (o parejas…) completos de unidades en la cuenta abierta.
--
-- NO cambia ninguna policy, tabla ni dato, ni la regla de elegibilidad. Tampoco cierra que una unidad pueda calificar para DOS promos del mismo día (cada
-- promo se calcula sobre lo que le queda tras las anteriores; una unidad que sirvió de «pagadora» en un trío puede entrar de pareja en otra): ninguna unidad
-- recibe dos descuentos, pero puede contar para dos grupos. Hoy no hay dos reglas el mismo día; si Yonatan crea una, hay que decidir qué significa «se combinan».
-- Idempotente (create or replace, drop trigger if exists). Necesita 20261005100000 (con privado.dia_promo: la versión de 312eb93, en la que el día de la promo es el de la ESCRITURA y no
-- el de `abierta_en`) y 20261002180000: si falta algo, se niega a correr SIN cambiar nada. Esta migración no juzga ningún día (la guardia mira si la cuenta YA trae líneas de promo y
-- `normalizar_items` recibe el día de quien lo llama); pide `dia_promo` para que ni ella ni 20261005140000 se apliquen sobre un trigger que todavía juzgue con `abierta_en`.
--
-- ORDEN: pegar el sobre de las REGLAS (las que hacen que existan líneas de promo) DESPUÉS de que las tablets hayan recargado el POS con este cambio.
--
-- REVERSA (menos de 1 minuto; las cuentas no cambian):
--   begin;
--   drop trigger if exists trg_ordenes_guardia_promo on public.ordenes;
--   drop function if exists public.ordenes_guardia_promo();
--   commit;
--   -- y normalizar_items vuelve a la de 20261005100000: pegar otra vez ESA migración (es create or replace) y, detrás, 20261005120000 (la de precio vivo vuelve a quitar
--   -- el permiso de promo_regla_ok y sin él el POS no puede escribir productos).
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Va después de 20261005120000.
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regprocedure('privado.normalizar_items(jsonb,smallint)') is null then
    raise exception 'Falta 20261005100000_precio_vivo_y_promos.sql (privado.normalizar_items): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('privado.dia_promo()') is null then
    raise exception 'Falta privado.dia_promo (el día de la promo es el de la escritura): vuelve a aplicar 20261005100000_precio_vivo_y_promos.sql, la versión de 312eb93. No se cambió nada.';
  end if;
  if to_regprocedure('public.ordenes_guardia()') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ordenes' and column_name = 'parcial_de') then
    raise exception 'Falta 20261002180000_deshacer_cobro.sql (ordenes.parcial_de y su guardia): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. La guardia: una cuenta con promoción no se cobra por partes ──

-- SECURITY INVOKER a propósito (como `ordenes_guardia`): `current_user` dice quién llama, y solo la API (`anon`, `authenticated`) se frena. Lee la
-- cuenta abierta con la RLS de quien llama (la misma lectura que ya hace `ordenes_guardia` para su RS005); no llama a ninguna función de `privado`,
-- así que no necesita ningún EXECUTE (lección de 20261005120000).
create or replace function public.ordenes_guardia_promo()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
declare
  v_items jsonb := case when jsonb_typeof(new.items) = 'array' then new.items else '[]'::jsonb end;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.estado is distinct from 'cerrada' or new.parcial_de is null then
    return new;
  end if;
  -- Un reintento del upsert de un cobro que la base YA tiene no se vuelve a juzgar.
  if exists (select 1 from public.ordenes o where o.id = new.id) then
    return new;
  end if;
  -- Solo si el cobro se lleva líneas de PRODUCTO: un abono (`abono_<uid>`) y el marcador «para llevar» (`para_llevar`, $0) no sacan unidades de la cuenta.
  if not exists (select 1 from jsonb_array_elements(v_items) e
                  where (e ->> 'id') is not null and (e ->> 'id') <> 'para_llevar' and (e ->> 'id') not like 'abono\_%'
                    and case when (e ->> 'qty') ~ '^[0-9]+$' then (e ->> 'qty')::int else 0 end > 0) then
    return new;
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e where (e ->> 'id') like 'promo:%')
     or exists (select 1 from public.ordenes o
                 where o.id = new.parcial_de and o.estado = 'abierta' and jsonb_typeof(o.items) = 'array'
                   and exists (select 1 from jsonb_array_elements(o.items) x where (x ->> 'id') like 'promo:%')) then
    raise exception 'la cuenta % tiene una promoción: el descuento se calcula con toda la cuenta junta, así que no se puede cobrar por partes ni por persona', new.parcial_de
      using errcode = 'RS005',
            hint = 'Cobra la mesa completa, o recibe un abono por cada quien (cobro por monto). Un cobro por partes saca unidades de la cuenta y el descuento se recalcula sobre lo que queda.';
  end if;
  return new;
end;
$function$;

comment on function public.ordenes_guardia_promo() is
  'Guardia de INSERT en ordenes: rechaza (RS005) cobrar por partes, por unidades o por persona una cuenta abierta que tiene líneas de promo (promo:…). No frena abonos, cuentas sin promo, el cobro completo ni nada que no venga de la API.';

revoke all on function public.ordenes_guardia_promo() from public, anon, authenticated;

drop trigger if exists trg_ordenes_guardia_promo on public.ordenes;
create trigger trg_ordenes_guardia_promo
  before insert on public.ordenes
  for each row
  execute function public.ordenes_guardia_promo();

-- ── 2. normalizar_items: una línea de promo sin su objeto también se pliega ──

create or replace function privado.normalizar_items(p_items jsonb, p_dia smallint)
  returns jsonb
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  v_lineas jsonb[] := '{}';
  v_extras jsonb := '{}'::jsonb;        -- { "<índice de la base>": [líneas de promo] }
  v_item jsonb;
  v_de text;
  v_pid text;
  v_i int;
  v_n int;
  v_found boolean;
  v_precio numeric;
  v_promo record;
  v_cada int;
  v_desc int;
  v_cats text[];
  v_prods text[];
  v_idx int[];
  v_cant int[];
  v_base jsonb;
  v_nombre text;
  v_linea jsonb;
  v_salida jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return coalesce(p_items, '[]'::jsonb);
  end if;

  -- a. Las líneas que no son de promo, en su orden. Es de promo toda línea con id `promo:<promo>:<base>`: con el objeto `promo` (lo que escribe esta
  --    función) o sin él (lo que deja un POS que devuelve una línea de promo a la cuenta con aplicar_delta_orden, que no lleva ese objeto).
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_de := case when jsonb_typeof(v_item -> 'promo') = 'object' then v_item -> 'promo' ->> 'de'
                 else substring(coalesce(v_item ->> 'id', '') from '^promo:[^:]*:(.+)$') end;
    if (v_item ->> 'id') like 'promo:%' and (jsonb_typeof(v_item -> 'promo') = 'object' or v_de is not null) then continue; end if;
    v_lineas := v_lineas || v_item;
  end loop;

  -- a'. Las líneas de promo de una pasada anterior vuelven a su base (la base recibe las unidades; si la base ya no está, se recrea).
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_de := case when jsonb_typeof(v_item -> 'promo') = 'object' then v_item -> 'promo' ->> 'de'
                 else substring(coalesce(v_item ->> 'id', '') from '^promo:[^:]*:(.+)$') end;
    if not ((v_item ->> 'id') like 'promo:%' and (jsonb_typeof(v_item -> 'promo') = 'object' or v_de is not null)) then continue; end if;
    v_n := coalesce(nullif(v_item ->> 'qty', '')::int, 0);
    if v_de is null or v_n <= 0 then continue; end if;
    v_found := false;
    for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop
      if v_lineas[v_i] ->> 'id' = v_de then
        v_lineas[v_i] := jsonb_set(v_lineas[v_i], '{qty}', to_jsonb(coalesce(nullif(v_lineas[v_i] ->> 'qty', '')::int, 0) + v_n));
        v_found := true;
        exit;
      end if;
    end loop;
    if not v_found then
      v_lineas := v_lineas || jsonb_build_object(
        'id', v_de,
        'nombre', coalesce(v_item -> 'promo' ->> 'nombre',
                           (select p.nombre from public.productos p where p.id = split_part(v_de, '__', 1)),
                           v_item ->> 'nombre'),
        'precio', coalesce(nullif(v_item -> 'promo' ->> 'precio', '')::numeric,
                           (select p.precio from public.productos p where p.id = split_part(v_de, '__', 1)),
                           nullif(v_item ->> 'precio', '')::numeric, 0),
        'qty', v_n,
        'nota', coalesce(v_item ->> 'nota', ''));
    end if;
  end loop;

  -- b. El precio de hoy, desde `productos`. Solo líneas de producto con precio ≥ 0: ni manuales, ni abonos, ni el marcador «para llevar».
  for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop
    v_item := v_lineas[v_i];
    v_pid := v_item ->> 'id';
    if v_pid is null or v_pid = 'para_llevar' or v_pid like 'manual\_%' or v_pid like 'abono\_%' then continue; end if;
    if coalesce(nullif(v_item ->> 'precio', '')::numeric, 0) < 0 then continue; end if;
    v_pid := split_part(v_pid, '__', 1);
    select p.precio into v_precio from public.productos p where p.id = v_pid and p.precio is not null and p.precio >= 0;
    if found and v_precio is distinct from nullif(v_item ->> 'precio', '')::numeric then
      v_lineas[v_i] := jsonb_set(v_item, '{precio}', to_jsonb(v_precio));
    end if;
  end loop;

  -- c. Las promociones del día, por nombre (y por id si dos se llaman igual).
  if p_dia is not null then
    for v_promo in
      select p.id, p.nombre, p.etiqueta, p.promo_regla as regla
        from public.productos p
       where p.activo and p.promo_regla is not null
         and (p.dia_semana is null or p.dia_semana = p_dia)
       order by p.nombre, p.id
    loop
      v_cada := (v_promo.regla ->> 'cada')::int;
      v_desc := (v_promo.regla ->> 'descuento')::int;
      v_cats := array(select jsonb_array_elements_text(coalesce(v_promo.regla -> 'aplica' -> 'categorias', '[]'::jsonb)));
      v_prods := array(select jsonb_array_elements_text(coalesce(v_promo.regla -> 'aplica' -> 'productos', '[]'::jsonb)));

      -- Las unidades elegibles, de mayor a menor precio (y en el orden de la cuenta a igual precio); la N-ésima, 2N-ésima… lleva el
      -- descuento. Se cuentan por línea base.
      with l as (
        select t.i, t.x from unnest(v_lineas) with ordinality as t(x, i)
      ), e as (
        select l.i,
               coalesce(nullif(l.x ->> 'precio', '')::numeric, 0) as precio,
               coalesce(nullif(l.x ->> 'qty', '')::int, 0) as qty,
               split_part(l.x ->> 'id', '__', 1) as pid
          from l
         where (l.x ->> 'id') is not null
           and (l.x ->> 'id') <> 'para_llevar'
           and (l.x ->> 'id') not like 'manual\_%'
           and (l.x ->> 'id') not like 'abono\_%'
           and (l.x ->> 'id') not like 'promo:%'
      ), q as (
        select e.i, e.precio, e.qty
          from e
          join public.productos pr on pr.id = e.pid
         where e.precio > 0 and e.qty > 0
           and pr.promo_regla is null
           and (pr.categoria = any (v_cats) or pr.id = any (v_prods))
      ), u as (
        select q.i, row_number() over (order by q.precio desc, q.i) as rn
          from q, generate_series(1, q.qty) as g
      ), d as (
        select u.i, count(*)::int as n from u where u.rn % v_cada = 0 group by u.i
      )
      select coalesce(array_agg(d.i order by d.i), '{}'), coalesce(array_agg(d.n order by d.i), '{}')
        into v_idx, v_cant
        from d;

      for v_i in 1 .. coalesce(array_length(v_idx, 1), 0) loop
        v_base := v_lineas[v_idx[v_i]];
        v_n := v_cant[v_i];
        v_precio := round(coalesce(nullif(v_base ->> 'precio', '')::numeric, 0) * (100 - v_desc) / 100.0);
        v_nombre := coalesce(v_base ->> 'nombre', '') || ' · ' || v_promo.nombre
                    || case when coalesce(v_promo.etiqueta, '') <> '' then ' · ' || v_promo.etiqueta else '' end;
        v_linea := jsonb_build_object(
          'id', 'promo:' || v_promo.id || ':' || (v_base ->> 'id'),
          'nombre', v_nombre,
          'precio', v_precio,
          'qty', v_n,
          'nota', coalesce(v_base ->> 'nota', ''),
          'promo', jsonb_build_object(
            'id', v_promo.id, 'de', v_base ->> 'id', 'nombre', v_base ->> 'nombre',
            'precio', coalesce(nullif(v_base ->> 'precio', '')::numeric, 0), 'descuento', v_desc));
        v_lineas[v_idx[v_i]] := jsonb_set(v_base, '{qty}', to_jsonb(coalesce(nullif(v_base ->> 'qty', '')::int, 0) - v_n));
        v_extras := jsonb_set(v_extras, array[v_idx[v_i]::text],
                              coalesce(v_extras -> (v_idx[v_i]::text), '[]'::jsonb) || jsonb_build_array(v_linea));
      end loop;
    end loop;
  end if;

  -- d. La salida: cada línea base (si le quedan unidades) seguida de sus líneas de promo.
  for v_i in 1 .. coalesce(array_length(v_lineas, 1), 0) loop
    if coalesce(nullif(v_lineas[v_i] ->> 'qty', '')::int, 0) > 0 then
      v_salida := v_salida || jsonb_build_array(v_lineas[v_i]);
    end if;
    if v_extras ? (v_i::text) then
      v_salida := v_salida || (v_extras -> (v_i::text));
    end if;
  end loop;
  return v_salida;
end $$;

revoke all on function privado.normalizar_items(jsonb, smallint) from public, anon, authenticated;

-- ── 3. Comprobación ─────────────────────────────────────────

do $$
declare
  v jsonb;
begin
  -- La guardia: el trigger está, es BEFORE INSERT por fila, y la API no puede ejecutar su función (la dispara el trigger, no ella).
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.ordenes'::regclass and t.tgname = 'trg_ordenes_guardia_promo' and not t.tgisinternal
                    and t.tgtype = 7 and t.tgenabled = 'O' and t.tgfoid = to_regprocedure('public.ordenes_guardia_promo()')::oid) then
    raise exception 'trg_ordenes_guardia_promo no quedó como BEFORE INSERT por fila, encendido';
  end if;
  if has_function_privilege('anon', 'public.ordenes_guardia_promo()', 'execute') or has_function_privilege('authenticated', 'public.ordenes_guardia_promo()', 'execute') then
    raise exception 'anon o authenticated pueden ejecutar public.ordenes_guardia_promo directamente: no tenían que poder';
  end if;
  -- normalizar_items: una línea de promo SIN su objeto se pliega en su base (y con el objeto también); una línea manual no se toca.
  v := privado.normalizar_items('[{"id":"zz-x","nombre":"X","precio":1000,"qty":1,"nota":""},{"id":"promo:zz-p:zz-x","nombre":"X · promo","precio":800,"qty":2,"nota":""}]'::jsonb, 1::smallint);
  if v <> '[{"id":"zz-x","nombre":"X","precio":1000,"qty":3,"nota":""}]'::jsonb then
    raise exception 'privado.normalizar_items no pliega una línea de promo sin objeto: %', v;
  end if;
  v := privado.normalizar_items('[{"id":"zz-x","nombre":"X","precio":1000,"qty":1,"nota":""},{"id":"promo:zz-p:zz-x","nombre":"X · promo","precio":800,"qty":2,"nota":"","promo":{"id":"zz-p","de":"zz-x","nombre":"X","precio":1000,"descuento":20}}]'::jsonb, 1::smallint);
  if v <> '[{"id":"zz-x","nombre":"X","precio":1000,"qty":3,"nota":""}]'::jsonb then
    raise exception 'privado.normalizar_items dejó de plegar una línea de promo con objeto: %', v;
  end if;
  v := privado.normalizar_items('[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb, 1::smallint);
  if v <> '[{"id":"manual_1","nombre":"X","precio":1000,"qty":2,"nota":""}]'::jsonb then
    raise exception 'privado.normalizar_items cambió una línea manual: %', v;
  end if;
  if has_function_privilege('anon', 'privado.normalizar_items(jsonb,smallint)', 'execute') or has_function_privilege('authenticated', 'privado.normalizar_items(jsonb,smallint)', 'execute') then
    raise exception 'anon o authenticated pueden ejecutar privado.normalizar_items: no tenían que poder';
  end if;
end $$;
