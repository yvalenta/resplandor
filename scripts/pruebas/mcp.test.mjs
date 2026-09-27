// Pruebas del MCP remoto (mcp/worker.mjs), sin red ni Worker real: `crearManejador`
// recibe `cargarLocal`/`leerCarta`/`leerMenuSemana` de mentira, así que solo se ejercita
// el transporte (JSON-RPC 2.0, errores, CORS) y las herramientas sobre datos conocidos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import '../../assets/js/local.js'; // side-effect: globalThis.RESPLANDOR
import '../../assets/js/solicitud.js'; // side-effect: globalThis.RESPLANDOR_SOLICITUD
import '../../assets/js/vivo.js'; // side-effect: globalThis.RESPLANDOR_VIVO
import workerPredeterminado, { crearManejador } from '../../mcp/worker.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const RUTA_LOCAL = path.join(RAIZ, 'local.json');
const RUTA_WORKER = path.join(RAIZ, 'mcp/worker.mjs');

const R = globalThis.RESPLANDOR;
const S = globalThis.RESPLANDOR_SOLICITUD;
const V = globalThis.RESPLANDOR_VIVO;

// Si local.json ya existe (lo genera scripts/descubrimiento.mjs, quizás en otra sesión)
// se usa tal cual; si no, se proyecta la misma forma desde RESPLANDOR/RESPLANDOR_SOLICITUD
// para no depender de un archivo que otro agente puede no haber escrito aún.
async function localDePrueba() {
  try {
    return JSON.parse(await readFile(RUTA_LOCAL, 'utf8'));
  } catch {
    const ejemplo = S.armarSolicitud({ tipo: 'reserva', personas: 2 });
    return {
      marca: R.marca,
      whatsapp: R.whatsapp,
      direccion: R.direccion,
      capacidad: R.capacidad,
      enlaces: R.enlaces,
      politicas: R.politicas,
      solicitud: {
        reglas: { maxPersonas: S.MAX_PERSONAS, maxTexto: S.MAX_TEXTO, tipos: S.TIPOS.map((t) => t.id), entregas: S.ENTREGAS, frecuencias: S.FRECUENCIAS.map((f) => f.id) },
        tipos: S.TIPOS,
        entregas: S.ENTREGAS,
        frecuencias: S.FRECUENCIAS,
        ejemplo: { entrada: { tipo: 'reserva', personas: 2 }, mensaje: ejemplo.mensaje, enlace: ejemplo.enlace },
      },
      agentes: { webmcp: { donde: 'document.modelContext', pagina: `${R.sitio}landing.html`, herramientas: ['ver_local'] }, mcp: null },
    };
  }
}

const local = await localDePrueba();

// Carta de prueba: dos categorías, para probar el filtro.
const CARTA_PRUEBA = [
  { categoria: 'Ejecutivos', nombre: 'Menú Resplandor', precio: 23000, descripcion: 'Menú del día' },
  { categoria: 'Bebidas', nombre: 'Agua', precio: 4000, descripcion: 'Botella' },
  { categoria: 'Bebidas', nombre: 'Gaseosa', precio: 6000, descripcion: '' },
];
const MENU_PRUEBA = { semana: '2026-09-21', dias: [{ id: 'lun-1', semana: '2026-09-21', dia: 1, opcion: 1, etiqueta: '', principal: 'Sancocho', sopa: '', guarnicion: 'Arroz', ensalada: '', jugo: 'Mango', fijo: false }] };

const cargarLocalOk = () => Promise.resolve(local);
const cargarLocalFalla = (mensaje = 'la red falló') => () => Promise.reject(new Error(mensaje));
const leerCartaOk = async ({ categoria } = {}) => (categoria === undefined ? CARTA_PRUEBA : CARTA_PRUEBA.filter((f) => f.categoria === categoria));
const leerCartaFalla = (mensaje = 'la base falló') => () => Promise.reject(new Error(mensaje));
const leerMenuSemanaOk = () => Promise.resolve(MENU_PRUEBA);
const leerMenuSemanaFalla = (mensaje = 'la base falló') => () => Promise.reject(new Error(mensaje));

