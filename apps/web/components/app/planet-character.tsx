"use client";

import gsap from "gsap";
import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { Planet } from "@/components/app/planet";
import type { RoleDef } from "@/lib/app/roles";

/**
 * A role's planet with a face and its role props: lightbulb and reading glasses, pencil, headset, glasses.
 * Meant for large sizes (the role picker); small planets elsewhere stay plain.
 *
 * The drawing uses a 100×100 box laid over the planet (the planet is the circle at 50,50 r50);
 * props may reach outside it. `active` (hover, focus, picked) plays the role's animation;
 * turning it off plays it back in reverse.
 */
export function PlanetCharacter({
  role,
  size,
  active,
  index = 0,
  className = "",
}: {
  role: RoleDef;
  size: number;
  active: boolean;
  index?: number;
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const onEnter = useRef<(() => void) | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [light, base, shadow] = role.surface;
  const ink = "#10131F";

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    let blinkCall: gsap.core.Tween | null = null;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el);
      const eyes = q(".eye");
      // origins are set once: setting them per tween makes GSAP shift the element a little each time
      gsap.set(eyes, { transformOrigin: "50% 50%" });
      gsap.set(q(".brow, .lid-right"), { transformOrigin: "50% 50%" });
      gsap.set(q(".bulb"), { svgOrigin: "62 -44" });
      gsap.set(q(".bulb-halo, .bulb-wash"), { opacity: 0 });
      gsap.set(q(".pencil"), { transformOrigin: "0% 50%" });
      gsap.set(q(".mic"), { svgOrigin: "6 62" });
      gsap.set(q(".signal"), { transformOrigin: "100% 50%", opacity: 0 });

      // wake up one after another, then blink now and then (never in step with the others)
      gsap.fromTo(
        eyes,
        { scaleY: 0.08 },
        {
          scaleY: 1,
          duration: 0.28,
          delay: 0.35 + index * 0.15,
          ease: "power2.out",
        },
      );
      const blink = () => {
        gsap.to(eyes, {
          scaleY: 0.08,
          duration: 0.07,
          yoyo: true,
          repeat: 1,
          ease: "power1.in",
        });
        blinkCall = gsap.delayedCall(4 + Math.random() * 3, blink);
      };
      blinkCall = gsap.delayedCall(
        2.2 + index * 1.1 + Math.random() * 2,
        blink,
      );

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power2.out", duration: 0.35 },
      });
      const body = q(".body");
      if (role.id === "business") {
        // the bulb comes on and lights the planet; the reading glasses slide up: "oh, that's good"
        tl.to(q(".bulb-glass"), { attr: { "fill-opacity": 1 } }, 0)
          .to(q(".bulb-halo, .bulb-wash"), { opacity: 1, duration: 0.45 }, 0)
          .to(q(".filament"), { attr: { stroke: "#FFFFFF" } }, 0)
          .to(q(".eyes"), { y: -1.4 }, 0.05)
          .to(
            q(".specs"),
            { y: -7.5, ease: "back.out(1.8)", duration: 0.45 },
            0.1,
          );
        onEnter.current = () => {
          gsap.fromTo(
            q(".bulb"),
            { rotation: 0 },
            {
              keyframes: { rotation: [7, -5, 2.5, 0] },
              duration: 0.9,
              ease: "sine.inOut",
            },
          );
        };
      } else if (role.id === "product") {
        tl.to(q(".brow"), { y: -3.2, rotation: -6 }, 0)
          .to(q(".lid-right"), { scaleY: 1 }, 0)
          .to(q(".pencil"), { rotation: -18, x: 4, y: 3 }, 0)
          .fromTo(
            q(".check"),
            { strokeDashoffset: 30 },
            { strokeDashoffset: 0, duration: 0.3, ease: "power1.inOut" },
            0.2,
          );
      } else if (role.id === "engineering") {
        // flight director: the mic swings in close, its light blinks, a signal goes out
        tl.to(q(".mic"), { rotation: -7, ease: "back.out(2)", duration: 0.4 });
        onEnter.current = () => {
          gsap.fromTo(
            q(".mic-led"),
            { opacity: 1 },
            {
              opacity: 0.15,
              duration: 0.12,
              repeat: 5,
              yoyo: true,
              ease: "none",
              delay: 0.2,
            },
          );
          gsap.fromTo(
            q(".signal"),
            { opacity: 0, scale: 0.6 },
            {
              opacity: 1,
              scale: 1,
              duration: 0.35,
              stagger: 0.14,
              ease: "power2.out",
              delay: 0.15,
            },
          );
          gsap.to(q(".signal"), {
            opacity: 0,
            duration: 0.3,
            stagger: 0.14,
            delay: 0.75,
          });
        };
      } else {
        tl.to(q(".code"), { opacity: 1, y: -3 }, 0);
        onEnter.current = () => {
          gsap
            .timeline()
            .to(eyes, { x: -2, duration: 0.12 })
            .to(eyes, { x: 2.2, duration: 0.45, ease: "none" })
            .to(eyes, { x: -2, duration: 0.1 })
            .to(eyes, { x: 2.2, duration: 0.45, ease: "none" })
            .to(eyes, { x: 0, duration: 0.2 });
          gsap.fromTo(
            q(".lens-glint"),
            { x: -30 },
            { x: 50, duration: 0.55, delay: 0.1, ease: "power1.inOut" },
          );
          gsap.fromTo(
            q(".cursor"),
            { opacity: 1 },
            {
              opacity: 0,
              duration: 0.01,
              repeat: 5,
              yoyo: true,
              repeatDelay: 0.22,
              delay: 0.3,
            },
          );
        };
      }
      timeline.current = tl;
    }, el);
    return () => {
      blinkCall?.kill();
      ctx.revert();
      timeline.current = null;
      onEnter.current = null;
    };
  }, [role.id, index, size]);

  useEffect(() => {
    const tl = timeline.current;
    if (!tl) return;
    if (active) {
      tl.play();
      onEnter.current?.();
    } else tl.reverse();
  }, [active]);

  const eye = (x: number, y: number, extra = "") => (
    <g transform={`translate(${x} ${y})`} className={extra}>
      <g className="eye">
        <ellipse rx={4.4} ry={4.9} fill={ink} />
        <circle cx={-1.5} cy={-1.8} r={1.45} fill="#fff" />
      </g>
    </g>
  );

  return (
    <span
      ref={root}
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="body absolute inset-0 block">
        <Planet role={role} size={size} glow />
        <svg
          viewBox="0 0 100 100"
          width={size}
          height={size}
          className="absolute inset-0"
          style={{ overflow: "visible", zIndex: 3 }}
        >
          <defs>
            <clipPath id={`planet-${uid}`}>
              <circle cx={50} cy={50} r={49.5} />
            </clipPath>
          </defs>

          <g className="eyes">
            {eye(37, 45)}
            {role.id === "product" ? (
              <g transform="translate(60 45)">
                <g className="lid-right" transform="scale(1 0.72)">
                  <g className="eye">
                    <ellipse rx={4.4} ry={4.9} fill={ink} />
                    <circle cx={-1.5} cy={-1.8} r={1.45} fill="#fff" />
                  </g>
                </g>
              </g>
            ) : (
              eye(60, 45)
            )}
          </g>

          {role.id === "business" && (
            <>
              <defs>
                <radialGradient id={`halo-${uid}`}>
                  <stop offset="0" stopColor={light} stopOpacity={0.9} />
                  <stop offset="0.45" stopColor={base} stopOpacity={0.35} />
                  <stop offset="1" stopColor={base} stopOpacity={0} />
                </radialGradient>
                <radialGradient id={`wash-${uid}`} cx="0.62" cy="0" r="0.75">
                  <stop offset="0" stopColor="#FFFFFF" stopOpacity={0.55} />
                  <stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                </radialGradient>
              </defs>
              {/* light from the bulb falls on the top of the planet */}
              <circle
                className="bulb-wash"
                cx={50}
                cy={50}
                r={49.5}
                fill={`url(#wash-${uid})`}
              />
              {/* half-moon reading glasses, low on the face, on a beaded chain */}
              <g transform="translate(0 3)">
                <g className="specs">
                  <path
                    d="M27 51.5 Q50 70 73 51.5"
                    fill="none"
                    stroke={shadow}
                    strokeWidth={1.3}
                    strokeLinecap="round"
                    strokeDasharray="0.1 2.3"
                  />
                  <g
                    fill={light}
                    fillOpacity={0.18}
                    stroke={ink}
                    strokeWidth={1.9}
                    strokeLinejoin="round"
                  >
                    <path d="M29.5 50 H44.5 A7.5 6.4 0 0 1 29.5 50 Z" />
                    <path d="M52.5 50 H67.5 A7.5 6.4 0 0 1 52.5 50 Z" />
                  </g>
                  <g
                    fill="none"
                    stroke={ink}
                    strokeWidth={1.9}
                    strokeLinecap="round"
                  >
                    <path d="M44.5 50.4 Q48.5 47.8 52.5 50.4" />
                    <path d="M29.5 50 L26.5 51.5" />
                    <path d="M67.5 50 L73 51.5" />
                  </g>
                </g>
              </g>
            </>
          )}

          {role.id === "product" && (
            <>
              <path
                className="brow"
                d="M55 36.2 Q60 33.6 65.2 36.4"
                fill="none"
                stroke={ink}
                strokeWidth={1.9}
                strokeLinecap="round"
              />
              {/* pencil tucked against the right edge, like behind an ear */}
              <g transform="translate(83 82)">
                <g className="pencil" transform="rotate(-62)">
                  <rect
                    x={0}
                    y={-2.4}
                    width={4}
                    height={4.8}
                    rx={1.2}
                    fill={light}
                    stroke={shadow}
                    strokeWidth={0.6}
                  />
                  <rect x={4} y={-2.4} width={2} height={4.8} fill={shadow} />
                  <rect
                    x={6}
                    y={-2.4}
                    width={17}
                    height={4.8}
                    fill={base}
                    stroke={shadow}
                    strokeWidth={0.6}
                  />
                  <path
                    d="M6 0 H23"
                    stroke={light}
                    strokeWidth={0.8}
                    opacity={0.6}
                  />
                  <path
                    d="M23 -2.4 L29 0 L23 2.4 Z"
                    fill={light}
                    stroke={shadow}
                    strokeWidth={0.6}
                    strokeLinejoin="round"
                  />
                  <path d="M27.2 -0.75 L29 0 L27.2 0.75 Z" fill={ink} />
                </g>
              </g>
              <path
                className="check"
                d="M99 92 L104 97.5 L115 84"
                fill="none"
                stroke={light}
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={30}
                strokeDashoffset={30}
              />
            </>
          )}

          {role.id === "engineering" && (
            <>
              {/* flight-director headset: padded band, big earcups at the sides, boom mic at the mouth */}
              <path
                d="M7.5 42 C3 -22 97 -22 92.5 42"
                fill="none"
                stroke={ink}
                strokeWidth={6}
                strokeLinecap="round"
              />
              <path
                d="M11 30 C12 -8 88 -8 89 30"
                fill="none"
                stroke="#2A3050"
                strokeWidth={2.4}
                strokeLinecap="round"
              />
              <path
                d="M22 6 C32 -3 44 -6 56 -6"
                fill="none"
                stroke={light}
                strokeWidth={1.1}
                strokeLinecap="round"
                opacity={0.55}
              />
              <rect
                x={3.5}
                y={33}
                width={8}
                height={9}
                rx={1.6}
                fill="#2A3050"
                stroke={ink}
                strokeWidth={1}
              />
              <rect
                x={88.5}
                y={33}
                width={8}
                height={9}
                rx={1.6}
                fill="#2A3050"
                stroke={ink}
                strokeWidth={1}
              />
              <g className="mic">
                <path
                  d="M6 62 C6 76 26 78 40 69.5"
                  fill="none"
                  stroke={ink}
                  strokeWidth={2.6}
                  strokeLinecap="round"
                />
                <ellipse cx={43.5} cy={68} rx={5.2} ry={3.9} fill={ink} />
                <ellipse cx={42.4} cy={66.8} rx={2.2} ry={1.2} fill="#3A4266" />
                <circle
                  className="mic-led"
                  cx={46.4}
                  cy={68.6}
                  r={1.1}
                  fill="#7CF0B0"
                />
              </g>
              <g>
                <rect
                  x={-4}
                  y={38}
                  width={16}
                  height={28}
                  rx={7.5}
                  fill={ink}
                />
                <rect
                  x={-1.5}
                  y={42}
                  width={6}
                  height={20}
                  rx={3}
                  fill={base}
                />
                <rect
                  x={9}
                  y={40}
                  width={6}
                  height={24}
                  rx={3}
                  fill="#2A3050"
                />
                <rect
                  x={88}
                  y={38}
                  width={16}
                  height={28}
                  rx={7.5}
                  fill={ink}
                />
                <rect
                  x={95.5}
                  y={42}
                  width={6}
                  height={20}
                  rx={3}
                  fill={base}
                />
                <rect
                  x={85}
                  y={40}
                  width={6}
                  height={24}
                  rx={3}
                  fill="#2A3050"
                />
              </g>
              <g fill="none" stroke={light} strokeLinecap="round">
                <path
                  className="signal"
                  d="M-8 45 Q-12 52 -8 59"
                  strokeWidth={1.8}
                />
                <path
                  className="signal"
                  d="M-13.5 40 Q-20 52 -13.5 64"
                  strokeWidth={1.6}
                />
                <path
                  className="signal"
                  d="M-19 35 Q-28 52 -19 69"
                  strokeWidth={1.4}
                />
              </g>
            </>
          )}

          {role.id === "developer" && (
            <>
              <defs>
                <clipPath id={`lenses-${uid}`}>
                  <circle cx={37} cy={45} r={8.6} />
                  <circle cx={60} cy={45} r={8.6} />
                </clipPath>
              </defs>
              <g fill={light} fillOpacity={0.14} stroke={ink} strokeWidth={2.1}>
                <circle cx={37} cy={45} r={8.6} />
                <circle cx={60} cy={45} r={8.6} />
              </g>
              <g clipPath={`url(#lenses-${uid})`}>
                <rect
                  className="lens-glint"
                  x={20}
                  y={30}
                  width={4}
                  height={34}
                  fill="#fff"
                  opacity={0.55}
                  transform="skewX(-28)"
                />
              </g>
              <g
                fill="none"
                stroke={ink}
                strokeWidth={2.1}
                strokeLinecap="round"
              >
                <path d="M45.6 43.6 Q48.5 40.8 51.4 43.6" />
                <path d="M28.4 43.5 L13 40.5" />
                <path d="M68.6 43.5 L85 40.5" />
              </g>
              <g
                className="code"
                opacity={0}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize={12}
                fontWeight={600}
                fill={light}
              >
                <text x={50} y={-7} textAnchor="middle">
                  {"</>"}
                </text>
                <rect
                  className="cursor"
                  x={63}
                  y={-16}
                  width={1.6}
                  height={10}
                  fill={light}
                />
              </g>
            </>
          )}
          {role.id === "business" && (
            <g className="bulb">
              <g transform="translate(62 -44) scale(1.35) translate(-62 34)">
                <circle
                  className="bulb-halo"
                  cx={62}
                  cy={-10}
                  r={24}
                  fill={`url(#halo-${uid})`}
                />
                <path d="M62 -34 V-21" stroke={ink} strokeWidth={1.1} />
                <rect
                  x={58.6}
                  y={-21.5}
                  width={6.8}
                  height={5.5}
                  rx={1.2}
                  fill={shadow}
                  stroke={ink}
                  strokeWidth={0.8}
                />
                <path
                  d="M58.8 -19.6 H65.2 M58.8 -17.8 H65.2"
                  stroke={light}
                  strokeWidth={0.6}
                  opacity={0.6}
                />
                <path
                  className="bulb-glass"
                  d="M59 -16 C59 -13.5 54.5 -12 54.5 -7.5 A7.5 7.5 0 0 0 69.5 -7.5 C69.5 -12 65 -13.5 65 -16 Z"
                  fill={light}
                  fillOpacity={0.22}
                  stroke={light}
                  strokeWidth={1.1}
                  strokeLinejoin="round"
                />
                <path
                  className="filament"
                  d="M60.3 -15.5 V-10.5 L61.2 -8.5 L62 -10.5 L62.8 -8.5 L63.7 -10.5 V-15.5"
                  fill="none"
                  stroke={shadow}
                  strokeWidth={0.8}
                  strokeLinejoin="round"
                />
                <path
                  d="M57.4 -9.8 A4.8 4.8 0 0 1 58.6 -12.6"
                  fill="none"
                  stroke="#fff"
                  strokeWidth={0.9}
                  strokeLinecap="round"
                  opacity={0.8}
                />
              </g>
            </g>
          )}
        </svg>
      </span>
    </span>
  );
}
