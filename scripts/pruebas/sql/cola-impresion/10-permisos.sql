-- P: la matriz de permisos de 20261003140000_cola_impresion.sql.
-- Quiénes: admin, mesero, mesero2 (personal) · ajena (Google sin fila) · pendiente (sin acceso: sin fila, o con fila pendiente en la ola C)
--          · eliminado (baja lógica) · correo (cuenta por correo con el MISMO correo del admin) · anon.
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('cocina', 'Cocina');

-- ── P1. quién encola ────────────────────────────────────────
select t.como('admin');
select t.sale('P1 admin encola', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$);
select t.como('mesero');
select t.sale('P1 mesero encola', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$);
select t.como('mesero2');
select t.sale('P1 mesero2 encola', $q$insert into public.impresiones (tipo, contenido) values ('ticket', t.docj())$q$);

select t.como('ajena');
select t.falla('P1 una cuenta de Google que no es personal NO encola', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^42501');
select t.como('pendiente');
select t.falla('P1 una cuenta sin acceso (pendiente) NO encola', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^42501');
select t.como('eliminado');
select t.falla('P1 el personal dado de baja NO encola', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^42501');
select t.como('correo');
select t.falla('P1 una cuenta por correo (aunque tenga el correo del admin) NO encola', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^42501');
select t.como('anon');
select t.falla('P1 anon NO encola (ni tiene INSERT)', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^42501.*permission denied for table impresiones');

-- ── P2. quién ve la cola ────────────────────────────────────
select t.como('admin');
select t.igual('P2 el admin ve toda la cola', 'select count(*)::text from public.impresiones', '3');
select t.como('mesero');
select t.igual('P2 el mesero ve toda la cola (no solo lo suyo: es el estado en vivo de la caja)', 'select count(*)::text from public.impresiones', '3');
select t.como('mesero2');
select t.igual('P2 el otro mesero también', 'select count(*)::text from public.impresiones', '3');
select t.como('ajena');
select t.igual('P2 la cuenta ajena ve 0 filas (sin error: la RLS filtra)', 'select count(*)::text from public.impresiones', '0');
select t.como('pendiente');
select t.igual('P2 la cuenta pendiente ve 0 filas', 'select count(*)::text from public.impresiones', '0');
select t.como('eliminado');
select t.igual('P2 el eliminado ve 0 filas', 'select count(*)::text from public.impresiones', '0');
select t.como('correo');
select t.igual('P2 la cuenta por correo ve 0 filas', 'select count(*)::text from public.impresiones', '0');
select t.como('anon');
select t.falla('P2 anon no lee la cola', 'select count(*) from public.impresiones', '^42501');

-- ── P3. quién escribe cada columna: solo (id, impresora_id, tipo, mesa_id, orden_id, contenido) ──
select t.como('mesero');
select t.falla('P3 no escribe estado', $q$insert into public.impresiones (tipo, contenido, estado) values ('cuenta', t.docj(), 'impresa')$q$, '^42501');
select t.falla('P3 no escribe intentos', $q$insert into public.impresiones (tipo, contenido, intentos) values ('cuenta', t.docj(), 2)$q$, '^42501');
select t.falla('P3 no escribe creada_por (no se hace pasar por otro)', $q$insert into public.impresiones (tipo, contenido, creada_por) values ('cuenta', t.docj(), 'admin@resplandor.test')$q$, '^42501');
select t.falla('P3 no escribe creada_en', $q$insert into public.impresiones (tipo, contenido, creada_en) values ('cuenta', t.docj(), now())$q$, '^42501');
select t.falla('P3 no escribe tomada_en', $q$insert into public.impresiones (tipo, contenido, tomada_en) values ('cuenta', t.docj(), now())$q$, '^42501');
select t.falla('P3 no escribe impresa_en', $q$insert into public.impresiones (tipo, contenido, impresa_en) values ('cuenta', t.docj(), now())$q$, '^42501');
select t.falla('P3 no escribe error', $q$insert into public.impresiones (tipo, contenido, error) values ('cuenta', t.docj(), 'x')$q$, '^42501');
select t.falla('P3 no escribe tomada_por', $q$insert into public.impresiones (tipo, contenido, tomada_por) values ('cuenta', t.docj(), gen_random_uuid())$q$, '^42501');
select t.sale('P3 sí escribe sus seis columnas (con su propio id)', format($q$insert into public.impresiones (id, impresora_id, tipo, mesa_id, orden_id, contenido) values ('%s', '%s', 'abono', 4, 'o-1', t.docj())$q$, '11111111-1111-4111-8111-111111111111', t.pid('caja')));
select t.falla('P3 el mismo id otra vez da 23505 (un reintento del POS no saca otra copia)', format($q$insert into public.impresiones (id, tipo, contenido) values ('%s', 'abono', t.docj())$q$, '11111111-1111-4111-8111-111111111111'), '^23505');
select t.falla('P3 un destino que no existe da 23503', $q$insert into public.impresiones (impresora_id, tipo, contenido) values (gen_random_uuid(), 'cuenta', t.docj())$q$, '^23503');
select t.fuera();
select t.igual('P3 creada_por es el correo de quien encoló (lo puso la base)', $q$select creada_por from public.impresiones where id = '11111111-1111-4111-8111-111111111111'$q$, 'mesero1@resplandor.test');
select t.igual('P3 y nació pendiente, sin intentos', $q$select estado || '/' || intentos from public.impresiones where id = '11111111-1111-4111-8111-111111111111'$q$, 'pendiente/0');

-- ── P4. nadie edita ni borra por la API ─────────────────────
select t.como('admin');
select t.falla('P4 ni el admin hace UPDATE', $q$update public.impresiones set estado = 'impresa'$q$, '^42501');
select t.falla('P4 ni el admin hace DELETE', $q$delete from public.impresiones$q$, '^42501');
select t.falla('P4 ni el admin hace TRUNCATE', $q$truncate public.impresiones$q$, '^42501');
select t.como('mesero');
select t.falla('P4 el mesero no hace UPDATE', $q$update public.impresiones set estado = 'impresa'$q$, '^42501');
select t.falla('P4 el mesero no hace DELETE', $q$delete from public.impresiones$q$, '^42501');
select t.como('anon');
select t.falla('P4 anon no hace UPDATE', $q$update public.impresiones set estado = 'impresa'$q$, '^42501');
select t.fuera();
select t.igual('P4 y la cola sigue intacta', 'select count(*)::text from public.impresiones', '4');
select t.igual('P4 y ningún trabajo cambió de estado', $q$select count(*)::text from public.impresiones where estado <> 'pendiente'$q$, '0');

-- ── P5. impresoras: solo el admin, y nunca el token_hash ────
select t.como('admin');
select t.igual('P5 el admin lee las columnas permitidas (2 impresoras)', 'select count(*)::text from (select id, nombre, activa, ultimo_latido, version_agente, creada_en from public.impresoras) x', '2');
select t.falla('P5 ni el admin lee token_hash', 'select token_hash from public.impresoras', '^42501');
select t.falla('P5 ni el admin lee token_hash con select *', 'select * from public.impresoras', '^42501');
select t.falla('P5 ni el admin lo lee dentro de un where', $q$select id from public.impresoras where token_hash like 'a%'$q$, '^42501');
select t.falla('P5 ni el admin lo lee con to_jsonb de la fila', 'select to_jsonb(i) from public.impresoras i', '^42501');
select t.falla('P5 ni el admin escribe (INSERT)', $q$insert into public.impresoras (nombre, token_hash) values ('X', repeat('a', 64))$q$, '^42501');
select t.falla('P5 ni el admin escribe (UPDATE)', $q$update public.impresoras set nombre = 'X'$q$, '^42501');
select t.falla('P5 ni el admin escribe (UPDATE de token_hash)', $q$update public.impresoras set token_hash = repeat('a', 64)$q$, '^42501');
select t.falla('P5 ni el admin escribe (DELETE)', $q$delete from public.impresoras$q$, '^42501');
select t.como('mesero');
select t.igual('P5 el mesero no ve ninguna impresora (RLS: 0 filas)', 'select count(*)::text from (select id, nombre from public.impresoras) x', '0');
select t.falla('P5 el mesero tampoco lee token_hash', 'select token_hash from public.impresoras', '^42501');
select t.como('ajena');
select t.igual('P5 la cuenta ajena no ve ninguna', 'select count(*)::text from (select id, nombre from public.impresoras) x', '0');
select t.como('correo');
select t.igual('P5 la cuenta por correo con el correo del admin no ve ninguna', 'select count(*)::text from (select id, nombre from public.impresoras) x', '0');
select t.como('anon');
select t.falla('P5 anon no lee impresoras', 'select id from public.impresoras', '^42501');
select t.falla('P5 anon no lee token_hash', 'select token_hash from public.impresoras', '^42501');
select t.fuera();
select t.igual('P5 impresoras NO está en la publicación de Realtime (el hash no viaja)', $q$select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'impresoras'$q$, '0');
select t.igual('P5 impresiones SÍ está (el POS ve el estado en vivo)', $q$select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'impresiones'$q$, '1');
select t.igual('P5 ningún rol de la API tiene privilegio de tabla sobre impresoras (solo columnas)',
  $q$select count(*)::text from (values ('anon'), ('authenticated'), ('service_role')) r(rol)
      cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
     where has_table_privilege(r.rol, 'public.impresoras', p.priv)$q$, '0');
select t.igual('P5 la única columna de impresoras que authenticated NO puede leer es token_hash',
  $q$select string_agg(a.attname, ',') from pg_attribute a
      where a.attrelid = 'public.impresoras'::regclass and a.attnum > 0 and not a.attisdropped
        and not has_column_privilege('authenticated', 'public.impresoras', a.attname, 'select')$q$, 'token_hash');
select t.igual('P5 y anon no puede leer ninguna columna de impresoras',
  $q$select count(*)::text from pg_attribute a where a.attrelid = 'public.impresoras'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('anon', 'public.impresoras', a.attname, 'select')$q$, '0');
select t.igual('P5 ni service_role',
  $q$select count(*)::text from pg_attribute a where a.attrelid = 'public.impresoras'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('service_role', 'public.impresoras', a.attname, 'select')$q$, '0');
select t.igual('P5 impresiones: anon y service_role sin ningún privilegio de tabla',
  $q$select count(*)::text from (values ('anon'), ('service_role')) r(rol)
      cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) p(priv)
     where has_table_privilege(r.rol, 'public.impresiones', p.priv)$q$, '0');
select t.igual('P5 impresiones: authenticated solo SELECT (y INSERT por columna): nada de UPDATE, DELETE ni TRUNCATE',
  $q$select count(*)::text from (values ('update'), ('delete'), ('truncate')) p(priv) where has_table_privilege('authenticated', 'public.impresiones', p.priv)$q$, '0');
select t.igual('P5 RLS encendida en las dos tablas',
  $q$select string_agg(relname || '=' || relrowsecurity, ',' order by relname) from pg_class where oid in ('public.impresoras'::regclass, 'public.impresiones'::regclass)$q$, 'impresiones=true,impresoras=true');
select t.igual('P5 la compuerta restrictiva solo_personal está en las dos tablas',
  $q$select string_agg(tablename, ',' order by tablename) from pg_policies where policyname = 'solo_personal' and permissive = 'RESTRICTIVE' and tablename in ('impresoras', 'impresiones')$q$, 'impresiones,impresoras');
select t.igual('P5 impresiones no tiene policies de escritura salvo crear',
  $q$select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where tablename = 'impresiones'$q$, 'impresiones_crear:INSERT,impresiones_ver:SELECT,solo_personal:ALL');
select t.igual('P5 impresoras: solo ver (admin) y la compuerta',
  $q$select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where tablename = 'impresoras'$q$, 'impresoras_ver:SELECT,solo_personal:ALL');
select t.igual('P5 realtime.messages no ganó ninguna policy con esta migración (canal público a propósito)',
  $q$select count(*)::text from pg_policies where tablename = 'messages' and (policyname ilike '%impresora%' or qual ilike '%impresora%' or with_check ilike '%impresora%')$q$, '0');

-- ── P6. las RPC del agente: la credencial es el token, no la sesión ──
select t.como('anon');
select t.igual('P6 anon con un token válido toma (los 4 trabajos pendientes: 3 de cualquiera y 1 dirigido a la caja)', $q$select t.toma('caja', 20)::text$q$, '4');
select t.igual('P6 anon con un token válido confirma',
  $q$select (public.impresora_confirmar(t.tok('caja'), '11111111-1111-4111-8111-111111111111', true)) ->> 'ok'$q$, 'true');
select t.igual('P6 anon con un token válido da latido', $q$select (public.impresora_latido(t.tok('caja'), '1.0.0')) ->> 'ok'$q$, 'true');
select t.igual('P6 anon con un token inventado: tomar da 0 filas y ningún error', $q$select count(*)::text from public.impresora_tomar(repeat('z', 40), 5)$q$, '0');
select t.igual('P6 anon con un token inventado: confirmar da no_autorizado',
  $q$select (public.impresora_confirmar(repeat('z', 40), '11111111-1111-4111-8111-111111111111', true)) ->> 'codigo'$q$, 'no_autorizado');
select t.igual('P6 anon con un token inventado: latido da no_autorizado', $q$select (public.impresora_latido(repeat('z', 40), 'x')) ->> 'codigo'$q$, 'no_autorizado');
select t.igual('P6 anon sin token (null): tomar vacío', $q$select count(*)::text from public.impresora_tomar(null, 5)$q$, '0');
select t.igual('P6 anon con token vacío: tomar vacío', $q$select count(*)::text from public.impresora_tomar('', 5)$q$, '0');
select t.igual('P6 anon con un token enorme (1 MB) no hace trabajar a la base: no_autorizado',
  $q$select (public.impresora_latido(repeat('z', 1000000), 'x')) ->> 'codigo'$q$, 'no_autorizado');
select t.igual('P6 el hash del token de la caja NO sirve como token (no se puede suplantar con lo que la base guarda)',
  $q$select (public.impresora_latido(encode(sha256(convert_to(t.tok('caja'), 'UTF8')), 'hex'), 'x')) ->> 'codigo'$q$, 'no_autorizado');
select t.igual('P6 el token de una impresora no abre la otra: el latido anota la suya',
  $q$select (public.impresora_latido(t.tok('cocina'), 'x')) ->> 'nombre'$q$, 'Cocina');
select t.como('mesero');
select t.igual('P6 un mesero con un token inventado no toma nada', $q$select count(*)::text from public.impresora_tomar(repeat('z', 40), 5)$q$, '0');
select t.fuera();
select t.trabajo('caja', 'para el mesero');
select t.como('mesero');
select t.igual('P6 un mesero con el token VÁLIDO de la caja toma (el token es la credencial, no el rol)', $q$select t.toma('caja', 1)::text$q$, '1');

-- ── P7. las RPC de administración y del POS ─────────────────
select t.fuera();
select t.nueva_impresora('barra', 'Barra');
select t.como('admin');
select t.igual('P7 el admin crea', $q$select (public.impresora_crear('Terraza')) ->> 'ok'$q$, 'true');
select t.igual('P7 el admin rota', format($q$select (public.impresora_rotar('%s')) ->> 'ok'$q$, t.pid('barra')), 'true');
select t.igual('P7 el admin activa/desactiva', format($q$select (public.impresora_activar('%s', true)) ->> 'ok'$q$, t.pid('barra')), 'true');
select t.igual('P7 el admin ve el estado de las impresoras', 'select count(*)::text from public.impresora_estado()', '4');

select t.como('mesero');
select t.igual('P7 el mesero NO crea', $q$select (public.impresora_crear('Intrusa')) ->> 'codigo'$q$, 'no_autorizado');
select t.igual('P7 el mesero NO rota', format($q$select (public.impresora_rotar('%s')) ->> 'codigo'$q$, t.pid('barra')), 'no_autorizado');
select t.igual('P7 el mesero NO desactiva', format($q$select (public.impresora_activar('%s', false)) ->> 'codigo'$q$, t.pid('barra')), 'no_autorizado');
select t.igual('P7 el mesero ve el estado (las activas)', 'select count(*)::text from public.impresora_estado()', '4');
select t.igual('P7 el mesero cancela: uno que no existe da no_existe', $q$select (public.impresion_cancelar(gen_random_uuid())) ->> 'codigo'$q$, 'no_existe');

do $$
declare r record;
begin
  -- quienes no son personal: nada de las RPC del POS, ni siquiera pistas
  for r in select clave from t.gente where clave in ('ajena', 'pendiente', 'eliminado', 'correo') order by clave loop
    perform t.como(r.clave);
    perform t.ok('P7 ' || r.clave || ' no crea impresoras', (public.impresora_crear('Intrusa') ->> 'codigo') = 'no_autorizado');
    perform t.ok('P7 ' || r.clave || ' no rota', (public.impresora_rotar(t.pid('barra')) ->> 'codigo') = 'no_autorizado');
    perform t.ok('P7 ' || r.clave || ' no desactiva', (public.impresora_activar(t.pid('barra'), false) ->> 'codigo') = 'no_autorizado');
    perform t.ok('P7 ' || r.clave || ' no cancela', (public.impresion_cancelar(gen_random_uuid()) ->> 'codigo') = 'no_autorizado');
    perform t.ok('P7 ' || r.clave || ' no ve el estado de las impresoras (0 filas)', (select count(*) from public.impresora_estado()) = 0);
  end loop;
  perform t.fuera();
end $$;

select t.como('anon');
select t.falla('P7 anon no crea (sin EXECUTE)', $q$select public.impresora_crear('X')$q$, '^42501.*permission denied for function');
select t.falla('P7 anon no rota', format($q$select public.impresora_rotar('%s')$q$, t.pid('barra')), '^42501');
select t.falla('P7 anon no activa', format($q$select public.impresora_activar('%s', false)$q$, t.pid('barra')), '^42501');
select t.falla('P7 anon no ve el estado', $q$select * from public.impresora_estado()$q$, '^42501');
select t.falla('P7 anon no cancela', $q$select public.impresion_cancelar(gen_random_uuid())$q$, '^42501');
select t.falla('P7 anon no llama a las funciones de privado (no hay USAGE ni EXECUTE)', $q$select privado.hash_token(repeat('z', 40))$q$, '^42501');
select t.como('mesero');
select t.falla('P7 un mesero tampoco llama a las funciones de privado', $q$select privado.impresora_de_token(repeat('z', 40))$q$, '^42501');
select t.falla('P7 ni al trigger de la señal', $q$select privado.impresiones_senal()$q$, '^42501');
select t.fuera();

-- ── P8. EXECUTE de cada función, desde el catálogo ──────────
-- esperado: (función, anon, authenticated, service_role). PUBLIC nunca (proacl no nulo y sin el grantee 0).
select t.igual('P8 ninguna función nueva tiene EXECUTE para PUBLIC ni proacl por defecto',
  $q$select count(*)::text from pg_proc p
      where p.oid in (select oid from pg_proc where (pronamespace = 'public'::regnamespace and proname in ('impresora_tomar','impresora_confirmar','impresora_latido','impresora_crear','impresora_rotar','impresora_activar','impresora_estado','impresion_cancelar'))
                                                  or (pronamespace = 'privado'::regnamespace and proname in ('hash_token','topico_impresora','impresora_de_token','impresiones_caducar','impresiones_mantener','impresiones_tope','impresiones_senal')))
        and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))$q$, '0');
select t.igual('P8 son 15 funciones (8 públicas + 7 de privado)',
  $q$select count(*)::text from pg_proc where (pronamespace = 'public'::regnamespace and proname in ('impresora_tomar','impresora_confirmar','impresora_latido','impresora_crear','impresora_rotar','impresora_activar','impresora_estado','impresion_cancelar'))
                                                  or (pronamespace = 'privado'::regnamespace and proname in ('hash_token','topico_impresora','impresora_de_token','impresiones_caducar','impresiones_mantener','impresiones_tope','impresiones_senal'))$q$, '15');
select t.igual('P8 matriz de EXECUTE: solo lo previsto',
  $q$with esperado(f, anon, auth, svc) as (values
        ('public.impresora_tomar(text,integer)',               true,  true,  false),
        ('public.impresora_confirmar(text,uuid,boolean,text)', true,  true,  false),
        ('public.impresora_latido(text,text)',                 true,  true,  false),
        ('public.impresora_crear(text)',                       false, true,  false),
        ('public.impresora_rotar(uuid)',                       false, true,  false),
        ('public.impresora_activar(uuid,boolean)',             false, true,  false),
        ('public.impresora_estado()',                          false, true,  false),
        ('public.impresion_cancelar(uuid)',                    false, true,  false),
        ('privado.hash_token(text)',                           false, false, false),
        ('privado.topico_impresora(text)',                     false, false, false),
        ('privado.impresora_de_token(text)',                   false, false, false),
        ('privado.impresiones_caducar()',                      false, false, false),
        ('privado.impresiones_mantener()',                     false, false, false),
        ('privado.impresiones_tope()',                         false, false, false),
        ('privado.impresiones_senal()',                        false, false, false))
      select coalesce(string_agg(f, ', '), 'ok') from esperado
       where has_function_privilege('anon', f, 'execute') is distinct from anon
          or has_function_privilege('authenticated', f, 'execute') is distinct from auth
          or has_function_privilege('service_role', f, 'execute') is distinct from svc$q$, 'ok');
select t.igual('P8 las funciones públicas con SECURITY DEFINER fijan search_path vacío; ninguna queda sin él',
  $q$select count(*)::text from pg_proc p
      where ((p.pronamespace = 'public'::regnamespace and p.proname in ('impresora_tomar','impresora_confirmar','impresora_latido','impresora_crear','impresora_rotar','impresora_activar','impresora_estado','impresion_cancelar'))
          or (p.pronamespace = 'privado'::regnamespace and p.proname in ('hash_token','topico_impresora','impresora_de_token','impresiones_caducar','impresiones_mantener','impresiones_tope','impresiones_senal')))
        and not (coalesce(p.proconfig, '{}') @> array['search_path=""'])$q$, '0');
select t.igual('P8 son SECURITY DEFINER: las 8 RPC, la señal, el mantenimiento, caducar y el autenticador por token (no el tope, que corre con los permisos de quien llama)',
  $q$select string_agg(p.proname, ',' order by p.proname collate "C") from pg_proc p
      where p.prosecdef and ((p.pronamespace = 'public'::regnamespace and p.proname like 'impres%')
                          or (p.pronamespace = 'privado'::regnamespace and p.proname in ('hash_token','topico_impresora','impresora_de_token','impresiones_caducar','impresiones_mantener','impresiones_tope','impresiones_senal')))$q$,
  'impresion_cancelar,impresiones_caducar,impresiones_mantener,impresiones_senal,impresora_activar,impresora_confirmar,impresora_crear,impresora_de_token,impresora_estado,impresora_latido,impresora_rotar,impresora_tomar');
