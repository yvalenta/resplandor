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

  // Todo evento y toda celebración es EN EL LOCAL — nunca a domicilio, nunca catering
  // externo. Lo único que puede salir del restaurante es un almuerzo programado, y solo
  // si la persona asume el costo del domicilio (ver ENTREGAS en assets/js/solicitud.js).
  // Esta lista es la única fuente de qué tipos de solicitud existen: la landing pinta una
  // tarjeta por cada uno (menos «reserva» y «almuerzo», que tienen su propia sección) y
  // llama a abrir('<id>'); solicitud.js valida contra estos mismos ids.
  const TIPOS = [
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

  const RESPLANDOR = {
    marca: 'Resplandor Restaurante',
    sitio: SITIO,
    cocina: 'colombiana, asados y cocina mixta',
    descripcion:
      'Cocina colombiana, asados y cocina mixta en La Estrella, Antioquia. Almuerzo todos los días, ' +
      'celebraciones en el local de 10 a 30 personas y un menú de la semana que vota la gente.',

    whatsapp: '573225542434',
    whatsappVisible: '+57 322 554 2434',

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
      comoLlegar: 'https://www.google.com/maps/dir/?api=1&destination=6.1584468%2C-75.6434789',
      carta: SITIO + 'carta.html',
      menu: SITIO + 'menu.html',
      landing: SITIO, // la raíz: la landing es index.html (el POS vive en /pos.html)
      // Páginas ancla de confianza (sin JS: texto plano, siempre igual haya o no red) —
      // scripts/descubrimiento.mjs las genera a partir de este mismo objeto; nunca a mano.
      about: SITIO + 'about.html',
      contacto: SITIO + 'contact.html',
      privacidad: SITIO + 'privacy.html',
    },

    // Políticas de negocio: nunca eventos a domicilio, nunca catering externo. El
    // almuerzo programado es la única excepción (recoger, o domicilio a costo del
    // cliente). armarSolicitud (solicitud.js) hace cumplir esto con avisos, no con throw.
    politicas: {
      eventosSoloEnElLocal: true,
      almuerzoDomicilioCostoCliente: true,
      anticipacionRecomendadaHoras: 48,
    },

    tipos: TIPOS,

    // Supabase público (mismo que usa carta.html/menu.html): SOLO lectura anónima de
    // `carta_publica` (vista: categoria, nombre, precio, descripcion) y de la tabla
    // `menus`. Jamás la función `votar` ni `cuenta`, ni ninguna tabla del POS.
    supabase: {
      url: 'https://yjtcrhmdztbuylgpuvsm.supabase.co',
      key: 'sb_publishable_1YEHWCyA6er72OsiXzpSyQ_eZx59p_7',
      vistaCarta: 'carta_publica',
      columnasCarta: ['categoria', 'nombre', 'precio', 'descripcion'],
      tablaMenus: 'menus',
    },
  };

  globalThis.RESPLANDOR = RESPLANDOR;
  if (typeof module !== 'undefined' && module.exports) module.exports = RESPLANDOR;
})();
