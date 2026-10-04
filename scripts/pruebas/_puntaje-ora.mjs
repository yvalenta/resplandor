// Los criterios de ora.ai (https://ora.ai/score/resplandor.ynt.codes) calcados en local, para que
// una regresión se note sin gastar la cuota de escaneos (30 por IP y día). Tarea
// tareas/2026-10-03-puntaje-ora.md: ahí está qué chequeo pide qué, y qué quedó aparcado (lo que
// GitHub Pages no puede servir: cabeceras, negociación por Accept, un endpoint vivo).
//
// Son funciones puras sobre un «árbol»: `leer(rel)` devuelve el texto de un archivo y `existe(rel)` dice
// si está. Las corren dos pruebas: descubrimiento.test.mjs sobre lo que el generador acaba de escribir en
// un directorio temporal (con todas las funciones encendidas) y puntaje-ora.test.mjs sobre el repo REAL
// (lo que de verdad se publica, con las banderas que tenga). Este archivo no termina en «.test.mjs»:
// `node --test scripts/pruebas/*.test.mjs` no lo corre como prueba.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const SITIO_URL = 'https://resplandor.ynt.codes/';
const sha256 = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex');

/** Todos los bloques <script type="application/ld+json"> de una página, ya parseados. */
export const bloquesJsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
/** El nodo de un @type dado (desde puntaje-ora el JSON-LD son varios bloques: nunca «el primero»). */
export const nodoJsonLd = (html, tipo) => bloquesJsonLd(html).find((n) => n['@type'] === tipo);

/** La ruta del archivo que sirve una URL del sitio (GitHub Pages: `/` → index.html, `carpeta/` → carpeta/index.html); null si no es del sitio. */
export function rutaDeUrl(url) {
  if (!url.startsWith(SITIO_URL)) return null;
  let rel = url.slice(SITIO_URL.length).split('#')[0].split('?')[0];
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  return rel;
}

/** Los `@id` que un nodo REFERENCIA (objetos con solo `@id`), a cualquier profundidad. */
function referenciasId(valor, salida = []) {
  if (Array.isArray(valor)) valor.forEach((v) => referenciasId(v, salida));
  else if (valor && typeof valor === 'object') {
    const llaves = Object.keys(valor);
    if (llaves.length === 1 && llaves[0] === '@id') salida.push(valor['@id']);
    else llaves.forEach((k) => referenciasId(valor[k], salida));
  }
  return salida;
}

/** Las ocho etapas de Auth.md (WorkOS), en el orden de la especificación, como las escribe auth.md. */
export const SECCIONES_AUTH_MD = [
  '### Discover (descubrir)',
  '### Pick a method (elegir método)',
  '### Register (registrar)',
  '### Claim (reclamar)',
  '### Exchange (canjear)',
  '### Use the access_token (usar la credencial)',
  '### Errors (errores)',
  '### Revocation (revocación)',
];

/** Cada página con su gemela en Markdown (ruta del .md desde la raíz del sitio). */
export const GEMELOS_MD = {
  'index.html': 'index.md',
  'carta.html': 'carta.md',
  'about.html': 'about.md',
  'contact.html': 'contact.md',
  'privacy.html': 'privacy.md',
  'pricing.html': 'pricing.md',
  'api/index.html': 'api/index.md',
};

const enlacesMarkdown = (texto) => [...texto.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);

/**
 * Los chequeos, uno por criterio de ora. Cada uno recibe (leer, existe, contexto) con
 * contexto = { fecha: la `fecha` de version.json del árbol, R: RESPLANDOR del árbol }.
 */
