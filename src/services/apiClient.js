import { useAuthStore } from '../stores/auth'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

if (!BASE_URL) {
  // Falla explícita en vez de pegarle a una URL relativa rara: sin esto, un
  // build sin .env quedaría "andando" contra un origen equivocado sin avisar.
  throw new Error(
    'VITE_API_BASE_URL no está configurada. Copiá .env.example a .env.local (dev) o .env.production (build) y completala.'
  )
}

// Cola single-flight: si varias peticiones reciben 401 al mismo tiempo, solo
// una dispara el refresh y las demás esperan esa misma promesa.
let refrescoEnCurso = null

function refrescarUnaVez() {
  const auth = useAuthStore()
  if (!refrescoEnCurso) {
    refrescoEnCurso = auth
      .refrescarToken()
      .catch(() => null)
      .finally(() => {
        refrescoEnCurso = null
      })
  }
  return refrescoEnCurso
}

async function parsearJson(res) {
  try {
    return await res.json()
  } catch {
    return { success: false, error: 'Respuesta inválida del servidor.' }
  }
}

/**
 * @param {string} path Ej. '/api_productos.php'
 * @param {{method?: string, params?: Record<string,any>, body?: Record<string,any>, auth?: boolean}} opciones
 */
async function peticion(path, { method = 'GET', params, body, auth = true } = {}) {
  const authStore = useAuthStore()

  let url = BASE_URL + path
  if (params) {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))
    ).toString()
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query
    }
  }

  const headers = {}
  let payload
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(
      Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null))
    )
  }

  function conAuthHeader() {
    if (auth && authStore.accessToken) {
      headers['Authorization'] = `Bearer ${authStore.accessToken}`
    }
  }
  conAuthHeader()

  let res
  try {
    res = await fetch(url, { method, headers, body: payload })
  } catch {
    throw new Error('No hay conexión con el servidor.')
  }

  if (res.status === 401 && auth) {
    const nuevoToken = await refrescarUnaVez()
    if (nuevoToken) {
      headers['Authorization'] = `Bearer ${nuevoToken}`
      res = await fetch(url, { method, headers, body: payload })
    } else {
      await authStore.limpiarSesionLocal()
    }
  }

  return parsearJson(res)
}

export function get(path, params) {
  return peticion(path, { method: 'GET', params })
}

export function post(path, body, opciones = {}) {
  return peticion(path, { method: 'POST', body, ...opciones })
}
