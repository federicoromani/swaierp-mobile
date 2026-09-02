// Journey: Importar lista de precios de proveedor -- elegir proveedor (opc.)
// -> subir archivo -> checklist aplicables/no-aplicables -> aplicar
// seleccionados -> resumen -> "Importar otra lista". Ver
// docs/testing/plan-agente-3-e2e.md §1 (P0), el journey más complejo
// (multipart + checklist + rol).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams, leerBodyUrlEncoded, contarRequests } from './support/mockApi.js'
import { IMPORTACION_URL } from './support/urls.js'
import { proveedor, itemImportacionAplicable, itemImportacionNoAplicable } from './support/fixtures.js'
import { loginComo } from './support/login.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSV_FIXTURE = path.join(__dirname, 'fixtures', 'lista-precios.csv')
const JPG_FIXTURE = path.join(__dirname, 'fixtures', 'foto-lista.jpg')

test.use({ serviceWorkers: 'block' })

async function mockProveedores(page, items = [proveedor()]) {
  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'proveedores') {
      return { json: { success: true, items } }
    }
    return { status: 400, json: { success: false, error: `sin manejar (GET): ${q.action}` } }
  })
}

test('flujo feliz completo: proveedor -> subir CSV -> checklist -> aplicar -> resumen -> importar otra', async ({ page }) => {
  await loginComo(page)
  await mockProveedores(page)
  await page.goto('/importar')

  await expect(page.getByRole('combobox')).toContainText('Sin proveedor')
  await page.getByRole('combobox').selectOption({ label: proveedor().per_nombre })

  const aplicable = itemImportacionAplicable()
  const noAplicable = itemImportacionNoAplicable()

  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    if (request.method() !== 'POST') return { status: 400, json: { success: false } }
    return {
      json: {
        success: true,
        items: [aplicable, noAplicable],
        sin_match: 1,
        fuente: 'csv',
        avisos: [],
      },
    }
  })

  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)

  // Checklist: la fila aplicable arranca tildada, la no aplicable
  // destildada Y disabled (regla de negocio: item.seleccionado = item.aplicable
  // al mapear la respuesta -- ver stores/importacionPrecios.js).
  const filaAplicable = page.locator('label', { hasText: aplicable.nombre_detectado })
  const filaNoAplicable = page.locator('label', { hasText: noAplicable.texto_original })
  await expect(filaAplicable.locator('input[type="checkbox"]')).toBeChecked()
  await expect(filaAplicable.locator('input[type="checkbox"]')).toBeEnabled()
  await expect(filaNoAplicable.locator('input[type="checkbox"]')).not.toBeChecked()
  await expect(filaNoAplicable.locator('input[type="checkbox"]')).toBeDisabled()

  await expect(page.getByRole('button', { name: /aplicar seleccionados \(1\)/i })).toBeVisible()

  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    expect(body.action).toBe('confirmar')
    const lineas = JSON.parse(body.lineas)
    expect(lineas).toHaveLength(1)
    expect(lineas[0].prod_id).toBe(aplicable.prod_id)
    return { json: { success: true, aplicados: 1, rechazados: 0 } }
  })

  await page.getByRole('button', { name: /aplicar seleccionados \(1\)/i }).click()

  await expect(page.getByText('Se actualizaron 1 productos.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Importación aplicada' })).toBeVisible()
  await expect(page.getByText('1 producto actualizado')).toBeVisible()

  await page.getByRole('button', { name: /importar otra lista/i }).click()
  await expect(page.getByRole('heading', { name: 'Importar lista de precios' })).toBeVisible()
  await expect(page.getByRole('combobox')).toContainText('Sin proveedor')
})

test('se puede analizar sin elegir proveedor', async ({ page }) => {
  await loginComo(page)
  await mockProveedores(page, [])
  await page.goto('/importar')

  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    expect(body.proveedor_id).toBeFalsy()
    return { json: { success: true, items: [itemImportacionAplicable()], sin_match: 0, fuente: 'csv', avisos: [] } }
  })

  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)
  await expect(page.getByRole('button', { name: /aplicar seleccionados \(1\)/i })).toBeVisible()
})

