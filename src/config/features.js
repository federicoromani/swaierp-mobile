// Pantallas que se prenden/apagan por comercio en el build (ver .env.example).
// Son funciones y no constantes para que los tests puedan cambiar el valor
// con vi.stubEnv() sin reimportar los módulos que las usan.

// "IA Lista PDF" (/importar). Apagada salvo que se habilite explícitamente.
export function importarHabilitado() {
  return import.meta.env.VITE_IMPORTAR_HABILITADO === 'true'
}
