/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Heebo"', 'system-ui', 'sans-serif'],
        serif: ['"Frank Ruhl Libre"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        paper: {
          50: '#FDFBF5',
          100: '#FAF7F0',
          200: '#F2ECDF',
          300: '#E8DFCC',
        },
        ink: {
          50: '#5C6273',
          100: '#3A414F',
          200: '#252A36',
          300: '#14181F',
        },
        terra: {
          50: '#FBE9D9',
          400: '#D97706',
          500: '#B45309',
          600: '#92400E',
        },
      },
      opacity: {
        '8': '0.08',
        '12': '0.12',
        '15': '0.15',
        '18': '0.18',
        '22': '0.22',
        '35': '0.35',
        '65': '0.65',
        '85': '0.85',
      },
      boxShadow: {
        plate: '0 1px 0 0 rgba(20,24,31,0.06), 0 8px 24px -12px rgba(20,24,31,0.18)',
        'plate-hover': '0 1px 0 0 rgba(20,24,31,0.08), 0 18px 40px -16px rgba(180,83,9,0.25), 0 6px 14px -8px rgba(20,24,31,0.20)',
        sheet: '0 30px 60px -20px rgba(0,0,0,0.55), 0 12px 30px -10px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};
