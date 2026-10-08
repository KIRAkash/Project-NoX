import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "var(--void, #05060B)",
        hull: "var(--hull, #07080F)",
        deck: "var(--deck, #090B13)",
        nox: "var(--nox, #F7B542)",
        ember: "var(--ember, #E9713C)",
        ice: "var(--ice, #86B9EE)",
        verify: "var(--verify, #5FD29F)",
        ink: {
          DEFAULT: "var(--ink, #ECEFF8)",
          muted: "var(--ink-muted, #A6AEC7)",
          faint: "var(--ink-faint, #7C86A3)",
          dim: "var(--ink-dim, #6E7793)",
        },
        hairline: "var(--hairline, rgba(143,160,204,0.14))",
        // fixed, not themed: dark type on bright fills (gold, ember, violet, a seat's own hue)
        abyss: "#05060B",
        role: {
          DEFAULT: "var(--role)",
          glow: "var(--role-glow)",
        },
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
