<script setup>
import { computed } from 'vue'
import { textoRelativo, urgenciaConteo } from '../utils/fechas'

const props = defineProps({
  ultimoConteo: { type: String, default: null },
})

const urgencia = computed(() => urgenciaConteo(props.ultimoConteo))
</script>

<template>
  <span
    class="shrink-0 text-xs px-2 py-1 rounded-md font-semibold whitespace-nowrap"
    :class="{
      'bg-red-100 text-danger': urgencia === 'nunca' || urgencia === 'critico',
      'bg-amber-100 text-amber-800': urgencia === 'vencido',
      'bg-slate-100 text-muted': urgencia === 'al-dia' || urgencia === null,
    }"
  >
    {{ ultimoConteo ? textoRelativo(ultimoConteo) : 'nunca' }}
  </span>
</template>
