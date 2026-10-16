import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const toast = ref(null)
  let temporizador = null

  function mostrarToast(mensaje, tipo = 'info', duracionMs = 3000) {
    toast.value = { mensaje, tipo }
    clearTimeout(temporizador)
    temporizador = setTimeout(() => {
      toast.value = null
    }, duracionMs)
  }

  // Estado de conexión real (no un "Conectado" fijo): el navegador avisa si
  // perdió la red (online/offline, ver App.vue), y apiClient avisa si un
  // pedido no llegó al servidor aunque haya red (Wi-Fi sin salida, backend
  // caído). Cualquier respuesta del servidor, aunque sea un error, cuenta
  // como alcanzable.
  const navegadorOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine !== false)
  const servidorAlcanzable = ref(true)

  // null = todo bien; si no, el texto a mostrar.
  const problemaConexion = computed(() => {
    if (!navegadorOnline.value) return 'Sin conexión'
    if (!servidorAlcanzable.value) return 'Sin conexión con el servidor'
    return null
  })

  function setNavegadorOnline(online) {
    navegadorOnline.value = online
    // Al volver la red no hay forma de saber si el servidor responde hasta el
    // próximo pedido: se asume que sí, y si falla apiClient lo vuelve a marcar.
    if (online) servidorAlcanzable.value = true
  }

  function setServidorAlcanzable(alcanzable) {
    servidorAlcanzable.value = alcanzable
  }

  return {
    toast,
    mostrarToast,
    navegadorOnline,
    servidorAlcanzable,
    problemaConexion,
    setNavegadorOnline,
    setServidorAlcanzable,
  }
})
