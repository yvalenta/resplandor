-- ════════════════════════════════════════════════════════════
-- Resplandor — los PERMISOS POR ROL (3 de 3 de «roles y alertas»)
-- (pedido de Yonatan, 2026-09-30; SDD v0.3 §02.2, §02.3 y §04.5)
--
--   1. 20261002120000_personal_y_compuerta.sql      quién entra al POS (sale primero).
--   2. 20261002130000_alertas.sql                   las alertas de «pedir la cuenta».
--   3. 20261002140000_permisos_por_rol.sql       ← ESTA.
--
-- Qué hace
--   Reemplaza las policies PERMISIVAS «authenticated using (true)» de las tablas
--   del POS por las de rol: lo que puede hacer cada quien depende de `mi_rol()`
--   (admin | mesero). La compuerta `solo_personal` de la primera migración sigue
--   en pie y se SUMA: sin fila activa en `personal` no hay nada.
--
-- Necesita la primera (mi_rol(), personal): si falta, se niega a correr SIN
-- cambiar nada. NO necesita la de alertas.
--
-- Permisos (RLS; el GRANT es el mismo de la base, lo que cambia es QUIÉN). Dos
-- decisiones de Yonatan (2026-09-30) marcadas con ★:
--
--   tabla / acción               | admin | mesero | otra cuenta Google | correo | anon
--   -----------------------------+-------+--------+--------------------+--------+------
--   productos   ver              |  sí   |  sí    |  no                |  no    |  no
--   productos   crear/editar     |  sí   |  sí ★  |  no                |  no    |  no
--   productos   borrar           |  sí   |  no    |  no                |  no    |  no
--   mesas       ver, editar      |  sí   |  sí    |  no                |  no    |  no
--   mesas       crear (nueva)    |  sí   |  no ¹  |  no                |  no    |  no
--   ordenes     ver, crear       |  sí   |  sí    |  no                |  no    |  no
--   ordenes     editar           |  sí   | solo abierta ²  |  no       |  no    |  no
--   ordenes     borrar           |  sí   | solo abierta y vacía ²  | no  |  no    |  no
--   cierres     ver              |  sí   |  sí ★ (solo lectura) |  no  |  no    |  no
--   cierres     crear/editar     |  sí   |  no ★  |  no                |  no    |  no
--   menus       ver              |  sí   |  sí    |  sí ³              |  sí ³  |  sí
--   menus       crear/editar/borrar | sí |  no    |  no                |  no    |  no
--   elecciones_menu, reacciones_menu ver | público (sin cambios)        |        |
--   sugerencias_plato ver        |  sí   |  no    |  no                |  no    |  no
--
--   ★ 1. El mesero SÍ crea y edita productos del catálogo (INSERT y UPDATE en
--        `productos`, también el upsert del POS); borrarlos sigue siendo del admin.
--   ★ 2. El mesero VE las ventas del día (las órdenes cerradas, que ya veía) y el
--        historial de cierres, en solo lectura (SELECT en `cierres`). Escribir en
--        `cierres` (el cierre del día, y editar o reabrir uno pasado) es solo del
--        admin. «Caja» por ahora = admin (decisión abierta para Yonatan).
--   ¹ El POS guarda las mesas con upsert (INSERT … ON CONFLICT DO UPDATE) y
--     Postgres revisa la policy de INSERT aunque la fila ya exista. Por eso el
--     mesero tiene un INSERT que solo pasa si el id YA existe (equivale a
--     «solo editar»): no puede crear mesas nuevas, ni renumerar una existente
--     (UPDATE de `id`: lo frena el disparador trg_mesas_id_solo_admin).
--   ² Una orden CERRADA (una venta) solo la toca el admin: «Editar» y «Reabrir»
--     una transacción, y la purga del cierre del día. El mesero edita y cierra
--     órdenes ABIERTAS (cobrar es un UPDATE de abierta → cerrada, y la fila vieja
--     está abierta) y solo borra una abierta y vacía (liberar mesa). Sin esto un
--     mesero podía reabrir una venta cerrada, vaciarla y borrarla (refutación
--     2026-09-30, hallazgo 1). Aun así un mesero puede vaciar una orden ABIERTA y
--     liberar la mesa: eso solo se controla con auditoría (decisión abierta).
--   ³ Lectura pública a propósito (menu.html, con o sin sesión): sus escrituras
--     exigen `mi_rol() = 'admin'`.
--
-- ORDEN: esta va DESPUÉS de publicar el POS que ya le esconde al mesero lo que sigue.
-- La base rechaza lo de abajo, pero lo rechaza en SILENCIO (0 filas, sin error) y el
-- POS de hoy no lo sabe: el cambio queda solo en esa tablet hasta la siguiente
-- sincronización. Antes de aplicarla, el POS tiene que ocultar según
-- mi_rol() = 'mesero':
--   · cierre del día (cierres y purga de ordenes);
--   · historial de cierres: se VE en solo lectura, pero «Editar», «Reabrir» y
--     «Eliminar» se ocultan (pos.html: 3825, 3829, 4337 → recalcularYSubirCierre,
--     2791). Ojo: el «Reabrir en mesa» de un cierre hace INSERT de una orden abierta
--     en `ordenes` (pasa) y luego UPDATE del cierre (lo rechaza la RLS): la misma
--     venta queda en el cierre viejo y en `ordenes`, y el próximo cierre del día la
--     cuenta dos veces;
--   · «Editar» (3739) y «Reabrir» (2689) de las órdenes CERRADAS del turno (la base
--     no deja al mesero tocar una venta cerrada, ver ²);
--   · catálogo: SOLO el botón de eliminar (eliminarProducto, 2854: el DELETE da 0
--     filas sin error y el producto «desaparece» solo en esa tablet hasta que
--     recarga). Crear y editar productos el mesero SÍ los puede (★ 1);
--   · programación del menú semanal;
--   · sugerencias de plato.
-- El mesero sigue pudiendo cobrar (abierta → cerrada), pero ya no reintentar el cobro
-- de una orden que otro dispositivo cerró (RLS).
--
-- REVERSA (menos de 1 minuto; vuelve a las policies permisivas de la base y deja a
-- `solo_personal` en pie: todo el personal con acceso completo, como antes):
--
--   begin;
--   drop trigger if exists trg_mesas_id_solo_admin on public.mesas;
--   do $$ declare r record; begin
--     for r in select schemaname, tablename, policyname from pg_policies
--              where schemaname = 'public' and policyname in (
--                'productos_ver','productos_crear','productos_editar','productos_borrar',
--                'mesas_ver','mesas_crear','mesas_editar',
--                'ordenes_ver','ordenes_crear','ordenes_editar','ordenes_borrar',
--                'cierres_ver','cierres_crear','cierres_editar',
--                'menus_crear','menus_editar','menus_borrar','sugerencias_ver_admin')
--     loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
--   end $$;
--   create policy "authenticated full access productos" on public.productos for all to authenticated using (true) with check (true);
--   create policy "authenticated full access mesas" on public.mesas for all to authenticated using (true) with check (true);
--   create policy "authenticated full access ordenes" on public.ordenes for all to authenticated using (true) with check (true);
--   create policy "authenticated full access cierres" on public.cierres for all to authenticated using (true) with check (true);
--   create policy menus_admin on public.menus for all to authenticated using (true) with check (true);
--   create policy sug_admin on public.sugerencias_plato for all to authenticated using (true) with check (true);
--   drop function if exists public.mesas_id_solo_admin();
--   drop function if exists public.mesa_existe(integer);
--   commit;
--
-- Idempotente donde se puede. Correr en Supabase → SQL Editor (lo aplica Yonatan:
-- aparca).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisito: la compuerta de personal ───────────────────

