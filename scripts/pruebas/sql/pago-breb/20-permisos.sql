-- P: quién lee y quién cambia la llave y el QR de Bre-B (`ajustes`), con el rol de la API de verdad.
-- Quiénes: admin (y admin2) · mesero, mesero2 (personal) · ajena (Google sin fila) · pendiente (fila pendiente) · eliminado (baja lógica)
--          · correo (cuenta por correo con el MISMO correo del admin) · anon · service_role (la llave de servicio de la Edge Function).
select t.partida_pago();
update public.ajustes set pago_breb_visible = true, pago_breb_llave = '@PruebaFicticia', pago_breb_qr = t.vv('qr_ok') where id = 1;

-- ── P1. quién lee ───────────────────────────────────────────
select t.como('admin');
select t.igual('P1 el admin lee la llave, el QR y el interruptor',
  $q$select pago_breb_visible::text || '/' || pago_breb_llave || '/' || (pago_breb_qr = t.vv('qr_ok'))::text from public.ajustes where id = 1$q$, 'true/@PruebaFicticia/true');
select t.como('admin2');
select t.igual('P1 el otro admin también', 'select pago_breb_llave from public.ajustes where id = 1', '@PruebaFicticia');
select t.como('mesero');
select t.igual('P1 el mesero (personal aprobado) lee la llave, el QR y el interruptor',
  $q$select pago_breb_visible::text || '/' || pago_breb_llave || '/' || (pago_breb_qr = t.vv('qr_ok'))::text from public.ajustes where id = 1$q$, 'true/@PruebaFicticia/true');
select t.como('mesero2');
select t.igual('P1 el otro mesero también', 'select pago_breb_llave from public.ajustes where id = 1', '@PruebaFicticia');
select t.como('ajena');
select t.igual('P1 la cuenta ajena no ve la fila (0 filas, sin error)', 'select count(*)::text from public.ajustes', '0');
select t.como('pendiente');
select t.igual('P1 la cuenta pendiente no ve la fila', 'select count(*)::text from public.ajustes', '0');
select t.como('eliminado');
select t.igual('P1 el eliminado no ve la fila', 'select count(*)::text from public.ajustes', '0');
select t.como('correo');
select t.igual('P1 la cuenta por correo (aunque tenga el correo del admin) no ve la fila', 'select count(*)::text from public.ajustes', '0');
select t.como('anon');
select t.falla('P1 anon NO lee ajustes (ni la tabla ni la llave: sin permiso)', 'select pago_breb_llave from public.ajustes', '^42501.*permission denied for table ajustes');
select t.falla('P1 anon NO lee el QR', 'select pago_breb_qr from public.ajustes', '^42501');
select t.falla('P1 anon NO lee el interruptor', 'select pago_breb_visible from public.ajustes', '^42501');
select t.falla('P1 anon NO lee ni siquiera con «*»', 'select * from public.ajustes', '^42501');
select t.falla('P1 anon NO lee la fila contando', 'select count(*) from public.ajustes', '^42501');
select t.fuera();

-- ── P2. quién cambia ────────────────────────────────────────
select t.como('mesero');
select t.sale('P2 el mesero intenta cambiar la llave (sin error: la policy lo deja en 0 filas)', $q$update public.ajustes set pago_breb_llave = '@LaDelMesero' where id = 1$q$);
select t.sale('P2 el mesero intenta apagar el pago (0 filas)', $q$update public.ajustes set pago_breb_visible = false where id = 1$q$);
select t.sale('P2 el mesero intenta cambiar el QR (0 filas)', format($q$update public.ajustes set pago_breb_qr = %L where id = 1$q$, t.vv('qr_ok2')));
select t.fuera();
select t.igual('P2 y nada cambió', $q$select pago_breb_llave || '/' || pago_breb_visible::text || '/' || (pago_breb_qr = t.vv('qr_ok'))::text from public.ajustes where id = 1$q$, '@PruebaFicticia/true/true');
do $$
declare q text; n integer;
begin
  foreach q in array array['ajena', 'pendiente', 'eliminado', 'correo'] loop
    perform t.como(q);
    update public.ajustes set pago_breb_llave = '@Intrusa' where id = 1;
    get diagnostics n = row_count;
    perform t.fuera();
    perform t.ok('P2 ' || q || ' no cambia la llave (0 filas)', n = 0, n::text);
  end loop;
