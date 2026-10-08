import { UPCOMING_ROLES } from "@/lib/app/roles";

/**
 * The role picker's placeholder for seats that aren't playable yet: an outlined planet with a plus.
 * Its moons (one per upcoming seat) wait in a line out in space; `active` (hover, focus, tap) brings
 * them into orbit one after another.
 *
 * Same 100×100 box as PlanetCharacter; the queue and the orbit reach outside it.
 */

const TILT = (-16 * Math.PI) / 180;
const RX = 72;
const RY = 19;
/** Where each moon sits on the orbit: all on the front half, so none has to pass behind the planet. */
const ORBIT_ANGLES = [20, 65, 115, 160];

function orbitPoint(deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  const x = RX * Math.cos(t);
  const y = RY * Math.sin(t);
  return [50 + x * Math.cos(TILT) - y * Math.sin(TILT), 50 + x * Math.sin(TILT) + y * Math.cos(TILT)];
}

/** Waiting in line, trailing off to the upper right; the first in line is the closest. */
function queuePoint(i: number): [number, number] {
  return [108 + i * 11, 14 - i * 7];
}

export function ComingSoonPlanet({ size, active, className = "" }: { size: number; active: boolean; className?: string }) {
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 100 100" width={size} height={size} overflow="visible" className="absolute inset-0">
        <defs>
          <radialGradient id="coming-soon-body" cx="32%" cy="28%" r="80%">
            <stop offset="0%" stopColor="#2A3150" />
            <stop offset="60%" stopColor="#141A2C" />
            <stop offset="100%" stopColor="#0A0D17" />
          </radialGradient>
          <clipPath id="coming-soon-front" clipPathUnits="userSpaceOnUse">
            <rect x="-40" y="50" width="180" height="40" />
          </clipPath>
        </defs>

        {/* the orbit, drawn behind the planet and again in front of it */}
        <g transform="rotate(-16 50 50)" className="transition-opacity duration-500 motion-reduce:transition-none" style={{ opacity: active ? 1 : 0 }}>
          <ellipse cx="50" cy="50" rx={RX} ry={RY} fill="none" stroke="var(--ink-faint)" strokeOpacity="0.45" strokeWidth="0.8" strokeDasharray="2 3" />
        </g>

        <circle cx="50" cy="50" r="48" fill="url(#coming-soon-body)" />
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke={active ? "var(--ink-muted)" : "var(--ink-dim)"}
          strokeWidth="1.2"
          strokeDasharray="4 5"
          className="transition-[stroke,transform] duration-700 motion-reduce:transition-none"
          style={{ transformOrigin: "50px 50px", transform: active ? "rotate(40deg)" : "rotate(0deg)" }}
        />
        <g
          stroke={active ? "#F7B542" : "var(--ink-faint)"}
          strokeWidth="3"
          strokeLinecap="round"
          className="transition-[stroke] duration-500 motion-reduce:transition-none"
        >
          <line x1="50" y1="39" x2="50" y2="61" />
          <line x1="39" y1="50" x2="61" y2="50" />
        </g>

        <g transform="rotate(-16 50 50)" className="transition-opacity duration-500 motion-reduce:transition-none" style={{ opacity: active ? 1 : 0 }}>
          <ellipse cx="50" cy="50" rx={RX} ry={RY} fill="none" stroke="var(--ink-faint)" strokeOpacity="0.45" strokeWidth="0.8" strokeDasharray="2 3" clipPath="url(#coming-soon-front)" />
        </g>

        {UPCOMING_ROLES.map((seat, i) => {
          const [x, y] = active ? orbitPoint(ORBIT_ANGLES[i]) : queuePoint(i);
          const scale = active ? 1 : 0.58 - i * 0.07;
          return (
            <g
              key={seat.name}
              className="transition-transform duration-700 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none"
              style={{
                transform: `translate(${x}px, ${y}px) scale(${scale})`,
                transitionDelay: `${(active ? i : UPCOMING_ROLES.length - 1 - i) * 90}ms`,
              }}
            >
              <circle
                r="5.5"
                fill={seat.hue}
                className="transition-[fill-opacity] duration-700 motion-reduce:transition-none"
                style={{ fillOpacity: active ? 1 : 0.4 }}
              />
            </g>
          );
        })}
      </svg>
    </span>
  );
}
