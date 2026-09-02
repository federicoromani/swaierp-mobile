import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProductosStore } from '../../../src/stores/productos'
import { db } from '../../../src/offline/db'
import * as productosService from '../../../src/services/productosService'

vi.mock('../../../src/services/productosService')

describe('stores/productos', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    await db.catalogoCache.clear()
  })

  describe('estado inicial', () => {
    it('arranca vacío', () => {
      const productos = useProductosStore()
      expect(productos.resultados).toEqual([])
      expect(productos.recientes).toEqual([])
      expect(productos.actual).toBeNull()
      expect(productos.cargando).toBe(false)
      expect(productos.error).toBe('')
    })
  })

  describe('buscar()', () => {
    it('con query vacía limpia resultados y no llama al service', async () => {
      const productos = useProductosStore()
      productos.resultados = [{ prod_id: 1 }]

      await productos.buscar('')

      expect(productos.resultados).toEqual([])
      expect(productosService.buscar).not.toHaveBeenCalled()
    })

    it('con query de solo espacios limpia resultados y no llama al service', async () => {
      const productos = useProductosStore()

      await productos.buscar('    ')

      expect(productos.resultados).toEqual([])
      expect(productosService.buscar).not.toHaveBeenCalled()
    })

    it('en éxito setea resultados y cachea cada item en catalogoCache', async () => {
      const items = [
        { prod_id: 1, nombre: 'Tornillo', codigo: 'T-1' },
        { prod_id: 2, nombre: 'Tuerca', codigo: 'T-2' },
      ]
      productosService.buscar.mockResolvedValue({ success: true, items })
      const productos = useProductosStore()

      await productos.buscar('torn')

      expect(productos.resultados).toEqual(items)
      expect(productos.cargando).toBe(false)
      expect(productos.error).toBe('')
      const cacheado = await db.catalogoCache.get(1)
      expect(cacheado.nombre).toBe('Tornillo')
    })

    it('con success:false cae a la búsqueda en cache y setea error', async () => {
      await db.catalogoCache.bulkPut([
        { prod_id: 1, nombre: 'Tornillo 3mm', codigo: 'ABC' },
        { prod_id: 2, nombre: 'Tuerca', codigo: 'XYZ' },
      ])
      productosService.buscar.mockResolvedValue({ success: false, error: 'Sin conexión con el servidor.' })
      const productos = useProductosStore()

      await productos.buscar('tornillo')

      expect(productos.error).toBe('Sin conexión con el servidor.')
      expect(productos.resultados).toHaveLength(1)
      expect(productos.resultados[0].prod_id).toBe(1)
    })

    it('si el service rechaza (sin red), también cae al fallback de cache', async () => {
      await db.catalogoCache.put({ prod_id: 5, nombre: 'Cable', codigo: 'CBL' })
      productosService.buscar.mockRejectedValue(new Error('No hay conexión con el servidor.'))
      const productos = useProductosStore()

      await productos.buscar('cable')

      expect(productos.error).toBe('No hay conexión con el servidor.')
      expect(productos.resultados).toEqual([{ prod_id: 5, nombre: 'Cable', codigo: 'CBL' }])
    })

    it('la búsqueda en cache filtra por nombre (case-insensitive) o por código', async () => {
      await db.catalogoCache.bulkPut([
        { prod_id: 1, nombre: 'Martillo Grande', codigo: 'MG-1' },
        { prod_id: 2, nombre: 'Destornillador', codigo: 'DST-2' },
      ])
      productosService.buscar.mockResolvedValue({ success: false, error: 'falló' })
      const productos = useProductosStore()

      await productos.buscar('MARTILLO')

      expect(productos.resultados.map((p) => p.prod_id)).toEqual([1])
    })

    // HALLAZGO (código real, no bug del test — ver docs/testing/hallazgos-agente-1.md):
    // el filtro por nombre es case-insensitive (compara ambos lados en
    // minúscula), pero el filtro por código NO: `(p.codigo || '').includes(q)`
    // usa el código tal cual está guardado y el término de búsqueda tal cual
    // lo tipeó el usuario, sin bajar ninguno de los dos a minúscula. Se fija
    // el comportamiento real tal cual está, no lo que "debería" ser.
    it('la búsqueda por código es case-SENSITIVE (asimetría real respecto del filtro por nombre)', async () => {
      await db.catalogoCache.bulkPut([{ prod_id: 3, nombre: 'Tornillo', codigo: 'DST-2' }])
      productosService.buscar.mockResolvedValue({ success: false, error: 'falló' })
      const productos = useProductosStore()

      await productos.buscar('dst-2')
      expect(productos.resultados).toEqual([])

      await productos.buscar('DST-2')
      expect(productos.resultados.map((p) => p.prod_id)).toEqual([3])
    })
  })

  describe('seleccionar()', () => {
    it('en éxito setea actual, lo agrega a recientes y lo cachea', async () => {
      const detalle = { prod_id: 10, nombre: 'Pintura', costo: 100, precio_venta: 150 }
      productosService.detalle.mockResolvedValue({ success: true, ...detalle })
      const productos = useProductosStore()

      await productos.seleccionar(10)

      expect(productos.actual.prod_id).toBe(10)
      expect(productos.recientes[0].prod_id).toBe(10)
      const cacheado = await db.catalogoCache.get(10)
      expect(cacheado.nombre).toBe('Pintura')
    })

    it('en fallo con cache disponible, cae a la cache para ese prod_id', async () => {
      await db.catalogoCache.put({ prod_id: 20, nombre: 'Cache viejo' })
      productosService.detalle.mockResolvedValue({ success: false, error: 'No se pudo obtener el producto.' })
      const productos = useProductosStore()

      await productos.seleccionar(20)

      expect(productos.error).toBe('No se pudo obtener el producto.')
      expect(productos.actual.nombre).toBe('Cache viejo')
    })

    it('en fallo sin cache disponible, actual queda como estaba (no lo pisa)', async () => {
      productosService.detalle.mockResolvedValue({ success: false, error: 'falló' })
      const productos = useProductosStore()
      productos.actual = { prod_id: 999, nombre: 'El que había antes' }

      await productos.seleccionar(30)

      expect(productos.actual).toEqual({ prod_id: 999, nombre: 'El que había antes' })
    })

    it('agregarReciente deduplica: si ya estaba, lo mueve al frente sin duplicar', async () => {
      const productos = useProductosStore()
      productos.recientes = [{ prod_id: 2 }, { prod_id: 1 }, { prod_id: 3 }]
      productosService.detalle.mockResolvedValue({ success: true, prod_id: 1, nombre: 'Ya visto' })

      await productos.seleccionar(1)

      expect(productos.recientes.map((p) => p.prod_id)).toEqual([1, 2, 3])
    })

    it('agregarReciente mantiene como máximo 4 elementos', async () => {
      const productos = useProductosStore()
      productos.recientes = [{ prod_id: 1 }, { prod_id: 2 }, { prod_id: 3 }, { prod_id: 4 }]
      productosService.detalle.mockResolvedValue({ success: true, prod_id: 5, nombre: 'Nuevo' })

      await productos.seleccionar(5)

      expect(productos.recientes).toHaveLength(4)
      expect(productos.recientes.map((p) => p.prod_id)).toEqual([5, 1, 2, 3])
    })
  })

  describe('actualizarPrecio()', () => {
    it('en éxito reemplaza actual con la data devuelta', async () => {
      const respuesta = { success: true, prod_id: 1, costo: 50, precio_venta: 80 }
      productosService.actualizarPrecio.mockResolvedValue(respuesta)
      const productos = useProductosStore()

      const resultado = await productos.actualizarPrecio(1, 50, 80)

      expect(productos.actual).toEqual(respuesta)
      expect(resultado).toEqual(respuesta)
    })

    it('con success:false lanza Exception', async () => {
      productosService.actualizarPrecio.mockResolvedValue({ success: false, error: 'Precio inválido.' })
      const productos = useProductosStore()

      await expect(productos.actualizarPrecio(1, -5, 80)).rejects.toThrow('Precio inválido.')
    })
  })

  describe('ajustarStock()', () => {
    it('en éxito con prod_id coincidente, actualiza solo stock_actual sin reemplazar el objeto', async () => {
      productosService.ajustarStock.mockResolvedValue({ success: true, stock_actual: 42 })
      const productos = useProductosStore()
      productos.actual = { prod_id: 7, nombre: 'Clavo', stock_actual: 10, costo: 5 }

      await productos.ajustarStock(7, 42, 'conteo')

      expect(productos.actual.stock_actual).toBe(42)
      expect(productos.actual.nombre).toBe('Clavo')
      expect(productos.actual.costo).toBe(5)
    })

    it('en éxito pero el producto actual ya cambió (respuesta fuera de orden), no pisa actual', async () => {
      productosService.ajustarStock.mockResolvedValue({ success: true, stock_actual: 42 })
      const productos = useProductosStore()
      productos.actual = { prod_id: 999, nombre: 'Otro producto', stock_actual: 1 }

      await productos.ajustarStock(7, 42, '')

      expect(productos.actual.prod_id).toBe(999)
      expect(productos.actual.stock_actual).toBe(1)
    })

    it('con success:false lanza Exception', async () => {
      productosService.ajustarStock.mockResolvedValue({ success: false, error: 'Stock no puede ser negativo.' })
      const productos = useProductosStore()

      await expect(productos.ajustarStock(1, -1, '')).rejects.toThrow('Stock no puede ser negativo.')
    })
  })
})
