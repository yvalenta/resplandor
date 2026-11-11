---
estado: en-curso
dueño: ambos
fecha: 2026-11-10
tema: los almuerzos quedan a 23.000 (sale el precio de 19.000) y entran cuatro bowls a 15.000 con guarapo; los ingredientes de «Arma tu bowl» viven solo en su descripción en la base, de donde salen los pasos del POS y los grupos de la carta
criterio_cierre: el select de confirmación del sobre en producción devuelve Menú Resplandor y Seco a 23000 y los 4 bowls a 15000 con «Incluye guarapo», la carta al aire los muestra, y una tablet recargada agrega «Arma tu bowl» preguntando los cuatro pasos de su descripción
---

Pedido de Yonatan del 2026-11-10, en la sesión: «almuerzos 20000, los precios de 19000 y 23000 ya no estarán; debemos actualizar la
carta y el pos; bowls a 15000» con cuatro bowls (criollo, mixto, Resplandor y «Arma tu bowl»: elige base, proteína, vegetales y
guarnición), después «todos nuestros bowls vienen con guarapo» y, viendo la carta, «distribuye el texto visualmente para distinguir
entre categoría base, vegetales y demás». El mismo día, más tarde: «hay un cambio almuerzos a $23.000» y «Arma tu bowl por definir
ingredientes de cada uno, lo podemos tener listo para cambiar cualquier ingrediente sin afectar tanto, sin tanta prueba, sin tanto
agente rectificando», con la lista Base: arroz, pasta, lechuga, frijol · Proteína: pollo desmechado, carne molida, carne desmechada,
atún, huevo cocido · Vegetales: pico de gallo, tomate zanahoria , pepino zuquini · Guarnición: plátano maduro, papa cocinada, chips
de plátano, yuca frita.

## Lo que hay que saber (para una sesión fría)

- Los precios y los platos NO viven en el código: viven en `productos` de Supabase (proyecto `lccgehvyymladqvumcez`). La carta, la
  landing y los agentes leen la vista `carta_publica`, y el POS lee la tabla. Lo de producción lo carga
  `docs/sobres/2026-11-10-almuerzos-y-bowls.sql`, que pega Yonatan (el conector de Supabase de las sesiones entra con la cuenta vieja).
- El sobre: Menú Resplandor (ya estaba) y Seco (estaba a 19.000) a 23.000; Sopa y carne, Sopa, Carne y Sancocho no cambian, y la
  promo del domingo «Almuerzos» (Promociones, 20.000) tampoco (es la promoción, no el precio del almuerzo; el «3er almuerzo» no tiene
  precio: con almuerzos a 23.000 el tercero queda en 18.400). Los bowls van en una
  categoría propia «Bowls» (no en Ejecutivos, así no cuentan para el «3er almuerzo» del lunes), con ids fijos `bowl_criollo`,
  `bowl_mixto`, `bowl_resplandor` y `bowl_arma` (el POS cuelga del id los pasos de «Arma tu bowl»), etiqueta «Incluye guarapo», `activo` y `en_carta`.
  Aborta sin escribir si falta o se repite un almuerzo, o si ya hay un bowl con otro id. Trae su reversa y su select de confirmación.
- **Pegarlo con el local cerrado**: `productos_tocan_cuentas` le cambia el precio a toda cuenta ABIERTA en el momento (un Seco abierto
  pasa de 19.000 a 23.000).
- **Los ingredientes de «Arma tu bowl» son un DATO en un solo lugar: su `descripcion` en `productos`** («Base: arroz, pasta, lechuga o
  frijol. Proteína: … Vegetales: … Guarnición: …»). La carta y la landing la pintan por grupos (`gruposDe`) y el POS saca de ella los
  pasos (`opcionesDe` en `pos.html`, solo para los ids de `OPCIONES_EN_LA_DESCRIPCION`; la misma `gruposDe`, y cada opción separada por
  coma y la última por «o»/«u»; una «y» queda dentro de la opción). Cambiar un ingrediente = editar esa descripción (Productos en el POS,
  o un update): sin código, sin pruebas, sin recargar tablets (Realtime), y no mueve cuentas abiertas (el trigger no mira la
  descripción). El sobre, la instantánea y la semilla del POS son copias que pueden quedar viejas sin romper nada: las pruebas miran
  la forma (cuatro pasos, listas no vacías, sin precios), nunca la lista.
- Orden de salida: (1) push a `main`; (2) recargar las tablets y comprobar la versión en el pie; (3) el sobre; (4) su select. Una
  tablet con el POS viejo agregaría «Arma tu bowl» sin preguntar nada.
