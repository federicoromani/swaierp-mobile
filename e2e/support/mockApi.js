// Helper de mocking de red para los specs de negocio.
//
// Por qué existe (ver docs/testing/plan-agente-3-e2e.md §0, confirmado con
// un spike antes de escribir esto):
//   1. VITE_API_BASE_URL (.env.local) apunta a http://localhost:8880, un
//      origen DISTINTO del preview (http://localhost:4173) que sirve el
//      build bajo test. page.route().fulfill() intercepta la request antes
//      de salir a la red, pero el navegador igual evalúa CORS sobre la
//      respuesta que le damos — hace falta Access-Control-Allow-Origin en
//      TODAS las respuestas mockeadas, y responder también a OPTIONS
//      (preflight, que dispara cualquier request con header Authorization).
//   2. Confirmado con un spike descartable: con el Service Worker real
//      activo y controlando la página, `page.route()` NO intercepta las GET
//      a /apps/api_* (pasan por el fetch interno de la estrategia
//      NetworkFirst de Workbox, en el contexto del propio SW). Un segundo
//      spike confirmó que `context.route()` SÍ las intercepta (el registro
//      a nivel de browser context alcanza también a los fetch que hace el
//      propio Service Worker) — por eso este helper registra sobre
//      `page.context()`, no sobre `page` directamente, y funciona igual con
//      el SW activo o bloqueado. Los specs de negocio igual usan
//      `test.use({ serviceWorkers: 'block' })` por aislamiento/velocidad
//      (no necesitan un SW real en el medio para lo que prueban), pero ya
//      no es un requisito de corrección para que el mock funcione, solo una
//      elección de diseño — ver docs/testing/plan-agente-3-e2e.md §0.2 y el
//      reporte de Ronda 2 para el detalle de ambos spikes.

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

/**
 * Registra un mock para `urlGlob` que maneja el preflight OPTIONS solo, y
 * delega el resto (GET/POST) a `handler`.
 *
 * `handler(route, request)` puede:
 *   - devolver `{ status?, json }` → se serializa como respuesta JSON con
 *     los headers CORS puestos automáticamente (el caso común).
 *   - devolver `undefined` después de haber llamado `route.fulfill(...)` o
 *     `route.abort(...)` por su cuenta (para simular red caída con
 *     `route.abort('failed')`, que no tiene sentido envolver en JSON).
 *
 * Nota sobre pisar mocks: si se llama `mockApi` dos veces con el mismo
 * `urlGlob` en el mismo test, Playwright le da prioridad al registro más
 * reciente (LIFO) — es el mecanismo que se usa para, por ejemplo, cambiar
 * la respuesta de `refresh` a mitad de un test sin tener que re-declarar el
 * resto de las acciones de ese endpoint.
 */
export async function mockApi(page, urlGlob, handler) {
  await page.context().route(urlGlob, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }
    const resultado = await handler(route, request)
    if (resultado === undefined) {
      return
    }
    const { status = 200, json } = resultado
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: CORS_HEADERS,
      body: JSON.stringify(json),
    })
  })
}

/** Lee el body `application/x-www-form-urlencoded` de un POST como objeto. */
export function leerBodyUrlEncoded(request) {
  return Object.fromEntries(new URLSearchParams(request.postData() || ''))
}

/** Lee los query params de la URL de la request como objeto. */
export function leerQueryParams(request) {
  return Object.fromEntries(new URL(request.url()).searchParams)
}

/** Cuenta cuántas veces matchea `urlGlob` con el método dado, sin mockear nada más — para tests de doble-submit. */
export function contarRequests(page, urlGlob, method) {
  const contador = { valor: 0 }
  page.on('request', (req) => {
    if (req.method() === method && matchGlob(req.url(), urlGlob)) {
      contador.valor++
    }
  })
  return contador
}

function matchGlob(url, glob) {
  // Ojo: no encadenar dos .replace() globales donde el primero puede
  // insertar el carácter que el segundo vuelve a buscar (ej. reemplazar
  // "**" por ".*" y DESPUÉS reemplazar "*" sueltos also matchea el "*" que
  // acabamos de insertar nosotros mismos, corrompiendo el resultado). Se
  // separa el string primero (conservando los delimitadores) y recién ahí
  // se decide qué hacer con cada parte, en un solo pase.
  const patron = glob
    .split(/(\*\*|\*)/)
    .map((parte) => {
      if (parte === '**') return '.*'
      if (parte === '*') return '[^/]*'
      return parte.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp('^' + patron + '$').test(url)
}
