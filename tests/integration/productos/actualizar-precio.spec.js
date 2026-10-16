// Guardar cambios de precio (ProductoCard.vue) — P0: operación financiera. Monta
// ProductoCard solo, con `productos.actual` precargado a mano (no pasa por
// la búsqueda/selección real, eso ya está cubierto en
// seleccion-sincronizacion.spec.js) — así el foco queda 100% en el flujo de
// guardado.
//
// Hallazgos de discovery que este archivo fija con un test (ver
// docs/testing/plan-agente-2-integration.md #2, #3, #9 y
// docs/testing/test-matrix.md sección 2):
//   - productos.actualizarPrecio() no tiene try/catch propio: quien atrapa
//     el error es ProductoCard.
//   - actualizarPrecio() NO verifica que `actual.value.prod_id` siga
//     coincidiendo antes de pisar la respuesta (a diferencia de
//     ajustarStock, que sí lo hace — ver ajustar-stock.spec.js).
//   - doble-submit: guardar() tiene guard interno además del :disabled.

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

function inputPrecioVenta(wrapper) {
  const inputs = wrapper.findAll('input[type="number"]')
  return inputs[inputs.length - 1]
}

function botonGuardarPrecio(wrapper) {
  return wrapper.findAll('button').find((b) => b.text().includes('Guardar cambios'))
}

async function leerBody(request) {
  return Object.fromEntries(new URLSearchParams(await request.clone().text()))
}