- POS (`pos.html`): «Arma tu bowl» ya NO tiene lista en `OPCIONES_PRODUCTO`: sus pasos salen de la descripción (ver arriba), una opción
  por paso. Los vegetales van como cinco opciones sueltas (pico de gallo, tomate, zanahoria, pepino, zucchini), como pidió leerlos la
  sesión que lanzó esta; el mensaje decía «tomate zanahoria , pepino zuquini»: si eran parejas, es editar la descripción, no código.
  Los Bowls van después de Ejecutivos en la carta del mesero; la semilla local quedó con los almuerzos a 23.000 y los bowls; el texto
  de ejemplo del «3er almuerzo» en el formulario de promos no nombra precios.
- Carta (`carta.html`): sección Bowls después de Ejecutivos (ícono `soup`), el menú del día con 23.000 por defecto, y la
  descripción de «Arma tu bowl» por grupos (ver «Descripción por grupos» en `docs/landing-y-agentes.md`). La landing (`#carta`) también.
  La instantánea `assets/js/carta-respaldo.js` lleva los precios nuevos y los bowls (34 filas; la `FECHA` sigue en el 3-sep).

## Lo que falta (para la sesión fresca: `cd ~/Developer/worktrees/resplandor--precios-bowls && claude` → `/casa almuerzos-y-bowls`)

**El commit de la sesión de «23.000 e ingredientes como dato» quedó a medias (regla de corte)**: el sobre, el POS, la carta, la instantánea,
`pos-bowls` (10/10) y `sobre-almuerzos-y-bowls` (5/5, Docker) están al día; `funciones` y `carta-promos` todavía esperan 20.000 y la
lista vieja, y los sellos de versión están viejos. Antes que nada (pasos 0a–0e):

0a. `scripts/pruebas/funciones.test.mjs`: en el nombre de la prueba de la instantánea (:685) «los almuerzos a 20.000» → «a 23.000»; en
    :698–701, `precio('Menú Resplandor')` y `precio('Seco')` a 23000, y el «ningún plato a 23.000 ni a 19.000» pasa a «ningún plato a
    19.000» (`f.precio === 19000`); en :900, `c.dia.precio` a 23000; en :927–932, cambiar los textos exactos de los cuatro grupos de
    «Arma tu bowl» por la FORMA: títulos `['Base', 'Proteína', 'Vegetales', 'Guarnición']`, cada `texto` no vacío y sin `\d` ni `$`.
0b. `scripts/pruebas/carta-promos.test.mjs` de vuelta a 23.000 (el Seco a 23.000 va después del sancocho por precio, no por empate):
    :158 el comentario («el seco vale 23.000: va después del sancocho, que vale 20.000»); :160 `['Seco', 23000, '']`; :164
    `h.c.dia.precio` 23000; :486 `['Seco', '$ 23.000']`; los dos nombres de prueba que dicen «$ 20.000» del Menú (:571 «ni su precio
    de $ 20.000» → «ni $ 23.000», y :610 «Menú Resplandor $ 20.000» → «$ 23.000»): quedan IGUAL que en `main` y que en
    `claude/laughing-wu-71988e`, así esa rama ya no choca ahí; :580 `/23\.000|\$ 2\d\.\d{3}/`; :602 y :623 `/\$ 23\.000/`. Lo de
    Bowls (sección, pestañas, ícono, cuatro a 15.000, rótulos) se queda. Correrla SIN `--test-force-exit` (31 pruebas).
0c. `docs/landing-y-agentes.md`, «Descripción por grupos» (:607): sumar que el POS saca de esa misma descripción los pasos de «Arma
    tu bowl» (`opcionesDe`, ids de `OPCIONES_EN_LA_DESCRIPCION`), la gramática de las opciones (coma, la última con «o»/«u», la «y» no
    parte) y cómo se cambia un ingrediente (Productos o update; sin código ni pruebas; no toca cuentas abiertas).
0d. Generadores en el orden de AGENTS.md (cambiaron `pos.html`, `carta.html` y `assets/js/carta-respaldo.js`): `node scripts/css.mjs`,
    `iconos.mjs`, `descubrimiento.mjs`, `version.mjs`; después los cuatro `--comprobar` en exit 0.
0e. `TZ=UTC node --test scripts/pruebas/{pos-bowls,sobre-almuerzos-y-bowls,funciones,promo-precio-fijo-navegador}.test.mjs` y aparte
    `TZ=UTC node --test scripts/pruebas/carta-promos.test.mjs`; auditar escapes (`grep -c '\\u[0-9a-fA-F]\{4\}'`: 24 en `pos.html` y 4
    en `carta.html`, como antes); commit con rutas explícitas; y el paso 1 de abajo.

