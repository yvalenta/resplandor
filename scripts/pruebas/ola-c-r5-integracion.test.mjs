// Ola C, ronda 5, INTEGRACIÓN de las dos ramas (r5a «simplificar» y r5b «tablero»), que tocaron el mismo pos.html por separado.
// Lo que ninguna veía sola:
//   1. Todo `$store.pos.<nombre>` que el marcado usa existe en el store, en particular lo del tablero y lo de la hoja «Cierre sin respaldo» (r5a). El tablero
//      se escribió sin esa hoja y la hoja sin el tablero: aquí se cruzan.
//   2. La hoja de los cierres viejos es ALCANZABLE desde el tablero: se abre sola al arrancar (una vez por sesión) y, si el admin la cerró, la tarjeta de
//      «Cierres e historial» se destaca («Por decidir») y la vuelve a abrir con «Revisar el cierre sin respaldo». El mesero no la ve ni la abre.
//   3. Mientras haya un cierre viejo sin decidir, «Cerrar día» sigue apagado desde el tablero también (ver `razonCierreDia`).
// Con el <script> REAL en un `vm`; el comportamiento con Chromium vive en ola-c-r5-integracion-navegador.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asentar, crearBaseFalsa, crearPos, hastaQue } from './_pos-vm.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POS = fs.readFileSync(path.join(RAIZ, 'pos.html'), 'utf8');
const sinHtmlComentarios = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

const YO = { id: 'u1', email: 'yo@ejemplo.test', user_metadata: { full_name: 'Yo' } };
async function montar(rol) {
  const base = crearBaseFalsa({ rol, olaC: true });
  const t = crearPos({ base, extras: { setInterval() { return 1; }, clearInterval() {} }, documento: { title: 'POS', visibilityState: 'visible' } });
  t.base = base; t.pos.usuario = YO;
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  await asentar();
  return t;
}
const CIERRE_VIEJO = { id: 'viejo', fecha: '2026-09-30T12:30:00-05:00', total: 30000, sync: 'error', purgar: ['v1'], ordenes: [{ id: 'v1', mesaId: 5, estado: 'cerrada', items: [{ id: 'be6', nombre: 'Paloma', precio: 15000, qty: 2, nota: '' }], total: 30000, version: 0 }] };

// ───────────────────────── 1. los nombres del marcado existen en el store ─────────────────────────

test('r5 integración §1: TODO nombre del store que usa el marcado existe (el tablero de r5b y la hoja «Cierre sin respaldo» de r5a incluidos)', async () => {
  const t = await montar('admin');
  const pos = t.pos;
  const marcado = sinHtmlComentarios(POS.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));      // el marcado = todo menos los <script> y los comentarios
  const nombres = new Set();
  for (const m of marcado.matchAll(/\$store\.pos\.([A-Za-z_$][\w$]*)/g)) nombres.add(m[1]);
  for (const m of marcado.matchAll(/Alpine\.store\('pos'\)\.([A-Za-z_$][\w$]*)/g)) nombres.add(m[1]);
  assert.ok(nombres.size > 150, `se esperaban muchos nombres y salieron ${nombres.size}: ¿cambió el recorte del marcado?`);
  const faltan = [...nombres].filter((n) => !(n in pos)).sort();
  assert.deepEqual(faltan, [], `el marcado usa nombres que el store no tiene: ${faltan.join(', ')}`);
  // Y en particular los de las dos ramas.
  for (const n of ['tableroHoy', 'tableroPersonal', 'tableroMenu', 'tableroMesas', 'tableroProductos', 'tableroTicket', 'tableroCierre', 'tableroDeshechos', 'tableroAlertas', 'tableroImpresora',
                   'tieneImpresora', 'enAdministracion', 'accionTablero', 'cargarTablero', 'menuActual', 'impresora',
                   'cierresViejos', 'cierreViejoVista', 'cierreViejoResumen', 'modalCierresViejos', 'abrirCierresViejos', 'cerrarCierresViejos', 'subiendoCierreViejo', 'confirmandoDescarte']) {
    assert.ok(n in pos, `falta «${n}» en el store`);
  }
});

test('r5 integración §1: el tablero y la hoja viven en pos.html una sola vez (el merge no duplicó bloques)', () => {
  for (const marca of ['<!-- ▼ PARTE ola-c-r5 :: tablero -->', '<!-- ▲ PARTE ola-c-r5 :: tablero -->', '/* ▼ PARTE ola-c-r5 :: css */', 'id="cierre-viejo-titulo"', 'id="cierre-viejo-aviso"', 'id="reabrir-razon"', 'id="historial-cierres"']) {
    assert.equal(POS.split(marca).length - 1, 1, `«${marca}» debe aparecer una sola vez`);
  }
  for (const f of ['get tableroCierre()', 'accionTablero(accion)', 'async abrirCierresViejos() {', '_ofrecerCierresViejos() {', 'get enAdministracion()']) {
    assert.equal(POS.split(f).length - 1, 1, `«${f}» se define una sola vez`);
  }
});

// ───────────────────────── 2. la hoja de los cierres viejos desde el tablero ─────────────────────────

