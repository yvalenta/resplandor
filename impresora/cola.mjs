// El bucle del agente: tomar trabajos de la cola, imprimirlos y confirmar. Todo lo de afuera entra por el
// constructor (cliente de la base, formateador, impresora, registro), así las pruebas lo corren sin red ni
// papel y el arranque real (agente.mjs) solo lo cablea.
//
// (Caducidad: un ticket que lleva más de `caducaMinutos` en la cola —el agente estaba apagado— no se imprime al
// encender: se confirma como error «Caducó…». Así el ticket de ayer no sale al abrir el local.)
//
// Un ciclo:  reintenta las confirmaciones pendientes → impresora_tomar (hasta `max`) → por cada trabajo:
//   1. ¿ya lo imprimí (la red cayó antes de confirmar)? → solo confirma, NO imprime otra vez.
//   2. arma los bytes (construir); si el documento no sirve → confirma «error» con el motivo.
//   3. imprime (imprimir); si falla → confirma «error» (la base reintenta hasta 3 veces y luego lo da por perdido).
//   4. lo anota como impreso (impresas.json) y confirma «ok».
// Un trabajo malo NUNCA tumba el agente: cada paso va dentro de su try y el bucle sigue con el siguiente.
//
// Qué lo despierta: la señal de Realtime (despertar()), un sondeo cada `sondeoMs` (respaldo: la señal puede
// perderse) y, si hay más trabajos de los que caben en una tanda, él mismo. Un solo ciclo a la vez: lo que
// llegue mientras corre se junta en una sola vuelta más.
//
// UN trabajo por tanda (`max = 1`): la base reentrega a los 2 minutos lo que nadie confirmó, y el spooler tiene un
// tope de 30 s por trabajo. Con tandas de 5, el quinto podía esperar 4 × 30 s = 120 s su turno, la base se lo
// entregaba a otra ventana y salía dos veces. De a uno, lo tomado se imprime enseguida: lejos de los 2 minutos.

import { ErrorDocumento } from './ticket/escpos.mjs';

const TOPE_REINTENTO_CONFIRMAR_MS = 15 * 60_000;
const MAX_ESPERA_SONDEO_MS = 30_000;       // con la red caída se espacia el sondeo, pero al volver no se espera más de esto

// Cuánto llevaba esperando el trabajo cuando la base lo entregó: tomada_en − creada_en, los dos con el reloj de la
// BASE (no el del PC, que puede estar mal). null si la fila no trae las dos fechas.
export function minutosEnCola(trabajo) {
  const creada = Date.parse(trabajo?.creada_en);
  const tomada = Date.parse(trabajo?.tomada_en);
  return Number.isFinite(creada) && Number.isFinite(tomada) ? Math.max(0, (tomada - creada) / 60_000) : null;
}

const corto = (id) => (/^[0-9a-f-]{8,}$/i.test(String(id)) ? String(id).slice(0, 8) : '?');
const tipoSeguro = (t) => (/^[a-z]{1,20}$/.test(String(t)) ? String(t) : '?');
const mensajeDe = (e) => String(e?.message ?? e ?? 'error desconocido').replace(/\s+/g, ' ').slice(0, 200);

export class AgenteCola {
  constructor({
    cliente, construir, imprimir, log, impresas, version,
    sondeoMs = 5000, latidoMs = 30_000, max = 1, caducaMinutos = 0, ahora = () => Date.now(),
  }) {
    Object.assign(this, { cliente, construir, imprimir, log, impresas, version, sondeoMs, latidoMs, max, caducaMinutos, ahora });
    this.detenido = false;             // true solo después de detener(): así ciclo() sirve también sin iniciar() (--una-vez)
    this.corriendo = null;
    this.otraVez = false;
    this.pendientes = new Map();       // id → { ok, error, desde }: confirmaciones que no llegaron a la base
    this.fallosSeguidos = 0;
    this.tokenMalo = false;
    this.contadores = { impresos: 0, errores: 0 };
    this.timers = { sondeo: null, latido: null };
  }