const manejador = crearManejador({ cargarLocal: cargarLocalOk, leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaOk });

function peticion(cuerpo, { ruta = '/mcp', metodo = 'POST' } = {}) {
  const init = { method: metodo };
  if (cuerpo !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  }
  return new Request('http://mcp.local' + ruta, init);
}

// ───────────────────────── initialize ─────────────────────────

test('initialize devuelve la versión pedida cuando está soportada', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }));
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('Content-Type'), 'application/json');
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.protocolVersion, '2025-06-18');
  assert.deepEqual(cuerpo.result.capabilities, { tools: {} });
  assert.equal(cuerpo.result.serverInfo.name, 'resplandor-restaurante');
  assert.match(cuerpo.result.instructions, /WhatsApp/);
  assert.match(cuerpo.result.instructions, /never sends/i);
});

test('initialize con una versión no soportada devuelve la más nueva', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.protocolVersion, '2025-11-25');
});

test('initialize sin protocolVersion no revienta: devuelve la más nueva', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 3, method: 'initialize' }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.protocolVersion, '2025-11-25');
});

// ───────────────────────── notificaciones y ping ─────────────────────────

test('una notificación (sin id) responde 202 sin cuerpo', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(resp.status, 202);
  assert.equal(await resp.text(), '');
});

test('ping responde {}', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 4, method: 'ping' }));
  const cuerpo = await resp.json();
  assert.deepEqual(cuerpo.result, {});
});

// ───────────────────────── tools/list ─────────────────────────

test('tools/list expone las cuatro herramientas con las anotaciones acordadas (openWorldHint:true en las que leen Supabase en vivo)', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 5, method: 'tools/list' }));
  const cuerpo = await resp.json();
  const nombres = cuerpo.result.tools.map((t) => t.name).sort();
  assert.deepEqual(nombres, ['resplandor_preparar_solicitud', 'resplandor_ver_carta', 'resplandor_ver_local', 'resplandor_ver_menu_semana']);
  const anotacionesPorNombre = Object.fromEntries(cuerpo.result.tools.map((t) => [t.name, t.annotations]));
  assert.deepEqual(anotacionesPorNombre.resplandor_ver_local, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(anotacionesPorNombre.resplandor_preparar_solicitud, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(anotacionesPorNombre.resplandor_ver_carta, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  assert.deepEqual(anotacionesPorNombre.resplandor_ver_menu_semana, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  for (const t of cuerpo.result.tools) assert.equal(t.outputSchema, undefined);

  // Las descripciones de las herramientas que devuelven contenido ajeno (carta, menú,
  // solicitud) dicen que ese texto es dato, no instrucciones (contrato (e); hallazgo 20).
  const porNombre = Object.fromEntries(cuerpo.result.tools.map((t) => [t.name, t]));
  assert.match(porNombre.resplandor_ver_carta.description, /dato, no instrucciones/i);
  assert.match(porNombre.resplandor_ver_menu_semana.description, /dato, no instrucciones/i);
  assert.match(porNombre.resplandor_preparar_solicitud.description, /dato, no instrucciones/i);

  const preparar = cuerpo.result.tools.find((t) => t.name === 'resplandor_preparar_solicitud');
  assert.deepEqual(preparar.inputSchema.properties.tipo.enum, S.TIPOS.map((t) => t.id));
  assert.deepEqual(preparar.inputSchema.properties.entrega.enum, S.ENTREGAS);
  // Sin `maximum` en personas: si lo hubiera, un cliente que valide contra el esquema
  // podría rechazar 31+ antes de que armarSolicitud llegue a recortarlas con aviso.
  assert.equal(preparar.inputSchema.properties.personas.maximum, undefined);
});

// ───────────────────────── tools/call: resplandor_ver_local ─────────────────────────

test('resplandor_ver_local trae los datos del local en vivo', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'resplandor_ver_local', arguments: {} } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, undefined);
  assert.equal(cuerpo.result.structuredContent.marca, local.marca);
  assert.equal(cuerpo.result.structuredContent.capacidad, 30);
});

