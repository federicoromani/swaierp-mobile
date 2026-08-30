import { post, get } from './apiClient'

export function login(usuario, clave, dispositivo) {
  return post('/api_auth.php', { action: 'login', usuario, clave, dispositivo }, { auth: false })
}

export function refresh(refreshToken) {
  return post('/api_auth.php', { action: 'refresh', refresh_token: refreshToken }, { auth: false })
}

export function logout(refreshToken) {
  return post('/api_auth.php', { action: 'logout', refresh_token: refreshToken }, { auth: false })
}

export function config() {
  return get('/api_auth.php', { action: 'config' })
}
