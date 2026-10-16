<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProductoCard from '../components/ProductoCard.vue'
import ProductoCardSkeleton from '../components/ProductoCardSkeleton.vue'
import ConfirmarDescarte from '../components/ConfirmarDescarte.vue'
import { useProductosStore } from '../stores/productos'
import { useReportesStore } from '../stores/reportes'
import { useUiStore } from '../stores/ui'
import { useConfirmarDescarte } from '../composables/useConfirmarDescarte'

// Modo conteo: recorre "Pendientes de controlar" de a un producto. Contar
// uno pasa solo al siguiente; "Saltar" lo deja para el final de la sesión.
// La cola ES la lista del store: marcarContado() ya saca lo contado, así que
// el siguiente siempre es el primero que no se saltó.
const route = useRoute()
const router = useRouter()
const productos = useProductosStore()
const reportes = useReportesStore()
const ui = useUiStore()
// "Saltar" y "Salir" con algo tipeado preguntan antes de descartarlo.
const descarte = useConfirmarDescarte()

const actualId = ref(null)
const saltados = ref([])
const contados = ref(0)
const totalInicial = ref(0)
const iniciando = ref(true)
const pasando = ref(false)

const cola = computed(() => reportes.pendientes.items.filter((p) => !saltados.value.includes(p.prod_id)))
const quedan = computed(() => reportes.pendientes.total)
const terminado = computed(() => !iniciando.value && actualId.value === null)
const actualCargado = computed(() => productos.actual?.prod_id === actualId.value)
const progreso = computed(() => (totalInicial.value > 0 ? Math.min(100, (contados.value / totalInicial.value) * 100) : 0))
const nombreFiltro = computed(() => {
  if (reportes.filtroCategoria === null) return null
  const cat = reportes.categorias.find((c) => c.categoria_id === reportes.filtroCategoria)
  return cat ? cat.nombre.split(' > ').pop() : null
})

// Si lo cargado se agotó pero el servidor tiene más, trae la página siguiente
// (el offset es lo que queda en la lista: lo contado ya no está en el
// servidor, lo saltado sí).
async function asegurarCola() {
  if (cola.value.length === 0 && reportes.pendientes.items.length < reportes.pendientes.total) {
    await reportes.cargarPendientes(reportes.pendientes.items.length)
  }
}

async function mostrar(prodId) {
  actualId.value = prodId
  if (prodId === null) return
  const resultado = await productos.seleccionar(prodId)
  // Dejó de controlar stock (ya no se usa desde la app): se lo saltea solo.
  if (resultado === 'no-disponible' && actualId.value === prodId) {
    ui.mostrarToast(productos.error, 'info')
    await siguiente()
  }
}

async function siguiente() {
  await asegurarCola()
  mostrar(cola.value[0]?.prod_id ?? null)
}

function saltar() {
  descarte.siHayCambios(() => {
    if (actualId.value !== null) saltados.value.push(actualId.value)
    siguiente()
  })
}

function alGuardar({ conteo }) {
  if (!conteo) return
  contados.value++
  // Una pausa corta para que se vea la confirmación antes de cambiar.
  pasando.value = true
  setTimeout(() => {
    pasando.value = false
    siguiente()
  }, 600)
}

function revisarSaltados() {
  saltados.value = []
  siguiente()
}

onMounted(async () => {
  const categoria = route.query.categoria ? Number(route.query.categoria) : null
  if (categoria !== reportes.filtroCategoria) {
    await reportes.filtrarPorCategoria(categoria)
  } else if (!reportes.pendientesCargados) {
    await reportes.cargarPendientes(0)
  }
  totalInicial.value = reportes.pendientes.total
  iniciando.value = false

  const desde = route.query.desde ? Number(route.query.desde) : null
  if (desde !== null && cola.value.some((p) => p.prod_id === desde)) {
    mostrar(desde)
  } else {
    await siguiente()
  }
})
</script>

<template>
  <section class="space-y-4">
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 space-y-2">
      <div class="flex justify-between items-center gap-2">
        <div class="min-w-0">
          <h1 class="font-bold text-base">Modo conteo</h1>
          <p class="text-xs text-muted truncate">
            Contados <strong class="text-ink">{{ contados }}</strong> · Quedan <strong class="text-ink">{{ quedan }}</strong>
            <template v-if="nombreFiltro"> · {{ nombreFiltro }}</template>
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-muted active:scale-95"
          @click="router.push('/reportes')"
        >
          Salir
        </button>
      </div>
      <div class="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" :aria-valuenow="Math.round(progreso)" aria-valuemin="0" aria-valuemax="100">
        <div class="h-full bg-success transition-all duration-300" :style="{ width: `${progreso}%` }"></div>
      </div>
    </div>

    <div v-if="iniciando" class="text-center text-sm text-muted py-10">Cargando pendientes...</div>

    <div v-else-if="terminado" class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-3">
      <i class="fas fa-circle-check text-4xl text-success"></i>
      <h2 class="font-bold text-lg">¡Listo!</h2>
      <p class="text-sm text-muted">
        Contaste {{ contados }} {{ contados === 1 ? 'producto' : 'productos' }}<template v-if="saltados.length">
          y salteaste {{ saltados.length }}</template>.
      </p>
      <button
        v-if="saltados.length"
        type="button"
        class="w-full h-12 rounded-xl bg-slate-800 text-white font-semibold active:scale-95"
        @click="revisarSaltados"
      >
        Revisar los salteados ({{ saltados.length }})
      </button>
      <button
        type="button"
        class="w-full h-12 rounded-xl border border-slate-200 font-semibold active:scale-95"
        @click="router.push('/reportes')"
      >
        Volver a pendientes
      </button>
    </div>

    <template v-else>
      <div
        v-if="pasando"
        role="status"
        class="bg-white rounded-2xl border border-green-200 shadow-sm p-8 text-center text-success font-semibold"
      >
        <i class="fas fa-circle-check text-4xl mb-2"></i>
        <p>Conteo registrado</p>
      </div>
      <ProductoCardSkeleton v-else-if="productos.cargandoOtroProducto" />
      <!-- Si el detalle falló, productos.actual puede seguir siendo el
           producto ANTERIOR: mostrarlo haría contar el producto equivocado. -->
      <div
        v-else-if="!actualCargado"
        class="bg-white rounded-2xl border border-red-200 shadow-sm p-5 text-center space-y-3"
      >
        <p class="text-sm text-danger">{{ productos.error || 'No se pudo cargar el producto.' }}</p>
        <button
          type="button"
          class="w-full h-11 rounded-xl bg-slate-800 text-white text-sm font-semibold active:scale-95"
          @click="mostrar(actualId)"
        >
          Reintentar
        </button>
      </div>
      <ProductoCard v-else @guardado="alGuardar" />
      <button
        type="button"
        :disabled="pasando"
        class="w-full h-11 rounded-xl text-sm font-semibold text-muted border border-dashed border-slate-300 active:scale-95 disabled:opacity-50"
        @click="saltar"
      >
        Saltar este producto <i class="fas fa-forward ml-1"></i>
      </button>
    </template>

    <ConfirmarDescarte
      v-if="descarte.preguntando.value"
      :nombre="productos.actual?.nombre"
      @descartar="descarte.descartar"
      @seguir="descarte.seguirEditando"
    />
  </section>
</template>
