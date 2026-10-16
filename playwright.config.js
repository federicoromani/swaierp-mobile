import { defineConfig, devices } from '@playwright/test'

// E2E corre contra el bundle real servido por `vite preview` (no `dev`, para
// no confundir HMR con el service worker real de producción) y con la
// capa de red interceptada vía page.route() en cada spec — no depende del
// backend real de swaidemo ni de credenciales reales (ver e2e/README.md).

// La pantalla de importación viene apagada por defecto (ver .env.example),
// pero importar-lista-precios.spec.js y visual.spec.js la siguen cubriendo.
// Se define a nivel de proceso (no en webServer.env) para que también la
// hereden los workers: pwa-actualizacion-v1-v2.spec.js rebuildea dist/ con
// execSync a mitad de la corrida, y sin esto los specs que corren después
// quedan contra un build sin la pantalla.
process.env.VITE_IMPORTAR_HABILITADO = 'true'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
