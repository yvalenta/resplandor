// Mandar los bytes a la térmica: RAW al spooler de Windows, sin módulos nativos ni programas de terceros.
//
//   Windows  → PowerShell + imprimir-raw.ps1 (winspool: OpenPrinter / StartDocPrinter «RAW» / WritePrinter).
//   --simular (cualquier sistema) → escribe el .bin y su vista de texto en salida/, sin impresora.
//   macOS / Linux sin --simular   → se niega con un mensaje claro: el agente es para el PC de la caja.
//
// Sin inyección: el nombre de la impresora y la ruta del .bin viajan como ARGUMENTOS de un `spawn` sin shell
// (una lista, no un texto) y el script .ps1 es un archivo fijo que los usa solo como valores. Los bytes van a
// un archivo temporal con nombre aleatorio y se borran al terminar. Ver imprimir-raw.ps1.
//
// También se puede correr directo, como atajo de agente.mjs (que es donde vive la línea de comandos):
//   node imprimir-windows.mjs --impresoras     lista las impresoras que Windows conoce
//   node imprimir-windows.mjs --prueba         imprime la página de prueba (tildes, ñ, columnas, QR, corte)
//   node imprimir-windows.mjs --prueba --simular   lo mismo sin impresora: deja el .bin y su vista de texto en salida/

import { spawn as spawnReal } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bytesATexto } from './ticket/vista-texto.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_RAW = path.join(AQUI, 'imprimir-raw.ps1');
export const TIEMPO_MAXIMO_MS = 30_000;
const MAX_SALIDA = 4096;

