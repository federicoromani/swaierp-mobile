import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as reportesService from '../services/reportesService'

export const useReportesStore = defineStore('reportes', () => {
  const pendientes = ref({ items: [], total: 0 })
  const ajustes = ref({ items: [], total: 0 })
  const cargando = ref(false)

  async function cargarPendientes(offset = 0) {
    cargando.value = true
    try {
      const data = await reportesService.pendientesControlar(7, 20, offset)
      if (!data.success) return
      pendientes.value = {
        items: offset === 0 ? data.items : [...pendientes.value.items, ...data.items],
        // El backend solo recalcula "total" en la primera página (offset 0):
        // en "cargar más" mantenemos el que ya teníamos.
        total: offset === 0 ? data.total : pendientes.value.total,
      }
    } finally {
      cargando.value = false
    }
  }

  async function cargarAjustes(offset = 0) {
    cargando.value = true
    try {
      const data = await reportesService.ajustesFrecuentes(30, 20, offset)
      if (!data.success) return
      ajustes.value = {
        items: offset === 0 ? data.items : [...ajustes.value.items, ...data.items],
        total: offset === 0 ? data.total : ajustes.value.total,
      }
    } finally {
      cargando.value = false
    }
  }

  return { pendientes, ajustes, cargando, cargarPendientes, cargarAjustes }
})
