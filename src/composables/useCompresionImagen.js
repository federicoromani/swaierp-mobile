/**
 * Redimensiona (lado más largo a maxDim) y reencodea a JPEG (calidad q) vía
 * canvas, SOLO si el archivo es una imagen — mitigación del límite de
 * subida del backend (una foto de celular a resolución completa puede
 * superar varios MB fácil). PDF/Excel/CSV pasan sin tocar.
 *
 * @param {File} file
 * @param {{maxDim?: number, calidad?: number}} opciones
 * @returns {Promise<File>}
 */
export async function comprimirSiEsImagen(file, { maxDim = 2000, calidad = 0.8 } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return file
  }

  const bitmap = await cargarBitmap(file)
  const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const ancho = Math.round(bitmap.width * escala)
  const alto = Math.round(bitmap.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, ancho, alto)
  if (bitmap.close) {
    bitmap.close()
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad))
  if (!blob) {
    // No se pudo comprimir (navegador raro, imagen corrupta): mejor subir el
    // original que fallar silenciosamente la selección de archivo.
    return file
  }

  const nombreBase = file.name.replace(/\.[^.]+$/, '')
  return new File([blob], `${nombreBase}.jpg`, { type: 'image/jpeg' })
}

function cargarBitmap(file) {
  if (window.createImageBitmap) {
    return window.createImageBitmap(file)
  }
  // Fallback para navegadores sin createImageBitmap (Safari viejo).
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}
