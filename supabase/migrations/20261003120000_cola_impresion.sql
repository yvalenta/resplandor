-- ════════════════════════════════════════════════════════════
-- Resplandor — la COLA DE IMPRESIÓN en la base (imprimir en la caja desde cualquier teléfono)
-- (pedido de Yonatan, 2026-10-01: «imprimir en el PC del restaurante sin importar desde qué
--  dispositivo esté conectado»; reemplaza la propuesta de Tailscale en cada celular)
--
-- Idea. Los teléfonos no instalan nada: el POS inserta un TRABAJO en `impresiones`; el PC de la
-- caja corre un agente (carpeta impresora/) que SOLO hace conexiones salientes a Supabase: oye una
-- señal por Realtime, toma los trabajos, los manda RAW a la térmica y confirma. Sin puertos
-- abiertos, sin VPN, detrás de cualquier router. Funciona con wifi o con datos.
--
-- Qué hace
--   1. `public.impresoras`: una fila por impresora (el PC de la caja). Guarda SOLO el hash del
--      token del agente (sha256, hex); el token en claro vive en el config.json del PC y se le
--      muestra al admin UNA vez, al crearlo o rotarlo. Solo el admin la lee, y sin token_hash:
--      el permiso es por COLUMNA, así que ni `select *` ni `select token_hash` pasan.
--   2. `public.impresiones`: la cola. El POS inserta solo (id, impresora_id, tipo, mesa_id,
--      orden_id, contenido); el resto (estado, intentos, creada_por, tiempos) lo pone la base, y
--      el cliente no puede escribirlo (permiso por columna + policy). Sin UPDATE ni DELETE para
--      nadie de la API. Entra a supabase_realtime: el POS ve «En cola → Impreso» en vivo.
--   3. El agente habla con tres RPC que se autentican con el TOKEN (no con una sesión):
--      impresora_tomar, impresora_confirmar, impresora_latido. Ejecutables por `anon` (el agente
--      usa la llave publishable). Un token inválido, rotado o de una impresora desactivada es
--      indistinguible: tomar devuelve vacío, las otras dos {ok:false, codigo:'no_autorizado'}.
--   4. La SEÑAL: al insertar un trabajo, un trigger emite UNA señal sin datos por Realtime al
--      tópico de la impresora destino (o al de todas las activas si impresora_id es null):
--          tópico = 'impresora:' || hex(sha256(utf8(token)))   -- 'impresora:' + token_hash
--          evento = 'trabajo'      payload = {}      canal público (private = false)
--      Igual que la cuenta en vivo (20261001120000): quien conoce el tópico ya conocía el token y
--      por el canal no viaja ningún dato; el agente vuelve a pedirlos con impresora_tomar. Si
--      realtime.send falla, la inserción NO falla (solo un WARNING): el agente además sondea cada
--      5 s. Vector de prueba, el mismo que el de la cuenta (el sha256 de un token de 48 ceros):
--          token  = '0' × 48
--          tópico = impresora:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a
--      (la propia migración lo comprueba y se detiene si no coincide).
--      NO hay policy en realtime.messages: en un canal público no se evalúan, y agregar una para
--      `anon` solo abriría más. El aislamiento es el tópico, que sale de un secreto de 256 bits y
--      cuyo hash el cliente no puede leer.
--   5. Administración (solo admin): impresora_crear, impresora_rotar, impresora_activar. Para el
--      POS (todo el personal): impresora_estado (¿hay caja en línea?) e impresion_cancelar.
--   6. Mantenimiento (al insertar y en cada tomar): caduca lo que lleva más de 15 minutos sin
--      imprimirse (lo que nadie tomó Y lo que se tomó y se trabó), se rinde con lo que se trabó tras
--      3 intentos y purga lo impreso o fallido de más de 7 días. Nunca rompe la inserción.
--
-- Números que importan (están en el código; esta tabla es el único lugar que los junta)
--   tope por persona ........ 30 trabajos por minuto (SQLSTATE RS030), contados DESPUÉS de insertar
--                             para que un INSERT de muchas filas no lo esquive
--   tamaño del contenido .... 32768 bytes de texto JSON, máximo 500 líneas
--   trabado ................. 'imprimiendo' sin confirmar tras 2 minutos se reintenta, SOLO si el trabajo
--                             tiene menos de 15 minutos de creado
--   intentos ................ 3; el tercero que falla (o se traba) deja el trabajo en 'error'
--   caducidad ............... un trabajo de más de 15 minutos desde que se creó que sigue 'pendiente', o que
--                             se tomó y se trabó (2 minutos sin confirmar), pasa a 'error' («caducó»): al
--                             volver un PC apagado, o que se colgó a media impresión, no imprime cuentas de
--                             hace una hora. El POS cae a su propio papel mucho antes (25 s en cola, 2,5 min
--                             imprimiéndose) y cancela lo que dejó en la caja (impresion_cancelar)
--   purga ................... 'impresa' o 'error' de más de 7 días se borran
--   en línea ................ último latido de menos de 90 s
--   latido por sondeo ....... tomar solo reescribe ultimo_latido si pasaron más de 10 s
--
-- Garantía de entrega: AL MENOS UNA VEZ. Si el agente manda un trabajo al spooler y se cae antes
-- de confirmar, a los 2 minutos otro tomar lo reintenta (si el trabajo tiene menos de 15 minutos) y sale
-- otra copia (como mucho 3). El agente puede evitarlo recordando en disco los ids que ya mandó. El agente
-- toma UN trabajo por vez y cada uno tiene un tope de 30 s en el spooler: la ventana de 2 minutos no se
-- cumple mientras el agente está vivo y trabajando. Ningún trabajo lo toman dos
-- agentes a la vez (FOR UPDATE SKIP LOCKED) ni sale dos veces sin una caída de por medio.
--
-- CONTRATO DEL CONTENIDO (el agente NO confía en nada de esto: filtra los bytes de control)
--   La base solo exige un objeto JSON de a lo sumo 32 KB que traiga `lineas` (arreglo de 1 a 500), para
--   todos los tipos (también 'prueba'): es lo que el agente sabe imprimir, y un documento que no lo trae se
--   rechaza al insertar (23514) en vez de gastar 3 intentos en el PC. El documento va YA ARMADO por el POS:
--   la base no guarda «la orden» para que el agente la formatee.
--   El formato que el POS y el agente comparten (el POS manda como mucho 300 líneas y 30 KB y, si la cuenta no
--   cabe, NO la recorta: imprime el teléfono; el agente se niega a sacar más de 600 renglones de papel;
--   la forma completa y lo que acepta el agente están en impresora/ticket/escpos.mjs):
--     { "v": 1,                                   versión del formato
--       "titulo": "Resplandor",                   texto grande centrado (opcional): el nombre del local; «Cuenta · Mesa 4»
--                                                 sale de `tipo` y `mesa_id`, no del documento
--       "lineas": [ { "texto": "2 x Paloma",      la parte izquierda («---» sola = una raya de lado a lado)
--                     "der": "$ 10.000",          la parte derecha (precio) (opcional)
--                     "sangria": 2,               columnas de sangría, p. ej. sublíneas (opcional)
--                     "alinear": "centro",        izq | centro | der (opcional)
--                     "negrita": true, "doble": true } ],
--       "qr": { "texto": "https://…", "etiqueta": "resplandor.ynt.codes" },   o solo el texto; la dirección del QR (opcional)
--       "cortar": true }
--
-- CONTRATO CON EL POS
--   · Crear: insert into impresiones (id?, impresora_id?, tipo, mesa_id?, orden_id?, contenido).
--     `id` puede venir del cliente (uuid): si el reintento de un POS sin red repite el insert, el
--     segundo da 23505 y NO sale otra copia. Sin impresora_id lo toma cualquiera de las activas.
--   · Errores: RS030 = demasiadas seguidas; 23514 = contenido sin forma o de más de 32 KB, tipo
--     fuera de la lista; 42501 = sin permiso (no es personal, o intentó escribir una columna que
--     no es suya). Leer con columnas explícitas: from('impresoras').select('*') da 42501 por el
--     token_hash; el POS lee el estado con impresora_estado() y la lista del admin con
--     select('id,nombre,activa,ultimo_latido,version_agente,creada_en').
--   · «Imprimir en la caja» solo si impresora_estado() trae una con en_linea = true. Si el POS
--     cae al window.print() de hoy después de encolar, o cierra el aviso, que primero llame
--     impresion_cancelar(id): un trabajo 'pendiente' (o 'imprimiendo' trabado: más de 2 minutos sin
--     confirmar) pasa a 'error' («cancelada») y no sale una segunda copia más tarde.
--   · Reintentar = insertar un trabajo nuevo con el mismo contenido.
--   · Para no recibir el contenido de los demás en cada cambio de estado, suscribirse a
--     postgres_changes con filter 'id=eq.<uuid>'.
--
-- Códigos de las RPC (jsonb {ok, codigo?, …}, como las demás): no_autorizado | nombre_invalido |
--   no_existe | no_pendiente (también para un 'imprimiendo' que no está trabado) | no_imprimiendo.
--
-- Necesita la compuerta de personal (20261002120000: personal, mi_rol(), mi_correo()), pgcrypto
-- (extensions.digest, gen_random_bytes) y realtime.send: si falta algo se niega a correr SIN
-- cambiar nada. No toca ninguna tabla, policy ni función que ya exista, salvo agregar
-- `impresiones` a la publicación supabase_realtime. No necesita la ola C (usa mi_rol(), que allí
-- además exige estado = 'aprobado'; para esta migración es lo mismo).
--
-- SALIDA AL AIRE (la hace Yonatan; Línea Roja: aparca)
--   1. Aplicar este archivo en el SQL Editor, en cualquier momento: el POS de hoy no lo nota.
--   2. Con el POS nuevo, el admin entra a «Impresora de la caja» → Crear → copia el token (se
--      muestra una sola vez) → lo pega en impresora/config.json del PC de la caja.
--   3. Arrancar el agente (impresora/iniciar.cmd). En unos segundos el POS dice «Caja: en línea».
--   Si se pierde el token: «Rotar» da otro y el viejo deja de servir al instante.
--
-- REVERSA (menos de 1 minuto, en el mismo editor; `privado` NO se borra: lo comparte la cuenta en vivo):
--
--   begin;
--   drop function if exists public.impresora_tomar(text, integer);
--   drop function if exists public.impresora_confirmar(text, uuid, boolean, text);
--   drop function if exists public.impresora_latido(text, text);
--   drop function if exists public.impresora_crear(text);
--   drop function if exists public.impresora_rotar(uuid);
--   drop function if exists public.impresora_activar(uuid, boolean);
--   drop function if exists public.impresora_estado();
--   drop function if exists public.impresion_cancelar(uuid);
--   drop function if exists privado.impresora_de_token(text);
--   drop table if exists public.impresiones;
--   drop table if exists public.impresoras;
--   drop function if exists privado.impresiones_senal();
--   drop function if exists privado.impresiones_tope();
--   drop function if exists privado.impresiones_mantener();
--   drop function if exists privado.impresiones_caducar();
--   drop function if exists privado.topico_impresora(text);
--   drop function if exists privado.hash_token(text);
--   commit;
--
--   Borrar la tabla la saca sola de la publicación y se lleva sus triggers y policies. Las funciones que
--   devuelven el tipo de una tabla (impresora_tomar, impresora_de_token) se borran antes que ella; las de
--   los triggers, después (el trigger depende de su función hasta que cae la tabla).
--
-- Idempotente (se puede correr dos veces; las tablas se conservan, las funciones se reemplazan).
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos ───────────────────────────────────────────

