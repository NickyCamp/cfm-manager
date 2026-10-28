import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { capYears, inferredDeadCap, teamCapProjection, teamPlayers } from "@/lib/league/derive";
import { money } from "@/lib/league/format";
import { NoData, TeamBadge } from "@/components/league/bits";

export const metadata: Metadata = { title: "Cap space" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ year?: string }> };

export default async function LeagueCap({ params, searchParams }: Props) {
  const { slug } = await params;
  const { year } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const years = capYears(d);
  const pick = years.includes(Number(year)) ? Number(year) : years[0];
  if (pick !== years[0]) return <FutureCap slug={slug} d={d} years={years} pick={pick} />;
  const rows = d.teams.map((t) => {
    const roster = teamPlayers(d, t.id);
    const active = roster.filter((p) => !p.ps);
    const proj = teamCapProjection(d, t).totals[1];
    return {
      t, dead: inferredDeadCap(t, roster), next: proj,
      top: [...active].sort((a, b) => b.contract.capHit - a.contract.capHit)[0],
      expiring: active.filter((p) => p.contract.yearsLeft <= 1).reduce((a, p) => a + p.contract.capHit, 0),
    };
  }).sort((a, b) => b.t.cap.available - a.t.cap.available);
  // Scale bars to the league cap so one team with the cap switched off doesn't flatten the rest.
  const room = Math.max(...rows.map((r) => r.t.cap.room), 1);
  const max = Math.max(...rows.map((r) => Math.min(Math.abs(r.t.cap.available), room)), 1);

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Cap space by team</h2>
        <YearSwitch slug={slug} years={years} pick={pick} />
        <p className="muted">Most room first. The bar shows cap space left this season.</p>
        <div className="panel tbl-wrap">
          <table className="tbl cap-table">
            <thead>
              <tr><th>Team</th><th className="num">Space</th><th className="bar-col"><span className="sr-only">Space bar</span></th><th className="num hide-sm">Spent</th><th className="num">{d.season.year + 1} space <span className="proj">proj.</span></th><th className="num hide-sm">Dead</th><th className="num hide-sm">Expiring</th><th className="hide-sm">Biggest cap hit</th></tr>
            </thead>
            <tbody>
              {rows.map(({ t, dead, top, expiring, next }) => (
                <tr key={t.id}>
                  <td><Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}?tab=cap`}><TeamBadge team={t} size={22} />{t.name}</Link></td>
                  <td className={`num strong ${t.cap.available < 0 ? "neg" : ""}`}>{money(t.cap.available)}</td>
                  <td className="bar-col"><span className={`bar ${t.cap.available < 0 ? "neg" : ""}`} style={{ width: `${Math.min(100, (Math.abs(t.cap.available) / max) * 100)}%` }} /></td>
                  <td className="num hide-sm">{money(t.cap.spent)}</td>
                  <td className={`num ${next.space < 0 ? "neg" : ""}`}>{money(next.space)}</td>
                  <td className="num hide-sm">{money(dead)}</td>
                  <td className="num hide-sm">{money(expiring)}</td>
                  <td className="hide-sm">{top ? <Link href={`/l/${slug}/players/${top.id}`}>{top.first[0]}. {top.last}</Link> : "—"} <span className="muted">{top ? money(top.contract.capHit) : ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Dead money is the part of a team&apos;s cap spending not tied to anyone on its current roster. Expiring is this season&apos;s cap hit of deals with one year or less left. Next year&apos;s space is projected from current contracts against a cap $15M higher; each team&apos;s Cap tab shows the full breakdown.</p>
      </div>
    </main>
  );
}

function YearSwitch({ slug, years, pick }: { slug: string; years: number[]; pick: number }) {
  return (
    <nav className="seg" aria-label="Season">
      {years.map((y, i) => (
        <Link key={y} href={i === 0 ? `/l/${slug}/cap` : `/l/${slug}/cap?year=${y}`} aria-current={y === pick ? "page" : undefined}>
          {i === 0 ? `${y} now` : y}
        </Link>
      ))}
    </nav>
  );
}

function FutureCap({ slug, d, years, pick }: { slug: string; d: NonNullable<Awaited<ReturnType<typeof getLeagueData>>>; years: number[]; pick: number }) {
  const idx = years.indexOf(pick);
  const rows = d.teams.map((t) => {
    const proj = teamCapProjection(d, t);
    const top = proj.rows.filter((r) => r.hits[pick] != null).sort((a, b) => b.hits[pick] - a.hits[pick])[0];
    return { t, total: proj.totals[idx], top: top ? { p: top.p, hit: top.hits[pick] } : null };
  }).sort((a, b) => b.total.space - a.total.space);
  const cap = rows[0]?.total.cap || 0;
  const max = Math.max(...rows.map((r) => Math.min(Math.abs(r.total.space), cap)), 1);
  const avgPlayers = rows.reduce((a, r) => a + r.total.players, 0) / (rows.length || 1);
  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Cap space by team</h2>
        <YearSwitch slug={slug} years={years} pick={pick} />
        <p className="muted">
          {pick} projected from contracts on file as of this sync, against a league cap of {money(cap)}. Most room first.
          Teams average {avgPlayers.toFixed(0)} players under contract for {pick}.
        </p>
        <div className="panel tbl-wrap">
          <table className="tbl cap-table">
            <thead>
              <tr><th>Team</th><th className="num" title="Players under contract">Signed</th><th className="num">Committed</th><th className="num">Space</th><th className="bar-col hide-sm"><span className="sr-only">Space bar</span></th><th className="hide-sm">Biggest {pick} cap hit</th></tr>
            </thead>
            <tbody>
              {rows.map(({ t, total, top }) => (
                <tr key={t.id}>
                  <td><Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}?tab=cap`}><TeamBadge team={t} size={22} />{t.name}</Link></td>
                  <td className="num">{total.players}</td>
                  <td className="num">{money(total.committed)}</td>
                  <td className={`num strong ${total.space < 0 ? "neg" : ""}`}>{money(total.space)}</td>
                  <td className="bar-col hide-sm"><span className={`bar ${total.space < 0 ? "neg" : ""}`} style={{ width: `${Math.min(100, (Math.abs(total.space) / max) * 100)}%` }} /></td>
                  <td className="hide-sm">{top ? <Link href={`/l/${slug}/players/${top.p.id}`}>{top.p.first[0]}. {top.p.last}</Link> : "—"} <span className="muted">{top ? money(top.hit) : ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Each player&apos;s future cap hit comes from his current contract, using the same formula as the team Cap tab. The league cap grows
          $15M a season. Re-signings, new signings, future dead money and practice squad deals aren&apos;t included, so space shrinks as teams fill their rosters.
        </p>
      </div>
    </main>
  );
}
