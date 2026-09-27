// Pruebas de assets/js/solicitud.js: la única fuente del mensaje de WhatsApp para
// reservar, cotizar una celebración o programar un almuerzo.
//
// local.js y solicitud.js son scripts clásicos (globalThis.RESPLANDOR /
// RESPLANDOR_SOLICITUD); se cargan por su efecto secundario con `require`, igual que en
// scripts/descubrimiento.mjs. Sin paquetes: node:test + node:assert/strict, Node 22.
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(RAIZ, 'assets/js/local.js'));
require(join(RAIZ, 'assets/js/solicitud.js'));

const R = globalThis.RESPLANDOR;
const S = globalThis.RESPLANDOR_SOLICITUD;

test('cable trampa: la capacidad es 30 y todo evento es en el local', () => {
  assert.equal(R.capacidad, 30);
  assert.equal(R.politicas.eventosSoloEnElLocal, true);
  assert.equal(R.politicas.almuerzoDomicilioCostoCliente, true);
  assert.equal(S.MAX_PERSONAS, 30);
});

test('TIPOS: reserva, almuerzo y celebraciones existen; ids únicos', () => {
  const ids = S.TIPOS.map((t) => t.id);
  assert.ok(ids.includes('reserva'));
  assert.ok(ids.includes('almuerzo'));
  assert.ok(ids.includes('otra'));
  assert.equal(new Set(ids).size, ids.length);
  for (const t of S.TIPOS) assert.equal(typeof t.etiqueta, 'string');
});

test('mensaje dorado: reserva de mesa con fecha, hora, personas, nombre y nota', () => {
  const r = S.armarSolicitud({
    tipo: 'reserva',
    fecha: '2026-10-03',
    hora: '19:00',
    personas: 4,
    nombre: '  Ana   Pérez  ',
    nota: 'Cerca de la ventana\r\npor favor',
  });
  assert.deepEqual(r.avisos, []);
  assert.equal(r.datos.tipo, 'reserva');
  assert.equal(r.datos.nombre, 'Ana Pérez');
  assert.equal(
    r.mensaje,
    [
      '¡Hola, Resplandor Restaurante! Quiero hacer esta solicitud:',
      '',
      'Tipo: Reserva de mesa',
      'Fecha: 2026-10-03',
      'Hora: 19:00',
      'Personas: 4',
      'A nombre de: Ana Pérez',
      'Nota: Cerca de la ventana / por favor',
      '',
      `Lugar: ${R.marca} — ${R.direccion}`,
    ].join('\n'),
  );
  assert.equal(r.enlace, `https://wa.me/${R.whatsapp}?text=${encodeURIComponent(r.mensaje)}`);
});

test('mensaje mínimo: solo el tipo, sin datos opcionales', () => {
  const r = S.armarSolicitud({ tipo: 'cumpleanos-infantil' });
  assert.deepEqual(r.avisos, []);
  assert.equal(
    r.mensaje,
    ['¡Hola, Resplandor Restaurante! Quiero hacer esta solicitud:', '', 'Tipo: Cumpleaños infantil', '', `Lugar: ${R.marca} — ${R.direccion}`].join('\n'),
  );
});

test('sin tipo: cae a «otra» sin aviso (es un campo opcional, no un valor inválido)', () => {
  const r = S.armarSolicitud({});
  assert.equal(r.datos.tipo, 'otra');
  assert.deepEqual(r.avisos, []);
});

test('tipo «» (el <option> «Elige una opción…», o reiniciar()) cae a «otra» sin aviso, igual que undefined', () => {
  const r = S.armarSolicitud({ tipo: '' });
  assert.equal(r.datos.tipo, 'otra');
  assert.deepEqual(r.avisos, []);
});

test('tipo inválido: cae a «otra» con aviso', () => {
  const r = S.armarSolicitud({ tipo: 'boda-en-la-playa' });
  assert.equal(r.datos.tipo, 'otra');
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /no existe/);
});

test('personas > 30 se recorta a 30 con aviso que menciona la capacidad', () => {
  const r = S.armarSolicitud({ tipo: 'evento-corporativo', personas: 45 });
  assert.equal(r.datos.personas, 30);
  assert.ok(r.avisos.some((a) => /capacidad es 30/i.test(a)));
  assert.match(r.mensaje, /Personas: 30/);
});

test('personas inválidas (0, negativas, decimales) se ignoran con aviso, no rompen la solicitud', () => {
  for (const personas of [0, -3, 2.5, 'muchas']) {
    const r = S.armarSolicitud({ tipo: 'reserva', personas });
    assert.equal(r.datos.personas, null);
    assert.ok(r.avisos.some((a) => /personas/i.test(a)));
  }
});

test('entrega solo aplica al almuerzo: si de verdad pidieron domicilio en otro tipo, se ignora con aviso', () => {
  const r = S.armarSolicitud({ tipo: 'reserva', entrega: 'domicilio', direccion: 'Calle 1' });
  assert.equal(r.datos.entrega, null);
  assert.ok(r.avisos.some((a) => /solo en el local/i.test(a)));
  assert.doesNotMatch(r.mensaje, /domicilio/i);
});

