<script setup>
// El ERP no tiene un logo raster: la marca es siempre ícono + texto (mismo
// patrón que .saas-navbar-brand en apps/template_saas.php del backend).
const nombreComercio = import.meta.env.VITE_COMERCIO_NOMBRE || 'SWAI ERP'
</script>

<template>
  <div class="flex items-center gap-2 text-white min-w-0">
    <i class="fas fa-boxes-stacked"></i>
    <h1 class="font-bold text-sm truncate">{{ nombreComercio }} <span class="text-white/60 font-normal">Mobile</span></h1>
  </div>
</template>
