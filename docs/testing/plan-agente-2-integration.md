# Plan de tests de integración — Subagente 2 (Ronda 1: discovery)

Este documento es el resultado de analizar `swaierp-mobile` (Vue 3.5 + Pinia +
vue-router + Dexie) capa por capa para identificar los flujos de negocio que
cruzan componente → store → servicio → `apiClient` → HTTP, y diseñar cómo se
van a testear con Vitest + MSW en la Ronda 2. **No se escribió código de test
todavía** — eso es la Ronda 2.

Archivos leídos para este análisis: `src/services/apiClient.js`,
`src/stores/{auth,productos,reportes,importacionPrecios,ui}.js`,
`src/router/index.js`, `src/services/*Service.js`, `src/offline/db.js`,
`src/composables/{useInfiniteScroll,useCompresionImagen}.js`,
`src/views/{LoginView,BuscarView,ReportesView,ImportarView}.vue`,
`src/components/{SearchBar,ProductoCard,HistorialProducto,TabBar,AppBrand}.vue`,
`src/App.vue`, `src/main.js`, `vitest.config.js`, `tests/setup.js`,
`.env.test`, `package.json`.

---

## 0. Hallazgos del análisis (importantes para diseñar los casos)

Estos NO son bugs que haya que arreglar en esta ronda — son comportamientos
reales del código, y el plan de abajo está diseñado para **pinnearlos con un
test tal cual son hoy**, no para asumir el comportamiento "ideal". Los marco
para que quien implemente en Ronda 2 no los confunda con errores del test.

1. **`/importar` no tiene guard de rol en el router.** `TabBar.vue` oculta el
   link a usuarios `rol===3` (FISCAL) solo por UX (comentario explícito en el
   código: "esto es solo UX"). `src/router/index.js` no tiene ningún
   `meta.rolesPermitidos` ni chequeo de rol — un usuario FISCAL que navegue a
   `/importar` directamente (URL, `router.push`, bookmark) monta la vista
   igual, y la única defensa real es que el backend devuelve 403 en cada
   acción. Es exactamente el escenario "permisos + navegación" que pide la
   spec, y hay que testearlo como está: la vista monta, dispara los requests,
   recibe 403, y la UI debe degradar sin explotar.

2. **`productos.actualizarPrecio` y `productos.ajustarStock` manejan errores
   distinto entre sí, y distinto de `productos.buscar`/`seleccionar`:**
   - `buscar()` y `seleccionar()` atrapan el error internamente, setean
     `error.value` y hacen fallback a `db.catalogoCache` — nunca rethrow.
   - `actualizarPrecio()` y `ajustarStock()` **no tienen try/catch propio**:
     dejan que la excepción suba, y es `ProductoCard.vue` quien la atrapa
     (`catch (e) { ui.mostrarToast(e.message, 'error') }`).
   Esto importa para los tests: probar `productos.actualizarPrecio()` en
   aislamiento (sin componente) requiere esperar que la promesa **rechace**,
   no que resuelva con un flag de error.

3. **Asimetría en la protección contra "respuesta fuera de orden":**
   `ajustarStock()` chequea `if (actual.value && actual.value.prod_id ===
   prodId)` antes de pisar `actual.value.stock_actual` con la respuesta —
   protege contra que una respuesta tardía de un producto A pise el producto
   B si el usuario ya navegó a otro. `actualizarPrecio()` **no tiene ese
   guard**: pisa `actual.value` incondicionalmente con la respuesta, sin
   verificar que siga siendo el producto correcto. Es un caso real de
   "respuestas fuera de orden" (pedido explícito por la spec en concurrencia)
   y vale la pena tener un test que lo deje documentado, sea cual sea el
   resultado.

4. **No hay AbortController/timeout en `apiClient.js`.** `peticion()` y
   `postFormData()` hacen `fetch()` sin ningún límite de tiempo propio. Un
   request que nunca resuelve deja `cargando`/`guardando*` en `true` para
   siempre — no hay ningún mecanismo que lo saque de ese estado. Esto matiza
   cómo testear "timeout": no existe timeout real que testear como
   recuperación; el caso de test realista es (a) un delay largo pero acotado,
   para probar que el loading se sostiene correctamente mientras la respuesta
   tarda, y (b) documentar como hallazgo que un cuelgue infinito no tiene
   mecanismo de recuperación en el cliente (no se simula un cuelgue infinito
   de verdad en el test porque colgaría el test runner).

5. **Sesión expirada en background no fuerza redirect.** `apiClient` llama
   `authStore.limpiarSesionLocal()` cuando el refresh falla, pero eso solo
   limpia estado (`accessToken=null`, Dexie borrado) — no navega a `/login`.
   El guard de router (`router/index.js`) solo se ejecuta en la próxima
   navegación. Resultado: si el token expira mientras el usuario ya está en
   `/buscar` interactuando (no navegando), la pantalla queda "viva" con
   `accessToken=null` hasta que el usuario intente ir a otro lado. Vale un
   test que confirme este comportamiento actual (estado limpio, sin redirect
   automático) para que no se rompa sin querer, y quede visible como
   candidato a mejora de producto.

