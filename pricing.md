---
title: "Precios y cotizaciones — Resplandor Restaurante"
description: "Rango de precios de Resplandor Restaurante, dónde viven los precios en vivo y cómo se cotiza una celebración. Leer la carta y los archivos para agentes es gratis y sin registro."
canonical: https://resplandor.ynt.codes/pricing.html
last-updated: 2026-10-04
---

# Precios y cotizaciones — Resplandor Restaurante

Rango de precios declarado por el restaurante: $$ · desde 14.000 COP. Es una referencia, no el mínimo de toda la carta; el precio de cada plato está solo en la carta en vivo. Cocina colombiana, asados y cocina mixta en La Estrella, Antioquia. Desayunos y almuerzo todos los días y celebraciones en el local de 10 a 30 personas.

## La carta y sus precios

Los precios viven en la carta en vivo: [carta.html](https://resplandor.ynt.codes/carta.html) para personas y, para máquinas, el GET de la vista `carta_publica` que describe [la documentación de la API](https://resplandor.ynt.codes/api/) ([OpenAPI](https://resplandor.ynt.codes/openapi.json)). Los archivos para agentes de este sitio no los copian: lo único estático es el rango (`rangoDePrecios` en `local.json`, que otras páginas repiten: un dato del restaurante, no el precio de la carta de hoy). Para personas, la página de la carta guarda además una copia de respaldo del 3 de septiembre de 2026 que muestra, con su fecha a la vista, solo si la carta en vivo no responde: no la cites como vigente. Los precios se confirman al reservar.

## Desayunos y almuerzos

Todos los días: desayunos de 7:00 a 11:00 y almuerzos de 12:00 a 17:00. Las promociones del día (la categoría «Promociones» de la carta) valen solo ese día de la semana; el precio 0 en una promoción es un descuento: vale lo que diga su etiqueta.

## Celebraciones, eventos y paquetes

Todo evento y toda celebración es en el restaurante, de 10 a 30 personas, y se cotiza por WhatsApp (+57 322 554 2434) según el tipo, la fecha y la cantidad de personas: no hay una tarifa fija publicada. Sin anticipos ni pagos por este sitio: todo se conversa y se confirma con el restaurante. Nunca hay eventos a domicilio ni catering externo. Recomendamos avisar con 48 horas de anticipación.

- Reserva de mesa
- Cumpleaños infantil
- Cena romántica / aniversario
- Fiesta / quinceañera
- Plan menú ejecutivo
- Plan barril
- Plan Resplandor All-Inclusive
- Evento corporativo
- Otra celebración

Una reserva de mesa o una cena romántica / aniversario (que se anuncia «en pareja») no tienen ese mínimo de personas, solo el máximo de 30.

## Para agentes y desarrolladores

Todo lo que una máquina puede leer de este sitio es gratis y sin registro: la [API de lectura](https://resplandor.ynt.codes/api/), las herramientas WebMCP de [la página principal](https://resplandor.ynt.codes/), el MCP remoto del repositorio (todavía sin desplegar) y los archivos ([llms.txt](https://resplandor.ynt.codes/llms.txt), [local.json](https://resplandor.ynt.codes/local.json), [index.md](https://resplandor.ynt.codes/index.md)…). No hay planes, niveles ni cuotas propias (aplican los límites del plan de Supabase) y no hay pagos de máquina a máquina: x402, MPP y UCP no aplican. Nada de esto cobra ni acepta un pago por una persona; el detalle en [auth.md](https://resplandor.ynt.codes/auth.md).
