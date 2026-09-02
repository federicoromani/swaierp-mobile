// Helpers cortos para sembrar/limpiar Dexie (IndexedDB vía fake-indexeddb)
// entre tests. tests/setup.js registra fake-indexeddb como global una sola
// vez para todo el proceso, pero NO limpia las tablas entre tests — hay que
// hacerlo a mano en cada archivo (beforeEach/afterEach) para que un test no
// arrastre estado (refresh token, cache de catálogo) al siguiente.

import { db } from '../../src/offline/db'

const CLAVE_REFRESH = 'refresh_token'

export async function sembrarRefreshToken(valor) {
  await db.sesion.put({ clave: CLAVE_REFRESH, valor })
}

export async function leerRefreshTokenGuardado() {
  const registro = await db.sesion.get(CLAVE_REFRESH)
  return registro ? registro.valor : null
}

export async function sembrarCatalogoCache(items) {
  await db.catalogoCache.bulkPut(items)
}

export async function limpiarDb() {
  await Promise.all([db.sesion.clear(), db.catalogoCache.clear()])
}
