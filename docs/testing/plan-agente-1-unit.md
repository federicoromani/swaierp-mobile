# Plan de tests — Subagente 1 (Unit & Component)

Ronda 1 (discovery). No se escribió código todavía — este documento es el
insumo para la Ronda 2 (implementación) y para que el orquestador arme la
matriz de los 3 subagentes sin huecos ni duplicados.

Alcance recorrido: los 24 archivos `.js`/`.vue` de `src/` (composables,
stores, services, componentes, vistas, router, main.js, offline/db.js).

## Frontera con Subagente 2 y Subagente 3 (para evitar duplicados)

Leí también `Subagente 2 — Integration & API Tests.md` y
`Subagente 3 — E2E + PWA Tests.md` para calibrar el límite:

- **Mis tests de componentes/vistas usan `createTestingPinia` (stores
  mockeadas) y nunca llaman `fetch` real ni tocan MSW.** Verifican que el
  componente reacciona bien a un estado dado de la store y llama a las
  acciones correctas con los argumentos correctos. Subagente 2 monta los
  mismos componentes/vistas con **stores reales + MSW**, y es quien prueba
  el contrato HTTP (2xx/400/401/403/404/409/422/429/500/timeout) y la
  interacción real componente↔store↔API.
- Mi test de `router/index.js` mockea `auth.estaAutenticado`/`auth.listo`
  directamente en el estado de la store para probar la lógica de branching
  del guard. Subagente 2 ("router + autenticación", "permisos + navegación")
  hace el flujo real: login vía MSW → navegar → verificar acceso.
- No cubro `apiClient.js` ni los `*Service.php`-equivalentes de JS
  (`authService.js`, `productosService.js`, etc.) — ver sección "Qué no
  cubro" abajo.
- No cubro journeys multi-pantalla ni nada de PWA/Service Worker/offline
  real — eso es Subagente 3.

## 1. Composables

### `src/composables/useCompresionImagen.js` → `tests/unit/composables/useCompresionImagen.spec.js`

Lógica de negocio real (redimensionado/reencodeo antes de subir, mitigación
del límite de subida del backend). Sin hooks de ciclo de vida de Vue: se
puede invocar la función directo, sin montar componente.

- P0 — si `file` no es imagen (`type` no empieza con `image/`, ej. PDF/CSV),
  devuelve el mismo `file` sin tocar canvas ni `createImageBitmap`.
- P0 — si `file` es `null`/`undefined`, devuelve el mismo valor sin explotar.
- P0 — redimensiona proporcionalmente cuando el lado más largo del bitmap
  supera `maxDim` (verificar `canvas.width`/`canvas.height` calculados).
- P0 — NO agranda una imagen más chica que `maxDim` (escala nunca > 1).
- P0 — devuelve un `File` nuevo con extensión `.jpg`, `type: 'image/jpeg'`,
  y el nombre base sin la extensión original.
- P1 — usa la `calidad` pasada por opciones al llamar `canvas.toBlob`.
- P1 — si `canvas.toBlob` resuelve `null` (no se pudo comprimir), devuelve
  el `file` ORIGINAL como fallback, no explota.
- P1 — si `window.createImageBitmap` no existe, usa el fallback vía
  `new Image()` + `URL.createObjectURL`.
- P2 — si el bitmap tiene `.close`, se llama (cleanup), solo en la rama de
  `createImageBitmap`.

### `src/composables/useInfiniteScroll.js` → `tests/unit/composables/useInfiniteScroll.spec.js`

Lógica real: guards de `hasMore`/`loading`, reconexión del observer cuando el
sentinela pasa de `null` a elemento y viceversa. Usa `onMounted`/`onUnmounted`/
`watch`: hace falta montar un componente host mínimo (`defineComponent({
setup() { useInfiniteScroll(...); return {} } })` + `mount()` de VTU) porque
esos hooks no funcionan invocados fuera de un contexto de componente activo.

- P0 — al montar con `sentinelRef` apuntando a un elemento, crea un
  `IntersectionObserver` y lo `observe()` sobre ese elemento.
- P0 — si el callback del observer recibe `isIntersecting: true` con
  `hasMore=true` y `loading=false` → dispara `onLoadMore`.
- P0 — NO dispara `onLoadMore` si `hasMore=false` (aunque intersecte).
- P0 — NO dispara `onLoadMore` si `loading=true`.
- P1 — NO dispara `onLoadMore` si `isIntersecting=false`.
- P1 — al desmontar el host, se llama `disconnect()`.
- P1 — si `sentinelRef` pasa de `null` a un elemento (simula el remount por
  `v-if`/`v-else` de `ReportesView`), el `watch` reconecta: nuevo `observe()`.
