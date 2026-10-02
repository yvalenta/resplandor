-- S: la señal por Realtime al insertar, y el mantenimiento (caducar, rendirse, purgar).
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('cocina', 'Cocina');
select t.nueva_impresora('vieja', 'Vieja');
select t.como('admin');
select t.sale('S0 desactivar la vieja', format($q$select public.impresora_activar('%s', false)$q$, t.pid('vieja')));
select t.fuera();
truncate realtime.llamadas_prueba restart identity;

-- ── S1. a quién avisa ───────────────────────────────────────
select t.fuera();
select t.trabajo('caja', 'a la caja');
select t.igual_sup('S1 un trabajo dirigido a la caja emite UNA señal, al tópico de SU token', 'select t.senales()', t.topico(t.tok('caja')));
select t.igual_sup('S1 evento «trabajo», payload vacío, canal público', $q$select evento || '/' || payload::text || '/' || privado::text from realtime.llamadas_prueba$q$, 'trabajo/{}/false');
truncate realtime.llamadas_prueba restart identity;
select t.trabajo('cocina', 'a la cocina');
select t.igual_sup('S1 uno a la cocina avisa a la cocina, no a la caja', 'select t.senales()', t.topico(t.tok('cocina')));
truncate realtime.llamadas_prueba restart identity;
select t.trabajo(null, 'a cualquiera');
select t.igual_sup('S1 uno «de cualquiera» avisa a TODAS las activas (caja y cocina) y a ninguna desactivada',
  $q$select string_agg(topico, ',' order by topico) from realtime.llamadas_prueba$q$,
  (select string_agg(x, ',' order by x) from unnest(array[t.topico(t.tok('caja')), t.topico(t.tok('cocina'))]) x));
select t.igual_sup('S1 (son dos señales)', 'select count(*)::text from realtime.llamadas_prueba', '2');
truncate realtime.llamadas_prueba restart identity;
select t.trabajo('vieja', 'a la desactivada');
select t.igual_sup('S1 uno dirigido a una desactivada no avisa a nadie (y se guarda igual)', $q$select (select count(*) from realtime.llamadas_prueba)::text || '/' || (select count(*) from public.impresiones where impresora_id = t.pid('vieja'))::text$q$, '0/1');
truncate realtime.llamadas_prueba restart identity;
insert into public.impresiones (impresora_id, tipo, contenido, estado, error) values (t.pid('caja'), 'cuenta', t.docj(), 'error', 'ya fallido');
select t.igual_sup('S1 una fila que no nace pendiente no emite señal', 'select count(*)::text from realtime.llamadas_prueba', '0');
truncate realtime.llamadas_prueba restart identity;
insert into public.impresiones (impresora_id, tipo, contenido) select t.pid('caja'), 'cuenta', t.docj() from generate_series(1, 3);
select t.igual_sup('S1 tres trabajos en un INSERT emiten tres señales (una por fila)', 'select count(*)::text from realtime.llamadas_prueba', '3');

-- el POS (mesero) encola: la señal sale aunque el mesero no pueda leer `impresoras` (el trigger corre con permisos de dueño)
truncate realtime.llamadas_prueba restart identity;
select t.como('mesero');
select t.sale('S1 el mesero encola un trabajo dirigido a la caja', format($q$insert into public.impresiones (impresora_id, tipo, contenido) values ('%s', 'cuenta', t.docj())$q$, t.pid('caja')));
select t.fuera();
select t.igual_sup('S1 y la señal sale al tópico de la caja', 'select t.senales()', t.topico(t.tok('caja')));
truncate realtime.llamadas_prueba restart identity;
select t.como('mesero');
select t.sale('S1 el mesero encola uno sin destino', $q$insert into public.impresiones (tipo, contenido) values ('ticket', t.docj())$q$);
select t.fuera();
select t.igual_sup('S1 avisa a las dos activas', 'select count(*)::text from realtime.llamadas_prueba', '2');