  iniciar() {
    this.detenido = false;
    this.despertar();
    this.programarSondeo();
    this.latir();
    this.timers.latido = setInterval(() => this.latir(), this.latidoMs);
    this.timers.latido.unref?.();
  }

  async detener(graciaMs = 10_000) {
    this.detenido = true;
    clearTimeout(this.timers.sondeo);
    clearInterval(this.timers.latido);
    if (this.corriendo) {
      await Promise.race([this.corriendo.catch(() => {}), new Promise((r) => setTimeout(r, graciaMs).unref?.())]);
    }
  }

  programarSondeo() {
    if (this.detenido) return;
    const espera = this.fallosSeguidos >= 3
      ? Math.min(this.sondeoMs * 2 ** (this.fallosSeguidos - 2), MAX_ESPERA_SONDEO_MS)
      : this.sondeoMs;
    this.timers.sondeo = setTimeout(() => { this.despertar(); this.programarSondeo(); }, espera);
    this.timers.sondeo.unref?.();
  }

  /** Pide un ciclo ya (la señal de Realtime, el sondeo y el arranque llegan aquí). Devuelve la promesa del ciclo. */
  despertar() {
    if (this.corriendo) { this.otraVez = true; return this.corriendo; }
    this.corriendo = (async () => {
      try {
        do {
          this.otraVez = false;
          await this.ciclo();
        } while (this.otraVez && !this.detenido);
      } catch (e) {
        this.log.error(`Error inesperado en el ciclo (el agente sigue): ${mensajeDe(e)}`);
      } finally {
        this.corriendo = null;
      }
    })();
    return this.corriendo;
  }

  /** Un ciclo completo. Público para `--una-vez` y las pruebas; no lanza por culpa de un trabajo. */
  async ciclo() {
    await this.reintentarConfirmaciones();
    let trabajos;
    try {
      trabajos = await this.cliente.tomar(this.max);
      this.redOk();
    } catch (e) {
      this.fallo(e, 'tomar trabajos');
      return;
    }
    // Aunque llegue la orden de cerrar, lo ya tomado se termina de imprimir (≤ `max` trabajos): si no, quedarían
    // «imprimiendo» en la base hasta que se cumplan los 2 minutos de la reentrega.
    for (const trabajo of trabajos) await this.procesar(trabajo);
    if (trabajos.length >= this.max) this.otraVez = true;      // puede haber más esperando
  }

  async procesar(trabajo) {
    const id = trabajo.id;
    const nombre = `#${corto(id)} (${tipoSeguro(trabajo.tipo)}${Number.isInteger(trabajo.mesa_id) ? `, mesa ${trabajo.mesa_id}` : ''})`;
    try {
      if (this.impresas.tiene(id)) {
        this.log.aviso(`${nombre} ya se había impreso aquí (la confirmación no llegó): solo la confirmo, no saco otro papel.`);
        await this.confirmar(id, true);
        return;
      }

      const espera = minutosEnCola(trabajo);
      if (this.caducaMinutos > 0 && espera !== null && espera > this.caducaMinutos) {
        const motivo = `Caducó: llevaba ${Math.round(espera)} min esperando (el máximo es ${this.caducaMinutos}); no se imprime para no sacar un ticket viejo. Vuelve a pedirlo desde el POS.`;
        this.contadores.errores++;
        this.log.aviso(`${nombre} no se imprimió: ${motivo}`);
        await this.confirmar(id, false, motivo);
        return;
      }

      let documento = trabajo.contenido;
      if (typeof documento === 'string') {
        try { documento = JSON.parse(documento); } catch { /* lo dirá construir */ }
      }
      let bytes;
      try {
        bytes = this.construir(documento);
      } catch (e) {
        const motivo = e instanceof ErrorDocumento ? e.message : `No pude armar el ticket: ${mensajeDe(e)}`;
        this.contadores.errores++;
        this.log.error(`${nombre} no se imprimió: ${motivo}`);
        await this.confirmar(id, false, motivo);
        return;
      }

      const intento = Number.isInteger(trabajo.intentos) ? ` · intento ${trabajo.intentos}` : '';
      this.log.info(`Imprimiendo ${nombre}${intento}…`);
      const t0 = this.ahora();
      try {
        const r = await this.imprimir(bytes, trabajo);
        this.impresas.marcar(id, this.ahora());
        this.contadores.impresos++;
        this.log.info(`Impreso ${nombre}: ${bytes.length} bytes en ${((this.ahora() - t0) / 1000).toFixed(1)} s${r?.simulado ? ` (simulado: ${r.ruta})` : ''}.`);
      } catch (e) {
        this.contadores.errores++;
        this.log.error(`${nombre} no se imprimió: ${mensajeDe(e)}`);
        await this.confirmar(id, false, mensajeDe(e));
        return;
      }
      await this.confirmar(id, true);
    } catch (e) {
      // Cinturón y tirantes: nada de lo de arriba debería llegar aquí, pero el agente no se cae por un trabajo.
      this.log.error(`${nombre}: error inesperado, sigo con el siguiente: ${mensajeDe(e)}`);
    }
  }

