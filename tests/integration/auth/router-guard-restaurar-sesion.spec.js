// Guard de router (src/router/index.js) + auth.restaurarSesion() — el boot
// de sesión desde Dexie que corre antes de resolver cualquier ruta
// protegida. Usa el ROUTER SINGLETON real (a diferencia de login.spec.js),
// porque acá es justamente el guard lo que se está probando — ver
// tests/mocks/router-helpers.js para el porqué de `routerYStoresFrescos()`
// (vi.resetModules() + reimport en cada test, validado con un spike antes
// de escribir el resto de la suite).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockAuthEndpoint, HttpResponse } from '../../mocks/handlers'
import { datosRefresh } from '../../mocks/fixtures'
import { sembrarRefreshToken, leerRefreshTokenGuardado, limpiarDb } from '../../mocks/db-helpers'
import { routerYStoresFrescos } from '../../mocks/router-helpers'

describe('router guard + restaurarSesion (boot de sesión desde Dexie)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('sin refresh token en Dexie: no pega a la red, redirige a /login con ?redirect a la ruta pedida', async () => {
    let refreshCalls = 0
    server.use(...mockAuthEndpoint({ refresh: () => { refreshCalls++; return HttpResponse.json(datosRefresh()) } }))

    const { router } = await routerYStoresFrescos()
    await router.push('/buscar')

    expect(refreshCalls).toBe(0)
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/buscar')
  })

  it('con refresh token válido en Dexie: refresca, deja pasar, y Dexie queda con el token rotado', async () => {
    await sembrarRefreshToken('rt-guardado')
    let refreshCalls = 0
    server.use(
      ...mockAuthEndpoint({
        refresh: () => {
          refreshCalls++
          return HttpResponse.json(datosRefresh({ access_token: 'at-restaurado', refresh_token: 'rt-restaurado' }))
        },
      })
    )

    const { router, useAuthStore } = await routerYStoresFrescos()
    await router.push('/buscar')
    const auth = useAuthStore()

    expect(refreshCalls).toBe(1)
    expect(router.currentRoute.value.name).toBe('buscar')
    expect(auth.accessToken).toBe('at-restaurado')
    expect(auth.listo).toBe(true)
    expect(await leerRefreshTokenGuardado()).toBe('rt-restaurado')
  })

  it('con refresh token inválido/revocado en Dexie: limpia sesión y redirige a /login?redirect=<ruta original>', async () => {
    await sembrarRefreshToken('rt-revocado')
    server.use(
      ...mockAuthEndpoint({
        refresh: () => HttpResponse.json({ success: false, error: 'Sesión inválida...' }, { status: 401 }),
      })
    )

    const { router, useAuthStore } = await routerYStoresFrescos()
    await router.push('/reportes')
    const auth = useAuthStore()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/reportes')
    expect(auth.accessToken).toBeNull()
    expect(await leerRefreshTokenGuardado()).toBeNull()
  })

  it('navegar a /login estando ya autenticado redirige a /buscar en vez de mostrar el form', async () => {
    await sembrarRefreshToken('rt-guardado')
    server.use(
      ...mockAuthEndpoint({
        refresh: () => HttpResponse.json(datosRefresh({ access_token: 'at-x', refresh_token: 'rt-x' })),
      })
    )

    const { router } = await routerYStoresFrescos()
    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('buscar')
  })

  it('navegar a /login con ?redirect estando ya autenticado respeta ese redirect en vez de /buscar', async () => {
    await sembrarRefreshToken('rt-guardado')
    server.use(
      ...mockAuthEndpoint({
        refresh: () => HttpResponse.json(datosRefresh({ access_token: 'at-x', refresh_token: 'rt-x' })),
      })
    )

    const { router } = await routerYStoresFrescos()
    await router.push('/login?redirect=%2Freportes')

    expect(router.currentRoute.value.path).toBe('/reportes')
  })

  it('restaurarSesion() solo corre una vez por sesión de app: una segunda navegación no vuelve a llamar a action=refresh', async () => {
    await sembrarRefreshToken('rt-guardado')
    let refreshCalls = 0
    server.use(
      ...mockAuthEndpoint({
        refresh: () => {
          refreshCalls++
          return HttpResponse.json(datosRefresh({ access_token: 'at-x', refresh_token: 'rt-x' }))
        },
      })
    )

    const { router } = await routerYStoresFrescos()
    await router.push('/buscar')
    expect(refreshCalls).toBe(1)

    await router.push('/reportes')
    expect(refreshCalls).toBe(1)
    expect(router.currentRoute.value.name).toBe('reportes')
  })

  it('ruta con meta.requiresAuth:false (/login) sin sesión en Dexie no intenta refrescar y muestra el form', async () => {
    let refreshCalls = 0
    server.use(...mockAuthEndpoint({ refresh: () => { refreshCalls++; return HttpResponse.json(datosRefresh()) } }))

    const { router } = await routerYStoresFrescos()
    await router.push('/login')

    expect(refreshCalls).toBe(0)
    expect(router.currentRoute.value.name).toBe('login')
  })
})