- P2 — si `sentinelRef` pasa de elemento a `null`, desconecta y no observa
  nada nuevo.

## 2. Pinia Stores

Todas con `setActivePinia(createPinia())` real (no `createTestingPinia`,
salvo que se aclare lo contrario) — acá el objetivo es probar la lógica real
de la store, mockeando solo el `*Service.js` correspondiente con `vi.mock`.
Dexie funciona vía `fake-indexeddb/auto` (ya en `tests/setup.js`).

### `src/stores/auth.js` → `tests/unit/stores/auth.spec.js` (P0 — gating de toda la app)

- P0 — estado inicial: `accessToken=null`, `usuario=null`,
  `config={margen_objetivo_pct:30}`, `cargando=false`, `listo=false`,
  `estaAutenticado=false`.
- P0 — `login()` éxito: setea `accessToken`/`usuario`/`config`, persiste
  refresh token en `db.sesion`, `listo=true`.
- P0 — `login()` `success:false`: lanza `Exception` con el mensaje del
  backend (o default), no setea `accessToken`, `cargando` vuelve a `false`.
- P0 — `restaurarSesion()` sin registro en `db.sesion` → `false`, no llama
  a `authService.refresh`.
- P0 — `restaurarSesion()` con registro y refresh `success:false` → limpia
  sesión local (Dexie + `accessToken=null`) y devuelve `false`.
- P0 — `restaurarSesion()` con registro y refresh OK → setea `accessToken`,
  persiste el refresh token nuevo, devuelve `true`.
- P0 — `restaurarSesion()` si `listo=true` ya → devuelve
  `estaAutenticado.value` directo, SIN volver a llamar `authService.refresh`
  (short-circuit — evita refetch en cada navegación del guard).
- P1 — `restaurarSesion()` si `authService.refresh` lanza (error de red) →
  el catch devuelve `false`, no explota.
- P0 — `logout()` con refresh guardado → llama `authService.logout` con ese
  token, y siempre limpia la sesión local después.
- P1 — `logout()` si `authService.logout` falla (throw) → igual limpia la
  sesión local (best-effort).
- P1 — `logout()` sin refresh guardado → no llama `authService.logout`.
- P0 — `refrescarToken()` sin refresh guardado → lanza `Exception('Sin
  sesión.')`.
- P0 — `refrescarToken()` con refresh que falla → lanza `Exception` con
  mensaje del backend o `'Sesión inválida.'`.
- P0 — `refrescarToken()` éxito → setea `accessToken` nuevo, persiste
  refresh nuevo, devuelve el `access_token`.
- P1 — `limpiarSesionLocal()` borra `accessToken`, `usuario` y el registro
  de Dexie.
- P2 — `estaAutenticado` refleja `!!accessToken` en ambas direcciones.

### `src/stores/productos.js` → `tests/unit/stores/productos.spec.js` (P0 — catálogo, cache offline, margen)

- P0 — estado inicial: `resultados=[]`, `recientes=[]`, `actual=null`,
  `cargando=false`, `error=''`.
- P0 — `buscar('')`/`buscar('   ')` → limpia `resultados` a `[]`, NO llama
  al service.
- P0 — `buscar()` éxito → `resultados=data.items`, persiste cada item en
  `catalogoCache` (verificar con `db.catalogoCache.get`).
- P0 — `buscar()` `success:false` → cae al catch: `error.value` seteado,
  `resultados` = fallback desde `catalogoCache` filtrado.
- P0 — `buscar()` con el service rechazando (throw, ej. sin red) → mismo
  fallback a cache.
- P1 — `buscarEnCache`: filtra por coincidencia parcial de `nombre`
  (case-insensitive) O de `codigo` — chequear el comportamiento REAL tal
  cual está (el filtro de código no hace `.toLowerCase()` en el código
  fuente; documentar si el test expone esa asimetría como hallazgo, no
  asumir que es bug intencional).
- P0 — `seleccionar()` éxito → `actual=data`, se agrega a `recientes`, se
  persiste en `catalogoCache`.
- P0 — `seleccionar()` falla → `error.value` seteado; si hay entrada en
  `catalogoCache` para ese `prodId`, `actual=cache`; si no hay, `actual`
  queda como estaba.
- P0 — dedup de `recientes`: agregar un producto ya presente lo mueve al
  frente sin duplicarlo.
- P0 — tope de `recientes` en 4: agregar un 5º producto descarta el más
  viejo (`slice(0,4)`), el nuevo queda primero.
- P0 — `actualizarPrecio()` éxito → reemplaza `actual.value` con la data
  devuelta, devuelve `data`.
