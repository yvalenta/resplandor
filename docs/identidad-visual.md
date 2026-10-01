# Resplandor: identidad visual v2 (contrato de implementación)

> **Qué cambió y por qué.** La v1 (commit `6626097`) vistió la cara pública con la paleta y las fuentes del POS y dejó el mural fuera. Camila quiere renovar, y Yonatan pidió que la página se parezca a Resplandor y no al sistema interno.
> Por eso la v2 saca todo de las fotos del local. Los colores son el letrero coral sobre negro, la pared terracota y el verde y la franja del mural. Las letras son las romanas del letrero y la R de voluta, y el ritmo lo da una franja propia.
> El POS (`pos.html`) no se toca. *(2026-09-30: el POS adopta esta identidad, ver `docs/pos-visual.md`.)* Esta versión reemplaza por completo a la v1: ninguno de sus tokens, fuentes ni motivos sigue vigente, salvo donde este documento lo diga.

Estado: **vigente desde el 2026-09-28**. Es el contrato visual de `index.html`, `carta.html` y `menu.html`.
- En datos del local, reglas del negocio, capa de agentes y dueños de archivos manda [`landing-y-agentes.md`](landing-y-agentes.md).
- En lo visual manda este documento. §16 lista lo que hay que corregir allá.
- Todo contraste está calculado con la fórmula WCAG 2.x (luminancia relativa).
- Todo peso sale de archivos reales: `recursos.json`, woff2 descargados de Google Fonts el 2026-09-28 o recortes de prueba hechos con la receta de la casa.

Reglas que no se discuten (Línea Roja y datos que mandan):
- Nada de commit, push, despliegue ni escrituras en Supabase.
- No se borra ningún archivo del repo. No se tocan `tareas/**`, `pos.html` (POS) ni los HTML viejos. *(2026-09-30: el POS adopta esta identidad, ver `docs/pos-visual.md`.)*
- Capacidad: 30. Eventos, celebraciones y paquetes van **en el local, de 10 a 30 personas**, nunca a domicilio.
- La cena romántica en pareja no lleva mínimo. Es una decisión por defecto que falta confirmar con Camila.
- El almuerzo programado se recoge o va a domicilio, con el costo del domicilio a cargo del cliente.
- Horario: todos los días, 12:00–17:00. No se sugiere servicio de noche.
- Sin precios en eventos. Los precios de la carta se leen en vivo; si la carta en vivo no carga (hoy Supabase responde 402), la landing y `carta.html` muestran la instantánea del 3 de septiembre de 2026 con su fecha a la vista y sin caja de error: **decisión de Yonatan, 2026-09-29**, que reemplaza la regla anterior de «precios solo en vivo» (hallazgo H16). Ver `docs/landing-y-agentes.md`, «Funciones que se pueden apagar».
- «5,0 en Google Maps · 2 reseñas» va como enlace. Sin testimonios.
- Sin nombres de platos que no estén confirmados, sin promociones y sin desayunos.
- Español de Colombia, trato de «tú».
- El traslado de la landing a la raíz (`landing.html` → `index.html`, POS → `pos.html`) se hizo en **otro commit, después** de esta fase (2026-09-29). Este documento nombra los archivos como quedaron: la landing es `index.html`. Las referencias `landing.html:NNN-MMM` de §7 son a la v1 de esa página, con el nombre que tenía entonces.

---

## 0. La decisión en una línea

**Base: dirección 3, «La cocina en escena».** Se le injerta el color y la foto del mural de la dirección 1 («La selva del salón») y la claridad y los pies de foto de material de la dirección 2 («Barro y terracota»). El juez agrega correcciones propias. La página se lee como **el letrero de la Cra. 61 abriendo el salón**:
- **Arriba, el nombre en coral sobre negro**, con la R de voluta, como la fachada. Al lado va un almuerzo servido sobre la tela negra, con la franja del mural detrás.
- **Al bajar, las dos paredes del salón:** la terracota y la del mural (verde selva).
- **Cierra otra vez el letrero,** a todo lo ancho.

| Se toma de | Qué |
|---|---|
| Dirección 3 (base) | Concepto: el letrero (coral `#ED6B50` sobre negro) es la marca, y el hero muestra un almuerzo de estudio con la franja del mural detrás. El rótulo «RESPLANDOR / RESTAURANTE» en Cinzel con la R de Cinzel Decorative. `telon #0A1112`, medido en la tela de las fotos de estudio. Franja propia de triángulos (SVG de 573 B). Rombos en las listas. Maíz como acento sobre oscuro. Bandas de pared terracota. Fotos de estudio fundidas con el telón. Tope de peso bajo (hero de 49 KB). |
| Dirección 1 | El mural **como color**: `selva #2E5B57` para la banda de `#la-casa`. El mural de cerca, con el almuerzo servido (`mesa-sopa-plato-mural-fondo`, recortado de nuevo). Carta y menú con **cabecera oscura y cuerpo claro**. Friso de fotos pegadas, sin hueco. Eyebrows en Cinzel espaciada, como «RESTAURANTE». Los precios nunca en dorado. |
| Dirección 2 | La hora dentro del H1. Pies de foto que nombran el **material** y no el plato («Cazuela negra», «Vasos de barro», «La pared terracota», «El mural»). «Busca este letrero, rojo sobre negro» en `#como-llegar`. Chip «Mesa N» en la cabecera de la carta. `#celebraciones` sobre la pared, porque su foto tiene esa misma pared detrás. `barro #8A3D22` como acento sobre claro. |
| Juez | Archivo sin Narrow (−12 KB). Cinzel solo en 700 estático (15 KB en vez de 26). La R con `::first-letter`, sin partir la palabra en el DOM. `@theme` sin la paleta por defecto de Tailwind (`--color-*: initial`) como guarda. El video sin máscara, para no borrar sus controles, y con el foco visible dentro del friso. Monograma real (la R dorada de Camila) en vez de una R en CSS. Recorte nuevo medido del mural con la mesa. A 375 px, las fotos del friso a 240 px para que baje la variante 480. Las trampas de datos que la v1 prometió y no escribió. Arreglos de texto de los hallazgos («sin excepciones», «capacidad completa»). |

Se descarta, con su porqué:
- **De la dirección 1:**
  - `noche #162627` como fondo general. El negro de la marca es el del letrero y la tela de estudio; un verde-noche en todo el sitio aleja la fachada.
  - `hibisco` como acción. Compite con el coral del letrero y sobre oscuro da 2,35: necesitaba un anillo de parche.
  - Siluetas de monstera que se mecen, greca vertical, esquinas de hoja y viñeta de flor. Son adorno inventado de «tropical genérico», con mucho riesgo para lo poco que ganan.
  - La mujer del mural como portada. La cara pública de la casa es su letrero; la mujer sale en `#hoy` y en `#la-casa`.
  - Bricolage Grotesque, una grotesca de moda que suena a plantilla.
- **De la dirección 2:**
  - Hero de pared terracota: es la composición de la v1 redibujada.
  - Lámparas en CSS, franja de madera y estuco en el hero: imitaciones de lo que la foto ya muestra.
  - Plato en aro de loza y marco de vaso: tópico de plantilla, frágil en cada ancho.
  - Borde escarchado con `clip-path` y relieve con sombra en el H1.
  - `dorado` como acción.
  - `letrero #E9472E`: da 4,54, al límite. El letrero medido es `#ED6B50`.
  - Alegreya Sans.
- **De la dirección 3:**
  - Carta y menú oscuros: se leen en la mesa, a mediodía, en el teléfono.
  - Los tokens `hondo`, `panel` y `turquesa` claro para enlaces, porque nada los necesita.
  - Archivo Narrow.
  - La «luz cenital» animada.
  - Doble máscara con `mask-composite`, cruces de −40 px y alto por `cqw`: riesgo de maquetación sin ganancia visible.
  - La R en CSS en lugar del monograma real.

---

## 1. Hechos de identidad (medidos; no se discuten sin una foto nueva)

| Elemento (foto) | Medida | Consecuencia |
|---|---|---|
| Letrero de día (`fachada-dia-flores-balcon`) | Letra `#ED6B50` sobre tablero `#231B19`. Romanas de remate abocinado, A en punta, R con la pata en voluta bajo la línea. «RESTAURANTE» chico y espaciado debajo | `letrero` es la marca y la acción. Cinzel 700 con la R de Cinzel Decorative (comparadas 26 fuentes: `scratchpad/v2/direccion-3/pruebas/fuentes.png`) |
| Tela de estudio (`plato-sopa-jugo-estudio`, `tacos…`, `bowl…`, póster) | Borde inferior `#0B0E0F`, `#090F12`, `#060A0B` y `#0A0C0D` | `telon #0A1112`: el fondo oscuro se funde con las fotos de estudio |
| Franja del vestido del mural (detrás de los platos de estudio) | Negro `#0E1516`, turquesa `#458C9B`/`#2A738A`, naranja quemado `#84300B`/`#C5571A` y amarillo heliconia `#DFB12C` | Motivo **propio** de triángulos con `turquesa`, `naranja` y `maiz`. No se calca la obra |
| Selva del mural | `#2E5B57` / `#4A8576` | `selva`: la banda de `#la-casa` |
| Pared del salón | `#CE8965`, estuco | `pared`: bandas de `#hoy` y `#celebraciones` |
| Letras en relieve del salón | `#2B2223`, bronce-negro mate (no son doradas) | Sobre la pared solo va `telon`. Las fotos sobre la pared llevan la sombra dura del relieve |
| Monograma R | Oro cepillado `#B39464`, anillo sobre un disco claro | `oro` es solo el anillo. El logo real (`img/logo-r.webp`) se queda como medallón |
| Corteza de la arepa y heliconia | `#E9A91F`, `#DFB12C` | `maiz`: acento sobre oscuro (precio, eyebrow, foco, íconos) |
| Vasos de barro | `#864738` / `#893521` | `barro`: acento sobre claro (eyebrow, enlaces, foco) y estado de error |
| Arroz y queso (platos de estudio) | `#ECECD3`–`#F4F0E3` | `arroz`: fondo claro y texto sobre oscuro |
| Letrero de noche | `#FA902C`: es brillo de neón, no la pintura | No se usa |

---

## 2. Concepto

**«El letrero abre el salón».**

- **Primera pantalla, oscura:**
  - El rótulo «RESPLANDOR / RESTAURANTE» en coral, como lo ve quien pasa por la Cra. 61.
  - Debajo, qué es y cuándo abre.
  - Al lado, un almuerzo servido (plato, sopa y jugo) sobre la tela negra, con la franja del mural detrás.
- **Al bajar, las dos paredes del salón:**
  - La terracota lleva el menú de hoy y las celebraciones, que se hacen en ese salón.
  - La del mural, en `selva`, lleva «La casa».
- **La cocina va en un friso oscuro:** las fotos de estudio van pegadas y la franja pintada de fondo se lee como una sola pared.
- **Lectura larga en claro:** la carta, el almuerzo programado, las preguntas, la carta NFC y el menú semanal van sobre `arroz`/`papel`.
- **Cierre:** el letrero otra vez, a todo lo ancho.
- **Voz:** frases cortas, de «tú», con datos (hora, capacidad, dirección) en lugar de adjetivos. Nada se afirma si no sale de `landing-y-agentes.md` o de una foto.

---

## 3. Tokens finales (`assets/css/base.css`, `@theme static`)

