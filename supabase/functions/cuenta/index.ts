// Edge Function: cuenta
// -----------------------------------------------------------------------------
// La cuenta de una mesa, leída desde la pegatina NFC (carta.html?m=<mesa>&k=<token>).
// Sigue el patrón de `votar`: la RLS bloquea a `anon` sobre `mesas` y `ordenes`,
// así que esta función es la ÚNICA puerta. Valida el par (mesa, token) con la
// service-role key, aplica rate-limit y devuelve SOLO la orden `abierta` de esa
// mesa: ítems agrupados (nombre, precio, cantidad), total y horas. Nunca devuelve
// órdenes cerradas ni datos de otras mesas, ni notas ni ids de ítems.
//
// Contrato v2 (docs/sdd-cuenta-en-mesa.md §04.3, fase 1): conserva los campos de
// siempre (`abierta`, `items`, `total`, `abierta_en`) para que la carta ya publicada
// siga funcionando durante el despliegue, y suma `estado`, `orden_id`, `marca`,
// `actualizada_en`, `canal`, `liquidar_activo`, `liquidacion` y `servidor_en`. El
// parámetro opcional `o` es el `orden_id` que la pestaña ya miraba: si ya no es la
// orden abierta de la mesa, la respuesta es `estado: "cerrada"` (nunca la orden siguiente).
//
// FASE 1: `liquidacion` es null y `liquidar_activo` es false, y NO se lee ninguna tabla de
// la fase 2 (`liquidaciones`, `ajustes_cuenta`): la función puede desplegarse antes que esa
// migración sin romperse. La parte 2B cambia esas dos lecturas por `public.cuenta_cliente(...)`.
//
// Una mesa INACTIVA (`mesas.activa = false`, migración 20261002160000) responde como un enlace inválido: 404, el
// mismo cuerpo, y cuenta para el límite de 404. Si la columna aún no existe, la función consulta como antes.
//
// PAGO CON BRE-B (migración 20261003150000_pago_breb.sql): si la mesa tiene una cuenta ABIERTA y el admin encendió
// `ajustes.pago_breb_visible`, la respuesta trae `pago: { breb: { llave, qr } }` (SOLO esos dos campos: la llave y el contenido
// del QR que la carta dibuja). En cualquier otro caso (sin cuenta abierta, cuenta cerrada, apagado, sin llave o sin QR, un valor
// que no pasa las reglas, o la migración sin aplicar y la lectura falla) la respuesta NO trae `pago`: la carta no inventa nada.
// `ajustes` solo se lee cuando hay cuenta abierta, con las cuatro columnas que la migración le da a service_role.
//
// Endpoint público POR DISEÑO (desplegar con --no-verify-jwt, como `votar`):
// la protección real es el token de 48 hex por mesa + rate-limit + CORS con lista.
// Fuga aceptada a ojos abiertos (tarea 2026-09-06): quien guardó el link ve la
// cuenta del siguiente ocupante mientras esté abierta (con `o`, una pestaña vieja ya no);
// el mesero puede rotar el token desde el POS.
// -----------------------------------------------------------------------------
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  agruparItems,
  aIso,
  crearLimitador,
  errorJson,
  esMesa,
  esOrdenId,
  esToken,
  ipDeSolicitud,
  json,
  marcaCuenta,
  origenPermitido,
  pagoBreb,
  respuestaPreflight,
  topicoCuenta,
} from "../_compartido/mesa.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 120/min por (IP, mesa), 600/min por IP y bloqueo de 10 min de la pareja (IP, mesa) tras más de 20 respuestas 404/min.
// En la memoria del isolate: primer filtro, no garantía dura (mismo aviso que en `votar`).
const limitador = crearLimitador();

