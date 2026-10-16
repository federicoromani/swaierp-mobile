// public.unidad.uni_abreviado viene como lo cargó cada comercio ("UNID",
// "Kg", "LTS"...). En pantalla se muestra la abreviatura corta de siempre.
const CORTAS = {
  u: 'u',
  un: 'u',
  und: 'u',
  unid: 'u',
  unidad: 'u',
  unidades: 'u',
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogramo: 'kg',
  kilogramos: 'kg',
  g: 'g',
  gr: 'g',
  grs: 'g',
  gramo: 'g',
  gramos: 'g',
  l: 'l',
  lt: 'l',
  lts: 'l',
  litro: 'l',
  litros: 'l',
  ml: 'ml',
  m: 'm',
  mt: 'm',
  mts: 'm',
  metro: 'm',
  metros: 'm',
  cm: 'cm',
}

/** "UNID" -> "u", "Kg" -> "kg". Sin unidad: "u". Desconocida: en minúsculas. */
export function unidadCorta(unidad) {
  if (!unidad) return 'u'
  const clave = String(unidad).trim().toLowerCase().replace(/\.$/, '')
  return CORTAS[clave] ?? clave
}

/** Las unidades sueltas no se fraccionan (teclado sin coma). */
export function esUnidadEntera(unidad) {
  return unidadCorta(unidad) === 'u'
}
