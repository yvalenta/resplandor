-- ════════════════════════════════════════════════════════════
-- Resplandor — DESHACER UN COBRO, «tipo ctrl+z», SIN VENTANA; EL CIERRE DEL DÍA LO DECIDE LA BASE; DELTAS IDEMPOTENTES (4 de 4 de la ola C)
-- (pedido de Yonatan, 2026-09-30: «si pagué una parte de una cuenta y la quiero deshacer, si ese pago fue de esa
-- mesa se debería poder editar y devolver a la mesa, por ende recalcular»; 2026-10-01: «el pedido se podrá
-- deshacer cuando quiera el mesero o el admin»; decisión D28 de las alertas)
--
--   1. 20261002150000_aprobacion_personal.sql      quién entra, con aprobación.
--   2. 20261002160000_mesas_y_pegatinas.sql        mesas activas y pegatinas NFC.
--   3. 20261002170000_ajustes_ticket.sql           la URL del QR y el pie del ticket.
--   4. 20261002180000_deshacer_cobro.sql        ← ESTA.
--
-- Qué hace
--   1. `ordenes.parcial_de` (text, null): el id de la orden ABIERTA de la que salió esta orden cerrada, cuando es
--      un cobro parcial (por ítems o por unidades: facturarParcial) o un abono (cobrarMonto). El POS lo escribe al
--      CREAR la orden cerrada. No es clave foránea a propósito: el cierre del día borra órdenes y no debe fallar.
--      `ordenes.deltas_ids` (jsonb, null) es solo de paso: ver el punto 8.
--   2. `deshacer_cobro(p_orden_id)`: deshace un cobro del turno abierto, TODO en una transacción con candado:
--        · un cobro por ítems o por unidades (trae `parcial_de`): cada ítem vuelve a la cuenta abierta de la MISMA
--          mesa con su mismo id, nombre, precio y nota; si la línea ya no está se agrega entera; si sigue, se le
--          suman las unidades.
--        · un abono (trae `parcial_de` y una sola línea `abono_<uid>`): se quita de la cuenta su línea
--          `abono_recibido_<uid>`. Solo si la cuenta la trae EXACTAMENTE así (una línea, cantidad 1, precio igual al
--          opuesto del abono): si alguien la editó, no se devuelve y no se inventa un monto.
--        · el COBRO COMPLETO de una mesa (sin `parcial_de`): si esa mesa está libre, la misma orden se REABRE en ella
--          (la mesa vuelve a «ocupada»); si la mesa ya tiene otra cuenta abierta, los ítems pasan a ESA cuenta y la
--          cerrada se borra (los abonos de la cerrada pasan a apuntar a la cuenta que los recibe).
--      En los tres casos se recalcula `total` (Σ precio × qty) y se sube `version`; el monto que se devuelve (`monto`)
--      es lo que de verdad volvió a la cuenta (el total de después menos el de antes), no el `total` de la cerrada.
--      La señal en vivo de la carta sale sola: el UPDATE de la orden abierta dispara `ordenes_emite_cuenta`
--      (20261001120000); el DELETE de la cerrada no emite. Una sola señal.
--      QUIÉN: el admin y el mesero, EN CUALQUIER MOMENTO, mientras el cobro siga en el turno abierto (todavía no esté
--      en un cierre del día: el cierre borra las órdenes que archiva, y si la purga está en camino, `ya_en_cierre`).
--      Quien no tiene rol, nada. Es SECURITY DEFINER porque el mesero no puede editar ni borrar una orden cerrada
--      (RLS de la ola B): editar en el sitio y eliminar una venta siguen siendo SOLO del admin; deshacer es otra cosa.
--      Devuelve jsonb:
--        {ok: true, tipo ('parcial'|'abono'|'completo'), total_abierta, orden_id (la cuenta abierta), mesa_id,
--         monto (lo que volvió), version, reabierta (true: la cerrada se reabrió en su mesa), fusionada (true: pasó a
--         otra cuenta abierta de la mesa)}
--        {ok: false, codigo}  con codigo =
--          no_autorizado     sin rol (pendiente, eliminado, ajena)
--          no_existe         no hay esa orden (también: ya se deshizo; un doble toque cae aquí la segunda vez)
--          ya_reabierta      la orden existe pero ya está ABIERTA: otra tablet acaba de deshacer ese mismo cobro completo (el
--                            doble toque desde dos tablets de un cobro completo cae aquí la segunda vez)
--          mesa_ocupada      el cobro completo se iba a reabrir y, a la vez, otra tablet abrió esa mesa y se rechazó (23505) sin
--                            que luego se encontrara esa cuenta (rarísimo: se vuelve a intentar). Si SÍ se encuentra, los
--                            ítems pasan a ella (fusionada)
--          no_es_parcial     no está cerrada, o no se puede devolver: un abono sin cuenta (anterior a esta migración),
--                            una orden vacía, un cobro de otra mesa que la cuenta, o un abono que ya no cuadra con ella
--          cuenta_ya_cerrada la cuenta de la que salió (parcial o abono) ya no está abierta: se cobró, se borró o se purgó
--          mesa_inactiva     el cobro completo es de una mesa que un admin desactivó: se activa y se vuelve a intentar
--          ya_en_cierre      el cobro ya está archivado en un cierre del día (`cierre_ordenes`)
--   3. TRAZABILIDAD (no limita a nadie): la tabla `deshechos` (id, orden_id, mesa_id, tipo, monto, items, hecho_por,
--      hecho_en, cierre_id). SOLO la escribe `deshacer_cobro` (nadie tiene INSERT) y SOLO la lee el admin. `hecho_por` es el correo de
--      la identidad de Google de la sesión, `hecho_en` la hora del servidor. El POS le enseña al admin, en el cierre del
--      día, «Cobros deshechos hoy: N · $X» con quién, mesa, monto y hora. Se guarda 90 días: un disparador al guardar un
--      cierre del día borra lo más viejo (`purgar_deshechos_viejos`). Es dato personal (el correo de quien lo hizo):
--      privacy.html lo dice. `cierre_id` es el cierre del día que los incluyó: null = turno abierto («Cobros deshechos
--      hoy» = los de `cierre_id` null). Lo escribe `cerrar_dia` (punto 6) en la misma transacción que guarda el cierre, así
--      que «hoy» no depende del reloj de ninguna tablet ni se pierde un deshacer hecho mientras el admin miraba el cierre
--      (refutación de la ola C, ronda 2, hallazgo 3).
--   4. Dos guardias sobre `ordenes` (disparador `trg_ordenes_guardia`, solo con sesiones de la API: el dueño, el SQL
--      Editor y las funciones SECURITY DEFINER no se frenan):
--        · `parcial_de` solo lo escribe quien CREA la orden: en un UPDATE se conserva (un mesero que cierra una cuenta
--          suya con `parcial_de = <otra orden>` no engaña a deshacer_cobro) y se pone en null, para todos, cuando una
--          orden cerrada se reabre o se edita (cambia sus ítems, su total o su mesa): el cobro ya no es el que era.
--        · UNA VENTA ARCHIVADA NO VUELVE, Y NO SE DESCARTA EN SILENCIO: el INSERT (o upsert) de una orden `cerrada` cuyo id ya está en un cierre del día
--          (punto 7) se RECHAZA con SQLSTATE RS005 («la cuenta … ya estaba en un cierre del día: revísala con el admin»). Antes se descartaba en silencio
--          (0 filas y ningún aviso) y eso también se comía el cobro de una cuenta que existe ABIERTA con un id archivado: quedaba imposible de cobrar y
--          `cerrar_dia` respondía `hay_abiertas` para siempre. Cubre los dos casos: la fila existe abierta, o ya se archivó y se purgó y alguien
--          reintenta su cobro. La salida limpia de una cuenta abierta y archivada es `reabrir_venta_de_cierre` (punto 9). También se rechaza (RS005)
--          el cobro POR PARTES, por persona o el abono de una cuenta que existe ABIERTA y archivada (la orden cerrada nueva trae `parcial_de` = esa
--          cuenta): cobrarla «por partes» la vaciaba, se liberaba la mesa y la venta quedaba contada dos veces. Si la cuenta ya no está abierta, el cobro
--          parcial que llega tarde (una tablet sin red) entra como siempre: es una venta real que nadie más contó.
--        · `deltas_ids` (punto 8): los ids que trae la fila pasan a `deltas_aplicados` y la columna queda en null.
--        · CERRAR CON LO QUE SE VIO: si el UPDATE que pasa una orden de abierta a cerrada trae un `version` distinto del
--          que tiene la base, se rechaza (SQLSTATE RS003, «la cuenta … cambió»). Sin esto, una tablet que estuvo sin red
--          cobraba la mesa con ítems viejos y pisaba lo que otra tablet había devuelto con «Deshacer» (refutación de la
--          ola C, hallazgo 4). El POS manda su `version` al cerrar; quien no la manda (una caché vieja) no se frena. Y
--          `version` sigue a los ítems: cualquier UPDATE que cambie `items` sin tocar `version` la sube.
--      Y un guardia de DELETE (`trg_ordenes_guardia_borrar`): una cuenta ABIERTA con ítems no se borra por la API (el cierre del día de un
--      POS viejo, con su foto, ya no se lleva la cuenta que otro dispositivo reabrió con «Deshacer»; el borrado se salta), y una venta CERRADA que
--      ningún cierre archivó tampoco (una lista de purga que se quedó pendiente en una tablet no puede llevarse el segundo cobro de una venta que un
--      admin reabrió con el mismo id: solo se purga lo que ya está en `cierre_ordenes`). Los borrados que sí hace el POS (una mesa vacía, las ventas
--      ya archivadas) y los de las funciones de la base pasan. Son los ÚNICOS descartes callados que quedan, a propósito: los provoca un POS sin
--      recargar o una purga atrasada, que borran por id en una sola sentencia y no tienen dónde mostrar un error; el POS nuevo no borra cuentas
--      abiertas con ítems ni ventas vivas, y la cuenta que se salvó la ve el siguiente `cerrar_dia` (`hay_abiertas`, o la venta entra en su cierre).
--   5. D28 de las alertas (privacidad: `alertas.atendida_por` guarda el correo de quien atendió): las alertas que
--      ya no están pendientes y se resolvieron hace MÁS DE UN DÍA se borran solas. Un disparador de sentencia llama
--      a `purgar_alertas_viejas()` en tres momentos: al crear una alerta (la carta), al resolver una (atender,
--      descartar o cerrar la mesa) y al guardar un cierre del día. Así no hace falta darle a nadie permiso de
--      DELETE sobre `alertas`. Lo que `privacy.html` puede decir con verdad: «los avisos ya atendidos o
--      descartados se borran cuando pasa más de un día, la siguiente vez que se crea o se atiende un aviso o se
--      cierra el día». Las pendientes no se borran (sin cierre ni mesa liberada, una pendiente sigue pendiente).
--   6. EL CIERRE DEL DÍA LO DECIDE LA BASE (`cerrar_dia(p_id, p_esperado)`): antes el POS guardaba el cierre con la FOTO que tenía la
--      tablet y después borraba esas órdenes por id. Con «deshacer sin ventana» y varias tablets eso pierde cuentas (un mesero reabre un
--      cobro mientras la tablet del admin lo tiene cerrado: la purga borra la cuenta reabierta), deja fuera las ventas que la tablet no
--      vio y, si una respuesta se pierde, archiva dos veces la misma venta (refutación de la ola C, rondas 2 y 3). Ahora la foto de la
--      tablet ya no cuenta. Un solo SECURITY DEFINER, solo para el admin, en UNA transacción y con el mismo candado de aviso que
--      `deshacer_cobro` (los dos se turnan):
--        · toma TODAS las órdenes `cerrada` que no estén en ningún cierre (con candado y en orden), de cualquier día;
--        · si queda alguna cuenta `abierta`, no cierra (`hay_abiertas`);
--        · el admin firma lo que ve: `p_esperado` es {n, total, ids} (cuántas ventas, cuánto y cuáles). Si la base tiene otra cosa
--          responde `cambio` con su resumen (no guarda ni borra nada) y el POS vuelve a mostrar la confirmación con los números de la base;
--        · arma el cierre (las ventas con sus ítems, el total y cuántas), lo guarda, borra las órdenes que archiva (y las cerradas que ya
--          estaban archivadas: rezagos de una purga que no terminó), borra los `deltas_aplicados` que quedaron sin orden y le pone su id a
--          los `deshechos` del turno, todo junto. La hora del cierre es la del servidor, no la de la tablet.
--      NUNCA borra una cuenta abierta. Un reintento con el mismo id (se perdió la respuesta) devuelve el cierre que ya se guardó.
--      Devuelve jsonb:
--        {ok: true, repetido, n, total, borradas, cierre: {id, fecha, total, n, ordenes}, deshechos: [{orden_id, mesa_id, tipo, monto, hecho_por, hecho_en}]}
--        {ok: false, codigo} con codigo =
--          no_autorizado   solo el admin cierra el día
--          invalido        sin id de cierre, o sin `p_esperado` (tiene que ser un objeto)
--          hay_abiertas    quedan cuentas abiertas: `abiertas` trae sus mesas y `resumen`, lo que se cerraría
--          sin_ventas      no hay ninguna venta cerrada por archivar
--          cambio          lo que tiene la base no es lo que el POS espera: `resumen` = {n, total, ids, abonos_por_metodo}
--      (`abonos_por_metodo`: el método de pago solo se guarda en las líneas de abono; una venta normal no lo lleva, así que no hay otro total.)
--   7. UNA VENTA NUNCA ENTRA EN DOS CIERRES (`cierre_ordenes`, orden_id es la clave primaria): un disparador de `cierres` apunta cada id de
--      `transacciones` a su cierre; un segundo cierre que traiga una venta ya archivada se rechaza (RS004), y también la edición
--      de un cierre que meta una venta que está VIVA en `ordenes` (una copia atrasada del cierre no resucita una venta que un admin reabrió y se volvió
--      a cobrar). Quitar la venta de un cierre (editarlo, reabrirla) la libera. Con ese registro, una venta cerrada que se vuelve a subir DESPUÉS de archivada se rechaza con RS005
--      (punto 4) y deshacer_cobro responde ya_en_cierre. Los cierres que ya existen se registran al aplicar esta migración (si un id estuviera
--      en dos, se queda en el más antiguo).
--   8. DELTAS IDEMPOTENTES: `aplicar_delta_orden` gana `p_delta_id text default null`. Con id, la base lo anota en `deltas_aplicados`
--      dentro de la misma transacción del delta y, si ya estaba, no aplica nada y devuelve la orden tal cual: reenviar un delta cuya
--      respuesta se perdió ya no lo duplica. Una cuenta cobrada sin red sube con los ítems de los deltas que nunca se mandaron: la fila trae
--      sus ids en `ordenes.deltas_ids` y el guardia los pasa a `deltas_aplicados` en la misma transacción que la fila (la columna queda en
--      null): un reintento de esos deltas tampoco los duplica. Sin id (el POS de la ola B) todo sigue como antes. `deltas_aplicados` se
--      purga con el cierre del día (lo que ya no tiene orden).
--   9. REABRIR UNA VENTA DE UN CIERRE PASADO, ATÓMICO (`reabrir_venta_de_cierre(p_cierre_id, p_orden_id, p_mesa_id)`, solo admin): una sola transacción
--      saca la venta del cierre (recalcula su total y su cuenta; el disparador de `cierres` la libera de `cierre_ordenes`) y deja la cuenta abierta en
--      la mesa pedida. Antes el POS subía la cuenta abierta y DESPUÉS editaba el cierre: si la segunda subida no llegaba, la cuenta quedaba abierta y
--      archivada a la vez (RS005 al cobrarla). Es también la salida limpia de esa cuenta si ya existe abierta con un id archivado (un POS viejo cerró
--      con una foto vieja): se la deja como está y solo se saca del cierre (`adoptada`). El POS la exige con red. `cerrar_dia` ya dice, en
--      `hay_abiertas`, cuáles de las mesas abiertas están en ese caso (`en_cierre`).
--
--   acción                       | admin | mesero | pendiente / eliminado / ajeno | anon
--   -----------------------------+-------+--------+-------------------------------+------
--   deshacer_cobro               |  sí   |  sí    | no_autorizado                 | no
--   cerrar_dia                   |  sí   | no_autorizado | no_autorizado          | no
--   reabrir_venta_de_cierre      |  sí   | no_autorizado | no_autorizado          | no
--   deshechos  leer              |  sí   |  no    | no                            | no
--   deshechos  escribir          | solo la función deshacer_cobro (nadie tiene INSERT/UPDATE/DELETE)
--   ordenes.parcial_de           | lo escribe el POS al crear la cerrada (INSERT: ordenes_crear); en UPDATE no cambia
--   cierre_ordenes / deltas_aplicados | nadie por la API (RLS sin policies y sin GRANT): solo las funciones y disparadores de la base
--
-- Necesita las alertas (20261002130000), las policies por rol (20261002140000) y las mesas activas (20261002160000):
-- si falta alguna, se niega a correr SIN cambiar nada. Aplicarla antes del POS que la usa es inocuo.
--
-- REVERSA (menos de 1 minuto; el POS que escribe `parcial_de` y `deltas_ids` debe volver atrás ANTES: sin las columnas, el guardado
-- de un cobro parcial o de una cuenta con deltas pendientes fallaría; se pierden los registros de `deshechos`, `cierre_ordenes` y
-- `deltas_aplicados`: guardar antes lo que se quiera conservar. La función `aplicar_delta_orden` vuelve a la de siete parámetros de
-- 20261002140000):
--
--   begin;
--   drop trigger if exists trg_ordenes_guardia on public.ordenes;
--   drop trigger if exists trg_ordenes_guardia_borrar on public.ordenes;
--   drop function if exists public.ordenes_guardia();
--   drop function if exists public.ordenes_guardia_borrar();
--   drop trigger if exists trg_cierres_registrar_ordenes on public.cierres;
--   drop function if exists public.cierres_registrar_ordenes();
--   drop trigger if exists trg_cierres_purga_deshechos on public.cierres;
--   drop function if exists public.purgar_deshechos_viejos();
--   drop trigger if exists trg_cierres_purga_alertas on public.cierres;
--   drop trigger if exists trg_alertas_nueva_purga on public.alertas;
--   drop trigger if exists trg_alertas_resuelta_purga on public.alertas;
--   drop function if exists public.purgar_alertas_viejas();
--   drop function if exists public.reabrir_venta_de_cierre(text, text, integer);
--   drop function if exists public.cerrar_dia(text, jsonb);
--   drop function if exists public.cerrar_dia(text, timestamp with time zone, numeric, jsonb, jsonb);
--   drop function if exists public.deshacer_cobro(text);
--   drop function if exists public.deshacer_cobro_sumar(jsonb, jsonb);
--   drop function if exists public.aplicar_delta_orden(text, text, text, numeric, integer, text, boolean, text);
--   create or replace function public.aplicar_delta_orden(p_orden_id text, p_item_id text, p_nombre text, p_precio numeric, p_delta integer, p_nota text default ''::text, p_solo_abierta boolean default true)
--    returns public.ordenes
--    language plpgsql
--    set search_path = public
--   as $function$
--   declare
--     o      ordenes;
--     nuevos jsonb;
--     existe boolean;
--   begin
--     select * into o from ordenes where id = p_orden_id for update;
--     if not found then
--       raise exception 'orden % no existe', p_orden_id;
--     end if;
--     if p_solo_abierta and o.estado <> 'abierta' then
--       raise exception 'orden % está cerrada', p_orden_id using errcode = 'RS001';
--     end if;
--
--     select exists(
--       select 1 from jsonb_array_elements(o.items) e where e->>'id' = p_item_id
--     ) into existe;
--
--     if existe then
--       -- Ajusta qty; conserva el resto de campos del ítem (nombre, precio, nota).
--       select coalesce(jsonb_agg(x), '[]'::jsonb) into nuevos
--       from (
--         select case when e->>'id' = p_item_id
--                     then jsonb_set(e, '{qty}', to_jsonb(greatest(0, (e->>'qty')::int + p_delta)))
--                     else e end as x
--         from jsonb_array_elements(o.items) e
--       ) s
--       where (x->>'qty')::int > 0;
--     else
--       nuevos := case when p_delta > 0
--         then o.items || jsonb_build_array(
--                jsonb_build_object('id', p_item_id, 'nombre', p_nombre,
--                                   'precio', p_precio, 'qty', p_delta, 'nota', coalesce(p_nota, '')))
--         else o.items end;
--     end if;
--
--     update ordenes
--        set items = nuevos,
--            total = (select coalesce(sum((e->>'precio')::numeric * (e->>'qty')::int), 0)
--                     from jsonb_array_elements(nuevos) e),
--            version = coalesce(o.version, 0) + 1,
--            updated_at = now()
--      where id = p_orden_id
--     returning * into o;
--
--     return o;
--   end $function$;
--   revoke all on function public.aplicar_delta_orden(text, text, text, numeric, integer, text, boolean) from public, anon;
--   grant execute on function public.aplicar_delta_orden(text, text, text, numeric, integer, text, boolean) to authenticated, service_role;
--   drop function if exists privado.delta_registrar(text, text);
--   drop function if exists privado.deltas_marcar(text, jsonb);
--   drop function if exists privado.orden_archivada(text);
--   revoke usage on schema privado from authenticated;
--   drop table if exists public.cierre_ordenes;
--   drop table if exists public.deltas_aplicados;
--   drop table if exists public.deshechos;
--   alter table public.ordenes drop column if exists deltas_ids;
--   alter table public.ordenes drop column if exists parcial_de;
--   commit;
--
-- Idempotente donde se puede. Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ───────────────────────────────────────────