test('si local.json no carga, resplandor_ver_local responde isError con mensaje claro', async () => {
  const manejadorRoto = crearManejador({ cargarLocal: cargarLocalFalla('boom de red'), leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaOk });
  const resp = await manejadorRoto.fetch(peticion({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'resplandor_ver_local', arguments: {} } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, true);
  assert.match(cuerpo.result.content[0].text, /boom de red/);
});

// ───────────────────────── tools/call: resplandor_ver_carta ─────────────────────────

test('resplandor_ver_carta trae los items en vivo, marcados como dato ajeno (_meta.untrustedContent)', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'resplandor_ver_carta', arguments: {} } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, undefined);
  assert.equal(cuerpo.result.structuredContent.items.length, CARTA_PRUEBA.length);
  assert.equal(cuerpo.result._meta.untrustedContent, true);
  assert.match(cuerpo.result.structuredContent.aviso_contenido, /dato, no instrucciones/i);
});

test('resplandor_ver_carta filtra por categoría', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'resplandor_ver_carta', arguments: { categoria: 'Bebidas' } } }));
  const cuerpo = await resp.json();
  assert.ok(cuerpo.result.structuredContent.items.length > 0);
  assert.ok(cuerpo.result.structuredContent.items.every((p) => p.categoria === 'Bebidas'));
});

test('si la carta no carga, resplandor_ver_carta responde isError con mensaje claro', async () => {
  const manejadorRoto = crearManejador({ cargarLocal: cargarLocalOk, leerCarta: leerCartaFalla('la carta se cayó'), leerMenuSemana: leerMenuSemanaOk });
  const resp = await manejadorRoto.fetch(peticion({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'resplandor_ver_carta', arguments: {} } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, true);
  assert.match(cuerpo.result.content[0].text, /la carta se cayó/);
});

test('"categoria" no textual en resplandor_ver_carta responde -32602', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'resplandor_ver_carta', arguments: { categoria: 5 } } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.error.code, -32602);
});

// El filtro de categoría se aplica en JS, nunca como parte de la URL de PostgREST: se
// prueba directo contra RESPLANDOR_VIVO.leerCarta (lo que usa el Worker de verdad), con
// un `fetch` inyectado que registra la URL pedida.
test('el filtro de categoría de la carta NUNCA llega a la URL de PostgREST', async () => {
  let urlPedida = null;
  const fetchEspia = async (url) => {
    urlPedida = url;
    return { ok: true, json: async () => CARTA_PRUEBA };
  };
  const items = await V.leerCarta({ categoria: 'Bebidas', fetch: fetchEspia });
  assert.ok(urlPedida, 'no se llamó a fetch');
  assert.doesNotMatch(urlPedida, /Bebidas/);
  assert.match(urlPedida, /select=categoria%2Cnombre%2Cprecio%2Cdescripcion|select=categoria,nombre,precio,descripcion/);
  assert.ok(items.length > 0 && items.every((i) => i.categoria === 'Bebidas'));
});

// ───────────────────────── tools/call: resplandor_ver_menu_semana ─────────────────────────

test('resplandor_ver_menu_semana trae el menú en vivo, marcado como dato ajeno (_meta.untrustedContent)', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'resplandor_ver_menu_semana', arguments: {} } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, undefined);
  assert.equal(cuerpo.result.structuredContent.semana, MENU_PRUEBA.semana);
  assert.equal(cuerpo.result.structuredContent.dias.length, MENU_PRUEBA.dias.length);
  assert.equal(cuerpo.result._meta.untrustedContent, true);
  assert.match(cuerpo.result.structuredContent.aviso_contenido, /dato, no instrucciones/i);
});

