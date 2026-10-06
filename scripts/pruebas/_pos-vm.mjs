// Arnés compartido de las pruebas de pos.html que ejecutan su <script> REAL en un `vm` de Node
// (mismo patrón que pos-cuenta-base.test.mjs y funciones.test.mjs), más una BASE FALSA con las
// reglas que pos.html le exige a Supabase: upsert, borrado, select, el índice único «una orden
// abierta por mesa» y la RPC `aplicar_delta_orden` (NO idempotente, falla si la orden no existe).
// No es un módulo de pruebas (el guion bajo lo deja fuera de `node --test scripts/pruebas/*.test.mjs`).
//
// Ronda 2 de la ola B (refutación): la base falsa también modela lo que la RLS y la migración de permisos le hacen al POS, que en la
// ronda 1 NO se veía y escondía el hallazgo 1 (la base real contesta «orden X no existe», no 42501, a un mesero que toca una orden
// cerrada). Con `permisosPorRol` (por defecto, como queda la base tras 20261002140000):
//   · aplicar_delta_orden de un MESERO sobre una orden CERRADA → «orden X no existe» (el FOR UPDATE no la ve; P0001);
//   · de cualquiera sobre una CERRADA, salvo `p_solo_abierta: false` → «orden X está cerrada» (SQLSTATE RS001);
//   · el séptimo parámetro no existe en la base si `permisosPorRol` es false (PGRST202: la migración aún no se aplicó);
//   · un upsert de un MESERO sobre una orden ya CERRADA, o de una cerrada con total negativo → 42501.
//
// Qué simula y qué no: la red es un interruptor (`base.red = false` → toda llamada devuelve el error
// que da supabase-js sin red, `{data: null, error}`, sin lanzar); la latencia es opcional; las fallas
// puntuales se piden con `base.fallar('delete:ordenes')`. No simula RLS, triggers ni Realtime: los
// ecos de Realtime se inyectan a mano con `pos.procesarCambioEnVivo`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// POS_HTML=<archivo> corre las pruebas contra OTRO pos.html (el de antes de una ola, o un mutante a mano): así se comprueba que
// las pruebas nuevas FALLAN sin el cambio que dicen cubrir. Sin la variable, el pos.html de la raíz.
const POS = fs.readFileSync(process.env.POS_HTML ? path.resolve(process.env.POS_HTML) : path.join(RAIZ, 'pos.html'), 'utf8');

export const soltar = () => new Promise((r) => setImmediate(r));
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
/** Deja correr varias vueltas de lo que el POS no espera (push sin await, cadenas de promesas). */
export async function asentar(vueltas = 12) { for (let i = 0; i < vueltas; i++) await soltar(); }
/** Espera (con un tope) a que se cumpla algo que depende de temporizadores. */
export async function hastaQue(cond, { ms = 3000, paso = 5 } = {}) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) { if (cond()) return true; await dormir(paso); }
  return !!cond();
}
export const plano = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x))); // trae a este realm lo que salió del `vm`

/** El <script> inline que define el store `pos` (el otro solo pinta iconos). */
export function scriptDelStore() {
  const bloques = [...POS.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const codigo = bloques.find((t) => t.includes("Alpine.store('pos'"));
  assert.ok(codigo, "no encontré el <script> de pos.html que define Alpine.store('pos', …)");
  return codigo;
}

export function textoDelScript() { return scriptDelStore(); }

// ───────────────────────── cliente de supabase de mentira ─────────────────────────

/**
 * Apunta cada llamada y deja que `responder(llamada)` conteste (por defecto, vacío y sin error). Una
 * llamada `from(...)` queda como {tipo:'from', tabla, op, cuerpo, opciones, filtros, retorno, unico}; una
 * `rpc`, como {tipo:'rpc', nombre, args}. `responder` puede ser async (una lectura «en vuelo»).
 */
export function crearSupabase({ responder = () => undefined } = {}) {
  const llamadas = [];
  const canales = [];
  const enVuelo = { ahora: 0, maximo: 0 };
  const porDefecto = (c) => (c.op === 'select' && !c.retorno ? { data: c.unico ? null : [], error: null }
    : c.retorno ? { data: [], error: null } : { data: null, error: null });

  function constructor(tabla) {
    const c = { tipo: 'from', tabla, op: 'select', cuerpo: undefined, opciones: undefined, filtros: [], retorno: null, unico: false };
    const b = {
      select(columnas) { if (c.op === 'select') c.columnas = columnas; else c.retorno = columnas; return b; },
      order() { return b; },
      limit(n) { c.limite = n; return b; },
      maybeSingle() { c.unico = true; return b; },
      eq(col, val) { c.filtros.push([col, val, 'eq']); return b; },
      in(col, vals) { c.filtros.push([col, vals, 'in']); return b; },
      upsert(cuerpo, opciones) { c.op = 'upsert'; c.cuerpo = cuerpo; c.opciones = opciones; return b; },
      update(cuerpo) { c.op = 'update'; c.cuerpo = cuerpo; return b; },
      insert(cuerpo) { c.op = 'insert'; c.cuerpo = cuerpo; return b; },
      delete() { c.op = 'delete'; return b; },
      then(ok, ko) {
        llamadas.push(c);
        enVuelo.ahora++; enVuelo.maximo = Math.max(enVuelo.maximo, enVuelo.ahora);
        const p = Promise.resolve().then(() => responder(c)).then((r) => r ?? porDefecto(c))
          .finally(() => { enVuelo.ahora--; });
        return p.then(ok, ko);
      },
    };
    return b;
  }

  const cliente = {
    from: constructor,
    rpc(nombre, args) {
      const c = { tipo: 'rpc', nombre, args };
      return { then(ok, ko) {
        llamadas.push(c);
        return Promise.resolve().then(() => responder(c)).then((r) => r ?? { data: null, error: null }).then(ok, ko);
      } };
    },
    channel(nombre, config) {
      const canal = { nombre, config, eventos: [], suscripcion: null, rastreos: [] };
      canal.on = (tipo, filtro) => { canal.eventos.push({ tipo, filtro }); return canal; };
      canal.subscribe = (cb) => { canal.suscripcion = cb; return canal; };
      canal.presenceState = () => ({});
      canal.track = (x) => { canal.rastreos.push(x); };
      canales.push(canal);
      return canal;
    },
    removeChannel(canal) { canal.removido = true; return Promise.resolve('ok'); },
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({}),
      signInWithOAuth: async () => ({}),
      signOut: async () => ({}),
    },
  };

  return {
    cliente, llamadas, canales, enVuelo,
    de: (tabla, op) => llamadas.filter((c) => c.tipo === 'from' && c.tabla === tabla && (!op || c.op === op)),
    rpcs: (nombre) => llamadas.filter((c) => c.tipo === 'rpc' && (!nombre || c.nombre === nombre)),
    canal: (nombre) => canales.find((c) => c.nombre === nombre),
  };
}

// ───────────────────────── la base falsa ─────────────────────────

const aLista = (x) => (Array.isArray(x) ? x : [x]);

/**
 * Una base con tablas en memoria detrás de `responder`. Estados que las pruebas miran:
 *   base.ordenes / mesas / productos / cierres → Map id → fila (filas con los nombres de columna de Postgres)
 *   base.rpcs → los deltas que llegaron: {orden, item, delta}
 *   base.red → interruptor; base.latenciaMs → demora de cada llamada; base.fallar('op:tabla') → falla esa operación
 */
