/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{vue,js}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#ff4f8b',
          50: '#fff0f5',
          100: '#ffd1dc',
          200: '#ffb3c7',
          300: '#ff94b1',
          400: '#ff759c',
          500: '#ff4f8b',
          600: '#e04778',
          700: '#bf3c66',
          800: '#9f3255',
          900: '#7f2844',
        }
      },
      borderRadius: {
        cute: '12px'
      }
    },
  },
  plugins: [],
}
