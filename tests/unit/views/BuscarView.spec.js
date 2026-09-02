import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createTestingPinia } from '@pinia/testing'
import { useProductosStore } from '../../../src/stores/productos'
import { useReportesStore } from '../../../src/stores/reportes'
import BuscarView from '../../../src/views/BuscarView.vue'

// Cobertura liviana a propósito (P2, ver plan): SearchBar y ProductoCard ya
// tienen su propio spec de componente; acá solo se testea el WIRING propio
// de BuscarView (qué condiciones muestran qué banner/estado), con los hijos
// stubeados para no duplicar esfuerzo.
function crearRouterDeTest() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/buscar', name: 'buscar', component: { template: '<div/>' } },
      { path: '/reportes', name: 'reportes', component: { template: '<div/>' } },
    ],
  })
}

async function montar({ pendientesTotal = 0, error = '', actual = null } = {}) {
  const router = crearRouterDeTest()
  await router.push('/buscar')
  await router.isReady()
  const pinia = createTestingPinia({
    stubActions: true,
    initialState: {
      productos: { resultados: [], recientes: [], actual, cargando: false, error },
      reportes: {
        pendientes: { items: [], total: pendientesTotal },
        ajustes: { items: [], total: 0 },
        cargando: false,
      },
    },
  })
  const wrapper = mount(BuscarView, {
    global: { plugins: [router, pinia], stubs: { SearchBar: true, ProductoCard: true } },
  })
  const reportes = useReportesStore()
  const productos = useProductosStore()
  return { wrapper, reportes, productos, router }
}

describe('views/BuscarView', () => {
  it('al montar, llama a reportes.cargarPendientes(0)', async () => {
    const { reportes } = await montar()
    expect(reportes.cargarPendientes).toHaveBeenCalledWith(0)
  })

  it('el banner de pendientes se muestra solo si reportes.pendientes.total > 0', async () => {
    const sinBanner = await montar({ pendientesTotal: 0 })
    expect(sinBanner.wrapper.text()).not.toContain('sin controlar hace +7 días')

    const conBanner = await montar({ pendientesTotal: 5 })
    expect(conBanner.wrapper.text()).toContain('sin controlar hace +7 días')
  })

  it('el banner de error de productos se muestra solo si hay error Y no hay producto actual', async () => {
    const conError = await montar({ error: 'Sin conexión con el servidor.', actual: null })
    expect(conError.wrapper.text()).toContain('Sin conexión con el servidor.')

    const conErrorPeroActual = await montar({ error: 'Sin conexión con el servidor.', actual: { prod_id: 1 } })
    expect(conErrorPeroActual.wrapper.text()).not.toContain('Sin conexión con el servidor.')
  })

  it('el estado vacío "Buscá un producto" se muestra solo si no hay producto actual', async () => {
    const sinActual = await montar({ actual: null })
    expect(sinActual.wrapper.text()).toContain('Buscá un producto')

    const conActual = await montar({ actual: { prod_id: 1 } })
    expect(conActual.wrapper.text()).not.toContain('Buscá un producto')
  })

  it('click en "Ver" del banner navega a /reportes', async () => {
    const { wrapper, router } = await montar({ pendientesTotal: 3 })

    const boton = wrapper.findAll('button').find((b) => b.text().includes('Ver'))
    await boton.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/reportes')
  })
})
