<script setup>
import { ref, computed, watch } from 'vue'
import { useProductosStore } from '../stores/productos'
import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'
import HistorialProducto from './HistorialProducto.vue'

const productos = useProductosStore()
const auth = useAuthStore()
const ui = useUiStore()

const stock = ref(0)
const costo = ref(0)
const precioVenta = ref(0)
const guardandoPrecio = ref(false)
const guardandoStock = ref(false)

// El formulario se resetea al valor del producto cada vez que cambia CUÁL
// producto está seleccionado (no en cada actualización de actual.value, para
// no pisar lo que el usuario está tipeando después de guardar precio/stock
// por separado).
watch(
  () => productos.actual?.prod_id,
  () => {
    const p = productos.actual
    if (!p) return
    stock.value = p.stock_actual
    costo.value = p.costo
    precioVenta.value = p.precio_venta
  },
  { immediate: true }
)

const margenActual = computed(() => {
  const c = Number(costo.value) || 0
  const v = Number(precioVenta.value) || 0
  return v > 0 ? ((v - c) / v) * 100 : 0
})

const margenBajo = computed(() => margenActual.value < (auth.config.margen_objetivo_pct ?? 30))

function ajustarStepper(delta) {
  stock.value = Math.max(0, Number(stock.value || 0) + delta)
}

async function guardarPrecio() {
  guardandoPrecio.value = true
  try {
    await productos.actualizarPrecio(productos.actual.prod_id, costo.value, precioVenta.value)
    ui.mostrarToast('Precio actualizado.', 'success')
  } catch (e) {
    ui.mostrarToast(e.message, 'error')
  } finally {
    guardandoPrecio.value = false
  }
}

async function guardarStock() {
  guardandoStock.value = true
  try {
    const resultado = await productos.ajustarStock(productos.actual.prod_id, stock.value)
    stock.value = resultado.stock_actual
    ui.mostrarToast('Stock actualizado.', 'success')
  } catch (e) {
    ui.mostrarToast(e.message, 'error')
  } finally {
    guardandoStock.value = false
  }
}
</script>

<template>
  <div v-if="productos.actual" class="space-y-4">
    <div class="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-4">
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
          <input v-model.number="costo" type="number" class="w-full bg-transparent font-bold text-lg focus:outline-none" />
        </div>
      </div>

      <div class="bg-slate-50 rounded-xl p-3 border space-y-3">
        <div class="flex justify-between items-center gap-3">
          <label class="text-xs text-muted font-medium">Precio de venta ($)</label>
          <input
            v-model.number="precioVenta"
            type="number"
            class="w-28 text-right font-bold text-lg bg-white border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent"
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

      <div class="grid grid-cols-2 gap-2">
        <button
          :disabled="guardandoStock"
          class="bg-slate-800 text-white font-semibold py-3 rounded-xl shadow-sm active:scale-95 disabled:opacity-60"
          @click="guardarStock"
        >
          <i class="fas fa-boxes-stacked mr-2"></i>{{ guardandoStock ? 'Guardando...' : 'Guardar stock' }}
        </button>
        <button
          :disabled="guardandoPrecio"
          class="bg-success text-white font-semibold py-3 rounded-xl shadow-sm active:scale-95 disabled:opacity-60"
          @click="guardarPrecio"
        >
          <i class="fas fa-check mr-2"></i>{{ guardandoPrecio ? 'Guardando...' : 'Guardar precio' }}
        </button>
      </div>
    </div>

    <HistorialProducto :items="productos.actual.historial || []" />
  </div>
</template>
