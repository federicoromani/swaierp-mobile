import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { comprimirSiEsImagen } from '../../../src/composables/useCompresionImagen'

// jsdom no implementa HTMLCanvasElement.getContext/toBlob ni
// window.createImageBitmap (ver docs/testing/plan-agente-1-unit.md, problema
// de testabilidad #3). Se mockean acá, LOCAL a este archivo, sin tocar
// tests/setup.js: interceptamos document.createElement solo para 'canvas' y
// dejamos pasar cualquier otra etiqueta al createElement real (por si Vue
// Test Utils lo necesitara en algún otro spec del mismo proceso).
function crearCanvasFake(blobDevuelto) {
  const ctx = { drawImage: vi.fn() }
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((callback, _tipo, _calidad) => callback(blobDevuelto)),
    _ctx: ctx,
  }
}

describe('composables/useCompresionImagen', () => {
  let createElementOriginal
  let canvasFake

  beforeEach(() => {
    createElementOriginal = document.createElement.bind(document)
    canvasFake = crearCanvasFake(new Blob(['jpg'], { type: 'image/jpeg' }))
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') return canvasFake
      return createElementOriginal(tag)
    })
    delete window.createImageBitmap
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete window.createImageBitmap
  })

  it('si el archivo no es imagen (ej. PDF), lo devuelve sin tocar canvas ni createImageBitmap', async () => {
    window.createImageBitmap = vi.fn()
    const archivo = new File(['contenido'], 'lista.pdf', { type: 'application/pdf' })

    const resultado = await comprimirSiEsImagen(archivo)

    expect(resultado).toBe(archivo)
    expect(window.createImageBitmap).not.toHaveBeenCalled()
  })

  it('si el archivo no tiene type (edge case de algunos navegadores/OS), lo devuelve sin tocar nada', async () => {
    const archivo = new File(['contenido'], 'raro', { type: '' })

    const resultado = await comprimirSiEsImagen(archivo)

    expect(resultado).toBe(archivo)
  })

  it('con file null/undefined, devuelve el mismo valor sin explotar', async () => {
    await expect(comprimirSiEsImagen(null)).resolves.toBeNull()
    await expect(comprimirSiEsImagen(undefined)).resolves.toBeUndefined()
  })

  it('redimensiona proporcionalmente cuando el lado más largo supera maxDim', async () => {
    window.createImageBitmap = vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() })
    const archivo = new File(['img'], 'foto.png', { type: 'image/png' })

    await comprimirSiEsImagen(archivo, { maxDim: 2000 })

    // escala = min(1, 2000/4000) = 0.5 -> 2000x1500
    expect(canvasFake.width).toBe(2000)
    expect(canvasFake.height).toBe(1500)
    expect(canvasFake._ctx.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 4000, height: 3000 }),
      0,
      0,
      2000,
      1500
    )
  })

  it('NO agranda una imagen más chica que maxDim (la escala nunca supera 1)', async () => {
    window.createImageBitmap = vi.fn().mockResolvedValue({ width: 500, height: 300, close: vi.fn() })
    const archivo = new File(['img'], 'foto.png', { type: 'image/png' })

    await comprimirSiEsImagen(archivo, { maxDim: 2000 })

    expect(canvasFake.width).toBe(500)
    expect(canvasFake.height).toBe(300)
  })

  it('devuelve un File nuevo .jpg/image/jpeg conservando el nombre base', async () => {
    window.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() })
    const archivo = new File(['img'], 'foto.final.png', { type: 'image/png' })

    const resultado = await comprimirSiEsImagen(archivo)

    expect(resultado).toBeInstanceOf(File)
    expect(resultado.name).toBe('foto.final.jpg')
    expect(resultado.type).toBe('image/jpeg')
  })

  it('usa la calidad pasada por opciones al llamar canvas.toBlob', async () => {
    window.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() })
    const archivo = new File(['img'], 'foto.png', { type: 'image/png' })

    await comprimirSiEsImagen(archivo, { calidad: 0.4 })

    expect(canvasFake.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.4)
  })

  it('si canvas.toBlob resuelve null (no se pudo comprimir), devuelve el archivo original', async () => {
    canvasFake.toBlob = vi.fn((callback) => callback(null))
    window.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() })
    const archivo = new File(['img'], 'foto.png', { type: 'image/png' })

    const resultado = await comprimirSiEsImagen(archivo)

    expect(resultado).toBe(archivo)
  })

  it('llama bitmap.close() cuando existe (cleanup en la rama de createImageBitmap)', async () => {
    const close = vi.fn()
    window.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100, close })
    const archivo = new File(['img'], 'foto.png', { type: 'image/png' })

    await comprimirSiEsImagen(archivo)

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('sin window.createImageBitmap, usa el fallback de Image + URL.createObjectURL', async () => {
    // jsdom soporta `new Image()` pero no dispara onload real (no hay carga
    // de red real de un blob: URL) -> se reemplaza el constructor global
    // Image por uno fake que dispara onload en el siguiente microtask.
    class ImagenFake {
      constructor() {
        this.width = 800
        this.height = 600
      }

      set src(_valor) {
        Promise.resolve().then(() => this.onload && this.onload())
      }
    }
    vi.stubGlobal('Image', ImagenFake)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url')
    const archivo = new File(['img'], 'foto.png', { type: 'image/png' })

    const resultado = await comprimirSiEsImagen(archivo, { maxDim: 400 })

    expect(URL.createObjectURL).toHaveBeenCalledWith(archivo)
    expect(resultado.name).toBe('foto.jpg')
    // escala = min(1, 400/800) = 0.5 -> 400x300
    expect(canvasFake.width).toBe(400)
    expect(canvasFake.height).toBe(300)
  })
})
