import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeagueData } from "@/lib/league/load";
import { CATS, marketBook, priceIndex } from "@/lib/league/markets";
import { NoData } from "@/components/league/bits";
import { CHART_COLORS, PriceChart } from "@/components/league/markets/bits";
import { MarketTrade, type TradeOutcome } from "@/components/league/markets/MarketTrade";

type Props = { params: Promise<{ slug: string; key: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, key } = await params;
  const d = await getLeagueData(slug);
  const m = d ? marketBook(d).markets.find((x) => x.key === key) : undefined;
  return { title: m ? `${m.title} · Markets` : "Markets" };
}

export default async function MarketPage({ params, searchParams }: Props) {
  const { slug, key } = await params;
  const sp = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const book = marketBook(d);
  const m = book.markets.find((x) => x.key === key);
  if (!m) notFound();

  // Hide long shots that never reached 1% (still listed in independent markets, where every line matters).
  const peak = (h: (number | null)[]) => Math.max(0, ...h.map((x) => x ?? 0));
  const shown = m.outcomes.filter((o) => m.kind === "independent" || o.state === "won" || peak(o.history) >= 0.01);
  const hidden = m.outcomes.length - shown.length;

  // Chart: up to 5 lines, the outcomes that matter most now (or that peaked highest once settled).
  const charted = [...shown]
    .sort((a, b) => (b.state === "won" ? 1 : 0) - (a.state === "won" ? 1 : 0) || b.p - a.p || peak(b.history) - peak(a.history))
    .slice(0, m.kind === "exclusive" ? 5 : 4);
  const hasChart = charted.some((o) => o.history.filter((x) => x != null).length >= 2);
  const colorOf = new Map(hasChart ? charted.map((o, i) => [o.id, CHART_COLORS[i]]) : []);
  const outcomes: TradeOutcome[] = shown.map((o) => ({ id: o.id, label: o.label, sub: o.sub, team: o.team, player: o.player, p: o.p, prev: o.prev, state: o.state, color: colorOf.get(o.id) }));
  const teams = d.teams.map((t) => ({ id: t.id, abbr: t.abbr, city: t.city, name: t.name, primary: t.primary }));
  const cat = CATS.find((c) => c.key === m.cat);

  return (
    <main className="page league-page markets-page">
      <div className="wrap wide">
        <nav className="mk-crumbs" aria-label="Breadcrumb">
          <Link href={`/l/${slug}/markets`}>Markets</Link><span aria-hidden> / </span>
          <Link href={`/l/${slug}/markets?cat=${m.cat}`}>{cat?.label}</Link>
        </nav>
        <div className="mk-detail-head">
          <div>
            <h2>{m.title}</h2>
            <p className="muted">{m.subtitle}</p>
          </div>
          <span className={m.settled ? "mk-status settled" : "mk-status"}>{m.status}</span>
        </div>

        {hasChart && <div className="panel mk-chart-panel">
          <div className="mk-legend">
            {charted.map((o) => (
              <span key={o.id}><i style={{ background: colorOf.get(o.id) }} />{o.label} <strong>{o.state === "won" ? "Won" : `${Math.round(o.p * 100)}%`}</strong></span>
            ))}
          </div>
          <PriceChart checkpoints={book.checkpoints} series={charted.map((o) => ({ label: o.label, values: o.history, color: colorOf.get(o.id)! }))} />
          <p className="hint small">Chance after each finished week{book.checkpoints.at(-1)?.label === "Now" ? ", plus now (this week's games played so far)" : ""}.</p>
        </div>}

        <MarketTrade slug={slug} mkey={m.key} title={m.title} settled={m.settled} outcomes={outcomes} hidden={hidden} teams={teams} index={priceIndex(book)} initialO={sp.o} initialSide={sp.side} />

        <section className="panel mk-rules">
          <h3>Rules</h3>
          <p>{m.rules}</p>
          {m.cat !== "props" && <details>
            <summary>How prices are set</summary>
            <p>Each team gets a strength rating from its points scored and allowed (adjusted for opponents, blowouts capped at 24) blended with its overall rating, worth about five games early in the season. The rest of the season is played out {Number(4000).toLocaleString()} times game by game, then the playoffs. Player markets project each player&apos;s season from his pace, minus weeks he&apos;s injured. A price of 63¢ means it happened in about 63% of simulated seasons.</p>
            <p>This is a game: no real money, nothing to withdraw. Your balance lives in this browser.</p>
          </details>}
        </section>
      </div>
    </main>
  );
}
