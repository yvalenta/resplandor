// Lógica PURA de la Edge Function `alerta` (sin red, sin Deno, sin imports): validar la
// solicitud, decidir el CORS, limitar el ritmo y traducir la respuesta de la base a HTTP.
// Vive aparte de index.ts para poder probarla con node
// (scripts/pruebas/roles-y-alertas.test.mjs, Node >= 22.18 corre .ts sin compilar), y por
// eso solo usa sintaxis que Node sabe borrar: nada de enum ni de `import` aquí.

export const METODOS = ["qr", "transferencia", "efectivo"] as const;
export type Metodo = typeof METODOS[number];

// CORS limitado al sitio y a los puertos de prueba (README: servidor local en 8787).
export const ORIGENES_PERMITIDOS = [
  "https://resplandor.ynt.codes",
  "http://127.0.0.1:8787",
  "http://localhost:8787",
] as const;

export const MAX_CUERPO_BYTES = 1024;

// Rate-limit best-effort en memoria del isolate (mismo aviso que en `votar` y `cuenta`:
// primer filtro barato, no garantía dura; la garantía de «una sola alerta pendiente por
// mesa» la da el índice único de la base).
// · Por IP: en un restaurante todos los celulares salen por el mismo wifi, así que el techo
//   tiene que dejar pasar a una sala llena pidiendo la cuenta a la vez.
// · Por mesa: protege la atención del mesero (cada cambio de la alerta le llega al POS). Solo
//   cuentan los toques que SÍ escribieron, así quien adivina números de mesa con un token
//   falso no le gasta el cupo a la mesa de verdad.
export const LIMITE_IP = { ventanaMs: 60_000, max: 30 } as const;
export const LIMITE_MESA = { ventanaMs: 60_000, max: 6 } as const;

export type CodigoError =
  | "solicitud_invalida"
  | "enlace_invalido"
  | "metodo_invalido"
  | "sin_cuenta"
  | "origen_no_permitido"
  | "metodo_no_permitido"
  | "demasiadas_solicitudes"
  | "error_interno";

export const MENSAJES: Record<CodigoError, string> = {
  solicitud_invalida: "solicitud inválida",
  enlace_invalido: "enlace inválido",
  metodo_invalido: "método inválido",
  sin_cuenta: "no hay una cuenta abierta en esta mesa",
  origen_no_permitido: "origen no permitido",
  metodo_no_permitido: "método HTTP no permitido",
  demasiadas_solicitudes: "demasiadas solicitudes",
  error_interno: "no se pudo registrar la alerta",
};

export const ESTADO_HTTP: Record<CodigoError, number> = {
  solicitud_invalida: 400,
  enlace_invalido: 404, // el par (mesa, token) no existe; el formato roto es 400 (errorDeSolicitud)
  metodo_invalido: 400,
  sin_cuenta: 409,
  origen_no_permitido: 403,
  metodo_no_permitido: 405,
  demasiadas_solicitudes: 429,
  error_interno: 500,
};

export function origenPermitido(origen: string | null | undefined): boolean {
  return typeof origen === "string" &&
    (ORIGENES_PERMITIDOS as readonly string[]).includes(origen);
}

/** Cabeceras CORS para un Origin: solo si está en la lista se devuelve Allow-Origin. */
export function cabecerasCors(origen: string | null | undefined): Record<string, string> {
  const base: Record<string, string> = { "Vary": "Origin" };
  if (!origenPermitido(origen)) return base;
  return {
    ...base,
    "Access-Control-Allow-Origin": origen as string,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
  };
}

const esMesa = (m: unknown): m is string => typeof m === "string" && /^\d{1,4}$/.test(m);
const esToken = (k: unknown): k is string =>
  typeof k === "string" && /^[0-9a-f]{32,64}$/.test(k);
export const esMetodo = (x: unknown): x is Metodo =>
  typeof x === "string" && (METODOS as readonly string[]).includes(x);

export type Solicitud = { m: number; k: string; metodo: Metodo };
export type LecturaSolicitud =
  | { ok: true; solicitud: Solicitud }
  | { ok: false; codigo: "solicitud_invalida" | "enlace_invalido" | "metodo_invalido" };

