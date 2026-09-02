import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../../../src/stores/auth'
import { db } from '../../../src/offline/db'
import * as authService from '../../../src/services/authService'

// router/index.js solo exporta el router YA instanciado (createWebHistory,
// no createMemoryHistory) — se navega el singleton real y se lee
// router.currentRoute.value (ver plan, problema de testabilidad #4).
// authService se mockea para no pegarle a fetch real desde el guard.
vi.mock('../../../src/services/authService')

// HALLAZGO nuevo respecto al discovery (ver reporte de Ronda 2): resetear
// solo window.history con replaceState() NO alcanza. El router guarda su
// propio `currentRoute` interno, independiente de la URL cruda del browser;
// empujar la MISMA ruta que ya estaba activa en el test anterior queda
// clasificado por Vue Router como "navegación duplicada" y el beforeEach NO
// se vuelve a ejecutar (currentRoute no cambia, el test queda leyendo el
// resultado del test anterior). La única forma confiable de aislar tests
// sobre el router singleton es reimportarlo fresco en cada test con
// vi.resetModules() + import() dinámico — así currentRoute arranca siempre
// en START_LOCATION y ningún push puede ser "duplicado" del test anterior.
// El mock de authService sigue aplicando igual (vi.mock persiste a través
// de resetModules): se verificó corriendo la suite.
describe('router/index (guard de auth)', () => {
  let router

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    await db.sesion.clear()
    vi.resetModules()
    ;({ default: router } = await import('../../../src/router/index.js'))
  })

  it('no autenticado navegando a una ruta protegida redirige a login con el redirect original', async () => {
    await router.push('/buscar')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/buscar')
  })

  it('no autenticado puede navegar libremente a /login (meta.requiresAuth === false)', async () => {
    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('autenticado navegando a /login redirige a /buscar por default', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'tok'
    auth.listo = true

    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('buscar')
  })

  it('autenticado navegando a /login con query.redirect va a ese destino', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'tok'
    auth.listo = true

    await router.push('/login?redirect=%2Freportes')

    expect(router.currentRoute.value.name).toBe('reportes')
  })

  it('autenticado navegando a una ruta protegida normal, deja pasar sin redirect', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'tok'
    auth.listo = true

    await router.push('/reportes')

    expect(router.currentRoute.value.name).toBe('reportes')
  })

  it('si auth.listo ya es true, NO vuelve a llamar restaurarSesion en la siguiente navegación', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'tok'
    auth.listo = true
    const spy = vi.spyOn(auth, 'restaurarSesion')

    await router.push('/importar')

    expect(spy).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('importar')
  })

  it('si auth.listo es false, el guard llama restaurarSesion antes de decidir', async () => {
    const auth = useAuthStore()
    expect(auth.listo).toBe(false)

    await router.push('/buscar')

    // Sin refresh guardado en Dexie, restaurarSesion resuelve false y deja
    // listo=true — el guard, al no estar autenticado, redirige a login.
    expect(auth.listo).toBe(true)
    expect(authService.refresh).not.toHaveBeenCalled() // no había registro en Dexie
    expect(router.currentRoute.value.name).toBe('login')
  })
})
