// Interceptor 401 + refresh single-flight de src/services/apiClient.js.
// Es la pieza más riesgosa de todo el módulo de auth (spec del usuario:
// "P0 puro, probalo a fondo") y la base de la que dependen indirectamente
// TODOS los demás flujos autenticados — por eso va primera en la Ronda 2,
// antes que login/router/logout.
//
// Se testea contra apiClient.js directo (get/post/postFormData), no a
// través de un store, para aislar el comportamiento del interceptor en sí
// de cualquier manejo de error particular de cada store.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import {
  mockAuthEndpoint,
  mockProductosEndpoint,
  mockReportesEndpoint,
  mockImportacionEndpoint,
  HttpResponse,
  delay,
} from '../../mocks/handlers'
import { sembrarRefreshToken, leerRefreshTokenGuardado, limpiarDb } from '../../mocks/db-helpers'
import { datosRefresh, usuarioAdmin } from '../../mocks/fixtures'
import { activarMultipartDeNode, crearArchivoDeTest } from '../../mocks/multipart-shim'
import { useAuthStore } from '../../../src/stores/auth'
import { get, post, postFormData } from '../../../src/services/apiClient'

// Resolver reusable: 401 si el request trae el token viejo, 200 con el body
// dado si trae el token nuevo — así se puede simular "el token vence, se
// refresca, el reintento con el token nuevo funciona" sin duplicar la
// lógica en cada test.
function segunToken({ viejo = 'Bearer at-viejo', nuevo = 'Bearer at-nuevo', bodyOk = { success: true } } = {}) {
  return ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (auth === nuevo) {
      return HttpResponse.json(bodyOk, { status: 200 })
    }
    if (auth === viejo) {
      return HttpResponse.json({ success: false, error: 'Token expirado.' }, { status: 401 })
    }
    return HttpResponse.json({ success: false, error: `[test] token inesperado: ${auth}` }, { status: 401 })
  }
}

