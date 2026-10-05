// Arnés manual (no es .test.mjs: no corre en la suite): node scripts/pruebas/arnes/precio-vivo-pg.mjs — pide Docker; con la máquina cargada tarda ~8 min.
// Arnés desechable: la migración 20261005100000_precio_vivo_y_promos.sql contra un Postgres 17 en Docker,
// con toda la cadena de migraciones del repo. Imprime una línea por comprobación (ok / FALLA) y resume.
import { levantarPostgres } from '../_supabase-simulado.mjs';
import { prepararSimulacion, aplicarMigraciones } from '../_cola-impresion-pg.mjs';

const t0 = Date.now();
const pg = await levantarPostgres();
let fallas = 0;
const ok = (nombre, cond, detalle = '') => { console.log((cond ? 'ok    ' : 'FALLA ') + nombre + (cond ? '' : '  → ' + detalle)); if (!cond) fallas++; };
try {
  prepararSimulacion(pg);
  const hechas = aplicarMigraciones(pg);
  const mala = hechas.find((h) => !h.ok);
  ok('cadena de migraciones (' + hechas.length + ')', !mala, mala ? mala.archivo + ': ' + mala.error.slice(0, 600) : '');
  if (mala) throw new Error('migraciones');
  const avisos = hechas.flatMap((h) => h.avisos);
  ok('sin WARNING al migrar', avisos.length === 0, avisos.join(' | ').slice(0, 400));

  // Productos de prueba (dentro de la base simulada ya hay datos de otras pruebas: se usan ids propios).
  let r = pg.sql(`
    insert into public.productos (id, categoria, nombre, precio, activo) values
      ('t-ej1','Ejecutivos','Menú Resplandor',23000,true),
      ('t-ej2','Ejecutivos','Seco',19000,true),
      ('t-en1','Entradas','Papas Resplandor',25000,true),
      ('t-en2','Entradas','Arepitas montadas',12000,true),
      ('t-be1','Bebidas','Margarita',30000,true),
      ('t-be2','Bebidas','Cerveza',10000,true);
    insert into public.productos (id, categoria, nombre, precio, activo, etiqueta, dia_semana, promo_regla) values
      ('t-pr3','Promociones','3er almuerzo',0,true,'20% OFF',1,'{"cada":3,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}'),
      ('t-pr2','Promociones','Entradas de la carta',0,true,'2 x 1',6,'{"cada":2,"descuento":100,"aplica":{"categorias":["Entradas"]}}'),
      ('t-prb','Promociones','Cócteles, jugos y sodas',0,true,'2 x 1',3,'{"cada":2,"descuento":100,"aplica":{"productos":["t-be1"]}}'),
      ('t-prf','Promociones','Almuerzos',20000,true,null,7,null);
  `);
  ok('productos de prueba', r.ok, r.error);

  // Una regla inválida choca con el CHECK.
  r = pg.sql(`insert into public.productos (id, categoria, nombre, precio, activo, promo_regla) values ('t-mala','Promociones','Mala',0,true,'{"cada":1,"descuento":20,"aplica":{"categorias":["Ejecutivos"]}}');`);
  ok('regla inválida rechazada por el CHECK', !r.ok && /productos_promo_regla_valida/.test(r.error), r.error.slice(0, 200));
  r = pg.sql(`insert into public.productos (id, categoria, nombre, precio, activo, promo_regla) values ('t-mala','Promociones','Mala',0,true,'{"cada":2,"descuento":50,"aplica":{"categorias":[]}}');`);
  ok('regla sin aplica rechazada', !r.ok, r.error.slice(0, 200));

  // Mesas de prueba (token de 48 hex).
  r = pg.sql(`insert into public.mesas (id, capacidad, estado, token) values (91,4,'ocupada',repeat('a',48)),(92,4,'ocupada',repeat('b',48)),(93,4,'ocupada',repeat('c',48)),(94,4,'ocupada',repeat('d',48)) on conflict (id) do nothing;`);
  ok('mesas de prueba', r.ok, r.error);

  const items = (id) => pg.filas(`select items, total, version from public.ordenes where id = '${id}'`)[0];
  const linea = (o, id) => o.items.find((i) => i.id === id);

  // ── Lunes (2026-10-05 12:00 Bogotá = 17:00 UTC): 3er almuerzo ──
  r = pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('t-o1', 91, 'abierta', '[]', 0, '2026-10-05 17:00:00+00');`);
  ok('orden abierta del lunes', r.ok, r.error);
  r = pg.sql(`select public.aplicar_delta_orden('t-o1','t-ej1','Menú Resplandor',23000,2,'');`);
  ok('delta +2 Menú', r.ok, r.error);
  let o = items('t-o1');
  ok('con 2 almuerzos no hay promo', o.items.length === 1 && Number(o.total) === 46000, JSON.stringify(o));
  r = pg.sql(`select public.aplicar_delta_orden('t-o1','t-ej2','Seco',19000,1,'');`);
  o = items('t-o1');
  const pr = linea(o, 'promo:t-pr3:t-ej2');
  ok('3 almuerzos: el Seco (el más barato) sale como línea de promo a 15.200', !!pr && Number(pr.precio) === 15200 && pr.qty === 1 && !linea(o, 't-ej2'), JSON.stringify(o));
  ok('nombre discriminado: «Seco · 3er almuerzo · 20% OFF»', pr && pr.nombre === 'Seco · 3er almuerzo · 20% OFF', pr && pr.nombre);
  ok('total 46.000 + 15.200', Number(o.total) === 61200, String(o.total));
  ok('la línea de promo recuerda su base', pr && pr.promo && pr.promo.de === 't-ej2' && Number(pr.promo.precio) === 19000 && pr.promo.descuento === 20, JSON.stringify(pr && pr.promo));
  const v1 = o.version;
  // Otro Seco: 4 unidades → 1 con descuento, el Seco base vuelve con 1.
  r = pg.sql(`select public.aplicar_delta_orden('t-o1','t-ej2','Seco',19000,1,'');`);
  o = items('t-o1');
  ok('4 almuerzos: Seco ×1 a 19.000 + Seco promo ×1 a 15.200', linea(o, 't-ej2')?.qty === 1 && linea(o, 'promo:t-pr3:t-ej2')?.qty === 1 && Number(o.total) === 80200, JSON.stringify(o));
  // Un sexto almuerzo: 6 unidades → 2 con descuento. 3 Menú + 3 Seco: orden desc [23,23,23,19,19,19] → 3.º = Menú (18.400), 6.º = Seco (15.200).
  r = pg.sql(`select public.aplicar_delta_orden('t-o1','t-ej1','Menú Resplandor',23000,1,''); select public.aplicar_delta_orden('t-o1','t-ej2','Seco',19000,1,'');`);
  o = items('t-o1');
  ok('6 almuerzos: 3.º Menú a 18.400 y 6.º Seco a 15.200', Number(linea(o, 'promo:t-pr3:t-ej1')?.precio) === 18400 && Number(linea(o, 'promo:t-pr3:t-ej2')?.precio) === 15200 && Number(o.total) === 2 * 23000 + 18400 + 2 * 19000 + 15200, JSON.stringify(o));
  // Quitar una unidad desde la línea de promo: pliega y recalcula (5 unidades → 1 descuento sobre el 3.º = Menú).
  r = pg.sql(`select public.aplicar_delta_orden('t-o1','promo:t-pr3:t-ej2','Seco · 3er almuerzo · 20% OFF',15200,-1,'');`);
  o = items('t-o1');
  ok('−1 sobre la línea de promo: quedan 5 (3 Menú, 2 Seco), 1 descuento sobre el Menú', linea(o, 't-ej1')?.qty === 2 && Number(linea(o, 'promo:t-pr3:t-ej1')?.precio) === 18400 && linea(o, 't-ej2')?.qty === 2 && !linea(o, 'promo:t-pr3:t-ej2'), JSON.stringify(o));
  ok('la versión sube con cada cambio', o.version > v1, String(o.version));

  // ── Precio vivo: cambia el Menú a 25.000 → la cuenta abierta lo sigue (y el descuento también). ──
  const vAntes = items('t-o1').version;
  r = pg.sql(`update public.productos set precio = 25000 where id = 't-ej1';`);
  ok('cambio de precio sin error ni WARNING', r.ok && r.avisos.length === 0, r.error + ' ' + r.avisos.join('|'));
  o = items('t-o1');
  ok('precio vivo: el Menú de la cuenta pasa a 25.000 y el 3.º a 20.000', Number(linea(o, 't-ej1')?.precio) === 25000 && Number(linea(o, 'promo:t-pr3:t-ej1')?.precio) === 20000 && Number(o.total) === 2 * 25000 + 20000 + 2 * 19000, JSON.stringify(o));
  ok('la versión subió con el precio (el POS adopta el eco)', o.version > vAntes, `${vAntes} → ${o.version}`);
  // Un cambio que no toca precio ni regla no mueve la versión.
  const vIgual = o.version;
  r = pg.sql(`update public.productos set descripcion = 'otra' where id = 't-ej1';`);
  o = items('t-o1');
  ok('cambiar la descripción no toca la cuenta', o.version === vIgual, `${vIgual} → ${o.version}`);

  // ── Líneas que no se tocan: manual, abono, para_llevar, variante. ──
  r = pg.sql(`select public.aplicar_delta_orden('t-o1','manual_x','Propina',5000,1,''); select public.aplicar_delta_orden('t-o1','para_llevar','Para llevar',0,1,''); select public.aplicar_delta_orden('t-o1','t-be2__sin-vaso','Cerveza',9000,1,'sin vaso');`);
  o = items('t-o1');
  ok('manual y marcador quedan como llegaron', Number(linea(o, 'manual_x')?.precio) === 5000 && linea(o, 'para_llevar')?.qty === 1, JSON.stringify(o.items.filter((i) => /manual|llevar/.test(i.id))));
  ok('variante (t-be2__sin-vaso) toma el precio del producto (10.000)', Number(linea(o, 't-be2__sin-vaso')?.precio) === 10000, JSON.stringify(linea(o, 't-be2__sin-vaso')));
  r = pg.sql(`update public.ordenes set items = items || '[{"id":"abono_recibido_1","nombre":"Abono recibido","precio":-10000,"qty":1,"nota":"efectivo"}]'::jsonb where id = 't-o1';`);
  o = items('t-o1');
  ok('el abono (precio negativo) sigue intacto y el total lo descuenta', Number(linea(o, 'abono_recibido_1')?.precio) === -10000 && Number(o.total) === 2 * 25000 + 20000 + 2 * 19000 + 5000 + 10000 - 10000, JSON.stringify(o));

  // ── Cerrar: el cobro sube con lo de hoy; después, un cambio de precio NO toca la cerrada. ──
  r = pg.sql(`update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = 't-o1';`);
  ok('cobro', r.ok, r.error);
  r = pg.sql(`update public.productos set precio = 26000 where id = 't-ej1';`);
  o = items('t-o1');
  ok('la cuenta cerrada conserva 25.000', Number(linea(o, 't-ej1')?.precio) === 25000, JSON.stringify(linea(o, 't-ej1')));

  // ── Domingo (2026-10-04 17:00 UTC): 3 almuerzos sin promo (el 3er almuerzo es del lunes); la de precio fijo es un producto más. ──
  r = pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('t-o2', 92, 'abierta', '[]', 0, '2026-10-04 17:00:00+00');
    select public.aplicar_delta_orden('t-o2','t-ej2','Seco',19000,3,''); select public.aplicar_delta_orden('t-o2','t-prf','Almuerzos',20000,1,'');`);
  o = items('t-o2');
  ok('domingo: 3 Secos sin descuento y el Almuerzo de 20.000 como producto', o.items.length === 2 && Number(o.total) === 3 * 19000 + 20000, JSON.stringify(o));

  // ── Sábado (2026-10-03 17:00 UTC): 2x1 en entradas, la más barata gratis; y a medianoche de Bogotá sigue siendo sábado. ──
  r = pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('t-o3', 93, 'abierta', '[]', 0, '2026-10-04 03:30:00+00');
    select public.aplicar_delta_orden('t-o3','t-en1','Papas Resplandor',25000,1,''); select public.aplicar_delta_orden('t-o3','t-en2','Arepitas montadas',12000,2,'');`);
  o = items('t-o3');
  ok('sábado (22:30 Bogotá): 3 entradas → 1 Arepitas gratis', Number(linea(o, 'promo:t-pr2:t-en2')?.precio) === 0 && linea(o, 'promo:t-pr2:t-en2')?.qty === 1 && linea(o, 't-en2')?.qty === 1 && Number(o.total) === 25000 + 12000, JSON.stringify(o));
  // Una promo por productos sueltos (miércoles 2026-10-07): 2 Margaritas → 1 gratis; la cerveza no entra.
  r = pg.sql(`insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values ('t-o4', 94, 'abierta', '[]', 0, '2026-10-07 17:00:00+00');
    select public.aplicar_delta_orden('t-o4','t-be1','Margarita',30000,2,''); select public.aplicar_delta_orden('t-o4','t-be2','Cerveza',10000,2,'');`);
  o = items('t-o4');
  ok('miércoles: 2 Margaritas → 1 gratis; 2 cervezas intactas', Number(linea(o, 'promo:t-prb:t-be1')?.precio) === 0 && linea(o, 't-be1')?.qty === 1 && linea(o, 't-be2')?.qty === 2 && Number(o.total) === 30000 + 20000, JSON.stringify(o));
  // Apagar la promo (activo = false) la quita de las cuentas abiertas.
  r = pg.sql(`update public.productos set activo = false where id = 't-prb';`);
  o = items('t-o4');
  ok('promo desactivada: la cuenta vuelve a 2 Margaritas a 30.000', linea(o, 't-be1')?.qty === 2 && !linea(o, 'promo:t-prb:t-be1') && Number(o.total) === 80000, JSON.stringify(o));

  // ── normalizar_items es idempotente y una línea de promo huérfana vuelve a ser base. ──
  const dos = pg.filas(`select privado.normalizar_items(privado.normalizar_items(items, 1::smallint), 1::smallint) = privado.normalizar_items(items, 1::smallint) as igual from public.ordenes where id = 't-o1'`)[0];
  ok('normalizar dos veces = una vez', dos.igual === true, JSON.stringify(dos));
  const huerfana = pg.filas(`select privado.normalizar_items('[{"id":"promo:t-pr3:t-ej2","nombre":"Seco · 3er almuerzo","precio":15200,"qty":2,"nota":"","promo":{"id":"t-pr3","de":"t-ej2","nombre":"Seco","precio":19000,"descuento":20}}]'::jsonb, 7::smallint) as r`)[0].r;
  ok('promo huérfana en domingo → vuelve a ser «Seco ×2 a 19.000»', huerfana.length === 1 && huerfana[0].id === 't-ej2' && huerfana[0].qty === 2 && Number(huerfana[0].precio) === 19000, JSON.stringify(huerfana));

  // ── Reversa y re-aplicación. ──
  const migracion = (await import('node:fs')).readFileSync(new URL('../../../supabase/migrations/20261005100000_precio_vivo_y_promos.sql', import.meta.url), 'utf8');
  const bloque = migracion.split('REVERSA')[1].split('\n').filter((l) => /^--   /.test(l)).map((l) => l.replace(/^--   /, '')).join('\n');
  r = pg.sql(bloque, { como: 'migrador' });
  ok('la reversa de la cabecera corre', r.ok, r.error.slice(0, 300));
  const sin = pg.filas(`select count(*)::int as n from pg_trigger where tgname in ('trg_ordenes_a_precio_vivo','productos_tocan_cuentas')`)[0].n;
  ok('sin triggers tras la reversa', sin === 0, String(sin));
  r = pg.sql("set resplandor.admins_iniciales = 'admin@resplandor.test';\n" + migracion, { como: 'migrador' });
  ok('la migración vuelve a aplicarse (idempotente)', r.ok && r.avisos.length === 0, r.error.slice(0, 300) + r.avisos.join('|'));
  r = pg.sql("set resplandor.admins_iniciales = 'admin@resplandor.test';\n" + migracion, { como: 'migrador' });
  ok('dos veces seguidas', r.ok, r.error.slice(0, 300));
} catch (e) {
  console.log('ERROR ' + (e && e.stack || e));
  fallas++;
} finally {
  try { pg.parar(); } catch {}
}
console.log(`\n${fallas === 0 ? 'TODO OK' : fallas + ' FALLA(S)'} en ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(fallas ? 1 : 0);
