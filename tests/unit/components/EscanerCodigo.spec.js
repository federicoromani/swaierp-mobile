import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import EscanerCodigo from '../../../src/components/EscanerCodigo.vue'
import { crearLector } from '../../../src/utils/lectorCodigos'

vi.mock('../../../src/utils/lectorCodigos', async (importOriginal) => ({
  ...(await importOriginal()),
  crearLector: vi.fn(),
}))

function crearStream() {
  const track = { stop: vi.fn() }
  return { track, stream: { getTracks: () => [track] } }
}

describe('components/EscanerCodigo', () => {
  let getUserMedia

  beforeEach(() => {
    vi.useFakeTimers()
    getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    // jsdom no implementa la reproducción de <video>.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: () => 4, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete HTMLMediaElement.prototype.readyState
  })

  it('al leer un código lo emite (sin espacios) y apaga la cámara', async () => {
    const { track, stream } = crearStream()
    getUserMedia.mockResolvedValue(stream)
    const detect = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ rawValue: ' 7790001234567 ' }])
    crearLector.mockResolvedValue({ detect })

    const wrapper = mount(EscanerCodigo)
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.any(Object), audio: false }))

    await vi.advanceTimersByTimeAsync(250)

    expect(wrapper.emitted('detectado')).toEqual([['7790001234567']])
    expect(track.stop).toHaveBeenCalled()
  })

  it('sin permiso de cámara muestra el motivo y "Buscar a mano" cierra', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    crearLector.mockResolvedValue({ detect: vi.fn() })

    const wrapper = mount(EscanerCodigo)
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('No hay permiso para usar la cámara')
    await wrapper.findAll('button').find((b) => b.text() === 'Buscar a mano').trigger('click')
    expect(wrapper.emitted('cerrar')).toHaveLength(1)
  })

  it('si falla el lector, la cámara que ya abrió se apaga', async () => {
    const { track, stream } = crearStream()
    getUserMedia.mockResolvedValue(stream)
    crearLector.mockRejectedValue(new Error('wasm'))

    const wrapper = mount(EscanerCodigo)
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(track.stop).toHaveBeenCalled()
  })

  it('cerrar apaga la cámara y emite "cerrar"', async () => {
    const { track, stream } = crearStream()
    getUserMedia.mockResolvedValue(stream)
    crearLector.mockResolvedValue({ detect: vi.fn().mockResolvedValue([]) })

    const wrapper = mount(EscanerCodigo)
    await flushPromises()
    await wrapper.find('button[aria-label="Cerrar escáner"]').trigger('click')

    expect(track.stop).toHaveBeenCalled()
    expect(wrapper.emitted('cerrar')).toHaveLength(1)
  })
})
