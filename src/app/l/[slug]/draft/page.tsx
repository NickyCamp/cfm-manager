import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { DRAFT_GROUP, draftOrder, recText, roundOrder } from "@/lib/league/playoffs";
import { NoData, TeamBadge } from "@/components/league/bits";
import { DecryptText } from "@/components/league/DecryptText";
import { loadPickLedger } from "@/lib/league/pickLedgerLoad";
import { pickId } from "@/lib/league/picks";

export const metadata: Metadata = { title: "Draft order" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ round?: string }> };

export default async function Draft({ params, searchParams }: Props) {
  const { slug } = await params;
  const { round } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const r = Math.min(7, Math.max(1, Number(round) || 1));
  const { slots, sos, realPlayoffs, pic } = draftOrder(d);
  const rows = roundOrder(slots, r);
  const n = rows.length;
  // Who holds each pick now (the league's pick tracker), when this order is for the tracker's next draft.
  const ledger = await loadPickLedger(slug, d).catch(() => null);
  const holder = (team: number) => (ledger && ledger.firstDraft === d.season.year + 1 ? ledger.picks.get(pickId(ledger.firstDraft, r, team))?.owner ?? team : team);
  const abbrOf = new Map(d.teams.map((t) => [t.id, t.abbr]));
  const groupLabel = (g: number) => (g === 2 && !realPlayoffs ? "Playoff teams (current top 7 seeds)" : DRAFT_GROUP[g]);

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>{d.season.year + 1} Draft order</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          {realPlayoffs ? "Playoff results applied. " : pic.throughWeek ? `If the season ended today, through Week ${pic.throughWeek}. ` : ""}
          Worst record picks first, then lowest strength of schedule, then the division and conference tiebreakers, following the NFL&apos;s draft rules.
        </p>
        <nav className="week-chips" aria-label="Round">
          {[1, 2, 3, 4, 5, 6, 7].map((x) => <Link key={x} href={`/l/${slug}/draft${x > 1 ? `?round=${x}` : ""}`} aria-current={x === r ? "page" : undefined}>Round {x}</Link>)}
        </nav>
        <section className="panel tbl-wrap">
          <table className="tbl">
            <caption>Round {r}</caption>
            <thead><tr><th className="num">Pick</th><th>Team</th><th className="num">Record</th><th className="num">SOS</th><th className="hide-sm">Why here</th></tr></thead>
            <tbody>
              {rows.map((x, i) => [
                (i === 0 || rows[i - 1].group !== x.group) && <tr key={`g${x.group}`} className="po-sep"><td colSpan={5}>{groupLabel(x.group)}</td></tr>,
                <tr key={x.c.id}>
                  <td className="num strong">{(r - 1) * n + i + 1}{r > 1 && <span className="muted small"> ({r}.{String(i + 1).padStart(2, "0")})</span>}</td>
                  <td>
                    <Link className="team-link" href={`/l/${slug}/teams/${x.c.abbr.toLowerCase()}`}><TeamBadge team={x.c.team} size={22} /><span><DecryptText text={x.c.name} delay={Math.min(i, 12) * 40} /></span></Link>
                    {holder(x.c.id) !== x.c.id
                      ? <div className="small"><strong>Held by {abbrOf.get(holder(x.c.id))}</strong> <Link className="muted" href={`/l/${slug}/picks`}>(pick tracker)</Link></div>
                      : x.c.team.user && <div className="muted small">{x.c.team.user}</div>}
                  </td>
                  <td className="num">{recText(x.c.w, x.c.l, x.c.t)}</td>
                  <td className="num muted">{sos.get(x.c.id)!.toFixed(3).replace(/^0/, "")}</td>
                  <td className="hide-sm small muted po-why">{x.tied ? (r === 1 ? x.why : "Tied on record, so the order rotates each round") : ""}</td>
                </tr>,
              ])}
            </tbody>
          </table>
        </section>
        <p className="hint">
          Each pick is listed by the team it belongs to; &quot;Held by&quot; shows a traded pick&apos;s current owner from the league&apos;s <Link href={`/l/${slug}/picks`}>pick tracker</Link> (EA&apos;s export doesn&apos;t include pick trades). Compensatory picks aren&apos;t included.
          Strength of schedule uses every opponent on the regular-season schedule at their current record.
        </p>
      </div>
    </main>
  );
}
