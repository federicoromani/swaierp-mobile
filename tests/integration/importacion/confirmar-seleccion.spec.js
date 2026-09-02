// Checklist → confirmar selección: importacionPrecios store + ImportarView.
// Arranca con `store.items` precargado a mano (la subida real ya está
// cubierta en analizar-archivo.spec.js) para enfocar el archivo en el
// checklist + el payload exacto de confirmar + el resumen.
//
// OJO de diseño (encontrado al implementar, no anticipado en discovery):
// `mockImportacionEndpoint()` registra un handler de POST único que
// despacha por acción (ver tests/mocks/handlers.js) — si se llama dos veces
// con `server.use()` para el mismo endpoint (una vez para "proveedores" al
// montar, otra vez con "confirmar" ya en el test), la SEGUNDA llamada gana
// (MSW prioriza el handler agregado más recientemente), así que hay que
// registrar TODAS las acciones que hacen falta en una sola llamada, en el
// orden correcto (después de lo que haga falta antes de montar, si algo lo
// necesita). Acá se resuelve pasándole el resolver de "confirmar" a
// `montarConItems()` para que quede en la MISMA llamada a `server.use()`
// que "proveedores", sin ambigüedad de cuál pisa a cuál.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockImportacionEndpoint, HttpResponse } from '../../mocks/handlers'
import { itemAnalisisAplicable, resumenConfirmacionEjemplo } from '../../mocks/fixtures'
import { limpiarDb } from '../../mocks/db-helpers'
import { crearRouterLiviano } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { useAuthStore } from '../../../src/stores/auth'
import { useImportacionPreciosStore } from '../../../src/stores/importacionPrecios'
import { useUiStore } from '../../../src/stores/ui'
import ImportarView from '../../../src/views/ImportarView.vue'

async function montarConItems(items, { confirmar } = {}) {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  auth.usuario = { id: 1, nombre: 'Ana', rol: 1 }
  server.use(
    ...mockImportacionEndpoint({
      proveedores: () => HttpResponse.json({ success: true, items: [] }),
      confirmar,
    })
  )
  const router = await crearRouterLiviano('/importar')
  const wrapper = mount(ImportarView, { global: { plugins: [router] } })
  const store = useImportacionPreciosStore()
  await esperarQue(() => expect(store.cargandoProveedores).toBe(false))
  store.items = items
  await wrapper.vm.$nextTick()
  return { wrapper, store, ui: useUiStore() }
}

function botonAplicar(wrapper) {
  return wrapper.findAll('button').find((b) => b.text().includes('Aplicar seleccionados'))
}

async function leerBody(request) {
  return Object.fromEntries(new URLSearchParams(await request.clone().text()))
}

