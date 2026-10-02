// El corazón del agente: cliente de la cola (RPC por fetch), señal de Realtime (WebSocket Phoenix), y el bucle
// que toma → imprime → confirma. Contra un Supabase de mentira local (_impresora-simulada.mjs: HTTP + WebSocket).
//
// Lo que se vigila:
//   1. El cliente habla como PostgREST espera (apikey, cuerpo) y clasifica los errores (red, 401, falta la
//      migración, 5xx) sin filtrar nunca el token.
//   2. Realtime: se une al tópico derivado del token, oye CUALQUIER broadcast, detecta una conexión muerta con el
//      latido, se reconecta con espera creciente y, si cae del todo, el sondeo de respaldo sigue.
//   3. Un trabajo malo NO tumba el agente; un trabajo ya impreso NO se imprime dos veces aunque la base lo
//      vuelva a entregar; las confirmaciones perdidas se reintentan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearImpresoraSimulada } from './_impresora-simulada.mjs';
import { ClienteCola, ErrorCola } from '../../impresora/cliente-supabase.mjs';
import { CanalRealtime, topicoDeToken, urlRealtime, leerMensaje } from '../../impresora/realtime.mjs';
import { AgenteCola } from '../../impresora/cola.mjs';
import { Registro } from '../../impresora/registro.mjs';
import { Impresas } from '../../impresora/estado.mjs';
import { construirTicket, ErrorDocumento } from '../../impresora/ticket/escpos.mjs';
import { documentoDePrueba } from '../../impresora/ticket/prueba.mjs';

const esperarHasta = async (cond, ms = 3000, que = 'la condición') => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await cond()) return; await new Promise((r) => setTimeout(r, 10)); }
  assert.fail(`pasaron ${ms} ms y no se cumplió: ${que}`);
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-cola-'));
const DOC = { titulo: 'RESPLANDOR', lineas: [{ texto: '2x Café', der: '$ 8.000' }, '  sin azúcar'], cortar: true };

function registroDePrueba() {
  const lineas = [];
  const log = new Registro({ salida: (l) => lineas.push(l), consola: true });
  return { log, lineas, texto: () => lineas.join('\n') };
}
async function servidor(t, opciones) {
  const S = await crearImpresoraSimulada(opciones);
  t.after(() => S.cerrar());
  return S;
}
const clienteDe = (S, extra = {}) => new ClienteCola({ supabaseUrl: S.url, publishableKey: S.clave, token: S.token, ...extra });

// ───────────────────────── 1. el cliente RPC ─────────────────────────

test('tomar: POST a /rest/v1/rpc/impresora_tomar con apikey, Authorization y {p_token, p_max}; devuelve las filas', async (t) => {
  const S = await servidor(t);
  const a = S.encolar(DOC);
  const filas = await clienteDe(S).tomar(3);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].id, a.id);
  assert.deepEqual(filas[0].contenido, DOC);
  assert.equal(filas[0].intentos, 1);
  const llamada = S.llamadas.find((l) => l.rpc === 'impresora_tomar');
  assert.deepEqual(llamada.cuerpo, { p_token: S.token, p_max: 3 });
  assert.equal(llamada.apikey, S.clave);
  assert.equal(llamada.autorizacion, `Bearer ${S.clave}`);
  assert.equal(llamada.tipo, 'application/json');
  assert.equal(S.estadoDe(a.id), 'imprimiendo');
});

test('token inválido: lista vacía y sin pistas (la base no dice por qué); confirmar y latido dicen ok:false', async (t) => {
  const S = await servidor(t);
  S.encolar(DOC);
  const malo = clienteDe(S, { token: 'x'.repeat(40) });
  assert.deepEqual(await malo.tomar(), []);
  assert.deepEqual(await malo.latido('1.0.0'), { ok: false });
  assert.equal((await malo.confirmar(S.trabajos[0].id, true)).ok, false);
  assert.equal(S.trabajos[0].estado, 'pendiente', 'nadie con un token malo toca la cola');
});

test('confirmar: ok manda p_error null; error manda el motivo recortado a 300; latido manda la versión', async (t) => {
  const S = await servidor(t);
  const a = S.encolar(DOC);
  const c = clienteDe(S);
  await c.tomar();
  assert.deepEqual(await c.confirmar(a.id, true, 'esto no se manda'), { ok: true, estado: 'impresa' });
  assert.equal(S.llamadas.at(-1).cuerpo.p_error, null);
  const b = S.encolar(DOC);
  await c.tomar();
  await c.confirmar(b.id, false, 'x'.repeat(500));
  assert.equal(S.llamadas.at(-1).cuerpo.p_error.length, 300);
  assert.equal(S.llamadas.at(-1).cuerpo.p_ok, false);
  await c.latido('1.2.3');
  assert.deepEqual(S.latidos, ['1.2.3']);
});

