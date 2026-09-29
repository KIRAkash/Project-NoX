import type { CSSProperties } from "react";

import type { RoleDef } from "@/lib/app/roles";

/** A role's planet, drawn with gradients so it scales from avatar size to the role picker's hero size. */
export function Planet({ role, size, glow = false, className = "" }: { role: RoleDef; size: number; glow?: boolean; className?: string }) {
  const [light, base, shadow] = role.surface;
  const body: CSSProperties = {
    width: size,
    height: size,
    background: `radial-gradient(circle at 32% 28%, ${light} 0%, ${base} 46%, ${shadow} 100%)`,
    boxShadow: glow
      ? `0 0 ${size * 0.45}px ${size * 0.06}px ${base}55, inset -${size * 0.12}px -${size * 0.1}px ${size * 0.22}px rgba(0,0,0,.45)`
      : `inset -${size * 0.12}px -${size * 0.1}px ${size * 0.22}px rgba(0,0,0,.45)`,
  };

  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      {role.feature === "ring" && <Ring size={size} color={base} behind />}
      <span className="absolute inset-0 overflow-hidden rounded-full" style={body}>
        {role.feature === "bands" && (
          <span
            className="absolute inset-0"
            style={{
              background: `repeating-linear-gradient(172deg, transparent 0 ${size * 0.09}px, ${shadow}40 ${size * 0.09}px ${size * 0.13}px, ${light}22 ${size * 0.13}px ${size * 0.16}px)`,
              mixBlendMode: "multiply",
            }}
          />
        )}
      </span>
      {role.feature === "ring" && <Ring size={size} color={base} />}
      {role.feature === "moon" && (
        <span
          className="absolute rounded-full"
          style={{
            width: size * 0.2,
            height: size * 0.2,
            right: -size * 0.14,
            top: size * 0.02,
            background: `radial-gradient(circle at 35% 30%, #fff, ${light} 45%, ${shadow})`,
            boxShadow: `0 0 ${size * 0.06}px ${light}66`,
          }}
        />
      )}
      {role.feature === "bands" && <Ring size={size} color={light} thin />}
    </span>
  );
}

/** An elliptical ring; drawn twice (behind + in front) so the planet appears to sit inside it. */
function Ring({ size, color, behind = false, thin = false }: { size: number; color: string; behind?: boolean; thin?: boolean }) {
  const w = size * (thin ? 1.55 : 1.75);
  const h = size * (thin ? 0.32 : 0.42);
  return (
    <span
      className="pointer-events-none absolute left-1/2 top-1/2 rounded-[50%]"
      style={{
        width: w,
        height: h,
        transform: "translate(-50%, -50%) rotate(-16deg)",
        border: `${Math.max(1, size * (thin ? 0.018 : 0.04))}px solid ${color}${thin ? "99" : "cc"}`,
        clipPath: behind ? "inset(0 0 50% 0)" : "inset(50% 0 0 0)",
        zIndex: behind ? 0 : 2,
      }}
    />
  );
}