- P0 — `actualizarPrecio()` `success:false` → lanza `Exception`.
- P0 — `ajustarStock()` éxito con `prodId === actual.value.prod_id` →
  actualiza SOLO `actual.value.stock_actual` (no reemplaza el objeto
  entero).
- P1 — `ajustarStock()` éxito pero `prodId` YA NO coincide con
  `actual.value` (el usuario cambió de producto mientras la petición
  estaba en vuelo) → NO pisa `actual.value`.
- P0 — `ajustarStock()` `success:false` → lanza `Exception`.

### `src/stores/reportes.js` → `tests/unit/stores/reportes.spec.js` (P0 — paginación con total "pegajoso")

- P0 — estado inicial: `pendientes={items:[],total:0}`,
  `ajustes={items:[],total:0}`, `cargando=false`.
- P0 — `cargarPendientes(0)` éxito → reemplaza `items`, `total=data.total`.
- P0 — `cargarPendientes(offset>0)` éxito → CONCATENA `items` (no
  reemplaza) y MANTIENE el `total` viejo, ignorando el `data.total` de la
  página siguiente (caso de negocio explícito del código/comentario).
- P0 — `cargarPendientes()` `success:false` → no modifica `pendientes.value`
  (return temprano), pero `cargando` vuelve a `false` igual (`finally`).
- P1 — mismos 3 casos para `cargarAjustes()`.
- P1 — `cargando=true` durante la petición, `false` al finalizar (éxito o
  fallo).
- P2 — `cargarPendientes` y `cargarAjustes` no interfieren entre sí (estados
  separados, comparten solo `cargando`).

### `src/stores/importacionPrecios.js` → `tests/unit/stores/importacionPrecios.spec.js` (P0 — filtro de confirmación es lógica de negocio real)

Mockear `importacionPreciosService` Y `comprimirSiEsImagen` (con `vi.mock`
del módulo `useCompresionImagen`) — acá no se quiere re-testear la
compresión de imagen, solo que se invoca y se usa su resultado.

- P0 — estado inicial: `proveedores=[]`, `proveedorSeleccionado=0`,
  `items=[]`, `sinMatch=0`, `fuente=''`, `avisos=[]`, flags en `false`,
  `error=''`, `resumen=null`.
- P0 — `cargarProveedores()` primera vez → llama al service, setea
  `proveedores`.
- P0 — `cargarProveedores()` segunda vez con `proveedores.length>0` → NO
  vuelve a llamar al service (cache-once).
- P1 — `cargarProveedores()` `success:false` → no setea `proveedores`
  (queda `[]`), no lanza.
- P0 — `analizarArchivo()` éxito → llama `comprimirSiEsImagen(archivo)`
  primero y pasa SU resultado a `service.analizar` (no el archivo
  original); mapea `items` agregando `seleccionado=item.aplicable`; setea
  `sinMatch`/`fuente`/`avisos`.
- P0 — `analizarArchivo()` `success:false` → `error.value` con el mensaje,
  `items` queda `[]`.
- P1 — `analizarArchivo()` con `data.avisos` ausente → `avisos.value=[]`
  (default), no explota.
- P0 — `confirmarSeleccionados()`: filtra SOLO items con
  `seleccionado===true` Y `prod_id` truthy — un item `seleccionado:true`
  pero `prod_id:0`/`null`/`undefined` (caso "sin match") queda afuera.
- P0 — `confirmarSeleccionados()`: si no quedan líneas tras el filtro →
  return temprano, NO llama al service, NO setea `aplicando=true`.
- P0 — `confirmarSeleccionados()` éxito → arma líneas
  (`prod_id`/`costo_nuevo=precio_detectado`/`codigo_detectado`), llama
  `confirmar(proveedorSeleccionado, lineas)`, `resumen=data`, `items` se
  vacía.
- P0 — `confirmarSeleccionados()` `success:false` → `error.value` seteado,
  `items` NO se vacía (permite reintentar), `resumen` sigue `null`.
- P1 — `reiniciar()` resetea `items`/`sinMatch`/`fuente`/`avisos`/`error`/
  `resumen`, pero NO toca `proveedores` ni `proveedorSeleccionado` (a
  propósito, no perder la selección del usuario).

### `src/stores/ui.js` → `tests/unit/stores/ui.spec.js` (P1 — simple pero con timer)

Usar `vi.useFakeTimers()`.

- P1 — `mostrarToast()` setea `toast={mensaje,tipo}`.
- P1 — defaults: `tipo='info'`, `duracionMs=3000` si no se pasan.
- P1 — tras `duracionMs`, `toast` vuelve a `null` (auto-dismiss).
- P1 — dos llamadas seguidas: la segunda reinicia el timer
  (`clearTimeout` del anterior) — mostrar toast A, avanzar 2s, mostrar
  toast B, avanzar 2s (4s desde A pero 2s desde B) → sigue visible;
  avanzar 1s más (3s desde B) → ahora sí `null`.

