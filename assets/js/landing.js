/* Resplandor Restaurante — lógica Alpine de la landing: el store de la solicitud, la
 * carta y el menú de la semana en vivo, y la aparición sutil al hacer scroll.
 *
 * Nada de lógica de negocio acá: `armado` llama a RESPLANDOR_SOLICITUD.armarSolicitud;
 * la carta y el menú salen de RESPLANDOR_VIVO. Este archivo solo conecta esos dos con
 * Alpine y el <dialog>.
 *
 * Corre como <script defer>, después de local.js, solicitud.js y vivo.js, y antes de
 * agentes.js y Alpine (cdn). Todo se registra en 'alpine:init' (antes de que Alpine
 * pinte nada), como pide Alpine.
 */
(() => {
  'use strict';

  // ───────────────────────── store('solicitud') ─────────────────────────
  // Contrato exacto que consume la landing (el <dialog id="solicitud">, sus tarjetas
  // «Cotizar» y el CTA «Reservar»):
  //   $store.solicitud.datos                — el formulario (x-model de cada campo)
  //   $store.solicitud.armado                — { datos, mensaje, enlace, avisos } (getter)
  //   $store.solicitud.abrir(tipo?)          — showModal(); si viene `tipo`, lo fija
  //   $store.solicitud.cerrar()              — close() + devuelve el foco a quien abrió
  //   $store.solicitud.reiniciar()           — limpia el formulario a los valores iniciales
  // El botón «Abrir WhatsApp» del <dialog> apunta a `$store.solicitud.armado.enlace`
  // (target="_blank" rel="noopener") — la persona lo abre y lo manda; nada acá llama a
  // wa.me por su cuenta.

  function datosIniciales() {
    return { tipo: '', fecha: '', hora: '', personas: '', nombre: '', nota: '', entrega: 'recoger', direccion: '', frecuencia: 'unica' };
  }

  function elementoDelDialogo() {
    return document.getElementById('solicitud');
  }

  const storeSolicitud = {
    datos: datosIniciales(),
    _ultimoFoco: null,

    // Entrega/dirección/frecuencia solo tienen sentido para el almuerzo programado: se
    // pasan a armarSolicitud solo cuando el tipo elegido es «almuerzo». Así el valor por
    // defecto del formulario (entrega:'recoger', que siempre está ahí) o uno que quedó de
    // una elección anterior de almuerzo nunca llegan a armarSolicitud para una reserva o
    // una celebración — ni falso aviso, ni dato viejo colgando.
    get armado() {
      const d = this.datos;
      const entrada = d.tipo === 'almuerzo' ? d : { ...d, entrega: undefined, direccion: undefined, frecuencia: undefined };
      return globalThis.RESPLANDOR_SOLICITUD.armarSolicitud(entrada);
    },

    // Guarda qué elemento tenía el foco (el botón que se tocó) para devolvérselo al
    // cerrar — así el foco nunca se pierde en el fondo de la página.
    abrir(tipo) {
      this._ultimoFoco = (typeof document !== 'undefined' && document.activeElement) || null;
      if (tipo) this.datos.tipo = tipo;
      const dialogo = elementoDelDialogo();
      if (dialogo && typeof dialogo.showModal === 'function' && !dialogo.open) dialogo.showModal();
    },

    // Segura de llamar más de una vez (p. ej. desde el botón «Cerrar» y también desde el
    // evento nativo `close` del <dialog>, que dispara Escape): si ya está cerrado, no
    // vuelve a llamar close(), pero siempre intenta devolver el foco.
    cerrar() {
      const dialogo = elementoDelDialogo();
      if (dialogo && typeof dialogo.close === 'function' && dialogo.open) dialogo.close();
      const foco = this._ultimoFoco;
      this._ultimoFoco = null;
      if (foco && typeof foco.focus === 'function' && (typeof document === 'undefined' || document.contains(foco))) foco.focus();
    },

    reiniciar() {
      this.datos = datosIniciales();
    },
  };

  // ───────────────────────── data('cartaVivo') ─────────────────────────
  // Contrato:
  //   estado                — 'cargando' | 'error' | 'listo'
  //   error                  — mensaje en español si estado === 'error'
  //   categorias             — [{ id, nombre, items: [{nombre, precio, precioTexto, descripcion}] }]
  //   activa                 — id de la categoría de la pestaña activa
  //   activar(id)            — cambia la pestaña activa
  //   items                  — (getter) los platos de la categoría activa
  //   recargar()             — reintenta la carga en vivo
  //   pesos(n)               — formato "$ 23.000" (es-CO), igual que carta.html

  const pesos = (n) => '$ ' + Number(n || 0).toLocaleString('es-CO');

  function slug(s) {
    return String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function agruparCarta(filas) {
    const porCategoria = new Map();
    for (const f of filas) {
      const nombre = f.categoria || 'Otros';
      const id = slug(nombre) || 'otros';
      if (!porCategoria.has(id)) porCategoria.set(id, { id, nombre, items: [] });
      porCategoria.get(id).items.push({ nombre: f.nombre, precio: f.precio, precioTexto: pesos(f.precio), descripcion: f.descripcion });
    }
    return [...porCategoria.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function cartaVivo() {
    return {
      estado: 'cargando',
      error: '',
      categorias: [],
      activa: '',

      async init() {
        await this.recargar();
      },

      async recargar() {
        this.estado = 'cargando';
        this.error = '';
        try {
          const filas = await globalThis.RESPLANDOR_VIVO.leerCarta();
          this.categorias = agruparCarta(filas);
          this.activa = this.categorias[0]?.id || '';
          this.estado = 'listo';
        } catch (err) {
          this.error = (err && err.message) || String(err);
          this.estado = 'error';
        }
      },

      activar(id) {
        this.activa = id;
      },

      get items() {
        return (this.categorias.find((c) => c.id === this.activa) || {}).items || [];
      },

      pesos,
    };
  }

  // ───────────────────────── data('menuSemana') ─────────────────────────
  // Contrato:
  //   estado                 — 'cargando' | 'error' | 'listo'
  //   error                   — mensaje en español si estado === 'error'
  //   semana                  — lunes ISO (AAAA-MM-DD) de la semana mostrada
  //   dias                    — [{ dia, nombre, fecha, esHoy, opciones: [{opcion, etiqueta,
  //                              principal, sopa, guarnicion, ensalada, jugo, fijo}] }]
  //   hoy                     — (getter) el día de `dias` con esHoy === true, o null
  //   recargar()              — reintenta la carga en vivo

  const NOMBRES_DIA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  function agruparMenu(semana, filas) {
    const lunesActual = globalThis.RESPLANDOR_VIVO.lunesDe(new Date());
    const hoyNumero = (() => {
      if (semana !== lunesActual) return null;
      // Hora de Colombia (America/Bogota), NUNCA la del navegador de quien mira la
      // página: un visitante en Madrid a la 01:00 de su martes está viendo el lunes
      // 18:00 en Bogotá, y "hoy" tiene que marcar ese lunes, no el martes local.
      const dow = globalThis.RESPLANDOR_VIVO.diaSemanaDe(new Date());
      return dow >= 1 && dow <= 6 ? dow : null;
    })();
    const porDia = new Map();
    for (const f of filas) {
      if (!porDia.has(f.dia)) porDia.set(f.dia, []);
      porDia.get(f.dia).push({ opcion: f.opcion, etiqueta: f.etiqueta, principal: f.principal, sopa: f.sopa, guarnicion: f.guarnicion, ensalada: f.ensalada, jugo: f.jugo, fijo: f.fijo });
    }
    const dias = [];
    for (let dia = 1; dia <= 6; dia++) {
      if (!porDia.has(dia)) continue;
      const inicio = new Date(`${semana}T00:00:00`);
      inicio.setDate(inicio.getDate() + (dia - 1));
      dias.push({
        dia,
        nombre: NOMBRES_DIA[dia],
        fecha: inicio,
        esHoy: dia === hoyNumero,
        opciones: porDia.get(dia).sort((a, b) => a.opcion - b.opcion),
      });
    }
    return dias;
  }

  function menuSemana() {
    return {
      estado: 'cargando',
      error: '',
      semana: '',
      dias: [],

      async init() {
        await this.recargar();
      },

      async recargar() {
        this.estado = 'cargando';
        this.error = '';
        try {
          const { semana, dias } = await globalThis.RESPLANDOR_VIVO.leerMenuSemana();
          this.semana = semana;
          this.dias = agruparMenu(semana, dias);
          this.estado = 'listo';
        } catch (err) {
          this.error = (err && err.message) || String(err);
          this.estado = 'error';
        }
      },

      get hoy() {
        return this.dias.find((d) => d.esHoy) || null;
      },
    };
  }

  document.addEventListener('alpine:init', () => {
    Alpine.store('solicitud', storeSolicitud);
    Alpine.data('cartaVivo', cartaVivo);
    Alpine.data('menuSemana', menuSemana);
  });

  // ───────────────────────── aparición al hacer scroll ─────────────────────────
  // Contrato: cualquier elemento con el atributo `data-aparecer` empieza oculto (lo
  // define assets/css/landing.css) y recibe la clase `en-vista` cuando entra en el
  // viewport; con `prefers-reduced-motion: reduce` (o sin IntersectionObserver) aparece
  // de una, sin animación. Este script no depende de Alpine: corre solo con el DOM listo.
  function iniciarAparicion() {
    const elementos = document.querySelectorAll('[data-aparecer]');
    if (!elementos.length) return;
    const reducirMovimiento = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducirMovimiento || typeof IntersectionObserver === 'undefined') {
      elementos.forEach((el) => el.classList.add('en-vista'));
      return;
    }
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) continue;
          entrada.target.classList.add('en-vista');
          observador.unobserve(entrada.target);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    );
    elementos.forEach((el) => observador.observe(el));
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarAparicion);
    else iniciarAparicion();
  }
})();
