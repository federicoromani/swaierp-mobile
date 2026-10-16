import { get } from './apiClient'

// categoriaId null/undefined = todas (apiClient no manda params nulos).
export function pendientesControlar(dias = 7, limit = 20, offset = 0, categoriaId = null) {
  return get('/api_reportes.php', { action: 'pendientes_controlar', dias, limit, offset, categoria_id: categoriaId })
}

export function categoriasPendientes(dias = 7) {
  return get('/api_reportes.php', { action: 'categorias_pendientes', dias })
}

export function ajustesFrecuentes(dias = 30, limit = 20, offset = 0) {
  return get('/api_reportes.php', { action: 'ajustes_frecuentes', dias, limit, offset })
}
