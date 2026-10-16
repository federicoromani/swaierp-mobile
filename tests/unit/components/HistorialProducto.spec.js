import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HistorialProducto from '../../../src/components/HistorialProducto.vue'

describe('components/HistorialProducto', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('sin items muestra el estado vacío', () => {
    const wrapper = mount(HistorialProducto, { props: { items: [] } })

    expect(wrapper.text()).toContain('Todavía no hay movimientos.')
  })

  it('con prop items por default (no pasada), no explota y muestra el estado vacío', () => {
    const wrapper = mount(HistorialProducto)

    expect(wrapper.text()).toContain('Todavía no hay movimientos.')
  })

  it('item tipo "precio" arma "Costo $X → $Y" formateado es-AR', () => {
    const wrapper = mount(HistorialProducto, {
      props: {
        items: [{ tipo: 'precio', costo_anterior: 1000, costo_nuevo: 1500.7, fecha: '2026-08-20' }],
      },
    })

    expect(wrapper.text()).toContain('Costo $1.000 → $1.501')
  })

  it('fechas relativas ("hoy 10:23", "hace 1 mes") con la fecha completa en el title', () => {
    const wrapper = mount(HistorialProducto, {
      props: {
        items: [
          { tipo: 'stock', cantidad: 1, fecha: '2026-10-16 10:23:11.5' },
          { tipo: 'stock', cantidad: 1, fecha: '2026-10-15 18:05:00' },
          { tipo: 'stock', cantidad: 1, fecha: '2026-08-20' },
        ],
      },
    })
    const fechas = wrapper.findAll('p[title]')

    expect(fechas[0].text()).toBe('hoy 10:23')
    expect(fechas[0].attributes('title')).toBe('16/10/2026 10:23')
    expect(fechas[1].text()).toBe('ayer 18:05')
    expect(fechas[2].text()).toBe('hace 1 mes')
    expect(fechas[2].attributes('title')).toBe('20/08/2026')
  })

  it('muestra los últimos 5 y el resto con "Ver más"', async () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ tipo: 'stock', cantidad: i + 1, fecha: '2026-10-16' }))
    const wrapper = mount(HistorialProducto, { props: { items } })

    expect(wrapper.text()).toContain('Ajuste de stock: +5')
    expect(wrapper.text()).not.toContain('Ajuste de stock: +6')

    await wrapper.findAll('button').find((b) => b.text() === 'Ver más (3)').trigger('click')
    expect(wrapper.text()).toContain('Ajuste de stock: +8')
    expect(wrapper.findAll('button').find((b) => b.text() === 'Ver menos').exists()).toBe(true)
  })

  it('item tipo stock con cantidad positiva muestra el signo "+" explícito', () => {
    const wrapper = mount(HistorialProducto, {
      props: { items: [{ tipo: 'stock', cantidad: 5, fecha: '2026-08-21' }] },
    })

    expect(wrapper.text()).toContain('Ajuste de stock: +5')
  })

  it('item tipo stock con cantidad negativa NO duplica el signo', () => {
    const wrapper = mount(HistorialProducto, {
      props: { items: [{ tipo: 'stock', cantidad: -3, fecha: '2026-08-21' }] },
    })

    expect(wrapper.text()).toContain('Ajuste de stock: -3')
    expect(wrapper.text()).not.toContain('+-3')
  })

  it('item con comentario lo agrega al final separado por " · "', () => {
    const wrapper = mount(HistorialProducto, {
      props: { items: [{ tipo: 'stock', cantidad: 2, comentario: 'Conteo mensual', fecha: '2026-08-21' }] },
    })

    expect(wrapper.text()).toContain('Ajuste de stock: +2 · Conteo mensual')
  })

  it('item sin comentario no agrega el separador', () => {
    const wrapper = mount(HistorialProducto, {
      props: { items: [{ tipo: 'stock', cantidad: 2, fecha: '2026-08-21' }] },
    })

    expect(wrapper.text()).not.toContain('·')
  })

  it('ícono por tipo y sentido: precio, conteo sin diferencias, entrada y salida', () => {
    const wrapper = mount(HistorialProducto, {
      props: {
        items: [
          { tipo: 'precio', costo_anterior: 1, costo_nuevo: 2, fecha: 'f1' },
          { tipo: 'conteo', cantidad: 0, stock_sistema: 5, stock_contado: 5, fecha: 'f2' },
          { tipo: 'stock', cantidad: 1, fecha: 'f3' },
          { tipo: 'conteo', cantidad: -2, stock_sistema: 5, stock_contado: 3, fecha: 'f4' },
        ],
      },
    })

    const iconos = wrapper.findAll('i.fas')
    expect(iconos[0].classes()).toContain('fa-tag')
    expect(iconos[1].classes()).toContain('fa-check')
    expect(iconos[2].classes()).toContain('fa-arrow-up')
    expect(iconos[3].classes()).toContain('fa-arrow-down')
    expect(wrapper.findAll('.sr-only').map((e) => e.text())).toEqual(['Precio', 'Conteo sin diferencias', 'Entrada', 'Salida'])
  })

  it('conteo sin diferencias: lo dice y muestra lo contado', () => {
    const wrapper = mount(HistorialProducto, {
      props: { items: [{ tipo: 'conteo', cantidad: 0, stock_sistema: 25, stock_contado: 25, fecha: 'f' }] },
    })
    expect(wrapper.text()).toContain('Conteo: sin diferencias (25)')
  })

  it('conteo con diferencia: muestra el signo y sistema → contado', () => {
    const wrapper = mount(HistorialProducto, {
      props: { items: [{ tipo: 'conteo', cantidad: -3, stock_sistema: 25, stock_contado: 22, fecha: 'f' }] },
    })
    expect(wrapper.text()).toContain('Conteo: -3 (sistema 25 → 22)')
  })
})
