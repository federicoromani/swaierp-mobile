// Factories de datos mockeados, con la forma exacta que esperan los stores
// reales (ver src/stores/*.js) — nombres de campo verificados leyendo el
// código, no adivinados. `overrides` pisa cualquier default puntual.

export function productoResultado(overrides = {}) {
  return {
    prod_id: 101,
    nombre: 'Tornillo autoperforante 3/4',
    codigo: 'TOR-034',
    marca: 'Fixser',
    stock_actual: 25,
    margen_pct: 35.5,
    ...overrides,
  }
}

export function productoDetalle(overrides = {}) {
  return {
    success: true,
    prod_id: 101,
    codigo: 'TOR-034',
    nombre: 'Tornillo autoperforante 3/4',
    categoria: 'Ferretería',
    ultimo_ajuste_precio: '12/08/2026',
    ultimo_conteo: '20/08/2026',
    stock_actual: 25,
    costo: 100,
    precio_venta: 155,
    ganancia_pct: 55,
    historial: [
      { tipo: 'precio', costo_anterior: 90, costo_nuevo: 100, fecha: '12/08/2026' },
      { tipo: 'stock', cantidad: -3, comentario: 'Venta mostrador', fecha: '10/08/2026' },
    ],
    ...overrides,
  }
}

export function pendienteItem(overrides = {}) {
  return {
    prod_id: 201,
    nombre: 'Tuerca hexagonal M8',
    ultimo_conteo: null,
    ...overrides,
  }
}

export function ajusteItem(overrides = {}) {
  return {
    prod_id: 301,
    nombre: 'Arandela plana 8mm',
    cantidad_ajustes: 4,
    ...overrides,
  }
}

export function proveedor(overrides = {}) {
  return { per_id: 1, per_nombre: 'Distribuidora Ferretera SA', ...overrides }
}

export function itemImportacionAplicable(overrides = {}) {
  return {
    prod_id: 401,
    codigo_detectado: 'TOR-034',
    nombre_detectado: 'Tornillo autoperforante 3/4',
    texto_original: 'TOR-034 TORNILLO AUTOPERF 3/4',
    aplicable: true,
    costo_actual: 100,
    precio_detectado: 120,
    precio_venta_actual: 180,
    margen_bajo: false,
    margen_proyectado_pct: 33.3,
    ...overrides,
  }
}

export function itemImportacionNoAplicable(overrides = {}) {
  return {
    prod_id: null,
    codigo_detectado: 'XYZ-999',
    nombre_detectado: null,
    texto_original: 'XYZ-999 PIEZA SIN IDENTIFICAR',
    aplicable: false,
    motivo_no_aplicable: 'Sin coincidencia de código en el catálogo.',
    costo_actual: 0,
    precio_detectado: 0,
    precio_venta_actual: 0,
    ...overrides,
  }
}

export function usuarioMock({ rol = 1, nombre = 'Empleada Demo' } = {}) {
  return { id: 1, rol, nombre }
}
