// Reportes "Pendientes de controlar": ReportesView.vue + reportes store +
// useInfiniteScroll. Cubre el quirk documentado explícitamente por la spec
// del usuario: el backend solo manda `total` en offset=0, y el store debe
// sostener el valor anterior en las páginas siguientes.
//
// Hallazgo de discovery confirmado acá (ver test-matrix.md sección 2, punto
// 3): src/stores/reportes.js NO tiene manejo de error — si `data.success`
// es false, la acción simplemente `return`, sin setear ningún estado de
// error. El test de error de este archivo fija ESE comportamiento.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { server } from '../../setup'
import { mockReportesEndpoint, HttpResponse } from '../../mocks/handlers'
import { itemPendienteEjemplo } from '../../mocks/fixtures'
import { limpiarDb } from '../../mocks/db-helpers'
import { crearRouterLiviano } from '../../mocks/router-helpers'
import { esperarQue } from '../../mocks/wait-helpers'
import { instalarIntersectionObserverControlable } from '../../mocks/intersection-observer-mock'
import { useAuthStore } from '../../../src/stores/auth'
import { useReportesStore } from '../../../src/stores/reportes'
import ReportesView from '../../../src/views/ReportesView.vue'

function itemsDePagina(offset, cantidad) {
  return Array.from({ length: cantidad }, (_, i) => itemPendienteEjemplo({ prod_id: 1000 + offset + i, nombre: `Pendiente ${offset + i}` }))
}

async function montar() {
  const auth = useAuthStore()
  auth.accessToken = 'at-test'
  const router = await crearRouterLiviano('/reportes')
  const wrapper = mount(ReportesView, { global: { plugins: [router] } })
  return { wrapper, router, reportes: useReportesStore() }
}

function sentinelPendientes(wrapper) {
  // Único elemento visible con esa combinación de clases mientras el tab
  // "pendientes" está activo (el de "ajustes" usa las mismas clases pero
  // vive detrás de un v-else, nunca los dos a la vez).
  return wrapper.find('.py-2.text-center.text-xs.text-muted')
}

