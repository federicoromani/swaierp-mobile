import { describe, it, expect } from 'vitest'
import { parseFechaServidor, diasDesde, textoRelativo, urgenciaConteo } from '../../../src/utils/fechas'

// "Hoy" fijo para que los tests no dependan del reloj.
const AHORA = new Date(2026, 9, 16, 12, 0, 0) // 16/10/2026 12:00

describe('utils/fechas', () => {
  describe('parseFechaServidor', () => {
    it('timestamp de PostgreSQL con espacio y fracción (Safari no lo parsea así)', () => {
      const f = parseFechaServidor('2026-10-16 09:30:11.123456')
      expect(f.getFullYear()).toBe(2026)
      expect(f.getMonth()).toBe(9)
      expect(f.getDate()).toBe(16)
      expect(f.getHours()).toBe(9)
    })

    it('fecha sola ISO y dd/mm/aaaa', () => {
      expect(parseFechaServidor('2026-08-15').getDate()).toBe(15)
      const dmy = parseFechaServidor('20/08/2026')
      expect([dmy.getDate(), dmy.getMonth(), dmy.getFullYear()]).toEqual([20, 7, 2026])
    })

    it('vacío o formato desconocido: null', () => {
      expect(parseFechaServidor(null)).toBeNull()
      expect(parseFechaServidor('')).toBeNull()
      expect(parseFechaServidor('ayer')).toBeNull()
    })
  })

  describe('diasDesde / textoRelativo', () => {
    it('cuenta días calendario, no horas (ayer a la noche = 1 día)', () => {
      expect(diasDesde('2026-10-15 23:59:00', AHORA)).toBe(1)
      expect(diasDesde('2026-10-16 00:01:00', AHORA)).toBe(0)
    })

    it.each([
      [null, 'nunca'],
      ['2026-10-16 08:00:00', 'hoy'],
      ['2026-10-15 08:00:00', 'ayer'],
      ['2026-10-04 08:00:00', 'hace 12 días'],
      ['2026-09-10 08:00:00', 'hace 1 mes'],
      ['2026-06-01 08:00:00', 'hace 4 meses'],
      ['2025-01-01 08:00:00', 'hace más de un año'],
      ['formato raro', 'formato raro'],
    ])('%s → %s', (valor, esperado) => {
      expect(textoRelativo(valor, AHORA)).toBe(esperado)
    })
  })

  describe('urgenciaConteo', () => {
    it.each([
      [null, 'nunca'],
      ['2026-10-14 08:00:00', 'al-dia'],
      ['2026-10-09 08:00:00', 'al-dia'], // 7 días justos: todavía no es pendiente
      ['2026-10-08 08:00:00', 'vencido'],
      ['2026-09-01 08:00:00', 'critico'],
      ['formato raro', null],
    ])('%s → %s', (valor, esperado) => {
      expect(urgenciaConteo(valor, 7, AHORA)).toBe(esperado)
    })
  })
})
