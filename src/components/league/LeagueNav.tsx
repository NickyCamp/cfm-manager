"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["", "Home"],
  ["standings", "Standings"],
  ["scores", "Scores"],
  ["teams", "Teams"],
  ["cap", "Cap"],
  ["contracts", "Contract tool"],
  ["dev", "Dev tracker"],
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
  return (
    <nav className="league-nav" aria-label="League">
      {TABS.map(([seg, label]) => (
        <Link key={seg} href={seg ? `${base}/${seg}` : base} aria-current={active(seg) ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
