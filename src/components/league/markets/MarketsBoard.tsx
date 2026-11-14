"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CATS, prices, type MarketCat, type OutcomeState, type PriceIndex } from "@/lib/league/marketTypes";
import { Chance, Delta, MiniBadge, Spark, type TeamLite } from "./bits";
import { PortfolioPanel } from "./PortfolioPanel";
import { usePortfolio } from "./usePortfolio";
import type { SharedState } from "@/lib/marketStore";

export type BoardOutcome = { id: string; label: string; sub?: string; team?: number; p: number; prev: number | null; state: OutcomeState };
export type BoardMarket = {
  key: string; cat: MarketCat; title: string; subtitle: string; kind: "exclusive" | "independent"; settled: boolean; status: string; closed?: boolean;
  outcomes: BoardOutcome[]; spark: (number | null)[]; count: number;
};

const ALL_PER_CAT: Partial<Record<MarketCat, number>> = { games: 4, props: 4, awards: 4, division: 4, wins: 2, leaders: 2, playoffs: 2 };

export function MarketsBoard({ slug, markets, teams, index, sinceLabel, initialCat, shared }: {
  slug: string; markets: BoardMarket[]; teams: TeamLite[]; index: PriceIndex; sinceLabel: string | null; initialCat: string; shared?: SharedState | null;
}) {
  const port = usePortfolio(slug, index, shared);
  const [cat, setCat] = useState<string>(CATS.some((c) => c.key === initialCat) ? initialCat : "all");
  const [q, setQ] = useState("");
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const pick = (c: string) => {
    setCat(c);
    const u = new URL(window.location.href);
    if (c === "all") u.searchParams.delete("cat"); else u.searchParams.set("cat", c);
    window.history.replaceState(null, "", u);
  };

  const needle = q.trim().toLowerCase();
  const shown = markets.filter((m) => (cat === "all" || m.cat === cat) && (!needle || m.title.toLowerCase().includes(needle) || m.outcomes.some((o) => o.label.toLowerCase().includes(needle) || o.sub?.toLowerCase().includes(needle))));
  const open = shown.filter((m) => !m.settled);
  const settled = shown.filter((m) => m.settled);
  const counts = new Map<string, number>(CATS.map((c) => [c.key, markets.filter((m) => m.cat === c.key && !m.settled).length]));

  // biggest movers since the last finished week (open outcomes only)
  const movers = markets
    .filter((m) => !m.settled)
    .flatMap((m) => m.outcomes.filter((o) => o.state === "open" && o.prev != null).map((o) => ({ m, o, d: Math.round(o.p * 100) - Math.round((o.prev ?? 0) * 100) })))
    .filter((x) => Math.abs(x.d) >= 3)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 6);

  const card = (m: BoardMarket) => {
    const rows = m.outcomes.slice(0, m.kind === "exclusive" ? 3 : 4);
    return (
      <article key={m.key} className={`mk-card${m.settled ? " settled" : ""}`}>
        <Link href={`/l/${slug}/markets/${m.key}`} className="mk-card-head">
          <div>
            <h3>{m.title}</h3>
            <div className="mk-card-sub">{m.subtitle}</div>
          </div>
          {!m.settled && <Spark values={m.spark} w={84} h={30} />}
        </Link>
        <ul className="mk-rows">
          {rows.map((o) => {
            const pr = prices(o);
            const team = o.team ? teamMap.get(o.team) : undefined;
            const href = (side: string) => `/l/${slug}/markets/${m.key}?o=${encodeURIComponent(o.id)}&side=${side}`;
            return (
              <li key={o.id} className={`mk-row ${o.state}`}>
                {team ? <MiniBadge team={team} size={24} /> : <span className="mk-dot" aria-hidden />}
                <span className="mk-row-label">
                  <span className="mk-row-name">{o.label}</span>
                  {o.sub && <span className="mk-row-sub">{o.sub}</span>}
                </span>
                <span className="mk-row-chance"><Chance p={o.p} state={o.state} /><Delta p={o.p} prev={o.prev} state={o.state} /></span>
                {o.state === "open" && !m.settled && !m.closed ? (
                  <span className="mk-btns">
                    <Link className="mk-btn yes" href={href("yes")} aria-label={`Buy Yes on ${o.label} at ${pr.yes}%`}>Yes {pr.yes}%</Link>
                    <Link className="mk-btn no" href={href("no")} aria-label={`Buy No on ${o.label} at ${pr.no}%`}>No {pr.no}%</Link>
                  </span>
                ) : (
                  <span className="mk-btns"><span className={`mk-result ${o.state}`}>{o.state === "won" ? "Yes ✓" : o.state === "lost" ? "No" : "Closed"}</span></span>
                )}
              </li>
            );
          })}
        </ul>
        <Link href={`/l/${slug}/markets/${m.key}`} className="mk-card-foot">
          <span>{m.count > rows.length ? `+${m.count - rows.length} more` : m.kind === "independent" ? "Each line is its own yes/no" : "One winner"}</span>
          <span className={m.settled || m.closed ? "mk-status settled" : "mk-status"}>{m.status}</span>
        </Link>
      </article>
    );
  };

  return (
    <div className="mk-layout">
      <div className="mk-main">
        <nav className="week-chips mk-cats" aria-label="Market categories">
          <a href="?" aria-current={cat === "all" ? "page" : undefined} onClick={(e) => { e.preventDefault(); pick("all"); }}>All</a>
          {CATS.filter((c) => markets.some((m) => m.cat === c.key)).map((c) => (
            <a key={c.key} href={`?cat=${c.key}`} aria-current={cat === c.key ? "page" : undefined} onClick={(e) => { e.preventDefault(); pick(c.key); }}>
              {c.label}{counts.get(c.key) ? <span className="mk-count">{counts.get(c.key)}</span> : null}
            </a>
          ))}
        </nav>
        <div className="mk-search">
          <input type="search" placeholder="Search markets, teams, players" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
        </div>

        {cat === "all" && !needle && movers.length > 0 && (
          <section className="mk-movers" aria-label="Biggest movers">
            <h3>Biggest movers{sinceLabel ? <span className="muted"> since {sinceLabel}</span> : null}</h3>
            <div className="mk-movers-row">
              {movers.map(({ m, o, d }) => (
                <Link key={m.key + o.id} href={`/l/${slug}/markets/${m.key}`} className="mk-mover">
                  {o.team ? <MiniBadge team={teamMap.get(o.team)} size={22} /> : null}
                  <span className="mk-mover-text"><strong>{o.label}</strong><span>{m.title}</span></span>
                  <span className={`mk-delta ${d > 0 ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {cat === "all" && !needle ? (
          // Front page: a few markets per category, open first, with a link to the rest.
          CATS.map((c) => {
            const list = markets.filter((m) => m.cat === c.key);
            const openList = list.filter((m) => !m.settled);
            const top = (openList.length ? openList : list).slice(0, ALL_PER_CAT[c.key] ?? 4);
            if (!top.length) return null;
            return (
              <section key={c.key} className="mk-section">
                <div className="mk-section-head">
                  <h3>{c.label}</h3>
                  {list.length > top.length && <a href={`?cat=${c.key}`} onClick={(e) => { e.preventDefault(); pick(c.key); window.scrollTo({ top: 0 }); }}>See all {list.length} →</a>}
                </div>
                <div className="mk-grid">{top.map(card)}</div>
              </section>
            );
          })
        ) : open.length > 0 ? <div className="mk-grid">{open.map(card)}</div> : !settled.length && <p className="muted">No markets match.</p>}
        {!(cat === "all" && !needle) && settled.length > 0 && (
          <section className="mk-settled">
            <h3>Settled</h3>
            <div className="mk-grid">{settled.map(card)}</div>
          </section>
        )}
      </div>
      <PortfolioPanel slug={slug} index={index} port={port} />
    </div>
  );
}
