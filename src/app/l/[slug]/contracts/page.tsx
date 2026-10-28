import type { Metadata } from "next";
import { getLeagueData } from "@/lib/league/load";
import { leagueCap, projectContract, projectedLeagueCap } from "@/lib/league/cap";
import { NoData } from "@/components/league/bits";
import { ContractTool, type ToolPlayer, type ToolTeam } from "./ContractTool";

export const metadata: Metadata = { title: "Contract tool" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ player?: string }> };

const YEARS_AHEAD = 12; // long enough for a 7-year deal plus void years starting a few seasons out

export default async function ContractsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { player } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;

  const year = d.season.year;
  const baseCap = leagueCap(d.teams);
  const years = Array.from({ length: YEARS_AHEAD + 1 }, (_, i) => year + i);

  const players: ToolPlayer[] = d.players.filter((p) => !p.gone).map((p) => ({
    id: p.id, n: `${p.first} ${p.last}`, pos: p.pos, t: p.team, age: p.age, ovr: p.ovr, dev: p.dev, ps: p.ps,
    c: [p.contract.length, p.contract.yearsLeft, p.contract.salary, p.contract.bonus, p.contract.capHit],
  }));

  // Every team's committed cap by year from current contracts (practice squad left out).
  const committed = new Map<number, number[]>(d.teams.map((t) => [t.id, years.map(() => 0)]));
  for (const p of d.players) {
    if (p.gone || !p.team || p.ps) continue;
    const hits = projectContract(p.contract, year);
    const row = committed.get(p.team);
    if (!row) continue;
    years.forEach((y, i) => { if (i > 0) row[i] += hits[y] || 0; });
  }
  const teams: ToolTeam[] = [...d.teams].sort((a, b) => a.city.localeCompare(b.city)).map((t) => {
    const row = committed.get(t.id)!;
    row[0] = t.cap.spent;
    return {
      id: t.id, abbr: t.abbr, name: `${t.city} ${t.name}`, primary: t.primary,
      committed: row, cap: years.map((y, i) => (i === 0 ? t.cap.room : projectedLeagueCap(baseCap, year, y))),
    };
  });

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Contract tool</h2>
        <p className="muted" style={{ maxWidth: "68ch" }}>Look up any player&apos;s deal year by year, build an offer, and see what it does to a team&apos;s cap.</p>
        <ContractTool slug={slug} year={year} years={years} players={players} teams={teams} initialPlayer={player ? Number(player) : null} />
      </div>
    </main>
  );
}
