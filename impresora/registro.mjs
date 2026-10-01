// El registro del agente: impresiones.log, rotado, y la misma línea en la consola.
//
// Nunca lanza: si el disco está lleno o el archivo está abierto en el Bloc de notas, el agente sigue
// imprimiendo y solo pierde la línea del log. Tampoco escribe nunca el token: los `secretos` que se le
// pasan se tapan con *** en cualquier mensaje.

import fs from 'node:fs';

const dos = (n) => String(n).padStart(2, '0');

/** «2026-10-01 18:22:11» en la hora del PC (la que ve Yonatan), no en UTC. */
export function marcaLocal(fecha = new Date()) {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}`;
}

export class Registro {
  constructor({ archivo = null, maxBytes = 1_000_000, copias = 3, consola = true, secretos = [], salida = null, reloj = () => new Date() } = {}) {
    this.archivo = archivo;
    this.maxBytes = maxBytes;
    this.copias = copias;
    this.consola = consola;
    this.secretos = secretos.filter((s) => typeof s === 'string' && s.length >= 8);
    this.salida = salida ?? ((linea, nivel) => (nivel === 'ERROR' ? console.error : console.log)(linea));
    this.reloj = reloj;
    this.ultimas = new Map();
    this.tamano = 0;
    if (archivo) {
      try { this.tamano = fs.statSync(archivo).size; } catch { this.tamano = 0; }
    }
  }

  tapar(texto) {
    let t = String(texto);
    for (const s of this.secretos) t = t.split(s).join('***');
    return t;
  }

  escribir(nivel, mensaje) {
    const linea = `${marcaLocal(this.reloj())} ${nivel.padEnd(5)} ${this.tapar(mensaje).replace(/\r?\n/g, ' ⏎ ')}`;
    if (this.consola) { try { this.salida(linea, nivel); } catch { /* consola cerrada */ } }
    if (!this.archivo) return;
    try {
      const bytes = Buffer.byteLength(linea) + 1;
      if (this.tamano + bytes > this.maxBytes) this.rotar();
      fs.appendFileSync(this.archivo, linea + '\n');
      this.tamano += bytes;
    } catch { /* el log es lo de menos: no se cae por él */ }
  }

  rotar() {
    try {
      for (let i = this.copias; i >= 1; i--) {
        const de = i === 1 ? this.archivo : `${this.archivo}.${i - 1}`;
        const a = `${this.archivo}.${i}`;
        if (fs.existsSync(de)) fs.renameSync(de, a);
      }
    } catch { /* si no se puede rotar, se sigue añadiendo */ }
    this.tamano = 0;
  }

  info(m) { this.escribir('INFO', m); }
  aviso(m) { this.escribir('AVISO', m); }
  error(m) { this.escribir('ERROR', m); }

  /** Lo mismo que `nivel`, pero a lo más una vez por `cadaMs` para la misma `clave` (un fallo de red cada 5 s no llena el log). */
  limitado(clave, cadaMs, nivel, mensaje) {
    const ahora = Date.now();
    if (ahora - (this.ultimas.get(clave) ?? 0) < cadaMs) return false;
    this.ultimas.set(clave, ahora);
    this[nivel](mensaje);
    return true;
  }
  olvidar(clave) { this.ultimas.delete(clave); }
}