  async confirmar(id, ok, error = null) {
    if (error !== null) error = this.log.tapar(error);          // lo que va a la base tampoco lleva el token ni la clave
    try {
      const r = await this.cliente.confirmar(id, ok, error);
      this.pendientes.delete(id);
      if (r && r.ok === false) this.log.aviso(`La base no aceptó la confirmación de #${corto(id)}${r.error ? `: ${String(r.error).slice(0, 120)}` : ''}.`);
    } catch (e) {
      if (!this.pendientes.has(id)) this.pendientes.set(id, { ok, error, desde: this.ahora() });
      this.log.aviso(`No pude confirmar #${corto(id)} a la base (${mensajeDe(e)}); lo reintento en el próximo ciclo.`);
    }
  }

  async reintentarConfirmaciones() {
    for (const [id, p] of [...this.pendientes]) {
      if (this.ahora() - p.desde > TOPE_REINTENTO_CONFIRMAR_MS) {
        this.pendientes.delete(id);
        this.log.error(`Dejé de intentar confirmar #${corto(id)} tras 15 minutos: la base lo volverá a entregar (y aquí no se vuelve a imprimir).`);
        continue;
      }
      try {
        await this.cliente.confirmar(id, p.ok, p.error);
        this.pendientes.delete(id);
        this.log.info(`Confirmé #${corto(id)} que había quedado pendiente.`);
      } catch { /* sigue pendiente */ }
    }
  }

  async latir() {
    if (this.detenido) return;
    try {
      const r = await this.cliente.latido(this.version);
      this.redOk();
      if (r && r.ok === false) {
        this.tokenMalo = true;
        this.log.limitado('token-malo', 600_000, 'error', 'La base no reconoce este token (o la impresora está desactivada). En el POS → Impresora de la caja, genera uno nuevo y pégalo en config.json. Mientras tanto no se imprimirá nada.');
      } else if (this.tokenMalo) {
        this.tokenMalo = false;
        this.log.olvidar('token-malo');
        this.log.info('La base volvió a reconocer el token.');
      }
    } catch (e) {
      this.fallo(e, 'avisar que estoy en línea');
    }
  }

  redOk() {
    if (this.fallosSeguidos > 0) {
      if (this.fallosSeguidos >= 2) this.log.info('Volvió la conexión con Supabase.');
      this.log.olvidar('red');
    }
    this.fallosSeguidos = 0;
  }

  fallo(e, queHacia) {
    this.fallosSeguidos++;
    const definitivo = e?.transitorio === false;
    this.log.limitado('red', definitivo || e?.falta ? 600_000 : 300_000, definitivo || e?.falta ? 'error' : 'aviso',
      `No pude ${queHacia}: ${mensajeDe(e)}${definitivo ? '' : ' Sigo intentando.'}`);
  }
}
