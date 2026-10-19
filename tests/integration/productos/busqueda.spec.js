// Búsqueda de productos: SearchBar.vue + productos store + productosService
// + apiClient + fallback a Dexie (catalogoCache) cuando falla la red.
// SearchBar no usa el router, así que se monta solo (sin BuscarView
// alrededor) — la sincronización con ProductoCard vía el store compartido
// se prueba en seleccion-sincronizacion.spec.js.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockProductosEndpoint, HttpResponse } from '../../mocks/handlers'
import { itemBusqueda, resultadosBusquedaEjemplo } from '../../mocks/fixtures'
import { limpiarDb, sembrarCatalogoCache } from '../../mocks/db-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { useAuthStore } from '../../../src/stores/auth'
import { useProductosStore } from '../../../src/stores/productos'
import SearchBar from '../../../src/components/SearchBar.vue'

function montarSearchBar() {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  const wrapper = mount(SearchBar)
  return { wrapper, auth, productos: useProductosStore() }
}

describe('SearchBar + productos store: búsqueda', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('tipear dispara UN SOLO request tras el debounce (no uno por tecla) y pinta los resultados', async () => {
    let llamadas = 0
    let queryRecibida = null
    server.use(
      ...mockProductosEndpoint({
        buscar: ({ request }) => {
          llamadas++
          queryRecibida = new URL(request.url).searchParams.get('q')
          return HttpResponse.json({ success: true, items: resultadosBusquedaEjemplo() })
        },
      })
    )

    const { wrapper, productos } = montarSearchBar()
    const input = wrapper.find('input')
    // Simula tipear letra por letra rápido: cada `setValue` dispara el watch
    // de `query`, que resetea el debounce cada vez.
    await input.setValue('f')
    await input.setValue('fi')
    await input.setValue('fid')

    await esperarQue(() => expect(productos.resultados.length).toBe(2))

    expect(llamadas).toBe(1)
    expect(queryRecibida).toBe('fid')
    expect(wrapper.text()).toContain('Fideos Guaseta 500g')
  })

  it('sin resultados: muestra el mensaje de "Sin resultados"', async () => {
    server.use(...mockProductosEndpoint({ buscar: () => HttpResponse.json({ success: true, items: [] }) }))

    const { wrapper } = montarSearchBar()
    await wrapper.find('input').setValue('zzz-no-existe')

    await esperarQue(() => expect(wrapper.text()).toContain('Sin resultados'))
  })

  it('limpiar el input vacía resultados sin llamar a la API', async () => {
    let llamadas = 0
    server.use(...mockProductosEndpoint({ buscar: () => { llamadas++; return HttpResponse.json({ success: true, items: [] }) } }))

    const { wrapper, productos } = montarSearchBar()
    productos.resultados = resultadosBusquedaEjemplo()
    await wrapper.find('input').setValue('algo')
    await wrapper.find('input').setValue('')

    expect(productos.resultados).toEqual([])
    expect(llamadas).toBe(0)
  })

  it('cada resultado exitoso se persiste en Dexie (catalogoCache)', async () => {
    server.use(
      ...mockProductosEndpoint({ buscar: () => HttpResponse.json({ success: true, items: resultadosBusquedaEjemplo() }) })
    )

    const { wrapper } = montarSearchBar()
    await wrapper.find('input').setValue('fid')

    await esperarQue(async () => {
      const { db } = await import('../../../src/offline/db')
      const guardados = await db.catalogoCache.toArray()
      expect(guardados.length).toBe(2)
    })
  })

  it('con la red caída: error.value se setea y cae a un fallback con lo que haya en catalogoCache', async () => {
    await sembrarCatalogoCache([itemBusqueda({ prod_id: 999, nombre: 'Fideos Cacheados', codigo: 'CACHE1' })])
    server.use(...mockProductosEndpoint({ buscar: () => HttpResponse.error() }))

    const { wrapper, productos } = montarSearchBar()
    await wrapper.find('input').setValue('fideos')

    // error.value y resultados.value se pisan en dos líneas seguidas del
    // catch (la segunda con un await de por medio) — esperar las dos juntas
    // para no leer un estado a mitad de camino.
    await esperarQue(() => {
      expect(productos.error).toBe('No hay conexión con el servidor.')
      expect(productos.resultados).toHaveLength(1)
    })
    expect(productos.resultados[0].nombre).toBe('Fideos Cacheados')
    expect(wrapper.text()).toContain('Fideos Cacheados')
  })

  it('seleccionar un resultado emite "select" con el prod_id correcto y limpia el input', async () => {
    server.use(
      ...mockProductosEndpoint({ buscar: () => HttpResponse.json({ success: true, items: [itemBusqueda({ prod_id: 555 })] }) })
    )

    const { wrapper } = montarSearchBar()
    await wrapper.find('input').setValue('fid')
    // Ojo: el botón de "limpiar" (X) ya aparece apenas hay texto en el
    // input, antes de que lleguen los resultados — esperar por el texto del
    // resultado en sí, no por "algún botón nuevo".
    await esperarQue(() => expect(wrapper.text()).toContain('Fideos Guaseta 500g'))

    const botonResultado = wrapper.findAll('button').find((b) => b.text().includes('Fideos Guaseta 500g'))
    expect(botonResultado).toBeTruthy()
    await botonResultado.trigger('mousedown')

    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')[0]).toEqual([555, { escaneado: false }])
    expect(wrapper.find('input').element.value).toBe('')
  })

  it('el badge de margen usa auth.config.margen_objetivo_pct para decidir rojo/verde', async () => {
    server.use(
      ...mockProductosEndpoint({
        buscar: () =>
          HttpResponse.json({
            success: true,
            items: [
              itemBusqueda({ prod_id: 1, nombre: 'Margen bajo', margen_pct: 10 }),
              itemBusqueda({ prod_id: 2, nombre: 'Margen alto', margen_pct: 50 }),
            ],
          }),
      })
    )

    const { wrapper, auth } = montarSearchBar()
    auth.config.margen_objetivo_pct = 30
    await wrapper.find('input').setValue('margen')

    await esperarQue(() => expect(wrapper.text()).toContain('Margen bajo'))
    expect(wrapper.html()).toContain('bg-red-100')
    expect(wrapper.html()).toContain('bg-green-100')
  })
})
