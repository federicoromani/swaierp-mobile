// Journey: Buscar producto -> ver detalle -> contar (y/o editar precio) con
// un solo botón principal que manda solo lo que cambió. El journey de mayor
// uso real de la app (empleado con el celular en el piso de venta). Ver
// docs/testing/plan-agente-3-e2e.md §1 (P0).
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams, leerBodyUrlEncoded, contarRequests } from './support/mockApi.js'
import { PRODUCTOS_URL, REPORTES_URL } from './support/urls.js'
import { productoResultado, productoDetalle } from './support/fixtures.js'
import { loginComo } from './support/login.js'
import { campoContado, campoPrecio, botonPrincipal } from './support/locators.js'

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

function hoyIso() {
  const d = new Date()
  const dd = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())} 10:00:00`
}

test('buscar producto y ver el detalle: sistema, contado vacío y precio en su sección', async ({ page }) => {
  const detalle = productoDetalle({ codigo: 'TOR-034', stock_actual: 25, costo: 100, precio_venta: 155 })
  await buscarYSeleccionar(page, { detalle })

  await expect(page.getByText(/TOR-034/)).toBeVisible()
  await expect(page.getByText('Sistema')).toBeVisible()
  await expect(campoContado(page)).toHaveValue('')
  await expect(campoContado(page)).toHaveAttribute('placeholder', '25')
  await expect(botonPrincipal(page)).toHaveText(/Coincide: 25/)
  await expect(await campoPrecio(page, 'costo')).toHaveValue('100')
  await expect(await campoPrecio(page, 'venta')).toHaveValue('155')
})

test('editar precio: guarda y el margen mostrado se recalcula con el valor que persistió', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ costo: 100, precio_venta: 155 }) })

  await (await campoPrecio(page, 'costo')).fill('100')
  await (await campoPrecio(page, 'venta')).fill('250')

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    expect(body.action).toBe('actualizar_precio')
    expect(body.costo).toBe('100')
    expect(body.precio_venta).toBe('250')
    return { json: productoDetalle({ costo: 100, precio_venta: 250 }) }
  })

  await page.getByRole('button', { name: /guardar precio/i }).click()

  await expect(page.getByText('Precio actualizado.')).toBeVisible()
  // (250-100)/250*100 = 60.0% -- formateado es-AR con coma decimal.
  await expect(page.getByText('60,0%').first()).toBeVisible()
})

test('contar: stepper desde el sistema + tipeo directo, muestra la diferencia y solo registra el conteo', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ stock_actual: 25 }) })

  await page.getByRole('button', { name: 'Sumar uno' }).click()
  await page.getByRole('button', { name: 'Sumar uno' }).click()
  await expect(campoContado(page)).toHaveValue('27')
  await expect(page.getByText(/Sobran 2/)).toBeVisible()

  await campoContado(page).fill('30')
  await expect(page.getByText(/Sobran 5/)).toBeVisible()

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    expect(body.action).toBe('registrar_conteo')
    expect(body.stock_contado).toBe('30')
    return { json: { ...productoDetalle({ stock_actual: 30 }), diferencia: 5 } }
  })

  await page.getByRole('button', { name: /guardar conteo/i }).click()
  await expect(page.getByText('Conteo registrado: +5.')).toBeVisible()
  // Guardado: lo contado se vacía y el sistema pasa a decir 30.
  await expect(campoContado(page)).toHaveValue('')
  await expect(botonPrincipal(page)).toHaveText(/Coincide: 30/)
})

test('coincide: sin tocar nada, registra que el stock coincide y actualiza "Último conteo"', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ stock_actual: 25, ultimo_conteo: null }) })
  await expect(page.getByText('Último conteo: nunca')).toBeVisible()

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    expect(body.action).toBe('registrar_conteo')
    expect(body.stock_contado).toBe('25')
    return { json: { ...productoDetalle({ stock_actual: 25, ultimo_conteo: hoyIso() }), diferencia: 0 } }
  })

  await botonPrincipal(page).click()
  await expect(page.getByText('Conteo registrado: sin diferencias.')).toBeVisible()
  await expect(page.getByText('Último conteo: hoy')).toBeVisible()
})

test('caso negativo: precio de venta <= costo, el backend lo rechaza y no se aplica', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ costo: 100, precio_venta: 155 }) })

  await (await campoPrecio(page, 'venta')).fill('80')

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action) return { status: 400, json: { success: false, error: 'no aplica' } }
    return {
      status: 200,
      json: { success: false, error: 'El precio de venta no puede ser menor o igual al costo.' },
    }
  })

  await page.getByRole('button', { name: /guardar precio/i }).click()
  await expect(page.getByText('El precio de venta no puede ser menor o igual al costo.')).toBeVisible()
  // El valor mostrado de precio de venta NO cambió a lo que hubiera devuelto
  // un éxito -- sigue siendo el 80 que el usuario tipeó, porque actual.value
  // del store no se pisa cuando success es false.
  await expect(await campoPrecio(page, 'venta')).toHaveValue('80')
})

test('caso negativo: API caída al guardar precio -- mensaje claro, el valor tipeado no se pierde', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ costo: 100, precio_venta: 155 }) })

  await (await campoPrecio(page, 'venta')).fill('200')
  await page.route(PRODUCTOS_URL, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    return route.abort('failed')
  })

  const boton = page.getByRole('button', { name: /guardar precio/i })
  await boton.click()

  await expect(page.getByText('No hay conexión con el servidor.')).toBeVisible()
  await expect(boton).toBeEnabled()
  await expect(await campoPrecio(page, 'venta')).toHaveValue('200')
})

test('caso negativo: doble submit en "Guardar precio" -- solo una request real', async ({ page }) => {
  await buscarYSeleccionar(page, { detalle: productoDetalle({ costo: 100, precio_venta: 155 }) })
  await (await campoPrecio(page, 'venta')).fill('200')

  const contador = contarRequests(page, PRODUCTOS_URL, 'POST')
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action) return { status: 400, json: { success: false } }
    return { json: productoDetalle({ costo: 100, precio_venta: 200 }) }
  })

  await page.evaluate(() => {
    const botones = [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Guardar precio'))
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

  await campoContado(page).fill('3')
  await (await campoPrecio(page, 'costo')).fill('200')
  // La venta acompaña al costo con la ganancia actual (55%).
  await expect(await campoPrecio(page, 'venta')).toHaveValue('310')

  await reiniciar.click()

  await expect(campoContado(page)).toHaveValue('')
  await expect(await campoPrecio(page, 'costo')).toHaveValue('100')
  await expect(await campoPrecio(page, 'venta')).toHaveValue('155')
  await expect(reiniciar).toHaveCount(0)
  // Sin cambios, el botón principal vuelve a ser "Coincide".
  await expect(botonPrincipal(page)).toHaveText(/Coincide: 25/)
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

test('indicador de conexión: aparece solo sin red y se va al volver', async ({ page }) => {
  // Sin este mock, el pedido de pendientes de BuscarView sale a la API real,
  // falla y el aviso aparece desde el arranque (comportamiento correcto, pero
  // no lo que se prueba acá).
  await mockApi(page, REPORTES_URL, async () => ({ json: { success: true, items: [], total: 0 } }))
  await page.reload()
  await expect(page.getByPlaceholder(/nombre, código o marca/i)).toBeVisible()

  const aviso = page.getByRole('status').filter({ hasText: 'Sin conexión' })
  await expect(aviso).toHaveCount(0)

  await page.context().setOffline(true)
  await expect(aviso).toBeVisible()

  await page.context().setOffline(false)
  await expect(aviso).toHaveCount(0)
})
