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
      { path: '/contar', name: 'contar', component: { template: '<div/>' } },
    ],
  })
}

async function montar({
  pendientes = { items: [], total: 0 },
  ajustes = { items: [], total: 0 },
  cargando = false,
  pendientesCargados = false,
  filtroCategoria = null,
  categorias = [],
} = {}) {
  const router = crearRouterDeTest()
  await router.push('/reportes')
  await router.isReady()
  const pinia = createTestingPinia({
    stubActions: true,
    initialState: {
      reportes: { pendientes, ajustes, cargando, pendientesCargados, filtroCategoria, categorias },
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

    const botonAjustes = wrapper.findAll('button').find((b) => b.text().trim() === 'Ajustes')
    await botonAjustes.trigger('click')

    expect(reportes.cargarAjustes).toHaveBeenCalledWith(0)
    expect(wrapper.text()).toContain('productos con ajustes manuales')
  })

  it('volver a la tab "ajustes" cuando ya tiene items NO vuelve a llamar cargarAjustes (evita refetch)', async () => {
    const { wrapper, reportes } = await montar({ ajustes: { items: [{ prod_id: 1, nombre: 'X', cantidad_ajustes: 2 }], total: 1 } })
    const botonAjustes = wrapper.findAll('button').find((b) => b.text().trim() === 'Ajustes')
    const botonPendientes = wrapper.findAll('button').find((b) => b.text().trim() === 'Pendientes')

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
    const botonAjustes = wrapper.findAll('button').find((b) => b.text().trim() === 'Ajustes')
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
    const botonAjustes = wrapper.findAll('button').find((b) => b.text().trim() === 'Ajustes')
    await botonAjustes.trigger('click')

    // Mismo doble-connect inofensivo del test anterior: usar la instancia viva.
    const activa = instancias.find((i) => i.disconnect.mock.calls.length === 0)
    expect(activa).toBeTruthy()

    activa.callback([{ isIntersecting: true }])

    expect(reportes.cargarAjustes).toHaveBeenLastCalledWith(1)
  })

  it('click en un producto pendiente abre el modo conteo en ese producto', async () => {
    const { wrapper, router } = await montar({
      pendientes: { items: [{ prod_id: 42, nombre: 'Tornillo', ultimo_conteo: null }], total: 1 },
    })

    const boton = wrapper.findAll('button').find((b) => b.text().includes('Tornillo'))
    await boton.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/contar')
    expect(router.currentRoute.value.query).toEqual({ desde: '42' })
  })

  it('click en un producto con ajustes selecciona el producto y navega a /buscar', async () => {
    const { wrapper, productos, router } = await montar({
      ajustes: { items: [{ prod_id: 7, nombre: 'Tuerca', cantidad_ajustes: 3 }], total: 1 },
    })
    const botonAjustes = wrapper.findAll('button').find((b) => b.text().trim() === 'Ajustes')
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
  describe('pendientes: modo conteo, urgencia y categorías', () => {
    it('si la lista ya estaba cargada (volviendo del modo conteo), no la recarga', async () => {
      const { reportes } = await montar({ pendientesCargados: true, pendientes: { items: [], total: 3 } })
      expect(reportes.cargarPendientes).not.toHaveBeenCalled()
      expect(reportes.cargarCategorias).toHaveBeenCalled()
    })

    it('"Empezar a contar (N)" abre el modo conteo con el filtro de categoría activo', async () => {
      const { wrapper, router } = await montar({
        pendientes: { items: [{ prod_id: 1, nombre: 'A', ultimo_conteo: null }], total: 12 },
        filtroCategoria: 5,
      })

      const boton = wrapper.findAll('button').find((b) => b.text().includes('Empezar a contar'))
      expect(boton.text()).toContain('(12)')
      await boton.trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/contar')
      expect(router.currentRoute.value.query).toEqual({ categoria: '5' })
    })

    it('sin pendientes no muestra "Empezar a contar"', async () => {
      const { wrapper } = await montar({ pendientes: { items: [], total: 0 } })
      expect(wrapper.text()).not.toContain('Empezar a contar')
    })

    it('cada fila muestra la categoría (último tramo) y la urgencia: "nunca" en rojo, días relativos', async () => {
      const haceDias = (n) => new Date(Date.now() - n * 86400000).toISOString().replace('T', ' ').slice(0, 19)
      const { wrapper } = await montar({
        pendientes: {
          items: [
            { prod_id: 1, nombre: 'Nunca contado', ultimo_conteo: null, categoria: 'Ferretería > Fijaciones' },
            { prod_id: 2, nombre: 'Vencido', ultimo_conteo: haceDias(12) },
          ],
          total: 2,
        },
      })
      const filas = wrapper.findAll('button').filter((b) => /Nunca contado|Vencido/.test(b.text()))
      expect(filas[0].text()).toContain('Fijaciones')
      expect(filas[0].text()).not.toContain('Ferretería >')
      expect(filas[0].find('.bg-red-100').text()).toBe('nunca')
      expect(filas[1].find('.bg-amber-100').text()).toBe('hace 12 días')
    })

    it('chips de categoría: "Todas" + cada categoría con su cantidad; tocar una filtra', async () => {
      const { wrapper, reportes } = await montar({
        categorias: [
          { categoria_id: 5, nombre: 'Ferretería > Fijaciones', pendientes: 8 },
          { categoria_id: 6, nombre: 'Pinturería', pendientes: 4 },
        ],
      })

      expect(wrapper.text()).toContain('Todas (12)')
      const chip = wrapper.findAll('button').find((b) => b.text().includes('Fijaciones (8)'))
      await chip.trigger('click')

      expect(reportes.filtrarPorCategoria).toHaveBeenCalledWith(5)
    })
  })

  describe('ajustes frecuentes: neto e impacto en $', () => {
    async function montarEnAjustes(items) {
      const r = await montar({ ajustes: { items, total: items.length } })
      await r.wrapper.findAll('button').find((b) => b.text().trim() === 'Ajustes').trigger('click')
      return r
    }

    it('cada fila muestra la diferencia neta con su unidad, el impacto en $ y cuántos ajustes', async () => {
      const { wrapper } = await montarEnAjustes([
        { prod_id: 1, nombre: 'Taladro', unidad: 'UNID', cantidad_ajustes: 3, diferencia_neta: -4, impacto: 120000, ultimo_ajuste: null },
        { prod_id: 2, nombre: 'Clavos', unidad: 'kg', cantidad_ajustes: 1, diferencia_neta: 2.5, impacto: 5000, ultimo_ajuste: null },
        { prod_id: 3, nombre: 'Lija', unidad: 'UNID', cantidad_ajustes: 6, diferencia_neta: 0, impacto: 0, ultimo_ajuste: null },
      ])
      const texto = wrapper.text()

      expect(texto).toContain('-4 u')
      expect(texto).toContain('$120.000')
      expect(texto).toContain('3 ajustes')
      expect(texto).toContain('+2,5 kg')
      expect(texto).toContain('1 ajuste')
      expect(texto).toContain('neto 0')
      expect(texto).toContain('mayor impacto en $ primero')
      expect(texto).not.toContain('Monitorear')
    })

    it('faltante en rojo, sobrante en ámbar', async () => {
      const { wrapper } = await montarEnAjustes([
        { prod_id: 1, nombre: 'A', unidad: 'u', cantidad_ajustes: 1, diferencia_neta: -1, impacto: 10 },
        { prod_id: 2, nombre: 'B', unidad: 'u', cantidad_ajustes: 1, diferencia_neta: 1, impacto: 10 },
      ])
      const netos = wrapper.findAll('.font-bold.whitespace-nowrap')

      expect(netos.find((n) => n.text() === '-1 u').classes()).toContain('text-danger')
      expect(netos.find((n) => n.text() === '+1 u').classes()).toContain('text-amber-700')
    })
  })

  describe('Actualizar', () => {
    it('en Pendientes recarga la lista y las categorías', async () => {
      const { wrapper, reportes } = await montar()

      await wrapper.find('button[aria-label="Actualizar"]').trigger('click')

      expect(reportes.recargarPendientes).toHaveBeenCalledTimes(1)
    })

    it('en Ajustes recarga desde el principio', async () => {
      const { wrapper, reportes } = await montar({ ajustes: { items: [{ prod_id: 1, nombre: 'A', cantidad_ajustes: 1 }], total: 1 } })
      await wrapper.findAll('button').find((b) => b.text().trim() === 'Ajustes').trigger('click')

      await wrapper.find('button[aria-label="Actualizar"]').trigger('click')

      expect(reportes.cargarAjustes).toHaveBeenCalledWith(0)
    })
  })
})
