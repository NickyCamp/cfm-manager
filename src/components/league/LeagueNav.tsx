"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Main tabs: the week-to-week league pages.
const TABS = [
  ["", "Home"],
  ["standings", "Standings"],
  ["scores", "Scores"],
  ["live", "Live"],
  ["teams", "Teams"],
  ["players", "Players"],
  ["cap", "Cap"],
  ["transactions", "Transactions"],
  ["leaders", "Leaders"],
  ["markets", "Markets"],
] as const;

// League-wide tools: shown up by the league name instead of in the main tab row.
const TOOLS = [
  ["playoffs", "Playoffs"],
  ["draft", "Draft"],
  ["dev", "Dev tracker"],
  ["abilities", "Abilities"],
  ["archetypes", "Archetype calc"],
  ["contracts", "Contract tool"],
  ["trades", "Trade Tool"],
] as const;

function useActive(slug: string) {
  const path = usePathname();
  const base = `/l/${slug}`;
  const active = (seg: string) => {
    if (!seg) return path === base;
    if (seg === "scores") return path.startsWith(`${base}/scores`) || path.startsWith(`${base}/games`);
    if (seg === "teams") return path.startsWith(`${base}/teams`) || path.startsWith(`${base}/players/`);
    if (seg === "players") return path === `${base}/players`;
    return path.startsWith(`${base}/${seg}`);
  };
  return { path, base, active };
}

export function LeagueTools({ slug, admin = false }: { slug: string; admin?: boolean }) {
  const tools = admin ? [...TOOLS, ["admin", "Admin"] as const] : TOOLS;
  const { base, active } = useActive(slug);
  return (
    <nav className="league-tools" aria-label="League tools">
      {tools.map(([seg, label]) => (
        <Link key={seg} href={`${base}/${seg}`} aria-current={active(seg) ? "page" : undefined} className={seg === "admin" ? "is-admin" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function LeagueNav({ slug }: { slug: string }) {
  const tabs = TABS;
  const { path, base, active } = useActive(slug);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const current = tabs.find(([seg]) => active(seg))?.[1]
    ?? [...TOOLS, ["admin", "Admin"] as const].find(([seg]) => active(seg))?.[1]
    ?? "Home";
  return (
    <>
      <nav className="league-nav" aria-label="League">
        {tabs.map(([seg, label]) => (
          <Link key={seg} href={seg ? `${base}/${seg}` : base} aria-current={active(seg) ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {/* Phones: one button that opens the full menu, items sliding in one after another. */}
      <button type="button" className="league-menu-btn" aria-expanded={open} aria-controls="league-menu" onClick={() => setOpen((o) => !o)}>
        <span>{current}</span><span aria-hidden className={`chev ${open ? "up" : ""}`}>▾</span>
      </button>
      <div id="league-menu" className={`league-menu ${open ? "open" : ""}`}>
        {tabs.map(([seg, label], i) => (
          <Link key={seg} href={seg ? `${base}/${seg}` : base} aria-current={active(seg) ? "page" : undefined} style={{ transitionDelay: open ? `${i * 30}ms` : "0ms" }}>
            {label}
          </Link>
        ))}
      </div>
    </>
  );
}