export class ErrorImpresion extends Error {
  constructor(mensaje, { codigo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorImpresion';
    this.codigo = codigo;
  }
}

/**
 * El nombre que se le pasa a PowerShell como argumento. Comillas y guion inicial no tienen cabida: con ellos
 * el argumento se podría leer como otro parámetro. (Un nombre de impresora de Windows normal no los lleva.)
 */
export function validarNombreImpresora(nombre) {
  if (typeof nombre !== 'string' || nombre.trim() === '') return 'está vacío';
  if (nombre.length > 200) return 'es demasiado largo (máximo 200 caracteres)';
  if (/[\x00-\x1f\x7f]/.test(nombre)) return 'lleva caracteres de control';
  if (nombre.includes('"')) return 'lleva comillas dobles (cópialo tal cual sale en --impresoras)';
  if (nombre.trim().startsWith('-')) return 'no puede empezar con un guion';
  return null;
}

export function rutaPowerShell(env = process.env) {
  const raiz = env.SystemRoot || env.windir || 'C:\\Windows';
  return path.win32.join(raiz, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Los argumentos de PowerShell para imprimir: una lista, sin shell. El nombre y la ruta son elementos aparte. */
export function argumentosImpresion({ script = SCRIPT_RAW, impresora, archivo }) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Impresora', impresora, '-Archivo', archivo];
}

// Lo que ve Yonatan cuando algo falla: el motivo en cristiano y qué hacer.
function explicarFallo(texto, codigoSalida) {
  const win32 = /Win32:(\d+)/.exec(texto)?.[1];
  if (win32 === '1801' || win32 === '2') {
    return 'Windows no conoce una impresora con ese nombre. Corre «node agente.mjs --impresoras» y copia el nombre exacto en config.json.';
  }
  if (win32 === '5') return 'Windows negó el acceso a la impresora (¿está compartida o la usa otro usuario?).';
  if (win32 === '1804') return 'El driver de la impresora no acepta datos RAW: reinstálala con el driver del fabricante o con «Generic / Text Only».';
  if (win32 === '1796') return 'El puerto de la impresora no existe (¿la térmica está desconectada del USB o apagada?).';
  if (/no se pudo abrir la impresora/i.test(texto)) return `${texto.trim()}. Revisa el nombre con «node agente.mjs --impresoras».`;
  if (/ExecutionPolicy|no está firmado|AuthorizationManager|PSSecurityException|digitally signed/i.test(texto)) {
    return 'Windows bloqueó el script de PowerShell por la política de ejecución (¿administrada por la empresa?). Pídele a quien administra el PC que permita imprimir-raw.ps1.';
  }
  return (texto.trim() || `PowerShell terminó con el código ${codigoSalida}`).slice(0, 300);
}

function correr(spawn, ejecutable, argumentos, { tiempoMs = TIEMPO_MAXIMO_MS } = {}) {
  return new Promise((resolve, reject) => {
    let hijo;
    try {
      hijo = spawn(ejecutable, argumentos, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new ErrorImpresion(`No se pudo lanzar PowerShell: ${e.message}`));
      return;
    }
    let salida = '';
    let errores = '';
    let terminado = false;
    const fin = (fn, valor) => { if (!terminado) { terminado = true; clearTimeout(reloj); fn(valor); } };
    const reloj = setTimeout(() => {
      try { hijo.kill(); } catch { /* ya no está */ }
      fin(reject, new ErrorImpresion(`PowerShell no respondió en ${Math.round(tiempoMs / 1000)} s (¿el spooler de impresión está detenido?).`));
    }, tiempoMs);
    hijo.stdout?.on('data', (d) => { if (salida.length < MAX_SALIDA) salida += d.toString('utf8'); });
    hijo.stderr?.on('data', (d) => { if (errores.length < MAX_SALIDA) errores += d.toString('utf8'); });
    hijo.on('error', (e) => fin(reject, new ErrorImpresion(
      e.code === 'ENOENT' ? 'No encuentro PowerShell (powershell.exe) en este PC.' : `No se pudo lanzar PowerShell: ${e.message}`)));
    hijo.on('close', (codigo) => fin(resolve, { codigo, salida, errores }));
  });
}

let contadorSimulado = 0;

/** --simular: escribe el .bin y la vista de texto (para mirar el ticket sin impresora). */
export async function simularImpresion({ bytes, carpetaSalida, columnas = 48, tablaEscPos = 2, ahora = new Date() }) {
  await fs.mkdir(carpetaSalida, { recursive: true });
  const marca = ahora.toISOString().replace(/[:.]/g, '-');
  const base = path.join(carpetaSalida, `${marca}-${String(++contadorSimulado).padStart(3, '0')}`);
  await fs.writeFile(`${base}.bin`, bytes);
  await fs.writeFile(`${base}.txt`, bytesATexto(bytes, { columnas, tablaEscPos }), 'utf8');
  return { simulado: true, ruta: `${base}.bin` };
}

/**
 * Imprime `bytes` RAW. Resuelve cuando Windows los recibió en el spooler (si la térmica está apagada o sin
 * papel, el spooler los guarda y salen cuando vuelva: eso no se puede saber desde aquí). Rechaza con
 * ErrorImpresion y un mensaje en español.
 */
export async function imprimirRaw({
  bytes, impresora, simular = false, carpetaSalida, columnas, tablaEscPos,
  plataforma = process.platform, spawn = spawnReal, tmp = os.tmpdir(), tiempoMs, env = process.env,
}) {
  if (simular) return simularImpresion({ bytes, carpetaSalida, columnas, tablaEscPos });
  if (plataforma !== 'win32') {
    throw new ErrorImpresion('Este agente imprime de verdad solo en Windows (el PC de la caja). Aquí usa --simular o "simular": true en config.json.');
  }
  const mal = validarNombreImpresora(impresora);
  if (mal) throw new ErrorImpresion(`El nombre de la impresora ${mal}.`);

  const archivo = path.join(tmp, `resplandor-${randomBytes(8).toString('hex')}.bin`);
  await fs.writeFile(archivo, bytes, { mode: 0o600 });
  try {
    const r = await correr(spawn, rutaPowerShell(env), argumentosImpresion({ impresora, archivo }), { tiempoMs });
    if (r.codigo !== 0) throw new ErrorImpresion(explicarFallo(r.errores || r.salida, r.codigo), { codigo: r.codigo });
    return { simulado: false };
  } finally {
    await fs.rm(archivo, { force: true }).catch(() => {});
  }
}

// ───────────────────────── --impresoras ─────────────────────────

// Texto fijo (nada del usuario entra aquí). La consola de PowerShell habla en OEM: se fuerza UTF-8 para las tildes.
const ORDEN_LISTAR = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '
  + 'Get-CimInstance -ClassName Win32_Printer | Select-Object Name, DriverName, PortName, Default | ConvertTo-Json -Compress';

/** Las impresoras que Windows conoce: [{nombre, driver, puerto, predeterminada}]. */
export async function listarImpresoras({ plataforma = process.platform, spawn = spawnReal, env = process.env } = {}) {
  if (plataforma !== 'win32') throw new ErrorImpresion('--impresoras lista las impresoras de Windows; este sistema no es Windows.');
  const r = await correr(spawn, rutaPowerShell(env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ORDEN_LISTAR], { tiempoMs: 20_000 });
  if (r.codigo !== 0) throw new ErrorImpresion(explicarFallo(r.errores || r.salida, r.codigo), { codigo: r.codigo });
  return interpretarListado(r.salida);
}

export function interpretarListado(salida) {
  const texto = String(salida ?? '').replace(/^\uFEFF/, '').trim();
  if (!texto) return [];
  let datos;
  try { datos = JSON.parse(texto); } catch { throw new ErrorImpresion('No entendí la lista de impresoras que devolvió Windows.'); }
  return (Array.isArray(datos) ? datos : [datos]).map((p) => ({
    nombre: String(p.Name ?? ''),
    driver: String(p.DriverName ?? ''),
    puerto: String(p.PortName ?? ''),
    predeterminada: p.Default === true,
  }));
}

export function formatearImpresoras(lista) {
  if (lista.length === 0) return 'Windows no tiene ninguna impresora instalada.\n';
  const lineas = ['Impresoras que Windows conoce (copia el NOMBRE exacto en config.json → "impresora"):', ''];
  for (const p of lista) {
    lineas.push(`  Nombre:  ${p.nombre}${p.predeterminada ? '   (predeterminada)' : ''}`);
    lineas.push(`  Driver:  ${p.driver}`);
    lineas.push(`  Puerto:  ${p.puerto}`);
    lineas.push('');
  }
  return lineas.join('\n');
}

// ───────────────────────── atajo de línea de comandos ─────────────────────────

// Solo con --impresoras o --prueba (y sus compañeras --simular / --config): cualquier otra cosa se niega en lugar de
// arrancar el agente por equivocación. El import es dinámico porque agente.mjs importa este archivo (sin ciclo).
const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esPrincipal) {
  const argumentos = process.argv.slice(2);
  if (!argumentos.some((a) => a === '--impresoras' || a === '--prueba')) {
    console.error('Este archivo solo se usa como atajo: «node imprimir-windows.mjs --impresoras» o «--prueba». Para arrancar el agente: node agente.mjs');
    process.exit(2);
  }
  // Sin `await` de nivel superior: agente.mjs importa este archivo y esperarlo aquí sería un ciclo que no termina.
  import('./agente.mjs').then(({ main }) => main(argumentos)).then(
    (codigo) => process.exit(codigo),
    (e) => { console.error(e?.stack ?? e); process.exit(1); },
  );
}
