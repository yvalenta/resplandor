---
estado: en-curso
dueño: yonatan
fecha: 2026-09-29
tema: apagar por bandera el menú de hoy y el almuerzo programado mientras Supabase responde 402, y que la carta se vea (con su fecha) cuando la carta en vivo no carga
criterio_cierre: visto de Yonatan — revisar la rama tarea/funciones-apagadas, empujarla a main y ver al aire que la landing ya no muestra las dos cajas de error; cuando Supabase vuelva, encender las banderas (cambiar `false` por `true` en assets/js/local.js y correr node scripts/descubrimiento.mjs)
---

Pedido de Yonatan del 2026-09-29: «la carta programada, ese menú que se ve todos los días, deshabilitémoslo por el
momento. La carta dice que no se puede cargar la carta en vivo, entonces solucionemos eso. En el menú de hoy pasa lo
mismo, entonces el menú de hoy por el momento también apágalo, y hagamos como una especie de feature flag para
deshabilitar esas dos cosas.» Supabase sigue en 402 (cuota) y se arregla después: esta tarea no lo toca.

Contrato y decisiones: `docs/landing-y-agentes.md`, «Funciones que se pueden apagar». Banderas:
`RESPLANDOR.funciones = { menuDeHoy, almuerzoProgramado }` en `assets/js/local.js`, hoy las dos en `false`.

## Bitácora
- 2026-09-29: hecho en la rama `tarea/funciones-apagadas` (desde `tarea/puntaje-agentes`, 03af726), sin push. Las dos
  banderas gobiernan la landing (`<template x-if>` de Alpine: `#hoy`, `#almuerzo-programado`, sus enlaces, el pie, las
  preguntas y el diálogo), `carta.html`, `menu.html` (apagada: aviso, sin supabase-js ni llamadas, `noindex`), WebMCP,
  el MCP remoto y todo lo generado por `scripts/descubrimiento.mjs`. La carta con Supabase caído sale de un módulo
  compartido (`assets/js/carta-respaldo.js`, la instantánea del 3-sep que ya tenía `carta.html`) con la nota «Precios del
  3 de septiembre de 2026; confírmalos al reservar.»; eso reemplaza la regla «precios solo en vivo» (H16) por decisión de
  Yonatan del 2026-09-29 (docs actualizadas). Cinta: 486/486 pruebas, css/iconos/descubrimiento `--comprobar` en 0;
  `funciones.test.mjs` prueba las cuatro combinaciones de banderas y el ida y vuelta, y 17 mutantes de sus piezas
  mueren. Playwright (Chromium 375×812 y 1440×900, Supabase simulado en 402): 88/88 comprobaciones con las banderas
  apagadas y 76/76 con las dos encendidas (copia temporal regenerada; ahí la suite entera también pasa, 484/484), 0
  errores de consola propios y sin scroll horizontal en landing, carta y menú. Falta: el visto de Yonatan, el push y
  volver a encender las banderas cuando Supabase vuelva.
