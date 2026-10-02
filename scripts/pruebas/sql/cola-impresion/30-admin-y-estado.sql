-- A: administración de impresoras (crear, rotar, activar), el estado «caja en línea» y el latido.
select t.partida();

-- ── A1. crear ───────────────────────────────────────────────
select t.como('admin');
select t.g('c1', (public.impresora_crear('  Caja principal  '))::text);
select t.g('c2', (public.impresora_crear('Caja principal'))::text);
select t.fuera();
select t.igual_sup('A1 crear devuelve ok y el nombre recortado', $q$select (t.vv('c1')::jsonb ->> 'ok') || '/' || (t.vv('c1')::jsonb ->> 'nombre')$q$, 'true/Caja principal');
select t.igual_sup('A1 el token es imp_ + 64 hex (256 bits)', $q$select ((t.vv('c1')::jsonb ->> 'token') ~ '^imp_[0-9a-f]{64}$')::text$q$, 'true');
select t.igual_sup('A1 la respuesta trae el id de la fila', $q$select ((t.vv('c1')::jsonb ->> 'id')::uuid = (select id from public.impresoras where token_hash = encode(sha256(convert_to(t.vv('c1')::jsonb ->> 'token', 'UTF8')), 'hex')))::text$q$, 'true');
select t.igual_sup('A1 en la tabla solo queda el HASH: sha256 hex del token', $q$select (token_hash = encode(sha256(convert_to(t.vv('c1')::jsonb ->> 'token', 'UTF8')), 'hex'))::text from public.impresoras where id = (t.vv('c1')::jsonb ->> 'id')::uuid$q$, 'true');
select t.igual_sup('A1 el token en claro no está en NINGUNA columna de la fila', $q$select count(*)::text from public.impresoras i where i::text like '%' || (t.vv('c1')::jsonb ->> 'token') || '%'$q$, '0');
select t.igual_sup('A1 nace activa, sin latido y sin versión', $q$select activa::text || '/' || coalesce(ultimo_latido::text, 'null') || '/' || coalesce(version_agente, 'null') from public.impresoras where id = (t.vv('c1')::jsonb ->> 'id')::uuid$q$, 'true/null/null');
select t.igual_sup('A1 dos impresoras con el mismo nombre tienen tokens y hashes distintos', $q$select ((t.vv('c1')::jsonb ->> 'token') <> (t.vv('c2')::jsonb ->> 'token'))::text || '/' || (select count(distinct token_hash)::text from public.impresoras)$q$, 'true/2');

select t.como('admin');
select t.igual('A1 un nombre vacío', $q$select (public.impresora_crear('')) ->> 'codigo'$q$, 'nombre_invalido');
select t.igual('A1 un nombre de espacios', $q$select (public.impresora_crear('    ')) ->> 'codigo'$q$, 'nombre_invalido');
select t.igual('A1 un nombre nulo', $q$select (public.impresora_crear(null)) ->> 'codigo'$q$, 'nombre_invalido');
select t.igual('A1 un nombre de 61 caracteres', $q$select (public.impresora_crear(repeat('a', 61))) ->> 'codigo'$q$, 'nombre_invalido');
select t.igual('A1 un nombre con caracteres de control', $q$select (public.impresora_crear(E'Ca\x1bja')) ->> 'codigo'$q$, 'nombre_invalido');
select t.igual('A1 un nombre con salto de línea', $q$select (public.impresora_crear(E'Caja\nBarra')) ->> 'codigo'$q$, 'nombre_invalido');
select t.igual('A1 uno de 60 sí', $q$select (public.impresora_crear(repeat('b', 60))) ->> 'ok'$q$, 'true');
select t.igual('A1 con tildes y ñ también', $q$select (public.impresora_crear('Cocina · Ñandú')) ->> 'ok'$q$, 'true');
select t.fuera();
select t.igual_sup('A1 los rechazados no dejaron filas (4 en total)', 'select count(*)::text from public.impresoras', '4');
select t.como('admin2');
select t.igual('A1 el otro admin también crea', $q$select (public.impresora_crear('Barra')) ->> 'ok'$q$, 'true');
select t.fuera();

