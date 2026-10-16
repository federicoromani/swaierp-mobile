// Visual regression -- máximo 2 comparaciones, ambas justificadas (ver
// docs/testing/plan-agente-3-e2e.md §5): no se testea login ni el estado
// vacío de reportes porque una regresión ahí es cosmética, no lleva a una
// decisión de negocio equivocada. Estas dos sí:
//
//   1. ProductoCard con margen bajo vs. margen ok: el color/contraste del
//      badge (bg-red-100/text-danger vs bg-green-100/text-success) y el
//      banner de advertencia son la ÚNICA señal visual de que un precio
//      quedó mal cargado. Si una regresión de CSS empareja ambos estados,
//      un empleado puede guardar un precio con margen insuficiente sin
//      darse cuenta -- plata real, no un detalle estético.
//   2. ImportarView, checklist con ítems aplicables y no aplicables
//      mezclados: la fila no aplicable se ve (opacity-60 + checkbox
//      disabled) para dejar claro que no se va a aplicar. Si una regresión
//      la deja con apariencia normal, el usuario puede pensar que algo se
//      va a actualizar cuando el checkbox ni siquiera es clickeable --
//      misma familia de riesgo que el punto 1.
//
// Al final del orden de implementación a propósito (plan §9): bajar el
// churn de rebaseline de screenshots mientras el resto todavía se estaba
// estabilizando.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams } from './support/mockApi.js'
import { PRODUCTOS_URL, IMPORTACION_URL } from './support/urls.js'
import { productoResultado, productoDetalle, proveedor, itemImportacionAplicable, itemImportacionNoAplicable } from './support/fixtures.js'
import { loginComo } from './support/login.js'
import { abrirPrecio, seccionPrecio } from './support/locators.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSV_FIXTURE = path.join(__dirname, 'fixtures', 'lista-precios.csv')

// Screenshots por viewport son casi el propósito de este archivo (plan §4)
// -- corre en ambos proyectos a propósito, no hace falta test.use acá para
// restringir. Sí se bloquea el Service Worker real: estos tests no
// necesitan PWA en el medio, solo agregarían superficie de flake (mismo
// criterio que los specs de journeys de negocio, ver plan §0.2).
test.use({ serviceWorkers: 'block' })

// Sección "Precio y margen" de ProductoCard (abierta): venta, costo, badge de
// margen y, si aplica, el banner de advertencia.
async function bloqueMargen(page) {
  await abrirPrecio(page)
  return seccionPrecio(page)
}

async function irADetalleConMargen(page, detalle) {
  const resultado = productoResultado({ prod_id: detalle.prod_id ?? 101, nombre: detalle.nombre })
  await loginComo(page)
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'buscar') return { json: { success: true, items: [resultado] } }
    if (q.action === 'detalle') return { json: detalle }
    return { status: 400, json: { success: false, error: `acción no mockeada: ${q.action}` } }
  })
  await page.locator('input[inputmode="search"]').fill(resultado.nombre.slice(0, 6))
  await page.getByRole('button', { name: new RegExp(resultado.nombre, 'i') }).click()
  await expect(page.getByRole('heading', { name: detalle.nombre })).toBeVisible()
}

test('ProductoCard: margen bajo -- badge rojo + banner de advertencia visible', async ({ page }) => {
  await irADetalleConMargen(
    page,
    productoDetalle({ nombre: 'Visual Margen Bajo', ultimo_ajuste_precio: null, costo: 100, precio_venta: 110 }) // (110-100)/110 = 9,1% < 30% default
  )

  const bloque = await bloqueMargen(page)
  await expect(page.getByText('El margen quedó por debajo del mínimo definido.')).toBeVisible()
  await expect(bloque).toHaveScreenshot('producto-margen-bajo.png', { animations: 'disabled' })
})

test('ProductoCard: margen ok -- badge verde, sin banner de advertencia', async ({ page }) => {
  await irADetalleConMargen(
    page,
    productoDetalle({ nombre: 'Visual Margen Ok', ultimo_ajuste_precio: null, costo: 100, precio_venta: 200 }) // (200-100)/200 = 50% >= 30% default
  )

  const bloque = await bloqueMargen(page)
  await expect(page.getByText('El margen quedó por debajo del mínimo definido.')).toHaveCount(0)
  await expect(bloque).toHaveScreenshot('producto-margen-ok.png', { animations: 'disabled' })
})

test('ImportarView: checklist con ítems aplicables y no aplicables mezclados', async ({ page }) => {
  await loginComo(page)
  await mockApi(page, IMPORTACION_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'proveedores') return { json: { success: true, items: [proveedor()] } }
    if (request.method() === 'POST') {
      return {
        json: {
          success: true,
          items: [itemImportacionAplicable(), itemImportacionNoAplicable()],
          sin_match: 1,
          fuente: 'csv',
          avisos: [],
        },
      }
    }
    return { status: 400, json: { success: false, error: `sin manejar (GET): ${q.action}` } }
  })
  await page.goto('/importar')

  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)

  const checklist = page.locator('.bg-white.rounded-xl.shadow-sm.border.divide-y.text-xs')
  await expect(checklist).toBeVisible()
  // Confirma que efectivamente hay una fila de cada tipo antes de fijar la
  // captura -- si algún día el fixture cambia y deja de haber una fila
  // "no aplicable", este assert avisa antes que un diff de screenshot
  // silencioso.
  await expect(checklist.locator('input[type="checkbox"]:disabled')).toHaveCount(1)
  await expect(checklist.locator('input[type="checkbox"]:not(:disabled)')).toHaveCount(1)

  await expect(checklist).toHaveScreenshot('importar-checklist-aplicable-no-aplicable.png', { animations: 'disabled' })
})
