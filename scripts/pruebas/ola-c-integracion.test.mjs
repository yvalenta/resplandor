// Integración de la OLA C: lo que el POS (pos.html) le pide a la base tiene que existir, con esa firma y esos topes, en las migraciones.
// Nació al integrar c1 (base), c2 (lógica) y c3 (pantalla): tres piezas escritas por separado contra un contrato de nombres. Aquí se cruzan
// SIN base de datos (texto contra texto): las migraciones declaran la verdad y el POS no puede salirse de ella.
//
// Lo que se verifica
//   1. Cada RPC que llama pos.html existe en las migraciones y cada argumento `p_…` que le manda está en su firma.
//   2. Cada columna y tabla nueva que el POS lee o escribe la crea una migración.
//   3. Los topes que el POS valida (capacidad de una mesa, dirección del QR, pie del ticket, número de mesa) son los de la base (si el POS
//      deja pasar algo que la base rechaza, la persona vería «revisa la conexión» en vez del motivo).
//   4. Todo nombre del contrato de la ola C existe en el store, y `puede()` conoce las acciones nuevas.
//   5. Las confirmaciones de lo nuevo viven en la página: ni confirm() ni alert() nativos en el código de la ola C.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const DIR_MIG = path.join(RAIZ, 'supabase', 'migrations');
const MIGRACIONES = fs.readdirSync(DIR_MIG).filter((f) => f.endsWith('.sql')).sort();
const SQL = Object.fromEntries(MIGRACIONES.map((f) => [f, fs.readFileSync(path.join(DIR_MIG, f), 'utf8')]));
const TODO_SQL = Object.values(SQL).join('\n');
const sinComentariosSql = (t) => t.replace(/^\s*--.*$/gm, '');
const SQL_VIVO = sinComentariosSql(TODO_SQL);

// El <script> que define el store: sin el resto de la página.
const STORE = [...POS.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((t) => t.includes("Alpine.store('pos'"));
assert.ok(STORE, "no encontré el <script> que define Alpine.store('pos', …)");
const sinComentariosJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const CODIGO = sinComentariosJs(STORE);

/** Las funciones public.* que declaran las migraciones, con los nombres de sus parámetros. */
function funcionesDeLaBase() {
  const m = new Map();
  for (const x of SQL_VIVO.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(([^)]*)\)/gi)) {
    const params = x[2].split(',').map((p) => p.trim().split(/\s+/)[0]).filter((p) => /^p_/.test(p));
    m.set(x[1], new Set([...(m.get(x[1]) || []), ...params]));
  }
  return m;
}
const FUNCIONES = funcionesDeLaBase();

