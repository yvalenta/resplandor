# Resplandor — identidad visual (contrato de implementación)

Estado: **vigente desde 2026-09-28**. Es el contrato de la fase de implementación visual de
`landing.html`, con los ajustes mínimos de `carta.html` y `menu.html` para que las tres sigan
homogéneas. En datos del local, reglas del negocio, capa de agentes y dueños de archivos manda
[`landing-y-agentes.md`](landing-y-agentes.md). En lo visual manda este documento. Si los dos se
contradicen en algo visual, gana este, y la sección 13 dice qué hay que corregir allá.

Base: **propuesta 1, «La casa»**, con injertos de la **propuesta 2, «El mural y la mesa»** y
correcciones del juez. Los puntajes están al final. Todo contraste de este documento está
recalculado con la fórmula WCAG 2.x. Todo peso sale de archivos reales: `recursos.json` o recortes
de prueba generados con la receta de la casa.

Reglas que no se discuten (Línea Roja y datos que mandan):
- Nada de commit, push, despliegue ni escrituras en Supabase.
- No se borra ningún archivo del repo: lo que deja de usarse queda en `img/` sin referencia.
- Capacidad: 30 personas. Todo evento es en el local, nunca a domicilio.
- Horario: todos los días, 12:00–17:00.
- Sin precios en eventos. Los precios de la carta se leen solo en vivo.
- Sin testimonios.

---

## 0. La decisión en una línea

**La página recorre el local:** la pared terracota del salón (hero), lo que se come hoy, lo que sale
de la cocina, la carta, el almuerzo programado, las celebraciones en ese mismo salón, la casa y cómo
llegar.

- La superficie de marca es la pared.
- La tipografía hace eco de las letras en relieve y del letrero.
- Los motivos salen de lo que el local es dueño: la pared, las vigas, las lámparas redondas unidas al
  anillo de la R y el letrero.
- El mural aparece **solo como foto**, nunca como motivo gráfico.

| Se toma de | Qué |
|---|---|
| Propuesta 1 | Concepto «la casa». Hero con la pared terracota. `terracota` solo en una banda. `.btn-ink`. Letras del salón oscuras (no doradas). Celebraciones como lista con «Cotizar». Sin itálica. Sin preload de entrada. Tope de peso. Prueba trampa de imágenes. |
| Propuesta 2 | Sección `#platos` con las fotos de estudio (el «Para antojarse» de lusof). H1 que dice qué es y cuándo abre. `#hoy` en segundo lugar. Inventario completo de fallas AA del oro. `alt` desde `recursos.json`. Encuadre del mural que respeta el rostro. Quitar DM Sans 300. Reparos a la curaduría (mojarra, hamburguesa). |
| Juez | Recortes 4:3 de dirección de arte medidos, en vez de la variante `-768`. Enlace de fuentes con rangos. Fallas AA que ninguna vio: `badge-teal` 4,46; etiquetas `ink-3` 2,11–2,35; pie `parch/40` 3,54; anillo de foco ember sobre ink 2,87. Dos `alt` equivocados en `recursos.json`. Orden «comer → celebrar → llegar». Video solo al hacer clic. Nombres accesibles únicos en «Cotizar». |

Se descarta, con su porqué:

- **`noche`:** casi duplica a `ink` y obligaría a cambiar `theme-color` en las tres páginas.
- **`selva`, `barro`, `quemado`, `turquesa` y la greca:**
  - Salen del mural, una obra de un tercero sin autor ni permiso confirmados (ver §14).
  - Hoy no tienen un rol que no cubra un token existente.
- **Eje `ital` de Fraunces:** medido, suma **+81,7 KB** de woff2, solo para un acento del hero.
- **Sección `#bebidas`:** afirma cosas sin confirmar (escarchado, jugos naturales) y alarga la página.
- **Video con autoplay por IntersectionObserver:** 1,48 MB y una pausa obligatoria (WCAG 2.2.2).
- **Del lado de la propuesta 1:**
  - Sombra de relieve en el texto, baranda y brillo del letrero: son motivos de más.
  - Foto encimada a 1440 px: riesgo de maquetación.
  - Variante `-768`: aun así descarga el 44 % de la foto que no se ve.
- **Scroll-snap horizontal a 375 px:** es riesgo de desborde y no gana nada frente a una grilla 2×2.

---

## 1. Hechos de identidad (medidos en las fotos; no se discuten sin foto nueva)

| Elemento | Medida | Consecuencia |
|---|---|---|
| Pared del salón (foto `salon-pared-terracota-letrero`) | `#CE8965`, estuco con grano | Token `terracota`, **solo como fondo** |
| Letras «RESPLANDOR» en la pared | `#2B2223`, bronce-negro mate. **No son doradas.** | Sobre terracota solo va texto `ink` |
| Monograma R | Oro cepillado `#B39464` / `#6B4E32` | El `amber #C08B2C` actual queda validado |
| Letrero de fachada de día | Letra `#ED6B50` sobre tablero `#231B19` | `ink` validado; token `letrero` solo sobre ink |
| Letrero de noche | `#FA902C` es brillo de neón, no pintura | No se usa como color |
| Vigas | Negras sobre techo blanco (el `alt` actual dice «blancas y negras»: está mal) | Motivo «vigas» |
| Lámparas del salón | Discos blancos con halo cálido | Motivo «aplique», unido al anillo de la R |
| Fondo de estudio | `#030507`–`#0B0E10` | Las fotos de estudio van en tarjetas sobre `ink`, no en un token nuevo |
| Mural (mujer indígena, selva, cenefa) | Obra de un tercero | Solo como foto del salón |

---

## 2. Concepto

**«Entrar al local».**

- **Primera pantalla:** el salón con su pared. Es lo único que ningún otro restaurante tiene.
- **H1:** dice qué es y cuándo abre.
- **Orden de la página:** sigue lo que busca quien llega.
  1. ¿Qué hay hoy?
  2. ¿Qué sale de la cocina?
  3. ¿Cuánto cuesta? (carta en vivo)
  4. ¿Me lo programan?
  5. ¿Puedo celebrar aquí? (este mismo salón, hasta 30 personas)
  6. ¿Cómo es por dentro?
  7. ¿Cómo llego?
- **Voz:** frases cortas, de «tú», con datos (hora, capacidad, dirección) en vez de adjetivos de venta.
  Nada se afirma si no sale de `landing-y-agentes.md` o de una foto.

---

## 3. Tokens finales (`assets/css/base.css`, `@theme static`)

Solo se **agregan** cuatro tokens. Ningún nombre ni valor existente cambia, así que carta y menú
compilan igual.