/** Valida el cuerpo `{ m, k, metodo }`. `m` llega como número o como texto de dígitos. */
export function leerSolicitud(texto: string): LecturaSolicitud {
  if (typeof texto !== "string" || new TextEncoder().encode(texto).length > MAX_CUERPO_BYTES) {
    return { ok: false, codigo: "solicitud_invalida" };
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return { ok: false, codigo: "solicitud_invalida" };
  }
  if (cuerpo === null || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    return { ok: false, codigo: "solicitud_invalida" };
  }
  const { m, k, metodo } = cuerpo as Record<string, unknown>;
  const mesa = typeof m === "number" && Number.isInteger(m) ? String(m) : m;
  if (!esMesa(mesa) || !esToken(k)) return { ok: false, codigo: "enlace_invalido" };
  if (!esMetodo(metodo)) return { ok: false, codigo: "metodo_invalido" };
  return { ok: true, solicitud: { m: Number(mesa), k, metodo } };
}

export type Limitador = {
  /** Registra un toque y dice si ya pasó el máximo (como `rateLimited` de cuenta). */
  golpe(clave: string): boolean;
  /** ¿El próximo toque pasaría el máximo? No registra nada. */
  excedido(clave: string): boolean;
  registrar(clave: string): void;
  /** Milisegundos hasta que se libere un hueco (0 si hay cupo). */
  espera(clave: string): number;
};

export function crearLimitador(
  cfg: { ventanaMs: number; max: number; techo?: number; ahora?: () => number },
): Limitador {
  const golpes = new Map<string, number[]>();
  const ahora = cfg.ahora ?? Date.now;
  const techo = cfg.techo ?? 5000;
  const vigentes = (clave: string): number[] => {
    const t = ahora();
    const v = (golpes.get(clave) || []).filter((x) => t - x < cfg.ventanaMs);
    if (v.length) golpes.set(clave, v);
    else golpes.delete(clave);
    return v;
  };
  const registrar = (clave: string) => {
    const v = vigentes(clave);
    v.push(ahora());
    golpes.set(clave, v);
    if (golpes.size > techo) golpes.clear(); // techo de memoria
  };
  return {
    golpe(clave) {
      registrar(clave);
      return (golpes.get(clave)?.length ?? 0) > cfg.max;
    },
    excedido: (clave) => vigentes(clave).length >= cfg.max,
    registrar,
    espera(clave) {
      const v = vigentes(clave);
      if (v.length < cfg.max) return 0;
      return Math.max(0, v[v.length - cfg.max] + cfg.ventanaMs - ahora());
    },
  };
}

export function ipDe(cabeceras: { get(nombre: string): string | null }): string {
  return (cabeceras.get("x-forwarded-for") || "").split(",")[0].trim() || "desconocida";
}

export type Respuesta = { estado: number; cuerpo: Record<string, unknown> };

export function error(codigo: CodigoError): Respuesta {
  return {
    estado: ESTADO_HTTP[codigo],
    cuerpo: { ok: false, codigo, error: MENSAJES[codigo] },
  };
}

/** Error de FORMATO en la solicitud: siempre 400, aunque el código sea `enlace_invalido`
 *  (el 404 de ese mismo código es para un par (mesa, token) bien formado que no existe). */
export function errorDeSolicitud(
  codigo: "solicitud_invalida" | "enlace_invalido" | "metodo_invalido",
): Respuesta {
  return { estado: 400, cuerpo: { ok: false, codigo, error: MENSAJES[codigo] } };
}

/** Traduce el jsonb de `public.alertar_cuenta` al HTTP del contrato. */
export function respuestaDeRpc(res: unknown): Respuesta {
  const r = (res && typeof res === "object" ? res : {}) as Record<string, unknown>;
  if (r.ok === true) {
    if (!esMetodo(r.metodo) || typeof r.creada_en !== "string") return error("error_interno");
    return { estado: 200, cuerpo: { ok: true, metodo: r.metodo, creada_en: r.creada_en } };
  }
  switch (r.codigo) {
    case "metodo_invalido":
    case "enlace_invalido":
    case "sin_cuenta":
      return error(r.codigo);
    default:
      return error("error_interno");
  }
}
