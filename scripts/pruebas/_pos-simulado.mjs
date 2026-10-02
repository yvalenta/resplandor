// Arnés del POS (pos.html): lo abre en Chromium con Supabase SIMULADO y datos ficticios, sin
// login real, y lleva la página a cada vista y a cada modal. Sirve para ver el POS sin tocar
// la base real (capturas antes/después de un cambio visual, pruebas de desborde, etc.).
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre
// como prueba. Lo usa scripts/capturas-pos.mjs y puede importarlo cualquier prueba nueva.
//
// Cómo funciona
//   - pos.html carga supabase-js desde assets/vendor/ (supabase-js-<versión>.umd.js) con una
//     etiqueta <script> síncrona. Aquí esa ruta se intercepta (page.route) y se contesta con un
//     stub de `window.supabase.createClient` (con `stubSupabase: false` pasa el archivo real):
//     auth (getSession / onAuthStateChange / signInWithOAuth / signOut), from(tabla) encadenable
//     (select / insert / upsert / update / delete / eq / in / order / limit / maybeSingle) sobre
//     tablas en memoria, rpc (aplicar_delta_orden y actualizar_nota_item hacen lo que hace la
//     base) y channel(...).on().subscribe() / track() / presenceState(). Nada sale a la red:
//     cualquier host que no sea el local o una fuente de Google se aborta y queda anotado en
//     `diag.bloqueadas`. Eso incluye cdn.tailwindcss.com, jsdelivr y unpkg: pos.html ya no
//     depende de ellos, y si volviera a pedirlos aparecerían ahí.
//   - Tailwind, Alpine, Lucide y supabase-js son archivos locales de versión fija
//     (assets/vendor/, ver su README), servidos por el propio servidor del arnés: «antes» y
//     «después» usan exactamente los mismos. Solo las fuentes de Google vienen de su host, y se
//     guardan en disco la primera vez (`dirCache`); con `bloquearFuentes: true` ni eso sale.
//   - El reloj queda fijo en FECHA_FIJA (miércoles 30 de septiembre de 2026, 13:30 en Bogotá) y
//     window.print es un no-op (cuenta las llamadas en window.__posImpresiones): las horas, el
//     «hoy» del cierre y la semana del menú son siempre las mismas.
//   - El estado vive en `window.__posSim`: tablas (las filas tal como las devolvería Postgres),
//     llamadas (bitácora de todo lo que el POS le pidió a Supabase, útil para comprobar que un
//     cambio visual no movió ninguna llamada), presencia, y emitirCambio(tabla, evento) para
//     simular Realtime.
//
// Uso mínimo (Node ≥ 20 y un Chromium, ver _navegador.mjs):
//   const { chromium } = buscarPlaywright();
//   const servidor = await servirPos(RAIZ);
//   const navegador = await chromium.launch();
//   const contexto = await nuevoContexto(navegador, { ancho: 1440, alto: 900 });   // o { ancho: 390, alto: 844, movil: true }
//   const page = await contexto.newPage();
//   const { diag } = await abrirPos(page, { url: servidor.url, vista: 'orden' });
//   // …medir o capturar…; diag.errores trae lo que la consola del POS marcó como error.
//
// Para agregar una vista nueva basta una entrada más en VISTAS (ver el formato abajo).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// ───────────────────────────────────── constantes ─────────────────────────────────────

/** «Ahora» de toda la simulación: miércoles 30 de septiembre de 2026, 13:30 en Bogotá. */
export const FECHA_FIJA = '2026-09-30T13:30:00-05:00';
export const ZONA = 'America/Bogota';
export const PUERTO_FIJO = 4173;
/** Lunes de la semana de FECHA_FIJA: es la `semana` de las filas de `menus`. */
export const SEMANA = '2026-09-28';

const HOY = '2026-09-30';
const AYER = '2026-09-29';
const ANTEAYER = '2026-09-28';
const hora = (hhmm, dia = HOY) => `${dia}T${hhmm}:00-05:00`;

/**
 * Únicos hosts externos que pos.html todavía pide: la tipografía (si fallan, cae a la fuente de
 * respaldo). Se cachean en disco. Los scripts ya no salen de ningún CDN (assets/vendor/).
 */
const HOSTS_FUENTES = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
/** La ruta local de supabase-js (pos.html la pide como <script src="assets/vendor/supabase-js-<v>.umd.js">). */
const RUTA_SUPABASE_JS = /^\/assets\/vendor\/supabase-js-[\d.]+\.umd\.js$/;

const avatar = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#3F6D72"/><text x="24" y="31" font-size="22" text-anchor="middle" fill="#FBF4E9" font-family="sans-serif">M</text></svg>');

/** Usuario ficticio: el POS solo mira user_metadata.full_name / avatar_url y el correo. */
export const SESION_FALSA = {
  access_token: 'token-falso-solo-para-pruebas',
  refresh_token: 'refresco-falso',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 1790000000,
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'mesero.demo@ejemplo.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Mesero Demo', avatar_url: avatar },
  },
};

// ───────────────────────────────────── datos ficticios ─────────────────────────────────────

const it = (id, nombre, precio, qty, nota = '') => ({ id, nombre, precio, qty, nota });
const sumar = (items) => items.reduce((s, i) => s + i.precio * i.qty, 0);
const tokenDe = (id) => Array.from({ length: 24 }, (_, i) => ((id * 37 + i * 91 + 13) % 256).toString(16).padStart(2, '0')).join('');

/**
 * Datos ficticios con la forma de las filas de Postgres (snake_case), que es lo que el POS
 * espera de Supabase. `ajustar(datos)` puede mutarlos antes de entregarlos (devuelve un clon).
 * Todo es inventado: ni un dato real de la carta, de las cuentas ni de los cierres.
 */
