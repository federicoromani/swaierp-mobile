// PWA: offline (shell, 2 capas de cache de lectura) + cache de assets. Ver
// docs/testing/plan-agente-3-e2e.md §3.2/§3.3.
//
// Este archivo SI necesita el Service Worker real activo (no hay
// serviceWorkers:'block' -- el default de Playwright ya es 'allow'). Las
// GET de productos pasan por la estrategia NetworkFirst DENTRO del propio
// SW; el helper `mockApi` (ver support/mockApi.js) registra sobre
// `page.context()`, que SI intercepta esos fetch (confirmado con un
// segundo spike, después de que el primero mostrara que `page.route()`
// solo no alcanza) -- así que se puede seguir mockeando con la misma API
// que en el resto de los specs, sin necesidad de un servidor real ni de
// `context.setOffline()` para las capas de cache de lectura (alcanza con
// hacer que el mock empiece a fallar/abortar DESPUÉS de haber servido una
// vez, para que Workbox recurra a lo que ya cacheó).
//
// La excepción es el primer test (shell offline): ahí sí se usa
// `context.setOffline(true)` de verdad, porque lo que se prueba es el
// arranque completo de la app con la red del SO cortada, no el
// comportamiento de un endpoint puntual.
import { test, expect } from '@playwright/test'
import { mockApi, leerQueryParams } from './support/mockApi.js'
import { PRODUCTOS_URL } from './support/urls.js'
import { productoResultado, productoDetalle } from './support/fixtures.js'
import { loginComo } from './support/login.js'
import { bloqueCampo } from './support/locators.js'

async function esperarSwControlando(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 10000 })
}

test('shell offline: tras una visita previa con sesión, recargar sin conexión muestra el shell de la app (no una pantalla de error del navegador)', async ({ page, context }) => {
  await loginComo(page)
  await esperarSwControlando(page)

  await context.setOffline(true)
  try {
    await page.reload()
    // El shell (precacheado por Workbox) tiene que renderizar la app Vue --
    // lo que se vea después depende de si restaurarSesion() logra red real
    // (ver hallazgo del plan §7.5: NO la logra estando offline, así que cae
    // a /login) pero eso es un problema aparte de "la app arrancó". Lo que
    // este test verifica es que arrancó: la marca de la app (presente tanto
    // en el login como en el chrome autenticado) renderiza igual.
    await expect(page.getByText(/swai erp/i).first()).toBeVisible({ timeout: 10000 })
  } finally {
    await context.setOffline(false)
  }
})

test('capa 1 (cache HTTP de Workbox): una búsqueda ya vista se sirve aunque el mock empiece a fallar después', async ({ page }) => {
  await loginComo(page)
  await esperarSwControlando(page)

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'buscar') {
      return { json: { success: true, items: [productoResultado({ nombre: 'Tornillo autoperforante 3/4' })] } }
    }
    return { status: 400, json: { success: false } }
  })

  await page.locator('input[inputmode="search"]').fill('tornillo')
  await expect(page.getByRole('button', { name: /tornillo autoperforante/i })).toBeVisible({ timeout: 10000 })
  await page.locator('input[inputmode="search"]').fill('')

  // A partir de acá, CUALQUIER request nueva a esta URL debe fallar (simula
  // que la red ya no responde) -- el registro más nuevo tiene prioridad, así
  // que esto reemplaza al mock de arriba. Si Workbox sirve del cache HTTP
  // que guardó recién, la MISMA búsqueda de arriba debería seguir
  // funcionando igual, sin que el fetch de la página se entere de nada.
  await page.context().route(PRODUCTOS_URL, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    return route.abort('failed')
  })

  await page.locator('input[inputmode="search"]').fill('tornillo')
  await expect(page.getByRole('button', { name: /tornillo autoperforante/i })).toBeVisible({ timeout: 10000 })
  // Clave: SIN error -- si esto viniera del fallback de Dexie (Capa 2) en
  // vez de servir transparente del cache HTTP, el store habría pasado por
  // el catch y `productos.error` (por lo tanto el banner rojo) estaría
  // seteado. Acá el fetch de la página nunca se entera de que la red falló.
  await expect(page.getByText('No hay conexión con el servidor.')).toHaveCount(0)
})

test('capa 2 (fallback de Dexie): una query nueva que el mock aborta cae al catalogoCache y SI muestra el error real', async ({ page }) => {
  await loginComo(page)
  await esperarSwControlando(page)

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'buscar') {
      return { json: { success: true, items: [productoResultado({ prod_id: 501, nombre: 'Tornillo autoperforante 3/4' })] } }
    }
    return { status: 400, json: { success: false } }
  })

  // Puebla catalogoCache buscando "tornillo" online (y de paso queda en el
  // cache HTTP del SW para ESA url exacta).
  await page.locator('input[inputmode="search"]').fill('tornillo')
  await expect(page.getByRole('button', { name: /tornillo autoperforante/i })).toBeVisible({ timeout: 10000 })
  await page.locator('input[inputmode="search"]').fill('')

  // A partir de ahora todo falla -- y la query de abajo es DISTINTA a la de
  // arriba, así que el cache HTTP del SW (que cachea por URL exacta,
  // querystring incluido) no tiene ninguna entrada para ella. El fetch real
  // falla de verdad -> el store cae al filtro por texto sobre TODO
  // catalogoCache, que sí matchea "autoperforante" en el nombre guardado.
  await page.context().route(PRODUCTOS_URL, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    return route.abort('failed')
  })

  await page.locator('input[inputmode="search"]').fill('autoperforante')

  await expect(page.getByRole('button', { name: /tornillo autoperforante/i })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('No hay conexión con el servidor.')).toBeVisible()
})

