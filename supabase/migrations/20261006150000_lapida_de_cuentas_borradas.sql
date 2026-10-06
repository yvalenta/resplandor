-- ════════════════════════════════════════════════════════════
-- Resplandor — LA LÁPIDA DE LAS CUENTAS BORRADAS: una venta cerrada NUEVA con el id de una cuenta que la base ya borró se RECHAZA (RS007)
-- (hallazgo ALTO de la séptima refutación, 2026-10-06; ya estaba en producción con main 6c5c4a4; tareas/2026-10-04-hallazgos-domingo.md.
--  Corrige lo que 20261002180000 deja abierto; esa migración NO se edita.)
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
--
-- QUÉ HACE (la base manda; el POS, además, ya no cobra con una copia de una cuenta que la base no tiene: pos.html, `_leerCuentaParaCobrar`)
--   1. `privado.ordenes_borradas (id, borrada_en)`: la LÁPIDA, los ids de las cuentas que la base borró. Tabla PRIVADA (esquema `privado`, fuera de PostgREST; RLS encendida
--      y sin policies; ningún permiso para anon, authenticated ni service_role). Solo id y hora: ningún dato de la cuenta.
--   2. `trg_ordenes_anotar_borrada` (AFTER DELETE en ordenes, por fila): cada borrado anota el id (o renueva la hora si ya estaba). Cubre TODO borrado: «Liberar mesa» (la cuenta vacía), el
--      cobro por partes que la vació y se liberó, la anulación, `deshacer_cobro` (el cobro completo que pasa a otra cuenta y el parcial que vuelve a su cuenta borran la fila cerrada)
--      y la purga del cierre del día. Un borrado que un guardia descarta (la cuenta con ítems, la venta que ningún cierre archivó) no es un borrado: no anota nada.
--   3. `trg_ordenes_olvidar_borrada` (AFTER INSERT en ordenes, por fila): si la cuenta VUELVE a existir (`reabrir_venta_de_cierre` la inserta con su id, un esqueleto, una cuenta abierta
--      que una tablet sube) el id sale de la lápida: la lápida solo guarda ids que hoy NO existen. Por eso reabrir una venta y cobrarla otra vez sigue funcionando.
--   4. `trg_ordenes_guardia_lapida` (BEFORE INSERT, por fila; solo la API, igual que `ordenes_guardia`): una fila CERRADA con un id que está en la lápida se RECHAZA con SQLSTATE RS007
--      («esa cuenta ya no existe: la cobró o la liberó otra tablet»). No frena: lo que no viene de la API (el dueño, el SQL Editor, service_role y las funciones SECURITY DEFINER
--      —`deshacer_cobro`, `cobrar_parcial`, `cobrar_abono`, `reabrir_venta_de_cierre`, `cerrar_dia`—), una cuenta ABIERTA (subir una cuenta abierta no la cobra), un UPDATE (la fila existe: lo
--      juzga RS003) ni una cuenta que NUNCA estuvo en la base (una cuenta abierta y cobrada sin red que jamás subió: su id no está en la lápida y su venta entra como siempre). El orden
--      de los guardias es el del nombre: `trg_ordenes_guardia` (RS005: archivada) va antes y gana.
--   5. `trg_cierres_purga_lapida` (AFTER INSERT en cierres, por sentencia, como `purgar_deshechos_viejos`): al guardar el cierre del día se borran las anotaciones de más de 7 días (ninguna
--      tablet tarda tanto en traer una venta; la lápida no crece sin límite).
--   Qué NO cierra (dicho): una petición cuyo INSERT empiece en el mismo instante en que otra transacción borra la cuenta (la guardia mira lo ya confirmado: la ventana es de milisegundos);
--   la anotación de más de 7 días (una tablet que pasó una semana sin red y vuelve con una venta de una cuenta borrada la inserta); el cobro por partes del POS de antes (el publicado
--   hoy: inserta una fila cerrada NUEVA con `parcial_de` = una cuenta que ya no existe: el POS nuevo cobra por la RPC, que no encuentra la cuenta); y una cuenta ABIERTA que una tablet con
--   cambios sin subir vuelve a subir después de que otra la borró (resucita abierta: es lo que hace una cuenta abierta sin red; al cobrarse pasa por RS003).
--   NO cambia ninguna policy, tabla pública ni dato, ni los otros guardias de ordenes.
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
--   drop function if exists privado.ordenes_borradas_purgar();
--   drop function if exists privado.orden_borrada(text);
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

create table if not exists privado.ordenes_borradas (
  id text not null,
  borrada_en timestamp with time zone not null default now(),
  constraint ordenes_borradas_pkey primary key (id)
);

create index if not exists ordenes_borradas_borrada_en on privado.ordenes_borradas using btree (borrada_en);

comment on table privado.ordenes_borradas is
  'La lápida: los ids de las cuentas (public.ordenes) que la base borró y que hoy no existen (liberar una mesa vacía, deshacer un cobro que pasó a otra cuenta, la purga del cierre del día). Una venta cerrada NUEVA con uno de estos ids la rechaza trg_ordenes_guardia_lapida (RS007): la cuenta ya no existe, la cobró o la liberó otra tablet. Solo id y hora; se vacía de lo de más de 7 días al guardar el cierre del día.';