test('si el menú no carga, resplandor_ver_menu_semana responde isError', async () => {
  const manejadorRoto = crearManejador({ cargarLocal: cargarLocalOk, leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaFalla('sin red') });
  const resp = await manejadorRoto.fetch(peticion({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'resplandor_ver_menu_semana', arguments: {} } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, true);
  assert.match(cuerpo.result.content[0].text, /sin red/);
});

// ───────────────────────── tools/call: resplandor_preparar_solicitud ─────────────────────────

test('resplandor_preparar_solicitud arma exactamente el mismo mensaje que armarSolicitud()', async () => {
  const entrada = { tipo: 'reserva', fecha: '2026-10-03', personas: 4, nombre: 'Ana' };
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: entrada } }));
  const cuerpo = await resp.json();
  const esperado = S.armarSolicitud(entrada);
  assert.equal(cuerpo.result.isError, undefined);
  assert.equal(cuerpo.result.structuredContent.mensaje, esperado.mensaje);
  assert.equal(cuerpo.result.structuredContent.enlace, esperado.enlace);
  assert.match(cuerpo.result.structuredContent.aviso, /no se envió nada/i);
  assert.equal(cuerpo.result._meta.untrustedContent, true);
  assert.match(cuerpo.result.structuredContent.aviso_contenido, /dato, no instrucciones/i);
});

// Hallazgo: antes el aviso decía «abrí «enlace» (o copiá «mensaje») y mandalo vos mismo/a
// por WhatsApp» — en segunda persona, dirigido a QUIEN LEE el resultado (el agente), lo
// que es exactamente la orden que el contrato prohíbe (que el agente abra wa.me y mande
// la solicitud). El aviso tiene que hablar de «la persona» en tercera persona, y no puede
// llevar un imperativo dirigido al lector.
test('el aviso de resplandor_preparar_solicitud nunca le ordena al agente abrir/mandar el enlace; dice que la persona lo hace', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 33, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva' } } }));
  const cuerpo = await resp.json();
  const aviso = cuerpo.result.structuredContent.aviso;
  assert.doesNotMatch(aviso, /abr[íi]\s*«?enlace/i);
  assert.doesNotMatch(aviso, /mand[aá]lo/i);
  assert.doesNotMatch(aviso, /cop[ié]á?\s*«?mensaje/i);
  assert.match(aviso, /la persona/i);
});

test('resplandor_preparar_solicitud: personas > 30 se recorta a 30 con aviso', async () => {
  const entrada = { tipo: 'evento-corporativo', personas: 60 };
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: entrada } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, undefined);
  assert.equal(cuerpo.result.structuredContent.datos.personas, 30);
  assert.ok(cuerpo.result.structuredContent.avisos.some((a) => /capacidad es 30/i.test(a)));
});

test('resplandor_preparar_solicitud: entrega a domicilio en un tipo que no es almuerzo se ignora con aviso', async () => {
  const entrada = { tipo: 'fiesta-quince', entrega: 'domicilio', direccion: 'Calle 1' };
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: entrada } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.structuredContent.datos.entrega, null);
  assert.ok(cuerpo.result.structuredContent.avisos.some((a) => /solo en el local/i.test(a)));
});

test('resplandor_preparar_solicitud: almuerzo a domicilio sin dirección da aviso', async () => {
  const entrada = { tipo: 'almuerzo', entrega: 'domicilio' };
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: entrada } }));
  const cuerpo = await resp.json();
  assert.ok(cuerpo.result.structuredContent.avisos.some((a) => /falta la dirección/i.test(a)));
});

test('un tipo inexistente no rompe la solicitud: queda en avisos, cae a «otra»', async () => {
  const entrada = { tipo: 'boda-en-la-playa' };
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 18, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: entrada } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, undefined);
  assert.equal(cuerpo.result.structuredContent.datos.tipo, 'otra');
  assert.ok(cuerpo.result.structuredContent.avisos.some((a) => a.includes('boda-en-la-playa')));
});

