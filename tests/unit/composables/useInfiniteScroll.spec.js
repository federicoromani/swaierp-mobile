import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useInfiniteScroll } from '../../../src/composables/useInfiniteScroll'

// El composable usa onMounted/onUnmounted/watch: no se puede invocar fuera
// de un componente activo (Vue lo ignora con un warning). Se monta un host
// mínimo con Vue Test Utils (ver plan, problema de testabilidad #2).
//
// El stub global de IntersectionObserver en tests/setup.js es un no-op que
// descarta el callback del constructor (problema de testabilidad #1) — acá
// se sobreescribe LOCAL con vi.stubGlobal por una clase que lo captura, para
// poder disparar la intersección a mano.
function crearObservadorFake() {
  const instancias = []
  class IntersectionObserverFake {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.observe = vi.fn()
      this.unobserve = vi.fn()
      this.disconnect = vi.fn()
      instancias.push(this)
    }
  }
  return { IntersectionObserverFake, instancias }
}

function montarHost({ onLoadMore, hasMore, loading, conElemento = true }) {
  const sentinel = ref(conElemento ? document.createElement('div') : null)
  const wrapper = mount(
    defineComponent({
      setup() {
        useInfiniteScroll(sentinel, onLoadMore, { hasMore, loading })
        return {}
      },
      render: () => null,
    })
  )
  return { wrapper, sentinel }
}

describe('composables/useInfiniteScroll', () => {
  let instancias

  beforeEach(() => {
    const fake = crearObservadorFake()
    instancias = fake.instancias
    vi.stubGlobal('IntersectionObserver', fake.IntersectionObserverFake)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('al montar con sentinela presente, crea el observer y lo observa', () => {
    const onLoadMore = vi.fn()
    const { sentinel } = montarHost({ onLoadMore, hasMore: ref(true), loading: ref(false) })

    expect(instancias).toHaveLength(1)
    expect(instancias[0].observe).toHaveBeenCalledWith(sentinel.value)
  })

  it('dispara onLoadMore si intersecta, hasMore=true y loading=false', () => {
    const onLoadMore = vi.fn()
    montarHost({ onLoadMore, hasMore: ref(true), loading: ref(false) })

    instancias[0].callback([{ isIntersecting: true }])

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('NO dispara onLoadMore si hasMore=false', () => {
    const onLoadMore = vi.fn()
    montarHost({ onLoadMore, hasMore: ref(false), loading: ref(false) })

    instancias[0].callback([{ isIntersecting: true }])

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('NO dispara onLoadMore si loading=true (evita cargas duplicadas)', () => {
    const onLoadMore = vi.fn()
    montarHost({ onLoadMore, hasMore: ref(true), loading: ref(true) })

    instancias[0].callback([{ isIntersecting: true }])

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('NO dispara onLoadMore si isIntersecting=false', () => {
    const onLoadMore = vi.fn()
    montarHost({ onLoadMore, hasMore: ref(true), loading: ref(false) })

    instancias[0].callback([{ isIntersecting: false }])

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('al desmontar, desconecta el observer', () => {
    const onLoadMore = vi.fn()
    const { wrapper } = montarHost({ onLoadMore, hasMore: ref(true), loading: ref(false) })

    wrapper.unmount()

    expect(instancias[0].disconnect).toHaveBeenCalled()
  })

  it('si el sentinela pasa de null a un elemento (remount v-if/v-else), reconecta', async () => {
    const onLoadMore = vi.fn()
    const { sentinel } = montarHost({
      onLoadMore,
      hasMore: ref(true),
      loading: ref(false),
      conElemento: false,
    })
    expect(instancias).toHaveLength(0)

    sentinel.value = document.createElement('div')
    await nextTick()

    expect(instancias).toHaveLength(1)
    expect(instancias[0].observe).toHaveBeenCalledWith(sentinel.value)
  })

  it('si el sentinela pasa de elemento a null, desconecta y no crea un observer nuevo', async () => {
    const onLoadMore = vi.fn()
    const { sentinel } = montarHost({ onLoadMore, hasMore: ref(true), loading: ref(false) })
    const primeraInstancia = instancias[0]

    sentinel.value = null
    await nextTick()

    expect(primeraInstancia.disconnect).toHaveBeenCalled()
    expect(instancias).toHaveLength(1)
  })
})