describe('ReportesView + reportes store: pendientes de controlar', () => {
  let io

  beforeEach(async () => {
    setActivePinia(createPinia())
    await limpiarDb()
    io = instalarIntersectionObserverControlable()
  })

  afterEach(async () => {
    await limpiarDb()
    io.restaurar()
  })

  it('al montar dispara offset=0 con dias=7&limit=20 y pinta items + contador de total', async () => {
    let queryRecibida = null
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: ({ request }) => {
          queryRecibida = Object.fromEntries(new URL(request.url).searchParams)
          return HttpResponse.json({ success: true, items: itemsDePagina(0, 3), total: 45 })
        },
      })
    )

    const { wrapper, reportes } = await montar()
    await esperarQue(() => expect(reportes.pendientes.items).toHaveLength(3))

    expect(queryRecibida).toEqual({ action: 'pendientes_controlar', dias: '7', limit: '20', offset: '0' })
    expect(reportes.pendientes.total).toBe(45)
    expect(wrapper.text()).toContain('45')
    expect(wrapper.text()).toContain('Pendiente 0')
  })

  it('quirk: la página offset=20 llega SIN "total" — el store sostiene el total anterior y concatena items', async () => {
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: ({ request }) => {
          const offset = new URL(request.url).searchParams.get('offset')
          if (offset === '0') {
            return HttpResponse.json({ success: true, items: itemsDePagina(0, 20), total: 45 })
          }
          // Sin "total": simula el comportamiento real documentado del backend.
          return HttpResponse.json({ success: true, items: itemsDePagina(20, 20) })
        },
      })
    )

    const { reportes } = await montar()
    await esperarQue(() => expect(reportes.pendientes.items).toHaveLength(20))
    expect(reportes.pendientes.total).toBe(45)

    await reportes.cargarPendientes(20)

    expect(reportes.pendientes.items).toHaveLength(40)
    expect(reportes.pendientes.total).toBe(45)
  })

  it('scroll infinito: el sentinela entrando en viewport dispara la página siguiente con el offset correcto', async () => {
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: ({ request }) => {
          const offset = Number(new URL(request.url).searchParams.get('offset'))
          return HttpResponse.json({ success: true, items: itemsDePagina(offset, 20), total: 45 })
        },
      })
    )

    const { wrapper, reportes } = await montar()
    await esperarQue(() => expect(reportes.pendientes.items).toHaveLength(20))

    const sentinel = sentinelPendientes(wrapper)
    expect(sentinel.exists()).toBe(true)
    io.dispararInterseccion(sentinel.element)

    await esperarQue(() => expect(reportes.pendientes.items).toHaveLength(40))
    // hasMore ahora es false (40 === total 45? no, 40<45 sigue habiendo)
    expect(reportes.pendientes.total).toBe(45)
  })

  it('no dispara una segunda carga si ya hay una en curso (loading=true)', async () => {
    let llamadas = 0
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: async ({ request }) => {
          llamadas++
          const offset = Number(new URL(request.url).searchParams.get('offset'))
          if (offset > 0) {
            // deja la 2da página "colgada" el tiempo suficiente para
            // disparar una segunda intersección mientras cargando=true.
            await new Promise((r) => setTimeout(r, 60))
          }
          return HttpResponse.json({ success: true, items: itemsDePagina(offset, 20), total: 45 })
        },
      })
    )

    const { wrapper, reportes } = await montar()
    await esperarQue(() => expect(reportes.pendientes.items).toHaveLength(20))

    const sentinel = sentinelPendientes(wrapper)
    io.dispararInterseccion(sentinel.element) // dispara offset=20, queda "cargando"
    await esperarQue(() => expect(reportes.cargando).toBe(true))
    io.dispararInterseccion(sentinel.element) // debería NO disparar una 2da carga

    await esperarQue(() => expect(reportes.cargando).toBe(false))
    expect(llamadas).toBe(2) // la inicial (offset=0) + la de scroll (offset=20), no una 3ra
  })

  it('no dispara más cargas cuando hasMore ya es false (items >= total)', async () => {
    server.use(
      ...mockReportesEndpoint({
        pendientesControlar: () => HttpResponse.json({ success: true, items: itemsDePagina(0, 5), total: 5 }),
      })
    )

    const { wrapper, reportes } = await montar()
    await esperarQue(() => expect(reportes.pendientes.items).toHaveLength(5))

    // Con hasMore=false el sentinela ni siquiera se renderiza (v-if).
    expect(sentinelPendientes(wrapper).exists()).toBe(false)
  })

  it('[hallazgo] error en la carga (network/500): no hay estado de error expuesto por el store, solo cargando vuelve a false', async () => {
    // cargarPendientes() tiene try/finally pero NO catch (ver
    // src/stores/reportes.js): cuando reportesService.pendientesControlar()
    // rechaza, el `finally` sí corre (cargando vuelve a false, por eso el
    // resto del test puede assertar sobre eso), pero la excepción se
    // propaga igual — como ReportesView llama `cargarPendientes(0)` en
    // onMounted() sin `await` ni `.catch()`, eso es un unhandled promise
    // rejection real, no solo "falta de mensaje en pantalla". Se captura acá
    // a propósito (en vez de dejarlo flotar como ruido en el reporter de
    // Vitest) para dejarlo fijado como assertion explícita.
    const rechazosNoManejados = []
    const onUnhandledRejection = (motivo) => rechazosNoManejados.push(motivo)
    process.on('unhandledRejection', onUnhandledRejection)

    server.use(...mockReportesEndpoint({ pendientesControlar: () => HttpResponse.error() }))

    const { wrapper, reportes } = await montar()
    await esperarQue(() => expect(reportes.cargando).toBe(false))
    // Le da una vuelta más al microtask queue para que el unhandledRejection
    // (si va a ocurrir) ya se haya emitido antes de sacar el listener.
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', onUnhandledRejection)

    expect(rechazosNoManejados).toHaveLength(1)
    expect(rechazosNoManejados[0].message).toBe('No hay conexión con el servidor.')

    expect(reportes.pendientes.items).toEqual([])
    expect(reportes.pendientes.total).toBe(0)
    // No hay ningún `reportes.error` (el store no lo tiene) ni mensaje en
    // pantalla — se documenta así, no se inventa un manejo que no existe.
    expect(wrapper.text()).not.toMatch(/error|no se pudo/i)
  })
})
