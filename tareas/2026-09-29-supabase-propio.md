---
estado: propuesta
dueño: ambos
fecha: 2026-09-29
tema: sacar a Resplandor del 402 moviendo su Supabase a un proyecto en plan gratis con cupo propio (cuenta del restaurante, o un hueco en «ynt's Org»)
criterio_cierre: carta, POS (login de Google en /pos.html) y votación funcionan al aire contra el proyecto nuevo en plan Free, sin 402, y las banderas de funciones-apagadas vuelven a true; visto de Yonatan
---

Pedido de Yonatan del 2026-09-29 en la sesión `a8584c3a`, que ya había pasado los 200k (por eso no se empezó):
«crees que podriamos pasar resplandor a supabase asociado a su correo, mira si tenemos budged disponible para que
quede en free … donde te dejo el api_key?o el secret_key?». Y después: «el proyecto 911urban no es tan importante lo
podriamos migrar a otro lado o tener otra alternativa».

## Lo que se sabe y lo que falta medir
- Hoy el proyecto de Resplandor responde 402 `exceed_egress_quota` (ver `2026-09-29-funciones-apagadas.md` y la
  bitácora de landing).
- En la captura del dashboard de Yonatan, «ynt's Org» está en plan FREE con 2 proyectos: 911urbansalon y nomicheck.
  Hay que verificar en la documentación de Supabase dos cosas. Primero, el tope de proyectos activos gratis (se
  recuerda que son 2). Segundo, si la cuota de egress del plan gratis es por proyecto o por organización. Si es por
  organización, meter Resplandor en «ynt's Org», aunque se libere el hueco de 911urban, lo pone a compartir cuota con
  nomicheck.
- Tampoco se sabe en qué organización vive hoy el proyecto de Resplandor ni qué consumió su egress. Medirlo con el
  MCP de Supabase ANTES de elegir (solo lectura: organizaciones, proyectos y uso), o el proyecto nuevo se llena igual.
- Opciones:
  - A: una cuenta nueva con el correo del local (`resplandorcomidamixta@gmail.com`), con su propia organización Free.
  - B: sacar 911urban de «ynt's Org» (pausarlo o mudarlo) para liberar el hueco. Si se elige B, lo de 911urban es
    una tarea propia en su repo (nodo `911urban`), no de esta.
- Llaves: el secret (`sb_secret_…`) NO se pega en ninguna sesión, porque la Línea Roja dice que la llave no entra al
  proceso. Las Edge Functions (`cuenta`, `votar`) reciben la llave de servicio del propio Supabase. La publishable
  (`sb_publishable_…`) es pública y va en el HTML: la lee la sesión con el MCP o la pega Yonatan. La de la captura es
  la de nomicheck, no la de Resplandor.
- Le toca a Yonatan o a Camila (lista 2 de la Línea Roja):
  - crear la cuenta y el proyecto;
  - configurar el proveedor Google OAuth (su client secret) y las Redirect URLs (`https://resplandor.ynt.codes/pos.html`);
  - iniciar sesión en la CLI para desplegar las funciones;
  - dar acceso a la cuenta de Yonatan si se quiere operar con el MCP.
- Le toca a la sesión:
  - el esquema a recrear (`resplandor_bd.sql`, `supabase/`);
  - cómo sacar los datos del proyecto restringido: productos, mesas (con sus tokens NFC, o hay que reescribir las
    pegatinas) y menús;
  - la lista de archivos que llevan la URL y la clave del proyecto, para cambiarlas en un solo commit.

## Bitácora
- 2026-09-29: declarada como propuesta por la sesión `a8584c3a` al cortar por la regla de 200k. Nada medido todavía.
- 2026-09-29: pendiente para cuando haya proyecto: en `productos` siguen «Frijoles con proteína» y «Sopa con proteína», las dos a 19.000. Yonatan las corrigió así: «Seco», 19.000 (arroz, proteína, guarnición y ensalada; sin sopa ni frijol), y «Sopa y carne», 14.000. Además, el Menú Resplandor pasa a «Menú del día, con sopa o frijol». Si no se corrigen, la carta en vivo las trae de vuelta. La instantánea `assets/js/carta-respaldo.js` ya está corregida (`449c8ec`). «Frijoles con proteína» está también en `pos.html` y en `resplandor_bd.sql`.
