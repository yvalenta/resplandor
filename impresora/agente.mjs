#!/usr/bin/env node
// Resplandor · el agente de la impresora de la caja.
//
// Corre en el PC de la caja (Windows). Solo hace conexiones SALIENTES a Supabase: no abre puertos, no
// necesita Tailscale ni IP fija, y funciona detrás de cualquier router. Los teléfonos no instalan nada: el
// POS pone el trabajo en la cola (tabla `impresiones`); este agente lo toma, lo convierte a ESC/POS y lo manda
// RAW a la térmica por el spooler de Windows.
//
//   node agente.mjs                      arranca el agente (lo normal; lo hace iniciar.cmd)
//   node agente.mjs --impresoras         lista las impresoras que Windows conoce (para copiar el nombre)
//   node agente.mjs --prueba             imprime la página de prueba (tildes, ñ, columnas, QR, corte)
//   node agente.mjs --vista-previa f.json  muestra en pantalla cómo saldría un documento, sin imprimir
//   node agente.mjs --simular            no imprime: escribe los .bin y su vista de texto en salida/
//   node agente.mjs --una-vez            toma lo que haya, lo imprime y termina (para probar)
//   node agente.mjs --config ruta.json   usa otro config.json
//   node agente.mjs --version | --ayuda
//
// Códigos de salida: 0 bien, 1 falló al ejecutar, 2 config.json o uso incorrecto (iniciar.cmd NO reintenta).
// Docs para Yonatan: README-impresora.md. Formato de los documentos: ticket/escpos.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarConfig, ErrorConfig, RUTA_CONFIG } from './config.mjs';
import { Registro } from './registro.mjs';
import { Impresas } from './estado.mjs';
import { ClienteCola } from './cliente-supabase.mjs';
import { CanalRealtime, topicoDeToken, urlRealtime } from './realtime.mjs';
import { AgenteCola } from './cola.mjs';
import { construirTicket, ErrorDocumento } from './ticket/escpos.mjs';
import { bytesATexto } from './ticket/vista-texto.mjs';
import { documentoDePrueba } from './ticket/prueba.mjs';
import { imprimirRaw, listarImpresoras, formatearImpresoras, ErrorImpresion } from './imprimir-windows.mjs';
import { VERSION, NOMBRE } from './version.mjs';

const AYUDA = `${NOMBRE} ${VERSION}

Uso:  node agente.mjs [opción]

  (sin opción)          arranca el agente: toma la cola de impresión de Supabase y la imprime
  --impresoras          lista las impresoras de Windows (copia el nombre en config.json)
  --prueba              imprime la página de prueba
  --vista-previa f.json muestra cómo saldría un documento (sin imprimir)
  --simular             no imprime de verdad: guarda los .bin y su vista de texto en salida/
  --una-vez             toma lo que haya, lo imprime y termina
  --config ruta.json    usa otro archivo de configuración (por defecto, config.json junto a este programa)
  --version             muestra la versión
  --ayuda               muestra esto

Pasos y solución de problemas: README-impresora.md
`;

export function leerArgumentos(argv) {
  const a = { simular: false, config: null, vistaPrevia: null, otras: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--version' || x === '-v') a.version = true;
    else if (x === '--ayuda' || x === '--help' || x === '-h' || x === '-?') a.ayuda = true;
    else if (x === '--impresoras') a.impresoras = true;
    else if (x === '--prueba') a.prueba = true;
    else if (x === '--simular') a.simular = true;
    else if (x === '--una-vez') a.unaVez = true;
    else if (x === '--config') a.config = argv[++i] ?? '';
    else if (x === '--vista-previa') a.vistaPrevia = argv[++i] ?? '';
    else a.otras.push(x);
  }
  return a;
}

function sinNodeViejo(salida) {
  const mayor = Number(process.versions.node.split('.')[0]);
  if (mayor >= 22) return true;
  salida.error(`Se necesita Node 22 o más nuevo y este PC tiene ${process.versions.node}. Instala Node 22 LTS desde https://nodejs.org y vuelve a abrir esta ventana.`);
  return false;
}

/**
 * Punto de entrada. Devuelve el código de salida (el agente en marcha no devuelve: vive hasta Ctrl+C).
 * `io` permite probarlo sin tocar la consola.
 */