test('r5 integración §2: con un cierre viejo sin decidir, la tarjeta de Cierres se destaca, lo dice y «Revisar el cierre sin respaldo» abre la hoja', async () => {
  const t = await montar('admin');
  const p = t.pos;
  // Sin cierre viejo: la tarjeta es la de siempre.
  assert.equal(p.tableroCierre.viejos, 0);
  assert.equal(p.tableroCierre.destacada, false);
  assert.equal(p.accionTablero('revisar-cierre-viejo'), false, 'sin cierre viejo no hay nada que revisar');
  assert.equal(p.modalCierresViejos, false);
  // Con uno: se destaca y su detalle dice qué hacer.
  p.cierresViejos = [CIERRE_VIEJO];
  assert.equal(p.tableroCierre.viejos, 1);
  assert.equal(p.tableroCierre.destacada, true);
  assert.equal(p.tableroCierre.detalle, 'Hay un cierre sin respaldo de la versión anterior: decide qué hacer con él');
  p.cierresViejos = [CIERRE_VIEJO, { ...CIERRE_VIEJO, id: 'viejo2' }];
  assert.equal(p.tableroCierre.detalle, 'Hay 2 cierres sin respaldo de la versión anterior: decide qué hacer con ellos');
  // La acción abre la hoja y la compara con la base (lectura propia).
  assert.equal(p.accionTablero('revisar-cierre-viejo'), true);
  assert.equal(p.modalCierresViejos, true, 'la hoja se abrió desde el tablero');
  await hastaQue(() => p.cierreViejoVista && p.cierreViejoVista.cargando === false);
  assert.ok(p.cierreViejoVista.filas.length >= 1, 'y enseña la venta del cierre');
  p.cerrarCierresViejos();
  assert.equal(p.modalCierresViejos, false);
  assert.equal(p.cierresViejos.length, 2, 'cerrar la hoja no decide nada: el cierre sigue esperando');
  assert.equal(p.tableroCierre.destacada, true, 'y la tarjeta lo sigue pidiendo');
  // Decidido (se descarta el local): la tarjeta vuelve a la normalidad.
  p.cierresViejos = [];
  assert.equal(p.tableroCierre.destacada, false);
  assert.equal(p.tableroCierre.detalle === 'Último cierre' || p.tableroCierre.detalle === 'El primero sale al cerrar el día', true);
});

test('r5 integración §2: la hoja se ofrece sola al admin al arrancar (con red y una vez por sesión) y de la tarjeta no depende', async () => {
  const base = crearBaseFalsa({ rol: 'admin', olaC: true });
  const almacen = new Map([['pos_cierres', JSON.stringify([CIERRE_VIEJO])]]);
  const t = crearPos({ base, almacen, extras: { setInterval() { return 1; }, clearInterval() {} }, documento: { title: 'POS', visibilityState: 'visible' } });
  t.pos.usuario = YO;
  await t.pos.arrancarApp();
  await hastaQue(() => t.pos.remoto === 'ok');
  await hastaQue(() => t.pos.modalCierresViejos === true);
  assert.equal(t.pos.modalCierresViejos, true, 'al arrancar, la hoja se abre sola');
  assert.equal(t.pos.cierresViejos.length, 1, 'el cierre viejo salió de `cierres` y quedó aparte');
  t.pos.cerrarCierresViejos();
  t.pos.irA('admin');
  await asentar();
  assert.equal(t.pos.modalCierresViejos, false, 'ir al tablero no la vuelve a abrir sola (una vez por sesión)');
  assert.equal(t.pos.tableroCierre.destacada, true, 'pero la tarjeta sí la ofrece');
  assert.equal(t.pos.accionTablero('revisar-cierre-viejo'), true);
  assert.equal(t.pos.modalCierresViejos, true);
});

test('r5 integración §2: el mesero no ve la tarjeta destacada ni abre la hoja (decidir un cierre es del admin)', async () => {
  const t = await montar('mesero');
  const p = t.pos;
  p.cierresViejos = [CIERRE_VIEJO];
  assert.equal(p.tableroCierre.viejos, 0, 'el getter no cuenta lo que el rol no puede decidir');
  assert.equal(p.tableroCierre.destacada, false);
  assert.equal(p.accionTablero('revisar-cierre-viejo'), false, 'ni la acción: el tablero entero es del admin');
  assert.equal(p.modalCierresViejos, false);
  await p.abrirCierresViejos();
  assert.equal(p.modalCierresViejos, false, 'tampoco directamente');
});

test('r5 integración §3: mientras haya un cierre viejo sin decidir «Cerrar día» está apagado y lo dice; decidirlo lo libera', async () => {
  const t = await montar('admin');
  const p = t.pos;
  p.cierresViejos = [CIERRE_VIEJO];
  const razon = p.razonSinCierre;
  assert.match(String(razon), /Hay un cierre sin respaldo de la versión anterior: decide qué hacer con él/);
  p.cierresViejos = [];
  assert.doesNotMatch(String(p.razonSinCierre || ''), /cierre sin respaldo/);
});
