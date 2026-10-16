import { describe, it, expect, afterEach, vi } from 'vitest'
import { crearLector, mensajeErrorCamara, FORMATOS } from '../../../src/utils/lectorCodigos'

describe('utils/lectorCodigos', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('con BarcodeDetector nativo lo usa, solo con los formatos que soporta', async () => {
    const creado = vi.fn()
    class BarcodeDetectorFake {
      static getSupportedFormats = vi.fn().mockResolvedValue(['ean_13', 'qr_code', 'aztec'])
      constructor(opciones) {
        creado(opciones)
      }
    }
    vi.stubGlobal('BarcodeDetector', BarcodeDetectorFake)

    const lector = await crearLector()

    expect(lector).toBeInstanceOf(BarcodeDetectorFake)
    expect(creado).toHaveBeenCalledWith({ formats: ['ean_13', 'qr_code'] })
  })

  it('pide los formatos de góndola (EAN/UPC) y los internos habituales', () => {
    expect(FORMATOS).toEqual(expect.arrayContaining(['ean_13', 'ean_8', 'upc_a', 'code_128']))
  })

  it.each([
    ['NotAllowedError', 'No hay permiso para usar la cámara'],
    ['NotFoundError', 'No se encontró una cámara'],
    ['NotReadableError', 'otra app'],
    ['SinSoporte', 'https'],
    ['CualquierOtro', 'No se pudo abrir la cámara.'],
  ])('%s → mensaje claro', (name, texto) => {
    expect(mensajeErrorCamara({ name })).toContain(texto)
  })
})
