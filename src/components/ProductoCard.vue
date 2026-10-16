<script setup>
import { ref, computed, watch } from 'vue'
import { useProductosStore } from '../stores/productos'
import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'

const productos = useProductosStore()
const auth = useAuthStore()
const ui = useUiStore()

const stock = ref(0)
const costo = ref(0)
const precioVenta = ref(0)
const guardando = ref(false)
// Ganancia como MARKUP sobre costo (igual que producto.prod_ganancia y la
// "Ganancia (%)" de amproducto.php), no el margen sobre venta que se muestra.
// Es el ancla de la sincronización: editar el costo recalcula la venta con
// esta ganancia, y editar la venta recalcula la ganancia (el costo no se toca).
// null = desconocida (sin ganancia_pct y con costo 0): editar el costo no mueve la venta.
const gananciaPct = ref(null)

function calcularGanancia(c, v) {
  return c > 0 ? ((v - c) / c) * 100 : null
}

function cargarPrecio(p) {
  costo.value = p.costo
  precioVenta.value = p.precio_venta
  // ganancia_pct viene de la API (prod_ganancia*100); se deriva de costo/venta
  // solo si falta (p. ej. un producto en catalogoCache de una versión anterior).
  gananciaPct.value =
    typeof p.ganancia_pct === 'number'
      ? p.ganancia_pct
      : calcularGanancia(Number(p.costo) || 0, Number(p.precio_venta) || 0)
}

function cargarDesdeProducto(p) {
  stock.value = p.stock_actual
  cargarPrecio(p)
}

// El formulario se resetea al valor del producto cada vez que cambia CUÁL
// producto está seleccionado (no en cada actualización de actual.value, para
// no pisar lo que el usuario está tipeando si solo una parte se guardó).
watch(
  () => productos.actual?.prod_id,
  () => {
    if (productos.actual) cargarDesdeProducto(productos.actual)
  },
  { immediate: true }
)

// Cambios sin guardar respecto de productos.actual (lo último persistido).
// Tolerancia de medio centavo: precio_venta llega del backend con más
// decimales que el redondeo a 2 que hace alCambiarCosto().
function distinto(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) >= 0.005
}
const cambioStock = computed(() => !!productos.actual && distinto(stock.value, productos.actual.stock_actual))
const cambioPrecio = computed(
  () =>
    !!productos.actual &&
    (distinto(costo.value, productos.actual.costo) || distinto(precioVenta.value, productos.actual.precio_venta))
)
const hayCambios = computed(() => cambioStock.value || cambioPrecio.value)

function reiniciar() {
  cargarDesdeProducto(productos.actual)
}

// Handlers de @input (corren después del update de v-model, así que costo y
// precioVenta ya tienen el valor tipeado).
function alCambiarCosto() {
  if (gananciaPct.value === null) return
  const c = Number(costo.value) || 0
  precioVenta.value = Math.round(c * (1 + gananciaPct.value / 100) * 100) / 100
}

function alCambiarPrecioVenta() {
  const c = Number(costo.value) || 0
  if (c > 0) {
    gananciaPct.value = calcularGanancia(c, Number(precioVenta.value) || 0)
  }
}

const margenActual = computed(() => {
  const c = Number(costo.value) || 0
  const v = Number(precioVenta.value) || 0
  return v > 0 ? ((v - c) / v) * 100 : 0
})

const margenBajo = computed(() => margenActual.value < (auth.config.margen_objetivo_pct ?? 30))

function ajustarStepper(delta) {
  stock.value = Math.max(0, Number(stock.value || 0) + delta)
}

// Manda solo lo que cambió: ajustar_stock registra un conteo y
// actualizar_precio un ajuste de precio, así que guardar uno no debe asentar
// el otro. Si una parte falla, la otra queda guardada y el form conserva lo
// tipeado en la que falló.
async function guardar() {
  // Guard explícito: el :disabled del botón llega un tick tarde ante un doble
  // click sincrónico.
  if (guardando.value) return
  guardando.value = true
  const prodId = productos.actual.prod_id
  const guardados = []
  const fallas = []
  try {
    if (cambioStock.value) {
      try {
        const resultado = await productos.ajustarStock(prodId, stock.value)
        stock.value = resultado.stock_actual
        guardados.push('stock')
      } catch (e) {
        fallas.push({ parte: 'stock', mensaje: e.message })
      }
    }
    if (cambioPrecio.value) {
      try {
        await productos.actualizarPrecio(prodId, costo.value, precioVenta.value)
        // Mostrar lo que persistió el backend (venta = costo*(1+ganancia)).
        if (productos.actual?.prod_id === prodId) cargarPrecio(productos.actual)
        guardados.push('precio')
      } catch (e) {
        fallas.push({ parte: 'precio', mensaje: e.message })
      }
    }
  } finally {
    guardando.value = false
  }

  if (fallas.length === 0) {
    const mensajes = { stock: 'Stock actualizado.', precio: 'Precio actualizado.' }
    ui.mostrarToast(guardados.length > 1 ? 'Stock y precio actualizados.' : mensajes[guardados[0]], 'success')
  } else if (guardados.length > 0) {
    ui.mostrarToast(`Se guardó el ${guardados[0]}, pero no el ${fallas[0].parte}: ${fallas[0].mensaje}`, 'error')
  } else if (fallas.length > 1) {
    ui.mostrarToast(fallas.map((f) => `${f.parte === 'stock' ? 'Stock' : 'Precio'}: ${f.mensaje}`).join(' '), 'error')
  } else {
    ui.mostrarToast(fallas[0].mensaje, 'error')
  }
}
</script>

