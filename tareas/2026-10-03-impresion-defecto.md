---
estado: en-curso
dueño: yonatan
fecha: 2026-10-03
tema: Imprimir va siempre a la caja con una confirmación (el teléfono solo como emergencia) y «Precuenta» por persona en «Dividir cuenta por persona», con la fila reorganizada para el celular
criterio_cierre: visto de Yonatan en el POS en uso (con la caja encendida): tocar «Imprimir precuenta» y «Precuenta» de una persona, confirmar, y que salga el papel en la caja (el de la persona, solo con lo suyo); con la caja apagada, que el POS avise y deje imprimir desde el teléfono
---

Pedido de Yonatan (2026-10-03): «cuando se dé imprimir, por defecto será caja; no se abrirán opciones de este teléfono o en caja: siempre irá a caja, con confirmación para imprimir» y «en la parte de dividir cuenta se podrá imprimir precuenta a cada persona; reorganizarlo visualmente, recuerda prioridad celular». Rama `tarea/impresion-defecto` sobre `origin/main` `ed050dd`.

Qué hace (detalle y decisiones en `README.md` §07 «Imprimir en la caja» y `docs/pos-visual.md` §0.24): un solo botón por papel («Imprimir precuenta», el «Precuenta» de cada persona, el «Imprimir» del ticket) que abre UNA confirmación («¿Imprimir la precuenta en la caja?», con «Imprimir en la caja» y «Cancelar»); nada sale hasta confirmar y con la caja en línea no se abre la impresión del teléfono. El teléfono imprime solo como emergencia (caja registrada sin latir: «La caja no está en línea (última señal hace N min). Se imprime desde este teléfono.» con «Imprimir aquí»; el envío que falla tras confirmar; «Imprimir aquí» del aviso «La caja no responde»). Sin la migración de la cola, el POS imprime desde el teléfono sin confirmación extra, como hoy. La precuenta de una persona lleva solo sus líneas y su total, «PRECUENTA — no es un cobro» y «Cuenta de Camila · Mesa 3». La fila de cada persona son dos líneas en teléfono (nombre y total; «Precuenta» y «Cobrar» mitad y mitad, 44 px) y una desde 768 px.

Nada que aplicar ni desplegar: sin migración, sin tocar el agente. Pendiente de Yonatan: ver si le molestan los «Cobrar» en coral en cada fila (alternativa documentada en `docs/pos-visual.md` §0.24) y si quiere unificar el encabezado de la precuenta entera con «PRECUENTA — no es un cobro».

## Bitácora
- 2026-10-03: implementado en `pos.html` (store `pedirImpresion` / `aceptarImpresion` / `cancelarImpresion`, modal `confirmaImpresion`, `_armarPreCuentaPersona`, alcance por papel, fila de dos líneas). Pruebas nuevas `pos-impresion-defecto.test.mjs` y `pos-impresion-defecto-navegador.test.mjs`; actualizadas las de `pos-impresion-caja-navegador`, `integracion-personas-impresion`, `integracion-correcciones`, `pos-personas-botones`, `integracion-punta-a-punta` e `impresion-punta-a-punta` (estas dos, con Docker: la precuenta de Andrés llega al agente real en `--simular` con solo su línea y su total). Sin push ni despliegue.
