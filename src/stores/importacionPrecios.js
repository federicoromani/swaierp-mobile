import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as importacionPreciosService from '../services/importacionPreciosService'
import { comprimirSiEsImagen } from '../composables/useCompresionImagen'

export const useImportacionPreciosStore = defineStore('importacionPrecios', () => {
  const proveedores = ref([])
  const proveedorSeleccionado = ref(0)
  const items = ref([]) // cada item + 'seleccionado' local (no viene del backend)
  const sinMatch = ref(0)
  const fuente = ref('')
  const avisos = ref([])
  const cargandoProveedores = ref(false)
  const analizando = ref(false)
  const aplicando = ref(false)
  const error = ref('')
  const resumen = ref(null)

  async function cargarProveedores() {
    if (proveedores.value.length > 0) {
      return
    }
    cargandoProveedores.value = true
    try {
      const data = await importacionPreciosService.proveedores()
      if (data.success) {
        proveedores.value = data.items
      }
    } finally {
      cargandoProveedores.value = false
    }
  }

  async function analizarArchivo(archivoOriginal) {
    analizando.value = true
    error.value = ''
    resumen.value = null
    items.value = []
    try {
      const archivo = await comprimirSiEsImagen(archivoOriginal)
      const data = await importacionPreciosService.analizar(archivo, proveedorSeleccionado.value)
      if (!data.success) {
        throw new Error(data.error || 'No se pudo analizar el archivo.')
      }
      items.value = data.items.map((item) => ({ ...item, seleccionado: item.aplicable }))
      sinMatch.value = data.sin_match
      fuente.value = data.fuente
      avisos.value = data.avisos || []
    } catch (e) {
      error.value = e.message
    } finally {
      analizando.value = false
    }
  }

  async function confirmarSeleccionados() {
    const lineas = items.value
      .filter((item) => item.seleccionado && item.prod_id)
      .map((item) => ({
        prod_id: item.prod_id,
        costo_nuevo: item.precio_detectado,
        codigo_detectado: item.codigo_detectado,
      }))
    if (lineas.length === 0) {
      return
    }
    aplicando.value = true
    error.value = ''
    try {
      const data = await importacionPreciosService.confirmar(proveedorSeleccionado.value, lineas)
      if (!data.success) {
        throw new Error(data.error || 'No se pudo aplicar la actualización.')
      }
      resumen.value = data
      items.value = []
    } catch (e) {
      error.value = e.message
    } finally {
      aplicando.value = false
    }
  }

  function reiniciar() {
    items.value = []
    sinMatch.value = 0
    fuente.value = ''
    avisos.value = []
    error.value = ''
    resumen.value = null
  }

  return {
    proveedores,
    proveedorSeleccionado,
    items,
    sinMatch,
    fuente,
    avisos,
    cargandoProveedores,
    analizando,
    aplicando,
    error,
    resumen,
    cargarProveedores,
    analizarArchivo,
    confirmarSeleccionados,
    reiniciar,
  }
})