test('errores: 401 es definitivo y habla de la clave; función ausente avisa de la migración; 503 y 429 son pasajeros; sin red y timeout', async (t) => {
  const S = await servidor(t);
  const c = clienteDe(S);
  const mala = clienteDe(S, { publishableKey: 'otra_clave_que_no_es_0123456789' });
  const e401 = await mala.tomar().catch((e) => e);
  assert.ok(e401 instanceof ErrorCola);
  assert.equal(e401.transitorio, false);
  assert.match(e401.message, /rechazó la clave publicable \(HTTP 401\).*publishableKey/);

  S.sinMigracion = true;
  const falta = await c.tomar().catch((e) => e);
  assert.equal(falta.falta, true);
  assert.match(falta.message, /no tiene la función impresora_tomar.*migración/);
  S.sinMigracion = false;

  S.caido = true;
  const e503 = await c.tomar().catch((e) => e);
  assert.equal(e503.transitorio, true);
  assert.match(e503.message, /respondió 503 en impresora_tomar/);
  S.caido = false;

  S.fallar('impresora_latido', 1, 429);
  assert.equal((await c.latido('1').catch((e) => e)).transitorio, true);

  S.retardoMs = 300;
  const lento = await clienteDe(S, { tiempoMs: 50 }).tomar().catch((e) => e);
  assert.match(lento.message, /no respondió/);
  assert.equal(lento.transitorio, true);
  S.retardoMs = 0;

  const sinRed = await new ClienteCola({ supabaseUrl: 'http://127.0.0.1:1', publishableKey: S.clave, token: S.token }).tomar().catch((e) => e);
  assert.match(sinRed.message, /Sin conexión con Supabase/);
  for (const e of [e401, falta, e503, lento, sinRed]) assert.ok(!e.message.includes(S.token), 'el token no sale en ningún error');
});

test('tomar descarta lo que no es una fila con id y rechaza una respuesta que no es lista', async (t) => {
  const S = await servidor(t);
  const falso = (cuerpo) => clienteDe(S, { fetchImpl: async () => new Response(JSON.stringify(cuerpo), { status: 200 }) });
  assert.deepEqual(await falso([null, 3, 'x', { sinId: 1 }, { id: 'a1', contenido: {} }]).tomar(), [{ id: 'a1', contenido: {} }]);
  assert.deepEqual(await falso(null).tomar(), []);
  await assert.rejects(falso({ no: 'lista' }).tomar(), /no devolvió una lista/);
});

// ───────────────────────── 2. Realtime ─────────────────────────

test('el tópico es impresora:<sha256 hex del token>: el mismo vector que la cuenta en vivo (48 ceros)', () => {
  assert.equal(topicoDeToken('0'.repeat(48)), 'impresora:f9a2ba511957122bfa67b029061c679703494540b35f02e0e0496a3b0cdcc46a');
});

test('urlRealtime: wss para https, ws para http local, apikey y vsn=1.0.0', () => {
  assert.equal(urlRealtime('https://abc.supabase.co', 'sb_publishable_x'), 'wss://abc.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0');
  assert.equal(urlRealtime('http://127.0.0.1:54321', 'k'), 'ws://127.0.0.1:54321/realtime/v1/websocket?apikey=k&vsn=1.0.0');
});

test('leerMensaje: objeto Phoenix v1, lista de la v2, y basura se descarta', () => {
  assert.deepEqual(leerMensaje('{"topic":"t","event":"broadcast","payload":{"a":1},"ref":null}'), { topic: 't', event: 'broadcast', payload: { a: 1 }, ref: null });
  assert.deepEqual(leerMensaje('["1","2","realtime:t","phx_reply",{"status":"ok"}]'), { topic: 'realtime:t', event: 'phx_reply', payload: { status: 'ok' }, ref: '2' });
  for (const malo of ['no json', '[]', '[1,2]', '{"sin":"evento"}', '42', null, Buffer.from('x')]) assert.equal(leerMensaje(malo), null);
});

function canalDe(S, extra = {}) {
  const estados = [];
  const senales = { n: 0 };
  const canal = new CanalRealtime({
    url: urlRealtime(S.url, S.clave), clave: S.clave, topico: topicoDeToken(S.token),
    onSenal: () => { senales.n++; }, onEstado: (e, d) => estados.push(d ? `${e}: ${d}` : e),
    esperas: [20, 20, 40], azar: () => 0.5, ...extra,
  });
  return { canal, estados, senales };
}

