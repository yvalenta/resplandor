-- C: la cola de punta a punta con el agente (anon + token): tomar, confirmar, reintentos, trabados, caducidad, cancelar.
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('cocina', 'Cocina');
create table if not exists t.tomadas as select * from public.impresiones with no data;
grant all on t.tomadas to public;
truncate t.tomadas;

-- ── C1. tomar entrega el trabajo y lo marca ─────────────────
select t.g('j1', t.trabajo('caja', 'uno')::text);
select t.como('anon');
insert into t.tomadas select * from public.impresora_tomar(t.tok('caja'));
select t.fuera();
select t.igual_sup('C1 el agente se lleva 1 trabajo', 'select count(*)::text from t.tomadas', '1');
select t.igual_sup('C1 es el suyo, con su contenido', $q$select contenido -> 'lineas' -> 0 ->> 'texto' from t.tomadas$q$, 'uno');
select t.igual_sup('C1 llega ya como imprimiendo con 1 intento', 'select estado || ''/'' || intentos from t.tomadas', 'imprimiendo/1');
select t.igual_sup('C1 lo que devuelve NO trae quién lo creó (creada_por en null)', 'select coalesce(creada_por, ''(null)'') from t.tomadas', '(null)');
select t.igual_sup('C1 trae el tipo y el id para poder confirmar', $q$select tipo || '/' || (id = t.vv('j1')::uuid)::text from t.tomadas$q$, 'cuenta/true');
select t.igual_sup('C1 en la tabla queda imprimiendo/1, tomado por la caja y con la hora', $q$select estado || '/' || intentos || '/' || (tomada_por = t.pid('caja'))::text || '/' || (tomada_en is not null)::text from public.impresiones where id = t.vv('j1')::uuid$q$, 'imprimiendo/1/true/true');
select t.como('anon');
select t.igual('C1 un segundo tomar no lo vuelve a entregar', $q$select t.toma('caja')::text$q$, '0');
select t.fuera();

-- ── C2. confirmar ───────────────────────────────────────────
select t.como('anon');
select t.igual('C2 confirmar ok → impresa', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('j1')::uuid, true)) ->> 'estado'$q$, 'impresa');
select t.fuera();
select t.igual_sup('C2 queda impresa con la hora y sin error', $q$select estado || '/' || (impresa_en is not null)::text || '/' || coalesce(error, '(null)') from public.impresiones where id = t.vv('j1')::uuid$q$, 'impresa/true/(null)');
select t.como('anon');
select t.igual('C2 confirmar otra vez: no_imprimiendo (ya está impresa)', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('j1')::uuid, true)) ->> 'codigo'$q$, 'no_imprimiendo');
select t.igual('C2 y dice en qué estado está', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('j1')::uuid, false, 'x')) ->> 'estado'$q$, 'impresa');
select t.igual('C2 un id que no existe: no_existe', $q$select (public.impresora_confirmar(t.tok('caja'), gen_random_uuid(), true)) ->> 'codigo'$q$, 'no_existe');
select t.igual('C2 un id nulo: no_existe', $q$select (public.impresora_confirmar(t.tok('caja'), null, true)) ->> 'codigo'$q$, 'no_existe');
select t.igual('C2 el trabajo de OTRA impresora responde igual que uno que no existe', $q$select (public.impresora_confirmar(t.tok('cocina'), t.vv('j1')::uuid, true)) ->> 'codigo'$q$, 'no_existe');
select t.fuera();
select t.g('j2', t.trabajo('caja', 'dos')::text);
select t.como('anon');
select t.igual('C2 la caja toma el dos', $q$select t.toma_textos('caja')$q$, 'dos');
select t.igual('C2 la cocina no puede confirmar un trabajo de la caja (no_existe, como si no existiera)', $q$select (public.impresora_confirmar(t.tok('cocina'), t.vv('j2')::uuid, true)) ->> 'codigo'$q$, 'no_existe');
select t.igual('C2 y con p_ok null cuenta como fallo: vuelve a pendiente', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('j2')::uuid, null)) ->> 'estado'$q$, 'pendiente');
select t.igual_sup('C2 la causa por omisión es «sin detalle»', $q$select error from public.impresiones where id = t.vv('j2')::uuid$q$, 'sin detalle');
select t.fuera();

