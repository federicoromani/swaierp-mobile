// Shim necesario para testear src/services/importacionPreciosService.js
// (postFormData con un archivo real) en este entorno de test.
//
// Problema real encontrado al implementar (no estaba anticipado en el
// discovery): en jsdom, `File`/`FormData` son las clases del DOM (jsdom),
// pero `fetch` global lo parchea MSW sobre la base de Node/undici. Cuando el
// código de la app hace `new FormData()` + `formData.append('archivo', file)`
// con un `File` de jsdom y ese FormData se manda como body de un `fetch()`
// interceptado por MSW, la serialización a multipart pierde el nombre del
// archivo (queda "blob") y el contenido (queda literalmente el texto
// "undefined") — el resolver del handler recibe un `File` con la forma
// correcta pero datos basura. Confirmado leyendo el multipart crudo que
// llega al resolver, no es una suposición.
//
// La causa es el mismatch de "realm" entre las clases File/FormData de
// jsdom y las de Node (undici) que arma el fetch real. La solución que
// funciona: durante el test, reemplazar temporalmente los globals
// `File`/`FormData` por las versiones de Node (`node:buffer`'s File —  es la
// misma clase que usa el fetch nativo de Node por debajo — y el paquete
// `undici` para FormData, ya presente en node_modules como dependencia
// transitiva de msw), así el `new FormData()`/`new File()` que hace el
// código de la app en tiempo de test ya nace en el mismo realm que después
// lo va a serializar. Verificado con el multipart crudo: con este shim,
// filename/Content-Type/contenido llegan intactos al resolver.
//
// Uso: llamar `activarMultipartDeNode()` en un `beforeEach` de los tests que
// ejercitan el upload real, y el cleanup que devuelve en el `afterEach`
// correspondiente (o usar `conMultipartDeNode(fn)` si el test entero lo
// necesita).

import { File as FileDeNode } from 'node:buffer'
import { FormData as FormDataDeNode } from 'undici'

export function activarMultipartDeNode() {
  const FormDataOriginal = globalThis.FormData
  const FileOriginal = globalThis.File
  globalThis.FormData = FormDataDeNode
  globalThis.File = FileDeNode
  return function restaurar() {
    globalThis.FormData = FormDataOriginal
    globalThis.File = FileOriginal
  }
}

/**
 * Crea un File "de verdad" (realm de Node) para usar en los tests de
 * importación — construirlo con el `File` global de jsdom no sirve una vez
 * que se activó el shim de arriba (usan aritmética de clases distinta).
 */
export function crearArchivoDeTest(contenido, nombre, tipo) {
  return new FileDeNode([contenido], nombre, { type: tipo })
}
