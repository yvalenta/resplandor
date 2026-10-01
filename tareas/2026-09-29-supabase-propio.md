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
- 2026-09-30 (sesión `f7613393`): medido, solo lectura. Yonatan eligió como destino la otra cuenta de Supabase, la de la captura: org «ynt's Org», Free, con `911urbansalon` y `nomicheck`. El MCP de Supabase no ve esa cuenta. Solo ve la de origen: org `bekzzgqqzmyglwevvwyf`, con `resplandor` (`yjtcrhmdztbuylgpuvsm`) y `advance_fitness_app`.
  - **El origen sigue en 402**, pero la base responde por `execute_sql`. Pesa 13 MB. No hay órdenes abiertas ni mesas ocupadas. La última escritura es del 2026-08-31.
  - **Quién gastó el egress: `advance_fitness_app`, no Resplandor.** Es una estimación, no una medición.
    - Solid Queue y Solid Cable sondean cada 0,1 s por el pooler. Son unas 8,8 consultas por segundo, lo que da unos 3,8 a 5,9 GB al mes.
    - Resplandor usó menos de 0,1 GB en 92 días.
    - Se confirma en el dashboard de la org de origen, en Usage → «Shared Pooler Egress».
    - Arreglarlo es tarea del repo `advance_fitness` (`polling_interval`).
  - **Documentación de Supabase:**
    - El tope Free es de 2 proyectos activos por usuario, contando todas sus orgs.
    - Las cuotas se cuentan por organización. Por eso Resplandor va en una org Free aparte, y no junto a nomicheck.
    - La transferencia entre orgs queda descartada: una org restringida puede tener las transferencias desactivadas, y no está documentado si el 402 viaja con el proyecto.
  - **La migración `20260906120000` (carta NFC) nunca se aplicó al origen.** No existen `mesas.token`, `en_carta`, la vista `carta_publica` ni la función `cuenta`. Por eso no hay tokens que conservar: las pegatinas se escriben después del corte.
  - En el origen hay 7 productos que no están en `resplandor_bd.sql`. Por eso los datos se copian desde la base viva.
  - **Dos riesgos del proyecto nuevo:**
    - Los proyectos creados desde 2026-05 no dan GRANT automático sobre las tablas a `anon`, `authenticated` ni `service_role`. Sin GRANT explícito, el POS falla sin avisar.
    - El registro por correo viene activado de fábrica. Como las policies del POS son `authenticated using (true)`, hay que apagar el proveedor Email.
  - **WODride**, la app de iPhone abandonada, ocupaba 4 tablas, 3 funciones, el bucket `wodride-images` y la Edge Function `wodride-api` en este proyecto. Yonatan pidió depurarlo.
    - El respaldo está hecho y verificado con huellas en `~/Respaldos/wodride/2026-09-30/`, fuera del repo.
    - El `DROP` lo bloqueó el filtro de permisos del modo automático. Yonatan lo corrió en el SQL Editor.
    - Verificado por SELECT: quedan 0 tablas y 0 funciones `wodride*`, y los datos de Resplandor siguen intactos (31 productos, 10 mesas, 24 órdenes, 2 cierres y 126 menús).
    - Todavía quedan el bucket `wodride-images` (9 objetos) y la Edge Function `wodride-api`: se borran desde el dashboard.
  - Pausar 911urban le apaga a su página las reservas y la cola, y deja precios viejos en su respaldo embebido. Antes hay que regenerar ese respaldo y sacar un volcado completo. El CSV diario de `~/Respaldos/911urban` no trae ni el esquema ni `auth`.
  - **Copia de los datos de Resplandor, hecha antes de que el origen pueda pausarse por inactividad.** Está en `~/Respaldos/resplandor-SNAPSHOT-2026-09-30/`, fuera del repo:
    - `esquema-vivo.sql`: las tablas; en comentario, las funciones, los triggers, las policies y los grants.
    - `datos.sql`
    - `huellas-origen.txt`: una huella md5 por tabla.
    - La carga en un Postgres 17 desechable dio las mismas 8 huellas que el origen. Se probó dos veces por separado.
    - Estado del origen a las 19:41 UTC: 0 órdenes abiertas. Últimas escrituras: órdenes el 2026-08-31, productos el 2026-07-19 y cierres el 2026-07-09.
  - Plan detallado con pasos [SESIÓN]/[YONATAN]: en el transcript de la sesión `f7613393`. No se creó, pausó ni desplegó nada.
- 2026-09-30 (sesión `f7613393`, más tarde): **Yonatan eligió otra cuenta de Supabase, la de megaplex.med@gmail.com.** Queda descartado pausar 911urban.
  - Falta que Yonatan confirme que esa cuenta no es la misma que ve el MCP (la de origen, sin cupo) y que cree ahí una org Free «Resplandor» con el proyecto.
  - En la rama `tarea/supabase-propio` se escribió la migración base `supabase/migrations/20260905000000_resplandor_base.sql`:
    - Tiene la forma viva de las 8 tablas, las funciones con `search_path`, los triggers, RLS con 9 policies (se quita `sug_select_admin`, que era redundante), GRANT explícitos mínimos y la publicación Realtime.
    - Los scripts para aplicarla, en orden del 1 al 6, están en `~/Respaldos/resplandor-SNAPSHOT-2026-09-30/aplicar/`.
    - Ensayada en un Postgres 17 desechable con los roles simulados: las huellas de los datos dan ok, los 22 checks finales dan ok y las pruebas por rol (authenticated, anon y service_role) responden como se espera.
  - Dos refutadores revisaron la migración y los scripts: uno con la lente de los consumidores, otro con la de la plataforma Supabase.
    - **Hallazgo crítico, de los dos:** las policies `authenticated using(true)` dejan pasar a cualquier cuenta creada por correo.
    - **Corregido:**
      - se agregó la policy RESTRICTIVE `solo_google` en las 6 tablas con escritura;
      - se quitó DELETE sobre `cierres` y `mesas` a `authenticated`;
      - el LEEME ahora incluye apagar Email y Anonymous y cerrar el registro después del primer login.
    - Re-ensayo: 23 de 23 checks. La sesión de Google escribe. La sesión por correo ve 0 filas, su UPDATE no toca nada y su INSERT choca con `solo_google`. `anon` ve la carta (30) y los menús, y no ve `ordenes`.
    - **Pendiente de decisión de Yonatan:** `en_carta default true`. Hoy un plato creado desde el POS nace fuera de la carta, y el POS no tiene control para cambiarlo. También queda pendiente exportar el `localStorage` de cada tablet antes del corte, si se usó durante el 402.
