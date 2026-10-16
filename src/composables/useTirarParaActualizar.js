import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

/**
 * "Tirar para actualizar": el body tiene overscroll-behavior-y: contain (para
 * que el navegador no recargue la PWA entera por un tirón accidental), así
 * que el gesto se implementa acá, solo en las pantallas que lo usan. Arranca
 * únicamente con la página scrolleada arriba de todo.
 *
 * @param {() => Promise<unknown>} alActualizar
 */
export function useTirarParaActualizar(alActualizar, { umbral = 60 } = {}) {
  const distancia = ref(0)
  const actualizando = ref(false)
  let inicioY = null

  function alTocar(e) {
    if (actualizando.value || window.scrollY > 0 || e.touches.length !== 1) return
    inicioY = e.touches[0].clientY
  }

  function alMover(e) {
    if (inicioY === null) return
    const dy = e.touches[0].clientY - inicioY
    if (dy <= 0) {
      distancia.value = 0
      return
    }
    // Resistencia: el indicador baja la mitad de lo que se tira, con tope.
    distancia.value = Math.min(dy / 2, umbral * 1.5)
  }

  async function alSoltar() {
    if (inicioY === null) return
    inicioY = null
    const disparar = distancia.value >= umbral
    distancia.value = 0
    if (disparar) await actualizar()
  }

  async function actualizar() {
    if (actualizando.value) return
    actualizando.value = true
    try {
      await alActualizar()
    } finally {
      actualizando.value = false
    }
  }

  onMounted(() => {
    window.addEventListener('touchstart', alTocar, { passive: true })
    window.addEventListener('touchmove', alMover, { passive: true })
    window.addEventListener('touchend', alSoltar)
    window.addEventListener('touchcancel', alSoltar)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('touchstart', alTocar)
    window.removeEventListener('touchmove', alMover)
    window.removeEventListener('touchend', alSoltar)
    window.removeEventListener('touchcancel', alSoltar)
  })

  return { distancia, actualizando, listo: computed(() => distancia.value >= umbral), actualizar }
}
