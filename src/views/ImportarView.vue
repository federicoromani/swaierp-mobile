<script setup>
import { ref, computed, onMounted } from 'vue'
import { useImportacionPreciosStore } from '../stores/importacionPrecios'
import { useUiStore } from '../stores/ui'

const store = useImportacionPreciosStore()
const ui = useUiStore()

const inputArchivo = ref(null)
const nombreArchivo = ref('')

onMounted(() => {
  store.cargarProveedores()
})

function alSeleccionarArchivo(e) {
  const archivo = e.target.files && e.target.files[0]
  if (!archivo) {
    return
  }
  nombreArchivo.value = archivo.name
  store.analizarArchivo(archivo)
}

const seleccionados = computed(() => store.items.filter((item) => item.seleccionado && item.prod_id).length)

async function confirmar() {
  await store.confirmarSeleccionados()
  if (store.resumen) {
    ui.mostrarToast(`Se actualizaron ${store.resumen.aplicados} productos.`, 'success')
  }
}

function importarOtra() {
  store.reiniciar()
  nombreArchivo.value = ''
  if (inputArchivo.value) {
    inputArchivo.value.value = ''
  }
}

function formatearMonto(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-AR')
}
</script>

<template>
  <section class="space-y-4">
    <!-- Resumen post-confirmar -->
    <div v-if="store.resumen" class="bg-white rounded-2xl p-6 shadow-sm border text-center space-y-3">
      <i class="fas fa-circle-check text-3xl text-success"></i>
      <h2 class="font-bold text-lg">Importación aplicada</h2>
      <p class="text-sm text-muted">
        <strong class="text-success">{{ store.resumen.aplicados }}</strong> producto{{ store.resumen.aplicados === 1 ? '' : 's' }} actualizado{{ store.resumen.aplicados === 1 ? '' : 's' }}
        <template v-if="store.resumen.rechazados > 0">
          · <strong class="text-danger">{{ store.resumen.rechazados }}</strong> rechazado{{ store.resumen.rechazados === 1 ? '' : 's' }}
        </template>
      </p>
      <button class="w-full bg-primary text-white font-semibold py-3 rounded-xl shadow-sm active:scale-95" @click="importarOtra">
        <i class="fas fa-rotate-left mr-2"></i>Importar otra lista
      </button>
    </div>

    <!-- Selección de proveedor + archivo -->
    <div v-else-if="!store.fuente && !store.analizando" class="bg-white p-4 rounded-2xl shadow-sm border space-y-4">
      <div>
        <h2 class="font-bold text-base mb-1">Importar lista de precios</h2>
        <p class="text-xs text-muted">
          Subí un PDF, foto, Excel o CSV con la lista de tu proveedor. Se detectan los costos y se
          cruzan con tu catálogo — el precio de venta no se toca.
        </p>
      </div>

      <div>
        <label class="block text-xs text-muted font-medium mb-1">Proveedor (opcional)</label>
        <select
          v-model.number="store.proveedorSeleccionado"
          class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option :value="0">Sin proveedor</option>
          <option v-for="p in store.proveedores" :key="p.per_id" :value="p.per_id">{{ p.per_nombre }}</option>
        </select>
        <p class="text-[11px] text-muted mt-1">Elegirlo mejora el reconocimiento por código y lo recuerda para la próxima vez.</p>
      </div>

      <div
        class="border-2 border-dashed border-blue-200 bg-blue-50/50 rounded-xl p-6 text-center cursor-pointer"
        @click="inputArchivo.click()"
      >
        <i class="fas fa-file-arrow-up text-3xl text-accent mb-2"></i>
        <p class="text-sm font-semibold text-accent">Tocá para subir Foto, PDF, Excel o CSV</p>
        <p class="text-xs text-muted mt-1">{{ nombreArchivo || 'JPG, PNG, PDF, XLSX o CSV' }}</p>
        <input
          ref="inputArchivo"
          type="file"
          class="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
          @change="alSeleccionarArchivo"
        />
      </div>

      <p v-if="store.error" class="text-xs text-danger bg-red-50 border border-red-200 rounded-lg p-2">{{ store.error }}</p>
    </div>

    <!-- Analizando -->
    <div v-if="store.analizando" class="bg-white p-6 rounded-2xl shadow-sm border text-center space-y-3">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-transparent"></div>
      <p class="text-sm font-semibold">Analizando el archivo...</p>
      <p class="text-xs text-muted">Detectando productos y precios</p>
    </div>

    <!-- Checklist de resultados -->
    <div v-if="!store.analizando && store.fuente" class="space-y-3">
      <div v-if="store.sinMatch > 0" class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
        <i class="fas fa-circle-info mr-1"></i>
        <strong>{{ store.sinMatch }}</strong> línea{{ store.sinMatch === 1 ? '' : 's' }} del archivo no se
        {{ store.sinMatch === 1 ? 'pudo' : 'pudieron' }} identificar en el catálogo.
      </div>
      <div v-for="aviso in store.avisos" :key="aviso" class="bg-slate-100 rounded-lg p-2 text-[11px] text-muted">
        {{ aviso }}
      </div>

      <div v-if="!store.items.length" class="bg-white rounded-2xl p-6 shadow-sm border text-center space-y-3">
        <i class="fas fa-magnifying-glass text-3xl text-muted"></i>
        <p class="text-sm font-semibold">No se encontró ningún producto del catálogo en este archivo.</p>
        <button class="w-full bg-primary text-white font-semibold py-3 rounded-xl shadow-sm active:scale-95" @click="importarOtra">
          <i class="fas fa-rotate-left mr-2"></i>Probar con otro archivo
        </button>
      </div>

      <div v-else class="bg-white rounded-xl shadow-sm border divide-y text-xs">
        <label
          v-for="item in store.items"
          :key="item.prod_id"
          class="p-3 flex gap-3 items-start"
          :class="!item.aplicable ? 'opacity-60' : ''"
        >
          <input
            v-model="item.seleccionado"
            type="checkbox"
            :disabled="!item.aplicable"
            class="mt-1 w-4 h-4 accent-accent shrink-0"
          />
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm truncate">{{ item.nombre_detectado || item.texto_original }}</p>
            <p class="text-muted">
              Costo {{ formatearMonto(item.costo_actual) }} →
              <strong class="text-ink">{{ formatearMonto(item.precio_detectado) }}</strong>
              · Venta actual {{ formatearMonto(item.precio_venta_actual) }}
            </p>
            <p v-if="!item.aplicable" class="text-danger mt-1">{{ item.motivo_no_aplicable }}</p>
          </div>
          <span
            v-if="item.aplicable"
            class="shrink-0 text-[11px] font-bold px-2 py-1 rounded"
            :class="item.margen_bajo ? 'bg-red-100 text-danger' : 'bg-green-100 text-success'"
          >
            {{ item.margen_proyectado_pct.toFixed(1) }}%
          </span>
        </label>
      </div>
    </div>

    <!-- Footer aplicar -->
    <div v-if="!store.analizando && store.items.length" class="sticky bottom-16 pt-2">
      <button
        class="w-full bg-success text-white font-semibold py-3 rounded-xl shadow-lg active:scale-95 disabled:opacity-60"
        :disabled="seleccionados === 0 || store.aplicando"
        @click="confirmar"
      >
        <i class="fas fa-check mr-2"></i>{{ store.aplicando ? 'Aplicando...' : `Aplicar seleccionados (${seleccionados})` }}
      </button>
    </div>
  </section>
</template>
