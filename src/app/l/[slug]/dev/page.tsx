import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { indexes } from "@/lib/league/derive";
import { buildDevTracker, DEV_GROUPS, DEV_RULES, STAR_STARTS, STAT_LABEL, STATUS_ORDER, SUPERSTAR_STARTS, type DevRow } from "@/lib/league/dev";
import { DEV_LABEL } from "@/lib/league/types";
import { NoData, PlayerLink, TeamBadge } from "@/components/league/bits";

export const metadata: Metadata = { title: "Dev tracker" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ pos?: string; all?: string; q?: string }> };

const OUTLOOK: Record<DevRow["status"], (r: DevRow) => string> = {
  on: (r) => `On pace for ${r.next}`,
  blocked: () => "Ranks high enough, short on starts",
  close: (r) => `${r.avg - (r.need ?? 0)} spot${r.avg - (r.need ?? 0) === 1 ? "" : "s"} away`,
  no: () => "Not close",
  maxed: () => "Already X-Factor",
};

export default async function DevTracker({ params, searchParams }: Props) {
  const { slug } = await params;
  const { pos, all, q = "" } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { teams } = indexes(d);
  const rows = buildDevTracker(d);
  const group = DEV_GROUPS.includes(pos || "") ? pos! : "All";
  const showAll = all === "1";
  const query = q.trim().toLowerCase();
  const counts = { "X-Factor": 0, Superstar: 0, Star: 0 } as Record<string, number>;
  rows.forEach((r) => { if (r.status === "on" && r.next) counts[r.next]++; });
  const href = (o: { pos?: string; all?: boolean }) => {
    const sp = new URLSearchParams();
    const g = o.pos ?? group;
    if (g !== "All") sp.set("pos", g);
    if (o.all ?? showAll) sp.set("all", "1");
    if (q) sp.set("q", q);
    const s = sp.toString();
    return `/l/${slug}/dev${s ? `?${s}` : ""}`;
  };

  const groups = (group === "All" ? DEV_GROUPS : [group]).map((g) => {
    let list = rows.filter((r) => r.group === g);
    if (!showAll) list = list.filter((r) => r.status === "on" || r.status === "close" || r.status === "blocked");
    if (query) list = list.filter((r) => {
      const t = teams.get(r.p.team);
      return `${r.p.first} ${r.p.last}`.toLowerCase().includes(query) || (t && `${t.city} ${t.name} ${t.abbr}`.toLowerCase().includes(query));
    });
    list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.avg - b.avg || b.p.dev - a.p.dev);
    return { g, list, rule: DEV_RULES.find((r) => r.group === g)! };
  }).filter((x) => x.list.length);

  const hasStats = d.lines.some((l) => d.games.find((g) => g.id === l.g)?.stage === 1);

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Dev tracker</h2>
        <p className="muted" style={{ maxWidth: "68ch" }}>
          Who&apos;s on pace for a dev trait bump at season&apos;s end, from {d.season.year} regular-season stats through {d.season.title}.
          Each player is ranked against everyone at his position; the ranks are averaged and checked against the cutoff for his next tier.
        </p>
        {!hasStats ? <div className="panel"><p>No regular-season stats yet, so there&apos;s nothing to rank. Check back after week 1.</p></div> : (
          <>
            <div className="stat-tiles three">
              <div className="tile"><div className="tile-label">On pace for X-Factor</div><div className="tile-value">{counts["X-Factor"]}</div><div className="tile-sub">Superstars ranking high enough</div></div>
              <div className="tile"><div className="tile-label">On pace for Superstar</div><div className="tile-value">{counts.Superstar}</div><div className="tile-sub">Stars, if they reach {SUPERSTAR_STARTS} starts</div></div>
              <div className="tile"><div className="tile-label">On pace for Star</div><div className="tile-value">{counts.Star}</div><div className="tile-sub">Normal players, if they reach {STAR_STARTS} starts</div></div>
            </div>

            <div className="filters">
              <nav className="week-chips" aria-label="Position">
                {["All", ...DEV_GROUPS].map((g) => <Link key={g} href={href({ pos: g })} aria-current={g === group ? "page" : undefined}>{g}</Link>)}
              </nav>
              <div className="filter-row">
                <Link className="toggle-link" href={href({ all: !showAll })} aria-pressed={showAll}>
                  <span className={`check ${showAll ? "on" : ""}`} aria-hidden />Show everyone, not just contenders
                </Link>
                <form method="get" action={`/l/${slug}/dev`} className="search-form" role="search">
                  {group !== "All" && <input type="hidden" name="pos" value={group} />}
                  {showAll && <input type="hidden" name="all" value="1" />}
                  <input type="search" name="q" defaultValue={q} placeholder="Find a player or team" aria-label="Find a player or team" />
                </form>
              </div>
            </div>

            {groups.length === 0 && (
              <div className="panel"><p className="muted">{query ? `No players match "${q}".` : "Nobody at this position is in range yet. Turn on Show everyone to see the full rankings."}</p></div>
            )}
            {groups.map(({ g, list, rule }) => (
              <div className="panel tbl-wrap" key={g}>
                <table className="tbl dev-tbl">
                  <caption>
                    {g} <span className="muted">{list.length}</span>
                    <span className="cap-note">Top {rule.cut.C} for Star, top {rule.cut.B} for Superstar, top {rule.cut.A} for X-Factor{rule.alt ? " (wider with the dual-threat bar)" : ""}</span>
                  </caption>
                  <thead><tr><th>Player</th><th>Dev now</th><th className="num">GP</th><th>Ranked stats</th><th className="num">Avg</th><th className="num">Needs</th><th>Outlook</th></tr></thead>
                  <tbody>
                    {list.map((r) => {
                      const t = teams.get(r.p.team);
                      return (
                        <tr key={r.p.id}>
                          <td className="cap-name"><TeamBadge team={t} size={20} /> <PlayerLink slug={slug} player={r.p} /> <span className="muted small">{r.pos}</span></td>
                          <td>{DEV_LABEL[r.p.dev]}</td>
                          <td className="num">{r.gp}</td>
                          <td className="small">{r.stats.map((s) => <span key={s.id} className="rank-stat">{STAT_LABEL[s.id]} {Number.isInteger(s.value) ? s.value : s.value.toFixed(1)} <span className="muted">#{s.rank}</span></span>)}</td>
                          <td className="num strong">{r.avg}</td>
                          <td className="num muted">{r.need != null ? `≤ ${r.need}` : "—"}</td>
                          <td>
                            <span className={`outlook o-${r.status}`}>{OUTLOOK[r.status](r)}</span>
                            {r.via && <div className="muted small">{r.via}</div>}
                            {r.startsNeeded > 0 && (r.status === "on" || r.status === "blocked") && <div className="muted small">{r.gp} of {r.startsNeeded} starts, {r.left} games left</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            <p className="hint" style={{ maxWidth: "76ch" }}>
              Dev only moves one tier a season. Normal players need the Star range plus {STAR_STARTS} starts; Stars need the Superstar range plus {SUPERSTAR_STARTS} starts;
              Superstars need the X-Factor range. Games with a stat line stand in for starts, since EA&apos;s data has no starts column, and tackles for loss aren&apos;t
              in it either. Based on the Madden 21 Dynamic Dev Progression Guide by Jox (/u/TheWunderwaffe); Madden 27 may differ slightly.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
