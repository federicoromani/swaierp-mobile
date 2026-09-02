import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createTestingPinia } from '@pinia/testing'
import { useReportesStore } from '../../../src/stores/reportes'
import { useProductosStore } from '../../../src/stores/productos'
import ReportesView from '../../../src/views/ReportesView.vue'

// Mismo mecanismo que tests/unit/composables/useInfiniteScroll.spec.js: el
// stub global de IntersectionObserver descarta el callback, así que se
// sobreescribe local para poder disparar la intersección a mano. Acá el
// componente crea DOS instancias (una por sentinela/tab), aunque solo la de
// la tab activa termina observando algo (la otra sección ni se renderiza).
function crearObservadorFake() {
  const instancias = []
  class IntersectionObserverFake {
    constructor(callback) {
      this.callback = callback
      this.observe = vi.fn()
      this.disconnect = vi.fn()
      instancias.push(this)
    }
  }
  return { IntersectionObserverFake, instancias }
}

function crearRouterDeTest() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/buscar', name: 'buscar', component: { template: '<div/>' } },
      { path: '/reportes', name: 'reportes', component: { template: '<div/>' } },
    ],
  })
}

async function montar({ pendientes = { items: [], total: 0 }, ajustes = { items: [], total: 0 }, cargando = false } = {}) {
  const router = crearRouterDeTest()
  await router.push('/reportes')
  await router.isReady()
  const pinia = createTestingPinia({
    stubActions: true,
    initialState: {
      reportes: { pendientes, ajustes, cargando },
      productos: { resultados: [], recientes: [], actual: null, cargando: false, error: '' },
    },
  })
  const wrapper = mount(ReportesView, { global: { plugins: [router, pinia] } })
  const reportes = useReportesStore()
  const productos = useProductosStore()
  return { wrapper, reportes, productos, router }
}

const SENTINEL = '.py-2.text-center.text-xs.text-muted'

