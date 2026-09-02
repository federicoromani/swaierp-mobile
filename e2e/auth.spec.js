// Journey: Login exitoso -> navegación protegida -> sesión persistente ->
// sesión expirada, + casos negativos. Ver docs/testing/plan-agente-3-e2e.md
// §1 (P0).
//
// Spec de negocio: NO necesita un Service Worker real en el medio (y el
// spike de infraestructura confirmó que un SW activo rompe la
// interceptación de las GET mockeadas) -> serviceWorkers:'block'. El SW
// real se prueba a propósito en los specs pwa-*.spec.js.
import { test, expect } from '@playwright/test'
import { mockApi, leerBodyUrlEncoded, contarRequests } from './support/mockApi.js'
import { AUTH_URL, PRODUCTOS_URL } from './support/urls.js'
import { usuarioMock } from './support/fixtures.js'
import { loginComo } from './support/login.js'

test.use({ serviceWorkers: 'block' })

function mockLoginOk(page, { rol = 1 } = {}) {
  return mockApi(page, AUTH_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    if (body.action === 'login') {
      return {
        json: {
          success: true,
          access_token: 'access-token-1',
          refresh_token: 'refresh-token-1',
          usuario: usuarioMock({ rol }),
          config: { margen_objetivo_pct: 30 },
        },
      }
    }
    if (body.action === 'refresh') {
      return { json: { success: true, access_token: 'access-token-2', refresh_token: 'refresh-token-2' } }
    }
    return { status: 400, json: { success: false, error: `acción no mockeada: ${body.action}` } }
  })
}

test('sin sesión, una ruta protegida redirige a login preservando el destino, y tras loguear vuelve ahí', async ({ page }) => {
  await mockLoginOk(page)

  await page.goto('/buscar')
  await expect(page).toHaveURL(/\/login\?redirect=\/buscar$/)

  await page.locator('input[autocomplete="username"]').fill('empleada')
  await page.locator('input[autocomplete="current-password"]').fill('clave-demo')
  await page.getByRole('button', { name: /ingresar/i }).click()

  await expect(page).toHaveURL(/\/buscar$/)
  // El chrome de la app (header + tab bar) solo se muestra autenticado.
  await expect(page.getByText('Conectado')).toBeVisible()
  await expect(page.getByRole('link', { name: /reporte/i })).toBeVisible()
})

test('sesión persistente: recargar la página con la sesión guardada no muestra el login', async ({ page }) => {
  await loginComo(page)
  await expect(page).toHaveURL(/\/buscar$/)

  await page.reload()

  // restaurarSesion() canjea el refresh token guardado en IndexedDB (real,
  // escrito por la app en el login de arriba) sin mostrar el form de login.
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('link', { name: /reporte/i })).toBeVisible()
})

test('sesión expirada: un refresh token inválido en el reload manda a login', async ({ page }) => {
  await loginComo(page)
  await expect(page).toHaveURL(/\/buscar$/)

  // Pisa el mock de auth: ahora `refresh` rechaza (sesión vencida/revocada
  // del lado del servidor). El registro más nuevo tiene prioridad.
  await mockApi(page, AUTH_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    if (body.action === 'refresh') {
      return { json: { success: false, error: 'Sesión expirada.' } }
    }
    return { status: 400, json: { success: false, error: `acción no mockeada: ${body.action}` } }
  })

  await page.reload()

  await expect(page).toHaveURL(/\/login\?redirect=\/buscar$/)
})

