import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { seasonTotals } from "@/lib/league/derive";
import { NoData } from "@/components/league/bits";
import { PlayersTable, type PlayerRow, type TeamLite } from "@/components/league/PlayersTable";
import { StatsTable, type StatRow } from "@/components/league/StatsTable";

export const metadata: Metadata = { title: "Players" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

// Every player in the league (Nick, 2026-11-13). Two views:
//  - Ratings (default): bio, years left, cap hit and all 56 ratings, sortable/filterable.
//  - Stats (?view=stats): regular-season stat leaders by position, QB first.
// Contract info is kept to years left and this season's cap hit on purpose.
export default async function PlayersPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const view = sp.view === "stats" ? "stats" : "ratings";

  const teams: TeamLite[] = d.teams
    .map((t) => ({ id: t.id, abbr: t.abbr, city: t.city, name: t.name, primary: t.primary }))
    .sort((a, b) => `${a.city} ${a.name}`.localeCompare(`${b.city} ${b.name}`));

  const initial: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "view") initial[k] = v;

  let body: React.ReactNode;
  if (view === "ratings") {
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
    body = <PlayersTable slug={slug} teams={teams} rows={rows} initial={initial} />;
  } else {
    const ps = new Map(d.players.map((p) => [p.id, p]));
    const rows: StatRow[] = [];
    for (const [id, t] of seasonTotals(d)) {
      const p = ps.get(id);
      if (!p) continue;
      const { team, ...s } = t;
      rows.push({ id, n: `${p.first} ${p.last}`, pos: p.pos, age: p.age, ovr: p.ovr, t: p.gone ? team : p.team || team, gone: Boolean(p.gone), s });
    }
    body = <StatsTable slug={slug} teams={teams} rows={rows} initial={initial} />;
  }

  return (
    <main className="page league-page">
      <div className="wrap wide">
        <h2>Players</h2>
        <nav className="tabs pl-view-tabs" aria-label="Players view">
          <Link href={`/l/${slug}/players`} aria-current={view === "ratings" ? "page" : undefined}>Ratings &amp; bio</Link>
          <Link href={`/l/${slug}/players?view=stats`} aria-current={view === "stats" ? "page" : undefined}>Season stats</Link>
        </nav>
        <p className="muted" style={{ maxWidth: "72ch" }}>
          {view === "ratings"
            ? <>Every player in the league, {d.season.year} {d.season.title}. Click any column header to sort; click it again to flip the order.</>
            : <>{d.season.year} regular-season stat leaders by position, through {d.season.title}. Click any column header to sort.</>}
        </p>
        {body}
      </div>
    </main>
  );
}
