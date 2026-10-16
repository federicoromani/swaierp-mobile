import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as productosService from '../services/productosService'
import { db } from '../offline/db'
import { useReportesStore } from './reportes'

export const useProductosStore = defineStore('productos', () => {
  const resultados = ref([])
  const recientes = ref([])
  const actual = ref(null)
  const cargando = ref(false)
  // Solo la carga del detalle (seleccionar). El skeleton se muestra solo si
  // se está cargando OTRO producto: volver a elegir el mismo (p. ej. desde
  // Recientes) no debe desmontar la card y perder lo que se estaba tipeando.
  const cargandoDetalle = ref(false)
  const seleccionandoId = ref(null)
  const cargandoOtroProducto = computed(
    () => cargandoDetalle.value && seleccionandoId.value !== actual.value?.prod_id
  )
  const error = ref('')

  async function buscar(query) {
    const q = (query || '').trim()
    if (!q) {
      resultados.value = []
      return
    }
    cargando.value = true
    error.value = ''
    try {
      const data = await productosService.buscar(q)
      if (!data.success) {
        throw new Error(data.error || 'No se pudo buscar productos.')
      }
      resultados.value = data.items
      data.items.forEach((item) => db.catalogoCache.put(item))
    } catch (e) {
      error.value = e.message
      resultados.value = await buscarEnCache(q)
    } finally {
      cargando.value = false
    }
  }

  async function buscarEnCache(q) {
    const texto = q.toLowerCase()
    const todos = await db.catalogoCache.toArray()
    return todos.filter(
      (p) => (p.nombre || '').toLowerCase().includes(texto) || (p.codigo || '').includes(q)
    )
  }

  async function seleccionar(prodId) {
    cargando.value = true
    cargandoDetalle.value = true
    seleccionandoId.value = prodId
    error.value = ''
    try {
      const data = await productosService.detalle(prodId)
      if (!data.success) {
        throw new Error(data.error || 'No se pudo obtener el producto.')
      }
      actual.value = data
      agregarReciente(data)
      db.catalogoCache.put(data)
    } catch (e) {
      error.value = e.message
      const cache = await db.catalogoCache.get(prodId)
      if (cache) {
        actual.value = cache
      }
    } finally {
      cargando.value = false
      cargandoDetalle.value = false
    }
  }

  function agregarReciente(p) {
    recientes.value = [p, ...recientes.value.filter((r) => r.prod_id !== p.prod_id)].slice(0, 4)
  }

  async function actualizarPrecio(prodId, costo, precioVenta) {
    const data = await productosService.actualizarPrecio(prodId, costo, precioVenta)
    if (!data.success) {
      throw new Error(data.error || 'No se pudo actualizar el precio.')
    }
    actual.value = data
    return data
  }

  async function registrarConteo(prodId, stockContado) {
    // ultimo_conteo previo: con eso "Pendientes de controlar" sabe si este
    // conteo lo saca de la lista aunque no esté en la página cargada.
    const previo = actual.value?.prod_id === prodId ? actual.value : null
    const conteoAnterior = previo ? previo.ultimo_conteo : undefined
    const data = await productosService.registrarConteo(prodId, stockContado)
    if (!data.success) {
      throw new Error(data.error || 'No se pudo registrar el conteo.')
    }
    // Mismo guard que tenía el ajuste de stock: una respuesta tardía no pisa
    // otro producto que el usuario ya esté viendo.
    if (actual.value && actual.value.prod_id === prodId) {
      actual.value = data
      db.catalogoCache.put(data)
    }
    useReportesStore().marcarContado(prodId, conteoAnterior, previo?.categoria_id)
    return data
  }

  return {
    resultados,
    recientes,
    actual,
    cargando,
    cargandoDetalle,
    cargandoOtroProducto,
    error,
    buscar,
    seleccionar,
    actualizarPrecio,
    registrarConteo,
  }
})
