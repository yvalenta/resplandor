/* Resplandor Restaurante — la solicitud como dato: validar y armar el mensaje de
 * WhatsApp para reservar mesa, cotizar una celebración o programar un almuerzo.
 *
 * Una sola fuente para las tres puertas que arman una solicitud: la web (landing.js), los
 * agentes que navegan la página (agentes.js, WebMCP) y el MCP remoto (mcp/worker.mjs). Si
 * cambia el mensaje, cambia acá y sale igual en las tres. Nunca se envía, reserva ni cobra
 * nada por la persona: esto arma el mensaje y el enlace wa.me; la persona lo abre y lo manda.
 *
 * Sin DOM ni estado: todo entra por parámetro (salvo los datos fijos del local, que vienen
 * de RESPLANDOR — ver assets/js/local.js, cargado antes que este archivo). Corre como
 * <script defer> (después de local.js) y como módulo en Node y en el Worker; en los tres
 * deja globalThis.RESPLANDOR_SOLICITUD.
 *
 * El texto que llega (nombre, nota, fecha, hora, dirección) es dato: se normaliza y se
 * recorta igual venga de un formulario o de un agente, y nunca se trata como HTML.
 *
 * armarSolicitud NUNCA lanza, sea lo que sea que llegue (un tipo raro, un número enorme,
 * un objeto en vez de texto, un surrogate UTF-16 suelto de un emoji cortado): lo raro
 * termina en un aviso, nunca en una excepción — ver comoTexto/bienFormado/resumenAjeno.
 */
