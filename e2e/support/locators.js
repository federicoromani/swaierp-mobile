/**
 * Locator robusto para el bloque de un campo de ProductoCard.vue (no hay
 * `<label for=id>`, ver docs/testing/plan-agente-3-e2e.md §0.3): acota por
 * la clase compartida de los 3 bloques (`bg-slate-50`) + el texto del label
 * que contienen. Un locator ingenuo como `page.locator('div', {hasText})`
 * matchea también los ancestros (el texto burbujea hacia arriba), por eso
 * se ancla a la clase CSS específica de cada bloque en vez de al texto solo.
 */
export function bloqueCampo(page, textoLabel) {
  return page.locator('.bg-slate-50', { has: page.locator('label', { hasText: textoLabel }) })
}
