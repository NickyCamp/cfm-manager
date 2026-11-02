"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  ["", "Home"],
  ["standings", "Standings"],
  ["playoffs", "Playoffs"],
  ["scores", "Scores"],
  ["teams", "Teams"],
  ["cap", "Cap"],
  ["contracts", "Contract tool"],
  ["draft", "Draft"],
  ["dev", "Dev tracker"],
  ["abilities", "Abilities"],
  ["leaders", "Leaders"],
] as const;

export function LeagueNav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/l/${slug}`;
  const active = (seg: string) => {
    if (!seg) return path === base;
    if (seg === "scores") return path.startsWith(`${base}/scores`) || path.startsWith(`${base}/games`);
    if (seg === "teams") return path.startsWith(`${base}/teams`) || path.startsWith(`${base}/players`);
    return path.startsWith(`${base}/${seg}`);
  };
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const current = TABS.find(([seg]) => active(seg))?.[1] ?? "Home";
  return (
    <>
      <nav className="league-nav" aria-label="League">
        {TABS.map(([seg, label]) => (
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
        {TABS.map(([seg, label], i) => (
          <Link key={seg} href={seg ? `${base}/${seg}` : base} aria-current={active(seg) ? "page" : undefined} style={{ transitionDelay: open ? `${i * 30}ms` : "0ms" }}>
            {label}
          </Link>
        ))}
      </div>
    </>
  );
}
