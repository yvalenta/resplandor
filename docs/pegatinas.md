# Pegatinas NFC de las mesas: guía para Yonatan y Camila

Cada mesa tiene una pegatina NFC (y, de respaldo, un QR con el mismo enlace). Al tocarla con el teléfono se abre la carta de Resplandor con la cuenta de esa mesa en vivo. Esta guía dice cómo **escribir**, **proteger**, **revisar** y **rotar** una pegatina. Está pensada para hacerse con el teléfono en la mano, sin saber de NFC.

> **Qué lleva una pegatina.** Un solo enlace, con la forma `https://resplandor.ynt.codes/carta.html?m=<mesa>&k=<código de 48 caracteres>`. El código (`k`) es la llave que deja ver la cuenta abierta de esa mesa: **quien tiene el enlace ve la cuenta**. Por eso el enlace no se manda por WhatsApp ni se pega en ningún documento. Cada mesa tiene su código, que nace solo al crear la mesa en el POS. Diseño y razones: [`docs/sdd-cuenta-en-mesa.md`](sdd-cuenta-en-mesa.md) §03.7 y §12.3.

Quién hace qué: **todo lo de esta guía es del administrador** (hoy, Yonatan y Camila). El mesero ve el enlace y puede copiarlo, pero no crea mesas ni rota enlaces.

---

## 1. Antes de empezar

- Una pegatina **NTAG215** (las que ya se usan; también sirven la NTAG213 y la NTAG216). El enlace ocupa unos 100 bytes: cabe de sobra incluso en la más chica, la NTAG213 (144 bytes).
- **Abre el POS desde `https://resplandor.ynt.codes/pos.html`**, no desde una copia local ni desde otro dominio. El enlace que escribe el POS sale del dominio desde el que lo abriste; abierto en otro sitio, escribirías una pegatina que lleva a otro lado.
- Para escribir desde el POS hace falta un **Android con Chrome** (ver §2). Con **iPhone**, o si el POS no escribe, se usa NFC Tools (§3).
- Ten una **pegatina de repuesto** para ensayar la primera vez, sobre todo lo de la contraseña (§4).

## 2. Escribir la pegatina desde el POS (Android)

Esto usa Web NFC, que solo existe en **Chrome para Android**. No funciona en Safari, en Firefox ni en iPhone.

Requisitos, todos a la vez:

1. **Chrome** actualizado, abierto en `https://resplandor.ynt.codes/pos.html` (el candado de HTTPS es obligatorio: Web NFC se niega en una página sin él).
2. **NFC encendido** en el teléfono (Ajustes → Conexiones → NFC) y **la pantalla encendida y desbloqueada**.
3. La primera vez, Chrome pregunta si el sitio puede **usar NFC**: responde que sí. Si dijiste que no sin querer: candado de la barra de direcciones → Permisos → NFC.

Pasos:

1. En el POS, entra a **Mesas y pegatinas** (solo se ve con una cuenta de admin).
2. En la fila de la mesa, toca **Escribir pegatina**. La hoja dice «Escribir pegatina · Mesa N» y «Tiene que ser la pegatina de la mesa N: lo que esté cerca se sobrescribe».
3. Apoya la **parte de atrás del teléfono** contra la pegatina (la antena suele estar cerca de la cámara o en el centro) y **no la muevas** hasta que el POS diga que terminó. Es un gesto de unos segundos.
4. Al terminar, el teléfono **vibra**, la fila anota **«Escrita» con la fecha y la hora** y la hoja ofrece **Revisar ahora**. Si algo falla (lo típico: la pegatina se alejó muy pronto), el POS lo dice, no anota nada y deja **Reintentar**.
5. **Revisa** la pegatina (§5) antes de dejarla pegada: toca **Revisar ahora**.

**Si alguien gira el enlace de esa mesa mientras la escribes** (desde otro dispositivo), la pegatina quedó con el enlace viejo: el POS manda a la base **el enlace que de verdad escribió** y la base lo compara con el de la mesa; si no coincide, **no** la da por escrita (ni por revisada) y la hoja dice «El enlace de la mesa N cambió mientras tanto… Vuelve a escribirla». Reintentar escribe ya el enlace nuevo.

Lo que el POS **nunca** hace: bloquear la pegatina para siempre (`makeReadOnly`). Está prohibido a propósito (§4). Y lo que no puede hacer: **escribir una pegatina que ya tiene contraseña**, porque Web NFC no sabe usarla. Para esas, usa NFC Tools (§3 y §4).

## 3. Alternativa: iPhone (o cualquier teléfono) con NFC Tools

Para un iPhone 7 o posterior con iOS 13 o más, o para una pegatina con contraseña. La app es **NFC Tools** (gratis, de wakdev). Los nombres de los menús pueden variar un poco con la versión.

