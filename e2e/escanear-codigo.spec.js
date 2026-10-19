// Journey: escanear el código de barras de un producto en la góndola y caer
// directo en su card para contarlo. La cámara se reemplaza por el stream de
// un <canvas> y BarcodeDetector por uno falso que "lee" el código que el test
// le indica: lo que se prueba es el recorrido en un navegador real (permiso,
// <video>, detección, búsqueda exacta), no el decodificador.
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams, leerBodyUrlEncoded } from './support/mockApi.js'
import { PRODUCTOS_URL } from './support/urls.js'
import { productoResultado, productoDetalle } from './support/fixtures.js'
import { loginComo } from './support/login.js'

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__codigoEnCamara = null
    class BarcodeDetectorFalso {
      static async getSupportedFormats() {
        return ['ean_13', 'code_128']
      }
      async detect() {
        return window.__codigoEnCamara ? [{ rawValue: window.__codigoEnCamara, format: 'ean_13' }] : []
      }
    }
    window.BarcodeDetector = BarcodeDetectorFalso
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#888'
      ctx.fillRect(0, 0, 320, 240)
      return canvas.captureStream(10)
    }
  })
  await loginComo(page)
})

test('escanear un código que existe abre el producto directo', async ({ page }) => {
  const codigo = '7790001234567'
  const busquedas = []
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'buscar') {
      busquedas.push(q.q)
      return { json: { success: true, items: [productoResultado({ codigo, nombre: 'Taladro percutor 650W' })] } }
    }
    if (q.action === 'detalle') {
      return { json: productoDetalle({ codigo, nombre: 'Taladro percutor 650W' }) }
    }
    return { status: 400, json: { success: false, error: `acción no mockeada: ${q.action}` } }
  })

  await page.getByRole('button', { name: 'Escanear código de barras' }).click()
  const escaner = page.getByRole('dialog', { name: 'Escanear código de barras' })
  await expect(escaner.getByText('Apuntá al código de barras del producto')).toBeVisible()

  await page.evaluate((c) => (window.__codigoEnCamara = c), codigo)

  await expect(page.getByRole('heading', { name: 'Taladro percutor 650W' })).toBeVisible()
  await expect(escaner).toHaveCount(0)
  expect(busquedas).toEqual([codigo])
})

test('código sin producto: se busca el producto a mano, se le asigna y el próximo escaneo lo abre', async ({ page }) => {
  const codigo = '7790009998887'
  // "Base" del mock: el producto arranca sin código de barras.
  let codigoBarras = null
  const producto = () => ({ prod_id: 101, codigo: 'YER-1', codigo_barras: codigoBarras, nombre: 'Yerba mate 1kg' })
  const asignaciones = []
  let detalles = 0
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    if (request.method() === 'POST') {
      const body = leerBodyUrlEncoded(request)
      if (body.action === 'asignar_codigo_barras') {
        asignaciones.push(body)
        codigoBarras = body.codigo_barras || null
        return { json: productoDetalle(producto()) }
      }
    }
    const q = leerQueryParams(request)
    if (q.action === 'buscar') {
      const items = q.q === codigo ? (codigoBarras === codigo ? [producto()] : []) : [productoResultado(producto())]
      return { json: { success: true, items } }
    }
    if (q.action === 'detalle') {
      detalles++
      return { json: productoDetalle(producto()) }
    }
    return { status: 400, json: { success: false, error: `acción no mockeada: ${q.action}` } }
  })

  await page.getByRole('button', { name: 'Escanear código de barras' }).click()
  await page.evaluate((c) => (window.__codigoEnCamara = c), codigo)
  await expect(page.getByText(`Ningún producto tiene el código ${codigo}`)).toBeVisible()
  await page.evaluate(() => (window.__codigoEnCamara = null))

  await page.getByLabel('Buscar producto').fill('yerba')
  await page.getByRole('button', { name: /Yerba mate 1kg/ }).click()
  await expect(page.getByRole('heading', { name: 'Yerba mate 1kg' })).toBeVisible()
  await expect(page.getByText(`Escaneaste ${codigo}, que no es de ningún producto.`)).toBeVisible()

  await page.getByRole('button', { name: 'Asignar a este producto' }).click()
  await expect(page.getByText('Código de barras guardado.')).toBeVisible()
  await expect(page.getByText('Escaneaste')).toHaveCount(0)
  expect(asignaciones).toEqual([{ action: 'asignar_codigo_barras', prod_id: '101', codigo_barras: codigo }])

  await expect(page.getByText(codigo, { exact: true })).toBeVisible()

  // Ahora el mismo código abre el producto directo (vuelve a pedir su detalle).
  const detallesAntes = detalles
  await page.getByRole('button', { name: 'Escanear código de barras' }).click()
  await page.evaluate((c) => (window.__codigoEnCamara = c), codigo)
  await expect.poll(() => detalles).toBe(detallesAntes + 1)
  await expect(page.getByRole('heading', { name: 'Yerba mate 1kg' })).toBeVisible()
  await expect(page.getByText('Ningún producto tiene el código')).toHaveCount(0)
})

test('desde la card se escanea el envase para asignarle el código', async ({ page }) => {
  const codigo = '7790005554443'
  let codigoBarras = null
  const producto = () => ({ prod_id: 101, codigo: 'YER-1', codigo_barras: codigoBarras, nombre: 'Yerba mate 1kg' })
  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    if (request.method() === 'POST' && leerBodyUrlEncoded(request).action === 'asignar_codigo_barras') {
      codigoBarras = leerBodyUrlEncoded(request).codigo_barras
      return { json: productoDetalle(producto()) }
    }
    const q = leerQueryParams(request)
    if (q.action === 'buscar') return { json: { success: true, items: [productoResultado(producto())] } }
    if (q.action === 'detalle') return { json: productoDetalle(producto()) }
    return { status: 400, json: { success: false, error: `acción no mockeada: ${q.action}` } }
  })

  await page.getByLabel('Buscar producto').fill('yerba')
  await page.getByRole('button', { name: /Yerba mate 1kg/ }).click()
  await expect(page.getByText('Sin código de barras')).toBeVisible()

  await page.getByRole('button', { name: 'Asignar código de barras' }).click()
  await expect(page.getByRole('dialog', { name: 'Escanear código de barras' })).toContainText('Asignar código de barras')
  await page.evaluate((c) => (window.__codigoEnCamara = c), codigo)

  await expect(page.getByText('Código de barras guardado.')).toBeVisible()
  await expect(page.getByText(codigo, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cambiar código de barras' })).toBeVisible()
})

test('sin permiso de cámara explica el motivo y deja buscar a mano', async ({ page }) => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }
  })

  await page.getByRole('button', { name: 'Escanear código de barras' }).click()
  await expect(page.getByRole('alert')).toContainText('No hay permiso para usar la cámara')

  await page.getByRole('button', { name: 'Buscar a mano' }).click()
  await expect(page.getByRole('dialog', { name: 'Escanear código de barras' })).toHaveCount(0)
  await expect(page.getByLabel('Buscar producto')).toBeVisible()
})
