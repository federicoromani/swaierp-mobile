import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as reportesService from '../services/reportesService'

// Días sin contar a partir de los cuales un producto figura como pendiente.
export const DIAS_PENDIENTE = 7

// ultimo_conteo llega como timestamp de PostgreSQL ("2026-10-16 10:23:11.5"),
// que Safari no parsea con espacio: se normaliza a ISO. Formato desconocido
// = no se puede saber (null), y el caller decide qué hacer.
function conteoVencido(ultimoConteo, dias) {
  if (!ultimoConteo) return true
  const fecha = /^\d{4}-\d{2}-\d{2}/.test(ultimoConteo) ? new Date(String(ultimoConteo).replace(' ', 'T')) : null
  if (!fecha || Number.isNaN(fecha.getTime())) return null
  return Date.now() - fecha.getTime() > dias * 24 * 60 * 60 * 1000
}

export const useReportesStore = defineStore('reportes', () => {
  const pendientes = ref({ items: [], total: 0 })
  const ajustes = ref({ items: [], total: 0 })
  const cargando = ref(false)

  async function cargarPendientes(offset = 0) {
    cargando.value = true
    try {
      const data = await reportesService.pendientesControlar(DIAS_PENDIENTE, 20, offset)
      if (!data.success) return
      pendientes.value = {
        items: offset === 0 ? data.items : [...pendientes.value.items, ...data.items],
        // El backend solo recalcula "total" en la primera página (offset 0):
        // en "cargar más" mantenemos el que ya teníamos.
        total: offset === 0 ? data.total : pendientes.value.total,
      }
    } finally {
      cargando.value = false
    }
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
   * total si el producto estaba pendiente, esté o no en la página cargada.
   *
   * @param {number} prodId
   * @param {string|null|undefined} conteoAnterior ultimo_conteo antes de
   *   contar; undefined = no se conoce.
   */
  function marcarContado(prodId, conteoAnterior) {
    const items = pendientes.value.items
    const enLista = items.some((p) => p.prod_id === prodId)
    const estabaPendiente = enLista || (conteoAnterior !== undefined && conteoVencido(conteoAnterior, DIAS_PENDIENTE) === true)
    if (!estabaPendiente) return
    pendientes.value = {
      items: items.filter((p) => p.prod_id !== prodId),
      total: Math.max(0, pendientes.value.total - 1),
    }
  }

  return { pendientes, ajustes, cargando, cargarPendientes, cargarAjustes, marcarContado }
})
