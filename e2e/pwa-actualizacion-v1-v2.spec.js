// PWA: actualización automática v1 -> v2 con un rebuild REAL de la app (no
// un mock). Ver docs/testing/plan-agente-3-e2e.md §3.5.
//
// Mecánica real (confirmada leyendo dist/sw.js generado y
// node_modules/vite-plugin-pwa/dist/client/build/register.js, no supuesta):
//   - registerType:'autoUpdate' compila a self.skipWaiting() +
//     clientsClaim() INCONDICIONALES en el SW generado.
//   - El cliente (registerSW({immediate:true}) en src/main.js) escucha el
//     evento 'activated' de workbox-window; si event.isUpdate es true, hace
//     window.location.reload() SOLO, sin preguntar nada (modo autoUpdate,
//     no hay prompt de "hay una nueva versión").
//   - El browser NUNCA usa la cache HTTP para el fetch del propio script
//     del SW (es una excepción del spec, para evitar el clásico "quedé
//     pegado en la v1 para siempre por un Cache-Control largo") -- por eso
//     alcanza con tocar un archivo fuente + rebuildear + reload, sin ningún
//     truco de cache-busting.
//
// CUIDADO -- este test reescribe dist/ (npm run build hace emptyOutDir) DOS
// VECES mientras el webServer de Playwright (vite preview) sigue sirviendo
// desde ese mismo directorio en disco. Si otro test de otro archivo está
// pegándole al preview server justo en la ventana en la que dist/ está a
// medio escribir, podría fallar por un asset momentáneamente ausente -- por
// eso este archivo se corre AISLADO (--workers=1, solo este archivo), nunca
// mezclado con el resto de la suite en paralelo. Ver el reporte de Ronda 2
// para el comando exacto usado.
//
// Es lento (dos builds completos de Vite dentro de un mismo test) y no
// depende de viewport/touch -- por eso va en su propio archivo, restringido
// a desktop-chromium, y al final del orden de implementación (plan §9).
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(__dirname, '..')
// Archivo fuente trivial a "tocar" para forzar un contenido distinto en el
// bundle (y por lo tanto un hash distinto en el chunk y en sw.js). main.js
// se eligió porque entra en el chunk principal (index-*.js), el mismo que
// referencia <script> en index.html -- así el cambio de hash es visible
// directamente en el DOM sin tener que inspeccionar el precache manifest.
const ARCHIVO_TOCADO = path.join(RAIZ, 'src', 'main.js')

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'rebuild real, no depende de viewport -- ver plan §4; además es lento, no vale correrlo dos veces')
})

test.use({ serviceWorkers: 'allow' })

async function scriptPrincipal(page) {
  return page.evaluate(() => document.querySelector('script[type="module"]')?.getAttribute('src') ?? null)
}

async function nombresDelPrecache(page) {
  return page.evaluate(async () => {
    const nombres = await caches.keys()
    const nombrePrecache = nombres.find((n) => n.includes('precache'))
    if (!nombrePrecache) return []
    const cache = await caches.open(nombrePrecache)
    const requests = await cache.keys()
    return requests.map((r) => new URL(r.url).pathname)
  })
}

test('actualización automática: v2 se instala, activa y recarga la página sola, sin dejar assets viejos en cache', async ({ page }) => {
  test.setTimeout(150_000) // dos builds completos de Vite (~10s cada uno) + margen generoso

  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15_000 })

  const scriptV1 = await scriptPrincipal(page)
  expect(scriptV1).toMatch(/^\/assets\/index-.*\.js$/)

  const original = fs.readFileSync(ARCHIVO_TOCADO, 'utf8')
  let huboRebuild = false
  try {
    // OJO -- un comentario JS no alcanza: el minificador de producción lo
    // descarta y el bundle queda byte-idéntico (confirmado con un spike
    // descartable: con un comentario el hash del chunk NO cambiaba y el
    // browser nunca detectaba actualización). Hace falta una sentencia real
    // con efecto de lado que sobreviva la minificación -- una asignación a
    // `window` no se poda porque tiene un side effect visible.
    fs.writeFileSync(ARCHIVO_TOCADO, `${original}\nwindow.__E2E_BUILD_MARK__ = ${Date.now()}\n`)
    execSync('npm run build', { cwd: RAIZ, stdio: 'pipe' })
    huboRebuild = true

    // Reload manual: dispara de nuevo registerSW({immediate:true}) en
    // main.js, que vuelve a llamar navigator.serviceWorker.register(...) ->
    // el browser chequea sw.js (bypass de cache SIEMPRE para el script del
    // propio SW, por spec), ve que difiere, instala el SW nuevo. Por
    // skipWaiting+clientsClaim incondicionales activa casi enseguida ->
    // dispara el listener 'activated' de register.js -> la página se
    // recarga SOLA una segunda vez. page.reload() resuelve tras el evento
    // 'load' de ESTE reload manual; el segundo waitForEvent('load') es el
    // reload automático que dispara la propia app.
    await page.reload()
    await page.waitForEvent('load', { timeout: 30_000 })

    // Tras el segundo reload, el SW activo debe ser el nuevo y debe estar
    // controlando de nuevo (clientsClaim también corre en esta activación).
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15_000 })

    const scriptV2 = await scriptPrincipal(page)
    expect(scriptV2).toMatch(/^\/assets\/index-.*\.js$/)
    expect(scriptV2).not.toBe(scriptV1) // el hash de contenido cambió -> nombre de archivo distinto

    // Ausencia de assets obsoletos: cleanupOutdatedCaches() está registrado
    // explícitamente en el SW generado (confirmado en dist/sw.js) -- el
    // precache actual no debe conservar ninguna entrada apuntando al chunk
    // viejo.
    const entradas = await nombresDelPrecache(page)
    expect(entradas).toContain(scriptV2)
    expect(entradas).not.toContain(scriptV1)
  } finally {
    // Restaurar el archivo tocado Y volver a buildear para dejar dist/ en
    // el mismo estado v1 con el que arrancó el webServer -- si no se
    // restaura, cualquier test que corra después (en otra invocación de
    // Playwright que reuse este webServer) quedaría sirviendo el bundle v2
    // "de prueba" con el comentario descartable adentro.
    fs.writeFileSync(ARCHIVO_TOCADO, original)
    if (huboRebuild) {
      execSync('npm run build', { cwd: RAIZ, stdio: 'pipe' })
    }
  }
})