test('si local.json no carga, resplandor_preparar_solicitud responde isError', async () => {
  const manejadorRoto = crearManejador({ cargarLocal: cargarLocalFalla('sin red'), leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaOk });
  const resp = await manejadorRoto.fetch(peticion({ jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva' } } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, true);
  assert.match(cuerpo.result.content[0].text, /sin red/);
});

test('si local.json trae reglas de solicitud que ya no son las del bundle, isError pide redesplegar', async () => {
  const localDesactualizado = { ...local, solicitud: { ...local.solicitud, reglas: { ...local.solicitud.reglas, maxPersonas: 50 } } };
  const manejadorViejo = crearManejador({ cargarLocal: () => Promise.resolve(localDesactualizado), leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaOk });
  const resp = await manejadorViejo.fetch(peticion({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva' } } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, true);
  assert.match(cuerpo.result.content[0].text, /redesplegar/i);
});

// Hallazgo: antes reglasDesactualizadas solo miraba maxPersonas/maxTexto/los ids de
// tipos-entregas-frecuencias. Si alguien cambiaba el WhatsApp, la dirección, una etiqueta
// o la receta misma del mensaje (marca, formato) sin redesplegar el Worker, éste seguía
// respondiendo como si nada — las solicitudes de la gente habrían llegado a un WhatsApp
// viejo sin que nadie lo notara. Ahora TODO eso se compara contra local.json en vivo.
test('local.json con un WhatsApp/dirección/marca distinto del bundle: isError pide redesplegar', async () => {
  for (const cambio of [{ whatsapp: '573009998877' }, { direccion: 'Calle 80 Sur #60-10, La Estrella' }, { marca: 'Otro Nombre' }]) {
    const localDesactualizado = { ...local, ...cambio };
    const manejadorViejo = crearManejador({ cargarLocal: () => Promise.resolve(localDesactualizado), leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaOk });
    const resp = await manejadorViejo.fetch(peticion({ jsonrpc: '2.0', id: 34, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva' } } }));
    const cuerpo = await resp.json();
    assert.equal(cuerpo.result.isError, true, `${JSON.stringify(cambio)} debería detectarse como desactualizado`);
    assert.match(cuerpo.result.content[0].text, /redesplegar/i);
  }
});

test('local.json con una etiqueta de tipo o de frecuencia distinta del bundle: isError pide redesplegar', async () => {
  const tiposConEtiquetaDistinta = local.solicitud.tipos.map((t, i) => (i === 0 ? { ...t, etiqueta: 'Plan barril (en el local)' } : t));
  const localDesactualizado = { ...local, solicitud: { ...local.solicitud, tipos: tiposConEtiquetaDistinta } };
  const manejadorViejo = crearManejador({ cargarLocal: () => Promise.resolve(localDesactualizado), leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaOk });
  const resp = await manejadorViejo.fetch(peticion({ jsonrpc: '2.0', id: 35, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva' } } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, true);
  assert.match(cuerpo.result.content[0].text, /redesplegar/i);
});

test('local.json con un ejemplo (mensaje/enlace) que ya no coincide con armarSolicitud(): isError pide redesplegar (detecta cambios en la receta del mensaje)', async () => {
  const localDesactualizado = { ...local, solicitud: { ...local.solicitud, ejemplo: { ...local.solicitud.ejemplo, mensaje: local.solicitud.ejemplo.mensaje + ' (cambiado)' } } };
  const manejadorViejo = crearManejador({ cargarLocal: () => Promise.resolve(localDesactualizado), leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaOk });
  const resp = await manejadorViejo.fetch(peticion({ jsonrpc: '2.0', id: 36, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva' } } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, true);
  assert.match(cuerpo.result.content[0].text, /redesplegar/i);
});

test('resplandor_ver_local y resplandor_ver_carta no revientan aunque local.json.solicitud.reglas esté desactualizado (no las usan)', async () => {
  const localDesactualizado = { ...local, solicitud: { ...local.solicitud, reglas: { ...local.solicitud.reglas, maxPersonas: 999 } } };
  const manejadorViejo = crearManejador({ cargarLocal: () => Promise.resolve(localDesactualizado), leerCarta: leerCartaOk, leerMenuSemana: leerMenuSemanaOk });
  const r1 = await (await manejadorViejo.fetch(peticion({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'resplandor_ver_local', arguments: {} } }))).json();
  assert.equal(r1.result.isError, undefined);
  const r2 = await (await manejadorViejo.fetch(peticion({ jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'resplandor_ver_carta', arguments: {} } }))).json();
  assert.equal(r2.result.isError, undefined);
});

test('personas no entero/negativo en resplandor_preparar_solicitud responde -32602', async () => {
  for (const personas of [-1, 1.5, 'muchas']) {
    const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 23, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva', personas } } }));
    const cuerpo = await resp.json();
    assert.equal(cuerpo.error.code, -32602, `personas=${personas} debería rechazarse en el transporte`);
  }
});

// ───────────────────────── errores JSON-RPC ─────────────────────────

test('JSON inválido responde -32700', async () => {
  const resp = await manejador.fetch(peticion('{ esto no es json', {}));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.error.code, -32700);
});

test('un lote (batch) responde -32600', async () => {
  const resp = await manejador.fetch(peticion([{ jsonrpc: '2.0', id: 1, method: 'ping' }]));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.error.code, -32600);
});

test('una petición sin jsonrpc "2.0" responde -32600', async () => {
  const resp = await manejador.fetch(peticion({ id: 1, method: 'ping' }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.error.code, -32600);
});

test('método desconocido responde -32601', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 24, method: 'no/existe' }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.error.code, -32601);
});

test('tools/call con nombre de herramienta desconocido responde -32602', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 25, method: 'tools/call', params: { name: 'no_existe', arguments: {} } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.error.code, -32602);
});

// ───────────────────────── tope de cuerpo (413) ─────────────────────────

// Hallazgo: sin tope, un `tipo` de varios MB se devolvía entero (dos veces: content[0].text
// y structuredContent) dentro de `avisos` — una respuesta de 10 MB por una petición de 5 MB.
// Ahora se corta ANTES de parsear nada: 413 con un error JSON-RPC, no 200.
test('un cuerpo de más de 64 KB responde 413 (JSON-RPC), no 200', async () => {
  const cuerpoGrande = { jsonrpc: '2.0', id: 40, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'a'.repeat(200 * 1024) } } };
  const resp = await manejador.fetch(peticion(cuerpoGrande));
  assert.equal(resp.status, 413);
  const cuerpo = await resp.json();
  assert.equal(cuerpo.error.code, -32600);
});

test('un cuerpo chico de verdad sigue respondiendo 200 (el tope no molesta lo normal)', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 41, method: 'ping' }));
  assert.equal(resp.status, 200);
});

// Defensa en profundidad: aunque el Worker ya corte el cuerpo antes de llegar acá, un
// valor ajeno larguísimo que sí llegue a armarSolicitud (por otra puerta, como WebMCP)
// tampoco se copia entero en el aviso — ver la prueba equivalente en solicitud.test.mjs.
test('un tipo inválido larguísimo dentro de una solicitud preparada por el Worker no se copia entero en el aviso', async () => {
  const entrada = { tipo: 'x'.repeat(5000) };
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: entrada } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.isError, undefined);
  const aviso = cuerpo.result.structuredContent.avisos[0];
  assert.ok(!aviso.includes(entrada.tipo), 'el aviso no debería llevar el tipo entero de 5000 caracteres');
  assert.ok(aviso.length < 300, `el aviso quedó sospechosamente largo: ${aviso.length}`);
});

