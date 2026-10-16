<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import SearchBar from '../components/SearchBar.vue'
import ProductoCard from '../components/ProductoCard.vue'
import ProductoCardSkeleton from '../components/ProductoCardSkeleton.vue'
import HistorialProducto from '../components/HistorialProducto.vue'
import { useProductosStore } from '../stores/productos'
import { useReportesStore } from '../stores/reportes'

const productos = useProductosStore()
const reportes = useReportesStore()
const router = useRouter()

onMounted(() => {
  // Si ya se cargó (p. ej. volviendo de Reportes o del modo conteo), los
  // conteos registrados mientras tanto ya se descontaron en el store.
  if (!reportes.pendientesCargados) reportes.cargarPendientes(0)
})

// Con un filtro de categoría activo, el total es el de esa categoría.
const nombreFiltro = computed(() => {
  if (reportes.filtroCategoria === null) return null
  const cat = reportes.categorias.find((c) => c.categoria_id === reportes.filtroCategoria)
  return cat ? cat.nombre.split(' > ').pop() : 'la categoría elegida'
})

function seleccionar(prodId) {
  productos.seleccionar(prodId)
}
</script>

<template>
  <section class="space-y-4">
    <SearchBar @select="seleccionar" />

    <p v-if="productos.error && !productos.actual" class="text-xs text-danger bg-red-50 border border-red-200 rounded-lg p-2">
      {{ productos.error }}
    </p>

    <ProductoCardSkeleton v-if="productos.cargandoOtroProducto" />
    <ProductoCard v-else />

    <div
      v-if="reportes.pendientes.total > 0"
      class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex justify-between items-center gap-2"
    >
      <div class="flex items-center gap-1.5 text-xs text-amber-900 min-w-0">
        <i class="fas fa-triangle-exclamation shrink-0"></i>
        <span class="truncate">
          <strong>{{ reportes.pendientes.total }}</strong> sin controlar hace +7 días<template v-if="nombreFiltro"> en {{ nombreFiltro }}</template>
        </span>
      </div>
      <button
        class="shrink-0 text-xs font-semibold bg-amber-600 text-white px-3 py-1.5 rounded-lg"
        @click="router.push('/contar')"
      >
        Contar
      </button>
    </div>

    <HistorialProducto v-if="productos.actual && !productos.cargandoOtroProducto" :items="productos.actual.historial || []" />

    <div v-if="!productos.actual && !productos.cargandoOtroProducto" class="text-center text-sm text-muted py-10">
      <i class="fas fa-magnifying-glass text-2xl mb-2"></i>
      <p>Buscá un producto por nombre o código para empezar.</p>
    </div>
  </section>
</template>
