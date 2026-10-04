# Impresora de la caja: imprimir desde cualquier celular

Los celulares **no instalan nada**. El mesero toca «Imprimir precuenta» (la de toda la cuenta), el «Precuenta» de una persona o «Imprimir» en el ticket de un cobro; el POS
pregunta «¿Imprimir … en la caja?» y, al tocar **«Imprimir en la caja»**, deja el ticket en una cola (en Supabase) y este programa, que corre en el PC de la caja, lo recoge y lo
saca por la térmica. **Imprimir va siempre a la caja** (ya no se elige entre la caja y el teléfono) y nada sale hasta que el mesero confirma. Funciona con wifi o con datos,
desde cualquier dispositivo.

```
Celular (POS) ──► cola en Supabase ◄── este agente (PC de la caja) ──► térmica USB
```

El agente solo **llama hacia afuera** (como abrir una página web): no abre puertos, no necesita IP fija ni tocar el
router. Si la caja no está en línea (el POS la ve sin señal por más de 90 segundos), el POS **lo dice en la misma pregunta** — «La caja no está en línea (última señal hace 7 min).
Se imprime desde este teléfono.» — y el mesero puede tocar «Imprimir aquí» para sacar el ticket del navegador del teléfono, como siempre: es la salida de emergencia. (Una caja **dada de baja** desde la vista de la impresora no cuenta como caja: el POS imprime directo, igual para el admin que para el mesero.)

## Qué necesitas

- El PC de la caja con Windows, con la térmica ya instalada y que imprime desde Windows (aunque sea una página de prueba).
- Internet en ese PC.
- Un token de impresora (se saca del POS en el paso 3).

## Pasos (se hacen una sola vez, unos 15 minutos)

**1. Instalar Node 22.** Entra a <https://nodejs.org>, baja la versión «LTS» (22 o más nueva) e instálala con todo por
defecto. Para comprobarlo abre «Símbolo del sistema» y escribe `node --version`: tiene que decir `v22…` o más.

**2. Copiar la carpeta.** Copia la carpeta `impresora` de este repositorio al PC, por ejemplo a
`C:\resplandor-impresora`. (No hace falta instalar nada más: no hay `npm install`.)

**3. Sacar el token.** En el POS entra como administrador → **Administración** → tarjeta **Impresora de la caja** → **Configurar impresora** → pon un nombre (por
ejemplo «Caja») → **Agregar impresora**. Sale el token con dos botones: **Copiar token** y **Copiar config.json**
(este último trae el archivo ya armado: solo le falta el nombre de la impresora de Windows). El token se muestra
**una sola vez**: pégalo en el paso 4 antes de cerrar esa pantalla. Si lo pierdes, usa «Rotar token» y te da uno nuevo
(el anterior deja de servir al instante).

**4. Llenar `config.json`.** Lo más corto: en la carpeta crea un archivo `config.json` (Bloc de notas), pega lo que
copiaste con **Copiar config.json** y cambia solo `impresora` en el paso 5. Si prefieres hacerlo a mano, copia
`config.ejemplo.json` como `config.json`, ábrelo con el Bloc de notas y cambia los cuatro primeros valores, dejando
las comillas:

| Clave | Qué poner |
|---|---|
| `supabaseUrl` | la dirección del proyecto, `https://….supabase.co` (la misma que usa el POS) |
| `publishableKey` | la clave **publicable** (`sb_publishable_…`, la que ya está en `pos.html`). **Nunca la secreta** (`sb_secret_…`): el programa no arranca si la pegas |
| `token` | el token del paso 3 |
| `impresora` | el nombre de la térmica en Windows (paso 5) |

**5. Ver el nombre de la impresora.** En el Símbolo del sistema, dentro de la carpeta (`cd C:\resplandor-impresora`):

```
node agente.mjs --impresoras
```

Copia el **Nombre** exacto (mayúsculas, espacios y guiones) en `config.json`, en `"impresora"`.

**6. Imprimir la página de prueba.**

```
node agente.mjs --prueba
```

Tiene que salir un ticket con «RESPLANDOR», una regla de números y dos barras `| |`. Mira:

- La regla `1234567890…` cabe en **una** línea y las dos barras se ven, una a cada lado → las columnas están bien.
- Las tildes y la ñ se leen bien (`áéíóú ñ ¿?`).
- Sale un cuadrado QR y el papel se corta.

Si algo no está bien, ve a **«Si algo falla»** más abajo, cambia `config.json` y repite `--prueba`.

**7. Arrancar el agente.** Doble clic en `iniciar.cmd`. Se abre una ventana negra que dice «Esperando trabajos de
impresión». **Déjala abierta** (puede estar minimizada). En el POS tiene que aparecer «Caja: en línea». Haz una
cuenta de prueba e imprímela con «Imprimir precuenta» → «Imprimir en la caja». Para ver el papel de una persona, divide la cuenta por persona (toca «Asignar a persona» en cada
línea) y usa el «Precuenta» de su fila: sale «PRECUENTA - no es un cobro», «Cuenta de <nombre> · Mesa N», solo lo de esa persona y su total.

