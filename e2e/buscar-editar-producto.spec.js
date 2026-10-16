// Journey: Buscar producto -> ver detalle -> editar precio y/o stock con un
// solo "Guardar cambios" (manda solo lo que cambió). El journey de mayor uso real de la app
// (empleado con el celular en el piso de venta). Ver
// docs/testing/plan-agente-3-e2e.md §1 (P0).
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams, leerBodyUrlEncoded, contarRequests } from './support/mockApi.js'
import { PRODUCTOS_URL } from './support/urls.js'
import { productoResultado, productoDetalle } from './support/fixtures.js'
import { loginComo } from './support/login.js'
import { bloqueCampo } from './support/locators.js'

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }) => {
  await loginComo(page)
})

async function buscarYSeleccionar(page, { resultado = productoResultado(), detalle = productoDetalle() } = {}) {
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'buscar') {
      return { json: { success: true, items: [resultado] } }
    }
    if (q.action === 'detalle') {
      return { json: detalle }
    }
    return { status: 400, json: { success: false, error: `acción no mockeada: ${q.action}` } }
  })

  await page.locator('input[inputmode="search"]').fill(resultado.nombre.slice(0, 6))
  await page.getByRole('button', { name: new RegExp(resultado.nombre, 'i') }).click()
  await expect(page.getByRole('heading', { name: detalle.nombre })).toBeVisible()
  return { resultado, detalle }
}

test('buscar producto y ver el detalle completo', async ({ page }) => {
  const detalle = productoDetalle({ codigo: 'TOR-034', stock_actual: 25, costo: 100, precio_venta: 155 })
  await buscarYSeleccionar(page, { detalle })

  await expect(page.getByText('Código: TOR-034')).toBeVisible()
  await expect(bloqueCampo(page, 'Stock actual').locator('input[type="number"]')).toHaveValue('25')
  await expect(bloqueCampo(page, 'Precio de costo').locator('input[type="number"]')).toHaveValue('100')
  await expect(bloqueCampo(page, 'Precio de venta').locator('input[type="number"]')).toHaveValue('155')
})

test('editar precio: guarda y el margen mostrado se recalcula con el valor que persistió', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ costo: 100, precio_venta: 155 }) })

  const costoInput = bloqueCampo(page, 'Precio de costo').locator('input[type="number"]')
  const ventaInput = bloqueCampo(page, 'Precio de venta').locator('input[type="number"]')
  await costoInput.fill('100')
  await ventaInput.fill('250')

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    expect(body.action).toBe('actualizar_precio')
    expect(body.costo).toBe('100')
    expect(body.precio_venta).toBe('250')
    return { json: productoDetalle({ costo: 100, precio_venta: 250 }) }
  })

  await page.getByRole('button', { name: /guardar cambios/i }).click()

  await expect(page.getByText('Precio actualizado.')).toBeVisible()
  // (250-100)/250*100 = 60.0% -- formateado es-AR con coma decimal.
  await expect(page.getByText('60,0%')).toBeVisible()
})

test('editar stock: stepper + tipeo directo, solo manda ajustar_stock si el precio no cambió', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ stock_actual: 25 }) })

  const bloqueStock = bloqueCampo(page, 'Stock actual')
  const stockInput = bloqueStock.locator('input[type="number"]')
  await expect(stockInput).toHaveValue('25')

  await bloqueStock.getByRole('button', { name: '+' }).click()
  await bloqueStock.getByRole('button', { name: '+' }).click()
  await expect(stockInput).toHaveValue('27')

  await stockInput.fill('30')

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    expect(body.action).toBe('ajustar_stock')
    expect(body.nuevo_stock).toBe('30')
    return { json: { success: true, stock_actual: 30 } }
  })

  await page.getByRole('button', { name: /guardar cambios/i }).click()
  await expect(page.getByText('Stock actualizado.')).toBeVisible()
  await expect(stockInput).toHaveValue('30')
})

