/* Resplandor Restaurante — datos en vivo de Supabase: la carta pública (`carta_publica`)
 * y el menú de la semana (`menus`), las mismas superficies públicas que ya leen
 * carta.html y menu.html. Nunca se embebe un menú ni una carta en un archivo estático
 * (local.json no los lleva): siempre se piden en vivo, y si la red o la base fallan se
 * lanza un Error en español — jamás se inventa ni se sirve una copia vieja.
 *
 * Sin DOM: `fetch` es inyectable (para las pruebas y para el Worker, que no tiene
 * `window`). Con timeout por AbortController, como carta.html.
 *
 * El texto que puede venir de una persona o de un agente (la `categoria` para filtrar la
 * carta) NUNCA se pasa a un filtro de PostgREST en la URL: se filtra siempre en JS,
 * después de traer las filas completas. El único filtro que sí va en la URL es `semana`
 * de `menus`, y solo porque lo calculamos acá mismo (el lunes ISO de la semana pedida),
 * nunca texto libre de quien llama — y aun así se valida el formato antes de usarlo.
 *
 * Corre como <script defer> (después de local.js) y como módulo en Node y en el Worker;
 * en los tres deja globalThis.RESPLANDOR_VIVO.
 */
(() => {
  'use strict';

  const R = globalThis.RESPLANDOR;
  if (!R) throw new Error('vivo.js necesita que local.js ya haya corrido (falta globalThis.RESPLANDOR).');

  async function pedirLista(url, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('No hay `fetch` disponible para leer datos en vivo.');
    const controlador = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const temporizador = controlador ? setTimeout(() => controlador.abort(), timeoutMs) : null;
    let resp;
    try {
      resp = await fetchImpl(url, {
        headers: { apikey: R.supabase.key, Authorization: `Bearer ${R.supabase.key}`, Accept: 'application/json' },
        signal: controlador ? controlador.signal : undefined,
      });
    } catch (err) {
      throw new Error(`No pude leer ${url}: ${(err && err.message) || err}`);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
    if (!resp.ok) throw new Error(`${url} respondió ${resp.status}${resp.statusText ? ' ' + resp.statusText : ''}.`);
    let datos;
    try {
      datos = await resp.json();
    } catch (err) {
      throw new Error(`${url} no devolvió JSON válido: ${(err && err.message) || err}`);
    }
    if (!Array.isArray(datos)) throw new Error(`${url} no devolvió una lista de filas.`);
    return datos;
  }

  const normalizarCarta = (f) => ({
    categoria: String(f?.categoria ?? ''),
    nombre: String(f?.nombre ?? ''),
    precio: Number(f?.precio) || 0,
    descripcion: f?.descripcion ? String(f.descripcion) : '',
  });

  /* leerCarta({ categoria?, fetch?, timeoutMs? }) → [{categoria,nombre,precio,descripcion}]
   * GET a la vista `carta_publica` (las mismas 4 columnas que carta.html). Si viene
   * `categoria`, se filtra DESPUÉS de traer las filas, nunca en la URL. */
  async function leerCarta({ categoria, fetch: fetchImpl, timeoutMs } = {}) {
    if (categoria !== undefined && typeof categoria !== 'string') throw new Error('«categoria» debe ser texto.');
    const url = `${R.supabase.url}/rest/v1/${R.supabase.vistaCarta}?select=${R.supabase.columnasCarta.join(',')}`;
    const filas = (await pedirLista(url, { fetch: fetchImpl, timeoutMs })).map(normalizarCarta);
    return categoria === undefined ? filas : filas.filter((f) => f.categoria === categoria);
  }

  // El lunes ISO (YYYY-MM-DD) de la semana de `fecha`, en hora de Colombia (UTC−5 fijo:
  // el país no tiene horario de verano) — SIN importar la zona del proceso que ejecuta
  // esto. La landing corre en el navegador de quien mira la página (normalmente
  // America/Bogota), pero el Worker de mcp/worker.mjs corre en UTC: usar getDay()/
  // getDate() locales ahí hace que, entre las 19:00 y la medianoche de un domingo en
  // Colombia, el Worker ya vea «lunes» (UTC) y calcule la semana SIGUIENTE, mientras la
  // landing sigue mostrando la actual. Por eso se corre el instante 5 horas hacia atrás y
  // se leen los campos UTC de ESE instante desplazado: eso da la fecha/día de la semana
  // de Colombia sin depender de la zona del proceso ni de Intl/timeZone.
  function lunesDe(fecha) {
    const d = new Date(new Date(fecha).getTime() - 5 * 60 * 60 * 1000);
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (dow - 1));
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }

  const normalizarMenu = (f) => ({
    id: String(f?.id ?? ''),
    semana: String(f?.semana ?? ''),
    dia: Number(f?.dia) || 0,
    opcion: Number(f?.opcion) || 0,
    etiqueta: f?.etiqueta ? String(f.etiqueta) : '',
    principal: String(f?.principal ?? ''),
    sopa: f?.sopa ? String(f.sopa) : '',
    guarnicion: f?.guarnicion ? String(f.guarnicion) : '',
    ensalada: f?.ensalada ? String(f.ensalada) : '',
    jugo: f?.jugo ? String(f.jugo) : '',
    fijo: Boolean(f?.fijo),
  });

  /* leerMenuSemana({ semana?, fetch?, timeoutMs? }) → { semana, dias: [fila, ...] }
   * GET a `menus` (activo=true) de una semana — la actual por defecto. `semana`, si se da,
   * tiene que ser un lunes ISO (YYYY-MM-DD): nunca texto libre de una persona o un agente. */
  async function leerMenuSemana({ semana, fetch: fetchImpl, timeoutMs } = {}) {
    const lunes = semana === undefined ? lunesDe(new Date()) : semana;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lunes)) throw new Error('«semana» debe ser una fecha ISO (AAAA-MM-DD), el lunes de esa semana.');
    const url =
      `${R.supabase.url}/rest/v1/${R.supabase.tablaMenus}` +
      `?select=id,semana,dia,opcion,etiqueta,principal,sopa,guarnicion,ensalada,jugo,fijo` +
      `&semana=eq.${lunes}&activo=eq.true&order=dia,opcion`;
    const filas = (await pedirLista(url, { fetch: fetchImpl, timeoutMs })).map(normalizarMenu);
    return { semana: lunes, dias: filas };
  }

  const RESPLANDOR_VIVO = { leerCarta, leerMenuSemana, lunesDe };
  globalThis.RESPLANDOR_VIVO = RESPLANDOR_VIVO;
  if (typeof module !== 'undefined' && module.exports) module.exports = RESPLANDOR_VIVO;
})();
