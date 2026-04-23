/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        hebrew: ['Heebo', 'system-ui', 'sans-serif'],
        latin:  ['Inter', 'system-ui', 'sans-serif'],
        sans:   ['Heebo', 'Inter', 'system-ui', 'sans-serif'],
        mono:   ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: 'var(--color-brand)',
          dark:    'var(--color-brand-dark)',
          soft:    'var(--color-brand-soft)',
        },
        accent: 'var(--color-accent)',
        success: { DEFAULT: 'var(--color-success)', soft: 'var(--color-success-soft)' },
        warning: { DEFAULT: 'var(--color-warning)', soft: 'var(--color-warning-soft)' },
        danger:  { DEFAULT: 'var(--color-danger)',  soft: 'var(--color-danger-soft)' },
        info:    'var(--color-info)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          alt:     'var(--color-surface-alt)',
          muted:   'var(--color-surface-muted)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          strong:  'var(--color-border-strong)',
        },
        text: {
          DEFAULT: 'var(--color-text)',
          soft:    'var(--color-text-soft)',
          muted:   'var(--color-text-muted)',
        },
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-3px)' },
          '40%, 80%': { transform: 'translateX(3px)' },
        },
      },
      animation: {
        shake: 'shake 200ms ease-in-out',
      },
    },
  },
  plugins: [],
};
