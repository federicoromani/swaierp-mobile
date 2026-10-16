<script setup>
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { importarHabilitado } from '../config/features'

const route = useRoute()
const auth = useAuthStore()

function activo(prefijo) {
  return route.path.startsWith(prefijo) ? 'text-accent' : 'text-muted'
}
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-2 z-50">
    <router-link to="/buscar" class="flex flex-col items-center gap-1 text-xs font-semibold" :class="activo('/buscar')">
      <i class="fas fa-boxes-packing text-lg"></i>
      <span>Stock/Precio</span>
    </router-link>
    <!-- El backend restringe la importación a ADMINISTRADOR(1)/AVANZADO(2)
         (apiRequireRol en api_importacion_precios.php) -- esto es solo UX,
         para no mostrarle a un usuario FISCAL(3) un botón que le va a
         devolver 403. Además se oculta si la pantalla está deshabilitada
         para este comercio (VITE_IMPORTAR_HABILITADO). -->
    <router-link
      v-if="importarHabilitado() && auth.usuario?.rol !== 3"
      to="/importar"
      class="flex flex-col items-center gap-1 text-xs font-semibold"
      :class="activo('/importar')"
    >
      <i class="fas fa-wand-magic-sparkles text-lg"></i>
      <span>IA Lista PDF</span>
    </router-link>
    <router-link to="/reportes" class="flex flex-col items-center gap-1 text-xs font-semibold" :class="activo('/reportes')">
      <i class="fas fa-chart-line text-lg"></i>
      <span>Reporte</span>
    </router-link>
  </nav>
</template>
