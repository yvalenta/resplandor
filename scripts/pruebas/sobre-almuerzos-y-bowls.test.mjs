// El sobre docs/sobres/2026-11-10-almuerzos-y-bowls.sql (tareas/2026-11-10-almuerzos-y-bowls.md) contra un Postgres 17 desechable con
// la cadena COMPLETA de migraciones (Supabase simulado, _supabase-simulado.mjs): lo que Yonatan va a pegar en el SQL Editor, corrido
// antes de que toque producción. Se salta (con el motivo) si no hay Docker.
//
//   · aborta SIN escribir nada si ya hay un bowl con otro id, o si falta o se repite un almuerzo;
//   · pegado: Menú Resplandor y Seco a 20.000 (lo demás de Ejecutivos igual), los cuatro bowls a 15.000 en «Bowls» con
//     «Incluye guarapo», en la carta pública; avisa cuántas cuentas abiertas hay, y una cuenta abierta con el Menú pasa a 20.000
//     (productos_tocan_cuentas: por eso se pega con el local cerrado);
//   · pegarlo otra vez deja lo mismo (sin bowls repetidos), y la reversa de su cabecera vuelve a los precios de antes y saca los
//     bowls de la carta.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarDocker, levantarPostgres, literal } from './_supabase-simulado.mjs';
import { RAIZ, prepararSimulacion, aplicarMigraciones } from './_cola-impresion-pg.mjs';

const SOBRE = fs.readFileSync(path.join(RAIZ, 'docs/sobres/2026-11-10-almuerzos-y-bowls.sql'), 'utf8');
const REVERSA = SOBRE.split('\n').filter((l) => /^--\s+update public\.productos set /.test(l)).map((l) => l.replace(/^--\s+/, '')).join('\n');

