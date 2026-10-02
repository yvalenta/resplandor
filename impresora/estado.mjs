// Memoria corta de lo ya impreso, para no sacar el mismo ticket dos veces.
//
// El caso: el agente imprime, pero la red cae justo antes de avisarle a la base. La base ve el trabajo
// «imprimiendo» sin confirmar y, a los 2 minutos, lo vuelve a entregar. Si el agente se acuerda de que ya lo
// imprimió, solo confirma. La memoria se guarda en impresas.json (últimos 300 ids) para que también
// sobreviva a un reinicio del PC. Si el archivo no se puede escribir, se sigue solo con la memoria del proceso.

import fs from 'node:fs';
import path from 'node:path';

export class Impresas {
  constructor({ archivo = null, max = 300 } = {}) {
    this.archivo = archivo;
    this.max = max;
    this.ids = new Map();            // id → fecha (ms); el orden de inserción es el de antigüedad
    if (archivo) {
      try {
        const lista = JSON.parse(fs.readFileSync(archivo, 'utf8'));
        if (Array.isArray(lista)) for (const [id, t] of lista) if (typeof id === 'string') this.ids.set(id, Number(t) || 0);
      } catch { /* sin archivo o dañado: se empieza de cero */ }
    }
  }

  tiene(id) { return this.ids.has(id); }

  marcar(id, ahora = Date.now()) {
    this.ids.delete(id);
    this.ids.set(id, ahora);
    while (this.ids.size > this.max) this.ids.delete(this.ids.keys().next().value);
    this.guardar();
  }

  guardar() {
    if (!this.archivo) return;
    try {
      const temporal = `${this.archivo}.tmp`;
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
      fs.writeFileSync(temporal, JSON.stringify([...this.ids]));
      fs.renameSync(temporal, this.archivo);
    } catch { /* memoria de proceso nada más */ }
  }
}