test('login con credenciales inválidas: muestra el error y no navega', async ({ page }) => {
  await mockApi(page, AUTH_URL, async () => ({
    status: 200,
    json: { success: false, error: 'Usuario o clave incorrectos.' },
  }))

  await page.goto('/login')
  await page.locator('input[autocomplete="username"]').fill('empleada')
  await page.locator('input[autocomplete="current-password"]').fill('mal')
  await page.getByRole('button', { name: /ingresar/i }).click()

  await expect(page.getByText('Usuario o clave incorrectos.')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('login con la API caída: mensaje de sin conexión, sin colgarse', async ({ page }) => {
  await page.route(AUTH_URL, (route) => route.abort('failed'))

  await page.goto('/login')
  await page.locator('input[autocomplete="username"]').fill('empleada')
  await page.locator('input[autocomplete="current-password"]').fill('clave-demo')
  await page.getByRole('button', { name: /ingresar/i }).click()

  await expect(page.getByText('No hay conexión con el servidor.')).toBeVisible()
  // El botón debe volver a estar habilitado (no queda colgado en "Ingresando...").
  await expect(page.getByRole('button', { name: /ingresar/i })).toBeEnabled()
})

test('recuperación tras error: falla el primer intento, funciona el segundo sin recargar', async ({ page }) => {
  let primerIntento = true
  await page.route(AUTH_URL, async (route, request) => {
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    if (primerIntento) {
      primerIntento = false
      return route.abort('failed')
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        access_token: 'a',
        refresh_token: 'r',
        usuario: usuarioMock(),
        config: { margen_objetivo_pct: 30 },
      }),
    })
  })

  await page.goto('/login')
  await page.locator('input[autocomplete="username"]').fill('empleada')
  await page.locator('input[autocomplete="current-password"]').fill('clave-demo')
  const boton = page.getByRole('button', { name: /ingresar/i })
  await boton.click()
  await expect(page.getByText('No hay conexión con el servidor.')).toBeVisible()

  await boton.click()
  await expect(page).toHaveURL(/\/buscar$/)
})

test('doble submit en login: dos clicks casi simultáneos, ¿cuántas requests salen?', async ({ page }) => {
  await mockLoginOk(page)
  const contador = contarRequests(page, AUTH_URL, 'POST')

  await page.goto('/login')
  await page.locator('input[autocomplete="username"]').fill('empleada')
  await page.locator('input[autocomplete="current-password"]').fill('clave-demo')

  // Dos clicks DENTRO del mismo evaluate (misma tarea síncrona de JS, sin
  // await entre medio): esto es lo que realmente pone a prueba el guard,
  // porque el re-render de Vue que deshabilita el botón (:disabled) se
  // agenda en un microtask y no alcanza a correr entre los dos clicks. Un
  // .click() de Playwright por separado para cada uno no lo logra: para
  // cuando el segundo llega, Vue ya re-renderizó y el botón ya está
  // disabled de verdad.
  await page.evaluate(() => {
    const boton = document.querySelector('button[type="submit"]')
    boton.click()
    boton.click()
  })

  await expect(page).toHaveURL(/\/buscar$/)
  // Ver docs/testing/test-matrix.md §2, hallazgo 7: enviar() en LoginView.vue
  // pone `enviando.value = true` pero nunca chequea el valor anterior antes
  // de seguir -- no hay un guard real de reentrada, solo el :disabled del
  // DOM (que llega tarde para un doble-click sincrónico). Este test
  // confirma el comportamiento REAL: dos requests, no una. No se "arregla"
  // acá -- ver recomendación en el reporte de Ronda 2.
  expect(contador.valor).toBe(2)
})

test('sesión invalidada a mitad de uso: no redirige sola hasta la próxima navegación', async ({ page }) => {
  await loginComo(page)
  await expect(page).toHaveURL(/\/buscar$/)

  // A partir de acá: la próxima GET de productos devuelve 401, y el refresh
  // que intenta apiClient también falla -> limpiarSesionLocal() corre, pero
  // el guard de router no es reactivo al store, solo corre en navegación
  // (confirmado leyendo router/index.js). El usuario se queda parado en
  // /buscar viendo el error, no lo patea solo.
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = new URL(request.url()).searchParams.get('action')
    if (q === 'buscar') {
      return { status: 401, json: { success: false, error: 'No autorizado.' } }
    }
    return { status: 400, json: { success: false, error: 'no mockeado' } }
  })
  await mockApi(page, AUTH_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    if (body.action === 'refresh') {
      return { json: { success: false, error: 'Sesión inválida.' } }
    }
    return { status: 400, json: { success: false, error: 'no mockeado' } }
  })

  await page.locator('input[inputmode="search"]').fill('tornillo')
  await expect(page.getByText('No autorizado.')).toBeVisible()
  await expect(page).toHaveURL(/\/buscar$/) // todavía ahí, sin redirect automático

  await page.getByRole('link', { name: /reporte/i }).click()
  await expect(page).toHaveURL(/\/login\?redirect=\/reportes$/)
})
