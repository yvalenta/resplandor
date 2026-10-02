-- C: los CHECK de 20261003150000_pago_breb.sql: la llave, el contenido del QR y el CRC, el «completo», y que lo demás de `ajustes` siga igual.
-- Todo se prueba como admin (el único que puede escribir) con el rol de la API.
select t.partida_pago();

-- ── C0. lo que dejó la migración ────────────────────────────
select t.igual('C0 la fila única de ajustes nació con el pago apagado y vacío',
  $q$select pago_breb_visible::text || '/' || coalesce(pago_breb_llave, '-') || '/' || coalesce(pago_breb_qr, '-') from public.ajustes where id = 1$q$, 'false/-/-');
select t.igual('C0 «pago_breb_visible» es boolean NOT NULL con default false',
  $q$select data_type || '/' || is_nullable || '/' || column_default from information_schema.columns where table_schema = 'public' and table_name = 'ajustes' and column_name = 'pago_breb_visible'$q$, 'boolean/NO/false');
select t.igual('C0 «pago_breb_llave» es text y admite null',
  $q$select data_type || '/' || is_nullable || '/' || coalesce(column_default, '-') from information_schema.columns where table_schema = 'public' and table_name = 'ajustes' and column_name = 'pago_breb_llave'$q$, 'text/YES/-');
select t.igual('C0 «pago_breb_qr» es text y admite null',
  $q$select data_type || '/' || is_nullable || '/' || coalesce(column_default, '-') from information_schema.columns where table_schema = 'public' and table_name = 'ajustes' and column_name = 'pago_breb_qr'$q$, 'text/YES/-');
select t.igual('C0 los ocho CHECK nuevos existen, validados',
  $q$select string_agg(conname, ',' order by conname) from pg_constraint where conrelid = 'public.ajustes'::regclass and contype = 'c' and conname like 'ajustes_pago_breb_%' and convalidated$q$,
  'ajustes_pago_breb_completo,ajustes_pago_breb_llave_forma,ajustes_pago_breb_llave_segura,ajustes_pago_breb_qr_ascii,ajustes_pago_breb_qr_crc,ajustes_pago_breb_qr_inicio,ajustes_pago_breb_qr_largo,ajustes_pago_breb_qr_llave');
select t.igual('C0 ningún CHECK de ajustes quedó sin validar',
  $q$select count(*)::text from pg_constraint where conrelid = 'public.ajustes'::regclass and not convalidated$q$, '0');
select t.igual('C0 los CHECK de antes siguen (una sola fila, URL del QR, caracteres de la URL, largo del pie)',
  $q$select string_agg(conname, ',' order by conname) from pg_constraint where conrelid = 'public.ajustes'::regclass and contype = 'c' and conname not like 'ajustes_pago_breb_%'$q$,
  'ajustes_ticket_pie_check,ajustes_ticket_qr_url_check,ajustes_ticket_qr_url_segura,ajustes_una_sola_fila');

-- ── C1. la llave ────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select * from t.llaves_buenas order by n loop
    perform t.ok('C1 llave aceptada: ' || r.valor, t.llave_acepta('admin', r.valor));
  end loop;
  for r in select * from t.llaves_malas order by n loop
    perform t.ok('C1 llave RECHAZADA (' || r.nombre || ')', not t.llave_acepta('admin', r.valor), r.valor);
  end loop;
end $$;
select t.igual('C1 y la que quedó guardada es la última buena, sin que una mala haya pisado nada',
  'select pago_breb_llave from public.ajustes where id = 1', (select valor from t.llaves_buenas order by n desc limit 1));
select t.como('admin');
select t.falla('C1 la llave mala no sale con un error cualquiera: es el CHECK de la forma (23514)',
  $q$update public.ajustes set pago_breb_llave = 'hola mundo' where id = 1$q$, '^23514.*ajustes_pago_breb_llave_forma');
select t.falla('C1 una comilla simple en la llave: rechazada (23514)',
  $q$update public.ajustes set pago_breb_llave = '@a''b' where id = 1$q$, '^23514.*ajustes_pago_breb_llave_');
select t.sale('C1 la llave se puede borrar (null) mientras «visible» esté apagado', $q$update public.ajustes set pago_breb_llave = null where id = 1$q$);
select t.fuera();