-- ── C3. destino: dirigidos y «de cualquiera» ────────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('cocina', 'Cocina');
select t.g('a', t.trabajo('caja', 'solo-caja')::text);
select t.g('b', t.trabajo('cocina', 'solo-cocina')::text);
select t.g('c', t.trabajo(null, 'cualquiera')::text);
select t.como('anon');
select t.igual('C3 la caja toma lo suyo y lo de cualquiera, nada de la cocina', $q$select t.toma_textos('caja', 10)$q$, 'solo-caja,cualquiera');
select t.igual('C3 la cocina toma solo lo suyo (lo de cualquiera ya se lo llevó la caja)', $q$select t.toma_textos('cocina', 10)$q$, 'solo-cocina');
select t.fuera();
select t.igual_sup('C3 cada uno quedó tomado por quien lo tomó', $q$select string_agg(i.contenido -> 'lineas' -> 0 ->> 'texto' || '=' || p.nombre, ',' order by i.creada_en, i.id) from public.impresiones i join public.impresoras p on p.id = i.tomada_por$q$, 'solo-caja=Caja,solo-cocina=Cocina,cualquiera=Caja');

-- ── C4. reintentos: 3 intentos y luego error definitivo ─────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.g('r', t.trabajo('caja', 'reintento')::text);
select t.como('anon');
select t.igual('C4 intento 1', $q$select t.toma('caja')::text$q$, '1');
select t.igual('C4 falla 1: vuelve a pendiente', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('r')::uuid, false, 'sin papel')) ->> 'estado'$q$, 'pendiente');
select t.igual_sup('C4 con el error a la vista y 1 intento', $q$select t.est(t.vv('r')::uuid) || '/' || (select error from public.impresiones where id = t.vv('r')::uuid)$q$, 'pendiente/1/sin papel');
select t.igual('C4 intento 2', $q$select t.toma('caja')::text$q$, '1');
select t.igual('C4 falla 2: pendiente', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('r')::uuid, false, 'sin papel otra vez')) ->> 'estado'$q$, 'pendiente');
select t.igual('C4 intento 3', $q$select t.toma('caja')::text$q$, '1');
select t.igual('C4 falla 3: error DEFINITIVO', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('r')::uuid, false, 'la impresora no existe')) ->> 'estado'$q$, 'error');
select t.igual_sup('C4 queda en error/3 con la última causa', $q$select t.est(t.vv('r')::uuid) || '/' || (select error from public.impresiones where id = t.vv('r')::uuid)$q$, 'error/3/la impresora no existe');
select t.igual('C4 y ya nadie lo toma', $q$select t.toma('caja')::text$q$, '0');
select t.igual('C4 ni se puede confirmar de nuevo', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('r')::uuid, true)) ->> 'codigo'$q$, 'no_imprimiendo');
select t.fuera();
select t.g('s', t.trabajo('caja', 'sanear')::text);
select t.como('anon');
select t.toma('caja');
select t.igual('C4 el texto del error sale limpio de caracteres de control',
  $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('s')::uuid, false, E'se cayó\x01\x1b[2J\r\nahora\x7f')) ->> 'ok'$q$, 'true');
select t.igual_sup('C4 sin controles (ESC, CR, LF, DEL…)', $q$select (error !~ '[\x01-\x1f\x7f]')::text || '/' || error from public.impresiones where id = t.vv('s')::uuid$q$, 'true/se cayó [2J ahora');
select t.toma('caja');
select t.igual('C4 un error larguísimo se corta a 300 caracteres', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('s')::uuid, false, repeat('x', 5000))) ->> 'ok'$q$, 'true');
select t.igual_sup('C4 (los 300)', $q$select length(error)::text from public.impresiones where id = t.vv('s')::uuid$q$, '300');
select t.toma('caja');
select t.igual('C4 un error solo de controles queda «sin detalle»', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('s')::uuid, false, E'\x01\x02')) ->> 'ok'$q$, 'true');
select t.igual_sup('C4 (sin detalle)', $q$select error from public.impresiones where id = t.vv('s')::uuid$q$, 'sin detalle');
select t.fuera();

-- un trabajo que falla una vez y luego sale bien no arrastra el error de antes
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.g('rb', t.trabajo('caja', 'falla y luego sale')::text);
select t.como('anon');
select t.toma('caja');
select t.sale('C4 primer intento: falla', $q$select public.impresora_confirmar(t.tok('caja'), t.vv('rb')::uuid, false, 'sin papel')$q$);
select t.toma('caja');
select t.igual('C4 segundo intento: sale bien', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('rb')::uuid, true)) ->> 'estado'$q$, 'impresa');
select t.fuera();
select t.igual_sup('C4 y ya no arrastra el error de antes', $q$select coalesce(error, '(null)') || '/' || estado || '/' || intentos from public.impresiones where id = t.vv('rb')::uuid$q$, '(null)/impresa/2');