do $$
begin
  if to_regclass('public.alertas') is null or to_regprocedure('public.mi_rol()') is null then
    raise exception 'Falta 20261002130000_alertas.sql (alertas) o la compuerta (mi_rol()): aplicalas primero. No se cambió nada.';
  end if;
  if to_regprocedure('public.mi_correo()') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'mesas' and column_name = 'activa') then
    raise exception 'Falta 20261002160000_mesas_y_pegatinas.sql (mesas.activa) o la compuerta (mi_correo()): aplicalas primero. No se cambió nada.';
  end if;
  if to_regnamespace('privado') is null then
    raise exception 'Falta el esquema privado (20261001120000_cuenta_en_vivo.sql): aplicala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. El vínculo del cobro con su cuenta ───────────────────

alter table public.ordenes add column if not exists parcial_de text;

comment on column public.ordenes.parcial_de is
  'id de la orden ABIERTA de la que salió esta orden cerrada (cobro parcial por ítems o unidades, o abono). Lo escribe el POS al crearla; en UPDATE no cambia, y se pone en null al reabrir o editar la cerrada (trg_ordenes_guardia). deshacer_cobro lo usa para devolverlo. Sin clave foránea: el cierre del día borra órdenes.';

alter table public.ordenes add column if not exists deltas_ids jsonb;

