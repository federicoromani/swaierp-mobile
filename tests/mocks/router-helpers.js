// Helper para los tests que ejercitan el router real (src/router/index.js).
//
// Problema real encontrado al implementar (no estaba anticipado en el
// discovery, más allá de la advertencia genérica que ya dejamos en el plan):
// `router` es un singleton de módulo. Reusar la misma instancia importada
// una vez arriba del archivo entre varios tests de un mismo describe corre
// el riesgo de arrastrar estado — no tanto por el store de auth (Pinia
// resuelve `useAuthStore()` contra la pinia ACTIVA en cada llamada del
// guard, así que un `setActivePinia(createPinia())` nuevo por test ya alcanza
// para esa parte), sino por el propio `router.currentRoute` y por si algún
// test navega al mismo path que dejó el anterior.
//
// La solución validada con un spike (ver commit de la Ronda 2, se corrió con
// 3 tests seguidos navegando al mismo path con distinto estado de sesión
// antes de escribir el resto de la suite): `vi.resetModules()` + reimportar
// dinámicamente tanto el router como los stores usados en el guard, en CADA
// test. Eso da una instancia de router (y de cada store) completamente
// nueva, sin nada que resetear a mano. La única regla a respetar: dentro de
// un mismo test, usar SIEMPRE los bindings que devuelve esta función (no
// mezclar con un `import` estático del mismo módulo hecho arriba del
// archivo, porque después de `vi.resetModules()` son dos instancias
// distintas del store/router).

import { vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import LoginView from '../../src/views/LoginView.vue'
import BuscarView from '../../src/views/BuscarView.vue'
import ImportarView from '../../src/views/ImportarView.vue'
import ReportesView from '../../src/views/ReportesView.vue'
import ConteoView from '../../src/views/ConteoView.vue'

/**
 * Para tests que verifican EL GUARD REAL (src/router/index.js) — boot desde
 * Dexie, redirect a /login, etc. Usa el router singleton de la app, pero
 * reimportado fresco (`vi.resetModules()`) en cada llamada para no
 * arrastrar `currentRoute` ni nada del módulo entre tests. Junto con el
 * router trae los stores usados DENTRO del guard, re-importados del MISMO
 * registro de módulos fresco — no mezclar estos bindings con un `import`
 * estático de esos mismos módulos hecho arriba del archivo de test.
 *
 * @returns {Promise<{
 *   router: import('vue-router').Router,
 *   useAuthStore: () => import('pinia').Store,
 *   useProductosStore: () => import('pinia').Store,
 *   useReportesStore: () => import('pinia').Store,
 * }>}
 */
export async function routerYStoresFrescos() {
  vi.resetModules()
  const [routerMod, authMod, productosMod, reportesMod] = await Promise.all([
    import('../../src/router/index.js'),
    import('../../src/stores/auth.js'),
    import('../../src/stores/productos.js'),
    import('../../src/stores/reportes.js'),
  ])
  return {
    router: routerMod.default,
    useAuthStore: authMod.useAuthStore,
    useProductosStore: productosMod.useProductosStore,
    useReportesStore: reportesMod.useReportesStore,
  }
}

/**
 * Para el resto de los tests que necesitan ALGÚN router para que
 * `useRouter()`/`useRoute()`/`<router-link>` funcionen dentro de un
 * componente montado (LoginView, ReportesView navegando a /buscar, etc.)
 * pero NO están probando el guard de autenticación en sí — evita depender
 * del singleton real (y de su historial de navegación entre tests) armando
 * una instancia nueva por test, con las mismas rutas/componentes reales de
 * la app pero SIN el guard `router.beforeEach` (no hace falta: estos tests
 * arrancan ya en el estado que quieren probar).
 *
 * @param {string} rutaInicial ruta (con query si hace falta) a la que este
 *   router ya queda navegado cuando la función resuelve.
 */
export async function crearRouterLiviano(rutaInicial = '/login') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/buscar' },
      { path: '/login', name: 'login', component: LoginView, meta: { requiresAuth: false } },
      { path: '/buscar', name: 'buscar', component: BuscarView },
      { path: '/contar', name: 'contar', component: ConteoView, meta: { sinTabBar: true } },
      { path: '/importar', name: 'importar', component: ImportarView },
      { path: '/reportes', name: 'reportes', component: ReportesView },
    ],
  })
  await router.push(rutaInicial)
  return router
}