-- un trabajo que el tope rechaza no deja señal (se deshace con la sentencia)
truncate realtime.llamadas_prueba restart identity;
select t.como('mesero2');
select t.falla('S1 31 de un golpe: RS030', $q$insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 31)$q$, '^RS030');
select t.fuera();
select t.igual_sup('S1 y no queda ninguna señal de los rechazados', 'select count(*)::text from realtime.llamadas_prueba', '0');

-- la rotación: la señal pasa al tópico del token nuevo
select t.como('admin');
select t.g('nuevo', (public.impresora_rotar(t.pid('caja'))) ->> 'token');
select t.fuera();
truncate realtime.llamadas_prueba restart identity;
select t.trabajo('caja', 'tras rotar');
select t.igual_sup('S1 tras rotar, la señal va al tópico del token NUEVO', 'select t.senales()', t.topico(t.vv('nuevo')));
select t.igual_sup('S1 y no al del viejo', $q$select (t.senales() like '%' || t.topico(t.tok('caja')) || '%')::text$q$, 'false');

-- el vector compartido con el agente: sha256 de 48 ceros
select t.igual_sup('S1 el vector: el tópico del token de 48 ceros es el mismo que el de la cuenta en vivo',
  $q$select privado.topico_impresora(privado.hash_token(repeat('0', 48)))$q$, 'impresora:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a');
select t.igual_sup('S1 el tópico de un token real coincide con el sha256 del núcleo de Postgres (otra función, no pgcrypto)',
  $q$select (privado.topico_impresora(privado.hash_token(t.vv('nuevo'))) = t.topico(t.vv('nuevo')))::text$q$, 'true');
select t.igual_sup('S1 el tópico es «impresora:» + el token_hash de la fila (64 hex)',
  $q$select (privado.topico_impresora(token_hash) = t.topico(t.vv('nuevo')) and token_hash ~ '^[0-9a-f]{64}$')::text from public.impresoras where id = t.pid('caja')$q$, 'true');
select t.igual_sup('S1 un token de menos de 16 caracteres no se hashea (null)', $q$select coalesce(privado.hash_token('corto'), 'null')$q$, 'null');
select t.igual_sup('S1 uno de más de 256 tampoco', $q$select coalesce(privado.hash_token(repeat('x', 257)), 'null')$q$, 'null');
select t.igual_sup('S1 de 16 y de 256 sí', $q$select (privado.hash_token(repeat('x', 16)) is not null and privado.hash_token(repeat('x', 256)) is not null)::text$q$, 'true');

-- ── S2. si la señal falla, el trabajo se guarda igual ───────
delete from public.impresiones;
truncate realtime.llamadas_prueba restart identity;
select set_config('prueba.send_falla', 'si', false);
select t.como('mesero');
select t.sale('S2 realtime.send lanza un error y el INSERT del POS sale bien', format($q$insert into public.impresiones (id, impresora_id, tipo, contenido) values ('22222222-2222-4222-8222-222222222222', '%s', 'cuenta', t.docj())$q$, t.pid('cocina')));
select t.fuera();
select t.igual_sup('S2 el trabajo quedó guardado', $q$select estado from public.impresiones where id = '22222222-2222-4222-8222-222222222222'$q$, 'pendiente');
select t.igual_sup('S2 sin señal (la simulación la rechazó)', 'select count(*)::text from realtime.llamadas_prueba', '0');
select t.igual_sup('S2 y el agente igual lo encuentra al sondear', $q$select t.toma_textos('cocina')$q$, 'x');
select set_config('prueba.send_falla', '', false);
-- y si realtime.send ni siquiera existe
alter function realtime.send(jsonb, text, text, boolean) rename to send_apagada;
select t.como('mesero');
select t.sale('S2 sin realtime.send tampoco falla el INSERT', format($q$insert into public.impresiones (impresora_id, tipo, contenido) values ('%s', 'cuenta', t.docj())$q$, t.pid('cocina')));
select t.fuera();
alter function realtime.send_apagada(jsonb, text, text, boolean) rename to send;
select t.igual_sup('S2 (quedaron 2 trabajos)', 'select count(*)::text from public.impresiones', '2');
select t.trabajo('cocina', 'con send de vuelta');
select t.igual_sup('S2 con realtime.send de vuelta la señal sale otra vez', 'select t.senales()', t.topico(t.tok('cocina')));

