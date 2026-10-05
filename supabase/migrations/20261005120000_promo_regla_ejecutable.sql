-- ════════════════════════════════════════════════════════════
-- Resplandor — ARREGLO de 20261005100000_precio_vivo_y_promos.sql: `privado.promo_regla_ok` la tiene que poder ejecutar `authenticated`
-- (hallazgo de la verificación del 2026-10-05 antes de salir al aire, con un admin y un mesero de verdad —rol `authenticated` con la RLS—
-- sobre la base con el precio vivo ya aplicado; tareas/2026-10-04-hallazgos-domingo.md)
--
-- QUÉ PASABA
--   El CHECK `productos_promo_regla_valida` (20261005100000) llama a `privado.promo_regla_ok(promo_regla)`, y Postgres evalúa un CHECK con
--   el rol de QUIEN ESCRIBE la fila (con la API: `authenticated`), no con el del dueño. Esa migración le quitó el EXECUTE a `authenticated`
--   («revoke all on function privado.promo_regla_ok(jsonb) from public, anon, authenticated»), así que desde el POS TODO insert o update
--   de `productos` —crear un producto, cambiar un precio, apagar uno, ponerle regla a una promo— fallaba con
--   «permission denied for function promo_regla_ok», incluso con `promo_regla` en null. Es decir: el precio vivo no se podía usar (no había cómo
--   cambiar un precio). No lo vio el arnés ni la prueba de la migración porque escriben como `postgres`/`migrador`, que sí tienen el permiso.
--   (Un delete no evalúa el CHECK: borrar un producto sí funcionaba.)
--
-- QUÉ HACE
--   Le da EXECUTE a `authenticated` y a `service_role` (los dos únicos roles de la API con permiso de escribir `productos`; anon no tiene ninguno)
--   sobre `privado.promo_regla_ok(jsonb)`: es la ÚNICA función de privado que corre dentro de una sentencia de quien escribe. Es pura
--   (inmutable, mira solo su argumento, devuelve un booleano, nunca lanza), así que no abre nada: el esquema `privado` no está expuesto en la
--   API, ni lee tablas. Es el mismo patrón que `privado.emv_crc_ok` y `privado.emv_llave`
--   (20261003150000_pago_breb.sql), los CHECK de `ajustes`, que `authenticated` también ejecuta. Las otras cuatro funciones de privado de
--   20261005100000 siguen SIN EXECUTE para anon y authenticated: las llaman los triggers, que son SECURITY DEFINER (corren como el dueño),
--   y la API no las corre nunca.
--   `anon` y `public` siguen sin poder ejecutarla.
--
-- No cambia ningún dato, policy ni otra función. Idempotente (un GRANT repetido no cambia nada). Necesita 20261005100000: si falta la
-- función, se niega a correr SIN cambiar nada.
-- OJO con el orden: 20261005100000 vuelve a revocar este permiso cada vez que se pega («revoke all … from public, anon, authenticated»). Si
-- alguna vez se vuelve a pegar ESA migración sola, hay que pegar esta otra vez detrás (el sobre de salida las trae juntas, en una transacción).
--
-- REVERSA (menos de 1 minuto; ojo: devuelve el defecto, cualquier escritura de productos desde el POS vuelve a fallar):
--   revoke execute on function privado.promo_regla_ok(jsonb) from authenticated, service_role;
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Va justo después de 20261005100000 (y de 20261005110000, que es independiente).
-- ════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('privado.promo_regla_ok(jsonb)') is null then
    raise exception 'Falta 20261005100000_precio_vivo_y_promos.sql (privado.promo_regla_ok): aplicala primero. No se cambió nada.';
  end if;
end $$;

grant execute on function privado.promo_regla_ok(jsonb) to authenticated, service_role;

-- ── Comprobación ─────────────────────────────────────────────

do $$
begin
  if not has_function_privilege('authenticated', 'privado.promo_regla_ok(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'privado.promo_regla_ok(jsonb)', 'execute') then
    raise exception 'authenticated o service_role no pueden ejecutar privado.promo_regla_ok: no podrían escribir productos';
  end if;
  if has_function_privilege('anon', 'privado.promo_regla_ok(jsonb)', 'execute') or has_function_privilege('public', 'privado.promo_regla_ok(jsonb)', 'execute') then
    raise exception 'anon o public pueden ejecutar privado.promo_regla_ok: no tenían que poder';
  end if;
end $$;