test('se une al tópico con la clave publicable y oye el broadcast del trigger (cualquier nombre de evento)', async (t) => {
  const S = await servidor(t);
  const { canal, estados, senales } = canalDe(S);
  t.after(() => canal.detener());
  canal.iniciar();
  await esperarHasta(() => S.unidos() === 1, 3000, 'unirse al canal');
  assert.deepEqual(estados, ['conectando', 'unido']);

  assert.equal(S.urlsWs[0], `/realtime/v1/websocket?apikey=${S.clave}&vsn=1.0.0`);
  const union = S.uniones[0];
  assert.equal(union.topic, `realtime:${topicoDeToken(S.token)}`);
  assert.equal(union.event, 'phx_join');
  assert.deepEqual(union.payload.config, { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, postgres_changes: [], private: false });
  assert.equal(union.payload.access_token, S.clave);
  assert.equal(union.ref, union.join_ref);

  S.señal();
  await esperarHasta(() => senales.n === 1, 2000, 'recibir la señal');
  S.señal();
  S.señal();
  await esperarHasta(() => senales.n === 3, 2000, 'recibir las tres señales');
});

test('ignora lo que no es un broadcast de SU tópico, y un oyente que lanza no tumba el canal', async (t) => {
  const S = await servidor(t);
  let veces = 0;
  const { canal } = canalDe(S, { onSenal: () => { veces++; throw new Error('el oyente se cae'); } });
  t.after(() => canal.detener());
  canal.iniciar();
  await esperarHasta(() => S.unidos() === 1);
  S.emitir({ topic: 'realtime:impresora:otro', event: 'broadcast', payload: {} });
  S.emitir({ topic: `realtime:${S.topico}`, event: 'system', payload: { status: 'ok' } });
  await dormir(60);
  assert.equal(veces, 0, 'un broadcast de otro tópico no cuenta');
  S.señal();
  S.señal();
  await esperarHasta(() => veces === 2, 2000, 'las dos señales, aunque el oyente lance');
  assert.equal(canal.estado, 'unido');
});

test('si el servidor corta la conexión, se reconecta solo y la señal vuelve a funcionar', async (t) => {
  const S = await servidor(t);
  const { canal, estados, senales } = canalDe(S);
  t.after(() => canal.detener());
  canal.iniciar();
  await esperarHasta(() => S.unidos() === 1);
  S.cortarWs();
  await esperarHasta(() => estados.some((e) => e.startsWith('caido')), 2000, 'enterarse de la caída');
  await esperarHasta(() => S.unidos() === 1 && canal.estado === 'unido', 3000, 'reconectar');
  assert.equal(S.uniones.length, 2, 'se unió dos veces');
  S.señal();
  await esperarHasta(() => senales.n === 1);
});

test('latido: con el servidor mudo (wifi caído a medias) lo da por muerto y reabre; con respuesta se queda', async (t) => {
  const S = await servidor(t);
  const { canal, estados } = canalDe(S, { heartbeatMs: 40 });
  t.after(() => canal.detener());
  canal.iniciar();
  await esperarHasta(() => S.unidos() === 1);
  await dormir(250);                                         // varios latidos contestados
  assert.equal(canal.estado, 'unido', 'con latidos contestados no se cae');
  assert.equal(S.uniones.length, 1);
  S.mudoAlLatido = true;
  await esperarHasta(() => estados.some((e) => /no contestó al latido/.test(e)), 2000, 'detectar la conexión muerta');
  await esperarHasta(() => S.uniones.length >= 2, 2000, 'reabrir el canal');
});

test('unirse rechazado (Unauthorized), apikey mala y servidor inexistente: cae con motivo y reintenta con espera creciente, sin lanzar', async (t) => {
  const S = await servidor(t);
  S.rechazarUnion = true;
  const a = canalDe(S);
  t.after(() => a.canal.detener());
  a.canal.iniciar();
  await esperarHasta(() => a.estados.some((e) => /rechazó el canal \(Unauthorized\)/.test(e)), 2000, 'rechazo al unirse');
  await esperarHasta(() => S.uniones.length >= 3, 3000, 'reintentos');

  const b = canalDe(S, { url: urlRealtime(S.url, 'clave_mala_0123456789') });
  t.after(() => b.canal.detener());
  b.canal.iniciar();
  await esperarHasta(() => b.estados.some((e) => e.startsWith('caido')), 2000, 'caer con apikey mala');
  assert.equal(S.unidos(), 0);

  const c = canalDe(S, { url: 'ws://127.0.0.1:1/realtime/v1/websocket?apikey=x&vsn=1.0.0' });
  t.after(() => c.canal.detener());
  c.canal.iniciar();
  await esperarHasta(() => c.estados.some((e) => e.startsWith('caido')), 2000, 'caer sin servidor');
});

