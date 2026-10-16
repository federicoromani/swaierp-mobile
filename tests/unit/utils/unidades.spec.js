import { describe, it, expect } from 'vitest'
import { unidadCorta, esUnidadEntera } from '../../../src/utils/unidades'

describe('utils/unidades', () => {
  it.each([
    ['UNID', 'u'],
    ['Unidades', 'u'],
    ['un.', 'u'],
    ['Kg', 'kg'],
    ['KGS', 'kg'],
    ['gr', 'g'],
    ['LTS', 'l'],
    ['mts', 'm'],
    ['ml', 'ml'],
  ])('unidadCorta(%s) → %s', (cruda, corta) => {
    expect(unidadCorta(cruda)).toBe(corta)
  })

  it('sin unidad: "u"; desconocida: en minúsculas tal cual', () => {
    expect(unidadCorta(null)).toBe('u')
    expect(unidadCorta('')).toBe('u')
    expect(unidadCorta('BOLSA')).toBe('bolsa')
  })

  it('solo las unidades sueltas son enteras (teclado sin coma)', () => {
    expect(esUnidadEntera('UNID')).toBe(true)
    expect(esUnidadEntera(undefined)).toBe(true)
    expect(esUnidadEntera('kg')).toBe(false)
    expect(esUnidadEntera('LTS')).toBe(false)
  })
})