**8. Que arranque solo con Windows.** Presiona `Win + R`, escribe `shell:startup` y Enter. En esa carpeta crea un
acceso directo a `iniciar.cmd` (click derecho sobre `iniciar.cmd` → «Crear acceso directo» y arrástralo ahí; en sus
propiedades elige «Ejecutar: minimizada»). Alternativa: click derecho en `instalar.ps1` → «Ejecutar con PowerShell»,
que hace esto y el paso 9 preguntándote antes.

Para que también arranque tras un **corte de luz**, el PC tiene que entrar a Windows sin pedir clave: `Win + R` →
`netplwiz` → quita la marca de «Los usuarios deben escribir su nombre y contraseña».

**9. Que el PC nunca se duerma.** Configuración → Sistema → Inicio/apagado y suspensión → «Suspender: Nunca» cuando
está enchufado. Además, en «Opciones de energía» → «Cambiar la configuración del plan» → «Configuración avanzada»
→ «Configuración de USB» → **«Suspensión selectiva de USB: Deshabilitada»**: si no, la térmica USB se duerme y el
primer ticket del día no sale.

## Cómo saber que está bien

- La ventana dice «Señal en tiempo real conectada»: los tickets salen al instante. (Si dice que la señal está caída,
  igual funciona: mira la cola cada 5 segundos.)
- El POS muestra «Caja: en línea» (el agente avisa cada 30 s; si pasa de 90 s sin avisar, el POS dice «sin conexión» y
  los celulares avisan que la impresión sale del teléfono y piden confirmarlo).
- Cada ticket queda en `impresiones.log` (en la misma carpeta; se rota solo, no crece sin límite). El token **nunca**
  se escribe ahí.

## Actualizar o cambiar el token

- **Nueva versión del agente:** cierra la ventana, copia los archivos nuevos sobre la carpeta (**sin borrar
  `config.json`**) y vuelve a abrir `iniciar.cmd`. `node agente.mjs --version` dice cuál tienes.
- **Nuevo token:** pégalo en `config.json`, cierra la ventana y abre `iniciar.cmd` otra vez.

## Si algo falla

| Qué pasa | Qué es | Qué hacer |
|---|---|---|
| «No puedo arrancar: hay que arreglar config.json» | falta o sobra algo en `config.json` | lee la lista que sale: dice cuál clave y qué poner. `iniciar.cmd` se queda esperando para que la leas |
| «La base no reconoce este token» | el token se rotó, se desactivó la impresora o se copió mal | POS → Administración → Impresora de la caja → «Configurar impresora» → «Rotar», pega el nuevo en `config.json` y reinicia |
| «La base no tiene la función impresora_tomar» | falta aplicar la migración de la cola en Supabase | es de Yonatan: la aplica en Supabase → SQL Editor (`20261003140000_cola_impresion.sql`). Hasta entonces el POS no ofrece la impresión en la caja |
| «Supabase rechazó la clave publicable» | `publishableKey` o `supabaseUrl` mal copiados | cópialos de nuevo, completos |
| «Windows no conoce una impresora con ese nombre» | `impresora` no es el nombre exacto | `node agente.mjs --impresoras` y copia el nombre tal cual |
| Sale basura, símbolos, o nada, o dice «no acepta datos RAW» | el driver no deja pasar datos directos | reinstala la térmica con el **driver del fabricante**, o con «Generic / Text Only» (Agregar impresora → «Otra» → «Generic» → «Generic / Text Only») y pon ese nombre en `config.json` |
| Tildes o ñ raras (`‚`, `¢`, `Ã±`) | tabla de caracteres distinta | en `config.json` prueba `"tablaEscPos": 19`, luego `0`, luego `16` y repite `--prueba` (2 es lo normal) |
| Salen ideogramas chinos en vez de tildes | la térmica es un clon en modo chino | pon `"cancelarKanji": true` |
| Líneas partidas, o el precio se corta en el borde | `columnas` no es el del papel | papel de 80 mm: `48` (o `42`); de 58 mm: `32`. Repite `--prueba` hasta que la regla quepa y se vean las dos barras |
| El QR no sale, sale enorme o sale basura | la térmica no entiende el QR nativo, o es de otro tamaño | `"qrTamano": 4` (más chico); si sigue mal, `"qrNativo": false`: imprime la dirección escrita |
| No corta, o corta muy abajo / con mucho papel en blanco | el corte de esa térmica | `"cortar": "total"` si no corta; `"avance": 0` si sobra papel; `"cortar": false` si no tiene cortador (se rompe a mano) |
| Un ticket sale dos veces | hay **dos ventanas** del agente abiertas | cierra una (en la barra de tareas, o `Ctrl+Shift+Esc` → procesos «node.exe») |
| «Caducó: llevaba N min esperando» (o, en el POS, «caducó: la impresora no la tomó a tiempo» / «no la terminó a tiempo») | el agente estaba apagado (o el PC se colgó a media impresión) y el ticket quedó de hace más de 15 minutos | es a propósito (para que no salgan las cuentas de hace una hora al volver). Vuelve a pedir el ticket desde el POS. La base caduca a los 15 min; el agente igual (`caducaMinutos`, 15 por omisión; 0 = el agente imprime lo que la base le entregue) |
| «El ticket pasa de 600 renglones de papel» | un documento enorme (o con muchísimos saltos de línea) que gastaría el rollo | es a propósito. Una cuenta normal no llega ni a 100 renglones; si de verdad hace falta, imprime desde el teléfono |
| El POS dice «Caja: sin conexión» | el agente no está corriendo o el PC no tiene internet | mira la ventana negra; si no está, abre `iniciar.cmd` |
| El mesero confirmó el ticket de un cobro, volvió a las mesas y, unos segundos después, la pantalla del ticket reapareció sola y se abrió la impresión del teléfono | el envío a la caja no contestó en 10 s (red lenta) y el POS no deja sin ticket al cliente que ya pagó: lo saca desde el teléfono (y cancela el de la caja para que no salga doble). Una precuenta no hace esto: se vuelve a pedir | nada que hacer: imprime desde el teléfono o cancela, y toca «Volver». Si pasa seguido, es la red del teléfono o del local |
| Un ticket queda «En cola…» y no sale | el agente está parado, o el PC sin internet | igual que arriba; cuando vuelva, sale solo si pasaron menos de 15 minutos (`caducaMinutos`). A los 25 s el POS dice «La caja no responde»: si imprimes desde el teléfono, el POS cancela el de la caja y no sale doble |
| El POS dice «Impreso ✓» pero no sale papel | «Impreso» quiere decir que Windows **recibió** el ticket. Si la térmica está apagada, sin papel, con la tapa abierta o con el cable USB suelto, el ticket espera en la cola de Windows | revisa la térmica (luz, papel, tapa, cable). Al arreglarla salen solos los tickets que esperaban; para descartarlos: Configuración → Impresoras → tu térmica → «Abrir cola de impresión» → Impresora → «Cancelar todos los documentos» |