export function datosFicticios(ajustar) {
  const mesas = [2, 4, 4, 6, 2, 4, 4, 6, 2, 4].map((capacidad, i) => ({
    id: i + 1, capacidad, estado: [3, 6].includes(i + 1) ? 'ocupada' : 'libre', token: tokenDe(i + 1),
  }));

  const productos = [
    ['ej1', 'Ejecutivos', 'Ejecutivo de la casa', 21000, 'Sopa o frijol, proteína, arroz, ensalada y jugo'],
    ['ej2', 'Ejecutivos', 'Seco con proteína', 18000, 'A elección: res, cerdo o chicharrón'],
    ['en1', 'Entradas', 'Empanadas de la casa', 16000, '3 uds con ají de maní y limón'],
    ['en2', 'Entradas', 'Arepitas con hogao', 11000, '3 uds con hogao y queso costeño'],
    ['en3', 'Entradas', 'Patacones rellenos', 19000, '3 uds con pollo desmechado, guacamole y suero'],
    ['pf1', 'Platos Fuertes', 'Bandeja del patio', 46000, 'Frijoles, arroz, plátano maduro, chorizo, huevo, aguacate, arepa, chicharrón y hogao'],
    ['pf2', 'Platos Fuertes', 'Churrasco 250 g', 52000, 'Con papa criolla en salsa de cilantro y ensalada'],
    ['pf3', 'Platos Fuertes', 'Pechuga a la plancha', 36000, 'Con arroz de coco, patacón y ensalada fresca'],
    ['pf4', 'Platos Fuertes', 'Salmón al horno', 68000, 'Costra de hierbas, puré de papa y vegetales salteados'],
    ['be1', 'Bebidas', 'Limonada de coco', 13000, 'Cremosa, con hielo frappé'],
    ['be2', 'Bebidas', 'Jugo natural', 9000, 'Sujeto a disponibilidad'],
    ['be3', 'Bebidas', 'Cóctel de la casa', 32000, 'Cóctel firma, sin repetir dos días seguidos'],
  ].map(([id, categoria, nombre, precio, descripcion]) => ({ id, categoria, nombre, precio, descripcion, activo: true }));

  // Cuentas abiertas: mesa 3 con 3 ítems (uno con nota de variante) y mesa 6 con 2.
  const items3 = [it('ej1__sopa-pollo', 'Ejecutivo de la casa', 21000, 2, 'Sopa · Pollo'), it('en1', 'Empanadas de la casa', 16000, 1), it('be1', 'Limonada de coco', 13000, 3)];
  const items6 = [it('pf2', 'Churrasco 250 g', 52000, 1), it('be2', 'Jugo natural', 9000, 2)];
  const cuenta = (id, mesa, estado, abre, cierra, items, version) => ({
    id, mesa_id: mesa, estado, items, total: sumar(items), abierta_en: abre, cerrada_en: cierra, version, updated_at: cierra || abre,
  });
  const ordenes = [
    cuenta('ord-abierta-3', 3, 'abierta', hora('12:42'), null, items3, 4),
    cuenta('ord-abierta-6', 6, 'abierta', hora('13:05'), null, items6, 3),
    // Cerradas hoy: alimentan «Transacciones del turno» (la primera es de la mesa 3, hoy ocupada).
    cuenta('ord-hoy-1', 3, 'cerrada', hora('11:20'), hora('12:31'), [it('pf3', 'Pechuga a la plancha', 36000, 2), it('be1', 'Limonada de coco', 13000, 2, 'Sin azúcar')], 2),
    cuenta('ord-hoy-2', 2, 'cerrada', hora('12:00'), hora('13:10'), [it('ej2__res', 'Seco con proteína', 18000, 3, 'Res'), it('be2', 'Jugo natural', 9000, 3)], 2),
    cuenta('ord-hoy-3', 5, 'cerrada', hora('12:15'), hora('13:20'), [it('pf4', 'Salmón al horno', 68000, 1), it('en3', 'Patacones rellenos', 19000, 1), it('be3', 'Cóctel de la casa', 32000, 2)], 2),
  ];

  // Cierres: el de ayer con las transacciones en camelCase (lo que guarda el POS hoy) y el de
  // anteayer en snake_case (lo que traen los cierres viejos); la vista lee los dos.
  const transaccion = (o) => ({ id: o.id, mesaId: o.mesa_id, estado: 'cerrada', items: o.items, total: o.total, abiertaEn: o.abierta_en, cerradaEn: o.cerrada_en });
  const ayer = [
    cuenta('ord-ayer-1', 4, 'cerrada', hora('12:10', AYER), hora('13:25', AYER), [it('pf1', 'Bandeja del patio', 46000, 4), it('be1', 'Limonada de coco', 13000, 4)], 2),
    cuenta('ord-ayer-2', 1, 'cerrada', hora('13:00', AYER), hora('13:50', AYER), [it('ej1__frijol-res', 'Ejecutivo de la casa', 21000, 2, 'Frijol · Res')], 2),
    cuenta('ord-ayer-3', 8, 'cerrada', hora('19:30', AYER), hora('21:15', AYER), [it('pf2', 'Churrasco 250 g', 52000, 2), it('pf3', 'Pechuga a la plancha', 36000, 1), it('be3', 'Cóctel de la casa', 32000, 3)], 2),
  ].map(transaccion);
  const anteayer = [
    { id: 'ord-ant-1', mesa_id: 2, estado: 'cerrada', items: [it('ej2__cerdo', 'Seco con proteína', 18000, 2, 'Cerdo')], total: 36000, abierta_en: hora('12:20', ANTEAYER), cerrada_en: hora('13:05', ANTEAYER) },
    { id: 'ord-ant-2', mesa_id: 7, estado: 'cerrada', items: [it('en2', 'Arepitas con hogao', 11000, 2), it('be2', 'Jugo natural', 9000, 2)], total: 40000, abierta_en: hora('18:40', ANTEAYER), cerrada_en: hora('19:35', ANTEAYER) },
  ];
  const cierres = [
    { id: 'cierre-ayer', fecha: hora('22:10', AYER), total_ventas: ayer.reduce((s, o) => s + o.total, 0), total_ordenes: ayer.length, transacciones: ayer },
    { id: 'cierre-anteayer', fecha: hora('22:05', ANTEAYER), total_ventas: 76000, total_ordenes: anteayer.length, transacciones: anteayer },
  ];

  // Menú semanal: 6 días × 3 opciones (la 3 es el especial fijo, sin votación).
  const principales = ['Sobrebarriga en salsa criolla', 'Pollo guisado con papas', 'Cerdo en salsa de tamarindo', 'Albóndigas en salsa de tomate', 'Pescado frito con patacón', 'Carne asada con chimichurri', 'Sudado de pollo', 'Lengua en salsa', 'Costilla BBQ con yuca', 'Pechuga gratinada', 'Res desmechada criolla', 'Muslos al horno con limón'];
  const sopas = ['Ajiaco', 'Sancocho de gallina', 'Crema de ahuyama', 'Mondongo', 'Sopa de verduras', 'Caldo de costilla'];
  const guarniciones = ['Arroz + papa criolla', 'Arroz + plátano maduro', 'Arroz + yuca frita', 'Arroz + ensalada de papa'];
  const ensaladas = ['Aguacate y tomate', 'Repollo y zanahoria', 'Lechuga y pepino'];
  const jugos = ['Lulo', 'Mora', 'Maracuyá', 'Limonada', 'Guanábana', 'Tomate de árbol'];
  const menus = [];
  for (let d = 1; d <= 6; d++) {
    for (let o = 1; o <= 3; o++) {
      const k = (d - 1) * 2 + (o - 1);
      menus.push(o === 3
        ? { id: `menu-${d}-3`, semana: SEMANA, dia: d, opcion: 3, etiqueta: 'Especial de la casa', principal: 'Frijolada de la casa (res, cerdo o pollo a elección)', sopa: '', guarnicion: 'Arroz + tajadas + aguacate', ensalada: '', jugo: 'Panela con limón', fijo: true, activo: true }
        : { id: `menu-${d}-${o}`, semana: SEMANA, dia: d, opcion: o, etiqueta: `Opción ${o}`, principal: principales[k], sopa: sopas[(d + o) % sopas.length], guarnicion: guarniciones[k % guarniciones.length], ensalada: ensaladas[k % ensaladas.length], jugo: jugos[(d + o * 2) % jugos.length], fijo: false, activo: !(d === 1 && o === 2) });
    }
  }
  const mover = (menu_id, dia_sugerido, comentario) => ({ menu_id, tipo: 'mover', dia_sugerido, comentario });
  const reacciones_menu = [mover('menu-1-1', 5, 'Mejor el viernes, hay más gente'), mover('menu-1-1', 3, ''), mover('menu-3-2', 6, 'Para el sábado en familia'), mover('menu-5-1', 2, '')];
  const elecciones_menu = [[1, 1], [1, 1], [1, 2], [2, 1], [2, 2], [2, 2], [2, 2], [3, 1], [4, 2], [4, 2], [5, 1], [5, 1], [5, 2], [6, 1]]
    .map(([dia, opcion_elegida]) => ({ semana: SEMANA, dia, opcion_elegida }));
  const sugerencias_plato = [
    { id: 'sug-1', semana: SEMANA, dia: 2, texto: 'Un sudado de pescado, por favor', created_at: hora('09:12', AYER) },
    { id: 'sug-2', semana: SEMANA, dia: null, texto: 'Postre del día para acompañar el ejecutivo', created_at: hora('10:40', ANTEAYER) },
    { id: 'sug-3', semana: SEMANA, dia: 5, texto: 'Mondongo los viernes', created_at: hora('08:05', ANTEAYER) },
  ];

  const datos = {
    // `tablas` son las que contesta el stub de Supabase; `presencia` es lo que devuelve presenceState().
    tablas: { mesas, ordenes, productos, cierres, menus, reacciones_menu, elecciones_menu, sugerencias_plato },
    presencia: [],
  };
  const clon = JSON.parse(JSON.stringify(datos));
  if (ajustar) ajustar(clon);
  return clon;
}

// ───────────────────────────── el stub de supabase-js (corre EN la página) ─────────────────────────────

/**
 * Cuerpo del stub. Se serializa con toString() y corre dentro de la página, así que NO puede
 * usar nada de este módulo: solo sus dos argumentos.
 */