**Cambio de contrato:** se **eliminan todos los tokens de la v1** y la paleta por defecto de Tailwind. Quedan solo los 15 de abajo. Los nombres nuevos son de material, como en lusof, así que un token viejo que quede olvidado **no compila** (la prueba de §13-A lo detecta). El POS no se ve afectado: usa su propio Tailwind CDN con su configuración (`pos.html:24-39`) y no carga `resplandor.css`. *(2026-09-30: el POS adopta esta identidad, ver `docs/pos-visual.md`: copia estos 15 tokens en su `<style>` y los vigila `scripts/pruebas/pos-visual.test.mjs`; sigue sin cargar `resplandor.css`.)*

```css
@theme static {
  --color-*: initial;                 /* sin la paleta por defecto de Tailwind: solo lo de abajo compila */
  --font-display: 'Cinzel', Georgia, serif;
  --font-sans: 'Archivo', system-ui, sans-serif;
  --font-r: 'Cinzel Decorative', 'Cinzel', Georgia, serif;  /* solo la R del rótulo */

  --color-telon: #0A1112;        /* tela negra de estudio · fondo oscuro y texto sobre claro */
  --color-arroz: #F4F0E3;        /* arroz/queso · fondo claro y texto sobre oscuro */
  --color-papel: #FFFDF7;        /* superficie: tarjetas, diálogo, campos */
  --color-linea: #D9D3BF;        /* bordes y divisores sobre claro (decorativo, nunca texto) */
  --color-apoyo: #4F5D59;        /* texto secundario sobre claro (monstera desaturada) */
  --color-ceniza: #A49F86;       /* texto secundario sobre telón (acero de la salsera) */
  --color-pared: #CE8965;        /* pared terracota · solo fondo de banda */
  --color-selva: #2E5B57;        /* verde del mural · solo fondo de banda */
  --color-letrero: #ED6B50;      /* letra del letrero · rótulo y relleno de la acción principal */
  --color-letrero-claro: #F4846B;/* hover de la acción principal */
  --color-maiz: #E9A91F;         /* corteza de arepa / heliconia · acento sobre oscuro */
  --color-barro: #8A3D22;        /* vaso de barro · acento sobre claro, error */
  --color-turquesa: #2A738A;     /* franja del mural · estado «confirmado/hoy», motivo */
  --color-naranja: #C5571A;      /* franja del mural · solo motivo */
  --color-oro: #B39464;          /* anillo de la R dorada · solo no-texto */

  --shadow-sombra: 0 1px 2px rgb(10 17 18 / .05), 0 6px 20px -12px rgb(10 17 18 / .22);
  --shadow-relieve: 6px 6px 0 rgb(10 17 18 / .28);   /* fotos sobre la pared, como las letras en relieve */
}
```

Al lado de cada token va un comentario con su rol y sus pares medidos (el patrón de lusof), igual que arriba pero con los números de la tabla que sigue.

### 3.1 Pares usados (el único repertorio permitido)
Mínimos: texto 4,5; texto grande (≥ 24 px, o ≥ 18,66 px en negrita) 3; no-texto y foco 3.

| Fondo | Qué va encima (rol) | Contraste |
|---|---|---|
| `telon` | `arroz`: texto | **16,72** |
| `telon` | `ceniza`: texto secundario, pie, franja superior | **7,15** |
| `telon` | `letrero`: rótulo y «RESTAURANTE» (también a 12 px) | **6,19** |
| `telon` | `maiz`: eyebrow, íconos, anillo de foco, rombos | **9,22** |
| `telon` | `oro`: anillo del monograma (no-texto) | 6,66 |
| `telon` | borde `arroz` al 55 % de `.btn-linea-clara` (no-texto) | 5,62 |
| `letrero` (relleno) | `telon`: texto de `.btn-letrero` | **6,19** |
| `letrero-claro` (relleno) | `telon`: hover de `.btn-letrero` | **7,59** |
| `telon` (relleno) | `arroz`: texto de `.btn-telon` | **16,72** |
| mezcla telón 85 % + arroz | `arroz`: hover de `.btn-telon` | 11,43 |
| `maiz` (relleno) | `telon`: `.badge-maiz`, voto «Igual», avisos | **9,22** |
| `barro` (relleno) | `arroz`: `.badge-barro`, voto «No», error | **6,65** |
| `turquesa` (relleno) | `papel`: `.badge-turquesa`, voto «Me gusta» | **5,27** |
| `arroz` | `telon`: texto | **16,72** |
| `arroz` | `apoyo`: texto secundario | **6,05** |
| `arroz` | `barro`: eyebrow, enlaces, foco, íconos | **6,65** |
| `arroz` | `turquesa`: estado, íconos | **4,70** |
| `papel` | `telon`: texto, precios | **18,74** |
| `papel` | `apoyo`: texto secundario, placeholder, borde de campo (no-texto) | **6,79** |
| `papel` | `barro`: enlaces, foco | **7,45** |
| `papel` | `turquesa`: estado | **5,27** |
| `pared` | `telon`: **todo** (texto, íconos, foco, botón `.btn-telon`, rombos) | **6,71** |
| `selva` | `arroz`: **todo** el texto, enlaces y foco | **6,70** |
| `selva` | `maiz`: solo íconos y rombos (no-texto) | 3,69 |

**Prohibidos** (la prueba los documenta, no los usa):
- **Sobre claro:**
  - `letrero` como texto: arroz 2,70 · papel 3,03.
  - `maiz`: arroz 1,81 · papel 2,03.
  - `ceniza`: arroz 2,34 · papel 2,62.
  - `oro`: papel 2,81.
  - `naranja`: arroz 3,88.
  - `linea` como texto: 1,31 / 1,47.
- **Sobre `pared`:**
  - `letrero` 1,08 (el botón coral **desaparece** en la pared).
  - `arroz` 2,49 · `papel` 2,79 · `apoyo` 2,43 · `barro` 2,67.
- **Sobre `selva`:**
  - `letrero` como texto 2,48 · `ceniza` 2,87 · `telon` 2,50 · `turquesa` 1,42.
  - `maiz` como texto 3,69.
- **Sobre `telon`:**
  - `turquesa` 3,56 · `naranja` 4,31 · `barro` 2,52 · `apoyo` 2,76 como texto.
- **Sin texto con transparencia** (`text-arroz/70` y similares). Para el secundario sobre telón está `ceniza`. La transparencia solo se permite en bordes, divisores y fondos de hover.

Notas:
- **`.btn-letrero` sobre claro o sobre `selva`:** el relleno contra el fondo da 2,70 / 3,03 / 2,48. Se acepta porque el control se identifica por su texto (`telon` sobre `letrero`, 6,19), no por su borde. **Sobre `pared` está prohibido.**
- **`linea`** es decorativa. Donde un borde sea lo único que identifica un control (campos del diálogo y del menú), el borde va en `apoyo` (6,79).

### 3.2 Variables de contexto (en `componentes.css`)
```css
:focus-visible { outline: 2px solid var(--foco, var(--color-barro)); outline-offset: 2px; }
.eyebrow { color: var(--eyebrow, var(--color-barro)); }
.rombo   { background: var(--rombo, var(--color-barro)); }
.sobre-telon { --foco: var(--color-maiz);  --eyebrow: var(--color-maiz);  --rombo: var(--color-maiz); color-scheme: dark; } /* 9,22 */
.pared       { --foco: var(--color-telon); --eyebrow: var(--color-telon); --rombo: var(--color-telon); }                   /* 6,71 */
.sobre-selva { --foco: var(--color-arroz); --eyebrow: var(--color-arroz); --rombo: var(--color-maiz); }                    /* 6,70 */
```
- `.sobre-telon` va en toda superficie `telon` con texto o controles: franja superior, nav y menú móvil, `#inicio`, `#platos`, `#como-llegar`, pie y barra móvil.
- `.sobre-selva` va en `#la-casa`.
- `.pared` va en `#hoy` y `#celebraciones`.
- Por defecto (claro) rige `barro` (6,65 / 7,45).

### 3.3 Mapeo explícito de lo viejo a lo nuevo (landing, carta, menú, `componentes.css`, `landing.css`, `carta-menu.css`, `assets/js`)

| Hoy (v1) | Pasa a | Nota |
|---|---|---|
| `parch` (fondo de `body`, `bg-parch`) | `arroz` | |
| `text-parch`, `text-parch/85`, `text-parch/90` (sobre ink) | `text-arroz` | sin alfa |
| `text-parch/70`, `text-parch/55`, `text-parch/40` | `text-ceniza` | 7,15 |
| `parch-d` | `linea` | |
| `ink`: `text-ink`, `bg-ink`, `border-ink`, `var(--color-ink)` | `telon` | bandas, texto sobre claro y bordes de `.btn-linea` |
| `ink-5`, `muted` (texto secundario) | `apoyo` sobre claro · `ceniza` sobre telón | |
| `ink-3` | `linea` en bordes; como texto, `apoyo` | |
| `card` (`bg-card`, `#fff`, `bg-card/95`, `/97`) | `papel` (`bg-papel`, `bg-papel/95`) | |
| `line` (`border-line`, `divide-line`, `bg-line`) | `linea` | |
| `soft` (hover, fondo de badge, discos de ícono) | `arroz` sobre `papel`. Hover genérico: `color-mix(in srgb, currentColor 8%, transparent)` | |
| `ember` como relleno (`.btn-ember`, `.btn-primary`, `.tab-on`) | `letrero` con texto `telon` (`.tab-on` pasa a `telon`, ver §10) | nunca texto blanco |
| `text-ember` (íconos y texto sobre claro) | `text-barro` | 6,65 |
| `ember-light` | `letrero-claro` | |
| `ember-faint`, `.badge-ember` | `.badge-barro` | 6,65 |
| `amber` como relleno (`.btn-oro`) | `.btn-telon` (en `#celebraciones`, sobre la pared) | |
| `text-amber` (íconos sobre ink) | `text-maiz` sobre telón · `text-telon` sobre la pared | |
| `amber-tinta` en precios y total de la cuenta | `text-telon font-semibold tabular` (fuente sans) | se acaba el oro como texto |
| `amber-tinta` en eyebrow, avisos e ícono de preguntas | `barro` | |
| `amber-light` (sobre ink) | `maiz` | |
| `amber-faint`, `.badge-amber` | `.badge-maiz` | 9,22 |
| `bg-amber-faint` (discos de íconos de `#la-casa`) | sin disco: ícono `text-maiz` directo sobre `selva` | no-texto 3,69 |
| `border-amber/40` (hover de tarjeta) | `border-barro` | |
| `teal`, `teal-tinta`, `teal-light` | `turquesa` | |
| `teal-faint`, `.badge-teal` | `.badge-turquesa` (relleno) | 5,27 |
| `terracota` | `pared` | mismo hex |
| `letrero` | `letrero` | mismo hex; ahora también relleno de la acción |
| `text-white`, `bg-white/10`, `border-white/10`, `divide-white/10` | `text-arroz`, `bg-arroz/10`, `border-arroz/15`, `divide-arroz/15` | la paleta por defecto deja de existir |
| `.sobre-ink` | `.sobre-telon` | |
| `.btn-ember` · `.btn-primary` | `.btn-letrero` · `.btn-primary` (alias; lo usan carta y menú) | |
| `.btn-ink` · `.btn-oro` | `.btn-telon` | |
| `.btn-claro` · `.btn-secondary` · `.btn-outline` | `.btn-linea` (los tres alias se conservan) · sobre telón, `.btn-linea-clara` | |
| `.vigas` | `.franja` | |
| `.aplique`, `.aplique-oro` | `.rombo` | |
| `.filete` | sale del marcado (la reemplaza la franja) | la regla puede quedar o borrarse |
| `.rotulo` (v1) | `.rotulo` + `.rotulo-sub` (§5.2) | |
| `font-display` (Fraunces) | `font-display` (Cinzel) **solo** en marca, H2, títulos de categoría y diálogo | precios, nombres de plato, números de día, `h3` y botones → `font-sans` |
| `--shadow-sombra` | mismo nombre, color telón | |
| Hex sueltos de `carta-menu.css` y `menu.html` (`#fff`, `#FAF7F2`, `#FCFAF7`, `#E9E2D7`, `#EFEAE3`, `#F6F2EC`, `rgba(28,26,23,…)`, índigo `#6366F1`/`#4F46E5`/`#EEF0FE`/`#F6F4FF`/`#E0E1FB`) | `papel`, `arroz`, `linea`, `telon` con alfa y `turquesa` (§10) | `.react.on-mover` (sin uso en el marcado) se elimina |