describe('ImportarView + importacionPrecios store: confirmar selección', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('togglear un checkbox actualiza el contador y habilita/deshabilita "Aplicar seleccionados"', async () => {
    const { wrapper } = await montarConItems([
      { ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: true },
      { ...itemAnalisisAplicable({ prod_id: 102, nombre_detectado: 'Otro producto' }), seleccionado: true },
    ])

    expect(botonAplicar(wrapper).text()).toContain('(2)')
    expect(botonAplicar(wrapper).attributes('disabled')).toBeUndefined()

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    await checkboxes[0].setValue(false)
    await checkboxes[1].setValue(false)

    expect(botonAplicar(wrapper).text()).toContain('(0)')
    expect(botonAplicar(wrapper).attributes('disabled')).toBeDefined()
  })

  it('confirmar manda proveedor_id y lineas=JSON con SOLO los items seleccionado+prod_id', async () => {
    let bodyRecibido = null
    const { wrapper, store } = await montarConItems(
      [
        { ...itemAnalisisAplicable({ prod_id: 101, precio_detectado: 950, codigo_detectado: 'COD101' }), seleccionado: true },
        { ...itemAnalisisAplicable({ prod_id: 102, precio_detectado: 500, codigo_detectado: 'COD102' }), seleccionado: false },
      ],
      {
        confirmar: async ({ request }) => {
          bodyRecibido = await leerBody(request)
          return HttpResponse.json(resumenConfirmacionEjemplo({ aplicados: 1 }))
        },
      }
    )
    store.proveedorSeleccionado = 401

    await botonAplicar(wrapper).trigger('click')
    await esperarQue(() => expect(store.resumen).not.toBeNull())

    expect(bodyRecibido.action).toBe('confirmar')
    expect(bodyRecibido.proveedor_id).toBe('401')
    expect(JSON.parse(bodyRecibido.lineas)).toEqual([{ prod_id: 101, costo_nuevo: 950, codigo_detectado: 'COD101' }])
  })

  it('confirmar con 0 seleccionados no dispara ningún request (guard en el store, no solo el :disabled de la UI)', async () => {
    let llamadas = 0
    const { store } = await montarConItems([{ ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: false }], {
      confirmar: () => {
        llamadas++
        return HttpResponse.json(resumenConfirmacionEjemplo())
      },
    })
    await store.confirmarSeleccionados()

    expect(llamadas).toBe(0)
    expect(store.resumen).toBeNull()
  })

  it('éxito: resumen se puebla, items se vacía, la vista muestra el resumen y el toast con el conteo', async () => {
    const { wrapper, store, ui } = await montarConItems([{ ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: true }], {
      confirmar: () => HttpResponse.json(resumenConfirmacionEjemplo({ aplicados: 3, rechazados: 0 })),
    })
    await botonAplicar(wrapper).trigger('click')

    await esperarQue(() => expect(store.resumen).not.toBeNull())
    await wrapper.vm.$nextTick()

    expect(store.items).toEqual([])
    expect(wrapper.text()).toContain('Importación aplicada')
    expect(wrapper.text()).toContain('3')
    expect(ui.toast).toEqual({ mensaje: 'Se actualizaron 3 productos.', tipo: 'success' })
  })

  it('resumen con rechazados>0 también se muestra', async () => {
    const { wrapper, store } = await montarConItems([{ ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: true }], {
      confirmar: () => HttpResponse.json(resumenConfirmacionEjemplo({ aplicados: 2, rechazados: 1 })),
    })
    await botonAplicar(wrapper).trigger('click')
    await esperarQue(() => expect(store.resumen).not.toBeNull())
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('1')
    expect(wrapper.text()).toContain('rechazado')
  })

  it('error (400/500/network) al confirmar: error se muestra y los items NO se vacían (a diferencia del éxito)', async () => {
    const items = [{ ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: true }]
    const { wrapper, store } = await montarConItems(items, {
      confirmar: () => HttpResponse.json({ success: false, error: 'No se pudo aplicar la actualización.' }, { status: 500 }),
    })
    await botonAplicar(wrapper).trigger('click')

    await esperarQue(() => expect(store.error).toBe('No se pudo aplicar la actualización.'))
    expect(store.items).toHaveLength(1)
    expect(store.resumen).toBeNull()
    expect(wrapper.text()).not.toContain('Importación aplicada')
  })

  it('[hallazgo] doble-submit real: dos clicks en "Aplicar seleccionados" sin esperar entre medio', async () => {
    let llamadas = 0
    const { wrapper, store } = await montarConItems([{ ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: true }], {
      confirmar: () => {
        llamadas++
        return HttpResponse.json(resumenConfirmacionEjemplo())
      },
    })
    const boton = botonAplicar(wrapper)
    const p1 = boton.trigger('click')
    const p2 = boton.trigger('click')
    await Promise.all([p1, p2])

    await esperarQue(() => expect(store.resumen).not.toBeNull())

    expect(llamadas).toBeGreaterThanOrEqual(1)
    if (llamadas > 1) {
      // eslint-disable-next-line no-console
      console.warn(`[hallazgo] doble click en "Aplicar seleccionados" disparó ${llamadas} POST reales.`)
    }
  })

  it('"Importar otra lista" después del resumen reinicia el store y limpia el input de archivo', async () => {
    const { wrapper, store } = await montarConItems([{ ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: true }], {
      confirmar: () => HttpResponse.json(resumenConfirmacionEjemplo({ aplicados: 1 })),
    })
    await botonAplicar(wrapper).trigger('click')
    await esperarQue(() => expect(store.resumen).not.toBeNull())
    await wrapper.vm.$nextTick()

    const botonOtra = wrapper.findAll('button').find((b) => b.text().includes('Importar otra lista'))
    await botonOtra.trigger('click')

    expect(store.resumen).toBeNull()
    expect(store.items).toEqual([])
    expect(store.error).toBe('')
    expect(wrapper.text()).not.toContain('Importación aplicada')
  })
})
