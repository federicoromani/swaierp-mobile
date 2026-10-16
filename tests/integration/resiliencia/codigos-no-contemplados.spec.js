// Resiliencia ante códigos/errores que el backend real de swaidemo NO
// devuelve hoy (404/409/422/429/500/network-error/delay largo/JSON
// corrupto). No son "flujos de negocio reales" — son pruebas de resiliencia
// del frontend ante lo que un proxy/WAF/CDN podría llegar a inyectar en el
// futuro. El criterio de éxito acá NO es "hay un mensaje específico para
// cada código" (no hay copy para eso) sino "la app no explota": el loading
// se apaga, no queda una promesa colgada, y se pinta algún estado
// consistente. Re-ejercita una muestra representativa de los flujos P0/P1
// ya cableados en el resto de tests/integration/, solo cambiando el mock de
// respuesta — ver docs/testing/plan-agente-2-integration.md §2.15.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import {
  mockProductosEndpoint,
  mockReportesEndpoint,
  mockImportacionEndpoint,
  HttpResponse,
  respuestaError,
  respuestaNetworkError,
  respuestaConDelay,
} from '../../mocks/handlers'
import { itemBusqueda, productoEjemplo, itemAnalisisAplicable } from '../../mocks/fixtures'
import { limpiarDb, sembrarCatalogoCache } from '../../mocks/db-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { activarMultipartDeNode, crearArchivoDeTest } from '../../mocks/multipart-shim'
import { useAuthStore } from '../../../src/stores/auth'
import { useProductosStore } from '../../../src/stores/productos'
import { useReportesStore } from '../../../src/stores/reportes'
import { useImportacionPreciosStore } from '../../../src/stores/importacionPrecios'
import { useUiStore } from '../../../src/stores/ui'
import ProductoCard from '../../../src/components/ProductoCard.vue'
import { inputContado, inputVenta } from '../../mocks/producto-card-helpers'

// El backend real (swaidemo/apps/api_*.php) no emite ninguno de estos hoy —
// son los que un proxy/WAF/CDN podría llegar a inyectar delante.
const CODIGOS_NO_CONTEMPLADOS = [404, 409, 422, 429, 500]

function conToken() {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
}

function montarProductoCard(productoInicial) {
  conToken()
  const productos = useProductosStore()
  productos.actual = productoInicial
  const wrapper = mount(ProductoCard)
  return { wrapper, productos, ui: useUiStore() }
}

function botonPorTexto(wrapper, texto) {
  return wrapper.findAll('button').find((b) => b.text().includes(texto))
}