---

## 4. Tipografía

El **mismo par de `<link>`** va en las tres páginas, byte a byte igual. Reemplaza al de Fraunces y DM Sans:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=Archivo:wght@400..700&display=swap" rel="stylesheet" />
<link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&text=R&display=swap" rel="stylesheet" />
```

Bajado y medido el 2026-09-28 (woff2 latin):

| Archivo | Bytes |
|---|---|
| Archivo 400..700 (variable) | 34 940 |
| Cinzel 700 (estático) | 15 224 |
| Cinzel Decorative 700, solo la «R» | 820 |
| **Total** | **50 984 B ≈ 51 KB** (la v1: 104,4 KB) |

- Las dos hojas CSS de Google pesan 2,3 KB y 0,3 KB.
- Pedir `Cinzel:wght@700..900` sube a 25,9 KB. No se pide ningún peso de Cinzel fuera del 700.
- Archivo ya trae cifras de ancho fijo: `111111` y `000000` miden igual en Chromium. `.tabular` se mantiene igual, por si acaso.

| Nivel | Estilo | 375 px | 1440 px |
|---|---|---|---|
| Rótulo del hero (`.rotulo`) | Cinzel 700, mayúsculas, `letter-spacing: .02em`, `line-height: .9`, `clamp(2.6rem, 1.4rem + 5.2vw, 4.5rem)`, `letrero` | 42 | 72 |
| «RESTAURANTE» (`.rotulo-sub`) | Cinzel 700, mayúsculas, `letter-spacing: .42em`, `clamp(.78rem, .62rem + .45vw, 1.125rem)`, `letrero` | 12,5 | 18 |
| Lema (parte del H1) | Archivo 600, `clamp(1.3rem, 1rem + 1.1vw, 1.875rem)/1.2`, `arroz`, `text-wrap: balance` | 21 | 30 |
| H2 (`.titulo-seccion`) | Cinzel 700, `clamp(1.75rem, 1.3rem + 2vw, 2.75rem)/1.1`, `text-wrap: balance`, **máximo 6 palabras** | 28 | 44 |
| H3 | Archivo 600, 1.125rem | 18 | 18 |
| Texto | Archivo 400, `1rem/1.6`; desde `lg`, `1.0625rem` | 16 | 17 |
| Eyebrow (`.eyebrow`) | Cinzel 700, `.75rem`, mayúsculas, `letter-spacing: .24em` (el eco de «RESTAURANTE») | 12 | 12 |
| Botón | Archivo 600, `.95rem` | 15,2 | 15,2 |
| Precio | Archivo 600, `.tabular`, `telon` | — | — |
| Rótulo del pie | `.rotulo` con `--rotulo: clamp(2.6rem, .5rem + 9vw, 8rem)`, centrado | 42 | 128 |

Reglas:
- Cinzel dibuja la minúscula como versalita. En el HTML se escribe en caja normal («Menú de hoy») y el CSS decide.
- Cinzel nunca va en párrafos, botones, precios, nombres de plato que llegan de la base ni números de día.
- **La R:** `.rotulo::first-letter { font-family: var(--font-r); }`. La palabra queda entera en el DOM («Resplandor»), sin `<span>` que la parta para un lector de pantalla. `.rotulo` es `display: block`, que `::first-letter` necesita.
- Anchos medidos (7,38 × el tamaño de fuente para «RESPLANDOR» con la R decorativa): 42 px dan 309 px, que caben en 343 a 375 px y en 328 a 360 px; 72 px dan 531 px; 128 px dan 945 px, que caben en 1104.
- **Tope a 320 px (2026-09-29):** el suelo de `2.6rem` (42 px → 309 px) no cabía en los 288 px de una pantalla de 320 px (100vw menos `px-4` a cada lado): en el hero la última R salía de la pantalla y en el pie empujaba 5 px de scroll lateral. `.rotulo` toma el menor entre su tamaño y `calc((100vw - 2rem) / 7.5)` (7,5 = los 7,43 medidos con un poco de holgura). El tope solo actúa por debajo de ≈ 344 px: a 320 px el rótulo del hero y del pie pasa a 38,4 px (285 px de palabra) y del contrato de arriba no se mueve ninguna cifra (42 px a 375; 72 px y 128 px a 1440). Lo vigila `scripts/pruebas/desborde.test.mjs`.
- Sin itálica en ninguna de las tres páginas (grep §13-B).
- Si el CLS del cambio de fuente pasa de 0,02, se agrega un `@font-face` de respaldo con `src: local('Georgia')` y `size-adjust` calibrado para el rótulo. No se hace por adelantado.

---

## 5. Motivos propios (cinco; ninguno más)

### 5.1 `.franja`: el ritmo del mural (en `componentes.css`, porque la usan las tres páginas)
Es un módulo de 32×14 con triángulos invertidos en `turquesa`, con un punto `arroz` cada dos, y triángulos hacia arriba que alternan `naranja` y `maiz`. Arriba lleva un filete `maiz` y el fondo es `telon`.
- **No calca la obra:** no toma estrellas, flechas, «ojos» ni proporciones de la cenefa, ni nada de la figura.
- Pesa 573 B. Revisado renderizado a 12 y 16 px: `scratchpad/juez-v2/franja-zoom.png`.
```css
.franja {
  display: block; height: .75rem;                 /* 12 px; desde lg, 1rem */
  background: var(--color-telon) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='14' viewBox='0 0 32 14'%3E%3Crect width='32' height='14' fill='%230A1112'/%3E%3Cg stroke='%230A1112' stroke-width='1'%3E%3Cpath d='M-8 3h16L0 13z' fill='%232A738A'/%3E%3Cpath d='M24 3h16l-8 10z' fill='%232A738A'/%3E%3Cpath d='M8 3h16l-8 10z' fill='%232A738A'/%3E%3Cpath d='M0 13 8 3l8 10z' fill='%23C5571A'/%3E%3Cpath d='M16 13l8-10 8 10z' fill='%23E9A91F'/%3E%3C/g%3E%3Crect width='32' height='1.4' fill='%23E9A91F'/%3E%3Ccircle cx='16' cy='6.6' r='1.3' fill='%23F4F0E3'/%3E%3C/svg%3E") repeat-x 0 0 / auto 100%;
}
@media (min-width: 1024px) { .franja { height: 1rem; } }
```
- Siempre `aria-hidden="true"`.
- **Única excepción a «ningún hex en CSS»:** los cinco hex del data-URI (`0A1112`, `2A738A`, `C5571A`, `E9A91F`, `F4F0E3`) tienen que ser tokens. La prueba de §13-A5 los compara contra `base.css`.
- **Usos en la landing (4 como máximo):**
  1. Primera línea de `#inicio`, bajo la nav.
  2. Borde superior de `#platos`.
  3. Borde superior de `#la-casa`.
  4. Borde superior del pie.
- **En carta y menú, 1 uso:** bajo la cabecera.

### 5.2 `.rotulo` y `.rotulo-sub`: el letrero (en `componentes.css`)
```css
.rotulo { display: block; font-family: var(--font-display); font-weight: 700; text-transform: uppercase;
          letter-spacing: .02em; line-height: .9; color: var(--color-letrero);
          font-size: min(var(--rotulo, clamp(2.6rem, 1.4rem + 5.2vw, 4.5rem)), calc((100vw - 2rem) / 7.5)); }
.rotulo::first-letter { font-family: var(--font-r); }
.rotulo-sub { display: block; margin-top: .6rem; font-family: var(--font-display); font-weight: 700;
              text-transform: uppercase; letter-spacing: .42em; color: var(--color-letrero);
              font-size: clamp(.78rem, .62rem + .45vw, 1.125rem); }
```
Solo va sobre `telon`: `letrero` 6,19. Aparece en cuatro lugares:
- En el H1 del hero.
- En la nav desde `sm`, con `--rotulo: 1.35rem` y sin `.rotulo-sub`.
- En la cabecera de carta y menú, con `--rotulo: 2.25rem`, centrado.
- En el pie, `aria-hidden="true"` porque el nombre ya está en el texto del pie.

### 5.3 `.rombo`: el punto de la franja, girado (en `componentes.css`)
```css
.rombo { display: inline-block; flex-shrink: 0; width: .5rem; height: .5rem; transform: rotate(45deg);
         background: var(--rombo, var(--color-barro)); }
.hero li:nth-child(2) .rombo { --rombo: var(--color-naranja); }   /* 4,31 sobre telón, no-texto */
.hero li:nth-child(3) .rombo { --rombo: var(--color-turquesa); }  /* 3,56 sobre telón, no-texto */
```
- Es una viñeta decorativa (`aria-hidden`) y reemplaza a `.aplique`.
- En el hero lleva los tres colores de la franja. En el resto de la página, el de su contexto (§3.2).

### 5.4 `.friso`: las fotos de estudio como una sola pared (en `landing.css`)
```css
.friso { display: grid; grid-auto-flow: column; grid-auto-columns: 15rem;  /* 240 px */
         overflow-x: auto; scroll-snap-type: x mandatory; gap: 0;
         scrollbar-width: thin; scrollbar-color: var(--color-ceniza) transparent; }
.friso > * { aspect-ratio: 4 / 5; scroll-snap-align: start; overflow: hidden; background: var(--color-telon); }
.friso img { width: 100%; height: 100%; object-fit: cover;
             -webkit-mask-image: linear-gradient(#000 76%, transparent); mask-image: linear-gradient(#000 76%, transparent); }
.friso video { width: 100%; height: 100%; object-fit: cover; }            /* SIN máscara: taparía los controles */
.friso video:focus-visible { outline-offset: -4px; }                      /* el anillo no se recorta (hallazgo v1) */
@media (min-width: 1024px) { .friso { grid-auto-flow: row; grid-template-columns: repeat(4, 1fr); overflow: visible; } }
```
- **Contenedor:** `<div class="friso" role="region" aria-label="Fotos de platos" tabindex="0">`. Hasta `lg` es desplazable con teclado y va a sangre (`-mx-4 sm:-mx-6 px-4 sm:px-6 scroll-px-4`).
- **Máscaras:** una sola por foto, solo vertical, sin `mask-composite`. Si el navegador no soporta la máscara, la foto se ve rectangular sobre el telón, que es del mismo negro.
- `linear-gradient` queda **permitido solo dentro de `mask-image`**, aquí y en el hero (§7.1).

### 5.5 `.pared` y el relieve (ya existen; se re-tokenizan)
- `.pared` conserva el grano de estuco de la v1 (`::before` con `feTurbulence`, `opacity: .07`, `multiply`) y pasa a `background: var(--color-pared)`.
- Ahora se usa en `#hoy` y `#celebraciones`.
- Toda foto sobre la pared lleva `shadow-relieve` y esquinas rectas: es la sombra dura de las letras del salón.

**El monograma no es un motivo nuevo:** el logo real (`img/logo-r.webp`, la R dorada de Camila) sigue como medallón.
- `.monograma` usa fondo `papel` y anillo `oro` de 1,5 px.
- Con `<img>` adentro, el anillo propio se apaga, igual que en la v1.

