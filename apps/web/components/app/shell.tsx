"use client";

import { Bell, Command, LogOut, Repeat, Search, SquareTerminal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/app/auth";
import { navFor } from "@/lib/app/nav";
import { ROLE_BY_ID, type RoleDef } from "@/lib/app/roles";
import { useApi } from "@/lib/app/use-api";

import { Planet } from "./planet";
import { NoxMark } from "./nox-mark";
import { ToastProvider, usePopover } from "./ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  if (!me?.role) return null;
  const role = ROLE_BY_ID[me.role];
  return (
    <ToastProvider>
      {/* `data-seat` picks the seat's texture in globals.css: warm and airy, board, blueprint or terminal. */}
      <div data-seat={role.id} className="seat-shell min-h-screen lg:pl-[232px]" style={{ ["--role" as string]: role.hue }}>
        <Sidebar role={role} />
        <div className="flex min-h-screen flex-col">
          <DemoRibbon />
          <TopBar role={role} />
          <main className="seat-main relative flex-1 px-4 pb-28 pt-6 sm:px-8 lg:pb-12">{children}</main>
        </div>
        <BottomNav role={role} />
      </div>
    </ToastProvider>
  );
}

function useActive(role: RoleDef) {
  const pathname = usePathname();
  return (path: string) => {
    const full = `/app${path}`;
    return path === "" ? pathname === full : pathname.startsWith(full);
  };
}