test('capa 2 sin match: query nueva que el mock aborta y que no matchea nada en catalogoCache muestra "Sin resultados", no un error confuso', async ({ page }) => {
  await loginComo(page)
  await esperarSwControlando(page)

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'buscar') {
      return { json: { success: true, items: [productoResultado({ nombre: 'Tornillo autoperforante 3/4' })] } }
    }
    return { status: 400, json: { success: false } }
  })
  await page.locator('input[inputmode="search"]').fill('tornillo')
  await expect(page.getByRole('button', { name: /tornillo autoperforante/i })).toBeVisible({ timeout: 10000 })
  await page.locator('input[inputmode="search"]').fill('')

  await page.context().route(PRODUCTOS_URL, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    return route.abort('failed')
  })
  await page.locator('input[inputmode="search"]').fill('zapatilla')

  await expect(page.getByText('Sin resultados. Probá con el código.')).toBeVisible({ timeout: 10000 })
})

test('se recupera la conexión: la mutación falla con mensaje claro y, sin recargar la página, reintentar funciona apenas vuelve la red', async ({ page }) => {
  const resultado = productoResultado()
  const detalle = productoDetalle({ costo: 100, precio_venta: 155 })
  await loginComo(page)
  await esperarSwControlando(page)

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'buscar') return { json: { success: true, items: [resultado] } }
    if (q.action === 'detalle') return { json: detalle }
    return { status: 400, json: { success: false } }
  })
  await page.locator('input[inputmode="search"]').fill('tornillo')
  await page.getByRole('button', { name: new RegExp(resultado.nombre, 'i') }).click()
  await expect(page.getByRole('heading', { name: detalle.nombre })).toBeVisible()

  // La mutación (POST) es lo que realmente se está probando acá -- no pasa
  // por la estrategia del SW (no tiene entrada en runtimeCaching), así que
  // simular la falla con abort() alcanza, sin falta usar setOffline().
  await page.context().route(PRODUCTOS_URL, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } })
    }
    return route.abort('failed')
  })
  await bloqueCampo(page, 'Precio de venta').locator('input[type="number"]').fill('200')
  const boton = page.getByRole('button', { name: /guardar precio/i })
  await boton.click()
  await expect(page.getByText('No hay conexión con el servidor.')).toBeVisible()

  await mockApi(page, PRODUCTOS_URL, async () => ({ json: productoDetalle({ costo: 100, precio_venta: 200 }) }))
  await boton.click()
  await expect(page.getByText('Precio actualizado.')).toBeVisible()
})

test('assets críticos quedan precacheados por Workbox (index, manifest, íconos, al menos un chunk JS)', async ({ page }) => {
  await page.goto('/')
  await esperarSwControlando(page)

  const entradas = await page.evaluate(async () => {
    const nombres = await caches.keys()
    const nombrePrecache = nombres.find((n) => n.includes('precache'))
    if (!nombrePrecache) return null
    const cache = await caches.open(nombrePrecache)
    const requests = await cache.keys()
    return requests.map((r) => new URL(r.url).pathname)
  })

  expect(entradas).not.toBeNull()
  expect(entradas).toEqual(
    expect.arrayContaining(['/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-maskable.svg'])
  )
  expect(entradas.some((p) => p.startsWith('/assets/') && p.endsWith('.js'))).toBe(true)
})

test('NetworkFirst: estando online, siempre prioriza la respuesta de red sobre lo que haya en cache (no es CacheFirst)', async ({ page }) => {
  let version = 'A'
  await loginComo(page)
  await esperarSwControlando(page)

  await mockApi(page, PRODUCTOS_URL, async (route, request) => {
    const q = leerQueryParams(request)
    if (q.action === 'buscar') {
      return { json: { success: true, items: [productoResultado({ nombre: `Producto version ${version}` })] } }
    }
    return { status: 400, json: { success: false } }
  })

  await page.locator('input[inputmode="search"]').fill('producto')
  await expect(page.getByRole('button', { name: /producto version a/i })).toBeVisible({ timeout: 10000 })

  version = 'B'
  await page.locator('input[inputmode="search"]').fill('')
  await page.locator('input[inputmode="search"]').fill('producto')
  await expect(page.getByRole('button', { name: /producto version b/i })).toBeVisible({ timeout: 10000 })
})