| Rol | Token → clase | Hex | Uso permitido | Pares medidos (WCAG) |
|---|---|---|---|---|
| Fondo de página | `parch` = | `#F7F2EC` | — | ink 15,60 · muted 5,24 · ink-5 5,31 |
| Superficie | `card` = | `#FFFFFF` | — | muted 5,83 · ink-5 5,91 |
| Texto; bandas oscuras | `ink` = | `#1C1A17` | Texto; fondo de franja, `#platos`, `#celebraciones` y pie | parch/70 8,14 · parch/55 5,53 · amber-light 7,59 · letrero 5,64 |
| Texto de apoyo | `muted` = | `#6B645B` | Sobre parch/card | **Prohibido** sobre ink (2,98) y sobre terracota (2,05) |
| Acción principal | `ember` = | `#B5341C` | Botón con texto blanco; enlace sobre claro; anillo de foco sobre claro | blanco 6,05 · parch 5,43 · card 6,05 · hover `ember-light` con blanco 4,53 |
| Oro: fondo, ícono, filete | `amber` = | `#C08B2C` | Fondo de `.btn-oro` (texto ink); íconos decorativos; filetes; anillo del monograma | ink sobre amber 5,76. **Nunca texto sobre claro**: parch 2,71 · card 3,01 · amber-faint 2,74 |
| Oro como texto | **`amber-tinta`** (nuevo) | `#8C611F` | Precios, eyebrow sobre claro, `.badge-amber`, avisos, ícono de las preguntas | parch 4,91 · card 5,46 · amber-faint 4,96 · soft 4,61. **Prohibido** sobre ink (3,18) |
| Oro sobre oscuro | `amber-light` = | `#D4A43E` | Eyebrow, íconos y anillo de foco sobre ink | ink 7,59 · terracota 1,24 (prohibido) |
| Estados | `teal` = | `#2A7B72` | Íconos de estado; texto sobre parch/card | parch 4,52 · card 5,03 · teal-faint **4,46 (falla)** |
| Estado en badge | **`teal-tinta`** (nuevo) | `#256F67` | Solo el texto de `.badge-teal` | teal-faint 5,24 · parch 5,32 · card 5,92 |
| Pared | **`terracota`** (nuevo) | `#CE8965` | **Solo** fondo de `.pared` (banda del hero) | ink 6,11. **Prohibidos**: blanco 2,84 · parch 2,55 · ember 2,13 · amber 1,06 · muted 2,05 |
| Letrero | **`letrero`** (nuevo) | `#ED6B50` | **Solo** el rótulo «RESPLANDOR» del pie, sobre ink | ink 5,64 · parch 2,77 (prohibido) |

Tokens que no cambian ni suben de rango: `ember-light`, `ember-faint`, `teal-light`, `teal-faint`,
`amber-faint`, `parch-d`, `ink-5`, `soft`, `line` y `shadow-sombra`. `ink-3` (`#B0A89E`) **deja de
usarse como texto** (2,11 sobre parch, 2,35 sobre card); queda para bordes de hover y deshabilitados.

Comentario obligatorio en `base.css` junto a cada token nuevo: su rol y el par medido, como lusof.

### Reglas de uso (grep y prueba las vigilan, §11)
1. Sobre `terracota` va solo texto e íconos `ink`. Los botones de esa banda son:
   - `.btn-ink`;
   - `.btn-claro` con `border-ink` (el borde ink da 6,11; el fondo blanco solo, 2,84);
   - `.btn-ghost` con texto ink.
2. `amber` nunca colorea texto sobre fondo claro. Para eso está `amber-tinta`.
3. `letrero` solo va sobre `ink`.
4. Sobre `ink`, el texto secundario va en `parch/70`. El mínimo es `parch/55` (5,53). `parch/40` queda prohibido.
5. En `landing.css` no entra ningún hex literal nuevo. Todo va con `var(--color-*)`.
6. Nada de `linear-gradient`/`radial-gradient` nuevos. Los motivos usan SVG en data-URI o `mask`.

### Variables de contexto (en `componentes.css`, para no repetir overrides)
```css
:focus-visible { outline: 2px solid var(--foco, var(--color-ember)); outline-offset: 2px; }
.eyebrow { /* … igual que hoy … */ font-size: .75rem; letter-spacing: .22em;
           color: var(--eyebrow, var(--color-amber-tinta)); }
.sobre-ink { --foco: var(--color-amber-light); --eyebrow: var(--color-amber-light); } /* 7,59 */
.pared     { --foco: var(--color-ink);         --eyebrow: var(--color-ink); }        /* 6,11 */
```
`.sobre-ink` va en toda superficie `ink` que tenga texto o controles: franja, `#platos`,
`#celebraciones` y pie. Así el anillo de foco ember sobre ink (2,87, **falla 1.4.11**) sube a 7,59.

Componente nuevo compartido, `.btn-ink`, en `componentes.css`:
```css
.btn-ink { background: var(--color-ink); color: var(--color-parch); }            /* 15,60 */
.btn-ink:hover { background: color-mix(in srgb, var(--color-ink) 85%, var(--color-parch)); } /* parch 10,15 */
```

---

## 4. Tipografía

Se quedan Fraunces (display) y DM Sans (texto). El **mismo** `<link>` va en las tres páginas: se
cambia el de hoy, que es idéntico en las tres, por la sintaxis de rangos y sin el peso 300, que
nadie usa (grep: 0 usos).

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=DM+Sans:wght@400..700&display=swap" rel="stylesheet" />
```

Medido el 2026-09-28:
- Descarga los mismos dos woff2 latin de hoy: DM Sans 36 980 B y Fraunces 67 388 B, **104,4 KB**.
- La hoja CSS de Google baja de 9,9 KB a 2,3 KB. Es CSS que bloquea el render, así que ayuda al LCP.
- El eje `ital` **no se carga**: sumaría 81,7 KB.

| Nivel | Estilo | 375 px | 1440 px |
|---|---|---|---|
| H1 (hero) | Fraunces 700, `clamp(2.5rem, 1.6rem + 3.9vw, 4.75rem)`, `line-height: 1.02`, `letter-spacing: -.01em`, `text-wrap: balance` | 40 px | 76 px |
| H2 (`.titulo-seccion`, en las 8 secciones) | Fraunces 600, `clamp(1.75rem, 1.3rem + 2vw, 2.75rem)`, `line-height: 1.1`, `text-wrap: balance` | 28 px | 44 px |
| H3 | Fraunces 500, 1.25rem | 20 px | 20 px |
| Texto | DM Sans 400, `1rem/1.6`; desde `lg`, `1.0625rem` | 16 px | 17 px |
| Eyebrow (`.eyebrow`) | DM Sans 700, .75rem, versalitas, `letter-spacing: .22em` | 12 px | 12 px |
| Precios en vivo | DM Sans 600, `.tabular`, `text-amber-tinta` | — | — |
| Rótulo (`.rotulo`) | Fraunces 700, mayúsculas, `letter-spacing: .04em`, `line-height: .9`, `clamp(2.25rem, .5rem + 8vw, 6rem)`, color `letrero` | 38 px (cabe en 343) | 96 px |

Reglas:
- **Sin itálica en ninguna de las tres páginas.** El `<em class="italic text-amber-light">` del hero
  (landing.html:284) hoy sale como oblicua sintética y se elimina. En el H1, el acento lo da el peso:
  la primera cláusula en 700 y la segunda en 500.
- `.rotulo` es solo para la palabra «RESPLANDOR», una vez, en el pie. Nunca en el H1: una frase
  larga en mayúsculas pierde legibilidad.
- Fraunces usa `font-optical-sizing: auto`, que es el valor por defecto: los tamaños grandes toman
  el `opsz` alto sin más configuración.

---

## 5. Motivos (cuatro; ninguno más en esta fase)

1. **Pared: `.pared`** (landing.css). Es la banda del hero.
   - Fondo `terracota` y grano de estuco con `::before`, SVG en data-URI de ≤ 600 B:
     `feTurbulence type=fractalNoise baseFrequency=.9 numOctaves=2 stitchTiles=stitch` más
     `feColorMatrix type=saturate values=0`.
   - Mosaico de 160 px, `opacity: .07`, `mix-blend-mode: multiply`, `pointer-events: none`,
     `z-index: -1` con `isolation: isolate` en `.pared`.
   - Solo existe en `#inicio`.
