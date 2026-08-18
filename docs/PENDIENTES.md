# Notas pendientes — Performance y mejoras a futuro

## POS (`index.html`)

- [ ] **Compilar Tailwind** en vez del Play CDN (~300 KB de JS ejecutándose en
      cada carga). Un build one-shot con la CLI de Tailwind deja un CSS de
      ~15 KB. Es el mayor salto de velocidad disponible.
- [ ] **Pinear versiones** de `lucide` y `supabase-js` (`@latest` impide caché
      largo del navegador y puede romper sin aviso en un deploy ajeno).
- [ ] **PWA**: manifest + service worker para instalar el POS como app en la
      tablet/celular del mesero — arranque instantáneo y tolerancia a cortes
      de red (la cola de pendientes ya existe; el service worker completa la
      historia offline).
- [ ] **Migrar a Tailwind v4** como la landing (requiere quitar el reset
      universal `* { margin:0; padding:0 }` porque en v4 las utilidades viven
      en `@layer` y un reset sin capa las pisa).

## Landing (`landing.html`)

- [ ] **Compilar Tailwind v4** (mismo caso que el POS: hoy usa
      `@tailwindcss/browser@4` que compila en el navegador).
- [ ] **Reseñas reales de Google** en vez de testimonios estáticos — la cifra
      "1.240 reseñas" debe ser verificable o ajustarse a la real.
- [ ] **Banner promocional intercambiable** por temporada (JSON con la promo
      activa: Día de la Madre, Amor y Amistad, Navidad…).
- [ ] **Precio estimado en vivo en el cotizador** (personas × plan ≈ total)
      antes de enviar el WhatsApp.
- [ ] **Formato AVIF/WebP** para `combo-papa.jpg` y `retrato-ancestral.jpg`
      (reduciría otro ~40–60% del peso de imágenes).

## Ideas de producto (de la sesión de rediseño)

- [ ] Conectar la carta QR con el POS: pedido desde la mesa → comanda al POS.
- [ ] Club Resplandor (fidelidad): sellos digitales por visita vía WhatsApp.
- [ ] Suscripción real de almuerzos con pago recurrente Nequi/Bancolombia.
- [ ] Galería/video del ahumado de 8 horas ("el barril en vivo").
