// Ajustar stock (ProductoCard.vue) — P0: operación de stock. A diferencia de
// "guardar precio" (ver actualizar-precio.spec.js), acá `ajustarStock()` SÍ
// valida `actual.value.prod_id === prodId` antes de pisar la respuesta —
// este archivo confirma que ese guard funciona como está escrito (contraste
// deliberado con la asimetría documentada en el hallazgo #3 del discovery).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockProductosEndpoint, HttpResponse, delay } from '../../mocks/handlers'
import { productoEjemplo } from '../../mocks/fixtures'
import { limpiarDb } from '../../mocks/db-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { useAuthStore } from '../../../src/stores/auth'
import { useProductosStore } from '../../../src/stores/productos'
import { useUiStore } from '../../../src/stores/ui'
import ProductoCard from '../../../src/components/ProductoCard.vue'

function montar(productoInicial) {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  const productos = useProductosStore()
  productos.actual = productoInicial
  const wrapper = mount(ProductoCard)
  return { wrapper, productos, ui: useUiStore() }
}

function inputStock(wrapper) {
  return wrapper.findAll('input[type="number"]')[0]
}

function botonGuardarStock(wrapper) {
  return wrapper.findAll('button').find((b) => b.text().includes('Guardar stock'))
}

async function leerBody(request) {
  return Object.fromEntries(new URLSearchParams(await request.clone().text()))
}

describe('ProductoCard: ajustar stock', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('éxito: manda {prod_id,nuevo_stock,comentario:""} exacto, actualiza stock_actual con lo que devuelve el backend', async () => {
    let bodyRecibido = null
    server.use(
      ...mockProductosEndpoint({
        ajustarStock: async ({ request }) => {
          bodyRecibido = await leerBody(request)
          return HttpResponse.json({ success: true, stock_actual: 18 })
        },
      })
    )

    const { wrapper, productos, ui } = montar(productoEjemplo({ prod_id: 101, stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    await botonGuardarStock(wrapper).trigger('click')

    await esperarQue(() => expect(productos.actual.stock_actual).toBe(18))

    expect(bodyRecibido).toEqual({ action: 'ajustar_stock', prod_id: '101', nuevo_stock: '20', comentario: '' })
    // El input se actualiza con lo que devolvió el backend, no con lo tipeado
    // (por si el backend lo ajustó).
    expect(Number(inputStock(wrapper).element.value)).toBe(18)
    expect(ui.toast).toEqual({ mensaje: 'Stock actualizado.', tipo: 'success' })
  })

  it('el stepper "+"/"-" también dispara el guardado con el valor correcto y no baja de 0', async () => {
    server.use(
      ...mockProductosEndpoint({
        ajustarStock: () => HttpResponse.json({ success: true, stock_actual: 5 }),
      })
    )

    const { wrapper } = montar(productoEjemplo({ prod_id: 101, stock_actual: 0 }))
    const botones = wrapper.findAll('button')
    const menos = botones.find((b) => b.text() === '−')
    await menos.trigger('click')
    // Math.max(0, ...) no debe dejarlo negativo.
    expect(Number(inputStock(wrapper).element.value)).toBe(0)

    const mas = botones.find((b) => b.text() === '+')
    await mas.trigger('click')
    await mas.trigger('click')
    expect(Number(inputStock(wrapper).element.value)).toBe(2)
  })

  it('guard de respuesta fuera de orden: ajuste de A demorado, mientras tanto el store pasa a B — la respuesta de A NO pisa `actual` de B', async () => {
    server.use(
      ...mockProductosEndpoint({
        ajustarStock: async () => {
          await delay(40)
          return HttpResponse.json({ success: true, stock_actual: 999 })
        },
      })
    )

    const { wrapper, productos } = montar(productoEjemplo({ prod_id: 101, nombre: 'Producto A', stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    const guardado = botonGuardarStock(wrapper).trigger('click')

    // Mientras la respuesta de A sigue en vuelo, el store pasa a B.
    productos.actual = productoEjemplo({ prod_id: 202, nombre: 'Producto B', stock_actual: 5 })

    await guardado
    await new Promise((r) => setTimeout(r, 60))

    // A diferencia de actualizarPrecio(), acá SÍ hay guard: la respuesta
    // tardía de A no debe tocar el stock de B.
    expect(productos.actual.prod_id).toBe(202)
    expect(productos.actual.stock_actual).toBe(5)
  })

  it('error de negocio/red: toast de error, guardandoStock vuelve a false, el input conserva lo tipeado', async () => {
    server.use(
      ...mockProductosEndpoint({
        ajustarStock: () => HttpResponse.json({ success: false, error: 'No se pudo ajustar el stock.' }, { status: 400 }),
      })
    )

    const { wrapper, ui } = montar(productoEjemplo({ prod_id: 101, stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    await botonGuardarStock(wrapper).trigger('click')

    await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
    expect(ui.toast.mensaje).toBe('No se pudo ajustar el stock.')
    expect(Number(inputStock(wrapper).element.value)).toBe(20)
    expect(wrapper.text()).not.toContain('Guardando...')
  })

  it('error de red (network error): usa el mensaje genérico de apiClient y no crashea', async () => {
    server.use(...mockProductosEndpoint({ ajustarStock: () => HttpResponse.error() }))

    const { wrapper, ui } = montar(productoEjemplo({ prod_id: 101, stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    await botonGuardarStock(wrapper).trigger('click')

    await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
    expect(ui.toast.mensaje).toBe('No hay conexión con el servidor.')
  })
})
