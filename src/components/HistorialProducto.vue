<script setup>
defineProps({
  items: { type: Array, default: () => [] },
})

function formatearMonto(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-AR')
}

function formatearCantidad(n) {
  return Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 })
}

function descripcion(item) {
  if (item.tipo === 'precio') {
    return `Costo ${formatearMonto(item.costo_anterior)} → ${formatearMonto(item.costo_nuevo)}`
  }
  if (item.tipo === 'conteo') {
    const dif = Number(item.cantidad || 0)
    if (!dif) return `Conteo: sin diferencias (${formatearCantidad(item.stock_contado)})`
    return `Conteo: ${dif > 0 ? '+' : ''}${formatearCantidad(dif)} (sistema ${formatearCantidad(item.stock_sistema)} → ${formatearCantidad(item.stock_contado)})`
  }
  const cantidad = Number(item.cantidad || 0)
  const signo = cantidad >= 0 ? '+' : ''
  const base = `Ajuste de stock: ${signo}${cantidad}`
  return item.comentario ? `${base} · ${item.comentario}` : base
}
</script>

<template>
  <div>
    <h3 class="text-xs font-bold text-muted uppercase tracking-wider mb-2">Historial de este producto</h3>
    <div class="bg-white rounded-xl shadow-sm border divide-y text-xs">
      <div v-if="!items.length" class="p-4 text-center text-muted">Todavía no hay movimientos.</div>
      <div v-for="(item, i) in items" :key="i" class="p-3 flex justify-between items-center gap-2">
        <div class="min-w-0">
          <p class="font-medium truncate">{{ descripcion(item) }}</p>
          <p class="text-muted">{{ item.fecha }}</p>
        </div>
        <i
          class="fas shrink-0"
          :class="{
            'fa-tag text-accent': item.tipo === 'precio',
            'fa-clipboard-check text-success': item.tipo === 'conteo',
            'fa-right-left text-muted': item.tipo !== 'precio' && item.tipo !== 'conteo',
          }"
        ></i>
      </div>
    </div>
  </div>
</template>
