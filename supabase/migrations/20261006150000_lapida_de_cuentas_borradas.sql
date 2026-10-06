-- ════════════════════════════════════════════════════════════
-- Resplandor — LA LÁPIDA DE LAS CUENTAS BORRADAS: la API no INSERTA (cerrada ni abierta) una cuenta que la base borró CON ÍTEMS (RS007)
-- (hallazgo ALTO de la séptima refutación, 2026-10-06; ya estaba en producción con main 6c5c4a4; tareas/2026-10-04-hallazgos-domingo.md.
--  Corrige lo que 20261002180000 deja abierto; esa migración NO se edita. Corregida en el sitio por la octava refutación: R1 y R3, más abajo.)
--
-- QUÉ PASABA (reproducido en Chromium con supabase-js real y Postgres 17 con la RLS de un mesero y dos tablets: X1, X2 y X3 del refutador)
--   Las tablets A y B abren la misma mesa (62.000). A cobra TODA la cuenta por partes (la cuenta queda vacía) y toca «Liberar mesa»: la fila de la cuenta
--   se BORRA. B no se enteró (sin Realtime, o un evento que no llegó) y toca «Generar ticket y cobrar» → «Sí, cobrar»: el POS cierra con su copia vieja.
--   El `upsert` de la fila cerrada no encuentra el id y la INSERTA como una venta nueva: la base registra 62.000 (la de A) + 62.000 (la de B) = 124.000 por
--   una mesa de 62.000. Lo mismo, sin cobro, cuando A anula el pedido (quita todos los ítems) y libera: una venta FANTASMA de 62.000 de una cuenta que ya no
--   existía. Y sin red pasa igual: B cierra con el Wi-Fi apagado (PROVISIONAL), A cobra y libera, y al volver la red de B la fila cerrada sube y se inserta.
--   La guardia RS003 (`ordenes_guardia`) solo juzga el UPDATE abierta→cerrada: una fila que no existe no tiene versión que comparar, y la rama INSERT de esa
--   guardia solo mira los cierres archivados (RS005). Hay otra variante que no necesita una cuenta vacía: «Deshacer» el cobro completo de una mesa que ya tiene
--   OTRA cuenta abierta pasa los ítems a ésa y BORRA la cerrada; una tablet con la copia vieja la volvería a insertar igual.
--   Y una tercera, la de una cuenta ABIERTA (octava refutación, R1): B abre la mesa sin red, pide 62.000 y vuelve la red un instante (el esqueleto y los cambios entran, la subida de
--   la fila completa se corta); A cobra todo por partes y libera; al volver la red de B su cuenta abierta, con los ítems viejos, se SUBE de nuevo (resucita en la base) y se cobra
--   otra vez: 124.000 por 62.000. Una cuenta abierta que resucita es lo mismo que una venta que se inserta: otra tablet ya decidió sobre esos ítems.
--
-- QUÉ HACE (la base manda; el POS, además, ya no cobra con una copia de una cuenta que la base no tiene: pos.html, `_leerCuentaParaCobrar`)
--   1. `privado.ordenes_borradas (id, borrada_en, tenia_items)`: la LÁPIDA, los ids de las cuentas que la base borró y si TENÍAN ÍTEMS (la frontera, más abajo). Tabla PRIVADA (esquema `privado`,
--      fuera de PostgREST; RLS encendida y sin policies; ningún permiso para anon, authenticated ni service_role). Solo id, hora y un sí/no: ningún dato de la cuenta.
--   2. `trg_ordenes_anotar_borrada` (AFTER DELETE en ordenes, por fila): cada borrado anota el id, la hora y si la cuenta tenía ítems (o renueva todo si el id ya estaba). Cubre TODO borrado:
--      «Liberar mesa» (la cuenta vacía), el cobro por partes que la vació y se liberó, la anulación, `deshacer_cobro` (el cobro completo que pasa a otra cuenta y el parcial que vuelve a su
--      cuenta borran la fila cerrada) y la purga del cierre del día. Un borrado que un guardia descarta (la cuenta con ítems, la venta que ningún cierre archivó) no es un borrado: no anota nada.
--   3. `trg_ordenes_olvidar_borrada` (AFTER INSERT en ordenes, por fila): si la cuenta VUELVE a existir por una FUNCIÓN DE LA BASE (`deshacer_cobro` reabre una venta, `reabrir_venta_de_cierre` la
--      inserta con su id) o la mete el dueño, el id sale de la lápida: la lápida solo guarda ids que hoy NO existen. Por eso reabrir una venta y cobrarla otra vez sigue funcionando.
--      NUNCA la olvida lo que viene de la API: antes (octava refutación, R1) una cuenta abierta que una tablet volvía a subir salía de la lápida y luego se cobraba dos veces. La detección es la de las
--      guardias de antes: SECURITY INVOKER y `current_user` (las funciones SECURITY DEFINER, el dueño y service_role no son 'anon' ni 'authenticated'); borra por un ayudante `privado.orden_olvidar`.
--   4. `trg_ordenes_guardia_lapida` (BEFORE INSERT, por fila; solo la API, igual que `ordenes_guardia`): una fila CON EL ID de una cuenta de la lápida que TENÍA ÍTEMS se RECHAZA con SQLSTATE RS007
--      («esa cuenta ya no existe: la cobró o la liberó otra tablet»), sea CERRADA (una venta que no existe) o ABIERTA (una cuenta que resucita: octava refutación, R1). No frena: lo que no viene de la
--      API (el dueño, el SQL Editor, service_role y las funciones SECURITY DEFINER —`deshacer_cobro`, `cobrar_parcial`, `cobrar_abono`, `reabrir_venta_de_cierre`, `cerrar_dia`—), un UPDATE (la fila existe:
--      lo juzga RS003), una cuenta que NUNCA estuvo en la base (una cuenta abierta y cobrada sin red que jamás subió: su id no está en la lápida y su venta entra como siempre) ni una cuenta que estaba
--      VACÍA Y SIN HISTORIA cuando se borró (la frontera, abajo). El orden de los guardias es el del nombre: `trg_ordenes_guardia` (RS005: archivada) va antes y gana.
--   5. `trg_cierres_purga_lapida` (AFTER INSERT en cierres, por sentencia, como `purgar_deshechos_viejos`): al guardar el cierre del día se borran las anotaciones de más de 7 días (ninguna
--      tablet tarda tanto en traer una venta; la lápida no crece sin límite).
--
-- LA FRONTERA: ¿«tenía ítems»? (octava refutación, R3: la regla de antes rechazaba también una venta REAL y única)
--   La anotación dice `tenia_items` = la cuenta, cuando se borró, tenía ítems, o tenía historia de ítems, o era una venta cerrada:
--     ítems no vacíos, o `version` > 0 (cada cambio de los ítems la sube: un cobro por partes que la vació, una anulación y un `deshacer_cobro` la dejan en ≥ 1 aunque queden 0 ítems),
--     o `estado = 'cerrada'` (lo que borran `deshacer_cobro` y la purga del cierre).
--   · SÍ tenía (verdadero): otra tablet decidió sobre esos ítems (los cobró, los anuló o los pasó a otra cuenta). Ninguna fila con ese id entra por la API, abierta ni cerrada: la tablet que lo intenta
--     recibe RS007, descarta su copia y le dice al mesero qué ítems tenía sin subir (pos.html, `_cuentaBorrada`) para que decida: abrir una cuenta nueva con ellos o dejarlos.
--   · NO tenía (falso: la cuenta nació y se liberó vacía, `version` 0 y sin ítems: nadie pidió nada en la base; lo que borró la otra tablet no movía plata): lo que una tablet que atendió esa mesa SIN red
--     suba después (su cuenta abierta con lo que pidió, o su venta cerrada) es una venta real y única, y ENTRA como siempre (la reproducción de R3: 49.000 que se perdían). Esa entrada no la avisa nadie;
--     en la base queda la venta, una sola vez.
--   Lo que esta frontera NO distingue (dicho): una cuenta que tuvo ítems en la base, se vació y se liberó, y una tablet que la atendió sin red tiene OTROS ítems que nunca llegaron. Esa venta sí es real y
--   se rechaza igual (la base no sabe qué ítems nunca llegaron): el POS descarta la copia y enseña al mesero los ítems sin subir. Se prefiere perder una venta que se puede volver a tomar a cobrar dos veces.
--
-- Qué NO cierra (dicho): una petición cuyo INSERT empiece en el mismo instante en que otra transacción borra la cuenta (la guardia mira lo ya confirmado: la ventana es de milisegundos);
-- la anotación de más de 7 días (una tablet que pasó una semana sin red y vuelve con una cuenta o una venta de una cuenta borrada la inserta); el cobro por partes del POS de antes (el publicado
-- hoy: inserta una fila cerrada NUEVA con `parcial_de` = una cuenta que ya no existe: el POS nuevo cobra por la RPC, que no encuentra la cuenta). Y lo que un service_role insertara a mano en `ordenes`
-- (no lo hace nada en este proyecto): su AFTER INSERT llamaría a `privado.orden_olvidar` sin permiso y fallaría en voz alta, no en silencio.
-- NO cambia ninguna policy, tabla pública ni dato, ni los otros guardias de ordenes.
-- Idempotente (create … if not exists, create or replace, drop trigger if exists). Necesita 20261002180000 (ordenes_guardia y su RS003/RS005): si falta, se niega a correr SIN cambiar nada.
-- Toma por un instante el candado de ordenes (create trigger ×3): pégala en un momento sin cobros.
--
-- ORDEN: va con el sobre final (pieza 4), DESPUÉS de que todas las tablets recarguen el POS nuevo: el POS publicado hoy no conoce RS007 (lo trataría como un fallo desconocido y reintentaría).
--
-- REVERSA (menos de 1 minuto; no toca cuentas ni ventas; borra la lápida):
--   begin;
--   drop trigger if exists trg_ordenes_guardia_lapida on public.ordenes;
--   drop trigger if exists trg_ordenes_anotar_borrada on public.ordenes;
--   drop trigger if exists trg_ordenes_olvidar_borrada on public.ordenes;
--   drop trigger if exists trg_cierres_purga_lapida on public.cierres;
--   drop function if exists public.ordenes_guardia_lapida();
--   drop function if exists privado.ordenes_anotar_borrada();
--   drop function if exists privado.ordenes_olvidar_borrada();
--   drop function if exists privado.orden_olvidar(text);
--   drop function if exists privado.ordenes_borradas_purgar();
--   drop function if exists privado.orden_borrada_con_items(text);
--   drop table if exists privado.ordenes_borradas;
--   commit;
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Va después de 20261006140000.
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ────────────────────────────────────────────