**Prohibido en esta fase:**
- Copiar la figura del mural o calcar su cenefa.
- Hojas, flores o siluetas dibujadas.
- Lámparas, madera o estuco en CSS fuera de `.pared`.
- Sombra de texto, brillo o «encendido» del letrero.
- `radial-gradient`, y `linear-gradient` fuera de `mask-image`.
- Emojis en botones.
- El color o el brillo del letrero de noche.

---

## 6. Tratamiento de fotos y movimiento

- **Estudio** (tela negra):
  - Sin marco ni radio, sobre `telon`.
  - Se funden con la máscara vertical de §5.4 o con la del hero (§7.1).
  - Sin nombre ni precio.
- **Documentales** (salón, mesa y fachada):
  - Enteras, con esquinas rectas (`rounded-none`).
  - Sobre la pared llevan `shadow-relieve`. Sobre claro, `border border-linea`. Sobre `selva` y `telon`, nada.
- **Pies de foto:** nombran el **material o el lugar**, no el plato («Cazuela negra», «Vasos de barro», «El mural», «La pared terracota»). Van en `.eyebrow` y **nunca sobre la foto**, siempre debajo.
  - La única excepción es el rótulo del hero, que sube 1rem (`-mt-4`) sobre la parte fundida de la foto, donde la tela ya es negra (`#0B0E0F`; letrero encima, 6,2). Con 2rem el borde superior de las mayúsculas se cruzaba con el plato y el coral bajaba de 3:1 a 360–414 px (H11 de la ronda 0). Con 1rem, medido contra cada píxel de letra, ninguna baja de 4,7 entre 320 y 1440 px.
- **Atributos:**
  - `alt` **idéntico** al de `recursos.json`.
  - `width` y `height` del recurso.
  - `loading="lazy" decoding="async"` salvo el hero.
  - `srcset` con **todas** sus variantes y un `sizes` por columna (§7).
  - Todas las fuentes de un `<picture>` o un `srcset` son del **mismo id** o de uno con `deriva_de` hacia él.
- **Movimiento:**
  - Se conservan `data-aparecer` y `.hero-entra` de la v1. No se agrega ninguna animación.
  - Sin parallax, sin escalado al pasar el cursor y sin nada en bucle.
  - Video solo con `controls` y `preload="none"`, sin `autoplay` ni `loop`.
  - `prefers-reduced-motion` sigue en el bloque único de `base.css`.

---

## 7. Plan sección por sección de `index.html`

- **Contenedor:** `max-w-6xl mx-auto px-4 sm:px-6`, así que el ancho útil a 1440 px es de 1104 px.
- **Rutas:** `img/referencias/<categoría>/<id>-<ancho>.webp`.
- **Orden y bandas** (los ids y el orden de la v1 se conservan; `#platos` sigue fuera de la nav):

| # | Sección | Banda | Franja arriba |
|---|---|---|---|
| — | Franja superior, nav | `telon` (`.sobre-telon`) | — |
| 1 | `#inicio` | `telon` | **sí** (1.ª línea) |
| 2 | `#hoy` | `pared` | — |
| 3 | `#platos` | `telon` | **sí** |
| 4 | `#carta` | `papel` | — |
| 5 | `#almuerzo-programado` | `arroz` | — |
| 6 | `#celebraciones` | `pared` | — |
| 7 | `#la-casa` | `selva` (`.sobre-selva`) | **sí** |
| 8 | `#como-llegar` | `telon` | — |
| 9 | `#preguntas` | `arroz` | — |
| — | Pie | `telon` | **sí** |

### 7.0 Franja superior, nav, barra móvil y `<dialog>`
- **Franja superior:** `div.sobre-telon.bg-telon.text-ceniza.text-xs.text-center.py-2`, sin borde.
  - Texto: «Abierto todos los días · 12:00–17:00<span class="hidden sm:inline"> · Cra. 61 #79 Sur-62, La Estrella</span>».
  - A 375 px queda en una línea de 32 px (la v1 ocupaba dos).
- **Nav:** `header.sobre-telon.bg-telon/95.border-b.border-arroz/10.backdrop-blur-sm`, sticky y de `h-16`.
  - A la izquierda, `a > .monograma.size-10 > img[logo-r]` y, desde `sm`, `span.rotulo` con `--rotulo: 1.35rem`.
  - Enlaces en `text-ceniza hover:text-arroz`, `min-h-11 min-w-11`, en el orden de la v1: Menú de hoy · Carta · Almuerzo programado · Celebraciones · La casa · Cómo llegar.
  - **Corte del nav en `lg` (1024 px), no en `md`:** con el rótulo Cinzel de 210 px la barra de escritorio medía 841 px y desbordaba a 768 y a 820 (hallazgo de la ronda 0). Los enlaces (`hidden lg:flex`), el botón del menú móvil, su panel y la barra móvil pasan todos a `lg`. El enlace de la marca lleva `min-h-11 min-w-11` (el medallón es de 40 px, la zona táctil de 44) y los enlaces del panel móvil van en `py-3` (44 px con `text-sm`): §13-C2 los mide.
  - `button.btn.btn-letrero` «Reservar» abre `abrir('reserva')`.
  - El `.btn-icon` del menú móvil va con `border-arroz/25 text-arroz`, sin fondo.
  - Menú móvil: `bg-telon`, enlaces `text-arroz`, divisores `border-arroz/10`. El panel es **absoluto** (`absolute inset-x-0 top-full`, `max-h-[calc(100dvh-4rem)] overflow-y-auto`) y cuelga de la cabecera sin empujar la página: en flujo, al cerrarse tras tocar un enlace la cabecera encogía 314 px y el salto a `#ancla` aterrizaba 314 px más abajo, con el título de la sección fuera de pantalla (`identidad.test.mjs`, sección 9).
- **Barra móvil** (`#barra-movil`, la lógica no cambia): `bg-telon/95 border-t border-arroz/15 .sobre-telon`, con «Reservar» (`.btn-letrero flex-1`) y «WhatsApp» (`.btn-linea-clara`).
- **`<dialog id="solicitud">`** (el marcado y la lógica no cambian):
  - Superficie `bg-papel text-telon`, con `color-scheme: light`.
  - `::backdrop` en `rgb(from var(--color-telon) r g b / .6)`.
  - Título en `font-display`.
  - `.campo` en `bg-papel`, borde de 1,5 px `apoyo` (6,79) y `rounded-lg`. El foco lo da el anillo `barro`.
  - Vista previa del mensaje en `bg-arroz border border-linea`.
  - Avisos en `.badge-maiz`.
  - «Abrir WhatsApp» con `.btn-letrero w-full`.

### 7.1 `#inicio`: el letrero abre (`section.sobre-telon.bg-telon.text-arroz.relative.overflow-hidden.hero`; reemplaza `landing.html:277-326`)
- **Estructura:** `div.franja` y, detrás, la foto y el texto. Desde 1024 px la foto es absoluta y cubre todo el alto de la sección, franja incluida; por eso `.hero > .franja` lleva `position: relative; z-index: 10` (`landing.css`) y el ritmo se ve entero de borde a borde (hallazgo de la ronda 0, `identidad.test.mjs`). El bloque de texto lleva `relative z-10` por lo mismo, y la foto `max-w-none` para llegar a sangre hasta 1023 px (el `max-width: 100%` del preflight la recortaba).
- **Recurso:** `plato-sopa-jugo-estudio` (1600×1588; variantes 480/960/1600 de 20/49/96 KB). Es la **única** `<img>` con `fetchpriority="high"` y sin `loading`.
  ```html
  <img class="hero-foto" src="img/referencias/platos/plato-sopa-jugo-estudio-960.webp" width="1600" height="1588"
    srcset="img/referencias/platos/plato-sopa-jugo-estudio-480.webp 480w,
            img/referencias/platos/plato-sopa-jugo-estudio-960.webp 960w,
            img/referencias/platos/plato-sopa-jugo-estudio-1600.webp 1600w"
    sizes="(min-width: 1024px) 55vw, 100vw" fetchpriority="high" alt="…alt de recursos.json…">
  ```
- **Hasta 1023 px:** la foto va a sangre, con `aspect-[4/3] w-full object-cover object-[50%_10%]`, en ese orden desde arriba.
  - A 375 px se ve del 2 % al 78 % de la altura: la franja del mural, el plato, la sopa y el jugo.
  - Máscara: `mask-image: linear-gradient(#000 70%, transparent)`.
  - El bloque de texto sube `-mt-4`, así que el rótulo cae sobre la tela negra fundida. No lo subas a `-mt-8`: la foto queda al 35–40 % de opacidad detrás del borde superior de las mayúsculas y el coral baja a ≈ 2:1 (H11). `identidad.test.mjs` fija el tope en `-mt-4`, la máscara en 70 % y la proporción 4/3 de la foto.
- **Desde 1024 px:** `lg:absolute lg:inset-y-0 lg:right-0 lg:w-[55vw] lg:h-full lg:aspect-auto lg:object-[50%_32%]`.
  - Máscara: `mask-image: linear-gradient(to right, transparent, #000 28%)`.
  - El texto va en el contenedor con `relative z-10 lg:max-w-[34rem] lg:py-[clamp(4rem,7vw,6.5rem)]`.
  - A 1440 px el rótulo (72 px, 531 px de ancho) termina en x ≈ 699, dentro del primer 23 % del fundido (la foto arranca en x = 648): queda sobre negro. Lo comprueba axe (§13-C10).
- **Texto:**
  ```html
  <h1 class="hero-entra">
    <span class="rotulo">Resplandor</span>
    <span class="rotulo-sub">Restaurante</span>
    <span class="lema">Almuerzo colombiano y asados, todos los días de 12 a 5</span>
  </h1>
  ```
  - `.lema`: `display:block; margin-top:1rem`, estilo de §4.
  - Bajada en `text-arroz`, `max-w-md`: «Cocina colombiana, asados y cocina mixta en Poblado del Sur, La Estrella. El mismo salón donde almuerzas se reserva para celebrar, de 10 a 30 personas.»
  - Tres puntos (`ul` con `.rombo`, `text-sm`), que la especificación exige:
    - «Almuerzo todos los días, de 12:00 a 5:00 de la tarde.»
    - «Celebraciones en el local, de 10 a 30 personas.»
    - «Un menú de la semana que la gente vota.»
- **CTA** (apilados a `w-full` en móvil; desde `sm`, en fila):
  - `.btn-letrero` «Reservar mesa» → `$store.solicitud.abrir('reserva')`.
  - `.btn-linea-clara` «Cotizar una celebración» → `#celebraciones`.
  - `.btn-ghost text-arroz` «Ver la carta» → `#carta`.
- **Cálculo a 375×812** (medido en Chromium): franja superior 32 + nav 64 + franja 12 + foto 281 = 389. El rótulo va de ≈ 374 a 440 y el lema termina en ≈ 506, así que **el H1 queda completo en y ≈ 506**. La barra fija empieza en ≈ 735. A 360×640 la barra empieza en ≈ 563 y el H1 termina en ≈ 495: corrige el hallazgo de la v1 en teléfonos bajos.
- **Cálculo a 1440×900:** el H1, los tres puntos y «Reservar mesa» terminan en y ≈ 740.

