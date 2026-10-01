-- ════════════════════════════════════════════════════════════
-- Cuenta en vivo — la señal de la base
-- (parte 1A de tareas/2026-09-30-cuenta-en-mesa.md; diseño en docs/sdd-cuenta-en-mesa.md §04.1-§04.2)
--
-- Qué hace. Cada vez que cambia la cuenta abierta de una mesa (ítem, nota, cierre, mesa
-- liberada vacía, orden reabierta) o se rota el token de la pegatina, la base emite UNA
-- señal sin datos por Realtime hacia un tópico público derivado del token:
--
--     tópico  = 'cuenta:' || hex(sha256(utf8(mesas.token)))     -- 64 hex
--     evento  = 'cambio'          payload = {}          canal público (private = false)
--
-- La carta (carta.html) se une a ese tópico y, al recibir la señal, vuelve a leer la cuenta
-- en la Edge Function `cuenta`. Por el canal no viaja ningún dato: quien conoce el tópico ya
-- conocía el token (SDD §04.1, opción d2). `anon` no gana ningún GRANT ni policy con esto.
--
-- Contrato compartido con la Edge Function `cuenta` (parte 1B), que replica la derivación en
-- JS con `crypto.subtle`. Vector de prueba, el mismo en las dos pruebas:
--     token  = '0' × 48
--     tópico = cuenta:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a
-- (la propia migración lo comprueba más abajo y se detiene si no coincide).
--
-- Seguridad de la escritura del POS. El trigger NUNCA puede romper una escritura: todo el
-- cuerpo va dentro de `exception when others` y, si algo falla, solo deja un WARNING en los
-- logs de Postgres. Se pierde la señal (la carta lo detecta con la `marca` y cae a sondeo,
-- SDD §03.2.7), no la orden. Por eso se aplica DESPUÉS de las 17:00 y con la reversa a mano.
--
-- Antes de aplicar, la migración comprueba tres cosas y se detiene con un mensaje claro si
-- falta alguna, antes de crear ningún trigger: que exista realtime.send(jsonb, text, text,
-- boolean), que quien aplica (el dueño de la función del trigger) pueda ejecutarla, y que
-- `extensions.digest` dé el tópico del vector. Sin esa comprobación el `exception` de abajo
-- las tragaría como WARNING en cada escritura, para siempre.
--
-- Idempotente (se puede correr dos veces). Correr en Supabase → SQL Editor: la aplica
-- Yonatan, con su GO (Línea Roja: aparca). Orden de despliegue del SDD §08: 1) esta
-- migración, 2) `supabase functions deploy cuenta --no-verify-jwt`, 3) push.
--
-- Fase 2 (migración 20261005120000_liquidaciones.sql) solo agrega el trigger
-- `liquidaciones_emite_cuenta` sobre la misma función: la rama de `liquidaciones` ya está
-- aquí y saca la mesa de la ORDEN, nunca de la liquidación.
--
-- ── Reversa (Línea Roja: se deshace en menos de 1 minuto) ──────────────────────────────
-- Pegar en el SQL Editor. Las dos primeras líneas bastan: sin triggers no hay señales y la
-- carta pasa sola a sondeo de 20 s en ≤ 60 s. Las otras tres dejan la base sin rastro; la
-- última no lleva `cascade` a propósito: si `privado` ya tiene más objetos (fase 2:
-- privado.personal, es_personal) falla y los deja en paz.
--   drop trigger if exists ordenes_emite_cuenta on public.ordenes;
--   drop trigger if exists mesas_emite_cuenta on public.mesas;
--   drop function if exists privado.emitir_cuenta();
--   drop function if exists privado.topico_cuenta(text);
--   drop schema if exists privado;
-- ════════════════════════════════════════════════════════════

-- ── 1. Esquema privado ──────────────────────────────────────

-- Fuera de PostgREST: la API solo expone `public`. Nadie más lo usa.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

-- ── 2. El tópico: única derivación en SQL ───────────────────

