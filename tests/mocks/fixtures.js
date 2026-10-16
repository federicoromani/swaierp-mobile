// Datos base reutilizables para los tests de integración. Sin lógica de
// HTTP acá (eso vive en handlers.js) — cada fixture es una función
// `(overrides) => objeto` para poder pisar un campo puntual sin repetir el
// objeto entero en cada test.
//
// Las formas siguen el CONTRATO REAL del backend (swaidemo/apps/api_*.php),
// documentado en docs/testing/plan-agente-2-integration.md — no son
// inventadas.

export function usuarioAdmin(overrides = {}) {
  return { id: 1, nombre: 'Ana Administradora', rol: 1, sucursal: 0, ...overrides }
}

export function usuarioAvanzado(overrides = {}) {
  return { id: 2, nombre: 'Beto Avanzado', rol: 2, sucursal: 0, ...overrides }
}

export function usuarioFiscal(overrides = {}) {
  return { id: 3, nombre: 'Cora Fiscal', rol: 3, sucursal: 0, ...overrides }
}

export function configDefault(overrides = {}) {
  return { margen_objetivo_pct: 30, ...overrides }
}

// Respuesta completa de action=login / action=refresh.
export function datosLogin(overrides = {}) {
  return {
    success: true,
    access_token: 'at-inicial',
    refresh_token: 'rt-inicial',
    expires_in: 900,
    usuario: usuarioAdmin(),
    config: configDefault(),
    ...overrides,
  }
}

export function datosRefresh(overrides = {}) {
  return {
    success: true,
    access_token: 'at-rotado',
    refresh_token: 'rt-rotado',
    expires_in: 900,
    ...overrides,
  }
}

// Item de action=buscar (productos).
export function itemBusqueda(overrides = {}) {
  return {
    prod_id: 101,
    codigo: 'COD101',
    nombre: 'Fideos Guaseta 500g',
    marca: 'Guaseta',
    categoria: 'Almacén',
    costo: 800,
    precio_venta: 1200,
    margen_pct: 33.3,
    ganancia_pct: 50,
    stock_actual: 24,
    ultimo_conteo: '2026-08-20',
    ultimo_ajuste_precio: '2026-08-15',
    ...overrides,
  }
}

export function resultadosBusquedaEjemplo() {
  return [
    itemBusqueda(),
    itemBusqueda({
      prod_id: 102,
      codigo: 'COD102',
      nombre: 'Fideos Guaseta 1kg',
      margen_pct: 18.5,
      stock_actual: 10,
    }),
  ]
}

// action=detalle: el item de búsqueda + historial.
export function productoEjemplo(overrides = {}) {
  const { historial, ...resto } = overrides
  return {
    success: true,
    ...itemBusqueda(resto),
    historial: historial ?? [
      { tipo: 'precio', fecha: '2026-08-15', costo_anterior: 750, costo_nuevo: 800 },
      { tipo: 'stock', fecha: '2026-08-20', cantidad: -3, comentario: 'Conteo físico' },
    ],
  }
}

export function itemPendienteEjemplo(overrides = {}) {
  return {
    prod_id: 201,
    nombre: 'Aceite Girasol 1.5L',
    codigo: 'COD201',
    ultimo_conteo: '2026-06-01',
    ...overrides,
  }
}

export function itemAjusteEjemplo(overrides = {}) {
  return {
    prod_id: 301,
    nombre: 'Yerba Amanda 1kg',
    codigo: 'COD301',
    cantidad_ajustes: 5,
    ...overrides,
  }
}

export function proveedorEjemplo(overrides = {}) {
  return { per_id: 401, per_nombre: 'Distribuidora del Centro', ...overrides }
}

export function itemAnalisisAplicable(overrides = {}) {
  return {
    texto_original: 'FIDEOS GUASETA 500 - 950.00',
    codigo_detectado: 'COD101',
    nombre_detectado: 'Fideos Guaseta 500g',
    precio_detectado: 950,
    prod_id: 101,
    metodo_match: 'codigo',
    costo_actual: 800,
    precio_venta_actual: 1200,
    margen_actual_pct: 33.3,
    margen_proyectado_pct: 20.8,
    margen_bajo: false,
    aplicable: true,
    motivo_no_aplicable: null,
    ...overrides,
  }
}

export function itemAnalisisNoAplicable(overrides = {}) {
  return {
    texto_original: 'ARTICULO SIN CODIGO - 500.00',
    codigo_detectado: null,
    nombre_detectado: null,
    precio_detectado: 500,
    prod_id: null,
    metodo_match: 'sin_match',
    costo_actual: null,
    precio_venta_actual: null,
    margen_actual_pct: null,
    margen_proyectado_pct: null,
    margen_bajo: false,
    aplicable: false,
    motivo_no_aplicable: 'No se encontró un producto que coincida en el catálogo.',
    ...overrides,
  }
}

export function respuestaAnalizarEjemplo(overrides = {}) {
  const items = overrides.items ?? [itemAnalisisAplicable(), itemAnalisisNoAplicable()]
  return {
    success: true,
    fuente: 'heuristica_csv',
    modelo_ia: null,
    sin_match: items.filter((i) => !i.aplicable).length,
    avisos: [],
    items,
    ...overrides,
    items,
  }
}

export function resumenConfirmacionEjemplo(overrides = {}) {
  return {
    success: true,
    aplicados: 1,
    rechazados: 0,
    detalle: [{ prod_id: 101, ok: true }],
    ...overrides,
  }
}