-- ── C2. el contenido del QR ─────────────────────────────────
select t.igual('C2 el QR ficticio válido se guarda tal cual', $q$select t.qr_resultado('admin', t.vv('qr_ok'))$q$, 'ok');
select t.igual('C2 y queda guardado EXACTAMENTE (ni recortado ni cambiado)',
  $q$select (pago_breb_qr = t.vv('qr_ok'))::text from public.ajustes where id = 1$q$, 'true');
select t.igual('C2 borde de abajo: 20 caracteres con el CRC bueno se aceptan', $q$select t.qr_resultado('admin', t.vv('qr_20'))$q$, 'ok');
select t.igual('C2 borde de arriba: 700 caracteres con el CRC bueno se aceptan', $q$select t.qr_resultado('admin', t.vv('qr_700'))$q$, 'ok');
select t.igual('C2 el otro QR ficticio válido también', $q$select t.qr_resultado('admin', t.vv('qr_ok2'))$q$, 'ok');
select t.igual('C2 el CRC en minúsculas cuadra y se acepta (así lo escriben algunos lectores)', $q$select t.qr_resultado('admin', t.vv('qr_minusculas'))$q$, 'ok');
select t.igual('C2 el QR se puede borrar (null) mientras «visible» esté apagado', $q$select t.qr_resultado('admin', null)$q$, 'ok');
do $$
declare r record; v text;
begin
  for r in select * from t.qr_malos order by n loop
    v := t.qr_resultado('admin', r.valor);
    perform t.ok('C2 QR RECHAZADO por ' || r.restriccion || ': ' || r.nombre, v = r.restriccion, 'salió «' || coalesce(v, 'null') || '»');
  end loop;
end $$;
select t.igual('C2 tras tanto rechazo, el QR guardado sigue siendo null (ninguno pisó nada)', 'select coalesce(pago_breb_qr, ''null'') from public.ajustes where id = 1', 'null');

-- ── C3. el CRC calculado por la función, directo ────────────
select t.fuera();
select t.igual('C3 emv_crc_ok(QR ficticio) = true', $q$select privado.emv_crc_ok(t.vv('qr_ok'))::text$q$, 'true');
select t.igual('C3 emv_crc_ok(null) = false (no null, no error)', 'select privado.emv_crc_ok(null)::text', 'false');
select t.igual('C3 emv_crc_ok(cadena vacía) = false', $q$select privado.emv_crc_ok('')::text$q$, 'false');
select t.igual('C3 emv_crc_ok(basura) = false, sin error', $q$select privado.emv_crc_ok('ñññññññññññññññ')::text$q$, 'false');
select t.igual('C3 emv_crc_ok con un carácter cambiado = false', $q$select privado.emv_crc_ok(overlay(t.vv('qr_ok') placing 'Z' from 40 for 1))::text$q$, 'false');
select t.igual('C3 emv_crc_ok es inmutable y de search_path vacío (se puede usar en un CHECK)',
  $q$select provolatile::text || '/' || coalesce(array_to_string(proconfig, ','), '-') from pg_proc where oid = 'privado.emv_crc_ok(text)'::regprocedure$q$, 'i/search_path=""');
select t.igual('C3 y no es SECURITY DEFINER (no lee nada: no necesita más permisos que quien llama)',
  $q$select prosecdef::text from pg_proc where oid = 'privado.emv_crc_ok(text)'::regprocedure$q$, 'false');

-- ── C3b. privado.emv_llave: la llave a la que cobra el QR, leída campo por campo ──
select t.igual('C3b emv_llave(QR ficticio) = la llave del campo 26/04', $q$select privado.emv_llave(t.vv('qr_ok'))$q$, '@PruebaFicticia');
select t.igual('C3b emv_llave(el otro QR ficticio) = su propia llave', $q$select privado.emv_llave(t.vv('qr_ok2'))$q$, '@OtraFicticia9');
select t.igual('C3b emv_llave(null) = null', 'select coalesce(privado.emv_llave(null), ''null'')', 'null');
select t.igual('C3b emv_llave(cadena vacía) = null', $q$select coalesce(privado.emv_llave(''), 'null')$q$, 'null');
select t.igual('C3b emv_llave(basura) = null, sin error', $q$select coalesce(privado.emv_llave('ñññññññññññññññ'), 'null')$q$, 'null');
select t.igual('C3b emv_llave de más de 1024 caracteres = null (no calcula de más)', $q$select coalesce(privado.emv_llave(repeat('0', 1025)), 'null')$q$, 'null');
select t.igual('C3b emv_llave es inmutable y de search_path vacío (se puede usar en un CHECK)',
  $q$select provolatile::text || '/' || coalesce(array_to_string(proconfig, ','), '-') from pg_proc where oid = 'privado.emv_llave(text)'::regprocedure$q$, 'i/search_path=""');