1. En el POS (en Safari, desde `https://resplandor.ynt.codes/pos.html`), abre **Mesas y pegatinas** y toca **Copiar enlace** en la mesa. Si el teléfono no deja copiar, el POS muestra el enlace entero para que lo selecciones y copies.
2. Abre NFC Tools → **Escribir** → **Añadir un registro** → **URL / URI**. Pega el enlace.
3. Toca **Escribir** y acerca la **parte de arriba del iPhone** a la pegatina hasta que la app confirme.
4. **Revisa** la pegatina (§5). En un iPhone el POS no puede leerla ni escribirla: la revisión es a mano, y luego anotas en la tarjeta de la mesa **Ya la escribí** y **Ya la revisé** (el POS manda el token del enlace que copiaste: si mientras tanto giraron el enlace, la base no lo da por bueno y te lo dice).

**No uses** «Bloquear etiqueta», «Lock» ni nada que diga *solo lectura* o *permanente* (§4).

## 4. La contraseña de la pegatina (D16)

**Por qué.** De fábrica, **cualquier persona con una app de NFC puede reescribir una pegatina en cinco segundos** y apuntarla a un clon de la carta, sin que se note por fuera. La contraseña de escritura lo impide: la pegatina se sigue leyendo libre, pero para cambiarla hay que dar la contraseña. Es un freno, no un candado de banco: la contraseña de una NTAG mide 32 bits y viaja sin cifrar al escribir. Tampoco impide **pegar otra pegatina encima**, y para eso está la revisión de todos los días (§5). Por eso las páginas públicas del restaurante nunca muestran números de cuenta ni QR para pagar.

**Qué se pone** (decisión D16 de [`docs/sdd-cuenta-en-mesa.md`](sdd-cuenta-en-mesa.md) §03.7): contraseña **PWD/PACK**, protegiendo desde la página de usuario (**AUTH0 = 04h**) y solo la **escritura** (**PROT = 0**: leer sigue libre).

**Cómo, con NFC Tools** (menú **Otros**, o *Other*): **Establecer contraseña** (*Set password*) y, al revés, **Quitar contraseña** (*Remove password*). Con la pegatina ya escrita y **revisada**:

1. Ensaya primero en la **pegatina de repuesto**.
2. Pon la contraseña. Que la app te pida una de las que acepta; **guárdala en el gestor de contraseñas de Yonatan**, nunca en el repo, en un chat ni en una nota compartida.
3. **Prueba obligatoria, con un teléfono que NO tenga la app y no sepa la contraseña** (el de un cliente, el tuyo sin NFC Tools): toca la pegatina. Tiene que **abrir la carta**. Si pide contraseña o no abre nada, la app dejó la **lectura** protegida: quítale la contraseña de inmediato y no uses esa pegatina así. No se verificó que NFC Tools ponga solo la escritura; esta prueba es la que lo comprueba.
4. Prueba también que **no se deja escribir** sin la contraseña (por ejemplo, intentando «Escribir pegatina» desde el POS en Android: tiene que fallar).

**Lo que nunca se hace: «bloquear para siempre».** Existen dos cosas irreversibles, y las dos están prohibidas:

- **Bloquear la etiqueta** (*Lock tag*, bits de bloqueo): la deja de solo lectura **para siempre**. Si el enlace se filtra, ya no se puede rotar: solo tirar la pegatina.
- **Bloquear la configuración** de la contraseña (CFGLCK): congela la contraseña y el rango protegido, también para siempre.

Y un tercer cuidado: no actives un **límite de intentos fallidos** de contraseña (AUTHLIM) si alguna app lo ofrece; déjalo sin límite. Si se agotara, la pegatina se negaría a escribirse nunca más.

**Si se pierde la contraseña**, esa pegatina deja de poder reescribirse. No pasa nada grave (se lee igual), pero no se puede rotar: se cambia por otra. Las pegatinas son baratas.

## 5. Revisar una pegatina

**Cuándo.** Al escribirla, y **cada día al abrir**: toca cada pegatina con un teléfono y **lee el dominio en la barra de direcciones**. Tiene que decir `resplandor.ynt.codes`. **Mirar la página no basta**: un clon pinta la misma. Pasa la uña por el borde para notar una pegatina pegada encima.

**Desde el POS (Android, Chrome).** En **Mesas y pegatinas**, toca **Revisar** en la mesa y acércala. El POS lee la pegatina y compara: la dirección tiene que ser **exactamente** el enlace de esa mesa y del dominio del restaurante. Si coincide, la fila anota **«Revisada»** con la fecha y la hora. Si no coincide (otra mesa, otro dominio, un código viejo, un enlace que no es de Resplandor), el POS lo dice y **no** anota nada: reescribe la pegatina.

**A mano, con cualquier teléfono.**

