import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createTestingPinia } from '@pinia/testing'
import { useAuthStore } from '../../../src/stores/auth'
import LoginView from '../../../src/views/LoginView.vue'

// Nota de testabilidad (ver plan, item P2 condicional): la validación
// nativa HTML5 (`required`) no se testea acá. VTU dispara el evento submit
// programáticamente (dispatchEvent), lo que NO pasa por la constraint
// validation real del browser (esa solo corre en un submit "de usuario" —
// click en el botón o Enter en un input real). No es confiablemente
// testeable con jsdom+VTU sin simular un click real en el botón submit, y
// aun así jsdom es laxo validando `required`; se deja fuera de unit, es
// candidato a E2E si se justifica.

function crearRouterDeTest() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: { template: '<div/>' } },
      { path: '/buscar', name: 'buscar', component: { template: '<div/>' } },
      { path: '/reportes', name: 'reportes', component: { template: '<div/>' } },
    ],
  })
}

async function montar({ redirect } = {}) {
  const router = crearRouterDeTest()
  await router.push({ path: '/login', query: redirect ? { redirect } : {} })
  await router.isReady()
  const pinia = createTestingPinia({ stubActions: true })
  const wrapper = mount(LoginView, { global: { plugins: [router, pinia] } })
  const auth = useAuthStore()
  return { wrapper, auth, router }
}

async function completarYEnviar(wrapper, usuario = 'fede', clave = 'clave123') {
  await wrapper.find('input[type="text"]').setValue(usuario)
  await wrapper.find('input[type="password"]').setValue(clave)
  await wrapper.find('form').trigger('submit.prevent')
}

describe('views/LoginView', () => {
  it('submit exitoso llama auth.login con los valores tipeados y navega a /buscar por default', async () => {
    const { wrapper, auth, router } = await montar()
    auth.login.mockResolvedValue(undefined)

    await completarYEnviar(wrapper, 'fede', 'clave123')
    await flushPromises()

    expect(auth.login).toHaveBeenCalledWith('fede', 'clave123')
    expect(router.currentRoute.value.name).toBe('buscar')
  })

  it('submit exitoso con query.redirect navega a ese destino en vez del default', async () => {
    const { wrapper, auth, router } = await montar({ redirect: '/reportes' })
    auth.login.mockResolvedValue(undefined)

    await completarYEnviar(wrapper)
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('reportes')
  })

  it('submit fallido muestra el mensaje de la excepción y no navega', async () => {
    const { wrapper, auth, router } = await montar()
    auth.login.mockRejectedValue(new Error('Usuario o clave incorrectos.'))

    await completarYEnviar(wrapper, 'fede', 'mal')
    await flushPromises()

    expect(wrapper.text()).toContain('Usuario o clave incorrectos.')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('submit fallido sin mensaje propio en la excepción usa el default en español', async () => {
    const { wrapper, auth } = await montar()
    auth.login.mockRejectedValue(new Error())

    await completarYEnviar(wrapper, 'fede', 'mal')
    await flushPromises()

    expect(wrapper.text()).toContain('No se pudo iniciar sesión.')
  })

  it('mientras enviando=true, el botón queda disabled y dice "Ingresando..."', async () => {
    const { wrapper, auth } = await montar()
    let resolver
    auth.login.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve
      })
    )

    await completarYEnviar(wrapper)
    await wrapper.vm.$nextTick()

    const boton = wrapper.find('button[type="submit"]')
    expect(boton.attributes('disabled')).toBeDefined()
    expect(boton.text()).toContain('Ingresando...')

    resolver(undefined)
    await flushPromises()
  })
})
