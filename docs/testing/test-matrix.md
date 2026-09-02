# Matriz de tests — swaierp-mobile (Ronda 1 discovery + Ronda 2 implementación)

Documento de coordinación entre los 3 subagentes de testing. Cada uno hizo su
propio discovery de forma independiente y ya delimitó explícitamente su
frontera con los otros dos (ver "Qué NO cubro" en cada plan) — este documento
es la síntesis: un inventario único de qué archivo de test cubre qué, el
orden de ejecución, y los hallazgos de código que aparecieron cruzados entre
varios agentes (y que valen como reporte de calidad aparte de los tests en
sí).

Planes fuente completos (no se resumen acá, son la referencia autoritativa
para la implementación):
- [`plan-agente-1-unit.md`](./plan-agente-1-unit.md) — Vitest + Vue Test Utils, sin red, `createTestingPinia`.
- [`plan-agente-2-integration.md`](./plan-agente-2-integration.md) — Vitest + MSW, stores reales + `apiClient` real, sin componente montado salvo cuando el flujo lo requiere.
- [`plan-agente-3-e2e.md`](./plan-agente-3-e2e.md) — Playwright, browser real, `page.route()` en vez de backend real (no hay credenciales de prueba disponibles).

Verificado por el orquestador antes de esta síntesis: las 3 fronteras
declaradas son consistentes entre sí (nadie cubre por partida doble lo que
otro ya cubre, sin huecos aparentes) — único caso de aparente solapamiento
(scroll infinito testeado en las 3 capas) es en realidad complementario: cada
capa prueba un aspecto distinto (lógica del guard → integración con
paginación real vía MSW → `IntersectionObserver` real del browser). Se deja
así a propósito.

---

## 1. Inventario de archivos de test (las 3 capas)

### Unit (`tests/unit/`) — Subagente 1

| Archivo | Cubre | Prioridad dominante |
|---|---|---|
| `composables/useCompresionImagen.spec.js` | Redimensionado/reencode antes de subir | P0 |
| `composables/useInfiniteScroll.spec.js` | Guards `hasMore`/`loading`, reconexión de observer | P0 |
| `stores/auth.spec.js` | login/logout/refresh/restaurarSesion, Dexie | P0 |
| `stores/productos.spec.js` | buscar/seleccionar/actualizarPrecio/ajustarStock, cache offline, recientes | P0 |
| `stores/reportes.spec.js` | paginación con "total pegajoso" | P0 |
| `stores/importacionPrecios.spec.js` | filtro de confirmación, cache-once de proveedores | P0 |
| `stores/ui.spec.js` | toast + auto-dismiss (fake timers) | P1 |
| `router/index.spec.js` | guard de auth, redirects | P0 |
| `components/TabBar.spec.js` | ocultar link para rol FISCAL | P1 |
| `components/SearchBar.spec.js` | debounce, dropdown, chips recientes | P0 |
| `components/ProductoCard.spec.js` | watch de reset, margen cliente-side, guardar precio/stock | P0 |
| `components/HistorialProducto.spec.js` | formateo de montos/descripciones | P1 |
| `views/LoginView.spec.js` | submit, redirect, estado enviando | P1 |
| `views/BuscarView.spec.js` | wiring de banners/estados | P2 |
| `views/ReportesView.spec.js` | tabs + scroll infinito (observer fake) | P0 |
| `views/ImportarView.spec.js` | checklist, habilitación de botón aplicar | P0 |

### Integration (`tests/integration/`) — Subagente 2

| Archivo | Cubre | Prioridad dominante |
|---|---|---|
| `auth/login.spec.js` | login éxito/fallo/red caída/500, redirect post-login | P0 |
| `auth/api-client-401-interceptor.spec.js` | single-flight de refresh, incluida concurrencia real | P0 |
| `auth/router-guard-restaurar-sesion.spec.js` | boot desde Dexie, guard real | P0 |
| `auth/logout.spec.js` | logout a nivel store (sin UI, ver hallazgo) | P0 |
| `productos/busqueda.spec.js` | debounce→request real, cache offline | P1 |
| `productos/seleccion-sincronizacion.spec.js` | SearchBar↔ProductoCard vía store compartido | P0 |
| `productos/actualizar-precio.spec.js` | 400 negocio, doble-submit, respuesta fuera de orden | P0 |
| `productos/ajustar-stock.spec.js` | guard de respuesta fuera de orden (si existe) | P0 |
| `reportes/pendientes-controlar.spec.js` | quirk de `total` solo en offset=0, scroll (MSW) | P1 |
| `reportes/ajustes-frecuentes.spec.js` | mismo patrón, carga perezosa por tab | P1 |
| `reportes/navegacion-a-producto.spec.js` | `irAProducto` sin await | P1 |
| `importacion/analizar-archivo.spec.js` | multipart real, payload de FormData | P0 |
| `importacion/confirmar-seleccion.spec.js` | payload exacto de `lineas`, doble-submit | P0 |
| `importacion/permisos-rol-fiscal.spec.js` | 403 real por rol | P0 |
| `resiliencia/codigos-no-contemplados.spec.js` | 404/409/422/429/500/timeout/network sobre flujos ya cableados | P1 |

