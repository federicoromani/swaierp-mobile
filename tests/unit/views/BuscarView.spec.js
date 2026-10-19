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
// comoRuta: BuscarView se monta como componente de /buscar dentro de un
// RouterView (hace falta para que registre su guard de salida).
function crearRouterDeTest(comoRuta = false) {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/buscar', name: 'buscar', component: comoRuta ? BuscarView : { template: '<div/>' } },
      { path: '/reportes', name: 'reportes', component: { template: '<div/>' } },
      { path: '/contar', name: 'contar', component: { template: '<div/>' } },
    ],
  })
}

async function montar({ pendientesTotal = 0, pendientesItems = [], pendientesCargados = true, error = '', actual = null, comoRuta = false } = {}) {
  const router = crearRouterDeTest(comoRuta)
  await router.push('/buscar')
  await router.isReady()
  const pinia = createTestingPinia({
    stubActions: true,
    initialState: {
      productos: { resultados: [], recientes: [], actual, cargando: false, error },
      reportes: {
        pendientes: { items: pendientesItems, total: pendientesTotal },
        ajustes: { items: [], total: 0 },
        cargando: false,
        pendientesCargados,
        conteosHoy: 4,
      },
    },
  })
  const wrapper = mount(comoRuta ? { template: '<RouterView />' } : BuscarView, {
    global: { plugins: [router, pinia], stubs: { SearchBar: true, ProductoCard: true } },
  })
  await flushPromises()
  const reportes = useReportesStore()
  const productos = useProductosStore()
  return { wrapper, reportes, productos, router }
}

