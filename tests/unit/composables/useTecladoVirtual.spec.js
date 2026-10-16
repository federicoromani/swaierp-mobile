import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useTecladoVirtual } from '../../../src/composables/useTecladoVirtual'

// jsdom no tiene visualViewport: el composable cae a innerHeight/innerWidth
// y escucha 'resize' en window, que acá se simula a mano.
function setViewport(alto, ancho = 400) {
  window.innerHeight = alto
  window.innerWidth = ancho
  window.dispatchEvent(new Event('resize'))
}

function montarHost() {
  let abierto
  const wrapper = mount(
    defineComponent({
      setup() {
        abierto = useTecladoVirtual()
        return () =>
          h('div', [
            h('input', { id: 'texto', type: 'number' }),
            h('input', { id: 'check', type: 'checkbox' }),
            h('button', { id: 'boton' }, 'ok'),
          ])
      },
    }),
    { attachTo: document.body }
  )
  return { wrapper, abierto: () => abierto.value }
}

async function enfocar(wrapper, selector) {
  wrapper.find(selector).element.focus()
  await vi.runAllTimersAsync()
}

describe('composables/useTecladoVirtual', () => {
  let altoOriginal
  let anchoOriginal

  beforeEach(() => {
    vi.useFakeTimers()
    altoOriginal = window.innerHeight
    anchoOriginal = window.innerWidth
    window.innerHeight = 800
    window.innerWidth = 400
  })

  afterEach(() => {
    vi.useRealTimers()
    window.innerHeight = altoOriginal
    window.innerWidth = anchoOriginal
    document.body.innerHTML = ''
  })

  it('arranca cerrado', () => {
    const { wrapper, abierto } = montarHost()
    expect(abierto()).toBe(false)
    wrapper.unmount()
  })

  it('foco en un input de texto + viewport achicado más del umbral → abierto', async () => {
    const { wrapper, abierto } = montarHost()
    await enfocar(wrapper, '#texto')
    setViewport(450)

    expect(abierto()).toBe(true)
    wrapper.unmount()
  })

  it('foco sin achicarse el viewport (desktop) → cerrado', async () => {
    const { wrapper, abierto } = montarHost()
    await enfocar(wrapper, '#texto')

    expect(abierto()).toBe(false)
    wrapper.unmount()
  })

  it('achique chico (barra de direcciones) → cerrado', async () => {
    const { wrapper, abierto } = montarHost()
    await enfocar(wrapper, '#texto')
    setViewport(740)

    expect(abierto()).toBe(false)
    wrapper.unmount()
  })

  it('viewport achicado pero sin campo editable enfocado (checkbox/botón) → cerrado', async () => {
    const { wrapper, abierto } = montarHost()
    await enfocar(wrapper, '#check')
    setViewport(450)
    expect(abierto()).toBe(false)

    await enfocar(wrapper, '#boton')
    expect(abierto()).toBe(false)
    wrapper.unmount()
  })

  it('el teclado se cierra (Android "atrás") aunque el input siga enfocado → cerrado', async () => {
    const { wrapper, abierto } = montarHost()
    await enfocar(wrapper, '#texto')
    setViewport(450)
    expect(abierto()).toBe(true)

    setViewport(800)
    expect(abierto()).toBe(false)
    wrapper.unmount()
  })

  it('al sacar el foco del input → cerrado', async () => {
    const { wrapper, abierto } = montarHost()
    await enfocar(wrapper, '#texto')
    setViewport(450)

    wrapper.find('#texto').element.blur()
    await vi.runAllTimersAsync()

    expect(abierto()).toBe(false)
    wrapper.unmount()
  })

  it('rotación (cambia el ancho): toma una altura de referencia nueva y no lo confunde con el teclado', async () => {
    const { wrapper, abierto } = montarHost()
    await enfocar(wrapper, '#texto')
    setViewport(400, 800) // apaisado

    expect(abierto()).toBe(false)
    wrapper.unmount()
  })
})
