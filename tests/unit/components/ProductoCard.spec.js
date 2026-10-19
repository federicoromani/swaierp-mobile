import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { useProductosStore } from '../../../src/stores/productos'
import { useUiStore } from '../../../src/stores/ui'
import ProductoCard from '../../../src/components/ProductoCard.vue'
import {
  botonPorTexto,
  inputContado,
  abrirPrecio,
  inputCosto,
  inputVenta,
  botonPrincipal,
} from '../../mocks/producto-card-helpers'

function productoBase(overrides = {}) {
  return {
    prod_id: 1,
    nombre: 'Tornillo',
    codigo: 'T-1',
    marca: 'Fixser',
    categoria: 'Ferretería',
    unidad: 'UNID',
    stock_actual: 10,
    costo: 100,
    precio_venta: 150,
    ultimo_ajuste_precio: null,
    ultimo_conteo: null,
    presentaciones: [],
    historial: [],
    ...overrides,
  }
}

function montar({ actual = null, margenObjetivo = 30, config, props = {} } = {}) {
  const pinia = createTestingPinia({
    stubActions: true,
    initialState: {
      productos: { actual, resultados: [], recientes: [], cargando: false, error: '' },
      auth: { config: config ?? { margen_objetivo_pct: margenObjetivo } },
      ui: { toast: null },
    },
  })
  const wrapper = mount(ProductoCard, { props, global: { plugins: [pinia], stubs: { EscanerCodigo: true } } })
  const productos = useProductosStore()
  const ui = useUiStore()
  return { wrapper, productos, ui, pinia }
}

