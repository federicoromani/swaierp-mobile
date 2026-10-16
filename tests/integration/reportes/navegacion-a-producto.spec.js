// Navegación cruzada Reportes → producto. Desde "Pendientes de controlar",
// tocar un producto abre el MODO CONTEO en ese producto (/contar?desde=ID).
// Desde "Ajustes frecuentes" (ReportesView.irAProducto) llama
// `productos.seleccionar(prodId)` SIN await y ENSEGUIDA hace
// `router.push('/buscar')` (hallazgo de discovery #10) — la navegación
// ocurre antes de que resuelva el detalle. Se prueba con un RouterView real
// para que la navegación efectivamente intercambie el componente montado.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { RouterView } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockReportesEndpoint, mockProductosEndpoint, HttpResponse, delay } from '../../mocks/handlers'
import { itemPendienteEjemplo, itemAjusteEjemplo, productoEjemplo } from '../../mocks/fixtures'
import { limpiarDb } from '../../mocks/db-helpers'
import { crearRouterLiviano } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { instalarIntersectionObserverControlable } from '../../mocks/intersection-observer-mock'
import { useAuthStore } from '../../../src/stores/auth'
import { useProductosStore } from '../../../src/stores/productos'

async function montarConRouterView(rutaInicial = '/reportes') {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  const router = await crearRouterLiviano(rutaInicial)
  const wrapper = mount(RouterView, { global: { plugins: [router] } })
  return { wrapper, router, productos: useProductosStore() }
}

describe('Reportes → producto: navegación cruzada vía productos store', () => {
  let io
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
    io = instalarIntersectionObserverControlable()
  })
  afterEach(async () => {
    await limpiarDb()
    io.restaurar()
  })

  it('click en un pendiente abre el modo conteo en ese producto y, cuando resuelve el detalle, ProductoCard lo muestra', async () => {
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: () =>
          HttpResponse.json({ success: true, items: [itemPendienteEjemplo({ prod_id: 707, nombre: 'Yerba pendiente' })], total: 1 }),
      }),
      ...mockProductosEndpoint({
        detalle: async () => {
          // Demora a propósito: confirma que router.push ya pasó ANTES de
          // que esto resuelva (seleccionar() se llama sin await).
          await delay(20)
          return HttpResponse.json(productoEjemplo({ prod_id: 707, nombre: 'Yerba pendiente' }))
        },
      })
    )

    const { wrapper, router, productos } = await montarConRouterView('/reportes')
    await esperarQue(() => expect(wrapper.text()).toContain('Yerba pendiente'))

    const item = wrapper.findAll('button').find((b) => b.text().includes('Yerba pendiente'))
    await item.trigger('click')

    await esperarQue(() => expect(router.currentRoute.value.path).toBe('/contar'))
    expect(router.currentRoute.value.query.desde).toBe('707')

    await esperarQue(() => expect(productos.actual?.prod_id).toBe(707))
    await esperarQue(() => expect(wrapper.text()).toContain('Modo conteo'))
    expect(wrapper.find('h2').text()).toBe('Yerba pendiente')
  })

  it('mismo flujo desde "Ajustes frecuentes"', async () => {
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: () => HttpResponse.json({ success: true, items: [], total: 0 }),
        ajustesFrecuentes: () =>
          HttpResponse.json({
            success: true,
            items: [itemAjusteEjemplo({ prod_id: 808, nombre: 'Aceite con ajustes' })],
            total: 1,
          }),
      }),
      ...mockProductosEndpoint({
        detalle: () => HttpResponse.json(productoEjemplo({ prod_id: 808, nombre: 'Aceite con ajustes' })),
      })
    )

    const { wrapper, router, productos } = await montarConRouterView('/reportes')
    const tabAjustes = wrapper.findAll('button').find((b) => b.text().trim() === 'Ajustes')
    await tabAjustes.trigger('click')
    await esperarQue(() => expect(wrapper.text()).toContain('Aceite con ajustes'))

    const item = wrapper.findAll('button').find((b) => b.text().includes('Aceite con ajustes'))
    await item.trigger('click')

    await esperarQue(() => expect(router.currentRoute.value.path).toBe('/buscar'))
    await esperarQue(() => expect(productos.actual?.prod_id).toBe(808))
  })

  it('si el detalle falla (red caída) en el modo conteo, no muestra otro producto: error + "Reintentar"', async () => {
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: () =>
          HttpResponse.json({ success: true, items: [itemPendienteEjemplo({ prod_id: 909, nombre: 'Sin conexión' })], total: 1 }),
      }),
      ...mockProductosEndpoint({ detalle: () => HttpResponse.error() })
    )

    const { wrapper, router, productos } = await montarConRouterView('/reportes')
    await esperarQue(() => expect(wrapper.text()).toContain('Sin conexión'))

    const item = wrapper.findAll('button').find((b) => b.text().includes('Sin conexión'))
    await item.trigger('click')

    await esperarQue(() => expect(router.currentRoute.value.path).toBe('/contar'))
    await esperarQue(() => expect(productos.error).toBe('No hay conexión con el servidor.'))
    await esperarQue(() => expect(wrapper.text()).toContain('No hay conexión con el servidor.'))
    expect(wrapper.text()).toContain('Reintentar')
    expect(wrapper.find('input[aria-label="Stock contado"]').exists()).toBe(false)
  })
})