Infra compartida: `tests/mocks/fixtures.js`, `tests/mocks/handlers.js`,
`tests/mocks/db-helpers.js` (nuevos, a crear en Ronda 2).

### E2E + PWA (`e2e/`) — Subagente 3

| Archivo | Cubre | Prioridad dominante |
|---|---|---|
| `auth.spec.js` | login→protegida→persistente→expirada, doble submit | P0 |
| `buscar-editar-producto.spec.js` | journey completo de mayor uso real | P0 |
| `reportes-scroll-infinito.spec.js` | `IntersectionObserver` REAL del browser | P1 |
| `importar-lista-precios.spec.js` | journey completo, incl. 403 por rol vía URL directa | P0 |
| `pwa-service-worker.spec.js` | registro/activación/instalabilidad | P0 |
| `pwa-cache-offline.spec.js` | 2 capas de offline (SW cache vs. Dexie fallback) | P0 |
| `pwa-manifest-instalacion.spec.js` | manifest, íconos, señal de instalabilidad | P1 |
| `pwa-actualizacion-v1-v2.spec.js` | rebuild real, `skipWaiting`+reload automático | P1 |
| `visual.spec.js` | 2 screenshots (margen bajo/ok, checklist con no-aplicable) | P1 |

Infra compartida: `e2e/support/mockApi.js` (headers CORS + preflight),
`e2e/support/login.js` (helper reusable), `e2e/fixtures/` (JSON + 1 CSV +
1 JPG chicos).

---

## 2. Hallazgos de código cruzados entre agentes (no son bugs de los tests, son del código de la app)

Confirmados por 2 o 3 agentes de forma independiente, leyendo el código real
— no son opiniones, son comportamientos verificables. Los tests de Ronda 2 los
van a **fijar tal cual son hoy** (regression-lock), no a "corregir" en el
test. Van acá separados porque son candidatos a arreglarse en el producto,
más allá de la cobertura de tests:

1. **No hay ningún control de UI para cerrar sesión.** `auth.logout()` existe
   y funciona a nivel store, pero ningún componente lo invoca. Bloquea el
   journey de "Logout" como E2E genuino (Subagente 3 lo documenta como no
   automatizable por esta razón, no por limitación de Playwright).
