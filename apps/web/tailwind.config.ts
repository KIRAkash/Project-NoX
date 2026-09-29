import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#05060B",
        hull: "#07080F",
        deck: "#090B13",
        nox: "#F7B542",
        ember: "#E9713C",
        ice: "#86B9EE",
        verify: "#5FD29F",
        ink: { DEFAULT: "#ECEFF8", muted: "#A6AEC7", faint: "#7C86A3", dim: "#6E7793" },
        hairline: "rgba(143,160,204,0.14)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "Helvetica Neue", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      maxWidth: { shell: "1240px" },
      // Softer corners across the app: controls and chips at 8px, cards and panels at 14px.
      borderRadius: { sm: "8px", DEFAULT: "8px", md: "14px", lg: "16px", xl: "20px", "2xl": "24px" },
    },
  },
  plugins: [],
};

export default config;
