import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../../../src/stores/auth'
import { db } from '../../../src/offline/db'
import * as authService from '../../../src/services/authService'

// authService se mockea entero: acá se testea la lógica de la store (cuándo
// refresca, qué persiste en Dexie, qué expone al resto de la app), no el
// contrato HTTP real (eso es Subagente 2 con MSW).
vi.mock('../../../src/services/authService')

const CLAVE_REFRESH = 'refresh_token'

describe('stores/auth', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    await db.sesion.clear()
  })

  describe('estado inicial', () => {
    it('arranca sin token, sin usuario, con config default y sin autenticar', () => {
      const auth = useAuthStore()
      expect(auth.accessToken).toBeNull()
      expect(auth.usuario).toBeNull()
      expect(auth.config).toEqual({ margen_objetivo_pct: 30 })
      expect(auth.cargando).toBe(false)
      expect(auth.listo).toBe(false)
      expect(auth.estaAutenticado).toBe(false)
    })
  })

  describe('login()', () => {
    it('en éxito setea token/usuario/config, persiste el refresh y marca listo', async () => {
      authService.login.mockResolvedValue({
        success: true,
        access_token: 'tok-123',
        refresh_token: 'ref-123',
        usuario: { nombre: 'Fede', rol: 1 },
        config: { margen_objetivo_pct: 25 },
      })
      const auth = useAuthStore()

      await auth.login('fede', 'clave123')

      expect(auth.accessToken).toBe('tok-123')
      expect(auth.usuario).toEqual({ nombre: 'Fede', rol: 1 })
      expect(auth.config).toEqual({ margen_objetivo_pct: 25 })
      expect(auth.listo).toBe(true)
      expect(auth.estaAutenticado).toBe(true)
      const registro = await db.sesion.get(CLAVE_REFRESH)
      expect(registro.valor).toBe('ref-123')
    })

    it('pasa usuario/clave/userAgent al service', async () => {
      authService.login.mockResolvedValue({
        success: true,
        access_token: 't',
        refresh_token: 'r',
        usuario: {},
        config: {},
      })
      const auth = useAuthStore()

      await auth.login('fede', 'clave123')

      expect(authService.login).toHaveBeenCalledWith('fede', 'clave123', navigator.userAgent)
    })

    it('con success:false lanza Exception con el mensaje del backend y no setea token', async () => {
      authService.login.mockResolvedValue({ success: false, error: 'Usuario o clave incorrectos.' })
      const auth = useAuthStore()

      await expect(auth.login('fede', 'mal')).rejects.toThrow('Usuario o clave incorrectos.')
      expect(auth.accessToken).toBeNull()
      expect(auth.cargando).toBe(false)
    })

    it('con success:false y sin mensaje propio usa el default en español', async () => {
      authService.login.mockResolvedValue({ success: false })
      const auth = useAuthStore()

      await expect(auth.login('fede', 'mal')).rejects.toThrow('No se pudo iniciar sesión.')
    })

    it('cargando es true mientras la petición está en vuelo y false al terminar', async () => {
      let resolver
      authService.login.mockReturnValue(
        new Promise((resolve) => {
          resolver = resolve
        })
      )
      const auth = useAuthStore()

      const promesa = auth.login('fede', 'clave123')
      await Promise.resolve()
      expect(auth.cargando).toBe(true)

      resolver({ success: true, access_token: 't', refresh_token: 'r', usuario: {}, config: {} })
      await promesa
      expect(auth.cargando).toBe(false)
    })
  })

  describe('restaurarSesion()', () => {
    it('sin refresh guardado en Dexie devuelve false y no llama al backend', async () => {
      const auth = useAuthStore()

      const resultado = await auth.restaurarSesion()

      expect(resultado).toBe(false)
      expect(authService.refresh).not.toHaveBeenCalled()
      expect(auth.listo).toBe(true)
    })

    it('con refresh guardado y backend OK, setea token nuevo y persiste el refresh nuevo', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref-viejo' })
      authService.refresh.mockResolvedValue({
        success: true,
        access_token: 'tok-nuevo',
        refresh_token: 'ref-nuevo',
      })
      const auth = useAuthStore()

      const resultado = await auth.restaurarSesion()

      expect(resultado).toBe(true)
      expect(auth.accessToken).toBe('tok-nuevo')
      const registro = await db.sesion.get(CLAVE_REFRESH)
      expect(registro.valor).toBe('ref-nuevo')
    })

    it('con refresh guardado pero backend success:false, limpia la sesión local y devuelve false', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref-viejo' })
      authService.refresh.mockResolvedValue({ success: false, error: 'Sesión vencida.' })
      const auth = useAuthStore()
      auth.accessToken = 'algo-previo'

      const resultado = await auth.restaurarSesion()

      expect(resultado).toBe(false)
      expect(auth.accessToken).toBeNull()
      const registro = await db.sesion.get(CLAVE_REFRESH)
      expect(registro).toBeUndefined()
    })

    it('si el backend de refresh tira una excepción (sin red), devuelve false sin explotar', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref-viejo' })
      authService.refresh.mockRejectedValue(new Error('No hay conexión con el servidor.'))
      const auth = useAuthStore()

      const resultado = await auth.restaurarSesion()

      expect(resultado).toBe(false)
      expect(auth.listo).toBe(true)
    })

    it('si ya está listo, devuelve estaAutenticado directo sin volver a llamar al backend', async () => {
      const auth = useAuthStore()
      auth.listo = true
      auth.accessToken = 'tok-en-memoria'

      const resultado = await auth.restaurarSesion()

      expect(resultado).toBe(true)
      expect(authService.refresh).not.toHaveBeenCalled()
    })
  })

  describe('logout()', () => {
    it('con refresh guardado llama a authService.logout con ese token y limpia la sesión local', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref-activo' })
      authService.logout.mockResolvedValue({ success: true })
      const auth = useAuthStore()
      auth.accessToken = 'tok'
      auth.usuario = { nombre: 'Fede' }

      await auth.logout()

      expect(authService.logout).toHaveBeenCalledWith('ref-activo')
      expect(auth.accessToken).toBeNull()
      expect(auth.usuario).toBeNull()
      const registro = await db.sesion.get(CLAVE_REFRESH)
      expect(registro).toBeUndefined()
    })

    it('sin refresh guardado no llama a authService.logout, pero igual limpia el estado', async () => {
      authService.logout.mockResolvedValue({ success: true })
      const auth = useAuthStore()
      auth.accessToken = 'tok'

      await auth.logout()

      expect(authService.logout).not.toHaveBeenCalled()
      expect(auth.accessToken).toBeNull()
    })

    it('si authService.logout falla (sin red), igual limpia la sesión local (best-effort)', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref-activo' })
      authService.logout.mockRejectedValue(new Error('No hay conexión con el servidor.'))
      const auth = useAuthStore()
      auth.accessToken = 'tok'

      await auth.logout()

      expect(auth.accessToken).toBeNull()
      const registro = await db.sesion.get(CLAVE_REFRESH)
      expect(registro).toBeUndefined()
    })
  })

  describe('refrescarToken()', () => {
    it('sin refresh guardado lanza Exception "Sin sesión."', async () => {
      const auth = useAuthStore()

      await expect(auth.refrescarToken()).rejects.toThrow('Sin sesión.')
    })

    it('con refresh guardado pero backend success:false, lanza con el mensaje del backend', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref-viejo' })
      authService.refresh.mockResolvedValue({ success: false, error: 'Sesión revocada.' })
      const auth = useAuthStore()

      await expect(auth.refrescarToken()).rejects.toThrow('Sesión revocada.')
    })

    it('con refresh guardado pero backend success:false y sin mensaje, usa el default', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref-viejo' })
      authService.refresh.mockResolvedValue({ success: false })
      const auth = useAuthStore()

      await expect(auth.refrescarToken()).rejects.toThrow('Sesión inválida.')
    })

    it('en éxito setea el token nuevo, persiste el refresh nuevo y devuelve el access_token', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref-viejo' })
      authService.refresh.mockResolvedValue({
        success: true,
        access_token: 'tok-refrescado',
        refresh_token: 'ref-refrescado',
      })
      const auth = useAuthStore()

      const resultado = await auth.refrescarToken()

      expect(resultado).toBe('tok-refrescado')
      expect(auth.accessToken).toBe('tok-refrescado')
      const registro = await db.sesion.get(CLAVE_REFRESH)
      expect(registro.valor).toBe('ref-refrescado')
    })
  })

  describe('limpiarSesionLocal()', () => {
    it('borra token, usuario y el registro de Dexie', async () => {
      await db.sesion.put({ clave: CLAVE_REFRESH, valor: 'ref' })
      const auth = useAuthStore()
      auth.accessToken = 'tok'
      auth.usuario = { nombre: 'Fede' }

      await auth.limpiarSesionLocal()

      expect(auth.accessToken).toBeNull()
      expect(auth.usuario).toBeNull()
      const registro = await db.sesion.get(CLAVE_REFRESH)
      expect(registro).toBeUndefined()
    })
  })
})
