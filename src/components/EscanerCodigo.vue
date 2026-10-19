<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { crearLector, mensajeErrorCamara } from '../utils/lectorCodigos'

defineProps({
  titulo: { type: String, default: 'Escanear código' },
  // Texto del botón cuando no se puede usar la cámara.
  textoSinCamara: { type: String, default: 'Buscar a mano' },
})
const emit = defineEmits(['detectado', 'cerrar'])

const video = ref(null)
const error = ref('')
const iniciando = ref(true)
let stream = null
let temporizador = null
let activo = true

// Unas 4 lecturas por segundo: suficiente para que se sienta inmediato sin
// recalentar un celular de gama baja.
const INTERVALO_MS = 250

function detener() {
  activo = false
  clearTimeout(temporizador)
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

async function iniciar() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('sin getUserMedia'), { name: 'SinSoporte' })
    }
    // Cámara y lector en paralelo. Si la cámara abre cuando ya se cerró el
    // escáner (o falló el lector), se apaga ahí mismo: si no, queda encendida.
    const camara = navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((s) => {
        if (activo) stream = s
        else s.getTracks().forEach((t) => t.stop())
      })
    const [lector] = await Promise.all([crearLector(), camara])
    if (!activo) return
    video.value.srcObject = stream
    await video.value.play()
    iniciando.value = false
    leer(lector)
  } catch (e) {
    iniciando.value = false
    error.value = mensajeErrorCamara(e)
    detener()
  }
}

async function leer(lector) {
  if (!activo) return
  try {
    if (video.value?.readyState >= 2) {
      const codigos = await lector.detect(video.value)
      const codigo = codigos.find((c) => c.rawValue)?.rawValue
      if (codigo && activo) {
        try {
          navigator.vibrate?.(60)
        } catch {
          // sin vibración
        }
        detener()
        emit('detectado', codigo.trim())
        return
      }
    }
  } catch {
    // Un frame que no se pudo procesar no corta el escaneo.
  }
  temporizador = setTimeout(() => leer(lector), INTERVALO_MS)
}

function cerrar() {
  detener()
  emit('cerrar')
}

onMounted(iniciar)
onBeforeUnmount(detener)
</script>

<template>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Escanear código de barras"
    class="fixed inset-0 z-[60] bg-black text-white flex flex-col"
    @keydown.esc="cerrar"
  >
    <div class="flex items-center justify-between px-4 py-3">
      <p class="font-semibold">{{ titulo }}</p>
      <button
        type="button"
        aria-label="Cerrar escáner"
        class="w-11 h-11 rounded-full bg-white/10 text-lg active:scale-95"
        @click="cerrar"
      >
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <div class="relative flex-1 overflow-hidden">
      <video ref="video" class="absolute inset-0 w-full h-full object-cover" muted playsinline></video>
      <!-- Guía de encuadre: un código de barras es ancho y bajo. -->
      <div v-if="!error" class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="w-4/5 max-w-sm h-40 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"></div>
      </div>
      <p v-if="iniciando" class="absolute inset-x-0 bottom-8 text-center text-sm text-white/80">Abriendo la cámara...</p>
      <p v-else-if="!error" class="absolute inset-x-0 bottom-8 text-center text-sm text-white/90">
        Apuntá al código de barras del producto
      </p>
      <div v-if="error" role="alert" class="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <i class="fas fa-camera text-3xl text-white/60"></i>
        <p class="text-sm">{{ error }}</p>
        <button type="button" class="h-11 px-5 rounded-xl bg-white text-primary font-semibold" @click="cerrar">
          {{ textoSinCamara }}
        </button>
      </div>
    </div>
  </div>
</template>
