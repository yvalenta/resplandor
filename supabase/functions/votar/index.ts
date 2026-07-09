// Edge Function: votar
// -----------------------------------------------------------------------------
// Punto único de escritura pública para la votación del menú (menu.html).
// Reemplaza los upsert directos anónimos: el cliente ya NO escribe en las tablas
// (elecciones_menu / reacciones_menu / sugerencias_plato) — la RLS bloquea a
// `anon`. Esta función valida, aplica rate-limit por IP y escribe con la
// service-role key (omite RLS). Tras escribir, emite un Broadcast por Realtime
// para que todos los clientes de esa semana actualicen el conteo en vivo.
//
// Endpoint público POR DISEÑO (verify_jwt=false, como lo era el acceso anon):
// la protección real es rate-limit + validación + unique(device_id) en la BD.
// -----------------------------------------------------------------------------
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Rate-limit por IP: ventana deslizante best-effort en memoria del isolate.
// Nota: los isolates son efímeros, así que esto es un primer filtro barato, no
// una garantía dura. La deduplicación real la da unique(device_id) en la BD;
// para un límite estricto usar un contador en Postgres/Redis. ---
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 30; // por IP por minuto (todas las acciones)

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const prev = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  prev.push(now);
  HITS.set(ip, prev);
  if (HITS.size > 5000) HITS.clear(); // techo de memoria
  return prev.length > MAX_HITS;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const esSemana = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const esDia = (d: unknown): d is number =>
  Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 6;
const esDevice = (d: unknown): d is string =>
  typeof d === "string" && d.length > 0 && d.length <= 64;

// Broadcast por REST (no abre websocket desde el isolate). El cliente escucha
// con supabase.channel('menu-<semana>').on('broadcast', { event: 'voto' }, ...).
async function broadcast(semana: string, payload: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        messages: [{ topic: `menu-${semana}`, event: "voto", payload }],
      }),
    });
  } catch (e) {
    console.error("broadcast falló (no crítico)", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "desconocida";
  if (rateLimited(ip)) return json({ error: "demasiadas solicitudes" }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "json inválido" }, 400);
  }

  const action = body.action;
  const deviceId = body.device_id;
  if (!esDevice(deviceId)) return json({ error: "device_id inválido" }, 400);

  try {
    // ---- Elegir 1 de las 2 opciones del día ----
    if (action === "eleccion") {
      const { semana, dia, opcion } = body;
      if (!esSemana(semana) || !esDia(dia) || (opcion !== 1 && opcion !== 2)) {
        return json({ error: "datos de elección inválidos" }, 400);
      }
      const fila = {
        id: `e_${semana}_${dia}_${deviceId}`,
        semana,
        dia,
        opcion_elegida: opcion,
        device_id: deviceId,
      };
      const { error } = await admin
        .from("elecciones_menu")
        .upsert(fila, { onConflict: "semana,dia,device_id" });
      if (error) throw error;
      await broadcast(semana, { kind: "eleccion", dia });
      return json({ ok: true });
    }

    // ---- Sugerir mover un menú a otro día (reacción con comentario) ----
    if (action === "mover") {
      const { menu_id, semana, dia_sugerido, comentario } = body;
      if (
        typeof menu_id !== "string" || !menu_id || !esSemana(semana) ||
        !esDia(dia_sugerido)
      ) {
        return json({ error: "datos de 'mover' inválidos" }, 400);
      }
      const fila = {
        id: `r_${menu_id}_${deviceId}`,
        menu_id,
        tipo: "mover",
        dia_sugerido,
        comentario: String(comentario ?? "").slice(0, 140),
        device_id: deviceId,
      };
      const { error } = await admin
        .from("reacciones_menu")
        .upsert(fila, { onConflict: "menu_id,device_id" });
      if (error) throw error;
      await broadcast(semana, { kind: "mover", menu_id });
      return json({ ok: true });
    }

    // ---- Sugerir un plato/menú en texto libre (solo lo lee el admin) ----
    if (action === "sugerencia") {
      const { semana, dia, texto } = body;
      const t = String(texto ?? "").trim();
      if (!esSemana(semana) || !t) {
        return json({ error: "sugerencia inválida" }, 400);
      }
      const fila = {
        id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
        semana,
        dia: esDia(dia) ? dia : null,
        texto: t.slice(0, 200),
        device_id: deviceId,
      };
      const { error } = await admin.from("sugerencias_plato").insert(fila);
      if (error) throw error;
      // Sin broadcast: las sugerencias no se muestran en público.
      return json({ ok: true });
    }

    return json({ error: "acción desconocida" }, 400);
  } catch (e) {
    console.error("error escribiendo voto", e);
    return json({ error: "no se pudo registrar" }, 500);
  }
});
