import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as productosService from '../services/productosService'
import { db } from '../offline/db'

export const useProductosStore = defineStore('productos', () => {
  const resultados = ref([])
  const recientes = ref([])
  const actual = ref(null)
  const cargando = ref(false)
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

  async function ajustarStock(prodId, nuevoStock, comentario) {
    const data = await productosService.ajustarStock(prodId, nuevoStock, comentario)
    if (!data.success) {
      throw new Error(data.error || 'No se pudo ajustar el stock.')
    }
    if (actual.value && actual.value.prod_id === prodId) {
      actual.value.stock_actual = data.stock_actual
    }
    return data
  }

  return {
    resultados,
    recientes,
    actual,
    cargando,
    error,
    buscar,
    seleccionar,
    actualizarPrecio,
    ajustarStock,
  }
})