2. **Vigas: `.vigas`** (landing.css).
   - Franja decorativa `aria-hidden="true"` de .75rem de alto.
   - Se pinta con `background: var(--color-ink)` y `mask: url("data:image/svg+xml,…") repeat-x`.
   - La máscara es un paralelogramo de 40×12 (`M10 0h8l-6 12H4z`) por módulo. Así el color sale del
     token, sin hex en el data-URI.
   - Va **justo antes de cada banda ink que sigue a una banda clara**: antes de `#platos`, antes de
     `#celebraciones` y antes del pie. Son tres usos, los únicos.
3. **Aplique: `.aplique` / `.aplique-oro`** (landing.css). Es el marcador de viñeta, un disco de
   .75rem con `aria-hidden`. Une las lámparas del salón con el anillo de la R.
   - `.aplique` (sobre terracota): fondo `parch` y halo con
     `box-shadow: 0 0 0 .1875rem rgb(from var(--color-parch) r g b / .35)`.
   - `.aplique-oro` (sobre claro): fondo `amber-faint` y borde de 1.5px `amber`.
   - Reemplaza los íconos del hero, porque amber sobre terracota da 1,06 y no se ve.
4. **Rótulo: `.rotulo`** (§4). «RESPLANDOR» en `letrero` sobre ink en el pie, como el letrero de la
   Cra. 61. Es decorativo (`aria-hidden="true"`), porque el nombre ya está en el texto del pie.

Prohibido en esta fase:
- **El mural:** ni reproducir la mujer ni abstraer la cenefa/greca, hasta que Yonatan confirme autor
  y permiso (§14).
- **Adornos descartados:** hojas de selva, sombra de relieve en el texto, baranda, brillo o
  «encendido» del letrero.
- **Genéricos:** degradados de plantilla y emojis en botones.
- **Del letrero de noche:** el color y el brillo.

---

## 6. Movimiento

- Se mantienen `data-aparecer` (landing.js + landing.css) y la entrada `.hero-entra` con sus demoras.
  No se agrega ninguna animación nueva.
- Las fotos no se funden: reservan su caja con `width`/`height` y `aspect-*`, y el fondo `soft`
  espera mientras cargan.
- Sin escalado al pasar el cursor, sin parallax, sin View Transitions y sin nada en bucle.
- Video: solo con `controls`, sin `autoplay` ni `loop` de entrada.
- `prefers-reduced-motion: reduce` sigue resuelto por el bloque **único** de `base.css`. No se
  agrega otra guarda en ningún archivo.

---

## 7. Plan sección por sección de `landing.html`

Contenedor igual al de hoy: `max-w-6xl mx-auto px-4 sm:px-6`, así que el ancho útil a 1440 px es
1104 px. Toda foto cumple esto:
- `alt` **idéntico** al de `recursos.json`, con los corregidos de §8.
- `width` y `height` del recurso.
- `loading="lazy" decoding="async"`, salvo la del hero.
- Fondo `bg-soft`; en bandas ink, `bg-ink`.
- Radio `rounded-[1.1rem]`, el de `.card`.

Las rutas son `img/referencias/<categoría>/<id>-<ancho>.webp`.

**Orden final de secciones:**
1. `#inicio`
2. `#hoy`
3. `#platos` (nueva)
4. `#carta`
5. `#almuerzo-programado`
6. `#celebraciones`
7. `#la-casa`
8. `#como-llegar`
9. `#preguntas`

Bandas, en ese mismo orden: terracota, parch, *vigas* + ink, card, parch, *vigas* + ink, parch, card,
parch y *vigas* + pie ink. Todos los ids de hoy se conservan. `#platos` no entra en la nav.

### 7.0 Franja, nav, barra móvil y `<dialog>`
- **Franja:**
  - Mismo texto.
  - Se le agrega `.sobre-ink`.
- **Nav:**
  - Mismos estilos.
  - Enlaces en el orden de la página: Menú de hoy · Carta · Almuerzo programado · Celebraciones ·
    La casa · Cómo llegar. Es el mismo orden en el menú móvil (landing.html:236-243 y 261-270).
- **Barra fija móvil y `<dialog id="solicitud">`:**
  - La lógica y el marcado no cambian.
  - Los avisos (`.badge-amber`) pasan solos a `amber-tinta` por el componente.

### 7.1 `#inicio`: la pared (`section.pared`; reemplaza landing.html:277-326)
- **Recurso:** `salon-pared-terracota-letrero`, en dos juegos, con dirección de arte:
  ```html
  <picture>
    <source media="(max-width: 1023px)" width="1200" height="900" sizes="100vw"
      srcset="img/referencias/salon/salon-pared-terracota-letrero-apaisada-480.webp 480w,
              img/referencias/salon/salon-pared-terracota-letrero-apaisada-960.webp 960w,
              img/referencias/salon/salon-pared-terracota-letrero-apaisada-1200.webp 1200w">
    <img src="img/referencias/salon/salon-pared-terracota-letrero-960.webp" width="1200" height="1600"
      srcset="img/referencias/salon/salon-pared-terracota-letrero-480.webp 480w,
              img/referencias/salon/salon-pared-terracota-letrero-960.webp 960w,
              img/referencias/salon/salon-pared-terracota-letrero-1200.webp 1200w"
      sizes="(min-width: 1152px) 440px, 40vw" fetchpriority="high" alt="…(alt corregido, §8)…">
  </picture>
  ```
  - Es la **única** imagen con `fetchpriority="high"` y sin `loading="lazy"`.
  - No lleva `<link rel=preload>`. Se agrega solo si el LCP medido pasa de 2,5 s (§11-D6), con
    `imagesrcset` y `media` por cada fuente.
- **Hasta 1023 px:** la foto va primero, a sangre (sin radio), en `aspect-[4/3]` con
  `max-h-[55svh] w-full object-cover`.
  - Muestra las letras, las dos lámparas, las vigas y las primeras mesas.
  - Debajo va la banda terracota con el texto.
  - Cálculo a 375×812: franja ~48 + nav 65 + foto 281 + H1 en 4 líneas ~164. El H1 debe quedar
    completo por encima de la barra fija; se verifica en §11-C5.
- **Desde 1024 px:** banda terracota a todo el ancho con `grid lg:grid-cols-[7fr_5fr] lg:gap-12 items-center`.
  - Texto a la izquierda.
  - Foto 3/4 nativa a la derecha, de unos 440 px, con `rounded-[1.1rem]`: el borde izquierdo de la
    foto es la misma pared y la pared sigue fuera del marco.
  - La banda completa debe caber en 1440×900 (§11-C5).