function instalarSupabaseSimulado(DATOS, CFG) {
  const clonar = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const tablas = clonar(DATOS.tablas);
  const sim = (window.__posSim = { tablas, llamadas: [], sesion: CFG.sesion ? clonar(CFG.sesion) : null, presencia: clonar(DATOS.presencia || []), canales: [], cliente: null });
  const anotar = (tipo, detalle) => sim.llamadas.push(Object.assign({ tipo }, clonar(detalle || {})));
  const igual = (a, b) => a === b || (a != null && b != null && String(a) === String(b));
  const comparar = (a, b) => (a == null && b == null ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);

  class Consulta {
    constructor(tabla) { this.tabla = tabla; this.op = 'select'; this.cols = '*'; this.filtros = []; this.orden = []; this.tope = null; this.carga = null; this.opciones = {}; this.unico = null; this.devolver = false; }
    select(cols) { if (this.op === 'select') this.cols = cols || '*'; else this.devolver = true; return this; }
    insert(carga, opciones) { this.op = 'insert'; this.carga = carga; this.opciones = opciones || {}; return this; }
    upsert(carga, opciones) { this.op = 'upsert'; this.carga = carga; this.opciones = opciones || {}; return this; }
    update(carga) { this.op = 'update'; this.carga = carga; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filtros.push({ t: 'eq', c, v }); return this; }
    in(c, v) { this.filtros.push({ t: 'in', c, v }); return this; }
    order(c, o) { this.orden.push({ c, asc: !(o && o.ascending === false) }); return this; }
    limit(n) { this.tope = n; return this; }
    maybeSingle() { this.unico = 'maybe'; return this; }
    single() { this.unico = 'single'; return this; }
    then(ok, mal) { return Promise.resolve().then(() => this.ejecutar()).then(ok, mal); }
    ejecutar() {
      const filas = (tablas[this.tabla] = tablas[this.tabla] || []);
      const cumple = (r) => this.filtros.every((f) => (f.t === 'eq' ? igual(r[f.c], f.v) : f.v.some((x) => igual(r[f.c], x))));
      anotar('db.' + this.op, { tabla: this.tabla, filtros: this.filtros, carga: this.carga, opciones: this.opciones });
      let tocadas = [];
      if (this.op === 'insert') {
        // La cola de impresión: la base le pone id, estado «pendiente» y fecha (sim.impresionFalla = el error que la base devolvería).
        if (this.tabla === 'impresiones' && sim.impresionFalla) return { data: null, error: clonar(sim.impresionFalla) };
        (Array.isArray(this.carga) ? this.carga : [this.carga]).forEach((f) => {
          const c = clonar(f);
          if (this.tabla === 'impresiones') Object.assign(c, Object.assign({ id: 'impresion-' + (++sim.contadorCaja), estado: 'pendiente', intentos: 0, error: null, creada_en: new Date().toISOString() }, c));
          filas.push(c); tocadas.push(c);
        });
      } else if (this.op === 'upsert') {
        const claves = String(this.opciones.onConflict || 'id').split(',').map((s) => s.trim());
        (Array.isArray(this.carga) ? this.carga : [this.carga]).forEach((f) => {
          const i = filas.findIndex((r) => claves.every((k) => igual(r[k], f[k])));
          if (i >= 0) { Object.assign(filas[i], clonar(f)); tocadas.push(filas[i]); } else { const c = clonar(f); filas.push(c); tocadas.push(c); }
        });
      } else if (this.op === 'update') {
        tocadas = filas.filter(cumple); tocadas.forEach((r) => Object.assign(r, clonar(this.carga)));
      } else if (this.op === 'delete') {
        tocadas = filas.filter(cumple);
        for (let i = filas.length - 1; i >= 0; i--) if (cumple(filas[i])) filas.splice(i, 1);
      }
      if (this.op !== 'select' && !this.devolver) return { data: null, error: null };

      let r = this.op === 'select' ? filas.filter(cumple) : tocadas;
      if (this.orden.length) r = r.slice().sort((a, b) => { for (const o of this.orden) { const c = comparar(a[o.c], b[o.c]); if (c) return o.asc ? c : -c; } return 0; });
      if (this.tope != null) r = r.slice(0, this.tope);
      if (this.cols !== '*') { const cs = String(this.cols).split(',').map((s) => s.trim()).filter(Boolean); r = r.map((f) => Object.fromEntries(cs.map((c) => [c, f[c]]))); }
      r = clonar(r);
      if (this.unico) {
        if (r.length > 1 || (!r.length && this.unico === 'single')) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        return { data: r[0] || null, error: null };
      }
      return { data: r, error: null };
    }
  }

  // Lo que hacen en la base las dos funciones que usa el POS (lo justo para que la UI vea el mismo resultado).
  const aplicarRpc = (nombre, a) => {
    const orden = (tablas.ordenes || []).find((o) => o.id === a.p_orden_id);
    if (!orden) return;
    if (nombre === 'aplicar_delta_orden') {
      const i = orden.items.findIndex((x) => x.id === a.p_item_id);
      if (i < 0) { if (a.p_delta > 0) orden.items.push({ id: a.p_item_id, nombre: a.p_nombre, precio: a.p_precio, qty: a.p_delta, nota: a.p_nota || '' }); }
      else { orden.items[i].qty += a.p_delta; if (orden.items[i].qty <= 0) orden.items.splice(i, 1); }
      orden.total = orden.items.reduce((s, x) => s + x.precio * x.qty, 0);
      orden.version = (orden.version || 0) + 1;
    } else if (nombre === 'actualizar_nota_item') {
      const x = orden.items.find((y) => y.id === a.p_item_id);
      if (x) x.nota = a.p_nota;
    }
  };

  // Roles, alertas y personal (ola B1): lo que contestan en la base mi_rol(), atender/descartar_alerta y
  // personal_alta/baja/cambiar_rol (jsonb {ok, …} | {ok:false, codigo}, solo admin, nunca cero admins). El rol que
  // «tiene» la sesión es `DATOS.rol` ('admin' por defecto, 'mesero', o null = la cuenta no está en `personal`).
  sim.rol = DATOS.rol === undefined ? 'admin' : DATOS.rol;
  const rpcRolesAlertas = (nombre, a) => {
    const ok = (extra) => ({ data: Object.assign({ ok: true }, extra), error: null });
    const no = (codigo, extra) => ({ data: Object.assign({ ok: false, codigo }, extra), error: null });
    // `DATOS.fallarMiRol`: el servidor no contesta (un 5xx): sin red no se sabe el rol (accesoSinComprobar si la tablet no tiene uno confirmado).
    if (nombre === 'mi_rol') return DATOS.fallarMiRol ? { data: null, error: { message: 'Internal Server Error' } } : { data: sim.rol, error: null };
    if (nombre === 'atender_alerta' || nombre === 'descartar_alerta') {
      if (!sim.rol) return no('no_autorizado');
      const fila = (tablas.alertas || []).find((x) => igual(x.id, a.p_id));
      if (!fila) return no('no_existe');
      if (fila.estado !== 'pendiente') return no('no_pendiente', { estado: fila.estado });
      fila.estado = nombre === 'atender_alerta' ? 'atendida' : 'descartada';
      fila.atendida_en = new Date().toISOString();
      fila.atendida_por = sim.sesion && sim.sesion.user ? sim.sesion.user.email : 'sistema';
      return ok({ alerta: clonar(fila) });
    }
    if (nombre === 'personal_alta' || nombre === 'personal_baja' || nombre === 'personal_cambiar_rol') {
      if (sim.rol !== 'admin') return no('no_autorizado');
      const lista = (tablas.personal = tablas.personal || []);
      const email = String(a.p_email == null ? '' : a.p_email).trim().toLowerCase();
      const fila = lista.find((p) => p.email === email);
      const admins = () => lista.filter((p) => p.rol === 'admin' && p.activo !== false).length;
      if (nombre === 'personal_alta') {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return no('correo_invalido');
        if (a.p_rol !== 'admin' && a.p_rol !== 'mesero') return no('rol_invalido');
        if (fila && fila.activo !== false) return no('ya_existe');
        const nueva = { email, nombre: String(a.p_nombre || '').trim(), rol: a.p_rol, activo: true, creado_en: new Date().toISOString() };
        if (fila) Object.assign(fila, nueva); else lista.push(nueva);
        return ok({ personal: clonar(nueva) });
      }
      if (!fila) return no('no_existe');
      if (fila.activo === false) return no('inactivo');
      if (nombre === 'personal_baja') {
        if (fila.rol === 'admin' && admins() <= 1) return no('ultimo_admin');
        fila.activo = false;
        return ok({ personal: clonar(fila) });
      }
      if (a.p_rol !== 'admin' && a.p_rol !== 'mesero') return no('rol_invalido');
      if (fila.rol === 'admin' && a.p_rol !== 'admin' && admins() <= 1) return no('ultimo_admin');
      fila.rol = a.p_rol;
      return ok({ personal: clonar(fila) });
    }
    return undefined;
  };

  // Cola de impresión de la caja (migración cola_impresion): lo que contestan impresora_estado / impresora_crear / impresora_rotar.
  // `DATOS.impresoras` (lista) enciende la cola; sin ella impresora_estado contesta null y el POS no ofrece imprimir en la caja.
  // El token es inventado y sale UNA vez, como en la base. sim.imprimirAhora(id, estado, error) hace de agente: cambia la fila y avisa por Realtime.
  sim.impresoras = DATOS.impresoras ? clonar(DATOS.impresoras) : null;
  sim.impresionFalla = DATOS.impresionFalla || null;
  sim.contadorCaja = 0;
  sim.imprimirAhora = (id, estado, error) => {
    const fila = (tablas.impresiones || []).find((x) => igual(x.id, id));
    const antes = clonar(fila);
    Object.assign(fila, { estado, error: error || null });
    if (estado === 'imprimiendo') fila.intentos = (fila.intentos || 0) + 1;
    sim.emitirCambio('impresiones', { eventType: 'UPDATE', new: clonar(fila), old: antes });
  };
  const rpcCaja = (nombre, a) => {
    if (nombre === 'impresora_estado') return { data: sim.impresoras ? clonar(sim.impresoras.map(({ token, ...p }) => p)) : null, error: null };
    if (nombre !== 'impresora_crear' && nombre !== 'impresora_rotar') return undefined;
    if (sim.rol !== 'admin') return { data: null, error: { code: '42501', message: 'permission denied for function ' + nombre } };
    sim.impresoras = sim.impresoras || [];
    let fila;
    if (nombre === 'impresora_crear') {
      fila = { id: 'impresora-' + (sim.impresoras.length + 1), nombre: String(a.p_nombre || '').trim(), en_linea: false, ultimo_latido: null, version_agente: '' };
      sim.impresoras.push(fila);
    } else {
      fila = sim.impresoras.find((p) => igual(p.id, a.p_id));
      if (!fila) return { data: { ok: false, codigo: 'no_existe' }, error: null };
    }
    fila.token = 'token-falso-' + String(++sim.contadorCaja).padStart(2, '0') + 'abcdef0123456789abcdef0123456789';
    return { data: { id: fila.id, token: fila.token }, error: null };
  };

  const oyentesAuth = [];
  const cliente = {
    auth: {
      getSession: async () => ({ data: { session: clonar(sim.sesion) }, error: null }),
      getUser: async () => ({ data: { user: sim.sesion ? clonar(sim.sesion.user) : null }, error: null }),
      onAuthStateChange(cb) {
        oyentesAuth.push(cb);
        setTimeout(() => cb('INITIAL_SESSION', clonar(sim.sesion)), 0);
        return { data: { subscription: { unsubscribe() { const i = oyentesAuth.indexOf(cb); if (i >= 0) oyentesAuth.splice(i, 1); } } } };
      },
      async signInWithOAuth(args) { anotar('auth.signInWithOAuth', { args }); return { data: { provider: args && args.provider, url: null }, error: null }; },
      async signOut() { anotar('auth.signOut'); sim.sesion = null; oyentesAuth.slice().forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; },
    },
    from: (tabla) => new Consulta(tabla),
    rpc: (nombre, args) => ({
      then(ok, mal) { return Promise.resolve().then(() => { anotar('rpc', { nombre, args }); aplicarRpc(nombre, args || {}); return rpcRolesAlertas(nombre, args || {}) || rpcCaja(nombre, args || {}) || { data: null, error: null }; }).then(ok, mal); },
    }),
    channel(nombre, config) {
      const manejadores = [];
      let propio = null;
      const emitirSync = () => manejadores.filter((h) => h.tipo === 'presence' && h.filtro && h.filtro.event === 'sync').forEach((h) => h.cb({}));
      const canal = {
        nombre, config, manejadores,
        on(tipo, filtro, cb) { manejadores.push({ tipo, filtro, cb }); return canal; },
        subscribe(cb) { anotar('channel.subscribe', { nombre }); setTimeout(() => { if (cb) cb('SUBSCRIBED'); emitirSync(); }, 0); return canal; },
        track(carga) { propio = clonar(carga); anotar('channel.track', { nombre, carga }); setTimeout(emitirSync, 0); return Promise.resolve('ok'); },
        untrack() { propio = null; return Promise.resolve('ok'); },
        unsubscribe() { return Promise.resolve('ok'); },
        presenceState() {
          const m = {};
          sim.presencia.concat(propio ? [propio] : []).forEach((e) => { (m[e.deviceId] = m[e.deviceId] || []).push(clonar(e)); });
          return m;
        },
      };
      sim.canales.push(canal);
      return canal;
    },
    removeChannel(canal) { const i = sim.canales.indexOf(canal); if (i >= 0) sim.canales.splice(i, 1); return Promise.resolve('ok'); },
    functions: { invoke: async (nombre, opciones) => { anotar('functions.invoke', { nombre, opciones }); return { data: null, error: null }; } },
  };
  // Realtime a mano: sim.emitirCambio('ordenes', { eventType: 'UPDATE', new: {...}, old: {...} }).
  sim.emitirCambio = (tabla, evento) => sim.canales.forEach((c) => c.manejadores.forEach((h) => { if (h.tipo === 'postgres_changes' && h.filtro && h.filtro.table === tabla) h.cb(evento); }));

  window.supabase = { createClient(url, clave, opciones) { sim.cliente = { url, opciones: clonar(opciones) }; return cliente; } };
}

