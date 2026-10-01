# POS: rediseño visual con la identidad v2 de la landing (especificación)

Estado: **vigente desde el 2026-09-30.** Tarea `tareas/2026-09-30-pos-visual.md`, rama `tarea/pos-visual`.
Pedido de Yonatan: «el POS debe mejorarse visualmente de acuerdo al nuevo aspecto de https://resplandor.ynt.codes/».

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

## 1. Dirección visual

**Decisión en una línea: el POS se viste como la carta.** La barra superior va en `telon` con la franja debajo. El área de trabajo va en `arroz`, con tarjetas `papel`. Usa Cinzel para la marca y los títulos, y Archivo para todo lo que se lee y se toca. Lo que hoy es obsidiana pasa a la paleta v2.

**Por qué claro y no oscuro:**
- El restaurante atiende de 12:00 a 17:00, con luz de día. Con luz de día, texto `telon` sobre `papel` (18,74) se lee mejor y refleja menos que un tablero negro.
- `carta.html`, la pantalla que el cliente ve en la pegatina NFC, es exactamente este esquema: telon arriba, franja, arroz y papel. El mesero ve en el POS la misma carta que ve el cliente.
- Todos los pares que usa este esquema ya están medidos en `identidad-visual.md` §3.1. No se inventa ningún tono.
- **Es reversible.** Los alias v1 se conservan (§2.3). Si Yonatan prefiere oscuro al ver las capturas, basta con remapear `:root`. La superficie oscura elevada ya está medida (§2.1, `--pos-telon-elevado`).

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
| **Diálogo** | Papel, radio 1.15rem, sombra de diálogo, velo `telon` al 60 % **sin blur**. Hoja inferior a ≤640 px, como ya está. |

### 1.2 Cómo se adapta a una herramienta táctil de uso diario

- **Lectura a distancia de brazo (60–70 cm):**

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
  - Todo control mide **≥ 44×44 px** por defecto, no solo con `pointer:coarse`: el arnés no emula táctil y las tablets del local sí lo son.
  - Las acciones principales miden 52–56 px.
  - El stepper de cantidad es de 44 px.
  - La fila de producto mide ≥ 56 px y se toca entera (ya tiene `@click`).
  - La tarjeta de mesa mide ≥ 120 px.
- **Densidad:**
  - Más compacta que la landing. Vistas `py-6`, cabecera `mb-6` (no `mb-10`) y sin `.seccion`.
  - Tarjetas `p-4` o `p-5`, filas de lista `px-4 py-3`, gap de grilla 16 px.
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

  Los derivados van como hex o `rgba()` literal, calculados con la fórmula y documentados (§2.1).

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
  --pos-sombra-letrero: 0 8px 20px -10px rgba(237,107,80,.55);
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
  - El `preconnect` a `cdn.jsdelivr.net` se queda.
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
| `--text-on-coral` | `telon` | `telon` | texto sobre `letrero` (nunca claro) |
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
| `.btn-primary` | `letrero` / `telon` / `letrero`, `--pos-sombra-letrero`. Hover `letrero-claro` (7,59) | **la** acción de la pantalla: Entrar, Generar ticket y cobrar, Imprimir, Cerrar día, Nuevo producto, Guardar/Sí del diálogo |
| `.btn-secondary` | `papel` / `telon` / `linea`. Hover fondo `arroz`, borde `apoyo` | resto de acciones |
| `.btn-telon` (nuevo) | `telon` / `arroz` (16,72). Hover `--pos-telon-hover` (11,43) | acción fuerte que no es la principal: «Facturar» de la cabecera de la orden |
| `.btn-teal` | `papel` / `turquesa` (5,27) / 1.5px `turquesa` | alternativa: «Editar sin mesa» |
| `.btn-peligro` (nuevo) | `papel` / `barro` (7,45) / `linea`. Hover fondo `arroz` | Eliminar, Rotar, Liberar mesa |
| `.btn-enlace` (nuevo) | sin fondo; `barro`, 600, .9375rem, subrayado (offset 3px), `min-height: 2.75rem`, `padding: 0 .25rem` | reemplaza a `.text-fine.underline`: Asignar/Reasignar, Editar, Ocultar/Mostrar, Eliminar, Reintentar respaldo, + Agregar |
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
  - `aspect-ratio: 1`, `min-height: 7.5rem`, `:active scale(.985)`, sin `translateY`.
  - El número va en Archivo 700 2.75rem tabular. A ≤640 px baja a 2.25rem.
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
  - `position: sticky; top: 0; z-index: 1`, fondo `papel`, `border-top: 1px linea`, `padding: .875rem 1rem .5rem`.
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