comment on column public.ordenes.deltas_ids is
  'Solo de paso: los ids de los deltas (aplicar_delta_orden) cuyo efecto ya viaja en los ítems de esta fila (una cuenta cobrada sin red que sube con sus cambios pendientes). trg_ordenes_guardia los pasa a deltas_aplicados en la misma transacción y deja la columna en null: reenviar esos deltas después no los duplica.';

-- ── 1a. Lo que la base recuerda para no hacer las cosas dos veces ──
-- `cierre_ordenes`: a qué cierre del día pertenece cada venta archivada (orden_id es la clave primaria: una venta nunca entra en dos
-- cierres). La mantiene el disparador de `cierres` (más abajo). `deltas_aplicados`: los ids de los deltas que `aplicar_delta_orden` ya
-- aplicó (o cuyo efecto ya viajó en una fila cerrada): reenviarlos no hace nada. Las dos son internas: RLS sin policies y sin GRANT
-- (solo las tocan las funciones de la base), igual que `privado`, que tampoco expone PostgREST.

create table if not exists public.cierre_ordenes (
  orden_id text not null,
  cierre_id text not null,
  constraint cierre_ordenes_pkey primary key (orden_id),
  constraint cierre_ordenes_cierre_fkey foreign key (cierre_id) references public.cierres (id) on delete cascade
);
create index if not exists cierre_ordenes_cierre on public.cierre_ordenes using btree (cierre_id);

create table if not exists public.deltas_aplicados (
  id text not null,
  orden_id text not null,
  aplicado_en timestamp with time zone not null default now(),
  constraint deltas_aplicados_pkey primary key (id)
);
create index if not exists deltas_aplicados_orden on public.deltas_aplicados using btree (orden_id);

comment on table public.cierre_ordenes is
  'A qué cierre del día pertenece cada venta archivada (orden_id es la clave primaria: una venta nunca entra en dos cierres). La mantiene trg_cierres_registrar_ordenes; nadie la escribe por la API.';
comment on table public.deltas_aplicados is
  'Los ids de los deltas de aplicar_delta_orden ya aplicados (o cuyo efecto ya viajó en una fila cerrada, ordenes.deltas_ids): reenviarlos no hace nada. Se purga con el cierre del día. Nadie la lee ni la escribe por la API.';

alter table public.cierre_ordenes enable row level security;
alter table public.deltas_aplicados enable row level security;
revoke all on public.cierre_ordenes, public.deltas_aplicados from anon, authenticated, service_role;

-- Los cierres que ya existen quedan registrados (si una venta estuviera en dos, se queda en el más antiguo).
insert into public.cierre_ordenes (orden_id, cierre_id)
select distinct on (e ->> 'id') e ->> 'id', c.id
  from public.cierres c
 cross join lateral jsonb_array_elements(case when jsonb_typeof(c.transacciones) = 'array' then c.transacciones else '[]'::jsonb end) e
 where e ->> 'id' is not null
 order by e ->> 'id', c.fecha, c.id
on conflict (orden_id) do nothing;

-- Los cierres, en adelante: cada guardado (el de cerrar_dia, el de un POS viejo o el de editar un cierre) apunta sus ventas. SECURITY
-- DEFINER: quien guarda el cierre no puede escribir en el registro.
create or replace function public.cierres_registrar_ordenes()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_viejo jsonb := '[]'::jsonb;
  v_repetida text;
  v_viva text;