// Cómo pagar esta cuenta: `{ breb: { llave, qr } }` o null. NUNCA rompe la cuenta: si `ajustes` no se puede leer (la migración
// aún no está aplicada: columna o permiso que faltan; o la base se cae un instante), se responde sin `pago`. El aviso del log sale
// como mucho una vez por minuto (con la migración sin aplicar, cada pedido de cada mesa lo repetiría).
let ultimoAvisoPago = -Infinity;
function avisarPago(...detalle: unknown[]) {
  const ahora = Date.now();
  if (ahora - ultimoAvisoPago < 60_000) return;
  ultimoAvisoPago = ahora;
  console.error("no se pudo leer el pago (se responde sin pago)", ...detalle);
}
async function leerPago() {
  try {
    const { data, error } = await admin
      .from("ajustes")
      .select("pago_breb_visible, pago_breb_llave, pago_breb_qr")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      avisarPago(error.code ?? "", error.message ?? "");
      return null;
    }
    return pagoBreb(data);
  } catch (e) {
    avisarPago(e);
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origen = req.headers.get("origin");
  // Un `Origin` presente fuera de la lista no recibe nada. Sin `Origin` (curl, el servidor de
  // alguien) se responde sin cabeceras CORS: el navegador es lo único que las necesita.
  if (origen !== null && !origenPermitido(origen)) {
    return errorJson(403, "origen", "origen no permitido");
  }
  if (req.method === "OPTIONS") return respuestaPreflight(origen, "GET, OPTIONS");
  if (req.method !== "GET") {
    return errorJson(405, "metodo", "método no permitido", origen, { Allow: "GET, OPTIONS" });
  }

  const ip = ipDeSolicitud(req.headers);
  const url = new URL(req.url);
  const m = url.searchParams.get("m");
  const k = url.searchParams.get("k");
  const o = url.searchParams.get("o");

  const espera = limitador.revisar(ip, esMesa(m) ? m : "-");
  if (!espera.ok) {
    return errorJson(429, "demasiadas", "demasiadas solicitudes", origen, {
      "Retry-After": String(espera.reintentarEn),
    });
  }
  if (!esMesa(m) || !esToken(k) || (o !== null && !esOrdenId(o))) {
    return errorJson(400, "formato", "enlace inválido", origen);
  }

  try {
    // El par (id, token) se valida en una sola consulta: sin fila, sin cuenta. Una mesa INACTIVA (`activa = false`,
    // la desactiva el admin desde «Mesas y pegatinas») responde EXACTAMENTE igual que un enlace que no existe:
    // mismo 404, mismo cuerpo, y cuenta para el límite de 404 como cualquier enlace inválido.
    let mesa: { id: number; activa?: boolean | null } | null = null;
    let eMesa: { code?: string } | null = null;
    ({ data: mesa, error: eMesa } = await admin
      .from("mesas")
      .select("id, activa")
      .eq("id", Number(m))
      .eq("token", k)
      .maybeSingle());
    if (eMesa && eMesa.code === "42703") {
      // La columna `activa` nace con la migración 20261002160000. Si la función se despliega antes que ella, se
      // consulta como siempre (todas las mesas cuentan como activas) en vez de romper la cuenta de todos.
      ({ data: mesa, error: eMesa } = await admin
        .from("mesas")
        .select("id")
        .eq("id", Number(m))
        .eq("token", k)
        .maybeSingle());
    }
    if (eMesa) throw eMesa;
    if (!mesa || mesa.activa === false) {
      limitador.registrar404(ip, m); // el barrido de tokens de ESTA mesa se corta aquí (por pareja IP+mesa)
      return errorJson(404, "enlace_invalido", "enlace inválido", origen);
    }

    const { data: orden, error: eOrden } = await admin
      .from("ordenes")
      .select("id, items, total, abierta_en, updated_at, version")
      .eq("mesa_id", mesa.id)
      .eq("estado", "abierta")
      .order("abierta_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eOrden) throw eOrden;

    const canal = { topico: await topicoCuenta(k), evento: "cambio", privado: false };
    const servidor_en = new Date().toISOString();

    // La pestaña miraba `o` y ya no es la orden abierta de esta mesa (cerrada, borrada o movida
    // a otra mesa): solo eso se dice. Ni los ítems ni si hay otra orden. `pago_confirmado` pasa a
    // leerse de `liquidaciones` en la fase 2; sin esa tabla, nunca se afirma un pago.
    if (o !== null && (!orden || orden.id !== o)) {
      return json({
        mesa: mesa.id,
        estado: "cerrada",
        abierta: false,
        pago_confirmado: false,
        canal,
        servidor_en,
      }, 200, origen);
    }

    if (!orden) {
      return json({
        mesa: mesa.id,
        estado: "sin_orden",
        abierta: false,
        marca: "0",
        canal,
        liquidar_activo: false,
        liquidacion: null,
        servidor_en,
      }, 200, origen);
    }

    // Solo lo que el comensal necesita: nada de notas de cocina ni ids de ítems.
    const items = agruparItems(orden.items);
    const total = Number(orden.total) ||
      items.reduce((s, i) => s + i.precio * i.cantidad, 0);

    // Solo con la cuenta abierta (aquí): la llave y el QR de Bre-B no salen en «sin_orden» ni en «cerrada».
    const pago = await leerPago();

    return json({
      mesa: mesa.id,
      estado: "abierta",
      abierta: true,
      orden_id: orden.id,
      marca: marcaCuenta(orden.version),
      abierta_en: aIso(orden.abierta_en),
      actualizada_en: aIso(orden.updated_at),
      items,
      total,
      canal,
      liquidar_activo: false,
      liquidacion: null,
      ...(pago ? { pago } : {}),
      servidor_en,
    }, 200, origen);
  } catch (e) {
    console.error("error leyendo la cuenta", e);
    return errorJson(500, "interno", "no se pudo leer la cuenta", origen);
  }
});
