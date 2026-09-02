import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useReportesStore } from '../../../src/stores/reportes'
import * as reportesService from '../../../src/services/reportesService'

vi.mock('../../../src/services/reportesService')

describe('stores/reportes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  it('estado inicial', () => {
    const reportes = useReportesStore()
    expect(reportes.pendientes).toEqual({ items: [], total: 0 })
    expect(reportes.ajustes).toEqual({ items: [], total: 0 })
    expect(reportes.cargando).toBe(false)
  })

  describe('cargarPendientes()', () => {
    it('offset 0 reemplaza items y actualiza el total', async () => {
      reportesService.pendientesControlar.mockResolvedValue({
        success: true,
        items: [{ prod_id: 1 }, { prod_id: 2 }],
        total: 50,
      })
      const reportes = useReportesStore()

      await reportes.cargarPendientes(0)

      expect(reportes.pendientes.items).toHaveLength(2)
      expect(reportes.pendientes.total).toBe(50)
    })

    it('offset > 0 CONCATENA items nuevos y MANTIENE el total viejo (el backend solo lo recalcula en offset 0)', async () => {
      reportesService.pendientesControlar.mockResolvedValueOnce({
        success: true,
        items: [{ prod_id: 1 }, { prod_id: 2 }],
        total: 50,
      })
      const reportes = useReportesStore()
      await reportes.cargarPendientes(0)

      reportesService.pendientesControlar.mockResolvedValueOnce({
        success: true,
        items: [{ prod_id: 3 }],
        // El backend en páginas siguientes puede devolver un total distinto
        // (o directamente 0/undefined-como-0); el store lo debe ignorar.
        total: 999,
      })
      await reportes.cargarPendientes(2)

      expect(reportes.pendientes.items.map((p) => p.prod_id)).toEqual([1, 2, 3])
      expect(reportes.pendientes.total).toBe(50)
    })

    it('con success:false no modifica el estado pero deja cargando en false', async () => {
      reportesService.pendientesControlar.mockResolvedValue({ success: false })
      const reportes = useReportesStore()

      await reportes.cargarPendientes(0)

      expect(reportes.pendientes).toEqual({ items: [], total: 0 })
      expect(reportes.cargando).toBe(false)
    })

    it('cargando es true durante la petición y false al finalizar', async () => {
      let resolver
      reportesService.pendientesControlar.mockReturnValue(
        new Promise((resolve) => {
          resolver = resolve
        })
      )
      const reportes = useReportesStore()

      const promesa = reportes.cargarPendientes(0)
      await Promise.resolve()
      expect(reportes.cargando).toBe(true)

      resolver({ success: true, items: [], total: 0 })
      await promesa
      expect(reportes.cargando).toBe(false)
    })

    it('pasa dias/limit/offset al service', async () => {
      reportesService.pendientesControlar.mockResolvedValue({ success: true, items: [], total: 0 })
      const reportes = useReportesStore()

      await reportes.cargarPendientes(20)

      expect(reportesService.pendientesControlar).toHaveBeenCalledWith(7, 20, 20)
    })
  })

  describe('cargarAjustes()', () => {
    it('offset 0 reemplaza items y actualiza el total', async () => {
      reportesService.ajustesFrecuentes.mockResolvedValue({
        success: true,
        items: [{ prod_id: 1 }],
        total: 5,
      })
      const reportes = useReportesStore()

      await reportes.cargarAjustes(0)

      expect(reportes.ajustes.items).toHaveLength(1)
      expect(reportes.ajustes.total).toBe(5)
    })

    it('offset > 0 concatena y mantiene el total viejo', async () => {
      reportesService.ajustesFrecuentes.mockResolvedValueOnce({
        success: true,
        items: [{ prod_id: 1 }],
        total: 5,
      })
      const reportes = useReportesStore()
      await reportes.cargarAjustes(0)

      reportesService.ajustesFrecuentes.mockResolvedValueOnce({
        success: true,
        items: [{ prod_id: 2 }],
        total: 777,
      })
      await reportes.cargarAjustes(1)

      expect(reportes.ajustes.items.map((p) => p.prod_id)).toEqual([1, 2])
      expect(reportes.ajustes.total).toBe(5)
    })

    it('con success:false no modifica el estado', async () => {
      reportesService.ajustesFrecuentes.mockResolvedValue({ success: false })
      const reportes = useReportesStore()

      await reportes.cargarAjustes(0)

      expect(reportes.ajustes).toEqual({ items: [], total: 0 })
    })
  })

  it('cargarPendientes y cargarAjustes no interfieren entre sí (estados separados)', async () => {
    reportesService.pendientesControlar.mockResolvedValue({
      success: true,
      items: [{ prod_id: 1 }],
      total: 1,
    })
    reportesService.ajustesFrecuentes.mockResolvedValue({
      success: true,
      items: [{ prod_id: 2 }, { prod_id: 3 }],
      total: 2,
    })
    const reportes = useReportesStore()

    await reportes.cargarPendientes(0)
    await reportes.cargarAjustes(0)

    expect(reportes.pendientes.items).toHaveLength(1)
    expect(reportes.ajustes.items).toHaveLength(2)
  })
})
