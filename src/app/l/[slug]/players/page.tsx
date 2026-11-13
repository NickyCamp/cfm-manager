import type { Metadata } from "next";
import { getLeagueData } from "@/lib/league/load";
import { NoData } from "@/components/league/bits";
import { PlayersTable, type PlayerRow, type TeamLite } from "@/components/league/PlayersTable";

export const metadata: Metadata = { title: "Players" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

// Every player in the league in one sortable, filterable table (Nick, 2026-11-13).
// Contract info is kept to years left and this season's cap hit on purpose.
export default async function PlayersPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;

  const teams: TeamLite[] = d.teams
    .map((t) => ({ id: t.id, abbr: t.abbr, city: t.city, name: t.name, primary: t.primary }))
    .sort((a, b) => `${a.city} ${a.name}`.localeCompare(`${b.city} ${b.name}`));

  const rows: PlayerRow[] = d.players
    .filter((p) => !p.gone)
    .map((p) => ({
      id: p.id,
      n: `${p.first} ${p.last}`,
      t: p.team,
      pos: p.pos,
      age: p.age,
      ht: p.height,
      wt: p.weight,
      col: p.college || "",
      ovr: p.ovr,
      dev: p.dev,
      yp: p.yearsPro,
      yl: p.team ? p.contract.yearsLeft : 0,
      cap: p.team ? p.contract.capHit : 0,
      ps: p.ps,
      inj: p.injury > 0 || p.ir,
      dr: p.draft?.round ?? 0,
      r: p.ratings ?? [],
    }));

  const initial: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") initial[k] = v;

  return (
    <main className="page league-page">
      <div className="wrap wide">
        <h2>Players</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Every player in the league, {d.season.year} {d.season.title}. Click any column header to sort; click it again to flip the order.
        </p>
        <PlayersTable slug={slug} teams={teams} rows={rows} initial={initial} />
      </div>
    </main>
  );
}