create schema if not exists privado;   -- lo crea la cuenta en vivo; aquí no se le quita nada a nadie

do $$
begin
  if to_regclass('public.personal') is null
     or to_regprocedure('public.mi_rol()') is null
     or to_regprocedure('public.mi_correo()') is null then
    raise exception 'Falta 20261002120000_personal_y_compuerta.sql (personal, mi_rol() y mi_correo()): aplicala primero. No se cambió nada.';
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'Falta pgcrypto en el esquema extensions (digest, gen_random_bytes): create extension pgcrypto with schema extensions. No se cambió nada.';
  end if;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    raise exception 'falta realtime.send(jsonb, text, text, boolean): sin ella el trigger solo avisaría en los logs. Revisa que Realtime esté activo en el proyecto. No se cambió nada.';
  end if;
  if not has_function_privilege('realtime.send(jsonb,text,text,boolean)', 'execute') then
    raise exception 'el rol que aplica la migración (%) no puede ejecutar realtime.send: el trigger, que corre con sus permisos, solo avisaría en los logs. No se cambió nada.', current_user;
  end if;
end $$;

-- ── 1. El hash y el tópico: única derivación en SQL ─────────

-- El agente la replica en JS con crypto (createHash('sha256').update(token).digest('hex')). Un token
-- de menos de 16 o de más de 256 caracteres no se hashea: no es uno de los nuestros (los generamos de
-- 68) y así nadie le hace calcular un sha256 a la base sobre un texto enorme.
create or replace function privado.hash_token(p_token text) returns text
  language sql immutable set search_path = ''
