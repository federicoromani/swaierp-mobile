// Importación de precios: carga de proveedores + subida de archivo →
// análisis (multipart real). Usa el shim de tests/mocks/multipart-shim.js
// (ver ese archivo para el porqué: cross-realm File/FormData entre jsdom y
// el fetch de Node que usa MSW) — SIEMPRE con archivos no-imagen (CSV/PDF)
// para no depender de canvas/createImageBitmap en jsdom, que es zona de
// Subagente 1 (comprimirSiEsImagen en aislamiento).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockImportacionEndpoint, HttpResponse } from '../../mocks/handlers'
import { proveedorEjemplo, itemAnalisisAplicable, itemAnalisisNoAplicable, respuestaAnalizarEjemplo } from '../../mocks/fixtures'
import { limpiarDb } from '../../mocks/db-helpers'
import { crearRouterLiviano } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { activarMultipartDeNode, crearArchivoDeTest } from '../../mocks/multipart-shim'
import { useAuthStore } from '../../../src/stores/auth'
import { useImportacionPreciosStore } from '../../../src/stores/importacionPrecios'
import ImportarView from '../../../src/views/ImportarView.vue'

async function montar() {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  auth.usuario = { id: 1, nombre: 'Ana', rol: 1 }
  const router = await crearRouterLiviano('/importar')
  const wrapper = mount(ImportarView, { global: { plugins: [router] } })
  return { wrapper, store: useImportacionPreciosStore() }
}

async function seleccionarArchivo(wrapper, archivo) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [archivo], writable: false, configurable: true })
  await input.trigger('change')
}