- **Texto** (todo `ink`):
  - Eyebrow `.eyebrow`, que toma `ink` por `.pared`: «Resplandor · La Estrella».
  - H1: «Almuerzo colombiano y asados, `<span class="font-medium">`todos los días de 12 a 5`</span>`».
    El span va en peso 500 y sin itálica.
  - Bajada: «Cocina colombiana, asados y cocina mixta en Poblado del Sur, La Estrella. El mismo salón
    donde almuerzas se reserva para celebrar, hasta 30 personas.»
  - Tres puntos, que manda la especificación, cada uno con `.aplique`:
    - «Almuerzo todos los días, de 12:00 a 5:00 de la tarde.»
    - «Celebraciones en el local, hasta 30 personas.»
    - «Un menú de la semana que la gente vota.»
- **CTA** (a 375, apilados a `w-full`; desde `sm`, en fila):
  - `.btn .btn-ink` «Reservar mesa» → `$store.solicitud.abrir('reserva')`.
  - `.btn .btn-claro .border-ink` «Cotizar una celebración» → `#celebraciones`.
  - `.btn-ghost` «Ver la carta» → `#carta`.
- **Movimiento:** `.hero-entra` en eyebrow, H1, bajada, lista y CTA, igual que hoy.

### 7.2 `#hoy`: menú de hoy (parch; landing.html:329-414)
- Lógica en vivo intacta.
- Desde 1024 px, el bloque pasa a `lg:grid lg:grid-cols-[minmax(0,42rem)_1fr] lg:gap-12`, con un
  `<figure class="hidden lg:block">` a la derecha:
  - Foto: `sopa-mazorca-plato-mesa`, `aspect-[4/5]`, `max-w-[360px]`, `object-position: 50% 50%`.
  - `srcset` 480/960/1200 con `sizes="(min-width:1024px) 360px, 100vw"`.
  - `figcaption` en `text-sm text-muted`: «Foto de referencia: el menú cambia cada día.»
- Por debajo de 1024 px la figura queda oculta y, como es lazy, **no se descarga**. §11 lo verifica.
- El ícono `i-moon` del estado «sin plato fijo» (landing.html:386) pasa de `text-ink-3` a
  `text-ink-5`. Así el grep de §11-B queda limpio.

### 7.3 `#platos`: lo que sale de la cocina (nueva; `.vigas` + `section.bg-ink.text-parch.sobre-ink.seccion`)
- **Texto:**
  - Eyebrow «Platos».
  - H2 «Lo que sale de la cocina».
  - Bajada en `text-parch/70`: «Fotos de platos que hemos servido. Lo que hay hoy, y su precio, está
    en la carta.»
  - Enlace `.btn-ghost text-parch hover:bg-white/10` «Ir a la carta» → `#carta`.
- **Grilla:** `grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4`. Cada tarjeta es
  `aspect-[4/5] rounded-[1.1rem] overflow-hidden bg-ink`, con la foto en `size-full object-cover`.
  1. `tacos-maiz-rellenos-fondo-oscuro`, `object-position: 50% 55%`
  2. `bowl-cerdo-mango-fondo-oscuro`, `50% 50%`
  3. `arepa-rellena-carne-desmechada`, `50% 45%`
  4. Video `muestra-platos-estudio`:
     ```html
     <video controls preload="none" playsinline muted width="576" height="1024"
       poster="img/referencias/video/muestra-platos-estudio-poster.webp"
       aria-label="…alt de recursos.json…" class="size-full object-cover">
       <source src="img/referencias/video/muestra-platos-estudio.mp4" type="video/mp4">
     </video>
     ```
     - Sin `autoplay` ni `loop`.
     - No hay una sola solicitud al `.mp4` hasta que la persona le da play.
     - Los controles son los nativos, que están exentos del tamaño de objetivo táctil (user-agent control).
- **`sizes` de las tres fotos:** `(min-width:1152px) 264px, (min-width:1024px) 23vw, 46vw`. A 375 px
  baja la variante 480 y a 1440 px (2x), la 960.
- **Sin nombres de plato ni precios.** Si Yonatan confirma los nombres reales (§14), se agregan como
  `figcaption` de texto, nunca con precio.
- **Movimiento:** `data-aparecer` en el contenedor.

### 7.4 `#carta`: la carta en vivo (card; landing.html:417-472)
- Lógica en vivo y pestañas intactas.
- **Precio:** `text-amber` → `text-amber-tinta` (landing.html:461).
- Desde 1024 px, el mismo patrón de `#hoy`: `<figure class="hidden lg:block">` con
  `bandeja-grande-carnes-salmon-sopa`:
  - Formato `aspect-[16/9]`, `object-position: 50% 55%`.
  - `sizes="(min-width:1024px) 384px, 100vw"`. La columna mide 1104 − 672 − 48 = 384 px.
  - `figcaption`: «Foto de referencia. Lo que hay hoy y su precio está en la lista.»
- A 375 px, oculta y sin descarga.

### 7.5 `#almuerzo-programado` (parch; se mueve antes de `#celebraciones`; landing.html:563-596)
- **Foto:** `plato-sopa-jugo-estudio`.
  - Hasta 767 px: arriba de todo, `aspect-[16/9]`, `object-position: 50% 55%` (plato, sopa y jugo).
  - Desde 768 px: columna izquierda de `md:grid-cols-[1fr_1.1fr] gap-10`, en `aspect-[4/3]` y
    `object-position: 50% 45%`.
  - `srcset` 480/960/1600 con `sizes="(min-width:1152px) 507px, (min-width:768px) 46vw, 100vw"`.
- **Texto y lógica:** los mismos.
  - Frecuencias.
  - «Lo recoges en el restaurante, sin costo adicional.»
  - «O te lo llevamos a domicilio: el costo del domicilio corre por tu cuenta.»
  - Los tres pasos.
  - `.btn-ember` «Programar mi almuerzo» → `abrir('almuerzo')`.
- **Columna derecha:**
  - «Cómo funciona» deja de ser una tarjeta aparte y pasa a un bloque con borde `line` en la misma
    columna.
  - Su eyebrow toma `amber-tinta` por defecto (antes, 2,71 sobre card).

### 7.6 `#celebraciones`: en este mismo salón (`.vigas` + `section.bg-ink.text-parch.sobre-ink.seccion`; landing.html:474-561)
- **Texto:**
  - Eyebrow «Celebraciones».
  - H2 «Tu celebración, en este mismo salón».
  - Texto en `text-parch/70`: «Cumpleaños, quinces, aniversarios, reuniones de trabajo: aquí, hasta
    30 personas, con decoración de globos y un menú acordado. Todo evento es en el local; se cotiza
    por WhatsApp.» Sin precios.
- **Foto:** `almuerzo-servido-mesa-globos-apaisada`, un recorte nuevo 4:3 (§8), igual a todo ancho.
  - Se ven los globos, la pared terracota, la sopa, la rosa y el plato.
  - Hasta 1023 px: arriba de la lista, a todo el ancho del contenedor.
  - Desde 1024 px: `lg:grid-cols-12`, con la foto en `lg:col-span-5 self-start` y la lista en
    `lg:col-span-7`.
  - `sizes="(min-width:1152px) 440px, (min-width:1024px) 40vw, 100vw"`.
