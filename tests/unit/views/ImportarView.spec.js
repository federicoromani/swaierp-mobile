import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { useImportacionPreciosStore } from '../../../src/stores/importacionPrecios'
import { useUiStore } from '../../../src/stores/ui'
import ImportarView from '../../../src/views/ImportarView.vue'

function itemBase(overrides = {}) {
  return {
    prod_id: 1,
    seleccionado: true,
    aplicable: true,
    nombre_detectado: 'Tornillo 3mm',
    texto_original: 'TORN 3MM',
    costo_actual: 100,
    precio_detectado: 120,
    precio_venta_actual: 200,
    margen_proyectado_pct: 40,
    motivo_no_aplicable: '',
    ...overrides,
  }
}

function montar({
  items = [],
  resumen = null,
  analizando = false,
  aplicando = false,
  sinMatch = 0,
  avisos = [],
  proveedores = [],
  error = '',
} = {}) {
  const pinia = createTestingPinia({
    stubActions: true,
    initialState: {
      importacionPrecios: {
        proveedores,
        proveedorSeleccionado: 0,
        items,
        sinMatch,
        fuente: '',
        avisos,
        cargandoProveedores: false,
        analizando,
        aplicando,
        error,
        resumen,
      },
      ui: { toast: null },
    },
  })
  const wrapper = mount(ImportarView, { global: { plugins: [pinia] } })
  const store = useImportacionPreciosStore()
  const ui = useUiStore()
  return { wrapper, store, ui }
}

function normalizado(wrapper) {
  return wrapper.text().replace(/\s+/g, ' ')
}

function botonPorTexto(wrapper, texto) {
  return wrapper.findAll('button').find((b) => b.text().includes(texto))
}