- **≤640 px:** la hoja inferior actual se conserva, con `max-height: 92vh; max-height: 92dvh` y los botones del pie en `flex: 1`.
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
  - `off` en `ceniza` (7,15).
  - Miden 10 px.
- **Chips de respaldo del cierre:** ver §3.4.

### 3.9 Totales y precios

- **Precio en lista:** `.menu-item-price` (Archivo 600 1rem tabular `telon`).
- **Importe de línea:** `.importe` con `min-width: 5rem; text-align: right`. Reemplaza `style="color:var(--text-display);min-width:64px…"`.
- **Total de la orden:** `.text-label` «Total» y debajo o al lado `.total-grande` (Archivo 700 2rem tabular `telon`).
  - **Nunca** Cinzel, **nunca** oro ni coral como texto.
  - Debajo, `.btn-primary.btn-lg.w-full` «Generar ticket y cobrar».
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

- **Barra:** `telon`, sticky. Lleva `.sobre-telon` en el marcado.
- **Marca:** `img/logo-r.webp` de 36 px (`alt=""`) y `.brand-word` «Resplandor».
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
  - Por debajo de `lg` va en **dos filas**. Fila 1: marca y estado. Fila 2: los cuatro links en `grid grid-cols-4`, a lo ancho, sin scroll.
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

### 3.13 Orden en tablet (parte 2)

- **Grilla:**
  - A 768–1023 px es `md:grid-cols-2`. Desde `lg` queda `lg:grid-cols-5`, con menú en `lg:col-span-3` y pedido en `lg:col-span-2`.
  - La columna del pedido va `self-start` y `sticky` bajo el nav.
  - Así el pedido y el total se ven en la tablet vertical sin bajar por toda la carta.
- **Lista de productos:**
  - `max-height: calc(100vh - X); max-height: calc(100dvh - X)`. El valor va en una clase local `.menu-scroll`, recalculada con la altura real del nav más la franja.
- **`.menu-item`:**
  - `min-height: 3.5rem`, divisor `linea` entre filas, `:active` en fondo `arroz`.
  - `.menu-item-btn` es un círculo de 44 px, papel con borde `linea`. Pasa a `telon`/`arroz` en `:active` de la fila.
  - Sin el hover coral.
- **`.qty-btn`:** 44×44, radio .5rem, papel con borde `linea`, 1.25rem 600. En `:active` pasa a `telon`/`arroz`. `.qty-val` en 1.125rem 600 tabular.
- **Checkbox de «cobro por partes»:** de 24×24, envuelto en un `<label>` de 44×44 (`accent-color: var(--color-telon)`). Es la única excepción documentada al 44 medido sobre el elemento.
- **Barra «N ítem(s) seleccionado(s)»:**
  - Barra `telon` `.sobre-telon`, con el texto en `arroz` tabular.
  - Botón `.btn-primary.btn-sm`. Es el segundo coral, admitido solo mientras dura el modo cobro.
- **Cabecera:**
  - «Ítem manual» en `.btn-secondary`.
  - «Facturar» en `.btn-telon`. El coral es el del panel de total.
- **Fila de acciones:**
  - Cobrar por partes, Imprimir cuenta y Enlace NFC van en `.btn-secondary.btn-sm`.
  - Liberar mesa va en `.btn-peligro.btn-sm`.
- **Panel NFC:**
  - `.aviso`, con `<code>` en `font-mono text-sm` sobre `arroz`.
  - Copiar en `.btn-secondary.btn-sm` y Rotar en `.btn-peligro.btn-sm`.
  - Se quitan los `opacity:.7` de texto y se usa `.text-fine` en su lugar.

---

## 4. Fase BASE y partición

### 4.1 Qué hace la base (una sola parte, en `tarea/pos-visual`)

0. **Capturas «antes» a 1024 px**, antes de tocar nada:
   ```
   PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH node scripts/capturas-pos.mjs $S/antes --cache $S/_cdn --anchos 1024
   ```
   Hoy solo hay 768 y 1440.
1. **`<head>`:**
   - `theme-color` pasa a `#0A1112` (`pos.html:10`) y se actualiza el comentario.
   - El bloque de fuentes de `index.html:54-60` reemplaza `pos.html:13-21`. Se conserva el `preconnect` a jsdelivr.
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
   8. Responsive compartido de ≤640 px: solo `.field`, `.modal*`, botones del pie y `.stat-*`. El bloque `pointer:coarse` se borra, porque los tamaños por defecto ya son ≥ 44.
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