do $$
begin
  if to_regclass('public.personal') is null or to_regprocedure('public.mi_rol()') is null then
    raise exception 'Falta 20261002120000_personal_y_compuerta.sql (personal y mi_rol()): aplicala primero, con el alta de admins. No se cambió nada.';
  end if;
  if not exists (select 1 from public.personal p where p.rol = 'admin' and p.activo) then
    raise exception 'Sin un admin activo en public.personal estas policies dejarían a todos sin poder editar. No se cambió nada.';
  end if;
end $$;

-- ── 1. Fuera las permisivas «authenticated using (true)» de la base ──

drop policy if exists "authenticated full access productos" on public.productos;
drop policy if exists "authenticated full access mesas" on public.mesas;
drop policy if exists "authenticated full access ordenes" on public.ordenes;
drop policy if exists "authenticated full access cierres" on public.cierres;
drop policy if exists menus_admin on public.menus;
drop policy if exists sug_admin on public.sugerencias_plato;

-- ── 2. Policies por rol ─────────────────────────────────────

-- productos: el personal ve el catálogo; el mesero lo crea y lo edita (★ 1: también
-- el upsert del POS, que es INSERT … ON CONFLICT DO UPDATE); borrarlo es del admin.
drop policy if exists productos_ver on public.productos;
drop policy if exists productos_crear on public.productos;
drop policy if exists productos_editar on public.productos;
drop policy if exists productos_borrar on public.productos;
create policy productos_ver on public.productos for select to authenticated
  using ((select public.mi_rol()) is not null);
