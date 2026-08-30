# swaierp-mobile

PWA (Vue 3.5 + Pinia + Vite) para que los empleados de un comercio actualicen
ágilmente **stock y precios** de productos desde el celular, contra la API
móvil de su instalación de [swaidemo](https://github.com/federicoromani/swaidemo)
(`apps/api_*.php`).

## Modelo multi-comercio

Cada comercio corre su **propia instalación completa** de swaidemo (base
Postgres, dominio y API propios) — no hay multi-tenant dentro de una misma
base salvo por schema de sucursal. Esta PWA sigue el mismo modelo: **se
buildea una vez por comercio**, con la URL de su API fijada en build-time.
No hay pantalla de configuración en runtime ni selector de comercio: cada
build sirve a un solo comercio, apuntando solo a su API.

## Configuración

Copiar `.env.example` a `.env.local` (desarrollo) o a `.env.production`
(build de un comercio puntual) y completar:

```bash
VITE_API_BASE_URL=http://localhost:8880/swaidemo/apps   # sin barra final
VITE_COMERCIO_NOMBRE=SWAI ERP
```

## Desarrollo

Requiere el backend de swaidemo corriendo (ver `CLAUDE.md` de ese repo —
Docker Compose, contenedor `comercios_php81` + `comercios_nginx`), con
`apps/api_mobile.local.php` configurado (`MOBILE_APP_ORIGIN` debe incluir el
origen de este dev server, `http://localhost:5173` por default).

```bash
npm install
npm run dev
```

## Build de producción (por comercio)

```bash
# con .env.production ya completado para ESE comercio
npm run build
```

El resultado de `dist/` se despliega junto a la instalación de swaidemo de
ese comercio (mismo dominio, subruta `/mobile/` o la que corresponda).

## Stack

- **Vue 3.5.42** + `<script setup>`, **Pinia** (setup stores) para estado.
- **vue-router** con guard de autenticación (`src/router/index.js`).
- **Tailwind CSS** (instalado local, no CDN) con la paleta del design system
  SaaS del ERP (`tailwind.config.js`) — no la paleta indigo del prototipo
  original.
- **vite-plugin-pwa** (Workbox): manifest generado desde las variables de
  entorno, cache `NetworkFirst` de las lecturas de la API.
- **Dexie** (IndexedDB) para persistir el refresh token y un cache liviano
  del catálogo consultado — el access token vive solo en memoria.
- **FontAwesome** instalado por npm (no CDN), para que los íconos funcionen
  offline.

## Estructura

```
src/
  stores/      auth, productos, reportes, ui (Pinia)
  services/    apiClient (fetch + refresh automático), authService, productosService, reportesService
  views/       LoginView, BuscarView, ImportarView (placeholder), ReportesView
  components/  TabBar, AppBrand, SearchBar, ProductoCard, HistorialProducto
  offline/     db.js (Dexie)
  router/      guard de autenticación
```

## Alcance actual

La pestaña **"Importar Lista IA"** (OCR de listas de proveedor) es un
placeholder — queda para una segunda etapa. Esta entrega cubre búsqueda +
edición de stock/precio, y los reportes "Pendientes de controlar" /
"Ajustes frecuentes".