as $$
  select case when length(p_token) between 16 and 256
              then encode(extensions.digest(p_token, 'sha256'), 'hex') end
$$;

create or replace function privado.topico_impresora(p_token_hash text) returns text
  language sql immutable set search_path = ''
as $$ select 'impresora:' || p_token_hash $$;

do $$
begin
  if privado.topico_impresora(privado.hash_token(repeat('0', 48))) is distinct from
     'impresora:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a' then
    raise exception 'privado.hash_token no da el sha256 del vector (token de 48 ceros): el agente y la base no se entenderían. No se cambió nada.';
  end if;
end $$;

-- ── 2. Impresoras ───────────────────────────────────────────

create table if not exists public.impresoras (
  id uuid not null default gen_random_uuid(),
  nombre text not null,
  token_hash text not null,
  activa boolean not null default true,
  ultimo_latido timestamp with time zone,
  version_agente text,
  creada_en timestamp with time zone not null default now(),
  constraint impresoras_pkey primary key (id),
  constraint impresoras_token_hash_key unique (token_hash),
  constraint impresoras_nombre_check check (nombre = btrim(nombre) and length(nombre) between 1 and 60 and nombre !~ '[\x01-\x1f\x7f]'),
  constraint impresoras_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint impresoras_version_check check (length(version_agente) <= 40)
);

