// Código compartido por las Edge Functions de la cuenta en mesa: hoy `cuenta`; en la fase 2,
// también `liquidar` (docs/sdd-cuenta-en-mesa.md §04.3 y §04.4).
//
// Es JS plano, sin importar nada de Deno ni de npm, a propósito: `node --test` lo prueba tal
// cual (scripts/pruebas/fn-cuenta.test.mjs), porque en esta máquina no hay Deno ni supabase CLI.
// Lo único «global» que usa existe en los dos mundos: Response, TextEncoder y crypto.subtle.
// El guion bajo de la carpeta es la convención de Supabase para código compartido: no se
// despliega como función (https://supabase.com/docs/guides/functions/development-tips).

// ───────────────────────── CORS con lista (SDD §04.3, §11 SD1) ─────────────────────────
// Solo la carta publicada puede LEER la respuesta desde un navegador, más `localhost` para
// desarrollo. No frena a un proxy del lado del servidor del atacante: es una capa más, no la
// defensa (la defensa es el token, y el código en la fase 2).

export const ORIGEN_PRODUCCION = "https://resplandor.ynt.codes";
const ORIGEN_LOCAL = /^http:\/\/localhost(?::\d{1,5})?$/;

/** ¿Este valor de la cabecera `Origin` puede leer las respuestas? */
export function origenPermitido(origen) {
  return typeof origen === "string" &&
    (origen === ORIGEN_PRODUCCION || ORIGEN_LOCAL.test(origen));
}

/**
 * Cabeceras CORS de una respuesta normal. `Vary: Origin` va SIEMPRE (la respuesta depende del
 * origen); `Access-Control-Allow-Origin` solo si el origen está en la lista: sin ella, el
 * navegador de un clon no puede leer nada. `Retry-After` se expone porque no es una cabecera
 * «segura» de CORS: sin esto la carta no podría leer cuánto esperar ante un 429.
 */
export function cabecerasCors(origen) {
  if (!origenPermitido(origen)) return { Vary: "Origin" };
  return {
    Vary: "Origin",
    "Access-Control-Allow-Origin": origen,
    "Access-Control-Expose-Headers": "Retry-After",
  };
}

