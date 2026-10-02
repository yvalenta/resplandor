-- F: la forma y el tamaño del contenido, el tipo, y el tope por persona (30 por minuto).
select t.partida();
select t.nueva_impresora('caja');
select t.como('mesero');

-- ── F1. el tipo ─────────────────────────────────────────────
select t.sale('F1 tipo cuenta', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$);
select t.sale('F1 tipo ticket', $q$insert into public.impresiones (tipo, contenido) values ('ticket', t.docj())$q$);
select t.sale('F1 tipo abono', $q$insert into public.impresiones (tipo, contenido) values ('abono', t.docj())$q$);
select t.sale('F1 tipo cierre', $q$insert into public.impresiones (tipo, contenido) values ('cierre', t.docj())$q$);
select t.sale('F1 tipo prueba', $q$insert into public.impresiones (tipo, contenido) values ('prueba', t.docj())$q$);
select t.falla('F1 un tipo que no está en la lista da 23514', $q$insert into public.impresiones (tipo, contenido) values ('cuentas', t.docj())$q$, '^23514.*impresiones_tipo_check');
select t.falla('F1 tipo nulo da 23502', $q$insert into public.impresiones (tipo, contenido) values (null, t.docj())$q$, '^23502');
select t.falla('F1 tipo con mayúsculas no pasa', $q$insert into public.impresiones (tipo, contenido) values ('Cuenta', t.docj())$q$, '^23514');

-- ── F2. la forma del contenido ──────────────────────────────
select t.falla('F2 un arreglo no es un documento', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '[]'::jsonb)$q$, '^23514.*impresiones_contenido_forma_check');
select t.falla('F2 un texto suelto no es un documento', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '"hola"'::jsonb)$q$, '^23514.*impresiones_contenido_forma_check');
select t.falla('F2 un número no es un documento', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '5'::jsonb)$q$, '^23514');
select t.falla('F2 el null de JSON no es un documento', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', 'null'::jsonb)$q$, '^23514');
select t.falla('F2 el null de SQL da 23502', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', null)$q$, '^23502');
select t.falla('F2 {} no trae nada que imprimir', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '{}'::jsonb)$q$, '^23514.*impresiones_contenido_forma_check');
select t.falla('F2 sin lineas ni orden (solo un título)', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '{"titulo":"x"}'::jsonb)$q$, '^23514');
select t.falla('F2 lineas vacío', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '{"lineas":[]}'::jsonb)$q$, '^23514');
select t.falla('F2 lineas como objeto', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '{"lineas":{}}'::jsonb)$q$, '^23514');
select t.falla('F2 lineas como texto', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '{"lineas":"x"}'::jsonb)$q$, '^23514');
select t.falla('F2 lineas null', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '{"lineas":null}'::jsonb)$q$, '^23514');
select t.sale('F2 una línea basta', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', '{"lineas":[{"texto":"a"}]}'::jsonb)$q$);
select t.sale('F2 el formato completo del contrato', $q$insert into public.impresiones (tipo, contenido) values ('ticket', '{"titulo":"Ticket · Mesa 4","lineas":[{"texto":"2 × Paloma","der":"$ 10.000","sangria":0},{"texto":"sin queso","sangria":1,"negrita":true},{"texto":"TOTAL","der":"$ 10.000","doble":true,"alinear":"der"}],"qr":"https://example.test/t/abc","cortar":true}'::jsonb)$q$);
select t.sale('F2 la orden normalizada, en lugar de lineas', $q$insert into public.impresiones (tipo, contenido) values ('ticket', '{"orden":{"id":"o1","items":[]}}'::jsonb)$q$);
select t.falla('F2 orden como texto no vale', $q$insert into public.impresiones (tipo, contenido) values ('ticket', '{"orden":"x"}'::jsonb)$q$, '^23514');
select t.falla('F2 orden como arreglo no vale', $q$insert into public.impresiones (tipo, contenido) values ('ticket', '{"orden":[]}'::jsonb)$q$, '^23514');
select t.sale('F2 una prueba puede ir con {} (el agente imprime su página de prueba)', $q$insert into public.impresiones (tipo, contenido) values ('prueba', '{}'::jsonb)$q$);
select t.falla('F2 pero una prueba tampoco puede ser un arreglo', $q$insert into public.impresiones (tipo, contenido) values ('prueba', '[]'::jsonb)$q$, '^23514');
select t.falla('F2 ni un texto', $q$insert into public.impresiones (tipo, contenido) values ('prueba', '"x"'::jsonb)$q$, '^23514');
select t.sale('F2 500 líneas (el máximo)', $q$insert into public.impresiones (tipo, contenido) select 'cuenta', jsonb_build_object('lineas', jsonb_agg(jsonb_build_object('texto', 'x'))) from generate_series(1, 500)$q$);
select t.falla('F2 501 líneas no', $q$insert into public.impresiones (tipo, contenido) select 'cuenta', jsonb_build_object('lineas', jsonb_agg(jsonb_build_object('texto', 'x'))) from generate_series(1, 501)$q$, '^23514.*impresiones_contenido_forma_check');

-- ── F3. el tamaño: 32768 BYTES del JSON (no caracteres) ─────
select t.sale('F3 justo 32768 bytes de contenido',
  format($q$insert into public.impresiones (tipo, contenido) values ('cuenta', jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('texto', repeat('x', %s)))))$q$,
         32768 - octet_length('{"lineas":[{"texto":""}]}'::jsonb::text)));
