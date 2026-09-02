// Factories de handlers MSW v2 para los 4 endpoints reales del backend.
//
// Diseño: cada endpoint del backend atiende VARIAS acciones bajo el mismo
// path+método (?action=x). Registrar un http.post/http.get por ACCIÓN por
// separado es ambiguo en MSW cuando dos terminan matcheando el mismo
// path+método (el orden de resolución entre handlers "hermanos" no es algo
// que convenga depender para esto) — así que cada factory de acá registra
// UN SOLO handler por path+método, que despacha internamente según la
// acción leída del body/query. Cada acción se pasa como opción con:
//   - un objeto `{status, body}` (atajo para el caso común), o
//   - una función `(request) => Response|Promise<Response>` para casos
//     avanzados (leer headers, contar llamadas, leer FormData, delay...).
// Una acción no incluida en las opciones responde 501 con un mensaje
// explícito — así un test que dispara una acción que no mockeó falla ruidoso
// en vez de colgarse pegándole a la red real.
//
// server.use() se llama SIEMPRE desde el test (o desde un beforeEach del
// describe), nunca desde acá — este archivo no registra nada por sí solo.

import { http, HttpResponse, delay } from 'msw'

const BASE = import.meta.env.VITE_API_BASE_URL

function resolverDe(opcion) {
  if (typeof opcion === 'function') {
    return opcion
  }
  const { status = 200, body = {} } = opcion ?? {}
  return () => HttpResponse.json(body, { status })
}

function accionNoMockeada(accion) {
  return HttpResponse.json(
    { success: false, error: `[test] acción no mockeada en este test: ${accion}` },
    { status: 501 }
  )
}

// Lee `action` tanto de un body urlencoded (login/refresh/logout/actualizar_precio/
// ajustar_stock/confirmar) como de un multipart/form-data (analizar) — clona el
// request porque el body de un Request solo se puede leer una vez.
async function leerAccionDeBody(request) {
  const contentType = request.headers.get('content-type') || ''
  const clon = request.clone()
  if (contentType.includes('multipart/form-data')) {
    const formData = await clon.formData()
    return { accion: formData.get('action'), formData }
  }
  const texto = await clon.text()
  const params = new URLSearchParams(texto)
  return { accion: params.get('action'), params }
}

function leerAccionDeQuery(request) {
  return new URL(request.url).searchParams.get('action')
}

// ---------------------------------------------------------------------------
// /api_auth.php
// ---------------------------------------------------------------------------

/**
 * @param {{login?, refresh?, logout?, config?}} acciones
 * @returns {Array} handlers para pasar a server.use(...)
 */
export function mockAuthEndpoint({ login, refresh, logout, config } = {}) {
  const url = `${BASE}/api_auth.php`
  return [
    http.post(url, async ({ request }) => {
      const { accion } = await leerAccionDeBody(request)
      const mapa = { login, refresh, logout }
      if (!(accion in mapa) || mapa[accion] === undefined) {
        return accionNoMockeada(accion)
      }
      return resolverDe(mapa[accion])({ request })
    }),
    http.get(url, ({ request }) => {
      const accion = leerAccionDeQuery(request)
      if (accion !== 'config' || config === undefined) {
        return accionNoMockeada(accion)
      }
      return resolverDe(config)({ request })
    }),
  ]
}

// ---------------------------------------------------------------------------
// /api_productos.php
// ---------------------------------------------------------------------------

/**
 * @param {{buscar?, detalle?, actualizarPrecio?, ajustarStock?}} acciones
 */
export function mockProductosEndpoint({ buscar, detalle, actualizarPrecio, ajustarStock } = {}) {
  const url = `${BASE}/api_productos.php`
  return [
    http.get(url, ({ request }) => {
      const accion = leerAccionDeQuery(request)
      const mapa = { buscar, detalle }
      if (!(accion in mapa) || mapa[accion] === undefined) {
        return accionNoMockeada(accion)
      }
      return resolverDe(mapa[accion])({ request })
    }),
    http.post(url, async ({ request }) => {
      const { accion } = await leerAccionDeBody(request)
      const mapa = { actualizar_precio: actualizarPrecio, ajustar_stock: ajustarStock }
      if (!(accion in mapa) || mapa[accion] === undefined) {
        return accionNoMockeada(accion)
      }
      return resolverDe(mapa[accion])({ request })
    }),
  ]
}

// ---------------------------------------------------------------------------
// /api_reportes.php
// ---------------------------------------------------------------------------

/**
 * @param {{pendientesControlar?, ajustesFrecuentes?}} acciones
 */
export function mockReportesEndpoint({ pendientesControlar, ajustesFrecuentes } = {}) {
  const url = `${BASE}/api_reportes.php`
  return [
    http.get(url, ({ request }) => {
      const accion = leerAccionDeQuery(request)
      const mapa = { pendientes_controlar: pendientesControlar, ajustes_frecuentes: ajustesFrecuentes }
      if (!(accion in mapa) || mapa[accion] === undefined) {
        return accionNoMockeada(accion)
      }
      return resolverDe(mapa[accion])({ request })
    }),
  ]
}

// ---------------------------------------------------------------------------
// /api_importacion_precios.php
// ---------------------------------------------------------------------------

/**
 * @param {{proveedores?, analizar?, confirmar?}} acciones
 */
export function mockImportacionEndpoint({ proveedores, analizar, confirmar } = {}) {
  const url = `${BASE}/api_importacion_precios.php`
  return [
    http.get(url, ({ request }) => {
      const accion = leerAccionDeQuery(request)
      if (accion !== 'proveedores' || proveedores === undefined) {
        return accionNoMockeada(accion)
      }
      return resolverDe(proveedores)({ request })
    }),
    http.post(url, async ({ request }) => {
      const { accion, formData } = await leerAccionDeBody(request)
      const mapa = { analizar, confirmar }
      if (!(accion in mapa) || mapa[accion] === undefined) {
        return accionNoMockeada(accion)
      }
      // Le paso formData también a los resolvers de 'analizar' (multipart),
      // para que puedan assertar sobre el archivo/proveedor_id recibidos sin
      // tener que re-parsear el request ellos mismos.
      return resolverDe(mapa[accion])({ request, formData })
    }),
  ]
}

// ---------------------------------------------------------------------------
// Helpers genéricos para el archivo de resiliencia (códigos no contemplados,
// network error, delay largo) — no atados a una acción de negocio puntual.
// ---------------------------------------------------------------------------

export function respuestaError(status, error = 'Error simulado por el test.') {
  return { status, body: { success: false, error } }
}

export function respuestaNetworkError() {
  return () => HttpResponse.error()
}

export function respuestaConDelay(ms, { status = 200, body = {} } = {}) {
  return async () => {
    await delay(ms)
    return HttpResponse.json(body, { status })
  }
}

export { http, HttpResponse, delay }
