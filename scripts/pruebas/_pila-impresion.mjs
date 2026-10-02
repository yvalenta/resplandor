// La pila LOCAL de punta a punta de la impresión en la caja: la base de verdad (Postgres 17 desechable con la cadena COMPLETA de
// migraciones del repo, ver _supabase-simulado.mjs) con un «PostgREST» y un «Realtime» de mentira delante, para que el POS REAL
// (pos.html con su supabase-js de verdad, en Chromium) y el AGENTE REAL (impresora/agente.mjs, como proceso aparte) se hablen a
// través de la misma base, igual que en producción, sin tocar Supabase.
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre. Lo usa
// impresion-punta-a-punta.test.mjs.
//
//   POS (Chromium, supabase-js real) ──https://lccgehvyymladqvumcez.supabase.co/…──► page.route ─┐
//                                                                                                 ├─► atender() ─► Postgres (docker exec psql)
//   Agente (node impresora/agente.mjs) ──http://127.0.0.1:<puerto>/rest/v1/rpc/…────────────────┘
//   Realtime: el POS entra por page.routeWebSocket (Phoenix v2); el agente, por el WebSocket del servidor local (Phoenix v1).
//             Las señales de realtime.send (la simulación las apunta en realtime.llamadas_prueba) y los cambios de `impresiones`
//             se reparten desde una consulta cada 250 ms (no hay replicación lógica aquí).
//
// Qué se parece a PostgREST (lo que importa para probar los contratos):
//   · cada petición es UNA transacción con `set local role` (anon | authenticated, según el JWT) y `request.jwt.claims`: la RLS, los
//     GRANT por columna, los triggers y las RPC corren con los permisos de verdad;
//   · GET/POST/PATCH/DELETE sobre tablas (select, filtros eq/neq/gt/gte/lt/lte/is/in/like/ilike/not, order, limit, offset, upsert,
//     Prefer return=representation|minimal, Accept: application/vnd.pgrst.object+json) y POST /rpc/<función> con argumentos por nombre;
//   · errores con la forma de PostgREST ({code, message, details, hint}) y su estado HTTP; PGRST202 si la función no existe, PGRST205 si no
//     existe la tabla (lo que el POS lee como «falta la migración»).
// Qué NO es: no valida el JWT contra Supabase Auth (lo firma esta pila con un secreto propio), no tiene caché de esquema, no hace
// embebidos (select=a(b)) ni `or=`; lo que pida y no sepa lo anota en `pila.noSoportadas` y contesta 501, para que una prueba lo vea.
//
// Seguridad de esta herramienta: corre solo contra el contenedor desechable de esta prueba (127.0.0.1, sin puertos publicados); los
// nombres de tabla y columna se validan con una lista de caracteres y los valores se escapan como literales.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { levantarPostgres, literal } from './_supabase-simulado.mjs';
import { prepararSimulacion, aplicarMigraciones, DIR_MIGRACIONES, MIGRACION } from './_cola-impresion-pg.mjs';
import { datosFicticios } from './_pos-simulado.mjs';
import { marco, leerMarcos } from './_impresora-simulada.mjs';

export { MIGRACION };
export const HOST_SUPABASE = 'lccgehvyymladqvumcez.supabase.co';
export const CLAVE_PUBLICABLE = 'sb_publishable_PILA_LOCAL_NO_ES_UNA_CLAVE_REAL_0123456789';
export const CORREO_ADMIN = 'admin@resplandor.test';
export const CORREO_MESERO = 'mesero1@resplandor.test';
/** Cualquier clave publicable (sb_publishable_…): la del POS es la de producción, que ya está en pos.html y es pública por diseño; la del agente, la de esta pila. */
const esClavePublicable = (k) => typeof k === 'string' && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k);
const GUID_WS = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

