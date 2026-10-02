/* Resplandor Restaurante — el carrusel de «Promociones de la semana» (#promociones de index.html).
 *
 * Es solo la animación: los afiches, sus textos alternativos y el marcado son estáticos (el alt
 * sale de assets/img/promos/promos.json). Sin librerías, sin Alpine, sin red: si este script no
 * carga, la sección sigue siendo una tira que se desliza con el dedo, el teclado o la rueda.
 *
 * Lo que hace (pedido de Yonatan, 2026-10-01):
 *   - Marca el afiche de HOY («Hoy», anillo y aria-current) y deja la tira ahí al cargar. El día es
 *     el de Bogotá (America/Bogota): Colombia no tiene horario de verano, así que es UTC−5 fijo y
 *     no hace falta Intl ni la zona del equipo de quien mira.
 *   - Avance automático LENTO: un afiche cada 5 s, con desplazamiento suave hasta el siguiente
 *     punto de scroll-snap; al final vuelve al primero. Los afiches de más adelante se piden
 *     con un afiche de anticipación (loading="lazy" no basta dentro de una tira horizontal).
 *   - Se PAUSA solo al pasar el mouse, al enfocar con el teclado, al tocar (y espera unos
 *     segundos después de soltar), con la pestaña oculta y cuando la sección no se ve; y con el
 *     botón de pausa, hasta que la persona lo vuelva a pulsar (WCAG 2.2.2: todo lo que se mueve
 *     más de 5 s se puede detener).
 *   - Con prefers-reduced-motion: reduce NO hay movimiento automático ni suave: la tira solo se
 *     mueve cuando la persona lo pide, y el botón de pausa se esconde (no hay nada que pausar).
 *   - Botones anterior / siguiente (44 px) que dan la vuelta al llegar al extremo. El arrastre
 *     táctil, la rueda y las flechas del teclado son los nativos de un contenedor con
 *     overflow-x y scroll-snap.
 *
 * En el navegador deja `globalThis.RESPLANDOR_PROMOS = { diaDeHoy, INTERVALO_MS }` (para las
 * pruebas); en Node exporta lo mismo con module.exports y no toca ningún DOM.
 */