function haceDias(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('components/ProductoCard', () => {
  it('sin producto seleccionado no renderiza nada', () => {
    const { wrapper } = montar({ actual: null })
    expect(wrapper.text()).toBe('')
  })

  describe('encabezado', () => {
    it('muestra código · marca · categoría y el nombre completo (sin truncar a una línea)', () => {
      const { wrapper } = montar({ actual: productoBase({ nombre: 'Tornillo autoperforante 3/4 x 100u' }) })
      expect(wrapper.text()).toContain('T-1 · Fixser · Ferretería')
      const h2 = wrapper.find('h2')
      expect(h2.text()).toBe('Tornillo autoperforante 3/4 x 100u')
      expect(h2.classes()).toContain('line-clamp-2')
    })

    it('último conteo "nunca" en rojo', () => {
      const { wrapper } = montar({ actual: productoBase({ ultimo_conteo: null }) })
      const linea = wrapper.findAll('p').find((p) => p.text().includes('Último conteo'))
      expect(linea.text()).toContain('Último conteo: nunca')
      expect(linea.classes()).toContain('text-danger')
    })

    it('último conteo relativo: reciente en verde, vencido en ámbar', () => {
      const reciente = montar({ actual: productoBase({ ultimo_conteo: haceDias(2) }) })
      const lineaReciente = reciente.wrapper.findAll('p').find((p) => p.text().includes('Último conteo'))
      expect(lineaReciente.text()).toContain('hace 2 días')
      expect(lineaReciente.classes()).toContain('text-success')

      const vencido = montar({ actual: productoBase({ ultimo_conteo: haceDias(12) }) })
      const lineaVencida = vencido.wrapper.findAll('p').find((p) => p.text().includes('Último conteo'))
      expect(lineaVencida.text()).toContain('hace 12 días')
      expect(lineaVencida.classes()).toContain('text-amber-700')
    })
  })

  describe('conteo', () => {
    it('muestra el stock del sistema con su unidad y el campo "Contado" vacío (no precargado)', () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 25, unidad: 'kg' }) })
      expect(wrapper.text()).toContain('Sistema')
      expect(wrapper.text()).toContain('25')
      expect(inputContado(wrapper).element.value).toBe('')
      expect(inputContado(wrapper).attributes('placeholder')).toBe('25')
    })

    it('teclado numérico para unidades enteras, decimal para el resto', () => {
      const unidades = montar({ actual: productoBase({ unidad: 'UNID' }) })
      expect(inputContado(unidades.wrapper).attributes('inputmode')).toBe('numeric')

      const kilos = montar({ actual: productoBase({ unidad: 'kg' }) })
      expect(inputContado(kilos.wrapper).attributes('inputmode')).toBe('decimal')
    })

    it('diferencia: faltan / sobran / coincide', async () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 10, unidad: 'u' }) })

      await inputContado(wrapper).setValue(7)
      expect(wrapper.text()).toContain('Faltan 3 u')

      await inputContado(wrapper).setValue(12)
      expect(wrapper.text()).toContain('Sobran 2 u')

      await inputContado(wrapper).setValue(10)
      expect(wrapper.text()).toContain('Coincide con el sistema')
    })

    it('el stepper arranca desde el stock del sistema si no se tipeó nada, y nunca baja de 0', async () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 5 }) })

      await botonPorTexto(wrapper, '+').trigger('click')
      expect(inputContado(wrapper).element.value).toBe('6')

      await botonPorTexto(wrapper, '−').trigger('click')
      await botonPorTexto(wrapper, '−').trigger('click')
      expect(inputContado(wrapper).element.value).toBe('4')

      const cero = montar({ actual: productoBase({ stock_actual: 0 }) })
      await botonPorTexto(cero.wrapper, '−').trigger('click')
      expect(inputContado(cero.wrapper).element.value).toBe('0')
    })

    it('contar por envases: suma cajas × factor + sueltas y lo pasa a "Contado"', async () => {
      const { wrapper } = montar({
        actual: productoBase({ presentaciones: [{ id: 9, nombre: 'Caja x 100', factor: 100 }] }),
      })
      await botonPorTexto(wrapper, 'Contar por envases').trigger('click')
      await wrapper.find('#envase-9').setValue(4)
      await wrapper.find('#envase-sueltas').setValue(12)

      const usar = botonPorTexto(wrapper, 'Usar total')
      expect(usar.text()).toContain('412')
      await usar.trigger('click')

      expect(inputContado(wrapper).element.value).toBe('412')
    })

    it('sin presentaciones no muestra "Contar por envases"', () => {
      const { wrapper } = montar({ actual: productoBase({ presentaciones: [] }) })
      expect(botonPorTexto(wrapper, 'Contar por envases')).toBeUndefined()
    })

    it('al cambiar de producto se vacía lo contado', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1 }) })
      await inputContado(wrapper).setValue(999)

      productos.actual = productoBase({ prod_id: 2, stock_actual: 5 })
      await wrapper.vm.$nextTick()

      expect(inputContado(wrapper).element.value).toBe('')
    })

    it('NO se vacía si productos.actual cambia pero el prod_id sigue siendo el mismo', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1 }) })
      await inputContado(wrapper).setValue(999)

      productos.actual = { ...productos.actual, stock_actual: 777 }
      await wrapper.vm.$nextTick()

      expect(inputContado(wrapper).element.value).toBe('999')
    })
  })

  describe('precio y margen (sección colapsable)', () => {
    it('cerrada por defecto, pero el encabezado muestra venta y margen con su color', () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 110 }) }) // ~9%
      expect(wrapper.find('input[aria-label="Precio de venta"]').exists()).toBe(false)
      const encabezado = botonPorTexto(wrapper, 'Precio y margen')
      expect(encabezado.text()).toContain('$110')
      expect(encabezado.find('.bg-red-100').text()).toBe('9,1%')
    })

    it('al abrirla precarga costo y venta del producto', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 150 }) })
      expect((await inputCosto(wrapper)).element.value).toBe('100')
      expect((await inputVenta(wrapper)).element.value).toBe('150')
    })

    it('margen (venta-costo)/venta con 1 decimal es-AR', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 150 }) })
      await abrirPrecio(wrapper)
      expect(wrapper.text()).toContain('33,3%')
    })

    it('con costo=0 el margen es 100%; con costo > venta es negativo', () => {
      expect(montar({ actual: productoBase({ costo: 0, precio_venta: 150 }) }).wrapper.text()).toContain('100,0%')
      expect(montar({ actual: productoBase({ costo: 200, precio_venta: 150 }) }).wrapper.text()).toContain('-33,3%')
    })

    it('con precio de venta 0 o vacío devuelve 0 (nunca NaN/Infinity)', async () => {
      const cero = montar({ actual: productoBase({ costo: 50, precio_venta: 0 }) })
      expect(cero.wrapper.text()).toContain('0,0%')
      expect(cero.wrapper.text()).not.toContain('NaN')

      const vacio = montar({ actual: productoBase({ costo: 50, precio_venta: 150 }) })
      await (await inputVenta(vacio.wrapper)).setValue('')
      expect(vacio.wrapper.text()).toContain('0,0%')
      expect(vacio.wrapper.text()).not.toContain('Infinity')
    })

    it('margen bajo el objetivo: advertencia; objetivo como "Objetivo N%" (30 por defecto)', async () => {
      const bajo = montar({ actual: productoBase({ costo: 100, precio_venta: 110 }), config: {} })
      await abrirPrecio(bajo.wrapper)
      expect(bajo.wrapper.text()).toContain('El margen quedó por debajo del mínimo definido.')
      expect(bajo.wrapper.text()).toContain('Objetivo 30%')

      const ok = montar({ actual: productoBase({ costo: 50, precio_venta: 150 }) })
      await abrirPrecio(ok.wrapper)
      expect(ok.wrapper.text()).not.toContain('El margen quedó por debajo del mínimo definido.')
    })
  })

  describe('sincronización costo ↔ venta (ganancia como markup, igual que amproducto.php)', () => {
    it('al cambiar el costo, recalcula la venta manteniendo la ganancia actual', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 150 }) })
      await (await inputCosto(wrapper)).setValue(200)
      expect((await inputVenta(wrapper)).element.value).toBe('300')
    })

    it('redondea la venta recalculada a 2 decimales', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 300, precio_venta: 400 }) })
      await (await inputCosto(wrapper)).setValue(100)
      expect((await inputVenta(wrapper)).element.value).toBe('133.33')
    })

    it('al cambiar la venta, el costo no se toca y la nueva ganancia se usa en el próximo cambio de costo', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 100, precio_venta: 150 }) })
      await (await inputVenta(wrapper)).setValue(200)
      expect((await inputCosto(wrapper)).element.value).toBe('100')

      await (await inputCosto(wrapper)).setValue(50)
      expect((await inputVenta(wrapper)).element.value).toBe('100')
    })

    it('usa ganancia_pct de la API aunque el costo sea 0, y tiene prioridad sobre la derivada', async () => {
      const cero = montar({ actual: productoBase({ costo: 0, precio_venta: 0, ganancia_pct: 40 }) })
      await (await inputCosto(cero.wrapper)).setValue(100)
      expect((await inputVenta(cero.wrapper)).element.value).toBe('140')

      const prioridad = montar({ actual: productoBase({ costo: 100, precio_venta: 150, ganancia_pct: 25 }) })
      await (await inputCosto(prioridad.wrapper)).setValue(200)
      expect((await inputVenta(prioridad.wrapper)).element.value).toBe('250')
    })

    it('sin ganancia_pct y con costo 0 la ganancia es desconocida: cambiar el costo no mueve la venta', async () => {
      const { wrapper } = montar({ actual: productoBase({ costo: 0, precio_venta: 150 }) })
      await (await inputCosto(wrapper)).setValue(100)
      expect((await inputVenta(wrapper)).element.value).toBe('150')
    })
  })

  describe('guardar()', () => {
    it('sin cambios el botón dice "Coincide: N u" y registra un conteo igual al sistema', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10, unidad: 'u' }) })
      productos.registrarConteo.mockResolvedValue({ success: true, stock_actual: 10, diferencia: 0 })
      expect(botonPrincipal(wrapper).text()).toContain('Coincide: 10 u')

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(productos.registrarConteo).toHaveBeenCalledWith(1, 10)
      expect(productos.actualizarPrecio).not.toHaveBeenCalled()
      expect(ui.mostrarToast).toHaveBeenCalledWith('Conteo registrado: sin diferencias.', 'success')
    })

    it('con lo contado ingresado: "Guardar conteo", manda ese valor y el toast muestra la diferencia con signo', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.registrarConteo.mockResolvedValue({ success: true, stock_actual: 7, diferencia: -3 })
      await inputContado(wrapper).setValue(7)
      expect(botonPrincipal(wrapper).text()).toContain('Guardar conteo')

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(productos.registrarConteo).toHaveBeenCalledWith(1, 7)
      expect(ui.mostrarToast).toHaveBeenCalledWith('Conteo registrado: -3.', 'success')
      // Guardado: lo contado se vacía (ahora el sistema ya dice eso).
      expect(inputContado(wrapper).element.value).toBe('')
    })

    it('solo cambió el precio: "Guardar precio", no registra conteo', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, costo: 100, precio_venta: 150 }) })
      productos.actualizarPrecio.mockResolvedValue({ success: true })
      await (await inputVenta(wrapper)).setValue(180)
      expect(botonPrincipal(wrapper).text()).toContain('Guardar precio')

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(productos.actualizarPrecio).toHaveBeenCalledWith(1, 100, 180)
      expect(productos.registrarConteo).not.toHaveBeenCalled()
      expect(ui.mostrarToast).toHaveBeenCalledWith('Precio actualizado.', 'success')
    })

    it('cambiaron los dos: "Guardar conteo y precio", guarda ambos y muestra un solo toast', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.registrarConteo.mockResolvedValue({ success: true, stock_actual: 12, diferencia: 2 })
      productos.actualizarPrecio.mockResolvedValue({ success: true })
      await inputContado(wrapper).setValue(12)
      await (await inputVenta(wrapper)).setValue(180)
      expect(botonPrincipal(wrapper).text()).toContain('Guardar conteo y precio')

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(productos.registrarConteo).toHaveBeenCalledWith(1, 12)
      expect(productos.actualizarPrecio).toHaveBeenCalledWith(1, 100, 180)
      expect(ui.mostrarToast).toHaveBeenCalledWith('Conteo registrado (+2) y precio actualizado.', 'success')
    })

    it('después de guardar el precio, muestra lo que persistió el backend y deja de haber cambios', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1, costo: 100, precio_venta: 150 }) })
      productos.actualizarPrecio.mockImplementation(async () => {
        productos.actual = productoBase({ prod_id: 1, costo: 100, precio_venta: 179.99 })
        return productos.actual
      })
      await (await inputVenta(wrapper)).setValue(180)

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect((await inputVenta(wrapper)).element.value).toBe('179.99')
      expect(botonPrincipal(wrapper).text()).toContain('Coincide')
    })

    it('si falla el precio pero el conteo se guardó, lo dice y conserva lo tipeado en el precio', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.registrarConteo.mockResolvedValue({ success: true, stock_actual: 12, diferencia: 2 })
      productos.actualizarPrecio.mockRejectedValue(new Error('El precio de venta debe ser mayor al costo.'))
      await inputContado(wrapper).setValue(12)
      await (await inputVenta(wrapper)).setValue(90)

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith(
        'Se guardó el conteo, pero no el precio: El precio de venta debe ser mayor al costo.',
        'error'
      )
      expect((await inputVenta(wrapper)).element.value).toBe('90')
    })

    it('si falla el conteo, muestra el mensaje tal cual y conserva lo contado', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.registrarConteo.mockRejectedValue(new Error('Stock inválido.'))
      await inputContado(wrapper).setValue(7)

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith('Stock inválido.', 'error')
      expect(inputContado(wrapper).element.value).toBe('7')
    })

    it('si fallan las dos partes, informa ambos errores', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.registrarConteo.mockRejectedValue(new Error('Stock inválido.'))
      productos.actualizarPrecio.mockRejectedValue(new Error('Precio inválido.'))
      await inputContado(wrapper).setValue(7)
      await (await inputVenta(wrapper)).setValue(180)

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith('Conteo: Stock inválido. Precio: Precio inválido.', 'error')
    })

    it('mientras guarda: "Guardando...", deshabilitado, y un doble click no dispara otro guardado', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1 }) })
      let resolver
      productos.registrarConteo.mockReturnValue(new Promise((resolve) => (resolver = resolve)))
      await inputContado(wrapper).setValue(8)

      const boton = botonPrincipal(wrapper)
      boton.element.click()
      boton.element.click()
      await wrapper.vm.$nextTick()

      expect(productos.registrarConteo).toHaveBeenCalledTimes(1)
      expect(botonPrincipal(wrapper).text()).toContain('Guardando...')
      expect(botonPrincipal(wrapper).attributes('disabled')).toBeDefined()

      resolver({ success: true, stock_actual: 8, diferencia: -2 })
      await flushPromises()
      expect(botonPrincipal(wrapper).text()).not.toContain('Guardando...')
    })

    it('al guardar con éxito vibra y emite "guardado" (lo usa el modo conteo para pasar al siguiente)', async () => {
      const vibrate = vi.fn()
      vi.stubGlobal('navigator', { ...navigator, vibrate })
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1, stock_actual: 10 }) })
      productos.registrarConteo.mockResolvedValue({ success: true, stock_actual: 9, diferencia: -1 })
      await inputContado(wrapper).setValue(9)

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(vibrate).toHaveBeenCalled()
      expect(wrapper.emitted('guardado')).toEqual([[{ conteo: true, diferencia: -1 }]])
    })

    it('si todo falla, no emite "guardado"', async () => {
      const { wrapper, productos } = montar({ actual: productoBase({ prod_id: 1 }) })
      productos.registrarConteo.mockRejectedValue(new Error('x'))

      await botonPrincipal(wrapper).trigger('click')
      await flushPromises()

      expect(wrapper.emitted('guardado')).toBeUndefined()
    })
  })

  describe('reiniciar', () => {
    const botonReiniciar = (wrapper) => wrapper.find('button[aria-label="Reiniciar valores"]')

    it('sin cambios no se muestra', () => {
      const { wrapper } = montar({ actual: productoBase() })
      expect(botonReiniciar(wrapper).exists()).toBe(false)
    })

    it('vacía lo contado y vuelve costo, venta y ganancia a los valores del producto', async () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 10, costo: 100, precio_venta: 150 }) })
      await inputContado(wrapper).setValue(3)
      await (await inputVenta(wrapper)).setValue(300) // ganancia pasa a 200%

      await botonReiniciar(wrapper).trigger('click')

      expect(inputContado(wrapper).element.value).toBe('')
      expect((await inputCosto(wrapper)).element.value).toBe('100')
      expect((await inputVenta(wrapper)).element.value).toBe('150')
      expect(botonReiniciar(wrapper).exists()).toBe(false)

      // La ganancia también volvió a 50%.
      await (await inputCosto(wrapper)).setValue(200)
      expect((await inputVenta(wrapper)).element.value).toBe('300')
    })
  })

  describe('código de barras', () => {
    const escaner = (wrapper) => wrapper.findComponent({ name: 'EscanerCodigo' })

    it('sin código: lo dice y ofrece "Asignar", que abre el escáner', async () => {
      const { wrapper } = montar({ actual: productoBase({ codigo_barras: null }) })
      expect(wrapper.text()).toContain('Sin código de barras')
      expect(wrapper.find('button[aria-label="Quitar código de barras"]').exists()).toBe(false)

      await wrapper.find('button[aria-label="Asignar código de barras"]').trigger('click')

      expect(escaner(wrapper).exists()).toBe(true)
      expect(escaner(wrapper).props('titulo')).toBe('Asignar código de barras')
    })

    it('lo escaneado se guarda en el producto, vibra y avisa', async () => {
      const vibrate = vi.fn()
      vi.stubGlobal('navigator', { ...navigator, vibrate })
      const { wrapper, productos, ui } = montar({ actual: productoBase({ codigo_barras: null }) })
      await wrapper.find('button[aria-label="Asignar código de barras"]').trigger('click')

      escaner(wrapper).vm.$emit('detectado', '7790001112223')
      await flushPromises()

      expect(productos.asignarCodigoBarras).toHaveBeenCalledWith(1, '7790001112223')
      expect(escaner(wrapper).exists()).toBe(false)
      expect(vibrate).toHaveBeenCalled()
      expect(ui.mostrarToast).toHaveBeenCalledWith('Código de barras guardado.', 'success')
      expect(wrapper.emitted('codigo-asignado')).toEqual([['7790001112223']])
    })

    it('con código: lo muestra, "Cambiar" abre el escáner y "Quitar" lo borra', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ codigo_barras: '7790001112223' }) })
      expect(wrapper.text()).toContain('7790001112223')

      await wrapper.find('button[aria-label="Cambiar código de barras"]').trigger('click')
      expect(escaner(wrapper).exists()).toBe(true)
      escaner(wrapper).vm.$emit('cerrar')
      await flushPromises()
      expect(escaner(wrapper).exists()).toBe(false)

      await wrapper.find('button[aria-label="Quitar código de barras"]').trigger('click')
      await flushPromises()
      expect(productos.asignarCodigoBarras).toHaveBeenCalledWith(1, '')
      expect(ui.mostrarToast).toHaveBeenCalledWith('Código de barras quitado.', 'success')
      expect(wrapper.emitted('codigo-asignado')).toBeUndefined()
    })

    it('escanear el mismo código que ya tiene no llama a la API', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ codigo_barras: '123' }) })
      await wrapper.find('button[aria-label="Cambiar código de barras"]').trigger('click')

      escaner(wrapper).vm.$emit('detectado', '123')
      await flushPromises()

      expect(productos.asignarCodigoBarras).not.toHaveBeenCalled()
      expect(ui.mostrarToast).toHaveBeenCalledWith('Ese ya es el código de barras de este producto.', 'info')
    })

    it('si la API lo rechaza (ya es de otro producto), muestra el mensaje tal cual', async () => {
      const { wrapper, productos, ui } = montar({ actual: productoBase({ codigo_barras: null }) })
      productos.asignarCodigoBarras.mockRejectedValue(new Error('Ese código ya está asignado a "Clavo".'))
      await wrapper.find('button[aria-label="Asignar código de barras"]').trigger('click')

      escaner(wrapper).vm.$emit('detectado', '123')
      await flushPromises()

      expect(ui.mostrarToast).toHaveBeenCalledWith('Ese código ya está asignado a "Clavo".', 'error')
      expect(wrapper.emitted('codigo-asignado')).toBeUndefined()
    })

    describe('código escaneado en el buscador sin producto (codigoPorAsignar)', () => {
      it('propone asignarlo a este producto', async () => {
        const { wrapper, productos } = montar({
          actual: productoBase({ codigo_barras: null }),
          props: { codigoPorAsignar: '7790001112223' },
        })
        expect(wrapper.text()).toContain('Escaneaste 7790001112223, que no es de ningún producto.')
        expect(wrapper.text()).not.toContain('Reemplazaría')

        await botonPorTexto(wrapper, 'Asignar a este producto').trigger('click')
        await flushPromises()

        expect(productos.asignarCodigoBarras).toHaveBeenCalledWith(1, '7790001112223')
        expect(wrapper.emitted('codigo-asignado')).toEqual([['7790001112223']])
      })

      it('si el producto ya tiene otro código, avisa que lo reemplaza', () => {
        const { wrapper } = montar({ actual: productoBase({ codigo_barras: '111' }), props: { codigoPorAsignar: '222' } })
        expect(wrapper.text()).toContain('Reemplazaría al código actual.')
      })

      it('"No" lo descarta', async () => {
        const { wrapper, productos } = montar({ actual: productoBase(), props: { codigoPorAsignar: '222' } })

        await wrapper.find('button[aria-label="No asignar el código escaneado"]').trigger('click')

        expect(wrapper.emitted('descartar-codigo')).toHaveLength(1)
        expect(productos.asignarCodigoBarras).not.toHaveBeenCalled()
      })

      it('no se propone si ya es el código del producto', () => {
        const { wrapper } = montar({ actual: productoBase({ codigo_barras: '222' }), props: { codigoPorAsignar: '222' } })
        expect(wrapper.text()).not.toContain('Escaneaste')
      })
    })
  })

  describe('unidad y cambios sin guardar', () => {
    it('la unidad se muestra corta ("UNID" → "u")', () => {
      const { wrapper } = montar({ actual: productoBase({ stock_actual: 10, unidad: 'UNID' }) })
      expect(botonPrincipal(wrapper).text()).toContain('Coincide: 10 u')
      expect(wrapper.text()).not.toContain('UNID')
    })

    it('avisa al store si hay algo tipeado sin guardar (para preguntar antes de descartarlo)', async () => {
      const { wrapper, productos } = montar({ actual: productoBase() })
      expect(productos.cambiosSinGuardar).toBe(false)

      await inputContado(wrapper).setValue(7)
      expect(productos.cambiosSinGuardar).toBe(true)

      await wrapper.find('button[aria-label="Reiniciar valores"]').trigger('click')
      expect(productos.cambiosSinGuardar).toBe(false)

      await inputContado(wrapper).setValue(3)
      wrapper.unmount()
      expect(productos.cambiosSinGuardar).toBe(false)
    })
  })
})
