-- ════════════════════════════════════════════════════════════
-- Presencia del POS en un canal privado (D17 de docs/sdd-cuenta-en-mesa.md; §04.2, §05 S8, SD9)
--
-- `presencia_pos` publica el nombre del personal (`nombre: nombreUsuario`, pos.html) en un
-- canal PÚBLICO: cualquiera con la llave publishable puede escucharlo y falsificarlo (Ley 1581).
-- pos.html pasa a abrirlo con `private: true`, y Realtime Authorization exige una policy en
-- realtime.messages para unirse (select) y para publicar presencia (insert).
--
-- Solo `authenticated` con sesión de Google (el mismo criterio de `solo_google`, base.sql), solo
-- el tópico `presencia_pos` y solo presencia (extension = 'presence'). `anon` no tiene policy:
-- no puede unirse ni publicar. No hay GRANT nuevo.
--
-- Qué NO toca: `pos_sync` (postgres_changes no usa realtime.messages) ni los canales
-- `cuenta:<hash>` de la señal en vivo (1A), que siguen siendo públicos a propósito (§04.1, d2).
--
-- ORDEN. Aplicarla ANTES de publicar el pos.html con `private: true`: sin ella, el canal privado
-- no deja unirse y la presencia queda muda (el POS sigue funcionando; solo se pierde el aviso
-- «otra tablet tiene esta mesa»). Aplicarla antes del código es inocua: las policies solo
-- cuentan para canales privados. Mientras haya tablets con el pos.html anterior (canal público),
-- esas y las nuevas no se ven entre sí.
--
-- Idempotente. Lo aplica Yonatan en el SQL Editor (Línea Roja: un agente no aplica migraciones).
-- Se prueba con la prueba S-10 del SDD: la presencia funciona entre tablets y `anon` no puede
-- unirse a `presencia_pos`.
--
-- Reversa (< 1 min): revertir el commit de pos.html (el canal vuelve a ser público) y
--   drop policy if exists "presencia_pos: el personal escucha" on realtime.messages;
--   drop policy if exists "presencia_pos: el personal publica" on realtime.messages;
-- ════════════════════════════════════════════════════════════

drop policy if exists "presencia_pos: el personal escucha" on realtime.messages;
create policy "presencia_pos: el personal escucha"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) = 'presencia_pos'
    and (select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
  );

drop policy if exists "presencia_pos: el personal publica" on realtime.messages;
create policy "presencia_pos: el personal publica"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) = 'presencia_pos'
    and (select auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
  );
