// Journey: escanear el código de barras de un producto en la góndola y caer
// directo en su card para contarlo. La cámara se reemplaza por el stream de
// un <canvas> y BarcodeDetector por uno falso que "lee" el código que el test
// le indica: lo que se prueba es el recorrido en un navegador real (permiso,
// <video>, detección, búsqueda exacta), no el decodificador.
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams } from './support/mockApi.js'
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
