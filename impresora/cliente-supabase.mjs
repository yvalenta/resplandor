// El cliente de la cola, sin dependencias: tres llamadas RPC por fetch (PostgREST) a las funciones
// `impresora_tomar`, `impresora_confirmar` e `impresora_latido`. Lo único que sabe de la base es esto:
//
//   POST {supabaseUrl}/rest/v1/rpc/<función>   (apikey = la clave publicable; el token va en el cuerpo)
//
//   impresora_tomar(p_token, p_max)             → [ {id, tipo, mesa_id, orden_id, contenido, intentos, …} ]
//                                                 (vacío si no hay trabajos O si el token no vale: sin pistas)
//   impresora_confirmar(p_token, p_id, p_ok, p_error) → { ok: true, … }
//   impresora_latido(p_token, p_version)        → { ok: true|false, … }   ok:false = token inválido o impresora apagada
//
// Los errores salen como ErrorCola, con `transitorio` (red, 5xx, 429: se reintenta solo) o definitivo, y un
// mensaje en español que nunca lleva el token.

export class ErrorCola extends Error {
  constructor(mensaje, { estado = null, codigo = null, transitorio = true, falta = false } = {}) {
    super(mensaje);
    this.name = 'ErrorCola';
    this.estado = estado;
    this.codigo = codigo;
    this.transitorio = transitorio;
    this.falta = falta;          // la función no existe en la base: la migración no se ha aplicado
  }
}

export class ClienteCola {
  constructor({ supabaseUrl, publishableKey, token, fetchImpl = globalThis.fetch, tiempoMs = 15_000 }) {
    this.base = supabaseUrl.replace(/\/+$/, '');
    this.clave = publishableKey;
    this.token = token;
    this.fetch = fetchImpl;
    this.tiempoMs = tiempoMs;
  }

  async rpc(funcion, argumentos) {
    let respuesta;
    try {
      respuesta = await this.fetch(`${this.base}/rest/v1/rpc/${funcion}`, {
        method: 'POST',
        headers: {
          apikey: this.clave,
          Authorization: `Bearer ${this.clave}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(argumentos),
        signal: AbortSignal.timeout(this.tiempoMs),
      });
    } catch (e) {
      const agotado = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new ErrorCola(agotado ? `Supabase no respondió en ${Math.round(this.tiempoMs / 1000)} s.` : `Sin conexión con Supabase (${e?.cause?.code ?? e?.message ?? e}).`);
    }
    const texto = await respuesta.text().catch(() => '');
    let cuerpo = null;
    if (texto) { try { cuerpo = JSON.parse(texto); } catch { cuerpo = null; } }
    if (!respuesta.ok) {
      const codigo = cuerpo?.code ?? null;
      const detalle = String(cuerpo?.message ?? texto ?? '').replace(this.token, '***').slice(0, 200);
      if (codigo === 'PGRST202' || respuesta.status === 404) {
        throw new ErrorCola(`La base no tiene la función ${funcion} (¿falta aplicar la migración de la cola de impresión?).`, { estado: respuesta.status, codigo, transitorio: true, falta: true });
      }
      if (respuesta.status === 401 || respuesta.status === 403) {
        throw new ErrorCola(`Supabase rechazó la clave publicable (HTTP ${respuesta.status}): revisa «publishableKey» y «supabaseUrl» en config.json.`, { estado: respuesta.status, codigo, transitorio: false });
      }
      throw new ErrorCola(`Supabase respondió ${respuesta.status} en ${funcion}${detalle ? `: ${detalle}` : ''}.`, {
        estado: respuesta.status, codigo, transitorio: respuesta.status >= 500 || respuesta.status === 429 || respuesta.status === 408,
      });
    }
    return cuerpo;
  }

  /** Toma hasta `max` trabajos (la base los pasa a «imprimiendo»). Siempre una lista. */
  async tomar(max = 5) {
    const filas = await this.rpc('impresora_tomar', { p_token: this.token, p_max: max });
    if (filas === null || filas === undefined) return [];
    if (!Array.isArray(filas)) throw new ErrorCola('impresora_tomar no devolvió una lista de trabajos.', { transitorio: false });
    return filas.filter((f) => f && typeof f === 'object' && typeof f.id === 'string');
  }

  /** Avisa el resultado de un trabajo. `error` solo si ok es false. */
  async confirmar(id, ok, error = null) {
    return this.rpc('impresora_confirmar', { p_token: this.token, p_id: id, p_ok: ok === true, p_error: ok ? null : String(error ?? 'error').slice(0, 300) });
  }

  /** «Sigo aquí». Devuelve lo que conteste la base ({ok:false} = token inválido). */
  async latido(version) {
    return this.rpc('impresora_latido', { p_token: this.token, p_version: String(version) });
  }
}
