import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '../offline/db'
import * as authService from '../services/authService'

const CLAVE_REFRESH = 'refresh_token'

export const useAuthStore = defineStore('auth', () => {
  // El access token vive SOLO en memoria: se pierde al recargar la página a
  // propósito (es de vida corta, 15 min por default). El refresh token es lo
  // único persistido (IndexedDB), y restaurarSesion() lo cambia por un access
  // token nuevo al bootear la app.
  const accessToken = ref(null)
  const usuario = ref(null)
  const config = ref({ margen_objetivo_pct: 30 })
  const cargando = ref(false)
  const listo = ref(false)

  const estaAutenticado = computed(() => !!accessToken.value)

  async function restaurarSesion() {
    if (listo.value) {
      return estaAutenticado.value
    }
    cargando.value = true
    try {
      const registro = await db.sesion.get(CLAVE_REFRESH)
      if (!registro) {
        return false
      }
      const datos = await authService.refresh(registro.valor)
      if (!datos.success) {
        await limpiarSesionLocal()
        return false
      }
      accessToken.value = datos.access_token
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: datos.refresh_token })
      return true
    } catch {
      return false
    } finally {
      cargando.value = false
      listo.value = true
    }
  }

  async function login(usuarioInput, clave) {
    cargando.value = true
    try {
      const datos = await authService.login(usuarioInput, clave, navigator.userAgent)
      if (!datos.success) {
        throw new Error(datos.error || 'No se pudo iniciar sesión.')
      }
      accessToken.value = datos.access_token
      usuario.value = datos.usuario
      config.value = datos.config
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: datos.refresh_token })
      listo.value = true
    } finally {
      cargando.value = false
    }
  }

  async function logout() {
    const registro = await db.sesion.get(CLAVE_REFRESH)
    if (registro) {
      try {
        await authService.logout(registro.valor)
      } catch {
        // best-effort: si no hay red, igual limpiamos la sesión local.
      }
    }
    await limpiarSesionLocal()
  }

  async function limpiarSesionLocal() {
    accessToken.value = null
    usuario.value = null
    await db.sesion.delete(CLAVE_REFRESH)
  }

  /**
   * Llamado por apiClient cuando una petición devuelve 401: intenta canjear
   * el refresh token guardado por un access token nuevo. Lanza si no hay
   * refresh token o si el servidor lo rechaza (sesión vencida/revocada).
   */
  async function refrescarToken() {
    const registro = await db.sesion.get(CLAVE_REFRESH)
    if (!registro) {
      throw new Error('Sin sesión.')
    }
    const datos = await authService.refresh(registro.valor)
    if (!datos.success) {
      throw new Error(datos.error || 'Sesión inválida.')
    }
    accessToken.value = datos.access_token
    await db.sesion.put({ clave: CLAVE_REFRESH, valor: datos.refresh_token })
    return datos.access_token
  }

  return {
    accessToken,
    usuario,
    config,
    cargando,
    listo,
    estaAutenticado,
    restaurarSesion,
    login,
    logout,
    limpiarSesionLocal,
    refrescarToken,
  }
})
