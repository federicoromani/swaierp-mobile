import { ref, onMounted, onBeforeUnmount } from 'vue'

// Cuánto tiene que achicarse el viewport para considerarlo el teclado y no,
// p. ej., la barra de direcciones del navegador al ocultarse/mostrarse.
const UMBRAL_PX = 150

const TIPOS_SIN_TECLADO = new Set(['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color', 'image', 'hidden'])

function abreTeclado(el) {
  if (!el) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return !el.readOnly
  if (el.tagName === 'INPUT') return !el.readOnly && !TIPOS_SIN_TECLADO.has(el.type)
  return false
}

function medir() {
  const vv = window.visualViewport
  return vv ? { alto: vv.height, ancho: vv.width } : { alto: window.innerHeight, ancho: window.innerWidth }
}

/**
 * true mientras el teclado virtual está abierto. Combina las dos señales
 * porque ninguna alcanza sola:
 *   - foco en un campo editable: en Android, cerrar el teclado con "atrás"
 *     no le saca el foco al input.
 *   - viewport achicado: también pasa al ocultarse la barra de direcciones.
 * En desktop el viewport no se achica al enfocar, así que nunca da true.
 */
export function useTecladoVirtual() {
  const abierto = ref(false)
  let alturaBase = 0
  let anchoBase = 0
  let pendiente = null

  function evaluar() {
    const { alto, ancho } = medir()
    // El teclado no cambia el ancho: si cambió es rotación o resize de
    // ventana, y la altura de referencia se toma de nuevo.
    if (ancho !== anchoBase) {
      anchoBase = ancho
      alturaBase = alto
    } else if (alto > alturaBase) {
      alturaBase = alto
    }
    abierto.value = abreTeclado(document.activeElement) && alturaBase - alto > UMBRAL_PX
  }

  // En focusout, activeElement todavía no apunta al nuevo elemento.
  function alCambiarFoco() {
    clearTimeout(pendiente)
    pendiente = setTimeout(evaluar, 0)
  }

  const objetivoResize = () => window.visualViewport ?? window

  onMounted(() => {
    const { alto, ancho } = medir()
    alturaBase = alto
    anchoBase = ancho
    objetivoResize().addEventListener('resize', evaluar)
    document.addEventListener('focusin', alCambiarFoco)
    document.addEventListener('focusout', alCambiarFoco)
  })

  onBeforeUnmount(() => {
    clearTimeout(pendiente)
    objetivoResize().removeEventListener('resize', evaluar)
    document.removeEventListener('focusin', alCambiarFoco)
    document.removeEventListener('focusout', alCambiarFoco)
  })

  return abierto
}