// ───────────────────────── versiones de protocolo (sin 2025-03-26) ─────────────────────────

// Hallazgo: 2025-03-26 exige aceptar lotes JSON-RPC (el soporte se quitó recién en
// 2025-06-18) y este Worker no los implementa; se sacó de VERSIONES_SOPORTADAS en vez de
// implementar lotes para ella (la opción simple, documentada en worker.mjs).
test('initialize pedido con 2025-03-26 (ya no soportada) devuelve la más nueva, no 2025-03-26', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 43, method: 'initialize', params: { protocolVersion: '2025-03-26' } }));
  const cuerpo = await resp.json();
  assert.equal(cuerpo.result.protocolVersion, '2025-11-25');
});

test('MCP-Protocol-Version: 2025-03-26 en una petición post-initialize responde 400 (ya no está soportada)', async () => {
  const req = new Request('http://mcp.local/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-03-26' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 44, method: 'ping' }),
  });
  const resp = await manejador.fetch(req);
  assert.equal(resp.status, 400);
});

// ───────────────────────── CORS y GET ─────────────────────────

test('OPTIONS responde con CORS abierto', async () => {
  const resp = await manejador.fetch(peticion(undefined, { metodo: 'OPTIONS' }));
  assert.equal(resp.status, 204);
  assert.equal(resp.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(resp.headers.get('Access-Control-Allow-Headers') || '', /Mcp-Protocol-Version/);
  assert.match(resp.headers.get('Access-Control-Allow-Headers') || '', /Mcp-Session-Id/);
});

test('las respuestas normales también llevan CORS abierto', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 26, method: 'ping' }));
  assert.equal(resp.headers.get('Access-Control-Allow-Origin'), '*');
});