do $$
begin
  if to_regprocedure('public.ordenes_guardia()') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ordenes' and column_name = 'parcial_de') then
    raise exception 'Falta 20261002180000_deshacer_cobro.sql (ordenes_guardia y ordenes.parcial_de): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.cierres_registrar_ordenes()') is null then
    raise exception 'Falta 20261002180000_deshacer_cobro.sql (cierres_registrar_ordenes): aplicala primero. No se cambió nada.';
  end if;
end $$;

create schema if not exists privado;
grant usage on schema privado to authenticated;

-- ── 1. La lápida ────────────────────────────────────────────

-- `tenia_items` por defecto TRUE (lo prudente: una anotación escrita a mano, sin decir nada, frena). Lo escribe `trg_ordenes_anotar_borrada` en cada borrado.
create table if not exists privado.ordenes_borradas (
  id text not null,
  borrada_en timestamp with time zone not null default now(),
  tenia_items boolean not null default true,
  constraint ordenes_borradas_pkey primary key (id)
);

create index if not exists ordenes_borradas_borrada_en on privado.ordenes_borradas using btree (borrada_en);

comment on table privado.ordenes_borradas is
  'La lápida: los ids de las cuentas (public.ordenes) que la base borró y que hoy no existen (liberar una mesa, deshacer un cobro que pasó a otra cuenta, la purga del cierre del día), y si TENÍAN ítems (ítems, version > 0 o una venta cerrada). Una fila con uno de estos ids que tenía ítems —abierta o cerrada— la rechaza trg_ordenes_guardia_lapida (RS007): otra tablet decidió sobre esos ítems. Una cuenta que se borró vacía y sin historia deja pasar la venta de una tablet que la atendió sin red. Solo id, hora y ese sí/no; se vacía de lo de más de 7 días al guardar el cierre del día.';
