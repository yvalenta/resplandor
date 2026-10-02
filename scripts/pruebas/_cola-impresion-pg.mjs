// Las piezas con base de datos de las pruebas de la cola de impresión (20261003120000_cola_impresion.sql):
// las usan migracion-cola-impresion.test.mjs y el corredor de mutantes (que vive fuera del repo).
//
// Este archivo no termina en «.test.mjs»: `node --test scripts/pruebas/*.test.mjs` no lo corre, solo lo importan
// (mismo patrón que _supabase-simulado.mjs, del que depende: un Postgres 17 desechable con los roles de Supabase).
//
//   prepararSimulacion(pg)        las identidades de prueba (.test), auth.*, los ayudantes `t.*` (sql/cola-impresion/00-ayudantes.sql)
//   aplicarMigraciones(pg, dir)   la cadena COMPLETA de migraciones como `migrador` (el «postgres» de Supabase, no superusuario)
//   correrEscenario(pg, archivo)  un archivo de sql/cola-impresion/: devuelve las comprobaciones que fallaron
//   concurrencia(pg)              sesiones reales a la vez (con un portón para que salgan juntas): dos agentes que toman, doble
//                                 confirmación, cancelar contra tomar, el tope en el borde
//   radiografia(pg)               el catálogo de public y privado, para comparar antes / después / tras la reversa
//   reversa(sql)                  el bloque de reversa de la cabecera de la migración
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RAIZ } from './_supabase-simulado.mjs';

export { RAIZ };
export const DIR_MIGRACIONES = path.join(RAIZ, 'supabase/migrations');
export const MIGRACION = '20261003120000_cola_impresion.sql';
export const DIR_SQL = path.join(RAIZ, 'scripts/pruebas/sql/cola-impresion');
export const ESCENARIOS = ['10-permisos.sql', '15-forma-y-tope.sql', '20-cola.sql', '30-admin-y-estado.sql', '40-senal-y-purga.sql'];

const leer = (...partes) => fs.readFileSync(path.join(...partes), 'utf8');

export function prepararSimulacion(pg) {
  const r = pg.sql(leer(DIR_SQL, '00-ayudantes.sql'));
  if (!r.ok) throw new Error('los ayudantes de prueba no cargaron: ' + r.error);
}

/**
 * Aplica las migraciones de `dir` en orden, cada una como `migrador`. `antesDe` / `desde` recortan la cadena por nombre.
 * Devuelve [{archivo, ok, error, avisos}] y se detiene en la primera que falla.
 */
export function aplicarMigraciones(pg, dir = DIR_MIGRACIONES, { antesDe, desde } = {}) {
  const hechas = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    if (antesDe && !(f < antesDe)) continue;
    if (desde && f < desde) continue;
    const r = pg.sql("set resplandor.admins_iniciales = 'admin@resplandor.test';\n" + leer(dir, f), { como: 'migrador' });
    hechas.push({ archivo: f, ok: r.ok, error: r.error, avisos: r.avisos });
    if (!r.ok) break;
  }
  return hechas;
}

/** Corre un archivo de sql/cola-impresion/ y devuelve lo que anotó en t.res desde antes de correrlo. */
export function correrEscenario(pg, archivo) {
  const desde = Number(pg.filas('select coalesce(max(n), 0) as n from t.res')[0].n);
  const r = pg.sql(leer(DIR_SQL, archivo));
  const resultados = pg.filas(`select nombre, ok, detalle from t.res where n > ${desde} order by n`);
  return { archivo, ok: r.ok, error: r.error, avisos: r.avisos, resultados, fallan: resultados.filter((x) => !x.ok) };
}

