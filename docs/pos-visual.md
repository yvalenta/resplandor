# POS: rediseño visual con la identidad v2 de la landing (especificación)

Estado: **vigente desde el 2026-09-30.** Tarea `tareas/2026-09-30-pos-visual.md`, rama `tarea/pos-visual`.
Pedido de Yonatan: «el POS debe mejorarse visualmente de acuerdo al nuevo aspecto de https://resplandor.ynt.codes/».

- **Enmienda «Móvil primero» (§0, 2026-09-30):** el teléfono del mesero es el objetivo principal y §0 manda sobre el resto. La base (`b242a2b`) y la base móvil (§0.12, hecha) ya están; siguen las cuatro partes.
- **Solo visual.** El POS se usa todos los días en el restaurante. No cambia ni una regla de negocio, ni una llamada a Supabase, ni un binding de Alpine, ni un texto funcional (§5).
- **Fuentes de verdad:**
  - Tokens: `assets/css/base.css`.
  - Contrato visual: `docs/identidad-visual.md`.
  - Componentes de referencia: `componentes.css`, `landing.css` y `carta-menu.css`.
- **Lo que este documento agrega:** cómo se adapta todo eso a una herramienta táctil, qué se mapea a qué, y cómo se reparte el trabajo.
- **Cambia una decisión escrita.** `docs/landing-y-agentes.md:154` decía «El POS (`pos.html`) conserva los suyos (su propia paleta y fuentes)». Desde hoy el POS usa la paleta y las fuentes de la v2. El POS sigue sin cargar `resplandor.css`: copia los tokens en su propio `<style>` y conserva su Tailwind CDN.
- **Línea base medida en `4da9030`:**
  - Suite: 501/501.
  - Arnés: 48 capturas «antes» en `$S/antes/`, sin errores.
  - `$S` = `/private/tmp/claude-501/-Users-yonatan-Developer-resplandor-resplandor/f7613393-1e50-4e77-b177-3904ded28708/scratchpad/pos-visual`.

---

## 0. Móvil primero (pedido de Yonatan, 2026-09-30)

Pedido: «debe estar optimizado PRINCIPALMENTE PARA MÓVILES». Los meseros usan el POS en el celular.

**Esta sección manda.** Donde §1–§6 choquen con ella, gana §0; los apartados que chocaban ya están enmendados y apuntan acá. Sigue valiendo todo §5: solo visual y maquetación, el mismo marcado, ningún `<script>` tocado.

Las líneas `pos.html:N` de esta sección son de `b242a2b`.

### 0.1 Prioridad, rangos y qué se arregla

| Rango | Dispositivo | Peso | CSS | Tailwind |
|---|---|---|---|---|
| 360–767 px | teléfono vertical (objetivo 360–430) | **primario: toda decisión se toma acá** | `@media screen and (max-width: 767.98px)` | sin prefijo, o `max-md:` |
| 768–1023 px | tablet vertical | secundario: que se vea bien | `@media screen and (min-width: 768px) and (max-width: 1023.98px)` | `md:`, `md:max-lg:` |
| ≥ 1024 px | tablet horizontal y escritorio (1440) | secundario | `@media (min-width: 1024px)` | `lg:` |

- **Referencias:** 360×780 y 390×844 (primarias); 768×1024 y 1440×900 (secundarias).
- **Distancia de lectura:** el celular se lee a 30–40 cm, no a 60–70 cm como la tablet de §1.2. La letra baja un escalón (§0.3); los 44 px táctiles no bajan.
- **Qué se vio en la base a 390 px** (`$S/base/movil/`) y dónde se arregla:

| Problema (captura) | Arreglo |
|---|---|
| Mesas a 2 columnas con tarjetas de ~170 px: las 10 mesas miden cinco filas y obligan a bajar (`mesas-estados-390`) | 3 columnas, tarjeta de 100 px (§0.5) |
| «Ventas del día» parte el monto en dos líneas | tira de indicadores `1fr 1fr 1.4fr` (§0.5) |
| Nav arriba con scroll horizontal: «Menú semanal» queda fuera | barra inferior fija con los 4 destinos (§0.4) |
| Orden: la carta va primero; pedido, total y «Generar ticket y cobrar» quedan al fondo de 1.720 px (`orden-390`) | pedido primero y barra de cobro fija (§0.6) |
| Nombres truncados en el pedido: «Ejecutivo …», «Empanad…» | nombres en 2 líneas (§0.6) |
| Cinco botones en tres filas, con dos corales (Facturar y Generar ticket) | «Facturar» se ocultó bajo 1024 y el 2026-10-01 se quitó del todo (§7.2); el resto va en filas que parten (§0.6) |

### 0.2 Reglas de maquetación móvil (se suman a §5)

1. **El mismo marcado, con CSS por breakpoint.** No se duplica ningún elemento para una «versión móvil»: un botón duplicado duplica su nombre accesible, y el arnés busca por nombre exacto. Lo que pediría JS (un conmutador Carta/Pedido) queda como propuesta (§0.16).
2. **Lo que fija o reordena va en CSS con `screen`:** `fixed`, `sticky`, `order` y el padding de reserva van en `@media screen and (max-width: 767.98px)` (o `1023.98px`), en el bloque CSS de la parte.
   - El ticket térmico se imprime a 302 px. Caería en cualquier `max-width: 767px` sin `screen`, y las utilidades sin prefijo de Tailwind también aplican al imprimir.
   - Columnas, gaps y tamaños sí pueden ir en utilidades mobile-first (`grid-cols-3 md:grid-cols-5`).
3. **Cascada (§3).** Una utilidad del marcado gana a una clase de igual especificidad.
   - Una regla móvil que pelea con una utilidad va con ≥ (0,2,0) (`.nav-bar .nav-destinos`), o la utilidad pasa a prefijo (`p-5` → `lg:p-5`, `flex-wrap` → `md:flex-wrap`).
   - Al revés: un elemento cuyo `display` lo fija una regla de (0,2,0) no se oculta con `hidden`. Por ejemplo `.nav-bar .brand-word` (`pos.html:959-962`) se oculta desde el bloque CSS de su parte.
4. **Barras fijas:**
   - Ningún ancestro lleva `transform`, `filter`, `perspective`, `contain` ni `will-change`, porque crean bloque contenedor y la barra deja de estar fija a la ventana. Tampoco se agrega `opacity` ni `transform` a las `<section>`.
   - La entrada de vista (`.fade-enter`, opacidad de 120 ms) ya crea un contexto de apilamiento mientras dura. En esos 120 ms la nav inferior puede verse encima de la barra de cobro. Se acepta.
   - `env(safe-area-inset-*)` siempre con respaldo `0px`. La página ya declara `viewport-fit=cover` (`pos.html:6`).
   - **Nunca `overflow-anchor: none`.** El anclaje de scroll es lo que evita el salto en la orden (§0.6).
   - **Viewport con `minimum-scale=1.0`** (medido, lo puso la base móvil en `pos.html:9`). Sin él, un desborde horizontal agranda la ventana de layout del teléfono: el menú semanal a 360 px la vuelve de 408, y todo lo `fixed` (barras, hoja inferior) mide 408 y deja 48 px fuera de pantalla. Con él la ventana se queda en 360. Solo impide alejar el zoom: acercar sigue permitido (WCAG 1.4.4), y nunca va `maximum-scale` ni `user-scalable=no`. No arregla el desborde: el criterio de §0.14.2 sigue siendo 0 desbordes.
5. **Compatibilidad con gama media** (además de §1.2):
   - Sin `color-mix`, `rgb(from …)`, `:has()` ni `text-wrap: balance`.
   - `dvh` siempre detrás de un `vh`.
   - `-webkit-line-clamp` con `display: -webkit-box`, y `appearance: none` con su `-webkit-`.
   - `inset`, `gap` en flex y `aspect-ratio` sí se usan: piden Safari 15 y Chrome 88.
6. **Campos a 16 px.** `.field` ya mide 1rem.
   - Ningún `input`, `select` ni `textarea` lleva `text-sm` o `text-xs`: por debajo de 16 px, iOS hace zoom.
   - Se permiten los atributos HTML `inputmode="numeric"` (precio, «Dividir entre») y `enterkeyhint="search"` (buscador). No son Alpine.
   - El `type` no cambia: el arnés busca `input[type=number]`.
7. **Táctil:**
   - Todo control mide ≥ 44×44 medido sobre el elemento, **sin excepciones** (el checkbox también, §0.6).
   - Lo que se toca rápido (stepper, «+», mesas) lleva `touch-action: manipulation`, para que un doble toque no haga zoom.
   - El hover nunca es la única pista, y todo `:hover` va dentro de `@media (hover: hover)`: en un teléfono el hover queda pegado tras el toque (integración: se envolvieron los de `.btn-*`, `.btn-icon`, `.btn-enlace`, `.menu-item`, `.qty-btn` y `.opt-chip`; el `:active` no cambia).
8. **Márgenes:** 16 px a los lados (`--pos-gutter`), 8–12 px entre tarjetas y 16 px entre bloques.

### 0.3 Escala y espaciado en teléfono

| Elemento | Teléfono | ≥ 768 (§2.2) |
|---|---|---|
| Cuerpo y campos | 16 px | 16 px |
| Secundario (`.text-fine`) y bajada de vista | 14 px | 14 / 16 px |
| Etiqueta, eyebrow, texto de la nav inferior | 12 px (el mínimo) | 12 px |
| Título de vista (Cinzel) | 22 px (1.375rem) | clamp de 24 a 32 px |
| Título de panel y día | 16 px | 18 px |
| Título de diálogo | 18 px | 20 px |
| Nombre de producto | 16 px/1.3, hasta 2 líneas | igual |
| Precio en lista | 15 px, 600 | 16 px |
| Total en la barra de cobro | 22 px, 700 | 32 px (panel) |
| KPI | 20 px en la tira de mesas, 28 px el principal del cierre | 32–36 px |
| Número de mesa | 32 px | 44 px |
| Botón / `.btn-sm` | 16 / 15 px | igual |

- **Vista** (`.vista`, §0.12): padding de 16 px arriba y a los lados y 24 px abajo; desde 768, 24/24/32.
- **Cabecera de vista:** `mb-4`.
- **Tarjetas:** `p-4`, con 8 px entre ellas (mesas) o 12 px (el resto).

### 0.4 Navegación (parte marco-salon-ticket; `pos.html:3262-3340`)

**Teléfono.**
- **La barra superior se reduce y deja de ser sticky** (`.nav-bar { position: static }` en teléfono). La navegación vive abajo, y así arriba no quedan 68 px fijos.
  - Mide 56 px más la franja de 12 px. Lleva `padding-top: env(safe-area-inset-top)` y laterales `max(16px, env(safe-area-inset-left/right))`.
  - **Izquierda:** el monograma `img/logo-r.webp` de 32 px, con `alt=""`.
    - La palabra «Resplandor» se oculta en teléfono (en el bloque CSS, §0.2.3) y vuelve desde 640 px.
    - Con la palabra no caben el aviso de sincronización y el usuario a 360: ≈ 165 + 264 px en 328.
  - **Derecha:** el punto de conexión (sin texto, como hoy), el aviso «N sin sincronizar», el avatar de 28 px y Salir (`.btn-icon` de 44).
    - El aviso va con su texto visible y en `.nav-pill-aviso` maíz (§3.8). Hoy el texto es `hidden sm:inline` (`pos.html:3292`).
    - «Hoy $» sigue oculto: el dato está en la tira de Mesas.
  - Se quita `animate-ping` (`pos.html:3273`): nada infinito (§1.2).
- **Barra inferior fija con los mismos cuatro `button.nav-link`** (`pos.html:3317-3338`). Su contenedor recibe `.barra-inferior` (compartida, §0.12) y la clase local `.nav-destinos`.
  - **La barra:** `display: grid; grid-template-columns: repeat(4, 1fr)`, fondo `telon` y `border-top: 1px solid var(--pos-borde-telon)`. El alto (`min-height: calc(var(--pos-nav-inf) + var(--pos-safe-b))`: 3.75rem más la zona segura), la fijación y el relleno de la zona segura ya los da `.barra-inferior` (compartida, §0.12): la parte no los repite.
  - **Cada link:**
    - Columna con el ícono de 22 px arriba y el texto abajo, `gap: .1875rem`, `padding: .375rem .125rem`.
    - Archivo 600 .75rem/1.15, `text-align: center`, color `ceniza` (7,15).
    - `white-space: normal`: si la fuente de respaldo es más ancha, el texto parte en 2 líneas sin desbordar.
  - **Activo** (`.active`, que pone el `:class` existente): texto e ícono `arroz` (16,72) y filete superior de 3 px `letrero` (`box-shadow: inset 0 3px 0 var(--color-letrero)`). Es el espejo del filete inferior de la barra de arriba.
  - **Medido a 12 px:** «Cierre del día» ocupa 72 px y «Menú semanal» 80 px, en celdas de 90 px a 360. Caben en una línea sin tocar el texto (el arnés hace clic por «Cierre del día»).
  - **Íconos:** pierden su `style="width:15px;height:15px"` (un `style` en línea gana a la regla) y se dimensionan en el bloque: 22 px en teléfono y 18 px desde 768.
  - En la orden, la barra de cobro (z 45) tapa esta barra (z 40), porque la orden es una vista de detalle con su botón volver (§0.6).

**Tablet y escritorio.**
- **768–1023:** vuelve arriba, sticky y en **dos filas**, como ya decía §3.11. La fila 1 lleva marca y estado; la fila 2, los cuatro links en `grid-cols-4`. El alto queda fijo en `--pos-nav-alto` = 7.25rem (3.5 + 3 + .75 de franja).
- **≥ 1024:** una fila, si cabe sin recorte medido (§3.11). `--pos-nav-alto` = 4.25rem.
- La parte 1 hace que el alto real del nav coincida con `--pos-nav-alto` en cada rango: lo usan los sticky de la orden.

### 0.5 Mesas (parte marco-salon-ticket; `pos.html:3345-3422`)

- **Objetivo: ver las 10 mesas y la tira de indicadores a 360×780 sin scroll.** Presupuesto: barra 68 + 16 + cabecera ≈ 85 + rejilla 424. Las mesas terminan en ≈ 595 px, la tira en ≈ 685 y la barra inferior empieza en 720.
- **Cabecera:** eyebrow, título de 22 px y bajada de 14 px en una línea (mide 296 px en 328).
  - La leyenda Libre/Ocupada se oculta en teléfono (`hidden sm:flex`, `pos.html:3356`): cada tarjeta ya dice su estado.
- **Rejilla** (`pos.html:3369`): `grid-cols-3 md:grid-cols-5`, con `gap-2 sm:gap-3 md:gap-4`.
- **Tarjeta compacta en teléfono.** Va en el bloque de la parte, sobre `.mesa-card`, que no cambia de nombre:
  - `aspect-ratio: auto; min-height: 6.25rem; padding: .375rem .25rem`. Mide 104×100 a 360. La ocupada suma ≈ 97 px de contenido y cabe sin estirar su fila.
  - `.mesa-num` a 2rem. Reemplaza la regla de 2.25rem a ≤ 640 (`pos.html:1290-1294`).
  - `.mesa-badge` con `margin-top: .25rem; padding: .125rem .5rem`. Sigue en 12 px y diciendo «Libre» u «Ocupada».
  - `.mesa-total` en .9375rem 600 con `margin-top: .125rem`. `.seat-dot` de 5 px; `.seat-dots` con `gap: 3px; margin-top: .25rem`.
  - `.mesa-presence` de 1.5rem, a `.375rem` de la esquina, para no pisar un «10».
  - La ocupada conserva el telón, el filete letrero de 4 px y el número letrero (§3.3).
- **Indicadores del día compactos** (`pos.html:3408`):
  - Una sola tira `.card` con tres celdas sin borde propio, separadas por un filete `linea`.
  - Columnas `1fr 1fr 1.4fr`, para que quepa «$ 1.330.000» (111 px a 20 px, en ≈ 119).
  - `.stat-label` de 12 px en dos líneas; `.stat-value` de 1.25rem con `nowrap`.
  - La regla compartida `.stat-card` no se edita: se pisa con un selector local de (0,2,0) (`.stats-mesas .stat-card`).
  - Desde 768 vuelven las tres tarjetas de hoy.
- **768 y 1440:** 5 columnas y tarjeta cuadrada (§3.3).

### 0.6 Orden (parte orden; `pos.html:3429-3667`)

**Hasta 1023 px la orden usa el esquema de teléfono, en una columna.** Desde 1024, las dos columnas de §3.13. Así la tablet vertical tampoco aprieta el pedido en media pantalla.

**Cabecera** (`pos.html:3432-3460`). Una sola fila: `[← 44] [«Mesa 3» de 22 px / «Abierta 12:42 p. m.»] [Ítem manual]`.
- «Ítem manual» va en `.btn-secondary.btn-sm` a la derecha. Su contenedor deja el `w-full` (`pos.html:3446`).
- ~~**«Facturar» se oculta por debajo de 1024**~~ **Retirado el 2026-10-01 (§7.2):** el botón de la cabecera ya no existe en ningún ancho; cobra el de la barra de cobro, que siempre está a la vista.
- El eyebrow «Cuenta abierta» se oculta en teléfono (`hidden sm:block`). «Abierta 12:42» ya lo dice, y con su tracking de .24em no cabe junto a «Ítem manual» (≈ 165 px en ≈ 125).

**Acciones secundarias** (`pos.html:3462-3492`): Cobrar por partes, Imprimir precuenta (antes «Imprimir cuenta», §7.2), Enlace NFC y Liberar mesa.
- Van en `.fila-acciones` (compartida, §0.12): parten en líneas y cada botón crece para repartirse el ancho; botones `.btn-secondary.btn-sm` de 44 px.
- **Corregido en la revisión móvil (§0.17):** la primera versión era una fila con scroll horizontal (`.fila-scroll`). A 360 «Enlace NFC» y «Liberar mesa» quedaban fuera de la pantalla sin pista, y con el pedido vacío «Liberar mesa» (la única salida de una mesa abierta por error) era el cuarto botón. Ahora no queda ningún botón fuera, y «Liberar mesa» (`.btn-peligro`, solo con el pedido vacío) va primero (`order: -1`).
- Mide dos líneas a 360 a 430 (tres a 320): cuesta 52 px más que la fila con scroll.
- Las utilidades de flujo del contenedor pasan a `md:`. Desde 768 hace `flex-wrap`, como hoy.
- No van en un `<details>` «Más»: envolver esos botones, que tienen todos binding, les cambiaría el padre (§5.2).

**NFC, «N ítem(s) seleccionado(s)», reparto por persona y avisos.** Una columna, a lo ancho.
- La barra de cobro por partes (`pos.html:3509`) va `position: sticky; top: var(--pos-nav-alto); z-index: 3` por debajo de 1024. Así no se pierde mientras se marcan ítems.
- En ese modo queda encima del buscador, que es z 2. No importa: en ese modo no se agregan productos.

**Rejilla** (`pos.html:3566`): `grid-cols-1 lg:grid-cols-5`.
- Bajo 1024, la columna del pedido (`pos.html:3606`) va **primero**, con `order: -1` en CSS (`screen`, §0.2.2).
- Desde `lg` vuelve a su lugar.

**Pedido** (`.card` a sangre en teléfono, `.a-sangre`).
- **Vacío:** el estado «Agrega productos del menú» baja de `py-10` a `py-4`.
- **`.order-item` en grilla, en todos los anchos.** La columna de escritorio mide ~440 px, el mismo apretón.
  ```
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: "chk info importe" "chk info qty";
  ```
  - El nombre va en 2 líneas: `.menu-item-name` sin `truncate` (`pos.html:3631`) y con `-webkit-line-clamp: 2`.
  - Debajo, la nota (`.nota-item`) y «$ 21.000 · Asignar a persona» en una línea.
  - A la derecha, el importe arriba y el stepper de 44 abajo.
  - El nombre tiene ≈ 188 px a 360. Cabe «Ejecutivo de la casa» (142 px).
  - «Asignar a persona» (`.btn-enlace`, 44 de alto) lleva `margin-block: -.625rem`: el área táctil sigue en 44 y la fila no crece.
- **Checkbox de cobro por partes:**
  - El propio `<input>` mide 44×44 (`appearance: none`) y dibuja su casilla de 24 px con dos fondos `linear-gradient`: borde `apoyo` (6,79) y, marcado, `telon` con un check `arroz` en data-URI. El `:focus-visible` es el de §3.1.
  - Se quita su `style=` (`pos.html:3629`).
  - Corrige §3.13, que lo envolvía en un `<label>`: eso le cambiaba el padre (§5.2).

**Carta** (`.card` a sangre en teléfono), debajo del pedido.
- El panel pierde `overflow-hidden` bajo 1024 (`lg:overflow-hidden`, `pos.html:3569`): un ancestro con overflow anula el sticky.
- **Buscador fijo:** su contenedor (`pos.html:3571`) va `position: sticky; top: var(--pos-nav-alto); z-index: 2`, con fondo `papel`, borde inferior `linea` y el radio de arriba de la tarjeta. El campo es de 16 px.
- **Sin scroll interno bajo 1024.** Una lista con scroll dentro de la página es una trampa para el pulgar.
  - El `style="max-height: calc(100dvh - 240px)"` (`pos.html:3581`) sale del marcado.
  - Su lugar es `.menu-scroll`, activa solo desde `lg`, con `calc(100vh - var(--pos-nav-alto) - …)` y la variante `dvh` detrás.
- `.menu-category-title` es estático bajo 1024 (dos sticky apilados comen alto) y sticky dentro de `.menu-scroll` desde `lg`.
- **`.menu-item`:** nombre en 2 líneas, descripción en 1 (`truncate`), precio de 15 px y «+» de 44. El nombre tiene ≈ 195 px a 360.

**Barra de cobro fija.** El bloque «Total & actions» (`pos.html:3651-3664`) recibe `.barra-accion` (compartida, §0.12).
- **Bajo 1024:** fija abajo, en `papel`, con borde superior `linea`, sombra hacia arriba y `env(safe-area-inset-bottom)`.
- **A la izquierda:** «Total» (`.text-label`) sobre el monto `.total-grande` a 22 px.
- **A la derecha:** «Generar ticket y cobrar» en `.btn-primary`, con `flex: 1` y `white-space: normal`.
  - En teléfono el botón va sin ícono: el texto mide 166 px y con el relleno 198.
  - A 360, un monto de hasta «$ 999.999» (102 px) cabe en una línea. «$ 1.250.000» (122 px) parte el botón en dos líneas en vez de desbordar.
  - A 390 caben los dos en una línea.
- **Marcado:**
  - La tarjeta pierde `p-5` (pasa a `lg:p-5`).
  - El contenedor del total pasa a `flex-col` bajo `lg`.
  - El botón deja `w-full` (pasa a `lg:w-full`).
