<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useProductosStore } from '../stores/productos'
import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'
import { textoRelativo, urgenciaConteo } from '../utils/fechas'
import { unidadCorta, esUnidadEntera } from '../utils/unidades'
import EscanerCodigo from './EscanerCodigo.vue'

const props = defineProps({
  // Código escaneado en el buscador que no es de ningún producto: la card
  // ofrece asignárselo al producto abierto.
  codigoPorAsignar: { type: String, default: null },
})
// codigo-asignado: se guardó el código de barras (codigoPorAsignar o uno
// escaneado desde la card). descartar-codigo: no era de este producto.
const emit = defineEmits(['guardado', 'codigo-asignado', 'descartar-codigo'])

const productos = useProductosStore()
const auth = useAuthStore()
const ui = useUiStore()

// Lo contado arranca VACÍO, no precargado con el stock del sistema: un campo
// que ya dice "25" invita a confirmar sin contar. Vacío + "Coincide: 25 u"
// deja el caso más común en un toque, pero como decisión explícita.
const contado = ref('')
const costo = ref(0)
const precioVenta = ref(0)
const guardando = ref(false)
const precioAbierto = ref(false)
const envasesAbierto = ref(false)
// cantidad de envases cerrados por presentación (id -> cantidad) + sueltas.
const envases = ref({})
const sueltas = ref('')
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

function limpiarConteo() {
  contado.value = ''
  envases.value = {}
  sueltas.value = ''
}

function cargarDesdeProducto(p) {
  limpiarConteo()
  cargarPrecio(p)
}

// El formulario se resetea al valor del producto cada vez que cambia CUÁL
// producto está seleccionado (no en cada actualización de actual.value, para
// no pisar lo que el usuario está tipeando si solo una parte se guardó).
watch(
  () => productos.actual?.prod_id,
  () => {
    if (productos.actual) cargarDesdeProducto(productos.actual)
    envasesAbierto.value = false
  },
  { immediate: true }
)

function formatear(n) {
  return Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 })
}

const p = computed(() => productos.actual)
const sistema = computed(() => Number(p.value?.stock_actual) || 0)
const unidad = computed(() => unidadCorta(p.value?.unidad))
// Unidades que no se fraccionan: teclado numérico sin coma.
const esEntera = computed(() => esUnidadEntera(p.value?.unidad))
const meta = computed(() => [p.value?.codigo, p.value?.marca, p.value?.categoria].filter(Boolean).join(' · '))
const ultimoConteo = computed(() => textoRelativo(p.value?.ultimo_conteo))
const urgencia = computed(() => urgenciaConteo(p.value?.ultimo_conteo))
const presentaciones = computed(() => p.value?.presentaciones || [])

const contadoIngresado = computed(() => contado.value !== '' && contado.value !== null && contado.value !== undefined)
const diferencia = computed(() =>
  contadoIngresado.value ? Math.round((Number(contado.value) - sistema.value) * 1000) / 1000 : null
)

// Cambios sin guardar respecto de productos.actual (lo último persistido).
// Tolerancia de medio centavo: precio_venta llega del backend con más
// decimales que el redondeo a 2 que hace alCambiarCosto().
function distinto(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) >= 0.005
}
const cambioConteo = contadoIngresado
const cambioPrecio = computed(
  () => !!p.value && (distinto(costo.value, p.value.costo) || distinto(precioVenta.value, p.value.precio_venta))
)
const hayCambios = computed(() => cambioConteo.value || cambioPrecio.value)

// Para que Buscar / el modo conteo pregunten antes de descartar lo tipeado.
watch(hayCambios, (v) => (productos.cambiosSinGuardar = v), { immediate: true })
onBeforeUnmount(() => (productos.cambiosSinGuardar = false))

