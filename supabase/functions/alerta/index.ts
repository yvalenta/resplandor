// Edge Function: alerta
// -----------------------------------------------------------------------------
// «Pagar» desde la carta NFC: el cliente elige CÓMO quiere pagar (qr | transferencia |
// efectivo) y esta función deja una ALERTA para el personal. No devuelve datos bancarios ni
// QR (cero superficie de phishing por la pegatina): el mesero llega con el QR impreso o el
// datáfono, o recibe el efectivo, y él cobra y cierra en el POS. Sin propina.
//
//   POST { m, k, metodo }        (m = mesa, k = token de la pegatina, igual que `cuenta`)
//   200 { ok, metodo, creada_en }   la alerta quedó pendiente (o se actualizó)
//   400 método o enlace con formato inválido · 403 origen no permitido · 405
//   404 el par (mesa, token) no existe      · 409 la mesa no tiene cuenta abierta
//   429 demasiadas solicitudes (con Retry-After) · 500
//   (límites por IP y por mesa: ver logica.ts; la basura no le gasta el cupo a la sala)
//
// Sigue el patrón de `cuenta` y `votar`: la RLS bloquea a `anon`, así que esta función es la
// ÚNICA puerta para crear una alerta, y escribe con la service-role key a través de UNA
// función de la base (public.alertar_cuenta, supabase/migrations/20261002130000_alertas.sql): valida
// el par, exige una orden abierta y deja una sola pendiente por mesa en una sentencia
// atómica. Un segundo toque actualiza el método y la hora.
//
// Endpoint público POR DISEÑO (desplegar con --no-verify-jwt, como `cuenta` y `votar`; la
// carta no manda sesión): la protección real es el token de 48 hex por mesa, el CORS
// limitado a https://resplandor.ynt.codes, el rate-limit y el índice único de la base.
// Orden de salida: primero la migración de alertas (crea public.alertar_cuenta), luego esta función.
//
// Nunca se escribe el token en los logs.
// -----------------------------------------------------------------------------
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cabecerasCors,
  crearLimitador,
  error,
  errorDeSolicitud,
  ipDe,
  LIMITE_IP,
  LIMITE_IP_TOTAL,
  LIMITE_MESA,
  MAX_CUERPO_BYTES,
  origenPermitido,
  respuestaDeRpc,
  leerSolicitud,
  type Respuesta,
} from "./logica.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Ver los tres cupos en logica.ts: el total cuenta todo (techo de costo); los otros dos
// solo lo que escribió, y se reservan antes de llamar a la base.
const porIpTotal = crearLimitador(LIMITE_IP_TOTAL);
const porIp = crearLimitador(LIMITE_IP);
const porMesa = crearLimitador(LIMITE_MESA);

Deno.serve(async (req) => {
  const origen = req.headers.get("origin");
  const cors = cabecerasCors(origen);
  const responder = ({ estado, cuerpo }: Respuesta, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...extra,
      },
    });

  // Un navegador de otro sitio no puede ni leer la respuesta (CORS) ni hacer que escriba.
  if (origen !== null && !origenPermitido(origen)) return responder(error("origen_no_permitido"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return responder(error("metodo_no_permitido"), { Allow: "POST, OPTIONS" });

  const ip = ipDe(req.headers);
  if (porIpTotal.golpe(ip)) {
    return responder(error("demasiadas_solicitudes"), {
      "Retry-After": String(Math.max(1, Math.ceil(porIpTotal.espera(ip) / 1000))),
    });
  }

  const largo = Number(req.headers.get("content-length") || 0);
  if (largo > MAX_CUERPO_BYTES) return responder(errorDeSolicitud("solicitud_invalida"));
  const lectura = leerSolicitud(await req.text());
  if (!lectura.ok) return responder(errorDeSolicitud(lectura.codigo));
  const { m, k, metodo } = lectura.solicitud;

  // Cupos de escritura: se toman AHORA, antes del await, para que varias solicitudes
  // simultáneas no pasen todas el límite; se devuelven si la base no escribió nada.
  const clave = String(m);
  if (!porMesa.reservar(clave)) {
    return responder(error("demasiadas_solicitudes"), {
      "Retry-After": String(Math.max(1, Math.ceil(porMesa.espera(clave) / 1000))),
    });
  }
  if (!porIp.reservar(ip)) {
    porMesa.liberar(clave);
    return responder(error("demasiadas_solicitudes"), {
      "Retry-After": String(Math.max(1, Math.ceil(porIp.espera(ip) / 1000))),
    });
  }

  let escribio = false;
  try {
    const { data, error: eRpc } = await admin.rpc("alertar_cuenta", {
      p_mesa: m,
      p_token: k,
      p_metodo: metodo,
    });
    if (eRpc) throw eRpc;
    const respuesta = respuestaDeRpc(data);
    escribio = respuesta.estado === 200; // solo cuenta lo que SÍ escribió
    return responder(respuesta);
  } catch (e) {
    console.error("error creando la alerta", e);
    return responder(error("error_interno"));
  } finally {
    if (!escribio) {
      porMesa.liberar(clave);
      porIp.liberar(ip);
    }
  }
});