/** El archivo JS que se sirve en lugar de supabase-js. */
export function scriptSupabase(datos, { sesion = true } = {}) {
  return `/* supabase-js SIMULADO (scripts/pruebas/_pos-simulado.mjs) */\n(${instalarSupabaseSimulado.toString()})(${JSON.stringify(datos)}, ${JSON.stringify({ sesion: sesion ? SESION_FALSA : null })});\n`;
}

// ───────────────────────────────────── servidor y caché ─────────────────────────────────────

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};

/**
 * Sirve `raiz` en 127.0.0.1, solo lectura. Prueba primero un puerto fijo (para que el origen
 * que el POS escribe en el enlace NFC no cambie entre corridas) y cae a uno libre si está ocupado.
 */
export async function servirPos(raiz, puerto = PUERTO_FIJO) {
  raiz = path.resolve(raiz);
  const crear = () => http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const archivo = path.join(raiz, path.normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!archivo.startsWith(raiz + path.sep) || !fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) { res.writeHead(404).end('no encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  });
  for (const p of [puerto, 0]) {
    const servidor = crear();
    try {
      await new Promise((ok, mal) => { servidor.once('error', mal); servidor.listen(p, '127.0.0.1', ok); });
      return { url: `http://127.0.0.1:${servidor.address().port}`, cerrar: () => new Promise((ok) => { servidor.close(ok); servidor.closeAllConnections?.(); }) };
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || p === 0) throw e;
    }
  }
}

/**
 * Contexto con la zona, el idioma y el tamaño de pantalla de la simulación.
 *   movil   true → emula un teléfono: isMobile (el <meta viewport> manda y el layout viewport es
 *           `ancho`), hasTouch (puntero táctil: (pointer: coarse), (hover: none)) y, si no se
 *           pide otra, escala 2 (los celulares de los meseros). Sin `movil` la escala es 1.
 *           Los clics del arnés siguen llegando como ratón: lo que cambia es lo que la página mide.
 */
export function nuevoContexto(navegador, { ancho = 1440, alto = 900, escala, movil = false } = {}) {
  return navegador.newContext({
    viewport: { width: ancho, height: alto },
    deviceScaleFactor: escala ?? (movil ? 2 : 1),
    isMobile: movil,
    hasTouch: movil,
    locale: 'es-CO',
    timezoneId: ZONA,
  });
}

// ───────────────────────────────────── la página ─────────────────────────────────────

/**
 * Intercepta la red de `page`, fija el reloj, anula window.print y deja a la vista lo que la
 * consola marque como error. Devuelve `diag`:
 *   errores    errores de la página (pageerror, console.error del propio origen, avisos de Alpine)
 *   externos   console.error de otros orígenes (p. ej. un CDN que no respondió)
 *   bloqueadas URLs que se abortaron por no estar permitidas (cualquier host real que no sea una
 *              fuente de Google: supabase.co, un CDN de scripts…)
 *   dialogos   alert/confirm/prompt que la página abrió (se descartan)
 * Opciones:
 *   stubSupabase    false → el archivo real de supabase-js (assets/vendor/) corre en lugar del stub
 *   bloquearFuentes true → las fuentes de Google también se abortan (red externa totalmente cortada;
 *                          sus pedidos quedan en `diag.fuentesBloqueadas`, no en `bloqueadas`)
 *   relojFijo       false → el reloj de la página corre de verdad (la pila de punta a punta lo necesita: el estado de la
 *                          caja y los 25 s de «no responde» dependen del tiempo real); por defecto, FECHA_FIJA
 */
export async function prepararPagina(page, { url, datos = datosFicticios(), sesion = true, dirCache = path.join(os.tmpdir(), 'resplandor-pos-cdn'), stubSupabase = true, bloquearFuentes = false, relojFijo = true } = {}) {
  const origen = new URL(url).origin;
  const diag = { errores: [], externos: [], bloqueadas: [], fuentesBloqueadas: [], dialogos: [], advertencias: 0 };
  fs.mkdirSync(dirCache, { recursive: true });
  const stub = scriptSupabase(datos, { sesion });

  page.on('pageerror', (e) => diag.errores.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const donde = m.location().url || '';
    if (m.type() === 'error') (donde.startsWith(origen) ? diag.errores : diag.externos).push(`${m.text()} (${donde})`);
    else if (m.type() === 'warning') {
      diag.advertencias++;
      if (/Alpine (Expression )?(Error|Warning)/i.test(m.text())) diag.errores.push(`aviso: ${m.text().split('\n')[0]}`);
    }
  });
  page.on('dialog', (d) => { diag.dialogos.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });

  await page.route('**/*', async (route) => {
    const pedido = new URL(route.request().url());
    if (pedido.origin === origen) {
      if (stubSupabase && RUTA_SUPABASE_JS.test(pedido.pathname)) {
        return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: stub });
      }
      return route.continue();
    }
    if (!HOSTS_FUENTES.has(pedido.hostname)) { diag.bloqueadas.push(pedido.href); return route.abort('blockedbyclient'); }
    if (bloquearFuentes) { diag.fuentesBloqueadas.push(pedido.href); return route.abort('blockedbyclient'); }
    const clave = path.join(dirCache, crypto.createHash('sha1').update(pedido.href).digest('hex'));
    try {
      if (fs.existsSync(clave + '.json')) {
        const { tipo } = JSON.parse(fs.readFileSync(clave + '.json', 'utf8'));
        return await route.fulfill({ status: 200, headers: { 'content-type': tipo, 'access-control-allow-origin': '*' }, body: fs.readFileSync(clave + '.bin') });
      }
      const respuesta = await route.fetch();
      const cuerpo = await respuesta.body();
      if (respuesta.ok()) {
        fs.writeFileSync(clave + '.bin', cuerpo);
        fs.writeFileSync(clave + '.json', JSON.stringify({ url: pedido.href, tipo: respuesta.headers()['content-type'] || 'application/octet-stream' }));
      }
      return await route.fulfill({ response: respuesta, body: cuerpo, headers: { ...respuesta.headers(), 'access-control-allow-origin': '*' } });
    } catch (e) {
      diag.externos.push(`sin respuesta de ${pedido.href}: ${e.message.split('\n')[0]}`);
      return route.abort('failed').catch(() => {});
    }
  });

  if (relojFijo) await page.clock.setFixedTime(new Date(FECHA_FIJA));
  await page.addInitScript(() => { window.print = () => { window.__posImpresiones = (window.__posImpresiones || 0) + 1; }; });
  return diag;
}

