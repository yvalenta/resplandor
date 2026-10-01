---
estado: en-curso
dueño: sesión
fecha: 2026-09-30
tema: carta.html en escritorio (riel de categorías, la carta en dos columnas y la cuenta como panel lateral en vivo) y el botón «Pagar» (QR, transferencia, efectivo) que avisa al mesero, detrás de la bandera pagarEnMesa
criterio_cierre: medido en Chromium a 390, 1024, 1280 y 1440 px con la red simulada (flujo de Pagar completo, interruptor apagado sin botón ni llamadas, sin desborde ni errores de consola), la suite y los tres --comprobar en verde; al aire con el GO de Yonatan, y pagarEnMesa en true solo cuando la función `alerta` esté desplegada
---

Pedido de Yonatan del 2026-09-30: «añade botón pagar con QR, transferencia, efectivo para alertar al mesero que pidieron la
cuenta», «quita todo lo relacionado a que den propina, eso no se hace acá» (ya quitado en `83a2f70`) y «mejora también la
versión escritorio». Esta es la parte de `carta.html` de la ola de permisos y alertas; la Edge Function `alerta`, la tabla
`alertas` y la pantalla de alertas del POS son de otros frentes.

- **Pagar no cobra ni muestra datos de pago** (cero riesgo de phishing por la pegatina). El cliente toca un método
  (`qr` | `transferencia` | `efectivo`) y eso hace `POST SUPABASE_URL/functions/v1/alerta` con `{m, k, metodo}` y las mismas
  cabeceras de `cuenta` (más `Content-Type: application/json`). El mesero lleva el QR impreso o da los datos de la cuenta, y
  cobra y cierra en el POS. Sin propina en ningún lado.
- **Interruptor:** `RESPLANDOR.funciones.pagarEnMesa` (`assets/js/local.js`), hoy `false`. Apagado, el botón y las opciones ni
  existen en el DOM y `avisarPago` no hace ninguna llamada. No se anuncia a los agentes ni cambia lo generado.
- **Escritorio (≥ 1024 px):** riel de categorías fijo a la izquierda (con íconos), la carta al centro y, con mesa, «Mi cuenta»
  como panel fijo a la derecha, siempre abierto y en vivo; sin barra de abajo (sin mesa, su acción —reservar— pasa al riel). Los
  platos van en dos columnas cuando la columna central mide ≥ 46 rem (consulta de contenedor): a 1440 con panel y a 1280–1440 sin
  él; a 1280 con panel, una. La cabecera pasa a una sola fila (88 px) para que el panel y su botón se vean sin bajar.
  Por debajo de 1024 px nada cambia: tabs pegajosas, barra de abajo y hoja inferior.
- Es UNA sola «Mi cuenta» (hoja en celular, panel en escritorio): al cruzar los 1024 px la hoja se cierra y queda el panel.
- El scroll-spy ahora recuerda las secciones que tocan su banda y marca la de más arriba; y la última sección se alarga en
  ventanas altas para que tocar «Bebidas» la deje marcada.

## Abierto
- **`m` va como número en el cuerpo** (`{"m":7,…}`); si `alerta` espera string, es una línea en `avisarPago` (carta.html).
- **El preflight de CORS:** el POST lleva `Content-Type: application/json` y `apikey`/`Authorization`, así que `alerta` tiene que
  contestar el OPTIONS con `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type` y
  `Access-Control-Allow-Methods: POST, OPTIONS` para `https://resplandor.ynt.codes`.
- Recargar la página olvida el «ya avisamos» (la función `cuenta` no dice si hay alerta pendiente): un segundo aviso solo
  actualiza la misma alerta. Para recordarlo, `cuenta` tendría que devolver `alerta: {metodo}`.

## Bitácora
- 2026-09-30: hecho en `tarea/carta-escritorio-pagar`, desde `83a2f70`. Capturas a 390/1024/1280/1440 en el scratchpad de la
  sesión `f7613393` (`ola-a/carta/`); sin desborde ni errores de consola en ningún ancho. Suite 538 de 538 (37 nuevas en
  `pagar.test.mjs`); css, iconos y descubrimiento `--comprobar` en 0.
- 2026-09-30 (ronda 1, tras la crítica visual de `b9cddea`): sin críticos; corregidos los 3 altos y 5 medios/bajos baratos.
  El aviso de error de Pagar pasa arriba de las opciones (`role="alert"`, `x-if`) y se trae a la vista; «Listo» no aparece en
  «¿Cómo quieres pagar?»; «Cambiar método» es un `btn-ghost` y, a ventana baja (≤ 820 px, y un poco más a ≤ 680), filas y total más compactos con una
  sombra hundida (sin degradado) que avisa que la lista sigue; el panel termina dentro de la ventana (`100dvh - 10rem`); celular
  apaisado con la hoja entera desplazable; `:hover` solo con puntero; el foco sigue al flujo; «p. m.» con espacios duros;
  «Mesa N» no se repite en la cabecera de escritorio. Sin hacer (decisión de gusto o fuera de alcance): 2 columnas de platos a
  1280 con panel, el badge «De la casa» que baja de línea, la cabecera compacta también en móvil, y los ítems que ceden el sitio
  a las opciones. Quedan 14 pruebas nuevas en `pagar.test.mjs`.