### 7.2 `#hoy`: el tablero en la pared (`section.pared.seccion`, sobre la lógica de `landing.html:340-440`)
- **Texto y estados:**
  - Eyebrow «Hoy en el salón» y H2 «Menú de hoy».
  - Bajada de la v1 en `text-telon`: sobre la pared no va `apoyo` ni ningún otro color.
  - La lógica en vivo (cargando, error y listo) no cambia. Sus tarjetas son `.card.card-soft` (papel), y adentro vale todo el repertorio de claro.
  - El error (402 hoy) usa `.btn-linea` «Reintentar» y `.btn-ghost` «Ver menu.html».
  - «Ver la semana completa y votar» va en `.btn-ghost` `telon`.
- **Foto, solo desde 768 px:** `md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:grid-cols-[minmax(0,40rem)_minmax(0,23.75rem)] md:gap-10`, con `figure.hidden.md:block`.
  - Recurso nuevo `mesa-sopa-plato-mural-fondo-3x4` (§8; 480/830). Es el almuerzo servido frente a la mujer del mural.
  - `aspect-[3/4] object-cover object-[50%_45%] shadow-relieve`.
  - `sizes="(min-width: 1024px) 380px, 40vw"`.
  - `figcaption.eyebrow`: «El almuerzo, frente al mural».
  - Por debajo de 768 px, oculta y lazy: **no se descarga**.
- El ícono `i-moon` del estado «sin plato fijo» pasa a `text-apoyo`, porque vive dentro de la tarjeta papel.

### 7.3 `#platos`: lo que sale de la cocina (`div.franja` + `section.sobre-telon.bg-telon.text-arroz.seccion`)
- **Texto:**
  - Eyebrow «De la cocina» y H2 «Lo que sale de la cocina».
  - Bajada `text-ceniza max-w-2xl`: «Platos que hemos servido, fotografiados sobre tela negra con el mural detrás. Lo que hay hoy, con su precio, está en la carta.»
- **`.friso`** (§5.4). Las fotos van en este orden, cada una con `sizes="(min-width: 1024px) 276px, 240px"`:
  1. `tacos-maiz-rellenos-fondo-oscuro`, `object-[50%_55%]`.
  2. `bowl-cerdo-mango-fondo-oscuro`, `object-[50%_50%]`.
  3. `arepa-rellena-carne-desmechada`, `object-[50%_45%]`.
  4. El video `muestra-platos-estudio`. Va `controls preload="none" playsinline muted width="576" height="1024"`, con `poster` y un `aria-label` idéntico al `alt` **corregido** de §8.
- **Descargas que resultan:** a 375 px (DPR 2) bajan las variantes 480 (24,4/33,5/23,8 KB); a 1440 px (DPR 2), las 960 (76/96/56 KB).
- **Debajo del friso:** `p.text-ceniza` «Lo que hay hoy, con su precio, está en la carta.» y `a.btn.btn-linea-clara` «Ver la carta» → `#carta`. Hasta `lg`, además, `p.text-ceniza.text-sm.lg:hidden` «Desliza para ver más».
- **Sin nombres de plato ni precios.** Si Camila confirma nombres, se agregan como texto, nunca con precio.

### 7.4 `#carta`: la carta en vivo (`section.bg-papel.seccion`; la lógica y las pestañas de `landing.html:494-565`, intactas)
- **Si la carta en vivo no carga (2026-09-29):** se ve la instantánea de `assets/js/carta-respaldo.js` (la misma de `carta.html`), con un aviso `role="note"` sobre las pestañas —`border-linea bg-arroz text-telon`, ícono `info` en `barro`— que dice «Precios del 3 de septiembre de 2026; confírmalos al reservar.» La caja de error («No pudimos cargar la carta en vivo») solo queda si ni el respaldo cargó. «Se lee en vivo: lo que ves acá es lo que hay hoy» solo se afirma cuando la fuente es en vivo.
- **Pestañas `.pestana`:** como `.tab` de §10 (activa en `telon` con texto `arroz`).
- **Filas:** nombre en Archivo 600 `telon`, descripción `apoyo` y precio `text-telon font-semibold tabular`.
- **Desde 1024 px:** `figure.hidden.lg:block` con `jugos-vasos-de-barro-splash`.
  - `aspect-[4/5] object-[50%_55%]`, `max-w-[384px]`, `border border-linea`.
  - `sizes="(min-width: 1024px) 384px, 100vw"`.
  - `figcaption.eyebrow`: «Vasos de barro». No afirma nada de los jugos (§15).

### 7.5 `#almuerzo-programado` (`section.bg-arroz.seccion`; textos y lógica de `landing.html:567-615`)
- **Texto, sin cambios:**
  - Frecuencias.
  - «Lo recoges en el restaurante, sin costo adicional.»
  - «O te lo llevamos a domicilio: el costo del domicilio corre por tu cuenta.»
  - Los tres pasos de «Cómo funciona».
  - `.btn-letrero` «Programar mi almuerzo» → `abrir('almuerzo')`.
  - Los íconos `i-store` e `i-bike` van en `text-barro`.
- **Foto, solo desde 768 px:** `md:grid-cols-[minmax(0,5fr)_7fr] md:gap-10`, a la izquierda.
  - `sopa-mazorca-plato-mesa`, `aspect-[4/5] object-[50%_50%] border border-linea`.
  - `sizes="(min-width: 1024px) 440px, 40vw"`.
  - `figcaption.eyebrow` «Cazuela negra».
  - A 375 px no se muestra ni se descarga (143 KB menos que la v1).
- `plato-sopa-jugo-estudio` sale de esta sección: ahora es el hero.

### 7.6 `#celebraciones`: en este mismo salón (`section.pared.seccion`; `landing.html:617-729`)
- **Texto:**
  - Eyebrow «Celebraciones» y H2 «Tu celebración, en este mismo salón».
  - Párrafo de la v1 en `text-telon`: «Cumpleaños, quinces, aniversarios, reuniones de trabajo: aquí, de 10 a 30 personas, con decoración de globos y un menú acordado. Todo evento es en el local; se cotiza por WhatsApp.» Sin precios.
- **Foto:** `almuerzo-servido-mesa-globos-apaisada` (4:3). Tiene la misma pared terracota detrás, así que la foto y la banda se leen como una sola pared.
  - `shadow-relieve`.
  - Hasta 1023 px, arriba y a todo el ancho. Desde 1024 px, `lg:col-span-5 lg:self-start`.
  - `sizes="(min-width: 1152px) 440px, (min-width: 1024px) 40vw, 100vw"`.
- **Los 8 tipos:** `ul.divide-y.divide-telon/20`. Cada fila lleva `py-4 min-h-11`:
  - ícono del sprite en `text-telon`;
  - `h3` en Archivo 600 `telon`;
  - una línea en `text-telon` (no `apoyo`);
  - `button.btn.btn-telon` «Cotizar`<span class="sr-only"> {nombre}</span>`» → `abrir('<id>')`.
- **Ids y textos:** los de hoy, en el mismo orden. La fila de cena romántica mantiene «en pareja».

### 7.7 `#la-casa`: las dos paredes (`div.franja` + `section.sobre-selva.bg-selva.text-arroz.seccion`; `landing.html:731-789`)
- **Texto:**
  - Eyebrow «La casa» y H2 «Un restaurante de barrio en La Estrella».
  - Texto en `text-arroz`: «Resplandor es el letrero rojo sobre negro de la Cra. 61. Adentro, dos paredes: la terracota con las letras en relieve y la del mural. Mesas de madera para 30 personas: el mismo salón para almorzar a diario y para celebrar.»
- **Hechos:** una lista sin tarjetas, con íconos `text-maiz` sin disco y texto `arroz`:
  - «30 personas en el salón», con debajo «Las celebraciones son de 10 a 30.». Reemplaza «Hasta 30 personas · La capacidad completa del local para tu celebración» (hallazgo v1).
  - «Todos los días, 12:00–17:00». **Se quita «El mismo horario, sin excepciones.»** (hallazgo v1: es inventado).
  - Enlace «5,0 en Google Maps · 2 reseñas» a la ficha, `text-arroz underline min-h-11`.
- **Fotos:** dos 3:4, lado a lado **en todo ancho** (`grid grid-cols-2 gap-3`):
  - `mural-mujer-indigena-salon` (`object-[35%_45%]`, con el rostro entero), `figcaption.eyebrow` «El mural».
  - `salon-pared-terracota-letrero` (`object-[35%_30%]`), `figcaption.eyebrow` «La pared terracota».
  - Desde 1024 px, `lg:grid-cols-12`: texto en `lg:col-span-5`, fotos en `lg:col-span-7`.
  - `sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 46vw"`. A 375 px (DPR 2) bajan las 480 (37,8 + 34,5 KB).
- **Crédito del mural:** no se inventa. Queda un comentario `<!-- crédito del mural: pendiente de Camila (§15) -->` en el lugar del `figcaption`. Cuando ella responda, va «Mural: {nombre}».
- `img/fachada-banderas.webp` y `img/fachada-azules.webp` siguen sin usarse. **No se borran.**

### 7.8 `#como-llegar`: busca el letrero (`section.sobre-telon.bg-telon.text-arroz.seccion`; `landing.html:791-843`)
Reemplaza la tarjeta angosta de 672 px, que a 1440 px dejaba media sección vacía (hallazgo v1).
- **Texto:** H2 «Cómo llegar».
- **Foto:** `figure` a todo el ancho del contenedor con `fachada-dia-flores-balcon`.
  - `aspect-[1080/310] object-cover object-[50%_60%]`.
  - `sizes="(min-width: 1152px) 1104px, 100vw"`.
  - `figcaption.text-ceniza.text-sm`: «Busca este letrero, rojo sobre negro, en la Cra. 61 #79 Sur-62.»
- **Datos:** `grid sm:grid-cols-3 gap-6` con íconos `text-maiz`:
  - «Cra. 61 #79 Sur-62, Poblado del Sur», con debajo, en `ceniza`, «La Estrella, Antioquia · Plus code 5954+9J».
  - «Todos los días, 12:00 a 5:00 de la tarde».
  - «+57 322 554 2434».
- **Botones** (en fila desde `sm`):
  - `.btn-letrero` «Cómo llegar» → `…/maps/dir/?api=1&destination=6.1584468%2C-75.6434789`.
  - `.btn-linea-clara` «Ver en Google Maps» → la ficha.
  - `.btn-linea-clara` «Escribir por WhatsApp» → `https://wa.me/573225542434`.

### 7.9 `#preguntas` (`section.bg-arroz.seccion`)
- El contenido de la v1 no cambia.
- El `summary` va en Archivo 600 `telon` y su ícono `i-circle-plus` en `text-barro`.
- Las respuestas van en `text-apoyo` y los divisores en `divide-linea`.

### 7.10 Pie (`div.franja` + `footer.sobre-telon.bg-telon.text-ceniza`)
- **Rótulo:** `p.rotulo.text-center` con `--rotulo: clamp(2.6rem, .5rem + 9vw, 8rem)` y `aria-hidden="true"` («RESPLANDOR»), más `p.rotulo-sub.text-center` («RESTAURANTE», también `aria-hidden`).
- **Columnas:** el contenido de la v1 (dirección, horario, WhatsApp, carta, menú y «Para agentes: llms.txt»).
  - Títulos en `.eyebrow` (maíz).
  - Enlaces en `.enlace-pie text-arroz underline`.
  - Copyright en `text-ceniza` (7,15). Se acaba `text-parch/40`.
- **«Abrir POS»** (desde la mudanza de raíz, 2026-09-29): `p#abrir-pos[hidden]` con un solo enlace `.enlace-pie text-arroz underline` a `pos.html`, dentro del bloque del copyright. Solo sale de su escondite en un equipo con sesión del POS (una clave `sb-…-auth-token` en `localStorage`) y nunca redirige. Arroz sobre telon (16,72) y 44 px de área táctil, como los demás enlaces del pie.