/** Respuesta al preflight (OPTIONS). Sin origen permitido no lleva ninguna cabecera CORS. */
export function respuestaPreflight(origen, metodos = "GET, OPTIONS") {
  const cabeceras = cabecerasCors(origen);
  if (origenPermitido(origen)) {
    cabeceras["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type";
    cabeceras["Access-Control-Allow-Methods"] = metodos;
    // Cada preflight es una invocación del cupo de Edge Functions: que el navegador lo recuerde.
    cabeceras["Access-Control-Max-Age"] = "3600";
  }
  return new Response(null, { status: 204, headers: cabeceras });
}

// ───────────────────────── Respuestas JSON ─────────────────────────

/** JSON con CORS de lista y sin caché (la cuenta cambia cada segundo). */
export function json(cuerpo, estado = 200, origen = null, extra = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      ...cabecerasCors(origen),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

/** Todos los errores llevan `{error, codigo}` (§04.3): `error` para personas, `codigo` para máquinas. */
export function errorJson(estado, codigo, mensaje, origen = null, extra = {}) {
  return json({ error: mensaje, codigo }, estado, origen, extra);
}

// ───────────────────────── Validadores ─────────────────────────

// Con `@returns {x is string}` los validadores estrechan el tipo en el TypeScript de las funciones.

/** @param {unknown} m @returns {m is string} */
export const esMesa = (m) => typeof m === "string" && /^\d{1,4}$/.test(m);
/** @param {unknown} k @returns {k is string} */
export const esToken = (k) => typeof k === "string" && /^[0-9a-f]{32,64}$/.test(k);
/**
 * `o`: el `orden_id` que la pestaña ya estaba mirando (ids del POS: base36 de `uid()`).
 * @param {unknown} o @returns {o is string}
 */
export const esOrdenId = (o) => typeof o === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o);

/**
 * IP del cliente: el primer valor de `x-forwarded-for` (cuenta/index.ts de siempre). Si la
 * plataforma deja pasar el que manda el cliente, este límite se esquiva (SDD §10, R6): por eso
 * los topes que importan viven en la base. Se acota la longitud para que una cabecera enorme no
 * infle la memoria del limitador.
 * @param {Headers} cabeceras
 */
export function ipDeSolicitud(cabeceras) {
  const ip = (cabeceras.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64);
  return ip || "desconocida";
}

// ───────────────────────── Limitador (SDD §04.3, §11 M3) ─────────────────────────
// En la memoria del isolate: primer filtro barato, NO una garantía dura (los isolates son
// efímeros y puede haber varios). Ventana deslizante: se guardan las últimas `max + 1` marcas de
// tiempo de cada clave, así que la memoria está acotada aunque llegue una inundación.
//
//  · 120 por minuto por (IP, mesa): 3 o 4 teléfonos de la misma mesa detrás del wifi del local.
//  · 600 por minuto por IP: todo el local.
//  · más de 20 respuestas 404 por minuto desde una IP la bloquean 10 minutos: frena el barrido
//    de tokens (cada intento de formato válido y token inexistente es un 404).

/**
 * @param {{ahora?: () => number, ventanaMs?: number, maxPorIpMesa?: number, maxPorIp?: number,
 *          max404?: number, bloqueoMs?: number, maxClaves?: number}} [opciones]
 */
export function crearLimitador(opciones = {}) {
  const {
    ahora = () => Date.now(),
    ventanaMs = 60_000,
    maxPorIpMesa = 120,
    maxPorIp = 600,
    max404 = 20,
    bloqueoMs = 600_000,
    maxClaves = 5000,
  } = opciones;

  const porIpMesa = new Map();
  const porIp = new Map();
  const noEncontrados = new Map();
  const bloqueadas = new Map(); // ip → instante en que se libera

  // Techo de memoria: primero se sueltan las claves vencidas; si aun así sobran, se vacía todo.
  function podar(mapa, t) {
    for (const [clave, marcas] of mapa) {
      if (!marcas.length || t - marcas[marcas.length - 1] >= ventanaMs) mapa.delete(clave);
    }
    if (mapa.size > maxClaves) mapa.clear();
  }

  /** Registra un golpe. Devuelve 0 si cabe en el tope, o los segundos que faltan para que quepa. */
  function golpe(mapa, clave, max, t) {
    const marcas = mapa.get(clave) || [];
    while (marcas.length && t - marcas[0] >= ventanaMs) marcas.shift();
    marcas.push(t);
    if (marcas.length > max + 1) marcas.shift();
    mapa.set(clave, marcas);
    if (mapa.size > maxClaves) podar(mapa, t);
    return marcas.length > max ? Math.max(1, Math.ceil((marcas[0] + ventanaMs - t) / 1000)) : 0;
  }

  return {
    /**
     * Se llama en cada GET. `mesa` es la mesa pedida (solo si tiene formato válido; si no, «-»).
     * @param {string} ip @param {string} mesa
     * @returns {{ok: true} | {ok: false, reintentarEn: number}}
     */
    revisar(ip, mesa) {
      const t = ahora();
      const libre = bloqueadas.get(ip);
      if (libre !== undefined) {
        if (t < libre) return { ok: false, reintentarEn: Math.max(1, Math.ceil((libre - t) / 1000)) };
        bloqueadas.delete(ip);
      }
      const espIp = golpe(porIp, ip, maxPorIp, t);
      const espMesa = golpe(porIpMesa, ip + "|" + mesa, maxPorIpMesa, t);
      const espera = Math.max(espIp, espMesa);
      return espera ? { ok: false, reintentarEn: espera } : { ok: true };
    },
    /**
     * Se llama al responder un 404 `enlace_invalido`. El que pasa de `max404` bloquea la IP.
     * @param {string} ip
     */
    registrar404(ip) {
      const t = ahora();
      if (golpe(noEncontrados, ip, max404, t)) {
        bloqueadas.set(ip, t + bloqueoMs);
        if (bloqueadas.size > maxClaves) {
          for (const [clave, libre] of bloqueadas) if (t >= libre) bloqueadas.delete(clave);
          if (bloqueadas.size > maxClaves) bloqueadas.clear();
        }
      }
    },
  };
}

// ───────────────────────── Tópico del canal (SDD §04.1, §04.2) ─────────────────────────

/**
 * Tópico público de Realtime de una mesa: `cuenta:` + sha256 hex del token. Es la MISMA fórmula
 * que `privado.topico_cuenta` en la migración 20261001120000_cuenta_en_vivo.sql (1A): el trigger
 * emite a este tópico y la carta se une a él. Vector compartido con 1A: el token «000…0» de 48
 * ceros da cuenta:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a.
 * @param {string} token
 */
export async function topicoCuenta(token) {
  const huella = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return "cuenta:" +
    Array.from(new Uint8Array(huella), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ───────────────────────── Ítems y marca ─────────────────────────

/**
 * Los ítems que ve el cliente: `{nombre, precio, cantidad}`, SIN notas ni ids, agrupados por
 * (nombre, precio) y sumando la cantidad, en el orden de su primera aparición. Las 8
 * combinaciones del «Menú Resplandor» (pos.html) llegan como líneas con el mismo nombre y precio
 * y distinta nota: para el comensal son una sola (SDD §04.3, §11 B2, D8).
 * Una línea sin cantidad cuenta 1 (formato viejo); con cantidad 0, negativa o ilegible no es
 * parte de la cuenta y no sale.
 * @param {unknown} items
 * @returns {{nombre: string, precio: number, cantidad: number}[]}
 */
export function agruparItems(items) {
  const grupos = new Map();
  if (!Array.isArray(items)) return [];
  for (const i of items) {
    if (!i || typeof i !== "object" || Array.isArray(i)) continue;
    const bruto = i.qty ?? i.cantidad;
    const cantidad = bruto === undefined || bruto === null ? 1 : Number(bruto);
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    const nombre = String(i.nombre ?? "");
    const precioNum = Number(i.precio);
    const precio = Number.isFinite(precioNum) ? precioNum : 0;
    const clave = JSON.stringify([nombre, precio]);
    const grupo = grupos.get(clave);
    if (grupo) grupo.cantidad += cantidad;
    else grupos.set(clave, { nombre, precio, cantidad });
  }
  return [...grupos.values()];
}

/**
 * Huella del estado de la cuenta para detectar un canal mudo (SDD §03.2.7): cambia con cada
 * escritura de la orden (`ordenes.version`) y con cada cambio de la liquidación (fase 2). Sin
 * liquidación, el segundo término es 0: «14.0». El epoch va en MILISEGUNDOS, para que dos
 * cambios de la liquidación en el mismo segundo no den la misma marca; la SQL de la fase 2 debe
 * dar lo mismo: floor(extract(epoch from l.updated_at) * 1000).
 * @param {number | string | null | undefined} version `ordenes.version`
 * @param {string | null | undefined} [liquidacionActualizadaEn] `liquidaciones.updated_at`
 */
export function marcaCuenta(version, liquidacionActualizadaEn = null) {
  const v = Number(version);
  const epoch = liquidacionActualizadaEn ? Date.parse(liquidacionActualizadaEn) : 0;
  return `${Number.isFinite(v) ? v : 0}.${Number.isFinite(epoch) ? epoch : 0}`;
}

/** ISO 8601 en UTC, o null si el valor no es una fecha. */
export function aIso(valor) {
  if (valor === null || valor === undefined) return null;
  const ms = Date.parse(valor);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