-- ── C5. trabados: más de 2 minutos sin confirmar ────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('cocina', 'Cocina');
select t.g('t1', t.trabajo('caja', 'trabado')::text);
select t.como('anon');
select t.igual('C5 se toma', $q$select t.toma('caja')::text$q$, '1');
select t.fuera();
select t.envejecer(t.vv('t1')::uuid, interval '1 minute');
select t.como('anon');
select t.igual('C5 con 1 minuto de tomado NO se reentrega (el agente puede estar imprimiéndolo)', $q$select t.toma('caja')::text$q$, '0');
select t.fuera();
select t.envejecer(t.vv('t1')::uuid, interval '2 minutes');
select t.como('anon');
select t.igual('C5 con 3 minutos de tomado se reentrega', $q$select t.toma_textos('caja')$q$, 'trabado');
select t.igual_sup('C5 con 2 intentos', $q$select t.est(t.vv('t1')::uuid)$q$, 'imprimiendo/2');
select t.fuera();
select t.envejecer(t.vv('t1')::uuid, interval '3 minutes');
select t.como('anon');
select t.igual('C5 trabado otra vez: tercer intento', $q$select t.toma_textos('caja')$q$, 'trabado');
select t.igual_sup('C5 con 3 intentos', $q$select t.est(t.vv('t1')::uuid)$q$, 'imprimiendo/3');
select t.fuera();
select t.envejecer(t.vv('t1')::uuid, interval '3 minutes');
select t.como('anon');
select t.igual('C5 trabado con los 3 intentos gastados: ya NO se reentrega', $q$select t.toma('caja')::text$q$, '0');
select t.igual_sup('C5 pasa a error definitivo', $q$select t.est(t.vv('t1')::uuid)$q$, 'error/3');
select t.fuera();
select t.igual_sup('C5 con el motivo', $q$select error from public.impresiones where id = t.vv('t1')::uuid$q$, 'se trabó: la impresora no confirmó tras 3 intentos');

-- de cualquiera: lo puede reintentar OTRA impresora, y la primera ya no manda sobre él
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.nueva_impresora('cocina', 'Cocina');
select t.g('u1', t.trabajo(null, 'viaja')::text);
select t.como('anon');
select t.igual('C5 la caja toma el de cualquiera', $q$select t.toma('caja')::text$q$, '1');
select t.fuera();
select t.envejecer(t.vv('u1')::uuid, interval '3 minutes');
select t.como('anon');
select t.igual('C5 la caja se cae; la cocina lo toma por trabado', $q$select t.toma_textos('cocina')$q$, 'viaja');
select t.igual_sup('C5 ahora lo tiene la cocina con 2 intentos', $q$select t.est(t.vv('u1')::uuid) || '/' || (select p.nombre from public.impresiones i join public.impresoras p on p.id = i.tomada_por where i.id = t.vv('u1')::uuid)$q$, 'imprimiendo/2/Cocina');
select t.igual('C5 la confirmación tardía de la caja (que ya no lo tiene) no cuenta: no_imprimiendo', $q$select (public.impresora_confirmar(t.tok('caja'), t.vv('u1')::uuid, true)) ->> 'codigo'$q$, 'no_imprimiendo');
select t.igual_sup('C5 sigue imprimiéndose', $q$select t.est(t.vv('u1')::uuid)$q$, 'imprimiendo/2');
select t.igual('C5 la de la cocina sí', $q$select (public.impresora_confirmar(t.tok('cocina'), t.vv('u1')::uuid, true)) ->> 'estado'$q$, 'impresa');
select t.fuera();

-- un dirigido a la caja NO lo reintenta la cocina aunque esté trabado
select t.g('u2', t.trabajo('caja', 'de la caja')::text);
select t.como('anon');
select t.toma('caja');
select t.fuera();
select t.envejecer(t.vv('u2')::uuid, interval '5 minutes');
select t.como('anon');
select t.igual('C5 un dirigido a la caja, trabado, no lo reintenta la cocina', $q$select t.toma('cocina', 20)::text$q$, '0');
select t.fuera();
select t.igual_sup('C5 y sigue siendo de la caja', $q$select t.est(t.vv('u2')::uuid)$q$, 'imprimiendo/1');