## 3. "Helpers y funciones" — no hay módulo dedicado

No existe `src/helpers/` ni `src/utils/`. La lógica de cálculo/formateo
relevante vive **inline dentro de componentes** (no exportada, no
importable de forma aislada):

- `margenActual`/`margenBajo` en `ProductoCard.vue` (cálculo de margen
  cliente-side) → cubierto en el test del componente (sección 4).
- `formatearMonto`/`descripcion` en `HistorialProducto.vue` → cubierto en
  el test del componente.
- `formatearMonto` (duplicado) en `ImportarView.vue` → cubierto
  indirectamente en el test de la vista.

`apiClient.js` tiene lógica no trivial (armado de query string, filtrado de
`params`/`body` con `undefined`/`null`, cola single-flight de refresh ante
401) pero **no está extraída en funciones puras**: todo vive dentro de la
función privada `peticion()`, que siempre llama a `fetch()` real. Ver
"Qué no cubro" — decisión: queda para Subagente 2 (necesita mockear fetch,
ya no es "lógica pura" aislable sin tocar el código fuente).

## 4. Componentes Vue

`AppBrand.vue` — **no se cubre**: puramente presentacional (ícono + texto +
un fallback de env var trivial), sin comportamiento observable más allá de
interpolar una variable. Confirmado leyendo el archivo completo (13 líneas).

### `src/components/TabBar.vue` → `tests/unit/components/TabBar.spec.js` (P1)

`createTestingPinia` con `auth.usuario.rol` seteado, router real mínimo (o
mock de `useRoute`) para la clase activa.

- P0 — `auth.usuario.rol === 3` → NO renderiza el link a `/importar`.
- P0 — `auth.usuario.rol !== 3` (1, 2, o `usuario` null → optional
  chaining) → SÍ renderiza el link a `/importar`.
- P1 — la clase `text-accent` se aplica al link cuya ruta coincide con
  `route.path` (por prefijo); el resto queda `text-muted`.
- P2 — los links a `/buscar` y `/reportes` se renderizan siempre, sin
  condición de rol.

### `src/components/SearchBar.vue` → `tests/unit/components/SearchBar.spec.js` (P0 — debounce + dropdown + chips)

`createTestingPinia` con `productos`/`auth`; `vi.useFakeTimers()` para el
debounce de 300ms y el delay de blur de 150ms.

- P0 — al tipear, NO llama `productos.buscar` antes de los 300ms.
- P0 — tras 300ms sin más tecleo, llama `productos.buscar(valor)` una vez.
- P0 — tipeo rápido (varias teclas dentro de la ventana de 300ms) dispara
  UNA sola búsqueda, con el ÚLTIMO valor.
- P0 — vaciar el input → `resultados` se limpia a `[]` INMEDIATAMENTE
  (sin esperar el debounce), `mostrarResultados=false`.
- P1 — `focus` con query no vacío → muestra el dropdown; `focus` con query
  vacío → no lo muestra.
- P1 — `blur` → oculta el dropdown después de ~150ms.
- P0 — `productos.cargando=true` → dropdown muestra "Buscando...".
- P0 — `productos.resultados=[]` y no cargando → "Sin resultados. Probá
  con el código.".
- P0 — con resultados → un botón por resultado; click emite `select` con
  `prod_id` y limpia/oculta el dropdown.
- P1 — badge de margen: `margen_pct < auth.config.margen_objetivo_pct` →
  clase roja; si no, verde.
- P1 — chips de "recientes": visibles solo si `!query &&
  productos.recientes.length>0`; click llama `seleccionar` (emite
  `select`, limpia query).
- P1 — botón "limpiar" (x) visible solo con query no vacío; click limpia
  query y oculta dropdown.

### `src/components/ProductoCard.vue` → `tests/unit/components/ProductoCard.spec.js` (P0 — el componente con más lógica propia)

`createTestingPinia` con `productos`/`auth`/`ui`.

- P0 — `productos.actual=null` → no renderiza nada (`v-if` raíz), no
  explota.
- P0 — el `watch` con `immediate` resetea `stock`/`costo`/`precioVenta` al
  cambiar `productos.actual.prod_id` — si el usuario edita esos campos y
  DESPUÉS cambia de producto, se resetean; si `actual.value` cambia sin
  cambiar `prod_id`, el form NO se pisa.
- P0 — `margenActual`: `venta>0` → `(venta-costo)/venta*100` (casos:
  costo=0 → 100%; costo>venta → negativo).