function Sidebar({ role }: { role: RoleDef }) {
  const isActive = useActive(role);
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-hairline bg-[#07080f] lg:flex">
      <Link href="/app" className="flex h-[72px] flex-col justify-center px-6">
        <NoxMark size={22} />
        <span className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: role.hue }}>
          {role.desk}
        </span>
      </Link>
      <nav aria-label="Main" className="mt-4 flex flex-col gap-1 px-3">
        {navFor(role.id).map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={`/app${item.path}`}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-10 items-center gap-3 rounded-sm px-3 text-[14px] transition ${
                active ? "bg-[rgba(143,160,204,.08)] text-ink" : "text-ink-muted hover:bg-[rgba(143,160,204,.05)] hover:text-ink"
              }`}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full" style={{ background: role.hue }} />}
              <Icon size={17} strokeWidth={1.6} style={active ? { color: role.hue } : undefined} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-6 pb-6">
        <Link href="/choose-role" className="flex items-center gap-3 rounded-md border border-hairline p-3 hover:border-[rgba(143,160,204,.3)]">
          <Planet role={role} size={28} />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium" style={{ color: role.hue }}>
              {role.name}
            </span>
            <span className="block text-[11px] text-ink-faint">Switch role</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

function BottomNav({ role }: { role: RoleDef }) {
  const isActive = useActive(role);
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-hairline bg-[#07080f] lg:hidden">
      {navFor(role.id).map((item) => {
        const active = isActive(item.path);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={`/app${item.path}`}
            aria-current={active ? "page" : undefined}
            className="flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 text-[10.5px]"
            style={{ color: active ? role.hue : "#7C86A3" }}
          >
            <Icon size={18} strokeWidth={1.6} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// The seat is already named in the sidebar, so the ribbon only says this is a demo.
function DemoRibbon() {
  return (
    <div className="flex h-7 items-center justify-center gap-2 border-b border-hairline bg-[rgba(247,181,66,.05)] font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">
      <span className="text-nox">Demo mode</span>
      <span aria-hidden>·</span>
      <span>Sample data</span>
    </div>
  );
}

function TopBar({ role }: { role: RoleDef }) {
  const { me, signOut } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const bell = usePopover();
  const avatar = usePopover();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const initials = (me?.name || me?.email || "?").slice(0, 1).toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-hairline bg-[rgba(5,6,11,.82)] px-4 backdrop-blur sm:px-8">
      <Link href="/app" className="lg:hidden" aria-label="Home">
        <NoxMark size={19} />
      </Link>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="ml-auto flex h-9 items-center gap-2 rounded-sm border border-hairline px-3 text-[13px] text-ink-faint hover:border-[rgba(143,160,204,.3)] hover:text-ink-muted lg:ml-0 lg:w-[320px]"
      >
        <Search size={15} />
        <span className="hidden sm:inline">Search NoX</span>
        <span className={`ml-auto hidden items-center gap-0.5 font-mono text-[11px] ${role.id === "business" ? "" : "sm:flex"}`}>
          <Command size={11} />K
        </span>
      </button>

      <span className="hidden flex-1 lg:block" aria-hidden />

      {role.id === "developer" && <CliPill />}

      {/* On desktop the sidebar's seat card already names the seat and switches it. */}
      <Link
        href="/choose-role"
        className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium sm:flex lg:hidden"
        style={{ borderColor: `${role.hue}55`, color: role.hue }}
        title="Switch role"
      >
        <Planet role={role} size={16} />
        {role.name}
      </Link>

      <div className="relative" data-popover>
        <button type="button" onClick={bell.toggle} aria-label="Notifications" aria-expanded={bell.open} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-[rgba(143,160,204,.08)] hover:text-ink">
          <Bell size={17} strokeWidth={1.6} />
        </button>
        {bell.open && (
          <div className="absolute right-0 top-11 w-[280px] rounded-md border border-hairline bg-deck p-4 text-[13px] text-ink-faint shadow-xl">
            Nothing handed to you yet. Handoffs addressed to the {role.name} seat land here.
          </div>
        )}
      </div>

      <div className="relative" data-popover>
        <button
          type="button"
          onClick={avatar.toggle}
          aria-label="Account menu"
          aria-expanded={avatar.open}
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border text-[13px] font-semibold text-ink"
          style={{ borderColor: role.hue }}
        >
          {me?.photoUrl ? <img src={me.photoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : initials}
        </button>
        {avatar.open && (
          <div className="absolute right-0 top-11 w-[220px] overflow-hidden rounded-md border border-hairline bg-deck text-[13px] shadow-xl">
            <div className="border-b border-hairline px-4 py-3">
              <div className="truncate text-ink">{me?.name}</div>
              <div className="truncate text-ink-faint">{me?.email}</div>
            </div>
            <Link href="/choose-role" className="flex items-center gap-2 px-4 py-2.5 text-ink-muted hover:bg-[rgba(143,160,204,.06)] hover:text-ink">
              <Repeat size={14} /> Switch role
            </Link>
            <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-ink-muted hover:bg-[rgba(143,160,204,.06)] hover:text-ink">
              <LogOut size={14} /> Sign out
            </button>
          </div>
        )}
      </div>

      {paletteOpen && <CommandPalette role={role} onClose={() => setPaletteOpen(false)} />}
    </header>
  );
}

/** The developer's top bar shows whether the `nox` CLI has signed in, and links to setting it up. */
function CliPill() {
  const { data } = useApi<{ id: string; lastUsedAt: string | null }[]>("/api/v1/me/tokens");
  const connected = Boolean(data?.length);
  return (
    <Link
      href="/app/cli"
      className="hidden items-center gap-2 rounded-sm border border-hairline px-2.5 py-1.5 font-mono text-[11.5px] text-ink-muted hover:text-ink md:flex"
      title={connected ? "The nox CLI is signed in" : "Set up the nox CLI"}
    >
      <SquareTerminal size={14} />
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: connected ? "#5FD29F" : "#6E7793" }} />
      {connected ? "cli connected" : "cli not set up"}
    </Link>
  );
}

function CommandPalette({ role, onClose }: { role: RoleDef; onClose: () => void }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const all = [
      ...navFor(role.id).map((n) => ({ label: `Go to ${n.label}`, run: () => router.push(`/app${n.path}`) })),
      { label: "Switch role", run: () => router.push("/choose-role") },
      { label: "Sign out", run: () => void signOut() },
    ];
    return all.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  }, [q, role.id, router, signOut]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIndex(0), [q]);

  const choose = (i: number) => {
    items[i]?.run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(5,6,11,.7)] px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-label="Search" className="w-full max-w-[520px] overflow-hidden rounded-md border border-hairline bg-deck shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, items.length - 1));
            if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
            if (e.key === "Enter") choose(index);
          }}
          placeholder="Search pages and actions…"
          className="h-12 w-full border-b border-hairline bg-transparent px-4 text-[14px] text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
        />
        <ul className="max-h-[320px] overflow-y-auto py-1" role="listbox">
          {items.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-faint">No matches.</li>}
          {items.map((item, i) => (
            <li key={item.label} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
                className="w-full px-4 py-2.5 text-left text-[13px]"
                style={{ background: i === index ? "rgba(143,160,204,.08)" : undefined, color: i === index ? role.hue : "#A6AEC7" }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
