<script setup>
import { RouterView, useRoute } from 'vue-router'
import { computed, onMounted, onBeforeUnmount } from 'vue'
import TabBar from './components/TabBar.vue'
import AppBrand from './components/AppBrand.vue'
import { useUiStore } from './stores/ui'
import { useTecladoVirtual } from './composables/useTecladoVirtual'

const ui = useUiStore()
const route = useRoute()
// Con el teclado abierto (interactive-widget=resizes-content) la tab bar
// quedaría flotando pegada encima del teclado, tapando el formulario.
const tecladoAbierto = useTecladoVirtual()

// El login (y cualquier vista futura marcada requiresAuth:false) no lleva
// header ni tab bar del ERP.
const mostrarChrome = computed(() => route.meta.requiresAuth !== false)
// Pantallas enfocadas (modo conteo) tampoco llevan tab bar.
const mostrarTabBar = computed(() => mostrarChrome.value && !route.meta.sinTabBar)

function alCambiarRed() {
  ui.setNavegadorOnline(navigator.onLine)
}
onMounted(() => {
  alCambiarRed()
  window.addEventListener('online', alCambiarRed)
  window.addEventListener('offline', alCambiarRed)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', alCambiarRed)
  window.removeEventListener('offline', alCambiarRed)
})
</script>

<template>
  <div class="min-h-screen bg-surface text-ink font-sans">
    <header v-if="mostrarChrome" class="bg-primary px-4 py-2.5 sticky top-0 z-40 shadow-md flex justify-between items-center gap-2">
      <AppBrand />
      <!-- Solo aparece si hay un problema: con conexión no aporta nada y un
           "Conectado" fijo engaña justo cuando importa (guardar sin red). -->
      <div
        v-if="ui.problemaConexion"
        role="status"
        class="flex items-center gap-2 text-xs font-semibold text-amber-950 bg-amber-400 px-3 py-1.5 rounded-full"
      >
        <i class="fas fa-wifi"></i>
        {{ ui.problemaConexion }}
      </div>
    </header>

    <main class="p-4 max-w-lg mx-auto" :class="mostrarTabBar ? 'pb-20' : ''">
      <RouterView />
    </main>

    <transition name="fade">
      <div
        v-if="ui.toast"
        class="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-sm text-white z-50 max-w-[90vw] text-center"
        :class="{
          'bg-danger': ui.toast.tipo === 'error',
          'bg-success': ui.toast.tipo === 'success',
          'bg-primary': ui.toast.tipo === 'info',
        }"
      >
        {{ ui.toast.mensaje }}
      </div>
    </transition>

    <TabBar v-if="mostrarTabBar && !tecladoAbierto" />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