select t.igual('C3b y no es SECURITY DEFINER', $q$select prosecdef::text from pg_proc where oid = 'privado.emv_llave(text)'::regprocedure$q$, 'false');
do $$
declare r record;
begin
  for r in select * from t.llave_qr_vectores order by n loop
    perform t.ok('C3b emv_llave de «' || r.nombre || '»', coalesce(privado.emv_llave(r.qr), 'null') = r.esperada, coalesce(privado.emv_llave(r.qr), 'null'));
  end loop;
end $$;

-- ── C4. «visible» solo con llave y QR ───────────────────────
select t.como('admin');
select t.falla('C4 encender «visible» sin llave ni QR: rechazado por el CHECK «completo»',
  $q$update public.ajustes set pago_breb_visible = true where id = 1$q$, '^23514.*ajustes_pago_breb_completo');
select t.falla('C4 encender «visible» con la llave pero sin QR: rechazado',
  $q$update public.ajustes set pago_breb_visible = true, pago_breb_llave = '@PruebaFicticia' where id = 1$q$, '^23514.*ajustes_pago_breb_completo');
select t.falla('C4 encender «visible» con el QR pero sin llave: rechazado',
  format($q$update public.ajustes set pago_breb_visible = true, pago_breb_qr = %L where id = 1$q$, t.vv('qr_ok')), '^23514.*ajustes_pago_breb_completo');
select t.sale('C4 llave, QR y «visible» en UNA sola sentencia: aceptado',
  format($q$update public.ajustes set pago_breb_visible = true, pago_breb_llave = '@PruebaFicticia', pago_breb_qr = %L where id = 1$q$, t.vv('qr_ok')));
select t.falla('C4 con «visible» encendido no se puede borrar la llave',
  $q$update public.ajustes set pago_breb_llave = null where id = 1$q$, '^23514.*ajustes_pago_breb_completo');
select t.falla('C4 con «visible» encendido no se puede borrar el QR',
  $q$update public.ajustes set pago_breb_qr = null where id = 1$q$, '^23514.*ajustes_pago_breb_completo');
select t.sale('C4 apagar «visible» y borrar los dos datos en una sentencia: aceptado',
  $q$update public.ajustes set pago_breb_visible = false, pago_breb_llave = null, pago_breb_qr = null where id = 1$q$);
select t.sale('C4 apagado, se puede guardar solo la llave (el admin carga el QR después)', $q$update public.ajustes set pago_breb_llave = '@PruebaFicticia' where id = 1$q$);
select t.fuera();
select t.igual('C4 el interruptor tiene que ser true o false de verdad (null no entra: NOT NULL)',
  $q$select t.intenta('update public.ajustes set pago_breb_visible = null where id = 1')$q$, '23502: null value in column "pago_breb_visible" of relation "ajustes" violates not-null constraint');

-- ── C5. lo demás de `ajustes` sigue igual ───────────────────
select t.partida_pago();
select t.como('admin');
select t.sale('C5 el admin sigue pudiendo cambiar el pie del ticket', $q$update public.ajustes set ticket_pie = 'Hasta pronto' where id = 1$q$);
select t.fuera();
select t.igual('C5 el sello de quién editó sigue funcionando (el correo del admin, por la base)', 'select actualizado_por from public.ajustes where id = 1', 'admin@resplandor.test');
select t.igual('C5 el pie nuevo quedó y el pago sigue apagado', $q$select ticket_pie || '/' || pago_breb_visible::text from public.ajustes where id = 1$q$, 'Hasta pronto/false');
select t.como('admin');
select t.falla('C5 el CHECK de la URL del QR del ticket sigue rechazando lo malo',
  $q$update public.ajustes set ticket_qr_url = 'http://sin-https.test/' where id = 1$q$, '^23514.*ajustes_ticket_qr_url_check');
select t.falla('C5 el CHECK del largo del pie sigue vigente',
  $q$update public.ajustes set ticket_pie = repeat('x', 121) where id = 1$q$, '^23514.*ajustes_ticket_pie_check');