- P0 — `margenActual`: `venta<=0` (0 o negativo) → devuelve `0`, nunca
  `NaN`/`Infinity`.
- P0 — `margenActual` con `costo`/`precioVenta` no numéricos (string vacío)
  → tratados como `0` (`Number(x)||0`), no explota.
- P0 — `margenBajo`: `margenActual < (auth.config.margen_objetivo_pct ??
  30)` — con y sin `config` seteado.
- P1 — `ajustarStepper`: incrementa/decrementa de a 1, nunca baja de 0
  (probar decrementar desde 0).
- P0 — `guardarPrecio()` éxito → llama
  `productos.actualizarPrecio(prod_id, costo, precioVenta)`, toast
  success, `guardandoPrecio` true→false.
- P0 — `guardarPrecio()` falla (acción rechaza) → toast error con
  `e.message`, `guardandoPrecio` vuelve a `false` igual.
- P0 — `guardarStock()` éxito → llama `productos.ajustarStock`, ACTUALIZA
  `stock.value` con `resultado.stock_actual` (no con lo que había en el
  input), toast success.
- P0 — `guardarStock()` falla → toast error, `stock.value` NO se toca.
- P1 — botones "Guardar stock"/"Guardar precio" quedan `disabled` mientras
  `guardandoStock`/`guardandoPrecio`, muestran "Guardando...".
- P2 — renderiza `HistorialProducto` con `productos.actual.historial` (o
  `[]` si no viene).

### `src/components/HistorialProducto.vue` → `tests/unit/components/HistorialProducto.spec.js` (P1/P2)

- P1 — `items=[]` → "Todavía no hay movimientos.".
- P1 — item `tipo='precio'` → "Costo $X → $Y" (formateado
  `Math.round`+`toLocaleString('es-AR')`).
- P1 — item tipo stock con `cantidad` positiva → "Ajuste de stock: +N"
  (signo explícito).
- P1 — item tipo stock con `cantidad` negativa → "Ajuste de stock: -N"
  (sin `+` duplicado).
- P1 — item con `comentario` → se agrega " · comentario"; sin comentario,
  no.
- P2 — ícono `fa-tag` para tipo precio, `fa-clipboard-check` para el resto.

## 5. Router

### `src/router/index.js` → `tests/unit/router/index.spec.js` (P0 — gating de acceso)

El módulo solo exporta el router YA instanciado (con `createWebHistory()`).
Se testea navegando el singleton real y verificando
`router.currentRoute.value` tras `await router.isReady()`/el `push`, con
`auth` mockeada vía Pinia real (`setActivePinia` + setear
`estaAutenticado`/`listo`/`restaurarSesion` directo en el store, sin pasar
por login real).

- P0 — no autenticado navegando a una ruta protegida (`/buscar`, etc.) →
  redirige a `{name:'login', query:{redirect: to.fullPath}}`.
- P0 — autenticado navegando a `/login` → redirige a `query.redirect` si
  viene, o a `/buscar` por default.
- P0 — no autenticado navegando a `/login` (`meta.requiresAuth===false`) →
  deja pasar.
- P1 — `auth.listo=true` ya (sesión restaurada antes) → el guard NO vuelve
  a llamar `restaurarSesion()` en la siguiente navegación.
- P1 — autenticado navegando a una ruta protegida normal → deja pasar sin
  redirect.
- P2 — `query.redirect` ausente/vacío → default a `/buscar`.

## 6. Vistas

Regla general: uso `createTestingPinia` (stores mockeadas) — el objetivo es
el WIRING propio de la vista (qué condiciones muestran qué, qué acciones se
llaman con qué argumentos), no re-testear lo que ya cubren los tests de
store/composable/componente hijo.

### `src/views/LoginView.vue` → `tests/unit/views/LoginView.spec.js` (P1)

- P1 — submit exitoso → llama `auth.login(usuario, clave)`, navega a
  `route.query.redirect` si viene o a `/buscar` por default.
- P1 — submit falla (login rechaza) → `error.value` con el mensaje de la
  excepción (o el default), NO navega.
- P1 — mientras `enviando=true` → botón disabled, texto "Ingresando...".
- P2 — atributo `required` en los inputs (validación nativa HTML5) — SOLO
  si se confirma que jsdom lo respeta al disparar el submit real; si no,
  se documenta y se deja fuera (ver "problemas de testabilidad").

### `src/views/BuscarView.vue` → `tests/unit/views/BuscarView.spec.js` (P2 — wiring liviano)

Stub de `SearchBar`/`ProductoCard` (para no re-testear sus hijos acá).

- P2 — banner de pendientes visible solo si `reportes.pendientes.total>0`.
- P2 — banner de error de productos visible solo si `productos.error &&
  !productos.actual` (con `actual` seteado, NO se muestra aunque haya error
  viejo).
