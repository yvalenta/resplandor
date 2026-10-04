---
estado: en-curso
dueño: sesión
fecha: 2026-10-04
tema: pulido de bordes sobre `f32577d` (cuenta en escritorio + imprimir siempre a la caja): el total con su botón siempre dentro de la ventana, los avisos de la caja que no tapan los botones de un diálogo, «Recargar» que espera el papel en vuelo, el ticket tardío de un cobro que no se cancela, y los pequeños de puntaje-ora
criterio_cierre: visto de Yonatan en el POS en uso: la cuenta dividida con detalles abiertos y el enlace NFC en su ventana (el botón de cobro a la vista sin bajar la página), y un ticket de un cobro con la red lenta (sale en la caja o el aviso ofrece «Imprimir desde este teléfono»)
---

Los bordes que dejaron las refutaciones de la integración `impresion-defecto` + `escritorio-scroll` (publicada en `f32577d`) y de la rama descartada `integracion-impresion-promo`. No rediseña y no toca la promoción del día (otra rama): cada cambio va en un bloque con marcador `PARTE pulido-bordes` para que el integrador final los junte.

- **A (escritorio ≥ 1024):** la columna del pedido se extiende hacia arriba (`--orden-arriba`) para que el total —con «Generar ticket y cobrar»— se pegue al borde de abajo de la VENTANA aunque la rejilla arranque bajo el pliegue; en «Cobrar por partes» el total no va pegado (no lleva botón); la zona segura del iPad pasa a relleno de la tarjeta; `scroll-padding-bottom` para el foco del teclado; el piso ya no cuenta el hueco entre tarjetas y la vista pierde su aire de abajo.
- **B (impresión):** con un diálogo abierto el aviso de la caja es una línea («y N más») arriba y sin toques; un papel en vuelo cuenta como «sin guardar» para «Recargar» y un ticket sin resolver como «algo empezado»; el ticket de un cobro que falla tras «Volver» deja su aviso con la orden confirmada («dudoso» o «error»), no cancela lo que llegó y ofrece «Imprimir desde este teléfono»; «dudoso» cuenta como «en cola».
- **C:** el detector de pedidos de puntaje-ora ve «toma/toman domicilios» y lo falso dicho junto a un evento; la guarda de precios ve «vale 14000» y «desde 9 000».

Evidencia (pruebas, mediciones, capturas, qué falla con `f32577d`): `NOTAS.md` en la carpeta de coordinación de la tarea (`~/Developer/worktrees/resplandor--coordinacion/pulido-bordes/`) y `docs/pos-visual.md` §0.26.

## Bitácora
- 2026-10-04: A1–A5, B1–B4 y C hechos sobre `origin/main` f32577d (rama `tarea/pulido-bordes`); pruebas nuevas en `pos-orden-escritorio`, `pulido-bordes-impresion`, `pulido-bordes-aviso-navegador`, `pulido-bordes-punta-a-punta` (base real en Docker), `reglas` y `puntaje-ora`. Sin push.
- 2026-10-04 (cierre): la suite completa cazó una regresión de A4 —`scroll-padding-bottom` hacía parecer tapado al botón de cobro, que vive en la tarjeta pegada, y el foco o un clic lo bajaban todo al fondo— y se corrigió con `scroll-margin-bottom` negativo en la tarjeta (prueba nueva en A4, falla sin la regla). Suite completa en UTC y los cuatro `--comprobar` en verde; lo que falló por la carga de la máquina (load ≈ 160 con otra suite corriendo) pasa corrido solo. Sin push.