### Recursos que esta fase no usa (siguen en el banco)
| Recurso | Por qué |
|---|---|
| `fachada-noche-letrero-dorado` | Sugiere servicio de noche, y el local cierra a las 17:00 (§15) |
| `fachada-dia-globos-tricolor-banderas` | Decoración del Mundial ya pasada |
| `mojarra-frita-patacon-mesa` | Brazo y piernas de una persona en el borde (x 0–95 de la variante 900) |
| `hamburguesa-papas-mesa` | La marca de la gaseosa se lee en primer plano |
| `servicio-grupo-platos-fila` | Mesón de cocina y pared en obra |
| `frijoles-arepa-quesito-chicharron`, `arepa-quesito-frijoles-chicharron` | Dominante magenta en la mesa. Se corrige con una variante nueva, nunca con filtros CSS; queda para otra fase |
| `salon-pared-terracota-letrero-apaisada` | El hero ya no es la pared; `#la-casa` usa la vertical |
| `almuerzo-servido-mesa-globos` (vertical), `bandeja-grande-…`, `papas-cargadas-bowl`, `wrap-nachos-…`, `arepitas-…`, `arepa-carne-desmechada-detalle`, `jugos-vasos-de-barro-mesa`, `preparacion-arepa-carne-queso`, `mesa-sopa-plato-mural-fondo` (original) | Sin lugar en esta página |

---

## 8. Recortes, variantes nuevas y correcciones del banco (dueño: parte imágenes)

**1. Recorte nuevo 3:4 del mural con la mesa.** Quita el papel kraft con un logo parcial del borde izquierdo (crudo x 0–60, y 1060–1280) y la decoración que cuelga del techo (crudo y 0–100). Probado con la receta de la casa, en `scratchpad/juez-v2/m480.webp`:
```bash
scripts/recursos-imagen.sh img/referencias/_originales/mesa-sopa-plato-mural-fondo.jpeg \
  en-la-mesa mesa-sopa-plato-mural-fondo-3x4 "830x1107+70+190"
```
- Salen `-480.webp` (≈ 59 788 B) y `-830.webp` (≈ 128 552 B). La lista 480/960/1600 se corta en el ancho nativo, 830.
- Se mira cada salida con Read antes de registrarla.

**2. `recursos.json`, entrada nueva.** Lleva los campos de las demás más `"deriva_de": "mesa-sopa-plato-mural-fondo"`, `"orientacion": "vertical"`, `"foco": "50% 45%"`, `"uso_sugerido": "seccion"`, los `bytes` reales y `"ajustes": "Recorte 830x1107+70+190 sobre el crudo (900x1600): 3:4 sin el papel kraft con un logo parcial del borde izquierdo ni la decoración colgante del techo."`. El `alt` es este:
> «Almuerzo servido frente al mural del salón: un plato con un molde de arroz con maíz, ensalada con fresas, papas en rodajas y un pan, una sopa crema amarilla y un vaso con hielo; al fondo, la mujer indígena pintada entre hojas y flores tropicales.»

**3. Corrección de `alt`.** La de `muestra-platos-estudio` omite que el video **abre con unos 3 s del rostro de la mujer del mural** (hallazgo v1). Pasa a:
> «Video corto de estudio: abre con el rostro de la mujer del mural del salón y sigue con varios platos (papas cargadas, arepitas, tacos de maíz en un soporte y un bowl de cerdo con mango) sobre fondo negro, con la franja del mural detrás.»

El `aria-label` del `<video>` se copia idéntico.

**4. Verificación.** El `alt` del original `mesa-sopa-plato-mural-fondo` dice «un jugo», pero en la variante 900 el vaso parece de agua con hielo. Se mira y, si es así, se corrige. Hoy no se usa en ninguna página.

**5. Opcional, solo si §12 no cierra a 1440 px con DPR 2:** recodificar `sopa-mazorca-plato-mesa-960` con `-q 72` (hoy 146 947 B) con la misma receta, y actualizar sus `bytes`.

**6. `img/referencias/LEEME.md`:** una línea por el recorte nuevo, en la tabla de ajustes.

**Sin otros recortes.** El del tablero del letrero sin las flores infladas (propuesto por la dirección 3) espera la foto limpia que se le pide a Camila (§15), porque de la tira actual saldría una franja de 7:1 casi ilegible.

---

## 9. Favicon, `theme-color` y `og:image`

- **`theme-color`** pasa de `#1C1A17` a **`#0A1112`** en `index.html`, `carta.html` y `menu.html`. El POS conserva el suyo. *(2026-09-30: el POS adopta esta identidad y su `theme-color` pasa a `#0A1112`, ver `docs/pos-visual.md`.)*
- **Favicon y apple-touch** (`favicon.ico`, `img/favicon-32.png`, `apple-touch-icon.png`) **no cambian.** Son la R dorada de Camila sobre negro, que ya encaja con el telón.
- **`og:image`** (`img/og-resplandor.jpg`) **no cambia en esta fase.** Ya es fondo negro, monograma y fachada con el letrero coral.
  - Queda como pendiente rehacerla con el rótulo en Cinzel y la foto limpia del letrero cuando exista (§15).
  - El JSON-LD no se toca.

---

## 10. `carta.html` y `menu.html`: la identidad nueva

La maquetación y la lógica no cambian: se cambian fuente, color y cabecera. Las dos páginas llevan el mismo par de `<link>` (§4) y `theme-color #0A1112`.

**Cabecera común** (reemplaza `carta.html:132-140` y `menu.html:101-109`):
```html
<header class="reveal sobre-telon bg-telon text-arroz text-center px-4 pt-8 pb-6" style="--i:0">
  <a href="/" class="inline-block" aria-label="Ir a la página principal de Resplandor Restaurante">
    <span class="monograma size-14"><img src="img/logo-r.webp" width="46" height="46" alt="" class="rounded-full"></span>
    <span class="rotulo mt-4" style="--rotulo:2.25rem">Resplandor</span>
    <span class="rotulo-sub">Restaurante</span>
  </a>
  <h1 class="font-display text-lg text-arroz mt-3">Carta</h1>   <!-- «Menú de la semana» en menu.html -->
  <!-- solo carta.html, con la mesa que ya lee de ?m=&k= (carta.html:409); sin lógica nueva: -->
  <span class="badge badge-maiz mt-3" x-show="mesa" x-cloak>Mesa <span x-text="mesa"></span></span>
</header>
<div class="franja" aria-hidden="true"></div>
```

**Cuerpo** (`body` en `arroz`, tarjetas en `papel`):

| Lugar | Hoy | Pasa a | Contraste |
|---|---|---|---|
| carta:143 y menu:113, nav fija (`style="background:rgba(247,242,236,…)"`) | estilo en línea | `bg-arroz/90 backdrop-blur-md border-b border-linea` (sin `style`) | — |
| `.tab` / `.tab-on` (carta-menu.css) | card/line/muted · ember/blanco | `papel` / `linea` / `apoyo` · activa `telon` con texto `arroz` | 6,79 · 16,72 |
| carta:158, badge «Hoy · fecha» | `.badge-ember` | `.badge-barro` | 6,65 |
| carta:162, precio del día | `font-display text-amber-tinta` | `font-sans font-semibold text-telon tabular` | 18,74 |
| carta:166, check | `text-teal` | `text-turquesa` | 5,27 |
| carta:178, caja del ícono | `bg-card border-line text-ink` | `bg-papel border-linea text-telon` | — |
| carta:192, «De la casa» | `.badge-amber` | `.badge-maiz` (y `.badge` pasa a .75rem: el falso positivo de axe a 11,2 px era de tamaño) | 9,22 |
| carta:196, precio de ítem | `text-amber-tinta` | `text-telon font-semibold tabular` | 18,74 |
| carta:227, barra inferior | `rgba(247,242,236,.94)` en línea | `bg-arroz/95 backdrop-blur-md border-t border-linea`; botón `.btn-primary` (letrero) | 6,19 |
| carta:242 y 246, hoja de la cuenta | overlay `rgba(28,26,23,.45)` · `bg-card` · sombra en línea | `bg-telon/50` · `bg-papel` · `shadow-sombra` | — |
| carta:253, «Mesa N» | `font-display` | queda `font-display` | — |
| carta:292, total | `font-display text-amber-tinta` | `font-sans font-bold text-2xl text-telon tabular` | 18,74 |
| `text-muted`, `text-ink-5` (ambas páginas) | | `text-apoyo` | 6,05 / 6,79 |
| `bg-soft` (discos de estado) | | `bg-arroz` | — |
| menu:117, «Sin conexión» | `.badge-amber` | `.badge-maiz` | 9,22 |
| menu:207, 264 y 273, `.badge-teal` | | `.badge-turquesa` | 5,27 |
| menu:212 y 273, `.badge-amber` (fijo) | | `.badge-maiz` | 9,22 |
| menu:290, aviso en línea `amber-tinta`/`amber-faint` | `style` | `class="bg-maiz text-telon rounded-xl …"` | 9,22 |
| menu:303 y 304, barra de votos | `#EFEAE3` · `var(--color-teal)` | `bg-linea` · `var(--color-turquesa)` | — |
| menu:309, 317 y 318, «mover» (índigo) | `#4F46E5` · `#F6F4FF` · `#E0E1FB` | `text-turquesa` · `bg-papel` · `border-linea` | 5,27 |
| `.day-cell.hoy` / `.chip-day.sel` | ember | `barro` / `telon` | ≥ 3 (no-texto) |
| `.day-num` | `'Fraunces'` | `var(--font-sans)`, 700 | — |
| `.react` (`on-like` / `on-igual` / `on-dislike`) | teal / amber / ember sobre sus `-faint` | borde y texto `turquesa` sobre papel / relleno `maiz` con texto `telon` / relleno `barro` con texto `arroz` | 5,27 / 9,22 / 6,65 |
| `.react.on-mover` | índigo | se elimina (sin uso en el marcado) | — |
| `.field` · `:focus` | `'DM Sans'`, `#FCFAF7`, borde `line` · `teal` | `var(--font-sans)`, `papel`, borde `apoyo` 1,5 px · anillo `barro` | 6,79 / 7,45 |
| `.overlay` · `.dialog` · `.toast` | `rgba(28,26,23,.5)` · `#fff` · `ink`/`#fff` | `rgb(from var(--color-telon) r g b / .55)` · `papel` · `telon`/`arroz` | 16,72 |
| `.skeleton`, `.skel` | `#E9E2D7`, `#EFEAE3`, `#F6F2EC` | `linea` y `papel` (el `linear-gradient` del brillo se permite solo aquí, `background` animado) | — |
| Pie de las dos | `text-ink-5`, enlaces `text-ink` | `text-apoyo`, enlaces `text-telon` | 6,05 / 16,72 |

Carta y menú **no** usan `pared`, `selva`, `.friso` ni `.rombo`.

---

## 11. Reparto de CSS (quién escribe qué)

- **`base.css`:** el `@theme static` de §3, la base (`html{color-scheme:light}`, `body` con `arroz`/`telon`/`var(--font-sans)`), el `border-color` por defecto `linea`, el placeholder `apoyo` y el bloque único de movimiento reducido.
- **`componentes.css`:** `.btn`, `.btn-letrero`/`.btn-primary`, `.btn-telon`, `.btn-linea` y sus tres alias, `.btn-linea-clara`, `.btn-ghost`, `.btn-icon`/`.icon-btn` (claro, y oscuro bajo `.sobre-telon`), `.card`, `.card-soft`, `.badge` (.75rem) y sus variantes `-maiz`, `-barro`, `-turquesa` y `-neutral` (arroz/linea/apoyo), `.monograma`, `.eyebrow`, `.franja`, `.rotulo`, `.rotulo-sub`, `.rombo`, las variables de contexto de §3.2, `:focus-visible`, `.seccion`, `.enlace-pie`, `.tabular` y `.no-scrollbar`.
  - Radios: `.btn` `.5rem` (de letrero, no de píldora) y `.card` `.75rem`. `.tab` y `.badge` siguen en píldora.
