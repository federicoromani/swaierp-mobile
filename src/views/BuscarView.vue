<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import SearchBar from '../components/SearchBar.vue'
import ProductoCard from '../components/ProductoCard.vue'
import ProductoCardSkeleton from '../components/ProductoCardSkeleton.vue'
import HistorialProducto from '../components/HistorialProducto.vue'
import BadgeUrgencia from '../components/BadgeUrgencia.vue'
import ConfirmarDescarte from '../components/ConfirmarDescarte.vue'
import { useProductosStore } from '../stores/productos'
import { useReportesStore } from '../stores/reportes'
import { useUiStore } from '../stores/ui'
import { useConfirmarDescarte } from '../composables/useConfirmarDescarte'

const productos = useProductosStore()
const reportes = useReportesStore()
const ui = useUiStore()
const router = useRouter()
const descarte = useConfirmarDescarte()

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

const mostrarCard = computed(() => !!productos.actual && !productos.cargandoOtroProducto)
const proximos = computed(() => reportes.pendientes.items.slice(0, 3))

// Un producto que no controla stock (p. ej. elegido de lo guardado offline)
// no se abre: el aviso explica por qué, aunque haya otro en pantalla.
async function abrir(prodId) {
  if ((await productos.seleccionar(prodId)) === 'no-disponible') {
    ui.mostrarToast(productos.error, 'info')
  }
}

// Código escaneado que no es de ningún producto: queda a mano para
// asignárselo al producto que se busque y abra a continuación.
const codigoSinProducto = ref(null)

function seleccionar(prodId, { escaneado = false } = {}) {
  // Se escaneó un producto que existe: ese código ya no está pendiente.
  if (escaneado) codigoSinProducto.value = null
  if (prodId === productos.actual?.prod_id) return abrir(prodId)
  descarte.siHayCambios(() => abrir(prodId))
}

function contar(desde = null) {
  const query = {}
  if (reportes.filtroCategoria !== null) query.categoria = reportes.filtroCategoria
  if (desde !== null) query.desde = desde
  router.push({ path: '/contar', query })
}
</script>

<template>
  <section class="space-y-4">
    <SearchBar @select="seleccionar" @sin-producto="codigoSinProducto = $event" />

    <div
      v-if="codigoSinProducto && !mostrarCard"
      role="status"
      class="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 flex items-start justify-between gap-2"
    >
      <p class="text-sm min-w-0">
        Ningún producto tiene el código <strong class="font-mono break-words">{{ codigoSinProducto }}</strong>.
        Buscá el producto para asignárselo.
      </p>
      <button
        type="button"
        aria-label="Descartar código escaneado"
        class="shrink-0 w-9 h-9 -mr-1 -mt-0.5 text-muted"
        @click="codigoSinProducto = null"
      >
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <p v-if="productos.error && !productos.actual" class="text-xs text-danger bg-red-50 border border-red-200 rounded-lg p-2">
      {{ productos.error }}
    </p>

    <ProductoCardSkeleton v-if="productos.cargandoOtroProducto" />
    <ProductoCard
      v-else
      :codigo-por-asignar="codigoSinProducto"
      @codigo-asignado="codigoSinProducto = null"
      @descartar-codigo="codigoSinProducto = null"
    />

    <div
      v-if="mostrarCard && reportes.pendientes.total > 0"
      class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex justify-between items-center gap-2"
    >
      <div class="flex items-center gap-1.5 text-xs text-amber-900 min-w-0">
        <i class="fas fa-triangle-exclamation shrink-0"></i>
        <span class="truncate">
          <strong>{{ reportes.pendientes.total }}</strong> sin controlar hace +7 días<template v-if="nombreFiltro"> en {{ nombreFiltro }}</template>
        </span>
      </div>
      <button
        type="button"
        class="shrink-0 text-xs font-semibold bg-amber-600 text-white px-3 py-1.5 rounded-lg"
        @click="contar()"
      >
        Contar
      </button>
    </div>

    <HistorialProducto v-if="mostrarCard" :items="productos.actual.historial || []" />

    <!-- Sin producto elegido: lo que conviene contar hoy, en vez de una
         pantalla vacía. -->
    <section
      v-if="!productos.actual && !productos.cargandoOtroProducto"
      aria-label="Para contar hoy"
      class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3"
    >
      <div class="flex justify-between items-baseline gap-2">
        <h2 class="font-bold text-base">Para contar hoy</h2>
        <span class="text-xs text-muted whitespace-nowrap">
          Hoy contaste <strong class="text-ink">{{ reportes.conteosHoy }}</strong>
        </span>
      </div>

      <template v-if="reportes.pendientes.total > 0">
        <p class="text-sm text-muted">
          <strong class="text-ink">{{ reportes.pendientes.total }}</strong> productos sin contar hace +7 días<template v-if="nombreFiltro"> en {{ nombreFiltro }}</template>.
        </p>
        <div class="divide-y divide-slate-100 -mx-1">
          <button
            v-for="p in proximos"
            :key="p.prod_id"
            type="button"
            class="w-full text-left px-1 py-2.5 flex items-center justify-between gap-2 active:bg-slate-50"
            @click="contar(p.prod_id)"
          >
            <span class="min-w-0 truncate text-sm font-medium">{{ p.nombre }}</span>
            <BadgeUrgencia :ultimo-conteo="p.ultimo_conteo" />
          </button>
        </div>
        <button
          type="button"
          class="w-full h-12 rounded-xl bg-success text-white font-semibold shadow-sm active:scale-95"
          @click="contar()"
        >
          <i class="fas fa-clipboard-check mr-2"></i>Empezar a contar ({{ reportes.pendientes.total }})
        </button>
      </template>
      <p v-else-if="reportes.pendientesCargados" class="text-sm text-success font-medium">
        <i class="fas fa-circle-check mr-1"></i>Todo al día: no hay productos sin contar hace +7 días.
      </p>

      <p class="text-xs text-muted">
        <i class="fas fa-barcode mr-1"></i>O escaneá / buscá un producto arriba para contarlo o cambiarle el precio.
      </p>
    </section>

    <ConfirmarDescarte
      v-if="descarte.preguntando.value"
      :nombre="productos.actual?.nombre"
      @descartar="descarte.descartar"
      @seguir="descarte.seguirEditando"
    />
  </section>
</template>