comment on column privado.ordenes_borradas.tenia_items is
  'La cuenta tenía ítems cuando se borró, o historia de ítems (version > 0), o era una venta cerrada: otra tablet decidió sobre ellos. Falso = nació y se liberó vacía.';

alter table privado.ordenes_borradas enable row level security;
revoke all on table privado.ordenes_borradas from public, anon, authenticated, service_role;

-- ── 2. Cada borrado anota su id (y si la cuenta tenía ítems) ──

-- SECURITY DEFINER: quien borra por la API (un mesero liberando una mesa) no tiene permiso sobre `privado.ordenes_borradas`, y no debe ganarlo.
-- «Tenía ítems»: ítems no vacíos, `version` > 0 (cada cambio de los ítems la sube: aunque el cobro por partes o la anulación la dejaran en 0 ítems) o una venta cerrada.
create or replace function privado.ordenes_anotar_borrada()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  insert into privado.ordenes_borradas (id, borrada_en, tenia_items)
  values (old.id, now(),
          coalesce(old.estado, '') = 'cerrada'
          or coalesce(old.version, 0) > 0
          or (jsonb_typeof(old.items) = 'array' and jsonb_array_length(old.items) > 0))
  on conflict (id) do update set borrada_en = excluded.borrada_en, tenia_items = excluded.tenia_items;
  return null;