export async function main(argv, io = { salida: console, proceso: process }) {
  const { salida, proceso } = io;
  const a = leerArgumentos(argv);

  if (a.version) { salida.log(`${NOMBRE} ${VERSION} (Node ${process.versions.node})`); return 0; }
  if (a.ayuda) { salida.log(AYUDA); return 0; }
  if (a.otras.length) { salida.error(`No entiendo «${a.otras.join(' ')}». Mira las opciones con: node agente.mjs --ayuda`); return 2; }
  if ((a.config === '') || (a.vistaPrevia === '')) { salida.error('Falta el valor después de --config o --vista-previa. Mira: node agente.mjs --ayuda'); return 2; }
  if (!sinNodeViejo(salida)) return 2;

  if (a.impresoras) {
    try { salida.log(formatearImpresoras(await listarImpresoras())); return 0; }
    catch (e) { salida.error(e.message); return 1; }
  }

  const rutaConfig = a.config ? path.resolve(a.config) : RUTA_CONFIG;
  const soloImpresora = a.prueba || a.vistaPrevia;

  if (a.vistaPrevia) return vistaPrevia(a, rutaConfig, salida);

  let cargada;
  try {
    cargada = cargarConfig({ ruta: rutaConfig, modo: soloImpresora ? 'prueba' : 'agente', simular: a.simular });
  } catch (e) {
    if (!(e instanceof ErrorConfig)) throw e;
    salida.error(`No puedo arrancar: hay que arreglar config.json (${rutaConfig}):\n` + e.problemas.map((p) => `  - ${p}`).join('\n'));
    return 2;
  }
  const { config: cfg, avisos } = cargada;
  const carpeta = path.dirname(rutaConfig);
  const log = new Registro({ archivo: path.join(carpeta, 'impresiones.log'), secretos: [cfg.token, cfg.publishableKey].filter(Boolean), salida: (l, n) => (n === 'ERROR' ? salida.error(l) : salida.log(l)) });
  for (const v of avisos) log.aviso(v);

  const imprimir = (bytes) => imprimirRaw({
    bytes, impresora: cfg.impresora, simular: cfg.simular, carpetaSalida: cfg.carpetaSalida,
    columnas: cfg.columnas, tablaEscPos: cfg.tablaEscPos,
  });

  if (a.prueba) return paginaDePrueba(cfg, log, imprimir);

  return arrancar(cfg, log, { carpeta, imprimir, unaVez: a.unaVez, proceso });
}

async function vistaPrevia(a, rutaConfig, salida) {
  let opciones = {};
  try { opciones = cargarConfig({ ruta: rutaConfig, modo: 'prueba', simular: true }).config; } catch { /* sin config: valores de fábrica */ }
  let documento;
  try { documento = JSON.parse(fs.readFileSync(a.vistaPrevia, 'utf8')); }
  catch (e) { salida.error(`No pude leer el documento ${a.vistaPrevia}: ${e.message}`); return 1; }
  try {
    const bytes = construirTicket(documento, opciones.opcionesTicket);
    salida.log(bytesATexto(bytes, { columnas: opciones.columnas ?? 48, tablaEscPos: opciones.tablaEscPos ?? 2 }));
    salida.log(`(${bytes.length} bytes; no se imprimió nada)`);
    return 0;
  } catch (e) {
    salida.error(e instanceof ErrorDocumento ? e.message : `No pude armar el ticket: ${e.message}`);
    return 1;
  }
}

async function paginaDePrueba(cfg, log, imprimir) {
  const bytes = construirTicket(documentoDePrueba({ columnas: cfg.columnas, tablaEscPos: cfg.tablaEscPos, nombreImpresora: cfg.impresora }), cfg.opcionesTicket);
  try {
    const r = await imprimir(bytes);
    if (r.simulado) log.info(`Página de prueba simulada: ${r.ruta} (y su .txt al lado).`);
    else log.info(`Página de prueba enviada a «${cfg.impresora}». Mira el papel: la regla de números tiene que caber en una línea, con los bordes | | a cada lado; las tildes y la ñ tienen que verse bien.`);
    return 0;
  } catch (e) {
    log.error(`No se pudo imprimir la página de prueba: ${e.message}`);
    return 1;
  }
}

