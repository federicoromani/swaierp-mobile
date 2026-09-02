// Sincronización entre componentes vía el store compartido: BuscarView
// monta SearchBar y ProductoCard como HERMANOS (no hay props/eventos entre
// ellos para los datos del producto) — todo pasa por productos store.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockProductosEndpoint, mockReportesEndpoint, HttpResponse } from '../../mocks/handlers'
import { itemBusqueda, productoEjemplo } from '../../mocks/fixtures'
import { limpiarDb, sembrarCatalogoCache } from '../../mocks/db-helpers'
import { crearRouterLiviano } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { useAuthStore } from '../../../src/stores/auth'
import { useProductosStore } from '../../../src/stores/productos'
import BuscarView from '../../../src/views/BuscarView.vue'

async function montarBuscarView() {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  server.use(...mockReportesEndpoint({ pendientesControlar: () => HttpResponse.json({ success: true, items: [], total: 0 }) }))
  const router = await crearRouterLiviano('/buscar')
  const wrapper = mount(BuscarView, { global: { plugins: [router] } })
  return { wrapper, router, auth, productos: useProductosStore() }
}

describe('BuscarView: sincronización SearchBar ↔ ProductoCard vía productos store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('seleccionar un producto en SearchBar puebla ProductoCard (sin ningún prop/evento directo entre ambos)', async () => {
    server.use(
      ...mockProductosEndpoint({
        buscar: () => HttpResponse.json({ success: true, items: [itemBusqueda({ prod_id: 101, nombre: 'Fideos Guaseta 500g' })] }),
        detalle: () => HttpResponse.json(productoEjemplo({ prod_id: 101, nombre: 'Fideos Guaseta 500g' })),
      })
    )

    const { wrapper } = await montarBuscarView()
    await wrapper.find('input').setValue('fid')
    await esperarQue(() => expect(wrapper.text()).toContain('Fideos Guaseta 500g'))

    const boton = wrapper.findAll('button').find((b) => b.text().includes('Fideos Guaseta 500g'))
    await boton.trigger('mousedown')

    // Ahora debe verse el detalle completo (ProductoCard), no solo el
    // resultado del dropdown — confirma que pasó por productos.seleccionar()
    // y no solo por el evento local de SearchBar.
    await esperarQue(() => expect(wrapper.text()).toContain('Último conteo'))
    expect(wrapper.find('h2').text()).toBe('Fideos Guaseta 500g')
  })

  it('el formulario de ProductoCard NO se resetea si se vuelve a seleccionar el MISMO prod_id (solo cambia con prod_id distinto)', async () => {
    let version = 1
    server.use(
      ...mockProductosEndpoint({
        detalle: () =>
          HttpResponse.json(
            productoEjemplo({ prod_id: 101, nombre: 'Fideos Guaseta 500g', precio_venta: 1200 + version })
          ),
      })
    )

    const { wrapper, productos } = await montarBuscarView()
    await productos.seleccionar(101)
    await wrapper.vm.$nextTick()

    const inputPrecio = wrapper.find('input[type="number"].w-28, input.text-right')
    // El input de precio de venta es el único con clases text-right; si el
    // selector de arriba no matchea por el orden de clases, se busca por
    // posición conocida del layout (precio de venta es el 3er number input).
    const inputsNumero = wrapper.findAll('input[type="number"]')
    const inputPrecioVenta = inputsNumero[inputsNumero.length - 1]
    expect(Number(inputPrecioVenta.element.value)).toBe(1201)

    // El usuario edita el precio a mano, sin guardar.
    await inputPrecioVenta.setValue(9999)
    expect(Number(inputPrecioVenta.element.value)).toBe(9999)

    // Se vuelve a seleccionar el MISMO producto (ej. reentra a la pantalla,
    // o el backend devuelve datos frescos) — el prod_id no cambia.
    version = 2
    await productos.seleccionar(101)
    await wrapper.vm.$nextTick()

    // El watch está keyeado por prod_id, no por el objeto `actual` entero:
    // no debe pisar lo que el usuario tenía tipeado.
    const inputsNumeroDespues = wrapper.findAll('input[type="number"]')
    expect(Number(inputsNumeroDespues[inputsNumeroDespues.length - 1].element.value)).toBe(9999)
  })

  it('seleccionar() con red caída hace fallback a catalogoCache si el producto ya estaba cacheado', async () => {
    await sembrarCatalogoCache([
      { ...productoEjemplo({ prod_id: 202, nombre: 'Producto Cacheado' }), historial: undefined },
    ])
    server.use(...mockProductosEndpoint({ detalle: () => HttpResponse.error() }))

    const { wrapper, productos } = await montarBuscarView()
    await productos.seleccionar(202)
    await wrapper.vm.$nextTick()

    expect(productos.error).toBe('No hay conexión con el servidor.')
    expect(productos.actual.nombre).toBe('Producto Cacheado')
    expect(wrapper.text()).toContain('Producto Cacheado')
  })

  it('seleccionar() con red caída y SIN cache previo deja `actual` como estaba (no lo vacía)', async () => {
    server.use(
      ...mockProductosEndpoint({
        detalle: ({ request }) => {
          const prodId = new URL(request.url).searchParams.get('prod_id')
          if (prodId === '303') {
            return HttpResponse.json(productoEjemplo({ prod_id: 303, nombre: 'Producto Inicial' }))
          }
          return HttpResponse.error()
        },
      })
    )

    const { wrapper, productos } = await montarBuscarView()
    await productos.seleccionar(303)
    await wrapper.vm.$nextTick()
    expect(productos.actual.nombre).toBe('Producto Inicial')

    await productos.seleccionar(404)
    await wrapper.vm.$nextTick()

    expect(productos.error).toBe('No hay conexión con el servidor.')
    expect(productos.actual.nombre).toBe('Producto Inicial')
  })

  it('el historial del producto llega correctamente a HistorialProducto', async () => {
    server.use(
      ...mockProductosEndpoint({
        detalle: () =>
          HttpResponse.json(
            productoEjemplo({
              prod_id: 101,
              historial: [{ tipo: 'precio', fecha: '2026-08-01', costo_anterior: 500, costo_nuevo: 600 }],
            })
          ),
      })
    )

    const { wrapper, productos } = await montarBuscarView()
    await productos.seleccionar(101)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Historial de este producto')
    expect(wrapper.text()).toContain('Costo $500')
  })
})
