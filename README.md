# Restaurante Resplandor POS

> **Software Design Document · Open Spec v1.0**

Punto de venta táctil para gestión de mesas, facturación y cierre diario.  
Stack: HTML + Tailwind CDN + Alpine.js + Lucide Icons.

| Versión | Estado | Stack | Actualizado |
|---------|--------|-------|-------------|
| 1.0 — Open Spec | Definición inicial | HTML · Tailwind · Alpine.js | Junio 2026 |

---

## Contenidos

1. [Introducción](#01--introducción)
2. [Alcance](#02--alcance)
3. [Stack tecnológico](#03--stack-tecnológico)
4. [Arquitectura](#04--arquitectura)
5. [Sistema de diseño](#05--sistema-de-diseño)
6. [Entidades del dominio](#06--entidades-del-dominio)
7. [Contrato de datos](#07--contrato-de-datos)
8. [Flujos principales](#08--flujos-principales)
9. [Fases de desarrollo](#09--fases-de-desarrollo)
10. [Decisiones fijas](#10--decisiones-fijas)
11. [Estructura del HTML](#11--estructura-del-html)
12. [Componentes](#12--componentes)
13. [Checklist MVP](#13--checklist-mvp)

---

## 01 — Introducción

### ¿Qué construimos?

**Resplandor POS** es una aplicación web táctil para gestionar el flujo completo de un restaurante pequeño o mediano: apertura de mesas, toma de pedidos, facturación flexible y cierre del día con reporte de ventas.

El sistema se construye como un **archivo HTML single-file** (sin build step, sin servidor), desplegable directamente en cualquier hosting estático o dispositivo local (iPad, tablet, computador de sala). La interactividad reactiva la maneja Alpine.js; los estilos, Tailwind CDN; y los íconos, Lucide.

> **Principio rector:** todo lo que se puede resolver en el cliente, se resuelve en el cliente. No se depende de un backend externo en el MVP. La persistencia es `localStorage` / `IndexedDB` hasta que el negocio exija migrar a una base de datos real.

---

## 02 — Alcance

### Qué entra y qué no

#### ✅ En scope (MVP)

- [x] Mapa de mesas (lista + estado libre/ocupado)
- [x] Apertura y asignación de orden por mesa
- [x] Catálogo de productos (CRUD) con categorías
- [x] Agregar ítems de menú a una orden abierta
- [x] Ítems manuales: descripción libre + precio
- [x] Facturación: cálculo de total + ticket imprimible
- [x] Cambio de mesa (reasignar orden)
- [x] Cierre diario: total ventas + lista transacciones
- [x] Responsive: tablet ≥ 768px + desktop
- [x] Persistencia local (`localStorage`)

#### ❌ Out of scope (MVP)

- [ ] Backend / base de datos real (PostgreSQL, Supabase…)
- [ ] Autenticación y roles de usuario
- [ ] Integración con impresora térmica directa
- [ ] Inventario con control de stock
- [ ] Comandas en cocina (Kitchen Display)
- [ ] Facturación electrónica (DIAN)
- [ ] Multi-restaurante / multi-sucursal
- [ ] App nativa iOS / Android

---

## 03 — Stack tecnológico

### Tecnologías elegidas

El stack es deliberadamente ligero: **zero build step, zero dependencias de pago**. Todo funciona abriendo el archivo HTML en un navegador.

| Tecnología | Descripción |
|---|---|
| **HTML5 semántico** | Estructura y SEO base |
| **Tailwind CSS CDN** | Utilidades + design tokens |
| **Alpine.js v3** | Reactividad declarativa (~15 KB) |
| **Lucide Icons** | SVG íconos vía CDN |
| **Fraunces** | Display serif (Google Fonts) |
| **DM Sans** | Body / UI (Google Fonts) |
| **localStorage** | Persistencia MVP |
| **window.print()** | Ticket imprimible |

### ¿Por qué sin React ni framework?

El restaurante opera con una tablet o un computador antiguo. Un bundle de React puede pesar 200–400 KB y requerir configuración. Este POS abre en menos de 1 segundo desde un archivo local y funciona sin conexión a internet. Alpine.js (~15 KB gzip) cubre el 100% de la interactividad requerida por un POS básico.

**Regla de oro:** si una interacción se puede expresar con `x-data`, `x-show` o `x-model`, se usa Alpine. Si se necesita más complejidad de estado, se evalúa pasar a React + Vite en la Fase 5.

---

## 04 — Arquitectura

### Capas y principios

La aplicación es un **monolito intencional**: un único archivo HTML con capas lógicas bien delimitadas por comentarios bloque. La separación es conceptual, no de archivos.

| Capa | Responsabilidad | Implementación | Prohibido |
|------|----------------|----------------|-----------|
| **Config** | Design tokens, Tailwind config, constantes de negocio | `<script> tailwind.config` + `:root` | Lógica de UI |
| **Store** | Estado global reactivo (mesas, pedidos, catálogo, cierre) | `Alpine.store('pos', {...})` | Renderizado directo |
| **Components** | Bloques HTML reutilizables con `x-data` local | Secciones comentadas en `<body>` | Acceso directo a DOM sin Alpine |
| **Services** | Lógica de negocio pura: calcular totales, persistir, formatear | Funciones JS en `<script>` al final | Manipulación del DOM |
| **Persistence** | Leer / escribir en `localStorage` | `PosStore.load()` / `PosStore.save()` | Lógica de presentación |

### Principios de diseño

- **Separación Store / UI** — El Alpine store es la única fuente de verdad. Los componentes sólo leen del store y llaman métodos del store. Nunca modifican el estado directamente desde el template.

- **Comentarios bloque como módulos** — Cada sección está delimitada por `<!-- ═══ NOMBRE ═══ -->`. Permite navegar 1.000+ líneas de HTML en < 5 segundos con <kbd>Ctrl+F</kbd>.

- **Design tokens únicos** — Todos los colores viven en `:root` CSS variables Y en `tailwind.config`. Cambiar la paleta son 12 líneas, el resultado se propaga a todo el archivo.

---

## 05 — Sistema de diseño

### Tokens, tipografía y paleta

#### Paleta de colores

| Color | Hex | Uso |
|-------|-----|-----|
| **Ember** | `#C0392B` | Acción principal · alertas |
| **Gold** | `#B7860B` | Totales · destacados premium |
| **Jungle** | `#1A5C38` | Confirmación · mesa libre |
| **Ink** | `#1C1C1E` | Texto base · estructura |

#### Tipografía

| Fuente | Rol |
|--------|-----|
| **Fraunces** | Display — Títulos, encabezados, totales grandes |
| **DM Sans** | Body — UI, etiquetas, descripciones |

#### Escala tipográfica

| Token | Tamaño | Peso | Uso |
|-------|--------|------|-----|
| `text-display` | 2.8–3.4 rem | 700 | Total del ticket, mesas grandes |
| `text-h2` | 1.5 rem | 600 | Nombre de sección o pantalla |
| `text-h3` | 1.1 rem | 600 | Card header, nombre de producto |
| `text-body` | 0.9375 rem (15px) | 400 | Texto general |
| `text-label` | 0.75 rem (12px) | 700 | Tags, etiquetas de categoría |
| `text-micro` | 0.6875 rem (11px) | 700 | Metadatos, timestamps, leyendas |

#### CSS Custom Properties — `:root`

```css
:root {
  /* ── Brand ── */
  --ember:   #C0392B;   /* Acción principal, facturar, alertas        */
  --ember-l: #E8503E;   /* Hover del ember                            */
  --gold:    #B7860B;   /* Totales, subtotales, premium               */
  --gold-l:  #D4A017;   /* Hover del gold                             */
  --jungle:  #1A5C38;   /* Mesa libre, confirmación, éxito            */
  --jungle-l:#23804E;   /* Hover del jungle                           */

  /* ── Neutros ── */
  --ink:     #1C1C1E;   /* Texto base                                 */
  --ink-5:   #3A3A3C;   /* Texto secundario                           */
  --ink-3:   #636366;   /* Texto muted / subtítulos                   */
  --ink-1:   #AEAEB2;   /* Placeholders, metadatos                    */
  --surface: #F9F9FB;   /* Fondo de página                            */
  --card:    #FFFFFF;   /* Cards y paneles                            */
}
```

---

## 06 — Entidades del dominio

### Schema de datos

En el MVP, el estado vive en el Alpine store (memoria) y se persiste en `localStorage` como JSON. Las entidades están diseñadas para migrar a PostgreSQL sin cambios de estructura.

#### Mesa

| Campo | Tipo |
|-------|------|
| `id` | **PK** |
| `numero` | `number` |
| `capacidad` | `number` |
| `estado` | `'libre' \| 'ocupada'` |
| `ordenId` | `string \| null` |

#### Producto

| Campo | Tipo |
|-------|------|
| `id` | **PK** |
| `nombre` | `string` |
| `precio` | `number` |
| `categoria` | `'ejecutivos' \| 'carta' \| 'bebidas'` |
| `activo` | `boolean` |

#### Orden

| Campo | Tipo |
|-------|------|
| `id` | **PK** |
| `mesaId` | `string` |
| `items` | `OrdenItem[]` |
| `total` | `number (calculado)` |
| `estado` | `'abierta' \| 'cerrada'` |
| `fechaCreacion` | `ISO string` |
| `fechaCierre` | `ISO string \| null` |

#### OrdenItem

| Campo | Tipo |
|-------|------|
| `id` | **PK** |
| `productoId` | `string \| null` |
| `descripcion` | `string` |
| `precio` | `number` |
| `cantidad` | `number` |
| `esManual` | `boolean` |

#### CierreDiario

| Campo | Tipo |
|-------|------|
| `id` | **PK** |
| `fecha` | `ISO date string` |
| `totalVentas` | `number` |
| `totalOrdenes` | `number` |
| `transacciones` | `Orden[]` |
| `creadoEn` | `ISO string` |

### Alpine Store — estructura

```javascript
// Inicializado en <script> al final del <body>
Alpine.store('pos', {
  // Estado
  mesas:      [],          // Mesa[]
  productos:  [],          // Producto[]
  ordenes:    [],          // Orden[] (incluye cerradas del día)
  vistaActual:'mesas',     // 'mesas' | 'orden' | 'menu' | 'cierre'
  mesaActiva: null,        // Mesa | null

  // Getters calculados
  get mesaActivaOrden() { return this.ordenes.find(o => o.mesaId === this.mesaActiva?.id && o.estado === 'abierta') },
  get totalDia()        { return this.ordenes.filter(o => o.estado==='cerrada').reduce((s,o)=>s+o.total, 0) },

  // Acciones
  abrirMesa(mesa)       { /* ... */ },
  agregarItem(item)     { /* ... */ },
  quitarItem(itemId)    { /* ... */ },
  facturar()            { /* ... */ },
  cambiarMesa(mesaDest) { /* ... */ },
  cerrarDia()           { /* ... */ },

  // Persistencia
  save() { localStorage.setItem('pos_state', JSON.stringify({ mesas: this.mesas, productos: this.productos, ordenes: this.ordenes })) },
  load() { const s = localStorage.getItem('pos_state'); if(s) Object.assign(this, JSON.parse(s)) },
})
```

---

## 07 — Contrato de datos

### Operaciones del store (MVP local)

En el MVP no hay API HTTP. Las "operaciones" son métodos del Alpine store. Se documentan aquí con el mismo contrato que tendrían en un backend para facilitar la migración futura.

| Tipo | Operación | Descripción |
|------|-----------|-------------|
| `READ` | `store.mesas` | Lista todas las mesas con estado |
| `ACTION` | `store.abrirMesa(mesaId)` | Crea orden vacía, cambia estado mesa → ocupada |
| `ACTION` | `store.agregarItem({ productoId?, descripcion, precio, cantidad })` | Agrega ítem a la orden activa |
| `ACTION` | `store.quitarItem(itemId)` | Elimina ítem de la orden activa |
| `ACTION` | `store.facturar()` | Cierra orden, libera mesa, guarda en historial, imprime ticket |
| `ACTION` | `store.cambiarMesa(mesaDestId)` | Reasigna la orden activa a otra mesa |
| `ACTION` | `store.cerrarDia()` | Genera CierreDiario, limpia órdenes del día |
| `CRUD` | `store.productos` — CRUD completo | Crear, editar, desactivar productos del catálogo |

> **Migración a backend real:** cuando el restaurante crezca, cada método del store se reemplaza por un `fetch()` a un endpoint Express/Supabase con el mismo nombre de operación. El template HTML no cambia.

---

## 08 — Flujos principales

### Ciclo de vida de una mesa

#### Flujo A — Pedido completo

1. **Seleccionar mesa** — El mesero ve el mapa de mesas. Toca una libre (verde). Se marca como ocupada.
2. **Agregar ítems** — Navega entre categorías (Ejecutivos / Carta / Bebidas). Toca producto → se agrega a la orden. Puede cambiar cantidad o eliminar.
3. **Ítem manual (opcional)** — Si hay algo que no está en el catálogo, agrega descripción libre + precio. No requiere producto asociado.
4. **Ver resumen** — Panel derecho muestra ítems, subtotales y total. El total se calcula en tiempo real.
5. **Facturar** — Toca "Cobrar". Se genera el ticket (vista imprimible). La orden pasa a estado "cerrada". La mesa vuelve a "libre".

#### Flujo B — Cierre del día

1. **Revisar resumen** — El administrador va a la pantalla de Cierre. Ve el total del día, número de órdenes y lista de transacciones.
2. **Confirmar cierre** — Toca "Cerrar día". El sistema crea el registro `CierreDiario`, lo guarda en localStorage y limpia las órdenes del día activo.
3. **Imprimir o exportar** — Opcionalmente imprime el resumen del día o lo copia como texto para enviarlo por WhatsApp.

---

## 09 — Fases de desarrollo

### Roadmap

| Fase | Nombre | Duración |
|------|--------|----------|
| **1** (activa) | UI Kit & Design System | ~1 semana |
| 2 | Gestión de Menú | ~1 semana |
| 3 | Motor de Pedidos | ~1.5 semanas |
| 4 | Facturación & Ticket | ~1 semana |
| 5 | Cierre & Reportes | ~0.5 semanas |

### Detalle por fase

| Fase | Entregable | Criterio de aceptación |
|------|-----------|------------------------|
| 1 — UI Kit | Design tokens, tipografía, componentes base (botones, cards, badges, modales) | Todos los componentes renderizados con datos ficticios, responsive en tablet |
| 2 — Menú | CRUD de productos por categoría, Alpine store inicializado | Puedo agregar, editar y desactivar un producto. Los cambios persisten al recargar. |
| 3 — Pedidos | Mapa de mesas, apertura de orden, agregar/quitar ítems, ítem manual, cambio de mesa | Puedo abrir una mesa, agregar 3 productos y un ítem manual, ver el total correcto |
| 4 — Facturación | Ticket imprimible, cobro, orden → cerrada, mesa → libre | Al facturar, la impresión muestra todo el detalle y la mesa queda verde |
| 5 — Cierre | Pantalla de cierre diario, total, lista de órdenes, acción "Cerrar día" | El cierre del día muestra el total correcto y limpia el estado para el día siguiente |

---

## 10 — Decisiones fijas

### No negociables en el MVP

Estas decisiones están cerradas. Reabrirlas durante el MVP genera deuda técnica sin retorno.

| Área | Decisión | Razón |
|------|----------|-------|
| **Estructura** | Single-file HTML | Sin build, sin servidor, desplegable offline |
| **Estilos** | Tailwind CDN + CSS custom properties | Zero config, tokens centralizados en :root |
| **Reactividad** | Alpine.js v3 | 15 KB gzip, declarativo, sin compilación |
| **Íconos** | Lucide vía CDN | SVG consistente, activados con `lucide.createIcons()` |
| **Tipografía** | Fraunces + DM Sans | Display serif de personalidad + body legible y moderno |
| **Persistencia MVP** | localStorage (JSON) | Sin backend requerido, migrable a Supabase en Fase 6 |
| **Impresión** | `window.print()` + `@media print` | Compatible con cualquier impresora sin drivers especiales |
| **IDs** | `crypto.randomUUID()` | Nativo del browser, no requiere librería |
| **Categorías de menú** | Ejecutivos · Carta · Bebidas | Definidas por el restaurante, extensibles en la config |
| **Precio** | COP — sin decimales | El restaurante no maneja centavos |

---

## 11 — Estructura del HTML

El archivo principal (`pos.html`) sigue la misma convención del proyecto de referencia (FungiLab): secciones delimitadas por comentarios bloque navegables con <kbd>Ctrl+F</kbd>.

```
pos.html
│
├── <head>
│   ├── Meta tags + title
│   ├── Google Fonts (Fraunces + DM Sans)
│   ├── CDN: Tailwind · Alpine.js · Lucide
│   ├── tailwind.config {}          ← extensión de colores
│   └── <style>
│       ├── :root { CSS variables }
│       ├── Componentes custom (mesa-card, ticket, etc.)
│       └── @media print { reglas de ticket }
│
├── <body x-data="{ $store }">
│   ├── [S0] Nav / Header — logo + título del turno
│   ├── [S1] Vista Mesas — grid de tarjetas de mesa
│   ├── [S2] Vista Orden — panel izq (ítems) + panel der (catálogo)
│   ├── [S3] Modal Ítem Manual — descripción + precio libre
│   ├── [S4] Modal Cambio de Mesa — selector de destino
│   ├── [S5] Vista Ticket — layout imprimible
│   ├── [S6] Vista Menú Admin — CRUD de productos por categoría
│   └── [S7] Vista Cierre — totales del día + lista transacciones
│
└── <script>
    ├── Alpine.store('pos', { ... })   ← estado global
    ├── Helpers: formatCOP(), calcTotal(), buildTicket()
    ├── lucide.createIcons()
    └── store.load()                   ← rehidrata desde localStorage
```

> **Principio de navegación:** Solo una "vista" es visible a la vez. Las vistas se muestran / ocultan con `x-show="$store.pos.vistaActual === 'X'"`. No hay router, no hay SPA compleja. Alpine gestiona el estado de navegación.

---

## 12 — Componentes

### Librería de componentes

Cada componente es un bloque HTML auto-contenido con su propio `x-data` local (si lo necesita) y estilos inline o en `<style>`.

| Componente | Alpine state | Descripción | Fase |
|------------|-------------|-------------|------|
| `MesaCard` | `$store.pos` | Tarjeta de mesa con estado (libre/ocupada), número, y acción de apertura | F1 |
| `CatalogoGrid` | `x-data="{ categoria }"` | Grid de productos filtrados por categoría con tabs (Ejecutivos / Carta / Bebidas) | F2 |
| `OrdenPanel` | `$store.pos.mesaActivaOrden` | Lista de ítems de la orden activa con cantidades y precios. Total en tiempo real. | F3 |
| `ItemManualModal` | `x-data="{ desc:'', precio:0 }"` | Modal para agregar ítem sin producto asociado (descripción + precio libre) | F3 |
| `CambioMesaModal` | `x-data="{ mesaDest:null }"` | Modal con selector de mesa destino para reasignar la orden activa | F3 |
| `TicketView` | Props de la orden cerrada | Vista imprimible del ticket: logo, ítems, total, fecha/hora | F4 |
| `ProductoCRUD` | `x-data="{ editando:null }"` | Pantalla de administración de productos: lista, formulario inline, toggle activo | F2 |
| `CierreView` | `$store.pos.totalDia` | Pantalla de cierre: total vendido, número de órdenes, lista detallada, botón Cerrar día | F5 |

### Patrón de componente Alpine

```html
<!-- ═══════════════════════════════════════
     [S1] VISTA MESAS
══════════════════════════════════════════ -->
<section x-show="$store.pos.vistaActual === 'mesas'">
  <div class="grid grid-cols-3 gap-4 p-6">
    <template x-for="mesa in $store.pos.mesas" :key="mesa.id">
      <button
        class="mesa-card"
        :class="mesa.estado === 'libre' ? 'mesa-libre' : 'mesa-ocupada'"
        @click="$store.pos.abrirMesa(mesa)"
        :disabled="mesa.estado === 'ocupada'"
      >
        <span class="text-display" x-text="mesa.numero"></span>
        <span class="text-label" x-text="mesa.estado"></span>
      </button>
    </template>
  </div>
</section>
```

---

## 13 — Checklist MVP

### Criterios de lanzamiento

El POS está listo para uso real cuando todos estos puntos estén en verde.

#### Funcional

- [ ] Mapa de mesas refleja estado real (libre/ocupada)
- [ ] Abrir mesa crea una orden nueva automáticamente
- [ ] Agregar producto incrementa el total en tiempo real
- [ ] Ítem manual acepta descripción libre + precio
- [ ] Cambio de mesa funciona sin perder los ítems
- [ ] Facturar genera ticket y libera la mesa
- [ ] Cierre del día acumula todas las órdenes del turno
- [ ] Los datos persisten al recargar la página

#### Calidad

- [ ] Responsive en tablet 768px (iPad)
- [ ] Ticket imprimible sin estilos de navegación
- [ ] Precios en formato COP correcto (separador de miles)
- [ ] No hay errores en consola en Chrome / Safari
- [ ] Íconos Lucide renderizan correctamente
- [ ] Fonts Fraunces y DM Sans cargan
- [ ] Archivo < 500 KB sin imágenes externas
- [ ] Funciona offline (sin internet activo)

---

### Siguiente paso recomendado

Construir la **Fase 1 (UI Kit)**: crear el archivo `pos.html` con el sistema de diseño completo, componentes base y el Alpine store vacío. Validar que todo el sistema visual funciona antes de añadir lógica de negocio.