begin
  if jsonb_typeof(new.transacciones) is distinct from 'array' then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if jsonb_typeof(old.transacciones) = 'array' then v_viejo := old.transacciones; end if;
    -- lo que ya no está en el cierre queda libre
    delete from public.cierre_ordenes c
     where c.cierre_id = new.id
       and not exists (select 1 from jsonb_array_elements(new.transacciones) e where e ->> 'id' = c.orden_id);
    -- lo que ENTRA a un cierre que ya existe no puede ser una venta que está viva en `ordenes`: una edición atrasada del cierre (otra tablet, con su copia
    -- de antes de que un admin reabriera esa venta) la volvía a meter, y `cerrar_dia` la borraba después como «rezago» sin contarla (refutación de la
    -- ronda 5, hallazgo 4). Lo que el cierre ya traía antes de esta edición no se vuelve a revisar (el rezago de un POS viejo sigue siendo un rezago).
    select x.id into v_viva
      from (select distinct e ->> 'id' as id from jsonb_array_elements(new.transacciones) e where e ->> 'id' is not null) x
      join public.ordenes o on o.id = x.id
     where not exists (select 1 from jsonb_array_elements(v_viejo) b where b ->> 'id' = x.id)
     limit 1;
    if v_viva is not null then
      raise exception 'la venta % está viva (se reabrió o se volvió a cobrar): vuelve a leer el historial del cierre', v_viva using errcode = 'RS004';
    end if;
  end if;
  -- lo que entra ahora no puede estar en OTRO cierre (lo que ya traía este cierre antes de editarlo no se vuelve a revisar)
  select x.id into v_repetida
    from (select distinct e ->> 'id' as id from jsonb_array_elements(new.transacciones) e where e ->> 'id' is not null) x
    join public.cierre_ordenes c on c.orden_id = x.id and c.cierre_id <> new.id
   where not exists (select 1 from jsonb_array_elements(v_viejo) o where o ->> 'id' = x.id)
   limit 1;
  if v_repetida is not null then
    raise exception 'la venta % ya está en otro cierre del día', v_repetida using errcode = 'RS004';
  end if;
  insert into public.cierre_ordenes (orden_id, cierre_id)
  select distinct e ->> 'id', new.id from jsonb_array_elements(new.transacciones) e where e ->> 'id' is not null
  on conflict (orden_id) do nothing;
  return null;
end;
$function$;

revoke all on function public.cierres_registrar_ordenes() from public, anon, authenticated;

drop trigger if exists trg_cierres_registrar_ordenes on public.cierres;
create trigger trg_cierres_registrar_ordenes
  after insert or update of transacciones on public.cierres
  for each row
  execute function public.cierres_registrar_ordenes();

-- Tres ayudantes, en el esquema `privado` (fuera de PostgREST). Los usan los guardias de `ordenes` y `aplicar_delta_orden`, que corren con
-- los permisos de quien llama (SECURITY INVOKER) y no pueden leer ni escribir esas tablas: por eso son SECURITY DEFINER.
create or replace function privado.orden_archivada(p_id text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select exists (select 1 from public.cierre_ordenes where orden_id = p_id);
$function$;

-- Anota esos ids como aplicados (los que ya estaban, se quedan).
create or replace function privado.deltas_marcar(p_orden_id text, p_ids jsonb)
 returns void
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  if jsonb_typeof(p_ids) = 'array' then
    -- (en orden y sin repetidos: dos filas que traigan los mismos ids no se esperan en cruz)
    insert into public.deltas_aplicados (id, orden_id)
    select s.x, p_orden_id from (select distinct x from jsonb_array_elements_text(p_ids) x where x <> '') s order by s.x
    on conflict (id) do nothing;
  end if;
end;
$function$;

-- Anota UN delta. true = era nuevo (hay que aplicarlo); false = ya estaba (no se aplica otra vez).
create or replace function privado.delta_registrar(p_id text, p_orden_id text)
 returns boolean
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_n integer;
begin
  insert into public.deltas_aplicados (id, orden_id) values (p_id, p_orden_id) on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$;

revoke all on function privado.orden_archivada(text), privado.deltas_marcar(text, jsonb), privado.delta_registrar(text, text) from public, anon, authenticated;
grant usage on schema privado to authenticated;
grant execute on function privado.orden_archivada(text), privado.deltas_marcar(text, jsonb), privado.delta_registrar(text, text) to authenticated;

-- ── 1b. Los guardias de `ordenes` ───────────────────────────
-- BEFORE INSERT OR UPDATE, por fila. SECURITY INVOKER: current_user dice quién llama (las funciones SECURITY DEFINER, el
-- dueño en el SQL Editor y service_role no son 'anon' ni 'authenticated': no se frenan). Con un upsert
-- (INSERT … ON CONFLICT DO UPDATE) corren los dos caminos: el de INSERT con la fila propuesta y, si ya existía, el de
-- UPDATE con la fila vieja y la nueva.

create or replace function public.ordenes_guardia()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
declare
  v_api boolean := current_user in ('anon', 'authenticated');
begin
  -- Los ids de los deltas cuyo efecto ya viaja en los ítems de esta fila pasan a `deltas_aplicados` (en la misma transacción que la fila: si
  -- la fila se rechaza más abajo, no quedan anotados). La columna es solo de paso.
  if new.deltas_ids is not null then
    perform privado.deltas_marcar(new.id, new.deltas_ids);
    new.deltas_ids := null;
  end if;

  if tg_op = 'INSERT' then
    -- Una venta que ya está archivada en un cierre del día no vuelve a cobrarse: se RECHAZA con error (RS005), nunca se descarta en silencio.
    -- Antes el guardia devolvía null (0 filas y ningún aviso) y eso también se comía el cobro de una cuenta que existe ABIERTA con un id archivado
    -- (en un upsert este camino corre antes del ON CONFLICT): la cuenta quedaba imposible de cobrar y `cerrar_dia` decía `hay_abiertas` para siempre.
    -- Con el error, el POS enseña «Esta cuenta ya estaba en un cierre» y suelta la subida; la cuenta abierta se libera con `reabrir_venta_de_cierre`
    -- (punto 9), que la saca del cierre. Cubre los dos casos: la fila existe (abierta) o no (una venta ya archivada y purgada que se reintenta).
    if v_api and new.estado = 'cerrada' and privado.orden_archivada(new.id) then
      raise exception 'la cuenta % ya estaba en un cierre del día: revísala con el admin', new.id
        using errcode = 'RS005', hint = 'Una venta archivada no vuelve a cobrarse. Si la cuenta está abierta, un admin la saca del cierre con «Reabrir» en el historial.';
    end if;
    -- Lo mismo con el cobro POR PARTES, POR PERSONA o el ABONO de esa cuenta (orden cerrada nueva con `parcial_de` = la cuenta): cobrar «lo seleccionado»
    -- (todo) la dejaba vacía, se liberaba la mesa y la venta quedaba contada dos veces (la del cierre viejo y la nueva; refutación de la ronda 5, hallazgo 2).
    -- Solo si la cuenta existe ABIERTA y archivada a la vez: si ya no está abierta (se cobró y se archivó mientras esa tablet estaba sin red), el cobro
    -- parcial que llega tarde es una venta real que nadie más contó y entra como siempre.
    if v_api and new.estado = 'cerrada' and new.parcial_de is not null and privado.orden_archivada(new.parcial_de)
       and exists (select 1 from public.ordenes o where o.id = new.parcial_de and o.estado = 'abierta') then
      raise exception 'la cuenta % ya estaba en un cierre del día: no se puede cobrar por partes; revísala con el admin', new.parcial_de
        using errcode = 'RS005', hint = 'Una cuenta archivada no se cobra, ni entera ni por partes. Un admin la saca del cierre con «Reabrir» en el historial.';
    end if;
    return new;
  end if;

  -- Cerrar una cuenta con lo que se vio. `version` solo viaja si el cliente la manda (el upsert del POS la manda al
  -- cobrar la mesa): una tablet atrasada cobraba con ítems viejos y pisaba lo que otra había devuelto.
  if v_api and old.estado = 'abierta' and new.estado = 'cerrada'
     and new.version is distinct from old.version then
    raise exception 'la cuenta de la orden % cambió desde que se vio: revísala antes de cobrar', old.id
      using errcode = 'RS003';
  end if;

  -- `version` sigue a los ítems (aplicar_delta_orden y deshacer_cobro ya la suben ellos mismos).
  if new.items is distinct from old.items and new.version is not distinct from old.version then
    new.version := coalesce(old.version, 0) + 1;
  end if;

  -- `parcial_de` solo lo escribe quien crea la orden.
  if v_api then
    new.parcial_de := old.parcial_de;
  end if;
  -- Una orden cerrada que se reabre o se edita ya no es «el cobro de» nada: el vínculo se corta, para todos.
  if old.estado = 'cerrada'
     and (new.estado is distinct from 'cerrada'
          or new.items is distinct from old.items
          or new.total is distinct from old.total
          or new.mesa_id is distinct from old.mesa_id) then
    new.parcial_de := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.ordenes_guardia() from public, anon, authenticated;

drop trigger if exists trg_ordenes_guardia on public.ordenes;
create trigger trg_ordenes_guardia
  before insert or update on public.ordenes
  for each row
  execute function public.ordenes_guardia();

-- El guardia de DELETE: por la API, una cuenta ABIERTA con ítems no se borra (se descarta ese borrado en silencio y los demás de la misma
-- sentencia siguen). El único borrado legítimo de una abierta es «liberar una mesa vacía». Así el cierre del día de un POS viejo, que borra
-- por id lo que su foto dice «cobrado», no se lleva la cuenta que otro dispositivo reabrió con «Deshacer».
create or replace function public.ordenes_guardia_borrar()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated')
     and old.estado = 'abierta'
     and jsonb_typeof(old.items) = 'array' and jsonb_array_length(old.items) > 0 then
    return null;
  end if;
  -- Y una venta CERRADA que ningún cierre ha archivado tampoco se borra por la API: la única purga legítima es la de un POS que acaba de guardar el
  -- cierre (esas ventas ya están en `cierre_ordenes`). Una lista de purga que se quedó pendiente en una tablet (la respuesta se perdió, o estuvo
  -- apagada) NO puede alcanzar un cobro vivo: si después otro admin reabrió esa venta con el mismo id y se volvió a cobrar, su segundo cobro está
  -- cerrado y fuera de todo cierre, y el DELETE por id de la lista vieja se lo llevaba (refutación de la ronda 5, hallazgo 1).
  if current_user in ('anon', 'authenticated')
     and old.estado = 'cerrada'
     and not privado.orden_archivada(old.id) then
    return null;
  end if;
  return old;
end;
$function$;

revoke all on function public.ordenes_guardia_borrar() from public, anon, authenticated;

drop trigger if exists trg_ordenes_guardia_borrar on public.ordenes;
create trigger trg_ordenes_guardia_borrar
  before delete on public.ordenes
  for each row
  execute function public.ordenes_guardia_borrar();

-- ── 2. Los cobros deshechos (trazabilidad) ──────────────────

create table if not exists public.deshechos (
  id bigint generated always as identity,
  orden_id text not null,
  mesa_id integer not null,
  tipo text not null,
  monto numeric not null,
  items jsonb not null default '[]'::jsonb,
  hecho_por text not null default ''::text,
  hecho_en timestamp with time zone not null default now(),
  cierre_id text,
  constraint deshechos_pkey primary key (id),
  constraint deshechos_tipo_check check ((tipo = any (array['parcial'::text, 'abono'::text, 'completo'::text])))
);

-- (la tabla ya podía existir de una corrida anterior: la columna se agrega aparte)
alter table public.deshechos add column if not exists cierre_id text;

create index if not exists deshechos_hecho_en on public.deshechos using btree (hecho_en desc);

comment on table public.deshechos is
  'Cada cobro que se deshizo con deshacer_cobro: qué orden, de qué mesa, de qué tipo, cuánto, con qué ítems, quién (correo de la sesión de Google) y cuándo (hora del servidor). Solo la escribe deshacer_cobro (y cerrar_dia le pone cierre_id); solo la lee el admin; se guarda 90 días (purgar_deshechos_viejos, al guardar un cierre del día).';
comment on column public.deshechos.cierre_id is
  'El cierre del día que incluyó este cobro deshecho (lo pone cerrar_dia, en su transacción). null = el turno sigue abierto.';

alter table public.deshechos enable row level security;

drop policy if exists deshechos_ver on public.deshechos;
create policy deshechos_ver on public.deshechos for select to authenticated
  using ((select public.mi_rol()) = 'admin');

revoke all on public.deshechos from anon, authenticated, service_role;
grant select on public.deshechos to authenticated;

-- ── 3. deshacer_cobro ───────────────────────────────────────
-- Suma los ítems de `p_extra` a los de `p_base`: la línea que ya está recibe las unidades (el resto de sus campos no se
-- toca); la que no está se agrega tal cual. Función aparte para no repetir el cuerpo en los dos caminos.

create or replace function public.deshacer_cobro_sumar(p_base jsonb, p_extra jsonb)
 returns jsonb
 language plpgsql
 immutable
 set search_path = ''
as $function$
declare
  v_items jsonb := p_base;
  it jsonb;
begin
  for it in select e from jsonb_array_elements(p_extra) e loop
    if coalesce((it ->> 'qty')::int, 0) <= 0 then
      continue;
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) x where x ->> 'id' = it ->> 'id') then
      v_items := (
        select jsonb_agg(case when x.e ->> 'id' = it ->> 'id'
                              then jsonb_set(x.e, '{qty}', to_jsonb((x.e ->> 'qty')::int + (it ->> 'qty')::int))
                              else x.e end order by x.n)
          from jsonb_array_elements(v_items) with ordinality as x(e, n)
      );
    else
      v_items := v_items || jsonb_build_array(it);
    end if;
  end loop;
  return v_items;