end $$;
select t.como('anon');
select t.falla('P2 anon NO cambia la llave (sin permiso)', $q$update public.ajustes set pago_breb_llave = '@Intrusa' where id = 1$q$, '^42501');
select t.falla('P2 anon NO enciende el pago', $q$update public.ajustes set pago_breb_visible = true where id = 1$q$, '^42501');
select t.fuera();
select t.igual('P2 y ninguna llave intrusa quedó guardada', 'select pago_breb_llave from public.ajustes where id = 1', '@PruebaFicticia');

select t.como('admin2');
select t.sale('P2 el admin SÍ cambia la llave', $q$update public.ajustes set pago_breb_llave = '@OtraFicticia9' where id = 1$q$);
select t.fuera();
select t.igual('P2 el cambio del admin quedó, sellado con su correo', $q$select pago_breb_llave || '/' || actualizado_por from public.ajustes where id = 1$q$, '@OtraFicticia9/admin2@resplandor.test');
select t.como('admin');
select t.falla('P2 nadie inserta una segunda fila de ajustes (ni el admin: sin INSERT)', $q$insert into public.ajustes (id) values (2)$q$, '^42501');
select t.falla('P2 nadie borra ajustes (ni el admin)', 'delete from public.ajustes', '^42501');
select t.fuera();

-- ── P3. la Edge Function (service_role): SOLO las cuatro columnas, y solo leer ──
select t.como_servicio();
select t.igual('P3 service_role lee el interruptor y la llave filtrando por id (el id también está permitido)',
  $q$select pago_breb_visible::text || '/' || pago_breb_llave from public.ajustes where id = 1$q$, 'true/@OtraFicticia9');
select t.igual('P3 y el QR', $q$select (pago_breb_qr = t.vv('qr_ok'))::text from public.ajustes where id = 1$q$, 'true');
select t.igual('P3 y exactamente la lectura de la función cuenta: tres columnas, fila 1',
  $q$select count(*)::text from (select pago_breb_visible, pago_breb_llave, pago_breb_qr from public.ajustes where id = 1) x$q$, '1');
select t.falla('P3 NO lee el pie del ticket', 'select ticket_pie from public.ajustes where id = 1', '^42501');
select t.falla('P3 NO lee la URL del QR del ticket', 'select ticket_qr_url from public.ajustes where id = 1', '^42501');
select t.falla('P3 NO lee si el ticket lleva QR', 'select ticket_qr_visible from public.ajustes where id = 1', '^42501');
select t.falla('P3 NO lee quién editó por última vez', 'select actualizado_por from public.ajustes where id = 1', '^42501');
select t.falla('P3 NO lee cuándo se editó', 'select actualizado_en from public.ajustes where id = 1', '^42501');
select t.falla('P3 NO lee con «*» (por eso la función pide las columnas por nombre)', 'select * from public.ajustes', '^42501');
select t.falla('P3 NO filtra por una columna que no le dieron', $q$select pago_breb_qr from public.ajustes where ticket_pie = 'x'$q$, '^42501');
select t.falla('P3 NO cambia nada (update)', $q$update public.ajustes set pago_breb_visible = false where id = 1$q$, '^42501');
select t.falla('P3 NO inserta', 'insert into public.ajustes (id) values (2)', '^42501');
select t.falla('P3 NO borra', 'delete from public.ajustes', '^42501');
select t.falla('P3 NO llama a privado.emv_crc_ok (privado no es suyo)', $q$select privado.emv_crc_ok('x')$q$, '^42501.*permission denied for schema privado');
select t.fuera();

-- ── P4. el catálogo ─────────────────────────────────────────
select t.igual('P4 anon: ninguna columna de ajustes, ni leer ni escribir',
  $q$select count(*)::text from information_schema.columns c, unnest(array['select', 'update', 'insert']) as u(p)
      where c.table_schema = 'public' and c.table_name = 'ajustes' and has_column_privilege('anon', 'public.ajustes', c.column_name, u.p)$q$, '0');
