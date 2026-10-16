import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const nombreComercio = env.VITE_COMERCIO_NOMBRE || 'SWAI ERP'

  return {
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon.svg', 'icons/icon-maskable.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: `${nombreComercio} · Stock y Precios`,
          short_name: nombreComercio,
          description: `Actualización ágil de stock y precios — ${nombreComercio}`,
          theme_color: '#0f172a',
          background_color: '#f1f5f9',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          lang: 'es-AR',
          orientation: 'portrait',
          // PNG de 192 y 512: Chrome en Android los exige para instalar la app
          // como app (WebAPK); con solo SVG puede quedar como acceso directo
          // que abre una pestaña del navegador. Se generan desde los SVG.
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        workbox: {
          // Lecturas (buscar/detalle/reportes): NetworkFirst para que sigan
          // andando con conectividad intermitente. Las mutaciones
          // (actualizar_precio/ajustar_stock) NO se cachean acá — se manejan
          // aparte (ver src/offline/db.js): un ajuste de stock manda un valor
          // absoluto calculado contra lo que el usuario vio en pantalla, y
          // reintentarlo solo en background horas después arriesga pisar
          // ventas/compras que movieron el stock mientras tanto.
          runtimeCaching: [
            {
              urlPattern: ({ url, request }) =>
                url.pathname.includes('/apps/api_') && request.method === 'GET',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-lecturas',
                networkTimeoutSeconds: 5,
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            // Lector de códigos sin BarcodeDetector nativo (iOS): el .wasm
            // (~1 MB, nombre con hash) no va al precache de la instalación;
            // se cachea la primera vez que se abre el escáner.
            {
              urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'lector-codigos',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 4 },
              },
            },
          ],
        },
      }),
    ],
  }
})
