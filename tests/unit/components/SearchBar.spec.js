import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { useProductosStore } from '../../../src/stores/productos'
import SearchBar from '../../../src/components/SearchBar.vue'

// createTestingPinia stubea acciones por default: productos.buscar() se
// convierte en un spy que NO ejecuta el reducer real, así que estados como
// "cargando"/"resultados" hay que setearlos a mano en el estado inicial (o
// via $patch) para poder testear el WIRING propio de SearchBar (ver plan,
// problema de testabilidad #7). La lógica real de buscar() ya está cubierta
// en tests/unit/stores/productos.spec.js.
function montar({ resultados = [], recientes = [], cargando = false, margenObjetivo = 30 } = {}) {
  const pinia = createTestingPinia({
    stubActions: true,
    initialState: {
      productos: { resultados, recientes, cargando, actual: null, error: '' },
      auth: { config: { margen_objetivo_pct: margenObjetivo } },
    },
  })
  const wrapper = mount(SearchBar, { global: { plugins: [pinia], stubs: { EscanerCodigo: true } } })
  const productos = useProductosStore()
  return { wrapper, productos, pinia }
}

const DROPDOWN = '.absolute.z-40'

describe('components/SearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('no dispara la búsqueda antes de los 300ms de debounce', async () => {
    const { wrapper, productos } = montar()

    await wrapper.find('input').setValue('torn')

    expect(productos.buscar).not.toHaveBeenCalled()
  })

  it('tras 300ms sin más tecleo, dispara la búsqueda una sola vez', async () => {
    const { wrapper, productos } = montar()

    await wrapper.find('input').setValue('torn')
    vi.advanceTimersByTime(300)
    await flushPromises()

    expect(productos.buscar).toHaveBeenCalledTimes(1)
    expect(productos.buscar).toHaveBeenCalledWith('torn')
  })

  it('tipeo rápido dentro de la ventana de 300ms dispara UNA sola búsqueda, con el último valor', async () => {
    const { wrapper, productos } = montar()
    const input = wrapper.find('input')

    await input.setValue('t')
    vi.advanceTimersByTime(100)
    await input.setValue('to')
    vi.advanceTimersByTime(100)
    await input.setValue('torn')
    vi.advanceTimersByTime(300)
    await flushPromises()

    expect(productos.buscar).toHaveBeenCalledTimes(1)
    expect(productos.buscar).toHaveBeenCalledWith('torn')
  })

  it('vaciar el input limpia resultados INMEDIATAMENTE, sin esperar el debounce', async () => {
    const { wrapper, productos } = montar({ resultados: [{ prod_id: 1 }] })
    const input = wrapper.find('input')

    await input.setValue('torn')
    await input.setValue('')

    expect(productos.resultados).toEqual([])
    expect(productos.buscar).not.toHaveBeenCalled()
  })

  it('focus con query no vacío muestra el dropdown', async () => {
    const { wrapper } = montar()
    const input = wrapper.find('input')

    await input.setValue('torn')
    await input.trigger('focus')

    expect(wrapper.find(DROPDOWN).exists()).toBe(true)
  })

  it('focus con query vacío NO muestra el dropdown', async () => {
    const { wrapper } = montar()

    await wrapper.find('input').trigger('focus')

    expect(wrapper.find(DROPDOWN).exists()).toBe(false)
  })

  it('blur oculta el dropdown tras ~150ms (da tiempo a que un click en un resultado se registre)', async () => {
    const { wrapper } = montar()
    const input = wrapper.find('input')
    await input.setValue('torn')
    await input.trigger('focus')
    expect(wrapper.find(DROPDOWN).exists()).toBe(true)

    await input.trigger('blur')
    vi.advanceTimersByTime(149)
    await wrapper.vm.$nextTick()
    expect(wrapper.find(DROPDOWN).exists()).toBe(true)

    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find(DROPDOWN).exists()).toBe(false)
  })

  it('con productos.cargando=true, el dropdown muestra "Buscando..."', async () => {
    const { wrapper } = montar({ cargando: true })
    const input = wrapper.find('input')

    await input.setValue('torn')
    vi.advanceTimersByTime(300)
    await flushPromises()

    expect(wrapper.text()).toContain('Buscando...')
  })

  it('sin resultados y sin cargando, muestra el mensaje de "sin resultados"', async () => {
    const { wrapper } = montar({ resultados: [], cargando: false })
    const input = wrapper.find('input')

    await input.setValue('torn')
    vi.advanceTimersByTime(300)
    await flushPromises()

    expect(wrapper.text()).toContain('Sin resultados. Probá con el código.')
  })

  it('con resultados, renderiza un botón por resultado; click emite select y limpia/oculta el dropdown', async () => {
    const item = { prod_id: 5, nombre: 'Tornillo 3mm', codigo: 'T-5', marca: 'Acme', stock_actual: 10, margen_pct: 40 }
    const { wrapper } = montar({ resultados: [item] })
    const input = wrapper.find('input')

    await input.setValue('torn')
    vi.advanceTimersByTime(300)
    await flushPromises()

    const boton = wrapper.findAll('button').find((b) => b.text().includes('Tornillo 3mm'))
    expect(boton).toBeTruthy()

    await boton.trigger('mousedown')

    expect(wrapper.emitted('select')).toEqual([[5]])
    expect(input.element.value).toBe('')
    expect(wrapper.find(DROPDOWN).exists()).toBe(false)
  })

  it('badge de margen: rojo si margen_pct < margen objetivo, verde si no', async () => {
    const bajo = { prod_id: 1, nombre: 'Producto Bajo', codigo: '1', marca: '', stock_actual: 1, margen_pct: 10 }
    const alto = { prod_id: 2, nombre: 'Producto Alto', codigo: '2', marca: '', stock_actual: 1, margen_pct: 50 }
    const { wrapper } = montar({ resultados: [bajo, alto], margenObjetivo: 30 })
    const input = wrapper.find('input')

    await input.setValue('producto')
    vi.advanceTimersByTime(300)
    await flushPromises()

    const botonBajo = wrapper.findAll('button').find((b) => b.text().includes('Producto Bajo'))
    const botonAlto = wrapper.findAll('button').find((b) => b.text().includes('Producto Alto'))
    expect(botonBajo.find('span').classes()).toContain('text-danger')
    expect(botonAlto.find('span').classes()).toContain('text-success')
  })

  it('sin query, muestra chips de "recientes"; click en un chip emite select', async () => {
    const reciente = { prod_id: 9, nombre: 'Reciente X' }
    const { wrapper } = montar({ recientes: [reciente] })

    const chip = wrapper.findAll('button').find((b) => b.text() === 'Reciente X')
    expect(chip).toBeTruthy()

    await chip.trigger('click')

    expect(wrapper.emitted('select')).toEqual([[9]])
  })

  it('con query tipeada, NO muestra los chips de recientes', async () => {
    const reciente = { prod_id: 9, nombre: 'Reciente X' }
    const { wrapper } = montar({ recientes: [reciente] })

    await wrapper.find('input').setValue('algo')

    expect(wrapper.findAll('button').some((b) => b.text() === 'Reciente X')).toBe(false)
  })

  it('botón "limpiar" (x): visible solo con query no vacío; click limpia query y oculta el dropdown', async () => {
    const { wrapper } = montar()
    const input = wrapper.find('input')
    expect(wrapper.find('.fa-xmark').exists()).toBe(false)

    await input.setValue('algo')
    const botonLimpiar = wrapper.findAll('button').find((b) => b.find('.fa-xmark').exists())
    expect(botonLimpiar).toBeTruthy()

    await botonLimpiar.trigger('click')

    expect(input.element.value).toBe('')
    expect(wrapper.find(DROPDOWN).exists()).toBe(false)
  })

  describe('escanear código de barras', () => {
    it('el botón de escanear abre el escáner (y con texto escrito se reemplaza por limpiar)', async () => {
      const { wrapper } = montar()

      await wrapper.find('button[aria-label="Escanear código de barras"]').trigger('click')
      expect(wrapper.findComponent({ name: 'EscanerCodigo' }).exists()).toBe(true)

      await wrapper.find('input').setValue('torn')
      expect(wrapper.find('button[aria-label="Escanear código de barras"]').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="Limpiar búsqueda"]').exists()).toBe(true)
    })

    it('código que coincide exacto con un producto: lo abre directo', async () => {
      const { wrapper, productos } = montar()
      productos.buscar.mockImplementation(async () => {
        productos.resultados = [
          { prod_id: 7, codigo: '7790001234567', nombre: 'Tornillo', marca: 'X', stock_actual: 1, margen_pct: 40 },
        ]
      })
      await wrapper.find('button[aria-label="Escanear código de barras"]').trigger('click')

      wrapper.findComponent({ name: 'EscanerCodigo' }).vm.$emit('detectado', '7790001234567')
      await flushPromises()

      expect(productos.buscar).toHaveBeenCalledWith('7790001234567')
      expect(wrapper.emitted('select')).toEqual([[7]])
      expect(wrapper.findComponent({ name: 'EscanerCodigo' }).exists()).toBe(false)
    })

    it('sin coincidencia exacta: deja el código en el buscador con los resultados, sin buscar dos veces', async () => {
      const { wrapper, productos } = montar()
      productos.buscar.mockImplementation(async () => {
        productos.resultados = [{ prod_id: 8, codigo: 'OTRO', nombre: 'Parecido', marca: 'X', stock_actual: 1, margen_pct: 40 }]
      })
      await wrapper.find('button[aria-label="Escanear código de barras"]').trigger('click')

      wrapper.findComponent({ name: 'EscanerCodigo' }).vm.$emit('detectado', '123')
      await flushPromises()
      vi.advanceTimersByTime(300)
      await flushPromises()

      expect(wrapper.find('input').element.value).toBe('123')
      expect(wrapper.emitted('select')).toBeUndefined()
      expect(wrapper.find(DROPDOWN).text()).toContain('Parecido')
      expect(productos.buscar).toHaveBeenCalledTimes(1)
    })
  })
})
