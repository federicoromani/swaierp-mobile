import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from '../../../src/stores/ui'

describe('stores/ui', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('estado inicial: sin toast', () => {
    const ui = useUiStore()
    expect(ui.toast).toBeNull()
  })

  it('mostrarToast setea mensaje y tipo', () => {
    const ui = useUiStore()

    ui.mostrarToast('Precio actualizado.', 'success')

    expect(ui.toast).toEqual({ mensaje: 'Precio actualizado.', tipo: 'success' })
  })

  it('mostrarToast sin tipo usa "info" por default', () => {
    const ui = useUiStore()

    ui.mostrarToast('Algo pasó.')

    expect(ui.toast.tipo).toBe('info')
  })

  it('el toast desaparece solo tras la duración por default (3000ms)', () => {
    const ui = useUiStore()

    ui.mostrarToast('Chau en 3s.')
    expect(ui.toast).not.toBeNull()

    vi.advanceTimersByTime(2999)
    expect(ui.toast).not.toBeNull()

    vi.advanceTimersByTime(1)
    expect(ui.toast).toBeNull()
  })

  it('respeta una duración custom', () => {
    const ui = useUiStore()

    ui.mostrarToast('Rápido', 'info', 500)
    vi.advanceTimersByTime(499)
    expect(ui.toast).not.toBeNull()

    vi.advanceTimersByTime(1)
    expect(ui.toast).toBeNull()
  })

  it('un segundo toast reinicia el timer del primero (no se cortan a mitad de camino)', () => {
    const ui = useUiStore()

    ui.mostrarToast('Toast A') // dispara a los 3000ms desde t=0
    vi.advanceTimersByTime(2000) // t=2000, A sigue visible

    ui.mostrarToast('Toast B') // reinicia: dispara a los 3000ms desde t=2000 (t=5000 total)
    expect(ui.toast.mensaje).toBe('Toast B')

    vi.advanceTimersByTime(2000) // t=4000 total: si el timer de A no se hubiese
    // cancelado, ya habría disparado en t=3000 y esto fallaría.
    expect(ui.toast).not.toBeNull()
    expect(ui.toast.mensaje).toBe('Toast B')

    vi.advanceTimersByTime(1000) // t=5000 total: ahora sí vence el de B
    expect(ui.toast).toBeNull()
  })
  describe('estado de conexión', () => {
    it('arranca sin problema de conexión', () => {
      const ui = useUiStore()
      expect(ui.problemaConexion).toBeNull()
    })

    it('sin red en el navegador: "Sin conexión"', () => {
      const ui = useUiStore()
      ui.setNavegadorOnline(false)
      expect(ui.problemaConexion).toBe('Sin conexión')
    })

    it('con red pero el servidor no responde: "Sin conexión con el servidor"', () => {
      const ui = useUiStore()
      ui.setServidorAlcanzable(false)
      expect(ui.problemaConexion).toBe('Sin conexión con el servidor')
    })

    it('sin red tiene prioridad sobre el servidor caído', () => {
      const ui = useUiStore()
      ui.setServidorAlcanzable(false)
      ui.setNavegadorOnline(false)
      expect(ui.problemaConexion).toBe('Sin conexión')
    })

    it('al volver la red se asume el servidor alcanzable hasta el próximo pedido', () => {
      const ui = useUiStore()
      ui.setServidorAlcanzable(false)
      ui.setNavegadorOnline(false)

      ui.setNavegadorOnline(true)

      expect(ui.problemaConexion).toBeNull()
    })
  })
})