test('GET /mcp responde 405 con Allow: POST', async () => {
  const resp = await manejador.fetch(peticion(undefined, { metodo: 'GET' }));
  assert.equal(resp.status, 405);
  assert.equal(resp.headers.get('Allow'), 'POST');
});

test('GET / explica qué es y dónde está local.json', async () => {
  const resp = await manejador.fetch(peticion(undefined, { ruta: '/', metodo: 'GET' }));
  assert.equal(resp.status, 200);
  const cuerpo = await resp.json();
  assert.match(cuerpo.local, /local\.json/);
  assert.match(cuerpo.que_es, /solo lectura/i);
});

test('los errores de transporte salen con HTTP 400, no 200', async () => {
  assert.equal((await manejador.fetch(peticion('{no es json'))).status, 400);
  assert.equal((await manejador.fetch(peticion([{ jsonrpc: '2.0', id: 1, method: 'ping' }]))).status, 400);
  assert.equal((await manejador.fetch(peticion({ jsonrpc: '2.0', id: null, method: 'ping' }))).status, 400);
});

test('una MCP-Protocol-Version no soportada responde 400; una soportada pasa', async () => {
  const conVersion = (v) => new Request('http://mcp.local/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': v }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }) });
  assert.equal((await manejador.fetch(conVersion('1999-01-01'))).status, 400);
  assert.equal((await manejador.fetch(conVersion('2025-06-18'))).status, 200);
});

// ───────────────────────── lunesDe en hora de Colombia ─────────────────────────

// Hallazgo: el Worker corre en UTC; la landing, en la zona de quien mira la página
// (normalmente America/Bogota). Con getDay()/getDate() LOCALES, un domingo entre las
// 19:00 y la medianoche (hora Colombia) el Worker ya ve «lunes» en UTC y calcula la
// semana SIGUIENTE, mientras la landing sigue en la actual. Se corre el mismo cálculo dos
// veces, en dos procesos con TZ distinta, y tiene que dar el mismo lunes en las dos.
test('lunesDe calcula el lunes en hora de Colombia (UTC-5 fijo), sin importar la zona del proceso', () => {
  const instanteDomingoNoche = '2026-09-27T20:30:00-05:00'; // domingo a la noche, hora Colombia
  const script = [
    `require(${JSON.stringify(path.join(RAIZ, 'assets/js/local.js'))});`,
    `require(${JSON.stringify(path.join(RAIZ, 'assets/js/vivo.js'))});`,
    `process.stdout.write(globalThis.RESPLANDOR_VIVO.lunesDe(new Date(${JSON.stringify(instanteDomingoNoche)})));`,
  ].join('\n');
  const conTZ = (tz) => execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz } }).toString();
  const enUTC = conTZ('UTC');
  const enBogota = conTZ('America/Bogota');
  assert.equal(enUTC, enBogota, 'el lunes calculado no debería depender de la zona del proceso');
  assert.equal(enUTC, '2026-09-21'); // el lunes de la semana de ese domingo, en Colombia
});

