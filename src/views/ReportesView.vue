<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useReportesStore } from '../stores/reportes'
import { useProductosStore } from '../stores/productos'

const reportes = useReportesStore()
const productos = useProductosStore()
const router = useRouter()
const tab = ref('pendientes')

onMounted(() => {
  reportes.cargarPendientes(0)
})

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
      <p class="text-xs text-muted">
        <span class="font-bold text-ink">{{ reportes.pendientes.total }}</span>
        sin conteo hace +7 días · más antiguo primero
      </p>
      <div class="bg-white rounded-xl shadow-sm border divide-y text-sm">
        <div v-if="!reportes.pendientes.items.length" class="p-4 text-center text-muted text-sm">
          Sin productos pendientes.
        </div>
        <button
          v-for="p in reportes.pendientes.items"
          :key="p.prod_id"
          class="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50"
          @click="irAProducto(p.prod_id)"
        >
          <span class="truncate text-sm font-medium">{{ p.nombre }}</span>
          <span class="shrink-0 text-[10px] bg-red-100 text-danger px-2 py-0.5 rounded font-semibold whitespace-nowrap">
            {{ p.ultimo_conteo || 'nunca' }}
          </span>
        </button>
      </div>
      <button
        v-if="reportes.pendientes.items.length < reportes.pendientes.total"
        class="w-full text-xs font-semibold text-accent bg-white border border-slate-200 rounded-lg py-2"
        @click="reportes.cargarPendientes(reportes.pendientes.items.length)"
      >
        Cargar más
      </button>
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
      <button
        v-if="reportes.ajustes.items.length < reportes.ajustes.total"
        class="w-full text-xs font-semibold text-accent bg-white border border-slate-200 rounded-lg py-2"
        @click="reportes.cargarAjustes(reportes.ajustes.items.length)"
      >
        Cargar más
      </button>
    </div>
  </section>
</template>
