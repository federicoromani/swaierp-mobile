import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useTirarParaActualizar } from '../../../src/composables/useTirarParaActualizar'

function montar(alActualizar) {
  let api
  const Comp = defineComponent({
    setup() {
      api = useTirarParaActualizar(alActualizar)
      return () => h('div')
    },
  })
  const wrapper = mount(Comp, { attachTo: document.body })
  return { wrapper, api: () => api }
}

function toque(tipo, y) {
  const e = new Event(tipo)
  e.touches = tipo === 'touchend' ? [] : [{ clientY: y }]
  window.dispatchEvent(e)
}

describe('composables/useTirarParaActualizar', () => {
  it('tirar más del umbral y soltar actualiza', async () => {
    const alActualizar = vi.fn().mockResolvedValue()
    const { wrapper, api } = montar(alActualizar)

    toque('touchstart', 100)
    toque('touchmove', 250) // 150px de tirón -> 75 con resistencia (umbral 60)
    expect(api().listo.value).toBe(true)
    toque('touchend')
    await flushPromises()

    expect(alActualizar).toHaveBeenCalledTimes(1)
    expect(api().distancia.value).toBe(0)
    wrapper.unmount()
  })

  it('un tirón corto no actualiza', async () => {
    const alActualizar = vi.fn().mockResolvedValue()
    const { wrapper } = montar(alActualizar)

    toque('touchstart', 100)
    toque('touchmove', 150)
    toque('touchend')
    await flushPromises()

    expect(alActualizar).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('con la página scrolleada no arranca el gesto', async () => {
    const alActualizar = vi.fn().mockResolvedValue()
    const { wrapper } = montar(alActualizar)
    window.scrollY = 300

    toque('touchstart', 100)
    toque('touchmove', 400)
    toque('touchend')
    await flushPromises()

    expect(alActualizar).not.toHaveBeenCalled()
    window.scrollY = 0
    wrapper.unmount()
  })

  it('actualizar() no se superpone mientras ya está actualizando', async () => {
    let resolver
    const alActualizar = vi.fn(() => new Promise((r) => (resolver = r)))
    const { wrapper, api } = montar(alActualizar)

    api().actualizar()
    api().actualizar()
    expect(api().actualizando.value).toBe(true)
    resolver()
    await flushPromises()

    expect(alActualizar).toHaveBeenCalledTimes(1)
    expect(api().actualizando.value).toBe(false)
    wrapper.unmount()
  })
})