export function crearBaseFalsa({ mesas = [], ordenes = [], productos = [], cierres = [], latenciaMs = 0, rol = 'admin', alertas = [], personal = [], permisosPorRol = true,
  olaC = false, yo = { email: 'yo@ejemplo.test', nombre: 'Yo' }, acceso, ajustes, impresoras = null } = {}) {
  const tabla = (filas) => new Map(filas.map((f) => [f.id, { ...f }]));
  const base = {
    red: true,
    latenciaMs,
    mesas: tabla(mesas),
    ordenes: tabla(ordenes.map((o) => ({ version: 0, items: [], total: 0, ...o }))),
    productos: tabla(productos),
    cierres: tabla(cierres),
    // Roles y alertas (ola B1): `rol` es lo que contesta mi_rol() (null = la cuenta no está en `personal`);
    // `personal` va por correo, no por id; `sinFuncion` hace que esas RPC «no existan» (migración sin aplicar).
    rol,
    permisosPorRol,
    alertas: tabla(alertas),
    personal: new Map(personal.map((p) => [p.email, { activo: true, nombre: '', ...p }])),
    sinFuncion: new Set(),
    deltasAplicados: new Set(),            // ids de deltas ya aplicados (public.deltas_aplicados, migración 20261002180000)
    // La cola de impresión de la caja (migración cola_impresion). `impresoras: null` = la cola NO existe (impresora_estado contesta
    // null, como el simulador de la página); una lista la enciende: [{ id, nombre, en_linea, ultimo_latido }]. `impresiones` guarda
    // lo que el POS insertó; `base.imprimir(id, estado, error)` hace de agente. `colaAusente` = la migración sin aplicar (PGRST202 / PGRST205).
    impresoras: impresoras && impresoras.map((p) => ({ ultimo_latido: null, version_agente: '', ...p })),
    impresiones: new Map(),
    colaAusente: false,
    impresionRechazo: null,
    respuestaPerdida: false,   // el insert LLEGA a la base pero la respuesta se pierde (sin `code`, como un corte de red): el teléfono no sabe si salió
    contadorCaja: 0,
    imprimir(id, estado, error = null) {
      const fila = base.impresiones.get(id);
      Object.assign(fila, { estado, error, intentos: (fila.intentos || 0) + (estado === 'imprimiendo' ? 1 : 0) });
      return { ...fila };
    },
    rpcs: [],
    fallos: new Set(),
    fallar(clave) { base.fallos.add(clave); },
    repararTodo() { base.fallos.clear(); },
  };
  iniciarOlaC(base, { olaC, yo, acceso, ajustes, rolInicial: rol, productos });
  const sinRed = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
  const total = (items) => items.reduce((s, i) => s + Number(i.precio) * i.qty, 0);

  base.responder = async (c) => {
    if (base.latenciaMs) await dormir(base.latenciaMs);
    if (!base.red) return sinRed();
    if (c.tipo === 'rpc') {
      if (c.nombre !== 'aplicar_delta_orden') { const r = rpcOlaC(base, c); if (r) return r; }
      if (c.nombre === 'aplicar_delta_orden') {
        if (base.fallos.has('rpc:aplicar_delta_orden')) return { data: null, error: { message: 'fallo inyectado' } };
        const o = base.ordenes.get(c.args.p_orden_id);
        if ('p_solo_abierta' in c.args && !base.permisosPorRol) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.aplicar_delta_orden(p_delta, p_item_id, p_nombre, p_nota, p_orden_id, p_precio, p_solo_abierta) in the schema cache' } };
        }
        // El octavo parámetro (p_delta_id) solo existe con la migración 20261002180000: sin ella, PostgREST no encuentra la función con ese nombre de parámetro.
        const idempotente = !!(base.olaC && base.olaC.deshacer);
        if ('p_delta_id' in c.args && !idempotente) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.aplicar_delta_orden(p_delta, p_delta_id, p_item_id, p_nombre, p_nota, p_orden_id, p_precio) in the schema cache' } };
        }
        // El SELECT … FOR UPDATE de un mesero no ve una orden cerrada (el filtro de ordenes_editar): «no existe», P0001, no 42501.
        if (!o || (base.permisosPorRol && base.rol === 'mesero' && o.estado === 'cerrada')) {
          return { data: null, error: { code: 'P0001', message: `orden ${c.args.p_orden_id} no existe` } };
        }
        // Con id: si ya estaba anotado no se aplica nada y se devuelve la orden tal cual (aunque esté cerrada); si no, se anota junto con el cambio.
        const conId = idempotente && c.args.p_delta_id != null && c.args.p_delta_id !== '';
        if (conId && base.deltasAplicados.has(c.args.p_delta_id)) return { data: o, error: null };
        if (base.permisosPorRol && o.estado !== 'abierta' && c.args.p_solo_abierta !== false) {
          return { data: null, error: { code: 'RS001', message: `orden ${c.args.p_orden_id} está cerrada` } };
        }
        if (conId) base.deltasAplicados.add(c.args.p_delta_id);
        base.rpcs.push({ orden: c.args.p_orden_id, item: c.args.p_item_id, delta: c.args.p_delta, id: c.args.p_delta_id });
        const existe = o.items.some((i) => i.id === c.args.p_item_id);
        if (existe) {
          o.items = o.items.map((i) => (i.id === c.args.p_item_id ? { ...i, qty: Math.max(0, i.qty + c.args.p_delta) } : i)).filter((i) => i.qty > 0);
        } else if (c.args.p_delta > 0) {
          o.items = [...o.items, { id: c.args.p_item_id, nombre: c.args.p_nombre, precio: c.args.p_precio, qty: c.args.p_delta, nota: c.args.p_nota || '' }];
        }
        o.total = total(o.items);
        o.version = (o.version || 0) + 1;
        // trg_ordenes_guardia: editar los ítems de una venta CERRADA corta su vínculo con la cuenta de la que salió (parcial_de).
        if (base.olaC && base.olaC.deshacer && o.estado === 'cerrada') o.parcial_de = null;
        return { data: o, error: null };
      }
      if (c.nombre === 'fijar_precio_item') return rpcPrecioAMano(base, c);
      return rpcCaja(base, c) ?? rpcRolesAlertas(base, c) ?? { data: null, error: null };
    }
    const especial = tablaOlaC(base, c);
    if (especial) return especial;
    const mapa = base[c.tabla];
    if (!(mapa instanceof Map)) return undefined;
    if (base.fallos.has(`${c.op}:${c.tabla}`)) return { data: null, error: { message: `fallo inyectado en ${c.op} ${c.tabla}` } };

    if (c.op === 'select') {
      let filas = [...mapa.values()].map((f) => ({ ...f }));
      // PostgREST devuelve TODAS las columnas, también las que valen null: con la migración de deshacer, `ordenes.parcial_de` viene siempre (el POS
      // sabe por ahí que la base tiene el guardia de `version`).
      if (c.tabla === 'ordenes' && base.olaC && base.olaC.deshacer) filas = filas.map((f) => ({ parcial_de: null, deltas_ids: null, ...f }));
      if (c.tabla === 'cierres' && base.olaC && base.olaC.cierresDia) filas = filas.map((f) => ({ nota: null, anulado_en: null, anulado_por: null, anulado_motivo: null, ...f }));
      if (c.limite === 0) filas = [];
      for (const [col, val, tipo] of c.filtros) filas = filas.filter((f) => (tipo === 'in' ? val.includes(f[col]) : f[col] === val));
      return { data: c.unico ? (filas[0] ?? null) : filas, error: null };
    }
    if (c.tabla === 'impresiones') {
      if (base.colaAusente) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.impresiones' in the schema cache" } };
      if (c.op === 'insert') {
        if (base.impresionRechazo) return { data: null, error: base.impresionRechazo };
        const filas = aLista(c.cuerpo).map((f) => {
          const nueva = { id: `impresion-${++base.contadorCaja}`, estado: 'pendiente', intentos: 0, error: null, creada_por: 'quien.llama@ejemplo.test', creada_en: new Date().toISOString(), ...f };
          base.impresiones.set(nueva.id, nueva);
          return nueva;
        });
        if (base.respuestaPerdida) return sinRed();
        return { data: c.retorno ? filas.map((f) => ({ id: f.id, estado: f.estado })) : null, error: null };
      }
    }
    if (c.op === 'upsert' || c.op === 'insert') {
      for (const fila of aLista(c.cuerpo)) {
        const previa = mapa.get(fila.id);
        if (c.tabla === 'ordenes' && base.permisosPorRol && base.rol === 'mesero') {
          const negativaCerrada = fila.estado === 'cerrada' && Number(fila.total) < 0;
          // ON CONFLICT DO UPDATE revisa el USING de la fila vieja: una venta cerrada no la toca un mesero (error, no 0 filas).
          const tocaCerrada = previa && previa.estado === 'cerrada' && !c.opciones?.ignoreDuplicates;
          if (negativaCerrada || tocaCerrada) {
            return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "ordenes"' } };
          }
        }
        if (previa && c.opciones?.ignoreDuplicates) continue;
        // trg_cierres_registrar_ordenes (migración 20261002180000): editar un cierre que la base ya tiene no puede meter una venta que está VIVA en `ordenes`
        // (RS004). Lo que el cierre ya traía no se revisa.
        // trg_cierres_anulado_congelado (migración 20261006100000): un cierre ANULADO rechaza todo upsert (RS006), aunque traiga el mismo contenido.
        if (c.tabla === 'cierres' && previa && previa.anulado_en && base.olaC && base.olaC.cierresDia) {
          return { data: null, error: { code: 'RS006', message: `el cierre ${previa.id} está anulado: no se edita ni se le sacan ventas (cierra el día otra vez)` } };
        }
        if (c.tabla === 'cierres' && previa && base.olaC && base.olaC.deshacer) {
          const antes = new Set((previa.transacciones || []).map((t) => t && t.id));
          const viva = (fila.transacciones || []).find((t) => t && t.id && !antes.has(t.id) && base.ordenes.has(t.id));
          if (viva) return { data: null, error: { code: 'RS004', message: `la venta ${viva.id} está viva (se reabrió o se volvió a cobrar): vuelve a leer el historial del cierre` } };
        }
        // trg_ordenes_guardia (migración 20261002180000): una venta cerrada que YA está archivada en un cierre del día no vuelve a cobrarse: se RECHAZA con RS005
        // (ya no se descarta en silencio). El camino de INSERT corre antes del ON CONFLICT, así que vale con o sin una fila previa (también la cuenta abierta).
        if (c.tabla === 'ordenes' && base.olaC && base.olaC.deshacer && fila.estado === 'cerrada'
            && [...base.cierres.values()].some((x) => !x.anulado_en && (x.transacciones || []).some((t) => t && t.id === fila.id))) {
          return { data: null, error: { code: 'RS005', message: `la cuenta ${fila.id} ya estaba en un cierre del día: revísala con el admin` } };
        }
        // El mismo guardia: el cobro POR PARTES / por persona / el abono (una cerrada nueva con `parcial_de`) de una cuenta que existe ABIERTA y archivada en un
        // cierre también se rechaza con RS005 (el mensaje dice «por partes»). Si la cuenta ya no está abierta, el parcial que llega tarde entra.
        if (c.tabla === 'ordenes' && base.olaC && base.olaC.deshacer && fila.estado === 'cerrada' && fila.parcial_de && !previa
            && base.ordenes.get(fila.parcial_de)?.estado === 'abierta'
            && [...base.cierres.values()].some((x) => !x.anulado_en && (x.transacciones || []).some((t) => t && t.id === fila.parcial_de))) {
          return { data: null, error: { code: 'RS005', message: `la cuenta ${fila.parcial_de} ya estaba en un cierre del día: no se puede cobrar por partes; revísala con el admin` } };
        }
        // trg_ordenes_guardia (migración 20261002180000): cerrar con una `version` que no es la de la base se rechaza (RS003).
        if (c.tabla === 'ordenes' && base.olaC && base.olaC.deshacer && previa && previa.estado === 'abierta' && fila.estado === 'cerrada'
            && 'version' in fila && fila.version !== (previa.version ?? 0)) {
          return { data: null, error: { code: 'RS003', message: `la cuenta de la orden ${fila.id} cambió desde que se vio: revísala antes de cobrar` } };
        }
        const nueva = { ...(previa || (c.tabla === 'ordenes' ? { version: 0 } : {})), ...fila };
        // Los ids de deltas que trae la fila pasan a `deltas_aplicados` (misma transacción) y la columna queda en null.
        if (c.tabla === 'ordenes' && base.olaC && base.olaC.deshacer) {
          if (Array.isArray(fila.deltas_ids)) for (const id of fila.deltas_ids) if (id) base.deltasAplicados.add(id);
          delete nueva.deltas_ids;
        }
        if (c.tabla === 'ordenes' && base.olaC && base.olaC.deshacer && previa) {
          nueva.parcial_de = previa.parcial_de ?? null;   // en UPDATE no cambia por la API
          if (previa.estado === 'cerrada' && (nueva.estado !== 'cerrada' || nueva.mesa_id !== previa.mesa_id || Number(nueva.total) !== Number(previa.total)
              || JSON.stringify(nueva.items) !== JSON.stringify(previa.items))) nueva.parcial_de = null;
          if (JSON.stringify(nueva.items) !== JSON.stringify(previa.items) && (fila.version === undefined || fila.version === previa.version)) nueva.version = (previa.version || 0) + 1;
        }
        if (c.tabla === 'ordenes' && nueva.estado === 'abierta'
          && [...mapa.values()].some((o) => o.id !== nueva.id && o.mesa_id === nueva.mesa_id && o.estado === 'abierta')) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ux_ordenes_una_abierta_por_mesa"' } };
        }
        mapa.set(nueva.id, nueva);
      }
      return { data: null, error: null };
    }
    if (c.op === 'delete') {
      for (const [col, val, tipo] of c.filtros) {
        for (const [id, f] of [...mapa]) {
          if (!(tipo === 'in' ? val.includes(f[col]) : f[col] === val)) continue;
          // trg_ordenes_guardia_borrar (migración 20261002180000): por la API, una cuenta ABIERTA con ítems no se borra (se salta en silencio).
          if (c.tabla === 'ordenes' && base.olaC && base.olaC.deshacer && f.estado === 'abierta' && (f.items || []).length > 0) continue;
          // ... y una venta CERRADA que ningún cierre archivó tampoco (una purga atrasada no se lleva un cobro vivo).
          if (c.tabla === 'ordenes' && base.olaC && base.olaC.deshacer && f.estado === 'cerrada'
              && ![...base.cierres.values()].some((x) => !x.anulado_en && (x.transacciones || []).some((t) => t && t.id === f.id))) continue;
          mapa.delete(id);
        }
      }
      return { data: null, error: null };
    }
    if (c.op === 'update') {
      const tocadas = [];
      for (const f of mapa.values()) {
        if (c.filtros.every(([col, val, tipo]) => (tipo === 'in' ? val.includes(f[col]) : f[col] === val))) {
          const tokenAntes = f.token;
          Object.assign(f, c.cuerpo);
          // trg_mesas_pegatina_obsoleta (ola C): al girar el token la pegatina pegada quedó con el enlace viejo y la base borra sus dos fechas.
          if (c.tabla === 'mesas' && base.olaC && base.olaC.mesas && 'token' in c.cuerpo && c.cuerpo.token !== tokenAntes) { f.pegatina_escrita_en = null; f.pegatina_revisada_en = null; }
          tocadas.push({ id: f.id });
        }
      }
      return { data: c.retorno ? tocadas : null, error: null };
    }
    return undefined;
  };
  return base;
}

