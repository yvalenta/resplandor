-- ════════════════════════════════════════════════════════════
-- Resplandor — «SERVIDA»: la marca de que la comida de la mesa ya llegó (el cronómetro de espera se detiene)
-- (tarea tareas/2026-10-06-cronometro-mesa.md, rama tarea/cronometro-mesa; pedido de Yonatan, 2026-10-06: «también podrá decidir si fue atendido para que el
--  cronómetro no siga… me refiero a que se le llevó la comida y ahí ya no necesita contar, solo informativo»)
--
-- POR QUÉ. El POS muestra en cada mesa ocupada cuánto lleva esperando el pedido («12 min»; desde la hora en que se tomó). Cuando la comida llega, ese número deja de
-- decir algo útil: la persona toca «servida» y el cronómetro se detiene («servida 12:41 · esperó 17 min»). La marca tiene que viajar a TODAS las tablets y
-- sobrevivir a recargar la página, así que no puede vivir en la memoria de una: vive en la cuenta.
--
-- QUÉ HACE. UNA columna nueva y nada más: `public.ordenes.servida_en timestamptz null` (la hora en que se sirvió; null = no servida). Sin valor por omisión: una
-- cuenta nueva nace sin marca. No es un ítem: NO toca `privado.normalizar_items`, ni `aplicar_delta_orden`, ni `public.ordenes_guardia`, ni ningún trigger, policy,
-- función o vista; no cambia la Edge Function `cuenta` (lo que ve el cliente en la carta: lee `ordenes` por nombre de columna —`id, items, total, abierta_en, updated_at,
-- version`—, así que la nueva no sale, y su `marca` es la `version`, que no se mueve) ni el cierre del día (la base lo arma con un objeto de campos fijos).
--
-- CÓMO LA ESCRIBE EL POS. Con un update directo de esa columna (`update ordenes set servida_en = … where id = … and estado = 'abierta'`):
--   · `version` NO sube: `ordenes_guardia` la sube solo cuando cambian los `items`, y aquí no cambian. (`updated_at` sí avanza: `trg_ordenes_updated_at` lo hace en todo update.)
--   · QUIÉN: la policy `ordenes_editar` de 20261002140000 ya lo permite (admin: todo; mesero: solo cuentas ABIERTAS: una cerrada no se toca) y el GRANT de `ordenes` es de
--     tabla entera (`grant select, insert, update`): una columna nueva entra sola. anon no puede.
--   · REALTIME: `ordenes` está en la publicación `supabase_realtime` sin lista de columnas (20260905000000), así que el eco del UPDATE trae la columna nueva a las
--     otras tablets (el POS la lee de `payload.new.servida_en`).
--   · La señal a la carta (`ordenes_emite_cuenta`, 20261001120000) también sale con este UPDATE, como con cualquier otro de una cuenta abierta: es una señal vacía y la
--     carta vuelve a leer `cuenta`, que no cambió. Inocuo.
--   · Si después se agregan ítems a la cuenta, la tablet que los agrega vuelve a poner `servida_en` en null (empieza una espera nueva por la segunda tanda); quitar
--     ítems no la toca; al cerrar la cuenta no importa (se queda donde estaba).
--
-- El POS detecta la columna (como las de las otras migraciones): sin ella (PGRST204 al escribir, 42703 al leer) esconde el toque «servida» y sigue con el cronómetro de
-- siempre. Por eso el ORDEN con el push del POS no rompe nada, pero el toque solo aparece cuando la columna existe: aplícala ANTES del push.
--
-- Necesita `public.ordenes` (20260905000000_resplandor_base.sql); si falta, se niega a correr SIN cambiar nada.
-- Idempotente (`add column if not exists`): correrla dos veces deja lo mismo. Sin datos: ninguna cuenta existente cambia al aplicarla.
--
-- REVERSA (menos de 1 minuto; solo guardaba la marca, nada más depende de ella):
--   begin;
--   alter table public.ordenes drop column if exists servida_en;
--   notify pgrst, 'reload schema';
--   commit;
-- Con el POS de ahora puesto, sin la columna el toque «servida» se esconde y el cronómetro sigue como siempre (no hace falta tocar el código).
-- Correr en Supabase → SQL Editor (lo aplica Yonatan: aparca). Orden de salida al aire: 1) esta migración, 2) push del POS.
-- ════════════════════════════════════════════════════════════

-- ── 0. Requisitos: se comprueban ANTES de crear nada ─────────

do $$
begin
  if to_regclass('public.ordenes') is null then
    raise exception 'Falta public.ordenes (20260905000000_resplandor_base.sql): aplícala primero. No se cambió nada.';
  end if;
end $$;

-- ── 1. La columna ────────────────────────────────────────────

alter table public.ordenes add column if not exists servida_en timestamp with time zone;

comment on column public.ordenes.servida_en is
  'Cuándo se sirvió la comida de la mesa (el cronómetro de espera del POS se detiene ahí); null = no servida. La escribe el POS con un update directo de esta columna (no toca ítems: la version no sube); si después se agregan ítems, la tablet que los agrega la vuelve a poner en null. Solo informa: no bloquea nada ni cambia el cobro.';

-- PostgREST: la columna nueva se ve en el siguiente pedido (el POS la detecta con una lectura de cero filas).
notify pgrst, 'reload schema';

-- ── 2. Autocomprobación: la columna quedó como se dijo ───────

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ordenes' and column_name = 'servida_en'
       and data_type = 'timestamp with time zone' and is_nullable = 'YES' and column_default is null
  ) then
    raise exception 'ordenes.servida_en no quedó como debe (timestamptz, admite null, sin valor por omisión): ya existía con otra forma. No se cambió nada.';
  end if;
end $$;
