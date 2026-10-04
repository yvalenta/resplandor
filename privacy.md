---
title: "Privacidad — Resplandor Restaurante"
description: "Qué datos toca Resplandor Restaurante en sus páginas públicas y qué no."
canonical: https://resplandor.ynt.codes/privacy.html
last-updated: 2026-10-03
---

# Privacidad — Resplandor Restaurante

Esta página cubre las superficies públicas del sitio: [la página principal](https://resplandor.ynt.codes/) y [carta.html](https://resplandor.ynt.codes/carta.html). El punto de venta del restaurante (uso interno, con login de Google) es un sistema aparte y no es público; lo que guarda de su personal se explica al final.

## Qué NO hace este sitio

- No tiene cuentas de usuario ni formularios de registro.
- No crea cookies propias ni usa scripts de analítica o publicidad de terceros.
- Ningún agente ni el propio sitio reserva, cotiza, envía ni cobra nada por ti — ver [auth.md](https://resplandor.ynt.codes/auth.md).
- Ninguna página pública muestra números de cuenta, llaves ni códigos QR para pagar, salvo la carta de una mesa con la cuenta abierta (a quien abre el enlace de la pegatina de esa mesa): ahí, si el restaurante lo tiene activado, ves la llave y el código QR de Bre-B del propio restaurante para pagar desde la app de tu banco. Si una pantalla de este sitio te pide pagar o transferir a otro lado, no es de Resplandor Restaurante.

## Qué sí guarda tu navegador

- Con el enlace de una mesa (la pegatina NFC o su código QR de respaldo), `carta.html` guarda en `sessionStorage` —solo de esa pestaña, y se borra al cerrarla— el identificador de la cuenta que estás viendo, para no pasarte a la cuenta del siguiente cliente de la mesa.
- El mensaje que armas para reservar o cotizar (nombre, nota, fecha) vive en memoria mientras completas el formulario; no se guarda en ningún servidor de este sitio. Se envía SOLO si tú abres el enlace de WhatsApp y lo mandas desde tu propia cuenta — el sitio y cualquier agente que lo use nunca lo envían por ti.

## La cuenta de tu mesa («Mi cuenta»)

La pegatina de cada mesa abre `carta.html` con el número de la mesa y un código secreto en el enlace. Con ellos, la página le pide a una función del restaurante (en Supabase) la cuenta abierta de esa mesa: los productos, sus precios y cantidades, el total y la hora de apertura, y se mantiene al día sola mientras la miras. Esa cuenta no lleva nombres, teléfonos ni documentos de nadie. Si el mesero registra un abono, aparece como una línea que descuenta del total.

- Quien tenga el enlace de la mesa (por ejemplo, quien lo guardó o fotografió su código QR) puede ver la cuenta de esa mesa mientras esté abierta, y por eso el enlace no se comparte. El restaurante puede cambiar el código de una mesa cuando haga falta.
- La página le pide al navegador no decir desde dónde llegaste (`no-referrer`), así que el código no sale hacia otros sitios. Para enterarse de los cambios abre una conexión en tiempo real con Supabase por un canal cuyo nombre se calcula a partir del código sin permitir recuperarlo; por ese canal solo viaja la señal «algo cambió», sin datos de la cuenta.
- Los registros de las funciones de Supabase pueden incluir el código del enlace y tu dirección IP, y solo los ve el restaurante.

Si tocas «Pagar» y eliges QR, transferencia o efectivo, eso solo AVISA al personal del restaurante: se guarda la mesa, la cuenta, el método que elegiste y la hora del aviso, y quien lo atiende queda anotado con su correo. Un aviso que ya se atendió o se descartó se borra cuando pasa más de un día, la siguiente vez que alguien crea o atiende un aviso o se cierra el día. Ni la página ni el aviso cobran o cierran la cuenta, y la página no recibe ni guarda datos de pago tuyos. Si el restaurante lo tiene activado, al elegir QR o transferencia la página te muestra la llave y el código QR de Bre-B del restaurante (los de él, no los tuyos) y un botón «Enviar comprobante por WhatsApp», que abre tu propio WhatsApp con la mesa y el total en el mensaje: lo que envíes después lo decides tú.

## Qué piden las páginas a otros servicios

Para mostrarse, tu navegador pide las tipografías a Google Fonts (`fonts.googleapis.com` y `fonts.gstatic.com`, en todas las páginas) y las librerías de la página principal, la carta y el menú a jsDelivr (`cdn.jsdelivr.net`: Alpine.js y supabase-js, esta última solo cuando abres la cuenta de una mesa). Esos servicios, y Supabase (de donde se leen la carta en vivo, más abajo), ven tu dirección IP, como en cualquier pedido web. Este sitio no crea cookies propias.

## Datos en vivo que se leen (lectura pública, sin auth)

La carta se lee de Supabase con una llave *publishable* (de solo lectura, protegida por reglas de base de datos — RLS — a una vista pública: `carta_publica`). No es un secreto: aparece igual en el HTML de `carta.html`. Ningún dato de identidad tuyo pasa por ahí. La cuenta de una mesa no sale de esa vista: la sirve una función del restaurante que exige el código de la mesa.

## El personal del restaurante (punto de venta)

El punto de venta no es público: entra solo el personal, con una cuenta de Google que además un administrador del restaurante aprobó. De cada persona se guarda su correo de Google, el nombre que se le puso, su rol (mesero o admin) y si sigue activa. Esa lista solo la ve un administrador (cada quien ve su propia fila); una baja deja a la persona inactiva y sin acceso desde su siguiente consulta. El nombre de quien tiene abierta una mesa se comparte con los otros dispositivos del local. Los correos reales del personal nunca se publican en el repositorio de este sitio.

Si alguien entra al punto de venta con una cuenta de Google que todavía no está en la lista, queda como *solicitud pendiente* y no puede hacer nada más que mirar: ve el mapa de mesas (número, capacidad y si está libre u ocupada) y la carta pública, sin cuentas, totales ni ventas. Para esa solicitud se guarda el correo de su cuenta de Google, el nombre de su perfil de Google y la hora en que la hizo, aunque nunca se apruebe. Un administrador la aprueba o la elimina; eliminarla deja a la persona inactiva y sin acceso, y conserva ese registro para que no pueda reabrirla por su cuenta. Quien quiera que se borre su correo y su nombre de esa lista puede pedirlo al restaurante ([contacto](https://resplandor.ynt.codes/contact.html)).

Cuando una persona del personal deshace un cobro en el punto de venta (devolverlo a la cuenta de la mesa o reabrir la mesa), queda anotado quién lo hizo (su correo de Google), cuándo, de qué mesa y por cuánto. Ese registro lo ve solo un administrador y se borra pasados 90 días, la siguiente vez que se cierra el día.

## Repositorio

Este sitio es de código abierto: [github.com/yvalenta/resplandor](https://github.com/yvalenta/resplandor).