-- ── A2. rotar ───────────────────────────────────────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('otra', 'Otra');
select t.g('viejo', t.tok('caja'));
select t.g('hash_otra', (select token_hash from public.impresoras where id = t.pid('otra')));
select t.como('anon');
select t.igual('A2 antes de rotar, el token sirve', $q$select (public.impresora_latido(t.vv('viejo'), '1.0.0')) ->> 'ok'$q$, 'true');
select t.como('admin');
select t.g('rot', (public.impresora_rotar(t.pid('caja')))::text);
select t.fuera();
select t.igual_sup('A2 rotar devuelve ok, el mismo id y el nombre', $q$select (t.vv('rot')::jsonb ->> 'ok') || '/' || ((t.vv('rot')::jsonb ->> 'id')::uuid = t.pid('caja'))::text || '/' || (t.vv('rot')::jsonb ->> 'nombre')$q$, 'true/true/Caja');
select t.igual_sup('A2 el token nuevo es otro y tiene la misma forma', $q$select ((t.vv('rot')::jsonb ->> 'token') <> t.vv('viejo'))::text || '/' || ((t.vv('rot')::jsonb ->> 'token') ~ '^imp_[0-9a-f]{64}$')::text$q$, 'true/true');
select t.igual_sup('A2 la fila guarda el hash del nuevo', $q$select (token_hash = encode(sha256(convert_to(t.vv('rot')::jsonb ->> 'token', 'UTF8')), 'hex'))::text from public.impresoras where id = t.pid('caja')$q$, 'true');
select t.igual_sup('A2 y borra el latido y la versión (la caja figura sin conexión hasta que arranque con el nuevo)', $q$select coalesce(ultimo_latido::text, 'null') || '/' || coalesce(version_agente, 'null') from public.impresoras where id = t.pid('caja')$q$, 'null/null');
select t.igual_sup('A2 sigue siendo la misma impresora: nombre y estado activo', $q$select nombre || '/' || activa::text from public.impresoras where id = t.pid('caja')$q$, 'Caja/true');
select t.igual_sup('A2 rotar una no toca a las otras: la otra conserva su hash', $q$select (token_hash = t.vv('hash_otra'))::text from public.impresoras where id = t.pid('otra')$q$, 'true');
select t.como('anon');
select t.igual('A2 y su token sigue sirviendo', $q$select (public.impresora_latido(t.tok('otra'), 'x')) ->> 'ok'$q$, 'true');
select t.igual('A2 el token viejo ya no sirve', $q$select (public.impresora_latido(t.vv('viejo'), '1.0.0')) ->> 'codigo'$q$, 'no_autorizado');
select t.igual('A2 el nuevo sí', $q$select (public.impresora_latido(t.vv('rot')::jsonb ->> 'token', '1.0.1')) ->> 'ok'$q$, 'true');
select t.fuera();
select t.como('admin');
select t.igual('A2 rotar una que no existe', $q$select (public.impresora_rotar(gen_random_uuid())) ->> 'codigo'$q$, 'no_existe');
select t.igual('A2 rotar con id nulo', $q$select (public.impresora_rotar(null)) ->> 'codigo'$q$, 'no_existe');
select t.fuera();
-- rotar una desactivada devuelve token pero NO la reactiva
select t.como('admin');
select t.igual('A2 desactivar', format($q$select (public.impresora_activar('%s', false)) ->> 'ok'$q$, t.pid('caja')), 'true');
select t.g('rot2', (public.impresora_rotar(t.pid('caja')))::text);
select t.fuera();
select t.como('anon');
select t.igual('A2 rotar una desactivada no la reactiva: el token nuevo no sirve', $q$select (public.impresora_latido(t.vv('rot2')::jsonb ->> 'token', 'x')) ->> 'codigo'$q$, 'no_autorizado');
select t.fuera();

-- ── A3. activar ─────────────────────────────────────────────
select t.como('admin');
select t.igual('A3 reactivar', format($q$select (public.impresora_activar('%s', true)) ->> 'activa'$q$, t.pid('caja')), 'true');
select t.igual('A3 una que no existe', $q$select (public.impresora_activar(gen_random_uuid(), true)) ->> 'codigo'$q$, 'no_existe');
select t.igual('A3 un valor nulo se toma como desactivar (lo seguro)', format($q$select (public.impresora_activar('%s', null)) ->> 'activa'$q$, t.pid('caja')), 'false');
select t.fuera();
select t.igual_sup('A3 y la fila quedó desactivada', $q$select activa::text from public.impresoras where id = t.pid('caja')$q$, 'false');
select t.igual_sup('A3 desactivar una no toca a las otras', $q$select activa::text from public.impresoras where id = t.pid('otra')$q$, 'true');