- P2 — estado vacío ("Buscá un producto...") visible solo si
  `!productos.actual`.
- P2 — click en "Ver" del banner navega a `/reportes`.

### `src/views/ReportesView.vue` → `tests/unit/views/ReportesView.spec.js` (P0 — tabs + scroll infinito con dos instancias)

Mismo mecanismo de override de `IntersectionObserver` que en
`useInfiniteScroll.spec.js` (capturar el callback), ya que el componente
crea DOS instancias (una por sentinela/tab).

- P0 — al montar, tab inicial `pendientes`, llama
  `reportes.cargarPendientes(0)`.
- P0 — `cambiarTab('ajustes')` primera vez (`ajustes.items` vacío) → llama
  `reportes.cargarAjustes(0)`.
- P0 — `cambiarTab('ajustes')` de nuevo con `ajustes.items` ya poblado →
  NO vuelve a llamar `cargarAjustes` (evita refetch al ir y volver de tab).
- P0 — sentinela de pendientes visible solo si `pendientes.items.length <
  pendientes.total`.
- P1 — ídem para ajustes.
- P0 — disparar manualmente el callback capturado del observer de
  pendientes (`isIntersecting:true`, `hasMore:true`, `loading:false`) →
  llama `reportes.cargarPendientes(offset actual, no 0)`.
- P1 — click en un producto de la lista → llama
  `productos.seleccionar(prodId)` y `router.push('/buscar')`.
- P2 — los textos "X sin conteo hace +7 días"/"Y productos con ajustes
  manuales" reflejan `total` de cada store.

### `src/views/ImportarView.vue` → `tests/unit/views/ImportarView.spec.js` (P0 — checklist + habilitación de botón)

- P0 — al montar, llama `store.cargarProveedores()`.
- P0 — seleccionar archivo (evento `change` con `files[0]`) → setea
  `nombreArchivo`, llama `store.analizarArchivo(archivo)`.
- P0 — evento `change` sin archivo (cancelado) → NO llama
  `analizarArchivo`, no explota.
- P0 — `store.analizando=true` → muestra el spinner, oculta el resto.
- P0 — `seleccionados` (computed local) cuenta solo items con
  `seleccionado===true` Y `prod_id` truthy — mismo criterio que el store,
  reflejado en el número del botón.
- P0 — botón "Aplicar seleccionados" disabled si `seleccionados===0` O
  `store.aplicando`; habilitado en caso contrario.
- P0 — click en aplicar → llama `store.confirmarSeleccionados()`; si
  `store.resumen` queda seteado después, muestra un toast con el conteo.
- P1 — click en aplicar cuando `confirmarSeleccionados` no deja `resumen`
  seteado (falló) → NO muestra toast.
- P0 — vista de resumen (`store.resumen` truthy) → singular/plural
  correcto en "aplicados"/"rechazados", oculta "rechazados" si es 0.
- P1 — `importarOtra()` → llama `store.reiniciar()`, limpia
  `nombreArchivo` y el `value` del input file.
- P1 — item con `aplicable=false` → checkbox disabled, opacidad, muestra
  `motivo_no_aplicable`.
- P2 — aviso de `sinMatch>0` con singular/plural correcto.

## 7. Problemas de testabilidad detectados

1. **Stub de `IntersectionObserver` en `tests/setup.js` descarta el
   callback.** El stub global (`observe/unobserve/disconnect` no-op, sin
   constructor propio) no guarda el `callback` que le pasa
   `useInfiniteScroll`, así que no hay forma de simular una intersección
   con el stub tal cual está. Resolución (sin tocar el setup global, que
   el resto de los tests siguen necesitando como no-op): en
   `useInfiniteScroll.spec.js` y `ReportesView.spec.js`, sobreescribir
   `globalThis.IntersectionObserver` LOCALMENTE con `vi.stubGlobal(...)`
   por una clase que capture el `callback` del constructor, invocarlo a
   mano con `entries` fabricadas, y hacer `vi.unstubAllGlobals()` al final
   del archivo para no filtrar el override a otros specs.
2. **`useInfiniteScroll` usa `onMounted`/`onUnmounted`/`watch`.** No se
   puede invocar la función directo fuera de un componente activo (Vue
   tira warning y no hace nada). Hace falta montar un host mínimo con Vue
   Test Utils.
