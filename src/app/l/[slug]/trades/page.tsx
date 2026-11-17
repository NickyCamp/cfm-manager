import type { Metadata } from "next";
import { getLeagueData } from "@/lib/league/load";
import { buildTradeData, parseTrade } from "@/lib/league/tradeData";
import { NoData } from "@/components/league/bits";
import { TradeTool } from "./TradeTool";

export const metadata: Metadata = { title: "Trade Tool" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

/**
 * Trade cap rules (Madden): the team trading a player away takes all of his
 * bonus not yet charged as dead money this season (EA's capReleasePenalty;
 * in EA's data, savings = cap hit - penalty for every player, so it all lands
 * now) and is free of him after that. The team getting him pays only his
 * salary; his bonus stays behind. The math lives in lib/league/tradeMath.ts,
 * shared with the Discord trade proposal.
 */
export default async function TradesPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const td = buildTradeData(d);
  const { a, b } = parseTrade(td, sp);
  const initial = { a: a.team, b: b.team, pa: a.players, pb: b.players, ka: a.picks, kb: b.picks };

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Trade Tool</h2>
        <p className="muted" style={{ maxWidth: "68ch" }}>
          Pick two teams and what each one sends. Below, see what the trade does to each team&apos;s cap, year by year, dead money included,
          and a trade score built for a user league. Once both sides agree, submit it to post the proposal in the league&apos;s Discord.
        </p>
        <TradeTool slug={slug} year={td.year} firstDraft={td.firstDraft} orderFinal={td.orderFinal} draftYears={td.draftYears} years={td.years} capSet={td.capSet} players={td.players} teams={td.teams} initial={initial} />
      </div>
    </main>
  );
}