-- ── A4. el estado «Caja: en línea / sin conexión» ───────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('cocina', 'Cocina');
select t.nueva_impresora('vieja', 'Vieja');
select t.como('admin');
select t.igual('A4 desactivar la vieja', format($q$select (public.impresora_activar('%s', false)) ->> 'ok'$q$, t.pid('vieja')), 'true');
select t.fuera();
select t.como('anon');
select t.igual('A4 la caja da latido con su versión', $q$select (public.impresora_latido(t.tok('caja'), '1.2.3')) ->> 'ok'$q$, 'true');
select t.fuera();
select t.como('admin');
select t.igual('A4 el admin ve las 3 (también la desactivada), por orden de creación', $q$select string_agg(nombre, ',' order by n) from public.impresora_estado() with ordinality as e(id, nombre, en_linea, ultimo_latido, activa, version_agente, n)$q$, 'Caja,Cocina,Vieja');
select t.igual('A4 la caja está en línea; la cocina (sin latido) no; la vieja tampoco', $q$select string_agg(en_linea::text, ',' order by n) from public.impresora_estado() with ordinality as e(id, nombre, en_linea, ultimo_latido, activa, version_agente, n)$q$, 'true,false,false');
select t.igual('A4 trae la versión y si está activa', $q$select string_agg(coalesce(version_agente, '-') || ':' || activa::text, ',' order by n) from public.impresora_estado() with ordinality as e(id, nombre, en_linea, ultimo_latido, activa, version_agente, n)$q$, '1.2.3:true,-:true,-:false');
select t.igual('A4 las columnas son exactamente estas (ni token_hash ni nada más)', $q$select string_agg(k, ',' order by k) from (select jsonb_object_keys(to_jsonb(e)) k from (select * from public.impresora_estado() limit 1) e) x$q$, 'activa,en_linea,id,nombre,ultimo_latido,version_agente');
select t.como('mesero');
select t.igual('A4 el mesero ve solo las activas', $q$select string_agg(nombre, ',' order by n) from public.impresora_estado() with ordinality as e(id, nombre, en_linea, ultimo_latido, activa, version_agente, n)$q$, 'Caja,Cocina');
select t.igual('A4 con el mismo en_linea', $q$select string_agg(en_linea::text, ',' order by n) from public.impresora_estado() with ordinality as e(id, nombre, en_linea, ultimo_latido, activa, version_agente, n)$q$, 'true,false');
select t.fuera();

-- los umbrales de «en línea»: 90 segundos
update public.impresoras set ultimo_latido = now() - interval '85 seconds' where id = t.pid('cocina');
select t.como('mesero');
select t.igual('A4 con el último latido hace 85 s sigue en línea', $q$select en_linea::text from public.impresora_estado() where nombre = 'Cocina'$q$, 'true');
select t.fuera();
update public.impresoras set ultimo_latido = now() - interval '95 seconds' where id = t.pid('cocina');
select t.como('mesero');
select t.igual('A4 con el último latido hace 95 s ya no', $q$select en_linea::text from public.impresora_estado() where nombre = 'Cocina'$q$, 'false');
select t.igual('A4 y el último latido se ve', $q$select (ultimo_latido is not null)::text from public.impresora_estado() where nombre = 'Cocina'$q$, 'true');
select t.fuera();
update public.impresoras set ultimo_latido = now() where id = t.pid('vieja');
select t.como('admin');
select t.igual('A4 una desactivada nunca está en línea, aunque tenga un latido de ahora', $q$select en_linea::text from public.impresora_estado() where nombre = 'Vieja'$q$, 'false');
select t.fuera();
select t.como('admin');
select t.g('rr', (public.impresora_rotar(t.pid('caja')))::text);
select t.igual('A4 tras rotar, la caja figura sin conexión de inmediato', $q$select en_linea::text from public.impresora_estado() where nombre = 'Caja'$q$, 'false');
select t.fuera();
select t.como('anon');
select t.falla('A4 anon no ve el estado', $q$select * from public.impresora_estado()$q$, '^42501');
select t.fuera();