- **`landing.css`:** `.pared` (re-tokenizada), `.hero` (foto y máscaras de §7.1), `.lema`, `.friso`, `.titulo-seccion` (Cinzel), `.campo`, `.pestana`, `.dia-mini`/`.es-hoy` (borde `barro`), `.cargando-bloque` (`linea`) y `#solicitud`. **Salen** `.vigas`, `.aplique` y `.aplique-oro`.
- **`carta-menu.css`:** §10.

---

## 12. Presupuesto de bytes

Base medida el 2026-09-28, con gzip -9 para lo textual:

| Recurso | Peso |
|---|---|
| `index.html` | ≈ 15 KB tras el cambio (hoy 14,2) |
| `resplandor.css` | ≈ 10 KB (hoy 9,5) |
| JS propio | 24,6 KB |
| Alpine | 19,9 KB |
| Fuentes (woff2) | 51,0 KB |
| CSS de Google | 2,6 KB |
| `logo-r.webp` | 8,7 KB |
| **Base** | **≈ 132 KB** |

| Escenario (Playwright, transferido, sin las respuestas de Supabase) | Estimado (bytes de `recursos.json`) | **Tope** |
|---|---|---|
| Primera vista a 375×812, DPR 2, sin scroll. Base + hero 960 (49,5 KB) | 181 KB estricto. **293 KB** si Chromium adelanta por su umbral de lazy las tres 480 del friso (81,7 KB) y el póster (30,3 KB), que no es lazy | **300 KB** |
| Página entera a 375×812, DPR 2. Suma celebraciones 960 (103,8), mural 480 (37,8), pared 480 (34,5) y fachada 960 (45,2) | 515 KB | **600 KB** |
| Primera vista a 1440×900, DPR 2. Base + hero 1600 (96,7) | 229 KB | — |
| Página entera a 1440×900, DPR 2. Imágenes: hero 1600 96,7 · mesa-3x4 830 125,5 · friso 960 ×3 228,5 · póster 30,3 · jugos 960 64,2 · sopa-mazorca 960 143,5 · globos 960 103,8 · mural 960 105,8 · pared 960 115,3 · fachada 1080 52,9 | **1 198 KB** | **1,3 MB** |
| Página entera a 1440×900, DPR 1 | 591 KB | **0,7 MB** |
| Solicitudes a `.mp4` antes de darle play | 0 | **0** |

Reglas de carga:
1. Solo el hero es ansioso (`fetchpriority="high"`, sin `loading` ni `preload`).
2. El resto va `loading="lazy" decoding="async"`, con `width` y `height`.
3. Las figuras que solo existen desde `md`/`lg` usan `hidden md:block` o `hidden lg:block`. No se descargan a 375 px.
4. El único `preconnect` es el de las fuentes.
5. Palancas, en este orden, si un tope no cierra:
   - La primera vista a 375 px pasa de 300: se recodifica el póster del video con la receta de video y `-q 70`.
   - La página a 1440 px pasa de 1,3 MB: se aplica §8-5.
   - El LCP pasa de 2,5 s: se agrega `<link rel="preload" as="image" imagesrcset=… imagesizes=… fetchpriority="high">` del hero.

---

## 13. Criterios de aceptación (todos medibles)

### A. Pruebas (terminal)
1. `node --test scripts/pruebas/*.test.mjs` da cero fallas, con un conteo ≥ 233 más las pruebas nuevas.
2. `node scripts/css.mjs --comprobar`, `node scripts/iconos.mjs --comprobar` y `node scripts/descubrimiento.mjs --comprobar` salen con código 0. Antes se regeneran el CSS y los sprites.
3. **`contraste.test.mjs` reescrita** contra este documento:
   - Existen **exactamente** los 15 tokens de §3, con su hex, y `--color-*: initial`.
   - **No** existe ninguno de los tokens v1: `ember`, `ember-light`, `ember-faint`, `teal`, `teal-light`, `teal-faint`, `teal-tinta`, `amber`, `amber-light`, `amber-faint`, `amber-tinta`, `parch`, `parch-d`, `ink`, `ink-5`, `ink-3`, `card`, `muted`, `line`, `soft`, `terracota`.
   - Cada par de §3.1 se recalcula contra su mínimo, y el borde `arroz`/55 sobre `telon` se compone antes de medirlo.
   - Salen los pares con texto blanco.
4. **`imagenes.test.mjs` actualizada:**
   - La única `fetchpriority="high"` de `index.html` es una `<img>` de `plato-sopa-jugo-estudio`, sin `loading`.
   - **Nuevo** (hallazgo v1): toda ruta de un mismo `<img>`/`<picture>` (`src`, `srcset` y cada `<source>`) es del mismo id o de uno con `deriva_de` hacia él, y el `alt` es el de ese id.
   - **Nuevo:** ningún `<video>` tiene `loop`.
   - `mesa-sopa-plato-mural-fondo-3x4` existe, es publicable y sus `bytes` son los reales.
5. **Prueba nueva `scripts/pruebas/identidad.test.mjs`:**
   - **Tokens viejos:** la regex `\b(bg|text|border|divide|ring|fill|stroke|outline|decoration|from|to|via|shadow)-(ember|amber|parch|ink|teal|card|muted|soft|line|terracota|white|black)\b` y `var\(--color-(ember|amber|parch|ink|teal|card|muted|soft|line|terracota)(-[a-z0-9]+)?\)` dan 0 en `index.html`, `carta.html`, `menu.html`, `assets/js/*.js` y `assets/css/{componentes,landing,carta-menu}.css`.
   - **Clases viejas:** `\b(btn-ember|btn-oro|btn-ink|badge-(ember|amber|teal)|sobre-ink|vigas|aplique(-oro)?|filete)\b` da 0 en los tres HTML.
   - **Fuentes:** los dos `<link>` de §4 aparecen idénticos en las tres páginas, y `Fraunces|DM Sans|DM\+Sans` da 0 en las tres y en `assets/css/*.css` salvo `resplandor.css` compilado, que tampoco debe tenerlos.
   - **`theme-color`:** vale `#0A1112` en las tres páginas.
   - **Hex:** los literales `#[0-9A-Fa-f]{3,6}` en `componentes.css`, `landing.css` y `carta-menu.css` aparecen **solo** dentro del data-URI de `.franja` (como `%23…`), y cada uno ∈ {`0A1112`, `2A738A`, `C5571A`, `E9A91F`, `F4F0E3`}, igual al token de `base.css`. Dentro de un `style=""` de los tres HTML no hay `#hex` ni `rgba(`.
   - **Rótulo:** `.rotulo::first-letter` usa `var(--font-r)`, y el H1 de `index.html` contiene `class="rotulo"`, «Resplandor» y «todos los días de 12 a 5».
   - **Trampa de datos** (la §11-A5 de la v1, que nunca se escribió): `index.html` contiene «de 10 a 30 personas», «12:00», «Cra. 61 #79 Sur-62», «wa.me/573225542434» y «5,0 en Google Maps · 2 reseñas».
   - **Frases prohibidas:** `index.html` **no** contiene `/catering|a domicilio[^.]*(evento|celebraci)|500 personas|150 personas|\+2\.000|desayuno|sin excepciones|capacidad completa del local|italic|<em[ >]/i`, ni ningún `$` seguido de un dígito fuera de atributos Alpine.
   - **Mutantes:** la prueba se valida con los dos mutantes del hallazgo v1 (`scratchpad/mut`). Los dos deben fallar.

### B. Grep (dan 0 salvo que se diga otra cosa)
- `grep -nE 'italic|<em[ >]' index.html carta.html menu.html`
- `grep -nE '_originales|publicidad-|autoplay|\bloop\b' index.html carta.html menu.html`
- `grep -nE 'radial-gradient' assets/css/{componentes,landing,carta-menu}.css`
- `grep -nE 'linear-gradient' assets/css/{componentes,landing}.css | grep -v mask-image`: los únicos `linear-gradient` son los de `mask-image`. En `carta-menu.css`, solo los de `.skeleton` y `.skel`.
- `grep -nE 'text-[a-z]+/[0-9]+' index.html carta.html menu.html`: sin texto con alfa.
- `grep -ho 'fonts.googleapis.com/css2[^"]*' index.html carta.html menu.html | sort -u | wc -l` → **2**
- `grep -c 'class="franja"' index.html` → **4**. En `carta.html` y `menu.html` → **1**.

### C. Navegador (Playwright y Chromium a 360×640, 375×812 con DPR 2, 768×1024 y 1440×900 con DPR 1 y 2)
1. **Scroll horizontal:** `document.documentElement.scrollWidth <= innerWidth` en todo el recorrido, también con el menú móvil y el `<dialog>` abiertos. El desplazamiento interno de `.friso` no cuenta.
2. **Táctiles:** todo `a`, `button`, `summary`, `select`, `input` y `.friso[tabindex]` visible mide ≥ 44×44. Excepciones: `p a` y los controles nativos del video.
3. **Consola:** cero errores propios. Los 402 de Supabase son el error de red esperado. Desde el 2026-09-29, con Supabase en 402: `#carta` y `carta.html` muestran la carta del 3 de septiembre con su fecha (sin caja de error), y `#hoy`, `#almuerzo-programado` y el menú semanal están apagados (`RESPLANDOR.funciones`, `assets/js/local.js`); con esas funciones encendidas, `#hoy` y el menú vuelven a mostrar su estado de error si Supabase no responde.
4. **Orden:** con las dos funciones encendidas, los `section[id]` en el DOM son `inicio, hoy, platos, carta, almuerzo-programado, celebraciones, la-casa, como-llegar, preguntas`, y la nav sigue ese orden sin `#platos`. Con `menuDeHoy` o `almuerzoProgramado` apagadas (hoy las dos), faltan `hoy` y/o `almuerzo-programado`, y también sus enlaces de la nav.
5. **Primera pantalla:**
   - A 375×812 y a 360×640, el H1 termina por encima del borde superior de `#barra-movil`, y el «Reservar» de la nav es visible.
   - A 1440×900, el H1, los tres puntos y «Reservar mesa» terminan en y ≤ 900.
6. **Identidad computada:**
   - `h1 .rotulo`: `color` `rgb(237, 107, 80)`, `font-family` que empieza por `Cinzel`, y `document.fonts.check('700 16px "Cinzel Decorative"', 'R')` da `true`.
   - Fondo computado de `#inicio`: `rgb(10, 17, 18)`; de `#hoy` y `#celebraciones`: `rgb(206, 137, 101)`; de `#la-casa`: `rgb(46, 91, 87)`.
   - Fuentes: exactamente 3 woff2, que suman ≤ 55 KB.
7. **Hero** (`currentSrc`):
   - 375 px con DPR 2: `…plato-sopa-jugo-estudio-960.webp`.
   - 1440 px con DPR 1: `-960`.
   - 1440 px con DPR 2: `-1600`.
8. **Descargas a 375 px:**
   - Ninguna solicitud a `mesa-sopa-plato-mural-fondo-3x4-*`, `sopa-mazorca-plato-mesa-*` ni `jugos-vasos-de-barro-splash-*`.
   - Las fotos del friso son las `-480`.
   - Ninguna solicitud a `.mp4` hasta darle play. Después del play, el video se reproduce y se pausa con el teclado.
