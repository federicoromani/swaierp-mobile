# Plan E2E + PWA — swaierp-mobile (Ronda 1: discovery)

Subagente 3 de 3. Este documento es el entregable de la Ronda 1: **plan**, no
código. Ronda 2 lo implementa.

Alcance de la app relevada (código real, no el README — el README describe
"Importar Lista IA" como placeholder pero está completamente implementado en
`ImportarView.vue` + `stores/importacionPrecios.js`; el documento de abajo se
basa en lo que el código hace hoy).

---

## 0. Nota técnica previa (léase antes que el resto — condiciona toda la
## estrategia de mocking)

Tres hallazgos de infraestructura que hay que resolver **antes** de escribir
la primera spec, porque si se ignoran los tests van a ser flaky o van a fallar
todos por la misma causa:

### 0.1 CORS cross-origin en las respuestas mockeadas

`VITE_API_BASE_URL` (`.env.local`, usado por el build de `npm run build`) es
`http://localhost:8880/swaidemo/apps` — un origen **distinto** al del preview
(`http://localhost:4173`). `page.route().fulfill()` intercepta la request
antes de que salga a la red, pero el navegador sigue evaluando CORS sobre la
respuesta que Playwright le da (interceptar no exime del chequeo). Además
`apiClient.js` agrega header `Authorization: Bearer <token>` en toda request
autenticada → dispara **preflight OPTIONS** (un header custom siempre fuerza
preflight, sin importar el content-type).

Consecuencia práctica: **todo mock de `/apps/api_*.php` necesita**:
- Responder también al método `OPTIONS` (204 + `Access-Control-Allow-Origin`,
  `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: authorization,
  content-type`).
- Incluir `Access-Control-Allow-Origin: http://localhost:4173` (o `*`) en la
  respuesta real (GET/POST/OPTIONS).

`login`/`refresh`/`logout` (van con `auth:false`, sin header Authorization) no
disparan preflight pero igual necesitan `Access-Control-Allow-Origin` en la
respuesta porque siguen siendo cross-origin.

**Acción recomendada para Ronda 2**: un helper único (`e2e/support/mockApi.js`
o similar) que registre la ruta y agregue estos headers siempre, para no
repetirlo a mano en cada spec y no perder media hora debuggeando un
`TypeError: Failed to fetch` que en realidad es CORS.

### 0.2 Interacción entre `page.route()` y el Service Worker real

El runtime caching de Workbox (`vite.config.js`) registra una ruta
`NetworkFirst` **solo para GET a `/apps/api_*`**. Una vez que el SW está
activo y controla la página, esas GET (`buscar`, `detalle`,
`pendientes_controlar`, `ajustes_frecuentes`, `proveedores`) pasan por el
`fetch` que hace el propio Service Worker dentro de su estrategia, no
necesariamente por el `fetch` de la página. Si `page.route()` no llega a
interceptar ese fetch (el SW corre en su propio contexto/target), el mock no
aplica y el test pega contra una red real inexistente → timeout o respuesta
vacía, con una causa raíz nada obvia. Los `POST` (`actualizar_precio`,
`ajustar_stock`, `confirmar`, `analizar`, `login`, `refresh`, `logout`) **no**
tienen entrada en `runtimeCaching`, así que el SW no los toca — para esos no
hay riesgo, `page.route()` los ve sin duda.

**No lo doy por hecho sin probarlo**: la primera tarea de implementación
(ver §7) es un spike de 10 minutos que confirma si `page.route()` intercepta
o no una GET mockeada con el SW activo y controlando.

**Mitigación ya decidida independientemente del resultado del spike**: los
specs de **flujos de negocio** (login/buscar/reportes/importar) usan
`test.use({ serviceWorkers: 'block' })` — no necesitan un Service Worker real
en el medio, solo agrega superficie de fallo a mocks que no tienen nada que
ver con PWA. El Service Worker real **solo** se deja activo
(`serviceWorkers: 'allow'`, el default) en los specs `pwa-*.spec.js`, que son
justamente los que necesitan probarlo. Esto separa responsabilidades con
claridad y evita que un test de "editar precio" sea flaky por una condición de
carrera del cache del SW que no tiene nada que ver con lo que ese test
verifica.

### 0.3 Los inputs no tienen `<label for>` — afecta los locators

Todos los `<label>` del formulario de login y de `ProductoCard` son elementos
hermanos del `<input>`, sin `for`/`id` que los asocie ni el input envuelto
dentro del `<label>`. Consecuencia: `page.getByLabel('Usuario')` **no** va a
encontrar el campo (Playwright exige esa asociación explícita). Y los inputs
`type="number"` (stock/costo/precio) sí tienen rol implícito `spinbutton`,
pero los tres son indistinguibles entre sí por `getByRole` porque ninguno
tiene `aria-label` — hace falta acotar por contenedor.

Locators que sí funcionan bien, por campo (documentado para que Ronda 2 no
tenga que redescubrirlo):

| Campo | Locator robusto |
|---|---|
| Usuario (login) | `input[autocomplete="username"]` |
| Clave (login) | `input[autocomplete="current-password"]` (type=password no tiene rol ARIA, `getByRole` no sirve) |
| Botón submit login | `getByRole('button', { name: /ingresar/i })` (texto visible, funciona bien) |
| Stock (ProductoCard) | acotar por contenedor: `locator('div', { hasText: 'Stock actual' }).locator('input[type=number]')` |
| Costo (ProductoCard) | `locator('div', { hasText: 'Precio de costo' }).locator('input[type=number]')` |
| Precio de venta | `locator('div', { hasText: 'Precio de venta' }).locator('input[type=number]')` |
| Guardar precio / Guardar stock / Aplicar seleccionados | `getByRole('button', { name: /guardar precio/i })` etc. — texto visible, sin problema |
| Input file (importar) | `locator('input[type=file]')` + `.setInputFiles(...)` directo — **no** hace falta clickear el dropzone visible ni esperar `filechooser`, Playwright puede setear el input oculto directamente |

No es bloqueante (hay locators robustos alternativos para todo), pero vale la
pena para el checklist de recomendaciones (§8): asociar `for`/`id` en los
labels sería trivial y dejaría los tests más simples y más cerca de "cómo
navegaría un lector de pantalla realmente" (que es, al fin y al cabo, la
razón de fondo detrás de "preferir locators de accesibilidad").

### 0.4 Falta de UI para "Logout"

