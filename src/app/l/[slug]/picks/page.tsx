import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData, getLeagueHistory } from "@/lib/league/load";
import { leagueBySlug } from "@/lib/discord/links";
import { isCommissioner, viewer } from "@/lib/marketStore";
import { buildPickLedger, picksGone, PICK_ROUNDS, teamPicks, type LedgerPick, type PickMove, type PickStep } from "@/lib/league/picks";
import type { TradePicks } from "@/lib/league/history";
import type { Team } from "@/lib/league/types";
import { NoData, TeamBadge } from "@/components/league/bits";
import { PickMovesEditor } from "@/components/league/PickMovesEditor";

export const metadata: Metadata = { title: "Draft picks" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ team?: string }> };

const ROUND = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
const SRC: Record<PickStep["src"], string> = { mymadden: "MyMadden log", trade: "Synced trade", proposal: "Approved trade (picks only)", manual: "Recorded by a commissioner" };

/** Who owns which draft pick (Nick, 2026-11-18). EA's export has no pick list; see lib/league/picks.ts. */
export default async function DraftPicks({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const [d, hist, lg, v] = await Promise.all([getLeagueData(slug), getLeagueHistory(slug).catch(() => null), leagueBySlug(slug).catch(() => null), viewer(slug).catch(() => null)]);
  if (!d) return <NoData />;
  const commish = Boolean(v?.leagueId && v.userId && (await isCommissioner(v.leagueId, v.userId).catch(() => false)));
  const s = lg?.settings || {};
  const moves = (s.pickMoves as PickMove[] | undefined) || [];
  const l = buildPickLedger({ d, events: hist?.events || [], tradePicks: (s.tradePicks as TradePicks | undefined) || {}, moves });
  const byId = new Map(d.teams.map((t) => [t.id, t]));
  const abbr = (id: number) => byId.get(id)?.abbr || "?";
  const focus = sp.team ? d.teams.find((t) => t.abbr.toLowerCase() === sp.team!.toLowerCase()) : undefined;
  const teams = [...d.teams].sort((a, b) => `${a.city} ${a.name}`.localeCompare(`${b.city} ${b.name}`)).filter((t) => !focus || t.id === focus.id);

  // Every recorded pick move, newest first.
  const log = [...l.picks.values()].flatMap((p) => p.trail.map((st) => ({ p, st })))
    .sort((a, b) => (Date.parse(b.st.at || "") || 0) - (Date.parse(a.st.at || "") || 0) || (b.st.wk ? b.st.wk.year * 1e4 + b.st.wk.stage * 100 + b.st.wk.week : 0) - (a.st.wk ? a.st.wk.year * 1e4 + a.st.wk.stage * 100 + a.st.wk.week : 0));
  const traded = [...l.picks.values()].filter((p) => l.years.includes(p.y) && p.owner !== p.o).length;

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Draft picks</h2>
        <p className="muted" style={{ maxWidth: "72ch" }}>
          Who holds every pick in the next {l.years.length} drafts ({l.years.join(", ")}). Madden doesn&apos;t export pick trades, so the site tracks them:
          picks from trades the admins approved move when the trade shows up in a sync, approved picks-only trades move when they&apos;re approved,
          and a commissioner can record or fix anything else here. {traded ? `${traded} pick${traded === 1 ? "" : "s"} currently with another team.` : "No picks have changed hands yet."}
        </p>

        <nav className="week-chips" aria-label="Team">
          <Link href={`/l/${slug}/picks`} aria-current={!focus ? "page" : undefined}>All teams</Link>
          {[...d.teams].sort((a, b) => a.abbr.localeCompare(b.abbr)).map((t) => (
            <Link key={t.id} href={`/l/${slug}/picks?team=${t.abbr.toLowerCase()}`} aria-current={focus?.id === t.id ? "page" : undefined}>{t.abbr}</Link>
          ))}
        </nav>

        {l.notes.length > 0 && (
          <section className="panel" style={{ borderLeft: "4px solid var(--warn, #c77700)" }}>
            <h3 style={{ marginTop: 0 }}>Check these</h3>
            <ul className="small">{l.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </section>
        )}

        <section className="panel tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Team</th>{l.years.map((y) => <th key={y}>{y} draft</th>)}<th className="num">Picks</th></tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const held = teamPicks(l, t.id);
                const gone = picksGone(l, t.id);
                return (
                  <tr key={t.id}>
                    <td>
                      <Link className="team-link" href={`/l/${slug}/picks?team=${t.abbr.toLowerCase()}`}><TeamBadge team={t} size={22} /><span>{t.abbr}</span></Link>
                      {t.user && <div className="muted small">{t.user}</div>}
                    </td>
                    {l.years.map((y) => <td key={y} className="small"><YearCell y={y} team={t} held={held} gone={gone} abbr={abbr} /></td>)}
                    <td className="num strong">{held.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <p className="hint">Rounds listed are the picks the team holds. <strong>+2 PHI</strong> = it has Philadelphia&apos;s 2nd. <s>4</s> → BUF = its own 4th is with Buffalo.</p>

        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Pick trades{focus ? ` involving ${focus.abbr}` : ""}</h3>
          {(() => {
            const rows = log.filter(({ st }) => !focus || st.from === focus.id || st.to === focus.id);
            if (!rows.length) return <p className="muted small">None recorded yet.</p>;
            return (
              <table className="tbl">
                <thead><tr><th>When</th><th>Pick</th><th>From → To</th><th className="hide-sm">How it was recorded</th></tr></thead>
                <tbody>
                  {rows.slice(0, 200).map(({ p, st }, i) => (
                    <tr key={i}>
                      <td className="small muted">{st.at ? new Date(st.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : ""}{st.wk ? `${st.at ? " · " : ""}${st.wk.year} ${st.wk.title}` : ""}</td>
                      <td><strong>{p.y} {ROUND[p.r]}</strong> <span className="muted small">({abbr(p.o)}&apos;s{p.n ? `, #${p.n}` : ""})</span></td>
                      <td>{abbr(st.from)} → <strong>{abbr(st.to)}</strong></td>
                      <td className="hide-sm small muted">{SRC[st.src]}{st.src === "manual" && st.text.includes("(") ? `: ${st.text.slice(st.text.indexOf("(") + 1, -1)}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </section>

        {commish && (
          <PickMovesEditor
            slug={slug}
            years={l.years}
            teams={[...d.teams].sort((a, b) => a.abbr.localeCompare(b.abbr)).map((t) => ({ id: t.id, abbr: t.abbr }))}
            owners={Object.fromEntries([...l.picks.values()].filter((p) => l.years.includes(p.y)).map((p) => [`${p.y}-${p.r}-${p.o}`, p.owner]))}
            moves={[...moves].sort((a, b) => b.at.localeCompare(a.at)).map((m) => ({ id: m.id, text: `${m.y} ${ROUND[m.r]} (${abbr(m.o ?? m.from)}'s): ${abbr(m.from)} → ${abbr(m.to)}`, src: m.src, note: m.note || "", by: m.by || "", at: m.at }))}
          />
        )}
        {!commish && <p className="hint">A pick trade missing or wrong? A commissioner can record or fix it on this page.</p>}
      </div>
    </main>
  );
}

function YearCell({ y, team, held, gone, abbr }: { y: number; team: Team; held: LedgerPick[]; gone: LedgerPick[]; abbr: (id: number) => string }) {
  const own = held.filter((p) => p.y === y && p.o === team.id).map((p) => p.r);
  const extra = held.filter((p) => p.y === y && p.o !== team.id);
  const out = gone.filter((p) => p.y === y);
  return (
    <>
      <span>{PICK_ROUNDS.filter((r) => own.includes(r)).join(" ") || <span className="muted">none of its own</span>}</span>
      {extra.map((p) => <div key={`${p.r}-${p.o}`} className="pos">+{p.r} {abbr(p.o)}</div>)}
      {out.map((p) => <div key={`${p.r}-${p.o}`} className="muted"><s>{p.r}</s> → {abbr(p.owner)}</div>)}
    </>
  );
}