-- ── C6. caducidad: nadie lo tomó en 15 minutos ──────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.g('k1', t.trabajo('caja', 'viejo')::text);
select t.g('k2', t.trabajo('caja', 'reciente')::text);
select t.g('k3', t.trabajo(null, 'viejo de cualquiera')::text);
select t.envejecer(t.vv('k1')::uuid, interval '16 minutes');
select t.envejecer(t.vv('k2')::uuid, interval '14 minutes');
select t.envejecer(t.vv('k3')::uuid, interval '16 minutes');
select t.g('k5', t.trabajo('caja', 'ya impreso')::text);
update public.impresiones set estado = 'impresa', impresa_en = now() where id = t.vv('k5')::uuid;
select t.envejecer(t.vv('k5')::uuid, interval '16 minutes');
select t.como('anon');
select t.igual('C6 el PC vuelve: solo se lleva el de hace 14 minutos', $q$select t.toma_textos('caja', 10)$q$, 'reciente');
select t.fuera();
select t.igual_sup('C6 los de hace 16 minutos pasaron a error (el de cualquiera también)', $q$select string_agg(t.est(v.valor::uuid), ',' order by v.clave) from t.v v where v.clave in ('k1', 'k3')$q$, 'error/0,error/0');
select t.igual_sup('C6 con el motivo', $q$select error from public.impresiones where id = t.vv('k1')::uuid$q$, 'caducó: la impresora no la tomó a tiempo');
select t.igual_sup('C6 y NO se tocó el que sí se tomó', $q$select t.est(t.vv('k2')::uuid)$q$, 'imprimiendo/1');
select t.igual_sup('C6 un trabajo ya impreso (aunque tenga 16 minutos) no caduca ni cambia', $q$select t.est(t.vv('k5')::uuid)$q$, 'impresa/0');

-- ── C7. cuántos se llevan y en qué orden ────────────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
do $$
declare i int;
begin
  -- 28 trabajos, del más viejo (j1, hace 27 minutos... pero la caducidad es de 15: se escalonan por segundos)
  for i in 1..28 loop
    perform t.g('w' || i, t.trabajo('caja', 'w' || lpad(i::text, 2, '0'))::text);
    perform t.envejecer(t.vv('w' || i)::uuid, make_interval(secs => (30 - i)));   -- w01 el más viejo
  end loop;
end $$;
select t.como('anon');
select t.igual('C7 p_max = 3 se lleva los 3 más viejos, en orden', $q$select t.toma_textos('caja', 3)$q$, 'w01,w02,w03');
select t.igual('C7 p_max = 0 se sube a 1', $q$select t.toma_textos('caja', 0)$q$, 'w04');
select t.igual('C7 p_max negativo se sube a 1', $q$select t.toma_textos('caja', -5)$q$, 'w05');
select t.igual('C7 p_max null es 5', $q$select t.toma_textos('caja', null)$q$, 'w06,w07,w08,w09,w10');
select t.igual('C7 sin p_max es 5 (valor por omisión)', $q$select count(*)::text from public.impresora_tomar(t.tok('caja'))$q$, '5');
select t.igual('C7 p_max = 1000 se baja a 20', $q$select t.toma('caja', 1000)::text$q$, '13');
select t.fuera();
select t.partida();
select t.nueva_impresora('caja', 'Caja');
insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 30);
select t.como('anon');
select t.igual('C7 con 30 pendientes y p_max = 1000 se llevan 20', $q$select t.toma('caja', 1000)::text$q$, '20');
select t.igual('C7 y quedan 10', $q$select t.toma('caja', 1000)::text$q$, '10');
select t.fuera();

-- ── C8. cancelar ────────────────────────────────────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.g('x1', t.trabajo('caja', 'cancelame')::text);
select t.g('x2', t.trabajo('caja', 'imprimiéndose')::text);
select t.como('mesero');
select t.igual('C8 el mesero cancela uno pendiente', $q$select (public.impresion_cancelar(t.vv('x1')::uuid)) ->> 'ok'$q$, 'true');
select t.fuera();
select t.igual_sup('C8 queda en error/0 «cancelada»', $q$select t.est(t.vv('x1')::uuid) || '/' || (select error from public.impresiones where id = t.vv('x1')::uuid)$q$, 'error/0/cancelada');
select t.como('mesero');
select t.igual('C8 cancelar otra vez: no_pendiente', $q$select (public.impresion_cancelar(t.vv('x1')::uuid)) ->> 'codigo'$q$, 'no_pendiente');
select t.fuera();
select t.como('anon');
select t.igual('C8 el agente NO ve el cancelado: solo el otro', $q$select t.toma_textos('caja', 10)$q$, 'imprimiéndose');
select t.como('mesero');
select t.igual('C8 uno que ya se está imprimiendo no se puede cancelar', $q$select (public.impresion_cancelar(t.vv('x2')::uuid)) ->> 'codigo'$q$, 'no_pendiente');
select t.igual('C8 y dice el estado', $q$select (public.impresion_cancelar(t.vv('x2')::uuid)) ->> 'estado'$q$, 'imprimiendo');
select t.igual('C8 un id que no existe', $q$select (public.impresion_cancelar(gen_random_uuid())) ->> 'codigo'$q$, 'no_existe');
select t.igual('C8 el mesero2 también puede (cualquiera del personal)', $q$select (public.impresion_cancelar(null)) ->> 'codigo'$q$, 'no_existe');
select t.fuera();
select t.igual_sup('C8 el imprimiéndose siguió en lo suyo', $q$select t.est(t.vv('x2')::uuid)$q$, 'imprimiendo/1');

