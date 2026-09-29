# img/referencias/ — banco de fotos y video de Resplandor

Curaduría del lote del 2026-09-28 (25 fotos + 4 videos de WhatsApp) más los crudos
viejos del 26/27-sep. Esta carpeta es el **banco de material**, no la landing: lo
que usan `index.html`, `carta.html` y `menu.html` sigue viviendo directo en
`img/` (esos archivos no se tocaron).

## Qué hay aquí

```
img/referencias/
  _originales/     crudos intactos, fuera de git (ver .gitignore de abajo)
  fachada/         fachada del local, de día y de noche
  salon/           interior: pared con el letrero, mural
  platos/          fotos de estudio (fondo oscuro), primeros planos de comida
  en-la-mesa/      platos servidos tal cual llegan a la mesa, en el salón
  bebidas/         jugos y bebidas
  grupos/          servicio para varias mesas / grupos
  video/           los dos videos publicables + su poster
  marca/           el monograma R en los tamaños oficiales
  recursos.json    índice máquina de TODO lo de arriba (publicable o no)
```

`_originales/` tiene los 34 crudos (25 fotos + 4 videos del 28-sep, y los 5
archivos viejos de fachada/logo/mural), renombrados en kebab-case, bytes
intactos, más `INDICE.tsv` (nombre original de WhatsApp → nombre nuevo →
categoría → publicado si/no → nota). Es la única carpeta que **no** entra a
git (ver más abajo); es la fuente si algún día hace falta volver a recortar
algo.

## Qué NO se publicó, y por qué

| Original | Por qué queda solo en `_originales/` |
|---|---|
| `publicidad-lunes-20-descuento.jpeg` | Es una pieza publicitaria (no una foto), con un descuento y un aviso de "domicilios disponibles" sin confirmar contra los datos reales. Mismo trato que las promos vencidas que ya se sacaron de la landing. |
| `publicidad-colombia-portugal.mp4` | Video promocional con texto quemado sobre un partido puntual (Colombia vs Portugal). Es publicidad efímera, no contenido evergreen para la landing. |
| `publicidad-desayunos-precio.mp4` | Tiene texto quemado sobre "desayunos" y una oferta de precio ("un precio que no vas a creer") que no está confirmada: el horario real es 12:00–17:00 y solo se habla de almuerzo en toda la documentación. Ver preguntas abiertas. |
| `mural-mujer-indigena-captura-vieja.png` | Captura de pantalla vieja (400×698) del mural; las fotos reales `salon/mural-mujer-indigena-salon-*.webp` (y `en-la-mesa/mesa-sopa-plato-mural-fondo-*.webp`) la reemplazan. |
| `fachada-globos-azules.webp`, `fachada-globos-banderas.webp`, `fachada-globos-rojo-negro-captura-maps.webp` | Ya tienen su salida oficial en `img/fachada-azules.webp`, `img/fachada-banderas.webp` e `img/fachada-rojo-negro.webp`. No se regeneraron ni se tocaron. |

