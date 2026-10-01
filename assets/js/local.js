/* Resplandor Restaurante — los datos del local: una sola fuente para la landing, los
 * agentes que navegan la página (agentes.js, WebMCP) y el MCP remoto (mcp/worker.mjs).
 *
 * Sin DOM ni red: solo datos. Corre como <script defer> (antes de solicitud.js) y como
 * módulo en Node y en el Worker; en los tres deja globalThis.RESPLANDOR.
 *
 * Única verdad: los dio Yonatan el 2026-09-26, o salen de la ficha de Google Maps
 * («Resplandor restaurante», https://www.google.com/maps/place/Resplandor+restaurante/@6.1584468,-75.6434789,17z).
 * Si algo de esto cambia, cambia acá y sale igual en la landing, los agentes y el Worker.
 */
(() => {
  'use strict';

  const SITIO = 'https://resplandor.ynt.codes/';

  // ───────────────────────── Funciones que se pueden apagar ─────────────────────────
  // Banderas de funciones (2026-09-29, a pedido de Yonatan): mientras Supabase responde
  // 402 (cuota), el menú de hoy y el almuerzo programado se apagan por completo. Es el
  // ÚNICO lugar donde se decide: la landing, la carta, el menú, los agentes (WebMCP y el
  // MCP remoto) y todo lo generado (llms.txt, local.json, sitemap.xml, JSON-LD,
  // server-card…) leen estos mismos valores. Apagada, una función desaparece entera:
  // no se pinta, no se anuncia, no se ofrece a un agente y no hace ninguna llamada.
  //
  //   menuDeHoy           — la sección «Menú de hoy» (#hoy) de la landing, el menú semanal
  //                         y su votación (menu.html) y la herramienta ver_menu_semana
  //                         (WebMCP) / resplandor_ver_menu_semana (MCP). Todo esto vive de
  //                         la tabla `menus` de Supabase.
  //   almuerzoProgramado  — la sección «Almuerzo programado» (#almuerzo-programado) de la
  //                         landing, el tipo de solicitud «almuerzo» y lo que solo existe
  //                         para él (entrega, dirección y frecuencia).
  //   pagarEnMesa         — el botón «Pagar» de «Mi cuenta» en carta.html (hoja y panel):
  //                         el cliente elige QR, transferencia o efectivo y eso AVISA al
  //                         mesero (POST a la Edge Function `alerta`); la página nunca muestra
  //                         datos bancarios ni QR. Es solo de carta.html: no se anuncia a los
  //                         agentes (local.json, llms.txt, WebMCP, MCP); lo único generado que la
  //                         lee es privacy.html y auth.md, que con ella encendida dicen que «Pagar»
  //                         solo avisa. Se enciende cuando la función `alerta` esté desplegada
  //                         (si no, el botón fallaría).
  //
  // Para RE-ENCENDER una función: cambia su `false` por `true` acá y regenera lo derivado
  //     node scripts/descubrimiento.mjs
  // (llms.txt, local.json, sitemap.xml, el JSON-LD de index.html, la server-card, las
  // páginas de texto y las skills). La landing, la carta y el menú lo leen en el navegador:
  // no hay nada más que tocar. Para apagarla, al revés. Si te olvidas de regenerar,
  // `node scripts/descubrimiento.mjs --comprobar` sale en 1 y dice qué quedó atrasado.
  // Contrato y decisiones: docs/landing-y-agentes.md, «Funciones que se pueden apagar».
  const FUNCIONES = Object.freeze({
    menuDeHoy: false,
    almuerzoProgramado: false,
    pagarEnMesa: false,
  });

  // Todo evento y toda celebración es EN EL LOCAL — nunca a domicilio, nunca catering
  // externo. Lo único que puede salir del restaurante es un almuerzo programado, y solo
  // si la persona asume el costo del domicilio (ver ENTREGAS en assets/js/solicitud.js).
  // Esta lista es la única fuente de qué tipos de solicitud existen: la landing pinta una
  // tarjeta por cada uno (menos «reserva» y «almuerzo», que tienen su propia sección) y
  // llama a abrir('<id>'); solicitud.js valida contra estos mismos ids.
  // «almuerzo» solo existe mientras la función almuerzoProgramado esté encendida (ver
  // FUNCIONES, arriba): apagada, ni la landing ni los agentes ni local.json lo ofrecen, y
  // pedirlo cae en el aviso de «tipo que no existe» de armarSolicitud.
  const TIPOS_TODOS = [
    { id: 'reserva', etiqueta: 'Reserva de mesa' },
    { id: 'almuerzo', etiqueta: 'Almuerzo programado' },
    { id: 'cumpleanos-infantil', etiqueta: 'Cumpleaños infantil' },
    { id: 'cena-romantica', etiqueta: 'Cena romántica / aniversario' },
    { id: 'fiesta-quince', etiqueta: 'Fiesta / quinceañera' },
    { id: 'menu-ejecutivo', etiqueta: 'Plan menú ejecutivo' },
    { id: 'plan-barril', etiqueta: 'Plan barril' },
    { id: 'all-inclusive', etiqueta: 'Plan Resplandor All-Inclusive' },
    { id: 'evento-corporativo', etiqueta: 'Evento corporativo' },
    { id: 'otra', etiqueta: 'Otra celebración' },
  ];
  const TIPOS = TIPOS_TODOS.filter((t) => t.id !== 'almuerzo' || FUNCIONES.almuerzoProgramado);

  const RESPLANDOR = {
    marca: 'Resplandor Restaurante',
    sitio: SITIO,
    cocina: 'colombiana, asados y cocina mixta',
    // El menú de la semana que vota la gente solo se anuncia con menuDeHoy encendida.
    descripcion:
      'Cocina colombiana, asados y cocina mixta en La Estrella, Antioquia. Almuerzo todos los días' +
      (FUNCIONES.menuDeHoy
        ? ', celebraciones en el local de 10 a 30 personas y un menú de la semana que vota la gente.'
        : ' y celebraciones en el local de 10 a 30 personas.'),

    funciones: FUNCIONES,

    whatsapp: '573225542434',
    whatsappVisible: '+57 322 554 2434',
    // Correo público del local y rango de precios (`priceRange` de schema.org, texto libre):
    // los dio Yonatan el 2026-09-29. Dijo «desde 23.000 $$», pero ese mismo día corrigió los
    // ejecutivos (la sopa y carne vale 14.000), y el «desde» es el del ejecutivo más barato.
    // Van al JSON-LD (`email`, también en el `contactPoint`, y `priceRange`) y a local.json;
    // el correo, además, a contact.html.
    correo: 'resplandorcomidamixta@gmail.com',
    rangoDePrecios: '$$ · desde 14.000 COP',

    direccion: 'Cra. 61 #79 Sur-62, Poblado del Sur, La Estrella, Antioquia, Colombia',
    // La misma dirección, en partes — para el JSON-LD (PostalAddress con
    // addressLocality/addressRegion propios, no enterrados dentro de streetAddress; sin
    // postalCode porque no se conoce uno para esta dirección, así que se omite en vez de
    // inventarlo). `direccion` (arriba) sigue siendo el string completo que usa el
    // mensaje de WhatsApp: esto es solo para quien necesite las partes.
    direccionPartes: {
      calle: 'Cra. 61 #79 Sur-62, Poblado del Sur',
      ciudad: 'La Estrella',
      region: 'Antioquia',
      pais: 'CO',
    },
    plusCode: '5954+9J',
    geo: { lat: 6.1584468, lng: -75.6434789 },

    // Todos los días, 12:00–17:00 (lo que dio Yonatan; Maps dice que el domingo abre a
    // las 11:00, pero manda el dato de Yonatan). `dias` en formato corto para JSON-LD
    // (openingHoursSpecification Mo–Su).
    horario: {
      texto: 'Todos los días, 12:00–17:00',
      dias: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
      abre: '12:00',
      cierra: '17:00',
    },

    // Capacidad del local. Todo evento/celebración es EN EL LOCAL: nunca a domicilio,
    // nunca catering externo, nunca «llevamos el barril hasta donde estés».
    capacidad: 30,

    // Corrección de Yonatan (2026-09-28): todo evento, celebración o paquete en el local es
    // de esta cantidad de personas HASTA `capacidad` (arriba) — antes solo se declaraba el
    // máximo. Una reserva de mesa común (tipo «reserva») NO tiene este mínimo: una mesa para
    // 1 sigue siendo válida. El almuerzo programado (tipo «almuerzo») tampoco es un evento:
    // no le aplica. La única otra fuente es MIN_PERSONAS_EVENTO en assets/js/solicitud.js
    // (congelado ahí, igual que MAX_PERSONAS, para que el mensaje avise incluso si algún día
    // cargan un R desactualizado) — si este número cambia, cambia en los dos lugares.
    minimoPersonasEvento: 10,

    // Google Maps muestra 5,0 con 2 reseñas: se ve como enlace a la ficha, nunca como
    // aggregateRating en el JSON-LD (Google prohíbe marcar reseñas tomadas de otro sitio
    // que no sea el propio). Sin testimonios inventados.
    resenas: {
      calificacion: 5.0,
      cantidad: 2,
      texto: '5,0 en Google Maps · 2 reseñas',
      url: 'https://www.google.com/maps/place/Resplandor+restaurante/@6.1584468,-75.6434789,17z',
    },

    enlaces: {
      maps: 'https://www.google.com/maps/place/Resplandor+restaurante/@6.1584468,-75.6434789,17z',
      // La MISMA ficha de Google Maps, por su CID decimal (estable aunque cambie la URL de
      // arriba): es la 2.ª mitad, en decimal, del feature id 0x…:0x3dde7241f7aac6bf de la URL
      // canónica de Maps (0x3dde7241f7aac6bf = 4458126308796974783). Verificado el 2026-09-29
      // abriéndola: «Resplandor restaurante», misma dirección, plus code 5954+9J y teléfono
      // 322 5542434. Va al JSON-LD como `sameAs` (schema.org); no es una red social.
      fichaGoogle: 'https://maps.google.com/?cid=4458126308796974783',
      // Instagram del restaurante: lo enlaza la ficha de Maps y Yonatan lo confirmó el
      // 2026-09-29. Va al JSON-LD como `sameAs`.
      instagram: 'https://www.instagram.com/resplandorestaurante',
      comoLlegar: 'https://www.google.com/maps/dir/?api=1&destination=6.1584468%2C-75.6434789',
      carta: SITIO + 'carta.html',
      // menu.html sigue existiendo apagado (muestra un aviso), pero no se enlaza ni se anuncia.
      ...(FUNCIONES.menuDeHoy ? { menu: SITIO + 'menu.html' } : {}),
      landing: SITIO, // la raíz: la landing es index.html (el POS vive en /pos.html)
      // Páginas ancla de confianza (sin JS: texto plano, siempre igual haya o no red) —
      // scripts/descubrimiento.mjs las genera a partir de este mismo objeto; nunca a mano.
      about: SITIO + 'about.html',
      contacto: SITIO + 'contact.html',
      privacidad: SITIO + 'privacy.html',
    },

    // Políticas de negocio: nunca eventos a domicilio, nunca catering externo. El
    // almuerzo programado es la única excepción (recoger, o domicilio a costo del
    // cliente) y solo mientras esa función esté encendida. armarSolicitud (solicitud.js)
    // hace cumplir esto con avisos, no con throw.
    politicas: {
      eventosSoloEnElLocal: true,
      ...(FUNCIONES.almuerzoProgramado ? { almuerzoDomicilioCostoCliente: true } : {}),
      anticipacionRecomendadaHoras: 48,
    },

    tipos: TIPOS,

    // Supabase público (mismo que usa carta.html/menu.html): SOLO lectura anónima de
    // `carta_publica` (vista: categoria, nombre, precio, descripcion) y de la tabla
    // `menus` (solo con menuDeHoy encendida: apagada, nada la pide ni la anuncia). Jamás las
    // funciones `votar`, `cuenta` ni `alerta` (esta avisa al mesero desde la pegatina de una mesa: es
    // de carta.html, no se ofrece a un agente por WebMCP, MCP ni llms.txt), ni ninguna tabla del POS.
    supabase: {
      url: 'https://lccgehvyymladqvumcez.supabase.co',
      key: 'sb_publishable_034ZAmpVk0MRwQ9H5HZz-w_lPFGKf3x',
      vistaCarta: 'carta_publica',
      columnasCarta: ['categoria', 'nombre', 'precio', 'descripcion'],
      tablaMenus: 'menus',
    },
  };

  globalThis.RESPLANDOR = RESPLANDOR;
  if (typeof module !== 'undefined' && module.exports) module.exports = RESPLANDOR;
})();