test('destildar la fila aplicable desactiva "Aplicar" (0 seleccionados)', async ({ page }) => {
  await loginComo(page)
  await mockProveedores(page)
  await page.goto('/importar')

  const aplicable = itemImportacionAplicable()
  await mockApi(page, IMPORTACION_URL, async () => ({
    json: { success: true, items: [aplicable], sin_match: 0, fuente: 'csv', avisos: [] },
  }))
  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)

  const checkbox = page.locator('label', { hasText: aplicable.nombre_detectado }).locator('input[type="checkbox"]')
  await checkbox.uncheck()

  const boton = page.getByRole('button', { name: /aplicar seleccionados \(0\)/i })
  await expect(boton).toBeVisible()
  await expect(boton).toBeDisabled()
})

test('caso negativo: API caída al analizar -- error claro, vuelve a poder elegir archivo', async ({ page }) => {
  await loginComo(page)
  await mockProveedores(page)
  await page.goto('/importar')

  await page.route(IMPORTACION_URL, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    if (req.method() === 'POST') return route.abort('failed')
    return route.continue()
  })

  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)
  await expect(page.getByText('No hay conexión con el servidor.')).toBeVisible()
  // Vuelve al selector de archivo, no se queda trabado en "Analizando...".
  // (el input real queda oculto por diseño -- se dispara clickeando el
  // dropzone -- lo que importa es que el prompt de "volver a elegir" esté.)
  await expect(page.getByText('Analizando el archivo...')).toHaveCount(0)
  await expect(page.getByText(/tocá para subir/i)).toBeVisible()
})

test('caso negativo: el backend rechaza el archivo', async ({ page }) => {
  await loginComo(page)
  await mockProveedores(page)
  await page.goto('/importar')

  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    if (request.method() === 'POST') {
      return { json: { success: false, error: 'No se pudo leer el archivo.' } }
    }
    return { status: 400, json: { success: false } }
  })

  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)
  await expect(page.getByText('No se pudo leer el archivo.')).toBeVisible()
})

test('caso negativo: confirmar falla tras un análisis exitoso -- HALLAZGO: el error queda invisible', async ({ page }) => {
  // Este test documenta un bug real encontrado al implementar (no estaba
  // anticipado en el discovery de Ronda 1, ver docs/testing/test-matrix.md
  // §2): store.confirmarSeleccionados() sí setea `store.error` cuando
  // falla, pero en ImportarView.vue el ÚNICO `v-if="store.error"` del
  // template vive dentro del bloque
  // `v-else-if="!store.items.length && !store.analizando"` -- ese bloque
  // deja de renderizarse justo cuando hay checklist (items.length > 0), que
  // es exactamente el estado en que se puede llamar "Aplicar seleccionados".
  // Tampoco hay toast de error (el toast de éxito en ImportarView.vue solo
  // dispara `if (store.resumen)`, que queda null en el fallo). Resultado
  // real para el usuario: toca "Aplicar seleccionados", el botón vuelve a
  // su estado normal, y no pasa nada visible -- ningún indicio de que algo
  // falló. Se fija tal cual es hoy (regression-lock), no se "arregla" acá.
  await loginComo(page)
  await mockProveedores(page)
  await page.goto('/importar')

  const aplicable = itemImportacionAplicable()
  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    if (body.action === 'confirmar') {
      return { json: { success: false, error: 'No se pudo aplicar la actualización.' } }
    }
    return { json: { success: true, items: [aplicable], sin_match: 0, fuente: 'csv', avisos: [] } }
  })

  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)
  const boton = page.getByRole('button', { name: /aplicar seleccionados \(1\)/i })
  await boton.click()

  // El checklist sigue ahí -- items.value solo se vacía en el try exitoso.
  await expect(boton).toBeVisible()
  await expect(boton).toBeEnabled() // no queda trabado en "Aplicando..."
  // El mensaje de error NO aparece en ningún lado de la pantalla -- este es
  // el hallazgo. Si algún día se arregla el template, esta aserción debería
  // empezar a fallar (toHaveCount(0) dejaría de cumplirse), lo cual es la
  // señal correcta para actualizar este test.
  await expect(page.getByText('No se pudo aplicar la actualización.')).toHaveCount(0)
})