Relevé `App.vue`, `TabBar.vue` y `AppBrand.vue` completos: **no hay ningún
botón, menú o gesto de logout en la interfaz**. La acción `auth.logout()`
existe en el store y funciona (POST best-effort a `api_auth.php?action=logout`
+ borra el refresh token de Dexie), pero no la invoca ningún componente. No
es un caso de "no lo encontré", es código muerto desde la perspectiva de la
UI — confirmado leyendo las tres vistas/componentes de chrome de la app y las
4 vistas de rutas, ninguna tiene un control de logout.

Esto rompe la premisa del punto 5 del enunciado ("Logout" como journey E2E) y
la regla explícita de la propia spec ("cada E2E debe representar un
escenario real de usuario" — no hay ningún clic real que dispare esto hoy).
Tratamiento propuesto en §1 y §6.

---

## 1. E2E — Journeys de negocio

### P0 — `e2e/auth.spec.js`

**Journey: Login exitoso → navegación protegida → sesión persistente →
sesión expirada**

Un solo spec file porque los cuatro sub-escenarios comparten el mismo setup
(mock de `api_auth.php`) y encadenarlos es más realista que aislarlos (un
usuario real primero loguea, después recarga, después su sesión expira en
algún momento — no son mundos separados).

Pasos (caso feliz):
1. `page.goto('/buscar')` sin sesión → el guard de router redirige a
   `/login?redirect=%2Fbuscar` (verificar la URL resultante, no solo que
   aparezca el form — el `redirect` querystring es lógica real a probar).
2. Completar usuario/clave → submit → mock POST `api_auth.php` `action=login`
   responde `{success:true, access_token, refresh_token, usuario:{id,rol:1,
   nombre}, config:{margen_objetivo_pct:30}}`.
3. Assert: redirige a `/buscar` (el `redirect` original, no `/buscar` a
   secas — probar que efectivamente vuelve a donde el usuario quería ir).
4. Assert: aparece el chrome de la app (header + TabBar) y **no** el form de
   login.

Sesión persistente (continuación del mismo test o test separado en el mismo
`describe`, reusando el login anterior):
5. Mock POST `api_auth.php` `action=refresh` → `{success:true, access_token:
   'nuevo', refresh_token:'rotado'}`.
6. `page.reload()`.
7. Assert: **no** se muestra el login (no hay parpadeo a `/login`), la app
   queda directamente en `/buscar` — esto ejercita `restaurarSesion()` +
   Dexie real (no fake-indexeddb: la sesión fue escrita por la app misma en
   el paso 2, en IndexedDB real del navegador, y leída de ahí en el reload).

Sesión expirada (test separado, mismo describe):
8. Login exitoso (igual que 1-4).
9. Mock `action=refresh` → `{success:false, error:'Sesión expirada.'}`.
10. `page.reload()`.
11. Assert: termina en `/login` (sin `redirect` en la URL esta vez, porque el
    guard dispara desde `/buscar` que es donde estaba parado — confirmar
    contra el código real de `router/index.js`, el `redirect` sí se agrega
    siempre que `!estaAutenticado`, así que en verdad sería
    `/login?redirect=%2Fbuscar`; ajustar la aserción a lo que el guard
    realmente hace, no a una suposición).

**Casos negativos** (mismo archivo, tests separados):
- **Login con credenciales inválidas**: mock `action=login` →
  `{success:false, error:'Usuario o clave incorrectos.'}` → assert error
  visible en rojo, sigue en `/login`, el input de clave no se limpia
  agresivamente (UX básica).
- **API caída / network error en login**: `route.abort('failed')` en vez de
  `fulfill` → `apiClient` cachea el `fetch` que tira y relanza `'No hay
  conexión con el servidor.'` → assert ese mensaje exacto aparece (es texto
  real del código, no genérico).
- **Recuperación tras error**: falla el primer submit (network error) →
  cambiar el mock a éxito → volver a tocar "Ingresar" sin recargar la página
  → assert que la segunda vez funciona (el form no quedó en un estado roto
  tras el primer error).
- **Doble submit**: disparar dos `click()` rápidos sobre "Ingresar" (o
  `Promise.all` de dos evaluaciones) → assert que **solo una** request POST
  `action=login` salió (contar vía `page.route` callback o
  `page.waitForRequest` con contador) — el botón se deshabilita
  sincrónicamente (`enviando.value = true` antes del primer `await`), pero
  vale la pena blindarlo con un test real en vez de asumir que el `:disabled`
  reactivo alcanza.
- **Sesión expirada a mitad de uso (no en un reload)**: logueado y parado en
  `/buscar`, mockear la próxima GET de `buscar` con `401`, y `action=refresh`
  con `{success:false}` → assert que la UI **no** redirige solo por eso
  (el guard de router corre en navegación, no reactivo al store — es
  comportamiento real del código, confirmado leyendo `apiClient.js`: cuando
  el refresh falla, `limpiarSesionLocal()` deja `accessToken=null` pero la
  respuesta 401 original se sigue parseando y devolviendo tal cual, sin
  redirect automático) → **después**, clickear un link del TabBar (ej.
  "Reporte") → ahí sí redirige a `/login`. Es un detalle sutil y 100% real,
  vale como P1 dentro del mismo archivo, no como journey aparte.

**Mocks necesarios**: `POST api_auth.php` (`action=login|refresh|logout`),
sin GET.

---

### P0 — `e2e/buscar-editar-producto.spec.js`

**Journey: Buscar producto → ver detalle → editar precio (guardar aparte) →
editar stock (guardar aparte)**

Precondición: sesión ya iniciada (usar el helper de login del §0, no repetir
el flujo de auth completo acá — este spec asume login OK y arranca directo en
`/buscar` con `serviceWorkers: 'block'`).

Pasos:
1. Tipear en el buscador (`SearchBar`) → mock GET `api_productos.php
   action=buscar` (esperar el debounce de ~300ms **de verdad**, no
   saltearlo con `page.waitForTimeout` arbitrario — usar
   `page.waitForResponse()` sobre la request mockeada, que naturalmente
   espera lo que haga falta sin acoplarse a los 300ms exactos).
2. Assert aparecen resultados en el dropdown (rol `button` con el nombre del
   producto — acá `getByRole('button', {name: /tornillo/i})` funciona bien
   porque el texto es visible).
3. Click en un resultado → mock GET `action=detalle` → assert `ProductoCard`
   muestra código/nombre/stock/costo/precio del mock.
4. Cambiar el input de costo y precio de venta (locators de la tabla en §0.3)
   → click "Guardar precio" → mock POST `action=actualizar_precio` →
   assert toast de éxito ("Precio actualizado.") y que el margen mostrado se
   recalculó con los nuevos valores (verificar el **cálculo real** en
   pantalla, no solo que el toast apareció — ahí está el valor del E2E sobre
   un unit test: confirma que el dato que persistió el backend mock es el
   mismo que terminó pintado).
5. Por separado (no depende de 4): usar el stepper +/- y también tipear
   directo en el input de stock → click "Guardar stock" → mock POST
   `action=ajustar_stock` → assert toast + valor de stock actualizado en
   pantalla.

**Casos negativos**:
- **Precio de venta <= costo**: mock `action=actualizar_precio` →
  `{success:false, error:'El precio de venta no puede ser menor o igual al
  costo.'}` (mensaje de ejemplo — el backend real define el texto exacto,
  pero el punto del test es que el store lanza y el componente lo muestra
  como toast de error) → assert toast rojo, y que el valor en pantalla
  **no** cambió (el `actual.value` del store no se pisa si `!data.success`).
- **API caída al guardar precio/stock**: `route.abort('failed')` → assert
  toast con "No hay conexión con el servidor." — clave: assert también que
  el botón vuelve a estar habilitado y el valor tipeado por el usuario
  **sigue en el input** (no se resetea) — es la garantía explícita que el
  propio código documenta en `db.js` ("reintentar es simplemente volver a
  tocar Guardar").
- **Timeout**: mock con `route.fulfill` demorado varios segundos (o nunca
  resolver y dejar que expire el timeout de Playwright/del propio fetch) →
  mismo resultado esperado que "API caída": no debe colgarse la UI
  indefinidamente sin feedback.
- **Doble submit en "Guardar precio"**: doble click rápido → assert una sola
  request POST `actualizar_precio` (mismo patrón que en auth).
- **Búsqueda sin resultados**: mock `action=buscar` → `{success:true,
  items:[]}` → assert mensaje "Sin resultados. Probá con el código."
- **Buscar con el buscador vacío**: no debe disparar ninguna request (el
  store corta en `if (!q) return` antes del debounce) — assert de ausencia
  de request, útil para pescar una regresión donde alguien saque ese guard.

**Mocks**: GET `api_productos.php` (`buscar`, `detalle`), POST
`api_productos.php` (`actualizar_precio`, `ajustar_stock`).

---

### P1 — `e2e/reportes-scroll-infinito.spec.js`

**Journey: Ver pendientes de controlar con scroll infinito → cambiar a tab
"Ajustes frecuentes" → scroll infinito ahí también**

Este es el caso de uso más "no lo podés probar con unit/integration" de toda
la app: usa `IntersectionObserver` real contra un sentinela — en
`tests/setup.js` ese observer está **stubbeado como no-op**
(`observe(){}`), así que un test unitario/integración literalmente no puede
ejercer el disparo real del scroll. Acá sí, con Chromium real.

Pasos:
1. Login + ir a `/reportes` (tab "Pendientes" por default, `onMounted` ya
   dispara `cargarPendientes(0)`).
2. Mock GET `api_reportes.php action=pendientes_controlar&offset=0` →
   20 items, `total:45`.
3. Assert 20 filas renderizadas, sentinela presente (existe mientras
   `items.length < total`).
4. Mock GET con `offset=20` → 20 items más (`total:45` sin cambiar, según el
   comportamiento real: el backend solo recalcula `total` en `offset===0`,
   y el store lo respeta).
5. Scrollear la lista real (`sentinela.scrollIntoViewIfIfNeeded()` o
   `mouse.wheel` sobre el contenedor) para disparar el `IntersectionObserver`
   de verdad — **no** invocar la función de carga a mano.
6. Assert: 40 filas, **una sola** request con `offset=20` (no duplicada, no
   loop) — clave del punto 3 del enunciado.
7. Mock GET con `offset=40` → 5 items restantes (`total:45`) → scrollear de
   nuevo → assert 45 filas y que el sentinela **desapareció** (`v-if
   hasMorePendientes` pasa a false) → scrollear una vez más y assert que
   **no** sale ninguna request nueva (no queda un observer zombie
   disparando contra un sentinela que ya no existe — buen test de que
   `useInfiniteScroll` desconecta bien).
8. Cambiar a tab "Ajustes frecuentes" → dispara `cargarAjustes(0)` recién ahí
   (lazy, no en el mount) → mock GET `ajustes_frecuentes&offset=0` → repetir
   una vuelta de scroll para confirmar que el segundo sentinela (el de la
   otra tab) también reconecta bien tras el remount del `v-if`/`v-else`
   (motivo explícito documentado en el propio composable).

**Casos negativos**:
- **Estado vacío**: mock `pendientes_controlar` → `{items:[], total:0}` →
  assert "Sin productos pendientes." y **sin** sentinela (no debería ni
  intentar cargar de más).
- **API caída al abrir Reportes** — **este es un hallazgo, no un caso de
  manual de estilo**: `reportes.cargarPendientes`/`cargarAjustes` no tienen
  `catch`, solo `try/finally` (confirmado leyendo `stores/reportes.js`). Si
  el `fetch` tira, la excepción se propaga fuera de una función async
  llamada sin `.catch()` desde `onMounted` → **unhandled promise rejection**
  en consola, y la pantalla se queda muda (sin banner de error, a diferencia
  de `productos.error` que sí existe). Test: `route.abort('failed')`,
  escuchar `page.on('pageerror')` o `page.on('console')` con nivel error, y
  assertar que efectivamente aparece esa rejection **y** que la UI no
  muestra ningún error (para dejar el gap documentado con un test que falla
  el día que alguien lo arregle sin querer romper otra cosa, y sirve de
  regression-lock del comportamiento actual mientras tanto). Ver también
  §6 recomendaciones — esto debería arreglarse en el store, no solo
  testearse.

**Mocks**: GET `api_reportes.php` (`pendientes_controlar`,
`ajustes_frecuentes`), variando `offset`.

---

### P0 — `e2e/importar-lista-precios.spec.js`

**Journey: Elegir proveedor → subir archivo → checklist con
aplicables/no-aplicables → aplicar seleccionados → resumen → importar otra**

Pasos:
1. Login + ir a `/importar`.
2. Mock GET `api_importacion_precios.php action=proveedores` →
   `{success:true, items:[{per_id:1, per_nombre:'Proveedor SA'}]}` → assert
   aparece en el `<select>`.
3. Elegir proveedor (opcional — probar también el camino "sin proveedor",
   `value=0`, en un test separado o con `test.each`-like duplicado manual ya
   que no hay `test.each` nativo en Playwright — dos `test()` cortos).
4. `setInputFiles` con un CSV/txt de fixture pequeño (sin pasar por
   compresión de imagen, camino simple) → mock POST multipart
   `action=analizar` → `{success:true, items:[
   {prod_id:1, nombre_detectado:'Tornillo 3/4', aplicable:true,
   costo_actual:100, precio_detectado:120, precio_venta_actual:180,
   margen_proyectado_pct:33.3, margen_bajo:false},
   {prod_id:2, nombre_detectado:'Tuerca M8', aplicable:false,
   motivo_no_aplicable:'Sin match de código', costo_actual:0,
   precio_detectado:50, precio_venta_actual:0}
   ], sin_match:1, fuente:'csv', avisos:[]}`.
5. Assert: checklist con 2 filas, la fila `aplicable:false` viene
   **destildada automáticamente** y el checkbox **disabled** (regla
   explícita del enunciado: `seleccionado: item.aplicable` al mapear) —
   probar esto puntualmente porque es una regla de negocio no obvia con
   consecuencia real si se rompe (aplicaría una línea que el backend marcó
   como no aplicable).
6. Destildar la fila aplicable (probar que se puede) y volver a tildarla →
   click "Aplicar seleccionados (1)" (el contador en el texto del botón es
   parte del contrato visual, vale assertarlo) → mock POST `action=confirmar`
   → `{success:true, aplicados:1, rechazados:0}`.
7. Assert pantalla de resumen ("Se actualizaron 1 productos" en el toast +
   el panel de resumen).
8. Click "Importar otra lista" → assert que vuelve al estado inicial
   (selector de archivo, sin resumen, sin items, input file limpio para
   poder resubir el mismo nombre de archivo si hiciera falta).

**Casos negativos**:
- **`aplicar` con 0 seleccionados**: destildar todo → assert botón
  disabled (el store corta en `if (lineas.length===0) return` — nada que
  mockear, es un guard de UI).
- **API caída en `analizar`**: `route.abort('failed')` → assert error
  ("No hay conexión con el servidor.") y que el estado vuelve a
  "seleccionar archivo" (no se queda trabado en el spinner "Analizando...").
- **Backend rechaza el archivo** (ej. formato no reconocible): mock
  `{success:false, error:'No se pudo leer el archivo.'}` → assert error
  visible, sin checklist.
- **`confirmar` falla tras un análisis exitoso**: assert que el error se
  muestra y el checklist **no desaparece** (`items.value = []` solo pasa en
  el `try` exitoso, así que el usuario no pierde su selección si el guardado
  falla — vale confirmarlo).
- **Doble submit en "Aplicar seleccionados"**: mismo patrón que los otros
  dos.
- **Permisos insuficientes (rol FISCAL)**: login con `usuario:{rol:3}` →
  el TabBar oculta el link a "IA Lista PDF" (assert que el link **no**
  está en el DOM, con `page.getByRole('link', {name:/lista pdf/i})` →
  `.count()` 0) — **pero además**, navegar directo por URL
  (`page.goto('/importar')`) porque el router **no** tiene ningún guard de
  rol (confirmado en `router/index.js`: solo existe `meta.requiresAuth`
  para login, nada para rol) → la vista carga igual → intentar subir un
  archivo → mock `action=analizar` con `403` (esto lo hace cumplir el
  backend real, acá se simula) → assert que la UI muestra el error sin
  romperse (no queda colgada, no tira un error JS no capturado). Este test
  documenta y fija el comportamiento intencional descripto en el comentario
  de `TabBar.vue` ("esto es solo UX, el backend valida de verdad").

**Mocks**: GET `api_importacion_precios.php` (`proveedores`), POST
multipart (`analizar`), POST (`confirmar`).

**Nota de implementación**: para el caso "sube una foto real y se comprime",
un test P2 aparte (no bloqueante para P0) puede subir un JPG de fixture
pequeño y, en el handler de `route()`, leer `request.postData()` para
confirmar que el nombre de archivo dentro del multipart terminó en `.jpg`
(prueba indirecta de que pasó por `comprimirSiEsImagen`, que usa Canvas real
del navegador — otra cosa que jsdom no puede ejercer).

---

### Excepción — Logout (no entra como spec propio)

Como se documentó en §0.4, no existe ningún control de UI para disparar
`auth.logout()`. Frente a esto hay tres caminos, y elijo el tercero:

1. Simular un click en algo que no existe → inventa un escenario de usuario
   ficticio, viola la regla explícita del enunciado.
2. Invocar `auth.logout()` por `page.evaluate` alcanzando el store de Pinia
   → técnicamente posible pero **no es un test E2E de un flujo de usuario**,
   es un test de integración de store+red+IndexedDB disfrazado de E2E (y el
   store ni siquiera está expuesto en `window` hoy, habría que agregar un
   hook de test-only, que tampoco corresponde en esta ronda).
3. **No armar un E2E de logout.** Queda documentado en §6 como
   funcionalidad que no se puede automatizar como E2E genuino **por
   ausencia de punto de entrada en la UI**, con la recomendación concreta en
   §8 de agregar un botón real de "Cerrar sesión" (natural en `AppBrand.vue`
   o una pantalla de perfil) — que además no es solo un problema de
   testing: hoy un usuario real tampoco puede cerrar sesión desde la app.

---

## 2. Mapa de mocks por journey (resumen)

| Journey | Endpoint + acción | Método | Notas |
|---|---|---|---|
| Auth | `api_auth.php` `login` | POST (sin auth) | requiere CORS, no preflight |
| Auth | `api_auth.php` `refresh` | POST (sin auth) | ídem, se llama sola en `restaurarSesion` |
| Auth | `api_auth.php` `logout` | POST (sin auth) | solo si se decide el camino 2 de la excepción |
| Buscar/editar | `api_productos.php` `buscar` | GET (auth) | preflight, pasa por SW en runtime real |
| Buscar/editar | `api_productos.php` `detalle` | GET (auth) | ídem |
| Buscar/editar | `api_productos.php` `actualizar_precio` | POST (auth) | preflight, no pasa por SW |
| Buscar/editar | `api_productos.php` `ajustar_stock` | POST (auth) | ídem |
| Reportes | `api_reportes.php` `pendientes_controlar` | GET (auth) | paginado por `offset`, pasa por SW |
| Reportes | `api_reportes.php` `ajustes_frecuentes` | GET (auth) | ídem |
| Importar | `api_importacion_precios.php` `proveedores` | GET (auth) | pasa por SW |
| Importar | `api_importacion_precios.php` `analizar` | POST multipart (auth) | no pasa por SW |
| Importar | `api_importacion_precios.php` `confirmar` | POST (auth) | no pasa por SW |

Todas las GET autenticadas viven bajo el mismo `runtimeCaching` de Workbox
(`/apps/api_*` + método GET) — son las que dependen del resultado del spike
de §0.2.

---

## 3. Plan de tests PWA

### 3.1 Service Worker — `e2e/pwa-service-worker.spec.js`

| Sub-caso | Viable | Cómo |
|---|---|---|
| Registro | Sí (P0) | tras `page.goto('/')`, poll `navigator.serviceWorker.getRegistration()` hasta que exista; `scope` debe ser `/` |
| Activación | Sí (P0) | `registration.active?.state === 'activated'`; en la primera visita, gracias a `clientsClaim()` (confirmado en `dist/sw.js`: `self.skipWaiting(), e.clientsClaim()` incondicionales), el SW toma control de la página **sin reload**, incluso en la visita inicial — vale un assert explícito de `navigator.serviceWorker.controller !== null` sin haber recargado, es un detalle real y no obvio de esta config |
| Actualización | Sí (P0/P1), ver 3.5 | requiere rebuildear `dist/` a mitad de test |
| Comportamiento post-nueva-versión | Sí, mismo test que actualización | — |
| Instalabilidad (proxy de "puede instalarse") | Sí (P1) | `context.newCDPSession(page)` → `Page.getInstallabilityErrors` → assert `errors: []`. Es la señal más cercana a "Chrome mostraría el banner de instalar" sin depender de UI nativa |

### 3.2 Offline — `e2e/pwa-cache-offline.spec.js`

Distingo **dos capas de offline** que el código implementa por separado y que
hay que testear por separado porque tienen alcance distinto:

**Capa 1 — Cache del Service Worker (Workbox `NetworkFirst`, transparente a
la app)**: cubre exactamente las GET a `/apps/api_*` que ya se pidieron antes
con esa URL exacta (mismo querystring). Vive en Cache Storage, la ve
cualquier request aunque el código de la store ni se entere de que estuvo
offline.

**Capa 2 — Fallback explícito en `stores/productos.js` (Dexie
`catalogoCache`)**: solo se activa cuando el `fetch` de verdad tira una
excepción (network error real), y hace un filtro por texto sobre **todo** lo
cacheado alguna vez, sin importar la URL/query original. Es más amplio pero
requiere haber visto el producto antes en cualquier búsqueda o detalle
previo.

Para testear la Capa 2 de forma que realmente la ejercite (y no termine
sirviendo desde la Capa 1 sin darme cuenta) hay que buscar algo **distinto**
de lo que se buscó estando online, así el cache HTTP del SW no tiene esa URL
y el fetch realmente falla.

| Sub-caso | Viable | Cómo |
|---|---|---|
| App inicia sin conexión (primera vez, sin visita previa) | Parcialmente — no hay nada precacheado, esperable que falle. Vale un test P2 que confirme que al menos no explota (pantalla en blanco vs. algún mensaje), pero no hay "modo offline de bienvenida" que probar porque no lo hay en el código |
| App inicia sin conexión (con visita previa — shell cacheado) | Sí (P0) | login online, `context.setOffline(true)`, `page.reload()` → assert que el shell (index.html + JS/CSS vía precache de Workbox) carga y renderiza `/buscar` o `/login` según haya o no sesión — **no** una página de error de Chrome |
| Se pierde conexión durante el uso — búsqueda con Capa 1 (misma query ya vista) | Sí (P1) | buscar "tornillo" online, offline, buscar "tornillo" de nuevo → sirve del cache de Workbox, el `fetch` de la página ni se entera de que está offline (no debería mostrarse ningún indicador de "modo offline" porque desde la perspectiva del código fue un fetch exitoso) |
| Se pierde conexión durante el uso — búsqueda con Capa 2 (query nueva) | Sí (P0) — **es el caso que el propio código documenta como decisión explícita** | buscar "tornillo" online (puebla `catalogoCache`), offline, buscar "tuerca" (nunca pedida) → el fetch tira, cae al filtro sobre `catalogoCache` → si "tuerca" está en el nombre de algo cacheado, aparece igual en resultados. Probar con datos donde SÍ matchea y un caso donde NO matchea nada (sigue mostrando "Sin resultados", no un error confuso) |
| Mutaciones offline (`actualizar_precio`/`ajustar_stock`/`confirmar`) | Sí (P0, caso negativo) | ya cubierto en los specs de journey — acá se referencia, no se duplica: **no** deben "funcionar offline" (decisión de diseño explícita, documentada en `vite.config.js` y `db.js` — reintentar en background una mutación de stock puede pisar cambios posteriores), deben fallar con el mensaje de red claro |
| Se recupera la conexión | Sí (P1) | offline → intento de guardar precio falla con mensaje → `context.setOffline(false)` → reintentar (tocar "Guardar" de nuevo, no hay retry automático) → mock ahora en éxito → assert que funciona sin recargar la página |

### 3.3 Cache de assets — dentro del mismo `pwa-cache-offline.spec.js`

| Sub-caso | Viable | Cómo |
|---|---|---|
| Assets críticos precacheados | Sí (P1) | tras la primera carga, `caches.open(...)` (nombre de cache lo determina Workbox, listar con `caches.keys()` y filtrar por `workbox-precache`) → assert que contiene `index.html`, el manifest, los íconos y los chunks JS/CSS del build actual (comparar contra `dist/sw.js` generado, que lista el precache manifest explícito) |
| Comportamiento con cache (NetworkFirst prioriza red si hay) | Sí (P1) | online, mockear la respuesta de `buscar` con un valor A → assert que se ve A (no lo que hubiera en cache de una corrida anterior) — confirma que es `NetworkFirst` y no `CacheFirst` |
| Actualización de assets tras nuevo build | Sí (P0), ver 3.5 | — |
| Ausencia de assets obsoletos tras actualización | Sí (P0), ver 3.5 | — |

### 3.4 Instalación — `e2e/pwa-manifest-instalacion.spec.js`

| Sub-caso | Viable | Cómo / por qué no |
|---|---|---|
| Manifest válido | Sí (P1) | `page.request.get('/manifest.webmanifest')` → JSON válido → assert `name`, `short_name`, `display:'standalone'`, `start_url`, `theme_color`, `background_color`, `icons[]` con `src`/`sizes`/`type` |
| `<link rel="manifest">` presente | Sí (P1) | chequeo de DOM directo |
| Íconos resuelven | Sí (P1) | pedir cada `icon.src` del manifest, assert `200` + `content-type: image/svg+xml` |
| Señal de instalabilidad (proxy) | Sí (P1) | mismo `Page.getInstallabilityErrors` de 3.1 |
| Instalación real (banner nativo / `beforeinstallprompt` real) | **No** | Chromium bajo Playwright no dispara el flujo real de instalación de PWA (requiere integración con el shell del SO); no hay API pública de Playwright para esto. Va a §7 |
| Apertura como app instalada | **No** | requiere una instalación real del SO, fuera del alcance de un browser automation tool. Va a §7 |
| Comportamiento en modo standalone | Parcial/no aplica | revisé todo `src/` buscando `matchMedia('(display-mode: standalone)')` o lógica condicional por modo de display: no existe ninguna en el código actual. No hay nada específico que probar más allá de lo que ya cubre el manifest — si en el futuro se agrega lógica condicional a standalone, ahí sí ameritaría un test con `Emulation.setEmulatedMedia` vía CDP (Playwright no lo expone en su API de alto nivel, haría falta `context.newCDPSession`) |

### 3.5 Actualización v1 → v2 — `e2e/pwa-actualizacion-v1-v2.spec.js`

El mecanismo real (confirmado leyendo `node_modules/vite-plugin-pwa/dist/client/build/register.js` y el `dist/sw.js` ya generado, no supuesto):

- `registerType:'autoUpdate'` compila a `self.skipWaiting()` +
  `clientsClaim()` **incondicionales** dentro del SW generado.
- El cliente (`registerSW({immediate:true})`) escucha el evento `activated`
  del `Workbox` de `workbox-window`; si `event.isUpdate` es true, llama
  `window.location.reload()` **automáticamente, sin preguntarle nada al
  usuario** (no hay prompt de "hay una nueva versión, ¿recargar?" en esta
  app — el modo es autoUpdate, no prompt).
- Un SW nuevo solo se detecta cuando el navegador vuelve a pedir `sw.js` y el
  byte-a-byte difiere — eso pasa naturalmente en cada navegación/reload, no
  hace falta ningún truco para forzar el chequeo.

Plan de test (P1, pesado — un solo caso, no una matriz):
1. `npm run build` ya corrido por el `webServer` de Playwright (v1) →
   `page.goto('/')` → esperar SW `activated`.
2. Dentro del test: tocar un archivo fuente trivial (ej. un comentario en
   `src/main.js` vía `fs.writeFileSync`) y correr `npm run build` de nuevo
   con `execSync` — el hash de contenido de los chunks cambia, por lo tanto
   el precache manifest embebido en `sw.js` cambia, por lo tanto `sw.js`
   cambia byte a byte (eso es lo único que le importa al navegador para
   detectar update).
3. `page.reload()` → el navegador detecta el `sw.js` distinto → instala el
   SW nuevo → por `skipWaiting`+`clientsClaim` incondicionales, activa casi
   inmediato → dispara el listener de `register.js` → **la página se
   recarga sola una segunda vez**. Hay que esperar ese segundo reload
   (`page.waitForEvent('load')` dos veces, o esperar a que
   `navigator.serviceWorker.controller.scriptURL` dejó de apuntar al SW
   viejo y la URL de algún asset con hash cambió) — nada de
   `waitForTimeout` arbitrario, hay eventos reales para engancharse.
4. Assert: el bundle servido después del segundo reload corresponde al build
   v2 (nombre de archivo JS con hash nuevo en las requests de red).
5. Assert **ausencia de assets obsoletos**: `caches.open(...)` del precache
   de Workbox → listar entradas → ninguna debe apuntar al hash de chunk de
   v1 (`cleanupOutdatedCaches()` está registrado explícitamente en el SW
   generado, así que esto debería cumplirse — el test lo deja fijado con
   evidencia en vez de asumirlo).
6. Restaurar el archivo tocado en el paso 2 al terminar el test (o usar un
   archivo temporal fuera de `src/` que no ensucie git — mejor: escribir el
   "toque" en una copia de `dist/` post-build en vez de tocar `src/` y
   rebuildear, para no depender de un segundo build completo dentro del
   test — evaluar en Ronda 2 cuál de las dos formas da un test más rápido y
   menos invasivo; ambas son técnicamente viables, lo importante es que el
   cambio sea real (contenido con hash distinto), no un mock).

Esto es lento (potencialmente 2 builds completos de Vite dentro de un mismo
test) — por eso va en su propio archivo, corre solo en `desktop-chromium`, y
va al final del orden de implementación (§7).

---

## 4. Desktop vs. mobile vs. ambos

Config actual corre **todo spec en ambos proyectos por default** (Playwright
no filtra por proyecto salvo que el spec lo pida explícitamente). La decisión
real es dónde vale la pena **restringir** para no duplicar sin señal:

| Spec | Desktop | Mobile (Pixel 7) | Justificación |
|---|---|---|---|
| `auth.spec.js` | Sí | Sí | login es el primer contacto, cualquier problema de tap-target/viewport en el form importa en ambos — es además barato de correr dos veces |
| `buscar-editar-producto.spec.js` | Sí | Sí | es el journey de mayor uso real (celular en el piso de venta, según el propio README) — acá el mobile **es** el caso primario, no el secundario; si algo se corre en un solo proyecto por tiempo, este es candidato a NO recortar |
| `reportes-scroll-infinito.spec.js` | Sí | Sí | el scroll táctil real (Pixel 7 emula touch) es justo el mecanismo que se quiere validar; en desktop el scroll es con mouse wheel — vale la pena ver que el `IntersectionObserver` dispara igual con ambos mecanismos de input |
| `importar-lista-precios.spec.js` | Sí | Sí | el dropzone/file picker y el checklist con controles chicos son sensibles a viewport angosto |
| `visual.spec.js` | Sí | Sí | ver §5 — screenshots por viewport son casi el propósito del test |
| `pwa-service-worker.spec.js` | Sí | **No** (restringir con `test.skip` por `testInfo.project.name`) | mecánica de SW/CDP no depende de viewport ni de touch; correrlo dos veces no agrega señal, solo duplica tiempo de CI |
| `pwa-cache-offline.spec.js` | Sí | Recomendado si el tiempo de CI lo permite, si no, opcional | el comportamiento de cache/offline tampoco depende de viewport, pero como esta es una PWA pensada para celular, un smoke mínimo offline en mobile (aunque sea 1-2 de los casos, no todos) da tranquilidad extra sin duplicar todo |
| `pwa-manifest-instalacion.spec.js` | Sí | **No** | el manifest es el mismo recurso estático sin importar el viewport |
| `pwa-actualizacion-v1-v2.spec.js` | Sí | **No** | ya es lento por el rebuild; no hay ninguna razón para que el resultado difiera por viewport, y correrlo una sola vez ya implica ~2 builds completos |

---

## 5. Visual regression — máximo 2, justificadas

**No** se incluye la pantalla de login ni el estado vacío de reportes:
regresiones ahí son cosméticas, no producen una decisión de negocio
equivocada.

1. **`ProductoCard` con margen bajo** (`e2e/visual.spec.js`,
   `screenshot: 'saas-producto-margen-bajo'`, y su contraparte
   `margen-ok`). Justificación: el color/contraste del badge de margen
   (`bg-red-100 text-danger` vs `bg-green-100 text-success`) y el banner de
   advertencia son la única señal visual de que un precio quedó mal
   cargado. Si una regresión de CSS deja ambos estados visualmente
   parecidos (ej. un cambio de paleta que empareja los dos tonos, o rompe la
   condicional de clases), un empleado puede guardar un precio con margen
   insuficiente sin darse cuenta — eso es plata real, no un detalle
   estético. Vale capturar **ambos** estados (par de screenshots) para que
   la comparación sea justamente "¿se siguen distinguiendo?".

2. **`ImportarView` checklist con ítems aplicables y no aplicables
   mezclados**. Justificación: la fila no aplicable se ve
   (`opacity-60` + checkbox disabled) para que quede claro que no se va a
   aplicar. Una regresión visual que deje esa fila con apariencia normal
   (opacidad completa, o el disabled no se nota) puede llevar a que el
   usuario piense que algo se va a actualizar cuando en realidad el checkbox
   ni siquiera es clickeable — la misma familia de riesgo que el punto 1:
   confusión visual con consecuencia de precio/stock mal aplicado.

Se descartó agregar un tercer screenshot del dropdown de resultados de
búsqueda (mismo patrón rojo/verde de margen que el punto 1, sería
redundante) y el estado de resumen de importación (informativo, sin
decisión del usuario de por medio en esa pantalla).

---

## 6. Qué NO cubre este plan (ya cubierto en otra capa)

- **Cálculos puros** (`margenActual`, `margenBajo`, `formatearMonto`, el
  filtro de `buscarEnCache`, el `slice(0,4)` de recientes, `descripcion()` de
  historial) → Subagente 1 (unit, sobre la función/computed aislada). E2E
  solo verifica que el número **correcto según esos cálculos** termina
  pintado en pantalla tras una acción real, no reprueba la fórmula con
  distintos inputs límite.
- **Matriz completa de status codes por endpoint** (400/403/404/409/422/429/
  500 con variantes de payload de error) → Subagente 2 (integration con
  MSW). E2E toma 2-3 representantes por journey con impacto en el
  **comportamiento observable** (API caída, sesión expirada, validación
  rechazada) — no repite la matriz completa por endpoint, sería doble
  trabajo sin señal nueva.
- **Contrato exacto de payload enviado** (nombres de parámetros, forma exacta
  del `URLSearchParams`/`FormData`) → Subagente 2. E2E solo mira la
  respuesta observable en pantalla, no intercepta para inspeccionar el
  payload salvo la excepción puntual de §1 (nombre de archivo `.jpg` tras
  compresión, porque ahí el punto es Canvas real, no el contrato HTTP).
- **Cola single-flight de refresh ante 401s concurrentes** → Subagente 2 es
  mejor lugar (puede disparar N requests concurrentes controladas y contar
  llamadas a `refresh` exactamente 1, sin la varianza de timing de un
  browser real). E2E se queda con el caso de negocio de más alto nivel
  (sesión expirada visible al usuario), no con la mecánica interna de la
  cola.
- **Renderizado de `ProductoCard`/`SearchBar` con distintas combinaciones de
  props aisladas** (sin red, montando el componente directo) → Subagente 1.
- **Lógica del composable `useInfiniteScroll` en abstracto** (los guards
  `hasMore`/`loading`, qué pasa si `sentinelRef` es null) → Subagente 1, con
  un stub de `IntersectionObserver` (ya existe en `tests/setup.js`). **Ojo**:
  esto no vuelve redundante el E2E de scroll infinito — son capas distintas:
  el unit test prueba la lógica de guard con un observer falso que nunca
  dispara solo; el E2E prueba que el observer **real** del navegador
  efectivamente dispara al llegar al final de una lista real. Ninguno de los
  dos por separado cubre lo que cubre el otro.
- **Lectura/escritura de Dexie en abstracto** (`db.sesion.put/get`,
  `db.catalogoCache.put/toArray`) → Subagente 1/2, con `fake-indexeddb`. El
  E2E solo la ejercita como caja negra a través de flujos reales de usuario
  (login persiste sesión, búsqueda offline lee cache), usando la
  IndexedDB **real** de Chromium — vale la pena igual, no por probar Dexie
  de nuevo sino porque valida la integración real navegador+Dexie+SW en
  conjunto, que es justo lo que ninguna otra capa puede.

---

## 7. Problemas de PWA / de testabilidad detectados en esta ronda

(Hallazgos de la exploración de código, no de ejecución — en Ronda 1 no se
corrió nada, esto surge de leer el código fuente y el `dist/sw.js` ya
generado.)

1. **`reportes.cargarPendientes`/`cargarAjustes` no capturan errores de red**
   (a diferencia de `productos.buscar`/`seleccionar`, que sí tienen fallback
   a cache): un `fetch` fallido ahí produce una unhandled promise rejection
   y la pantalla de Reportes queda sin ningún indicio de error. Ver §1,
   spec de reportes — queda testeado como regression-lock, pero el arreglo
   real (agregar `catch` + algún mensaje) es una recomendación de producto,
   no solo de testing.
2. **No hay control de UI para logout** — ver §0.4. Bloquea directamente el
   journey 5 pedido en el enunciado original.
3. **El router no valida rol en `/importar`** — solo el `TabBar` oculta el
   link (documentado como intencional en el propio comentario del código,
   "esto es solo UX"), así que cualquier usuario autenticado que teclee la
   URL entra a la vista igual, y depende 100% de que el backend responda
   403 para no romper nada. Es un diseño válido si el backend efectivamente
   lo hace cumplir siempre — pero significa que el frontend no tiene ninguna
   defensa propia, vale la pena que quede testeado explícitamente (ya está
   en §1) para no perder ese contrato de facto.
4. **Inputs sin `label for=id`** — no es un bug funcional, pero sí un gap de
   accesibilidad real (un lector de pantalla no anuncia bien el campo) que
   además complica los locators de test. Ver §0.3 y recomendación en §8.
5. **La restauración de sesión requiere red sí o sí** — `restaurarSesion()`
   necesita canjear el refresh token contra el backend para obtener un
   access token nuevo (el access token nunca se persiste, por diseño). Esto
   significa que **"iniciar la app sin conexión" con una sesión guardada
   previamente NO deja al usuario logueado** — lo manda a `/login`, donde
   tampoco puede loguearse sin red. Es coherente con la arquitectura
   (access token de vida corta, en memoria), pero vale la pena que quien
   decide el alcance de "offline" de este producto lo sepa explícitamente:
   hoy "offline" cubre *lectura de catálogo ya visto* para un usuario que
   **ya estaba** con la sesión abierta en memoria, no un arranque en frío
   sin conexión. Test que fija este comportamiento en §3.2 (P2, "app inicia
   sin conexión, primera vez").
6. **Spike de interceptación SW pendiente de confirmar** (§0.2) — no es un
   bug de la app, es un riesgo de la propia estrategia de testing, listado
   acá para que quede visible junto con el resto de los hallazgos técnicos
   de esta ronda.

---

## 7bis. Funcionalidades que no se pueden automatizar (punto 7 del criterio de finalización)

- **Instalación real de la PWA** (banner nativo `beforeinstallprompt`,
  aceptar instalar, abrir como app standalone desde el launcher del SO) —
  requiere integración con el shell del sistema operativo, fuera del alcance
  de Playwright/Chromium automatizado. Se cubre indirectamente con las
  señales de instalabilidad (manifest válido + `Page.getInstallabilityErrors`
  vacío vía CDP), que es la condición necesaria pero no la instalación en
  sí.
- **Journey de Logout como E2E genuino** — no hay UI que lo dispare (§0.4).
- **Comportamiento realmente diferenciado en modo standalone** — no hay
  lógica condicional en el código que dependa de `display-mode`, así que no
  hay nada específico que verificar más allá de lo que ya cubre el manifest.
- **Push notifications / background sync** — no están implementados en esta
  app (no hay ninguna referencia en el código a `Notification`, `push`, o
  `sync` en el service worker generado), así que no aplica ningún test —
  se menciona solo para dejar constancia de que se buscó y no hay nada que
  cubrir ahí, no es un olvido.

---

## 8. Recomendaciones de cobertura adicional / al producto

1. **Agregar un botón real de "Cerrar sesión"** en la UI (natural en
   `AppBrand.vue` o una pantalla de perfil nueva) — sin esto, el journey 5
   del enunciado original queda permanentemente fuera de alcance de E2E, y
   de paso es una funcionalidad real que hoy le falta a un usuario del ERP.
2. **Asociar `<label for>`/`id`** en los formularios de login y
   `ProductoCard` — mejora accesibilidad real y simplifica los locators de
   test (podrían pasar a `getByLabel` en vez de los fallbacks de §0.3).
3. **Agregar manejo de error a `reportes.cargarPendientes`/`cargarAjustes`**
   (hallazgo #1 de §7) — hoy es la única pantalla de las tres con datos que
   no tiene ningún feedback de error de red.
4. **Considerar un guard de rol en el router para `/importar`** (aunque sea
   liviano, solo para no depender 100% de que el backend nunca falle en
   validar) — o, si la decisión de diseño es dejarlo así a propósito,
   dejarlo documentado en el propio `router/index.js` con el mismo nivel de
   comentario que ya tiene `TabBar.vue`, para que quede claro que es
   intencional y no un descuido.
5. **Exponer un evento o hook de test** (ej. `window.__APP_READY__` seteado
   tras el primer `restaurarSesion()` resuelto) reduciría la necesidad de
   polling en los tests que esperan el estado inicial del router guard —
   opcional, los tests funcionan igual sin esto vía `waitForResponse`/
   `waitForSelector`, pero achicaría un poco la superficie de posibles
   flakes de timing en Ronda 2.
6. **Fixtures de mocks compartidas**: dado que Subagente 2 (integración,
   MSW) y este plan (E2E, `page.route()`) van a necesitar formas de
   respuesta muy similares para los mismos endpoints, vale la pena que
   Ronda 2 evalúe si conviene compartir un único archivo de fixtures JSON
   (ej. `tests/fixtures/api/*.json`) consumido por ambas suites, en vez de
   mantener dos copias de "cómo se ve una respuesta de `buscar` exitosa" que
   se puedan desincronizar con el tiempo.

---

## 9. Orden sugerido de implementación

1. **Spike de infraestructura** (§0.1 + §0.2): un archivo descartable que
   confirma (a) que un mock con headers CORS responde bien a una request
   cross-origin real desde el preview, y (b) si `page.route()` intercepta o
   no una GET mockeada con el Service Worker activo y controlando. El
   resultado de (b) decide si `serviceWorkers:'block'` es obligatorio para
   los specs de negocio o solo una buena práctica preventiva.
2. **Helpers compartidos** (`e2e/support/`): mock con headers CORS
   pre-armados, helper de login-as-role reusable (usuario/rol/config
   parametrizables), fixtures JSON de respuestas típicas por endpoint.
3. `e2e/auth.spec.js` — es la base de la que dependen los demás (nadie más
   puede arrancar sin sesión).
4. `e2e/buscar-editar-producto.spec.js` — el journey de mayor valor de
   negocio.
5. `e2e/importar-lista-precios.spec.js` — el journey más complejo
   (multipart, checklist, roles), se beneficia de que los dos anteriores ya
   hayan estabilizado el patrón de mocking.
6. `e2e/reportes-scroll-infinito.spec.js` — depende del mismo patrón de auth,
   pero es el de menor riesgo de negocio (solo lectura), va después de los
   dos flujos que escriben datos.
7. Barrido de casos negativos que hayan quedado pendientes dentro de cada
   spec ya creado (no como archivos nuevos).
8. PWA, en este orden interno: `pwa-service-worker.spec.js` (más simple) →
   `pwa-cache-offline.spec.js` → `pwa-manifest-instalacion.spec.js` →
   `pwa-actualizacion-v1-v2.spec.js` (el más lento y el que más puede
   necesitar ajuste fino, al final a propósito).
9. `e2e/visual.spec.js` — al final, para bajar el churn de rebaseline de
   screenshots mientras el resto todavía se está estabilizando.
10. Pasada completa en ambos proyectos (`npx playwright test`) + ajuste de
    los `test.skip` por proyecto descriptos en §4.