test('la espera crece (1ª, 2ª, 3ª…) y no pasa del tope; con azar 0 y 1 queda entre el 80 % y el 120 %', () => {
  const esperasDe = (azar) => {
    const canal = new CanalRealtime({ url: 'ws://127.0.0.1:1/x', clave: 'k', topico: 't', onSenal() {}, esperas: [100, 200, 400], azar });
    const esperas = [];
    canal.poner = (ms) => { esperas.push(ms); return null; };
    canal.detenido = false;
    for (let i = 0; i < 5; i++) canal.caer('prueba');
    return esperas;
  };
  assert.deepEqual(esperasDe(() => 0), [80, 160, 320, 320, 320]);
  assert.deepEqual(esperasDe(() => 1), [120, 240, 480, 480, 480]);
  assert.deepEqual(esperasDe(() => 0.5), [100, 200, 400, 400, 400]);
});

test('detener(): cierra y no vuelve a conectarse', async (t) => {
  const S = await servidor(t);
  const { canal, estados } = canalDe(S);
  canal.iniciar();
  await esperarHasta(() => S.unidos() === 1);
  canal.detener();
  assert.equal(canal.estado, 'detenido');
  await dormir(150);
  assert.equal(S.unidos(), 0);
  assert.equal(S.uniones.length, 1, 'no hubo reconexión');
  assert.equal(estados.at(-1), 'detenido');
  canal.iniciar();                                           // y se puede volver a arrancar
  await esperarHasta(() => S.unidos() === 1);
  canal.detener();
});

// ───────────────────────── 3. el bucle: tomar → imprimir → confirmar ─────────────────────────

function agenteDe(S, { imprimir, construir, impresas, ...extra } = {}) {
  const r = registroDePrueba();
  const impresiones = [];
  const agente = new AgenteCola({
    cliente: clienteDe(S), log: r.log, version: '9.9.9',
    impresas: impresas ?? new Impresas(),
    construir: construir ?? ((doc) => construirTicket(doc, { cortar: false, avance: 0 })),
    imprimir: imprimir ?? (async (bytes, trabajo) => { impresiones.push({ bytes, id: trabajo.id }); return { simulado: false }; }),
    sondeoMs: 20, latidoMs: 50, max: 5, ...extra,      // max: 5 aquí para ejercitar las tandas; el valor REAL por omisión (1) lo prueba su propio test
  });
  return { agente, impresiones, ...r };
}

