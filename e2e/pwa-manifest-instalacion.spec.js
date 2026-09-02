// PWA: manifest e instalabilidad. Ver docs/testing/plan-agente-3-e2e.md §3.4.
//
// La señal de instalabilidad real (CDP Page.getInstallabilityErrors) ya se
// prueba en pwa-service-worker.spec.js -- no se repite acá para no
// duplicar el mismo chequeo dos veces (ver test-matrix.md). Este archivo se
// queda con lo que le es propio: el contenido del manifest y que sus
// recursos (íconos) efectivamente resuelvan.
//
// Recurso estático, no depende de viewport -- desktop-chromium solamente
// (mismo criterio que pwa-service-worker.spec.js, ver plan §4).
import { test, expect } from '@playwright/test'

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'recurso estático, no depende de viewport -- ver plan §4')
})

test('el manifest.webmanifest es válido y tiene los campos de una PWA instalable', async ({ page }) => {
  const respuesta = await page.request.get('/manifest.webmanifest')
  expect(respuesta.status()).toBe(200)

  const manifest = await respuesta.json()
  expect(manifest.name).toBeTruthy()
  expect(manifest.short_name).toBeTruthy()
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBeTruthy()
  expect(manifest.theme_color).toBe('#0f172a')
  expect(manifest.background_color).toBe('#f1f5f9')
  expect(Array.isArray(manifest.icons)).toBe(true)
  expect(manifest.icons.length).toBeGreaterThan(0)
  for (const icono of manifest.icons) {
    expect(icono.src).toBeTruthy()
    expect(icono.sizes).toBeTruthy()
    expect(icono.type).toBeTruthy()
  }
  // Al menos un ícono "maskable" -- lo pide Android para el ícono adaptativo.
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
})

test('el <link rel="manifest"> está en el head y apunta al manifest real', async ({ page }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()

  const respuesta = await page.request.get(new URL(href, page.url()).toString())
  expect(respuesta.status()).toBe(200)
})

test('los íconos del manifest resuelven con el content-type correcto', async ({ page }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()

  for (const icono of manifest.icons) {
    const respuesta = await page.request.get('/' + icono.src.replace(/^\/+/, ''))
    expect(respuesta.status(), `icono ${icono.src}`).toBe(200)
    expect(respuesta.headers()['content-type']).toContain('svg')
  }
})