3. **`useCompresionImagen` depende de APIs de browser que jsdom no
   implementa** (`HTMLCanvasElement`/`getContext('2d')`/`canvas.toBlob`,
   `window.createImageBitmap`). Hay que mockearlas a mano DENTRO del spec
   (no en el setup global, es específico de este archivo) — con cuidado de
   no pisar `document.createElement` para OTRAS etiquetas (Vue crea muchos
   otros elementos al renderizar; el mock debe interceptar solo
   `createElement('canvas')`). Riesgo aceptado: el mock no garantiza que
   el resultado visual real sea correcto, solo que la orquestación
   (llamadas correctas, manejo de casos límite) lo es — la calidad visual
   del recomprimido queda fuera de lo automatizable razonablemente en
   unit.
4. **`router/index.js` exporta solo el router ya instanciado** (con
   `createWebHistory()`, no `createMemoryHistory()`), sin exponer el guard
   ni las rutas por separado. Se testea navegando el singleton real y
   leyendo `router.currentRoute.value`. Como usa `window.history` real,
   el estado de URL puede quedar pegado entre tests del mismo archivo —
   hace falta resetear (`router.replace('/')` o
   `window.history.replaceState(null,'','/')`) en un `beforeEach`.
5. **Funciones de formateo no exportadas.** `formatearMonto`/`descripcion`
   en `HistorialProducto.vue` y `formatearMonto` (duplicado) en
   `ImportarView.vue` viven dentro de `<script setup>`, no son
   importables de forma aislada — solo testeables montando el componente y
   leyendo el DOM. Aceptable dado lo simple de la lógica, pero acopla el
   test de "formateo" a selectores de render.
6. **Lógica de `apiClient.js` no extraída en funciones puras.** El armado
   de query string, el filtrado de `params`/`body` con `undefined`/`null`,
   y la cola single-flight de refresh ante 401 (`refrescoEnCurso`) son
   lógica real pero viven dentro de la función privada `peticion()`, que
   siempre llama `fetch()`. Testearlos con sentido requiere mockear
   `fetch` (y la store de auth), lo que empieza a ser un test de
   integración. Decisión: lo dejo para Subagente 2 (no lo re-extraigo a
   una función pura porque no es estrictamente necesario para hacer OTRA
   cosa testeable — sería tocar lógica de negocio sin necesidad).
7. **`createTestingPinia` stubea acciones por default** (se vuelven spies
   que no ejecutan el reducer real ni mutan estado). Para que un test de
   componente/vista vea un efecto posterior a una acción (ej. después de
   `productos.actualizarPrecio` el componente vuelve a leer
   `productos.actual`), hay que setear el estado relevante a mano en la
   store de testing (`store.$patch`/asignación directa al ref) en vez de
   confiar en que la acción stubeada mute algo.
8. **Debounce/timeouts requieren fake timers + flush de promesas.** El
   debounce de 300ms de `SearchBar`, el delay de blur (150ms), y el
   auto-dismiss del toast en `ui.js` necesitan `vi.useFakeTimers()` +
   `vi.advanceTimersByTime()`, y como el código dentro del timeout es
   async (`await productos.buscar(...)`), hace falta también
   `await flushPromises()`/`await nextTick()` después de avanzar el timer
   — si no, el assert corre antes de que la promesa resuelva.
9. **Validación nativa HTML5 (`required`) en `LoginView` bajo jsdom.** No
   está garantizado que jsdom dispare el bloqueo de submit nativo igual
   que un browser real; a confirmar en la implementación — si no es
   confiable, se documenta y ese caso puntual (P2) se cae de la lista.

## 8. Qué NO cubro (y por qué)

