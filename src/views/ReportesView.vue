<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useReportesStore } from '../stores/reportes'
import { useProductosStore } from '../stores/productos'
import { useInfiniteScroll } from '../composables/useInfiniteScroll'
import { textoRelativo, urgenciaConteo } from '../utils/fechas'

const reportes = useReportesStore()
const productos = useProductosStore()
const router = useRouter()
const tab = ref('pendientes')

const sentinelPendientes = ref(null)
const sentinelAjustes = ref(null)

const hasMorePendientes = computed(() => reportes.pendientes.items.length < reportes.pendientes.total)
const hasMoreAjustes = computed(() => reportes.ajustes.items.length < reportes.ajustes.total)

onMounted(() => {
  // Al volver del modo conteo se conserva la lista (y lo ya descontado).
  if (!reportes.pendientesCargados) reportes.cargarPendientes(0)
  reportes.cargarCategorias()
})

const totalTodas = computed(() => reportes.categorias.reduce((acc, c) => acc + c.pendientes, 0))

function nombreCorto(ruta) {
  return (ruta || '').split(' > ').pop()
}

function etiquetaUrgencia(p) {
  return p.ultimo_conteo ? textoRelativo(p.ultimo_conteo) : 'nunca'
}

function claseUrgencia(p) {
  const u = urgenciaConteo(p.ultimo_conteo)
  if (u === 'nunca' || u === 'critico') return 'bg-red-100 text-danger'
  if (u === 'vencido') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-muted'
}

function contar(desde = null) {
  const query = {}
  if (reportes.filtroCategoria !== null) query.categoria = reportes.filtroCategoria
  if (desde !== null) query.desde = desde
  router.push({ path: '/contar', query })
}

useInfiniteScroll(
  sentinelPendientes,
  () => reportes.cargarPendientes(reportes.pendientes.items.length),
  { hasMore: hasMorePendientes, loading: computed(() => reportes.cargando) }
)
useInfiniteScroll(
  sentinelAjustes,
  () => reportes.cargarAjustes(reportes.ajustes.items.length),
  { hasMore: hasMoreAjustes, loading: computed(() => reportes.cargando) }
)

function cambiarTab(nuevo) {
  tab.value = nuevo
  if (nuevo === 'ajustes' && reportes.ajustes.items.length === 0) {
    reportes.cargarAjustes(0)
  }
}

function irAProducto(prodId) {
  productos.seleccionar(prodId)
  router.push('/buscar')
}
</script>

<template>
  <section class="space-y-3">
    <div class="bg-slate-200/70 p-1 rounded-xl flex gap-1">
      <button
        class="flex-1 text-xs font-semibold py-2 rounded-lg"
        :class="tab === 'pendientes' ? 'bg-white shadow-sm' : 'text-muted'"
        @click="cambiarTab('pendientes')"
      >
        Pendientes de controlar
      </button>
      <button
        class="flex-1 text-xs font-semibold py-2 rounded-lg"
        :class="tab === 'ajustes' ? 'bg-white shadow-sm' : 'text-muted'"
        @click="cambiarTab('ajustes')"
      >
        Ajustes frecuentes
      </button>
    </div>

    <div v-if="tab === 'pendientes'" class="space-y-2">
      <div v-if="reportes.categorias.length" class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        <button
          type="button"
          class="shrink-0 text-xs font-semibold px-3 py-2 rounded-full border whitespace-nowrap"
          :class="reportes.filtroCategoria === null ? 'bg-primary text-white border-primary' : 'bg-white border-slate-200'"
          @click="reportes.filtrarPorCategoria(null)"
        >
          Todas ({{ totalTodas }})
        </button>
        <button
          v-for="c in reportes.categorias"
          :key="c.categoria_id"
          type="button"
          :title="c.nombre"
          class="shrink-0 text-xs font-semibold px-3 py-2 rounded-full border whitespace-nowrap"
          :class="reportes.filtroCategoria === c.categoria_id ? 'bg-primary text-white border-primary' : 'bg-white border-slate-200'"
          @click="reportes.filtrarPorCategoria(c.categoria_id)"
        >
          {{ nombreCorto(c.nombre) }} ({{ c.pendientes }})
        </button>
      </div>

      <button
        v-if="reportes.pendientes.total > 0"
        type="button"
        class="w-full h-12 rounded-xl bg-success text-white font-semibold shadow-sm active:scale-95"
        @click="contar()"
      >
        <i class="fas fa-clipboard-check mr-2"></i>Empezar a contar ({{ reportes.pendientes.total }})
      </button>

      <p class="text-xs text-muted">
        <span class="font-bold text-ink">{{ reportes.pendientes.total }}</span>
        sin conteo hace +7 días · más urgente primero
      </p>
      <div class="bg-white rounded-xl shadow-sm border divide-y text-sm">
        <div v-if="!reportes.pendientes.items.length" class="p-4 text-center text-muted text-sm">
          Sin productos pendientes.
        </div>
        <button
          v-for="p in reportes.pendientes.items"
          :key="p.prod_id"
          class="w-full text-left px-3 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 active:bg-slate-100"
          @click="contar(p.prod_id)"
        >
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium">{{ p.nombre }}</span>
            <span v-if="p.categoria" class="block truncate text-[11px] text-muted">{{ nombreCorto(p.categoria) }}</span>
          </span>
          <span class="shrink-0 text-[11px] px-2 py-1 rounded-md font-semibold whitespace-nowrap" :class="claseUrgencia(p)">
            {{ etiquetaUrgencia(p) }}
          </span>
        </button>
      </div>
      <!-- Sentinela invisible: dispara la carga de la próxima página al
           entrar en el viewport (ver useInfiniteScroll). Sin texto ni botón
           salvo mientras carga, para que el scroll se sienta continuo. -->
      <div v-if="hasMorePendientes" ref="sentinelPendientes" class="py-2 text-center text-xs text-muted">
        {{ reportes.cargando ? 'Cargando más...' : '' }}
      </div>
    </div>

    <div v-else class="space-y-2">
      <p class="text-xs text-muted">
        <span class="font-bold text-ink">{{ reportes.ajustes.total }}</span>
        productos con ajustes manuales · últimos 30 días
      </p>
      <div class="bg-white rounded-xl shadow-sm border divide-y text-sm">
        <div v-if="!reportes.ajustes.items.length" class="p-4 text-center text-muted text-sm">
          Sin ajustes frecuentes.
        </div>
        <button
          v-for="p in reportes.ajustes.items"
          :key="p.prod_id"
          class="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50"
          @click="irAProducto(p.prod_id)"
        >
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium">{{ p.nombre }}</span>
            <span class="text-[11px] text-muted">{{ p.cantidad_ajustes }} ajustes</span>
          </span>
          <span class="shrink-0 text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-semibold">Monitorear</span>
        </button>
      </div>
      <div v-if="hasMoreAjustes" ref="sentinelAjustes" class="py-2 text-center text-xs text-muted">
        {{ reportes.cargando ? 'Cargando más...' : '' }}
      </div>
    </div>
  </section>
</template>
