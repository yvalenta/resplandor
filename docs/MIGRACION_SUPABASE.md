# Resplandor POS — Migración a Supabase

> Addendum al Open Spec (README.md). Cubre el paso de "localStorage puro" a
> "Supabase como fuente de verdad + localStorage como caché offline".

---

## 1. Qué cambia y por qué

Hoy `index.html` solo manda una copia del cierre diario a Supabase; todo lo
demás (mesas, pedidos, catálogo) vive únicamente en el `localStorage` de
cada dispositivo. Eso significa que dos dispositivos no se ven entre sí, y
que el catálogo solo se puede cambiar editando el HTML.

Con esta migración:

| Antes | Ahora |
|---|---|
| `productos` = constante `CATALOGO` fija en el HTML | tabla `productos` en Supabase, editable desde una vista "Productos" nueva |
| `mesas` / `ordenes` solo en localStorage de cada dispositivo | tablas `mesas` / `ordenes` en Supabase, sincronizadas en vivo entre dispositivos (Realtime) |
| `cierres` ya se respaldaba en Supabase | igual, sin cambios de comportamiento |
| Offline = todo funciona en local | sigue igual: si no hay red, el POS sigue operando 100% con la última copia local, y se pone al día solo cuando vuelve la conexión |

**Principio que se mantiene:** localStorage sigue siendo la primera fuente
que se lee al abrir la app (arranque instantáneo, funciona sin internet).
Supabase se consulta después, en segundo plano, y sus cambios llegan en
vivo por Realtime. Ningún error de red bloquea ni rompe la UI.

---

## 2. Modelo de datos

```
productos   id · categoria · nombre · precio · descripcion · activo
mesas       id · capacidad · estado ('libre' | 'ocupada')
ordenes     id · mesa_id · estado ('abierta' | 'cerrada') · items (jsonb) · total · abierta_en · cerrada_en
cierres     id · fecha · total_ventas · total_ordenes · transacciones (jsonb)   ← ya existía
```

`ordenes.items` se guarda como JSONB (igual que ya hacía `cierres.transacciones`):
evita una tabla `orden_items` aparte y un join, y es exactamente la misma
forma en que ya vive el dato en memoria en el store de Alpine. Es la
decisión coherente con el principio de "alcance quirúrgico" que ya usa
este proyecto.

Ver `schema.sql` para las tablas, índices, triggers de `updated_at`,
policies de RLS y el *seed* con tu catálogo y mesas actuales.

---

## 3. Sincronización en vivo (Realtime)

Para que "visualizar en cualquier dispositivo" sea real (no solo lectura,
sino un segundo dispositivo viendo lo que pasa en el primero), cada
dispositivo se suscribe a cambios de `mesas`, `ordenes`, `productos` y
`cierres`. Cuando la mesera abre la Mesa 4 desde el iPad, la caja lo ve
ocupado sin recargar la página.

**Resolución de conflictos:** el último que escribe gana. No hay bloqueo
optimista ni control de versiones. Para una sola sede con pocos
dispositivos esto es suficiente; si el negocio crece a varias sedes o
turnos concurrentes intensos en la misma mesa, ese es el punto donde valdría
la pena revisar esto — no antes.

---

## 4. Qué NO cambia (garantías de la migración)

- **Diseño y CSS**: cero cambios. Ningún token, clase ni componente visual se tocó.
- **Flujos existentes**: abrir mesa → agregar ítems → facturar → cierre del
  día funcionan exactamente igual en la UI. Lo único nuevo a la vista es
  el link "Productos" en el nav y un punto de estado de conexión junto al
  total de "Hoy".
- **Offline**: si Supabase no responde (sin red, tabla no creada aún,
  etc.), el POS sigue funcionando con lo último que tenía en localStorage.
  Nunca se bloquea un click por culpa de la red.
- **`localStorage` no se elimina**: sigue siendo el respaldo local y el
  arranque en frío si algún día Supabase no está configurado.

---

## 5. Pasos para desplegar

1. **Correr `schema.sql`** en Supabase → SQL Editor (el proyecto
   `yjtcrhmdztbuylgpuvsm` que ya usa `index.html`). Es idempotente: se
   puede correr más de una vez sin duplicar nada.
2. **Activar Realtime** en las tablas `mesas`, `ordenes`, `productos`,
   `cierres` — el script ya lo hace vía `alter publication
   supabase_realtime add table ...`, pero confirma en Database → Replication
   que las 4 tablas quedaron marcadas.
3. **Reemplazar `index.html`** por la versión nueva (adjunta). No requiere
   ningún build ni instalación — sigue siendo un solo archivo.
4. **Probar en dos pestañas/dispositivos a la vez**: abrir una mesa en una,
   confirmar que aparece ocupada en la otra en segundo o dos.
5. Si la tabla `productos` está vacía la primera vez que abres la app
   nueva, ella misma la siembra con tu catálogo actual (no es obligatorio
   correr la sección 4 del `schema.sql` a mano, pero no hace daño hacerlo).

**Rollback:** si algo falla, basta con volver al `index.html` anterior — no
se tocó ni se borró nada de lo que ya tenías, y las tablas nuevas en
Supabase no interfieren con la tabla `cierres` existente.

---

## 6. Qué falta (fuera de esta migración)

Del checklist original de "fuera de alcance" en el README, esto sigue
pendiente y no se tocó aquí:

- Autenticación / roles (todo sigue siendo acceso anónimo de un solo local)
- Impresora térmica directa (sigue siendo `window.print()`)
- Inventario / control de stock
- Facturación electrónica (DIAN)

Y de lo que sí se agregó, el límite consciente es: sin autenticación, la
policy de RLS da acceso completo al rol `anon` en las 4 tablas — está bien
para una sola sede sin login, pero es el primer lugar donde apretar
permisos si en algún momento hay usuarios con roles distintos (mesero vs.
administrador).
