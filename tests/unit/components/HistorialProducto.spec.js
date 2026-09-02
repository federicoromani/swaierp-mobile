import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HistorialProducto from '../../../src/components/HistorialProducto.vue'

describe('components/HistorialProducto', () => {
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
    expect(wrapper.text()).toContain('2026-08-20')
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

  it('usa el ícono fa-tag para tipo precio y fa-clipboard-check para el resto', () => {
    const wrapper = mount(HistorialProducto, {
      props: {
        items: [
          { tipo: 'precio', costo_anterior: 1, costo_nuevo: 2, fecha: 'f1' },
          { tipo: 'stock', cantidad: 1, fecha: 'f2' },
        ],
      },
    })

    const iconos = wrapper.findAll('i.fas')
    expect(iconos[0].classes()).toContain('fa-tag')
    expect(iconos[1].classes()).toContain('fa-clipboard-check')
  })
})
