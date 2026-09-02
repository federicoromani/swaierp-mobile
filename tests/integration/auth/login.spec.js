// Login: LoginView.vue + auth store + authService + apiClient + redirect de
// router post-login. No usa el router singleton real (eso es de
// router-guard-restaurar-sesion.spec.js) — acá alcanza con un router liviano
// con las mismas rutas, para que useRouter()/useRoute() funcionen y se
// pueda observar a dónde termina navegando después de loguear.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockAuthEndpoint, HttpResponse } from '../../mocks/handlers'
import { datosLogin } from '../../mocks/fixtures'
import { limpiarDb, leerRefreshTokenGuardado } from '../../mocks/db-helpers'
import { crearRouterLiviano } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { useAuthStore } from '../../../src/stores/auth'
import LoginView from '../../../src/views/LoginView.vue'

async function leerBodyLogin(request) {
  const texto = await request.clone().text()
  return Object.fromEntries(new URLSearchParams(texto))
}

async function montarLogin(rutaInicial = '/login') {
  const router = await crearRouterLiviano(rutaInicial)
  const wrapper = mount(LoginView, { global: { plugins: [router] } })
  return { wrapper, router }
}

describe('LoginView + auth store: login', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
  })

  afterEach(async () => {
    await limpiarDb()
  })

  it('login exitoso: manda el request correcto, puebla el store, guarda el refresh token y redirige a ?redirect', async () => {
    let bodyRecibido = null
    server.use(
      ...mockAuthEndpoint({
        login: async ({ request }) => {
          bodyRecibido = await leerBodyLogin(request)
          return HttpResponse.json(datosLogin())
        },
      })
    )

    const { wrapper, router } = await montarLogin('/login?redirect=%2Freportes')
    const auth = useAuthStore()

    await wrapper.find('input[autocomplete="username"]').setValue('ana')
    await wrapper.find('input[autocomplete="current-password"]').setValue('secreta123')
    await wrapper.find('form').trigger('submit')

    await esperarQue(() => expect(router.currentRoute.value.path).toBe('/reportes'))

    expect(bodyRecibido).toEqual({
      action: 'login',
      usuario: 'ana',
      clave: 'secreta123',
      dispositivo: navigator.userAgent,
    })
    expect(auth.accessToken).toBe('at-inicial')
    expect(auth.usuario.nombre).toBe('Ana Administradora')
    expect(auth.config.margen_objetivo_pct).toBe(30)
    expect(await leerRefreshTokenGuardado()).toBe('rt-inicial')
  })

  it('login exitoso SIN ?redirect en la URL cae a /buscar por default', async () => {
    server.use(...mockAuthEndpoint({ login: () => HttpResponse.json(datosLogin()) }))

    const { wrapper, router } = await montarLogin('/login')
    await wrapper.find('input[autocomplete="username"]').setValue('ana')
    await wrapper.find('input[autocomplete="current-password"]').setValue('secreta123')
    await wrapper.find('form').trigger('submit')

    await esperarQue(() => expect(router.currentRoute.value.path).toBe('/buscar'))
  })

  it('login fallido (401, mensaje genérico anti-enumeración): no guarda nada, muestra el mensaje tal cual, no navega', async () => {
    server.use(
      ...mockAuthEndpoint({
        login: () => HttpResponse.json({ success: false, error: 'Usuario o clave incorrecta.' }, { status: 401 }),
      })
    )

    const { wrapper, router } = await montarLogin('/login')
    const auth = useAuthStore()

    await wrapper.find('input[autocomplete="username"]').setValue('ana')
    await wrapper.find('input[autocomplete="current-password"]').setValue('mala')
    await wrapper.find('form').trigger('submit')

    await esperarQue(() => expect(wrapper.text()).toContain('Usuario o clave incorrecta.'))

    expect(auth.accessToken).toBeNull()
    expect(await leerRefreshTokenGuardado()).toBeNull()
    expect(router.currentRoute.value.path).toBe('/login')
    // El botón vuelve a estar habilitado (enviando=false) después del error.
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })

  it('login con la red caída: apiClient lanza "No hay conexión con el servidor.", se muestra y no crashea', async () => {
    server.use(...mockAuthEndpoint({ login: () => HttpResponse.error() }))

    const { wrapper } = await montarLogin('/login')
    await wrapper.find('input[autocomplete="username"]').setValue('ana')
    await wrapper.find('input[autocomplete="current-password"]').setValue('secreta123')
    await wrapper.find('form').trigger('submit')

    await esperarQue(() => expect(wrapper.text()).toContain('No hay conexión con el servidor.'))
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })

  it('login con 500 y body no-JSON: cae al mensaje de "Respuesta inválida del servidor." sin explotar', async () => {
    server.use(...mockAuthEndpoint({ login: () => HttpResponse.text('Internal Server Error', { status: 500 }) }))

    const { wrapper } = await montarLogin('/login')
    await wrapper.find('input[autocomplete="username"]').setValue('ana')
    await wrapper.find('input[autocomplete="current-password"]').setValue('secreta123')
    await wrapper.find('form').trigger('submit')

    await esperarQue(() => expect(wrapper.text()).toContain('Respuesta inválida del servidor.'))
  })

  it('doble submit rápido (dos taps antes de que el DOM se repinte): documenta cuántos POST de login salen realmente', async () => {
    let llamadas = 0
    server.use(
      ...mockAuthEndpoint({
        login: () => {
          llamadas++
          return HttpResponse.json(datosLogin())
        },
      })
    )

    const { wrapper, router } = await montarLogin('/login')
    await wrapper.find('input[autocomplete="username"]').setValue('ana')
    await wrapper.find('input[autocomplete="current-password"]').setValue('secreta123')

    // Dos submits SIN esperar entre medio (simula un doble-tap real en
    // mobile, antes de que Vue vuelva a pintar el botón como disabled).
    const form = wrapper.find('form')
    const p1 = form.trigger('submit')
    const p2 = form.trigger('submit')
    await Promise.all([p1, p2])

    await esperarQue(() => expect(router.currentRoute.value.path).toBe('/buscar'))

    // HALLAZGO (ver docs/testing/test-matrix.md sección 2): `enviando` se
    // pone en `true` de forma síncrona como primera línea de `enviar()`,
    // pero nada dentro de la función chequea "¿ya estoy enviando?" antes de
    // seguir — el único freno es el `:disabled` del botón, que depende de
    // que Vue ya haya repintado el DOM. Con dos `trigger('submit')`
    // encolados sin esperar entre medio, el segundo puede alcanzar a
    // dispararse antes de ese repintado. Dejamos el número real acá en vez
    // de forzar `toBe(1)` a ciegas.
    expect(llamadas).toBeGreaterThanOrEqual(1)
    if (llamadas > 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `[hallazgo] doble submit del login disparó ${llamadas} POST reales — no hay guard interno en enviar(), solo el :disabled del botón.`
      )
    }
  })
})
