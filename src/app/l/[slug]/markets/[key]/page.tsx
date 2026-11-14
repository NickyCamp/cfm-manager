import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeagueData } from "@/lib/league/load";
import { CATS, marketBook, priceIndex } from "@/lib/league/markets";
import { auditTrades, closeLog, fmtET, marketsForPage, priceHistory, type AuditRow, type CloseRow, type PricePoint } from "@/lib/marketStore";
import { KickoffForm } from "@/components/league/markets/KickoffForm";
import { AuditTable } from "@/components/league/markets/AuditTable";
import { NoData } from "@/components/league/bits";
import { CHART_COLORS, PriceChart, TimeChart } from "@/components/league/markets/bits";
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
  const { book, shared, leagueId, bookKey } = await marketsForPage(slug, marketBook(d), d.season.year, priceIndex, d.season, d);
  const m = book.markets.find((x) => x.key === key);
  if (!m) notFound();
  let trades: AuditRow[] = [];
  let closes: CloseRow[] = [];
  let points: PricePoint[] = [];
  if (leagueId) [trades, closes, points] = await Promise.all([
    auditTrades(leagueId, bookKey, { market: m.key, limit: 50 }).catch(() => []),
    m.gameId ? closeLog(leagueId, d.season.year, m.gameId).catch(() => []) : Promise.resolve([]),
    m.gameId ? Promise.resolve([]) : priceHistory(leagueId, bookKey, m.key).catch(() => []),
  ]);
  const kickoff = shared && m.gameId && !m.settled ? (
    <div className="panel mk-ticket">
      <h3>Kickoff</h3>
      <KickoffForm slug={slug} gameId={m.gameId} current={closes[0] ? fmtET(closes[0].closeAt) : null} canSet={shared.member} why={shared.signedIn ? "Only league members can set the kickoff." : "Sign in as a league member to set the kickoff."} />
      {closes.length > 0 && (
        <details className="mk-fills">
          <summary>Kickoff changes ({closes.length})</summary>
          <ul>{closes.map((c) => <li key={c.id}><span>{fmtET(c.closeAt)}</span><span className="muted">{c.by} via {c.kind === "discord" ? "Discord" : "site"}, {fmtET(c.at)}</span></li>)}</ul>
        </details>
      )}
    </div>
  ) : null;

  // Hide long shots that never reached 1% (still listed in independent markets, where every line matters).
  const peak = (h: (number | null)[]) => Math.max(0, ...h.map((x) => x ?? 0));
  const shown = m.outcomes.filter((o) => m.kind === "independent" || o.state === "won" || peak(o.history) >= 0.01);
  const hidden = m.outcomes.length - shown.length;

  // Chart: up to 5 lines, the outcomes that matter most now (or that peaked highest once settled).
  const charted = [...shown]
    .sort((a, b) => (b.state === "won" ? 1 : 0) - (a.state === "won" ? 1 : 0) || b.p - a.p || peak(b.history) - peak(a.history))
    .slice(0, m.kind === "exclusive" ? 5 : 4);
  const hasWeekly = charted.some((o) => o.history.filter((x) => x != null).length >= 2);
  // Market price over time (season-long markets): every recorded move, then the price right now.
  const now = Date.now();
  const times = [...points.map((p) => Date.parse(p.at)), now];
  const hasLive = points.length >= 2;
  const liveSeries = (o: (typeof charted)[number]) => [...points.map((p) => p.prices[o.id] ?? null), o.state === "won" ? 1 : o.state === "lost" ? 0 : o.p];
  const bets = points.filter((p) => p.cause === "bet").length;
  const hasChart = hasWeekly || hasLive;
  const colorOf = new Map(hasChart ? charted.map((o, i) => [o.id, CHART_COLORS[i]]) : []);
  const outcomes: TradeOutcome[] = shown.map((o) => ({ id: o.id, label: o.label, sub: o.sub, team: o.team, player: o.player, p: o.p, prev: o.prev, state: o.state, color: colorOf.get(o.id), model: o.model, net: o.net }));
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
          <span className={m.settled || m.closed ? "mk-status settled" : "mk-status"}>{m.status}</span>
        </div>

        {hasChart && <div className="panel mk-chart-panel">
          <div className="mk-legend">
            {charted.map((o) => (
              <span key={o.id}><i style={{ background: colorOf.get(o.id) }} />{o.label} <strong>{o.state === "won" ? "Won" : `${Math.round(o.p * 100)}%`}</strong></span>
            ))}
          </div>
          {hasLive ? <>
            <TimeChart times={times} series={charted.map((o) => ({ label: o.label, values: liveSeries(o), color: colorOf.get(o.id)! }))} />
            <p className="hint small">Market price since {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(times[0])}: moves with every bet{bets ? ` (${bets} so far)` : ""} and each weekly sync.</p>
            {hasWeekly && <details className="mk-fills">
              <summary>Model&apos;s chance by week</summary>
              <PriceChart checkpoints={book.checkpoints} series={charted.map((o) => ({ label: o.label, values: o.history, color: colorOf.get(o.id)! }))} />
            </details>}
          </> : <>
            <PriceChart checkpoints={book.checkpoints} series={charted.map((o) => ({ label: o.label, values: o.history, color: colorOf.get(o.id)! }))} />
            <p className="hint small">Chance after each finished week{book.checkpoints.at(-1)?.label === "Now" ? ", plus now (this week's games played so far)" : ""}. From here on the chart also follows the market price as bets come in.</p>
          </>}
        </div>}

        <MarketTrade slug={slug} mkey={m.key} title={m.title} settled={m.settled} closed={m.closed} kickoff={kickoff} outcomes={outcomes} hidden={hidden} teams={teams} index={priceIndex(book)} initialO={sp.o} initialSide={sp.side} shared={shared} />

        {shared && (
          <section className="panel mk-audit-panel">
            <div className="mk-section-head"><h3>Trades in this market</h3><Link href={`/l/${slug}/markets/activity?market=${encodeURIComponent(m.key)}`}>Full log →</Link></div>
            {trades.length ? <AuditTable slug={slug} rows={trades} index={priceIndex(book)} showMarket={false} currency={shared.currency} /> : <p className="muted">No trades yet. Every trade shows here, publicly.</p>}
          </section>
        )}

        <section className="panel mk-rules">
          <h3>Rules</h3>
          <p>{m.rules}</p>
          {m.cat !== "props" && <details>
            <summary>How prices are set</summary>
            <p>Each team gets a strength rating from its points scored and allowed (adjusted for opponents, blowouts capped at 24) blended with its overall rating, worth about five games early in the season. The rest of the season is played out {Number(4000).toLocaleString()} times game by game, then the playoffs. Player markets project each player&apos;s season from his pace, minus weeks he&apos;s injured. A price of 63¢ means it happened in about 63% of simulated seasons.</p>
            <p>Then bets move it, until the market closes: buying Yes pushes the price up, buying No pushes it down, so early bets get the better price. {m.kind === "exclusive" ? "Here only one outcome can win, so the prices are linked: money on one pushes all the others down, and they always add up to 100¢." : m.key.startsWith("props-") ? "Each line is a yes/no, but a player's lines for the same stat are linked: money on 300+ also moves 250+ and 350+, and a higher line is never priced above a lower one." : "Each line here is its own yes/no."}</p>
            <p>This is a game: no real money, nothing to withdraw. Your balance lives in this browser.</p>
          </details>}
        </section>
      </div>
    </main>
  );
}
