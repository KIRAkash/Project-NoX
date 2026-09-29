import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-void px-4 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">404 · off the map</p>
      <h1 className="mt-3 text-[26px] text-ink">Nothing orbits here.</h1>
      <Link href="/" className="mt-6 rounded-full border border-[rgba(247,181,66,.45)] px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-nox hover:border-nox">
        Back to NoX
      </Link>
    </main>
  );
}
