import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useImportacionPreciosStore } from '../../../src/stores/importacionPrecios'
import * as importacionPreciosService from '../../../src/services/importacionPreciosService'
import { comprimirSiEsImagen } from '../../../src/composables/useCompresionImagen'

vi.mock('../../../src/services/importacionPreciosService')
// La compresión de imagen se mockea entera acá: este archivo testea la
// store (que se llame, que se use SU resultado), no la compresión en sí
// (eso lo cubre tests/unit/composables/useCompresionImagen.spec.js).
vi.mock('../../../src/composables/useCompresionImagen')

describe('stores/importacionPrecios', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    // Por default el mock de compresión es transparente (devuelve el mismo
    // archivo que le pasaron), como haría con un PDF/CSV real.
    comprimirSiEsImagen.mockImplementation((file) => Promise.resolve(file))
  })

  it('estado inicial', () => {
    const store = useImportacionPreciosStore()
    expect(store.proveedores).toEqual([])
    expect(store.proveedorSeleccionado).toBe(0)
    expect(store.items).toEqual([])
    expect(store.sinMatch).toBe(0)
    expect(store.fuente).toBe('')
    expect(store.avisos).toEqual([])
    expect(store.cargandoProveedores).toBe(false)
    expect(store.analizando).toBe(false)
    expect(store.aplicando).toBe(false)
    expect(store.error).toBe('')
    expect(store.resumen).toBeNull()
  })

  describe('cargarProveedores()', () => {
    it('primera vez llama al service y setea proveedores', async () => {
      importacionPreciosService.proveedores.mockResolvedValue({
        success: true,
        items: [{ per_id: 1, per_nombre: 'Proveedor A' }],
      })
      const store = useImportacionPreciosStore()

      await store.cargarProveedores()

      expect(store.proveedores).toHaveLength(1)
      expect(importacionPreciosService.proveedores).toHaveBeenCalledTimes(1)
    })

    it('segunda vez con proveedores ya cargados no vuelve a llamar al service (cache-once)', async () => {
      importacionPreciosService.proveedores.mockResolvedValue({
        success: true,
        items: [{ per_id: 1, per_nombre: 'Proveedor A' }],
      })
      const store = useImportacionPreciosStore()

      await store.cargarProveedores()
      await store.cargarProveedores()

      expect(importacionPreciosService.proveedores).toHaveBeenCalledTimes(1)
    })

    it('con success:false no setea proveedores ni lanza', async () => {
      importacionPreciosService.proveedores.mockResolvedValue({ success: false })
      const store = useImportacionPreciosStore()

      await expect(store.cargarProveedores()).resolves.not.toThrow()
      expect(store.proveedores).toEqual([])
    })
  })

  describe('analizarArchivo()', () => {
    it('en éxito comprime primero, analiza el resultado comprimido y mapea seleccionado=aplicable', async () => {
      const archivoOriginal = new File(['contenido'], 'lista.jpg', { type: 'image/jpeg' })
      const archivoComprimido = new File(['comprimido'], 'lista.jpg', { type: 'image/jpeg' })
      comprimirSiEsImagen.mockResolvedValue(archivoComprimido)
      importacionPreciosService.analizar.mockResolvedValue({
        success: true,
        items: [
          { prod_id: 1, aplicable: true },
          { prod_id: null, aplicable: false },
        ],
        sin_match: 1,
        fuente: 'ocr',
        avisos: ['Aviso 1'],
      })
      const store = useImportacionPreciosStore()
      store.proveedorSeleccionado = 7

      await store.analizarArchivo(archivoOriginal)

      expect(comprimirSiEsImagen).toHaveBeenCalledWith(archivoOriginal)
      expect(importacionPreciosService.analizar).toHaveBeenCalledWith(archivoComprimido, 7)
      expect(store.items).toEqual([
        { prod_id: 1, aplicable: true, seleccionado: true },
        { prod_id: null, aplicable: false, seleccionado: false },
      ])
      expect(store.sinMatch).toBe(1)
      expect(store.fuente).toBe('ocr')
      expect(store.avisos).toEqual(['Aviso 1'])
    })

    it('con success:false setea error y deja items vacío', async () => {
      importacionPreciosService.analizar.mockResolvedValue({
        success: false,
        error: 'No se pudo analizar el archivo.',
      })
      const store = useImportacionPreciosStore()

      await store.analizarArchivo(new File(['x'], 'x.pdf', { type: 'application/pdf' }))

      expect(store.error).toBe('No se pudo analizar el archivo.')
      expect(store.items).toEqual([])
      expect(store.analizando).toBe(false)
    })

    it('sin avisos en la respuesta, default a array vacío sin explotar', async () => {
      importacionPreciosService.analizar.mockResolvedValue({
        success: true,
        items: [],
        sin_match: 0,
        fuente: 'excel',
      })
      const store = useImportacionPreciosStore()

      await store.analizarArchivo(new File(['x'], 'x.csv', { type: 'text/csv' }))

      expect(store.avisos).toEqual([])
    })

    it('analizando es true durante el análisis y false al finalizar', async () => {
      let resolver
      importacionPreciosService.analizar.mockReturnValue(
        new Promise((resolve) => {
          resolver = resolve
        })
      )
      const store = useImportacionPreciosStore()

      const promesa = store.analizarArchivo(new File(['x'], 'x.pdf', { type: 'application/pdf' }))
      await Promise.resolve()
      await Promise.resolve()
      expect(store.analizando).toBe(true)

      resolver({ success: true, items: [], sin_match: 0, fuente: 'pdf' })
      await promesa
      expect(store.analizando).toBe(false)
    })
  })

  describe('confirmarSeleccionados()', () => {
    it('filtra solo items con seleccionado=true Y prod_id truthy (descarta "sin match")', async () => {
      importacionPreciosService.confirmar.mockResolvedValue({ success: true, aplicados: 1, rechazados: 0 })
      const store = useImportacionPreciosStore()
      store.items = [
        { prod_id: 1, seleccionado: true, precio_detectado: 100, codigo_detectado: 'A' },
        { prod_id: 2, seleccionado: false, precio_detectado: 200, codigo_detectado: 'B' },
        { prod_id: null, seleccionado: true, precio_detectado: 300, codigo_detectado: 'C' },
        { prod_id: 0, seleccionado: true, precio_detectado: 400, codigo_detectado: 'D' },
      ]

      await store.confirmarSeleccionados()

      expect(importacionPreciosService.confirmar).toHaveBeenCalledWith(0, [
        { prod_id: 1, costo_nuevo: 100, codigo_detectado: 'A' },
      ])
    })

    it('sin líneas después del filtro, no llama al service ni setea aplicando', async () => {
      const store = useImportacionPreciosStore()
      store.items = [{ prod_id: null, seleccionado: true }, { prod_id: 1, seleccionado: false }]

      await store.confirmarSeleccionados()

      expect(importacionPreciosService.confirmar).not.toHaveBeenCalled()
      expect(store.aplicando).toBe(false)
    })

    it('en éxito setea resumen y vacía items', async () => {
      importacionPreciosService.confirmar.mockResolvedValue({ success: true, aplicados: 2, rechazados: 1 })
      const store = useImportacionPreciosStore()
      store.items = [{ prod_id: 1, seleccionado: true, precio_detectado: 10, codigo_detectado: 'A' }]

      await store.confirmarSeleccionados()

      expect(store.resumen).toEqual({ success: true, aplicados: 2, rechazados: 1 })
      expect(store.items).toEqual([])
    })

    it('con success:false setea error, NO vacía items (permite reintentar) y no toca resumen', async () => {
      importacionPreciosService.confirmar.mockResolvedValue({
        success: false,
        error: 'No se pudo aplicar la actualización.',
      })
      const store = useImportacionPreciosStore()
      const itemsOriginales = [{ prod_id: 1, seleccionado: true, precio_detectado: 10, codigo_detectado: 'A' }]
      store.items = itemsOriginales

      await store.confirmarSeleccionados()

      expect(store.error).toBe('No se pudo aplicar la actualización.')
      expect(store.items).toEqual(itemsOriginales)
      expect(store.resumen).toBeNull()
    })
  })

  describe('reiniciar()', () => {
    it('resetea items/sinMatch/fuente/avisos/error/resumen pero NO toca proveedores ni la selección', () => {
      const store = useImportacionPreciosStore()
      store.proveedores = [{ per_id: 1 }]
      store.proveedorSeleccionado = 5
      store.items = [{ prod_id: 1 }]
      store.sinMatch = 3
      store.fuente = 'ocr'
      store.avisos = ['algo']
      store.error = 'error viejo'
      store.resumen = { aplicados: 1 }

      store.reiniciar()

      expect(store.items).toEqual([])
      expect(store.sinMatch).toBe(0)
      expect(store.fuente).toBe('')
      expect(store.avisos).toEqual([])
      expect(store.error).toBe('')
      expect(store.resumen).toBeNull()
      expect(store.proveedores).toEqual([{ per_id: 1 }])
      expect(store.proveedorSeleccionado).toBe(5)
    })
  })
})
