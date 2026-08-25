/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* ==========================================================
         * 主题语义色（推荐新代码使用，亮/暗自动适配）
         * ----------------------------------------------------------
         * 通过 CSS 变量驱动，支持 <alpha-value>：
         *   bg-canvas / bg-canvas/80
         *   text-fg-secondary
         *   border / border-soft / border-strong
         *   border/50
         * ========================================================== */
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        content: 'rgb(var(--c-content) / <alpha-value>)',
        toolbar: 'rgb(var(--c-toolbar) / <alpha-value>)',
        'hover-bg': 'rgb(var(--c-hover) / 0.04)',
        'active-bg': 'rgb(var(--c-active) / 0.06)',

        border: {
          DEFAULT: 'rgb(var(--c-border) / <alpha-value>)',
          soft: 'rgb(var(--c-border-soft) / <alpha-value>)',
          strong: 'rgb(var(--c-border-strong) / <alpha-value>)'
        },

        fg: {
          DEFAULT: 'rgb(var(--c-text) / <alpha-value>)',
          primary: 'rgb(var(--c-text) / <alpha-value>)',
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--c-text-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-text-faint) / <alpha-value>)'
        },

        /* 品牌色（CSS 变量驱动，亮暗自动适配） */
        brand: {
          DEFAULT: 'rgb(var(--c-brand) / <alpha-value>)',
          soft: 'rgb(var(--c-brand-soft) / <alpha-value>)',
          hover: 'rgb(var(--c-brand-hover) / <alpha-value>)',
          fg: 'rgb(var(--c-brand-fg) / <alpha-value>)'
        },

        /* 兼容旧色阶（保留供老代码使用，新代码推荐用语义类） */
        ink: {
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'sans-serif'
        ],
        mono: [
          '"SF Mono"',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace'
        ]
      }
    }
  },
  plugins: []
};
