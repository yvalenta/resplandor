---
estado: en-curso
dueño: ambos
fecha: 2026-11-10
tema: los almuerzos pasan a 20.000 (salen los precios de 23.000 y 19.000) y entran cuatro bowls a 15.000 con guarapo, «Arma tu bowl» con sus cuatro pasos en el POS y por grupos en la carta
criterio_cierre: el select de confirmación del sobre en producción devuelve Menú Resplandor y Seco a 20000 y los 4 bowls a 15000 con «Incluye guarapo», la carta al aire los muestra, y una tablet recargada agrega «Arma tu bowl» preguntando base, proteína, vegetales y guarnición
---

Pedido de Yonatan del 2026-11-10, en la sesión: «almuerzos 20000, los precios de 19000 y 23000 ya no estarán; debemos actualizar la
carta y el pos; bowls a 15000» con cuatro bowls (criollo, mixto, Resplandor y «Arma tu bowl»: elige base, proteína, vegetales y
guarnición), después «todos nuestros bowls vienen con guarapo» y, viendo la carta, «distribuye el texto visualmente para distinguir
entre categoría base, vegetales y demás».

## Lo que hay que saber (para una sesión fría)

- Los precios y los platos NO viven en el código: viven en `productos` de Supabase (proyecto `lccgehvyymladqvumcez`). La carta, la
  landing y los agentes leen la vista `carta_publica`, y el POS lee la tabla. Lo de producción lo carga
  `docs/sobres/2026-11-10-almuerzos-y-bowls.sql`, que pega Yonatan (el conector de Supabase de las sesiones entra con la cuenta vieja).
- El sobre: Menú Resplandor y Seco (Ejecutivos) a 20.000; Sopa y carne, Sopa, Carne y Sancocho no cambian. Los bowls van en una
  categoría propia «Bowls» (no en Ejecutivos, así no cuentan para el «3er almuerzo» del lunes), con ids fijos `bowl_criollo`,
  `bowl_mixto`, `bowl_resplandor` y `bowl_arma` (el POS cuelga las opciones del id), etiqueta «Incluye guarapo», `activo` y `en_carta`.
  Aborta sin escribir si falta o se repite un almuerzo, o si ya hay un bowl con otro id. Trae su reversa y su select de confirmación.
- **Pegarlo con el local cerrado**: `productos_tocan_cuentas` le cambia el precio a toda cuenta ABIERTA en el momento.
- Orden de salida: (1) push a `main`; (2) recargar las tablets y comprobar la versión en el pie; (3) el sobre; (4) su select. Una
  tablet con el POS viejo agregaría «Arma tu bowl» sin preguntar nada.
- POS (`pos.html`): `OPCIONES_PRODUCTO.bowl_arma` (Base: arroz, pasta, frijol, mix de lechugas · Proteína: pollo desmechado, pollo
  agridulce, carne desmechada, carne molida, atún, huevo cocido · Vegetales: pico de gallo, tomate y zanahoria, pepino y zucchini ·
  Guarnición: plátano maduro, chips de plátano, yuca frita, papa cocinada), una opción por paso. «tomate zanahoria» y «pepino
  zuccini» del pedido se leyeron como dos parejas, no como cuatro vegetales sueltos: confirmarlo con Yonatan. Los Bowls van después
  de Ejecutivos en la carta del mesero; la semilla local quedó con los precios nuevos y los bowls; el texto de ejemplo del
  «3er almuerzo» en el formulario de promos ya no nombra los precios viejos.
- Carta (`carta.html`): sección Bowls después de Ejecutivos (ícono `soup`), el menú del día con 20.000 por defecto, y la
  descripción de «Arma tu bowl» por grupos (ver «Descripción por grupos» en `docs/landing-y-agentes.md`). La landing (`#carta`) también.
  La instantánea `assets/js/carta-respaldo.js` lleva los precios nuevos y los bowls (34 filas; la `FECHA` sigue en el 3-sep).

## Lo que falta (para la sesión fresca: `cd ~/Developer/worktrees/resplandor--precios-bowls && claude` → `/casa almuerzos-y-bowls`)

1. Arreglar `scripts/pruebas/carta-promos.test.mjs`: 5 pruebas (desde la línea 111) esperan las secciones y platos de la instantánea
   sin la sección `bowls` (ver la bitácora). Ponerlas al día con la instantánea de 34 filas sin aflojar lo que miden, y correr la suite
   completa en segundo plano con tope 7200000 ms (`TZ=UTC node --test --test-concurrency=2 --test-force-exit scripts/pruebas/*.test.mjs`),
   anotando `# tests / # pass / # fail`.
2. Con el visto de Yonatan: `git push origin tarea/precios-bowls:main` (`main` suele estar tomada por otro worktree; si hay que fusionar,
   el único conflicto esperable es el sello: se resuelve con `node scripts/version.mjs`).
3. Yonatan recarga las tablets y comprueba que el pie muestra la versión de `version.json`.
4. Yonatan pega el sobre con el local cerrado (`LC_ALL=en_US.UTF-8 cat docs/sobres/2026-11-10-almuerzos-y-bowls.sql | LC_ALL=en_US.UTF-8 pbcopy`,
   y `pbpaste | shasum -a 256` igual a la huella de la bitácora) y corre el select del final del sobre; se anota lo que devuelve.
5. Confirmar con Yonatan los vegetales de «Arma tu bowl» como tres parejas (pico de gallo · tomate y zanahoria · pepino y zucchini).

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
