#!/usr/bin/env bash
# scripts/recursos-imagen.sh — genera las variantes webp oficiales de una foto
# para img/referencias/<categoria>/, con la MISMA receta usada a mano para
# curar el lote de fotos del 2026-09-28 (ver img/referencias/LEEME.md).
#
# Uso:
#   scripts/recursos-imagen.sh <original> <categoria> <slug> [crop] [anchos]
#
#   <original>  ruta al crudo (normalmente img/referencias/_originales/<algo>.jpeg)
#   <categoria> carpeta destino dentro de img/referencias/ (fachada, salon,
#               platos, en-la-mesa, bebidas, grupos, marca...)
#   <slug>      nombre en kebab-case, sin la categoría ni el ancho
#               (p.ej. "jugos-vasos-de-barro", no "bebidas-jugos-960")
#   [crop]      opcional, geometría de ImageMagick "WxH+X+Y" para recortar
#               ANTES de escalar (tapar un QR, quitar gente, encuadrar la
#               fachada). Si se omite, no se recorta.
#   [anchos]    opcional, lista de anchos separados por espacio, de menor a
#               mayor. Por defecto "480 960 1600".
#
# Reglas (las de docs/landing-y-agentes.md y del pedido de curaduría):
#   - auto-orient + sRGB + resize Lanczos, SIEMPRE antes de codificar.
#   - Nunca se agranda: si el ancho pedido es >= el ancho nativo (o el del
#     recorte), se genera esa única variante al ancho nativo y se corta ahí
#     la lista (por eso una foto de 1200 px de ancho nativo sale como
#     "-480.webp" y "-960.webp" y "-1200.webp", nunca "-1600.webp").
#   - cwebp -q 80 -m 6, sin metadatos (nada de EXIF/GPS).
#   - Si una variante de la franja "960" pasa de ~180 KB, se reintenta con
#     menos calidad (72, luego 62) antes de aceptarla — así se generaron los
#     .webp de este lote cuando el original era muy detallado.
#
# Ejemplo (una foto ya recortada para quitar el QR de la mesa):
#   scripts/recursos-imagen.sh img/referencias/_originales/wrap-nachos-guacamole-mesa.jpeg \
#     en-la-mesa wrap-nachos-guacamole-mesa "680x1600+0+0"
#
# Ejemplo (fachada, sin recorte, forzando solo un ancho):
#   scripts/recursos-imagen.sh img/referencias/_originales/fachada-noche-letrero-dorado.jpeg \
#     fachada fachada-noche-letrero-dorado "" "480 780"

set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Uso: $0 <original> <categoria> <slug> [crop WxH+X+Y] [\"anchos separados por espacio\"]" >&2
  exit 1
fi

ORIGINAL="$1"
CATEGORIA="$2"
SLUG="$3"
CROP="${4:-}"
ANCHOS="${5:-480 960 1600}"
LIMITE_KB_960=180

if [ ! -f "$ORIGINAL" ]; then
  echo "No existe el original: $ORIGINAL" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="$REPO_ROOT/img/referencias/$CATEGORIA"
mkdir -p "$DEST_DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BASE="$TMP/base.png"
if [ -n "$CROP" ]; then
  magick "$ORIGINAL" -auto-orient -crop "$CROP" +repage -colorspace sRGB "$BASE"
else
  magick "$ORIGINAL" -auto-orient -colorspace sRGB "$BASE"
fi

NATIVE_W="$(magick identify -format "%w" "$BASE")"

encode_webp() {
  # encode_webp <png-de-entrada> <salida.webp>
  local png="$1" out="$2" q=80 bytes
  magick "$png" -strip "$TMP/enc.png"
  cwebp -quiet -q "$q" -m 6 -metadata none "$TMP/enc.png" -o "$out"
  bytes="$(wc -c < "$out" | tr -d ' ')"
  local ancho
  ancho="$(magick identify -format "%w" "$out")"
  if [ "$ancho" -ge 800 ] && [ "$bytes" -gt $((LIMITE_KB_960 * 1024)) ]; then
    for q in 72 62; do
      cwebp -quiet -q "$q" -m 6 -metadata none "$TMP/enc.png" -o "$out"
      bytes="$(wc -c < "$out" | tr -d ' ')"
      [ "$bytes" -le $((LIMITE_KB_960 * 1024)) ] && break
    done
  fi
  echo "$out  ${bytes} bytes (q${q}, ${ancho}px)"
}

for W in $ANCHOS; do
  if [ "$W" -ge "$NATIVE_W" ]; then
    W="$NATIVE_W"
  fi
  OUT="$DEST_DIR/${SLUG}-${W}.webp"
  if [ -f "$OUT" ]; then
    echo "$OUT  (ya existe, se salta)"
  else
    PNG="$TMP/${W}.png"
    magick "$BASE" -filter Lanczos -resize "${W}x" "$PNG"
    encode_webp "$PNG" "$OUT"
  fi
  if [ "$W" -eq "$NATIVE_W" ]; then
    break
  fi
done
