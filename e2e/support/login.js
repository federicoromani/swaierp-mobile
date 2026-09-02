import { expect } from '@playwright/test'
import { mockApi, leerBodyUrlEncoded } from './mockApi.js'
import { AUTH_URL } from './urls.js'
import { usuarioMock } from './fixtures.js'

/**
 * Loguea un usuario mockeado y deja la página en /buscar (o donde
 * corresponda tras un `redirect`). Cubre `action=login`, `action=refresh` y
 * `action=logout` con un único mock — alcanza para el caso feliz de la
 * mayoría de los specs de negocio. Si un test necesita una respuesta
 * distinta para `refresh` a mitad de camino (ej. "sesión expirada"), volver
 * a llamar `mockApi(page, AUTH_URL, ...)` después de este helper: el
 * registro más nuevo tiene prioridad (ver mockApi.js).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{rol?: number, nombre?: string, margenObjetivoPct?: number, ruta?: string}} opciones
 *   `ruta`: a dónde navegar antes de loguear (default '/login'). Pasar una
 *   ruta protegida (ej. '/reportes') para probar el `?redirect=` real.
 */
export async function loginComo(page, { rol = 1, nombre = 'Empleada Demo', margenObjetivoPct = 30, ruta = '/login' } = {}) {
  await mockApi(page, AUTH_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    if (body.action === 'login') {
      return {
        json: {
          success: true,
          access_token: 'access-e2e-token',
          refresh_token: 'refresh-e2e-token',
          usuario: usuarioMock({ rol, nombre }),
          config: { margen_objetivo_pct: margenObjetivoPct },
        },
      }
    }
    if (body.action === 'refresh') {
      return { json: { success: true, access_token: 'access-e2e-token-2', refresh_token: 'refresh-e2e-token-2' } }
    }
    if (body.action === 'logout') {
      return { json: { success: true } }
    }
    return { status: 400, json: { success: false, error: `acción de auth no mockeada: ${body.action}` } }
  })

  await page.goto(ruta)
  await page.locator('input[autocomplete="username"]').fill('empleada')
  await page.locator('input[autocomplete="current-password"]').fill('clave-demo')
  await page.getByRole('button', { name: /ingresar/i }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 })
}
