import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as reportesService from '../services/reportesService'
import { urgenciaConteo } from '../utils/fechas'

// Días sin contar a partir de los cuales un producto figura como pendiente.
export const DIAS_PENDIENTE = 7

// Contador de "contados hoy" del dispositivo (para el progreso del día en
// Buscar). Es solo una ayuda visual: si el storage no anda, arranca en 0.
const CLAVE_CONTEOS_HOY = 'swaierp.conteosHoy'

function hoyLocal() {
  const d = new Date()
  const dd = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`
}

function leerConteosHoy() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_CONTEOS_HOY) || 'null')
    return guardado && guardado.fecha === hoyLocal() ? Number(guardado.cantidad) || 0 : 0
  } catch {
    return 0
  }
}

export const useReportesStore = defineStore('reportes', () => {
  const pendientes = ref({ items: [], total: 0 })
  const ajustes = ref({ items: [], total: 0 })
  const cargando = ref(false)
  // La lista de pendientes ya se pidió al menos una vez con el filtro actual:
  // al volver del modo conteo se conserva (y la posición) en vez de recargar.
  const pendientesCargados = ref(false)
  // Filtro por categoría (hoja) para contar un estante de una vez. null = todas.
  const filtroCategoria = ref(null)
  const categorias = ref([])
  const conteosHoy = ref(leerConteosHoy())

  async function cargarPendientes(offset = 0) {
    cargando.value = true
    try {
      const data = await reportesService.pendientesControlar(DIAS_PENDIENTE, 20, offset, filtroCategoria.value)
      if (!data.success) return
      pendientes.value = {
        items: offset === 0 ? data.items : [...pendientes.value.items, ...data.items],
        // El backend solo recalcula "total" en la primera página (offset 0):
        // en "cargar más" mantenemos el que ya teníamos.
        total: offset === 0 ? data.total : pendientes.value.total,
      }
      pendientesCargados.value = true
    } finally {
      cargando.value = false
    }
  }

  // El filtro es un extra: si no carga, la lista sigue andando sin chips (y
  // el aviso de conexión del header ya informa si fue la red).
  async function cargarCategorias() {
    try {
      const data = await reportesService.categoriasPendientes(DIAS_PENDIENTE)
      if (data.success) categorias.value = data.items
    } catch {
      // sin chips
    }
  }

  async function filtrarPorCategoria(categoriaId) {
    if (filtroCategoria.value === categoriaId && pendientesCargados.value) return
    filtroCategoria.value = categoriaId
    pendientes.value = { items: [], total: 0 }
    pendientesCargados.value = false
    await cargarPendientes(0)
  }

  /** "Actualizar": vuelve a pedir la lista (con el filtro actual) y los chips. */
  async function recargarPendientes() {
    await Promise.all([cargarPendientes(0), cargarCategorias()])
  }

  async function cargarAjustes(offset = 0) {
    cargando.value = true
    try {
      const data = await reportesService.ajustesFrecuentes(30, 20, offset)
      if (!data.success) return
      ajustes.value = {
        items: offset === 0 ? data.items : [...ajustes.value.items, ...data.items],
        total: offset === 0 ? data.total : ajustes.value.total,
      }
    } finally {
      cargando.value = false
    }
  }

  /**
   * Refleja un conteo recién registrado sin volver a pedir el reporte (la
   * consulta del total es cara): lo saca de la lista cargada y descuenta el
   * total (y el de su categoría) si el producto estaba pendiente, esté o no
   * en la página cargada.
   *
   * @param {number} prodId
   * @param {string|null|undefined} conteoAnterior ultimo_conteo antes de
   *   contar; undefined = no se conoce.
   * @param {number|null|undefined} categoriaId
   */
  function marcarContado(prodId, conteoAnterior, categoriaId) {
    sumarConteoHoy()
    const items = pendientes.value.items
    const item = items.find((p) => p.prod_id === prodId)
    const urgencia = conteoAnterior === undefined ? null : urgenciaConteo(conteoAnterior, DIAS_PENDIENTE)
    const estabaPendiente = !!item || ['nunca', 'vencido', 'critico'].includes(urgencia)
    if (!estabaPendiente) return

    // Con filtro, el total es el de la categoría: solo se descuenta si el
    // producto es de esa categoría (o si estaba en la lista filtrada).
    const cat = item?.categoria_id ?? categoriaId
    const cuentaEnElTotal = !!item || filtroCategoria.value === null || filtroCategoria.value === cat
    pendientes.value = {
      items: items.filter((p) => p.prod_id !== prodId),
      total: cuentaEnElTotal ? Math.max(0, pendientes.value.total - 1) : pendientes.value.total,
    }
    if (cat != null) {
      categorias.value = categorias.value
        .map((c) => (c.categoria_id === cat ? { ...c, pendientes: c.pendientes - 1 } : c))
        .filter((c) => c.pendientes > 0)
    }
  }

  /**
   * Un producto que dejó de estar disponible en la app (no controla stock):
   * se saca de la lista cargada sin contarlo como contado.
   */
  function quitarPendiente(prodId) {
    const item = pendientes.value.items.find((p) => p.prod_id === prodId)
    if (!item) return
    pendientes.value = {
      items: pendientes.value.items.filter((p) => p.prod_id !== prodId),
      total: Math.max(0, pendientes.value.total - 1),
    }
    if (item.categoria_id != null) {
      categorias.value = categorias.value
        .map((c) => (c.categoria_id === item.categoria_id ? { ...c, pendientes: c.pendientes - 1 } : c))
        .filter((c) => c.pendientes > 0)
    }
  }

  function sumarConteoHoy() {
    // Si quedó abierta de un día para el otro, el contador vuelve a 0.
    conteosHoy.value = leerConteosHoy() + 1
    try {
      localStorage.setItem(CLAVE_CONTEOS_HOY, JSON.stringify({ fecha: hoyLocal(), cantidad: conteosHoy.value }))
    } catch {
      // sin storage: el contador vive solo en memoria
    }
  }

  return {
    pendientes,
    ajustes,
    cargando,
    pendientesCargados,
    filtroCategoria,
    categorias,
    conteosHoy,
    cargarPendientes,
    recargarPendientes,
    cargarCategorias,
    filtrarPorCategoria,
    cargarAjustes,
    marcarContado,
    quitarPendiente,
  }
})