end;
$function$;

-- Candados, siempre en este orden: los cobros que salieron de esta orden (sus «hijos»), la orden, la mesa (solo el
-- cobro completo) y la cuenta abierta. Nadie toma esos candados al revés (el POS solo toca la abierta), así que no
-- hay interbloqueo. Dos toques a la vez: el segundo espera, y cuando obtiene el candado la cerrada ya no existe (o ya
-- no está cerrada) → no_existe / no_es_parcial.

create or replace function public.deshacer_cobro(p_orden_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  c public.ordenes;                 -- la orden cerrada: el cobro
  a public.ordenes;                 -- la cuenta abierta que lo recibe
  v_mesa public.mesas;
  v_tipo text;
  v_items jsonb;
  v_antes numeric := 0;
  v_total numeric;
  v_monto numeric;
  v_reabierta boolean := false;
  v_fusionada boolean := false;
  it jsonb;
  v_uid text;
  v_credito jsonb;
  v_n integer;
begin
  if v_rol is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_orden_id is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;

  -- Un candado de aviso a nivel de la base, el mismo que toma `cerrar_dia`: deshacer un cobro y cerrar el día se turnan (no se
  -- cruzan: uno reabría la cuenta que el otro estaba borrando). Se suelta solo al terminar la transacción.
  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));

  -- Los cobros que salieron de esta orden, primero (el mismo orden que sigue deshacer_cobro de uno de ellos: él toma
  -- su fila y después la de esta orden).
  perform 1 from public.ordenes h where h.parcial_de = p_orden_id order by h.id for update;

  select * into c from public.ordenes where id = p_orden_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  -- Ya está abierta: otra tablet acaba de deshacer este mismo cobro completo (un parcial o un abono, en cambio, se BORRAN al
  -- deshacerse: su segundo toque cae en no_existe). Es lo mismo que «ya se deshizo», no un cobro que no se pueda devolver.
  if c.estado = 'abierta' then
    return jsonb_build_object('ok', false, 'codigo', 'ya_reabierta');
  end if;
  if c.estado <> 'cerrada' or jsonb_typeof(c.items) <> 'array' or jsonb_array_length(c.items) = 0 then
    return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
  end if;
  -- Ya archivada en un cierre del día (cierre_ordenes; la purga de sus órdenes puede estar en camino): se contaría dos veces.
  if exists (select 1 from public.cierre_ordenes x where x.orden_id = c.id) then
    return jsonb_build_object('ok', false, 'codigo', 'ya_en_cierre');
  end if;

  if c.parcial_de is not null then
    -- Un cobro parcial o un abono: vuelve a la cuenta de la que salió, que tiene que seguir ABIERTA y ser de la MISMA mesa.
    select * into a from public.ordenes where id = c.parcial_de for update;
    if not found or a.estado <> 'abierta' then
      return jsonb_build_object('ok', false, 'codigo', 'cuenta_ya_cerrada');
    end if;
    if a.mesa_id <> c.mesa_id then
      return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
    end if;

    select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_antes
      from jsonb_array_elements(a.items) e;
    v_items := a.items;

    if jsonb_array_length(c.items) = 1 and (c.items -> 0 ->> 'id') like 'abono\_%'
       and (c.items -> 0 ->> 'id') not like 'abono\_recibido\_%' then
      v_tipo := 'abono';
      -- UN abono: exactamente una línea `abono_<uid>` (cantidad 1, precio > 0) y, en la cuenta, exactamente una línea
      -- `abono_recibido_<uid>` (cantidad 1, precio = −el del abono). Si no cuadra, no se devuelve nada.
      it := c.items -> 0;
      if (it ->> 'qty')::int <> 1 or (it ->> 'precio')::numeric <= 0 then
        return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
      end if;
      v_uid := substr(it ->> 'id', 7);
      select count(*) into v_n from jsonb_array_elements(a.items) e where e ->> 'id' = 'abono_recibido_' || v_uid;
      if v_n <> 1 then
        return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
      end if;
      select e into v_credito from jsonb_array_elements(a.items) e where e ->> 'id' = 'abono_recibido_' || v_uid;
      if (v_credito ->> 'qty')::int <> 1 or (v_credito ->> 'precio')::numeric <> -((it ->> 'precio')::numeric) then
        return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
      end if;
      v_items := coalesce((
        select jsonb_agg(x.e order by x.n)
          from jsonb_array_elements(a.items) with ordinality as x(e, n)
         where x.e ->> 'id' <> 'abono_recibido_' || v_uid
      ), '[]'::jsonb);
    else
      v_tipo := 'parcial';
      -- Un cobro por ítems o unidades: solo líneas de producto (nunca de abono), con cantidad y precio sensatos.
      if exists (select 1 from jsonb_array_elements(c.items) e
                  where (e ->> 'id') like 'abono\_%'
                     or coalesce((e ->> 'qty')::int, 0) <= 0
                     or coalesce((e ->> 'precio')::numeric, -1) < 0) then
        return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
      end if;
      v_items := public.deshacer_cobro_sumar(a.items, c.items);
    end if;
  else
    -- El cobro COMPLETO de una mesa. Un abono suelto (anterior a esta migración, sin cuenta) no se reabre como cuenta:
    -- la mesa pagaría dos veces. Sus abonos recibidos (`abono_recibido_…`) sí viajan con la cuenta.
    v_tipo := 'completo';
    if exists (select 1 from jsonb_array_elements(c.items) e
                where (e ->> 'id') like 'abono\_%' and (e ->> 'id') not like 'abono\_recibido\_%') then
      return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
    end if;

    select * into v_mesa from public.mesas where id = c.mesa_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'codigo', 'no_es_parcial');
    end if;
    if not v_mesa.activa then
      return jsonb_build_object('ok', false, 'codigo', 'mesa_inactiva');
    end if;

    select * into a from public.ordenes where mesa_id = c.mesa_id and estado = 'abierta' for update;
    if found then
      -- La mesa ya tiene otra cuenta abierta: los ítems pasan a ella.
      v_fusionada := true;
      select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_antes
        from jsonb_array_elements(a.items) e;
      v_items := public.deshacer_cobro_sumar(a.items, c.items);
    else
      v_reabierta := true;
    end if;
  end if;

  if v_reabierta then
    select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_total
      from jsonb_array_elements(c.items) e;
    v_monto := v_total;
    begin
      update public.ordenes
         set estado = 'abierta',
             cerrada_en = null,
             total = v_total,
             version = coalesce(c.version, 0) + 1,
             updated_at = now()
       where id = c.id
      returning * into a;
      update public.mesas set estado = 'ocupada' where id = c.mesa_id;
    exception when unique_violation then
      -- Otra tablet abrió una cuenta en esa mesa libre justo ahora (ux_ordenes_una_abierta_por_mesa): ya no es «mesa libre».
      -- El sub-bloque deshizo el UPDATE; se hace lo mismo que cuando la mesa ya tenía cuenta: los ítems pasan a ella.
      select * into a from public.ordenes where mesa_id = c.mesa_id and estado = 'abierta' for update;
      if not found then
        return jsonb_build_object('ok', false, 'codigo', 'mesa_ocupada');
      end if;
      v_reabierta := false;
      v_fusionada := true;
      select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_antes
        from jsonb_array_elements(a.items) e;
      v_items := public.deshacer_cobro_sumar(a.items, c.items);
    end;
  end if;
  if not v_reabierta then
    select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0)
      into v_total
      from jsonb_array_elements(v_items) e;
    v_monto := v_total - v_antes;
    update public.ordenes
       set items = v_items,
           total = v_total,
           version = coalesce(a.version, 0) + 1,
           updated_at = now()
     where id = a.id
    returning * into a;
    -- Los abonos que habían salido de la cuenta cerrada ahora los recibe esta otra: siguen siendo devolvibles.
    if v_fusionada then
      update public.ordenes set parcial_de = a.id where parcial_de = c.id;
    end if;
    delete from public.ordenes where id = c.id;
  end if;

  insert into public.deshechos (orden_id, mesa_id, tipo, monto, items, hecho_por)
  values (c.id, c.mesa_id, v_tipo, v_monto, c.items, coalesce((select public.mi_correo()), ''));

  return jsonb_build_object('ok', true, 'tipo', v_tipo, 'total_abierta', a.total, 'orden_id', a.id,
                            'mesa_id', a.mesa_id, 'monto', v_monto, 'version', a.version,
                            'reabierta', v_reabierta, 'fusionada', v_fusionada);