- **Tapa la barra de navegación** (z 45 sobre 40) mientras la orden está abierta: es la pantalla de detalle de una mesa, con su botón volver. Si Yonatan la prefiere encima de la nav, basta `bottom: calc(var(--pos-nav-inf) + var(--pos-safe-b))`, que cuesta 60 px de pantalla.
- **En 768–1023:** el botón, con ícono, mide hasta 22rem y la barra reparte con `space-between`.

**El salto al agregar.** Con el pedido arriba, cada producto nuevo agrega una fila encima de la carta.
- Chrome Android ancla el scroll (CSS Scroll Anchoring): la fila tocada no se mueve (medido: 0 px).
- **Safari de iPhone NO ancla el scroll, y se midió en el simulador de iOS 26** (`CSS.supports('overflow-anchor','none')` da `false`): agregar un renglón de 94 px movió 111 px el producto tocado, y el segundo toque caía en otro producto.
- **Resuelto en la revisión móvil (§0.17):** el `order: -1` de `.col-pedido` va dentro de `@supports (overflow-anchor: none)`. Donde el navegador ancla (Chrome, Edge, Samsung Internet, Firefox), el pedido va primero como antes; en iOS, la carta va primero y el pedido al final. El total y «Generar ticket y cobrar» siguen fijos abajo en los dos. En iOS, revisar o corregir el pedido pide bajar hasta el final de la carta: el conmutador Carta/Pedido de §0.16 (JS, otra fase) lo arregla del todo.

**≥ 1024:** §3.13 tal cual: columnas 3/2, el pedido sticky bajo el nav (`top: var(--pos-nav-alto)`) y el total en su tarjeta.

### 0.7 Ticket (parte marco-salon-ticket; `pos.html:3674-3791`)

- **Una columna:** la hoja `.ticket` a lo ancho (328 px a 360), con `padding: 1.5rem 1.25rem` y la marca a 1.375rem.
- **Acciones** (`pos.html:3776`): `flex flex-wrap gap-3`, sin el `max-width` en línea.
  - «Imprimir» (`.btn-primary`) a lo ancho (`basis-full`); debajo, «Reabrir» y «Volver» mitad y mitad.
  - Si «Reabrir» no se muestra (`x-show`), «Volver» ocupa la fila.
  - Desde 640, los tres en fila, como hoy.
- **El impreso no cambia.** `ticket-impreso` a 302 px es la prueba de que ninguna regla móvil se coló al papel (§0.2.2).

### 0.8 Cierre (parte cierre-y-menu; `pos.html:3798-3990`)

- **Una columna.** «Imprimir resumen» va en `.btn-secondary.btn-sm` bajo el título, no al lado: título y botón suman ≈ 190 + 171 px.
- **Bento:** el KPI principal a lo ancho (28 px); «Órdenes» y «Ticket prom.» mitad y mitad (22 px).
- **Las filas-tabla pasan a lista de dos líneas.** No hay `<table>`: son `.history-row` con columnas a la derecha.
  - **Transacción** (`pos.html:3862-3890`):
    - Sin `.icon-badge` en teléfono (`hidden sm:inline-flex`).
    - Línea 1: «Mesa 3 · Facturada» … «$ 98.000 ˅». Línea 2: el horario … «Editar».
    - El contenedor derecho (`pos.html:3877`) es una grilla local `"monto chev" "editar editar"`.
    - «Mesa N» y los montos van en Archivo (§4.4).
  - **Historial:**
    - Fecha y chip (el chip baja si no cabe); debajo, «hora · N órdenes»; a la derecha, monto y chevron.
    - Filas internas: «› Mesa 4» y la hora en dos líneas; monto `.importe` sin `min-width`; Editar y Eliminar en `.btn-icon` de 44.
    - El detalle de ítems lleva `pl-4`, no `pl-9`.
- **«Cerrar día»** en `.btn-primary` (52 px; ya **no** `btn-lg`, §7.6), a lo ancho en teléfono y a la derecha desde 640, dentro del flujo y **no fijo**: se usa una vez al día y no conviene tenerlo bajo el pulgar. **No hay cierre sin red (ronda 5):** sin conexión, o con cambios sin subir, el botón queda apagado (`:disabled`, sin `opacity`) y debajo, en un `.aviso` (`#cierre-razon`, `role="status"`, el botón lo apunta con `aria-describedby`), dice por qué: «Sin conexión: cerrar el día necesita la base…» o «Hay N cambios sin subir: espera a que suban.»; con red y algo sin subir añade el enlace «Reintentar subir» (`.btn-enlace`, 44 px). Capturas: `cierre-sin-red-390/1440.png`, `cierre-pendientes-390/1440.png`.

### 0.9 Menú semanal (parte cierre-y-menu; `pos.html:3996-4107`)

- **Cabecera:** los dos botones (`pos.html:4006` y `4010`) en `grid grid-cols-2 gap-2` a lo ancho.
  - Son `.btn-sm` con `whitespace-normal`: «Copiar link de votación» mide 207 px y parte en dos líneas dentro de 160.
  - Desde 640, en fila.
- **Semana:** `[‹ 44] etiqueta [› 44]`.
  - La etiqueta va `flex-1`, centrada, en Archivo .9375rem 600 y con hasta 2 líneas.
  - Sale el `min-width:170px` (`pos.html:4022`).
- **Opciones:** cada una ya es columna en teléfono (`flex-col md:flex-row`).
  - En la línea final, los votos a la izquierda y Editar · Ocultar · Eliminar (`.btn-enlace`) a la derecha.
  - Los días (`h2`) van a 16 px.
- **Sugerencias:** lista de una columna.

### 0.10 Productos (parte productos-y-modales; `pos.html:4114-4160`)

- **Cabecera en columna.** «Nuevo producto» (`.btn-primary`) va a lo ancho en teléfono (`w-full sm:w-auto`).
- **Las tarjetas pasan a filas de lista** en teléfono:
  - El contenedor `.card` (`pos.html:4128`) va `p-0 sm:p-6`.
  - Cada categoría lleva su `.titulo-panel` en `px-4 pt-4 pb-2`.
  - Cada producto (`pos.html:4134`) es una fila `px-4 py-3` con filete superior `linea`, sin borde, radio ni sombra propios. Usa la clase local `.producto-fila`, con (0,2,0) sobre `.card`.
  - Grilla `"nombre precio" "desc acciones"`: la descripción en 2 líneas (`-webkit-line-clamp`) y Editar y Eliminar (`.btn-sm`) a la derecha.
  - Queda en ≈ 93 px por producto, en lugar de ~160.
- **Desde 768:** tarjetas en 2 columnas, como hoy. A 1440, 3.

### 0.11 Modales: hoja inferior (CSS de la base móvil; el marcado de los 8 es de productos-y-modales)

- **Teléfono (< 768, `screen`): hoja inferior.** Hoy es así hasta 640 px (`pos.html:1734-1781`); el umbral sube a 767.98 px, con `screen`.
  - `.modal-backdrop`: `align-items: flex-end; padding: 0`.
  - `.modal`: ancho completo, radio solo arriba, sin borde inferior, `max-height: 92vh; max-height: 92dvh` y `overscroll-behavior: contain` (el scroll de la hoja no arrastra la página).
  - `.modal-header`: `padding: 1rem 1rem .5rem`, con el título a 18 px. `.modal-body`: `padding: .5rem 1rem 1rem`.
  - `.modal-footer`: sticky abajo, con `padding-bottom: calc(.75rem + var(--pos-safe-b))` y los botones con `flex: 1`. El padding de la zona segura pasa de la hoja al pie: así el papel del pie cubre la zona del indicador de inicio.
  - **Sin asa.** Una barrita arriba promete arrastrar para cerrar, y sin JS no arrastra. Se cierra como hoy: con la ✕ (44), con Cancelar o con Escape. Tocar el velo no la cierra: el velo no tiene `@click`, y agregárselo sería lógica.
  - Sin animación de entrada: solo la opacidad de 120 ms (§1.2).
- **≥ 768:** centrada, con `max-width: 28rem` (§3.7).
- **Por modal (parte 4):**
  - Las rejillas `grid-cols-2` del modal de menú se quedan: 158 px por campo a 360.
  - El `grid-cols-4` de reabrir se queda: 74 px por mesa.
  - «Dividir entre» va en `.field.field-num` con `inputmode="numeric"`, y la fila de reparto hace `flex-wrap`.

### 0.12 Fase BASE MÓVIL: CSS compartido nuevo (una sola parte, antes de las cuatro)

Corre en `tarea/pos-visual`, sobre `b242a2b`, antes de abrir las cuatro partes. **Hecha** (commit «pos-visual: móvil primero — enmienda de la spec y base compartida»). Toca solo las secciones 1, 5, 7 y 8 del `<style>`, el arnés, la prueba y este documento. No toca ningún bloque de parte, ningún marcado y ningún `<script>`. Lo que cambió al implementarla respecto de lo que decía este documento va marcado con «(medido)» abajo.

1. **En `:root`, derivados móviles.** No son tokens: van junto a los `--pos-*`.
   ```css
   --pos-gutter: 1rem;                        /* margen lateral en teléfono */
   --pos-nav-inf: 3.75rem;                    /* barra inferior de navegación, sin la zona segura */
   --pos-accion-inf: 4.25rem;                 /* barra de cobro: botón 3.25rem + 2 × .5rem */
   --pos-safe-b: env(safe-area-inset-bottom, 0px);
   --pos-nav-alto: 0px;                       /* alto del nav sticky: 0 en teléfono (ahí no es sticky) */
   ```
   Más `@media (min-width: 768px) { :root { --pos-nav-alto: 7.25rem; } }` y `@media (min-width: 1024px) { :root { --pos-nav-alto: 4.25rem; } }`.
2. **Sección 5, componentes compartidos nuevos.** `.barra-accion` va **después** de `.card`, para ganarle en borde, radio y sombra con igual especificidad.
   ```css
   /* Contenedor de vista: reemplaza «mx-auto px-4 py-8/py-6» de cada <section> (cada parte cambia su string). */
   .vista { margin-inline: auto; padding: 1rem var(--pos-gutter) 1.5rem; }
   @media (min-width: 768px) { .vista { padding: 1.5rem 1.5rem 2rem; } }
   /* (medido) En papel vale lo que valían «px-4 py-8»: el cierre y el ticket se imprimen y §0.14.5 exige que
      salgan idénticos. Va dentro del @media print de la sección 7, no en la 5. */
   @media print { .vista { padding: 2rem 1rem; } }

   /* La caja del ícono existe antes de que Lucide cambie <i> por <svg>: sin salto al cargar.
      (medido) Con «inline-block» a secas, un <i> sin tamaño mide 0×0 y su <svg> 24×24: en `cierre` (los 8
      chevrones de «Editar») la página crecía 130 px al pintar los íconos y 18 íconos se movían. Con esta
      pareja de reglas, 0 íconos se mueven en las 15 vistas medidas a 390 y en las 5 de 1440. */
   i[data-lucide] { display: block; flex: none; }        /* display:block = el del <svg> que deja el preflight */
   :where(i[data-lucide]) { width: 1.5rem; height: 1.5rem; }   /* 24 px, el tamaño de Lucide; :where() = especificidad 0,
                                                                  así w-4, h-4 y style="width:…" lo siguen ganando */

   /* Lo que se toca rápido no hace zoom con doble toque ni pinta el resalte gris de WebKit. */
   button, .mesa-card, .menu-item { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }

   /* Barra de acción (total + botón principal): fija abajo hasta 1023 px. La usa la orden (§0.6). */
   @media screen and (max-width: 1023.98px) {
     /* Reserva para la barra fija más alta: nav inferior (< 768) o barra de cobro (< 1024). En tablet,
        las vistas sin barra quedan con 68 px de arroz al final; se acepta a cambio de una sola regla. */
     html { scroll-padding-bottom: calc(var(--pos-accion-inf) + var(--pos-safe-b) + .5rem); }
     body { padding-bottom: calc(var(--pos-accion-inf) + var(--pos-safe-b)); }

     .barra-accion {
       position: fixed; left: 0; right: 0; bottom: 0; z-index: 45;
       display: flex; align-items: center; justify-content: space-between; gap: .75rem;
       min-height: calc(var(--pos-accion-inf) + var(--pos-safe-b));
       padding: .5rem max(var(--pos-gutter), env(safe-area-inset-right, 0px))
                calc(.5rem + var(--pos-safe-b)) max(var(--pos-gutter), env(safe-area-inset-left, 0px));
       background: var(--color-papel); border: 0; border-top: 1px solid var(--color-linea); border-radius: 0;
       box-shadow: 0 -8px 20px -14px rgba(10, 17, 18, .22);   /* el color de --shadow-sombra, hacia arriba */
     }
     .barra-accion .total-grande { font-size: 1.375rem; }
     .barra-accion .btn-primary { flex: 1 1 auto; min-width: 0; white-space: normal; }
   }
   @media screen and (max-width: 767.98px) {
     .barra-accion .btn-primary > svg, .barra-accion .btn-primary > i { display: none; }
   }
   @media screen and (min-width: 768px) and (max-width: 1023.98px) {
     .barra-accion .btn-primary { flex: 0 1 22rem; }
   }
   ```
3. **La sección 8 se reescribe como «Teléfono compartido (< 768, screen)».** Hoy es «≤ 640» (`pos.html:1729-1781`).
   ```css
   @media screen and (max-width: 767.98px) {
     /* Barra inferior fija: la usa la navegación (parte 1). Aquí, la fijación, el alto y la zona segura;
        el fondo, la rejilla y los links son de la parte. */
     .barra-inferior { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
       min-height: calc(var(--pos-nav-inf) + var(--pos-safe-b));        /* (medido) con border-box, el relleno de la zona
                                                                           segura se comería los 60 px útiles de la barra */
       padding: 0 env(safe-area-inset-right, 0px) var(--pos-safe-b) env(safe-area-inset-left, 0px); }

     /* A sangre: una lista densa ocupa todo el ancho del teléfono. */
     .a-sangre { margin-inline: calc(-1 * var(--pos-gutter)); border-radius: 0; border-left-width: 0; border-right-width: 0; }

     /* Fila de acciones con scroll horizontal, a sangre, sin barra visible. */
     .fila-acciones { display: flex; flex-wrap: wrap; gap: .5rem; }          /* (revisión móvil) era .fila-scroll */
     .fila-acciones > * { flex: 1 1 auto; justify-content: center; padding-inline: .625rem; }
     .fila-acciones > .btn-peligro { order: -1; }

     /* Escala (§0.3). */
     .section-head > h1, .section-head > h2, h1.font-display, .titulo-vista, .titulo-orden { font-size: 1.375rem; }
     h2.font-display, .titulo-panel { font-size: 1rem; }
     .modal-header h2 { font-size: 1.125rem; }
     .section-head .eyebrow { margin-bottom: .25rem; }

     /* Hoja inferior (§0.11). */
     .modal-backdrop { align-items: flex-end; padding: 0; }
     .modal { max-width: 100%; border-bottom: 0; border-radius: var(--pos-r-dialogo) var(--pos-r-dialogo) 0 0;
              max-height: 92vh; max-height: 92dvh; overscroll-behavior: contain; }
     .modal-header { padding: 1rem 1rem .5rem; }
     .modal-body { padding: .5rem 1rem 1rem; }
     .modal-footer { position: sticky; bottom: 0; padding: .75rem 1rem calc(.75rem + var(--pos-safe-b)); }
     .modal-footer .btn-primary, .modal-footer .btn-secondary, .modal-footer .btn-teal,
     .modal-footer .btn-telon, .modal-footer .btn-peligro { flex: 1; justify-content: center; }

     .stat-card { padding: .75rem 1rem; }
     .stat-value { font-size: 1.5rem; }
   }
   ```
   - Un elemento que recibe una clase compartida de flujo (`.fila-acciones`, `.barra-accion`) pasa sus utilidades de flujo a `md:` o `lg:` (§0.2.3). Si no, la utilidad le gana.
   - Mapa de capas (z-index):

     | Capa | z-index |
     |---|---|
     | Título de categoría | 1 |
     | Buscador | 2 |
     | Barra de cobro por partes | 3 |
     | Nav sticky (≥ 768) y barra inferior | 40 |
     | Barra de cobro | 45 |
     | Modal | 50 |
     | Login | 100 |
4. **Arnés** (`scripts/capturas-pos.mjs` y `scripts/pruebas/_pos-simulado.mjs`, van al repo). Hecho así:
   - Anchos por defecto **360, 390, 768 y 1440** (antes 768 y 1440), con `ALTOS` 360×780, 390×844, 768×1024 y 1440×900 (más 375, 412 y 430 por si hacen falta).
   - **Bajo 768 px la ventana emula un teléfono**: `nuevoContexto(navegador, { ancho, alto, movil: true })` pone `isMobile`, `hasTouch` y `deviceScaleFactor: 2`. Así el `<meta viewport>` manda, `(pointer: coarse)` y `(hover: none)` valen, y las capturas salen nítidas. `--escala n` la pisa.
   - **Lo impreso no se emula como teléfono** (`def.media === 'print'`): `ticket-impreso` (302) y `cierre-impreso` (794) salen a escala 1 y comparables pixel a pixel con la base.
   - La opción `--ventana` captura solo la ventana en todas las vistas: lo que el mesero ve sin hacer scroll. La captura de página entera deja la barra fija al final de la imagen.
   - La cabecera de uso está al día. En scratch, `$S/harness-pos.mjs` mide también 360×780 y 390×844.
5. **Verificación de la base móvil:** la suite y los tres `--comprobar` en verde, y capturas de las 25 vistas a 360, 390, 768 y 1440 con código 0. Lo esperado:
   - Las hojas inferiores llegan ahora hasta 767 px.
   - Aparece la reserva inferior por debajo de 1024.
   - (medido) La escala de teléfono de §0.3 ya se nota, porque se apoya en clases que el marcado SÍ usa: los títulos de vista bajan de 24 a 22 px, el título de panel a 16, el título de diálogo a 18, el eyebrow pierde .25rem de margen y `.stat-card` pasa a `.75rem 1rem`.
   - Nada más se mueve, porque las clases nuevas (`.vista`, `.barra-inferior`, `.barra-accion`, `.a-sangre`, `.fila-scroll`, hoy `.fila-acciones`) todavía no están en el marcado.
   - (medido) El `<meta viewport>` gana `minimum-scale=1.0` (§0.2.4): es lo único que esta fase toca fuera del `<style>`.
   - Prueba estática (`pos-visual.test.mjs`, 12 casos nuevos de «móvil primero»): vigila las variables, las clases, que lo que fija o reordena vaya con `screen`, el orden de capas (40 < 45 < 50), el alto de las barras con la zona segura, el respaldo de `env()` y de `dvh`, el viewport, que no vuelvan `overflow-anchor`, `:has()` ni `text-wrap`, la hoja inferior de < 768 y los 44 px compartidos. Las cuatro partes no pueden romperla.
   - (medido) **Línea base de desborde y táctil** de esta fase, con `$S/harness-pos-44-base.mjs` (idéntica en `b242a2b` y en la base móvil: nada se movió): 0 desbordes a 768, 1024 y 1440; a 360, `orden-edicion-sin-mesa` (11 px), `menu-semanal` y `modal-menu` (48 px); a 390, `menu-semanal` y `modal-menu` (18 px). Controles menores de 44 px, sumados sobre las 23 escenas del arnés: 131 a 360, 145 a 390 y 148 a 768, 1024 y 1440. Las cuatro partes tienen que dejar todo en 0.
6. **Commit** con rutas explícitas (nada de `git add -A`): `docs/pos-visual.md`, `pos.html` y `scripts/capturas-pos.mjs`. Nunca push.

### 0.13 Alcance móvil por parte (se suma a §4.4 y manda sobre ella)

- **marco-salon-ticket** (login, nav-y-mesas y ticket): §0.4, §0.5 y §0.7, y además:
  - **Login en teléfono:** contenido centrado con `px-6` y `env(safe-area-inset-*)`. El `.rotulo` ya se limita al ancho de la ventana. El botón va a lo ancho, hasta 20rem.
  - Las secciones de mesas (`pos.html:3345`) y ticket (`3674`) pasan a `.vista`.
  - El nav mide exactamente `--pos-nav-alto` en cada rango.
- **orden:** §0.6 entero. La sección (`pos.html:3429`) pasa a `.vista`.
- **cierre-y-menu:** §0.8 y §0.9. Las secciones de `pos.html:3798` y `3996` pasan a `.vista`.
- **productos-y-modales:** §0.10. De §0.11, solo lo que es de marcado en los 8 modales: rejillas, `inputmode` y quitar los `style=`. La hoja inferior es CSS compartido y no la toca. La sección (`pos.html:4114`) pasa a `.vista`.

### 0.14 Capturas y verificación móvil

1. **Capturas obligatorias por vista:** 360 y 390 (primarias), 768 y 1440 (secundarias). La integración agrega 1024.
   ```
   node scripts/capturas-pos.mjs $S/movil-<clave>         --cache $S/_cdn --vistas <lista> --anchos 360,390,768,1440
   node scripts/capturas-pos.mjs $S/movil-<clave>/ventana --cache $S/_cdn --vistas <lista> --anchos 360,390 --ventana
   ```

   | Parte | Vistas |
   |---|---|
   | marco-salon-ticket | `login`, `mesas`, `mesas-estados`, `ticket` y `ticket-precuenta`, más `ticket-impreso` (302) sin cambios |
   | orden | `orden`, `orden-avisos`, `modal-opciones` y `modal-cobro` (estos dos, para ver la barra de cobro debajo del velo) |
   | cierre-y-menu | `cierre`, `cierre-error`, `menu` y `menu-huecos`, más `cierre-impreso` (794) sin cambios |
   | productos-y-modales | `productos` y los 11 `modal-*` |
2. **Táctil y desborde:** `DETALLE_TACTIL=1 node $S/harness-pos.mjs <raíz> <salida> todas 360x780,390x844,768x1024,1440x900`. Tiene que dar 0 desbordes horizontales y 0 controles menores de 44 px, **sin excepciones**.
3. **Salto al agregar** (sondeo en scratch, con Chromium a 390×844), en `orden`:
   - Bajar hasta «Jugo natural» y medir su `getBoundingClientRect().top`.
   - Tocarlo (agrega una fila nueva al pedido) y medir de nuevo: la diferencia tiene que ser ≤ 1 px.
   - Repetir con «Limonada de coco», que solo sube la cantidad.
   - Safari iOS lo prueba Yonatan a mano (§0.16).
4. **A ojo, a 360 y 390:**
   - Las 10 mesas y la tira se ven sin scroll (ventana de 360×780).
   - En la orden, el total y «Generar ticket y cobrar» están siempre a la vista, y el buscador queda pegado arriba al bajar por la carta.
   - Ningún nombre del pedido termina en «…».
   - La barra inferior muestra sus cuatro destinos con el activo marcado.
   - El pie de la hoja inferior queda sobre la zona del indicador de inicio.
   - Ninguna línea de texto queda cortada por el borde.
5. **Impresión:** `ticket-impreso` (302) y `cierre-impreso` (794) quedan idénticas a las de la base. Ninguna regla móvil llega al papel.

### 0.15 Rendimiento móvil (medido; se propone, NO se hace en esta fase)