comment on table public.impresoras is
  'Las impresoras de la caja (una por PC con el agente). token_hash = sha256 hex del token del agente; el token en claro NUNCA se guarda. Se escribe solo con impresora_crear / impresora_rotar / impresora_activar y con el latido del agente.';
comment on column public.impresoras.token_hash is
  'sha256 hex del token. También es el sufijo del tópico de Realtime (impresora:<hash>). Ningún rol de la API puede leerlo.';

alter table public.impresoras enable row level security;

-- ── 3. Impresiones (la cola) ────────────────────────────────

create table if not exists public.impresiones (
  id uuid not null default gen_random_uuid(),
  impresora_id uuid,
  tipo text not null,
  mesa_id integer,
  orden_id text,
  contenido jsonb not null,
  estado text not null default 'pendiente'::text,
  intentos integer not null default 0,
  error text,
  creada_por text default public.mi_correo(),
  creada_en timestamp with time zone not null default now(),
  tomada_en timestamp with time zone,
  impresa_en timestamp with time zone,
  tomada_por uuid,
  constraint impresiones_pkey primary key (id),
  -- null = la toma cualquier impresora activa. Si se borrara una impresora, sus trabajos se van con ella
  -- (no se vuelven «de cualquiera»: saldrían en otra caja).
  constraint impresiones_impresora_fkey foreign key (impresora_id) references public.impresoras(id) on delete cascade,
  constraint impresiones_tomada_por_fkey foreign key (tomada_por) references public.impresoras(id) on delete set null,
  constraint impresiones_tipo_check check (tipo = any (array['cuenta'::text, 'ticket'::text, 'abono'::text, 'cierre'::text, 'prueba'::text])),
  constraint impresiones_estado_check check (estado = any (array['pendiente'::text, 'imprimiendo'::text, 'impresa'::text, 'error'::text])),
  constraint impresiones_intentos_check check (intentos between 0 and 10),
  constraint impresiones_error_check check (length(error) <= 500),
  constraint impresiones_orden_id_check check (length(orden_id) <= 100),
  constraint impresiones_impresa_check check ((estado = 'impresa'::text) = (impresa_en is not null)),
  -- Solo lo que el agente sabe imprimir: un objeto con `lineas` (1 a 500), para todos los tipos.
  constraint impresiones_contenido_forma_check check (coalesce(
    jsonb_typeof(contenido) = 'object'
    and case when jsonb_typeof(contenido -> 'lineas') = 'array'
             then jsonb_array_length(contenido -> 'lineas') between 1 and 500
             else false end,
    false)),
  constraint impresiones_contenido_tamano_check check (octet_length(contenido::text) <= 32768)
);

comment on table public.impresiones is
  'La cola de impresión de la caja. El POS inserta; el agente (impresora_tomar / impresora_confirmar) la consume. Al menos una vez: un trabajo trabado se reintenta (hasta 3). Sin orden_id ni mesa_id con llave foránea a propósito: el documento va ya armado en `contenido` y no debe depender de que la orden siga existiendo.';
comment on column public.impresiones.contenido is
  'El documento ya armado por el POS: {titulo?, lineas:[{texto, der?, sangria?, alinear?, negrita?, doble?}], qr?, cortar?}. No es de fiar: el agente filtra los bytes de control y se niega a sacar más de 600 renglones.';