end;
$function$;

revoke all on function privado.ordenes_anotar_borrada() from public, anon, authenticated;

drop trigger if exists trg_ordenes_anotar_borrada on public.ordenes;
create trigger trg_ordenes_anotar_borrada
  after delete on public.ordenes
  for each row
  execute function privado.ordenes_anotar_borrada();

-- ── 3. Una cuenta que vuelve a existir POR LA BASE sale de la lápida ──

-- El ayudante que borra la anotación: SECURITY DEFINER (la tabla es privada). Nadie de la API lo ejecuta.
create or replace function privado.orden_olvidar(p_id text)
 returns void
 language sql
 security definer
 set search_path = ''
as $function$
  delete from privado.ordenes_borradas where id = p_id;
$function$;

revoke all on function privado.orden_olvidar(text) from public, anon, authenticated;

-- SECURITY INVOKER a propósito (como `ordenes_guardia`): `current_user` dice quién llama. Una fila que mete la API (un mesero subiendo una cuenta, una venta) NO borra la anotación: no se la salta con un
-- INSERT. Solo la olvida lo que no es la API: las funciones SECURITY DEFINER (`reabrir_venta_de_cierre`, `deshacer_cobro`) y el dueño. Disparar este trigger no exige permiso sobre la función; el
-- ayudante lo ejecuta quien llama solo en esos casos (el dueño y las funciones de la base, que son el dueño).
create or replace function privado.ordenes_olvidar_borrada()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    return null;
  end if;
  perform privado.orden_olvidar(new.id);
  return null;
end;
$function$;

revoke all on function privado.ordenes_olvidar_borrada() from public, anon, authenticated;

drop trigger if exists trg_ordenes_olvidar_borrada on public.ordenes;
create trigger trg_ordenes_olvidar_borrada
  after insert on public.ordenes
  for each row
  execute function privado.ordenes_olvidar_borrada();