describe('views/BuscarView', () => {
  it('al montar, llama a reportes.cargarPendientes(0) si todavía no se cargaron', async () => {
    const { reportes } = await montar({ pendientesCargados: false })
    expect(reportes.cargarPendientes).toHaveBeenCalledWith(0)

    const yaCargados = await montar({ pendientesCargados: true })
    expect(yaCargados.reportes.cargarPendientes).not.toHaveBeenCalled()
  })

  it('con un producto elegido, el banner de pendientes se muestra solo si reportes.pendientes.total > 0', async () => {
    const actual = { prod_id: 1, historial: [] }
    const sinBanner = await montar({ pendientesTotal: 0, actual })
    expect(sinBanner.wrapper.text()).not.toContain('sin controlar hace +7 días')

    const conBanner = await montar({ pendientesTotal: 5, actual })
    expect(conBanner.wrapper.text()).toContain('sin controlar hace +7 días')
  })

  it('el banner de error de productos se muestra solo si hay error Y no hay producto actual', async () => {
    const conError = await montar({ error: 'Sin conexión con el servidor.', actual: null })
    expect(conError.wrapper.text()).toContain('Sin conexión con el servidor.')

    const conErrorPeroActual = await montar({ error: 'Sin conexión con el servidor.', actual: { prod_id: 1 } })
    expect(conErrorPeroActual.wrapper.text()).not.toContain('Sin conexión con el servidor.')
  })

  it('sin producto elegido muestra "Para contar hoy" (y con producto no)', async () => {
    const sinActual = await montar({ actual: null })
    expect(sinActual.wrapper.find('section[aria-label="Para contar hoy"]').exists()).toBe(true)
    expect(sinActual.wrapper.text()).toContain('Hoy contaste 4')

    const conActual = await montar({ actual: { prod_id: 1, historial: [] } })
    expect(conActual.wrapper.find('section[aria-label="Para contar hoy"]').exists()).toBe(false)
  })

  it('"Para contar hoy": los 3 más urgentes, cada uno abre el modo conteo en ese producto', async () => {
    const items = [1, 2, 3, 4].map((id) => ({ prod_id: id, nombre: 'Producto ' + id, ultimo_conteo: null }))
    const { wrapper, router } = await montar({ pendientesTotal: 12, pendientesItems: items })

    expect(wrapper.text()).toContain('12 productos sin contar hace +7 días')
    expect(wrapper.text()).toContain('Producto 3')
    expect(wrapper.text()).not.toContain('Producto 4')

    await wrapper.findAll('button').find((b) => b.text().includes('Producto 2')).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/contar?desde=2')
  })

  it('"Empezar a contar (N)" abre el modo conteo', async () => {
    const { wrapper, router } = await montar({ pendientesTotal: 3, pendientesItems: [{ prod_id: 1, nombre: 'A' }] })

    await wrapper.findAll('button').find((b) => b.text().includes('Empezar a contar (3)')).trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/contar')
  })

  it('sin pendientes (ya cargados) dice que está todo al día', async () => {
    const { wrapper } = await montar({ pendientesTotal: 0 })
    expect(wrapper.text()).toContain('Todo al día')

    const cargando = await montar({ pendientesTotal: 0, pendientesCargados: false })
    expect(cargando.wrapper.text()).not.toContain('Todo al día')
  })

  it('click en "Contar" del banner abre el modo conteo', async () => {
    const { wrapper, router } = await montar({ pendientesTotal: 3, actual: { prod_id: 1, historial: [] } })

    const boton = wrapper.findAll('button').find((b) => b.text() === 'Contar')
    await boton.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/contar')
  })

  describe('cambios sin guardar', () => {
    it('elegir otro producto pregunta antes; "Seguir editando" no cambia nada', async () => {
      const { wrapper, productos } = await montar({ actual: { prod_id: 1, nombre: 'Tornillo', historial: [] } })
      productos.cambiosSinGuardar = true

      wrapper.findComponent({ name: 'SearchBar' }).vm.$emit('select', 2)
      await flushPromises()

      expect(productos.seleccionar).not.toHaveBeenCalled()
      expect(wrapper.find('[role="alertdialog"]').text()).toContain('Tornillo')

      await wrapper.findAll('button').find((b) => b.text() === 'Seguir editando').trigger('click')
      expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
      expect(productos.seleccionar).not.toHaveBeenCalled()
    })

    it('"Descartar" sigue con el producto elegido', async () => {
      const { wrapper, productos } = await montar({ actual: { prod_id: 1, nombre: 'Tornillo', historial: [] } })
      productos.cambiosSinGuardar = true

      wrapper.findComponent({ name: 'SearchBar' }).vm.$emit('select', 2)
      await flushPromises()
      await wrapper.findAll('button').find((b) => b.text() === 'Descartar').trigger('click')

      expect(productos.seleccionar).toHaveBeenCalledWith(2)
      expect(productos.cambiosSinGuardar).toBe(false)
    })

    it('sin cambios, elegir otro producto no pregunta', async () => {
      const { wrapper, productos } = await montar({ actual: { prod_id: 1, historial: [] } })

      wrapper.findComponent({ name: 'SearchBar' }).vm.$emit('select', 2)
      await flushPromises()

      expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
      expect(productos.seleccionar).toHaveBeenCalledWith(2)
    })

    it('irse a otra pantalla pregunta antes y, al descartar, navega', async () => {
      const { wrapper, productos, router } = await montar({
        actual: { prod_id: 1, nombre: 'Tornillo', historial: [] },
        comoRuta: true,
      })
      productos.cambiosSinGuardar = true

      await router.push('/reportes')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/buscar')
      expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true)

      await wrapper.findAll('button').find((b) => b.text() === 'Descartar').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/reportes')
    })
  })

  describe('código escaneado sin producto', () => {
    it('sin producto abierto: avisa con el código y se puede descartar', async () => {
      const { wrapper } = await montar()

      wrapper.findComponent({ name: 'SearchBar' }).vm.$emit('sin-producto', '7790001112223')
      await flushPromises()
      expect(wrapper.text()).toContain('Ningún producto tiene el código 7790001112223')

      await wrapper.find('button[aria-label="Descartar código escaneado"]').trigger('click')
      expect(wrapper.text()).not.toContain('Ningún producto tiene el código')
    })

    it('con un producto abierto se lo pasa a la card, y se limpia al asignarlo', async () => {
      const { wrapper } = await montar({ actual: { prod_id: 1, historial: [] } })
      const card = () => wrapper.findComponent({ name: 'ProductoCard' })

      wrapper.findComponent({ name: 'SearchBar' }).vm.$emit('sin-producto', '123')
      await flushPromises()
      expect(card().props('codigoPorAsignar')).toBe('123')
      expect(wrapper.text()).not.toContain('Ningún producto tiene el código')

      card().vm.$emit('codigo-asignado', '123')
      await flushPromises()
      expect(card().props('codigoPorAsignar')).toBeNull()
    })

    it('escanear después un producto que existe descarta el código pendiente', async () => {
      const { wrapper } = await montar({ actual: { prod_id: 1, historial: [] } })
      const searchBar = wrapper.findComponent({ name: 'SearchBar' })

      searchBar.vm.$emit('sin-producto', '123')
      await flushPromises()
      searchBar.vm.$emit('select', 1, { escaneado: true })
      await flushPromises()

      expect(wrapper.findComponent({ name: 'ProductoCard' }).props('codigoPorAsignar')).toBeNull()
    })

    it('elegir un producto buscando a mano mantiene el código para asignárselo', async () => {
      const { wrapper } = await montar({ actual: { prod_id: 1, historial: [] } })
      const searchBar = wrapper.findComponent({ name: 'SearchBar' })

      searchBar.vm.$emit('sin-producto', '123')
      await flushPromises()
      searchBar.vm.$emit('select', 1, { escaneado: false })
      await flushPromises()

      expect(wrapper.findComponent({ name: 'ProductoCard' }).props('codigoPorAsignar')).toBe('123')
    })
  })

  it('renderiza HistorialProducto con productos.actual.historial solo si hay producto actual', async () => {
    const conActual = await montar({
      actual: { prod_id: 1, historial: [{ tipo: 'precio', costo_anterior: 1, costo_nuevo: 2, fecha: 'f' }] },
    })
    expect(conActual.wrapper.text()).toContain('Historial de este producto')
    expect(conActual.wrapper.text()).toContain('Costo $1 → $2')

    const sinActual = await montar({ actual: null })
    expect(sinActual.wrapper.text()).not.toContain('Historial de este producto')
  })

  it('el banner de pendientes va debajo de la card del producto y antes del historial', async () => {
    const { wrapper } = await montar({ pendientesTotal: 5, actual: { prod_id: 1, historial: [] } })
    const html = wrapper.html()

    const card = html.indexOf('producto-card-stub')
    const banner = html.indexOf('sin controlar hace +7 días')
    const historial = html.indexOf('Historial de este producto')
    expect(card).toBeGreaterThan(-1)
    expect(card).toBeLessThan(banner)
    expect(banner).toBeLessThan(historial)
  })
})