describe('ImportarView + importacionPrecios store: proveedores + análisis', () => {
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

  it('al montar carga los proveedores y los pone en el select', async () => {
    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [proveedorEjemplo()] }),
      })
    )

    const { wrapper, store } = await montar()
    await esperarQue(() => expect(store.proveedores).toHaveLength(1))
    expect(wrapper.text()).toContain('Distribuidora del Centro')
  })

  it('cargarProveedores no repite el fetch si ya hay proveedores cargados', async () => {
    let llamadas = 0
    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => {
          llamadas++
          return HttpResponse.json({ success: true, items: [proveedorEjemplo()] })
        },
      })
    )

    const { store } = await montar()
    await esperarQue(() => expect(store.proveedores).toHaveLength(1))
    await store.cargarProveedores()

    expect(llamadas).toBe(1)
  })

  it('subir un archivo no-imagen manda multipart con action/archivo/proveedor_id correctos', async () => {
    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [proveedorEjemplo({ per_id: 401 })] }),
      })
    )
    const { wrapper, store } = await montar()
    await esperarQue(() => expect(store.proveedores).toHaveLength(1))
    store.proveedorSeleccionado = 401

    let formDataRecibido = null
    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [] }),
        analizar: ({ formData }) => {
          formDataRecibido = formData
          return HttpResponse.json(respuestaAnalizarEjemplo())
        },
      })
    )

    const archivo = crearArchivoDeTest('codigo,precio\nCOD101,950', 'lista.csv', 'text/csv')
    await seleccionarArchivo(wrapper, archivo)

    await esperarQue(() => expect(store.items.length).toBeGreaterThan(0))

    expect(formDataRecibido.get('action')).toBe('analizar')
    expect(formDataRecibido.get('proveedor_id')).toBe('401')
    const archivoRecibido = formDataRecibido.get('archivo')
    expect(archivoRecibido.name).toBe('lista.csv')
    expect(await archivoRecibido.text()).toContain('COD101,950')
  })

  it('respuesta con sin_match>0 y avisos: se muestran ambos', async () => {
    server.use(...mockImportacionEndpoint({ proveedores: () => HttpResponse.json({ success: true, items: [] }) }))
    const { wrapper, store } = await montar()
    await esperarQue(() => expect(store.cargandoProveedores).toBe(false))

    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [] }),
        analizar: () =>
          HttpResponse.json(
            respuestaAnalizarEjemplo({
              items: [itemAnalisisAplicable(), itemAnalisisNoAplicable()],
              avisos: ['El archivo tiene 2 hojas, se usó la primera.'],
            })
          ),
      })
    )

    await seleccionarArchivo(wrapper, crearArchivoDeTest('a,b', 'lista.csv', 'text/csv'))
    await esperarQue(() => expect(store.items.length).toBe(2))

    expect(store.sinMatch).toBe(1)
    expect(wrapper.text()).toContain('línea')
    expect(wrapper.text()).toContain('no se pudo identificar en el catálogo')
    expect(wrapper.text()).toContain('El archivo tiene 2 hojas, se usó la primera.')
  })

  it('items no aplicables: checkbox deshabilitado, sin seleccionar por default, motivo visible', async () => {
    server.use(...mockImportacionEndpoint({ proveedores: () => HttpResponse.json({ success: true, items: [] }) }))
    const { wrapper, store } = await montar()
    await esperarQue(() => expect(store.cargandoProveedores).toBe(false))

    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [] }),
        analizar: () => HttpResponse.json(respuestaAnalizarEjemplo({ items: [itemAnalisisNoAplicable()] })),
      })
    )
    await seleccionarArchivo(wrapper, crearArchivoDeTest('a,b', 'lista.csv', 'text/csv'))
    await esperarQue(() => expect(store.items.length).toBe(1))

    expect(store.items[0].seleccionado).toBe(false)
    const checkbox = wrapper.find('input[type="checkbox"]')
    expect(checkbox.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('No se encontró un producto que coincida')
  })

  it('items aplicables vienen preseleccionados (seleccionado=aplicable)', async () => {
    server.use(...mockImportacionEndpoint({ proveedores: () => HttpResponse.json({ success: true, items: [] }) }))
    const { wrapper, store } = await montar()
    await esperarQue(() => expect(store.cargandoProveedores).toBe(false))

    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [] }),
        analizar: () => HttpResponse.json(respuestaAnalizarEjemplo({ items: [itemAnalisisAplicable()] })),
      })
    )
    await seleccionarArchivo(wrapper, crearArchivoDeTest('a,b', 'lista.csv', 'text/csv'))
    await esperarQue(() => expect(store.items.length).toBe(1))

    expect(store.items[0].seleccionado).toBe(true)
    expect(wrapper.find('input[type="checkbox"]').element.checked).toBe(true)
  })

  it('error al analizar (400/500/network): store.error se muestra, items queda vacío, analizando vuelve a false', async () => {
    server.use(...mockImportacionEndpoint({ proveedores: () => HttpResponse.json({ success: true, items: [] }) }))
    const { wrapper, store } = await montar()
    await esperarQue(() => expect(store.cargandoProveedores).toBe(false))

    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [] }),
        analizar: () => HttpResponse.json({ success: false, error: 'No se pudo analizar el archivo.' }, { status: 500 }),
      })
    )
    await seleccionarArchivo(wrapper, crearArchivoDeTest('a,b', 'lista.csv', 'text/csv'))

    await esperarQue(() => expect(store.error).toBe('No se pudo analizar el archivo.'))
    expect(store.items).toEqual([])
    expect(store.analizando).toBe(false)
    expect(wrapper.text()).toContain('No se pudo analizar el archivo.')
  })

  it('recuperación: falla el análisis, el usuario elige otro archivo y el segundo intento limpia el error', async () => {
    let intentos = 0
    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [] }),
        analizar: () => {
          intentos++
          if (intentos === 1) {
            return HttpResponse.json({ success: false, error: 'No se pudo analizar el archivo.' }, { status: 500 })
          }
          return HttpResponse.json(respuestaAnalizarEjemplo({ items: [itemAnalisisAplicable()] }))
        },
      })
    )

    const { wrapper, store } = await montar()
    await esperarQue(() => expect(store.cargandoProveedores).toBe(false))

    await seleccionarArchivo(wrapper, crearArchivoDeTest('a,b', 'primero.csv', 'text/csv'))
    await esperarQue(() => expect(store.error).toBeTruthy())

    await seleccionarArchivo(wrapper, crearArchivoDeTest('c,d', 'segundo.csv', 'text/csv'))
    await esperarQue(() => expect(store.items.length).toBe(1))

    expect(store.error).toBe('')
    expect(intentos).toBe(2)
  })
})