- **Los 8 tipos pasan de tarjetas a lista** (`<ul>`; filas separadas por `border-white/10`). Cada
  `<li>` lleva:
  - Ícono del sprite en `text-amber`, decorativo.
  - `h3` Fraunces 500 en parch, con el nombre.
  - Una línea en `text-parch/70`. Los textos de hoy se conservan tal cual.
  - `button.btn.btn-oro` «Cotizar`<span class="sr-only"> {nombre}</span>`» → `abrir('<id>')`.
- **Ids y orden** (los de hoy): `cumpleanos-infantil`, `cena-romantica`, `fiesta-quince`,
  `menu-ejecutivo`, `plan-barril`, `all-inclusive`, `evento-corporativo`, `otra`.
- **Filas y botones:**
  - Cada fila mide ≥ 44 px de alto.
  - El botón mide ≥ 44×44 px.
  - Cada botón tiene un nombre accesible **único**.
- **Movimiento:** `data-aparecer` en el contenedor.

### 7.7 `#la-casa`: por dentro (parch; landing.html:598-648)
- **H2:** «Un restaurante de barrio en La Estrella».
- **Texto:** «Resplandor es el letrero negro con letras rojas de la Cra. 61. Adentro, dos paredes: la
  terracota con las letras en relieve y la del mural. Mesas de madera para 30 personas: el mismo
  salón para almorzar a diario y para celebrar.»
- **Foto:** `mural-mujer-indigena-salon`.
  - Hasta 767 px: `aspect-[4/5]` a todo el ancho, `object-position: 50% 30%`. El recorte solo quita
    80 px de abajo, así que el rostro queda entero.
    - La propuesta 1 decía 4/3 con 50 % 60 %, pero ese encuadre corta la cabeza (arranca en y≈336
      de 1280 y la cabeza empieza en ≈290). Se descarta.
  - Desde 768 px: 3/4 nativa en `md:col-span-5` de una grilla de 12, con el texto y los hechos en
    `md:col-span-7`.
  - `sizes="(min-width:1152px) 440px, (min-width:768px) 40vw, 100vw"`.
- **Hechos:** las tarjetas de hoy, más una nueva.
  - «Hasta 30 personas».
  - «Todos los días, 12:00–17:00». Es nueva y lleva el ícono `i-clock`.
  - «5,0 en Google Maps · 2 reseñas», como enlace a la ficha.
  - Los íconos de estas tarjetas pasan a `text-amber-tinta`.
- **Mural y fachadas:**
  - Sin crédito del mural hasta que Yonatan lo confirme (§14): no se inventa un nombre.
  - `img/fachada-banderas.webp` y `img/fachada-azules.webp` dejan de referenciarse. **No se borran.**

### 7.8 `#como-llegar` (card; landing.html:650-689)
- **Foto:** arriba, dentro de la tarjeta y a todo su ancho (tope de 672 px CSS), va
  `fachada-dia-flores-balcon`.
  - Formato `aspect-[1080/310] object-cover`, `object-position: 50% 60%`.
  - `srcset` 480/960/1080 con `sizes="(min-width:768px) 672px, 100vw"`.
  - `figcaption`: «Busca este letrero en la Cra. 61 #79 Sur-62.»
  - En pantallas 2x queda a 1,24× y se acepta: no hay una fuente mayor y no se agranda.
- **Dirección, plus code, horario, WhatsApp y los tres botones:** sin cambios.

### 7.9 `#preguntas` (parch; landing.html:691-749)
- El contenido no cambia.
- El ícono `i-circle-plus` pasa de `text-amber` (2,71) a `text-amber-tinta`, porque indica estado.

### 7.10 Pie (`.vigas` + `footer.bg-ink.sobre-ink`; landing.html:753-791)
- **Rótulo:** arriba de las tres columnas va
  `<p class="rotulo" aria-hidden="true">RESPLANDOR</p>`.
- **Columnas:** los contenidos no cambian.
- **Copyright:** `text-parch/40` (3,54, **falla**) → `text-parch/55` (5,53).

### Recursos que esta fase NO usa (siguen en el banco)
| Recurso | Por qué queda fuera |
|---|---|
| `fachada-noche-letrero-dorado` | Sugiere servicio de noche con cierre a las 17:00 (§14) |
| `fachada-dia-globos-tricolor-banderas` | Decoración del Mundial ya pasada (§14) |
| `mojarra-frita-patacon-mesa` | Se ve el brazo y las piernas de una persona en el borde izquierdo: x 0–95, y 480–700 de la variante 900 (verificado) |
| `hamburguesa-papas-mesa` | La marca de la gaseosa se lee en primer plano |
| `servicio-grupo-platos-fila` | Mesón de cocina y pared en obra |
| `preparacion-arepa-carne-queso` | Segundo video, sin función |
| `wrap-nachos-guacamole-mesa`, `papas-cargadas-bowl`, `arepitas-…`, `arepa-carne-desmechada-detalle`, `frijoles-…`, `arepa-quesito-…`, `mesa-sopa-plato-mural-fondo`, `jugos-…` | Sin lugar en esta página. Quedan para la galería o una fase siguiente |

---

## 8. Recursos nuevos y correcciones del banco (dueño: parte imágenes)

Dos recortes 4:3 de dirección de arte, con la receta de la casa. El script ya acepta el recorte y
nunca agranda.

```bash
scripts/recursos-imagen.sh img/referencias/_originales/salon-pared-terracota-letrero.jpeg \
  salon salon-pared-terracota-letrero-apaisada "1200x900+0+189"
scripts/recursos-imagen.sh img/referencias/_originales/almuerzo-servido-mesa-globos.jpeg \
  en-la-mesa almuerzo-servido-mesa-globos-apaisada "1200x900+0+230"
```

Pesos medidos con esa receta (-q 80 -m 6):

| Recurso | 480 | 960 | 1200 |
|---|---|---|---|
| Salón | 18 428 B | 66 806 B | 97 516 B |
| Globos | 29 992 B | 106 244 B | 146 612 B |

Antes de registrar nada, se mira cada salida con Read.

`recursos.json`: una entrada por recorte, con los campos de las demás más `"deriva_de": "<id>"`,
`"ajustes": "Recorte 1200x900+0+… (4:3 para móvil)"` y los `bytes` reales.

Correcciones de `alt` en `recursos.json`. Las dos de hoy son **falsas**:
- `salon-pared-terracota-letrero` y su `-apaisada`:
  - Hoy dice «letras doradas … vigas blancas y negras».
  - Debe decir: «Salón de Resplandor Restaurante: pared terracota con las letras oscuras en relieve
    «RESPLANDOR» y dos lámparas redondas, vigas negras en el techo blanco, mesas de madera clara y
    sillas negras.»
- `plato-sopa-jugo-estudio`:
  - Hoy dice «aguacate … una tira de plátano», y en la foto a 1600 px no hay ni aguacate ni plátano.
  - Debe decir: «Almuerzo de estudio: plato con trozos gratinados en salsa verde, arroz blanco,
    desmechado en salsa blanca con maíz y ensalada picada, junto a una sopa crema con un espiral de
    crema y un jugo, sobre fondo negro con el mural detrás.»
  - Los nombres reales los confirma Yonatan (§14).
