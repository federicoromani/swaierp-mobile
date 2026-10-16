// Reportes "Ajustes frecuentes": mismo patrón de paginación que "Pendientes
// de controlar" (ver pendientes-controlar.spec.js para el detalle del quirk
// de `total` y el manejo de errores) — este archivo se enfoca en lo que es
// específico de esta pestaña: la carga perezosa al cambiar de tab por
// primera vez, y que NO se repite en cambios posteriores.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockReportesEndpoint, HttpResponse } from '../../mocks/handlers'
import { itemAjusteEjemplo, itemPendienteEjemplo } from '../../mocks/fixtures'
import { limpiarDb } from '../../mocks/db-helpers'
import { crearRouterLiviano } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { instalarIntersectionObserverControlable } from '../../mocks/intersection-observer-mock'
import { useAuthStore } from '../../../src/stores/auth'
import { useReportesStore } from '../../../src/stores/reportes'
import ReportesView from '../../../src/views/ReportesView.vue'

function itemsAjustesDePagina(offset, cantidad) {
  return Array.from({ length: cantidad }, (_, i) =>
    itemAjusteEjemplo({ prod_id: 2000 + offset + i, nombre: `Ajuste ${offset + i}`, cantidad_ajustes: 3 })
  )
}

async function montar() {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  const router = await crearRouterLiviano('/reportes')
  const wrapper = mount(ReportesView, { global: { plugins: [router] } })
  return { wrapper, router, reportes: useReportesStore() }
}

async function irATabAjustes(wrapper) {
  const tabs = wrapper.findAll('button').filter((b) => b.text().trim() === 'Ajustes')
  await tabs[0].trigger('click')
}

describe('ReportesView + reportes store: ajustes frecuentes', () => {
  let io

  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
    io = instalarIntersectionObserverControlable()
    // Las dos pestañas comparten `reportes.cargando`: mockeamos pendientes
    // (se carga sola al montar) para que no quede en un estado raro.
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: () => HttpResponse.json({ success: true, items: [itemPendienteEjemplo()], total: 1 }),
      })
    )
  })

  afterEach(async () => {
    await limpiarDb()
    io.restaurar()
  })

  it('cambiar a la pestaña "Ajustes" por primera vez dispara offset=0 con dias=30&limit=20', async () => {
    let queryRecibida = null
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: () => HttpResponse.json({ success: true, items: [], total: 0 }),
        ajustesFrecuentes: ({ request }) => {
          queryRecibida = Object.fromEntries(new URL(request.url).searchParams)
          return HttpResponse.json({ success: true, items: itemsAjustesDePagina(0, 3), total: 12 })
        },
      })
    )

    const { wrapper, reportes } = await montar()
    await irATabAjustes(wrapper)

    await esperarQue(() => expect(reportes.ajustes.items).toHaveLength(3))
    expect(queryRecibida).toEqual({ action: 'ajustes_frecuentes', dias: '30', limit: '20', offset: '0' })
    expect(reportes.ajustes.total).toBe(12)
    expect(wrapper.text()).toContain('Ajuste 0')
    expect(wrapper.text()).toContain('3 ajustes')
  })

  it('volver a cambiar de pestaña NO repite la carga (solo se dispara si items.length === 0)', async () => {
    let llamadas = 0
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: () => HttpResponse.json({ success: true, items: [], total: 0 }),
        ajustesFrecuentes: () => {
          llamadas++
          return HttpResponse.json({ success: true, items: itemsAjustesDePagina(0, 3), total: 12 })
        },
      })
    )

    const { wrapper, reportes } = await montar()
    await irATabAjustes(wrapper)
    await esperarQue(() => expect(reportes.ajustes.items).toHaveLength(3))

    // Vuelve a "pendientes" y de nuevo a "ajustes".
    const tabPendientes = wrapper.findAll('button').find((b) => b.text().trim() === 'Pendientes')
    await tabPendientes.trigger('click')
    await irATabAjustes(wrapper)

    expect(llamadas).toBe(1)
  })

  it('scroll infinito en Ajustes respeta el mismo quirk de "total solo en offset=0"', async () => {
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: () => HttpResponse.json({ success: true, items: [], total: 0 }),
        ajustesFrecuentes: ({ request }) => {
          const offset = Number(new URL(request.url).searchParams.get('offset'))
          if (offset === 0) {
            return HttpResponse.json({ success: true, items: itemsAjustesDePagina(0, 20), total: 25 })
          }
          return HttpResponse.json({ success: true, items: itemsAjustesDePagina(20, 5) })
        },
      })
    )

    const { wrapper, reportes } = await montar()
    await irATabAjustes(wrapper)
    await esperarQue(() => expect(reportes.ajustes.items).toHaveLength(20))

    const sentinel = wrapper.find('.py-2.text-center.text-xs.text-muted')
    expect(sentinel.exists()).toBe(true)
    io.dispararInterseccion(sentinel.element)

    await esperarQue(() => expect(reportes.ajustes.items).toHaveLength(25))
    expect(reportes.ajustes.total).toBe(25)
  })
})
