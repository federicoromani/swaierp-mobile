import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/', redirect: '/buscar' },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { requiresAuth: false },
  },
  { path: '/buscar', name: 'buscar', component: () => import('../views/BuscarView.vue') },
  { path: '/importar', name: 'importar', component: () => import('../views/ImportarView.vue') },
  { path: '/reportes', name: 'reportes', component: () => import('../views/ReportesView.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.listo) {
    await auth.restaurarSesion()
  }
  if (to.name === 'login' && auth.estaAutenticado) {
    return { path: (to.query.redirect ?? '/buscar').toString() }
  }
  if (to.meta.requiresAuth === false) {
    return true
  }
  if (!auth.estaAutenticado) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
