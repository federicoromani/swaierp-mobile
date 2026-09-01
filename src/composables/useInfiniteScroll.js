import { onMounted, onUnmounted, watch } from 'vue'

/**
 * Dispara `onLoadMore()` cuando el elemento sentinela (un <div> vacío al pie
 * de la lista) entra en el viewport, mientras `hasMore` sea true y no haya
 * ya una carga en curso (`loading`) — así no dispara cargas duplicadas si el
 * usuario se queda quieto justo en el borde.
 *
 * `sentinelRef` es un template ref (`ref(null)`) que puede pasar de null a
 * elemento y viceversa (ej. al cambiar de tab en ReportesView, la sección
 * completa se desmonta/remonta por el v-if/v-else) — el watch reconecta el
 * observer cada vez que eso pasa.
 *
 * @param {import('vue').Ref<HTMLElement|null>} sentinelRef
 * @param {() => void} onLoadMore
 * @param {{hasMore: import('vue').Ref<boolean>, loading: import('vue').Ref<boolean>}} opciones
 */
export function useInfiniteScroll(sentinelRef, onLoadMore, { hasMore, loading }) {
  let observer = null

  function conectar() {
    desconectar()
    if (!sentinelRef.value) return

    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore.value && !loading.value) {
          onLoadMore()
        }
      },
      // rootMargin: dispara un poco ANTES de que el sentinela sea visible
      // del todo, para que la carga ya esté en curso cuando el usuario llega
      // al final real de la lista (sensación de scroll "sin cortes").
      { rootMargin: '200px' }
    )
    observer.observe(sentinelRef.value)
  }

  function desconectar() {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  onMounted(conectar)
  onUnmounted(desconectar)
  watch(sentinelRef, conectar)
}