comment on column public.impresiones.tomada_por is
  'La impresora que lo tiene (o lo tuvo) en las manos. Solo ella puede confirmarlo.';

-- La cola viva (lo que mira impresora_tomar cada 5 s), la purga y el tope por persona.
create index if not exists impresiones_cola_idx on public.impresiones (creada_en, id)
  where estado = any (array['pendiente'::text, 'imprimiendo'::text]);
create index if not exists impresiones_purga_idx on public.impresiones (creada_en)
  where estado = any (array['impresa'::text, 'error'::text]);
create index if not exists impresiones_persona_idx on public.impresiones (creada_por, creada_en desc);

alter table public.impresiones enable row level security;

-- ── 4. Funciones internas (esquema privado) ─────────────────

-- La impresora de un token: SOLO si está activa. null si el token no sirve, sin decir por qué.
create or replace function privado.impresora_de_token(p_token text) returns public.impresoras
  language sql stable security definer set search_path = ''
as $$
  select i.*
    from public.impresoras i
   where i.activa
     and i.token_hash = privado.hash_token(p_token)
$$;

-- Caduca lo que lleva más de 15 minutos sin imprimirse —lo que nadie tomó y lo que se tomó y se trabó (2 minutos
-- sin confirmar: el PC se apagó, se colgó o se suspendió a media impresión)— y se rinde con lo que se trabó tras
-- agotar los intentos. Sin esperar a nadie: SKIP LOCKED, así no se enreda con un tomar que tenga esas filas en las manos.
create or replace function privado.impresiones_caducar() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.impresiones i
     set estado = 'error',
         error = 'caducó: la impresora no la tomó a tiempo'
   where i.id in (select x.id from public.impresiones x
                   where x.estado = 'pendiente'
                     and x.creada_en < now() - interval '15 minutes'
                     for update skip locked);

  update public.impresiones i
     set estado = 'error',
         error = 'caducó: la impresora no la terminó a tiempo'
   where i.id in (select x.id from public.impresiones x
                   where x.estado = 'imprimiendo'
                     and x.tomada_en < now() - interval '2 minutes'
                     and x.creada_en < now() - interval '15 minutes'
                     for update skip locked);

  update public.impresiones i
     set estado = 'error',
         error = 'se trabó: la impresora no confirmó tras 3 intentos'
   where i.id in (select x.id from public.impresiones x
                   where x.estado = 'imprimiendo'
                     and x.tomada_en < now() - interval '2 minutes'
                     and x.intentos >= 3
                     for update skip locked);
end $$;

-- Tras cada INSERT (una vez por sentencia): caducar y purgar. NUNCA rompe la inserción.
create or replace function privado.impresiones_mantener() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform privado.impresiones_caducar();
    delete from public.impresiones i
     where i.id in (select x.id from public.impresiones x
                     where x.estado = any (array['impresa', 'error'])
                       and x.creada_en < now() - interval '7 days'
                       order by x.creada_en
                       limit 500
                       for update skip locked);
  exception when others then
    raise warning 'impresiones_mantener: % [%]', sqlerrm, sqlstate;
  end;
  return null;
end $$;

-- El tope por persona: 30 por minuto. AFTER y por sentencia (con la tabla de transición) para que un
-- solo INSERT de 500 filas no lo esquive: se cuenta lo que quedó, el candado hace exacto el conteo
-- aunque dos pulsaciones lleguen a la vez, y el error deshace TODA la sentencia. Corre con los
-- permisos de quien llama y solo para la API: el dueño y service_role no tienen tope.
create or replace function privado.impresiones_tope() returns trigger
  language plpgsql set search_path = ''
as $$
declare
  r record;
begin
  if current_user in ('anon', 'authenticated') then
    for r in select distinct n.creada_por from nuevas n order by n.creada_por loop
      perform pg_advisory_xact_lock(hashtext('resplandor.impresiones:' || coalesce(r.creada_por, '')));
      if (select count(*) from public.impresiones x
           where x.creada_por is not distinct from r.creada_por
             and x.creada_en > now() - interval '1 minute') > 30 then
        raise exception 'demasiadas impresiones seguidas: espera un momento'
          using errcode = 'RS030';
      end if;
    end loop;
  end if;
  return null;
end $$;

-- La señal: UNA por impresora destino, sin datos. NUNCA rompe la inserción.
create or replace function privado.impresiones_senal() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text;
begin
  begin
    for v_hash in
      select i.token_hash from public.impresoras i
       where i.activa and (new.impresora_id is null or i.id = new.impresora_id)
    loop
      perform realtime.send('{}'::jsonb, 'trabajo', privado.topico_impresora(v_hash), false);
    end loop;
  exception when others then
    -- Se pierde la señal (el agente sondea cada 5 s), NO el trabajo.
    raise warning 'impresiones_senal: % [%]', sqlerrm, sqlstate;
  end;
  return null;