1. Falta la suite completa, en segundo plano y con tope 7200000 ms:
   `TZ=UTC node --test --test-concurrency=2 --test-force-exit scripts/pruebas/*.test.mjs`. Anotar `# tests / # pass / # fail` y
   clasificar cada `not ok` por su mensaje. Ojo: `--test-force-exit` puede dejar sin correr la mitad de navegador de 12 archivos (ver
   el hallazgo en la bitácora). Por eso, después, correr aparte y SIN esa bandera los 11 que no son `carta-promos`:
   `TZ=UTC timeout 3600 node --test --test-concurrency=2 scripts/pruebas/{carta-mesa-desactivada,carta-abonos,carta-para-llevar,desborde,cuenta-en-vivo,insignia,navegador-audio,pagar,pos-orden-escritorio,promos,version-contraste}.test.mjs`.
   Opcional: el comentario de `carta.html` que lista el orden de las secciones (cerca de la :342) no nombra Bowls. Si se corrige,
   hay que volver a correr los generadores, porque cambia la huella de la versión.
2. Con el visto de Yonatan: `git push origin tarea/precios-bowls:main` (`main` suele estar tomada por otro worktree; si hay que fusionar,
   el único conflicto esperable es el sello: se resuelve con `node scripts/version.mjs`).
3. Yonatan recarga las tablets y comprueba que el pie muestra la versión de `version.json`.
4. Yonatan pega el sobre con el local cerrado (`LC_ALL=en_US.UTF-8 cat docs/sobres/2026-11-10-almuerzos-y-bowls.sql | LC_ALL=en_US.UTF-8 pbcopy`,
   y `pbpaste | shasum -a 256` igual a la huella de la bitácora) y corre el select del final del sobre; se anota lo que devuelve.
5. Confirmar con Yonatan (todo es dato: si cambia, se edita la descripción en Productos o el sobre antes de pegarlo): los vegetales
   como cinco sueltos y no como parejas; «zucchini» por su «zuquini»; y que la promo del domingo «Almuerzos» sigue a 20.000.

## Bitácora
- 2026-11-10: worktree `~/Developer/worktrees/resplandor--precios-bowls`, rama `tarea/precios-bowls` desde `origin/main` (aadaab4).
  Leída en vivo la vista `carta_publica` (GET con la llave publicable): Menú Resplandor 23000, Seco 19000, ningún bowl. Hechos el
  sobre, el POS, la carta, la landing, la instantánea y sus pruebas (`scripts/pruebas/pos-bowls.test.mjs`, nueva; `funciones.test.mjs`
  y `promo-precio-fijo-navegador.test.mjs`, al día). El mutante sin `bowl_arma` en `OPCIONES_PRODUCTO` lo atrapan dos pruebas de
  `pos-bowls`. Capturas en Chromium con la vista simulada como quedará tras el sobre (carta a 320, 390 y 1280 px; landing a 390 px; la hoja
  de opciones del POS en celular y tablet con el arnés de Supabase simulado): sin desborde ni errores de consola. Generadores y
  `--comprobar` al día, versión `2026.11.10-45f1ace`.
- 2026-11-10: el sobre corrido contra un Postgres 17 desechable con las 27 migraciones (`scripts/pruebas/sobre-almuerzos-y-bowls.test.mjs`,
  nueva, 5/5): aborta sin escribir con un bowl de otro id o con un almuerzo que falta o se repite; pegado deja los dos almuerzos a 20000 y
  los cuatro bowls a 15000 con «Incluye guarapo» y en `carta_publica` (como anon); avisa «Cuentas abiertas ahora: 1.» y esa cuenta pasa
  de 23000 a 20000 (el trigger); pegado dos veces no repite bowls; la reversa de la cabecera vuelve a 23000/19000 y saca los bowls de
  la carta. Huella del sobre: sha256 `6f2f6483d7eb…de10`. Por confirmar con Yonatan: la categoría propia (los bowls fuera del
  «3er almuerzo») y los vegetales como tres parejas.
- 2026-11-10: Yonatan decidió «No, van aparte»: los bowls NO cuentan para el «3er almuerzo», queda la categoría propia (anotado en la
  cabecera del sobre, que pasó a decidido). Sigue por confirmar: los vegetales como tres parejas. Huella del sobre ahora: sha256
  `3670bf4fe1d00be112c6be6177f9703d3ace109342c3b7efbe61b12725077103`; `sobre-almuerzos-y-bowls` y `pos-bowls` 10/10 después del cambio.
  Suite completa cortada a mano a mitad (regla de corte de la casa, la sesión iba por ~360k de contexto), y corrida sobre un estado
  anterior a los últimos retoques (espacio de alineación en `carta.html`, sellos, cabecera del sobre): 142 ok y 5 not ok, todos en
  `scripts/pruebas/carta-promos.test.mjs` desde la :111 («vm, base ya migrada: Desayunos, Ejecutivos, Entradas, Platos fuertes,
  Bebidas y al final Promociones…», «vm, Desayunos con los tres platos del letrero…», «vm, Ejecutivos: «Sopa y carne» incluye jugo…»,
  «vm, compatibilidad: con la vista de antes…», «vm, un 402 (cuota) o un 500 no se reintenta…»). La primera dice `+ 'bowls'`: esa
  prueba arma la carta con la instantánea, que ahora trae la sección Bowls, y sus listas esperadas no la tienen. No se arregló en esta
  sesión: es el paso 1 de «Lo que falta». Nada publicado ni aplicado en producción.