Para ver el ticket sin gastar papel, o probar en otra máquina: `node agente.mjs --simular --prueba` guarda el
ticket como archivo en la carpeta `salida` (un `.txt` legible y el `.bin` que recibiría la térmica).
`node agente.mjs --vista-previa un-ticket.json` muestra en pantalla cómo saldría un documento.

## Deshacerlo (menos de un minuto)

- **En el PC:** cierra la ventana negra del agente (y borra el acceso directo de `shell:startup` si no lo quieres más).
  A los 90 segundos el POS dice «Caja: sin conexión» y, al imprimir, avisa que sale del teléfono y deja confirmarlo con «Imprimir aquí».
- **En la base:** el bloque «REVERSA» que está en la cabecera de `20261003140000_cola_impresion.sql` (se pega en el SQL
  Editor). El POS sin la migración es el de siempre: no muestra el botón ni el indicador.
- **Solo cambiar el token o apagar una impresora:** POS → Administración → Impresora de la caja → «Configurar impresora» → «Rotar token».

## Frente a la propuesta con Tailscale

|  | Cola en Supabase + este agente | Tailscale en el PC y en cada celular |
|---|---|---|
| Celulares | **nada que instalar**; sirve cualquier dispositivo con internet | instalar y mantener Tailscale en cada uno (meseros nuevos, VPN en iPhone, batería, cuentas) |
| Red del local | solo conexiones de salida, sin puertos abiertos ni IP fija | servicio expuesto en la red privada; permiso de «red local» en Chrome Android; una URL por dispositivo |
| Si falla la caja | el POS lo detecta («sin conexión» o «Error») y ofrece «Imprimir aquí» (la impresión normal del teléfono) | hay que cambiar a mano; además depende de que la VPN esté activa en el celular |
| Qué queda guardado | cada trabajo y su estado en la base (se ve «Impreso ✓ / Error»; se purga a los 7 días) | solo `impresiones.log` en el PC |
| Costo | cero: unas 17 mil consultas pequeñas al día con el sondeo de respaldo, en el plan Free | cero con el plan gratuito de Tailscale (revisar su límite de usuarios) |

## Para quien integra esto (resumen técnico)

- Contrato con la base: tres funciones RPC que el agente llama con la clave publicable y el token en el cuerpo:
  `impresora_tomar(p_token, p_max)`, `impresora_confirmar(p_token, p_id, p_ok, p_error)` e
  `impresora_latido(p_token, p_version)`. La señal en tiempo real es un broadcast (cualquier nombre de evento, sin
  datos) al tópico `impresora:` + hex(sha256(token)) en un canal público; el agente solo la usa para despertarse.
- Formato de los documentos que arma el POS (`impresiones.contenido`): está documentado arriba de
  `ticket/escpos.mjs`. `node agente.mjs --vista-previa f.json` sirve para probar un documento.
- El agente confía solo en el token; no confía en el contenido: quita los bytes de control de cualquier texto antes de
  mandarlo a la impresora (`scripts/pruebas/impresora-escpos.test.mjs`).
- Probar sin Windows ni térmica: `--simular` (todo el recorrido, escribiendo `.bin` y `.txt` en `salida/`).
  Las pruebas (`scripts/pruebas/impresora-*.test.mjs`) usan un Supabase de mentira local (HTTP + WebSocket).
