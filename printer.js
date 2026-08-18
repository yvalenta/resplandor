/**
 * Controlador de Impresión Silenciosa vía QZ Tray + ESC/POS
 */
async function imprimirTicketDirecto(ticketOrden) {
  if (!ticketOrden) return;

  // 👇 PON AQUÍ EL NOMBRE EXACTO DE LA IMPRESORA COMO SALE EN WINDOWS 👇
  const nombreImpresora = "POS-80";

  try {
    // 1. Conectar con el programa QZ Tray en segundo plano
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }

    // 2. Buscar y configurar la impresora
    const printer = await qz.printers.find(nombreImpresora);
    const config = qz.configs.create(printer);

    // 3. Diseñar el ticket usando ESC/POS
    const encoder = new EscPosEncoder();
    const ANCHO_TICKET = 42;

    let formateador = encoder
      .initialize()
      .lineSpacing(35)
      .align('center')
      .size('double')
      .text('RESPLANDOR')
      .newline()
      .size('normal')
      .text('RESTAURANTE')
      .newline()
      .text('Medellín, Colombia')
      .newline()
      .newline()
      .align('left');

    const textoMesa = `Mesa: ${ticketOrden.mesaNumero ?? '—'}`;
    const textoFecha = new Date(ticketOrden.fechaCierre).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
    const espaciosCabecera = ANCHO_TICKET - textoMesa.length - textoFecha.length;
    const paddingCabecera = espaciosCabecera > 0 ? ' '.repeat(espaciosCabecera) : ' ';

    formateador = formateador
      .text(`${textoMesa}${paddingCabecera}${textoFecha}`)
      .newline()
      .text('-'.repeat(ANCHO_TICKET))
      .newline();

    ticketOrden.items.forEach(item => {
      const cantidadYDescripcion = `${item.cantidad}x ${item.descripcion}`;
      const totalItem = `$ ${Math.round(item.precio * item.cantidad).toLocaleString('es-CO')}`;
      const espaciosLibres = ANCHO_TICKET - cantidadYDescripcion.length - totalItem.length;
      const paddingItem = espaciosLibres > 0 ? ' '.repeat(espaciosLibres) : ' ';

      formateador = formateador.text(`${cantidadYDescripcion}${paddingItem}${totalItem}`).newline();
    });

    const textoTotalLabel = 'TOTAL:';
    const textoTotalValor = `$ ${Math.round(ticketOrden.total).toLocaleString('es-CO')}`;
    const espaciosTotal = ANCHO_TICKET - textoTotalLabel.length - textoTotalValor.length;
    const paddingTotal = espaciosTotal > 0 ? ' '.repeat(espaciosTotal) : ' ';

    formateador = formateador
      .text('-'.repeat(ANCHO_TICKET))
      .newline()
      .bold(true)
      .text(`${textoTotalLabel}${paddingTotal}${textoTotalValor}`)
      .bold(false)
      .newline()
      .newline()
      .align('center')
      .text('Gracias por su visita')
      .newline()
      .newline()
      .newline()
      .newline()
      .cut(); // Comando de corte

    // 4. Compilar el diseño y convertirlo a Base64 para envío seguro
    const comandosBinarios = formateador.encode();
    let binaryString = '';
    for (let i = 0; i < comandosBinarios.length; i++) {
      binaryString += String.fromCharCode(comandosBinarios[i]);
    }
    const dataBase64 = window.btoa(binaryString);

    // 5. Enviar la orden de impresión cruda (Raw)
    const data = [{
      type: 'raw',
      format: 'base64',
      data: dataBase64
    }];

    await qz.print(config, data);

  } catch (error) {
    console.error('Error de impresión:', error);
    alert('No se pudo imprimir. Verifica que QZ Tray esté abierto (icono verde en la barra de tareas) y que el nombre de la impresora sea el correcto.');
  }
}