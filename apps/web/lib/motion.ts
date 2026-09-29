"use client";

import { useEffect, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin, useGSAP);

export { gsap, ScrollTrigger, MotionPathPlugin, useGSAP };

export const EASE = "power3.out";
export const EASE_IO = "power2.inOut";

/**
 * Elements are only hidden up front once we know GSAP is running, so a
 * JS-less or errored page still renders everything. See globals.css.
 */
export function useJsReady() {
  useEffect(() => {
    document.documentElement.classList.add("js-ready");
    return () => document.documentElement.classList.remove("js-ready");
  }, []);
}

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scroll-linked reveal for every `[data-reveal]` inside `scope`. Elements
 * sharing a `data-reveal-group` value rise together as a stagger.
 */
export function useReveal(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const host = scope.current;
      if (!host) return;

      // Query inside the scope element. `gsap.utils.toArray` is NOT scoped by
      // useGSAP the way selector strings passed to gsap methods are, so a
      // document-wide query here makes every section fight over every element.
      const all = Array.from(host.querySelectorAll<HTMLElement>("[data-reveal]"));
      if (!all.length) return;

      if (prefersReducedMotion()) {
        gsap.set(all, { opacity: 1, y: 0 });
        return;
      }

      const groups = new Map<string, HTMLElement[]>();
      all.forEach((el, i) => {
        const key = el.dataset.revealGroup ?? `solo-${i}`;
        const bucket = groups.get(key);
        if (bucket) bucket.push(el);
        else groups.set(key, [el]);
      });

      groups.forEach((els) => {
        gsap.fromTo(
          els,
          { opacity: 0, y: 28 },
          {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: EASE,
            stagger: 0.08,
            scrollTrigger: { trigger: els[0], start: "top 88%", once: true },
          },
        );
      });
    },
    { scope },
  );
}

/** Late-loading webfonts change section heights; recompute trigger positions. */
export function useScrollTriggerRefresh() {
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }, []);
}
