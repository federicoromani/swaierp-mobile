import { get, post, postFormData } from './apiClient'

export function proveedores() {
  return get('/api_importacion_precios.php', { action: 'proveedores' })
}

export function analizar(archivo, proveedorId) {
  const formData = new FormData()
  formData.append('action', 'analizar')
  formData.append('archivo', archivo)
  if (proveedorId) {
    formData.append('proveedor_id', proveedorId)
  }
  return postFormData('/api_importacion_precios.php', formData)
}

export function confirmar(proveedorId, lineas) {
  return post('/api_importacion_precios.php', {
    action: 'confirmar',
    proveedor_id: proveedorId || '',
    lineas: JSON.stringify(lineas),
  })
}