/** El catálogo que importa, en filas comparables. */
export function radiografia(pg) {
  return {
    relaciones: pg.filas("select n.nspname, c.relname, c.relkind::text as tipo, c.relacl::text as acl, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'privado') and c.relkind in ('r', 'v', 'S', 'i') order by 1, 2"),
    columnas: pg.filas("select a.attrelid::regclass::text as tabla, a.attname, a.attacl::text as acl from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'privado') and a.attnum > 0 and not a.attisdropped and a.attacl is not null order by 1, 2"),
    funciones: pg.filas("select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proacl::text as acl, md5(p.prosrc) as cuerpo from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'privado') order by 1, 2, 3"),
    policies: pg.filas("select schemaname, tablename, policyname, cmd, roles::text as roles, md5(coalesce(qual, '') || coalesce(with_check, '')) as expr from pg_policies order by 1, 2, 3"),
    publicacion: pg.filas("select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1, 2"),
    triggers: pg.filas('select tgrelid::regclass::text as tabla, tgname from pg_trigger where not tgisinternal order by 1, 2'),
    restricciones: pg.filas("select conrelid::regclass::text as tabla, conname from pg_constraint where connamespace in ('public'::regnamespace, 'privado'::regnamespace) order by 1, 2"),
  };
}

/** El bloque «begin; … commit;» que sigue a REVERSA en la cabecera, sin los guiones del margen. */
export function reversa(sql) {
  const lineas = sql.split('\n');
  const r = lineas.findIndex((l) => /^-- REVERSA/.test(l));
  const ini = lineas.findIndex((l, i) => i > r && /^--   begin;\s*$/.test(l));
  const fin = lineas.findIndex((l, i) => i > ini && /^--   commit;\s*$/.test(l));
  if (r < 0 || ini < 0 || fin < 0) throw new Error('no encuentro el bloque de REVERSA (begin … commit) en la cabecera');
  return lineas.slice(ini, fin + 1).map((l) => l.replace(/^--   /, '')).join('\n');
}

// ───────────────────────── sesiones a la vez ─────────────────────────

const esperar = async (cond, { limite = 20000, cada = 40 } = {}) => {
  const hasta = Date.now() + limite;
  while (!cond()) {
    if (Date.now() > hasta) throw new Error('el portón de la carrera no se armó a tiempo');
    await new Promise((r) => setTimeout(r, cada));
  }
};

