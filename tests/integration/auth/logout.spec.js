// Logout: auth.logout() a nivel store + authService + Dexie.
//
// Hallazgo de discovery (ver docs/testing/plan-agente-2-integration.md #6 y
// docs/testing/test-matrix.md sección 2, punto 1): ningún componente de la
// app invoca `auth.logout()` — no hay botón de "Cerrar sesión" en ningún
// lado. Por eso este archivo testea la acción del store directamente, no
// como interacción de un componente montado.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockAuthEndpoint, HttpResponse } from '../../mocks/handlers'
import { sembrarRefreshToken, leerRefreshTokenGuardado, limpiarDb } from '../../mocks/db-helpers'
import { usuarioAdmin } from '../../mocks/fixtures'
import { useAuthStore } from '../../../src/stores/auth'

describe('auth store: logout', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('logout con sesión activa: manda el refresh token al backend y limpia estado + Dexie', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'at-activo'
    auth.usuario = usuarioAdmin()
    await sembrarRefreshToken('rt-activo')

    let bodyRecibido = null
    server.use(
      ...mockAuthEndpoint({
        logout: async ({ request }) => {
          bodyRecibido = Object.fromEntries(new URLSearchParams(await request.clone().text()))
          return HttpResponse.json({ success: true })
        },
      })
    )

    await auth.logout()

    expect(bodyRecibido).toEqual({ action: 'logout', refresh_token: 'rt-activo' })
    expect(auth.accessToken).toBeNull()
    expect(auth.usuario).toBeNull()
    expect(await leerRefreshTokenGuardado()).toBeNull()
  })

  it('logout best-effort: si el backend responde error, igual limpia la sesión local (no la deja "colgada")', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'at-activo'
    auth.usuario = usuarioAdmin()
    await sembrarRefreshToken('rt-activo')

    server.use(...mockAuthEndpoint({ logout: () => HttpResponse.json({ success: false }, { status: 500 }) }))

    await auth.logout()

    expect(auth.accessToken).toBeNull()
    expect(await leerRefreshTokenGuardado()).toBeNull()
  })

  it('logout sin conexión: el catch interno lo atrapa y limpia igual el estado local', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'at-activo'
    auth.usuario = usuarioAdmin()
    await sembrarRefreshToken('rt-activo')

    server.use(...mockAuthEndpoint({ logout: () => HttpResponse.error() }))

    await expect(auth.logout()).resolves.toBeUndefined()
    expect(auth.accessToken).toBeNull()
    expect(await leerRefreshTokenGuardado()).toBeNull()
  })

  it('logout sin refresh token guardado (ya deslogueado): no llama al backend, no explota', async () => {
    const auth = useAuthStore()
    auth.accessToken = null

    let llamadas = 0
    server.use(...mockAuthEndpoint({ logout: () => { llamadas++; return HttpResponse.json({ success: true }) } }))

    await auth.logout()

    expect(llamadas).toBe(0)
    expect(auth.accessToken).toBeNull()
  })
})
