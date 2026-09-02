import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { useProductosStore } from '../../../src/stores/productos'
import { useUiStore } from '../../../src/stores/ui'
import ProductoCard from '../../../src/components/ProductoCard.vue'

function productoBase(overrides = {}) {
  return {
    prod_id: 1,
    nombre: 'Tornillo',
    codigo: 'T-1',
    categoria: 'Ferretería',
    stock_actual: 10,
    costo: 100,
    precio_venta: 150,
    ultimo_ajuste_precio: null,
    ultimo_conteo: null,
    historial: [],
    ...overrides,
  }
}

function montar({ actual = null, margenObjetivo = 30, config } = {}) {
  const pinia = createTestingPinia({
    stubActions: true,
    initialState: {
      productos: { actual, resultados: [], recientes: [], cargando: false, error: '' },
      auth: { config: config ?? { margen_objetivo_pct: margenObjetivo } },
      ui: { toast: null },
    },
  })
  const wrapper = mount(ProductoCard, { global: { plugins: [pinia] } })
  const productos = useProductosStore()
  const ui = useUiStore()
  return { wrapper, productos, ui, pinia }
}

function botonPorTexto(wrapper, texto) {
  return wrapper.findAll('button').find((b) => b.text().includes(texto))
}

describe('components/ProductoCard', () => {
  it('sin producto seleccionado no renderiza nada', () => {
    const { wrapper } = montar({ actual: null })
    expect(wrapper.text()).toBe('')
  })

  it('el watch (immediate) precarga el form con los valores del producto', () => {
    const { wrapper } = montar({ actual: productoBase({ stock_actual: 10, costo: 100, precio_venta: 150 }) })
    const inputs = wrapper.findAll('input[type="number"]')

    expect(inputs[0].element.value).toBe('10') // stock
    expect(inputs[1].element.value).toBe('100') // costo
    expect(inputs[2].element.value).toBe('150') // precioVenta
  })

  it('resetea el form cuando cambia el prod_id de productos.actual', async () => {
    const { wrapper, productos } = montar({
      actual: productoBase({ prod_id: 1, stock_actual: 10, costo: 100, precio_venta: 150 }),
    })
    await wrapper.findAll('input[type="number"]')[1].setValue(999) // el usuario edita costo sin guardar

    productos.actual = productoBase({ prod_id: 2, stock_actual: 5, costo: 20, precio_venta: 40 })
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('input[type="number"]')[1].element.value).toBe('20')
  })

  it('NO resetea el form si productos.actual cambia pero el prod_id sigue siendo el mismo', async () => {
    const { wrapper, productos } = montar({
      actual: productoBase({ prod_id: 1, stock_actual: 10, costo: 100, precio_venta: 150 }),
    })
    await wrapper.findAll('input[type="number"]')[1].setValue(999) // edición del usuario en costo

    // Simula lo que hace guardarStock(): pisa una propiedad de actual sin cambiar prod_id.
    productos.actual = { ...productos.actual, stock_actual: 777 }
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('input[type="number"]')[1].element.value).toBe('999')
  })

  describe('margenActual', () => {
    it('calcula (venta-costo)/venta*100 y lo formatea con 1 decimal en es-AR', () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 150 }) })
      expect(wrapper.text()).toContain('33,3%')
    })

    it('con costo=0 el margen es 100%', () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 0, precio_venta: 150 }) })
      expect(wrapper.text()).toContain('100,0%')
    })

    it('con costo mayor al precio de venta, el margen es negativo', () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 200, precio_venta: 150 }) })
      expect(wrapper.text()).toContain('-33,3%')
    })

    it('con precioVenta=0 devuelve 0 (nunca NaN/Infinity)', () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 50, precio_venta: 0 }) })
      expect(wrapper.text()).toContain('0,0%')
      expect(wrapper.text()).not.toContain('NaN')
      expect(wrapper.text()).not.toContain('Infinity')
    })

    it('con el input de precioVenta vacío, trata el valor como 0 sin explotar', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 50, precio_venta: 150 }) })
      await wrapper.findAll('input[type="number"]')[2].setValue('')

      expect(wrapper.text()).toContain('0,0%')
    })
  })

  describe('margenBajo', () => {
    it('margen por debajo del objetivo muestra la advertencia', () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 110 }) }) // ~9%
      expect(wrapper.text()).toContain('El margen quedó por debajo del mínimo definido.')
    })

    it('margen igual o por encima del objetivo NO muestra la advertencia', () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 50, precio_venta: 150 }) }) // 66%
      expect(wrapper.text()).not.toContain('El margen quedó por debajo del mínimo definido.')
    })

    it('sin margen_objetivo_pct en auth.config, usa 30 como default', () => {
      const { wrapper } = montar({
        actual: productoBase({ costo: 100, precio_venta: 110 }),
        config: {},
      })
      expect(wrapper.text()).toContain('>= 30%')
    })
  })

  describe('ajustarStepper', () => {
    it('incrementa y decrementa el stock de a 1', async () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 5 }) })

      await botonPorTexto(wrapper, '+').trigger('click')
      expect(wrapper.findAll('input[type="number"]')[0].element.value).toBe('6')

      await botonPorTexto(wrapper, '−').trigger('click')
      expect(wrapper.findAll('input[type="number"]')[0].element.value).toBe('5')
    })

    it('nunca baja de 0', async () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 0 }) })

      await botonPorTexto(wrapper, '−').trigger('click')

      expect(wrapper.findAll('input[type="number"]')[0].element.value).toBe('0')
    })
  })

  describe('guardarPrecio()', () => {
    it('en éxito llama actualizarPrecio con los valores actuales del form y muestra toast success', async () => {
      const { wrapper, productos, ui } = montar({
        actual: productoBase({ prod_id: 1, costo: 100, precio_venta: 150 }),
      })
      productos.actualizarPrecio.mockResolvedValue({ success: true })

      await botonPorTexto(wrapper, 'Guardar precio').trigger('click')
      await flushPromises()

      expect(productos.actualizarPrecio).toHaveBeenCalledWith(1, 100, 150)
      expect(ui.mostrarToast).toHaveBeenCalledWith('Precio actualizado.', 'success')
    })

    it('en error muestra un toast con el mensaje de la excepción', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1 }) })
      productos.actualizarPrecio.mockRejectedValue(new Error('Precio inválido.'))

      await botonPorTexto(wrapper, 'Guardar precio').trigger('click')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith('Precio inválido.', 'error')
    })

    it('mientras guarda, el botón queda disabled y dice "Guardando..."', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1 }) })
      let resolver
      productos.actualizarPrecio.mockReturnValue(
        new Promise((resolve) => {
          resolver = resolve
        })
      )

      await botonPorTexto(wrapper, 'Guardar precio').trigger('click')
      await wrapper.vm.$nextTick()

      const boton = botonPorTexto(wrapper, 'Guardando...')
      expect(boton).toBeTruthy()
      expect(boton.attributes('disabled')).toBeDefined()

      resolver({ success: true })
      await flushPromises()
      expect(botonPorTexto(wrapper, 'Guardar precio')).toBeTruthy()
    })
  })

  describe('guardarStock()', () => {
    it('en éxito actualiza el input con el stock_actual devuelto por el backend (no el tipeado)', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.ajustarStock.mockResolvedValue({ success: true, stock_actual: 999 })

      await botonPorTexto(wrapper, 'Guardar stock').trigger('click')
      await flushPromises()

      expect(wrapper.findAll('input[type="number"]')[0].element.value).toBe('999')
      expect(ui.mostrarToast).toHaveBeenCalledWith('Stock actualizado.', 'success')
    })

    it('en error muestra un toast y NO toca lo que el usuario tenía tipeado', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.ajustarStock.mockRejectedValue(new Error('Stock inválido.'))
      await wrapper.findAll('input[type="number"]')[0].setValue(7)

      await botonPorTexto(wrapper, 'Guardar stock').trigger('click')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith('Stock inválido.', 'error')
      expect(wrapper.findAll('input[type="number"]')[0].element.value).toBe('7')
    })

    it('mientras guarda, el botón queda disabled y dice "Guardando..." (guardandoStock, independiente de guardandoPrecio)', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1 }) })
      let resolver
      productos.ajustarStock.mockReturnValue(
        new Promise((resolve) => {
          resolver = resolve
        })
      )

      await botonPorTexto(wrapper, 'Guardar stock').trigger('click')
      await wrapper.vm.$nextTick()

      const boton = botonPorTexto(wrapper, 'Guardando...')
      expect(boton).toBeTruthy()
      expect(boton.attributes('disabled')).toBeDefined()
      // El botón de precio no debe quedar afectado por guardandoStock (flags independientes).
      expect(botonPorTexto(wrapper, 'Guardar precio')).toBeTruthy()
      expect(botonPorTexto(wrapper, 'Guardar precio').attributes('disabled')).toBeUndefined()

      resolver({ success: true, stock_actual: 10 })
      await flushPromises()
      expect(botonPorTexto(wrapper, 'Guardar stock')).toBeTruthy()
    })
  })

  it('renderiza HistorialProducto con productos.actual.historial', () => {
    const { wrapper } = montar({
      actual: productoBase({ historial: [{ tipo: 'precio', costo_anterior: 1, costo_nuevo: 2, fecha: 'f' }] }),
    })

    expect(wrapper.text()).toContain('Historial de este producto')
    expect(wrapper.text()).toContain('Costo $1 → $2')
  })
})