describe('Resiliencia: códigos/errores no contemplados hoy por el backend', () => {
  let restaurarMultipart

  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
    restaurarMultipart = activarMultipartDeNode()
  })

  afterEach(async () => {
    await limpiarDb()
    restaurarMultipart()
  })

  describe('productos.buscar contra códigos no contemplados', () => {
    it.each(CODIGOS_NO_CONTEMPLADOS)(
      'código %i: cae en el mismo catch que un error de red, hace fallback a catalogoCache, cargando se apaga',
      async (status) => {
        conToken()
        await sembrarCatalogoCache([itemBusqueda({ prod_id: 999, nombre: 'Fideos Cacheados', codigo: 'CACHE1' })])
        server.use(...mockProductosEndpoint({ buscar: respuestaError(status, `Error simulado ${status}.`) }))

        const productos = useProductosStore()
        await productos.buscar('fideos')

        expect(productos.cargando).toBe(false)
        expect(productos.error).toBe(`Error simulado ${status}.`)
        expect(productos.resultados).toHaveLength(1)
        expect(productos.resultados[0].nombre).toBe('Fideos Cacheados')
      }
    )
  })

  describe('productos.actualizarPrecio / registrarConteo (P0, financiero/stock) contra códigos no contemplados', () => {
    it.each(CODIGOS_NO_CONTEMPLADOS)(
      'actualizarPrecio código %i: la promesa rechaza igual (no hay manejo especial por código), ProductoCard muestra el mensaje del body, guardando se apaga',
      async (status) => {
        const { wrapper, ui } = montarProductoCard(productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 }))
        server.use(...mockProductosEndpoint({ actualizarPrecio: respuestaError(status, `Error simulado ${status}.`) }))

        await (await inputVenta(wrapper)).setValue(1500)
        await botonPorTexto(wrapper, 'Guardar precio').trigger('click')

        await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
        expect(ui.toast.mensaje).toBe(`Error simulado ${status}.`)
        expect(wrapper.text()).not.toContain('Guardando...')
      }
    )

    it.each(CODIGOS_NO_CONTEMPLADOS)(
      'registrarConteo código %i: mismo camino — toast de error, guardando se apaga sin crashear',
      async (status) => {
        const { wrapper, ui } = montarProductoCard(productoEjemplo({ prod_id: 101, stock_actual: 24 }))
        server.use(...mockProductosEndpoint({ registrarConteo: respuestaError(status, `Error simulado ${status}.`) }))

        await inputContado(wrapper).setValue(20)
        await botonPorTexto(wrapper, 'Guardar conteo').trigger('click')

        await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
        expect(ui.toast.mensaje).toBe(`Error simulado ${status}.`)
        expect(wrapper.text()).not.toContain('Guardando...')
      }
    )
  })

  describe('importacionPrecios.confirmarSeleccionados (P0) contra códigos no contemplados', () => {
    it.each(CODIGOS_NO_CONTEMPLADOS)('código %i: store.error queda con el mensaje del backend, aplicando se apaga sin crashear', async (status) => {
      const importacion = useImportacionPreciosStore()
      importacion.items = [{ ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: true }]
      server.use(...mockImportacionEndpoint({ confirmar: respuestaError(status, `Error simulado ${status}.`) }))

      await importacion.confirmarSeleccionados()

      expect(importacion.error).toBe(`Error simulado ${status}.`)
      expect(importacion.aplicando).toBe(false)
      expect(importacion.resumen).toBeNull()
      // A diferencia del éxito, items NO se vacía tras un error (permite reintentar).
      expect(importacion.items).toHaveLength(1)
    })
  })

  describe('network error genérico (HttpResponse.error() de MSW) contra al menos un endpoint de cada store', () => {
    it('productos.buscar: cae en "No hay conexión con el servidor.", cargando se apaga, no queda colgado', async () => {
      conToken()
      server.use(...mockProductosEndpoint({ buscar: respuestaNetworkError() }))
      const productos = useProductosStore()

      await productos.buscar('fideos')

      expect(productos.cargando).toBe(false)
      expect(productos.error).toBe('No hay conexión con el servidor.')
    })

    it('reportes.cargarPendientes: no hay try/catch en el store — la promesa rechaza en vez de manejarse en silencio (ver reportes/pendientes-controlar.spec.js para el caso completo mounteado)', async () => {
      conToken()
      server.use(...mockReportesEndpoint({ pendientesControlar: respuestaNetworkError() }))
      const reportes = useReportesStore()

      await expect(reportes.cargarPendientes(0)).rejects.toThrow('No hay conexión con el servidor.')
      // El `finally` sí corre aunque la promesa termine rechazando.
      expect(reportes.cargando).toBe(false)
    })

    it('importacionPrecios.analizarArchivo: cae en "No hay conexión con el servidor.", items queda vacío, no queda colgado', async () => {
      const importacion = useImportacionPreciosStore()
      server.use(...mockImportacionEndpoint({ analizar: respuestaNetworkError() }))

      const archivo = crearArchivoDeTest('codigo,precio\nCOD101,950', 'lista.csv', 'text/csv')
      await importacion.analizarArchivo(archivo)

      expect(importacion.error).toBe('No hay conexión con el servidor.')
      expect(importacion.items).toEqual([])
      expect(importacion.analizando).toBe(false)
    })

    it('[hallazgo nuevo] importacionPrecios.cargarProveedores: NO tiene try/catch propio (a diferencia de analizarArchivo/confirmarSeleccionados) — mismo patrón que reportes.js (test-matrix.md §2.3), la promesa rechaza en vez de manejarse en silencio', async () => {
      // cargarProveedores() (src/stores/importacionPrecios.js) es un
      // try/finally SIN catch, igual que cargarPendientes/cargarAjustes de
      // reportes.js — y ImportarView.vue lo llama desde onMounted() sin
      // await ni .catch(). Un error de red acá sería un unhandled promise
      // rejection real si algo lo dispara sin capturarlo, tal como está
      // fijado (con el mismo patrón) en
      // reportes/pendientes-controlar.spec.js. Acá se confirma a nivel store
      // en aislamiento (sin depender de capturar el unhandledRejection del
      // proceso) para dejar el comportamiento documentado como test.
      const importacion = useImportacionPreciosStore()
      server.use(...mockImportacionEndpoint({ proveedores: respuestaNetworkError() }))

      await expect(importacion.cargarProveedores()).rejects.toThrow('No hay conexión con el servidor.')
      // El `finally` sí corre igual, aunque la promesa termine rechazando.
      expect(importacion.cargandoProveedores).toBe(false)
    })
  })

  describe('delay largo pero acotado (no un cuelgue infinito real — ver hallazgo #4: apiClient no tiene AbortController/timeout)', () => {
    it(
      'actualizar_precio con delay(3000): guardando queda true y el botón deshabilitado mientras está pendiente, se resuelve bien al terminar',
      async () => {
        const { wrapper, productos } = montarProductoCard(productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 }))
        server.use(
          ...mockProductosEndpoint({
            actualizarPrecio: respuestaConDelay(3000, { status: 200, body: productoEjemplo({ prod_id: 101, precio_venta: 1500 }) }),
          })
        )

        await (await inputVenta(wrapper)).setValue(1500)
        const boton = botonPorTexto(wrapper, 'Guardar precio')
        await boton.trigger('click')

        // guardando.value = true se setea en guardar() antes de cualquier
        // await — ya debe estar reflejado tras el tick.
        expect(wrapper.text()).toContain('Guardando...')
        expect(boton.attributes('disabled')).toBeDefined()

        await esperarQue(() => expect(productos.actual.precio_venta).toBe(1500), { timeout: 4000 })
        expect(wrapper.text()).not.toContain('Guardando...')
      },
      6000
    )
  })

  describe('respuestas 200 mal formadas', () => {
    it('200 con success:false SIN "error": se usa el mensaje de fallback hardcodeado del store, no "undefined"', async () => {
      const { wrapper, ui } = montarProductoCard(productoEjemplo({ prod_id: 101, costo: 800, precio_venta: 1200 }))
      server.use(...mockProductosEndpoint({ actualizarPrecio: () => HttpResponse.json({ success: false }) }))

      await (await inputVenta(wrapper)).setValue(1500)
      await botonPorTexto(wrapper, 'Guardar precio').trigger('click')

      await esperarQue(() => expect(ui.toast?.tipo).toBe('error'))
      // Fallback definido en productos.js actualizarPrecio(), no en el componente.
      expect(ui.toast.mensaje).toBe('No se pudo actualizar el precio.')
    })

    it('200 con JSON inválido/vacío: parsearJson cae al mensaje genérico sin tirar una excepción no atrapada', async () => {
      conToken()
      await sembrarCatalogoCache([itemBusqueda({ prod_id: 999, nombre: 'Fideos Cacheados', codigo: 'CACHE1' })])
      server.use(...mockProductosEndpoint({ buscar: () => new HttpResponse('esto no es JSON {', { status: 200 }) }))

      const productos = useProductosStore()
      await productos.buscar('fideos')

      // apiClient.parsearJson() atrapa el .json() que falla y devuelve
      // {success:false, error:'Respuesta inválida del servidor.'} — ese
      // mensaje (no el fallback propio de buscar()) es el que queda.
      expect(productos.error).toBe('Respuesta inválida del servidor.')
      expect(productos.cargando).toBe(false)
      // Cae igual al fallback de cache, como cualquier otro error de buscar().
      expect(productos.resultados).toHaveLength(1)
    })
  })
})