select t.falla('F3 32769 bytes no',
  format($q$insert into public.impresiones (tipo, contenido) values ('cuenta', jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('texto', repeat('x', %s)))))$q$,
         32769 - octet_length('{"lineas":[{"texto":""}]}'::jsonb::text)), '^23514.*impresiones_contenido_tamano_check');
select t.falla('F3 el tamaño cuenta bytes: 16400 «ñ» son 16400 caracteres pero 32800 bytes',
  $q$insert into public.impresiones (tipo, contenido) values ('cuenta', jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('texto', repeat('ñ', 16400)))))$q$, '^23514.*impresiones_contenido_tamano_check');
select t.sale('F3 y 16000 «ñ» (32000 bytes) sí caben',
  $q$insert into public.impresiones (tipo, contenido) values ('cuenta', jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('texto', repeat('ñ', 16000)))))$q$);
select t.falla('F3 100 KB tampoco',
  $q$insert into public.impresiones (tipo, contenido) values ('cuenta', jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('texto', repeat('x', 100000)))))$q$, '^23514.*tamano');
select t.falla('F3 una prueba de 40 KB tampoco', $q$insert into public.impresiones (tipo, contenido) values ('prueba', jsonb_build_object('x', repeat('x', 40000)))$q$, '^23514.*tamano');
select t.falla('F3 orden_id de 101 caracteres no', $q$insert into public.impresiones (tipo, orden_id, contenido) values ('cuenta', repeat('o', 101), t.docj())$q$, '^23514.*orden_id');
select t.sale('F3 orden_id de 100 sí', $q$insert into public.impresiones (tipo, orden_id, contenido) values ('cuenta', repeat('o', 100), t.docj())$q$);

