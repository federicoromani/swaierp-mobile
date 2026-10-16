// Modo conteo (ConteoView): recorre "Pendientes de controlar" de a un
// producto. Contar uno pasa solo al siguiente, "Saltar" lo deja para el
// final, y al terminar se pueden revisar los salteados. Stores reales + MSW,
// con un RouterView real para la navegación de entrada/salida.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { RouterView } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockReportesEndpoint, mockProductosEndpoint, HttpResponse } from '../../mocks/handlers'
import { productoEjemplo } from '../../mocks/fixtures'
import { limpiarDb } from '../../mocks/db-helpers'
import { crearRouterLiviano } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { botonPorTexto, inputContado } from '../../mocks/producto-card-helpers'
import { useAuthStore } from '../../../src/stores/auth'
import { useReportesStore } from '../../../src/stores/reportes'

const PRODUCTOS = {
  1: 'Arandela plana 8mm',
  2: 'Tuerca hexagonal M8',
  3: 'Tarugo Fischer 8mm',
}

function mockearTodo({ conteos = [] } = {}) {
  server.use(
    ...mockReportesEndpoint({
      pendientesControlar: () =>
        HttpResponse.json({
          success: true,
          items: Object.entries(PRODUCTOS).map(([id, nombre]) => ({ prod_id: Number(id), nombre, ultimo_conteo: null })),
          total: 3,
        }),
    }),
    ...mockProductosEndpoint({
      detalle: ({ request }) => {
        const id = Number(new URL(request.url).searchParams.get('prod_id'))
        return HttpResponse.json(productoEjemplo({ prod_id: id, nombre: PRODUCTOS[id], stock_actual: 10, ultimo_conteo: null }))
      },
      registrarConteo: async ({ request }) => {
        const body = Object.fromEntries(new URLSearchParams(await request.clone().text()))
        conteos.push(body)
        const id = Number(body.prod_id)
        return HttpResponse.json({
          ...productoEjemplo({ prod_id: id, nombre: PRODUCTOS[id], stock_actual: Number(body.stock_contado), ultimo_conteo: '2026-10-16 10:00:00' }),
          diferencia: Number(body.stock_contado) - 10,
        })
      },
    })
  )
  return conteos
}

async function montar(ruta = '/contar') {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  const router = await crearRouterLiviano(ruta)
  const wrapper = mount(RouterView, { global: { plugins: [router] } })
  return { wrapper, router }
}

const nombreEnPantalla = (wrapper) => wrapper.find('h2').exists() && wrapper.find('h2').text()

describe('Modo conteo', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })
  afterEach(async () => {
    await limpiarDb()
  })

  it('contar uno pasa solo al siguiente; saltar lo deja para el final; al terminar se pueden revisar los salteados', async () => {
    const conteos = mockearTodo()
    const { wrapper } = await montar()

    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Arandela plana 8mm'))
    expect(wrapper.text()).toContain('Contados 0 · Quedan 3')

    // 1) Coincide con el sistema: un toque.
    await botonPorTexto(wrapper, 'Coincide').trigger('click')
    await esperarQue(() => expect(wrapper.text()).toContain('Conteo registrado'))
    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Tuerca hexagonal M8'), { timeout: 2000 })
    expect(wrapper.text()).toContain('Contados 1 · Quedan 2')
    expect(conteos[0]).toEqual({ action: 'registrar_conteo', prod_id: '1', stock_contado: '10' })

    // 2) Saltar.
    await botonPorTexto(wrapper, 'Saltar este producto').trigger('click')
    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Tarugo Fischer 8mm'))

    // 3) Con diferencia.
    await inputContado(wrapper).setValue(7)
    await botonPorTexto(wrapper, 'Guardar conteo').trigger('click')
    await esperarQue(() => expect(wrapper.text()).toContain('¡Listo!'), { timeout: 2000 })
    expect(wrapper.text()).toContain('Contaste 2 productos y salteaste 1')
    expect(conteos[1]).toEqual({ action: 'registrar_conteo', prod_id: '3', stock_contado: '7' })

    // 4) Revisar los salteados vuelve al que quedó.
    await botonPorTexto(wrapper, 'Revisar los salteados (1)').trigger('click')
    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Tuerca hexagonal M8'))
  })

  it('con ?desde= arranca en ese producto', async () => {
    mockearTodo()
    const { wrapper } = await montar('/contar?desde=3')

    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Tarugo Fischer 8mm'))
  })

  it('"Salir" vuelve a Reportes y la lista conserva lo contado (no se recarga)', async () => {
    mockearTodo()
    const { wrapper, router } = await montar()
    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Arandela plana 8mm'))

    await botonPorTexto(wrapper, 'Coincide').trigger('click')
    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Tuerca hexagonal M8'), { timeout: 2000 })

    await botonPorTexto(wrapper, 'Salir').trigger('click')
    await esperarQue(() => expect(router.currentRoute.value.path).toBe('/reportes'))

    const reportes = useReportesStore()
    expect(reportes.pendientes.total).toBe(2)
    expect(reportes.pendientes.items.map((p) => p.prod_id)).toEqual([2, 3])
    await esperarQue(() => expect(wrapper.text()).toContain('Empezar a contar (2)'))
  })

  it('sin pendientes, termina enseguida con "¡Listo!"', async () => {
    server.use(
      ...mockReportesEndpoint({ pendientesControlar: () => HttpResponse.json({ success: true, items: [], total: 0 }) })
    )
    const { wrapper } = await montar()

    await esperarQue(() => expect(wrapper.text()).toContain('¡Listo!'))
    expect(wrapper.text()).toContain('Contaste 0 productos')
  })

  it('saltar con un conteo tipeado pregunta antes de descartarlo', async () => {
    const conteos = mockearTodo()
    const { wrapper } = await montar()
    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Arandela plana 8mm'))

    await inputContado(wrapper).setValue(7)
    await botonPorTexto(wrapper, 'Saltar este producto').trigger('click')

    expect(wrapper.find('[role="alertdialog"]').text()).toContain('Arandela plana 8mm')
    await botonPorTexto(wrapper, 'Seguir editando').trigger('click')
    expect(nombreEnPantalla(wrapper)).toBe('Arandela plana 8mm')
    expect(inputContado(wrapper).element.value).toBe('7')

    await botonPorTexto(wrapper, 'Saltar este producto').trigger('click')
    await botonPorTexto(wrapper, 'Descartar').trigger('click')
    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Tuerca hexagonal M8'))
    expect(conteos).toHaveLength(0)
  })

  it('un pendiente que dejó de controlar stock se saltea solo y no cuenta como contado', async () => {
    mockearTodo()
    server.use(
      ...mockProductosEndpoint({
        detalle: ({ request }) => {
          const id = Number(new URL(request.url).searchParams.get('prod_id'))
          if (id === 1) {
            return HttpResponse.json(
              { success: false, codigo: 'producto_no_disponible', error: 'Este producto no controla stock, por eso no se usa desde la app.' },
              { status: 404 }
            )
          }
          return HttpResponse.json(productoEjemplo({ prod_id: id, nombre: PRODUCTOS[id], stock_actual: 10, ultimo_conteo: null }))
        },
      })
    )
    const { wrapper } = await montar()

    await esperarQue(() => expect(nombreEnPantalla(wrapper)).toBe('Tuerca hexagonal M8'))
    expect(wrapper.text()).toContain('Contados 0 · Quedan 2')
    expect(useReportesStore().pendientes.items.map((p) => p.prod_id)).toEqual([2, 3])
  })
})