describe('apiClient: interceptor 401 + refresh single-flight', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('un solo request con 401 dispara el refresh una vez y reintenta con el token nuevo', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'at-viejo'
    await sembrarRefreshToken('rt-valido')

    let refreshCalls = 0
    server.use(
      ...mockAuthEndpoint({
        refresh: () => {
          refreshCalls++
          return HttpResponse.json(datosRefresh({ access_token: 'at-nuevo', refresh_token: 'rt-nuevo' }))
        },
      }),
      ...mockProductosEndpoint({
        buscar: segunToken({ bodyOk: { success: true, items: [] } }),
      })
    )

    const data = await get('/api_productos.php', { action: 'buscar', q: 'fideos', limit: 20 })

    expect(refreshCalls).toBe(1)
    expect(data.success).toBe(true)
    expect(auth.accessToken).toBe('at-nuevo')
    // El refresh token ROTA: Dexie debe quedar con el nuevo, no con el que
    // arrancó el test.
    expect(await leerRefreshTokenGuardado()).toBe('rt-nuevo')
  })

  it('si el refresh también falla, limpia la sesión local y devuelve el 401 ORIGINAL (no uno sintetizado)', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'at-viejo'
    auth.usuario = usuarioAdmin()
    await sembrarRefreshToken('rt-invalido')

    server.use(
      ...mockAuthEndpoint({
        refresh: () => HttpResponse.json({ success: false, error: 'Sesión inválida...' }, { status: 401 }),
      }),
      ...mockProductosEndpoint({
        buscar: () => HttpResponse.json({ success: false, error: 'Token expirado real del backend.' }, { status: 401 }),
      })
    )

    const data = await get('/api_productos.php', { action: 'buscar', q: 'fideos' })

    expect(data.success).toBe(false)
    expect(data.error).toBe('Token expirado real del backend.')
    expect(auth.accessToken).toBeNull()
    expect(auth.usuario).toBeNull()
    expect(await leerRefreshTokenGuardado()).toBeNull()
  })

  it('3 requests en paralelo que reciben 401 al mismo tiempo disparan UN SOLO refresh', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'at-viejo'
    await sembrarRefreshToken('rt-valido')

    let refreshCalls = 0
    server.use(
      ...mockAuthEndpoint({
        refresh: async () => {
          refreshCalls++
          // Delay a propósito: da tiempo a que los 3 requests originales
          // lleguen a pedir el refresh ANTES de que el primero resuelva —
          // sin esto el test podría "pasar de casualidad" aunque el
          // single-flight estuviera roto.
          await delay(30)
          return HttpResponse.json(datosRefresh({ access_token: 'at-nuevo', refresh_token: 'rt-nuevo' }))
        },
      }),
      ...mockProductosEndpoint({
        buscar: segunToken({ bodyOk: { success: true, items: [] } }),
        detalle: segunToken({ bodyOk: { success: true, prod_id: 101 } }),
      }),
      ...mockReportesEndpoint({
        pendientesControlar: segunToken({ bodyOk: { success: true, items: [], total: 0 } }),
      })
    )

    const [rBuscar, rDetalle, rReportes] = await Promise.all([
      get('/api_productos.php', { action: 'buscar', q: 'a', limit: 20 }),
      get('/api_productos.php', { action: 'detalle', prod_id: 101 }),
      get('/api_reportes.php', { action: 'pendientes_controlar', dias: 7, limit: 20, offset: 0 }),
    ])

    expect(refreshCalls).toBe(1)
    expect(rBuscar.success).toBe(true)
    expect(rDetalle.success).toBe(true)
    expect(rReportes.success).toBe(true)
    expect(auth.accessToken).toBe('at-nuevo')
  })

  it('el single-flight es compartido entre peticion() (get/post) y postFormData()', async () => {
    const restaurar = activarMultipartDeNode()
    try {
      const auth = useAuthStore()
      auth.accessToken = 'at-viejo'
      await sembrarRefreshToken('rt-valido')

      let refreshCalls = 0
      server.use(
        ...mockAuthEndpoint({
          refresh: async () => {
            refreshCalls++
            await delay(30)
            return HttpResponse.json(datosRefresh({ access_token: 'at-nuevo', refresh_token: 'rt-nuevo' }))
          },
        }),
        ...mockProductosEndpoint({
          buscar: segunToken({ bodyOk: { success: true, items: [] } }),
        }),
        ...mockImportacionEndpoint({
          analizar: segunToken({ bodyOk: { success: true, items: [], sin_match: 0, avisos: [], fuente: 'heuristica_csv' } }),
        })
      )

      const archivo = crearArchivoDeTest('a,b\n1,2', 'lista.csv', 'text/csv')
      const formData = new FormData()
      formData.append('action', 'analizar')
      formData.append('archivo', archivo)

      const [rBuscar, rAnalizar] = await Promise.all([
        get('/api_productos.php', { action: 'buscar', q: 'a', limit: 20 }),
        postFormData('/api_importacion_precios.php', formData),
      ])

      expect(refreshCalls).toBe(1)
      expect(rBuscar.success).toBe(true)
      expect(rAnalizar.success).toBe(true)
    } finally {
      restaurar()
    }
  })

  it('un 401 en un request con auth:false (login) NO dispara el refresh — evita el loop infinito', async () => {
    let refreshCalls = 0
    server.use(
      ...mockAuthEndpoint({
        login: () => HttpResponse.json({ success: false, error: 'Usuario o clave incorrecta.' }, { status: 401 }),
        refresh: () => {
          refreshCalls++
          return HttpResponse.json(datosRefresh())
        },
      })
    )

    const data = await post(
      '/api_auth.php',
      { action: 'login', usuario: 'ana', clave: 'mala', dispositivo: 'test' },
      { auth: false }
    )

    expect(data.success).toBe(false)
    expect(refreshCalls).toBe(0)
  })

  it('si el reintento post-refresh también falla (500), se propaga tal cual sin un segundo refresh', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'at-viejo'
    await sembrarRefreshToken('rt-valido')

    let refreshCalls = 0
    server.use(
      ...mockAuthEndpoint({
        refresh: () => {
          refreshCalls++
          return HttpResponse.json(datosRefresh({ access_token: 'at-nuevo', refresh_token: 'rt-nuevo' }))
        },
      }),
      ...mockProductosEndpoint({
        buscar: ({ request }) => {
          const header = request.headers.get('Authorization')
          if (header === 'Bearer at-viejo') {
            return HttpResponse.json({ success: false, error: 'Token expirado.' }, { status: 401 })
          }
          return HttpResponse.json({ success: false, error: 'Error interno del servidor.' }, { status: 500 })
        },
      })
    )

    const data = await get('/api_productos.php', { action: 'buscar', q: 'a' })

    expect(refreshCalls).toBe(1)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Error interno del servidor.')
  })
})