-- ── C9. el token: rotación, desactivación, basura ───────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.g('viejo', t.tok('caja'));
select t.g('pend', t.trabajo('caja', 'sobrevive')::text);
select t.como('admin');
select t.g('rot', (public.impresora_rotar(t.pid('caja'))) ->> 'token');
select t.fuera();
select t.como('anon');
select t.igual('C9 tras rotar, el token viejo no toma nada', $q$select count(*)::text from public.impresora_tomar(t.vv('viejo'), 5)$q$, '0');
select t.igual('C9 ni confirma', $q$select (public.impresora_confirmar(t.vv('viejo'), t.vv('pend')::uuid, true)) ->> 'codigo'$q$, 'no_autorizado');
select t.igual('C9 ni da latido', $q$select (public.impresora_latido(t.vv('viejo'), 'x')) ->> 'codigo'$q$, 'no_autorizado');
select t.igual('C9 el token viejo y uno inventado dan EXACTAMENTE la misma respuesta (sin pistas)',
  $q$select ((public.impresora_latido(t.vv('viejo'), 'x'))::text = (public.impresora_latido(repeat('q', 68), 'x'))::text)::text$q$, 'true');
select t.igual('C9 con el token nuevo se lleva el trabajo que ya estaba esperando (la rotación no pierde nada)', $q$select count(*)::text from public.impresora_tomar(t.vv('rot'), 5)$q$, '1');
select t.fuera();
select t.como('admin');
select t.igual('C9 el admin desactiva la caja', format($q$select (public.impresora_activar('%s', false)) ->> 'activa'$q$, t.pid('caja')), 'false');
select t.fuera();
select t.g('p2', t.trabajo('caja', 'nadie')::text);
select t.como('anon');
select t.igual('C9 desactivada: su token no toma', $q$select count(*)::text from public.impresora_tomar(t.vv('rot'), 5)$q$, '0');
select t.igual('C9 desactivada: su latido da no_autorizado, igual que un token inventado', $q$select ((public.impresora_latido(t.vv('rot'), 'x'))::text = (public.impresora_latido(repeat('q', 68), 'x'))::text)::text$q$, 'true');
select t.fuera();
select t.como('admin');
select t.igual('C9 el admin la reactiva', format($q$select (public.impresora_activar('%s', true)) ->> 'activa'$q$, t.pid('caja')), 'true');
select t.como('anon');
select t.igual('C9 reactivada: el mismo token vuelve a servir y se lleva lo que esperaba', $q$select count(*)::text from public.impresora_tomar(t.vv('rot'), 5)$q$, '1');
select t.fuera();

-- ── C10. el latido que anota tomar ──────────────────────────
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.igual_sup('C10 una impresora recién creada no tiene latido', $q$select coalesce(ultimo_latido::text, '(null)') from public.impresoras where id = t.pid('caja')$q$, '(null)');
select t.como('anon');
select t.toma('caja');
select t.fuera();
select t.igual_sup('C10 tomar anota el último latido', $q$select (ultimo_latido > now() - interval '5 seconds')::text from public.impresoras where id = t.pid('caja')$q$, 'true');
update public.impresoras set ultimo_latido = now() - interval '5 seconds';
select t.como('anon');
select t.toma('caja');
select t.fuera();
select t.igual_sup('C10 pero no lo reescribe si pasaron menos de 10 s (no engorda la tabla con cada sondeo)', $q$select (ultimo_latido < now() - interval '4 seconds')::text from public.impresoras where id = t.pid('caja')$q$, 'true');
update public.impresoras set ultimo_latido = now() - interval '30 seconds';
select t.como('anon');
select t.toma('caja');
select t.fuera();
select t.igual_sup('C10 y sí si pasaron más de 10 s', $q$select (ultimo_latido > now() - interval '5 seconds')::text from public.impresoras where id = t.pid('caja')$q$, 'true');
select t.como('anon');
select t.toma('zzz-token-inventado-que-no-existe');
select t.fuera();
select t.igual_sup('C10 un token inventado no anota latido en ninguna', $q$select count(*)::text from public.impresoras where ultimo_latido < now() - interval '5 seconds'$q$, '0');