- 2026-09-30: **Yonatan aprobó dos cosas:**
  - las correcciones de la carta (`aplicar/4-correcciones-carta.sql`);
  - que los platos nuevos nazcan en la carta. En `20260906120000_carta_publica_y_token_mesa.sql`, que no se había aplicado en ningún proyecto, se agregó `alter column en_carta set default true` después del backfill.
  - Re-ensayo: 24 de 24 checks. Un plato creado como `authenticated` con sesión de Google aparece en `carta_publica`, y el Juguito sigue fuera.
  - **Proyecto nuevo:** ref `lccgehvyymladqvumcez`, en la «Ynt's Org» de la cuenta de megaplex.
  - **Google OAuth:** la redirección ya apunta a `https://lccgehvyymladqvumcez.supabase.co/auth/v1/callback`.
- 2026-09-30: Yonatan prefirió no reconectar el conector de Supabase a la cuenta de megaplex, porque se usa para otros proyectos.
  - Los pasos 1 a 5 se juntaron en `aplicar/TODO-EN-UNO.sql`, un solo `begin … commit` que termina con 27 comprobaciones. Adentro hay un bloque que aborta toda la transacción si las huellas md5 de los datos no coinciden con las del origen.
  - Ensayado como un solo envío del SQL Editor:
    - camino bueno: 27 de 27;
    - con un total alterado a propósito: «Los datos no cuadran… No se aplicó nada» y 0 tablas.
  - Se le dejó copiado en el portapapeles para pegarlo en el SQL Editor.
- 2026-09-30: el primer intento de `TODO-EN-UNO.sql` en el proyecto nuevo **abortó solo**: 5 tablas con huellas distintas.
  - **Causa:** `pbcopy` sin locale UTF-8 volvió mojibake las tildes, y justo fallaron las tablas con texto acentuado. La verificación md5 hizo su trabajo.
  - Con la publishable se confirmó que el proyecto quedó vacío (`carta_publica` responde 404).
  - Se volvió a copiar con `LC_ALL=en_US.UTF-8`: el hash del portapapeles coincide con el del archivo. Se agregó un `rollback;` inicial.
  - Yonatan: «no nos importarán los cierres pasados, podemos empezar de cero». No hay rescate de `localStorage`. Las órdenes viejas no inflan el primer cierre, porque `ordenesHoy` filtra por fecha.
  - **Código en la rama:** URL y publishable nuevas (`lccgehvyymladqvumcez`, `sb_publishable_034Z…`) en `pos.html`, `carta.html`, `menu.html`, `index2.html` y `assets/js/local.js`; regenerado con `descubrimiento.mjs`, que actualizó `local.json` y `.well-known/*`.
    - `docs/landing-y-agentes.md` y `raiz.test.mjs` quedan al día.
    - Chequeos: `--comprobar` de descubrimiento, css e iconos en 0, y 501 de 501 pruebas.
    - Sin commit. Las banderas siguen en false hasta el corte.
- 2026-09-30: **publicado con el GO de Yonatan** («sí, publica primero lo de Supabase»), antes del rediseño visual del POS, que va en `tarea/pos-visual`.
  - Las banderas siguen en false.
  - Falta desplegar las Edge Functions `votar` y `cuenta` en el proyecto nuevo, y probar el login de Google en producción.
- 2026-09-30, después del push de `3bae016` (Actions: `comprobar` y Pages en success):
  - **El sitio público usa `lccgehvyymladqvumcez`.** La carta carga en vivo: sin la nota de respaldo, con el Seco y la Sopa y carne corregidos.
  - **Login de Google en producción: funciona** (Yonatan entró al POS). Antes hubo que poner la Site URL en `https://resplandor.ynt.codes/` y agregar `https://resplandor.ynt.codes/pos.html` a Redirect URLs. El valor de fábrica `http://localhost:3000` desviaba el login.
  - **Edge Functions desplegadas por Yonatan desde el dashboard, con Verify JWT apagado:**
    - `votar`: OPTIONS 200 con CORS `*`, GET 405 y POST `{}` 400 «device_id inválido».
    - `cuenta`: sin parámetros 400; con token inválido o mesa inexistente, 404 «enlace inválido». Eso prueba que la función lee `mesas` con su llave.
  - Auth: Google encendido, Email apagado y Anonymous apagado.
  - **Pendiente:**
    - cerrar «Allow new users to sign up» cuando haya entrado el personal;
    - cargar el menú de la semana y encender las banderas (`funciones-apagadas`);
    - escribir las 10 pegatinas desde «Enlace NFC»;
    - rotar la contraseña de la base vieja, que está en claro en un archivo local de otro repo;
    - el egress de advance_fitness, que quedó como tarea aparte en su repo.
