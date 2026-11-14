import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { marketBook, priceIndex } from "@/lib/league/markets";
import { marketsForPage } from "@/lib/marketStore";
import { NoData } from "@/components/league/bits";
import { MarketsBoard, type BoardMarket } from "@/components/league/markets/MarketsBoard";

export const metadata: Metadata = { title: "Markets" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

// Kalshi-style prediction markets (Nick, 2026-11-13). Prices come from a season
// simulation (src/lib/league/markets.ts) and move with members' bets
// (src/lib/marketStore.ts). Setup for other leagues: ./setup/page.tsx.
export default async function MarketsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { book, shared } = await marketsForPage(slug, marketBook(d), d.season.year, priceIndex, d.season, d);

  const markets: BoardMarket[] = book.markets.map((m) => {
    const visible = m.outcomes.filter((o) => o.state !== "lost" || m.kind === "independent" || Math.max(...o.history.map((x) => x ?? 0)) >= 0.01);
    const lead = m.outcomes[0];
    return {
      key: m.key, cat: m.cat, title: m.title, subtitle: m.subtitle, kind: m.kind, settled: m.settled, status: m.status, closed: m.closed,
      outcomes: m.outcomes.slice(0, 4).map((o) => ({ id: o.id, label: o.label, sub: o.sub, team: o.team, p: o.p, prev: o.prev, state: o.state })),
      spark: lead ? lead.history : [],
      count: visible.length,
    };
  });
  const teams = d.teams.map((t) => ({ id: t.id, abbr: t.abbr, city: t.city, name: t.name, primary: t.primary }));

  return (
    <main className="page league-page markets-page">
      <div className="wrap wide">
        <div className="mk-hero">
          <div>
            <h2>Markets</h2>
            <p className="muted">Trade on how the {book.season} season ends. Prices start at the chance from a simulation of the rest of the season (updated after every sync){shared ? " and then move with what league members buy and sell, so getting in early gets a better price" : ""}. {shared?.currency === "tickets" ? "Bets are in league Tickets: admins add or remove results in UnbelievaBoat after each advance." : "Play money only: everyone starts with $1,000."}</p>
            <p className="small"><Link href={`/l/${slug}/markets/activity`}>Public trade log →</Link> every trade by every member, for anyone to check.</p>
          </div>
        </div>
        <MarketsBoard slug={slug} markets={markets} teams={teams} index={priceIndex(book)} sinceLabel={book.sinceLabel} initialCat={sp.cat ?? "all"} shared={shared} />
        <p className="muted small mk-setup-link">Running this in your own league&apos;s Discord? <Link href={`/l/${slug}/markets/setup`}>Setup guide</Link></p>
      </div>
    </main>
  );
}
