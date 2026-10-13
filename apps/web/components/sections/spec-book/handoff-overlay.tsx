"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { BrandLogo } from "@/components/app/brand-logo";
import { gsap } from "@/lib/motion";
import type { Anchor } from "./book-scene";
import { AGENTS, BADGE, BUILD_LOG, IN_IDE, handoffLayout } from "./handoff";
import { bookState } from "./timeline";

/*
 * The hand-off, drawn over the book's canvas: once the book is locked and
 * has shrunk aside, curved arrows grow out of it to the coding agents that
 * can build from it. Antigravity, the one in the developer's environment,
 * lights up and the others dim; knowledge flows
 * down its arrow while its build log fills in, and the finished work
 * travels back up the arrow to the book.
 *
 * Like the scene, it is a pure function of `timeRef`, so the scroll scrub
 * runs it both ways. It renders once and then only moves elements on the
 * ticker; React re-renders only when the box switches between the wide
 * (column) and narrow (row) layout.
 */

const FLOW_DOTS = 3;

export default function HandoffOverlay({
  timeRef,
  anchorRef,
  isVisible,
}: {
  timeRef: MutableRefObject<number>;
  anchorRef: MutableRefObject<Anchor | null>;
  isVisible: () => boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 0, h: 0 });
  const [wide, setWide] = useState(true);

  const arrows = useRef<(SVGPathElement | null)[]>([]);
  const heads = useRef<(SVGPathElement | null)[]>([]);
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const backDot = useRef<SVGCircleElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lines = useRef<(HTMLLIElement | null)[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      setWide(handoffLayout(el.clientWidth, el.clientHeight).wide);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const tick = () => {
      const a = anchorRef.current;
      const box = boxRef.current;
      if (!a || !box || !size.current.w || !isVisible()) return;
      const L = handoffLayout(size.current.w, size.current.h);
      const s = bookState(timeRef.current);
      const shown = s.hand > 0.001;
      box.style.visibility = shown ? "visible" : "hidden";
      if (!shown) return;
      const clock = performance.now() / 1000;
      const mid = (AGENTS.length - 1) / 2;

      AGENTS.forEach((_, i) => {
        const p = s.agents[i];
        const n = L.nodes[i];
        const picked = i === IN_IDE;
        const dim = picked ? 1 : 1 - 0.72 * s.pick;

        // a soft S-curve from the book's edge to the badge, fanned a little at the start
        const half = BADGE / 2 + 6;
        let d: string;
        let tx: number;
        let ty: number;
        let ex: number;
        let ey: number;
        if (L.wide) {
          const sx = a.fx + 4;
          const sy = a.fy + (i - mid) * 7;
          ex = n.x - half;
          ey = n.y;
          const dx = ex - sx;
          d = `M${sx},${sy} C${sx + dx * 0.55},${sy} ${ex - dx * 0.5},${ey} ${ex},${ey}`;
          tx = 1;
          ty = 0;
        } else {
          const sx = a.bx + (i - mid) * 9;
          const sy = a.by + 4;
          ex = n.x;
          ey = n.y - half;
          const dy = ey - sy;
          d = `M${sx},${sy} C${sx},${sy + dy * 0.6} ${ex},${ey - dy * 0.55} ${ex},${ey}`;
          tx = 0;
          ty = 1;
        }
        const path = arrows.current[i];
        if (path) {
          path.setAttribute("d", d);
          const len = path.getTotalLength();
          path.style.strokeDasharray = `${len}`;
          path.style.strokeDashoffset = `${len * (1 - p)}`;
          path.style.opacity = `${dim}`;
          path.style.strokeWidth = picked ? `${1.4 + 0.8 * s.pick}` : "1.25";
          path.style.stroke = picked && s.pick > 0.5 ? "var(--nox, #F7B542)" : "var(--ink-faint, #7C86A3)";
        }
        const head = heads.current[i];
        if (head) {
          // the arrowhead appears as the line arrives, pointing along its last stretch
          const k = 6;
          head.setAttribute("d", `M${ex - tx * k - ty * k * 0.7},${ey - ty * k - tx * k * 0.7} L${ex},${ey} L${ex - tx * k + ty * k * 0.7},${ey - ty * k + tx * k * 0.7}`);
          head.style.opacity = `${(p > 0.96 ? 1 : 0) * dim}`;
          head.style.stroke = picked && s.pick > 0.5 ? "var(--nox, #F7B542)" : "var(--ink-faint, #7C86A3)";
        }
        const node = nodes.current[i];
        if (node) {
          const appear = Math.min(1, p * 1.6);
          const lift = picked ? 1 + 0.12 * s.pick : 1;
          const offX = L.wide ? BADGE / 2 : 28;
          node.style.transform = `translate(${n.x - offX}px, ${n.y - BADGE / 2 + (1 - appear) * 8}px) scale(${lift})`;
          node.style.transformOrigin = `${offX}px ${BADGE / 2}px`;
          node.style.opacity = `${appear * dim}`;
          node.dataset.picked = picked && s.pick > 0.5 ? "true" : "false";
        }
      });

      // knowledge flowing down the picked arrow while it builds, and the work coming back up
      const picked = arrows.current[IN_IDE];
      if (picked) {
        const len = picked.getTotalLength();
        const flowing = s.pick * (1 - s.verify);
        dots.current.forEach((dot, k) => {
          if (!dot) return;
          const f = (clock * 0.45 + k / FLOW_DOTS) % 1;
          const pt = picked.getPointAtLength(f * len);
          dot.setAttribute("cx", `${pt.x}`);
          dot.setAttribute("cy", `${pt.y}`);
          dot.style.opacity = `${flowing * Math.sin(f * Math.PI)}`;
        });
        if (backDot.current) {
          const pt = picked.getPointAtLength((1 - s.verify) * len);
          backDot.current.setAttribute("cx", `${pt.x}`);
          backDot.current.setAttribute("cy", `${pt.y}`);
          backDot.current.style.opacity = `${s.verify > 0 && s.verify < 1 ? 1 : 0}`;
        }
      }

      // the build log fills in one line at a time; the line being worked on pulses
      const pn = panel.current;
      if (pn) {
        const inP = Math.min(1, s.build * 8);
        pn.style.transform = `translate(${L.panel.x}px, ${L.panel.y + (1 - inP) * 10}px)`;
        pn.style.width = `${L.panel.w}px`;
        pn.style.maxHeight = `${L.panel.h}px`;
        pn.style.opacity = `${inP}`;
      }
      const shownLines = s.build * BUILD_LOG.length;
      lines.current.forEach((li, k) => {
        if (!li) return;
        const v = Math.min(1, Math.max(0, (shownLines - k) * 2.5));
        li.style.opacity = `${v}`;
        li.style.transform = `translateY(${(1 - v) * 4}px)`;
        li.dataset.state = shownLines >= k + 1 ? "done" : shownLines > k ? "running" : "waiting";
      });
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, s.build)})`;
      if (status.current) status.current.textContent = s.verified ? "Built" : s.build >= 1 ? "PR opened" : "Building";
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [anchorRef, isVisible, timeRef]);

  return (
    <div ref={boxRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ visibility: "hidden" }}>
      <svg className="absolute inset-0 h-full w-full overflow-visible" fill="none">
        {AGENTS.map((agent, i) => (
          <g key={agent.id}>
            <path ref={(el) => void (arrows.current[i] = el)} strokeLinecap="round" />
            <path ref={(el) => void (heads.current[i] = el)} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
        {Array.from({ length: FLOW_DOTS }, (_, k) => (
          <circle key={k} ref={(el) => void (dots.current[k] = el)} r={2.6} fill="var(--nox, #F7B542)" opacity={0} />
        ))}
        <circle ref={backDot} r={4.5} fill="var(--verify, #5FD29F)" opacity={0} />
      </svg>

      {AGENTS.map((agent, i) => (
        <div
          key={agent.id}
          ref={(el) => void (nodes.current[i] = el)}
          data-picked="false"
          className={`group absolute left-0 top-0 flex will-change-transform ${wide ? "flex-row items-center gap-2.5" : "w-14 flex-col items-center gap-1"}`}
          style={{ opacity: 0 }}
        >
          <span
            className="flex shrink-0 items-center justify-center rounded-[10px] border border-hairline bg-deck font-mono text-[12px] font-semibold text-ink-muted shadow-sm transition-colors duration-300 group-data-[picked=true]:border-[rgba(247,181,66,.65)] group-data-[picked=true]:bg-[rgba(247,181,66,.14)] group-data-[picked=true]:text-nox"
            style={{ width: BADGE, height: BADGE }}
          >
            {agent.logo ? <BrandLogo name={agent.logo} size={18} title={agent.name} /> : agent.mark}
          </span>
          <span className={`flex flex-col ${wide ? "" : "items-center text-center"}`}>
            <span className={`font-medium leading-tight text-ink-muted group-data-[picked=true]:text-ink ${wide ? "text-[13px]" : "text-[9.5px]"}`}>{agent.name}</span>
            {wide && (
              <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-nox opacity-0 transition-opacity duration-300 group-data-[picked=true]:opacity-100">
                Developer&rsquo;s IDE
              </span>
            )}
          </span>
        </div>
      ))}

      <div
        ref={panel}
        className="absolute left-0 top-0 overflow-hidden rounded-[14px] border border-hairline bg-[rgb(var(--deck-rgb)/.94)] shadow-[0_10px_30px_-12px_rgba(20,14,8,.35)] backdrop-blur"
        style={{ opacity: 0 }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-3.5 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[rgba(247,181,66,.16)]">
              <BrandLogo name="antigravity" size={13} />
            </span>
            <span className="truncate text-[12.5px] font-medium text-ink">Antigravity · NOX-1</span>
          </span>
          <span ref={status} className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            Building
          </span>
        </div>
        <ol className="space-y-1.5 px-3.5 py-3">
          {BUILD_LOG.map((line, k) => (
            <li
              key={k}
              ref={(el) => void (lines.current[k] = el)}
              data-state="waiting"
              className="group/line flex items-center gap-2 font-mono text-[11px] leading-[1.35] text-ink-muted"
              style={{ opacity: 0 }}
            >
              <span className="w-3 shrink-0 text-center text-ink-faint group-data-[state=done]/line:text-verify group-data-[state=running]/line:animate-pulse group-data-[state=running]/line:text-nox">
                <span className="group-data-[state=done]/line:hidden">•</span>
                <span className="hidden group-data-[state=done]/line:inline">✓</span>
              </span>
              <span className={`min-w-0 flex-1 truncate ${line.kind === "cmd" ? "text-nox" : line.kind === "cite" ? "text-ink-muted" : "text-ink"}`}>
                {line.kind === "cmd" ? `$ ${line.text}` : line.text}
              </span>
              {line.meta && <span className="shrink-0 text-ink-faint">{line.meta}</span>}
            </li>
          ))}
        </ol>
        <div className="mx-3.5 mb-3 h-[3px] overflow-hidden rounded-full bg-hairline">
          <div ref={bar} className="h-full origin-left rounded-full bg-nox" style={{ transform: "scaleX(0)" }} />
        </div>
      </div>
    </div>
  );
}
