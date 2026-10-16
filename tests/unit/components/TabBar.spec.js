import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createTestingPinia } from '@pinia/testing'
import TabBar from '../../../src/components/TabBar.vue'

// TabBar usa <router-link> y useRoute(): hace falta un router real instalado
// (memory history alcanza, no se necesita la app completa) para que
// RouterLink resuelva el href y para que `route.path` refleje la ruta
// actual.
function crearRouterDeTest() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/buscar', name: 'buscar', component: { template: '<div/>' } },
      { path: '/importar', name: 'importar', component: { template: '<div/>' } },
      { path: '/reportes', name: 'reportes', component: { template: '<div/>' } },
    ],
  })
}

async function montar({ rol, rutaInicial = '/buscar' } = {}) {
  const router = crearRouterDeTest()
  await router.push(rutaInicial)
  await router.isReady()
  const pinia = createTestingPinia({
    initialState: { auth: { usuario: rol === undefined ? null : { rol } } },
  })
  return mount(TabBar, { global: { plugins: [router, pinia] } })
}

describe('components/TabBar', () => {
  it('oculta el link a /importar para usuario con rol FISCAL (3)', async () => {
    const wrapper = await montar({ rol: 3 })
    expect(wrapper.find('a[href="/importar"]').exists()).toBe(false)
  })

  it('muestra el link a /importar para rol ADMINISTRADOR (1)', async () => {
    const wrapper = await montar({ rol: 1 })
    expect(wrapper.find('a[href="/importar"]').exists()).toBe(true)
  })

  it('muestra el link a /importar para rol AVANZADO (2)', async () => {
    const wrapper = await montar({ rol: 2 })
    expect(wrapper.find('a[href="/importar"]').exists()).toBe(true)
  })

  describe('con VITE_IMPORTAR_HABILITADO apagado', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('oculta el link a /importar aunque el rol lo permita', async () => {
      vi.stubEnv('VITE_IMPORTAR_HABILITADO', 'false')
      const wrapper = await montar({ rol: 1 })
      expect(wrapper.find('a[href="/importar"]').exists()).toBe(false)
    })

    it('sin la variable definida, también queda oculto (apagado por defecto)', async () => {
      vi.stubEnv('VITE_IMPORTAR_HABILITADO', undefined)
      const wrapper = await montar({ rol: 1 })
      expect(wrapper.find('a[href="/importar"]').exists()).toBe(false)
      expect(wrapper.find('a[href="/buscar"]').exists()).toBe(true)
      expect(wrapper.find('a[href="/reportes"]').exists()).toBe(true)
    })
  })

  it('muestra el link si no hay usuario todavía (optional chaining sobre null)', async () => {
    const wrapper = await montar({ rol: undefined })
    expect(wrapper.find('a[href="/importar"]').exists()).toBe(true)
  })

  it('aplica la clase activa (text-accent) al link que coincide con la ruta actual', async () => {
    const wrapper = await montar({ rol: 1, rutaInicial: '/reportes' })

    expect(wrapper.find('a[href="/reportes"]').classes()).toContain('text-accent')
    expect(wrapper.find('a[href="/buscar"]').classes()).toContain('text-muted')
  })

  it('siempre renderiza los links a /buscar y /reportes, sin condición de rol', async () => {
    const wrapper = await montar({ rol: 3 })

    expect(wrapper.find('a[href="/buscar"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/reportes"]').exists()).toBe(true)
  })
})