- `almuerzo-servido-mesa-globos-apaisada` (nuevo):
  - «Almuerzo servido en una mesa junto a la pared terracota: plato con pollo en salsa, arroz y
    ensalada, una sopa y una rosa, con un racimo de globos verde menta y coral al fondo.»
  - El puré queda fuera del recorte.

---

## 9. `carta.html` y `menu.html`: lo que cambia para seguir homogéneas

Sin cambios de maquetación, de lógica ni de `theme-color` (sigue `#1C1A17`). Solo cambian la fuente
y el color de texto que hoy falla AA.

| Archivo:línea | Hoy | Cambio | Contraste |
|---|---|---|---|
| carta.html:30, menu.html:31, landing.html:38-40 | Enlace de fuentes con DM Sans 300 | Enlace único de §4, byte a byte igual en las tres | — |
| carta.html:162 (precio del día, 21,6 px, peso 500) | `text-amber` | `text-amber-tinta` | 3,01 → 5,46 |
| carta.html:196 (precio de ítem) | `text-amber` | `text-amber-tinta` | 3,01 → 5,46 |
| carta.html:292 (total de la cuenta) | `text-amber` | `text-amber-tinta` | 3,01 → 5,46 |
| menu.html:290 (`style` en línea) | `color:var(--color-amber)` | `color:var(--color-amber-tinta)` | 2,74 → 4,96 |
| menu.html:224 y 274 | `text-ink-3` | `text-ink-5` | 2,11–2,35 → 5,31–5,91 (parch/card) |
| componentes.css `.badge-amber` | `color: amber` | `color: var(--color-amber-tinta)` | 2,74 → 4,96 |
| componentes.css `.badge-teal` | `color: teal` | `color: var(--color-teal-tinta)` | 4,46 → 5,24 |
| componentes.css `.eyebrow`, `:focus-visible` | Fijos | Variables de contexto de §3 | — |
| carta-menu.css:112 `.comp-k` | `color: ink-3` | `var(--color-ink-5)` | 2,35 → 5,91 |
| carta-menu.css:88 `.react .lbl` | `ink-3` | `ink-5` | Sin marcado hoy; se corrige igual |
| carta-menu.css:91-92 `.react.on-igual` | `amber` | `amber-tinta` | 2,74 → 4,96 |

Carta y menú **no** usan `terracota`, `letrero`, `.pared`, `.vigas` ni `.rotulo`: la terracota es
del hero de la landing. Cabecera, pie, monograma y `.btn-*` siguen siendo los compartidos, así que
las tres páginas se ven de la misma familia.

---

## 10. Rendimiento: presupuesto de bytes

Cifras sacadas de las variantes reales (`recursos.json` y §8) y de los activos medidos el
2026-09-28, en gzip:

| Activo | Peso |
|---|---|
| landing.html | 11,2 KB (se prevén unos 13 KB tras el cambio) |
| resplandor.css | 8,5 KB |
| JS propio | 21,2 KB |
| Alpine 3.17.4 | 19,9 KB |
| Fuentes | 104,4 KB |
| logo-r.webp | 8,7 KB |

| Escenario (Playwright, transferido, **sin** las respuestas JSON de Supabase) | Estimado | **Tope** |
|---|---|---|
| Primera vista a 375×812, DPR 2, sin scroll: HTML + CSS + fuentes + JS + logo + hero apaisada 960 (66,8 KB) | ~244 KB | **270 KB** |
| Página entera a 375×812, DPR 2, con scroll hasta el pie. Imágenes: hero 66,8 · platos 480 ×3 83,6 · póster 31,0 · almuerzo 960 50,7 · celebraciones 960 106,2 · mural 960 108,4 · flores 960 46,3 · logo 8,7 | ~671 KB | **750 KB** |
| Página entera a 1440×900, DPR 2. Imágenes: hero 118,1 · sopa-mazorca 146,9 · platos 960 ×3 234,0 · póster 31,0 · bandeja 92,3 · almuerzo 1600 99,0 · celebraciones 106,2 · mural 108,4 · flores 54,2 · logo 8,7 | ~1,17 MB | **1,25 MB** |
| Página entera a 1440×900, DPR 1 | ~0,58 MB | **0,65 MB** |
| Solicitudes a `.mp4` sin hacer clic en play | 0 | **0** |

Reglas de carga:
1. Solo el hero es ansioso (`fetchpriority="high"`, sin lazy). Toda otra `<img>` va con
   `loading="lazy" decoding="async"`, más `width` y `height`.
2. Toda foto lleva `srcset` con **todas** sus variantes publicadas y un `sizes` por columna, como
   en §7. No se sirve una variante mayor que la que pide el `sizes`.
3. Las figuras que solo existen desde `lg` usan `hidden lg:block` con lazy. No se descargan a 375 px.
4. Sin `preload` de imagen salvo lo que dice §7.1. El único `preconnect` que queda es el de las fuentes.
5. Si un 960 usado pasa de 150 KB, la parte imágenes lo recodifica con `-q 72`. Hoy aplica a
   `sopa-mazorca-plato-mesa-960` (146,9 KB): **opcional**, entra en el tope.

---

## 11. Criterios de aceptación (todos medibles)

### A. Pruebas y comprobaciones (terminal)
1. `node --test scripts/pruebas/*.test.mjs`: cero fallas nuevas y el conteo ≥ 160 más las pruebas nuevas.
   - **Línea base del 2026-09-28: 159/160.**
   - La falla es `webmcp.test.mjs:292`, que tiene la semana `'2026-09-21'` escrita a mano y rompió
     con el cambio de semana. Es preexistente y ajena a este trabajo. La corrige la parte agentes
     congelando el reloj (§12); no cuenta como regresión.
2. `node scripts/css.mjs --comprobar`, `node scripts/iconos.mjs --comprobar` y
   `node scripts/descubrimiento.mjs --comprobar` salen 0. Antes se regeneran el CSS y el sprite: el
   hero deja de usar `i-clock`/`i-users` en ese lugar y la-casa suma `i-clock`.
3. **Prueba nueva `scripts/pruebas/imagenes.test.mjs`** (trampa, como el `pedido.test.mjs` de lusof).
   Sobre `landing.html`, `carta.html` y `menu.html` verifica esto:
   - Rutas:
     - Todo `src`, `srcset`, `poster` y `<source src>` existe en disco.
     - Está en `recursos.json` con `publicable: true`, o en la lista blanca: `img/logo-r.webp`,
       `img/favicon-32.png`, `img/og-resplandor.jpg`, `favicon.ico` y `apple-touch-icon.png`.
     - Ninguna ruta contiene `_originales` ni `publicidad-`.
   - Atributos de `<img>`:
     - Toda `<img>` tiene `width`, `height` y `alt`.
     - El `alt` es idéntico al de `recursos.json` si la ruta es de `img/referencias/`. `alt=""` solo
       se permite en el monograma.
   - Carga:
     - En `landing.html` hay exactamente **una** `fetchpriority="high"`, en una `<img>` de
       `salon-pared-terracota-letrero`, sin `loading`.
     - Toda otra `<img>` tiene `loading="lazy"`.
   - Video: ningún `autoplay`, y todo `<video>` tiene `preload="none"` y `controls`.
