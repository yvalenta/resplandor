// Edge Function: cuenta
// -----------------------------------------------------------------------------
// La cuenta de una mesa, leída desde la pegatina NFC (carta.html?m=<mesa>&k=<token>).
// Sigue el patrón de `votar`: la RLS bloquea a `anon` sobre `mesas` y `ordenes`,
// así que esta función es la ÚNICA puerta. Valida el par (mesa, token) con la
// service-role key, aplica rate-limit por IP y devuelve SOLO la orden `abierta`
// de esa mesa: ítems (nombre, precio, cantidad), total y hora de apertura.
// Nunca devuelve órdenes cerradas ni datos de otras mesas.
//
// Endpoint público POR DISEÑO (desplegar con --no-verify-jwt, como `votar`):
// la protección real es el token de 48 hex por mesa + rate-limit. Fuga
// aceptada a ojos abiertos (tarea 2026-09-06): quien guardó el link ve la
// cuenta del siguiente ocupante mientras esté abierta; el mesero puede rotar
// el token desde el POS.
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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// --- Rate-limit por IP: ventana deslizante best-effort en memoria del isolate
// (mismo aviso que en `votar`: primer filtro barato, no garantía dura). ---
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 40; // por IP por minuto: la carta refresca sola cada 20 s

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const prev = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  prev.push(now);
  HITS.set(ip, prev);
  if (HITS.size > 5000) HITS.clear();
  return prev.length > MAX_HITS;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

const esMesa = (m: string | null): m is string => !!m && /^\d{1,4}$/.test(m);
const esToken = (k: string | null): k is string =>
  !!k && /^[0-9a-f]{32,64}$/.test(k);

type Item = { nombre?: unknown; precio?: unknown; qty?: unknown; cantidad?: unknown };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "método no permitido" }, 405);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "desconocida";
  if (rateLimited(ip)) return json({ error: "demasiadas solicitudes" }, 429);

  const url = new URL(req.url);
  const m = url.searchParams.get("m");
  const k = url.searchParams.get("k");
  if (!esMesa(m) || !esToken(k)) return json({ error: "enlace inválido" }, 400);

  try {
    // El par (id, token) se valida en una sola consulta: sin fila, sin cuenta.
    const { data: mesa, error: eMesa } = await admin
      .from("mesas")
      .select("id, estado")
      .eq("id", Number(m))
      .eq("token", k)
      .maybeSingle();
    if (eMesa) throw eMesa;
    if (!mesa) return json({ error: "enlace inválido" }, 404);

    const { data: orden, error: eOrden } = await admin
      .from("ordenes")
      .select("items, total, abierta_en")
      .eq("mesa_id", mesa.id)
      .eq("estado", "abierta")
      .order("abierta_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eOrden) throw eOrden;

    if (!orden) return json({ mesa: mesa.id, abierta: false });

    // Solo lo que el comensal necesita: nada de notas de cocina ni ids.
    const items = ((orden.items as Item[]) || []).map((i) => ({
      nombre: String(i.nombre ?? ""),
      precio: Number(i.precio) || 0,
      cantidad: Number(i.qty ?? i.cantidad) || 1,
    }));
    const total = Number(orden.total) ||
      items.reduce((s, i) => s + i.precio * i.cantidad, 0);

    return json({
      mesa: mesa.id,
      abierta: true,
      abierta_en: orden.abierta_en,
      items,
      total,
    });
  } catch (e) {
    console.error("error leyendo la cuenta", e);
    return json({ error: "no se pudo leer la cuenta" }, 500);
  }
});