Además, en `logo-r-dorada.png` **no se generó una versión de 512 px** (el
render fuente mide 477×432; agrandarlo violaría la regla de "nunca se
agranda"), y **no se generó un PNG transparente**: el fondo es un degradado
suave que se funde con los brillos del anillo dorado, así que un recorte
automático (floodfill por color) termina comiéndose parte del logo. Hace
falta el archivo fuente (vector o render 3D) para un recorte transparente
limpio; mientras tanto, `marca/logo-r-*.webp` sale con el mismo fondo claro
que ya usa `img/logo-r.webp`.

## Ajustes obligatorios que se hicieron (mirando cada foto a resolución completa)

- **QR de la mesa**: `en-la-mesa/wrap-nachos-guacamole-mesa` — la foto original
  tenía el número de mesa (7) y el QR de su cuenta a la derecha del plato; se
  recortó esa columna entera.
- **Personas identificables / negocios vecinos en la fachada**:
  - `fachada/fachada-dia-globos-tricolor-banderas` — se recortó la planta baja:
    había un domiciliario con la cara visible, una moto de reparto de carnes y
    el aviso de la peluquería vecina (Lucir).
  - `fachada/fachada-dia-flores-balcon` — se recortó la pancarta promocional
    (con precios) y los negocios vecinos (Cacharrería Paula, Lucir).
  - `fachada/fachada-noche-letrero-dorado` — se recortó el balcón de arriba
    (había una persona sentada) y la misma pancarta promocional.
- Ninguna otra foto tenía placas de vehículos legibles, otras personas
  identificables ni afiches de otros negocios dentro del encuadre publicado.

## Recortes nuevos (identidad visual v2, 2026-09-29)

- **`en-la-mesa/mesa-sopa-plato-mural-fondo-3x4`**: recorte 3:4 (830×1107) de
  `mesa-sopa-plato-mural-fondo` para `#hoy` de `index.html` (docs/identidad-visual.md
  v2 §8). Quita el papel kraft con un logo parcial del borde izquierdo (crudo
  x 0–60, y 1060–1280) y la decoración que cuelga del techo (crudo y 0–100):
  `scripts/recursos-imagen.sh img/referencias/_originales/mesa-sopa-plato-mural-fondo.jpeg en-la-mesa mesa-sopa-plato-mural-fondo-3x4 "830x1107+70+190"`.
  Sale `-480.webp` (59 788 B) y `-830.webp` (128 552 B); la lista 480/960/1600
  se corta en el ancho nativo, 830.
- **Corrección de `alt`**: `mesa-sopa-plato-mural-fondo` (el original, sin usar
  todavía) y su recorte de arriba decían «un jugo» junto al plato; mirando la
  variante 900 a resolución completa, el vaso es de agua con hielo (transparente,
  sin color de jugo). Los dos `alt` pasan a decir «un vaso con hielo».
- **Corrección de `alt`**: `muestra-platos-estudio` (el video de `#platos`) omitía
  que abre con unos 3 segundos del rostro de la mujer del mural antes de mostrar
  los platos. Se corrigió para decirlo explícitamente (mismo texto en el
  `aria-label` del `<video>` en `index.html`).

## Convenciones

- **Nombres**: kebab-case, sin tildes ni ñ, descriptivos de lo que se ve
  (`bebidas/jugos-vasos-de-barro-mesa`, `fachada/fachada-noche-letrero-dorado`).
  No se inventaron nombres de platos de la carta: la carta pública se lee en
  vivo de Supabase (`carta_publica`, ver `assets/js/vivo.js`) y este repo no
  tiene un respaldo estático con los nombres reales para confirmar contra él
  (se buscó en `carta.html`, `assets/js/*.js` y `local.json`: todo apunta a
  Supabase en vivo, no hay una lista fija). Por eso los platos de fondo oscuro
  llevan nombres descriptivos (`tacos-maiz-rellenos-fondo-oscuro`,
  `bowl-cerdo-mango-fondo-oscuro`) en vez de un nombre de carta — quedan en
  preguntas abiertas si se quieren renombrar con el nombre real.
- **Variantes webp**: anchos 480, 960 y 1600, **sin agrandar nunca** — si el
  ancho nativo (o el del recorte) es menor a uno de esos números, la variante
  más grande sale al ancho real (por eso una foto recortada a 780 px de ancho
  solo tiene `-480.webp` y `-780.webp`, nunca `-960.webp` ni `-1600.webp`).
  Receta exacta, la misma que corre `scripts/recursos-imagen.sh`:
  1. `magick <crudo> -auto-orient [-crop WxH+X+Y] -colorspace sRGB base.png`
  2. `magick base.png -filter Lanczos -resize <ancho>x variante.png`
  3. `cwebp -q 80 -m 6 -metadata none variante.png -o <slug>-<ancho>.webp`
  4. Si la variante de la franja "960" (o la más grande, cuando reemplaza a
     1600) pesa más de ~180 KB, se repite el paso 3 con `-q 72` y, si sigue
     pesando de más, con `-q 62`.
- **Videos**: `video/<slug>.mp4` — h264, `yuv420p`, `crf 27`, sin audio (`-an`),
  `-movflags +faststart`, sin reescalar (los dos publicados ya eran 576×1024,
  livianos). Poster: `video/<slug>-poster.webp`, el cuadro más representativo
  (sin texto quemado, sin manos ni personas en primer plano), mismo `cwebp -q
  80 -m 6 -metadata none`. Antes de publicar cualquier video se armó una hoja
  de contacto a 1 fps (`ffmpeg -vf fps=1,scale=200:-1`) y se miró completa —
  así se detectaron los dos videos publicitarios que no se publican.
- **Metadatos**: ninguna variante publicada lleva EXIF ni GPS (`cwebp
  -metadata none`); los crudos en `_originales/` sí conservan lo que traían de
  WhatsApp (por si hace falta la fecha original).

## Cómo sumar una foto nueva

```bash
# 1) el crudo entra a _originales/ con un nombre descriptivo (mv, no cp)
mv la-foto-nueva.jpg img/referencias/_originales/nombre-descriptivo.jpg

# 2) generar las variantes oficiales (sin recorte)
scripts/recursos-imagen.sh img/referencias/_originales/nombre-descriptivo.jpg \
  <categoria> nombre-descriptivo

# 2b) …o con un recorte (para tapar un QR, gente, una promo, etc.)
scripts/recursos-imagen.sh img/referencias/_originales/nombre-descriptivo.jpg \
  <categoria> nombre-descriptivo "ANCHOxALTO+X+Y"

# 3) mirar el resultado ANTES de agregarlo a recursos.json
#    (Read de cada variante, o una hoja de contacto con magick montage)

# 4) sumar una fila a recursos.json (una por recurso, no por variante) y una
#    fila a _originales/INDICE.tsv
```

Para un video nuevo: sacar una hoja de contacto a 1 fps y mirarla completa
ANTES de decidir si se publica («¿tiene texto quemado con precios o promos?
¿se ve a alguien identificable?»); si pasa el filtro, transcodificar con la
receta de arriba y sacar el poster con
`ffmpeg -ss <segundo> -i video.mp4 -frames:v 1 poster.png`.

## `.gitignore` de esta carpeta

`.git/info/exclude` ignora `img/referencias/_originales/` (los crudos, con
gente sin recortar, capturas de Maps, promos con precios). El resto de
`img/referencias/` — las categorías de arriba, ya recortadas y optimizadas —
sí es publicable y sí entra a git. Comprobado con
`git status --short --ignored`.

## Preguntas abiertas para Yonatan

1. **Nombres reales de los platos de fondo oscuro** (`tacos-maiz-rellenos-
   fondo-oscuro`, `bowl-cerdo-mango-fondo-oscuro`, y los primeros planos de
   carne desmechada): no hay un respaldo estático de la carta en el repo para
   confirmarlos contra el nombre real. Si querés que lleven el nombre de la
   carta, decímelo y renombro.
2. **`publicidad-desayunos-precio.mp4`**: ¿Resplandor ofrece desayunos? El
   horario documentado es solo almuerzo (12:00–17:00). Si sí los ofrecen,
   habría que grabar o pedir una versión del video sin el texto quemado del
   precio para poder publicarlo (o mencionar el horario real de desayuno en
   vez de un precio).
3. **Logo transparente**: para un PNG con fondo transparente de verdad (sin
   el degradado claro) hace falta el archivo fuente del monograma (vector o
   el render 3D original), no el PNG ya renderizado que había en
   `_originales/logo-r-dorada.png`.
4. **`servicio-grupo-platos-fila`**: al fondo se ve una pared en obra (cables
   sueltos, drywall sin terminar) en lo que parece la zona de paso de cocina.
   Se publicó igual porque el plato es lo que se ve en primer plano, pero si
   preferís no mostrar esa zona avisame y la saco.
