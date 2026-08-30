import { defineStore } from 'pinia'
import { ref } from 'vue'

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

  return { toast, mostrarToast }
})