4. **Prueba nueva `scripts/pruebas/contraste.test.mjs`:**
   - Lee el `@theme` de `base.css` y exige que existan `terracota #CE8965`, `amber-tinta #8C611F`,
     `teal-tinta #256F67` y `letrero #ED6B50`.
   - Exige que **no** existan `noche`, `selva`, `barro`, `quemado` ni `turquesa`.
   - Recalcula cada par permitido de la tabla de §3. Texto ≥ 4,5; texto grande (≥ 24 px, o
     ≥ 18,66 px en negrita) ≥ 3; no-texto y foco ≥ 3.
5. **Trampa de reglas** (en `imagenes.test.mjs` o en una prueba propia). `landing.html` debe:
   - Contener «30 personas».
   - **No** contener `/catering|a domicilio.*(evento|celebraci)|500 personas|150 personas|\+2\.000|desayuno/i`.
   - No tener ningún `$` seguido de un dígito fuera de plantillas Alpine (`x-text`).

### B. Grep (deben dar 0 salvo que se diga otra cosa)
- `grep -nE 'italic|<em[ >]' landing.html carta.html menu.html`
- `grep -nE '_originales|publicidad-' landing.html carta.html menu.html`
- `grep -n 'autoplay' landing.html`
- `grep -nE '#[0-9A-Fa-f]{3,6}\b' assets/css/landing.css`: sin hex literales. Los data-URI no llevan
  color; el color lo pone `mask`.
- `grep -nE '(linear|radial)-gradient' assets/css/landing.css assets/css/componentes.css`
- `grep -nE 'text-parch/40|text-ink-3' landing.html carta.html menu.html`
- `grep -nE 'text-amber[" ]' carta.html menu.html`: hoy da carta.html:162, 196 y 292, y debe dar 0.
  Los precios usan `text-amber-tinta`, y `text-amber` queda solo para íconos `<svg>` decorativos.
- `grep -o 'fonts.googleapis.com/css2[^"]*' landing.html carta.html menu.html | sort -u | wc -l` → **1**

### C. Navegador (Playwright, Chromium, en 375×812 DPR 2 y en 1440×900 DPR 1 y 2)
1. `document.documentElement.scrollWidth <= innerWidth` en cada punto del recorrido, también con el
   menú móvil y el `<dialog>` abiertos. Se revisa además a 360 px.
2. Todo `a`, `button`, `summary`, `select` e `input` visible mide ≥ 44×44 px de caja.
   - Excepciones: los enlaces dentro de un párrafo (`p a`) y los controles nativos de `<video>`.
3. Consola: cero `error`, con Supabase respondiendo.
4. Orden: los `section[id]` en el DOM son `inicio, hoy, platos, carta, almuerzo-programado,
   celebraciones, la-casa, como-llegar, preguntas`. Los `href` de la nav siguen el mismo orden sin
   `#platos`.
5. Primera pantalla:
   - A 375×812, el rectángulo del H1 termina por encima del borde superior de `#barra-movil`, y el
     botón «Reservar» de la nav es visible.
   - A 1440×900, el H1, los tres puntos y «Reservar mesa» terminan en y ≤ 900.
6. Hero:
   - A 375 px, la imagen actual del hero es `…-apaisada-960.webp` (`currentSrc`).
   - A 1440 px, DPR 1, es `…letrero-480.webp`.
   - A 1440 px, DPR 2, es `…letrero-960.webp`.
7. Descargas a 375 px:
   - No hay solicitudes a `sopa-mazorca-plato-mesa-*` ni a `bandeja-grande-carnes-salmon-sopa-*`.
   - No hay solicitudes a `.mp4` hasta hacer clic en el video.
   - Después del clic, el video se reproduce y se puede pausar con teclado.
8. Presupuestos de §10 medidos sumando `response.body().length` después de desplazarse hasta el
   pie, con pausas de 300 ms.
9. Estabilidad y carga:
   - CLS ≤ 0,02 (PerformanceObserver `layout-shift`, recorrido completo), a 375 y a 1440 px.
   - LCP: el elemento LCP es la `<img>` del hero.
   - Con Lighthouse 12 móvil (Slow 4G, CPU 4x), mediana de 3 corridas: LCP ≤ 2,5 s, TBT ≤ 100 ms y
     rendimiento ≥ 90.
   - Si el LCP no cumple, se aplica el `preload` de §7.1 y se mide otra vez.
10. Contraste en vivo, con axe-core inyectado **solo en la prueba** (regla `color-contrast`): cero
    violaciones en landing, carta y menú, a 375 y a 1440 px.
    - Sobre fotos no se pone texto: toda leyenda va fuera de la foto.
11. Foco:
    - Tabulando por el hero, el `outline` computado es `ink`.
    - En `#platos`, `#celebraciones` y el pie es `amber-light`.
    - En el resto es `ember`.
12. Movimiento reducido (`emulateMedia({reducedMotion:'reduce'})`):
    - La duración computada de `transition` y `animation` en `[data-aparecer]` y `.hero-entra` es
      ≤ 0,01 ms.
    - Todo el contenido es visible sin hacer scroll-trigger.
13. `<dialog>`:
    - Cada CTA que llama a `abrir(...)` deja `#solicitud[open]` con el tipo correcto.
    - Escape lo cierra y el foco vuelve al botón de origen.
    - Los 8 «Cotizar» tienen nombres accesibles distintos.
14. `carta.html` y `menu.html`, capturas antes y después a 375 y a 1440 px:
    - Las únicas diferencias son el color de los precios, los badges ámbar y teal y las etiquetas
      `comp-k` y 224/274.
    - Misma altura de página (±2 px).
    - Cero errores de consola.
    - Sin scroll horizontal.

### D. Capa de agentes intacta
- `git diff --stat` sobre `assets/js/{local,solicitud,vivo,agentes}.js`, `llms.txt`, `local.json`,
  `sitemap.xml`, `robots.txt` y `mcp/` da vacío.
- El bloque `datos-estructurados` de `landing.html` no cambia (lo vigila
  `descubrimiento.mjs --comprobar`).
- `landing.js` solo cambia si hace falta. Esta fase no necesita JS nuevo.

---

## 12. Reparto y orden de trabajo

| Orden | Parte (dueño) | Archivos | Entrega |
|---|---|---|---|
| 1 | Imágenes | `img/referencias/{salon,en-la-mesa}/…-apaisada-*.webp` (nuevos), `recursos.json`, `LEEME.md` | §8: dos recortes, 3 `alt` y las entradas nuevas. Recodificación opcional de `sopa-mazorca-960` |
| 2 | Base visual | `base.css`, `componentes.css` | 4 tokens con sus comentarios. `.btn-ink`. Variables `--foco`/`--eyebrow` y `.sobre-ink`. `.badge-amber` y `.badge-teal`. Eyebrow a .75rem |
| 3 | Landing | `landing.html`, `landing.css` (`landing.js` solo si hace falta) | §7 completo: `.pared`, `.vigas`, `.aplique`, `.aplique-oro`, `.rotulo`, `.titulo-seccion` y el enlace de fuentes |
| 3 | Carta-menú | `carta.html`, `menu.html`, `carta-menu.css` | §9 |
| 4 | Pruebas | `scripts/pruebas/imagenes.test.mjs`, `scripts/pruebas/contraste.test.mjs`; `webmcp.test.mjs:292` (la parte agentes congela el reloj) | §11-A |
| 5 | Madre | `resplandor.css` y sprites regenerados; `docs/landing-y-agentes.md` (§13); recorrido §11-C | Revisión y commit, que hace Yonatan o la madre, **nunca un agente** |