-- ── A5. el latido ───────────────────────────────────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.como('anon');
select t.g('l1', (public.impresora_latido(t.tok('caja'), '  v1.4.2  '))::text);
select t.fuera();
select t.igual_sup('A5 responde ok, el nombre y la hora del servidor', $q$select (t.vv('l1')::jsonb ->> 'ok') || '/' || (t.vv('l1')::jsonb ->> 'nombre') || '/' || (((t.vv('l1')::jsonb ->> 'ahora')::timestamptz) > now() - interval '10 seconds')::text$q$, 'true/Caja/true');
select t.igual_sup('A5 guarda la versión recortada y la hora', $q$select version_agente || '/' || (ultimo_latido > now() - interval '10 seconds')::text from public.impresoras where id = t.pid('caja')$q$, 'v1.4.2/true');
select t.como('anon');
select t.sale('A5 una versión con controles', $q$select public.impresora_latido(t.tok('caja'), E'v\x1b[31m9\r\n')$q$);
select t.fuera();
select t.igual_sup('A5 sale sin controles', $q$select (version_agente !~ '[\x01-\x1f\x7f]')::text || '/' || version_agente from public.impresoras where id = t.pid('caja')$q$, 'true/v [31m9');
select t.como('anon');
select t.sale('A5 una versión larguísima', $q$select public.impresora_latido(t.tok('caja'), repeat('v', 500))$q$);
select t.fuera();
select t.igual_sup('A5 se corta a 40', $q$select length(version_agente)::text from public.impresoras where id = t.pid('caja')$q$, '40');
select t.como('anon');
select t.sale('A5 una versión nula', $q$select public.impresora_latido(t.tok('caja'), null)$q$);
select t.fuera();
select t.igual_sup('A5 queda sin versión (null, no vacío)', $q$select coalesce(version_agente, 'null') from public.impresoras where id = t.pid('caja')$q$, 'null');
select t.como('anon');
select t.sale('A5 una versión de espacios', $q$select public.impresora_latido(t.tok('caja'), '   ')$q$);
select t.fuera();
select t.igual_sup('A5 tampoco se guarda vacía', $q$select coalesce(version_agente, 'null') from public.impresoras where id = t.pid('caja')$q$, 'null');
select t.como('anon');
select t.igual('A5 con un token malo no cambia nada de la impresora', $q$select (public.impresora_latido(repeat('q', 40), 'intruso')) ->> 'codigo'$q$, 'no_autorizado');
select t.fuera();
select t.igual_sup('A5 (la versión no es «intruso»)', $q$select coalesce(version_agente, 'null') from public.impresoras where id = t.pid('caja')$q$, 'null');

-- ── A6. si se borra una impresora (solo el dueño de la base puede), sus trabajos se van con ella ──
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('cocina', 'Cocina');
select t.trabajo('caja', 'de la caja');
select t.trabajo('cocina', 'de la cocina');
select t.g('cualquiera', t.trabajo(null, 'de cualquiera')::text);
select t.como('anon');
select t.toma('cocina', 2);
select t.fuera();
select t.igual_sup('A6 la cocina tomó el de cualquiera', $q$select (tomada_por = t.pid('cocina'))::text from public.impresiones where id = t.vv('cualquiera')::uuid$q$, 'true');
delete from public.impresoras where id = t.pid('cocina');
select t.igual_sup('A6 al borrar la cocina se fueron sus trabajos dirigidos; el de cualquiera sigue (no pasa a ser «de cualquiera» uno de otra)', $q$select string_agg(contenido -> 'lineas' -> 0 ->> 'texto', ',' order by contenido -> 'lineas' -> 0 ->> 'texto' collate "C") from public.impresiones$q$, 'de cualquiera,de la caja');
select t.igual_sup('A6 y el que tomó la cocina quedó sin dueño (tomada_por en null), no se borró', $q$select coalesce(tomada_por::text, 'null') from public.impresiones where id = t.vv('cualquiera')::uuid$q$, 'null');
