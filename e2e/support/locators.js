// Locators de ProductoCard.vue por nombre accesible (aria-label / <label
// for>), no por clases ni posición: así un cambio de layout de la card no
// rompe todos los specs a la vez.

/** Campo "Contado" del bloque de conteo. */
export function campoContado(page) {
  return page.getByLabel('Stock contado')
}

/** La sección "Precio y margen" es colapsable: la abre si hace falta. */
export async function abrirPrecio(page) {
  const boton = page.getByRole('button', { name: /precio y margen/i })
  if ((await boton.getAttribute('aria-expanded')) !== 'true') {
    await boton.click()
  }
}

/** @param {'costo'|'venta'} cual */
export async function campoPrecio(page, cual) {
  await abrirPrecio(page)
  return page.getByLabel(cual === 'costo' ? 'Precio de costo' : 'Precio de venta', { exact: true })
}

/** Sección completa de precio y margen (para capturas visuales). */
export function seccionPrecio(page) {
  return page.getByRole('region', { name: 'Precio y margen' })
}

/** Botón principal de la card: "Coincide: N u" / "Guardar conteo|precio|conteo y precio". */
export function botonPrincipal(page) {
  return page.getByRole('button', { name: /^(coincide|guardar)/i })
}