/** Espera a que Alpine arranque, la sesión esté resuelta y, si hay sesión, el POS haya sincronizado (o sepa que no tiene acceso). */
export async function esperarListo(page, { sesion = true } = {}) {
  await page.waitForFunction(() => window.Alpine && Alpine.store('pos') && Alpine.store('pos').sesionLista === true, null, { timeout: 30000 });
  // Una cuenta sin acceso (rol null: `ajustar: (d) => { d.rol = null; }`) no sincroniza nunca: se espera a `sinAcceso`.
  if (sesion) await page.waitForFunction(() => Alpine.store('pos').remoto === 'ok' || Alpine.store('pos').sinAcceso === true || Alpine.store('pos').accesoSinComprobar === true, null, { timeout: 30000 });
  await esperarEstable(page);
}

/** Fuentes cargadas, iconos de Lucide ya pintados y Tailwind (Play, local) con su CSS al día. */
export async function esperarEstable(page, ms = 250) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('i[data-lucide]'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/** El store de Alpine del POS, para evaluar dentro de la página: `page.evaluate(() => Alpine.store('pos')...)`. */
export const llamadasSupabase = (page) => page.evaluate(() => window.__posSim.llamadas);

// ───────────────────────────────────── las vistas ─────────────────────────────────────
//
// Cada entrada de VISTAS es { descripcion, llegar(page), … } y se llega a ella como lo haría
// una persona (clics en la navegación, en la mesa, en los botones); solo donde un clic no
// alcanza (estado que exige otro dispositivo, p. ej.) se toca el store: Alpine.store('pos').
//   sesion    false → sin sesión (la pantalla de login)
//   ajustar   fn(datos): cambia los datos ficticios de esa vista
//   llegar    async (page): lleva la página a la vista (ya con el POS sincronizado)
//   ventana   true → captura solo la ventana (modales: el fondo es fixed); si no, la página entera
//   media     'print' → emula impresión antes de capturar
//   selector  captura solo ese elemento
//   anchos    anchos propios (el ticket térmico mide 80 mm ≈ 302 px sea cual sea la pantalla)

const nav = (page, texto) => page.locator('nav.nav-bar button.nav-link', { hasText: texto });
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const mesa = (page, n) => page.locator('.mesa-card', { has: page.locator('.mesa-num', { hasText: new RegExp(`^${n}$`) }) });
const enVista = (page, v) => page.waitForFunction((x) => Alpine.store('pos').vista === x, v);
const modal = (page) => page.locator('.modal-backdrop:visible .modal').waitFor();
const pos = (page, fn, arg) => page.evaluate(fn, arg);

const aOrden = async (page) => { await mesa(page, 3).click(); await enVista(page, 'orden'); await page.locator('.menu-item').first().waitFor(); };
const aTicket = async (page) => { await aOrden(page); await boton(page, 'Generar ticket y cobrar').click(); await boton(page, 'Sí, cobrar').click(); await enVista(page, 'ticket'); };
const aCierre = async (page) => { await nav(page, 'Cierre del día').click(); await enVista(page, 'cierre'); };
const aProductos = async (page) => { await nav(page, 'Productos').click(); await enVista(page, 'productos'); };
const aMenu = async (page) => {
  // En teléfono el Menú semanal del admin vive dentro de «Más» (docs/pos-visual.md §0.18); desde 768 px es un link de la fila.
  const enlace = nav(page, 'Menú semanal').first();
  if (await enlace.isVisible()) await enlace.click();
  else { await boton(page, 'Más').click(); await page.locator('#nav-mas').getByRole('button', { name: 'Menú semanal', exact: true }).click(); }
  await enVista(page, 'menu');
  await page.waitForFunction(() => !Alpine.store('pos').cargandoMenu && Alpine.store('pos').menusSemana.length > 0);
};
const sinAbiertas = (d) => {
  d.tablas.ordenes = d.tablas.ordenes.filter((o) => o.estado !== 'abierta');
  d.tablas.mesas.forEach((m) => { m.estado = 'libre'; });
};
const conPresencia = (d) => { d.presencia = [{ mesaId: 3, deviceId: 'otro-dispositivo', nombre: 'Mesera Demo', ts: 1790000000000 }]; };
const sinHuecos = (d) => { d.tablas.menus = d.tablas.menus.filter((m) => !((m.dia === 3 && m.opcion === 1) || (m.dia === 6 && m.opcion === 2))); };

export const VISTAS = {
  login: { descripcion: 'sin sesión: pantalla de entrada con Google', sesion: false, llegar: (page) => page.getByText('Entrar con Google').waitFor() },
  mesas: { descripcion: 'mapa de mesas (2 de 10 ocupadas) y KPIs', llegar: async () => {} },
  'mesas-estados': {
    descripcion: 'mapa de mesas con presencia de otro dispositivo, nav en offline y un cierre sin respaldo',
    ajustar: conPresencia,
    llegar: async (page) => {
      await page.locator('.mesa-presence').waitFor();
      await pos(page, () => { const p = Alpine.store('pos'); p.remoto = 'offline'; p.cierres[0].sync = 'error'; });
    },
  },
  orden: { descripcion: 'mesa 3: cuenta abierta de 3 ítems (uno con nota de variante)', llegar: aOrden },
  'orden-avisos': {
    descripcion: 'orden con todo lo condicional encendido: presencia, cuenta reabierta, enlace NFC, cobro por partes y split por persona',
    ajustar: conPresencia,
    llegar: async (page) => {
      await aOrden(page);
      await page.getByText('también tiene esta mesa abierta').waitFor();
      await pos(page, () => {
        const p = Alpine.store('pos');
        p.ordenReabiertaAviso = 'Estás editando una cuenta cerrada anteriormente.';
        p.mostrarEnlaceMesa = true;
        p.ciclarPagador(p.ordenActiva.items[1]);        // «Persona 1» → aparece «Dividir cuenta por persona»
        p.toggleModoCobroParcial();                      // cobro por partes con dos ítems marcados
        p.toggleSeleccionItem(p.ordenActiva.items[0].id);
        p.toggleSeleccionItem(p.ordenActiva.items[2].id);
      });
    },
  },
  'orden-vacia': {
    descripcion: 'mesa libre tocada por error: pedido vacío (la única salida útil es «Liberar mesa»)',
    llegar: async (page) => {
      await mesa(page, 1).click(); await enVista(page, 'orden');
      await page.locator('.menu-item').first().waitFor();
      await boton(page, 'Liberar mesa').waitFor();
    },
  },
  ticket: { descripcion: 'ticket generado (orden → Generar ticket y cobrar → Sí, cobrar)', llegar: aTicket },
  'ticket-precuenta': {
    descripcion: 'pre-cuenta dividida entre 3 (orden → Imprimir cuenta)',
    llegar: async (page) => {
      await aOrden(page);
      await pos(page, () => { Alpine.store('pos').dividirN = 3; });
      await boton(page, 'Imprimir cuenta').click();
      await enVista(page, 'ticket');
      await page.waitForFunction(() => !document.body.classList.contains('print-termico'));
    },
  },
  'ticket-impreso': {
    descripcion: 'el ticket en papel térmico de 80 mm (media print + body.print-termico)',
    media: 'print', selector: '.print-zone', anchos: [302],
    llegar: async (page) => { await aTicket(page); await page.emulateMedia({ media: 'print' }); await pos(page, () => document.body.classList.add('print-termico')); },
  },
  cierre: { descripcion: 'cierre del día: KPIs, transacciones del turno e historial', llegar: aCierre },
  'cierre-error': {
    descripcion: 'cierre con el respaldo del último cierre fallido (chip rojo y reintento)',
    llegar: async (page) => { await aCierre(page); await pos(page, () => { Alpine.store('pos').cierres[0].sync = 'error'; }); },
  },
  'cierre-impreso': {
    descripcion: 'el resumen de cierre al imprimir (A4, media print)',
    media: 'print', anchos: [794],
    llegar: async (page) => { await aCierre(page); await page.emulateMedia({ media: 'print' }); },
  },
  productos: { descripcion: 'catálogo de productos (4 categorías, 12 productos)', llegar: aProductos },
  menu: { descripcion: 'menú semanal (admin): 6 días × 3 opciones, votos, sugerencias', llegar: aMenu },
  'menu-huecos': { descripcion: 'menú semanal con dos opciones sin crear («+ Agregar»)', ajustar: sinHuecos, llegar: aMenu },

  'modal-producto': {
    descripcion: 'modal Editar producto', ventana: true,
    llegar: async (page) => { await aProductos(page); await page.locator('section:visible').getByRole('button', { name: 'Editar', exact: true }).first().click(); await modal(page); },
  },
  'modal-producto-nuevo': {
    descripcion: 'modal Nuevo producto (campos vacíos)', ventana: true,
    llegar: async (page) => { await aProductos(page); await boton(page, 'Nuevo producto').click(); await modal(page); },
  },
  'modal-menu': {
    descripcion: 'modal Editar menú del día', ventana: true,
    llegar: async (page) => { await aMenu(page); await page.locator('section:visible').getByRole('button', { name: 'Editar', exact: true }).first().click(); await modal(page); },
  },
  'modal-item-manual': {
    descripcion: 'modal Ítem manual', ventana: true,
    llegar: async (page) => { await aOrden(page); await boton(page, 'Ítem manual').click(); await modal(page); },
  },
  'modal-opciones': {
    descripcion: 'modal de variante (Ejecutivo: entrada y proteína) con «Sopa» elegida', ventana: true,
    llegar: async (page) => {
      await aOrden(page);
      await page.locator('.menu-item', { hasText: 'Ejecutivo de la casa' }).click();
      await modal(page);
      await page.locator('.modal-backdrop:visible .opt-chip', { hasText: 'Sopa' }).click();
    },
  },
  'modal-cobro': {
    descripcion: 'modal Confirmar cobro con el reparto entre 3 personas', ventana: true,
    llegar: async (page) => {
      await aOrden(page);
      await boton(page, 'Generar ticket y cobrar').click(); await modal(page);
      await page.locator('.modal-backdrop:visible input[type=number]').fill('3');
    },
  },
  'modal-reabrir': {
    descripcion: 'modal Reabrir cuenta (la mesa 3 sigue ocupada: pide otra mesa libre)', ventana: true,
    llegar: async (page) => {
      await aCierre(page);
      await page.locator('section:visible .history-row').first().getByRole('button', { name: 'Editar', exact: true }).click(); await modal(page);
      await boton(page, 'Reabrir en mesa').click();
      await page.getByText('Elige una mesa libre').waitFor();
    },
  },
  'modal-editar-transaccion': {
    descripcion: 'modal Editar transacción del turno', ventana: true,
    llegar: async (page) => { await aCierre(page); await page.locator('section:visible .history-row').first().getByRole('button', { name: 'Editar', exact: true }).click(); await modal(page); },
  },
  'modal-editar-transaccion-cierre': {
    descripcion: 'modal Editar transacción de un cierre ya hecho (con el aviso en rojo)', ventana: true,
    llegar: async (page) => { await aCierre(page); await page.locator('section:visible button[title="Editar"]').first().click(); await modal(page); },
  },
  'modal-cierre': {
    descripcion: 'modal Confirmar cierre del día CON el bloqueo por mesas abiertas', ventana: true,
    llegar: async (page) => { await aCierre(page); await boton(page, 'Cerrar día').click(); await modal(page); },
  },
  'modal-cierre-limpio': {
    descripcion: 'modal Confirmar cierre del día sin mesas abiertas (se puede cerrar)', ventana: true, ajustar: sinAbiertas,
    llegar: async (page) => { await aCierre(page); await boton(page, 'Cerrar día').click(); await modal(page); },
  },
};

// ───────────────── vistas de la ola B (b2): roles, alertas, personal y los dos cobros nuevos ─────────────────
//
// Aquí el estado se FIJA en el store (rol, alertas, personal…): lo que importa es cómo se ve la pantalla con ese estado.
// Las vistas de arriba corren como admin (el store real de b1 pide rpc('mi_rol') y el simulador contesta 'admin' por defecto).
const aRol = (rol) => (page) => pos(page, (r) => { const p = Alpine.store('pos'); p.rol = r; p.rolCargado = true; p.sinAcceso = false; }, rol);
const hace = (min) => new Date(Date.parse(FECHA_FIJA) - min * 60000).toISOString();
const alertasDemo = () => [
  { id: 'al-1', mesaId: 3, metodo: 'qr', creadaEn: hace(4) },
  { id: 'al-2', mesaId: 6, metodo: 'efectivo', creadaEn: hace(1) },
];
const personalDemo = () => [
  { email: 'camila.demo@ejemplo.test', nombre: 'Camila Demo', rol: 'admin', activo: true },
  { email: 'mesero.demo@ejemplo.test', nombre: 'Mesero Demo', rol: 'mesero', activo: true },
  { email: 'ex.mesero.demo@ejemplo.test', nombre: 'Exmesero Demo', rol: 'mesero', activo: false },
];
const aVista = (v) => (page) => pos(page, (x) => { Alpine.store('pos').vista = x; }, v);
const aAlertas = async (page) => {
  await pos(page, (a) => { Alpine.store('pos').alertas = a; }, alertasDemo());
  await aVista('alertas')(page);
  await page.locator('.alerta-tarjeta').first().waitFor();
};
const aPersonal = async (page) => {
  await pos(page, (l) => { Alpine.store('pos').personal = l; }, personalDemo());
  await aVista('personal')(page);
  await page.locator('.persona-fila').first().waitFor();
};
/** Mesa 3 en «Cobrar por partes»; `ajustes` (texto, `p` = el store) marca líneas, escribe un monto, etc.; `centrar` es el selector que queda a media ventana. */
const aCobroPartes = (ajustes, centrar) => async (page) => {
  await aOrden(page);
  await pos(page, (src) => {
    const p = Alpine.store('pos');
    p.toggleModoCobroParcial();
    new Function('p', src)(p);
  }, ajustes);
  await page.locator(centrar).first().waitFor();
  await esperarEstable(page);                           // los íconos y los bloques nuevos terminan de pintarse antes de fijar el scroll
  await page.locator(centrar).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
};
const conAbonoRecibido = `
  p.ordenActiva.items.push({ id: 'abono_recibido_demo', nombre: 'Abono recibido', precio: -20000, qty: 1, nota: 'efectivo' });
`;

const VISTAS_B2 = {
  alertas: { descripcion: 'ola B: vista Alertas con 2 pendientes (mesa 3 con QR hace 4 min, mesa 6 con efectivo hace 1 min), admin', llegar: aAlertas },
  'alertas-vacia': { descripcion: 'ola B: vista Alertas sin pendientes', llegar: aVista('alertas') },
  'alertas-silencio': {
    descripcion: 'ola B: vista Alertas con el sonido silenciado 10 min',
    llegar: async (page) => { await aAlertas(page); await pos(page, () => Alpine.store('pos').silenciarAlertas(10)); },
  },
  'mesas-alertas': {
    descripcion: 'ola B: mapa de mesas con la insignia de «pide la cuenta» y el aviso flotante de una alerta nueva',
    llegar: async (page) => {
      await pos(page, () => { Alpine.store('pos').alertas = [{ id: 'al-1', mesaId: 3, metodo: 'qr', creadaEn: new Date().toISOString() }]; });
      await page.locator('.toast-alerta-cuerpo').waitFor();
    },
  },
  'orden-alerta': {
    descripcion: 'ola B: orden de la mesa 3 con la franja «pidió la cuenta»',
    llegar: async (page) => { await aOrden(page); await pos(page, (a) => { Alpine.store('pos').alertas = a; }, alertasDemo()); await page.locator('.franja-alerta').waitFor(); },
  },
  personal: { descripcion: 'ola B: vista Personal (admin) con 3 filas: admin, mesero y un exmesero sin acceso', llegar: aPersonal },
  'personal-error': {
    descripcion: 'ola B: vista Personal con el error de la última operación y la baja a medio confirmar',
    llegar: async (page) => {
      await aPersonal(page);
      await pos(page, () => { Alpine.store('pos').personalError = 'No se pudo dar de alta: ese correo ya está en la lista.'; });
      await page.locator('.persona-fila').nth(1).getByRole('button', { name: 'Dar de baja', exact: true }).click();
    },
  },
  'sin-acceso': {
    descripcion: 'ola B: sesión de Google sin acceso (la cuenta no está en el personal)',
    llegar: async (page) => { await pos(page, () => { const p = Alpine.store('pos'); p.rol = null; p.rolCargado = true; p.sinAcceso = true; }); await page.locator('.sin-acceso').waitFor(); },
  },
  'orden-cobro-unidades': {
    descripcion: 'ola B: cobro por partes con dos líneas marcadas; en la de 3 limonadas se cobran 2 («Cobrar − 2 + de 3»)', ventana: true,
    llegar: aCobroPartes(`
      const [a, , c] = p.ordenActiva.items;
      p.toggleSeleccion(a); p.toggleSeleccion(c); p.ajustarCantidadSeleccion(c, -1);
    `, '.order-item.con-sel >> nth=1'),
  },
  'orden-cobro-monto': {
    descripcion: 'ola B: cobro por partes con un abono ya recibido y «Cobrar un monto» con $ 30.000 por QR', ventana: true,
    llegar: aCobroPartes(`${conAbonoRecibido} p.montoAbono = '30000'; p.metodoAbono = 'qr';`, '.bloque-monto'),
  },
  'orden-cobro-abono': {
    descripcion: 'ola B: el pedido con la línea «Abono recibido» (negativa, sin casilla ni stepper) en cobro por partes', ventana: true,
    llegar: aCobroPartes(conAbonoRecibido, '.order-item.es-abono'),
  },
  'orden-cobro-monto-invalido': {
    descripcion: 'ola B: «Cobrar un monto» con un monto mayor que lo pendiente (botón deshabilitado y ayuda en rojo)', ventana: true,
    llegar: aCobroPartes(`p.montoAbono = '999999';`, '.bloque-monto'),
  },
  'ticket-abono': {
    descripcion: 'ola B: ticket de un abono de $ 20.000 con la línea «Queda por pagar»',
    llegar: async (page) => {
      await aOrden(page);
      await pos(page, () => {
        const p = Alpine.store('pos');
        p.ticketMostrado = { id: 'abono-demo', mesaId: 3, estado: 'cerrada', items: [{ id: 'abono_demo', nombre: 'Abono', precio: 20000, qty: 1, nota: 'efectivo' }],
          total: 20000, abiertaEn: new Date().toISOString(), cerradaEn: new Date().toISOString(), dividirOculto: true };
        p.vista = 'ticket';
      });
    },
  },
  'mesas-mesero': { descripcion: 'ola B: mapa de mesas con rol de mesero (barra inferior de 4: sin «Más»)', llegar: aRol('mesero') },
  'mesas-admin-mas': {
    descripcion: 'ola B: teléfono, admin: barra inferior de 5 con «Más» abierto (Menú semanal y Personal)', anchos: [360, 390], ventana: true,
    llegar: async (page) => { await page.getByRole('button', { name: 'Más', exact: true }).click(); await page.locator('#nav-mas').waitFor(); },
  },
  'productos-mesero': { descripcion: 'ola B: catálogo con rol de mesero (crea y edita; no borra)', llegar: async (page) => { await aRol('mesero')(page); await aProductos(page); } },
  'cierre-mesero': { descripcion: 'ola B: cierre del día con rol de mesero: ventas e historial en solo lectura, sin Cerrar día ni Editar', llegar: async (page) => { await aRol('mesero')(page); await aCierre(page); } },
  'orden-nfc-mesero': {
    descripcion: 'ola B: panel NFC de la mesa con rol de mesero (sin «Rotar»)',
    llegar: async (page) => { await aRol('mesero')(page); await aOrden(page); await pos(page, () => { Alpine.store('pos').mostrarEnlaceMesa = true; }); },
  },
};
Object.assign(VISTAS, VISTAS_B2);

// ───────────────── imprimir en la caja: la cola de impresión con el agente del PC simulado ─────────────────
//
// Con `DATOS.impresoras` la base simulada tiene la cola (impresora_estado contesta la lista); sin ella el POS no ofrece nada
// (comportamiento de siempre). El agente del PC lo hace el propio arnés: window.__posSim.imprimirAhora(id, estado, error).
const caja = (enLinea = true) => (d) => {
  d.impresoras = [{ id: 'impresora-1', nombre: 'Caja', en_linea: enLinea, ultimo_latido: hace(enLinea ? 0.2 : 7), version_agente: '1.0.0' }];
};
const sinImpresoras = (d) => { d.impresoras = []; };
const comoMesero = (d) => { d.rol = 'mesero'; };
const juntar = (...f) => (d) => f.forEach((x) => x(d));
/** Admin: a «Impresora de la caja» como lo haría una persona (el botón de la barra desde 768 px; «Más» en teléfono). */
const aImpresora = async (page) => {
  const barra = page.locator('button.nav-caja');
  if (await barra.isVisible()) await barra.click();
  else { await boton(page, 'Más').click(); await page.locator('#nav-mas').getByRole('button', { name: 'Impresora de la caja', exact: true }).click(); }
  await enVista(page, 'impresora');
  await page.locator('section:visible h1', { hasText: 'Impresora de la caja' }).waitFor();
};
/** Orden de la mesa 3 → «Imprimir en la caja» → el aviso flotante con el trabajo en cola. */
const aCola = async (page) => {
  await aOrden(page);
  await boton(page, 'Imprimir en la caja').click();
  await page.locator('.toast-impresion-fila').first().waitFor();
  await page.waitForFunction(() => Alpine.store('pos').cajaTrabajos[0]?.id);
};
const idImpresion = (page) => page.evaluate(() => window.__posSim.tablas.impresiones[0].id);

const VISTAS_CAJA = {
  'caja-orden': { descripcion: 'caja: orden de la mesa 3 con la caja en línea («Imprimir en la caja» junto a «Imprimir cuenta» y «Caja: en línea»)', ajustar: caja(true), llegar: aOrden },
  'caja-orden-sin-conexion': { descripcion: 'caja: orden con la caja registrada pero sin conexión (sin botón; la línea dice que se imprime desde el teléfono)', ajustar: caja(false), llegar: aOrden },
  'caja-orden-mesero': { descripcion: 'caja: orden con rol de mesero y la caja en línea (el botón es de todo el personal)', ajustar: juntar(caja(true), comoMesero), llegar: aOrden },
  'caja-estado-cola': { descripcion: 'caja: «En cola en la caja…» tras tocar «Imprimir en la caja» en la orden', ajustar: caja(true), llegar: aCola },
  'caja-estado-imprimiendo': {
    descripcion: 'caja: el agente tomó el trabajo («Imprimiendo en la caja…»)', ajustar: caja(true),
    llegar: async (page) => { await aCola(page); await page.evaluate((id) => window.__posSim.imprimirAhora(id, 'imprimiendo'), await idImpresion(page)); await page.getByText('Imprimiendo en la caja…').waitFor(); },
  },
  'caja-estado-impreso': {
    descripcion: 'caja: «Impreso en la caja» (se quita solo a los 6 s)', ajustar: caja(true),
    llegar: async (page) => { await aCola(page); await page.evaluate((id) => window.__posSim.imprimirAhora(id, 'impresa'), await idImpresion(page)); await page.getByText('Impreso en la caja', { exact: true }).waitFor(); },
  },
  'caja-estado-error': {
    descripcion: 'caja: «Error: …» con Reintentar', ajustar: caja(true),
    llegar: async (page) => { await aCola(page); await page.evaluate((id) => window.__posSim.imprimirAhora(id, 'error', 'la impresora no tiene papel'), await idImpresion(page)); await boton(page, 'Reintentar').waitFor(); },
  },
  'caja-estado-sin-respuesta': {
    descripcion: 'caja: en cola más de 25 s: «La caja no responde. Sigue en cola…»', ajustar: caja(true),
    llegar: async (page) => { await aCola(page); await page.evaluate(() => { Alpine.store('pos').cajaTrabajos[0].sinRespuesta = true; }); await page.getByText('La caja no responde').waitFor(); },
  },
  'caja-ticket': { descripcion: 'caja: ticket con la caja en línea («Imprimir en la caja» en coral; «Imprimir» pasa a secundario)', ajustar: caja(true), llegar: aTicket },
  'caja-ticket-sin-conexion': { descripcion: 'caja: ticket con la caja sin conexión (solo «Imprimir», como siempre, y la línea que lo explica)', ajustar: caja(false), llegar: aTicket },
  'caja-admin': { descripcion: 'caja: pantalla «Impresora de la caja» (admin) con una impresora en línea', ajustar: caja(true), llegar: aImpresora },
  'caja-admin-sin-conexion': { descripcion: 'caja: pantalla de la impresora con el agente sin latir (sin conexión)', ajustar: caja(false), llegar: aImpresora },
  'caja-admin-vacia': { descripcion: 'caja: pantalla de la impresora sin ninguna registrada («Agregar la impresora de la caja»)', ajustar: sinImpresoras, llegar: aImpresora },
  'caja-admin-token': {
    descripcion: 'caja: recién creada, con el token que se muestra una vez y «Copiar»', ajustar: sinImpresoras,
    llegar: async (page) => { await aImpresora(page); await boton(page, 'Agregar impresora').click(); await page.locator('.caja-token').waitFor(); },
  },
  'caja-admin-rotar': {
    descripcion: 'caja: «Rotar token» a medio confirmar', ajustar: caja(true),
    llegar: async (page) => { await aImpresora(page); await boton(page, 'Rotar token').click(); await page.getByText('¿Rotar el token de').waitFor(); },
  },
};
Object.assign(VISTAS, VISTAS_CAJA);

/**
 * Abre pos.html en `page` con Supabase simulado y lleva la página a `vista` (una clave de VISTAS).
 *   url       origen del servidor (servirPos(raiz).url)
 *   vista     'mesas' por defecto
 *   ajustar   fn(datos) extra, se aplica después de la propia de la vista
 *   dirCache  dónde se guardan las fuentes de Google (ver prepararPagina)
 *   bloquearFuentes  true → también sin las fuentes de Google (ver prepararPagina)
 * Devuelve { diag, vista, datos }; la bitácora de Supabase se lee con llamadasSupabase(page).
 */
export async function abrirPos(page, { url, vista = 'mesas', ajustar, dirCache, bloquearFuentes = false } = {}) {
  if (!url) throw new Error('abrirPos: falta `url` (usa servirPos(raiz).url)');
  const def = VISTAS[vista];
  if (!def) throw new Error(`abrirPos: vista desconocida «${vista}». Hay: ${Object.keys(VISTAS).join(', ')}`);
  const sesion = def.sesion !== false;
  const datos = datosFicticios((d) => { def.ajustar?.(d); ajustar?.(d); });
  const diag = await prepararPagina(page, { url, datos, sesion, dirCache, bloquearFuentes });
  await page.goto(`${url}/pos.html`, { waitUntil: 'load' });
  await esperarListo(page, { sesion });
  await def.llegar(page);
  await esperarEstable(page);
  return { diag, vista: def, datos };
}