/** Las llamadas a RPC del POS: `rpc('nombre', { p_a: …, p_b: … })` y los ayudantes que las reciben por nombre. */
function llamadasRpc() {
  const res = [];
  const objeto = (desde) => {
    const i = CODIGO.indexOf('{', desde);
    if (i === -1) return '';
    let prof = 0, j = i;
    for (; j < CODIGO.length; j++) { if (CODIGO[j] === '{') prof++; else if (CODIGO[j] === '}' && --prof === 0) break; }
    return CODIGO.slice(i, j + 1);
  };
  for (const x of CODIGO.matchAll(/(?:\.rpc|_gestionarMesa|_gestionarPersonal)\(\s*'([a-z_0-9]+)'\s*(?:,\s*(?=\{))?/g)) {
    const desde = x.index + x[0].length;
    const args = CODIGO[desde] === '{' ? [...objeto(desde).matchAll(/\b(p_[a-z_0-9]+)\b/g)].map((a) => a[1]) : [];
    res.push({ nombre: x[1], args });
  }
  return res;
}

test('ola C · 1: cada RPC que llama pos.html existe en las migraciones y sus argumentos están en la firma', () => {
  const llamadas = llamadasRpc();
  const nombres = new Set(llamadas.map((l) => l.nombre));
  // Las de la ola C que el POS tiene que usar (si alguna deja de llamarse, este arreglo avisa).
  for (const n of ['solicitar_acceso', 'vista_pendiente', 'mi_rol', 'personal_aprobar', 'personal_eliminar', 'personal_alta', 'personal_baja', 'personal_cambiar_rol',
    'mesa_crear', 'mesa_editar', 'mesa_activar', 'pegatina_marcar', 'deshacer_cobro', 'aplicar_delta_orden']) {
    assert.ok(nombres.has(n), `el POS ya no llama a ${n}`);
  }
  // Las dos de las alertas se llaman por nombre desde _resolverAlerta(id, 'atender_alerta' | 'descartar_alerta') con { p_id }.
  for (const n of ['atender_alerta', 'descartar_alerta']) {
    assert.ok(CODIGO.includes(`_resolverAlerta(id, '${n}')`), `el POS ya no llama a ${n}`);
    assert.deepEqual([...FUNCIONES.get(n)], ['p_id'], `${n}(p_id)`);
  }
  assert.match(CODIGO, /supabaseClient\.rpc\(funcion, \{ p_id: id \}\)/);
  const sinFirma = [];
  for (const { nombre, args } of llamadas) {
    if (nombre === 'actualizar_nota_item' || nombre === 'aplicar_delta_orden') {
      assert.ok(FUNCIONES.has(nombre), `la base no declara ${nombre}`);
      continue;
    }
    if (!FUNCIONES.has(nombre)) { sinFirma.push(`${nombre}: ninguna migración la declara`); continue; }
    for (const a of args) if (!FUNCIONES.get(nombre).has(a)) sinFirma.push(`${nombre}: el POS manda ${a} y la firma de la base no lo tiene (${[...FUNCIONES.get(nombre)].join(', ') || 'sin parámetros'})`);
  }
  assert.deepEqual(sinFirma, [], sinFirma.join('\n'));
});

test('ola C · 1b: los parámetros de las RPC de la ola C son los que el POS manda (nombre por nombre)', () => {
  const esperado = {
    personal_aprobar: ['p_email', 'p_rol'], personal_eliminar: ['p_email'], mesa_crear: ['p_id', 'p_capacidad'], mesa_editar: ['p_id', 'p_capacidad'],
    mesa_activar: ['p_id', 'p_activa'], pegatina_marcar: ['p_id', 'p_tipo', 'p_token'], deshacer_cobro: ['p_orden_id'],
    solicitar_acceso: [], vista_pendiente: [], personal_alta: ['p_email', 'p_nombre', 'p_rol'],
  };
  for (const [fn, args] of Object.entries(esperado)) {
    assert.ok(FUNCIONES.has(fn), `la base declara ${fn}`);
    assert.deepEqual([...FUNCIONES.get(fn)].sort(), [...args].sort(), `parámetros de ${fn}`);
    const llamadas = llamadasRpc().filter((l) => l.nombre === fn);
    assert.ok(llamadas.length >= 1, `el POS llama a ${fn}`);
    for (const l of llamadas) assert.deepEqual([...new Set(l.args)].sort(), [...args].sort(), `el POS le manda a ${fn} exactamente sus parámetros`);
  }
});

test('ola C · 2: las tablas y columnas nuevas que el POS usa las crea una migración', () => {
  const columna = (tabla, col) => new RegExp(`alter\\s+table\\s+public\\.${tabla}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${col}\\b`, 'i').test(SQL_VIVO);
  assert.ok(columna('personal', 'estado') || /personal\s*\([\s\S]*?\bestado\b/i.test(SQL_VIVO), 'personal.estado');
  assert.ok(columna('personal', 'solicitado_en'), 'personal.solicitado_en');
  for (const c of ['activa', 'pegatina_escrita_en', 'pegatina_revisada_en']) assert.ok(columna('mesas', c), `mesas.${c}`);
  assert.ok(columna('ordenes', 'parcial_de'), 'ordenes.parcial_de');
  assert.match(SQL_VIVO, /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.ajustes\b/i, 'la tabla ajustes');
  for (const c of ['ticket_qr_url', 'ticket_qr_visible', 'ticket_pie']) assert.ok(new RegExp(`\\b${c}\\b`).test(SQL_VIVO), `ajustes.${c}`);
  // y el POS pide justo esos nombres
  for (const c of ['ticket_qr_url', 'ticket_qr_visible', 'ticket_pie']) assert.ok(CODIGO.includes(c), `el POS usa ${c}`);
  for (const c of ['pegatina_escrita_en', 'pegatina_revisada_en', 'solicitado_en', 'parcial_de']) assert.ok(CODIGO.includes(c), `el POS usa ${c}`);
  // Realtime de `personal` (el contador en vivo del admin) y de las demás
  assert.match(SQL_VIVO, /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.personal/i, 'personal entra a la publicación de Realtime');
});

test('ola C · 3: los topes que valida el POS son los de la base', () => {
  // Capacidad de una mesa: 1 a 50 (mesa_crear y mesa_editar), en el store y en el formulario.
  const mesas = SQL['20261002160000_mesas_y_pegatinas.sql'];
  assert.equal([...mesas.matchAll(/p_capacidad\s*>\s*50/g)].length, 2, 'la base acepta hasta 50 puestos en las dos RPC');
  assert.equal([...CODIGO.matchAll(/_enteroEn\(capacidad, 1, 50\)/g)].length, 2, 'el store valida 1 a 50 al crear y al editar');
  assert.match(CODIGO, /capacidad_invalida: 'La capacidad debe ser un entero entre 1 y 50\.'/, 'y el mensaje dice 50');
  assert.match(POS, /get capOk\(\) \{ const n = parseInt\(this\.cap, 10\); return n >= 1 && n <= 50; \}/, 'el formulario de «Agregar mesa» deja hasta 50');
  assert.match(POS, /parseInt\(capNueva, 10\) >= 1 && parseInt\(capNueva, 10\) <= 50\)/, 'el de «Editar capacidad» también');
  // Número de mesa: la base acepta 1 a 9999; el POS, 1 a 999 (más estricto: no hay mesas de cuatro cifras).
  assert.match(mesas, /p_id\s*<\s*1\s+or\s+p_id\s*>\s*9999/);
  assert.match(CODIGO, /_enteroEn\(id, 1, 999\)/);
  // Dirección del QR: https://, sin espacios, 3 a 200 caracteres y sin < > " ` \ (los dos check de la tabla).
  const ajustes = SQL['20261002170000_ajustes_ticket.sql'];
  assert.match(ajustes, /ticket_qr_url\s*~\s*'\^https:\/\/\[\^\\s\]\{3,200\}\$'/, 'check de la base: https://, sin espacios, 3 a 200');
  assert.match(ajustes, /ticket_qr_url\s*!~\s*'\[<>"`\\\\\]'/, 'check de la base: sin < > " ` \\');
  assert.match(CODIGO, /!\/\^https:\\\/\\\/\[\^\\s\]\{3,200\}\$\/\.test\(u\) \|\| \/\[<>"`\\\\\]\/\.test\(u\)|\/\^https:\\\/\\\/\[\^\\s\]\{3,200\}\$\/\.test\(u\) \|\| \/\[<>"`\\\\\]\/\.test\(u\)/, 'el store rechaza lo mismo');
  assert.match(POS, /get urlOk\(\) \{ const u = this\.url\.trim\(\); return \/\^https:\\\/\\\/\[\^\\s\]\{3,200\}\$\/\.test\(u\) && !\/\[<>\\x22`\\\\\]\/\.test\(u\); \}/, 'y el formulario de Ajustes también');
  // Pie: 1 a 120 caracteres.
  assert.match(ajustes, /ticket_pie[\s\S]{0,200}120/, 'la base acepta hasta 120 en el pie');
  assert.match(CODIGO, /p\.trim\(\)\.length >= 1 && p\.trim\(\)\.length <= 120/);
  assert.match(POS, /id="ajuste-pie"[^>]*maxlength="120"/);
});

test('ola C · 4: los nombres del contrato existen en el store y puede() conoce las acciones nuevas', () => {
  const DEFINIDOS = new Set([...STORE.matchAll(/^ {12}(?:async\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*[:(]/gm)].map((m) => m[1]));
  const contrato = [
    // acceso
    'estadoAcceso', 'esperaAprobacion', 'mesasPendiente', 'cartaPendiente',
    // personal
    'personalPendientes', 'numPendientes', 'aprobarPersonal', 'eliminarPersonal', 'personal', 'altaPersonal', 'bajaPersonal', 'cambiarRolPersonal', 'personalError',
    // mesas y pegatinas
    'mesasAdmin', 'cargarMesasAdmin', 'crearMesa', 'editarMesa', 'activarMesa', 'copiarEnlace', 'nfcDisponible', 'escribirPegatina', 'revisarPegatina', 'nfcEstado', 'cancelarNfc', 'mesasAdminError',
    // deshacer
    'ultimoCobro', 'deshacerUltimoCobro', 'puedeDevolver', 'devolverACuenta', 'deshacerError', 'tipoDevolucion', 'cargarDeshechos', 'deshechosHoy', 'deshechosHoyMonto',
    // refutación de la ola C: pegatinas con el token que se escribió, la espera que responde, la vista previa del QR
    'marcarPegatinaManual', 'reintentarNfc', 'seleccionarEnlace', 'comprobarEspera', 'qrSvgPara', 'irDesdeAviso',
    // ticket
    'ajustes', 'cargarAjustes', 'guardarAjustes', 'ajustesError', 'ajustesGuardados', 'qrTicketSvg',
    // interacción
    'agregadoReciente', 'vibrar',
  ];
  const faltan = contrato.filter((n) => !DEFINIDOS.has(n));
  assert.deepEqual(faltan, [], `el contrato promete y el store no define: ${faltan.join(', ')}`);
  const puede = STORE.slice(STORE.indexOf('puede(accion) {'), STORE.indexOf('puede(accion) {') + 900);
  for (const a of ['mesas_admin', 'ajustes', 'aprobar_personal', 'deshacer_cobro']) assert.ok(puede.includes(`'${a}'`), `puede('${a}')`);
  // El estado de reposo de la hoja de NFC: un objeto con `fase: null`. El marcado abre la hoja con `nfcEstado?.fase`, no con el objeto.
  assert.match(STORE, /nfcEstado: \{ id: null, fase: null, mensaje: '', accion: null \}/);
  assert.match(POS, /<div x-show="\$store\.pos\.nfcEstado\?\.fase" x-cloak class="modal-backdrop print:hidden"/, 'la hoja de NFC solo se ve con una fase (en reposo el objeto existe y es verdadero)');
});

test('ola C · 5: lo nuevo no usa confirm() ni alert() nativos (la confirmación vive en la página)', () => {
  // Las que ya existían en la ola B (26 al integrar) se quedan; lo de la ola C no suma ninguna. Si alguien agrega una, esta cuenta sube y la prueba avisa.
  const usos = [...CODIGO.matchAll(/(^|[^\w.])(alert|confirm|prompt)\(/gm)].map((m) => m[2]);
  assert.ok(usos.length <= 26, `hay ${usos.length} alert()/confirm()/prompt() en el store; la ola B (24487b9) tenía 26 y la ola C no agrega ninguno`);
  for (const f of ['_gestionarMesa', 'crearMesa', 'editarMesa', 'activarMesa', 'escribirPegatina', 'revisarPegatina', 'copiarEnlace', 'aprobarPersonal', 'eliminarPersonal',
    'guardarAjustes', 'deshacerUltimoCobro', 'devolverACuenta', '_deshacerCobro', '_cargarVistaPendiente', '_consultarRol']) {
    const i = CODIGO.search(new RegExp(`^ {12}(?:async\\s+)?${f}\\(`, 'm'));
    assert.ok(i !== -1, `no encontré ${f}`);
    const cuerpo = CODIGO.slice(i, i + 3500).split(/\n {12}(?:async\s+|get\s+)?[A-Za-z_$][\w$]*\(.*\) \{\n/)[1] ?? CODIGO.slice(i, i + 1500);
    assert.doesNotMatch(cuerpo, /(^|[^\w.])(alert|confirm|prompt)\(/m, `${f} no debe abrir un diálogo nativo`);
  }
  // El panel de mesas llama a rotarTokenMesa ya confirmado (si no, el store preguntaría otra vez con confirm() y avisaría con alert()).
  assert.match(POS, /\$store\.pos\.rotarTokenMesa\(m\.id, \{ confirmado: true \}\)/);
});

test('ola C · 6: al rotar el token el panel borra las fechas de la pegatina (la base las borra con trg_mesas_pegatina_obsoleta)', () => {
  assert.match(SQL['20261002160000_mesas_y_pegatinas.sql'], /trg_mesas_pegatina_obsoleta/);
  const i = CODIGO.indexOf('async rotarTokenMesa(');
  const cuerpo = CODIGO.slice(i, i + 3500);
  assert.match(cuerpo, /enAdmin\.escritaEn = null; enAdmin\.revisadaEn = null/, 'la tarjeta deja de decir «Escrita hoy»');
  assert.match(cuerpo, /this\.cargarMesasAdmin\(\)/, 'y se vuelve a leer la verdad de la base');
});

test('ola C · 7: los códigos de error de las RPC de la ola C tienen su texto en el POS', () => {
  const codigos = (fn) => [...(SQL['20261002150000_aprobacion_personal.sql'] + SQL['20261002160000_mesas_y_pegatinas.sql'] + SQL['20261002180000_deshacer_cobro.sql'])
    .matchAll(new RegExp(`'codigo',\\s*'([a-z_]+)'`, 'g'))].map((m) => m[1]);
  const todos = new Set(codigos());
  const textos = (nombre) => { const i = CODIGO.indexOf(`${nombre}(codigo) {`); assert.ok(i !== -1, nombre); return CODIGO.slice(i, i + 2500); };
  const mesas = textos('_textoErrorMesa');
  for (const c of ['no_autorizado', 'ya_existe', 'no_existe', 'con_cuenta_abierta', 'id_invalido', 'capacidad_invalida', 'tipo_invalido']) assert.ok(mesas.includes(c), `mesas: falta el texto de ${c}`);
  const personal = textos('_textoErrorPersonal');
  for (const c of ['no_autorizado', 'no_existe', 'inactivo', 'ultimo_admin', 'correo_invalido', 'rol_invalido', 'ya_aprobado', 'pendiente']) assert.ok(personal.includes(c), `personal: falta el texto de ${c}`);
  const deshacer = textos('_textoErrorDeshacer');
  // Sin ventana: la base ya no emite ventana_vencida, y cada código que emite deshacer_cobro tiene su texto.
  const sql180 = SQL['20261002180000_deshacer_cobro.sql'];
  const cuerpoDeshacer = sql180.slice(sql180.indexOf('create or replace function public.deshacer_cobro(p_orden_id text)'), sql180.indexOf('-- ── 3b. cerrar_dia'));
  const deD = [...cuerpoDeshacer.matchAll(/'codigo',\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(deD.length >= 6, 'deshacer_cobro emite sus códigos');
  for (const c of new Set(deD)) assert.ok(deshacer.includes(c), `deshacer: falta el texto de ${c}`);
  for (const c of ['ya_reabierta', 'mesa_ocupada']) assert.ok(new Set(deD).has(c) && deshacer.includes(c), `deshacer: ${c} se emite y tiene su texto (ronda 2, hallazgo 5)`);
  // cerrar_dia no usa _textoErrorDeshacer: sus códigos los atiende _cierreNoSeHizo (cada uno con su aviso).
  const cuerpoCierre = sql180.slice(sql180.indexOf('create or replace function public.cerrar_dia('), sql180.indexOf('-- ── 3c. reabrir_venta_de_cierre'));
  const deC = new Set([...cuerpoCierre.matchAll(/'codigo',\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...deC].sort(), ['cambio', 'hay_abiertas', 'invalido', 'no_autorizado', 'sin_ventas']);
  const i0 = CODIGO.indexOf('async _cierreNoSeHizo(');
  const rechazado = CODIGO.slice(i0, i0 + 4500);
  // (`invalido` no es algo que la persona pueda arreglar: cae en el texto genérico «La base no pudo cerrar el día»)
  for (const c of deC) assert.ok(c === 'invalido' || rechazado.includes(`'${c}'`), `cerrar_dia: _cierreNoSeHizo no atiende ${c}`);
  // reabrir_venta_de_cierre (ronda 5a) tampoco usa _textoErrorDeshacer: sus códigos los atiende _reaperturaNoSeHizo, cada uno con su aviso.
  const cuerpoReabrir = sql180.slice(sql180.indexOf('create or replace function public.reabrir_venta_de_cierre('), sql180.indexOf('-- ── 4. Los registros'));
  const deR = new Set([...cuerpoReabrir.matchAll(/'codigo',\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...deR].sort(), ['es_abono', 'invalido', 'mesa_inactiva', 'mesa_inexistente', 'mesa_ocupada', 'no_autorizado', 'no_esta_en_cierre', 'no_existe']);
  const j0 = CODIGO.indexOf('async _reaperturaNoSeHizo(');
  const reapertura = CODIGO.slice(j0, j0 + 5500);
  for (const c of deR) assert.ok(c === 'invalido' || reapertura.includes(`'${c}'`), `reabrir_venta_de_cierre: _reaperturaNoSeHizo no atiende ${c}`);

  assert.ok(!todos.has('ventana_vencida') && !deshacer.includes('ventana_vencida'), 'ya no hay ventana de 10 minutos');
  for (const c of ['enlace_cambio', 'token_invalido']) assert.ok(todos.has(c), `la base emite ${c}`);
  assert.ok(mesas.includes('enlace_cambio'), 'mesas: falta el texto de enlace_cambio');
  assert.ok(todos.has('con_cuenta_abierta') && todos.has('cuenta_ya_cerrada') && todos.has('ultimo_admin'), 'la base sigue emitiendo esos códigos');
});