create policy productos_crear on public.productos for insert to authenticated
  with check ((select public.mi_rol()) in ('admin', 'mesero'));
create policy productos_editar on public.productos for update to authenticated
  using ((select public.mi_rol()) in ('admin', 'mesero'))
  with check ((select public.mi_rol()) in ('admin', 'mesero'));
create policy productos_borrar on public.productos for delete to authenticated
  using ((select public.mi_rol()) = 'admin');

-- mesas: todo el personal las ve y las edita (estado, token); crear mesas nuevas
-- es del admin. El INSERT del mesero solo pasa si el id ya existe (ver ¹ arriba).
-- Va por una función porque una policy de `mesas` que consulta `mesas` directo
-- da «infinite recursion detected in policy» (probado en Postgres 17).
create or replace function public.mesa_existe(p_id integer)
 returns boolean
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select public.mi_rol() is not null
     and exists (select 1 from public.mesas m where m.id = p_id)
$function$;

drop policy if exists mesas_ver on public.mesas;
drop policy if exists mesas_crear on public.mesas;
drop policy if exists mesas_editar on public.mesas;
create policy mesas_ver on public.mesas for select to authenticated
  using ((select public.mi_rol()) is not null);
create policy mesas_crear on public.mesas for insert to authenticated
  with check (
    (select public.mi_rol()) = 'admin'
    or ((select public.mi_rol()) = 'mesero' and public.mesa_existe(id))
  );
create policy mesas_editar on public.mesas for update to authenticated
  using ((select public.mi_rol()) is not null) with check ((select public.mi_rol()) is not null);

-- Renumerar una mesa (UPDATE de `id`) sería crear una mesa nueva por la puerta de
-- atrás: el INSERT del mesero solo pasa si el id ya existe, pero
-- `update mesas set id = 99, capacidad = 40 where id = 4` pasaba la policy de
-- UPDATE (refutación 2026-09-30, hallazgo 5; solo con mesas sin órdenes ni
-- alertas que la referencien). Un permiso por columna no sirve: el upsert del POS
-- reescribe `id`. Lo frena un disparador: solo el admin cambia el número de una
-- mesa. Quien no es sesión de la API (el dueño, service_role) no se toca.
create or replace function public.mesas_id_solo_admin()
 returns trigger
 language plpgsql
 set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated')
     and (select public.mi_rol()) is distinct from 'admin' then
    raise exception 'solo un admin cambia el número de una mesa'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_mesas_id_solo_admin on public.mesas;
