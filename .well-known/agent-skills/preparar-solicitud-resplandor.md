---
name: preparar-solicitud-resplandor
description: Armar el mensaje y el enlace de WhatsApp para una reserva, un almuerzo programado o una celebración en Resplandor Restaurante. Nunca envía, reserva ni cobra nada: la persona abre el enlace y lo manda ella misma.
---

# Preparar una solicitud para Resplandor Restaurante

**Principio de la casa: la persona envía.** Esta skill arma texto y un enlace `wa.me`; nunca hace la petición que abriría WhatsApp, ni manda el mensaje por su cuenta. Si no hay una persona del otro lado para abrir el enlace, no se usa esta skill.

## Reglas

Con un tipo (de los de «tipos») y los datos que apliquen, armarSolicitud (assets/js/solicitud.js) arma el mensaje y el enlace wa.me (el mensaje va codificado con encodeURIComponent); la persona abre ese enlace y lo envía ella misma desde WhatsApp — ni el sitio ni un agente lo mandan. Todo evento y toda celebración es en el restaurante — la única excepción es el almuerzo programado (tipo «almuerzo»), que puede ser a domicilio si la persona asume el costo. «personas» va de 1 a maxPersonas (sin mínimo) para una reserva de mesa (tipo «reserva»), un almuerzo programado (tipo «almuerzo») o una cena romántica / aniversario (tipo «cena-romantica» — se anuncia «en pareja», decisión por defecto de Yonatan, 2026-09-28), y de minPersonasEvento a maxPersonas para cualquier otro tipo (evento/celebración/paquete); fuera de rango se ajusta al límite más cercano con aviso, nunca se rechaza la solicitud entera.

## Tipos válidos

- `reserva`: Reserva de mesa
- `almuerzo`: Almuerzo programado
- `cumpleanos-infantil`: Cumpleaños infantil
- `cena-romantica`: Cena romántica / aniversario
- `fiesta-quince`: Fiesta / quinceañera
- `menu-ejecutivo`: Plan menú ejecutivo
- `plan-barril`: Plan barril
- `all-inclusive`: Plan Resplandor All-Inclusive
- `evento-corporativo`: Evento corporativo
- `otra`: Otra celebración

## Cómo se arma (mismo código que la web)

`assets/js/solicitud.js#armarSolicitud(datos)` recibe `{ tipo, fecha, hora, personas, nombre, nota, entrega, direccion, frecuencia }` y devuelve `{ mensaje, enlace, avisos }`. El MCP remoto expone lo mismo como `resplandor_preparar_solicitud`; WebMCP como `anotar_solicitud` + `ver_solicitud` + `abrir_solicitud`.

## Ejemplo real

```json
{
  "tipo": "reserva",
  "fecha": "2026-10-03",
  "hora": "19:00",
  "personas": 4,
  "nombre": "Ana"
}
```

produce (mensaje recortado):

```
¡Hola, Resplandor Restaurante! Quiero hacer esta solicitud:

Tipo: Reserva de mesa
Fecha: 2026-10-03
…
```

y `enlace`: un `https://wa.me/573225542434?text=...` con ese mensaje codificado — lo abre una persona, nunca un agente.

