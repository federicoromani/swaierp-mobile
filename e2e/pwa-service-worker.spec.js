// PWA: registro, activación e instalabilidad del Service Worker real
// (Workbox generado por vite-plugin-pwa, generateSW + registerType
// 'autoUpdate'). A diferencia de los specs de negocio, ACÁ el SW real tiene
// que estar activo a propósito -- por eso no hay `serviceWorkers: 'block'`
// en este archivo (el default de Playwright ya es 'allow'). Ver
// docs/testing/plan-agente-3-e2e.md §3.1.
import { test, expect } from '@playwright/test'

// Mecánica de SW/CDP: no depende de viewport ni de touch (confirmado
// corriendo este archivo en ambos proyectos antes de restringirlo -- pasó
// igual en los dos). Correrlo dos veces no agrega señal, solo duplica
// tiempo de CI (ver plan §4). Restringido a desktop-chromium a propósito.
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'mecánica de SW, no depende de viewport -- ver plan §4')
})

test('el Service Worker se registra con scope "/"', async ({ page }) => {
  await page.goto('/')

  const registro = await page.evaluate(async () => {
    // Esperar a que termine el registro (registerSW({immediate:true}) en
    // main.js lo dispara apenas arranca la app, pero es asíncrono).
    for (let i = 0; i < 50; i++) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) return { scope: reg.scope, tieneInstalling: !!reg.installing, tieneWaiting: !!reg.waiting, tieneActive: !!reg.active }
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  })

  expect(registro).not.toBeNull()
  expect(new URL(registro.scope).pathname).toBe('/')
})

test('el Service Worker activa y toma control de la página SIN necesitar un reload (clientsClaim)', async ({ page }) => {
  await page.goto('/')

  const estado = await page.evaluate(async () => {
    let reg = null
    for (let i = 0; i < 50 && !reg?.active; i++) {
      reg = await navigator.serviceWorker.getRegistration()
      if (!reg?.active) await new Promise((r) => setTimeout(r, 100))
    }
    // clientsClaim() en el SW generado (confirmado leyendo dist/sw.js: hace
    // self.skipWaiting() + e.clientsClaim() sin condición) hace que la
    // página quede controlada apenas el SW activa, incluso en la primera
    // visita y sin recargar.
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    return {
      activeState: reg?.active?.state ?? null,
      controlando: !!navigator.serviceWorker.controller,
    }
  })

  expect(estado.activeState).toBe('activated')
  expect(estado.controlando).toBe(true)
})

test('señal de instalabilidad (proxy vía CDP): sin errores de instalabilidad de Chrome', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 10000 })

  const cdp = await context.newCDPSession(page)
  const resultado = await cdp.send('Page.getInstallabilityErrors')

  expect(resultado.installabilityErrors).toEqual([])
})