end $$;

-- ── 5. Triggers ─────────────────────────────────────────────

drop trigger if exists impresiones_tope on public.impresiones;
create trigger impresiones_tope
  after insert on public.impresiones
  referencing new table as nuevas
  for each statement execute function privado.impresiones_tope();

drop trigger if exists impresiones_senal on public.impresiones;
create trigger impresiones_senal
  after insert on public.impresiones
  for each row
  when (new.estado = 'pendiente')
  execute function privado.impresiones_senal();

drop trigger if exists impresiones_mantener on public.impresiones;
create trigger impresiones_mantener
  after insert on public.impresiones
  for each statement execute function privado.impresiones_mantener();

-- ── 6. Quién ve y quién escribe (RLS y GRANT) ───────────────

-- impresoras: solo el admin la ve, y sin token_hash (permiso por columna). Nadie la escribe por la API.
drop policy if exists impresoras_ver on public.impresoras;
create policy impresoras_ver on public.impresoras for select to authenticated
  using ((select public.mi_rol()) = 'admin');

-- impresiones: el personal ve la cola (para el estado en vivo) y encola; nadie edita ni borra.
drop policy if exists impresiones_ver on public.impresiones;
create policy impresiones_ver on public.impresiones for select to authenticated
  using ((select public.mi_rol()) is not null);

drop policy if exists impresiones_crear on public.impresiones;
create policy impresiones_crear on public.impresiones for insert to authenticated
  with check (
    (select public.mi_rol()) is not null
    and estado = 'pendiente'
    and intentos = 0
    and creada_por is not distinct from (select public.mi_correo())
  );

-- La misma compuerta que las demás tablas del POS (restrictiva: Google Y personal).
do $$
declare t text;
begin
  foreach t in array array['impresoras', 'impresiones'] loop
    execute format('drop policy if exists solo_personal on public.%I', t);
    execute format(
      'create policy solo_personal on public.%I as restrictive for all to authenticated
         using ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'' and (select public.mi_rol()) is not null)
         with check ((select auth.jwt() -> ''app_metadata'' ->> ''provider'') = ''google'' and (select public.mi_rol()) is not null)', t);
  end loop;
end $$;

revoke all on public.impresoras from anon, authenticated, service_role;
revoke all on public.impresiones from anon, authenticated, service_role;
-- Sin token_hash ni nada de la cola que no sea suyo: GRANT por columna.
grant select (id, nombre, activa, ultimo_latido, version_agente, creada_en) on public.impresoras to authenticated;
grant select on public.impresiones to authenticated;
grant insert (id, impresora_id, tipo, mesa_id, orden_id, contenido) on public.impresiones to authenticated;

-- ── 7. RPC del agente (se autentican con el token) ──────────

-- Toma hasta p_max trabajos (1 a 20) de esta impresora o de cualquiera, los más viejos primero:
-- los 'pendiente' y los 'imprimiendo' trabados de más de 2 minutos con menos de 3 intentos Y de menos de
-- 15 minutos desde que se crearon (uno más viejo ya no se entrega: el POS cayó a su papel). Los pasa a
-- 'imprimiendo' (intentos + 1) con FOR UPDATE SKIP LOCKED: dos agentes (o dos sondeos del mismo)
-- nunca se llevan el mismo. No devuelve quién lo creó (creada_por va en null: el agente no lo necesita).
-- Token inválido → vacío, sin pistas.
create or replace function public.impresora_tomar(p_token text, p_max integer default 5)
 returns setof public.impresiones
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v public.impresoras;
  r public.impresiones;
  v_max integer := least(greatest(coalesce(p_max, 5), 1), 20);
