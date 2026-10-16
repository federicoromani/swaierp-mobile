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

    // Simula lo que hace ajustarStock() del store: pisa una propiedad de actual sin cambiar prod_id.
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

  describe('sincronización costo ↔ venta (ganancia como markup, igual que amproducto.php)', () => {
    const inputCosto = (wrapper) => wrapper.findAll('input[type="number"]')[1]
    const inputVenta = (wrapper) => wrapper.findAll('input[type="number"]')[2]

    it('al cambiar el costo, recalcula la venta manteniendo la ganancia actual', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 150 }) }) // ganancia 50%
      await inputCosto(wrapper).setValue(200)

      expect(inputVenta(wrapper).element.value).toBe('300')
    })

    it('redondea la venta recalculada a 2 decimales', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 300, precio_venta: 400 }) }) // ganancia 33,33...%
      await inputCosto(wrapper).setValue(100)

      expect(inputVenta(wrapper).element.value).toBe('133.33')
    })

    it('al cambiar la venta, el costo no se toca y la nueva ganancia se usa en el próximo cambio de costo', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 150 }) })
      await inputVenta(wrapper).setValue(200) // ganancia pasa a 100%

      expect(inputCosto(wrapper).element.value).toBe('100')

      await inputCosto(wrapper).setValue(50)
      expect(inputVenta(wrapper).element.value).toBe('100')
    })

    it('usa ganancia_pct de la API (prod_ganancia) aunque el costo sea 0', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 0, precio_venta: 0, ganancia_pct: 40 }) })
      await inputCosto(wrapper).setValue(100)

      expect(inputVenta(wrapper).element.value).toBe('140')
    })

    it('ganancia_pct de la API tiene prioridad sobre la derivada de costo/venta', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 150, ganancia_pct: 25 }) })
      await inputCosto(wrapper).setValue(200)

      expect(inputVenta(wrapper).element.value).toBe('250')
    })

    it('sin ganancia_pct y con costo 0 la ganancia es desconocida: cambiar el costo no mueve la venta', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 0, precio_venta: 150 }) })
      await inputCosto(wrapper).setValue(100)

      expect(inputVenta(wrapper).element.value).toBe('150')
    })

    it('al cambiar de producto, la ganancia se recalcula con los valores del nuevo producto', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1, costo: 100, precio_venta: 150 }) })
      productos.actual = productoBase({ prod_id: 2, costo: 100, precio_venta: 120 }) // ganancia 20%
      await wrapper.vm.$nextTick()

      await inputCosto(wrapper).setValue(200)
      expect(inputVenta(wrapper).element.value).toBe('240')
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

  describe('guardar()', () => {
    const inputStock = (wrapper) => wrapper.findAll('input[type="number"]')[0]
    const inputVenta = (wrapper) => wrapper.findAll('input[type="number"]')[2]
    const botonGuardar = (wrapper) => botonPorTexto(wrapper, 'Guardar cambios')

    it('sin cambios el botón queda deshabilitado', () => {
      const { wrapper } = montar({ actual: productoBase() })
      expect(botonGuardar(wrapper).attributes('disabled')).toBeDefined()
    })

    it('solo cambió el precio: llama actualizarPrecio (no ajustarStock) y muestra "Precio actualizado."', async () => {
      const { wrapper, productos, ui } = montar({
        actual: productoBase({ prod_id: 1, costo: 100, precio_venta: 150 }),
      })
      productos.actualizarPrecio.mockResolvedValue({ success: true })
      await inputVenta(wrapper).setValue(180)

      await botonGuardar(wrapper).trigger('click')
      await flushPromises()

      expect(productos.actualizarPrecio).toHaveBeenCalledWith(1, 100, 180)
      expect(productos.ajustarStock).not.toHaveBeenCalled()
      expect(ui.mostrarToast).toHaveBeenCalledWith('Precio actualizado.', 'success')
    })

    it('solo cambió el stock: llama ajustarStock (no actualizarPrecio) y muestra el stock devuelto por el backend', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.ajustarStock.mockResolvedValue({ success: true, stock_actual: 999 })
      await inputStock(wrapper).setValue(12)

      await botonGuardar(wrapper).trigger('click')
      await flushPromises()

      expect(productos.ajustarStock).toHaveBeenCalledWith(1, 12)
      expect(productos.actualizarPrecio).not.toHaveBeenCalled()
      expect(inputStock(wrapper).element.value).toBe('999')
      expect(ui.mostrarToast).toHaveBeenCalledWith('Stock actualizado.', 'success')
    })

    it('cambiaron los dos: guarda ambos y muestra un solo toast', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.ajustarStock.mockResolvedValue({ success: true, stock_actual: 12 })
      productos.actualizarPrecio.mockResolvedValue({ success: true })
      await inputStock(wrapper).setValue(12)
      await inputVenta(wrapper).setValue(180)

      await botonGuardar(wrapper).trigger('click')
      await flushPromises()

      expect(productos.ajustarStock).toHaveBeenCalledWith(1, 12)
      expect(productos.actualizarPrecio).toHaveBeenCalledWith(1, 100, 180)
      expect(ui.mostrarToast).toHaveBeenCalledWith('Stock y precio actualizados.', 'success')
    })

    it('después de guardar el precio, el form muestra lo que persistió el backend y deja de haber cambios', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1, costo: 100, precio_venta: 150 }) })
      productos.actualizarPrecio.mockImplementation(async () => {
        productos.actual = productoBase({ prod_id: 1, costo: 100, precio_venta: 179.99 })
        return productos.actual
      })
      await inputVenta(wrapper).setValue(180)

      await botonGuardar(wrapper).trigger('click')
      await flushPromises()

      expect(inputVenta(wrapper).element.value).toBe('179.99')
      expect(botonGuardar(wrapper).attributes('disabled')).toBeDefined()
    })

    it('si falla el precio pero el stock se guardó, lo dice y conserva lo tipeado en el precio', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.ajustarStock.mockResolvedValue({ success: true, stock_actual: 12 })
      productos.actualizarPrecio.mockRejectedValue(new Error('El precio de venta debe ser mayor al costo.'))
      await inputStock(wrapper).setValue(12)
      await inputVenta(wrapper).setValue(90)

      await botonGuardar(wrapper).trigger('click')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith(
        'Se guardó el stock, pero no el precio: El precio de venta debe ser mayor al costo.',
        'error'
      )
      expect(inputVenta(wrapper).element.value).toBe('90')
    })

    it('si solo se intentó una parte y falla, muestra el mensaje de la excepción tal cual', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.ajustarStock.mockRejectedValue(new Error('Stock inválido.'))
      await inputStock(wrapper).setValue(7)

      await botonGuardar(wrapper).trigger('click')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith('Stock inválido.', 'error')
      expect(inputStock(wrapper).element.value).toBe('7')
    })

    it('si fallan las dos partes, informa ambos errores', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.ajustarStock.mockRejectedValue(new Error('Stock inválido.'))
      productos.actualizarPrecio.mockRejectedValue(new Error('Precio inválido.'))
      await inputStock(wrapper).setValue(7)
      await inputVenta(wrapper).setValue(180)

      await botonGuardar(wrapper).trigger('click')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith('Stock: Stock inválido. Precio: Precio inválido.', 'error')
    })

    it('mientras guarda, el botón queda disabled, dice "Guardando..." y un segundo click no dispara otro guardado', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1 }) })
      let resolver
      productos.actualizarPrecio.mockReturnValue(
        new Promise((resolve) => {
          resolver = resolve
        })
      )
      await inputVenta(wrapper).setValue(180)

      const boton = botonGuardar(wrapper)
      // Doble click sincrónico: el segundo llega antes de que el :disabled se aplique.
      boton.element.click()
      boton.element.click()
      await wrapper.vm.$nextTick()

      expect(productos.actualizarPrecio).toHaveBeenCalledTimes(1)
      const guardando = botonPorTexto(wrapper, 'Guardando...')
      expect(guardando).toBeTruthy()
      expect(guardando.attributes('disabled')).toBeDefined()

      resolver({ success: true })
      await flushPromises()
      expect(botonGuardar(wrapper)).toBeTruthy()
    })
  })

  describe('reiniciar', () => {
    const inputStock = (wrapper) => wrapper.findAll('input[type="number"]')[0]
    const inputCosto = (wrapper) => wrapper.findAll('input[type="number"]')[1]
    const inputVenta = (wrapper) => wrapper.findAll('input[type="number"]')[2]
    const botonReiniciar = (wrapper) => wrapper.find('button[aria-label="Reiniciar valores"]')

    it('sin cambios no se muestra', () => {
      const { wrapper } = montar({ actual: productoBase() })
      expect(botonReiniciar(wrapper).exists()).toBe(false)
    })

    it('con cambios sin guardar, vuelve stock, costo, venta y ganancia a los valores del producto', async () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 10, costo: 100, precio_venta: 150 }) })
      await inputStock(wrapper).setValue(3)
      await inputVenta(wrapper).setValue(300) // ganancia pasa a 200%

      await botonReiniciar(wrapper).trigger('click')

      expect(inputStock(wrapper).element.value).toBe('10')
      expect(inputCosto(wrapper).element.value).toBe('100')
      expect(inputVenta(wrapper).element.value).toBe('150')
      expect(botonReiniciar(wrapper).exists()).toBe(false)

      // La ganancia también volvió a 50%.
      await inputCosto(wrapper).setValue(200)
      expect(inputVenta(wrapper).element.value).toBe('300')
    })

    it('si el valor vuelve a coincidir con el guardado, deja de haber cambios', async () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 10 }) })
      await inputStock(wrapper).setValue(11)
      expect(botonReiniciar(wrapper).exists()).toBe(true)

      await inputStock(wrapper).setValue(10)
      expect(botonReiniciar(wrapper).exists()).toBe(false)
    })
  })
})