test('caso negativo: precio de venta <= costo, el backend lo rechaza y no se aplica', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ costo: 100, precio_venta: 155 }) })

  await bloqueCampo(page, 'Precio de venta').locator('input[type="number"]').fill('80')

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action) return { status: 400, json: { success: false, error: 'no aplica' } }
    return {
      status: 200,
      json: { success: false, error: 'El precio de venta no puede ser menor o igual al costo.' },
    }
  })

  await page.getByRole('button', { name: /guardar cambios/i }).click()
  await expect(page.getByText('El precio de venta no puede ser menor o igual al costo.')).toBeVisible()
  // El valor mostrado de precio de venta NO cambió a lo que hubiera devuelto
  // un éxito -- sigue siendo el 80 que el usuario tipeó, porque actual.value
  // del store no se pisa cuando success es false.
  await expect(bloqueCampo(page, 'Precio de venta').locator('input[type="number"]')).toHaveValue('80')
})

test('caso negativo: API caída al guardar precio -- mensaje claro, el valor tipeado no se pierde', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ costo: 100, precio_venta: 155 }) })

  await bloqueCampo(page, 'Precio de venta').locator('input[type="number"]').fill('200')
  await page.route(PRODUCTOS_URL, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    return route.abort('failed')
  })

  const boton = page.getByRole('button', { name: /guardar cambios/i })
  await boton.click()

  await expect(page.getByText('No hay conexión con el servidor.')).toBeVisible()
  await expect(boton).toBeEnabled()
  await expect(bloqueCampo(page, 'Precio de venta').locator('input[type="number"]')).toHaveValue('200')
})

test('caso negativo: doble submit en "Guardar cambios" -- solo una request real', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ costo: 100, precio_venta: 155 }) })
  await bloqueCampo(page, 'Precio de venta').locator('input[type="number"]').fill('200')

  const contador = contarRequests(page, PRODUCTOS_URL, 'POST')
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action) return { status: 400, json: { success: false } }
    return { json: productoDetalle({ costo: 100, precio_venta: 200 }) }
  })

  await page.evaluate(() => {
    const botones = [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Guardar cambios'))
    botones[0]?.click()
    botones[0]?.click()
  })

  await expect(page.getByText('Precio actualizado.')).toBeVisible()
  // El :disabled del DOM llega un microtask tarde para un doble click
  // sincrónico (hallazgo 7 de test-matrix.md §2); guardar() en
  // ProductoCard.vue lo cubre con un guard `if (guardando.value) return`.
  expect(contador.valor).toBe(1)
})

test('reiniciar: descarta los cambios sin guardar y vuelve a los valores del producto', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ stock_actual: 25, costo: 100, precio_venta: 155 }) })

  const reiniciar = page.getByRole('button', { name: 'Reiniciar valores' })
  await expect(reiniciar).toHaveCount(0)

  await bloqueCampo(page, 'Stock actual').locator('input[type="number"]').fill('3')
  await bloqueCampo(page, 'Precio de costo').locator('input[type="number"]').fill('200')
  // La venta acompaña al costo con la ganancia actual (55%).
  await expect(bloqueCampo(page, 'Precio de venta').locator('input[type="number"]')).toHaveValue('310')

  await reiniciar.click()

  await expect(bloqueCampo(page, 'Stock actual').locator('input[type="number"]')).toHaveValue('25')
  await expect(bloqueCampo(page, 'Precio de costo').locator('input[type="number"]')).toHaveValue('100')
  await expect(bloqueCampo(page, 'Precio de venta').locator('input[type="number"]')).toHaveValue('155')
  await expect(reiniciar).toHaveCount(0)
  await expect(page.getByRole('button', { name: /guardar cambios/i })).toBeDisabled()
})

test('caso negativo: búsqueda sin resultados', async ({ page }) => {
  await mockApi(page, PRODUCTOS_URL, async () => ({ json: { success: true, items: [] } }))
  await page.locator('input[inputmode="search"]').fill('inexistente')
  await expect(page.getByText('Sin resultados. Probá con el código.')).toBeVisible()
})

test('caso negativo: buscador vacío no dispara ninguna request', async ({ page }) => {
  const contador = contarRequests(page, PRODUCTOS_URL, 'GET')
  await page.locator('input[inputmode="search"]').fill('algo')
  await page.locator('input[inputmode="search"]').fill('')
  await page.waitForTimeout(500) // esperar más que el debounce de 300ms para confirmar la AUSENCIA de request
  expect(contador.valor).toBe(0)
})
