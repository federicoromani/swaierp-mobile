import Dexie from 'dexie'

/**
 * Base local (IndexedDB vía Dexie) para:
 *  - sesion: el refresh token (el access token vive solo en memoria, en el
 *    store de auth — nunca en IndexedDB).
 *  - catalogoCache: último resultado de búsqueda/detalle visto, para que la
 *    búsqueda siga sirviendo algo sin conexión (NetworkFirst de Workbox ya
 *    cubre la respuesta HTTP cruda; esto es el fallback cuando ni eso hay).
 *
 * Las mutaciones (precio/stock) NO se encolan acá para reintento automático
 * en background: un ajuste de stock manda un valor absoluto calculado contra
 * lo que el usuario vio en pantalla, y reintentarlo solo horas después
 * arriesga pisar ventas/compras que movieron el stock mientras tanto (ver
 * nota en vite.config.js). Si falla, el error se muestra y los campos del
 * formulario quedan con lo tipeado — "reintentar" es simplemente volver a
 * tocar Guardar.
 */
export const db = new Dexie('swaierp-mobile')

db.version(1).stores({
  sesion: 'clave',
  catalogoCache: 'prod_id, nombre, codigo',
})