-- ── S3. mantenimiento: caducar, rendirse, purgar ────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
-- (se preparan con UPDATE: el UPDATE no dispara el mantenimiento; el INSERT sí lo haría con las filas ya viejas)
select t.g('a1', t.trabajo('caja', 'a1')::text);   -- impresa hace 8 días: se purga
select t.g('a2', t.trabajo('caja', 'a2')::text);   -- impresa hace 6 días: se queda
select t.g('a3', t.trabajo('caja', 'a3')::text);   -- error hace 8 días: se purga
select t.g('a4', t.trabajo('caja', 'a4')::text);   -- error hace 6 días: se queda
select t.g('a5', t.trabajo('caja', 'a5')::text);   -- pendiente hace 8 días: caduca y se purga en la misma pasada
select t.g('a6', t.trabajo('caja', 'a6')::text);   -- imprimiendo, 3 intentos, hace 8 días: se rinde y se purga
select t.g('a7', t.trabajo('caja', 'a7')::text);   -- imprimiendo, 1 intento, hace 1 minuto: se queda
select t.g('a8', t.trabajo('caja', 'a8')::text);   -- pendiente hace 20 minutos: caduca (no se purga: es reciente)
select t.g('a9', t.trabajo('caja', 'a9')::text);   -- pendiente hace 5 minutos: se queda
update public.impresiones set estado = 'impresa', impresa_en = now() - interval '8 days', creada_en = now() - interval '8 days' where id = t.vv('a1')::uuid;
update public.impresiones set estado = 'impresa', impresa_en = now() - interval '6 days', creada_en = now() - interval '6 days' where id = t.vv('a2')::uuid;
update public.impresiones set estado = 'error', error = 'x', creada_en = now() - interval '8 days' where id = t.vv('a3')::uuid;
update public.impresiones set estado = 'error', error = 'x', creada_en = now() - interval '6 days' where id = t.vv('a4')::uuid;
update public.impresiones set creada_en = now() - interval '8 days' where id = t.vv('a5')::uuid;
update public.impresiones set estado = 'imprimiendo', intentos = 3, tomada_en = now() - interval '8 days', creada_en = now() - interval '8 days' where id = t.vv('a6')::uuid;
update public.impresiones set estado = 'imprimiendo', intentos = 1, tomada_en = now() - interval '1 minute' where id = t.vv('a7')::uuid;
update public.impresiones set creada_en = now() - interval '20 minutes' where id = t.vv('a8')::uuid;
update public.impresiones set creada_en = now() - interval '5 minutes' where id = t.vv('a9')::uuid;
select t.igual_sup('S3 antes: 9 filas', 'select count(*)::text from public.impresiones', '9');
select t.como('mesero');
select t.sale('S3 un trabajo nuevo del POS dispara el mantenimiento', $q$insert into public.impresiones (id, tipo, contenido) values ('33333333-3333-4333-8333-333333333333', 'cuenta', t.docj())$q$);
select t.fuera();
select t.igual_sup('S3 se purgaron lo impreso y lo fallido de hace más de 7 días (también lo que caducó o se trabó hace 8 días)',
  $q$select string_agg(c.contenido -> 'lineas' -> 0 ->> 'texto', ',' order by c.contenido -> 'lineas' -> 0 ->> 'texto') from public.impresiones c where c.id <> '33333333-3333-4333-8333-333333333333'$q$, 'a2,a4,a7,a8,a9');
