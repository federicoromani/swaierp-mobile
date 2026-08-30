/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      // Paleta real del design system SaaS de swaidemo (css/saas-template.css),
      // no la escala indigo del prototipo original.
      colors: {
        primary: '#0f172a', // slate-900, botón primario/headers
        accent: '#3b82f6', // blue-500, foco/acento
        surface: '#f1f5f9', // fondo
        ink: '#334155', // texto
        muted: '#64748b', // texto secundario
        'muted-2': '#94a3b8',
        success: '#16a34a',
        danger: '#dc2626',
        warning: '#854d0e',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        base: '13px',
      },
    },
  },
  plugins: [],
}