<template>
  <div v-if="productos.actual" class="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-4">
    <div class="flex justify-between items-start border-b border-slate-100 pb-3 gap-2">
      <div class="min-w-0">
        <span class="text-xs font-semibold text-accent bg-blue-50 px-2 py-0.5 rounded">
          Código: {{ productos.actual.codigo }}
        </span>
        <h2 class="font-bold text-lg mt-1 truncate">{{ productos.actual.nombre }}</h2>
      </div>
      <span v-if="productos.actual.categoria" class="shrink-0 text-xs bg-slate-100 text-muted px-2 py-1 rounded-md">
        {{ productos.actual.categoria }}
      </span>
    </div>

    <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted -mt-1">
      <span><i class="fas fa-tag mr-1"></i>Precio ajustado: {{ productos.actual.ultimo_ajuste_precio || '—' }}</span>
      <span :class="!productos.actual.ultimo_conteo ? 'text-danger font-semibold' : ''">
        <i class="fas fa-clipboard-check mr-1"></i>Último conteo: {{ productos.actual.ultimo_conteo || 'nunca' }}
      </span>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="bg-slate-50 p-3 rounded-xl border">
        <label class="block text-xs text-muted font-medium mb-1">Stock actual</label>
        <div class="flex items-center justify-between">
          <button class="w-8 h-8 rounded-lg bg-white border shadow-sm font-bold" @click="ajustarStepper(-1)">−</button>
          <input v-model.number="stock" type="number" class="w-14 text-center bg-transparent font-bold text-lg focus:outline-none" />
          <button class="w-8 h-8 rounded-lg bg-white border shadow-sm font-bold" @click="ajustarStepper(1)">+</button>
        </div>
      </div>
      <div class="bg-slate-50 p-3 rounded-xl border">
        <label class="block text-xs text-muted font-medium mb-1">Precio de costo ($)</label>
        <input
          v-model.number="costo"
          type="number"
          class="w-full bg-transparent font-bold text-lg focus:outline-none"
          @input="alCambiarCosto"
        />
      </div>
    </div>

    <div class="bg-slate-50 rounded-xl p-3 border space-y-3">
      <div class="flex justify-between items-center gap-3">
        <label class="text-xs text-muted font-medium">Precio de venta ($)</label>
        <input
          v-model.number="precioVenta"
          type="number"
          class="w-28 text-right font-bold text-lg bg-white border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent"
          @input="alCambiarPrecioVenta"
        />
      </div>
      <div class="flex justify-between items-center pt-2 border-t border-slate-200">
        <span class="text-xs text-muted">Margen actual</span>
        <div class="flex items-center gap-2">
          <span
            class="font-bold px-2 py-1 rounded-lg text-sm"
            :class="margenBajo ? 'bg-red-100 text-danger' : 'bg-green-100 text-success'"
          >
            {{ margenActual.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}%
          </span>
          <span class="text-xs font-semibold px-2 py-1 rounded-lg bg-sky-100 text-sky-700">
            &gt;= {{ auth.config.margen_objetivo_pct ?? 30 }}%
          </span>
        </div>
      </div>
      <p v-if="margenBajo" class="text-xs text-danger bg-red-50 border border-red-200 rounded-lg p-2">
        <i class="fas fa-triangle-exclamation mr-1"></i>El margen quedó por debajo del mínimo definido.
      </p>
    </div>

    <div class="flex gap-2">
      <button
        v-if="hayCambios && !guardando"
        type="button"
        aria-label="Reiniciar valores"
        title="Reiniciar valores"
        class="shrink-0 w-12 rounded-xl border border-slate-200 bg-white text-muted shadow-sm active:scale-95"
        @click="reiniciar"
      >
        <i class="fas fa-rotate-left"></i>
      </button>
      <button
        :disabled="guardando || !hayCambios"
        class="flex-1 bg-success text-white font-semibold py-3 rounded-xl shadow-sm active:scale-95 disabled:opacity-60"
        @click="guardar"
      >
        <i class="fas fa-check mr-2"></i>{{ guardando ? 'Guardando...' : 'Guardar cambios' }}
      </button>
    </div>
  </div>
</template>