2. **`/importar` no tiene guard de rol en el router** — solo `TabBar.vue`
   oculta el link para rol FISCAL (comentario propio en el código: "esto es
   solo UX"). Cualquier usuario autenticado que navegue por URL entra
   igual; la única defensa real es el 403 del backend en cada acción.
3. **`src/stores/reportes.js` no atrapa errores de red** (a diferencia de
   `productos.js`, que sí tiene fallback a cache): un fetch fallido ahí
   produce una promesa rechazada sin manejar, sin ningún indicio de error en
   pantalla de Reportes.
4. **Manejo de errores inconsistente entre acciones de `productos.js`**:
   `buscar`/`seleccionar` atrapan internamente y hacen fallback a
   `catalogoCache`; `actualizarPrecio`/`ajustarStock` no tienen try/catch
   propio y dejan que `ProductoCard.vue` sea quien atrape la excepción.
5. **Asimetría en protección contra respuesta fuera de orden**:
   `ajustarStock()` verifica que `prod_id` siga coincidiendo antes de pisar
   `actual.value`; `actualizarPrecio()` no tiene ese guard.
6. **Sin `AbortController`/timeout en `apiClient.js`** — un request que nunca
   resuelve deja el loading correspondiente en `true` para siempre, sin
   mecanismo de recuperación del lado del cliente.
7. **Posible doble-submit real** en `ProductoCard` (guardar precio/stock) y
   `ImportarView` (confirmar) — la única protección es el `:disabled` del
   botón, sin guard interno en la función async. Los tests de Ronda 2 en
   integración/E2E van a confirmar si esto realmente permite 2 requests o no.
8. **Inputs sin `label for=id`** en los formularios de login y
   `ProductoCard` — gap de accesibilidad real, además de complicar los
   locators de Playwright (mitigado con locators por contenedor, no
   bloqueante).
9. **`authService.config()` es código muerto** — nada lo llama; `auth.config`
   se puebla únicamente desde la respuesta de `login()`.

Sumados durante la implementación de Ronda 2 (mismo criterio: verificados con
un test que los fija, no opiniones):

10. **`importacionPrecios.cargarProveedores()` no tiene try/catch propio —
    tercera instancia del mismo patrón del punto 3.** Igual que
    `reportes.js`, si el backend responde `success:false` (ej. 403 para rol
    FISCAL) la lista de proveedores queda vacía en silencio; y si la
    promesa de `importacionPreciosService.proveedores()` rechaza (red
    caída), no hay `catch` — como `ImportarView.vue` la llama en
    `onMounted()` sin `await`/`.catch()`, es un unhandled promise rejection
    real, no solo falta de mensaje en pantalla. Contrasta con
    `analizarArchivo()`/`confirmarSeleccionados()` del mismo store, que sí
    atrapan el error — es específicamente la que se dispara sola al montar,
    no por acción del usuario. Fijado en
    `tests/integration/resiliencia/codigos-no-contemplados.spec.js`.
11. **`buscarEnCache()` (`src/stores/productos.js`) es case-insensitive por
    nombre pero case-SENSITIVE por código.** La comparación por nombre baja
    ambos lados a minúscula; la comparación por código usa `q` tal cual lo
    tipeó el usuario contra `p.codigo` tal cual está guardado, sin
    normalizar ninguno de los dos lados. Un usuario que busque offline
    (fallback a `catalogoCache`, sin conexión) tipeando el código en
    minúscula no encuentra un producto guardado con código en mayúscula,
    aunque exista tal cual. Fijado en `tests/unit/stores/productos.spec.js`.
12. **`useInfiniteScroll` conecta el `IntersectionObserver` dos veces en el
    mount inicial** cuando el sentinela es un template ref real (el
    `watch(sentinelRef, conectar)` se dispara también al pasar de `null` al
    elemento real durante el patch inicial, no solo en remounts
    `v-if`/`v-else` como sugiere el comentario del propio código en
    `src/composables/useInfiniteScroll.js`). Inofensivo en producción
    (`conectar()` desconecta el observer anterior antes de crear uno
    nuevo), pero contradice el comentario fuente y crea/descarta un
    `IntersectionObserver` de más en cada mount de `ReportesView`. Solo se
    vio testeando `ReportesView.vue` con un ref real, no en el test
    aislado del composable (que arranca con el sentinel ya resuelto).
13. **Código muerto en `ImportarView.importarOtra()`**: la rama `if
    (inputArchivo.value)` nunca se ejecuta con la estructura actual del
    template — el botón "Importar otra lista" vive en `v-if="store.resumen"`
    y el `<input type="file" ref="inputArchivo">` vive en
    `v-else-if="!store.items.length && !store.analizando"`, bloques
    mutuamente excluyentes en la misma cadena. Para cuando el botón es
    clickeable, el input ya no está montado y el ref es `null`. No es un
    bug funcional (el efecto buscado ya es innecesario en ese momento),
    pero si se cambia la estructura del template hay que revisar si la
    guarda sigue teniendo sentido.

**Recomendación**: vale la pena una sesión aparte (no esta) para decidir
cuáles de estos 13 puntos se arreglan en el producto — varios (1, 3, 7, 10)
tienen impacto real en un usuario de celular en el piso de venta, no son
solo curiosidades de código. Los puntos 3 y 10 comparten la misma causa raíz
(`onMounted` fire-and-forget sin `.catch()`) y conviene arreglarlos juntos.

---

## 3. Orden de implementación (Ronda 2)

Las 3 capas son **independientes entre sí a nivel de archivos** (directorios
separados: `tests/unit/`, `tests/integration/`, `e2e/`) y ninguna depende del
código de test de otra — corren en paralelo sin conflicto. Dentro de cada
capa, respetar el orden que cada plan ya definió en su propia sección
"Orden sugerido de implementación":

- **Unit**: stores → composables → router → componentes (simple→complejo) → vistas.
- **Integration**: mocks/fixtures primero → validar 2 riesgos técnicos (MSW+FormData, reset del router singleton) → interceptor 401 (es la base de todo lo demás autenticado) → resto de auth → productos → reportes → importación → resiliencia al final.
- **E2E**: spike de infraestructura (CORS+preflight, `page.route()` vs. Service Worker real) → helpers compartidos → auth → buscar/editar (mayor valor de negocio) → importar → reportes/scroll → PWA (service worker → offline → manifest → actualización v1→v2, el más lento al final) → visual al final de todo.

## 4. Criterio de cierre de Ronda 2

Cada subagente reporta, al terminar su capa: tests implementados y
ejecutados (verde), archivos cubiertos, huecos de cobertura con motivo,
problemas de testabilidad nuevos encontrados AL IMPLEMENTAR (distintos de
los ya anticipados en discovery), coverage donde aplique (`npm run
test:coverage` para unit/integration), y cualquier hallazgo de código nuevo
(sumarlo a la sección 2 de este documento si aplica).

## 5. Resultados finales de Ronda 2 (implementación)

Las 3 capas cerraron en verde, corridas de forma independiente en paralelo
(cada agente solo tocó su propio directorio) y confirmadas por el
orquestador. Los 4 archivos que faltaban al arrancar Ronda 2
(`importacion/permisos-rol-fiscal.spec.js`,
`resiliencia/codigos-no-contemplados.spec.js`,
`pwa-actualizacion-v1-v2.spec.js`, `visual.spec.js`) quedaron implementados.

| Capa | Archivos | Tests | Resultado | Coverage (statements/branch/funcs/lines) |
|---|---|---|---|---|
| Unit | 16/16 | 182 | 0 fallos | incluido en la corrida combinada de abajo |
| Integration | 15/15 | 107 | 0 fallos | incluido en la corrida combinada de abajo |
| Unit+Integration combinado (`npm run test:coverage`) | 31 | 289 | 0 fallos | 95.63% / 91.03% / 95.83% / 95.9% |
| E2E `desktop-chromium` | 9/9 | 46 | 0 fallos | n/a |
| E2E `mobile-chromium` | 9/9 (6 archivos aplican) | 39 passed + 7 skipped por diseño | 0 fallos | n/a |

Los `skipped` de `mobile-chromium` son intencionales (plan §4): 3 archivos
de mecánica de Service Worker/rebuild no dependen del viewport y solo
corren en desktop (`pwa-service-worker`, `pwa-manifest-instalacion`,
`pwa-actualizacion-v1-v2`).

**Huecos de cobertura aceptados, con motivo** (ninguno cerrado — todos
documentados como decisión, no como pendiente):
- Journey de Logout como E2E genuino: no automatizable, no existe ningún
  control de UI que dispare `auth.logout()` (hallazgo #1).
- Instalación real de la PWA (banner nativo del navegador, abrir como app
  instalada): fuera del alcance de Playwright/Chromium automatizado,
  cubierto indirectamente vía `Page.getInstallabilityErrors` (CDP).
- Ramas defensivas de bajo riesgo en varios `?? default` / `|| 'mensaje'`
  (branch coverage no-100% en `productos.js`, `importacionPrecios.js`,
  `HistorialProducto.vue`, `LoginView.vue`) — el mock siempre trae el campo
  esperado, así que probar la ausencia es de valor marginal.
- `AppBrand.vue` en 0% — exclusión deliberada del plan de Unit (componente
  puramente presentacional).

**Problemas de testabilidad nuevos encontrados al implementar** (no
anticipados en discovery):
- Router (`tests/unit/router/index.spec.js`): Vue Router trata un `push` a
  la misma ruta ya activa como "navegación duplicada" y no re-ejecuta el
  guard; hubo que aislar cada test con `vi.resetModules()` + `import()`
  dinámico del módulo del router.
- E2E de actualización PWA: forzar un rebuild distinto tocando el código
  fuente debe ser una sentencia con efecto de lado real
  (`window.__X__ = Date.now()`), no un comentario — Terser/esbuild lo
  descartan en el build de producción y el bundle queda byte-idéntico, sin
  disparar ninguna actualización (falso negativo silencioso, sin error
  visible).
- El bug de orden de handlers de MSW que había quedado pendiente de
  verificar (la corrida anterior se cortó a mitad de un fix) se confirmó
  real y ya resuelto: `server.use()` llamado dos veces para el mismo
  endpoint hace que la segunda llamada reemplace del todo a la primera
  (MSW usa "último handler gana", no los combina) — el workaround es
  registrar todas las acciones de un mismo endpoint en una sola llamada.

Ronda 2 cerrada. Pendiente de decisión del usuario: si commitear ahora y
si se aborda alguno de los 13 hallazgos de la sección 2 en una sesión
aparte.
