// Scrolling score ticker for the league home page: latest finals, then this
// week's games still to play, then the season leaders. Pure CSS animation
// (the list is rendered twice so the loop is seamless); pauses on hover/focus.
import Link from "next/link";
import type { Game, LeagueData, Team } from "@/lib/league/types";
import { leaders, weekTitle } from "@/lib/league/derive";

type Item = { key: string; href?: string; label: React.ReactNode };

export function Ticker({ d, slug, teams }: { d: LeagueData; slug: string; teams: Map<number, Team> }) {
  const played = d.games.filter((g) => g.final && (g.home || g.away))
    .sort((a, b) => b.stage - a.stage || b.week - a.week).slice(0, 16);
  const upcoming = d.games.filter((g) => g.stage === d.season.stage && g.week === d.season.week && !g.final && g.home && g.away);
  const ab = (id: number) => teams.get(id)?.abbr ?? "TBD";
  const score = (g: Game) => {
    const homeWon = g.hs > g.as;
    return <><span className={homeWon ? "lost" : "won"}>{ab(g.away)} {g.as}</span> <span className={homeWon ? "won" : "lost"}>{ab(g.home)} {g.hs}</span><span className="tk-tag">Final</span></>;
  };
  const items: Item[] = [
    ...played.map((g) => ({ key: `f${g.id}`, href: `/l/${slug}/games/${g.id}`, label: score(g) })),
    ...upcoming.map((g) => ({ key: `u${g.id}`, label: <>{ab(g.away)} at {ab(g.home)}<span className="tk-tag">{weekTitle(d, g.stage, g.week)}</span></> })),
    ...leaders(d, 1).filter((c) => ["py", "ry", "rcy", "sk", "int"].includes(c.key) && c.rows[0]?.player).map((c) => {
      const r = c.rows[0] as typeof c.rows[0] & { player: NonNullable<(typeof c.rows)[0]["player"]> };
      return { key: `l${c.key}`, href: `/l/${slug}/players/${r.player.id}`, label: <><span className="tk-tag lead">{c.label} leader</span>{r.player.first[0]}. {r.player.last} {r.value}</> };
    }),
  ];
  if (items.length < 3) return null;
  const secs = Math.max(30, items.length * 4);
  const row = (copy: number) => items.map((it) => (
    <li key={`${copy}-${it.key}`} aria-hidden={copy === 1 || undefined}>
      {it.href ? <Link href={it.href} tabIndex={copy === 1 ? -1 : undefined}>{it.label}</Link> : <span>{it.label}</span>}
    </li>
  ));
  return (
    <div className="ticker" aria-label="Latest scores and leaders">
      <span className="ticker-badge">Live wire</span>
      <div className="ticker-viewport">
        <ul className="ticker-track" style={{ animationDuration: `${secs}s` }}>{row(0)}{row(1)}</ul>
      </div>
    </div>
  );
}
