import { get } from './apiClient'

export function pendientesControlar(dias = 7, limit = 20, offset = 0) {
  return get('/api_reportes.php', { action: 'pendientes_controlar', dias, limit, offset })
}

export function ajustesFrecuentes(dias = 30, limit = 20, offset = 0) {
  return get('/api_reportes.php', { action: 'ajustes_frecuentes', dias, limit, offset })
}
