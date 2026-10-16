import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'

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

// fetch() solo rechaza cuando el pedido no llegó al servidor (sin red, DNS,
// CORS, backend caído): eso alimenta el indicador de conexión del header.
// Cualquier respuesta, aunque sea 4xx/5xx, prueba que el servidor responde.
async function fetchConEstado(url, opciones) {
  const ui = useUiStore()
  try {
    const res = await fetch(url, opciones)
    ui.setServidorAlcanzable(true)
    return res
  } catch {
    ui.setServidorAlcanzable(false)
    throw new Error('No hay conexión con el servidor.')
  }
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

  let res = await fetchConEstado(url, { method, headers, body: payload })

  if (res.status === 401 && auth) {
    const nuevoToken = await refrescarUnaVez()
    if (nuevoToken) {
      headers['Authorization'] = `Bearer ${nuevoToken}`
      res = await fetchConEstado(url, { method, headers, body: payload })
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

/**
 * Para subir archivos (multipart/form-data). Deliberadamente NO reusa
 * peticion(): esa arma un body urlencoded a partir de un objeto plano, acá
 * el body YA es un FormData y no hay que tocarlo, ni fijar Content-Type (el
 * browser pone el boundary multipart solo si el header queda ausente).
 * Mismo manejo de 401/refresh que peticion().
 *
 * @param {string} path
 * @param {FormData} formData
 */
export async function postFormData(path, formData) {
  const authStore = useAuthStore()
  const url = BASE_URL + path
  const headers = {}
  if (authStore.accessToken) {
    headers['Authorization'] = `Bearer ${authStore.accessToken}`
  }

  let res = await fetchConEstado(url, { method: 'POST', headers, body: formData })

  if (res.status === 401) {
    const nuevoToken = await refrescarUnaVez()
    if (nuevoToken) {
      headers['Authorization'] = `Bearer ${nuevoToken}`
      res = await fetchConEstado(url, { method: 'POST', headers, body: formData })
    } else {
      await authStore.limpiarSesionLocal()
    }
  }

  return parsearJson(res)
}