create trigger trg_mesas_id_solo_admin
  before update of id on public.mesas
  for each row
  when (old.id is distinct from new.id)
  execute function public.mesas_id_solo_admin();

-- ordenes: el personal las ve y las crea. Editar: el admin todo; el mesero solo
-- órdenes ABIERTAS (USING mira la fila vieja): cobrar y cerrar es un UPDATE de
-- abierta → cerrada y pasa, pero una venta CERRADA ya no la toca (ni «Editar» ni
-- «Reabrir»: sin esto podía reabrirla, vaciarla y borrarla). aplicar_delta_orden
-- corre como quien llama, así que el mismo filtro lo alcanza. Borrar: el admin
-- todo; el mesero solo una orden abierta y vacía (liberar mesa sin cobrar).
-- Las ventas del día (cerradas) las VE todo el personal (★ 2).
drop policy if exists ordenes_ver on public.ordenes;
drop policy if exists ordenes_crear on public.ordenes;
drop policy if exists ordenes_editar on public.ordenes;
drop policy if exists ordenes_borrar on public.ordenes;
create policy ordenes_ver on public.ordenes for select to authenticated
  using ((select public.mi_rol()) is not null);
create policy ordenes_crear on public.ordenes for insert to authenticated
  with check ((select public.mi_rol()) is not null);
create policy ordenes_editar on public.ordenes for update to authenticated
  using (
    (select public.mi_rol()) = 'admin'
    or ((select public.mi_rol()) = 'mesero' and estado = 'abierta')
  )
  with check ((select public.mi_rol()) is not null);
create policy ordenes_borrar on public.ordenes for delete to authenticated
  using (
    (select public.mi_rol()) = 'admin'
    or ((select public.mi_rol()) = 'mesero' and estado = 'abierta' and items = '[]'::jsonb)
  );

-- cierres: todo el personal ve el historial, en solo lectura (★ 2); el cierre del
-- día y la edición de uno pasado los escribe solo el admin (el POS usa upsert:
-- INSERT y UPDATE). Sin policy de DELETE: sin GRANT, como hoy.
drop policy if exists cierres_ver on public.cierres;
drop policy if exists cierres_crear on public.cierres;
drop policy if exists cierres_editar on public.cierres;
create policy cierres_ver on public.cierres for select to authenticated
  using ((select public.mi_rol()) is not null);
create policy cierres_crear on public.cierres for insert to authenticated
  with check ((select public.mi_rol()) = 'admin');
create policy cierres_editar on public.cierres for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');

-- menus: la lectura pública (menus_select_publico, de la base) se queda; la
-- programación semanal es del admin.
drop policy if exists menus_crear on public.menus;
drop policy if exists menus_editar on public.menus;
drop policy if exists menus_borrar on public.menus;
create policy menus_crear on public.menus for insert to authenticated
  with check ((select public.mi_rol()) = 'admin');
create policy menus_editar on public.menus for update to authenticated
  using ((select public.mi_rol()) = 'admin') with check ((select public.mi_rol()) = 'admin');
create policy menus_borrar on public.menus for delete to authenticated
  using ((select public.mi_rol()) = 'admin');

-- sugerencias_plato: solo las lee el admin (entran por la Edge Function votar).
drop policy if exists sugerencias_ver_admin on public.sugerencias_plato;
create policy sugerencias_ver_admin on public.sugerencias_plato for select to authenticated
  using ((select public.mi_rol()) = 'admin');

-- ── 3. Quién puede ejecutar qué ─────────────────────────────

revoke all on function public.mesa_existe(integer) from public, anon;
revoke all on function public.mesas_id_solo_admin() from public, anon, authenticated;
grant execute on function public.mesa_existe(integer) to authenticated;
