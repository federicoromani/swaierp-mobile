// Selectores de ProductoCard compartidos por los specs unit/integration. Van
// por aria-label (no por posición de los inputs) para que reordenar la card
// no rompa todos los tests a la vez.

export function botonPorTexto(wrapper, texto) {
  return wrapper.findAll('button').find((b) => b.text().includes(texto))
}

export function inputContado(wrapper) {
  return wrapper.find('input[aria-label="Stock contado"]')
}

/** El precio está en una sección colapsable: la abre si hace falta. */
export async function abrirPrecio(wrapper) {
  const boton = botonPorTexto(wrapper, 'Precio y margen')
  if (boton && boton.attributes('aria-expanded') !== 'true') {
    await boton.trigger('click')
  }
}

export async function inputCosto(wrapper) {
  await abrirPrecio(wrapper)
  return wrapper.find('input[aria-label="Precio de costo"]')
}

export async function inputVenta(wrapper) {
  await abrirPrecio(wrapper)
  return wrapper.find('input[aria-label="Precio de venta"]')
}

/** El botón principal: "Coincide: N u", "Guardar conteo/precio", "Guardando...". */
export function botonPrincipal(wrapper) {
  return wrapper.findAll('button').find((b) => /Coincide|Guardar|Guardando/.test(b.text()))
}