6. **`auth.logout()` no tiene ningún trigger de UI.** Existe la acción en el
   store y el service, pero ningún componente la llama (no hay botón de
   "Cerrar sesión" en `TabBar`/`AppBrand`/en ningún lado). El flujo de logout
   se puede testear a nivel store+service+Dexie (llamando `auth.logout()`
   directo), pero **no** como interacción de componente — no hay componente
   que lo dispare. Lo marco también como candidato a reportar como funcionalidad
   faltante, no como límite de testing nuestro.

7. **`authService.config()` (GET `action=config`) no se usa en ningún lado.**
   El único lugar que puebla `auth.config` es la respuesta de `login()`. Es
   código muerto desde el punto de vista de integración — no hay flujo que
   lo dispare, así que no entra en el plan de tests salvo que se decida
   cubrirlo como "función expuesta pero no cableada" (prioridad P2 si se
   cubre, no bloqueante).

8. **`v-model="item.seleccionado"` en `ImportarView.vue` muta el store
   directo desde el template** (cada `item` del array `store.items` es un
   objeto reactivo de Pinia, y el checkbox lo edita sin pasar por ninguna
   acción). Funciona porque los setup stores de Pinia no tienen modo estricto,
   pero es una mutación fuera de acción — no es un bug, solo un patrón a
   tener presente al diseñar el test de "togglear checkboxes actualiza el
   contador de seleccionados y habilita/deshabilita el botón Aplicar".

9. **Posible doble-submit real en `ProductoCard.guardarPrecio`/`guardarStock`
   y en `ImportarView.confirmar`.** La única protección es `:disabled` en el
   botón, atado a un `ref` que se pone en `true` como primera línea de la
   función async — pero nada dentro de la función misma chequea "¿ya estoy
   guardando?" antes de seguir. Si dos clicks llegan antes de que Vue vuelva
   a pintar el DOM (dos `trigger('click')` sin `await` entre medio, que
   simula un doble-tap rápido en mobile — la app es una PWA para celular),
   nada en el código impide que se disparen dos POST. Es un caso de test de
   alto valor (P0) que puede terminar en rojo — si eso pasa, se reporta como
   hallazgo real de Ronda 2, no se lo "arregla" en el test.

10. **`ReportesView.irAProducto` no espera `productos.seleccionar()`** (lo
    llama sin `await`) antes de `router.push('/buscar')`. La navegación
    ocurre antes de que resuelva la búsqueda del detalle — funciona porque el
    store es compartido y reactivo, pero es la razón por la que el test de
    "ir de Reportes a un producto" tiene que verificar el estado de carga
    en la vista destino, no asumir que el producto ya está listo al navegar.

---

## 1. Flujos de integración identificados