- 2026-11-10 (sesión fresca, lanzada por la anterior): `scripts/pruebas/carta-promos.test.mjs` al día con la instantánea de 34 filas,
  sin tocar `carta.html`. Las 5 de vm: Bowls justo después de Ejecutivos en las secciones, las pestañas y los íconos (`soup`); el Seco
  a 20.000, que empata con el sancocho y por eso va después de él (a igual precio, por nombre); la tarjeta del día a 20.000; y 33
  platos con la foto, no 29. Había 6 de navegador más, rotas por lo mismo: pestañas sin «Bowls», «Seco $ 19.000» y «$ 23.000» en la
  tarjeta del jueves y del lunes. Se sumaron los cuatro bowls a 15.000 (vm y Chromium), los cuatro rótulos de «Arma tu bowl» en
  Chromium, y Bowls en el orden vertical de la página. `TZ=UTC node --test scripts/pruebas/carta-promos.test.mjs` da tests 31 · pass 31 ·
  fail 0 (38 s); antes del arreglo daba 31 · 20 · 11. Los cuatro `--comprobar` de AGENTS.md salen con exit 0 y la versión sigue en
  `2026.11.10-45f1ace`.
  Hallazgo: con `--test-force-exit`, `carta-promos` corre solo 20 pruebas (antes del arreglo: tests 20 · pass 15 · fail 5, en
  0,3 s). El proceso sale cuando terminan las pruebas ya registradas, y en ese momento el `await pw.chromium.launch()` de nivel superior
  todavía no registró las de navegador; no aparecen ni como falla ni como salto. Por eso la corrida anterior vio 5 fallas y no 11.
  Tienen el mismo patrón (Chromium con `await` de nivel superior, después de registrar pruebas) otros 11 archivos: carta-mesa-desactivada,
  carta-abonos, carta-para-llevar, desborde, cuenta-en-vivo, insignia, navegador-audio, pagar, pos-orden-escritorio, promos y
  version-contraste. Que su mitad de navegador corra depende de si Chromium abre antes de que terminen las pruebas previas, o sea, de
  la carga de la máquina. La suite completa no se corrió: la sesión pasó los 200k de contexto (regla de corte). Nada publicado ni
  aplicado en producción.
- 2026-11-10 (sesión lanzada por la de navegador-force-exit, sobre los dos pedidos de la tarde): almuerzos a 23.000 e ingredientes de
  «Arma tu bowl» como dato. Hecho: el sobre (Menú y Seco a 23.000; el aviso dice también los precios de antes; la reversa solo vuelve
  el Seco a 19.000), la instantánea (Menú y Seco a 23.000 y la descripción nueva de «Arma tu bowl»), la semilla del POS y el 23.000
  por defecto de la tarjeta del día en `carta.html`. «Arma tu bowl» ya no tiene lista en `OPCIONES_PRODUCTO`: `opcionesDe` lee los
  pasos de la descripción del producto con la misma `gruposDe` de la carta (una prueba compara las tres copias de la función).
  `pos-bowls` reescrita sobre la forma y la gramática (10/10). `sobre-almuerzos-y-bowls` al día (5/5 contra Postgres 17 en Docker):
  aborta sin escribir; pegado deja Menú y Seco a 23.000, la promo del domingo a 20.000 y los cuatro bowls con la descripción por
  grupos en `carta_publica`; una cuenta abierta con un Seco pasa de 19.000 a 23.000; pegarlo dos veces no repite bowls; la reversa
  vuelve el Seco a 19.000. Huella del sobre: sha256 `775ccc81ff2a5937784e949f9b6d8a59037f803d193ff2da045c81995612cbf3`. Escapes sin
  cambios (24 en `pos.html`, 4 en `carta.html`). La sesión llegó al umbral de la regla de corte antes de los pasos 0a–0e de «Lo que
  falta»: commit a medias, con `funciones` y `carta-promos` en rojo a sabiendas y los sellos de versión viejos. Nada publicado ni
  aplicado en producción.