// ───────────────────────── precio a mano (precio-a-mano-y-botones) ─────────────────────────

/**
 * `public.fijar_precio_item(p_orden_id, p_item_id, p_precio)` de supabase/migrations/20261006110000_precio_a_mano.sql (y 20261006130000_precio_a_mano_promo_entera.sql), con sus reglas:
 *   · sin rol (base.rol null) → 42501; precio negativo, con decimales o de más de 10.000.000 → 22023 (p_precio null = volver a la carta);
 *   · la orden no existe, o es CERRADA y quien llama es un mesero (la RLS no se la muestra) → «orden X no existe»; cerrada para el admin → RS001;
 *   · la línea no existe → «la línea X no existe en la orden Y» con SQLSTATE P0002 (20261006130000; «orden X no existe» sigue P0001); si la promo se llevó la
 *     base ENTERA (no hay línea base pero sí líneas de promo con `promo.de` = ese id) el precio y la marca se escriben en esas líneas de promo;
 *     el marcador «para llevar», un abono y una línea de promo → 22023;
 *   · pone `precio` y `precio_manual: true` (una línea `manual_…` solo el precio); con null quita la marca y toma el precio de `productos` (el trigger
 *     del precio vivo); las líneas de promo de esa base se recalculan (el mismo descuento sobre el precio nuevo); sube `version`.
 * `base.sinFuncion` la hace «no existir» (la migración sin aplicar: PGRST202) y `base.fallos` ('rpc:fijar_precio_item') la hace fallar sin código.
 * Cada llamada que llegó a la base se anota en `base.precios` ({ orden, item, precio }).
 */
export function rpcPrecioAMano(base, c) {
  const a = c.args || {};
  if (base.sinFuncion.has(c.nombre)) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fijar_precio_item(p_item_id, p_orden_id, p_precio) in the schema cache' } };
  if (base.fallos.has('rpc:fijar_precio_item')) return { data: null, error: { message: 'fallo inyectado' } };
  const error = (code, message) => ({ data: null, error: { code, message } });
  if (!base.rol) return error('42501', 'sin permiso para cambiar el precio de una línea');
  const p = a.p_precio;
  if (p !== null && p !== undefined && (!Number.isInteger(Number(p)) || Number(p) < 0 || Number(p) > 10000000)) return error('22023', `precio inválido (${p}): pesos enteros, de 0 a 10.000.000`);
  const o = base.ordenes.get(a.p_orden_id);
  if (!o || (base.permisosPorRol && base.rol === 'mesero' && o.estado === 'cerrada')) return error('P0001', `orden ${a.p_orden_id} no existe`);
  if (o.estado !== 'abierta') return error('RS001', `orden ${a.p_orden_id} está cerrada`);
  const x = o.items.find((i) => i.id === a.p_item_id);
  if (!x) {
    // 20261006130000: si la promo se llevó la base ENTERA, el precio y la marca se escriben en sus líneas de promo (promo.precio / precio_manual / precio_por);
    // sin base ni promo de esa base, «la línea no existe» con SQLSTATE P0002 (distinto del P0001 de «orden no existe»).
    const promos = o.items.filter((l) => l.promo && l.promo.de === a.p_item_id);
    if (!promos.length) return error('P0002', `la línea ${a.p_item_id} no existe en la orden ${a.p_orden_id}`);
    if (a.p_item_id === 'para_llevar' || String(a.p_item_id).startsWith('abono_') || String(a.p_item_id).startsWith('manual_')) return error('22023', `el precio de la línea ${a.p_item_id} no se puede cambiar a mano`);
    for (const l of promos) {
      if (p === null || p === undefined) {
        delete l.promo.precio_manual; delete l.promo.precio_por;
        const prod = base.productos.get(String(a.p_item_id).split('__')[0]);
        if (prod) l.promo.precio = Number(prod.precio);
      } else {
        l.promo.precio = Number(p); l.promo.precio_manual = true; l.promo.precio_por = String(base.yo?.email || 'quien.llama@ejemplo.test').toLowerCase();
      }
      l.precio = Math.round(l.promo.precio * (100 - l.promo.descuento) / 100);
    }
    o.total = o.items.reduce((acc, i) => acc + Number(i.precio) * i.qty, 0);
    o.version = (o.version || 0) + 1;
    (base.precios ||= []).push({ orden: a.p_orden_id, item: a.p_item_id, precio: p ?? null });
    return { data: o, error: null };
  }
  if (a.p_item_id === 'para_llevar' || String(a.p_item_id).startsWith('abono_') || String(a.p_item_id).startsWith('promo:') || Number(x.precio) < 0) {
    return error('22023', `el precio de la línea ${a.p_item_id} no se puede cambiar a mano`);
  }
  const manual = String(a.p_item_id).startsWith('manual_');
  if (p === null || p === undefined) {
    if (manual) return error('22023', `la línea ${a.p_item_id} es manual: no tiene precio de carta al que volver`);
    delete x.precio_manual; delete x.precio_por;
    const prod = base.productos.get(String(a.p_item_id).split('__')[0]);
    if (prod) x.precio = Number(prod.precio);
  } else {
    x.precio = Number(p);
    if (!manual) { x.precio_manual = true; x.precio_por = String(base.yo?.email || 'quien.llama@ejemplo.test').toLowerCase(); }
  }
  for (const l of o.items) {
    if (!l.promo || l.promo.de !== x.id) continue;
    l.promo.precio = x.precio;
    l.precio = Math.round(x.precio * (100 - l.promo.descuento) / 100);
    if (x.precio_manual) l.promo.precio_manual = true; else delete l.promo.precio_manual;
  }
  o.total = o.items.reduce((acc, i) => acc + Number(i.precio) * i.qty, 0);
  o.version = (o.version || 0) + 1;
  (base.precios ||= []).push({ orden: a.p_orden_id, item: a.p_item_id, precio: p ?? null });
  return { data: o, error: null };
}