Las líneas 3121-3124 (contenedor con sesión) y 4387-4389 (su cierre) son de la base y quedan congeladas. Ninguna parte toca `<head>`, `<script>` ni el CSS compartido.

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

- **marco-salon-ticket:** login (§3.12); nav (§3.11), con la franja y el arreglo de 768 y 1024; mesas: cabecera, leyenda, grilla y stats (§3.3, §3.5); ticket en pantalla (§3.10), sin el RitualMark y sin el `style` de `.opt`.
- **orden:** §3.13 entero, avisos (§3.8), totales (§3.9), `.btn-enlace` y fin de `font-display` y de los `style=` de color en datos.
- **cierre-y-menu:**
  - **Cierre:** cabecera, bento, sparkline turquesa, transacciones, «Cerrar día» `.btn-lg` sin `py-4` ni `opacity-40`, e historial con `.btn-icon` de 44 (sin `style="width:28px…"`) y `.btn-icon-peligro`. «Mesa N» y montos pasan de Cinzel a Archivo. Sale el hex `#8A6118` de `pos.html:3797`.
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
   - Botones por nombre accesible exacto: «Generar ticket y cobrar», «Sí, cobrar», «Imprimir cuenta», «Ítem manual», «Nuevo producto», «Reabrir en mesa», «Cerrar día» y «Editar».
   - `button[title="Editar"]`, `.modal-backdrop:visible .opt-chip` «Sopa» e `input[type=number]`.
   - Los textos «también tiene esta mesa abierta», «Elige una mesa libre» y «Entrar con Google».
   - **Un ícono nuevo dentro de un botón no puede agregar texto accesible.**
5. **Textos funcionales:** ningún texto visible cambia. Se permite quitar emojis y agregar «Restaurante» decorativo en el login.
6. **`<head>`:** se conservan `<title>Resplandor — POS</title>`, la única `<meta name="robots" content="noindex, nofollow">`, el texto `signInWithOAuth`, el `redirectTo: window.location.origin + window.location.pathname` y la ausencia de `rel="canonical"` (`raiz.test.mjs:66-74`).
7. **La impresión se conserva:** `.print-zone`, `body.print-termico` y `@page 80mm` (los pone el JS), `print:hidden` y el negro sobre blanco.
8. **No se tocan:** `assets/css/*.css` (salvo el comentario de `base.css:8-11`), `resplandor.css`, `entrada-tailwind.css`, `iconos.mjs`, el checkout principal `~/Developer/resplandor/resplandor` ni `tareas/**`. Esto último queda para el coordinador. Nada de push.
9. **Sin hex en `style=""`** en el marcado nuevo. Sin texto con opacidad. Sin emojis. Sin itálica en pantalla. Sin `radial-gradient` ni `backdrop-filter`.

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
   node scripts/capturas-pos.mjs $S/despues-<clave> --cache $S/_cdn --vistas <lista> --anchos 768,1024,1440
   ```
   - Comparar contra `$S/antes/<vista>-<ancho>.png`.
   - El código de salida tiene que ser 0: sin error de consola propio, sin pedido bloqueado y sin captura fallida.
   - La base y la integración corren las 25 vistas a 768, 1024 y 1440.
   - Las vistas de impresión van en su ancho: `ticket-impreso` a 302 y `cierre-impreso` a 794.
4. **Táctil y desborde:** `$S/harness-pos.mjs` mide desborde horizontal y objetivos táctiles por escena.
   - Su umbral está fijo en 40 px (línea 187). En la copia de scratch se sube a **44**.
   - Uso: `DETALLE_TACTIL=1 node $S/harness-pos.mjs <raíz> <salida> todas 768x1024,1024x768,1440x900`.
   - Tiene que dar 0 desbordes y 0 controles menores de 44 px. La excepción documentada es el checkbox de 24 px dentro de su `<label>` de 44.
   - A 375 px no se exige (está fuera de alcance), pero no se suma desborde a los cuatro que ya había.
5. **Lógica intacta** (sondeo en scratch, no va al repo):
   - Extraer los `<script>` de `git show 4da9030:pos.html` y de la versión nueva: tienen que ser idénticos.
   - Extraer en orden todos los atributos `x-*`, `@*` y `:*` (sin `:class` ni `:style`): las dos listas tienen que ser idénticas.
   - Los `:class` y `:style` pueden diferir solo en los literales.
   - Bitácora de Supabase: correr las mismas vistas con `llamadasSupabase(page)` (`_pos-simulado.mjs`) sobre `--raiz` de `git archive 4da9030` y sobre el worktree nuevo. Tienen que dar la misma secuencia.
6. **A ojo, a 768 y 1024 px** (tablet vertical y horizontal):
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