// ───────────────────────────────────── JWT ─────────────────────────────────────

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function firmar(secreto, claims) {
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  return `${cuerpo}.${crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
}
function verificar(secreto, jwt) {
  const partes = String(jwt || '').split('.');
  if (partes.length !== 3) return null;
  const esperada = crypto.createHmac('sha256', secreto).update(`${partes[0]}.${partes[1]}`).digest('base64url');
  if (esperada.length !== partes[2].length || !crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(partes[2]))) return null;
  try {
    const claims = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    return claims.exp && claims.exp * 1000 < Date.now() ? null : claims;
  } catch { return null; }
}

// ───────────────────────────────────── SQL ─────────────────────────────────────

const ident = (x) => {
  if (typeof x !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(x)) throw Object.assign(new Error(`identificador no válido: ${JSON.stringify(x)}`), { http: 400, code: 'PGRST100' });
  return `"${x}"`;
};
const valor = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') return literal(JSON.stringify(v));
  return literal(String(v));
};

/** Un psql dentro del contenedor, sin bloquear el proceso (la pila atiende a la vez al POS, a los agentes y al vigilante). */
function psql(contenedor, guion) {
  return new Promise((resolver) => {
    const p = spawn('docker', ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolver({ code, out, err }));
    p.on('error', (e) => resolver({ code: 1, out: '', err: String(e) }));
    p.stdin.on('error', () => {});
    p.stdin.end(guion);
  });
}

/** El estado HTTP que PostgREST le da a cada SQLSTATE (lo que supabase-js entrega en `error`). */
function errorDePostgres(stderr) {
  const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(stderr);
  const code = m?.[1] || 'XX000';
  const detalle = /DETAIL:\s+([^\n]*)/.exec(stderr)?.[1] ?? null;
  const pista = /HINT:\s+([^\n]*)/.exec(stderr)?.[1] ?? null;
  let estado = 400;
  if (code === '42501') estado = 403;
  else if (code === '23503' || code === '23505') estado = 409;
  else if (code === '42P01') estado = 404;
  else if (code === '42883') estado = 404;
  else if (code.startsWith('08') || code.startsWith('53') || code.startsWith('57')) estado = 503;
  const cuerpo = { code, details: detalle, hint: pista, message: m?.[2] ?? stderr.trim().split('\n')[0] ?? 'error' };
  if (code === '42P01') { cuerpo.code = 'PGRST205'; cuerpo.message = `Could not find the table in the schema cache (${cuerpo.message})`; }
  return { estado, cuerpo };
}

// ───────────────────────────────────── la pila ─────────────────────────────────────

/**
 * Levanta la base, la siembra y el servidor local. Opciones:
 *   conCola  false → aplica las migraciones HASTA la anterior a la cola de impresión (la base «de hoy»); `pila.aplicarCola()` pone la
 *            migración después (el POS que ya estaba abierto la nota al recargar). Por defecto true.
 * Devuelve la pila (ver abajo). `await pila.parar()` al terminar.
 */
export async function levantarPila({ conCola = true } = {}) {
  const pg = await levantarPostgres();
  const pila = {
    pg, claveSecretaJwt: crypto.randomBytes(32).toString('hex'),
    noSoportadas: [], peticiones: [], uniones: [],
    enVuelo: 0,   // peticiones que la base todavía está atendiendo (una prueba que mata un agente espera a que no quede ninguna suya)
  };
  let parado = false;
  pila.parar = async () => {
    parado = true;
    for (const s of hub.sockets) s.cerrar();
    servidor?.closeAllConnections?.();
    await new Promise((r) => servidor?.close(() => r()) ?? r());
    pg.parar();
  };

  // ── La base ──
  prepararSimulacion(pg);
  const aplicadas = aplicarMigraciones(pg, DIR_MIGRACIONES, conCola ? {} : { antesDe: MIGRACION });
  const fallo = aplicadas.find((x) => !x.ok);
  if (fallo) { pg.parar(); throw new Error(`la migración ${fallo.archivo} falló: ${fallo.error}`); }
  pila.aplicarCola = () => {
    const r = aplicarMigraciones(pg, DIR_MIGRACIONES, { desde: MIGRACION });
    if (!r.length || r.some((x) => !x.ok)) throw new Error(`no se pudo aplicar la cola de impresión: ${r.map((x) => x.error).join(' ')}`);
    return r;
  };
  sembrar(pg);

  // ── JWT de las personas de prueba ──
  const gente = Object.fromEntries(pg.filas('select clave, id, email, provider from t.gente').map((g) => [g.clave, g]));
  pila.persona = (clave) => {
    const g = gente[clave];
    if (!g) throw new Error(`persona desconocida: ${clave}`);
    const ahora = Math.floor(Date.now() / 1000);
    const usuario = {
      id: g.id, aud: 'authenticated', role: 'authenticated', email: g.email,
      app_metadata: { provider: g.provider, providers: [g.provider] },
      user_metadata: { full_name: clave === 'admin' ? 'Admin Prueba' : 'Mesero Prueba' },
      identities: [{ provider: g.provider, identity_data: { email: g.email } }],
    };
    const access_token = firmar(pila.claveSecretaJwt, {
      sub: g.id, role: 'authenticated', aud: 'authenticated', email: g.email, iat: ahora, exp: ahora + 365 * 86400,
      app_metadata: usuario.app_metadata, user_metadata: usuario.user_metadata,
    });
    return {
      correo: g.email, jwt: access_token,
      sesion: { access_token, refresh_token: 'refresco-de-la-pila-local', token_type: 'bearer', expires_in: 365 * 86400, expires_at: ahora + 365 * 86400, user: usuario },
    };
  };

  // ── La petición, como la atendería PostgREST ──
  /** Quién llama según los encabezados: { rol, claims } o { error } (401). */
  function quien(cab) {
    if (!esClavePublicable(cab.apikey)) return { error: { estado: 401, cuerpo: { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' } } };
    const bearer = /^Bearer\s+(.+)$/i.exec(cab.authorization || '')?.[1];
    const claims = bearer && !esClavePublicable(bearer) ? verificar(pila.claveSecretaJwt, bearer) : null;
    if (bearer && !esClavePublicable(bearer) && !claims) return { error: { estado: 401, cuerpo: { code: 'PGRST301', message: 'JWT expired or invalid', details: null, hint: null } } };
    return claims ? { rol: 'authenticated', claims } : { rol: 'anon', claims: { role: 'anon' } };
  }

  /** Corre `sentencia` (que debe terminar en `select '@@' || …`) como `rol`, en una transacción, con los claims puestos. */
  async function enTransaccion(rol, claims, sentencia) {
    const guion = `\\set VERBOSITY verbose\nbegin;\nset local role ${rol};\nselect set_config('request.jwt.claims', ${literal(JSON.stringify(claims))}, true) as _c \\gset\n${sentencia};\ncommit;\n`;
    const r = await psql(pg.nombre, guion);
    if (r.code !== 0) return { ok: false, ...errorDePostgres(r.err) };
    const i = r.out.lastIndexOf('@@');
    return { ok: true, texto: i === -1 ? '' : r.out.slice(i + 2).trim() };
  }
  async function comoDueno(sentencia) {
    const r = await psql(pg.nombre, `\\set VERBOSITY verbose\n${sentencia};\n`);
    return r.code === 0 ? { ok: true, texto: r.out.trim() } : { ok: false, ...errorDePostgres(r.err) };
  }
  pila.consultarComoDueno = comoDueno;

  const json = (estado, cuerpo, extra = {}) => ({ estado, cabeceras: { 'content-type': 'application/json; charset=utf-8', ...extra }, cuerpo: cuerpo === undefined ? '' : JSON.stringify(cuerpo) });
  const noSoportado = (que, req) => { pila.noSoportadas.push(`${req.metodo} ${req.url.pathname}${req.url.search} → ${que}`); return json(501, { code: 'PGRST_PILA', message: `la pila local no sabe hacer: ${que}`, details: null, hint: null }); };

  /** { metodo, url:URL, cabeceras (en minúsculas), cuerpo:string } → { estado, cabeceras, cuerpo:string } */
  async function atender(req) {
    pila.enVuelo++;
    try { return await atenderUna(req); } finally { pila.enVuelo--; }
  }
  async function atenderUna(req) {
    pila.peticiones.push({ metodo: req.metodo, ruta: req.url.pathname + req.url.search, en: Date.now() });
    const q = quien(req.cabeceras);
    if (q.error) return json(q.error.estado, q.error.cuerpo);
    const m = /^\/rest\/v1\/(.+)$/.exec(req.url.pathname);
    if (!m) return json(404, { message: 'ruta desconocida en la pila local' });
    try {
      return m[1].startsWith('rpc/') ? await rpc(req, q, m[1].slice(4)) : await tabla(req, q, m[1]);
    } catch (e) {
      if (e.http) return json(e.http, { code: e.code || 'PGRST100', message: e.message, details: null, hint: null });
      return json(500, { code: 'XX000', message: String(e.message || e), details: null, hint: null });
    }
  }
  pila.atender = atender;

  async function rpc(req, q, nombre) {
    if (req.metodo !== 'POST') return noSoportado(`RPC por ${req.metodo}`, req);
    const fn = ident(nombre);
    let args = {};
    try { args = req.cuerpo ? JSON.parse(req.cuerpo) : {}; } catch { return json(400, { code: 'PGRST102', message: 'Empty or invalid json', details: null, hint: null }); }
    const cands = await comoDueno(`select '@@' || coalesce(jsonb_agg(jsonb_build_object('retset', p.proretset, 'nombres', coalesce(to_jsonb(p.proargnames), '[]'::jsonb), 'tipos', (select coalesce(jsonb_agg(format_type(t, null)), '[]'::jsonb) from unnest(p.proargtypes) t))), '[]'::jsonb)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = ${literal(nombre)}`);
    if (!cands.ok) return json(cands.estado, cands.cuerpo);
    const lista = JSON.parse(cands.texto.replace(/^@@/, '') || '[]');
    const claves = Object.keys(args);
    const f = lista.find((c) => claves.every((k) => c.nombres.includes(k)));
    if (!f) return json(404, { code: 'PGRST202', message: `Could not find the function public.${nombre}(${claves.join(', ')}) in the schema cache`, details: null, hint: null });
    const llamada = `public.${fn}(${claves.map((k) => `${ident(k)} => ${valor(args[k])}::${f.tipos[f.nombres.indexOf(k)]}`).join(', ')})`;
    const sentencia = f.retset
      ? `select '@@' || coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from ${llamada} t`
      : `select '@@' || coalesce(to_jsonb(${llamada})::text, 'null')`;
    const r = await enTransaccion(q.rol, q.claims, sentencia);
    return r.ok ? { estado: 200, cabeceras: { 'content-type': 'application/json; charset=utf-8' }, cuerpo: r.texto } : json(r.estado, r.cuerpo);
  }

  /** `col=eq.valor` → fragmento SQL. */
  function filtro(col, expr) {
    let negar = false;
    let resto = expr;
    if (resto.startsWith('not.')) { negar = true; resto = resto.slice(4); }
    const punto = resto.indexOf('.');
    const op = resto.slice(0, punto);
    const v = resto.slice(punto + 1);
    const c = ident(col);
    const simple = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    let sql;
    if (simple[op]) sql = `${c} ${simple[op]} ${literal(v)}`;
    else if (op === 'like') sql = `${c} like ${literal(v.replaceAll('*', '%'))}`;
    else if (op === 'ilike') sql = `${c} ilike ${literal(v.replaceAll('*', '%'))}`;
    else if (op === 'is') {
      if (!['null', 'true', 'false'].includes(v)) throw Object.assign(new Error(`is.${v}`), { http: 400 });
      sql = `${c} is ${v}`;
    } else if (op === 'in') {
      const dentro = /^\((.*)\)$/s.exec(v)?.[1];
      if (dentro === undefined) throw Object.assign(new Error(`in.${v}`), { http: 400 });
      const elementos = [];
      for (const x of dentro.matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)) elementos.push(x[1] !== undefined ? x[1].replace(/\\(.)/g, '$1') : x[2]);
      sql = elementos.length ? `${c} in (${elementos.map(literal).join(', ')})` : 'false';
    } else throw Object.assign(new Error(`operador ${op}`), { http: 501, code: 'PGRST_PILA' });
    return negar ? `not (${sql})` : sql;
  }

  async function tabla(req, q, nombre) {
    const t = ident(nombre);
    const p = req.url.searchParams;
    const reservados = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
    const donde = [];
    for (const [k, v] of p.entries()) {
      if (reservados.has(k)) continue;
      if (k === 'or' || k === 'and') return noSoportado(`filtro ${k}=`, req);
      donde.push(filtro(k, v));
    }
    const sel = p.get('select') ?? '*';
    if (/[()]/.test(sel) || sel.includes(':')) return noSoportado(`select embebido «${sel}»`, req);
    const cols = sel === '*' ? '*' : sel.split(',').map((c) => ident(c.trim())).join(', ');
    const prefer = String(req.cabeceras.prefer || '');
    const devuelve = /return=representation/.test(prefer);
    const unico = /application\/vnd\.pgrst\.object\+json/.test(req.cabeceras.accept || '');
    const cuerpoJson = () => {
      try { return req.cuerpo ? JSON.parse(req.cuerpo) : null; } catch { throw Object.assign(new Error('Empty or invalid json'), { http: 400, code: 'PGRST102' }); }
    };
    const whereSql = donde.length ? ` where ${donde.join(' and ')}` : '';

    const responder = (r, estadoOk, hayFilas) => {
      if (!r.ok) return json(r.estado, r.cuerpo);
      if (!hayFilas) return { estado: estadoOk === 200 ? 204 : estadoOk, cabeceras: {}, cuerpo: '' };
      const filas = JSON.parse(r.texto.replace(/^@@/, '') || '[]');
      if (unico) {
        if (filas.length !== 1) return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${filas.length} rows`, hint: null });
        return json(estadoOk, filas[0]);
      }
      return json(estadoOk, filas, { 'content-range': filas.length ? `0-${filas.length - 1}/*` : '*/*' });
    };

    if (req.metodo === 'GET' || req.metodo === 'HEAD') {
      const orden = (p.get('order') || '').split(',').filter(Boolean).map((o) => {
        const [col, ...mods] = o.split('.');
        return `${ident(col)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''}`;
      });
      const lim = p.get('limit') ? ` limit ${Number.parseInt(p.get('limit'), 10)}` : '';
      const off = p.get('offset') ? ` offset ${Number.parseInt(p.get('offset'), 10)}` : '';
      const r = await enTransaccion(q.rol, q.claims,
        `select '@@' || coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)::text from (select ${cols} from public.${t}${whereSql}${orden.length ? ` order by ${orden.join(', ')}` : ''}${lim}${off}) r`);
      return responder(r, 200, true);
    }

    if (req.metodo === 'POST') {
      const cuerpo = cuerpoJson();
      const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      const columnas = [...new Set(filas.flatMap((f) => Object.keys(f || {})))];
      if (!columnas.length) return json(400, { code: 'PGRST102', message: 'Empty or invalid json', details: null, hint: null });
      const lista = columnas.map(ident).join(', ');
      let conflicto = '';
      if (/resolution=(merge|ignore)-duplicates/.test(prefer)) {
        // Sin `on_conflict`, PostgREST usa la CLAVE PRIMARIA de la tabla (supabase-js `upsert(fila)` a secas, como el cobro del POS).
        let objetivo = (p.get('on_conflict') || '').split(',').filter(Boolean).map(ident);
        if (!objetivo.length) {
          objetivo = pg.filas(`select a.attname::text as c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'public.${nombre}'::regclass and i.indisprimary order by a.attnum`).map((f) => ident(f.c));
        }
        if (!objetivo.length) return noSoportado('upsert sin on_conflict y sin clave primaria', req);
        const fuera = columnas.filter((c) => !objetivo.includes(`"${c}"`));
        conflicto = /ignore-duplicates/.test(prefer) || !fuera.length
          ? ` on conflict (${objetivo.join(', ')}) do nothing`
          : ` on conflict (${objetivo.join(', ')}) do update set ${fuera.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`;
      }
      const ins = `insert into public.${t} (${lista}) select ${lista} from jsonb_populate_recordset(null::public.${t}, ${literal(JSON.stringify(filas))}::jsonb)${conflicto}`;
      const sentencia = devuelve
        ? `with ins as (${ins} returning ${cols}) select '@@' || coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb)::text from ins`
        : `with ins as (${ins}) select '@@'`;
      return responder(await enTransaccion(q.rol, q.claims, sentencia), 201, devuelve);
    }

    if (req.metodo === 'PATCH') {
      const cuerpo = cuerpoJson();
      const columnas = Object.keys(cuerpo || {});
      if (!columnas.length) return json(400, { code: 'PGRST102', message: 'Empty or invalid json', details: null, hint: null });
      const set = columnas.map((c) => `${ident(c)} = r.${ident(c)}`).join(', ');
      const upd = `update public.${t} set ${set} from jsonb_populate_record(null::public.${t}, ${literal(JSON.stringify(cuerpo))}::jsonb) r${whereSql}`;
      const sentencia = devuelve
        ? `with u as (${upd} returning public.${t}.*) select '@@' || coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb)::text from u`
        : `with u as (${upd}) select '@@'`;
      return responder(await enTransaccion(q.rol, q.claims, sentencia), 200, devuelve);
    }

    if (req.metodo === 'DELETE') {
      const del = `delete from public.${t}${whereSql}`;
      const sentencia = devuelve
        ? `with d as (${del} returning *) select '@@' || coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)::text from d`
        : `with d as (${del}) select '@@'`;
      return responder(await enTransaccion(q.rol, q.claims, sentencia), 200, devuelve);
    }
    return noSoportado(`método ${req.metodo}`, req);
  }

  // ── Realtime de mentira: Phoenix v1 (agente) y v2 (POS, supabase-js) ──
  const hub = { sockets: new Set(), siguienteId: 1, difundidas: [] };
  /** Un cliente conectado: { enviar(objetoNormalizado), uniones: Map(topic → {joinRef, bindings}), cerrar() }. */
  hub.nuevo = (enviarCrudo, cerrar) => {
    const s = { uniones: new Map(), cerrar, vsn: 1, enviar: (m) => enviarCrudo(s.vsn === 2 ? JSON.stringify([m.join_ref ?? null, m.ref ?? null, m.topic, m.event, m.payload]) : JSON.stringify(m)) };
    hub.sockets.add(s);
    return s;
  };
  hub.quitar = (s) => { hub.sockets.delete(s); };
  hub.recibir = (s, crudo) => {
    let m;
    try {
      const x = JSON.parse(crudo);
      if (Array.isArray(x)) { s.vsn = 2; m = { join_ref: x[0], ref: x[1], topic: x[2], event: x[3], payload: x[4] }; } else m = x;
    } catch { return; }
    const responder = (payload, topic = m.topic) => s.enviar({ topic, event: 'phx_reply', ref: m.ref, join_ref: m.join_ref ?? null, payload });
    if (m.topic === 'phoenix' && m.event === 'heartbeat') { responder({ status: 'ok', response: {} }, 'phoenix'); return; }
    if (m.event === 'phx_join') {
      const bindings = (m.payload?.config?.postgres_changes || []).map((b) => ({ id: hub.siguienteId++, event: b.event, schema: b.schema, table: b.table, filter: b.filter }));
      s.uniones.set(m.topic, { joinRef: m.join_ref ?? m.ref, bindings });
      pila.uniones.push({ topic: m.topic, vsn: s.vsn, bindings: bindings.length });
      responder({ status: 'ok', response: bindings.length ? { postgres_changes: bindings } : {} });
      return;
    }
    if (m.event === 'phx_leave') { s.uniones.delete(m.topic); responder({ status: 'ok', response: {} }); return; }
    if (m.ref != null) responder({ status: 'ok', response: {} });   // presence, broadcast, access_token…: aceptado y sin efecto
  };
  /** realtime.send(payload, event, topic, private) → los que se unieron a `realtime:<topic>`. */
  hub.difundir = (topico, evento, payload) => {
    hub.difundidas.push({ topico, evento, en: Date.now() });
    for (const s of hub.sockets) {
      const u = s.uniones.get(`realtime:${topico}`);
      if (u) s.enviar({ topic: `realtime:${topico}`, event: 'broadcast', payload: { type: 'broadcast', event: evento, payload }, ref: null, join_ref: u.joinRef });
    }
  };
  hub.cambio = (tablaNombre, tipo, registro, anterior) => {
    for (const s of hub.sockets) {
      for (const [topic, u] of s.uniones) {
        const ids = u.bindings.filter((b) => b.schema === 'public' && b.table === tablaNombre && (b.event === '*' || b.event === tipo) && coincide(b.filter, registro)).map((b) => b.id);
        if (ids.length) {
          s.enviar({ topic, event: 'postgres_changes', ref: null, join_ref: u.joinRef,
            payload: { ids, data: { schema: 'public', table: tablaNombre, commit_timestamp: new Date().toISOString(), type: tipo, record: tipo === 'DELETE' ? {} : registro, old_record: anterior || {}, columns: [], errors: null } } });
        }
      }
    }
  };
  const coincide = (filtroTexto, fila) => {
    if (!filtroTexto) return true;
    const m = /^([a-z_]+)=eq\.(.*)$/.exec(filtroTexto);
    return !!m && String(fila[m[1]]) === m[2];
  };
  pila.hub = hub;
  /** Corta todos los WebSocket (un wifi que se cae): los clientes reconectan solos. */
  pila.cortarRealtime = () => { for (const s of [...hub.sockets]) s.cerrar(); };
  /** Mientras es true no se reparten las señales de realtime.send (la señal «se pierde»: el agente tiene que sondear). */
  pila.sinSenales = false;

  // El vigilante: reparte las señales y los cambios de `impresiones` desde la base.
  let ultimaSenal = 0;
  let previas = null;
  (async function vigilar() {
    while (!parado) {
      const r = await comoDueno(`select '@@' || jsonb_build_object(
        'senales', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'topico', topico, 'evento', evento, 'payload', coalesce(payload, '{}'::jsonb)) order by id), '[]'::jsonb) from realtime.llamadas_prueba where id > ${ultimaSenal}),
        'impresiones', case when to_regclass('public.impresiones') is null then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.impresiones i) end)::text`);
      if (r.ok && r.texto.includes('@@')) {
        const datos = JSON.parse(r.texto.slice(r.texto.lastIndexOf('@@') + 2));
        for (const s of datos.senales) { ultimaSenal = Math.max(ultimaSenal, s.id); if (!pila.sinSenales) hub.difundir(s.topico, s.evento, s.payload); }
        const ahora = new Map(datos.impresiones.map((f) => [f.id, f]));
        if (previas) {
          for (const [id, f] of ahora) {
            const antes = previas.get(id);
            if (!antes) hub.cambio('impresiones', 'INSERT', f, {});
            else if (JSON.stringify(antes) !== JSON.stringify(f)) hub.cambio('impresiones', 'UPDATE', f, { id });
          }
          for (const [id] of previas) if (!ahora.has(id)) hub.cambio('impresiones', 'DELETE', {}, { id });
        }
        previas = ahora;
      }
      await esperar(250);
    }
  })();

  // ── El servidor local: lo que ve el AGENTE (http://127.0.0.1:<puerto>) ──
  let servidor = http.createServer((req, res) => {
    const trozos = [];
    req.on('data', (d) => trozos.push(d));
    req.on('end', async () => {
      const cabeceras = {};
      for (const [k, v] of Object.entries(req.headers)) cabeceras[k.toLowerCase()] = String(v);
      const r = await atender({ metodo: req.method, url: new URL(req.url, 'http://127.0.0.1'), cabeceras, cuerpo: Buffer.concat(trozos).toString('utf8') });
      res.writeHead(r.estado, r.cabeceras);
      res.end(r.cuerpo);
    });
  });
  servidor.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/realtime/v1/websocket' || !esClavePublicable(url.searchParams.get('apikey'))) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const acepta = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID_WS).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acepta}\r\n\r\n`);
    const cliente = hub.nuevo((texto) => { if (!socket.destroyed) socket.write(marco(1, texto)); }, () => socket.destroy());
    cliente.vsn = url.searchParams.get('vsn') === '2.0.0' ? 2 : 1;
    let resto = Buffer.alloc(0);
    socket.on('data', (d) => {
      resto = Buffer.concat([resto, d]);
      let hasta = 0;
      for (const f of leerMarcos(resto)) {
        hasta = f.siguiente;
        if (f.opcode === 8) { socket.end(marco(8, Buffer.alloc(0))); continue; }
        if (f.opcode === 9) { socket.write(marco(10, f.carga)); continue; }
        if (f.opcode === 1) hub.recibir(cliente, f.carga.toString('utf8'));
      }
      resto = resto.subarray(hasta);
    });
    socket.on('close', () => hub.quitar(cliente));
    socket.on('error', () => hub.quitar(cliente));
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  pila.puerto = servidor.address().port;
  pila.url = `http://127.0.0.1:${pila.puerto}`;
  pila.clavePublicable = CLAVE_PUBLICABLE;

  // ── Lo que ve el POS: la página sigue creyendo que habla con su proyecto de Supabase ──
  /** Enchufa la pila a una página de Playwright: HTTP y WebSocket del host de Supabase salen a esta pila, no a internet. */
  pila.conectarPagina = async (page) => {
    const CORS = {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*, apikey, authorization, content-type, prefer, accept, accept-profile, content-profile, range, x-client-info',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS', 'access-control-expose-headers': 'content-range, content-type', 'access-control-max-age': '600',
    };
    await page.route((u) => u.hostname === HOST_SUPABASE, async (route) => {
      const pedido = route.request();
      if (pedido.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const cab = {};
      for (const [k, v] of Object.entries(pedido.headers())) cab[k.toLowerCase()] = v;
      const r = await atender({ metodo: pedido.method(), url: new URL(pedido.url()), cabeceras: cab, cuerpo: pedido.postData() || '' });
      return route.fulfill({ status: r.estado, headers: { ...CORS, ...r.cabeceras }, body: r.cuerpo });
    });
    await page.routeWebSocket((u) => u.hostname === HOST_SUPABASE, (ws) => {
      const cliente = hub.nuevo((texto) => { try { ws.send(texto); } catch { /* cerrado */ } }, () => ws.close());
      cliente.vsn = 2;
      ws.onMessage((m) => hub.recibir(cliente, typeof m === 'string' ? m : m.toString('utf8')));
      ws.onClose(() => hub.quitar(cliente));
    });
  };

  pila.tokenHash = sha256;
  return pila;
}

/** Datos de partida del POS: las mesas, el catálogo y las dos cuentas abiertas de siempre (mesa 3 y mesa 6), más el personal. */
function sembrar(pg) {
  const d = datosFicticios();
  const abiertas = d.tablas.ordenes.filter((o) => o.estado === 'abierta');
  const poblar = (tabla, filas) => {
    // Solo las columnas que traen los datos: las demás (updated_at…) toman su valor por defecto, como en un INSERT de verdad.
    const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))].map((c) => `"${c}"`).join(', ');
    const r = pg.sql(`insert into public.${tabla} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${tabla}, ${literal(JSON.stringify(filas))}::jsonb)`);
    if (!r.ok) throw new Error(`sembrar ${tabla}: ${r.error}`);
  };
  poblar('mesas', d.tablas.mesas);
  poblar('productos', d.tablas.productos);
  poblar('ordenes', abiertas);
  const p = pg.sql(`insert into public.personal (email, nombre, rol) values (${literal(CORREO_MESERO)}, 'Mesero Prueba', 'mesero') on conflict (email) do nothing`);
  if (!p.ok) throw new Error(`sembrar personal: ${p.error}`);
}