| # | Flujo | Capas que toca | Archivo de test propuesto |
|---|-------|-----------------|----------------------------|
| 1 | Login exitoso/fallido | `LoginView.vue` + `auth` store + `authService` + `apiClient` + router (redirect post-login) | `tests/integration/auth/login.spec.js` |
| 2 | Interceptor 401 + refresh single-flight de `apiClient` | `apiClient.js` (`get`/`post`/`postFormData`) + `auth` store | `tests/integration/auth/api-client-401-interceptor.spec.js` |
| 3 | Guard de router + `restaurarSesion` (boot desde Dexie) | `router/index.js` + `auth` store + `Dexie(db.sesion)` + `authService` | `tests/integration/auth/router-guard-restaurar-sesion.spec.js` |
| 4 | Logout | `auth` store + `authService` + Dexie (sin UI, ver hallazgo #6) | `tests/integration/auth/logout.spec.js` |
| 5 | Búsqueda de productos (debounce + cache offline) | `SearchBar.vue` + `productos` store + `productosService` + Dexie (`catalogoCache`) | `tests/integration/productos/busqueda.spec.js` |
| 6 | Selección de producto + sincronización `SearchBar` ↔ `ProductoCard` | `BuscarView.vue` (`SearchBar` + `ProductoCard`) + `productos` store | `tests/integration/productos/seleccion-sincronizacion.spec.js` |
| 7 | Guardar precio (form crítico, financiero) | `ProductoCard.vue` + `productos` store + `ui` store (toast) | `tests/integration/productos/actualizar-precio.spec.js` |
| 8 | Ajustar stock (form crítico, stock) | `ProductoCard.vue` + `productos` store + `ui` store (toast) | `tests/integration/productos/ajustar-stock.spec.js` |
| 9 | Reportes "Pendientes de controlar" con scroll infinito y el detalle de `total` solo en `offset=0` | `ReportesView.vue` + `reportes` store + `useInfiniteScroll` | `tests/integration/reportes/pendientes-controlar.spec.js` |
| 10 | Reportes "Ajustes frecuentes" (mismo patrón, carga perezosa al cambiar de tab) | `ReportesView.vue` + `reportes` store | `tests/integration/reportes/ajustes-frecuentes.spec.js` |
| 11 | Navegación cruzada Reportes → producto (`irAProducto`) | `ReportesView.vue` + router + `productos` store + `BuscarView.vue` | `tests/integration/reportes/navegacion-a-producto.spec.js` |
| 12 | Carga de proveedores + selección de archivo → análisis (multipart) | `ImportarView.vue` + `importacionPrecios` store + `importacionPreciosService` + `useCompresionImagen` (solo el pass-through no-imagen) | `tests/integration/importacion/analizar-archivo.spec.js` |
| 13 | Checklist → confirmar selección (payload exacto, resumen, reintentos) | `ImportarView.vue` + `importacionPrecios` store | `tests/integration/importacion/confirmar-seleccion.spec.js` |
| 14 | Permisos: usuario FISCAL contra endpoints de importación (403) + ruta sin guard | `ImportarView.vue` + `importacionPrecios` store + router (navegación directa) | `tests/integration/importacion/permisos-rol-fiscal.spec.js` |
| 15 | Resiliencia genérica ante códigos/errores no contemplados hoy por el backend | Una muestra representativa de los flujos P0/P1 de arriba, re-ejercitados contra 404/409/422/429/500/network-error/delay largo | `tests/integration/resiliencia/codigos-no-contemplados.spec.js` |

---

## 2. Casos por flujo

Convención: **Escenario** → *acción* → *request esperado* → *mock* → *asserts*.
Prioridad P0/P1/P2 según la spec (P0 = auth, escritura, financiero, stock,
permisos, irreversible; P1 = consulta/filtro/búsqueda/dashboard; P2 =
secundario).

### 1. Login (`auth/login.spec.js`)

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Login exitoso: completa usuario/clave, submit → `POST /api_auth.php` body `action=login&usuario=...&clave=...&dispositivo=<navigator.userAgent>` → mock 200 `{success:true, access_token, refresh_token, expires_in, usuario, config}` → asserts: `auth.accessToken`/`auth.usuario`/`auth.config` seteados, `db.sesion` tiene el refresh token guardado, `router.replace` a `/buscar` (o a `?redirect=` si vino con uno), `enviando` vuelve a `false` | P0 | 2xx |
| Login fallido: credenciales malas → mock 401 `{success:false, error:"Usuario o clave incorrecta."}` → asserts: NO se guarda nada en Dexie, `auth.accessToken` sigue `null`, el mensaje de error se muestra tal cual vino del backend (mensaje genérico anti-enumeración, no lo reescribe el frontend), no navega | P0 | 401 |
| Doble submit del form de login: dos submits rápidos antes de que `enviando` deshabilite el botón → assert `authService.login`/el POST se dispara como máximo la cantidad de veces esperada (test exploratorio, puede revelar el mismo patrón del hallazgo #9 aplicado al login) | P0 | 2xx |
| Login con red caída → `fetch` rechaza → `apiClient` lanza `Error('No hay conexión con el servidor.')` → `auth.login` no atrapa esto con su propio mensaje (deja subir el de `apiClient`) → assert `LoginView` muestra ese mensaje, `enviando` vuelve a `false`, no crashea | P1 | network error |
| Login con 500 del backend → `parsearJson` intenta parsear igual; si el body no es JSON válido cae a `{success:false, error:'Respuesta inválida del servidor.'}` → assert mensaje mostrado y estado consistente | P1 | 500 |
| Redirect post-login respeta `?redirect=` de una ruta protegida a la que se intentó entrar sin sesión | P0 | 2xx |

### 2. Interceptor 401 + refresh single-flight (`auth/api-client-401-interceptor.spec.js`)

Este es el corazón del P0 según la spec del usuario ("probalo a fondo").

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Un solo request autenticado recibe 401 → dispara `refrescarToken()` una vez → reintenta el request original con el header `Authorization` actualizado → devuelve el resultado del reintento | P0 | 401 → 2xx |
| Refresh también falla (401 en `action=refresh`) → NO reintenta el request original → llama `authStore.limpiarSesionLocal()` (assert `accessToken=null`, `usuario=null`, `db.sesion` sin la clave) → la función devuelve el JSON de la respuesta 401 ORIGINAL (no una sintetizada) | P0 | 401 → 401 |
| **Concurrencia real**: 3 requests en paralelo (ej. `productos.buscar`, `productos.seleccionar`, `reportes.cargarPendientes`) reciben 401 al mismo tiempo con el mismo token vencido → assert que el endpoint de refresh se llamó **exactamente una vez** (contador en el resolver de MSW) → los 3 requests originales se reintentan con el token nuevo y los 3 resuelven success | P0 | 401 simultáneo x3 |
| El single-flight es compartido entre `get`/`post` (`peticion()`) y `postFormData()` — mezclar un GET y un `postFormData` (subida de archivo) en la misma ventana de 401 simultáneo también dispara un solo refresh | P0 | 401 simultáneo mixto |
| Un request con `auth:false` (login/refresh/logout) que devuelve 401 **no** dispara el interceptor ni llama a `refrescarToken()` — evita el loop infinito de "refrescar el refresh" | P0 | 401 en request no autenticado |
| El refresh token ROTA: después de un refresh exitoso, `db.sesion` queda con el refresh token nuevo, no el viejo — un segundo 401 más adelante en el test debe usar el token rotado, no el original | P0 | 2xx con rotación |
| Reintentar el request original también falla (ej. 500 tras un refresh exitoso) → se propaga ese error normalmente, no se reintenta un segundo refresh | P1 | 401 → 200 (refresh) → 500 |

### 3. Router guard + `restaurarSesion` (`auth/router-guard-restaurar-sesion.spec.js`)

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Sin refresh token en Dexie, navegar a `/buscar` → `restaurarSesion()` no llama a la red (no hay `registro`) → redirige a `/login?redirect=/buscar` | P0 | sin red |
| Con refresh token válido en Dexie, navegar a `/buscar` → `POST action=refresh` con ese token → 200 → `auth.accessToken` seteado, `listo=true`, deja pasar la navegación, Dexie actualizado con el token rotado | P0 | 2xx |
| Con refresh token en Dexie pero el backend lo rechaza (revocado/expirado) → `restaurarSesion` limpia sesión → redirige a `/login?redirect=<ruta original>` | P0 | 401 |
| Navegar a `/login` estando ya autenticado → redirige a `/buscar` (o al `redirect` de la query si vino con uno) en vez de mostrar el form | P1 | 2xx |
| `restaurarSesion()` solo se ejecuta una vez por sesión de app (`if (listo.value) return`) — segunda navegación a otra ruta protegida no vuelve a llamar `action=refresh` | P1 | — |
| Ruta con `meta.requiresAuth === false` (o sea `/login`) no pasa por el chequeo de autenticación aunque no haya sesión | P2 | — |

**Nota de diseño para Ronda 2**: `router` es un singleton importado desde
`src/router/index.js`; reusarlo entre tests del mismo archivo puede arrastrar
estado (`auth.listo`, ruta actual) de un test a otro. Hay que decidir entre
`vi.resetModules()` + reimport dinámico por test, o resetear explícitamente
Pinia + navegar a una ruta neutra en `beforeEach`. Dejarlo resuelto antes de
escribir el resto de los tests de este archivo, porque el mismo patrón
aplica a cualquier otro test que monte el router real.

### 4. Logout (`auth/logout.spec.js`)

| Caso | Prioridad | Código/escenario |
|---|---|---|
| `auth.logout()` con sesión activa → `POST action=logout` con el refresh token → Dexie y estado en memoria se limpian sin importar la respuesta (comentario del código: "best-effort") | P0 | 2xx |
| `auth.logout()` sin conexión → el `try/catch` interno lo atrapa y limpia igual el estado local | P0 | network error |
| `auth.logout()` sin refresh token guardado (ya deslogueado) → no intenta llamar al backend, limpia estado igual sin explotar | P1 | — |

Como está documentado en el hallazgo #6, este flujo se testea **a nivel
store**, no como interacción de componente — no hay botón que lo dispare hoy.

### 5. Búsqueda de productos (`productos/busqueda.spec.js`)

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Tipear en `SearchBar` → debounce de 300ms → un solo `GET action=buscar&q=...&limit=20` (no uno por tecla) → `productos.resultados` se puebla → se pintan los items | P1 | 2xx |
| Limpiar el input (`limpiar()`/borrar todo) → `resultados` se vacía sin llamar a la API | P2 | — |
| Búsqueda sin resultados → mensaje "Sin resultados. Probá con el código." | P1 | 2xx items:[] |
| Error de red durante la búsqueda → `productos.error` se setea, y hace fallback a `db.catalogoCache` (poblado previamente por una búsqueda exitosa anterior en el mismo test) filtrando por nombre/código → verificar que el fallback realmente sirve resultados, no una lista vacía | P1 | network error |
| Cada resultado exitoso persiste en `db.catalogoCache` (assert directo sobre Dexie) | P1 | 2xx |
| Seleccionar un resultado del dropdown emite `select` con el `prod_id` correcto y limpia el input | P1 | — |
| "Recientes" se puebla al seleccionar productos y no duplica el mismo `prod_id` dos veces (máx. 4) | P2 | 2xx |
| Margen bajo el objetivo (`auth.config.margen_objetivo_pct`) pinta el badge en rojo vs verde — cruza `auth` store con datos de `productos` store en el mismo componente | P2 | 2xx |

### 6. Selección + sincronización `SearchBar` ↔ `ProductoCard` (`productos/seleccion-sincronizacion.spec.js`)

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Seleccionar un producto en `SearchBar` (evento `select`) actualiza `productos.actual` vía `GET action=detalle` y `ProductoCard`, montado como hermano (no padre/hijo) del `SearchBar` dentro de `BuscarView`, refleja los datos **solo a través del store compartido** | P0 | 2xx |
| El formulario de `ProductoCard` (stock/costo/precio) se resetea a los valores del producto SOLO cuando cambia `prod_id`, no en cualquier actualización de `actual` (para no pisar lo que el usuario está tipeando después de guardar) — seleccionar el mismo producto de nuevo no debería resetear un campo que el usuario está editando a mitad de camino | P1 | — |
| `seleccionar()` con error de red → fallback a `db.catalogoCache.get(prodId)` si existe (poblado por una búsqueda previa) — si no existe en cache, `actual` queda como estaba | P1 | network error |
| Historial del producto (`historial` en la respuesta de detalle) se pasa correctamente a `HistorialProducto` | P2 | 2xx |

### 7. Guardar precio (`productos/actualizar-precio.spec.js`) — P0

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Éxito: editar `precioVenta`, click "Guardar precio" → `guardandoPrecio=true` → `POST action=actualizar_precio` con `{prod_id, costo, precio_venta}` exactos → 200 con detalle actualizado → `productos.actual` se reemplaza por la respuesta, toast de éxito, `guardandoPrecio=false` | P0 | 2xx |
| Error de negocio (precio ≤ costo) → mock 400 `{success:false, error:"El precio de venta debe ser mayor al costo."}` → como `actualizarPrecio()` NO atrapa el error (hallazgo #2), la promesa rechaza y **`ProductoCard`** es quien la atrapa → toast de error con ese mensaje exacto, `productos.actual` NO se pisa (sigue con los datos previos), los valores tipeados en el form **no se pierden** | P0 | 400 |
| Error 500/network error → mismo camino que el 400: toast de error, form intacto, `guardandoPrecio` vuelve a `false` (verificar que el `finally` corre igual) | P0 | 500, network error |
| **Doble-submit real** (hallazgo #9): disparar dos `guardarPrecio()` sin esperar a que el primero actualice el DOM → assert cuántos `POST action=actualizar_precio` salieron. Si sale más de uno, documentarlo como hallazgo confirmado en el reporte de Ronda 2, no "arreglar" el test para que pase | P0 | 2xx x2 |
| **Respuesta fuera de orden** (hallazgo #3): guardar precio del producto A (respuesta demorada con `delay`), antes de que resuelva, seleccionar el producto B → cuando la respuesta de A llega, verificar si pisa `productos.actual` (que ya es B) — de nuevo, documentar el resultado real, no forzarlo | P0 | 2xx demorado + cambio de contexto |
| Recuperación después de error: falla el guardado, el usuario corrige el precio y reintenta → segundo intento exitoso actualiza todo correctamente (limpia cualquier estado de error visual) | P0 | 400 → 2xx |

### 8. Ajustar stock (`productos/ajustar-stock.spec.js`) — P0

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Éxito: usar el stepper (+/-) y/o tipear, click "Guardar stock" → `POST action=ajustar_stock` con `{prod_id, nuevo_stock, comentario:''}` → 200 `{success:true, stock_actual}` → `productos.actual.stock_actual` y el input local se actualizan con el valor que devolvió el backend (no el que tipeó el usuario, por si el backend lo ajustó) | P0 | 2xx |
| Guard de "respuesta fuera de orden" SÍ existe acá (a diferencia de precio): si `actual.value.prod_id !== prodId` cuando llega la respuesta (usuario ya cambió de producto), NO debe pisar `actual.value.stock_actual` — assert que el guard funciona como está escrito | P0 | 2xx demorado + cambio de contexto |
| Error de negocio/red → toast de error, `guardandoStock` vuelve a `false`, el input conserva lo tipeado | P0 | 400/500/network error |
| Stepper no permite bajar de 0 (`Math.max(0, ...)`) — incluido como parte del flujo completo (acción de usuario antes de guardar), no como test exhaustivo de la función (eso es unit, Subagente 1) | P2 | — |

### 9-10. Reportes: pendientes y ajustes (`reportes/pendientes-controlar.spec.js`, `reportes/ajustes-frecuentes.spec.js`)

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Montaje de `ReportesView` dispara `cargarPendientes(0)` → `GET action=pendientes_controlar&dias=7&limit=20&offset=0` → 200 `{items, total}` → se pintan los items y el contador de "N sin controlar" | P1 | 2xx |
| **Quirk documentado explícitamente por la spec**: página siguiente (`offset=20`) → mock responde `{success:true, items:[...]}` **sin la clave `total`** → assert que `reportes.pendientes.total` se mantiene en el valor de la página anterior (no se pisa con `undefined`), y que `items` es la concatenación (no el reemplazo) de ambas páginas | P1 | 2xx sin `total` |
| Scroll infinito: el sentinela entra en viewport (`IntersectionObserver` simulado a mano — el stub global de `tests/setup.js` no invoca el callback, hay que instalar un mock local que capture el callback del observer y lo dispare manualmente) → dispara `cargarPendientes(items.length)` con el offset correcto | P1 | 2xx |
| No dispara una segunda carga si ya hay una en curso (`loading` true) — dos intersecciones seguidas mientras `reportes.cargando` es `true` solo generan un request | P1 | 2xx demorado |
| No dispara más cargas cuando `hasMore` es `false` (`items.length >= total`) | P2 | — |
| Cambiar de tab a "Ajustes" por primera vez dispara `cargarAjustes(0)`; volver a cambiar de tab NO vuelve a pedirlo (`items.length === 0` es la única condición) | P1 | 2xx |
| Error en cualquiera de las dos cargas → **no hay manejo de error visible en el store** (`reportes.js` no tiene `error` ref; si `data.success` es `false` simplemente hace `return` sin actualizar nada) → documentar este comportamiento con un test explícito: `cargando` vuelve a `false`, pero no hay mensaje de error en la UI ni estado de error expuesto — es un caso real de "manejo de errores de API" que vale la pena señalar como ausente, tal como pide el punto 4 de la spec ("qué no se cubre / gaps") | P1 | 400/500/network error |

### 11. Navegación cruzada Reportes → producto (`reportes/navegacion-a-producto.spec.js`)

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Click en un item de "Pendientes" → `productos.seleccionar(prodId)` (sin `await`, hallazgo #10) + `router.push('/buscar')` inmediato → en la vista destino, `ProductoCard` debe reflejar el estado de carga y luego los datos del producto una vez que la promesa (disparada antes de navegar) resuelve | P1 | 2xx |
| Mismo flujo desde "Ajustes frecuentes" | P1 | 2xx |
| Si `seleccionar()` falla (red caída) durante esta navegación, `BuscarView` no debe crashear — debe mostrar el estado de error que ya expone `productos.error` | P1 | network error |

### 12. Importación: proveedores + análisis (`importacion/analizar-archivo.spec.js`)

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Montaje de `ImportarView` dispara `GET action=proveedores` → select se puebla | P1 | 2xx |
| `cargarProveedores()` no repite el fetch si ya hay proveedores cargados (`if (proveedores.value.length > 0) return`) — montar/llamar dos veces solo genera un request | P2 | — |
| Seleccionar un archivo **no-imagen** (CSV/PDF, para no depender de `canvas`/`createImageBitmap` en jsdom — ver nota de límites más abajo) → `POST multipart` con `action=analizar`, `archivo` (File real), `proveedor_id` si está seleccionado → assert el `FormData` recibido en el resolver de MSW tiene esos tres campos con los valores correctos | P0 | 2xx |
| Respuesta con `sin_match > 0` y `avisos` → se muestran ambos en la UI | P1 | 2xx |
| Cada item mapea `seleccionado: item.aplicable` al llegar — los no aplicables aparecen con el checkbox deshabilitado y el motivo visible | P1 | 2xx |
| Error al analizar (400/500/network) → `store.error` se muestra, `store.items` queda vacío, `analizando` vuelve a `false` | P0 | 400/500/network error |
| Recuperación: falla el análisis, el usuario elige otro archivo → `error` se limpia al reintentar (`error.value = ''` al inicio de `analizarArchivo`) y el segundo intento exitoso reemplaza el estado limpio | P0 | 400 → 2xx |

**Límite deliberado**: la compresión real de imágenes (`comprimirSiEsImagen`
con un archivo `image/*`, que dispara `createImageBitmap`/`canvas`) no se
prueba acá — depende de que jsdom tenga soporte de canvas, que es un tema de
la unidad del composable en sí (Subagente 1). Acá se usan tipos de archivo
que la función deja pasar sin tocar (CSV/PDF/XLSX), que es como se comporta
realmente el flujo de "subir una lista", ya que las fotos son solo un caso
particular de entrada.

### 13. Importación: confirmar selección (`importacion/confirmar-seleccion.spec.js`) — P0

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Togglear checkboxes actualiza el contador `seleccionados` y habilita/deshabilita "Aplicar seleccionados" (mutación directa sobre el store desde el `v-model`, hallazgo #8) | P1 | — |
| Confirmar con selección → `POST action=confirmar` con `proveedor_id` y `lineas` = `JSON.stringify([{prod_id, costo_nuevo, codigo_detectado}, ...])` **solo** de los items `seleccionado && prod_id` → assert el payload exacto (parsear el `lineas` recibido en el resolver y comparar contra lo esperado) | P0 | 2xx |
| `confirmarSeleccionados()` con 0 seleccionados no dispara ningún request (`return` temprano en el store) — coincide con el botón deshabilitado en la UI, pero el test debe probarlo a nivel store también, no solo confiar en el `:disabled` | P1 | — |
| Éxito → `store.resumen` se puebla, `store.items` se vacía, la vista cambia al resumen ("Importación aplicada"), toast con el conteo de `aplicados` | P0 | 2xx |
| Resumen con `rechazados > 0` → se muestra ese detalle también | P1 | 2xx |
| Error (400/500/network) → `store.error` se muestra, `store.items` **no se vacía** (a diferencia del éxito) — el usuario puede ajustar la selección y reintentar sin perder el análisis ya hecho | P0 | 400/500/network error |
| Doble-submit en "Aplicar seleccionados" (mismo patrón que el hallazgo #9) — mismo criterio: documentar el resultado real | P0 | 2xx x2 |
| "Importar otra lista" después del resumen llama `store.reiniciar()` y limpia el input file (`inputArchivo.value.value = ''`) — vuelve al estado inicial | P2 | — |

### 14. Permisos: rol FISCAL contra importación (`importacion/permisos-rol-fiscal.spec.js`) — P0

| Caso | Prioridad | Código/escenario |
|---|---|---|
| Usuario con `usuario.rol === 3` navega directo a `/importar` (sin pasar por el link de `TabBar`, que está oculto para él) — el router lo deja entrar igual (hallazgo #1) → `ImportarView` monta y dispara `cargarProveedores()` | P0 | — |
| Ese `GET action=proveedores` devuelve 403 `{success:false, error:"No tenés permiso para realizar esta acción."}` → verificar que la store no crashea (no hay `try/catch` alrededor de esa llamada específica más que el genérico `finally`) — inspeccionar en Ronda 2 si el error queda silencioso (mismo patrón que el hallazgo de reportes) o se refleja en algún lado, y documentarlo | P0 | 403 |
| Igual para `analizar` y `confirmar` con 403 — estos sí pasan por el `try/catch` de sus respectivas acciones del store, así que `store.error` debería quedar seteado con el mensaje del backend | P0 | 403 |
| Confirmar que un usuario `rol 1` o `rol 2` (ADMINISTRADOR/AVANZADO) contra los mismos mocks en 200 no tiene ninguna restricción — caso de control positivo | P1 | 2xx |

### 15. Resiliencia ante códigos no contemplados hoy por el backend (`resiliencia/codigos-no-contemplados.spec.js`)

Aclaración explícita (así lo pide el contrato): el backend real de swaidemo
**no devuelve** 404/409/422/429 en ningún endpoint actual. Estos casos no son
"flujos de negocio reales" — son pruebas de resiliencia del frontend ante
códigos HTTP que el backend podría llegar a emitir en el futuro (o que un
proxy/WAF/CDN podría inyectar). El criterio de éxito NO es "la app maneja el
código con un mensaje específico" (no hay copy para eso), sino **"la app no
explota"**: el loading se apaga, no queda una promesa colgada, no hay un
error no capturado (`unhandledrejection`), y se pinta algún estado
consistente (aunque sea el mensaje genérico de `parsearJson`/el `catch` que
corresponda).

| Caso | Prioridad | Código/escenario |
|---|---|---|
| `productos.buscar` contra 404/409/422/429/500 → cae en el mismo `catch` que ya maneja errores de red, hace fallback a cache, `cargando` se apaga | P1 | 404, 409, 422, 429, 500 |
| `productos.actualizarPrecio`/`ajustarStock` (P0, financiero/stock) contra los mismos códigos → la promesa rechaza igual (no hay manejo especial por código), `ProductoCard` muestra el mensaje que venga en el body, `guardando*` se apaga | P0 | 404, 409, 422, 429, 500 |
| `importacionPrecios.confirmarSeleccionados` contra los mismos códigos | P0 | 404, 409, 422, 429, 500 |
| Network error genérico (`HttpResponse.error()` de MSW) contra al menos un endpoint de cada store (`productos`, `reportes`, `importacionPrecios`) → todos caen en el mensaje `'No hay conexión con el servidor.'` que lanza `apiClient`, ninguno queda colgado | P1 | network error |
| Delay largo pero acotado (ej. `delay(3000)` de MSW) en un endpoint P0 (`actualizar_precio`) → mientras está pendiente, `guardandoPrecio` es `true` y el botón sigue deshabilitado; al resolver (aunque tarde), el estado se actualiza correctamente — **no** se simula un cuelgue infinito real (ver hallazgo #4) | P0 | delay largo |
| Respuesta 200 con `success:false` mal formada (sin `error`) → el mensaje de fallback (`'No se pudo ...'`, hardcodeado en cada store) se muestra en vez de `undefined` | P2 | 200 con success:false |
| Respuesta 200 con JSON inválido/vacío → `parsearJson` cae a `{success:false, error:'Respuesta inválida del servidor.'}` sin tirar una excepción no atrapada | P1 | 200 body corrupto |

---

## 3. Diseño de los MSW handlers

### Archivos en `tests/mocks/`

- **`tests/mocks/fixtures.js`** — datos base reutilizables, sin lógica de
  HTTP: `usuarioAdmin`, `usuarioAvanzado`, `usuarioFiscal` (rol 1/2/3),
  `configDefault` (`{margen_objetivo_pct:30}`), `productoEjemplo` (con
  `historial`), `resultadosBusquedaEjemplo`, `itemPendienteEjemplo`,
  `itemAjusteEjemplo`, `proveedorEjemplo`, `itemAnalisisEjemplo` (aplicable y
  no aplicable), `resumenConfirmacionEjemplo`. Cada fixture es una función
  `(overrides = {}) => ({...base, ...overrides})` para poder ajustar un campo
  puntual sin repetir el objeto entero en cada test.

- **`tests/mocks/handlers.js`** — **factories** de handlers MSW v2 (`http`,
  `HttpResponse`, `delay` de `msw`), una función por acción de negocio, NO un
  array fijo de handlers "por defecto" ya registrados (el server arranca
  vacío en `tests/setup.js` y cada test arma lo que necesita con
  `server.use(...)`). Ejemplos de la forma que van a tener:
  - `mockLogin({status = 200, body} = {})`
  - `mockRefresh({status = 200, body, onCall} = {})` — con `onCall` opcional
    para exponer un contador/spy al test (clave para el caso de single-flight:
    el test necesita poder assertar "se llamó una vez").
  - `mockLogout({status = 200} = {})`
  - `mockBuscarProductos({status = 200, items, tokenEsperado} = {})` — el
    parámetro `tokenEsperado` es lo que permite simular "401 con el token
    viejo, 200 con el token nuevo" leyendo el header `Authorization` dentro
    del resolver, necesario para el caso de refresh-y-reintento.
  - `mockDetalleProducto(...)`, `mockActualizarPrecio(...)`,
    `mockAjustarStock(...)`
  - `mockPendientesControlar(...)`, `mockAjustesFrecuentes(...)` — con
    soporte para forzar una respuesta sin la clave `total` (el caso del
    quirk de paginación)
  - `mockProveedores(...)`, `mockAnalizarArchivo(...)` (lee `request.formData()`
    para poder assertar sobre lo recibido), `mockConfirmarImportacion(...)`
    (lee y parsea `lineas` del body para el mismo motivo)
  - `mockErrorGenerico(path, status, body)` y `mockNetworkError(path)` /
    `mockDelay(path, ms)` — helpers genéricos para el archivo de resiliencia,
    en vez de un factory por endpoint.

  Todos devuelven un handler de `msw` listo para pasarle a `server.use()`.
  Nada se registra automáticamente al importar el archivo.

- **`tests/mocks/db-helpers.js`** (opcional, si al escribirlos se repite
  mucho) — helpers cortos para sembrar/limpiar Dexie entre tests:
  `sembrarRefreshToken(valor)`, `limpiarDb()` (borra `sesion` y
  `catalogoCache`), ya que `tests/setup.js` no lo hace por nosotros y
  `fake-indexeddb` persiste entre tests del mismo archivo si no se limpia
  explícitamente.

### `server.use()` puntual vs. factory reusable

Regla general: **todo entra por `server.use()`** dentro de cada test (o en un
`beforeEach` del `describe` si varios casos del mismo archivo comparten el
mismo estado inicial, ej. "usuario ya logueado"). Las factories de
`handlers.js` son para no repetir la forma del `http.post(...)`/`http.get(...)`
en cada test — la decisión de qué mockear y con qué status es de cada test
puntual, no algo fijo por archivo. Ningún handler se agrega en `tests/setup.js`
(ese archivo no se toca).

---

## 4. Qué NO cubre este plan (y a quién le corresponde)

- **Stores/composables en aislamiento, mockeando la capa de servicio**
  (`vi.mock('../services/productosService')` y afines) — eso es la frontera
  con Subagente 1. La diferencia operativa: Subagente 1 mockea
  `services/*.js`; nosotros mockeamos la capa HTTP (MSW) y dejamos correr
  `services/*.js` + `apiClient.js` reales. Cualquier test que mockee un
  `*Service.js` directamente no es un test de integración según este plan.
- **Lógica pura de `useInfiniteScroll` y `useCompresionImagen` fuera de un
  flujo real** (ej. matemática exacta del redimensionado de imagen, todas las
  combinaciones de `maxDim`/`calidad`, el fallback sin `createImageBitmap`) —
  Subagente 1.
- **Cálculos/formateos puntuales** (`margenActual`, `formatearMonto`,
  `ajustarStepper`, `descripcion()` de `HistorialProducto`) probados con
  matriz exhaustiva de valores límite — Subagente 1. Nosotros los ejercitamos
  de paso, dentro de un flujo, con 1-2 valores representativos, no como
  cobertura de esa lógica en sí.
- **Service Worker, manifest, instalación de la PWA, comportamiento realmente
  offline al iniciar la app, actualización v1→v2, cache de Workbox** —
  Subagente 3. Nuestro test de "búsqueda con fallback a `catalogoCache`" prueba
  la lógica de la store ante un `fetch` que falla, no el comportamiento real
  del Service Worker/`NetworkFirst` de Workbox.
- **Sesión persistente entre recargas reales del navegador** — nosotros
  probamos que `restaurarSesion()` + el guard de router hacen lo correcto
  dado un estado de Dexie ya sembrado (simulando "la app se reinicia"), pero
  no un reload real de `window.location` en un browser de verdad — eso es
  Subagente 3 (E2E, "sesión persistente" está listado explícitamente en su
  spec).
- **Journeys de negocio de punta a punta con Playwright, en navegador real,
  con capturas de pantalla** — Subagente 3.
- **Responsive/visual regression** — Subagente 3.
- **Validación de campos por HTML5 nativo** (`required`, `type="number"`) sin
  JS propio detrás — no hay lógica de validación custom en este código para
  testear a nivel integración (ver hallazgo general: el frontend no valida
  `precio_venta > costo` antes de mandar el request, delega 100% al backend).

---

## 5. Orden sugerido de implementación (Ronda 2)

1. `tests/mocks/fixtures.js` + `tests/mocks/handlers.js` (+ `db-helpers.js`
   si hace falta) — sin esto no arranca nada más.
2. **Validar primero, antes de escribir el resto**, dos riesgos técnicos
   concretos con un test mínimo descartable:
   - que MSW v2 + jsdom + `FormData`/`File` interceptan bien un
     `postFormData` (necesario para todo el módulo de importación).
   - cómo resetear el router singleton entre tests sin arrastrar estado
     (ver nota técnica en la sección 2.3).
3. `auth/api-client-401-interceptor.spec.js` — es la pieza más riesgosa y de
   la que dependen (indirectamente) todos los demás flujos autenticados.
4. `auth/login.spec.js`, `auth/router-guard-restaurar-sesion.spec.js`,
   `auth/logout.spec.js`.
5. `productos/busqueda.spec.js`, `productos/seleccion-sincronizacion.spec.js`
   — base para los tests de formularios que siguen.
6. `productos/actualizar-precio.spec.js`, `productos/ajustar-stock.spec.js`
   — el bloque P0 más denso (incluye los casos de doble-submit y respuesta
   fuera de orden de los hallazgos #3 y #9).
7. `reportes/pendientes-controlar.spec.js`, `reportes/ajustes-frecuentes.spec.js`,
   `reportes/navegacion-a-producto.spec.js`.
8. `importacion/analizar-archivo.spec.js`, `importacion/confirmar-seleccion.spec.js`,
   `importacion/permisos-rol-fiscal.spec.js`.
9. `resiliencia/codigos-no-contemplados.spec.js` — al final, porque re-usa
   los mismos flujos ya cableados en los pasos anteriores, solo cambiando el
   mock de respuesta.

Cada paso se corre con `npm run test:integration` antes de pasar al
siguiente, y cualquier hallazgo nuevo (además de los 10 ya listados en la
sección 0) se documenta en el reporte final de Ronda 2 con el mismo criterio:
señalar el comportamiento real, no forzar el test para que oculte algo.
