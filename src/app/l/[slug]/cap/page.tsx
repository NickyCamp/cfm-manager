import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { inferredDeadCap, teamPlayers } from "@/lib/league/derive";
import { money } from "@/lib/league/format";
import { NoData, TeamBadge } from "@/components/league/bits";

export const metadata: Metadata = { title: "Cap space" };
type Props = { params: Promise<{ slug: string }> };

export default async function LeagueCap({ params }: Props) {
  const { slug } = await params;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const rows = d.teams.map((t) => {
    const roster = teamPlayers(d, t.id);
    const active = roster.filter((p) => !p.ps);
    return {
      t, dead: inferredDeadCap(t, roster),
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
        <p className="muted">Most room first. The bar shows cap space left this season.</p>
        <div className="panel tbl-wrap">
          <table className="tbl cap-table">
            <thead>
              <tr><th>Team</th><th className="num">Space</th><th className="bar-col"><span className="sr-only">Space bar</span></th><th className="num">Spent</th><th className="num hide-sm">Dead</th><th className="num hide-sm">Expiring</th><th className="hide-sm">Biggest cap hit</th></tr>
            </thead>
            <tbody>
              {rows.map(({ t, dead, top, expiring }) => (
                <tr key={t.id}>
                  <td><Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}?tab=cap`}><TeamBadge team={t} size={22} />{t.name}</Link></td>
                  <td className={`num strong ${t.cap.available < 0 ? "neg" : ""}`}>{money(t.cap.available)}</td>
                  <td className="bar-col"><span className={`bar ${t.cap.available < 0 ? "neg" : ""}`} style={{ width: `${Math.min(100, (Math.abs(t.cap.available) / max) * 100)}%` }} /></td>
                  <td className="num">{money(t.cap.spent)}</td>
                  <td className="num hide-sm">{money(dead)}</td>
                  <td className="num hide-sm">{money(expiring)}</td>
                  <td className="hide-sm">{top ? <Link href={`/l/${slug}/players/${top.id}`}>{top.first[0]}. {top.last}</Link> : "—"} <span className="muted">{top ? money(top.contract.capHit) : ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Dead money is the part of a team&apos;s cap spending not tied to anyone on its current roster. Expiring is this season&apos;s cap hit of deals with one year or less left.</p>
      </div>
    </main>
  );
}