async function arrancar(cfg, log, { carpeta, imprimir, unaVez, proceso }) {
  log.info(`${NOMBRE} ${VERSION} · impresora «${cfg.impresora || '(ninguna)'}» · ${cfg.columnas} columnas · tabla ${cfg.tablaEscPos} · Node ${process.versions.node}`);
  if (cfg.simular) log.aviso(`MODO SIMULADO: los trabajos se marcan como impresos pero NO sale papel (guardo los .bin en ${cfg.carpetaSalida}). Para imprimir de verdad, arranca sin --simular y con "simular": false.`);

  if (!cfg.simular && process.platform === 'win32') {
    // Sin esperar: PowerShell tarda unos segundos en frío (sobre todo recién encendido el PC) y el agente no debe
    // quedarse parado por una comprobación que solo sirve para avisar.
    listarImpresoras().then((lista) => {
      if (!lista.some((p) => p.nombre.toLowerCase() === cfg.impresora.toLowerCase())) {
        log.aviso(`Windows no lista ninguna impresora llamada «${cfg.impresora}». Las que veo: ${lista.map((p) => `«${p.nombre}»`).join(', ') || 'ninguna'}. Sigo adelante por si se conecta después; si no, corrige «impresora» en config.json (node agente.mjs --impresoras).`);
      }
    }).catch((e) => log.aviso(`No pude comprobar la lista de impresoras de Windows (${e.message}); sigo adelante.`));
  } else if (!cfg.simular) {
    log.error('Este sistema no es Windows: el agente solo imprime de verdad en el PC de la caja. Usa --simular para probar.');
    return 1;
  }

  const cliente = new ClienteCola({ supabaseUrl: cfg.supabaseUrl, publishableKey: cfg.publishableKey, token: cfg.token });
  const agente = new AgenteCola({
    cliente, log, version: VERSION,
    impresas: new Impresas({ archivo: path.join(carpeta, 'impresas.json') }),
    construir: (documento) => construirTicket(documento, cfg.opcionesTicket),
    imprimir,
    sondeoMs: cfg.sondeoSegundos * 1000,
    latidoMs: cfg.latidoSegundos * 1000,
    caducaMinutos: cfg.caducaMinutos,
  });

  if (unaVez) {
    await agente.latir();
    await agente.despertar();                              // hasta vaciar la cola, tanda por tanda
    log.info(`Listo: ${agente.contadores.impresos} impreso(s), ${agente.contadores.errores} con error.`);
    return agente.contadores.errores ? 1 : 0;
  }

  let canal = null;
  try {
    canal = new CanalRealtime({
      url: urlRealtime(cfg.supabaseUrl, cfg.publishableKey),
      clave: cfg.publishableKey,
      topico: topicoDeToken(cfg.token),
      log,
      onSenal: () => agente.despertar(),
      onEstado: (estado) => {
        if (estado === 'unido') log.info('Señal en tiempo real conectada: los tickets salen al instante.');
      },
    });
  } catch (e) {
    log.aviso(`Sin señal en tiempo real (${e.message}); reviso la cola cada ${cfg.sondeoSegundos} s.`);
  }

  const mantener = setInterval(() => {}, 60_000);          // los demás temporizadores no impiden cerrar; este sí mantiene vivo el proceso
  const terminar = new Promise((resolve) => {
    let cerrando = false;
    const cerrar = async (por) => {
      if (cerrando) return;
      cerrando = true;
      log.info(`Cerrando el agente (${por})…`);
      canal?.detener();
      await agente.detener();
      clearInterval(mantener);
      log.info('Agente detenido.');
      resolve(0);
    };
    for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) { try { proceso.on(s, () => cerrar(s)); } catch { /* señal que este sistema no tiene */ } }
    proceso.on('uncaughtException', (e) => {
      log.error(`Error inesperado, reinicio limpio: ${e?.stack ?? e}`);
      proceso.exit(1);
    });
    proceso.on('unhandledRejection', (e) => log.error(`Promesa sin atender (el agente sigue): ${e?.message ?? e}`));
  });

  agente.iniciar();
  canal?.iniciar();
  log.info(`Esperando trabajos de impresión (reviso la cola cada ${cfg.sondeoSegundos} s, y al instante cuando llega la señal).`);
  return terminar;
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esPrincipal) {
  main(process.argv.slice(2)).then((codigo) => process.exit(codigo), (e) => {
    console.error(e instanceof ErrorImpresion ? e.message : (e?.stack ?? e));
    process.exit(1);
  });
}