begin
  v := privado.impresora_de_token(p_token);
  if v.id is null then
    return;
  end if;

  -- El latido por sondeo SALTA la fila si otra transacción la tiene tomada (otro tomar, un latido, una
  -- rotación): sin SKIP LOCKED, dos agentes de la misma impresora harían cola por esta fila. FOR NO KEY
  -- UPDATE (no FOR UPDATE): el UPDATE de abajo no toca columnas llave, y un lock más fuerte haría esperar
  -- al FOR KEY SHARE de la llave foránea `tomada_por` del UPDATE de impresiones, justo después.
  update public.impresoras
     set ultimo_latido = now()
   where id = (select x.id
                 from public.impresoras x
                where x.id = v.id
                  and (x.ultimo_latido is null or x.ultimo_latido < now() - interval '10 seconds')
                  for no key update skip locked);

  perform privado.impresiones_caducar();

  for r in
    with elegidas as (
      select x.id
        from public.impresiones x
       where (x.impresora_id = v.id or x.impresora_id is null)
         and (x.estado = 'pendiente'
              or (x.estado = 'imprimiendo' and x.tomada_en < now() - interval '2 minutes' and x.intentos < 3
                  and x.creada_en > now() - interval '15 minutes'))
       order by x.creada_en, x.id
       limit v_max
         for update skip locked
    ), tomadas as (
      update public.impresiones i
         set estado = 'imprimiendo',
             intentos = i.intentos + 1,
             tomada_en = now(),
             tomada_por = v.id
        from elegidas e
       where i.id = e.id
      returning i.*
    )
    select t.* from tomadas t order by t.creada_en, t.id
  loop
    r.creada_por := null;
    return next r;
  end loop;
  return;
end;
$function$;