select t.igual('P4 authenticated: lee y cambia las tres columnas nuevas (la policy decide quién)',
  $q$select count(*)::text from unnest(array['pago_breb_visible', 'pago_breb_llave', 'pago_breb_qr']) as cc(col), unnest(array['select', 'update']) as u(p)
      where has_column_privilege('authenticated', 'public.ajustes', cc.col, u.p)$q$, '6');
select t.igual('P4 authenticated: no inserta ni borra',
  $q$select (has_table_privilege('authenticated', 'public.ajustes', 'insert') or has_table_privilege('authenticated', 'public.ajustes', 'delete'))::text$q$, 'false');
select t.igual('P4 service_role: SELECT de id y las tres columnas, y de ninguna más',
  $q$select string_agg(c.column_name, ',' order by c.column_name) from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'ajustes' and has_column_privilege('service_role', 'public.ajustes', c.column_name, 'select')$q$,
  'id,pago_breb_llave,pago_breb_qr,pago_breb_visible');
select t.igual('P4 service_role: no tiene SELECT de la tabla entera (solo de columnas)', $q$select has_table_privilege('service_role', 'public.ajustes', 'select')::text$q$, 'false');
select t.igual('P4 service_role: ninguna columna con UPDATE, INSERT ni REFERENCES',
  $q$select count(*)::text from information_schema.columns c, unnest(array['update', 'insert', 'references']) as u(p)
      where c.table_schema = 'public' and c.table_name = 'ajustes' and has_column_privilege('service_role', 'public.ajustes', c.column_name, u.p)$q$, '0');
select t.igual('P4 service_role: ni DELETE ni TRUNCATE', $q$select (has_table_privilege('service_role', 'public.ajustes', 'delete') or has_table_privilege('service_role', 'public.ajustes', 'truncate'))::text$q$, 'false');
select t.igual('P4 privado.emv_crc_ok: solo authenticated la ejecuta (ni PUBLIC, ni anon, ni service_role)',
  $q$select (select count(*) from pg_proc p, aclexplode(p.proacl) a where p.oid = 'privado.emv_crc_ok(text)'::regprocedure and a.grantee = 0)::text
      || '/' || has_function_privilege('anon', 'privado.emv_crc_ok(text)', 'execute')::text
      || '/' || has_function_privilege('service_role', 'privado.emv_crc_ok(text)', 'execute')::text
      || '/' || has_function_privilege('authenticated', 'privado.emv_crc_ok(text)', 'execute')::text$q$, '0/false/false/true');
select t.igual('P4 anon no tiene ni USAGE del esquema privado', $q$select has_schema_privilege('anon', 'privado', 'usage')::text$q$, 'false');
select t.igual('P4 las policies de ajustes son las de siempre (esta migración no agrega ni cambia ninguna)',
  $q$select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'ajustes'$q$, 'ajustes_editar,ajustes_ver,solo_personal');
select t.igual('P4 la RLS de ajustes sigue encendida', $q$select relrowsecurity::text from pg_class where oid = 'public.ajustes'::regclass$q$, 'true');
select t.igual('P4 ajustes NO está en la publicación de Realtime (la llave y el QR no viajan por el canal en vivo)',
  $q$select count(*)::text from pg_publication_tables where schemaname = 'public' and tablename = 'ajustes'$q$, '0');
select t.igual('P4 la vista pública de la carta no depende de ajustes (la llave y el QR no se cuelan por ahí)',
  $q$select count(*)::text from pg_depend d join pg_rewrite r on r.oid = d.objid
      where r.ev_class = 'public.carta_publica'::regclass and d.refobjid = 'public.ajustes'::regclass$q$, '0');
select t.igual('P4 y ninguna columna de la vista pública habla de pago, llave o QR',
  $q$select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'carta_publica' and column_name ~* '(pago|llave|qr|breb)'$q$, '0');
select t.igual('P4 ninguna otra tabla ni vista de public ganó columnas pago_breb_*',
  $q$select count(*)::text from information_schema.columns where table_schema = 'public' and column_name like 'pago_breb_%' and table_name <> 'ajustes'$q$, '0');