describe('views/ReportesView', () => {
  let instancias

  beforeEach(() => {
    const fake = crearObservadorFake()
    instancias = fake.instancias
    vi.stubGlobal('IntersectionObserver', fake.IntersectionObserverFake)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('al montar arranca en la tab "pendientes" y llama cargarPendientes(0)', async () => {
    const { wrapper, reportes } = await montar()

    expect(reportes.cargarPendientes).toHaveBeenCalledWith(0)
    expect(wrapper.text()).toContain('sin conteo hace +7 días')
    expect(wrapper.text()).not.toContain('productos con ajustes manuales')
  })

  it('cambiar a la tab "ajustes" por primera vez (sin items) llama cargarAjustes(0)', async () => {
    const { wrapper, reportes } = await montar()

    const botonAjustes = wrapper.findAll('button').find((b) => b.text().includes('Ajustes frecuentes'))
    await botonAjustes.trigger('click')

    expect(reportes.cargarAjustes).toHaveBeenCalledWith(0)
    expect(wrapper.text()).toContain('productos con ajustes manuales')
  })

  it('volver a la tab "ajustes" cuando ya tiene items NO vuelve a llamar cargarAjustes (evita refetch)', async () => {
    const { wrapper, reportes } = await montar({ ajustes: { items: [{ prod_id: 1, nombre: 'X', cantidad_ajustes: 2 }], total: 1 } })
    const botonAjustes = wrapper.findAll('button').find((b) => b.text().includes('Ajustes frecuentes'))
    const botonPendientes = wrapper.findAll('button').find((b) => b.text().includes('Pendientes de controlar'))

    await botonAjustes.trigger('click')
    await botonPendientes.trigger('click')
    await botonAjustes.trigger('click')

    expect(reportes.cargarAjustes).not.toHaveBeenCalled()
  })

  it('el sentinela de pendientes se muestra solo si quedan más para cargar', async () => {
    const conMas = await montar({ pendientes: { items: [{ prod_id: 1, nombre: 'A' }], total: 5 } })
    expect(conMas.wrapper.find(SENTINEL).exists()).toBe(true)

    const sinMas = await montar({ pendientes: { items: [{ prod_id: 1, nombre: 'A' }], total: 1 } })
    expect(sinMas.wrapper.find(SENTINEL).exists()).toBe(false)
  })

  it('el sentinela de ajustes se muestra solo si quedan más para cargar', async () => {
    const { wrapper } = await montar({
      ajustes: { items: [{ prod_id: 1, nombre: 'A', cantidad_ajustes: 1 }], total: 5 },
    })
    const botonAjustes = wrapper.findAll('button').find((b) => b.text().includes('Ajustes frecuentes'))
    await botonAjustes.trigger('click')

    expect(wrapper.find(SENTINEL).exists()).toBe(true)
  })

  it('la intersección del sentinela de pendientes dispara cargarPendientes con el offset actual (no 0)', async () => {
    const { reportes } = await montar({
      pendientes: { items: [{ prod_id: 1 }, { prod_id: 2 }], total: 5 },
    })

    // HALLAZGO nuevo (ver reporte de Ronda 2): en el mount inicial,
    // useInfiniteScroll puede conectar el observer DOS veces — una vía
    // onMounted(conectar) y otra vía el watch(sentinelRef, conectar), que
    // también dispara una vez cuando el ref pasa de null a un elemento real
    // durante el primer patch (no solo en los remounts v-if/v-else que el
    // comentario del código anticipa). Es inofensivo en producción
    // (conectar() llama desconectar() antes de crear el observer nuevo), así
    // que hay que ubicar la instancia VIVA (la que no fue desconectada) en
    // vez de asumir que solo se crea una.
    const activa = instancias.find((i) => i.disconnect.mock.calls.length === 0)
    expect(activa).toBeTruthy()

    activa.callback([{ isIntersecting: true }])

    expect(reportes.cargarPendientes).toHaveBeenLastCalledWith(2)
  })

  it('la intersección del sentinela de ajustes dispara cargarAjustes con el offset actual (no 0)', async () => {
    const { wrapper, reportes } = await montar({
      ajustes: { items: [{ prod_id: 1, nombre: 'A', cantidad_ajustes: 1 }], total: 5 },
    })
    const botonAjustes = wrapper.findAll('button').find((b) => b.text().includes('Ajustes frecuentes'))
    await botonAjustes.trigger('click')

    // Mismo doble-connect inofensivo del test anterior: usar la instancia viva.
    const activa = instancias.find((i) => i.disconnect.mock.calls.length === 0)
    expect(activa).toBeTruthy()

    activa.callback([{ isIntersecting: true }])

    expect(reportes.cargarAjustes).toHaveBeenLastCalledWith(1)
  })

  it('click en un producto pendiente selecciona el producto y navega a /buscar', async () => {
    const { wrapper, productos, router } = await montar({
      pendientes: { items: [{ prod_id: 42, nombre: 'Tornillo', ultimo_conteo: null }], total: 1 },
    })

    const boton = wrapper.findAll('button').find((b) => b.text().includes('Tornillo'))
    await boton.trigger('click')
    await flushPromises()

    expect(productos.seleccionar).toHaveBeenCalledWith(42)
    expect(router.currentRoute.value.name).toBe('buscar')
  })

  it('click en un producto con ajustes selecciona el producto y navega a /buscar', async () => {
    const { wrapper, productos, router } = await montar({
      ajustes: { items: [{ prod_id: 7, nombre: 'Tuerca', cantidad_ajustes: 3 }], total: 1 },
    })
    const botonAjustes = wrapper.findAll('button').find((b) => b.text().includes('Ajustes frecuentes'))
    await botonAjustes.trigger('click')

    const boton = wrapper.findAll('button').find((b) => b.text().includes('Tuerca'))
    await boton.trigger('click')
    await flushPromises()

    expect(productos.seleccionar).toHaveBeenCalledWith(7)
    expect(router.currentRoute.value.name).toBe('buscar')
  })

  it('muestra el total de pendientes en el texto', async () => {
    const { wrapper } = await montar({ pendientes: { items: [], total: 12 } })

    expect(wrapper.text()).toContain('12')
  })
})
