/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: {
          50: "#faf7f0",
          100: "#f3eee1",
          200: "#e6dcc4",
          300: "#d6c69e",
        },
        ink: {
          900: "#1f1a14",
          700: "#3f3628",
          500: "#6b5f4b",
          400: "#8a7d64",
        },
        terracotta: {
          50: "#fdf3ec",
          100: "#fbe4d3",
          400: "#d97f4e",
          500: "#c96a38",
          600: "#a8512c",
        },
        sage: {
          100: "#eef2e4",
          400: "#7a9159",
          600: "#55683a",
        },
        card: "#fffdf8",
      },
      fontFamily: {
        serif: ['"Fraunces"', "Georgia", "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
