<script setup>
import { ref, computed, watch } from 'vue'
import { textoMovimiento, textoFechaCompleta } from '../utils/fechas'

const props = defineProps({
  items: { type: Array, default: () => [] },
})

// Lo reciente es lo que se mira; el resto, a pedido.
const VISIBLES = 5
const verTodo = ref(false)
watch(
  () => props.items,
  () => (verTodo.value = false)
)
const visibles = computed(() => (verTodo.value ? props.items : props.items.slice(0, VISIBLES)))
const ocultos = computed(() => Math.max(0, props.items.length - VISIBLES))

function formatearMonto(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-AR')
}

function formatearCantidad(n) {
  return Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 })
}

function conSigno(n) {
  return `${n > 0 ? '+' : ''}${formatearCantidad(n)}`
}

function descripcion(item) {
  if (item.tipo === 'precio') {
    return `Costo ${formatearMonto(item.costo_anterior)} → ${formatearMonto(item.costo_nuevo)}`
  }
  if (item.tipo === 'conteo') {
    const dif = Number(item.cantidad || 0)
    if (!dif) return `Conteo: sin diferencias (${formatearCantidad(item.stock_contado)})`
    return `Conteo: ${conSigno(dif)} (sistema ${formatearCantidad(item.stock_sistema)} → ${formatearCantidad(item.stock_contado)})`
  }
  const base = `Ajuste de stock: ${conSigno(Number(item.cantidad || 0))}`
  return item.comentario ? `${base} · ${item.comentario}` : base
}

// Ícono + color por tipo y sentido: entrada (sube el stock) / salida (baja).
function estilo(item) {
  if (item.tipo === 'precio') return { icono: 'fa-tag', color: 'bg-sky-100 text-accent', etiqueta: 'Precio' }
  const cantidad = Number(item.cantidad || 0)
  if (item.tipo === 'conteo' && !cantidad) {
    return { icono: 'fa-check', color: 'bg-green-100 text-success', etiqueta: 'Conteo sin diferencias' }
  }
  if (cantidad < 0) return { icono: 'fa-arrow-down', color: 'bg-red-100 text-danger', etiqueta: 'Salida' }
  return { icono: 'fa-arrow-up', color: 'bg-amber-100 text-amber-700', etiqueta: 'Entrada' }
}
</script>

<template>
  <div>
    <h3 class="text-xs font-bold text-muted uppercase tracking-wider mb-2">Historial de este producto</h3>
    <div class="bg-white rounded-xl shadow-sm border divide-y">
      <div v-if="!items.length" class="p-4 text-center text-sm text-muted">Todavía no hay movimientos.</div>
      <div v-for="(item, i) in visibles" :key="i" class="p-3 flex items-center gap-3">
        <span
          class="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs"
          :class="estilo(item).color"
          :title="estilo(item).etiqueta"
        >
          <i class="fas" :class="estilo(item).icono" aria-hidden="true"></i>
          <span class="sr-only">{{ estilo(item).etiqueta }}</span>
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium truncate">{{ descripcion(item) }}</p>
          <p class="text-xs text-muted" :title="textoFechaCompleta(item.fecha)">{{ textoMovimiento(item.fecha) }}</p>
        </div>
      </div>
      <button
        v-if="ocultos > 0"
        type="button"
        class="w-full py-2.5 text-sm font-semibold text-accent"
        :aria-expanded="verTodo"
        @click="verTodo = !verTodo"
      >
        {{ verTodo ? 'Ver menos' : `Ver más (${ocultos})` }}
      </button>
    </div>
  </div>
</template>