- **`apiClient.js`** (armado real de fetch, reintento por 401, manejo de
  error de red) → Subagente 2 (integración con MSW). Motivo: requiere
  mockear HTTP real, no es lógica pura aislable sin tocar el código fuente
  (ver problema de testabilidad #6).
- **`authService.js`, `productosService.js`, `importacionPreciosService.js`,
  `reportesService.js`** → wrappers de una línea sobre `apiClient`
  (arman `path`/`params`/`body`), sin lógica propia más allá de "armar el
  objeto a mandar". Cubrirlos como unit puro es de bajo valor ("no
  testear trivialidades" — regla explícita del spec); su comportamiento
  real contra el backend es de Subagente 2.
- **Contrato HTTP real (2xx/400/401/403/404/409/422/429/500/timeout)** en
  cualquier flujo → Subagente 2, con MSW.
- **Flujos multi-pantalla completos** (login → buscar → editar precio →
  ver reflejado en reportes; importar lista → aplicar → volver a buscar y
  ver precio actualizado; sesión que expira en medio de una edición) →
  Subagente 3 (E2E), cruzan varias vistas/stores y condiciones de red
  reales; ya están cubiertas por partes en unit.
- **Service Worker / PWA / cache de Workbox / instalación / offline real**
  → fuera de alcance de jsdom+Vitest, es Subagente 3. `main.js` no tiene
  lógica propia más allá de `registerSW({immediate:true})` (glue trivial,
  y además `virtual:pwa-register` es un módulo virtual de
  `vite-plugin-pwa` que no resuelve bajo Vitest sin el plugin) — no se
  testea.
- **`vite.config.js`, `tailwind.config.js`, `postcss.config.js`** → config
  de build, no código de aplicación.
- **`src/offline/db.js`** → confirmado leyendo el archivo: es solo
  definición de schema Dexie (`sesion`, `catalogoCache`), sin lógica
  propia. Se ejercita indirectamente en los tests de `auth.js`/
  `productos.js` que sí usan Dexie de verdad (vía `fake-indexeddb`).
- **Estilos/Tailwind, accesibilidad visual, responsive** → fuera de
  alcance de Vitest+jsdom (no hay layout real). Si se justifica, screenshot
  testing selectivo queda para Subagente 3 (regla propia: "solo pantallas
  críticas").

## 9. Orden sugerido de implementación

Lógica pura y de bajo costo de armado primero (señal rápida y barata);
vistas al final porque son las más caras de armar y reutilizan los
patrones (mock de Pinia, override de `IntersectionObserver`, fake timers,
router real) ya resueltos en los pasos anteriores.

1. **Stores** (fuente real de la lógica de negocio, sin dependencia de Vue
   Test Utils): `auth.js` → `productos.js` → `reportes.js` →
   `importacionPrecios.js` → `ui.js`.
2. **Composables**: `useCompresionImagen.js` (aislado, sin lifecycle,
   mocks propios de canvas) → `useInfiniteScroll.js` (requiere host
   component + override de `IntersectionObserver`, patrón que se reusa en
   `ReportesView.spec.js`).
3. **`router/index.js`** — reusa el patrón de mockear `auth` ya resuelto en
   el paso 1.
4. **Componentes**, de más simple a más complejo: `TabBar.vue` →
   `HistorialProducto.vue` → `SearchBar.vue` (debounce) →
   `ProductoCard.vue` (el más grande: watch + computed + dos acciones).
5. **Vistas**, al final: `ReportesView.vue` (reusa el override de
   `IntersectionObserver` del paso 2) → `ImportarView.vue` →
   `LoginView.vue` → `BuscarView.vue` (la más liviana, cierre).

## 10. Coverage

No aplica todavía — Ronda 1 es solo este plan, sin código. Cuando se
implemente (Ronda 2): correr `npm run test:coverage` y reportar el
resultado real acá. Expectativa cualitativa (no numérica, siguiendo la
regla del spec de "no buscar coverage artificialmente alto"): cobertura
alta en `stores/` y `composables/` (es donde vive el riesgo real: dinero,
stock, sesión), cobertura dirigida a comportamiento (no a líneas) en
`components/`/`views/` — está bien que ramas puramente visuales sin lógica
(clases condicionales triviales, textos estáticos) queden sin ejercitar
explícitamente si ya se tocan de paso al testear el comportamiento real.

## 11. Recomendaciones para integración (Subagente 2) / E2E (Subagente 3)

**Integración (MSW + stores reales):**

- `apiClient.js` contra los códigos de estado de la lista del spec de
  Subagente 2, incluyendo el single-flight de refresh con 401 concurrente
  real (dos requests en paralelo, ambas 401, verificar que solo se dispara
  un refresh).
- Cada `*Service.js` contra MSW (forma real del `path`/params esperados).
- Fallback offline real de `productos.buscar()`: simular con MSW una
  caída de red (o un 500) y verificar que efectivamente cae a
  `catalogoCache` con datos previamente cacheados por un `buscar()`
  exitoso anterior.
- Guard de router + auth de punta a punta: login real vía MSW → navegar a
  ruta protegida → refresh automático transparente en un 401 a mitad de
  sesión → sesión revocada (refresh también 401) → redirige a `/login`.
- Permisos reales: usuario con `rol=3` que fuerza la URL `/importar` →
  verificar el 403 real del backend mockeado (TabBar solo oculta el link,
  no protege la ruta).

**E2E (Playwright):**

- Journey completo: login → buscar producto → editar precio y stock → ver
  reflejado en `HistorialProducto` → cerrar sesión.
- Journey de importación: subir archivo real → ver checklist → aplicar
  seleccionados → ver resumen → "Importar otra".
- Expiración de sesión en medio de un flujo real (token vence durante el
  uso, no en el arranque).
- PWA offline real: catálogo servido desde cache de Workbox sin conexión,
  instalación, actualización de versión (`registerSW`).
- Responsive: journey principal en mobile viewport (el TabBar y los
  formularios están pensados mobile-first).