test('estática: la cabecera trae la reversa completa (los dos precios de antes y los cuatro bowls fuera) y el sobre no lleva correos', () => {
  assert.match(REVERSA, /set precio = 23000 where categoria = 'Ejecutivos' and nombre = 'Menú Resplandor';/);
  assert.match(REVERSA, /set precio = 19000 where categoria = 'Ejecutivos' and nombre = 'Seco';/);
  assert.match(REVERSA, /set activo = false where id in \('bowl_criollo', 'bowl_mixto', 'bowl_resplandor', 'bowl_arma'\);/);
  assert.doesNotMatch(SOBRE, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ni un correo (el repo es público)');
  assert.match(SOBRE, /PÉGALO CON EL LOCAL CERRADO/);
});

const docker = buscarDocker();
const MOTIVO = docker.motivo ? `${docker.motivo}: se salta la parte con base de datos` : false;

describe('contra un Postgres 17 desechable (Supabase simulado, cadena completa de migraciones)', { skip: MOTIVO }, () => {
  let pg;
  const sql = (texto, opciones = { como: 'migrador' }) => pg.sql(texto, opciones);
  const debe = (texto) => { const r = sql(texto); assert.ok(r.ok, r.error); return r; };
  const pegar = () => sql(SOBRE);
  const catalogo = () => pg.filas(`select id, categoria, nombre, precio, etiqueta, activo, en_carta from public.productos
                                    where categoria in ('Ejecutivos', 'Bowls') order by categoria, nombre`);
  const precio = (nombre) => catalogo().find((f) => f.nombre === nombre)?.precio;
  const cuenta = () => pg.filas(`select items, total from public.ordenes where id = 'zb-o'`)[0];

  before(async () => {
    pg = await levantarPostgres();
    prepararSimulacion(pg);
    const hechas = aplicarMigraciones(pg);
    assert.ok(hechas.length >= 27 && hechas.every((m) => m.ok), `la cadena no se aplicó: ${hechas.filter((m) => !m.ok).map((m) => m.archivo + ' ' + m.error).join(' | ')}`);
    // Ejecutivos como están hoy en producción (carta_publica, 2026-11-10), y una cuenta abierta con un Menú Resplandor.
    debe(`
      insert into public.productos (id, categoria, nombre, precio, activo) values
        ('zb-ej1', 'Ejecutivos', 'Menú Resplandor', 23000, true),
        ('zb-ej2', 'Ejecutivos', 'Seco', 19000, true),
        ('zb-syc', 'Ejecutivos', 'Sopa y carne', 14000, true),
        ('zb-san', 'Ejecutivos', 'Sancocho trifásico', 20000, true);
      insert into public.mesas (id, capacidad, estado, token) values (9301, 4, 'ocupada', lpad(to_hex(9301), 48, 'b'));
      insert into public.ordenes (id, mesa_id, estado, items, total, abierta_en) values
        ('zb-o', 9301, 'abierta', ${literal(JSON.stringify([{ id: 'zb-ej1', nombre: 'Menú Resplandor', precio: 23000, qty: 1, nota: 'Sopa · Pollo' }]))}::jsonb, 0, now());`);
    assert.equal(Number(cuenta().total), 23000, 'la cuenta abierta arranca con el Menú a 23.000');
  });
  after(() => pg?.parar());

  test('aborta sin escribir nada si ya hay un bowl con otro id (creado a mano desde el POS)', () => {
    debe(`insert into public.productos (id, categoria, nombre, precio, activo) values ('prod_hecho_a_mano', 'Bowls', 'Bowl Criollo', 16000, true);`);
    const r = pegar();
    assert.equal(r.ok, false);
    assert.match(r.error, /Ya hay un bowl con otro id: «Bowl Criollo» \(id prod_hecho_a_mano, Bowls\)\. Bórralo o renómbralo desde Productos/);
    assert.equal(precio('Menú Resplandor'), 23000, 'nada se escribió');
    assert.equal(catalogo().filter((f) => f.id.startsWith('bowl_')).length, 0);
    debe(`delete from public.productos where id = 'prod_hecho_a_mano';`);
  });

  test('aborta sin escribir nada si falta o se repite un almuerzo', () => {
    debe(`update public.productos set nombre = 'Seco especial' where id = 'zb-ej2';`);
    let r = pegar();
    assert.equal(r.ok, false);
    assert.match(r.error, /Falta o está repetido un almuerzo: «Seco» en Ejecutivos \(hay 0\)/);
    assert.equal(precio('Menú Resplandor'), 23000, 'nada se escribió');
    debe(`update public.productos set nombre = 'Seco' where id = 'zb-ej2';
          insert into public.productos (id, categoria, nombre, precio, activo) values ('zb-ej1b', 'Ejecutivos', 'Menú Resplandor', 23000, true);`);
    r = pegar();
    assert.equal(r.ok, false);
    assert.match(r.error, /«Menú Resplandor» en Ejecutivos \(hay 2\)/);
    debe(`delete from public.productos where id = 'zb-ej1b';`);
    assert.equal(catalogo().filter((f) => f.id.startsWith('bowl_')).length, 0);
  });

  test('pegado: almuerzos a 20.000, los cuatro bowls a 15.000 con guarapo y en la carta; la cuenta abierta pasa a 20.000; otra vez, lo mismo', () => {
    const r = pegar();
    assert.ok(r.ok, r.error);
    assert.match(r.stderr, /Cuentas abiertas ahora: 1\./, 'avisa cuántas cuentas abiertas hay');
    assert.deepEqual(catalogo().map((f) => [f.categoria, f.nombre, f.precio, f.etiqueta, f.activo, f.en_carta]), [
      ['Bowls', 'Arma tu bowl', 15000, 'Incluye guarapo', true, true],
      ['Bowls', 'Bowl criollo', 15000, 'Incluye guarapo', true, true],
      ['Bowls', 'Bowl mixto', 15000, 'Incluye guarapo', true, true],
      ['Bowls', 'Bowl Resplandor', 15000, 'Incluye guarapo', true, true],
      ['Ejecutivos', 'Menú Resplandor', 20000, null, true, true],
      ['Ejecutivos', 'Sancocho trifásico', 20000, null, true, true],
      ['Ejecutivos', 'Seco', 20000, null, true, true],
      ['Ejecutivos', 'Sopa y carne', 14000, null, true, true],
    ]);
    const carta = pg.filas(`select categoria, nombre, precio, etiqueta, descripcion from public.carta_publica where categoria = 'Bowls' order by nombre`, { como: 'anon' });
    assert.equal(carta.length, 4, 'anon ve los cuatro bowls en la carta pública');
    assert.match(carta.find((f) => f.nombre === 'Arma tu bowl').descripcion, /^Base: arroz, pasta, frijol o mix de lechugas\. Proteína: .+\. Vegetales: .+\. Guarnición: .+\.$/);
    const o = cuenta();
    assert.equal(Number(o.total), 20000, 'productos_tocan_cuentas: la cuenta abierta pasa a 20.000 (por eso se pega con el local cerrado)');
    assert.equal(o.items[0].nota, 'Sopa · Pollo', 'la línea conserva su nota');

    const otra = pegar();
    assert.ok(otra.ok, otra.error);
    assert.equal(catalogo().filter((f) => f.categoria === 'Bowls').length, 4, 'pegarlo otra vez no repite bowls');
    assert.equal(precio('Seco'), 20000);
  });

  test('la reversa de la cabecera vuelve a 23.000 y 19.000 y saca los bowls de la carta sin borrarlos', () => {
    debe(REVERSA);
    assert.equal(precio('Menú Resplandor'), 23000);
    assert.equal(precio('Seco'), 19000);
    assert.equal(catalogo().filter((f) => f.categoria === 'Bowls' && f.activo).length, 0);
    assert.equal(catalogo().filter((f) => f.categoria === 'Bowls').length, 4, 'siguen en la tabla (su historia en ventas no se pierde)');
    assert.equal(pg.filas(`select 1 from public.carta_publica where categoria = 'Bowls'`, { como: 'anon' }).length, 0);
  });
});
