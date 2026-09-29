"use client";

import { ArrowUpRight, Pen, Square, Type, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Tool = "box" | "arrow" | "pen" | "text";
type Shape =
  | { tool: "box" | "arrow"; a: [number, number]; b: [number, number] }
  | { tool: "pen"; pts: [number, number][] }
  | { tool: "text"; a: [number, number]; text: string };

const TOOLS: { id: Tool; label: string; icon: typeof Square }[] = [
  { id: "box", label: "Box", icon: Square },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "pen", label: "Pen", icon: Pen },
  { id: "text", label: "Text", icon: Type },
];

/**
 * Mark up a screenshot before NoX sees it: box, arrow, pen and text in the acting seat's colour, on a plain canvas
 * with pointer events (so touch works). NoX gets the marked-up copy and the original.
 */
export function Annotator({ src, hue, onDone, onCancel }: { src: string; hue: string; onDone: (marked: Blob | null) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const draft = useRef<Shape | null>(null);
  const [, redrawTick] = useState(0);

  const draw = useCallback(() => {
    const c = canvas.current;
    const image = img.current;
    if (!c || !image) return;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0, c.width, c.height);
    const w = Math.max(3, Math.round(c.width / 300));
    ctx.strokeStyle = hue;
    ctx.fillStyle = hue;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of draft.current ? [...shapes, draft.current] : shapes) {
      ctx.beginPath();
      if (s.tool === "box") ctx.strokeRect(s.a[0], s.a[1], s.b[0] - s.a[0], s.b[1] - s.a[1]);
      else if (s.tool === "arrow") {
        const [x1, y1] = s.a;
        const [x2, y2] = s.b;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const head = w * 5;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
        ctx.stroke();
      } else if (s.tool === "pen") {
        s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      } else if (s.tool === "text") {
        ctx.font = `600 ${w * 7}px system-ui, sans-serif`;
        ctx.lineWidth = w * 1.4;
        ctx.strokeStyle = "rgba(5,6,11,.85)";
        ctx.strokeText(s.text, s.a[0], s.a[1]);
        ctx.fillText(s.text, s.a[0], s.a[1]);
        ctx.strokeStyle = hue;
        ctx.lineWidth = w;
      }
    }
  }, [shapes, hue]);

  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      img.current = image;
      const c = canvas.current!;
      c.width = image.naturalWidth;
      c.height = image.naturalHeight;
      drawRef.current();
    };
    image.src = src;
  }, [src]);
  useEffect(() => draw(), [draw]);

  const point = (e: React.PointerEvent): [number, number] => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  const down = (e: React.PointerEvent) => {
    const p = point(e);
    if (tool === "text") {
      const text = window.prompt("Text to add")?.trim();
      if (text) setShapes((s) => [...s, { tool: "text", a: p, text }]);
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draft.current = tool === "pen" ? { tool, pts: [p] } : { tool, a: p, b: p };
  };
  const move = (e: React.PointerEvent) => {
    const d = draft.current;
    if (!d) return;
    const p = point(e);
    if (d.tool === "pen") d.pts.push(p);
    else if (d.tool !== "text") d.b = p;
    draw();
    redrawTick((n) => n + 1);
  };
  const up = () => {
    if (draft.current) setShapes((s) => [...s, draft.current!]);
    draft.current = null;
  };

  const finish = () => {
    if (!shapes.length) return onDone(null);
    canvas.current!.toBlob((b) => onDone(b), "image/png");
  };

  return (
    <div role="dialog" aria-label="Mark up the screenshot" className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            aria-pressed={tool === t.id}
            className="flex h-9 items-center gap-1.5 rounded-sm border px-3 text-[12.5px]"
            style={{ borderColor: tool === t.id ? hue : "rgba(143,160,204,.2)", color: tool === t.id ? hue : "#A6AEC7" }}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
        <button type="button" disabled={!shapes.length} onClick={() => setShapes((s) => s.slice(0, -1))} className="flex h-9 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[12.5px] text-ink-muted disabled:opacity-40">
          <Undo2 size={13} /> Undo
        </button>
      </div>
      <p className="text-[12.5px] text-ink-faint">Mark what NoX should look at. NoX sees your marks and the original.</p>
      <canvas
        ref={canvas}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="block max-h-[55vh] w-full touch-none rounded-sm border border-hairline object-contain"
        style={{ cursor: tool === "text" ? "text" : "crosshair" }}
        aria-label="Screenshot"
      />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 px-3 text-[13px] text-ink-dim hover:text-ink">
          Cancel
        </button>
        <button type="button" onClick={finish} className="h-9 rounded-sm px-4 text-[13px] font-semibold text-void" style={{ background: hue }}>
          {shapes.length ? "Use marked-up copy" : "Use as it is"}
        </button>
      </div>
    </div>
  );
}
