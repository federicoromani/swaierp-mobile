// Fechas que manda el backend: timestamps de PostgreSQL ("2026-10-16
// 10:23:11.5", con espacio — Safari no los parsea así) o, en algunos mocks y
// pantallas viejas, "dd/mm/aaaa". Todo lo que no se reconoce devuelve null y
// cada caller decide qué mostrar.

const DIA_MS = 24 * 60 * 60 * 1000

/** @returns {Date|null} */
export function parseFechaServidor(valor) {
  if (!valor) return null
  const texto = String(valor).trim()
  let fecha = null
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
    fecha = new Date(texto.length === 10 ? `${texto}T00:00:00` : texto.replace(' ', 'T'))
  } else {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto)
    if (m) fecha = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  }
  return fecha && !Number.isNaN(fecha.getTime()) ? fecha : null
}

function inicioDelDia(fecha) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
}

/**
 * Días calendario entre la fecha y hoy (0 = hoy). null si no se puede saber.
 */
export function diasDesde(valor, ahora = new Date()) {
  const fecha = parseFechaServidor(valor)
  if (!fecha) return null
  return Math.max(0, Math.round((inicioDelDia(ahora) - inicioDelDia(fecha)) / DIA_MS))
}

/**
 * "hoy", "ayer", "hace 5 días", "hace 3 meses"... Sin fecha: "nunca". Fecha
 * en formato desconocido: el texto tal cual (mejor que esconderlo).
 */
export function textoRelativo(valor, ahora = new Date()) {
  if (!valor) return 'nunca'
  const dias = diasDesde(valor, ahora)
  if (dias === null) return String(valor)
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 30) return `hace ${dias} días`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return meses === 1 ? 'hace 1 mes' : `hace ${meses} meses`
  return 'hace más de un año'
}

/**
 * Para listas de movimientos: "hoy 10:23", "ayer 18:05", "hace 3 días".
 * Fecha desconocida: el texto tal cual.
 */
export function textoMovimiento(valor, ahora = new Date()) {
  const fecha = parseFechaServidor(valor)
  if (!fecha) return valor ? String(valor) : ''
  const relativo = textoRelativo(valor, ahora)
  const tieneHora = /\d{2}:\d{2}/.test(String(valor))
  if (tieneHora && (relativo === 'hoy' || relativo === 'ayer')) {
    const hh = String(fecha.getHours()).padStart(2, '0')
    const mm = String(fecha.getMinutes()).padStart(2, '0')
    return `${relativo} ${hh}:${mm}`
  }
  return relativo
}

/** "16/10/2026 10:23" (o sin hora si no la trae): para el detalle/tooltip. */
export function textoFechaCompleta(valor) {
  const fecha = parseFechaServidor(valor)
  if (!fecha) return valor ? String(valor) : ''
  const dd = (n) => String(n).padStart(2, '0')
  const dia = `${dd(fecha.getDate())}/${dd(fecha.getMonth() + 1)}/${fecha.getFullYear()}`
  return /\d{2}:\d{2}/.test(String(valor)) ? `${dia} ${dd(fecha.getHours())}:${dd(fecha.getMinutes())}` : dia
}

/**
 * Qué tan urgente es contar un producto según su último conteo:
 *   'nunca'    nunca se contó
 *   'critico'  hace más de 30 días
 *   'vencido'  hace más de `diasPendiente` días (el umbral de "pendiente")
 *   'al-dia'   contado hace poco
 *   null       fecha en formato desconocido
 */
export function urgenciaConteo(valor, diasPendiente = 7, ahora = new Date()) {
  if (!valor) return 'nunca'
  const dias = diasDesde(valor, ahora)
  if (dias === null) return null
  if (dias > 30) return 'critico'
  if (dias > diasPendiente) return 'vencido'
  return 'al-dia'
}