// ───────────────────────── «la persona envía» ─────────────────────────

// Antes esta prueba era una regex sobre el TEXTO de worker.mjs: pasaba en verde con un
// mutante que hiciera `await fetch(armado.enlace)` (abrir wa.me de verdad) o
// `fetch(.../rpc/votar, {method:'POST'})`, porque esas líneas no contienen la forma
// exacta que la regex buscaba. Ahora se ejecuta el `export default` REAL del Worker (el
// mismo que usa Cloudflare) con un `fetch` global espía, sobre las 4 herramientas, y se
// exige que TODA URL pedida sea Supabase (carta_publica/menus) o local.json — nunca
// wa.me, rpc/ ni functions/.
test('el fetch real del Worker (export default) solo pide Supabase (carta_publica/menus) o local.json: nunca wa.me, rpc/ ni functions/', async () => {
  const llamadas = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    llamadas.push(u);
    if (u.includes('local.json')) return { ok: true, json: async () => local };
    if (u.includes('carta_publica')) return { ok: true, json: async () => CARTA_PRUEBA };
    if (u.includes('/menus')) return { ok: true, json: async () => MENU_PRUEBA.dias };
    throw new Error('fetch no esperado en la prueba: ' + u);
  };
  try {
    const env = { LOCAL_URL: 'https://prueba.local/local.json' };
    const cuerpos = [
      { jsonrpc: '2.0', id: 100, method: 'tools/call', params: { name: 'resplandor_ver_local', arguments: {} } },
      { jsonrpc: '2.0', id: 101, method: 'tools/call', params: { name: 'resplandor_ver_carta', arguments: {} } },
      { jsonrpc: '2.0', id: 102, method: 'tools/call', params: { name: 'resplandor_ver_menu_semana', arguments: {} } },
      { jsonrpc: '2.0', id: 103, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva' } } },
    ];
    for (const cuerpo of cuerpos) await workerPredeterminado.fetch(peticion(cuerpo), env);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.ok(llamadas.length > 0, 'ninguna herramienta llamó a fetch');
  for (const url of llamadas) {
    assert.doesNotMatch(url, /wa\.me/i);
    assert.doesNotMatch(url, /\/rpc\//i);
    assert.doesNotMatch(url, /\/functions\//i);
    assert.ok(/supabase\.co\/rest\/v1\/(carta_publica|menus)\?/.test(url) || url.startsWith('https://prueba.local/local.json'), `URL inesperada: ${url}`);
  }
});

// «wa.me», «votar» y «cuenta» SÍ aparecen en comentarios/avisos del Worker (describiendo
// que la persona abre wa.me, o que la votación pasa en menu.html) — eso no es la llamada
// real que la prueba de arriba vigila.
test('ninguna herramienta del Worker invoca una Edge Function (votar/cuenta) por su cuenta', async () => {
  const codigo = await readFile(RUTA_WORKER, 'utf8');
  assert.ok(!codigo.includes('.invoke('), 'no debería invocar ninguna Edge Function (votar/cuenta)');
});

test('resplandor_preparar_solicitud nunca cobra: nunca menciona un monto en USDC ni pide pagar antes de nada', async () => {
  const resp = await manejador.fetch(peticion({ jsonrpc: '2.0', id: 27, method: 'tools/call', params: { name: 'resplandor_preparar_solicitud', arguments: { tipo: 'reserva' } } }));
  const cuerpo = await resp.json();
  assert.doesNotMatch(JSON.stringify(cuerpo.result), /usdc/i);
});
