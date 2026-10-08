import type { Metadata } from "next";
import Script from "next/script";
import { Outfit, DM_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/lib/app/theme";
import "./globals.css";

const display = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NoX — from a sentence to shipped software",
  description:
    "NoX holds a living map of every application in your enterprise and how they depend on one another, then carries a change from a business user's first sentence through product, architecture, implementation and verification.",
};

/**
 * Pre-hydration theme initialization script.
 * Runs synchronously before <body> rendering to eliminate any Flash of Wrong Theme (FOWT).
 */
const NOX_THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('nox-theme');var d=(t==='light'||t==='dark')?t:'dark';document.documentElement.setAttribute('data-theme',d);document.documentElement.style.colorScheme=d;}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <head>
        <script
          id="nox-theme-init"
          dangerouslySetInnerHTML={{ __html: NOX_THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="bg-void font-sans text-ink antialiased">
        {/* Runs before hydration. The browser restores whatever scroll
            position the tab had on a reload, which — since the hero's own
            scroll-lock is only applied later, from a client effect — used
            to leave a visible instant of the page scrolled down to wherever
            it last was (reading as "a hint of the end of the page") before
            snapping back to the intro's corona close-up. Forcing the scroll
            to the top, and turning off the browser's own restoration, ahead
            of any React code running removes that flash entirely. */}
        <Script id="reset-scroll" strategy="beforeInteractive">
          {`try{if('scrollRestoration' in history){history.scrollRestoration='manual';}window.scrollTo(0,0);}catch(e){}`}
        </Script>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