describe('ProductoCard: guardar precio', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('éxito: manda {prod_id,costo,precio_venta} exacto, reemplaza actual con la respuesta, toast de éxito', async () => {
    let bodyRecibido = null
    server.use(
      ...mockProductosEndpoint({
        actualizarPrecio: async ({ request }) => {
          bodyRecibido = await leerBody(request)
          return HttpResponse.json(productoEjemplo({ prod_id: 101, precio_venta: 1500, margen_pct: 46.7 }))
        },
      })
    )

    const { wrapper, productos, ui } = montar(productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 }))
    await inputPrecioVenta(wrapper).setValue(1500)
    await botonGuardarPrecio(wrapper).trigger('click')

    await esperarQue(() => expect(productos.actual.precio_venta).toBe(1500))

    expect(bodyRecibido).toEqual({ action: 'actualizar_precio', prod_id: '101', costo: '800', precio_venta: '1500' })
    expect(ui.toast).toEqual({ mensaje: 'Precio actualizado.', tipo: 'success' })
    expect(wrapper.text()).not.toContain('Guardando...')
  })

  it('error de negocio (400, precio <= costo): toast con el mensaje del backend, actual NO se pisa, el form conserva lo tipeado', async () => {
    server.use(
      ...mockProductosEndpoint({
        actualizarPrecio: () =>
          HttpResponse.json({ success: false, error: 'El precio de venta debe ser mayor al costo.' }, { status: 400 }),
      })
    )

    const productoInicial = productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 })
    const { wrapper, productos, ui } = montar(productoInicial)
    await inputPrecioVenta(wrapper).setValue(500)
    await botonGuardarPrecio(wrapper).trigger('click')

    await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))

    expect(ui.toast.mensaje).toBe('El precio de venta debe ser mayor al costo.')
    // actualizarPrecio() no tiene try/catch propio: la promesa rechazó, así
    // que productos.actual sigue siendo el objeto original (no se pisó).
    // toEqual (no toBe): Pinia envuelve el estado en un proxy reactivo, así
    // que la referencia nunca es la misma aunque no haya habido reasignación.
    expect(productos.actual).toEqual(productoInicial)
    expect(Number(inputPrecioVenta(wrapper).element.value)).toBe(500)
    expect(wrapper.text()).not.toContain('Guardando...')
  })

  it('error de red: mismo camino que el 400 — toast de error, guardando vuelve a false', async () => {
    server.use(...mockProductosEndpoint({ actualizarPrecio: () => HttpResponse.error() }))

    const { wrapper, ui } = montar(productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 }))
    await inputPrecioVenta(wrapper).setValue(1500)
    await botonGuardarPrecio(wrapper).trigger('click')

    await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
    expect(ui.toast.mensaje).toBe('No hay conexión con el servidor.')
  })

  it('error 500: toast de error con el mensaje del backend', async () => {
    server.use(
      ...mockProductosEndpoint({
        actualizarPrecio: () => HttpResponse.json({ success: false, error: 'Error interno del servidor.' }, { status: 500 }),
      })
    )

    const { wrapper, ui } = montar(productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 }))
    await inputPrecioVenta(wrapper).setValue(1500)
    await botonGuardarPrecio(wrapper).trigger('click')

    await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
    expect(ui.toast.mensaje).toBe('Error interno del servidor.')
  })

  it('recuperación después de error: falla, el usuario reintenta, el segundo intento resuelve bien', async () => {
    let intentos = 0
    server.use(
      ...mockProductosEndpoint({
        actualizarPrecio: () => {
          intentos++
          if (intentos === 1) {
            return HttpResponse.json({ success: false, error: 'El precio de venta debe ser mayor al costo.' }, { status: 400 })
          }
          return HttpResponse.json(productoEjemplo({ prod_id: 101, precio_venta: 1500 }))
        },
      })
    )

    const { wrapper, productos, ui } = montar(productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 }))
    await inputPrecioVenta(wrapper).setValue(500)
    await botonGuardarPrecio(wrapper).trigger('click')
    await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))

    await inputPrecioVenta(wrapper).setValue(1500)
    await botonGuardarPrecio(wrapper).trigger('click')
    await esperarQue(() => expect(ui.toast?.tipo).toBe('success'))

    expect(intentos).toBe(2)
    expect(productos.actual.precio_venta).toBe(1500)
  })

  it('doble-submit real: dos clicks en "Guardar cambios" sin esperar entre medio — una sola request', async () => {
    let llamadas = 0
    server.use(
      ...mockProductosEndpoint({
        actualizarPrecio: () => {
          llamadas++
          return HttpResponse.json(productoEjemplo({ prod_id: 101, precio_venta: 1500 }))
        },
      })
    )

    const { wrapper, productos } = montar(productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 }))
    await inputPrecioVenta(wrapper).setValue(1500)

    const boton = botonGuardarPrecio(wrapper)
    const p1 = boton.trigger('click')
    const p2 = boton.trigger('click')
    await Promise.all([p1, p2])

    await esperarQue(() => expect(productos.actual.precio_venta).toBe(1500))

    // guardar() tiene guard interno (`if (guardando.value) return`), no
    // depende solo del :disabled del botón.
    expect(llamadas).toBe(1)
  })

  it('[hallazgo] respuesta fuera de orden: guardar precio de A demorado, mientras tanto el store pasa a B — la respuesta de A pisa igual `actual`', async () => {
    server.use(
      ...mockProductosEndpoint({
        actualizarPrecio: async () => {
          await delay(40)
          return HttpResponse.json(productoEjemplo({ prod_id: 101, nombre: 'Producto A', precio_venta: 1500 }))
        },
      })
    )

    const { wrapper, productos } = montar(productoEjemplo({ prod_id: 101, nombre: 'Producto A', costo: 800, precio_venta: 1200 }))
    await inputPrecioVenta(wrapper).setValue(1500)
    const guardado = botonGuardarPrecio(wrapper).trigger('click')

    // Mientras la respuesta de A todavía está en vuelo, el usuario navega a
    // otro producto (B) — simula lo que haría seleccionar() en la vida real.
    productos.actual = productoEjemplo({ prod_id: 202, nombre: 'Producto B' })

    await guardado
    await esperarQue(() => expect(productos.cargando).toBe(false))
    // No hay una señal de "terminó" propia de este flujo aparte del toast;
    // esperamos directo a que la promesa del click resuelva y el store se
    // asiente.
    await new Promise((r) => setTimeout(r, 60))

    // Comportamiento REAL confirmado (hallazgo #3 del discovery,
    // actualizarPrecio() no valida prod_id antes de pisar `actual`): la
    // respuesta tardía de A reemplaza igual el producto B que el usuario ya
    // estaba viendo. Se deja fijado así a propósito, no se fuerza a que
    // "debería" quedar B.
    expect(productos.actual.prod_id).toBe(101)
    expect(productos.actual.nombre).toBe('Producto A')
  })
})
