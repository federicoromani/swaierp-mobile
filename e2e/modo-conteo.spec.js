// Journey principal de la app: desde Reportes > Pendientes, "Empezar a
// contar" recorre los productos de a uno (modo conteo) hasta terminar.
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams, leerBodyUrlEncoded } from './support/mockApi.js'
import { PRODUCTOS_URL, REPORTES_URL } from './support/urls.js'
import { productoDetalle } from './support/fixtures.js'
import { loginComo } from './support/login.js'
import { campoContado, botonPrincipal } from './support/locators.js'

test.use({ serviceWorkers: 'block' })

const PENDIENTES = [
  { prod_id: 1, nombre: 'Arandela plana 8mm', ultimo_conteo: null, categoria_id: 5, categoria: 'Ferretería > Fijaciones' },
  { prod_id: 2, nombre: 'Tuerca hexagonal M8', ultimo_conteo: null, categoria_id: 5, categoria: 'Ferretería > Fijaciones' },
]

test('pendientes → empezar a contar → coincide / con diferencia → ¡Listo!', async ({ page }) => {
  await loginComo(page)
  const conteos = []
  await mockApi(page, REPORTES_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'categorias_pendientes') {
      return { json: { success: true, items: [{ categoria_id: 5, nombre: 'Ferretería > Fijaciones', pendientes: 2 }] } }
    }
    return { json: { success: true, items: PENDIENTES, total: 2 } }
  })
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    if (request.method() === 'POST') {
      const body = leerBodyUrlEncoded(request)
      conteos.push(body)
      const p = PENDIENTES.find((x) => x.prod_id === Number(body.prod_id))
      return {
        json: {
          ...productoDetalle({ prod_id: p.prod_id, nombre: p.nombre, stock_actual: Number(body.stock_contado) }),
          diferencia: Number(body.stock_contado) - 10,
        },
      }
    }
    const q = leerQueryParams(request)
    const p = PENDIENTES.find((x) => x.prod_id === Number(q.prod_id))
    return { json: productoDetalle({ prod_id: p.prod_id, nombre: p.nombre, stock_actual: 10, ultimo_conteo: null }) }
  })

  await page.getByRole('link', { name: /pendientes/i }).click()
  await expect(page.getByRole('button', { name: 'Fijaciones (2)' })).toBeVisible()
  await page.getByRole('button', { name: /empezar a contar \(2\)/i }).click()

  await expect(page).toHaveURL(/\/contar/)
  await expect(page.getByText('Modo conteo')).toBeVisible()
  // Pantalla enfocada: sin tab bar.
  await expect(page.getByRole('link', { name: /pendientes/i })).toHaveCount(0)

  // 1) Coincide: un toque.
  await expect(page.getByRole('heading', { name: 'Arandela plana 8mm' })).toBeVisible()
  await botonPrincipal(page).click()
  await expect(page.getByRole('heading', { name: 'Tuerca hexagonal M8' })).toBeVisible()
  await expect(page.getByText(/Contados 1 · Quedan 1/)).toBeVisible()

  // 2) Con diferencia.
  await campoContado(page).fill('7')
  await expect(page.getByText(/Faltan 3/)).toBeVisible()
  await page.getByRole('button', { name: /guardar conteo/i }).click()

  await expect(page.getByText('¡Listo!')).toBeVisible()
  await expect(page.getByText('Contaste 2 productos')).toBeVisible()
  expect(conteos).toEqual([
    { action: 'registrar_conteo', prod_id: '1', stock_contado: '10' },
    { action: 'registrar_conteo', prod_id: '2', stock_contado: '7' },
  ])

  await page.getByRole('button', { name: /volver a pendientes/i }).click()
  await expect(page).toHaveURL(/\/reportes/)
  await expect(page.getByText('Sin productos pendientes.')).toBeVisible()
})