-- `cuenta` (1B) la replica en JS. `extensions.digest` viene de pgcrypto
-- (20260906120000_carta_publica_y_token_mesa.sql:53).
create or replace function privado.topico_cuenta(p_token text) returns text
  language sql immutable set search_path = ''
as $$ select 'cuenta:' || encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

-- ── 3. Precondiciones: que la señal de verdad pueda salir ───

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    raise exception 'falta realtime.send(jsonb, text, text, boolean): sin ella el trigger solo avisaría en los logs. Revisa que Realtime esté activo en el proyecto';
  end if;
  if not has_function_privilege('realtime.send(jsonb,text,text,boolean)', 'execute') then
    raise exception 'el rol que aplica la migración (%) no puede ejecutar realtime.send: el trigger, que corre con sus permisos, solo avisaría en los logs', current_user;
  end if;
  if privado.topico_cuenta(repeat('0', 48)) is distinct from
     'cuenta:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a' then
    raise exception 'privado.topico_cuenta no da el tópico del vector (token de 48 ceros): la carta y la base no se entenderían';
  end if;
end $$;

-- ── 4. La función del trigger ───────────────────────────────

create or replace function privado.emitir_cuenta() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_mesas int[] := '{}';
  v_mesa  int;
  v_token text;
begin
  begin                                              -- NUNCA romper la escritura del POS
    if tg_table_name = 'mesas' then
      -- Rotación del token: se avisa al tópico VIEJO, así quien miraba con el enlace anterior
      -- recibe la señal, lee, obtiene 404 y la carta dice «este enlace ya no sirve». El upsert
      -- del POS reenvía el token igual en cada cambio de la mesa: eso no emite.
      if tg_op = 'UPDATE' and new.token is distinct from old.token then
        perform realtime.send('{}'::jsonb, 'cambio', privado.topico_cuenta(old.token), false);
      end if;
      return null;
    end if;

    if tg_table_name = 'ordenes' then
      -- Solo lo que estaba o queda abierto: se ignoran la purga de cerrarDia (pos.html:2835)
      -- y el INSERT ya cerrado del cobro parcial (pos.html:2505).
      if tg_op = 'INSERT' then
        if new.estado = 'abierta' then v_mesas := array[new.mesa_id]; end if;
      elsif tg_op = 'DELETE' then
        if old.estado = 'abierta' then v_mesas := array[old.mesa_id]; end if;
      elsif old.estado = 'abierta' or new.estado = 'abierta' then
        v_mesas := array[old.mesa_id, new.mesa_id];  -- reabrirOrden puede cambiar de mesa
      end if;
    elsif tg_op <> 'DELETE' then                     -- liquidaciones (fase 2)
      -- La mesa sale de la ORDEN, no de la liquidación: una orden reabierta cambia de mesa.
      select array[o.mesa_id] into v_mesas from public.ordenes o where o.id = new.orden_id;
    end if;

    -- coalesce: FOREACH sobre NULL lanza error (array_agg de nada, SELECT INTO sin fila)
    foreach v_mesa in array coalesce(
        (select array_agg(distinct x) from unnest(v_mesas) x where x is not null), '{}') loop
      select token into v_token from public.mesas where id = v_mesa;
      if v_token is not null then
        perform realtime.send('{}'::jsonb, 'cambio', privado.topico_cuenta(v_token), false);
      end if;
    end loop;
  exception when others then
    -- Se pierde la señal (la carta lo detecta con la `marca`), NO la orden.
    raise warning 'emitir_cuenta % %: % [%]', tg_table_name, tg_op, sqlerrm, sqlstate;
  end;
  return null;
end $$;

revoke all on function privado.emitir_cuenta() from public, anon, authenticated;
revoke all on function privado.topico_cuenta(text) from public, anon, authenticated;

-- ── 5. Los triggers ─────────────────────────────────────────

create or replace trigger ordenes_emite_cuenta
  after insert or update or delete on public.ordenes
  for each row execute function privado.emitir_cuenta();

create or replace trigger mesas_emite_cuenta
  after update of token on public.mesas
  for each row execute function privado.emitir_cuenta();