-- ── F4. el tope: 30 por persona y por minuto ────────────────
select t.partida();
select t.nueva_impresora('caja');
select t.como('mesero');
select t.sale('F4 30 de un golpe en un solo INSERT (el máximo)', $q$insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 30)$q$);
select t.igual('F4 el mesero tiene 30', $q$select count(*)::text from public.impresiones where creada_por = 'mesero1@resplandor.test'$q$, '30');
select t.falla('F4 la 31 se rechaza con RS030', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^RS030.*demasiadas impresiones');
select t.igual('F4 y no entró', $q$select count(*)::text from public.impresiones where creada_por = 'mesero1@resplandor.test'$q$, '30');
select t.como('mesero2');
select t.sale('F4 el tope es POR PERSONA: mesero2 no lo ve', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$);
select t.falla('F4 mesero2 con 30 más en un solo INSERT: 31 en total, se rechaza TODO',  $q$insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 30)$q$, '^RS030');
select t.igual('F4 y de esos 30 no entró ninguno (el error deshace toda la sentencia)', $q$select count(*)::text from public.impresiones where creada_por = 'mesero2@resplandor.test'$q$, '1');
select t.falla('F4 un INSERT de 500 filas de un golpe tampoco esquiva el tope', $q$insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 500)$q$, '^RS030');
select t.sale('F4 29 más sí (en total 30)', $q$insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 29)$q$);
select t.falla('F4 y una más ya no', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^RS030');
select t.como('admin');
select t.sale('F4 el admin tiene su propio cupo (no hay cupo global)', $q$insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 30)$q$);
select t.falla('F4 pero el admin también tiene tope', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^RS030');
select t.como('mesero');
select t.falla('F4 el tope no se vence con un error en la misma ventana', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^RS030');

-- la ventana: 59 s todavía cuentan, 61 s ya no
select t.fuera();
update public.impresiones set creada_en = now() - interval '59 seconds' where creada_por = 'mesero1@resplandor.test';
select t.como('mesero');
select t.falla('F4 con 30 trabajos de hace 59 s sigue el tope', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^RS030');
select t.fuera();
update public.impresiones set creada_en = now() - interval '61 seconds' where creada_por = 'mesero1@resplandor.test';
select t.como('mesero');
select t.sale('F4 con 30 trabajos de hace 61 s ya puede otra vez', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$);
select t.igual('F4 y el mesero2 sigue con el suyo (el tope no se mueve de una persona a otra)', $q$select count(*)::text from public.impresiones where creada_por = 'mesero2@resplandor.test' and creada_en > now() - interval '1 minute'$q$, '30');

-- el dueño no tiene tope (el tope es de la API)
select t.fuera();
select t.sale('F4 el dueño de la base inserta 100 de un golpe (sin tope)', $q$insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 100)$q$);
select t.igual('F4 con creada_por nulo', $q$select count(*)::text from public.impresiones where creada_por is null$q$, '100');
-- y los que no son personal no llegan ni a gastarle cupo a nadie
select t.como('ajena');
select t.falla('F4 una cuenta ajena recibe 42501 (no RS030) aunque tenga 0 trabajos', $q$insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj())$q$, '^42501');
select t.fuera();

-- ── F5. la integridad de los estados (como dueño: ni siquiera quien escribe directo puede dejar una fila incoherente) ──
select t.partida();
select t.nueva_impresora('caja', 'Caja');
select t.falla('F5 «impresa» sin hora de impresión', $q$insert into public.impresiones (tipo, contenido, estado) values ('cuenta', t.docj(), 'impresa')$q$, '^23514.*impresiones_impresa_check');
select t.falla('F5 una hora de impresión en uno pendiente', $q$insert into public.impresiones (tipo, contenido, impresa_en) values ('cuenta', t.docj(), now())$q$, '^23514.*impresiones_impresa_check');
select t.sale('F5 «impresa» con su hora', $q$insert into public.impresiones (tipo, contenido, estado, impresa_en) values ('cuenta', t.docj(), 'impresa', now())$q$);
select t.falla('F5 un estado que no existe', $q$insert into public.impresiones (tipo, contenido, estado) values ('cuenta', t.docj(), 'raro')$q$, '^23514.*impresiones_estado_check');
select t.falla('F5 intentos de más', $q$insert into public.impresiones (tipo, contenido, intentos) values ('cuenta', t.docj(), 11)$q$, '^23514.*impresiones_intentos_check');
select t.falla('F5 intentos negativos', $q$insert into public.impresiones (tipo, contenido, intentos) values ('cuenta', t.docj(), -1)$q$, '^23514.*impresiones_intentos_check');
select t.falla('F5 un error de 501 caracteres', $q$insert into public.impresiones (tipo, contenido, estado, error) values ('cuenta', t.docj(), 'error', repeat('e', 501))$q$, '^23514.*impresiones_error_check');
select t.sale('F5 uno de 500', $q$insert into public.impresiones (tipo, contenido, estado, error) values ('cuenta', t.docj(), 'error', repeat('e', 500))$q$);
select t.falla('F5 una impresora con un hash que no es sha256 hex', $q$insert into public.impresoras (nombre, token_hash) values ('Mala', 'imp_no_es_un_hash')$q$, '^23514.*impresoras_token_hash_check');
select t.falla('F5 dos impresoras con el mismo hash', $q$insert into public.impresoras (nombre, token_hash) select 'Doble', token_hash from public.impresoras limit 1$q$, '^23505.*impresoras_token_hash_key');
select t.falla('F5 un nombre con espacios en los bordes', $q$insert into public.impresoras (nombre, token_hash) values (' Caja ', repeat('a', 64))$q$, '^23514.*impresoras_nombre_check');
select t.falla('F5 una versión de 41 caracteres', $q$insert into public.impresoras (nombre, token_hash, version_agente) values ('V', repeat('b', 64), repeat('v', 41))$q$, '^23514.*impresoras_version_check');