end;
$function$;

comment on function public.deshacer_cobro(text) is
  'Deshace un cobro del turno abierto, sin ventana de tiempo (admin y mesero): un parcial o un abono vuelven a la cuenta abierta de la misma mesa; un cobro completo reabre la mesa o pasa a la cuenta que ya tiene. Borra la orden cerrada (o la reabre), recalcula, y deja su fila en public.deshechos.';

revoke all on function public.deshacer_cobro_sumar(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.deshacer_cobro(text) from public, anon, service_role;
grant execute on function public.deshacer_cobro(text) to authenticated;

-- ── 3a. aplicar_delta_orden, idempotente ───────────────────
-- La función de 20261002140000 con un parámetro más (`p_delta_id`, por defecto null). Con id: se anota PRIMERO en `deltas_aplicados` y, si ya
-- estaba, no aplica nada y devuelve la orden tal cual; si no, bloquea la orden y aplica, todo en esta misma transacción (un fallo más abajo
-- deshace también la anotación). Sin id (el POS de la ola B): igual que antes. Corre como quien llama (SECURITY INVOKER): al MESERO una orden cerrada ni se le
-- muestra en el `SELECT … FOR UPDATE`, y la anotación va por un ayudante de `privado`. El resto del cuerpo es el de la base, tal cual.
-- Se reemplaza la de siete parámetros (si no, PostgREST ve dos candidatas: PGRST203): las llamadas del POS de hoy (seis o siete
-- argumentos) siguen funcionando porque el nuevo tiene valor por defecto.
drop function if exists public.aplicar_delta_orden(text, text, text, numeric, integer, text, boolean);

create or replace function public.aplicar_delta_orden(p_orden_id text, p_item_id text, p_nombre text, p_precio numeric, p_delta integer, p_nota text default ''::text, p_solo_abierta boolean default true, p_delta_id text default null::text)
 returns public.ordenes
 language plpgsql
 set search_path = public
as $function$
declare
  o      ordenes;
  nuevos jsonb;
  existe boolean;
  v_nuevo boolean := true;
begin
  -- Con id, PRIMERO se anota y después se bloquea la orden: es el mismo orden en que la fila cerrada con `deltas_ids` llega (el guardia anota antes
  -- de que el upsert alcance la fila que ya existe). Al revés —bloquear y luego anotar— se enredaba (40P01) con esa fila. Dos reintentos del
  -- mismo delta a la vez se turnan en el índice de `deltas_aplicados`: el segundo espera y ve el id anotado.
  if p_delta_id is not null and p_delta_id <> '' then
    v_nuevo := privado.delta_registrar(p_delta_id, p_orden_id);
  end if;
  if not v_nuevo then
    -- Ya estaba anotado: no se aplica nada y se devuelve la orden tal cual (también cerrada: ya se aplicó, no es un error).
    select * into o from ordenes where id = p_orden_id;
    if not found then
      raise exception 'orden % no existe', p_orden_id;
    end if;
    return o;
  end if;
  select * into o from ordenes where id = p_orden_id for update;
  if not found then
    raise exception 'orden % no existe', p_orden_id;
  end if;
  if p_solo_abierta and o.estado <> 'abierta' then
    raise exception 'orden % está cerrada', p_orden_id using errcode = 'RS001';
  end if;

  select exists(
    select 1 from jsonb_array_elements(o.items) e where e->>'id' = p_item_id
  ) into existe;

  if existe then
    -- Ajusta qty; conserva el resto de campos del ítem (nombre, precio, nota).
    select coalesce(jsonb_agg(x), '[]'::jsonb) into nuevos
    from (
      select case when e->>'id' = p_item_id
                  then jsonb_set(e, '{qty}', to_jsonb(greatest(0, (e->>'qty')::int + p_delta)))
                  else e end as x
      from jsonb_array_elements(o.items) e
    ) s
    where (x->>'qty')::int > 0;
  else
    nuevos := case when p_delta > 0
      then o.items || jsonb_build_array(
             jsonb_build_object('id', p_item_id, 'nombre', p_nombre,
                                'precio', p_precio, 'qty', p_delta, 'nota', coalesce(p_nota, '')))
      else o.items end;
  end if;

  update ordenes
     set items = nuevos,
         total = (select coalesce(sum((e->>'precio')::numeric * (e->>'qty')::int), 0)
                  from jsonb_array_elements(nuevos) e),
         version = coalesce(o.version, 0) + 1,
         updated_at = now()
   where id = p_orden_id
  returning * into o;

  return o;
end $function$;

revoke all on function public.aplicar_delta_orden(text, text, text, numeric, integer, text, boolean, text) from public, anon;
grant execute on function public.aplicar_delta_orden(text, text, text, numeric, integer, text, boolean, text) to authenticated, service_role;

-- ── 3b. cerrar_dia: el cierre del día lo decide la base ─────
-- Ver el punto 6 de la cabecera. Candados, siempre en este orden (el mismo que deshacer_cobro): el candado de aviso, y las órdenes por
-- id. Un POS viejo que borra por id sin pasar por aquí no cambia esto: solo puede esperar a que alguien suelte una fila.

drop function if exists public.cerrar_dia(text, timestamp with time zone, numeric, jsonb, jsonb);

create or replace function public.cerrar_dia(p_id text, p_esperado jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  v_ids text[];
  v_ya text[];
  v_abiertas integer[];
  v_enlazadas integer[];
  v_n integer;
  v_total numeric;
  v_resumen jsonb;
  v_esp_ids text[];
  v_trans jsonb;
  v_fecha timestamp with time zone := now();
  v_borradas integer := 0;
  v_deshechos jsonb;
  v_cierre public.cierres;
begin
  if v_rol is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_id is null or p_id = '' or p_esperado is null or jsonb_typeof(p_esperado) <> 'object' then
    return jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));

  -- El mismo cierre otra vez (se perdió la respuesta): el que ya se guardó, tal cual. No vuelve a mirar nada.
  select * into v_cierre from public.cierres where id = p_id;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('orden_id', d.orden_id, 'mesa_id', d.mesa_id, 'tipo', d.tipo, 'monto', d.monto,
                                                 'hecho_por', d.hecho_por, 'hecho_en', d.hecho_en) order by d.hecho_en), '[]'::jsonb)
      into v_deshechos from public.deshechos d where d.cierre_id = p_id;
    return jsonb_build_object('ok', true, 'repetido', true, 'n', v_cierre.total_ordenes, 'total', v_cierre.total_ventas, 'borradas', 0,
                              'cierre', jsonb_build_object('id', v_cierre.id, 'fecha', v_cierre.fecha, 'total', v_cierre.total_ventas,
                                                           'n', v_cierre.total_ordenes, 'ordenes', v_cierre.transacciones),
                              'deshechos', v_deshechos);
  end if;

  -- Las ventas por archivar: TODAS las cerradas que no están en ningún cierre, con candado y en orden (nadie las cambia mientras se
  -- revisan). Y las cerradas que ya estaban archivadas (rezagos de una purga que no terminó): no se cuentan, y se borran al cerrar.
  perform 1 from public.ordenes where estado = 'cerrada' order by id for update;
  select coalesce(array_agg(o.id order by o.id) filter (where not exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id)), '{}'::text[]),
         coalesce(array_agg(o.id order by o.id) filter (where exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id)), '{}'::text[])
    into v_ids, v_ya
    from public.ordenes o where o.estado = 'cerrada';

  select count(*), coalesce(sum(o.total), 0) into v_n, v_total from public.ordenes o where o.id = any(v_ids);
  v_resumen := jsonb_build_object(
    'n', v_n, 'total', v_total, 'ids', to_jsonb(v_ids),
    'abonos_por_metodo', coalesce((
      select jsonb_object_agg(m.metodo, m.suma)
        from (select coalesce(nullif(e ->> 'nota', ''), 'sin_metodo') as metodo,
                     sum((e ->> 'precio')::numeric * (e ->> 'qty')::int) as suma
                from public.ordenes o
               cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) e
               where o.id = any(v_ids) and (e ->> 'id') like 'abono\_%' and (e ->> 'id') not like 'abono\_recibido\_%'
               group by 1) m), '{}'::jsonb));

  select array_agg(distinct o.mesa_id order by o.mesa_id) into v_abiertas from public.ordenes o where o.estado = 'abierta';
  if v_abiertas is not null then
    -- `en_cierre`: de esas mesas, las que además tienen su cuenta registrada en un cierre del día (cierre_ordenes). Esas no se pueden cobrar (RS005)
    -- hasta que un admin las saque del cierre con `reabrir_venta_de_cierre`: el POS lo dice en vez de pedir «cóbralas» a quien no puede.
    select array_agg(distinct o.mesa_id order by o.mesa_id) into v_enlazadas from public.ordenes o
     where o.estado = 'abierta' and exists (select 1 from public.cierre_ordenes c where c.orden_id = o.id);
    return jsonb_build_object('ok', false, 'codigo', 'hay_abiertas', 'abiertas', to_jsonb(v_abiertas),
                              'en_cierre', coalesce(to_jsonb(v_enlazadas), '[]'::jsonb), 'resumen', v_resumen);
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

  -- Todo cuadra: el cierre, el borrado y los deshechos del turno, juntos.
  select jsonb_agg(jsonb_build_object('id', o.id, 'mesaId', o.mesa_id, 'estado', 'cerrada', 'items', o.items, 'total', o.total,
                                      'abiertaEn', o.abierta_en, 'cerradaEn', o.cerrada_en, 'version', o.version, 'parcialDe', o.parcial_de)
                   order by o.cerrada_en, o.id)
    into v_trans from public.ordenes o where o.id = any(v_ids);

  insert into public.cierres (id, fecha, total_ventas, total_ordenes, transacciones)
  values (p_id, v_fecha, v_total, v_n, v_trans);

  delete from public.ordenes where id = any(v_ids) or id = any(v_ya);
  get diagnostics v_borradas = row_count;

  delete from public.deltas_aplicados d where not exists (select 1 from public.ordenes o where o.id = d.orden_id);

  with marcados as (
    update public.deshechos set cierre_id = p_id where cierre_id is null returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('orden_id', m.orden_id, 'mesa_id', m.mesa_id, 'tipo', m.tipo, 'monto', m.monto,
                                               'hecho_por', m.hecho_por, 'hecho_en', m.hecho_en) order by m.hecho_en), '[]'::jsonb)
    into v_deshechos from marcados m;

  return jsonb_build_object('ok', true, 'repetido', false, 'n', v_n, 'total', v_total, 'borradas', v_borradas,
                            'cierre', jsonb_build_object('id', p_id, 'fecha', v_fecha, 'total', v_total, 'n', v_n, 'ordenes', v_trans),
                            'deshechos', v_deshechos);