select t.igual_sup('S3 lo de hace 6 días se conserva (impresa y error)', $q$select t.est(t.vv('a2')::uuid) || ',' || t.est(t.vv('a4')::uuid)$q$, 'impresa/0,error/0');
select t.igual_sup('S3 el que llevaba 20 minutos pendiente caducó (y se queda, es reciente)', $q$select t.est(t.vv('a8')::uuid) || '/' || (select error from public.impresiones where id = t.vv('a8')::uuid)$q$, 'error/0/caducó: la impresora no la tomó a tiempo');
select t.igual_sup('S3 el de 5 minutos sigue pendiente; el que se está imprimiendo sigue imprimiéndose', $q$select t.est(t.vv('a9')::uuid) || ',' || t.est(t.vv('a7')::uuid)$q$, 'pendiente/0,imprimiendo/1');
select t.igual_sup('S3 el nuevo entró pendiente', $q$select estado from public.impresiones where id = '33333333-3333-4333-8333-333333333333'$q$, 'pendiente');

-- la purga trabaja de a 500
select t.partida();
insert into public.impresiones (tipo, contenido, estado, error) select 'cuenta', t.docj(), 'error', 'viejo' from generate_series(1, 700);
update public.impresiones set creada_en = now() - interval '9 days';
select t.igual_sup('S3 700 viejos preparados', 'select count(*)::text from public.impresiones', '700');
select t.trabajo(null, 'dispara 1');
select t.igual_sup('S3 una pasada purga 500 (quedan 200 viejos y el nuevo)', 'select count(*)::text from public.impresiones', '201');
select t.trabajo(null, 'dispara 2');
select t.igual_sup('S3 la siguiente termina (solo quedan los dos nuevos)', 'select count(*)::text from public.impresiones', '2');

-- el mantenimiento nunca rompe un INSERT: si caducar falla, el trabajo entra y solo hay un WARNING
select t.partida();
select t.g('def_caducar', pg_get_functiondef('privado.impresiones_caducar()'::regprocedure));
create or replace function privado.impresiones_caducar() returns void language plpgsql
  as $$ begin raise exception 'roto a propósito'; end $$;
select t.como('mesero');
select t.sale('S3 con el mantenimiento roto, el INSERT del POS sale bien', $q$insert into public.impresiones (id, tipo, contenido) values ('44444444-4444-4444-8444-444444444444', 'cuenta', t.docj())$q$);
select t.fuera();
select t.igual_sup('S3 y el trabajo está', $q$select estado from public.impresiones where id = '44444444-4444-4444-8444-444444444444'$q$, 'pendiente');
select t.vv('def_caducar') as def \gset
:def;
select t.igual_sup('S3 se restauró la función real (vuelve a caducar)', $q$select (pg_get_functiondef('privado.impresiones_caducar()'::regprocedure) like '%caducó%')::text$q$, 'true');

-- ── S4. los triggers, tal cual ──────────────────────────────
select t.igual_sup('S4 hay exactamente tres triggers propios en impresiones, todos activos',
  $q$select string_agg(tgname || ':' || tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid = 'public.impresiones'::regclass and not tgisinternal$q$,
  'impresiones_mantener:O,impresiones_senal:O,impresiones_tope:O');
select t.igual_sup('S4 el tope es AFTER INSERT por sentencia con tabla de transición (así un INSERT de muchas filas no lo esquiva)',
  $q$select (pg_get_triggerdef(oid) ~ 'AFTER INSERT ON public.impresiones REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT')::text from pg_trigger where tgname = 'impresiones_tope'$q$, 'true');
select t.igual_sup('S4 la señal es AFTER INSERT por fila, solo para las pendientes',
  $q$select (pg_get_triggerdef(oid) ~ 'AFTER INSERT ON public.impresiones FOR EACH ROW WHEN \(\(new.estado = ''pendiente''::text\)\)')::text from pg_trigger where tgname = 'impresiones_senal'$q$, 'true');
select t.igual_sup('S4 el mantenimiento es AFTER INSERT por sentencia',
  $q$select (pg_get_triggerdef(oid) ~ 'AFTER INSERT ON public.impresiones FOR EACH STATEMENT')::text from pg_trigger where tgname = 'impresiones_mantener'$q$, 'true');