// ───────────────────────── roles, alertas y personal (ola B1) ─────────────────────────

/**
 * Las RPC de la migración de roles que el POS llama, con las reglas que importan (SDD cuenta-en-mesa §02 y §03.1):
 *   mi_rol()                         → base.rol (null = sin fila activa en `personal`)
 *   atender_alerta / descartar_alerta → jsonb {ok, alerta} | {ok:false, codigo: no_autorizado | no_existe | no_pendiente}
 *   personal_alta / _baja / _cambiar_rol → jsonb {ok, personal} | {ok:false, codigo}; solo admin; nunca cero admins
 * Devuelve undefined si no es una de ellas. `base.sinFuncion` (Set de nombres) las hace «no existir» como PostgREST.
 */
export function rpcRolesAlertas(base, c) {
  const a = c.args || {};
  if (base.sinFuncion.has(c.nombre)) {
    return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${c.nombre} in the schema cache` } };
  }
  if (base.fallos.has(`rpc:${c.nombre}`)) return { data: null, error: { message: 'fallo inyectado' } };
  const ok = (extra) => ({ data: { ok: true, ...extra }, error: null });
  const no = (codigo, extra) => ({ data: { ok: false, codigo, ...extra }, error: null });
  const admin = base.rol === 'admin';

  if (c.nombre === 'mi_rol') return { data: base.rol ?? null, error: null };

  if (c.nombre === 'atender_alerta' || c.nombre === 'descartar_alerta') {
    if (!base.rol) return no('no_autorizado');
    const fila = base.alertas.get(a.p_id);
    if (!fila) return no('no_existe');
    if (fila.estado !== 'pendiente') return no('no_pendiente', { estado: fila.estado });
    fila.estado = c.nombre === 'atender_alerta' ? 'atendida' : 'descartada';
    fila.atendida_en = new Date().toISOString();
    fila.atendida_por = 'quien.llama@ejemplo.test';
    return ok({ alerta: { ...fila } });
  }

  if (c.nombre === 'personal_alta' || c.nombre === 'personal_baja' || c.nombre === 'personal_cambiar_rol') {
    if (!admin) return no('no_autorizado');
    const email = String(a.p_email ?? '').trim().toLowerCase();
    const admins = () => [...base.personal.values()].filter((p) => p.rol === 'admin' && p.activo).length;
    const fila = base.personal.get(email);
    if (c.nombre === 'personal_alta') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return no('correo_invalido');
      if (!['admin', 'mesero'].includes(a.p_rol)) return no('rol_invalido');
      if (fila?.activo) return no('ya_existe');
      const nueva = { email, nombre: String(a.p_nombre ?? '').trim(), rol: a.p_rol, activo: true };
      base.personal.set(email, nueva);
      return ok({ personal: { ...nueva } });
    }
    if (!fila) return no('no_existe');
    if (!fila.activo) return no('inactivo');
    if (c.nombre === 'personal_baja') {
      if (fila.rol === 'admin' && admins() <= 1) return no('ultimo_admin');
      fila.activo = false;
      return ok({ personal: { ...fila } });
    }
    if (!['admin', 'mesero'].includes(a.p_rol)) return no('rol_invalido');
    if (fila.rol === 'admin' && a.p_rol !== 'admin' && admins() <= 1) return no('ultimo_admin');
    fila.rol = a.p_rol;
    return ok({ personal: { ...fila } });
  }
  return undefined;
}

// ───────────────────────── ola C: aprobación del personal, mesas y pegatinas, deshacer cobros, ajustes ─────────────────────────

/**
 * Qué migraciones de la ola C tiene la base falsa: `olaC: true` = las cuatro y la de los cierres por día; o `{ aprobacion, mesas, ajustes, deshacer, cierresDia }` (cada una true/false).
 * Sin `olaC` la base es la de la ola B: las RPC nuevas no existen (PGRST202), la tabla `ajustes` tampoco (PGRST205).
 *   aprobacion  → personal.estado, solicitar_acceso, vista_pendiente, personal_aprobar, personal_eliminar; mi_rol sale de `personal`
 *   mesas       → mesas.activa y las fechas de la pegatina; mesa_crear, mesa_editar, mesa_activar, pegatina_marcar
 *   ajustes     → la tabla `ajustes` (fila 1)
 *   deshacer    → ordenes.parcial_de y deshacer_cobro
 * Con `aprobacion`, `yo` es la cuenta que llama: `acceso` ('aprobado' | 'pendiente' | 'eliminado' | 'ninguno') decide su fila en `personal`
 * (por defecto: aprobado con el `rol` dado, o ninguno si el rol es null). `base.rol` pasa a ser un reflejo de esa fila.
 */
function iniciarOlaC(base, { olaC, yo, acceso, ajustes, rolInicial, productos }) {
  // `cierresDia` = la migración 20261006100000 (cerrar_dia_de, cierre_corregir_nota, cierre_anular, cierres.nota / anulado_*, la tabla cierres_cambios). `olaC: true`
  // la incluye (es la base completa de hoy); un objeto `{ deshacer: true }` es una base SIN ella: el POS cierra por `cerrar_dia`, como antes.
  const m = olaC === true ? { aprobacion: true, mesas: true, ajustes: true, deshacer: true, cierresDia: true } : { aprobacion: false, mesas: false, ajustes: false, deshacer: false, cierresDia: false, ...(olaC || {}) };
  base.olaC = m;
  base.cierresCambios = [];                // las filas de `cierres_cambios` (solo las escriben las RPC de cierres; solo las lee el admin)
  base.yo = yo;
  base.sinColumnas = new Set();           // 'tabla.columna' que la base «no tiene» (42703 al leer, PGRST204 al escribir)
  base.sinGoogle = false;                  // la sesión no es de Google: solicitar_acceso no contesta nada
  base.deshechos = [];                     // ids de las órdenes cerradas que deshacer_cobro devolvió a su cuenta
  base.deshechosTabla = [];                // las filas de la tabla `deshechos` (solo las escribe deshacer_cobro; solo las lee el admin)
  base.solicitudes = 0;                    // cuántas veces llegó solicitar_acceso
  if (m.ajustes) {
    base.ajustes = new Map((ajustes || [{ id: 1, ticket_qr_url: 'https://resplandor.ynt.codes/', ticket_qr_visible: true, ticket_pie: 'Gracias por su visita' }]).map((f) => [f.id, { ...f }]));
  }
  if (m.aprobacion) {
    const original = rolInicial;
    const estado = acceso ?? (original ? 'aprobado' : 'ninguno');
    if (estado !== 'ninguno') {
      base.personal.set(yo.email, { email: yo.email, nombre: yo.nombre, rol: estado === 'aprobado' ? (original || 'mesero') : 'mesero', activo: estado !== 'eliminado', estado: estado === 'aprobado' ? 'aprobado' : 'pendiente', solicitado_en: '2026-09-30T12:00:00Z', ...(base.personal.get(yo.email) || {}) });
    }
    // Las filas de `personal` que se pasaron sin estado son de gente ya aprobada.
    for (const f of base.personal.values()) if (!f.estado) f.estado = 'aprobado';
    Object.defineProperty(base, 'rol', {
      enumerable: true,
      get() { const f = base.personal.get(yo.email); return f && f.activo && f.estado === 'aprobado' ? f.rol : null; },
      set(v) {
        const f = base.personal.get(yo.email);
        if (v == null) { if (f) { f.estado = 'pendiente'; } return; }
        base.personal.set(yo.email, { email: yo.email, nombre: yo.nombre, activo: true, solicitado_en: '2026-09-30T12:00:00Z', ...(f || {}), rol: v, estado: 'aprobado' });
      },
    });
  }
  if (m.mesas || m.aprobacion) {
    base.carta_publica = new Map((productos || []).filter((p) => p.activo !== false).map((p) => [p.id, { id: p.id, categoria: p.categoria, nombre: p.nombre, precio: p.precio, descripcion: p.descripcion ?? '' }]));
  }
}

/** El día de un instante en Bogotá, 'AAAA-MM-DD' (como `privado.fecha_bogota` de la base): Bogotá es UTC−5 todo el año. */
export function fechaBogotaFalsa(cuando) {
  const t = new Date(cuando instanceof Date ? cuando.getTime() : cuando);
  return Number.isFinite(t.getTime()) ? new Date(t.getTime() - 5 * 3600000).toISOString().slice(0, 10) : null;
}

/**
 * Hace `minutos` minutos, como hora (ISO). Si eso cae en el día anterior de Bogotá y `minutos` es de menos de un día, se queda a la medianoche de HOY: una
 * venta «de hace 30 minutos» es de hoy aunque la prueba corra a las 00:10 de Bogotá (las ventas del turno son solo las de hoy). Más de un día: ayer de verdad.
 */
export function haceMin(minutos, ahora = Date.now()) {
  const t = ahora - minutos * 60000;
  if (minutos >= 24 * 60) return new Date(t).toISOString();
  const inicioHoy = Date.parse(`${fechaBogotaFalsa(ahora)}T00:00:00-05:00`);
  return new Date(Math.min(ahora, Math.max(t, inicioHoy))).toISOString();
}

const PGRST202 = (nombre) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nombre} in the schema cache` } });

