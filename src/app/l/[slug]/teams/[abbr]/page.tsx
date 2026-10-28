import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeagueData } from "@/lib/league/load";
import {
  indexes, inferredDeadCap, passerRating, record, rosterGroups, seasonTotals, streakText, teamCapProjection, teamPlayers, teamSchedule, weekTitle,
} from "@/lib/league/derive";
import { CAP_GROWTH_PER_YEAR } from "@/lib/league/cap";
import { avg, heightText, money, onColor, pct } from "@/lib/league/format";
import { DevTag, NoData, PlayerLink, TeamBadge } from "@/components/league/bits";
import type { LeagueData, Player, Team } from "@/lib/league/types";

type Props = { params: Promise<{ slug: string; abbr: string }>; searchParams: Promise<{ tab?: string; view?: string }> };
const TABS = [["roster", "Roster"], ["cap", "Cap"], ["schedule", "Schedule"], ["stats", "Stats"]] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, abbr } = await params;
  const d = await getLeagueData(slug);
  const t = d?.teams.find((x) => x.abbr.toLowerCase() === abbr);
  return { title: t ? `${t.city} ${t.name}` : "Team" };
}

export default async function TeamPage({ params, searchParams }: Props) {
  const { slug, abbr } = await params;
  const { tab = "roster", view } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { byAbbr } = indexes(d);
  const team = byAbbr.get(abbr.toLowerCase());
  if (!team) notFound();
  const roster = teamPlayers(d, team.id);
  const base = `/l/${slug}/teams/${team.abbr.toLowerCase()}`;
  const ink = onColor(team.primary);

  return (
    <main className="league-page">
      <div className="team-banner" style={{ background: team.primary, color: ink, borderBottomColor: team.secondary }}>
        <div className="wrap">
          <div className="tb-row">
            <TeamBadge team={{ ...team, primary: team.secondary }} size={56} />
            <div>
              <h2>{team.city} {team.name}</h2>
              <div className="tb-meta">
                <span>{record(team)}</span><span>{team.division}</span><span>{streakText(team.rec.streak)}</span>
                <span>{team.user || "CPU team"}</span><span>{team.ovr} OVR</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="wrap page-tight">
        {tab !== "cap" && <CapOutlook d={d} team={team} base={base} />}
        <nav className="tabs" aria-label="Team">
          {TABS.map(([k, label]) => (
            <Link key={k} href={k === "roster" ? base : `${base}?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        {tab === "cap" ? <CapTab d={d} team={team} roster={roster} slug={slug} view={view === "details" ? "details" : "years"} base={base} />
          : tab === "schedule" ? <ScheduleTab d={d} team={team} slug={slug} />
          : tab === "stats" ? <StatsTab d={d} team={team} slug={slug} />
          : <RosterTab roster={roster} slug={slug} />}
      </div>
    </main>
  );
}

function CapOutlook({ d, team, base }: { d: LeagueData; team: Team; base: string }) {
  const { totals } = teamCapProjection(d, team);
  return (
    <section className="outlook-strip" aria-labelledby="outlook-h">
      <div className="section-head">
        <h3 id="outlook-h">Cap outlook</h3>
        <Link href={`${base}?tab=cap`}>Full breakdown</Link>
      </div>
      <div className="outlook-cards">
        {totals.map((t, i) => (
          <div className="outlook-card" key={t.year}>
            <div className="oc-year">{t.year}{i === 0 ? <span className="muted"> now</span> : <span className="proj-inline">proj.</span>}</div>
            <div className={`oc-space ${t.space < 0 ? "neg" : ""}`}>{money(t.space)}</div>
            <div className="oc-label">cap space</div>
            <div className="oc-row"><span>{t.players}</span> signed</div>
            <div className="oc-row"><span>{money(t.committed)}</span> committed</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RosterTab({ roster, slug }: { roster: Player[]; slug: string }) {
  const groups = rosterGroups(roster);
  const active = roster.filter((p) => !p.ps);
  const avgAge = active.length ? active.reduce((a, p) => a + p.age, 0) / active.length : 0;
  return (
    <>
      <div className="stat-tiles">
        <Tile label="Active roster" value={`${active.length}`} sub="of 53" />
        <Tile label="Practice squad" value={`${roster.length - active.length}`} />
        <Tile label="Average age" value={avgAge.toFixed(1)} />
        <Tile label="X-Factors / Superstars" value={`${active.filter((p) => p.dev === 3).length} / ${active.filter((p) => p.dev === 2).length}`} />
      </div>
      {groups.map((g) => (
        <div className="panel tbl-wrap" key={g.label}>
          <table className="tbl">
            <caption>{g.label} <span className="muted">{g.players.length}</span></caption>
            <thead><tr><th>Player</th><th>Pos</th><th className="num">OVR</th><th className="num">Age</th><th className="num">Exp</th><th className="hide-sm">Ht / Wt</th><th className="num">Cap hit</th><th className="num">Yrs</th></tr></thead>
            <tbody>
              {g.players.map((p) => (
                <tr key={p.id}>
                  <td><span className="jersey">{p.jersey}</span><PlayerLink slug={slug} player={p} /> <DevTag dev={p.dev} />{p.injury > 0 && <span className="tag inj" title={`Out ${p.injury} weeks`}>Inj</span>}</td>
                  <td>{p.pos}</td>
                  <td className="num strong">{p.ovr}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">{p.yearsPro || "R"}</td>
                  <td className="hide-sm muted">{heightText(p.height)} / {p.weight}</td>
                  <td className="num">{money(p.contract.capHit)}</td>
                  <td className="num">{p.contract.yearsLeft}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function CapTab({ d, team, roster, slug, view, base }: { d: LeagueData; team: Team; roster: Player[]; slug: string; view: "years" | "details"; base: string }) {
  const active = roster.filter((p) => !p.ps).sort((a, b) => b.contract.capHit - a.contract.capHit);
  const ps = roster.filter((p) => p.ps).sort((a, b) => b.contract.capHit - a.contract.capHit);
  const dead = inferredDeadCap(team, roster);
  const expiring = active.filter((p) => p.contract.yearsLeft <= 1);
  const usedPct = team.cap.room ? Math.min(100, (team.cap.spent / team.cap.room) * 100) : 0;
  const capRows = (list: Player[]) => list.map((p) => (
    <tr key={p.id}>
      <td className="cap-name"><PlayerLink slug={slug} player={p} /> <span className="muted small">{p.pos}</span></td>
      <td className="num strong">{money(p.contract.capHit)}</td>
      <td className="num">{p.contract.yearsLeft}<span className="muted">/{p.contract.length}</span></td>
      <td className="num hide-sm">{money(p.contract.salary + p.contract.bonus)}</td>
      <td className="num hide-sm">{money(p.contract.bonus)}</td>
      <td className={`num ${p.contract.releaseSavings > 0 ? "pos" : ""}`}>{money(p.contract.releaseSavings)}</td>
      <td className="num">{money(p.contract.releasePenalty)}</td>
    </tr>
  ));
  return (
    <>
      <div className="stat-tiles">
        <Tile label="Cap space" value={money(team.cap.available)} neg={team.cap.available < 0} />
        <Tile label="Spent" value={money(team.cap.spent)} sub={`of ${money(team.cap.room)}`} />
        <Tile label="Dead money (est.)" value={money(dead)} sub="cap spent not on the roster" />
        <Tile label="Expiring deals" value={`${expiring.length}`} sub={money(expiring.reduce((a, p) => a + p.contract.capHit, 0))} />
      </div>
      <div className="cap-meter" role="img" aria-label={`${usedPct.toFixed(0)}% of the cap used`}>
        <span style={{ width: `${usedPct}%`, background: team.primary }} />
      </div>
      <div className="seg" role="tablist" aria-label="Cap view">
        <Link href={`${base}?tab=cap`} aria-current={view === "years" ? "page" : undefined}>Cap by year</Link>
        <Link href={`${base}?tab=cap&view=details`} aria-current={view === "details" ? "page" : undefined}>Contract details</Link>
      </div>
      {view === "years" ? <CapByYear d={d} team={team} slug={slug} /> : (
        <>
        <div className="panel tbl-wrap">
          <table className="tbl">
            <caption>Contracts <span className="muted">highest cap hit first</span></caption>
            <thead>
              <tr><th>Player</th><th className="num">Cap hit</th><th className="num" title="Years left / length">Yrs</th><th className="num hide-sm">Total</th><th className="num hide-sm">Bonus</th><th className="num">Cut saves</th><th className="num">Dead if cut</th></tr>
            </thead>
            <tbody>{capRows(active)}</tbody>
          </table>
        </div>
        {ps.length > 0 && (
          <details className="panel">
            <summary>Practice squad <span className="muted">{ps.length} players, {money(ps.reduce((a, p) => a + p.contract.capHit, 0))}</span></summary>
            <div className="tbl-wrap"><table className="tbl"><tbody>{capRows(ps)}</tbody></table></div>
          </details>
        )}
        </>
      )}
      {view === "details" && <p className="hint">Cap hit is this season. &quot;Cut saves&quot; and &quot;Dead if cut&quot; are Madden&apos;s own numbers for releasing the player today.</p>}
    </>
  );
}

function CapByYear({ d, team, slug }: { d: LeagueData; team: Team; slug: string }) {
  const { years, rows, totals } = teamCapProjection(d, team);
  const shown = rows.filter((r) => Object.keys(r.hits).length);
  return (
    <>
      <div className="panel tbl-wrap">
        <table className="tbl summary-tbl">
          <caption>Next {years.length - 1} seasons <span className="muted">from contracts as of this sync</span></caption>
          <thead><tr><th>Season</th><th className="num" title="Players under contract">Signed</th><th className="num">Committed</th><th className="num hide-sm">League cap</th><th className="num">Space</th></tr></thead>
          <tbody>
            {totals.map((t, i) => (
              <tr key={t.year}>
                <td className="nw">{t.year}{i === 0 ? <span className="muted small"> now</span> : <span className="proj">proj.</span>}</td>
                <td className="num strong">{t.players}</td>
                <td className="num">{money(t.committed)}</td>
                <td className="num muted hide-sm">{money(t.cap)}</td>
                <td className={`num strong ${t.space < 0 ? "neg" : "pos"}`}>{money(t.space)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel tbl-wrap">
        <table className="tbl years-tbl">
          <caption>By player <span className="muted">{years[0]} is Madden&apos;s; later years are projected</span></caption>
          <thead>
            <tr>
              <th>Player</th>
              {years.map((y, i) => <th key={y} className="num">{y}{i > 0 && <span className="proj">proj.</span>}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ p, hits }) => (
              <tr key={p.id}>
                <td className="cap-name"><PlayerLink slug={slug} player={p} /> <span className="muted small">{p.pos}</span></td>
                {years.map((y, i) => (
                  <td key={y} className={`num ${i === 0 ? "strong" : ""} ${hits[y] == null ? "muted" : ""}`}>{hits[y] == null ? "—" : money(hits[y])}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">Committed</th>{totals.map((t) => <td key={t.year} className="num">{money(t.committed)}</td>)}</tr>
            <tr><th scope="row">League cap</th>{totals.map((t) => <td key={t.year} className="num muted">{money(t.cap)}</td>)}</tr>
            <tr className="space-row"><th scope="row">Cap space</th>{totals.map((t) => <td key={t.year} className={`num strong ${t.space < 0 ? "neg" : "pos"}`}>{money(t.space)}</td>)}</tr>
            <tr><th scope="row">Players signed</th>{totals.map((t) => <td key={t.year} className="num muted">{t.players}</td>)}</tr>
          </tfoot>
        </table>
      </div>
      <p className="hint">
        {years[0]} uses Madden&apos;s own numbers, dead money included. Later years project each current contract year by year
        with the formula worked out from real Madden extensions (bonus spread over up to 5 years, salary rising toward the end),
        so individual years can be off by 10–20%. The league cap is assumed to grow {money(CAP_GROWTH_PER_YEAR)} a year.
        Future dead money, new signings and re-signings aren&apos;t included. Practice squad deals are left out.
      </p>
    </>
  );
}

function ScheduleTab({ d, team, slug }: { d: LeagueData; team: Team; slug: string }) {
  const { teams } = indexes(d);
  const games = teamSchedule(d, team.id).filter((g) => g.stage === 1 || g.final);
  return (
    <div className="panel tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Week</th><th>Opponent</th><th>Result</th></tr></thead>
        <tbody>
          {games.map((g) => {
            const home = g.home === team.id;
            const opp = teams.get(home ? g.away : g.home);
            const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
            const res = !g.final ? "" : us > them ? "W" : us < them ? "L" : "T";
            return (
              <tr key={g.id}>
                <td className="muted">{weekTitle(d, g.stage, g.week)}</td>
                <td>{home ? "vs " : "at "}{opp ? <Link href={`/l/${slug}/teams/${opp.abbr.toLowerCase()}`}>{opp.city} {opp.name}</Link> : "TBD"}</td>
                <td>{g.final ? <Link href={`/l/${slug}/games/${g.id}`} className={`res res-${res}`}>{res} {us}-{them}</Link> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsTab({ d, team, slug }: { d: LeagueData; team: Team; slug: string }) {
  const { players } = indexes(d);
  const totals = [...seasonTotals(d, (l) => l.t === team.id).entries()];
  const rows = (k: "pa" | "ra" | "rc" | "tk") => totals.filter(([, t]) => t[k] > 0);
  const name = (id: number) => <PlayerLink slug={slug} player={players.get(id)} />;
  return (
    <>
      <p className="hint">Regular season.</p>
      <Stat title="Passing" head={["CMP", "ATT", "%", "YDS", "TD", "INT", "RTG"]} rows={rows("pa").sort(([, a], [, b]) => b.py - a.py).map(([id, t]) => [name(id), t.pc, t.pa, pct(t.pc, t.pa), t.py, t.ptd, t.pint, passerRating(t).toFixed(1)])} />
      <Stat title="Rushing" head={["CAR", "YDS", "AVG", "TD", "LNG", "FUM"]} rows={rows("ra").sort(([, a], [, b]) => b.ry - a.ry).map(([id, t]) => [name(id), t.ra, t.ry, avg(t.ry, t.ra), t.rtd, t.rlng, t.rfum])} />
      <Stat title="Receiving" head={["REC", "YDS", "AVG", "TD", "LNG", "YAC"]} rows={rows("rc").sort(([, a], [, b]) => b.rcy - a.rcy).map(([id, t]) => [name(id), t.rc, t.rcy, avg(t.rcy, t.rc), t.rctd, t.rclng, t.rcyac])} />
      <Stat title="Defense" head={["TKL", "SCK", "INT", "PD", "FF", "FR", "TD"]} rows={totals.filter(([, t]) => t.tk + t.sk + t.int + t.pd > 0).sort(([, a], [, b]) => b.tk - a.tk).map(([id, t]) => [name(id), t.tk, t.sk, t.int, t.pd, t.ff, t.fr, t.dtd])} />
    </>
  );
}

function Stat({ title, head, rows }: { title: string; head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return null;
  return (
    <div className="panel tbl-wrap">
      <table className="tbl">
        <caption>{title}</caption>
        <thead><tr><th>Player</th>{head.map((h) => <th key={h} className="num">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : ""}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, sub, neg }: { label: string; value: string; sub?: string; neg?: boolean }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className={`tile-value ${neg ? "neg" : ""}`}>{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}