test('ciclo: toma el trabajo, arma los bytes del documento, lo imprime y lo confirma como impreso', async (t) => {
  const S = await servidor(t);
  const j = S.encolar(DOC, { tipo: 'ticket', mesa_id: 7 });
  const { agente, impresiones, texto } = agenteDe(S);
  await agente.ciclo();
  assert.equal(impresiones.length, 1);
  assert.deepEqual(impresiones[0].bytes, construirTicket(DOC, { cortar: false, avance: 0 }));
  assert.equal(S.estadoDe(j.id), 'impresa');
  assert.match(texto(), /Imprimiendo #[0-9a-f]{8} \(ticket, mesa 7\)/);
  assert.match(texto(), /Impreso #[0-9a-f]{8} \(ticket, mesa 7\): \d+ bytes/);
  assert.deepEqual(agente.contadores, { impresos: 1, errores: 0 });
});

test('un documento inválido se confirma como error con el motivo y el agente sigue con el resto', async (t) => {
  const S = await servidor(t);
  const malo = S.encolar({ lineas: 'no es una lista' });
  const bueno = S.encolar(DOC);
  const raro = S.encolar(null);
  const { agente, impresiones } = agenteDe(S);
  await agente.ciclo();
  assert.equal(impresiones.length, 1);
  assert.equal(impresiones[0].id, bueno.id);
  assert.equal(S.estadoDe(bueno.id), 'impresa');
  assert.equal(S.estadoDe(malo.id), 'pendiente', 'la base lo reintenta (intento 1 de 3)');
  assert.match(S.trabajos.find((x) => x.id === malo.id).error, /"lineas" del documento debe ser una lista/);
  assert.match(S.trabajos.find((x) => x.id === raro.id).error, /no es un documento/);
  assert.equal(agente.contadores.errores, 2);
});

test('si la impresora falla se confirma el error y se sigue; tras 3 intentos la base lo da por perdido', async (t) => {
  const S = await servidor(t);
  const j = S.encolar(DOC);
  const sano = S.encolar(DOC);
  let fallos = 0;
  const { agente, impresiones, texto } = agenteDe(S, {
    imprimir: async (bytes, trabajo) => {
      if (trabajo.id === j.id) { fallos++; throw new Error('Windows no conoce una impresora con ese nombre'); }
      impresiones.push(trabajo.id);
      return {};
    },
  });
  await agente.ciclo();
  assert.equal(S.estadoDe(sano.id), 'impresa', 'un trabajo no frena al de al lado');
  assert.equal(S.estadoDe(j.id), 'pendiente');
  await agente.ciclo();
  await agente.ciclo();
  assert.equal(fallos, 3);
  assert.equal(S.estadoDe(j.id), 'error', 'a la tercera, error definitivo');
  assert.match(S.trabajos.find((x) => x.id === j.id).error, /no conoce una impresora/);
  await agente.ciclo();
  assert.equal(fallos, 3, 'y ya no se vuelve a intentar');
  assert.match(texto(), /no se imprimió: Windows no conoce una impresora/);
});

test('un bug en el formateador (no un documento malo) también se confirma y no tumba al agente', async (t) => {
  const S = await servidor(t);
  const j = S.encolar(DOC);
  const otro = S.encolar(DOC);
  let n = 0;
  const { agente } = agenteDe(S, { construir: (doc) => { if (n++ === 0) throw new TypeError('x is not a function'); return construirTicket(doc); } });
  await agente.ciclo();
  assert.match(S.trabajos.find((x) => x.id === j.id).error, /No pude armar el ticket: x is not a function/);
  assert.equal(S.estadoDe(otro.id), 'impresa');
});

test('un ticket que llevaba horas en la cola (el agente estaba apagado) caduca: no sale al encender; con 0 minutos se imprime siempre', async (t) => {
  const S = await servidor(t);
  const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const viejo = S.encolar(DOC, { creada_en: hace(180) });
  const reciente = S.encolar(DOC, { creada_en: hace(10) });
  const a = agenteDe(S, { caducaMinutos: 120 });
  await a.agente.ciclo();
  assert.equal(S.estadoDe(reciente.id), 'impresa');
  assert.deepEqual(a.impresiones.map((i) => i.id), [reciente.id], 'solo el reciente salió');
  assert.equal(S.estadoDe(viejo.id), 'pendiente', 'la base lo reintenta (y caduca otra vez) hasta dar el error definitivo');
  assert.match(S.trabajos.find((x) => x.id === viejo.id).error, /^Caducó: llevaba 180 min esperando \(el máximo es 120\).*Vuelve a pedirlo desde el POS/);
  assert.match(a.texto(), /AVISO.*no se imprimió: Caducó/);

  const b = agenteDe(S, { caducaMinutos: 0 });
  await b.agente.ciclo();
  assert.deepEqual(b.impresiones.map((i) => i.id), [viejo.id], 'caducaMinutos 0 = imprimir siempre');
});

test('la edad se mide con los dos relojes de la BASE (tomada_en − creada_en), no con el del PC; sin fechas, no caduca', async (t) => {
  const { minutosEnCola } = await import('../../impresora/cola.mjs');
  assert.equal(minutosEnCola({ creada_en: '2026-10-01T10:00:00Z', tomada_en: '2026-10-01T12:30:00Z' }), 150);
  assert.equal(minutosEnCola({ creada_en: '2026-10-01T12:00:00Z', tomada_en: '2026-10-01T11:00:00Z' }), 0, 'nunca negativa');
  for (const sin of [{}, { creada_en: 'x', tomada_en: 'y' }, { creada_en: '2026-10-01T10:00:00Z' }, null, undefined]) assert.equal(minutosEnCola(sin), null);
  const S = await servidor(t);
  const j = S.encolar(DOC);
  delete j.creada_en;
  const a = agenteDe(S, { caducaMinutos: 1 });
  await a.agente.ciclo();
  assert.equal(S.estadoDe(j.id), 'impresa', 'sin creada_en no hay edad que medir y se imprime');
});

test('el contenido que llega como texto JSON también se entiende', async (t) => {
  const S = await servidor(t);
  const j = S.encolar(JSON.stringify(DOC));
  const { agente, impresiones } = agenteDe(S);
  await agente.ciclo();
  assert.equal(S.estadoDe(j.id), 'impresa');
  assert.deepEqual(impresiones[0].bytes, construirTicket(DOC, { cortar: false, avance: 0 }));
});

test('la red cae justo antes de confirmar: no se imprime dos veces, y la confirmación pendiente se reintenta', async (t) => {
  const S = await servidor(t);
  const j = S.encolar(DOC);
  const { agente, impresiones, texto } = agenteDe(S);
  S.fallar('impresora_confirmar', 2);
  await agente.ciclo();
  assert.equal(impresiones.length, 1, 'se imprimió');
  assert.equal(S.estadoDe(j.id), 'imprimiendo', 'la base aún no sabe que salió');
  assert.equal(agente.pendientes.size, 1);
  assert.match(texto(), /No pude confirmar #[0-9a-f]{8} a la base/);
  await agente.ciclo();                                      // 2º fallo
  await agente.ciclo();                                      // ya responde: se confirma lo pendiente
  assert.equal(S.estadoDe(j.id), 'impresa');
  assert.equal(agente.pendientes.size, 0);
  assert.equal(impresiones.length, 1, 'nunca se imprimió de nuevo');
  assert.match(texto(), /Confirmé #[0-9a-f]{8} que había quedado pendiente/);
});

test('la base vuelve a entregar un trabajo ya impreso (a los 2 min): solo se confirma, no sale otro papel — también tras reiniciar', async (t) => {
  const S = await servidor(t, { trabadoMs: 0 });
  const j = S.encolar(DOC);
  const archivo = path.join(tmp(), 'impresas.json');
  const a = agenteDe(S, { impresas: new Impresas({ archivo }) });
  S.fallar('impresora_confirmar', 1);
  await a.agente.ciclo();
  assert.equal(a.impresiones.length, 1);
  assert.equal(S.estadoDe(j.id), 'imprimiendo');
  // «Reinicio»: otro agente, otra memoria en proceso, la misma impresas.json. La base lo entrega otra vez.
  const b = agenteDe(S, { impresas: new Impresas({ archivo }) });
  await b.agente.ciclo();
  assert.equal(b.impresiones.length, 0, 'NO se vuelve a imprimir');
  assert.equal(S.estadoDe(j.id), 'impresa');
  assert.match(b.texto(), /ya se había impreso aquí.*no saco otro papel/);
});

test('impresas.json: guarda los últimos 300, sobrevive a un archivo dañado y escribe sin dejar temporales', () => {
  const archivo = path.join(tmp(), 'impresas.json');
  const a = new Impresas({ archivo, max: 3 });
  for (const id of ['a', 'b', 'c', 'd']) a.marcar(id);
  assert.equal(a.tiene('a'), false, 'el más viejo sale');
  assert.deepEqual(['b', 'c', 'd'].map((i) => a.tiene(i)), [true, true, true]);
  assert.equal(new Impresas({ archivo }).tiene('d'), true, 'persistido');
  assert.equal(fs.existsSync(`${archivo}.tmp`), false);
  fs.writeFileSync(archivo, '{{ dañado');
  assert.equal(new Impresas({ archivo }).tiene('d'), false, 'dañado: empieza de cero sin lanzar');
  assert.doesNotThrow(() => new Impresas({ archivo: path.join(archivo, 'no-es-carpeta', 'x.json') }).marcar('z'));
});

test('sin conexión: no se cae, avisa UNA vez (no cada 5 s), y cuando vuelve lo dice y retoma', async (t) => {
  const S = await servidor(t);
  const j = S.encolar(DOC);
  const { agente, impresiones, lineas, texto } = agenteDe(S);
  S.caido = true;
  for (let i = 0; i < 6; i++) await agente.ciclo();
  assert.equal(lineas.filter((l) => /No pude tomar trabajos/.test(l)).length, 1, 'un solo aviso, no seis');
  assert.match(texto(), /respondió 503.*Sigo intentando/);
  assert.equal(agente.fallosSeguidos, 6);
  S.caido = false;
  await agente.ciclo();
  assert.equal(impresiones.length, 1);
  assert.equal(S.estadoDe(j.id), 'impresa');
  assert.match(texto(), /Volvió la conexión con Supabase/);
  assert.equal(agente.fallosSeguidos, 0);
});

test('el sondeo se espacia cuando hay fallos seguidos (hasta 30 s) y vuelve al ritmo normal al recuperarse', () => {
  const a = new AgenteCola({ cliente: {}, construir() {}, imprimir() {}, log: registroDePrueba().log, impresas: new Impresas(), version: '1', sondeoMs: 5000 });
  let espera;
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { espera = ms; return { unref() {} }; };
  try {
    a.detenido = false;
    for (const [fallos, esperado] of [[0, 5000], [2, 5000], [3, 10_000], [4, 20_000], [5, 30_000], [6, 30_000], [20, 30_000]]) {
      a.fallosSeguidos = fallos;
      a.programarSondeo();
      assert.equal(espera, esperado, `${fallos} fallos seguidos`);
    }
  } finally { globalThis.setTimeout = original; }
});

test('función ausente (migración sin aplicar) y clave rechazada: error claro en el registro, sin tumbar nada', async (t) => {
  const S = await servidor(t);
  S.sinMigracion = true;
  const a = agenteDe(S);
  await a.agente.ciclo();
  assert.match(a.texto(), /ERROR.*La base no tiene la función impresora_tomar.*migración/);
  S.sinMigracion = false;
  const b = agenteDe(S);
  b.agente.cliente = new ClienteCola({ supabaseUrl: S.url, publishableKey: 'clave_vieja_0123456789abc', token: S.token });
  await b.agente.ciclo();
  assert.match(b.texto(), /ERROR.*rechazó la clave publicable/);
});

test('latido: manda la versión; si la base dice ok:false avisa del token una sola vez, y cuando vuelve a valer lo dice', async (t) => {
  const S = await servidor(t);
  const r = agenteDe(S);
  await r.agente.latir();
  assert.deepEqual(S.latidos, ['9.9.9']);
  assert.equal(r.agente.tokenMalo, false);

  const original = S.token;
  S.token = 'otro_token_distinto_0123456789';
  await r.agente.latir();
  await r.agente.latir();
  assert.equal(r.agente.tokenMalo, true);
  assert.equal(r.lineas.filter((l) => /no reconoce este token/.test(l)).length, 1);
  assert.match(r.texto(), /genera uno nuevo y pégalo en config\.json/);
  S.token = original;
  await r.agente.latir();
  assert.equal(r.agente.tokenMalo, false);
  assert.match(r.texto(), /volvió a reconocer el token/);
});

test('despertar() junta las señales: una ráfaga hace a lo más una vuelta extra, y nunca dos ciclos a la vez', async (t) => {
  const S = await servidor(t);
  S.encolar(DOC);
  let activos = 0;
  let maximo = 0;
  let ciclos = 0;
  const { agente } = agenteDe(S, { imprimir: async () => { await dormir(40); return {}; } });
  const original = agente.ciclo.bind(agente);
  agente.ciclo = async () => { ciclos++; activos++; maximo = Math.max(maximo, activos); try { await original(); } finally { activos--; } };
  await Promise.all(Array.from({ length: 20 }, () => agente.despertar()));
  assert.ok(ciclos <= 2, `ciclos: ${ciclos}`);
  assert.equal(maximo, 1, 'nunca dos ciclos a la vez');
  assert.equal(agente.corriendo, null);
});

test('si la tanda viene llena, sigue sin esperar al próximo sondeo hasta vaciar la cola', async (t) => {
  const S = await servidor(t);
  for (let i = 0; i < 12; i++) S.encolar({ lineas: [`ticket ${i}`] });
  const { agente, impresiones } = agenteDe(S, { max: 5 });
  await agente.despertar();
  assert.equal(impresiones.length, 12, 'tres tandas (5 + 5 + 2) en un solo despertar');
  assert.ok(S.trabajos.every((j) => j.estado === 'impresa'));
  assert.deepEqual(impresiones.map((i) => i.id), S.trabajos.map((j) => j.id), 'en el orden de llegada');
});

// Refutación, hallazgo 5: con tandas de 5 y 30 s de tope por trabajo, el quinto esperaba su turno hasta 120 s con la base ya dispuesta a
// reentregárselo (a los 120 s) a otra ventana del agente: salía dos veces. De a UNO, lo que se toma se imprime enseguida.
test('por omisión toma UN trabajo por vez: lo demás sigue «pendiente» (no «imprimiendo» esperando turno) hasta que le toca', async (t) => {
  const S = await servidor(t);
  const js = [S.encolar({ lineas: ['uno'] }), S.encolar({ lineas: ['dos'] }), S.encolar({ lineas: ['tres'] })];
  const vistos = [];
  const agente = new AgenteCola({
    cliente: clienteDe(S), log: registroDePrueba().log, version: '1', impresas: new Impresas(),
    construir: (doc) => construirTicket(doc, { cortar: false, avance: 0 }),
    // mientras «imprime» el trabajo N, mira cómo están los demás en la base
    imprimir: async (bytes, trabajo) => { vistos.push({ id: trabajo.id, estados: js.map((j) => S.estadoDe(j.id)) }); return {}; },
    sondeoMs: 20, latidoMs: 50,
  });
  assert.equal(agente.max, 1, 'el valor por omisión del agente real (agente.mjs no lo cambia)');
  await agente.ciclo();
  assert.deepEqual(js.map((j) => S.estadoDe(j.id)), ['impresa', 'pendiente', 'pendiente'], 'una tanda = un trabajo; los otros dos NO quedan tomados');
  await agente.despertar();
  assert.ok(S.trabajos.every((j) => j.estado === 'impresa'), 'despertar() sigue de a uno hasta vaciar la cola');
  assert.deepEqual(vistos.map((v) => v.estados.filter((e) => e === 'imprimiendo').length), [1, 1, 1], 'nunca hay más de uno «imprimiendo» a la vez: nada que la base pueda reentregar a los 2 minutos');
  assert.deepEqual(S.trabajos.map((j) => j.intentos), [1, 1, 1], 'ninguno tomado dos veces');
});

test('el token y la clave nunca llegan al registro, ni siquiera en un error del cliente', async (t) => {
  const S = await servidor(t);
  S.encolar(DOC);
  const lineas = [];
  const log = new Registro({ salida: (l) => lineas.push(l), secretos: [S.token, S.clave] });
  const agente = new AgenteCola({
    cliente: clienteDe(S), log, version: '1', impresas: new Impresas(), construir: () => { throw new Error(`falló con ${S.token} y ${S.clave}`); }, imprimir: async () => ({}),
  });
  await agente.ciclo();
  assert.ok(lineas.length > 0);
  for (const l of lineas) { assert.ok(!l.includes(S.token) && !l.includes(S.clave), l); }
  assert.match(lineas.join('\n'), /falló con \*\*\* y \*\*\*/);
  const enBase = S.llamadas.filter((l) => l.rpc === 'impresora_confirmar').map((l) => JSON.stringify(l.cuerpo.p_error)).join();
  assert.match(enBase, /falló con \*\*\* y \*\*\*/, 'lo que va a la base tampoco lleva el token ni la clave');
});

test('detener() espera a que termine lo que ya tomó (aunque sean varios tickets) y no toma más', async (t) => {
  const S = await servidor(t);
  const j = S.encolar(DOC);
  const k = S.encolar(DOC);
  let imprimiendo = false;
  const { agente } = agenteDe(S, { imprimir: async () => { imprimiendo = true; await dormir(80); imprimiendo = false; return {}; } });
  agente.iniciar();
  await esperarHasta(() => imprimiendo, 2000, 'empezar a imprimir');
  await agente.detener();
  assert.equal(imprimiendo, false, 'esperó a que acabara');
  assert.equal(S.estadoDe(j.id), 'impresa');
  assert.equal(S.estadoDe(k.id), 'impresa', 'lo ya tomado se termina: no queda «imprimiendo» a medias hasta la reentrega de 2 minutos');
  const antes = S.llamadas.filter((l) => l.rpc === 'impresora_tomar').length;
  await dormir(100);
  assert.equal(S.llamadas.filter((l) => l.rpc === 'impresora_tomar').length, antes, 'detenido: no vuelve a preguntar');
});

// ───────────────────────── 4. todo junto: señal, respaldo por sondeo, registro rotado ─────────────────────────

test('de punta a punta: con la señal el ticket sale al instante aunque el sondeo sea de un minuto', async (t) => {
  const S = await servidor(t);
  const { agente, impresiones } = agenteDe(S, { sondeoMs: 60_000, latidoMs: 60_000 });
  const { canal } = canalDe(S, { onSenal: () => agente.despertar() });
  t.after(async () => { canal.detener(); await agente.detener(); });
  agente.iniciar();
  canal.iniciar();
  await esperarHasta(() => S.unidos() === 1, 3000, 'unirse al canal');
  await dormir(50);
  const j = S.encolar(DOC);
  S.señal();                                                 // el trigger de la base
  await esperarHasta(() => S.estadoDe(j.id) === 'impresa', 2000, 'imprimir por la señal, sin esperar al sondeo');
  assert.equal(impresiones.length, 1);
});

test('si el WebSocket no existe o cae del todo, el sondeo de respaldo imprime igual (se pierde velocidad, no trabajos)', async (t) => {
  const S = await servidor(t);
  const { agente, impresiones } = agenteDe(S, { sondeoMs: 30, latidoMs: 60_000 });
  const { canal } = canalDe(S, { onSenal: () => agente.despertar() });
  t.after(async () => { canal.detener(); await agente.detener(); });
  agente.iniciar();
  canal.iniciar();
  await esperarHasta(() => S.unidos() === 1);
  S.rechazarUnion = true;
  S.cortarWs();
  await esperarHasta(() => canal.estado === 'caido', 2000);
  const j = S.encolar(DOC);                                  // y la señal NO sale (trigger roto, WebSocket caído)
  await esperarHasta(() => S.estadoDe(j.id) === 'impresa', 2000, 'imprimir por sondeo');
  assert.equal(impresiones.length, 1);
});

test('el registro rota en impresiones.log, .1, .2 y .3 sin pasar del tope y nunca lanza', () => {
  const d = tmp();
  const archivo = path.join(d, 'impresiones.log');
  const log = new Registro({ archivo, maxBytes: 400, copias: 3, consola: false });
  for (let i = 0; i < 80; i++) log.info(`línea número ${i} con algo de texto para ocupar sitio`);
  const nombres = fs.readdirSync(d).sort();
  assert.deepEqual(nombres, ['impresiones.log', 'impresiones.log.1', 'impresiones.log.2', 'impresiones.log.3']);
  for (const n of nombres) assert.ok(fs.statSync(path.join(d, n)).size <= 500, n);
  assert.match(fs.readFileSync(archivo, 'utf8'), /línea número 79/, 'lo último está en el archivo vivo');
  assert.doesNotThrow(() => new Registro({ archivo: path.join(d, 'no', 'existe', 'x.log'), consola: false }).error('no hay carpeta'));
  assert.match(fs.readFileSync(archivo, 'utf8').split('\n')[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d INFO  línea/);
});

test('ErrorDocumento es lo que el agente cuenta como «documento malo» (y nada más)', () => {
  assert.ok(new ErrorDocumento('x') instanceof Error);
  assert.equal(new ErrorDocumento('x').name, 'ErrorDocumento');
  assert.ok(construirTicket(documentoDePrueba({}), {}).length > 0);
});