describe('views/ImportarView', () => {
  it('al montar, llama a store.cargarProveedores()', () => {
    const { store } = montar()
    expect(store.cargarProveedores).toHaveBeenCalledTimes(1)
  })

  it('seleccionar un archivo llama analizarArchivo y muestra el nombre', async () => {
    const { wrapper, store } = montar()
    const archivo = new File(['contenido'], 'lista.pdf', { type: 'application/pdf' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [archivo], configurable: true })

    await input.trigger('change')

    expect(store.analizarArchivo).toHaveBeenCalledWith(archivo)
    expect(wrapper.text()).toContain('lista.pdf')
  })

  it('el evento change sin archivo (cancelado) no llama analizarArchivo ni explota', async () => {
    const { wrapper, store } = montar()
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [], configurable: true })

    await input.trigger('change')

    expect(store.analizarArchivo).not.toHaveBeenCalled()
  })

  it('mientras analiza, muestra el spinner y no el resto de las secciones', () => {
    const { wrapper } = montar({ analizando: true })

    expect(wrapper.text()).toContain('Analizando el archivo...')
    expect(wrapper.text()).not.toContain('Importar lista de precios')
  })

  it('el botón de aplicar muestra la cantidad de seleccionados (seleccionado && prod_id)', () => {
    const items = [
      itemBase({ prod_id: 1, seleccionado: true }),
      itemBase({ prod_id: 2, seleccionado: false }),
      itemBase({ prod_id: null, seleccionado: true, aplicable: false, motivo_no_aplicable: 'Sin match' }),
    ]
    const { wrapper } = montar({ items })

    expect(wrapper.text()).toContain('Aplicar seleccionados (1)')
  })

  it('botón aplicar disabled si no hay seleccionados', () => {
    const items = [itemBase({ seleccionado: false })]
    const { wrapper } = montar({ items })

    expect(botonPorTexto(wrapper, 'Aplicar seleccionados').attributes('disabled')).toBeDefined()
  })

  it('botón aplicar disabled mientras aplicando=true, aunque haya seleccionados', () => {
    const items = [itemBase({ seleccionado: true })]
    const { wrapper } = montar({ items, aplicando: true })

    expect(botonPorTexto(wrapper, 'Aplicando...').attributes('disabled')).toBeDefined()
  })

  it('botón aplicar habilitado con seleccionados y sin aplicando en curso', () => {
    const items = [itemBase({ seleccionado: true })]
    const { wrapper } = montar({ items })

    expect(botonPorTexto(wrapper, 'Aplicar seleccionados').attributes('disabled')).toBeUndefined()
  })

  it('click en aplicar llama confirmarSeleccionados y, si queda un resumen, muestra un toast', async () => {
    const items = [itemBase({ seleccionado: true })]
    const { wrapper, store, ui } = montar({ items })
    store.confirmarSeleccionados.mockImplementation(async () => {
      store.resumen = { aplicados: 3, rechazados: 1 }
    })

    await botonPorTexto(wrapper, 'Aplicar seleccionados').trigger('click')
    await flushPromises()

    expect(store.confirmarSeleccionados).toHaveBeenCalledTimes(1)
    expect(ui.mostrarToast).toHaveBeenCalledWith('Se actualizaron 3 productos.', 'success')
  })

  it('click en aplicar sin resumen resultante (ej. falló) NO muestra ningún toast', async () => {
    const items = [itemBase({ seleccionado: true })]
    const { wrapper, store, ui } = montar({ items })
    store.confirmarSeleccionados.mockResolvedValue(undefined) // resumen queda null (default)

    await botonPorTexto(wrapper, 'Aplicar seleccionados').trigger('click')
    await flushPromises()

    expect(ui.mostrarToast).not.toHaveBeenCalled()
  })

  describe('vista de resumen', () => {
    it('singular cuando aplicados=1 y sin rechazados', () => {
      const { wrapper } = montar({ resumen: { aplicados: 1, rechazados: 0 } })
      const texto = normalizado(wrapper)

      expect(texto).toContain('1 producto actualizado')
      expect(texto).not.toContain('rechazado')
    })

    it('plural cuando aplicados>1 y muestra los rechazados si hay', () => {
      const { wrapper } = montar({ resumen: { aplicados: 3, rechazados: 2 } })
      const texto = normalizado(wrapper)

      expect(texto).toContain('3 productos actualizados')
      expect(texto).toContain('2 rechazados')
    })

    it('singular para 1 rechazado', () => {
      const { wrapper } = montar({ resumen: { aplicados: 5, rechazados: 1 } })
      const texto = normalizado(wrapper)

      expect(texto).toContain('1 rechazado')
      expect(texto).not.toContain('1 rechazados')
    })

    it('"Importar otra lista" llama a store.reiniciar()', async () => {
      const { wrapper, store } = montar({ resumen: { aplicados: 1, rechazados: 0 } })

      await botonPorTexto(wrapper, 'Importar otra lista').trigger('click')

      expect(store.reiniciar).toHaveBeenCalledTimes(1)
    })

    it('"Importar otra lista" limpia nombreArchivo (vuelve a mostrar el placeholder default, no el nombre del archivo anterior)', async () => {
      // nombreArchivo es un ref LOCAL de la vista (no del store), así que para
      // probar que se limpia hace falta haber pasado antes por la pantalla de
      // carga y haber seleccionado un archivo de verdad.
      const { wrapper, store } = montar()
      const archivoPrevio = new File(['contenido'], 'lista-vieja.csv', { type: 'text/csv' })
      const inputArchivo = wrapper.find('input[type="file"]')
      Object.defineProperty(inputArchivo.element, 'files', { value: [archivoPrevio], configurable: true })
      await inputArchivo.trigger('change')
      expect(wrapper.text()).toContain('lista-vieja.csv')

      // store.analizarArchivo() está stubeado: simulamos a mano que la vista
      // llegó a la pantalla de resumen (como pasaría en producción tras
      // analizar y confirmar), para poder mostrar el botón "Importar otra lista".
      store.resumen = { aplicados: 1, rechazados: 0 }
      await wrapper.vm.$nextTick()

      await botonPorTexto(wrapper, 'Importar otra lista').trigger('click')

      // store.reiniciar() también está stubeado (no muta estado real);
      // simulamos su efecto para volver a la pantalla de carga y poder
      // observar ahí que nombreArchivo (el ref local) se limpió.
      store.resumen = null
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).not.toContain('lista-vieja.csv')
      expect(wrapper.text()).toContain('JPG, PNG, PDF, XLSX o CSV')
    })
  })

  it('item no aplicable: checkbox disabled, muestra el motivo, no cuenta en seleccionados aunque seleccionado sea true', () => {
    const items = [
      itemBase({
        prod_id: null,
        seleccionado: true,
        aplicable: false,
        texto_original: 'Línea rara',
        motivo_no_aplicable: 'Sin código detectado',
      }),
    ]
    const { wrapper } = montar({ items })

    const checkbox = wrapper.find('input[type="checkbox"]')
    expect(checkbox.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Sin código detectado')
    expect(wrapper.text()).toContain('Aplicar seleccionados (0)')
  })

  it('destildar un item aplicable en el checklist baja el contador de seleccionados', async () => {
    const items = [itemBase({ prod_id: 1, seleccionado: true })]
    const { wrapper } = montar({ items })
    expect(wrapper.text()).toContain('Aplicar seleccionados (1)')

    await wrapper.find('input[type="checkbox"]').setValue(false)

    expect(wrapper.text()).toContain('Aplicar seleccionados (0)')
  })

  it('aviso de sinMatch: singular para 1, plural para varios', () => {
    const items = [itemBase()]
    const { wrapper: conUno } = montar({ items, sinMatch: 1 })
    expect(normalizado(conUno)).toContain('1 línea del archivo no se pudo identificar')

    const { wrapper: conVarios } = montar({ items, sinMatch: 3 })
    expect(normalizado(conVarios)).toContain('3 líneas del archivo no se pudieron identificar')
  })

  it('muestra los avisos de la store en el checklist', () => {
    const items = [itemBase()]
    const { wrapper } = montar({ items, avisos: ['Se usó el catálogo general, no el del proveedor.'] })

    expect(wrapper.text()).toContain('Se usó el catálogo general, no el del proveedor.')
  })

  describe('pantalla de selección (proveedor + archivo) — estado inicial, sin items ni análisis en curso', () => {
    it('muestra el dropdown de proveedores y la zona de carga', () => {
      const proveedores = [
        { per_id: 1, per_nombre: 'Proveedor A' },
        { per_id: 2, per_nombre: 'Proveedor B' },
      ]
      const { wrapper } = montar({ proveedores })

      expect(wrapper.text()).toContain('Importar lista de precios')
      const opciones = wrapper.findAll('option')
      expect(opciones.map((o) => o.text())).toEqual(['Sin proveedor', 'Proveedor A', 'Proveedor B'])
      expect(wrapper.find('input[type="file"]').exists()).toBe(true)
    })

    it('click en la zona de carga abre el selector de archivo (input file oculto)', async () => {
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
      const { wrapper } = montar()

      await wrapper.find('.border-dashed').trigger('click')

      expect(clickSpy).toHaveBeenCalledTimes(1)
      clickSpy.mockRestore()
    })

    it('muestra el error de la store si el análisis anterior falló', () => {
      const { wrapper } = montar({ error: 'No se pudo analizar el archivo.' })

      expect(wrapper.text()).toContain('No se pudo analizar el archivo.')
    })
  })
})