9. **Presupuestos:** los de §12, sumando `response.body().length` después de bajar hasta el pie con pausas de 300 ms, y con gzip aplicado a lo textual si el servidor local no comprime (así se midió la v1).
10. **Estabilidad y carga:**
    - CLS ≤ 0,02 a 375 y a 1440 px.
    - El elemento LCP es la `<img>` del hero.
    - Lighthouse móvil (Slow 4G, CPU 4×), mediana de 3 corridas: LCP ≤ 2,5 s, TBT ≤ 100 ms y rendimiento ≥ 90.
11. **Contraste:** axe-core (`color-contrast`) da cero violaciones en landing, carta y menú, a 375 y a 1440 px. Incluye el rótulo del hero sobre el fundido de la foto.
12. **Foco computado** (`outline-color`):
    - `#inicio`, `#platos`, `#como-llegar`, nav, pie y barra: `maiz`.
    - `#hoy` y `#celebraciones`, fuera de las tarjetas: `telon`.
    - `#la-casa`: `arroz`.
    - Lo claro, el diálogo, la carta y el menú: `barro`.
    - En el video del friso, el anillo se ve (captura del recuadro).
13. **Movimiento reducido:** la duración computada de `transition` y `animation` en `[data-aparecer]`, `.hero-entra` y `.reveal` es ≤ 0,01 ms, y todo el contenido se ve.
14. **`<dialog>`:** cada CTA con `abrir(...)` deja `#solicitud[open]` con el tipo correcto. Escape lo cierra y el foco vuelve al botón de origen. Los 8 «Cotizar» tienen nombres accesibles distintos.
15. **`carta.html` y `menu.html`:**
    - Cabecera `telon` con la franja.
    - Con `?m=7&k=<token de 32 hex>` aparece «Mesa 7» en la cabecera; sin parámetros, no aparece.
    - La pestaña activa es `telon`.
    - Ningún precio en `font-display`.
    - Sin scroll horizontal y consola limpia.
16. **Visual:** capturas a 375 y 1440 px de las tres páginas, revisadas con Read contra §7 y §10. El rótulo tiene que leerse como el letrero de la fachada, y ninguna foto puede cortar un rostro, el letrero o el plato.

### D. Capa de agentes intacta
- `git diff` de `assets/js/{local,solicitud,vivo,agentes}.js`, `llms.txt`, `local.json`, `sitemap.xml`, `robots.txt` y `mcp/` da vacío.
- El bloque `datos-estructurados` de `index.html` no cambia.
- Esta fase no necesita JS nuevo: `landing.js` no se toca.
- Para no chocar con la rama `agentes-listos`, que también toca `index.html`: en el `<head>` solo cambian el par de fuentes y `theme-color`.

---

## 14. Reparto y orden de trabajo

| Orden | Parte (dueño) | Archivos | Entrega |
|---|---|---|---|
| 1 | Imágenes | `img/referencias/en-la-mesa/mesa-sopa-plato-mural-fondo-3x4-{480,830}.webp` (nuevos), `recursos.json`, `LEEME.md` | §8 |
| 2 | Base visual | `base.css`, `componentes.css` | §3, §4 (tokens de fuente), §5.1–5.3 y §11 |
| 3 | Landing | `index.html`, `landing.css` | §7, §5.4, §5.5, el par de fuentes y `theme-color` |
| 3 | Carta y menú | `carta.html`, `menu.html`, `carta-menu.css` | §10 |
| 4 | Pruebas | `contraste.test.mjs` (se reescribe), `imagenes.test.mjs`, `identidad.test.mjs` (nueva) | §13-A |
| 5 | Madre | `resplandor.css` y sprites regenerados; `docs/landing-y-agentes.md` (§16); recorrido de §13-C | Revisión. El commit lo hace Yonatan o la madre, **nunca un agente** |

Los pasos 2 y 3 pueden ir en paralelo si el 3 compila contra los nombres de este documento. La v2 se integra **antes** del merge de `agentes-listos`, y el traslado a la raíz va después, en su propio commit.

---

## 15. Preguntas (ninguna bloquea la implementación)

**Para Camila** (la dueña; Yonatan las lleva):
1. **Mural:** ¿quién lo pintó y cómo quieres que aparezca el crédito? Mientras tanto, la página no pone nombre.
2. **Fotos:** ¿hay alguna que prefieras no mostrar? La mujer del mural sale en «Menú de hoy», en «La casa» y en los primeros 3 s del video de platos.
3. **Paleta:** ¿te reconoces en esto? Coral sobre negro como el letrero, la pared terracota y el verde del mural. Pedimos el visto con capturas.
4. **Capacidad:** ¿30 o 35? Un mensaje reenviado dice 35. Hoy manda 30.
5. **Cena romántica:** ¿es en pareja y sin mínimo de 10? ¿A qué hora, si el local cierra a las 17:00?
6. **Noche:** ¿hay celebraciones después de las 17:00? Si no, la foto de noche del letrero no se usa.
7. **Platos de estudio** (tacos de maíz, bowl de cerdo con mango, arepa rellena, el almuerzo con sopa crema): ¿siguen en la carta? ¿Cómo se llaman? Sin nombre, van sin rótulo.
8. **Letrero:** ¿se puede tomar una foto de día sin las flores infladas y sin gente? Con esa foto se hacen `#como-llegar` y una `og:image` nueva.
9. **Cazuelas negras:** ¿son de barro de La Chamba? Si lo son, el pie de foto dice «Barro negro».
10. **Jugos en vaso de barro:** ¿de qué es el escarchado? ¿Son naturales? Hoy la página no afirma nada.
11. **Domingo:** ¿abren a las 12:00 o a las 11:00, como dice Maps?
12. **Desayunos:** ¿los ofrecen? Un video sin publicar los menciona.
13. **Curaduría:** la mojarra (se ve una persona), la hamburguesa (se ve la marca de la gaseosa) y el servicio de grupo (se ve una pared en obra): ¿se recortan o se retiran del banco?
14. **Logo:** ¿tienes el archivo fuente del monograma (vector o render)? Hace falta para un PNG transparente.

**Para Yonatan:** el visto de las capturas, el commit, el push y el despliegue; el 402 de Supabase; el traslado a la raíz en su propio commit; desplegar el Worker del MCP.

---

## 16. Cambios que necesita `docs/landing-y-agentes.md` (los aplica su dueño, no esta fase)

1. **§ «Sistema visual»:** reemplazar el resumen de tokens y fuentes por un puntero a este documento, más una línea:
   - «Paleta de material, sacada de las fotos (`telon`, `arroz`, `papel`, `pared`, `selva`, `letrero`, `maiz`, `barro`, `turquesa`…).
   - Cinzel y Archivo, con la R de Cinzel Decorative.
   - `theme-color #0A1112`.
   - El POS conserva los suyos.» *(2026-09-30: el POS adopta esta identidad, ver `docs/pos-visual.md`.)*
2. **Motivos:** `.franja` (propia, inspirada en la cenefa del mural), `.rotulo`, `.rombo`, `.friso` y `.pared`. Se borra «El mural… aparece solo como foto… hasta que Yonatan lo confirme»: el mural es de la casa y se usa como identidad. El crédito del muralista se le pregunta a Camila.
3. **Cabecera y pie comunes:** monograma y rótulo coral sobre telón, con la franja. Se borra «Fraunces».
4. **Landing:**
   - Hero `plato-sopa-jugo-estudio`.
   - `#hoy` con `mesa-sopa-plato-mural-fondo-3x4`.
   - `#la-casa` con el mural y la pared.
   - `#como-llegar` con la fachada a todo lo ancho.
   - Las fotos por sección son las de §7.
5. **Datos:** «La casa» dice «30 personas en el salón · celebraciones de 10 a 30» y se quita «sin excepciones».

---

## 17. Puntajes de las direcciones (0–5; juez, 2026-09-28)

Maquetas revisadas a 375 y 1440 px contra las fotos oficiales y contra las capturas de la v1 (`capturas/r0-landing-*.png`). En «riesgo», 5 es el menor riesgo.

| Criterio | D1 «La selva del salón» | D2 «Barro y terracota» | D3 «La cocina en escena» | Por qué |
|---|---|---|---|---|
| Autenticidad (sale de las fotos, se reconoce el local) | **4,5** | 4 | 4 | **D1:** el mural es lo más reconocible del salón y sus colores están medidos ahí, pero deja fuera el coral del letrero (la cara de la calle) y la terracota, e inventa siluetas de monstera. **D2:** cada color es un material real y el letrero abre y cierra, pero lámparas, madera y estuco son imitaciones en CSS de lo que la foto ya muestra, y el mural queda reducido a una greca del pie. **D3:** coral sobre negro es la fachada y la franja del mural está detrás de cada plato, pero el salón (mesas, mural) aparece recién en «La casa» y el «estudio» es la mirada del fotógrafo más que la de la casa. |
| Distancia del POS y de una plantilla | **4,5** | 3 | 4 | D1 no comparte nada con el POS, aunque las hojas rozan el «tropical» de plantilla. D2 es la composición de la v1 redibujada (hero terracota, botón oscuro, discos de lámpara), con el plato en círculo, un tópico de plantilla. D3 cae en la «landing oscura de comida», pero la anclan el letrero y la franja. |
| Claridad para el cliente (qué es, cuándo abre, cómo reservar en 5 s) | 3 | **5** | 4,5 | D1 a 375 px: el H1 empieza en y ≈ 640, no dice la hora y el CTA queda bajo el pliegue. D2: «ALMUERZO COLOMBIANO», la hora y dos CTA antes de la barra, en los dos anchos. D3: rótulo, lema con la hora y CTA en y ≈ 700; a 360×640 la barra tapa el primer botón, como admite su propio riesgo 6. |
| Legibilidad y accesibilidad | 3,5 | 4 | 4 | D1: H1 de 7 palabras en versalitas de Cinzel (4 líneas) y el hibisco que necesita anillo sobre oscuro. D2: axe da 0 y el H1 es corto, pero hay cuatro rojos vecinos y el letrero a 4,54. D3: contrastes altos, pero lectura larga sobre negro, rectángulos si falla la máscara y un diálogo que pide `color-scheme: dark`. |
| Cómo lleva carta y menú | **4** | 3,5 | 3 | D1: cabecera oscura, cuerpo claro, precios en tinta y votos con ícono y texto. D2: la cabecera de pared de 140 px pesa en una página de uso, aunque «Mesa N» es una buena idea. D3: carta y menú oscuros para leer en la mesa al mediodía, con una variante «mantel» sin especificar. |
| Rendimiento | 3 | 4 | **4,5** | D1: hero de 184 KB a 375@2x hasta recortarlo, y 68 KB de fuentes. D2: 61 KB de fuentes y hero de 63 KB tras recorte. D3: hero de 49 KB, unos 63 KB de fuentes y franja de 573 B. |
| Riesgo de implementación (5 = bajo) | 3 | 2,5 | **3,5** | D1: muchos motivos (hoja con máscara que se mece, greca vertical, viñeta de flor, esquinas de hoja), y el hero depende de un recorte y del visto de Camila. D2: lámparas ubicadas sobre estuco, madera, `clip-path` escarchado, marcos redondos y de vaso, relieve en el H1: todo frágil en cada ancho. D3: friso con cruces de −40 px, alto por `cqw` y doble máscara; carta y menú enteros a oscuro. |
| **Total (sobre 35)** | **25,5** | **26** | **27,5** | **Base: D3.** Se le injerta el color y la foto del mural de D1 y la claridad y los pies de material de D2, y se quitan sus tres riesgos (masas oscuras en carta y menú, máscaras compuestas y tokens de más). Ver §0. |
