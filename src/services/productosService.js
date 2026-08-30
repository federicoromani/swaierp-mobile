import { get, post } from './apiClient'

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

export function ajustarStock(prodId, nuevoStock, comentario = '') {
  return post('/api_productos.php', {
    action: 'ajustar_stock',
    prod_id: prodId,
    nuevo_stock: nuevoStock,
    comentario,
  })
}