/** Las RPC de la ola C, con las reglas de los contratos (C1). Devuelve undefined si no es una de ellas. */
export function rpcOlaC(base, c) {
  const a = c.args || {};
  const m = base.olaC;
  const grupo = {
    solicitar_acceso: 'aprobacion', vista_pendiente: 'aprobacion', personal_aprobar: 'aprobacion', personal_eliminar: 'aprobacion',
    mesa_crear: 'mesas', mesa_editar: 'mesas', mesa_activar: 'mesas', pegatina_marcar: 'mesas',
    deshacer_cobro: 'deshacer', cerrar_dia: 'deshacer', reabrir_venta_de_cierre: 'deshacer',
    cerrar_dia_de: 'cierresDia', cierre_corregir_nota: 'cierresDia', cierre_anular: 'cierresDia',
  }[c.nombre];
  if (!grupo && !(c.nombre === 'mi_rol' && m.aprobacion)) return undefined;
  if (grupo && (!m[grupo] || base.sinFuncion.has(c.nombre))) return PGRST202(c.nombre);
  if (base.fallos.has(`rpc:${c.nombre}`)) return { data: null, error: { message: 'fallo inyectado' } };
  const ok = (extra) => ({ data: { ok: true, ...extra }, error: null });
  const no = (codigo, extra) => ({ data: { ok: false, codigo, ...extra }, error: null });
  const rol = base.rol;
  const admin = rol === 'admin';
  const email = String(a.p_email ?? '').trim().toLowerCase();

  if (c.nombre === 'mi_rol') return base.sinFuncion.has('mi_rol') ? PGRST202('mi_rol') : { data: rol ?? null, error: null };

  if (c.nombre === 'solicitar_acceso') {
    base.solicitudes++;
    if (base.sinGoogle) return { data: null, error: null };
    const f = base.personal.get(base.yo.email);
    if (f) return { data: { estado: !f.activo ? 'eliminado' : f.estado, rol: f.rol }, error: null };
    if ([...base.personal.values()].filter((p) => p.estado === 'pendiente' && p.activo).length >= 50) return { data: null, error: { message: 'hay demasiadas solicitudes pendientes' } };
    base.personal.set(base.yo.email, { email: base.yo.email, nombre: base.yo.nombre, rol: 'mesero', activo: true, estado: 'pendiente', solicitado_en: new Date().toISOString() });
    return { data: { estado: 'pendiente', rol: 'mesero' }, error: null };
  }
  if (c.nombre === 'vista_pendiente') {
    if (base.sinGoogle) return { data: null, error: { message: 'sin sesión de Google' } };
    return { data: [...base.mesas.values()].filter((x) => x.activa !== false).sort((x, y) => x.id - y.id).map((x) => ({ id: x.id, capacidad: x.capacidad, estado: x.estado })), error: null };
  }
  if (c.nombre === 'personal_aprobar' || c.nombre === 'personal_eliminar') {
    if (!admin) return no('no_autorizado');
    const f = base.personal.get(email);
    if (!f) return no('no_existe');
    const admins = () => [...base.personal.values()].filter((p) => p.rol === 'admin' && p.activo && p.estado === 'aprobado').length;
    if (c.nombre === 'personal_aprobar') {
      if (!['admin', 'mesero'].includes(a.p_rol)) return no('rol_invalido');
      if (f.activo && f.estado === 'aprobado') return no('ya_aprobado');
      if (!f.activo) return no('no_pendiente');
      f.estado = 'aprobado'; f.rol = a.p_rol;
      return ok();
    }
    if (!f.activo) return no('inactivo');
    if (f.rol === 'admin' && f.estado === 'aprobado' && admins() <= 1) return no('ultimo_admin');
    f.activo = false;
    return ok();
  }
  if (c.nombre === 'mesa_crear' || c.nombre === 'mesa_editar' || c.nombre === 'mesa_activar' || c.nombre === 'pegatina_marcar') {
    if (!admin) return no('no_autorizado');
    const existe = base.mesas.get(a.p_id);
    if (c.nombre === 'mesa_crear') {
      if (existe) return no('ya_existe');
      base.mesas.set(a.p_id, { id: a.p_id, capacidad: a.p_capacidad, estado: 'libre', activa: true, token: 'f'.repeat(24) + String(a.p_id).padStart(24, '0'), pegatina_escrita_en: null, pegatina_revisada_en: null });
      return ok({ id: a.p_id });
    }
    if (!existe) return no('no_existe');
    if (c.nombre === 'mesa_editar') { existe.capacidad = a.p_capacidad; return ok(); }
    if (c.nombre === 'mesa_activar') {
      if (!a.p_activa && [...base.ordenes.values()].some((o) => o.mesa_id === a.p_id && o.estado === 'abierta')) return no('con_cuenta_abierta');
      existe.activa = !!a.p_activa;
      return ok();
    }
    if (!['escrita', 'revisada'].includes(a.p_tipo)) return no('tipo_invalido');
    if (!a.p_token) return no('token_invalido');
    if (existe.token !== a.p_token) return no('enlace_cambio');   // el enlace de la mesa ya es otro: la pegatina quedó vieja
    if (a.p_tipo === 'escrita') { existe.pegatina_escrita_en = new Date().toISOString(); existe.pegatina_revisada_en = null; }
    else existe.pegatina_revisada_en = new Date().toISOString();
    return ok();
  }
  if (c.nombre === 'deshacer_cobro') {
    // El modelo de supabase/migrations/20261002180000_deshacer_cobro.sql: SIN ventana de tiempo (admin y mesero), un parcial o un abono vuelven a
    // la cuenta abierta de la MISMA mesa, el cobro completo reabre la mesa o pasa a la cuenta que ya tiene, el monto es lo que de verdad volvió,
    // y cada deshacer deja su fila en `deshechos`.
    if (!rol) return no('no_autorizado');
    const ordenes = [...base.ordenes.values()];
    const cerrada = base.ordenes.get(a.p_orden_id);
    if (!cerrada) return no('no_existe');
    if (cerrada.estado === 'abierta') return no('ya_reabierta');   // otra tablet acaba de deshacer ese mismo cobro completo
    if (cerrada.estado !== 'cerrada' || !Array.isArray(cerrada.items) || !cerrada.items.length) return no('no_es_parcial');
    if ([...base.cierres.values()].some((x) => !x.anulado_en && (x.transacciones || []).some((t) => t.id === cerrada.id))) return no('ya_en_cierre');
    const esAbono = (i) => String(i.id).startsWith('abono_') && !String(i.id).startsWith('abono_recibido_');
    const sumar = (items) => items.reduce((s, i) => s + Number(i.precio) * i.qty, 0);
    const juntar = (base0, extra) => { const r = base0.map((i) => ({ ...i })); for (const it of extra) { if (!(it.qty > 0)) continue; const ya = r.find((x) => x.id === it.id); if (ya) ya.qty += it.qty; else r.push({ ...it }); } return r; };
    let destino; let tipo; let items; let antes = 0; let reabierta = false; let fusionada = false;
    if (cerrada.parcial_de) {
      destino = base.ordenes.get(cerrada.parcial_de);
      if (!destino || destino.estado !== 'abierta') return no('cuenta_ya_cerrada');
      if (destino.mesa_id !== cerrada.mesa_id) return no('no_es_parcial');
      antes = sumar(destino.items);
      if (cerrada.items.length === 1 && esAbono(cerrada.items[0])) {
        tipo = 'abono';
        const it = cerrada.items[0];
        if (it.qty !== 1 || !(Number(it.precio) > 0)) return no('no_es_parcial');
        const idCredito = 'abono_recibido_' + String(it.id).slice('abono_'.length);
        const credito = destino.items.filter((i) => i.id === idCredito);
        if (credito.length !== 1 || credito[0].qty !== 1 || Number(credito[0].precio) !== -Number(it.precio)) return no('no_es_parcial');
        items = destino.items.filter((i) => i.id !== idCredito);
      } else {
        tipo = 'parcial';
        if (cerrada.items.some((i) => String(i.id).startsWith('abono_') || !(i.qty > 0) || !(Number(i.precio) >= 0))) return no('no_es_parcial');
        items = juntar(destino.items, cerrada.items);
      }
    } else {
      tipo = 'completo';
      if (cerrada.items.some(esAbono)) return no('no_es_parcial');
      const mesa = base.mesas.get(cerrada.mesa_id);
      if (!mesa) return no('no_es_parcial');
      if (mesa.activa === false) return no('mesa_inactiva');
      destino = ordenes.find((o) => o.mesa_id === cerrada.mesa_id && o.estado === 'abierta');
      if (destino) { fusionada = true; antes = sumar(destino.items); items = juntar(destino.items, cerrada.items); } else reabierta = true;
    }
    let monto;
    if (reabierta) {
      monto = sumar(cerrada.items);
      Object.assign(cerrada, { estado: 'abierta', cerrada_en: null, total: monto, version: (cerrada.version || 0) + 1 });
      base.mesas.get(cerrada.mesa_id).estado = 'ocupada';
      destino = cerrada;
    } else {
      const total = sumar(items);
      monto = total - antes;
      Object.assign(destino, { items, total, version: (destino.version || 0) + 1 });
      if (fusionada) for (const o of ordenes) if (o.parcial_de === cerrada.id) o.parcial_de = destino.id;
      base.ordenes.delete(cerrada.id);
    }
    base.deshechos.push(cerrada.id);
    base.deshechosTabla.push({ id: base.deshechosTabla.length + 1, orden_id: cerrada.id, mesa_id: cerrada.mesa_id, tipo, monto, items: cerrada.items.map((i) => ({ ...i })), hecho_por: base.yo.email, hecho_en: new Date().toISOString(), cierre_id: null });
    return ok({ tipo, total_abierta: destino.total, orden_id: destino.id, mesa_id: destino.mesa_id, monto, version: destino.version, reabierta, fusionada });
  }
  if (c.nombre === 'reabrir_venta_de_cierre') {
    // El modelo de reabrir_venta_de_cierre (20261002180000, punto 9): solo admin; UNA transacción que saca la venta del cierre (recalcula su total) y deja la cuenta
    // abierta en la mesa pedida; si la cuenta ya existe ABIERTA con ese id solo la saca del cierre (adoptada). Todo o nada: si se niega, nada cambia.
    if (!admin) return no('no_autorizado');
    if (!a.p_cierre_id || !a.p_orden_id || a.p_mesa_id == null) return no('invalido');
    const k = base.cierres.get(a.p_cierre_id);
    if (!k) return no('no_existe');
    const trans = Array.isArray(k.transacciones) ? k.transacciones : [];
    const venta = trans.find((t) => t && t.id === a.p_orden_id);
    if (!venta) return no('no_esta_en_cierre');
    const items = (venta.items || []).map((i) => ({ ...i, qty: Number.isInteger(i.qty) ? i.qty : (Number.isInteger(i.cantidad) ? i.cantidad : 1) }));
    if (items.length === 1 && String(items[0].id).startsWith('abono_') && !String(items[0].id).startsWith('abono_recibido_')) return no('es_abono');
    let o = base.ordenes.get(a.p_orden_id);
    let adoptada = false;
    if (o && o.estado === 'abierta') {
      adoptada = true;
    } else {
      const mesa = base.mesas.get(a.p_mesa_id);
      if (!mesa) return no('mesa_inexistente');
      if (mesa.activa === false) return no('mesa_inactiva');
      if ([...base.ordenes.values()].some((x) => x.mesa_id === a.p_mesa_id && x.estado === 'abierta')) return no('mesa_ocupada');
      if (o) {
        // un rezago: la venta sigue en `ordenes` cerrada aunque su cierre ya la archivó (la purga de un POS viejo no terminó): se reabre ESA fila
        Object.assign(o, { estado: 'abierta', mesa_id: a.p_mesa_id, cerrada_en: null, parcial_de: null, version: (o.version || 0) + 1, updated_at: new Date().toISOString() });
      } else {
        o = { id: a.p_orden_id, mesa_id: a.p_mesa_id, estado: 'abierta', items, total: items.reduce((s, i) => s + Number(i.precio) * i.qty, 0),
              abierta_en: venta.abiertaEn || new Date().toISOString(), cerrada_en: null, version: (Number(venta.version) || 0) + 1, parcial_de: null, updated_at: new Date().toISOString() };
        base.ordenes.set(o.id, o);
      }
      mesa.estado = 'ocupada';
    }
    const resto = trans.filter((t) => !(t && t.id === a.p_orden_id));
    k.transacciones = resto;
    k.total_ventas = resto.reduce((s, t) => s + (Number(t.total) || 0), 0);
    k.total_ordenes = resto.length;
    base.reaperturas = (base.reaperturas || 0) + 1;
    return ok({ adoptada, orden: { ...o }, cierre: { id: k.id, fecha: k.fecha, total: k.total_ventas, n: k.total_ordenes, ordenes: resto } });
  }
  if (c.nombre === 'cerrar_dia' || c.nombre === 'cerrar_dia_de') {
    // El modelo de cerrar_dia (20261002180000, punto 6): el cierre del día lo decide la base. Solo admin; toma TODAS las ventas cerradas que ningún cierre
    // archivó; rechaza si hay una cuenta abierta; solo cierra si lo que el POS espera (n, total, ids) es lo que hay, y si no, `cambio` con su resumen;
    // guarda el cierre (con las ventas en camelCase, como las guarda el POS), borra lo que archiva y los rezagos, purga los deltas y marca los deshechos.
    // `cerrar_dia_de` (20261006100000): lo mismo pero SOLO con las ventas de `p_dia` (el día de Bogotá de su cerrada_en); hoy exige las mesas cobradas y un
    // día pasado no; el cierre de un día pasado lleva la fecha de ese día (su 23:59:59 en Bogotá). Y (20261006120000) hoy también cierra las de «mañana».
    if (!admin) return no('no_autorizado');
    const esp = a.p_esperado;
    const porDia = c.nombre === 'cerrar_dia_de';
    const hoy = fechaBogotaFalsa(new Date());
    if (!a.p_id || !esp || typeof esp !== 'object' || Array.isArray(esp)) return no('invalido');
    if (porDia && (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.p_dia)) || String(a.p_dia) > hoy)) return no('invalido');
    base.cierresRpc = (base.cierresRpc || 0) + 1;
    (base.llamadasCierre = base.llamadasCierre || []).push({ nombre: c.nombre, dia: a.p_dia ?? null, esperado: esp });
    const hecho = base.cierres.get(a.p_id);
    if (hecho) {
      const dh = base.deshechosTabla.filter((d) => d.cierre_id === a.p_id).map((d) => ({ orden_id: d.orden_id, mesa_id: d.mesa_id, tipo: d.tipo, monto: d.monto, hecho_por: d.hecho_por, hecho_en: d.hecho_en }));
      return ok({ repetido: true, n: hecho.total_ordenes, total: hecho.total_ventas, borradas: 0, cierre: { id: hecho.id, fecha: hecho.fecha, total: hecho.total_ventas, n: hecho.total_ordenes, ordenes: hecho.transacciones }, deshechos: dh });
    }
    const archivada = (id) => [...base.cierres.values()].some((x) => !x.anulado_en && (x.transacciones || []).some((t) => t && t.id === id));
    const todas = [...base.ordenes.values()];
    // (20261006120000) HOY se lleva también las ventas de «mañana» (cerrada_en futura: el reloj de una tablet adelantado); un día pasado, no.
    const delDia = (o) => { if (!porDia) return true; const d = fechaBogotaFalsa(o.cerrada_en ?? o.abierta_en); return d === a.p_dia || (a.p_dia === hoy && d > hoy); };
    const ids = todas.filter((o) => o.estado === 'cerrada' && !archivada(o.id) && delDia(o)).map((o) => o.id).sort();
    const ya = todas.filter((o) => o.estado === 'cerrada' && archivada(o.id)).map((o) => o.id);
    const filas = ids.map((id) => base.ordenes.get(id));
    const total = filas.reduce((s, o) => s + Number(o.total), 0);
    const resumen = { n: ids.length, total, ids, abonos_por_metodo: {}, ...(porDia ? { dia: a.p_dia } : {}) };
    for (const o of filas) for (const it of o.items || []) if (String(it.id).startsWith('abono_') && !String(it.id).startsWith('abono_recibido_')) {
      const m = it.nota || 'sin_metodo'; resumen.abonos_por_metodo[m] = (resumen.abonos_por_metodo[m] || 0) + Number(it.precio) * it.qty;
    }
    const abiertas = [...new Set(todas.filter((o) => o.estado === 'abierta').map((o) => o.mesa_id))].sort((x, y) => x - y);
    // `en_cierre`: de esas mesas, las que además tienen su cuenta registrada en un cierre del día (no se pueden cobrar: RS005).
    const enCierre = [...new Set(todas.filter((o) => o.estado === 'abierta' && archivada(o.id)).map((o) => o.mesa_id))].sort((x, y) => x - y);
    if (abiertas.length && (!porDia || a.p_dia === hoy)) return no('hay_abiertas', { abiertas, en_cierre: enCierre, resumen });
    if (!ids.length) return no('sin_ventas', { resumen });
    const esIds = Array.isArray(esp.ids) ? [...new Set(esp.ids.map(String))].sort() : null;
    if (String(esp.n) !== String(ids.length) || Number(esp.total) !== total || (esIds && JSON.stringify(esIds) !== JSON.stringify(ids))) return no('cambio', { resumen });
    base.cierresEjecutados = (base.cierresEjecutados || 0) + 1;
    const fecha = porDia && a.p_dia !== hoy ? new Date(`${a.p_dia}T23:59:59-05:00`).toISOString() : new Date().toISOString();
    const trans = filas.sort((x, y) => String(x.cerrada_en).localeCompare(String(y.cerrada_en)) || x.id.localeCompare(y.id)).map((o) => ({
      id: o.id, mesaId: o.mesa_id, estado: 'cerrada', items: o.items.map((i) => ({ ...i })), total: o.total, abiertaEn: o.abierta_en, cerradaEn: o.cerrada_en, version: o.version ?? 0, parcialDe: o.parcial_de ?? null,
    }));
    base.cierres.set(a.p_id, { id: a.p_id, fecha, total_ventas: total, total_ordenes: ids.length, transacciones: trans });
    if (m.cierresDia) base.cierresCambios.push({ id: base.cierresCambios.length + 1, cierre_id: a.p_id, accion: 'cierre', quien: base.yo.email, cuando: new Date().toISOString(), motivo: null, antes: {}, despues: { total, n: ids.length }, detalle: porDia ? { origen: `cerrar_dia_de ${a.p_dia}` } : {} });
    let borradas = 0;
    for (const id of [...ids, ...ya]) if (base.ordenes.delete(id)) borradas++;
    base.deltasAplicados.clear();   // (el modelo no lleva la orden de cada delta: solo importa que, cerrada la jornada, ninguna cuenta viva los espera)
    const marcados = base.deshechosTabla.filter((d) => !d.cierre_id && (!porDia || fechaBogotaFalsa(d.hecho_en) <= a.p_dia));
    for (const d of marcados) d.cierre_id = a.p_id;
    return ok({ repetido: false, n: ids.length, total, borradas, ...(porDia ? { dia: a.p_dia } : {}), cierre: { id: a.p_id, fecha, total, n: ids.length, ordenes: trans },
      deshechos: marcados.map((d) => ({ orden_id: d.orden_id, mesa_id: d.mesa_id, tipo: d.tipo, monto: d.monto, hecho_por: d.hecho_por, hecho_en: d.hecho_en })) });
  }
  if (c.nombre === 'cierre_corregir_nota') {
    // cierre_corregir_nota (20261006100000): solo admin; hasta 500 caracteres; un cierre anulado no se toca; sin cambio no deja rastro.
    if (!admin) return no('no_autorizado');
    if (!a.p_cierre_id) return no('invalido');
    const nota = String(a.p_nota ?? '').trim() || null;
    if ((nota || '').length > 500) return no('nota_larga');
    const k = base.cierres.get(a.p_cierre_id);
    if (!k) return no('no_existe');
    if (k.anulado_en) return no('anulado');
    if ((k.nota ?? null) === nota) return ok({ sin_cambio: true, cierre: { id: k.id, nota: k.nota ?? null } });
    base.cierresCambios.push({ id: base.cierresCambios.length + 1, cierre_id: k.id, accion: 'nota', quien: base.yo.email, cuando: new Date().toISOString(), motivo: null,
      antes: { total: k.total_ventas, nota: k.nota ?? null }, despues: { total: k.total_ventas, nota }, detalle: {} });
    k.nota = nota;
    return ok({ sin_cambio: false, cierre: { id: k.id, nota } });
  }
  if (c.nombre === 'cierre_anular') {
    // cierre_anular (20261006100000): solo admin; motivo de 3 a 300; el cierre se queda (anulado) y sus ventas vuelven a `ordenes` como cerradas sin archivar
    // (las que ya viven en `ordenes` no se duplican: `omitidas`); todo o nada (una mesa que no existe no deja cambiar nada).
    if (!admin) return no('no_autorizado');
    if (!a.p_cierre_id) return no('invalido');
    const motivo = String(a.p_motivo ?? '').trim();
    if (motivo.length < 3 || motivo.length > 300) return no('motivo_requerido');
    const k = base.cierres.get(a.p_cierre_id);
    if (!k) return no('no_existe');
    if (k.anulado_en) return no('ya_anulado');
    const nuevas = (k.transacciones || []).filter((t) => t && t.id && !base.ordenes.has(t.id));
    const sinMesa = nuevas.filter((t) => !base.mesas.has(t.mesaId ?? t.mesa_id)).map((t) => String(t.mesaId ?? t.mesa_id ?? '?'));
    if (sinMesa.length) return no('mesa_inexistente', { mesas: [...new Set(sinMesa)] });
    for (const t of nuevas) {
      base.ordenes.set(t.id, { id: t.id, mesa_id: t.mesaId ?? t.mesa_id, estado: 'cerrada', items: (t.items || []).map((i) => ({ ...i })), total: Number(t.total) || 0,
        abierta_en: t.abiertaEn ?? t.abierta_en ?? k.fecha, cerrada_en: t.cerradaEn ?? t.cerrada_en ?? k.fecha, version: Number(t.version) || 0, parcial_de: t.parcialDe ?? t.parcial_de ?? null, updated_at: new Date().toISOString() });
    }
    Object.assign(k, { anulado_en: new Date().toISOString(), anulado_por: base.yo.email, anulado_motivo: motivo });
    // (20261006120000) los cobros deshechos que el cierre se había llevado vuelven al turno: el siguiente cierre los toma.
    for (const d of base.deshechosTabla) if (d.cierre_id === k.id) d.cierre_id = null;
    base.cierresCambios.push({ id: base.cierresCambios.length + 1, cierre_id: k.id, accion: 'anulado', quien: base.yo.email, cuando: k.anulado_en, motivo,
      antes: { total: k.total_ventas, anulado_en: null }, despues: { total: k.total_ventas, anulado_en: k.anulado_en }, detalle: {} });
    return ok({ liberadas: nuevas.length, omitidas: (k.transacciones || []).length - nuevas.length, total: nuevas.reduce((s, t) => s + (Number(t.total) || 0), 0),
      cierre: { id: k.id, anulado_en: k.anulado_en, anulado_por: k.anulado_por, anulado_motivo: k.anulado_motivo } });
  }
  return undefined;
}

