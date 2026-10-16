// Registrar conteo (ProductoCard.vue) — P0: es el objetivo principal de la
// app. A diferencia de "guardar precio" (ver actualizar-precio.spec.js), acá
// `registrarConteo()` SÍ valida `actual.value.prod_id === prodId` antes de
// pisar la respuesta — este archivo confirma que ese guard funciona como está
// escrito (contraste deliberado con la asimetría documentada en el hallazgo
// #3 del discovery).
//
// Un conteo se registra aunque coincida con el sistema ("Confirmar conteo"):
// es lo que saca al producto de "Pendientes de controlar".

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
import { useReportesStore } from '../../../src/stores/reportes'
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

function botonPorTexto(wrapper, texto) {
  return wrapper.findAll('button').find((b) => b.text().includes(texto))
}

async function leerBody(request) {
  return Object.fromEntries(new URLSearchParams(await request.clone().text()))
}

describe('ProductoCard: registrar conteo', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('con diferencia: manda {prod_id, stock_contado} exacto y muestra lo que devuelve el backend', async () => {
    let bodyRecibido = null
    server.use(
      ...mockProductosEndpoint({
        registrarConteo: async ({ request }) => {
          bodyRecibido = await leerBody(request)
          return HttpResponse.json({ ...productoEjemplo({ prod_id: 101, stock_actual: 18 }), diferencia: -6 })
        },
      })
    )

    const { wrapper, productos, ui } = montar(productoEjemplo({ prod_id: 101, stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    await botonPorTexto(wrapper, 'Guardar cambios').trigger('click')

    await esperarQue(() => expect(productos.actual.stock_actual).toBe(18))

    expect(bodyRecibido).toEqual({ action: 'registrar_conteo', prod_id: '101', stock_contado: '20' })
    // El input se actualiza con lo que devolvió el backend, no con lo tipeado
    // (por si el backend lo ajustó).
    expect(Number(inputStock(wrapper).element.value)).toBe(18)
    expect(ui.toast).toEqual({ mensaje: 'Conteo registrado: -6.', tipo: 'success' })
  })

  it('sin cambios: "Confirmar conteo" registra el conteo con el stock del sistema y saca al producto de pendientes', async () => {
    let bodyRecibido = null
    server.use(
      ...mockProductosEndpoint({
        registrarConteo: async ({ request }) => {
          bodyRecibido = await leerBody(request)
          return HttpResponse.json({
            ...productoEjemplo({ prod_id: 101, stock_actual: 24, ultimo_conteo: '2026-10-16 09:30:00' }),
            diferencia: 0,
          })
        },
      })
    )

    const { wrapper, productos, ui } = montar(productoEjemplo({ prod_id: 101, stock_actual: 24, ultimo_conteo: null }))
    const reportes = useReportesStore()
    reportes.pendientes = { items: [{ prod_id: 101 }, { prod_id: 102 }], total: 12 }

    await botonPorTexto(wrapper, 'Confirmar conteo').trigger('click')
    await esperarQue(() => expect(ui.toast?.tipo).toBe('success'))

    expect(bodyRecibido).toEqual({ action: 'registrar_conteo', prod_id: '101', stock_contado: '24' })
    expect(ui.toast.mensaje).toBe('Conteo registrado: sin diferencias.')
    expect(productos.actual.ultimo_conteo).toBe('2026-10-16 09:30:00')
    expect(reportes.pendientes).toEqual({ items: [{ prod_id: 102 }], total: 11 })
  })

  it('el stepper "+"/"-" ajusta el valor y no baja de 0', async () => {
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

  it('guard de respuesta fuera de orden: conteo de A demorado, mientras tanto el store pasa a B — la respuesta de A NO pisa `actual` de B', async () => {
    server.use(
      ...mockProductosEndpoint({
        registrarConteo: async () => {
          await delay(40)
          return HttpResponse.json({ ...productoEjemplo({ prod_id: 101, stock_actual: 999 }), diferencia: 979 })
        },
      })
    )

    const { wrapper, productos } = montar(productoEjemplo({ prod_id: 101, nombre: 'Producto A', stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    const guardado = botonPorTexto(wrapper, 'Guardar cambios').trigger('click')

    // Mientras la respuesta de A sigue en vuelo, el store pasa a B.
    productos.actual = productoEjemplo({ prod_id: 202, nombre: 'Producto B', stock_actual: 5 })

    await guardado
    await new Promise((r) => setTimeout(r, 60))

    // A diferencia de actualizarPrecio(), acá SÍ hay guard: la respuesta
    // tardía de A no debe tocar el stock de B.
    expect(productos.actual.prod_id).toBe(202)
    expect(productos.actual.stock_actual).toBe(5)
  })

  it('error de negocio: toast de error, guardando vuelve a false, el input conserva lo tipeado', async () => {
    server.use(
      ...mockProductosEndpoint({
        registrarConteo: () => HttpResponse.json({ success: false, error: 'El stock no puede ser negativo.' }, { status: 400 }),
      })
    )

    const { wrapper, ui } = montar(productoEjemplo({ prod_id: 101, stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    await botonPorTexto(wrapper, 'Guardar cambios').trigger('click')

    await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
    expect(ui.toast.mensaje).toBe('El stock no puede ser negativo.')
    expect(Number(inputStock(wrapper).element.value)).toBe(20)
    expect(wrapper.text()).not.toContain('Guardando...')
  })

  it('error de red: mensaje genérico de apiClient y el header pasa a "Sin conexión con el servidor"', async () => {
    server.use(...mockProductosEndpoint({ registrarConteo: () => HttpResponse.error() }))

    const { wrapper, ui } = montar(productoEjemplo({ prod_id: 101, stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    await botonPorTexto(wrapper, 'Guardar cambios').trigger('click')

    await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
    expect(ui.toast.mensaje).toBe('No hay conexión con el servidor.')
    expect(ui.problemaConexion).toBe('Sin conexión con el servidor')
  })

  it('después de un error de red, la próxima respuesta del servidor (aunque sea un error) limpia el aviso de conexión', async () => {
    let intentos = 0
    server.use(
      ...mockProductosEndpoint({
        registrarConteo: () => {
          intentos++
          return intentos === 1
            ? HttpResponse.error()
            : HttpResponse.json({ success: false, error: 'El stock no puede ser negativo.' }, { status: 400 })
        },
      })
    )

    const { wrapper, ui } = montar(productoEjemplo({ prod_id: 101, stock_actual: 24 }))
    await inputStock(wrapper).setValue(20)
    await botonPorTexto(wrapper, 'Guardar cambios').trigger('click')
    await esperarQue(() => expect(ui.problemaConexion).toBe('Sin conexión con el servidor'))

    await botonPorTexto(wrapper, 'Guardar cambios').trigger('click')
    await esperarQue(() => expect(ui.toast?.mensaje).toBe('El stock no puede ser negativo.'))

    expect(ui.problemaConexion).toBeNull()
  })
})