end;
$function$;

comment on function public.cerrar_dia(text, jsonb) is
  'El cierre del día, solo para el admin y en una transacción: toma TODAS las ventas cerradas que no están en ningún cierre, rechaza si hay cuentas abiertas o si lo que el POS espera (cuántas, cuánto, cuáles) no es lo que hay, guarda el cierre, borra lo que archiva y marca los deshechos del turno. Nunca borra una cuenta abierta.';

revoke all on function public.cerrar_dia(text, jsonb) from public, anon, service_role;
grant execute on function public.cerrar_dia(text, jsonb) to authenticated;

-- ── 3c. reabrir_venta_de_cierre: reabrir una venta de un cierre pasado, en una sola transacción ──
-- «Historial → Editar transacción → Reabrir en mesa» (solo admin). Antes el POS subía la orden ABIERTA y DESPUÉS editaba el cierre para sacarla: si la
-- segunda subida no llegaba (sin red, un error), la cuenta quedaba abierta con su id todavía en `cierre_ordenes` y el guardia de `ordenes` descartaba su
-- cobro (ronda 4, hallazgo 1). Ahora es UNA transacción en la base: toma el candado de aviso (el mismo de `cerrar_dia` y `deshacer_cobro`), saca la venta
-- del cierre (se recalculan su total y su cuenta de ventas; el disparador de `cierres` la libera de `cierre_ordenes`) y deja la cuenta ABIERTA en la mesa
-- pedida con los ítems que el cierre guardó. Todo o nada: si algo falla, el cierre queda como estaba. El POS la exige con red (no hay reabrir sin base).
-- Si la cuenta YA existe abierta con ese id (quedó «archivada y abierta»: un POS viejo cerró con una foto vieja, o una edición vieja de un cierre la volvió
-- a meter), se la deja tal cual y solo se la saca del cierre: así queda cobrable (`adoptada: true`). Es la salida limpia del RS005. Si existe CERRADA (un rezago:
-- la purga de un POS viejo no terminó), se reabre esa misma fila en la mesa pedida.
-- Devuelve jsonb:
--   {ok: true, adoptada, orden: {la fila de ordenes}, cierre: {id, fecha, total, n, ordenes}}
--   {ok: false, codigo} con codigo =
--     no_autorizado       solo el admin
--     invalido            falta el cierre, la venta o la mesa
--     no_existe           ese cierre no existe
--     no_esta_en_cierre   la venta ya no está en ese cierre (otro admin la reabrió o la quitó)
--     es_abono            un abono no se reabre como cuenta (la mesa pagaría dos veces); se corrige editándolo
--     mesa_inexistente / mesa_inactiva / mesa_ocupada   la mesa pedida no sirve (la cuenta que ya existe abierta no la necesita)

