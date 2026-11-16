import type { Metadata } from "next";
import { getLeagueData } from "@/lib/league/load";
import { capSeason, PROJECTION_YEARS } from "@/lib/league/derive";
import { isCapSet, leagueCap, MAX_BONUS_PRORATION_YEARS, projectedLeagueCap } from "@/lib/league/cap";
import { projectPlayer } from "@/lib/league/projection";
import { NoData } from "@/components/league/bits";
import { TradeTool, type TradePlayer, type TradeTeam } from "./TradeTool";

export const metadata: Metadata = { title: "Trade Tool" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

/**
 * Trade cap rules (Madden): the team trading a player away takes all of his
 * bonus not yet charged as dead money this season (EA's capReleasePenalty;
 * in EA's data, savings = cap hit - penalty for every player, so it all lands
 * now) and is free of him after that. The team getting him pays only his
 * salary; his bonus stays behind.
 */
export default async function TradesPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;

  const year = capSeason(d);
  const baseCap = leagueCap(d.teams);
  const years = Array.from({ length: PROJECTION_YEARS + 1 }, (_, i) => year + i);

  const players: TradePlayer[] = [];
  const committed = new Map<number, number[]>(d.teams.map((t) => [t.id, years.map(() => 0)]));
  const active = new Map<number, number>();
  for (const p of d.players) {
    if (p.gone || !p.team) continue;
    const pr = projectPlayer(p, year);
    const c = p.contract;
    if (!p.ps) {
      active.set(p.team, (active.get(p.team) || 0) + 1);
      const row = committed.get(p.team);
      if (row) years.forEach((y, i) => { if (i > 0) row[i] += (pr.hits[y] || 0) + (pr.dead[y] || 0); });
    }
    // His bonus share in each season he's signed for: the deal's bonus spread
    // over up to 5 seasons, never more than what's left to charge (the penalty
    // also covers void-year bonus after the deal ends).
    const L = Math.floor(c.length), el = L - c.yearsLeft, P = Math.min(L, MAX_BONUS_PRORATION_YEARS);
    const B = P ? c.bonus / P : 0;
    const voidLeft = years.reduce((a, y) => a + (pr.dead[y] || 0), 0);
    let left = Math.max(0, c.releasePenalty - voidLeft);
    const hits = years.map((y) => Math.round(pr.hits[y] || 0));
    const bonus = years.map((y, k) => {
      if (!pr.hits[y] || el + k >= P) return 0;
      const s = Math.min(B, hits[k], left);
      left -= s;
      return Math.round(s);
    });
    players.push({
      id: p.id, n: `${p.first} ${p.last}`, pos: p.pos, t: p.team, age: p.age, ovr: p.ovr, dev: p.dev, ps: p.ps,
      yl: c.yearsLeft, hits, bonus, dead: years.map((y) => Math.round(pr.dead[y] || 0)), pen: c.releasePenalty,
    });
  }

  const teams: TradeTeam[] = [...d.teams].sort((a, b) => a.city.localeCompare(b.city)).map((t) => {
    const row = committed.get(t.id)!;
    row[0] = t.cap.spent;
    return {
      id: t.id, abbr: t.abbr, name: `${t.city} ${t.name}`, primary: t.primary, active: active.get(t.id) || 0,
      committed: row, cap: years.map((y, i) => (i === 0 ? t.cap.room : projectedLeagueCap(baseCap, year, y, d.knownCaps))),
    };
  });

  const ids = (s?: string) => (s || "").split(",").map(Number).filter((n) => n > 0);
  const picks = (s?: string) => (s || "").split(",").map((x) => x.split("-").map(Number)).filter(([y, r]) => y > 2000 && r >= 1 && r <= 7).map(([y, r]) => ({ y, r }));
  const initial = {
    a: teams.find((t) => t.abbr === sp.a)?.id ?? null, b: teams.find((t) => t.abbr === sp.b)?.id ?? null,
    pa: ids(sp.pa), pb: ids(sp.pb), ka: picks(sp.ka), kb: picks(sp.kb),
  };

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Trade Tool</h2>
        <p className="muted" style={{ maxWidth: "68ch" }}>Pick two teams and what each one sends. Below, see what the trade does to each team&apos;s cap, year by year, dead money included.</p>
        <TradeTool slug={slug} year={year} years={years} capSet={years.map((y) => isCapSet(year, y, d.knownCaps))} players={players} teams={teams} initial={initial} />
      </div>
    </main>
  );
}