(() => {
  'use strict';

  const R = globalThis.RESPLANDOR;
  if (!R) throw new Error('solicitud.js necesita que local.js ya haya corrido (falta globalThis.RESPLANDOR).');

  const MAX_PERSONAS = 30; // la capacidad del local (R.capacidad) — congelado acá para que
  // el mensaje avise incluso si algún día cargan un R desactualizado.

  // Corrección de Yonatan (2026-09-28): todo evento, celebración o paquete en el local es de
  // MIN_PERSONAS_EVENTO a MAX_PERSONAS — antes solo existía el máximo. Congelado acá igual
  // que MAX_PERSONAS (ver R.minimoPersonasEvento, assets/js/local.js) por la misma razón. Una
  // reserva de mesa común (tipo «reserva») NO tiene este mínimo — una mesa para 1 sigue siendo
  // válida — y el almuerzo programado (tipo «almuerzo») tampoco es un evento: ver
  // TIPOS_SIN_MINIMO_EVENTO y esTipoEvento más abajo.
  const MIN_PERSONAS_EVENTO = 10;
  const MAX_TEXTO = 300;

  // Entrega: solo tiene sentido para el almuerzo programado (es lo único que puede salir
  // del local). En cualquier otro tipo se ignora con aviso: los eventos son en el local.
  const ENTREGAS = ['recoger', 'domicilio'];

  // Los únicos tres tipos de TIPOS que NO son «evento/celebración/paquete» para efectos del
  // mínimo de personas: una reserva de mesa común nunca tiene mínimo, el almuerzo programado
  // tampoco es un evento, y la cena romántica/aniversario (decisión por defecto, ver el
  // comentario de abajo) se piensa en pareja. Cualquier otro tipo (cumpleaños infantil,
  // quinceañera, menú ejecutivo, plan barril, all-inclusive, evento corporativo, otra
  // celebración) SÍ lo es, incluidos los que se agreguen después a TIPOS — por eso esto es
  // una excepción explícita (los tres que NO lo son), no una lista de los que sí.
  //
  // Decisión por defecto — PREGUNTA ABIERTA para Yonatan (ver también docs/landing-y-agentes.md):
  // un hallazgo de refutación de una ronda previa notó que «cena-romantica» quedaba del lado
  // «evento» (heredaba el mínimo de MIN_PERSONAS_EVENTO=10) mientras su tarjeta en
  // landing.html («Cena romántica / aniversario», sección Celebraciones) se anuncia «en
  // pareja» — pensada para 2 personas — y eso se dejó tal cual hasta que Yonatan decidiera.
  // Por defecto, ahora se suma acá (al lado de reserva/almuerzo): el porqué es que exigirle
  // el mínimo de 10 a una celebración que el propio texto describe como de a dos era la
  // contradicción real — una pareja que pide una cena romántica para 2 no debería ver «se
  // ajustó de 2 a 10» en su mensaje de WhatsApp, y nada en los datos que mandan
  // (docs/landing-y-agentes.md) dice que una cena romántica tenga que ser para 10 o más. El
  // máximo del local (30, MAX_PERSONAS) sigue aplicándole igual que a cualquier otro tipo:
  // esto solo quita el MÍNIMO de evento, nunca el tope de capacidad. Si Yonatan prefiere lo
  // contrario (que siga siendo un evento con mínimo de 10, o que la tarjeta deje de
  // anunciarse «en pareja»), se revierte quitando 'cena-romantica' de la lista de abajo.
  const TIPOS_SIN_MINIMO_EVENTO = ['reserva', 'almuerzo', 'cena-romantica'];
  const esTipoEvento = (tipo) => !TIPOS_SIN_MINIMO_EVENTO.includes(tipo);

  // Hallazgo de refutación (ronda 4, sobre la corrección de Yonatan del 2026-09-28): un tipo
  // AUSENTE, vacío o inválido cae más abajo a «otra» (ver el fallback de `tipo` en
  // armarSolicitud) — pero «otra» SÍ es un evento de verdad (esTipoEvento('otra') === true,
  // elegirlo a propósito en el <select> exige el mínimo de 10, con toda intención). Sin esta
  // función, ese mismo mínimo se colaba para quien NUNCA eligió un tipo: una «mesa para 2»
  // sin `tipo` (un agente que omite el campo, o la landing antes de que la persona elija
  // algo en el <select>, donde datos.tipo empieza en '') se inflaba a 10 personas. Esta
  // función resuelve el mínimo sobre el tipo CRUDO, tal como llega, ANTES de ese fallback:
  // solo hereda el mínimo de evento si ese valor YA ES uno de los tipos reales de TIPOS (una
  // elección explícita, incluida «otra» elegida a propósito) — nunca por haber caído ahí
  // solo. Una sola fuente para armarSolicitud (con `entrada.tipo`) y para
  // landing.js#personasMin (con `datos.tipo`, que también empieza en ''): así la web nunca
  // muestra «de 10 a 30» ni el mensaje de WhatsApp nunca ajusta a 10 antes de que alguien
  // haya elegido un tipo de verdad.
  const minimoPersonasPara = (tipoBruto) => (idsTipos.includes(tipoBruto) && esTipoEvento(tipoBruto) ? MIN_PERSONAS_EVENTO : 1);

  // Frecuencia del almuerzo programado (almuerzos con frecuencia fija).
  const FRECUENCIAS = [
    { id: 'unica', etiqueta: 'Una vez' },
    { id: 'semanal', etiqueta: 'Toda la semana' },
    { id: 'quincenal', etiqueta: 'Cada quince días' },
    { id: 'diaria', etiqueta: 'Todos los días' },
  ];

  // TIPOS es la misma lista de R.tipos (local.js): no se copia ni se reinventa acá, para
  // que un tipo nuevo agregado en el local (o quitado) no pueda desincronizarse entre los
  // dos archivos.
  const TIPOS = R.tipos;
  const idsTipos = TIPOS.map((t) => t.id); // usados con Array#includes, nunca con acceso
  // de propiedad de objeto: así un tipo «constructor» o «__proto__» no cuela como válido
  // ni pisa nada del prototipo (misma defensa que copiá lusof/assets/js/pedido.js con Map).
  const idsFrecuencias = FRECUENCIAS.map((f) => f.id);
  const etiquetaDe = (lista, id) => (lista.find((x) => x.id === id) || {}).etiqueta || id;

  // ───────────────────────── saneo defensivo (nunca lanza) ─────────────────────────

  // Solo texto o número se aceptan como «texto»: cualquier otra cosa (objeto, arreglo,
  // boolean, null) queda vacía. String(numero) nunca lanza; lo que SÍ puede lanzar es
  // String(objetoRaro) (p. ej. {toString:1}) o recorrer un arreglo anidado — por eso
  // nunca se llama String()/toString() sobre un valor que no sea ya string o number.
  const comoTexto = (valor) => {
    if (typeof valor === 'string') return valor;
    if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
    return '';
  };

  // Un surrogate UTF-16 suelto (la mitad de un emoji cortado a la mitad, o un JSON mal
  // armado) hace que encodeURIComponent lance URIError. toWellFormed() (Node 20+,
  // Workers) lo arregla reemplazándolo por U+FFFD; si no existe, un reemplazo manual
  // equivalente recorriendo por punto de código (nunca por unidad UTF-16 suelta).
  const bienFormado = (s) => {
    if (typeof s.toWellFormed === 'function') return s.toWellFormed();
    return Array.from(s)
      .map((c) => (/^[\uD800-\uDFFF]$/.test(c) ? '�' : c))
      .join('');
  };

  // Recorte con un TOPE DURO de `max` PUNTOS DE CÓDIGO — nunca por unidad UTF-16 suelta
  // (un .slice(0, n) a secas puede partir un emoji, un par de surrogates, por la mitad y
  // dejar un surrogate suelto que rompa encodeURIComponent más adelante) — y, cuando el
  // entorno da Intl.Segmenter, el corte además retrocede al último LÍMITE DE GRAFEMA
  // completo si el punto de corte cae dentro de uno (letra+marcas combinantes, una cadena
  // de emoji unida con ZWJ): así nunca se parte un emoji ni una secuencia combinante a la
  // mitad. OJO (hallazgo de refutación, ronda 3): contar GRAFEMAS y compararlos contra
  // `max` (como hacía la versión anterior de esta función) NO es lo mismo que contar
  // PUNTOS DE CÓDIGO — un solo grafema puede valer un punto de código («a») o miles
  // (letra + 100 000 marcas combinantes, un jamo repetido) y esa versión anterior dejaba
  // pasar CUALQUIER cantidad de puntos de código mientras el número de GRAFEMAS no
  // pasara de `max`. Acá el techo es SIEMPRE puntos de código: si un solo grafema por sí
  // solo ya se pasa del tope (nada acumulado todavía, no hay límite de grafema previo al
  // que retroceder), el techo manda igual y se corta ESE grafema por punto de código,
  // aunque eso sí parta la secuencia — es el único caso donde partir es preferible a
  // devolver más de `max` puntos de código. Exportado como `recortarTexto` (ver abajo):
  // assets/js/agentes.js usa ESTE MISMO recorte para sus propios topes de MAX_TEXTO, y
  // mcp/worker.mjs lo usa a través de armarSolicitud (unaLinea) — una sola fuente para
  // las tres puertas.
  const SEGMENTADOR = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('es', { granularity: 'grapheme' }) : null;
  const recortar = (s, max) => {
    const puntos = Array.from(s); // por punto de código, nunca por unidad UTF-16 suelta
    if (puntos.length <= max) return s;
    if (!SEGMENTADOR) return puntos.slice(0, max).join('');
    let acumulado = 0;
    let resultado = '';
    for (const { segment } of SEGMENTADOR.segment(s)) {
      const n = Array.from(segment).length; // puntos de código de ESTE grafema (no 1)
      if (acumulado + n > max) {
        // Nada acumulado todavía: este ÚNICO grafema ya se pasa del tope y no hay límite
        // de grafema previo al que retroceder. El techo manda: se corta por punto de
        // código, aunque parta la secuencia.
        if (acumulado === 0) return Array.from(segment).slice(0, max).join('');
        break; // retrocede al último límite de grafema completo (no incluye este)
      }
      resultado += segment;
      acumulado += n;
    }
    return resultado;
  };

  // Rellenos que SÍ ocupan un ancho visual — espacio Braille en blanco (U+2800) y los
  // rellenos de Hangul que existen justamente para ocupar el lugar de una letra en
  // pantalla (U+115F, U+1160, U+3164, U+FFA0) — se CAMBIAN por un espacio (antes de
  // colapsar \s+ más abajo), NUNCA se borran: borrarlos pegaría dos palabras que sí tenían
  // un separador real (hallazgo de refutación: braille «hola mundo», separado con U+2800,
  // quedaba como «holamundo»).
  const RELLENOS_CON_ANCHO = /[⠀ㅤᅟᅠﾠ]/g;

  // Rellenos de ANCHO CERO que se cuelan en un campo «de texto» para simular contenido sin
  // que se vea nada (o para esquivar un chequeo de «no vacío»): espacio de ancho cero
  // (U+200B), unión de palabras (U+2060), BOM/espacio de no separación de ancho cero
  // (U+FEFF) y separador de vocales mongol (U+180E). Estos SÍ se BORRAN (nunca se cambian
  // por un espacio: no hay nada que separar, son ruido puro). OJO: nunca incluye U+200D
  // (ZWJ) ni U+FE0F (selector de variación) — esos dos SÍ forman parte de una secuencia de
  // emoji real (👨‍👩‍👧‍👦, ❤️) y borrarlos rompería el emoji, no lo limpiaría.
  const RELLENOS_INVISIBLES = /[​⁠﻿᠎]/g;

  // Una línea puede quedar, después del saneo de arriba, con algo «visible» en el string
  // que en PANTALLA no muestra absolutamente nada: un carácter de formato de texto
  // (\p{Cf}: ZWNJ, LRM/RLM, los overrides de dirección bidi, el tag de U+E0020…) o una
  // marca combinante suelta sin ninguna letra base (\p{Mn}: un acento suelto, el propio
  // selector de variación FE0F sin nada delante, el CGJ, la vocal inherente khmer…) —
  // antes esto sobrevivía el `.filter(Boolean)` de abajo (el string no está vacío, solo se
  // VE vacío) y dejaba una línea «A nombre de: ‌» colgando en el mensaje (hallazgo de
  // refutación). Una línea cuenta como vacía cuando, tras el saneo de arriba, lo único que
  // le queda son esos caracteres de formato/marca, los rellenos con ancho de arriba (por
  // si sobrevivió alguno sin espacio alrededor) o solo espacios. Esto NUNCA se usa para
  // BORRAR contenido (eso sí rompería una secuencia de emoji real con ZWJ/FE0F, o un
  // acento real sobre una letra): solo para decidir si la LÍNEA ENTERA cuenta como «sin
  // este dato», exactamente igual que si nunca se hubiera escrito nada.
  const PATRON_LINEA_VACIA = /^[\p{Cf}\p{Mn}⠀ㅤᅟᅠﾠ\s]*$/u;

  // Un valor ajeno (tipo/entrega/frecuencia que no existen) se muestra en el aviso, pero
  // nunca entero ni con String() a ciegas: un objeto con un toString roto lanzaría
  // (Cannot convert object to primitive value) y un arreglo gigante o de 5 MB inflaría la
  // respuesta. Acá: string se recorta a 40 caracteres bien formados; number/boolean/
  // null/undefined se describen solos (nunca lanzan); cualquier otra cosa, solo su tipo.
  const resumenAjeno = (valor) => {
    if (typeof valor === 'string') return recortar(bienFormado(valor), 40);
    if (typeof valor === 'number' || typeof valor === 'boolean' || valor === null || valor === undefined) return String(valor);
    return Array.isArray(valor) ? 'un arreglo' : typeof valor;
  };

  // Campos de una línea (nombre, fecha, hora, dirección) Y la nota: TODOS quedan en UNA
  // sola línea de verdad. Cualquier salto real (\n, \r\n) o separador Unicode de línea/
  // párrafo (U+0085, U+2028, U+2029) no se esconde en un espacio — se ve como « / », para
  // que nada (ni una persona, ni un agente, ni una instrucción inyectada en una nota)
  // pueda imitar otra línea del mensaje (un «Personas: 150» o un «Lugar: otro sitio»
  // falsos). Varios saltos consecutivos (líneas vacías) colapsan a un solo « / »: no
  // dejan segmentos vacíos. Tope por punto de código, aplicado al final, sobre el
  // resultado ya unido.
  const unaLinea = (valor) => {
    const texto = bienFormado(comoTexto(valor));
    const lineas = texto
      .split(/\r\n?|[\n\u0085\u2028\u2029]+/)
      .map((l) =>
        l
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ') // otro control: fuera
          .replace(RELLENOS_CON_ANCHO, ' ') // rellenos CON ancho: a espacio (antes de colapsar \s+)
          .replace(RELLENOS_INVISIBLES, '') // rellenos de ancho CERO: fuera (ruido puro)
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter((l) => !PATRON_LINEA_VACIA.test(l));
    // Una nota/nombre/etc. que solo tenia rellenos, formato bidi o una marca suelta queda
    // afuera aca (ninguna linea sobrevive el filtro de arriba): cuenta como campo vacio,
    // igual que si nunca se hubiera escrito nada - el mensaje ya trata '' como "sin este
    // dato" (ver `d.nombre ? ... : null` mas abajo).
    return recortar(lineas.join(' / '), MAX_TEXTO);
  };

  const enlaceWhatsApp = (texto) => `https://wa.me/${R.whatsapp}?text=${encodeURIComponent(texto)}`;

  /* entrada: { tipo, fecha, hora, personas, nombre, nota, entrega, direccion, frecuencia }
   * devuelve: { datos, mensaje, enlace, avisos }
   * Errores de negocio (tipo que no existe, personas de más, domicilio fuera de almuerzo)
   * nunca rompen la solicitud: quedan en `avisos`, igual que en la web. */
  function armarSolicitud(entrada = {}) {
    const avisos = [];

    // '' es «sin elegir» (el <option> por defecto del formulario, o reiniciar()): no es
    // un valor inválido que alguien haya escrito, así que no hace falta avisar por eso.
    let tipo = entrada.tipo === '' || entrada.tipo === null || entrada.tipo === undefined ? 'otra' : entrada.tipo;
    if (!idsTipos.includes(tipo)) {
      avisos.push(`Tipo «${resumenAjeno(tipo)}» no existe; quedó «otra» (opciones: ${idsTipos.join(', ')}).`);
      tipo = 'otra';
    }
    const esAlmuerzo = tipo === 'almuerzo';

    // «personas» solo se interpreta si llega como number o string (nunca String()/
    // Number() a ciegas sobre un objeto: {toString:1} lanzaría al convertirlo).
    //
    // El mínimo se calcula sobre `entrada.tipo` CRUDO (minimoPersonasPara, arriba) — NUNCA
    // sobre `tipo` ya resuelto (tras el fallback a «otra»): 1 para una reserva de mesa o un
    // almuerzo programado (sin mínimo — una mesa para 1 sigue siendo válida) y para un tipo
    // ausente, vacío o inválido (nadie eligió un evento de verdad); MIN_PERSONAS_EVENTO solo
    // cuando la persona (o el agente) SÍ escribió un tipo real de TIPOS que es un evento,
    // incluida «otra» elegida a propósito (dato de Yonatan, 2026-09-28). Fuera de rango se
    // ajusta al límite más cercano con aviso — igual que el tope de arriba (MAX_PERSONAS),
    // nunca se rechaza la solicitud entera: el mensaje de WhatsApp nunca sale con un evento
    // de menos de MIN_PERSONAS_EVENTO ni de más de MAX_PERSONAS.
    let personas = null;
    const personasBruto = entrada.personas;
    const minPersonas = minimoPersonasPara(entrada.tipo);
    if (personasBruto !== undefined && personasBruto !== null && personasBruto !== '') {
      const n = typeof personasBruto === 'number' || typeof personasBruto === 'string' ? Number(personasBruto) : NaN;
      if (!Number.isInteger(n) || n < 1) {
        avisos.push('«personas» debe ser un número entero de 1 en adelante; se ignoró.');
      } else if (n > MAX_PERSONAS) {
        avisos.push(`La capacidad es ${MAX_PERSONAS} personas; se recortó de ${n} a ${MAX_PERSONAS}.`);
        personas = MAX_PERSONAS;
      } else if (n < minPersonas) {
        avisos.push(`Los eventos, celebraciones y paquetes son de ${MIN_PERSONAS_EVENTO} a ${MAX_PERSONAS} personas; se ajustó de ${n} a ${minPersonas}.`);
        personas = minPersonas;
      } else {
        personas = n;
      }
    }

    // La entrega (recoger/domicilio) solo existe para el almuerzo programado: es lo único
    // que puede salir del local. En cualquier otro tipo, el aviso solo aparece si de
    // verdad pidieron domicilio (nunca por el valor por defecto que trae el formulario).
    let entrega = null;
    let direccion = '';
    let frecuencia = null;
    if (esAlmuerzo) {
      entrega = entrada.entrega ?? 'recoger';
      if (!ENTREGAS.includes(entrega)) {
        avisos.push(`Entrega «${resumenAjeno(entrega)}» no existe; quedó «recoger» (opciones: ${ENTREGAS.join(', ')}).`);
        entrega = 'recoger';
      }
      if (entrega === 'domicilio') {
        direccion = unaLinea(entrada.direccion);
        if (!direccion) avisos.push('Falta la dirección para el domicilio.');
      }
      frecuencia = entrada.frecuencia ?? 'unica';
      if (!idsFrecuencias.includes(frecuencia)) {
        avisos.push(`Frecuencia «${resumenAjeno(frecuencia)}» no existe; quedó «unica» (opciones: ${idsFrecuencias.join(', ')}).`);
        frecuencia = 'unica';
      }
    } else if (entrada.entrega === 'domicilio') {
      avisos.push('Los eventos son solo en el local: se ignoró la entrega.');
    }

    const d = {
      tipo,
      fecha: unaLinea(entrada.fecha),
      hora: unaLinea(entrada.hora),
      personas,
      nombre: unaLinea(entrada.nombre),
      nota: unaLinea(entrada.nota),
      entrega,
      direccion,
      frecuencia,
    };

    const etiquetaTipo = etiquetaDe(TIPOS, tipo);
    const lineasEntrega = esAlmuerzo
      ? [
          `Frecuencia: ${etiquetaDe(FRECUENCIAS, frecuencia)}`,
          // Con dirección, la coma la separa de «a domicilio»; sin ella, el aviso entre
          // paréntesis va pegado (sin coma de sobra: hallazgo F, ronda 4 — «a domicilio,
          // (falta la dirección)» quedaba con una coma colgando delante del paréntesis).
          entrega === 'domicilio' ? `Entrega: a domicilio${direccion ? `, ${direccion}` : ' (falta la dirección)'}` : 'Entrega: recojo en el local',
          entrega === 'domicilio' ? 'El domicilio corre por mi cuenta.' : null,
        ]
      : [];

    const mensaje = [
      `¡Hola, ${R.marca}! Quiero hacer esta solicitud:`,
      '',
      `Tipo: ${etiquetaTipo}`,
      d.fecha ? `Fecha: ${d.fecha}` : null,
      d.hora ? `Hora: ${d.hora}` : null,
      d.personas ? `Personas: ${d.personas}` : null,
      ...lineasEntrega,
      d.nombre ? `A nombre de: ${d.nombre}` : null,
      d.nota ? `Nota: ${d.nota}` : null,
      '',
      `Lugar: ${R.marca} — ${R.direccion}`,
    ]
      .filter((x) => x !== null)
      .join('\n');

    return { datos: d, mensaje, enlace: enlaceWhatsApp(mensaje), avisos };
  }

  const RESPLANDOR_SOLICITUD = {
    MAX_PERSONAS,
    MIN_PERSONAS_EVENTO,
    MAX_TEXTO,
    TIPOS,
    ENTREGAS,
    FRECUENCIAS,
    esTipoEvento,
    // Sobre el tipo CRUDO (antes del fallback a «otra»): landing.js#personasMin la usa para
    // que la etiqueta/ayuda del campo y el atributo `min` nunca muestren el mínimo de evento
    // antes de que la persona haya elegido un tipo de verdad (ver el comentario junto a su
    // definición, arriba).
    minimoPersonasPara,
    enlaceWhatsApp,
    armarSolicitud,
    // Recorte por grafema/punto de código (nunca por unidad UTF-16): assets/js/agentes.js
    // lo usa para sus propios topes de MAX_TEXTO, así las dos superficies truncan igual y
    // ninguna corta un emoji por la mitad (una sola fuente, como pide el contrato de arriba).
    recortarTexto: recortar,
  };

  globalThis.RESPLANDOR_SOLICITUD = RESPLANDOR_SOLICITUD;
  if (typeof module !== 'undefined' && module.exports) module.exports = RESPLANDOR_SOLICITUD;
})();
