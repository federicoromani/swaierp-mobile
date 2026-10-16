<script setup>
// Diálogo propio en vez de window.confirm(): el nativo bloquea la página y en
// Android se ve como un error del sistema, no como parte de la app.
defineProps({
  nombre: { type: String, default: '' },
})
defineEmits(['descartar', 'seguir'])
</script>

<template>
  <div class="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4" @click.self="$emit('seguir')">
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="descarte-titulo"
      aria-describedby="descarte-detalle"
      class="w-full max-w-sm bg-white rounded-2xl shadow-xl p-4 space-y-3"
    >
      <h2 id="descarte-titulo" class="font-bold text-base">¿Descartar los cambios?</h2>
      <p id="descarte-detalle" class="text-sm text-muted">
        Hay un conteo o un precio sin guardar<template v-if="nombre"> en <strong class="text-ink">{{ nombre }}</strong></template>.
      </p>
      <div class="flex gap-2 pt-1">
        <button
          type="button"
          class="flex-1 h-12 rounded-xl border border-slate-200 font-semibold text-sm active:scale-95"
          @click="$emit('seguir')"
        >
          Seguir editando
        </button>
        <button
          type="button"
          class="flex-1 h-12 rounded-xl bg-danger text-white font-semibold text-sm active:scale-95"
          @click="$emit('descartar')"
        >
          Descartar
        </button>
      </div>
    </div>
  </div>
</template>