> **Actualización 2026-10-01 (tarea `pos-sin-cdn`):** los cuatro scripts ya NO salen de un CDN. Son archivos locales de versión
> fija en `assets/vendor/` (Tailwind Play 3.4.17, Alpine 3.17.4, Lucide 1.49.0 con todo el catálogo, supabase-js 2.117.2; origen,
> bytes y sha256 en `assets/vendor/README.md`), los mismos bytes que resolvían las URLs flotantes de la tabla. Con eso se cierra
> el rango sin fijar y la dependencia de la red de terceros (en un teléfono que no alcanzaba un CDN, el POS quedaba sin estilos y
> sin funciones). **No** cambia el peso ni la compilación en el teléfono: los puntos 1 y 2 de la propuesta siguen pendientes. El
> `preconnect` a jsdelivr se quitó (ya no le pide nada). Las líneas de la tabla describen el estado de antes. (La ola C suma un
> quinto archivo local, el generador del QR del ticket `qrcode-generator-1.4.4.js`: es opcional para pintar, 56 KB, `defer`.)

Medido con la caché del arnés (`$S/_cdn`). Tamaño en crudo y, entre paréntesis, con gzip -9.

| Recurso | Tamaño | Carga | Problema en un celular de gama media |
|---|---|---|---|
| Tailwind Play CDN (`cdn.tailwindcss.com`, `pos.html:25`) | 407 KB (123 KB) | síncrono en `<head>`: bloquea el primer pintado | Compila las clases **en el navegador** y deja un MutationObserver que recompila con cada cambio de Alpine (x-for, x-show). No tiene versión fija, y Tailwind lo declara no apto para producción. |
| Lucide `@latest` (`pos.html:31`) | 445 KB (104 KB) | `defer` | Hoy sirve la v1.49.0 con todo el catálogo (`lucide-static` 1.48 trae 2.118 archivos), para 45 íconos usados: 38 en el marcado y 7 de `catIcono`. `@latest` no está fijado: Lucide ya renombró `bar-chart-2` (el de «Cierre del día») a `chart-no-axes-column` y hoy lo sostiene como alias; el día que quite el alias, el ícono desaparece sin aviso. La redirección de unpkg suma un viaje, y los íconos aparecen tarde. |
| supabase-js `@2` (`pos.html:34`) | sin medir (el arnés lo simula) | síncrono | Rango sin fijar. No se puede diferir sin tocar el `<script>`, que crea el cliente al parsear (`pos.html:1940`). |
| Alpine `@3.x.x` (`pos.html:28`) | 56 KB (20 KB) | `defer` | Rango sin fijar. |
| `pos.html` | 218 KB (43 KB) | — | Aceptable. |

**Propuesta para una fase posterior** (cada punto, con su tarea):
1. **Tailwind compilado en el build**, como ya hace la landing (`scripts/css.mjs`, con Tailwind 4.3.3 en devDependencies).
   - Una entrada propia del POS que escanee `pos.html`, una salida estática minificada (estimado: 10–15 KB con gzip) y su `--comprobar` en la suite.
   - Quita 123 KB del camino crítico, la compilación en el teléfono y el destello sin estilos.
   - Riesgo: pasar el `tailwind.config` v3 a `@theme` v4 y auditar las diferencias de v3 a v4 (color de borde por defecto, escalas de `shadow` y `rounded`, `ring`). La alternativa de menor riesgo es el CLI v3.4 con versión fija.
2. **Lucide local, con solo los 45 íconos.**
   - Se generan desde `lucide-static` (ya está en devDependencies; lo usa `scripts/iconos.mjs`) en un archivo chico (~8–10 KB) que expone `window.lucide.createIcons()`.
   - El POS solo llama a esa función (22 veces, más `pintarIconos`), así que los `<script>` no cambian: cambia solo el `src`.
   - Mientras tanto, fijar la versión exacta.
3. **Versiones exactas con SRI** para Alpine y supabase-js.
4. **Medir en un teléfono real** el tiempo hasta que el POS responde, con la red del local (Lighthouse móvil, CPU 4×).

La caja reservada para los íconos (`i[data-lucide]`, §0.12) sí entra ya: es solo CSS.

### 0.16 Decisiones que quedan a la vista de Yonatan

- ~~«Facturar» de la cabecera se oculta por debajo de 1024 px~~ Resuelto en §7.2: el botón se quitó (era el mismo cobro).
- En la orden, la barra de cobro tapa la barra de navegación. La alternativa es ponerla encima, con 60 px menos de pantalla.
- En el teléfono, la barra superior no es sticky y su marca es solo el monograma: la palabra no cabe junto al aviso de sincronización.
- En el teléfono se ocultan la leyenda de mesas y el eyebrow «Cuenta abierta».
- **Ola B (§0.18):**
  - En teléfono el admin tiene 5 destinos con «Más» (Menú semanal y Personal dentro), y la etiqueta «Cierre del día» se acorta a «Cierre». La alternativa, seis destinos, deja 60 px por columna.
  - Las alertas son un destino de la barra inferior y no solo una campana, porque la barra de arriba no es fija en teléfono.
  - El mesero **no** reabre, edita ni elimina cuentas cerradas, tampoco las del turno (contrato: `editar_cerradas` es solo del admin). El SDD v0.3 §02.2 le dejaba reabrir una orden del turno: si Yonatan lo prefiere, se afloja el `puede('editar_cerradas')` de «Editar» del turno y de «Reabrir» del ticket.
- **Propuesta con JS (otra fase):** un conmutador Carta/Pedido en la orden, con dos pestañas, como hacen los POS de teléfono. Ahora conviene de verdad: en iPhone el pedido de arriba hacía saltar la carta (medido, §0.6) y por eso allí la carta va primero (§0.17); el conmutador devolvería el pedido a la vista también en iOS.

### 0.17 Revisión móvil (crítica visual y refutación funcional sobre `fdf2be2`)

Una ronda de correcciones, solo CSS y clases estáticas (ningún `<script>`, binding ni texto cambia). Código: `pos.html`, `scripts/pruebas/pos-visual.test.mjs` (7 pruebas nuevas) y la vista `orden-vacia` del arnés.