-- ── 4. La guardia: una fila de una cuenta borrada CON ÍTEMS se rechaza ──

-- El ayudante que la guardia (SECURITY INVOKER, igual que `ordenes_guardia`) no podría leer por sí misma: la tabla es privada. Mismo patrón que `privado.orden_archivada`.
-- true = el id está en la lápida Y la cuenta tenía ítems cuando se borró (una anotación de una cuenta vacía y sin historia no frena nada).
create or replace function privado.orden_borrada_con_items(p_id text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select exists (select 1 from privado.ordenes_borradas where id = p_id and tenia_items);
$function$;

revoke all on function privado.orden_borrada_con_items(text) from public, anon, authenticated;
grant execute on function privado.orden_borrada_con_items(text) to authenticated;

-- SECURITY INVOKER a propósito: `current_user` dice quién llama y solo la API (`anon`, `authenticated`) se frena. Corre antes de la guardia de promos y después de `ordenes_guardia` (orden alfabético
-- de los triggers): si la cuenta además está archivada en un cierre, gana RS005. Un upsert corre este camino con la fila propuesta aunque la fila exista; por eso la lápida solo guarda ids que NO existen.
-- Juzga a CUALQUIER fila, abierta o cerrada: subir una cuenta abierta cuyos ítems otra tablet ya cobró es resucitarla, y de ahí sale el cobro doble.
create or replace function public.ordenes_guardia_lapida()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if privado.orden_borrada_con_items(new.id) then
    raise exception 'esa cuenta ya no existe: la cobró o la liberó otra tablet'
      using errcode = 'RS007', detail = 'cuenta ' || new.id,
            hint = 'La base borró esa cuenta con ítems que otra tablet ya resolvió (la cobró por partes y liberó la mesa, la anuló, o se deshizo un cobro que pasó a otra cuenta). Subirla o cobrarla de nuevo con la copia de esta tablet la resucitaría o registraría una venta que no existe: vuelve a leer las mesas.';
  end if;
  return new;
end;
$function$;

revoke all on function public.ordenes_guardia_lapida() from public, anon, authenticated;

drop trigger if exists trg_ordenes_guardia_lapida on public.ordenes;
create trigger trg_ordenes_guardia_lapida
  before insert on public.ordenes
  for each row
  execute function public.ordenes_guardia_lapida();

-- ── 5. La lápida no crece sin límite ────────────────────────

-- Disparador de SENTENCIA al guardar un cierre del día (el POS lo hace con upsert, `cerrar_dia_de` con insert). Corre como su dueño, como `purgar_deshechos_viejos`.
create or replace function privado.ordenes_borradas_purgar()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  delete from privado.ordenes_borradas where borrada_en < now() - interval '7 days';
  return null;
end;
$function$;

revoke all on function privado.ordenes_borradas_purgar() from public, anon, authenticated;

drop trigger if exists trg_cierres_purga_lapida on public.cierres;
create trigger trg_cierres_purga_lapida
  after insert on public.cierres
  for each statement
  execute function privado.ordenes_borradas_purgar();

-- ── 6. Comprobación (solo lecturas: si algo no quedó como debe, aborta y deshace TODO) ──

do $$
declare
  v_malos text[] := '{}';
begin
  if to_regclass('privado.ordenes_borradas') is null then
    v_malos := v_malos || 'falta privado.ordenes_borradas';
  else
    if not (select c.relrowsecurity from pg_class c where c.oid = 'privado.ordenes_borradas'::regclass) then
      v_malos := v_malos || 'privado.ordenes_borradas sin RLS';
    end if;
    if exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(rol), (values ('select'), ('insert'), ('update'), ('delete')) q(priv)
                where has_table_privilege(r.rol, 'privado.ordenes_borradas', q.priv)) then
      v_malos := v_malos || 'la lápida tiene permisos para la API';
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'privado' and table_name = 'ordenes_borradas' and column_name = 'tenia_items' and data_type = 'boolean' and is_nullable = 'NO') then
      v_malos := v_malos || 'falta privado.ordenes_borradas.tenia_items (boolean not null)';
    end if;
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.ordenes'::regclass and t.tgname = 'trg_ordenes_anotar_borrada' and not t.tgisinternal and t.tgtype = 9 and t.tgenabled = 'O') then
    v_malos := v_malos || 'falta trg_ordenes_anotar_borrada (AFTER DELETE por fila)';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.ordenes'::regclass and t.tgname = 'trg_ordenes_olvidar_borrada' and not t.tgisinternal and t.tgtype = 5 and t.tgenabled = 'O') then
    v_malos := v_malos || 'falta trg_ordenes_olvidar_borrada (AFTER INSERT por fila)';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.ordenes'::regclass and t.tgname = 'trg_ordenes_guardia_lapida' and not t.tgisinternal and t.tgtype = 7 and t.tgenabled = 'O') then
    v_malos := v_malos || 'falta trg_ordenes_guardia_lapida (BEFORE INSERT por fila)';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.cierres'::regclass and t.tgname = 'trg_cierres_purga_lapida' and not t.tgisinternal and t.tgtype = 4 and t.tgenabled = 'O') then
    v_malos := v_malos || 'falta trg_cierres_purga_lapida (AFTER INSERT por sentencia)';
  end if;
  -- las dos funciones que dependen de quién llama corren como quien llama (si fueran SECURITY DEFINER, current_user nunca sería la API y no frenarían ni dejarían de olvidar nada)
  if coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.ordenes_guardia_lapida()')), true) then
    v_malos := v_malos || 'public.ordenes_guardia_lapida no existe o es SECURITY DEFINER';
  end if;
  if coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('privado.ordenes_olvidar_borrada()')), true) then
    v_malos := v_malos || 'privado.ordenes_olvidar_borrada no existe o es SECURITY DEFINER (tiene que juzgar quién inserta)';
  end if;
  -- lo que lee o escribe la lápida corre como su dueño (la API no tiene permiso sobre la tabla)
  if (select count(*) from pg_proc p where p.prosecdef and p.oid in (to_regprocedure('privado.ordenes_anotar_borrada()'), to_regprocedure('privado.orden_olvidar(text)'),
                                                                       to_regprocedure('privado.ordenes_borradas_purgar()'), to_regprocedure('privado.orden_borrada_con_items(text)'))) <> 4 then
    v_malos := v_malos || 'las cuatro funciones que leen o escriben la lápida tienen que ser SECURITY DEFINER';
  end if;
  -- quién ejecuta qué: authenticated solo el ayudante de la guardia; nadie de la API los triggers, la guardia ni el ayudante que borra
  if exists (select 1 from (values ('anon'), ('authenticated'), ('public')) r(rol),
                           (values ('public.ordenes_guardia_lapida()'), ('privado.ordenes_anotar_borrada()'), ('privado.ordenes_olvidar_borrada()'), ('privado.orden_olvidar(text)'), ('privado.ordenes_borradas_purgar()')) f(sig)
              where has_function_privilege(r.rol, to_regprocedure(f.sig), 'execute')) then
    v_malos := v_malos || 'la API (anon, authenticated o public) puede ejecutar un trigger o un ayudante que escribe la lápida';
  end if;
  if not coalesce(has_function_privilege('authenticated', to_regprocedure('privado.orden_borrada_con_items(text)'), 'execute'), false)
     or coalesce(has_function_privilege('anon', to_regprocedure('privado.orden_borrada_con_items(text)'), 'execute'), true)
     or coalesce(has_function_privilege('public', to_regprocedure('privado.orden_borrada_con_items(text)'), 'execute'), true) then
    v_malos := v_malos || 'privado.orden_borrada_con_items la tiene que ejecutar authenticated y nadie más de la API';
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'La lápida de las cuentas borradas no quedó como debe: %. Se deshizo todo.', array_to_string(v_malos, '; ');
  end if;
end $$;
