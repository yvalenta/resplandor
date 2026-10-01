---
estado: en-curso
dueño: ambos
fecha: 2026-10-01
tema: pos.html deja de depender de CDNs de terceros para sus scripts (Tailwind, Alpine, Lucide y supabase-js pasan a archivos locales de versión fija en assets/vendor/)
criterio_cierre: visto de Yonatan: con el cambio al aire, el POS abre con estilos y funciones en su teléfono y en su red (la que fallaba); la suite y los tres --comprobar en verde (ya medido en la rama)
---

Reporte de Yonatan del 2026-10-01: en su teléfono «el CSS y todo está fallando en todo el POS; muchas funcionalidades no funcionan y la parte visual está totalmente dañada». El código publicado (`origin/main` `968bd77`) se ve y funciona bien en Chromium y en Safari de iOS (simulador) con los CDN actuales, así que la hipótesis es que en su red o su teléfono falla en ejecución la carga de algún script de terceros: sin Tailwind no hay estilos, sin Alpine no hay funciones, y además las versiones flotaban solas (`alpinejs@3.x.x`, `lucide@latest`, `supabase-js@2`).

- **Qué cambia:** `pos.html` carga `assets/vendor/tailwindcss-play-3.4.17.js`, `alpinejs-3.17.4.min.js`, `lucide-1.49.0.min.js` y `supabase-js-2.117.2.umd.js`, con la misma estructura de antes (Tailwind síncrono antes del `tailwind.config`, Alpine y Lucide con `defer`, supabase-js síncrono). Son los mismos bytes que servían las URLs flotantes ese día; origen, versión y sha256 en `assets/vendor/README.md`. Se quitó el `preconnect` a jsdelivr (ya no le pide nada).
- **Lo que NO cambia:** las fuentes de Google siguen siendo externas. Ojo con el riesgo medido abajo.
- **Vigilancia:** `scripts/pruebas/pos-sin-cdn.test.mjs` falla si `pos.html` vuelve a pedir un script (o cualquier recurso) a un host que no sea la tipografía de Google, si un archivo de `assets/vendor/` cambia de bytes sin actualizar el README, y corre el POS en Chromium con la red externa cortada (abrir mesa, agregar, cobrar).
- **Arnés:** `_pos-simulado.mjs` ya no cachea ningún CDN de scripts (solo las fuentes) y reconoce `--sin-fuentes` en `capturas-pos.mjs`.

## Riesgo abierto (no se tocó, pedido: «dejar las fuentes como están»)

Medido en Chromium móvil (390 px): si `fonts.googleapis.com` FALLA rápido, el POS arranca en 0,1 s con la tipografía de respaldo. Pero si ese host se CUELGA (no responde: paquetes descartados por un filtro o un wifi malo), el `<link rel="stylesheet">` de las fuentes bloquea el primer pintado y, además, el navegador no ejecuta los `<script>` que vienen después: a los 12 s ni Tailwind ni Alpine habían corrido. Es el mismo síntoma que reportó Yonatan y este cambio no lo cubre. Salidas posibles, cada una con su tarea: cargar la hoja de fuentes sin bloquear (`media="print" onload="this.media='all'"` con `<noscript>` de respaldo) o alojar las fuentes en el repo.

## Bitácora
- 2026-10-01: hecho en `tarea/pos-sin-cdn`, desde `origin/main` `968bd77`, sin push ni despliegue.
  - Los cuatro archivos coinciden byte a byte con lo que resolvían las URLs flotantes; Alpine, Lucide y supabase-js, además, con el `dist.integrity` del tarball de npm y con el hash que publica jsDelivr. Tailwind Play no tiene publicación verificable (no está en npm ni en jsDelivr): mismo hash en cinco descargas.
  - Suite 743 de 744 (el que falta se salta solo: `VERIFICAR_SRI=1` pide red) y los tres `--comprobar` en 0, con Node 22.18.
  - Capturas a 390 y 1440 (50 vistas): idénticas píxel a píxel a las de `origin/main` con los CDN reales en 45. De las otras 5, dos son `orden-avisos` (muestra el puerto del servidor en el enlace NFC: corridas en puertos distintos; en el mismo puerto son idénticas) y tres son modales (32 a 1.400 px de 1,3 millones, en los bordes de la capa sobre el panel fijo: el mismo ruido que ya hay entre dos corridas iguales).
- 2026-10-01: Yonatan mandó la captura de la tarde (iPhone, Brave): Alpine y el CSS propio corrían, pero ninguna clase de Tailwind (mesas en una sola columna angosta, la leyenda sin estilo, el fondo sin su clase): es la falla de `cdn.tailwindcss.com` que esta rama quita. GO de Yonatan para publicar y para retirar `index2.html` (una copia vieja del POS, publicada y apuntando a la misma base, con los mismos CDN flotantes).