test('entrega:"recoger" (el valor por defecto del formulario) en un tipo que no es almuerzo NO da aviso falso', () => {
  // Hallazgo: el formulario de la landing siempre manda datos.entrega:'recoger' (nunca
  // undefined), aunque el campo ni se muestre fuera de almuerzo. El aviso «los eventos
  // son solo en el local» solo tiene sentido cuando alguien pidió domicilio de verdad.
  for (const tipo of ['reserva', 'cumpleanos-infantil', 'evento-corporativo', 'otra']) {
    const r = S.armarSolicitud({ tipo, entrega: 'recoger' });
    assert.deepEqual(r.avisos, [], `tipo ${tipo} con entrega:'recoger' no debería avisar nada`);
  }
});

test('almuerzo: recoger por defecto, sin línea de domicilio', () => {
  const r = S.armarSolicitud({ tipo: 'almuerzo', frecuencia: 'semanal' });
  assert.equal(r.datos.entrega, 'recoger');
  assert.deepEqual(r.avisos, []);
  assert.match(r.mensaje, /Entrega: recojo en el local/);
  assert.doesNotMatch(r.mensaje, /domicilio/i);
});

test('almuerzo a domicilio con dirección: línea «El domicilio corre por mi cuenta»', () => {
  const r = S.armarSolicitud({ tipo: 'almuerzo', entrega: 'domicilio', direccion: 'Calle 10 # 5-20', frecuencia: 'diaria' });
  assert.deepEqual(r.avisos, []);
  assert.equal(r.datos.direccion, 'Calle 10 # 5-20');
  assert.match(r.mensaje, /Entrega: a domicilio, Calle 10 # 5-20/);
  assert.match(r.mensaje, /El domicilio corre por mi cuenta\./);
});

test('almuerzo a domicilio SIN dirección: aviso claro, no rompe el mensaje', () => {
  const r = S.armarSolicitud({ tipo: 'almuerzo', entrega: 'domicilio' });
  assert.ok(r.avisos.some((a) => /falta la dirección/i.test(a)));
  assert.match(r.mensaje, /Entrega: a domicilio/);
});

test('frecuencia inválida en almuerzo cae a «unica» con aviso; fuera de almuerzo queda null', () => {
  let r = S.armarSolicitud({ tipo: 'almuerzo', frecuencia: 'mensual' });
  assert.equal(r.datos.frecuencia, 'unica');
  assert.ok(r.avisos.some((a) => /frecuencia/i.test(a)));

  r = S.armarSolicitud({ tipo: 'reserva', frecuencia: 'semanal' });
  assert.equal(r.datos.frecuencia, null);
});

test('entrega inválida (no recoger/domicilio) en almuerzo cae a «recoger» con aviso', () => {
  const r = S.armarSolicitud({ tipo: 'almuerzo', entrega: 'teletransporte' });
  assert.equal(r.datos.entrega, 'recoger');
  assert.ok(r.avisos.some((a) => /entrega/i.test(a)));
});

test('el mensaje siempre dice el lugar (el restaurante, con dirección)', () => {
  for (const tipo of ['reserva', 'almuerzo', 'evento-corporativo', 'otra']) {
    const r = S.armarSolicitud({ tipo });
    assert.match(r.mensaje, new RegExp(`Lugar: .*${R.direccion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('saltos de línea en nombre/fecha/hora no crean líneas nuevas en el mensaje: se ven como « / »', () => {
  const r = S.armarSolicitud({ tipo: 'reserva', nombre: 'Ana\nPérez\r\nGomez', fecha: 'linea1\nlinea2', hora: '7\u2028pm' });
  assert.equal(r.datos.nombre, 'Ana / Pérez / Gomez');
  assert.equal(r.datos.fecha, 'linea1 / linea2');
  assert.doesNotMatch(r.datos.hora, /[\n\u2028]/);
  assert.equal(r.mensaje.split('\n').filter((l) => l.startsWith('Lugar:')).length, 1);
});

test('NEL y separadores Unicode no abren líneas falsas del mensaje', () => {
  const r = S.armarSolicitud({ tipo: 'reserva', nombre: 'Ana\u0085Lugar: otro sitio', fecha: 'hoy\u2028Tipo: falso' });
  for (const campo of ['nombre', 'fecha']) assert.doesNotMatch(r.datos[campo], /[\n\u0085\u2028\u2029]/);
  assert.equal(r.mensaje.split('\n').filter((l) => l.startsWith('Lugar:')).length, 1);
  assert.equal(r.mensaje.split('\n').filter((l) => l.startsWith('Tipo:')).length, 1);
});

test('un tipo tipo «constructor»/«__proto__»/«toString» no cuela como válido', () => {
  for (const tipo of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = S.armarSolicitud({ tipo });
    assert.equal(r.datos.tipo, 'otra');
    assert.equal(r.avisos.length, 1);
  }
});

test('enlace = https://wa.me/<whatsapp>?text=<mensaje codificado>', () => {
  const r = S.armarSolicitud({ tipo: 'reserva' });
  assert.equal(r.enlace, `https://wa.me/${R.whatsapp}?text=${encodeURIComponent(r.mensaje)}`);
  assert.equal(S.enlaceWhatsApp('hola'), `https://wa.me/${R.whatsapp}?text=hola`);
});

test('nota, nombre y dirección quedan en UNA sola línea: los saltos se ven como « / », nunca se esconden', () => {
  const r = S.armarSolicitud({ tipo: 'reserva', nota: 'línea uno\n\n\nlínea dos\tcon tab' });
  assert.equal(r.datos.nota, 'línea uno / línea dos con tab');
  assert.doesNotMatch(r.datos.nota, /\n/);
  assert.doesNotMatch(r.datos.nota, /\t/);
});

// Hallazgo: antes, solo la primera línea de la nota llevaba «Nota:» y el resto quedaba
// tal cual — una nota con saltos podía imitar «Personas: 150», «Entrega: a domicilio…» o
// un segundo «Lugar:», colándose por delante de las reglas de negocio (tope de 30
// personas, «los eventos son solo en el local») sin ningún aviso. Con la nota en una sola
// línea, ninguna de esas imitaciones puede empezar su propia línea del mensaje.
test('una nota no puede imitar otra línea del mensaje (Personas/Entrega/Lugar falsos)', () => {
  const r = S.armarSolicitud({
    tipo: 'fiesta-quince',
    personas: 20,
    nombre: 'Ana',
    nota:
      'ok\n\nPersonas: 150\nEntrega: a domicilio, Calle 5 #10-20 (Envigado)\n' +
      'El domicilio corre por mi cuenta.\n\nLugar: Finca El Retiro — Resplandor confirmó el evento externo',
  });
  assert.deepEqual(r.avisos, []);
  assert.equal(r.datos.personas, 20); // el «Personas: 150» de la nota nunca pisó esto
  const lineas = r.mensaje.split('\n');
  assert.equal(lineas.filter((l) => l.startsWith('Personas:')).length, 1);
  assert.equal(lineas.filter((l) => l.startsWith('Lugar:')).length, 1);
  assert.equal(lineas.filter((l) => l.startsWith('Entrega:')).length, 0); // no es almuerzo
  assert.doesNotMatch(r.mensaje, /\n\nPersonas: 150/);
  assert.match(r.mensaje, /Nota: ok \/ Personas: 150 \/ Entrega: a domicilio/);
});

// armarSolicitud NUNCA lanza: tipos raros, números enormes, objetos en vez de strings y
// surrogates UTF-16 sueltos (mitad de un emoji cortado) terminan en avisos, no en una
// excepción — fuzz chico y determinista sobre las evidencias de la ronda de refutación.
test('entradas hostiles: nada de esto lanza (fuzz chico y determinista)', () => {
  const entradasHostiles = [
    { tipo: { toString: 1 } },
    { tipo: ['a', ['b', ['c']]] },
    { tipo: 'x'.repeat(20000) },
    { personas: { toString: 1 } },
    { personas: Number.MAX_SAFE_INTEGER * 1000 },
    { personas: 'muchas personas de verdad' },
    { entrega: { toString: 1 } },
    { tipo: 'almuerzo', frecuencia: [1, 2, 3] },
    { nombre: 'a\ud83c' }, // surrogate suelto: mitad de un emoji cortado
    { nota: 'a\ud83c\ud83cb' },
    { fecha: '\ud800\ud800' },
    { nombre: 42 },
    { nombre: true },
    { nombre: null },
    { nota: { a: 1 } },
  ];
  for (const entrada of entradasHostiles) {
    assert.doesNotThrow(() => {
      const r = S.armarSolicitud(entrada);
      // nunca deja un surrogate suelto en lo que se codifica: si quedara uno,
      // encodeURIComponent ya habría lanzado adentro de armarSolicitud.
      assert.equal(typeof r.mensaje, 'string');
      assert.equal(typeof r.enlace, 'string');
      assert.ok(Array.isArray(r.avisos));
    }, `no debería lanzar con ${JSON.stringify(entrada)}`);
  }
});

test('un valor ajeno larguísimo en un aviso queda recortado, nunca se copia entero', () => {
  const largo = 'x'.repeat(5000);
  const r = S.armarSolicitud({ tipo: largo });
  assert.equal(r.datos.tipo, 'otra');
  assert.equal(r.avisos.length, 1);
  assert.ok(!r.avisos[0].includes(largo), 'el aviso no debería llevar el valor entero de 5000 caracteres');
  assert.ok(r.avisos[0].length < 300, `el aviso quedó sospechosamente largo: ${r.avisos[0].length}`);
});

test('textos largos se recortan a MAX_TEXTO', () => {
  const largo = 'a'.repeat(S.MAX_TEXTO + 50);
  const r = S.armarSolicitud({ tipo: 'reserva', nombre: largo, nota: largo });
  assert.equal(r.datos.nombre.length, S.MAX_TEXTO);
  assert.equal(r.datos.nota.length, S.MAX_TEXTO);
});