create or replace function public.reabrir_venta_de_cierre(p_cierre_id text, p_orden_id text, p_mesa_id integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_rol text := (select public.mi_rol());
  k public.cierres;
  o public.ordenes;
  v_mesa public.mesas;
  v_venta jsonb;
  v_items jsonb;
  v_total numeric;
  v_resto jsonb;
  v_version integer;
  v_abierta_en timestamp with time zone;
  v_adoptada boolean := false;
  v_existia boolean;
begin
  if v_rol is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if p_cierre_id is null or p_cierre_id = '' or p_orden_id is null or p_orden_id = '' or p_mesa_id is null then
    return jsonb_build_object('ok', false, 'codigo', 'invalido');
  end if;

  perform pg_advisory_xact_lock(hashtext('resplandor.cobros'));

  select * into k from public.cierres where id = p_cierre_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;

  select e into v_venta
    from jsonb_array_elements(case when jsonb_typeof(k.transacciones) = 'array' then k.transacciones else '[]'::jsonb end) e
   where e ->> 'id' = p_orden_id
   limit 1;
  if v_venta is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_esta_en_cierre');
  end if;

  -- Los ítems como los guardó el cierre (los de datos viejos traen `cantidad` en vez de `qty`).
  v_items := coalesce((
    select jsonb_agg(x.e || jsonb_build_object('qty', case when x.e ->> 'qty' ~ '^[0-9]+$' then (x.e ->> 'qty')::int
                                                          when x.e ->> 'cantidad' ~ '^[0-9]+$' then (x.e ->> 'cantidad')::int
                                                          else 1 end) order by x.n)
      from jsonb_array_elements(case when jsonb_typeof(v_venta -> 'items') = 'array' then v_venta -> 'items' else '[]'::jsonb end) with ordinality as x(e, n)
     where jsonb_typeof(x.e) = 'object'
  ), '[]'::jsonb);
  if jsonb_array_length(v_items) = 1 and (v_items -> 0 ->> 'id') like 'abono\_%' and (v_items -> 0 ->> 'id') not like 'abono\_recibido\_%' then
    return jsonb_build_object('ok', false, 'codigo', 'es_abono');
  end if;

  select * into o from public.ordenes where id = p_orden_id for update;
  v_existia := found;
  if v_existia and o.estado = 'abierta' then
    -- Ya existe abierta con ese id: es la cuenta que quedó «archivada y abierta»; se la deja como está y solo se saca del cierre.
    v_adoptada := true;
  else
    select * into v_mesa from public.mesas where id = p_mesa_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'codigo', 'mesa_inexistente');
    end if;
    if not v_mesa.activa then
      return jsonb_build_object('ok', false, 'codigo', 'mesa_inactiva');
    end if;
    if exists (select 1 from public.ordenes x where x.mesa_id = p_mesa_id and x.estado = 'abierta') then
      return jsonb_build_object('ok', false, 'codigo', 'mesa_ocupada');
    end if;

    begin
      if v_existia then
        -- Un rezago: la venta sigue en `ordenes` CERRADA aunque su cierre ya la archivó (la purga de un POS viejo no terminó). Se reabre ESA fila.
        update public.ordenes o1
           set estado = 'abierta', mesa_id = p_mesa_id, cerrada_en = null, parcial_de = null, version = coalesce(o.version, 0) + 1, updated_at = now()
         where o1.id = p_orden_id
        returning * into o;
      else
        select coalesce(sum((e ->> 'precio')::numeric * (e ->> 'qty')::int), 0) into v_total from jsonb_array_elements(v_items) e;
        v_version := case when v_venta ->> 'version' ~ '^[0-9]+$' then (v_venta ->> 'version')::int else 0 end + 1;
        begin
          v_abierta_en := (v_venta ->> 'abiertaEn')::timestamp with time zone;
        exception when others then
          v_abierta_en := null;
        end;
        insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en, cerrada_en, version)
        values (p_orden_id, p_mesa_id, 'abierta', v_items, v_total, coalesce(v_abierta_en, now()), null, v_version)
        returning * into o;
      end if;
    exception when unique_violation then
      -- Otra tablet abrió esa mesa justo ahora (ux_ordenes_una_abierta_por_mesa). El sub-bloque deshizo el cambio; el cierre no se ha tocado.
      return jsonb_build_object('ok', false, 'codigo', 'mesa_ocupada');
    end;
    update public.mesas m1 set estado = 'ocupada' where m1.id = p_mesa_id;
  end if;

  -- La venta sale del cierre (queda libre en `cierre_ordenes` por el disparador de `cierres`), con el total y la cuenta recalculados.
  v_resto := coalesce((
    select jsonb_agg(x.e order by x.n)
      from jsonb_array_elements(case when jsonb_typeof(k.transacciones) = 'array' then k.transacciones else '[]'::jsonb end) with ordinality as x(e, n)
     where x.e ->> 'id' is distinct from p_orden_id
  ), '[]'::jsonb);
  update public.cierres c1
     set transacciones = v_resto,
         total_ventas = coalesce((select sum(case when y.e ->> 'total' ~ '^-?[0-9]+(\.[0-9]+)?$' then (y.e ->> 'total')::numeric else 0 end)
                                    from jsonb_array_elements(v_resto) y(e)), 0),
         total_ordenes = jsonb_array_length(v_resto)
   where c1.id = p_cierre_id
  returning * into k;

  return jsonb_build_object('ok', true, 'adoptada', v_adoptada, 'orden', to_jsonb(o) - 'deltas_ids',
                            'cierre', jsonb_build_object('id', k.id, 'fecha', k.fecha, 'total', k.total_ventas, 'n', k.total_ordenes, 'ordenes', k.transacciones));
end;
$function$;

comment on function public.reabrir_venta_de_cierre(text, text, integer) is
  'Reabrir una venta de un cierre pasado en una sola transacción (solo admin): la saca del cierre (recalcula su total) y deja la cuenta abierta en la mesa pedida; si la cuenta ya existe abierta con ese id, solo la saca del cierre. Todo o nada.';

revoke all on function public.reabrir_venta_de_cierre(text, text, integer) from public, anon, service_role;
grant execute on function public.reabrir_venta_de_cierre(text, text, integer) to authenticated;

-- ── 4. Los registros de `deshechos` viven 90 días ───────────
-- Disparador de SENTENCIA al guardar un cierre del día (el POS lo hace con upsert: INSERT … ON CONFLICT). La función corre
-- como su dueño: nadie gana permiso de DELETE sobre `deshechos`.

create or replace function public.purgar_deshechos_viejos()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  delete from public.deshechos where hecho_en < now() - interval '90 days';
  return null;
end;
$function$;

revoke all on function public.purgar_deshechos_viejos() from public, anon, authenticated;

drop trigger if exists trg_cierres_purga_deshechos on public.cierres;
create trigger trg_cierres_purga_deshechos
  after insert on public.cierres
  for each statement
  execute function public.purgar_deshechos_viejos();

-- ── 5. D28: las alertas viejas se borran solas ──────────────
-- Disparadores de SENTENCIA (una sola pasada por operación, sin importar cuántas filas toque). La función corre
-- como su dueño (SECURITY DEFINER): ni el POS ni service_role ganan permiso de DELETE sobre `alertas`.

create or replace function public.purgar_alertas_viejas()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  delete from public.alertas
   where estado <> 'pendiente'
     and atendida_en < now() - interval '1 day';
  return null;
end;
$function$;

revoke all on function public.purgar_alertas_viejas() from public, anon, authenticated;

drop trigger if exists trg_alertas_nueva_purga on public.alertas;
create trigger trg_alertas_nueva_purga
  after insert on public.alertas
  for each statement
  execute function public.purgar_alertas_viejas();

drop trigger if exists trg_alertas_resuelta_purga on public.alertas;
create trigger trg_alertas_resuelta_purga
  after update of estado on public.alertas
  for each statement
  execute function public.purgar_alertas_viejas();

drop trigger if exists trg_cierres_purga_alertas on public.cierres;
create trigger trg_cierres_purga_alertas
  after insert on public.cierres
  for each statement
  execute function public.purgar_alertas_viejas();
