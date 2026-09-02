import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Config separada de vite.config.js a propósito: ese archivo instancia
// VitePWA (que espera un manifest real generado en build) y depende de
// VITE_COMERCIO_NOMBRE en tiempo de config-load — nada de eso hace falta
// para correr tests unitarios/de integración, y solo agregaría ruido/tiempo.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    css: true,
    include: ['tests/unit/**/*.spec.js', 'tests/integration/**/*.spec.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,vue}'],
      exclude: ['src/main.js'],
    },
  },
})
