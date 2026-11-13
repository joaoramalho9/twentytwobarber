/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#07080a", 900: "#0c0e11", 850: "#111418", 800: "#161a1f", 700: "#20252c", 600: "#2c323a", 500: "#4a525d", 400: "#7b8490", 300: "#a9b0b9" },
        neon: { DEFAULT: "#39ff88", 600: "#22d36b", 900: "#0d3b22" },
        teamA: "#39ff88",
        teamB: "#5ab4ff",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