(() => {
  'use strict';

  const INTERVALO_MS = 5000; // cuánto se queda cada afiche antes de avanzar (data-promos-intervalo en la sección lo cambia)
  const TRAS_TOQUE = 1.6; // tras soltar el dedo, el avance espera 1,6 intervalos (8 s con los 5 s de siempre)
  const BOGOTA_MS = -5 * 60 * 60 * 1000; // UTC−5, sin horario de verano

  /** Día de la semana en Bogotá a un instante dado (ms de época): 1 = lunes … 7 = domingo. */
  function diaDeHoy(ahoraMs) {
    const d = new Date(ahoraMs + BOGOTA_MS).getUTCDay(); // 0 = domingo
    return d === 0 ? 7 : d;
  }

  const API = Object.freeze({ diaDeHoy, INTERVALO_MS });
  globalThis.RESPLANDOR_PROMOS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof document === 'undefined') return;

  function iniciar() {
    const raiz = document.querySelector('[data-promos]');
    if (!raiz) return;
    const pista = raiz.querySelector('[data-promos-pista]');
    const zona = raiz.querySelector('[data-promos-zona]') || raiz;
    const diapos = pista ? Array.from(pista.querySelectorAll('[data-promos-diapo]')) : [];
    if (!pista || diapos.length < 2) return;

    const controles = raiz.querySelector('[data-promos-controles]');
    const boton = (accion) => raiz.querySelector(`[data-promos-accion="${accion}"]`);
    const bAnterior = boton('anterior');
    const bSiguiente = boton('siguiente');
    const bPausa = boton('pausa');
    const usoPausa = bPausa && bPausa.querySelector('use');
    const reducido = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false, addEventListener() {} };

    // Por qué se detiene el avance automático. Basta una para que no avance.
    let pausadoPorPersona = false; // el botón de pausa
    let encima = false; // el mouse está sobre la tira o sus botones
    let conFoco = false; // el teclado está dentro (foco visible)
    let tocando = false; // un dedo está sobre la tira
    let oculta = !!document.hidden; // la pestaña no se ve
    let enPantalla = !('IntersectionObserver' in window); // sin IO, se asume que se ve
    let temporizador = 0;
    let ultimaInteraccion = 0;

    // ── posiciones ──
    // El padding de la tira (el «sangrado» de móvil) coincide con su scroll-padding, así que el afiche i
    // queda alineado a su borde cuando scrollLeft = i × paso (landing.css, .promos-pista).
    const paso = () => diapos[1].offsetLeft - diapos[0].offsetLeft; // ancho de un afiche + el hueco
    const maximo = () => Math.max(0, pista.scrollWidth - pista.clientWidth);
    const alInicio = () => pista.scrollLeft <= 2;
    const alFinal = () => pista.scrollLeft >= maximo() - 2;
    const ir = (px, animar) => {
      const left = Math.min(Math.max(0, px), maximo());
      pista.scrollTo({ left, behavior: animar && !reducido.matches ? 'smooth' : 'auto' });
    };

    // Los afiches están en loading="lazy": dentro de una tira horizontal el navegador los pide cuando
    // ya entran, y el avance automático los dejaría llegar en negro. Se piden uno antes (y, al verse la
    // sección por primera vez, los dos que vienen: no se piden con la página recién cargada, que
    // todavía está bajando el hero).
    function precargar(desde, cuantos) {
      for (let k = 0; k < cuantos; k++) {
        const img = diapos[Math.min(diapos.length - 1, Math.max(0, desde + k))].querySelector('img');
        if (img && img.loading === 'lazy') img.loading = 'eager';
      }
    }
    const indiceCercano = () => Math.round(pista.scrollLeft / paso());

    function siguiente(animar) {
      if (alFinal()) {
        ir(0, animar);
        precargar(0, 2);
      } else {
        const i = Math.floor((pista.scrollLeft + 1) / paso()) + 1;
        precargar(i, 2);
        ir(i * paso(), animar);
      }
    }
    function anterior(animar) {
      if (alInicio()) {
        ir(maximo(), animar);
        precargar(diapos.length - 2, 2);
      } else {
        const i = Math.ceil((pista.scrollLeft - 1) / paso()) - 1;
        precargar(i, 2);
        ir(i * paso(), animar);
      }
    }

    // ── avance automático ──
    // El intervalo se lee cada vez: es el atributo data-promos-intervalo de la sección (ms) o 5 s.
    // Existe para afinar la lentitud sin tocar el código y para que las pruebas no esperen 5 s por afiche.
    const intervalo = () => {
      const ms = Number(raiz.dataset.promosIntervalo);
      return ms > 0 ? ms : INTERVALO_MS;
    };
    const debeCorrer = () => !reducido.matches && !pausadoPorPersona && !encima && !conFoco && !tocando && !oculta && enPantalla;
    function programar(espera) {
      clearTimeout(temporizador);
      temporizador = 0;
      // Con «reducir movimiento» no hay avance automático: nada que pausar, así que el botón se esconde.
      // Se aplica aquí (y no solo en el evento «change») para que el botón siempre refleje la preferencia
      // actual, aunque el navegador tarde en avisar del cambio.
      if (bPausa) bPausa.hidden = reducido.matches;
      if (debeCorrer()) temporizador = setTimeout(avanzar, espera == null ? intervalo() : espera);
    }
    function avanzar() {
      temporizador = 0;
      // Si la persona acaba de mover la tira (rueda, teclado, inercia del dedo), no se le atraviesa.
      const reciente = Date.now() - ultimaInteraccion;
      const margen = (intervalo() * TRAS_TOQUE) / 2;
      if (reciente < margen) return programar(margen - reciente + 50);
      siguiente(true);
      programar();
    }
    const tocoLaTira = () => { ultimaInteraccion = Date.now(); };

    // ── botón de pausa ──
    function pintarPausa() {
      if (!bPausa) return;
      const texto = pausadoPorPersona ? 'Reanudar el desplazamiento automático' : 'Pausar el desplazamiento automático';
      bPausa.setAttribute('aria-label', texto);
      bPausa.setAttribute('title', texto);
      if (usoPausa) usoPausa.setAttribute('href', pausadoPorPersona ? '#i-play' : '#i-pause');
    }

    // ── el afiche de hoy ──
    const hoy = diaDeHoy(Date.now());
    const indiceHoy = diapos.findIndex((d) => Number(d.dataset.dia) === hoy);
    if (indiceHoy !== -1) {
      const d = diapos[indiceHoy];
      d.classList.add('es-hoy');
      d.setAttribute('aria-current', 'date');
      const marca = d.querySelector('[data-promos-hoy]');
      if (marca) marca.hidden = false;
      ir(indiceHoy * paso(), false); // sin animar: la tira ya nace en el afiche de hoy
    }

    // ── eventos ──
    if (controles) controles.hidden = false;
    if (bAnterior) bAnterior.addEventListener('click', () => { anterior(true); programar(); });
    if (bSiguiente) bSiguiente.addEventListener('click', () => { siguiente(true); programar(); });
    if (bPausa) {
      bPausa.addEventListener('click', () => {
        pausadoPorPersona = !pausadoPorPersona;
        pintarPausa();
        programar();
      });
    }

    zona.addEventListener('mouseenter', () => { encima = true; programar(); });
    zona.addEventListener('mouseleave', () => { encima = false; programar(); });
    zona.addEventListener('focusin', (e) => {
      // Solo el foco del teclado detiene el avance: un clic con el mouse deja el foco en el botón
      // y, si pausara, la tira se quedaría quieta para siempre después de moverse el mouse.
      try { conFoco = e.target.matches(':focus-visible'); } catch (err) { conFoco = true; }
      programar();
    });
    zona.addEventListener('focusout', (e) => {
      if (!zona.contains(e.relatedTarget)) { conFoco = false; programar(); }
    });
    pista.addEventListener('touchstart', () => { tocando = true; tocoLaTira(); programar(); }, { passive: true });
    const soltar = () => { tocando = false; tocoLaTira(); programar(intervalo() * TRAS_TOQUE); };
    pista.addEventListener('touchend', soltar, { passive: true });
    pista.addEventListener('touchcancel', soltar, { passive: true });
    pista.addEventListener('wheel', tocoLaTira, { passive: true });
    pista.addEventListener('keydown', tocoLaTira);
    document.addEventListener('visibilitychange', () => { oculta = !!document.hidden; programar(); });
    let precargadoAlVerse = false;
    const alVerse = () => {
      if (precargadoAlVerse) return;
      precargadoAlVerse = true;
      precargar(indiceCercano(), 3);
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entradas) => {
        enPantalla = entradas[entradas.length - 1].isIntersecting;
        if (enPantalla) alVerse();
        programar();
      }, { threshold: 0.25 }).observe(raiz);
    } else {
      alVerse();
    }
    const alCambiarMovimiento = () => programar();
    if (reducido.addEventListener) reducido.addEventListener('change', alCambiarMovimiento);
    else if (reducido.addListener) reducido.addListener(alCambiarMovimiento);

    pintarPausa();
    programar();
    raiz.setAttribute('data-promos-listo', '');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
