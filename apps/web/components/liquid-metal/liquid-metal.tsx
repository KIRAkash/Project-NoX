"use client";

/* The liquid-metal finish for NoX's main calls to action.

   Wraps a real <button>, <a> or Next <Link>, so forms, navigation, focus and
   disabled states are untouched; the shader (./engine.ts, ported from
   ThreeUI's LiquidMetalButton) draws on a canvas behind the label and takes
   the element's own corner radius. Only the few primary actions on a page
   should use it: each one holds a WebGL context, and browsers cap those at
   about sixteen.

   Without WebGL 2 the element keeps the dark plate and a thin outline in its
   hue (the `.lm:not([data-metal])` rule in globals.css). */

import Link from "next/link";
import { forwardRef, useEffect, useImperativeHandle, useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ComponentProps, type CSSProperties } from "react";
import { createLiquidMetal } from "./engine";

/** NoX's amber, the default hue. */
export const NOX_HUE = "#F7B542";

type Finish = {
  /** Hex colour the metal is tinted toward: the sun's amber or the acting seat's hue. */
  hue?: string;
  /** 0 keeps the source's full spectrum; 1 is fully in the hue. */
  tint?: number;
  /** How brightly the button lights: bloom, lit face and outline. The landing page
      uses the source's full glow (1); inside the product and docs it is much calmer,
      so it sits quietly beside work. */
  glow?: number;
};

const CALM_GLOW = 0.2;

function useLiquidMetal<T extends HTMLElement>(hue: string, tint: number, glow: number, disabled: boolean) {
  const host = useRef<T>(null);
  const engine = useRef<ReturnType<typeof createLiquidMetal>>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // A fresh canvas per mount: disposing loses the WebGL context for good, so a
    // remount (React's dev double-mount, or a fast refresh) can't reuse the old one.
    const cv = document.createElement("canvas");
    cv.className = "lm-fx";
    cv.setAttribute("aria-hidden", "true");
    el.prepend(cv);
    const e = createLiquidMetal(cv, el);
    engine.current = e;
    if (!e) { cv.remove(); return; }

    // render only while on screen and the tab is visible
    let visible = true;
    const update = () => e.setRunning(visible && document.visibilityState !== "hidden");
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { rootMargin: "80px" });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      e.dispose();
      cv.remove();
      engine.current = null;
      delete el.dataset.metal;
    };
  }, []);

  // declared after the engine effect, so a new engine picks these up on every mount
  useEffect(() => { engine.current?.setTint(hue, tint); }, [hue, tint]);
  useEffect(() => { engine.current?.setGlow(glow); }, [glow]);
  useEffect(() => { engine.current?.setDisabled(disabled); }, [disabled]);

  return host;
}

function finishStyle(hue: string, style?: CSSProperties) {
  return { ...style, "--lm-hue": hue } as CSSProperties;
}

export const LiquidMetalButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & Finish>(
  function LiquidMetalButton({ hue = NOX_HUE, tint = 0.72, glow = CALM_GLOW, className = "", style, children, disabled, type = "button", ...rest }, ref) {
    const host = useLiquidMetal<HTMLButtonElement>(hue, tint, glow, !!disabled);
    useImperativeHandle(ref, () => host.current!);
    return (
      <button ref={host} type={type} disabled={disabled} className={`lm ${className}`} style={finishStyle(hue, style)} {...rest}>
        {children}
      </button>
    );
  },
);

/** A Next <Link> with the finish. */
export function LiquidMetalLink({ hue = NOX_HUE, tint = 0.72, glow = CALM_GLOW, className = "", style, children, ...rest }: ComponentProps<typeof Link> & Finish) {
  const host = useLiquidMetal<HTMLAnchorElement>(hue, tint, glow, false);
  return (
    <Link ref={host} className={`lm ${className}`} style={finishStyle(hue, style)} {...rest}>
      {children}
    </Link>
  );
}

/** A plain <a> with the finish, for in-page anchors on the landing page. */
export function LiquidMetalAnchor({ hue = NOX_HUE, tint = 0.72, glow = CALM_GLOW, className = "", style, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & Finish) {
  const host = useLiquidMetal<HTMLAnchorElement>(hue, tint, glow, false);
  return (
    <a ref={host} className={`lm ${className}`} style={finishStyle(hue, style)} {...rest}>
      {children}
    </a>
  );
}
