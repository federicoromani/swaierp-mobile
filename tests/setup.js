// Setup global de Vitest (unit + integration). Ver vitest.config.js.

// Dexie (src/offline/db.js) necesita IndexedDB real o polyfilleado — jsdom
// no lo implementa. fake-indexeddb/auto lo registra como global antes de
// que cualquier módulo de la app lo use.
import 'fake-indexeddb/auto'

// jsdom no implementa IntersectionObserver (usado por
// src/composables/useInfiniteScroll.js, y por lo tanto por ReportesView).
// Stub mínimo: sin esto, cualquier test que monte un componente que lo use
// revienta con "IntersectionObserver is not defined", incluso en tests que
// no le importa el scroll infinito en absoluto.
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Server MSW compartido: arranca una vez acá, cada test de integración le
// agrega sus propios handlers con server.use(...) y Vitest los resetea solo
// (resetHandlers en afterEach) para que un handler de un test no se filtre
// al siguiente. Los tests unitarios que no hacen fetch nunca lo tocan.
import { setupServer } from 'msw/node'

export const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
