import { get, post } from './apiClient'

// Lo devuelve la API (con 404) para un producto que no controla stock
// (prod_valida_stock = false): no se usa desde la app.
export const PRODUCTO_NO_DISPONIBLE = 'producto_no_disponible'

export function buscar(q, limit = 20) {
  return get('/api_productos.php', { action: 'buscar', q, limit })
}

export function detalle(prodId) {
  return get('/api_productos.php', { action: 'detalle', prod_id: prodId })
}

export function actualizarPrecio(prodId, costo, precioVenta) {
  return post('/api_productos.php', {
    action: 'actualizar_precio',
    prod_id: prodId,
    costo,
    precio_venta: precioVenta,
  })
}

// Registra un conteo físico aunque coincida con el sistema (es lo que saca
// al producto de "Pendientes de controlar"); si hay diferencia, el backend
// además ajusta el stock. Devuelve el detalle actualizado + `diferencia`.
export function registrarConteo(prodId, stockContado) {
  return post('/api_productos.php', {
    action: 'registrar_conteo',
    prod_id: prodId,
    stock_contado: stockContado,
  })
}