/**
 * Lo que la base le hace a las lecturas y escrituras de tablas de la ola C: la RLS de `personal` (el admin ve todo, los demás su fila), la tabla `ajustes`
 * (no existe sin su migración; solo el admin la cambia y solo las tres columnas que el POS manda) y las columnas que «aún no existen».
 * Devuelve undefined si la llamada va por el camino genérico.
 */
export function tablaOlaC(base, c) {
  // Una base sin la migración 20261002180000 no tiene `ordenes.parcial_de` ni `ordenes.deltas_ids`: leerlas da 42703 y escribir `deltas_ids`, PGRST204.
  if (c.tabla === 'ordenes' && !base.olaC.deshacer) {
    if (c.op === 'select' && c.columnas) for (const col of ['parcial_de', 'deltas_ids']) if (c.columnas.includes(col)) return { data: null, error: { code: '42703', message: `column ordenes.${col} does not exist` } };
    if (c.op === 'upsert' && [].concat(c.cuerpo).some((f) => 'deltas_ids' in f)) return { data: null, error: { code: 'PGRST204', message: "Could not find the 'deltas_ids' column of 'ordenes' in the schema cache" } };
  }
  for (const clave of base.sinColumnas) {
    const [tabla, col] = clave.split('.');
    if (c.tabla !== tabla) continue;
    if (c.op === 'select' && c.columnas && c.columnas.includes(col)) return { data: null, error: { code: '42703', message: `column ${clave} does not exist` } };
    if (c.op === 'upsert' && [].concat(c.cuerpo).some((f) => col in f)) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${col}' column of '${tabla}' in the schema cache` } };
  }
  if (c.tabla === 'personal' && c.op === 'select' && base.olaC.aprobacion) {
    if (base.fallos.has('select:personal')) return { data: null, error: { message: 'fallo inyectado en select personal' } };
    const filas = [...base.personal.values()].filter((f) => base.rol === 'admin' || f.email === base.yo.email).map((f) => ({ ...f }));
    return { data: c.unico ? (filas[0] ?? null) : filas, error: null };
  }
  if (c.tabla === 'cierres_cambios') {
    if (!base.olaC.cierresDia) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.cierres_cambios' in the schema cache" } };
    if (c.op !== 'select') return { data: null, error: { code: '42501', message: 'permission denied for table cierres_cambios' } };
    if (base.fallos.has('select:cierres_cambios')) return { data: null, error: { message: 'fallo inyectado en select cierres_cambios' } };
    let filas = base.rol === 'admin' ? base.cierresCambios.map((f) => ({ ...f })) : [];
    for (const [col, val] of c.filtros) filas = filas.filter((f) => f[col] === val);
    return { data: filas.sort((x, y) => y.id - x.id), error: null };
  }
  if (c.tabla === 'deshechos') {
    if (!base.olaC.deshacer) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.deshechos' in the schema cache" } };
    if (c.op !== 'select') return { data: null, error: { code: '42501', message: 'permission denied for table deshechos' } };
    if (base.fallos.has('select:deshechos')) return { data: null, error: { message: 'fallo inyectado en select deshechos' } };
    const filas = base.rol === 'admin' ? [...base.deshechosTabla].sort((x, y) => Date.parse(y.hecho_en) - Date.parse(x.hecho_en)).map((f) => ({ ...f })) : [];
    return { data: filas, error: null };
  }
  if (c.tabla === 'ajustes') {
    if (!(base.ajustes instanceof Map)) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.ajustes' in the schema cache" } };
    if (c.op === 'update') {
      if (base.fallos.has('update:ajustes')) return { data: null, error: { message: 'fallo inyectado en update ajustes' } };
      // `base.errorAjustes` = { code, message }: un error de la base con código (p. ej. 23514, un check de la tabla que no pasó).
      if (base.errorAjustes) return { data: null, error: base.errorAjustes };
      // Una columna que la base «aún no tiene» (migración sin aplicar): al escribirla PostgREST contesta PGRST204.
      for (const clave of base.sinColumnas) {
        const [tabla, col] = clave.split('.');
        if (tabla === 'ajustes' && col in c.cuerpo) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${col}' column of 'ajustes' in the schema cache` } };
      }
      // Las del ticket y, con la migración 20261003150000 (pago con Bre-B), las tres del pago. El GRANT de la base es de toda la tabla (lo que
      // importa lo decide la política: solo el admin); aquí se rechaza cualquier otra columna para que un nombre mal escrito no pase.
      const permitidas = ['ticket_qr_url', 'ticket_qr_visible', 'ticket_pie', 'pago_breb_visible', 'pago_breb_llave', 'pago_breb_qr'];
      if (Object.keys(c.cuerpo).some((k) => !permitidas.includes(k))) return { data: null, error: { code: '42501', message: 'permission denied for table ajustes' } };
      // UPDATE solo admin: para los demás la RLS no deja ver la fila, así que no actualiza ninguna (sin error).
      if (base.rol !== 'admin') return { data: c.retorno ? [] : null, error: null };
    }
    if (c.op === 'insert' || c.op === 'delete' || c.op === 'upsert') return { data: null, error: { code: '42501', message: 'permission denied for table ajustes' } };
    if (c.op === 'select' && !base.rol) return { data: c.unico ? null : [], error: null };
  }
  return undefined;
}

