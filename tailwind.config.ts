import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Canonical brand palette — SINGLE source of truth.
        // Do not redefine these as CSS variables or manual utility classes.
        navy: "#0D1B2A",
        electric: "#0095FF",
        emerald: "#2ECC71",
        gold: "#C89B3C",
        offwhite: "#F5F7FA",
      },
      fontFamily: {
        // Inter is self-hosted via next/font (app/layout.tsx sets --font-inter).
        sans: [
          "var(--font-inter)",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        // Brand-tuned soft shadows (previously forced via raw .shadow-xl /
        // .shadow-2xl overrides in globals.css — now defined once here).
        xl: "0 6px 24px 0 rgba(13,27,42,.06), 0 1.5px 5px rgba(13,27,42,.03)",
        "2xl": "0 16px 54px 0 rgba(13,27,42,.19), 0 1.5px 7px rgba(13,27,42,.02)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