const etiquetaBoton = computed(() => {
  if (guardando.value) return 'Guardando...'
  if (!hayCambios.value) return `Coincide: ${formatear(sistema.value)} ${unidad.value}`
  if (cambioConteo.value && cambioPrecio.value) return 'Guardar conteo y precio'
  return cambioConteo.value ? 'Guardar conteo' : 'Guardar precio'
})

function reiniciar() {
  cargarDesdeProducto(p.value)
}

function ajustarStepper(delta) {
  const base = contadoIngresado.value ? Number(contado.value) : sistema.value
  contado.value = Math.max(0, base + delta)
}

// Al tocar el campo se selecciona todo: tipear reemplaza en vez de sumar dígitos.
function seleccionarTodo(e) {
  e.target.select?.()
}

const totalEnvases = computed(() => {
  const porEnvases = presentaciones.value.reduce(
    (acc, pres) => acc + (Number(envases.value[pres.id]) || 0) * pres.factor,
    0
  )
  return Math.round((porEnvases + (Number(sueltas.value) || 0)) * 1000) / 1000
})

function usarTotalEnvases() {
  contado.value = totalEnvases.value
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

const margenObjetivo = computed(() => auth.config.margen_objetivo_pct ?? 30)
const margenBajo = computed(() => margenActual.value < margenObjetivo.value)
const margenTexto = computed(
  () => `${margenActual.value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
)

// --- Código de barras ---
const escaneandoCodigo = ref(false)
const guardandoCodigo = ref(false)
const proponerCodigo = computed(
  () => !!props.codigoPorAsignar && props.codigoPorAsignar !== p.value?.codigo_barras
)

/** @param {string} codigo '' para quitarlo. */
async function guardarCodigo(codigo) {
  if (guardandoCodigo.value) return
  if (codigo && codigo === p.value.codigo_barras) {
    ui.mostrarToast('Ese ya es el código de barras de este producto.', 'info')
    return
  }
  guardandoCodigo.value = true
  try {
    await productos.asignarCodigoBarras(p.value.prod_id, codigo)
    vibrar()
    ui.mostrarToast(codigo ? 'Código de barras guardado.' : 'Código de barras quitado.', 'success')
    if (codigo) emit('codigo-asignado', codigo)
  } catch (e) {
    ui.mostrarToast(e.message, 'error')
  } finally {
    guardandoCodigo.value = false
  }
}

function alEscanearCodigo(codigo) {
  escaneandoCodigo.value = false
  guardarCodigo(codigo)
}

function formatearDiferencia(n) {
  if (!n) return 'sin diferencias'
  return (n > 0 ? '+' : '') + formatear(n)
}

function vibrar() {
  try {
    navigator.vibrate?.(40)
  } catch {
    // Sin soporte (iOS, desktop): no pasa nada.
  }
}

// Sin cambios, el botón confirma que lo contado coincide con el sistema: eso
// también tiene que quedar registrado (si no, el producto sigue "sin
// controlar" para siempre).
//
// Con cambios, manda solo lo que cambió: registrar_conteo asienta un conteo y
// actualizar_precio un ajuste de precio, así que guardar uno no debe asentar
// el otro. Si una parte falla, la otra queda guardada y el form conserva lo
// tipeado en la que falló.
async function guardar() {
  // Guard explícito: el :disabled del botón llega un tick tarde ante un doble
  // click sincrónico.
  if (guardando.value) return
  guardando.value = true
  const prodId = p.value.prod_id
  const contar = cambioConteo.value || !hayCambios.value
  const valorContado = cambioConteo.value ? Number(contado.value) : sistema.value
  const guardarPrecio = cambioPrecio.value
  let dif = 0
  const guardados = []
  const fallas = []
  try {
    if (contar) {
      try {
        const resultado = await productos.registrarConteo(prodId, valorContado)
        dif = resultado.diferencia
        limpiarConteo()
        guardados.push('conteo')
      } catch (e) {
        fallas.push({ parte: 'conteo', mensaje: e.message })
      }
    }
    if (guardarPrecio) {
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
    vibrar()
    if (guardados.length > 1) {
      ui.mostrarToast(`Conteo registrado (${formatearDiferencia(dif)}) y precio actualizado.`, 'success')
    } else {
      ui.mostrarToast(
        guardados[0] === 'conteo' ? `Conteo registrado: ${formatearDiferencia(dif)}.` : 'Precio actualizado.',
        'success'
      )
    }
  } else if (guardados.length > 0) {
    ui.mostrarToast(`Se guardó el ${guardados[0]}, pero no el ${fallas[0].parte}: ${fallas[0].mensaje}`, 'error')
  } else if (fallas.length > 1) {
    ui.mostrarToast(fallas.map((f) => `${f.parte === 'conteo' ? 'Conteo' : 'Precio'}: ${f.mensaje}`).join(' '), 'error')
  } else {
    ui.mostrarToast(fallas[0].mensaje, 'error')
  }

  if (guardados.length > 0) {
    emit('guardado', { conteo: guardados.includes('conteo'), diferencia: dif })
  }
}
</script>

<template>
  <div v-if="p" class="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-4">
    <header>
      <p class="text-xs text-muted truncate">{{ meta }}</p>
      <h2 class="font-bold text-lg leading-snug mt-0.5 line-clamp-2">{{ p.nombre }}</h2>
      <p
        class="text-xs mt-1 font-medium"
        :class="{
          'text-danger': urgencia === 'nunca' || urgencia === 'critico',
          'text-amber-700': urgencia === 'vencido',
          'text-success': urgencia === 'al-dia',
          'text-muted': urgencia === null,
        }"
      >
        <i class="fas fa-clipboard-check mr-1"></i>Último conteo: {{ ultimoConteo }}
      </p>
      <div class="flex items-center justify-between gap-2 mt-2">
        <p class="min-w-0 truncate text-sm" :class="p.codigo_barras ? 'font-mono' : 'text-muted'">
          <i class="fas fa-barcode mr-1.5 text-muted"></i>{{ p.codigo_barras || 'Sin código de barras' }}
        </p>
        <div class="flex gap-1.5 shrink-0">
          <button
            v-if="p.codigo_barras"
            type="button"
            aria-label="Quitar código de barras"
            :disabled="guardandoCodigo"
            class="h-10 px-3 rounded-lg border border-slate-200 text-sm text-muted active:scale-95 disabled:opacity-50"
            @click="guardarCodigo('')"
          >
            Quitar
          </button>
          <button
            type="button"
            :aria-label="p.codigo_barras ? 'Cambiar código de barras' : 'Asignar código de barras'"
            :disabled="guardandoCodigo"
            class="h-10 px-3 rounded-lg border border-slate-200 text-sm font-semibold text-primary active:scale-95 disabled:opacity-50"
            @click="escaneandoCodigo = true"
          >
            <i class="fas fa-camera mr-1"></i>{{ p.codigo_barras ? 'Cambiar' : 'Asignar' }}
          </button>
        </div>
      </div>
    </header>

    <div v-if="proponerCodigo" role="status" class="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-2">
      <p class="text-sm">
        Escaneaste <strong class="font-mono">{{ codigoPorAsignar }}</strong>, que no es de ningún producto.
        <template v-if="p.codigo_barras">Reemplazaría al código actual.</template>
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          :disabled="guardandoCodigo"
          class="flex-1 h-11 rounded-xl bg-primary text-white text-sm font-semibold active:scale-95 disabled:opacity-60"
          @click="guardarCodigo(codigoPorAsignar)"
        >
          <i class="fas fa-barcode mr-1.5"></i>Asignar a este producto
        </button>
        <button
          type="button"
          aria-label="No asignar el código escaneado"
          class="h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm text-muted active:scale-95"
          @click="emit('descartar-codigo')"
        >
          No
        </button>
      </div>
    </div>

    <section class="space-y-2">
      <div class="flex items-stretch gap-3">
        <div class="w-24 shrink-0 rounded-xl bg-slate-50 border border-slate-200 p-2 text-center flex flex-col justify-center">
          <p class="text-xs text-muted">Sistema</p>
          <p class="text-2xl font-bold leading-tight">{{ formatear(sistema) }}</p>
          <p class="text-xs text-muted">{{ unidad }}</p>
        </div>
        <div
          class="flex-1 min-w-0 rounded-xl border-2 p-2"
          :class="contadoIngresado ? 'border-accent bg-blue-50/40' : 'border-slate-200'"
        >
          <label for="stock-contado" class="block text-xs font-semibold text-muted text-center">Contado</label>
          <div class="flex items-center gap-2 mt-1">
            <button
              type="button"
              aria-label="Restar uno"
              class="w-12 h-12 shrink-0 rounded-xl bg-white border border-slate-200 shadow-sm text-xl font-bold active:scale-95"
              @click="ajustarStepper(-1)"
            >−</button>
            <input
              id="stock-contado"
              v-model.number="contado"
              aria-label="Stock contado"
              type="number"
              min="0"
              :step="esEntera ? 1 : 'any'"
              :inputmode="esEntera ? 'numeric' : 'decimal'"
              :placeholder="formatear(sistema)"
              class="flex-1 min-w-0 h-12 text-center text-2xl font-bold bg-transparent placeholder:text-slate-300 focus:outline-none"
              @focus="seleccionarTodo"
            />
            <button
              type="button"
              aria-label="Sumar uno"
              class="w-12 h-12 shrink-0 rounded-xl bg-white border border-slate-200 shadow-sm text-xl font-bold active:scale-95"
              @click="ajustarStepper(1)"
            >+</button>
          </div>
        </div>
      </div>

      <p
        v-if="contadoIngresado"
        class="text-sm font-semibold text-center"
        :class="diferencia === 0 ? 'text-success' : diferencia < 0 ? 'text-danger' : 'text-amber-700'"
      >
        <template v-if="diferencia === 0"><i class="fas fa-check mr-1"></i>Coincide con el sistema</template>
        <template v-else-if="diferencia < 0">Faltan {{ formatear(-diferencia) }} {{ unidad }}</template>
        <template v-else>Sobran {{ formatear(diferencia) }} {{ unidad }}</template>
      </p>

      <div v-if="presentaciones.length" class="rounded-xl border border-slate-200">
        <button
          type="button"
          class="w-full flex justify-between items-center px-3 py-2 text-sm font-medium"
          :aria-expanded="envasesAbierto"
          @click="envasesAbierto = !envasesAbierto"
        >
          <span><i class="fas fa-box mr-2 text-muted"></i>Contar por envases</span>
          <i class="fas text-muted" :class="envasesAbierto ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
        </button>
        <div v-if="envasesAbierto" class="px-3 pb-3 space-y-2 border-t border-slate-100 pt-2">
          <div v-for="pres in presentaciones" :key="pres.id" class="flex items-center justify-between gap-2">
            <label :for="`envase-${pres.id}`" class="text-sm min-w-0 truncate">
              {{ pres.nombre }} <span class="text-muted">(× {{ formatear(pres.factor) }})</span>
            </label>
            <input
              :id="`envase-${pres.id}`"
              v-model.number="envases[pres.id]"
              type="number"
              min="0"
              inputmode="numeric"
              placeholder="0"
              class="w-20 h-10 text-center text-lg font-bold rounded-lg border border-slate-200"
              @focus="seleccionarTodo"
            />
          </div>
          <div class="flex items-center justify-between gap-2">
            <label for="envase-sueltas" class="text-sm">Sueltas ({{ unidad }})</label>
            <input
              id="envase-sueltas"
              v-model.number="sueltas"
              type="number"
              min="0"
              :inputmode="esEntera ? 'numeric' : 'decimal'"
              placeholder="0"
              class="w-20 h-10 text-center text-lg font-bold rounded-lg border border-slate-200"
              @focus="seleccionarTodo"
            />
          </div>
          <button
            type="button"
            :disabled="totalEnvases <= 0"
            class="w-full h-11 rounded-xl bg-slate-800 text-white text-sm font-semibold disabled:opacity-40 active:scale-95"
            @click="usarTotalEnvases"
          >
            Usar total: {{ formatear(totalEnvases) }} {{ unidad }}
          </button>
        </div>
      </div>
    </section>

    <section aria-label="Precio y margen" class="rounded-xl border border-slate-200">
      <button
        type="button"
        class="w-full flex justify-between items-center gap-2 px-3 py-2.5"
        :aria-expanded="precioAbierto"
        @click="precioAbierto = !precioAbierto"
      >
        <span class="text-sm font-medium"><i class="fas fa-tag mr-2 text-muted"></i>Precio y margen</span>
        <span class="flex items-center gap-2">
          <span class="text-sm font-semibold">${{ formatear(precioVenta) }}</span>
          <span
            class="text-xs font-bold px-2 py-0.5 rounded-md"
            :class="margenBajo ? 'bg-red-100 text-danger' : 'bg-green-100 text-success'"
          >{{ margenTexto }}</span>
          <i class="fas text-muted text-xs" :class="precioAbierto ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
        </span>
      </button>
      <div v-if="precioAbierto" class="px-3 pb-3 pt-2 space-y-3 border-t border-slate-100">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="precio-costo" class="block text-xs text-muted font-medium mb-1">Precio de costo ($)</label>
            <input
              id="precio-costo"
              v-model.number="costo"
              aria-label="Precio de costo"
              type="number"
              inputmode="decimal"
              class="w-full h-11 px-2 text-right font-bold text-lg rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-accent"
              @focus="seleccionarTodo"
              @input="alCambiarCosto"
            />
          </div>
          <div>
            <label for="precio-venta" class="block text-xs text-muted font-medium mb-1">Precio de venta ($)</label>
            <input
              id="precio-venta"
              v-model.number="precioVenta"
              aria-label="Precio de venta"
              type="number"
              inputmode="decimal"
              class="w-full h-11 px-2 text-right font-bold text-lg rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-accent"
              @focus="seleccionarTodo"
              @input="alCambiarPrecioVenta"
            />
          </div>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-xs text-muted">Margen actual</span>
          <div class="flex items-center gap-2">
            <span
              class="font-bold px-2 py-1 rounded-lg text-sm"
              :class="margenBajo ? 'bg-red-100 text-danger' : 'bg-green-100 text-success'"
            >{{ margenTexto }}</span>
            <span class="text-xs font-semibold px-2 py-1 rounded-lg bg-sky-100 text-sky-700">Objetivo {{ margenObjetivo }}%</span>
          </div>
        </div>
        <p v-if="margenBajo" class="text-xs text-danger bg-red-50 border border-red-200 rounded-lg p-2">
          <i class="fas fa-triangle-exclamation mr-1"></i>El margen quedó por debajo del mínimo definido.
        </p>
        <p class="text-xs text-muted">Precio ajustado: {{ textoRelativo(p.ultimo_ajuste_precio) }}</p>
      </div>
    </section>

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
        :disabled="guardando"
        class="flex-1 h-12 bg-success text-white font-semibold rounded-xl shadow-sm active:scale-95 disabled:opacity-60"
        @click="guardar"
      >
        <i class="fas mr-2" :class="hayCambios ? 'fa-check' : 'fa-clipboard-check'"></i>{{ etiquetaBoton }}
      </button>
    </div>

    <EscanerCodigo
      v-if="escaneandoCodigo"
      titulo="Asignar código de barras"
      texto-sin-camara="Cerrar"
      @detectado="alEscanearCodigo"
      @cerrar="escaneandoCodigo = false"
    />
  </div>
</template>
