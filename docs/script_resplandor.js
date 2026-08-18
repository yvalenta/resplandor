document.addEventListener('alpine:init', () => {
  // Instancia de Supabase
  const supabaseUrl = 'TU_SUPABASE_URL'; // Reemplazar con URL real
  const supabaseKey = 'TU_SUPABASE_ANON_KEY'; // Reemplazar con KEY real
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

  Alpine.store('pos', {
    // ════════════════════════════════════════════════
    // 1. ESTADO DE LA UI (Referencias intactas para HTML)
    // ════════════════════════════════════════════════
    mesas: [],
    ordenes: [],
    productos: [],
    cierres: [],
    categorias: ['Entradas', 'Platos Fuertes', 'Bebidas', 'Licores', 'Postres'],
    
    // Estado transaccional (ejemplo)
    ordenActiva: null,
    conexion: 'conectando', // 'offline' | 'online' | 'sincronizando'
    modalProducto: false,
    productoForm: { nombre: '', precio: '', desc: '', categoria: '' },

    // ════════════════════════════════════════════════
    // 2. CICLO DE VIDA E INICIALIZACIÓN
    // ════════════════════════════════════════════════
    async init() {
      // 1. Arranque ultrarrápido desde localStorage (Offline-first)
      this.cargarCachéLocal();
      
      // 2. Reconciliación con la nube en segundo plano
      await this.sincronizarSupabase();
      
      // 3. Suscripción a cambios de otros dispositivos
      this.escucharEventosRealtime();
    },

    // ════════════════════════════════════════════════
    // 3. CAPA DE PERSISTENCIA (El "Cerebro" Offline-First)
    // ════════════════════════════════════════════════
    cargarCachéLocal() {
      this.mesas = JSON.parse(localStorage.getItem('pos_mesas')) || [];
      this.ordenes = JSON.parse(localStorage.getItem('pos_ordenes')) || [];
      this.productos = JSON.parse(localStorage.getItem('pos_productos')) || [];
    },

    guardarCachéLocal(entidad = 'todas') {
      if (entidad === 'mesas' || entidad === 'todas') localStorage.setItem('pos_mesas', JSON.stringify(this.mesas));
      if (entidad === 'ordenes' || entidad === 'todas') localStorage.setItem('pos_ordenes', JSON.stringify(this.ordenes));
      if (entidad === 'productos' || entidad === 'todas') localStorage.setItem('pos_productos', JSON.stringify(this.productos));
    },

    // ════════════════════════════════════════════════
    // 4. CAPA DE RED (Supabase Sync & Realtime)
    // ════════════════════════════════════════════════
    async sincronizarSupabase() {
      this.conexion = 'sincronizando';
      try {
        const [resMesas, resOrdenes, resProductos] = await Promise.all([
          supabase.from('mesas').select('*').order('id'),
          supabase.from('ordenes').select('*').eq('estado', 'abierta'), // Solo cacheamos órdenes vivas
          supabase.from('productos').select('*').eq('activo', true)
        ]);

        if (resMesas.data) this.mesas = resMesas.data;
        if (resOrdenes.data) this.ordenes = resOrdenes.data;
        // Si productos está vacío, puedes hacer que se auto-siembre aquí, o simplemente asignar la data
        if (resProductos.data && resProductos.data.length > 0) this.productos = resProductos.data;

        this.guardarCachéLocal();
        this.conexion = 'online';
      } catch (error) {
        console.warn('Supabase no disponible. Operando 100% offline.', error);
        this.conexion = 'offline';
      }
    },

    escucharEventosRealtime() {
      supabase.channel('pos_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mesas' }, payload => this.procesarCambioEnVivo('mesas', payload))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, payload => this.procesarCambioEnVivo('ordenes', payload))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, payload => this.procesarCambioEnVivo('productos', payload))
        .subscribe();
    },

    procesarCambioEnVivo(tabla, payload) {
      const { eventType, new: registroNuevo, old: registroViejo } = payload;
      let coleccion = this[tabla];

      if (eventType === 'INSERT' || eventType === 'UPDATE') {
        const idx = coleccion.findIndex(i => i.id === registroNuevo.id);
        if (idx > -1) coleccion[idx] = registroNuevo;
        else coleccion.push(registroNuevo);
      } else if (eventType === 'DELETE') {
        this[tabla] = coleccion.filter(i => i.id !== registroViejo.id);
      }
      
      this.guardarCachéLocal(tabla);
    },

    async pushASupabase(tabla, payload) {
      // Fire-and-forget: No bloqueamos la UI esperando la red
      if (this.conexion !== 'offline') {
        try { await supabase.from(tabla).upsert(payload); } 
        catch (e) { console.error(`Fallo al sincronizar ${tabla}`, e); }
      }
    },

    // ════════════════════════════════════════════════
    // 5. LÓGICA DE NEGOCIO (Mismas firmas, no rompe el HTML)
    // ════════════════════════════════════════════════
    abrirMesa(mesa) {
      const mesaTarget = this.mesas.find(m => m.id === mesa.id);
      if (!mesaTarget || mesaTarget.estado === 'ocupada') return;

      // 1. Mutación Optimista (UI Inmediata)
      mesaTarget.estado = 'ocupada';
      
      const nuevaOrden = {
        id: crypto.randomUUID(),
        mesa_id: mesa.id,
        estado: 'abierta',
        items: [],
        total: 0,
        abierta_en: new Date().toISOString()
      };
      this.ordenes.push(nuevaOrden);
      
      // 2. Guardar en memoria local
      this.guardarCachéLocal('mesas');
      this.guardarCachéLocal('ordenes');

      // 3. Sincronizar (en segundo plano)
      this.pushASupabase('mesas', { id: mesa.id, estado: 'ocupada', updated_at: new Date().toISOString() });
      this.pushASupabase('ordenes', nuevaOrden);
    },

    agregarItem(producto) {
      if (!this.ordenActiva) return;

      const orden = this.ordenes.find(o => o.id === this.ordenActiva.id);
      if (!orden) return;

      const itemExistente = orden.items.find(i => i.id === producto.id);
      if (itemExistente) {
        itemExistente.cantidad += 1;
      } else {
        orden.items.push({ 
          id: producto.id, 
          nombre: producto.nombre, 
          precio: producto.precio, 
          cantidad: 1 
        });
      }
      
      this.recalcularTotal(orden);
      this.guardarCachéLocal('ordenes');
      this.pushASupabase('ordenes', { id: orden.id, items: orden.items, total: orden.total, updated_at: new Date().toISOString() });
    },

    recalcularTotal(orden) {
      orden.total = orden.items.reduce((acc, item) => acc + (item.precio * item.cantidad), 0);
    },

    facturar() {
      if (!this.ordenActiva) return;
      
      const orden = this.ordenes.find(o => o.id === this.ordenActiva.id);
      const mesa = this.mesas.find(m => m.id === orden.mesa_id);
      
      // Mutación Optimista
      orden.estado = 'cerrada';
      orden.cerrada_en = new Date().toISOString();
      if (mesa) mesa.estado = 'libre';
      
      this.guardarCachéLocal('ordenes');
      this.guardarCachéLocal('mesas');

      // Sincronizar
      this.pushASupabase('ordenes', { id: orden.id, estado: 'cerrada', cerrada_en: orden.cerrada_en, updated_at: new Date().toISOString() });
      if (mesa) this.pushASupabase('mesas', { id: mesa.id, estado: 'libre', updated_at: new Date().toISOString() });
      
      this.ordenActiva = null;
    }

    // El resto de funciones (guardarProducto, etc.) siguen este mismo patrón de 3 pasos:
    // 1. Modificar this.estado
    // 2. this.guardarCachéLocal(tabla)
    // 3. this.pushASupabase(tabla, payload)
  });
});