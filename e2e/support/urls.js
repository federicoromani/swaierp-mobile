// Patrones de URL de la API mockeada, centralizados para no repetir el glob
// (y el origen cross-origin http://localhost:8880) en cada spec. Si algún
// día cambia VITE_API_BASE_URL (.env.local) alcanza con tocar este archivo.
export const AUTH_URL = '**/swaidemo/apps/api_auth.php**'
export const PRODUCTOS_URL = '**/swaidemo/apps/api_productos.php**'
export const REPORTES_URL = '**/swaidemo/apps/api_reportes.php**'
export const IMPORTACION_URL = '**/swaidemo/apps/api_importacion_precios.php**'
