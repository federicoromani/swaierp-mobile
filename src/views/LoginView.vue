<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const usuario = ref('')
const clave = ref('')
const error = ref('')
const enviando = ref(false)

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const nombreComercio = import.meta.env.VITE_COMERCIO_NOMBRE || 'SWAI ERP'

async function enviar() {
  error.value = ''
  enviando.value = true
  try {
    await auth.login(usuario.value, clave.value)
    router.replace((route.query.redirect ?? '/buscar').toString())
  } catch (e) {
    error.value = e.message || 'No se pudo iniciar sesión.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface px-4">
    <div class="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
      <div class="flex flex-col items-center gap-2 text-primary">
        <i class="fas fa-boxes-stacked text-3xl"></i>
        <h1 class="font-bold text-lg text-center">{{ nombreComercio }}</h1>
        <p class="text-xs text-muted">Stock y precios</p>
      </div>

      <form class="space-y-3" @submit.prevent="enviar">
        <div>
          <label class="block text-xs text-muted font-medium mb-1">Usuario</label>
          <input
            v-model="usuario"
            type="text"
            autocomplete="username"
            required
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label class="block text-xs text-muted font-medium mb-1">Clave</label>
          <input
            v-model="clave"
            type="password"
            autocomplete="current-password"
            required
            class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <p v-if="error" class="text-xs text-danger bg-red-50 border border-red-200 rounded-lg p-2">
          {{ error }}
        </p>

        <button
          type="submit"
          :disabled="enviando"
          class="w-full bg-primary text-white font-semibold py-3 rounded-xl shadow-sm active:scale-95 disabled:opacity-60"
        >
          <i class="fas fa-right-to-bracket mr-2"></i>{{ enviando ? 'Ingresando...' : 'Ingresar' }}
        </button>
      </form>
    </div>
  </div>
</template>
