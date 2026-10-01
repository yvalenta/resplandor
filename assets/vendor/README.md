# assets/vendor — los scripts de terceros del POS, locales y de versión fija

`pos.html` (uso diario del restaurante) carga estos cuatro archivos desde aquí, no desde un CDN. Antes salían de
`cdn.tailwindcss.com`, `cdn.jsdelivr.net` y `unpkg.com` con versiones que flotaban solas (`alpinejs@3.x.x`,
`lucide@latest`, `supabase-js@2`): si la red o el teléfono del mesero no alcanzaba uno de esos hosts, el POS
quedaba sin estilos y sin funciones, y un CDN podía cambiar lo que corría en el local sin que nadie tocara el repo.

Los archivos son los bytes originales, sin editar (el nombre lleva la versión: una versión nueva es un archivo
nuevo, así la caché del navegador y la de GitHub Pages nunca sirven uno viejo bajo el mismo nombre).

| Archivo | Qué es | Origen | Versión | Bytes | sha256 |
|---|---|---|---|---:|---|
| `tailwindcss-play-3.4.17.js` | Tailwind Play CDN (compila las clases en el navegador; lee `tailwind.config` de `pos.html`) | https://cdn.tailwindcss.com/3.4.17 | 3.4.17 | 407279 | `176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15` |
| `alpinejs-3.17.4.min.js` | Alpine.js (`dist/cdn.min.js`) | https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js (paquete npm `alpinejs`) | 3.17.4 | 55891 | `232519394c6c8fdba6f362b1d9da16106db513cdbf899011f00daab4051df31c` |
| `lucide-1.49.0.min.js` | Lucide, todos los íconos (`dist/umd/lucide.min.js`) | https://unpkg.com/lucide@1.49.0/dist/umd/lucide.min.js (paquete npm `lucide`) | 1.49.0 | 444682 | `c41d349872e3679a08b31658bebd99f127ccfd6263460efaee75cdd8144c0076` |
| `supabase-js-2.117.2.umd.js` | supabase-js (`dist/umd/supabase.js`) | https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js (paquete npm `@supabase/supabase-js`) | 2.117.2 | 217945 | `59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd` |

## Cómo se verificó (2026-10-01)

- **Mismo código que corría en producción.** Las URLs flotantes que usaba `pos.html` se resolvieron ese día a estas
  versiones, y lo que sirven es idéntico byte a byte a lo de arriba: `cdn.tailwindcss.com` → 3.4.17,
  `alpinejs@3.x.x` → 3.17.4, `lucide@latest` → 1.49.0 (unpkg redirige a `lucide@1.49.0`), `supabase-js@2` → 2.117.2.
- **Alpine, Lucide y supabase-js contra npm.** Se bajó cada tarball del registro de npm, se comprobó su `dist.integrity`
  (sha512) y el archivo extraído tiene el mismo sha256 que el de arriba. jsDelivr (`data.jsdelivr.com`, `structure=flat`)
  publica el mismo hash para esos tres archivos.
- **supabase-js: se guarda el archivo del paquete, no el `.min.js` de jsDelivr.** El paquete npm no trae `supabase.min.js`:
  jsDelivr lo genera y le antepone un comentario de 292 bytes («Skipped minification…», «Do NOT use SRI with dynamically
  generated files»). Quitado ese comentario, el resto es exactamente `dist/umd/supabase.js` (217945 bytes, ya minificado).
  Aquí queda el original, que sí se puede verificar contra npm y contra jsDelivr (y que `carta.html` ya fija con SRI).
- **Tailwind Play CDN: sin publicación verificable.** No es un paquete de npm ni lo hospeda jsDelivr, así que no hay un
  `integrity` publicado con el que comparar: solo el propio `cdn.tailwindcss.com/3.4.17`. El mismo hash salió en cinco
  descargas (la URL sin versión, la URL con versión, dos con un parámetro para saltar la caché y una por HTTP/1.1 sin compresión). Es la versión 3.4.17
  del Play CDN (el v3; el `@tailwindcss/browser` de npm es Tailwind 4 y no entiende este `tailwind.config`).
- `lucide-1.49.0.min.js` termina con `//# sourceMappingURL=lucide.min.js.map`: solo lo busca el inspector del navegador
  (DevTools abierto, un 404 mudo). No se editó para no cambiar el hash.

## Cómo comprobar que nada cambió

```sh
cd assets/vendor && shasum -a 256 *.js      # debe coincidir con la tabla (y lo vigila scripts/pruebas/pos-sin-cdn.test.mjs)
```

## Cómo actualizar una dependencia

1. Bajá el archivo nuevo de su origen, comprobá el `integrity` en npm y ponelo aquí con la versión nueva en el nombre.
2. Cambiá la ruta en `pos.html` y actualizá la fila de arriba (versión, bytes, sha256); la prueba compara las tres cosas.
3. Borrá el archivo viejo y probá el POS (`node scripts/capturas-pos.mjs <salida>`: termina con código 1 si algo falla).

No hay build ni `npm install` de por medio: los archivos se commitean tal cual.
