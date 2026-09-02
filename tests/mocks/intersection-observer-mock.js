// El stub global de IntersectionObserver en tests/setup.js (observe/
// unobserve/disconnect que no hacen nada) alcanza para que un componente que
// lo usa no reviente al montarse, pero NO sirve para probar el scroll
// infinito de verdad: nunca invoca el callback, así que useInfiniteScroll
// jamás dispararía `onLoadMore()` en un test.
//
// Este helper instala, solo para el test que lo pida, una versión que
// GUARDA el callback de cada instancia y expone `dispararInterseccion(el)`
// para simular "el sentinela entró en el viewport" a mano.

export function instalarIntersectionObserverControlable() {
  const original = globalThis.IntersectionObserver
  const instancias = []

  class IntersectionObserverControlable {
    constructor(callback) {
      this.callback = callback
      this.elementos = new Set()
      instancias.push(this)
    }
    observe(el) {
      this.elementos.add(el)
    }
    unobserve(el) {
      this.elementos.delete(el)
    }
    disconnect() {
      this.elementos.clear()
    }
  }

  globalThis.IntersectionObserver = IntersectionObserverControlable

  return {
    dispararInterseccion(el) {
      const instancia = [...instancias].reverse().find((i) => i.elementos.has(el))
      if (!instancia) {
        throw new Error('[test] ningún IntersectionObserver activo está observando ese elemento todavía')
      }
      instancia.callback([{ isIntersecting: true, target: el }])
    },
    restaurar() {
      globalThis.IntersectionObserver = original
    },
  }
}
