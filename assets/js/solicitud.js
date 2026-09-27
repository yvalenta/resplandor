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
  const MAX_TEXTO = 300;

  // Entrega: solo tiene sentido para el almuerzo programado (es lo único que puede salir
  // del local). En cualquier otro tipo se ignora con aviso: los eventos son en el local.
  const ENTREGAS = ['recoger', 'domicilio'];

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

  // Recorte por GRAFEMA cuando el entorno lo da (Intl.Segmenter: agrupa una secuencia con
  // ZWJ U+200D o un selector de variación U+FE0F como una sola unidad visual), y si no,
  // por PUNTO DE CÓDIGO (Array.from) — nunca por unidad UTF-16 suelta: un .slice(0, n) a
  // secas puede partir un emoji (par de surrogates) por la mitad y dejar un surrogate
  // suelto que rompa encodeURIComponent más adelante. Exportado como `recortarTexto`
  // (ver abajo): assets/js/agentes.js usa ESTE MISMO recorte para sus propios topes de
  // MAX_TEXTO, en vez de reimplementar uno con .slice() por unidades UTF-16 (hallazgo:
  // agentes.js cortaba ahí un emoji por la mitad al truncar).
  const SEGMENTADOR = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('es', { granularity: 'grapheme' }) : null;
  const recortar = (s, max) => {
    if (SEGMENTADOR) {
      const grafemas = Array.from(SEGMENTADOR.segment(s), (g) => g.segment);
      return grafemas.length > max ? grafemas.slice(0, max).join('') : s;
    }
    const puntos = Array.from(s);
    return puntos.length > max ? puntos.slice(0, max).join('') : s;
  };

  // Rellenos invisibles que se cuelan en un campo «de texto» para simular contenido sin
  // que se vea nada (o para esquivar un chequeo de «no vacío»): espacio Braille en blanco
  // (U+2800), rellenos de Hangul (U+115F/U+1160/U+3164/U+FFA0), espacio de ancho cero
  // (U+200B), separador de vocales mongol (U+180E), BOM/espacio de no separación de ancho
  // cero (U+FEFF) y unión de palabras (U+2060). Se BORRAN (no se cambian por un espacio):
  // no son un separador de palabras, son ruido. OJO: nunca incluye U+200D (ZWJ) ni U+FE0F
  // (selector de variación) — esos dos SÍ forman parte de una secuencia de emoji real
  // (👨‍👩‍👧‍👦, ❤️) y borrarlos rompería el emoji, no lo limpiaría.
  const RELLENOS_INVISIBLES = /[​⠀ㅤᅟᅠﾠ﻿⁠᠎]/g;

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
          .replace(RELLENOS_INVISIBLES, '') // rellenos invisibles: fuera (nunca cuentan como contenido)
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean);
    // Una nota/nombre/etc. que solo tenia rellenos invisibles queda en '' aca (ninguna
    // linea sobrevive el .filter(Boolean) de arriba): cuenta como campo vacio, igual que
    // si nunca se hubiera escrito nada - el mensaje ya trata '' como "sin este dato"
    // (ver `d.nombre ? ... : null` mas abajo).
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
    let personas = null;
    const personasBruto = entrada.personas;
    if (personasBruto !== undefined && personasBruto !== null && personasBruto !== '') {
      const n = typeof personasBruto === 'number' || typeof personasBruto === 'string' ? Number(personasBruto) : NaN;
      if (!Number.isInteger(n) || n < 1) {
        avisos.push('«personas» debe ser un número entero de 1 en adelante; se ignoró.');
      } else if (n > MAX_PERSONAS) {
        avisos.push(`La capacidad es ${MAX_PERSONAS} personas; se recortó de ${n} a ${MAX_PERSONAS}.`);
        personas = MAX_PERSONAS;
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
          entrega === 'domicilio' ? `Entrega: a domicilio, ${direccion || '(falta la dirección)'}` : 'Entrega: recojo en el local',
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
    MAX_TEXTO,
    TIPOS,
    ENTREGAS,
    FRECUENCIAS,
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