export const CHEQUEOS = {
  'JSON-LD en varios bloques: Restaurant, Organization (contactPoint + address + sameAs + logo) y WebSite enlazados por @id; FAQPage solo si la landing tiene <section id="preguntas">, con sus mismas preguntas'(leer) {
    const html = leer('index.html');
    const nodos = bloquesJsonLd(html);
    assert.ok(nodos.length >= 3, `se esperaban al menos 3 bloques JSON-LD y hay ${nodos.length}`);
    const tipos = nodos.map((n) => n['@type']);
    for (const t of ['Restaurant', 'Organization', 'WebSite']) assert.ok(tipos.includes(t), `falta el nodo ${t} (hay ${tipos.join(', ')})`);
    assert.equal(nodos[0]['@type'], 'Restaurant', 'el Restaurant sigue siendo el primer bloque (lo leen raiz.test.mjs y funciones.test.mjs)');
    const organizacion = nodoJsonLd(html, 'Organization');
    assert.equal(organizacion.contactPoint['@type'], 'ContactPoint');
    assert.ok(organizacion.contactPoint.contactType && (organizacion.contactPoint.telephone || organizacion.contactPoint.email), 'contactPoint con contactType y teléfono/correo');
    assert.equal(organizacion.address['@type'], 'PostalAddress');
    assert.ok(Array.isArray(organizacion.sameAs) && organizacion.sameAs.length >= 2, 'sameAs (la ficha de Maps y el Instagram)');
    assert.equal(organizacion.logo['@type'], 'ImageObject');
    assert.ok(organizacion.logo.url.startsWith(SITIO_URL), 'el logo es del propio sitio');
    for (const campo of ['name', 'url', 'description', 'email', 'telephone']) assert.ok(organizacion[campo], `Organization sin ${campo}`);
    const restaurante = nodoJsonLd(html, 'Restaurant');
    assert.equal(restaurante.parentOrganization['@id'], organizacion['@id']);
    assert.equal(organizacion.location['@id'], restaurante['@id']);
    assert.deepEqual(organizacion.sameAs, restaurante.sameAs, 'la Organization y el Restaurant tienen el MISMO sameAs: nada inventado en uno que no esté en el otro');
    assert.deepEqual(organizacion.contactPoint, restaurante.contactPoint);
    const sitio = nodoJsonLd(html, 'WebSite');
    assert.equal(sitio.publisher['@id'], organizacion['@id']);
    assert.equal(sitio.inLanguage, 'es');
    const ids = new Set(nodos.map((n) => n['@id']));
    for (const n of nodos) {
      assert.ok(n['@id'] && n['@id'].startsWith(SITIO_URL + '#'), `${n['@type']}: @id del sitio`);
      for (const ref of referenciasId(n)) assert.ok(ids.has(ref), `${n['@type']} referencia un @id sin nodo: ${ref}`);
      for (const campo of ['aggregateRating', 'review', 'offers', 'makesOffer']) assert.equal(n[campo], undefined, `${n['@type']}.${campo} no debe aparecer: no hay dato en el repo`);
      assert.doesNotMatch(JSON.stringify(n.sameAs || []), /facebook|tiktok|twitter|x\.com/i);
    }
    const seccion = html.match(/<section id="preguntas"[^>]*>([\s\S]*?)<\/section>/);
    const faq = nodoJsonLd(html, 'FAQPage');
    if (!seccion) {
      assert.equal(faq, undefined, 'sin <section id="preguntas"> no se emite FAQPage');
      return;
    }
    assert.ok(faq, 'la landing tiene <section id="preguntas"> y falta el FAQPage');
    assert.ok(Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 3, 'al menos tres preguntas');
    const plano = seccion[1].replace(/\s+/g, ' ');
    for (const q of faq.mainEntity) {
      assert.equal(q['@type'], 'Question');
      assert.ok(plano.includes(q.name), `la pregunta «${q.name}» no está (tal cual) en la sección de la landing`);
      assert.equal(q.acceptedAnswer['@type'], 'Answer');
      assert.ok(q.acceptedAnswer.text.length > 10 && !/<[a-z]/i.test(q.acceptedAnswer.text), 'la respuesta es texto plano, sin etiquetas');
    }
  },

  'ARD: ard.json y ai-catalog.json byte a byte iguales; cada entrada con 2–5 representativeQueries y trustManifest.identity con el dominio del URN; cada atestación es el sha256 REAL del archivo; WebMCP solo identidad'(leer, existe) {
    const texto = leer('.well-known/ard.json');
    assert.equal(texto, leer('.well-known/ai-catalog.json'), 'la ruta canónica (ARD v0.91) y la vieja sirven el mismo catálogo');
    const catalogo = JSON.parse(texto);
    assert.equal(catalogo.specVersion, '1.0');
    assert.ok(catalogo.entries.length >= 10, `se esperaban al menos 10 entradas y hay ${catalogo.entries.length}`);
    const sufijos = catalogo.entries.map((e) => e.identifier.split(':').slice(3).join(':'));
    for (const s of ['docs:llms', 'data:local', 'api:openapi', 'docs:api', 'docs:index-md', 'docs:pricing', 'api:catalog', 'mcp:server-card', 'skills:index', 'web:webmcp', 'docs:auth']) assert.ok(sufijos.includes(s), `falta la entrada ${s}`);
    for (const e of catalogo.entries) {
      assert.match(e.identifier, /^urn:air:resplandor\.ynt\.codes:[a-zA-Z0-9._-]+(:[a-zA-Z0-9._-]+)*$/);
      assert.ok(Array.isArray(e.representativeQueries) && e.representativeQueries.length >= 2 && e.representativeQueries.length <= 5, `${e.identifier}: representativeQueries de 2 a 5 (ARD §4.2)`);
      assert.ok(e.representativeQueries.some((q) => /resplandor/i.test(q)), `${e.identifier}: las consultas nombran a Resplandor`);
      assert.equal(e.trustManifest.identity.domain, e.identifier.split(':')[2], `${e.identifier}: la identidad tiene que ser el <publisher> del URN (ARD §4.5.1)`);
      assert.equal(e.trustManifest.identity.type, 'domain');
      for (const a of e.trustManifest.attestations || []) {
        const rel = rutaDeUrl(a.artifact);
        assert.ok(rel && existe(rel), `${e.identifier}: atestación de ${a.artifact}, que no existe`);
        assert.equal(a.algorithm, 'sha-256');
        assert.equal(a.digest, sha256(leer(rel)), `${e.identifier}: el digest no es el sha256 de ${rel} tal como está escrito`);
      }
      const rel = rutaDeUrl(e.url);
      assert.ok(rel && existe(rel), `${e.identifier}: su url ${e.url} no existe en el sitio`);
    }
    const webmcp = catalogo.entries.find((e) => e.identifier.endsWith(':web:webmcp'));
    assert.deepEqual(Object.keys(webmcp.trustManifest), ['identity'], 'index.html lo sella version.mjs después: solo identidad, nunca un hash que quedaría viejo');
    const conDigest = catalogo.entries.filter((e) => (e.trustManifest.attestations || []).length);
    assert.ok(conDigest.length >= 9, `al menos nueve entradas atestiguan su digest (hay ${conDigest.length})`);
  },

  'Agent Skills 0.2.0: $schema, y por skill name/description/type skill-md/url absoluta/digest sha256 de los bytes reales del .md; copia idéntica en skills/<name>/SKILL.md'(leer, existe) {
    const indice = JSON.parse(leer('.well-known/agent-skills/index.json'));
    assert.equal(indice.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
    assert.ok(indice.skills.length >= 2);
    for (const s of indice.skills) {
      assert.ok(s.name && s.description, `${s.name}: name y description`);
      assert.equal(s.type, 'skill-md');
      const rel = rutaDeUrl(s.url);
      assert.ok(rel && existe(rel), `${s.name}: url ${s.url} que no existe`);
      const md = leer(rel);
      assert.match(s.digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(s.digest, `sha256:${sha256(md)}`, `${s.name}: el digest no es el sha256 del .md servido`);
      assert.match(md, new RegExp(`^---\\nname: ${s.name}\\ndescription: .+\\n---\\n`), `${s.name}: frontmatter`);
      assert.ok(md.includes(`description: ${s.description}\n`), `${s.name}: la description del índice es la del frontmatter`);
      assert.ok(existe(`skills/${s.name}/SKILL.md`), `falta skills/${s.name}/SKILL.md`);
      assert.equal(leer(`skills/${s.name}/SKILL.md`), md, `skills/${s.name}/SKILL.md no es idéntica a la de .well-known`);
    }
  },

  'OpenAPI 3.1 honesto: /openapi.json = api/openapi.json; servidor = Supabase /rest/v1; operationId únicos y descritos; 200/400/401/404/416 con schema JSON (PostgREST); apikey en cabecera; sin precios reales'(leer, _, { R }) {
    const texto = leer('openapi.json');
    assert.equal(texto, leer('api/openapi.json'));
    const doc = JSON.parse(texto);
    assert.equal(doc.openapi, '3.1.0');
    assert.ok(doc.info.title && doc.info.version && doc.info.description);
    assert.equal(doc.servers[0].url, `${R.supabase.url}/rest/v1`);
    assert.ok(doc.paths[`/${R.supabase.vistaCarta}`], 'la carta pública es una ruta');
    assert.equal(Boolean(doc.paths[`/${R.supabase.tablaMenus}`]), Boolean(R.funciones.menuDeHoy), 'la tabla del menú solo con menuDeHoy encendida');
    const ids = [];
    for (const [ruta, metodos] of Object.entries(doc.paths)) {
      assert.deepEqual(Object.keys(metodos), ['get'], `${ruta}: solo GET (no hay escritura pública)`);
      const op = metodos.get;
      assert.ok(op.operationId && op.description && op.summary, `${ruta}: operationId, summary y description`);
      ids.push(op.operationId);
      for (const codigo of ['200', '400', '401', '404', '416']) {
        const r = op.responses[codigo];
        assert.ok(r && r.description && r.content['application/json'].schema, `${ruta}: respuesta ${codigo} con schema JSON`);
      }
      assert.ok(op.responses['200'].headers['Content-Range'], `${ruta}: Content-Range documentado`);
    }
    assert.equal(new Set(ids).size, ids.length, 'operationId únicos');
    assert.deepEqual(doc.security, [{ apikey: [] }]);
    const auth = doc.components.securitySchemes.apikey;
    assert.deepEqual([auth.type, auth.in, auth.name], ['apiKey', 'header', 'apikey']);
    assert.ok(auth.description.includes(R.supabase.key), 'la llave publishable está a la vista: es pública');
    const { Plato, Error: Err, ErrorSinLlave } = doc.components.schemas;
    assert.deepEqual(Object.keys(Plato.properties), ['categoria', 'nombre', 'precio', 'descripcion', 'etiqueta', 'dia_semana']);
    assert.equal(Plato.properties.precio.type, 'integer');
    assert.deepEqual(Object.keys(Err.properties), ['code', 'message', 'details', 'hint']);
    assert.deepEqual(Err.required, ['code', 'message']);
    assert.deepEqual(Object.keys(ErrorSinLlave.properties), ['message', 'hint']);
    for (const ext of ['x-versionado', 'x-limites', 'x-idempotencia', 'x-entorno-de-pruebas']) assert.ok(typeof doc[ext] === 'string' && doc[ext].length > 20, `falta ${ext}`);
    assert.doesNotMatch(texto, /\$\d/, 'ningún precio en pesos escrito a mano');
    assert.ok(/Plato de ejemplo/.test(texto) && /ilustrativo/.test(texto), 'el ejemplo se declara ejemplo');
  },

  'Markdown gemelo: cada página anuncia su .md con <link rel="alternate" type="text/markdown">, y el .md abre con front matter (title, description, canonical, last-updated = version.json) y después un H1'(leer, existe, { fecha }) {
    assert.match(String(fecha), /^\d{4}-\d{2}-\d{2}$/, 'hace falta la fecha de version.json');
    for (const [pagina, md] of Object.entries(GEMELOS_MD)) {
      const html = leer(pagina);
      const href = md.split('/').pop();
      assert.match(html, new RegExp(`<link rel="alternate" type="text/markdown" href="${href}"\\s*/?>`), `${pagina} no anuncia ${md}`);
      assert.ok(existe(md), `falta ${md}`);
      const texto = leer(md);
      const m = texto.match(/^---\n([\s\S]*?)\n---\n\n(# .+)\n/);
      assert.ok(m, `${md}: tiene que abrir con front matter y, enseguida, el H1`);
      const fm = m[1];
      assert.match(fm, /^title: ".+"$/m, `${md}: title`);
      assert.match(fm, /^description: ".+"$/m, `${md}: description`);
      const canonical = fm.match(/^canonical: (\S+)$/m);
      assert.ok(canonical, `${md}: canonical`);
      assert.equal(rutaDeUrl(canonical[1]), pagina, `${md}: el canonical es su página`);
      assert.match(fm, new RegExp(`^last-updated: ${fecha}$`, 'm'), `${md}: last-updated es la fecha de version.json`);
      assert.doesNotMatch(texto, /<!doctype|<html|<\/p>|<li>/i, `${md}: es Markdown, no HTML`);
      for (const url of enlacesMarkdown(texto)) {
        const rel = rutaDeUrl(url);
        if (rel) assert.ok(existe(rel), `${md}: enlaza ${url}, que no existe en el sitio`);
      }
    }
    assert.equal(leer('auth.md').split('\n')[0], '# auth.md', 'auth.md NO lleva front matter: su primera línea es el H1 de la especificación');
  },

  'sitemap.xml: <lastmod> W3C (la fecha de version.json) en todas las entradas, con pricing.html y api/'(leer, _, { fecha }) {
    const xml = leer('sitemap.xml');
    const entradas = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
    assert.ok(entradas.length >= 7, `se esperaban al menos 7 entradas y hay ${entradas.length}`);
    for (const e of entradas) {
      const loc = e.match(/<loc>(.*?)<\/loc>/)[1];
      assert.match(e, new RegExp(`<lastmod>${fecha}</lastmod>`), `${loc}: sin <lastmod> o con otra fecha`);
    }
    assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/pricing\.html<\/loc>/);
    assert.match(xml, /<loc>https:\/\/resplandor\.ynt\.codes\/api\/<\/loc>/);
  },

  'NLWeb Schema Feeds: robots.txt anuncia schemamap:, schemamap.xml apunta a schema/local.jsonl (con lastmod y sf:contentType), y el feed es un JSON-LD por línea con @context/@type/@id'(leer, existe, { fecha }) {
    assert.match(leer('robots.txt'), /^schemamap: https:\/\/resplandor\.ynt\.codes\/schemamap\.xml$/m);
    const mapa = leer('schemamap.xml');
    assert.match(mapa, /xmlns:sf="http:\/\/schema\.org\/schemas\/schemafeed\/0\.1"/);
    assert.match(mapa, /<loc>https:\/\/resplandor\.ynt\.codes\/schema\/local\.jsonl<\/loc>/);
    assert.match(mapa, new RegExp(`<lastmod>${fecha}</lastmod>`));
    assert.match(mapa, /<sf:contentType>structuredData\/schema\.org<\/sf:contentType>/);
    assert.ok(existe('schema/local.jsonl'));
    const lineas = leer('schema/local.jsonl').split('\n').filter(Boolean);
    assert.ok(lineas.length >= 3);
    const tipos = lineas.map((l) => {
      const nodo = JSON.parse(l);
      assert.equal(nodo['@context'], 'https://schema.org');
      assert.ok(nodo['@type'] && nodo['@id']);
      return nodo['@type'];
    });
    for (const t of ['Restaurant', 'Organization', 'WebSite']) assert.ok(tipos.includes(t), `el feed no trae ${t}`);
    assert.doesNotMatch(leer('schema/local.jsonl'), /"precio"|\$\d/, 'sin platos ni precios en el feed');
  },

  'auth.md: las ocho etapas de Auth.md como ### en orden, nombrando las palabras de la spec para negarlas y nunca con una URL al lado'(leer) {
    const txt = leer('auth.md');
    let desde = txt.indexOf('## Registro de agentes');
    assert.ok(desde !== -1);
    for (const seccion of SECCIONES_AUTH_MD) {
      const i = txt.indexOf(`\n${seccion}\n`, desde);
      assert.ok(i !== -1, `falta (o está fuera de orden) «${seccion}»`);
      desde = i;
    }
    assert.ok(txt.indexOf('## Lecturas públicas') > desde, 'las ocho etapas van dentro de «Registro de agentes»');
    for (const palabra of ['WWW-Authenticate', 'agent_auth', 'identity_endpoint', 'identity_assertion', 'service_auth', 'id-jag', 'access_token']) {
      const lineas = txt.split('\n').filter((l) => l.includes(palabra));
      assert.ok(lineas.length, `auth.md no nombra ${palabra}`);
      for (const l of lineas) assert.doesNotMatch(l, /https?:\/\//, `«${palabra}» con una URL al lado: parecería un endpoint real`);
    }
    assert.doesNotMatch(txt, /POST \/agent\/auth|register_uri|registration_endpoint|client_secret/i);
    assert.deepEqual(txt.match(/[\w.+-]+@[\w-]+(?:\.[A-Za-z]{2,})+/g) || [], [], 'sin correos');
  },

  'llms.txt: «Cuándo usar este sitio» (para qué sí, para qué no, en qué orden llamar), enlaces Markdown absolutos que resuelven a archivos del sitio, y el repositorio'(leer, existe) {
    const txt = leer('llms.txt');
    assert.match(txt, /^## Cuándo usar este sitio$/m);
    assert.match(txt, /Úsalo cuando/);
    assert.match(txt, /No sirve para pagar ni cobrar/);
    assert.match(txt, /En qué orden llamar/);
    const enlaces = enlacesMarkdown(txt);
    assert.ok(enlaces.length >= 15, `se esperaban al menos 15 enlaces Markdown y hay ${enlaces.length}`);
    for (const url of enlaces) {
      const rel = rutaDeUrl(url);
      if (rel === null) continue; // el repositorio
      assert.ok(existe(rel), `llms.txt enlaza ${url} y ${rel} no existe en el sitio`);
    }
    assert.ok(enlaces.includes('https://github.com/yvalenta/resplandor'), 'enlaza el repositorio');
    assert.doesNotMatch(txt, /\]\((?!https?:\/\/)/, 'ningún enlace relativo: todos absolutos');
    for (const rel of ['openapi.json', 'api/', 'index.md', 'pricing.md', 'auth.md', '.well-known/ard.json', 'schemamap.xml']) assert.ok(txt.includes(`${SITIO_URL}${rel}`), `llms.txt no enlaza ${rel}`);
  },

  'api/: documentación sin JS con autenticación, errores, paginación y límites; api/llms.txt modular; plugin.json con $schema y name; server card con icons https del sitio'(leer, existe) {
    const html = leer('api/index.html');
    assert.doesNotMatch(html, /<script/i, 'la documentación se lee sin ejecutar nada');
    for (const h2 of ['Autenticación', 'La carta en vivo', 'Errores', 'Paginación y límites', 'Versionado, idempotencia y entorno de pruebas', 'Repositorio']) assert.ok(html.includes(`<h2>${h2}</h2>`), `api/index.html sin «${h2}»`);
    assert.match(html, /<link rel="alternate" type="application\/vnd\.oai\.openapi\+json" href="openapi\.json">/);
    assert.match(html, /href="\.\.\/carta\.html"/, 'el pie de una página en api/ sube un nivel');
    assert.ok(html.includes('https://github.com/yvalenta/resplandor'));
    const llms = leer('api/llms.txt');
    assert.ok(llms.startsWith('# '), 'api/llms.txt empieza con un H1');
    assert.match(llms, /^## Cuándo usarla$/m);
    for (const url of enlacesMarkdown(llms)) {
      const rel = rutaDeUrl(url);
      if (rel) assert.ok(existe(rel), `api/llms.txt enlaza ${url}, que no existe`);
    }
    const plugin = JSON.parse(leer('plugin.json'));
    assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    const tarjeta = JSON.parse(leer('.well-known/mcp/server-card.json'));
    assert.equal(plugin.name, tarjeta.name, 'plugin.json y la server card se llaman igual');
    assert.equal(plugin.repository, 'https://github.com/yvalenta/resplandor');
    assert.equal(plugin.mcp, undefined, 'sin mcp.json ni URL del MCP mientras el Worker no esté desplegado');
    assert.ok(Array.isArray(tarjeta.icons) && tarjeta.icons.length >= 1);
    for (const icono of tarjeta.icons) {
      assert.ok(icono.src.startsWith(SITIO_URL), 'icono del propio sitio, por https');
      assert.ok(['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'].includes(icono.mimeType));
      for (const s of icono.sizes) assert.match(s, /^(\d+x\d+|any)$/);
      assert.ok(existe(rutaDeUrl(icono.src)), `el icono ${icono.src} no existe`);
    }
    const catalogo = JSON.parse(leer('.well-known/api-catalog'));
    const carta = catalogo.linkset.find((l) => l['service-desc']);
    assert.ok(carta['service-desc'].some((d) => d.type === 'application/vnd.oai.openapi+json' && rutaDeUrl(d.href) === 'api/openapi.json'), 'el api-catalog apunta su service-desc al OpenAPI');
  },

  'pricing: pricing.html y pricing.md con el rango de precios, cómo se cotiza y «todo gratis» para agentes, sin un precio escrito a mano; la landing enlaza pricing.html y api/ en el pie y anuncia index.md y el OpenAPI en el head; carta.html anuncia carta.md'(leer, _, { R }) {
    for (const archivo of ['pricing.html', 'pricing.md']) {
      const texto = leer(archivo);
      assert.ok(texto.includes(R.rangoDePrecios), `${archivo}: el rango de precios (rangoDePrecios)`);
      assert.doesNotMatch(texto, /\$\d/, `${archivo}: ningún precio en pesos escrito a mano`);
      assert.match(texto, /se cotiza por\s+WhatsApp/);
      assert.match(texto, /Sin anticipos ni\s+pagos por este sitio/);
      assert.match(texto, /gratis y sin registro/);
      assert.match(texto, /x402, MPP y UCP no aplican/);
      assert.match(texto, /no la cites como\s+vigente/, 'la copia de respaldo de la carta no se cita como vigente');
    }
    assert.doesNotMatch(leer('pricing.html'), /<script/i);
    const index = leer('index.html');
    assert.match(index, /<link rel="alternate" type="text\/markdown" href="index\.md" \/>/);
    assert.match(index, /<link rel="alternate" type="application\/vnd\.oai\.openapi\+json" href="api\/openapi\.json" \/>/);
    assert.match(index, /<a href="pricing\.html" class="enlace-pie[^"]*">Precios y cotizaciones<\/a>/);
    assert.match(index, /<a href="api\/" class="enlace-pie[^"]*">API y MCP \(para agentes\)<\/a>/);
    assert.match(leer('carta.html'), /<link rel="alternate" type="text\/markdown" href="carta\.md">/);
    const noEncontrada = leer('404.html');
    for (const enlace of ['pricing.html', 'api/', 'index.md', 'openapi.json', '.well-known/ard.json']) assert.ok(noEncontrada.includes(`href="${enlace}"`), `404.html no enlaza ${enlace}`);
  },
};
