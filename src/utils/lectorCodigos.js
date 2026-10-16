// Lector de códigos de barras: el BarcodeDetector nativo (Chrome Android) y,
// si el navegador no lo tiene (iOS, Firefox), el ponyfill con zxing-wasm. El
// ponyfill y su .wasm (~1 MB) se cargan recién la primera vez que se abre el
// escáner, y el .wasm se sirve desde la propia app (no desde un CDN).

// Los de góndola (EAN/UPC) + los internos habituales (Code 128/39, ITF) + QR.
export const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']

async function lectorNativo() {
  const Nativo = globalThis.BarcodeDetector
  if (!Nativo) return null
  try {
    const soportados = await Nativo.getSupportedFormats()
    const formatos = FORMATOS.filter((f) => soportados.includes(f))
    return formatos.length ? new Nativo({ formats: formatos }) : null
  } catch {
    return null
  }
}

async function lectorZxing() {
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({
    overrides: {
      locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    },
  })
  return new BarcodeDetector({ formats: FORMATOS })
}

/** @returns {Promise<{ detect(fuente: CanvasImageSource): Promise<Array<{ rawValue: string }>> }>} */
export async function crearLector() {
  return (await lectorNativo()) ?? (await lectorZxing())
}

/**
 * Mensaje para el usuario según por qué no se pudo abrir la cámara.
 * @param {unknown} error
 */
export function mensajeErrorCamara(error) {
  const nombre = error && typeof error === 'object' ? error.name : ''
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
    return 'No hay permiso para usar la cámara. Habilitalo en los ajustes del navegador.'
  }
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') {
    return 'No se encontró una cámara en este dispositivo.'
  }
  if (nombre === 'NotReadableError') {
    return 'La cámara está siendo usada por otra app.'
  }
  if (nombre === 'SinSoporte') {
    return 'Este navegador no permite usar la cámara (hace falta abrir la app con https).'
  }
  return 'No se pudo abrir la cámara.'
}
