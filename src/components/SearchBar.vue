<script setup>
import { ref, watch } from 'vue'
import { useProductosStore } from '../stores/productos'
import { useAuthStore } from '../stores/auth'

const emit = defineEmits(['select'])

const productos = useProductosStore()
const auth = useAuthStore()
const query = ref('')
const mostrarResultados = ref(false)
let temporizador = null

watch(query, (valor) => {
  clearTimeout(temporizador)
  if (!valor) {
    mostrarResultados.value = false
    productos.resultados = []
    return
  }
  // Debounce: no dispara una búsqueda por cada tecla mientras se escribe.
  temporizador = setTimeout(async () => {
    await productos.buscar(valor)
    mostrarResultados.value = true
  }, 300)
})

function seleccionar(item) {
  query.value = ''
  mostrarResultados.value = false
  emit('select', item.prod_id)
}

function limpiar() {
  query.value = ''
  mostrarResultados.value = false
}

function alPerderFoco() {
  // Pequeño delay para que el click en un resultado se registre antes de
  // ocultar el dropdown (blur dispara antes que click en algunos navegadores).
  setTimeout(() => {
    mostrarResultados.value = false
  }, 150)
}
</script>

<template>
  <div class="relative">
    <div class="relative">
      <i class="fas fa-magnifying-glass absolute left-3 top-3.5 text-muted"></i>
      <!-- :value + @input en vez de v-model a propósito: v-model usa la directiva
           vModelText de Vue, que ignora el evento 'input' mientras el teclado está
           en composición IME (compositionstart -> compositionend) para no romper
           la escritura en CJK. En Android, Gboard envuelve TAMBIÉN la escritura
           predictiva en español en eventos de composición, así que con v-model
           "query" no se actualizaba (ni disparaba la búsqueda debounced) hasta
           que el input perdía el foco y forzaba el fin de la composición — cerrar
           el teclado "activaba" la búsqueda. Este input es texto libre sin
           formateo, así que es seguro reaccionar a cada tecla sin ese guard. -->
      <input
        :value="query"
        @input="query = $event.target.value"
        type="text"
        inputmode="search"
        autocomplete="off"
        placeholder="Nombre, código o marca..."
        class="w-full pl-10 pr-9 py-3 rounded-xl border border-slate-200 shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        @focus="mostrarResultados = !!query"
        @blur="alPerderFoco"
      />
      <button
        v-if="query"
        class="absolute right-2 top-2.5 w-6 h-6 rounded-full bg-slate-100 text-muted text-xs"
        @click="limpiar"
      >
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <div v-if="!query && productos.recientes.length" class="flex gap-2 mt-2 overflow-x-auto pb-1">
      <span class="text-[10px] text-muted flex items-center pr-1 shrink-0">Recientes:</span>
      <button
        v-for="p in productos.recientes"
        :key="p.prod_id"
        class="shrink-0 text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-full whitespace-nowrap"
        @click="seleccionar(p)"
      >
        {{ p.nombre }}
      </button>
    </div>

    <div
      v-if="mostrarResultados"
      class="absolute z-40 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-80 overflow-y-auto"
    >
      <div v-if="productos.cargando" class="p-4 text-center text-sm text-muted">Buscando...</div>
      <div v-else-if="!productos.resultados.length" class="p-4 text-center text-sm text-muted">
        Sin resultados. Probá con el código.
      </div>
      <!-- v-for va en el <button>, v-else en el <template> que lo envuelve:
           combinar v-for y v-else en el MISMO elemento es un anti-patrón de
           Vue 3 (el compilador no resuelve bien la precedencia) y rompía el
           binding del @click en cada resultado. -->
      <template v-else>
        <button
          v-for="p in productos.resultados"
          :key="p.prod_id"
          class="w-full text-left p-3 border-b border-slate-100 last:border-0 flex justify-between items-center hover:bg-slate-50 active:bg-slate-100"
          @mousedown.prevent="seleccionar(p)"
        >
          <div class="min-w-0">
            <p class="font-semibold text-sm truncate">{{ p.nombre }}</p>
            <p class="text-xs text-muted truncate">{{ p.codigo }} · {{ p.marca }} · Stock {{ p.stock_actual }}</p>
          </div>
          <span
            class="shrink-0 ml-2 text-xs font-bold px-2 py-1 rounded"
            :class="p.margen_pct < auth.config.margen_objetivo_pct ? 'bg-red-100 text-danger' : 'bg-green-100 text-success'"
          >
            {{ p.margen_pct.toFixed(1) }}%
          </span>
        </button>
      </template>
    </div>
  </div>
</template>