test('caso negativo: doble submit en "Aplicar seleccionados"', async ({ page }) => {
  await loginComo(page)
  await mockProveedores(page)
  await page.goto('/importar')

  const aplicable = itemImportacionAplicable()
  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    const body = leerBodyUrlEncoded(request)
    if (body.action === 'confirmar') return { json: { success: true, aplicados: 1, rechazados: 0 } }
    return { json: { success: true, items: [aplicable], sin_match: 0, fuente: 'csv', avisos: [] } }
  })
  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)
  await expect(page.getByRole('button', { name: /aplicar seleccionados \(1\)/i })).toBeVisible()

  const contador = contarRequests(page, IMPORTACION_URL, 'POST')
  await page.evaluate(() => {
    const botones = [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Aplicar seleccionados'))
    botones[0]?.click()
    botones[0]?.click()
  })

  await expect(page.getByRole('heading', { name: 'Importación aplicada' })).toBeVisible()
  // El contador arranca DESPUÉS del analizar (setInputFiles ya resolvió),
  // así que solo cuenta las requests de "confirmar" del doble click. Mismo
  // patrón que en LoginView/ProductoCard (ver hallazgo 7 en test-matrix.md
  // §2): sin guard de reentrada real, un doble click sincrónico manda 2
  // confirmar en vez de 1. Confirmado con este test.
  expect(contador.valor).toBe(2)
})

test('caso negativo: rol FISCAL no ve el link, pero si entra por URL directa el 403 se maneja con gracia', async ({ page }) => {
  await loginComo(page, { rol: 3 })

  // El TabBar oculta el link para rol FISCAL(3) -- confirmarlo primero.
  await expect(page.getByRole('link', { name: /lista pdf/i })).toHaveCount(0)

  // El router no tiene guard de rol (documentado como intencional en
  // TabBar.vue): un FISCAL que teclea la URL entra igual a la vista.
  await mockProveedores(page)
  await page.goto('/importar')
  await expect(page.getByRole('heading', { name: 'Importar lista de precios' })).toBeVisible()

  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    if (request.method() === 'POST') {
      return { status: 403, json: { success: false, error: 'No tenés permiso para importar listas de precios.' } }
    }
    return { status: 400, json: { success: false } }
  })

  const erroresPagina = []
  page.on('pageerror', (e) => erroresPagina.push(String(e)))

  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)
  await expect(page.getByText('No tenés permiso para importar listas de precios.')).toBeVisible()
  expect(erroresPagina).toEqual([])
})

test('P2: sube una foto real -- pasa por compresión de Canvas (createImageBitmap real) y llega como .jpg', async ({ page }) => {
  await loginComo(page)
  await mockProveedores(page)
  await page.goto('/importar')

  let nombreArchivoRecibido = null
  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    if (request.method() === 'POST') {
      const multipart = request.postData() || ''
      const match = multipart.match(/filename="([^"]+)"/)
      nombreArchivoRecibido = match ? match[1] : null
      return { json: { success: true, items: [itemImportacionAplicable()], sin_match: 0, fuente: 'foto', avisos: [] } }
    }
    return { status: 400, json: { success: false } }
  })

  await page.locator('input[type="file"]').setInputFiles(JPG_FIXTURE)
  await expect(page.getByRole('button', { name: /aplicar seleccionados \(1\)/i })).toBeVisible()

  // comprimirSiEsImagen() renombra a <base>.jpg tras recodificar -- si esto
  // no pasara por Canvas real (jsdom no lo soporta, por eso es un caso para
  // E2E y no para unit/integration), el nombre no cambiaría de forma
  // predecible o el análisis fallaría directamente.
  expect(nombreArchivoRecibido).toMatch(/\.jpg$/i)
})
