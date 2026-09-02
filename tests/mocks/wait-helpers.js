// Helper compartido para esperar a que una cadena async (fetch real vía
// MSW → promesa del store → reactividad de Vue → a veces una navegación de
// router) termine de asentarse antes de assertar.
//
// Problema real encontrado al implementar (no anticipado en el discovery):
// un solo `await nextTick()` (o incluso `await new Promise(r => setTimeout(r, 0))`)
// no alcanza de forma confiable acá — el interceptor de MSW resuelve en más
// de una vuelta del event loop, y algunas acciones (ej. `router.replace(...)`
// en LoginView) se llaman SIN `await` desde el componente, así que el
// re-render puede quedar un tick atrás incluso después de que la promesa
// principal ya resolvió. Un `setTimeout(0)` fijo funcionaba en algunos tests
// y en otros no (mismo archivo, mismo patrón) — flaky por diseño, no por
// mala suerte puntual.
//
// La solución robusta (recomendada por el propio Vitest para este caso) es
// `vi.waitFor`: reintenta el callback hasta que no tire, con timeout. Se usa
// para la condición FINAL de cada test (a dónde navegó, qué mensaje quedó
// en pantalla, qué valor tomó el store) en vez de una espera a ciegas.

import { vi } from 'vitest'

/**
 * @param {() => void} aserto función que hace un `expect(...)` — se
 *   reintenta hasta que no tire o se cumpla el timeout.
 */
export function esperarQue(aserto, { timeout = 1000, interval = 10 } = {}) {
  return vi.waitFor(aserto, { timeout, interval })
}
