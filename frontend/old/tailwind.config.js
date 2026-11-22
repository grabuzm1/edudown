/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        glass: "rgba(255, 255, 255, 0.05)",
        glassBorder: "rgba(255, 255, 255, 0.1)",
        accent: "#3b82f6",
        accentHover: "#2563eb",
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}