Los pasos 2 y 3 se pueden hacer en paralelo si 3 compila contra los nombres de este documento.

---

## 13. Cambios que necesita `docs/landing-y-agentes.md` (los aplica su dueño, no esta fase)

1. **Reglas duras:** la línea «`img/referencias/` está fuera de git… nunca la referencies desde
   HTML» **ya no es cierta**, porque `.git/info/exclude` solo cubre `_originales/`. Queda así:
   - Lo publicable vive en `img/referencias/<categoría>/` y `recursos.json` es su única verdad.
   - El HTML solo usa recursos con `publicable: true`, nunca `_originales/` ni `publicidad-*`.
2. **Sistema visual:**
   - Remitir a este documento.
   - Sumar los 4 tokens.
   - Anotar el hecho «las letras del salón son oscuras; el dorado es solo la R».
   - Anotar «sin itálica».
   - Motivos: pared, vigas, aplique y rótulo. El mural solo va como foto.
3. **Landing:**
   - El hero pasa a `salon-pared-terracota-letrero`. `fachada-rojo-negro.webp` queda solo como
     fuente de `og-resplandor.jpg`, sin borrarse.
   - `#la-casa` usa el mural en lugar de `fachada-banderas`/`fachada-azules`.
   - El orden de secciones es el de §7, con `#platos` nuevo.
4. **Imágenes publicables:** los recortes de §8 y las reglas de carga de §10.

---

## 14. Lo que queda para Yonatan (nada de esto se decide solo)

1. **Mural:** ¿quién lo pintó? ¿Hay permiso para mostrarlo en la web? ¿Quiere que se le dé crédito
   y con qué nombre?
   - Mientras no responda, solo sale como foto del salón en `#la-casa`, sin crédito inventado.
   - Si hay permiso, se puede evaluar la greca abstraída de la propuesta 2 en otra ronda.
2. **Platos de estudio:** los tacos de maíz, el bowl de cerdo con mango, la arepa rellena y el
   almuerzo de estudio. ¿Siguen en la carta? ¿Cómo se llaman?
   - Sin nombre, van sin rótulo.
   - Si alguno ya no se sirve, sale de `#platos`.
3. **Noche:** el local cierra a las 17:00. ¿Hay celebraciones después de esa hora?
   - Si no, la foto nocturna no se usa: sugeriría un servicio que no existe.
   - Si sí, hay que cambiar el horario en la única verdad antes de mostrarla.
4. **Fachada:** los globos tricolor con banderas del Mundial y las flores infladas son decoración
   temporal. ¿Puede tomar una foto de día del letrero sin decoración y sin gente?
   - Mientras tanto, «Cómo llegar» usa la tira de flores.
5. **Salón:**
   - ¿Los 30 caben sentados en un solo ambiente, con la pared terracota y el mural en el mismo salón?
     El texto dice «el mismo salón».
   - ¿La decoración de globos la pone el restaurante o un tercero? El texto dice «con decoración de
     globos».
6. **Alt del almuerzo de estudio:** ¿qué son los trozos verdes gratinados y el desmechado en salsa
   blanca? El `alt` corregido los describe sin nombrarlos.
7. **Curaduría:**
   - `mojarra-frita-patacon-mesa` muestra el brazo y las piernas de una persona. ¿Se recorta o se
     retira del banco? Por defecto, fuera de la landing.
   - `hamburguesa-papas-mesa` muestra la marca de la gaseosa. ¿Se recorta? Por defecto, fuera.
   - `servicio-grupo-platos-fila` muestra una pared en obra. Por defecto, fuera.
8. **Jugos en vaso de barro:** ¿de qué es el escarchado? ¿Son naturales? No se usan ni se afirma
   nada hasta saberlo.
9. **Desayunos:** existe un video no publicado que los menciona. ¿Los ofrecen? Si no, ese video
   queda archivado para siempre.
10. **Logo:** para un PNG transparente hace falta el archivo fuente del monograma (vector o render
    original). Es una pregunta heredada de la curaduría.
11. **Publicación:** todo lo que entre a `img/referencias/<categoría>/` se vuelve público al hacer
    push (el repo es público). El commit, el push y el despliegue son de Yonatan.

---

## 15. Puntajes de las propuestas (0–5; juez, 2026-09-28)

| Criterio | P1 «La casa» | P2 «El mural y la mesa» | Por qué |
|---|---|---|---|
| Fidelidad a fotos e identidad | **4** | 3,5 | P1 construye el sistema con lo que el local es dueño y corrige que las letras son oscuras, pero deja sin usar las mejores fotos (las de estudio) y su encuadre 4/3 del mural corta la cabeza. P2 usa más material y detectó dos fallas reales de curaduría, pero apoya la marca en el mural de un tercero sin permiso confirmado, y su hero de estudio no es propio del local. |
| Claridad para el cliente | **4** | 3,5 | El H1 de P2 dice cuándo abre, pero su hero 1:1 a 375 px (375 px de alto) deja casi todo el H1 debajo de la barra fija. Además suma dos secciones de ambiente y manda «la casa» al 8.º lugar. P1 deja el H1 arriba del pliegue y ata las celebraciones a «este mismo salón», pero su H1 no dice la hora y baja `#hoy` al tercer lugar. |
| Homogeneidad con carta y menú | **4** | 3 | P1: tokens aditivos, el mismo enlace y el mismo `theme-color`, aunque su lista de fallas del oro quedó incompleta. P2 da la lista completa, pero cambia `theme-color` y el enlace de fuentes en las tres páginas (+81,7 KB de itálica) y agrega 7 tokens, uno casi duplicado de `ink`. |
| Accesibilidad | **4** | 3,5 | Las dos calculan contrastes y quitan la oblicua falsa. P2 reproduce video al entrar en pantalla sin una pausa siempre disponible (2.2.2). A ninguna le vieron `badge-teal` (4,46), `ink-3` como texto, `parch/40` del pie ni el foco ember sobre ink (2,87). |
| Rendimiento | **4,5** | 2,5 | P1: ~250 KB la primera vista, ≤ 1 MB en total y sin video. P2: 340 KB la primera vista, ~1,4 MB, más 1,48 MB de video por IntersectionObserver y la itálica, que costaba el doble de lo que estimó. |
| Riesgo de implementación | **3,5** | 2,5 | P1: cinco motivos, brillo, foto encimada y una variante `-768` por crear. P2: dos secciones nuevas, siete tokens, cambios de cabecera en tres páginas, JS de video, greca animada con `clip-path` y un carrusel con riesgo de desborde. |
| **Total (sobre 30)** | **24** | **18,5** | **Base: P1**, con los injertos de §0 |