-- El agente dice cómo le fue con un trabajo que tiene en las manos (estado 'imprimiendo' y tomado por
-- ella). ok → 'impresa'. No ok → vuelve a 'pendiente' si le quedan intentos (de 3) y a 'error' si no.
-- Un trabajo de otra impresora responde igual que uno que no existe.
create or replace function public.impresora_confirmar(p_token text, p_id uuid, p_ok boolean, p_error text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v public.impresoras;
  i public.impresiones;
  v_error text;
begin
  v := privado.impresora_de_token(p_token);
  if v.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  select * into i
    from public.impresiones x
   where x.id = p_id
     and (x.impresora_id = v.id or x.impresora_id is null)
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  if i.estado <> 'imprimiendo' or i.tomada_por is distinct from v.id then
    return jsonb_build_object('ok', false, 'codigo', 'no_imprimiendo', 'estado', i.estado);
  end if;

  if coalesce(p_ok, false) then
    update public.impresiones
       set estado = 'impresa', impresa_en = now(), error = null
     where id = i.id
    returning * into i;
  else
    -- El texto sale a la pantalla del POS: sin caracteres de control y corto.
    v_error := left(btrim(regexp_replace(coalesce(p_error, 'sin detalle'), '[\x01-\x1f\x7f]+', ' ', 'g')), 300);
    update public.impresiones
       set estado = case when i.intentos < 3 then 'pendiente' else 'error' end,
           error = coalesce(nullif(v_error, ''), 'sin detalle')
     where id = i.id
    returning * into i;
  end if;
  return jsonb_build_object('ok', true, 'estado', i.estado, 'intentos', i.intentos);
end;
$function$;

-- «Sigo viva»: cada 30 s. Anota la hora y la versión del agente.
create or replace function public.impresora_latido(p_token text, p_version text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v public.impresoras;
begin
  v := privado.impresora_de_token(p_token);
  if v.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  update public.impresoras
     set ultimo_latido = now(),
         version_agente = nullif(left(btrim(regexp_replace(coalesce(p_version, ''), '[\x01-\x1f\x7f]+', ' ', 'g')), 40), '')
   where id = v.id;
  return jsonb_build_object('ok', true, 'nombre', v.nombre, 'ahora', now());
end;
$function$;

-- ── 8. RPC del POS ──────────────────────────────────────────

-- Crear una impresora (solo admin). El token en claro sale AQUÍ y no se puede volver a ver.
create or replace function public.impresora_crear(p_nombre text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_token text;
  v_id uuid;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  if length(v_nombre) not between 1 and 60 or v_nombre ~ '[\x01-\x1f\x7f]' then
    return jsonb_build_object('ok', false, 'codigo', 'nombre_invalido');
  end if;
  v_token := 'imp_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.impresoras (nombre, token_hash)
  values (v_nombre, privado.hash_token(v_token))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'nombre', v_nombre, 'token', v_token);
end;
$function$;

-- Rotar el token (solo admin): el viejo deja de servir al instante y la caja figura «sin conexión»
-- hasta que el agente arranque con el nuevo.
create or replace function public.impresora_rotar(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_token text;
  v_nombre text;
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  v_token := 'imp_' || encode(extensions.gen_random_bytes(32), 'hex');
  update public.impresoras
     set token_hash = privado.hash_token(v_token),
         ultimo_latido = null,
         version_agente = null
   where id = p_id
  returning nombre into v_nombre;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'nombre', v_nombre, 'token', v_token);
end;
$function$;

-- Activar o desactivar (solo admin). Una impresora desactivada no toma nada y su token no sirve.
create or replace function public.impresora_activar(p_id uuid, p_activa boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  if (select public.mi_rol()) is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  update public.impresoras
     set activa = coalesce(p_activa, false)
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  return jsonb_build_object('ok', true, 'activa', coalesce(p_activa, false));
end;
$function$;

-- Para el indicador «Caja: en línea / sin conexión»: todo el personal ve las activas; el admin, todas.
-- Sin personal → ninguna fila (sin pistas).
create or replace function public.impresora_estado()
 returns table (id uuid, nombre text, en_linea boolean, ultimo_latido timestamp with time zone, activa boolean, version_agente text)
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select i.id,
         i.nombre,
         coalesce(i.activa and i.ultimo_latido > now() - interval '90 seconds', false),
         i.ultimo_latido,
         i.activa,
         i.version_agente
    from public.impresoras i
   where (select public.mi_rol()) is not null
     and (i.activa or (select public.mi_rol()) = 'admin')
   order by i.creada_en, i.id
$function$;

-- Cancelar un trabajo que nadie tomó todavía, o que se tomó y lleva más de 2 minutos sin confirmar (la caja se
-- calló: es lo que el POS llama «la caja no responde»). El POS lo llama antes de caer al window.print() y cuando
-- la persona cierra el aviso. Uno que se está imprimiendo ahora mismo (menos de 2 minutos) no se puede cancelar.
create or replace function public.impresion_cancelar(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  i public.impresiones;
begin
  if (select public.mi_rol()) is null then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  update public.impresiones
     set estado = 'error', error = 'cancelada'
   where id = p_id
     and (estado = 'pendiente'
          or (estado = 'imprimiendo' and tomada_en < now() - interval '2 minutes'))
  returning * into i;
  if found then
    return jsonb_build_object('ok', true);
  end if;
  select * into i from public.impresiones where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'no_existe');
  end if;
  return jsonb_build_object('ok', false, 'codigo', 'no_pendiente', 'estado', i.estado);
end;
$function$;

-- ── 9. Quién puede ejecutar qué (por defecto Supabase da EXECUTE a anon) ──

revoke all on function privado.hash_token(text) from public, anon, authenticated, service_role;
revoke all on function privado.topico_impresora(text) from public, anon, authenticated, service_role;
revoke all on function privado.impresora_de_token(text) from public, anon, authenticated, service_role;
revoke all on function privado.impresiones_caducar() from public, anon, authenticated, service_role;
revoke all on function privado.impresiones_mantener() from public, anon, authenticated, service_role;
revoke all on function privado.impresiones_tope() from public, anon, authenticated, service_role;
revoke all on function privado.impresiones_senal() from public, anon, authenticated, service_role;

revoke all on function public.impresora_tomar(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.impresora_confirmar(text, uuid, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.impresora_latido(text, text) from public, anon, authenticated, service_role;
revoke all on function public.impresora_crear(text) from public, anon, authenticated, service_role;
revoke all on function public.impresora_rotar(uuid) from public, anon, authenticated, service_role;
revoke all on function public.impresora_activar(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.impresora_estado() from public, anon, authenticated, service_role;
revoke all on function public.impresion_cancelar(uuid) from public, anon, authenticated, service_role;

-- El agente usa la llave publishable (anon); el token es la credencial. authenticated también (un
-- teléfono del personal puede probar la caja), con el mismo token.
grant execute on function public.impresora_tomar(text, integer) to anon, authenticated;
grant execute on function public.impresora_confirmar(text, uuid, boolean, text) to anon, authenticated;
grant execute on function public.impresora_latido(text, text) to anon, authenticated;
-- El POS: la sesión del personal decide (mi_rol()); anon no las alcanza.
grant execute on function public.impresora_crear(text) to authenticated;
grant execute on function public.impresora_rotar(uuid) to authenticated;
grant execute on function public.impresora_activar(uuid, boolean) to authenticated;
grant execute on function public.impresora_estado() to authenticated;
grant execute on function public.impresion_cancelar(uuid) to authenticated;

-- ── 10. Realtime: el POS ve el estado de sus trabajos al instante ──
-- (la RLS de `impresiones` decide quién los recibe: solo el personal; los DELETE de la purga solo
--  llevan el id).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'impresiones'
  ) then
    alter publication supabase_realtime add table public.impresiones;
  end if;
end $$;