/** Una sesión de psql dentro del contenedor, con su propio guion. */
function sesion(contenedor, guion) {
  const p = spawn('docker', ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  const fin = new Promise((resolver) => p.on('close', (code) => resolver({ code, salida: out.trim(), error: err.trim() })));
  if (guion != null) { p.stdin.write(guion); p.stdin.end(); }
  return { fin, write: (t) => p.stdin.write(t), end: () => p.stdin.end() };
}

/**
 * Corre varios guiones SQL en sesiones distintas y los suelta JUNTOS: una sesión retiene un candado de aviso exclusivo, cada guion
 * empieza pidiéndolo compartido (y se queda esperando), y cuando todos esperan se libera. Devuelve [{code, salida, error}].
 */
export async function carrera(pg, guiones, llave = 4242) {
  const cuenta = (granted) => Number(pg.filas(`select count(*) as n from pg_locks where locktype = 'advisory' and objid = ${llave} and granted = ${granted}`)[0].n);
  const retiene = sesion(pg.nombre, null);          // sin guion: su entrada queda abierta para no soltar el candado
  retiene.write(`select pg_advisory_lock(${llave});\n`);
  await esperar(() => cuenta(true) >= 1);
  const sesiones = guiones.map((g) => sesion(pg.nombre, `select pg_advisory_lock_shared(${llave});\n${g}`));
  await esperar(() => cuenta(false) >= guiones.length);
  retiene.write(`select pg_advisory_unlock(${llave});\n`);
  retiene.end();
  const res = await Promise.all(sesiones.map((s) => s.fin));
  await retiene.fin;
  return res;
}

/**
 * Las pruebas con sesiones simultáneas. Devuelve la lista de comprobaciones: [{nombre, ok, detalle}].
 * Cada ronda arranca de cero (t.partida()).
 */
export async function concurrencia(pg, { rondas = 8 } = {}) {
  const res = [];
  const anota = (nombre, ok, detalle = '') => res.push({ nombre, ok: Boolean(ok), detalle });
  const sql = (texto) => { const r = pg.sql(texto); if (!r.ok) throw new Error(r.error); return r; };
  const valor = (texto) => pg.sql(texto).salida;

  // ── K1. Tres agentes toman a la vez: ningún trabajo se lo llevan dos ──
  sql(`select t.partida(); select t.nueva_impresora('caja', 'Caja'); select t.nueva_impresora('cocina', 'Cocina');
       drop table if exists t.captura; create table t.captura (n serial, sesion text, id uuid); grant all on t.captura to public; grant usage on sequence t.captura_n_seq to public;
       insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 60);
       insert into public.impresiones (impresora_id, tipo, contenido) select t.pid('cocina'), 'cuenta', t.docj() from generate_series(1, 15);`);
  const agente = (clave, etiqueta) => `set role anon;\n` + Array.from({ length: 30 }, () =>
    `insert into t.captura (sesion, id) select '${etiqueta}', id from public.impresora_tomar(t.tok('${clave}'), 3);`).join('\n');
  const k1 = await carrera(pg, [agente('caja', 'A'), agente('cocina', 'B'), agente('caja', 'C')]);
  anota('K1 las tres sesiones corrieron sin error', k1.every((r) => r.code === 0), k1.map((r) => r.error).join(' | '));
  anota('K1 se tomaron los 75 trabajos', valor('select count(*) from t.captura') === '75', valor('select count(*) from t.captura'));
  anota('K1 ninguno se tomó dos veces (75 ids distintos)', valor('select count(distinct id) from t.captura') === '75', valor('select count(distinct id) from t.captura'));
  anota('K1 todos quedaron imprimiendo con UN solo intento', valor("select count(*) from public.impresiones where estado = 'imprimiendo' and intentos = 1") === '75', valor('select estado || intentos from public.impresiones group by 1'));
  anota('K1 los 15 dirigidos a la cocina solo los tomó la cocina (sesión B)',
    valor("select count(*) from t.captura c join public.impresiones i on i.id = c.id where i.impresora_id is not null and c.sesion <> 'B'") === '0');
  anota('K1 y cada trabajo quedó anotado con quien lo tomó',
    valor('select count(*) from public.impresiones where tomada_por is null') === '0');
  anota('K1 más de una sesión trabajó de verdad (el reparto fue concurrente)', Number(valor('select count(distinct sesion) from t.captura')) >= 2, valor('select string_agg(distinct sesion, $$,$$) from t.captura'));

  // ── K2. Doble confirmación del mismo trabajo ──
  let bien = 0;
  const malos2 = [];
  for (let i = 0; i < rondas; i += 1) {
    sql(`select t.partida(); select t.nueva_impresora('caja', 'Caja'); select t.g('j', t.trabajo('caja', 'doble')::text);
         set role anon; select t.toma('caja', 1);`);
    const guion = "set role anon; select (public.impresora_confirmar(t.tok('caja'), t.vv('j')::uuid, true))::text;";
    const r = await carrera(pg, [guion, guion]);
    const salidas = r.map((x) => x.salida);
    const oks = salidas.filter((s) => s.includes('"ok": true')).length;
    const nos = salidas.filter((s) => s.includes('no_imprimiendo')).length;
    if (r.every((x) => x.code === 0) && oks === 1 && nos === 1 && valor("select estado || '/' || intentos from public.impresiones") === 'impresa/1') bien += 1;
    else malos2.push(salidas.join(' || '));
  }
  anota(`K2 dos confirmaciones a la vez: ${bien} de ${rondas} rondas con UN ok, UN no_imprimiendo y el trabajo impreso una vez`, bien === rondas, malos2[0] || '');

  // ── K3. Cancelar contra tomar: gana uno solo ──
  let ganan = 0;
  const malos3 = [];
  for (let i = 0; i < rondas; i += 1) {
    sql(`select t.partida(); select t.nueva_impresora('caja', 'Caja'); select t.g('j', t.trabajo('caja', 'carrera')::text);`);
    const cancelar = "select t.como('mesero'); select (public.impresion_cancelar(t.vv('j')::uuid))::text;";
    const tomar = "set role anon; select t.toma('caja', 1)::text;";
    const r = await carrera(pg, [cancelar, tomar]);
    const canc = r[0].salida;
    const tomo = r[1].salida;
    const estado = valor("select estado || '/' || intentos || '/' || coalesce(error, '') from public.impresiones");
    const cancelo = canc.includes('"ok": true');
    const coherente = cancelo
      ? (tomo === '0' && estado === 'error/0/cancelada')
      : (tomo === '1' && canc.includes('no_pendiente') && estado === 'imprimiendo/1/');
    if (r.every((x) => x.code === 0) && coherente) ganan += 1;
    else malos3.push(`${canc} · toma=${tomo} · ${estado}`);
  }
  anota(`K3 cancelar contra tomar: ${ganan} de ${rondas} rondas con UN ganador y el estado coherente`, ganan === rondas, malos3[0] || '');

  // ── K4. El tope en el borde: con 29 en el último minuto, dos pulsaciones a la vez dejan pasar UNA ──
  let exactos = 0;
  const malos4 = [];
  for (let i = 0; i < rondas; i += 1) {
    sql(`select t.partida(); select t.nueva_impresora('caja', 'Caja');
         insert into public.impresiones (tipo, contenido, creada_por) select 'cuenta', t.docj(), 'mesero1@resplandor.test' from generate_series(1, 29);`);
    const una = "select t.como('mesero'); insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj());";
    const r = await carrera(pg, [una, una]);
    const pasaron = r.filter((x) => x.code === 0).length;
    const rechazadas = r.filter((x) => x.code !== 0 && x.error.includes('demasiadas impresiones seguidas')).length;
    const total = valor("select count(*) from public.impresiones where creada_por = 'mesero1@resplandor.test'");
    if (pasaron === 1 && rechazadas === 1 && total === '30') exactos += 1;
    else malos4.push(`pasaron=${pasaron} rechazadas=${rechazadas} total=${total} ${r.map((x) => x.error).join(' | ')}`);
  }
  anota(`K4 el tope en el borde: ${exactos} de ${rondas} rondas con UNA que pasa, UNA con RS030 y 30 en total`, exactos === rondas, malos4[0] || '');

  // ── K5. Dos INSERT de 20 filas a la vez de la misma persona: solo cabe uno (20 + 20 > 30) ──
  let unico = 0;
  const malos5 = [];
  for (let i = 0; i < rondas; i += 1) {
    sql("select t.partida(); select t.nueva_impresora('caja', 'Caja');");
    const veinte = "select t.como('mesero'); insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 20);";
    const r = await carrera(pg, [veinte, veinte]);
    const pasaron = r.filter((x) => x.code === 0).length;
    const total = valor("select count(*) from public.impresiones where creada_por = 'mesero1@resplandor.test'");
    if (pasaron === 1 && total === '20' && r.some((x) => x.error.includes('demasiadas impresiones seguidas'))) unico += 1;
    else malos5.push(`pasaron=${pasaron} total=${total} ${r.map((x) => x.error).join(' | ')}`);
  }
  anota(`K5 dos INSERT de 20 a la vez: ${unico} de ${rondas} rondas con uno solo adentro (20 filas, no 40)`, unico === rondas, malos5[0] || '');

  // ── K6. Una mesera y un mesero a la vez no se estorban: cada quien su cupo ──
  sql("select t.partida(); select t.nueva_impresora('caja', 'Caja');");
  const treinta = (quien) => `select t.como('${quien}'); insert into public.impresiones (tipo, contenido) select 'cuenta', t.docj() from generate_series(1, 30);`;
  const k6 = await carrera(pg, [treinta('mesero'), treinta('mesero2')]);
  anota('K6 dos personas distintas, 30 cada una a la vez: pasan las dos', k6.every((x) => x.code === 0) && valor('select count(*) from public.impresiones') === '60', k6.map((x) => x.error).join(' | '));

  // ── K7. Nadie espera a nadie: tomar, caducar y la purga SALTAN lo que otra transacción tiene en las manos ──
  // La sesión A abre una transacción, se queda con unas filas y las retiene 5 s. La B tiene que terminar ANTES de que A suelte
  // (si hiciera cola detrás de A, terminaría después). Se compara contra el reloj de A, no contra un umbral fijo.
  const sinEsperar = async (nombre, preparar, guionA, guionB, esperado) => {
    sql(preparar);
    const a = sesion(pg.nombre, guionA);
    const finA = a.fin.then((r) => ({ ...r, t: Date.now() }));
    // Se espera a que A de verdad tenga sus filas y esté dormida en su pg_sleep (no un plazo fijo: con la máquina cargada, `docker exec`
    // puede tardar más de un segundo en arrancar, y entonces B correría ANTES de que A bloqueara nada y la prueba no probaría nada).
    await esperar(() => Number(pg.sql("select count(*) from pg_stat_activity where wait_event = 'PgSleep'").salida) >= 1, { limite: 60000, cada: 100 });
    const rb = pg.sql(guionB);
    const tB = Date.now();
    const ra = await finA;
    const sinCola = rb.ok && tB < ra.t - 300;
    anota(`K7 ${nombre}: la otra sesión terminó ${ra.t - tB} ms ANTES de que la primera soltara sus filas`, sinCola && esperado(rb.salida), `salida=${rb.salida} ${rb.error}`);
  };
  await sinEsperar('tomar no espera a un agente que tiene trabajos tomados sin cerrar su transacción',
    `select t.partida(); select t.nueva_impresora('caja', 'Caja');
     insert into public.impresiones (impresora_id, tipo, contenido) select t.pid('caja'), 'cuenta', t.docj() from generate_series(1, 6);`,
    "begin; set role anon; select t.toma('caja', 3); select pg_sleep(5); commit;",
    "set role anon; select t.toma('caja', 3);",
    (salida) => salida === '3');
  await sinEsperar('tomar no espera por un trabajo vencido que otra transacción tiene bloqueado (caducar salta lo bloqueado)',
    `select t.partida(); select t.nueva_impresora('caja', 'Caja');
     select t.g('viejo', t.trabajo('caja', 'viejo')::text); select t.g('fresco', t.trabajo('caja', 'fresco')::text);
     select t.envejecer(t.vv('viejo')::uuid, interval '16 minutes');`,
    "begin; select id from public.impresiones where contenido -> 'lineas' -> 0 ->> 'texto' = 'viejo' for update; select pg_sleep(5); commit;",
    "set role anon; select t.toma_textos('caja', 5);",
    (salida) => salida === 'fresco');
  await sinEsperar('un INSERT del POS no espera por la purga de una fila vieja que otra transacción tiene bloqueada',
    `select t.partida(); select t.nueva_impresora('caja', 'Caja');
     select t.g('v1', t.trabajo('caja', 'v1')::text); select t.g('v2', t.trabajo('caja', 'v2')::text);
     update public.impresiones set estado = 'error', error = 'x', creada_en = now() - interval '9 days';`,
    "begin; select id from public.impresiones where contenido -> 'lineas' -> 0 ->> 'texto' = 'v1' for update; select pg_sleep(5); commit;",
    "select t.como('mesero'); insert into public.impresiones (tipo, contenido) values ('cuenta', t.docj()); select t.fuera(); select (select count(*) from public.impresiones where estado = 'error')::text;",
    (salida) => salida.endsWith('1'));

  sql('select t.fuera(); drop table if exists t.captura;');
  return res;
}

// ───────────────────────── las comprobaciones de instalación ─────────────────────────

/** Aplicar la migración otra vez, con datos adentro: sin error, sin avisos, el catálogo igual y los datos intactos. Devuelve los problemas. */
export function comprobarIdempotencia(pg, despues, dir = DIR_MIGRACIONES) {
  const problemas = [];
  const r0 = pg.sql("select t.partida(); select t.nueva_impresora('caja', 'Caja'); select t.trabajo('caja', 'sobrevive'); select t.trabajo(null, 'tambien');");
  if (!r0.ok) return ['no se pudo preparar la prueba de idempotencia: ' + r0.error];
  const filas = () => pg.filas('select (select count(*) from public.impresiones) as trabajos, (select count(*) from public.impresoras) as impresoras, (select string_agg(token_hash, $$,$$ order by token_hash) from public.impresoras) as hashes')[0];
  const f1 = filas();
  const otra = aplicarMigraciones(pg, dir, { desde: MIGRACION });
  if (!otra[0].ok) problemas.push('la segunda aplicación falló: ' + otra[0].error);
  else {
    if (otra[0].avisos.length) problemas.push('la segunda aplicación dejó WARNING: ' + otra[0].avisos.join(' | '));
    if (JSON.stringify(radiografia(pg)) !== JSON.stringify(despues)) problemas.push('la segunda aplicación cambió el catálogo');
    if (JSON.stringify(filas()) !== JSON.stringify(f1)) problemas.push('la segunda aplicación tocó los datos');
  }
  return problemas;
}

/** La reversa de la cabecera, en limpio: el catálogo vuelve a `antes`; y volver a aplicar lo deja como `despues`. Devuelve los problemas. */
export function comprobarReversa(pg, sqlMigracion, antes, despues, dir = DIR_MIGRACIONES) {
  const problemas = [];
  const r = pg.sql(reversa(sqlMigracion), { como: 'migrador' });
  if (!r.ok) return ['la reversa falló: ' + r.error];
  const ahora = radiografia(pg);
  for (const [seccion, filas] of Object.entries(antes)) {
    if (JSON.stringify(ahora[seccion]) !== JSON.stringify(filas)) problemas.push(`tras la reversa quedó distinto: ${seccion}`);
  }
  const otra = aplicarMigraciones(pg, dir, { desde: MIGRACION });
  if (!otra[0].ok) problemas.push('no se pudo volver a aplicar tras la reversa: ' + otra[0].error);
  else if (JSON.stringify(radiografia(pg)) !== JSON.stringify(despues)) problemas.push('reaplicar tras la reversa no dejó el catálogo como la primera vez');
  return problemas;
}

/**
 * Sobre un Postgres NUEVO (sin esta migración): se niega a correr, sin crear nada, si falta la compuerta, realtime.send o el permiso
 * para ejecutarlo. Devuelve los problemas.
 */
export function comprobarPrecondiciones(pg, dir = DIR_MIGRACIONES) {
  const problemas = [];
  const texto = leer(dir, MIGRACION);
  const aplicarMia = () => pg.sql(texto, { como: 'migrador' });
  const previas = aplicarMigraciones(pg, dir, { antesDe: '20261002120000' });
  if (!previas.every((m) => m.ok)) return ['la cadena previa no se aplicó: ' + JSON.stringify(previas.filter((m) => !m.ok))];
  const a0 = radiografia(pg);
  const sinCompuerta = aplicarMia();
  if (sinCompuerta.ok) problemas.push('se aplicó sin la compuerta de personal');
  else if (!/Falta 20261002120000_personal_y_compuerta\.sql.*No se cambió nada/s.test(sinCompuerta.error)) problemas.push('sin compuerta: el error no es el esperado: ' + sinCompuerta.error);
  if (JSON.stringify(radiografia(pg)) !== JSON.stringify(a0)) problemas.push('sin compuerta: dejó objetos creados');

  const comp = aplicarMigraciones(pg, dir, { desde: '20261002120000', antesDe: MIGRACION });
  if (!comp.every((m) => m.ok)) return [...problemas, 'la compuerta no se aplicó: ' + JSON.stringify(comp.filter((m) => !m.ok))];
  const a1 = radiografia(pg);
  pg.sql('alter function realtime.send(jsonb, text, text, boolean) rename to send_apagada;');
  const sinSend = aplicarMia();
  pg.sql('alter function realtime.send_apagada(jsonb, text, text, boolean) rename to send;');
  if (sinSend.ok) problemas.push('se aplicó sin realtime.send');
  else if (!/falta realtime\.send\(jsonb, text, text, boolean\).*No se cambió nada/s.test(sinSend.error)) problemas.push('sin realtime.send: el error no es el esperado: ' + sinSend.error);
  if (JSON.stringify(radiografia(pg)) !== JSON.stringify(a1)) problemas.push('sin realtime.send: dejó objetos creados');

  pg.sql('revoke execute on function realtime.send(jsonb, text, text, boolean) from migrador;');
  const sinPermiso = aplicarMia();
  pg.sql('grant execute on function realtime.send(jsonb, text, text, boolean) to migrador;');
  if (sinPermiso.ok) problemas.push('se aplicó sin permiso para ejecutar realtime.send');
  else if (!/no puede ejecutar realtime\.send.*No se cambió nada/s.test(sinPermiso.error)) problemas.push('sin permiso: el error no es el esperado: ' + sinPermiso.error);
  if (JSON.stringify(radiografia(pg)) !== JSON.stringify(a1)) problemas.push('sin permiso: dejó objetos creados');

  const bien = aplicarMia();
  if (!bien.ok) problemas.push('con todo en orden no se aplicó: ' + bien.error);
  else if (bien.avisos.length) problemas.push('con todo en orden dejó WARNING: ' + bien.avisos.join(' | '));
  return problemas;
}