1. Toca la pegatina: tiene que abrir `resplandor.ynt.codes/carta.html` y mostrar, bajo el nombre del restaurante, la insignia **«Mesa N»** con el número de esa mesa.
2. Toca **«Ver mi cuenta · Mesa N»**: con la mesa abierta muestra la cuenta; con la mesa libre, «Todavía no hay cuenta abierta». Si dice **«Este enlace ya no sirve»**, el código está viejo (se rotó), o la mesa está desactivada: reescribe o retira la pegatina.
3. Si tienes NFC Tools, **Leer** muestra el enlace guardado: compara la mesa (`m=`) y que el dominio sea el correcto. No pegues ese enlace en ningún otro lado.

## 6. Rotar el enlace

**Cuándo.** Se perdió o se sospecha de una pegatina, alguien guardó o fotografió el enlace, la pegatina cambió de mesa, o se descubrió una pegatina ajena encima. **No** se rota «al cerrar cada cuenta»: obligaría a reescribir las pegatinas varias veces al día.

**Quién.** Solo un administrador. El mesero no ve el botón, y la base de datos lo rechaza aunque lo intente por la API.

**Qué pasa al rotar.** La pegatina actual **deja de servir al instante**: quien la toque, o tenga la cuenta abierta en su teléfono, ve «Este enlace ya no sirve». Conviene rotar con la mesa sin clientes mirando su cuenta, y con el teléfono y la pegatina a la mano.

Pasos:

1. En el POS, **Mesas y pegatinas** → la mesa → **Rotar enlace**. Confirma dentro de la página.
2. Escribe el enlace nuevo:
   - **pegatina sin contraseña, con Android:** **Escribir pegatina** (§2);
   - **pegatina con contraseña** (o con iPhone): NFC Tools → **Quitar contraseña** (con la contraseña) → escribir el enlace nuevo, que copias con **Copiar enlace** (§3) → **Establecer contraseña** otra vez (§4).
3. **Revisa** (§5), incluida la prueba de lectura sin la contraseña.
4. Si la mesa tiene el **QR de respaldo** impreso con el mismo enlace, también hay que **reimprimirlo**: el viejo ya no sirve.

## 7. Mesa nueva y mesa desactivada

- **Mesa nueva.** **Mesas y pegatinas** → **Agregar mesa** (número y capacidad). El código del enlace se genera solo. Después: escribir (§2 o §3), revisar (§5) y poner la contraseña (§4).
- **Cambiar la capacidad** de una mesa se hace desde el mismo panel; no toca el enlace ni la pegatina.
- **Desactivar una mesa** (sale del salón; por ejemplo, si ya no existe). El POS no la desactiva si tiene una cuenta abierta. Mesa desactivada = el enlace de su pegatina deja de funcionar y la carta le dice a quien la toque «Este enlace ya no sirve… pídele a un mesero que te ayude» (el enlace queda guardado: si la reactivas, la pegatina vuelve a servir sin reescribirla). **Retira la pegatina** de esa mesa.
- Una mesa no se borra: tiene historial de cuentas. Se desactiva.

## 8. Si algo falla

| Síntoma | Qué mirar |
|---|---|
| El POS no tiene botón **Escribir pegatina** | El teléfono o el navegador no soporta Web NFC (iPhone, Safari, Firefox, Chrome de escritorio): usa NFC Tools (§3) |
| «No se pudo escribir» o se queda esperando | NFC apagado; pantalla bloqueada; la pegatina en el centro de la antena (muévela despacio, sin separarla); funda gruesa, o pegatina sobre metal (hay pegatinas «para metal»); el POS abierto fuera de `resplandor.ynt.codes` |
| Falla solo en esa pegatina | Tiene contraseña: usa NFC Tools con la contraseña (§4). Si está bloqueada para siempre, o no se acuerdan de la contraseña, se cambia por otra |
| Al tocarla abre otra cosa, o pide contraseña para leer | Está mal escrita, o la contraseña protege también la lectura (§4, prueba 3): quítale la contraseña y reescribe |
| La carta dice «Este enlace ya no sirve» | Código rotado, mesa desactivada o enlace mal copiado. Revisa la mesa en **Mesas y pegatinas** y reescribe si hace falta |
| La revisión dice que no coincide | Distinta mesa, dominio ajeno o código viejo: reescribe. Si el dominio es ajeno, **alguien reescribió o pegó otra pegatina**: rota el enlace de esa mesa y reemplaza la pegatina |

## 9. Lo que nunca se hace, en una lista

- **Nunca bloquear la pegatina** para siempre ni bloquear la configuración de la contraseña.
- **Nunca** compartir el enlace de una mesa (WhatsApp, correo, capturas de pantalla con la barra de direcciones).
- **Nunca** guardar la contraseña de las pegatinas, ni ningún enlace con su código, en el repositorio (es público), en un chat ni en un documento compartido.
- **Nunca** escribir una pegatina con un enlace de otro dominio, ni con acortadores.
- **Nunca** poner en una pegatina, ni en la página que abre, un número de cuenta, una llave o un QR para pagar: el dinero lo recibe una persona, en la mesa.
