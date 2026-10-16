<template>
  <!-- Mismo esqueleto que ProductoCard mientras carga el detalle: evita el
       salto de "nada" a la card completa y deja claro que algo está pasando. -->
  <div
    class="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-4 animate-pulse"
    role="status"
    aria-label="Cargando producto"
  >
    <div class="space-y-2">
      <div class="h-3 w-1/2 rounded bg-slate-200"></div>
      <div class="h-5 w-4/5 rounded bg-slate-200"></div>
      <div class="h-3 w-1/3 rounded bg-slate-200"></div>
    </div>
    <div class="flex gap-3">
      <div class="w-24 h-20 rounded-xl bg-slate-100"></div>
      <div class="flex-1 h-20 rounded-xl bg-slate-100"></div>
    </div>
    <div class="h-11 rounded-xl bg-slate-100"></div>
    <div class="h-12 rounded-xl bg-slate-200"></div>
  </div>
</template>