alter table privado.ordenes_borradas enable row level security;
revoke all on table privado.ordenes_borradas from public, anon, authenticated, service_role;

-- ── 2. Cada borrado anota su id ─────────────────────────────

-- SECURITY DEFINER: quien borra por la API (un mesero liberando una mesa) no tiene permiso sobre `privado.ordenes_borradas`, y no debe ganarlo.
create or replace function privado.ordenes_anotar_borrada()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  insert into privado.ordenes_borradas (id, borrada_en) values (old.id, now())
  on conflict (id) do update set borrada_en = excluded.borrada_en;
  return null;
end;
$function$;

revoke all on function privado.ordenes_anotar_borrada() from public, anon, authenticated;

drop trigger if exists trg_ordenes_anotar_borrada on public.ordenes;
create trigger trg_ordenes_anotar_borrada
  after delete on public.ordenes
  for each row
  execute function privado.ordenes_anotar_borrada();

-- ── 3. Una cuenta que vuelve a existir sale de la lápida ────

create or replace function privado.ordenes_olvidar_borrada()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  delete from privado.ordenes_borradas where id = new.id;
  return null;
end;
$function$;

revoke all on function privado.ordenes_olvidar_borrada() from public, anon, authenticated;

drop trigger if exists trg_ordenes_olvidar_borrada on public.ordenes;
create trigger trg_ordenes_olvidar_borrada
  after insert on public.ordenes
  for each row
  execute function privado.ordenes_olvidar_borrada();

-- ── 4. La guardia: una venta cerrada nueva de una cuenta borrada se rechaza ──

-- El ayudante que la guardia (SECURITY INVOKER, igual que `ordenes_guardia`) no podría leer por sí misma: la tabla es privada. Mismo patrón que `privado.orden_archivada`.
create or replace function privado.orden_borrada(p_id text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select exists (select 1 from privado.ordenes_borradas where id = p_id);
$function$;

revoke all on function privado.orden_borrada(text) from public, anon, authenticated;
grant execute on function privado.orden_borrada(text) to authenticated;

-- SECURITY INVOKER a propósito: `current_user` dice quién llama y solo la API (`anon`, `authenticated`) se frena. Corre antes de la guardia de promos y después de `ordenes_guardia` (orden alfabético
-- de los triggers): si la cuenta además está archivada en un cierre, gana RS005. Un upsert corre este camino con la fila propuesta aunque la fila exista; por eso la lápida solo guarda ids que NO existen.
create or replace function public.ordenes_guardia_lapida()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.estado is distinct from 'cerrada' then
    return new;
  end if;
  if privado.orden_borrada(new.id) then
    raise exception 'esa cuenta ya no existe: la cobró o la liberó otra tablet'
      using errcode = 'RS007', detail = 'cuenta ' || new.id,
            hint = 'La base borró esa cuenta (otra tablet la cobró por partes y liberó la mesa, la anuló, o se deshizo un cobro que pasó a otra cuenta). Cobrarla de nuevo con la copia de esta tablet registraría una venta que no existe: vuelve a leer las mesas.';
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
  -- la guardia corre como quien llama (si fuera SECURITY DEFINER, current_user nunca sería la API y no frenaría nada)
  if coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.ordenes_guardia_lapida()')), true) then
    v_malos := v_malos || 'public.ordenes_guardia_lapida no existe o es SECURITY DEFINER';
  end if;
  -- lo que lee o escribe la lápida corre como su dueño (la API no tiene permiso sobre la tabla)
  if (select count(*) from pg_proc p where p.prosecdef and p.oid in (to_regprocedure('privado.ordenes_anotar_borrada()'), to_regprocedure('privado.ordenes_olvidar_borrada()'),
                                                                       to_regprocedure('privado.ordenes_borradas_purgar()'), to_regprocedure('privado.orden_borrada(text)'))) <> 4 then
    v_malos := v_malos || 'las cuatro funciones que leen o escriben la lápida tienen que ser SECURITY DEFINER';
  end if;
  -- quién ejecuta qué: authenticated solo el ayudante de la guardia; nadie de la API los triggers ni la guardia
  if exists (select 1 from (values ('anon'), ('authenticated'), ('public')) r(rol),
                           (values ('public.ordenes_guardia_lapida()'), ('privado.ordenes_anotar_borrada()'), ('privado.ordenes_olvidar_borrada()'), ('privado.ordenes_borradas_purgar()')) f(sig)
              where has_function_privilege(r.rol, to_regprocedure(f.sig), 'execute')) then
    v_malos := v_malos || 'la API (anon, authenticated o public) puede ejecutar un trigger de la lápida';
  end if;
  if not coalesce(has_function_privilege('authenticated', to_regprocedure('privado.orden_borrada(text)'), 'execute'), false)
     or coalesce(has_function_privilege('anon', to_regprocedure('privado.orden_borrada(text)'), 'execute'), true)
     or coalesce(has_function_privilege('public', to_regprocedure('privado.orden_borrada(text)'), 'execute'), true) then
    v_malos := v_malos || 'privado.orden_borrada la tiene que ejecutar authenticated y nadie más de la API';
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'La lápida de las cuentas borradas no quedó como debe: %. Se deshizo todo.', array_to_string(v_malos, '; ');
  end if;
end $$;
