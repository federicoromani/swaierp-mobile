<script setup>
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useReportesStore } from '../stores/reportes'
import { importarHabilitado } from '../config/features'

const route = useRoute()
const auth = useAuthStore()
const reportes = useReportesStore()

function activo(prefijo) {
  return route.path.startsWith(prefijo) ? 'text-accent' : 'text-muted'
}
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-2 z-50">
    <router-link to="/buscar" class="flex flex-col items-center gap-1 text-xs font-semibold min-w-16" :class="activo('/buscar')">
      <i class="fas fa-barcode text-lg"></i>
      <span>Contar</span>
    </router-link>
    <!-- El backend restringe la importación a ADMINISTRADOR(1)/AVANZADO(2)
         (apiRequireRol en api_importacion_precios.php) -- esto es solo UX,
         para no mostrarle a un usuario FISCAL(3) un botón que le va a
         devolver 403. Además se oculta si la pantalla está deshabilitada
         para este comercio (VITE_IMPORTAR_HABILITADO). -->
    <router-link
      v-if="importarHabilitado() && auth.usuario?.rol !== 3"
      to="/importar"
      class="flex flex-col items-center gap-1 text-xs font-semibold min-w-16"
      :class="activo('/importar')"
    >
      <i class="fas fa-wand-magic-sparkles text-lg"></i>
      <span>IA Lista PDF</span>
    </router-link>
    <router-link to="/reportes" class="flex flex-col items-center gap-1 text-xs font-semibold min-w-16" :class="activo('/reportes')">
      <!-- El número va dentro del <i> (no en un wrapper): así el ícono queda
           alineado con los de las otras pestañas. -->
      <i class="fas fa-list-check text-lg relative">
        <span
          v-if="reportes.pendientes.total > 0"
          class="absolute -top-1.5 left-3.5 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] leading-5 text-center font-bold font-sans"
          aria-hidden="true"
        >{{ reportes.pendientes.total > 99 ? '99+' : reportes.pendientes.total }}</span>
      </i>
      <span>Pendientes<span v-if="reportes.pendientes.total > 0" class="sr-only"> ({{ reportes.pendientes.total }})</span></span>
    </router-link>
  </nav>
</template>