select t.fuera();
select t.igual('C5 y una sola fila, siempre (id = 1)', $q$select t.intenta('insert into public.ajustes (id) values (2)')$q$, '23514: new row for relation "ajustes" violates check constraint "ajustes_una_sola_fila"');

-- ── C6. la llave que se muestra es la que cobra el QR (ajustes_pago_breb_qr_llave) ──
select t.partida_pago();
select t.como('admin');
select t.sale('C6 llave y QR del MISMO código, en una sola sentencia: aceptado',
  format($q$update public.ajustes set pago_breb_llave = '@PruebaFicticia', pago_breb_qr = %L where id = 1$q$, t.vv('qr_ok')));
select t.falla('C6 cambiar solo la llave a otra: rechazado por qr_llave (23514)',
  $q$update public.ajustes set pago_breb_llave = '@OtraFicticia9' where id = 1$q$, '^23514.*ajustes_pago_breb_qr_llave');
select t.falla('C6 cambiar solo el QR por el de otra llave: rechazado por qr_llave (23514)',
  format($q$update public.ajustes set pago_breb_qr = %L where id = 1$q$, t.vv('qr_ok2')), '^23514.*ajustes_pago_breb_qr_llave');
select t.sale('C6 cambiar los dos juntos al otro par: aceptado',
  format($q$update public.ajustes set pago_breb_llave = '@OtraFicticia9', pago_breb_qr = %L where id = 1$q$, t.vv('qr_ok2')));
select t.sale('C6 con el pago apagado y solo la llave (sin QR) no hay nada que cruzar: aceptado',
  $q$update public.ajustes set pago_breb_qr = null, pago_breb_llave = '@LoQueSea' where id = 1$q$);
select t.sale('C6 con solo el QR (sin llave) tampoco: aceptado',
  format($q$update public.ajustes set pago_breb_llave = null, pago_breb_qr = %L where id = 1$q$, t.vv('qr_ok')));
select t.falla('C6 con solo el QR guardado, poner una llave que no es la suya: rechazado',
  $q$update public.ajustes set pago_breb_llave = '@NoEsLaSuya' where id = 1$q$, '^23514.*ajustes_pago_breb_qr_llave');
select t.sale('C6 y poner la suya: aceptado', $q$update public.ajustes set pago_breb_llave = '@PruebaFicticia' where id = 1$q$);
select t.falla('C6 no se distingue por mayúsculas a medias: «@pruebaficticia» no es «@PruebaFicticia» (coincidencia exacta)',
  $q$update public.ajustes set pago_breb_llave = '@pruebaficticia' where id = 1$q$, '^23514.*ajustes_pago_breb_qr_llave');
do $$
declare r record; v text;
begin
  for r in select * from t.llave_qr_vectores where llave_a_guardar is not null order by n loop
    perform t.partida_pago();
    perform t.como('admin');
    begin
      execute format('update public.ajustes set pago_breb_llave = %L, pago_breb_qr = %L where id = 1', r.llave_a_guardar, r.qr);
      v := 'ok';
    exception when check_violation then
      get stacked diagnostics v = constraint_name;
    end;
    perform t.fuera();
    perform t.ok('C6 «' || r.nombre || '» guardando la llave ' || r.llave_a_guardar || ': ' || r.guardar_esperado, v = r.guardar_esperado, v);
  end loop;
end $$;
select t.partida_pago();
select t.como('admin');
select t.falla('C6 una llave mala con un QR que cobra a otra se reporta por su forma (llave_forma), no por el cruce: se ve el motivo de verdad',
  format($q$update public.ajustes set pago_breb_llave = 'hola mundo', pago_breb_qr = %L where id = 1$q$, t.vv('qr_ok')), '^23514.*ajustes_pago_breb_llave_forma');
select t.falla('C6 y un QR de CRC malo con una llave que no cuadra se reporta por el CRC (qr_crc), no por el cruce',
  format($q$update public.ajustes set pago_breb_llave = '@NoEsLaSuya', pago_breb_qr = %L where id = 1$q$, (select valor from t.qr_malos where restriccion = 'ajustes_pago_breb_qr_crc' order by n limit 1)), '^23514.*ajustes_pago_breb_qr_crc');
select t.fuera();
select t.partida_pago();
