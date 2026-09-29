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

// Dato de Yonatan (2026-09-28): eventos, celebraciones y paquetes en el local son de 10 a 30
// personas (antes solo existía el máximo). El mismo número vive congelado en dos lugares a
// propósito (R.minimoPersonasEvento en local.js, MIN_PERSONAS_EVENTO en solicitud.js) — este
// cable trampa es lo que detecta si alguno de los dos se desincroniza.
test('cable trampa: eventos/celebraciones/paquetes son de 10 a 30 personas (R y S coinciden)', () => {
  assert.equal(R.minimoPersonasEvento, 10);
  assert.equal(S.MIN_PERSONAS_EVENTO, 10);
});

test('esTipoEvento: reserva y almuerzo NO son evento; cualquier otro tipo de TIPOS sí lo es', () => {
  assert.equal(S.esTipoEvento('reserva'), false);
  assert.equal(S.esTipoEvento('almuerzo'), false);
  for (const t of S.TIPOS) {
    if (t.id === 'reserva' || t.id === 'almuerzo') continue;
    assert.equal(S.esTipoEvento(t.id), true, `«${t.id}» debería contar como evento`);
  }
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

// Dato de Yonatan (2026-09-28): eventos, celebraciones y paquetes en el local son de 10 a 30
// personas. Casos límite exactos (9/31 inválidos, 10/30 válidos) para matar el mutante de un
// «<» que debería ser «<=» (o viceversa) en cualquiera de los dos extremos del rango.
test('evento: personas de 9 se ajusta a 10 con aviso; el mensaje nunca sale con un evento de 9', () => {
  const r = S.armarSolicitud({ tipo: 'evento-corporativo', personas: 9 });
  assert.equal(r.datos.personas, 10);
  assert.ok(r.avisos.some((a) => /de 10 a 30 personas/i.test(a)));
  assert.match(r.mensaje, /Personas: 10/);
  assert.doesNotMatch(r.mensaje, /Personas: 9\b/);
});

test('evento: personas de 31 se recorta a 30 con aviso; el mensaje nunca sale con un evento de 31', () => {
  const r = S.armarSolicitud({ tipo: 'evento-corporativo', personas: 31 });
  assert.equal(r.datos.personas, 30);
  assert.ok(r.avisos.some((a) => /capacidad es 30/i.test(a)));
  assert.match(r.mensaje, /Personas: 30/);
  assert.doesNotMatch(r.mensaje, /Personas: 31\b/);
});

test('evento: personas de 10 (el mínimo exacto) es válido, sin aviso', () => {
  const r = S.armarSolicitud({ tipo: 'evento-corporativo', personas: 10 });
  assert.equal(r.datos.personas, 10);
  assert.deepEqual(r.avisos, []);
  assert.match(r.mensaje, /Personas: 10/);
});

test('evento: personas de 30 (el máximo exacto) es válido, sin aviso', () => {
  const r = S.armarSolicitud({ tipo: 'evento-corporativo', personas: 30 });
  assert.equal(r.datos.personas, 30);
  assert.deepEqual(r.avisos, []);
  assert.match(r.mensaje, /Personas: 30/);
});

test('cada tipo que SÍ es un evento (todo TIPOS salvo reserva y almuerzo) aplica el mínimo de 10', () => {
  for (const t of S.TIPOS) {
    if (t.id === 'reserva' || t.id === 'almuerzo') continue;
    const r = S.armarSolicitud({ tipo: t.id, personas: 5 });
    assert.equal(r.datos.personas, 10, `tipo ${t.id} con personas:5 debería ajustarse a 10`);
    assert.ok(r.avisos.some((a) => /de 10 a 30 personas/i.test(a)), `tipo ${t.id} debería avisar el mínimo`);
  }
});

// Hallazgo de refutación (ronda 4): un tipo AUSENTE, '' o inválido cae a «otra» (arriba, sin
// aviso o con aviso de «no existe» respectivamente) — y «otra» SÍ es un tipo-evento real, con
// mínimo de 10 cuando alguien lo ELIGE a propósito (prueba de arriba). Sin distinguir el
// fallback de una elección real, una «mesa para 2» que llega SIN tipo (un agente que omite
// el campo, o la landing antes de que la persona elija algo) se inflaba a 10 personas — antes
// de esta corrección de Yonatan (2026-09-28) ese mismo número (2) se conservaba tal cual.
test('sin tipo, con tipo vacío, o con un tipo inválido: NO hereda el mínimo de evento de «otra» (nadie eligió un evento de verdad)', () => {
  for (const entrada of [{ personas: 2 }, { tipo: '', personas: 2 }, { tipo: 'boda-en-la-playa', personas: 2 }]) {
    const r = S.armarSolicitud(entrada);
    assert.equal(r.datos.tipo, 'otra', `entrada ${JSON.stringify(entrada)} debería caer a «otra»`);
    assert.equal(r.datos.personas, 2, `entrada ${JSON.stringify(entrada)} no debería ajustar personas de 2`);
    assert.ok(
      !r.avisos.some((a) => /de 10 a 30 personas/i.test(a)),
      `entrada ${JSON.stringify(entrada)} no debería avisar el mínimo de evento`,
    );
    assert.match(r.mensaje, /Personas: 2\b/);
  }
});

// A diferencia de arriba: elegir «Otra celebración» A PROPÓSITO (el mismo valor 'otra' al
// que cae el fallback, pero puesto explícitamente por quien arma la solicitud) SÍ exige el
// mínimo — solo la AUSENCIA de una elección (o una inválida) queda exenta.
test('elegir «otra» explícitamente (a diferencia de la ausencia de tipo) SÍ aplica el mínimo de evento', () => {
  const r = S.armarSolicitud({ tipo: 'otra', personas: 2 });
  assert.equal(r.datos.personas, 10);
  assert.ok(r.avisos.some((a) => /de 10 a 30 personas/i.test(a)));
});

test('minimoPersonasPara: 1 para tipo ausente/vacío/inválido y para reserva/almuerzo; 10 para cualquier tipo real de TIPOS que sea evento', () => {
  assert.equal(S.minimoPersonasPara(undefined), 1);
  assert.equal(S.minimoPersonasPara(null), 1);
  assert.equal(S.minimoPersonasPara(''), 1);
  assert.equal(S.minimoPersonasPara('boda-en-la-playa'), 1);
  assert.equal(S.minimoPersonasPara('reserva'), 1);
  assert.equal(S.minimoPersonasPara('almuerzo'), 1);
  for (const t of S.TIPOS) {
    if (t.id === 'reserva' || t.id === 'almuerzo') continue;
    assert.equal(S.minimoPersonasPara(t.id), 10, `minimoPersonasPara('${t.id}') debería ser 10`);
  }
});

// Una reserva de mesa común NUNCA tiene mínimo de 10: una mesa para 1 o 2 sigue siendo
// válida, sin aviso — solo el máximo de 30 le aplica.
test('mesa (reserva): personas de 1 o 2 es válido, SIN aviso de mínimo (una mesa chica sigue siendo válida)', () => {
  for (const personas of [1, 2]) {
    const r = S.armarSolicitud({ tipo: 'reserva', personas });
    assert.equal(r.datos.personas, personas);
    assert.deepEqual(r.avisos, [], `reserva con personas:${personas} no debería avisar nada`);
    assert.match(r.mensaje, new RegExp(`Personas: ${personas}\\b`));
  }
});

// El almuerzo programado tampoco es un evento (dato de Yonatan, 2026-09-28): no le aplica el
// mínimo de 10, igual que una reserva de mesa.
test('almuerzo programado: personas de 2 es válido, SIN aviso de mínimo (no es un evento)', () => {
  const r = S.armarSolicitud({ tipo: 'almuerzo', personas: 2 });
  assert.equal(r.datos.personas, 2);
  assert.deepEqual(r.avisos, []);
  assert.match(r.mensaje, /Personas: 2\b/);
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

test('almuerzo a domicilio SIN dirección: aviso claro, no rompe el mensaje, sin coma de sobra', () => {
  const r = S.armarSolicitud({ tipo: 'almuerzo', entrega: 'domicilio' });
  assert.ok(r.avisos.some((a) => /falta la dirección/i.test(a)));
  // Hallazgo F (ronda 4): «Entrega: a domicilio, (falta la dirección)» tenía una coma de
  // sobra antes del paréntesis. Sin dirección va PEGADO, sin coma.
  assert.match(r.mensaje, /Entrega: a domicilio \(falta la dirección\)/);
  assert.doesNotMatch(r.mensaje, /a domicilio,\s*\(falta la dirección\)/);
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

// Hallazgo N7 (ronda 3) + R5 (segunda ronda de refutación sobre N7): los rellenos
// invisibles se sanean en solicitud.js (fuente compartida por la WebMCP y el Worker), pero
// NO todos igual. Los de ANCHO CERO (U+200B, U+2060, U+FEFF, U+180E) son ruido puro: se
// BORRAN sin dejar rastro. Los que SÍ ocupan un ancho visual (U+2800 espacio Braille,
// U+3164/U+115F/U+1160/U+FFA0 rellenos de Hangul) se CAMBIAN por un espacio — borrarlos
// pegaría dos palabras que sí tenían un separador real (braille «hola mundo», separado con
// U+2800, quedaba como «holamundo»: bug encontrado en refutación).
test('rellenos de ANCHO CERO (U+200B, U+2060, U+FEFF, U+180E) se borran sin dejar rastro (ni espacio)', () => {
  const rellenos = ['​', '⁠', '﻿', '᠎'];
  for (const relleno of rellenos) {
    const r = S.armarSolicitud({ tipo: 'reserva', nombre: `Ana${relleno}Pérez`, nota: `hola${relleno}mundo` });
    assert.ok(!r.datos.nombre.includes(relleno), `el relleno ${JSON.stringify(relleno)} no debería sobrevivir en nombre`);
    assert.ok(!r.datos.nota.includes(relleno), `el relleno ${JSON.stringify(relleno)} no debería sobrevivir en nota`);
    assert.equal(r.datos.nombre, 'AnaPérez');
    assert.equal(r.datos.nota, 'holamundo');
  }
});

test('rellenos CON ANCHO (U+2800, U+3164, U+115F, U+1160, U+FFA0) se cambian por un espacio: nunca pegan dos palabras', () => {
  const rellenos = ['⠀', 'ㅤ', 'ᅟ', 'ᅠ', 'ﾠ'];
  for (const relleno of rellenos) {
    const r = S.armarSolicitud({ tipo: 'reserva', nombre: `Ana${relleno}Pérez`, nota: `hola${relleno}mundo` });
    assert.ok(!r.datos.nombre.includes(relleno), `el relleno ${JSON.stringify(relleno)} no debería sobrevivir TAL CUAL en nombre`);
    assert.equal(r.datos.nombre, 'Ana Pérez', `${JSON.stringify(relleno)} debería quedar como un espacio, no borrarse (pegaría las palabras)`);
    assert.equal(r.datos.nota, 'hola mundo');
  }
});

// Repro exacto de refutación: braille real «hola mundo», con U+2800 como el espacio entre
// palabras (así se escribe un espacio en braille). Antes se borraba y quedaba «holamundo».
test('braille real: "hola mundo" con U+2800 como separador conserva la separación como un espacio', () => {
  const hola = '⠓⠕⠇⠁'; // 'hola' en braille
  const mundo = '⠍⠥⠝⠙⠕'; // 'mundo' en braille
  const r = S.armarSolicitud({ tipo: 'reserva', nombre: `${hola}⠀${mundo}` });
  assert.equal(r.datos.nombre, `${hola} ${mundo}`);
});

test('un campo que solo tiene rellenos invisibles cuenta como vacío (no aparece en el mensaje)', () => {
  const soloRellenos = '​⠀ㅤ﻿⁠';
  const r = S.armarSolicitud({ tipo: 'reserva', nombre: soloRellenos, nota: soloRellenos, fecha: soloRellenos });
  assert.equal(r.datos.nombre, '');
  assert.equal(r.datos.nota, '');
  assert.equal(r.datos.fecha, '');
  assert.doesNotMatch(r.mensaje, /A nombre de:/);
  assert.doesNotMatch(r.mensaje, /Nota:/);
  assert.doesNotMatch(r.mensaje, /Fecha:/);
  assert.deepEqual(r.avisos, []); // un campo opcional vacío no es un error de negocio
});

// R5 (refutación): un campo puede quedar con algo «visible» en el string que en pantalla
// no muestra NADA — un carácter de formato bidi/ZWNJ (\p{Cf}) o una marca combinante suelta
// sin ninguna letra base (\p{Mn}, incluido el propio selector de variación FE0F suelto).
// Antes esto sobrevivía tal cual y dejaba un «A nombre de: <invisible>» colgando en el
// mensaje. Ahora una línea así cuenta como vacía, igual que si nunca se hubiera escrito
// nada — sin tocar el contenido que SÍ tiene texto (ver pruebas de ZWJ/FE0F más abajo).
test('un campo con SOLO un invisible de formato o una marca suelta (sin ninguna letra) cuenta como vacío: no deja "A nombre de:" colgando', () => {
  const invisiblesSueltos = [
    '‌', // ZWNJ
    '­', // guion suave
    '⁡', // aplicación de función (Cf)
    '͏', // combining grapheme joiner (Mn)
    '‮', // override de dirección (RLO)
    '‎', // marca de izquierda a derecha (LRM)
    '️', // selector de variación SOLO, sin base: no es parte de un emoji real
    '\u{E0020}', // tag space
    '឵', // vocal inherente khmer (Mn)
  ];
  for (const c of invisiblesSueltos) {
    const r = S.armarSolicitud({ tipo: 'reserva', nombre: c });
    assert.equal(r.datos.nombre, '', `${JSON.stringify(c)} solo (sin base) debería contar como campo vacío`);
    assert.doesNotMatch(r.mensaje, /A nombre de:/, `no debería quedar "A nombre de:" colgando con ${JSON.stringify(c)}`);
  }
});

// Rellenos invisibles MEZCLADOS con espacios reales: solo desaparecen los rellenos, el
// espaciado real entre palabras (y su colapso normal) sigue funcionando igual.
test('rellenos invisibles mezclados con espacios reales: solo los rellenos desaparecen', () => {
  const r = S.armarSolicitud({ tipo: 'reserva', nombre: `  Ana⠀  ​Pérez  ` });
  assert.equal(r.datos.nombre, 'Ana Pérez');
});

// El saneo de rellenos NUNCA debe tocar U+200D (ZWJ) ni U+FE0F (selector de variación):
// esos dos SÍ forman parte de una secuencia de emoji real y borrarlos rompería el emoji
// (una familia 👨‍👩‍👧‍👦 se arma con 4 emoji base unidos por 3 ZWJ; ❤️ es corazón + FE0F).
test('el saneo de rellenos invisibles NO toca ZWJ (U+200D) ni el selector de variación (U+FE0F): los emojis compuestos quedan intactos', () => {
  const familia = '👨‍👩‍👧‍👦'; // familia: hombre+ZWJ+mujer+ZWJ+niña+ZWJ+niño
  const corazon = '❤️'; // ❤️: corazón + selector de variación (emoji, no texto)
  const r = S.armarSolicitud({ tipo: 'reserva', nota: `Somos ${familia}, gracias ${corazon}` });
  assert.ok(r.datos.nota.includes(familia), 'la secuencia de la familia (con sus ZWJ) debería sobrevivir intacta');
  assert.ok(r.datos.nota.includes(corazon), 'el corazón con su selector de variación debería sobrevivir intacto');
});

test('textos largos se recortan a MAX_TEXTO', () => {
  const largo = 'a'.repeat(S.MAX_TEXTO + 50);
  const r = S.armarSolicitud({ tipo: 'reserva', nombre: largo, nota: largo });
  assert.equal(r.datos.nombre.length, S.MAX_TEXTO);
  assert.equal(r.datos.nota.length, S.MAX_TEXTO);
});

// R1 (refutación, ronda 3): la versión anterior de `recortar` contaba GRAFEMAS y los
// comparaba contra MAX_TEXTO — pero un solo grafema puede valer un punto de código («a») o
// miles (letra + N marcas combinantes, un jamo repetido). Con 'a' + 1000 marcas
// combinantes, TODO el texto es UN solo grafema: `grafemas.length` (1) nunca pasaba de
// MAX_TEXTO (300), así que NO se recortaba nada — 1001 puntos de código sueltos, sin
// ningún techo. Ahora el techo es SIEMPRE puntos de código, aunque un solo grafema se pase
// del tope por su cuenta (ahí se corta ESE grafema por punto de código: el techo manda).
test('recorte: un solo grafema con miles de marcas combinantes (zalgo) no se escapa del techo de MAX_TEXTO', () => {
  const zalgo = 'a' + '́'.repeat(1000);
  assert.equal(Array.from(zalgo).length, 1001); // control: de verdad son 1001 puntos de código
  const r = S.armarSolicitud({ tipo: 'reserva', nota: zalgo });
  const puntos = Array.from(r.datos.nota).length;
  assert.ok(puntos <= S.MAX_TEXTO, `la nota no debería pasar de ${S.MAX_TEXTO} puntos de código: quedó en ${puntos}`);
});

test('recortarTexto: el mismo tope duro aplica al recorte que usa la WebMCP (agentes.js) directo, no solo a armarSolicitud', () => {
  const zalgo = 'a' + '́'.repeat(1000);
  const cortado = S.recortarTexto(zalgo, S.MAX_TEXTO);
  assert.ok(Array.from(cortado).length <= S.MAX_TEXTO);
});

// R1: un emoji con ZWJ (varios puntos de código, UN solo grafema) que cae justo en el
// borde del corte nunca debe quedar partido a la mitad (un ZWJ colgando al final, o un
// pedazo suelto de la secuencia): el recorte retrocede al último grafema COMPLETO.
test('recorte: una secuencia ZWJ justo en el borde del corte nunca queda partida a la mitad', () => {
  const familia = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'; // 7 puntos de código, 1 grafema
  // Prueba con el corte cayendo en cada posible punto DENTRO de la secuencia (no solo al
  // final): rellena con distintas cantidades de 'x' para que el límite de MAX_TEXTO caiga
  // en cada uno de los 7 puntos de código de la familia.
  for (let relleno = S.MAX_TEXTO - 6; relleno <= S.MAX_TEXTO - 1; relleno++) {
    const nota = 'x'.repeat(relleno) + familia;
    const r = S.armarSolicitud({ tipo: 'reserva', nota });
    const cp = Array.from(r.datos.nota).length;
    assert.ok(cp <= S.MAX_TEXTO, `relleno=${relleno}: no debería pasar de ${S.MAX_TEXTO} puntos de código (quedó en ${cp})`);
    assert.notEqual(r.datos.nota.at(-1), '‍', `relleno=${relleno}: no debería terminar en un ZWJ colgando`);
    // O quedó la familia COMPLETA, o no quedó nada de ella — nunca un pedazo suelto.
    const tieneAlgo = /[\u{1F466}-\u{1F469}]/u.test(r.datos.nota);
    if (tieneAlgo) assert.ok(r.datos.nota.endsWith(familia), `relleno=${relleno}: la familia quedó partida a la mitad: ${JSON.stringify(r.datos.nota.slice(-10))}`);
  }
});

// S.recortarTexto (hallazgo N8b): assets/js/agentes.js lo usa para sus propios topes de
// MAX_TEXTO en vez de un .slice() por unidades UTF-16 (que cortaba un emoji por la
// mitad). Se prueba acá, como parte pública de RESPLANDOR_SOLICITUD, que nunca deja un
// surrogate suelto al cortar justo sobre un emoji astral.
test('recortarTexto: nunca deja un surrogate suelto al cortar justo sobre un emoji astral', () => {
  const texto = 'a'.repeat(9) + '😀' + 'b'.repeat(10); // el emoji cae a caballo del límite 10 en UTF-16
  const cortado = S.recortarTexto(texto, 10);
  assert.ok(!/[\uD800-\uDBFF]$/.test(cortado), `no debería terminar en un surrogate alto suelto: ${JSON.stringify(cortado)}`);
  assert.ok(typeof cortado.isWellFormed !== 'function' || cortado.isWellFormed(), 'el resultado debería ser una cadena bien formada');
});

test('recortarTexto: con texto corto (bajo el tope) lo devuelve intacto', () => {
  assert.equal(S.recortarTexto('hola', 10), 'hola');
});
