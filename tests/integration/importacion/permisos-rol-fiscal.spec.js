// Permisos: usuario rol FISCAL contra los endpoints de importación — P0.
//
// Hallazgo #1 del discovery (ver docs/testing/plan-agente-2-integration.md
// §0 y test-matrix.md §2 punto 2): src/router/index.js NO tiene ningún
// `meta.rolesPermitidos` ni chequeo de `usuario.rol` — TabBar.vue oculta el
// link "Importar" para rol FISCAL, pero es solo UX (comentario propio en el
// código). Cualquier usuario autenticado que navegue a /importar por URL
// entra igual; la única defensa real es el 403 que devuelve el backend en
// cada acción. Este archivo fija ese comportamiento tal cual es hoy.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockAuthEndpoint, mockImportacionEndpoint, HttpResponse } from '../../mocks/handlers'
import {
  usuarioFiscal,
  usuarioAdmin,
  datosRefresh,
  proveedorEjemplo,
  itemAnalisisAplicable,
  respuestaAnalizarEjemplo,
} from '../../mocks/fixtures'
import { sembrarRefreshToken, limpiarDb } from '../../mocks/db-helpers'
import { crearRouterLiviano, routerYStoresFrescos } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { activarMultipartDeNode, crearArchivoDeTest } from '../../mocks/multipart-shim'
import { useAuthStore } from '../../../src/stores/auth'
import { useImportacionPreciosStore } from '../../../src/stores/importacionPrecios'
import ImportarView from '../../../src/views/ImportarView.vue'

const ERROR_403 = 'No tenés permiso para realizar esta acción.'

function respuesta403() {
  return { status: 403, body: { success: false, error: ERROR_403 } }
}

async function montarComoRol(usuario, acciones = {}) {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  auth.usuario = usuario
  server.use(...mockImportacionEndpoint(acciones))
  const router = await crearRouterLiviano('/importar')
  const wrapper = mount(ImportarView, { global: { plugins: [router] } })
  return { wrapper, store: useImportacionPreciosStore(), router }
}

async function seleccionarArchivo(wrapper, archivo) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [archivo], writable: false, configurable: true })
  await input.trigger('change')
}

describe('Importación: permisos rol FISCAL (403 real, sin guard de rol en el router)', () => {
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

  it('[hallazgo #1] el router real no chequea rol: un usuario FISCAL autenticado navega a /importar sin que el guard lo bloquee', async () => {
    // Usa el ROUTER SINGLETON real (no el liviano) para probar el guard en
    // sí, con el mismo patrón que router-guard-restaurar-sesion.spec.js.
    await sembrarRefreshToken('rt-fiscal')
    server.use(...mockAuthEndpoint({ refresh: () => HttpResponse.json(datosRefresh()) }))

    const { router, useAuthStore: useAuthStoreFresco } = await routerYStoresFrescos()
    await router.push('/buscar') // dispara restaurarSesion() vía Dexie
    const auth = useAuthStoreFresco()
    auth.usuario = usuarioFiscal() // simula sesión ya autenticada de un usuario rol FISCAL

    await router.push('/importar')

    // El guard de src/router/index.js solo mira auth.estaAutenticado, nunca
    // auth.usuario.rol — por eso deja pasar igual, aunque TabBar.vue oculte
    // el link para este rol.
    expect(router.currentRoute.value.name).toBe('importar')
  })

  it('proveedores con 403: el store no crashea — cargandoProveedores se apaga y proveedores queda [] en silencio (sin try/catch por-error en cargarProveedores)', async () => {
    const { wrapper, store } = await montarComoRol(usuarioFiscal(), { proveedores: respuesta403() })

    await esperarQue(() => expect(store.cargandoProveedores).toBe(false))
    // cargarProveedores() solo chequea `if (data.success)`: un 403
    // (success:false) no dispara ningún error visible ni rompe nada — queda
    // en silencio, igual que el hallazgo ya documentado sobre reportes.js.
    expect(store.proveedores).toEqual([])
    expect(store.error).toBe('')
    expect(wrapper.text()).toContain('Importar lista de precios')
  })

  it('analizar con 403: store.error queda con el mensaje del backend (analizarArchivo SÍ tiene try/catch propio)', async () => {
    const { wrapper, store } = await montarComoRol(usuarioFiscal(), {
      proveedores: () => HttpResponse.json({ success: true, items: [] }),
    })
    await esperarQue(() => expect(store.cargandoProveedores).toBe(false))

    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [] }),
        analizar: () => HttpResponse.json({ success: false, error: ERROR_403 }, { status: 403 }),
      })
    )
    await seleccionarArchivo(wrapper, crearArchivoDeTest('codigo,precio\nCOD101,950', 'lista.csv', 'text/csv'))

    await esperarQue(() => expect(store.error).toBe(ERROR_403))
    expect(store.items).toEqual([])
    expect(store.analizando).toBe(false)
    expect(wrapper.text()).toContain(ERROR_403)
  })

  it('confirmar con 403: store.error queda con el mensaje del backend, items NO se vacía', async () => {
    const { wrapper, store } = await montarComoRol(usuarioFiscal(), {
      proveedores: () => HttpResponse.json({ success: true, items: [] }),
      confirmar: () => HttpResponse.json({ success: false, error: ERROR_403 }, { status: 403 }),
    })
    await esperarQue(() => expect(store.cargandoProveedores).toBe(false))
    store.items = [{ ...itemAnalisisAplicable({ prod_id: 101 }), seleccionado: true }]
    await wrapper.vm.$nextTick()

    await store.confirmarSeleccionados()

    expect(store.error).toBe(ERROR_403)
    expect(store.items).toHaveLength(1)
    expect(store.resumen).toBeNull()
  })

  it('control positivo: rol ADMINISTRADOR (1) contra los mismos flujos en 200 no tiene ninguna restricción', async () => {
    const { wrapper, store } = await montarComoRol(usuarioAdmin(), {
      proveedores: () => HttpResponse.json({ success: true, items: [proveedorEjemplo()] }),
    })
    await esperarQue(() => expect(store.proveedores).toHaveLength(1))
    expect(wrapper.text()).toContain('Distribuidora del Centro')

    server.use(
      ...mockImportacionEndpoint({
        proveedores: () => HttpResponse.json({ success: true, items: [proveedorEjemplo()] }),
        analizar: () => HttpResponse.json(respuestaAnalizarEjemplo({ items: [itemAnalisisAplicable()] })),
      })
    )
    await seleccionarArchivo(wrapper, crearArchivoDeTest('codigo,precio\nCOD101,950', 'lista.csv', 'text/csv'))
    await esperarQue(() => expect(store.items.length).toBe(1))

    expect(store.error).toBe('')
  })
})
