// Journey: Reportes -- "Pendientes de controlar" (carga inicial) y "Ajustes
// frecuentes" (carga al cambiar de tab), ambos con scroll infinito real
// (IntersectionObserver del browser -- tests/setup.js lo stubbea como no-op
// para unit/integration, así que esto SOLO se puede probar acá). Ver
// docs/testing/plan-agente-3-e2e.md §1 (P1).
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams } from './support/mockApi.js'
import { REPORTES_URL } from './support/urls.js'
import { pendienteItem, ajusteItem } from './support/fixtures.js'
import { loginComo } from './support/login.js'

test.use({ serviceWorkers: 'block' })

function items(factory, desde, hasta) {
  return Array.from({ length: hasta - desde }, (_, i) => factory({ prod_id: 1000 + desde + i, nombre: `Producto pendiente #${desde + i + 1}` }))
}

test('scroll infinito en "Pendientes de controlar": pagina sola, no duplica, no hace loop al final', async ({ page }) => {
  const TOTAL = 45
  const llamadas = []

  await loginComo(page)
  await mockApi(page, REPORTES_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action !== 'pendientes_controlar') return { status: 400, json: { success: false } }
    const offset = Number(q.offset)
    llamadas.push(offset)
    const hasta = Math.min(offset + 20, TOTAL)
    return { json: { success: true, items: items(pendienteItem, offset, hasta), total: TOTAL } }
  })

  await page.goto('/reportes')

  const filas = page.locator('button', { hasText: 'Producto pendiente #' })
  await expect(filas).toHaveCount(20)
  expect(llamadas).toEqual([0])

  // Scrollear el sentinela a la vista dispara el IntersectionObserver REAL.
  await page.locator('.py-2.text-center.text-xs.text-muted').last().scrollIntoViewIfNeeded()
  await expect(filas).toHaveCount(40, { timeout: 5000 })
  expect(llamadas).toEqual([0, 20])

  await page.locator('.py-2.text-center.text-xs.text-muted').last().scrollIntoViewIfNeeded()
  await expect(filas).toHaveCount(45, { timeout: 5000 })
  expect(llamadas).toEqual([0, 20, 40])

  // Ya no hay sentinela (hasMorePendientes pasa a false) -- scrollear de
  // nuevo no debe generar ninguna llamada extra.
  await page.mouse.wheel(0, 2000)
  await page.waitForTimeout(500)
  expect(llamadas).toEqual([0, 20, 40])
  await expect(filas).toHaveCount(45)
})

test('tab "Ajustes frecuentes": carga perezosa al cambiar de tab, con su propio scroll infinito', async ({ page }) => {
  const TOTAL = 25
  const llamadasPendientes = []
  const llamadasAjustes = []

  await loginComo(page)
  await mockApi(page, REPORTES_URL, async (route, request) => {
    const q = leerQueryParams(request)
    const offset = Number(q.offset)
    if (q.action === 'pendientes_controlar') {
      llamadasPendientes.push(offset)
      return { json: { success: true, items: items(pendienteItem, offset, Math.min(offset + 20, 5)), total: 5 } }
    }
    if (q.action === 'ajustes_frecuentes') {
      llamadasAjustes.push(offset)
      const hasta = Math.min(offset + 20, TOTAL)
      return { json: { success: true, items: items(ajusteItem, offset, hasta), total: TOTAL } }
    }
    return { status: 400, json: { success: false } }
  })

  await page.goto('/reportes')
  await expect(page.getByText('Sin productos pendientes.')).toHaveCount(0)
  // La tab "Ajustes" no dispara nada hasta que se la toca.
  expect(llamadasAjustes).toEqual([])

  await page.getByRole('button', { name: /ajustes frecuentes/i }).click()
  await expect(page.getByText(/productos con ajustes manuales/i)).toBeVisible()
  expect(llamadasAjustes).toEqual([0])

  const filasAjustes = page.locator('button', { hasText: 'Producto pendiente #' })
  await expect(filasAjustes).toHaveCount(20)

  await page.locator('.py-2.text-center.text-xs.text-muted').last().scrollIntoViewIfNeeded()
  await expect(filasAjustes).toHaveCount(25, { timeout: 5000 })
  expect(llamadasAjustes).toEqual([0, 20])
})

test('estado vacío: sin pendientes, sin sentinela, no intenta cargar de más', async ({ page }) => {
  await loginComo(page)
  const llamadas = []
  await mockApi(page, REPORTES_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'pendientes_controlar') {
      llamadas.push(Number(q.offset))
      return { json: { success: true, items: [], total: 0 } }
    }
    return { json: { success: true, items: [], total: 0 } }
  })

  await page.goto('/reportes')
  await expect(page.getByText('Sin productos pendientes.')).toBeVisible()

  await page.mouse.wheel(0, 2000)
  await page.waitForTimeout(500)
  expect(llamadas).toEqual([0])
})

test('HALLAZGO: API caída al abrir Reportes -- rejection sin manejar Y mensaje ENGAÑOSO ("Sin productos pendientes")', async ({ page }) => {
  // Documenta un comportamiento real confirmado leyendo el código
  // (src/stores/reportes.js): cargarPendientes/cargarAjustes NO tienen
  // catch, solo try/finally. Si el fetch tira, la excepción sale de una
  // función async llamada sin .catch() desde onMounted -> unhandled promise
  // rejection (a diferencia de productos.js, que sí tiene fallback + error
  // visible).
  //
  // Al implementar el test apareció algo más específico y peor de lo que
  // se había anticipado en el discovery de Ronda 1 (ver
  // docs/testing/test-matrix.md §2, hallazgo 3, que hablaba de "sin ningún
  // indicio de error" en general): `pendientes` arranca como
  // `{items:[], total:0}` y el fetch fallido nunca lo actualiza, así que
  // `!reportes.pendientes.items.length` sigue siendo true -> la UI muestra
  // literalmente "Sin productos pendientes.", el mismo mensaje que un
  // comercio al día con sus conteos. Un empleado con la conexión cortada ve
  // exactamente el mismo texto que alguien que no tiene nada pendiente de
  // verdad -- es peor que "sin feedback", es un mensaje ENGAÑOSO.
  await loginComo(page)

  const rejectionsNoManejadas = []
  page.on('pageerror', (e) => rejectionsNoManejadas.push(String(e)))
  const consoleErrores = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrores.push(msg.text())
  })

  await page.route(REPORTES_URL, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    return route.abort('failed')
  })

  await page.goto('/reportes')
  await page.waitForTimeout(1000) // darle tiempo a que la promesa rechazada se resuelva y se reporte

  // Sin ningún banner de error en pantalla (no existe ese elemento en
  // ReportesView.vue para errores de red, a diferencia de BuscarView).
  await expect(page.locator('.saas-alert-danger, .text-danger').filter({ hasText: /conexión|error/i })).toHaveCount(0)
  // Y el mensaje que SÍ aparece es el de "todo al día", no el de error.
  await expect(page.getByText('Sin productos pendientes.')).toBeVisible()

  console.log('HALLAZGO reportes: pageerror capturados =', JSON.stringify(rejectionsNoManejadas))
  console.log('HALLAZGO reportes: console.error capturados =', JSON.stringify(consoleErrores))
})