/**
 * Las RPC de la cola de impresión que el POS llama (migración cola_impresion):
 *   impresora_estado()            → [{ id, nombre, en_linea, ultimo_latido, version_agente }] (null si la cola no existe en esta base)
 *   impresora_crear / _rotar      → { id, token } solo admin (un mesero recibe 42501); el token es inventado y se devuelve UNA vez
 *   impresion_cancelar(p_id)      → { ok: true } (pendiente, o imprimiendo con `trabado: true` = más de 2 min sin confirmar → error «cancelada»)
 *                                   | { ok: false, codigo: 'no_existe' | 'no_pendiente', estado }
 * Devuelve undefined si no es una de ellas. `base.colaAusente` o `base.sinFuncion` las hacen «no existir» como PostgREST.
 */
export function rpcCaja(base, c) {
  if (!['impresora_estado', 'impresora_crear', 'impresora_rotar', 'impresion_cancelar'].includes(c.nombre)) return undefined;
  const a = c.args || {};
  if (base.colaAusente || base.sinFuncion.has(c.nombre)) {
    return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${c.nombre} in the schema cache` } };
  }
  if (base.fallos.has(`rpc:${c.nombre}`)) return { data: null, error: { message: 'fallo inyectado' } };
  if (c.nombre === 'impresion_cancelar') {
    const fila = base.impresiones.get(a.p_id);
    if (!fila) return { data: { ok: false, codigo: 'no_existe' }, error: null };
    if (fila.estado !== 'pendiente' && !(fila.estado === 'imprimiendo' && fila.trabado)) return { data: { ok: false, codigo: 'no_pendiente', estado: fila.estado }, error: null };
    Object.assign(fila, { estado: 'error', error: 'cancelada' });
    return { data: { ok: true }, error: null };
  }
  if (c.nombre === 'impresora_estado') {
    return { data: base.impresoras ? base.impresoras.map(({ token, ...p }) => ({ ...p })) : null, error: null };
  }
  if (base.rol !== 'admin') return { data: null, error: { code: '42501', message: 'permission denied for function impresora' } };
  base.impresoras ||= [];
  let fila;
  if (c.nombre === 'impresora_crear') {
    fila = { id: `impresora-${base.impresoras.length + 1}`, nombre: String(a.p_nombre ?? '').trim(), en_linea: false, ultimo_latido: null, version_agente: '' };
    base.impresoras.push(fila);
  } else {
    fila = base.impresoras.find((p) => p.id === a.p_id);
    if (!fila) return { data: { ok: false, codigo: 'no_existe' }, error: null };
  }
  fila.token = `token-falso-${String(++base.contadorCaja).padStart(2, '0')}abcdef0123456789abcdef0123456789`;
  return { data: { id: fila.id, token: fila.token }, error: null };
}

/** Una fila de `alertas` como la devuelve la base. */
export const alertaBase = (id, mesaId, ordenId, metodo = 'qr', creada = '2026-09-30T18:30:00Z', estado = 'pendiente') => ({
  id, mesa_id: mesaId, orden_id: ordenId, tipo: 'pedir_cuenta', metodo, estado, creada_en: creada,
  atendida_en: estado === 'pendiente' ? null : creada, atendida_por: estado === 'pendiente' ? null : 'alguien@ejemplo.test',
});

// ───────────────────────── el store `pos` en un vm ─────────────────────────

/**
 * Un store `pos` recién creado, con sus dependencias simuladas. `base` (de crearBaseFalsa) o
 * `responder` deciden qué contesta Supabase. `almacen` (un Map) deja compartir el localStorage entre
 * dos stores: así se simula recargar la página.
 */
export function crearPos({ responder, base, almacen = new Map(), extras = {}, documento = {} } = {}) {
  // `base.responder` se lee en cada llamada (no una vez): una prueba puede envolverlo después de crear el POS (latencias, ecos de Realtime en medio de una RPC).
  const supabase = crearSupabase({ responder: base ? (c) => base.responder(c) : responder });
  const avisos = [];
  const confirmaciones = [];
  const consola = [];
  const manejadores = {};
  const oyentes = { ventana: {}, documento: {} };   // TODOS los oyentes por evento (manejadores / eventosVentana guardan solo el último)
  const tiendas = {};
  const estado = { confirmar: true };
  const caja = {
    console: { log() {}, info() {}, debug() {}, warn: (...a) => consola.push(['warn', ...a]), error: (...a) => consola.push(['error', ...a]) },
    setTimeout, clearTimeout, setInterval() {}, clearInterval() {},
    crypto: globalThis.crypto,
    URL, URLSearchParams, Date, Math, JSON, Promise, Array, Object, Set, Map,
    AbortController, TextDecoder,   // Web NFC (pegatinas) y su lectura
    localStorage: {
      getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => { almacen.set(k, String(v)); },
      removeItem: (k) => { almacen.delete(k); },
    },
    confirm: (m) => { confirmaciones.push(String(m)); return estado.confirmar; },
    alert: (m) => { avisos.push(String(m)); },
    prompt() { return null; },
    navigator: {},
    location: { origin: 'https://resplandor.ynt.codes', search: '', hash: '', pathname: '/pos.html' },
    history: { replaceState() {} },
    document: {
      // Con `{ signal }` el oyente se suelta cuando el signal se aborta (como en un navegador) y no pisa a `manejadores`, que guarda los de arranque.
      addEventListener: (nombre, fn, opciones) => {
        const senal = opciones && typeof opciones === 'object' ? opciones.signal : null;
        if (!senal) manejadores[nombre] = fn;
        (oyentes.documento[nombre] ||= []).push(fn);
        if (senal) senal.addEventListener('abort', () => { const l = oyentes.documento[nombre]; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }, { once: true });
      },
    },
    Alpine: { store: (nombre, obj) => { if (obj) tiendas[nombre] = obj; return tiendas[nombre]; } },
  };
  Object.assign(caja, extras);          // globales de más (AudioContext, navigator.vibrate, setInterval espía…)
  Object.assign(caja.document, documento);   // document.title, visibilityState…
  caja.window = caja;
  caja.globalThis = caja;
  caja.window.supabase = { createClient: () => supabase.cliente };
  const eventosVentana = {};
  caja.window.addEventListener = (nombre, fn) => { eventosVentana[nombre] = fn; (oyentes.ventana[nombre] ||= []).push(fn); };
  vm.createContext(caja);
  vm.runInContext(scriptDelStore(), caja, { filename: 'pos.html (script del store)' });
  assert.equal(typeof manejadores['alpine:init'], 'function', 'el script debe registrar su store en alpine:init');
  manejadores['alpine:init']();
  const pos = tiendas.pos;
  assert.ok(pos, 'alpine:init no registró el store «pos»');
  return {
    pos, supabase, almacen, avisos, confirmaciones, consola, eventosVentana, eventosDocumento: manejadores, oyentes, caja,
    cancelarConfirmaciones() { estado.confirmar = false; },
    guardado: (clave) => JSON.parse(almacen.get(clave)),
  };
}

// ───────────────────────── filas de ejemplo ─────────────────────────

export const TOKEN = 'a'.repeat(48);
export const item = (id, precio, qty = 1) => ({ id, nombre: id, precio, qty, nota: '' });
/** Una fila de `mesas` como la devuelve la base. */
export const mesaBase = (id = 3, extra = {}) => ({ id, capacidad: 4, estado: 'ocupada', token: TOKEN, updated_at: '2026-09-30T00:00:00Z', ...extra });
/** Una fila de `ordenes` como la devuelve la base. */
export const ordenBase = (id, mesaId, items, version = 1, estado = 'abierta') => ({
  id, mesa_id: mesaId, estado, items, total: items.reduce((s, i) => s + i.precio * i.qty, 0),
  abierta_en: '2026-09-30T18:00:00Z', cerrada_en: estado === 'cerrada' ? new Date().toISOString() : null, version,
});
/** Una orden como la guarda el POS en local (camelCase). */
export const ordenLocal = (id, mesaId, items, version = 1, estado = 'abierta') => ({
  id, mesaId, estado, items, total: items.reduce((s, i) => s + i.precio * i.qty, 0),
  abiertaEn: '2026-09-30T18:00:00Z', cerradaEn: estado === 'cerrada' ? new Date().toISOString() : null, version,
});
export const delta = (orden, itemId, d, precio = 4000) => ({ orden_id: orden, item_id: itemId, nombre: itemId, precio, nota: '', delta: d });
