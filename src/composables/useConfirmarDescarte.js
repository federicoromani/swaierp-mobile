import { ref, computed } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { useProductosStore } from '../stores/productos'

/**
 * Pregunta antes de perder un conteo o precio tipeado en ProductoCard y no
 * guardado: al elegir otro producto (siHayCambios) y al irse de la pantalla
 * (guard de ruta). La acción interrumpida se ejecuta si el usuario descarta.
 */
export function useConfirmarDescarte() {
  const productos = useProductosStore()
  const router = useRouter()
  const accionPendiente = ref(null)

  function siHayCambios(accion) {
    if (!productos.cambiosSinGuardar) return accion()
    accionPendiente.value = accion
  }

  function descartar() {
    const accion = accionPendiente.value
    accionPendiente.value = null
    productos.cambiosSinGuardar = false
    accion?.()
  }

  function seguirEditando() {
    accionPendiente.value = null
  }

  onBeforeRouteLeave((to) => {
    // Sesión vencida -> login: no se puede "seguir editando" sin sesión.
    if (!productos.cambiosSinGuardar || to.meta.requiresAuth === false) return true
    accionPendiente.value = () => router.push(to.fullPath)
    return false
  })

  return {
    preguntando: computed(() => accionPendiente.value !== null),
    siHayCambios,
    descartar,
    seguirEditando,
  }
}