**Corregido**
- **C1 (orden, salto en iPhone):** `@supports (overflow-anchor: none)` envuelve el pedido-primero (§0.6). Medido en el simulador de iOS 26: 111 px de salto sin anclaje; en Chromium 0 px.
- **Liberar mesa fuera de pantalla (refutación #1, M1):** `.fila-acciones` parte en líneas y «Liberar mesa» va primero (§0.6).
- **Ticket 360×780, «Imprimir» tapado (A2):** `.ticket-acciones` queda pegada justo encima de la barra inferior (`sticky`, con `screen`). Cuesta 132 px de alto fijo más la barra de 60.
- **Conexión solo con color (A3, refutación #2):** `off` es un anillo hueco; el texto queda `sr-only` bajo 1440 px (§3.8).
- **Teléfono apaisado (refutación #3):** con alto ≤ 500 px el nav deja de ser fijo y `--orden-nav` vale 0. A 844×390 la lista visible pasa de 132 a 248 px.
- **Ticket térmico (refutación #4):** `.ticket-sub` y el precio vuelven a peso 400 en `body.print-termico`. La altura queda en 350 px (366 en `1945b1b`) por el interlineado de la cabecera; el contenido es el mismo.
- **M3:** el borde de `.btn-icon`, `.qty-btn` y `.menu-item-btn` pasa a `apoyo` (6,79).
- **M4 (cabecera del cierre):** «Imprimir resumen» va a lo ancho en teléfono (una acción sola va a lo ancho; dos, en rejilla de 2).
- **M5:** en el menú semanal, Editar y Ocultar van en `telon` y «Eliminar» conserva el barro, apartado .5rem.
- **M6 (visual):** Salir va sin borde y en `ceniza`, separado del avatar.
- **M7:** «Asignar a persona» en `apoyo`, 14 px, peso 500.
- **B2:** la barra de cobro de 768–1023 alinea con el gutter de 1.5rem. **B4:** el foco de `.field` sin doble anillo. **B11:** los íconos de KPI del cierre en un solo color.

**No se corrigió**
- **A4 (la barra de cobro tapa la nav y la salida queda arriba a la izquierda):** decisión de producto (§0.16). El crítico recomienda dejarlo hasta validarlo con meseros; la alternativa cuesta 60 px.
- **M2 (aviso «N sin sincronizar»):** bajarlo de 44 px rompe la regla táctil; sacarlo del flujo es una decisión de diseño.
- **M6 (confirmación al salir) y M10 (mesa siempre a la vista en la orden):** piden lógica o un binding nuevo.
- **M8 (manifest), M9 (teclado):** no se pueden verificar sin teléfono. `interactive-widget=resizes-content` ayudaría a las hojas y estorbaría al buscador de la carta.
- **B1, B3, B5–B10, B12, B13:** bajos; B3 (apaisado) solo en lo del nav. B7 (insignia a 13 px) costaría altura en las 10 mesas.

### 0.18 Ola B, parte b2: roles, alertas, personal, «sin acceso» y los dos cobros nuevos (marcado y CSS)

Rama `tarea/ola-b--b2-pantalla`. Solo marcado, CSS y arnés: **ningún `<script>` cambió** (los 7 bloques son idénticos a `b8cf0b3`). La lógica es de b1 y se acuerda por **nombres**: `Alpine.store('pos')` ya promete (contrato del reparto) `rol`, `rolCargado`, `sinAcceso`, `esAdmin`, `esMesero`, `puede(accion)`, las alertas, el personal, la selección por unidades y el cobro por monto. `scripts/pruebas/pos-ola-b2.test.mjs` vigila que el marcado no use un nombre fuera de esa lista ni del store de hoy.

**Ayudantes de presentación.** Viven en el `x-data` del `<body>` (marcado, no script): `metodoTxt`, `metodoIcono`, `haceTxt`, `minutosDe`, `precioTxt` (el signo menos: «− $ 20.000» y no «$ -20.000»), `enteroTxt`, `totalMesa`, `notaTxt`, `horaTxt` y `ahora`, que se refresca cada 30 s para que «hace X min» avance.

**Quién ve qué** (todo con `x-show="$store.pos.puede('…')"`; la base es quien manda de verdad):

| Control | Acción | Mesero |
|---|---|---|
| Borrar producto | `catalogo_borrar` | oculto |
| «Nuevo producto» y «Editar» producto | `catalogo_crear`, `catalogo_editar` | **visibles** |
| Menú semanal (entrada y vista) | `menu_semanal` | oculto |
| Personal (entrada y vista) | `personal` | oculto |
| «Cerrar día» (en su lugar, un aviso que lo explica) y «Reintentar respaldo» | `cierre_dia` | oculto |
| Cierre del día: ventas e historial en solo lectura (entrada y vista) | `ver_cierres` | **visibles** |
| «Editar» una transacción del turno, editar y eliminar en el historial, «Reabrir» en el ticket | `editar_cerradas` | oculto |
| «Rotar» el token de la pegatina | `rotar_token` | oculto |

**Navegación (decisión con la regla de 44 px).**
- **Teléfono, barra inferior.** Mesero: Mesas · Alertas · Productos · Cierre (4 columnas, 90 px a 360). Admin: los mismos más **«Más»** (5 columnas, 72 px a 360), que abre una hoja chica con Menú semanal y Personal.
  - Seis columnas habrían medido 60 px a 360: cumplen los 44 px, pero «Productos» a 12 px (≈ 58 px) no cabe en una línea, y la regla de §0.4 es una línea por etiqueta.
  - «Cierre del día» pasa a «Cierre» en teléfono (`sr-only` para el resto: el nombre accesible no cambia) porque en 72 px parte en dos líneas y la barra crece sobre sus 60 px.
  - Las columnas son `grid-auto-flow: column`: cuentan los links visibles, así que la barra se acomoda sola al rol.
  - **Las alertas son un destino de la barra inferior**, no solo una campana: en teléfono la barra de arriba no es fija (§0.4), y una alerta no puede esconderse al bajar por la carta. La insignia lleva el contador.
- **Desde 768 px** la barra de arriba es fija: ahí van la **campana** (`.btn-icon`, 44 px) con su insignia, y la fila de links trae solo lo que el rol puede usar (admin: 5; mesero: 3). Medido de 768 a 1600 con todo encendido (aviso de sincronización, alertas y «Hoy»): sin que se pise nada, el nav conserva su alto (116 px en tablet, 68 desde 1024) y «Cierre del día» no parte. Para eso, de 768 a 1023 los links bajan a .875rem con relleno de .5rem, y desde 1024 el relleno es de .625rem.
- **Rol visible:** un chip «Admin» o «Mesero» junto al avatar de 768 a 1439 px. Desde 1440 la fila lleva el nombre y ya no cabe.

**Alertas.**
- **Vista `alertas`:** una tarjeta por alerta, de la más vieja a la más nueva. Cada una dice «Mesa 3 · Pidió la cuenta», el método con su ícono («Paga con QR»), «Por cobrar $ X» (el total abierto de la mesa, que ya está en el store) y «hace X min», que pasa a `badge-maiz` desde los 3 minutos.
  - Acciones: «Ir a la mesa» (`.btn-telon`, 56 px, a lo ancho), «Atender» y «Descartar».
  - «Descartar» pide confirmar («¿Falsa alarma?») antes de llamar a `descartarAlerta`.
  - Arriba, «Silenciar 10 min», que pasa a «Reactivar el sonido» (`silenciarAlertas(0)`) con un aviso «en silencio hasta las 13:40». Sin alertas, el estado «Todo al día».
- **Aviso flotante:** arriba, breve (6 s), cuando sube `alertasPendientes`: «Mesa 3 pidió la cuenta · QR», y tocarlo abre la vista. Va a `z-index: 60`, entre el diálogo (50) y el login (100); no sale en la propia vista de alertas ni al imprimir (`print:hidden`).
- **Insignia en la mesa:** un disco `letrero` con campana en la esquina izquierda de la tarjeta (la presencia, `maíz`, va a la derecha). El texto «Pide la cuenta · QR» va en el `title` y `sr-only`.
- **Franja en la orden:** `.aviso-atencion` «Esta mesa pidió la cuenta · QR · hace 4 min» con «Atender».

**Personal (solo admin).** Formulario «Dar de alta» (correo de Google, nombre y rol en dos chips de 48 px) y la lista del equipo: nombre, correo, rol, «Sin acceso» si está de baja. Cada fila activa tiene un `select` de rol (cambia con `cambiarRolPersonal`) y «Dar de baja» con confirmación; una fila de baja ofrece «Volver a dar acceso». `personalError` sale en un `.aviso-peligro` con `role="alert"` sobre el formulario.

**«Sin acceso».** Pantalla completa de la familia del login (telón, franja, sin tarjeta): candado, «Esta cuenta aún no tiene acceso», qué pasó (la cuenta no está dada de alta en el personal), «Habla con el administrador», la cuenta con la que entró y dos botones: **Salir** (el único principal) y «Ya me dieron acceso · Reintentar» (recarga la página). El POS se monta con `usuario && !sinAcceso`.

**Cobro por unidades.** En «Cobrar por partes», una línea marcada con más de una unidad suma una tercera fila bajo su nombre: «COBRAR $ 26.000 · [−] 2 [+] de 3». Los botones de 44 px se deshabilitan en 1 y en `qty` (el deshabilitado es `linea` con `apoyo`, 4,61). La barra de arriba cuenta líneas con `Object.keys($store.pos.itemsSeleccionados)` y suma `subtotalSeleccion`, que ya cuenta solo las unidades elegidas.

**Cobro por monto.** Bloque «Cobrar un monto» con «Queda $ totalPendiente», un campo de 16 px (`inputmode="numeric"`, `type="text"`, el marcado quita lo que no sea dígito y escribe `montoAbono`), tres chips de método (Efectivo, QR y Transferencia, con `aria-pressed` y la clave del contrato en `metodoAbono`), la ayuda («Tiene que ser menos de lo que queda…», en `barro` si el monto no es válido) y «Cobrar $ X» en `.btn-telon`, deshabilitado con `!abonoValido`. **No es coral**: la pantalla ya tiene dos (`Cobrar seleccionados` y `Generar ticket y cobrar`).
- **Dónde va.** Es hijo de la rejilla de la orden, no del pedido. Bajo 1024 va justo después del pedido (`order: -1` en el mismo `@supports` que el pedido); desde 1024 ocupa el tope de la columna de la carta, porque en ese modo no se agregan productos y así el pedido sigue entero a la vista (dentro del pedido lo dejaba en 115 px a 1440×900).
- **«Abono recibido»** (precio negativo): renglón sobre `arroz`, ícono y monto en `turquesa` (4,70) con signo menos, nota «Pagó con Efectivo»; sin casilla, sin stepper y sin «Asignar a persona». El ticket de un abono suma «Queda por pagar $ X» (con `totalPendiente`).

**Arnés.** `_pos-simulado.mjs` trae 18 vistas nuevas (`alertas`, `alertas-vacia`, `alertas-silencio`, `mesas-alertas`, `orden-alerta`, `personal`, `personal-error`, `sin-acceso`, `orden-cobro-unidades`, `orden-cobro-monto`, `orden-cobro-abono`, `orden-cobro-monto-invalido`, `ticket-abono`, `mesas-mesero`, `mesas-admin-mas`, `productos-mesero`, `cierre-mesero`, `orden-nfc-mesero`). Fijan el estado directamente en el store.
- **`instalarContratoOlaB(page)`** agrega al store, antes de que Alpine lo registre, **solo lo que todavía no existe** (los nombres del contrato). Con la lógica de b1 integrada no hace nada y manda el store real. Las vistas de antes corren como admin.


### 0.19 Ola C, parte c3: aprobación del personal, mesas y pegatinas, ajustes del ticket, deshacer un cobro y los avisos del pulgar (marcado y CSS)

Rama `tarea/ola-c--c3-pantalla`, sobre `tarea/ola-b` (`24487b9`). Solo marcado, CSS y arnés: **ningún `<script>` cambió.** La lógica es de c2 y se acuerda por **nombres** (el contrato de la ola C); `scripts/pruebas/pos-ola-c3.test.mjs` vigila que el marcado los use todos. Bloques propios: `ola-c-c3 :: css` y, en el marcado, `espera`, `mesas-admin`, `ajustes` y `avisos`; lo demás se edita dentro de los bloques de b2 (Personal, nav, ticket, Transacciones del turno).

**Decisión de navegación (admin) — superada por §0.20 (ronda 5): «Más» ya no existe; todo esto cuelga del tablero de Administración.** Las dos entradas nuevas (**Mesas y pegatinas**, **Ajustes**) son solo del admin y vivían en **«Más»**, en todos los anchos.
- **Teléfono:** la hoja de «Más» pasa de 2 a 4 entradas (Menú semanal, Personal, Mesas y pegatinas, Ajustes), cuatro filas de 52 px. La barra inferior sigue en 5 columnas.
- **Desde 768 px:** «Más» es un link más al final de la fila del admin y abre un menú que **cuelga del propio botón** (`.nav-mas-wrap`, `position: relative`) con solo las dos entradas nuevas: Menú semanal y Personal ya son links ahí (sus items de «Más» llevan `md:hidden`). Siete links en una fila no caben a 1024 px (medido: ≈ 930 px de links donde sobran ≈ 700). En tablet (768 a 1023) las columnas pasan a `minmax(max-content, 1fr)`: con seis iguales «Cierre del día» no cabría.
- **Insignia de pendientes:** el número de solicitudes por aprobar (`numPendientes`) va sobre el ícono de Personal (link de tablet y escritorio, item de «Más» en teléfono) y sobre el botón «Más» **en teléfono** (donde Personal queda dentro). Con pendientes, el nombre accesible de «Más» pasa a «Más (2 por aprobar)».
- El mesero no ve nada de esto: ni «Más», ni las vistas (`puede('mesas_admin')`, `puede('ajustes')`, `puede('aprobar_personal')` son del admin).

**«Tu cuenta espera aprobación»** (`esperaAprobacion`: `estadoAcceso` pendiente o eliminado). Pantalla clara y cálida, no la fría de «sin acceso»: barra telón con el monograma y Salir, la franja, una tarjeta `papel` con un disco maíz (reloj de arena), «Tu cuenta espera aprobación», «Hola, {nombre}. Quedaste en la lista de pendientes. Pídele a Camila o al admin que te apruebe: cuando lo haga, esto se abre solo», el correo con el que entró, «Ya me aprobaron · Reintentar» (`btn-telon`, la acción principal: llama `comprobarEspera()`, que pregunta **sin recargar**, dice «Comprobando…» mientras tanto y, si sigue en espera, «Sigues en espera. Se revisa sola cada 30 segundos») y «Salir y usar otra cuenta» (discreto, `.btn-enlace`).
- Debajo, dos pestañas (`role="tablist"`): **Mesas** (el salón de solo lectura: `mesasPendiente`, la misma tarjeta del mapa pero `<div>` sin mano ni respuesta al toque, número, «Libre/Ocupada» y los puestos; sin total ni cuenta) y **Carta** (`cartaPendiente` agrupada por categoría, con precios).
- Variante **eliminado** («Esta cuenta no tiene acceso»): icono de candado y sin pestañas.
- El POS y «sin acceso» **ceden** ante esta pantalla (`!esperaAprobacion` en sus compuertas): si c2 no sincroniza ni abre Realtime en espera, aquí tampoco se pide nada al store más que lo del contrato.
- La pantalla no usa `$store.pos.mesas`, `ordenes` ni `productos`.

**Personal (admin).** Arriba **«Pendientes (N)»** con tarjetas grandes (filete maíz a la izquierda, inicial en disco maíz, nombre de 18 px, correo, «Pidió acceso hace 12 min»): **Aprobar como mesero** (`.btn-telon`, un toque), **Aprobar como admin** (`.btn-secondary`; pide confirmar dentro de la tarjeta: «Podrá cerrar el día, borrar productos, cambiar mesas y pegatinas y aprobar o eliminar personal») y **Rechazar** (`.btn-peligro`; pide confirmar: «¿Rechazar a …?»), con una línea bajo los botones que dice qué es cada rol. Tres botones apilados de 52 px en teléfono; en fila desde 640. Debajo: «Agregar persona» (ahora **secundario**: el camino normal es aprobar; el coral de la vista es el «Dar de alta» del formulario) y el equipo aprobado. En el equipo se conserva **«Dar de baja»** (`eliminarPersonal`, con su confirmación: «Sí, dar de baja»; la misma palabra de la ola B); la lista filtra `estado !== 'pendiente'` por si `personal` trae las dos. Los errores por persona usan `personalErrorEnFila(email)`, igual que antes.

**Mesas y pegatinas (`mesas-admin`).** Una tarjeta por mesa (1 columna en teléfono, 2 desde 768, 3 desde 1280): «Mesa N», «N puestos» (y «Con cuenta abierta»), chip Activa/Inactiva, «Escrita hace 3 días / Pegatina sin escribir» y «Revisada hoy / Sin revisar» (turquesa si es de hoy y para «escrita»; los días son de calendario: «ayer», no «hace 0 días»). Una mesa inactiva va sobre arroz y con un aviso maíz («no sale en el mapa del salón y su enlace no abre la cuenta hasta que la actives»).
- **Todos los días:** **Escribir pegatina** (telón, renglón entero; solo con `nfcDisponible`), **Revisar** (corto, junto a «Escribir»: es el paso siguiente) y Copiar enlace (dice «Copiado» 1,6 s **solo si de verdad copió**: si el portapapeles falla, abre el enlace seleccionado para copiarlo a mano) y, si está inactiva, Activar. **Detrás de «Más opciones»:** Puestos (la capacidad), Desactivar, **Rotar enlace** y Ver enlace (el enlace es largo y es un secreto de la mesa: no está a la vista). Con seis botones por tarjeta la lista medía 4.200 px a 390.
- Sin NFC (iPhone, o un navegador sin Web NFC): **una guía arriba, una sola vez**, neutra y en tres pasos («Toca “Copiar enlace”», «En NFC Tools: Escribir, Añadir un registro, URL…», «acerca el teléfono: debe abrir la carta de esa mesa. Luego toca “Ya la revisé”»), no repetida en cada tarjeta. Cada tarjeta ofrece **Ya la escribí** y **Ya la revisé**, que anotan la pegatina con el token del enlace que se copió (`marcarPegatinaManual`): sin NFC no hay otra forma de saberlo.
- **Rotar enlace** dice antes de hacerlo que la pegatina pegada deja de servir y hay que reescribirla. El panel llama `rotarTokenMesa(m.id)`: el contrato no nombra esa función, que hoy toma la mesa activa; **c2 debe dejarla aceptar un id opcional** y quitar su `confirm()` y `alert()` (el panel ya confirma en la página).
- **Agregar mesa** (`.btn-secondary`: es una acción rara; el coral queda para escribir la pegatina): número (1 a 99) y capacidad (1 a 50, el mismo tope que la base), campos numéricos de 16 px que solo guardan dígitos; los límites son del formulario, la base manda con su código (`ya_existe`).
- **Errores** (`mesasAdminError`): no arriba (la lista es larga) sino en la pila del pulgar, con «Entendido».
- **Hoja de NFC** (`nfcEstado`): el `.modal` compartido (hoja inferior en teléfono): disco telón con el ícono y dos halos quietos que cambian de color con la fase (esperando: maíz; ok: turquesa; error: barro), el mensaje de `nfcEstado.mensaje` (con respaldo por fase) y el título según la acción (`nfcEstado.accion`: «Escribir pegatina · Mesa N» o «Revisar pegatina · Mesa N»). Al escribir dice «Tiene que ser la pegatina de la mesa N: lo que esté cerca se sobrescribe» y «Mantén el teléfono pegado… hasta que diga que terminó. Esto no la bloquea». Botones: **Cancelar** (esperando); **Revisar ahora** + Listo (escrita: el paso siguiente a un toque) o solo Listo (revisada); **Reintentar** + Cerrar (error: el fallo típico es que se alejó muy pronto). El mensaje lleva un espacio duro entre «mesa» y su número (sin `text-wrap`, que las tablets viejas no entienden). Cancelar llama `cancelarNfc()`, que deja `nfcEstado` en reposo (`fase: null`) y cierra la hoja.

**Ajustes → Ticket.** Dirección del QR (`type="url"`, `inputmode="url"`, 16 px; «https://», sin espacios, hasta 200: la misma regla de la base), interruptor «Mostrar QR» (`role="switch"`, 56×44, la bola a la derecha cuando está activo, no solo el color), texto del pie (hasta 120, con contador), una **vista previa** del pie con las mismas clases del ticket y «Guardar cambios» (coral; solo con algo que guardar y válido) y «Descartar cambios».
- Los campos editan un **borrador de la vista**, no el store: si fueran `x-model="$store.pos.ajustes…"`, una dirección a medio escribir se imprimiría en los tickets aunque nadie guardara. La vista previa **sí es en vivo**, también el QR: se dibuja con `qrSvgPara(urlPrevia)` (la dirección que se escribe si es válida; si no, la guardada), sin mirar si el QR está encendido en lo guardado (así encenderlo desde un QR guardado apagado no deja un cuadro vacío). El rojo de la dirección sale al **salir del campo**, no con la primera letra («Pega la dirección completa: empieza por https:// y no lleva espacios»); una dirección de más de 60 caracteres avisa que el QR sale denso a 18 mm.
- `ajustesError` sale en un `.aviso-peligro`; `ajustesGuardados`, «Guardado. Los tickets nuevos ya salen así».

**El ticket.** `ticket-footer` usa `ajustes.ticketPie`; el QR sale de `qrTicketSvg` dentro del mismo `.ticket-qr` (un `<div class="ticket-qr-svg" x-html>`: el `svg` que dibuja la librería hereda `.ticket-qr svg`, 4,5 rem en pantalla y 18 mm en el térmico). **Se queda sin QR** (nunca un cuadro roto) si `ticketQrVisible` es falso, si `qrTicketSvg` viene vacío (la librería no cargó) o si la dirección no empieza por `https://`. El margen de 3 mm, la sangría de las sublíneas y el 18 mm de `pos-pie` no se tocaron.

**Deshacer un cobro.** Va en la **pila del pulgar** (`.avisos-pulgar`), fija abajo:
- **«Cobrado $ X · Deshacer»** (`ultimoCobro`): barra telón con filete turquesa, «Mesa 3 · abono · 11 s» (o «cobro parcial» / «mesa completa»), el botón «Deshacer» de 44 px (se apaga mientras deshace) y una barra maíz que se vacía en 15 s. El monto no se parte («Cobrado $ 58.000» lleva un espacio duro y `white-space: nowrap`); bajo 380 px se va el ícono y bajo 480 los segundos (la barra ya muestra el tiempo): a 360 cabe en dos líneas. La barra sigue la hora (el aviso lleva su reloj de 250 ms) y se mueve con `transition`, **no con una animación**: con `prefers-reduced-motion` va a saltos. Se esconde sin red (`conexion === 'offline'`) y sin `puede('deshacer_cobro')`.
- Se asienta sobre la barra que haya: en la orden, sobre la de cobro; en el **ticket** (donde cae justo después de cobrar), sobre las acciones fijas de «Imprimir» (`--pos-ticket-acciones: 8.25rem`: 52 + 12 + 52 + 2 × 8, medido en el navegador). La vista del ticket es en teléfono una columna de al menos una pantalla (`.vista-ticket`), así las acciones van **siempre al pie** y el aviso nunca se pega a «Imprimir» aunque el ticket sea corto (un abono); en el resto, sobre la barra de navegación. Si hay un **aviso de alerta** en ese mismo sitio, la pila **sube** 4 rem: el aviso pone la clase `hay-toast-alerta` en `<html>` (un `x-effect`, sin `:has()`).
- **Deshacer el cobro** (Transacciones del turno; **sin ventana de tiempo**): un botón de 44 px a lo ancho bajo la fila, solo si `puedeDevolver(orden)`. Su texto lo decide `tipoDevolucion(orden)`: «Devolver a la cuenta de Mesa N» (parcial y abono), «Deshacer · reabrir la Mesa N» (la mesa completa, con la mesa libre) o «Deshacer · pasar a la cuenta de Mesa N» (la mesa ya tiene otra cuenta). El chip de la fila dice qué es: **Facturada**, **Cobro parcial** o **Abono**. Pide confirmar **dentro de la fila**: «Vuelve a la cuenta de la Mesa 3: 2 × Pechuga…, 2 × Limonada… ($ 98.000). Se borra de las ventas y la cuenta pasa de $ 97.000 a $ 195.000» (el abono: «Se quita el abono de $ 20.000… y vuelve a la cuenta…»). El total resultante es `totalMesa(mesa) + orden.total`. «Sí, deshacer el cobro» llama `devolverACuenta(orden.id)`; la confirmación dice también «Queda anotado quién lo deshizo».
- **Cobros deshechos hoy** (cierre del día, solo admin; `deshechosHoy`): una tarjeta entre las transacciones y «Cerrar día», con el chip «N · $ X» y una fila por cobro (mesa, tipo, hora y quién —la parte del correo antes de la arroba—, el monto a la derecha). Sin deshechos: «Nadie deshizo cobros hoy». El mesero no la ve. «Hoy» es lo que todavía no cuelga de ningún cierre (`cierre_id` de la base, no la hora de la tablet). En el historial, cada día de cierre muestra «N cobros deshechos ($ X)» junto a sus órdenes (solo admin), y la ventana «Confirmar cierre del día» dice cuántos se deshicieron en el turno. Si la base no cierra, `hay_abiertas` y `sin_ventas` cierran la ventana con el aviso «No se cerró el día: …» y, si los números de la base no son los que la tablet veía (`cambio`), la ventana se queda abierta con un recuadro maíz «Los números cambiaron mientras mirabas…», los números de la base y el botón corto «Sí, cerrar así» (a 320 px un rótulo largo empujaba «Cancelar» fuera de la pantalla).
- **Errores** (`deshacerError`): en Transacciones, dentro de su tarjeta; en las demás vistas, en la pila del pulgar. Los dos con «Entendido».
- **Avisos con acción** (`avisar(texto, ms, { vista, etiqueta })`): el aviso breve de arriba lleva un «Ver» que va a esa vista con un toque (aprobar a alguien dice «Laura Demo entra como mesero. Si no era ese rol, cámbialo en Equipo» y «Ver» lleva a Personal; una solicitud nueva dice «Hay una solicitud nueva: X. Revísala en Personal», sin género).
- El modal de confirmar un abono dice ahora que se puede «Deshacer» justo después.

**Interacción.**
- **«+1 Paloma · van 7»** (`agregadoReciente`): una píldora telón **a la izquierda** (sobre «TOTAL»: a la derecha tapaba la columna de los «+», que es donde se toca), sobre la barra de cobro, con el número en maíz y lo que lleva ya la línea en el pedido (el pedido va arriba del catálogo y no se ve al agregar); se vuelve a montar con cada toque (la clave es `ts`) y hace un saltito de 180 ms, así «+3 Paloma» se nota al acumular. Deja pasar los toques (`pointer-events: none`).
- **Respuesta al tocar:** los botones se hunden a `scale(.97)` (antes .985, que casi no se veía) y su sombra se encoge; las tarjetas de mesa a .97 y con fondo `arroz`; los steppers y el «+» a .9; las filas de producto ganan un filete `letrero` a la izquierda; los links y las filas de «Más» se iluminan (`--pos-telon-elevado`). Transiciones de .1 s. **Con `prefers-reduced-motion` se quita la escala** y quedan el fondo y la sombra (los `transition-duration` ya los apaga el global).
- `vibrar(ms)` lo llama c2; el marcado no.

**Lo que supone el marcado de los datos de c2** (para el integrador):
- `mesasPendiente`: filas `{ id, capacidad, estado }`, como las devuelve `vista_pendiente()`. `cartaPendiente`: filas `{ categoria, nombre, precio, descripcion }` de `carta_publica`; el marcado también acepta un objeto `{categoría: [filas]}`.
- `personalPendientes`: `{ email, nombre, solicitadoEn }` con `solicitadoEn` ISO o milisegundos. `personal` puede traer las filas pendientes: la lista de aprobados las salta.
- `mesasAdmin`: `{ id, capacidad, activa, estado, enlace, escritaEn, revisadaEn }` con las fechas ISO o `null`.
- `ultimoCobro.hasta`: milisegundos de época (el aviso resta `Date.now()`); `agregadoReciente.ts` distinto en cada toque.
- `nfcEstado`: en reposo `{ id: null, fase: null, mensaje: '', accion: null }` (`accion` es `'escribir'` o `'revisar'`); la hoja se abre cuando `fase` es `'esperando'`, `'ok'` o `'error'` y `cancelarNfc()` la deja otra vez en reposo.
- `guardarAjustes(cambios)` recibe `{ ticketQrUrl, ticketQrVisible, ticketPie }`.

**Arnés.** `_pos-simulado.mjs` trae 27 vistas nuevas (`espera`, `espera-carta`, `espera-eliminado`, `personal-pendientes` y dos confirmaciones, `mas-pendientes`, `mas-escritorio`, `mesas-admin`, `mesas-admin-sin-nfc`, `-rotar`, `-editar`, `-agregar`, `nfc-esperando`, `nfc-ok`, `nfc-error`, `ajustes`, `ajustes-invalido`, `ajustes-sin-qr`, `ticket-pie-ajustado`, `ticket-sin-qr`, `deshacer-ticket`, `deshacer-mesas-alerta`, `cierre-devolver` y sus dos confirmaciones, `orden-agregado`), todas con el estado fijado en el store. Las vistas fijan el estado en el store REAL: el relleno provisional del contrato (`instalarContratoOlaC`) salió al integrar c2 y c3, y `pos-ola-b2.test.mjs` §1 volvió a exigir que TODO nombre del marcado exista en el store. Web NFC se simula con `datos.nfc = true`.

**Medido (arnés, 360×780, 390×844, 768×1024 y 1440×900):** 0 desbordes horizontales y 0 controles menores de 44×44 en las 27 vistas nuevas y en las 42 anteriores que no son de impresión (271 combinaciones de vista y ancho); 0 errores de consola.

**Cambia respecto de §0.18:** «Más» ya no es solo de teléfono; a una **solicitud** se la «Rechaza» y al equipo se le sigue dando «de baja»; «Agregar persona» es secundario; el pie del ticket y su QR ya no son estáticos; «un abono no se deshace desde la cuenta» ya no vale (hay «Deshacer» y «Devolver a la cuenta», sin ventana de tiempo).

**Ronda 3 de la ola C (crítica visual y de uso, móvil primero).** Se atendió todo lo P1 y lo barato de P2: la vista previa del ticket dibuja el QR de lo que se escribe; «Deshacer» ya no se pega a «Imprimir» ni se parte a 360 px; «Copiado» solo si copió; «Reintentar» de la espera responde; aprobar confirma y «Ver» lleva a Personal; la hoja de NFC dice la acción, deja «Reintentar» y «Revisar ahora»; iPhone con una guía neutra y «Ya la escribí / Ya la revisé»; «Rechazar» y «Dar de baja»; «+1 Paloma · van N» a la izquierda; «Revisar» y «Puestos» cortos; «Agregar mesa» secundario; el chip de Transacciones dice Abono, Cobro parcial o Facturada; las mesas de la espera sin sombra y con «Solo para mirar». **Quedó para después (P3):** el ícono de «check» en «Cobro deshecho», un `padding-bottom` del mapa mientras la pila de avisos esté activa, la fuente monoespaciada de la vista previa del ticket, unificar los dos textos de «mesa con cuenta abierta» y un solo indicador por mesa en vez de «Escrita» y «Revisada».

**Ronda 5a de la ola C («simplificar»): la hoja «Cierre sin respaldo» (redactada de nuevo en la ronda 6: ver §0.21) y «Reabrir en mesa» sin red.** Una hoja nueva, sin CSS propio (reutiliza `.modal` de §0.11, `.history-row` + `.deshecho-fila`, `.aviso` / `.aviso-peligro`, `.btn-primary` y `.btn-secondary`): titula «Cierre sin respaldo», dice «Hay un cierre sin respaldo de la versión anterior: N ventas, $ X» y lista una fila por venta (mesa en `font-semibold`, hora, el texto de lo que la base ya tiene —en `texto-peligro` cuando **falta** en la base o está **abierta**— y el monto a la derecha, que no se encoge); el pie lleva «Subir las que faltan (N)» como botón principal (uno por pantalla) y «Descartar este cierre local» como secundario, apilados en teléfono (`pie-apilado`); «Descartar» pide un segundo toque con un `.aviso-peligro` y los botones «Cancelar» / «Sí, descartar». La vista del cierre ofrece «Revisar» en un `.aviso` aparte (`#cierre-viejo-aviso`) y la ventana «Cerrar día» dice, dentro del bloqueo de mesas abiertas, cuáles ya estaban en un cierre. En «Editar transacción», «Reabrir en mesa» se apaga sin red y su razón sale en un `.aviso` (`#reabrir-razon`) con `aria-describedby`. **Medido** (`pos-ola-c-r5a-navegador.test.mjs`, 320, 390 y 1440 px, contra el stub): 0 desbordes horizontales (de la página y de la hoja), todos los botones de ≥ 40 px (los de `.btn-*` miden 44) y dentro de la pantalla, 0 errores de consola y 0 pedidos fuera del propio sitio.

### 0.20 Ola C, ronda 5 (r5b): el tablero de Administración (marcado, CSS y store)

Rama `tarea/ola-c--r5-tablero`, sobre `tarea/ola-c` (`9ddce8f`). Pedido de Yonatan (2026-10-01): «construir un panel o dashboard del admin donde pueda agregar meseros, editar menús semanales y demás administración». Hasta hoy las vistas del admin estaban sueltas (Personal y Menú semanal como links, Mesas y pegatinas y Ajustes dentro de «Más» en teléfono, el resto repartido entre Cierre y la campana). **Solo el admin** (`puede('administracion')`; el mesero no ve la entrada ni el tablero). **No se duplica ninguna vista:** cada tarjeta abre la que ya existía y el tablero solo lee, cuenta y lleva.

**Navegación (decisión).** Una sola entrada, **Administración**, en todos los anchos; **«Más» desaparece** (con su hoja, su menú, su CSS y su estado `mas`: quedaba vacío).
- **Teléfono:** la barra inferior del admin son **cinco** columnas: Mesas · Alertas · Productos · Cierre · **Admin**; la del mesero, las cuatro de siempre (sin Admin). **Desviación del pedido, a la vista:** el pedido decía «Mesas · Productos · Cierre · Administración» y aquí **Alertas se queda** en la barra del admin. Es la única forma de ver un «pide la cuenta» en teléfono (la campana es desde 768 px) y el mesero la conserva: sacarla obligaría al admin a dos toques para algo que no espera. Cinco columnas de 72 px a 360 siguen siendo táctiles (≥ 44 px). Para quitarla basta un `md:hidden` más en el link de Alertas, y la tarjeta Alertas del tablero la cubre.
- **Etiqueta:** «Admin» en teléfono y «Administración» desde 768 (`md:hidden` / `hidden md:inline`): en 72 px «Administración» no cabe en una línea. El nombre accesible NO cambia con el ancho: `aria-label` «Administración» (y «Administración (2 por revisar)» con algo pendiente). Ícono `sliders-horizontal` (ronda 6: `layout-dashboard` se confundía con el `layout-grid` de Mesas a 22 px); la insignia (`.insignia`, la de las alertas) lleva `numAtencionAdmin`: las solicitudes por aprobar más una por cada tarjeta que pide algo (menú, pegatinas, ventas sin subir); el nombre accesible dice «Administración (N por revisar)».
- **Tablet y escritorio:** la fila del admin son cuatro links (Mesas, Productos, Cierre del día, Administración). Antes eran seis, y a 1024 px no cabían sin partir; ahora caben a 768 con el relleno apretado de siempre. La campana sigue arriba.
- **Activa en todo el árbol:** `enAdministracion` (`VISTAS_ADMIN` = `admin`, `personal`, `menu`, `mesas-admin`, `ajustes`): la entrada queda marcada también dentro de esas cuatro vistas, con `aria-current` («page» en el tablero, «true» dentro). A quien le quitan el rol de admin mientras mira cualquiera de las cinco se le devuelve al mapa.
- **Vuelta:** cada una de las cuatro vistas lleva arriba **«‹ Administración»** (`.volver-admin`, 44 px) que llama `irA('admin')`.

**El tablero (`vista === 'admin'`).** Encabezado (eyebrow «Restaurante», título «Administración», una bajada), un aviso si no hay red («Sin conexión: los datos de las tarjetas pueden estar desactualizados»; las tarjetas muestran lo último que se supo o «—»), la franja **Hoy** y la rejilla de tarjetas: **1 columna en teléfono, 2 desde 768, 3 desde 1024** (`.tablero-rejilla`, `minmax(0, 1fr)`).

- **Franja «Hoy»** (decisión: va en el tablero y es **informativa**, sin tocar): **Ventas del turno** (`totalHoy`), **Mesas ocupadas** y **Alertas pendientes** (en barro si hay), de un solo getter, `tableroHoy`. Es la tira de mesas (`.stats-mesas`) con las columnas `1.5fr 1fr 1fr` en teléfono: el dinero, lo más largo, primero. No duplica el encabezado de la app, que solo lleva la campana, el punto de conexión y, desde 768, «Hoy $»: aquí están las tres cosas juntas para decidir qué abrir.
- **La tarjeta** (`.card.tarjeta-admin`, `data-tarjeta="<clave>"`): ícono en disco arroz, **título** (un `<button class="tarjeta-admin-abre">` dentro del `<h2>`; su `::after` cubre toda la tarjeta, así que **tocar donde sea abre la vista**; 44 px de alto, el foco se dibuja alrededor de la tarjeta entera), **dato vivo** (`.tarjeta-admin-dato`: un número grande y su frase), **detalle** (`.text-fine`) y la **acción principal** (`.btn-secondary.tarjeta-admin-accion`, 52 px, a lo ancho y encima del área táctil con `z-index`). Las que piden algo del admin llevan filete maíz y un chip maíz (`.destacada`): **Personal** (hay solicitudes), **Menú semanal** (falta o está incompleta), **Alertas** (hay pendientes) y **Cierres e historial** (una tablet trae un cierre «Sin respaldo» de la versión anterior que el admin aún no decidió: chip «Por decidir»; integración de la ronda 5). Ningún coral: en un tablero no hay una acción de la pantalla.

| Tarjeta (`data-tarjeta`) | Dato vivo (getter) | Acción | Qué hace |
|---|---|---|---|
| Personal (`personal`) | «2 esperan aprobación» · «3 activos» (`tableroPersonal`; destacada con N > 0) | Agregar mesero (con solicitudes esperando, antes: **Revisar solicitudes (N)**, y «Agregar mesero» pasa a enlace) | `accionTablero('agregar-persona')`: abre Personal con el formulario de alta abierto, el rol en Mesero y el foco en el correo |
| Menú semanal (`menu`) | La semana EN CURSO: «La semana está cargada» / «Falta cargar esta semana» / «Faltan por definir N platos» + «Semana del 28 de sept – 3 de oct» (`tableroMenu`) | Editar menú | `irA('menu')`: abre siempre en la semana en curso |
| Mesas y pegatinas (`mesas`) | «9 mesas activas» · «4 pegatinas sin revisar» (`tableroMesas`; destacada con pegatinas sin revisar, chip «Por revisar») | Revisar pegatinas (ícono `nfc`) | `irA('mesas-admin')` |
| Productos (`productos`) | «12 en carta» · «4 categorías» (`tableroProductos`) | Agregar producto | `accionTablero('agregar-producto')`: abre el modal «Nuevo producto» sin salir del tablero (el modal es de toda la app) |
| Ticket y ajustes (`ticket`) | La dirección del QR sin `https://` ni la barra final · «El QR sale en el ticket» / «QR apagado…» (`tableroTicket`) | Editar ticket | `irA('ajustes')` |
| Cierres (`cierres`; «e historial» en `sr-only`) | «29 de sept · $ 514.000» · «Último cierre» (`tableroCierre`; el más reciente por fecha). Con un cierre «Sin respaldo» viejo sin decidir: destacada («Por decidir»), el titular dice «Un cierre por decidir» y el detalle «Esta tablet guardó ventas del sistema anterior que no se subieron: decide si subirlas o descartarlas» | Ver historial (y, solo en ese caso, antes: **Revisar ventas sin subir**) | `accionTablero('ver-historial')`: abre Cierre y baja a `#historial-cierres`. `accionTablero('revisar-cierre-viejo')`: abre la hoja «Cierre sin respaldo» de la ronda 5a (`abrirCierresViejos`), la misma que se abre sola al arrancar (una vez por sesión) y que ofrece el aviso «Revisar» de la vista de Cierre |
| Cobros deshechos hoy (`deshechos`) | «3 cobros · $ 109.000» o «Nadie deshizo cobros hoy» (`tableroDeshechos`; solo lo que ningún cierre se llevó) | Ver lista | `accionTablero('ver-deshechos')`: abre Cierre y baja a `#deshechos-titulo` |
| Alertas (`alertas`) | «2 pendientes» · «Mesas 3, 6» (`tableroAlertas`; destacada con N > 0) | Ver alertas | `irA('alertas')` |
| Impresora de la caja (`impresora`) | `impresora.nombre` y `impresora.detalle` (`tableroImpresora`) | Ver impresora | `irA('impresora')` — **oculta, ver abajo** |

**Lógica (store).** Todo reutiliza lo ya cargado; los números no se calculan en el marcado.
- `irA(vista)` es la puerta (ya existía para Personal, Mesas y Ajustes): comprueba el permiso (`personal`, `mesas_admin`, `ajustes`, `menu_semanal`, `administracion`, `ver_cierres`; `impresora` pide `administracion`) y pide los datos de esa vista. `accionTablero(accion)` hace lo que el botón de una tarjeta hace además de abrir (`agregar-persona`, `agregar-producto`, `ver-historial`, `ver-deshechos` y `revisar-cierre-viejo`) y exige `administracion`.
- `cargarTablero()` (al abrir el tablero, sin red no hace nada): las **lecturas que esas vistas ya hacen** (`cargarPersonal`, `cargarMesasAdmin`, `cargarDeshechos`, `cargarAjustes`) en paralelo (cada una atrapa sus errores: si una falla, su tarjeta conserva lo último) y **una sola lectura nueva y liviana**, `_cargarMenuActual()`: `menus` de la semana en curso, `id, principal, activo`, a lo más 18 filas (`menuActual`: `total` de menús activos y cuántos siguen en «Por definir»). Si algo no se ha leído todavía, la tarjeta dice «—» o «Sin leer todavía», no un cero.
- Getters `tableroHoy`, `tableroPersonal`, `tableroMenu`, `tableroMesas`, `tableroProductos`, `tableroTicket`, `tableroCierre`, `tableroDeshechos`, `tableroAlertas`, `tableroImpresora`, más `mesasOcupadas` y `enAdministracion`: cada uno devuelve los números crudos (que las pruebas cuentan) y los textos ya armados (`numero`, `texto`, `detalle`, `destacada`).
- Entre vista y store no hay estado compartido nuevo: «Agregar mesero» le pide el formulario a Personal con un evento de la ventana (`pos-accion`, `detail.accion = 'agregar-persona'`, que Personal escucha con `@pos-accion.window`), porque el formulario vive en su propio `x-data`. `_alSalirLaSesion` y `_olvidarTodo` vacían `menuActual` e `impresora`.

**Gancho de la impresora de la caja (rama `tarea/impresion-caja`).** La tarjeta **«Impresora de la caja»** ya está en el marcado y **no existe para nadie** mientras `tieneImpresora` sea `false` (`x-show="$store.pos.tieneImpresora"`; hoy `impresora` es `null`). Para encenderla esa rama solo tiene que: (1) poner `$store.pos.impresora = { nombre, detalle }` (el nombre de la impresora y una línea de estado: «Lista · último ticket hace 2 min», «Sin papel»); (2) agregar su vista (`vista === 'impresora'`, con `x-show` y `puede('administracion')`) y sumarla a `VISTAS_ADMIN` para que la entrada del nav siga activa y la vuelta funcione. El botón «Ver impresora» ya llama `irA('impresora')`, que pide el permiso del tablero. Cuando la rama tenga datos reales, que lea y deje `impresora = null` si no hay agente.

**Arnés** (`_pos-simulado.mjs`): cinco vistas, que **no fijan el estado en el store**: abren el tablero con la entrada del nav y pintan lo que el stub contesta a las lecturas. `admin` (con pendientes: 2 solicitudes, 2 platos por definir, 4 pegatinas sin revisar, 2 alertas, 3 cobros deshechos), `admin-vacio`, `admin-sin-red`, `admin-impresora` y `admin-mesero`. `tableroConPendientes` y `tableroVacio` se exportan: las pruebas cuentan sobre esos mismos datos. Se fueron `mas-pendientes`, `mas-escritorio` y `mesas-admin-mas`; `aMenu` llega por el tablero.

**Pruebas:** `pos-ola-c-ronda5-tablero.test.mjs` (marcado, nav, permisos, getters y CSS, con el `<script>` real en un `vm`) y `pos-ola-c-ronda5-tablero-navegador.test.mjs` (Chromium: contadores con los datos del arnés, cada tarjeta y cada acción, el mesero, la vuelta, sin desborde y sin controles de menos de 44×44 a 320, 360, 390, 768 y 1440). Las de «Más» de la ola B y de c3 se reescribieron para la nueva navegación.

---

## 1. Dirección visual

**Decisión en una línea: el POS se viste como la carta.** La barra superior va en `telon` con la franja debajo. El área de trabajo va en `arroz`, con tarjetas `papel`. Usa Cinzel para la marca y los títulos, y Archivo para todo lo que se lee y se toca. Lo que hoy es obsidiana pasa a la paleta v2.

**Por qué claro y no oscuro:**
- El restaurante atiende de 12:00 a 17:00, con luz de día. Con luz de día, texto `telon` sobre `papel` (18,74) se lee mejor y refleja menos que un tablero negro.
- `carta.html`, la pantalla que el cliente ve en la pegatina NFC, es exactamente este esquema: telon arriba, franja, arroz y papel. El mesero ve en el POS la misma carta que ve el cliente.
- Todos los pares que usa este esquema ya están medidos en `identidad-visual.md` §3.1. No se inventa ningún tono.
- **Es reversible.** Los alias v1 se conservan (§2.3). Si Yonatan prefiere oscuro al ver las capturas, basta con remapear `:root`. La superficie oscura elevada ya está medida (§2.1, `--pos-telon-elevado`).


### 0.21 Ola C, ronda 6: la crítica visual de la ronda 5 (hoja de ventas sin subir y tablero), móvil primero

Rama `tarea/ola-c`, sobre `b0f5336`. Se atendió lo P1 de la crítica y lo barato de P2 y P3; lo demás queda dicho abajo.

**La hoja «Ventas sin subir de esta tablet»** (antes «Cierre sin respaldo»; el mismo `.modal`, con `.modal-ancho` desde 768 para que los dos botones quepan en una fila):
- **Lo que importa, arriba.** «Esta tablet guardó N ventas ($ X) del sistema anterior (cierre del 30 de sept, 12:30 p. m.).» y, ya comparada, **«Faltan en el sistema: 1 ($ 60.000)»** en `texto-peligro` (o «No falta ninguna: el sistema ya las tiene»). Sin jerga: «sistema», no «base»; sin «cierre sin respaldo de la versión anterior».
- **La lista trae solo lo que hay que mirar:** las ventas que FALTAN y las que el sistema tiene ABIERTAS (`cierreViejoFilasVisibles`), cada una con **día y hora** (`fechaYHora`: «30 de sept, 12:00 p. m.»). Las demás (ya están, ya estaban en un cierre, se deshicieron, no es una venta cerrada) van en **una línea**: «Otras 3 ventas ya están en el sistema, se deshicieron o no se suben» (`cierreViejoResto`). Con decenas de ventas la cabecera ya no se va con el scroll.
- **Botones con lo que hacen:** «Subir 1 venta ($ 60.000)» (`etiquetaSubirViejo`; «Nada que subir» si no falta ninguna) y «Descartar copia».
- **La confirmación de descartar vive en el pie fijo** (`.modal-footer.pie-apilado`, sticky en teléfono), no en el cuerpo: con una lista larga el aviso quedaba fuera de la pantalla y «Sí, descartar» (coral) caía justo bajo el dedo que había tocado «Descartar». Ahora, de arriba abajo en teléfono: el **aviso** («¿Descartar la copia de esta tablet? Se borra y no se puede deshacer. 1 venta ($ 60.000) se perdería.»), **«Sí, descartar»** (`.btn-peligro`, ya no el coral) y **«Cancelar»**, que queda en el lugar exacto de «Descartar copia». El aviso entra en el pie con `order` (arriba en teléfono, que invierte con `column-reverse`; en una fila propia desde 768).

**El tablero:**
- **Lo que pide algo sube:** `.tarjeta-admin.destacada { order: -1 }` y la de Alertas, `-2`: Alertas, Personal, Menú, Mesas y Cierres quedan primero (a 1440, en la primera fila). El orden de lectura del teclado sigue siendo el del marcado; solo cambia el visual.
- **Mesas y pegatinas se destaca** con pegatinas sin revisar (chip «Por revisar»); su botón dice «Revisar pegatinas» (ícono `nfc`), no «Ver mesas». El chip del menú dice «Por cargar» o «Por definir» (patrón «Por …»).
- **Personal:** con solicitudes esperando, el primer botón es «Revisar solicitudes (N)» y «Agregar mesero» pasa a `.btn-enlace`.
- **Cierres:** el titular no se contradice con el detalle («Un cierre por decidir»), el título es «Cierres» (con «e historial» en `sr-only`, como el nav: el chip ya no parte el título en dos líneas a 320 y 390) y su botón dice «Revisar ventas sin subir». El ícono de los botones de tarjeta no se encoge (`.tarjeta-admin-accion > i { flex: none }`).
- **La insignia de «Admin»** cuenta las solicitudes más una por cada tarjeta destacada que no sea Alertas (`numAtencionAdmin`), y su ícono es `sliders-horizontal`.
- **La bajada** del tablero: «Toca una tarjeta para abrirla.» (una línea; devuelve unos 20 px al primer pantallazo).

**Quedó para después, con su porqué:** (P2.6) que «Editar menú» lleve al primer plato «Por definir» y que «Generar semana» use una hoja propia en vez de `confirm()`: pide marcar filas y una hoja nueva, y la tarjeta sigue abriendo la vista; (P2.10) filas compactas en teléfono (el tablero mide ~2.200 px a 390): cambia el diseño de toda la rejilla y la mitad de las pruebas del navegador que hacen clic en cada acción; (P3) el chip de Alertas en coral: pide un par de colores nuevo con su prueba de contraste.

### 1.1 Qué pasa de la landing al POS

| De la landing | En el POS |
|---|---|
| **Paleta** (15 tokens) | La misma, copiada literal (§2.1). Sin un solo tono más. |
| **Telón con letrero coral** | Barra superior y pantalla de login en `telon`. La marca en Cinzel `letrero` (6,19), con la R de Cinzel Decorative. |
| **`.franja`** | Una sola vez, pegada bajo la barra (dentro del `<nav>` sticky) y arriba del login. Nunca dentro de listas ni zonas de trabajo. |
| **Arroz y papel** | Fondo `arroz` y tarjetas `papel` con borde `linea` de 1 px, radio .75rem y `--shadow-sombra`. |
| **Cinzel** | Solo en marca, títulos de vista, de panel y de diálogo, categorías y eyebrow. **Nunca** en números de mesa, precios, totales, cantidades, nombres de producto ni botones. |
| **Archivo** | Texto, botones (600, sin mayúsculas ni tracking), nombres, precios y totales con `tabular-nums`. |
| **Botón principal** | `letrero` con texto `telon` (6,19). **Uno por pantalla.** El resto va en `.btn-secondary` (linea), `.btn-telon` o `.btn-peligro`. |
| **Selección activa** | `telon` relleno con texto `arroz` (16,72), como `.tab-on` (`carta-menu.css:36`). Vale para variante elegida, mesa ocupada y modo «cobro por partes». |
| **Estados** | `.badge-turquesa` (hecho o respaldado, 5,27), `.badge-maiz` (atención, 9,22), `.badge-barro` (error o bloqueo, 6,65) y `.badge` neutro (6,05). |
| **Foco** | `outline: 2px solid` `barro` sobre claro (6,65 / 7,45) y `maiz` sobre telon (9,22), con `outline-offset: 2px`. |
| **Diálogo** | Papel, radio 1.15rem, sombra de diálogo, velo `telon` al 60 % **sin blur**. Hoja inferior por debajo de 768 px (§0.11). |

### 1.2 Cómo se adapta a una herramienta táctil de uso diario

- **Lectura en tablet y escritorio, a distancia de brazo (60–70 cm).** En el teléfono se lee a 30–40 cm y manda la escala de §0.3.

  | Elemento | Tamaño |
  |---|---|
  | Texto de cuerpo | 16 px |
  | Texto secundario | 14 px |
  | Mínimo absoluto (etiquetas y eyebrow) | 12 px |
  | Nombre de producto y precio en lista | 16 px |
  | Total | 32 px, Archivo 700 |
  | Número de mesa | 44 px, Archivo 700 |
  | Botones | 16 px, 600 |
  | Links del nav | 15 px, 600 |

- **Objetivos táctiles:**
  - Todo control mide **≥ 44×44 px** por defecto, no solo con `pointer:coarse`: el arnés no emula táctil, y los celulares de los meseros (y las tablets) sí lo son.
  - Las acciones principales miden 52–56 px.
  - El stepper de cantidad es de 44 px.
  - La fila de producto mide ≥ 56 px y se toca entera (ya tiene `@click`).
  - La tarjeta de mesa mide ≥ 120 px desde 768, y ≥ 100 px de alto en teléfono (§0.5).
- **Densidad:**
  - Más compacta que la landing. Vistas `py-6`, cabecera `mb-6` (no `mb-10`) y sin `.seccion`.
  - Tarjetas `p-4` o `p-5`, filas de lista `px-4 py-3`, gap de grilla 16 px.
  - En teléfono, más compacta aún: §0.3.
- **Velocidad:**
  - Respuesta táctil en `:active`: `scale(.985)` en botones y `.97` en chips. Transiciones de color de .15 s y de transform de .1 s.
  - La entrada de vista es opacidad en 120 ms, sin desplazamiento.
  - Nada infinito: se quita el pulso de presencia de 2,4 s.
  - `prefers-reduced-motion` global, como `base.css:138-149`.
- **El hover no es señal.** Todo estado se ve sin puntero: seleccionado explícito (`.sel`, `.active`, `.ocupada`) y `:active`. El hover existe solo como cortesía, sin `translateY`.
- **Compatibilidad con tablets viejas.** En `pos.html` no se usa:
  - `color-mix()` (pide Safari 16.2).
  - `rgb(from …)` (pide Safari 18).
  - `:has()`.
  - `text-wrap: balance`.
  - `dvh` sin un `vh` antes como respaldo.

  Los derivados van como hex o `rgba()` literal, calculados con la fórmula y documentados (§2.1). Para los celulares de gama media rige además §0.2.5.

### 1.3 Qué NO se lleva

- **De la landing:**
  - Animaciones de entrada: `data-aparecer` (.6 s), `.hero-entra`, `.reveal`, shimmer y `cargandoPulso`.
  - Fotos, friso, video y `.pared` con grano `feTurbulence` y `mix-blend`.
  - `--shadow-relieve`, `scroll-snap` y `scroll-behavior: smooth`.
  - `backdrop-filter` en barras y velos.
  - El `.rotulo` gigante y el `.rotulo-sub` fuera del login.
  - La franja más de una vez.
  - Coral en más de una acción por pantalla.
  - Texto con transparencia: `opacity:.7` en texto, `text-*/70`.
- **De la v1 del POS (sale todo):**
  - Fuentes Cormorant Garamond y Jost.
  - Itálicas (`.text-accent`, `.ticket-footer`).
  - El amanecer (`radial-gradient`) y el grano de `body::before/::after`.
  - El arco de templo (`--r-arch`), el RitualMark (SVG de tres barras), la `.rule-ritual` y los botones en mayúsculas con tracking .14em.
  - El oro como color de texto, el filo dorado `rgba(212,179,106,…)`, los brillos (`--shadow-glow-*`) y los radios de 3 a 6 px.
- **Emojis en la UI:** 🗳️ 📅 ✍️ en el menú semanal y 🍽️🥣🍚🥗🥤 en las etiquetas del modal de menú. Se reemplazan por íconos Lucide o se quitan.

---

## 2. Tokens

### 2.1 Bloque de tokens de `pos.html` (lo escribe la base)

```css
:root {
  /* Los 15 tokens: copia LITERAL de assets/css/base.css:27-71 (scripts/pruebas/pos-visual.test.mjs los compara). */
  --color-telon:#0A1112; --color-arroz:#F4F0E3; --color-papel:#FFFDF7; --color-linea:#D9D3BF;
  --color-apoyo:#4F5D59; --color-ceniza:#A49F86; --color-pared:#CE8965; --color-selva:#2E5B57;
  --color-letrero:#ED6B50; --color-letrero-claro:#F4846B; --color-maiz:#E9A91F; --color-barro:#8A3D22;
  --color-turquesa:#2A738A; --color-naranja:#C5571A; --color-oro:#B39464;
  --font-display:'Cinzel', Georgia, serif;
  --font-sans:'Archivo', system-ui, sans-serif;
  --font-r:'Cinzel Decorative', 'Cinzel', Georgia, serif;          /* solo ::first-letter de la marca */
  --shadow-sombra:0 1px 2px rgb(10 17 18 / .05), 0 6px 20px -12px rgb(10 17 18 / .22);

  /* Derivados del POS: valores literales calculados desde los 15 (NO son tokens nuevos). */
  --pos-velo: rgba(10,17,18,.6);                 /* fondo del modal (landing.css:137) */
  --pos-borde-telon: rgba(244,240,227,.15);      /* divisor sobre telon, 1,46, decorativo */
  --pos-borde-telon-control: rgba(244,240,227,.25); /* .btn-icon sobre telon, 2,08; lo identifica el ícono arroz */
  --pos-borde-telon-fuerte: rgba(244,240,227,.55);  /* contorno de control sobre telon, 5,62 */
  --pos-telon-elevado: #1D2323;                  /* arroz 8 % sobre telon: arroz 13,99 · ceniza 5,99 · maiz 7,71 · letrero 5,18 */
  --pos-telon-hover: #2D3231;                    /* telon 85 % + arroz: arroz 11,43 (hover de .btn-telon) */
  --boton-primario-sombra: 0 8px 20px -10px rgba(196,62,38,.55);   /* era --pos-sombra-letrero (letrero al 55 %); ver §7.3 */
  --pos-sombra-dialogo: 0 1px 2px rgb(10 17 18 / .05), 0 30px 70px -25px rgba(10,17,18,.4);
  --pos-r-boton:.5rem; --pos-r-campo:.65rem; --pos-r-tarjeta:.75rem; --pos-r-dialogo:1.15rem;
  --pos-tactil:2.75rem; --pos-tactil-comodo:3rem; --pos-boton-alto:3.25rem; --pos-boton-lg:3.5rem;
  --pos-dur:.15s; --pos-dur-press:.1s;
}
```

**Pares que usa el POS, todos medidos (WCAG 2.x):**
- **Medidos en `identidad-visual.md` §3.1:** telon/arroz 16,72 · telon/papel 18,74 · apoyo/arroz 6,05 · apoyo/papel 6,79 · barro/arroz 6,65 · barro/papel 7,45 · turquesa/arroz 4,70 · turquesa/papel 5,27 · letrero relleno + telon 6,19 · letrero-claro + telon 7,59 · maiz relleno + telon 9,22 · barro relleno + arroz 6,65 · turquesa relleno + papel 5,27 · telon relleno + arroz 16,72 · sobre telon: arroz 16,72, ceniza 7,15, letrero 6,19, maiz 9,22.
- **Nuevos de esta spec** (calculados con `$S/contrastes-spec.mjs`):
  - **Deshabilitado:** `apoyo` sobre `linea` = **4,61** (≥ 4,5, sin opacidad).
  - **No-texto sobre telon:** `turquesa` 3,56 (punto «en línea»).

**Prohibidos que el POS tiene a mano y no debe usar:**
- `letrero` como texto sobre claro (3,03).
- `maiz` sobre claro, ni como relleno de un punto (2,03).
- `ceniza` sobre claro (2,62).
- `oro` como texto.
- `barro`, `turquesa` y `apoyo` como texto sobre telon (2,52 / 3,56 / 2,76).

### 2.2 Tipografía y escala

- **El `<link>` de fuentes** es el mismo de la landing, byte a byte: `index.html:54-60`.
  - Dos `preconnect`.
  - `Cinzel:wght@700&family=Archivo:wght@400..700`.
  - `Cinzel+Decorative:wght@700&text=R`.
  - El `preconnect` a `cdn.jsdelivr.net` se queda. (Se quitó el 2026-10-01: ver §0.15.)
- **Sale el `<link>` de** `pos.html:19-21` (Cinzel 400–700, Cormorant y Jost).
- **Cinzel solo trae el peso 700.** Las utilidades `font-semibold` sobre Cinzel caen en 700, y está bien.

| Nivel | Receta | Clase |
|---|---|---|
| Marca (nav) | Cinzel 700, 1.25rem, mayúsculas, `.02em`, `letrero`, R con `--font-r` | `.brand-word` |
| Marca (login) | `.rotulo` con `--rotulo: 2.75rem` y `.rotulo-sub` | `.rotulo`, `.rotulo-sub` |
| Título de vista | Cinzel 700, `clamp(1.5rem, 1.1rem + 1.2vw, 2rem)/1.1`, telon | `.section-head > h1/h2`, `h1.font-display`, `.titulo-vista` |
| Título de panel | Cinzel 700, 1.125rem/1.2, telon | `h2.font-display`, `.titulo-panel` |
| Título de diálogo | Cinzel 700, 1.25rem/1.2 | `.modal-header h2` |
| Categoría (orden) | Cinzel 700, 1rem, telon, ícono de color de `catIcono()` | `.menu-category-title` |
| Eyebrow | Cinzel 700, .75rem, `.24em`, mayúsculas, `var(--eyebrow, barro)` | `.eyebrow` |
| Etiqueta / rótulo de dato | Archivo 600, .75rem, mayúsculas, `.025em`, apoyo | `.text-label`, `label.field-label`, `.stat-label` |
| Texto | Archivo 400, 1rem/1.5 | `body` |
| Secundario | Archivo 400, .875rem/1.45, apoyo | `.text-fine` |
| Bajada de vista y estados vacíos | Archivo 400, 1rem, apoyo, **sin itálica** | `.text-accent` |
| Nombre de producto | Archivo 500, 1rem/1.3, telon | `.menu-item-name` |
| Precio en lista | Archivo 600, 1rem, tabular, telon | `.menu-item-price`, `.importe` |
| Total | Archivo 700, 2rem/1.1, tabular, telon | `.total-grande` |
| KPI | Archivo 700, 2rem (principal 2.25rem), tabular | `.stat-value` |
| Número de mesa | Archivo 700, 2.75rem, tabular | `.mesa-num` |
| «Mesa 3» de la orden | Archivo 700, 1.5rem, telon | `.titulo-orden` |

En teléfono rige la escala de §0.3.

### 2.3 Mapa de lo viejo a lo nuevo (los nombres viejos quedan como alias durante la transición)

**Regla:** la base **conserva como alias todo nombre v1 que el marcado o el JS todavía referencian**, y lo remapea a los tokens. Así cada parte migra en paralelo sin romper a las demás.

- **Qué referencian hoy el marcado y el JS:**
  - `--border-hairline`, `--accent-primary`, `--amber`, `--ember`, `--text-body`, `--border-strong`, `--ink-5`, `--text-muted`, `--surface-card`, `--coral-300`, `--r-lg`, `--surface-raised`, `--text-display`, `--teal`, `--parch-d`, `--coral-500`, `--turquesa-500`, `--text-on-coral`, `--ink-3`, `--ink-7`, `--coral-700`, `--amber-f`, `--state-warning`, `--shadow-raised`, `--ember-f`, `--bg-canvas-deep`, `--r-arch`, `--text-link` y `--amber-d`.
  - El JS (`catIcono`, `pos.html:2160-2168`) usa `--ember`, `--teal`, `--amber` y `--ink-5`.
- **Al final de la base**, se borra todo alias que ya no tenga un `var(--x)` en ningún lado. Eso cubre las escalas `obsidiana`, `selva`, `carmesi`, `anil` y `piedra`, `--fs-*`, `--ls-*`, `--glow-*`, `--shadow-glow-*`, etc.
- **Cuando las cuatro partes migraron su marcado**, la integración borra los alias que quedaron sin uso.

**Alias con contexto.** Un mismo alias se usa sobre claro y sobre telon: el nav usa `--text-muted`, `--border-hairline` y `--coral-300`.
- Va un remapeo en `:root` (claro) y otro bajo `.sobre-telon, .nav-bar` (oscuro), con el mismo patrón de `--foco` de `componentes.css:311`.
- `.nav-bar` va en el selector porque el `<nav>` todavía no tiene `.sobre-telon` hasta que llegue la parte 1.

| Alias v1 | `:root` (claro) | `.sobre-telon, .nav-bar` | Para qué se usa |
|---|---|---|---|
| `--bg-canvas` | `arroz` #F4F0E3 | — | fondo |
| `--bg-canvas-deep` | `telon` #0A1112 | — | fondo del login |
| `--surface-card`, `--surface-lino`, `--surface-inset` | `papel` #FFFDF7 | `--pos-telon-elevado` | tarjetas, ticket, campos |
| `--surface-raised` | `papel` | `--pos-telon-elevado` | modal, panel NFC, barra de cobro |
| `--text-heading`, `--text-body`, `--ink-7`, `--ink`, `--text-on-light` | `telon` | `arroz` | texto |
| `--text-muted`, `--ink-5`, `--text-faint`, `--ink-3` | `apoyo` #4F5D59 | `ceniza` #A49F86 | secundario (sin tercer nivel: `linea` no es texto) |
| `--text-display`, `--amber`, `--amber-d` | `telon` | `arroz` | precios y totales (antes oro) |
| `--amber-f` | `maiz` #E9A91F | — | fondo de aviso (texto `--amber` = telon: 9,22) |
| `--text-on-coral` | `papel` (`--boton-primario-texto`) | `papel` | texto sobre el coral profundo del botón primario (claro, 5,08; §7.3). **Antes** era `telon` «nunca claro» sobre `letrero`; las insignias y alertas, que siguen en `letrero`, llevan `telon` directo |
| `--accent-primary`, `--ember-fill`, `--coral-500` | `letrero` #ED6B50 | `letrero` | relleno de la acción |
| `--accent-primary-hover` | `letrero-claro` #F4846B | — | |
| `--ember`, `--coral-300`, `--coral-700`, `--state-danger` | `barro` #8A3D22 | `letrero` | texto o ícono de peligro |
| `--ember-f` | `arroz` | — | fondo de aviso (texto `--ember` = barro: 6,65) |
| `--teal`, `--turquesa-500`, `--accent-secondary`, `--state-success` | `turquesa` #2A738A | `turquesa` (solo no-texto) | estado e íconos |
| `--accent-gold` | `barro` | `maiz` | eyebrows y etiquetas v1 |
| `--state-warning` | `maiz` | `maiz` | punto «conectando» (sobre telon) |
| `--text-link` | `barro` | `maiz` | enlaces |
| `--border-hairline`, `--parch-d` | `linea` #D9D3BF | `--pos-borde-telon` | bordes y divisores |
| `--border-strong` | `apoyo` | `--pos-borde-telon-fuerte` | contorno que identifica un control |
| `--border-on-light` | `linea` | — | divisores del ticket |
| `--shadow-card` | `--shadow-sombra` | — | |
| `--shadow-raised`, `--shadow-modal` | `--pos-sombra-dialogo` | — | |
| `--r-lg` | `.75rem` | — | |
| `--r-md` | `.5rem` | — | |
| `--r-arch` | `1.15rem` | — | tarjeta del login hasta que la rehaga la parte 1 |
| `--glow-*`, `--shadow-glow-*`, `--inset-well`, `--blur-veil` | se borran (sin uso tras reescribir el CSS) | | |

**`tailwind.config` (reemplaza `pos.html:35-66`):**

```js
tailwind.config = {
  theme: {
    // Igual que `--color-*: initial` de base.css: solo los 15 tokens compilan
    // (verificado en 4da9030: el marcado no usa ninguna utilidad de color).
    colors: {
      transparent: 'transparent', current: 'currentColor', inherit: 'inherit',
      telon: '#0A1112', arroz: '#F4F0E3', papel: '#FFFDF7', linea: '#D9D3BF', apoyo: '#4F5D59',
      ceniza: '#A49F86', pared: '#CE8965', selva: '#2E5B57', letrero: '#ED6B50', 'letrero-claro': '#F4846B',
      maiz: '#E9A91F', barro: '#8A3D22', turquesa: '#2A738A', naranja: '#C5571A', oro: '#B39464',
    },
    extend: {
      fontFamily: { display: ['Cinzel', 'Georgia', 'serif'], sans: ['Archivo', 'system-ui', 'sans-serif'],
                    r: ['"Cinzel Decorative"', 'Cinzel', 'Georgia', 'serif'] },
      borderColor: { DEFAULT: '#D9D3BF' },   // sin esto, `border` a secas pasaría a currentColor
    },
  },
};
```

- **`borderRadius` se borra entero.** Los valores por defecto de Tailwind v3 (`lg` .5rem, `xl` .75rem, `full`) son los mismos de la landing.
- **`fontFamily` va en `extend`.** Así se conserva `mono` para el `<code>` del enlace NFC.

---

## 3. Recetas de componentes

**Regla de cascada (medida).** El Tailwind CDN se inyecta **después** del `<style>` propio.
- Una utilidad del marcado (`py-1.5`, `px-3`, `rounded-lg`, `text-base`) **gana** a una clase de componente que tenga la misma especificidad.
- El preflight gana a los selectores de elemento: `h1 { font-weight }` pierde.
- **Por lo tanto:**
  - La base estila con clases o con selectores de especificidad ≥ (0,1,1): `.section-head > h1`, `h2.font-display`, `.modal-header h2`.
  - Al aplicar una receta, cada parte **quita del marcado** las utilidades de padding, radio, tamaño de letra y peso que la pisan.
  - Cada parte quita también los `style=` con colores o tamaños.

### 3.1 Base, foco y contexto

```css
html { color-scheme: light; }
body { background: var(--color-arroz); color: var(--color-telon); font-family: var(--font-sans);
       font-size: 1rem; line-height: 1.5; -webkit-font-smoothing: antialiased; min-height: 100vh; overflow-x: hidden; }
/* body::before y body::after (amanecer y grano) se BORRAN. */
::selection { background: var(--color-letrero); color: var(--color-telon); }
:focus-visible { outline: 2px solid var(--foco, var(--color-barro)); outline-offset: 2px; }
.sobre-telon, .nav-bar { --foco: var(--color-maiz); --eyebrow: var(--color-maiz); --rombo: var(--color-maiz);
                         color-scheme: dark; /* + los alias oscuros de §2.3 */ }
.fade-enter { animation: posAparecer .12s ease-out; }
@keyframes posAparecer { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms !important;
  animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }
```

**Tipografía compartida (§2.2):**
- `.rule-ritual { display: none }`. Cada parte borra además el `<span class="rule-ritual">` de su marcado.
- `.text-accent` pierde Cormorant y la itálica.
- **Motivos**, copiados de `componentes.css`:
  - `.franja` (244-251): fija en 12 px. Es una desviación del POS: no sube a 16 px desde `lg`, para no comer alto de la tablet.
  - `.rotulo`, `.rotulo-sub` (263-285), `.rombo` (290-296) y `.monograma` (209-222, sin la regla `:has`).
  - Ninguno de los cuatro usa `rgb(from)`.

### 3.2 Botones

| Clase | Fondo / texto / borde | Uso |
|---|---|---|
| `.btn-primary` | **desde 2026-10-01 (§7.3):** `--boton-primario-fondo` (coral profundo `#C43E26`) / `--boton-primario-texto` (`papel`, 5,08), 700, borde interior claro. Hover `--boton-primario-fondo-hover` (5,70), active `…-activo` (6,93). *(Antes: `letrero` / `telon`, 6,19, que se veía apagado.)* | **la** acción de la pantalla: Entrar, Generar ticket y cobrar, Imprimir, Cerrar día, Nuevo producto, Guardar/Sí del diálogo |
| `.btn-secondary` | `papel` / `telon` / `linea`. Hover fondo `arroz`, borde `apoyo` | resto de acciones |
| `.btn-telon` (nuevo) | `telon` / `arroz` (16,72). Hover `--pos-telon-hover` (11,43) | acción fuerte que no es la principal: «Recibir un abono» (el «Facturar» de la cabecera se quitó, §7.2) |
| `.btn-teal` | `papel` / `turquesa` (5,27) / 1.5px `turquesa` | alternativa: «Editar sin mesa» |
| `.btn-peligro` (nuevo) | `papel` / `barro` (7,45) / `linea`. Hover fondo `arroz` | Eliminar, Rotar, Liberar mesa |
| `.btn-enlace` (nuevo) | sin fondo; `barro`, 600, .9375rem, subrayado (offset 3px), `min-height: 2.75rem`, `padding: 0 .25rem` | reemplaza a `.text-fine.underline`: Asignar/Reasignar, Ocultar/Mostrar, Eliminar, Reintentar respaldo, + Agregar (el «Editar» del cierre pasó a `.btn-discreto`, §7.4) |
| `.btn-icon` | círculo de 2.75rem, `papel`, borde `linea`, ícono `telon`. Bajo `.sobre-telon` o `.nav-bar`: transparente, borde `--pos-borde-telon-control` e ícono `arroz` | volver, cerrar, flechas de semana, editar o borrar en el historial |
| `.btn-icon-peligro` (nuevo) | modificador: ícono `barro` | papelera |
| `.btn-sm` / `.btn-lg` (nuevos) | `min-height` de 2.75rem con `padding .5rem .875rem` y letra .9375rem / `min-height` de 3.5rem y letra 1.0625rem | reemplazan los `style="font-size:.82rem;padding:8px 12px"`, `py-1.5 px-3`, `py-2 px-3` y `py-4` |

```css
:is(.btn-primary,.btn-secondary,.btn-teal,.btn-telon,.btn-peligro) {
  display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
  min-height: var(--pos-boton-alto); padding: .75rem 1.25rem; border: 1px solid transparent; border-radius: var(--pos-r-boton);
  font: 600 1rem/1.2 var(--font-sans); letter-spacing: normal; text-transform: none; white-space: nowrap; cursor: pointer;
  transition: background-color var(--pos-dur), border-color var(--pos-dur), color var(--pos-dur), box-shadow var(--pos-dur), transform var(--pos-dur-press); }
:is(.btn-primary,.btn-secondary,.btn-teal,.btn-telon,.btn-peligro):active:not(:disabled) { transform: scale(.985); }
:is(.btn-primary,.btn-secondary,.btn-teal,.btn-telon,.btn-peligro):disabled {
  background: var(--color-linea); color: var(--color-apoyo); border-color: var(--color-linea);   /* 4,61; sin opacidad */
  box-shadow: none; cursor: not-allowed; transform: none; }
```

- **El deshabilitado nunca usa `opacity`.** La parte 3 cambia el string del `:class` de «Cerrar día» de `'opacity-40 cursor-not-allowed'` a `'cursor-not-allowed'`. La condición no se toca.
- **El `:style` de toggles visuales** (`pos.html:3328` cobro por partes y `3341` NFC): se cambian solo los valores dentro del literal; la condición queda igual. Activo:
  - Cobro por partes: `background:var(--color-telon);color:var(--color-arroz);border-color:var(--color-telon)`.
  - NFC: `background:var(--color-arroz);border-color:var(--color-apoyo)`.

### 3.3 Tarjeta de mesa por estado (clases `.mesa-card` + `mesa.estado`; la base las pinta sin tocar el marcado)

| Estado | Tarjeta | Número `.mesa-num` | `.mesa-badge` | Extras |
|---|---|---|---|---|
| `libre` | `papel`, borde 1px `linea`, radio .75rem, `--shadow-sombra`. Hover: borde `apoyo` | `telon` (18,74) | `.badge` neutro: arroz, linea, apoyo (6,05) | puntos de capacidad de 6 px en `apoyo` |
| `ocupada` | `telon`, borde `telon`, filete superior de 4 px en `letrero` (`box-shadow: inset 0 4px 0 var(--color-letrero), var(--shadow-sombra)`) | `letrero` (6,19), el letrero que se enciende | fondo transparente, borde `--pos-borde-telon-fuerte` (5,62), texto `arroz` (16,72) | `.mesa-total` en `arroz` 600 1.0625rem tabular; `.seat-dot.filled` en `maiz` (9,22) |

- **Común:**
  - Desde 768: `aspect-ratio: 1` y `min-height: 7.5rem`. Siempre `:active scale(.985)`, sin `translateY`.
  - El número va en Archivo 700 2.75rem tabular desde 768. En teléfono, la tarjeta es la compacta de §0.5: sin `aspect-ratio`, 6.25rem de alto y número de 2rem.
- **Lo que sale:** `::before` (regla de 3 px) y los `radial-gradient`.
- **Presencia** (`.mesa-presence`):
  - Disco de 1.75rem en `maiz` con ícono `telon` (9,22).
  - Anillo `box-shadow: 0 0 0 2px var(--color-telon)`. Se lee sobre papel (18,74) y sobre telon (el disco maiz da 9,22).
  - **Sin pulso**: se borra `presencePulse` y `::after`.
- **Leyenda** (parte 1):
  - Libre: un cuadrado de 14 px en `papel` con borde 1.5px `apoyo`.
  - Ocupada: un cuadrado `telon` con 3 px superiores en `letrero`.
  - El texto va en Archivo .875rem 600 `telon`, en lugar de `eyebrow` con color en línea.

### 3.4 Chips de categoría y de variante

- **Categoría del panel de orden** (`.menu-category-title`):
  - `position: sticky; top: 0; z-index: 1` desde 1024, dentro de `.menu-scroll`. Por debajo es estático (§0.6).
  - Fondo `papel`, `border-top: 1px linea`, `padding: .875rem 1rem .5rem`.
  - Cinzel 700 1rem `telon`, sin mayúsculas forzadas ni tracking.
  - El ícono lo colorea `catIcono()` vía alias: `--ember` → barro 7,45, `--teal` → turquesa 5,27, `--amber` → telon y `--ink-5` → apoyo. Todos van sobre papel. **El JS no cambia.**
- **Variante** (`.opt-chip`, `.sel`):
  - Píldora 999px, `min-height: 3rem`, `padding: .625rem 1.125rem`, Archivo 600 1rem.
  - Fondo `papel`, borde 1px `linea`, texto `telon`. Hover: borde `apoyo` y fondo `arroz`. `:active scale(.97)`.
  - `.sel`: fondo `telon`, texto `arroz` (16,72), `box-shadow: 0 0 0 1px telon`. Es el criterio de `.tab-on`; **nunca coral**.
- **Estado** (`.chip` + `green`/`red`, clases que pone el JS en `pos.html:3786` y `3904`; la base las pinta):
  - `.chip` = `.badge` neutro.
  - `.chip.green` = `.badge-turquesa`: «Facturada», «Respaldado», opción con votación.
  - `.chip.red` = `.badge-barro`: «Sin respaldo», «Oculto».
  - Archivo .75rem 600, sin mayúsculas. Agrega `.badge`, `.badge-maiz`, `.badge-barro` y `.badge-turquesa` (`componentes.css:40-61`).

### 3.5 Encabezados de vista

- **Estructura:**
  ```html
  <div class="section-head">
    <span class="eyebrow">…</span>
    <h1>…</h1>
    <p class="text-accent mt-1">…</p>
  </div>
  ```
  - Sin `rule-ritual`.
  - Eyebrow `barro` sobre arroz (6,65).
  - El título es Cinzel (§2.2) por el selector `.section-head > h1, .section-head > h2`. La base lo pinta sin tocar el marcado.
  - Contenedor `max-w-6xl` o `max-w-4xl`, `mx-auto px-4 sm:px-6 py-6`. Cabecera `mb-6`.
- **Orden:**
  - Eyebrow «Cuenta abierta».
  - «Mesa N» en `.titulo-orden` (Archivo, porque es un dato).
  - Bajada `.text-fine`.
- **Ticket:** `h1.font-display` → título de vista.

### 3.6 Campos

```css
.field { width: 100%; min-height: var(--pos-tactil-comodo); padding: .625rem .875rem; background: var(--color-papel);
         color: var(--color-telon); border: 1.5px solid var(--color-apoyo); border-radius: var(--pos-r-campo);   /* borde 6,79 */
         font: 400 1rem/1.4 var(--font-sans); box-shadow: none; transition: border-color var(--pos-dur); }
.field::placeholder { color: var(--color-apoyo); opacity: 1; }
.field:focus { border-color: var(--color-barro); outline: 2px solid var(--color-barro); outline-offset: 1px; }
select.field option { background: var(--color-papel); color: var(--color-telon); }
label.field-label { display: block; margin-bottom: .375rem; /* + receta de .text-label */ }
```

- **Campos derivados:**
  - `.field-num` (nueva): `width: 5rem; text-align: center; tabular-nums`. Es el «Dividir entre» del modal de cobro; reemplaza `style="width:64px;padding:6px 8px"`.
  - Buscador: `.field` con `padding-left: 2.5rem` e ícono `apoyo`.
- **El foco lleva outline y borde.** En un POS con teclado físico ocasional, el borde solo de la landing no basta.

### 3.7 Modales

```css
.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
                  padding: 1rem; background: var(--pos-velo); }                       /* sin backdrop-filter */
.modal { width: 100%; max-width: 28rem; max-height: 90vh; overflow-y: auto; color-scheme: light;
         background: var(--color-papel); color: var(--color-telon); border: 1px solid var(--color-linea);
         border-radius: var(--pos-r-dialogo); box-shadow: var(--pos-sombra-dialogo); }
.modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: .75rem; padding: 1.25rem 1.25rem .75rem; }
.modal-header h2 { font: 700 1.25rem/1.2 var(--font-display); color: var(--color-telon); }  /* gana a .text-base */
.modal-body { padding: .5rem 1.25rem 1.25rem; }
.modal-footer { display: flex; gap: .75rem; justify-content: flex-end; padding: 1rem 1.25rem; border-top: 1px solid var(--color-linea); background: var(--color-papel); }
```

- **Por debajo de 768 px (`screen`):** hoja inferior según §0.11. La escribe la base móvil.
- **Pie:** Cancelar en `.btn-secondary` y la acción en `.btn-primary`. «Editar sin mesa» va en `.btn-teal`.
- **Texto del cuerpo:** `.texto-dialogo` (1rem/1.5 telon) reemplaza `style="color:var(--ink-7);font-size:0.9rem;line-height:1.6"`.
  - Montos en `.importe`.
  - Advertencia en `.texto-peligro` (barro 600).
  - Reparto en `.texto-estado` (turquesa 600, 5,27).

### 3.8 Avisos: presencia, edición, pre-cuenta, bloqueo y sync

| Clase (nueva) | Fondo / texto | Par | Dónde |
|---|---|---|---|
| `.aviso` | `papel`, borde 1px `linea` / `telon`, ícono `barro` | 18,74 · ícono 7,45 | cuenta reabierta (orden), panel NFC |
| `.aviso-atencion` | `maiz` / `telon` | 9,22 | otro dispositivo tiene la mesa, edición sin mesa, pre-cuenta |
| `.aviso-peligro` | `barro` / `arroz` | 6,65 | bloqueo del cierre por mesas abiertas |

- **Forma común:** `display: flex; align-items: flex-start; gap: .625rem; padding: .75rem 1rem; border-radius: .75rem; font: 500 .9375rem/1.45`.
- **Al aplicarla:** se quitan `style="background:…;color:…"` y las utilidades `px-4 py-2.5 rounded-lg`. Los textos no cambian.
- **Sync en el nav** (botón «N sin sincronizar», `pos.html:3152-3160`):
  - Clase local `.nav-pill-aviso` (parte 1): relleno `maiz`, texto e ícono `telon` (9,22), `min-height: 2.75rem`, píldora.
  - Reemplaza `style="background:rgba(181,75,23,.20)…"` y los `color:var(--coral-300)`.
- **Conexión** (`.status-dot`, clases del JS):
  - `ok` en `turquesa`, no-texto sobre telon (3,56).
  - `wait` en `maiz` (9,22).
  - `off` en `ceniza` (7,15), como **anillo hueco** (revisión móvil: hasta 1439 px es la única señal y no puede depender solo del color). `ok` = punto lleno, `wait` = lleno con halo, `off` = hueco. El texto («En línea», «Offline») va `sr-only` bajo 1440 px.
  - Miden 10 px.
- **Chips de respaldo del cierre:** ver §3.4.

### 3.9 Totales y precios

- **Precio en lista:** `.menu-item-price` (Archivo 600 1rem tabular `telon`).
- **Importe de línea:** `.importe` con `min-width: 5rem; text-align: right`. Reemplaza `style="color:var(--text-display);min-width:64px…"`.
- **Total de la orden:** `.text-label` «Total» y debajo o al lado `.total-grande` (Archivo 700 2rem tabular `telon`).
  - **Nunca** Cinzel, **nunca** oro ni coral como texto.
  - Debajo, `.btn-primary.btn-lg.w-full` «Generar ticket y cobrar». Eso rige desde 1024; por debajo, el total y el botón van en la barra de cobro fija (§0.6).
- **Unidad o nota:** `.text-fine tabular`.
- **Nota de variante** (`item.nota`): clase local `.nota-item` (parte 2) en píldora `arroz`, borde `linea`, texto `telon` .8125rem 600 (16,72).
- **KPIs:** `.stat-card` (papel, como `.card`, `padding 1rem 1.25rem`) con `.stat-label` y `.stat-value`.
  - `.gold` y `.ink` quedan las dos en `telon`.
  - Sparkline con `stroke="var(--color-turquesa)"`, no-texto 5,27.

### 3.10 Ticket en pantalla (`.ticket*`)

- **Hoja:** papel sobre arroz. `max-width: 400px`, `padding: 2rem 1.5rem`, borde 1px `linea`, radio .75rem, `--pos-sombra-dialogo`.
- **`.ticket-brand`:** Cinzel 700 1.625rem, mayúsculas, `.02em`, `telon`, con `::first-letter { font-family: var(--font-r) }`. **No `letrero`**: sobre claro da 3,03.
- **`.ticket-sub`:** Cinzel 700 .75rem, `.42em`, `apoyo`. Es el eco de `.rotulo-sub`.
- **`.ticket-meta`:**
  - Etiquetas en `apoyo` y valores en `telon` tabular.
  - Divisores `1px dashed linea` (decorativos).
- **`.ticket-line`:**
  - `.name` en Archivo 500 1rem.
  - `.opt` y `.unit` en .8125rem `apoyo`. Se quita el `style="…font-size:10px;color:#555…"` de `pos.html:3595`.
  - `.price` en 600 tabular.
- **`.ticket-total`:** `.label` = `.text-label`; `.amount` = Archivo 700 1.75rem tabular `telon` (antes Cinzel coral-700).
- **`.ticket-footer`:** Archivo .875rem `apoyo`, **sin itálica**.
- **El RitualMark** (`pos.html:3559-3564` y `3105-3113`) se quita del marcado (parte 1). No tiene binding.
- **Ticket IMPRESO** (`@media print`, de la base):
  - Se conserva tal cual: blanco y negro, `#000`/`#fff`, Courier y 72 mm en `body.print-termico`.
  - **Tres agregados:**
    - `body.print-termico .ticket-brand::first-letter { font-family: inherit !important }`. El `*` de la regla térmica no alcanza al pseudo-elemento, y la R decorativa se colaría al papel.
    - `.franja { display: none !important }`.
    - `.chip, .badge { background: none !important; border: 1px solid #000 !important; color: #000 !important }`. Así el cierre en A4 se lee sin fondos.
  - Se mide con `ticket-impreso-302` y `cierre-impreso-794`.

### 3.11 Barra superior (`.nav-bar`, parte 1)

- **Teléfono: rige §0.4.** La barra superior se reduce y no es sticky, y los cuatro links van en una barra inferior fija. Lo que sigue rige desde 768.
- **Barra:** `telon`, sticky. Lleva `.sobre-telon` en el marcado.
- **Marca:** `img/logo-r.webp` de 36 px (`alt=""`) y `.brand-word` «Resplandor». En teléfono, el monograma de 32 px sin la palabra.
  - Pasa a `inline-block`: `::first-letter` no aplica a un contenedor `flex`.
  - Se le quitan las utilidades `flex items-center` del `<span>`.
- **`.nav-link`:**
  - Archivo 600 .9375rem sin mayúsculas, color `ceniza` (7,15), `min-height: 3rem`.
  - `.active`: texto `arroz` y `border-bottom: 3px solid letrero` (no-texto 6,19).
- **`.nav-pill`:** píldora con borde `--pos-borde-telon` y fondo transparente.
  - «Hoy» `.eyebrow` (maíz por contexto) y monto `arroz` tabular.
- **Salir:** `.btn-icon` de 44 px (sin el `style="width:30px;height:30px"`).
- **Debajo, dentro del `<nav>`:** `<div class="franja" aria-hidden="true"></div>`.
- **768 px (roto hoy):** los links ocupan 554 px en 365 px y el ícono recortado de «Cierre del día» es la «coma suelta».
  - De 768 a 1023 va en **dos filas**. Fila 1: marca y estado. Fila 2: los cuatro links en `grid grid-cols-4`, a lo ancho, sin scroll. Alto fijo `--pos-nav-alto` (7.25rem, §0.12). Por debajo de 768, la barra inferior de §0.4.
  - Una sola fila desde 1024 px, solo si cabe sin recorte medido. Si no cabe, pasan a `xl:` el nombre del usuario y el texto de conexión (hoy `md:inline` y `lg:inline`).
  - Solo cambian strings de clases (`md:` → `lg:` en `flex-nowrap`, `order-*`, `w-*`).

### 3.12 Login (parte 1)

- **Pantalla:** el contenedor `fixed inset-0` se queda, con su `x-show`. Lleva `.sobre-telon`, fondo `telon` y conserva solo `style="z-index:100"`.
- **Franja:** `.franja` absoluta arriba, `top-0 inset-x-0`.
- **Contenido centrado, sin tarjeta ni arco:**
  - El monograma, `img/logo-r.webp` de 72 px.
  - El eyebrow «Resplandor · POS», en maíz.
  - `.rotulo` «Resplandor» con `--rotulo: 2.75rem` y opcionalmente `.rotulo-sub` «Restaurante».
  - El párrafo en `text-ceniza` (7,15) sin itálica.
  - `.btn-primary.btn-lg.w-full` «Entrar con Google».

### 3.13 Orden en escritorio (parte 2; teléfono y tablet en §0.6)

- **Grilla:**
  - Hasta 1023 px, una columna con el esquema de teléfono: el pedido primero y la barra de cobro fija (§0.6). Desde `lg` queda `lg:grid-cols-5`, con menú en `lg:col-span-3` y pedido en `lg:col-span-2`.
  - Desde `lg`, la columna del pedido va `self-start` y `sticky`, con `top: var(--pos-nav-alto)`.
  - En la tablet vertical, lo que se ve sin bajar por toda la carta lo resuelve la barra de cobro (§0.6).
- **Lista de productos:**
  - Solo desde `lg`: `max-height: calc(100vh - var(--pos-nav-alto) - X)`, y después la misma con `100dvh`. El valor va en la clase local `.menu-scroll`. Por debajo de `lg`, sin scroll interno (§0.6).
- **`.menu-item`:**
  - `min-height: 3.5rem`, divisor `linea` entre filas, `:active` en fondo `arroz`.
  - `.menu-item-btn` es un círculo de 44 px, papel con borde `linea`. Pasa a `telon`/`arroz` en `:active` de la fila.
  - Sin el hover coral.
- **`.qty-btn`:** 44×44, radio .5rem, papel con borde `linea`, 1.25rem 600. En `:active` pasa a `telon`/`arroz`. `.qty-val` en 1.125rem 600 tabular.
- **Checkbox de «cobro por partes»:**
  - El propio `<input>` mide 44×44 con `appearance: none` y dibuja su casilla de 24 px (§0.6). No hay excepción al 44.
  - Antes decía «envuelto en un `<label>`». Eso movía el input fuera de su padre, y lo prohíbe §5.2.
- **Barra «N ítem(s) seleccionado(s)»:**
  - Barra `telon` `.sobre-telon`, con el texto en `arroz` tabular. Bajo 1024 va sticky arriba (§0.6).
  - Botón `.btn-primary.btn-sm`. Es el segundo coral, admitido solo mientras dura el modo cobro.
- **Cabecera:**
  - «Ítem manual» en `.btn-secondary` (en teléfono, `.btn-sm`).
  - ~~«Facturar» en `.btn-telon`~~ Quitado (§7.2). El coral es el del panel de total.
- **Fila de acciones:**
  - Cobrar por partes, Imprimir precuenta y Enlace NFC van en `.btn-secondary.btn-sm`.
  - Liberar mesa va en `.btn-peligro.btn-sm`.
  - En teléfono, la fila es una `.fila-acciones` que parte en líneas (§0.6).
- **Panel NFC:**
  - `.aviso`, con `<code>` en `font-mono text-sm` sobre `arroz`.
  - Copiar en `.btn-secondary.btn-sm` y Rotar en `.btn-peligro.btn-sm`.
  - Se quitan los `opacity:.7` de texto y se usa `.text-fine` en su lugar.

---

## 4. Fase BASE y partición

**Fases:** base (`b242a2b`, hecha) → base móvil (§0.12) → las cuatro partes (§4.2–§4.4, más §0.13) → integración.

### 4.1 Qué hace la base (una sola parte, en `tarea/pos-visual`; hecha en `b242a2b`)

0. **Capturas «antes» a 1024 px**, antes de tocar nada:
   ```
   PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH node scripts/capturas-pos.mjs $S/antes --cache $S/_cdn --anchos 1024
   ```
   Hoy solo hay 768 y 1440.
1. **`<head>`:**
   - `theme-color` pasa a `#0A1112` (`pos.html:10`) y se actualiza el comentario.
   - El bloque de fuentes de `index.html:54-60` reemplaza `pos.html:13-21`. Se conservaba el `preconnect` a jsdelivr (quitado el 2026-10-01: ver §0.15).
   - Se reemplaza `tailwind.config` (§2.3).
   - **No cambian:** `<title>`, `robots`, `description`, los cuatro `<script src>` ni su orden, ni nada sin canonical.
2. **`<style>`** (hoy 68-1643): se reescribe entero en este orden, con comentarios de sección.
   1. Tokens (§2.1).
   2. Alias v1 claros y oscuros (§2.3).
   3. Base, foco, reducción de movimiento y tipografía compartida (§2.2, §3.1).
   4. Motivos: `.franja`, `.rotulo`, `.rotulo-sub`, `.rombo` y `.monograma`.
   5. Componentes compartidos con su receta: `.card`, botones (§3.2), `.badge`/`.chip` (§3.4), `.aviso*` (§3.8), `.field` (§3.6), `.modal*` (§3.7), `.stat-*`, `.history-row`, `.menu-item-name`/`-price`, `.importe`, `.total-grande`, `.titulo-*`, `.texto-*`, scrollbar (thumb `linea`, 8 px) y `.fade-enter`.
   6. **Cuatro bloques de parte** con su marcador (§4.3). La base escribe adentro la receta de los componentes que solo usa esa parte:

      | Parte | Componentes | Hoy en |
      |---|---|---|
      | marco-salon-ticket | `.nav-bar`, `.brand-word`, `.nav-link`, `.no-scrollbar`, `.nav-pill`, `.status-dot`, `.mesa-*`, `.seat-dot*`, `.ticket*` | `pos.html:562-799`, `925-1064` |
      | orden | `.menu-category-title`, `.menu-item`, `.menu-item-btn`, `.order-item`, `.qty-*` | `801-923` |
      | cierre-y-menu | `.bento-kpis`, `.icon-badge` | `1104-1137` |
      | productos-y-modales | `.opt-chip` | `1238-1263` |

      Las reglas de esas clases que hoy están en los bloques `@media (max-width:640px)` y `(pointer:coarse)` (1550-1642) **se mudan al bloque de su parte**.
   7. `@media print` (1323-1548): la semántica intacta, más los tres agregados de §3.10.
   8. Responsive compartido de ≤640 px: solo `.field`, `.modal*`, botones del pie y `.stat-*`. El bloque `pointer:coarse` se borra, porque los tamaños por defecto ya son ≥ 44. La base móvil reescribe esta sección como «Teléfono compartido (< 768, screen)» (§0.12).
   9. Se borran los alias sin uso (§2.3).
3. **Marcado:** solo se insertan los marcadores de §4.3, en líneas propias.
   - No se cambia ni un atributo de las secciones.
   - Con los alias remapeados, las vistas ya se ven coherentes en claro, sin migrar.
4. **Docs, en el mismo commit:**
   - `docs/landing-y-agentes.md:154-156`: la viñeta pasa a decir esto: «El POS (`pos.html`) adopta esta identidad desde el 2026-09-30 (pedido de Yonatan). Copia los 15 tokens y la misma pareja de fuentes en su propio `<style>`, conserva su Tailwind CDN y no carga `resplandor.css`. Su contrato es `docs/pos-visual.md`.» En `:19` y `:41` se agrega «(su lado visual lo rige `docs/pos-visual.md`)».
   - `docs/identidad-visual.md:5, 15, 105, 641, 879`: una nota fechada que diga «2026-09-30: el POS adopta esta identidad, ver `docs/pos-visual.md`». La historia no se reescribe.
   - Comentarios de `assets/css/base.css:8-11` y `scripts/pruebas/contraste.test.mjs:14-16`: base.css sigue siendo la fuente; el POS copia sus 15 tokens y lo vigila `pos-visual.test.mjs`. Después se corre `node scripts/css.mjs --comprobar` (los comentarios no llegan al CSS minificado).
   - `README.md` §05 (129-146, hoy obsoleto: `--ember #B5341C`, Fraunces): se reemplaza por un puntero a `identidad-visual.md` y a este documento.
5. **Prueba nueva, estática:** `scripts/pruebas/pos-visual.test.mjs`. Tiene que pasar en el commit de la base. Verifica esto:
   - Los 15 `--color-*` del `:root` de `pos.html` son iguales a los de `base.css`.
   - Los colores de `tailwind.config` son exactamente esos 15, más `transparent`, `current` e `inherit`.
   - `theme-color` es `#0A1112`.
   - Están los dos `href` de fuentes de `index.html`.
   - No aparecen `Cormorant`, `Jost`, `radial-gradient`, `rgb(from` ni `color-mix(`.
   - No hay `backdrop-filter` distinto de `none`.

   Los emojis y los `style=` con hex se vigilan en la integración, cuando las partes ya terminaron.
6. **Commit de la base:** `docs/pos-visual.md` (este archivo), `pos.html`, los docs y la prueba. Nunca push.

### 4.2 Partición del marcado (rangos en `4da9030`)

Las líneas 3121-3124 (contenedor con sesión) y 4387-4389 (su cierre) son de la base y quedan congeladas. Ninguna parte toca `<head>`, `<script>` ni el CSS compartido, incluido el móvil de §0.12.

En `b242a2b` los rangos se corrieron: cada parte se ubica por sus marcadores (§4.3).

| Clave | Marcado en `4da9030` | CSS propio |
|---|---|---|
| `marco-salon-ticket` | login 3093-3120 · nav y mesas 3125-3288 · ticket 3533-3653 (313 líneas; 34 `style=`) | bloque `marco-salon-ticket` |
| `orden` | 3290-3531 (242 líneas; 46 `style=`) | bloque `orden` |
| `cierre-y-menu` | 3655-3967 (313 líneas; 40 `style=`) | bloque `cierre-y-menu` |
| `productos-y-modales` | 3969-4386 (418 líneas; 36 `style=`, 8 modales repetitivos) | bloque `productos-y-modales` |

**Clases compartidas entre partes:** las pinta la base, y ninguna parte edita su regla.
- `.stat-*`: parte 1 (stats de mesas) y parte 3.
- `.menu-item-name/-price`: parte 2 y parte 4 (tarjetas de producto).
- `.field`: parte 2 (buscador) y parte 4.
- `.card`, botones, `.badge`/`.chip`, `.aviso*` y `.history-row`: varias partes. La impresión del cierre depende de `.card *`, `.stat-card *` y `.history-row *`.

Si una parte necesita cambiar una regla compartida, lo anota en su informe y lo resuelve la integración.

### 4.3 Marcadores (los inserta la base; para ubicarse después: `grep -n "PARTE <clave>" pos.html`)

```
<!-- ▼ PARTE marco-salon-ticket :: login -->        antes de 3093 · <!-- ▲ PARTE marco-salon-ticket :: login -->        después de 3120
<!-- ▼ PARTE marco-salon-ticket :: nav-y-mesas -->  antes de 3125 · <!-- ▲ PARTE marco-salon-ticket :: nav-y-mesas -->  después de 3288
<!-- ▼ PARTE orden -->                              antes de 3290 · <!-- ▲ PARTE orden -->                              después de 3531
<!-- ▼ PARTE marco-salon-ticket :: ticket -->       antes de 3533 · <!-- ▲ PARTE marco-salon-ticket :: ticket -->       después de 3653
<!-- ▼ PARTE cierre-y-menu -->                      antes de 3655 · <!-- ▲ PARTE cierre-y-menu -->                      después de 3967
<!-- ▼ PARTE productos-y-modales -->                antes de 3969 · <!-- ▲ PARTE productos-y-modales -->                después de 4386
/* ▼ PARTE <clave> :: css */  …  /* ▲ PARTE <clave> :: css */     (cuatro bloques consecutivos en el <style>, antes de @media print)
```

**Reglas de convivencia:**
- Cada parte trabaja en su worktree, con una rama desde el commit de la base.
- Edita **solo** entre sus marcadores, y nunca las líneas de los marcadores.
- Las clases locales nuevas (`.nav-pill-aviso`, `.leyenda-mesa`, `.nota-item`, `.menu-scroll`, `.barra-cobro`, etc.) van en su bloque CSS, con su `@media` adentro.
- Entre dos bloques de partes distintas hay siempre un marcador y una línea en blanco, así que los merges no chocan.

### 4.4 Alcance de cada parte

Cada parte suma su alcance móvil de §0.13, que manda sobre lo de abajo.

- **marco-salon-ticket:** login (§3.12); nav (§3.11), con la franja y el arreglo de 768 y 1024; mesas: cabecera, leyenda, grilla y stats (§3.3, §3.5); ticket en pantalla (§3.10), sin el RitualMark y sin el `style` de `.opt`.
- **orden:** §3.13 entero, avisos (§3.8), totales (§3.9), `.btn-enlace` y fin de `font-display` y de los `style=` de color en datos.
- **cierre-y-menu:**
  - **Cierre:** cabecera, bento, sparkline turquesa, transacciones, «Cerrar día» (`.btn-lg` entonces; hoy `.btn-primary` de 52 px, §7.6) sin `py-4` ni `opacity-40`, e historial con `.btn-icon` de 44 (sin `style="width:28px…"`) y `.btn-icon-peligro`. «Mesa N» y montos pasan de Cinzel a Archivo. Sale el hex `#8A6118` de `pos.html:3797`.
  - **Menú semanal:** botones `.btn-sm` sin `py-2 px-3`. La etiqueta de semana va en Archivo (lleva números). Los días son títulos de panel (solo nombres). Los emojis 🗳️📅✍️ pasan a Lucide `vote`, `calendar` y `pencil-line`, con `aria-hidden`. Los links pasan a `.btn-enlace`.
- **productos-y-modales:**
  - **Productos:** el contenedor `.card p-6` pasa a `space-y-8`. Las tarjetas son `.card p-4` (sin `style` de `--surface-raised`). Botones `.btn-secondary.btn-sm` y `.btn-peligro.btn-sm`, sin `py-1.5 px-3` ni `color:var(--coral-300)`. Categoría en `.titulo-panel`.
  - **Los 8 modales:** §3.6 a §3.8. «Dividir entre» pasa a `.field.field-num`. Las mesas de reabrir van en `.btn-secondary`. Las etiquetas del modal de menú pierden 🍽️🥣🍚🥗🥤. Los cuerpos usan `.texto-dialogo`, `.importe` y `.texto-peligro`. El bloqueo de cierre va en `.aviso-peligro`.

---

## 5. Restricciones duras

1. **Lógica intacta:**
   - Los dos `<script>` (1652-3091 y 4392-4408) quedan **byte a byte iguales**. Eso incluye `catIcono`, `imprimir`, `conexionTexto`, `BUSINESS` y `signInWithOAuth` con su `redirectTo`.
   - Ninguna llamada a Supabase cambia. El merge con `tarea/supabase-propio` (`pos.html:1668-1669`) tiene que quedar trivial.
2. **Expresiones de Alpine:**
   - No cambia ni el nombre ni el valor de ningún `x-data`, `x-show`, `x-if`, `x-for`, `:key`, `x-model`, `x-text`, `x-init`, `@click`, `@change`, `@keydown`, `:disabled`, `:checked`, `:src`, `:title`, `:aria-*` ni `x-cloak`.
   - En `:class` puede cambiar el string de clases, nunca la condición.
   - En `:style` pueden cambiar los valores dentro del literal, nunca la condición.
   - Los `:style` de rotación de los chevrones (3743, 3800, 3816) no se tocan.
   - Las expresiones largas en `x-text` (3253-3261) no se reformatean.
   - Ningún elemento con binding se borra ni se mueve fuera de su padre.
3. **Clases acopladas al JS, a la impresión o al arnés (no se renombran ni se quitan):**
   - `nav-bar`, `nav-link`, `active`, `status-dot`, `ok`, `wait`, `off`.
   - `mesa-card`, `mesa-num`, `mesa-badge`, `libre`, `ocupada`, `mesa-presence`, `seat-dot`, `filled`.
   - `menu-item`, `opt-chip`, `sel`, `chip`, `green`, `red`, `history-row`.
   - `modal-backdrop`, `modal`, `print-zone`, `ticket*`, `meta-row`, `print:hidden`, `card`, `stat-card`.
   - No hay `id` en el marcado.
4. **El arnés llega a cada vista por estos selectores y nombres** (`scripts/pruebas/_pos-simulado.mjs:434-438` y `VISTAS`). Tienen que seguir valiendo:
   - `nav.nav-bar button.nav-link` con «Mesas», «Productos», «Cierre del día» y «Menú semanal».
   - `.mesa-card` con un `.mesa-num` de texto exacto.
   - Botones por nombre accesible exacto: «Generar ticket y cobrar», «Sí, cobrar», «Imprimir precuenta», «Ítem manual», «Nuevo producto», «Reabrir en mesa», «Cerrar día» y «Editar».
   - `button[title="Editar"]`, `.modal-backdrop:visible .opt-chip` «Sopa» e `input[type=number]`.
   - Los textos «también tiene esta mesa abierta», «Elige una mesa libre» y «Entrar con Google».
   - **Un ícono nuevo dentro de un botón no puede agregar texto accesible.**
5. **Textos funcionales:** ningún texto visible cambia. Se permite quitar emojis y agregar «Restaurante» decorativo en el login.
6. **`<head>`:** se conservan `<title>Resplandor — POS</title>`, la única `<meta name="robots" content="noindex, nofollow">`, el texto `signInWithOAuth`, el `redirectTo: window.location.origin + window.location.pathname` y la ausencia de `rel="canonical"` (`raiz.test.mjs:66-74`).
7. **La impresión se conserva:** `.print-zone`, `body.print-termico` y `@page 80mm` (los pone el JS), `print:hidden` y el negro sobre blanco.
8. **No se tocan:** `assets/css/*.css` (salvo el comentario de `base.css:8-11`), `resplandor.css`, `entrada-tailwind.css`, `iconos.mjs`, el checkout principal `~/Developer/resplandor/resplandor` ni `tareas/**`. Esto último queda para el coordinador. Nada de push.
9. **Sin hex en `style=""`** en el marcado nuevo. Sin texto con opacidad. Sin emojis. Sin itálica en pantalla. Sin `radial-gradient` ni `backdrop-filter`.
10. **Reglas móviles de §0.2:**
    - El mismo marcado, con CSS por breakpoint.
    - Lo que fija o reordena va con `screen`.
    - Las barras fijas no tienen ancestros con `transform`.
    - Nunca `overflow-anchor: none`.
    - Campos a 16 px y 44 px sin excepciones.

---

## 6. Verificación

Con Node 22 (`PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH`), desde el worktree que corresponda.

1. **Suite:** `node --test scripts/pruebas/*.test.mjs`. Línea base 501/501, más la prueba nueva, todo en verde.
2. **Los tres `--comprobar`:**
   - `node scripts/css.mjs --comprobar`
   - `node scripts/iconos.mjs --comprobar`
   - `node scripts/descubrimiento.mjs --comprobar`

   Tienen que dar código de salida 0.
3. **Capturas antes y después por vista:**
   ```
   node scripts/capturas-pos.mjs $S/despues-<clave> --cache $S/_cdn --vistas <lista> --anchos 360,390,768,1440
   ```
   - A 360 y 390 se suma la captura de la ventana sola (`--ventana`, §0.14).
   - Comparar contra `$S/antes/<vista>-<ancho>.png`; a 360 y 390, contra `$S/base/movil/` y contra la base móvil.
   - El código de salida tiene que ser 0: sin error de consola propio, sin pedido bloqueado y sin captura fallida.
   - La base móvil y la integración corren las 25 vistas a 360, 390, 768 y 1440. La integración suma 1024.
   - Las vistas de impresión van en su ancho: `ticket-impreso` a 302 y `cierre-impreso` a 794.
4. **Táctil y desborde:** `$S/harness-pos.mjs` mide desborde horizontal y objetivos táctiles por escena.
   - Su umbral está fijo en 40 px (línea 187). En la copia de scratch se sube a **44**.
   - Uso: `DETALLE_TACTIL=1 node $S/harness-pos.mjs <raíz> <salida> todas 360x780,390x844,768x1024,1024x768,1440x900`.
   - Tiene que dar 0 desbordes y 0 controles menores de 44 px, sin excepciones: el checkbox mide 44 (§0.6).
   - El teléfono (360 y 390) es el primario y se exige como el resto (§0).
5. **Lógica intacta** (sondeo en scratch, no va al repo):
   - Extraer los `<script>` de `git show 4da9030:pos.html` y de la versión nueva: tienen que ser idénticos.
   - Extraer en orden todos los atributos `x-*`, `@*` y `:*` (sin `:class` ni `:style`): las dos listas tienen que ser idénticas.
   - Los `:class` y `:style` pueden diferir solo en los literales.
   - Bitácora de Supabase: correr las mismas vistas con `llamadasSupabase(page)` (`_pos-simulado.mjs`) sobre `--raiz` de `git archive 4da9030` y sobre el worktree nuevo. Tienen que dar la misma secuencia.
6. **A ojo, primero a 360 y 390** (§0.14.4). **Después, a 768 y 1024 px** (tablet vertical y horizontal):
   - La franja va una sola vez y el nav entra sin recorte. Se ven los cuatro links y no está la «coma».
   - La mesa ocupada se distingue de la libre a un metro. El total de la mesa se lee.
   - En la orden se ven pedido y total sin bajar.
   - Cinzel solo en títulos, marca y eyebrows. Ningún número en Cinzel.
   - Un solo coral por pantalla, salvo el modo cobro por partes.
   - Los avisos tienen el color de §3.8. Los chips de respaldo se ven turquesa o barro.
   - Ningún texto gris claro sobre claro (ni `ceniza` ni `linea` como texto).
   - El foco se ve con Tab: barro sobre claro, maíz en el nav.
   - Los diálogos son papel con velo sin blur.
   - El ticket en pantalla se ve como papel. El impreso térmico es monoespaciado y negro, sin la R decorativa. El cierre en A4 sale con chips de borde negro.
   - Sin animaciones perceptibles salvo 120 ms de opacidad. El login tiene la franja, el monograma y el rótulo coral sobre telon.
7. **Visto de Yonatan**, con las capturas lado a lado. Es el criterio de cierre de la tarea. Si pide oscuro, se remapea `:root` (§1).

---

## 7. Segunda ronda de Yonatan (2026-10-01, noche): personas, un solo cobro, primario legible y cierre

Pedido, con la tarea `tarea/pos-personas-botones` sobre el POS en producción (`e3ed55b`, ola B). Cuatro puntos, todo en `pos.html` salvo los tokens del botón (`assets/css/base.css` y `componentes.css`). **Móvil primero** como en §0: 320 a 430 px mandan y a ~920 px (como lo usa Yonatan) y a 1440 se ve igual de bien.

### 7.1 «Dividir cuenta por persona»: nombres y detalle

- **Cada persona es UNA fila de ~56 px** (`.persona-split`, grilla): `[˅] [Nombre ✎] [$ 34.000] [Cobrar]`. Todo mide 44 px de alto. La primera versión tenía el resumen en una segunda línea («2 ítems · $ 34.000») y con tres personas la tarjeta pasaba de 290 px; ahora mide ~225 (tres personas, a 390) y el pedido no se va del pliegue. Bajo 360 px no caben las cuatro cosas en una línea y el total baja a una segunda debajo del nombre (el único caso de dos líneas). El nombre se recorta con «…».
- **El nombre se edita tocándolo.** Es un botón (`.persona-nombre-btn`, con un lápiz que avisa); al tocarlo se vuelve un campo (`.persona-campo`) de **16 px** (iOS no hace zoom) y 44 px de alto, con el foco puesto dentro del mismo toque (para que iOS abra el teclado el campo está siempre en el DOM, inactivo mide 0×0). **Enter o salir del campo guarda; Escape cancela; vacío (o «Persona N») vuelve a «Persona N»**. Tope de 24 letras; los paréntesis y las rayas se quitan porque romperían el sufijo.
- **Desplegable por persona.** **Toda la línea de resumen lo abre**: el total es un botón de 44 px (`.persona-meta`, con `aria-expanded`/`aria-controls` y el nombre accesible «Ver el detalle de Camila: $ 34.000»); el chevron (`.persona-chev`, 44 px, también se toca) es solo el indicador y queda fuera del árbol de accesibilidad (`aria-hidden`, `tabindex=-1`): un control por fila para lectores. Dentro: cantidad, nombre del ítem, sus opciones (la nota sin el sufijo de persona) y precio de la línea, con un máximo de 36rem de ancho. **Sin «Subtotal»**: repetía el total de la fila, que está justo encima. Plegado de entrada. «Cobrar» de esa persona se mantiene (`cobrarGrupoPersona`).
- **Editar el nombre, sin foco perdido.** Mientras se edita, el campo toma el sitio del botón del nombre y del total (la clase `.editando` de la fila, no `x-show`: se cambian en el mismo repintado que el campo) y mide a lo sumo 20rem. **Enter y Escape devuelven el foco al botón del nombre**: el campo inactivo mide 0×0 y antes se quedaba con el foco (se seguía escribiendo a ciegas, en iOS «Listo» no cerraba el teclado y un lector quedaba en un elemento oculto).
- **Dónde se guarda (sin migración).** La asignación ya vivía en la `nota` de cada ítem, como sufijo `— Persona N`, y viaja por el RPC `actualizar_nota_item`, por Realtime y por el cierre. El nombre va **en el mismo sufijo**: `Sopa · Pollo — Persona 2 (Camila)`.
  - `«Persona N»` es la **clave estable** (agrupa y ordena); el nombre es solo la etiqueta. Lo lee `_parsearPersona`, que sigue entendiendo el sufijo viejo.
  - `renombrarPersona(clave, texto)` reescribe el sufijo de **todos** los ítems de esa persona, en orden, y la pantalla cambia de inmediato; guarda con un RPC por ítem (el primero ya fija el nombre). `ciclarPagador` le pasa a un ítem nuevo el nombre que la persona ya tiene.
  - Si los ítems de una persona traen nombres distintos (una tablet con la pantalla vieja), gana el del **primer ítem con nombre**.
  - **Renombrar y reasignar a la vez.** La nota de cada ítem se arma **justo antes de enviarla**, desde lo que el ítem dice entonces, y un ítem que ya no es de esa persona se salta: una reasignación hecha mientras se guardan los demás gana (antes, la base volvía a «Persona 1 (Ana)» y la pantalla, con el eco de Realtime, también). Un segundo renombrado de la misma persona toma el relevo. **Entre tablets no hay candado:** una tablet con el estado viejo que renombre justo después de que otra reasigne puede deshacerlo; cerrarlo pide una actualización condicional en la base (un RPC nuevo, fuera de esta rama).
  - **Dos personas con el mismo nombre** se muestran «Camila (P2)» (pastillas, título de la fila, ticket de «Cobrar» y ticket de la cuenta entera); el campo conserva lo escrito. Solo cuando se repite.
  - **Límites, a la vista:** el nombre vive en los ítems de la persona, no en la orden; si todos se reasignan, vuelve «Persona N». **Sin red el nombre se pierde:** queda en la pantalla y en la caché de esa tablet, pero al volver la conexión la lectura de la base trae el de antes y vuelve «Persona N», sin aviso (no hay cola de notas; la asignación ya se comportaba igual). Una tablet con la pantalla vieja ve `Persona 2 (Camila)` como nota libre hasta recargar; si en ese estado asigna un ítem, apila un sufijo (`Sopa — Persona 2 (Camila) — Persona 1`): la pantalla nueva toma el último y descarta los anteriores al leer, y lo reescribe limpio al renombrar. La función pública `cuenta` quita las notas: el nombre nunca sale en la carta del cliente.
- **Dónde se ve el nombre:** la pastilla de la persona en cada ítem del pedido (`.nota-persona`, tinte turquesa, aparte de la nota), el título de la fila, el `aria-label` de «Reasignar» y «Asignar a persona» (el texto visible no cambia), el ticket de «Cobrar» (meta «Cuenta de Camila», sin repetir el nombre en cada línea) y el detalle del cierre («Cerdo — Camila»).

### 7.2 Un solo botón de cobro

- «Facturar» de la cabecera se **quitó**. Abría `modalConfirmFactura`, el mismo modal que «Generar ticket y cobrar». Queda el de la barra de cobro porque está siempre a la mano: fijo abajo bajo 1024 y en la columna pegajosa del pedido desde 1024.
  - **«Siempre a la vista» desde 1024 hubo que medirlo.** La columna del pedido (`.col-pedido`) tenía un alto máximo de «ventana − nav − 12rem» (lo que ocupan cabecera y acciones). Con avisos encima (otra tablet en la mesa, alerta de cuenta, enlace NFC, cuenta dividida por persona) la rejilla arranca más abajo y el pie de la columna —el total y el botón— quedaba bajo el pliegue (1024×768 con un aviso de presencia: el botón a 762 px de 768; con 4 personas, a 1090). Ahora `vigilarAltoPedido()` mide dónde empieza la rejilla (o dónde se pega la columna, si ya se pegó) y lo pasa a la hoja de estilo como `--pedido-ocupado`; el alto máximo es `max(13rem, ventana − ocupado)`. La lista del pedido es la que cede alto (y scrollea por dentro); al bajar la página la columna se pega bajo el nav y crece. Sin medida (sin JS) rige el 12rem de antes.
- Con una cuenta cerrada que se edita sin mesa el mismo botón dice «Guardar cambios»; en «Cobrar por partes» sigue habiendo un solo coral (el que cobra lo marcado).
- «Imprimir cuenta» pasó a **«Imprimir precuenta»** con una línea de ayuda (`#ayuda-precuenta`, enlazada con `aria-describedby`): *la precuenta es para el cliente y no cobra*. Cabe en una línea a 390 px y el botón va **último** de la fila de acciones, pegado a su ayuda (con «Enlace NFC» en medio, en teléfono la ayuda parecía hablar de él). No sale al editar una cuenta cerrada.
- **«Cobrar por partes»:** en ese modo «Generar ticket y cobrar» se esconde (un solo coral, el de lo marcado) y no hay en pantalla un botón de cobro total. El texto del abono lo dice ahora: *«Para cobrar todo, toca «Cancelar selección» y usa «Generar ticket y cobrar»»* (antes mandaba a un botón que en ese modo no estaba).

### 7.3 Botón primario legible (POS, carta y landing)

- **Problema:** `letrero` (`#ED6B50`) con letra `telon` pasaba (6,19) pero «se veía apagado». Letra clara sobre ese mismo coral da 3,03 y no alcanza AA a 16 px.
- **Decisión:** coral **más profundo** (mismo tono, 10°) con rótulo `papel`, en negrita, borde interior claro y sutil, y hover/active más hondos. Los valores viven **una sola vez** en `assets/css/base.css` (`:root` con `--boton-primario-*`, fuera del `@theme`: son derivados, los 15 tokens de material no cambian) y se usan en `.btn-primary`/`.btn-letrero` de `componentes.css` (landing, carta, menú) y, copiados en su `:root`, en el POS (`pos-visual.test.mjs` los compara uno por uno).

| Token | Valor | Medido |
|---|---|---|
| `--boton-primario-fondo` | `#C43E26` | `papel` encima **5,08** · contra `telon` 3,69 · `arroz` 4,53 · `papel` 5,08 (no-texto ≥ 3) |
| `--boton-primario-fondo-hover` | `#B8381F` | `papel` encima **5,70** (≥ 3 contra telon, arroz, papel) |
| `--boton-primario-fondo-activo` | `#A32F1B` | `papel` encima **6,93** |
| `--boton-primario-texto` | `#FFFDF7` (= `papel`) | |
| `--boton-primario-borde-interior` | `rgba(255,253,247,.34)` | decorativo |
| `--boton-primario-sombra` | `0 8px 20px -10px rgba(196,62,38,.55)` | decorativo |

- Foco: el anillo global `:focus-visible` (2 px con 2 px de aire; barro sobre claro, maíz sobre telón), que se ve sobre el coral. El deshabilitado del POS no cambia (apoyo sobre línea).
- **Siguen en `letrero` con letra `telon`** (6,19) las insignias y alertas, que no son botones: la insignia de alertas del nav, la pastilla «Pide cuenta» y el ícono de alerta de la mesa.
- `contraste.test.mjs` mide cada par con la fórmula WCAG; `pos-personas-botones.test.mjs` mide los colores calculados por el navegador en el POS, la landing y la carta.

### 7.4 Colores del cierre del día

- **Jerarquía:** «Total vendido hoy» es la única tarjeta oscura (telón, cifra `arroz` 16,72, etiqueta `ceniza` 7,15, tendencia en `maiz`, no-texto 9,22) y la cifra más grande; Órdenes y Ticket prom. quedan en papel. En papel (impresión) todo vuelve a blanco y negro como antes.
- **Pastillas suaves** (`.chip.green`: «Facturada», «Respaldado», la etiqueta del menú): tinte turquesa `--pos-tinte-turquesa` (`#E1EAE8`, turquesa al 14 % sobre papel) con texto `telon` (15,55) y un punto turquesa; borde `--pos-tinte-turquesa-borde` (decorativo). El rojo (`.chip.red`: «Sin respaldo», «Oculto», «Sin acceso») queda pleno: un problema debe notarse.
- **«Editar»** es `.btn-discreto`: lápiz y texto `apoyo` (6,79), sin subrayado ni coral, 44 px; el hover lo perfila. En el historial, lápiz y papelera son `.btn-icon-tenue`: borde `linea`, lápiz `apoyo`, **papelera `barro` (7,45)**; al tocarla se tiñe con `--pos-tinte-barro` (`#F3EAE2`, barro 10 %) y su borde. Se distingue sin gritar.
- **«Cerrar día»** ya es el primario nuevo (§7.3), y desde la segunda vuelta una acción de pie: `.btn-primary` de 52 px (sin `btn-lg`, que lo dejaba de 56 px de alto y, a 920 y 1440, de ~850 px de ancho como una losa que pesaba más que la tarjeta del total), ancho completo en teléfono y a la derecha desde 640 (`sm:w-auto sm:min-w-[16rem] sm:ml-auto`).
- **«Editar» en columna** desde 640: el importe de cada transacción mide lo mismo (`min-width: 6.5rem`, a la derecha) y «Editar», que va a su izquierda, cae en una sola columna (antes, la de «$ 151.000» quedaba 9 px a la izquierda).
- **Órdenes y Ticket prom.** desde 640 se estiran a la altura de la tarjeta del total (la que lleva la tendencia): su contenido va centrado, no pegado arriba con media tarjeta vacía.
- **Dos «Editar» con regla:** ghost con palabra en «Transacciones del turno», círculo con solo lápiz en el historial (`docs/identidad-visual.md` §3.1).
- Derivados nuevos del `:root` del POS (valores literales calculados desde los 15, con prueba): `--pos-tinte-turquesa`, `--pos-tinte-turquesa-borde`, `--pos-tinte-barro`, `--pos-tinte-barro-borde`.
- **Lo que la ola C sumó al cierre usa el mismo lenguaje** (integración de `tarea/pos-personas-botones` sobre `f9b2625`): la pastilla de «Cobros deshechos hoy: N · $ X» deja el `badge-maiz` pleno y pasa a `.chip.chip-aviso` (tinte barro `--pos-tinte-barro`, texto `telon` 16,04, punto `barro`; con cero deshechos queda el `.chip` neutro); «Reintentar subir» (`#cierre-razon`), «Revisar» (`#cierre-viejo-aviso`) y «Reintentar respaldo» (historial) dejan de ser `.btn-enlace` coral subrayado y pasan a `.btn-secondary.btn-sm` (papel, texto `telon` 18,74, 44 px); la hoja «Ventas sin subir de esta tablet» ya hereda todo lo demás (su «Subir N ventas» es el primario nuevo; «Descartar copia» y «Sí, descartar» son `.btn-secondary` y `.btn-peligro`, que ya eran quietos; «Faltan en el sistema» es `.texto-peligro`, barro 7,45); el `.chip.red` «Sin respaldo» y los `.aviso-peligro` (errores de lectura) quedan plenos a propósito: un problema debe notarse. «Cerrar día» conserva el apagado sin red de la ola C (`puedeCerrarAhora`) y su `.aviso` explicativo. Prueba: `pos-personas-botones.test.mjs` («integración ola C»).

### 7.5 Verificación

- Arnés: vistas nuevas `orden-personas`, `orden-personas-detalle`, `ticket-persona` (`node scripts/capturas-pos.mjs <dir> --vistas orden-personas,orden-personas-detalle,ticket-persona,orden,cierre --anchos 390,1440`).
- Pruebas: `scripts/pruebas/pos-personas-botones.test.mjs` (marcado, lógica del store y navegador: nombre editable, desplegable, un solo cobro, primario medido, colores del cierre, 320/360/1440 sin desborde y sin controles de menos de 44 px, con un nombre de 24 letras anchas), `contraste.test.mjs` y `pos-visual.test.mjs` (tokens del botón y tintes).
  - Segunda vuelta: la fila de una línea y el total que abre el detalle, Enter y Escape con el foco de vuelta, el cobro dentro de la ventana desde 1024 con avisos encima (1024×768, 1180×820, 1366×768 y 1440×900, con la otra tablet en la mesa y la cuenta dividida), renombrar contra reasignar (con latencia), el relevo entre dos renombrados, los sufijos apilados de una tablet vieja, los nombres repetidos, el ticket con 24 «W» a 320 y 390, «Cerrar día», «Editar» en columna y la ayuda de la precuenta de una línea. Las capturas de esa vuelta: `node scripts/capturas-pos.mjs <dir> --vistas orden,orden-personas,orden-personas-detalle,orden-avisos,ticket-persona,cierre --anchos 390,920,1440`.

### 7.6 Segunda vuelta: crítica visual y refutación de la rama

Qué se corrigió y qué no, con su porqué (la crítica y la refutación están en la tarea):

| Hallazgo | Estado | Cómo |
|---|---|---|
| Refutación 1 (alto): el cobro bajo el pliegue desde 1024 | corregido | `vigilarAltoPedido` + `--pedido-ocupado` (§7.2); el texto del abono ya no manda a un botón escondido |
| Refutación 2 (medio): renombrar pisa una reasignación | corregido en la tablet; **parcial entre tablets** | nota armada al enviar + relevo (§7.1). Entre tablets haría falta una actualización condicional en la base |
| Refutación 3 (medio): el foco queda en un campo invisible | corregido | `terminar()` devuelve el foco al botón del nombre |
| Refutación 4 (medio): la prueba falla en máquina ociosa | corregido | el botón se esconde con la clase de la fila en el mismo repintado que el campo; la prueba espera al campo |
| Refutación 5: el ticket con nombre largo desborda | corregido | `.meta-row` parte el valor (como el rollo térmico) |
| Refutación 6: sin red el nombre se borra | **solo el texto** | §7.1 lo dice como es; una cola de notas pendientes es otra tarea |
| Refutación 7: sufijos apilados de una tablet vieja | corregido al leer | `_parsearPersona` deja el último y limpia los anteriores |
| Refutación 8: pulsado 2,70:1 sobre telón | **no cambiado, documentado** | `docs/identidad-visual.md` §3.1: dura lo que el toque y el rótulo sigue en 6,93 |
| Refutación 9: el doc con tokens viejos | corregido | `--pos-sombra-letrero` y `--text-on-coral` |
| A1 fila de una línea | corregido | §7.1 |
| A2 el total abre el detalle | corregido | §7.1 |
| M1 `.persona-nombre` repetida | corregido | `.persona-split-nombre` |
| M2 «Cerrar día» | corregido (52 px, no 48) | el primario de siempre mide 52 (`--pos-boton-alto`); `btn-lg` era 56 |
| M3 ayuda de la precuenta | corregido | una línea, botón último |
| M4 «Editar» en columna | corregido | `min-width` del importe |
| M5 campo estirado | corregido | `max-width: 20rem` (la meta ya no va debajo) |
| B1 tono del primario | documentado | decisión y pasos alternativos medidos en `identidad-visual.md` |
| B2 dos «Editar» | documentado | regla escrita |
| B3 detalle ancho | corregido | `max-width: 36rem` |
| B4 subtotal redundante | corregido | se quitó |
| B5 mismo nombre | corregido | «Camila (P2)» solo si se repite |
| B6 tarjetas estiradas | corregido | contenido centrado |
| B7 sombra con sintaxis reciente | **no cambiado** | la sombra de 1 px del rótulo usa `rgb(from var(--color-telon) …)`, la forma que `componentes.css` exige (una prueba prohíbe el color literal ahí; `.btn-linea-clara` usa la misma sintaxis). En Safari < 16.4 solo se pierde esa sombra: el rótulo (`papel` sobre coral, 5,08) y el resto del botón no cambian |

